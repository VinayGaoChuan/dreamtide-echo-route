'use strict';
/* 梦潮：回声航线 v0.6 — 地图物件美术：梦灯屋、断桥灯环、星砂矿、被困伙伴、巨型梦境生物。
   全部 Canvas 程序绘制，沿用 Q 版深蓝紫描边 + 暖灯发光；远处剪影 → 靠近感应环 → 充能圈三层提示。 */

function glowAt(g, x, y, r, color, a) { g.globalCompositeOperation = 'lighter'; drawGlow(g, x, y, r, color, a); g.globalCompositeOperation = 'source-over'; }
function mapFont(px) { return `400 ${px}px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif`; }

/* 浮岛底座：顶面在 y=0，向下 h */
function floatRock(g, w, h, t, top = '#a393e6', body = '#6a5bb3') {
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (const [x, y, r] of [[-w * 0.46, h * 0.22, h * 0.24], [-w * 0.32, h * 0.42, h * 0.2], [w * 0.44, h * 0.28, h * 0.26], [w * 0.3, h * 0.46, h * 0.18]]) { g.beginPath(); g.arc(x + Math.sin(t * 0.8 + x) * 2, y, r, 0, TAU); g.fill(); }
  g.fillStyle = body; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(-w / 2, 0); g.quadraticCurveTo(-w * 0.44, h * 0.65, -w * 0.12, h); g.quadraticCurveTo(0, h * 1.12, w * 0.14, h * 0.96); g.quadraticCurveTo(w * 0.44, h * 0.62, w / 2, 0); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(45,35,88,0.35)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(-w * 0.2, h * 0.3); g.lineTo(-w * 0.08, h * 0.55); g.moveTo(w * 0.18, h * 0.25); g.lineTo(w * 0.1, h * 0.5); g.stroke();
  g.fillStyle = top; g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.ellipse(0, 0, w / 2, Math.max(6, h * 0.14), 0, 0, TAU); g.fill(); g.stroke();
  g.restore();
}

/* 感应环（第二层提示）与充能圈（第三层提示） */
function drawSenseRing(g, x, y, r, t, a, color) {
  if (a <= 0.01) return;
  g.save(); g.globalAlpha = a;
  g.strokeStyle = color; g.lineWidth = 2.5; g.setLineDash([10, 12]); g.lineDashOffset = -t * 40;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); g.setLineDash([]);
  g.restore();
}
function drawChargeRing(g, x, y, r, u, color, t) {
  if (u <= 0.001) return;
  g.save();
  g.strokeStyle = 'rgba(20,16,54,0.55)'; g.lineWidth = 11; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = color; g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(u, 0, 1)); g.stroke();
  const a = -Math.PI / 2 + TAU * clamp(u, 0, 1); drawGlow(g, x + Math.cos(a) * r, y + Math.sin(a) * r, 22 + Math.sin(t * 12) * 3, 'rgba(255,255,255,0.9)', 0.9);
  g.restore();
}
/* 飞机旁的小箭头：指向正在感应的物件 */
function drawPointer(g, px, py, tx, ty, color, t) {
  const a = Math.atan2(ty - py, tx - px), d = 46 + Math.sin(t * 6) * 4;
  g.save(); g.translate(px + Math.cos(a) * d, py + Math.sin(a) * d); g.rotate(a);
  g.fillStyle = color; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -8); g.lineTo(-2, 0); g.lineTo(-6, 8); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
/* 奖励小标签：图标 + 2~4 个字 */
function drawMapTag(g, x, y, icon, text, color, a = 1) {
  g.save(); g.globalAlpha = a; g.font = mapFont(18);
  const w = g.measureText(text).width + 44, h = 30;
  g.fillStyle = 'rgba(24,19,64,0.88)'; g.strokeStyle = color; g.lineWidth = 2;
  g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - h / 2, w, h, 15) : g.rect(x - w / 2, y - h / 2, w, h); g.fill(); g.stroke();
  drawIcon(g, icon, x - w / 2 + 17, y, 17, color);
  g.fillStyle = '#fff6ee'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, x - w / 2 + 31, y + 1);
  g.textBaseline = 'alphabetic'; g.restore();
}
/* 从物件飞回飞机的奖励 */
function drawRewardOrb(g, x, y, icon, color, t, s = 1) {
  glowAt(g, x, y, 38 * s, hexA(color, 0.9), 0.95);
  g.fillStyle = 'rgba(24,19,64,0.9)'; g.strokeStyle = '#ffffff'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(x, y, 17 * s, 0, TAU); g.fill(); g.stroke();
  drawIcon(g, icon, x, y, 20 * s, color, PAL.ink);
}

