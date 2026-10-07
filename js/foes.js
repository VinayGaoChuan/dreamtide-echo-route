'use strict';
/* 梦潮：回声航线 v0.8 — 敌人阶梯与命中反馈。
   普通怪（8 血，一发散）→ 厚甲怪（总 60：45 点甲只吃 18% 伤害、分三段裂开，甲碎后 15 点核心吃满伤害，单只 3~5 秒）
   → 厚甲编队 → 带队精英（上下两队护卫，举旗时弱点暴露，打倒它护卫就散）。
   数值按关卡固定（只乘关卡 hpK），不随玩家变强偷偷加血。入场中的敌人（背景推近 / 后方绕行 / 裂缝钻出）还不能碰撞，先放在 incoming 里。 */

const ARMOR = { plate: 45, core: 15, stages: 3 };
const ARMOR_K = { shot: 0.18, explosion: 0.4, zap: 0.3, beam: 0.25, wave: 0.35, ring: 0.35, shatter: 0.35, burst: 0.7, clock: 0.7 };
Object.assign(ENEMY_HP, { armor: 15, cmdr: 900, wreck: 220, mtooth: 200, mcore: 700, mimic: 800, hmimic: 900, thief: 200 });
Object.assign(ENEMY_R, { armor: 34, cmdr: 40, wreck: 38, mtooth: 26, mcore: 46, mimic: 46, hmimic: 62, thief: 34 });
/* 收账小偷（§9.3）：飞进来 → 吸走你附近的星砂、躲开你的那条高度 → THIEF.run 秒后掉头跑掉；追上打倒吐出两倍星砂和一袋装备 */
const THIEF = { run: 9, dodge: 150, suck: 210, after: 1, chance: 0.45 };
const STOP_GAP = 0.5; // 全局顿帧：0.5 秒内最多一次

