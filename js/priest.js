'use strict';
/* 混沌祭司（临时名，docs/design.md §9.5）：基础版终局首领，第 5 张图第 3 关。接口和失控主钟一样（update / draw / hit / hudInfo …）。
   1 布道：两侧召来两个族的信徒，信徒在时他有护盾罩；颂词环（慢弹环，两道缺口缓缓转）——先拆掩护再打他。
   2 静默：横向的静默带先闪 1.2 秒杂讯，然后 3 秒里带子里的飞机打不出子弹（不伤人）；低语弹瞄你；照搬你这一局的联动打回来一次。
   3 失序：防御每 8 秒在护盾和装甲之间换（换之前闪 1 秒）；静默带和颂词环一起来；剩四分之一血时转出一道慢慢旋转的布道光，缺口看得见。 */
const PRIEST_PHASES = {
  1: { name: '第一段 · 布道', music: 'boss1' },
  2: { name: '第二段 · 静默', music: 'boss2' },
  3: { name: '终段 · 失序', music: 'boss3' },
};
class ChaosPriestBoss {
  constructor(w) {
    this.w = w; this.t = 0;
    this.homeX = w.W * 0.76; this.homeY = (TOP + BOTTOM) / 2 - 10;
    this.x = w.W + 300; this.y = this.homeY;
    this.hp = 1000; this.maxHp = 1000; this.phase = 1; this.alive = true; this.dying = 0;
    this.weakT = 0; this.weakCd = 0; this.hitFlash = 0; this.shield = 0; this.shieldMax = 1; this.guard = false;
    this.gen = null; this.wait = 0; this.cycleIdx = 0; this.tempo = 1; this.phaseT = 0; this.transT = 0; this.fightT = 0;
    this.bands = []; this.defT = 8; this.defWarn = 0; this.beam = null; this.beamDone = false; this.mirrored = false;
    this.conductive = false; this.marked = false; this.iceHands = false; this.swing = 0;
    this.rings = [0, 1, 2].map((i) => ({ a: i * 2.1, s: 0.3 + i * 0.15, r: 120 + i * 26 }));
    Sound.sfx('alarm');
  }
  get dens() { return (t, n) => this.w.dens(t, n); }
  targetable() { return this.alive && !this.dying && this.x < this.w.W - 20; }
  cycle() {
    if (this.phase === 1) return ['acolytes', 'hymn', 'whisper', 'hymn', 'kneel'];
    if (this.phase === 2) return ['silence', 'whisper', 'hymn', 'mirror', 'silence', 'kneel'];
    return ['silence', 'hymn', 'whisper', 'silence', 'hymnFast', 'kneel'];
  }
  update(dt) {
    const w = this.w;
    this.t += dt; this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.weakCd = Math.max(0, this.weakCd - dt); this.swing += dt;
    for (const r of this.rings) r.a += dt * r.s * (this.phase === 3 ? -1.6 : 1);
    this.x = smooth(this.x, this.homeX + Math.sin(this.t * 0.4) * 24, w.bossIntroT > 0 ? 1.3 : 2.6, dt);
    this.y = smooth(this.y, this.homeY + Math.sin(this.t * 0.7) * 26, 2.6, dt);
    this.bands = this.bands.filter((b) => b.t < b.warn + b.dur); for (const b of this.bands) b.t += dt;
    if (this.dying > 0) return this.updateDeath(dt);
    if (w.timeStop > 0) return;
    if (this.weakT > 0) this.weakT -= dt;
    if (w.state !== 'play' || w.bossIntroT > 0) return;
    this.fightT += dt; this.phaseT += dt;
    if (this.transT > 0) { this.transT -= dt; if (this.transT <= 0) this.beginPhase(); return; }
    const adds = w.enemies.filter((e) => e.alive && e.bossAdd).length;
    if (this.guard && adds === 0) { this.guard = false; Sound.sfx('weakOpen'); w.emit('flag', { text: '信徒散了 · 祭司的结界没了', color: 'white', dur: 1.4 }); }
    if (this.phase === 3) { // 防御在护盾和装甲之间换（先闪 1 秒）
      this.defT -= dt;
      if (this.defT <= 1 && !this.defWarn) { this.defWarn = 1; w.emit('flag', { text: this.def === 'shield' ? '外壳要变成装甲了' : '外壳要变成护盾了', color: 'white', dur: 1 }); Sound.sfx('warn'); }
      if (this.defT <= 0) { this.defT = 8; this.defWarn = 0; this.def = this.def === 'shield' ? 'armor' : 'shield'; this.hitFlash = 1; Sound.sfx('phase'); }
      if (!this.beamDone && this.hp <= this.maxHp * 0.25 && !this.beam && !this.gen) { this.beamDone = true; this.gen = this.atk_beam(); this.wait = 0; }
    }
    if (this.beam) this.updateBeam(dt);
    if (!this.gen) this.nextAttack();
    if (!this.guard) w.bossRegen(this, [1000, 650, 300][this.phase - 1], dt);
    this.wait -= dt * this.tempo * w.bossRageK(this);
    while (this.gen && this.wait <= 0) { const r = this.gen.next(); if (r.done) { this.gen = null; break; } this.wait += r.value; }
  }
  nextAttack() { const L = this.cycle(), name = L[this.cycleIdx++ % L.length]; this.gen = this['atk_' + name](); this.wait = 0.2; }
  /* 静默带里的飞机打不出子弹（world.updatePlayer 问这里） */
  jammed(p) { for (const b of this.bands) if (b.t > b.warn && p.y > b.y0 && p.y < b.y1) return true; return false; }
  /* ---------- 招式 ---------- */
  *atk_acolytes() {
    const w = this.w, M = MAPS[5], picks = [M.races[(this.cycleIdx * 3) % M.races.length], M.races[(this.cycleIdx * 3 + 2) % M.races.length]];
    w.emit('flag', { text: '祭司召来了信徒 · 先打信徒，结界才会散', color: 'white', dur: 1.6 });
    for (let i = 0; i < 2; i++) { const ty = i ? w.arena.bottom - 110 : w.arena.top + 110; w.addEnemy(i ? 'tickE' : 'starE', { x: w.W + 60, y: ty, path: 'mirror', tx: w.W * 0.6, ty, fireT: 2 + i, bossAdd: true, race: picks[i], hp: 260 * w.foeHpK(), life: 60 }); }
    this.guard = true; yield 1.2;
  }
  *atk_hymn() { // 颂词环：慢弹环，两道缺口，一环比一环转一点
    const n = 22; let gap = srandi(0, n - 1);
    for (let k = 0; k < 3; k++) { for (let i = 0; i < n; i++) { if (i === gap || i === (gap + 1) % n || i === (gap + 2) % n) continue; this.w.fire(k % 2 ? 'blue' : 'pink', this.x, this.y, (i / n) * TAU + k * 0.05, 120, { silent: i > 0 }); } gap = (gap + 2) % n; yield 0.9; }
    yield 0.6;
  }
  *atk_hymnFast() { const n = 26; for (let k = 0; k < 4; k++) { const gap = srandi(0, n - 1); for (let i = 0; i < n; i++) { if (Math.abs(i - gap) < 2) continue; this.w.fire('pink', this.x, this.y, (i / n) * TAU + this.t, 150, { silent: i > 0 }); } yield 0.6; } yield 0.6; }
  *atk_whisper() { for (let k = 0; k < 3; k++) { this.w.fire('gold', this.x - 60, this.y, this.w.aimAngle(this.x, this.y), 220); yield 0.35; } yield 0.7; }
  *atk_silence() { // 静默带：先闪 1.2 秒杂讯，再 3 秒打不出子弹
    const w = this.w, top = w.arena.top, bot = w.arena.bottom, h = (bot - top) * (this.phase === 3 ? 0.28 : 0.34), q = w.pickTarget(), y0 = clamp(q.y - h / 2 + srand(-40, 40), top, bot - h);
    this.bands.push({ y0, y1: y0 + h, t: 0, warn: 1.2 + w.diff.warnBonus, dur: 3 });
    w.emit('flag', { text: '静默带 · 待在里面打不出子弹', color: 'white', dur: 1.2 }); Sound.sfx('warn');
    yield 1.6;
  }
  *atk_mirror() { // 照搬你这一局的联动打回来一次
    const w = this.w, p = w.pickTarget(), lk = p && [...p.links][0];
    if (!this.mirrored && lk) { this.mirrored = true; w.emit('flag', { text: `祭司照搬了你的「${SYNERGIES[lk].name}」`, color: 'gold', dur: 1.6 }); }
    const a0 = w.aimAngle(this.x, this.y);
    for (let k = 0; k < 2; k++) { for (let i = -3; i <= 3; i++) w.fire(i % 2 ? 'blue' : 'gold', this.x - 50, this.y, a0 + i * 0.14, 180 + k * 30, { silent: i !== 0 }); yield 0.5; }
    yield 0.8;
  }
  *atk_kneel() { this.weakT = 2.4; this.w.emit('flag', { text: '祭司在祷告 · 面具露出来了', color: 'white', dur: 1.4 }); Sound.sfx('weakOpen'); yield 2.5; }
  *atk_beam() { // 终段：一道慢慢旋转的布道光，从上往下扫过左半边，缺口看得见
    const w = this.w, warn = 1.4 + w.diff.warnBonus, len = Math.max(560, this.x - 60);
    w.emit('flag', { text: '布道光 · 找它的缺口', color: 'gold', dur: 1.4 });
    w.addWarn({ kind: 'arc', x: this.x, y: this.y, a0: Math.PI - 1.1, a1: Math.PI + 1.1, len, tWarn: warn, follow: this });
    yield warn;
    this.beam = { t: 0, dur: 5, a0: Math.PI - 1.1, a1: Math.PI + 1.1, len, gap: 0.5 + srand(0, 0.4) };
    Sound.sfx('laser'); yield 5.4;
  }
  updateBeam(dt) {
    const B = this.beam, w = this.w; B.t += dt;
    const u = Ease.inOutSine(clamp(B.t / B.dur, 0, 1)); B.a = lerp(B.a0, B.a1, u);
    if (w.state === 'play') for (const q of w.players) {
      if (!q.alive || q.gone || q.inv > 0) continue;
      const ex = this.x + Math.cos(B.a) * B.len, ey = this.y + Math.sin(B.a) * B.len, d = Math.hypot(q.x - this.x, q.y - this.y) / B.len;
      if (d > B.gap && d < B.gap + 0.16) continue; // 缺口
      if (segDist2(q.x, q.y, this.x, this.y, ex, ey) < (14 + q.r) * (14 + q.r)) w.hurtPlayer(1, 'c:boss', q);
    }
    if (B.t >= B.dur) this.beam = null;
  }
  exposeWeak(s) { this.weakT = Math.max(this.weakT, s); }
  freezeHands(s) { this.weakT = Math.max(this.weakT, s * 0.6); }
  openFromExplosion() { if (this.weakCd > 0) return; this.weakCd = 5; this.weakT = Math.max(this.weakT, 1.2); }
  /* ---------- 伤害与阶段 ---------- */
  hit(o) {
    const w = this.w;
    if (!this.alive || this.dying || this.transT > 0 || w.state !== 'play' || w.bossIntroT > 0) return;
    const weak = this.weakT > 0;
    let k = this.guard ? 0.15 : weak ? 1 : 0.55; if (o.kind === 'burst') k = Math.max(k, 0.6);
    const dmg = o.dmg * k * BOSS_DMG_K;
    this.hitFlash = Math.min(1, this.hitFlash + 0.25);
    this.hp -= dmg;
    if (this.phase === 1 && this.hp <= 650) { this.hp = 650; this.startTransition(2); }
    else if (this.phase === 2 && this.hp <= 300) { this.hp = 300; this.startTransition(3); }
    else if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  startTransition(n) {
    const w = this.w; this.nextPhase = n; this.transT = 1.9; this.gen = null; this.beam = null; this.weakT = 0; this.bands = [];
    w.clearEnemyBullets(true); w.warns = []; w.shake(0.8); w.flash = Math.max(w.flash, 0.55); w.hitStop(0.06); Sound.sfx('phase');
    for (let i = 0; i < 26; i++) w.part(i % 2 ? 'shard' : 'dot', this.x, this.y, rand(-380, 380), rand(-380, 200), 1.2, rand(5, 9), pick(['#d6b8ff', '#ffd76a', '#8a6ad8']));
    w.emit('phase', { n, name: PRIEST_PHASES[n].name }); w.bossBreak(this.x, this.y); if (w.planeId === 'clock') w.onBossPhase(0);
  }
  beginPhase() {
    const w = this.w; this.phase = this.nextPhase; this.phaseT = 0; this.cycleIdx = 0;
    Sound.setMode(PRIEST_PHASES[this.phase].music);
    if (this.phase === 3) { this.defT = 8; this.def = 'shield'; }
    if (this.phase === 2) w.onBossPhase(2);
  }
  die() { const w = this.w; this.dying = 3.2; this.gen = null; this.beam = null; this.bands = []; w.clearEnemyBullets(true); w.warns = []; w.slowT = 1.8; w.shake(1); w.flash = 0.6; Sound.sfx('boom'); }
  updateDeath(dt) {
    const w = this.w; this.dying -= dt; this.hitFlash = 0.6 + Math.sin(this.t * 30) * 0.4; w.bossDyingPops(this, 3.2);
    if (Math.random() < 0.6) w.part(pick(['shard', 'dot']), this.x + rand(-110, 110), this.y + rand(-120, 120), rand(-260, 260), rand(-300, 100), 1.2, rand(4, 9), pick(['#d6b8ff', '#ffd76a', '#ffffff']));
    if (this.dying <= 0) { this.alive = false; w.shake(0.6); Sound.sfx('win'); w.emit('relay', {}); w.onBossDead(); }
  }
  hudInfo() { return { name: this.w.stage.bossName || '混沌祭司', def: this.def, phase: this.transT > 0 ? this.nextPhase : this.phase, phaseName: PRIEST_PHASES[this.transT > 0 ? this.nextPhase : this.phase].name, hp: this.hp, maxHp: this.maxHp, shield: this.guard ? 1 : 0, shieldMax: 1, weak: this.weakT > 0 }; }
  draw(g) {
    if (!this.alive) return;
    const w = this.w, t = this.t;
    for (const b of this.bands) { // 静默带：先闪杂讯，再变成一条灰白的带子
      const on = b.t > b.warn, a = on ? 0.32 : 0.12 + 0.12 * Math.sin(b.t * 30);
      g.fillStyle = on ? `rgba(200,190,230,${a})` : `rgba(255,95,135,${a})`; g.fillRect(0, b.y0, w.W, b.y1 - b.y0);
      g.strokeStyle = on ? 'rgba(230,220,255,0.6)' : 'rgba(255,95,135,0.8)'; g.lineWidth = 2; g.setLineDash([16, 10]); g.lineDashOffset = -t * 60; g.beginPath(); g.moveTo(0, b.y0); g.lineTo(w.W, b.y0); g.moveTo(0, b.y1); g.lineTo(w.W, b.y1); g.stroke(); g.setLineDash([]);
      for (let i = 0; i < (on ? 26 : 10); i++) { const x = (i * 97 + t * (on ? 300 : 900)) % w.W, y = b.y0 + ((i * 53) % Math.max(1, b.y1 - b.y0)); g.fillStyle = `rgba(255,255,255,${on ? 0.35 : 0.2})`; g.fillRect(x, y, 18 + (i % 3) * 10, 1.6); }
      if (on) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '18px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif'; g.textAlign = 'left'; g.fillText('静默 · 打不出子弹', 18, b.y0 + 24); }
    }
    if (this.beam) { const B = this.beam, ex = this.x + Math.cos(B.a) * B.len, ey = this.y + Math.sin(B.a) * B.len, gx0 = this.x + Math.cos(B.a) * B.len * B.gap, gy0 = this.y + Math.sin(B.a) * B.len * B.gap, gx1 = this.x + Math.cos(B.a) * B.len * (B.gap + 0.16), gy1 = this.y + Math.sin(B.a) * B.len * (B.gap + 0.16);
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      for (const [x0, y0, x1, y1] of [[this.x, this.y, gx0, gy0], [gx1, gy1, ex, ey]]) { g.strokeStyle = 'rgba(214,184,255,0.4)'; g.lineWidth = 40; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.strokeStyle = 'rgba(255,250,230,0.95)'; g.lineWidth = 14; g.stroke(); }
      g.globalCompositeOperation = 'source-over'; }
    drawPriest(g, this, t);
    if (this.transT > 0) { const u = 1 - this.transT / 1.9; g.strokeStyle = `rgba(214,184,255,${1 - u})`; g.lineWidth = 6; g.beginPath(); g.arc(this.x, this.y, 130 + u * 260, 0, TAU); g.stroke(); }
  }
}
/* 祭司的样子：胖乎乎的钟形长袍、兜帽里一张瓷白的面具、头顶三圈断开的信号环；手里一只摆动的“干扰香炉” */
function drawPriest(g, b, t) {
  const x = b.x, y = b.y, ph = b.phase || 1, def = b.def, flash = b.hitFlash || 0;
  g.save(); g.translate(x, y);
  g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, -20, 240, ph === 3 ? (def === 'armor' ? 'rgba(200,200,220,0.6)' : 'rgba(110,190,255,0.6)') : 'rgba(150,90,255,0.6)', 0.35 + 0.1 * Math.sin(t * 2)); g.globalCompositeOperation = 'source-over';
  for (const r of (b.rings || [])) { g.save(); g.rotate(r.a); g.strokeStyle = 'rgba(255,215,106,0.7)'; g.lineWidth = 3; for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(0, -60, r.r, r.r * 0.36, 0, k * 2.1, k * 2.1 + 1.4); g.stroke(); } g.restore(); }
  // 长袍
  const robe = g.createLinearGradient(0, -120, 0, 110); robe.addColorStop(0, '#3a2260'); robe.addColorStop(0.6, '#1c0f30'); robe.addColorStop(1, '#0a0614');
  g.fillStyle = robe; g.strokeStyle = '#120a20'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(-40, -90); g.quadraticCurveTo(-70, 0, -98, 96); g.quadraticCurveTo(-50, 118, 0, 110); g.quadraticCurveTo(50, 118, 98, 96); g.quadraticCurveTo(70, 0, 40, -90); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = '#d9a443'; g.lineWidth = 4; g.beginPath(); g.moveTo(-98, 96); g.quadraticCurveTo(-50, 118, 0, 110); g.quadraticCurveTo(50, 118, 98, 96); g.stroke();
  g.strokeStyle = 'rgba(217,164,67,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -60); g.lineTo(0, 106); g.stroke();
  for (let i = 0; i < 4; i++) { const yy = -20 + i * 30; g.fillStyle = '#d9a443'; g.beginPath(); g.arc(0, yy, 4, 0, TAU); g.fill(); }
  if (ph === 3) { g.fillStyle = def === 'armor' ? 'rgba(150,150,170,0.35)' : 'rgba(110,190,255,0.25)'; g.beginPath(); g.moveTo(-60, -40); g.quadraticCurveTo(-80, 40, -88, 90); g.lineTo(88, 90); g.quadraticCurveTo(80, 40, 60, -40); g.closePath(); g.fill(); }
  // 兜帽
  g.fillStyle = '#2a1648'; g.strokeStyle = '#120a20'; g.lineWidth = 4; g.beginPath(); g.moveTo(-58, -64); g.quadraticCurveTo(-60, -150, 0, -158); g.quadraticCurveTo(60, -150, 58, -64); g.quadraticCurveTo(0, -48, -58, -64); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#0a0612'; g.beginPath(); g.ellipse(0, -96, 40, 46, 0, 0, TAU); g.fill();
  // 面具：瓷白，一道裂缝，两只小眼睛；祷告（弱点）时眼睛亮
  const mg = g.createLinearGradient(0, -136, 0, -60); mg.addColorStop(0, '#fffaf2'); mg.addColorStop(1, '#cfc4da');
  g.fillStyle = flash > 0.5 ? '#ffffff' : mg; g.beginPath(); g.ellipse(0, -96, 30, 36, 0, 0, TAU); g.fill(); g.strokeStyle = '#5a3a7a'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = '#3a2252'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(8, -130); g.lineTo(2, -112); g.lineTo(10, -100); g.lineTo(4, -86); g.stroke();
  const weak = b.weakT > 0;
  for (const s of [-1, 1]) { g.fillStyle = weak ? '#ffd76a' : '#2a1648'; g.beginPath(); g.ellipse(s * 11, -98, 4.6, weak ? 6 : 2.4, 0, 0, TAU); g.fill(); if (weak) { g.globalCompositeOperation = 'lighter'; drawGlow(g, s * 11, -98, 18, 'rgba(255,215,106,0.9)', 0.8); g.globalCompositeOperation = 'source-over'; } }
  g.strokeStyle = '#8a7aa0'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-6, -78); g.quadraticCurveTo(0, -75, 6, -78); g.stroke();
  // 手和干扰香炉（摆动、冒杂讯）
  const sw = Math.sin(b.swing * 1.6) * 0.5;
  g.save(); g.translate(-62, -6); g.rotate(sw);
  g.strokeStyle = '#d9a443'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 46); g.stroke();
  g.fillStyle = '#5a4a2a'; g.strokeStyle = '#d9a443'; g.beginPath(); g.ellipse(0, 54, 12, 10, 0, 0, TAU); g.fill(); g.stroke();
  for (let i = 0; i < 4; i++) { const k = (t * 1.3 + i / 4) % 1; g.fillStyle = `rgba(214,184,255,${0.5 * (1 - k)})`; g.fillRect(-8 + Math.sin(i * 3 + t * 5) * 6, 44 - k * 50, 14, 2); }
  g.restore();
  g.fillStyle = '#e8dccf'; g.strokeStyle = '#120a20'; g.lineWidth = 2; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 62, -8, 10, 8, 0, 0, TAU); g.fill(); g.stroke(); }
  if (b.guard) { g.strokeStyle = `rgba(200,180,255,${0.6 + Math.sin(t * 8) * 0.2})`; g.lineWidth = 5; g.beginPath(); g.ellipse(0, -10, 150, 180, 0, 0, TAU); g.stroke(); }
  g.restore();
}
