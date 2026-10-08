// 两个客户端联机测试：在这台电脑上同时运行两个打好的程序，用本机假 Steam（shell/steam-fake.js）连在一起，
// 把打包后的程序、Steam 桥、游戏的联机代码整条链跑一遍。真实 Steam 的那一段（Valve 的服务器、跨网络中继、覆盖层
// 邀请界面）这里测不到，交给测试版的联机自检（shell/duo.js createSelfCheck）。
//
// 第 1 轮「邀请加入 + 中途掉线」：房主建房、发邀请，对方收到邀请进房；一起玩，第 leaveAt 秒强行关掉对方的程序（不走
//   正常退出），房主应在几秒内把他移出并继续玩。
// 第 2 轮「从好友列表加入」：房主建房，对方的程序带 +connect_lobby <房间号> 启动（Steam 从好友列表「加入游戏」就是
//   这样拉起游戏的）；两边都玩完，房主退出，看对方停在什么状态（只记录，不判定）。
// 第 3 轮「联机自检演练」（只在测试版 debugLog: true）：两边进房后由房主触发联机自检（和按 Cmd/Ctrl+Shift+N 同一段代码），
//   检查两边都显示通过、测延迟的来回包通了、日志导出了、整理日志能读出自检结果。
// 中转程序按设置的延迟和抖动转发消息，「有人进房」的通知比消息晚到一点，和真 Steam 一样。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PATHS, resetDir } from './common.mjs';
import { parseLog, summarize } from './logs.mjs';
import { executablePath } from './pack.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IDS = { host: '76561190000000101', guest: '76561190000000102' };
const NAMES = { host: '房主', guest: '加入者' };

export const DUO_DEFAULTS = { enabled: true, seconds: 40, leaveAt: 25, latencyMs: 80, jitterMs: 25, lobbyDelayMs: 300 };

// ── 本机假 Steam 的中转程序：房间、房间数据、邀请、P2P 消息（每对玩家之间保持顺序，模拟延迟）──
function startRelay({ latencyMs, jitterMs, lobbyDelayMs }) {
  const clients = new Map();
  const lobbies = new Map();
  const events = [];
  const traffic = {};
  const lastDeliver = new Map();
  let nextLobby = 1n;
  const note = (who, what, data) => events.push({ at: Date.now(), who: NAMES[who === IDS.host ? 'host' : who === IDS.guest ? 'guest' : ''] || who, what, ...(data || {}) });
  const later = (ms, fn) => setTimeout(fn, ms);

  const broadcast = (lid, except, msg) => {
    const L = lobbies.get(lid);
    if (!L) return;
    for (const m of L.members) {
      if (m === except) continue;
      later(lobbyDelayMs, () => { const c = clients.get(m); if (c) c.send(msg); });
    }
  };
  const leave = (lid, id, why) => {
    const L = lobbies.get(lid);
    if (!L || !L.members.includes(id)) return;
    L.members = L.members.filter((m) => m !== id);
    note(id, why === 'close' ? '程序断开，自动离开房间' : '离开房间', { lobby: lid });
    if (!L.members.length) {
      lobbies.delete(lid);
      return;
    }
    if (L.owner === id) L.owner = L.members[0];
    broadcast(lid, id, { t: 'lobby', lobby: lid, members: L.members, owner: L.owner, who: id, change: 'left' });
  };

  const server = net.createServer((sock) => {
    let id = null;
    let buffer = '';
    sock.setNoDelay(true);
    const send = (msg) => { if (!sock.destroyed) sock.write(`${JSON.stringify(msg)}\n`); };
    sock.on('error', () => {});
    sock.on('close', () => {
      if (!id) return;
      for (const lid of [...lobbies.keys()]) leave(lid, id, 'close');
      if (clients.get(id) && clients.get(id).sock === sock) clients.delete(id);
    });
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line) handle(JSON.parse(line));
      }
    });
    function handle(m) {
      if (m.t === 'hello') {
        id = String(m.id);
        clients.set(id, { send, sock, name: m.name });
        note(id, '连上假 Steam');
      } else if (m.t === 'create') {
        const lid = String(109775240000000000n + nextLobby);
        nextLobby += 1n;
        lobbies.set(lid, { members: [id], owner: id, data: {}, max: Math.max(2, m.max || 4) });
        note(id, '创建房间', { lobby: lid });
        send({ t: 'ok', req: m.req, lobby: lid, members: [id], owner: id, data: {} });
      } else if (m.t === 'join') {
        const L = lobbies.get(String(m.lobby));
        if (!L) return send({ t: 'err', req: m.req, message: '房间不存在' });
        if (L.members.length >= L.max && !L.members.includes(id)) return send({ t: 'err', req: m.req, message: '房间满了' });
        if (!L.members.includes(id)) L.members.push(id);
        note(id, '加入房间', { lobby: m.lobby });
        send({ t: 'ok', req: m.req, lobby: String(m.lobby), members: L.members, owner: L.owner, data: L.data });
        broadcast(String(m.lobby), id, { t: 'lobby', lobby: String(m.lobby), members: L.members, owner: L.owner, who: id, change: 'entered' });
      } else if (m.t === 'leave') {
        leave(String(m.lobby), id, 'leave');
      } else if (m.t === 'data') {
        const L = lobbies.get(String(m.lobby));
        if (!L || L.owner !== id) return;
        L.data[m.key] = m.value;
        broadcast(String(m.lobby), id, { t: 'data', lobby: String(m.lobby), key: m.key, value: m.value });
      } else if (m.t === 'invite') {
        const L = lobbies.get(String(m.lobby));
        for (const [cid, c] of clients) {
          if (cid === id || (L && L.members.includes(cid))) continue;
          note(id, '发出邀请', { to: NAMES[cid === IDS.host ? 'host' : 'guest'] || cid });
          c.send({ t: 'invite', lobby: String(m.lobby), from: id });
        }
      } else if (m.t === 'send') {
        const key = `${id}>${m.to}`;
        const t = traffic[key] || (traffic[key] = { packets: 0, bytes: 0, lost: 0 });
        t.packets += 1;
        t.bytes += Math.round(m.data.length * 0.75);
        if (!clients.has(m.to)) {
          t.lost += 1;
          return;
        }
        const at = Math.max(lastDeliver.get(key) || 0, Date.now() + latencyMs + Math.round((Math.random() * 2 - 1) * jitterMs));
        lastDeliver.set(key, at);
        setTimeout(() => { const c = clients.get(m.to); if (c) c.send({ t: 'packet', from: id, data: m.data }); }, Math.max(0, at - Date.now()));
      } else if (m.t === 'note') {
        if (m.what === 'achievement') note(id, '解锁成就', { name: m.name });
      }
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port, events, traffic,
      close: () => new Promise((r) => { for (const c of clients.values()) c.sock.destroy(); server.close(() => r()); setTimeout(r, 2000); }),
    }));
  });
}

