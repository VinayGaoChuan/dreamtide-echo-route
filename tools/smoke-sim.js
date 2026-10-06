// 无头冒烟测试：用假画布加载游戏脚本，让一个简单的自动驾驶按推荐等级打完第一章三关，输出验收指标。
// 用法：node tools/smoke-sim.js [js 目录] [关卡，如 1-2]；有失败项时退出码为 1（GitHub Actions 用它挡住坏提交）
const { load } = require('./sim-env');
const { R } = load(process.argv[2]);
R(`
function run(stage, plane, level, cap, pickIdx, godmode, world) {
  let res = null; const meta = freshMeta(); meta.shared.level = level; meta.planes[plane] = newPlaneRecord(plane);
  const seed = 4242 + STAGE_ORDER.indexOf(stage) * 97 + pickIdx * 13 + (godmode ? 0 : 7) + plane.length; // 固定种子：冒烟测试每次结果一样，失败能复现
  const w = new World({ mode: 'run', W: 1280, plane, stage, seed, ultCap: cap, stats: planeStats(meta, plane), first: stage === '1-1' && level === 1, settings, world, cb: { onEnd: (r) => res = r, onRescue: (id) => rescues.push(id) } });
  const rescues = [];
  if (world && world.preferUpper) { const g0 = w.mapGoalPos.bind(w); w.mapGoalPos = (o) => (o.kind === 'wind' && o.upper && o.state === 'idle' ? { x: o.x + o.upper.dx, y: o.upper.y } : g0(o)); } // 测试：主动选上层风圈
  const goalLog = []; let lastGoal = null;
  w.pilotPick = pickIdx;
  if (pickIdx === 1) w.pilotPickFn = (gs) => gs[w.recIndex(w.ritual)] || gs[0]; // 选法 1：照游戏推荐选（像按大招键的新手）；难度和构筑挂钩后，不成型的乱选打不过首领
  if (godmode) { w.player.hp = w.player.maxHp = 999; w.testNoWipe = true; } // 流程测试：不超载，首领要真的被打倒
  const STEP = 1 / 120; let t = 0, frames = 0, maxE = 0, maxB = 0, pickLog = [];
  const _apply = w.applyOption.bind(w); w.applyOption = (o) => { pickLog.push(o.kind === 'link' ? SYNERGIES[o.id].name : (SKILLS[o.id] || BURST_MODS[o.id] || { name: o.id }).name + (o.to || '')); _apply(o); };
  while (!res && t < 900) {
    pilot(w); w.step(STEP); t += STEP; __now += STEP * 1000;
    const gk = w.goal ? w.goal.id + ':' + w.D.st : null; if (gk !== lastGoal) { lastGoal = gk; goalLog.push(gk + '@' + Math.round(w.runT)); }
    if (++frames % 6 === 0) { w.render(document.createElement('canvas').getContext('2d')); w.hud(); w.events.length = 0; }
    maxE = Math.max(maxE, w.enemies.length); maxB = Math.max(maxB, w.bullets.count());
  }
  const m = res ? res.stats : w.m, f = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  const ct = m.choiceTimes || [];
  if (world) return { stage, win: res && res.win, run: f(res ? res.runT : t), wood: m.wood, earned: m.earned, workT: f(m.workT), rescued: rescues.join(','), upper: m.upperRoute || 0, goals: goalLog.join(' ') };
  return { stage, plane, lv: level, pick: pickIdx, win: res && res.win, run: f(res ? res.runT : t), boss: f(res && res.bossTime), kill: f(m.firstKill), choice1: f(m.firstSkill), choices: ct.length, choiceAvg: f(ct.length ? ct.reduce((a, b) => a + b, 0) / ct.length : null), miss: m.offerMiss || 0,
    avgKill: f(res && res.avgKill), gap: f(m.gapMax), kills: m.kills, kpm: f(m.kills / ((res ? res.runT : t) / 60)), leaks: m.leaks, backlogs: m.backlogs || 0, hits: m.hitsTaken, bursts: m.bursts, stockIdle: f(m.stockIdle), inter: m.interacts, interMax: f(m.interactMax), maxE, maxB,
    noGoal: f(m.noGoalMax), breaks: m.breaks, armor: f(m.armorFirst) + '→' + f(m.armorAfter), hurt: res && res.hurt ? Object.entries(res.hurt).map(([k, v]) => k + v).join(',') : '', last: res && res.lastHurt, build: pickLog.join(' > '), stream: res && res.stream, goals: goalLog.join(' '), mem: res && res.memories && res.memories.join('/') };
}
`);
const show = (o) => console.log(JSON.stringify(o));
const only = process.argv[3];
// 退出码：脚本报错，或“不会受伤”的两局没打通，就算失败（会被击中的普通机器人输了不算失败，只看数据）
let failed = 0; const fail = (msg) => { failed++; console.log('FAIL', msg); };
// 这是流程测试：关卡按建议共享等级 +6 打（比前沿宽裕，结果不靠运气；难度本身由 report-sim 量，docs/design.md §3.5）。
// 必须通关的是“照推荐选”（选法 1）；选法 0 总选第一张，构筑常常不成型，打不过首领是设计如此，只看数据
const cases = ['1-1', '1-2', '1-3'].map((st, i) => [st, Math.min(20, R(`STAGES['${st}'].rec`) + (i ? 6 : 0)), i ? 2 : 1]).filter((c) => !only || c[0] === only);
for (const [st, lv, cap] of cases) for (const pk of [0, 1]) {
  try { const r = R(`run('${st}', 'moon', ${lv}, ${cap}, ${pk}, true)`); show(r); if (!r.win && pk === 1) fail(`${st} 选法 ${pk} 没有通关`); }
  catch (e) { fail(`${st} 脚本报错 ${e && e.stack ? e.stack.split('\n').slice(0, 6).join(' | ') : e}`); }
}
// v0.10 家园因果链在真实战斗里成立：要救的伙伴一定出现并能救下；风道修好后上层风圈通往高空云桥，糖果商人在上面
const story = [
  ['1-1', { target: 'bunny' }, 'bunny', false],
  ['1-2', { target: 'grandpa', rescued: ['bunny'] }, 'grandpa', false],
  ['1-3', { upper: true, target: 'merchant', rescued: ['bunny', 'grandpa'] }, 'merchant', true],
  ['1-1', { upper: true, rescued: ['bunny', 'grandpa', 'merchant'], scout: true, preferUpper: true }, null, true],
].filter((c) => !only || c[0] === only);
for (const [st, wf, want, upper] of story) {
  try {
    const slv = Math.min(20, R(`STAGES['${st}'].rec`) + (st === '1-1' ? 2 : 6)); // 流程测试：和上面一样按建议等级宽裕地打、照推荐选，首领一定打得倒
    const r = R(`run('${st}', 'moon', ${slv}, 2, 1, true, ${JSON.stringify(wf)})`); console.log('story', JSON.stringify(r));
    if (want && !r.rescued.split(',').includes(want)) fail(`${st} 没救到 ${want}`);
    if (upper && !(r.upper >= 1)) fail(`${st} 没走上层云桥`);
    if (!(r.wood >= 10)) fail(`${st} 梦木太少（${r.wood}）`);
    if (!(r.earned > 0)) fail(`${st} 目标没有入账星尘`);
  } catch (e) { fail(`story ${st} 脚本报错 ${e && e.stack ? e.stack.split('\n').slice(0, 6).join(' | ') : e}`); }
}
for (const [st, lv, cap] of cases) { try { console.log('mortal', JSON.stringify(R(`run('${st}', 'candy', ${lv}, ${cap}, 0, false)`))); } catch (e) { fail(`mortal ${st} 脚本报错 ${e.stack.split('\n').slice(0, 6).join(' | ')}`); } }
try { console.log('preview', R(`(function(){ const w = new World({ mode: 'preview', W: 1280, plane: 'whale', settings }); for (let i = 0; i < 1400; i++) w.step(1/120); return 'ok kills=' + w.m.kills; })()`)); } catch (e) { fail(`大招预览脚本报错 ${e.stack.split('\n').slice(0, 5).join(' | ')}`); }
console.log(failed ? `冒烟测试失败 ${failed} 项` : '冒烟测试通过');
process.exitCode = failed ? 1 : 0;
