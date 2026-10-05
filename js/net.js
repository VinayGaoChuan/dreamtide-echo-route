'use strict';
/* 梦潮：回声航线 — 多人联机：只同步操作 + 各端确定性模拟（帧同步，不发全量状态）。
   · 操作帧：30 帧 / 秒，每帧推进 4 个模拟步（1/120 秒）；本机操作晚 delay 帧生效，用来盖住网络延迟。
   · 传输：每端持续发布一份“在场状态”（最新的覆盖旧的，丢了下一份会补上），里面带着所有玩家最近收到的操作帧（互相转发，谁掉线了别人也能补齐）、
     自己收到了哪些帧、以及每秒一次的状态哈希。谁都可以发在场状态，不需要额外权限。
   · 转发层可换：自己的联机服务器（WebSocket，server/relay.js）/ Claude Artifact 房间（room 能力）/ 同一浏览器多窗口（BroadcastChannel，本地测试）/ 以后的 Steam 网络（同一套接口）。
   · 断线：房主（名单里最靠前、还在线的那位）等其他人收齐掉线者的操作后，宣布“从第 F 帧起移除”；所有端在同一帧移除那架飞机。 */

const LOCKSTEP = { hz: 30, steps: 4, delay: 4, window: 60, hashEvery: 30, goneAfter: 5000, dropGrace: 1500, runAhead: 30, catchUp: 4 };
const MP_PROTO = 2; // 2：操作帧单独放在 ls 字段，服务器只发变化的字段 // 联机协议 / 玩法版本：改了会影响同步的东西就加一，旧版本的客户端进不了同一个频道

/* ---------- 操作编码：一帧 5 个字符 ---------- */
const NetCodec = {
  A: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  q(v) { return clamp(Math.round((v || 0) * 8), -8, 8) + 8; }, // 左右 / 上下各 17 档
  encodeFrame(inp) {
    const A = this.A, fl = (inp.burst ? 1 : 0) | (inp.focus ? 2 : 0) | (inp.gone ? 4 : 0);
    return A[this.q(inp.mx)] + A[this.q(inp.my)] + A[fl] + A[clamp(Math.round(inp.dx || 0), -31, 31) + 32] + A[clamp(Math.round(inp.dy || 0), -31, 31) + 32];
  },
  decodeFrame(s) {
    const i = (c) => this.A.indexOf(c), fl = i(s[2]);
    return { mx: (i(s[0]) - 8) / 8, my: (i(s[1]) - 8) / 8, burst: !!(fl & 1), focus: !!(fl & 2), gone: !!(fl & 4), dx: i(s[3]) - 32, dy: i(s[4]) - 32 };
  },
  NEUTRAL: 'IIAgg', GONE: 'IIEgg',
};

