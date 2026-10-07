// 构筑报告 + 节奏报告（金牌制作人 L2：先量再改）。机器人按每个流派（BUILD_PATHS）去追 Build，打第一章三关，会受伤、会输。
// 用法：node tools/report-sim.js [js 目录] [每个流派每关几局，默认 3] [关卡，逗号分隔，默认 1-1,1-2,1-3] [--gate]
//   构筑报告：各流派 / 各飞机胜率差、每局拿到几种能力、局与局重合度、只加数字的选择占比、第一个成型件（联动）出现时间
//   节奏报告：每秒采一次 World.pacing()，强度曲线、第一次行动、推压-喘息循环、最长平静 / 最长高压、最长无奖励、输局聚集、不公平受击、火力成长
//   --gate：有 WARN 时退出码为 1
//   难度（和构筑挂钩，见 docs/design.md §3.5）：--human 机器人按普通玩家（反应 0.25 秒、会走神、瞄不准）；
//   --archetypes 流派名或序号,…,random,rec（random = 每次随机拿、从不规划的新手；rec = 总按游戏推荐选；默认全部流派）；--jobs J 并行
const { load } = require('./sim-env');
const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const VALUED = new Set(['--archetypes', '--jobs', '--worker', '--eval', '--ladder', '--lv', '--career', '--runs-per']);
const args = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const gate = argv.includes('--gate'), HUMAN = argv.includes('--human'), JOBS = +(flag('jobs') || 1), WORKER = flag('worker');
const LAD = +(flag('ladder') || 0), LV = flag('lv') ? +flag('lv') : 0, FIRSTF = argv.includes('--first'), CAREER = +(flag('career') || 0), CHAIN = !argv.includes('--single'); // 默认三关连成一局（--single：只打一关）; // 梦魇级、共享等级（默认关卡建议等级）、按第一局的规则、连续玩的玩家数
const { R } = load(args[0]);
/* 目标从设计文档读（docs/design.md 里的 ```json report-targets 块，每个数写明从梦潮自己的哪个量推出来）；读不到才用兜底值。警告是提醒回头想，不是标准答案 */
const TARGETS = (() => {
  const fb = { difficulty: { loS: 0.8, loWin: 25, hiS: 1.25, hiWin: 75, breakS: 2, rareAt: 150, onBuildK: 1.3, pathSpread: 0.35, stages: {}, ladderTopRec: [0.9, 1.2] }, career: { firstBoss: 80, clearMedian: [2, 99], clearP25: 2, quietMax: 4 } };
  try {
    const md = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'design.md'), 'utf8'), m = md.match(/```json report-targets\n([\s\S]*?)\n```/);
    if (!m) return fb; const t = JSON.parse(m[1]);
    return { difficulty: Object.assign(fb.difficulty, t.difficulty || {}), career: Object.assign(fb.career, t.career || {}), from: 'docs/design.md' };
  } catch (e) { console.error('读设计文档的目标失败，用兜底值：' + e.message); return fb; }
})();
if (flag('eval')) R(flag('eval')); // 调参试验：--eval "BUILD_CHECK.rage.max = 2"（子进程同样执行）
const N = +(args[1] || 3), STAGES_RUN = (args[2] || '1-1,1-2,1-3').split(',');

