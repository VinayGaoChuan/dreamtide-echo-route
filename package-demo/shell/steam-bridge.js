'use strict';
// Steam 联机与运营功能（主进程这一侧）。页面那一侧是 preload.js 里的 kitBridge.steam，接口见金牌制作人套件 README「Steam bridge」。
// 房间：Steam 大厅（仅好友可见，好友列表里能「加入游戏」，也能用覆盖层邀请）。
// 消息：Steam P2P（可靠模式；直连不通时由 Valve 中继转发），只收发同一房间里的人。
// 运营：成就、统计、好友列表里显示的状态（rich presence）、Steam Deck 识别、Steam 云状态。
// 只有 Steam 初始化成功（填了 App ID，从 Steam 启动，账号拥有游戏）时才启用；否则游戏按单机运行。

const { ipcMain } = require('electron');

const LOBBY_FRIENDS_ONLY = 1;
const SEND_RELIABLE = 2;
const MAX_PACKETS_PER_POLL = 256;
// 新成员的第一条消息可能比「有人进房」的通知先到：先等一会儿看他是否进了房间，再决定接不接受
const SESSION_WAIT_MS = 3000;
// 测延迟用的来回包（联机自检）：以这个前缀开头的消息在这里处理，不转给游戏
const PING = '\u0001mcping:';
const PONG = '\u0001mcpong:';

