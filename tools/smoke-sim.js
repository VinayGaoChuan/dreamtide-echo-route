// 无头冒烟测试：用假画布加载游戏脚本，让一个简单的自动驾驶按推荐等级打完第一章三关，输出验收指标。
// 用法：node tools/smoke-sim.js [js 目录] [关卡，如 1-2]；有失败项时退出码为 1（GitHub Actions 用它挡住坏提交）
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'js');
const noop = () => {};
const fakeCtx = new Proxy({}, { get: (t, k) => {
  if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (k === 'createPattern') return () => ({});
  if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
  if (k === 'measureText') return () => ({ width: 10 });
  if (k in t) return t[k];
  return noop;
}, set: (t, k, v) => { t[k] = v; return true; } });
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => fakeCtx, toDataURL: () => 'data:,' });
const ctx = {
  console, Math, Date, JSON, performance: { now: () => ctx.__now }, __now: 0, setTimeout, clearTimeout, setInterval: () => 0,
  window: { addEventListener: noop, matchMedia: () => ({ matches: false }) },
  document: { createElement: fakeCanvas, addEventListener: noop },
  navigator: { getGamepads: () => [] }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
};
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['util', 'data', 'audio', 'input', 'art', 'mapart', 'world', 'foes', 'mapfx', 'offers', 'director', 'surprise', 'boss', 'captain']) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const R = (code) => vm.runInContext(code, ctx);
R(`
var settings = DEFAULT_SETTINGS();
function pilot(w) {
  const p = w.player, mid = (TOP + BOTTOM) / 2; let tx = w.W * 0.22, ty = mid, busy = false;
  // 子弹只会直飞：优先对准主目标（带队精英举旗时更优先），否则对准前方最近敌人的高度
  let best = null, bd = 1e9;
  for (const e of w.enemies) { if (!e.alive || e.x < p.x + 30 || e.x > w.W) continue; const d = e.x - p.x + Math.abs(e.y - p.y) * 0.6 - (e.goal ? 260 : 0) - (e.type === 'cmdr' && e.rally > 0 ? 300 : 0) - (e.guarded ? -400 : 0); if (d < bd) { bd = d; best = e; } }
  if (best) ty = best.y;
  // Boss 正面护甲：像玩家一样对准还在的甲片（没有散兵时）
  if (w.boss && w.boss.plates && !w.enemies.some((e) => e.alive && e.bossAdd)) { const pl = w.boss.plates.find((q) => q.alive); if (pl) ty = w.boss.y + pl.dy; }
  const k = w.pickups.find((q) => q.kind === 'gold' || q.kind === 'chest' || q.kind === 'heart'); if (k && k.x > p.x - 40) { tx = Math.max(k.x - 10, w.W * 0.15); ty = k.y; busy = true; }
  const gt = w.guideTarget && w.guideTarget(); if (gt && !(w.ritual && w.ritual.st === 'choose')) { tx = clamp(gt.x - 6, 40, w.W * 0.8); ty = gt.y; busy = true; }
  if (w.ritual && w.ritual.st === 'choose') {
    // 选法 0：总选第一个；选法 1：像玩家一样优先升级已有的 / 联动，不随手换掉支援
    const gs = w.ritual.gates, score = (o) => (o.kind === 'link' ? 3 : o.from > 0 ? 2 : o.replace ? -1 : 1);
    const G = w.pilotPick === 0 ? gs[0] : (score(gs[1].opt) > score(gs[0].opt) ? gs[1] : gs[0]); tx = G.x; ty = G.y; busy = true;
  }
  let dodge = 0; if (!busy || w.pilotDodge) w.bullets.each((b) => { const dx = b.x - p.x, dy = b.y - p.y; if (dx > -20 && dx < 160 && Math.abs(dy) < 50) dodge += dy > 0 ? -1 : 1; });
  for (const wr of w.warns) if (wr.kind === 'zone' && !wr.fired && p.y > wr.y - 20 && p.y < wr.y + wr.h + 20 && p.x > wr.x - 20 && p.x < wr.x + wr.w + 20) dodge += p.y < wr.y + wr.h / 2 ? -2 : 2;
  w.setInput(p.idx, { mx: Math.sign(tx - p.x) * Math.min(1, Math.abs(tx - p.x) / 60), my: dodge ? Math.sign(dodge) : Math.sign(ty - p.y) * Math.min(1, Math.abs(ty - p.y) / 40), burst: p.stock >= 1 && !w.ritual });
}
function run(stage, plane, level, cap, pickIdx, godmode) {
  let res = null; const meta = freshMeta(); meta.shared.level = level; meta.planes[plane] = newPlaneRecord(plane);
  const w = new World({ mode: 'run', W: 1280, plane, stage, ultCap: cap, stats: planeStats(meta, plane), first: stage === '1-1' && level === 1, settings, cb: { onEnd: (r) => res = r } });
  const goalLog = []; let lastGoal = null;
  w.pilotPick = pickIdx;
  if (godmode) { w.player.hp = w.player.maxHp = 999; }
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
  return { stage, plane, lv: level, pick: pickIdx, win: res && res.win, run: f(res ? res.runT : t), boss: f(res && res.bossTime), kill: f(m.firstKill), choice1: f(m.firstSkill), choices: ct.length, choiceAvg: f(ct.length ? ct.reduce((a, b) => a + b, 0) / ct.length : null), miss: m.offerMiss || 0,
    avgKill: f(res && res.avgKill), gap: f(m.gapMax), kills: m.kills, kpm: f(m.kills / ((res ? res.runT : t) / 60)), leaks: m.leaks, backlogs: m.backlogs || 0, hits: m.hitsTaken, bursts: m.bursts, stockIdle: f(m.stockIdle), inter: m.interacts, interMax: f(m.interactMax), maxE, maxB,
    noGoal: f(m.noGoalMax), breaks: m.breaks, armor: f(m.armorFirst) + '→' + f(m.armorAfter), hurt: res && res.hurt ? Object.entries(res.hurt).map(([k, v]) => k + v).join(',') : '', last: res && res.lastHurt, build: pickLog.join(' > '), stream: res && res.stream, goals: goalLog.join(' '), mem: res && res.memories && res.memories.join('/') };
}
`);
const show = (o) => console.log(JSON.stringify(o));
const only = process.argv[3];
// 退出码：脚本报错，或“不会受伤”的两局没打通，就算失败（会被击中的普通机器人输了不算失败，只看数据）
let failed = 0; const fail = (msg) => { failed++; console.log('FAIL', msg); };
const cases = [['1-1', 1, 1], ['1-2', 2, 2], ['1-3', 3, 2]].filter((c) => !only || c[0] === only);
for (const [st, lv, cap] of cases) for (const pk of [0, 1]) {
  try { const r = R(`run('${st}', 'moon', ${lv}, ${cap}, ${pk}, true)`); show(r); if (!r.win) fail(`${st} 选法 ${pk} 没有通关`); }
  catch (e) { fail(`${st} 脚本报错 ${e && e.stack ? e.stack.split('\n').slice(0, 6).join(' | ') : e}`); }
}
for (const [st, lv, cap] of cases) { try { console.log('mortal', JSON.stringify(R(`run('${st}', 'candy', ${lv}, ${cap}, 0, false)`))); } catch (e) { fail(`mortal ${st} 脚本报错 ${e.stack.split('\n').slice(0, 6).join(' | ')}`); } }
try { console.log('preview', R(`(function(){ const w = new World({ mode: 'preview', W: 1280, plane: 'whale', settings }); for (let i = 0; i < 1400; i++) w.step(1/120); return 'ok kills=' + w.m.kills; })()`)); } catch (e) { fail(`大招预览脚本报错 ${e.stack.split('\n').slice(0, 5).join(' | ')}`); }
console.log(failed ? `冒烟测试失败 ${failed} 项` : '冒烟测试通过');
process.exitCode = failed ? 1 : 0;
