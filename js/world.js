'use strict';
/* 梦潮：回声航线 v0.4 — 一局 = 连续飞行：战斗段 → 飞行中穿过分岔洞口 → 下一段 … → 失控闹钟。
   操作只有拖动飞机 + 一个爆发键；普通攻击、局内技能、联动全部自动。 */

const LH = 720, TOP = 64, BOTTOM = LH - 22;
const B_RADIUS = { pink: 7, blue: 6.5, gold: 8, white: 4 };
let _eid = 1;

/* 飞机基础 + 升星 + 星盘已点亮节点（+ 本局幸运路线的下一个节点） */
function planeStats(meta, planeId, lucky) {
  const P = PLANES[planeId], rec = (meta && meta.planes[planeId]) || { stars: 1 };
  const s = { dmg: 0, blast: 0, charge: 0, magnet: 0, repeat: 0, wing: 0, heart: 0, boss: 0 };
  if (rec.map) for (const r of ROUTE_ORDER) {
    const nodes = rec.map[r] || [], lit = rec.lit ? rec.lit[r] || 0 : 0;
    for (let i = 0; i < nodes.length; i++) if (i < lit || (lucky === r && i === lit)) s[nodes[i].type] += nodes[i].v;
  }
  return { dmgK: 1 + s.dmg / 100, blastK: 1 + s.blast / 100, chargeK: 1 + s.charge / 100, magnetK: 1 + s.magnet / 100, repeat: s.repeat / 100, wings: s.wing, hearts: P.hearts + s.heart, bossK: 1 + s.boss / 100, stars: rec.stars || 1, raw: s };
}

const ENEMY_HP = { jelly: 8, moth: 6, boat: 22, tick: 30, star: 18, beacon: 60, jellyE: 520, tickE: 600, starE: 480, mirror: 220, dummy: 1e9 };
const ENEMY_R = { jelly: 20, moth: 18, boat: 22, tick: 20, star: 20, beacon: 22, jellyE: 32, tickE: 30, starE: 28, mirror: 34, dummy: 20 };
const WING_SLOTS = [[-26, -40], [-26, 40], [-52, -74], [-52, 74], [-74, 0], [-86, -110], [-86, 110], [-104, -40], [-104, 40]];
const CLONE_SLOTS = [[30, -120], [30, 120], [-20, -175], [-20, 175], [70, 0], [-10, -70], [-10, 70]];

