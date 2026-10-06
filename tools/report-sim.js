// 构筑报告 + 节奏报告（金牌制作人 L2：先量再改）。机器人按每个流派（BUILD_PATHS）去追 Build，打第一章三关，会受伤、会输。
// 用法：node tools/report-sim.js [js 目录] [每个流派每关几局，默认 3] [关卡，逗号分隔，默认 1-1,1-2,1-3] [--gate]
//   构筑报告：各流派 / 各飞机胜率差、每局拿到几种能力、局与局重合度、只加数字的选择占比、第一个成型件（联动）出现时间
//   节奏报告：每秒采一次 World.pacing()，强度曲线、第一次行动、推压-喘息循环、最长平静 / 最长高压、最长无奖励、输局聚集、不公平受击、火力成长
//   --gate：有 WARN 时退出码为 1
//   难度（和构筑挂钩，见 docs/design.md §3.5）：--human 机器人按普通玩家（反应 0.25 秒、会走神、瞄不准）；
//   --archetypes 流派名或序号,…,random,rec（random = 每次随机拿、从不规划的新手；rec = 总按游戏推荐选；默认全部流派）；--jobs J 并行
const { load } = require('./sim-env');
const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const VALUED = new Set(['--archetypes', '--jobs', '--worker', '--eval']);
const args = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const gate = argv.includes('--gate'), HUMAN = argv.includes('--human'), JOBS = +(flag('jobs') || 1), WORKER = flag('worker');
const { R } = load(args[0]);
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
  const sc = (o) => {
    if (o.kind === 'link') return o.id === link ? 100 : 30;
    if (o.kind === 'support' && o.replace && comps.includes(o.replace.id)) return -50;
    if ((o.kind === 'gun' || o.kind === 'support') && comps.includes(o.id)) return o.from > 0 ? 40 : 60;
    if (o.from > 0) return 20;
    return o.kind === 'bmod' ? 10 : 15;
  };
  return (gs) => (sc(gs[1].opt) > sc(gs[0].opt) ? gs[1] : gs[0]);
}
var PATH_LINKS = new Set(BUILD_PATHS.map((P) => P.path.find((x) => x.includes('+'))));
/* 随机乱选：每次升级随机拿一个（同一次仪式里选定不变），从不规划；随机只用状态哈希 */
function randomPick(seed) { let n = 0, lastR = null, c = 0; return (gs) => { const r = (G.world && G.world.ritual) || gs; if (r !== lastR) { lastR = r; c = Math.floor(pilotHash(n++, seed) * gs.length); } return gs[Math.min(c, gs.length - 1)]; }; }
var G = {};
function reportRun(stage, archIdx, plane, seed, human) {
  const S = STAGES[stage], P = archIdx < 0 ? null : BUILD_PATHS[archIdx]; let res = null;
  const meta = freshMeta(); meta.shared.level = S.rec; meta.planes[plane] = newPlaneRecord(plane);
  const w = new World({ mode: 'run', W: 1280, plane, stage, seed, ultCap: S.ult, stats: planeStats(meta, plane), target: P ? P.name : undefined, settings, cb: { onEnd: (r) => res = r } });
  G.world = w; w.pilotPickFn = P ? aimAt(P) : archIdx === -2 ? (gs) => gs[w.recIndex(w.ritual)] || gs[0] : randomPick(seed); // -2：照游戏推荐选（按大招键的新手）
  if (human) w.pilotHuman = { react: 0.25, slip: 0.12, aim: 14, seed };
  const STEP = 1 / 120; let t = 0, frames = 0, keyAt = null, archAt = null, formedAt = null, bossT = 0, bossD0 = 0, bossD = 0; const pickT = []; const picks = [], pace = []; let stat = 0;
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
  while (t < 1200) {
    pilot(w); w.step(STEP); t += STEP; __now += STEP * 1000; frames++; if (w.phase === 'boss' && w.boss && w.bossIntroT <= 0) { if (!bossT) bossD0 = w.m.dmgOut; bossT += STEP; bossD = w.m.dmgOut - bossD0; }
    w.events.length = 0;
    // 每秒一个样本；结束后再采一秒就停（胜利演出还在走，等结算回调）
    if (frames % 120 === 0 && !(pace.length > 1 && pace[pace.length - 1].over && pace[pace.length - 2].over)) pace.push(w.pacing());
    if (res) break;
  }
  return { stage, archetype: P ? P.name : archIdx === -2 ? 'rec' : 'random', character: plane, won: !!(res && res.win), picks, statOnly: stat, keyAt, archAt, formed: formedAt !== null, formedAt, t: Math.round(t), bossT: Math.round(bossT), bdps: bossT > 5 ? Math.round(bossD / bossT) : null, pickT, secs: Math.round(t), hurt: res && res.hurt, last: res && res.lastHurt, unfairSrc, lurkKills: w.m.lurkKills || 0, pace };
}
`);

const sums = [], paces = [];
const names = R('BUILD_PATHS.map((P) => P.name)'), planes = R('PLANE_ORDER.slice()');
const ARCH = (flag('archetypes') || 'all').split(',').flatMap((x) => (x === 'all' ? names.map((_, i) => i) : x === 'random' ? [-1] : x === 'rec' ? [-2] : [/^\d+$/.test(x) ? +x : names.indexOf(x)]));
if (ARCH.some((a) => a < -2 || a >= names.length)) throw new Error('未知流派：' + flag('archetypes'));
const jobs = []; let k = 0;
for (const st of STAGES_RUN) for (const a of ARCH) for (let r = 0; r < N; r++) { jobs.push({ st, a, plane: planes[((a < 0 ? names.length - a - 1 : a) + r) % planes.length], seed: 9001 + k * 7919, i: k }); k++; }
const runJob = (j) => R(`reportRun('${j.st}', ${j.a}, '${j.plane}', ${j.seed}, ${HUMAN})`);
if (WORKER) { // 并行的子进程：只跑分到的那几局，一行一局
  const [wi, wn] = WORKER.split('/').map(Number);
  for (const j of jobs) if (j.i % wn === wi) process.stdout.write('RUN ' + JSON.stringify(Object.assign(runJob(j), { i: j.i })) + '\n');
  return; // CommonJS 顶层 return：等输出写完再自然退出（process.exit 会截掉管道里没写完的行）
}
(async () => {
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
for (const st of STAGES_RUN) { const L = sums.filter((s) => s.stage === st); console.log(`  ${st} 胜率 ${pct(L.filter((s) => s.won).length, L.length)}%（${L.length}）`); }
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
for (const st of STAGES_RUN) {
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
const lostAll = per.map((x, i) => [x, sums[i]]).filter(([x]) => x.end != null && x.won === false), atBoss = lostAll.filter(([, s]) => s.bossT > 0).length;
const ends = lostAll.filter(([, s]) => !(s.bossT > 0)).map(([x]) => x.end);
console.log(`  输掉 ${lostAll.length} 局：输在首领 ${atBoss} 局（构筑考验），首领之前 ${ends.length} 局`);
if (ends.length >= 5) {
  const b = Math.max(10, Math.round(m('len') / 10)), hist = {};
  for (const e of ends) hist[Math.floor(e / b)] = (hist[Math.floor(e / b)] || 0) + 1;
  const [hk, hv] = Object.entries(hist).sort((x, y) => y[1] - x[1])[0];
  console.log(`  输局结束时间：${Object.entries(hist).sort((x, y) => x[0] - y[0]).map(([a, v]) => `${a * b}–${(+a + 1) * b} 秒 ${v}`).join('，')}`);
  if (hv / ends.length > T.spike) warn.push(`${Math.round((hv / ends.length) * 100)}% 的输局结束在 ${hk * b}–${(+hk + 1) * b} 秒：难度尖峰`);
}
/* ---------- 难度：按“成型 / 没成型 / 随机乱选”分开看胜率（DE1；目标见 docs/design.md §3.5） ---------- */
{
  const D = { formedLo: 70, formedHi: 95, unformedHi: 30, gap: 40, randomHi: 30, ratioLo: 50, ratioHi: 90, atFrac: 0.7 };
  const rate = (L) => (L.length ? pct(L.filter((s) => s.won).length, L.length) : null), show = (L) => (L.length ? `${rate(L)}%（${L.length}）` : '—');
  const line = (L, label) => {
    const plan = L.filter((s) => s.archetype !== 'random' && s.archetype !== 'rec'), fo = plan.filter((s) => s.formed), un = plan.filter((s) => !s.formed), rnd = L.filter((s) => s.archetype === 'random'), rec = L.filter((s) => s.archetype === 'rec');
    const frac = med(fo.map((s) => s.formedAt / Math.max(1, s.t)));
    console.log(`  ${label}：成型的局赢 ${show(fo)}，没成型的赢 ${show(un)}，随机乱选赢 ${show(rnd)}${rec.length ? `，照推荐选赢 ${show(rec)}` : ''}；有计划时成型 ${pct(fo.length, plan.length)}%；成型时间中位在一局的 ${Math.round(frac * 100)}%`);
    return { fo, un, rnd, plan, frac };
  };
  console.log(`\n难度（${HUMAN ? '机器人按普通玩家：反应 0.25 秒、会走神、瞄不准' : '机器人完美反应：只作参考，量难度用 --human'}）`);
  const A = line(sums, '全部');
  for (const st of STAGES_RUN) line(sums.filter((s) => s.stage === st), st);
  if (HUMAN) {
    const fr = rate(A.fo), ur = rate(A.un), rr = rate(A.rnd), ratio = pct(A.fo.length, A.plan.length);
    if (fr !== null && (fr < D.formedLo || fr > D.formedHi)) warn.push(`成型的局胜率 ${fr}%（目标 ${D.formedLo}–${D.formedHi}%）：${fr < D.formedLo ? '搭好了也赢不了' : '一成型就赢定，后段不考验'}`);
    if (ur !== null && (ur > D.unformedHi || (fr !== null && fr - ur < D.gap))) warn.push(`没成型的局胜率 ${ur}%（目标 ≤ ${D.unformedHi}%，且比成型的低 ${D.gap} 个百分点以上）：不搭构筑也能赢`);
    if (rr !== null && rr > D.randomHi) warn.push(`随机乱选胜率 ${rr}%（目标 ≤ ${D.randomHi}%）：怎么选都一样`);
    if (A.plan.length && (ratio < D.ratioLo || ratio > D.ratioHi)) warn.push(`有计划时成型 ${ratio}%（目标 ${D.ratioLo}–${D.ratioHi}%）：${ratio < D.ratioLo ? '全看运气' : '每局都一样'}`);
    if (A.fo.length && A.frac > D.atFrac) warn.push(`成型太晚：中位在一局的 ${Math.round(A.frac * 100)}%（目标 ${D.atFrac * 100}% 以前）`);
  }
}
const ph = {}; for (const x of per) for (const [a, v] of Object.entries(x.phases)) (ph[a] = ph[a] || []).push(v);
console.log('  各阶段时长（中位秒）：' + Object.entries(ph).map(([a, v]) => `${a} ${med(v)}`).join('，'));
for (const w of warn) console.log('  WARN ' + w);
console.log(warn.length ? `报告有 ${warn.length} 条警告` : '报告无警告');
process.exitCode = gate && warn.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 2; });
