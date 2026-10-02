// 多人帧同步的确定性测试：每个玩家各自在一个独立的 JS 环境里跑同一局（Math.random 各不相同、粒子设置一高一低），
// 只交换每帧的操作，逐帧比对状态哈希；有一处分叉就报出第一帧和差异。
// 用法：node tools/mp-sim.js [js 目录] [关卡] [人数] [模式 direct|net] [丢包率] [延迟毫秒] [输入缓冲帧数]
//   direct：操作即时送达，专查“模拟是否确定”；net：走 net.js 的帧同步协议 + 模拟的丢包 / 延迟网络
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'js');
const stageArg = process.argv[3] || 'all', N = +(process.argv[4] || 2), MODE = process.argv[5] || 'direct', LOSS = +(process.argv[6] || 0.15), LAT = +(process.argv[7] || 80), DELAY = +(process.argv[8] || 4);
const DROP = process.argv[9] ? process.argv[9].split('@').map(Number) : null; // 例如 1@3000：第 1 号玩家在第 3000 帧掉线
const FILES = ['util', 'data', 'audio', 'input', 'art', 'mapart', 'world', 'foes', 'mapfx', 'offers', 'director', 'surprise', 'boss', 'captain', 'net'];
const noop = () => {};
function makeCtx(k) {
  const fakeCtx = new Proxy({}, { get: (t, key) => {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (key === 'createPattern') return () => ({});
    if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'measureText') return () => ({ width: 10 });
    if (key in t) return t[key];
    return noop;
  }, set: (t, key, v) => { t[key] = v; return true; } });
  let r = 9001 + k * 7919; // 每个环境的 Math.random 都不一样：玩法里漏用 Math.random 会立刻分叉
  const M = Object.create(Math); M.random = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x80000000; };
  const ctx = { console, Math: M, Date, JSON, performance: { now: () => ctx.__now }, __now: 0, setTimeout, clearTimeout, setInterval: () => 0,
    window: { addEventListener: noop, matchMedia: () => ({ matches: false }) }, document: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx, toDataURL: () => 'data:,' }), addEventListener: noop },
    navigator: { getGamepads: () => [] }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop } };
  ctx.__g = fakeCtx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of FILES) { const p = path.join(dir, f + '.js'); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f + '.js' }); }
  vm.runInContext(`
    var __settings = DEFAULT_SETTINGS(); __settings.particles = ${k % 2 ? "'low'" : "'full'"};
    function __bot(w, i) {
      const p = w.players[i]; if (!p || !p.alive) return { mx: 0, my: 0, burst: false };
      const mid = (TOP + BOTTOM) / 2; let tx = w.W * 0.22 + i * 30, ty = mid + (i - 0.5) * 60;
      let best = null, bd = 1e9; for (const e of w.enemies) { if (!e.alive || e.x < p.x + 30 || e.x > w.W) continue; const d = e.x - p.x + Math.abs(e.y - p.y) * 0.6 - (e.goal ? 260 : 0); if (d < bd) { bd = d; best = e; } }
      if (best) ty = best.y + (i - 0.5) * 24;
      if (w.boss && w.boss.plates) { const pl = w.boss.plates.find((q) => q.alive); if (pl) ty = w.boss.y + pl.dy; }
      const gt = w.guideTarget(); if (gt && i === w.beatIdx % w.players.length && !(w.ritual && w.ritual.st === 'choose')) { tx = Math.min(gt.x - 6, w.W * 0.8); ty = gt.y; }
      if (w.ritual && w.ritual.st === 'choose') { const G = w.ritual.gates[i % 2]; tx = G.x; ty = G.y; }
      let dodge = 0; for (const wr of w.warns) if (wr.kind === 'zone' && !wr.fired && p.y > wr.y - 20 && p.y < wr.y + wr.h + 20 && p.x > wr.x - 20 && p.x < wr.x + wr.w + 20) dodge += p.y < wr.y + wr.h / 2 ? -2 : 2;
      const gain = w.ritual && w.ritual.st === 'choose' ? 160 : 60; // 选卡时慢慢靠过去：有操作延迟时不容易冲过头
      return { mx: Math.sign(tx - p.x) * Math.min(1, Math.abs(tx - p.x) / gain), my: dodge ? Math.sign(dodge) : Math.sign(ty - p.y) * Math.min(1, Math.abs(ty - p.y) / (gain * 0.7)), burst: p.stock >= 1 && !w.ritual && !w.bursting, focus: false, dx: 0, dy: 0 };
    }`, ctx);
  return ctx;
}
const R = (ctx, code) => vm.runInContext(code, ctx);
function roster(n) { return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: `${i + 1}P`, plane: ['moon', 'candy', 'whale', 'clock'][i % 4], stats: null, ultCap: 2 })); }

