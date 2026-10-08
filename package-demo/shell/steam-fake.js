'use strict';
// 本机假 Steam：只给打包工具的「两个客户端联机测试」用（tools/lib/duo.mjs）。
// 它实现 steam-bridge.js 用到的那部分 steamworks.js 接口（大厅、P2P 消息、邀请、成就、统计、好友列表状态），
// 把房间和消息交给本机的中转程序（127.0.0.1 上的 TCP 端口），两个打好的游戏程序就能在一台电脑上互相联机。
// 只在打包工具提供本次构建的试跑钥匙时启用（见 main.js），玩家无法开启；真实 Steam 的那一段用测试版的联机自检验证。

const net = require('node:net');

const SteamCallback = {
  LobbyChatUpdate: 'LobbyChatUpdate',
  LobbyDataUpdate: 'LobbyDataUpdate',
  GameLobbyJoinRequested: 'GameLobbyJoinRequested',
  P2PSessionRequest: 'P2PSessionRequest',
  P2PSessionConnectFail: 'P2PSessionConnectFail',
};
// 真 Steam：没被接受的 P2P 会话一段时间后作废，之后对方再发消息会重新请求
const SESSION_TIMEOUT_MS = 3000;

function createFakeSteam({ port, id, name, language, log }) {
  const me = String(id);
  const subs = new Map();
  const lobbies = new Map();
  const inbox = [];
  const held = new Map();
  const accepted = new Set();
  const pending = new Map();
  const achievements = new Set();
  const stats = new Map();
  const record = { achievements: [], stats: [], presence: [], overlay: [], invites: 0, rejected: [] };
  const outbox = [];
  let open = false;
  let reqId = 0;
  let buffer = '';

  const emit = (kind, payload) => {
    for (const fn of subs.get(kind) || []) {
      try {
        fn(payload);
      } catch (err) {
        log.warn('steam', `假 Steam 回调 ${kind} 出错`, { error: String(err && err.message || err) });
      }
    }
  };
  const sock = net.connect(port, '127.0.0.1', () => {
    open = true;
    sock.setNoDelay(true);
    for (const line of outbox.splice(0)) sock.write(line);
  });
  const sendRaw = (msg) => {
    const line = `${JSON.stringify(msg)}\n`;
    if (open) sock.write(line);
    else outbox.push(line);
  };
  sendRaw({ t: 'hello', id: me, name });
  sock.on('error', (err) => log.warn('steam', '假 Steam 中转连接出错', { error: String(err && err.message || err) }));
  sock.on('close', () => {
    open = false;
    log.warn('steam', '假 Steam 中转连接已断开');
  });
  sock.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch (err) {
        log.warn('steam', '假 Steam 消息处理失败', { error: String(err && err.stack || err) });
      }
    }
  });

  const request = (msg) => new Promise((resolve, reject) => {
    reqId += 1;
    const req = reqId;
    pending.set(req, { resolve, reject });
    sendRaw({ ...msg, req });
    setTimeout(() => {
      if (pending.delete(req)) reject(new Error('假 Steam 中转没有响应'));
    }, 10000);
  });

  function lobbyObject(lid) {
    const L = () => lobbies.get(lid) || { members: [], owner: '0', data: {} };
    return {
      id: BigInt(lid),
      getMembers: () => L().members.map((m) => ({ steamId64: BigInt(m) })),
      getOwner: () => ({ steamId64: BigInt(L().owner || '0') }),
      // 和真 Steam 一样：只有房主能写房间数据
      setData: (key, value) => {
        if (L().owner !== me) return false;
        L().data[String(key)] = String(value);
        sendRaw({ t: 'data', lobby: lid, key: String(key), value: String(value) });
        return true;
      },
      getData: (key) => (Object.prototype.hasOwnProperty.call(L().data, String(key)) ? L().data[String(key)] : null),
      leave: () => {
        sendRaw({ t: 'leave', lobby: lid });
        lobbies.delete(lid);
      },
    };
  }

  function handle(m) {
    if (m.t === 'ok' || m.t === 'err') {
      const p = pending.get(m.req);
      if (!p) return;
      pending.delete(m.req);
      if (m.t === 'err') return p.reject(new Error(m.message || '假 Steam 拒绝了请求'));
      lobbies.set(m.lobby, { members: m.members, owner: m.owner, data: m.data || {} });
      return p.resolve(lobbyObject(m.lobby));
    }
    if (m.t === 'lobby') {
      const L = lobbies.get(m.lobby);
      if (!L) return;
      L.members = m.members;
      L.owner = m.owner;
      emit(SteamCallback.LobbyChatUpdate, { lobby: BigInt(m.lobby), user_changed: BigInt(m.who || '0'), making_change: BigInt(m.who || '0'), member_state_change: m.change });
      return;
    }
    if (m.t === 'data') {
      const L = lobbies.get(m.lobby);
      if (!L) return;
      L.data[m.key] = m.value;
      emit(SteamCallback.LobbyDataUpdate, { lobby: BigInt(m.lobby), member: BigInt(m.lobby), success: true });
      return;
    }
    if (m.t === 'invite') {
      emit(SteamCallback.GameLobbyJoinRequested, { lobby_steam_id: BigInt(m.lobby), friend_steam_id: BigInt(m.from) });
      return;
    }
    if (m.t === 'packet') {
      const packet = { from: m.from, data: Buffer.from(m.data, 'base64') };
      if (accepted.has(m.from)) {
        inbox.push(packet);
        return;
      }
      const list = held.get(m.from) || [];
      list.push(packet);
      held.set(m.from, list);
      if (list.length > 1) return;
      emit(SteamCallback.P2PSessionRequest, { remote: BigInt(m.from) });
      setTimeout(() => {
        if (accepted.has(m.from) || !held.has(m.from)) return;
        const dropped = held.get(m.from).length;
        held.delete(m.from);
        record.rejected.push({ from: m.from, dropped, at: Date.now() });
        emit(SteamCallback.P2PSessionConnectFail, { remote: BigInt(m.from), error: 'not accepted' });
      }, SESSION_TIMEOUT_MS);
    }
  }

  return {
    fake: true,
    record,
    close: () => sock.destroy(),
    callback: {
      SteamCallback,
      register: (kind, fn) => {
        if (!subs.has(kind)) subs.set(kind, new Set());
        subs.get(kind).add(fn);
        return { disconnect: () => subs.get(kind).delete(fn) };
      },
    },
    localplayer: {
      getSteamId: () => ({ steamId64: BigInt(me), steamId32: me, accountId: Number(BigInt(me) & 0xffffffffn) }),
      getName: () => name,
      setRichPresence: (key, value) => {
        record.presence.push({ key: String(key), value: value == null ? null : String(value) });
        sendRaw({ t: 'note', what: 'presence', key: String(key), value: value == null ? null : String(value) });
      },
    },
    matchmaking: {
      createLobby: (type, max) => request({ t: 'create', max: Number(max) || 4 }),
      joinLobby: (lid) => request({ t: 'join', lobby: String(lid) }),
    },
    networking: {
      isP2PPacketAvailable: () => (inbox.length ? Math.max(1, inbox[0].data.length) : 0),
      readP2PPacket: () => {
        const p = inbox.shift();
        return { data: p.data, size: p.data.length, steamId: { steamId64: BigInt(p.from) } };
      },
      sendP2PPacket: (to, type, data) => {
        sendRaw({ t: 'send', to: String(to), data: Buffer.from(data).toString('base64') });
        return true;
      },
      acceptP2PSession: (remote) => {
        const from = String(remote);
        accepted.add(from);
        const list = held.get(from);
        if (list) {
          held.delete(from);
          inbox.push(...list);
        }
      },
    },
    overlay: {
      // 真 Steam 打开好友列表让玩家挑人；这里直接发给中转程序上不在这个房间的人
      activateInviteDialog: (lid) => {
        record.invites += 1;
        sendRaw({ t: 'invite', lobby: String(lid) });
      },
      activateDialog: (dialog) => record.overlay.push(`dialog ${dialog}`),
      activateToWebPage: (url) => record.overlay.push(`web ${url}`),
      activateToStore: (appId) => record.overlay.push(`store ${appId}`),
    },
    achievement: {
      isActivated: (n) => achievements.has(String(n)),
      activate: (n) => {
        achievements.add(String(n));
        record.achievements.push(String(n));
        sendRaw({ t: 'note', what: 'achievement', name: String(n) });
        return true;
      },
    },
    stats: {
      getInt: (n) => (stats.has(String(n)) ? stats.get(String(n)) : 0),
      setInt: (n, v) => {
        stats.set(String(n), v);
        record.stats.push({ name: String(n), value: v });
        return true;
      },
      store: () => true,
    },
    apps: { currentGameLanguage: () => language || 'schinese' },
    utils: { isSteamRunningOnSteamDeck: () => false },
    cloud: { isEnabledForAccount: () => false, isEnabledForApp: () => false },
  };
}

module.exports = { createFakeSteam };
