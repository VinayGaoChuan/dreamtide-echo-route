'use strict';
/* 拾荒宇宙的敌人造型（美术 A，docs/design.md §15）：保留胖乎乎、一眼看清的轮廓和大眼睛，换成各族的无人机和小船，
   身体用这一族的签名色（§2.2）；护盾族的硬目标外面一层蓝色六边形罩，装甲族的硬目标挂铁灰色甲板（§4.3）。
   行为和碰撞不变（还是 jelly / moth / boat / tick / star / beacon / armor / cmdr 这些类型），只换画法。 */

const RACE_DEFAULT = '#9f8cf5';
function shade(hex, k) { // k > 0 变亮，k < 0 变暗
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
const RACE_PAL_CACHE = {};
function racePal(e) {
  const c = (e && e.race && RACES[e.race] && RACES[e.race].color) || (e && e.tint) || RACE_DEFAULT;
  return RACE_PAL_CACHE[c] || (RACE_PAL_CACHE[c] = { c, light: shade(c, 0.45), mid: shade(c, 0.12), dark: shade(c, -0.45), deep: shade(c, -0.7), glow: hexA(c.length === 7 ? c : '#9f8cf5', 0.9) });
}
/* 金属身体：一层渐变 + 顶部一道亮边（深色背景上也看得清轮廓） */
function hullFill(g, P, x0, y0, r) { const gr = g.createLinearGradient(x0, y0 - r, x0, y0 + r); gr.addColorStop(0, P.light); gr.addColorStop(0.55, P.mid); gr.addColorStop(1, P.dark); return gr; }
function rimLight(g, path, a) { g.save(); g.strokeStyle = `rgba(255,255,255,${a || 0.35})`; g.lineWidth = 1.4; path(); g.stroke(); g.restore(); }
/* 一条横着的面罩 + 一对大眼睛：所有无人机共用的“脸” */
function visor(g, x, y, w, h, o = {}) {
  g.fillStyle = '#16122a'; g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - h / 2, w, h, h / 2) : g.rect(x - w / 2, y - h / 2, w, h); g.fill();
  const ec = o.angry ? '#ff6a7a' : o.color || '#bff4ff', gap = w * 0.22, rx = h * 0.24, ry = h * 0.32 * (o.squint || 1);
  for (const s of [-1, 1]) {
    g.fillStyle = ec; g.beginPath(); g.ellipse(x + s * gap + (o.look || 0), y, rx, ry, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + s * gap + (o.look || 0) - rx * 0.35, y - ry * 0.4, rx * 0.38, 0, TAU); g.fill();
  }
}
/* 护盾族的硬目标：一层淡蓝六边形罩；装甲族：两块铁灰甲板 */
function defenseMark(g, e, r) {
  if (!e || !e.def || !(e.elite || e.type === 'armor' || e.type === 'cmdr' || e.isBossArt)) return;
  if (e.def === 'shield') {
    g.save(); g.strokeStyle = 'rgba(120,210,255,0.55)'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU + 0.52; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke();
    g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, r * 1.1, 'rgba(90,180,255,0.6)', 0.18); g.restore();
  } else {
    g.save(); g.fillStyle = '#7a7f92'; g.strokeStyle = PAL.ink; g.lineWidth = 1.6;
    for (const s of [-1, 1]) { g.beginPath(); g.roundRect ? g.roundRect(-r * 0.55, s * r * 0.62 - 4, r * 1.1, 8, 3) : g.rect(-r * 0.55, s * r * 0.62 - 4, r * 1.1, 8); g.fill(); g.stroke(); g.fillStyle = '#b7bccb'; g.fillRect(-r * 0.45, s * r * 0.62 - 3, r * 0.9, 2); g.fillStyle = '#7a7f92'; }
    g.restore();
  }
}

