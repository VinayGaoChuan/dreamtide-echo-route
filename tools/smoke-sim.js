// headless smoke test: load the game scripts with a fake canvas and simulate every combat mode
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, "..", "js");
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
  console, Math, Date, JSON, performance: { now: () => Date.now() }, setTimeout, clearTimeout, setInterval: () => 0,
  window: { addEventListener: noop, matchMedia: () => ({ matches: false }) },
  document: { createElement: fakeCanvas, addEventListener: noop },
  navigator: { getGamepads: () => [] }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
};
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['util', 'data', 'audio', 'input', 'art', 'world', 'boss']) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const R = (code) => vm.runInContext(code, ctx);
R(`
var settings = DEFAULT_SETTINGS();
var log = [];
function mkRun(cards, relics) { const r = tempRun('needle','echo'); r.cards = cards||[]; r.relics = relics||[]; r.dashCharges = 2; return r; }
function sim(w, secs, pilot) {
  const STEP = 1/120; let t = 0, frames = 0;
  while (t < secs) { if (pilot) pilot(w, t); w.step(STEP); t += STEP; if (++frames % 4 === 0) w.render(document.createElement('canvas').getContext('2d')); w.hud(); w.events.length = 0; if (w.done) break; }
  return t;
}
// random-ish pilot: weave, cut when blue near, dash sometimes, perform when full
function pilot(w, t) {
  const p = w.player; Input.out.mx = Math.sin(t * 1.3); Input.out.my = Math.cos(t * 0.9);
  if (w.hint === 'cut' || w.hint === 'parry') Input.press('cut');
  if (Math.random() < 0.004) Input.press('dash');
  if (w.run.res >= 100) Input.press('perform');
}
var results = {};
`);
const cases = [
  ['tutorial', `(function(){ let done=false; const w = new World({mode:'tutorial', W:1280, run: mkRun(), settings, cb:{onTutorialDone:()=>{done=true;}}});
     const t = sim(w, 120, (w,t)=>{ pilot(w,t); if (w.tut && w.tut.step===0){Input.out.mx=Math.sin(t*3);} if (w.tut && w.tut.step===4 && w.warns.length && w.warns[0].t>0.9) Input.press('dash'); if (w.tut && w.tut.step===5) Input.press('perform'); });
     return {done, step: w.tut.step, t: t.toFixed(1)}; })()`],
  ...['kill', 'survive', 'core'].map((goal) => [`normal-${goal}`, `(function(){ let res=null, dead=null; const w = new World({mode:'room', W:1400, run: mkRun([{id:'echo',stacks:2},{id:'tide',stacks:1},{id:'mirror',stacks:1},{id:'gentle',stacks:1}], ['glass','sand']), node:{type:'normal', col:5, lane:1, goal:'${goal}'}, settings, cb:{onClear:r=>res=r, onDeath:r=>dead=r}});
     w.player.hp = 5000; w.player.maxHp = 5000; const t = sim(w, 200, pilot); return {cleared: !!res, dead: !!dead, wave: w.wave, t: t.toFixed(1), kills: w.stats.kills, cuts: w.stats.cuts, parries: w.stats.parries}; })()`]),
  ['elite', `(function(){ let res=null; const w = new World({mode:'room', W:1280, run: mkRun([{id:'unfocus',stacks:1},{id:'overheat',stacks:1},{id:'paperboat',stacks:1},{id:'fallstar',stacks:1}]), node:{type:'elite', col:2, lane:2, elite:'tickE', affix:'shatter'}, settings, cb:{onClear:r=>res=r}});
     w.player.hp = 5000; w.player.maxHp = 5000; const t = sim(w, 200, pilot); return {cleared: !!res, t: t.toFixed(1), kills: w.stats.kills}; })()`],
  ['challenge', `(function(){ let res=null; const w = new World({mode:'room', W:1280, run: mkRun([{id:'rewind',stacks:1},{id:'stardust',stacks:2},{id:'mint',stacks:1},{id:'nightlamp',stacks:2},{id:'quiet',stacks:1}]), node:{type:'challenge', col:4, lane:2}, settings, cb:{onClear:r=>res=r}});
     w.player.hp = 5000; w.player.maxHp = 5000; const t = sim(w, 220, pilot); return {cleared: !!res, failed: w.challengeFailed, t: t.toFixed(1)}; })()`],
  ...['needle', 'blade', 'kite', 'bell'].map((wp) => [`boss-${wp}`, `(function(){ let res=null; const run = mkRun(); run.weaponId='${wp}'; run.perfId=['echo','melody','gravity','still'][${['needle', 'blade', 'kite', 'bell'].indexOf(wp)}];
     const w = new World({mode:'boss', W:1280, run, settings, cb:{onClear:r=>res=r}}); w.player.hp = 99999; w.player.maxHp = 99999;
     const phases = new Set(); const t = sim(w, 420, (w,t)=>{ pilot(w,t); if (w.boss) phases.add(w.boss.phase); });
     return {cleared: !!res, phases: [...phases].join(','), bossHp: Math.round(w.boss.hp), t: t.toFixed(1), bossTime: res && Math.round(res.bossTime)}; })()`]),
  ['demo', `(function(){ const w = new World({mode:'demo', W:1280, weapon:'blade', settings}); sim(w, 12, null); return {cuts: w.stats.cuts, parries: w.stats.parries}; })()`],
  ['death', `(function(){ let dead=null; const w = new World({mode:'room', W:1280, run: mkRun(), node:{type:'normal', col:7, lane:0, goal:'kill'}, settings, cb:{onDeath:r=>dead=r}}); w.player.hp = 1; w.player.maxHp=100; sim(w, 60, (w,t)=>{Input.out.mx=1;Input.out.my=0;}); return {dead: !!dead}; })()`],
];
for (const [name, code] of cases) {
  try { const r = R(code); console.log(name.padEnd(16), JSON.stringify(r)); }
  catch (e) { console.log(name.padEnd(16), 'ERROR', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); }
}
