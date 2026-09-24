'use strict';
/* 梦潮回声航线 — procedural Q版 hand-drawn art: deep blue-purple lines (never pure black),
   three-layer colouring (base / one soft shadow / dream highlight), soft glow, paper grain. */

const PAL = {
  ink: '#2d2358', inkSoft: '#4a3d82', body: '#fff6ee', bodyShade: '#c6bae6', blush: 'rgba(255,128,160,0.45)',
  lamp: '#ffcf4a', lampCore: '#fff6c8', lampDark: '#d9962c', cyan: '#6ff0ff', lav: '#c9a8ff', coral: '#ff7a6b',
  pink: '#ff7eb6', blue: '#5fd4ff', gold: '#ffd54a', purple: '#b58cff', white: '#ffffff',
};

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

/* ---------- glow sprites (additive, cached) ---------- */
const _glow = {};
function glowSprite(color, r = 32) {
  const k = color + r;
  if (_glow[k]) return _glow[k];
  const c = makeCanvas(r * 2, r * 2), g = c.getContext('2d');
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, color); gr.addColorStop(0.35, color.replace(/[\d.]+\)$/, (m) => (parseFloat(m) * 0.45).toFixed(3) + ')'));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
  return (_glow[k] = c);
}
function drawGlow(g, x, y, radius, color, alpha = 1) {
  const s = glowSprite(color, 32);
  g.globalAlpha = alpha; g.drawImage(s, x - radius, y - radius, radius * 2, radius * 2); g.globalAlpha = 1;
}
const GLOW = { gold: 'rgba(255,207,74,0.9)', cyan: 'rgba(111,240,255,0.85)', pink: 'rgba(255,126,182,0.8)', purple: 'rgba(181,140,255,0.8)', white: 'rgba(255,255,255,0.9)', coral: 'rgba(255,122,107,0.85)', lav: 'rgba(201,168,255,0.8)', blue: 'rgba(95,212,255,0.85)' };

/* ---------- paper grain (procedural, also used by CSS panels) ---------- */
let PAPER = null;
function makePaper() {
  if (PAPER) return PAPER;
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const rnd = mulberry32(77);
  const grid = (n) => { const a = []; for (let i = 0; i < n * n; i++) a.push(rnd()); return a; };
  const g1 = grid(8), g2 = grid(32);
  const sample = (gr, n, x, y) => {
    const fx = (x / S) * n, fy = (y / S) * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (i, j) => gr[((j + n) % n) * n + ((i + n) % n)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return lerp(lerp(at(x0, y0), at(x0 + 1, y0), sx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx), sy);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 128 + (sample(g1, 8, x, y) - 0.5) * 34 + (sample(g2, 32, x, y) - 0.5) * 26 + (rnd() - 0.5) * 22;
    const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = clamp(v, 0, 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // fibres
  g.globalAlpha = 0.18; g.lineWidth = 0.6;
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * TAU, l = 6 + rnd() * 22;
    g.strokeStyle = rnd() < 0.5 ? '#ffffff' : '#555555';
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.4) * l * 0.5, y + Math.sin(a + 0.4) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.globalAlpha = 1;
  PAPER = c;
  return c;
}

/* ---------- bullet sprites (pre-rendered at 2x) ---------- */
const BulletArt = (() => {
  const cache = {};
  function star(g, cx, cy, spikes, outer, inner, rot = -Math.PI / 2) {
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner, a = rot + (i * Math.PI) / spikes;
      g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
  }
  function build(type, cb) {
    const D = 40, K = 2, c = makeCanvas(D * K, D * K), g = c.getContext('2d');
    g.scale(K, K); g.translate(D / 2, D / 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (type === 'pink') {
      g.drawImage(glowSprite('rgba(255,126,182,0.55)'), -17, -17, 34, 34);
      const gr = g.createRadialGradient(-2.5, -3, 1, 0, 0, 9);
      gr.addColorStop(0, '#fff2f8'); gr.addColorStop(0.45, '#ff9cc9'); gr.addColorStop(1, '#ff4f9a');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 8.6, 0, TAU); g.fill();
      g.strokeStyle = '#b8327a'; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(-3, -3.4, 2.4, 1.6, -0.6, 0, TAU); g.fill();
      if (cb) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, 4, 0, TAU); g.stroke(); }
    } else if (type === 'blue') {
      g.drawImage(glowSprite('rgba(95,212,255,0.55)'), -18, -18, 36, 36);
      const gr = g.createLinearGradient(0, -12, 0, 12);
      gr.addColorStop(0, '#d6f7ff'); gr.addColorStop(0.5, '#4fc3ff'); gr.addColorStop(1, '#1f7fe0');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -12.5); g.lineTo(8, 0); g.lineTo(0, 12.5); g.lineTo(-8, 0); g.closePath(); g.fill();
      g.strokeStyle = '#1a5fb0'; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = '#eafcff'; g.beginPath(); g.moveTo(0, -6); g.lineTo(3.6, 0); g.lineTo(0, 6); g.lineTo(-3.6, 0); g.closePath(); g.fill();
      if (cb) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(-5, 7); g.lineTo(5, -7); g.stroke(); }
    } else if (type === 'gold') {
      g.drawImage(glowSprite('rgba(255,213,74,0.7)'), -20, -20, 40, 40);
      star(g, 0, 0, 4, 13, 4.6);
      const gr = g.createRadialGradient(0, 0, 1, 0, 0, 13);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, '#fff3b0'); gr.addColorStop(0.7, '#ffd54a'); gr.addColorStop(1, '#f0a52a');
      g.fillStyle = gr; g.fill(); g.strokeStyle = '#b86e14'; g.lineWidth = 1.5; g.stroke();
      star(g, 0, 0, 4, 6.5, 2.6, -Math.PI / 4); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fill();
      if (cb) { g.setLineDash([2.5, 2.5]); g.strokeStyle = '#ffffff'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, 16, 0, TAU); g.stroke(); g.setLineDash([]); }
    } else if (type === 'white') {
      g.drawImage(glowSprite('rgba(200,230,255,0.6)'), -16, -9, 32, 18);
      g.fillStyle = '#ffffff'; g.strokeStyle = '#8fb9ff'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-12, 0); g.quadraticCurveTo(-12, -2.6, -6, -2.6); g.lineTo(9, -2.2); g.quadraticCurveTo(13, 0, 9, 2.2); g.lineTo(-6, 2.6); g.quadraticCurveTo(-12, 2.6, -12, 0); g.fill(); g.stroke();
      if (cb) { g.fillStyle = '#3a5aa8'; g.fillRect(-5, -2.2, 1.6, 4.4); g.fillRect(1, -2.2, 1.6, 4.4); }
    } else if (type === 'purple') {
      g.drawImage(glowSprite('rgba(181,140,255,0.45)'), -18, -18, 36, 36);
      g.fillStyle = 'rgba(181,140,255,0.28)'; g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.fill();
      g.strokeStyle = '#e2d2ff'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 7.5, -2.5, -1.4); g.stroke();
      if (cb) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-4, 0); g.lineTo(4, 0); g.moveTo(0, -4); g.lineTo(0, 4); g.stroke(); }
    } else if (type === 'needleShot') {
      g.drawImage(glowSprite('rgba(111,240,255,0.5)'), -18, -7, 30, 14);
      const gr = g.createLinearGradient(-16, 0, 12, 0);
      gr.addColorStop(0, 'rgba(111,240,255,0)'); gr.addColorStop(0.6, '#bff8ff'); gr.addColorStop(1, '#ffffff');
      g.fillStyle = gr; g.beginPath(); g.moveTo(-16, 0); g.lineTo(6, -2.4); g.lineTo(13, 0); g.lineTo(6, 2.4); g.closePath(); g.fill();
      g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(9, 0, 1.8, 0, TAU); g.fill();
    } else if (type === 'crescent') {
      g.drawImage(glowSprite('rgba(111,240,255,0.5)'), -19, -19, 38, 38);
      const gr = g.createLinearGradient(-6, -16, 10, 16); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#9ff4ff'); gr.addColorStop(1, '#b89cff');
      g.fillStyle = gr; g.beginPath(); g.arc(-6, 0, 17, -1.25, 1.25); g.arc(-12, 0, 13, 1.1, -1.1, true); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.3; g.beginPath(); g.arc(-6, 0, 17, -1.1, 1.1); g.stroke();
    } else if (type === 'shard') {
      g.drawImage(glowSprite('rgba(255,207,74,0.5)'), -12, -12, 24, 24);
      const gr = g.createLinearGradient(-6, 0, 7, 0); gr.addColorStop(0, '#6ff0ff'); gr.addColorStop(1, '#ffe38a');
      g.fillStyle = gr; g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, -4.5); g.lineTo(-3, 0); g.lineTo(-5, 4.5); g.closePath(); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.stroke();
    } else if (type === 'note' || type === 'noteBig') {
      const big = type === 'noteBig', s = big ? 1.35 : 1;
      g.drawImage(glowSprite('rgba(255,207,74,0.7)'), -18 * s, -18 * s, 36 * s, 36 * s);
      g.scale(s, s);
      g.fillStyle = big ? '#ffffff' : '#ffe38a'; g.strokeStyle = '#b86e14'; g.lineWidth = 1.3;
      g.beginPath(); g.ellipse(-3, 5, 5, 3.8, -0.4, 0, TAU); g.fill(); g.stroke();
      g.fillRect(1.2, -9, 2, 14); g.strokeRect(1.2, -9, 2, 14);
      g.beginPath(); g.moveTo(3.2, -9); g.quadraticCurveTo(10, -7, 8, -1); g.quadraticCurveTo(8, -5, 3.2, -5); g.closePath(); g.fill(); g.stroke();
    } else if (type === 'bellNote') {
      g.drawImage(glowSprite('rgba(201,168,255,0.7)'), -16, -16, 32, 32);
      g.fillStyle = '#e8dcff'; g.strokeStyle = '#6a4fc0'; g.lineWidth = 1.3;
      g.beginPath(); g.ellipse(-2, 4, 4.6, 3.6, -0.4, 0, TAU); g.fill(); g.stroke();
      g.fillRect(1.6, -8, 1.8, 12); g.strokeRect(1.6, -8, 1.8, 12);
    } else if (type === 'echo') {
      g.drawImage(glowSprite('rgba(201,168,255,0.5)'), -15, -15, 30, 30);
      g.strokeStyle = 'rgba(230,215,255,0.95)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 6.5, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(201,168,255,0.5)'; g.beginPath(); g.arc(0, 0, 4, 0, TAU); g.fill();
    }
    return c;
  }
  return {
    get(type, cb) { const k = type + (cb ? '+' : ''); return cache[k] || (cache[k] = build(type, cb)); },
    draw(g, type, x, y, rot, scale = 1, cb = false) {
      const c = this.get(type, cb), s = 20 * scale;
      if (rot) { g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(c, -s, -s, s * 2, s * 2); g.restore(); }
      else g.drawImage(c, x - s, y - s, s * 2, s * 2);
    },
    star,
  };
})();