/* 浮游雷（原泡泡水母）：一颗圆滚滚的雷，四根短天线，底下垂着三根缆线 */
EnemyArt.jelly = function (g, e, t) {
  const P = racePal(e), charge = e.charge || 0, w = Math.sin(t * 4 + (e.seed || 0));
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = P.dark; g.lineWidth = 2.4;
  for (let i = 0; i < 3; i++) { const x = -8 + i * 8; g.beginPath(); g.moveTo(x, 12); g.quadraticCurveTo(x + w * 3, 18, x - w * 2, 24 + (i % 2) * 3); g.stroke(); g.fillStyle = P.light; g.beginPath(); g.arc(x - w * 2, 24 + (i % 2) * 3, 2.2, 0, TAU); g.fill(); }
  for (const a of [-2.3, -0.85]) { g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(Math.cos(a) * 15, Math.sin(a) * 15); g.lineTo(Math.cos(a) * 23, Math.sin(a) * 23); g.stroke(); g.fillStyle = charge > 0 ? '#ff9fcf' : P.light; g.beginPath(); g.arc(Math.cos(a) * 24, Math.sin(a) * 24, 3, 0, TAU); g.fill(); g.stroke(); }
  g.fillStyle = hullFill(g, P, 0, 0, 17); g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 17, 0, TAU); g.fill(); g.stroke();
  rimLight(g, () => { g.beginPath(); g.arc(0, 0, 15, Math.PI * 1.15, Math.PI * 1.75); });
  g.strokeStyle = 'rgba(20,14,40,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-17, 4); g.lineTo(17, 4); g.stroke();
  if (charge > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, -2, 26, GLOW.pink, charge * 0.8); g.globalCompositeOperation = 'source-over'; }
  visor(g, -2, -4, 22, 9, { look: -1 });
  defenseMark(g, e, 24);
};
/* 碎屑虫（原梦尘蛾）：一只圆圆的废料小虫，两片铁皮翅膀扇得飞快 */
EnemyArt.moth = function (g, e, t) {
  const P = racePal(e), flap = Math.sin(t * 22 + (e.seed || 0));
  g.lineJoin = 'round';
  for (const s of [-1, 1]) {
    g.save(); g.scale(1, 0.6 + flap * 0.35 * s); g.fillStyle = 'rgba(200,205,225,0.8)'; g.strokeStyle = PAL.ink; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(-2, 0); g.lineTo(-14, s * -16); g.lineTo(6, s * -18); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(80,80,110,0.6)'; g.beginPath(); g.moveTo(-4, s * -6); g.lineTo(2, s * -15); g.stroke(); g.restore();
  }
  g.fillStyle = hullFill(g, P, 0, 0, 10); g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, 11, 9, 0, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = '#16122a'; g.beginPath(); g.arc(-4, -1, 5, 0, TAU); g.fill(); g.fillStyle = '#ffe38a'; g.beginPath(); g.arc(-5, -1, 2.6, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-6, -2.4, 1, 0, TAU); g.fill();
  g.strokeStyle = PAL.ink; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-8, -6); g.lineTo(-13, -12); g.moveTo(-5, -8); g.lineTo(-7, -14); g.stroke();
};
/* 投弹无人机（原纸船灯）：扁扁的机身，顶上一个转个不停的旋翼，肚子下面一个弹舱 */
EnemyArt.boat = function (g, e, t) {
  const P = racePal(e), rock = Math.sin(t * 3 + (e.seed || 0)) * 0.06;
  g.rotate(rock); g.lineJoin = 'round';
  const sp = Math.cos(t * 30); g.fillStyle = 'rgba(220,230,255,0.55)'; g.beginPath(); g.ellipse(2, -22, 18 * Math.abs(sp) + 3, 2.4, 0, 0, TAU); g.fill();
  g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(2, -20); g.lineTo(2, -10); g.stroke();
  g.fillStyle = hullFill(g, P, 0, 0, 12); g.strokeStyle = PAL.ink; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(-24, 0); g.quadraticCurveTo(-20, -12, 0, -12); g.quadraticCurveTo(20, -12, 22, -2); g.lineTo(18, 8); g.lineTo(-18, 8); g.closePath(); g.fill(); g.stroke();
  rimLight(g, () => { g.beginPath(); g.moveTo(-18, -6); g.quadraticCurveTo(-8, -11, 8, -10); });
  g.fillStyle = P.deep; g.fillRect(-8, 8, 14, 6); g.strokeRect(-8, 8, 14, 6);
  g.globalCompositeOperation = 'lighter'; drawGlow(g, -1, 14, 10, 'rgba(255,120,120,0.9)', 0.5 + 0.3 * Math.sin(t * 8)); g.globalCompositeOperation = 'source-over';
  visor(g, -9, -3, 16, 7, { look: -1, squint: e.charge > 0 ? 1 : 0.8 });
};
/* 环形炮塔（原小闹钟）：一圈炮口的圆炮塔，两条短腿；要开火时抖、炮口发白 */
EnemyArt.tick = function (g, e, t) {
  const P = racePal(e), shake = e.charge > 0 ? Math.sin(t * 60) * 2.2 * e.charge : 0;
  g.translate(shake, 0); g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.moveTo(-8, 15); g.lineTo(-11, 22); g.moveTo(8, 15); g.lineTo(11, 22); g.stroke();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + t * 0.4; g.save(); g.rotate(a); g.fillStyle = e.charge > 0.5 ? '#fff3c8' : P.dark; g.strokeStyle = PAL.ink; g.lineWidth = 1.4; g.fillRect(14, -3, 7, 6); g.strokeRect(14, -3, 7, 6); g.restore(); }
  g.fillStyle = hullFill(g, P, 0, 1, 16); g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 1, 16, 0, TAU); g.fill(); g.stroke();
  rimLight(g, () => { g.beginPath(); g.arc(0, 1, 14, Math.PI * 1.1, Math.PI * 1.8); });
  if (e.elite) { g.strokeStyle = '#ffcf4a'; g.lineWidth = 2; g.globalCompositeOperation = 'lighter'; g.beginPath(); g.moveTo(-11, -7); g.lineTo(-5, -1); g.lineTo(-8, 6); g.moveTo(9, -9); g.lineTo(4, 0); g.lineTo(10, 8); g.stroke(); g.globalCompositeOperation = 'source-over'; }
  visor(g, 0, 0, 20, 9, { squint: e.charge > 0 ? 0.6 : 1 });
  defenseMark(g, e, 26);
};
/* 突击艇（原星星鱼）：一架朝左的小战斗艇，座舱里两只眼睛，尾焰在右边 */
EnemyArt.star = function (g, e, t) {
  const P = racePal(e), fl = 0.7 + 0.3 * Math.sin(t * 30 + (e.seed || 0));
  g.lineJoin = 'round';
  g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,170,90,${0.8 * fl})`; g.beginPath(); g.moveTo(16, -5); g.lineTo(16 + 16 * fl, 0); g.lineTo(16, 5); g.closePath(); g.fill(); g.globalCompositeOperation = 'source-over';
  g.fillStyle = P.dark; g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(-2, -6); g.lineTo(10, -18); g.lineTo(14, -6); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-2, 6); g.lineTo(10, 18); g.lineTo(14, 6); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = hullFill(g, P, 0, 0, 10); g.lineWidth = 2.3; g.beginPath(); g.moveTo(-22, 0); g.quadraticCurveTo(-10, -11, 10, -9); g.lineTo(18, 0); g.lineTo(10, 9); g.quadraticCurveTo(-10, 11, -22, 0); g.closePath(); g.fill(); g.stroke();
  rimLight(g, () => { g.beginPath(); g.moveTo(-16, -4); g.quadraticCurveTo(-6, -9, 8, -8); });
  if (e.charge > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, -22, 0, 18, GLOW.gold, e.charge); g.globalCompositeOperation = 'source-over'; }
  if (e.elite) { visor(g, -4, -1, 18, 8, { angry: true, look: -1 }); g.fillStyle = '#ffd54a'; g.beginPath(); g.moveTo(4, -9); g.lineTo(8, -16); g.lineTo(11, -9); g.closePath(); g.fill(); }
  else visor(g, -4, -1, 16, 7, { look: -1 });
  defenseMark(g, e, 24);
};
/* 狙击眼（原灯塔眼）：插在上下边缘的三脚架，一枚大镜头；先画白线再射 */
EnemyArt.beacon = function (g, e, t) {
  const P = racePal(e), up = e.flip ? -1 : 1;
  g.scale(1, up); g.lineJoin = 'round';
  g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.moveTo(-12, 28); g.lineTo(-3, 4); g.moveTo(12, 28); g.lineTo(3, 4); g.moveTo(0, 28); g.lineTo(0, 4); g.stroke();
  g.fillStyle = hullFill(g, P, 0, -6, 12); g.lineWidth = 2.2; g.beginPath(); g.roundRect ? g.roundRect(-11, -18, 22, 22, 6) : g.rect(-11, -18, 22, 22); g.fill(); g.stroke();
  g.scale(1, up);
  const ey = -7 * up, la = e.aim || Math.PI;
  g.fillStyle = '#16122a'; g.beginPath(); g.arc(0, ey, 8, 0, TAU); g.fill(); g.strokeStyle = P.light; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = e.charge > 0.5 ? '#ff7a6b' : '#bff4ff'; g.beginPath(); g.arc(Math.cos(la) * 3, ey + Math.sin(la) * 2.5, 3.6, 0, TAU); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(Math.cos(la) * 3 - 1.2, ey + Math.sin(la) * 2.5 - 1.2, 1.1, 0, TAU); g.fill();
  if (e.charge > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, ey, 26, GLOW.white, e.charge * 0.7); g.globalCompositeOperation = 'source-over'; }
};
/* 精英：同一种无人机放大，加一圈族色的徽章和一顶“王冠”天线 */
EnemyArt.jellyE = (g, e, t) => {
  const P = racePal(e);
  for (let i = 0; i < 3; i++) { const a = t * 1.6 + (i * TAU) / 3, x = Math.cos(a) * 32, y = Math.sin(a) * 25; g.fillStyle = P.light; g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 5.5, 0, TAU); g.fill(); g.stroke(); }
  g.save(); g.scale(1.3, 1.3); EnemyArt.jelly(g, Object.assign({}, e, { def: null }), t);
  g.fillStyle = '#ffcf4a'; g.strokeStyle = PAL.ink; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-8, -18); g.lineTo(-5, -26); g.lineTo(-1, -19); g.lineTo(3, -27); g.lineTo(6, -18); g.closePath(); g.fill(); g.stroke();
  g.restore(); defenseMark(g, e, 40);
};
EnemyArt.tickE = (g, e, t) => { g.save(); g.scale(1.35, 1.35); EnemyArt.tick(g, Object.assign({}, e, { elite: true, def: null }), t); g.restore(); defenseMark(g, e, 38); };
EnemyArt.starE = (g, e, t) => { g.save(); g.scale(1.35, 1.35); EnemyArt.star(g, Object.assign({}, e, { elite: true, def: null }), t); g.restore(); defenseMark(g, e, 36); };
/* 厚甲拖船（原厚甲河豚）：圆滚滚的拖船，正面三块甲片，碎了露出发光的核心 */
EnemyArt.armor = (g, e, t) => {
  const P = racePal(e);
  g.scale(1.3, 1.3);
  const broken = e.broken, st = e.crack || 0, u = e.armorMax ? 1 - e.armorHp / e.armorMax : 1, near = !broken && (u * ARMOR.stages) % 1 > 0.8;
  g.lineJoin = 'round';
  g.fillStyle = P.dark; g.strokeStyle = PAL.ink; g.lineWidth = 2.2; g.beginPath(); g.moveTo(20, -8); g.lineTo(32, -12); g.lineTo(32, 12); g.lineTo(20, 8); g.closePath(); g.fill(); g.stroke();
  g.globalCompositeOperation = 'lighter'; drawGlow(g, 36, 0, 14, 'rgba(255,170,90,0.9)', 0.5 + 0.3 * Math.sin(t * 20)); g.globalCompositeOperation = 'source-over';
  g.fillStyle = broken ? '#ff9fcf' : hullFill(g, P, 0, 0, 24); g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.fill(); g.stroke();
  rimLight(g, () => { g.beginPath(); g.arc(0, 0, 22, Math.PI * 1.15, Math.PI * 1.75); });
  if (broken) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 22, GLOW.pink, 0.6 + 0.2 * Math.sin(t * 9)); g.globalCompositeOperation = 'source-over'; }
  if (!broken) for (let i = 0; i < 3; i++) {
    const y = (i - 1) * 15;
    g.save(); g.translate(-18, y); g.rotate((i - 1) * 0.35);
    const pg = g.createLinearGradient(-10, -8, 8, 8); pg.addColorStop(0, e.def === 'shield' ? '#d8f2ff' : '#e6e8f0'); pg.addColorStop(1, e.def === 'shield' ? '#6aa6d8' : '#7a7f92');
    g.fillStyle = pg; g.beginPath(); g.roundRect ? g.roundRect(-11, -8, 18, 16, 4) : g.rect(-11, -8, 18, 16); g.fill(); g.lineWidth = 2; g.strokeStyle = PAL.ink; g.stroke();
    g.fillStyle = '#4a4f62'; g.beginPath(); g.arc(-6, -3, 1.6, 0, TAU); g.arc(3, 3, 1.6, 0, TAU); g.fill();
    if (st > i || (st === i && u > 0.05)) { g.strokeStyle = near && st === i ? `rgba(255,243,200,${0.7 + Math.sin(t * 30) * 0.3})` : '#2a2c3a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-9, -6); g.lineTo(-2, 0); g.lineTo(-6, 6); if (st > i) { g.moveTo(-2, 0); g.lineTo(6, -5); g.moveTo(-2, 0); g.lineTo(5, 6); } g.stroke(); }
    g.restore();
  }
  visor(g, -2, -8, 20, 8, { look: -1, squint: broken ? 0.6 : 1 });
};
/* 带队精英：一架指挥无人机，头顶族色的旗；举旗时旗头水晶发亮（弱点） */
EnemyArt.cmdr = (g, e, t) => {
  const P = racePal(e), rally = e.rally > 0;
  g.save(); g.scale(1.6, 1.6); EnemyArt.jelly(g, Object.assign({}, e, { def: null }), t); g.restore();
  g.fillStyle = P.deep; g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(-24, -24); g.quadraticCurveTo(-2, -44, 20, -24); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ffd76a'; g.beginPath(); g.arc(-2, -31, 4, 0, TAU); g.fill();
  const a = rally ? -1.2 : -0.35 + Math.sin(t * 2) * 0.1;
  g.save(); g.translate(18, -6); g.rotate(a);
  g.strokeStyle = '#e8e6f4'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -46); g.stroke();
  g.fillStyle = P.c; g.beginPath(); g.moveTo(0, -44); g.lineTo(24, -38); g.lineTo(0, -30); g.closePath(); g.fill(); g.lineWidth = 1.6; g.strokeStyle = PAL.ink; g.stroke();
  if (rally) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, -50, 26, GLOW.gold, 0.9 + Math.sin(t * 20) * 0.1); g.globalCompositeOperation = 'source-over'; }
  g.fillStyle = rally ? '#fff6c8' : '#9fe3f0'; g.beginPath(); g.moveTo(0, -58); g.lineTo(6, -50); g.lineTo(0, -42); g.lineTo(-6, -50); g.closePath(); g.fill(); g.stroke();
  g.restore();
  if (!rally) { g.strokeStyle = 'rgba(200,230,255,0.7)'; g.lineWidth = 4; g.beginPath(); g.arc(4, 0, 44, Math.PI * 0.62, Math.PI * 1.38); g.stroke(); }
  defenseMark(g, e, 46);
};
/* 收账小偷（星砂商会，§9.3）：一只圆滚滚的紫色小飞贼，戴高礼帽和单片眼镜，背后拖一只越吸越鼓的钱袋，头上“$”一闪一闪 */
EnemyArt.thief = (g, e, t) => {
  const P = racePal(e), bob = Math.sin(t * 9) * 1.5, sack = 0.8 + 0.9 * (e.sack || 0), fled = !!e.fled;
  g.save(); g.scale(1.45, 1.45); // 比同屏的杂兵大一号：一眼认出来要追的是它
  g.lineJoin = 'round'; g.lineCap = 'round';
  // 钱袋（在身后，右边）：一根绳连着，袋口扎一圈金线
  const sx = 26 + sack * 8, sy = 6 + Math.sin(t * 5) * 3, sr = 13 * sack;
  g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(12, 2); g.quadraticCurveTo(20, 10, sx - sr * 0.6, sy - sr * 0.5); g.stroke();
  g.fillStyle = '#c99a5e'; g.beginPath(); g.ellipse(sx, sy, sr, sr * 0.92, 0.2, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = '#e8c27f'; g.beginPath(); g.ellipse(sx - sr * 0.3, sy - sr * 0.35, sr * 0.35, sr * 0.22, -0.4, 0, TAU); g.fill();
  g.fillStyle = '#ffd76a'; g.beginPath(); g.ellipse(sx - sr * 0.55, sy - sr * 0.7, sr * 0.3, sr * 0.16, -0.6, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = '#7a4e1e'; g.font = `bold ${Math.round(10 * sack + 4)}px "Baloo 2", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', sx + 1, sy + 2);
  // 身体：胖胖的圆，两只小翅膀扇得飞快
  g.save(); g.translate(0, bob);
  const flap = Math.sin(t * 26);
  for (const s of [-1, 1]) { g.fillStyle = P.light; g.strokeStyle = PAL.ink; g.lineWidth = 1.8; g.beginPath(); g.ellipse(4, s * 14, 9, 4 + flap * 2.5, s * 0.5, 0, TAU); g.fill(); g.stroke(); }
  g.fillStyle = hullFill(g, P, 0, 0, 17); g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 17, 0, TAU); g.fill(); g.stroke();
  rimLight(g, () => { g.beginPath(); g.arc(0, 0, 15, Math.PI * 1.15, Math.PI * 1.75); });
  visor(g, -3, -2, 22, 9, { look: -2, squint: fled ? 0.5 : 1 });
  g.strokeStyle = '#ffd76a'; g.lineWidth = 1.6; g.beginPath(); g.arc(-8, -2, 5.5, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(-8, 3.5); g.quadraticCurveTo(-10, 10, -6, 14); g.stroke(); // 单片眼镜
  // 高礼帽
  g.fillStyle = '#2a1d4a'; g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -15, 15, 4, -0.1, 0, TAU); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-9, -16); g.lineTo(-8, -33); g.lineTo(8, -34); g.lineTo(9, -17); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = P.c; g.fillRect(-8.5, -22, 17.5, 4);
  g.restore();
  // 头上“$”：一闪一闪（§9.3 预警）
  const on = Math.sin(t * 8) > -0.2;
  if (on) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, -50, 18, GLOW.gold, 0.7); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#ffe38a'; g.strokeStyle = PAL.ink; g.lineWidth = 3; g.font = 'bold 22px "Baloo 2", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeText('$', 0, -50 + bob); g.fillText('$', 0, -50 + bob); }
  g.restore();
};

