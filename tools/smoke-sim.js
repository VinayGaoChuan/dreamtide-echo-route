// 无头冒烟测试：用假画布加载游戏脚本，让一个简单的自动驾驶玩完整局（每架飞机各一局），输出 §16 数据验收指标。
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
for (const f of ['util', 'data', 'audio', 'input', 'art', 'world', 'boss']) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const R = (code) => vm.runInContext(code, ctx);
R(`
var settings = DEFAULT_SETTINGS();
function pilot(w) {
  const p = w.player; let tx = w.W * 0.25, ty = (TOP + BOTTOM) / 2;
  const cr = w.pickups.find((k) => k.kind === 'crystal' || k.kind === 'gold' || k.kind === 'chest' || k.kind === 'heart');
  if (cr) { tx = Math.max(cr.x - 10, w.W * 0.15); ty = cr.y; }
  if (w.portals.length) { const q = w.portals[w.pilotPick % w.portals.length]; tx = Math.min(q.x, w.W * 0.6); ty = q.y; }
  let dodge = 0; w.bullets.each((b) => { const dx = b.x - p.x, dy = b.y - p.y; if (dx > -20 && dx < 160 && Math.abs(dy) < 60) dodge += dy > 0 ? -1 : 1; });
  const mx = Math.sign(tx - p.x) * Math.min(1, Math.abs(tx - p.x) / 60), my = dodge ? Math.sign(dodge) : Math.sign(ty - p.y) * Math.min(1, Math.abs(ty - p.y) / 60);
  Input.out.mx = mx; Input.out.my = my;
  if (p.burst >= 1) w.tryBurst();
}
function run(plane, first, godmode) {
  let res = null; const meta = freshMeta();
  meta.planes[plane] = newPlaneRecord(plane);
  const stats = planeStats(meta, plane, 'fire');
  const w = new World({ mode: 'run', W: 1280, plane, stats, first, settings, cb: { onEnd: (r) => res = r } });
  w.pilotPick = Math.floor(Math.random() * 3);
  if (godmode) { w.player.hp = w.player.maxHp = 999; }
  const STEP = 1 / 120; let t = 0, frames = 0, maxEnemies = 0, maxBullets = 0;
  while (!res && t < 900) {
    pilot(w); w.step(STEP); t += STEP; __now += STEP * 1000;
    if (++frames % 6 === 0) { w.render(document.createElement('canvas').getContext('2d')); w.hud(); w.events.length = 0; }
    maxEnemies = Math.max(maxEnemies, w.enemies.length); maxBullets = Math.max(maxBullets, w.bullets.count());
  }
  const m = res ? res.stats : w.m;
  const f = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  return { plane, win: res && res.win, run: f(res ? res.runT : t), boss: f(res && res.bossTime), kill: f(m.firstKill), skill: f(m.firstSkill), syn: f(m.firstSyn), burst: f(m.firstBurst),
    crystals: m.crystals, syns: m.syns, bursts: m.bursts, hl: m.highlights, avgKill: f(res && res.avgKill), gap: f(m.gapMax), streak: m.maxStreak, kills: m.kills, dust: Math.round(m.dust), stream: res && res.stream, hits: m.hitsTaken, maxE: maxEnemies, maxB: maxBullets, route: m.route.join('>') };
}
`);
const planes = ['moon', 'cloud', 'candy', 'paper', 'whale', 'clock'];
for (const pl of planes) {
  try { console.log(JSON.stringify(R(`run('${pl}', ${pl === 'moon'}, true)`))); }
  catch (e) { console.log(pl, 'ERROR', e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e); }
}
try { console.log('mortal', JSON.stringify(R(`run('moon', true, false)`))); } catch (e) { console.log('mortal ERROR', e.stack.split('\n').slice(0, 5).join(' | ')); }
try { console.log('preview', R(`(function(){ const w = new World({ mode: 'preview', W: 1280, plane: 'whale', settings }); for (let i = 0; i < 1400; i++) w.step(1/120); return 'ok kills=' + w.m.kills; })()`)); } catch (e) { console.log('preview ERROR', e.stack.split('\n').slice(0, 5).join(' | ')); }