/* ---------- shared face helpers ---------- */
function eyePair(g, x, y, gap, rx, ry, o = {}) {
  const look = o.look || 0, lookY = o.lookY || 0;
  for (const side of [-1, 1]) {
    const ex = x + side * gap;
    if (o.closed) { // happy closed ^ ^ or sleepy – –
      g.strokeStyle = PAL.ink; g.lineWidth = o.lw || 1.8; g.beginPath();
      if (o.closed === 'happy') { g.moveTo(ex - rx, y + 1); g.quadraticCurveTo(ex, y - ry * 1.1, ex + rx, y + 1); }
      else { g.moveTo(ex - rx, y); g.lineTo(ex + rx, y); }
      g.stroke(); continue;
    }
    if (o.x) { // hurt > <
      g.strokeStyle = PAL.ink; g.lineWidth = o.lw || 1.9; g.beginPath();
      g.moveTo(ex - rx * side, y - ry * 0.7); g.lineTo(ex + rx * 0.7 * side, y); g.lineTo(ex - rx * side, y + ry * 0.7); g.stroke(); continue;
    }
    if (o.stars) {
      g.fillStyle = PAL.gold; BulletArt.star(g, ex, y, 4, ry * 1.2, ry * 0.45); g.fill();
      g.strokeStyle = PAL.ink; g.lineWidth = 1; g.stroke(); continue;
    }
    g.fillStyle = o.color || PAL.ink;
    g.beginPath(); g.ellipse(ex + look, y + lookY, rx, ry * (o.squint || 1), 0, 0, TAU); g.fill();
    const hs = o.small ? 0.6 : 1;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(ex + look - rx * 0.32, y + lookY - ry * 0.38 * (o.squint || 1), rx * 0.42 * hs, 0, TAU); g.fill();
    g.beginPath(); g.arc(ex + look + rx * 0.3, y + lookY + ry * 0.35 * (o.squint || 1), rx * 0.2 * hs, 0, TAU); g.fill();
    if (o.bright) { g.fillStyle = 'rgba(111,240,255,0.55)'; g.beginPath(); g.arc(ex + look, y + lookY + ry * 0.4, rx * 0.35, 0, TAU); g.fill(); }
  }
}
function blush(g, x, y, gap, r) {
  g.fillStyle = PAL.blush;
  g.beginPath(); g.arc(x - gap, y, r, 0, TAU); g.arc(x + gap, y, r, 0, TAU); g.fill();
}

/* ---------- the dream-lantern creature (主角) ---------- */
function bodyPath(g) {
  g.beginPath();
  g.moveTo(0, -21);
  g.bezierCurveTo(13, -21, 21, -10, 21, 2);
  g.bezierCurveTo(21, 13, 12, 17, 0, 17);
  g.bezierCurveTo(-12, 17, -21, 13, -21, 2);
  g.bezierCurveTo(-21, -10, -13, -21, 0, -21);
  g.closePath();
}
function drawPlayer(g, p, t, o = {}) {
  const face = p.face || 'idle', lamp = p.lamp === undefined ? 1 : p.lamp;
  g.save();
  g.translate(p.x, p.y);
  if (p.scale) g.scale(p.scale, p.scale);
  if (p.alpha !== undefined) g.globalAlpha = p.alpha;
  const bob = o.noBob ? 0 : Math.sin(t * 3.1 + (p.phase || 0)) * 2;
  let jx = 0, jy = bob;
  if (face === 'low') { jx += Math.sin(t * 37) * 0.7; }
  if (p.hurtT > 0) jx += Math.sin(t * 80) * 2 * p.hurtT; // visual only: collision point never moves
  g.translate(jx, jy);
  g.rotate((p.lean || 0) * 0.2);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const wave = Math.sin(t * 6 + (p.phase || 0));

  // dream mist ring
  if (!o.noMist) {
    g.globalAlpha *= 0.8;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + t * 0.9;
      g.fillStyle = i % 2 ? 'rgba(201,168,255,0.35)' : 'rgba(170,220,255,0.3)';
      g.beginPath(); g.ellipse(Math.cos(a) * 13, 21 + Math.sin(a) * 2.2, 8, 3.8, 0, 0, TAU); g.fill();
    }
    g.globalAlpha = p.alpha !== undefined ? p.alpha : 1;
  }
  // cape tail (披风尾巴) flowing behind
  const tail = (p.tail || 0) + wave * 3;
  const cg = g.createLinearGradient(-40, 0, -8, 0); cg.addColorStop(0, '#8ff0ff'); cg.addColorStop(1, '#b9a2ff');
  g.fillStyle = cg; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-14, -6);
  g.bezierCurveTo(-26, -8 + tail * 0.3, -34, -2 + tail, -41, 4 + tail);
  g.bezierCurveTo(-33, 6 + tail * 0.6, -28, 12, -15, 12);
  g.closePath(); g.fill(); g.stroke();
  // ear ribbons (飘带)
  for (const side of [-1, 1]) {
    const bx = side * 11, by = -17, sw = Math.sin(t * 5 + side) * 4 + (p.tail || 0) * 0.4;
    g.fillStyle = side < 0 ? '#c9a8ff' : '#aee9ff';
    g.beginPath(); g.moveTo(bx - 4, by + 2);
    g.quadraticCurveTo(bx - 14 + sw, by - 14, bx - 22 + sw, by - 8 + sw * 0.4);
    g.quadraticCurveTo(bx - 12, by - 4, bx + 3, by + 1);
    g.closePath(); g.fill(); g.stroke();
  }
  // feet
  g.fillStyle = '#efe7ff'; g.lineWidth = 2;
  for (const side of [-1, 1]) { g.beginPath(); g.ellipse(side * 8 + (face === 'move' ? side * wave * 1.5 : 0), 17, 6, 4, 0, 0, TAU); g.fill(); g.stroke(); }
  // body fill + shading (one soft shadow + dream highlight)
  bodyPath(g); g.fillStyle = PAL.body; g.fill();
  g.save(); bodyPath(g); g.clip();
  const sh = g.createLinearGradient(14, -20, -14, 18);
  sh.addColorStop(0, 'rgba(255,236,190,0.55)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(160,145,210,0.75)');
  g.fillStyle = sh; g.fillRect(-24, -24, 48, 44);
  g.fillStyle = 'rgba(180,165,225,0.55)'; g.beginPath(); g.ellipse(-8, 15, 20, 9, 0.2, 0, TAU); g.fill();
  if (p.hurtT > 0 || face === 'hurt') { g.fillStyle = `rgba(255,122,107,${0.55 * Math.max(p.hurtT || 0, face === 'hurt' ? 0.6 : 0)})`; g.fillRect(-24, -24, 48, 44); }
  if (p.frozen) { g.fillStyle = 'rgba(200,220,255,0.5)'; g.fillRect(-24, -24, 48, 44); }
  g.restore();
  g.lineWidth = 2.7; g.strokeStyle = PAL.ink; bodyPath(g); g.stroke();
  // rim highlight from the moon / lamp above-behind
  g.strokeStyle = 'rgba(111,240,255,0.7)'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, -1, 17.5, -1.9, -0.9); g.stroke();
  // arms
  const armUp = face === 'cut' || face === 'attack' || face === 'parry' ? 1 : 0;
  g.fillStyle = PAL.body; g.lineWidth = 2;
  g.beginPath(); g.ellipse(-20, 7, 5, 4, 0.5, 0, TAU); g.fill(); g.stroke();
  g.save(); g.translate(20, 6 - armUp * 5); g.rotate(-0.5 - armUp * 0.6);
  g.beginPath(); g.ellipse(0, 0, 5.5, 4, 0, 0, TAU); g.fill(); g.stroke(); g.restore();

  // face
  const ex = 3, ey = -4;
  if (face === 'win') { eyePair(g, ex, ey, 8, 4.4, 4.6, { closed: 'happy' }); }
  else if (face === 'lose' || face === 'sleep') { eyePair(g, ex, ey + 1, 8, 4, 4, { closed: 'line' }); }
  else if (face === 'hurt') { eyePair(g, ex, ey, 8, 4, 4.4, { x: true }); }
  else if (face === 'parry') { eyePair(g, ex, ey, 8, 4.4, 4.8, { stars: true }); }
  else {
    const blinkK = p.blink ? Math.max(0.1, 1 - p.blink) : 1;
    const look = clamp((p.vx || 0) / 220, -1, 1) * 1.4 + 0.6;
    eyePair(g, ex, ey, 8, 4.5, 5.6 * blinkK, {
      look, lookY: clamp((p.vy || 0) / 260, -1, 1) * 0.9,
      squint: face === 'move' ? 0.86 : face === 'cut' ? 0.78 : 1,
      small: face === 'low', bright: face === 'attack' || face === 'cut',
    });
    if (face === 'cut') { g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath(); g.moveTo(ex - 11, ey - 9); g.lineTo(ex - 5, ey - 7.5); g.moveTo(ex + 11, ey - 9); g.lineTo(ex + 5, ey - 7.5); g.stroke(); }
  }
  blush(g, ex, 3.5, 12.5, 3.3);
  g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath();
  if (face === 'parry') { g.fillStyle = '#ff8fa6'; g.ellipse(ex, 5.5, 2.4, 2.8, 0, 0, TAU); g.fill(); g.stroke(); }
  else if (face === 'win') { g.arc(ex, 3, 3.6, 0.15, Math.PI - 0.15); g.stroke(); }
  else if (face === 'hurt') { g.moveTo(ex - 3, 6); g.quadraticCurveTo(ex - 1.5, 4.5, ex, 6); g.quadraticCurveTo(ex + 1.5, 7.5, ex + 3, 6); g.stroke(); }
  else if (face === 'cut' || face === 'attack') { g.moveTo(ex - 2.2, 5.5); g.lineTo(ex + 2.2, 5.2); g.stroke(); }
  else if (face === 'lose' || face === 'sleep') { g.arc(ex, 5, 1.6, 0, TAU); g.stroke(); }
  else { g.arc(ex, 3.8, 2.4, 0.3, Math.PI - 0.3); g.stroke(); }
  if (face === 'low') { g.fillStyle = 'rgba(160,220,255,0.9)'; g.beginPath(); g.moveTo(16, -14); g.quadraticCurveTo(19, -9, 16, -7); g.quadraticCurveTo(13, -9, 16, -14); g.fill(); }

  // dream lamp on the head
  const sway = Math.sin(t * 2.4 + (p.phase || 0)) * 0.12 + (p.lean || 0) * 0.25;
  g.save(); g.translate(1, -20); g.rotate(sway);
  g.strokeStyle = PAL.ink; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-1, -9, 6, -12); g.stroke();
  const lx = 7, ly = -19, lit = face === 'lose' ? 0 : lamp;
  if (lit > 0.05 && !o.noGlow) {
    g.globalCompositeOperation = 'lighter';
    drawGlow(g, lx, ly, 20 + lit * 16 + (p.flash || 0) * 14, GLOW.gold, 0.5 * lit + (p.flash || 0) * 0.3);
    g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = PAL.lampDark; g.strokeStyle = PAL.ink; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(lx - 5, ly - 5); g.lineTo(lx + 5, ly - 5); g.lineTo(lx + 3, ly - 8); g.lineTo(lx - 3, ly - 8); g.closePath(); g.fill(); g.stroke();
  const lg = g.createRadialGradient(lx, ly, 0.5, lx, ly, 6);
  lg.addColorStop(0, lit > 0.05 ? '#ffffff' : '#8a80b0'); lg.addColorStop(0.5, lit > 0.05 ? PAL.lampCore : '#6f6596'); lg.addColorStop(1, lit > 0.05 ? PAL.lamp : '#5a507e');
  g.fillStyle = lg; g.beginPath();
  g.moveTo(lx - 5, ly - 5); g.lineTo(lx + 5, ly - 5); g.lineTo(lx + 6, ly); g.lineTo(lx + 5, ly + 5); g.lineTo(lx - 5, ly + 5); g.lineTo(lx - 6, ly); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(lx, ly - 5); g.lineTo(lx, ly + 5); g.stroke();
  g.fillStyle = PAL.lampDark; g.beginPath(); g.moveTo(lx - 4, ly + 5); g.lineTo(lx + 4, ly + 5); g.lineTo(lx, ly + 8.5); g.closePath(); g.fill(); g.stroke();
  g.restore();
  if (face === 'lose' || face === 'sleep') {
    g.fillStyle = 'rgba(230,220,255,0.9)'; g.font = '700 10px "Baloo 2", sans-serif';
    g.fillText('z', 18, -20 + Math.sin(t * 2) * 2); g.font = '700 7px "Baloo 2", sans-serif'; g.fillText('z', 24, -28 + Math.sin(t * 2 + 1) * 2);
  }
  g.restore();
}

