// 真机联机测试：几个无头客户端（每个是一套独立的 JS 环境，载入同一套游戏脚本 + net.js，跑的就是网页里同一份联机主循环 MpDriver）
// 通过真实的 WebSocket 连联机服务器：建房 → 加入 → 开局 → 自动驾驶打一局，报告同步、卡顿、延迟和自适应缓冲。
// 不经过浏览器，所以不会被“后台标签页降频”干扰，测的就是网络和服务器本身。
// 用法：node tools/net-bot.js [服务器 ws 地址] [人数=2] [关卡=1-1 / vs] [最长秒数=300] [--host-leave=秒]
//   例：node tools/net-bot.js ws://39.106.153.154:8080/mp 2 1-1 300
//       node tools/net-bot.js ws://39.106.153.154:8080/mp 2 vs 400                 # 对抗（自由竞争）
//       node tools/net-bot.js ws://39.106.153.154:8080/mp 3 1-1 300 --host-leave=60 # 房主第 60 秒断开：其余的人必须继续打完（v0.11 §13）
//       node tools/net-bot.js ws://localhost:8091/mp 2 1-1 300 --dark=1@40~30        # 第 2 个客户端第 40 秒起断网 30 秒（收发全丢）：必须先被判断线中、回来后恢复（v0.11 §8）
// 退出码：没同步 / 卡顿过多 / 没跑起来 → 1
const fs = require('fs'), vm = require('vm'), path = require('path');
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--')), FLAG = (k) => { const f = process.argv.find((a) => a.startsWith('--' + k + '=')); return f ? f.split('=')[1] : null; };
const URL_ = ARGS[0] || 'ws://39.106.153.154:8080/mp', N = +(ARGS[1] || 2), MODE = ARGS[2] === 'vs' ? 'vs' : 'coop', STAGE = MODE === 'vs' ? '1-1' : ARGS[2] || '1-1', MAXS = +(ARGS[3] || 300);
const HOST_LEAVE = FLAG('host-leave') ? +FLAG('host-leave') : null;
const LAT = +(FLAG('lat') || 0), SPIKES = !!FLAG('spikes'); // 慢线路模拟：单向延迟毫秒；spikes=1 时每 15~25 秒随机卡住 1~4 秒（消息按顺序堆着，卡完一起到，像 TCP 重传）
const RELOAD = FLAG('reload') ? (([k, t]) => ({ k: +k, at: +t }))(FLAG('reload').split('@')) : null; // --reload=1@60：第 2 个客户端第 60 秒刷新页面
const DARK = FLAG('dark') ? (([k, r]) => { const [t, d] = r.split('~').map(Number); return { k: +k, at: t, dur: d }; })(FLAG('dark').split('@')) : null;
const dir = path.join(__dirname, '..', 'js');
const FILES = ['util', 'data', 'audio', 'input', 'art', 'mapart', 'world', 'foes', 'mapfx', 'offers', 'director', 'surprise', 'boss', 'captain', 'vs', 'home', 'net'];
const noop = () => {};
const fakeCtx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });

async function main() {
  if (typeof WebSocket !== 'function') { console.log('✗ 需要 Node 22 以上（自带 WebSocket）'); process.exit(1); }
  // 和服务器上的网页同一个版本频道：真人打开网页也能看到这些机器人的房间
  const httpBase = URL_.replace(/^ws/, 'http').replace(/\/mp$/, '');
  let build = 'dev'; try { build = (await (await fetch(httpBase + '/health')).json()).build || 'dev'; } catch (e) { console.log('读不到 /health，用 dev 频道'); }
  const bots = [];
  const makeBot = (k, ss) => { // ss：这个“标签页”的 sessionStorage（刷新页面时原样带到新环境里）
    const io = { tx: 0, rx: 0, txN: 0, rxN: 0, hold: 0, nextSpike: Date.now() + 15000 + Math.random() * 10000 }; // 收发字节 / 条数（看带宽和服务器限流）
    const slow = (prev) => { const now = Date.now(); if (SPIKES && now > io.nextSpike) { io.hold = now + 1000 + Math.random() * 3000; io.nextSpike = io.hold + 15000 + Math.random() * 10000; } return Math.max(now + LAT, prev, io.hold); };
    class CountingWS extends WebSocket { // 断网模拟：io.dark 时收发全丢（连接本身不关，和线路断掉一样）；慢线路模拟：按顺序延迟收发
      constructor(u) {
        super(u); let rxAt = 0;
        this.addEventListener('message', (ev) => {
          if (io.dark) { ev.stopImmediatePropagation(); return; }
          io.rx += String(ev.data).length; io.rxN++;
          if (!LAT && !SPIKES) return;
          ev.stopImmediatePropagation(); const data = ev.data; rxAt = slow(rxAt); setTimeout(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data }); }, rxAt - Date.now()); // 连接关了就不再交付（和真实浏览器一样）
        });
        this.txAt = 0;
      }
      send(d) {
        if (io.dark) return; io.tx += String(d).length; io.txN++;
        if (!LAT && !SPIKES) return super.send(d);
        this.txAt = slow(this.txAt); setTimeout(() => { try { super.send(d); } catch (e) { /* 已断开 */ } }, this.txAt - Date.now());
      }
    }
    const ctx = { console, Math, Date, JSON, performance, setTimeout, clearTimeout, setInterval, clearInterval, WebSocket: CountingWS, URL, Blob, __io: io,
      window: { addEventListener: noop, matchMedia: () => ({ matches: false }), DREAMTIDE_BUILD: build }, document: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }), addEventListener: noop, hidden: false },
      navigator: { getGamepads: () => [] }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, location: { search: '', protocol: 'http:', host: 'bot' },
      sessionStorage: { getItem: (x) => (x in ss ? ss[x] : null), setItem: (x, v) => { ss[x] = String(v); }, removeItem: (x) => { delete ss[x]; } }, __ss: ss };
    ctx.globalThis = ctx; vm.createContext(ctx);
    for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
    ctx.__url = URL_; ctx.__k = k; ctx.__dump = !!FLAG('dump'); ctx.__trace = !!FLAG('trace'); ctx.__build = build; ctx.__stage = STAGE;
    vm.runInContext(`
      var meta = freshMeta(); Home.ensure(meta); var settings = DEFAULT_SETTINGS(); settings.particles = 'low';
      var B = { w: null, L: null, res: null, rescues: [], rtts: [], leads: [], started: false, stallMs: 0, maxWait: 0, prev: 0, slack: [], win: null };
      /* 分段统计：每段里卡住了多少毫秒、最长一次等多久、队友的操作帧到达时离要用还剩多少毫秒（负数 = 来晚了，这一帧要等） */
      function newWin() { B.win = { t: performance.now(), stallMs: 0, maxWait: 0, slack: [], rtt: [], lead: [], tx: __io.tx, rx: __io.rx, txN: __io.txN, rxN: __io.rxN }; }
      Lobby.net = new WsNet(__url, 'dreamtide-' + MP_PROTO + '-' + __build); Lobby.net.onChange(() => Lobby.changed());
      NetTicker.on((now) => Lobby.tick(now)); NetTicker.start();
      function profile() { return { name: '机器人' + (__k + 1), plane: 'moon', prof: { s: compactStats(planeStats(null, 'moon')), u: 2, c: {}, w: Home.worldFor(meta), g: Home.goal(meta).title } }; }
      /* 自动驾驶：和网页测试同一个思路，按本机显示预测的位置去对准（有网络缓冲时不会冲过头） */
      function vsBot(w, i) { // 对抗：清自己航道、先打风塔守卫、洞口开了就进、侧风来了换边、冲突区里对准带子里的对手
        const p = w.players[i], V = w.vs, L = V.lanes[i], mid = (L.top + L.bot) / 2, off = w.viewOff || { x: 0, y: 0 }, px = p.x + off.x, py = p.y + off.y;
        let tx = w.W * 0.22, ty = mid, best = null, bd = 1e9;
        for (const e of w.enemies) { if (!e.alive || e.lane !== i || e.x < px + 30 || e.x > w.W) continue; const d = e.x - px + Math.abs(e.y - py) * 0.6 - (e.vsGuard || e.vsInt ? 220 : 0); if (d < bd) { bd = d; best = e; } }
        if (best) ty = best.y;
        const holes = V.holes.filter((h) => h.lane === i && h.st === 'open');
        if (holes.length) { const H = holes.find((h) => h.kind === (V.stage % 2 ? 'wind' : 'armor')) || holes[0]; tx = H.x; ty = H.y; }
        else if (V.clash) { ty = i === 0 ? L.bot + 30 : L.top - 30; const o = w.players.find((q) => q !== p && q.alive && w.vsInBand(q.y)); if (o && w.vsInBand(py)) { ty = o.y; tx = Math.max(60, o.x - 220); } }
        if (L.wind) ty = L.wind.dir > 0 ? Math.min(L.bot - 30, L.wind.bot + 40) : Math.max(L.top + 30, L.wind.top - 40);
        if (w.ritual && w.ritual.st === 'choose') { const g = w.ritual.gates[i % 2]; tx = g.x; ty = g.y; }
        const gain = w.ritual && w.ritual.st === 'choose' ? 120 : 60;
        return { mx: Math.sign(tx - px) * Math.min(1, Math.abs(tx - px) / gain), my: Math.sign(ty - py) * Math.min(1, Math.abs(ty - py) / (gain * 0.7)), burst: p.stock >= 1 && !w.ritual && !w.bursting, focus: false, dx: 0, dy: 0 };
      }
      function bot(w, i) {
        const p = w.players[i]; if (!p || !p.alive) return { mx: 0, my: 0, burst: false };
        if (w.vs) return vsBot(w, i);
        const off = w.viewOff || { x: 0, y: 0 }, px = p.x + off.x, py = p.y + off.y, mid = (TOP + BOTTOM) / 2;
        let tx = w.W * 0.22 + i * 30, ty = mid + (i - 0.5) * 60, best = null, bd = 1e9;
        for (const e of w.enemies) { if (!e.alive || e.x < px + 30 || e.x > w.W) continue; const d = e.x - px + Math.abs(e.y - py) * 0.6 - (e.goal ? 260 : 0); if (d < bd) { bd = d; best = e; } }
        if (best) ty = best.y + (i - 0.5) * 24;
        if (w.boss && w.boss.plates) { const pl = w.boss.plates.find((q) => q.alive); if (pl) ty = w.boss.y + pl.dy; }
        const gt = w.guideTarget(); if (gt && (i === 0 || i === w.beatIdx % w.players.length) && !(w.ritual && w.ritual.st === 'choose')) { tx = Math.min(gt.x - 6, w.W * 0.8); ty = gt.y; }
        const tow = w.mapObjs.find((o) => o.state === 'tow' && o.by === i); if (tow && !(w.ritual && w.ritual.st === 'choose')) { const g2 = w.mapGoalPos(tow); if (g2) { tx = Math.min(g2.x - 6, w.W * 0.8); ty = g2.y; } } // 自己拖着的东西自己送到
      const mate = w.players.find((q) => q !== p && !q.alive && !q.gone); if (mate && !w.ritual) { tx = mate.x; ty = mate.y; } // 队友倒下：飞进救援圈
      if (w.ritual && w.ritual.st === 'choose') { const g = w.ritual.gates[i % 2]; tx = g.x; ty = g.y; }
        const gain = w.ritual && w.ritual.st === 'choose' ? 120 : 60;
        return { mx: Math.sign(tx - px) * Math.min(1, Math.abs(tx - px) / gain), my: Math.sign(ty - py) * Math.min(1, Math.abs(ty - py) / (gain * 0.7)), burst: p.stock >= 1 && !w.ritual && !w.bursting, focus: false, dx: 0, dy: 0 };
      }
      Lobby.onStart = (st) => {
        const idx = Lobby.beginSession(st); if (idx < 0) return false;
        const mk = () => new World({ mode: 'run', W: 1280, stage: st.stage, seed: st.seed, me: idx, settings, world: st.world || {}, vs: st.mode === 'vs',
          players: st.roster.map((r) => ({ id: r.peer, name: r.name, plane: r.plane, stats: r.stats || planeStats(null, r.plane), ultCap: r.ultCap || 1, cos: {} })),
          cb: { onEnd: (r) => { B.res = r; Lobby.endGame(); }, onRescue: (id) => { if (!B.rescues.includes(id)) B.rescues.push(id); } } });
        B.w = mk(); Lobby.onReplay = () => { if (B.w.done) return false; B.w = mk(); B.replays = (B.replays || 0) + 1; return true; };
        const sync = st.at && Lobby.net.serverNow() !== null;
        B.L = { t0: sync ? Lobby.net.localPerfOf(st.at) : performance.now(), steps: 0, last: performance.now(), waitT: 0, dx: 0, dy: 0 };
        const S = Lobby.session, recv = S.receive.bind(S);
        S.receive = (from, msg) => { const before = S.have.slice(); recv(from, msg); const now = performance.now();
          for (let j = 0; j < S.n; j++) if (j !== S.me) for (let f = before[j]; f < S.have[j]; f++) { const sl = B.L.t0 + f * 1000 / LOCKSTEP.hz - now; B.slack.push(sl); if (B.win) B.win.slack.push(sl); } };
        B.started = true; B.prev = performance.now(); newWin(); return true;
      };
      function tick() {
        const now = performance.now();
        if (B.w && !B.w.done && Lobby.session && Lobby.orphaned()) { const S = Lobby.session; console.log('[orphan]', __k, JSON.stringify({ t: Math.round(performance.now()), synced: Lobby.net.synced, open: Lobby.net.open, heard: S.heard.map((h) => h ? Date.now() - h : null), wait: S.waitingFor(), sim: S.simFrame, aways: S.aways, sessionAge: Date.now() - Lobby.sessionAt, peers: Lobby.net.peers().length })); B.orphan = true; B.w.done = true; Lobby.endGame(); } // 队友那边已经结束
        if (B.w && !B.w.done && Lobby.session) {
          const f0 = Lobby.session.simFrame;
          const stalled = MpDriver.tick(B.w, B.L, Lobby.session, now, () => bot(B.w, Lobby.session.me)); B.w.events.length = 0;
          if (__dump && Lobby.session.simFrame !== f0 && Lobby.session.simFrame % 30 === 0) { B.dumps = B.dumps || new Map(); B.dumps.set(Lobby.session.simFrame, JSON.stringify(B.w.stateDump())); if (B.dumps.size > 400) B.dumps.delete(B.dumps.keys().next().value); }
          if (stalled) { B.stallMs += now - B.prev; B.win.stallMs += now - B.prev; } B.maxWait = Math.max(B.maxWait, B.L.waitT); B.win.maxWait = Math.max(B.win.maxWait, B.L.waitT);
          if (B.L.ticks % 40 === 0) { B.rtts.push(Lobby.net.rtt); B.leads.push(Lobby.lead); B.win.rtt.push(Lobby.net.rtt); B.win.lead.push(Lobby.lead); }
        }
        B.prev = now;
        if (__trace && Lobby.session && (Lobby.session.awayMe || Lobby.session.replaying || Lobby.session.rejoining) && now - (B.traceAt || 0) > 5000) { B.traceAt = now; const S = Lobby.session, L = B.L; console.log('[trace]', __k, JSON.stringify({ t: Math.round(now / 1000), sim: S.simFrame, target: L ? Math.floor(L.steps / 4) + '/' + Math.floor((now - L.t0) / 1000 * 30) : null, avail: S.availFrame(), have: S.have, replaying: !!S.replaying, need: !!S.needReplay, awayMe: S.awayMe, ready: S.ready, rejoining: S.rejoining, synced: Lobby.net.synced, stuck: Lobby.net.stuck || 0 })); }
      }
      function q(a, p) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return Math.round(b[Math.min(b.length - 1, Math.floor(p * b.length))]); }
      function winStats() { // 这一段的数，然后开新的一段
        const W = B.win; if (!W) return null; const sec = (performance.now() - W.t) / 1000, avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
        const o = { stall: Math.round(W.stallMs / sec / 10) + '%', maxWait: Math.round(W.maxWait * 1000), late: W.slack.filter((x) => x < 0).length + '/' + W.slack.length, slackP10: q(W.slack, 0.1), slackMin: q(W.slack, 0), rtt: avg(W.rtt) + '/' + (W.rtt.length ? Math.max(...W.rtt) : null), lead: avg(W.lead),
          up: Math.round((__io.tx - W.tx) / sec) + 'B/' + Math.round((__io.txN - W.txN) / sec), down: Math.round((__io.rx - W.rx) / sec) + 'B/' + Math.round((__io.rxN - W.rxN) / sec) };
        newWin(); return o;
      }
      function stats() {
        const S = Lobby.session || Lobby.linger, w = B.w, L = B.L, avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
        return { started: B.started, t0: L ? Math.round(L.t0) : null, clockOff: Lobby.net.clockOff === null ? null : Math.round(Lobby.net.clockOff), frame: S ? S.simFrame : null, stallMs: Math.round(B.stallMs), maxWait: Math.round(B.maxWait * 1000), late: B.slack.filter((x) => x < 0).length + '/' + B.slack.length, slackP10: q(B.slack, 0.1), behind: L && S ? Math.round((performance.now() - L.t0) / 1000 * 30) - S.simFrame : null,
          stallPct: L && L.ticks ? +((L.stallTicks || 0) / L.ticks * 100).toFixed(1) : null, rttAvg: avg(B.rtts.filter((x) => x !== null)), rttMax: B.rtts.length ? Math.max(...B.rtts.filter((x) => x !== null)) : null,
          lead: B.leads.length ? Math.min(...B.leads.filter((x) => x !== null)) + '~' + Math.max(...B.leads.filter((x) => x !== null)) : null,
          beat: w ? w.beatIdx : null, done: !!(w && w.done), win: B.res ? B.res.win : null, desync: S ? S.desync : null, rescues: B.rescues.join(','), hash: S ? [...S.hashLog].slice(-1)[0] : null,
          stuck: Lobby.net.stuck || 0, orphan: !!B.orphan, reloaded: !!B.reloaded, rejoining: S ? !!S.rejoining : null, replays: B.replays || 0, aways: S ? S.aways.map((L) => L.map((r) => r[0] + '-' + (r[1] === Infinity ? '?' : r[1])).join(',')).join('|') : null, kicked: S ? S.kicked !== undefined : null, vs: B.res && B.res.vs ? B.res.vs.scores.join('/') : w && w.vs ? w.vs.score.map(Math.floor).join('/') : null, gone: w ? w.players.map((q) => q.gone ? 1 : 0).join('') : null, host: S ? S.isHost : null, left: !!B.left };
      }`, ctx);
    return ctx;
  };
  for (let k = 0; k < N; k++) bots.push(makeBot(k, {}));
  const R = (c, code) => vm.runInContext(code, c);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 连上 → 机器人 1 建房 → 其他人加入 → 人齐了开局
  for (let t = 0; t < 100 && !bots.every((c) => R(c, 'Lobby.net.connected() && Lobby.net.clockOff !== null')); t++) await sleep(100);
  if (!bots.every((c) => R(c, 'Lobby.net.connected()'))) { console.log('✗ 连不上服务器', URL_); process.exit(1); }
  R(bots[0], 'Lobby.create(profile())'); const code = R(bots[0], 'Lobby.code');
  for (let t = 0; t < 100 && !R(bots[1], `Lobby.openRooms().some((r) => r.code === '${code}')`); t++) await sleep(100);
  for (const c of bots.slice(1)) R(c, `Lobby.join('${code}', profile())`);
  for (let t = 0; t < 100 && R(bots[0], 'Lobby.members().length') < N; t++) await sleep(100);
  console.log(`房间 ${code}，${R(bots[0], 'Lobby.members().length')} 人，延迟 ${bots.map((c) => R(c, 'Lobby.net.rtt')).join(' / ')} 毫秒，开局…`);
  R(bots[0], `Lobby.start('${STAGE}', 0, '${MODE}')`);
  const live = bots.slice(); // 房主离开后只推进还在的人
  const timer = setInterval(() => { for (const c of live) R(c, 'tick()'); }, 8);
  const t0 = Date.now(); let last = 0;
  while (Date.now() - t0 < MAXS * 1000 && !live.every((c) => R(c, 'B.w && B.w.done'))) {
    if (RELOAD && !RELOAD.done && (Date.now() - t0) / 1000 >= RELOAD.at) { // 刷新页面：整个 JS 环境丢掉，用同一份 sessionStorage 建一个新的，自动回到原房间 / 原对局
      RELOAD.done = true; const old = bots[RELOAD.k], ss = JSON.parse(JSON.stringify(old.__ss));
      R(old, 'B.left = true; Lobby.net.close()'); live.splice(live.indexOf(old), 1);
      const nb = makeBot(RELOAD.k, ss); bots[RELOAD.k] = nb; live.push(nb);
      for (let t = 0; t < 50 && !R(nb, 'Lobby.net.connected()'); t++) await sleep(100);
      R(nb, 'B.reloaded = true; Lobby.resume(Lobby.savedRoom())');
      console.log(`${Math.round((Date.now() - t0) / 1000)}s 机器人${RELOAD.k + 1} 刷新页面`);
    }
    if (DARK) { const c = bots[DARK.k], el = (Date.now() - t0) / 1000, on = el >= DARK.at && el < DARK.at + DARK.dur; if (c.__io.dark !== on) { c.__io.dark = on; console.log(`${Math.round(el)}s 机器人${DARK.k + 1} ${on ? '断网' : '网络恢复'}`); } }
    if (HOST_LEAVE !== null && live.includes(bots[0]) && Date.now() - t0 > HOST_LEAVE * 1000) { // 房主直接断线（不走“离开房间”按钮）
      live.splice(live.indexOf(bots[0]), 1); R(bots[0], 'B.left = true; Lobby.net.close()'); console.log(`${Math.round((Date.now() - t0) / 1000)}s 房主断开`);
    }
    await sleep(500);
    if (Date.now() - last > 15000) { last = Date.now(); console.log(Math.round((Date.now() - t0) / 1000) + 's', bots.map((c, k) => `#${k + 1} ` + JSON.stringify(R(c, 'winStats()'))).join(' | ')); }
  }
  await sleep(1500); clearInterval(timer);
  const st = bots.map((c) => R(c, 'stats()'));
  st.forEach((s, k) => console.log(`机器人${k + 1}`, JSON.stringify(s)));
  let failed = 0; const fail = (m) => { failed++; console.log('✗', m); };
  if (!st.every((s) => s.started)) fail('有人没开局');
  if (st.some((s) => s.desync)) {
    fail('状态不一致（不同步）');
    if (FLAG('dump')) { // 找两端第一帧不一样的状态明细
      const D = bots.map((c) => R(c, 'B.dumps ? [...B.dumps] : []')), m1 = new Map(D[0]), m2 = new Map(D[1]);
      for (const [f, a] of m1) { const b = m2.get(f); if (b === undefined || a === b) continue; const A = JSON.parse(a), Bb = JSON.parse(b); console.log('第一处不同：帧', f); for (const k2 of Object.keys(A)) if (JSON.stringify(A[k2]) !== JSON.stringify(Bb[k2])) console.log('  ', k2, JSON.stringify(A[k2]).slice(0, 400), '\n  ≠', JSON.stringify(Bb[k2]).slice(0, 400)); break; }
    }
  }
  const rest = st.filter((s) => !s.left), finished = rest.every((s) => s.done);
  if (finished && MODE !== 'vs' && new Set(rest.map((s) => s.win)).size > 1) fail('各端结局不一样');
  if (finished && MODE === 'vs' && new Set(rest.map((s) => s.vs)).size > 1) fail('各端的对抗分数不一样');
  if (RELOAD) { // 刷新的那位：必须回到原对局（不是新开一局）、被判过断线中且已恢复、和大家一样推进，没被移出
    const d = st[RELOAD.k];
    if (!d.reloaded || !d.started) fail('刷新后没有回到原对局');
    if (d.kicked) fail('刷新后被移出了这一局');
    if ((d.aways || '').includes('?') || d.rejoining) fail('刷新回来后一直没有恢复操作');
    const o = st.find((x, k) => k !== RELOAD.k);
    if (!finished && Math.abs((d.frame || 0) - (o.frame || 0)) > 60) fail('刷新回来后没有追上大家');
  }
  if (DARK) { // 断网的那位：必须没被移出、被判过断线中且已恢复、和大家一样打完（或还在一起打）
    const d = st[DARK.k];
    if (d.kicked) fail('断网的人被移出了这一局（应该保留席位）');
    if (DARK.dur * 1000 > 15000 + 2000 && !(d.aways || '').split('|')[DARK.k]) fail('断网超过服务器超时却没有被判“断线中”');
    const othersEnded = st.some((x, k) => k !== DARK.k && x.done) && d.orphan; // 断网期间队友那边这局已经结束（例如一个人被打倒）：回来后体面结束，不算协议问题
    if (othersEnded) console.log('（断网期间队友那边这局先结束了；断网的人回来后收到“这一局已经结束”）');
    else {
      if ((d.aways || '').includes('?')) fail('断线中一直没有恢复');
      if (!finished && Math.abs(d.frame - st.find((x, k) => k !== DARK.k).frame) > 60) fail('断网的人回来后没有追上');
    }
  }
  if (HOST_LEAVE !== null) { // 房主离开：其余的人继续（不被踢回菜单），名单里下一位接手房主，各端都把房主标成“离开”
    if (!rest.every((s) => (s.gone && s.gone[0] === '1') || (s.aways || '').split('|')[0])) fail('房主断开后没有在各端被判断线中 / 移出这一局'); // 意外断开先保留席位 60 秒，之后移出
    if (!rest.some((s) => s.host)) fail('房主离开后没有人接手');
    if (!rest.every((s) => s.frame > HOST_LEAVE * 30 + 300)) fail('房主离开后其余的人没有继续推进');
  }
  const playMs = (Date.now() - t0) * 1;
  if (!SPIKES && st.some((s, k) => !(DARK && k === DARK.k) && !(RELOAD && k === RELOAD.k) && s.stallMs > playMs * 0.1)) fail('卡顿太多（等待队友操作的时间超过 10%）'); // 断网 / 刷新那位自己离线的时间不算
  console.log(failed ? `真机联机测试失败 ${failed} 项` : `真机联机测试通过${finished ? '' : `（${MAXS} 秒内没打完，按已打部分判定）`}`);
  for (const c of bots) R(c, 'if (!B.left) { Lobby.leave(); Lobby.net.close(); }');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
main().catch((e) => { console.error(e); process.exit(1); });