/* ---------- 帧同步会话（与传输无关；send 由外面接到在场状态上） ---------- */
class LockstepSession {
  constructor(o) {
    this.me = o.selfIndex; this.n = o.n; this.delay = o.delay || LOCKSTEP.delay; this.send = o.send || (() => {});
    this.inputs = Array.from({ length: this.n }, () => []);
    for (let j = 0; j < this.n; j++) for (let f = 0; f < this.delay; f++) this.inputs[j][f] = NetCodec.NEUTRAL; // 开局前几帧大家都不动
    this.have = Array(this.n).fill(this.delay);   // 每个玩家：本机已连续收到的帧数
    this.peerAck = Array.from({ length: this.n }, () => null); // 别人报告的“我收到了谁的多少帧”
    this.heard = Array(this.n).fill(0); this.left = Array(this.n).fill(false);
    this.nextLocal = this.delay; this.simFrame = 0; this.drops = {}; this.lastHash = 0; this.hashLog = new Map(); this.desync = null; this.stallT = 0;
    this.trimmed = 0; this.budget = o.budget || 3000; // budget：一份在场状态里留给操作帧的字符数（平台上限 4 KiB）
    this.isHost = !!o.isHost; this.clock = o.clock || (() => Date.now());
  }
  /* 本机这一帧的操作：按真实时间每帧采一次（模拟卡住时也继续攒，最多领先 runAhead 帧，避免两边互相等成车队） */
  sample(inp) {
    if (this.nextLocal > this.simFrame + this.delay + LOCKSTEP.runAhead) return false;
    this.inputs[this.me][this.nextLocal++] = NetCodec.encodeFrame(inp);
    this.advanceHave(this.me);
    return true;
  }
  advanceHave(j) { const L = this.inputs[j]; let h = this.have[j]; while (L[h] !== undefined) h++; this.have[j] = h; }
  dropAt(j) { return this.drops[j] !== undefined ? this.drops[j] : Infinity; }
  ready(f) { for (let j = 0; j < this.n; j++) if (f < this.dropAt(j) && this.inputs[j][f] === undefined) return false; return true; }
  /* 下一帧所有人的操作（凑不齐就返回 null，等） */
  next() {
    const f = this.simFrame;
    if (!this.ready(f)) return null;
    const out = [];
    for (let j = 0; j < this.n; j++) out.push(NetCodec.decodeFrame(f >= this.dropAt(j) ? NetCodec.GONE : this.inputs[j][f]));
    this.simFrame++;
    return out;
  }
  waitingFor() { const f = this.simFrame, L = []; for (let j = 0; j < this.n; j++) if (f < this.dropAt(j) && this.inputs[j][f] === undefined) L.push(j); return L; }
  simulated(hash) {
    this.lastHash = hash; const f = this.simFrame;
    if (f % LOCKSTEP.hashEvery === 0) { this.hashLog.set(f, hash); if (this.hashLog.size > 40) this.hashLog.delete(this.hashLog.keys().next().value); }
  }
  /* 收到某个玩家发布的状态 */
  receive(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    this.heard[from] = this.clock(); this.left[from] = false;
    if (Array.isArray(msg.r)) for (const seg of msg.r) {
      if (!Array.isArray(seg) || seg.length !== 3) continue;
      const [j, start, str] = seg; if (!(j >= 0 && j < this.n) || typeof str !== 'string' || !(start >= 0)) continue;
      const L = this.inputs[j];
      for (let k = 0; k * 5 + 5 <= str.length; k++) if (L[start + k] === undefined) L[start + k] = str.substr(k * 5, 5);
      this.advanceHave(j);
    }
    if (Array.isArray(msg.a) && msg.a.length === this.n) this.peerAck[from] = msg.a.slice();
    if (Array.isArray(msg.h) && this.hashLog.has(msg.h[0]) && this.hashLog.get(msg.h[0]) !== msg.h[1] && !this.desync) this.desync = { frame: msg.h[0], mine: this.hashLog.get(msg.h[0]), theirs: msg.h[1], from };
    if (Array.isArray(msg.d)) for (const [j, F] of msg.d) { if (j === this.me) { if (this.kicked === undefined) this.kicked = F; } else if (this.drops[j] === undefined) this.drops[j] = F; } // 别人把我判成掉线了：本机这局也结束
  }
  /* 发布：所有人里还有谁缺哪些帧，就把那段帧带上（每人最多 window 帧） */
  flush(extra) {
    const seg = [];
    for (let j = 0; j < this.n; j++) {
      let start = this.have[j];
      for (let k = 0; k < this.n; k++) { if (k === this.me || this.drops[k] !== undefined) continue; const a = this.peerAck[k]; start = Math.min(start, a ? a[j] : 0); }
      start = Math.max(start, this.trimmed); // 从对方最早缺的那帧开始补（已清掉的旧帧所有人都早就收到了）
      if (start < this.have[j]) seg.push([j, start, Math.min(this.have[j], start + LOCKSTEP.window)]);
    }
    // 预算不够（4 人 + 网络很差）时每段少带几帧：先补最早缺的，下一份再补后面的
    let per = LOCKSTEP.window; const cost = () => seg.reduce((c, x) => c + Math.min(x[2] - x[1], per) * 5 + 16, 0);
    while (per > 8 && cost() > this.budget) per = Math.floor(per * 0.75);
    const r = seg.map(([j, a, b]) => [j, a, this.inputs[j].slice(a, Math.min(b, a + per)).join('')]);
    const last = [...this.hashLog.keys()].pop();
    const msg = Object.assign({ r, a: this.have.slice(), h: last !== undefined ? [last, this.hashLog.get(last)] : null }, extra || {});
    if (Object.keys(this.drops).length) msg.d = Object.entries(this.drops).map(([j, F]) => [+j, F]); // 已定下的移除大家都转发，房主走了也不会丢
    this.send(msg);
    this.trimOld();
  }
  trimOld() { // 远早于当前帧的旧操作所有人都已经用过了，清掉省内存
    const keep = this.simFrame - LOCKSTEP.window * 3;
    if (keep - this.trimmed < 64) return;
    for (const L of this.inputs) for (let f = this.trimmed; f < keep; f++) if (L[f] !== undefined) L[f] = '';
    this.trimmed = keep;
  }
  /* 房主：有人断线 → 等其他人把他的操作都收齐，再定下“从第几帧起移除” */
  hostCheckDrops(connected) {
    if (!this.isHost) return;
    const now = this.clock();
    for (let j = 0; j < this.n; j++) {
      if (j === this.me || this.drops[j] !== undefined || connected[j]) continue;
      if (!this.left[j]) { this.left[j] = now; continue; }
      if (now - this.left[j] < LOCKSTEP.dropGrace) continue;
      let F = this.have[j];
      for (let k = 0; k < this.n; k++) if (k !== j && connected[k] && this.peerAck[k]) F = Math.max(F, this.peerAck[k][j]);
      this.drops[j] = F;
    }
  }
}