/* ================================================== 梦灯屋 ================================================== */
/* o: { lit 0..1 充能, done, open 0..1, turn -1..1（转向飞机）, bulbs 0..8, look } */
function drawLampHouse(g, x, y, o, t) {
  g.save(); g.translate(x, y + Math.sin(t * 1.3) * 5);
  const lit = o.done ? 1 : 0, warm = Math.max(o.lit || 0, lit);
  if (warm > 0) glowAt(g, 0, -20, 150 + warm * 50, 'rgba(255,207,74,0.55)', 0.35 + warm * 0.5);
  floatRock(g, 190, 74, t, '#a393e6', '#6a5bb3');
  g.rotate((o.turn || 0) * 0.07);
  // chimney
  g.fillStyle = '#b39cf0'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.fillRect(28, -104, 16, 30); g.strokeRect(28, -104, 16, 30);
  if (o.done) for (let i = 0; i < 3; i++) { const k = ((t * 0.6 + i / 3) % 1); g.fillStyle = `rgba(255,255,255,${0.6 * (1 - k)})`; g.beginPath(); g.arc(36 + k * 20, -110 - k * 40, 6 + k * 8, 0, TAU); g.fill(); }
  // body
  const bg = g.createLinearGradient(0, -44, 0, 40); bg.addColorStop(0, '#fff6e6'); bg.addColorStop(1, lit ? '#ffe3b0' : '#d9cdf0');
  g.fillStyle = bg; g.beginPath(); g.moveTo(-52, 0); g.lineTo(-52, -42); g.lineTo(52, -42); g.lineTo(52, 0); g.closePath(); g.fill();
  g.lineWidth = 2.8; g.stroke();
  // roof
  g.fillStyle = '#9d7ff0'; g.beginPath(); g.moveTo(-68, -36); g.quadraticCurveTo(-30, -84, 0, -112); g.quadraticCurveTo(30, -84, 68, -36); g.quadraticCurveTo(0, -46, -68, -36); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-40, -52); g.quadraticCurveTo(-18, -80, -2, -98); g.stroke();
  // roof lamp ring: bulbs light up one by one
  const n = 8, on = o.done ? n : Math.floor((o.lit || 0) * n + 0.001);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), bx = lerp(-60, 60, u), by = -38 - Math.sin(u * Math.PI) * 66;
    const lit2 = i < on;
    if (lit2) glowAt(g, bx, by, 16, GLOW.gold, 0.8);
    g.fillStyle = lit2 ? '#fff3b0' : '#5a4d96'; g.strokeStyle = PAL.ink; g.lineWidth = 1.5;
    g.beginPath(); g.arc(bx, by, 4.6, 0, TAU); g.fill(); g.stroke();
  }
  // windows = eyes
  for (const side of [-1, 1]) {
    const wx = side * 26, wy = -20;
    if (lit || warm > 0.6) glowAt(g, wx, wy, 30, GLOW.gold, 0.6 + warm * 0.3);
    g.fillStyle = lit ? '#ffe38a' : warm > 0.3 ? `rgba(255,227,138,${warm})` : '#3a3170'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
    g.beginPath(); g.arc(wx, wy, 13, 0, TAU); g.fill(); g.stroke();
    if (lit) {
      const lk = (o.look || 0) * 3;
      g.fillStyle = PAL.ink; g.beginPath(); g.ellipse(wx + lk, wy + 1, 4.5, 6, 0, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(wx + lk - 1.6, wy - 1.6, 1.8, 0, TAU); g.fill();
    } else {
      g.strokeStyle = warm > 0.3 ? PAL.ink : '#9d8fe0'; g.lineWidth = 2; g.beginPath(); g.moveTo(wx - 6, wy + 1); g.quadraticCurveTo(wx, wy + (warm > 0.3 ? -3 : 3), wx + 6, wy + 1); g.stroke();
    }
    g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(wx - 13, wy); g.lineTo(wx + 13, wy); g.moveTo(wx, wy - 13); g.lineTo(wx, wy + 13); g.globalAlpha = 0.25; g.stroke(); g.globalAlpha = 1;
  }
  if (lit) blush(g, 0, -6, 38, 5);
  // door = mouth
  const op = clamp(o.open || 0, 0, 1);
  g.fillStyle = op > 0 ? '#ffd76a' : '#6b52b8'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(-12, 0); g.lineTo(-12, -14); g.arc(0, -14, 12, Math.PI, 0); g.lineTo(12, 0); g.closePath(); g.fill(); g.stroke();
  if (op > 0) { glowAt(g, 0, -8, 40, GLOW.gold, op); g.fillStyle = '#8f6fd8'; g.beginPath(); g.moveTo(-12, 0); g.lineTo(-12, -14); g.lineTo(-12 + 24 * (1 - op) * 0.9, -12); g.lineTo(-12 + 24 * (1 - op) * 0.9, 0); g.closePath(); g.fill(); g.stroke(); }
  g.restore();
}
/* 转盘：五格奖励，指针在上方 */
function drawHouseWheel(g, x, y, r, rot, t, alpha, picked) {
  g.save(); g.globalAlpha = alpha; g.translate(x, y);
  glowAt(g, 0, 0, r * 1.7, 'rgba(255,215,106,0.8)', 0.6);
  const n = HOUSE_WHEEL.length;
  for (let i = 0; i < n; i++) {
    const R = HOUSE_REWARDS[HOUSE_WHEEL[i]], a0 = rot + (i / n) * TAU - Math.PI / 2 - Math.PI / n, a1 = a0 + TAU / n;
    g.fillStyle = picked === R.id ? '#fff6c8' : i % 2 ? '#3a2f82' : '#4b3d9c';
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, a0, a1); g.closePath(); g.fill();
    g.strokeStyle = PAL.ink; g.lineWidth = 2; g.stroke();
    const am = (a0 + a1) / 2; drawIcon(g, R.icon, Math.cos(am) * r * 0.62, Math.sin(am) * r * 0.62, r * 0.42, R.color);
  }
  g.strokeStyle = '#ffd76a'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
  g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#ff7eb6'; g.beginPath(); g.moveTo(0, -r + 12); g.lineTo(-10, -r - 10); g.lineTo(10, -r - 10); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

