'use strict';
/* 梦潮回声航线 — 区域 Boss「失控闹钟」: three movements, each teaching one idea and then layering a rule.
   HP 1000, phases at 70% / 35%, weak point exposed at least twice per phase. */

const CLOCK_PHASES = {
  1: { name: '第一乐章 · 指针卡住', music: 'boss1' },
  2: { name: '第二乐章 · 秒针加速', music: 'boss2' },
  3: { name: '终章 · 时间倒流', music: 'boss3' },
};

class ClockBoss {
  constructor(w) {
    this.w = w; this.t = 0;
    this.homeX = w.W * 0.75; this.homeY = (ARENA_TOP + ARENA_BOTTOM) / 2 - 4;
    this.x = w.W + 280; this.y = this.homeY;
    this.hp = 1000; this.maxHp = 1000; this.phase = 1; this.alive = true;
    this.minA = -Math.PI / 2; this.hourA = 0.6; this.weakT = 0; this.weakCd = 0; this.mouth = 0; this.ringT = 1.4; this.hitFlash = 0; this.lookA = Math.PI;
    this.shield = 0; this.shieldMax = 80; this.lean = 0; this.leanT = 0;
    this.gen = null; this.wait = 0; this.cycleIdx = 0; this.tempo = 1; this.phaseT = 0; this.transT = 0;
    this.bigT = 16; this.revT = 5; this.repeatT = 6.5; this.shieldT = 24;
    this.sweep = null; this.dying = 0; this.stuck = false; this.fightT = 0;
    this.orbit = []; for (let i = 0; i < 10; i++) this.orbit.push({ a: rand(TAU), r: rand(150, 200), s: rand(0.3, 0.7), petal: i % 2 === 0 });
    Sound.sfx('alarm');
  }
  get dens() { return (t, n) => this.w.dens(t, n); }
  mouthPos() { return { x: this.x - 4, y: this.y - 2 }; }
  aimPoint() { return { x: this.x, y: this.y, weak: this.weakT > 0 }; }
  targetable() { return this.alive && !this.dying && this.x < this.w.W - 20; }

  cycle() {
    if (this.phase === 1) return ['fan', 'sweep', 'diamonds', 'star', 'weak'];
    if (this.phase === 2) return ['ringCCW', 'crossHands', 'tripleStar', 'fanMix', 'diamonds', 'weak'];
    return ['rewindSpiral', 'sweep', 'tripleStar', 'crossHands', 'fanMix', 'weak'];
  }
  nextAttack() {
    const list = this.cycle(), name = list[this.cycleIdx % list.length];
    this.cycleIdx++;
    this.gen = this['atk_' + name]();
    this.wait = 0.2;
  }