/* ---------- enemies: cute shape + one abnormal behaviour ---------- */
const EnemyArt = {
  jelly(g, e, t) {
    const charge = e.charge || 0, w = Math.sin(t * 4 + e.seed);
    g.lineJoin = 'round'; g.lineCap = 'round';
    // tentacles
    g.strokeStyle = '#ff9fcf'; g.lineWidth = 2.6;
    for (let i = 0; i < 4; i++) {
      const x = -11 + i * 7.3;
      g.beginPath(); g.moveTo(x, 6); g.quadraticCurveTo(x + w * 4, 14, x - w * 2, 22 + (i % 2) * 3); g.stroke();
    }
    const gr = g.createLinearGradient(0, -18, 0, 8);
    gr.addColorStop(0, charge > 0 ? '#ffe3f1' : '#9fe3f0'); gr.addColorStop(1, '#8f7cf0');
    g.fillStyle = gr; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-18, 6); g.bezierCurveTo(-20, -14, -8, -20, 0, -20); g.bezierCurveTo(8, -20, 20, -14, 18, 6);
    g.quadraticCurveTo(12, 9, 6, 6); g.quadraticCurveTo(0, 9, -6, 6); g.quadraticCurveTo(-12, 9, -18, 6); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-8, -12, 5, 2.5, -0.5, 0, TAU); g.fill();
    if (charge > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, -4, 26, GLOW.pink, charge * 0.8); g.globalCompositeOperation = 'source-over'; }
    eyePair(g, -2, -5, 6, 2.6, 3.2, { look: -1 }); blush(g, -2, 0, 9, 2.2);
    g.strokeStyle = PAL.ink; g.lineWidth = 1.4; g.beginPath(); g.arc(-2, 1, 1.8, 0.2, Math.PI - 0.2); g.stroke();
  },
  boat(g, e, t) {
    const rock = Math.sin(t * 3 + e.seed) * 0.08;
    g.rotate(rock); g.lineJoin = 'round';
    // lantern on the mast
    g.globalCompositeOperation = 'lighter'; drawGlow(g, 2, -24, 16, GLOW.blue, 0.7); g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#dbe9ff'; g.strokeStyle = PAL.ink; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(1, -2); g.lineTo(1, -18); g.lineTo(-11, -4); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#b9d2ff'; g.beginPath(); g.moveTo(3, -2); g.lineTo(3, -15); g.lineTo(12, -4); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#9fe6ff'; g.beginPath(); g.arc(2, -23, 3.6, 0, TAU); g.fill(); g.stroke();
    // hull, bow pointing left (its travel direction)
    const hg = g.createLinearGradient(0, -2, 0, 12); hg.addColorStop(0, '#e6f0ff'); hg.addColorStop(1, '#9fb8ec');
    g.fillStyle = hg; g.beginPath(); g.moveTo(-24, -3); g.lineTo(22, -3); g.lineTo(14, 11); g.lineTo(-15, 11); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(45,35,88,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-8, -3); g.lineTo(-4, 11); g.moveTo(8, -3); g.lineTo(4, 11); g.stroke();
    eyePair(g, -2, 4, 6, 2.2, 2.6, { closed: e.charge > 0 ? null : 'line', look: -1 });
    blush(g, -2, 7, 9.5, 2);
  },
  tick(g, e, t) {
    const shake = e.charge > 0 ? Math.sin(t * 60) * 2.2 * e.charge : 0;
    g.translate(shake, 0); g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = PAL.ink; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-8, 15); g.lineTo(-11, 21); g.moveTo(8, 15); g.lineTo(11, 21); g.stroke();
    g.fillStyle = '#ffd08a';
    for (const s of [-1, 1]) { g.beginPath(); g.arc(s * 11, -15, 6, Math.PI, 0); g.closePath(); g.fill(); g.stroke(); }
    const bg = g.createRadialGradient(-5, -6, 2, 0, 0, 18); bg.addColorStop(0, '#ffc59a'); bg.addColorStop(1, '#ff8a5c');
    g.fillStyle = bg; g.beginPath(); g.arc(0, 1, 17, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = '#fff4ea'; g.beginPath(); g.arc(0, 1, 12, 0, TAU); g.fill(); g.lineWidth = 1.5; g.stroke();
    if (e.elite) { g.strokeStyle = '#ffcf4a'; g.lineWidth = 2; g.globalCompositeOperation = 'lighter'; g.beginPath(); g.moveTo(-12, -6); g.lineTo(-5, -1); g.lineTo(-8, 6); g.moveTo(9, -9); g.lineTo(4, 0); g.lineTo(10, 8); g.stroke(); g.globalCompositeOperation = 'source-over'; }
    eyePair(g, 0, -1, 5, 2.2, 2.8, { squint: e.charge > 0 ? 0.6 : 1 }); blush(g, 0, 4, 7.5, 1.8);
    g.strokeStyle = PAL.ink; g.lineWidth = 1.3; g.beginPath(); g.arc(0, 5, 1.6, 0, Math.PI); g.stroke();
    if (e.charge > 0) {
      g.strokeStyle = `rgba(255,236,190,${e.charge})`; g.lineWidth = 2;
      for (let i = 0; i < 3; i++) { const a = -2.2 + i * 0.35; g.beginPath(); g.moveTo(Math.cos(a) * 24, Math.sin(a) * 24); g.lineTo(Math.cos(a) * 31, Math.sin(a) * 31); g.stroke(); g.beginPath(); g.moveTo(-Math.cos(a) * 24, Math.sin(a) * 24); g.lineTo(-Math.cos(a) * 31, Math.sin(a) * 31); g.stroke(); }
    }
  },
  star(g, e, t) {
    const sw = Math.sin(t * 7 + e.seed) * 0.12;
    g.lineJoin = 'round';
    g.save(); g.translate(14, 0); g.rotate(sw); g.fillStyle = '#ffd54a'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-2, 0); g.lineTo(10, -8); g.lineTo(8, 0); g.lineTo(10, 8); g.closePath(); g.fill(); g.stroke(); g.restore();
    const sg = g.createRadialGradient(-4, -5, 2, 0, 0, 20); sg.addColorStop(0, '#b4c2ff'); sg.addColorStop(1, '#6f7cf0');
    g.fillStyle = sg; BulletArt.star(g, 0, 0, 5, 19, 10, Math.PI + sw); g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 2.3; g.stroke();
    for (let i = 0; i < 5; i++) { const a = Math.PI + sw + (i * TAU) / 5; g.fillStyle = '#ffe38a'; g.beginPath(); g.arc(Math.cos(a) * 15, Math.sin(a) * 15, 2.4, 0, TAU); g.fill(); }
    if (e.charge > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, -18, 0, 20, GLOW.gold, e.charge); g.globalCompositeOperation = 'source-over'; }
    if (e.elite) {
      for (const s of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(-2 + s * 6, -2, 4.4, 0, TAU); g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 1.4; g.stroke();
        g.fillStyle = '#ff6a8a'; g.beginPath(); g.arc(-3.2 + s * 6, -3, 1.6, 0, TAU); g.arc(-0.8 + s * 6, -0.8, 1.6, 0, TAU); g.fill(); }
    } else eyePair(g, -3, -2, 5.5, 2.4, 3, { look: -1 });
    blush(g, -3, 3, 8, 1.8);
  },
  moth(g, e, t) {
    const flap = Math.sin(t * 22 + e.seed);
    g.lineJoin = 'round';
    g.fillStyle = 'rgba(220,205,255,0.75)'; g.strokeStyle = PAL.ink; g.lineWidth = 1.8;
    for (const s of [-1, 1]) {
      g.save(); g.scale(1, 0.7 + flap * 0.3 * s);
      g.beginPath(); g.ellipse(-2, s * -13, 13, 9, s * 0.4, 0, TAU); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(6, s * -10, 8, 6, -s * 0.3, 0, TAU); g.fill(); g.stroke();
      g.restore();
    }
    const bg = g.createRadialGradient(-2, -2, 1, 0, 0, 11); bg.addColorStop(0, '#9f8cf5'); bg.addColorStop(1, '#5f4fc4');
    g.fillStyle = bg; g.beginPath(); g.ellipse(0, 0, 11, 9, 0, 0, TAU); g.fill(); g.lineWidth = 2; g.stroke();
    g.strokeStyle = PAL.ink; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-6, -7); g.quadraticCurveTo(-10, -16, -15, -15); g.moveTo(-2, -8); g.quadraticCurveTo(-3, -17, -7, -19); g.stroke();
    eyePair(g, -3, -1, 4, 2.6, 3, { look: -0.8 });
  },
  beacon(g, e, t) {
    const up = e.flip ? -1 : 1;
    g.scale(1, up); g.lineJoin = 'round';
    g.fillStyle = '#e9e2ff'; g.strokeStyle = PAL.ink; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-11, 26); g.lineTo(-7, -6); g.lineTo(7, -6); g.lineTo(11, 26); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#6f65c9'; g.fillRect(-9, 8, 18, 5); g.fillRect(-8.2, -1, 16.4, 4);
    g.fillStyle = '#4a3d92'; g.beginPath(); g.moveTo(-12, -6); g.lineTo(12, -6); g.lineTo(0, -16); g.closePath(); g.fill(); g.stroke();
    g.scale(1, up);
    const ey = -10 * up;
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, ey, 9, 7, 0, 0, TAU); g.fill(); g.stroke();
    const la = e.aim || Math.PI;
    g.fillStyle = e.charge > 0.5 ? '#ff7a6b' : PAL.ink; g.beginPath(); g.arc(Math.cos(la) * 3.5, ey + Math.sin(la) * 2.5, 3.4, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(Math.cos(la) * 3.5 - 1.2, ey + Math.sin(la) * 2.5 - 1.2, 1.1, 0, TAU); g.fill();
    if (e.charge > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, ey, 26, GLOW.white, e.charge * 0.7); g.globalCompositeOperation = 'source-over'; }
  },
  dummy(g, e, t) {
    g.lineJoin = 'round';
    g.strokeStyle = PAL.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 30); g.lineTo(0, 52); g.stroke();
    const rings = ['#fff4ea', '#ff9fcf', '#fff4ea', '#9fe3f0'];
    rings.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(0, 0, 34 - i * 8, 0, TAU); g.fill(); g.lineWidth = i ? 1.4 : 2.6; g.stroke(); });
    eyePair(g, 0, -2, 8, 3, 3.6, { closed: e.hitT > 0 ? 'happy' : null }); blush(g, 0, 5, 13, 3);
  },
  core(g, e, t) {
    const pulse = 1 + Math.sin(t * 3) * 0.06;
    g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 48 * pulse, GLOW.cyan, 0.55); g.globalCompositeOperation = 'source-over';
    g.lineJoin = 'round';
    g.fillStyle = '#e9fbff'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(0, -22 * pulse); g.lineTo(16, 0); g.lineTo(0, 22 * pulse); g.lineTo(-16, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#6ff0ff'; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 0); g.lineTo(0, 12); g.lineTo(-8, 0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,207,74,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 28, t, t + 4.2); g.stroke();
  },
};
EnemyArt.jellyE = (g, e, t) => {
  for (let i = 0; i < 3; i++) {
    const a = t * 1.6 + (i * TAU) / 3, x = Math.cos(a) * 30, y = Math.sin(a) * 24;
    g.fillStyle = 'rgba(190,240,255,0.85)'; g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 5.5, 0, TAU); g.fill(); g.stroke();
  }
  g.save(); g.scale(1.25, 1.25); EnemyArt.jelly(g, e, t);
  g.fillStyle = '#ffcf4a'; g.strokeStyle = PAL.ink; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(-8, -18); g.lineTo(-5, -26); g.lineTo(-1, -19); g.lineTo(3, -27); g.lineTo(6, -18); g.closePath(); g.fill(); g.stroke();
  g.restore();
};
EnemyArt.tickE = (g, e, t) => { g.save(); g.scale(1.35, 1.35); EnemyArt.tick(g, Object.assign({}, e, { elite: true }), t); g.restore(); };
EnemyArt.starE = (g, e, t) => { g.save(); g.scale(1.3, 1.3); EnemyArt.star(g, Object.assign({}, e, { elite: true }), t); g.restore(); };

