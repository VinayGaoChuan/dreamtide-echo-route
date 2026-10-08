'use strict';
/* 第 2–4 张图的大首领（docs/design.md §9.5）：霜巢女王（2-3）、弧光董事会（3-3）、熔炉元帅（4-3）。接口和失控主钟、缄默主教一样
   （update / draw / hit / hudInfo …）。生命 1000，650 / 300 换阶段；每阶段换一种躲法，攻击从本图族的招牌敌人长出来，最后比开头更激烈。
   规则全用这一局的随机数，联机各端一样。 */
const BIG_BOSS_OF = { '2-3': 'queen', '3-3': 'board', '4-3': 'general' };
const BIG_BOSS = {
  queen: { race: 'frost', color: '#bfe9ff', phases: { 1: '第一段 · 冰墙阵', 2: '第二段 · 冰棱雨', 3: '终段 · 冰封' }, intro: '冰板从右往左推，缝在移动',
    cycles: { 1: ['wall', 'shards', 'crown', 'shards', 'weak'], 2: ['hail', 'shards', 'wall', 'hail', 'crown', 'weak'], 3: ['freeze', 'hail', 'crownFast', 'wall', 'shards', 'weak'] } },
  board: { race: 'arc', color: '#3ef0ff', phases: { 1: '第一段 · 供电塔', 2: '第二段 · 接口', 3: '终段 · 过载' }, intro: '先打掉四座供电塔，护盾才会掉',
    cycles: { 1: ['pylons', 'spark', 'grid', 'spark', 'weak', 'grid', 'spark', 'weak'], 2: ['ports', 'grid', 'spark', 'ports', 'ring', 'weak'], 3: ['pylons', 'grid', 'ring', 'ports', 'spark', 'grid', 'weak', 'ports'] } },
  general: { race: 'forge', color: '#ff7a3a', phases: { 1: '第一段 · 炮击', 2: '第二段 · 履带冲锋', 3: '终段 · 熔炉开门' }, intro: '看红圈：炮弹落在那里',
    cycles: { 1: ['barrage', 'rockets', 'barrage', 'rockets', 'weak'], 2: ['charge', 'barrage', 'rockets', 'charge', 'weak'], 3: ['door', 'embers', 'barrage', 'charge', 'embers', 'door'] } },
};
class BigBoss {
  constructor(w, kind) {
    this.w = w; this.kind = kind; this.C = BIG_BOSS[kind]; this.C.color = this.C.color || '#ffffff'; this.t = 0;
    this.homeX = w.W * 0.76; this.homeY = (TOP + BOTTOM) / 2 - 6;
    this.x = w.W + 300; this.y = this.homeY; this.radius = 112;
    this.hp = 1000; this.maxHp = 1000; this.phase = 1; this.alive = true; this.dying = 0;
    this.weakT = 0; this.weakCd = 0; this.hitFlash = 0; this.shield = 0; this.shieldMax = 1; this.guard = false;
    this.gen = null; this.wait = 0; this.cycleIdx = 0; this.tempo = 1; this.phaseT = 0; this.transT = 0; this.fightT = 0;
    this.conductive = false; this.marked = false; this.iceHands = false;
    this.freezeRing = null; this.dash = null; this.door = 0; this.ports = 0; this.portIdx = -1;
    Sound.sfx('alarm');
  }
  get introSub() { return `${this.C.phases[1]} · ${this.C.intro}`; }
  targetable() { return this.alive && !this.dying && this.x < this.w.W - 20; }
  cycle() { return this.C.cycles[this.phase]; }
  update(dt) {
    const w = this.w;
    this.t += dt; this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.weakCd = Math.max(0, this.weakCd - dt);
    if (this.dash) this.updateDash(dt);
    else { this.x = smooth(this.x, this.homeX + Math.sin(this.t * 0.5) * 22, w.bossIntroT > 0 ? 1.3 : 2.6, dt); this.y = smooth(this.y, this.homeY + Math.sin(this.t * 0.8) * 30, 2.4, dt); }
    if (this.dying > 0) return this.updateDeath(dt);
    if (w.timeStop > 0) return;
    if (this.weakT > 0) this.weakT -= dt;
    this.door = smooth(this.door, this.weakT > 0 && this.kind === 'general' ? 1 : 0, 6, dt);
    if (w.state !== 'play' || w.bossIntroT > 0) return;
    this.fightT += dt; this.phaseT += dt;
    if (this.transT > 0) { this.transT -= dt; if (this.transT <= 0) this.beginPhase(); return; }
    const adds = w.enemies.filter((e) => e.alive && e.bossAdd).length;
    if (this.guard && adds === 0) { this.guard = false; this.weakT = Math.max(this.weakT, 2.5); Sound.sfx('weakOpen'); w.emit('flag', { text: '供电塔全倒了 · 护盾掉了', color: 'white', dur: 1.4 }); }
    if (this.freezeRing) this.updateFreeze(dt);
    if (!this.gen) this.nextAttack();
    if (!this.guard) w.bossRegen(this, [1000, 650, 300][this.phase - 1], dt);
    this.wait -= dt * this.tempo * w.bossRageK(this);
    while (this.gen && this.wait <= 0) { const r = this.gen.next(); if (r.done) { this.gen = null; break; } this.wait += r.value; }
  }
  nextAttack() { const L = this.cycle(), name = L[this.cycleIdx++ % L.length]; this.gen = this['atk_' + name](); this.wait = 0.2; }
  /* ---------- 共用的招式件 ---------- */
  blast(x, y, r, warn, from) { // 落点先亮圈，再炸（迫击炮、冰棱都用它）
    const w = this.w, col = this.kind === 'queen' ? ['#dff6ff', '#9fe8ff', '#ffffff'] : ['#ff9a40', '#ffd27a', '#ff5a3a'];
    w.addWarn({ kind: 'blast', x, y, r, tWarn: warn + w.diff.warnBonus, from, ice: this.kind === 'queen', silent: true, onFire: (q) => {
      for (const p of w.players) if (p.alive && !p.gone && !p.away && dist2(p.x, p.y, q.x, q.y) < (q.r + 10) * (q.r + 10)) w.hurtPlayer(1, 'b:boss', p);
      if (w.mine()) { w.fx(q.x, q.y, 2, q.r, col); Sound.sfx('boom', { pan: w.pan(q.x), gap: 80 }); }
    } });
  }
  fan(n, spread, spd, type) { const a0 = this.w.aimAngle(this.x, this.y); for (let i = 0; i < n; i++) this.w.fire(type || 'blue', this.x - 60, this.y, a0 + (i - (n - 1) / 2) * spread, spd, { silent: i > 0 }); }
  ringShot(n, spd, gapW, type) { const gap = srandi(0, n - 1), off = srand(TAU); for (let i = 0; i < n; i++) { if ((i - gap + n) % n < gapW) continue; this.w.fire(type || 'pink', this.x, this.y, off + (i / n) * TAU, spd, { silent: i > 0 }); } }
  *atk_weak() { // 喘口气：弱点露出来 2.4 秒（每阶段至少一次）
    this.weakT = 2.4; const txt = { queen: '女王在喘气 · 冠冕露出来了', board: '董事在重启 · 胸口的接口亮了', general: '元帅在装弹 · 熔炉门开了' }[this.kind];
    this.w.emit('flag', { text: txt, color: 'white', dur: 1.4 }); Sound.sfx('weakOpen'); yield 2.5;
  }
  /* ---------- 霜巢女王 ---------- */
  *atk_wall() { this.w.emit('flag', { text: '冰墙推过来了 · 从缝里过', color: 'white', dur: 1.2 }); this.w.spawnRaceFoe('icewall'); yield 2.2; }
  *atk_shards() { for (let k = 0; k < 3; k++) { this.fan(5, 0.16, 190 + k * 20, 'blue'); yield 0.45; } yield 0.6; }
  *atk_crown() { for (let k = 0; k < 3; k++) { this.ringShot(20, 120, 3, k % 2 ? 'blue' : 'pink'); yield 0.8; } yield 0.5; }
  *atk_crownFast() { for (let k = 0; k < 4; k++) { this.ringShot(24, 150, 3, 'blue'); yield 0.55; } yield 0.6; }
  *atk_hail() { // 冰棱雨：一排落点先结霜，再一根根砸下来
    const w = this.w, q = w.pickTarget(), n = this.phase === 3 ? 6 : 5, x0 = clamp(q.x - 200, 60, w.W * 0.55);
    w.emit('flag', { text: '冰棱雨 · 离开结霜的圈', color: 'white', dur: 1.1 });
    for (let i = 0; i < n; i++) { this.blast(x0 + i * 90, clamp(q.y + srand(-90, 90), w.arena.top + 40, w.arena.bottom - 40), 52, 1.0 + i * 0.12, { x: x0 + i * 90, y: w.arena.top - 40 }); yield 0.12; }
    yield 1.4;
  }
  *atk_freeze() { // 冰封：闪三下，只有她身边那一圈是安全的
    const w = this.w; this.freezeRing = { t: 0, warn: 1.8 + w.diff.warnBonus, r0: 130, r1: 250, done: false };
    w.emit('flag', { text: '冰封 · 飞进她身边那一圈', color: 'white', dur: 1.6 }); Sound.sfx('warn');
    yield 2.8;
  }
  updateFreeze(dt) {
    const F = this.freezeRing, w = this.w; F.t += dt;
    if (!F.done && F.t >= F.warn) {
      F.done = true; w.flash = Math.max(w.flash, 0.5 * w.flashK()); w.flashColor = '210,245,255'; Sound.sfx('freeze');
      for (const p of w.players) { if (!p.alive || p.gone || p.away) continue; const d = Math.hypot(p.x - this.x, p.y - this.y); if (d < F.r0 || d > F.r1) w.hurtPlayer(1, 'b:boss', p); }
    }
    if (F.t > F.warn + 0.6) this.freezeRing = null;
  }
  /* ---------- 弧光董事会 ---------- */
  *atk_pylons() { // 四座供电塔：上下两对，塔在时董事有护盾
    const w = this.w; if (w.enemies.some((e) => e.alive && e.bossAdd)) { yield 0.2; return; } // 上一组还没拆完：不叠第二组
    w.emit('flag', { text: '供电塔 · 打掉任一座，那一道电就断', color: 'white', dur: 1.4 });
    for (const [ya, yb, tx] of [[w.arena.top + 40, w.arena.top + 210, w.W * 0.56], [w.arena.bottom - 210, w.arena.bottom - 40, w.W * 0.64]]) {
      const a = w.addEnemy('pylon', { x: w.W + 40, y: ya, path: 'pylon', tx, tough: true, bossAdd: true, race: 'arc', hp: 70 * w.foeHpK(), life: 60 });
      const b = w.addEnemy('pylon', { x: w.W + 40, y: yb, path: 'pylon', tx, tough: true, bossAdd: true, race: 'arc', hp: 70 * w.foeHpK(), life: 60 });
      a.mate = b.id; b.mate = a.id; a.arcT = -0.9; a.lead = true; a.maxHp = a.hp; b.maxHp = b.hp;
    }
    this.guard = true; yield 1.6;
  }
  *atk_spark() { for (let k = 0; k < 4; k++) { this.w.fire('gold', this.x - 60, this.y, this.w.aimAngle(this.x, this.y), 240); yield 0.3; } yield 0.6; }
  *atk_grid() { // 电网：横着扫过来的几道电，中间留缝
    const w = this.w, n = this.phase === 3 ? 4 : 3, top = w.arena.top + 30, bot = w.arena.bottom - 30, gap = srandi(0, n), h = (bot - top) / (n + 1);
    w.emit('flag', { text: '电网 · 待在没线的那一格', color: 'white', dur: 1.1 });
    for (let i = 0; i <= n; i++) { if (i === gap) continue; const y = top + h * (i + 0.5); w.addWarn({ kind: 'line', x: w.W, y, a: Math.PI, len: w.W, w: 12, tWarn: 1.1 + w.diff.warnBonus, beam: 0.7, silent: i > 0 }); }
    yield 2.2;
  }
  *atk_ports() { // 胸口三个接口轮流亮：亮的那一下打得疼
    this.w.emit('flag', { text: '接口亮了 · 现在打', color: 'white', dur: 1.0 });
    for (let k = 0; k < 3; k++) { this.portIdx = k; this.weakT = 1.1; this.ringShot(16, 130, 2, 'blue'); yield 1.3; }
    this.portIdx = -1; yield 0.4;
  }
  *atk_ring() { for (let k = 0; k < 3; k++) { this.ringShot(22, 140, 3, k % 2 ? 'blue' : 'gold'); yield 0.6; } yield 0.6; }
  /* ---------- 熔炉元帅 ---------- */
  *atk_barrage() { // 炮击：一片落点围着你亮起来
    const w = this.w, q = w.pickTarget(), n = this.phase === 1 ? 5 : 7;
    w.emit('flag', { text: '炮击 · 离开红圈', color: 'white', dur: 1.0 });
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + srand(0, 0.6), r = i === 0 ? 0 : srand(70, 170); this.blast(clamp(q.x + Math.cos(a) * r, 50, w.W * 0.7), clamp(q.y + Math.sin(a) * r, w.arena.top + 30, w.arena.bottom - 30), 60, 1.0 + i * 0.1, { x: this.x - 40, y: this.y - 60 }); yield 0.1; }
    yield 1.5;
  }
  *atk_rockets() { for (let k = 0; k < 3; k++) { this.fan(3, 0.22, 210, 'gold'); yield 0.5; } yield 0.6; }
  *atk_charge() { // 履带冲锋：先亮一条线，再横冲过去又退回来
    const w = this.w, q = w.pickTarget(), y = clamp(q.y, w.arena.top + 70, w.arena.bottom - 70), warn = 1.1 + w.diff.warnBonus;
    w.emit('flag', { text: '履带冲锋 · 离开那条线', color: 'white', dur: 1.0 });
    w.addWarn({ kind: 'zone', x: 0, y: y - 70, w: this.x, h: 140, tWarn: warn, color: 'orange', silent: true }); Sound.sfx('warn');
    this.dash = { st: 'aim', t: 0, warn, y }; yield warn + 2.2;
  }
  updateDash(dt) {
    const D = this.dash, w = this.w; D.t += dt;
    if (D.st === 'aim') { this.y = smooth(this.y, D.y, 6, dt); this.x = smooth(this.x, this.homeX + 30, 4, dt); if (D.t >= D.warn) { D.st = 'go'; w.shake(0.3); Sound.sfx('boom'); } return; }
    if (D.st === 'go') { this.x -= 900 * dt; if (this.x < 80) D.st = 'back'; }
    else { this.x = smooth(this.x, this.homeX, 3, dt); this.y = smooth(this.y, this.homeY, 3, dt); if (Math.abs(this.x - this.homeX) < 8) this.dash = null; }
    if (D.st === 'go' && w.state === 'play') for (const p of w.players) if (p.alive && !p.gone && !p.away && p.inv <= 0 && dist2(p.x, p.y, this.x, this.y) < 100 * 100) w.hurtPlayer(1, 'c:boss', p);
  }
  *atk_door() { this.weakT = 2.2; this.w.emit('flag', { text: '熔炉门开了 · 打里面的核心', color: 'white', dur: 1.2 }); Sound.sfx('weakOpen'); for (let k = 0; k < 2; k++) { this.ringShot(18, 120, 3, 'pink'); yield 1.0; } yield 0.4; }
  *atk_embers() { // 余烬雨：从上方落下的火星，越来越密
    const w = this.w; w.emit('flag', { text: '余烬雨', color: 'white', dur: 0.9 });
    for (let k = 0; k < 10; k++) { for (let i = 0; i < 3; i++) w.fire('pink', srand(60, w.W * 0.7), w.arena.top + 4, Math.PI / 2 + srand(-0.25, 0.25), 150 + k * 6, { silent: i > 0 }); yield 0.22; }
    yield 0.6;
  }
  /* ---------- 构筑回应（world 会调这些） ---------- */
  exposeWeak(s) { this.weakT = Math.max(this.weakT, s); }
  freezeHands(s) { this.weakT = Math.max(this.weakT, s * 0.6); }
  openFromExplosion() { if (this.weakCd > 0) return; this.weakCd = 5; this.weakT = Math.max(this.weakT, 1.2); }
  /* ---------- 伤害与阶段 ---------- */
  hit(o) {
    const w = this.w;
    if (!this.alive || this.dying || this.transT > 0 || w.state !== 'play' || w.bossIntroT > 0) return;
    let k = this.guard ? 0.15 : this.weakT > 0 ? 1 : 0.55; if (o.kind === 'burst') k = Math.max(k, 0.6);
    this.hitFlash = Math.min(1, this.hitFlash + 0.25); this.hp -= o.dmg * k * BOSS_DMG_K;
    if (this.phase === 1 && this.hp <= 650) { this.hp = 650; this.startTransition(2); }
    else if (this.phase === 2 && this.hp <= 300) { this.hp = 300; this.startTransition(3); }
    else if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  startTransition(n) {
    const w = this.w; this.nextPhase = n; this.transT = 1.9; this.gen = null; this.weakT = 0; this.freezeRing = null; this.dash = null; this.portIdx = -1;
    w.clearEnemyBullets(true); w.warns = []; w.shake(0.8); w.flash = Math.max(w.flash, 0.55); w.hitStop(0.06); Sound.sfx('phase');
    for (let i = 0; i < 26; i++) w.part(i % 2 ? 'shard' : 'dot', this.x, this.y, rand(-380, 380), rand(-380, 200), 1.2, rand(5, 9), pick([this.C.color, '#ffffff', '#ffd76a']));
    w.emit('phase', { n, name: this.C.phases[n] }); w.bossBreak(this.x, this.y); if (w.planeId === 'clock') w.onBossPhase(0);
  }
  beginPhase() { const w = this.w; this.phase = this.nextPhase; this.phaseT = 0; this.cycleIdx = 0; Sound.setMode(this.phase === 2 ? 'boss2' : 'boss3'); if (this.phase === 2) w.onBossPhase(2); }
  die() { const w = this.w; this.dying = 3.2; this.gen = null; this.freezeRing = null; this.dash = null; w.clearEnemyBullets(true); w.warns = []; w.slowT = 1.8; w.shake(1); w.flash = 0.6; Sound.sfx('boom'); }
  updateDeath(dt) {
    const w = this.w; this.dying -= dt; this.hitFlash = 0.6 + Math.sin(this.t * 30) * 0.4; w.bossDyingPops(this, 3.2);
    if (Math.random() < 0.6) w.part(pick(['shard', 'dot']), this.x + rand(-110, 110), this.y + rand(-120, 120), rand(-260, 260), rand(-300, 100), 1.2, rand(4, 9), pick([this.C.color, '#ffd76a', '#ffffff']));
    if (this.dying <= 0) { this.alive = false; w.shake(0.6); Sound.sfx('win'); w.onBossDead(); }
  }
  hudInfo() { const ph = this.transT > 0 ? this.nextPhase : this.phase; return { name: this.w.stage.bossName, def: this.def, phase: ph, phaseName: this.C.phases[ph], hp: this.hp, maxHp: this.maxHp, shield: this.guard ? 1 : 0, shieldMax: 1, weak: this.weakT > 0 }; }
  draw(g) {
    if (!this.alive) return;
    const t = this.t, F = this.freezeRing;
    if (F && !F.done) { // 冰封的安全圈：一圈亮的环，外面一层越来越白的霜
      const u = clamp(F.t / F.warn, 0, 1), blink = Math.sin(F.t * 10) > 0;
      g.fillStyle = `rgba(220,245,255,${0.05 + 0.18 * u * (blink ? 1 : 0.5)})`; g.fillRect(0, this.w.arena.top, this.w.W, this.w.arena.bottom - this.w.arena.top);
      g.strokeStyle = `rgba(159,242,200,${0.6 + 0.4 * u})`; g.lineWidth = 4; g.setLineDash([12, 8]); g.lineDashOffset = -t * 40;
      for (const r of [F.r0, F.r1]) { g.beginPath(); g.arc(this.x, this.y, r, 0, TAU); g.stroke(); } g.setLineDash([]);
      g.fillStyle = 'rgba(159,242,200,0.12)'; g.beginPath(); g.arc(this.x, this.y, F.r1, 0, TAU); g.arc(this.x, this.y, F.r0, 0, TAU, true); g.fill();
    }
    if (this.kind === 'queen') drawQueen(g, this, t); else if (this.kind === 'board') drawBoard(g, this, t); else drawGeneral(g, this, t);
    if (this.transT > 0) { const u = 1 - this.transT / 1.9; g.strokeStyle = hexA(this.C.color, 1 - u); g.lineWidth = 6; g.beginPath(); g.arc(this.x, this.y, 130 + u * 260, 0, TAU); g.stroke(); }
  }
}