/* ================================================== 断桥 ================================================== */
function drawPier(g, x, y, side, t, lit) {
  g.save(); g.translate(x, y);
  floatRock(g, 110, 56, t, '#a393e6', '#6a5bb3');
  // plank stub toward the gap
  g.fillStyle = '#ffe6b0'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  for (let i = 0; i < 3; i++) { const px = side * (30 + i * 22); g.save(); g.translate(px, -6 - i * 2); g.rotate(side * 0.1); g.fillRect(-9, -5, 18, 10); g.strokeRect(-9, -5, 18, 10); g.restore(); }
  // lamp post with a sleepy face
  g.fillStyle = '#8f7fd8'; g.fillRect(-7, -86, 14, 80); g.strokeRect(-7, -86, 14, 80);
  if (lit) glowAt(g, 0, -100, 50, GLOW.gold, 0.9);
  g.fillStyle = lit ? '#fff3b0' : '#6b5fb0'; g.beginPath(); g.moveTo(-14, -90); g.lineTo(14, -90); g.lineTo(10, -114); g.lineTo(-10, -114); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#9d7ff0'; g.beginPath(); g.moveTo(-18, -112); g.lineTo(0, -128); g.lineTo(18, -112); g.closePath(); g.fill(); g.stroke();
  eyePair(g, 0, -101, 4.5, 2, 2.4, lit ? { closed: 'happy', lw: 1.5 } : { closed: true, lw: 1.5 });
  g.restore();
}
function drawLampRing(g, x, y, r, t, lit, near) {
  g.save(); g.translate(x, y);
  if (lit) glowAt(g, 0, 0, r * 2.2, GLOW.gold, 0.8);
  else if (near > 0) glowAt(g, 0, 0, r * 1.8, 'rgba(159,227,240,0.7)', near * 0.6);
  g.strokeStyle = PAL.ink; g.lineWidth = 11; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
  g.strokeStyle = lit ? '#ffd76a' : '#7d70c8'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + t * (lit ? 1.4 : 0.4);
    g.fillStyle = lit ? '#fff6c8' : '#5a4d96'; g.strokeStyle = PAL.ink; g.lineWidth = 1.4;
    g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 4.5, 0, TAU); g.fill(); g.stroke();
  }
  if (!lit) { g.strokeStyle = `rgba(159,227,240,${0.35 + 0.3 * Math.sin(t * 5)})`; g.lineWidth = 2; g.setLineDash([6, 8]); g.beginPath(); g.arc(0, 0, r - 12, 0, TAU); g.stroke(); g.setLineDash([]); }
  g.restore();
}
/* 桥面：沿 pts 平滑曲线，从左到右按 u 逐块出现 */
function bridgeCurve(pts, u) {
  // Catmull-Rom through points, u in 0..1 over whole path
  const n = pts.length - 1, f = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (-a + 3 * b - 3 * c + d) * k * k * k);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) };
}
function drawBridgeDeck(g, pts, built, t) {
  if (built <= 0) return;
  const N = 44;
  g.save();
  g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(159,227,240,0.5)'; g.lineWidth = 16; g.lineCap = 'round';
  g.beginPath(); for (let i = 0; i <= N * built; i++) { const q = bridgeCurve(pts, i / N); if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y); } g.stroke();
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < N * built; i++) {
    const a = bridgeCurve(pts, i / N), b = bridgeCurve(pts, (i + 1) / N), ang = Math.atan2(b.y - a.y, b.x - a.x);
    g.save(); g.translate(a.x, a.y); g.rotate(ang);
    g.fillStyle = i % 2 ? '#ffe6b0' : '#fff1cc'; g.strokeStyle = PAL.ink; g.lineWidth = 1.6;
    g.fillRect(0, -9, Math.hypot(b.x - a.x, b.y - a.y) + 1, 18); g.strokeRect(0, -9, Math.hypot(b.x - a.x, b.y - a.y) + 1, 18);
    g.restore();
    if (i % 6 === 0) { glowAt(g, a.x, a.y - 16, 16, GLOW.gold, 0.7); g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(a.x, a.y - 16, 3.5, 0, TAU); g.fill(); }
  }
  g.restore();
}