function runDirect(stage, n) {
  const seed = 12345 + stage.charCodeAt(2) * 7;
  const ctxs = Array.from({ length: n }, (_, k) => makeCtx(k));
  ctxs.forEach((c, k) => { c.__roster = roster(n); R(c, `var __res = null; var __w = new World({ mode: 'run', W: 1280, stage: '${stage}', seed: ${seed}, players: __roster.map((r) => Object.assign({}, r, { stats: planeStats(null, r.plane) })), me: ${k}, settings: __settings, cb: { onEnd: (r) => { __res = r; } } });`); });
  let frame = 0;
  for (; frame < 30 * 900; frame++) {
    // 每个玩家只在自己那一端算自己的操作，再“发给”所有人（经过 net.js 的量化编码，和真实联机一致）
    const inputs = ctxs.map((c, k) => R(c, `NetCodec.decodeFrame(NetCodec.encodeFrame(__bot(__w, ${k})))`));
    // 0 号端在模拟步之间画画面、读 HUD（真实游戏里渲染穿插在步与步之间）；其他端不画：画面代码不许动到玩法状态
    ctxs.forEach((c, k) => { c.__inputs = inputs; R(c, `for (let s = 0; s < LOCKSTEP.steps; s++) { if (s === 0) __inputs.forEach((inp, j) => __w.setInput(j, inp)); __w.step(1 / 120); ${k === 0 ? 'if (s % 2) { __w.render(__g, { simpleBg: true }); __w.hud(); __w.events.length = 0; }' : ''} }`); });
    const hs = ctxs.map((c) => R(c, '__w.stateHash()'));
    if (hs.some((h) => h !== hs[0])) {
      const d = ctxs.map((c) => R(c, 'JSON.stringify(__w.stateDump())'));
      const a = JSON.parse(d[0]), b = JSON.parse(d.find((x, i) => hs[i] !== hs[0]));
      const diff = Object.keys(a).filter((k2) => JSON.stringify(a[k2]) !== JSON.stringify(b[k2])).map((k2) => `${k2}: ${JSON.stringify(a[k2]).slice(0, 300)} ≠ ${JSON.stringify(b[k2]).slice(0, 300)}`);
      return { stage, n, ok: false, frame, diff };
    }
    if (R(ctxs[0], '__w.done') ) break;
  }
  const res = R(ctxs[0], '__res && { win: __res.win, runT: Math.round(__res.runT), kills: __res.stats.kills }');
  // 每架飞机自己的 Build 和星砂（各端看到的必须一样；不同飞机之间应该各不相同）
  const per = R(ctxs[0], `JSON.stringify(__w.players.map((q) => ({ build: q.picks.map((o) => o.kind[0] + ':' + o.id).join('>'), dust: Math.round(q.res.dust), offers: q.res.offers })))`);
  const ends = ctxs.map((c) => R(c, '__res && JSON.stringify([__res.stats.dust, __res.stats.crystals, __res.build.gun])'));
  return { stage, n, ok: true, frames: frame, res, per: JSON.parse(per), myResults: ends };
}