R(`
/* 只改数字、不改打法的升级：穿透多穿几个、追踪拐得更急、分身打得更快、大招改造二级（更多 / 更大）、资源类 */
var STAT_ONLY = new Set(['pierce:2', 'pierce:3', 'homing:2', 'wing:3', 'thunderB:2', 'bombB:2', 'dustB:2']);
function statOnly(o) {
  if (o.kind === 'res') return true;
  if (o.kind === 'link' || !(o.from > 0)) return false;
  for (let l = o.from + 1; l <= o.to; l++) if (!STAT_ONLY.has(o.id + ':' + l)) return false;
  return true;
}
/* 追一个流派：先拿它缺的件，再拿它的联动；不拿会换掉流派件的支援 */
function aimAt(P) {
  const comps = P.path.filter((x) => !x.includes('+')), link = P.path.find((x) => x.includes('+'));
  const sc0 = (o) => {
    if (o.kind === 'link') return o.id === link ? 100 : 30;
    if (o.kind === 'support' && o.replace && comps.includes(o.replace.id)) return -50;
    if ((o.kind === 'gun' || o.kind === 'support') && comps.includes(o.id)) { const core = link ? SYNERGIES[link].need : comps, need = (G.world && G.world.linkNeed()) || 2; return core.includes(o.id) && (o.from || 0) < need ? 70 : core.includes(o.id) && o.from < 3 ? 45 : o.from > 0 ? 30 : 60; } // 联动的两件先各升到够接联动的级、再升满，再去升别的
    if (o.from > 0) return 20;
    return o.kind === 'bmod' ? 10 : 15;
  };
  const sc = (o) => sc0(o) + (o.qUp && P.path.includes(o.id) ? 25 * o.qUp : 0); // 会规划的人也看品质：自己流派的高品质件优先
  return (gs) => (sc(gs[1].opt) > sc(gs[0].opt) ? gs[1] : gs[0]);
}
var PATH_LINKS = new Set(BUILD_PATHS.map((P) => P.path.find((x) => x.includes('+'))));
/* 随机乱选：每次升级随机拿一个（同一次仪式里选定不变），从不规划；随机只用状态哈希 */
function randomPick(seed) { let n = 0, lastR = null, c = 0; return (gs) => { const r = (G.world && G.world.ritual) || gs; if (r !== lastR) { lastR = r; c = Math.floor(pilotHash(n++, seed) * gs.length); } return gs[Math.min(c, gs.length - 1)]; }; }
var G = {};
function buildPowerLv(w) { const p = w.player; return Object.values(p.gun || {}).reduce((a, b) => a + b, 0) + (p.support ? p.support.ulv : 0) + (p.links ? p.links.size * 2 : 0); } // 这一刻构筑攒了多少级（看构筑一路长大）
/* 连续玩（DE19）：一个玩家从新存档开始带着局外成长连续打；打还没通的最前面一关，通了 1-3 就打最高的梦魇级；
   照游戏推荐选（像按大招键的玩家）；结算和 ui.js 的 onRunEnd 一样；星尘够就升共享等级；每局另算 60 秒菜单和家园时间 */
function careerRun(seed, maxRuns, human, maxHours) {
  const plane = PLANE_ORDER[0], meta = freshMeta(); meta.planes[plane] = newPlaneRecord(plane); meta.planes[plane].map = genStarMap(plane, seed); // 天赋树按种子生成（可复现）
  const rec = meta.planes[plane], P = meta.progress, OVER = 60, log = []; let hours = 0, prevPow = null;
  for (let r = 0; r < maxRuns && hours < maxHours; r++) {
    // 玩家在学：头 2.5 小时从新手（反应 0.45 秒、常走神、瞄不准、常随手拿）长到普通玩家（0.25 秒，照推荐选）
    const k = Math.min(1, hours / 2.5), hum = { react: 0.45 - 0.2 * k, slip: 0.3 - 0.18 * k, aim: 26 - 12 * k }, mix = 0.45 + 0.5 * k;
    // 三关连成一局：每局从 1-1 打起；首通以后打最高的梦魇级
    const lad = P.cleared['1-3'] ? P.ladder || 0 : 0;
    const cap = ULT_CAP.reduce((c, u) => (!u.need || P.cleared[u.need] ? Math.max(c, u.cap) : c), 1);
    const st0 = planeStats(meta, plane), pow = st0.dmgK * st0.hearts, lv0 = meta.shared.level; // 开局看得见的战力：攻击 × 心数
    const x = reportRun('1-1', -2, plane, (seed * 131 + r * 7919) >>> 0, human, { meta, ladder: lad, first: r === 0, ult: cap, hum, mix, chain: true });
    const news = []; let pay = 0;
    for (const id of x.cleared) { const fc = !P.cleared[id]; pay += endPay(STAGES[id], fc); if (fc) { news.push('clear ' + id); P.cleared[id] = true; } } // 每打倒一关的首领给一份通关奖励（首次更多）
    const dust = Math.round((x.earned + pay + Math.floor(x.sand / 50)) * (1 + LADDER_PAY * lad));
    meta.stardust += dust;
    if (x.won && lad < LADDER_MAX && lad + 1 > (P.ladder || 0)) { P.ladder = lad + 1; news.push('ladder ' + P.ladder); }
    const stage = x.reached;
    while (meta.shared.level < SHARED.max && meta.stardust >= SHARED.cost[meta.shared.level + 1]) { meta.stardust -= SHARED.cost[meta.shared.level + 1]; meta.shared.level++; news.push('lv ' + meta.shared.level); }
    while (treePoints(meta, rec) > 0) { const rr = recommendNode(rec); if (!rr) break; rec.lit[rr]++; } // 天赋点按推荐点亮
    hours += (x.t + OVER) / 3600;
    log.push({ r, stage, cleared: x.cleared, fights: (x.bosses || []).map((b) => [b.stage, b.strength, b.won]), lad, won: x.won, f: x.formed, t: x.t, h: Math.round(hours * 100) / 100, dust, lv: meta.shared.level, lv0, s: x.strength, rare: x.rare, on: x.rareOnBuild, news, stronger: prevPow === null ? null : pow > prevPow + 1e-9 });
    prevPow = pow;
  }
  return log;
}
/* 一局：opt = { ladder 梦魇级, first 第一局, lv 共享等级（不给就用关卡的建议等级）, meta 连续玩时带着的局外进度, ult 大招容量 } */
function reportRun(stage, archIdx, plane, seed, human, opt) {
  opt = opt || {};
  const S = STAGES[stage], P = archIdx < 0 ? null : BUILD_PATHS[archIdx]; let res = null;
  const meta = opt.meta || freshMeta(); if (!opt.meta) { meta.shared.level = opt.lv || S.rec; meta.planes[plane] = newPlaneRecord(plane); }
  const w = new World({ mode: 'run', W: 1280, plane, stage, seed, ultCap: opt.ult || S.ult, stats: planeStats(meta, plane), target: P ? P.name : undefined, settings, ladder: opt.ladder || 0, first: !!opt.first, chain: !!opt.chain, cb: { onEnd: (r) => res = r } });
  G.world = w; w.pilotPickFn = P ? aimAt(P) : archIdx === -2 ? (gs) => gs[w.recIndex(w.ritual)] || gs[0] : randomPick(seed); // -2：照游戏推荐选（按大招键的新手）
  if (archIdx === -2 && opt.mix !== undefined) { const rp = randomPick(seed); let lastR = null, useRec = true, n = 0; w.pilotPickFn = (gs) => { if (w.ritual !== lastR) { lastR = w.ritual; useRec = pilotHash(n++, seed + 3) < opt.mix; } return useRec ? gs[w.recIndex(w.ritual)] || gs[0] : rp(gs); }; } // 还在学的玩家：mix 的概率照推荐，其余随手拿
  if (human) w.pilotHuman = Object.assign({ react: 0.25, slip: 0.12, aim: 14, seed }, opt.hum || {});
  const STEP = 1 / 120; let t = 0, frames = 0, keyAt = null, archAt = null, formedAt = null, bossT = 0, bossD0 = 0, bossD = 0;
  // 每个首领一份探针（连成一局时一局有好几个首领）：打掉的生命、自愈回来的、打了多久、期限
  const fights = []; let cur = null;
  const _regen = w.bossRegen.bind(w); w.bossRegen = (b, cap, dt) => { const h0 = b.hp; _regen(b, cap, dt); if (cur && b === cur.obj && b.hp > h0) cur.regen += b.hp - h0; };
  const pickT = []; const picks = [], pace = []; let stat = 0;
  const unfairSrc = {}, _hurt = w.hurtPlayer.bind(w);
  w.hurtPlayer = (n, src, who) => { const u0 = w.m.unfair; _hurt(n, src, who); if (w.m.unfair > u0) unfairSrc[src] = (unfairSrc[src] || 0) + 1; };
  const _apply = w.applyOption.bind(w);
  w.applyOption = (o) => {
    picks.push(o.kind === 'link' ? o.id : o.id); pickT.push(Math.round(t)); if (statOnly(o)) stat++;
    if (o.kind === 'link' && keyAt === null) keyAt = Math.round(t);
    if (o.kind === 'link' && P && P.path.includes(o.id)) archAt = Math.round(t);
    if (o.kind === 'link' && formedAt === null && PATH_LINKS.has(o.id)) formedAt = Math.round(t); // 成型：某个流派的启动件 + 回报件 + 它们的联动（倍增件）都到手
    _apply(o);
  };
  while (t < (opt.chain ? 2400 : 1200)) {
    pilot(w); w.step(STEP); t += STEP; __now += STEP * 1000; frames++;
    // 构筑强度：首领战里每秒真正打掉的首领生命（不算自愈回来的）
    if (w.boss && (!cur || cur.obj !== w.boss)) { const b = w.boss, h = b.hit.bind(b), B0 = w.bossBudget(); cur = { obj: b, stage: w.stageId, hp: 0, regen: 0, t: 0, max: b.maxHp, T: B0.T, picks: picks.length, lv: buildPowerLv(w) }; fights.push(cur); b.hit = (o) => { const h0 = b.hp; h(o); if (b.hp < h0) cur && b === cur.obj && (cur.hp += h0 - b.hp); }; bossT = 0; bossD0 = w.m.dmgOut; }
    if (w.phase === 'boss' && w.boss && w.bossIntroT <= 0 && cur) { cur.t += STEP; bossT += STEP; bossD = w.m.dmgOut - bossD0; }
    w.events.length = 0;
    // 每秒一个样本；结束后再采一秒就停（胜利演出还在走，等结算回调）
    if (frames % 120 === 0 && !(pace.length > 1 && pace[pace.length - 1].over && pace[pace.length - 2].over)) pace.push(w.pacing());
    if (res) break;
  }
  // 构筑强度 = 期限 ÷ 按这一场的净进度（打掉的 − 自愈回来的）打完要多久：1 = 正好在超载那一刻打完（第一个首领不考，但照样按名义期限算）
  const cl = (w.cleared || []).map((c) => c.id), bosses = fights.map((f) => ({ stage: f.stage, won: cl.includes(f.stage), picks: f.picks, strength: f.t >= 5 && f.max > 0 ? Math.round(((f.T * Math.max(0, (f.hp - f.regen) / f.t)) / f.max) * 100) / 100 : null }));
  const strength = bosses.length ? bosses[bosses.length - 1].strength : null;
  const pr = w.player.res; // 高品质件：拿到几件、其中几件对路、第一件在第几秒
  return { stage, reached: w.stageId, cleared: cl, bosses, archetype: P ? P.name : archIdx === -2 ? 'rec' : 'random', strength, ladder: w.ladder, lv: meta.shared.level, rare: pr.rare || 0, rareOnBuild: w.player.rareOn || 0, rareAt: pr.rareAt === undefined ? null : Math.round(pr.rareAt), earned: Math.floor(w.m.earned || 0), sand: Math.floor(pr.dust || 0), character: plane, won: !!(res && res.win), picks, statOnly: stat, keyAt, archAt, formed: formedAt !== null, formedAt, t: Math.round(t), bossT: Math.round(bossT), bdps: bossT > 5 ? Math.round(bossD / bossT) : null, pickT, secs: Math.round(t), hurt: res && res.hurt, last: res && res.lastHurt, unfairSrc, lurkKills: w.m.lurkKills || 0, pace };
}
`);

