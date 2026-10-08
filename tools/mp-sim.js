// 多人帧同步的确定性测试：每个玩家各自在一个独立的 JS 环境里跑同一局（Math.random 各不相同、粒子设置一高一低），
// 只交换每帧的操作，逐帧比对状态哈希；有一处分叉就报出第一帧和差异。
// 用法：node tools/mp-sim.js [js 目录] [关卡] [人数] [模式 direct|net] [丢包率] [延迟毫秒] [输入缓冲帧数]
//   direct：操作即时送达，专查“模拟是否确定”；net：走 net.js 的帧同步协议 + 模拟的丢包 / 延迟网络
const fs = require('fs'), vm = require('vm'), path = require('path');
if (process.env.NETSEED) { let r = +process.env.NETSEED; Math.random = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x80000000; }; } // 网络模拟（延迟 / 丢包）可复现：NETSEED=数字
const dir = process.argv[2] || path.join(__dirname, '..', 'js');
const stageArg = process.argv[3] || 'all', N = +(process.argv[4] || 2), MODE = process.argv[5] || 'direct', LOSS = +(process.argv[6] || 0.15), LAT = +(process.argv[7] || 80), DELAY = +(process.argv[8] || 4);
const VSM = stageArg === 'vs'; // 对抗模式（v0.11）：stage 写 vs
// 关卡写 chain：第 1 章三关连成一局（§3.9），和真实合作一样从 1-1 打起，换关时也逐帧比对；
// 这是同步测试不是难度测试，所以给 12 级的属性，尽量把三关和两次换关都跑到
const CHAINED = (st) => st === 'chain';
const STATS_JS = (st) => (CHAINED(st) ? '(() => { const mm = freshMeta(); mm.shared.level = 12; mm.planes[r.plane] = newPlaneRecord(r.plane); return planeStats(mm, r.plane); })()' : 'planeStats(null, r.plane)');
const A9 = process.argv[9] || '';
const DROP = A9 && !A9.includes('~') ? A9.split('@').map(Number) : null; // 例如 1@3000：第 1 号玩家在第 3000 帧掉线（不回来）
const OUT = A9.includes('~') ? (([k, r]) => { const [f, d] = r.split('~').map(Number); return { k: +k, at: f, ticks: d }; })(A9.split('@')) : null; // 例如 1@2000~900：第 1 号玩家第 2000 帧起彻底断网 900 帧（30 秒）再回来
const FILES = ['i18n', 'util', 'data', 'gear', 'audio', 'input', 'art', 'spaceart', 'mapart', 'world', 'foes', 'mapfx', 'offers', 'loot', 'director', 'surprise', 'boss', 'priest', 'captain', 'spacefoes', 'racefoes', 'bigboss', 'vs', 'net'];
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
  ctx.__g = fakeCtx; ctx.__world = JSON.parse(JSON.stringify(WORLD)); ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of FILES) { const p = path.join(dir, f + '.js'); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f + '.js' }); }
  vm.runInContext(`
    var __ev = [], __vsSends = []; var __settings = DEFAULT_SETTINGS(); __settings.particles = ${k % 2 ? "'low'" : "'full'"};
    /* 对抗机器人：清自己航道的怪、优先打风塔守卫、洞口开了就进（按段交替选两种干扰）、侧风来了换到另一半；
       冲突区开放时 0 号贴着交界打，1 号有一半时间也进带子（让直攻真的发生） */
    function __vsBot(w, i) {
      const p = w.players[i], V = w.vs, L = V.lanes[i], mid = (L.top + L.bot) / 2;
      let tx = w.W * 0.22, ty = mid, best = null, bd = 1e9;
      for (const e of w.enemies) { if (!e.alive || e.lane !== i || e.x < p.x + 30 || e.x > w.W) continue; const d = e.x - p.x + Math.abs(e.y - p.y) * 0.6 - (e.vsGuard || e.vsInt ? 220 : 0); if (d < bd) { bd = d; best = e; } }
      if (best) ty = best.y;
      const holes = V.holes.filter((h) => h.lane === i && h.st === 'open');
      if (holes.length) { const H = holes.find((h) => h.kind === (V.stage % 2 ? 'wind' : 'armor')) || holes[0]; tx = H.x; ty = H.y; }
      else if (V.clash && (i === 0 || Math.floor(w.t / 6) % 2 === 0)) { // 冲突区：贴到交界，看到带子里的对手就对准他、绕到他身后开火
        ty = i === 0 ? L.bot + 30 : L.top - 30;
        const o = w.players.find((q) => q !== p && q.alive && w.vsInBand(q.y));
        if (o && w.vsInBand(p.y)) { ty = o.y; tx = Math.max(60, o.x - 220); }
      }
      if (L.wind && L.wind.st !== 'done') ty = L.wind.dir > 0 ? Math.min(L.bot - 30, L.wind.bot + 40) : Math.max(L.top + 30, L.wind.top - 40);
      if (w.ritual && w.ritual.st === 'choose') { const G = w.ritual.gates[i % 2]; tx = G.x; ty = G.y; }
      const gain = w.ritual && w.ritual.st === 'choose' ? 160 : 60;
      return { mx: Math.sign(tx - p.x) * Math.min(1, Math.abs(tx - p.x) / gain), my: Math.sign(ty - p.y) * Math.min(1, Math.abs(ty - p.y) / (gain * 0.7)), burst: p.stock >= 1 && !w.ritual && !w.bursting, focus: false, dx: 0, dy: 0 };
    }
    function __bot(w, i) {
      const p = w.players[i]; if (!p || !p.alive) return { mx: 0, my: 0, burst: false };
      if (${!!process.env.NOCHOOSE} && i === 1 && w.ritual && w.ritual.st === 'choose') return { mx: 0, my: 0, burst: false }; // NOCHOOSE=1：1 号选升级时一动不动（测限时自动选推荐）
      if (w.vs) return __vsBot(w, i);
      const mid = (TOP + BOTTOM) / 2; let tx = w.W * 0.22 + i * 30, ty = mid + (i - 0.5) * 60;
      let best = null, bd = 1e9; for (const e of w.enemies) { if (!e.alive || e.x < p.x + 30 || e.x > w.W) continue; const d = e.x - p.x + Math.abs(e.y - p.y) * 0.6 - (e.goal ? 260 : 0); if (d < bd) { bd = d; best = e; } }
      if (best) ty = best.y + (i - 0.5) * 24;
      if (w.boss && w.boss.plates) { const pl = w.boss.plates.find((q) => q.alive); if (pl) ty = w.boss.y + pl.dy; }
      const gt = w.guideTarget(); if (gt && i === w.beatIdx % w.players.length && !(w.ritual && w.ritual.st === 'choose')) { tx = Math.min(gt.x - 6, w.W * 0.8); ty = gt.y; }
      const tow = w.mapObjs.find((o) => o.state === 'tow' && o.by === i); if (tow && !(w.ritual && w.ritual.st === 'choose')) { const g2 = w.mapGoalPos(tow); if (g2) { tx = Math.min(g2.x - 6, w.W * 0.8); ty = g2.y; } } // 自己拖着的东西自己送到
      const mate = w.players.find((q) => q !== p && !q.alive && !q.gone); if (mate && !w.ritual) { tx = mate.x; ty = mate.y; } // 队友倒下：飞进救援圈
      if (w.ritual && w.ritual.st === 'choose') { const G = w.ritual.gates[i % 2]; tx = G.x; ty = G.y; }
      let dodge = 0; for (const wr of w.warns) if (wr.kind === 'zone' && !wr.fired && p.y > wr.y - 20 && p.y < wr.y + wr.h + 20 && p.x > wr.x - 20 && p.x < wr.x + wr.w + 20) dodge += p.y < wr.y + wr.h / 2 ? -2 : 2;
      const gain = w.ritual && w.ritual.st === 'choose' ? 160 : 60; // 选卡时慢慢靠过去：有操作延迟时不容易冲过头
      return { mx: Math.sign(tx - p.x) * Math.min(1, Math.abs(tx - p.x) / gain), my: dodge ? Math.sign(dodge) : Math.sign(ty - p.y) * Math.min(1, Math.abs(ty - p.y) / (gain * 0.7)), burst: p.stock >= 1 && !w.ritual && !w.bursting, focus: false, dx: 0, dy: 0 };
    }`, ctx);
  return ctx;
}
const R = (ctx, code) => vm.runInContext(code, ctx);
// 联机补全 v0.10：房间合并后的世界状态（多个要救的伙伴、上层云桥）也必须各端一致
const WORLD = { upper: true, targets: ['bunny', 'grandpa', 'merchant'], target: 'bunny', rescued: [], clue: true, beacon: false, scout: true };
function roster(n) { return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: `${i + 1}P`, plane: ['moon', 'candy', 'whale', 'clock'][i % 4], stats: null, ultCap: 2 })); }

