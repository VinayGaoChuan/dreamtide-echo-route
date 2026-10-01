'use strict';
/* 梦潮：回声航线 — 多人联机：只同步操作 + 各端确定性模拟（帧同步，不发全量状态）。
   · 操作帧：30 帧 / 秒，每帧推进 4 个模拟步（1/120 秒）；本机操作晚 delay 帧生效，用来盖住网络延迟。
   · 传输：每端持续发布一份“在场状态”（最新的覆盖旧的，丢了下一份会补上），里面带着所有玩家最近收到的操作帧（互相转发，谁掉线了别人也能补齐）、
     自己收到了哪些帧、以及每秒一次的状态哈希。谁都可以发在场状态，不需要额外权限。
   · 转发层可换：Claude Artifact 房间（room 能力）/ 同一浏览器多窗口（BroadcastChannel，本地测试）/ 以后的 Steam 网络（同一套接口）。
   · 断线：房主（名单里最靠前、还在线的那位）等其他人收齐掉线者的操作后，宣布“从第 F 帧起移除”；所有端在同一帧移除那架飞机。 */

const LOCKSTEP = { hz: 30, steps: 4, delay: 4, window: 60, hashEvery: 30, goneAfter: 5000, dropGrace: 1500, runAhead: 30, catchUp: 4 };

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
    if (Array.isArray(msg.d)) for (const [j, F] of msg.d) if (this.drops[j] === undefined && j !== this.me) this.drops[j] = F;
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
  close() { try { this.room.presence({ mp: null }); } catch (e) { /* ignore */ } if (this.unsub) this.unsub(); this.subs = []; }
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
  close() { if (this.off) this.off(); if (this.bc) { this.bc.postMessage({ from: this.selfId, bye: true }); this.bc.close(); } this.subs = []; }
}

/* ---------- 大厅 + 一局联机的驱动 ---------- */
/* 每个人的在场状态 mp：{ code 房间号, host, name, plane, prof 局外属性, start 房主的开局单, ls 操作帧 }
   开局单里的名单顺序 = 玩家编号（房主第一个，其余按 peer 排），各端据此建出完全相同的世界。 */
const MP_MAX = 4;
function compactStats(st) { // 局外属性只带玩法用到的数，四舍五入，省在场状态的空间
  const o = {}; for (const k in st) if (k !== 'raw' && typeof st[k] === 'number') o[k] = Math.round(st[k] * 1e4) / 1e4; return o;
}
const Lobby = {
  net: null, code: null, isHost: false, roster: null, gameId: null, session: null, seenLs: new Map(), onUpdate: null, onStart: null,
  linger: null, lastFlush: 0, sessionAt: 0, connectedNow: null,
  async connect() {
    if (this.net) return this.net;
    let room = null;
    try { if (window.claude && typeof window.claude.use === 'function') room = await window.claude.use('room'); } catch (e) { room = null; }
    if (this.net) return this.net;
    this.net = room ? new RoomNet(room) : new LocalNet();
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
      r.members.push({ peer: p.peer, isMe: p.isMe, name: String(m.name || '玩家').slice(0, 12), plane: PLANES[m.plane] ? m.plane : 'moon', host: !!m.host, prof: m.prof || null, playing: !!(m.ls && m.ls.g) });
      if (m.host) { r.host = p.peer; r.started = !!m.start; r.stage = m.stage || null; }
      rooms.set(m.code, r);
    }
    for (const r of rooms.values()) r.members.sort((a, b) => (b.host - a.host) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
    return [...rooms.values()].filter((r) => r.host);
  },
  me(patch) { if (!this.net) return; this.net.presence({ mp: Object.assign({}, this.myMp(), patch) }); },
  create(profile) { this.code = Math.random().toString(36).slice(2, 6).toUpperCase(); this.isHost = true; this.me(Object.assign({ code: this.code, host: true, start: null, ls: null }, profile)); },
  join(code, profile) { this.code = code; this.isHost = false; this.me(Object.assign({ code, host: false, start: null, ls: null }, profile)); },
  leave() { this.session = null; this.linger = null; if (this.net) this.net.presence({ mp: null }); this.code = null; this.isHost = false; this.gameId = null; },
  room() { return this.openRooms().find((x) => x.code === this.code) || null; },
  members() { const r = this.room(); return r ? r.members : []; },
  /* 房主开局：把名单（含每人的局外属性）写进自己的在场状态，大家看到就各自开始 */
  start(stage, delay) {
    if (!this.isHost) return false;
    const ms = this.members().slice(0, MP_MAX); if (ms.length < 2) return false;
    const roster = ms.map((m) => ({ peer: m.peer, name: m.name, plane: m.plane, stats: (m.prof && m.prof.s) || null, ultCap: (m.prof && m.prof.u) || 1, cos: (m.prof && m.prof.c) || {} }));
    const id = Math.random().toString(36).slice(2, 8), seed = (Math.random() * 4294967296) >>> 0;
    this.me({ stage, start: { id, stage, seed, roster, delay: delay || (this.net.kind === 'room' ? 5 : 3) } });
    return true;
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
    const other = JSON.stringify(Object.assign({}, this.myMp(), { ls: null })).length;
    this.session = new LockstepSession({ selfIndex: idx, n: st.roster.length, delay: st.delay, isHost: this.isHost, budget: Math.max(600, 3800 - other - 200),
      send: (msg) => this.me({ ls: Object.assign({ g: st.id }, msg) }) });
    return idx;
  },
  /* 把别人在场状态里的操作帧喂给会话（同一份状态对象不重复处理；只认这一局的） */
  pump() {
    const S = this.session || this.linger; if (!S || !this.net) return;
    const connected = Array(this.roster.length).fill(false); connected[S.me] = true;
    const early = Date.now() - this.sessionAt < 8000; // 开局头几秒，慢一步进来的人还没发出这局的操作，先算在线
    for (const p of this.net.peers()) {
      if (p.isMe) continue;
      const j = this.roster.findIndex((x) => x.peer === p.peer); if (j < 0) continue;
      const m = p.presence && p.presence.mp; if (!m || m.code !== this.code) continue;
      const mine = m.ls && m.ls.g === this.gameId;
      if (mine || early) connected[j] = true;
      if (mine && this.seenLs.get(j) !== m.ls) { this.seenLs.set(j, m.ls); S.receive(j, m.ls); }
    }
    S.isHost = connected.findIndex((c, j) => c && S.drops[j] === undefined) === S.me; // 房主走了，名单里下一位接手
    S.hostCheckDrops(connected);
    this.connectedNow = connected;
  },
  /* 发布本机的操作帧；一局结束后再继续补发几秒，慢一步的队友还要用我最后那几帧 */
  flush(now) { const S = this.session || this.linger; if (!S) return; this.lastFlush = now; S.flush(); },
  tick(now) {
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