const sums = [], paces = [];
const names = R('BUILD_PATHS.map((P) => P.name)'), planes = R('PLANE_ORDER.slice()'), LADDER_MAX_N = R('LADDER_MAX'), STAGE_ORDER_N = R('STAGE_ORDER.slice()');
const ARCH = (flag('archetypes') || 'all').split(',').flatMap((x) => (x === 'all' ? names.map((_, i) => i) : x === 'random' ? [-1] : x === 'rec' ? [-2] : [/^\d+$/.test(x) ? +x : names.indexOf(x)]));
if (ARCH.some((a) => a < -2 || a >= names.length)) throw new Error('未知流派：' + flag('archetypes'));
const jobs = []; let k = 0;
for (const st of CHAIN ? ['1-1'] : STAGES_RUN) for (const a of ARCH) for (let r = 0; r < (CHAIN ? N * STAGES_RUN.length : N); r++) { jobs.push({ st, a, plane: planes[((a < 0 ? names.length - a - 1 : a) + r) % planes.length], seed: 9001 + k * 7919, i: k }); k++; }
const runJob = (j) => R(`reportRun('${j.st}', ${j.a}, '${j.plane}', ${j.seed}, ${HUMAN}, ${JSON.stringify({ ladder: LAD, first: FIRSTF, lv: CHAIN ? LV || 1 : LV, chain: CHAIN })})`);
if (WORKER && CAREER) { // 连续玩：每个子进程跑分到的那几个玩家
  const [wi, wn] = WORKER.split('/').map(Number);
  for (let i = 0; i < CAREER; i++) if (i % wn === wi) process.stdout.write('CAR ' + JSON.stringify({ i, log: R(`careerRun(${4001 + i * 97}, ${+(process.env.CAREER_RUNS || 120)}, ${HUMAN}, 20)`) }) + '\n');
  return;
}
if (WORKER) { // 并行的子进程：只跑分到的那几局，一行一局
  const [wi, wn] = WORKER.split('/').map(Number);
  for (const j of jobs) if (j.i % wn === wi) process.stdout.write('RUN ' + JSON.stringify(Object.assign(runJob(j), { i: j.i })) + '\n');
  return; // CommonJS 顶层 return：等输出写完再自然退出（process.exit 会截掉管道里没写完的行）
}
(async () => {
if (CAREER) return careerReport();
const results = [];
if (JOBS > 1) {
  const { spawn } = require('child_process');
  const passthru = argv.filter((a, i) => a !== '--jobs' && argv[i - 1] !== '--jobs');
  await Promise.all(Array.from({ length: JOBS }, (_, wi) => new Promise((ok, bad) => {
    const c = spawn(process.execPath, [__filename, ...passthru, '--worker', `${wi}/${JOBS}`], { stdio: ['ignore', 'pipe', 'inherit'] }); let buf = '';
    c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); if (line.startsWith('RUN ')) results.push(JSON.parse(line.slice(4))); } });
    c.on('exit', (code) => (code ? bad(new Error('子进程失败 ' + code)) : ok()));
  })));
  results.sort((a, b) => a.i - b.i);
} else for (const j of jobs) results.push(Object.assign(runJob(j), { i: j.i }));
for (const s of results) { paces.push(s.pace); delete s.pace; delete s.i; sums.push(s); console.log(JSON.stringify(s)); }

const warn = [];
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