/* ================================================== 星砂矿 ================================================== */
function drawMine(g, x, y, o, t) {
  g.save(); g.translate(x, y + Math.sin(t * 1.1 + 1) * 6);
  const r = o.r || 64, ch = o.charge || 0;
  glowAt(g, 0, 0, r * 2.2, 'rgba(201,168,255,0.8)', 0.35 + ch * 0.5);
  if (o.shake) g.translate(rand(-2, 2) * ch, rand(-2, 2) * ch);
  // crystal spikes behind
  const spikes = [[-0.5, '#6ff0ff'], [0.9, '#ff9fcf'], [2.3, '#ffe38a'], [3.6, '#9ff2c8']];
  for (const [a, c] of spikes) {
    g.save(); g.rotate(a); g.fillStyle = c; g.strokeStyle = PAL.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(r * 0.7, -10); g.lineTo(r * 1.28, 0); g.lineTo(r * 0.7, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  // lumpy rock
  const seed = o.seed || 1, n = 11;
  const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, 4, 0, 0, r * 1.1); gr.addColorStop(0, '#b3a6ef'); gr.addColorStop(1, '#5b4ea8');
  g.fillStyle = gr; g.strokeStyle = PAL.ink; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, rr = r * (0.88 + 0.14 * Math.sin(seed * 7 + i * 2.3)); const px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
  g.closePath(); g.fill(); g.stroke();
  // speckles
  g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 7; i++) { const a = seed + i * 1.7, rr = r * (0.2 + (i % 3) * 0.2); g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 2 + (i % 2), 0, TAU); g.fill(); }
  // cracks grow along the plane's light
  if (ch > 0) {
    const ca = o.crackA || 0, L = r * (0.3 + ch * 0.9);
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const [off, k] of [[0, 1], [0.55, 0.7], [-0.6, 0.65], [2.8, 0.4 * ch]]) {
      const a = ca + off; g.strokeStyle = `rgba(255,227,138,${0.5 + ch * 0.5})`; g.lineWidth = 3 + ch * 3;
      g.beginPath(); g.moveTo(0, 0);
      let px = 0, py = 0; for (let s = 1; s <= 4; s++) { const aa = a + (s % 2 ? 0.25 : -0.25); px += Math.cos(aa) * L * k / 4; py += Math.sin(aa) * L * k / 4; g.lineTo(px, py); }
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
  // sleepy face → straining face
  eyePair(g, -2, -4, 14, 5, 5, ch > 0.45 ? { closed: 'happy', lw: 2.2 } : { closed: true, lw: 2.2 });
  blush(g, -2, 6, 22, 5);
  g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); if (ch > 0.45) g.ellipse(-2, 13, 4, 3, 0, 0, TAU); else g.arc(-2, 10, 3, 0.2, Math.PI - 0.2); g.stroke();
  g.restore();
}

