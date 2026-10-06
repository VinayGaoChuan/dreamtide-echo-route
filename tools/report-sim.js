// 构筑报告 + 节奏报告（金牌制作人 L2：先量再改）。机器人按每个流派（BUILD_PATHS）去追 Build，打第一章三关，会受伤、会输。
// 用法：node tools/report-sim.js [js 目录] [每个流派每关几局，默认 3] [关卡，逗号分隔，默认 1-1,1-2,1-3] [--gate]
//   构筑报告：各流派 / 各飞机胜率差、每局拿到几种能力、局与局重合度、只加数字的选择占比、第一个成型件（联动）出现时间
//   节奏报告：每秒采一次 World.pacing()，强度曲线、第一次行动、推压-喘息循环、最长平静 / 最长高压、最长无奖励、输局聚集、不公平受击、火力成长
//   --gate：有 WARN 时退出码为 1
const { load } = require('./sim-env');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gate = process.argv.includes('--gate');
const { R } = load(args[0]);
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
function reportRun(stage, archIdx, plane, seed) {
  const S = STAGES[stage], P = BUILD_PATHS[archIdx]; let res = null;
  const meta = freshMeta(); meta.shared.level = S.rec; meta.planes[plane] = newPlaneRecord(plane);
  const w = new World({ mode: 'run', W: 1280, plane, stage, seed, ultCap: S.ult, stats: planeStats(meta, plane), target: P.name, settings, cb: { onEnd: (r) => res = r } });
  w.pilotPickFn = aimAt(P);
  const STEP = 1 / 120; let t = 0, frames = 0, keyAt = null, archAt = null; const picks = [], pace = []; let stat = 0;
  const unfairSrc = {}, _hurt = w.hurtPlayer.bind(w);
  w.hurtPlayer = (n, src, who) => { const u0 = w.m.unfair; _hurt(n, src, who); if (w.m.unfair > u0) unfairSrc[src] = (unfairSrc[src] || 0) + 1; };
  const _apply = w.applyOption.bind(w);
  w.applyOption = (o) => {
    picks.push(o.kind === 'link' ? o.id : o.id); if (statOnly(o)) stat++;
    if (o.kind === 'link' && keyAt === null) keyAt = Math.round(t);
    if (o.kind === 'link' && P.path.includes(o.id)) archAt = Math.round(t);
    _apply(o);
  };
  while (t < 1200) {
    pilot(w); w.step(STEP); t += STEP; __now += STEP * 1000; frames++;
    w.events.length = 0;
    // 每秒一个样本；结束后再采一秒就停（胜利演出还在走，等结算回调）
    if (frames % 120 === 0 && !(pace.length > 1 && pace[pace.length - 1].over && pace[pace.length - 2].over)) pace.push(w.pacing());
    if (res) break;
  }
  return { stage, archetype: P.name, character: plane, won: !!(res && res.win), picks, statOnly: stat, keyAt, archAt, secs: Math.round(t), hurt: res && res.hurt, last: res && res.lastHurt, unfairSrc, pace };
}
`);

const sums = [], paces = [];
const archs = R('BUILD_PATHS.length'), planes = R('PLANE_ORDER.slice()');
let k = 0;
for (const st of STAGES_RUN) for (let a = 0; a < archs; a++) for (let r = 0; r < N; r++) {
  const plane = planes[(a + r) % planes.length], seed = 9001 + k * 7919; k++;
  const s = R(`reportRun('${st}', ${a}, '${plane}', ${seed})`);
  paces.push(s.pace); delete s.pace; sums.push(s);
  console.log(JSON.stringify(s));
}

const warn = [];
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

/* ---------- 构筑报告（玩家最常骂的：运气左右、局局一样、一条路最强、升级只加数字、Build 一直不成型） ---------- */
console.log(`\n构筑报告（${sums.length} 局，关卡 ${STAGES_RUN.join(' / ')}）`);
console.log(`  总胜率 ${pct(sums.filter((s) => s.won).length, sums.length)}%`);
for (const st of STAGES_RUN) { const L = sums.filter((s) => s.stage === st); console.log(`  ${st} 胜率 ${pct(L.filter((s) => s.won).length, L.length)}%（${L.length}）`); }
const spread = (key, label, unit) => {
  const by = {}; for (const s of sums) (by[s[key]] = by[s[key]] || []).push(s.won);
  const rates = Object.entries(by).map(([x, w]) => [x, pct(w.filter(Boolean).length, w.length), w.length]);
  console.log(`  各${label}：` + rates.map(([x, p, n]) => `${x} ${p}%（${n}）`).join('，'));
  const hi = Math.max(...rates.map((q) => q[1])), lo = Math.min(...rates.map((q) => q[1]));
  if (hi - lo > 25) warn.push(`${label}胜率差 ${hi - lo} 个百分点：${unit}`);
};
spread('archetype', '流派', '有一条路太强或有一条是陷阱');
spread('character', '飞机', '有一架飞机太强或太弱');
const sets = sums.map((s) => new Set(s.picks));
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
    power: pw.length >= 6 ? avg(pw.slice(-pthird)) / Math.max(1e-9, avg(pw.slice(0, pthird))) : null, drought, rewards: r.length ? r[r.length - 1].rewards || 0 : 0, unfair: r.length ? r[r.length - 1].unfair || 0 : 0,
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
const unfairAll = per.map((x) => x.unfair), unfairSum = unfairAll.reduce((a, b) => a + b, 0);
console.log(`  不公平受击（攻击者刚出现 0.5 秒内或在屏幕外）：中位每局 ${m('unfair')}，合计 ${unfairSum}`);
const uS = {}; for (const s of sums) for (const [k, v] of Object.entries(s.unfairSrc || {})) uS[k] = (uS[k] || 0) + v;
if (Object.keys(uS).length) console.log('  不公平受击来源：' + Object.entries(uS).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
const lastL = {}; for (const s of sums) if (!s.won && s.last) lastL[s.last] = (lastL[s.last] || 0) + 1;
if (Object.keys(lastL).length) console.log('  输局最后一下：' + Object.entries(lastL).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
const hurtAll = {}; for (const s of sums) for (const [k, v] of Object.entries(s.hurt || {})) hurtAll[k] = (hurtAll[k] || 0) + v;
console.log('  受伤来源合计：' + Object.entries(hurtAll).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
if (m('unfair') > 0) warn.push(`每局 ${m('unfair')} 次不公平受击：玩家会说死得冤`);
const ends = per.filter((x) => x.end != null && x.won === false).map((x) => x.end);
console.log(`  输掉 ${ends.length} 局`);
if (ends.length >= 5) {
  const b = Math.max(10, Math.round(m('len') / 10)), hist = {};
  for (const e of ends) hist[Math.floor(e / b)] = (hist[Math.floor(e / b)] || 0) + 1;
  const [hk, hv] = Object.entries(hist).sort((x, y) => y[1] - x[1])[0];
  console.log(`  输局结束时间：${Object.entries(hist).sort((x, y) => x[0] - y[0]).map(([a, v]) => `${a * b}–${(+a + 1) * b} 秒 ${v}`).join('，')}`);
  if (hv / ends.length > T.spike) warn.push(`${Math.round((hv / ends.length) * 100)}% 的输局结束在 ${hk * b}–${(+hk + 1) * b} 秒：难度尖峰`);
}
const ph = {}; for (const x of per) for (const [a, v] of Object.entries(x.phases)) (ph[a] = ph[a] || []).push(v);
console.log('  各阶段时长（中位秒）：' + Object.entries(ph).map(([a, v]) => `${a} ${med(v)}`).join('，'));
for (const w of warn) console.log('  WARN ' + w);
console.log(warn.length ? `报告有 ${warn.length} 条警告` : '报告无警告');
process.exitCode = gate && warn.length ? 1 : 0;