class World {
  constructor(o) {
    this.mode = o.mode || 'run';
    this.W = o.W || 1280; this.H = LH;
    this.settings = o.settings; this.cb = o.cb || {};
    this.planeId = o.plane || 'moon'; this.P = PLANES[this.planeId];
    this.stats = o.stats || planeStats(null, this.planeId);
    this.first = !!o.first; this.lucky = o.lucky || null;
    const cos = o.cos || {};
    const expC = COSMETICS.exp.find((c) => c.id === cos.exp);
    this.expColors = (expC && expC.colors) || this.P.colors.exp;
    const trC = COSMETICS.trail.find((c) => c.id === cos.trail) || COSMETICS.trail[0];
    this.trailColors = trC.colors;
    this.scene = o.scene || new SeaScene(); this.scene.speed = 90; this.scene.dir = 1;
    this.low = this.settings.particles === 'low';
    this.diff = { warnBonus: 0.1 }; // 大众向：Boss 预警统一多给 0.1 秒
    this.t = 0; this.runT = 0; this.state = 'play'; this.phase = 'fight';
    this.slowT = 0; this.timeScale = 1; this.hitstop = 0; this.trauma = 0; this.flash = 0; this.flashColor = '255,250,235'; this.hurtFlash = 0;
    this.timeStop = 0; this.reverseT = 0; this.gone = [];
    this.arena = { top: TOP, bottom: BOTTOM }; this.arenaTarget = { top: TOP, bottom: BOTTOM };
    this.bullets = new Pool(() => ({ on: false }), 420);
    this.shots = new Pool(() => ({ on: false }), 520);
    this.parts = new Pool(() => ({ on: false }), this.low ? 360 : 1100);
    this.enemies = []; this.pickups = []; this.portals = []; this.arcs = []; this.beams = []; this.rings = []; this.walls = [];
    this.warns = []; this.texts = []; this.events = []; this.timers = []; this.wingmen = [];
    this.dragDX = 0; this.dragDY = 0;
    const midY = (TOP + BOTTOM) / 2;
    this.player = { x: this.W * 0.24, y: midY, vx: 0, vy: 0, r: 6, hp: this.stats.hearts, maxHp: this.stats.hearts, inv: 0, hurtT: 0, burst: 0, tilt: 0, blink: 0, blinkT: 2, cloudShield: false, cloudCd: 0, fireT: 0.1, alt: 1, trail: [], trailT: 0, alive: true, candy: 0, moved: 0 };
    this.skills = []; this.syn = new Set(); this.stream = null; this.crystals = 0;
    this.streak = { n: 0, t: 0, best: 0, lastN: 0 }; this.recentKills = []; this.chainCd = 0; this.chainHiCd = 0;
    this.bursting = null; this.bfx = null; this.storm = null; this.cloudWall = null;
    this.seg = null; this.segIdx = 0; this.boss = null; this.bossProxy = null; this.bossIntroT = 0; this.bossEarly = false; this.carnival = false;
    this.crystalPlan = [8, 30, 52, 90, 140, 190]; this.planIdx = 0; this.pendingCrystal = 0; this.pendingRare = false; this.rarePlanned = false;
    this.m = { kills: 0, dust: 0, crystals: 0, syns: 0, bursts: 0, maxStreak: 0, elites: 0, highlights: 0, firstKill: null, firstSkill: null, firstSyn: null, firstBurst: null,
      killTimeSum: 0, killTimeN: 0, gapMax: 0, gapT: 0, talent: 0, chests: 0, frags: {}, candies: 0, lv5: 0, route: [], streak100: 0, hitsTaken: 0 };
    this.hintStep = this.first ? 0 : -1; this.hintShown = null;
    this.pickCd = { bolt: 0, mine: 0, zap: 0 };
    if (this.mode === 'preview') this.setupPreview();
    else this.startSegment('normal');
    this.syncWingmen();
  }
  emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }
  later(t, fn) { this.timers.push({ t, fn }); }
  lvOf(id) { const s = this.skills.find((k) => k.id === id); return s ? s.lv : 0; }
  hasSyn(a, b) { return this.syn.has(synKey(a, b)); }
  highlight() { this.m.highlights++; }

  /* ================================================== main step ================================================== */
  step(dt) {
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = smooth(this.timeScale, 0.3, 18, dt); } else this.timeScale = smooth(this.timeScale, 1, 8, dt);
    if (this.state === 'dying') this.timeScale = 0.35;
    const sdt = dt * this.timeScale;
    this.t += sdt;
    if (this.state === 'play' && this.mode === 'run') this.runT += sdt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.flash = Math.max(0, this.flash - dt * 2.2); this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    this.arena.top = approach(this.arena.top, this.arenaTarget.top, 60 * dt); this.arena.bottom = approach(this.arena.bottom, this.arenaTarget.bottom, 60 * dt);
    this.scene.dir = this.boss && this.boss.phase === 3 ? -1 : 1;
    this.scene.speed = this.bursting ? 30 : this.phase === 'portal' ? 150 : 90;
    this.scene.update(this.timeStop > 0 ? 0 : sdt);
    for (const tm of this.timers) { tm.t -= sdt; if (tm.t <= 0 && !tm.done) { tm.done = true; tm.fn(); } }
    this.timers = this.timers.filter((tm) => !tm.done);
    if (this.timeStop > 0) { this.timeStop -= sdt; if (this.timeStop <= 0) this.endTimeStop(); }
    if (this.reverseT > 0) this.reverseT -= sdt;

    this.updatePlayer(sdt);
    if (this.state === 'play') {
      this.updateSkills(sdt);
      this.updateWingmen(sdt);
      this.updateBurst(sdt);
      if (this.mode === 'run') this.updateDirector(sdt);
      else this.updatePreview(sdt);
      if (this.boss) { this.boss.update(sdt); if (this.bossProxy) { this.bossProxy.x = this.boss.x; this.bossProxy.y = this.boss.y; } }
      if (this.bossIntroT > 0) this.bossIntroT -= sdt;
    } else if (this.state === 'dying') {
      this.stateT -= dt; if (this.stateT <= 0 && !this.done) this.finish(false);
    } else if (this.state === 'victory') {
      this.stateT -= dt;
      if (Math.random() < 0.6) this.pickups.push({ kind: 'dust', x: rand(this.W * 0.2, this.W), y: -10, vx: rand(-40, 40), vy: rand(120, 260), t: 0, value: 3, big: true, rain: true, seed: 0 });
      if (this.stateT <= 0 && !this.done) this.finish(true);
    }
    this.updateEnemies(sdt);
    this.updateBullets(sdt);
    this.updateShots(sdt);
    this.updatePickups(sdt);
    this.updateWarns(sdt);
    this.updateFx(sdt);
    this.updateStreak(sdt);
    this.updateHints();
    if (this.mode === 'run' && (this.phase === 'fight' || this.phase === 'portal') && this.state === 'play') {
      const onScreen = this.enemies.some((e) => e.alive && !e.isBoss && e.x - e.r < this.W);
      if (!onScreen) this.m.gapT += sdt; else { this.m.gapMax = Math.max(this.m.gapMax, this.m.gapT); this.m.gapT = 0; }
    }
  }

  /* ================================================== player ================================================== */
  updatePlayer(dt) {
    const p = this.player, I = Input.out;
    p.inv = Math.max(0, p.inv - dt); p.hurtT = Math.max(0, p.hurtT - dt * 3); p.cloudCd = Math.max(0, p.cloudCd - dt); p.candy = Math.max(0, p.candy - dt);
    p.blinkT -= dt; if (p.blinkT <= 0) { p.blink = 1; p.blinkT = 2 + Math.random() * 3; } p.blink = Math.max(0, p.blink - dt * 8);
    if (!p.alive) return;
    let mx = 0, my = 0;
    if (this.mode === 'run' && this.state === 'play') { mx = I.mx; my = I.my; }
    if (this.mode === 'preview') my = clamp(((TOP + BOTTOM) / 2 + Math.sin(this.t * 1.2) * 60 - p.y) / 60, -1, 1);
    const spd = 400 * this.P.speed * (I.focus && this.mode === 'run' ? 0.5 : 1);
    const ox = p.x, oy = p.y;
    if (!(this.bfx && this.bfx.id === 'cloud')) { p.x += mx * spd * dt + this.dragDX; p.y += my * spd * dt + this.dragDY; }
    this.dragDX = 0; this.dragDY = 0;
    p.x = clamp(p.x, 34, this.W * 0.82); p.y = clamp(p.y, this.arena.top + 14, this.arena.bottom - 14);
    p.vx = (p.x - ox) / Math.max(dt, 1e-4); p.vy = (p.y - oy) / Math.max(dt, 1e-4);
    p.moved += Math.hypot(p.x - ox, p.y - oy);
    p.tilt = smooth(p.tilt, clamp(p.vy / 900, -0.35, 0.35), 12, dt);
    p.trailT -= dt; if (p.trailT <= 0) { p.trailT = 0.018; p.trail.push({ x: p.x - 26, y: p.y + 2, t: 0 }); if (p.trail.length > 28) p.trail.shift(); }
    for (const q of p.trail) { q.t += dt; q.x -= 180 * dt; }
    if (this.state !== 'play') return;
    if (this.mode === 'run' && Input.consume('burst')) this.tryBurst();
    p.fireT -= dt;
    const rate = this.P.rate * (p.candy > 0 ? 1.5 : 1) * (this.streak.n >= 30 ? 1.1 : 1);
    if (p.fireT <= 0) { p.fireT += 1 / rate; if (p.fireT < -0.1) p.fireT = 0; this.fireMain(); }
    if (p.inv <= 0 && !(this.bfx && this.bfx.id === 'cloud') && this.mode === 'run') {
      for (const e of this.enemies) {
        if (!e.alive || e.leaving) continue;
        const rr = (e.isBoss ? 110 : e.r) + 8;
        if (dist2(e.x, e.y, p.x, p.y) < rr * rr) { this.hurtPlayer(1); if (!e.elite && !e.isBoss && e.type !== 'mirror') this.killEnemy(e, { contact: true }); break; }
      }
    }
  }
  aimMain() {
    const p = this.player; let best = null, bd = 1e12;
    for (const e of this.enemies) {
      if (!e.alive || e.x < p.x + 20 || e.x > this.W + 10) continue;
      const a = angTo(p.x, p.y, e.x, e.y); if (Math.abs(a) > 1.0) continue;
      const d = dist2(p.x, p.y, e.x, e.y) * (e.isBoss ? 1.6 : 1); if (d < bd) { bd = d; best = a; }
    }
    this.aimA = smooth(this.aimA || 0, best === null ? 0 : best, 18, 1 / 60);
    return this.aimA;
  }
  fireMain() {
    const p = this.player, d = this.P.dmg * this.stats.dmgK, x = p.x + 24, y = p.y + 2, a = this.aimMain(), nx = -Math.sin(a), ny = Math.cos(a);
    switch (this.planeId) {
      case 'moon': for (const s of [-7, 7]) this.addShot('moon', x + nx * s, y + ny * s, a, 1150, { dmg: d, r: 8, from: 'main' }); break;
      case 'cloud': this.addShot('puff', x, y, a, 760, { dmg: d, r: 13, knock: 36, from: 'main' }); break;
      case 'candy': for (const o of [-0.13, 0, 0.13]) this.addShot('candyS', x, y, a + o, 980, { dmg: d, r: 7, from: 'main' }); break;
      case 'paper': this.addShot('dart', x, y, a, 1250, { dmg: d, r: 6, homing: 2.6, from: 'main' }); break;
      case 'whale': p.alt = -p.alt; this.addShot('bubble', x, y, a, 900, { dmg: d, r: 7, wave: p.alt, from: 'main' }); break;
      case 'clock': this.addShot('hand', x, y, a, 1300, { dmg: d, r: 6, pierce: 2, from: 'main' }); break;
    }
    if (Math.random() < 0.3) Sound.sfx('shoot', { gap: 120 });
  }
  hurtPlayer(n) {
    const p = this.player;
    if (!p.alive || p.inv > 0 || this.state !== 'play' || this.mode === 'preview') return;
    if (p.cloudShield) { p.cloudShield = false; p.inv = 0.8; Sound.sfx('shieldPop'); this.text('缓冲云挡住了', p.x, p.y - 40, '#dcefff', 16, 4); for (let i = 0; i < 10; i++) this.part('puff', p.x, p.y, rand(-160, 160), rand(-160, 160), 0.6, rand(8, 14), 'rgba(255,255,255,0.9)'); return; }
    p.hp -= n; p.inv = 1.4; p.hurtT = 1; this.m.hitsTaken++;
    this.hurtFlash = 1; this.shake(0.4); this.hitstop = 0.05; Sound.sfx('hurt');
    for (let i = 0; i < 12; i++) this.part('dot', p.x, p.y, rand(-220, 220), rand(-220, 220), 0.45, 3.5, 'rgba(255,122,107,0.95)');
    if (this.planeId === 'cloud' && p.cloudCd <= 0 && p.hp > 0) { p.cloudShield = true; p.cloudCd = 12; this.text('缓冲云层', p.x, p.y - 44, '#dcefff', 15, 3); }
    if (p.hp <= 0) { p.hp = 0; p.alive = false; this.state = 'dying'; this.stateT = 1.6; this.slowT = 1.4; Sound.sfx('lose'); this.clearBullets(false); }
  }

  /* ================================================== shots ================================================== */
  addShot(kind, x, y, a, spd, o = {}) {
    const s = this.shots.get(); if (!s) return null;
    s.on = true; s.kind = kind; s.x = x; s.y = y; s.vx = Math.cos(a) * spd; s.vy = Math.sin(a) * spd; s.t = 0;
    s.dmg = o.dmg || 8; s.r = o.r || 6; s.life = o.life || 1.6; s.pierce = o.pierce || 0; s.hits = []; s.homing = o.homing || 0;
    s.from = o.from || 'skill'; s.knock = o.knock || 0; s.wave = o.wave || 0; s.freeze = o.freeze || 0; s.gold = !!o.gold;
    s.hitCd = null; s.chain = o.chain || 0; s.y0 = y; s.ty = o.ty || 0;
    return s;
  }
  nearestEnemy(x, y, maxD = 1e9, exclude) {
    let best = null, bd = maxD * maxD;
    for (const e of this.enemies) {
      if (!e.alive || e.x > this.W + 20 || e.x < -20 || (exclude && exclude.has(e.id))) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  homingTarget(s) {
    // Boss 标记 + 大招：追踪弹优先锁定 Boss 核心；分身流对上镜像时分身先打镜像
    if (this.bossProxy && this.bossProxy.alive && this.boss && this.boss.x < this.W) {
      const mirror = s.from === 'wing' ? this.enemies.find((e) => e.alive && e.type === 'mirror') : null;
      return mirror || this.bossProxy;
    }
    return this.nearestEnemy(s.x, s.y);
  }
  updateShots(dt) {
    const W = this.W;
    this.shots.each((s) => {
      s.t += dt;
      if (s.kind === 'wheel') return this.updateWheel(s, dt);
      if (s.kind === 'wheelS') return this.updateWheelS(s, dt);
      if (s.kind === 'candyBomb') return this.updateCandyBomb(s, dt);
      if (s.homing && s.t > 0.08) {
        const tg = this.homingTarget(s);
        if (tg) { const a = Math.atan2(s.vy, s.vx), ta = angTo(s.x, s.y, tg.x, tg.y), na = a + clamp(angDiff(a, ta), -s.homing * dt, s.homing * dt), sp = Math.hypot(s.vx, s.vy); s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp; }
      }
      s.x += s.vx * dt;
      if (s.wave) { s.y0 += s.vy * dt; s.y = s.y0 + Math.sin(s.t * 14) * 16 * s.wave; } else s.y += s.vy * dt;
      if (s.t > s.life || s.x > W + 60 || s.x < -60 || s.y < -60 || s.y > LH + 60) { s.on = false; return; }
      for (const e of this.enemies) {
        if (!e.alive || s.hits.includes(e.id)) continue;
        const rr = (e.isBoss ? 112 : e.r) + s.r;
        if (dist2(e.x, e.y, s.x, s.y) > rr * rr) continue;
        s.hits.push(e.id);
        this.onShotHit(s, e);
        if (s.pierce-- <= 0) { s.on = false; return; }
      }
    });
  }
  onShotHit(s, e) {
    const hx = s.x, hy = s.y;
    if (s.kind === 'orb') { this.zap(s.x, s.y, e, s.chain, s.dmg); Sound.sfx('zap', { pan: this.pan(e.x), gap: 50 }); return; }
    this.damageEnemy(e, s.dmg, { x: hx, y: hy, src: s.from, kind: s.kind });
    if (s.knock && !e.isBoss && !e.elite && e.alive) e.x += s.knock;
    if (!e.alive || e.isBoss) { this.part('dot', hx, hy, rand(-90, 90), rand(-90, 90), 0.2, 2.5, 'rgba(255,243,176,0.95)'); return; }
    const bombLv = this.lvOf('bomb');
    if (bombLv && (s.from === 'main' || (s.from === 'wing' && this.hasSyn('wing', 'bomb'))) && Math.random() < 0.15 + bombLv * 0.08) e.mark = true;
    if (s.freeze && Math.random() < s.freeze) this.freezeEnemy(e, 1.2);
    this.part('dot', hx, hy, rand(-90, 90), rand(-90, 90), 0.2, 2.5, 'rgba(255,243,176,0.95)');
  }

  /* ================================================== enemies ================================================== */
  addEnemy(type, o = {}) {
    const elite = type.endsWith('E'), base = elite ? type.slice(0, -1) : type;
    const tier = this.seg ? this.seg.tier || 0 : 0;
    const hpK = elite || type === 'mirror' ? 1 + tier * 0.15 : 1 + tier * 0.05;
    const e = Object.assign({
      id: _eid++, type, base, elite, x: this.W + 40, y: (TOP + BOTTOM) / 2, vx: -150, vy: 0, r: ENEMY_R[type] || 20, hp: (ENEMY_HP[type] || 10) * hpK,
      t: 0, seed: rand(10), path: 'line', amp: 0, freq: 0, phase: 0, fireT: rand(1.5, 3.5), charge: 0, alive: true, hitFlash: 0, frozen: 0, stun: 0,
      mark: false, clockMark: false, seenT: null, fire: null, fodder: false, leaving: false, shots: 0, pull: null,
    }, o);
    e.maxHp = e.hp; e.y0 = e.y;
    if (this.seg && this.seg.explosive && !elite) e.explosive = true;
    this.enemies.push(e);
    return e;
  }
  spawnFormation(kind) {
    const W = this.W, tier = this.seg ? this.seg.tier : 0, top = this.arena.top + 50, bot = this.arena.bottom - 50;
    const y0 = rand(top, bot), sp = 1 + tier * 0.05;
    switch (kind) {
      case 'line': { const n = 5 + Math.min(3, tier); for (let i = 0; i < n; i++) this.addEnemy('jelly', { x: W + 10 + i * 56, y: y0, path: 'sine', vx: -150 * sp, amp: 18, freq: 2.2, phase: i * 0.5 }); break; }
      case 'vee': for (let i = 0; i < 7; i++) { const k = i - 3; this.addEnemy('moth', { x: W + 10 + Math.abs(k) * 42, y: clamp(y0 + k * 32, top, bot), path: 'line', vx: -200 * sp }); } break;
      case 'snake': for (let i = 0; i < 8; i++) this.addEnemy('moth', { x: W + 10 + i * 44, y: clamp(y0, top + 60, bot - 60), path: 'sine', vx: -170 * sp, amp: 80, freq: 1.7, phase: -i * 0.4 }); break;
      case 'wall': { const n = 6, gap = randi(1, 4); for (let i = 0; i < n; i++) if (i !== gap) this.addEnemy('jelly', { x: W + 10, y: lerp(top, bot, i / (n - 1)), path: 'line', vx: -125 * sp }); break; }
      case 'boats': for (let i = 0; i < 2 + (tier >= 3 ? 1 : 0); i++) this.addEnemy('boat', { x: W + 40 + i * 140, y: lerp(top, bot, (i + 0.5) / 3) + rand(-20, 20), path: 'line', vx: -95 * sp, fire: 'drop', fireT: rand(0.6, 1.4) }); break;
      case 'stars': for (let i = 0; i < 2; i++) this.addEnemy('star', { x: W + 40 + i * 90, y: clamp(y0 + (i ? 70 : -70), top, bot), path: 'dive', vx: -230 * sp, fire: 'aim' }); break;
      case 'ticks': for (let i = 0; i < 2 + (tier >= 4 ? 1 : 0); i++) this.addEnemy('tick', { x: W + 40, y: rand(top, bot), path: 'hover', tx: rand(W * 0.55, W * 0.86), ty: rand(top, bot), stay: 3.5, fire: 'ring', fireT: 1.2 }); break;
      case 'swarm': for (let i = 0; i < 12; i++) this.addEnemy('moth', { x: W + 10 + rand(0, 220), y: rand(top, bot), path: 'line', vx: -rand(160, 260) * sp }); break;
      case 'beacon': { const flip = Math.random() < 0.5; this.addEnemy('beacon', { x: rand(W * 0.55, W * 0.86), y: flip ? this.arena.top - 2 : this.arena.bottom - 30, flip, path: 'fixed', fire: 'laser', fireT: 1.4, life: 12 }); break; }
      case 'dustmoths': for (let i = 0; i < 6; i++) this.addEnemy('moth', { x: W - 10 + i * 50, y: clamp(y0 + Math.sin(i) * 40, top, bot), path: 'sine', vx: -210, amp: 40, freq: 2, phase: i * 0.6, fodder: true }); break;
    }
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy({ line: 'jelly', vee: 'moth', snake: 'moth', wall: 'jelly', boats: 'boat', stars: 'star', ticks: 'tick', swarm: 'moth', beacon: 'beacon', dustmoths: 'moth' }[kind]);
  }
  spawnElite() {
    const type = pick(['jellyE', 'tickE', 'starE']);
    this.addEnemy(type, { x: this.W + 60, y: (this.arena.top + this.arena.bottom) / 2, path: 'elite', tx: this.W * 0.74, fireT: 1.6, life: 26 });
    this.emit('elite', { type });
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy(type);
  }
  updateEnemies(dt) {
    const p = this.player, frozenWorld = this.timeStop > 0;
    for (const e of this.enemies) {
      if (!e.alive || e.isBoss) continue;
      e.t += dt; e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      if (e.seenT === null && e.x < this.W - 10) e.seenT = this.t;
      if (frozenWorld) continue;
      if (e.frozen > 0) e.frozen -= dt;
      if (e.stun > 0) { e.stun -= dt; continue; }
      if (e.pull) { const a = angTo(e.x, e.y, e.pull.x, e.pull.y); e.x += Math.cos(a) * e.pull.v * dt; e.y += Math.sin(a) * e.pull.v * dt; continue; }
      this.moveEnemy(e, dt * (e.frozen > 0 ? 0.3 : 1), p);
      if (e.frozen <= 0 && this.mode === 'run' && this.state === 'play' && !e.fodder) this.enemyFire(e, dt, p);
      if (e.life && e.t > e.life && !e.leaving) { e.leaving = true; e.vx = -320; if (e.path !== 'line') e.path = 'line'; }
      if (e.x < -80 || e.x > this.W + 400 || e.y < -120 || e.y > LH + 120) e.alive = false;
    }
    this.enemies = this.enemies.filter((e) => e.alive);
  }
  moveEnemy(e, dt, p) {
    switch (e.path) {
      case 'line': e.x += e.vx * dt; break;
      case 'sine': e.x += e.vx * dt; e.y = e.y0 + Math.sin((e.t + e.phase) * e.freq) * e.amp; break;
      case 'dive': e.x += e.vx * dt; e.y = smooth(e.y, p.y, 1.2, dt); break;
      case 'hover':
        if (!e.leaving) { e.x = smooth(e.x, e.tx, 2.4, dt); e.y = smooth(e.y, e.ty, 2.4, dt); if (e.t > e.stay + 1.5) { e.leaving = true; e.vx = -240; } }
        else e.x += e.vx * dt;
        break;
      case 'elite': e.x = smooth(e.x, e.tx, 1.6, dt); e.y = (this.arena.top + this.arena.bottom) / 2 + Math.sin(e.t * 0.9) * 110; break;
      case 'mirror': e.x = smooth(e.x, e.tx, 2, dt); e.y = e.ty + Math.sin(e.t * 1.4 + e.seed) * 50; break;
      case 'fixed': break;
      case 'dummy': e.y = e.y0 + Math.sin(e.t * 1.3 + e.seed) * 10; break;
    }
  }
  enemyFire(e, dt, p) {
    const tier = this.seg && this.seg.tier !== undefined ? this.seg.tier : 2, spd = 1 + tier * 0.05;
    e.fireT -= dt;
    const onScreen = e.x < this.W - 30 && e.x > 40;
    if (e.base === 'jelly' && !e.elite) {
      if (tier >= 1 && onScreen && e.fireT <= 0) { e.fireT = rand(3, 5.5); if (Math.random() < 0.45) this.fire('pink', e.x - 10, e.y, this.aimAngle(e.x, e.y), 165 * spd); }
      return;
    }
    if (e.fire === 'drop') { if (onScreen && e.fireT <= 0) { e.fireT = 1.5; const a = angTo(e.x, e.y, p.x, p.y); this.fire('pink', e.x - 14, e.y + 8, Math.PI + clamp(angDiff(Math.PI, a), -0.5, 0.5), 175 * spd); } return; }
    if (e.fire === 'aim') { if (onScreen && e.shots < 1 && e.x < this.W * 0.82) { e.shots++; this.fire('gold', e.x - 16, e.y, this.aimAngle(e.x, e.y), 230 * spd); } return; }
    if (e.fire === 'ring') {
      if (!e.leaving && Math.abs(e.x - e.tx) < 30) {
        e.charge = e.fireT < 0.6 ? 1 - e.fireT / 0.6 : 0;
        if (e.fireT <= 0) { e.fireT = 2.6; const n = 8 + Math.min(4, tier), gap = randi(0, n - 1), off = rand(TAU); for (let i = 0; i < n; i++) if (i !== gap && i !== (gap + 1) % n) this.fire('pink', e.x, e.y, off + (i / n) * TAU, 140 * spd, { silent: i > 0 }); }
      }
      return;
    }
    if (e.fire === 'laser') {
      e.aim = smooth(e.aim || Math.PI, angTo(e.x, e.y, p.x, p.y), 3, dt);
      e.charge = e.lock ? 1 : 0;
      if (e.fireT <= 0 && !e.lock) {
        e.lock = true; const ex = e.x, ey = e.y + (e.flip ? 10 : -10), a = angTo(ex, ey, p.x, p.y);
        this.addWarn({ kind: 'line', x: ex, y: ey, a, len: 1500, w: 3, tWarn: 1.0, onFire: (w) => { for (let i = 0; i < 5; i++) this.fire('white', w.x - Math.cos(w.a) * i * 26, w.y - Math.sin(w.a) * i * 26, w.a, 700, { silent: i > 0 }); e.lock = false; e.fireT = 3.4; } });
      }
      return;
    }
    if (e.elite && onScreen && e.fireT <= 0) {
      e.fireT = 2.8 / spd;
      if (e.base === 'jelly') { let k = 0; const burst = () => { if (!e.alive || k++ > 10 || this.state !== 'play') return; for (let i = 0; i < 3; i++) this.fire('pink', e.x, e.y, e.t * 2.2 + (i * TAU) / 3, 150 * spd, { silent: i > 0 }); this.later(0.11, burst); }; burst(); }
      else if (e.base === 'tick') { const n = 14, off = rand(TAU); for (let i = 0; i < n; i++) if (i % 7) this.fire('pink', e.x, e.y, off + (i / n) * TAU, 135 * spd, { silent: i > 0 }); for (let q = 0; q < 4; q++) for (let j = 0; j < 3; j++) this.fire('blue', e.x, e.y, (q * Math.PI) / 2 + Math.PI / 4 + e.t, (140 + j * 40) * spd, { silent: true }); }
      else { let k = 0; const vol = () => { if (!e.alive || k++ >= 3 || this.state !== 'play') return; this.fire('gold', e.x - 20, e.y, this.aimAngle(e.x, e.y), 225 * spd); this.later(0.45, vol); }; vol(); }
      return;
    }
    if (e.type === 'mirror' && e.fireT <= 0) { e.fireT = 2.4; const a0 = this.aimAngle(e.x, e.y); for (let i = 0; i < 5; i++) this.fire('pink', e.x, e.y, a0 + (i - 2) * 0.2, 170, { silent: i > 0 }); }
  }
  damageEnemy(e, dmg, o = {}) {
    if (!e.alive) return;
    if (e.isBoss) {
      if (!this.boss) return;
      let k = this.stats.bossK;
      if (this.boss.conductive && o.kind === 'zap') k *= 1.3;
      if (this.boss.marked && o.kind === 'explosion') k *= 1.5;
      this.boss.hit({ dmg: dmg * k, x: o.x !== undefined ? o.x : e.x, y: o.y !== undefined ? o.y : e.y, kind: o.kind || 'shot' });
      if (this.carnival && Math.random() < 0.02) this.dropPickup('candy', e.x - 60, e.y + rand(-80, 80));
      return;
    }
    e.hp -= dmg * (e.frozen > 0 ? 1.25 : 1); e.hitFlash = 1;
    if (e.hp <= 0) this.killEnemy(e, o);
  }
  killEnemy(e, o = {}) {
    if (!e.alive) return;
    e.alive = false;
    const p = this.player, small = !e.elite && e.type !== 'mirror';
    this.m.kills++;
    if (this.m.firstKill === null) this.m.firstKill = this.runT;
    if (small && e.seenT !== null && !e.fodder) { this.m.killTimeSum += this.t - e.seenT; this.m.killTimeN++; }
    this.streak.n++; this.streak.t = 2.5;
    this.addCharge(e.elite ? 0.15 : 0.0055);
    this.fx(e.x, e.y, e.elite ? 3 : 1, e.r);
    Sound.sfx(e.elite ? 'explode' : 'kill', { pan: this.pan(e.x), gap: 35, v: e.elite ? 1.4 : 1 });
    this.recentKills.push(this.t); while (this.recentKills.length && this.t - this.recentKills[0] > 0.4) this.recentKills.shift();
    if (this.recentKills.length >= 4 && this.chainCd <= 0) { this.chainCd = 0.5; this.fx(e.x, e.y, 2, 90); if (this.chainHiCd <= 0) { this.chainHiCd = 8; this.highlight(); } }
    if (e.elite) {
      this.m.elites++; this.highlight();
      for (let i = 0; i < 14; i++) this.dropPickup('dust', e.x + rand(-30, 30), e.y + rand(-30, 30), { value: 2, big: i < 4 });
      this.spawnCrystalDrop(e.x, e.y, { rare: this.seg && this.seg.type === 'rare' });
      this.shake(0.5);
    } else if (e.type === 'mirror') {
      for (let i = 0; i < 6; i++) this.dropPickup('dust', e.x, e.y, { value: 2 });
    } else {
      const n = e.fodder ? 3 : e.base === 'moth' ? 2 : Math.random() < 0.6 ? 1 : 0;
      for (let i = 0; i < n; i++) this.dropPickup('dust', e.x, e.y, { value: 1 });
      if (this.pendingCrystal > 0 && e.x < this.W - 60 && this.phase === 'fight') { this.pendingCrystal--; this.spawnCrystalDrop(e.x, e.y, { rare: this.pendingRare }); this.pendingRare = false; }
      if (this.planeId === 'candy' && Math.random() < 0.08) this.dropPickup('candy', e.x, e.y);
      if (o.src === 'beam' && this.lvOf('rainbow') >= 3 && Math.random() < 0.35) this.dropPickup('candy', e.x, e.y);
      if (Math.random() < 0.012 && p.hp < p.maxHp) this.dropPickup('heart', e.x, e.y);
      if (o.candify) this.dropPickup('candy', e.x, e.y);
    }
    const bombLv = this.lvOf('bomb');
    if ((e.mark && bombLv) || e.explosive) {
      const lv = Math.max(1, bombLv), rb = this.hasSyn('bomb', 'rainbow') ? 1.4 : 1, marked = e.mark && bombLv;
      const r = (marked ? 60 + 15 * lv : 50) * this.stats.blastK * rb, dmg = marked ? (18 + 8 * lv) * (lv >= 4 ? 1.5 : 1) : 10;
      this.later(0.05, () => this.explode(e.x, e.y, r, dmg, { level: lv >= 5 ? 3 : 2, chainMark: lv >= 3 && marked, fireworks: lv >= 5 || rb > 1 }));
    }
    const iceLv = this.lvOf('ice');
    if (e.frozen > 0 && iceLv >= 3) {
      const r = 70 * this.stats.blastK, dmg = (12 + 4 * iceLv) * (iceLv >= 4 ? 1.5 : 1);
      this.later(0.04, () => { this.shatter(e.x, e.y, r, dmg); if (this.hasSyn('bomb', 'ice')) this.explode(e.x, e.y, r * 0.9, dmg, { level: 2 }); });
      if (this.hasSyn('rainbow', 'ice') && Math.random() < 0.4) this.dropPickup('candy', e.x, e.y);
      if (this.hasSyn('magnet', 'ice')) for (let i = 0; i < 2; i++) this.dropPickup('dust', e.x, e.y, { value: 1 });
    }
    if (e.clockMark && !o.clock) this.later(0.02, () => this.explode(e.x, e.y, 60 * this.stats.blastK, 40, { level: 2 }));
    if (this.cb.onKill) this.cb.onKill(e.type);
  }
  freezeEnemy(e, s) { if (e.isBoss || !e.alive) return; if (e.frozen <= 0) Sound.sfx('freeze', { pan: this.pan(e.x), gap: 60 }); e.frozen = Math.max(e.frozen, s); }

  /* ================================================== enemy bullets ================================================== */
  fire(type, x, y, ang, spd, o = {}) {
    if (this.mode === 'preview') return null;
    const b = this.bullets.get(); if (!b) return null;
    b.on = true; b.type = type; b.x = x; b.y = y; b.vx = Math.cos(ang) * spd; b.vy = Math.sin(ang) * spd;
    b.r = B_RADIUS[type] || 7; b.t = 0; b.life = o.life || 12; b.rot = ang; b.spin = type === 'blue' ? rand(-3, 3) : 0; b.ghost = o.ghost || 0;
    b.src = o.noRepeat ? null : { x, y, a: ang, s: spd, type }; b.pull = null;
    if (!o.silent) Sound.sfx({ pink: 'spawnPink', blue: 'spawnBlue', gold: 'spawnGold', white: 'laser' }[type], { pan: this.pan(x), gap: 110 });
    return b;
  }
  aimAngle(x, y) { return angTo(x, y, this.player.x, this.player.y); }
  dens(type, n) { return n; }
  clearBullets(toDust = true) {
    this.bullets.each((b) => { if (toDust && Math.random() < 0.5) this.part('mote', b.x, b.y, rand(-30, 30), rand(-60, -10), 0.6, 2.5, 'rgba(201,168,255,0.9)'); b.on = false; });
    this.warns = this.warns.filter((w) => w.keep);
  }
  clearEnemyBullets(toDust) { this.clearBullets(toDust); }
  recordGone(b) { if (!b.src || !this.boss || this.boss.phase !== 3) return; this.gone.push(b.src); if (this.gone.length > 36) this.gone.shift(); }
  updateBullets(dt) {
    const p = this.player, W = this.W, stop = this.timeStop > 0, rev = this.reverseT > 0 ? -1 : 1, wall = this.cloudWall;
    this.bullets.each((b) => {
      if (b.ghost > 0) { b.ghost -= dt; return; }
      if (b.pull) { const a = angTo(b.x, b.y, b.pull.x, b.pull.y); b.x += Math.cos(a) * 700 * dt; b.y += Math.sin(a) * 700 * dt; if (dist2(b.x, b.y, b.pull.x, b.pull.y) < 40 * 40) b.on = false; return; }
      if (stop) return;
      b.t += dt; b.x += b.vx * dt * rev; b.y += b.vy * dt * rev;
      b.rot = b.type === 'white' ? Math.atan2(b.vy, b.vx) : b.rot + b.spin * dt;
      if (b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > LH + 60 || b.t > b.life) { this.recordGone(b); b.on = false; return; }
      if (wall && Math.abs(b.x - wall.x) < 22 && Math.abs(b.y - wall.y) < 150) { b.on = false; this.part('puff', b.x, b.y, rand(-40, 40), rand(-40, 40), 0.4, 8, 'rgba(255,255,255,0.8)'); return; }
      if (!p.alive || this.state !== 'play') return;
      if (dist2(b.x, b.y, p.x, p.y) < (p.r + b.r) * (p.r + b.r) && p.inv <= 0 && !(this.bfx && this.bfx.id === 'cloud')) { b.on = false; this.hurtPlayer(1); }
    });
    if (wall) { wall.t -= dt; if (wall.t <= 0) this.cloudWall = null; }
  }

  /* ================================================== warnings (预警线 / 区域) ================================================== */
  addWarn(w) { w.t = 0; w.fired = false; this.warns.push(w); if (!w.silent) Sound.sfx('warn', { pan: this.pan(w.x || this.W / 2), gap: 120 }); return w; }
  updateWarns(dt) {
    const p = this.player;
    if (this.timeStop > 0) return;
    for (const w of this.warns) {
      w.t += dt;
      if (w.follow) { w.x = w.follow.x; w.y = w.follow.y; }
      if (!w.fired && w.t >= w.tWarn) { w.fired = true; if (w.onFire) w.onFire(w); w.beamT = w.beam || 0; }
      if (w.fired && w.beamT > 0) {
        w.beamT -= dt;
        const ex = w.x + Math.cos(w.a) * w.len, ey = w.y + Math.sin(w.a) * w.len;
        if (this.state === 'play' && p.alive && p.inv <= 0 && segDist2(p.x, p.y, w.x, w.y, ex, ey) < (w.w / 2 + p.r) * (w.w / 2 + p.r)) this.hurtPlayer(1);
      }
    }
    this.warns = this.warns.filter((w) => !w.fired || w.beamT > 0 || (w.post && w.t < w.tWarn + w.post));
  }

  /* ================================================== skills ================================================== */
  gainSkill(id, n) {
    // 晶体掉落时选的技能可能在拾取前已经满级：改投给别的技能；全部满级就转成大招充能
    if (id === 'gold' || this.lvOf(id) >= 5) {
      const alt = this.pickCrystalSkill();
      if (alt === 'gold') { this.addCharge(0.25); this.m.dust += 20; this.emit('flag', { text: '技能全部满级 · 大招充能 +25%' }); Sound.sfx('levelup'); return; }
      id = alt;
    }
    let s = this.skills.find((k) => k.id === id);
    if (!s) {
      if (this.skills.length >= 3) { s = this.skills.slice().sort((a, b) => a.lv - b.lv)[0]; id = s.id; }
      else { s = { id, lv: 0, t: 0.4, t2: 3 }; this.skills.push(s); }
    }
    const before = s.lv; s.lv = Math.min(5, s.lv + n);
    this.crystals++; this.m.crystals++;
    if (this.m.firstSkill === null) this.m.firstSkill = this.runT;
    const S = SKILLS[id];
    this.emit('skill', { id, lv: s.lv, isNew: before === 0, text: S.lv[s.lv - 1] });
    Sound.sfx(before === 0 ? 'crystal' : 'levelup');
    this.fx(this.player.x, this.player.y, 2, 70, [S.color, '#ffffff', '#ffe38a']);
    if (s.lv === 5 && before < 5) { this.m.lv5++; this.highlight(); this.emit('lv5', { id }); this.shake(0.3); }
    if (this.cb.onSkill) this.cb.onSkill(id);
    this.syncWingmen();
    for (const o2 of this.skills) {
      if (o2.id === id) continue;
      const key = synKey(id, o2.id);
      if (!this.syn.has(key) && s.lv + o2.lv >= 3) this.triggerSynergy(key);
    }
    if (!this.stream && this.crystals >= 6) {
      const dom = this.skills.slice().sort((a, b) => b.lv - a.lv)[0];
      this.stream = { id: dom.id, name: SKILLS[dom.id].stream };
      this.highlight(); this.emit('stream', { id: dom.id, name: this.stream.name });
      Sound.sfx('stream'); this.flash = Math.max(this.flash, 0.3); this.flashColor = '255,243,200';
      this.fx(this.player.x, this.player.y, 3, 220, [SKILLS[dom.id].color, '#ffffff', '#ffe38a']);
    }
    Sound.setCardMods(this.skills.map((k) => ({ thunder: 'echo', wing: 'mirror', magnet: 'gentle', ice: 'tide', rainbow: 'paperboat', bomb: 'overheat' }[k.id])));
  }
  triggerSynergy(key) {
    this.syn.add(key); this.m.syns++;
    if (this.m.firstSyn === null) this.m.firstSyn = this.runT;
    this.highlight();
    const [a, b] = key.split('+');
    this.emit('synergy', { key, name: SYNERGIES[key].name, desc: SYNERGIES[key].desc });
    Sound.sfx('synergy'); this.shake(0.28);
    this.fx(this.player.x, this.player.y, 3, 200, [SKILLS[a].color, SKILLS[b].color, '#ffffff']);
    if (this.cb.onSynergy) this.cb.onSynergy(key);
  }
  updateSkills(dt) {
    const p = this.player, rp = this.stats.repeat;
    const again = (fn) => { fn(); if (rp > 0 && Math.random() < rp) this.later(0.18, fn); };
    for (const s of this.skills) {
      s.t -= dt;
      if (s.id === 'thunder') {
        if (s.t <= 0) {
          s.t = 1.35 - 0.08 * s.lv;
          const chain = [2, 3, 3, 5, 5][s.lv - 1] + (this.hasSyn('thunder', 'ice') ? 2 : 0), lv = s.lv;
          again(() => { for (let i = 0; i < (lv >= 2 ? 2 : 1); i++) this.addShot('orb', p.x + 10, p.y - 8 + i * 16, rand(-0.6, 0.6), 620, { dmg: (16 + 6 * lv) * (lv >= 4 ? 1.3 : 1), r: 10, homing: 6, life: 2, chain }); });
        }
        if (s.lv >= 5) {
          if (!this.storm) this.storm = { a: 0, t: 0 };
          this.storm.a += dt * 2.4; this.storm.t -= dt;
          if (this.storm.t <= 0) {
            this.storm.t = 0.35;
            const sx = p.x + Math.cos(this.storm.a) * 70, sy = p.y + Math.sin(this.storm.a) * 70, hit = new Set();
            for (let i = 0; i < 3; i++) { const e = this.nearestEnemy(sx, sy, 380, hit); if (!e) break; hit.add(e.id); this.arc(sx, sy, e.x, e.y, '#bfe9ff'); this.damageEnemy(e, 22, { kind: 'zap', x: e.x, y: e.y }); if (!e.isBoss && e.alive) e.stun = 0.6; }
          }
        }
      } else if (s.id === 'rainbow') {
        if (s.t <= 0) {
          s.t = [4.2, 3.5, 3.2, 2.8, 1.6][s.lv - 1];
          const lv = s.lv;
          again(() => {
            const dir = (s.flip = !s.flip) ? 1 : -1, dmg = (3 + 1.2 * lv) * (lv >= 4 ? 1.5 : 1);
            this.addBeam({ owner: 'player', a0: -0.6 * dir, a1: 0.6 * dir, dur: 0.8, len: 980, w: 16 + 4 * lv, dmg });
            if (lv >= 5) this.addBeam({ owner: 'player', a0: 0.6 * dir, a1: -0.6 * dir, dur: 0.8, len: 980, w: 16 + 4 * lv, dmg });
          });
          Sound.sfx('beam', { gap: 300 });
        }
      } else if (s.id === 'ice') {
        if (s.t <= 0) {
          s.t = 1.05 - 0.05 * s.lv;
          const n = 2 + s.lv, fr = s.lv >= 3 ? 1 : 0.5, lv = s.lv;
          again(() => { for (let i = 0; i < n; i++) this.addShot('ice', p.x + 16, p.y, (i / (n - 1) - 0.5) * 0.6, 900, { dmg: 6 + 2 * lv, r: 7, freeze: fr, life: 1.2 }); });
        }
        if (s.lv >= 5) {
          s.t2 -= dt;
          if (s.t2 <= 0) {
            s.t2 = 4; const R = 260 * this.stats.blastK;
            for (const e of this.enemies) if (e.alive && !e.isBoss && dist2(e.x, e.y, p.x, p.y) < R * R) this.freezeEnemy(e, 1.6);
            this.ring(p.x, p.y, 0, R, 0.5, 0, 'rgba(191,244,255,0.9)');
            for (let i = 0; i < (this.low ? 10 : 26); i++) this.part('snow', p.x + rand(-R, R), p.y + rand(-R, R), rand(-40, 40), rand(20, 80), 1, rand(3, 6), '#e8fbff');
            Sound.sfx('freeze');
          }
        }
      } else if (s.id === 'magnet') {
        if (s.lv >= 3) { s.t2 -= dt; if (s.t2 <= 0) { s.t2 = 6; this.magnetPulse(); } }
        if (s.lv >= 5 && s.t <= 0) { s.t = 8; this.walls.push({ x: p.x + 30, vx: 900, dmg: 35 * this.stats.dmgK, hit: new Set() }); Sound.sfx('nova'); }
        else if (s.lv < 5) s.t = Math.max(s.t, 0);
      }
    }
    for (const w of this.walls) {
      w.x += w.vx * dt;
      for (const e of this.enemies) if (e.alive && !w.hit.has(e.id) && Math.abs(e.x - w.x) < (e.isBoss ? 120 : 30)) { w.hit.add(e.id); this.damageEnemy(e, w.dmg, { kind: 'wave', x: w.x, y: e.y }); }
    }
    this.walls = this.walls.filter((w) => w.x < this.W + 80);
  }
  magnetPulse() {
    const p = this.player;
    for (const k of this.pickups) if (k.kind !== 'crystal') k.attract = true;
    this.ring(p.x, p.y, 600, 0, 0.5, 0, 'rgba(201,168,255,0.8)');
    Sound.sfx('nova', { gap: 300 });
  }
  addBeam(o) { this.beams.push(Object.assign({ t: 0, tick: 0 }, o)); }
  beamOrigin(b) { if (b.owner === 'player') return { x: this.player.x + 20, y: this.player.y }; return { x: b.owner.x + 10, y: b.owner.y }; }
  updateBeams(dt) {
    for (const b of this.beams) {
      b.t += dt; b.tick -= dt;
      const a = lerp(b.a0, b.a1, Ease.inOutSine(clamp(b.t / b.dur, 0, 1))); b.a = a;
      if (b.tick <= 0 && this.state === 'play') {
        b.tick = 0.06;
        const o = this.beamOrigin(b), ex = o.x + Math.cos(a) * b.len, ey = o.y + Math.sin(a) * b.len;
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const rr = (e.isBoss ? 100 : e.r) + b.w / 2;
          if (segDist2(e.x, e.y, o.x, o.y, ex, ey) < rr * rr) {
            this.damageEnemy(e, b.dmg, { src: 'beam', kind: 'beam', x: e.x, y: e.y });
            if (this.hasSyn('thunder', 'rainbow') && e.alive && Math.random() < 0.08) this.zap(e.x, e.y, e, 2, 14);
          }
        }
        if (this.hasSyn('magnet', 'rainbow')) for (const k of this.pickups) if (k.kind !== 'crystal' && segDist2(k.x, k.y, o.x, o.y, ex, ey) < 60 * 60) k.attract = true;
      }
    }
    this.beams = this.beams.filter((b) => b.t < b.dur);
  }
  zap(fx, fy, target, chain, dmg) {
    const visited = new Set(); let from = { x: fx, y: fy }, e = target, n = chain + 1 + (this.boss && this.boss.conductive ? 2 : 0);
    while (e && n-- > 0) {
      visited.add(e.id);
      this.arc(from.x, from.y, e.x, e.y, '#bfe9ff');
      this.damageEnemy(e, dmg * (e.frozen > 0 && this.hasSyn('thunder', 'ice') ? 2 : 1), { kind: 'zap', x: e.x, y: e.y });
      if (this.lvOf('thunder') >= 3 && !e.isBoss && e.alive) e.stun = 0.6;
      if (this.hasSyn('thunder', 'bomb') && !e.isBoss && e.alive) e.mark = true;
      from = { x: e.x, y: e.y }; e = this.nearestEnemy(from.x, from.y, 180, visited);
    }
  }
  arc(x1, y1, x2, y2, color) {
    const pts = [x1, y1], n = 6;
    for (let i = 1; i < n; i++) { const u = i / n; pts.push(lerp(x1, x2, u) + rand(-12, 12), lerp(y1, y2, u) + rand(-12, 12)); }
    pts.push(x2, y2);
    if (this.arcs.length < 60) this.arcs.push({ pts, t: 0, life: 0.18, color });
  }
  explode(x, y, r, dmg, o = {}) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const rr = r + (e.isBoss ? 100 : e.r);
      if (dist2(e.x, e.y, x, y) < rr * rr) {
        if (o.chainMark && !e.isBoss) e.mark = true;
        this.damageEnemy(e, dmg, { kind: 'explosion', x, y });
        if (e.isBoss && this.boss && this.boss.marked) this.boss.openFromExplosion();
      }
    }
    this.fx(x, y, o.level || 2, r, o.fireworks ? ['#ff9fcf', '#ffe38a', '#9fe3f0', '#c9a8ff'] : null);
    Sound.sfx('explode', { pan: this.pan(x), gap: 45, v: r > 90 ? 1.4 : 1 });
  }
  shatter(x, y, r, dmg) {
    for (const e of this.enemies) if (e.alive && !e.isBoss && dist2(e.x, e.y, x, y) < (r + e.r) * (r + e.r)) this.damageEnemy(e, dmg, { kind: 'shatter', x, y });
    for (let i = 0; i < (this.low ? 5 : 10); i++) this.part('shard', x, y, rand(-260, 260), rand(-260, 260), 0.6, rand(4, 8), pick(['#e8fbff', '#bff4ff', '#8fd3ff']));
    Sound.sfx('shatter', { pan: this.pan(x), gap: 50 });
  }
  ring(x, y, r0, r1, dur, dmg, color, o = {}) { this.rings.push({ x, y, r0, r1, dur, dmg, color, t: 0, r: r0, hit: new Set(), clear: !!o.clear }); }
  updateRings(dt) {
    for (const g of this.rings) {
      g.t += dt; g.r = lerp(g.r0, g.r1, Ease.outCubic(clamp(g.t / g.dur, 0, 1)));
      if (g.dmg > 0) for (const e of this.enemies) if (e.alive && !g.hit.has(e.id) && dist2(e.x, e.y, g.x, g.y) < (g.r + (e.isBoss ? 100 : e.r)) ** 2) { g.hit.add(e.id); this.damageEnemy(e, g.dmg, { kind: 'ring', x: e.x, y: e.y }); }
      if (g.clear) this.bullets.each((b) => { if (dist2(b.x, b.y, g.x, g.y) < g.r * g.r) { b.on = false; this.part('mote', b.x, b.y, 0, -30, 0.4, 2.5, 'rgba(255,243,200,0.9)'); } });
    }
    this.rings = this.rings.filter((g) => g.t < g.dur);
  }

  /* ================================================== wingmen (分身) ================================================== */
  wingCount() { return this.stats.wings + [0, 1, 2, 2, 3, 3][this.lvOf('wing')]; }
  syncWingmen() {
    const want = this.wingCount(), perm = this.wingmen.filter((w) => !w.temp);
    while (perm.length < want) { const w = { x: this.player.x, y: this.player.y, fireT: rand(0.2), temp: 0, orbT: rand(2), beamT: rand(3) }; perm.push(w); this.wingmen.push(w); }
    while (perm.length > want) { const w = perm.pop(); this.wingmen.splice(this.wingmen.indexOf(w), 1); }
  }
  addClone(t, burst) {
    if (!burst) {
      const temps = this.wingmen.filter((w) => w.temp && !w.burst);
      if (temps.length >= 3) { temps[0].temp = t; return; }
    }
    this.wingmen.push({ x: this.player.x, y: this.player.y, fireT: rand(0.1), temp: t, burst: !!burst, orbT: 1, beamT: 2 });
  }
  updateWingmen(dt) {
    const p = this.player, wl = this.lvOf('wing');
    let pi = 0, ci = 0;
    for (const w of this.wingmen) {
      if (w.temp) { w.temp -= dt; if (w.temp <= 0) { w.dead = true; this.part('shard', w.x, w.y, rand(-100, 100), rand(-100, 100), 0.5, 6, '#fff4dc'); continue; } }
      const slot = w.burst ? CLONE_SLOTS[ci++ % CLONE_SLOTS.length] : WING_SLOTS[pi++ % WING_SLOTS.length];
      w.x = smooth(w.x, p.x + slot[0], 8, dt); w.y = smooth(w.y, clamp(p.y + slot[1], this.arena.top + 10, this.arena.bottom - 10), 8, dt);
      w.fireT -= dt;
      if (w.fireT <= 0) {
        w.fireT = w.burst ? 0.12 : wl >= 4 ? 0.18 : 0.25;
        const gold = wl >= 5 && !w.temp, dmg = (gold ? 8 : 6) * this.stats.dmgK, home = wl >= 3 || w.temp ? 4 : 0;
        const fz = this.hasSyn('wing', 'ice') ? 0.4 : 0;
        for (const a of gold ? [-0.1, 0, 0.1] : [0]) this.addShot('wingDart', w.x + 10, w.y, a, 1150, { dmg, r: gold ? 7 : 5, homing: home, pierce: wl >= 3 ? 1 : 0, from: 'wing', freeze: fz, gold });
      }
      if (this.hasSyn('thunder', 'wing')) { w.orbT -= dt; if (w.orbT <= 0) { w.orbT = 2; this.addShot('orb', w.x, w.y, 0, 600, { dmg: 16, r: 9, homing: 6, life: 2, chain: 2 }); } }
      if (this.hasSyn('wing', 'rainbow')) { w.beamT -= dt; if (w.beamT <= 0) { w.beamT = 3; this.addBeam({ owner: w, a0: -0.3, a1: 0.3, dur: 0.5, len: 600, w: 8, dmg: 2.5 }); } }
      if (this.hasSyn('wing', 'magnet')) for (const k of this.pickups) if (k.kind === 'dust' && dist2(k.x, k.y, w.x, w.y) < 90 * 90) k.attract = true;
    }
    this.wingmen = this.wingmen.filter((w) => !w.dead);
  }

  /* ================================================== burst (专属大招) ================================================== */
  addCharge(v) {
    if (this.bursting || this.mode === 'preview') return;
    const p = this.player, before = p.burst; p.burst = Math.min(1, p.burst + v * this.stats.chargeK);
    if (before < 1 && p.burst >= 1) { this.emit('burstReady'); Sound.sfx('resFull'); }
  }
  tryBurst() {
    const p = this.player;
    if (this.bursting || this.state !== 'play') return;
    if (p.burst < 1) { Sound.sfx('denied', { gap: 250 }); return; }
    this.startBurst();
  }
  startBurst() {
    this.player.burst = 0; this.bursting = { stage: 'cut', t: 0 }; this.slowT = 0.5;
    if (this.mode === 'run') { this.m.bursts++; if (this.m.firstBurst === null) this.m.firstBurst = this.runT; this.highlight(); if (this.cb.onBurst) this.cb.onBurst(); }
    Sound.sfx('burstCut'); this.emit('burst', { plane: this.planeId });
  }
  updateBurst(dt) {
    const B = this.bursting;
    if (!B) return;
    B.t += dt;
    if (B.stage === 'cut' && B.t >= 0.5) { B.stage = 'active'; B.t = 0; this.executeBurst(); }
    else if (B.stage === 'active' && this.updateBfx(dt)) { this.bursting = null; this.bfx = null; this.gatherRewards(); }
  }
  executeBurst() {
    const p = this.player, st = this.stats.stars, big = st >= 2 ? 1.22 : 1, dK = this.stats.dmgK * (st >= 5 ? 1.2 : 1);
    Sound.sfx('b_' + this.planeId); this.shake(0.6); this.flash = Math.max(this.flash, this.settings.reduceFlash ? 0.2 : 0.55); this.flashColor = '255,250,235';
    this.fx(p.x, p.y, 4, 500);
    if (st >= 5) for (let i = 0; i < 60; i++) this.part('confetti', p.x, p.y, rand(-700, 700), rand(-700, 300), 1.6, rand(5, 9), pick(['#ffd76a', '#fff6c8', '#ffb347']));
    switch (this.planeId) {
      case 'moon': this.addShot('wheel', p.x + 50, p.y, 0, 760, { dmg: 140 * dK, r: 70 * big, life: 4, pierce: 9999 }); this.bfx = { id: 'moon', t: 0 }; break;
      case 'cloud': this.bfx = { id: 'cloud', t: 0, dur: 1.6, x0: p.x, y: p.y, R: 130 * big, tick: 0, dK }; break;
      case 'candy': this.bfx = { id: 'candy', t: 0, dur: st >= 3 ? 4.5 : 3, spawn: 0, dK }; break;
      case 'paper': for (let i = 0; i < (st >= 3 ? 7 : 5); i++) this.addClone(6, true); this.bfx = { id: 'paper', t: 0 }; break;
      case 'whale': { const n = this.enemies.filter((e) => e.alive && e.x < this.W).length; this.bfx = { id: 'whale', t: 0, stage: 'inhale', h: clamp(170 + n * 7, 170, 470) * big, dK, tick: 0, second: st >= 3 }; break; }
      case 'clock': {
        const dur = st >= 3 ? 3 : 2;
        this.timeStop = dur; this.bfx = { id: 'clock', t: 0, dur, dK };
        for (const e of this.enemies) if (e.alive && !e.isBoss) e.clockMark = true;
        if (this.boss) this.boss.freezeHands(dur + 1.2);
        break;
      }
    }
    for (const s of this.skills) {
      const lv = s.lv;
      if (s.id === 'thunder') this.later(0.6, () => { const hit = new Set(); for (let i = 0; i < 4 + 2 * lv; i++) { const e = this.nearestEnemy(rand(this.W * 0.3, this.W), rand(TOP, BOTTOM), 2000, hit); if (!e) break; hit.add(e.id); this.arc(e.x + rand(-30, 30), -20, e.x, e.y, '#dff4ff'); this.damageEnemy(e, 40 + 10 * lv, { kind: 'zap', x: e.x, y: e.y }); } Sound.sfx('zap'); });
      if (s.id === 'wing') for (const w of this.wingmen) for (let i = 0; i < 5; i++) this.addShot('wingDart', w.x, w.y, (i - 2) * 0.15, 1100, { dmg: 10, r: 6, homing: 4, from: 'wing' });
      if (s.id === 'bomb') for (const e of this.enemies) if (e.alive && !e.isBoss) e.mark = true;
      if (s.id === 'magnet') this.magnetPulse();
      if (s.id === 'rainbow') this.ring(p.x, p.y, 0, 650, 0.7, 50 + 10 * lv, 'rgba(255,159,207,0.9)');
      if (s.id === 'ice') for (const e of this.enemies) if (e.alive && !e.isBoss) this.freezeEnemy(e, 1.5);
    }
    if (this.hintStep >= 0) this.hintStep = 9;
  }
  updateBfx(dt) {
    const F = this.bfx, p = this.player; if (!F) return true;
    F.t += dt;
    switch (F.id) {
      case 'moon': { let any = false; this.shots.each((s) => { if (s.kind === 'wheel' || s.kind === 'wheelS') any = true; }); return !any || F.t > 5; }
      case 'cloud': {
        const u = F.t / F.dur, fwd = u < 0.5 ? Ease.inOutSine(u * 2) : Ease.inOutSine((1 - u) * 2);
        p.x = lerp(F.x0, this.W - 150, fwd); p.inv = Math.max(p.inv, 0.3);
        F.tick -= dt;
        if (F.tick <= 0) { F.tick = 0.15; for (const e of this.enemies) if (e.alive && dist2(e.x, e.y, p.x, p.y) < (F.R + (e.isBoss ? 100 : e.r)) ** 2) this.damageEnemy(e, 70 * F.dK, { kind: 'burst', x: p.x + 60, y: p.y }); }
        this.bullets.each((b) => { if (dist2(b.x, b.y, p.x, p.y) < F.R * F.R) b.on = false; });
        if (Math.random() < 0.8) this.part('puff', p.x + rand(-F.R, F.R) * 0.7, p.y + rand(-F.R, F.R) * 0.7, rand(-120, 60), rand(-60, 60), 0.7, rand(14, 26), 'rgba(255,255,255,0.85)');
        if (F.t >= F.dur) { if (this.stats.stars >= 3) this.cloudWall = { x: p.x + 70, y: p.y, t: 4 }; return true; }
        return false;
      }
      case 'candy': {
        F.spawn -= dt;
        if (F.spawn <= 0 && F.t < F.dur) { F.spawn = 0.05; this.addShot('candyBomb', rand(this.W * 0.3, this.W - 30), -20, Math.PI / 2, 780, { dmg: 45 * F.dK, r: 12, life: 3, ty: rand(TOP + 40, BOTTOM - 20) }); }
        return F.t >= F.dur + 0.8;
      }
      case 'paper': return true;
      case 'whale': {
        const mx = p.x + 34, my = p.y;
        if (F.stage === 'inhale') {
          for (const e of this.enemies) if (e.alive && !e.isBoss && e.x < this.W) e.pull = { x: mx, y: my, v: e.elite || e.type === 'mirror' ? 120 : 520 };
          this.bullets.each((b) => { b.pull = { x: mx, y: my }; });
          for (const e of this.enemies) if (e.alive && e.pull && !e.elite && e.type !== 'mirror' && dist2(e.x, e.y, mx, my) < 50 * 50) this.killEnemy(e, {});
          if (Math.random() < 0.9) this.part('mote', mx + rand(200, 700), my + rand(-250, 250), -600, 0, 0.6, 3, 'rgba(111,240,255,0.8)');
          if (F.t >= 1) { F.stage = 'exhale'; F.t = 0; for (const e of this.enemies) e.pull = null; this.shake(0.8); this.flash = 0.4; this.flashColor = '180,240,255'; }
          return false;
        }
        F.tick -= dt;
        const h = F.stage === 'exhale2' ? F.h * 0.6 : F.h;
        if (F.tick <= 0) {
          F.tick = 0.08;
          for (const e of this.enemies) if (e.alive && e.x > p.x && Math.abs(e.y - p.y) < h / 2 + (e.isBoss ? 80 : e.r)) this.damageEnemy(e, 45 * F.dK, { kind: 'burst', x: e.isBoss ? e.x - 80 : e.x, y: e.y });
          this.bullets.each((b) => { if (b.x > p.x && Math.abs(b.y - p.y) < h / 2) b.on = false; });
        }
        if (Math.random() < 0.9) this.part('mote', p.x + rand(40, this.W), p.y + rand(-h / 2, h / 2), 900, 0, 0.5, rand(2, 5), pick(['rgba(111,240,255,0.9)', 'rgba(255,227,138,0.9)']));
        if (F.t >= 0.9) { if (F.stage === 'exhale' && F.second) { F.stage = 'exhale2'; F.t = 0; return false; } return true; }
        return false;
      }
      case 'clock': return this.timeStop <= 0 && F.t > F.dur;
    }
    return true;
  }
  endTimeStop() {
    Sound.sfx('timeResume');
    const dK = this.bfx && this.bfx.dK ? this.bfx.dK : this.stats.dmgK;
    let i = 0;
    for (const e of this.enemies) {
      if (!e.alive || !e.clockMark) continue;
      const tgt = e; this.later(0.03 * i++, () => { if (!tgt.alive) return; tgt.clockMark = false; this.fx(tgt.x, tgt.y, 3, 70); this.damageEnemy(tgt, 160 * dK, { clock: true, kind: 'burst' }); });
    }
    this.shake(0.5); this.flash = 0.3; this.flashColor = '255,236,170';
  }
  gatherRewards() {
    const p = this.player;
    for (const k of this.pickups) { k.gather = { x: Math.min(this.W - 60, p.x + 110 + rand(-20, 40)), y: clamp(p.y + rand(-60, 60), TOP + 20, BOTTOM - 20) }; k.gatherT = 0.6; }
  }
  updateWheel(s, dt) {
    s.x += s.vx * dt;
    this.bullets.each((b) => { if (dist2(b.x, b.y, s.x, s.y) < s.r * s.r) { b.on = false; this.part('mote', b.x, b.y, 0, -40, 0.4, 2.5, 'rgba(255,243,200,0.9)'); } });
    for (const e of this.enemies) {
      if (!e.alive || s.hits.includes(e.id)) continue;
      const rr = s.r + (e.isBoss ? 100 : e.r);
      if (dist2(e.x, e.y, s.x, s.y) < rr * rr) { s.hits.push(e.id); this.damageEnemy(e, s.dmg, { kind: 'burst', x: s.x + 40, y: s.y }); this.wheelHit(e); }
    }
    if (Math.random() < 0.9) this.part('mote', s.x + rand(-s.r, s.r), s.y + rand(-s.r, s.r), -200, rand(-40, 40), 0.5, 3, 'rgba(255,243,200,0.9)');
    if (s.x > this.W - 60) {
      s.on = false; const n = this.stats.stars >= 3 ? 12 : 6;
      for (let i = 0; i < n; i++) this.addShot('wheelS', s.x, s.y, Math.PI * 0.5 + (i / n) * Math.PI + rand(-0.2, 0.2), 560, { dmg: 60 * this.stats.dmgK, r: 26, life: 2.4, pierce: 9999 });
      this.fx(s.x, s.y, 3, 160, ['#fff3c8', '#ffd76a', '#ffffff']); Sound.sfx('explode', { v: 1.6 });
    }
  }
  updateWheelS(s, dt) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.y < this.arena.top + s.r || s.y > this.arena.bottom - s.r) { s.vy = -s.vy; s.y = clamp(s.y, this.arena.top + s.r, this.arena.bottom - s.r); }
    if (s.x > this.W - s.r) s.vx = -Math.abs(s.vx);
    if (s.t > s.life || s.x < -40) { s.on = false; return; }
    s.hitCd = s.hitCd || {};
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const rr = s.r + (e.isBoss ? 100 : e.r);
      if (dist2(e.x, e.y, s.x, s.y) < rr * rr && !(s.hitCd[e.id] > s.t)) { s.hitCd[e.id] = s.t + 0.3; this.damageEnemy(e, s.dmg, { kind: 'burst', x: s.x, y: s.y }); this.wheelHit(e); }
    }
  }
  wheelHit(e) { this.moonHits = (this.moonHits || 0) + 1; if (this.moonHits % 3 === 0) this.dropPickup('dust', e.x, e.y, { value: 2, big: true }); }
  updateCandyBomb(s, dt) {
    s.y += s.vy * dt; s.x += Math.sin(s.t * 6) * 30 * dt;
    let boom = s.y >= s.ty;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const rr = s.r + (e.isBoss ? 100 : e.r);
      if (dist2(e.x, e.y, s.x, s.y) < rr * rr) { if (!e.elite && !e.isBoss && e.type !== 'mirror') this.killEnemy(e, { candify: true }); boom = true; break; }
    }
    if (boom || s.t > s.life) { s.on = false; this.explode(s.x, s.y, 55 * this.stats.blastK, s.dmg, { level: 1, fireworks: true }); }
  }

  /* ================================================== pickups ================================================== */
  dropPickup(kind, x, y, o = {}) {
    const k = Object.assign({ kind, x, y, vx: rand(-110, 110), vy: rand(-140, 60), t: 0, value: 1, seed: rand(10) }, o);
    this.pickups.push(k); return k;
  }
  spawnCrystalDrop(x, y, o = {}) {
    const first = this.first && this.m.crystals === 0 && !o.force && !this.pickups.some((k) => k.kind === 'crystal');
    let skill = o.force || (first ? 'thunder' : this.pickCrystalSkill(o.prefer));
    if (o.force && this.skills.length >= 3 && !this.skills.find((s) => s.id === o.force)) skill = this.pickCrystalSkill();
    if (o.force && this.lvOf(o.force) >= 5) skill = this.pickCrystalSkill();
    if (skill === 'gold') { this.dropPickup('gold', x, y, { vx: -40, vy: 0 }); return; }
    const pairId = _eid++;
    this.dropPickup('crystal', x, y, { skill, rare: !!o.rare, vx: -50, vy: rand(-30, 30), pair: pairId });
    // 用飞行做选择：一半情况下同时掉两颗，飞向想要的那颗
    if (!first && !o.force && !o.single && this.skills.length < 3 && Math.random() < 0.5) {
      const alt = this.pickCrystalSkill(null, skill);
      if (alt && alt !== 'gold' && alt !== skill) this.dropPickup('crystal', x, clamp(y + (y > (TOP + BOTTOM) / 2 ? -110 : 110), TOP + 30, BOTTOM - 30), { skill: alt, rare: !!o.rare, vx: -50, vy: 0, pair: pairId });
    }
    this.emit('crystalDrop');
  }
  pickCrystalSkill(prefer, avoid) {
    const owned = this.skills.map((s) => s.id);
    let pool = owned.length < 3 ? SKILL_ORDER.filter((id) => this.lvOf(id) < 5) : owned.filter((id) => this.lvOf(id) < 5);
    if (avoid) pool = pool.filter((id) => id !== avoid);
    if (!pool.length) return 'gold';
    if (prefer && pool.includes(prefer)) return prefer;
    const w = pool.map((id) => (owned.includes(id) ? 1.6 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[0];
  }
  magnetRadius() { const lv = this.lvOf('magnet'); return (110 + (lv ? 60 + 60 * lv : 0)) * this.stats.magnetK; }
  updatePickups(dt) {
    const p = this.player, R = this.magnetRadius();
    this.pickCd.bolt -= dt; this.pickCd.mine -= dt; this.pickCd.zap -= dt;
    for (const k of this.pickups) {
      k.t += dt;
      if (k.gather && k.gatherT > 0) { k.gatherT -= dt; k.x = smooth(k.x, k.gather.x, 6, dt); k.y = smooth(k.y, k.gather.y, 6, dt); if (k.gatherT <= 0) { k.gather = null; if (k.kind !== 'crystal') k.attract = true; } continue; }
      const d = Math.sqrt(dist2(k.x, k.y, p.x, p.y));
      const pull = k.kind !== 'crystal' && (k.attract || (d < R && k.t > 0.25) || this.state === 'victory');
      if (pull && p.alive) { const a = angTo(k.x, k.y, p.x, p.y), sp = 560 + k.t * 120; k.vx = smooth(k.vx, Math.cos(a) * sp, 12, dt); k.vy = smooth(k.vy, Math.sin(a) * sp, 12, dt); }
      else if (k.kind === 'crystal' || k.kind === 'gold' || k.kind === 'chest') { k.vx = smooth(k.vx, -55, 2, dt); k.vy = smooth(k.vy, Math.sin(k.t * 2 + k.seed) * 20, 2, dt); }
      else if (!k.rain) { k.vx = smooth(k.vx, -70, 2.5, dt); k.vy = smooth(k.vy, 0, 2.5, dt); }
      k.x += k.vx * dt; k.y += k.vy * dt;
      if (k.kind === 'crystal') k.y = clamp(k.y, this.arena.top + 24, this.arena.bottom - 24);
      if (k.fade !== undefined) { k.fade -= dt * 2; if (k.fade <= 0) { k.done = true; continue; } }
      const reach = k.kind === 'crystal' ? 36 : k.kind === 'gold' ? 44 : 26;
      if (p.alive && d < reach && k.fade === undefined && this.state !== 'dying') this.collect(k);
      if (k.x < -60 || k.t > (k.kind === 'crystal' ? 16 : 14) || k.y > LH + 40) k.done = true;
    }
    this.pickups = this.pickups.filter((k) => !k.done);
  }
  collect(k) {
    const p = this.player; k.done = true;
    switch (k.kind) {
      case 'dust': {
        this.m.dust += k.value; this.addCharge(0.0008); Sound.sfx('dust', { gap: 45 });
        const ml = this.lvOf('magnet');
        if (ml && this.pickCd.bolt <= 0) { this.pickCd.bolt = 0.05; this.addShot('starbolt', p.x, p.y, rand(-0.5, 0.5), 700, { dmg: (8 + 3 * ml) * (ml >= 4 ? 1.5 : 1), r: 6, homing: 7, life: 1.4 }); }
        if (this.hasSyn('bomb', 'magnet') && this.pickCd.mine <= 0) { this.pickCd.mine = 0.1; this.explode(p.x + 30, p.y, 45 * this.stats.blastK, 14, { level: 1 }); }
        if (this.hasSyn('thunder', 'magnet') && this.pickCd.zap <= 0) { this.pickCd.zap = 0.15; const e = this.nearestEnemy(p.x, p.y, 220); if (e) this.zap(p.x, p.y, e, 1, 14); }
        break;
      }
      case 'crystal':
        this.gainSkill(k.skill, k.rare ? 2 : 1);
        for (const o of this.pickups) if (o !== k && o.kind === 'crystal' && o.pair === k.pair) o.fade = 1;
        this.addCharge(0.04); if (this.planeId === 'paper') this.addClone(10);
        if (this.hintStep === 1) this.hintStep = 2;
        break;
      case 'candy': p.candy = 5; this.m.candies++; Sound.sfx('candy'); this.text('糖果强化！', p.x, p.y - 40, '#ff9fcf', 16, 3); if (this.planeId === 'paper') this.addClone(10); break;
      case 'heart': if (p.hp < p.maxHp) p.hp++; Sound.sfx('heart'); this.text('+1', p.x, p.y - 40, '#9ff2c8', 18, 4); break;
      case 'chest': {
        this.m.dust += 30; this.m.talent++; this.m.chests++;
        const pl = pick(PLANE_ORDER); this.m.frags[pl] = (this.m.frags[pl] || 0) + 3;
        Sound.sfx('chest'); this.text('宝箱：星尘 +30 · 天赋点 +1', p.x, p.y - 44, '#ffe38a', 16, 4); this.fx(p.x, p.y, 2, 80, ['#ffd76a', '#ffb347', '#fff6c8']);
        break;
      }
      case 'gold':
        Sound.sfx('gold'); this.highlight(); this.flash = 0.35; this.flashColor = '255,236,170';
        if (this.skills.length) for (const s of this.skills.slice()) if (s.lv < 5) this.gainSkill(s.id, 1);
        if (!this.skills.length) this.gainSkill(this.pickCrystalSkill(), 2);
        p.candy = 8; this.emit('gold'); if (this.planeId === 'paper') this.addClone(10);
        break;
    }
  }

  /* ================================================== streak (连杀热度) ================================================== */
  updateStreak(dt) {
    const S = this.streak;
    this.chainCd -= dt; this.chainHiCd -= dt;
    if (S.n > 0) { S.t -= dt; if (S.t <= 0) S.n = 0; }
    if (S.n > S.lastN) {
      for (const ms of [10, 30, 50, 100]) if (S.lastN < ms && S.n >= ms) this.streakMilestone(ms);
      if (S.n > 100 && Math.floor(S.n / 50) > Math.floor(S.lastN / 50)) this.streakMilestone(50);
    }
    if (S.n > S.best) { S.best = S.n; this.m.maxStreak = S.best; }
    S.lastN = S.n;
  }
  streakMilestone(ms) {
    const p = this.player;
    this.addCharge(0.05); this.highlight();
    this.emit('streak', { n: ms });
    Sound.sfx('streak', { k: [10, 30, 50, 100].indexOf(ms) });
    if (ms === 10) { this.ring(p.x, p.y, 0, 150, 0.35, 30, 'rgba(255,243,200,0.9)'); Sound.sfx('nova'); }
    if (ms === 50) { this.ring(p.x, p.y, 0, 520, 0.8, 60 * this.stats.dmgK, 'rgba(255,215,106,0.95)', { clear: true }); this.fx(p.x, p.y, 3, 200); }
    if (ms === 100) { this.dropPickup('gold', Math.min(this.W - 100, p.x + 260), p.y, { vx: -30, vy: 0 }); this.m.streak100 = 1; }
  }

  /* ================================================== director: 战斗段 / 洞口 / Boss ================================================== */
  startSegment(type) {
    this.segIdx++;
    const tier = this.segIdx - 1;
    const dur = type === 'chest' ? 18 : type === 'heal' ? 20 : this.segIdx === 1 ? 28 : 38;
    this.seg = { type, idx: this.segIdx, tier, t: 0, dur, spawnT: 0.3, eliteAt: tier >= 1 && type !== 'chest' && type !== 'heal' ? dur * 0.45 : -1, eliteDone: false, over: false, overT: 0, explosive: type === 'bomb', chests: type === 'chest' ? [3, 8, 13] : [] };
    this.phase = 'fight';
    this.m.route.push(type);
    const cx = this.W * 0.62, cy = (TOP + BOTTOM) / 2;
    const dom = this.stream ? this.stream.id : this.skills.length ? this.skills.slice().sort((a, b) => b.lv - a.lv)[0].id : null;
    if (type === 'skill') this.spawnCrystalDrop(cx, cy, { prefer: dom, single: true });
    if (type === 'rare') this.spawnCrystalDrop(cx, cy, { rare: true, single: true, prefer: this.first && !this.skills.find((s) => s.id === 'wing') ? 'wing' : null });
    if (type === 'wing') this.spawnCrystalDrop(cx, cy, { force: 'wing' });
    if (type === 'bomb') this.spawnCrystalDrop(cx, cy, { force: 'bomb' });
    if (type === 'heal') { this.dropPickup('heart', cx, cy - 60, { vx: -40, vy: 0 }); this.dropPickup('heart', cx, cy + 60, { vx: -40, vy: 0 }); }
    this.emit('segment', { idx: this.segIdx, type });
    if (this.cb.onPortal && type !== 'normal') this.cb.onPortal(type);
  }
  formationPool(tier, calm) {
    if (calm) return ['line', 'snake', 'vee'];
    const L = ['line', 'vee', 'snake', 'wall'];
    if (tier >= 1) L.push('boats', 'stars');
    if (tier >= 2) L.push('ticks', 'swarm');
    if (tier >= 3) L.push('beacon', 'swarm');
    return L;
  }
  updateDirector(dt) {
    if (this.planIdx < this.crystalPlan.length && this.runT >= this.crystalPlan[this.planIdx]) { this.planIdx++; this.pendingCrystal++; }
    if (!this.rarePlanned && this.runT >= 300) { this.rarePlanned = true; this.pendingCrystal++; this.pendingRare = true; }
    if (this.phase === 'fight') {
      const S = this.seg; S.t += dt;
      if (!S.over) {
        S.spawnT -= dt;
        const calm = S.type === 'heal' || S.type === 'chest';
        const empty = !this.enemies.some((e) => e.alive && !e.isBoss && e.x < this.W + 60);
        if (empty && S.spawnT > 0.2) S.spawnT = 0.2; // 屏幕清空就立刻补下一波，保证空档不超过 1.2 秒
        if (S.spawnT <= 0) {
          if (this.segIdx === 1 && !this.firstWave) { this.firstWave = true; for (let i = 0; i < 6; i++) this.addEnemy('jelly', { x: this.W - 80 + i * 56, y: this.player.y, path: 'sine', vx: -150, amp: 14, freq: 2.2, phase: i * 0.5 }); }
          else this.spawnFormation(pick(this.formationPool(S.tier, calm)));
          S.spawnT = calm ? 2.6 : Math.max(1.2, 2.2 - S.tier * 0.12);
        }
        if (S.eliteAt > 0 && !S.eliteDone && S.t >= S.eliteAt) { S.eliteDone = true; this.spawnElite(); }
        while (S.chests.length && S.t >= S.chests[0]) { S.chests.shift(); this.dropPickup('chest', this.W + 30, rand(TOP + 80, BOTTOM - 80), { vx: -90, vy: 0 }); }
        if (S.t >= S.dur) S.over = true;
      } else {
        S.overT += dt;
        const fighters = this.enemies.filter((e) => e.alive && !e.leaving && !e.fodder && e.x < this.W + 40);
        if (fighters.length === 0 || S.overT > 6) this.openPortals();
      }
    } else if (this.phase === 'portal') this.updatePortals(dt);
  }
  choosePortals() {
    const k = this.segIdx, p = this.player;
    if (this.first && k === 1) return ['skill', 'rare'];
    if (k >= (this.first ? 5 : 7)) return ['boss'];
    const pool = ['skill', 'rare', 'wing', 'bomb', 'chest', 'skill'];
    if (p.hp < p.maxHp) pool.push('heal', 'heal');
    const out = [], n = k >= 3 ? 3 : 2;
    while (out.length < n) { const t = pick(pool); if (!out.includes(t)) out.push(t); }
    if (k >= 4) out[out.length - 1] = 'boss';
    return out;
  }
  openPortals() {
    this.phase = 'portal';
    const types = this.choosePortals(), mid = (this.arena.top + this.arena.bottom) / 2, span = (this.arena.bottom - this.arena.top) * 0.36;
    const ys = types.length === 1 ? [mid] : types.length === 2 ? [mid - span * 0.7, mid + span * 0.7] : [mid - span, mid, mid + span];
    this.portals = types.map((type, i) => ({ type, x: this.W + 80, y: ys[i], r: 60, t: 0 }));
    this.portalFodder = 0.2; this.portalT = 0;
    this.emit('portals', { types });
    if (this.hintStep >= 0 && this.hintStep < 9 && !this.portalHinted) { this.portalHinted = true; this.hintPortal = true; }
  }
  updatePortals(dt) {
    const p = this.player;
    this.portalT += dt; this.portalFodder -= dt;
    if (this.portalFodder <= 0) { this.portalFodder = 0.9; this.spawnFormation('dustmoths'); }
    for (const q of this.portals) {
      q.t += dt; q.x -= (this.portals.length === 1 ? 170 : 210) * dt;
      if (p.alive && dist2(q.x, q.y, p.x, p.y) < (q.r * 0.85) ** 2) { this.enterPortal(q); return; }
    }
    if (this.portals.length && this.portals.every((q) => q.x < p.x - 90)) this.enterPortal(this.portals[Math.floor(this.portals.length / 2)]);
  }
  enterPortal(q) {
    Sound.sfx('portal'); this.flash = Math.max(this.flash, 0.3); this.flashColor = '255,255,255';
    this.fx(q.x, q.y, 3, 120, [PORTALS[q.type].color, '#ffffff', '#ffe38a']);
    this.portals = []; this.hintPortal = false;
    if (q.type === 'boss') this.startBoss(); else this.startSegment(q.type);
  }
  startBoss() {
    this.phase = 'boss'; this.bossEarly = this.segIdx < 6; this.m.route.push('boss');
    for (const e of this.enemies) if (e.alive) { e.leaving = true; e.vx = -380; e.path = 'line'; }
    this.clearBullets(true);
    this.seg = { type: 'boss', idx: this.segIdx, tier: Math.max(3, this.segIdx - 1), t: 0, dur: 0 };
    this.boss = new ClockBoss(this); this.bossIntroT = 2.8;
    this.bossProxy = { id: 'boss', isBoss: true, type: 'boss', x: this.boss.x, y: this.boss.y, r: 118, alive: true };
    this.enemies.push(this.bossProxy);
    this.emit('boss');
    if (this.cb.onPortal) this.cb.onPortal('boss');
  }
  /* n = 0：阶段切换瞬间（闹钟号被动充能）；n = 2：第二乐章开始（Boss 回应 Build） */
  onBossPhase(n) {
    if (n === 0 && this.planeId === 'clock') { const p = this.player; const before = p.burst; p.burst = Math.min(1, p.burst + 0.5); this.text('准点充能', p.x, p.y - 44, '#ffd76a', 16, 4); if (before < 1 && p.burst >= 1) this.emit('burstReady'); }
    if (n === 2) this.bossResponse();
  }
  /* Boss 看见你的 Build */
  bossResponse() {
    const b = this.boss, sid = this.stream ? this.stream.id : this.skills.length ? this.skills.slice().sort((x, y) => y.lv - x.lv)[0].id : null;
    let title = '失控闹钟加快了节奏', sub = '先把 Build 养起来，Boss 会回应你的流派';
    if (sid === 'thunder') { b.conductive = true; title = '外壳开始导电！'; sub = '雷暴流：击中闹钟时跳电次数 +2，雷击伤害提高'; }
    else if (sid === 'wing') { title = '闹钟召唤了镜像！'; sub = '分身流：分身会自动锁定镜像闹钟'; for (let i = 0; i < 3; i++) { const ty = lerp(this.arena.top + 90, this.arena.bottom - 90, i / 2); this.addEnemy('mirror', { x: this.W + 60, y: ty, path: 'mirror', tx: this.W * (0.5 + i * 0.07), ty, fireT: 2 + i * 0.6 }); } }
    else if (sid === 'bomb') { b.marked = true; title = '护甲被标记了！'; sub = '爆破流：爆炸会撬开闹钟的核心，伤害 +50%'; }
    else if (sid === 'magnet') { title = '星尘海！'; sub = '吸星流：闹钟洒出一整片星尘，全部吸进来'; for (let i = 0; i < 70; i++) this.dropPickup('dust', b.x + rand(-160, 60), b.y + rand(-220, 220), { value: 2, vx: rand(-260, -60), vy: rand(-160, 160) }); }
    else if (sid === 'rainbow') { this.carnival = true; title = '彩色狂欢阶段！'; sub = '彩虹流：击中闹钟会掉落更多糖果强化'; }
    else if (sid === 'ice') { b.iceHands = true; title = '指针被冻住了！'; sub = '冰晶流：闹钟指针会周期性冻结，核心更常暴露'; }
    this.emit('bossResponse', { title, sub, id: sid });
    this.highlight();
  }
  onBossDead() {
    this.state = 'victory'; this.stateT = 3.4; this.phase = 'victory';
    this.bossTime = this.boss.fightT;
    if (this.bossProxy) this.bossProxy.alive = false;
    for (const e of this.enemies) if (e.alive && !e.isBoss) this.killEnemy(e, {});
    this.clearBullets(true); this.warns = [];
    this.fx(this.boss.x, this.boss.y, 5, 900);
    this.highlight(); this.victoryT = 0;
    this.shake(1); this.flash = this.settings.reduceFlash ? 0.25 : 0.8; this.flashColor = '255,243,200';
  }
  finish(win) {
    this.done = true; this.phase = 'end';
    if (this.cb.onEnd) this.cb.onEnd(this.result(win));
  }
  result(win) {
    const m = this.m;
    return {
      win, plane: this.planeId, runT: this.runT, stats: m,
      skills: this.skills.map((s) => ({ id: s.id, lv: s.lv })), syns: [...this.syn], stream: this.stream ? this.stream.name : null, streamId: this.stream ? this.stream.id : null,
      avgKill: m.killTimeN ? m.killTimeSum / m.killTimeN : null, bossTime: this.bossTime || 0, bossEarly: this.bossEarly,
    };
  }

  /* ================================================== burst preview (抽卡 / 机库里的大招预览) ================================================== */
  setupPreview() {
    this.phase = 'preview'; this.player.x = this.W * 0.2; this.previewT = 0; this.previewFired = false;
    this.seg = { tier: 0 };
    this.spawnDummies();
  }
  spawnDummies() {
    for (const e of this.enemies) e.alive = false;
    this.enemies = [];
    for (let c = 0; c < 5; c++) for (let r = 0; r < 4; r++) this.addEnemy(r % 2 ? 'moth' : 'jelly', { x: this.W * (0.5 + c * 0.09), y: lerp(TOP + 90, BOTTOM - 90, r / 3), path: 'dummy', hp: 30, fodder: true });
  }
  updatePreview(dt) {
    this.previewT += dt;
    if (!this.previewFired && this.previewT > 0.6) { this.previewFired = true; this.player.burst = 1; this.startBurst(); }
    if (this.previewT > 5.2 && !this.bursting) { this.previewT = 0; this.previewFired = false; this.pickups = []; this.spawnDummies(); }
  }

  /* ================================================== first-run hints ================================================== */
  updateHints() {
    if (this.hintStep < 0 || this.mode !== 'run' || this.state !== 'play') { if (this.hintShown) { this.hintShown = null; this.emit('hint', { id: null }); } return; }
    const p = this.player;
    if (this.hintStep === 0 && p.moved > 220) this.hintStep = 1;
    let want = null;
    if (this.hintStep === 0) want = 'move';
    else if (this.hintPortal) want = 'portal';
    else if (p.burst >= 1 && !this.bursting && this.m.bursts === 0) want = 'burst';
    else if (this.hintStep === 1 && this.pickups.some((k) => k.kind === 'crystal')) want = 'crystal';
    if (this.hintStep >= 9) want = null;
    if (want !== this.hintShown) { this.hintShown = want; this.emit('hint', { id: want }); }
  }

  /* ================================================== fx ================================================== */
  pan(x) { return clamp((x / this.W) * 2 - 1, -1, 1); }
  shake(v) { if (this.settings.shake) this.trauma = Math.min(1, this.trauma + v); }
  text(str, x, y, color, size = 16, prio = 1) {
    if (this.texts.length > 14) { const i = this.texts.findIndex((t) => t.prio < prio); if (i < 0) return; this.texts.splice(i, 1); }
    this.texts.push({ str, x, y, color, size, prio, t: 0, life: 0.9 });
  }
  part(kind, x, y, vx, vy, life, size, color, rot = 0) {
    if (this.low && (kind === 'dot' || kind === 'mote' || kind === 'spark' || kind === 'confetti') && Math.random() < 0.55) return;
    const q = this.parts.get(); if (!q) return;
    q.on = true; q.kind = kind; q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.t = 0; q.life = life; q.size = size; q.color = color; q.rot = rot || rand(TAU); q.vr = rand(-6, 6);
  }
  /* 爆炸等级：1 小怪闪光+碎片 / 2 圆形冲击波 / 3 颜色扩散+轻震 / 4 大招全屏光 / 5 Boss 清屏 */
  fx(x, y, level, r = 30, colors) {
    const C = colors || this.expColors, low = this.low;
    if (level === 1) {
      this.part('flash', x, y, 0, 0, 0.18, Math.max(26, r * 1.6), C[0]);
      for (let i = 0; i < (low ? 4 : 9); i++) this.part(i % 2 ? 'shard' : 'petal', x, y, rand(-240, 240), rand(-260, 140), 0.6, rand(4, 7), pick(C));
      this.part('ring', x, y, 0, 0, 0.25, Math.max(34, r * 1.8), 'rgba(255,255,255,0.8)');
    } else if (level === 2) {
      this.part('flash', x, y, 0, 0, 0.22, r * 0.9, C[0]);
      this.part('ring', x, y, 0, 0, 0.35, r, 'rgba(255,255,255,0.9)');
      this.part('ring', x, y, 0, 0, 0.45, r * 1.3, C[1] || C[0]);
      for (let i = 0; i < (low ? 6 : 16); i++) this.part(i % 3 ? 'spark' : 'confetti', x, y, rand(-360, 360), rand(-360, 360), 0.6, rand(4, 7), pick(C));
    } else if (level === 3) {
      this.part('flash', x, y, 0, 0, 0.3, r * 0.8, C[0]);
      for (let i = 0; i < 3; i++) this.part('ring', x, y, 0, 0, 0.45 + i * 0.12, r * (0.8 + i * 0.35), C[i % C.length]);
      for (let i = 0; i < (low ? 10 : 26); i++) this.part('confetti', x, y, rand(-480, 480), rand(-480, 300), 0.9, rand(5, 9), pick(C));
      this.shake(0.22);
    } else if (level === 4) {
      this.part('ring', x, y, 0, 0, 0.7, r, 'rgba(255,255,255,0.95)');
      this.part('ring', x, y, 0, 0, 0.9, r * 1.4, C[0]);
      for (let i = 0; i < (low ? 16 : 40); i++) this.part('confetti', x, y, rand(-800, 800), rand(-800, 400), 1.1, rand(5, 10), pick(C));
    } else if (level === 5) {
      for (let i = 0; i < 4; i++) this.part('ring', x, y, 0, 0, 0.8 + i * 0.2, r * (0.6 + i * 0.3), pick(C.concat(['#ffffff'])));
      for (let i = 0; i < (low ? 30 : 90); i++) this.part('confetti', x, y, rand(-900, 900), rand(-900, 500), 1.8, rand(6, 12), pick(C.concat(['#ffe38a', '#ffffff'])));
    }
  }
  updateFx(dt) {
    this.parts.each((q) => {
      q.t += dt; if (q.t >= q.life) { q.on = false; return; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
      if (q.kind === 'petal' || q.kind === 'shard' || q.kind === 'confetti') { q.vy += 420 * dt; q.vx *= 1 - dt * 1.4; }
      else if (q.kind === 'snow') q.vx *= 1 - dt;
      else { q.vx *= 1 - dt * 3; q.vy *= 1 - dt * 3; }
    });
    for (const t of this.texts) { t.t += dt; t.y -= (40 - t.t * 30) * dt; }
    this.texts = this.texts.filter((t) => t.t < t.life);
    for (const a of this.arcs) a.t += dt;
    this.arcs = this.arcs.filter((a) => a.t < a.life);
    this.updateBeams(dt); this.updateRings(dt);
    if (this.victoryT !== undefined) this.victoryT += dt;
  }

  /* ================================================== HUD snapshot ================================================== */
  hud() {
    const p = this.player;
    const h = { hp: p.hp, maxHp: p.maxHp, burst: p.burst, ready: p.burst >= 1 && !this.bursting, skills: this.skills.map((s) => ({ id: s.id, lv: s.lv })), syns: [...this.syn], stream: this.stream ? this.stream.name : null,
      streak: this.streak.n, dust: Math.floor(this.m.dust), seg: this.seg && this.seg.idx, segType: this.seg && this.seg.type, segU: this.seg && this.seg.dur ? clamp(this.seg.t / this.seg.dur, 0, 1) : 0, phase: this.phase, candy: p.candy };
    if (this.boss && this.phase === 'boss') h.boss = this.boss.hudInfo();
    return h;
  }

  /* ================================================== render ================================================== */
  render(g, o = {}) {
    const W = this.W, t = this.t, p = this.player, cb = this.settings.colorblind;
    g.save();
    if (this.trauma > 0) { const s = this.trauma * this.trauma * 16; g.translate(rand(-s, s), rand(-s, s)); }
    if (o.simpleBg) { const gr = g.createLinearGradient(0, 0, 0, LH); gr.addColorStop(0, '#1b1548'); gr.addColorStop(1, '#2e2670'); g.fillStyle = gr; g.fillRect(-20, -20, W + 40, LH + 40); }
    else this.scene.draw(g, W, LH);
    if (this.carnival) { g.globalCompositeOperation = 'soft-light'; const gr = g.createLinearGradient(0, 0, W, LH); gr.addColorStop(0, 'rgba(255,159,207,0.5)'); gr.addColorStop(0.5, 'rgba(255,227,138,0.5)'); gr.addColorStop(1, 'rgba(159,227,240,0.5)'); g.fillStyle = gr; g.fillRect(0, 0, W, LH); g.globalCompositeOperation = 'source-over'; }
    if (this.arena.top > TOP + 1 || this.arena.bottom < BOTTOM - 1) {
      g.fillStyle = 'rgba(255,138,92,0.14)'; g.fillRect(0, 0, W, this.arena.top); g.fillRect(0, this.arena.bottom, W, LH - this.arena.bottom);
      g.strokeStyle = 'rgba(255,190,150,0.55)'; g.setLineDash([10, 8]); g.lineWidth = 2; g.lineDashOffset = -t * 30;
      g.beginPath(); g.moveTo(0, this.arena.top); g.lineTo(W, this.arena.top); g.moveTo(0, this.arena.bottom); g.lineTo(W, this.arena.bottom); g.stroke(); g.setLineDash([]);
    }
    this.drawWarns(g);
    for (const q of this.portals) drawPortal(g, q.type, q.x, q.y, q.r, t + q.y * 0.01, clamp((this.W + 80 - q.x) / 120, 0, 1));
    for (const w of this.walls) { g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(w.x - 40, 0, w.x + 10, 0); gr.addColorStop(0, 'rgba(201,168,255,0)'); gr.addColorStop(1, 'rgba(255,243,200,0.7)'); g.fillStyle = gr; g.fillRect(w.x - 40, this.arena.top, 50, this.arena.bottom - this.arena.top); g.globalCompositeOperation = 'source-over'; }
    for (const k of this.pickups) if (k.kind !== 'crystal') drawPickup(g, k, t);
    for (const e of this.enemies) if (e.alive && !e.isBoss) this.drawEnemy(g, e);
    if (this.boss) this.boss.draw(g);
    this.drawBeams(g);
    this.shots.each((s) => this.drawShot(g, s));
    this.drawArcs(g);
    for (const k of this.pickups) if (k.kind === 'crystal') drawPickup(g, k, t);
    this.drawPlayer(g);
    const stop = this.timeStop > 0;
    this.bullets.each((b) => {
      if (b.ghost > 0) { g.globalAlpha = 0.25 + 0.25 * Math.sin(t * 20); BulletArt.draw(g, b.type, b.x, b.y, b.type === 'blue' || b.type === 'white' ? b.rot : 0, 1, cb); g.globalAlpha = 1; return; }
      if (this.reverseT > 0) { g.globalAlpha = 0.22; BulletArt.draw(g, b.type, b.x + b.vx * 0.06, b.y + b.vy * 0.06, b.rot, 1, false); g.globalAlpha = 1; }
      BulletArt.draw(g, b.type, b.x, b.y, b.type === 'blue' || b.type === 'white' ? b.rot : b.type === 'gold' ? b.t * 3 : 0, 1, cb);
      if (stop) { g.strokeStyle = 'rgba(255,215,106,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.arc(b.x, b.y, 11, 0, TAU); g.stroke(); }
    });
    if (p.alive && this.settings.showHitbox && this.mode === 'run') { g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(255,122,107,0.95)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 3.4, 0, TAU); g.fill(); g.stroke(); }
    this.drawParticles(g);
    this.drawTexts(g);
    g.restore();
    this.drawOverlays(g, o);
  }
  drawPlayer(g) {
    const p = this.player, t = this.t, C = this.trailColors;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < p.trail.length; i++) {
      const q = p.trail[i], a = (i / p.trail.length) * 0.5 * (1 - q.t * 2); if (a <= 0) continue;
      const c = C[i % C.length]; drawGlow(g, q.x, q.y, 10 + i * 0.3, c.startsWith('#') ? hexA(c, 0.8) : c, a);
    }
    g.globalCompositeOperation = 'source-over';
    if (this.lvOf('magnet')) { g.strokeStyle = `rgba(201,168,255,${0.16 + Math.sin(t * 3) * 0.05})`; g.lineWidth = 2; g.setLineDash([6, 10]); g.lineDashOffset = -t * 20; g.beginPath(); g.arc(p.x, p.y, this.magnetRadius(), 0, TAU); g.stroke(); g.setLineDash([]); }
    if (this.storm && this.lvOf('thunder') >= 5) { const sx = p.x + Math.cos(this.storm.a) * 70, sy = p.y + Math.sin(this.storm.a) * 70; g.globalCompositeOperation = 'lighter'; drawGlow(g, sx, sy, 34, GLOW.blue, 0.95); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#e8f8ff'; g.beginPath(); g.arc(sx, sy, 9, 0, TAU); g.fill(); }
    for (const w of this.wingmen) {
      const gold = this.lvOf('wing') >= 5 && !w.temp;
      g.save(); g.translate(w.x, w.y); g.scale(gold ? 0.62 : 0.5, gold ? 0.62 : 0.5);
      if (w.temp) g.globalAlpha = Math.min(1, w.temp * 2) * 0.9;
      PlaneArt.paper(g, t + w.x * 0.01, {});
      if (gold) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 40, GLOW.gold, 0.5); }
      g.restore();
    }
    if (!p.alive) { if (this.state === 'dying') drawPlane(g, this.planeId, p.x, p.y + (1.6 - this.stateT) * 40, 1, t, { tilt: 0.5, hurt: true, alpha: Math.max(0, this.stateT / 1.6) }); return; }
    const cloudRam = this.bfx && this.bfx.id === 'cloud';
    const blink = p.inv > 0 && Math.sin(t * 40) > 0.3 && !cloudRam && this.state === 'play';
    if (cloudRam) {
      const R = this.bfx.R; g.globalCompositeOperation = 'lighter'; drawGlow(g, p.x, p.y, R * 1.3, 'rgba(255,255,255,0.8)', 0.8); g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + t * 2; g.beginPath(); g.arc(p.x + Math.cos(a) * R * 0.6, p.y + Math.sin(a) * R * 0.5, R * 0.45, 0, TAU); g.fill(); }
    }
    if (p.cloudShield) { g.strokeStyle = 'rgba(220,240,255,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, 34, 0, TAU); g.stroke(); }
    if (p.candy > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, p.x, p.y, 44, GLOW.pink, 0.4); g.globalCompositeOperation = 'source-over'; }
    if (this.bfx && this.bfx.id === 'whale' && this.bfx.stage !== 'inhale') {
      const h = this.bfx.stage === 'exhale2' ? this.bfx.h * 0.6 : this.bfx.h, a = 1 - this.bfx.t / 0.9;
      g.globalCompositeOperation = 'lighter';
      const gr = g.createLinearGradient(0, p.y - h / 2, 0, p.y + h / 2); gr.addColorStop(0, 'rgba(111,240,255,0)'); gr.addColorStop(0.5, `rgba(200,250,255,${0.75 * a})`); gr.addColorStop(1, 'rgba(111,240,255,0)');
      g.fillStyle = gr; g.fillRect(p.x + 20, p.y - h / 2, this.W, h);
      g.globalCompositeOperation = 'source-over';
    }
    if (!blink) drawPlane(g, this.planeId, p.x, p.y, 1, t, { tilt: p.tilt, blink: p.blink, hurt: p.hurtT > 0.3, happy: this.state === 'victory', bright: !!this.bursting || p.candy > 0 });
  }
  drawEnemy(g, e) {
    const t = this.t;
    g.save(); g.translate(e.x, e.y);
    if (e.type === 'mirror') { g.globalAlpha = 0.8; g.scale(0.3, 0.3); drawClockBoss(g, { x: 0, y: 0, phase: 2, minA: t * 2, hourA: t * 0.3, weakT: 0, mouth: 0, lookA: Math.PI, shield: 0, hitFlash: e.hitFlash }, t + e.seed); g.restore(); return; }
    (EnemyArt[e.type] || EnemyArt.jelly)(g, e, t + e.seed);
    if (e.hitFlash > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, e.r * 1.6, GLOW.white, e.hitFlash * 0.55); g.globalCompositeOperation = 'source-over'; }
    if (e.frozen > 0) { g.fillStyle = 'rgba(200,240,255,0.45)'; g.strokeStyle = 'rgba(232,251,255,0.9)'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 + 0.3; g.lineTo(Math.cos(a) * (e.r + 6), Math.sin(a) * (e.r + 6)); } g.closePath(); g.fill(); g.stroke(); }
    if (e.stun > 0) { g.strokeStyle = '#bfe9ff'; g.lineWidth = 1.6; for (let i = 0; i < 3; i++) { const a = t * 8 + i * 2; g.beginPath(); g.moveTo(Math.cos(a) * 12, -e.r - 6); g.lineTo(Math.cos(a) * 12 + 4, -e.r - 12); g.stroke(); } }
    if (e.mark) { g.strokeStyle = `rgba(255,120,90,${0.7 + Math.sin(t * 10) * 0.3})`; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, e.r + 8, 0, TAU); g.moveTo(-e.r - 12, 0); g.lineTo(-e.r - 4, 0); g.moveTo(e.r + 12, 0); g.lineTo(e.r + 4, 0); g.stroke(); }
    if (e.clockMark) { g.strokeStyle = '#ffd76a'; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, e.r + 10, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -e.r); g.moveTo(0, 0); g.lineTo(e.r * 0.6, 0); g.stroke(); }
    g.restore();
    if (e.elite) { const w = 80, y = e.y - e.r - 26; g.fillStyle = 'rgba(14,11,40,0.75)'; g.fillRect(e.x - w / 2, y, w, 7); g.fillStyle = '#ff9d8c'; g.fillRect(e.x - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, 7); }
  }
  drawShot(g, s) {
    const a = Math.atan2(s.vy, s.vx), t = this.t;
    switch (s.kind) {
      case 'moon': BulletArt.draw(g, 'crescent', s.x, s.y, 0, 0.8); break;
      case 'puff': g.globalCompositeOperation = 'lighter'; drawGlow(g, s.x, s.y, 22, 'rgba(220,240,255,0.7)', 0.8); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#ffffff'; for (const [dx, dy, r] of [[-4, 0, 9], [4, -3, 8], [4, 4, 7]]) { g.beginPath(); g.arc(s.x + dx, s.y + dy, r, 0, TAU); g.fill(); } break;
      case 'candyS': g.globalCompositeOperation = 'lighter'; drawGlow(g, s.x, s.y, 12, GLOW.pink, 0.6); g.globalCompositeOperation = 'source-over'; g.fillStyle = ['#ff9fcf', '#9fe3f0', '#ffe38a'][(s.x | 0) % 3]; g.beginPath(); g.arc(s.x, s.y, 5, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(s.x, s.y, 3, 0.5, 2.8); g.stroke(); break;
      case 'dart': case 'wingDart': g.save(); g.translate(s.x, s.y); g.rotate(a); if (s.gold) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 14, GLOW.gold, 0.6); g.globalCompositeOperation = 'source-over'; } g.fillStyle = s.gold ? '#ffe38a' : '#fff4dc'; g.strokeStyle = PAL.ink; g.lineWidth = 1.2; g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -4); g.lineTo(-3, 0); g.lineTo(-6, 4); g.closePath(); g.fill(); g.stroke(); g.restore(); break;
      case 'bubble': g.strokeStyle = 'rgba(191,244,255,0.95)'; g.lineWidth = 2; g.fillStyle = 'rgba(111,240,255,0.25)'; g.beginPath(); g.arc(s.x, s.y, 6.5, 0, TAU); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.fillRect(s.x - 3, s.y - 3, 2, 2); break;
      case 'hand': g.save(); g.translate(s.x, s.y); g.rotate(a); g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 16, GLOW.gold, 0.6); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#ffe38a'; g.strokeStyle = PAL.ink; g.lineWidth = 1.2; g.beginPath(); g.moveTo(16, 0); g.lineTo(-10, -2.5); g.lineTo(-10, 2.5); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-10, 0, 3, 0, TAU); g.fill(); g.restore(); break;
      case 'orb': g.globalCompositeOperation = 'lighter'; drawGlow(g, s.x, s.y, 22, GLOW.blue, 0.95); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#e8f8ff'; g.beginPath(); g.arc(s.x, s.y, 7, 0, TAU); g.fill(); g.strokeStyle = '#8fd3ff'; g.lineWidth = 1.5; for (let i = 0; i < 3; i++) { const q = t * 20 + i * 2; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + Math.cos(q) * 12, s.y + Math.sin(q) * 12); g.stroke(); } break;
      case 'ice': g.save(); g.translate(s.x, s.y); g.rotate(a); g.fillStyle = '#e8fbff'; g.strokeStyle = '#6fc8ff'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(10, 0); g.lineTo(0, -4); g.lineTo(-8, 0); g.lineTo(0, 4); g.closePath(); g.fill(); g.stroke(); g.restore(); break;
      case 'starbolt': g.globalCompositeOperation = 'lighter'; drawGlow(g, s.x, s.y, 14, GLOW.purple, 0.8); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#f1e6ff'; BulletArt.star(g, s.x, s.y, 4, 6, 2.2); g.fill(); break;
      case 'wheel': case 'wheelS': {
        g.save(); g.translate(s.x, s.y); g.rotate(t * 10);
        g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, s.r * 1.8, GLOW.gold, 0.9); g.globalCompositeOperation = 'source-over';
        const gr = g.createRadialGradient(-s.r * 0.3, -s.r * 0.3, 2, 0, 0, s.r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#fff3c8'); gr.addColorStop(1, '#ffd76a');
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, s.r, 0.5, TAU - 0.5); g.arc(s.r * 0.35, 0, s.r * 0.72, TAU - 0.7, 0.7, true); g.closePath(); g.fill();
        g.strokeStyle = PAL.ink; g.lineWidth = 3; g.stroke(); g.restore(); break;
      }
      case 'candyBomb': g.save(); g.translate(s.x, s.y); g.rotate(t * 6); g.fillStyle = ['#ff9fcf', '#9fe3f0', '#ffe38a', '#c9a8ff'][(s.x | 0) % 4]; g.strokeStyle = PAL.ink; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.moveTo(9, 0); g.lineTo(15, -5); g.lineTo(15, 5); g.closePath(); g.fill(); g.stroke(); g.restore(); break;
    }
  }
  drawBeams(g) {
    const cols = ['#ff7eb6', '#ffb347', '#ffe38a', '#9ff2c8', '#6fc8ff', '#c9a8ff'];
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const b of this.beams) {
      const o = this.beamOrigin(b), a = b.a === undefined ? b.a0 : b.a, ex = o.x + Math.cos(a) * b.len, ey = o.y + Math.sin(a) * b.len, fade = Math.sin(clamp(b.t / b.dur, 0, 1) * Math.PI);
      for (let i = 0; i < cols.length; i++) {
        const off = (i - 2.5) * (b.w / 6), nx = -Math.sin(a) * off, ny = Math.cos(a) * off;
        g.strokeStyle = cols[i]; g.globalAlpha = 0.75 * fade; g.lineWidth = b.w / 6 + 1;
        g.beginPath(); g.moveTo(o.x + nx, o.y + ny); g.lineTo(ex + nx, ey + ny); g.stroke();
      }
      g.globalAlpha = 0.6 * fade; g.strokeStyle = '#ffffff'; g.lineWidth = b.w * 0.25; g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(ex, ey); g.stroke();
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  drawArcs(g) {
    g.globalCompositeOperation = 'lighter'; g.lineJoin = 'round';
    for (const a of this.arcs) {
      const k = 1 - a.t / a.life;
      g.strokeStyle = `rgba(143,211,255,${0.6 * k})`; g.lineWidth = 7; g.beginPath(); for (let i = 0; i < a.pts.length; i += 2) g.lineTo(a.pts[i], a.pts[i + 1]); g.stroke();
      g.strokeStyle = `rgba(255,255,255,${k})`; g.lineWidth = 2.2; g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    for (const r of this.rings) { const k = 1 - r.t / r.dur; g.strokeStyle = r.color; g.globalAlpha = k; g.lineWidth = 3 + 8 * k; g.beginPath(); g.arc(r.x, r.y, Math.max(1, r.r), 0, TAU); g.stroke(); g.globalAlpha = 1; }
  }
  drawWarns(g) {
    const t = this.t;
    for (const w of this.warns) {
      const u = clamp(w.t / w.tWarn, 0, 1), bright = w.t > 0.3;
      if (w.kind === 'line') {
        const ex = w.x + Math.cos(w.a) * w.len, ey = w.y + Math.sin(w.a) * w.len;
        if (!w.fired) { g.strokeStyle = bright ? `rgba(255,255,255,${0.45 + 0.4 * u})` : 'rgba(255,255,255,0.14)'; g.lineWidth = bright ? 2 + u * 2 : 1.2; g.setLineDash(bright ? [14, 8] : []); g.lineDashOffset = -t * 120; g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]); }
        if (w.fired && w.beamT > 0) { g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,248,220,0.9)'; g.lineWidth = w.w; g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(ex, ey); g.stroke(); g.strokeStyle = 'rgba(255,207,74,0.4)'; g.lineWidth = w.w * 2.4; g.stroke(); g.globalCompositeOperation = 'source-over'; }
      } else if (w.kind === 'zone' && !w.fired) {
        g.fillStyle = `rgba(255,255,255,${0.05 + (bright ? 0.1 * u : 0)})`; g.fillRect(w.x, w.y, w.w, w.h);
        g.save(); g.beginPath(); g.rect(w.x, w.y, w.w, w.h); g.clip(); g.strokeStyle = `rgba(255,255,255,${bright ? 0.25 + 0.35 * u : 0.1})`; g.lineWidth = 3;
        for (let x = w.x - w.h; x < w.x + w.w; x += 36) { const o2 = (t * 60) % 36; g.beginPath(); g.moveTo(x + o2, w.y + w.h); g.lineTo(x + o2 + w.h, w.y); g.stroke(); }
        g.restore(); g.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * u})`; g.lineWidth = 3; g.strokeRect(w.x, w.y, w.w, w.h);
      } else if (w.kind === 'arc' && !w.fired) {
        g.fillStyle = `rgba(255,255,255,${bright ? 0.06 + 0.1 * u : 0.04})`; g.beginPath(); g.moveTo(w.x, w.y); g.arc(w.x, w.y, w.len, w.a0, w.a1); g.closePath(); g.fill();
        g.strokeStyle = `rgba(255,255,255,${bright ? 0.35 + 0.4 * u : 0.12})`; g.lineWidth = 2; g.setLineDash([12, 10]); g.lineDashOffset = -t * 80; g.beginPath(); g.arc(w.x, w.y, w.len, w.a0, w.a1); g.stroke(); g.setLineDash([]);
      }
    }
  }
  drawParticles(g) {
    this.parts.each((q) => {
      const u = q.t / q.life, a = 1 - u;
      switch (q.kind) {
        case 'dot': case 'mote': g.globalCompositeOperation = 'lighter'; drawGlow(g, q.x, q.y, q.size * 3, q.color.startsWith('#') ? hexA(q.color, 0.9) : q.color, a); g.globalCompositeOperation = 'source-over'; break;
        case 'flash': g.globalCompositeOperation = 'lighter'; drawGlow(g, q.x, q.y, q.size * (0.6 + u * 0.8), q.color.startsWith('#') ? hexA(q.color, 0.95) : q.color, a); g.globalCompositeOperation = 'source-over'; break;
        case 'spark': g.strokeStyle = q.color; g.globalAlpha = a; g.lineWidth = 2; g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04); g.stroke(); g.globalAlpha = 1; break;
        case 'ring': g.strokeStyle = q.color; g.globalAlpha = a; g.lineWidth = 3 * a + 1; g.beginPath(); g.arc(q.x, q.y, Math.max(1, q.size * Ease.outCubic(u)), 0, TAU); g.stroke(); g.globalAlpha = 1; break;
        case 'petal': case 'confetti': g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.globalAlpha = a; g.fillStyle = q.color; if (q.kind === 'petal') { g.beginPath(); g.ellipse(0, 0, q.size, q.size * 0.55, 0, 0, TAU); g.fill(); } else g.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2); g.restore(); break;
        case 'shard': g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.globalAlpha = a; g.fillStyle = q.color; g.beginPath(); g.moveTo(q.size, 0); g.lineTo(-q.size * 0.6, -q.size * 0.5); g.lineTo(-q.size * 0.4, q.size * 0.5); g.closePath(); g.fill(); g.restore(); break;
        case 'puff': g.globalAlpha = a * 0.9; g.fillStyle = q.color; g.beginPath(); g.arc(q.x, q.y, q.size * (0.6 + u * 0.6), 0, TAU); g.fill(); g.globalAlpha = 1; break;
        case 'snow': g.globalAlpha = a; g.fillStyle = q.color; BulletArt.star(g, q.x, q.y, 3, q.size, q.size * 0.3); g.fill(); g.globalAlpha = 1; break;
      }
    });
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  drawTexts(g) {
    g.textAlign = 'center';
    for (const tx of this.texts.slice().sort((a, b) => a.prio - b.prio)) {
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
    if (this.timeStop > 0) {
      g.fillStyle = 'rgba(255,215,106,0.1)'; g.fillRect(0, 0, W, LH);
      g.strokeStyle = 'rgba(255,215,106,0.55)'; g.lineWidth = 4;
      for (const [cx, cy] of [[0, 0], [W, 0], [0, LH], [W, LH]]) { g.beginPath(); g.arc(cx, cy, 180, 0, TAU); g.stroke(); for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; g.beginPath(); g.moveTo(cx + Math.cos(a) * 180, cy + Math.sin(a) * 180); g.lineTo(cx + Math.cos(a) * 164, cy + Math.sin(a) * 164); g.stroke(); } }
    }
    if (this.reverseT > 0) { g.fillStyle = 'rgba(255,243,200,0.07)'; g.fillRect(0, 0, W, LH); }
    if (this.streak.n >= 30) {
      const k = Math.min(1, (this.streak.n - 30) / 70), c = this.streak.n >= 100 ? '255,215,106' : this.streak.n >= 50 ? '255,159,207' : '111,240,255';
      const gr = g.createRadialGradient(W / 2, LH / 2, LH * 0.5, W / 2, LH / 2, W * 0.7); gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(1, `rgba(${c},${0.22 + k * 0.2 + Math.sin(t * 6) * 0.04})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, LH);
    }
    const low = p.hp <= 1 && p.alive && this.mode === 'run';
    const hf = Math.max(this.hurtFlash, low ? 0.4 : 0);
    if (hf > 0) { const gr = g.createRadialGradient(W / 2, LH / 2, LH * 0.45, W / 2, LH / 2, W * 0.7); gr.addColorStop(0, 'rgba(255,122,107,0)'); gr.addColorStop(1, `rgba(255,122,107,${0.42 * hf})`); g.fillStyle = gr; g.fillRect(0, 0, W, LH); }
    if (this.bursting && this.bursting.stage === 'cut') {
      const u = clamp(this.bursting.t / 0.5, 0, 1), C = this.P.colors;
      g.save();
      g.fillStyle = `rgba(20,14,50,${0.5 * Math.sin(u * Math.PI)})`; g.fillRect(0, 0, W, LH);
      g.translate(W / 2, LH / 2); g.rotate(-0.12);
      const bandH = 190 * Math.min(1, u * 3), x = lerp(-W * 0.6, 0, Ease.outBack(Math.min(1, u * 1.6)));
      const gr = g.createLinearGradient(-W, 0, W, 0); gr.addColorStop(0, C.accent); gr.addColorStop(0.5, C.body); gr.addColorStop(1, C.accent);
      g.globalAlpha = 0.92; g.fillStyle = gr; g.fillRect(-W, -bandH / 2, W * 2, bandH);
      g.globalAlpha = 1; g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.strokeRect(-W, -bandH / 2, W * 2, bandH);
      for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-W + ((i * 173 + t * 1400) % (W * 2)), -bandH / 2 + ((i * 37) % Math.max(1, bandH)), 60, 3); }
      drawPlane(g, this.planeId, x - 120, 0, 3.4, t, { bright: true });
      g.font = '400 56px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif'; g.textAlign = 'left';
      g.lineWidth = 8; g.strokeStyle = '#2d2358'; g.strokeText(this.P.burst.name, x + 60, 20); g.fillStyle = '#ffffff'; g.fillText(this.P.burst.name, x + 60, 20);
      g.restore();
    }
    if (this.flash > 0) { g.fillStyle = `rgba(${this.flashColor},${Math.min(reduce ? 0.14 : 0.55, this.flash * 0.6)})`; g.fillRect(0, 0, W, LH); }
    if (this.state === 'victory' && this.victoryT !== undefined) {
      const s = Ease.outBack(clamp(this.victoryT / 0.6, 0, 1));
      g.save(); g.translate(W / 2, LH * 0.42); g.scale(s, s); g.rotate(Math.sin(t * 2) * 0.05);
      g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 220, GLOW.gold, 0.8); g.globalCompositeOperation = 'source-over';
      drawIcon(g, 'star', 0, 0, 200, '#ffd76a', '#2d2358');
      g.font = '400 54px "ZCOOL KuaiLe", sans-serif'; g.textAlign = 'center'; g.lineWidth = 8; g.strokeStyle = '#2d2358'; g.strokeText('清屏！', 0, 150); g.fillStyle = '#fff6c8'; g.fillText('清屏！', 0, 150);
      g.restore();
    }
    if (!o.simpleBg && !this.low) {
      g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.3;
      if (!this._pat) this._pat = g.createPattern(makePaper(), 'repeat');
      g.fillStyle = this._pat; g.fillRect(0, 0, W, LH); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    if (!this._vig || this._vigW !== W) {
      this._vigW = W; this._vig = makeCanvas(W, LH); const v = this._vig.getContext('2d');
      const gr = v.createRadialGradient(W / 2, LH / 2, LH * 0.35, W / 2, LH / 2, W * 0.72); gr.addColorStop(0, 'rgba(8,6,26,0)'); gr.addColorStop(1, 'rgba(8,6,26,0.5)');
      v.fillStyle = gr; v.fillRect(0, 0, W, LH);
    }
    g.drawImage(this._vig, 0, 0);
  }
}

function hexA(hex, a) {
  const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
