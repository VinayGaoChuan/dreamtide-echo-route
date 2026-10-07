'use strict';
/* 梦潮：回声航线 — 多人联机：只同步操作 + 各端确定性模拟（帧同步，不发全量状态）。
   · 操作帧：30 帧 / 秒，每帧推进 4 个模拟步（1/120 秒）；本机操作晚 delay 帧生效，用来盖住网络延迟。
   · 传输：每端持续发布一份“在场状态”（最新的覆盖旧的，丢了下一份会补上），里面带着所有玩家最近收到的操作帧（互相转发，谁掉线了别人也能补齐）、
     自己收到了哪些帧、以及每秒一次的状态哈希。谁都可以发在场状态，不需要额外权限。
   · 转发层可换：自己的联机服务器（WebSocket，server/relay.js）/ Claude Artifact 房间（room 能力）/ 同一浏览器多窗口（BroadcastChannel，本地测试）/ 以后的 Steam 网络（同一套接口）。
   · 断线（v0.11 §8 保留席位）：房主（名单里最靠前、还在线的那位）宣布“从第 F 帧起这位断线中”——所有端从同一帧起把他的操作当成“断线占位”
     （飞机原地不动、不开火、不受伤、不拖住全队升级），其他人继续打。60 秒内他回来：先按大家认定的操作记录追上（必要时从开局重算一遍），
     再发“准备好了”，房主宣布“从第 R 帧起恢复”；超过 60 秒才宣布“从第 G 帧起移除”。所有决定都写进在场状态、谁都转发，房主走了也不丢。 */

const LOCKSTEP = { hz: 30, steps: 4, delay: 4, window: 60, hashEvery: 30, goneAfter: 5000, dropGrace: 1500, silentAfter: 2500, runAhead: 30, catchUp: 4, seat: 60000, backLead: 45, dropLead: 90, lagWindow: 240, lagEvery: 100 };
const SS_ID = 'dreamtide.mp.id', SS_ROOM = 'dreamtide.mp.room'; // 本标签页的联机身份和所在房间（刷新后回到原对局）
function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function ssSet(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* 隐私模式等：只是不能刷新回来 */ } }
const MP_PROTO = 6; // 6：合作三关连成一局（chain）；5：开局带梦魇级数（ladder）； 4：刷新回到原对局（rj）、准备确认；3：断线保留席位（断线区间 w / 恢复请求 ry / 断线占位操作）；2：操作帧单独放在 ls 字段，服务器只发变化的字段 // 联机协议 / 玩法版本：改了会影响同步的东西就加一，旧版本的客户端进不了同一个频道

