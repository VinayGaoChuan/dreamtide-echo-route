'use strict';
/* 站的界面（docs/design.md §8、§16.2）：站的画面占满屏幕，设施按做过的事亮起来；点设施打开面板。
   装备栏是最常用的：船的侧视图 + 8 个位、属性汇总、仓库（点一个位只列这个位的候选，按“比身上的好多少”排序）、说明框和比较。 */

G.st = { panel: null, sel: null, filter: 'all', cube: { recipe: 'rerollBlue', uid: null }, reveal: null, tut: null };

/* ---------- 站的画面：废弃空间站，设施的位置和 DOM 热点共用 ---------- */
const STATION_SPOTS = {
  equip: { x: 0.40, y: 0.56, icon: 'g-gun' }, stash: { x: 0.24, y: 0.60, icon: 'i-stash' }, shop: { x: 0.14, y: 0.40, icon: 'i-credit' },
  insure: { x: 0.30, y: 0.36, icon: 'i-shield' }, salvage: { x: 0.52, y: 0.32, icon: 'i-salv' }, cube: { x: 0.62, y: 0.52, icon: 'i-cube' },
  black: { x: 0.70, y: 0.30, icon: 'i-dice' }, hangar: { x: 0.40, y: 0.80, icon: 'i-hangar' }, codex: { x: 0.08, y: 0.70, icon: 'i-book' },
};
class StationScene {
  constructor() { this.t = 0; this.space = new SpaceScene(); this.space.setTheme('station'); this.flash = {}; this.arrive = null; }
  update(dt) {
    this.t += dt; this.space.update(dt * 0.3);
    const A = this.arrive; if (!A) return;
    const t0 = A.t; A.t += dt;
    for (const it of A.list) if (t0 < it.at + it.fly && A.t >= it.at + it.fly) Sound.sfx(it.rank >= 4 ? 'lootGold' : it.rank >= 3 ? 'lootGreen' : it.rank >= 1 ? 'pickLoot' : 'dust', { gap: 30, k: it.rank }); // 落进仓库那一下
    if (A.t > A.end) this.arrive = null;
  }
  /* 回家开货舱（§14）：船落进泊位 → 货舱弹开 → 装备按品质从低到高一件件飞进仓库，金的最后、停一下 */
  startArrival(info) {
    const A = Object.assign({ t: 0 }, info || {}), items = (A.items || []).slice().sort((a, b) => QUALS[a.q].rank - QUALS[b.q].rank).slice(-16);
    let at = 1.8; A.list = items.map((it) => { const rank = QUALS[it.q].rank, o = { q: it.q, name: it.name, rank, at: at + (rank >= 4 ? 0.5 : 0), fly: 0.55 }; at = o.at + (rank >= 3 ? 0.6 : 0.22); return o; });
    A.end = Math.max(4, at + 1.2); this.arrive = A;
  }
  draw(g, W, H, m) {
    const t = this.t; this.space.dim = 1; this.space.draw(g, W, H, { noForeground: true });
    const U = (m && m.unlock) || {}, homes = (m && m.station && m.station.homes) || {};
    const cx = W * 0.42, cy = H * 0.52;
    g.save();
    // 中央的环形舱：一开始只有一盏应急灯；按设施解锁一段一段亮起来
    const lit = Object.keys(U).filter((k) => U[k]).length;
    g.strokeStyle = '#2a2240'; g.lineWidth = 34; g.beginPath(); g.ellipse(cx, cy, W * 0.3, H * 0.27, 0, 0, TAU); g.stroke();
    g.strokeStyle = '#3b3058'; g.lineWidth = 3; g.beginPath(); g.ellipse(cx, cy, W * 0.3, H * 0.27, 0, 0, TAU); g.stroke();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, on = i < lit * 2.4; const x = cx + Math.cos(a) * W * 0.3, y = cy + Math.sin(a) * H * 0.27; g.fillStyle = on ? `rgba(255,200,120,${0.6 + 0.3 * Math.sin(t * 2 + i)})` : 'rgba(80,70,110,0.6)'; g.fillRect(x - 3, y - 3, 6, 6); }
    // 辐条和中心
    g.strokeStyle = '#241c38'; g.lineWidth = 10; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * W * 0.3, cy + Math.sin(a) * H * 0.27); g.stroke(); }
    const hub = g.createRadialGradient(cx - 20, cy - 20, 6, cx, cy, 70); hub.addColorStop(0, '#5a4a7a'); hub.addColorStop(1, '#221a36');
    g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 64, 0, TAU); g.fill(); g.strokeStyle = '#7a6aa0'; g.lineWidth = 2; g.stroke();
    g.globalCompositeOperation = 'lighter'; drawGlow(g, cx, cy, 90, 'rgba(255,190,110,0.6)', 0.25 + 0.05 * Math.sin(t)); g.globalCompositeOperation = 'source-over';
    // 打通地图以后多出来的东西（§10.1）
    if (homes.beacon) { const x = cx + W * 0.24, y = cy - H * 0.42; g.fillStyle = '#2c2440'; g.fillRect(x - 4, y, 8, H * 0.2); g.globalCompositeOperation = 'lighter'; drawGlow(g, x, y, 40, 'rgba(255,120,90,0.9)', 0.5 + 0.5 * Math.sin(t * 3)); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#ff7a5a'; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); }
    if (homes.dome) { const x = cx - W * 0.3, y = cy + H * 0.05; g.fillStyle = 'rgba(80,200,140,0.18)'; g.beginPath(); g.arc(x, y, 70, Math.PI, 0); g.fill(); g.strokeStyle = 'rgba(160,240,200,0.6)'; g.lineWidth = 2; g.stroke(); for (let i = 0; i < 6; i++) { g.fillStyle = '#3fae6a'; g.beginPath(); g.ellipse(x - 50 + i * 20, y - 6, 6, 12, 0, 0, TAU); g.fill(); } }
    if (homes.dock) { const x = cx + W * 0.1, y = cy + H * 0.36; g.fillStyle = '#2a2240'; g.fillRect(x - 160, y - 18, 320, 36); for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(120,220,255,${0.4 + 0.3 * Math.sin(t * 2 + i)})`; g.fillRect(x - 140 + i * 64, y - 4, 20, 8); } }
    if (homes.turret) { const x = cx - W * 0.22, y = cy - H * 0.36; g.fillStyle = '#3a2a30'; g.beginPath(); g.arc(x, y, 24, 0, TAU); g.fill(); g.save(); g.translate(x, y); g.rotate(-0.4 + Math.sin(t * 0.5) * 0.3); g.fillStyle = '#5a3a3a'; g.fillRect(0, -6, 60, 12); g.restore(); }
    if (homes.relay) { const x = cx + W * 0.36, y = cy - H * 0.1; g.strokeStyle = '#b98aff'; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y, 60, 24, -0.6, 0, Math.PI); g.stroke(); g.globalCompositeOperation = 'lighter'; drawGlow(g, x, y - 10, 70, 'rgba(185,138,255,0.8)', 0.4 + 0.2 * Math.sin(t * 1.3)); g.globalCompositeOperation = 'source-over'; }
    // 设施：解锁的亮，没解锁的暗
    for (const id in STATION_SPOTS) {
      const S = STATION_SPOTS[id], x = W * S.x, y = H * S.y, on = !!U[id], f = this.flash[id] !== undefined ? Math.max(0, 1 - (t - this.flash[id]) / 1.2) : 0;
      g.fillStyle = on ? '#3a3058' : '#1c1628'; g.strokeStyle = on ? '#8a7ab8' : '#3a3050'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y + 26, 54, 16, 0, 0, TAU); g.fill(); g.stroke();
      if (on) { g.globalCompositeOperation = 'lighter'; drawGlow(g, x, y + 20, 70, 'rgba(255,200,120,0.7)', 0.2 + 0.6 * f + 0.05 * Math.sin(t * 2 + x)); g.globalCompositeOperation = 'source-over'; }
    }
    // 泊位上的船
    const sx = W * 0.40, sy = H * 0.80 - 40;
    let ay = 0; if (this.arrive) { const u = Math.min(1, this.arrive.t / 1.4); ay = (1 - Ease.outCubic(u)) * -260; }
    drawPlane(g, (m && m.current) || 'moon', sx, sy + ay + Math.sin(t * 1.4) * 3, 1.1, t, { happy: true, look: m && m.gear ? Gear.look(m.gear.eq) : null });
    const A = this.arrive;
    if (A && A.list && A.list.length) { // 货舱从船尾弹出、打开；装备一件件划着弧线飞进仓库
      const px = sx - 60, py = sy + 24, open = clamp((A.t - 1.3) / 0.4, 0, 1), tx = W * STATION_SPOTS.stash.x, ty = H * STATION_SPOTS.stash.y;
      if (A.t > 1.1 && A.t < A.end - 0.3) { g.save(); g.translate(px, py); g.fillStyle = '#c9b08a'; g.strokeStyle = '#2a1e30'; g.lineWidth = 2.4; roundRect(g, -26, -16, 52, 32, 7); g.fill(); g.stroke(); g.fillStyle = '#ffd27a'; g.save(); g.translate(0, -16); g.rotate(-open * 1.1); g.fillRect(-26, -5, 52, 6); g.restore(); g.restore(); }
      for (const it of A.list) {
        const u = (A.t - it.at) / it.fly; if (u < 0) continue;
        const c = QUALS[it.q].color;
        if (u < 1) { const k = Ease.inOutSine(u), x = lerp(px, tx, k), y = lerp(py, ty, k) - Math.sin(k * Math.PI) * (90 + it.rank * 25); g.globalCompositeOperation = 'lighter'; drawGlow(g, x, y, 14 + it.rank * 6, hexA(c, 0.9), 0.8); g.globalCompositeOperation = 'source-over'; g.fillStyle = c; g.strokeStyle = '#2a1e30'; g.lineWidth = 1.6; roundRect(g, x - 8, y - 6, 16, 12, 3); g.fill(); g.stroke(); }
        else if (u < 3 && it.rank >= 2) { const a = 1 - (u - 1) / 2; g.save(); g.font = '600 15px "Noto Sans SC", sans-serif'; g.textAlign = 'center'; g.fillStyle = hexA(c, a); g.fillText(it.name, tx, ty - 40 - (u - 1) * 14 - it.rank * 4); g.restore(); if (it.rank >= 4 && u < 1.6) { g.globalCompositeOperation = 'lighter'; drawGlow(g, tx, ty, 120, 'rgba(255,214,140,0.9)', 0.9 * (1.6 - u)); g.globalCompositeOperation = 'source-over'; } }
      }
    }
    g.restore();
  }
}

/* ---------- 装备的小图标：位的剪影 + 品质色的框（套装用族色的边） ---------- */
function paintGearIcon(c, it, kind) {
  // 装备的小图标（评审：纯色几何像占位）：金属的部件 + 品质色的饰条和光 + 族色（套装）/ 金边（暗金）；形状按位和底子
  const g = c.getContext('2d'), s = c.width; g.clearRect(0, 0, s, s);
  const k = it ? it.kind : kind, col = it ? QUALS[it.q].color : 'rgba(180,170,220,0.35)', race = it && it.set ? RACES[SETS[it.set].race].color : null, uni = it && it.q === 'gold';
  g.save(); g.scale(s / 64, s / 64); g.lineJoin = 'round'; g.lineCap = 'round';
  const bg = g.createRadialGradient(32, 26, 4, 32, 32, 40); bg.addColorStop(0, it ? hexA(col.length === 7 ? col : '#e8e8e8', 0.22) : 'rgba(40,32,64,0.4)'); bg.addColorStop(1, it ? 'rgba(16,12,28,0.95)' : 'rgba(20,16,34,0.5)');
  g.fillStyle = bg; g.strokeStyle = race || col; g.lineWidth = it ? 3 : 2;
  g.beginPath(); g.roundRect ? g.roundRect(3, 3, 58, 58, 10) : g.rect(3, 3, 58, 58); g.fill(); g.stroke();
  if (uni) { g.strokeStyle = 'rgba(255,230,160,0.8)'; g.lineWidth = 1; g.beginPath(); g.roundRect ? g.roundRect(7, 7, 50, 50, 7) : g.rect(7, 7, 50, 50); g.stroke(); for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56]]) { g.fillStyle = '#ffd76a'; g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill(); } }
  if (it && (uni || it.q === 'green')) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 32, 32, 34, hexA(col, 0.8), 0.3); g.globalCompositeOperation = 'source-over'; }
  g.translate(32, 32);
  const metal = (y0, y1) => { const m = g.createLinearGradient(0, y0, 0, y1); m.addColorStop(0, it ? '#d4d8e6' : 'rgba(200,190,230,0.45)'); m.addColorStop(0.55, it ? '#8a90a8' : 'rgba(150,140,190,0.4)'); m.addColorStop(1, it ? '#4c4a66' : 'rgba(90,80,130,0.4)'); return m; };
  const acc = it ? col : 'rgba(180,170,220,0.35)', ink = '#120e1e';
  const box = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r || 3) : g.rect(x, y, w, h); };
  g.strokeStyle = ink; g.lineWidth = 2;
  const base = it ? it.base : null;
  switch (k) {
    case 'gun':
      if (base === 'scatter') { g.fillStyle = metal(-8, 8); box(-20, -8, 18, 16, 4); g.fill(); g.stroke(); for (const a of [-0.32, 0, 0.32]) { g.save(); g.rotate(a); g.fillStyle = metal(-3, 3); box(-2, -3.5, 24, 7, 2); g.fill(); g.stroke(); g.restore(); } g.fillStyle = acc; g.beginPath(); g.arc(-11, 0, 4, 0, TAU); g.fill(); }
      else if (base === 'beam') { g.fillStyle = metal(-8, 8); box(-22, -8, 14, 16, 4); g.fill(); g.stroke(); g.fillStyle = metal(-4, 4); g.beginPath(); g.moveTo(-8, -5); g.lineTo(22, -2.5); g.lineTo(22, 2.5); g.lineTo(-8, 5); g.closePath(); g.fill(); g.stroke(); g.fillStyle = acc; g.fillRect(0, -3, 3, 6); g.fillRect(8, -2.5, 3, 5); g.globalCompositeOperation = 'lighter'; drawGlow(g, 23, 0, 9, hexA(it ? col : '#ffffff', 0.9), it ? 0.9 : 0.3); g.globalCompositeOperation = 'source-over'; }
      else if (base === 'missile') { g.fillStyle = metal(-14, 14); box(-18, -14, 26, 28, 6); g.fill(); g.stroke(); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = ink; g.beginPath(); g.arc(-10 + i * 10, -6 + j * 12, 3.6, 0, TAU); g.fill(); g.fillStyle = '#ff7a6a'; g.beginPath(); g.arc(-10 + i * 10, -6 + j * 12, 2, 0, TAU); g.fill(); } g.fillStyle = acc; g.fillRect(8, -10, 4, 20); }
      else { g.fillStyle = metal(-7, 7); box(-20, -7, 20, 14, 4); g.fill(); g.stroke(); for (const y of [-4, 4]) { g.fillStyle = metal(y - 2.5, y + 2.5); box(0, y - 2.5, 22, 5, 2); g.fill(); g.stroke(); } g.fillStyle = metal(6, 16); box(-15, 6, 7, 10, 2); g.fill(); g.stroke(); g.fillStyle = acc; g.fillRect(-16, -2, 12, 4); }
      break;
    case 'aux': g.fillStyle = metal(-12, 12); g.beginPath(); g.ellipse(0, 0, 18, 11, 0, 0, TAU); g.fill(); g.stroke(); g.fillStyle = acc; g.beginPath(); g.arc(6, 0, 4, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(0, -2, 13, 6, 0, Math.PI * 1.1, Math.PI * 1.8); g.stroke(); break;
    case 'core': { g.fillStyle = metal(-18, 18); g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; g.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); } g.closePath(); g.fill(); g.stroke(); g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 14, hexA(it ? col : '#ffffff', 0.9), it ? 0.9 : 0.3); g.globalCompositeOperation = 'source-over'; g.fillStyle = it ? '#fff' : 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill(); if (base === 'coreTwin') { g.beginPath(); g.arc(-8, 0, 3, 0, TAU); g.arc(8, 0, 3, 0, TAU); g.fill(); } break; }
    case 'armor': g.fillStyle = metal(-18, 18); g.beginPath(); g.moveTo(-17, -16); g.lineTo(17, -16); g.lineTo(15, 7); g.lineTo(0, 19); g.lineTo(-15, 7); g.closePath(); g.fill(); g.stroke(); g.strokeStyle = acc; g.lineWidth = 3; g.beginPath(); g.moveTo(-10, -9); g.lineTo(10, -9); g.stroke(); g.fillStyle = '#4c4a66'; for (const [x, y] of [[-12, -12], [12, -12], [-10, 4], [10, 4]]) { g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fill(); } break;
    case 'engine': g.fillStyle = metal(-11, 11); box(-18, -11, 20, 22, 4); g.fill(); g.stroke(); g.fillStyle = metal(-14, 14); g.beginPath(); g.moveTo(2, -9); g.lineTo(16, -14); g.lineTo(16, 14); g.lineTo(2, 9); g.closePath(); g.fill(); g.stroke(); g.globalCompositeOperation = 'lighter'; drawGlow(g, 22, 0, 12, hexA(it ? col : '#ffffff', 0.9), it ? 0.8 : 0.3); g.globalCompositeOperation = 'source-over'; g.fillStyle = acc; g.fillRect(-14, -2, 12, 4); break;
    case 'radar': g.fillStyle = metal(-12, 4); g.save(); g.rotate(-0.45); g.beginPath(); g.ellipse(0, -4, 18, 9, 0, Math.PI, TAU); g.closePath(); g.fill(); g.stroke(); g.restore(); g.strokeStyle = '#4c4a66'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 16); g.stroke(); g.strokeStyle = ink; g.lineWidth = 2; g.fillStyle = acc; g.beginPath(); g.arc(-4, -10, 3, 0, TAU); g.fill(); break;
    default: g.fillStyle = metal(-14, 14); box(-14, -14, 28, 28, 4); g.fill(); g.stroke(); g.fillStyle = '#4c4a66'; for (let i = -1; i <= 1; i++) { g.fillRect(-21, i * 8 - 1.5, 7, 3); g.fillRect(14, i * 8 - 1.5, 7, 3); } g.strokeStyle = acc; g.lineWidth = 2; g.beginPath(); g.moveTo(-8, -6); g.lineTo(0, -6); g.lineTo(0, 6); g.lineTo(8, 6); g.stroke();
  }
  if (race) { g.fillStyle = race; g.beginPath(); g.moveTo(-26, 26); g.lineTo(-12, 26); g.lineTo(-26, 12); g.closePath(); g.fill(); } // 套装：左下角一角族色
  g.restore();
}
function paintGearIcons(root) { $$('canvas[data-gear]', root).forEach((c) => { const id = c.dataset.gear, it = id ? (Station.find(G.meta, id) || {}).it || (G.st.reveal && G.st.reveal.uid === id ? G.st.reveal : null) || (G.st.extra && G.st.extra[id]) : null; paintGearIcon(c, it, c.dataset.kind); }); }

/* ---------- 说明框：照暗黑（名字 → 底子 → 固有 → 词条 → 套装 → 需要等级）；有身上的就并排比较 ---------- */
function gearTipHtml(it, o = {}) {
  if (!it) return '';
  const m = G.meta, L = Gear.lines(it), alt = !!o.alt;
  const rows = L.map((l, i) => {
    if (i === 0) return `<div class="gt-name" style="color:${l.c}">${esc(l.t)}</div>`;
    const tier = alt && l.tier !== undefined && AFFIXES[l.k] && AFFIXES[l.k].t[l.tier] ? `<small class="gt-tier">T${l.tier + 1} · ${AFFIXES[l.k].t[l.tier].join('–')}</small>` : '';
    return `<div class="gt-line ${l.small ? 'small' : ''}" style="color:${l.c}">${esc(l.t)}${tier}</div>`;
  }).join('');
  let set = '';
  if (it.set) {
    const S = SETS[it.set], R = RACES[S.race], have = GEAR_SLOTS.filter((s) => m.gear.eq[s] && m.gear.eq[s].set === it.set).length;
    const pieces = Object.keys(S.pieces).map((k) => `<span class="${GEAR_SLOTS.some((s) => m.gear.eq[s] && m.gear.eq[s].set === it.set && m.gear.eq[s].kind === k) ? 'on' : ''}">${GEAR_KINDS[k].name}</span>`).join(' ');
    set = `<div class="gt-set"><div style="color:${R.color}">${esc(R.name)} · ${esc(S.name)}套装（${have}/4）</div><div class="gt-pieces">${pieces}</div>
      <div class="${have >= 2 ? 'on' : ''}">2 件：${Object.keys(S.two).map((k) => Gear.fmtAffix(k, S.two[k])).join('，')}</div><div class="${have >= 4 ? 'on' : ''}">4 件：${esc(S.four.line)}</div></div>`;
  }
  const req = it.req > m.pilot.lv ? `<div class="gt-req bad">需要驾驶员 ${it.req} 级（现在 ${m.pilot.lv} 级）</div>` : it.req > 1 ? `<div class="gt-req">需要驾驶员 ${it.req} 级</div>` : '';
  const flags = [it.bound ? '改过 · 不能送人' : '', it.lock ? '已锁定' : '', it.junk ? '标记为垃圾' : ''].filter(Boolean).map((t) => `<span class="chip">${t}</span>`).join(' ');
  return `<div class="gtip q-${it.q}" style="--qc:${QUALS[it.q].color}">${o.head ? `<div class="gt-head">${esc(o.head)}</div>` : ''}${rows}${set}${req}${flags ? `<div class="row wrap">${flags}</div>` : ''}</div>`;
}
/* 比较：每条属性的变化（绿 ▲ / 红 ▼），顶上一行总结“火力 ▲▲ · 生存 ▼” */
function gearCompareHtml(it) {
  const m = G.meta, c = Station.compare(m, it, m.current), old = c.old;
  const a = Gear.itemStats(it), b = old ? Gear.itemStats(old) : {}, keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  if (it.kind === 'gun') { a.gunDmg = it.imp.gunDmg; b.gunDmg = old ? old.imp.gunDmg : GUN_BASES.rapid.dmg; keys.unshift('gunDmg'); }
  const arrows = (r) => { const d = r - 1; const n = Math.abs(d) < 0.02 ? 0 : Math.min(3, Math.ceil(Math.abs(d) / 0.12)); return n ? `<span class="fx ${d > 0 ? 'up' : 'down'}"><i>${(d > 0 ? '▲' : '▼').repeat(n)}</i></span>` : '<span class="dim-text">—</span>'; };
  const diff = keys.map((k) => { const d = (a[k] || 0) - (b[k] || 0); if (Math.abs(d) < 0.01) return ''; const txt = k === 'gunDmg' ? `每发伤害 ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}` : Gear.fmtAffix(k, +d.toFixed(1)).replace('+-', '−'); return `<div class="cmp-line ${d > 0 ? 'up' : 'down'}">${esc(txt)}</div>`; }).join('');
  const pa = Gear.plusOf(it), pb = old ? Gear.plusOf(old) : {};
  return `<div class="cmp"><div class="cmp-sum">火力 ${arrows(c.dps)} · 生存 ${arrows(c.ehp)}</div>${old ? '' : `<div class="dim-text">${it.kind === 'gun' ? '身上是默认的速射炮' : '这个位现在是空的'}</div>`}${diff}${JSON.stringify(pa) !== JSON.stringify(pb) ? '<div class="cmp-line">技能变了：看说明框最后几行</div>' : ''}</div>`;
}

/* ---------- 主画面 ---------- */
function stationRes() {
  const m = G.meta, c = (ic, col, v, name) => `<span class="cur" title="${name}">${icon(ic).replace('class="ic"', `class="ic" style="fill:${col}"`)}<small class="curname">${name}</small><span class="num">${v}</span></span>`;
  const need = pilotXpNeed(m.pilot.lv), pct = need === Infinity ? 100 : Math.round((m.pilot.xp / need) * 100);
  return `<div class="pilot-badge"><b>驾驶员 <span class="num">${m.pilot.lv}</span></b><span class="bar-mini"><i style="width:${pct}%"></i></span></div>
    <div class="cur-row">${c('i-credit', '#ffd27a', Math.floor(m.credits), '信用点')}${c('i-scrap', MATS.scrap.color, m.mats.scrap, '废料')}${c('i-shard', MATS.shard.color, m.mats.shard, '晶片')}${c('i-core', MATS.core.color, m.mats.core, '晶核')}</div>`;
}
function stationHotspots() {
  const m = G.meta, U = m.unlock, pos = (S) => `left:calc(${Math.round(G.W * S.x)}px*var(--u));top:calc(${Math.round(LH * S.y)}px*var(--u))`;
  return Object.keys(STATION_SPOTS).map((id) => {
    const S = STATION_SPOTS[id], F = FACILITIES[id], on = !!U[id], why = (UNLOCK_RULES.find((r) => r.id === id) || {}).why || '';
    const badge = id === 'stash' && m.gear.inbox.length ? `<i class="dot"></i>` : id === 'equip' && stationUpgradeReady() ? '<i class="dot"></i>' : '';
    return `<button class="hot st-hot ${on ? '' : 'locked'}" type="button" data-fac="${id}" style="${pos(S)}" ${offIf(!on, `${F.name}：${why}`)}>${icon(on ? S.icon : 'i-lock')}<span>${F.name}</span>${badge}</button>`;
  }).join('');
}
/* 仓库里有比身上更好的、够得上的装备（装备栏上亮一个点） */
function stationUpgradeReady() { const m = G.meta; return m.gear.stash.some((it) => Station.canEquip(m, it) && Station.compare(m, it, m.current).total > 1.03); }
function stationLaunchHtml() {
  const m = G.meta, mm = m.maps.sel && Station.mapOpen(m, m.maps.sel) ? m.maps.sel : 1, M = MAPS[mm], starts = Station.startStages(m, mm);
  const start = starts.includes(m.maps.start) ? m.maps.start : M.stages[0];
  const races = M.races.slice(0, 2).map((r) => `<span class="chip" style="border-color:${RACES[r].color};color:${RACES[r].color}">${RACES[r].name} · ${RACES[r].def === 'shield' ? '护盾' : '装甲'}</span>`).join('') + (M.chaos ? '<span class="chip">七族信徒 · 护盾 ↔ 装甲</span>' : '');
  const nodes = M.stages.map((id) => { const ok = starts.includes(id), S = STAGES[id], kill = m.maps.firstBoss[id]; return `<button class="stage-node ${id === start ? 'sel' : ''} ${ok ? '' : 'locked'} ${kill ? 'cleared' : ''}" type="button" data-start="${id}" ${offIf(!ok, stageNOf(id) > 1 && !m.unlock.waypoint ? '路标：第一次走到某张图的第 2 关后打开' : '还没走到这一关')}><b>${id}</b><span>${S.name}</span>${kill ? '<i>✓</i>' : ''}</button>`; }).join('');
  const cu = Station.catchUp(start);
  return `<div class="label">地图 ${mm} · ${esc(M.name)}${m.maps.cleared[mm] ? ' ✓' : ''}</div><div class="mission">“${esc(M.mission)}”</div><div class="row wrap">${races}</div>
    <div class="stage-row">${nodes}</div>${cu ? `<div class="dim-text">从第 ${stageNOf(start)} 关开始：开场先补 ${cu} 次升级</div>` : ''}
    <div class="row" style="justify-content:center"><button class="btn primary big" id="st-go" type="button" autofocus>${icon('i-hangar')} 出击</button><button class="btn big cyan" id="st-mp" type="button">${icon('i-team')} ${Lobby.code ? `房间 ${esc(Lobby.code)}` : '联机'}</button></div>`;
}
function showStation() {
  Sound.setMode('hub'); Sound.focus(false); G.world = null; Input.gameActive = false; hideHud(); stopPreview();
  const m = Station.ensure(G.meta), S = G.st;
  if (m.unlock.black && !m.station.seen.blackShips) m.station.seen.blackShips = true;
  const el = showScreen('hub', `
    <div class="st-top">${stationRes()}<span class="spacer"></span>
      <button class="icon-btn" id="st-map" type="button">${icon('i-starmap')}<span>星图</span></button>
      <button class="icon-btn" id="st-mp2" type="button">${icon('i-team')}<span>联机</span></button>
      <button class="icon-btn" id="st-records" type="button">${icon('i-trophy')}<span>记录</span></button>
      <button class="icon-btn" id="st-settings" type="button">${icon('i-gear')}<span>设置</span></button></div>
    ${S.panel ? '' : `<div class="home-hot">${stationHotspots()}</div>
    <div class="panel st-launch" id="st-launch">${stationLaunchHtml()}</div>`}
    <div class="panel st-panel" id="st-panel" ${S.panel ? '' : 'hidden'}>${S.panel ? stationPanelHtml(S.panel) : ''}</div>`, { bg: 'station', label: '站' });
  paintGearIcons(el); paintPlaneCanvases(el);
  if (!S.panel) $('#st-go', el).onclick = () => { Sound.sfx('select'); S.panel = null; if (Lobby.code) { Lobby.leave(); toast('单人出击：已离开联机房间', '#ffe38a'); } startRun(stationStart()); };
  if (!S.panel) $('#st-mp', el).onclick = () => { Sound.sfx('select'); S.panel = null; showMultiplayer(showStation); };
  $('#st-mp2', el).onclick = () => { Sound.sfx('ui'); showMultiplayer(showStation); };
  $('#st-map', el).onclick = (ev) => { Sound.sfx('ui'); if (S.panel === 'starmap') { pulse(ev.currentTarget); return; } S.panel = 'starmap'; showStation(); };
  $('#st-records', el).onclick = () => { Sound.sfx('ui'); showRecords(showStation); };
  $('#st-settings', el).onclick = () => { Sound.sfx('ui'); showSettings(showStation); };
  $$('[data-start]', el).forEach((b) => b.onclick = () => { Sound.sfx('ui'); if (stationStart() === b.dataset.start) pulse(b); else { m.maps.start = b.dataset.start; persist(); showStation(); } });
  $$('[data-fac]', el).forEach((b) => b.onclick = () => { Sound.sfx('ui'); S.panel = S.panel === b.dataset.fac ? null : b.dataset.fac; S.sel = null; showStation(); });
  if (S.panel) bindStationPanel($('#st-panel', el), S.panel);
  if (G.stationArrive) { const A = G.stationArrive; G.stationArrive = null; G.stationScene.startArrival(A); stationArrivalToasts(A); }
  if (S.tut) requestAnimationFrame(() => stationTutor(el));
}
/* 第一次回家的强制引导（§8.4）：只亮一样东西、一句话，别的压暗点不了；做完那一步才往下走。
   1 带回了几件 → 2 点那把蓝色主炮看比较 → 3 按「换上」→ 4 看船上的炮换了样子 → 5 出击 */
function stationTutorItem() {
  const m = G.meta, L = m.gear.stash.filter((it) => Station.canEquip(m, it));
  return L.find((it) => it.kind === 'gun' && QUALS[it.q].rank >= 1) || L.sort((a, b) => Station.compare(m, b, m.current).total - Station.compare(m, a, m.current).total)[0] || null;
}
function stationTutorEnd() { const m = G.meta; G.st.tut = null; m.station.tut.equip = 2; persist(); }
function stationTutor(el) {
  const S = G.st, m = G.meta, T = S.tut; if (!T || !document.body.contains(el)) return;
  const it = stationTutorItem();
  if (!it && T.step < 4) { stationTutorEnd(); return; } // 仓库里没有能换的：不教
  if (T.step >= 2 && T.step <= 4 && S.panel !== 'equip') { S.panel = 'equip'; showStation(); return; }
  if (T.step === 5 && S.panel) { S.panel = null; S.sel = null; showStation(); return; }
  const steps = {
    1: { sel: '.eq-stash', text: `你带回了 ${m.gear.stash.length} 件东西 · 点一下继续`, any: true },
    2: { sel: `[data-item="${it && it.uid}"]`, text: '指着它，和身上的比一比' },
    3: { sel: '[data-equip]', text: '箭头朝上：比身上的好 · 按一下换上' },
    4: { sel: '.eq-plane', text: '船上的炮换了样子 · 下一局就用它（点一下继续）', any: true },
    5: { sel: '#st-go', text: '出击' },
  }, D = steps[T.step], tg = D && $(D.sel, el);
  if (T.step === 2 && it && S.sel === it.uid) { T.step = 3; showStation(); return; } // 已经选中了：直接到「换上」
  if (!tg) { if (T.step === 2 && it && S.filter !== 'all') { S.filter = 'all'; showStation(); } return; }
  if (T.step === 2) tg.scrollIntoView({ block: 'nearest' });
  const r = tg.getBoundingClientRect(), pad = 14, L = document.createElement('div'); L.className = 'tut-layer';
  const hole = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  L.innerHTML = `<div class="tut-hole" style="left:${hole.x}px;top:${hole.y}px;width:${hole.w}px;height:${hole.h}px"></div>
    ${[[0, 0, '100vw', hole.y], [0, hole.y + hole.h, '100vw', `calc(100vh - ${hole.y + hole.h}px)`], [0, hole.y, hole.x, hole.h], [hole.x + hole.w, hole.y, `calc(100vw - ${hole.x + hole.w}px)`, hole.h]].map(([x, y, w, h]) => `<div class="tut-block" style="left:${x}px;top:${y}px;width:${typeof w === 'number' ? w + 'px' : w};height:${typeof h === 'number' ? h + 'px' : h}"></div>`).join('')}
    <div class="tut-say" style="left:${clamp(hole.x + hole.w / 2, 160, innerWidth - 160)}px;top:${hole.y > innerHeight * 0.4 ? hole.y - 64 : hole.y + hole.h + 16}px">${esc(D.text)}</div>`;
  el.appendChild(L);
  const holeEl = $('.tut-hole', L);
  $$('.tut-block', L).forEach((b) => b.onclick = (e) => { e.stopPropagation(); if (D.any) next(); else { pulse(holeEl); Sound.sfx('denied'); } });
  const next = () => { L.remove(); T.step++; if (T.step > 5) { stationTutorEnd(); return; } Sound.sfx('ui'); showStation(); };
  if (D.any) { holeEl.style.pointerEvents = 'auto'; holeEl.onclick = next; }
  else if (T.step === 2) tg.addEventListener('click', () => { T.step = 3; }, { capture: true, once: true }); // 选中那件以后往下走（面板自己会重画）
  else if (T.step === 5) tg.addEventListener('click', () => stationTutorEnd(), { capture: true, once: true });
}
function stationStart() { const m = G.meta, mm = m.maps.sel && Station.mapOpen(m, m.maps.sel) ? m.maps.sel : 1, starts = Station.startStages(m, mm); return starts.includes(m.maps.start) ? m.maps.start : MAPS[mm].stages[0]; }
function stationArrivalToasts(A) {
  const lines = [];
  if (A.credits) lines.push([`信用点 +${A.credits}`, '#ffd27a']);
  if (A.kept) lines.push([`带回 ${A.kept} 件装备`, '#9fd0ff']);
  for (const u of A.unlocks || []) lines.push([`${FACILITIES[u] ? FACILITIES[u].name : u}打开了`, '#9ff2c8']);
  lines.forEach(([t, c], i) => setTimeout(() => { if (G.screen === 'hub') toast(t, c, null, 2000); }, 700 + i * 800));
  for (const u of A.unlocks || []) G.stationScene.flash[u] = G.stationScene.t + 0.5;
}

/* ---------- 设施面板 ---------- */
function stationPanelHtml(id) {
  const m = G.meta, F = FACILITIES[id] || { name: id, line: '' };
  const head = `<div class="hp-head">${icon((STATION_SPOTS[id] || { icon: 'i-starmap' }).icon)}<div><h3>${esc(F.name)}</h3><div class="dim-text">${esc(F.line)}</div></div><button class="btn small" type="button" data-close>关闭</button></div>`;
  const up = (fid) => { const c = Station.facCost(m, fid), lv = m.fac[fid] || 1; if (!c) return `<span class="chip gold">${F.name} ${lv} 级 · 已满</span>`; return `<button class="btn small ${Station.canPay(m, c) ? 'cyan' : ''}" type="button" data-facup="${fid}" ${offIf(!Station.canPay(m, c), Station.missing(m, c))}>升到 ${lv + 1} 级 · ${esc(Station.costText(c))}</button>`; };
  if (id === 'equip' || id === 'stash') return head + equipHtml(id) + (id === 'stash' ? `<div class="row wrap st-foot"><span class="dim-text">仓库 ${m.gear.stash.length}/${Station.stashCap(m)}${m.gear.inbox.length ? ` · 到货区 ${m.gear.inbox.length}` : ''}</span>${up('stash')}
      <button class="btn small" type="button" data-junkall ${offIf(!m.gear.stash.some((x) => x.junk), '还没有标记为垃圾的装备')}>一键拆掉垃圾</button>
      <label class="tog"><input type="checkbox" data-auto="white" ${m.gear.auto.white ? 'checked' : ''}> 到家自动拆白装</label><label class="tog"><input type="checkbox" data-auto="blue" ${m.gear.auto.blue ? 'checked' : ''}> 自动拆蓝装</label></div>` : '');
  if (id === 'shop') {
    if (!m.station.shop) Station.restock(m);
    const L = m.station.shop.map((o, i) => `<div class="shop-item"><canvas width="56" height="56" data-gear="${o.it.uid}"></canvas><div class="si-body"><b style="color:${QUALS[o.it.q].color}">${esc(Gear.name(o.it))}</b><small class="dim-text">${GEAR_KINDS[o.it.kind].name} · 物品等级 ${o.it.ilvl}</small></div><button class="btn small" type="button" data-buy="${i}" ${offIf(m.credits < o.price, `信用点不够：还差 ${o.price - Math.floor(m.credits)}`)}>${o.price}</button></div>`).join('');
    G.st.extra = Object.fromEntries(m.station.shop.map((o) => [o.it.uid, o.it]));
    return `${head}<div class="shop-grid">${L || '<p class="dim-text">这一批卖完了，下次回家再进货</p>'}</div><div class="dim-text">卖东西：在装备栏或仓库里选中一件，按“卖”</div><div class="row">${up('shop')}</div>`;
  }
  if (id === 'insure') return `${head}<p>死在半路时，这一关新捡的东西里，保险舱保住最好的 <b>${FACILITIES.insure.lv[(m.fac.insure || 1) - 1]}</b> 件（先比品质，再比物品等级）。套装和暗金不占位置，一定带回。</p><div class="row">${up('insure')}</div>`;
  if (id === 'salvage') {
    const junk = [...m.gear.stash, ...m.gear.inbox].filter((x) => x.junk && !x.lock);
    return `${head}<p>白 → 废料；蓝 → 晶片 + 废料；黄 → 晶核 + 晶片；绿、金 → 晶核 + 晶片。产出 ×${FACILITIES.salvage.lv[(m.fac.salvage || 1) - 1]}</p>
      <div class="row wrap"><button class="btn primary" type="button" data-junkall ${offIf(!junk.length, '还没有标记为垃圾的装备：在仓库里选中一件按“标垃圾”')}>拆掉 ${junk.length} 件垃圾</button>
      <label class="tog"><input type="checkbox" data-auto="white" ${m.gear.auto.white ? 'checked' : ''}> 到家自动拆白装</label><label class="tog"><input type="checkbox" data-auto="blue" ${m.gear.auto.blue ? 'checked' : ''}> 自动拆蓝装</label></div><div class="row">${up('salvage')}</div>`;
  }
  if (id === 'cube') return head + cubeHtml() + `<div class="row">${up('cube')}</div>`;
  if (id === 'black') return head + blackHtml() + `<div class="row">${up('black')}</div>`;
  if (id === 'hangar') return head + hangarHtml();
  if (id === 'codex') return head + codexHtml();
  if (id === 'starmap') return `<div class="hp-head">${icon('i-starmap')}<div><h3>星图</h3><div class="dim-text">选一张地图；走到过的关可以直接开始（路标）</div></div><button class="btn small" type="button" data-close>关闭</button></div>${starmapHtml()}`;
  return head;
}
const KIND_FILTERS = [['all', '全部'], ['gun', '主炮'], ['aux', '辅助'], ['core', '大招核心'], ['armor', '装甲'], ['engine', '引擎'], ['radar', '雷达'], ['chip', '芯片']];
function equipHtml(id) {
  const m = G.meta, S = G.st, sel = S.sel ? Station.find(m, S.sel) : null;
  const slotBtn = (slot) => { const it = m.gear.eq[slot], k = SLOT_KIND[slot]; return `<button class="eq-slot s-${slot} ${S.filter === k ? 'on' : ''}" type="button" data-slot="${slot}" title="${GEAR_KINDS[k].name}"><canvas width="64" height="64" data-gear="${it ? it.uid : ''}" data-kind="${k}"></canvas><small>${GEAR_KINDS[k].name}</small></button>`; };
  const st = planeStats(m, m.current), g = Gear.compute(m.gear.eq), B = GUN_BASES[g.gun.base];
  const statRow = (n, v) => `<div class="sr"><span>${n}</span><b class="num">${v}</b></div>`;
  const stats = [statRow('武器', `${B.weapon}（${B.dtype === 'energy' ? '能量' : '动能'}）`), statRow('每发伤害', (g.gun.dmg * st.dmgK).toFixed(1)), statRow('射速', `${(B.rate * st.rateK).toFixed(1)}/秒`), statRow('暴击', `${st.crit}% · ×${st.critD.toFixed(2)}`),
    statRow('生命', `${(st.hearts * 10).toFixed(0)}（${st.hearts.toFixed(1)} 心）`), statRow('减伤', `${Math.round(st.dr * 100)}%`), statRow('移速', `${Math.round((st.spdK - 1) * 100)}%`), statRow('寻宝率', `${st.mf}%`),
    g.energy ? statRow('能量伤害', `+${g.energy}%`) : '', g.kinetic ? statRow('动能伤害', `+${g.kinetic}%`) : '', g.vsShield ? statRow('对护盾', `+${g.vsShield}%`) : '', g.vsArmor ? statRow('对装甲', `+${g.vsArmor}%`) : '',
    Object.keys(g.sets).map((r) => g.sets[r] >= 2 ? statRow(`${SETS[r].name}套装`, `${g.sets[r]}/4`) : '').join(''), g.grant.length ? statRow('开局自带', g.grant.map((x) => SKILLS[x] ? SKILLS[x].name : x).join('、')) : ''].join('');
  // 仓库：点一个位只列这个位；按“比身上的好多少”排序，更好的角上一个绿箭头
  const pool = [...m.gear.stash, ...m.gear.inbox].filter((it) => S.filter === 'all' || it.kind === S.filter);
  const scored = pool.map((it) => ({ it, c: Station.compare(m, it, m.current) })).sort((a, b) => (S.filter === 'all' ? QUALS[b.it.q].rank - QUALS[a.it.q].rank || b.c.total - a.c.total : b.c.total - a.c.total));
  const cells = scored.map(({ it, c }) => `<button class="gcell ${S.sel === it.uid ? 'sel' : ''} ${it.junk ? 'junk' : ''} ${it.req > m.pilot.lv ? 'req' : ''}" type="button" data-item="${it.uid}" title="${esc(Gear.name(it))}"><canvas width="56" height="56" data-gear="${it.uid}"></canvas>${c.total > 1.03 && it.req <= m.pilot.lv ? '<i class="better">▲</i>' : ''}${it.lock ? '<i class="lk">锁</i>' : ''}${it.fresh ? '<i class="new">新</i>' : ''}</button>`).join('');
  const filters = KIND_FILTERS.map(([k, n]) => `<button class="chip ${S.filter === k ? 'gold' : ''}" type="button" data-filter="${k}">${n}</button>`).join('');
  let detail = '<div class="dim-text eq-hint">点一件装备看说明；点上面的位，只看这个位的</div>';
  if (sel) {
    const it = sel.it, inEq = sel.where === 'eq', cmp = inEq ? '' : gearCompareHtml(it), old = inEq ? null : Station.compare(m, it, m.current).old;
    const acts = inEq ? `<button class="btn small" type="button" data-unequip="${sel.slot}">卸下</button>`
      : `<button class="btn small primary" type="button" data-equip="${it.uid}" ${offIf(!Station.canEquip(m, it), `需要驾驶员 ${it.req} 级`)}>换上</button>
         <button class="btn small" type="button" data-sell="${it.uid}" ${offIf(!m.unlock.shop, '商人：第一次回家后打开')}${it.lock ? offIf(true, '锁定的装备不能卖') : ''}>卖 <span class="num">${Gear.sellPrice(it)}</span></button>
         <button class="btn small" type="button" data-salv="${it.uid}" ${offIf(!m.unlock.salvage, '拆解台：第二次回家后打开')}>拆</button>
         <button class="btn small" type="button" data-junk="${it.uid}">${it.junk ? '取消垃圾' : '标垃圾'}</button><button class="btn small" type="button" data-lock="${it.uid}">${it.lock ? '解锁' : '锁定'}</button>`;
    detail = `<div class="tips">${gearTipHtml(it, { alt: S.alt })}${old ? gearTipHtml(old, { head: '身上的', alt: S.alt }) : ''}</div>${cmp}<div class="row wrap">${acts}</div><div class="dim-text" style="font-size:var(--fs-xs)">按住 Alt 看每条词条的档位和范围</div>`;
  }
  return `<div class="equip">
    <div class="eq-ship"><canvas class="eq-plane" width="200" height="200" data-plane="${m.current}" data-happy="1" data-look="1"></canvas>${GEAR_SLOTS.map(slotBtn).join('')}</div>
    <div class="eq-stats">${stats}</div>
    <div class="eq-stash"><div class="row wrap">${filters}</div><div class="gcells">${cells || '<p class="dim-text">这里还没有东西：出击，打精英和首领</p>'}</div></div>
    <div class="eq-detail">${detail}</div></div>`;
}
function cubeHtml() {
  const m = G.meta, C = G.st.cube, R = CUBE_RECIPES[C.recipe];
  const recs = Object.keys(CUBE_RECIPES).map((k) => { const X = CUBE_RECIPES[k], lock = (m.fac.cube || 1) < X.lv; return `<button class="chip ${C.recipe === k ? 'gold' : ''}" type="button" data-recipe="${k}" ${offIf(lock, `改造台 ${X.lv} 级才有`)}>${X.name}</button>`; }).join('');
  const needItem = !['scrapToShard', 'shardToCore'].includes(C.recipe);
  const ok = (it) => (C.recipe === 'rerollBlue' ? it.q === 'blue' : C.recipe === 'rerollYellow' ? it.q === 'yellow' : C.recipe === 'up1' ? (it.set || it.uni) && it.grade === 0 : C.recipe === 'up2' ? (it.set || it.uni) && it.grade === 1 : false);
  const items = needItem ? Station.allItems(m).filter(ok) : [];
  const cells = items.map((it) => `<button class="gcell ${C.uid === it.uid ? 'sel' : ''}" type="button" data-cubeitem="${it.uid}" title="${esc(Gear.name(it))}"><canvas width="56" height="56" data-gear="${it.uid}"></canvas></button>`).join('');
  const sel = C.uid && Station.find(m, C.uid), can = Station.canPay(m, R.need) && (!needItem || sel);
  const rev = G.st.reveal && G.st.revealFrom === 'cube' ? `<div class="reveal">${gearTipHtml(G.st.reveal, { head: '出来了' })}</div>` : '';
  return `<div class="row wrap">${recs}</div><p>${esc(R.line)}</p>${needItem ? `<div class="gcells small">${cells || '<span class="dim-text">没有合适的装备</span>'}</div>` : ''}
    ${sel ? gearTipHtml(sel.it, { head: '放进去的' }) : ''}<div class="row"><button class="btn primary" type="button" data-cubego ${offIf(!can, needItem && !sel ? '先选一件放进去' : Station.missing(m, R.need))}>改造 · ${esc(Station.costText(R.need))}</button></div>${rev}
    <div class="dim-text" style="font-size:var(--fs-xs)">只有整件重铸和合成，没有单条洗练。重铸出来的装备算“改过的”，不能送人</div>`;
}
function blackHtml() {
  const m = G.meta, p = Station.gamblePrice(m, false), pa = Station.gamblePrice(m, true);
  const kinds = GEAR_KIND_ORDER.map((k) => `<button class="btn small" type="button" data-gamble="${k}" ${offIf(m.credits < p, `信用点不够：还差 ${p - Math.floor(m.credits)}`)}>${GEAR_KINDS[k].name}</button>`).join('');
  const rev = G.st.reveal && G.st.revealFrom === 'black' ? `<div class="reveal">${gearTipHtml(G.st.reveal, { head: '开出来了' })}</div>` : '';
  const ships = PLANE_ORDER.filter((id) => !m.planes[id]).map((id, i) => { const price = SHIP_PRICES[Math.min(SHIP_PRICES.length - 1, Object.keys(m.planes).length - 2)] || SHIP_PRICES[0]; return `<div class="shop-item"><canvas width="56" height="56" data-plane="${id}"></canvas><div class="si-body"><b>${PLANES[id].name}</b><small class="dim-text">大招 · ${PLANES[id].burst.name}</small></div><button class="btn small" type="button" data-buyship="${id}" ${offIf(!m.unlock.hangar, '机库：驾驶员 5 级打开') || offIf(m.credits < price, `信用点不够：还差 ${price - Math.floor(m.credits)}`)}>${price}</button></div>`; }).join('');
  return `<p>买一件看不到词条的装备：先选位（${p} 信用点），或者随便来一件（${pa}）。蓝 85% · 黄 13% · 绿、金少见（黑市 ${m.fac.black || 1} 级）</p>
    <div class="row wrap">${kinds}<button class="btn small cyan" type="button" data-gamble="" ${offIf(m.credits < pa, `信用点不够：还差 ${pa - Math.floor(m.credits)}`)}>随便来一件 · ${pa}</button></div>${rev}
    ${ships ? `<div class="label">飞船</div><div class="shop-grid">${ships}</div>` : ''}`;
}
function hangarHtml() {
  const m = G.meta, free = m.unlock.hangar && !m.station.freeShip && Object.keys(m.planes).length < 2;
  const rows = PLANE_ORDER.map((id) => { const P = PLANES[id], own = !!m.planes[id]; return `<div class="shop-item ${m.current === id ? 'sel' : ''}"><canvas width="64" height="64" data-plane="${id}"></canvas><div class="si-body"><b>${P.name}</b><small class="dim-text">${P.hearts} 心 · 大招 ${P.burst.name}（${PLANE_DTYPE[id] === 'energy' ? '能量' : '动能'}）· ${P.passive.name}</small></div>${own ? `<button class="btn small ${m.current === id ? 'primary' : ''}" type="button" data-ship="${id}">${m.current === id ? '驾驶中' : '换上'}</button>` : free ? `<button class="btn small primary" type="button" data-freeship="${id}">免费挑这艘</button>` : `<span class="dim-text">黑市有卖</span>`}</div>`; }).join('');
  return `${free ? '<p class="good">驾驶员 5 级：从下面挑一艘第二艘船，免费</p>' : '<p class="dim-text">装备所有飞船共用，换船不用换装</p>'}<div class="shop-grid">${rows}</div>`;
}
function codexHtml() {
  const m = G.meta, C = m.codexGear;
  const sets = RACE_ORDER.map((r) => { const S = SETS[r], R = RACES[r], got = C.sets[r] || {}; return `<div class="cx-set"><b style="color:${R.color}">${R.name} · ${S.name}</b><span class="dim-text">${R.path} · ${R.def === 'shield' ? '护盾' : '装甲'}</span><div class="row wrap">${Object.keys(S.pieces).map((k) => `<span class="chip ${got[k] ? 'gold' : ''}">${GEAR_KINDS[k].name}${got[k] ? ' ✓' : ''}</span>`).join('')}</div></div>`; }).join('');
  const unis = UNIQUE_ORDER.map((u) => { const U = UNIQUES[u], got = C.uniques[u], src = U.only === 'priest' ? '混沌祭司' : STAGES[`${U.boss}-3`].bossName; return `<div class="cx-uni ${got ? 'got' : ''}"><b style="color:${got ? QUALS.gold.color : 'var(--mute)'}">${got ? esc(U.name) : '？？？'}</b><small>${GEAR_KINDS[U.kind].name} · 物品等级 ${U.min}+ · ${esc(src)}偏爱</small>${got ? `<small class="dim-text">${esc(U.line)}</small>` : ''}</div>`; }).join('');
  return `<div class="label">套装</div><div class="cx-sets">${sets}</div><div class="label">暗金（${Object.keys(C.uniques).length}/${UNIQUE_ORDER.length}）</div><div class="cx-unis">${unis}</div>`;
}
function starmapHtml() {
  const m = G.meta;
  return `<div class="maps">${MAP_ORDER.map((mm) => { const M = MAPS[mm], open = Station.mapOpen(m, mm), sel = (m.maps.sel || 1) === mm;
    return `<button class="map-card ${sel ? 'sel' : ''} ${open ? '' : 'locked'}" type="button" data-map="${mm}" style="--mc:${M.color}" ${offIf(!open, `打通地图 ${mm - 1} 后开放`)}><b>${mm} · ${open ? esc(M.name) : '？？？'}</b>${open ? `<small>“${esc(M.mission)}”</small><small>${M.races.slice(0, M.chaos ? 0 : 2).map((r) => RACES[r].name).join(' · ')}${M.chaos ? '七族信徒' : ''} · 首领 ${M.stages.map((id) => STAGES[id].bossName).join(' / ')}</small><small>物品等级 ${ilvlOf(mm, 1)}–${ilvlOf(mm, 3, true)}${m.maps.cleared[mm] ? ' · 已打通 · ' + esc(M.home) : ''}</small>` : '<small>还没打通上一张图</small>'}</button>`; }).join('')}</div>`;
}
/* ---------- 面板的按钮 ---------- */
function bindStationPanel(panel, id) {
  const m = G.meta, S = G.st, re = () => showStation(), save = () => { persist(); };
  $$('[data-close]', panel).forEach((b) => b.onclick = () => { Sound.sfx('uiBack'); S.panel = null; S.sel = null; S.reveal = null; re(); });
  $$('[data-facup]', panel).forEach((b) => b.onclick = () => { if (Station.facUp(m, b.dataset.facup)) { Sound.sfx('levelup'); save(); banner(`${FACILITIES[b.dataset.facup].name} ${m.fac[b.dataset.facup]} 级`, FACILITIES[b.dataset.facup].line, 1.6); G.stationScene.flash[b.dataset.facup] = G.stationScene.t; re(); } });
  $$('[data-slot]', panel).forEach((b) => b.onclick = () => { Sound.sfx('ui'); const k = SLOT_KIND[b.dataset.slot], it = m.gear.eq[b.dataset.slot]; if (S.filter === k && (!it || S.sel === it.uid)) { pulse(b); toast(it ? `${GEAR_KINDS[k].name}：${Gear.name(it)}` : `${GEAR_KINDS[k].name}还空着：仓库里没有这个位的装备就去打精英和首领`, it ? QUALS[it.q].color : '#ffe38a'); return; } if (S.filter === k && it) S.sel = it.uid; S.filter = k; re(); }); // 已经选中的再点：原地闪一下，说出它是什么
  $$('[data-filter]', panel).forEach((b) => b.onclick = () => { Sound.sfx('ui'); if (S.filter === b.dataset.filter) { pulse(b); return; } S.filter = b.dataset.filter; re(); });
  $$('[data-item]', panel).forEach((b) => b.onclick = () => { Sound.sfx('ui'); const f = Station.find(m, b.dataset.item); if (f && f.it.fresh) { f.it.fresh = false; save(); } if (S.sel === b.dataset.item) { pulse(b); return; } S.sel = b.dataset.item; re(); });
  $$('[data-equip]', panel).forEach((b) => b.onclick = () => { const r = Station.equip(m, b.dataset.equip); if (r) { Sound.sfx('slotLand', { ui: true }); save(); const it = m.gear.eq[r.slot]; toast(`换上 ${Gear.name(it)}`, QUALS[it.q].color); S.sel = it.uid; if (S.tut && S.tut.step === 3) S.tut.step = 4; re(); } });
  $$('[data-unequip]', panel).forEach((b) => b.onclick = () => { if (Station.unequip(m, b.dataset.unequip)) { Sound.sfx('uiBack'); save(); S.sel = null; re(); } else toast('仓库满了：先卖掉或拆掉一些', '#ffb2a8'); });
  $$('[data-sell]', panel).forEach((b) => b.onclick = () => { const c = Station.sell(m, b.dataset.sell); if (c) { Sound.sfx('coin'); toast(`卖掉了 · 信用点 +${c}`, '#ffd27a'); save(); S.sel = null; re(); } });
  $$('[data-salv]', panel).forEach((b) => b.onclick = () => { const g = Station.salvage(m, b.dataset.salv); if (g) { Sound.sfx('armorBreak'); toast(`拆出 ${Station.costText(g)}`, '#9fd0ff'); save(); S.sel = null; re(); } });
  $$('[data-junk]', panel).forEach((b) => b.onclick = () => { const f = Station.find(m, b.dataset.junk); if (f) { f.it.junk = !f.it.junk; if (f.it.junk) f.it.lock = false; Sound.sfx('ui'); save(); re(); } });
  $$('[data-lock]', panel).forEach((b) => b.onclick = () => { const f = Station.find(m, b.dataset.lock); if (f) { f.it.lock = !f.it.lock; if (f.it.lock) f.it.junk = false; Sound.sfx('ui'); save(); re(); } });
  $$('[data-junkall]', panel).forEach((b) => b.onclick = () => { const g = Station.salvageJunk(m); Sound.sfx('armorBreak'); toast(`拆出 ${Station.costText(g) || '没有东西'}`, '#9fd0ff'); save(); S.sel = null; re(); });
  $$('[data-auto]', panel).forEach((b) => b.onchange = () => { m.gear.auto[b.dataset.auto] = b.checked; Sound.sfx('ui'); save(); });
  $$('[data-buy]', panel).forEach((b) => b.onclick = () => { const it = Station.buy(m, +b.dataset.buy); if (it) { Sound.sfx('coin'); toast(`买下 ${Gear.name(it)}`, QUALS[it.q].color); save(); re(); } });
  $$('[data-recipe]', panel).forEach((b) => b.onclick = () => { Sound.sfx('ui'); if (S.cube.recipe === b.dataset.recipe) { pulse(b); return; } S.cube.recipe = b.dataset.recipe; S.cube.uid = null; S.reveal = null; re(); });
  $$('[data-cubeitem]', panel).forEach((b) => b.onclick = () => { Sound.sfx('ui'); S.cube.uid = b.dataset.cubeitem; re(); });
  $$('[data-cubego]', panel).forEach((b) => b.onclick = () => { const r = Station.cube(m, S.cube.recipe, S.cube.uid); if (r.err) { toast(r.err, '#ffb2a8'); return; } Sound.sfx(r.item && QUALS[r.item.q].rank >= 3 ? 'lootGreen' : 'lootYellow'); save(); if (r.item) { S.reveal = r.item; S.revealFrom = 'cube'; S.cube.uid = r.item.uid; } else toast(`合成 ${Station.costText(r.mats)}`, '#9fd0ff'); re(); });
  $$('[data-gamble]', panel).forEach((b) => b.onclick = () => { const it = Station.gamble(m, b.dataset.gamble || null); if (!it) return; Sound.sfx({ blue: 'lootBlue', yellow: 'lootYellow', green: 'lootGreen', gold: 'lootGold' }[it.q] || 'lootBlue'); save(); S.reveal = it; S.revealFrom = 'black'; re(); });
  $$('[data-buyship]', panel).forEach((b) => b.onclick = () => { const id = b.dataset.buyship, price = SHIP_PRICES[Math.min(SHIP_PRICES.length - 1, Object.keys(m.planes).length - 2)] || SHIP_PRICES[0]; if (m.credits < price) return; m.credits -= price; m.planes[id] = newPlaneRecord(id); Sound.sfx('levelup'); save(); banner(`获得 ${PLANES[id].name}`, `大招 · ${PLANES[id].burst.name}`, 2); re(); });
  $$('[data-freeship]', panel).forEach((b) => b.onclick = () => { const id = b.dataset.freeship; m.planes[id] = newPlaneRecord(id); m.station.freeShip = id; Sound.sfx('levelup'); save(); banner(`获得 ${PLANES[id].name}`, `大招 · ${PLANES[id].burst.name}`, 2); re(); });
  $$('[data-ship]', panel).forEach((b) => b.onclick = () => { if (m.current === b.dataset.ship) { pulse(b); return; } m.current = b.dataset.ship; Sound.sfx('select'); save(); re(); });
  $$('[data-map]', panel).forEach((b) => b.onclick = () => { const mm = +b.dataset.map; if ((m.maps.sel || 1) === mm) { pulse(b); return; } m.maps.sel = mm; m.maps.start = MAPS[mm].stages[0]; Sound.sfx('ui'); save(); re(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Alt' && G.screen === 'hub' && G.st.panel && !G.st.alt) { G.st.alt = true; e.preventDefault(); showStation(); } });
document.addEventListener('keyup', (e) => { if (e.key === 'Alt' && G.st.alt) { G.st.alt = false; if (G.screen === 'hub') showStation(); } });