/* ---------- 失控闹钟 (boss) ---------- */
const CLOCK_COLORS = {
  1: { rimA: '#8f8bff', rimB: '#5b55c9', face: '#ece8ff', mark: '#6b63d6', ribbon: '#8a6cff', accent: '#7ea0ff', eye: PAL.ink },
  2: { rimA: '#ffb07a', rimB: '#e2603e', face: '#fff1e6', mark: '#e0643e', ribbon: '#9b6cff', accent: '#ff6a4a', eye: '#5a2330' },
  3: { rimA: '#fff3c8', rimB: '#e2b24a', face: '#33235f', mark: '#ffe38a', ribbon: '#5b3aa8', accent: '#fff3c8', eye: '#ffffff' },
};
function drawClockBoss(g, b, t) {
  const C = CLOCK_COLORS[b.phase] || CLOCK_COLORS[1], R = 118;
  g.save(); g.translate(b.x, b.y);
  const hurt = b.hitFlash || 0;
  g.lineJoin = 'round'; g.lineCap = 'round';
  // purple ribbons flowing behind
  for (let i = 0; i < 3; i++) {
    const off = i * 1.3, dir = b.phase === 3 ? -1 : 1;
    g.fillStyle = i === 1 ? C.ribbon : 'rgba(155,120,255,0.55)'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(40, -30 + i * 30);
    for (let k = 1; k <= 6; k++) g.lineTo(40 + k * 26, -30 + i * 30 + Math.sin(t * 2 * dir + k * 0.8 + off) * 12 - k * 2);
    for (let k = 6; k >= 1; k--) g.lineTo(40 + k * 26, -18 + i * 30 + Math.sin(t * 2 * dir + k * 0.8 + off + 0.5) * 12 - k * 1.2);
    g.closePath(); g.fill(); g.stroke();
  }
  // afterimages (终章)
  if (b.phase === 3) {
    for (let i = 1; i <= 3; i++) {
      g.globalAlpha = 0.14 / i; g.strokeStyle = C.rimA; g.lineWidth = 8;
      g.beginPath(); g.arc(i * 16 + Math.sin(t * 3 + i) * 4, -i * 4, R, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // bells, hammer and hanging parts
  const ring = b.ringT > 0 ? Math.sin(t * 70) * 0.25 : 0;
  for (const s of [-1, 1]) {
    g.save(); g.translate(s * 70, -R + 6); g.rotate(s * 0.45 + ring * s);
    g.strokeStyle = PAL.ink; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 18); g.lineTo(0, 4); g.stroke();
    const bg = g.createLinearGradient(-20, -30, 20, 0); bg.addColorStop(0, C.rimA); bg.addColorStop(1, C.rimB);
    g.fillStyle = bg; g.lineWidth = 2.6; g.beginPath(); g.arc(0, -6, 26, Math.PI, 0); g.lineTo(26, 2); g.lineTo(-26, 2); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(-9, -16, 6, 3, -0.6, 0, TAU); g.fill();
    g.restore();
  }
  g.save(); g.translate(0, -R - 16); g.rotate(Math.sin(t * (b.ringT > 0 ? 40 : 1.5)) * (b.ringT > 0 ? 0.5 : 0.1));
  g.fillStyle = C.rimB; g.strokeStyle = PAL.ink; g.lineWidth = 2.2; g.fillRect(-2.5, -4, 5, 18); g.strokeRect(-2.5, -4, 5, 18);
  g.beginPath(); g.arc(0, -6, 7, 0, TAU); g.fill(); g.stroke(); g.restore();
  for (const s of [-1, 1]) {
    const sw = Math.sin(t * 1.8 + s) * 0.2;
    g.save(); g.translate(s * (R - 8), 44); g.rotate(sw);
    g.strokeStyle = PAL.inkSoft; g.lineWidth = 2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 52); g.stroke(); g.setLineDash([]);
    gear(g, 0, 60, 11, 8, t * s * 1.5, C.rimA);
    g.restore();
  }
  // main disc
  const rim = g.createLinearGradient(-R, -R, R, R); rim.addColorStop(0, C.rimA); rim.addColorStop(1, C.rimB);
  g.fillStyle = rim; g.strokeStyle = PAL.ink; g.lineWidth = 4;
  g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = C.face; g.lineWidth = 2.6; g.beginPath(); g.arc(0, 0, R - 16, 0, TAU); g.fill(); g.stroke();
  // soft shadow on the dial (moonlight from above-behind)
  g.save(); g.beginPath(); g.arc(0, 0, R - 17, 0, TAU); g.clip();
  const shd = g.createLinearGradient(0, -R, 0, R); shd.addColorStop(0, 'rgba(255,255,255,0.18)'); shd.addColorStop(0.6, 'rgba(255,255,255,0)'); shd.addColorStop(1, b.phase === 3 ? 'rgba(0,0,0,0.25)' : 'rgba(120,100,200,0.28)');
  g.fillStyle = shd; g.fillRect(-R, -R, R * 2, R * 2);
  // cracks & inner gears (第二乐章起)
  if (b.phase >= 2) {
    gear(g, -38, 34, 26, 12, t * 1.6, '#ffcf7a'); gear(g, 30, 42, 20, 10, -t * 2.2, '#ffb07a'); gear(g, 44, -30, 16, 9, t * 2.6, '#ffe596');
    g.strokeStyle = b.phase === 3 ? '#fff3c8' : '#c2412a'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-8, 4); g.lineTo(-40, 20); g.lineTo(-52, 52); g.moveTo(-40, 20); g.lineTo(-70, 16);
    g.moveTo(10, 6); g.lineTo(34, 30); g.lineTo(28, 62); g.moveTo(34, 30); g.lineTo(66, 34); g.moveTo(6, -6); g.lineTo(38, -28); g.lineTo(62, -40); g.stroke();
  }
  g.restore();
  // hour marks as little stars (instead of numbers)
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12 - Math.PI / 2, r = R - 28;
    g.fillStyle = C.mark;
    if (i % 3 === 0) { BulletArt.star(g, Math.cos(a) * r, Math.sin(a) * r, 4, 7, 2.6); g.fill(); }
    else { g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 2.8, 0, TAU); g.fill(); }
  }
  // face
  const eyeY = -34, mouthOpen = b.mouth || 0;
  if (b.phase === 3) {
    g.globalCompositeOperation = 'lighter'; drawGlow(g, -30, eyeY, 26, GLOW.white, 0.7); drawGlow(g, 30, eyeY, 26, GLOW.white, 0.7); g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#ffffff'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 30, eyeY, 9, 13, 0, 0, TAU); g.fill(); }
  } else {
    for (const s of [-1, 1]) {
      g.fillStyle = '#ffffff'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
      g.beginPath(); g.ellipse(s * 30, eyeY, 14, 16, 0, 0, TAU); g.fill(); g.stroke();
      const jitter = b.phase === 1 ? Math.sin(t * 13 + s) * 1.5 : 0;
      const px = s * 30 + Math.cos(b.lookA || Math.PI) * 5 + jitter, py = eyeY + Math.sin(b.lookA || Math.PI) * 5;
      g.fillStyle = C.eye; g.beginPath(); g.arc(px, py, 7.5, 0, TAU); g.fill();
      g.strokeStyle = C.accent; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, 4.5, t * 4, t * 4 + 4); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(px - 2.6, py - 3, 2.4, 0, TAU); g.fill();
      if (b.phase === 2) { g.strokeStyle = PAL.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(s * 16, eyeY - 20); g.lineTo(s * 42, eyeY - 14); g.stroke(); }
    }
  }
  blush(g, 0, eyeY + 16, 44, 7);
  g.strokeStyle = b.phase === 3 ? '#fff3c8' : PAL.ink; g.lineWidth = 2.4; g.fillStyle = '#ff8fa6';
  if (mouthOpen > 0.1) { g.beginPath(); g.ellipse(0, eyeY + 32, 12, 4 + mouthOpen * 9, 0, 0, TAU); g.fill(); g.stroke(); }
  else { g.beginPath(); for (let i = 0; i <= 6; i++) g.lineTo(-15 + i * 5, eyeY + 30 + (i % 2 ? -3 : 3)); g.stroke(); }
  // hands + emotional core (弱点)
  const handC = b.phase === 3 ? '#fff3c8' : PAL.ink;
  const minA = b.minA, hourA = b.hourA;
  g.lineCap = 'round';
  if (!b.hideMinute) { g.strokeStyle = handC; g.lineWidth = 7; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(minA) * (R - 30), Math.sin(minA) * (R - 30)); g.stroke();
    g.fillStyle = C.accent; g.beginPath(); g.arc(Math.cos(minA) * (R - 30), Math.sin(minA) * (R - 30), 6, 0, TAU); g.fill(); }
  g.strokeStyle = handC; g.lineWidth = 10; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(hourA) * (R - 60), Math.sin(hourA) * (R - 60)); g.stroke();
  const weak = b.weakT > 0, wr = 17 + (weak ? Math.sin(t * 18) * 3 : 0);
  if (weak) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 58, GLOW.white, 0.9); g.globalCompositeOperation = 'source-over'; }
  const cg = g.createRadialGradient(-4, -4, 1, 0, 0, wr);
  cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.5, weak ? '#ffffff' : C.accent); cg.addColorStop(1, weak ? '#e8f6ff' : C.rimB);
  g.fillStyle = cg; g.strokeStyle = weak ? '#ffffff' : PAL.ink; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, wr * 0.9); g.bezierCurveTo(-wr * 1.3, -wr * 0.1, -wr * 0.5, -wr * 1.1, 0, -wr * 0.35); g.bezierCurveTo(wr * 0.5, -wr * 1.1, wr * 1.3, -wr * 0.1, 0, wr * 0.9); g.closePath(); g.fill(); g.stroke();
  if (hurt > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = hurt * 0.35; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  // time shield (终章)
  if (b.shield > 0) {
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,243,200,${0.5 + Math.sin(t * 6) * 0.2})`; g.lineWidth = 6;
    for (let i = 0; i < 12; i++) { const a = t * 0.8 + (i * TAU) / 12; g.beginPath(); g.arc(0, 0, R + 18, a, a + 0.38); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
}
function gear(g, x, y, r, teeth, rot, color) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = color; g.strokeStyle = PAL.ink; g.lineWidth = 1.8; g.beginPath();
  for (let i = 0; i < teeth * 2; i++) { const a = (i * Math.PI) / teeth, rr = i % 2 ? r * 0.78 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = PAL.ink; g.beginPath(); g.arc(0, 0, r * 0.28, 0, TAU); g.fill();
  g.restore();
}

/* ---------- scenes: 失眠之海 (parallax), 梦灯大厅, 航海图 ---------- */
class SeaScene {
  constructor() {
    this.scroll = 0; this.t = 0; this.W = 0; this.H = 720; this.speed = 36; this.dir = 1; this.hold = 0;
    this.stars = []; const r = mulberry32(12);
    for (let i = 0; i < 140; i++) this.stars.push({ x: r() * 1600, y: r() * 420, s: 0.5 + r() * 1.4, p: r() * TAU });
    this.motes = []; for (let i = 0; i < 46; i++) this.motes.push({ x: r() * 1600, y: 80 + r() * 560, s: 1 + r() * 2.4, v: 12 + r() * 26, p: r() * TAU, paper: r() < 0.25 });
    this.boats = []; for (let i = 0; i < 6; i++) this.boats.push({ x: r() * 1600, y: 0.78 + r() * 0.16, s: 0.6 + r() * 0.5 });
    this.windows = [];
    this.build();
  }
  build() {
    const TW = 1600, H = 720, r = mulberry32(99);
    this.TW = TW;
    // far: clouds + distant floating islands with castles
    const far = makeCanvas(TW, H), g = far.getContext('2d');
    for (let i = 0; i < 16; i++) {
      const x = r() * TW, y = 60 + r() * 260, w = 160 + r() * 260, h = 30 + r() * 40;
      const gr = g.createRadialGradient(x, y, 4, x, y, w * 0.6); gr.addColorStop(0, 'rgba(150,130,230,0.2)'); gr.addColorStop(1, 'rgba(150,130,230,0)');
      for (const ox of [-TW, 0, TW]) { g.save(); g.translate(ox, 0); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, w * 0.6, h, 0, 0, TAU); g.fill(); g.restore(); }
    }
    this.windows = [];
    const island = (cx, cy, s, col, rim, store) => {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(cx - 70 * s, cy); g.quadraticCurveTo(cx - 40 * s, cy + 60 * s, cx, cy + 90 * s); g.quadraticCurveTo(cx + 44 * s, cy + 56 * s, cx + 74 * s, cy); g.closePath(); g.fill();
      const towers = 2 + Math.floor(r() * 3);
      for (let k = 0; k < towers; k++) {
        const tx = cx + (k - (towers - 1) / 2) * 34 * s, th = (50 + r() * 70) * s, tw = (16 + r() * 12) * s;
        g.fillRect(tx - tw / 2, cy - th, tw, th + 2);
        g.beginPath(); g.moveTo(tx - tw / 2 - 5 * s, cy - th); g.lineTo(tx, cy - th - (26 + r() * 20) * s); g.lineTo(tx + tw / 2 + 5 * s, cy - th); g.closePath(); g.fill();
        for (let w = 0; w < 3; w++) if (r() < 0.8) store.push({ x: tx - 2.5 * s, y: cy - th + (12 + w * 16) * s, w: 5 * s, h: 7 * s, on: r() < 0.5, t: r() * 6 });
      }
      g.fillStyle = rim; g.fillRect(cx - 70 * s, cy - 2, 144 * s, 3);
    };
    for (let i = 0; i < 5; i++) island(120 + i * 330 + r() * 80, 330 + r() * 70, 0.6 + r() * 0.35, 'rgba(58,48,122,0.9)', 'rgba(160,140,255,0.25)', this.windows);
    // bridges between some islands
    g.strokeStyle = 'rgba(70,60,140,0.8)'; g.lineWidth = 4;
    for (let i = 0; i < 3; i++) { const x = 250 + i * 480; g.beginPath(); g.moveTo(x, 360); g.quadraticCurveTo(x + 90, 400, x + 180, 355); g.stroke(); }
    this.far = far;
    // mid: closer islands, lantern strings
    const mid = makeCanvas(TW, H), m = mid.getContext('2d');
    this.lanterns = [];
    for (let i = 0; i < 4; i++) {
      const cx = 200 + i * 400 + r() * 60, cy = 470 + r() * 50, s = 0.9 + r() * 0.3, lh = i % 2 === 1;
      // rounded rock underside with three soft lobes and hanging roots
      const ug = m.createLinearGradient(0, cy, 0, cy + 90 * s); ug.addColorStop(0, 'rgba(72,60,150,0.98)'); ug.addColorStop(1, 'rgba(44,36,104,0.98)');
      m.fillStyle = ug; m.beginPath(); m.moveTo(cx - 92 * s, cy);
      m.bezierCurveTo(cx - 90 * s, cy + 34 * s, cx - 60 * s, cy + 44 * s, cx - 44 * s, cy + 40 * s);
      m.bezierCurveTo(cx - 34 * s, cy + 70 * s, cx - 4 * s, cy + 86 * s, cx + 8 * s, cy + 70 * s);
      m.bezierCurveTo(cx + 22 * s, cy + 84 * s, cx + 52 * s, cy + 66 * s, cx + 56 * s, cy + 42 * s);
      m.bezierCurveTo(cx + 80 * s, cy + 40 * s, cx + 94 * s, cy + 24 * s, cx + 92 * s, cy);
      m.closePath(); m.fill();
      m.strokeStyle = 'rgba(120,104,210,0.55)'; m.lineWidth = 1.6;
      for (let k = 0; k < 5; k++) { const vx = cx + (k - 2) * 30 * s; m.beginPath(); m.moveTo(vx, cy + 30 * s); m.quadraticCurveTo(vx + 6, cy + (60 + k * 6) * s, vx - 2, cy + (78 + (k % 3) * 12) * s); m.stroke(); }
      // grassy top with a moonlit rim
      m.fillStyle = 'rgba(104,90,196,1)'; m.beginPath(); m.ellipse(cx, cy, 94 * s, 12 * s, 0, 0, TAU); m.fill();
      m.strokeStyle = 'rgba(205,190,255,0.55)'; m.lineWidth = 2; m.beginPath(); m.ellipse(cx, cy - 1, 92 * s, 11 * s, 0, Math.PI * 1.05, Math.PI * 1.95); m.stroke();
      let h;
      if (lh) { // little lighthouse
        h = 96 * s; const bw = 26 * s, tw = 16 * s;
        m.fillStyle = 'rgba(116,100,206,1)'; m.beginPath(); m.moveTo(cx - bw / 2, cy); m.lineTo(cx - tw / 2, cy - h); m.lineTo(cx + tw / 2, cy - h); m.lineTo(cx + bw / 2, cy); m.closePath(); m.fill();
        m.fillStyle = 'rgba(78,64,160,1)'; for (let k = 1; k < 4; k++) { const yy = cy - (h * k) / 4, ww = lerp(bw, tw, k / 4); m.fillRect(cx - ww / 2, yy - 5 * s, ww, 7 * s); }
        m.fillStyle = 'rgba(255,214,130,0.9)'; m.fillRect(cx - 7 * s, cy - h - 14 * s, 14 * s, 13 * s);
        m.fillStyle = 'rgba(90,74,178,1)'; m.beginPath(); m.moveTo(cx - 12 * s, cy - h - 14 * s); m.lineTo(cx, cy - h - 30 * s); m.lineTo(cx + 12 * s, cy - h - 14 * s); m.closePath(); m.fill();
        h += 14 * s;
      } else { // cottage with a round warm window
        h = 58 * s; const hw = 46 * s, hx = cx - 8 * s;
        m.fillStyle = 'rgba(112,96,202,1)'; m.fillRect(hx - hw / 2, cy - h * 0.62, hw, h * 0.62);
        m.fillStyle = 'rgba(86,70,172,1)'; m.beginPath(); m.moveTo(hx - hw / 2 - 8 * s, cy - h * 0.6); m.quadraticCurveTo(hx - hw / 4, cy - h * 0.75, hx, cy - h * 1.15); m.quadraticCurveTo(hx + hw / 4, cy - h * 0.75, hx + hw / 2 + 8 * s, cy - h * 0.6); m.closePath(); m.fill();
        m.fillStyle = 'rgba(255,214,130,0.85)'; m.beginPath(); m.arc(hx, cy - h * 0.34, 8 * s, 0, TAU); m.fill();
        m.strokeStyle = 'rgba(78,64,160,1)'; m.lineWidth = 2; m.beginPath(); m.moveTo(hx - 8 * s, cy - h * 0.34); m.lineTo(hx + 8 * s, cy - h * 0.34); m.moveTo(hx, cy - h * 0.34 - 8 * s); m.lineTo(hx, cy - h * 0.34 + 8 * s); m.stroke();
        m.fillStyle = 'rgba(96,80,184,1)'; m.fillRect(hx + hw / 2 + 6 * s, cy - 22 * s, 16 * s, 22 * s);
        m.beginPath(); m.arc(hx + hw / 2 + 14 * s, cy - 22 * s, 8 * s, Math.PI, 0); m.fill();
        h = h * 1.1;
      }
      // lantern string towards the next island
      const nx = cx + 400, sag = 60;
      m.strokeStyle = 'rgba(40,32,90,0.9)'; m.lineWidth = 1.5; m.beginPath(); m.moveTo(cx + 20, cy - h + 10); m.quadraticCurveTo(cx + 200, cy - h + sag + 30, nx - 20, cy - h + 20); m.stroke();
      for (let k = 1; k < 8; k++) { const u = k / 8, x = lerp(cx + 20, nx - 20, u), y = (1 - u) * (1 - u) * (cy - h + 10) + 2 * (1 - u) * u * (cy - h + sag + 30) + u * u * (cy - h + 20); this.lanterns.push({ x: x % TW, y: y + 6, p: r() * TAU }); }
    }
    this.mid = mid;
  }
  update(dt) {
    this.t += dt;
    if (this.hold > 0) this.hold -= dt; else this.scroll += this.speed * this.dir * dt;
    for (const w of this.windows) { w.t -= dt; if (w.t <= 0) { w.on = !w.on; w.t = 1.5 + Math.random() * 6; } }
    for (const m of this.motes) { m.x -= m.v * this.dir * dt * (this.hold > 0 ? 0 : 1); if (m.x < -20) m.x += 1640; if (m.x > 1620) m.x -= 1640; }
  }
  layerX(k, W) { const TW = this.TW; let o = (this.scroll * k) % TW; if (o < 0) o += TW; return -o; }
  draw(g, W, H, o = {}) {
    const t = this.t;
    // sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#110c30'); sky.addColorStop(0.45, '#271f63'); sky.addColorStop(0.7, '#40358a'); sky.addColorStop(0.72, '#2b2470'); sky.addColorStop(1, '#171247');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // stars
    const sx = this.layerX(0.05, W);
    g.fillStyle = '#f2ecff';
    for (const s of this.stars) {
      const x = ((s.x + sx) % 1600 + 1600) % 1600;
      if (x > W) continue;
      g.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.7 + s.p); g.fillRect(x, s.y, s.s, s.s);
    }
    g.globalAlpha = 1;
    // moon + halo (kept soft so it never outshines bullets)
    const mx = W * 0.4, my = H * 0.2;
    g.globalCompositeOperation = 'lighter'; drawGlow(g, mx, my, 150, 'rgba(190,175,255,0.5)', 0.55); g.globalCompositeOperation = 'source-over';
    const mg = g.createRadialGradient(mx - 14, my - 14, 8, mx, my, 62); mg.addColorStop(0, '#f6f0ff'); mg.addColorStop(1, '#cfc2ff');
    g.fillStyle = mg; g.globalAlpha = 0.72; g.beginPath(); g.arc(mx, my, 60, 0, TAU); g.fill();
    g.fillStyle = 'rgba(170,150,235,0.45)'; for (const [cx, cy, cr] of [[-18, 8, 12], [16, -14, 8], [20, 18, 6], [-6, -24, 5]]) { g.beginPath(); g.arc(mx + cx, my + cy, cr, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    // far layer (25%)
    const fx = this.layerX(0.25, W);
    g.drawImage(this.far, fx, 0); g.drawImage(this.far, fx + this.TW, 0);
    for (const w of this.windows) {
      if (!w.on) continue;
      for (const off of [fx, fx + this.TW]) { const x = w.x + off; if (x < -10 || x > W + 10) continue; g.fillStyle = 'rgba(255,214,120,0.85)'; g.fillRect(x, w.y, w.w, w.h); }
    }
    // horizon fog
    const fog = g.createLinearGradient(0, H * 0.58, 0, H * 0.8);
    fog.addColorStop(0, 'rgba(160,140,240,0)'); fog.addColorStop(0.5, `rgba(160,140,240,${0.18 + Math.sin(t * 0.5) * 0.04})`); fog.addColorStop(1, 'rgba(160,140,240,0)');
    g.fillStyle = fog; g.fillRect(0, H * 0.58, W, H * 0.22);
    // glass sea: moon reflection + shimmer lines
    const seaY = H * 0.72;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const y = seaY + 6 + i * 12, w = 60 - i * 2.4 + Math.sin(t * 2 + i) * 10;
      g.fillStyle = `rgba(200,185,255,${0.16 - i * 0.008})`; g.fillRect(mx - w / 2 + Math.sin(t * 1.3 + i * 0.7) * 6, y, w, 2.2);
    }
    const shx = this.layerX(0.7, W);
    g.fillStyle = 'rgba(170,200,255,0.08)';
    for (let i = 0; i < 26; i++) { const x = ((i * 97 + shx * 1.0) % (W + 200) + W + 200) % (W + 200) - 100, y = seaY + 14 + ((i * 53) % 170); g.fillRect(x, y, 50 + (i % 4) * 20, 1.6); }
    g.globalCompositeOperation = 'source-over';
    // mid layer (60%)
    const mdx = this.layerX(0.6, W);
    g.drawImage(this.mid, mdx, 0); g.drawImage(this.mid, mdx + this.TW, 0);
    g.globalCompositeOperation = 'lighter';
    for (const l of this.lanterns) for (const off of [mdx, mdx + this.TW]) {
      const x = l.x + off; if (x < -20 || x > W + 20) continue;
      const y = l.y + Math.sin(t * 2 + l.p) * 2; drawGlow(g, x, y, 12, GLOW.gold, 0.55);
    }
    g.globalCompositeOperation = 'source-over';
    for (const l of this.lanterns) for (const off of [mdx, mdx + this.TW]) {
      const x = l.x + off; if (x < -20 || x > W + 20) continue;
      const y = l.y + Math.sin(t * 2 + l.p) * 2; g.fillStyle = '#ffcf6a'; g.fillRect(x - 2.5, y - 3, 5, 6);
    }
    // paper boats on the sea (70%)
    for (const b of this.boats) {
      const x = ((b.x + shx) % 1700 + 1700) % 1700 - 50; if (x > W + 40) continue;
      const y = H * b.y + Math.sin(t * 1.6 + b.x) * 2.5;
      g.save(); g.translate(x, y); g.scale(b.s, b.s); g.rotate(Math.sin(t * 1.4 + b.x) * 0.06);
      g.fillStyle = 'rgba(220,210,255,0.55)'; g.beginPath(); g.moveTo(-16, 0); g.lineTo(16, 0); g.lineTo(10, 8); g.lineTo(-10, 8); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -14); g.lineTo(-9, 0); g.closePath(); g.fill();
      g.restore();
    }
    // dream motes & paper fragments
    for (const m of this.motes) {
      const x = m.x % (W + 40), y = m.y + Math.sin(t + m.p) * 10;
      if (m.paper) { g.save(); g.translate(x, y); g.rotate(t * 0.8 + m.p); g.fillStyle = 'rgba(235,228,255,0.3)'; g.fillRect(-4, -3, 8, 6); g.restore(); }
      else { g.fillStyle = `rgba(201,168,255,${0.3 + 0.2 * Math.sin(t * 2 + m.p)})`; g.beginPath(); g.arc(x, y, m.s, 0, TAU); g.fill(); }
    }
    if (!o.noForeground) this.drawForeground(g, W, H);
  }
  drawForeground(g, W, H) {
    const t = this.t, fx = this.layerX(1.15, W);
    // bottom edge: reeds and lantern posts (high contrast boundary)
    g.fillStyle = '#100c2c';
    g.beginPath(); g.moveTo(0, H);
    for (let x = -40; x <= W + 60; x += 20) {
      const wx = x - (((fx % 40) + 40) % 40);
      const hgt = 12 + ((Math.floor((wx - fx) / 20) * 7919) % 13 + 13) % 13;
      g.lineTo(wx, H - hgt - Math.sin(t * 1.5 + wx * 0.05) * 2);
    }
    g.lineTo(W, H); g.closePath(); g.fill();
    for (let i = 0; i < 4; i++) {
      const x = ((i * 430 + fx) % (W + 430) + W + 430) % (W + 430) - 60;
      g.fillStyle = '#100c2c'; g.fillRect(x - 3, H - 58, 6, 58);
      g.globalCompositeOperation = 'lighter'; drawGlow(g, x, H - 64, 20, GLOW.gold, 0.6); g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#ffcf6a'; g.fillRect(x - 5, H - 70, 10, 12); g.strokeStyle = '#100c2c'; g.lineWidth = 2; g.strokeRect(x - 5, H - 70, 10, 12);
    }
    // top edge: hanging paper garland
    g.strokeStyle = 'rgba(16,12,44,0.9)'; g.lineWidth = 2;
    const gx = ((fx % 260) + 260) % 260;
    for (let x = -260 + gx; x < W + 260; x += 260) {
      g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + 130, 34, x + 260, 0); g.stroke();
      for (let k = 1; k < 6; k++) {
        const u = k / 6, px = x + 260 * u, py = 2 * (1 - u) * u * 34 + 2;
        g.fillStyle = k % 2 ? 'rgba(210,190,255,0.5)' : 'rgba(150,220,255,0.45)';
        g.beginPath(); g.moveTo(px - 6, py); g.lineTo(px + 6, py); g.lineTo(px, py + 12 + Math.sin(t * 2 + k) * 2); g.closePath(); g.fill();
      }
    }
  }
}

class HubScene {
  constructor() { this.t = 0; this.cache = null; this.cw = 0; this.ch = 0; const r = mulberry32(5); this.motes = []; for (let i = 0; i < 40; i++) this.motes.push({ x: r(), y: r(), s: 1 + r() * 2.5, p: r() * TAU, note: r() < 0.2 }); }
  update(dt) { this.t += dt; }
  build(W, H) {
    const c = makeCanvas(W, H), g = c.getContext('2d'), r = mulberry32(8);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b1446'); bg.addColorStop(0.7, '#2c2268'); bg.addColorStop(1, '#1a1442');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // arched wall panels
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.5) * (W / 9);
      g.fillStyle = i % 2 ? 'rgba(60,48,130,0.35)' : 'rgba(45,36,105,0.35)';
      g.beginPath(); g.moveTo(x - W / 20, H * 0.78); g.lineTo(x - W / 20, H * 0.2); g.quadraticCurveTo(x, H * 0.08, x + W / 20, H * 0.2); g.lineTo(x + W / 20, H * 0.78); g.closePath(); g.fill();
    }
    // round window with the sea and moon
    const wx = W * 0.2, wy = H * 0.36, wr = H * 0.2;
    g.save(); g.beginPath(); g.arc(wx, wy, wr, 0, TAU); g.clip();
    const sk = g.createLinearGradient(0, wy - wr, 0, wy + wr); sk.addColorStop(0, '#120d33'); sk.addColorStop(0.62, '#3d3288'); sk.addColorStop(0.64, '#241d62'); sk.addColorStop(1, '#161144');
    g.fillStyle = sk; g.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
    g.fillStyle = '#efe8ff'; g.beginPath(); g.arc(wx + wr * 0.35, wy - wr * 0.35, wr * 0.22, 0, TAU); g.fill();
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(240,235,255,0.7)'; g.fillRect(wx - wr + r() * wr * 2, wy - wr + r() * wr * 1.2, 1.5, 1.5); }
    g.fillStyle = 'rgba(58,48,122,0.9)'; g.beginPath(); g.moveTo(wx - wr * 0.8, wy + wr * 0.26); g.lineTo(wx - wr * 0.6, wy - wr * 0.1); g.lineTo(wx - wr * 0.45, wy + wr * 0.26); g.fill();
    g.restore();
    g.strokeStyle = '#8f7a4a'; g.lineWidth = H * 0.018; g.beginPath(); g.arc(wx, wy, wr, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(143,122,74,0.8)'; g.lineWidth = H * 0.008; g.beginPath(); g.moveTo(wx - wr, wy); g.lineTo(wx + wr, wy); g.moveTo(wx, wy - wr); g.lineTo(wx, wy + wr); g.stroke();
    // shelves with glowing jars on the right
    for (let s = 0; s < 3; s++) {
      const y = H * (0.26 + s * 0.17), x0 = W * 0.68, x1 = W * 0.95;
      g.fillStyle = '#5a4432'; g.fillRect(x0, y, x1 - x0, H * 0.012);
      for (let j = 0; j < 7; j++) {
        const jx = x0 + 18 + j * ((x1 - x0 - 30) / 6), jh = H * (0.05 + r() * 0.03), col = pick(['181,140,255', '255,207,74', '111,240,255']);
        g.globalCompositeOperation = 'lighter'; drawGlow(g, jx, y - jh / 2, jh * 1.1, `rgba(${col},0.6)`, 0.7); g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(${col},0.35)`; g.strokeStyle = 'rgba(230,220,255,0.6)'; g.lineWidth = 1.5;
        g.beginPath(); g.roundRect ? g.roundRect(jx - 9, y - jh, 18, jh, 5) : g.rect(jx - 9, y - jh, 18, jh); g.fill(); g.stroke();
        g.fillStyle = '#8f7a4a'; g.fillRect(jx - 7, y - jh - 4, 14, 4);
      }
    }
    // floor + stage
    const fl = g.createLinearGradient(0, H * 0.72, 0, H); fl.addColorStop(0, '#3a2c6e'); fl.addColorStop(1, '#1c153f');
    g.fillStyle = fl; g.fillRect(0, H * 0.72, W, H * 0.28);
    g.strokeStyle = 'rgba(160,140,230,0.15)'; g.lineWidth = 1;
    for (let i = -10; i <= 10; i++) { g.beginPath(); g.moveTo(W / 2 + i * 40, H * 0.72); g.lineTo(W / 2 + i * 150, H); g.stroke(); }
    const st = g.createRadialGradient(W / 2, H * 0.8, 10, W / 2, H * 0.8, W * 0.2); st.addColorStop(0, 'rgba(255,220,150,0.35)'); st.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = st; g.beginPath(); g.ellipse(W / 2, H * 0.8, W * 0.2, H * 0.07, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,214,140,0.55)'; g.lineWidth = 3; g.beginPath(); g.ellipse(W / 2, H * 0.8, W * 0.14, H * 0.045, 0, 0, TAU); g.stroke();
    // light column
    const lc = g.createLinearGradient(0, 0, 0, H * 0.8); lc.addColorStop(0, 'rgba(255,230,170,0)'); lc.addColorStop(1, 'rgba(255,230,170,0.16)');
    g.fillStyle = lc; g.beginPath(); g.moveTo(W / 2 - W * 0.05, 0); g.lineTo(W / 2 + W * 0.05, 0); g.lineTo(W / 2 + W * 0.13, H * 0.8); g.lineTo(W / 2 - W * 0.13, H * 0.8); g.closePath(); g.fill();
    return c;
  }
  draw(g, W, H) {
    if (!this.cache || this.cw !== W || this.ch !== H) { this.cache = this.build(W, H); this.cw = W; this.ch = H; }
    g.drawImage(this.cache, 0, 0);
    const t = this.t;
    // hanging lanterns
    for (let i = 0; i < 7; i++) {
      const x = W * (0.12 + i * 0.13), len = H * (0.1 + (i % 3) * 0.06), sw = Math.sin(t * 1.2 + i) * 0.06;
      const lx = x + Math.sin(sw) * len, ly = Math.cos(sw) * len;
      g.strokeStyle = 'rgba(20,14,50,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(lx, ly); g.stroke();
      g.globalCompositeOperation = 'lighter'; drawGlow(g, lx, ly + 12, 34, GLOW.gold, 0.55 + Math.sin(t * 2 + i) * 0.1); g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#ffd98a'; g.strokeStyle = PAL.ink; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(lx, ly + 12, 9, 12, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#8f7a4a'; g.fillRect(lx - 5, ly - 1, 10, 3); g.fillRect(lx - 4, ly + 23, 8, 3);
    }
    for (const m of this.motes) {
      const x = m.x * W + Math.sin(t * 0.4 + m.p) * 20, y = ((m.y * H - t * 12 * m.s) % H + H) % H;
      if (m.note) { g.fillStyle = 'rgba(255,227,138,0.45)'; g.font = `${10 + m.s * 3}px serif`; g.fillText('♪', x, y); }
      else { g.fillStyle = `rgba(201,168,255,${0.35 + 0.25 * Math.sin(t * 2 + m.p)})`; g.beginPath(); g.arc(x, y, m.s, 0, TAU); g.fill(); }
    }
  }
}