/* ---------- 后台计时：标签页切到后台时浏览器会把主线程定时器降到 1 秒一次，联机会让队友干等；Worker 里的定时器不受影响 ---------- */
const NetTicker = {
  subs: [], worker: null, timer: null,
  on(fn) { this.subs.push(fn); return () => { this.subs = this.subs.filter((f) => f !== fn); }; }, // 进联机才 start()，单人游戏不开 Worker
  fire() { const now = performance.now(); for (const fn of this.subs.slice()) { try { fn(now); } catch (e) { console.error('[联机] tick', e); } } },
  start() {
    if (this.worker || this.timer) return;
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},25)'], { type: 'text/javascript' }));
      this.worker = new Worker(url); this.worker.onmessage = () => this.fire();
    } catch (e) { this.worker = null; this.timer = setInterval(() => this.fire(), 25); }
  },
};

/* ---------- 传输层：统一成“在场状态”接口 ---------- */
/* Claude Artifact 房间：presence 由平台合并发送（约 30 次 / 秒），只保留最新；peer 是每个打开的页面的标签 */
class RoomNet {
  constructor(room) { this.kind = 'room'; this.room = room; this.subs = []; this.selfId = null; this.unsub = room.onPeers((ch) => { const me = ch.peers.find((p) => p.isMe && p.sameTab); if (me) this.selfId = me.peer; for (const fn of this.subs) fn(); }, () => {}); }
  peers() { return this.room.peers().map((p) => ({ peer: p.peer, isMe: p.isMe && p.sameTab, presence: p.presence || {}, updatedAt: p.updatedAt })); }
  presence(patch) { return this.room.presence(patch).catch(() => {}); }
  onChange(fn) { this.subs.push(fn); }
  connected() { return this.room.connected(); }
  close() { try { this.room.presence({ mp: null, ls: null }); } catch (e) { /* ignore */ } if (this.unsub) this.unsub(); this.subs = []; }
}
/* 自己的联机服务器（server/relay.js）：WebSocket 连接，服务器约 30 次 / 秒推送别人的最新在场状态；断线自动重连，身份不变 */
class WsNet {
  constructor(url, ch) {
    this.kind = 'ws'; this.url = url; this.ch = ch; this.subs = []; this.others = new Map(); this.me = {}; this.pending = null;
    this.selfId = 'W' + Math.random().toString(36).slice(2, 12); this.open = false; this.closed = false; this.retry = 0; this.rtt = null; this.sentAt = 0; this.pingAt = 0;
    this.clock = []; this.clockOff = null; // 对时：最近几次 ping 里延迟最小的那次最准
    this.off = NetTicker.on((now) => this.tick(now));
    this.dial();
  }
  dial() {
    if (this.closed) return;
    let ws; try { ws = new WebSocket(this.url); } catch (e) { this.redial(); return; }
    this.ws = ws;
    ws.onopen = () => { this.open = true; this.retry = 0; ws.send(JSON.stringify({ t: 'hello', id: this.selfId, ch: this.ch })); this.pingAt = 0; if (Object.keys(this.me).length) this.pending = Object.assign({}, this.me); this.emit(); };
    ws.onmessage = (ev) => this.onMsg(ev.data);
    ws.onclose = () => { const was = this.open; this.open = false; this.ws = null; if (was) { this.others.clear(); this.emit(); } this.redial(); };
    ws.onerror = () => {};
  }
  redial() { if (this.closed) return; this.retry++; setTimeout(() => this.dial(), Math.min(5000, 300 * this.retry)); }
  onMsg(text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    const put = (q) => { // 完整状态（p）或只有变化的字段（d，null 表示删掉）
      if (q.p) { this.others.set(q.peer, { presence: Object.freeze(q.p), updatedAt: Date.now() }); return; }
      const cur = this.others.get(q.peer), pres = Object.assign({}, cur ? cur.presence : {});
      for (const k in q.d || {}) { if (q.d[k] === null) delete pres[k]; else pres[k] = q.d[k]; }
      this.others.set(q.peer, { presence: Object.freeze(pres), updatedAt: Date.now() });
    };
    if (m.t === 'hi') { this.selfId = m.you || this.selfId; this.serverBuild = m.build || null; this.others.clear(); (m.peers || []).forEach(put); this.emit(); }
    else if (m.t === 'u') { (m.peers || []).forEach(put); this.emit(); }
    else if (m.t === 'bye') { this.others.delete(m.peer); this.emit(); }
    else if (m.t === 'pong') {
      const now = performance.now(), rtt = now - m.c; this.rtt = Math.round(rtt);
      this.rtts = (this.rtts || []).concat(rtt).slice(-6); this.rttHi = Math.round(Math.max(...this.rtts)); // 最近几次里最慢的：留出抖动的余量
      if (m.s) { this.clock.push({ rtt, off: m.s + rtt / 2 - now }); if (this.clock.length > 8) this.clock.shift(); this.clockOff = this.clock.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off; }
    }
  }
  serverNow() { return this.clockOff === null ? null : performance.now() + this.clockOff; } // 服务器时钟（毫秒）
  stale() { return !!(this.serverBuild && window.DREAMTIDE_BUILD && this.serverBuild !== window.DREAMTIDE_BUILD); } // 服务器上已经是新版本了
  localPerfOf(ms) { return ms - this.clockOff; }
  tick(now) {
    if (!this.open || !this.ws) return;
    this.sendPending(now);
    if (now - this.pingAt > (this.clock.length < 4 ? 400 : 1000)) { this.pingAt = now; this.ws.send(JSON.stringify({ t: 'ping', c: now })); } // 刚连上时多测几次
  }
  emit() { for (const fn of this.subs) fn(); }
  peers() { return [{ peer: this.selfId, isMe: true, presence: this.me, updatedAt: Date.now() }, ...[...this.others].map(([peer, p]) => ({ peer, isMe: false, presence: p.presence, updatedAt: p.updatedAt }))]; }
  presence(patch) {
    const m = Object.assign({}, this.me); for (const k in patch) { if (patch[k] === null) delete m[k]; else m[k] = patch[k]; } this.me = m;
    this.pending = Object.assign(this.pending || {}, patch); this.sendPending(performance.now()); return Promise.resolve();
  }
  /* 有新状态马上发（两次之间至少隔 16 毫秒，没赶上的由计时器补发）：操作帧早一点到，所有人的操作延迟就短一点 */
  sendPending(now) { if (this.pending && this.open && this.ws && now - this.sentAt >= 16) { this.ws.send(JSON.stringify({ t: 'p', d: this.pending })); this.pending = null; this.sentAt = now; } }
  onChange(fn) { this.subs.push(fn); }
  connected() { return this.open; }
  close() { this.closed = true; if (this.off) this.off(); if (this.ws) try { this.ws.close(); } catch (e) { /* ignore */ } this.subs = []; }
}
/* 联机服务器地址：网页由服务器提供时，服务器会写入 window.DREAMTIDE_WS（同源 /mp）；测试时也可以用 ?mp=ws://主机:端口/mp 指定 */
function mpServerUrl() {
  let u = null; try { u = new URLSearchParams(location.search).get('mp'); } catch (e) { u = null; }
  u = u || (typeof window !== 'undefined' && window.DREAMTIDE_WS) || null; if (!u) return null;
  if (u.charAt(0) === '/') u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + u;
  return /^wss?:\/\//.test(u) ? u : null;
}