function runDirect(stage, n) {
  const seed = 12345 + stage.charCodeAt(2) * 7;
  const ctxs = Array.from({ length: n }, (_, k) => makeCtx(k));
  ctxs.forEach((c, k) => { c.__roster = roster(n); R(c, `var __res = null; var __w = new World({ mode: 'run', W: 1280, stage: '${VSM || CHAINED(stage) ? '1-1' : stage}', vs: ${VSM}, chain: ${CHAINED(stage)}, seed: ${seed}, players: __roster.map((r) => Object.assign({}, r, { stats: ${STATS_JS(stage)} })), me: ${k}, settings: __settings, world: __world, cb: { onEnd: (r) => { __res = r; } } });`); });
  let frame = 0, teamSolo = 0, teamEarly = 0; const downs = { down: 0, revive: 0 };
  for (; frame < 30 * (CHAINED(stage) ? 2400 : 900); frame++) {
    // 每个玩家只在自己那一端算自己的操作，再“发给”所有人（经过 net.js 的量化编码，和真实联机一致）
    const inputs = ctxs.map((c, k) => R(c, `NetCodec.decodeFrame(NetCodec.encodeFrame(__bot(__w, ${k})))`));
    // 0 号端在模拟步之间画画面、读 HUD（真实游戏里渲染穿插在步与步之间）；其他端不画：画面代码不许动到玩法状态
    ctxs.forEach((c, k) => { c.__inputs = inputs; R(c, `for (let s = 0; s < LOCKSTEP.steps; s++) { if (s === 0) __inputs.forEach((inp, j) => __w.setInput(j, inp)); __w.step(1 / 120); ${k === 0 ? 'if (s % 2) { __w.viewOff = { x: 13.37, y: -7.1 }; __w.render(__g, { simpleBg: true }); __w.hud(); for (const e of __w.events.splice(0)) { __ev.push(e.type); if (e.type === "vsSend") __vsSends.push(e.kind); } }' : ''} }`); });
    const hs = ctxs.map((c) => R(c, '__w.stateHash()'));
    if (hs.some((h) => h !== hs[0])) {
      const d = ctxs.map((c) => R(c, 'JSON.stringify(__w.stateDump())'));
      const a = JSON.parse(d[0]), b = JSON.parse(d.find((x, i) => hs[i] !== hs[0]));
      const diff = Object.keys(a).filter((k2) => JSON.stringify(a[k2]) !== JSON.stringify(b[k2])).map((k2) => `${k2}: ${JSON.stringify(a[k2]).slice(0, 300)} ≠ ${JSON.stringify(b[k2]).slice(0, 300)}`);
      return { stage, n, ok: false, frame, diff };
    }
    // v0.11 §7：同一轮升级全队一起——有人在选，其他活着的人也都在仪式里（或等着）；有人还在选时没有人提前恢复
    const tr = R(ctxs[0], `(function(){ const L = __w.players.filter((q) => !q.gone && q.alive); const act = L.filter((q) => q.ritual && q.ritual.st !== 'resume');
      if (!act.length) return 0; const free = L.filter((q) => !q.ritual).length; const early = act.some((q) => q.ritual.st !== 'wait') && L.some((q) => q.ritual && q.ritual.st === 'resume'); return (free ? 1 : 0) | (early ? 2 : 0); })()`);
    if (tr & 1) teamSolo++; if (tr & 2) teamEarly++;
    for (const ev of R(ctxs[0], '__ev.splice(0).concat(__w.events.splice(0).map((e) => e.type))')) if (ev === 'down' || ev === 'revive') downs[ev]++;
    if (R(ctxs[0], '__w.done') ) break;
  }
  const res = R(ctxs[0], '__res && { win: __res.win, runT: Math.round(__res.runT), kills: __res.stats.kills, cleared: __res.cleared, end: __res.stage }');
  // 每架飞机自己的 Build 和星砂（各端看到的必须一样；不同飞机之间应该各不相同）
  const rescued = R(ctxs[0], '__w.m.rescuedNow.join(",") + " upper:" + __w.m.upperRoute');
  const per = R(ctxs[0], `JSON.stringify(__w.players.map((q) => ({ build: q.picks.map((o) => o.kind[0] + ':' + o.id).join('>'), dust: Math.round(q.res.dust), offers: q.res.offers })))`);
  const ends = ctxs.map((c) => R(c, '__res && JSON.stringify([__res.stats.dust, __res.stats.crystals, __res.build.gun])'));
  if (VSM) { // 对抗：每端算出的排名 / 分数必须一样；统计送出的干扰、直攻击毁
    const vs = ctxs.map((c) => R(c, '__res && __res.vs && JSON.stringify({ scores: __res.vs.scores, towers: __res.vs.towers, held: __res.vs.held, kos: __res.vs.kos, draw: __res.vs.draw, winner: __res.vs.winner, parts: __res.vs.parts })'));
    const V0 = vs[0] && JSON.parse(vs[0]), sumOk = !!V0 && V0.parts.every((P, k) => Object.values(P).reduce((a, b) => a + b, 0) === V0.scores[k]); // 分项合计 = 总分
    const sends = R(ctxs[0], '__vsSends'), same = vs.every((x) => x && x === vs[0]);
    return { stage: 'vs', n, ok: teamEarly === 0 && same && !!res && sumOk, sumOk, frames: frame, res, vs: vs[0] && JSON.parse(vs[0]), sends, team: { solo: teamSolo, early: teamEarly }, per: JSON.parse(per), myWins: ctxs.map((c) => R(c, '__res && __res.win')) };
  }
  const autoPicks = R(ctxs[0], '__w.players[1] ? __w.players[1].picks.length : 0'); // NOCHOOSE 时 1 号靠限时自动选也要拿到升级
  // teamSolo：有人在选升级时另一架活着的飞机不在仪式里（应该很少：只在倒下的人被救起后补选时出现）；teamEarly：有人还在选，别人已经恢复（必须是 0）
  return { stage, n, ok: teamEarly === 0 && (!process.env.NOCHOOSE || (autoPicks > 0 && !!res)), autoPicks, frames: frame, res, rescued, team: { solo: teamSolo, early: teamEarly }, downs, per: JSON.parse(per), myResults: ends };
}