/* ================================================== 画法（胖乎乎、族色、弱点亮起来看得见） ================================================== */
function bossGlow(g, r, c, a) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, r, hexA(c, 0.7), a); g.globalCompositeOperation = 'source-over'; }
/* 霜巢女王：一颗圆滚滚的冰晶身体，头顶冰晶冠冕，两侧一圈冰片披风；弱点 = 冠冕中间的蓝宝石 */
function drawQueen(g, b, t) {
  const weak = b.weakT > 0, fl = b.hitFlash || 0;
  g.save(); g.translate(b.x, b.y); g.lineJoin = 'round';
  bossGlow(g, 230, '#9fe8ff', 0.35 + 0.1 * Math.sin(t * 2));
  for (let i = 0; i < 9; i++) { const a = Math.PI * 0.55 + (i / 8) * Math.PI * 0.9 + Math.sin(t * 1.2 + i) * 0.04; g.save(); g.rotate(a); g.fillStyle = i % 2 ? 'rgba(200,240,255,0.85)' : 'rgba(150,215,245,0.85)'; g.strokeStyle = '#2a4a6a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(70, -14); g.lineTo(150 + (i % 3) * 12, 0); g.lineTo(70, 14); g.closePath(); g.fill(); g.stroke(); g.restore(); }
  const body = g.createRadialGradient(-30, -40, 10, 0, 0, 96); body.addColorStop(0, fl > 0.5 ? '#ffffff' : '#f4fdff'); body.addColorStop(0.6, '#bfe9ff'); body.addColorStop(1, '#5f9fc8');
  g.fillStyle = body; g.strokeStyle = '#2a4a6a'; g.lineWidth = 4; g.beginPath(); g.arc(0, 8, 92, 0, TAU); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 8, 80, Math.PI * 1.15, Math.PI * 1.6); g.stroke();
  for (const s of [-1, 1]) { g.fillStyle = '#16304a'; g.beginPath(); g.ellipse(s * 28, 0, 12, 16, 0, 0, TAU); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(s * 28 - 4, -6, 5, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(255,170,200,0.55)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 46, 22, 12, 6, 0, 0, TAU); g.fill(); }
  g.strokeStyle = '#2a4a6a'; g.lineWidth = 3; g.beginPath(); g.arc(0, 26, 12, 0.2, Math.PI - 0.2); g.stroke();
  // 冠冕：五根冰柱，中间一颗宝石（弱点）
  g.fillStyle = '#e8fbff'; g.strokeStyle = '#2a4a6a'; g.lineWidth = 3;
  for (let i = -2; i <= 2; i++) { const h = 40 + (2 - Math.abs(i)) * 18; g.beginPath(); g.moveTo(i * 22 - 10, -74); g.lineTo(i * 22, -74 - h); g.lineTo(i * 22 + 10, -74); g.closePath(); g.fill(); g.stroke(); }
  if (weak) bossGlow(g, 60, '#6ff0ff', 0.9);
  g.fillStyle = weak ? '#6ff0ff' : '#3a7ab0'; g.beginPath(); g.moveTo(0, -112); g.lineTo(14, -94); g.lineTo(0, -76); g.lineTo(-14, -94); g.closePath(); g.fill(); g.stroke();
  if (b.def === 'shield' || b.guard) { g.strokeStyle = 'rgba(120,210,255,0.5)'; g.lineWidth = 3; g.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU + 0.52; g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); } g.stroke(); }
  g.restore();
}
/* 弧光董事会：一台胖胖的显示器脑袋机器人，系着电青色领带，背后两根天线冒电；弱点 = 胸口亮起的接口 */
function drawBoard(g, b, t) {
  const fl = b.hitFlash || 0;
  g.save(); g.translate(b.x, b.y); g.lineJoin = 'round';
  bossGlow(g, 230, '#3ef0ff', 0.3 + 0.1 * Math.sin(t * 3));
  for (const s of [-1, 1]) { g.strokeStyle = '#3a3f5a'; g.lineWidth = 5; g.beginPath(); g.moveTo(s * 40, -96); g.lineTo(s * 58, -150); g.stroke(); g.fillStyle = '#e8fdff'; g.beginPath(); g.arc(s * 58, -154, 9, 0, TAU); g.fill(); if (Math.sin(t * 9 + s) > 0.2) { g.strokeStyle = 'rgba(62,240,255,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(s * 58, -154); for (let k = 1; k < 5; k++) g.lineTo(s * (58 + k * 8), -154 + Math.sin(t * 40 + k) * 10 - k * 4); g.stroke(); } }
  const suit = g.createLinearGradient(0, -20, 0, 110); suit.addColorStop(0, '#2a2f4a'); suit.addColorStop(1, '#141626');
  g.fillStyle = suit; g.strokeStyle = '#0a0c18'; g.lineWidth = 4; g.beginPath(); g.moveTo(-90, 110); g.quadraticCurveTo(-96, 10, -60, -10); g.lineTo(60, -10); g.quadraticCurveTo(96, 10, 90, 110); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#3ef0ff'; g.beginPath(); g.moveTo(-10, -8); g.lineTo(10, -8); g.lineTo(14, 70); g.lineTo(0, 86); g.lineTo(-14, 70); g.closePath(); g.fill(); g.stroke();
  for (let k = 0; k < 3; k++) { const on = b.portIdx === k || (b.weakT > 0 && b.portIdx < 0); g.fillStyle = on ? '#e8fdff' : '#1c2a3a'; g.beginPath(); g.arc(-44 + k * 44, 50, 11, 0, TAU); g.fill(); g.strokeStyle = '#3ef0ff'; g.lineWidth = 2.5; g.stroke(); if (on) { g.save(); g.translate(-44 + k * 44, 50); bossGlow(g, 34, '#3ef0ff', 0.9); g.restore(); } }
  g.fillStyle = fl > 0.5 ? '#ffffff' : '#3a3f5a'; g.strokeStyle = '#0a0c18'; g.lineWidth = 4; g.beginPath(); g.roundRect ? g.roundRect(-80, -100, 160, 96, 22) : g.rect(-80, -100, 160, 96); g.fill(); g.stroke();
  g.fillStyle = '#0c1a26'; g.beginPath(); g.roundRect ? g.roundRect(-66, -88, 132, 72, 14) : g.rect(-66, -88, 132, 72); g.fill();
  const angry = b.phase >= 3; g.fillStyle = '#3ef0ff';
  for (const s of [-1, 1]) { g.beginPath(); g.roundRect ? g.roundRect(s * 30 - 12, -64 + (angry ? 4 : 0), 24, angry ? 10 : 18, 5) : g.rect(s * 30 - 12, -64, 24, 18); g.fill(); }
  g.fillRect(-20, -36, 40, 4);
  if (b.guard) { g.strokeStyle = `rgba(62,240,255,${0.5 + Math.sin(t * 8) * 0.2})`; g.lineWidth = 5; g.beginPath(); g.ellipse(0, 0, 140, 170, 0, 0, TAU); g.stroke(); }
  g.restore();
}
/* 熔炉元帅：一座矮胖的熔炉坦克，肚子上一扇炉门（门开 = 弱点，里面是发光的核心），一门粗炮，头顶小军帽 */
function drawGeneral(g, b, t) {
  const fl = b.hitFlash || 0, door = b.door || 0;
  g.save(); g.translate(b.x, b.y); g.lineJoin = 'round';
  bossGlow(g, 220, '#ff7a3a', 0.3 + 0.1 * Math.sin(t * 2.5));
  g.fillStyle = '#2a2440'; g.strokeStyle = '#120a10'; g.lineWidth = 4; g.beginPath(); g.roundRect ? g.roundRect(-110, 62, 220, 46, 22) : g.rect(-110, 62, 220, 46); g.fill(); g.stroke();
  g.fillStyle = '#4c4a66'; for (let i = 0; i < 6; i++) { const x = -90 + ((i * 36 + t * (b.dash ? 400 : 40)) % 216); g.beginPath(); g.arc(x, 85, 11, 0, TAU); g.fill(); }
  g.save(); g.translate(-60, -50); g.rotate(Math.PI + 0.25 * Math.sin(t * 0.8)); g.fillStyle = '#3a3f5a'; g.fillRect(0, -14, 80, 28); g.strokeRect(0, -14, 80, 28); g.fillStyle = '#ff9a40'; g.fillRect(70, -10, 10, 20); g.restore();
  const body = g.createRadialGradient(-30, -40, 10, 0, 0, 100); body.addColorStop(0, fl > 0.5 ? '#ffffff' : '#ff9a6a'); body.addColorStop(0.7, '#c8402a'); body.addColorStop(1, '#5a160c');
  g.fillStyle = body; g.strokeStyle = '#120a10'; g.lineWidth = 4; g.beginPath(); g.roundRect ? g.roundRect(-96, -90, 192, 160, 60) : g.rect(-96, -90, 192, 160); g.fill(); g.stroke();
  for (const s of [-1, 1]) { g.fillStyle = '#1a0a08'; g.beginPath(); g.ellipse(s * 34, -38, 13, 15, 0, 0, TAU); g.fill(); g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(s * 34 - 4, -43, 5, 0, TAU); g.fill(); }
  g.strokeStyle = '#120a10'; g.lineWidth = 4; g.beginPath(); g.moveTo(-50, -60); g.lineTo(-18, -52); g.moveTo(50, -60); g.lineTo(18, -52); g.stroke();
  // 炉门：开的时候往两边滑开，里面的核心亮
  g.fillStyle = '#1a0806'; g.beginPath(); g.roundRect ? g.roundRect(-40, -4, 80, 56, 12) : g.rect(-40, -4, 80, 56); g.fill();
  if (door > 0.05) { g.save(); g.translate(0, 24); bossGlow(g, 70, '#ffd27a', door); g.fillStyle = '#fff3c8'; g.beginPath(); g.arc(0, 0, 18 * door, 0, TAU); g.fill(); g.restore(); }
  g.fillStyle = '#7a3a2a'; g.strokeStyle = '#120a10'; g.lineWidth = 3;
  for (const s of [-1, 1]) { g.beginPath(); g.roundRect ? g.roundRect(s < 0 ? -40 - door * 36 : door * 36, -4, 40, 56, 8) : g.rect(s < 0 ? -40 : 0, -4, 40, 56); g.fill(); g.stroke(); }
  g.fillStyle = '#3a2a40'; g.beginPath(); g.ellipse(0, -92, 46, 12, 0, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.roundRect ? g.roundRect(-30, -122, 60, 30, 10) : g.rect(-30, -122, 60, 30); g.fill(); g.stroke();
  g.fillStyle = '#ffd27a'; g.beginPath(); BulletArt.star(g, 0, -107, 5, 9, 4); g.fill();
  if (b.def === 'armor') for (const s of [-1, 1]) { // 装甲：两侧挂着铁灰色的甲板（§4.3）
    g.fillStyle = '#7a7f92'; g.strokeStyle = '#120a10'; g.lineWidth = 3; g.beginPath(); g.roundRect ? g.roundRect(s * 96 - 14, -64, 28, 104, 10) : g.rect(s * 96 - 14, -64, 28, 104); g.fill(); g.stroke();
    g.fillStyle = '#b7bccb'; g.fillRect(s * 96 - 8, -56, 4, 88); g.fillStyle = '#4c4a66'; for (const y of [-44, -4, 28]) { g.beginPath(); g.arc(s * 96, y, 3, 0, TAU); g.fill(); }
  }
  g.restore();
}