/* ================================================== 伙伴 NPC ================================================== */
/* mood: sleep | idle | happy | wave | scared；朝右 */
function npcFace(g, x, y, s, mood, t) {
  if (mood === 'sleep') eyePair(g, x, y, 5 * s, 2.6 * s, 3 * s, { closed: true, lw: 1.5 });
  else if (mood === 'happy' || mood === 'wave') eyePair(g, x, y, 5 * s, 2.8 * s, 3 * s, { closed: 'happy', lw: 1.6 });
  else if (mood === 'scared') eyePair(g, x, y, 5 * s, 2.6 * s, 3 * s, { x: true, lw: 1.5 });
  else eyePair(g, x, y, 5 * s, 2.5 * s, 3.2 * s, { look: 0.6 * s });
  blush(g, x, y + 4.5 * s, 8 * s, 2 * s);
  g.strokeStyle = PAL.ink; g.lineWidth = 1.3; g.beginPath();
  if (mood === 'scared') g.arc(x, y + 5 * s, 1.6 * s, Math.PI + 0.3, -0.3); else if (mood === 'sleep') g.arc(x, y + 4 * s, 1.2 * s, 0, TAU); else g.arc(x, y + 3.2 * s, 2 * s, 0.2, Math.PI - 0.2);
  g.stroke();
}
function drawNPC(g, id, x, y, s, t, mood = 'idle') {
  g.save(); g.translate(x, y); g.scale(s, s);
  const bob = Math.sin(t * 3) * 1.5;
  g.translate(0, bob);
  g.strokeStyle = PAL.ink; g.lineWidth = 2; g.lineJoin = 'round';
  switch (id) {
    case 'bunny': {
      for (const k of [-1, 1]) { g.save(); g.translate(k * 6, -12); g.rotate(k * 0.25 + (mood === 'sleep' ? k * 0.5 : Math.sin(t * 4 + k) * 0.08)); g.fillStyle = '#f3ecff'; g.beginPath(); g.ellipse(0, -10, 4.5, 11, 0, 0, TAU); g.fill(); g.stroke(); g.fillStyle = '#ffb3c8'; g.beginPath(); g.ellipse(0, -10, 2, 7, 0, 0, TAU); g.fill(); g.restore(); }
      g.fillStyle = '#f3ecff'; g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#ff9fcf'; g.beginPath(); g.moveTo(-12, 9); g.quadraticCurveTo(0, 15, 12, 9); g.lineTo(13, 13); g.quadraticCurveTo(0, 19, -13, 13); g.closePath(); g.fill(); g.stroke();
      npcFace(g, 2, -1, 1, mood, t);
      break;
    }
    case 'grandpa': {
      g.fillStyle = '#ffffff';
      const puffs = [[-9, 2, 10], [0, -5, 12], [10, 1, 10], [2, 7, 10]];
      g.beginPath(); for (const [px, py, r] of puffs) { g.moveTo(px + r, py); g.arc(px, py, r, 0, TAU); } g.fill();
      for (const [px, py, r] of puffs) { g.beginPath(); g.arc(px, py, r, 0, TAU); g.stroke(); }
      g.fillStyle = '#ffffff'; for (const [px, py, r] of puffs) { g.beginPath(); g.arc(px, py, r - 1.6, 0, TAU); g.fill(); }
      npcFace(g, 2, -3, 1, mood, t);
      g.strokeStyle = PAL.ink; g.lineWidth = 1.4; g.beginPath(); g.arc(-3, -3, 4.2, 0, TAU); g.moveTo(11.2, -3); g.arc(7, -3, 4.2, 0, TAU); g.moveTo(1.2, -3); g.lineTo(2.8, -3); g.stroke();
      g.fillStyle = '#eef6ff'; g.beginPath(); g.moveTo(2, 3); g.quadraticCurveTo(-8, 4, -10, 10); g.quadraticCurveTo(-3, 8, 2, 5); g.quadraticCurveTo(7, 8, 14, 10); g.quadraticCurveTo(12, 4, 2, 3); g.fill(); g.stroke();
      break;
    }
    case 'miner': {
      g.fillStyle = '#ffe38a'; BulletArt.star(g, 0, 2, 5, 16, 8.5); g.fill(); g.stroke();
      g.fillStyle = '#ff9a6b'; g.beginPath(); g.arc(0, -8, 10, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
      g.fillRect(-12, -9, 24, 3); g.strokeRect(-12, -9, 24, 3);
      glowAt(g, 0, -14, 12, GLOW.gold, 0.8); g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(0, -13, 3, 0, TAU); g.fill(); g.stroke();
      g.save(); g.translate(13, 8); g.rotate(mood === 'wave' ? Math.sin(t * 10) * 0.5 : 0.3); g.strokeStyle = '#8a5a3c'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, 0); g.lineTo(7, -9); g.stroke(); g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(2, -12); g.quadraticCurveTo(8, -12, 12, -6); g.stroke(); g.restore();
      npcFace(g, 0, 2, 0.9, mood, t);
      break;
    }
    case 'merchant': {
      g.fillStyle = '#ff9fcf';
      for (const k of [-1, 1]) { g.beginPath(); g.moveTo(k * 13, 0); g.lineTo(k * 22, -7); g.lineTo(k * 22, 7); g.closePath(); g.fill(); g.stroke(); }
      g.beginPath(); g.arc(0, 0, 14, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 9, 0.4, 2.6); g.stroke(); g.strokeStyle = PAL.ink;
      g.fillStyle = '#4b3d9c'; g.lineWidth = 2; g.fillRect(-8, -24, 16, 12); g.strokeRect(-8, -24, 16, 12); g.fillRect(-12, -13, 24, 3); g.strokeRect(-12, -13, 24, 3);
      g.fillStyle = '#ffe38a'; g.fillRect(-8, -16, 16, 3);
      npcFace(g, 1, 1, 0.95, mood, t);
      break;
    }
    case 'clockling': {
      for (const k of [-1, 1]) { g.fillStyle = '#ffd76a'; g.beginPath(); g.arc(k * 9, -13, 5.5, Math.PI, 0); g.closePath(); g.fill(); g.stroke(); }
      g.fillStyle = '#ffd76a'; g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#fff6ee'; g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(t * 2) * 7, Math.sin(t * 2) * 7); g.stroke();
      for (const k of [-1, 1]) { g.beginPath(); g.moveTo(k * 6, 13); g.lineTo(k * 8, 18); g.stroke(); }
      npcFace(g, 0, 1, 0.8, mood, t);
      break;
    }
  }
  if (mood === 'wave') { g.strokeStyle = PAL.ink; g.lineWidth = 2; g.fillStyle = '#fff6ee'; g.save(); g.translate(14, -4); g.rotate(-0.8 + Math.sin(t * 12) * 0.5); g.beginPath(); g.ellipse(0, -5, 3, 6, 0, 0, TAU); g.fill(); g.stroke(); g.restore(); }
  if (mood === 'sleep') { g.fillStyle = '#dcefff'; g.font = mapFont(12); const k = (t * 0.7) % 1; g.globalAlpha = 1 - k; g.fillText('z', 12 + k * 8, -16 - k * 14); g.globalAlpha = 1; }
  g.restore();
}
/* 困住伙伴的东西：泡泡 / 藤蔓 / 齿轮，break 0..1 是绕行进度 */
function drawTrap(g, kind, x, y, r, t, prog) {
  g.save(); g.translate(x, y);
  if (kind === 'bubble') {
    const wob = 1 + Math.sin(t * 3) * 0.03 + prog * 0.08 * Math.sin(t * 20);
    g.fillStyle = 'rgba(159,227,240,0.16)'; g.strokeStyle = 'rgba(220,250,255,0.85)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(0, 0, r * wob, r / wob, 0, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, r * 0.72, -2.4, -1.6); g.stroke();
    g.strokeStyle = 'rgba(255,159,207,0.5)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r * 0.86, 0.3, 1.1); g.stroke();
  } else if (kind === 'vine') {
    g.strokeStyle = '#6fcf97'; g.lineWidth = 4; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let i = 0; i <= 30; i++) { const a = (i / 30) * TAU + k * 2.1, rr = r * (0.75 + 0.12 * Math.sin(i * 0.9 + k + t * (1 - prog))); const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.9; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
      g.globalAlpha = 1 - prog * 0.6; g.stroke();
    }
    g.fillStyle = '#9ff2c8'; g.strokeStyle = PAL.ink; g.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3, rr = r * 0.8; g.save(); g.translate(Math.cos(a) * rr, Math.sin(a) * rr * 0.9); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 7, 3.5, 0, 0, TAU); g.fill(); g.stroke(); g.restore(); }
    g.globalAlpha = 1;
  } else {
    gear(g, -r * 0.55, -r * 0.45, r * 0.5, 9, t * (0.6 - prog), '#c9a8ff');
    gear(g, r * 0.55, r * 0.45, r * 0.45, 8, -t * (0.7 - prog), '#ffd76a');
    gear(g, r * 0.5, -r * 0.6, r * 0.3, 7, t, '#9fe3f0');
  }
  g.restore();
}
function drawOrbitGuide(g, x, y, r, t, prog, color) {
  g.save(); g.translate(x, y);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.setLineDash([4, 10]); g.lineDashOffset = -t * 50;
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); g.setLineDash([]);
  // travelling arrow shows which way round
  const a = t * 1.8; g.save(); g.rotate(a); g.translate(r, 0); g.rotate(Math.PI / 2);
  g.fillStyle = color; g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -9); g.lineTo(8, 5); g.lineTo(-8, 5); g.closePath(); g.fill(); g.stroke(); g.restore();
  if (prog > 0) { g.globalCompositeOperation = 'lighter'; g.strokeStyle = color; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(prog, 0, 1)); g.stroke(); }
  g.restore();
}