/* 同一浏览器的多个窗口 / 标签页（本地测试和 GitHub Pages 用）：BroadcastChannel 模拟同样的在场语义 */
class LocalNet {
  constructor(name = 'dreamtide-mp') {
    this.kind = 'local'; this.selfId = 'L' + Math.random().toString(36).slice(2, 10); this.me = {}; this.others = new Map(); this.subs = []; this.dirty = false;
    this.bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
    if (this.bc) this.bc.onmessage = (ev) => { const m = ev.data; if (!m || m.from === this.selfId) return; if (m.bye) this.others.delete(m.from); else this.others.set(m.from, { presence: Object.freeze(m.presence || {}), updatedAt: Date.now() }); this.emit(); };
    this.lastTick = 0; this.off = NetTicker.on(() => { const t = Date.now(); if (t - this.lastTick >= 30) { this.lastTick = t; this.tick(); } });
  }
  tick() {
    const now = Date.now(); let changed = false;
    for (const [id, p] of this.others) if (now - p.updatedAt > LOCKSTEP.goneAfter) { this.others.delete(id); changed = true; }
    if (this.bc && (this.dirty || now - (this.sentAt || 0) > 1000)) { this.bc.postMessage({ from: this.selfId, presence: this.me }); this.sentAt = now; this.dirty = false; }
    if (changed) this.emit();
  }
  emit() { for (const fn of this.subs) fn(); }
  peers() { return [{ peer: this.selfId, isMe: true, presence: this.me, updatedAt: Date.now() }, ...[...this.others].map(([peer, p]) => ({ peer, isMe: false, presence: p.presence, updatedAt: p.updatedAt }))]; }
  presence(patch) { const m = Object.assign({}, this.me); for (const k in patch) { if (patch[k] === null) delete m[k]; else m[k] = patch[k]; } this.me = m; this.dirty = true; return Promise.resolve(); }
  onChange(fn) { this.subs.push(fn); }
  connected() { return !!this.bc; }
  serverNow() { return Date.now(); } // 同一台电脑：墙上时钟就是共同时钟
  localPerfOf(ms) { return performance.now() + (ms - Date.now()); }
  close() { if (this.off) this.off(); if (this.bc) { this.bc.postMessage({ from: this.selfId, bye: true }); this.bc.close(); } this.subs = []; }
}