Object.assign(World.prototype, {
  /* ---------- 反馈工具 ---------- */
  hitStop(s) { if (this.t - (this.lastStop === undefined ? -9 : this.lastStop) < STOP_GAP) return; this.lastStop = this.t; this.hitstop = Math.max(this.hitstop, s); },
  flashK() { const s = this.settings; const f = s.flash === undefined ? 1 : s.flash; return s.reduceFlash && f >= 1 ? 0.3 : f; },
  rumble(strong, weak, ms) { if (this.mode === 'run') Input.rumble(strong, weak, ms); },

  /* ---------- 生成 ---------- */
  armorSetup(e) {
    const k = this.foeHpK();
    e.armorMax = ARMOR.plate * k * ((this.L && this.L.eliteK) || 1); e.armorHp = e.armorMax; e.crack = 0; e.push = 0; e.chipT = 0;
    return e;
  },
  addArmor(o = {}) {
    const e = this.addEnemy('armor', Object.assign({ path: 'hold', vx: -150, tx: this.W * 0.74, ty: (this.arena.top + this.arena.bottom) / 2, bob: 40, fire: 'slow', fireT: srand(1.8, 2.6) }, o));
    this.armorSetup(e);
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy('armor');
    return e;
  },
  /* 入场中的敌人：先画出来、不碰撞，到位后才加入战斗 */
  addIncoming(type, o, mode, P) {
    const e = this.makeEnemy(type, o);
    if (type === 'armor') this.armorSetup(e);
    this.incoming.push(Object.assign({ e, mode, t: 0, dur: 1.2 }, P));
    return e;
  },
  updateIncoming(dt) {
    for (const q of this.incoming) {
      q.t += dt; const u = clamp(q.t / q.dur, 0, 1), e = q.e; e.t += dt;
      if (q.mode === 'push' || q.mode === 'emerge') { e.depth = u; e.x = lerp(q.x0, q.x1, Ease.outCubic(u)); e.y = lerp(q.y0, q.y1, Ease.outCubic(u)); }
      else if (q.mode === 'arc') { // 后方追兵：沿看得见的弧线从飞机上方 / 下方绕到右前方
        const k = Ease.inOutSine(u); e.x = (1 - k) * (1 - k) * q.x0 + 2 * (1 - k) * k * q.cx + k * k * q.x1; e.y = (1 - k) * (1 - k) * q.y0 + 2 * (1 - k) * k * q.cy + k * k * q.y1; e.depth = 1;
      } else if (q.mode === 'drop') { const k = Ease.outCubic(u); e.x = lerp(q.x0, q.x1, k); e.y = lerp(q.y0, q.y1, k); e.depth = 1; }
      if (u >= 1) { q.done = true; e.depth = 1; e.y0 = e.y; e.seenT = null; e.shownT = this.t - q.dur; if (q.after) Object.assign(e, q.after); this.enemies.push(e); }
    }
    this.incoming = this.incoming.filter((q) => !q.done);
  },

  /* ---------- 移动 / 开火（新敌人） ---------- */
  moveFoe(e, dt, p) {
    switch (e.path) {
      case 'hold': { // 厚甲怪：飞到站位后慢慢上下晃，不会漏出屏幕
        e.x = smooth(e.x, e.tx + (e.push || 0), 1.8, dt); e.push = (e.push || 0) * Math.pow(0.001, dt);
        e.y = smooth(e.y, clamp(e.ty + Math.sin(e.t * 0.8 + e.seed) * (e.bob || 0), this.arena.top + 40, this.arena.bottom - 40), 2, dt);
        if (e.leader) { const L = this.enemies.find((q) => q.id === e.leader && q.alive); if (L) e.ty = L.y + e.slot[1]; }
        return true;
      }
      case 'cmdr': e.x = smooth(e.x, e.tx, 1.4, dt); e.y = smooth(e.y, (this.arena.top + this.arena.bottom) / 2 + Math.sin(e.t * 0.55) * 90, 1.6, dt); return true;
      case 'escort': { // 护卫：跟着队长保持编队；队长倒下后散开
        const L = this.enemies.find((q) => q.id === e.leader && q.alive);
        if (!L || e.disband) { e.path = 'scatter'; e.vx = -srand(40, 90); e.vy = srand(-30, 30); return true; }
        e.x = smooth(e.x, L.x + e.slot[0], 3, dt); e.y = smooth(e.y, clamp(L.y + e.slot[1], this.arena.top + 30, this.arena.bottom - 30), 3, dt); return true;
      }
      case 'scatter': e.x += e.vx * dt; e.y += Math.sin(e.t * 5 + e.seed) * 30 * dt + e.vy * dt; if (e.t > (e.fleeAt || 1e9)) { e.vx = -260; } return true;
      case 'wreck': e.x = smooth(e.x, e.tx, 1.2, dt); e.y = e.ty + Math.sin(e.t * 0.9) * 6; return true;
      case 'thief': this.thiefMove(e, dt, p); return true;
    }
    return this.moveRaceFoe ? this.moveRaceFoe(e, dt, p) : false; // 七族招牌敌人（racefoes.js）
  },
  foeFire(e, dt, p) {
    if (e.disband || e.sup) return true; // 惊喜敌人的攻击由 surprise.js 管
    const onScreen = e.x < this.W - 30 && e.x > 40;
    if (e.fire === 'slow') { e.fireT -= dt; if (onScreen && e.fireT <= 0) { e.fireT = srand(2.4, 3.2); this.fire('pink', e.x - 20, e.y, this.aimAngle(e.x, e.y), 150); } return true; }
    if (e.type === 'cmdr') { this.cmdrThink(e, dt); return true; }
    if (e.path === 'escort') { e.fireT -= dt; if (onScreen && e.fireT <= 0) { e.fireT = srand(3.2, 4.6); this.fire('pink', e.x - 10, e.y, this.aimAngle(e.x, e.y), 150, { silent: true }); } return true; }
    if (e.type === 'wreck' || e.type === 'thief') return true;
    if (typeof RACE_FOE_TYPES !== 'undefined' && RACE_FOE_TYPES[e.type]) return this.fireRaceFoe(e, dt, p);
    return false;
  },
  /* 收账小偷：每关最多一只，在第 THIEF.after + 1 个目标完成后的平静段来；本图有星砂商会必来，别的图看运气 */
  maybeThief() {
    if (this.mode !== 'run' || this.vs || this.stageId === '1-1' || this.D.thief || this.beatIdx < THIEF.after) return;
    this.D.thief = true;
    const M = MAPS[mapOfStage(this.stageId)] || MAPS[1];
    if (M.races.includes('ledger') || srnd() < THIEF.chance) this.later(2.2, () => this.spawnThief());
  },
  spawnThief() {
    if (this.state !== 'play' || this.boss || this.phase !== 'fight') return null;
    const mid = (this.arena.top + this.arena.bottom) / 2;
    const e = this.addEnemy('thief', { x: this.W + 50, y: mid + srand(-90, 90), path: 'thief', race: 'ledger', def: null, tx: this.W * 0.68, stolen: 0, sack: 0 });
    Sound.sfx('weakOpen', { pan: 0.7 }); this.emit('thief');
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy('thief');
    return e;
  },
  thiefMove(e, dt, p) {
    const top = this.arena.top + 40, bot = this.arena.bottom - 40;
    if (e.t < THIEF.run) {
      // 躲开离它最近那架飞机的高度（子弹只往右直飞）：要追，得上下跟着它
      const away = p.y < (top + bot) / 2 ? bot - 30 : top + 30, ty = Math.abs(p.y - e.y) < THIEF.dodge ? away : e.y + Math.sin(e.t * 2.4 + e.seed) * 40;
      e.x = smooth(e.x, e.tx + Math.sin(e.t * 1.3) * 60, 2.2, dt); e.y = clamp(smooth(e.y, ty, 1.1, dt), top, bot);
      for (const k of this.pickups) { // 吸走附近的星砂，袋子越来越鼓
        if (k.kind !== 'dust' || k.done || k.t < 0.3) continue;
        const d2 = dist2(k.x, k.y, e.x, e.y); if (d2 > THIEF.suck * THIEF.suck) continue;
        k.x = smooth(k.x, e.x, 5, dt); k.y = smooth(k.y, e.y, 5, dt);
        if (d2 < 26 * 26) { k.done = true; e.stolen += k.value; e.sack = Math.min(1, e.sack + 0.04); }
      }
    } else {
      if (!e.fled) { e.fled = true; this.emit('thiefGone'); }
      e.x += (260 + e.t * 30) * dt; e.y = smooth(e.y, top, 0.6, dt);
    }
  },
  /* 带队精英：举旗集结（弱点暴露）→ 指一条航道（预警 1 秒）→ 护卫从那条航道开火 */
  cmdrThink(e, dt) {
    e.rally = Math.max(0, (e.rally || 0) - dt); e.cmdT = (e.cmdT === undefined ? 2.2 : e.cmdT) - dt;
    if (e.x > this.W - 40) return;
    // 半血：叫来上下两队援兵（先从云影 / 海面预警再钻出来）
    if (!e.called && e.hp < e.maxHp * 0.5) {
      e.called = true; this.text('精英叫来了援兵！', e.x, e.y - 90, '#ffb2a8', 20, 5);
      for (const side of [-1, 1]) { const x = e.x - 40; this.props.push({ kind: 'drop', side, x, t: 0, warn: 1.0, spawn: () => { for (let i = 0; i < 3; i++) this.addIncoming(side < 0 ? 'jelly' : 'moth', { path: 'escort', leader: e.id, slot: [(i - 1) * 56 - 20, side * 150], escort: true, fireT: srand(2, 4) }, 'drop', { x0: x + (i - 1) * 50, y0: side < 0 ? TOP - 40 : BOTTOM + 40, x1: e.x + (i - 1) * 56 - 20, y1: e.y + side * 150, dur: 0.8 }); } }); }
    }
    if (e.cmdT <= 0) {
      e.cmdT = 4.6; e.rally = 1.9; Sound.sfx('weakOpen', { pan: this.pan(e.x) });
      this.text('举旗！弱点露出来了', e.x, e.y - 70, '#ffe38a', 16, 3);
      const y = clamp(this.pickTarget().y, this.arena.top + 60, this.arena.bottom - 60), h = 96; // 多人：轮到谁就指谁的航道
      this.later(0.9, () => {
        if (!e.alive || this.state !== 'play') return;
        this.addWarn({ kind: 'zone', x: 0, y: y - h / 2, w: e.x - 40, h, tWarn: 1.0, onFire: () => { if (!e.alive) return; for (let i = 0; i < 6; i++) this.fire('pink', e.x - 30, y + (i - 2.5) * 14, Math.PI, 330, { silent: i > 0, from: 'lane' }); } });
      });
    }
  },
  spawnCommander(o = {}) {
    const mid = (this.arena.top + this.arena.bottom) / 2, x0 = o.x !== undefined ? o.x : this.W + 80, y0 = o.y !== undefined ? o.y : mid;
    const c = this.addEnemy('cmdr', { elite: true, x: x0, y: y0, path: 'cmdr', tx: this.W * 0.75, fireT: 2, goal: true, portrait: 'cmdr' });
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const type = side < 0 ? 'jelly' : 'moth';
      this.addEnemy(type, { x: x0 + (i - 1.5) * 52, y: y0 + side * 170, path: 'escort', leader: c.id, slot: [(i - 1.5) * 52, side * 170], escort: true, fireT: srand(1.5, 4) });
    }
    this.emit('elite', { elite: 'cmdr' });
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy('cmdr');
    return c;
  },

  /* ---------- 伤害：厚甲 / 护盾 ---------- */
  armorDamage(e, dmg, o) {
    const k = ARMOR_K[o.kind] !== undefined ? ARMOR_K[o.kind] : ARMOR_K.shot;
    // 敲甲用时只算“正在连续打它”的时间（两下之间隔超过 0.35 秒不算），被大招直接轰开的不计入对比
    if (e.lastHitT !== undefined && this.t - e.lastHitT < 0.35) e.focusT = (e.focusT || 0) + (this.t - e.lastHitT);
    e.lastHitT = this.t; if (o.kind === 'burst' || o.kind === 'clock') e.bursted = true;
    const before = e.armorHp; e.armorHp -= dmg * k; e.hitFlash = 0.6;
    const st = Math.min(ARMOR.stages - 1, Math.floor((1 - Math.max(0, e.armorHp) / e.armorMax) * ARMOR.stages));
    // 命中：金属声 + 碎屑沿子弹方向飞 + 轻微后退
    const hx = o.x !== undefined ? o.x : e.x - e.r, hy = o.y !== undefined ? o.y : e.y;
    e.push = Math.min(10, (e.push || 0) + 2.2);
    Sound.sfx('clink', { pan: this.pan(e.x), gap: 55, k: st });
    if (Math.random() < 0.7) this.part('shard', hx, hy, rand(-160, -40), rand(-180, 60), 0.45, rand(2.5, 4.5), pick(['#b9c3e8', '#8f9ccc', '#e6ecff']));
    if (st > e.crack) { e.crack = st; Sound.sfx('crack', { pan: this.pan(e.x) }); for (let i = 0; i < 5; i++) this.part('shard', hx, hy, rand(-240, -60), rand(-220, 120), 0.6, rand(4, 7), '#c7d0f0'); this.rumble(0.15, 0.3, 50); }
    if (e.armorHp <= 0) {
      const over = -e.armorHp / k; e.armorHp = 0; this.armorBreak(e, o);
      return over;
    }
    return 0;
  },
  /* 敲碎厚甲的用时（只算连续打它的时间）：第一只当基准，之后同型的直接和它比 */
  armorTimed(e) {
    if (!e.broken || e.bursted || !e.focusT || this.mode !== 'run') return;
    const dt = e.focusT + 0.12, M = this.m; M.armorTimes = M.armorTimes || []; M.armorTimes.push(dt);
    if (this.armorBase === undefined) { this.armorBase = dt; M.armorFirst = dt; this.text(`第一只厚甲：敲碎用了 ${dt.toFixed(1)} 秒`, e.x, e.y - 76, '#e6ecff', 18, 5); return; }
    const later = M.armorTimes.slice(1); M.armorAfter = later.reduce((a, b) => a + b, 0) / later.length;
    const k = 1 - dt / this.armorBase;
    if (M.armorTimes.length <= 4) this.text(k > 0.12 ? `${dt.toFixed(1)} 秒 · 比第一只快 ${Math.round(k * 100)}%` : `${dt.toFixed(1)} 秒`, e.x, e.y - 76, k > 0.12 ? '#9ff2c8' : '#e6ecff', 18, 5);
  },
  armorBreak(e, o) {
    e.broken = true; e.crack = ARMOR.stages; e.brokeT = this.t;
    this.hitStop(0.045); this.shake(0.22); Sound.sfx('armorBreak', { pan: this.pan(e.x), prio: true });
    this.rumble(0.55, 0.4, 90);
    for (let i = 0; i < 2; i++) this.part('plate', e.x - 10, e.y + (i ? 12 : -12), rand(-220, -80), rand(-260, -120), 1.1, 18 + i * 4, '#9aa6d6');
    for (let i = 0; i < 8; i++) this.part('shard', e.x, e.y, rand(-300, 120), rand(-300, 200), 0.7, rand(4, 8), pick(['#c7d0f0', '#8f9ccc']));
    this.part('ring', e.x, e.y, 0, 0, 0.3, e.r * 2.2, 'rgba(230,236,255,0.9)');
    this.text('破甲！', e.x, e.y - 48, '#e6ecff', 20, 4);
    this.m.breaks = (this.m.breaks || 0) + 1;
    if (this.onGoalEvent) this.onGoalEvent('break', e);
  },
  shieldK(e, o) {
    if (e.type === 'cmdr') return e.rally > 0 ? 1.5 : 0.4;
    if (e.guarded) return 0.05;
    return 1;
  },

  /* ---------- 击杀反馈：接触闪光 → 朝受力方向压扁 → 碎片顺着子弹方向散开；轮廓立刻消失 ---------- */
  killPop(e, o) {
    const dir = o.dir !== undefined ? o.dir : 0, cx = Math.cos(dir), cy = Math.sin(dir), low = this.low;
    const big = e.elite || e.type === 'armor' || e.type === 'mirror';
    this.part('flash', o.x !== undefined ? o.x : e.x, o.y !== undefined ? o.y : e.y, 0, 0, 0.1, e.r * 1.1, 'rgba(255,250,235,0.95)');
    this.part('squash', e.x, e.y, cx * 40, cy * 40, 0.13, e.r, e.base === 'moth' ? '#9f8cf5' : e.type === 'armor' ? '#8fd8c8' : '#9fe3f0', dir);
    const C = this.expColors, n = low ? 4 : big ? 14 : 8;
    for (let i = 0; i < n; i++) { const sp = rand(140, big ? 460 : 360), a = dir + rand(-0.7, 0.7); this.part(i % 3 ? 'shard' : 'petal', e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp - 40, 0.5, rand(3.5, big ? 8 : 6), pick(C)); }
    if (big) { this.part('ring', e.x, e.y, 0, 0, 0.32, e.r * 2.4, 'rgba(255,255,255,0.85)'); this.fx(e.x, e.y, 2, e.r * 2); }
  },
});