/* ================================================== 巨型梦境生物 ================================================== */
/* o: { kind, eye 0..1 睁眼, act 0..1 动作, mouth 0..1 } —— 全部面朝左（迎着飞机游过来） */
const GIANT_EYE = { whale: [-150, -26], turtle: [-196, -34], deer: [-128, -118], moonbunny: [-46, -30] };
function drawGiant(g, x, y, s, o, t) {
  g.save(); g.translate(x, y); g.scale(s, s);
  const eye = clamp(o.eye || 0, 0, 1), act = o.act || 0;
  g.strokeStyle = PAL.ink; g.lineJoin = 'round'; g.lineWidth = 3.5;
  const eyeAt = GIANT_EYE[o.kind];
  const drawEye = (ex, ey, r) => {
    if (eye < 0.15) { g.strokeStyle = PAL.ink; g.lineWidth = 3.5; g.beginPath(); g.arc(ex, ey - 2, r * 0.8, 0.3, Math.PI - 0.3); g.stroke(); return; }
    glowAt(g, ex, ey, r * 3, 'rgba(111,240,255,0.8)', eye * 0.7);
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(ex, ey, r, r * eye, 0, 0, TAU); g.fill(); g.lineWidth = 3; g.stroke();
    g.save(); g.beginPath(); g.ellipse(ex, ey, r, r * eye, 0, 0, TAU); g.clip();
    g.fillStyle = PAL.ink; g.beginPath(); g.arc(ex - r * 0.2, ey, r * 0.62, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex - r * 0.38, ey - r * 0.25, r * 0.24, 0, TAU); g.fill(); g.beginPath(); g.arc(ex, ey + r * 0.2, r * 0.1, 0, TAU); g.fill();
    g.restore();
  };
  switch (o.kind) {
    case 'whale': {
      glowAt(g, -40, 0, 300, 'rgba(111,140,255,0.6)', 0.35 + eye * 0.3);
      // tail
      g.fillStyle = '#3d4fb8'; g.beginPath(); g.moveTo(170, -6); g.quadraticCurveTo(230, -20 + Math.sin(t * 1.6) * 10, 270, -70 + Math.sin(t * 1.6) * 14); g.quadraticCurveTo(250, -10, 280, 40 + Math.sin(t * 1.6) * 10); g.quadraticCurveTo(230, 20, 170, 16); g.closePath(); g.fill(); g.stroke();
      // body
      const gr = g.createLinearGradient(0, -100, 0, 100); gr.addColorStop(0, '#5b6ee0'); gr.addColorStop(1, '#2e3a96');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 220, 96, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#9fb0ff'; g.beginPath(); g.ellipse(-30, 50, 170, 38, 0, 0, Math.PI); g.fill();
      g.strokeStyle = 'rgba(45,35,88,0.4)'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-150 + i * 40, 58); g.lineTo(-140 + i * 40, 86); g.stroke(); }
      g.strokeStyle = PAL.ink; g.lineWidth = 3.5;
      g.fillStyle = '#3d4fb8'; g.beginPath(); g.ellipse(-20, 60, 50, 18, 0.5 + Math.sin(t * 2) * 0.1, 0, TAU); g.fill(); g.stroke();
      // stars on the back
      g.fillStyle = '#ffe38a'; for (const [sx, sy, sr] of [[-60, -60, 7], [0, -72, 5], [60, -58, 8], [110, -40, 5], [-110, -40, 5]]) { BulletArt.star(g, sx, sy, 5, sr, sr * 0.45); g.fill(); }
      // mouth
      const m = o.mouth || 0;
      if (m > 0.05) { g.fillStyle = '#1b1550'; g.beginPath(); g.ellipse(-200, 24, 26 * m + 6, 30 * m, 0, 0, TAU); g.fill(); g.stroke(); glowAt(g, -200, 24, 60 * m, 'rgba(200,250,255,0.9)', m * 0.6); }
      else { g.lineWidth = 3; g.beginPath(); g.moveTo(-214, 22); g.quadraticCurveTo(-190, 32, -160, 24); g.stroke(); }
      blush(g, -150, 4, 10, 9);
      drawEye(eyeAt[0], eyeAt[1], 18);
      break;
    }
    case 'turtle': {
      const lift = act * 26;
      glowAt(g, 0, -20, 260, 'rgba(220,240,255,0.7)', 0.3 + eye * 0.3);
      // flippers
      g.fillStyle = '#8fdcb0'; for (const [fx, fy, a] of [[-110, 40, -0.5], [100, 44, 0.5], [-60, 58, -0.2], [60, 60, 0.2]]) { g.save(); g.translate(fx, fy); g.rotate(a + Math.sin(t * 2 + fx) * 0.2); g.beginPath(); g.ellipse(0, 12, 18, 34, 0, 0, TAU); g.fill(); g.stroke(); g.restore(); }
      // head
      g.fillStyle = '#9ff2c8'; g.beginPath(); g.ellipse(-190, -20, 44, 36, 0, 0, TAU); g.fill(); g.stroke();
      blush(g, -196, -6, 14, 6);
      g.lineWidth = 2.5; g.beginPath(); g.arc(-210, -8, 6, 0.2, Math.PI - 0.2); g.stroke(); g.lineWidth = 3.5;
      drawEye(eyeAt[0], eyeAt[1], 11);
      // belly plate
      g.fillStyle = '#ffe6b0'; g.beginPath(); g.ellipse(0, 30, 150, 34, 0, 0, TAU); g.fill(); g.stroke();
      // cloud shell (lifts open)
      g.save(); g.translate(0, -lift);
      if (act > 0) glowAt(g, 0, 10, 220, GLOW.gold, act * 0.8);
      g.fillStyle = '#eaf6ff'; g.beginPath(); g.moveTo(-160, 24); g.quadraticCurveTo(-150, -120, 0, -126); g.quadraticCurveTo(150, -120, 160, 24); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ffffff'; for (const [px, py, r] of [[-90, -30, 30], [-20, -70, 34], [60, -40, 32], [100, 4, 22], [-120, 6, 20], [10, -10, 26]]) { g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(45,35,88,0.35)'; g.stroke(); }
      g.restore();
      break;
    }
    case 'deer': {
      glowAt(g, 0, -40, 260, 'rgba(255,159,207,0.6)', 0.3 + eye * 0.3);
      for (const [lx, a] of [[-70, 0.1], [-40, -0.1], [60, 0.12], [90, -0.08]]) { g.save(); g.translate(lx, 30); g.rotate(a + Math.sin(t * 1.5 + lx) * 0.1); g.fillStyle = '#d9c2ff'; g.fillRect(-7, 0, 14, 70); g.strokeRect(-7, 0, 14, 70); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 76, 14, 0, TAU); g.fill(); g.restore(); }
      g.fillStyle = '#e8d8ff'; g.beginPath(); g.ellipse(10, 10, 130, 56, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#ffffff'; for (const [px, py] of [[-30, -10], [20, 0], [60, -20], [-10, 24]]) { g.beginPath(); g.arc(px, py, 7, 0, TAU); g.fill(); }
      // neck + head
      g.fillStyle = '#e8d8ff'; g.beginPath(); g.moveTo(-80, -20); g.quadraticCurveTo(-110, -70, -112, -110); g.lineTo(-80, -110); g.quadraticCurveTo(-70, -60, -40, -30); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(-120, -112, 40, 30, -0.2, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#ffb3c8'; g.beginPath(); g.ellipse(-156, -104, 9, 7, 0, 0, TAU); g.fill(); g.stroke();
      blush(g, -128, -98, 12, 6);
      drawEye(eyeAt[0], eyeAt[1], 10);
      // flower antlers
      g.strokeStyle = '#8a6a4c'; g.lineWidth = 5; g.lineCap = 'round';
      for (const k of [0, 1]) { g.beginPath(); g.moveTo(-112 + k * 20, -136); g.quadraticCurveTo(-120 + k * 40, -190, -150 + k * 70, -200); g.moveTo(-116 + k * 30, -170); g.lineTo(-96 + k * 30, -186); g.stroke(); }
      g.lineWidth = 2; g.strokeStyle = PAL.ink;
      for (const [fx, fy, c] of [[-150, -202, '#ff9fcf'], [-80, -206, '#ffe38a'], [-96, -188, '#9fe3f0'], [-66, -186, '#ff9fcf'], [-126, -178, '#c9a8ff']]) { g.fillStyle = c; for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + t; g.beginPath(); g.arc(fx + Math.cos(a) * 5, fy + Math.sin(a) * 5, 4.5, 0, TAU); g.fill(); } g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(fx, fy, 3, 0, TAU); g.fill(); }
      break;
    }
    case 'moonbunny': {
      glowAt(g, 0, 0, 280, GLOW.gold, 0.4 + eye * 0.4);
      for (const k of [-1, 1]) { g.save(); g.translate(k * 34 - 10, -110); g.rotate(k * 0.25 + Math.sin(t * 1.4 + k) * 0.06); g.fillStyle = '#fff6ee'; g.beginPath(); g.ellipse(0, -50, 20, 58, 0, 0, TAU); g.fill(); g.stroke(); g.fillStyle = '#ffb3c8'; g.beginPath(); g.ellipse(0, -50, 9, 40, 0, 0, TAU); g.fill(); g.restore(); }
      const gr = g.createRadialGradient(-30, -30, 10, 0, 0, 130); gr.addColorStop(0, '#fff6c8'); gr.addColorStop(1, '#ffd76a');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 124, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = 'rgba(217,150,44,0.25)'; for (const [cx2, cy2, r] of [[50, -50, 18], [70, 30, 12], [30, 70, 16], [-70, 60, 10]]) { g.beginPath(); g.arc(cx2, cy2, r, 0, TAU); g.fill(); }
      blush(g, -20, 0, 42, 10);
      drawEye(eyeAt[0], eyeAt[1], 13);
      drawEye(eyeAt[0] + 52, eyeAt[1], 13);
      g.strokeStyle = PAL.ink; g.lineWidth = 3; g.beginPath(); g.arc(-20, 16, 7, 0.2, Math.PI - 0.2); g.stroke();
      break;
    }
  }
  g.restore();
}