/* ---------- 联机主循环的核心（网页 main.js 和无头联机测试 tools/net-bot.js 共用同一份） ----------
   按真实时间推进；本机每 1/30 秒采一帧操作（提前量由自适应缓冲决定），凑齐所有人的这一帧才往下模拟；
   每个操作帧 = 4 个模拟步，只在帧的第一步换上新操作；最后算出本机飞机的显示预测（只给画面用）。 */
const MpDriver = {
  tick(w, L, S, now, inputFn) {
    const dt = Math.min(0.25, Math.max(0, (now - L.last) / 1000)); L.last = now;
    const el = (now - L.t0) / 1000, FR = LOCKSTEP.hz, SP = LOCKSTEP.steps;
    const lead = Lobby.leadFrames(now) || S.delay;
    while (S.nextLocal <= Math.floor(el * FR) + lead) { if (!S.sample(inputFn(L))) break; Lobby.unsent = true; }
    Lobby.pump(); const gap = now - Lobby.lastFlush; if ((Lobby.unsent && gap >= 16) || gap >= 50) Lobby.flush(now); // 采到新操作马上发；没有新操作时也定期发（回执 / 哈希）
    const target = Math.floor(el * FR * SP), behind = target - L.steps;
    let budget = (behind > FR * SP * 2 ? LOCKSTEP.catchUp * 3 : LOCKSTEP.catchUp) * SP, stalled = false;
    while (L.steps < target && budget-- > 0 && !w.done) {
      if (L.steps % SP === 0) { const ins = S.next(); if (!ins) { stalled = true; break; } for (let j = 0; j < ins.length; j++) w.setInput(j, ins[j]); }
      w.step(1 / 120); L.steps++;
      if (L.steps % SP === 0 && S.simFrame % LOCKSTEP.hashEvery === 0) S.simulated(w.stateHash());
    }
    L.waitT = stalled ? L.waitT + dt : 0;
    if (stalled) L.stallTicks = (L.stallTicks || 0) + 1; L.ticks = (L.ticks || 0) + 1;
    // 本机飞机的显示预测：已经发出、还没轮到模拟的操作先在画面上走完（只改画面，模拟里的位置不变）
    const me = w.me; let ox = 0, oy = 0;
    if (me && me.alive && w.state === 'play' && !(me.ritual && me.ritual.st !== 'choose' && me.ritual.st !== 'resume')) {
      const spd = 400 * me.P.speed, cx = (v) => clamp(v, 34, w.W * 0.82), cy = (v) => clamp(v, w.arena.top + 14, w.arena.bottom - 14);
      let x = me.x, y = me.y; const rem = (SP - (L.steps % SP)) % SP, cur = w.inputs[me.idx];
      if (rem && cur) { const s = (spd * (cur.focus ? 0.5 : 1) * rem) / (FR * SP); x = cx(x + cur.mx * s); y = cy(y + cur.my * s); }
      for (let f = S.simFrame; f < S.nextLocal; f++) { const raw = S.inputs[S.me][f]; if (!raw) continue; const I = NetCodec.decodeFrame(raw), s = (spd * (I.focus ? 0.5 : 1)) / FR; x = cx(x + I.mx * s + I.dx); y = cy(y + I.my * s + I.dy); }
      ox = x - me.x; oy = y - me.y;
    }
    w.viewOff = { x: ox, y: oy };
    return stalled;
  },
};