function createSteamBridge({ client, log, argv, send }) {
  const cb = client.callback;
  const state = { lobby: null, joinRequest: null, rtt: [] };
  const idOf = (p) => String(p && p.steamId64 !== undefined ? p.steamId64 : p);
  const me = idOf(client.localplayer.getSteamId());
  const members = () => {
    try {
      return state.lobby ? state.lobby.getMembers().map(idOf) : [];
    } catch {
      return [];
    }
  };
  const inLobby = (id) => members().includes(String(id));

  function presence() {
    try {
      const lobby = state.lobby;
      client.localplayer.setRichPresence('steam_player_group', lobby ? String(lobby.id) : null);
      client.localplayer.setRichPresence('steam_player_group_size', lobby ? String(members().length) : null);
    } catch (err) {
      log.warn('steam', '好友列表状态更新失败', { error: String(err && err.message || err) });
    }
  }

  function changed(reason) {
    presence();
    send('kit:lobby-change', reason);
  }

  async function enter(promise, how) {
    leave();
    state.lobby = await promise;
    log.info('steam', `${how}房间 ${state.lobby.id}`, { members: members().length });
    changed(how);
    return String(state.lobby.id);
  }

  function leave() {
    if (!state.lobby) return;
    try {
      state.lobby.leave();
    } catch {
      // 已经不在房间里
    }
    log.info('steam', `离开房间 ${state.lobby.id}`);
    state.lobby = null;
    changed('leave');
  }

  // 好友从好友列表点「加入游戏」或接受邀请：游戏运行中走回调；没运行时 Steam 用 +connect_lobby <id> 启动游戏
  function joinRequested(lobbyId, how) {
    state.joinRequest = String(lobbyId);
    log.info('steam', `收到加入请求（${how}）：房间 ${lobbyId}`);
    send('kit:join-request', state.joinRequest);
  }
  const argIndex = argv.indexOf('+connect_lobby');
  if (argIndex >= 0 && argv[argIndex + 1]) joinRequested(argv[argIndex + 1], '启动参数');

  const handles = [
    cb.register(cb.SteamCallback.LobbyChatUpdate, (e) => {
      if (state.lobby && String(e.lobby) === String(state.lobby.id)) changed('members');
    }),
    cb.register(cb.SteamCallback.LobbyDataUpdate, (e) => {
      if (state.lobby && String(e.lobby) === String(state.lobby.id)) send('kit:lobby-change', 'data');
    }),
    cb.register(cb.SteamCallback.GameLobbyJoinRequested, (e) => joinRequested(e.lobby_steam_id, '好友邀请')),
    // 只接受同一房间里的人发起的 P2P 会话
    cb.register(cb.SteamCallback.P2PSessionRequest, (e) => {
      const started = Date.now();
      let waited = false;
      const decide = () => {
        if (inLobby(e.remote)) {
          client.networking.acceptP2PSession(e.remote);
          if (waited) log.info('steam', `${e.remote} 进房后接受了他的连接`, { waitedMs: Date.now() - started });
        } else if (Date.now() - started < SESSION_WAIT_MS) {
          waited = true;
          setTimeout(decide, 100);
        } else {
          log.warn('steam', `拒绝了房间外的连接 ${e.remote}`);
        }
      };
      decide();
    }),
    cb.register(cb.SteamCallback.P2PSessionConnectFail, (e) => log.warn('steam', `与 ${e.remote} 的连接失败`, { error: e.error })),
  ];

  // 收消息：每帧把到达的包读出来，转给页面
  const poll = setInterval(() => {
    try {
      for (let i = 0; i < MAX_PACKETS_PER_POLL; i += 1) {
        const size = client.networking.isP2PPacketAvailable();
        if (!size) break;
        const packet = client.networking.readP2PPacket(size);
        const from = idOf(packet.steamId);
        if (!inLobby(from)) continue;
        const text = packet.data.toString('utf8');
        if (text.startsWith(PING)) {
          client.networking.sendP2PPacket(BigInt(from), SEND_RELIABLE, Buffer.from(PONG + text.slice(PING.length), 'utf8'));
        } else if (text.startsWith(PONG)) {
          const sent = Number(text.slice(PONG.length));
          if (sent) state.rtt.push({ from, ms: Date.now() - sent, at: Date.now() });
          if (state.rtt.length > 500) state.rtt.splice(0, state.rtt.length - 500);
        } else {
          send('kit:message', from, text);
        }
      }
    } catch (err) {
      log.warn('steam', '读取联机消息失败', { error: String(err && err.message || err) });
    }
  }, 1000 / 60);

  const sync = (channel, fn) => ipcMain.on(channel, (event, ...args) => {
    try {
      event.returnValue = fn(...args);
    } catch (err) {
      log.warn('steam', `${channel} 失败`, { error: String(err && err.message || err) });
      event.returnValue = null;
    }
  });
  const fire = (channel, fn) => ipcMain.on(channel, (event, ...args) => {
    try {
      fn(...args);
    } catch (err) {
      log.warn('steam', `${channel} 失败`, { error: String(err && err.message || err) });
    }
  });

  sync('kit:steam-info', () => ({
    me,
    name: client.localplayer.getName(),
    language: client.apps.currentGameLanguage(),
    steamDeck: Boolean(client.utils.isSteamRunningOnSteamDeck()),
    cloud: Boolean(client.cloud.isEnabledForAccount() && client.cloud.isEnabledForApp()),
    joinRequest: state.joinRequest,
  }));
  ipcMain.handle('kit:lobby-create', (event, max) => enter(client.matchmaking.createLobby(LOBBY_FRIENDS_ONLY, Math.max(2, Math.min(250, Number(max) || 4))), '创建'));
  ipcMain.handle('kit:lobby-join', (event, id) => {
    if (state.joinRequest === String(id)) state.joinRequest = null;
    return enter(client.matchmaking.joinLobby(BigInt(String(id))), '加入');
  });
  fire('kit:lobby-leave', leave);
  sync('kit:lobby-id', () => (state.lobby ? String(state.lobby.id) : null));
  sync('kit:lobby-members', members);
  sync('kit:lobby-owner', () => (state.lobby ? idOf(state.lobby.getOwner()) : null));
  fire('kit:lobby-set', (key, value) => state.lobby && state.lobby.setData(String(key), String(value)));
  sync('kit:lobby-get', (key) => (state.lobby ? state.lobby.getData(String(key)) : null));
  fire('kit:lobby-invite', () => state.lobby && client.overlay.activateInviteDialog(state.lobby.id));
  fire('kit:send', (to, text) => {
    if (!inLobby(to)) return;
    if (!client.networking.sendP2PPacket(BigInt(String(to)), SEND_RELIABLE, Buffer.from(String(text), 'utf8'))) {
      log.warn('steam', `发给 ${to} 的消息没有发出`);
    }
  });
  fire('kit:achievement', (name) => {
    if (client.achievement.isActivated(String(name))) return;
    if (client.achievement.activate(String(name))) {
      client.stats.store();
      log.info('steam', `解锁成就 ${name}`);
    } else {
      log.warn('steam', `成就 ${name} 解锁失败（Steamworks 后台有没有这个成就？）`);
    }
  });
  sync('kit:achievement-get', (name) => client.achievement.isActivated(String(name)));
  fire('kit:stat-set', (name, value) => {
    if (client.stats.setInt(String(name), Math.round(Number(value) || 0))) client.stats.store();
    else log.warn('steam', `统计 ${name} 写入失败（Steamworks 后台有没有这个统计？）`);
  });
  sync('kit:stat-get', (name) => client.stats.getInt(String(name)));
  fire('kit:presence', (key, value) => client.localplayer.setRichPresence(String(key), value == null ? null : String(value)));
  fire('kit:overlay', (page) => {
    const dialogs = { friends: 0, community: 1, players: 2, settings: 3, group: 4, stats: 5, achievements: 6 };
    if (page in dialogs) client.overlay.activateDialog(dialogs[page]);
  });

  log.info('steam', 'Steam 联机和成就已就绪', { me });
  return {
    // 给主进程（联机自检、两个客户端联机测试）：房间信息、房间数据、测延迟
    me,
    lobbyId: () => (state.lobby ? String(state.lobby.id) : null),
    isOwner: () => Boolean(state.lobby) && idOf(state.lobby.getOwner()) === me,
    members,
    lobbyData: (key) => (state.lobby ? state.lobby.getData(String(key)) : null),
    setLobbyData: (key, value) => Boolean(state.lobby) && state.lobby.setData(String(key), String(value)),
    ping() {
      for (const id of members()) {
        if (id !== me) client.networking.sendP2PPacket(BigInt(id), SEND_RELIABLE, Buffer.from(PING + Date.now(), 'utf8'));
      }
    },
    rtt: () => state.rtt.slice(),
    close() {
      clearInterval(poll);
      for (const h of handles) {
        try {
          h.disconnect();
        } catch {
          // 已经断开
        }
      }
      leave();
    },
  };
}

module.exports = { createSteamBridge };