// ── 启动一个程序，读它的状态文件 ──
function launch(exe, dir, env, args = []) {
  resetDir(dir);
  const child = spawn(exe, args, { env: { ...process.env, MC_SMOKE_OUT: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const proc = { child, dir, exited: null, stderr: '' };
  child.stderr.on('data', (c) => { proc.stderr = (proc.stderr + c).slice(-4000); });
  child.stdout.on('data', () => {});
  child.on('exit', (code, signal) => { proc.exited = { code, signal, at: Date.now() }; });
  child.on('error', (err) => { proc.exited = { code: -1, error: String(err.message || err), at: Date.now() }; });
  return proc;
}
function readStatus(dir) {
  const file = path.join(dir, 'duo-status.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function readResult(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'duo-result.json'), 'utf8')); } catch { return null; }
}
const stepOf = (lines, name) => lines.find((l) => l.step === name);
const samplesOf = (lines) => lines.filter((l) => l.sample).map((l) => ({ at: l.at, ...l.sample }));
// 只看对局进行中的采样：一局打完后机器人会回到菜单，帧数归零
const inMatch = (list) => list.filter((s) => s.match);
const maxFrame = (list) => list.reduce((m, s) => Math.max(m, s.frame || 0), 0);
async function waitUntil(fn, ms, every = 300) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}
async function waitExit(proc, ms) {
  await waitUntil(() => proc.exited, ms, 200);
  if (!proc.exited) {
    try { proc.child.kill('SIGKILL'); } catch { /* 已退出 */ }
    await waitUntil(() => proc.exited, 5000, 200);
  }
}

// 两边在相同帧上的同步校验值是否一致（各自每 30 帧记一个）
function compareHashes(a, b, beforeAt = Infinity) {
  const map = new Map();
  for (const s of a) if (s.at <= beforeAt) for (const [f, h] of s.hashes || []) map.set(f, h);
  let compared = 0;
  const mismatch = [];
  const seen = new Set();
  for (const s of b) {
    if (s.at > beforeAt) continue;
    for (const [f, h] of s.hashes || []) {
      if (seen.has(f) || !map.has(f)) continue;
      seen.add(f);
      compared += 1;
      if (map.get(f) !== h) mismatch.push(f);
    }
  }
  return { compared, mismatch };
}
// 同一时刻两边的帧数差
function maxDrift(a, b, beforeAt = Infinity) {
  let worst = 0;
  for (const s of a) {
    if (s.at > beforeAt) continue;
    let near = null;
    for (const t of b) if (t.at <= beforeAt && (!near || Math.abs(t.at - s.at) < Math.abs(near.at - s.at))) near = t;
    if (near && Math.abs(near.at - s.at) < 700) worst = Math.max(worst, Math.abs(near.frame - s.frame));
  }
  return worst;
}

async function round(ctx, o) {
  const { exe, key, relay, cfg, name, mode, secs, tail, kill } = o;
  const base = path.join(PATHS.work, 'duo', name);
  const common = { MC_SMOKE_KEY: key, MC_FAKE_STEAM: String(relay.port), MC_DUO_SECS: String(secs), MC_DUO_MODE: mode, MC_DUO_ROUND: name, MC_DUO_SEED: String(cfg.seed) };
  const host = launch(exe, path.join(base, 'host'), { ...common, MC_DUO: 'host', MC_DUO_SLOT: '0', MC_DUO_TAIL: '0', MC_FAKE_STEAM_ID: IDS.host, MC_FAKE_STEAM_NAME: NAMES.host });
  let guest = null;
  if (mode === 'invite') {
    guest = launch(exe, path.join(base, 'guest'), { ...common, MC_DUO: 'guest', MC_DUO_SLOT: '1', MC_DUO_TAIL: String(tail), MC_FAKE_STEAM_ID: IDS.guest, MC_FAKE_STEAM_NAME: NAMES.guest });
  } else {
    const made = await waitUntil(() => stepOf(readStatus(host.dir), '建好房间') || stepOf(readStatus(host.dir), '跳过') || host.exited, 60000);
    const lobby = made && made.lobby;
    if (lobby) guest = launch(exe, path.join(base, 'guest'), { ...common, MC_DUO: 'guest', MC_DUO_SLOT: '1', MC_DUO_TAIL: String(tail), MC_FAKE_STEAM_ID: IDS.guest, MC_FAKE_STEAM_NAME: NAMES.guest }, ['+connect_lobby', lobby]);
  }
  let killedAt = null;
  if (guest && kill) {
    const started = await waitUntil(() => stepOf(readStatus(guest.dir), '开局') || guest.exited || host.exited, 120000);
    if (started && started.at) {
      await waitUntil(() => guest.exited, kill * 1000, 500);
      if (!guest.exited) {
        killedAt = Date.now();
        try { guest.child.kill('SIGKILL'); } catch { /* 已退出 */ }
        ctx.note(`第 ${name} 轮：开局第 ${kill} 秒强行关掉了加入者的程序（模拟掉线 / 崩溃）`);
      }
    }
  }
  const limit = (secs + tail + 200) * 1000;
  await Promise.all([waitExit(host, limit), guest ? waitExit(guest, limit) : null]);
  return {
    name, mode, killedAt,
    host: { lines: readStatus(host.dir), result: readResult(host.dir), exited: host.exited, stderr: host.stderr, dir: host.dir },
    guest: guest ? { lines: readStatus(guest.dir), result: readResult(guest.dir), exited: guest.exited, stderr: guest.stderr, dir: guest.dir } : null,
  };
}

// 判定一轮：失败项进 fail，值得注意的进 warn，其余写成说明
function judge(ctx, r, { secs, inputHz, label }) {
  const out = { label, checks: [] };
  const add = (ok, text, level = ok ? 'ok' : 'fail') => {
    out.checks.push({ level, text });
    if (level === 'fail') ctx.fail(`${label}：${text}`);
    else if (level === 'warn') ctx.warn(`${label}：${text}`);
    else ctx.note(`${label}：${text}`);
  };
  const H = r.host;
  const G = r.guest;
  if (!G) {
    add(false, `加入者没有启动（房主：${(H.result && (H.result.error || H.result.skipped)) || '没建好房间'}）`);
    return out;
  }
  for (const [who, side] of [['房主', H], ['加入者', G]]) {
    if (side.result && side.result.error && !(who === '加入者' && r.killedAt)) add(false, `${who}的测试中断：${side.result.error}`);
  }
  const made = stepOf(H.lines, '建好房间');
  const joined = stepOf(G.lines, '进入房间');
  if (!made) add(false, '房主没能建好房间');
  if (!joined) add(false, r.mode === 'invite' ? '加入者没有通过邀请进房' : '加入者带着房间号启动后没有进房');
  else {
    const from = r.mode === 'invite' ? stepOf(H.lines, '发出邀请') || made : made;
    const how = r.mode === 'invite' ? '收到邀请自动进房' : '程序被「从好友列表加入」的方式启动后直接进房';
    add(true, `${how}，从${r.mode === 'invite' ? '发出邀请' : '建好房间'}到进房 ${((joined.at - from.at) / 1000).toFixed(1)} 秒${joined.top === 'lobby' ? '，进房后显示了房间界面' : ''}`);
  }
  const hs = stepOf(H.lines, '开局');
  const gs = stepOf(G.lines, '开局');
  if (!hs || !gs) {
    add(false, `没能一起开局（房主${hs ? '已' : '未'}开局，加入者${gs ? '已' : '未'}开局）`);
    return out;
  }
  add(true, '两边一起进入对局');
  const hAll = samplesOf(H.lines);
  const gAll = samplesOf(G.lines);
  const hS = inMatch(hAll);
  const gS = inMatch(gAll);
  // 只判定对方离开之前的那段：第 1 轮是加入者被强退，第 2 轮是房主打完退出
  const cut = r.killedAt || (r.mode === 'launch' && H.exited ? H.exited.at : Infinity);
  const sync = compareHashes(hS, gS, cut);
  const desync = [...hS, ...gS].filter((s) => s.at <= cut).find((s) => s.desync !== null);
  if (desync || sync.mismatch.length) add(false, `两边算出的结果不一样（不同步）：${desync ? `第 ${desync.desync} 帧报告不同步` : ''}${sync.mismatch.length ? ` 校验值不同的帧 ${sync.mismatch.slice(0, 5).join('、')}` : ''}`);
  else if (sync.compared < 3) add(false, `可对比的同步校验值太少（${sync.compared} 个），对局可能没在走`);
  else add(true, `同步：对比了 ${sync.compared} 个时间点的校验值，两边完全一致`);
  const drift = maxDrift(hS, gS, cut);
  if (drift > inputHz * 2) add(false, `两边进度相差 ${drift} 帧（超过 2 秒），有一边被拖慢`);
  else add(true, `两边进度最多相差 ${drift} 帧（约 ${(drift / inputHz).toFixed(2)} 秒）`);
  const before = [...hS, ...gS].filter((s) => s.at <= cut);
  const stall = before.reduce((m, s) => Math.max(m, s.stalled || 0), 0);
  if (stall >= 3) add(false, `对局卡住过 ${stall.toFixed(1)} 秒`);
  else if (stall >= 1) add(true, `最长卡顿 ${stall.toFixed(1)} 秒（模拟网络延迟下）`, 'warn');
  else add(true, `没有明显卡顿（最长 ${stall.toFixed(1)} 秒）`);
  const reached = maxFrame(hS.filter((s) => s.at <= cut));
  const playedSecs = (Math.min(cut, hS.length ? hS[hS.length - 1].at : hs.at) - hs.at) / 1000;
  const expectFrames = Math.max(1, playedSecs) * inputHz;
  if (reached < expectFrames * 0.6) add(false, `对局只走到第 ${reached} 帧（这段时间正常约 ${Math.round(expectFrames)}）`);

  if (r.killedAt) {
    const after = hS.filter((s) => s.at > r.killedAt);
    const dropped = after.find((s) => (s.drops || []).length);
    if (!dropped) add(false, '加入者掉线后，房主一直没有把他移出（对局会一直等他）');
    else {
      add(true, `加入者掉线后 ${((dropped.at - r.killedAt) / 1000).toFixed(1)} 秒，房主把他移出了对局`);
      // 掉线到移出之间房主停在某一帧；移出后应越过它继续走（这一局可能紧接着就打完了，所以和移出那一刻一起算）
      const base = maxFrame([...hS.filter((s) => s.at <= r.killedAt), ...after.filter((s) => s.at < dropped.at)]);
      const tailS = after.filter((s) => s.at >= dropped.at);
      const moved = maxFrame(tailS) > base + inputHz / 2;
      const tailStall = tailS.reduce((m, s) => Math.max(m, s.stalled || 0), 0);
      if (!moved) add(false, '移出之后房主的对局没有继续往下走');
      else if (tailStall >= 3) add(false, `移出之后房主还卡了 ${tailStall.toFixed(1)} 秒`);
      else add(true, '移出之后房主一个人继续正常玩');
    }
  } else if (r.mode === 'launch') {
    // 房主退出：套件发出 host-left，游戏应告诉玩家并离开这一局，而不是一直等
    const hostGone = H.exited && H.exited.at;
    const atExit = hostGone ? gAll.filter((s) => s.at <= hostGone).pop() : null;
    const afterAll = hostGone ? gAll.filter((s) => s.at > hostGone) : [];
    if (hostGone && atExit && !atExit.match) add(true, '房主退出时这一局已经结束，对加入者没有影响');
    else if (hostGone && afterAll.length) {
      const left = afterAll.find((s) => !s.match);
      const stuck = afterAll.filter((s) => s.match).pop();
      if (left) add(true, `房主退出后 ${((left.at - hostGone) / 1000).toFixed(1)} 秒，加入者被告知并离开了这一局（${left.top === 'title' ? '回到标题' : `画面：${left.top}`}）`);
      else if (stuck && stuck.stalled > 2) add(true, `房主退出后，加入者一直停在等待画面（${stuck.stalled.toFixed(0)} 秒没有往下走）：游戏要处理 K.on('host-left')，告诉玩家并离开这一局`, 'warn');
      else add(true, '房主退出后，加入者的对局还在走');
    }
  }
  const errs = [...hAll, ...gAll].reduce((m, s) => Math.max(m, s.errors || 0), 0);
  const sample = [...hAll, ...gAll].map((s) => s.errorSample || []).flat().filter(Boolean);
  const consoleErr = [H, G].map((s) => (s.result && s.result.consoleErrors) || []).flat().filter((e) => /Uncaught|Error/.test(e.message));
  if (errs || consoleErr.length) add(false, `运行时报错：游戏记下 ${errs} 条${sample.length ? `（${[...new Set(sample)].slice(0, 3).join('；')}）` : ''}，脚本错误 ${consoleErr.length} 条${consoleErr.length ? `（${consoleErr.slice(0, 2).map((e) => e.message.slice(0, 100)).join('；')}）` : ''}`);
  else add(true, '两边都没有报错');
  const rejected = [H, G].map((s) => (s.result && s.result.steamCalls && s.result.steamCalls.rejected) || []).flat();
  if (rejected.length) add(false, `有 ${rejected.length} 次联机连接被拒绝（新成员的消息没被接受）`);
  out.facts = { sync, drift, stall, frames: reached };
  return out;
}

function judgeSelfcheck(ctx, r) {
  const label = '联机自检演练';
  const out = { label, checks: [] };
  const add = (ok, text, level = ok ? 'ok' : 'fail') => {
    out.checks.push({ level, text });
    if (level === 'fail') ctx.fail(`${label}：${text}`);
    else ctx.note(`${label}：${text}`);
  };
  for (const [who, side] of [['房主', r.host], ['加入者', r.guest]]) {
    if (!side) { add(false, `${who}没有启动`); continue; }
    const res = side.result || {};
    if (res.error) { add(false, `${who}：${res.error}`); continue; }
    const sc = res.selfcheck;
    if (!sc) { add(false, `${who}没有跑完联机自检`); continue; }
    if (sc.ok) add(true, `${who}的屏幕显示「联机自检通过」${sc.facts.length ? `：${sc.facts.join('；')}` : ''}`);
    else add(false, `${who}的联机自检没通过：${sc.problems.join('；')}`);
    const exported = path.join(side.dir, 'log-export.txt');
    if (!fs.existsSync(exported)) { add(false, `${who}的日志没有导出`); continue; }
    const summary = summarize(parseLog(fs.readFileSync(exported, 'utf8')));
    const verdict = (summary.selfcheck || []).find((c) => /联机自检(通过|没通过)/.test(c.msg));
    if (verdict) add(true, `${who}导出的日志里有自检结果，整理日志能读出来（${verdict.msg}）`);
    else add(false, `${who}导出的日志里读不到自检结果`);
  }
  return out;
}

export async function duoTest(ctx, cfg, packs, smokeKey) {
  const duo = { ...DUO_DEFAULTS, ...(cfg.duo || {}) };
  if (!duo.enabled) {
    ctx.skip('配置里关掉了两个客户端联机测试（duo.enabled）');
    return null;
  }
  const hostKey = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : null;
  const pack = packs.find((p) => p.target.key === hostKey);
  if (!pack) {
    ctx.skip(`这台电脑（${process.platform}）上没有可直接运行的版本，跳过联机测试`);
    return null;
  }
  const exe = executablePath(pack.target, cfg, pack.dir);
  const relay = await startRelay(duo);
  ctx.note(`本机假 Steam 已启动：消息延迟 ${duo.latencyMs}±${duo.jitterMs} 毫秒，「有人进房」通知晚 ${duo.lobbyDelayMs} 毫秒（两个游戏在后台无头运行，不弹窗口，约 ${Math.round((duo.seconds * 2 + 60) / 60)} 分钟）`);
  const outcome = { config: duo, rounds: [], relay: null, shots: [] };
  try {
    const r1 = await round(ctx, { exe, key: smokeKey, relay, cfg: { seed: 777 }, name: '1', mode: 'invite', secs: duo.seconds, tail: 0, kill: duo.leaveAt });
    const skipped = (r1.host.result && r1.host.result.skipped) || (r1.guest && r1.guest.result && r1.guest.result.skipped);
    if (skipped) {
      ctx.skip(`这款游戏测不了：${skipped}`);
      outcome.skipped = skipped;
      return outcome;
    }
    const inputHz = (r1.host.result && r1.host.result.caps && r1.host.result.caps.inputHz) || 30;
    outcome.rounds.push({ ...judge(ctx, r1, { secs: duo.seconds, inputHz, label: '邀请加入 + 中途掉线' }), raw: r1 });
    const short = Math.max(15, Math.round(duo.seconds * 0.6));
    const r2 = await round(ctx, { exe, key: smokeKey, relay, cfg: { seed: 778 }, name: '2', mode: 'launch', secs: short, tail: 12, kill: 0 });
    outcome.rounds.push({ ...judge(ctx, r2, { secs: short, inputHz, label: '从好友列表加入' }), raw: r2 });
    if (cfg.debugLog) {
      const r3 = await round(ctx, { exe, key: smokeKey, relay, cfg: { seed: 779 }, name: '3', mode: 'selfcheck', secs: 20, tail: 0, kill: 0 });
      outcome.rounds.push({ ...judgeSelfcheck(ctx, r3), raw: r3 });
    } else {
      ctx.note('正式版没有联机自检（只有测试版 debugLog: true 有），跳过演练');
    }
  } finally {
    await relay.close();
  }
  const ach = outcome.rounds.map((r) => [r.raw.host, r.raw.guest]).flat().filter(Boolean)
    .map((s) => (s.result && s.result.steamCalls && s.result.steamCalls.achievements) || []).flat();
  if (ach.length) ctx.note(`对局中游戏解锁了成就：${[...new Set(ach)].join('、')}（真 Steam 上要在 Steamworks 后台有同名成就）`);
  const traffic = Object.values(relay.traffic).reduce((a, t) => ({ packets: a.packets + t.packets, bytes: a.bytes + t.bytes }), { packets: 0, bytes: 0 });
  outcome.relay = { events: relay.events.slice(0, 200), traffic };
  ctx.note(`联机消息共 ${traffic.packets} 条，${Math.round(traffic.bytes / 1024)} KB`);
  for (const r of outcome.rounds) {
    // 直接收集目录里的截图：被强退的一方来不及写结果文件
    for (const side of [r.raw.host, r.raw.guest].filter(Boolean)) {
      for (const file of fs.existsSync(side.dir) ? fs.readdirSync(side.dir).filter((f) => /^duo-.*\.png$/.test(f)).sort() : []) {
        fs.copyFileSync(path.join(side.dir, file), path.join(PATHS.assets, file));
        outcome.shots.push(file);
      }
    }
  }
  ctx.note('测不到的部分：Valve 的服务器（真实建房、跨网络中继、覆盖层里的邀请界面）。用测试版（debugLog: true）在两台电脑、两个 Steam 账号上做「联机自检」');
  return outcome;
}
