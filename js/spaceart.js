'use strict';
/* 深色宇宙的场景（美术 A，docs/design.md §15）：保留胖乎乎、一眼看清的造型，换成深色宇宙底，每张图一种主色和一种天气。
   五张图各三关：锈带残骸场 / 霜晶环带 / 霓虹电弧城 / 熔核前线 / 寂静圣所。背景永远比敌人和子弹暗。 */

const SPACE_MAPS = {
  rust: { sky: ['#07060f', '#140d22', '#2a1626'], neb: ['rgba(214,120,70,1)', 'rgba(120,70,170,1)', 'rgba(60,40,110,1)'], rim: '#e8925a', sil: '#120c1c', sil2: '#1b1226', light: '#ffb35c', weather: 'flakes', wcol: '200,130,90', fog: '170,90,70' },
  ice: { sky: ['#030a14', '#08182c', '#10304a'], neb: ['rgba(80,170,230,1)', 'rgba(60,230,200,1)', 'rgba(70,90,200,1)'], rim: '#bfe9ff', sil: '#071222', sil2: '#0c1c32', light: '#9fe8ff', weather: 'snow', wcol: '210,240,255', fog: '120,200,240' },
  neon: { sky: ['#06030f', '#120626', '#24073a'], neb: ['rgba(255,60,200,1)', 'rgba(60,220,255,1)', 'rgba(120,40,200,1)'], rim: '#ff6fe0', sil: '#0c0518', sil2: '#160a26', light: '#3ef0ff', weather: 'rain', wcol: '160,230,255', fog: '200,80,220' },
  molten: { sky: ['#0a0406', '#1c0808', '#3a1008'], neb: ['rgba(255,90,40,1)', 'rgba(255,170,60,1)', 'rgba(120,30,40,1)'], rim: '#ff7a3a', sil: '#140606', sil2: '#200a08', light: '#ff9a40', weather: 'embers', wcol: '255,140,60', fog: '255,90,40' },
  sanctum: { sky: ['#030208', '#0a0616', '#160a26'], neb: ['rgba(140,70,220,1)', 'rgba(70,40,160,1)', 'rgba(200,120,255,1)'], rim: '#b98aff', sil: '#06040c', sil2: '#0e0818', light: '#d6b8ff', weather: 'static', wcol: '200,180,255', fog: '130,90,210' },
};
/* 每关一种远景、一种中景、一个天体 */
const SPACE_THEMES = {
  title: { map: 'rust', far: 'wreck', mid: 'debris', body: 'dead', moon: true },
  station: { map: 'rust', far: 'wreck', mid: 'debris', body: 'dead' },
  '1-1': { map: 'rust', far: 'wreck', mid: 'debris', body: 'dead', moon: true, name: '外环废料带' },
  '1-2': { map: 'rust', far: 'containers', mid: 'girders', body: 'dead2', name: '残骸河' },
  '1-3': { map: 'rust', far: 'station', mid: 'girders', body: 'clock', name: '停摆钟楼站' },
  '2-1': { map: 'ice', far: 'icering', mid: 'shards', body: 'gas', name: '冰环外缘' },
  '2-2': { map: 'ice', far: 'hive', mid: 'shards', body: 'gas2', name: '蜂巢冰洞' },
  '2-3': { map: 'ice', far: 'palace', mid: 'shards', body: 'gas', name: '霜心王座' },
  '3-1': { map: 'neon', far: 'city', mid: 'signs', body: 'neonMoon', name: '广告牌大道' },
  '3-2': { map: 'neon', far: 'dome', mid: 'signs', body: 'neonMoon', name: '马戏穹顶' },
  '3-3': { map: 'neon', far: 'tower', mid: 'cables', body: 'neonMoon', name: '董事会塔' },
  '4-1': { map: 'molten', far: 'plain', mid: 'wrecks', body: 'lava', name: '焦土平原' },
  '4-2': { map: 'molten', far: 'artillery', mid: 'wrecks', body: 'lava', name: '炮兵阵地' },
  '4-3': { map: 'molten', far: 'fortress', mid: 'stacks', body: 'lava2', name: '熔炉要塞' },
  '5-1': { map: 'sanctum', far: 'corridor', mid: 'pillars', body: 'eclipse', name: '无声回廊' },
  '5-2': { map: 'sanctum', far: 'organ', mid: 'pillars', body: 'eclipse', name: '唱诗大厅' },
  '5-3': { map: 'sanctum', far: 'altar', mid: 'dishes', body: 'eclipse2', name: '祭坛' },
};
const STAGE_THEME_ALIAS = { bay: '1-1', river: '1-2', tower: '1-3' };