/* ---------- 大厅 + 一局联机的驱动 ---------- */
/* 每个人的在场状态 mp：{ code 房间号, host, name, plane, prof 局外属性, start 房主的开局单, ls 操作帧 }
   开局单里的名单顺序 = 玩家编号（房主第一个，其余按 peer 排），各端据此建出完全相同的世界。 */
const MP_MAX = 4;
function compactStats(st) { // 局外属性只带玩法用到的数，四舍五入，省在场状态的空间
  const o = {}; for (const k in st) if (k !== 'raw' && typeof st[k] === 'number') o[k] = Math.round(st[k] * 1e4) / 1e4; return o;
}
const Lobby = {
  net: null, code: null, isHost: false, roster: null, gameId: null, session: null, seenLs: new Map(), onUpdate: null, onStart: null,
  linger: null, lastFlush: 0, unsent: false, sessionAt: 0, connectedNow: null,
  async connect() {
    if (this.net) return this.net;
    const ws = mpServerUrl(); // 优先自己的联机服务器
    let room = null;
    if (!ws) try { if (window.claude && typeof window.claude.use === 'function') room = await window.claude.use('room'); } catch (e) { room = null; }
    if (this.net) return this.net;
    this.net = ws ? new WsNet(ws, `dreamtide-${MP_PROTO}-${window.DREAMTIDE_BUILD || 'dev'}`) : room ? new RoomNet(room) : new LocalNet();
    this.net.onChange(() => this.changed());
    NetTicker.on((now) => this.tick(now)); NetTicker.start();
    return this.net;
  },
  selfId() { return this.net && this.net.selfId; },
  myMp() { const me = this.net && this.net.peers().find((p) => p.isMe); return (me && me.presence && me.presence.mp) || {}; },
  /* 大厅里能看到的房间：每个人的在场状态里写着自己在哪个房间 */
  openRooms() {
    if (!this.net) return [];
    const rooms = new Map();
    for (const p of this.net.peers()) {
      const m = p.presence && p.presence.mp; if (!m || typeof m.code !== 'string') continue;
      const r = rooms.get(m.code) || { code: m.code, members: [], host: null, started: false, stage: null };
      const ls = p.presence.ls;
      r.members.push({ peer: p.peer, isMe: p.isMe, name: String(m.name || '玩家').slice(0, 12), plane: PLANES[m.plane] ? m.plane : 'moon', host: !!m.host, prof: m.prof || null, playing: !!(ls && ls.g), rtt: typeof m.rtt === 'number' ? m.rtt : null });
      if (m.host) { r.host = p.peer; r.started = !!m.start; r.stage = m.stage || null; }
      rooms.set(m.code, r);
    }
    for (const r of rooms.values()) r.members.sort((a, b) => (b.host - a.host) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
    return [...rooms.values()].filter((r) => r.host);
  },
  me(patch) { if (!this.net) return; this.net.presence({ mp: Object.assign({}, this.myMp(), patch) }); },
  create(profile) { this.code = Math.random().toString(36).slice(2, 6).toUpperCase(); this.isHost = true; this.me(Object.assign({ code: this.code, host: true, start: null }, profile)); this.net.presence({ ls: null }); },
  join(code, profile) { this.code = code; this.isHost = false; this.me(Object.assign({ code, host: false, start: null }, profile)); this.net.presence({ ls: null }); },
  leave() { this.session = null; this.linger = null; if (this.net) this.net.presence({ mp: null, ls: null }); this.code = null; this.isHost = false; this.gameId = null; },
  room() { return this.openRooms().find((x) => x.code === this.code) || null; },
  members() { const r = this.room(); return r ? r.members : []; },
  /* 房主开局：把名单（含每人的局外属性）写进自己的在场状态，大家看到就各自开始 */
  start(stage, delay) {
    if (!this.isHost) return false;
    const ms = this.members().slice(0, MP_MAX); if (ms.length < 2) return false;
    const roster = ms.map((m) => ({ peer: m.peer, name: m.name, plane: m.plane, stats: (m.prof && m.prof.s) || null, ultCap: (m.prof && m.prof.u) || 1, cos: (m.prof && m.prof.c) || {} }));
    const id = Math.random().toString(36).slice(2, 8), seed = (Math.random() * 4294967296) >>> 0;
    const now = this.net.serverNow ? this.net.serverNow() : null, at = now === null ? null : Math.round(now + 900); // 约 0.9 秒后大家在同一刻开局
    this.me({ stage, start: { id, stage, seed, roster, at, delay: delay || this.autoDelay(ms), world: this.mergeWorld(ms) } }); // 家园改变的世界状态：合并房间里每个人的（写进开局单，各端一致）
    this.changed(); // 房主自己马上开局（不用等服务器把自己的状态转回来）
    return true;
  },
  /* 联机补全 v0.10：地图上的世界状态由全房间一起决定——
     谁修好了风道，大家都能走上层云桥；每个人当前要救的伙伴都会出现（需要的人多的先来，救完一位下一位跟着来）；NPC 职责带来的好处全队共享。 */
  mergeWorld(ms) {
    const ws = ms.map((x) => (x.prof && x.prof.w) || {}), cnt = {};
    for (const w of ws) if (w.target) cnt[w.target] = (cnt[w.target] || 0) + 1;
    const upper = ws.some((w) => w.upper);
    const targets = Object.keys(cnt).filter((t) => NPCS[t] && (t !== 'merchant' || upper)).sort((a, b) => cnt[b] - cnt[a] || NPC_ORDER.indexOf(a) - NPC_ORDER.indexOf(b));
    const rescued = NPC_ORDER.filter((id) => ws.length && ws.every((w) => Array.isArray(w.rescued) && w.rescued.includes(id)));
    return { upper, targets, target: targets[0] || null, rescued, clue: ws.some((w) => w.clue), beacon: ws.some((w) => w.beacon), scout: ws.some((w) => w.scout) };
  },
  /* 自动缓冲：操作从一人经服务器到另一人 ≈ 两人往返延迟的一半之和 + 服务器 / 客户端合并发送的时间；取最慢的两个人 */
  autoDelay(ms) {
    if (this.net.kind === 'room') return 5;
    const r = (ms || this.members()).map((m) => (m.isMe ? this.net.rtt : m.rtt) || 0).sort((a, b) => b - a);
    return clamp(Math.ceil((((r[0] || 0) + (r[1] || 0)) / 2 + 70) / (1000 / LOCKSTEP.hz)) + 1, 3, 12);
  },
  hostStart() { const r = this.room(); if (!r) return null; const host = this.net.peers().find((p) => p.peer === r.host); return (host && host.presence.mp && host.presence.mp.start) || null; },
  changed() {
    const st = this.code ? this.hostStart() : null;
    if (st && st.id !== this.gameId && Array.isArray(st.roster) && st.roster.some((x) => x.peer === this.selfId()) && this.onStart) { if (this.onStart(st) !== false) this.gameId = st.id; } // 还在上一局收尾就等下次再接
    if (this.session) this.pump();
    if (this.onUpdate) this.onUpdate();
  },
  beginSession(st) {
    const idx = st.roster.findIndex((x) => x.peer === this.selfId());
    if (idx < 0) return -1;
    this.roster = st.roster; this.seenLs = new Map(); this.gameId = st.id; this.linger = null; this.sessionAt = Date.now();
    // 操作帧的预算：4 KiB 减去在场状态里其他字段（房主还带着开局单）
    const other = JSON.stringify({ mp: this.myMp() }).length;
    this.peerRtt = []; this.lead = null; this.leadAt = 0;
    this.session = new LockstepSession({ selfIndex: idx, n: st.roster.length, delay: st.delay, isHost: this.isHost, budget: Math.max(600, 3800 - other - 220),
      send: (msg) => this.net.presence({ ls: Object.assign({ g: st.id, rt: this.myRtt() }, msg) }) }); // 操作帧单独一个字段：服务器只转发变化，资料不重发
    return idx;
  },
  /* 把别人在场状态里的操作帧喂给会话（同一份状态对象不重复处理；只认这一局的） */
  pump() {
    const S = this.session || this.linger; if (!S || !this.net) return;
    if (!this.net.connected()) return; // 自己掉线时别人看起来都“不在了”：这时不能判谁掉线，等重连
    const connected = Array(this.roster.length).fill(false); connected[S.me] = true;
    const early = Date.now() - this.sessionAt < 8000; // 开局头几秒，慢一步进来的人还没发出这局的操作，先算在线
    for (const p of this.net.peers()) {
      if (p.isMe) continue;
      const j = this.roster.findIndex((x) => x.peer === p.peer); if (j < 0) continue;
      const m = p.presence && p.presence.mp; if (!m || m.code !== this.code) continue;
      const ls = p.presence.ls, mine = ls && ls.g === this.gameId;
      if (mine || early) connected[j] = true;
      if (mine && this.seenLs.get(j) !== ls) { this.seenLs.set(j, ls); S.receive(j, ls); if (typeof ls.rt === 'number') this.peerRtt[j] = ls.rt; }
    }
    S.isHost = connected.findIndex((c, j) => c && S.drops[j] === undefined) === S.me; // 房主走了，名单里下一位接手
    S.hostCheckDrops(connected);
    this.connectedNow = connected;
  },
  myRtt() { const n = this.net; return n ? Math.round(n.rttHi || n.rtt || 0) : 0; },
  /* 本机操作提前多少帧发出（自适应缓冲）：按“我的延迟 + 最慢队友的延迟”实时估算操作经服务器到对方要多久。
     变慢马上加长，变快每 2 秒才缩短一帧，避免来回抖；只改操作发出的早晚，不改操作内容，所以不影响同步。 */
  leadFrames(now) {
    const S = this.session; if (!S) return 0;
    if (!this.net || this.net.kind !== 'ws') return S.delay;
    let other = 0; for (let j = 0; j < S.n; j++) if (j !== S.me && S.drops[j] === undefined && this.connectedNow && this.connectedNow[j]) other = Math.max(other, this.peerRtt[j] || 0);
    const want = clamp(Math.ceil(((this.myRtt() + other) / 2 + 70) / (1000 / LOCKSTEP.hz)) + 1, 3, 20);
    if (this.lead === null || want > this.lead) this.lead = Math.max(want, this.lead === null ? S.delay : this.lead);
    else if (want < this.lead && now - this.leadAt > 2000) { this.lead--; this.leadAt = now; }
    if (want >= this.lead) this.leadAt = now;
    return this.lead;
  },
  /* 发布本机的操作帧；一局结束后再继续补发几秒，慢一步的队友还要用我最后那几帧 */
  flush(now) { const S = this.session || this.linger; if (!S) return; this.lastFlush = now; this.unsent = false; S.flush(); },
  tick(now) {
    if (this.code && !this.session && this.net && typeof this.net.rtt === 'number' && now - (this.rttAt || 0) > 2000) { // 在房间里：把自己的延迟告诉房主，用来定缓冲
      this.rttAt = now; const cur = this.myMp().rtt; if (typeof cur !== 'number' || Math.abs(cur - this.net.rtt) > 8) this.me({ rtt: this.net.rtt });
    }
    if (this.linger) {
      if (Date.now() > this.lingerUntil) { this.linger = null; return; }
      if (now - this.lastFlush > 100) { this.pump(); this.flush(now); }
    }
  },
  endGame() {
    if (this.session) { this.linger = this.session; this.lingerUntil = Date.now() + 8000; }
    this.session = null;
    if (this.net && this.code && this.isHost) this.me({ start: null });
  },
};
