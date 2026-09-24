'use strict';
/* 梦潮回声航线 — combat world: player verbs (move / auto-aim shot / 切 / 弹反 / 闪 / 奏), bullets, enemies,
   rooms & waves, performances, card rules, feedback. Fixed-step simulation, logical height 720. */

const LH = 720;
const ARENA_TOP = 88, ARENA_BOTTOM = LH - 28;
const B_RADIUS = { pink: 7, blue: 6.5, gold: 8, white: 4, purple: 15 };
const B_DMG = { pink: 10, blue: 10, gold: 14, white: 16, purple: 0 };
const ENEMY_BULLET = { jelly: 'pink', boat: 'blue', tick: 'pink', star: 'gold', moth: 'pink', beacon: 'white', jellyE: 'pink', tickE: 'blue', starE: 'gold' };
let _eid = 1;

function computeMods(run, weapon) {
  const cards = (run && run.cards) || [], relics = (run && run.relics) || [];
  const c = (id) => { const k = cards.find((x) => x.id === id); return k ? k.stacks : 0; };
  const r = (id) => relics.includes(id);
  return {
    density: Math.max(0.45, 1 + 0.15 * c('echo') - 0.25 * c('quiet')),
    dust: (1 - 0.2 * c('quiet')) * (c('paperboat') ? 0.85 : 1),
    enemyDmg: c('unfocus') ? 1.1 : 1,
    dmgTaken: 1 + 0.15 * c('nightlamp'),
    playerDmg: (1 + 0.2 * c('nightlamp')) * (run && run.buffRooms > 0 ? 1.15 : 1),
    speed: (c('tide') ? 0.92 : 1) * (weapon ? weapon.speedK : 1),
    echo: c('echo'), tide: c('tide') > 0, gentle: 0.2 * c('gentle'), gentleExtra: 2 * c('gentle'),
    unfocus: c('unfocus') > 0, rewind: c('rewind') > 0, mirror: c('mirror') > 0, overheat: c('overheat') > 0,
    stardust: c('stardust') > 0, goldSpeed: 1 + 0.15 * c('stardust'),
    dashRecharge: c('mint') ? 3.2 : 4.5, dashDist: c('mint') ? 0.8 : 1,
    paperboat: c('paperboat') > 0, fallstar: c('fallstar') > 0, bulletSpeed: c('fallstar') ? 1.1 : 1,
    dashMax: 2 + (r('bellmint') ? 1 : 0), parryBonus: r('fork') ? 0.04 : 0, crane: r('crane'), grazeBonus: r('sand') ? 2 : 0, cutRange: r('glass') ? 1.2 : 1,
  };
}

function tempRun(weaponId, perfId) {
  return { weaponId, perfId, hp: 100, maxHp: 100, res: 0, resCap: 100, cards: [], relics: [], buffRooms: 0, rewindUsed: false, seenBullets: {}, dust: 0 };
}

class World {
  constructor(o) {
    this.mode = o.mode; // room | boss | tutorial | demo
    this.W = o.W || 1280; this.H = LH;
    this.settings = o.settings; this.cb = o.cb || {};
    this.run = o.run || tempRun(o.weapon || 'needle', o.perf || 'echo');
    this.node = o.node || null;
    this.diff = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal;
    if (this.mode === 'demo' || this.mode === 'tutorial') this.diff = DIFFICULTY.normal;
    this.weapon = WEAPONS[o.weapon || this.run.weaponId] || WEAPONS.needle;
    this.perfId = o.perf || this.run.perfId || 'echo';
    this.mods = computeMods(this.run, this.weapon);
    this.scene = o.scene || new SeaScene();
    this.low = this.settings.particles === 'low';
    this.t = 0; this.state = 'play'; this.stateT = 0;
    this.timeScale = 1; this.slowT = 0; this.hitstop = 0; this.trauma = 0; this.flash = 0; this.hurtFlash = 0; this.tilt = 0;
    this.bullets = new Pool(() => ({ on: false }), 520);
    this.shots = new Pool(() => ({ on: false }), 220);
    this.parts = new Pool(() => ({ on: false }), this.low ? 220 : 700);
    this.texts = []; this.enemies = []; this.warns = []; this.echoQ = []; this.gone = []; this.afterimg = []; this.pickups = []; this.events = [];
    this.arena = { top: ARENA_TOP, bottom: ARENA_BOTTOM }; this.arenaTarget = { top: ARENA_TOP, bottom: ARENA_BOTTOM };
    this.stats = { kills: 0, grazes: 0, cuts: 0, parries: 0, perfectParries: 0, perfectDodges: 0, damageTaken: 0, maxCombo: 0, time: 0, dust: 0 };
    this.combo = 0; this.grazeCd = 0; this.tideT = 10; this.tideWarned = false;
    this.perf = null; this.perfEnd = 0; this.bulletTime = 1; this.reverseT = 0; this.freezeScroll = 0;
    this.seen = new Set(Object.keys(this.run.seenBullets || {}));
    this.hint = null; this.dangerNear = false;
    this.boss = null; this.core = null; this.history = []; this.histT = 0;
    this.player = this.makePlayer();
    this.drainActive = false;
    if (this.mode === 'room') this.setupRoom();
    else if (this.mode === 'boss') this.setupBoss();
    else if (this.mode === 'tutorial') this.setupTutorial();
    else if (this.mode === 'demo') this.setupDemo();
  }

  /* ------------------------------------------------ setup ------------------------------------------------ */
  makePlayer() {
    const run = this.run;
    return {
      x: this.W * 0.28, y: (ARENA_TOP + ARENA_BOTTOM) / 2, vx: 0, vy: 0, r: 7, vr: 22,
      hp: run.hp, maxHp: run.maxHp, face: 'idle', faceT: 0, lean: 0, lamp: 1, flash: 0, blink: 0, blinkT: 2, hurtT: 0, tail: 0, phase: 0,
      hurtInv: 0, dashInv: 0, dashT: 0, dvx: 0, dvy: 0, dodgeReady: false, dash: Math.min(run.dashCharges === undefined ? 2 : run.dashCharges, this.mods.dashMax), dashRe: 0,
      cut: { state: 'none', t: 0, a: 0, hit: new Set(), cutAny: false, xMarks: 0 },
      parry: { on: false, t: 0, rec: 0 },
      aim: 0, fireT: 0.2, alt: 1, shield: this.mods.paperboat && this.mode !== 'demo', alive: true, afterT: 0, manualT: 0,
    };
  }
  setupRoom() {
    const n = this.node;
    this.roomType = n.type; this.depth = n.col + 1; this.goal = n.goal || 'kill';
    this.wave = 0; this.waveList = []; this.spawnQ = []; this.waveT = 0; this.safeT = 0; this.waveOpen = false;
    if (this.roomType === 'normal') this.waves = this.goal === 'kill' ? (this.depth <= 2 ? 3 : 4) : 0;
    else if (this.roomType === 'elite') { this.waves = 2; this.eliteType = n.elite || pick(['jellyE', 'tickE', 'starE']); this.eliteAffix = n.affix || pick(Object.keys(AFFIXES)); }
    else if (this.roomType === 'challenge') { this.waves = 3; this.minHp = 0.3; this.challengeFailed = false; }
    if (this.goal !== 'kill' && this.roomType === 'normal') { this.goalT = NORMAL_GOALS[this.goal].time; this.contT = 1.2; }
    if (this.goal === 'core') this.core = { x: this.W * 0.16, y: (ARENA_TOP + ARENA_BOTTOM) / 2, hp: 100, maxHp: 100, hitT: 0 };
    this.state = 'intro'; this.stateT = 1.1;
  }
  setupBoss() { this.boss = new ClockBoss(this); this.state = 'intro'; this.stateT = 3.4; this.depth = 9; }
  setupTutorial() {
    this.tut = { step: -1, t: 0, moved: 0, spawnT: 0, target: null, ok: false, okT: 0, startAt: 0 };
    this.nextTutStep();
  }
  setupDemo() {
    this.player.x = this.W * 0.24; this.player.shield = false;
    this.demo = { spawnT: 0.6, starT: 2.6, t: 0 };
    this.addEnemy('dummy', { x: this.W * 0.76, y: LH / 2, hp: 9999 });
  }

  emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }

  /* ------------------------------------------------ main step ------------------------------------------------ */
  step(dt) {
    if (this.hitstop > 0) { this.hitstop -= dt; this.scene.update(dt * 0.2); return; }
    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = smooth(this.timeScale, 0.45, 20, dt); } else this.timeScale = smooth(this.timeScale, 1, 10, dt);
    if (this.state === 'dying') this.timeScale = 0.4;
    const sdt = dt * this.timeScale;
    this.t += sdt; this.stats.time += this.state === 'play' ? sdt : 0;
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.flash = Math.max(0, this.flash - dt * 2.4); this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.arena.top = approach(this.arena.top, this.arenaTarget.top, 60 * dt); this.arena.bottom = approach(this.arena.bottom, this.arenaTarget.bottom, 60 * dt);
    if (this.freezeScroll > 0) { this.freezeScroll -= dt; this.scene.hold = Math.max(this.scene.hold, 0.02); }
    this.scene.dir = this.boss && this.boss.phase === 3 ? -1 : 1;
    this.scene.update(sdt);

    if (this.state === 'intro') {
      this.stateT -= dt;
      this.updatePlayer(sdt, this.mode !== 'boss');
      if (this.boss) this.boss.update(sdt);
      if (this.stateT <= 0) { this.state = 'play'; if (this.mode === 'room') this.onRoomStart(); }
    } else if (this.state === 'play') {
      this.updatePlayer(sdt, true);
      if (this.mode === 'room') this.updateRoom(sdt);
      else if (this.mode === 'tutorial') this.updateTutorial(sdt);
      else if (this.mode === 'demo') this.updateDemo(sdt);
      if (this.boss) this.boss.update(sdt);
      this.updateRules(sdt);
    } else if (this.state === 'clear') {
      this.stateT -= dt; this.updatePlayer(sdt, false); this.player.face = 'win';
      if (this.stateT <= 0 && !this.done) { this.done = true; if (this.cb.onClear) this.cb.onClear(this.result()); }
    } else if (this.state === 'dying') {
      this.stateT -= dt; this.player.face = 'lose'; this.player.lamp = Math.max(0, this.player.lamp - dt);
      if (this.boss) this.boss.update(sdt * 0.3);
      if (this.stateT <= 0 && !this.done) { this.done = true; if (this.cb.onDeath) this.cb.onDeath(this.result()); }
    }
    this.updateEnemies(sdt);
    this.updateBullets(sdt);
    this.updateShots(sdt);
    this.updatePickups(sdt);
    this.updateWarns(sdt);
    this.updatePerf(sdt, dt);
    this.updateFx(sdt);
    this.updateHint();
  }

  /* ------------------------------------------------ player ------------------------------------------------ */
  updatePlayer(dt, control) {
    const p = this.player, I = Input.out, demo = this.mode === 'demo';
    if (!p.alive) return;
    p.hurtInv = Math.max(0, p.hurtInv - dt); p.dashInv = Math.max(0, p.dashInv - dt); p.hurtT = Math.max(0, p.hurtT - dt * 2.5);
    p.flash = Math.max(0, p.flash - dt * 6); p.faceT = Math.max(0, p.faceT - dt);
    p.blinkT -= dt; if (p.blinkT <= 0) { p.blink = 1; p.blinkT = 2.2 + Math.random() * 2.5; } p.blink = Math.max(0, p.blink - dt * 8);
    // dash recharge
    if (p.dash < this.mods.dashMax) { p.dashRe += dt / this.mods.dashRecharge; if (p.dashRe >= 1) { p.dashRe = 0; p.dash++; } } else p.dashRe = 0;
    let mx = 0, my = 0;
    if (control && !demo && this.state === 'play') { mx = I.mx; my = I.my; }
    else if (control && !demo && this.state === 'intro') { mx = I.mx; my = I.my; }
    if (demo) {
      let ty = LH / 2 + Math.sin(this.t * 0.9) * 90, best = 1e9;
      this.bullets.each((b) => { if ((b.type === 'blue' || b.type === 'gold') && b.x > p.x && b.x - p.x < best) { best = b.x - p.x; ty = b.y; } });
      mx = clamp((this.W * 0.24 - p.x) / 60, -1, 1); my = clamp((ty - p.y) / 40, -1, 1);
    }
    const busy = p.cut.state === 'wind' || p.cut.state === 'active' || p.parry.on;
    let spd = 310 * this.mods.speed * (I.focus && !demo ? 0.48 : 1) * (this.perf && this.perf.id === 'echo' ? 1.1 : 1) * (busy ? 0.62 : 1);
    if (p.dashT > 0) {
      p.dashT -= dt; p.vx = p.dvx; p.vy = p.dvy;
      p.afterT -= dt; if (p.afterT <= 0) { p.afterT = 0.022; this.afterimg.push({ x: p.x, y: p.y, t: 0.26, lean: p.lean, face: p.face }); }
    } else {
      p.vx = smooth(p.vx, mx * spd, 18, dt); p.vy = smooth(p.vy, my * spd, 18, dt);
    }
    p.x = clamp(p.x + p.vx * dt, 30, this.W - 40);
    p.y = clamp(p.y + p.vy * dt, this.arena.top + 12, this.arena.bottom - 12);
    p.lean = smooth(p.lean, clamp(p.vx / 400, -1, 1), 10, dt);
    p.tail = smooth(p.tail, clamp(-p.vy / 60, -6, 6) + clamp(p.vx / 80, -4, 4), 8, dt);
    // history for 倒带
    this.histT -= dt; if (this.histT <= 0) { this.histT = 0.2; this.history.push({ x: p.x, y: p.y, hp: p.hp }); if (this.history.length > 30) this.history.shift(); }
    if (!control || this.state !== 'play') { if (p.faceT <= 0) p.face = this.state === 'clear' ? 'win' : 'idle'; return; }

    // aim
    this.updateAim(dt);
    // actions
    if (demo) this.demoPilot(dt);
    else {
      if (Input.consume('dash')) this.startDash(mx, my);
      if (Input.peek('cut', 130) && this.canAct()) { Input.consume('cut'); this.startCutOrParry(); }
      if (Input.consume('perform')) this.tryPerform();
    }
    this.updateCut(dt); this.updateParry(dt);
    // fire
    const auto = this.settings.autoFire || this.mode === 'tutorial' || demo;
    if (auto || I.fire) this.updateFire(dt); else p.fireT = Math.max(0, p.fireT - dt);
    // face
    if (p.faceT <= 0) {
      const low = p.hp / p.maxHp < 0.3;
      p.face = p.cut.state === 'wind' || p.cut.state === 'active' ? 'cut' : low ? 'low' : Math.hypot(p.vx, p.vy) > 60 ? 'move' : p.flash > 0.5 ? 'attack' : 'idle';
      p.lamp = low ? 0.45 + Math.sin(this.t * 5) * 0.1 : 1;
    }
  }
  canAct() { const p = this.player; return p.cut.state === 'none' && !p.parry.on && p.parry.rec <= 0 && p.dashT <= 0; }

  updateAim(dt) {
    const p = this.player, I = Input.out, mode = this.settings.aimMode;
    let manual = null;
    if (I.aimOn) manual = I.aimPoint ? angTo(p.x, p.y, I.aimPoint.x, I.aimPoint.y) : Math.atan2(I.aimY, I.aimX);
    if (this.mode === 'tutorial' || this.mode === 'demo') manual = null;
    const tgt = this.pickTarget();
    let a = p.aim;
    if (mode === 'manual') { if (manual !== null) a = manual; }
    else if (mode === 'assist') {
      if (manual !== null && Input.device !== 'kbm') { p.manualT = 0.6; }
      if (manual !== null && (Input.device !== 'kbm' || Input.out.fire)) {
        a = manual;
        if (tgt) { const ta = angTo(p.x, p.y, tgt.x, tgt.y); if (Math.abs(angDiff(manual, ta)) < 0.3) a = ta; }
      } else if (tgt) a = angTo(p.x, p.y, tgt.x, tgt.y);
    } else {
      // auto: a short manual drag still wins for a moment (手动拖动瞄准优先)
      if (manual !== null && Input.device !== 'kbm') p.manualT = 0.6;
      p.manualT = Math.max(0, p.manualT - dt);
      if (p.manualT > 0 && manual !== null) a = manual;
      else if (tgt) a = angTo(p.x, p.y, tgt.x, tgt.y);
    }
    p.aim = a;
  }
  pickTarget() {
    const p = this.player;
    if (this.boss && this.boss.alive && this.boss.targetable()) {
      const bp = this.boss.aimPoint(); return bp;
    }
    let best = null, bestS = 1e9;
    for (const e of this.enemies) {
      if (!e.alive || e.x < 0 || e.x > this.W || e.y < 0 || e.y > LH || e.leaving) continue;
      const a = angTo(p.x, p.y, e.x, e.y), inCone = Math.abs(angDiff(0, a)) < 1.25;
      const s = Math.sqrt(dist2(p.x, p.y, e.x, e.y)) + (inCone ? 0 : 700) + (e.type === 'dummy' ? 0 : 0);
      if (s < bestS) { bestS = s; best = e; }
    }
    return best;
  }

  updateFire(dt) {
    const p = this.player, w = this.weapon;
    p.fireT -= dt;
    if (p.fireT > 0) return;
    p.fireT += 1 / w.rate; if (p.fireT < -0.2) p.fireT = 0;
    p.flash = 1;
    this.fireWeapon(p.x + 8, p.y - 4, p.aim, 1);
    if (this.mods.mirror && this.mode !== 'demo') { const c = this.clonePos(); this.fireWeapon(c.x + 8, c.y - 4, this.cloneAim(c), 0.5, true); }
  }
  fireWeapon(x, y, a, k, fromClone) {
    const w = this.weapon, dmg = w.dmg * this.mods.playerDmg * k, range = 1300 * w.rangeK;
    const pan = (x / this.W) * 2 - 1;
    if (w.id === 'needle') {
      const p = this.player; p.alt = -p.alt;
      const ox = Math.cos(a + Math.PI / 2) * 4 * p.alt, oy = Math.sin(a + Math.PI / 2) * 4 * p.alt;
      this.addShot('needle', x + ox, y + oy, a, 1500, { dmg, life: range / 1500, r: 5, armor: 0.2 });
      if (!fromClone && p.alt > 0) Sound.sfx('shoot', { pan, gap: 90 });
    } else if (w.id === 'blade') {
      this.addShot('crescent', x + 10, y, a, 760, { dmg, life: range / 760, r: 22, pierce: 1, cuts: true, melee: true, armor: 0.11 });
      if (!fromClone) Sound.sfx('shootHeavy', { pan });
    } else if (w.id === 'kite') {
      const p = this.player; p.alt = -p.alt;
      this.addShot('arrow', x, y, a + 0.95 * p.alt, 560, { dmg, life: 2.1, r: 7, homing: 4.6, delayHome: 0.28, armor: 0.4 });
      if (!fromClone) Sound.sfx('arrow', { pan });
    } else if (w.id === 'bell') {
      const tgt = this.pickTarget();
      let d = range; if (tgt) d = Math.min(range, Math.sqrt(dist2(x, y, tgt.x, tgt.y)) + (tgt.vx ? tgt.vx * 0.3 : 0));
      this.addShot('bellNote', x, y, a, 540, { dmg, life: Math.max(0.12, d / 540), r: 8, bell: true, pierce: 2 });
      if (!fromClone) Sound.sfx('bellnote', { pan });
    }
  }
  clonePos() { const p = this.player, mid = (this.arena.top + this.arena.bottom) / 2; return { x: p.x - 6, y: clamp(2 * mid - p.y, this.arena.top + 12, this.arena.bottom - 12) }; }
  cloneAim(c) { const t = this.pickTarget(); return t ? angTo(c.x, c.y, t.x, t.y) : 0; }

  startDash(mx, my) {
    const p = this.player;
    if (p.dash <= 0 || p.dashT > 0) { if (p.dash <= 0) Sound.sfx('denied', { gap: 200 }); return; }
    p.dash--;
    let dx = mx, dy = my; const l = Math.hypot(dx, dy);
    if (l < 0.2) { dx = 1; dy = 0; } else { dx /= l; dy /= l; }
    const dist = 150 * this.mods.dashDist, dur = 0.14;
    p.dashT = dur; p.dvx = (dx * dist) / dur; p.dvy = (dy * dist) / dur;
    p.dashInv = 0.18; p.dodgeReady = true; p.afterT = 0;
    Sound.sfx('dash');
    for (let i = 0; i < 8; i++) this.part('mote', p.x, p.y + 14, -dx * rand(60, 160) + rand(-40, 40), -dy * rand(60, 160) + rand(-40, 40), 0.5, 3, 'rgba(201,168,255,0.9)');
    if (this.mode === 'tutorial' && this.tut.step === 4) this.tut.dashed = true;
  }

  startCutOrParry() {
    const p = this.player, dangerR = 92;
    let gold = false;
    this.bullets.each((b) => { if (b.type === 'gold' && !b.ghost && dist2(b.x, b.y, p.x, p.y) < dangerR * dangerR) gold = true; });
    if (gold) {
      p.parry.on = true; p.parry.t = 0; p.parry.win = 0.2 + this.mods.parryBonus; p.parry.got = false;
      this.part('ring', p.x, p.y, 0, 0, 0.25, 34, 'rgba(255,213,74,0.9)');
      return;
    }
    // cut: face the nearest cuttable bullet if one is close, else the aim direction
    let a = p.aim, best = 1e9; const R = this.weapon.cutR * this.mods.cutRange * 1.35;
    this.bullets.each((b) => { if (b.type !== 'blue' || b.ghost) return; const d = dist2(b.x, b.y, p.x, p.y); if (d < R * R && d < best) { best = d; a = angTo(p.x, p.y, b.x, b.y); } });
    Object.assign(p.cut, { state: 'wind', t: 0.08, a, hit: new Set(), cutAny: false, xMarks: 0 });
    Sound.sfx('swing', { pan: (p.x / this.W) * 2 - 1 });
  }
  updateCut(dt) {
    const p = this.player, c = p.cut;
    if (c.state === 'none') return;
    c.t -= dt;
    if (c.state === 'wind' && c.t <= 0) { c.state = 'active'; c.t = 0.12; p.faceT = 0.3; p.face = 'cut'; this.part('slash', p.x, p.y, 0, 0, 0.22, this.weapon.cutR * this.mods.cutRange, null, c.a); }
    if (c.state === 'active') {
      const R = this.weapon.cutR * this.mods.cutRange, A = this.weapon.cutA / 2;
      this.bullets.each((b) => {
        if (b.ghost) return;
        const d2 = dist2(b.x, b.y, p.x, p.y); if (d2 > (R + b.r) * (R + b.r)) return;
        const inArc = Math.abs(angDiff(c.a, angTo(p.x, p.y, b.x, b.y))) < A || d2 < 28 * 28;
        if (!inArc) return;
        if (b.type === 'blue') this.cutBullet(b);
        else if (b.type === 'pink' && c.xMarks < 2) { c.xMarks++; this.part('xmark', b.x, b.y - 12, 0, -30, 0.4, 8, 'rgba(255,255,255,0.8)'); }
      });
      for (const e of this.enemies) {
        if (!e.alive || c.hit.has(e.id)) continue;
        const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y));
        if (d > R + e.r) continue;
        if (Math.abs(angDiff(c.a, angTo(p.x, p.y, e.x, e.y))) > A + 0.3 && d > e.r + 20) continue;
        c.hit.add(e.id); this.damageEnemy(e, this.weapon.meleeDmg * this.mods.playerDmg, { melee: true, x: e.x, y: e.y });
      }
      if (this.boss && this.boss.alive && !c.hit.has('boss')) {
        const d = Math.sqrt(dist2(this.boss.x, this.boss.y, p.x, p.y));
        if (d < R + 118) { c.hit.add('boss'); this.boss.hit({ dmg: this.weapon.meleeDmg * this.mods.playerDmg, kind: 'melee', x: p.x + Math.cos(c.a) * R * 0.8, y: p.y + Math.sin(c.a) * R * 0.8 }); }
      }
      if (c.t <= 0) { c.state = 'rec'; c.t = 0.18; }
    } else if (c.state === 'rec' && c.t <= 0) c.state = 'none';
  }
  cutBullet(b) {
    const p = this.player; b.on = false; this.recordGone(b);
    this.stats.cuts++; this.bumpCombo();
    this.addRes(6, b.x, b.y);
    Sound.sfx('cut', { pan: (b.x / this.W) * 2 - 1, gap: 40 });
    this.shake(0.16);
    const a = angTo(p.x, p.y, b.x, b.y);
    for (const s of [-1, 1]) this.part('half', b.x, b.y, Math.cos(a + s * 1.4) * 140, Math.sin(a + s * 1.4) * 140, 0.35, 9, '#9fe9ff', a, s);
    for (let i = 0; i < (this.low ? 3 : 6); i++) this.part('dot', b.x, b.y, rand(-160, 160), rand(-160, 160), 0.4, 3, 'rgba(111,240,255,0.9)');
    for (const s of [-0.5, 0.5]) this.addShot('shard', b.x, b.y, a + s, 520, { dmg: 14 * (this.weapon.id === 'blade' ? 1.3 : 1) * this.mods.playerDmg, life: 1.8, r: 6, homing: 9, armor: 0.5 });
    this.text('切!', b.x, b.y - 18, '#aeeaff', 18, 4);
    this.queueEcho(b);
    if (this.mode === 'tutorial' && this.tut.step === 2) this.tut.ok = true;
  }
  updateParry(dt) {
    const p = this.player, pr = p.parry;
    if (pr.rec > 0) pr.rec -= dt;
    if (!pr.on) return;
    pr.t += dt;
    const reach = p.r + 34;
    this.bullets.each((b) => {
      if (b.type !== 'gold' || b.ghost) return;
      if (dist2(b.x, b.y, p.x, p.y) > (reach + b.r) * (reach + b.r)) return;
      const bonus = this.mods.parryBonus;
      const q = pr.t <= 0.06 + bonus * 0.5 ? 'perfect' : pr.t <= 0.12 + bonus * 0.75 ? 'precise' : 'normal';
      this.parryBullet(b, q); pr.got = true;
    });
    if (pr.t >= pr.win) { pr.on = false; pr.rec = pr.got ? 0.22 : 0.08; if (!pr.got) Sound.sfx('swing'); }
  }
  parryBullet(b, q) {
    const p = this.player; b.on = false;
    this.stats.parries++; this.bumpCombo(); this.queueEcho(b);
    const tgt = this.pickTarget(), a = tgt ? angTo(b.x, b.y, tgt.x, tgt.y) : 0;
    if (q === 'normal') {
      this.addRes(4, b.x, b.y); Sound.sfx('parryBlock'); this.text('弹反', b.x, b.y - 16, '#ffe38a', 16, 4);
      this.part('ring', b.x, b.y, 0, 0, 0.3, 26, 'rgba(255,213,74,0.8)');
    } else {
      const perfect = q === 'perfect';
      this.addRes(perfect ? 14 : 10, b.x, b.y);
      const n = this.mods.stardust ? 3 : 1;
      for (let i = 0; i < n; i++) this.addShot(perfect ? 'noteBig' : 'note', b.x, b.y, a + (i - (n - 1) / 2) * 0.35, 820, { dmg: (perfect ? 70 : 40) * this.mods.playerDmg, life: 2.2, r: perfect ? 12 : 9, homing: 7, pierce: perfect ? 2 : 0, armor: 0.8 });
      for (let i = 0; i < (this.low ? 4 : 9); i++) this.part('note', b.x, b.y, rand(-150, 150), rand(-200, 40), 0.8, 12, '#ffe38a');
      if (perfect) {
        this.stats.perfectParries++;
        Sound.sfx('parryPerfect'); this.hitstop = 0.07; this.shake(0.42); this.flash = Math.max(this.flash, 0.35);
        p.face = 'parry'; p.faceT = 0.6;
        this.text('完美弹反!!', b.x, b.y - 20, '#fff3b0', 24, 4);
        this.part('ring', p.x, p.y, 0, 0, 0.45, 120, 'rgba(255,243,176,0.9)');
        this.bullets.each((o) => { if (o.on && dist2(o.x, o.y, p.x, p.y) < 260 * 260) o.slowT = 0.6; });
        if (this.cb.onPerfectParry) this.cb.onPerfectParry();
      } else {
        Sound.sfx('parry'); this.shake(0.26); p.face = 'parry'; p.faceT = 0.35;
        this.text('精准弹反!', b.x, b.y - 18, '#ffe38a', 20, 4);
        this.part('ring', b.x, b.y, 0, 0, 0.35, 44, 'rgba(255,213,74,0.9)');
      }
    }
    if (this.mode === 'tutorial' && this.tut.step === 3) this.tut.ok = true;
  }

  tryPerform() {
    const run = this.run;
    if (this.perf) return;
    if (run.res < 100) { Sound.sfx('denied', { gap: 250 }); if (run.res < 100 && this.mode !== 'demo') this.text(`共振 ${Math.floor(run.res)}/100`, this.player.x, this.player.y - 44, '#ffe38a', 14, 3); return; }
    const P = PERFS[this.perfId], k = clamp(run.res / 100, 1, 1.3);
    this.perf = { id: P.id, t: 0, dur: P.dur * k };
    run.res = 0;
    this.emit('perf', { id: P.id });
    Sound.sfx('perf_' + P.id); Sound.setBoost('perf', 0.55);
    this.shake(0.3); this.flash = Math.max(this.flash, 0.28);
    Tele.log('performance_cast', { id: P.id });
    // chord burst
    const burst = 40 * (this.mods.overheat ? 1.8 : 1);
    for (const e of this.enemies) if (e.alive && e.x < this.W + 10) this.damageEnemy(e, burst, { perf: true, x: e.x, y: e.y });
    if (this.boss && this.boss.alive) this.boss.hit({ dmg: 25 * (this.mods.overheat ? 1.8 : 1), kind: 'burst', x: this.boss.x, y: this.boss.y });
    this.part('ring', this.player.x, this.player.y, 0, 0, 0.7, 420, 'rgba(255,243,176,0.8)');
    const p = this.player;
    if (P.id === 'melody') {
      const list = []; this.bullets.each((b) => { if (b.type !== 'purple' && Math.random() < 0.3) list.push(b); });
      for (const b of list) this.convertToNote(b);
    } else if (P.id === 'gravity') {
      this.bullets.each((b) => { if (b.type !== 'purple') { b.vy = -b.vy; b.ay = -b.ay; } });
      for (const e of this.enemies) if (e.alive && !e.elite && e.type !== 'dummy' && e.base !== 'beacon') { e.throwY0 = e.y; e.throwV = -420; this.damageEnemy(e, 15, { perf: true, x: e.x, y: e.y }); }
    } else if (P.id === 'still') {
      for (const e of this.enemies) if (e.alive && !e.elite) e.frozen = true;
      this.freezeScroll = 0.3;
      if (this.boss) this.boss.exposeWeak(1.5);
    }
    if (this.mode === 'tutorial' && this.tut.step === 5) this.tut.cast = true;
  }
  convertToNote(b) {
    b.on = false;
    const tgt = this.pickTarget(), a = tgt ? angTo(b.x, b.y, tgt.x, tgt.y) : 0;
    this.addShot('note', b.x, b.y, a, 600, { dmg: 10 * 1.35 * (this.mods.overheat ? 1.8 : 1) * this.mods.playerDmg, life: 2.4, r: 8, homing: 6, armor: 0.5 });
    this.part('note', b.x, b.y, rand(-40, 40), -60, 0.6, 12, '#ffe38a');
  }
  updatePerf(sdt, dt) {
    this.bulletTime = this.perf && this.perf.id === 'echo' ? 0.4 : 1;
    if (this.reverseT > 0) this.reverseT -= sdt;
    if (!this.perf) { this.tilt = smooth(this.tilt, 0, 6, dt); if (this.perfEnd > 0) this.perfEnd -= dt; return; }
    const P = this.perf; P.t += sdt;
    if (P.id === 'gravity') {
      this.tilt = smooth(this.tilt, 0.07, 5, dt);
      if (!this.low && Math.random() < 0.5) this.part('mote', rand(this.W), LH + 10, rand(-20, 20), rand(-160, -60), 1.6, rand(2, 4), 'rgba(170,240,255,0.7)');
    }
    if (P.id === 'melody' && Math.random() < 0.12) this.part('note', this.player.x + rand(-60, 60), this.player.y + rand(-50, 50), 0, -50, 0.8, 10, '#ffe38a');
    if (P.t >= P.dur) {
      // 0.3 s wind-down feedback
      if (P.id === 'still') for (const e of this.enemies) if (e.frozen) { e.frozen = false; this.damageEnemy(e, 30 * (this.mods.overheat ? 1.8 : 1), { perf: true, x: e.x, y: e.y }); for (let i = 0; i < 8; i++) this.part('mote', e.x, e.y, rand(-120, 120), rand(-120, 120), 0.8, 3, 'rgba(181,140,255,0.9)'); }
      this.perf = null; this.perfEnd = 0.3;
      Sound.sfx('perfEnd'); Sound.setBoost('perf', 0);
      this.part('ring', this.player.x, this.player.y, 0, 0, 0.3, 90, 'rgba(201,168,255,0.8)');
      if (this.mods.overheat && this.mode !== 'tutorial') {
        const p = this.player, loss = Math.round(p.maxHp * 0.1); p.hp = Math.max(1, p.hp - loss); this.text(`过热 -${loss}`, p.x, p.y - 40, '#ff9d8c', 16, 5);
      }
      if (this.mode === 'tutorial' && this.tut.step === 5) this.tut.ok = true;
    }
  }

  /* ------------------------------------------------ resonance / combo ------------------------------------------------ */
  addRes(n, x, y) {
    const run = this.run; if (this.mode === 'demo') return;
    const before = run.res;
    let k = this.diff.resGain; if (this.drainActive) k *= 0.5;
    const cap = run.resCap || 100;
    if (this.perf) return; // no gain while performing
    if (before >= cap) return;
    run.res = Math.min(cap, run.res + n * k);
    if (x !== undefined && n >= 4) this.text(`+${Math.round(n * k)}`, x + 14, y - 30, '#ffc94a', 13, 3);
    if (before < 100 && run.res >= 100) {
      this.emit('full'); Sound.sfx('resFull'); Sound.setBoost('perf', 0.35); Tele.log('resonance_full');
      this.part('ring', this.player.x, this.player.y, 0, 0, 0.6, 80, 'rgba(111,240,255,0.9)');
    }
  }
  bumpCombo() { this.combo++; if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo; }

  graze(b) {
    const p = this.player; this.stats.grazes++;
    if (this.grazeCd <= 0) { this.addRes(4 + this.mods.grazeBonus, b.x, b.y); this.grazeCd = 0.12; }
    Sound.sfx('graze', { pan: (b.x / this.W) * 2 - 1, gap: 60 });
    for (let i = 0; i < 3; i++) this.part('spark', (b.x + p.x) / 2, (b.y + p.y) / 2, rand(-120, 120), rand(-120, 120), 0.25, 6, 'rgba(174,234,255,0.95)');
    this.queueEcho(b);
  }
  queueEcho(b) {
    if (!this.mods.echo || this.echoQ.length > 40) return;
    this.echoQ.push({ x: b.x, y: b.y, t: 2 });
  }

  /* ------------------------------------------------ damage ------------------------------------------------ */
  hurtPlayer(dmg, x, y) {
    const p = this.player;
    if (!p.alive || this.state !== 'play') return;
    if (p.shield) {
      p.shield = false; p.hurtInv = 0.6; Sound.sfx('shieldPop'); this.text('纸船护盾', p.x, p.y - 40, '#dbe9ff', 16, 5);
      for (let i = 0; i < 10; i++) this.part('shard', p.x, p.y, rand(-200, 200), rand(-200, 200), 0.6, 6, '#dbe9ff');
      return;
    }
    if (this.mode === 'demo') return;
    const tut = this.mode === 'tutorial';
    const amount = Math.round(dmg * this.mods.enemyDmg * this.mods.dmgTaken);
    p.hurtInv = 1.0 * this.diff.invuln; p.hurtT = 1; p.face = 'hurt'; p.faceT = 0.45;
    this.combo = 0; this.hurtFlash = 1; this.shake(0.38); this.hitstop = Math.max(this.hitstop, 0.05);
    Sound.sfx('hurt');
    for (let i = 0; i < (this.low ? 5 : 12); i++) this.part('dot', p.x, p.y, rand(-220, 220), rand(-220, 220), 0.45, 3.5, 'rgba(255,122,107,0.95)');
    if (tut) { this.text('没关系，再来', p.x, p.y - 42, '#ffb2a8', 16, 5); if (this.mode === 'tutorial') this.tut.fail = true; return; }
    p.hp -= amount; this.stats.damageTaken += amount;
    this.text(`-${amount}`, p.x, p.y - 40, '#ff9d8c', 20, 5);
    if (this.roomType === 'challenge' && !this.challengeFailed && p.hp < p.maxHp * this.minHp) { this.challengeFailed = true; this.emit('banner', { title: '挑战失败', sub: '生命低于 30%：本房间奖励减少，但航线继续', dur: 2 }); }
    if (p.hp <= 0) {
      if (this.mods.rewind && !this.run.rewindUsed) return this.doRewind();
      p.hp = 0; p.alive = false; this.state = 'dying'; this.stateT = 1.8; this.slowT = 1.5;
      Sound.sfx('lose'); this.clearEnemyBullets(false);
    }
  }
  doRewind() {
    const p = this.player, snap = this.history[0] || { x: p.x, y: p.y, hp: p.maxHp * 0.3 };
    this.run.rewindUsed = true;
    p.x = snap.x; p.y = snap.y; p.hp = Math.max(Math.round(p.maxHp * 0.25), Math.round(snap.hp)); p.hurtInv = 1.6;
    Sound.sfx('rewind'); this.flash = 0.5; this.emit('banner', { title: '倒带', sub: '回到 5 秒前', dur: 1.4 });
    this.bullets.each((b) => { if (dist2(b.x, b.y, p.x, p.y) < 320 * 320) { b.on = false; this.part('mote', b.x, b.y, 0, -40, 0.5, 3, 'rgba(201,168,255,0.9)'); } });
    this.part('ring', p.x, p.y, 0, 0, 0.6, 200, 'rgba(201,168,255,0.9)');
    this.history = [];
  }
  damageEnemy(e, dmg, o = {}) {
    if (!e.alive) return false;
    if (e.shield > 0 && !o.perf) {
      e.shield -= dmg; e.hitFlash = 1; Sound.sfx('armor', { pan: (e.x / this.W) * 2 - 1, gap: 50 });
      if (e.shield <= 0) { e.shield = 0; e.stagger = 1; Sound.sfx('shieldPop'); this.text('护盾破碎!', e.x, e.y - 50, '#dbe9ff', 18, 3); this.shake(0.25); for (let i = 0; i < 12; i++) this.part('shard', e.x, e.y, rand(-260, 260), rand(-260, 260), 0.7, 7, '#cdefff'); }
      return false;
    }
    if (e.type === 'dummy' && this.mode === 'demo') { e.hitFlash = 1; e.hitT = 0.15; this.part('dot', o.x || e.x, o.y || e.y, rand(-80, 80), rand(-80, 80), 0.3, 3, 'rgba(255,243,176,0.9)'); return false; }
    e.hp -= dmg * (e.frozen ? 1.5 : 1); e.hitFlash = 1; e.hitT = 0.12;
    if (e.affix === 'echo' && !e.echoCd) { e.echoCd = 2.5; e.fireT = Math.min(e.fireT, 0.35); }
    if (e.hp <= 0) { this.killEnemy(e, o); return true; }
    Sound.sfx('hit', { pan: (e.x / this.W) * 2 - 1, gap: 45 });
    return false;
  }
  killEnemy(e, o = {}) {
    e.alive = false; e.dead = true;
    if (e.type === 'dummy') { this.shake(0.3); Sound.sfx('kill'); for (let i = 0; i < 20; i++) this.part('petal', e.x, e.y, rand(-260, 260), rand(-300, 100), 1, 6, pick(['#ff9fcf', '#9fe3f0', '#fff4ea'])); if (this.mode === 'tutorial' && this.tut.step === 1) this.tut.ok = true; return; }
    this.stats.kills++; this.bumpCombo();
    this.addRes(this.weapon.res, e.x, e.y);
    Sound.sfx('kill', { pan: (e.x / this.W) * 2 - 1, gap: 40 });
    if (e.elite) this.shake(0.45);
    const cols = { jelly: ['#9fe3f0', '#ff9fcf'], boat: ['#dbe9ff', '#9fb8ec'], tick: ['#ffc59a', '#fff4ea'], star: ['#b4c2ff', '#ffe38a'], moth: ['#dcd0ff', '#9f8cf5'], beacon: ['#e9e2ff', '#6f65c9'] };
    const cc = cols[e.base] || ['#ffe38a', '#fff'];
    for (let i = 0; i < (this.low ? 6 : 14) * (e.elite ? 2 : 1); i++) this.part('petal', e.x, e.y, rand(-220, 220), rand(-260, 120), 0.9, rand(4, 7), pick(cc));
    this.part('ring', e.x, e.y, 0, 0, 0.3, e.r * 2, 'rgba(255,255,255,0.7)');
    const dustN = e.elite ? 10 : randi(1, 2);
    for (let i = 0; i < dustN; i++) this.pickups.push({ kind: 'dust', x: e.x + rand(-10, 10), y: e.y + rand(-10, 10), vx: rand(-120, 120), vy: rand(-120, 80), t: 0 });
    if (e.base === 'moth') for (let i = 0; i < 2; i++) this.fire('purple', e.x, e.y, Math.PI + rand(-0.6, 0.6), 50, { life: 9 });
    if (o.melee && this.mods.gentle && Math.random() < this.mods.gentle) this.pickups.push({ kind: 'heart', x: e.x, y: e.y, vx: rand(-60, 60), vy: -80, t: 0 });
    if (e.affix === 'shatter') {
      this.addWarn({ kind: 'ring', x: e.x, y: e.y, r: 60, tWarn: 0.7 + this.diff.warnBonus, onFire: (w) => { const n = Math.round(24 * this.mods.density); for (let i = 0; i < n; i++) this.fire('pink', w.x, w.y, (i / n) * TAU, 150); } });
    }
    if (this.cb.onKill) this.cb.onKill(e.base);
  }

  /* ------------------------------------------------ bullets ------------------------------------------------ */
  fire(type, x, y, ang, spd, o = {}) {
    if (type !== 'purple' && this.perf && this.perf.id === 'melody' && Math.random() < 0.3 && this.state === 'play') {
      const tgt = this.pickTarget(), a = tgt ? angTo(x, y, tgt.x, tgt.y) : Math.PI;
      this.addShot('note', x, y, a, 600, { dmg: 10 * 1.35 * (this.mods.overheat ? 1.8 : 1) * this.mods.playerDmg, life: 2.4, r: 8, homing: 6, armor: 0.5 });
      return null;
    }
    const b = this.bullets.get(); if (!b) return null;
    let sp = spd * this.diff.bulletSpeed * (this.settings.bulletSlow ? 0.85 : 1);
    if (type !== 'purple') sp *= this.mods.bulletSpeed;
    if (type === 'gold') sp *= this.mods.goldSpeed;
    let vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    if (this.perf && this.perf.id === 'gravity' && type !== 'purple') vy = -vy;
    b.on = true; b.type = type; b.x = x; b.y = y; b.vx = vx; b.vy = vy;
    b.ax = o.ax || 0; b.ay = (o.ay || 0) + (this.mods.fallstar && type !== 'purple' ? 55 : 0);
    b.r = B_RADIUS[type]; b.dmg = o.dmg || B_DMG[type]; b.t = 0; b.life = o.life || 14;
    b.rot = ang; b.spin = o.spin || (type === 'blue' ? rand(-3, 3) : 0); b.grazed = false; b.ghost = o.ghost || 0; b.slowT = 0;
    b.curve = o.curve || 0; b.near = false; b.noRepeat = !!o.noRepeat; b.src = o.noRepeat ? null : { x, y, a: ang, s: spd, type };
    b.coreAim = !!o.coreAim; b.trail = 0;
    if (!this.seen.has(type)) this.markSeen(type);
    if (!o.silent) Sound.sfx({ pink: 'spawnPink', blue: 'spawnBlue', gold: 'spawnGold', white: 'laser', purple: 'bubble' }[type], { pan: (x / this.W) * 2 - 1, gap: type === 'white' ? 60 : 90 });
    return b;
  }
  markSeen(type) {
    this.seen.add(type);
    if (this.run.seenBullets) this.run.seenBullets[type] = 1;
    if (this.mode === 'demo') return;
    if (!(this.cb.known && this.cb.known(type))) this.emit('tip', { bullet: type });
    if (this.cb.onSeen) this.cb.onSeen(type);
  }
  firstTime(type) { return !this.seen.has(type); }
  aimAngle(x, y) {
    // target: player (or 镜中人 clone / 梦境核心), plus 失焦 offset
    const p = this.player; let tx = p.x, ty = p.y;
    if (this.core && this.core.hp > 0 && Math.random() < 0.4) { tx = this.core.x; ty = this.core.y; }
    else if (this.mods.mirror && Math.random() < 0.35) { const c = this.clonePos(); tx = c.x; ty = c.y; }
    let a = angTo(x, y, tx, ty);
    if (this.mods.unfocus) a += rand(-0.26, 0.26);
    return a;
  }
  recordGone(b) {
    if (!b.src || !this.boss || this.boss.phase !== 3) return;
    if (b.type === 'purple') return;
    this.gone.push(b.src); if (this.gone.length > 36) this.gone.shift();
  }
  clearEnemyBullets(toDust = true) {
    this.bullets.each((b) => {
      if (toDust && b.type !== 'purple' && Math.random() < 0.5) this.part('mote', b.x, b.y, rand(-30, 30), rand(-60, -10), 0.7, 2.5, 'rgba(201,168,255,0.9)');
      b.on = false;
    });
    this.warns = this.warns.filter((w) => w.keep);
  }
  updateBullets(dt) {
    const p = this.player, W = this.W, play = this.state === 'play' && p.alive;
    const rev = this.reverseT > 0 ? -1 : 1;
    this.grazeCd -= dt;
    let goldNear = false;
    const clone = this.mods.mirror && this.mode !== 'demo' ? this.clonePos() : null;
    this.bullets.each((b) => {
      if (b.ghost > 0) { b.ghost -= dt; return; }
      b.t += dt;
      let k = this.bulletTime * rev;
      if (b.slowT > 0) { b.slowT -= dt; k *= 0.3; }
      if (b.curve) { const c = Math.cos(b.curve * dt * k), s = Math.sin(b.curve * dt * k), vx = b.vx; b.vx = vx * c - b.vy * s; b.vy = vx * s + b.vy * c; }
      b.vx += b.ax * dt * Math.abs(k); b.vy += b.ay * dt * Math.abs(k);
      b.x += b.vx * dt * k; b.y += b.vy * dt * k;
      b.rot = b.type === 'white' ? Math.atan2(b.vy, b.vx) : b.rot + b.spin * dt * k;
      if (b.type === 'purple') { b.vx *= 1 - dt * 0.4; b.vy = Math.sin(b.t * 2 + b.x * 0.01) * 20; }
      if (b.x < -70 || b.x > W + 70 || b.y < -70 || b.y > LH + 70 || b.t > b.life) { if (b.type !== 'purple' && b.t <= b.life) this.recordGone(b); b.on = false; return; }
      if (!play) return;
      const d2 = dist2(b.x, b.y, p.x, p.y);
      if (b.type === 'purple') {
        if (d2 < (p.r + b.r + 12) * (p.r + b.r + 12)) { b.on = false; this.absorbBubble(b); }
        return;
      }
      if (b.type === 'gold' && d2 < 170 * 170) { goldNear = true; if (!b.near) { b.near = true; Sound.sfx('goldNear', { gap: 150 }); } }
      const hitR = p.r + b.r;
      if (d2 < hitR * hitR) {
        if (p.dashInv > 0) { if (p.dodgeReady) this.perfectDodge(b); return; }
        if (p.hurtInv > 0) return;
        b.on = false; this.hurtPlayer(b.dmg, b.x, b.y); return;
      }
      const gR = hitR + 20;
      if (!b.grazed && d2 < gR * gR && p.hurtInv <= 0) { b.grazed = true; this.graze(b); }
      if (clone && dist2(b.x, b.y, clone.x, clone.y) < (b.r + 10) * (b.r + 10)) {
        b.on = false; if (!this.cloneHitCd || this.cloneHitCd <= 0) { this.cloneHitCd = 0.6; this.run.res = Math.max(0, this.run.res - 5); this.text('影子 -5 共振', clone.x, clone.y - 30, '#c9a8ff', 13, 3); }
        return;
      }
      if (this.core && this.core.hp > 0 && dist2(b.x, b.y, this.core.x, this.core.y) < (b.r + 20) * (b.r + 20)) {
        b.on = false; this.core.hp -= Math.round(b.dmg * 0.8); this.core.hitT = 0.3; Sound.sfx('armor', { gap: 60 });
        if (this.core.hp <= 0) this.breakCore();
      }
    });
    if (this.cloneHitCd > 0) this.cloneHitCd -= dt;
    this.dangerNear = goldNear;
    // 回声 card echoes
    for (const e of this.echoQ) {
      e.t -= dt;
      if (e.t <= 0) { const tgt = this.pickTarget(); this.addShot('echo', e.x, e.y, tgt ? angTo(e.x, e.y, tgt.x, tgt.y) : 0, 560, { dmg: 12 * this.mods.playerDmg, life: 2, r: 7, homing: 5, armor: 0.4 }); this.part('ring', e.x, e.y, 0, 0, 0.3, 20, 'rgba(201,168,255,0.8)'); }
    }
    this.echoQ = this.echoQ.filter((e) => e.t > 0);
  }
  perfectDodge(b) {
    const p = this.player; p.dodgeReady = false;
    this.stats.perfectDodges++; this.bumpCombo();
    this.addRes(8, b.x, b.y); Sound.sfx('perfectDodge'); this.slowT = 0.28;
    this.text('完美闪避', p.x, p.y - 44, '#aeeaff', 18, 4);
    this.part('ring', p.x, p.y, 0, 0, 0.35, 60, 'rgba(174,234,255,0.9)');
    Tele.log('perfect_dodge');
  }
  absorbBubble(b) {
    Sound.sfx('bubble', { pan: (b.x / this.W) * 2 - 1 });
    const p = this.player;
    for (let i = 0; i < 6; i++) this.part('mote', b.x, b.y, (p.x - b.x) * 2 + rand(-40, 40), (p.y - b.y) * 2 + rand(-40, 40), 0.4, 3, 'rgba(181,140,255,0.95)');
    this.gainDust(3);
    if (Math.random() < 0.15) this.heal(6);
    this.addRes(2);
  }
  gainDust(n) { const v = n * this.mods.dust; this.stats.dust += v; this.run.dust = (this.run.dust || 0) + v; }
  heal(n) {
    const p = this.player; if (this.mode === 'demo') return;
    const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + n);
    if (p.hp > before) { this.text(`+${Math.round(p.hp - before)}`, p.x, p.y - 40, '#ffb2a8', 16, 4); Sound.sfx('heart'); for (let i = 0; i < 6; i++) this.part('heart', p.x + rand(-14, 14), p.y, rand(-30, 30), rand(-120, -60), 0.8, 6, '#ff9d8c'); }
  }
  breakCore() {
    this.core.hp = 0; this.coreBroken = true; Sound.sfx('shieldPop'); this.shake(0.5);
    for (let i = 0; i < 24; i++) this.part('shard', this.core.x, this.core.y, rand(-300, 300), rand(-300, 300), 0.9, 7, '#9ff4ff');
    this.emit('banner', { title: '核心破碎', sub: '房间提前结束，奖励减少', dur: 1.8 });
    this.finishRoom();
  }

  /* ------------------------------------------------ player shots ------------------------------------------------ */
  addShot(kind, x, y, a, spd, o = {}) {
    const s = this.shots.get(); if (!s) return null;
    s.on = true; s.kind = kind; s.x = x; s.y = y; s.vx = Math.cos(a) * spd; s.vy = Math.sin(a) * spd; s.spd = spd;
    s.dmg = o.dmg || 10; s.life = o.life || 1.5; s.t = 0; s.r = o.r || 6; s.pierce = o.pierce || 0; s.hits = [];
    s.homing = o.homing || 0; s.delayHome = o.delayHome || 0; s.cuts = !!o.cuts; s.melee = !!o.melee; s.bell = !!o.bell; s.armor = o.armor || 0.2;
    s.armed = false; s.fuse = 0; s.trail = [];
    return s;
  }
  updateShots(dt) {
    const W = this.W;
    this.shots.each((s) => {
      s.t += dt;
      if (s.bell && s.armed) {
        s.fuse -= dt;
        if (s.fuse <= 0) this.explodeBell(s);
        return;
      }
      if (s.homing && s.t > s.delayHome) {
        const tgt = this.pickTarget();
        if (tgt) {
          const a = Math.atan2(s.vy, s.vx), ta = angTo(s.x, s.y, tgt.x, tgt.y), na = a + clamp(angDiff(a, ta), -s.homing * dt, s.homing * dt);
          const sp = Math.hypot(s.vx, s.vy); s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp;
        }
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.kind === 'arrow' || s.kind === 'note' || s.kind === 'noteBig' || s.kind === 'shard') { s.trail.push(s.x, s.y); if (s.trail.length > 16) s.trail.splice(0, 2); }
      if (s.t > s.life || s.x < -60 || s.x > W + 60 || s.y < -60 || s.y > LH + 60) {
        if (s.bell && s.t > s.life) { s.armed = true; s.fuse = 0.55; return; }
        s.on = false; return;
      }
      if (s.bell) return; // bell notes only explode
      // blade crescents cut blue diamonds on contact
      if (s.cuts) this.bullets.each((b) => { if (b.type === 'blue' && !b.ghost && dist2(b.x, b.y, s.x, s.y) < (s.r + b.r) * (s.r + b.r)) { this.cutBullet(b); } });
      // enemies
      for (const e of this.enemies) {
        if (!e.alive || s.hits.includes(e.id)) continue;
        if (e.orbs && this.orbBlock(e, s)) { s.on = false; return; }
        if (dist2(e.x, e.y, s.x, s.y) < (e.r + s.r) * (e.r + s.r)) {
          s.hits.push(e.id); this.damageEnemy(e, s.dmg, { melee: s.melee, x: s.x, y: s.y });
          this.part('dot', s.x, s.y, rand(-90, 90), rand(-90, 90), 0.22, 2.5, 'rgba(255,243,176,0.95)');
          if (s.pierce-- <= 0) { s.on = false; return; }
        }
      }
      if (this.boss && this.boss.alive && !s.hits.includes('boss') && dist2(this.boss.x, this.boss.y, s.x, s.y) < (118 + s.r) * (118 + s.r)) {
        s.hits.push('boss');
        this.boss.hit({ dmg: s.dmg, kind: s.kind, armor: s.armor, x: s.x, y: s.y });
        this.part('dot', s.x, s.y, rand(-90, 90), rand(-90, 90), 0.22, 2.5, 'rgba(255,243,176,0.95)');
        if (s.pierce-- <= 0) { s.on = false; return; }
      }
    });
  }
  orbBlock(e, s) {
    for (let i = 0; i < 3; i++) {
      const a = this.t * 1.6 + (i * TAU) / 3, ox = e.x + Math.cos(a) * 37, oy = e.y + Math.sin(a) * 30;
      if (dist2(ox, oy, s.x, s.y) < (8 + s.r) * (8 + s.r)) { this.part('dot', ox, oy, rand(-60, 60), rand(-60, 60), 0.2, 2.5, 'rgba(190,240,255,0.9)'); Sound.sfx('armor', { gap: 60 }); return true; }
    }
    return false;
  }
  explodeBell(s) {
    s.on = false;
    const R = 82; let n = 0;
    Sound.sfx('boomNote');
    this.part('ring', s.x, s.y, 0, 0, 0.35, R, 'rgba(201,168,255,0.95)');
    for (let i = 0; i < (this.low ? 4 : 8); i++) this.part('note', s.x, s.y, rand(-150, 150), rand(-150, 150), 0.6, 10, '#d8c4ff');
    for (const e of this.enemies) { if (e.alive && n < 3 && dist2(e.x, e.y, s.x, s.y) < (R + e.r) * (R + e.r)) { n++; this.damageEnemy(e, s.dmg, { x: e.x, y: e.y }); } }
    if (this.boss && this.boss.alive && dist2(this.boss.x, this.boss.y, s.x, s.y) < (R + 118) * (R + 118)) this.boss.hit({ dmg: s.dmg, kind: 'bell', armor: 0.25, x: s.x, y: s.y });
    this.bullets.each((b) => { if (b.type === 'blue' && dist2(b.x, b.y, s.x, s.y) < R * R) this.cutBullet(b); });
  }

  /* ------------------------------------------------ pickups ------------------------------------------------ */
  updatePickups(dt) {
    const p = this.player;
    for (const k of this.pickups) {
      k.t += dt;
      const d = Math.sqrt(dist2(k.x, k.y, p.x, p.y));
      if (k.t > 0.35 && (d < 150 || this.state === 'clear')) { const a = angTo(k.x, k.y, p.x, p.y), sp = 520 + k.t * 200; k.vx = smooth(k.vx, Math.cos(a) * sp, 10, dt); k.vy = smooth(k.vy, Math.sin(a) * sp, 10, dt); }
      else { k.vx *= 1 - dt * 3; k.vy *= 1 - dt * 3; k.vx -= 20 * dt; }
      k.x += k.vx * dt; k.y += k.vy * dt;
      if (d < 20 && p.alive) {
        k.done = true;
        if (k.kind === 'dust') { this.gainDust(1); Sound.sfx('dust', { gap: 50 }); }
        else if (k.kind === 'heart') this.heal(8);
      }
      if (k.t > 12 || k.x < -40) k.done = true;
    }
    this.pickups = this.pickups.filter((k) => !k.done);
  }

  /* ------------------------------------------------ warnings (预警线 / 区域 / 光束) ------------------------------------------------ */
  addWarn(w) {
    w.t = 0; w.tWarn = (w.tWarn || 1) + (this.settings.simpleWarn ? 0.15 : 0); w.fired = false; w.life = w.life || 0;
    this.warns.push(w); if (!w.silent) Sound.sfx('warn', { pan: ((w.x || this.W / 2) / this.W) * 2 - 1, gap: 120 });
    return w;
  }
  updateWarns(dt) {
    const p = this.player;
    for (const w of this.warns) {
      w.t += dt;
      if (w.follow) { w.x = w.follow.x; w.y = w.follow.y; }
      if (!w.fired && w.t >= w.tWarn) { w.fired = true; if (w.onFire) w.onFire(w); w.beamT = w.beam || 0; }
      if (w.fired && w.beamT > 0) {
        w.beamT -= dt;
        if (this.state === 'play' && p.alive && p.dashInv <= 0 && p.hurtInv <= 0) {
          const ex = w.x + Math.cos(w.a) * w.len, ey = w.y + Math.sin(w.a) * w.len;
          if (segDist2(p.x, p.y, w.x, w.y, ex, ey) < (w.w / 2 + p.r) * (w.w / 2 + p.r)) this.hurtPlayer(w.dmg || 16, p.x, p.y);
        } else if (p.dashInv > 0 && p.dodgeReady && this.state === 'play') {
          const ex = w.x + Math.cos(w.a) * w.len, ey = w.y + Math.sin(w.a) * w.len;
          if (segDist2(p.x, p.y, w.x, w.y, ex, ey) < (w.w / 2 + p.r) * (w.w / 2 + p.r)) this.perfectDodge({ x: p.x, y: p.y });
        }
      }
    }
    this.warns = this.warns.filter((w) => !w.fired || w.beamT > 0 || (w.post && w.t < w.tWarn + w.post));
  }

  /* ------------------------------------------------ enemies ------------------------------------------------ */
  addEnemy(type, o = {}) {
    const elite = type.endsWith('E');
    const base = elite ? type.slice(0, -1) : type;
    const HP = { jelly: 52, boat: 48, tick: 80, star: 62, moth: 34, beacon: 90, dummy: 150, jellyE: 650, tickE: 700, starE: 600 };
    const R = { jelly: 20, boat: 22, tick: 20, star: 20, moth: 18, beacon: 22, dummy: 34, jellyE: 30, tickE: 28, starE: 26 };
    const hpK = 1 + (this.depth ? (this.depth - 1) * 0.08 : 0);
    const e = {
      id: _eid++, type, base, elite, x: o.x !== undefined ? o.x : this.W + 50, y: o.y !== undefined ? o.y : rand(this.arena.top + 40, this.arena.bottom - 40),
      vx: 0, vy: 0, r: R[type], hp: (o.hp || HP[type]) * (type === 'dummy' ? 1 : hpK), t: 0, seed: rand(10), charge: 0, fireT: rand(0.9, 1.7), alive: true, hitFlash: 0, hitT: 0,
      affix: o.affix || null, shield: elite ? 180 * hpK : 0, shieldMax: elite ? 180 * hpK : 0, frozen: false, throwV: 0, stagger: 0, echoCd: 0, shots: 0, wave: this.wave,
    };
    if (elite) { e.orbs = type === 'jellyE'; e.speedK = e.affix === 'fast' ? 1.3 : 1; } else e.speedK = 1;
    if (type === 'beacon') { e.flip = o.flip !== undefined ? o.flip : Math.random() < 0.5; e.y = e.flip ? ARENA_TOP - 4 : LH - 56; e.x = o.x || rand(this.W * 0.5, this.W * 0.86); e.baseY = e.y; e.fireT = 1.6; e.enterT = 0.6; }
    else if (type === 'boat') { e.x = this.W + 40; e.vx = -rand(70, 90); e.fireT = 1.0; }
    else if (type === 'dummy') { e.fireT = 99; }
    else { e.tx = o.tx || rand(this.W * 0.56, this.W * 0.86); e.ty = e.y; }
    if (type === 'star') e.tx = rand(this.W * 0.5, this.W * 0.72);
    if (elite) { e.tx = this.W * 0.74; e.ty = (this.arena.top + this.arena.bottom) / 2; e.y = e.ty; e.fireT = 2; }
    e.maxHp = e.hp; e.baseY = e.y;
    this.enemies.push(e);
    return e;
  }
  updateEnemies(dt) {
    const p = this.player;
    this.drainActive = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt; e.hitFlash = Math.max(0, e.hitFlash - dt * 6); e.hitT = Math.max(0, e.hitT - dt);
      if (e.echoCd > 0) e.echoCd -= dt;
      if (e.affix === 'drain') this.drainActive = true;
      if (e.frozen || this.state === 'dying' || this.state === 'clear') { if (e.leaving) this.moveLeave(e, dt); continue; }
      if (e.stagger > 0) { e.stagger -= dt; continue; }
      if (e.throwV) { e.y += e.throwV * dt; e.throwV += 760 * dt; e.rotT = (e.rotT || 0) + dt; if (e.throwV > 0 && e.y >= e.throwY0) { e.y = e.throwY0; e.throwV = 0; } e.y = Math.max(40, e.y); continue; }
      const k = dt * (e.speedK || 1);
      if (e.leaving) { this.moveLeave(e, dt); continue; }
      if (this.mode !== 'demo' && this.state !== 'play' && e.type !== 'dummy') continue;
      const fn = this['ai_' + e.base]; if (fn) fn.call(this, e, k, p);
    }
    this.enemies = this.enemies.filter((e) => e.alive || (e.dead && false));
  }
  moveLeave(e, dt) { e.x += 260 * dt; e.alpha = (e.alpha === undefined ? 1 : e.alpha) - dt * 1.5; if (e.x > this.W + 80 || e.alpha <= 0) e.alive = false; }
  enter(e, k) { if (e.tx !== undefined) { e.x = smooth(e.x, e.tx, 2.2, k); } }
  telegraph(e, k, lead = 0.45) { e.fireT -= k; e.charge = e.fireT < lead ? 1 - e.fireT / lead : 0; return e.fireT <= 0; }
  dens(type, n) { return Math.max(1, Math.round(n * this.mods.density * (this.firstTime(type) ? 0.6 : 1) * (this.waveDensity || 1))); }

  ai_jelly(e, k, p) {
    this.enter(e, k); e.y = e.baseY + Math.sin(e.t * 1.2 + e.seed) * 40;
    if (e.elite) return this.ai_jellyElite(e, k, p);
    if (this.telegraph(e, k)) {
      e.fireT = 2.5; const n = this.dens('pink', 5), a0 = this.aimAngle(e.x, e.y), spread = 0.7;
      for (let i = 0; i < n; i++) this.fire('pink', e.x - 10, e.y, a0 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread), 175);
    }
  }
  ai_jellyElite(e, k, p) {
    if (this.telegraph(e, k, 0.6)) {
      e.fireT = 3.4 / e.speedK; e.burst = 1.2; e.burstT = 0;
    }
    if (e.burst > 0) {
      e.burst -= k; e.burstT -= k;
      if (e.burstT <= 0) { e.burstT = 0.1; const arms = 3; for (let i = 0; i < arms; i++) this.fire('pink', e.x, e.y, e.t * 2.2 + (i * TAU) / arms, 150 * e.speedK); }
      if (e.burst <= 0 && Math.random() < 0.6) { const n = this.dens('blue', 4), a0 = this.aimAngle(e.x, e.y); for (let i = 0; i < n; i++) this.fire('blue', e.x, e.y, a0 + (i / Math.max(1, n - 1) - 0.5) * 0.6, 190 * e.speedK); }
    }
  }
  ai_boat(e, k, p) {
    e.x += e.vx * k; e.y = e.baseY + Math.sin(e.t * 1.5) * 8;
    if (this.telegraph(e, k, 0.3)) { e.fireT = 1.6; const a = angTo(e.x, e.y, p.x, p.y); this.fire('blue', e.x - 16, e.y, Math.PI + clamp(angDiff(Math.PI, a), -0.35, 0.35), 205); }
    if (e.x < -60) { e.alive = false; e.escaped = true; }
  }
  ai_tick(e, k, p) {
    if (e.elite) return this.ai_tickElite(e, k, p);
    if (e.hop === undefined) { e.hop = 0; e.hx0 = e.x; e.hy0 = e.y; e.hx1 = e.tx; e.hy1 = e.y; }
    if (e.hop < 1) {
      e.hop = Math.min(1, e.hop + k / 0.55); const u = Ease.inOutSine(e.hop);
      e.x = lerp(e.hx0, e.hx1, u); e.y = lerp(e.hy0, e.hy1, u) - Math.sin(e.hop * Math.PI) * 40;
    } else if (!e.charge && e.fireT > 1.2 && Math.random() < k * 0.5) {
      e.hop = 0; e.hx0 = e.x; e.hy0 = e.y; e.hx1 = clamp(e.x + rand(-160, 120), this.W * 0.5, this.W - 60); e.hy1 = clamp(e.y + rand(-140, 140), this.arena.top + 40, this.arena.bottom - 40);
    }
    if (e.hop >= 1 && this.telegraph(e, k, 0.6)) {
      e.fireT = 3.1; const n = this.dens('pink', 12), gapAt = randi(0, n - 1), off = rand(TAU);
      for (let i = 0; i < n; i++) { if (i === gapAt || i === (gapAt + 1) % n) continue; this.fire('pink', e.x, e.y, off + (i / n) * TAU, 150); }
    }
  }
  ai_tickElite(e, k, p) {
    this.enter(e, k); e.y = e.ty + Math.sin(e.t * 0.9) * 60;
    if (this.telegraph(e, k, 0.7)) {
      e.fireT = 3.6 / e.speedK; e.ringT = 0.45;
      const n = this.dens('pink', 14), off = rand(TAU); for (let i = 0; i < n; i++) if (i % 7) this.fire('pink', e.x, e.y, off + (i / n) * TAU, 140 * e.speedK);
      for (let q = 0; q < 4; q++) for (let j = 0; j < 3; j++) this.fire('blue', e.x, e.y, (q * Math.PI) / 2 + Math.PI / 4 + e.t, (150 + j * 45) * e.speedK);
    }
    if (e.ringT > 0) { e.ringT -= k; if (e.ringT <= 0) { const n = this.dens('pink', 14), off = rand(TAU); for (let i = 0; i < n; i++) if (i % 7) this.fire('pink', e.x, e.y, off + (i / n) * TAU, 120 * e.speedK); } }
  }
  ai_star(e, k, p) {
    if (e.elite) return this.ai_starElite(e, k, p);
    if (e.shots >= 2) { e.x += 150 * k; if (e.x > this.W + 60) { e.alive = false; e.escaped = true; } return; }
    this.enter(e, k); e.y = e.baseY + Math.sin(e.t * 2 + e.seed) * 14;
    if (this.telegraph(e, k, 0.6)) { e.fireT = 2.2; e.shots++; this.fire('gold', e.x - 18, e.y, this.aimAngle(e.x, e.y), 225); }
  }
  ai_starElite(e, k, p) {
    this.enter(e, k); e.y = e.ty + Math.sin(e.t * 1.1) * 90;
    if (this.telegraph(e, k, 0.6)) { e.fireT = 4 / e.speedK; e.volley = 3; e.volleyT = 0; }
    if (e.volley > 0) {
      e.volleyT -= k;
      if (e.volleyT <= 0) {
        e.volleyT = 0.45; e.volley--; this.fire('gold', e.x - 20, e.y, this.aimAngle(e.x, e.y), 230 * e.speedK);
        if (e.volley === 0) { const n = this.dens('pink', 7), a0 = this.aimAngle(e.x, e.y); for (let i = 0; i < n; i++) this.fire('pink', e.x, e.y, a0 + (i / (n - 1) - 0.5) * 1.1, 170 * e.speedK); }
      }
    }
  }
  ai_moth(e, k, p) {
    if (e.wx === undefined || e.t > e.wt) { e.wx = rand(this.W * 0.45, this.W - 60); e.wy = rand(this.arena.top + 30, this.arena.bottom - 30); e.wt = e.t + rand(1.2, 2.2); }
    e.x = smooth(e.x, e.wx, 1.4, k); e.y = smooth(e.y, e.wy + Math.sin(e.t * 9) * 6, 1.8, k);
    if (this.telegraph(e, k, 0.35)) { e.fireT = 2.6; const a = this.aimAngle(e.x, e.y); for (const s of [-0.18, 0.18]) this.fire('pink', e.x, e.y, a + s, 150); }
  }
  ai_beacon(e, k, p) {
    if (e.enterT > 0) { e.enterT -= k; return; }
    e.aim = smooth(e.aim || Math.PI, angTo(e.x, e.y, p.x, p.y), 3, k);
    e.fireT -= k; e.charge = e.lock ? clamp(e.lockT / 1.0, 0, 1) : 0;
    if (!e.lock && e.fireT <= 0) {
      e.lock = true; e.lockT = 0; const a = angTo(e.x, e.y + (e.flip ? 10 : -10), p.x, p.y), ex = e.x, ey = e.y + (e.flip ? 10 : -10);
      this.addWarn({ kind: 'line', x: ex, y: ey, a, len: 1500, w: 3, tWarn: 1.0 + this.diff.warnBonus, onFire: (w) => {
        const n = this.dens('white', 6);
        for (let i = 0; i < n; i++) this.fire('white', w.x + Math.cos(w.a) * (i * -26), w.y + Math.sin(w.a) * (i * -26), w.a, 720, { silent: i > 0 });
        e.lock = false; e.fireT = 3.2;
      } });
    }
    if (e.lock) e.lockT += k;
  }
  ai_dummy(e, k) { e.y = e.baseY + Math.sin(e.t * 1.2) * 20; }

  /* ------------------------------------------------ room flow ------------------------------------------------ */
  onRoomStart() {
    if (this.goal === 'kill' || this.roomType !== 'normal') this.nextWave();
    this.emit('roomStart');
  }
  genWave(n) {
    const d = this.depth, L = [];
    const add = (t, c = 1) => { for (let i = 0; i < c; i++) L.push(t); };
    this.waveDensity = 1; this.forceTide = false;
    if (this.roomType === 'normal') {
      if (n === 1) { add('jelly', 3 + (d >= 3 ? 1 : 0)); add('moth', 1 + (d >= 5 ? 1 : 0)); if (d >= 4) add('tick'); }
      else if (n === 2) { add('boat', 2); add(d >= 3 ? 'star' : 'jelly', 2); add('moth'); if (d >= 2) add('tick'); if (d >= 5) add('star'); }
      else if (n === 3) { add('beacon'); add(pick(['jelly', 'tick']), 2); add('boat'); add(d >= 3 ? 'star' : 'moth'); add('moth'); if (d >= 4) add('jelly'); }
      else { add('beacon'); add('tick'); add('star'); add('boat'); add('jelly', 2); if (d >= 6) add('beacon'); }
    } else if (this.roomType === 'elite') {
      if (n === 1) { add('jelly', 2); add('moth'); add('boat'); }
      else { L.push({ elite: this.eliteType, affix: this.eliteAffix }); add('moth'); add(d >= 4 ? 'star' : 'jelly'); add('boat'); }
    } else if (this.roomType === 'challenge') {
      if (n === 1) { add('jelly', 3); add('tick', 2); add('moth', 2); this.waveDensity = 1.3; }
      else if (n === 2) { add('beacon', 2); add('boat', 2); add('star'); this.forceTide = true; this.tideT = 3; }
      else { L.push({ elite: pick(['jellyE', 'tickE', 'starE']), affix: pick(Object.keys(AFFIXES)) }); add('jelly'); add('tick'); add('star'); }
    }
    const extra = this.mods.gentleExtra + this.diff.extraEnemies;
    for (let i = 0; i < extra; i++) add(pick(['jelly', 'moth', 'boat']));
    // a new bullet type appears → lower pressure the first time
    const newType = L.some((t) => typeof t === 'string' && this.firstTime(ENEMY_BULLET[t]));
    if (newType && L.length > 4) L.splice(Math.max(4, Math.ceil(L.length * 0.8)));
    return L;
  }
  nextWave() {
    this.wave++;
    const L = this.genWave(this.wave);
    this.spawnQ = L.map((t, i) => ({ t: 0.4 + i * 0.95, e: t }));
    this.waveT = 0; this.waveOpen = true;
    this.emit('wave', { n: this.wave, of: this.waves });
    if (this.roomType === 'normal' && this.wave === 3) this.emit('toast', { text: '第三波起：灯塔眼会先画出白色预警线' });
  }
  spawnEntry(entry) {
    if (typeof entry === 'string') return this.addEnemy(entry);
    const e = this.addEnemy(entry.elite, { affix: entry.affix });
    this.emit('banner', { title: ENEMY_INFO[entry.elite].name, sub: `精英 · ${AFFIXES[entry.affix].name}：${AFFIXES[entry.affix].desc}`, dur: 1.8 });
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy(entry.elite);
    return e;
  }
  updateRoom(dt) {
    // spawn queue
    for (const q of this.spawnQ) { q.t -= dt; if (q.t <= 0 && !q.done) { q.done = true; const e = this.spawnEntry(q.e); if (e && this.cb.onSeenEnemy) this.cb.onSeenEnemy(e.type); } }
    this.spawnQ = this.spawnQ.filter((q) => !q.done);
    if (this.goal !== 'kill' && this.roomType === 'normal') return this.updateTimedRoom(dt);
    this.waveT += dt;
    const fighters = this.enemies.filter((e) => e.alive && e.base !== 'beacon' && !e.leaving);
    if (this.waveOpen && this.spawnQ.length === 0 && (fighters.length === 0 || this.waveT > 40)) {
      this.waveOpen = false; this.safeT = 1.0;
      for (const e of this.enemies) if (e.alive && e.base === 'beacon' && this.waveT <= 40) e.leaving = true;
      this.clearEnemyBullets(true); this.warns = [];
      Sound.sfx('waveClear');
      if (this.wave < this.waves) { this.pickups.push({ kind: Math.random() < 0.3 ? 'heart' : 'dust', x: this.W * 0.6, y: LH / 2, vx: -60, vy: 0, t: 0 }); }
    }
    if (!this.waveOpen && this.safeT > 0) {
      this.safeT -= dt;
      if (this.safeT <= 0) { if (this.wave < this.waves) this.nextWave(); else if (this.enemies.every((e) => !e.alive || e.leaving)) this.finishRoom(); else this.safeT = 0.3; }
    }
  }
  updateTimedRoom(dt) {
    this.goalT -= dt;
    this.contT -= dt;
    const alive = this.enemies.filter((e) => e.alive && !e.leaving).length;
    if (this.contT <= 0 && alive < 6) {
      this.contT = rand(2.4, 3.2);
      const pool = ['jelly', 'moth', 'boat', 'tick'];
      if (this.depth >= 3) pool.push('star');
      if (this.goalT < 25 && !this.enemies.some((e) => e.alive && e.base === 'beacon')) pool.push('beacon');
      const n = Math.random() < 0.4 ? 2 : 1; for (let i = 0; i < n; i++) this.spawnEntry(pick(pool));
    }
    if (this.goalT <= 0) { this.goalT = 0; for (const e of this.enemies) if (e.alive) e.leaving = true; this.clearEnemyBullets(true); this.finishRoom(); }
  }
  finishRoom() {
    if (this.state !== 'play') return;
    this.state = 'clear'; this.stateT = 1.4; this.clearEnemyBullets(true); this.warns = [];
    for (const e of this.enemies) if (e.alive) e.leaving = true;
    Sound.sfx('win'); this.player.face = 'win';
  }
  result() {
    const p = this.player;
    this.run.hp = Math.max(0, Math.round(p.hp)); this.run.dashCharges = p.dash;
    return { stats: this.stats, coreBroken: !!this.coreBroken, challengeFailed: !!this.challengeFailed, goal: this.goal, roomType: this.roomType, bossTime: this.bossTime || 0 };
  }

  /* ------------------------------------------------ rules: 潮汐 card, echoes ------------------------------------------------ */
  updateRules(dt) {
    if ((this.mods.tide || this.forceTide) && this.mode !== 'demo') {
      this.tideT -= dt;
      if (this.tideT <= 1 && !this.tideWarned) { this.tideWarned = true; this.emit('flag', { text: '潮汐将至', color: 'cyan', dur: 1 }); Sound.sfx('warn'); }
      if (this.tideT <= 0) {
        this.tideT = this.forceTide && !this.mods.tide ? 6 : 10; this.tideWarned = false;
        this.bullets.each((b) => { if (b.type !== 'purple') { b.vy = -b.vy; b.ay = -b.ay; } });
        Sound.sfx('tide'); this.emit('flag', { text: '潮汐翻转', color: 'cyan', dur: 1 });
        for (let i = 0; i < (this.low ? 8 : 20); i++) this.part('mote', rand(this.W), rand(LH), 0, rand(-80, 80), 0.8, 3, 'rgba(111,240,255,0.7)');
      }
    }
  }

  /* ------------------------------------------------ tutorial ------------------------------------------------ */
  tutText(step) {
    const d = Input.device, hint = (a) => Input.hintFor(a);
    const S = {
      0: d === 'touch' ? ['拖动左侧区域移动', '粉色圆弹只能躲。擦边而过还能攒共振。'] : d === 'pad' ? ['左摇杆移动', '按住 LT 精确移动。粉色圆弹只能躲。'] : [`${hint('up')}${hint('left')}${hint('down')}${hint('right')} / 方向键移动`, `按住 ${hint('focus')} 精确移动。粉色圆弹只能躲，擦边而过能攒共振。`],
      1: ['自动射击会锁定目标', d === 'touch' ? '右侧区域可以拖动改瞄准方向。把靶子打散吧。' : '不用按键，梦灯会自己瞄准。把靶子打散吧。'],
      2: [`靠近蓝色菱形弹，按「切」${d === 'touch' ? '' : `（${hint('cut')}）`}`, '切开的碎片会变成你的攻击。'],
      3: [`金色星弹进圈后，按「切」弹反${d === 'touch' ? '' : `（${hint('cut')}）`}`, '危险圈出现时按键就是弹反。越接近命中的瞬间，越完美。'],
      4: [`白线变亮后，按住方向再按「闪」离开白线${d === 'touch' ? '' : `（${hint('dash')}）`}`, '闪避瞬间无敌。擦着弹幕闪过去，就是完美闪避。'],
      5: [`共振满溢！按「奏」释放时间回声${d === 'touch' ? '' : `（${hint('perform')}）`}`, '演奏会改写规则：这一次，所有敌弹都会慢下来。'],
    };
    return S[step];
  }
  nextTutStep() {
    const T = this.tut; T.step++; T.t = 0; T.ok = false; T.okT = 0; T.fail = false; T.spawnT = 0.5; T.cast = false; T.dashed = false;
    for (const e of this.enemies) e.alive = false;
    this.clearEnemyBullets(false); this.warns = [];
    if (T.step > 5) { this.state = 'clear'; this.stateT = 1.2; this.emit('tut', { text: '教学完成', sub: '接下来，是真正的航线。' }); this.done = false; this.cb.onClear = this.cb.onTutorialDone; return; }
    const [text, sub] = this.tutText(T.step);
    this.emit('tut', { text, sub, step: T.step });
    if (T.step === 1) T.target = this.addEnemy('dummy', { x: this.W * 0.72, y: LH / 2, hp: 150 });
    if (T.step === 2 || T.step === 3) this.addEnemy('dummy', { x: this.W * 0.8, y: LH / 2, hp: 99999 });
    if (T.step === 5) { this.run.res = 100; this.emit('full'); this.perfId = 'echo'; }
  }
  updateTutorial(dt) {
    const T = this.tut, p = this.player; T.t += dt;
    if (T.step === 0) {
      T.moved += Math.hypot(p.vx, p.vy) * dt;
      T.spawnT -= dt; if (T.spawnT <= 0) { T.spawnT = 1.4; this.fire('pink', this.W + 20, rand(this.arena.top + 40, this.arena.bottom - 40), Math.PI, 150); }
      if (T.moved > 380 && T.t > 2) { if (this.cb.onTutMove) this.cb.onTutMove(T.t); this.nextTutStep(); }
      return;
    }
    if (T.ok) { T.okT += dt; if (T.okT > 1.3) this.nextTutStep(); return; }
    if (T.step === 2) {
      let any = false; this.bullets.each((b) => { if (b.type === 'blue') { any = true; if (b.x < p.x - 90) b.on = false; } });
      if (!any) { T.spawnT -= dt; if (T.spawnT <= 0) { T.spawnT = 0.8; this.fire('blue', this.W + 10, p.y, Math.PI, 150); } }
    } else if (T.step === 3) {
      let any = false; this.bullets.each((b) => { if (b.type === 'gold') { any = true; if (b.x < p.x - 90) b.on = false; } });
      if (!any) { T.spawnT -= dt; if (T.spawnT <= 0) { T.spawnT = 0.9; this.fire('gold', this.W + 10, p.y + rand(-40, 40), angTo(this.W + 10, p.y, p.x, p.y), 170); } }
    } else if (T.step === 4) {
      if (!T.wave) {
        T.spawnT -= dt;
        if (T.spawnT <= 0) {
          T.wave = true; T.fail = false; T.dashed = false; const y = p.y;
          this.addWarn({ kind: 'line', x: this.W + 20, y, a: Math.PI, len: this.W + 60, w: 3, tWarn: 1.3, onFire: (w) => {
            for (let i = 0; i < 12; i++) this.fire('white', w.x + i * 34, w.y, Math.PI, 820, { silent: i > 0, life: 4 });
            T.checkT = 2.2;
          } });
        }
      } else if (T.checkT !== undefined) {
        T.checkT -= dt;
        if (T.checkT <= 0) {
          T.checkT = undefined; T.wave = false; T.spawnT = 0.6;
          if (!T.fail) { T.ok = true; this.pickups.push({ kind: 'heart', x: p.x + 60, y: p.y, vx: 0, vy: 0, t: 0 }); this.text('获得梦心', p.x, p.y - 50, '#ffb2a8', 18, 4); }
        }
      }
    } else if (T.step === 5) {
      T.spawnT -= dt;
      if (T.spawnT <= 0) { T.spawnT = 1.1; const gap = randi(2, 7); for (let i = 0; i < 10; i++) if (Math.abs(i - gap) > 1) this.fire('pink', this.W + 10, this.arena.top + 20 + i * 58, Math.PI, 130, { silent: i > 0 }); }
    }
  }

  /* ------------------------------------------------ weapon demo (loadout preview) ------------------------------------------------ */
  updateDemo(dt) {
    const D = this.demo; D.t += dt;
    D.spawnT -= dt; if (D.spawnT <= 0) { D.spawnT = 1.25; this.fire('blue', this.W + 10, this.player.y + rand(-30, 30), Math.PI, 260, { silent: true }); }
    D.starT -= dt; if (D.starT <= 0) { D.starT = 2.6; this.fire('gold', this.W * 0.66, this.player.y, Math.PI, 240, { silent: true }); }
    if (D.t > 5) { D.t = 0; this.bullets.clear(); this.shots.clear(); }
  }
  demoPilot() {
    const p = this.player;
    let gold = null, blue = null;
    this.bullets.each((b) => { const d = Math.sqrt(dist2(b.x, b.y, p.x, p.y)); if (b.type === 'gold' && d < 52) gold = b; if (b.type === 'blue' && d < this.weapon.cutR * 0.8) blue = b; });
    if ((gold || blue) && this.canAct()) this.startCutOrParry();
  }

  /* ------------------------------------------------ hints / fx ------------------------------------------------ */
  updateHint() {
    const p = this.player; let parry = false, cut = false; const cr = this.weapon.cutR * this.mods.cutRange * 1.4;
    this.bullets.each((b) => {
      const d2 = dist2(b.x, b.y, p.x, p.y);
      if (b.type === 'gold' && d2 < 92 * 92) parry = true;
      else if (b.type === 'blue' && d2 < cr * cr) cut = true;
    });
    this.hint = parry ? 'parry' : cut ? 'cut' : null;
  }
  shake(v) { if (this.settings.shake) this.trauma = Math.min(1, this.trauma + v); }
  text(str, x, y, color, size = 16, prio = 1) {
    if (this.texts.length > 14) { const i = this.texts.findIndex((t) => t.prio < prio); if (i < 0) return; this.texts.splice(i, 1); }
    this.texts.push({ str, x, y, color, size, prio, t: 0, life: 0.9 });
  }
  part(kind, x, y, vx, vy, life, size, color, rot = 0, extra = 0) {
    if (this.low && (kind === 'dot' || kind === 'spark' || kind === 'mote') && Math.random() < 0.5) return;
    const q = this.parts.get(); if (!q) return;
    q.on = true; q.kind = kind; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.t = 0; q.life = life; q.size = size; q.color = color; q.rot = rot; q.extra = extra; q.vr = rand(-6, 6);
  }
  updateFx(dt) {
    this.parts.each((q) => {
      q.t += dt; if (q.t >= q.life) { q.on = false; return; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
      if (q.kind === 'petal' || q.kind === 'shard' || q.kind === 'half') { q.vy += 380 * dt; q.vx *= 1 - dt * 1.5; }
      else if (q.kind === 'heart' || q.kind === 'note') { q.vy -= 20 * dt; q.vx *= 1 - dt * 2; }
      else { q.vx *= 1 - dt * 3; q.vy *= 1 - dt * 3; }
    });
    for (const t of this.texts) { t.t += dt; t.y -= (40 - t.t * 30) * dt; }
    this.texts = this.texts.filter((t) => t.t < t.life);
    for (const a of this.afterimg) a.t -= dt;
    this.afterimg = this.afterimg.filter((a) => a.t > 0);
  }

  /* ------------------------------------------------ HUD snapshot ------------------------------------------------ */
  hud() {
    const p = this.player, run = this.run;
    const h = {
      hp: Math.max(0, p.hp), maxHp: p.maxHp, res: run.res, resCap: run.resCap || 100, full: run.res >= 100, perf: this.perf ? this.perf.id : null,
      dash: p.dash, dashMax: this.mods.dashMax, dashRe: p.dashRe, hint: this.hint, combo: this.combo, shield: p.shield,
    };
    if (this.mode === 'room') {
      if (this.goal !== 'kill' && this.roomType === 'normal') { h.obj = NORMAL_GOALS[this.goal].short; h.timer = this.goalT; }
      else { h.wave = this.wave; h.waves = this.waves; h.obj = this.roomType === 'elite' ? '击破精英护盾并击败它' : this.roomType === 'challenge' ? '完成三波，生命保持在 30% 以上' : '击败所有敌人'; }
      if (this.core) h.core = Math.max(0, this.core.hp);
      if (this.challengeFailed) h.failed = true;
    }
    if (this.boss) h.boss = this.boss.hudInfo();
    return h;
  }

  /* ------------------------------------------------ render ------------------------------------------------ */
  render(g, o = {}) {
    const W = this.W, t = this.t, p = this.player, cb = this.settings.colorblind;
    g.save();
    if (this.trauma > 0) { const s = this.trauma * this.trauma * 14; g.translate(rand(-s, s), rand(-s, s)); }
    if (this.tilt) { g.translate(W / 2, LH / 2); g.rotate(this.tilt * Math.sin(t * 1.2)); g.translate(-W / 2, -LH / 2); }
    if (o.simpleBg) { const gr = g.createLinearGradient(0, 0, 0, LH); gr.addColorStop(0, '#1b1548'); gr.addColorStop(1, '#2e2670'); g.fillStyle = gr; g.fillRect(-20, -20, W + 40, LH + 40); }
    else this.scene.draw(g, W, LH);
    // performance backdrops
    if (this.perf && this.perf.id === 'melody') this.drawStaff(g);
    // arena shrink walls (第二乐章)
    if (this.arena.top > ARENA_TOP + 1 || this.arena.bottom < ARENA_BOTTOM - 1) {
      g.fillStyle = 'rgba(255,138,92,0.14)'; g.fillRect(0, 0, W, this.arena.top); g.fillRect(0, this.arena.bottom, W, LH - this.arena.bottom);
      g.strokeStyle = 'rgba(255,190,150,0.55)'; g.setLineDash([10, 8]); g.lineWidth = 2; g.lineDashOffset = -t * 30;
      g.beginPath(); g.moveTo(0, this.arena.top); g.lineTo(W, this.arena.top); g.moveTo(0, this.arena.bottom); g.lineTo(W, this.arena.bottom); g.stroke(); g.setLineDash([]);
    }
    this.drawWarns(g);
    if (this.core) this.drawCore(g);
    // pickups
    for (const k of this.pickups) {
      if (k.kind === 'dust') { g.globalCompositeOperation = 'lighter'; drawGlow(g, k.x, k.y, 10, GLOW.purple, 0.9); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#efe4ff'; g.fillRect(k.x - 1.5, k.y - 1.5, 3, 3); }
      else { g.save(); g.translate(k.x, k.y); g.scale(0.9 + Math.sin(t * 6) * 0.08, 0.9 + Math.sin(t * 6) * 0.08); g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 22, GLOW.coral, 0.8); g.globalCompositeOperation = 'source-over'; heartPath(g, 0, 0, 9); g.fillStyle = '#ff8f80'; g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.stroke(); g.restore(); }
    }
    // enemies
    for (const e of this.enemies) if (e.alive) this.drawEnemy(g, e);
    if (this.boss) this.boss.draw(g);
    // player shots
    this.shots.each((s) => this.drawShot(g, s));
    // player, clone, afterimages
    for (const a of this.afterimg) drawPlayer(g, { x: a.x, y: a.y, face: a.face, lean: a.lean, alpha: a.t * 1.6, lamp: 0.6 }, t, { noMist: true, noGlow: true });
    if (this.mods.mirror && this.mode !== 'demo' && p.alive) { const c = this.clonePos(); g.save(); g.globalAlpha = 0.42 + (this.cloneHitCd > 0 ? Math.sin(t * 40) * 0.2 : 0); drawPlayer(g, { x: c.x, y: c.y, face: p.face, lean: p.lean, lamp: 0.5, phase: 1, alpha: 0.45 }, t, { noGlow: true }); g.restore(); }
    this.drawPlayerFx(g, 'under');
    const blinkHide = p.hurtInv > 0 && p.alive && Math.sin(t * 40) > 0.3 && this.state === 'play';
    if (!blinkHide || this.state !== 'play') drawPlayer(g, Object.assign({}, p, { alpha: p.hurtInv > 0 && this.state === 'play' ? 0.65 : 1 }), t);
    this.drawPlayerFx(g, 'over');
    // enemy bullets — drawn above characters so their outline stays readable
    const trails = this.perf && this.perf.id === 'echo';
    this.bullets.each((b) => {
      if (b.ghost > 0) { g.globalAlpha = 0.25 + 0.25 * Math.sin(t * 20); BulletArt.draw(g, b.type, b.x, b.y, b.type === 'blue' || b.type === 'white' ? b.rot : 0, 1, cb); g.globalAlpha = 1; return; }
      if (trails && b.type !== 'purple') { for (let i = 1; i <= 3; i++) { g.globalAlpha = 0.18 / i; BulletArt.draw(g, b.type, b.x - b.vx * 0.05 * i, b.y - b.vy * 0.05 * i, b.rot, 1, false); } g.globalAlpha = 1; }
      if (this.perf && this.perf.id === 'gravity' && b.type !== 'purple') { g.globalAlpha = 0.2; BulletArt.draw(g, b.type, b.x, b.y - Math.sign(b.vy) * 14, b.rot, 1, false); g.globalAlpha = 1; }
      if (this.reverseT > 0 && b.type !== 'purple') { g.globalAlpha = 0.22; BulletArt.draw(g, b.type, b.x + b.vx * 0.06, b.y + b.vy * 0.06, b.rot, 1, false); g.globalAlpha = 1; }
      BulletArt.draw(g, b.type, b.x, b.y, b.type === 'blue' || b.type === 'white' ? b.rot : b.type === 'gold' ? b.t * 3 : 0, 1, cb);
      if (b.type === 'purple') { for (let i = 0; i < 3; i++) { const a = b.t * 2 + (i * TAU) / 3; g.fillStyle = 'rgba(240,228,255,0.9)'; g.fillRect(b.x + Math.cos(a) * 5 - 1, b.y + Math.sin(a) * 5 - 1, 2, 2); } }
    });
    // hitbox core always on top (碰撞核心)
    if (p.alive && this.settings.showHitbox && this.mode !== 'demo') {
      g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(255,122,107,0.95)'; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, 3.4, 0, TAU); g.fill(); g.stroke();
    }
    this.drawParticles(g);
    this.drawTexts(g);
    g.restore();
    this.drawOverlays(g, o);
  }
  drawStaff(g) {
    const W = this.W, t = this.t;
    g.strokeStyle = 'rgba(255,227,138,0.18)'; g.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) { g.beginPath(); for (let x = 0; x <= W; x += 40) g.lineTo(x, LH * 0.42 + i * 16 + Math.sin(x * 0.01 + t * 2) * 10); g.stroke(); }
  }
  drawWarns(g) {
    const t = this.t, reduce = this.settings.reduceFlash, simple = this.settings.simpleWarn;
    for (const w of this.warns) {
      const u = clamp(w.t / w.tWarn, 0, 1), bright = w.t > 0.3;
      if (w.kind === 'line') {
        const ex = w.x + Math.cos(w.a) * w.len, ey = w.y + Math.sin(w.a) * w.len;
        if (!w.fired) {
          g.strokeStyle = bright ? `rgba(255,255,255,${0.45 + 0.4 * u})` : 'rgba(255,255,255,0.14)';
          g.lineWidth = bright ? 2 + u * 2 + (simple ? 2 : 0) : 1.2;
          g.setLineDash(bright ? [14, 8] : []); g.lineDashOffset = -t * 120;
          g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
          if (bright && !reduce && u > 0.8) { g.strokeStyle = `rgba(200,225,255,${(u - 0.8) * 2})`; g.lineWidth = 10; g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(ex, ey); g.stroke(); }
        }
        if (w.fired && w.beamT > 0) {
          g.globalCompositeOperation = 'lighter';
          g.strokeStyle = 'rgba(255,248,220,0.9)'; g.lineWidth = w.w; g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(ex, ey); g.stroke();
          g.strokeStyle = 'rgba(255,207,74,0.4)'; g.lineWidth = w.w * 2.4; g.stroke();
          g.globalCompositeOperation = 'source-over';
        }
      } else if (w.kind === 'zone') {
        if (!w.fired) {
          g.fillStyle = `rgba(255,255,255,${0.05 + (bright ? 0.1 * u : 0)})`; g.fillRect(w.x, w.y, w.w, w.h);
          g.save(); g.beginPath(); g.rect(w.x, w.y, w.w, w.h); g.clip();
          g.strokeStyle = `rgba(255,255,255,${bright ? 0.25 + 0.35 * u : 0.1})`; g.lineWidth = simple ? 5 : 3;
          for (let x = w.x - w.h; x < w.x + w.w; x += 36) { const o = ((t * 60) % 36); g.beginPath(); g.moveTo(x + o, w.y + w.h); g.lineTo(x + o + w.h, w.y); g.stroke(); }
          g.restore();
          g.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * u})`; g.lineWidth = 3; g.strokeRect(w.x, w.y, w.w, w.h);
        }
      } else if (w.kind === 'arc') {
        if (!w.fired) {
          g.fillStyle = `rgba(255,255,255,${bright ? 0.06 + 0.1 * u : 0.04})`;
          g.beginPath(); g.moveTo(w.x, w.y); g.arc(w.x, w.y, w.len, w.a0, w.a1); g.closePath(); g.fill();
          g.strokeStyle = `rgba(255,255,255,${bright ? 0.35 + 0.4 * u : 0.12})`; g.lineWidth = 2; g.setLineDash([12, 10]); g.lineDashOffset = -t * 80;
          g.beginPath(); g.arc(w.x, w.y, w.len, w.a0, w.a1); g.stroke(); g.setLineDash([]);
          for (let i = 1; i <= 3; i++) { const a = lerp(w.a0, w.a1, i / 4); g.fillStyle = `rgba(255,255,255,${bright ? 0.5 : 0.2})`; g.beginPath(); const ax = w.x + Math.cos(a) * w.len, ay = w.y + Math.sin(a) * w.len; g.arc(ax, ay, 4, 0, TAU); g.fill(); }
        }
      } else if (w.kind === 'ring') {
        g.strokeStyle = `rgba(255,255,255,${0.2 + 0.6 * u})`; g.lineWidth = 2 + u * 3; g.setLineDash([8, 6]); g.beginPath(); g.arc(w.x, w.y, w.r * (1 - u * 0.4), 0, TAU); g.stroke(); g.setLineDash([]);
      }
    }
  }
  drawCore(g) {
    const c = this.core; if (c.hp <= 0) return;
    g.save(); g.translate(c.x + (c.hitT > 0 ? rand(-2, 2) : 0), c.y); EnemyArt.core(g, c, this.t); g.restore();
    g.strokeStyle = 'rgba(111,240,255,0.9)'; g.lineWidth = 4; g.beginPath(); g.arc(c.x, c.y, 36, -Math.PI / 2, -Math.PI / 2 + (c.hp / c.maxHp) * TAU); g.stroke();
    c.hitT = Math.max(0, c.hitT - 1 / 60);
  }
  drawEnemy(g, e) {
    const t = this.t;
    g.save(); g.translate(e.x, e.y);
    if (e.alpha !== undefined) g.globalAlpha = clamp(e.alpha, 0, 1);
    const unfocus = this.mods.unfocus && e.type !== 'dummy';
    if (e.frozen) g.globalAlpha *= 0.4;
    if (unfocus) g.globalAlpha *= 0.28;
    if (e.affix === 'fast') { g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(e.r + 6, -10 + i * 10); g.lineTo(e.r + 22 + Math.sin(t * 20 + i) * 4, -10 + i * 10); g.stroke(); } }
    (EnemyArt[e.type] || EnemyArt.jelly)(g, e, t + e.seed);
    if (e.affix === 'echo') { g.globalAlpha *= 0.3; g.translate(6, -4); (EnemyArt[e.type])(g, e, t + e.seed - 0.2); g.translate(-6, 4); g.globalAlpha /= 0.3; }
    if (e.hitFlash > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, e.r * 1.6, GLOW.white, e.hitFlash * 0.55); g.globalCompositeOperation = 'source-over'; }
    g.globalAlpha = 1;
    if (e.frozen || unfocus) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 16, GLOW.white, 0.9); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, 4.5, 0, TAU); g.fill(); }
    if (e.shield > 0) {
      const a = 0.35 + (e.hitFlash > 0 ? 0.35 : 0);
      g.strokeStyle = `rgba(205,239,255,${a + 0.2})`; g.fillStyle = `rgba(160,220,255,${a * 0.25})`; g.lineWidth = 2.5;
      g.beginPath(); for (let i = 0; i < 6; i++) { const an = (i * TAU) / 6 + t * 0.4; g.lineTo(Math.cos(an) * (e.r + 18), Math.sin(an) * (e.r + 18)); } g.closePath(); g.fill(); g.stroke();
    }
    if (e.affix === 'shatter') { g.strokeStyle = `rgba(255,150,120,${0.5 + Math.sin(t * 6) * 0.3})`; g.lineWidth = 2; g.beginPath(); g.moveTo(-e.r, -6); g.lineTo(-4, 2); g.lineTo(-8, e.r * 0.7); g.stroke(); }
    g.restore();
    if (e.affix === 'drain' && this.player.alive) {
      g.strokeStyle = 'rgba(181,140,255,0.3)'; g.lineWidth = 2; g.setLineDash([4, 8]); g.lineDashOffset = t * 40;
      g.beginPath(); g.moveTo(e.x, e.y); g.quadraticCurveTo((e.x + this.player.x) / 2, e.y - 80, this.player.x, this.player.y); g.stroke(); g.setLineDash([]);
    }
    if (e.elite) {
      const w = 70, y = e.y - e.r - 34;
      g.fillStyle = 'rgba(14,11,40,0.75)'; g.fillRect(e.x - w / 2, y, w, 7);
      g.fillStyle = '#ff9d8c'; g.fillRect(e.x - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, 7);
      if (e.shield > 0) { g.fillStyle = '#cdefff'; g.fillRect(e.x - w / 2, y - 5, (w * e.shield) / e.shieldMax, 4); }
      if (e.affix) { g.font = '700 13px "Noto Sans SC", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffe38a'; g.fillText(AFFIXES[e.affix].name, e.x, y - 8); g.textAlign = 'start'; }
    }
  }
  drawShot(g, s) {
    const a = Math.atan2(s.vy, s.vx), t = this.t;
    if (s.trail.length > 3) {
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = s.kind === 'arrow' ? 'rgba(255,207,74,0.35)' : s.kind === 'shard' ? 'rgba(111,240,255,0.35)' : 'rgba(255,227,138,0.4)'; g.lineWidth = s.kind === 'noteBig' ? 6 : 3;
      g.beginPath(); for (let i = 0; i < s.trail.length; i += 2) g.lineTo(s.trail[i], s.trail[i + 1]); g.stroke();
      g.globalCompositeOperation = 'source-over';
    }
    if (s.kind === 'needle') BulletArt.draw(g, 'needleShot', s.x, s.y, a, 1);
    else if (s.kind === 'crescent') BulletArt.draw(g, 'crescent', s.x, s.y, a, 1.25);
    else if (s.kind === 'shard') BulletArt.draw(g, 'shard', s.x, s.y, a, 1);
    else if (s.kind === 'note' || s.kind === 'noteBig') BulletArt.draw(g, s.kind, s.x, s.y, Math.sin(t * 8) * 0.2, 1);
    else if (s.kind === 'echo') { g.globalAlpha = 0.8; BulletArt.draw(g, 'echo', s.x, s.y, 0, 1); g.globalAlpha = 1; }
    else if (s.kind === 'bellNote') {
      if (s.armed) {
        const u = 1 - s.fuse / 0.55;
        g.strokeStyle = `rgba(216,196,255,${0.4 + u * 0.5})`; g.lineWidth = 2; g.setLineDash([5, 5]); g.beginPath(); g.arc(s.x, s.y, 82 * (1 - u * 0.25), 0, TAU); g.stroke(); g.setLineDash([]);
      }
      BulletArt.draw(g, 'bellNote', s.x, s.y, Math.sin(t * 6) * 0.3, s.armed ? 1.2 + Math.sin(t * 30) * 0.1 : 1);
    } else if (s.kind === 'arrow') {
      g.save(); g.translate(s.x, s.y); g.rotate(a);
      g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 14, GLOW.gold, 0.6); g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#ffe38a'; g.strokeStyle = PAL.ink; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(10, 0); g.lineTo(0, -5); g.lineTo(-4, 0); g.lineTo(0, 5); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = '#ff9fcf'; g.lineWidth = 2; g.beginPath(); g.moveTo(-4, 0); g.quadraticCurveTo(-10, Math.sin(t * 20) * 4, -16, 0); g.stroke();
      g.restore();
    }
  }
  drawPlayerFx(g, layer) {
    const p = this.player, t = this.t;
    if (!p.alive) return;
    if (layer === 'under') {
      // danger circle for 金色星弹
      if (this.dangerNear) {
        const inside = this.hint === 'parry';
        g.strokeStyle = inside ? 'rgba(255,213,74,0.95)' : 'rgba(255,213,74,0.45)'; g.lineWidth = inside ? 3.5 : 2;
        g.setLineDash([10, 7]); g.lineDashOffset = -t * 60; g.beginPath(); g.arc(p.x, p.y, 92 + (inside ? Math.sin(t * 20) * 3 : 0), 0, TAU); g.stroke(); g.setLineDash([]);
      }
      if (p.shield) { g.strokeStyle = 'rgba(219,233,255,0.7)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y + 2, 30, 0, TAU); g.stroke(); }
      if (this.run.res >= 100 && !this.perf) {
        g.strokeStyle = `rgba(111,240,255,${0.5 + Math.sin(t * 5) * 0.2})`; g.lineWidth = 2;
        for (let i = 0; i < 6; i++) { const a = t * 1.5 + (i * TAU) / 6; g.beginPath(); g.arc(p.x, p.y, 38, a, a + 0.5); g.stroke(); }
      }
      if (this.perf && this.perf.id === 'melody') for (let i = 0; i < 3; i++) { const u = (t * 0.8 + i / 3) % 1; g.strokeStyle = `rgba(255,227,138,${0.6 * (1 - u)})`; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 30 + u * 70, 0, TAU); g.stroke(); }
    } else {
      const c = p.cut;
      if (c.state === 'wind') { g.strokeStyle = 'rgba(174,234,255,0.5)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 30, c.a - 0.6, c.a + 0.6); g.stroke(); }
      if (p.parry.on) {
        const u = p.parry.t / p.parry.win;
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = `rgba(255,213,74,${0.9 - u * 0.5})`; g.lineWidth = 4; g.beginPath(); g.arc(p.x, p.y, p.r + 26, 0, TAU); g.stroke();
        g.fillStyle = `rgba(255,213,74,${0.18 - u * 0.1})`; g.fill();
        g.globalCompositeOperation = 'source-over';
      }
    }
  }
  drawParticles(g) {
    const t = this.t;
    this.parts.each((q) => {
      const u = q.t / q.life, a = 1 - u;
      if (q.kind === 'dot' || q.kind === 'mote') { g.globalCompositeOperation = 'lighter'; drawGlow(g, q.x, q.y, q.size * 3, q.color, a); g.globalCompositeOperation = 'source-over'; }
      else if (q.kind === 'spark') { g.strokeStyle = q.color; g.globalAlpha = a; g.lineWidth = 2; g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04); g.stroke(); g.globalAlpha = 1; }
      else if (q.kind === 'ring') { g.strokeStyle = q.color; g.globalAlpha = a; g.lineWidth = 3 * a + 1; g.beginPath(); g.arc(q.x, q.y, q.size * Ease.outCubic(u), 0, TAU); g.stroke(); g.globalAlpha = 1; }
      else if (q.kind === 'petal') { g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.globalAlpha = a; g.fillStyle = q.color; g.beginPath(); g.ellipse(0, 0, q.size, q.size * 0.55, 0, 0, TAU); g.fill(); g.restore(); }
      else if (q.kind === 'shard') { g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.globalAlpha = a; g.fillStyle = q.color; g.beginPath(); g.moveTo(q.size, 0); g.lineTo(-q.size * 0.6, -q.size * 0.5); g.lineTo(-q.size * 0.4, q.size * 0.5); g.closePath(); g.fill(); g.restore(); }
      else if (q.kind === 'half') {
        g.save(); g.translate(q.x, q.y); g.rotate(q.rot + q.t * 6 * q.extra); g.globalAlpha = a;
        const col = u < 0.5 ? q.color : '#ffe38a';
        g.fillStyle = col; g.strokeStyle = '#1a5fb0'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -12 * q.extra); g.lineTo(8, 0); g.lineTo(-8, 0); g.closePath(); g.fill(); g.stroke(); g.restore();
      } else if (q.kind === 'note') { g.globalAlpha = a; g.fillStyle = q.color; g.font = `${q.size + 6}px serif`; g.fillText('♪', q.x, q.y); g.globalAlpha = 1; }
      else if (q.kind === 'heart') { g.globalAlpha = a; heartPath(g, q.x, q.y, q.size); g.fillStyle = q.color; g.fill(); g.globalAlpha = 1; }
      else if (q.kind === 'xmark') { g.globalAlpha = a; g.strokeStyle = q.color; g.lineWidth = 2.4; g.beginPath(); g.moveTo(q.x - 5, q.y - 5); g.lineTo(q.x + 5, q.y + 5); g.moveTo(q.x + 5, q.y - 5); g.lineTo(q.x - 5, q.y + 5); g.stroke(); g.globalAlpha = 1; }
      else if (q.kind === 'slash') {
        const R = q.size, A = this.weapon.cutA / 2, pr = this.player;
        g.save(); g.translate(pr.x, pr.y); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(0, 0, R * 0.4, 0, 0, R); gr.addColorStop(0, 'rgba(111,240,255,0)'); gr.addColorStop(0.75, `rgba(174,234,255,${0.55 * a})`); gr.addColorStop(1, `rgba(255,255,255,${0.9 * a})`);
        g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, q.rot - A * (0.4 + u * 0.6), q.rot + A * (0.4 + u * 0.6)); g.closePath(); g.fill();
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R, q.rot - A * (0.4 + u * 0.6), q.rot + A * (0.4 + u * 0.6)); g.stroke();
        g.restore();
      }
    });
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  drawTexts(g) {
    g.textAlign = 'center';
    const sorted = this.texts.slice().sort((a, b) => a.prio - b.prio);
    for (const tx of sorted) {
      const u = tx.t / tx.life, s = tx.size * (u < 0.15 ? 0.6 + u * 2.6 : 1);
      g.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      g.font = `400 ${s}px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif`;
      g.lineWidth = 4; g.strokeStyle = 'rgba(30,22,70,0.85)'; g.strokeText(tx.str, tx.x, tx.y);
      g.fillStyle = tx.color; g.fillText(tx.str, tx.x, tx.y);
    }
    g.globalAlpha = 1; g.textAlign = 'start';
  }
  drawOverlays(g, o) {
    const W = this.W, t = this.t, p = this.player, reduce = this.settings.reduceFlash;
    if (this.perf && this.perf.id === 'echo') {
      g.fillStyle = 'rgba(80,90,220,0.12)'; g.fillRect(0, 0, W, LH);
      g.strokeStyle = 'rgba(190,200,255,0.5)'; g.lineWidth = 3;
      for (const [cx, cy] of [[0, 0], [W, 0], [0, LH], [W, LH]]) {
        g.beginPath(); g.arc(cx, cy, 170, 0, TAU); g.stroke();
        for (let i = 0; i < 24; i++) { const a = t * 0.5 + (i * TAU) / 24; g.beginPath(); g.moveTo(cx + Math.cos(a) * 170, cy + Math.sin(a) * 170); g.lineTo(cx + Math.cos(a) * (i % 6 ? 160 : 150), cy + Math.sin(a) * (i % 6 ? 160 : 150)); g.stroke(); }
      }
    }
    if (this.perf && this.perf.id === 'still') { g.fillStyle = 'rgba(200,190,255,0.08)'; g.fillRect(0, 0, W, LH); }
    if (this.reverseT > 0) { g.fillStyle = 'rgba(255,243,200,0.07)'; g.fillRect(0, 0, W, LH); }
    // low HP: static coral edge (no continuous flashing)
    const low = p.hp / p.maxHp < 0.3 && p.alive && this.mode !== 'demo';
    const hf = Math.max(this.hurtFlash, low ? 0.45 : 0);
    if (hf > 0) {
      const gr = g.createRadialGradient(W / 2, LH / 2, LH * 0.45, W / 2, LH / 2, W * 0.7);
      gr.addColorStop(0, 'rgba(255,122,107,0)'); gr.addColorStop(1, `rgba(255,122,107,${0.42 * hf})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, LH);
    }
    if (this.flash > 0) { g.fillStyle = `rgba(255,250,235,${Math.min(reduce ? 0.12 : 0.5, this.flash * 0.6)})`; g.fillRect(0, 0, W, LH); }
    if (!o.simpleBg && !this.low) {
      g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.35;
      if (!this._pat) this._pat = g.createPattern(makePaper(), 'repeat');
      g.fillStyle = this._pat; g.fillRect(0, 0, W, LH);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    if (!this._vig || this._vigW !== W) {
      this._vigW = W; this._vig = makeCanvas(W, LH); const v = this._vig.getContext('2d');
      const gr = v.createRadialGradient(W / 2, LH / 2, LH * 0.35, W / 2, LH / 2, W * 0.72); gr.addColorStop(0, 'rgba(8,6,26,0)'); gr.addColorStop(1, 'rgba(8,6,26,0.55)');
      v.fillStyle = gr; v.fillRect(0, 0, W, LH);
    }
    g.drawImage(this._vig, 0, 0);
  }
}

function heartPath(g, x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.35);
  g.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9); g.closePath();
}