class SpaceScene {
  constructor() {
    this.scroll = 0; this.t = 0; this.W = 0; this.H = 720; this.speed = 36; this.dir = 1; this.hold = 0; this.dim = 0; this.moonFx = null;
    this.TW = 1600; this.cache = {};
    const r = mulberry32(12);
    this.stars = []; for (let i = 0; i < 220; i++) this.stars.push({ x: r() * 1600, y: r() * 720, s: 0.4 + r() * 1.3, p: r() * TAU, k: r() < 0.08 ? 2 : r() < 0.4 ? 1 : 0 });
    this.motes = []; for (let i = 0; i < 60; i++) this.motes.push({ x: r() * 1640, y: r() * 720, s: 0.6 + r() * 2.2, v: 10 + r() * 30, p: r() * TAU, w: r() });
    this.setTheme('1-1');
  }
  setTheme(id) {
    id = STAGE_THEME_ALIAS[id] || id;
    if (!SPACE_THEMES[id]) id = '1-1';
    if (this.themeId === id && this.layers) return;
    this.themeId = id; this.th = SPACE_THEMES[id]; this.M = SPACE_MAPS[this.th.map];
    this.layers = this.cache[id] || (this.cache[id] = this.buildLayers(id));
  }
  /* 每关画一次：星云（极慢）、远景剪影（0.2）、中景（0.55） */
  buildLayers(id) {
    const TW = this.TW, H = 720, th = SPACE_THEMES[id], M = SPACE_MAPS[th.map], seed = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const neb = makeCanvas(TW, H), n = neb.getContext('2d'), r = mulberry32(seed);
    // 星云：主色铺满天（L1 r2：画面偏暗偏空），再点几团亮的核，背景有颜色、有层次，但仍比敌人和子弹暗
    for (let i = 0; i < 13; i++) {
      const x = r() * TW, y = 40 + r() * 560, rad = 170 + r() * 340, col = M.neb[i % M.neb.length];
      for (const ox of [-TW, 0, TW]) { const gr = n.createRadialGradient(x + ox, y, 4, x + ox, y, rad); gr.addColorStop(0, col.replace(',1)', ',0.26)')); gr.addColorStop(0.5, col.replace(',1)', ',0.1)')); gr.addColorStop(1, col.replace(',1)', ',0)')); n.fillStyle = gr; n.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2); }
    }
    for (let i = 0; i < 4; i++) {
      const x = r() * TW, y = 80 + r() * 380, rad = 50 + r() * 60, col = M.neb[(i + 1) % M.neb.length];
      for (const ox of [-TW, 0, TW]) { const gr = n.createRadialGradient(x + ox, y, 2, x + ox, y, rad); gr.addColorStop(0, col.replace(',1)', ',0.32)')); gr.addColorStop(1, col.replace(',1)', ',0)')); n.fillStyle = gr; n.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2); }
    }
    // 尘带：一条斜着的暗带，让星云有结构
    n.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) { const x = r() * TW, y = 200 + r() * 300; const gr = n.createRadialGradient(x, y, 2, x, y, 140 + r() * 120); gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); n.fillStyle = gr; n.beginPath(); n.ellipse(x, y, 260, 60, -0.3, 0, TAU); n.fill(); }
    n.globalCompositeOperation = 'source-over';
    const far = makeCanvas(TW, H), f = far.getContext('2d'), lights = [];
    (SPACE_FAR[th.far] || SPACE_FAR.wreck)(f, TW, H, M, mulberry32(seed + 1), lights);
    const mid = makeCanvas(TW, H), m = mid.getContext('2d'), mlights = [];
    (SPACE_MID[th.mid] || SPACE_MID.debris)(m, TW, H, M, mulberry32(seed + 2), mlights);
    // 剪影带一点这张图的光（评审 / L1：背景是单色剪影）：只给已经画了东西的地方上色，越往上越亮
    const lit = (cv, y0, y1, c, a) => { const x = cv.getContext('2d'); x.save(); x.globalCompositeOperation = 'source-atop'; const gr = x.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, hexA(c, a)); gr.addColorStop(1, hexA(c, 0)); x.fillStyle = gr; x.fillRect(0, y0, TW, y1 - y0); x.restore(); };
    lit(far, 0, H, M.light, 0.2); lit(mid, 360, H, M.rim, 0.32);
    return { neb, far, mid, lights, mlights };
  }
  update(dt) {
    this.t += dt;
    if (this.hold > 0) this.hold -= dt; else this.scroll += this.speed * this.dir * dt;
    for (const m of this.motes) { m.x -= m.v * this.dir * dt * (this.hold > 0 ? 0 : 1) * (this.M && this.M.weather === 'rain' ? 3 : 1); if (m.x < -20) m.x += 1660; if (m.x > 1640) m.x -= 1660; }
  }
  layerX(k) { const TW = this.TW; let o = (this.scroll * k) % TW; if (o < 0) o += TW; return -o; }
  draw(g, W, H, o = {}) {
    const t = this.t, th = this.th, M = this.M, L = this.layers, dim = this.dim ? 1 : 0;
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, M.sky[0]); sky.addColorStop(0.55, M.sky[1]); sky.addColorStop(1, M.sky[2]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const nx = this.layerX(0.03); g.globalAlpha = dim ? 0.9 : 1; g.drawImage(L.neb, nx, 0); g.drawImage(L.neb, nx + this.TW, 0); g.globalAlpha = 1;
    // 星：远处小点，少数亮星带十字光
    const sx = this.layerX(0.05);
    for (const s of this.stars) {
      const x = ((s.x + sx * (s.k ? 1.4 : 1)) % 1600 + 1600) % 1600; if (x > W) continue;
      const a = (0.35 + 0.35 * Math.sin(t * 1.7 + s.p)) * (dim ? 0.75 : 1);
      g.fillStyle = s.k === 2 ? '#fff4e8' : '#e8e6ff'; g.globalAlpha = a; g.fillRect(x, s.y, s.s, s.s);
      if (s.k === 2) { g.globalAlpha = a * 0.5; g.fillRect(x - 4, s.y + s.s / 2 - 0.4, 8 + s.s, 0.8); g.fillRect(x + s.s / 2 - 0.4, s.y - 4, 0.8, 8 + s.s); }
    }
    g.globalAlpha = 1;
    this.drawBody(g, W, H, t);
    const fx = this.layerX(0.2);
    g.drawImage(L.far, fx, 0); g.drawImage(L.far, fx + this.TW, 0);
    for (const l of L.lights) for (const off of [fx, fx + this.TW]) { const x = l.x + off; if (x < -10 || x > W + 10) continue; const on = Math.sin(t * l.f + l.p) > -0.6; if (!on) continue; g.fillStyle = l.c || M.light; g.globalAlpha = (dim ? 0.7 : 0.85) * (l.a || 1); g.fillRect(x, l.y, l.w || 3, l.h || 3); }
    g.globalAlpha = 1;
    // 地平雾：一层主色的薄雾，把远景和战场分开
    const fog = g.createLinearGradient(0, H * 0.55, 0, H); fog.addColorStop(0, `rgba(${M.fog},0)`); fog.addColorStop(0.6, `rgba(${M.fog},${0.07 + Math.sin(t * 0.5) * 0.02})`); fog.addColorStop(1, `rgba(${M.fog},0.02)`);
    g.fillStyle = fog; g.fillRect(0, H * 0.55, W, H * 0.45);
    const mx = this.layerX(0.55);
    g.globalAlpha = dim ? 0.92 : 1; g.drawImage(L.mid, mx, 0); g.drawImage(L.mid, mx + this.TW, 0); g.globalAlpha = 1;
    for (const l of L.mlights) for (const off of [mx, mx + this.TW]) { const x = l.x + off; if (x < -20 || x > W + 20) continue; const k = 0.5 + 0.5 * Math.sin(t * l.f + l.p); g.globalCompositeOperation = 'lighter'; drawGlow(g, x, l.y, l.r || 10, l.c || M.light, (dim ? 0.38 : 0.45) * k); g.globalCompositeOperation = 'source-over'; }
    this.drawWeather(g, W, H, t);
    if (!o.noForeground) this.drawForeground(g, W, H);
  }
  /* 天体：死掉的行星、带环的气态巨星、霓虹月、熔岩星、日食 */
  drawBody(g, W, H, t) {
    const b = this.th.body, M = this.M, F = this.moonFx;
    const k = this.dim ? 0.85 : 1;
    g.save(); g.globalAlpha = k;
    if (b === 'dead' || b === 'dead2') {
      const px = b === 'dead' ? W * 0.16 : W * 0.82, py = H * 0.86, pr = 300;
      const gr = g.createRadialGradient(px + 90, py - 120, 20, px, py, pr); gr.addColorStop(0, '#6a4a44'); gr.addColorStop(0.6, '#3a2630'); gr.addColorStop(1, '#170e18');
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
      g.fillStyle = 'rgba(20,12,22,0.5)'; for (const [cx, cy, cr] of [[60, -180, 34], [-40, -120, 22], [130, -90, 18], [-110, -200, 14], [20, -250, 12]]) { g.beginPath(); g.arc(px + cx, py + cy, cr, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(232,146,90,0.35)'; g.lineWidth = 3; g.beginPath(); g.arc(px, py, pr - 1, Math.PI * 1.15, Math.PI * 1.75); g.stroke();
    }
    if (b === 'gas' || b === 'gas2') {
      const px = b === 'gas' ? W * 0.72 : W * 0.3, py = H * 0.3, pr = 150;
      g.save(); g.translate(px, py); g.rotate(-0.25);
      g.strokeStyle = 'rgba(190,233,255,0.18)'; g.lineWidth = 14; g.beginPath(); g.ellipse(0, 0, pr * 2.1, pr * 0.42, 0, Math.PI, TAU); g.stroke();
      const gr = g.createRadialGradient(-40, -50, 10, 0, 0, pr); gr.addColorStop(0, '#5f9fc8'); gr.addColorStop(0.7, '#21476a'); gr.addColorStop(1, '#0b1a2e');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, pr, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.arc(0, 0, pr, 0, TAU); g.clip(); for (let i = -4; i <= 4; i++) { g.fillStyle = i % 2 ? 'rgba(150,210,240,0.10)' : 'rgba(10,30,60,0.18)'; g.fillRect(-pr, i * 30 - 10, pr * 2, 16); } g.restore();
      g.strokeStyle = 'rgba(190,233,255,0.28)'; g.lineWidth = 14; g.beginPath(); g.ellipse(0, 0, pr * 2.1, pr * 0.42, 0, 0, Math.PI); g.stroke();
      g.strokeStyle = 'rgba(190,233,255,0.12)'; g.lineWidth = 6; g.beginPath(); g.ellipse(0, 0, pr * 2.45, pr * 0.5, 0, 0, Math.PI); g.stroke();
      g.restore();
    }
    if (b === 'neonMoon') {
      const px = W * 0.78, py = H * 0.2, pr = 70;
      g.globalCompositeOperation = 'lighter'; drawGlow(g, px, py, 160, 'rgba(255,80,210,0.5)', 0.45); g.globalCompositeOperation = 'source-over';
      const gr = g.createRadialGradient(px - 20, py - 20, 6, px, py, pr); gr.addColorStop(0, '#d8a8ff'); gr.addColorStop(1, '#5a2a8a');
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
      g.fillStyle = 'rgba(62,240,255,0.55)'; for (let i = 0; i < 18; i++) { const a = i * 2.4, rr = (i % 5) * 12; g.fillRect(px + Math.cos(a) * rr - 1, py + Math.sin(a) * rr * 0.7 - 1, 2, 2); }
    }
    if (b === 'lava' || b === 'lava2') {
      const px = b === 'lava' ? W * 0.5 : W * 0.2, py = H * 1.25, pr = 520;
      const gr = g.createRadialGradient(px, py - 300, 40, px, py, pr); gr.addColorStop(0, '#5a1a10'); gr.addColorStop(0.8, '#2a0a08'); gr.addColorStop(1, '#120404');
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,120,40,0.55)'; g.lineWidth = 2.4; const r = mulberry32(5);
      for (let i = 0; i < 14; i++) { let x = px - 420 + r() * 840, y = py - pr * 0.92 + r() * 120; g.beginPath(); g.moveTo(x, y); for (let k2 = 0; k2 < 5; k2++) { x += 20 + r() * 40; y += -10 + r() * 24; g.lineTo(x, y); } g.stroke(); }
      g.globalCompositeOperation = 'lighter'; drawGlow(g, px, py - pr, 520, 'rgba(255,90,30,0.4)', 0.4 + 0.08 * Math.sin(t)); g.globalCompositeOperation = 'source-over';
    }
    if (b === 'eclipse' || b === 'eclipse2') {
      const px = b === 'eclipse' ? W * 0.68 : W * 0.5, py = H * (b === 'eclipse' ? 0.28 : 0.36), pr = b === 'eclipse' ? 80 : 120;
      g.globalCompositeOperation = 'lighter'; drawGlow(g, px, py, pr * 2.6, 'rgba(170,110,255,0.6)', 0.5 + 0.08 * Math.sin(t * 0.7)); g.globalCompositeOperation = 'source-over';
      g.strokeStyle = 'rgba(220,190,255,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(px, py, pr + 2, 0, TAU); g.stroke();
      g.fillStyle = '#020104'; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
    }
    if (b === 'clock') this.drawClockMoon(g, W * 0.4, H * 0.22, t);
    g.restore();
    if (this.th.moon && !(F && F.gone)) this.drawMoon(g, W * 0.4, H * 0.2, t, F);
    if (F && F.rift) {
      const mx = W * 0.4, my = H * 0.2;
      g.save(); g.translate(mx, my); g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 110, 'rgba(255,215,106,0.6)', 0.5 + Math.sin(t * 2) * 0.1); g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#0a0620'; g.strokeStyle = '#ffd76a'; g.lineWidth = 3; g.beginPath(); g.moveTo(-10, -70); g.lineTo(12, -30); g.lineTo(-6, 0); g.lineTo(16, 34); g.lineTo(0, 72); g.lineTo(-18, 30); g.lineTo(2, 0); g.lineTo(-20, -34); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
  }
  /* 第 1 张图的小卫星（月亮怪那个惊喜从这里掉下来） */
  drawMoon(g, mx, my, t, F) {
    g.globalCompositeOperation = 'lighter'; drawGlow(g, mx, my, 120, 'rgba(230,170,140,0.45)', 0.4); g.globalCompositeOperation = 'source-over';
    const mg = g.createRadialGradient(mx - 14, my - 14, 8, mx, my, 54); mg.addColorStop(0, '#f2e2d8'); mg.addColorStop(1, '#a8867c');
    g.fillStyle = mg; g.globalAlpha = 0.62; g.beginPath(); g.arc(mx, my, 52, 0, TAU); g.fill();
    g.fillStyle = 'rgba(110,80,80,0.45)'; for (const [cx, cy, cr] of [[-16, 8, 11], [14, -12, 7], [18, 16, 5], [-6, -22, 4]]) { g.beginPath(); g.arc(mx + cx, my + cy, cr, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    if (F) {
      g.save(); g.beginPath(); g.arc(mx, my, 52, 0, TAU); g.clip();
      g.fillStyle = `rgba(30,16,30,${0.5 * F.shade})`; g.beginPath(); g.arc(mx + 60 - F.shade * 44, my, 52, 0, TAU); g.fill();
      g.fillStyle = '#140d22'; g.beginPath(); g.arc(mx + Math.cos(F.notch) * 50, my + Math.sin(F.notch) * 50, 12, 0, TAU); g.fill();
      if (F.blink) { g.fillStyle = '#8a6a6a'; g.fillRect(mx - 52, my - 52, 104, 56); g.strokeStyle = '#2a1626'; g.lineWidth = 3; g.beginPath(); g.moveTo(mx - 34, my + 4); g.quadraticCurveTo(mx, my + 16, mx + 34, my + 4); g.stroke(); }
      g.restore();
    }
  }
  /* 停摆钟楼站：月亮的位置挂着一面大钟，分针走得太快（比敌人暗） */
  drawClockMoon(g, mx, my, t) {
    g.globalCompositeOperation = 'lighter'; drawGlow(g, mx, my, 160, 'rgba(255,170,120,0.45)', 0.45); g.globalCompositeOperation = 'source-over';
    g.save(); g.translate(mx, my); g.globalAlpha = 0.5;
    const fg = g.createRadialGradient(-14, -14, 8, 0, 0, 66); fg.addColorStop(0, '#fff1e6'); fg.addColorStop(1, '#e0b090');
    g.fillStyle = fg; g.beginPath(); g.arc(0, 0, 64, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(70,30,40,0.9)'; g.lineWidth = 4; g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.lineWidth = i % 3 ? 2 : 4; g.beginPath(); g.moveTo(Math.cos(a) * 52, Math.sin(a) * 52); g.lineTo(Math.cos(a) * 60, Math.sin(a) * 60); g.stroke(); }
    g.lineCap = 'round'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(t * 0.12 - 1.4) * 30, Math.sin(t * 0.12 - 1.4) * 30); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(t * 1.6) * 48, Math.sin(t * 1.6) * 48); g.stroke();
    g.restore();
  }
  /* 天气：锈屑、冰雪、霓虹雨、余烬、静电 */
  drawWeather(g, W, H, t) {
    const M = this.M, kind = M.weather, step = this.dim ? 2 : 1, c = M.wcol;
    for (let i = 0; i < this.motes.length; i += step) {
      const m = this.motes[i], x = m.x % (W + 40), y0 = m.y;
      if (kind === 'flakes') { const y = y0 + Math.sin(t * 0.8 + m.p) * 12; g.save(); g.translate(x, y); g.rotate(t * (0.5 + m.w) + m.p); g.fillStyle = `rgba(${c},${0.22 + 0.15 * m.w})`; g.fillRect(-m.s * 1.6, -m.s * 0.8, m.s * 3.2, m.s * 1.6); g.restore(); }
      else if (kind === 'snow') { const y = (y0 + t * (10 + m.v * 0.6)) % H; g.fillStyle = `rgba(${c},${0.25 + 0.25 * Math.sin(t * 2 + m.p)})`; g.beginPath(); g.arc(x, y, m.s * 0.8, 0, TAU); g.fill(); if (m.w > 0.85) { g.fillRect(x - 3, y - 0.4, 6, 0.8); g.fillRect(x - 0.4, y - 3, 0.8, 6); } }
      else if (kind === 'rain') { const y = (y0 + t * 220 * (0.5 + m.w)) % H; g.strokeStyle = `rgba(${c},${0.1 + 0.12 * m.w})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6, y + 18); g.stroke(); }
      else if (kind === 'embers') { const y = H - ((H - y0 + t * (20 + m.v)) % H); g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(${c},${0.3 + 0.3 * Math.sin(t * 3 + m.p)})`; g.fillRect(x + Math.sin(t + m.p) * 8, y, m.s, m.s); g.globalCompositeOperation = 'source-over'; }
      else if (kind === 'static') { if (Math.sin(t * 5 + m.p * 7) < 0.6) continue; g.fillStyle = `rgba(${c},${0.18 + 0.2 * m.w})`; g.fillRect(x, y0 + Math.sin(t * 9 + m.p) * 3, 2 + m.s * 3, 1.2); }
    }
  }
  /* 上下边缘：按图换剪影，高对比的边界（比战场暗） */
  drawForeground(g, W, H) {
    const t = this.t, fx = this.layerX(1.15), M = this.M, kind = this.th.map;
    g.fillStyle = M.sil;
    g.beginPath(); g.moveTo(0, H);
    for (let x = -40; x <= W + 60; x += 22) {
      const wx = x - (((fx % 44) + 44) % 44), n = ((Math.floor((wx - fx) / 22) * 7919) % 17 + 17) % 17;
      const hgt = kind === 'ice' ? 10 + (n % 4) * 9 : kind === 'molten' ? 14 + (n % 5) * 3 : kind === 'neon' ? 10 + (n % 3 === 0 ? 24 : 4) : kind === 'sanctum' ? 12 + (n % 6 === 0 ? 30 : 2) : 12 + n % 13;
      g.lineTo(wx, H - hgt); if (kind === 'ice') g.lineTo(wx + 11, H - hgt + 14); else g.lineTo(wx + 11, H - hgt);
    }
    g.lineTo(W, H); g.closePath(); g.fill();
    g.strokeStyle = M.rim; g.globalAlpha = 0.18; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, H - 8); g.lineTo(W, H - 8); g.stroke(); g.globalAlpha = 1;
    // 上边缘：挂下来的东西（缆线、冰锥、霓虹灯管、链子）
    const gx = ((fx % 300) + 300) % 300;
    for (let x = -300 + gx; x < W + 300; x += 300) {
      g.strokeStyle = M.sil; g.lineWidth = 3; g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + 150, 30, x + 300, 0); g.stroke();
      if (kind === 'ice') { g.fillStyle = M.sil; for (let k2 = 1; k2 < 7; k2++) { const px = x + k2 * 43, py = 2 * (1 - k2 / 7) * (k2 / 7) * 30 + 2; g.beginPath(); g.moveTo(px - 5, py); g.lineTo(px + 5, py); g.lineTo(px, py + 16 + (k2 % 3) * 6); g.closePath(); g.fill(); } }
      else if (kind === 'neon') { for (let k2 = 1; k2 < 4; k2++) { const px = x + k2 * 75, py = 2 * (1 - k2 / 4) * (k2 / 4) * 30 + 6; g.fillStyle = k2 % 2 ? 'rgba(255,79,216,0.35)' : 'rgba(62,240,255,0.35)'; g.fillRect(px - 14, py, 28, 4); } }
      else if (kind === 'molten' || kind === 'rust') { for (let k2 = 1; k2 < 5; k2++) { const px = x + k2 * 60, py = 2 * (1 - k2 / 5) * (k2 / 5) * 30 + 2; g.fillStyle = M.sil; g.fillRect(px - 2, py, 4, 10); g.fillRect(px - 6, py + 10, 12, 6); } }
      else { for (let k2 = 1; k2 < 6; k2++) { const px = x + k2 * 50, py = 2 * (1 - k2 / 6) * (k2 / 6) * 30 + 2; g.fillStyle = 'rgba(214,184,255,0.25)'; g.beginPath(); g.arc(px, py + 6, 3, 0, TAU); g.fill(); } }
    }
  }
}