/* ---------- 操作编码：一帧 5 个字符 ---------- */
const NetCodec = {
  A: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  q(v) { return clamp(Math.round((v || 0) * 8), -8, 8) + 8; }, // 左右 / 上下各 17 档
  encodeFrame(inp) {
    const A = this.A, fl = (inp.burst ? 1 : 0) | (inp.focus ? 2 : 0) | (inp.gone ? 4 : 0) | (inp.away ? 8 : 0);
    return A[this.q(inp.mx)] + A[this.q(inp.my)] + A[fl] + A[clamp(Math.round(inp.dx || 0), -31, 31) + 32] + A[clamp(Math.round(inp.dy || 0), -31, 31) + 32];
  },
  decodeFrame(s) {
    const i = (c) => this.A.indexOf(c), fl = i(s[2]);
    return { mx: (i(s[0]) - 8) / 8, my: (i(s[1]) - 8) / 8, burst: !!(fl & 1), focus: !!(fl & 2), gone: !!(fl & 4), away: !!(fl & 8), dx: i(s[3]) - 32, dy: i(s[4]) - 32 };
  },
  NEUTRAL: 'IIAgg', GONE: 'IIEgg', AWAY: 'IIIgg',
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
    this.aways = Array.from({ length: this.n }, () => []); // 每个玩家的断线区间 [F, R)，R 未定时是 Infinity
    this.awayAt = Array(this.n).fill(0); this.backReq = Array(this.n).fill(undefined); this.ready = null; // ready：本机断线回来后“从第几帧起可以恢复”
    this.pipe = []; this.lagAt = 0; // 给落后的人补帧的流水线进度
    this.rejoining = !!o.rejoin; this.rejoinReq = Array(this.n).fill(false); // 刷新页面回来：先不发新操作，等大家把我判成断线中、追上后再恢复
    this.isHost = !!o.isHost; this.clock = o.clock || (() => Date.now());
  }
  /* 本机这一帧的操作：按真实时间每帧采一次（模拟卡住时也继续攒，最多领先 runAhead 帧，避免两边互相等成车队） */
  sample(inp) {
    if (this.rejoining) return false; // 刷新回来：旧的操作由队友补发回来，新操作要等宣布恢复的那一帧
    if (this.nextLocal > this.simFrame + this.delay + LOCKSTEP.runAhead) return false;
    this.inputs[this.me][this.nextLocal++] = NetCodec.encodeFrame(inp);
    this.advanceHave(this.me);
    return true;
  }
  advanceHave(j) { const L = this.inputs[j]; let h = this.have[j]; while (L[h] !== undefined) h++; this.have[j] = h; }
  dropAt(j) { return this.drops[j] !== undefined ? this.drops[j] : Infinity; }
  isAway(j, f) { for (const r of this.aways[j]) if (f >= r[0] && f < r[1]) return true; return false; }
  openAway(j) { const L = this.aways[j]; return L.length && L[L.length - 1][1] === Infinity ? L[L.length - 1] : null; }
  /* 手里能算到第几帧：其他在线玩家里收得最少的那位（断线中 / 已移除的不算） */
  availFrame() { let a = Infinity; for (let j = 0; j < this.n; j++) { if (j === this.me || this.drops[j] !== undefined || this.isAway(j, this.simFrame)) continue; a = Math.min(a, this.have[j]); } return a === Infinity ? this.simFrame : a; }
  isReady(f) { for (let j = 0; j < this.n; j++) if (f < this.dropAt(j) && !this.isAway(j, f) && this.inputs[j][f] === undefined) return false; return true; }
  /* 下一帧所有人的操作（凑不齐就返回 null，等） */
  next() {
    const f = this.simFrame;
    if (!this.isReady(f)) return null;
    const out = [];
    for (let j = 0; j < this.n; j++) out.push(NetCodec.decodeFrame(f >= this.dropAt(j) ? NetCodec.GONE : this.isAway(j, f) ? NetCodec.AWAY : this.inputs[j][f]));
    this.simFrame++;
    return out;
  }
  waitingFor() { const f = this.simFrame, L = []; for (let j = 0; j < this.n; j++) if (f < this.dropAt(j) && !this.isAway(j, f) && this.inputs[j][f] === undefined) L.push(j); return L; }
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
    // 状态哈希比对：断线期间对方（或自己）算的状态会被重算，不比对
    if (Array.isArray(msg.h) && !this.isAway(from, msg.h[0]) && !this.isAway(this.me, msg.h[0]) && this.hashLog.has(msg.h[0]) && this.hashLog.get(msg.h[0]) !== msg.h[1] && !this.desync) this.desync = { frame: msg.h[0], mine: this.hashLog.get(msg.h[0]), theirs: msg.h[1], from };
    if (Array.isArray(msg.d)) for (const [j, F] of msg.d) { if (j === this.me) { if (this.kicked === undefined) this.kicked = F; } else if (this.drops[j] === undefined) this.drops[j] = F; } // 别人把我判成掉线了：本机这局也结束
    if (Array.isArray(msg.w)) for (const w of msg.w) this.noteAway(w);
    if (typeof msg.ry === 'number' && this.openAway(from)) this.backReq[from] = msg.ry; // 断线的人回来了：从这一帧起可以恢复
    if (msg.rj && !this.openAway(from)) this.rejoinReq[from] = true; // 刷新页面回来的人：请判定的人先把他判成断线中
  }
  /* 断线区间：[j, F, R|null]。区间只会新增，R 只会从“未定”变成确定的帧（各端最终一致） */
  noteAway(w) {
    if (!Array.isArray(w) || w.length !== 3) return;
    const [j, F, R] = w; if (!(j >= 0 && j < this.n) || !(F >= 0)) return;
    const L = this.aways[j]; let r = L.find((x) => x[0] === F);
    if (!r) { r = [F, Infinity]; L.push(r); L.sort((a, b) => a[0] - b[0]); if (j === this.me && R === null) this.meAway(r); if (j !== this.me) this.rejoinReq[j] = false; }
    if (typeof R === 'number' && r[1] === Infinity) { r[1] = R; if (j === this.me && this.awayMe === r) this.meBack(r); } // 只有自己正在等的那一段结束才算恢复；刷新回来收到的旧区间只是历史记录
  }
  /* 本机被判断线：要是本机已经按自己的操作算过了第 F 帧以后（和大家认定的“断线占位”不一样），就得从开局按认定的记录重算 */
  meAway(r) { this.awayMe = r; this.ready = null; if (this.simFrame > r[0]) this.needReplay = true; }
  /* 房主宣布本机从第 R 帧起恢复：之前没发出去的帧都是“断线占位”，从 R 开始用真实操作 */
  meBack(r) {
    const L = this.inputs[this.me];
    for (let f = r[0]; f < r[1]; f++) L[f] = NetCodec.AWAY;
    if (this.nextLocal < r[1]) this.nextLocal = r[1];
    this.advanceHave(this.me); this.awayMe = null; this.ready = null; this.rejoining = false;
  }
  /* 发布：所有人里还有谁缺哪些帧，就把那段帧带上（每段最多 window 帧）。
     跟得上的人按他们里收得最少的那位补一段；落后很多的人（断线刚回来、正在追帧）单独补一段，不拖住其他人；
     好一阵没消息的人（断线中）不参与——否则他停住的收件进度会把补发起点钉死，新帧永远发不出去，所有人一起卡住 */
  flush(extra) {
    const seg = [], now = this.clock(), lagTurn = now - (this.lagAt || 0) >= LOCKSTEP.lagEvery; let lagSent = false;
    for (let j = 0; j < this.n; j++) {
      let head = Infinity, lag = Infinity; const lagK = [];
      for (let k = 0; k < this.n; k++) {
        if (k === this.me || this.drops[k] !== undefined) continue;
        if (this.linkUp ? !this.linkUp[k] : this.heard[k] && now - this.heard[k] > LOCKSTEP.silentAfter) continue; // 不在线（断线中）的人不参与；在线但网络慢的照样补（落后的单独一段）
        const a = this.peerAck[k] ? this.peerAck[k][j] : 0;
        if (this.have[j] - a <= LOCKSTEP.window) { head = Math.min(head, a); continue; }
        const p = this.pipe[k] ? this.pipe[k][j] || 0 : 0; // 落后的人：不等回执，接着上一段往后发（流水线）
        lag = Math.min(lag, p > a && p < this.have[j] ? p : a); lagK.push(k);
      }
      if (head < this.have[j]) seg.push([j, head, Math.min(this.have[j], head + LOCKSTEP.window)]);
      if (lag < this.have[j] && lagTurn) {
        const e = Math.min(this.have[j], lag + LOCKSTEP.lagWindow); seg.push([j, lag, e]); lagSent = true;
        for (const k of lagK) (this.pipe[k] = this.pipe[k] || [])[j] = e >= this.have[j] ? 0 : e; // 发到头了：下一轮从对方的回执重来，补上中途丢掉的段
      }
    }
    if (lagSent) this.lagAt = now;
    // 预算不够（4 人 + 网络很差）时每段少带几帧：先补最早缺的，下一份再补后面的
    let per = Math.max(0, ...seg.map((x) => x[2] - x[1])); const cost = () => seg.reduce((c, x) => c + Math.min(x[2] - x[1], per) * 5 + 16, 0); // 每段原样带上，超出预算才一起按比例缩短
    while (per > 8 && cost() > this.budget) per = Math.floor(per * 0.75);
    const r = seg.map(([j, a, b]) => [j, a, this.inputs[j].slice(a, Math.min(b, a + per)).join('')]);
    const last = [...this.hashLog.keys()].pop();
    const msg = Object.assign({ r, a: this.have.slice(), h: last !== undefined ? [last, this.hashLog.get(last)] : null }, extra || {});
    if (Object.keys(this.drops).length) msg.d = Object.entries(this.drops).map(([j, F]) => [+j, F]); // 已定下的移除大家都转发，房主走了也不会丢
    const w = []; this.aways.forEach((L, j) => { for (const r of L) w.push([j, r[0], r[1] === Infinity ? null : r[1]]); }); if (w.length) msg.w = w; // 断线区间同样大家转发
    if (this.ready !== null && this.awayMe) msg.ry = this.ready;
    if (this.rejoining && !this.awayMe) msg.rj = 1; // 只在还不知道自己被判断线之前请求；知道了就改发“准备好了”（ry），免得慢网络下房主重复开断线区间
    this.send(msg);
    this.trimOld();
  }
  trimOld() {} // 操作记录整局保留（每帧几个字符，十分钟也就几百 KB）：断线回来的人要按完整记录从开局重算
  /* 谁来做判定：名单里第一个在线、没被移除、也不在“断线中”的人（断线回来的人要等别人宣布恢复，不能自己判自己） */
  hostIndex(connected) { return connected.findIndex((c, j) => c && this.drops[j] === undefined && !this.openAway(j) && !(j === this.me ? this.rejoining : this.rejoinReq[j])); }
  /* 房主：有人断线 → 过了宽限先判“断线中”（从大家都还没收到他操作的那一帧起，席位保留）；
     他回来并追上后发来“准备好了”→ 宣布从第 R 帧起恢复；席位保留到时还没回来 → 留出提前量宣布从第 G 帧起移除 */
  hostCheckDrops(connected, quit) {
    if (!this.isHost) return;
    const now = this.clock();
    for (let j = 0; j < this.n; j++) {
      if (j === this.me || this.drops[j] !== undefined) continue;
      const open = this.openAway(j);
      if (connected[j]) {
        if (!open && this.rejoinReq[j]) { // 刷新回来、还没被判断线：从大家都没收到他操作的那一帧起判成断线中，等他追上
          let F = this.have[j];
          for (let k = 0; k < this.n; k++) if (k !== j && connected[k] && this.peerAck[k]) F = Math.max(F, this.peerAck[k][j]);
          if (!this.aways[j].some((r) => r[0] >= F)) { this.aways[j].push([F, Infinity]); this.awayAt[j] = now; } // 同一次刷新的迟到请求：已经有从这一帧起的区间了，不重复开
          this.rejoinReq[j] = false;
        } else if (open && this.backReq[j] !== undefined) { open[1] = Math.max(this.backReq[j], this.simFrame + LOCKSTEP.backLead, open[0]); this.backReq[j] = undefined; this.rejoinReq[j] = false; }
        continue;
      }
      if (!this.left[j]) { this.left[j] = now; continue; }
      if (now - this.left[j] < LOCKSTEP.dropGrace) continue;
      if (!open) {
        let F = this.have[j];
        for (let k = 0; k < this.n; k++) if (k !== j && connected[k] && this.peerAck[k]) F = Math.max(F, this.peerAck[k][j]);
        if (quit && quit[j]) this.drops[j] = F; // 主动退出：直接移除
        else { this.aways[j].push([F, Infinity]); this.awayAt[j] = now; } // 意外断开：判断线中，席位保留
      } else if (quit && quit[j]) this.drops[j] = Math.max(open[0], this.simFrame + LOCKSTEP.dropLead); // 断线中又主动退出
      else {
        if (!this.awayAt[j]) this.awayAt[j] = now; // 刚接手房主：从现在开始计席位时间
        if (now - this.awayAt[j] > LOCKSTEP.seat) this.drops[j] = Math.max(open[0], this.simFrame + LOCKSTEP.dropLead);
      }
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
const WS_STUCK_MS = 3500;
class WsNet {
  constructor(url, ch) {
    this.kind = 'ws'; this.url = url; this.ch = ch; this.subs = []; this.others = new Map(); this.me = {}; this.pending = null;
    this.selfId = ssGet(SS_ID) || 'W' + Math.random().toString(36).slice(2, 12); ssSet(SS_ID, this.selfId); // 同一个标签页刷新后身份不变
    this.open = false; this.closed = false; this.retry = 0; this.rtt = null; this.sentAt = 0; this.pingAt = 0;
    this.clock = []; this.clockOff = null; // 对时：最近几次 ping 里延迟最小的那次最准
    this.off = NetTicker.on((now) => this.tick(now));
    this.dial();
  }
  dial() {
    if (this.closed) return;
    let ws; try { ws = new WebSocket(this.url); } catch (e) { this.redial(); return; }
    this.ws = ws;
    ws.onopen = () => { this.open = true; this.synced = false; this.retry = 0; this.lastPong = this.openAt = performance.now(); ws.send(JSON.stringify(Object.assign({ t: 'hello', id: this.selfId, ch: this.ch }, Object.keys(this.me).length ? { p: this.me } : {}))); this.pingAt = 0; if (Object.keys(this.me).length) this.pending = Object.assign({}, this.me); this.emit(); }; // 重连时握手直接带上自己的状态：服务器回的名单马上就是房间里的完整状态
    ws.onmessage = (ev) => this.onMsg(ev.data);
    ws.onclose = () => { if (this.ws !== ws) return; const was = this.open; this.open = false; this.synced = false; this.ws = null; if (was) { this.others.clear(); this.emit(); } this.redial(); };
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
    if (m.t === 'hi') { this.selfId = m.you || this.selfId; this.serverBuild = m.build || null; this.others.clear(); (m.peers || []).forEach(put); this.synced = true; this.syncedAt = performance.now(); this.emit(); }
    else if (m.t === 'u') { (m.peers || []).forEach(put); this.emit(); }
    else if (m.t === 'bye') { this.others.delete(m.peer); this.emit(); }
    else if (m.t === 'pong') {
      const now = performance.now(), rtt = now - m.c; this.rtt = Math.round(rtt); this.lastPong = now;
      this.rtts = (this.rtts || []).concat(rtt).slice(-6); this.rttHi = Math.round(Math.max(...this.rtts)); // 最近几次里最慢的：留出抖动的余量
      if (m.s) { this.clock.push({ rtt, off: m.s + rtt / 2 - now }); if (this.clock.length > 8) this.clock.shift(); this.clockOff = this.clock.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off; }
    }
  }
  serverNow() { return this.clockOff === null ? null : performance.now() + this.clockOff; } // 服务器时钟（毫秒）
  stale() { return !!(this.serverBuild && window.DREAMTIDE_BUILD && this.serverBuild !== window.DREAMTIDE_BUILD); } // 服务器上已经是新版本了
  localPerfOf(ms) { return ms - this.clockOff; }
  tick(now) {
    if (!this.open || !this.ws) return;
    // 连接卡死检测：每秒一次心跳，3.5 秒收不到回包，多半是 TCP 卡在越等越久的重传里（线路丢包时常见；只断一个方向时别人的消息还能收到，所以只看心跳回包）。
    // 直接换一条新连接（身份不变，服务器无缝顶替旧连接，队友那边看不到掉线），不等旧连接自己恢复
    // 连上了却一直没收到名单（握手丢了），也当卡死
    if (now - (this.lastPong || now) > WS_STUCK_MS || (!this.synced && now - (this.openAt || now) > WS_STUCK_MS)) { const ws = this.ws; this.stuck = (this.stuck || 0) + 1; this.ws = null; this.open = false; this.synced = false; try { ws.close(); } catch (e) { /* ignore */ } this.others.clear(); this.emit(); this.retry = 0; this.dial(); return; }
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
  connected() { return this.open && !!this.synced; } // 收到服务器的完整名单（hi）才算连上：重连途中手里没有别人的在线信息，不能据此判谁掉线（否则会“脑裂”）
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
    // 断线回来、本机按自己的操作多算过几帧：换一个全新的世界，按大家认定的操作记录从开局重算（下一次 tick 开始；外面负责建新世界）
    if (S.needReplay) { S.needReplay = false; if (Lobby.onReplay && Lobby.onReplay()) { L.steps = 0; S.simFrame = 0; S.hashLog.clear(); S.desync = null; S.replaying = true; return false; } }
    const lead = Lobby.leadFrames(now) || S.delay;
    while (S.nextLocal <= Math.floor(el * FR) + lead) { if (!S.sample(inputFn(L))) break; Lobby.unsent = true; }
    Lobby.pump(); const gap = now - Lobby.lastFlush; if ((Lobby.unsent && gap >= 16) || gap >= 50) Lobby.flush(now); // 采到新操作马上发；没有新操作时也定期发（回执 / 哈希）
    const target = Math.floor(el * FR * SP), behind = target - L.steps;
    let budget = (behind > FR * SP * 2 ? LOCKSTEP.catchUp * 3 : LOCKSTEP.catchUp) * SP, stalled = false;
    const until = S.replaying ? performance.now() + 14 : 0; // 重算追帧：每次最多占 14 毫秒，不卡住画面
    if (S.replaying) { budget = 1e9; Sound.quiet = true; }
    while (L.steps < target && budget-- > 0 && !w.done) {
      if (L.steps % SP === 0) { const ins = S.next(); if (!ins) { stalled = true; break; } for (let j = 0; j < ins.length; j++) w.setInput(j, ins[j]); }
      w.step(1 / 120); L.steps++;
      if (L.steps % SP === 0 && S.simFrame % LOCKSTEP.hashEvery === 0) S.simulated(w.stateHash());
      if (S.replaying) { w.events.length = 0; if (performance.now() > until) break; }
    }
    // 追上了：离实时只差一点，或者已经算到了手里能拿到的最新操作、而那些操作离实时不到 2 秒（网络慢时永远差几帧，不能死等“完全实时”）
    const avail = S.availFrame(), caught = target - L.steps < SP * 6 || (S.simFrame >= avail - 2 && avail * SP >= target - FR * SP * 2);
    if (S.replaying && (caught || w.done || (stalled && !S.rejoining && !S.awayMe))) { S.replaying = false; Sound.quiet = false; } // 刷新 / 断线回来时操作记录是一批批补到的：中途缺帧接着等，追上才算完
    S.replayPct = S.replaying ? Math.min(99, Math.floor((L.steps / Math.max(1, target)) * 100)) : 0;
    // 断线回来：追上了就告诉大家“从这一帧起可以恢复”，房主据此宣布恢复帧
    if (S.awayMe && !S.replaying && !S.needReplay && caught) S.ready = Math.max(S.nextLocal, S.simFrame + S.delay);
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
      const r = rooms.get(m.code) || { code: m.code, members: [], host: null, started: false, stage: null, mode: 'coop' };
      const ls = p.presence.ls;
      r.members.push({ peer: p.peer, isMe: p.isMe, name: String(m.name || '玩家').slice(0, 12), plane: PLANES[m.plane] ? m.plane : 'moon', host: !!m.host, prof: m.prof || null, playing: !!(ls && ls.g), rtt: typeof m.rtt === 'number' ? m.rtt : null, rdy: m.rdy || null });
      if (m.host) { r.host = p.peer; r.started = !!m.start; r.stage = m.stage || null; r.mode = m.mode === 'vs' ? 'vs' : 'coop'; r.stat = m.stat === 'fair' ? 'fair' : 'real'; r.ladder = m.ladder | 0; r.cfg = m.cfg || null; r.cd = m.cd || null; r.startId = m.start ? m.start.id : null; r.players = m.start && Array.isArray(m.start.peers) ? m.start.peers : m.start && Array.isArray(m.start.roster) ? m.start.roster.map((x) => x.peer) : []; }
      rooms.set(m.code, r);
    }
    for (const r of rooms.values()) r.members.sort((a, b) => (b.host - a.host) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
    return [...rooms.values()].filter((r) => r.host);
  },
  me(patch) { if (!this.net) return; this.net.presence({ mp: Object.assign({}, this.myMp(), patch) }); this.saveRoom(); },
  create(profile) { this.code = Math.random().toString(36).slice(2, 6).toUpperCase(); this.isHost = true; this.me(Object.assign({ code: this.code, host: true, start: null }, profile)); this.net.presence({ ls: null, quit: null }); },
  join(code, profile) { this.code = code; this.isHost = false; this.me(Object.assign({ code, host: false, start: null, rdy: null }, profile)); this.net.presence({ ls: null, quit: null }); },
  leave() { this.session = null; this.linger = null; if (this.net) this.net.presence({ mp: null, ls: null, quit: 1 }); this.code = null; this.isHost = false; this.gameId = null; this.saveRoom(); }, // quit：明确说“我退出了”（刚连上还没发房间信息的新连接不会被当成退出）
  /* 刷新回到原对局：本标签页记住房间号、自己的在场状态（房主还带着开局单）和正在打的局号 */
  saveRoom() { ssSet(SS_ROOM, this.code ? JSON.stringify({ code: this.code, isHost: this.isHost, mp: this.myMp(), gameId: this.session ? this.gameId : null, at: Date.now() }) : null); },
  savedRoom() { try { const d = JSON.parse(ssGet(SS_ROOM) || 'null'); return d && d.code && Date.now() - d.at < 20 * 60000 ? d : null; } catch (e) { return null; } },
  resume(d) {
    this.code = d.code; this.isHost = !!d.isHost; this.resumeGame = d.gameId || null; this.net.presence({ mp: Object.assign({}, d.mp), ls: null, quit: null }); this.saveRoom();
    this.resumeWait = true; setTimeout(() => { this.resumeWait = false; this.changed(); }, 6000); // 刚刷新回来：房间成员的状态还在路上，先别判“房主离开了”
  },
  room() { return this.openRooms().find((x) => x.code === this.code) || null; },
  members() { const r = this.room(); return r ? r.members : []; },
  /* 房主开局：把名单（含每人的局外属性）写进自己的在场状态，大家看到就各自开始 */
  start(stage, delay, mode, stat, ladder) {
    if (!this.isHost) return false;
    const ms = this.members().slice(0, MP_MAX); if (ms.length < 2) return false;
    const fair = mode === 'vs' && stat === 'fair'; // 统一属性：所有人按 1 级基础属性、大招容量 1（关掉局外成长差距）
    const roster = ms.map((m) => ({ peer: m.peer, name: m.name, plane: m.plane, stats: fair ? compactStats(planeStats(null, m.plane)) : (m.prof && m.prof.s) || null, ultCap: fair ? 1 : (m.prof && m.prof.u) || 1, cos: (m.prof && m.prof.c) || {} }));
    const id = Math.random().toString(36).slice(2, 8), seed = (Math.random() * 4294967296) >>> 0;
    const now = this.net.serverNow ? this.net.serverNow() : null, at = now === null ? null : Math.round(now + 900); // 约 0.9 秒后大家在同一刻开局
    const vs = mode === 'vs'; // 对抗（v0.11）：每人一条航道、三段计分；关卡数值按第一关
    this.me({ stage, mode: vs ? 'vs' : 'coop', cd: null, start: { id, stage: vs ? '1-1' : stage, mode: vs ? 'vs' : 'coop', stat: fair ? 'fair' : 'real', ladder: vs ? 0 : ladder | 0, peers: roster.map((r) => r.peer), seed, roster, at, delay: delay || this.autoDelay(ms), world: vs ? {} : this.mergeWorld(ms) } }); // 家园改变的世界状态：合并房间里每个人的（写进开局单，各端一致）
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
    if (st && st.id === this.resumeGame && st.at && this.net.serverNow && this.net.serverNow() === null) { clearTimeout(this.clockWait); this.clockWait = setTimeout(() => this.changed(), 300); return; } // 刷新回来：先和服务器对好时钟，才知道“现在是第几帧”
    if (st && st.id !== this.gameId && Array.isArray(st.roster) && st.roster.some((x) => x.peer === this.selfId()) && this.onStart) { if (this.onStart(st) !== false) this.gameId = st.id; } // 还在上一局收尾就等下次再接
    if (this.session) this.pump();
    if (this.onUpdate) this.onUpdate();
  },
  beginSession(st) {
    const idx = st.roster.findIndex((x) => x.peer === this.selfId());
    if (idx < 0) return -1;
    this.roster = st.roster; this.seenLs = new Map(); this.gameId = st.id; this.linger = null; this.sessionAt = Date.now();
    const rejoin = !!(this.resumeGame && this.resumeGame === st.id); this.resumeGame = null; // 刷新前正在打这一局：以原身份回去
    // 操作帧的预算：4 KiB 减去在场状态里其他字段（房主还带着开局单）
    const other = JSON.stringify({ mp: this.myMp() }).length;
    this.peerRtt = []; this.lead = null; this.leadAt = 0;
    this.session = new LockstepSession({ selfIndex: idx, n: st.roster.length, delay: st.delay, isHost: this.isHost, budget: Math.max(600, (this.net.kind === 'ws' ? 7000 : 3800) - Math.ceil(other * 1.5) - 220), rejoin, // 自己的服务器每份在场状态上限 8 KiB（中文名按 3 字节留余量）
      send: (msg) => this.net.presence({ ls: Object.assign({ g: st.id, rt: this.myRtt() }, msg) }) }); // 操作帧单独一个字段：服务器只转发变化，资料不重发
    if (rejoin) this.session.replaying = true; // 新建的世界从开局按操作记录追上（静音、不放事件）
    this.saveRoom();
    return idx;
  },
  /* 把别人在场状态里的操作帧喂给会话（同一份状态对象不重复处理；只认这一局的） */
  pump() {
    const S = this.session || this.linger; if (!S || !this.net) return;
    if (!this.net.connected()) return; // 自己掉线时别人看起来都“不在了”：这时不能判谁掉线，等重连
    const connected = Array(this.roster.length).fill(false), quit = Array(this.roster.length).fill(false); connected[S.me] = true;
    const early = Date.now() - this.sessionAt < 8000; // 开局头几秒，慢一步进来的人还没发出这局的操作，先算在线
    for (const p of this.net.peers()) {
      if (p.isMe) continue;
      const j = this.roster.findIndex((x) => x.peer === p.peer); if (j < 0) continue;
      const m = p.presence && p.presence.mp; if (!m || m.code !== this.code) { if (p.presence && p.presence.quit) quit[j] = true; continue; } // 明确说了退出：不保留席位（刚连上、还没发房间信息的不算）
      const ls = p.presence.ls, mine = ls && ls.g === this.gameId;
      if (mine || early) connected[j] = true;
      if (mine && this.seenLs.get(j) !== ls) { this.seenLs.set(j, ls); S.receive(j, ls); if (typeof ls.rt === 'number') this.peerRtt[j] = ls.rt; }
    }
    S.isHost = S.hostIndex(connected) === S.me; // 房主走了（或断线中），名单里下一位在线的接手
    if (!this.net.syncedAt || performance.now() - this.net.syncedAt > 3000) S.hostCheckDrops(connected, quit); // 刚（重新）连上的几秒不判别人掉线：等名单和操作帧都到齐
    this.connectedNow = connected; S.linkUp = connected;
  },
  myRtt() { const n = this.net; return n ? Math.round(n.rttHi || n.rtt || 0) : 0; },
  /* 队友那边这一局已经结束了（例如我断线期间他们打完或失败）：我自己确实连着，却 15 秒没收到任何队友的新操作，本机又卡着等 → 本机也结束。
     自己断网时不算（那是在等重连，席位还保留着） */
  orphaned() {
    const S = this.session; if (!S || !this.net || !this.net.connected() || Date.now() - this.sessionAt < 20000) return false;
    if (this.net.syncedAt && performance.now() - this.net.syncedAt < 10000) return false; // 刚重连上：先等队友的操作帧到
    let last = 0; for (let j = 0; j < S.n; j++) if (j !== S.me && S.drops[j] === undefined) last = Math.max(last, S.heard[j] || 0);
    return S.waitingFor().length > 0 && Date.now() - last > 15000;
  },
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
    this.session = null; this.saveRoom();
    if (this.net && this.code && this.isHost) this.me({ start: null });
  },
};