class MapScene {
  constructor() { this.t = 0; this.cache = null; this.cw = 0; this.ch = 0; }
  update(dt) { this.t += dt; }
  build(W, H) {
    const c = makeCanvas(W, H), g = c.getContext('2d'), r = mulberry32(21);
    const bg = g.createRadialGradient(W * 0.45, H * 0.45, 20, W * 0.5, H * 0.5, W * 0.7);
    bg.addColorStop(0, '#2d2672'); bg.addColorStop(0.7, '#1c1650'); bg.addColorStop(1, '#100c30');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // wave pattern rows
    g.strokeStyle = 'rgba(255,214,140,0.12)'; g.lineWidth = 1.2;
    for (let y = 60; y < H; y += 46) for (let x = (y / 46) % 2 ? 0 : 30; x < W; x += 60) { g.beginPath(); g.arc(x, y, 12, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    // constellations
    g.strokeStyle = 'rgba(255,214,140,0.25)'; g.fillStyle = 'rgba(255,236,190,0.7)';
    for (let k = 0; k < 5; k++) {
      let x = r() * W, y = r() * H * 0.8; g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 5; i++) { x += (r() - 0.4) * 120; y += (r() - 0.5) * 80; g.lineTo(x, y); g.fillRect(x - 1.5, y - 1.5, 3, 3); }
      g.stroke();
    }
    // clock-face compass rose (top right)
    const cx = W * 0.9, cy = H * 0.2, cr = Math.min(W, H) * 0.12;
    g.strokeStyle = 'rgba(255,214,140,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.stroke();
    g.beginPath(); g.arc(cx, cy, cr * 0.8, 0, TAU); g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; g.beginPath(); g.moveTo(cx + Math.cos(a) * cr * 0.8, cy + Math.sin(a) * cr * 0.8); g.lineTo(cx + Math.cos(a) * cr * (i % 3 ? 0.9 : 1.05), cy + Math.sin(a) * cr * (i % 3 ? 0.9 : 1.05)); g.stroke(); }
    g.fillStyle = 'rgba(255,214,140,0.3)'; BulletArt.star(g, cx, cy, 4, cr * 0.7, cr * 0.12); g.fill();
    // corner doodles: boat, lantern, moon
    g.strokeStyle = 'rgba(255,214,140,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W * 0.05, H * 0.9); g.lineTo(W * 0.12, H * 0.9); g.lineTo(W * 0.105, H * 0.93); g.lineTo(W * 0.065, H * 0.93); g.closePath(); g.moveTo(W * 0.085, H * 0.9); g.lineTo(W * 0.085, H * 0.85); g.lineTo(W * 0.065, H * 0.9); g.stroke();
    g.beginPath(); g.arc(W * 0.93, H * 0.88, 22, 0.5, 5.2); g.arc(W * 0.94, H * 0.87, 16, 4.9, 0.9, true); g.stroke();
    // edges: vignette + curled corners
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(6,4,22,0.7)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.25; const pat = g.createPattern(makePaper(), 'repeat'); g.fillStyle = pat; g.fillRect(0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    return c;
  }
  draw(g, W, H) {
    if (!this.cache || this.cw !== W || this.ch !== H) { this.cache = this.build(W, H); this.cw = W; this.ch = H; }
    g.drawImage(this.cache, 0, 0);
  }
}

/* ---------- small icon renderers for codex / tips ---------- */
function paintBulletIcon(cv, type, cb, t = 0) {
  const g = cv.getContext('2d'), s = cv.width;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s, s);
  g.translate(s / 2, s / 2);
  const k = s / 40;
  if (type === 'white') {
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.2 * k; g.setLineDash([3 * k, 3 * k]); g.beginPath(); g.moveTo(-18 * k, 8 * k); g.lineTo(18 * k, -8 * k); g.stroke(); g.setLineDash([]);
    BulletArt.draw(g, 'white', 0, 0, -0.42, 0.9 * k, cb);
  } else BulletArt.draw(g, type, 0, 0, type === 'blue' ? Math.sin(t) * 0.3 : 0, 0.95 * k, cb);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
function paintEnemyIcon(cv, type, t = 0) {
  const g = cv.getContext('2d'), s = cv.width;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s, s);
  g.translate(s / 2, s / 2);
  if (type === 'clock') { g.scale(s / 360, s / 360); drawClockBoss(g, { x: 0, y: 10, phase: 1, minA: -0.9, hourA: 2.2, weakT: 0, mouth: 0, lookA: Math.PI, shield: 0 }, t); }
  else { const sc = s / (type.endsWith('E') ? 90 : 64); g.scale(sc, sc); (EnemyArt[type] || EnemyArt.jelly)(g, { seed: 1, charge: 0, aim: Math.PI }, t); }
  g.setTransform(1, 0, 0, 1, 0, 0);
}