  update(dt) {
    const w = this.w, p = w.player;
    this.t += dt; this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.ringT = Math.max(0, this.ringT - dt);
    this.weakCd = Math.max(0, this.weakCd - dt);
    this.lookA = angTo(this.x, this.y, p.x, p.y);
    this.lean = smooth(this.lean, this.leanT, 5, dt);
    for (const o of this.orbit) o.a += dt * o.s * (this.phase === 3 ? -1 : 1);
    // movement
    const targetX = this.homeX + (this.phase === 2 ? Math.sin(this.t * 0.5) * 30 : 0);
    this.x = smooth(this.x, targetX, w.state === 'intro' ? 1.4 : 3, dt);
    this.y = smooth(this.y, this.homeY + Math.sin(this.t * 0.8) * 18, 3, dt);
    if (this.dying > 0) return this.updateDeath(dt);
    // hands
    if (!this.sweep) {
      if (this.stuck) this.minA = -0.9 + Math.sin(this.t * 40) * 0.05;
      else this.minA += dt * (0.9 + (this.phase - 1) * 0.8) * this.tempo * (this.phase === 3 ? -1 : 1);
    }
    this.hourA += dt * 0.08 * (this.phase === 3 ? -1 : 1);
    if (this.weakT > 0) this.weakT -= dt;
    if (w.state !== 'play') return;
    this.fightT += dt; this.phaseT += dt;
    if (this.transT > 0) { this.transT -= dt; if (this.transT <= 0) this.beginPhase(); return; }
    // tempo & phase rules
    if (this.phase === 2) {
      this.tempo = 1 + Math.min(0.55, this.phaseT / 70);
      Sound.setBpm(118 + Math.round((this.tempo - 1) * 40));
      this.bigT -= dt; if (this.bigT <= 0) { this.bigT = 20; this.bigWarning(); }
    }
    if (this.phase === 3) {
      this.revT -= dt; if (this.revT <= 0) { this.revT = rand(4.5, 5.5); w.reverseT = 0.9; Sound.sfx('rewind'); w.emit('flag', { text: '时间倒流', color: 'gold', dur: 1 }); }
      this.repeatT -= dt; if (this.repeatT <= 0) { this.repeatT = 6.5; this.repeatGone(); }
      this.shieldT -= dt; if (this.shieldT <= 0) { this.shieldT = 24; if (this.shield <= 0) { this.shield = 60; this.shieldMax = 60; w.emit('flag', { text: '护盾恢复', color: 'white', dur: 1 }); Sound.sfx('weakOpen'); } }
    }
    // sweep beam
    if (this.sweep) {
      const s = this.sweep; s.t += dt;
      const u = Ease.inOutSine(clamp(s.t / s.dur, 0, 1)); s.a = lerp(s.a0, s.a1, u); this.minA = s.a;
      if (w.state === 'play' && p.alive) {
        const ex = this.x + Math.cos(s.a) * s.len, ey = this.y + Math.sin(s.a) * s.len;
        const hit = segDist2(p.x, p.y, this.x, this.y, ex, ey) < (s.w / 2 + p.r) * (s.w / 2 + p.r);
        if (hit) { if (p.dashInv > 0) { if (p.dodgeReady) w.perfectDodge({ x: p.x, y: p.y }); } else if (p.hurtInv <= 0) w.hurtPlayer(18, p.x, p.y); }
      }
      if (s.t >= s.dur) this.sweep = null;
    }
    // attack runner (generators yield wait times)
    if (!this.gen) this.nextAttack();
    this.wait -= dt * this.tempo;
    while (this.gen && this.wait <= 0) {
      const r = this.gen.next();
      if (r.done) { this.gen = null; break; }
      this.wait += r.value;
    }
  }