/* 七族的小配件（§9.2）：形状不变，各族挂一样自己的东西——矿业的钻头、商会的金币、霜晶的冰刺、群翼的翅膀、电弧的天线、马戏的派对帽、熔核的铆钉甲 */
const RACE_ACC = {
  drill: (g, r, t, P) => { g.save(); g.translate(-r - 2, 2); g.fillStyle = '#9aa0b4'; g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath(); g.moveTo(4, -6); g.lineTo(-10, 0); g.lineTo(4, 6); g.closePath(); g.fill(); g.stroke(); g.strokeStyle = '#4c4a66'; g.lineWidth = 1.2; const k = (t * 12) % 4; for (let x = -6 + k; x < 4; x += 4) { g.beginPath(); g.moveTo(x, -4); g.lineTo(x + 2, 4); g.stroke(); } g.restore(); },
  ledger: (g, r, t, P) => { const x = r * 0.45, y = r * 0.5; g.fillStyle = '#ffd76a'; g.strokeStyle = PAL.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); g.stroke(); g.fillStyle = '#8a5a1a'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', x, y + 0.5); },
  frost: (g, r, t, P) => { g.fillStyle = 'rgba(230,250,255,0.95)'; g.strokeStyle = '#4a7ab0'; g.lineWidth = 1.3; for (const [dx, h] of [[-6, 9], [0, 13], [6, 9]]) { g.beginPath(); g.moveTo(dx - 3, -r + 3); g.lineTo(dx, -r - h + 3); g.lineTo(dx + 3, -r + 3); g.closePath(); g.fill(); g.stroke(); } },
  hive: (g, r, t, P) => { const f = Math.sin(t * 30) * 0.3; g.fillStyle = 'rgba(200,255,240,0.55)'; g.strokeStyle = 'rgba(40,120,100,0.8)'; g.lineWidth = 1.2; for (const s of [-1, 1]) { g.save(); g.translate(4, -r + 4); g.rotate(s * (0.5 + f)); g.beginPath(); g.ellipse(s * 4, -6, 5, 9, 0, 0, TAU); g.fill(); g.stroke(); g.restore(); } },
  arc: (g, r, t, P) => { g.strokeStyle = '#3a3f5a'; g.lineWidth = 2; g.beginPath(); g.moveTo(2, -r + 2); g.lineTo(5, -r - 9); g.stroke(); const on = Math.sin(t * 14) > 0; g.fillStyle = on ? '#e8fdff' : '#3ef0ff'; g.beginPath(); g.arc(5, -r - 11, 3, 0, TAU); g.fill(); if (on) { g.strokeStyle = 'rgba(62,240,255,0.9)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(5, -r - 11); g.lineTo(11, -r - 15); g.lineTo(8, -r - 18); g.stroke(); } },
  neon: (g, r, t, P) => { g.save(); g.translate(2, -r + 2); g.rotate(-0.25); g.fillStyle = '#ff6fe0'; g.strokeStyle = PAL.ink; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, -14); g.lineTo(6, 0); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#fff3fb'; g.fillRect(-4, -5, 8, 2); g.fillStyle = '#ffe38a'; g.beginPath(); g.arc(0, -15, 2.6, 0, TAU); g.fill(); g.restore(); },
  forge: (g, r, t, P) => { g.fillStyle = '#7a7f92'; g.strokeStyle = PAL.ink; g.lineWidth = 1.5; g.beginPath(); g.roundRect ? g.roundRect(-r - 3, -7, 8, 14, 3) : g.rect(-r - 3, -7, 8, 14); g.fill(); g.stroke(); g.fillStyle = '#ff9a40'; for (const y of [-3, 3]) { g.beginPath(); g.arc(-r + 1, y, 1.4, 0, TAU); g.fill(); } },
};
const RACE_ACC_TYPES = { jelly: 1, moth: 1, boat: 1, tick: 1, star: 1, beacon: 1, jellyE: 1.3, tickE: 1.35, starE: 1.35, armor: 1 };
function raceAccessory(g, e, t) {
  const f = RACE_ACC[e.race], k = RACE_ACC_TYPES[e.type]; if (!f || !k) return;
  g.save(); if (k !== 1) g.scale(k, k); f(g, (e.r || 20) / k * (k !== 1 ? 0.85 : 0.85), t, racePal(e)); g.restore();
}
