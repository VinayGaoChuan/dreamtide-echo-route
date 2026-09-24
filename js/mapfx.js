'use strict';
/* 梦潮：回声航线 v0.6 — 飞机与地图的关系。
   接近：物件发现飞机、亮起；停留：飞机的灯给物件充能；路径：尾流穿过灯环修桥；绕行：绕一圈救出伙伴；看眼睛：唤醒巨型生物。
   互动点写进航线（每个战斗段一个），奖励从物件里飞回飞机，立刻变成技能、大招或伙伴。全部只靠移动。 */

const MAP_DWELL = 2.0;   // 停留多久完成（原型 P0：2 秒）
const MAP_DRIFT = 95;    // 物件随地图漂过来的速度
const MAP_HOLD = 12;     // 被飞机感应住时的漂移速度
const COMP_SLOTS = [[-62, -48], [-62, 48], [-104, 0], [-110, -70], [-110, 70]];
function mapShuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

Object.assign(World.prototype, {
  initMap(o) {
    this.mapObjs = []; this.orbs = []; this.companions = []; this.journey = [];
    this.mapIdx = 0; this.mapCalm = false; this.lastMapSpawn = -99; this.cam = { z: 1, x: this.W / 2, y: LH / 2 };
    this.seenMap = new Set(o.seenMap || []); this.mapHintKind = null;
    this.nextRare = false; this.rareNext = false; this.laneT = 0; this.minerKills = 0; this.grandpaT = 0; this.bridgeBonus = false;
    Object.assign(this.m, { interacts: 0, interactFails: 0, interactMax: 0, firstInteract: null, rescues: 0, giants: 0 });
    // 首局就是第一章：梦灯屋 → 断桥 → 星砂矿 → 伙伴 → 睡鲸 → Boss 门；之后每局打乱中段
    this.mapPlan = this.first ? ['house', 'bridge', 'mine', 'npc', 'giant']
      : ['house', ...mapShuffle(['bridge', 'mine', 'npc']), 'giant', ...mapShuffle(['house', 'mine', 'bridge', 'npc'])];
  },

  /* ---------- 航线安排：每段一个互动点，间隔不少于 33 秒 ---------- */
  scheduleMap(S) {
    S.mapAt = this.mode === 'run' && this.mapIdx < this.mapPlan.length ? (this.segIdx === 1 ? (this.first ? 13 : 9) : S.dur * 0.28) : -1;
    if (this.bridgeBonus) { this.bridgeBonus = false; S.calmT = 10; }
  },
  tickMapSchedule(S) {
    if (S.mapAt < 0 || S.t < S.mapAt) return;
    if (this.runT - this.lastMapSpawn < 33 || this.mapObjs.some((o) => o.state === 'idle')) { S.mapAt = S.t + 1.5; if (S.over) S.mapAt = -1; return; }
    S.mapAt = -1;
    this.spawnMapObject(this.mapPlan[this.mapIdx++]);
  },
  spawnMapObject(kind) {
    const W = this.W, top = this.arena.top, bot = this.arena.bottom, mid = (top + bot) / 2;
    const o = { kind, id: _eid++, t: 0, state: 'idle', phase: 'in', x: W + 200, y: mid, near: 0, charge: 0, alpha: 0, engageT: null, wait: 8, station: W * 0.62, senseR: 170, seed: rand(10), open: 0, turn: 0 };
    const moon = this.planeId === 'moon';
    switch (kind) {
      case 'house': o.y = rand(mid - 30, mid + 90); o.dwellR = 140; o.offY = -40; break;
      case 'mine': o.y = rand(mid - 110, mid + 110); o.r = 62; o.dwellR = 140; o.offY = 0; o.x = W + 120; break;
      case 'npc': o.sub = this.pickNpc(); o.y = rand(mid - 90, mid + 90); o.station = W * 0.55; o.wait = 10; o.trapR = 46; o.senseR = 250; o.orbit = 0; o.lastA = null; o.offY = 0; o.x = W + 80; break;
      case 'giant': {
        o.sub = this.first ? 'whale' : pick(GIANT_ORDER);
        o.s = o.sub === 'moonbunny' ? 0.85 : 0.95;
        o.y = o.sub === 'deer' ? bot - 110 : o.sub === 'moonbunny' ? mid : o.sub === 'whale' ? bot - 130 : bot - 90;
        const ex = GIANT_EYE[o.sub][0] * o.s; o.station = W * 0.6 - ex; o.x = W + 320; o.wait = 8; o.senseR = 200; o.eye = 0; o.act = 0; o.mouth = 0;
        break;
      }
      case 'bridge': {
        const ys = pick([[-1, 1, -0.2], [1, -1, 0.3], [-0.2, 1, -1], [0.8, -0.3, -1]]).map((k) => clamp(mid + k * (bot - top) * 0.3, top + 70, bot - 70));
        const x0 = W + 180, gap = 250;
        o.rings = ys.map((y, i) => ({ x: x0 + i * gap, y, r: 40, lit: false, near: 0 }));
        o.p1 = { x: x0 - 190, y: mid + 40 }; o.p2 = { x: x0 + 2 * gap + 190, y: mid + 20 }; o.lit = []; o.built = 0; o.v = 125;
        break;
      }
    }
    if (moon) o.senseR *= 1.35;
    this.lastMapSpawn = this.runT;
    this.mapObjs.push(o);
  },
  pickNpc() {
    const have = new Set(this.companions.map((c) => c.id)), pool = NPC_ORDER.filter((id) => !have.has(id)), p = this.player;
    const pref = [];
    if (p.hp <= p.maxHp / 2) pref.push('grandpa');
    if (this.lvOf('wing')) pref.push('clockling');
    if (this.lvOf('magnet')) pref.push('miner');
    if (this.skills.length >= 2) pref.push('merchant');
    pref.push('bunny');
    for (const id of pref) if (pool.includes(id)) return id;
    return pool.length ? pick(pool) : pick(NPC_ORDER);
  },
  mapCenter(o) {
    if (o.kind === 'giant') { const e = GIANT_EYE[o.sub]; return { x: o.x + e[0] * o.s, y: o.y + e[1] * o.s }; }
    if (o.kind === 'bridge') { const r = o.rings.find((q) => !q.lit) || o.rings[2]; return { x: r.x, y: r.y }; }
    return { x: o.x, y: o.y + (o.offY || 0) + Math.sin(o.t * 1.3) * 5 };
  },

  /* ---------- 每帧 ---------- */
  updateMap(dt) {
    if (this.mode !== 'run') return;
    const p = this.player;
    this.mapCalm = false; let focus = null;
    for (const o of this.mapObjs) {
      if (this.state === 'play') this.updateMapObj(o, dt);
      if (o.state === 'idle' && (o.engaged || (o.kind === 'bridge' && o.rings[0].x < this.W))) { this.mapCalm = true; if (o.engaged && o.kind !== 'bridge') focus = o; }
    }
    this.mapObjs = this.mapObjs.filter((o) => !o.gone);
    this.updateOrbs(dt);
    this.updateCompanions(dt);
    const c = focus ? this.mapCenter(focus) : null;
    this.cam.z = smooth(this.cam.z, focus && !this.bursting ? 1.05 : 1, 3, dt);
    if (c) { this.cam.x = smooth(this.cam.x, (p.x + c.x) / 2, 3, dt); this.cam.y = smooth(this.cam.y, (p.y + c.y) / 2, 3, dt); }
    // 云龟的安全航道 / 云朵号的云垫：靠近飞机的敌弹散成星尘
    const lane = this.laneT > 0 ? 125 : this.planeId === 'cloud' && focus ? 95 : 0;
    if (this.laneT > 0) this.laneT -= dt;
    if (lane && p.alive) this.bullets.each((b) => { if (dist2(b.x, b.y, p.x, p.y) < lane * lane) { b.on = false; this.part('puff', b.x, b.y, rand(-40, 40), rand(-40, 40), 0.5, 7, 'rgba(255,255,255,0.8)'); if (Math.random() < 0.3) this.dropPickup('dust', b.x, b.y, { value: 1, attract: true }); } });
  },
  updateMapObj(o, dt) {
    const p = this.player, M = MAP_OBJECTS[o.kind];
    o.t += dt; o.alpha = Math.min(1, o.alpha + dt * 2);
    if (o.kind === 'bridge') return this.updateBridge(o, dt);
    // 漂进来 → 停在站位等一会儿 → 漂走；被飞机感应住就几乎不动
    if (o.phase === 'in') { o.x -= MAP_DRIFT * dt * (o.engaged && o.x < this.W * 0.72 ? 0.2 : 1); if (o.x <= o.station) o.phase = 'wait'; }
    else if (o.phase === 'wait') { o.x -= MAP_HOLD * dt; if (!o.engaged) o.wait -= dt; if (o.wait <= 0 && o.state === 'idle') o.phase = 'out'; }
    else if (o.phase === 'linger') { o.linger -= dt; if (o.linger <= 0) o.phase = 'out'; }
    else { o.x -= (o.leaveV || MAP_DRIFT * 1.6) * dt; if (o.kind === 'giant' && o.state === 'done') o.y -= 30 * dt; if (o.x < -420) { o.gone = true; if (o.state === 'idle') this.mapMissed(o); } }
    if (o.state === 'done') { this.updateMapDone(o, dt); return; }
    if (o.state !== 'idle') return;
    const c = this.mapCenter(o), d = Math.sqrt(dist2(p.x, p.y, c.x, c.y));
    const wasNear = o.near > 0.5;
    o.engaged = p.alive && d < o.senseR;
    o.near = approach(o.near, o.engaged ? 1 : 0, dt * 3);
    if (!wasNear && o.near > 0.5) Sound.sfx('mapNear', { pan: this.pan(c.x) });
    if (o.x < this.W - 60 && !this.seenMap.has(o.kind)) { this.seenMap.add(o.kind); this.mapHintKind = o.kind; this.emit('maphint', { kind: o.kind }); }
    o.turn = clamp((p.y - c.y) / 200, -1, 1); o.look = clamp((p.x - c.x) / 200, -1, 1);
    const paper = this.planeId === 'paper', moon = this.planeId === 'moon';
    if (o.kind === 'house' || o.kind === 'mine') {
      const inside = o.engaged && d < o.dwellR * (moon ? 1.3 : 1) * (paper ? 1.2 : 1);
      if (inside) {
        if (o.engageT === null) o.engageT = this.runT;
        o.charge += dt / (MAP_DWELL * (moon ? 0.7 : 1));
        o.tick = (o.tick || 0) - dt; if (o.tick <= 0) { o.tick = 0.22; Sound.sfx('mapCharge', { k: o.charge, pan: this.pan(c.x) }); }
        if (Math.random() < 0.5) this.part('mote', p.x + rand(-10, 10), p.y + rand(-10, 10), (c.x - p.x) * 2, (c.y - p.y) * 2, 0.45, 3, M.color);
      } else if (!paper) o.charge = Math.max(0, o.charge - dt * 0.5);
      if (o.kind === 'mine') o.crackA = Math.atan2(p.y - c.y, p.x - c.x);
      if (o.kind === 'mine' && this.planeId === 'whale' && o.engaged) { o.suck = (o.suck || 0) - dt; if (o.suck <= 0) { o.suck = 0.1; this.dropPickup('dust', c.x + rand(-50, 50), c.y + rand(-50, 50), { value: 1, attract: true }); } }
      if (o.charge >= 1) this.completeMap(o);
    } else if (o.kind === 'npc') {
      if (o.engaged && d > 40) {
        const a = Math.atan2(p.y - c.y, p.x - c.x);
        if (o.lastA !== null) o.orbit += angDiff(o.lastA, a);
        o.lastA = a;
        if (o.engageT === null && Math.abs(o.orbit) > 0.3) o.engageT = this.runT;
        o.tick = (o.tick || 0) - dt; if (o.tick <= 0 && Math.abs(o.orbit) > 0.2) { o.tick = 0.3; Sound.sfx('mapCharge', { k: Math.abs(o.orbit) / TAU, pan: this.pan(c.x) }); }
      } else { o.lastA = null; if (!paper) o.orbit *= 1 - dt * 0.4; }
      o.charge = Math.min(1, Math.abs(o.orbit) / (TAU * 0.92));
      if (o.charge >= 1) this.completeMap(o);
    } else if (o.kind === 'giant') {
      if (o.engaged && d < 105 * (moon ? 1.3 : 1)) { if (o.engageT === null) o.engageT = this.runT; o.charge += dt / 0.7; }
      else if (!paper) o.charge = Math.max(0, o.charge - dt * 0.6);
      o.eye = o.charge * 0.25;
      if (o.charge >= 1) this.completeMap(o);
    }
  },
  updateBridge(o, dt) {
    const p = this.player, paper = this.planeId === 'paper';
    for (const q of [o.p1, o.p2, ...o.rings]) q.x -= o.v * dt;
    if (o.state === 'idle') {
      if (o.rings[0].x < this.W - 40 && !this.seenMap.has('bridge')) { this.seenMap.add('bridge'); this.mapHintKind = 'bridge'; this.emit('maphint', { kind: 'bridge' }); }
      o.engaged = false;
      o.rings.forEach((q, i) => {
        const d = Math.sqrt(dist2(p.x, p.y, q.x, q.y));
        q.near = approach(q.near, d < 220 && !q.lit ? 1 : 0, dt * 3);
        if (!q.lit && p.alive && d < q.r + (paper ? 26 : 8)) {
          q.lit = true; o.lit.push(i); if (o.engageT === null) o.engageT = this.runT;
          Sound.sfx('ringPass', { k: o.lit.length - 1 }); this.fx(q.x, q.y, 2, 70, ['#ffd76a', '#fff6c8', '#9fe3f0']); this.addCharge(0.03);
          this.text(['一', '二', '三'][o.lit.length - 1] + '！', q.x, q.y - 56, '#ffe38a', 22, 4);
        }
      });
      if (o.lit.length === o.rings.length) this.completeMap(o);
      else if (o.rings.some((q) => !q.lit && q.x < 30)) this.failMap(o, '断桥没有接上 · 继续飞');
    } else if (o.state === 'done') { o.built = Math.min(1, o.built + dt * 1.25); this.updateMapDone(o, dt); }
    if (o.p2.x < -260) { o.gone = true; }
  },

  /* ---------- 完成 / 错过 ---------- */
  completeMap(o) {
    const M = MAP_OBJECTS[o.kind], p = this.player, c = this.mapCenter(o);
    o.state = 'done'; o.doneT = 0; o.phase = o.kind === 'bridge' ? 'out' : 'linger'; o.linger = o.kind === 'house' ? 2.4 : 1.4; o.engaged = false;
    const dur = o.engageT !== null ? this.runT - o.engageT : 0;
    this.m.interacts++; this.m.interactMax = Math.max(this.m.interactMax, dur);
    if (this.m.firstInteract === null) this.m.firstInteract = this.runT;
    this.highlight(); this.shake(0.25);
    Sound.sfx(o.kind === 'bridge' ? 'bridge' : o.kind === 'npc' ? 'rescue' : o.kind === 'giant' ? 'giantWake' : 'mapDone');
    this.fx(c.x, c.y, 3, o.kind === 'giant' ? 260 : 160, [M.color, '#ffffff', '#ffe38a']);
    let name = M.name, reward = M.tag;
    switch (o.kind) {
      case 'house': o.pick = this.houseReward(); o.spin = 0; o.wheelRot = 0; reward = HOUSE_REWARDS[o.pick].label; Sound.sfx('spin'); break;
      case 'mine': this.mineBurst(o, c); break;
      case 'bridge': this.bridgeDone(o); break;
      case 'npc': name = NPCS[o.sub].name; this.rescue(o, c); break;
      case 'giant': name = GIANTS[o.sub].name; o.leaveV = 150; this.m.giants++; this.later(0.55, () => this.giantAct(o)); break;
    }
    // 飞机专属地图反应
    if (this.planeId === 'candy') { for (let i = 0; i < 8; i++) this.addShot('candyBomb', c.x + rand(-260, 260), TOP - 10 - i * 20, Math.PI / 2, rand(420, 560), { dmg: 40 * this.stats.dmgK, r: 10, life: 3, ty: rand(this.arena.top + 60, this.arena.bottom - 60) }); p.candy = Math.max(p.candy, 5); this.text('糖果爆炸！', c.x, c.y - 90, '#ff9fcf', 20, 4); }
    if (this.planeId === 'clock' && !this.bursting) { this.timeStop = Math.max(this.timeStop, 1.2); this.text('时间停了一下', p.x, p.y - 50, '#ffd76a', 18, 4); }
    const desc = o.kind === 'house' ? HOUSE_REWARDS[o.pick].desc : o.kind === 'bridge' ? '跳过一波小怪 · 送出技能二选一' : o.kind === 'mine' ? '大招 +1 · 天赋点 +1 · 下次洞口有稀有洞' : o.kind === 'npc' ? NPCS[o.sub].effect : GIANTS[o.sub].effect;
    const entry = { kind: o.kind, sub: o.sub || null, verb: M.verb, name, reward, desc };
    this.journey.push(entry);
    this.emit('mapDone', entry);
    if (this.mapHintKind === o.kind) { this.mapHintKind = null; this.emit('maphint', { kind: null }); }
    if (this.cb.onMap) this.cb.onMap(o.kind, o.sub);
  },
  failMap(o, text) {
    o.state = 'failed'; o.phase = 'out'; o.engaged = false; this.m.interactFails++;
    this.emit('flag', { text, dur: 1.2 });
    if (this.mapHintKind === o.kind) { this.mapHintKind = null; this.emit('maphint', { kind: null }); }
  },
  mapMissed(o) { this.m.interactFails++; if (this.mapHintKind === o.kind) { this.mapHintKind = null; this.emit('maphint', { kind: null }); } },
  updateMapDone(o, dt) {
    o.doneT += dt; o.open = Math.min(1, o.open + dt * 2.5);
    if (o.kind === 'house') {
      // 转盘减速停在奖励上，然后奖励从屋里飞出来
      const idx = HOUSE_WHEEL.indexOf(o.pick), target = TAU * 3 - (idx / HOUSE_WHEEL.length) * TAU;
      const u = clamp(o.doneT / 1.1, 0, 1); o.wheelRot = target * Ease.outCubic(u);
      if (u >= 1 && !o.launched) { o.launched = true; Sound.sfx('reveal', { r: 'R' }); const R = HOUSE_REWARDS[o.pick]; this.launchOrb(o.x, o.y - 170, R.icon, R.color, R.desc, () => this.applyHouse(o.pick)); }
    }
    if (o.kind === 'giant') { o.eye = Math.min(1, o.eye + dt * 3); }
  },

  /* ---------- 奖励：从物件飞回飞机 ---------- */
  launchOrb(x, y, icon, color, label, apply) { this.orbs.push({ sx: x, sy: y, x, y, t: 0, dur: 0.7, icon, color, label, apply }); },
  updateOrbs(dt) {
    const p = this.player;
    for (const b of this.orbs) {
      b.t += dt; const u = Math.min(1, b.t / b.dur), k = Ease.inOutCubic ? Ease.inOutCubic(u) : u * u * (3 - 2 * u);
      const cx = (b.sx + p.x) / 2, cy = Math.min(b.sy, p.y) - 150;
      b.x = (1 - k) * (1 - k) * b.sx + 2 * (1 - k) * k * cx + k * k * p.x; b.y = (1 - k) * (1 - k) * b.sy + 2 * (1 - k) * k * cy + k * k * p.y;
      if (Math.random() < 0.8) this.part('mote', b.x, b.y, rand(-40, 40), rand(-40, 40), 0.4, 3.5, b.color);
      if (u >= 1 && !b.done) { b.done = true; b.apply(); this.fx(p.x, p.y, 2, 80, [b.color, '#ffffff', '#ffe38a']); Sound.sfx('crystal'); this.text(b.label, p.x, p.y - 52, b.color, 20, 5); }
    }
    this.orbs = this.orbs.filter((b) => !b.done);
  },
  houseReward() {
    const p = this.player;
    if (this.first && !this.journey.some((j) => j.kind === 'house')) return 'choice';
    const w = { burst: p.burst < 0.6 ? 3 : 0.8, choice: this.skills.length < 3 ? 3 : 1.2, power: this.skills.length ? 2 : 0.3, shield: p.cloudShield ? 0.2 : p.hp < p.maxHp ? 2.5 : 0.8, magnet: this.houseMagnet ? 0.2 : 1.1 };
    let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
    for (const k of HOUSE_WHEEL) { r -= w[k]; if (r <= 0) return k; }
    return 'choice';
  },
  /* 按当前 Build 挑技能：缺范围给爆破 / 彩虹，有雷球没分身给分身（雷暴分身） */
  buildPrefer() {
    const has = (id) => this.lvOf(id) > 0;
    if (this.skills.length >= 3) return null;
    if (!has('bomb') && !has('rainbow') && this.skills.length) return pick(['bomb', 'rainbow']);
    if (has('thunder') && !has('wing')) return 'wing';
    return null;
  },
  applyHouse(id) {
    const p = this.player;
    switch (id) {
      case 'burst': if (p.burst >= 1) this.m.dust += 30; this.addCharge(1); break;
      case 'choice': this.spawnCrystalDrop(Math.min(this.W - 120, p.x + 300), clamp(p.y, this.arena.top + 130, this.arena.bottom - 130), { choice: true, prefer: this.buildPrefer() }); break;
      case 'power': this.powerSkill(); break;
      case 'shield': p.cloudShield = true; break;
      case 'magnet': this.stats.magnetK *= 1.35; this.houseMagnet = true; break;
    }
  },
  /* 当前最高级技能放一次强化版 */
  powerSkill() {
    const p = this.player, top = this.skills.slice().sort((a, b) => b.lv - a.lv)[0], dK = this.stats.dmgK;
    const id = top ? top.id : null, lv = top ? top.lv : 1;
    this.shake(0.4); this.flash = Math.max(this.flash, 0.3); this.flashColor = '255,243,200';
    if (id === 'thunder') { const hit = new Set(); for (let i = 0; i < 12; i++) { const e = this.nearestEnemy(rand(this.W * 0.3, this.W), rand(TOP, BOTTOM), 2000, hit); if (!e) break; hit.add(e.id); this.arc(e.x + rand(-30, 30), -20, e.x, e.y, '#dff4ff'); this.damageEnemy(e, 60 + 15 * lv, { kind: 'zap', x: e.x, y: e.y }); } Sound.sfx('zap'); }
    else if (id === 'wing') { for (let i = 0; i < 5; i++) this.addClone(6, true); }
    else if (id === 'bomb') { for (const e of this.enemies) if (e.alive && !e.isBoss && e.x < this.W) { e.mark = true; this.later(rand(0.05, 0.4), () => this.explode(e.x, e.y, 90 * this.stats.blastK, 40 * dK, { level: 2 })); } }
    else if (id === 'magnet') { this.magnetPulse(); for (const k of this.pickups) if (k.kind !== 'crystal') k.attract = true; this.ring(p.x, p.y, 0, 500, 0.6, 40 * dK, 'rgba(201,168,255,0.9)'); }
    else if (id === 'rainbow') { this.ring(p.x, p.y, 0, 800, 0.8, (60 + 10 * lv) * dK, 'rgba(255,159,207,0.95)', { clear: true }); Sound.sfx('beam'); }
    else if (id === 'ice') { for (const e of this.enemies) if (e.alive && !e.isBoss) this.freezeEnemy(e, 3); this.later(0.5, () => { for (const e of this.enemies) if (e.alive && !e.isBoss && e.x < this.W) this.shatter(e.x, e.y, 70, 50 * dK); }); }
    else this.explode(p.x + 200, p.y, 260 * this.stats.blastK, 80 * dK, { level: 3, fireworks: true });
  },
  mineBurst(o, c) {
    const p = this.player, whale = this.planeId === 'whale';
    this.explode(c.x, c.y, 360 * this.stats.blastK, 120 * this.stats.dmgK, { level: 3, fireworks: true });
    this.fx(c.x, c.y, 4, 420, ['#c9a8ff', '#6ff0ff', '#ffe38a']); this.clearBullets(true);
    for (let i = 0; i < 16; i++) this.part('shard', c.x, c.y, rand(-500, 500), rand(-500, 200), 1, rand(8, 14), pick(['#8f82d6', '#b3a6ef', '#6ff0ff']));
    for (let i = 0; i < (whale ? 70 : 36); i++) this.dropPickup('dust', c.x + rand(-40, 40), c.y + rand(-40, 40), { value: 1, vx: rand(-300, 300), vy: rand(-380, -60), big: i % 6 === 0 });
    this.later(0.35, () => { for (const k of this.pickups) if (k.kind === 'dust') k.attract = true; });
    this.launchOrb(c.x, c.y, 'charge', '#ffd76a', '大招 +1', () => { if (p.burst >= 1) this.m.dust += 30; this.addCharge(1); });
    this.later(0.25, () => this.launchOrb(c.x, c.y, 'star', '#9ff2c8', '天赋点 +1', () => { this.m.talent++; }));
    this.nextRare = true;
  },
  bridgeDone(o) {
    let i = 0;
    for (const e of this.enemies) if (e.alive && !e.isBoss && !e.elite && e.x < this.W + 20) { const t = e; this.later(0.03 * i++, () => { if (t.alive) this.killEnemy(t, {}); }); }
    this.clearBullets(true);
    this.bridgeBonus = true;
    const mid = (this.arena.top + this.arena.bottom) / 2, last = o.rings[o.rings.length - 1];
    this.launchOrb(last.x, last.y, 'star', '#6ff0ff', '技能二选一', () => this.spawnCrystalDrop(Math.min(this.W - 120, this.player.x + 300), mid, { choice: true, prefer: this.buildPrefer() }));
  },
  rescue(o, c) {
    const id = o.sub, p = this.player;
    for (let i = 0; i < 18; i++) this.part(i % 2 ? 'puff' : 'confetti', c.x, c.y, rand(-300, 300), rand(-300, 200), 0.8, rand(6, 10), i % 2 ? 'rgba(220,250,255,0.9)' : pick(['#ff9fcf', '#ffe38a', '#9fe3f0']));
    this.companions.push({ id, x: c.x, y: c.y, t: 0, fireT: 0.6, mood: 'happy', moodT: 2, idx: this.companions.length });
    this.m.rescues++;
    this.emit('companion', { id });
    // 救出的那一刻就帮上忙
    if (id === 'grandpa') p.cloudShield = true;
    if (id === 'clockling') this.addCharge(0.3);
    if (id === 'bunny') for (const k of this.pickups) if (k.kind !== 'crystal') k.attract = true;
    if (id === 'miner') for (let i = 0; i < 12; i++) this.dropPickup('dust', c.x, c.y, { value: 1, attract: true });
    if (id === 'merchant') this.explode(c.x, c.y, 140 * this.stats.blastK, 40 * this.stats.dmgK, { level: 2, fireworks: true });
  },
  giantAct(o) {
    const p = this.player, dK = this.stats.dmgK;
    o.act = 1;
    this.shake(0.6); this.flash = Math.max(this.flash, 0.35); this.flashColor = '220,250,255';
    switch (o.sub) {
      case 'whale': {
        o.mouth = 1; const mx = o.x - 200 * o.s, my = o.y + 24 * o.s;
        for (const e of this.enemies) if (e.alive && !e.isBoss && !e.elite && e.x < this.W + 20) { e.pull = { x: mx, y: my, v: 700 }; const t = e; this.later(0.75, () => { if (t.alive) this.killEnemy(t, {}); }); }
        this.bullets.each((b) => { this.part('mote', b.x, b.y, (mx - b.x) * 2, (my - b.y) * 2, 0.5, 3, 'rgba(200,250,255,0.9)'); b.on = false; });
        for (let i = 0; i < 30; i++) this.part('mote', rand(0, this.W), rand(TOP, BOTTOM), (mx - this.W / 2) * 1.5, 0, 0.7, 3, 'rgba(200,250,255,0.8)');
        this.later(0.9, () => { o.mouth = 0; for (let i = 0; i < 24; i++) this.dropPickup('dust', mx, my, { value: 1, attract: true, vx: rand(100, 400), vy: rand(-200, 200) }); });
        break;
      }
      case 'turtle': this.clearBullets(true); this.laneT = 7; break;
      case 'deer': {
        for (let i = 0; i < 50; i++) this.part('petal', rand(this.W * 0.2, this.W), rand(TOP - 40, TOP + 80), rand(-160, 40), rand(60, 260), 2.2, rand(6, 10), pick(['#ff9fcf', '#ffe38a', '#9fe3f0', '#c9a8ff']));
        const low = this.skills.filter((s) => s.lv < 5).sort((a, b) => a.lv - b.lv)[0];
        this.launchOrb(o.x - 120 * o.s, o.y - 190 * o.s, 'star', '#ff9fcf', low ? '花瓣强化' : '技能二选一', () => { if (low) this.gainSkill(low.id, 1); else this.spawnCrystalDrop(Math.min(this.W - 120, p.x + 300), p.y, { choice: true }); p.candy = Math.max(p.candy, 8); });
        break;
      }
      case 'moonbunny': this.rareNext = true; this.nextRare = true; this.addCharge(0.5); break;
    }
  },

  /* ---------- 伙伴 ---------- */
  updateCompanions(dt) {
    const p = this.player; if (!this.companions.length) return;
    const bossIntro = this.phase === 'boss' && this.bossIntroT > 0;
    this.companions.forEach((c, i) => {
      c.t += dt; c.moodT -= dt;
      const slot = COMP_SLOTS[i % COMP_SLOTS.length];
      let tx = p.x + slot[0], ty = p.y + slot[1];
      if (bossIntro) { tx = p.x - 30 - i * 10; ty = p.y + (i % 2 ? 16 : -16); c.mood = 'scared'; c.moodT = 0.3; }
      if (c.id === 'bunny' && !bossIntro) { const k = this.pickups.find((q) => (q.kind === 'chest' || q.kind === 'heart' || q.kind === 'candy' || q.kind === 'gold' || q.bunny) && q.x < this.W - 30); if (k) { tx = lerp(tx, k.x, 0.6); ty = lerp(ty, k.y, 0.6); } }
      c.x = smooth(c.x, clamp(tx, 20, this.W - 20), 5, dt); c.y = smooth(c.y, clamp(ty, TOP, BOTTOM), 5, dt);
      if (c.moodT <= 0) { const r = Math.random(); c.mood = r < 0.25 ? 'wave' : r < 0.4 && this.phase !== 'boss' ? 'sleep' : 'idle'; c.moodT = c.mood === 'sleep' ? 2.2 : c.mood === 'wave' ? 1.2 : rand(3, 6); }
      if (this.state === 'play' && p.alive) {
        c.fireT -= dt;
        if (c.fireT <= 0) { c.fireT = 0.75; const e = this.nearestEnemy(c.x, c.y, 760); if (e && e.x > c.x - 40) { this.addShot('starbolt', c.x + 10, c.y, angTo(c.x, c.y, e.x, e.y), 720, { dmg: 7 * this.stats.dmgK, r: 6, homing: 5, life: 1.3, from: 'npc' }); if (c.mood === 'sleep') c.moodT = 0; } }
      }
    });
    const has = (id) => this.companions.some((c) => c.id === id);
    if (has('grandpa') && !p.cloudShield && p.alive) { this.grandpaT -= dt; if (this.grandpaT <= 0) { p.cloudShield = true; this.grandpaT = 15; this.text('云朵爷爷铺了一层云', p.x, p.y - 50, '#dff2ff', 15, 3); } }
    if (has('bunny')) for (const k of this.pickups) {
      if (k.x > this.W - 30 || k.fade !== undefined) continue;
      if (k.kind === 'chest' || k.kind === 'heart' || k.kind === 'candy' || k.kind === 'gold') k.attract = true;
      else if (k.kind === 'crystal' && !k.bunny && !this.pickups.some((q) => q !== k && q.kind === 'crystal' && q.pair === k.pair && q.fade === undefined)) { k.bunny = true; k.attract = true; }
    }
  },
  onCompanionKill(e) {
    if (!this.companions.length || e.fodder) return;
    if (this.companions.some((c) => c.id === 'miner')) {
      this.minerKills++;
      if (this.minerKills % 8 === 0) { for (let i = 0; i < 4; i++) this.dropPickup('dust', e.x, e.y, { value: 1, big: i === 0, attract: true }); this.addCharge(0.03); }
    }
  },
  onCompanionSkill() {
    if (!this.companions.some((c) => c.id === 'merchant')) return;
    const p = this.player;
    this.later(0.15, () => { this.explode(p.x + 110, p.y, 120 * this.stats.blastK, 36 * this.stats.dmgK, { level: 2, fireworks: true }); this.dropPickup('candy', p.x + 160, p.y); this.text('糖果爆炸', p.x + 110, p.y - 60, '#ff9fcf', 16, 3); });
  },
  /* Boss 门：进入 Boss 时补满大招；伙伴各帮一次忙 */
  onMapBoss() {
    const p = this.player;
    for (const o of this.mapObjs) if (o.state === 'idle') { o.state = 'failed'; o.phase = 'out'; o.leaveV = 600; }
    if (this.mapHintKind) { this.mapHintKind = null; this.emit('maphint', { kind: null }); }
    for (const b of this.orbs) if (!b.done) { b.done = true; b.apply(); }
    this.orbs = [];
    const before = p.burst; p.burst = 1; if (before < 1) this.emit('burstReady');
    this.text('Boss 门 · 大招补满', p.x, p.y - 60, '#ffd76a', 20, 5);
    if (this.companions.length) this.later(1.2, () => { for (const c of this.companions) { this.fx(c.x, c.y, 2, 50, [NPCS[c.id].color, '#ffffff']); } this.text('伙伴助力！', p.x, p.y + 60, '#ff9fcf', 18, 4); this.m.dust += 10 * this.companions.length; });
  },
  onCompanionBossPhase() {
    if (!this.companions.some((c) => c.id === 'clockling')) return;
    const p = this.player, before = p.burst; p.burst = 1; if (before < 1) this.emit('burstReady');
    this.text('小闹钟：准点补满大招', p.x, p.y - 64, '#ffd76a', 16, 4);
  },

  /* ---------- 画 ---------- */
  applyCam(g) { if (this.cam && this.cam.z > 1.001) { g.translate(this.cam.x, this.cam.y); g.scale(this.cam.z, this.cam.z); g.translate(-this.cam.x, -this.cam.y); } },
  drawMap(g) {
    const t = this.t, p = this.player, moon = this.planeId === 'moon';
    for (const o of this.mapObjs) {
      const M = MAP_OBJECTS[o.kind], idle = o.state === 'idle', c = this.mapCenter(o);
      g.save(); g.globalAlpha = o.alpha * (o.state === 'failed' ? 0.6 : 1);
      // 第一层：远处的彩色发光点，让玩家发现
      if (idle && o.near < 0.2) glowAt(g, c.x, c.y, 90 + Math.sin(t * 4) * 12, hexA(M.color, 0.8), 0.5);
      switch (o.kind) {
        case 'house':
          drawLampHouse(g, o.x, o.y, { lit: Math.max(o.charge, moon && idle ? 0.35 : 0), done: o.state === 'done', open: o.open, turn: o.turn * o.near, look: o.look }, t);
          if (o.state === 'done') drawHouseWheel(g, o.x, o.y - 175, 46, o.wheelRot || 0, t, clamp(o.doneT * 3, 0, 1) * clamp(o.linger * 2, 0, 1), o.launched ? o.pick : null);
          break;
        case 'mine': if (o.state !== 'done') drawMine(g, c.x, o.y, { r: o.r, charge: o.charge, crackA: o.crackA || Math.PI, seed: o.seed, shake: o.charge > 0.05 }, t); break;
        case 'npc':
          if (o.state !== 'done') { drawTrap(g, NPCS[o.sub].trap, c.x, c.y, o.trapR, t, o.charge); drawNPC(g, o.sub, c.x, c.y + 2, 1.3, t, o.near > 0.5 ? (o.charge > 0.5 ? 'happy' : 'idle') : 'sleep'); }
          if (idle && o.near > 0.1) { g.globalAlpha = o.alpha * o.near; drawOrbitGuide(g, c.x, c.y, 118, t, o.charge, M.color); }
          break;
        case 'giant': drawGiant(g, o.x, o.y + Math.sin(t * 0.8) * 8, o.s, { kind: o.sub, eye: o.eye, act: o.act, mouth: o.mouth }, t); break;
        case 'bridge': {
          drawPier(g, o.p1.x, o.p1.y, 1, t, o.lit.length > 0 || o.state === 'done');
          drawPier(g, o.p2.x, o.p2.y, -1, t, o.state === 'done');
          const pts = [{ x: o.p1.x + 60, y: o.p1.y - 8 }, ...o.rings.map((q) => ({ x: q.x, y: q.y })), { x: o.p2.x - 60, y: o.p2.y - 8 }];
          if (o.state === 'done') drawBridgeDeck(g, pts, o.built, t);
          else if (o.lit.length) { // 尾流把点亮的灯环连起来
            g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(159,227,240,0.85)'; g.lineWidth = 6; g.lineCap = 'round'; g.setLineDash([2, 12]); g.lineDashOffset = -t * 60;
            g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (const i of o.lit) g.lineTo(o.rings[i].x, o.rings[i].y); if (idle && p.alive) g.lineTo(p.x, p.y); g.stroke(); g.restore();
          }
          for (const q of o.rings) drawLampRing(g, q.x, q.y, q.r, t, q.lit, q.near);
          break;
        }
      }
      // 第二层：感应环 + 指向箭头；第三层：充能圈
      if (idle) {
        if (o.kind === 'house' || o.kind === 'mine' || o.kind === 'giant') {
          const rr = o.kind === 'giant' ? 60 : o.kind === 'house' ? 108 : 96;
          drawSenseRing(g, c.x, c.y, rr, t, 0.25 + o.near * 0.6 + (moon ? 0.2 : 0), M.color);
          drawChargeRing(g, c.x, c.y, rr, o.charge, M.color, t);
        }
        const tagY = o.kind === 'house' ? o.y - 150 : o.kind === 'giant' ? c.y : o.kind === 'bridge' ? o.rings[0].y - 70 : c.y - 90;
        const tagX = o.kind === 'bridge' ? o.rings[0].x : o.kind === 'giant' ? c.x - 120 : c.x;
        if (!(o.kind === 'bridge' && o.lit.length)) drawMapTag(g, tagX, tagY, M.icon, M.tag, M.color, o.alpha * (0.7 + 0.3 * Math.sin(t * 4)));
        if (o.near > 0.2 && p.alive && o.charge < 0.99) drawPointer(g, p.x, p.y, c.x, c.y, M.color, t);
      }
      g.restore();
    }
  },
  drawMapFront(g) {
    const t = this.t, p = this.player;
    if (this.laneT > 0 && p.alive) { // 云龟的安全航道：飞机周围一圈云
      const a = Math.min(1, this.laneT) * 0.8;
      glowAt(g, p.x, p.y, 150, 'rgba(220,240,255,0.6)', a * 0.5);
      g.save(); g.globalAlpha = a; g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU + t * 0.8; g.beginPath(); g.arc(p.x + Math.cos(an) * 125, p.y + Math.sin(an) * 125, 12 + Math.sin(t * 3 + i) * 3, 0, TAU); g.fill(); }
      g.restore();
    }
    for (const c of this.companions) drawNPC(g, c.id, c.x, c.y, 0.95, t + c.idx, c.mood);
    for (const b of this.orbs) drawRewardOrb(g, b.x, b.y, b.icon, b.color, t, 1 + Math.sin(b.t * 20) * 0.08);
  },
});