  /* ---------- attacks ---------- */
  *atk_fan() {
    this.mouth = 1; this.leanT = -0.12; yield 0.55 + this.w.diff.warnBonus;
    for (let v = 0; v < 3; v++) {
      const m = this.mouthPos(), n = this.dens('pink', 9), a0 = this.w.aimAngle(m.x, m.y);
      for (let i = 0; i < n; i++) this.w.fire('pink', m.x, m.y + 30, a0 + (n > 1 ? (i / (n - 1) - 0.5) * 1.2 : 0), 200, { silent: i > 0, boss: true });
      yield 0.4;
    }
    this.mouth = 0; this.leanT = 0; yield 0.7;
  }
  *atk_fanMix() {
    this.mouth = 1; this.leanT = -0.12; yield 0.45 + this.w.diff.warnBonus;
    for (let v = 0; v < 4; v++) {
      const m = this.mouthPos(), n = this.dens('pink', 7), a0 = this.w.aimAngle(m.x, m.y) + (v % 2 ? 0.12 : -0.12);
      for (let i = 0; i < n; i++) this.w.fire(i % 3 === 1 ? 'blue' : 'pink', m.x, m.y + 30, a0 + (i / (n - 1) - 0.5) * 1.3, 220 + v * 12, { silent: i > 0 });
      yield 0.34;
    }
    this.mouth = 0; this.leanT = 0; yield 0.6;
  }
  *atk_sweep() {
    const w = this.w, a0 = 2.2, a1 = 4.08, len = Math.max(420, this.x - w.W * 0.2), warn = 1.05 + w.diff.warnBonus;
    this.leanT = 0.1;
    w.addWarn({ kind: 'arc', x: this.x, y: this.y, a0, a1, len, tWarn: warn, follow: this });
    w.addWarn({ kind: 'line', x: this.x, y: this.y, a: a0, len, w: 3, tWarn: warn, silent: true, follow: this });
    this.minA = a0; this.stuckAim = true;
    yield warn;
    this.sweep = { a0, a1, a: a0, t: 0, dur: 1.55, len, w: 16 };
    Sound.sfx('laser'); this.ringT = 0.4;
    yield 1.7;
    this.stuckAim = false; this.leanT = 0; yield 0.5;
  }
  *atk_diamonds() {
    const w = this.w, top = w.arena.top + 30, bot = w.arena.bottom - 30;
    for (let c = 0; c < 3; c++) {
      const n = Math.max(5, this.dens('blue', 8)), gap = randi(1, n - 3);
      for (let i = 0; i < n; i++) { if (i === gap || i === gap + 1) continue; this.w.fire('blue', this.x - 90, lerp(top, bot, i / (n - 1)), Math.PI, 175, { silent: i > 0 }); }
      yield 0.85;
    }
    yield 0.6;
  }
  *atk_star() {
    this.ringT = 0.5; this.mouth = 0.5; yield 0.6 + this.w.diff.warnBonus;
    const m = this.mouthPos(); this.w.fire('gold', m.x - 40, m.y + 20, this.w.aimAngle(m.x, m.y), 235);
    this.mouth = 0; yield 1.4;
  }
  *atk_tripleStar() {
    for (let i = 0; i < 3; i++) {
      this.ringT = 0.3; yield 0.4 + (i === 0 ? this.w.diff.warnBonus : 0);
      const m = this.mouthPos(); this.w.fire('gold', m.x - 40, m.y + 20, this.w.aimAngle(m.x, m.y), 245);
    }
    yield 1.1;
  }
  *atk_ringCCW() {
    let base = 0; this.leanT = 0.08;
    for (let k = 0; k < 20; k++) {
      const arms = 5;
      for (let i = 0; i < arms; i++) this.w.fire(k % 5 === 4 && i % 2 === 0 ? 'blue' : 'pink', this.x, this.y, base + (i * TAU) / arms, 165, { silent: i > 0 });
      base -= 0.2; yield 0.13;
    }
    this.leanT = 0; yield 0.8;
  }
  *atk_crossHands() {
    const w = this.w, warn = 1.0 + w.diff.warnBonus, L = this.x + 60;
    for (const set of [[Math.PI - 0.42, Math.PI + 0.42], [Math.PI, Math.PI - 0.84, Math.PI + 0.84]]) {
      for (const a of set) w.addWarn({ kind: 'line', x: this.x, y: this.y, a, len: L, w: 15, tWarn: warn, beam: 0.6, dmg: 18, follow: this, onFire: () => { Sound.sfx('laser'); this.ringT = 0.3; } });
      yield warn + 0.75;
    }
    yield 0.4;
  }
  *atk_rewindSpiral() {
    let base = rand(TAU);
    for (let k = 0; k < 14; k++) {
      for (let i = 0; i < 4; i++) this.w.fire(i % 2 ? 'pink' : 'blue', this.x, this.y, base + (i * TAU) / 4, 185, { silent: i > 0 });
      base += 0.26; yield 0.12;
    }
    yield 0.9;
    this.w.reverseT = 0.8; Sound.sfx('rewind'); this.w.emit('flag', { text: '时间倒流', color: 'gold', dur: 0.8 });
    yield 1.4;
  }
  *atk_weak() {
    this.stuck = true; this.weakT = 2.2; this.w.emit('flag', { text: '指针卡住 · 弱点暴露', color: 'white', dur: 1.4 });
    Sound.sfx('weakOpen');
    yield 2.3;
    this.stuck = false; yield 0.6;
  }
  exposeWeak(s) { this.weakT = Math.max(this.weakT, s); Sound.sfx('weakOpen'); }

