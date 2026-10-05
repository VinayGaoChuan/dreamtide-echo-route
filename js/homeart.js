'use strict';
/* 梦潮：回声航线 v0.10 — 家园画面：Q 版浮空港。全部 Canvas 程序化绘制（和其他美术一致，不用图片）。
   画面只读存档里的家园状态，坐标和网页上的按钮共用 Home.layout(W)。 */

/* ---------- 建筑 ---------- */
function drawHangar(g, x, y, t) {
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(10,8,30,0.35)'; g.beginPath(); g.ellipse(0, 4, 96, 14, 0, 0, TAU); g.fill();
  g.fillStyle = '#5b4fa0'; g.strokeStyle = PAL.ink; g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(-88, 0); g.lineTo(-88, -70); g.quadraticCurveTo(0, -150, 88, -70); g.lineTo(88, 0); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#2a2160'; g.beginPath(); g.moveTo(-56, 0); g.lineTo(-56, -58); g.quadraticCurveTo(0, -112, 56, -58); g.lineTo(56, 0); g.closePath(); g.fill(); g.stroke();
  glowAt(g, 0, -30, 70, 'rgba(255,215,106,0.6)', 0.35 + Math.sin(t * 2) * 0.08);
  for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(255,227,138,${0.5 + 0.4 * Math.sin(t * 3 + i)})`; g.beginPath(); g.arc(-48 + i * 24, -6, 3, 0, TAU); g.fill(); }
  g.strokeStyle = '#8f82d6'; g.lineWidth = 3; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 30, -78 - (2 - Math.abs(i)) * 14); g.lineTo(i * 34, -2); g.stroke(); }
  g.restore();
}
function drawRescueDesk(g, x, y, t, lit) {
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(10,8,30,0.35)'; g.beginPath(); g.ellipse(0, 4, 54, 10, 0, 0, TAU); g.fill();
  g.fillStyle = '#f3ecff'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(-26, 0); g.lineTo(-18, -86); g.lineTo(18, -86); g.lineTo(26, 0); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ff9fcf'; g.fillRect(-22, -40, 44, 10); g.strokeRect(-22, -40, 44, 10);
  g.fillStyle = '#5b4fa0'; g.beginPath(); g.moveTo(-26, -86); g.lineTo(0, -108); g.lineTo(26, -86); g.closePath(); g.fill(); g.stroke();
  // 信标：亮着时一道慢慢转的光
  if (lit) {
    const a = t * 1.4; g.save(); g.translate(0, -96); g.globalCompositeOperation = 'lighter';
    const gr = g.createLinearGradient(0, 0, Math.cos(a) * 160, Math.sin(a) * 40); gr.addColorStop(0, 'rgba(255,190,225,0.6)'); gr.addColorStop(1, 'rgba(255,190,225,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 170, Math.sin(a) * 40 - 18); g.lineTo(Math.cos(a) * 170, Math.sin(a) * 40 + 18); g.closePath(); g.fill(); g.restore();
    glowAt(g, 0, -96, 30, 'rgba(255,159,207,0.9)', 0.8);
  }
  g.fillStyle = lit ? '#ffd76a' : '#7d72b8'; g.beginPath(); g.arc(0, -96, 7, 0, TAU); g.fill(); g.stroke();
  heartPath(g, 0, -62, 8); g.fillStyle = '#ff8f80'; g.fill(); g.stroke();
  g.restore();
}
function drawWorkshop(g, x, y, t, busy) {
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(10,8,30,0.35)'; g.beginPath(); g.ellipse(0, 4, 62, 11, 0, 0, TAU); g.fill();
  g.fillStyle = '#c98a4a'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.fillRect(-50, -62, 100, 62); g.strokeRect(-50, -62, 100, 62);
  g.fillStyle = '#7d5a3a'; g.beginPath(); g.moveTo(-58, -60); g.lineTo(0, -98); g.lineTo(58, -60); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#5a4432'; g.fillRect(28, -108, 14, 30); g.strokeRect(28, -108, 14, 30);
  if (busy) for (let i = 0; i < 3; i++) { const u = ((t * 0.5 + i / 3) % 1); g.fillStyle = `rgba(235,240,255,${0.5 * (1 - u)})`; g.beginPath(); g.arc(35 + u * 14, -112 - u * 46, 6 + u * 10, 0, TAU); g.fill(); }
  g.fillStyle = '#2a2160'; g.fillRect(-14, -36, 28, 36); g.strokeRect(-14, -36, 28, 36);
  gear(g, -32, -34, 16, 8, busy ? t * 1.6 : 0.3, '#9fe3f0'); gear(g, 34, -30, 11, 7, busy ? -t * 2.3 : 0.1, '#ffd76a');
  g.restore();
}
function drawShop(g, x, y, t, stock) {
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(10,8,30,0.35)'; g.beginPath(); g.ellipse(0, 4, 60, 11, 0, 0, TAU); g.fill();
  g.fillStyle = '#ffe9f4'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.fillRect(-48, -54, 96, 54); g.strokeRect(-48, -54, 96, 54);
  // 糖果条纹雨棚
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff9fcf'; g.beginPath(); g.moveTo(-56 + i * 18.7, -54); g.lineTo(-56 + (i + 1) * 18.7, -54); g.lineTo(-52 + (i + 1) * 17.3, -82); g.lineTo(-52 + i * 17.3, -82); g.closePath(); g.fill(); g.stroke(); }
  g.fillStyle = '#c98a4a'; g.fillRect(-44, -22, 88, 10); g.strokeRect(-44, -22, 88, 10);
  for (let i = 0; i < 4; i++) { const has = i < stock; g.fillStyle = has ? ['#ffd76a', '#9fe3f0', '#ff9fcf', '#c9a8ff'][i] : 'rgba(255,255,255,0.15)'; g.beginPath(); g.roundRect ? g.roundRect(-36 + i * 20, -40, 12, 18, 4) : g.rect(-36 + i * 20, -40, 12, 18); g.fill(); g.stroke(); }
  g.restore();
}
/* 还没开放的建筑：一片看得出轮廓的残骸 */
function drawBuildingRuin(g, x, y, kind, t) {
  g.save(); g.translate(x, y); g.globalAlpha = 0.75;
  g.fillStyle = 'rgba(10,8,30,0.3)'; g.beginPath(); g.ellipse(0, 4, 54, 10, 0, 0, TAU); g.fill();
  g.fillStyle = '#6d6290'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  if (kind === 'workshop') { g.fillRect(-46, -30, 40, 30); g.strokeRect(-46, -30, 40, 30); g.beginPath(); g.moveTo(-50, -28); g.lineTo(-24, -50); g.lineTo(-8, -38); g.stroke(); gear(g, 22, -12, 12, 7, 0.4, '#8f82b8'); }
  else { g.fillRect(-40, -24, 34, 24); g.strokeRect(-40, -24, 34, 24); for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#9a8fc0' : '#c49ab8'; g.beginPath(); g.moveTo(-44 + i * 14, -24); g.lineTo(-30 + i * 14, -24); g.lineTo(-34 + i * 12, -40); g.closePath(); g.fill(); g.stroke(); } g.fillStyle = '#7d5a3a'; g.fillRect(6, -10, 34, 8); g.strokeRect(6, -10, 34, 8); }
  g.restore();
}
/* 码头：小梦兔救回来之前灯是灭的 */
function drawHomeDock(g, x, y, t, lit) {
  g.save(); g.translate(x, y);
  g.fillStyle = '#7d5a3a'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.roundRect ? g.roundRect(-110, -10, 220, 22, 8) : g.rect(-110, -10, 220, 22); g.fill(); g.stroke();
  for (let i = -100; i <= 100; i += 22) { g.strokeStyle = 'rgba(40,24,10,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(i, -8); g.lineTo(i, 10); g.stroke(); }
  for (const s of [-1, 1]) {
    g.fillStyle = '#5a4432'; g.strokeStyle = PAL.ink; g.lineWidth = 2; g.fillRect(s * 96 - 4, -54, 8, 46); g.strokeRect(s * 96 - 4, -54, 8, 46);
    if (lit > 0) glowAt(g, s * 96, -60, 26, 'rgba(255,215,106,0.9)', 0.7 * lit);
    g.fillStyle = lit > 0.5 ? '#ffd76a' : '#6d6290'; g.beginPath(); g.arc(s * 96, -60, 8, 0, TAU); g.fill(); g.stroke();
  }
  g.restore();
}

/* ---------- 家园画面 ---------- */
class HomeScene {
  constructor() { this.t = 0; this.cache = null; this.cw = 0; this.arrive = null; this.walk = {}; this.flash = {}; }
  update(dt) { this.t += dt; if (this.arrive) { this.arrive.t += dt; if (this.arrive.t > 7) this.arrive = null; } }
  /* 回家演出：飞机降落码头 → 新伙伴下机走到自己的建筑 → 修好的东西亮一下（约 6 秒，随时可以操作） */
  startArrival(info) { this.arrive = { t: 0, npcs: (info && info.newNpcs) || [], lightDock: !!(info && info.lightDock), repaired: !!(info && info.repaired) }; }
  build(W, H) {
    const c = makeCanvas(W, H), g = c.getContext('2d'), r = mulberry32(21);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#20185a'); bg.addColorStop(0.55, '#4b3a8c'); bg.addColorStop(0.8, '#7a5aa8'); bg.addColorStop(1, '#2a2060');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(240,235,255,${0.3 + r() * 0.6})`; g.fillRect(r() * W, r() * H * 0.55, 1.5, 1.5); }
    g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(W * 0.47, H * 0.14, 46, 0, TAU); g.fill();
    glowAt(g, W * 0.47, H * 0.14, 150, 'rgba(255,240,200,0.5)', 0.5);
    // 远处的云海
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(230,220,255,${0.08 + r() * 0.08})`; g.beginPath(); g.ellipse(r() * W, H * (0.78 + r() * 0.2), 120 + r() * 160, 26 + r() * 20, 0, 0, TAU); g.fill(); }
    return c;
  }
  /* 主岛：木甲板 + 底下的浮石 */
  drawIsland(g, W, H, t) {
    const x0 = W * 0.18, x1 = W * 0.88, top = H * 0.40, bot = H * 0.70, bob = Math.sin(t * 0.8) * 3;
    g.save(); g.translate(0, bob);
    g.fillStyle = '#5b4fa0'; g.strokeStyle = PAL.ink; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0 + 20, bot); g.lineTo(x1 - 20, bot);
    for (let i = 0; i <= 8; i++) { const x = x1 - 20 - i * (x1 - x0 - 40) / 8; g.lineTo(x, bot + 60 + (i % 2 ? 50 : 20) + Math.sin(i * 1.7) * 14); }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#8f7ad6'; g.beginPath(); g.roundRect ? g.roundRect(x0, top, x1 - x0, bot - top, 28) : g.rect(x0, top, x1 - x0, bot - top); g.fill(); g.stroke();
    g.fillStyle = '#b8a2ef'; g.beginPath(); g.roundRect ? g.roundRect(x0 + 8, top + 6, x1 - x0 - 16, bot - top - 22, 22) : g.rect(x0 + 8, top + 6, x1 - x0 - 16, bot - top - 22); g.fill();
    g.strokeStyle = 'rgba(90,70,160,0.35)'; g.lineWidth = 1.5;
    for (let x = x0 + 40; x < x1 - 20; x += 38) { g.beginPath(); g.moveTo(x, top + 8); g.lineTo(x - 12, bot - 18); g.stroke(); }
    for (let i = 0; i < 7; i++) { const lx = x0 + 60 + i * (x1 - x0 - 120) / 6; g.globalCompositeOperation = 'lighter'; drawGlow(g, lx, bot + 6, 18, GLOW.gold, 0.5 + Math.sin(t * 2 + i) * 0.15); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(lx, bot + 6, 5, 0, TAU); g.fill(); }
    g.restore();
    return bob;
  }
  draw(g, W, H, meta, ui) {
    if (!this.cache || this.cw !== W) { this.cache = this.build(W, H); this.cw = W; }
    g.drawImage(this.cache, 0, 0);
    const t = this.t, home = meta.home, L = Home.layout(W), A = this.arrive;
    // 远处：破损的梦灯屋（线索）、旧风塔（爷爷回来后出现，修好风道后转起来、一道光通向上层航路）
    g.save(); g.globalAlpha = 0.85; drawLampHouse(g, L.ruin.x, L.ruin.y, { lit: 0, done: false, open: 0 }, t); g.restore();
    g.save(); g.strokeStyle = 'rgba(30,20,60,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(L.ruin.x - 20, L.ruin.y - 70); g.lineTo(L.ruin.x - 4, L.ruin.y - 44); g.lineTo(L.ruin.x - 14, L.ruin.y - 20); g.stroke(); g.restore();
    if (home.built.workshop || Home.rescued(meta, 'grandpa')) {
      const fixed = !!home.projects.windRoad;
      if (fixed) { g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(0, 0, 0, L.tower.y); gr.addColorStop(0, 'rgba(255,230,160,0)'); gr.addColorStop(1, 'rgba(255,230,160,0.35)'); g.fillStyle = gr; g.fillRect(L.tower.x - 26, 0, 52, L.tower.y - 120); g.restore(); }
      g.save(); g.translate(L.tower.x, L.tower.y); g.scale(0.62, 0.62); g.translate(-L.tower.x, -L.tower.y);
      if (!fixed) g.globalAlpha = 0.7;
      drawWindTower(g, L.tower.x, L.tower.y, fixed ? t * 1.6 : 0.4, t, 0, 0, 0);
      g.restore();
    }
    const bob = this.drawIsland(g, W, H, t);
    // 码头 + 停着的飞机（回家时先从左边飞进来）
    const lit = home.built.rescue ? (A && A.lightDock ? clamp((A.t - 1.4) / 0.8, 0, 1) : 1) : 0;
    drawHomeDock(g, L.dock.x, L.dock.y, t, lit);
    const fly = A ? clamp(A.t / 1.6, 0, 1) : 1, k = 1 - Math.pow(1 - fly, 3);
    drawPlane(g, meta.current, lerp(-120, L.dock.x + 10, k), L.dock.y - 46 + Math.sin(t * 1.6) * 4 - (1 - k) * 60, 1.15, t, { happy: true, tilt: (1 - k) * 0.2 });
    // 格子（摆放模式时高亮）+ 机库 + 建筑（从后往前画）
    g.save(); g.translate(0, bob);
    if (ui && ui.place) for (let i = 0; i < L.plots.length; i++) { const P = L.plots[i]; g.strokeStyle = 'rgba(255,227,138,0.8)'; g.setLineDash([6, 6]); g.lineWidth = 2; g.beginPath(); g.ellipse(P.x, P.y, P.w * 0.45, 16, 0, 0, TAU); g.stroke(); g.setLineDash([]); }
    drawHangar(g, L.hangar.x, L.hangar.y, t);
    for (const r of Home.ruins(meta)) { const P = L.plots[r.plot]; if (P) drawBuildingRuin(g, P.x, P.y, r.b, t); }
    const items = Object.keys(home.plots).filter((b) => home.built[b] && L.plots[home.plots[b]]).map((b) => ({ b, P: L.plots[home.plots[b]] })).sort((a, c) => a.P.y - c.P.y);
    for (const { b, P } of items) {
      const fl = this.flash[b] ? clamp(1 - (t - this.flash[b]) / 1.2, 0, 1) : 0;
      if (fl > 0) glowAt(g, P.x, P.y - 40, 120, 'rgba(255,230,160,0.8)', fl);
      if (b === 'rescue') drawRescueDesk(g, P.x, P.y, t, true);
      else if (b === 'workshop') drawWorkshop(g, P.x, P.y, t, home.res.wood >= HOME.recipe);
      else if (b === 'shop') drawShop(g, P.x, P.y, t, Math.min(4, home.res.goods));
    }
    // 常驻 NPC：站在自己的建筑旁边晃；刚救回来的从码头走过去
    for (const id of Object.keys(home.npcs)) {
      const b = HOME_NPCS[id] && HOME_NPCS[id].bld, P = b && home.plots[b] !== undefined ? L.plots[home.plots[b]] : null; if (!P) continue;
      let x = P.x + P.w * 0.42 + Math.sin(t * 0.7 + id.length) * 10, y = P.y + 6;
      const i = A ? A.npcs.indexOf(id) : -1;
      if (i >= 0) { const u = clamp((A.t - 1.6 - i * 0.6) / 2.2, 0, 1); if (u <= 0) continue; x = lerp(L.dock.x + 40, x, u); y = lerp(L.dock.y - 6 - bob, y, u) - Math.abs(Math.sin(u * Math.PI * 4)) * 8; }
      drawNPC(g, id, x, y - 18, 0.85, t, 'happy');
    }
    g.restore();
  }
}