/* ---------- 构筑报告（玩家最常骂的：运气左右、局局一样、一条路最强、升级只加数字、Build 一直不成型） ---------- */
console.log(`\n构筑报告（${sums.length} 局，关卡 ${STAGES_RUN.join(' / ')}）`);
console.log(`  总胜率 ${pct(sums.filter((s) => s.won).length, sums.length)}%`);
for (const st of [...new Set(sums.map((x) => x.stage))]) { const L = sums.filter((s) => s.stage === st); console.log(`  ${st} 胜率 ${pct(L.filter((s) => s.won).length, L.length)}%（${L.length}）`); }
const spread = (key, label, unit) => {
  const by = {}; for (const s of sums) if (s.archetype !== 'random' && s.archetype !== 'rec') (by[s[key]] = by[s[key]] || []).push(s.won); // 随机乱选单独看（难度一节），不算流派强弱
  const rates = Object.entries(by).map(([x, w]) => [x, pct(w.filter(Boolean).length, w.length), w.length]);
  console.log(`  各${label}：` + rates.map(([x, p, n]) => `${x} ${p}%（${n}）`).join('，'));
  const hi = Math.max(...rates.map((q) => q[1])), lo = Math.min(...rates.map((q) => q[1]));
  if (hi - lo > 25) warn.push(`${label}胜率差 ${hi - lo} 个百分点：${unit}`);
};
spread('archetype', '流派', '有一条路太强或有一条是陷阱');
spread('character', '飞机', '有一架飞机太强或太弱');
const sets = sums.filter((s) => s.archetype !== 'random' && s.archetype !== 'rec').map((s) => new Set(s.picks)); // 构筑多样性只看有计划的流派（照推荐选的局天然一样）
const mean = sets.reduce((a, p) => a + p.size, 0) / Math.max(1, sets.length);
let ov = 0, kk = 0;
for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < Math.min(sets.length, i + 20); j++) {
  const inter = [...sets[i]].filter((x) => sets[j].has(x)).length, uni = new Set([...sets[i], ...sets[j]]).size;
  if (uni) { ov += inter / uni; kk++; }
}
const all = new Set(sets.flatMap((p) => [...p]));
console.log(`  每局拿到 ${mean.toFixed(1)} 种能力；所有局一共见过 ${all.size} 种；局与局重合度 ${(ov / Math.max(1, kk)).toFixed(2)}`);
if (ov / Math.max(1, kk) > 0.6) warn.push('局与局重合太多：内容会显得重复');
const so = sums.filter((s) => s.picks.length);
const share = so.reduce((a, s) => a + s.statOnly / s.picks.length, 0) / Math.max(1, so.length);
console.log(`  只加数字的选择占 ${Math.round(share * 100)}%（每局平均选 ${(so.reduce((a, s) => a + s.picks.length, 0) / Math.max(1, so.length)).toFixed(1)} 次）`);
if (share > 0.5) warn.push('大多数选择只加数字：打法没变化');
const keys = sums.map((s) => s.keyAt).filter((x) => typeof x === 'number');
console.log(`  第一个成型件（联动）：中位 ${med(keys)} 秒，${sums.length - keys.length} 局一直没有`);
if (sums.length - keys.length > sums.length / 3) warn.push('超过三分之一的局一直没拿到成型件：Build 不成型');
const arch = {}; for (const s of sums) { const A = (arch[s.archetype] = arch[s.archetype] || { n: 0, done: 0, at: [] }); A.n++; if (s.archAt !== null) { A.done++; A.at.push(s.archAt); } }
console.log('  追到目标流派的联动：' + Object.entries(arch).map(([x, A]) => `${x} ${pct(A.done, A.n)}%${A.at.length ? ' @' + med(A.at) + 's' : ''}`).join('，'));

/* ---------- 节奏报告（每秒一个样本） ---------- */
const T = { calmMax: 40, peakMax: 60, droughtMax: 75, firstAction: 8, ramp: 1.3, spike: 0.4, calm: 0.25, peak: 0.85, powerGrowth: 2 };
// 出怪方向：按强度三等分，比较最平静的三分之一和最紧张的三分之一里“最近几秒威胁来自几个方向”
const sidesOf = (r, xs) => {
  const sd = r.map((p, i) => [xs[i], p.sides]).filter(([, v]) => v != null).sort((a, b) => a[0] - b[0]);
  if (sd.length < 9) return { sidesCalm: null, sidesPeak: null, sidesMax: null };
  const st = Math.max(1, Math.floor(sd.length / 3)), av = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { sidesCalm: av(sd.slice(0, st).map((x) => x[1])), sidesPeak: av(sd.slice(-st).map((x) => x[1])), sidesMax: Math.max(...sd.map((x) => x[1])) };
};
const per = paces.map((r) => {
  const xs = r.map((p) => p.intensity || 0), act = xs.filter((x) => x > 0).sort((a, b) => a - b), mx = Math.max(...xs, 0);
  const base = act.length ? act[Math.floor(act.length * 0.75)] : 1;
  let calm = 0, calmRun = 0, peak = 0, peakRun = 0, first = null, cycles = 0, high = false, drought = 0, last = 0, since = 0;
  xs.forEach((x, i) => {
    if (first == null && x > 0) first = i;
    calmRun = first != null && x < base * T.calm ? calmRun + 1 : 0; calm = Math.max(calm, calmRun);
    peakRun = x > mx * T.peak ? peakRun + 1 : 0; peak = Math.max(peak, peakRun);
    if (!high && x > base * 0.8) high = true; else if (high && x < base * 0.4) { high = false; cycles++; }
    const rw = r[i].rewards || 0;
    if (rw > last) { last = rw; since = 0; } else { since++; drought = Math.max(drought, since); }
  });
  const third = Math.max(1, Math.floor(xs.length / 3)), avg = (a) => a.reduce((s2, v) => s2 + v, 0) / Math.max(1, a.length);
  const end = r.findIndex((p) => p.over);
  const pw = r.map((p) => p.power).filter((v) => v > 0), pthird = Math.max(1, Math.floor(pw.length / 3));
  return { len: xs.length, calm, peak, first: first == null ? xs.length : first, cycles, ramp: avg(xs.slice(-third)) / Math.max(1e-9, avg(xs.slice(0, third))),
    power: pw.length >= 6 ? avg(pw.slice(-pthird)) / Math.max(1e-9, avg(pw.slice(0, pthird))) : null, drought, ...sidesOf(r, xs), rewards: r.length ? r[r.length - 1].rewards || 0 : 0, unfair: r.length ? r[r.length - 1].unfair || 0 : 0,
    end: end < 0 ? null : end, won: end >= 0 ? !!r[end].won : null,
    phases: r.reduce((m, p) => { if (p.phase != null) m[p.phase] = (m[p.phase] || 0) + 1; return m; }, {}) };
});
const maxLen = Math.max(...paces.map((r) => r.length)), bucket = Math.max(10, Math.round(maxLen / 24)), curve = [];
for (let t = 0; t < maxLen; t += bucket) { const vals = paces.flatMap((r) => r.slice(t, t + bucket).map((p) => p.intensity || 0)); if (vals.length) curve.push(vals.reduce((a, b) => a + b, 0) / vals.length); }
const top = Math.max(...curve, 1e-9), bars = ' ▁▂▃▄▅▆▇█';
const m = (key) => med(per.map((x) => x[key]).filter((v) => v != null));
console.log(`\n节奏报告（${paces.length} 局，每格 ${bucket} 秒）`);
console.log('  强度  ' + curve.map((v) => bars[Math.min(8, Math.round((v / top) * 8))]).join('') + `   (0 → ${Math.round(curve.length * bucket)} 秒)`);
for (const st of [...new Set(sums.map((x) => x.stage))]) {
  const L = per.filter((_, i) => sums[i].stage === st), mm = (key) => med(L.map((x) => x[key]).filter((v) => v != null));
  console.log(`  ${st}：中位一局 ${mm('len')} 秒；推压-喘息 ${mm('cycles')} 轮；升级 ${(mm('ramp')).toFixed(2)}×；最长平静 ${mm('calm')} 秒；最长高压 ${mm('peak')} 秒；最长无奖励 ${mm('drought')} 秒；奖励 ${mm('rewards')} 次；火力成长 ${mm('power') ? mm('power').toFixed(2) + '×' : '—'}`);
}
const mins = Math.max(1, m('len') / 60);
console.log(`  中位一局 ${m('len')} 秒；第一次行动 ${m('first')} 秒；每 5 分钟 ${(m('cycles') / mins * 5).toFixed(1)} 轮推压-喘息；后三分之一 ÷ 前三分之一 ${m('ramp').toFixed(2)}×`);
console.log(`  最长平静 ${m('calm')} 秒（目标 ≤ ${T.calmMax}）；最长连续高压 ${m('peak')} 秒（≤ ${T.peakMax}）；最长无奖励 ${m('drought')} 秒（≤ ${T.droughtMax}）；每局奖励 ${m('rewards')} 次`);
if (m('first') > T.firstAction) warn.push(`第一次行动在 ${m('first')} 秒（目标 ≤ ${T.firstAction}）：开局就该打`);
if (m('calm') > T.calmMax) warn.push(`平静 ${m('calm')} 秒：玩家会说慢、无聊`);
if (m('peak') > T.peakMax) warn.push(`高压连续 ${m('peak')} 秒不喘息：累，难点像不公平`);
if (m('drought') > T.droughtMax) warn.push(`${m('drought')} 秒没有奖励：期待感断了`);
if (m('ramp') < T.ramp) warn.push(`后段强度只有前段的 ${m('ramp').toFixed(2)}×（目标 ≥ ${T.ramp}×）：一局没有往上走`);
if (m('cycles') < 1 && m('len') > 120) warn.push('没有推压-喘息循环：曲线是平的');
if (m('power') != null) {
  console.log(`  火力成长（有敌人在场时每秒伤害，后三分之一 ÷ 前三分之一）${m('power').toFixed(2)}×（目标 ≥ ${T.powerGrowth}×）`);
  if (m('power') < T.powerGrowth) warn.push(`火力只涨了 ${m('power').toFixed(2)}×：玩家会觉得升级没变强`);
}
if (m('sidesPeak') != null) {
  const mf = (k) => { const v = per.map((x) => x[k]).filter((x) => x != null); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); };
  console.log(`  出怪方向（最近 4 秒）：平静时 ${mf('sidesCalm').toFixed(1)} 个，最紧张时 ${mf('sidesPeak').toFixed(1)} 个，最多 ${m('sidesMax')} 个`);
  if (m('sidesMax') <= 1 && m('len') > 120) warn.push('威胁全从一个方向来：像传送带；推压时要开别的方向（带先兆）');
  else if (mf('sidesPeak') <= mf('sidesCalm')) warn.push('出怪方向没跟压力走：紧张时应该比平静时来自更多方向');
}
{ const byT = {}; for (const r of paces) for (const p of r) if (p.tens && p.sides != null) (byT[p.tens] = byT[p.tens] || []).push(p.sides);
  const order = ['calm', 'build', 'peak', 'breathe', 'boss'], nm = { calm: '平静', build: '蓄压', peak: '高潮', breathe: '喘息', boss: 'Boss' };
  console.log('  按压力阶段的出怪方向：' + order.filter((k) => byT[k]).map((k) => `${nm[k]} ${(byT[k].reduce((a, b) => a + b, 0) / byT[k].length).toFixed(2)}`).join('，'));
  if (byT.calm && byT.peak && byT.peak.reduce((a, b) => a + b, 0) / byT.peak.length <= byT.calm.reduce((a, b) => a + b, 0) / byT.calm.length) warn.push('高潮段的出怪方向不比平静段多'); }