/* ---------- 画 ---------- */
EnemyArt.armor = (g, e, t) => {
  g.scale(1.3, 1.3); // 比普通怪大一圈，一眼看出是硬目标
  const broken = e.broken, st = e.crack || 0, u = e.armorMax ? 1 - e.armorHp / e.armorMax : 1, near = !broken && (u * ARMOR.stages) % 1 > 0.8;
  g.lineJoin = 'round';
  // 身体：圆滚滚的河豚
  const bg = g.createRadialGradient(-6, -8, 3, 0, 0, 26); bg.addColorStop(0, broken ? '#ffd0e4' : '#bff0e2'); bg.addColorStop(1, broken ? '#ff8fb8' : '#58b9a6');
  g.fillStyle = bg; g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = '#58b9a6'; g.beginPath(); g.moveTo(20, -6); g.lineTo(34, -14); g.lineTo(30, 0); g.lineTo(34, 14); g.lineTo(20, 6); g.closePath(); g.fill(); g.stroke();
  if (!broken) {
    // 正面三块甲片，裂纹随阶段增加；临近下一段时裂纹发亮
    for (let i = 0; i < 3; i++) {
      const y = (i - 1) * 15;
      g.save(); g.translate(-18, y); g.rotate((i - 1) * 0.35);
      const pg = g.createLinearGradient(-10, -8, 8, 8); pg.addColorStop(0, '#eef2ff'); pg.addColorStop(1, '#8f9ccc');
      g.fillStyle = pg; g.beginPath(); g.roundRect ? g.roundRect(-11, -8, 18, 16, 4) : g.rect(-11, -8, 18, 16); g.fill(); g.lineWidth = 2; g.stroke();
      g.fillStyle = '#5b6798'; g.beginPath(); g.arc(-6, -3, 1.6, 0, TAU); g.arc(3, 3, 1.6, 0, TAU); g.fill();
      if (st > i || (st === i && u > 0.05)) {
        g.strokeStyle = near && st === i ? `rgba(255,243,200,${0.7 + Math.sin(t * 30) * 0.3})` : '#3c4470'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(-9, -6); g.lineTo(-2, 0); g.lineTo(-6, 6); if (st > i) { g.moveTo(-2, 0); g.lineTo(6, -5); g.moveTo(-2, 0); g.lineTo(5, 6); } g.stroke();
      }
      g.restore();
    }
  }
  eyePair(g, -4, -6, 7, 2.6, 3.2, { look: -1, squint: broken ? 0.6 : 1 });
  g.strokeStyle = PAL.ink; g.lineWidth = 1.5; g.beginPath(); if (broken) g.arc(-4, 6, 3, Math.PI + 0.3, -0.3); else { g.moveTo(-8, 5); g.lineTo(0, 5); } g.stroke();
  if (broken) blush(g, -4, 1, 10, 2.4);
};
EnemyArt.cmdr = (g, e, t) => {
  const rally = e.rally > 0;
  g.save(); g.scale(1.6, 1.6); EnemyArt.jelly(g, e, t); g.restore();
  // 船长帽
  g.fillStyle = '#2d2358'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-26, -26); g.quadraticCurveTo(-2, -48, 22, -26); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ffd76a'; g.beginPath(); g.arc(-2, -33, 4, 0, TAU); g.fill();
  // 指挥旗：举起时弱点（旗头水晶）发亮
  const a = rally ? -1.2 : -0.35 + Math.sin(t * 2) * 0.1;
  g.save(); g.translate(18, -6); g.rotate(a);
  g.strokeStyle = '#fff4dc'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -46); g.stroke();
  g.fillStyle = '#ff9fcf'; g.beginPath(); g.moveTo(0, -44); g.lineTo(22, -38); g.lineTo(0, -30); g.closePath(); g.fill(); g.lineWidth = 1.6; g.strokeStyle = PAL.ink; g.stroke();
  if (rally) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, -50, 26, GLOW.gold, 0.9 + Math.sin(t * 20) * 0.1); g.globalCompositeOperation = 'source-over'; }
  g.fillStyle = rally ? '#fff6c8' : '#9fe3f0'; g.beginPath(); g.moveTo(0, -58); g.lineTo(6, -50); g.lineTo(0, -42); g.lineTo(-6, -50); g.closePath(); g.fill(); g.stroke();
  g.restore();
  if (!rally) { // 前方护盾：平时减伤
    g.strokeStyle = 'rgba(200,230,255,0.7)'; g.lineWidth = 4; g.beginPath(); g.arc(4, 0, 44, Math.PI * 0.62, Math.PI * 1.38); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(4, 0, 49, Math.PI * 0.7, Math.PI * 1.3); g.stroke();
  }
};
EnemyArt.wreck = (g, e, t) => {
  g.lineJoin = 'round'; g.scale(1.3, 1.3);
  glowAt(g, -2, 16, 80, 'rgba(255,159,207,0.5)', 0.35);
  g.fillStyle = '#6a5bb3'; g.strokeStyle = '#e7d8ff'; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(-60, 10); g.lineTo(52, 4); g.lineTo(40, 34); g.lineTo(-48, 38); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = '#5b4fa0'; g.lineWidth = 3; g.beginPath(); g.moveTo(-10, 6); g.lineTo(-18, -44); g.moveTo(-18, -44); g.lineTo(18, -30); g.stroke();
  g.fillStyle = 'rgba(40,30,90,0.9)'; g.beginPath(); g.ellipse(-2, 18, 14, 9, 0, 0, TAU); g.fill();
  const pulse = 1 + Math.sin(t * 5) * 0.08;
  g.globalCompositeOperation = 'lighter'; drawGlow(g, -2, 0, 40 * pulse, GLOW.pink, 0.7); g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#ffd0e8'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-2, -20 * pulse); g.lineTo(14, 0); g.lineTo(-2, 20 * pulse); g.lineTo(-18, 0); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ff6a9a'; g.beginPath(); g.arc(-2, 0, 6, 0, TAU); g.fill();
};

