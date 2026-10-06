'use strict';
/* 梦潮：回声航线 v0.7 — 关卡队长（1-1 泡泡小队长 / 1-2 裂纹闹钟队长）。
   接口与失控闹钟一致：update / draw / hit / hudInfo / freezeHands / openFromExplosion，打倒后 w.onBossDead()。
   50% 血量进入第二阶段：攻击更密，并带散兵出场。
   v0.8 Boss 小目标：先打碎正面三块护甲（护甲在时核心只吃 30%）→ 核心暴露 → 召唤散兵时撑起护盾，清掉散兵护盾才消失。 */

const CAPTAINS = {
  captain: { base: 'jelly', name: '泡泡小队长', scale: 2.4, color: '#ff9fcf', cycle: ['spiral', 'fan', 'ring', 'fan'], cycle2: ['spiral', 'summon', 'fan', 'ring', 'fan'] },
  captain2: { base: 'tick', name: '裂纹闹钟队长', scale: 2.2, color: '#ffd76a', cycle: ['ring', 'cross', 'volley', 'summon'], cycle2: ['ring', 'cross', 'summon', 'volley', 'fan', 'summon'] },
};

class CaptainBoss {
  constructor(w, kind, hp) {
    const C = CAPTAINS[kind];
    this.w = w; this.kind = kind; this.C = C; this.t = 0; this.seed = srand(10);
    this.homeX = w.W * 0.76; this.homeY = (TOP + BOTTOM) / 2;
    this.x = w.W + 220; this.y = this.homeY;
    this.hp = hp; this.maxHp = hp; this.phase = 1; this.alive = true; this.dying = 0; this.transT = 0; this.nextPhase = 1;
    this.fightT = 0; this.hitFlash = 0; this.weakT = 0; this.shield = 0; this.shieldMax = 1; this.stunT = 0;
    this.conductive = false; this.marked = false; this.iceHands = false;
    this.atkT = 1.6; this.idx = 0; this.gen = null; this.radius = 26 * C.scale + 20;
    this.plates = [-62, 0, 62].map((dy) => ({ dy, hp: hp * 0.06, max: hp * 0.06, alive: true, flash: 0 }));
    this.guard = false;
    Sound.sfx('alarm');
  }
  targetable() { return this.alive && !this.dying && this.x < this.w.W - 20; }
  update(dt) {
    const w = this.w, p = w.player;
    this.t += dt; this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.weakT = Math.max(0, this.weakT - dt);
    for (const pl of this.plates) pl.flash = Math.max(0, pl.flash - dt * 6);
    const adds = w.enemies.filter((e) => e.alive && e.bossAdd).length;
    if (this.guard && adds === 0) { this.guard = false; Sound.sfx('weakOpen'); w.text('散兵清光了 · 护盾消失', this.x, this.y - 130, '#fff3c8', 20, 5); }
    this.x = smooth(this.x, this.homeX + Math.sin(this.t * 0.6) * 40, w.bossIntroT > 0 ? 1.4 : 2.5, dt);
    this.y = smooth(this.y, this.homeY + Math.sin(this.t * 0.9) * 120, 2.2, dt);
    if (this.dying > 0) return this.updateDeath(dt);
    if (w.bossIntroT > 0 || w.timeStop > 0) return;
    this.fightT += dt;
    if (this.transT > 0) { this.transT -= dt; if (this.transT <= 0) { this.phase = this.nextPhase; w.onBossPhase(2); } return; }
    if (this.stunT > 0) { this.stunT -= dt; return; }
    if (!this.guard) w.bossRegen(this, this.phase === 1 ? this.maxHp : this.maxHp * 0.5, dt); // 自愈：火力不够就打不动（散兵护着时不回，纯比火力）
    const rk = w.bossRageK(this); // 打太久会失控：攻击一路加快
    if (this.gen) { const r = this.gen.next(dt * rk); if (r.done) this.gen = null; return; }
    this.atkT -= dt * rk;
    if (this.atkT <= 0) {
      const list = this.phase === 1 ? this.C.cycle : this.C.cycle2, name = list[this.idx++ % list.length];
      this.gen = this.attack(name); this.atkT = this.phase === 1 ? 1.5 : 1.0;
    }
  }
  /* 攻击写成生成器：每帧推进一次 */
  *attack(name) {
    const w = this.w, spd = this.phase === 2 ? 1.12 : 1;
    const wait = function* (s) { let t = 0; while (t < s) t += yield; };
    switch (name) {
      case 'spiral': for (let k = 0; k < 12; k++) { for (let i = 0; i < 3; i++) w.fire('pink', this.x, this.y, this.t * 2.4 + (i * TAU) / 3, 150 * spd, { silent: i > 0 }); yield* wait(0.12); } break;
      case 'fan': { const n = this.phase === 1 ? 5 : 7, a0 = w.aimAngle(this.x, this.y); for (let i = 0; i < n; i++) w.fire('pink', this.x - 20, this.y, a0 + (i - (n - 1) / 2) * 0.16, 190 * spd, { silent: i > 0 }); yield* wait(0.5); break; }
      case 'ring': { const n = 14, gap = srandi(0, n - 1), off = srand(TAU); for (let i = 0; i < n; i++) if (i !== gap && i !== (gap + 1) % n) w.fire('pink', this.x, this.y, off + (i / n) * TAU, 140 * spd, { silent: i > 0 }); yield* wait(0.6); break; }
      case 'cross': for (let k = 0; k < 4; k++) { for (let q = 0; q < 4; q++) w.fire('blue', this.x, this.y, (q * Math.PI) / 2 + Math.PI / 4 + this.t * 0.8, 170 * spd, { silent: q > 0 }); yield* wait(0.18); } break;
      case 'volley': for (let k = 0; k < 3; k++) { w.fire('gold', this.x - 30, this.y, w.aimAngle(this.x, this.y), 230 * spd); yield* wait(0.4); } break;
      case 'summon': {
        // 散兵：从右边补一队小怪，不计入“必须清零”的目标
        const top = w.arena.top + 60, bot = w.arena.bottom - 60, y0 = srand(top, bot);
        const nA = Math.round((this.kind === 'captain' ? 6 : 7) * (w.L.addsK || 1)), aHp = w.L.addHpK || 1; // 梦魇·护驾：散兵更多更结实
        if (this.kind === 'captain') for (let i = 0; i < nA; i++) w.addEnemy('jelly', { x: w.W + 10 + i * 50, y: y0, path: 'sine', vx: -120, amp: 30, freq: 2, phase: i * 0.5, escort: true, bossAdd: true, hp: ENEMY_HP.jelly * aHp });
        else { for (let i = 0; i < nA; i++) w.addEnemy('moth', { x: w.W + 10 + srand(0, 160), y: srand(top, bot), path: 'line', vx: -srand(130, 170), escort: true, bossAdd: true, hp: ENEMY_HP.moth * aHp }); w.addEnemy('star', { x: w.W + 40, y: srand(top, bot), path: 'dive', vx: -200, fire: 'aim', escort: true, bossAdd: true }); }
        this.guard = true;
        w.text('散兵来了 · 护盾撑起来了', this.x, this.y - 110, this.C.color, 18, 3);
        yield* wait(0.4); break;
      }
    }
  }
  freezeHands(s) { this.stunT = Math.max(this.stunT, s); this.weakT = Math.max(this.weakT, s); }
  openFromExplosion() { this.weakT = Math.max(this.weakT, 0.8); }
  hit(o) {
    const w = this.w;
    if (!this.alive || this.dying || w.state !== 'play' || w.bossIntroT > 0) return;
    // 小目标 1：正面三块护甲，打在哪块就敲哪块
    const dy = (o.y !== undefined ? o.y : this.y) - this.y, pl = this.plates.find((q) => q.alive && Math.abs(dy - q.dy) < 34);
    if (pl && o.kind !== 'burst') {
      pl.hp -= o.dmg; pl.flash = 1; Sound.sfx('clink', { pan: w.pan(this.x), gap: 60, k: 1 });
      if (Math.random() < 0.5) w.part('shard', this.x - 70, this.y + pl.dy, rand(-200, -40), rand(-160, 80), 0.45, rand(3, 5), '#c7d0f0');
      if (pl.hp <= 0) {
        pl.alive = false; w.hitStop(0.05); w.shake(0.3); w.rumble(0.7, 0.5, 120); Sound.sfx('armorBreak', { prio: true });
        w.part('plate', this.x - 70, this.y + pl.dy, rand(-240, -120), rand(-280, -120), 1.2, 30, '#9aa6d6');
        const left = this.plates.filter((q) => q.alive).length;
        w.text(left ? `护甲碎了 ${3 - left}/3` : '护甲全碎 · 核心露出来了！', this.x - 60, this.y + pl.dy - 40, '#e6ecff', 20, 5);
        if (!left) { this.weakT = Math.max(this.weakT, 2.5); Sound.sfx('weakOpen'); }
      }
      return;
    }
    const armorUp = this.plates.some((q) => q.alive);
    const dmg = o.dmg * (this.weakT > 0 ? 1.25 : 1) * (this.transT > 0 ? 0.3 : 1) * (armorUp ? 0.3 : 1) * (this.guard ? 0.15 : 1);
    if (this.guard && Math.random() < 0.3) Sound.sfx('clink', { gap: 90 });
    this.hitFlash = Math.min(1, this.hitFlash + 0.2);
    this.hp -= dmg;
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5 && this.transT <= 0) {
      this.hp = this.maxHp * 0.5; this.transT = 1.4; this.nextPhase = 2; this.gen = null;
      w.clearEnemyBullets(true); w.shake(0.6); w.hitStop(0.05); Sound.sfx('phase', { prio: true });
      w.emit('phase', { n: 2, name: `${this.C.name} · 怒气`, captain: true });
      w.bossBreak(this.x, this.y);
      w.onBossPhase(0);
    } else if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  die() {
    const w = this.w;
    this.dying = 1.6; this.gen = null; w.clearEnemyBullets(true); w.warns = []; w.slowT = 1.2; w.shake(0.9); w.flash = 0.5 * w.flashK(); w.hitStop(0.06);
    for (const e of w.enemies) if (e.alive && e.bossAdd) { e.disband = true; e.path = 'scatter'; e.vx = -200; }
    Sound.sfx('boom'); Tele.log('boss_defeated', { time: Math.round(this.fightT), kind: this.kind });
  }
  updateDeath(dt) {
    const w = this.w;
    this.dying -= dt; this.hitFlash = 0.6 + Math.sin(this.t * 30) * 0.4; w.bossDyingPops(this, 1.6);
    if (Math.random() < 0.6) w.part(pick(['petal', 'shard', 'dot']), this.x + rand(-80, 80), this.y + rand(-80, 80), rand(-260, 260), rand(-300, 100), 1.1, rand(4, 9), pick([this.C.color, '#fff3c8', '#c9a8ff']));
    if (this.dying <= 0) { this.alive = false; Sound.sfx('win'); w.onBossDead(); }
  }
  hudInfo() {
    const left = this.plates.filter((q) => q.alive).length, adds = this.w.enemies.filter((e) => e.alive && e.bossAdd).length;
    const sub = left ? `打碎正面护甲 ${3 - left}/3（护甲在时核心只吃三成伤害）` : this.guard ? `清掉散兵 · 还剩 ${adds} · 清完护盾消失` : this.phase === 1 ? '核心露出来了 · 集中火力' : '怒气 · 会带散兵出场';
    return { name: this.C.name, phase: this.phase, phaseName: sub, hp: this.hp, maxHp: this.maxHp, shield: this.guard ? 1 : 0, shieldMax: 1, weak: this.weakT > 0 || (!left && !this.guard), ticks: [50] };
  }
  draw(g) {
    if (!this.alive) return;
    const C = this.C, t = this.t;
    g.save(); g.translate(this.x, this.y);
    glowAt(g, 0, 0, 120 * C.scale / 2, hexA(C.color, 0.8), 0.45 + (this.phase === 2 ? 0.2 : 0));
    g.save(); g.scale(C.scale, C.scale);
    const fake = { r: 22, seed: this.seed, charge: this.gen ? 0.6 : 0, elite: true, t, hitFlash: this.hitFlash, x: this.x, y: this.y };
    (EnemyArt[C.base] || EnemyArt.jelly)(g, fake, t + this.seed);
    g.restore();
    if (this.hitFlash > 0) glowAt(g, 0, 0, 70 * C.scale / 2, GLOW.white, this.hitFlash * 0.5);
    g.save(); g.translate(0, -34 * C.scale); g.rotate(Math.sin(t * 2) * 0.08); drawIcon(g, 'crown', 0, 0, 30 + C.scale * 4, '#ffd76a'); g.restore();
    // 正面护甲 / 散兵护盾
    for (const pl of this.plates) if (pl.alive) {
      const u = 1 - pl.hp / pl.max;
      g.save(); g.translate(-26 * C.scale - 14, pl.dy); g.rotate(pl.dy * 0.004);
      g.fillStyle = pl.flash > 0 ? '#ffffff' : '#c7d0f0'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
      g.beginPath(); g.roundRect ? g.roundRect(-14, -24, 28, 48, 8) : g.rect(-14, -24, 28, 48); g.fill(); g.stroke();
      g.fillStyle = '#5b6798'; g.beginPath(); g.arc(-5, -12, 2.4, 0, TAU); g.arc(5, 12, 2.4, 0, TAU); g.fill();
      if (u > 0.3) { g.strokeStyle = '#3c4470'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(-10, -16); g.lineTo(0, -2); g.lineTo(-6, 10); if (u > 0.66) { g.moveTo(0, -2); g.lineTo(10, 6); } g.stroke(); }
      g.restore();
    }
    if (this.guard) { g.strokeStyle = `rgba(200,230,255,${0.6 + Math.sin(t * 8) * 0.2})`; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 40 * C.scale, 0, TAU); g.stroke(); }
    if (this.transT > 0) { const u = 1 - this.transT / 1.4; g.strokeStyle = `rgba(255,243,200,${1 - u})`; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 90 + u * 200, 0, TAU); g.stroke(); }
    g.restore();
  }
}