async function runNet(stage, n) {
  const seed = 777 + stage.charCodeAt(2);
  const ctxs = Array.from({ length: n }, (_, k) => makeCtx(k));
  // 模拟网络：每端的“在场状态”按 30 次 / 秒发出，经过随机延迟和丢包送到其他端（真实的 Claude 房间也是这种语义：只保留最新、可能丢）
  let now = 0; const queue = [];
  const gone = Array(n).fill(false), dark = Array(n).fill(false); let outAt = null, outInfo = null, outSpan = null;
  const deliver = (from, obj) => { if (gone[from] || dark[from]) return; for (let k = 0; k < n; k++) { if (k === from || gone[k]) continue; if (Math.random() < LOSS) continue; queue.push({ at: now + LAT * (0.6 + Math.random() * 0.8), to: k, from, obj: JSON.parse(JSON.stringify(obj)) }); } };
  ctxs.forEach((c, k) => { c.__send = (obj) => deliver(k, obj); c.__roster = roster(n);
    c.__clock = () => now;
    R(c, `var __res = null, __replaying = false; var __sess = new LockstepSession({ selfIndex: ${k}, n: ${n}, delay: ${DELAY}, isHost: ${k === 0}, clock: () => __clock(), send: (o) => __send(o) });
      var __wopts = () => ({ mode: 'run', W: 1280, stage: '${VSM || CHAINED(stage) ? '1-1' : stage}', vs: ${VSM}, chain: ${CHAINED(stage)}, seed: ${seed}, players: __roster.map((r) => Object.assign({}, r, { stats: ${STATS_JS(stage)} })), me: ${k}, settings: __settings, world: __world, cb: { onEnd: (r) => { __res = r; } } });
      var __w = new World(__wopts());`); });
  const hashes = ctxs.map(() => new Map());
  let maxFrame = 0, stalls = 0, ticks = 0; const stallBy = {};
  const TICK = 1000 / 30;
  while (true) {
    now += TICK; ticks++;
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) { const m = queue.shift(); if (dark[m.to] || dark[m.from]) continue; ctxs[m.to].__msg = m.obj; R(ctxs[m.to], `__sess.receive(${m.from}, __msg)`);}
    if (OUT) {
      if (outAt === null && maxFrame >= OUT.at) { outAt = ticks; outSpan = { from: ctxs.map((c) => R(c, '__sess.simFrame')) }; }
      if (outAt !== null && ticks === outAt + OUT.ticks) outSpan.to = ctxs.map((c) => R(c, '__sess.simFrame')); // 断网结束时其他人推进到哪了
      dark[OUT.k] = outAt !== null && ticks < outAt + OUT.ticks;
    }
    let allDone = true;
    if (DROP && !gone[DROP[0]] && maxFrame >= DROP[1]) gone[DROP[0]] = true;
    for (let k = 0; k < n; k++) {
      const c = ctxs[k];
      if (gone[k]) continue;
      c.__conn = gone.map((g, j) => !g && !dark[j]); if (!dark[k]) R(c, '__sess.linkUp = __conn');
      if (!dark[k]) R(c, `__sess.isHost = __sess.hostIndex(__conn) === __sess.me; __sess.hostCheckDrops(__conn);`); // 断网的那位自己判断不了谁在线
      // 断线回来、本机多算过几帧：按完全相同的参数建一个新世界，从开局按认定的操作记录重算（和 MpDriver 一样）
      if (R(c, '__sess.needReplay')) { R(c, `__sess.needReplay = false; __sess.simFrame = 0; __sess.hashLog.clear(); __sess.desync = null; __replaying = true; __w = new World(__wopts());`); hashes[k].clear(); outInfo = outInfo || {}; outInfo.replays = (outInfo.replays || 0) + 1; }
      // 和游戏里一样按真实时间采样：第 k 帧在 (k - delay) 帧时刻采；卡住一阵后一次补齐（最多领先 runAhead）
      R(c, `while (__sess.nextLocal <= ${ticks} + __sess.delay) { if (!__sess.sample(__bot(__w, ${k}))) break; }`);
      // 按真实时间限速：第 f 帧要到它该发生的时刻才跑（提前到的操作就是缓冲，吸收网络抖动）；落后了一次最多追 catchUp 帧
      const ran = R(c, `(function(){ let ran = 0; while (ran < (__replaying ? 60 : LOCKSTEP.catchUp) && __sess.simFrame < ${ticks}) { const inp = __sess.next(); if (!inp) break; for (let s = 0; s < LOCKSTEP.steps; s++) { if (s === 0) inp.forEach((x, j) => __w.setInput(j, x)); __w.step(1 / 120); } __sess.simulated(__w.stateHash()); ran++; } return ran; })()`);
      if (!ran && R(c, '__sess.simFrame') < ticks) { stalls++; const b = Math.floor(ticks / 500) * 500; stallBy[b] = (stallBy[b] || 0) + 1; } // 该跑却缺操作：真正的卡顿
      R(c, `if (__replaying && __sess.simFrame >= ${ticks} - 8) __replaying = false; if (__sess.awayMe && !__replaying && __sess.simFrame >= ${ticks} - 8) __sess.ready = Math.max(__sess.nextLocal, __sess.simFrame + __sess.delay);`);
      R(c, `__sess.flush()`);
      const f = R(c, '__sess.simFrame'), h = R(c, '__sess.lastHash');
      hashes[k].set(f, h); maxFrame = Math.max(maxFrame, f);
      if (!R(c, '__w.done')) allDone = false;
      if (DROP && k !== DROP[0] && !c.__dropSeen && R(c, '__w.players[' + DROP[0] + '].gone')) { c.__dropSeen = R(c, '__sess.simFrame'); }
    }
    const away = ctxs.map((c, k) => dark[k] || !!R(c, '__sess.awayMe || __replaying')); // 断线 / 追帧中的那位暂时不参与比对（回来后必须重新一致）
    for (let f = Math.max(0, maxFrame - 5); f <= maxFrame; f++) { const hs = hashes.filter((m, k) => !gone[k] && !away[k]).map((m) => m.get(f)).filter((x) => x !== undefined); if (hs.length > 1 && hs.some((h) => h !== hs[0])) return { stage, n, ok: false, frame: f, note: 'net desync', why: ctxs.map((c, k) => gone[k] ? 'gone' : R(c, 'JSON.stringify({ sim: __sess.simFrame, drops: __sess.drops, aways: __sess.aways.map((L) => L.map((r) => [r[0], r[1] === Infinity ? null : r[1]])), host: __sess.isHost, gone2: __w.players.map((q) => q.gone ? 1 : q.away ? "a" : 0).join("") })')) }; }
    if (allDone || ticks > 30 * 1500) break;
  }
  const live = ctxs.find((c, k) => !gone[k]);
  const dropInfo = DROP ? ctxs.map((c, k) => (gone[k] ? 'left' : c.__dropSeen || 'never')) : null;
  const res = R(live, '__res && { win: __res.win, runT: Math.round(__res.runT) }') || R(live, '({ stuck: true, goal: __w.goal && __w.goal.id, D: __w.D && __w.D.st, rit: __w.ritual && __w.ritual.st, phase: __w.phase, alive: __w.players.map((q) => q.alive), away: __w.players.map((q) => !!q.away), queues: __w.players.map((q) => q.ritualQueue.length + "/" + (q.ritual ? q.ritual.st : "-")), map: __w.mapObjs.map((o) => o.kind + "/" + o.state + "/" + Math.round(o.x) + "/by" + o.by + (o.pod ? "/pod" + Math.round(o.pod.x) + "," + Math.round(o.pod.y) + "/dock" + Math.round(o.dock.x) + "," + Math.round(o.dock.y) : "") + (o.core ? "/core" + Math.round(o.core.x) + "," + Math.round(o.core.y) + "/wall" + Math.round(o.wall.x) + "," + Math.round(o.wall.y) : "")), pl: __w.players.map((q) => Math.round(q.x) + "," + Math.round(q.y)), beat: __w.beatIdx, props: (__w.props || []).map((p) => p.kind), reward: __w.D && __w.D.reward, runT: Math.round(__w.runT) })'), desync = ctxs.map((c) => R(c, '__sess.desync'));
  // 断网测试：那位必须被判“断线中”、回来后恢复（不是被移除），最后和大家一样打完、状态一致
  const outRes = OUT ? Object.assign({ aways: R(ctxs[0], `JSON.stringify(__sess.aways.map((L) => L.map((r) => [r[0], r[1] === Infinity ? null : r[1]])))`), dropped: R(ctxs[0], `__sess.drops[${OUT.k}] !== undefined`), backDone: R(ctxs[OUT.k], '__w.done'), backKicked: R(ctxs[OUT.k], '__sess.kicked !== undefined') }, outInfo || {}) : null;
  // 断网期间其他人不能干等：判定断线最多花几秒，剩下的时间要照常推进
  if (OUT && outSpan && outSpan.to) outRes.othersMoved = Math.min(...ctxs.map((c, k) => (k === OUT.k ? Infinity : outSpan.to[k] - outSpan.from[k])));
  const outOk = !OUT || (!outRes.dropped && !outRes.backKicked && outRes.backDone && JSON.parse(outRes.aways)[OUT.k].length > 0 && JSON.parse(outRes.aways)[OUT.k].every((r) => r[1] !== null) && outRes.othersMoved >= OUT.ticks - 150);
  return { stage, n, ok: !desync.some(Boolean) && (!DROP || dropInfo.every((x) => x !== 'never')) && outOk, out: outRes, dropInfo, frames: maxFrame, ticks, speed: +(maxFrame / ticks).toFixed(3), stallRate: +(stalls / (ticks * n)).toFixed(3), stallBy, res, desync };
}

(async () => {
  // all：连成一局（从 1-1 打起、两次换关）+ 单独的 1-3（连打时机器人可能倒在 1-2，最后一关的内容也要比对到）
  const stages = stageArg === 'all' ? ['chain', '1-3'] : [stageArg];
  let failed = 0;
  for (const st of stages) {
    const r = MODE === 'net' ? await runNet(st, N) : runDirect(st, N);
    console.log(JSON.stringify(r));
    if (!r.ok) failed++;
  }
  console.log(failed ? `多人同步测试失败 ${failed} 项` : '多人同步测试通过');
  process.exitCode = failed ? 1 : 0;
})();
