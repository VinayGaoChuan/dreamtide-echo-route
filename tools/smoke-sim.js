// 无头冒烟测试：用假画布加载游戏脚本，让一个简单的自动驾驶按推荐等级打完第一章三关，输出验收指标。
// 用法：node tools/smoke-sim.js [js 目录]
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
for (const f of ['util', 'data', 'audio', 'input', 'art', 'mapart', 'world', 'mapfx', 'offers', 'boss', 'captain']) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const R = (code) => vm.runInContext(code, ctx);
R(`
var settings = DEFAULT_SETTINGS();
function pilot(w) {
  const p = w.player, mid = (TOP + BOTTOM) / 2; let tx = w.W * 0.22, ty = mid, busy = false;
  // 子弹只会直飞：默认对准前方最近敌人的高度
  let best = null, bd = 1e9; for (const e of w.enemies) { if (!e.alive || e.x < p.x + 30 || e.x > w.W) continue; const d = e.x - p.x + Math.abs(e.y - p.y) * 0.6; if (d < bd) { bd = d; best = e; } }
  if (best) ty = best.y;
  const k = w.pickups.find((q) => q.kind === 'gold' || q.kind === 'chest' || q.kind === 'heart'); if (k) { tx = Math.max(k.x - 10, w.W * 0.15); ty = k.y; busy = true; }
  if (w.portals.length) { const q = w.portals.find((q) => q.type === 'boss') || w.portals[(w.segIdx + w.pilotPick) % w.portals.length]; tx = Math.min(q.x, w.W * 0.6); ty = q.y; busy = true; }
  const mo = w.mapObjs.find((o) => o.state === 'idle' && (o.kind === 'bridge' ? o.rings.some((q) => !q.lit && q.x < w.W) : o.x < w.W + 40));
  if (mo && !w.portals.length) {
    const c = w.mapCenter(mo); busy = true;
    if (mo.kind === 'bridge') { const q = mo.rings.find((r) => !r.lit); tx = q.x < p.x + 60 ? q.x : Math.min(q.x - 20, w.W * 0.7); ty = q.y; }
    else if (mo.kind === 'npc') { tx = c.x + mo.ringDx; ty = c.y; }
    else { tx = c.x - 50; ty = c.y; }
  }
  if (w.offer && w.offer.st === 'choose') {
    // 选法 0：总选第一个；选法 1：像玩家一样优先升级已有的 / 联动，不随手换掉支援
    const gs = w.offer.gates, score = (o) => (o.kind === 'link' ? 3 : o.from > 0 ? 2 : o.replace ? -1 : 1);
    const G = w.pilotPick === 0 ? gs[0] : (score(gs[1].opt) > score(gs[0].opt) ? gs[1] : gs[0]); tx = G.x; ty = G.y; busy = true;
  }
  let dodge = 0; if (!busy) w.bullets.each((b) => { const dx = b.x - p.x, dy = b.y - p.y; if (dx > -20 && dx < 160 && Math.abs(dy) < 50) dodge += dy > 0 ? -1 : 1; });
  Input.out.mx = Math.sign(tx - p.x) * Math.min(1, Math.abs(tx - p.x) / 60); Input.out.my = dodge ? Math.sign(dodge) : Math.sign(ty - p.y) * Math.min(1, Math.abs(ty - p.y) / 40);
  if (p.stock >= 1 && !w.offer) w.tryBurst();
}
function run(stage, plane, level, cap, pickIdx, godmode) {
  let res = null; const meta = freshMeta(); meta.shared.level = level; meta.planes[plane] = newPlaneRecord(plane);
  const w = new World({ mode: 'run', W: 1280, plane, stage, ultCap: cap, stats: planeStats(meta, plane), first: stage === '1-1' && level === 1, settings, cb: { onEnd: (r) => res = r } });
  w.pilotPick = pickIdx;
  if (godmode) { w.player.hp = w.player.maxHp = 999; }
  const STEP = 1 / 120; let t = 0, frames = 0, maxE = 0, maxB = 0, pickLog = [];
  const _apply = w.applyOption.bind(w); w.applyOption = (o) => { pickLog.push(o.kind === 'link' ? SYNERGIES[o.id].name : (SKILLS[o.id] || BURST_MODS[o.id] || { name: o.id }).name + (o.to || '')); _apply(o); };
  while (!res && t < 900) {
    pilot(w); w.step(STEP); t += STEP; __now += STEP * 1000;
    if (++frames % 6 === 0) { w.render(document.createElement('canvas').getContext('2d')); w.hud(); w.events.length = 0; }
    maxE = Math.max(maxE, w.enemies.length); maxB = Math.max(maxB, w.bullets.count());
  }
  const m = res ? res.stats : w.m, f = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  const ct = m.choiceTimes || [];
  return { stage, plane, lv: level, pick: pickIdx, win: res && res.win, run: f(res ? res.runT : t), boss: f(res && res.bossTime), kill: f(m.firstKill), choice1: f(m.firstSkill), choices: ct.length, choiceAvg: f(ct.length ? ct.reduce((a, b) => a + b, 0) / ct.length : null), miss: m.offerMiss || 0,
    avgKill: f(res && res.avgKill), gap: f(m.gapMax), kills: m.kills, kpm: f(m.kills / ((res ? res.runT : t) / 60)), leaks: m.leaks, backlogs: m.backlogs || 0, hits: m.hitsTaken, bursts: m.bursts, stockIdle: f(m.stockIdle), inter: m.interacts, interMax: f(m.interactMax), maxE, maxB,
    build: pickLog.join(' > '), stream: res && res.stream, route: m.route.join('>') };
}
`);
const show = (o) => console.log(JSON.stringify(o));
const only = process.argv[3];
const cases = [['1-1', 1, 1], ['1-2', 2, 2], ['1-3', 3, 2]].filter((c) => !only || c[0] === only);
for (const [st, lv, cap] of cases) for (const pk of [0, 1]) {
  try { show(R(`run('${st}', 'moon', ${lv}, ${cap}, ${pk}, true)`)); }
  catch (e) { console.log(st, 'ERROR', e && e.stack ? e.stack.split('\n').slice(0, 6).join(' | ') : e); }
}
for (const [st, lv, cap] of cases) { try { console.log('mortal', JSON.stringify(R(`run('${st}', 'candy', ${lv}, ${cap}, 0, false)`))); } catch (e) { console.log('mortal ERROR', e.stack.split('\n').slice(0, 6).join(' | ')); } }
try { console.log('preview', R(`(function(){ const w = new World({ mode: 'preview', W: 1280, plane: 'whale', settings }); for (let i = 0; i < 1400; i++) w.step(1/120); return 'ok kills=' + w.m.kills; })()`)); } catch (e) { console.log('preview ERROR', e.stack.split('\n').slice(0, 5).join(' | ')); }