async function runNet(stage, n) {
  const seed = 777 + stage.charCodeAt(2);
  const ctxs = Array.from({ length: n }, (_, k) => makeCtx(k));
  // 模拟网络：每端的“在场状态”按 30 次 / 秒发出，经过随机延迟和丢包送到其他端（真实的 Claude 房间也是这种语义：只保留最新、可能丢）
  let now = 0; const queue = [];
  const gone = Array(n).fill(false);
  const deliver = (from, obj) => { if (gone[from]) return; for (let k = 0; k < n; k++) { if (k === from || gone[k]) continue; if (Math.random() < LOSS) continue; queue.push({ at: now + LAT * (0.6 + Math.random() * 0.8), to: k, from, obj: JSON.parse(JSON.stringify(obj)) }); } };
  ctxs.forEach((c, k) => { c.__send = (obj) => deliver(k, obj); c.__roster = roster(n);
    c.__clock = () => now;
    R(c, `var __res = null; var __sess = new LockstepSession({ selfIndex: ${k}, n: ${n}, delay: ${DELAY}, isHost: ${k === 0}, clock: () => __clock(), send: (o) => __send(o) });
      var __w = new World({ mode: 'run', W: 1280, stage: '${stage}', seed: ${seed}, players: __roster.map((r) => Object.assign({}, r, { stats: planeStats(null, r.plane) })), me: ${k}, settings: __settings, cb: { onEnd: (r) => { __res = r; } } });`); });
  const hashes = ctxs.map(() => new Map());
  let maxFrame = 0, stalls = 0, ticks = 0; const stallBy = {};
  const TICK = 1000 / 30;
  while (true) {
    now += TICK; ticks++;
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) { const m = queue.shift(); ctxs[m.to].__msg = m.obj; R(ctxs[m.to], `__sess.receive(${m.from}, __msg)`); }
    let allDone = true;
    if (DROP && !gone[DROP[0]] && maxFrame >= DROP[1]) gone[DROP[0]] = true;
    for (let k = 0; k < n; k++) {
      const c = ctxs[k];
      if (gone[k]) continue;
      c.__conn = gone.map((g) => !g);
      R(c, `__sess.isHost = __conn.findIndex((x, j) => x && __sess.drops[j] === undefined) === __sess.me; __sess.hostCheckDrops(__conn);`);
      // 和游戏里一样按真实时间采样：第 k 帧在 (k - delay) 帧时刻采；卡住一阵后一次补齐（最多领先 runAhead）
      R(c, `while (__sess.nextLocal <= ${ticks} + __sess.delay) { if (!__sess.sample(__bot(__w, ${k}))) break; }`);
      // 按真实时间限速：第 f 帧要到它该发生的时刻才跑（提前到的操作就是缓冲，吸收网络抖动）；落后了一次最多追 catchUp 帧
      const ran = R(c, `(function(){ let ran = 0; while (ran < LOCKSTEP.catchUp && __sess.simFrame < ${ticks}) { const inp = __sess.next(); if (!inp) break; for (let s = 0; s < LOCKSTEP.steps; s++) { if (s === 0) inp.forEach((x, j) => __w.setInput(j, x)); __w.step(1 / 120); } __sess.simulated(__w.stateHash()); ran++; } return ran; })()`);
      if (!ran && R(c, '__sess.simFrame') < ticks) { stalls++; const b = Math.floor(ticks / 500) * 500; stallBy[b] = (stallBy[b] || 0) + 1; } // 该跑却缺操作：真正的卡顿
      R(c, `__sess.flush()`);
      const f = R(c, '__sess.simFrame'), h = R(c, '__sess.lastHash');
      hashes[k].set(f, h); maxFrame = Math.max(maxFrame, f);
      if (!R(c, '__w.done')) allDone = false;
      if (DROP && k !== DROP[0] && !c.__dropSeen && R(c, '__w.players[' + DROP[0] + '].gone')) { c.__dropSeen = R(c, '__sess.simFrame'); }
    }
    for (let f = Math.max(0, maxFrame - 5); f <= maxFrame; f++) { const hs = hashes.filter((m, k) => !gone[k]).map((m) => m.get(f)).filter((x) => x !== undefined); if (hs.length > 1 && hs.some((h) => h !== hs[0])) return { stage, n, ok: false, frame: f, note: 'net desync' }; }
    if (allDone || ticks > 30 * 1500) break;
  }
  const live = ctxs.find((c, k) => !gone[k]);
  const dropInfo = DROP ? ctxs.map((c, k) => (gone[k] ? 'left' : c.__dropSeen || 'never')) : null;
  const res = R(live, '__res && { win: __res.win, runT: Math.round(__res.runT) }') || R(live, '({ stuck: true, goal: __w.goal && __w.goal.id, D: __w.D && __w.D.st, rit: __w.ritual && __w.ritual.st, phase: __w.phase, alive: __w.players.map((q) => q.alive), runT: Math.round(__w.runT) })'), desync = ctxs.map((c) => R(c, '__sess.desync'));
  return { stage, n, ok: !desync.some(Boolean) && (!DROP || dropInfo.every((x) => x !== 'never')), dropInfo, frames: maxFrame, ticks, speed: +(maxFrame / ticks).toFixed(3), stallRate: +(stalls / (ticks * n)).toFixed(3), stallBy, res, desync };
}

(async () => {
  const stages = stageArg === 'all' ? ['1-1', '1-2', '1-3'] : [stageArg];
  let failed = 0;
  for (const st of stages) {
    const r = MODE === 'net' ? await runNet(st, N) : runDirect(st, N);
    console.log(JSON.stringify(r));
    if (!r.ok) failed++;
  }
  console.log(failed ? `多人同步测试失败 ${failed} 项` : '多人同步测试通过');
  process.exitCode = failed ? 1 : 0;
})();
