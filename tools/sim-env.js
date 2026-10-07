// 无头测试共用环境：用假画布加载游戏脚本，提供一个像玩家一样的自动驾驶 pilot(w)。smoke-sim / report-sim 共用。
// load(dir) → { R, ctx }：R(code) 在游戏脚本的上下文里执行代码
const fs = require('fs'), vm = require('vm'), path = require('path');
// 自动驾驶：只用游戏自己的全局（浏览器里截图工具也注入同一份）
const PILOT_SRC = `
// 量难度用的“普通玩家”（w.pilotHuman = { react, slip, aim, seed }）：威胁出现 react 秒后才看见；
// 每半秒一次判断，有 slip 的概率这半秒走神不躲；瞄准偏 aim 像素以内。随机只用这里的哈希，不碰游戏的随机数
function pilotHash(a, b) { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function pilot(w) {
  const p = w.player, mid = (TOP + BOTTOM) / 2; let tx = w.W * 0.22, ty = mid, busy = false;
  const H = w.pilotHuman, react = H ? H.react : 0, lapse = !!H && pilotHash(Math.floor(w.t * 2), H.seed) < H.slip;
  const age = (e) => w.t - (e.shownT != null ? e.shownT : e.seenT != null ? e.seenT : -1e9);
  // 子弹只会直飞：优先对准主目标（带队精英举旗时更优先），否则对准前方最近敌人的高度
  let best = null, bd = 1e9;
  for (const e of w.enemies) { if (!e.alive || e.x < p.x + 30 || e.x > w.W) continue; const d = e.x - p.x + Math.abs(e.y - p.y) * 0.6 - (e.goal ? 260 : 0) - (e.type === 'cmdr' && e.rally > 0 ? 300 : 0) - (e.guarded ? -400 : 0); if (d < bd) { bd = d; best = e; } }
  if (best) ty = best.y + (H ? (pilotHash(Math.floor(w.t * 2.5), H.seed + 7) - 0.5) * 2 * H.aim : 0);
  // Boss 正面护甲：像玩家一样对准还在的甲片（没有散兵时）
  if (w.boss && w.boss.plates && !w.enemies.some((e) => e.alive && e.bossAdd)) { const pl = w.boss.plates.find((q) => q.alive); if (pl) ty = w.boss.y + pl.dy; }
  const k = w.pickups.find((q) => q.kind === 'gold' || q.kind === 'chest' || q.kind === 'heart'); if (k && k.x > p.x - 40) { tx = Math.max(k.x - 10, w.W * 0.15); ty = k.y; busy = true; }
  const gt = w.guideTarget && w.guideTarget(); if (gt && !(w.ritual && w.ritual.st === 'choose')) { tx = clamp(gt.x - 6, 40, w.W * 0.8); ty = gt.y; busy = true; }
  if (w.ritual && w.ritual.st === 'choose') {
    // 选法 0：总选第一个；选法 1：像玩家一样优先升级已有的 / 联动，不随手换掉支援
    const gs = w.ritual.gates, score = (o) => (o.kind === 'link' ? 3 : o.from > 0 ? 2 : o.replace ? -1 : 1);
    const G = w.pilotPickFn ? w.pilotPickFn(gs) : w.pilotPick === 0 ? gs[0] : (score(gs[1].opt) > score(gs[0].opt) ? gs[1] : gs[0]); tx = G.x; ty = G.y; busy = true;
  }
  let dodge = 0; if (!busy || w.pilotDodge) w.bullets.each((b) => { if (b.t < react) return; const dx = b.x - p.x, dy = b.y - p.y; if (dx > -20 && dx < 160 && Math.abs(dy) < 50) dodge += dy > 0 ? -1 : 1; });
  // 普通玩家也会躲开迎面撞来的敌人（看见之后）
  if (H) for (const e of w.enemies) { if (!e.alive || e.isBoss || age(e) < react) continue; const dx = e.x - p.x, dy = e.y - p.y; if (dx > -10 && dx < 90 && Math.abs(dy) < (e.r || 20) + 24) dodge += dy > 0 ? -1.5 : 1.5; }
  for (const wr of w.warns) if (wr.kind === 'zone' && !wr.fired && wr.t >= react && p.y > wr.y - 20 && p.y < wr.y + wr.h + 20 && p.x > wr.x - 20 && p.x < wr.x + wr.w + 20) dodge += p.y < wr.y + wr.h / 2 ? -2 : 2;
  // 地图伸手：看到危险色的柱子和横向箭头，就离开那一条高度（像玩家一样）
  for (const L of (w.lurks || [])) if (L.kind === 'hand' && L.st !== 'retract' && !(L.st === 'omen' && L.t < react) && Math.abs(p.y - L.reachY) < 80 && p.x < L.x + 60) dodge += p.y < L.reachY ? -2 : 2; // 手会伸到这一高度往这边抓：上下让开
  // 白线预警（灯塔眼 / Boss 指针）：像玩家一样离开那条线
  for (const wr of w.warns) {
    if (wr.kind !== 'line' || wr.t < react) continue;
    const ca = Math.cos(wr.a), sa = Math.sin(wr.a), rx = p.x - wr.x, ry = p.y - wr.y, along = rx * ca + ry * sa;
    if (along < 0 || along > (wr.len || 1500)) continue;
    const off = -rx * sa + ry * ca; // 到线的有向距离
    if (Math.abs(off) < (wr.w || 4) / 2 + 34) dodge += (off >= 0 ? 1 : -1) * Math.sign(ca || 1) * 2;
  }
  if (lapse) dodge = 0; // 走神：这半秒没躲
  w.setInput(p.idx, { mx: Math.sign(tx - p.x) * Math.min(1, Math.abs(tx - p.x) / 60), my: dodge ? Math.sign(dodge) : Math.sign(ty - p.y) * Math.min(1, Math.abs(ty - p.y) / 40), burst: p.stock >= 1 && !w.ritual && !w.pilotNoBurst });
}
`;
function load(dir) {
  dir = dir || path.join(__dirname, '..', 'js');
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
  for (const f of ['util', 'data', 'gear', 'station', 'audio', 'input', 'art', 'spaceart', 'mapart', 'world', 'foes', 'mapfx', 'offers', 'loot', 'director', 'surprise', 'boss', 'priest', 'captain', 'spacefoes', 'racefoes']) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  const R = (code) => vm.runInContext(code, ctx);
  R('var settings = DEFAULT_SETTINGS();\n' + PILOT_SRC);
  return { R, ctx };
}
module.exports = { load, PILOT_SRC };