/* ---------- 远景：每关一种剪影（深色 + 一道主色的边光 + 几点灯） ---------- */
function silFill(g, M, k) { g.fillStyle = k ? M.sil2 : M.sil; g.strokeStyle = M.rim; }
function rimLine(g, M, a) { g.save(); g.globalAlpha = a || 0.35; g.strokeStyle = M.rim; g.lineWidth = 1.6; g.stroke(); g.restore(); }
function addLights(lights, x, y, w, h, n, r, c, f) { for (let i = 0; i < n; i++) lights.push({ x: x + r() * w, y: y + r() * h, w: 2 + Math.floor(r() * 2), h: 2 + Math.floor(r() * 2), f: f || 0.3 + r() * 1.2, p: r() * 9, c }); }
const SPACE_FAR = {
  wreck(g, TW, H, M, r, L) { // 残骸场：断成几截的大船壳，肋骨一样的龙骨
    for (let i = 0; i < 5; i++) {
      const x = 80 + i * 320 + r() * 80, y = 280 + r() * 160, w = 180 + r() * 140, h = 40 + r() * 30, a = (r() - 0.5) * 0.3;
      g.save(); g.translate(x, y); g.rotate(a); silFill(g, M, i % 2);
      g.beginPath(); g.moveTo(-w / 2, 0); g.quadraticCurveTo(-w / 2 + 20, -h, 0, -h); g.lineTo(w / 2 - 30, -h * 0.8); g.lineTo(w / 2, 0); g.quadraticCurveTo(0, h * 0.5, -w / 2, 0); g.closePath(); g.fill(); rimLine(g, M, 0.3);
      for (let k = 0; k < 5; k++) { g.fillRect(-w / 2 + 20 + k * (w / 6), -h - 22 - r() * 20, 4, 24 + r() * 16); }
      g.restore(); addLights(L, x - w / 3, y - h, w * 0.6, h * 0.6, 3, r);
    }
    for (let i = 0; i < 26; i++) { const x = r() * TW, y = 120 + r() * 460, s = 3 + r() * 9; g.fillStyle = M.sil2; g.save(); g.translate(x, y); g.rotate(r() * TAU); g.fillRect(-s, -s * 0.6, s * 2, s * 1.2); g.restore(); }
  },
  containers(g, TW, H, M, r, L) { // 残骸河：一条漂着集装箱的碎片带
    for (let i = 0; i < 40; i++) {
      const x = r() * TW, y = 340 + Math.sin(x / 260) * 40 + r() * 90, w = 40 + r() * 40, h = 18 + r() * 12, a = (r() - 0.5) * 0.8;
      g.save(); g.translate(x, y); g.rotate(a); silFill(g, M, i % 2); g.fillRect(-w / 2, -h / 2, w, h);
      g.strokeStyle = M.rim; g.globalAlpha = 0.25; g.lineWidth = 1; for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(-w / 2 + (k * w) / 5, -h / 2); g.lineTo(-w / 2 + (k * w) / 5, h / 2); g.stroke(); }
      g.globalAlpha = 1; g.restore();
    }
    for (let i = 0; i < 6; i++) L.push({ x: r() * TW, y: 320 + r() * 120, w: 3, h: 3, f: 2 + r() * 2, p: r() * 9, c: '#ff6b5a' });
  },
  station(g, TW, H, M, r, L) { // 停摆钟楼站：空间站的舱段和一排钟楼
    for (let i = 0; i < 6; i++) {
      const x = 90 + i * 270 + r() * 60, w = 46 + r() * 30, h = 220 + r() * 160, base = 520;
      silFill(g, M, i % 2); g.fillRect(x - w / 2, base - h, w, h);
      g.beginPath(); g.moveTo(x - w / 2 - 8, base - h); g.lineTo(x, base - h - 50 - r() * 40); g.lineTo(x + w / 2 + 8, base - h); g.closePath(); g.fill();
      g.beginPath(); g.rect(x - w / 2, base - h, w, h); rimLine(g, M, 0.2);
      g.fillStyle = 'rgba(255,200,160,0.12)'; g.beginPath(); g.arc(x, base - h + 34, w * 0.32, 0, TAU); g.fill();
      g.fillStyle = M.sil2; g.fillRect(x - 120, base - h * 0.4, 240, 14);
      addLights(L, x - w / 2 + 4, base - h + 70, w - 8, h - 90, 4, r);
    }
  },
  icering(g, TW, H, M, r, L) { // 冰环：一条漂浮的冰块带
    for (let i = 0; i < 70; i++) {
      const x = r() * TW, y = 300 + Math.sin(x / 300) * 60 + r() * 120, s = 6 + r() * 26;
      g.fillStyle = i % 3 ? M.sil2 : M.sil; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.8, y - s * 0.2); g.lineTo(x + s * 0.4, y + s * 0.7); g.lineTo(x - s * 0.6, y + s * 0.5); g.lineTo(x - s * 0.8, y - s * 0.3); g.closePath(); g.fill();
      if (s > 18) { g.save(); g.globalAlpha = 0.3; g.strokeStyle = M.rim; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.8, y - s * 0.2); g.stroke(); g.restore(); }
    }
  },
  hive(g, TW, H, M, r, L) { // 蜂巢冰洞：一面冰崖上凿满六边形的洞
    silFill(g, M, 0); g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= TW; x += 40) g.lineTo(x, 300 + Math.sin(x / 180) * 50 + r() * 20); g.lineTo(TW, H); g.closePath(); g.fill();
    for (let i = 0; i < 90; i++) {
      const x = r() * TW, y = 380 + r() * 260, s = 8 + r() * 10;
      g.fillStyle = M.sil2; g.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } g.closePath(); g.fill();
      if (r() < 0.2) L.push({ x: x - 2, y: y - 2, w: 4, h: 4, f: 0.8 + r(), p: r() * 9, c: '#2fe0b8', a: 0.6 });
    }
  },
  palace(g, TW, H, M, r, L) { // 霜心王座：冰晶宫殿的尖塔
    for (let i = 0; i < 9; i++) {
      const x = 60 + i * 180 + r() * 40, h = 180 + r() * 220, w = 30 + r() * 30, base = 560;
      silFill(g, M, i % 2); g.beginPath(); g.moveTo(x - w / 2, base); g.lineTo(x - w / 3, base - h); g.lineTo(x, base - h - 70); g.lineTo(x + w / 3, base - h); g.lineTo(x + w / 2, base); g.closePath(); g.fill(); rimLine(g, M, 0.3);
      L.push({ x: x - 2, y: base - h - 30, w: 4, h: 6, f: 0.5 + r(), p: r() * 9, c: '#bfe9ff' });
    }
  },
  city(g, TW, H, M, r, L) { // 霓虹街：一排高楼，窗灯和广告牌
    for (let x = 0; x < TW;) {
      const w = 50 + r() * 80, h = 140 + r() * 260, base = 600; silFill(g, M, r() < 0.5); g.fillRect(x, base - h, w - 6, h);
      addLights(L, x + 4, base - h + 8, w - 14, h - 20, 6 + Math.floor(r() * 6), r, r() < 0.5 ? '#3ef0ff' : '#ff4fd8', 0.2 + r() * 0.4);
      if (r() < 0.35) { g.fillStyle = r() < 0.5 ? 'rgba(255,79,216,0.22)' : 'rgba(62,240,255,0.22)'; g.fillRect(x + 6, base - h + 20, w - 18, 26); }
      x += w;
    }
  },
  dome(g, TW, H, M, r, L) { // 马戏穹顶：条纹大帐篷和一串彩灯
    for (let i = 0; i < 3; i++) {
      const x = 260 + i * 540, y = 520, rw = 220, rh = 200;
      silFill(g, M, 0); g.beginPath(); g.moveTo(x - rw, y); g.quadraticCurveTo(x, y - rh * 1.4, x + rw, y); g.closePath(); g.fill();
      g.save(); g.clip(); for (let k = -6; k <= 6; k++) { g.fillStyle = k % 2 ? 'rgba(255,79,216,0.12)' : 'rgba(255,255,255,0.03)'; g.beginPath(); g.moveTo(x, y - rh * 0.72); g.lineTo(x + k * 40 - 20, y); g.lineTo(x + k * 40 + 20, y); g.closePath(); g.fill(); } g.restore();
      g.fillStyle = M.sil2; g.fillRect(x - 3, y - rh * 0.72 - 50, 6, 50);
      for (let k = 0; k < 14; k++) { const u = k / 13; L.push({ x: x - rw + u * rw * 2, y: y - Math.sin(u * Math.PI) * rh * 0.66 - 4, w: 3, h: 3, f: 3, p: k, c: k % 2 ? '#ffe45c' : '#ff4fd8' }); }
    }
  },
  tower(g, TW, H, M, r, L) { // 董事会塔：一座很高的企业大楼和周围的楼
    for (let i = 0; i < 4; i++) {
      const x = 200 + i * 400, w = 120, h = 520, base = 640;
      silFill(g, M, 1); g.fillRect(x - w / 2, base - h, w, h); g.beginPath(); g.moveTo(x - w / 2, base - h); g.lineTo(x, base - h - 90); g.lineTo(x + w / 2, base - h); g.closePath(); g.fill();
      g.beginPath(); g.rect(x - w / 2, base - h, w, h); rimLine(g, M, 0.25);
      addLights(L, x - w / 2 + 8, base - h + 20, w - 16, h - 40, 16, r, '#3ef0ff', 0.15);
      for (let k = 0; k < 3; k++) { const bx = x + 140 + k * 60, bh = 140 + r() * 140; silFill(g, M, 0); g.fillRect(bx, base - bh, 50, bh); }
    }
  },
  plain(g, TW, H, M, r, L) { // 焦土平原：远处的战争机器和烟柱
    silFill(g, M, 0); g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= TW; x += 60) g.lineTo(x, 560 + Math.sin(x / 140) * 20 + r() * 20); g.lineTo(TW, H); g.closePath(); g.fill();
    for (let i = 0; i < 6; i++) {
      const x = 120 + i * 260 + r() * 60, y = 560; silFill(g, M, 1);
      g.fillRect(x - 60, y - 40, 120, 40); g.fillRect(x - 20, y - 70, 50, 30); g.fillRect(x + 20, y - 62, 80, 8);
      const sm = g.createLinearGradient(0, y - 360, 0, y - 60); sm.addColorStop(0, 'rgba(60,20,20,0)'); sm.addColorStop(1, 'rgba(60,20,20,0.35)'); g.fillStyle = sm; g.beginPath(); g.ellipse(x - 30, y - 200, 40, 160, 0.1, 0, TAU); g.fill();
      L.push({ x: x + 96, y: y - 60, w: 4, h: 4, f: 1.4 + r(), p: r() * 9, c: '#ff9a40' });
    }
  },
  artillery(g, TW, H, M, r, L) { // 炮兵阵地：一排斜指天空的炮管
    silFill(g, M, 0); g.fillRect(0, 580, TW, H - 580);
    for (let i = 0; i < 10; i++) {
      const x = 60 + i * 160 + r() * 40, y = 580, a = -0.6 - r() * 0.4, len = 120 + r() * 80;
      g.save(); g.translate(x, y - 20); g.rotate(a); silFill(g, M, 1); g.fillRect(0, -7, len, 14); g.fillRect(len - 10, -10, 16, 20); g.restore();
      silFill(g, M, 0); g.fillRect(x - 40, y - 30, 80, 30);
      L.push({ x: x + Math.cos(a) * len, y: y - 20 + Math.sin(a) * len, w: 5, h: 5, f: 0.4 + r() * 0.5, p: r() * 9, c: '#ffd27a', a: 0.7 });
    }
  },
  fortress(g, TW, H, M, r, L) { // 熔炉要塞：烟囱和熔炉的门
    for (let i = 0; i < 7; i++) {
      const x = 80 + i * 230 + r() * 40, w = 90, h = 200 + r() * 160, base = 620;
      silFill(g, M, i % 2); g.fillRect(x - w / 2, base - h, w, h); g.fillRect(x - 12, base - h - 80, 24, 80);
      g.fillStyle = 'rgba(255,110,40,0.28)'; g.beginPath(); g.arc(x, base - 40, 22, Math.PI, 0); g.fill(); g.fillRect(x - 22, base - 40, 44, 40);
      L.push({ x: x - 3, y: base - h - 86, w: 6, h: 4, f: 2 + r(), p: r() * 9, c: '#ff7a3a' });
    }
  },
  corridor(g, TW, H, M, r, L) { // 无声回廊：一排拱门
    for (let i = 0; i < 10; i++) {
      const x = i * 165, base = 640, h = 380;
      silFill(g, M, i % 2); g.fillRect(x, base - h, 26, h); g.beginPath(); g.moveTo(x, base - h); g.quadraticCurveTo(x + 82, base - h - 120, x + 165, base - h); g.lineTo(x + 165, base - h + 18); g.quadraticCurveTo(x + 82, base - h - 100, x, base - h + 18); g.closePath(); g.fill();
      L.push({ x: x + 10, y: base - h + 60, w: 6, h: 10, f: 0.3, p: r() * 9, c: '#d6b8ff', a: 0.5 });
    }
  },
  organ(g, TW, H, M, r, L) { // 唱诗大厅：一面管风琴
    for (let x = 0; x < TW; x += 34) {
      const h = 200 + Math.abs(Math.sin(x / 120)) * 260 + r() * 30, base = 640; silFill(g, M, (x / 34) % 2 === 0);
      g.fillRect(x, base - h, 26, h); g.beginPath(); g.arc(x + 13, base - h, 13, Math.PI, 0); g.fill();
      g.fillStyle = 'rgba(214,184,255,0.12)'; g.fillRect(x + 6, base - h + 30, 14, 6);
    }
  },
  altar(g, TW, H, M, r, L) { // 祭坛：破碎的信号盘
    for (let i = 0; i < 3; i++) {
      const x = 260 + i * 560, y = 520; silFill(g, M, 0);
      g.beginPath(); g.ellipse(x, y - 140, 150, 60, -0.4, 0, Math.PI); g.lineTo(x - 140, y - 150); g.closePath(); g.fill();
      g.fillRect(x - 10, y - 140, 20, 140); g.fillRect(x - 70, y - 10, 140, 20);
      g.save(); g.strokeStyle = M.rim; g.globalAlpha = 0.3; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y - 140, 150, 60, -0.4, 0.2, Math.PI - 0.6); g.stroke(); g.restore();
      L.push({ x: x - 3, y: y - 150, w: 6, h: 6, f: 0.6, p: i, c: '#b98aff' });
    }
  },
};
/* ---------- 中景：更近的东西（慢慢飘过，少量呼吸的灯） ---------- */
const SPACE_MID = {
  debris(g, TW, H, M, r, L) {
    for (let i = 0; i < 9; i++) {
      const x = 80 + i * 180 + r() * 60, y = 520 + r() * 120, s = 24 + r() * 40;
      g.fillStyle = M.sil2; g.save(); g.translate(x, y); g.rotate(r() * TAU); g.beginPath(); g.moveTo(-s, -s * 0.4); g.lineTo(s * 0.6, -s * 0.7); g.lineTo(s, s * 0.2); g.lineTo(-s * 0.2, s * 0.6); g.closePath(); g.fill();
      g.globalAlpha = 0.35; g.strokeStyle = M.rim; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-s, -s * 0.4); g.lineTo(s * 0.6, -s * 0.7); g.stroke(); g.restore();
      if (r() < 0.4) L.push({ x, y, r: 10, f: 1.5 + r(), p: r() * 9, c: 'rgba(255,170,90,0.9)' });
    }
  },
  girders(g, TW, H, M, r, L) {
    for (let i = 0; i < 5; i++) {
      const x = 100 + i * 330 + r() * 80, y = 600 + r() * 60, len = 200 + r() * 120, a = -0.2 + r() * 0.4;
      g.save(); g.translate(x, y); g.rotate(a); g.strokeStyle = M.sil2; g.lineWidth = 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.moveTo(0, 18); g.lineTo(len, 18); g.stroke();
      g.lineWidth = 3; for (let k = 0; k < len; k += 24) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 24, 18); g.stroke(); } g.restore();
      L.push({ x: x + len * 0.8, y: y - 6, r: 8, f: 2.5, p: r() * 9, c: 'rgba(255,90,80,0.9)' });
    }
  },
  shards(g, TW, H, M, r, L) {
    for (let i = 0; i < 12; i++) {
      const x = r() * TW, y = 560 + r() * 120, s = 20 + r() * 40;
      g.fillStyle = M.sil2; g.beginPath(); g.moveTo(x, y - s * 1.6); g.lineTo(x + s * 0.4, y); g.lineTo(x - s * 0.4, y); g.closePath(); g.fill();
      g.save(); g.globalAlpha = 0.4; g.strokeStyle = M.rim; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y - s * 1.6); g.lineTo(x + s * 0.4, y); g.stroke(); g.restore();
      if (r() < 0.35) L.push({ x, y: y - s, r: 12, f: 0.8 + r(), p: r() * 9, c: 'rgba(160,230,255,0.9)' });
    }
  },
  signs(g, TW, H, M, r, L) {
    for (let i = 0; i < 6; i++) {
      const x = 80 + i * 270 + r() * 60, y = 560 + r() * 60, w = 90 + r() * 50;
      g.fillStyle = M.sil2; g.fillRect(x - 3, y, 6, 160); g.fillRect(x - w / 2, y - 40, w, 40);
      const c = r() < 0.5 ? 'rgba(255,79,216,0.9)' : 'rgba(62,240,255,0.9)';
      g.save(); g.globalAlpha = 0.45; g.strokeStyle = c; g.lineWidth = 2; g.strokeRect(x - w / 2 + 5, y - 35, w - 10, 30); g.restore();
      L.push({ x, y: y - 20, r: 26, f: 3 + r() * 2, p: r() * 9, c });
    }
  },
  cables(g, TW, H, M, r, L) {
    g.strokeStyle = M.sil2; g.lineWidth = 4;
    for (let i = 0; i < 8; i++) { const x = r() * TW, y = 580 + r() * 60; g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + 100, y - 120, x + 220, H); g.stroke(); L.push({ x: x + 110, y: y - 64, r: 9, f: 4, p: r() * 9, c: 'rgba(62,240,255,0.9)' }); }
  },
  wrecks(g, TW, H, M, r, L) {
    for (let i = 0; i < 6; i++) {
      const x = 80 + i * 280 + r() * 60, y = 640; g.fillStyle = M.sil2;
      g.fillRect(x - 50, y - 26, 100, 26); g.fillRect(x - 16, y - 46, 40, 20); g.save(); g.translate(x + 20, y - 40); g.rotate(-0.3 - r() * 0.5); g.fillRect(0, -4, 70, 8); g.restore();
      L.push({ x: x - 20, y: y - 20, r: 14, f: 1.2 + r(), p: r() * 9, c: 'rgba(255,110,40,0.9)' });
    }
  },
  stacks(g, TW, H, M, r, L) {
    for (let i = 0; i < 6; i++) { const x = 100 + i * 270 + r() * 60, y = 680, h = 120 + r() * 60; g.fillStyle = M.sil2; g.fillRect(x - 14, y - h, 28, h); g.fillRect(x - 22, y - h, 44, 10); L.push({ x, y: y - h - 6, r: 16, f: 2, p: r() * 9, c: 'rgba(255,120,40,0.9)' }); }
  },
  pillars(g, TW, H, M, r, L) {
    for (let i = 0; i < 7; i++) { const x = 60 + i * 230 + r() * 40, y = 690, h = 200 + r() * 80; g.fillStyle = M.sil2; g.fillRect(x - 16, y - h, 32, h); g.fillRect(x - 24, y - h, 48, 12); L.push({ x, y: y - h - 14, r: 12, f: 0.6, p: r() * 9, c: 'rgba(200,160,255,0.9)' }); }
  },
  dishes(g, TW, H, M, r, L) {
    for (let i = 0; i < 5; i++) { const x = 120 + i * 330 + r() * 60, y = 650; g.fillStyle = M.sil2; g.fillRect(x - 4, y - 70, 8, 70); g.beginPath(); g.ellipse(x, y - 80, 50, 18, -0.5, 0, Math.PI); g.fill(); L.push({ x, y: y - 90, r: 10, f: 0.5, p: r() * 9, c: 'rgba(200,160,255,0.9)' }); }
  },
};