const lk = sums.reduce((a, s) => a + (s.lurkKills || 0), 0), lh = sums.reduce((a, s) => a + ((s.hurt || {}).lurk || 0), 0);
console.log(`  地图出手：打碎 ${lk} 次（${(lk / Math.max(1, sums.length)).toFixed(1)} 次/局），被它打中 ${lh} 次`);
const unfairAll = per.map((x) => x.unfair), unfairSum = unfairAll.reduce((a, b) => a + b, 0);
console.log(`  不公平受击（攻击者刚出现 0.5 秒内或在屏幕外）：中位每局 ${m('unfair')}，合计 ${unfairSum}`);
const uS = {}; for (const s of sums) for (const [k, v] of Object.entries(s.unfairSrc || {})) uS[k] = (uS[k] || 0) + v;
if (Object.keys(uS).length) console.log('  不公平受击来源：' + Object.entries(uS).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
const lastL = {}; for (const s of sums) if (!s.won && s.last) lastL[s.last] = (lastL[s.last] || 0) + 1;
if (Object.keys(lastL).length) console.log('  输局最后一下：' + Object.entries(lastL).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
const hurtAll = {}; for (const s of sums) for (const [k, v] of Object.entries(s.hurt || {})) hurtAll[k] = (hurtAll[k] || 0) + v;
console.log('  受伤来源合计：' + Object.entries(hurtAll).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
if (m('unfair') > 0) warn.push(`每局 ${m('unfair')} 次不公平受击：玩家会说死得冤`);
// 首领是这一关有意的构筑考验（docs/design.md §3.5）：输在首领单独报；聚集检查只看首领之前的输局（没预告的难度尖峰在那里）
// 输在首领 = 倒在正在打的那个首领面前（连成一局时，打倒过前面的首领不算）
const atBossOf = (s) => (s.bosses || []).some((b) => b.stage === s.reached && !b.won);
const lostAll = per.map((x, i) => [x, sums[i]]).filter(([x]) => x.end != null && x.won === false), atBoss = lostAll.filter(([, s]) => atBossOf(s)).length;
const ends = lostAll.filter(([, s]) => !atBossOf(s)).map(([x]) => x.end);
console.log(`  输掉 ${lostAll.length} 局：输在首领 ${atBoss} 局（构筑考验），首领之前 ${ends.length} 局`);
if (ends.length >= 5) {
  const b = Math.max(10, Math.round(m('len') / 10)), hist = {};
  for (const e of ends) hist[Math.floor(e / b)] = (hist[Math.floor(e / b)] || 0) + 1;
  const [hk, hv] = Object.entries(hist).sort((x, y) => y[1] - x[1])[0];
  console.log(`  输局结束时间：${Object.entries(hist).sort((x, y) => x[0] - y[0]).map(([a, v]) => `${a * b}–${(+a + 1) * b} 秒 ${v}`).join('，')}`);
  // 聚集还要占到所有局的 5% 以上才算尖峰：一小撮（第一个精英那里约 3%）记账不追（§14）
  if (hv / ends.length > T.spike && hv / per.length >= 0.05) warn.push(`${Math.round((hv / ends.length) * 100)}% 的输局结束在 ${hk * b}–${(+hk + 1) * b} 秒：难度尖峰`);
}
/* ---------- 难度：按首领看（连成一局时一局有三个首领）。强度 = 期限 ÷ 按净进度推出的打完时间（DE1；目标见 docs/design.md §3.5、§14） ---------- */
{
  const D = TARGETS.difficulty;
  const isPlan = (s) => s.archetype !== 'random' && s.archetype !== 'rec', grp = (s) => (s.archetype === 'random' ? 'random' : s.archetype === 'rec' ? 'rec' : 'plan');
  const fights = sums.flatMap((s) => (s.bosses || []).map((b) => Object.assign({}, b, { arch: s.archetype, g: grp(s) })));
  const rate = (L) => (L.length ? pct(L.filter((f) => f.won).length, L.length) : null), show = (L) => (L.length ? `${rate(L)}%（${L.length}）` : '—');
  const medS = (L) => { const v = L.map((f) => f.strength).filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
  const f2 = (x) => (x == null ? '—' : x.toFixed(2) + '×');
  const lvNow = CHAIN ? LV || 1 : LV;
  console.log(`\n难度（目标来自 ${TARGETS.from || '兜底值'}；${HUMAN ? '机器人按普通玩家：反应 0.25 秒、会走神、瞄不准' : '机器人完美反应：只作参考，量难度用 --human'}${CHAIN ? '；三关连成一局' : ''}${LAD ? `；梦魇 ${LAD}` : ''}；共享等级 ${lvNow || '按关卡建议'}${FIRSTF ? '；第一局规则' : ''}）`);
  const runsBy = { plan: sums.filter(isPlan), rec: sums.filter((s) => s.archetype === 'rec'), random: sums.filter((s) => s.archetype === 'random') };
  const bossIds = [...new Set(fights.map((f) => f.stage))].sort();
  for (const st of bossIds) {
    const F = fights.filter((f) => f.stage === st), part = (g) => F.filter((f) => f.g === g), reach = (g) => pct(part(g).length, runsBy[g].length);
    console.log(`  ${st} 首领：打到的比例 有计划 ${reach('plan')}%，照推荐 ${reach('rec')}%，随手拿 ${reach('random')}%；打赢（打到的里面）有计划 ${show(part('plan'))}，照推荐 ${show(part('rec'))}，随手拿 ${show(part('random'))}；强度中位 有计划 ${f2(medS(part('plan')))}，照推荐 ${f2(medS(part('rec')))}，随手拿 ${f2(medS(part('random')))}`);
  }
  const plan = runsBy.plan, fo = plan.filter((s) => s.formed), un = plan.filter((s) => !s.formed), frac = med(fo.map((s) => s.formedAt / Math.max(1, s.t)));
  console.log(`  成型刻度：有计划时成型 ${pct(fo.length, plan.length)}%，成型在一局的 ${Math.round(frac * 100)}%；整局打通 有计划 ${show(plan.map((s) => ({ won: s.won })))}，照推荐 ${show(runsBy.rec.map((s) => ({ won: s.won })))}，随手拿 ${show(runsBy.random.map((s) => ({ won: s.won })))}`);
  const withS = fights.filter((f) => f.strength != null), bins = [[0, 0.6], [0.6, 0.8], [0.8, 1], [1, 1.25], [1.25, 1.5], [1.5, 2], [2, 99]];
  console.log('  按强度分档的胜率（每场首领战）：' + bins.map(([x, y]) => { const L = withS.filter((f) => f.strength >= x && f.strength < y); return `${y > 50 ? `≥${x}` : `${x}–${y}`} ${show(L)}`; }).join('，'));
  for (const st of bossIds) {
    const F = withS.filter((f) => f.stage === st && f.g === 'plan'), byP = {}; for (const f of F) (byP[f.arch] = byP[f.arch] || []).push(f);
    console.log(`  ${st} 首领 各流派强度中位：` + Object.entries(byP).map(([k, L]) => `${k} ${f2(medS(L))}`).join('，') + `；打穿（≥${D.breakS} 倍）${pct(F.filter((f) => f.strength >= D.breakS).length, F.length)}%`);
  }
  // 给和强是两回事：高品质件多久来一件；对路件凑齐的局强度明显更高；乱选拿到一样多，强度上不去
  const rareAts = sums.map((s) => s.rareAt).filter((x) => x != null), perRun = (L) => (L.length ? (L.reduce((x, s) => x + s.rare, 0) / L.length).toFixed(1) : '—');
  console.log(`  高品质件：每局 ${perRun(sums)} 件（有计划 ${perRun(plan)}，随机 ${perRun(runsBy.random)}），第一件中位 ${med(rareAts)} 秒，${sums.length - rareAts.length} 局一件没有`);
  const last = (s) => ({ strength: s.strength }), byOn = [[0, 0], [1, 2], [3, 99]].map(([x, y]) => { const L = plan.filter((s) => s.rareOnBuild >= x && s.rareOnBuild <= y).map(last); return [`${x === y ? x : y > 50 ? `≥${x}` : `${x}–${y}`} 件对路`, L]; });
  console.log('  按对路的高品质件分（最后一场首领战的强度）：' + byOn.map(([k, L]) => `${k} 强度中位 ${f2(medS(L))}`).join('；') + `；随手拿 ${f2(medS(runsBy.random.map(last)))}`);
  if (HUMAN) {
    const lo = withS.filter((f) => f.strength < D.loS), hi = withS.filter((f) => f.strength >= D.hiS);
    if (lo.length >= 10 && rate(lo) > D.loWin) warn.push(`强度不到 ${D.loS} 倍的首领战赢了 ${rate(lo)}%（目标 ≤ ${D.loWin}%）：弱构筑也能赢`);
    if (hi.length >= 10 && rate(hi) < D.hiWin) warn.push(`强度 ${D.hiS} 倍以上的首领战只赢 ${rate(hi)}%（目标 ≥ ${D.hiWin}%）：强构筑也没把握`);
    if (!LAD && rareAts.length && med(rareAts) > D.rareAt) warn.push(`第一件高品质件中位在 ${med(rareAts)} 秒（目标 ${D.rareAt} 秒以内）`);
    const mr = medS(fights.filter((f) => f.g === 'rec' && f.stage === STAGE_ORDER_N[STAGE_ORDER_N.length - 1]));
    if (LAD >= LADDER_MAX_N) { if (mr != null && (mr < D.ladderTopRec[0] || mr > D.ladderTopRec[1])) warn.push(`最高一级梦魇，最后一个首领照推荐的强度中位 ${f2(mr)}（目标 ${D.ladderTopRec.join('–')}）`); }
    // 认真搭和随手拿的差距按整章通关量（在首通时的等级上）：走到最后一关的随手拿是幸存者（恰好早早成型），只看最后一个首领会看走眼
    const DC = D.chapter; if (!LAD && CHAIN && DC && DC.lv === lvNow) { const cw = (L) => pct(L.filter((s) => s.won).length, L.length), cp = cw(plan), cr = cw(runsBy.random); if (runsBy.random.length >= 10 && plan.length >= 10 && cr > cp * DC.randomK) warn.push(`整章通关（${lvNow} 级）随手拿 ${cr}%，有计划 ${cp}%（目标随手拿 ≤ 有计划的 ${Math.round(DC.randomK * 100)}%）：认真搭和乱选差不多`); }
    if (!LAD) for (const st of bossIds) {
      // 每个首领在它的参照等级（玩家第一次走到那里时的局外等级，--career 量出来）上的目标；跑的不是那个等级就不比
      const T = (D.bosses || {})[st]; if (!T || (T.lv && T.lv !== lvNow)) continue;
      const F = fights.filter((f) => f.stage === st), P2 = F.filter((f) => f.g === 'plan'), RN = F.filter((f) => f.g === 'random'), RC = F.filter((f) => f.g === 'rec'), mp = medS(P2);
      if (T.plan && P2.length && (rate(P2) < T.plan[0] || rate(P2) > T.plan[1])) warn.push(`${st} 首领（${lvNow} 级）有计划的胜率 ${rate(P2)}%（目标 ${T.plan.join('–')}%）`);
      if (T.rec && RC.length && (rate(RC) < T.rec[0] || rate(RC) > T.rec[1])) warn.push(`${st} 首领（${lvNow} 级）照推荐的胜率 ${rate(RC)}%（目标 ${T.rec.join('–')}%）`);
      if (T.random != null && RN.length >= 5 && rate(RN) > T.random) warn.push(`${st} 首领 随手拿的胜率 ${rate(RN)}%（目标 ≤ ${T.random}%）：怎么选都一样`);
      // min：几乎人人过的首领，三种打法都不低于它
      if (T.min != null) for (const [nm, L] of [['有计划', P2], ['照推荐', RC], ['随手拿', RN]]) if (L.length >= 5 && rate(L) < T.min) warn.push(`${st} 首领 ${nm}的胜率 ${rate(L)}%（目标 ≥ ${T.min}%）`);
      const byP = {}; for (const f of P2) (byP[f.arch] = byP[f.arch] || []).push(f);
      // 不考构筑的首领（基础难度下的 1-1，§3.6）不查陷阱路线：人人都过，强度高低不决定胜负
      if (!R(`!!BUILD_CHECK.free['${st}']`)) for (const [k, L] of Object.entries(byP)) { const v = medS(L); if (v != null && mp != null && L.length >= 5 && v < mp * (1 - D.pathSpread)) warn.push(`${st} 首领 ${k} 强度中位 ${f2(v)}，比有计划的中位低 ${Math.round(D.pathSpread * 100)}% 以上：陷阱路线`); }
    }
  }
}
const ph = {}; for (const x of per) for (const [a, v] of Object.entries(x.phases)) (ph[a] = ph[a] || []).push(v);
console.log('  各阶段时长（中位秒）：' + Object.entries(ph).map(([a, v]) => `${a} ${med(v)}`).join('，'));
for (const w of warn) console.log('  WARN ' + w);
console.log(warn.length ? `报告有 ${warn.length} 条警告` : '报告无警告');
process.exitCode = gate && warn.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 2; });
/* ---------- 连续玩的报告：每个里程碑在第几小时、第一局、有没有白打、开局是不是更强、多久没有新东西、高品质件前后 ---------- */
async function careerReport() {
  const { spawn } = require('child_process'), passthru = argv.filter((a, i) => a !== '--jobs' && argv[i - 1] !== '--jobs'), J = Math.max(1, JOBS), out = [];
  await Promise.all(Array.from({ length: J }, (_, wi) => new Promise((ok, bad) => {
    const c = spawn(process.execPath, [__filename, ...passthru, '--worker', `${wi}/${J}`], { stdio: ['ignore', 'pipe', 'inherit'] }); let buf = '';
    c.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); if (line.startsWith('CAR ')) out.push(JSON.parse(line.slice(4))); } });
    c.on('exit', (code) => (code ? bad(new Error('子进程失败 ' + code)) : ok()));
  })));
  out.sort((a, b) => a.i - b.i);
  const pc = (a, b) => (b ? Math.round((100 * a) / b) : 0), q = (a, f) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * f))] : null; };
  const hr = (x) => (x == null ? '—' : x.toFixed(1) + ' 小时'), W = [];
  console.log(`连续玩（${out.length} 个玩家，${HUMAN ? '普通玩家机器人' : '完美反应机器人'}，照推荐选；每人最多 120 局或 20 小时；每局另算 60 秒菜单）`);
  for (const P of out) for (const x of P.log) console.log(JSON.stringify(Object.assign({ p: P.i }, x)));
  const first = out.map((P) => P.log[0]), fb = first.filter((x) => (x.cleared || []).includes('1-1')).length, fwin = first.filter((x) => x.won).length;
  const fend = {}; for (const x of first) fend[x.won ? '通关' : `倒在 ${x.stage}`] = (fend[x.won ? '通关' : `倒在 ${x.stage}`] || 0) + 1;
  console.log(`  第一局：打过第一个首领 ${pc(fb, first.length)}%；第一局就通关 ${pc(fwin, first.length)}%；第一局结局 ${Object.entries(fend).map(([k, v]) => `${k} ${v}`).join('，')}；时长中位 ${Math.round(q(first.map((x) => x.t + 60), 0.5) / 60)} 分钟`);
  const when = (test) => out.map((P) => { const x = P.log.find(test); return x ? x.h : null; });
  const has = (x, id) => (x.cleared || []).includes(id);
  const MS = [['第一个首领', (x) => has(x, '1-1')], ['第二个首领（1-2）', (x) => has(x, '1-2')], ['首通（1-3）', (x) => has(x, '1-3') && !x.lad]];
  for (let l = 1; l <= LADDER_MAX_N; l++) MS.push([`梦魇 ${l} 通关`, (x) => x.won && x.lad === l]);
  const ms = {};
  for (const [name, test] of MS) { const h = when(test), got = h.filter((x) => x != null); ms[name] = h; console.log(`  ${name}：${pc(got.length, out.length)}% 的人到了；中位 ${hr(q(h, 0.5))}（四分之一 ${hr(q(got, 0.25))}，四分之三 ${hr(q(got, 0.75))}）`); }
  const all = out.flatMap((P) => P.log), white = all.filter((x) => !x.dust && !x.news.length).length, str = all.filter((x) => x.stronger != null), up = str.filter((x) => x.stronger).length;
  const quiet = out.map((P) => { let m = 0, c = 0; for (const x of P.log) { c = x.news.length ? 0 : c + 1; m = Math.max(m, c); } return m; });
  console.log(`  白打的局（什么都没带出来）：${white} / ${all.length}；下一局开局比上一局更强：${pc(up, str.length)}% 的局；最长连续没有新东西（升级 / 通关 / 解锁）：中位 ${q(quiet, 0.5)} 局，最多 ${Math.max(...quiet)} 局`);
  const early = out.flatMap((P) => P.log.slice(0, 5)), late = out.flatMap((P) => P.log.slice(-5)), avgR = (L) => (L.reduce((a, x) => a + x.rare, 0) / Math.max(1, L.length)).toFixed(1);
  console.log(`  高品质件：前五局每局 ${avgR(early)} 件，最后五局每局 ${avgR(late)} 件；共享等级 首通时中位 Lv${q(out.map((P) => { const x = P.log.find((y) => y.stage === '1-3' && y.won && !y.lad); return x ? x.lv : null; }), 0.5)}，最后中位 Lv${q(out.map((P) => P.log[P.log.length - 1].lv), 0.5)}`);
  // 每个首领：打到它的场次里赢了多少（首通前的基础难度）
  const fightsOf = (id) => all.filter((x) => !x.lad).flatMap((x) => (x.fights || []).filter((f) => f[0] === id));
  const ph = (L) => `${pc(L.filter((f) => f[2]).length, L.length)}%（${L.length}）`;
  console.log(`  各首领胜率（基础难度，打到的场次里）：1-1 ${ph(fightsOf('1-1'))}，1-2 ${ph(fightsOf('1-2'))}，1-3 ${ph(fightsOf('1-3'))}` + Array.from({ length: LADDER_MAX_N }, (_, i) => { const L = all.filter((x) => x.lad === i + 1); return `，梦魇 ${i + 1} 整局 ${pc(L.filter((x) => x.won).length, L.length)}%（${L.length}）`; }).join(''));
  // 首通是挣来的吗：首通那一局最后一个首领的强度；最后一个首领的胜率随尝试次数爬上去
  const fcS = out.map((P) => { const x = P.log.find((y) => has(y, '1-3') && !y.lad); const f = x && (x.fights || []).find((g) => g[0] === '1-3'); return f ? f[1] : null; }).filter((v) => v != null);
  const fcLow = pc(fcS.filter((v) => v < 1).length, fcS.length);
  console.log(`  首通那一局最后一个首领的强度：中位 ${q(fcS, 0.5) == null ? '—' : q(fcS, 0.5).toFixed(2) + '×'}，不到 1 倍的占 ${fcLow}%（${fcS.length} 人）`);
  const tries = {}; for (const P of out) { let k = 0; for (const x of P.log) { if (x.lad) break; const f = (x.fights || []).find((g) => g[0] === '1-3'); if (!f) continue; k++; const b = k === 1 ? '第 1 次' : k === 2 ? '第 2 次' : k <= 4 ? '第 3–4 次' : k <= 8 ? '第 5–8 次' : '第 9 次以后'; (tries[b] = tries[b] || []).push(f[2]); if (f[2]) break; } }
  // 第一次走到每个首领时的局外等级（各首领的参照等级就取它，§3.9）和首通前打了几局、见了几次最后一个首领
  const arrive = (id) => out.map((P) => { const x = P.log.find((y) => (y.fights || []).some((g) => g[0] === id)); return x ? (x.lv0 != null ? x.lv0 : x.lv) : null; });
  console.log('  第一次走到首领时的共享等级（中位）：' + STAGE_ORDER_N.map((id) => `${id} Lv${q(arrive(id), 0.5)}`).join('，'));
  const toClear = out.map((P) => { const i = P.log.findIndex((y) => has(y, '1-3') && !y.lad); return i < 0 ? null : { runs: i + 1, meets: P.log.slice(0, i + 1).filter((y) => (y.fights || []).some((g) => g[0] === '1-3')).length }; }).filter(Boolean);
  if (toClear.length) console.log(`  首通前：中位打了 ${q(toClear.map((x) => x.runs), 0.5)} 局，见到最后一个首领 ${q(toClear.map((x) => x.meets), 0.5)} 次（四分之三 ${q(toClear.map((x) => x.meets), 0.75)} 次）`);
  console.log('  最后一个首领的胜率随尝试次数（首通前）：' + ['第 1 次', '第 2 次', '第 3–4 次', '第 5–8 次', '第 9 次以后'].filter((b) => tries[b]).map((b) => `${b} ${pc(tries[b].filter(Boolean).length, tries[b].length)}%（${tries[b].length}）`).join('，'));
  // 目标从设计文档读（§7、§14 report-targets）
  const C = TARGETS.career, fc = ms['首通（1-3）'].filter((x) => x != null);
  if (pc(fb, first.length) < C.firstBoss) W.push(`第一局打过首领只有 ${pc(fb, first.length)}%（目标 ≥ ${C.firstBoss}%）`);
  if (C.firstWinMax != null && pc(fwin, first.length) > C.firstWinMax) W.push(`第一局就通关的 ${pc(fwin, first.length)}%（目标 ≤ ${C.firstWinMax}%）`);
  // 胜率随尝试次数爬上去：第 3 次以后至少是第 1 次的两倍（第 1 次是 0 时至少 10%）
  const t1 = tries['第 1 次'] || [], tL = ['第 3–4 次', '第 5–8 次', '第 9 次以后'].flatMap((b) => tries[b] || []), r1 = pc(t1.filter(Boolean).length, t1.length), rL = pc(tL.filter(Boolean).length, tL.length);
  if (C.climb && t1.length >= 5 && tL.length >= 5 && rL < Math.max(2 * r1, r1 + 10)) W.push(`最后一个首领第 3 次以后的胜率 ${rL}%，第 1 次 ${r1}%：胜率没有随尝试爬上去`);
  if (fcS.length >= 5 && fcLow > 50) W.push(`多数首通（${fcLow}%）来自强度不到 1 倍的局：首通是碰运气碰出来的（DE28）`);
  if (fc.length && (q(fc, 0.5) < C.clearMedian[0] || q(fc, 0.5) > C.clearMedian[1])) W.push(`首通中位 ${hr(q(fc, 0.5))}（目标 ${C.clearMedian.join('–')} 小时）`);
  if (fc.length && q(fc, 0.25) < C.clearP25) W.push(`四分之一的人 ${hr(q(fc, 0.25))} 就首通了（目标不早于 ${C.clearP25} 小时）`);
  if (fc.length < out.length * 0.5) W.push(`20 小时内只有 ${pc(fc.length, out.length)}% 的人首通`);
  if (white) W.push(`${white} 局什么都没带出来`);
  const lad5 = ms[`梦魇 ${LADDER_MAX_N} 通关`] || [], q5 = q(lad5, 0.5), quietPre = out.map((P) => { const end = (P.log.find((x) => x.lad === LADDER_MAX_N && x.won) || {}).r; let m = 0, c = 0; for (const x of P.log) { if (end !== undefined && x.r > end) break; c = x.news.length ? 0 : c + 1; m = Math.max(m, c); } return m; });
  if (q(quietPre, 0.5) > C.quietMax) W.push(`打完梦魇 ${LADDER_MAX_N} 之前，玩家中位连续 ${q(quietPre, 0.5)} 局没有新东西（目标 ≤ ${C.quietMax}）`);
  console.log(`  打完梦魇 ${LADDER_MAX_N} 之前最长连续没有新东西：中位 ${q(quietPre, 0.5)} 局；之后内容用完（第二章之前）`);
  for (const w of W) console.log('  WARN ' + w);
  console.log(W.length ? `连续玩有 ${W.length} 条警告` : '连续玩无警告');
}