  bigWarning() {
    const w = this.w, mid = (w.arena.top + w.arena.bottom) / 2, upper = Math.random() < 0.5;
    const y0 = upper ? w.arena.top : mid, h = upper ? mid - w.arena.top : w.arena.bottom - mid;
    w.emit('flag', { text: upper ? '上半区即将被淹没' : '下半区即将被淹没', color: 'white', dur: 1.2 });
    w.addWarn({ kind: 'zone', x: 0, y: y0, w: w.W, h, tWarn: 1.2 + w.diff.warnBonus, post: 1.4, onFire: () => {
      const rows = Math.floor(h / 26);
      for (let c = 0; c < 4; c++) for (let r = 0; r <= rows; r++) w.fire('pink', w.W + 20 + c * 40, y0 + 8 + r * 26, Math.PI, 480, { silent: r > 0 || c > 0, noRepeat: true });
    } });
  }
  repeatGone() {
    const w = this.w, list = w.gone.splice(0, 14);
    if (!list.length) return;
    for (const s of list) w.fire(s.type, s.x, s.y, s.a, s.s, { ghost: 0.7, noRepeat: true, silent: true });
    w.emit('flag', { text: '消失的弹幕在原处重演', color: 'gold', dur: 1 });
  }

  /* ---------- damage & phases ---------- */
  hit(o) {
    const w = this.w;
    if (!this.alive || this.dying || this.transT > 0 || w.state !== 'play') return;
    const onCore = dist2(o.x, o.y, this.x, this.y) < 40 * 40 || o.kind === 'burst';
    let k;
    if (o.kind === 'burst') k = 1;
    else if (o.kind === 'melee') k = this.weakT > 0 ? 0.8 : 0.35;
    else if (this.weakT > 0 && onCore) k = Math.max(0.6, o.armor || 0.2);
    else k = o.armor || 0.2;
    let dmg = o.dmg * k * 0.36; // boss durability: ~45–75 s per movement
    if (this.weakT > 0 && onCore && o.kind !== 'burst') {
      if (this.weakCd <= 0) { this.weakCd = 0.5; w.addRes(12, this.x, this.y - 40); w.text('弱点!', this.x, this.y - 60, '#ffffff', 18, 2); Tele.log('boss_weak_hit'); }
      Sound.sfx('weakHit', { gap: 60 });
    } else Sound.sfx('armor', { gap: 70 });
    this.hitFlash = Math.min(1, this.hitFlash + 0.4);
    if (this.shield > 0) {
      this.shield -= dmg;
      if (this.shield <= 0) { this.shield = 0; Sound.sfx('shieldPop'); w.text('护盾破碎!', this.x, this.y - 150, '#fff3c8', 20, 3); w.shake(0.3); }
      return;
    }
    this.hp -= dmg;
    // a phase is never skipped: HP floors at the next threshold until the transition plays
    if (this.phase === 1 && this.hp <= 700) { this.hp = 700; this.startTransition(2); }
    else if (this.phase === 2 && this.hp <= 350) { this.hp = 350; this.startTransition(3); }
    else if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  startTransition(n) {
    const w = this.w;
    this.nextPhase = n; this.transT = 1.9; this.gen = null; this.sweep = null; this.stuck = false; this.weakT = 0; this.ringT = 1.9;
    w.clearEnemyBullets(true); w.warns = [];
    w.shake(0.8); w.flash = Math.max(w.flash, 0.55); w.hitstop = 0.12;
    Sound.sfx('phase');
    Tele.log('boss_phase_change', { to: n });
    for (let i = 0; i < 26; i++) w.part(i % 2 ? 'petal' : 'shard', this.x, this.y, rand(-380, 380), rand(-380, 200), 1.2, rand(5, 9), pick(['#ffcf7a', '#c9a8ff', '#fff3c8']));
    w.emit('phase', { n, name: CLOCK_PHASES[n].name });
  }
  beginPhase() {
    const w = this.w;
    this.phase = this.nextPhase; this.phaseT = 0; this.cycleIdx = 0; this.tempo = 1;
    Sound.setMode(CLOCK_PHASES[this.phase].music);
    if (this.phase === 2) { w.arenaTarget = { top: ARENA_TOP + 58, bottom: ARENA_BOTTOM - 58 }; this.bigT = 8; }
    if (this.phase === 3) { w.arenaTarget = { top: ARENA_TOP, bottom: ARENA_BOTTOM }; this.shield = 80; this.shieldMax = 80; this.revT = 3; this.repeatT = 6; Sound.setBpm(100); }
  }
  die() {
    const w = this.w;
    this.dying = 2.6; this.gen = null; this.sweep = null; this.weakT = 0;
    w.clearEnemyBullets(true); w.warns = []; w.slowT = 1.6; w.shake(1); w.flash = 0.6;
    Sound.sfx('boom'); Tele.log('boss_defeated', { time: Math.round(this.fightT) });
  }
  updateDeath(dt) {
    const w = this.w;
    this.dying -= dt; this.hitFlash = 0.6 + Math.sin(this.t * 30) * 0.4;
    this.x += Math.sin(this.t * 60) * 1.5;
    if (Math.random() < 0.5) w.part(pick(['petal', 'shard', 'dot']), this.x + rand(-100, 100), this.y + rand(-100, 100), rand(-260, 260), rand(-300, 100), 1.2, rand(4, 9), pick(['#ffcf7a', '#c9a8ff', '#fff3c8', 'rgba(255,243,200,0.9)']));
    if (this.dying <= 0) {
      this.alive = false; w.shake(0.6); Sound.sfx('win');
      for (let i = 0; i < 40; i++) w.part('note', this.x, this.y, rand(-300, 300), rand(-300, 100), 1.6, rand(10, 18), pick(['#ffe38a', '#c9a8ff', '#aeeaff']));
      w.bossTime = this.fightT;
      w.finishRoom();
    }
  }

  hudInfo() {
    return { name: '失控闹钟', phase: this.transT > 0 ? this.nextPhase : this.phase, phaseName: CLOCK_PHASES[this.transT > 0 ? this.nextPhase : this.phase].name, hp: this.hp, maxHp: this.maxHp, shield: this.shield, shieldMax: this.shieldMax, weak: this.weakT > 0 };
  }

  draw(g) {
    if (!this.alive) return;
    const t = this.t;
    // orbiting petals & clock shards
    for (const o of this.orbit) {
      const x = this.x + Math.cos(o.a) * o.r, y = this.y + Math.sin(o.a) * o.r * 0.7;
      g.save(); g.translate(x, y); g.rotate(o.a * 2);
      if (o.petal) { g.fillStyle = this.phase === 2 ? 'rgba(255,176,122,0.7)' : 'rgba(201,168,255,0.7)'; g.beginPath(); g.ellipse(0, 0, 8, 4, 0, 0, TAU); g.fill(); }
      else { g.fillStyle = 'rgba(255,243,200,0.55)'; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 4); g.lineTo(-5, 4); g.closePath(); g.fill(); }
      g.restore();
    }
    // sweep beam = the minute hand grown long
    if (this.sweep) {
      const s = this.sweep, ex = this.x + Math.cos(s.a) * s.len, ey = this.y + Math.sin(s.a) * s.len;
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,207,74,0.4)'; g.lineWidth = s.w * 2.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(this.x, this.y); g.lineTo(ex, ey); g.stroke();
      g.strokeStyle = 'rgba(255,250,230,0.95)'; g.lineWidth = s.w; g.stroke();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#fff3c8'; g.beginPath(); g.arc(ex, ey, 10, 0, TAU); g.fill();
    }
    g.save();
    if (this.lean) { g.translate(this.x, this.y); g.rotate(this.lean); g.translate(-this.x, -this.y); }
    const phaseVis = this.transT > 0 && this.transT < 1 ? this.nextPhase : this.phase;
    drawClockBoss(g, { x: this.x, y: this.y, phase: phaseVis, minA: this.minA, hourA: this.hourA, weakT: this.weakT, mouth: this.mouth, ringT: this.ringT, hitFlash: this.hitFlash, lookA: this.lookA, shield: this.shield, hideMinute: !!this.sweep }, t);
    g.restore();
    if (this.transT > 0) {
      const u = 1 - this.transT / 1.9;
      g.strokeStyle = `rgba(255,243,200,${1 - u})`; g.lineWidth = 6; g.beginPath(); g.arc(this.x, this.y, 130 + u * 260, 0, TAU); g.stroke();
    }
  }
}