/* 目标标记：主目标头顶的下箭头 + 细圈 */
function drawGoalMark(g, e, t) {
  const y = e.y - e.r - 34 + Math.sin(t * 5) * 4;
  g.save(); g.fillStyle = '#ffe38a'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(e.x - 9, y - 8); g.lineTo(e.x + 9, y - 8); g.lineTo(e.x, y + 4); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,227,138,0.55)'; g.setLineDash([6, 8]); g.lineDashOffset = -t * 20; g.lineWidth = 2; g.beginPath(); g.arc(e.x, e.y, e.r + 14, 0, TAU); g.stroke(); g.setLineDash([]);
  g.restore();
}
/* 厚甲裂纹阶段小条（头顶） */
function drawArmorPips(g, e) {
  const n = ARMOR.stages + 1, w = 12, x0 = e.x - (n * w + (n - 1) * 3) / 2, y = e.y + e.r + 12;
  for (let i = 0; i < n; i++) {
    const done = i < (e.broken ? ARMOR.stages : e.crack || 0) || (i === ARMOR.stages && e.hp <= 0);
    g.fillStyle = done ? 'rgba(255,255,255,0.18)' : i === ARMOR.stages ? '#ff9fcf' : '#c7d0f0';
    g.fillRect(x0 + i * (w + 3), y, w, 5);
  }
}