/* 图鉴 / HUD 用的小图 */
function paintNPC(cv, id, mood = 'happy') {
  const g = cv.getContext('2d'), s = cv.width / 56;
  g.clearRect(0, 0, cv.width, cv.height);
  glowAt(g, cv.width / 2, cv.height / 2, cv.width * 0.5, hexA(NPCS[id].color, 0.7), 0.5);
  drawNPC(g, id, cv.width / 2, cv.height * 0.56, s * 1.2, 1.2, mood);
}
function paintMapIcon(cv, kind, sub) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.save();
  switch (kind) {
    case 'house': g.translate(W / 2, H * 0.62); g.scale(W / 260, W / 260); drawLampHouse(g, 0, 0, { done: true, open: 1, look: 0.3 }, 1); break;
    case 'bridge': {
      g.scale(W / 320, W / 320);
      const pts = [{ x: 30, y: 200 }, { x: 110, y: 140 }, { x: 210, y: 170 }, { x: 290, y: 130 }];
      drawBridgeDeck(g, pts, 1, 1);
      drawLampRing(g, 110, 140, 26, 1, true, 0); drawLampRing(g, 210, 170, 26, 1, true, 0);
      break;
    }
    case 'mine': g.translate(W / 2, H / 2); g.scale(W / 200, W / 200); drawMine(g, 0, 0, { r: 56, charge: 0.7, crackA: -2.6, seed: 3 }, 1); break;
    case 'npc': drawTrap(g, NPCS[sub || 'bunny'].trap, W / 2, H / 2, W * 0.36, 1, 0); drawNPC(g, sub || 'bunny', W / 2, H / 2, W / 70, 1, 'sleep'); break;
    case 'giant': { const k = sub || 'whale', sc = { whale: 0.24, turtle: 0.25, deer: 0.26, moonbunny: 0.3 }[k] * (W / 120); g.translate(W / 2 + (k === 'deer' ? 14 : 0), H / 2 + (k === 'deer' ? 22 : k === 'moonbunny' ? 14 : 0)); drawGiant(g, 0, 0, sc, { kind: k, eye: 1 }, 1); break; }
  }
  g.restore();
}
