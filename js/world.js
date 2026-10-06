'use strict';
/* 梦潮：回声航线 v0.8 — 一关 = 一次出击：一串主目标（普通怪群 → 厚甲怪 → 厚甲编队 → 带队精英 → 场景惊喜 → Boss），只在出击结束时结算。
   主炮自动开火但固定向右、单发、命中即消失；穿透 / 追踪 / 多重 / 爆破只能在局内升级仪式里拿到，新一局清空。
   目标调度见 director.js，敌人阶梯与命中反馈见 foes.js，升级仪式见 offers.js，地图互动见 mapfx.js，场景惊喜见 surprise.js。 */

const LH = 720, TOP = 64, BOTTOM = LH - 22;
const RESCUE = { r: 92, dwell: 2, hp: 0.4, inv: 2, clear: 160 }; // 联机击毁救援（v0.11 §8）：救援圈半径、停多久救起、救起回多少生命、保护几秒、倒下时清掉多大范围的敌弹
const B_RADIUS = { pink: 7, blue: 6.5, gold: 8, white: 4 };
let _eid = 1; // 只给不进同步的场合兜底；每个 World 用自己的 this.eid
const PLAYER_COLORS = ['#ffe38a', '#9fe3f0', '#ff9fcf', '#9ff2c8'];
const NEUTRAL_INPUT = Object.freeze({ mx: 0, my: 0, focus: false, burst: false, dx: 0, dy: 0 });

/* 飞机属性 = 飞机基础 × 共享等级 × 这架飞机天赋树已点亮的节点（穿透 / 追踪节点只强化本局已获得的能力） */
function planeStats(meta, planeId) {
  const P = PLANES[planeId], rec = (meta && meta.planes && meta.planes[planeId]) || { stars: 1 }, lv = (meta && meta.shared && meta.shared.level) || 1;
  const s = { dmg: 0, blast: 0, charge: 0, magnet: 0, repeat: 0, heart: 0, boss: 0, pierceX: 0, homingX: 0, houseFast: 0, npcBoost: 0 };
  if (rec.map) for (const r of ROUTE_ORDER) {
    const nodes = rec.map[r] || [], lit = rec.lit ? rec.lit[r] || 0 : 0;
    for (let i = 0; i < Math.min(lit, nodes.length); i++) if (nodes[i].type in s) s[nodes[i].type] += nodes[i].v;
  }
  return { dmgK: sharedAtk(lv) * (1 + s.dmg / 100), blastK: 1 + s.blast / 100, chargeK: 1 + s.charge / 100, magnetK: 1 + s.magnet / 100, repeat: s.repeat / 100, wings: 0,
    hearts: P.hearts + s.heart + sharedHearts(lv), bossK: 1 + s.boss / 100, stars: rec.stars || 1, pierceX: s.pierceX, homingX: s.homingX / 100, houseFast: s.houseFast / 100, npcBoost: s.npcBoost / 100, level: lv, raw: s };
}

const ENEMY_HP = { jelly: 8, moth: 8, boat: 22, tick: 30, star: 18, beacon: 60, jellyE: 480, tickE: 540, starE: 440, mirror: 220, dummy: 1e9 };
const ENEMY_R = { jelly: 20, moth: 18, boat: 22, tick: 20, star: 20, beacon: 22, jellyE: 32, tickE: 30, starE: 28, mirror: 34, dummy: 20 };
const FORMATION_SIZE = { line: 6, vee: 7, snake: 8, wall: 5, boats: 3, stars: 2, ticks: 3, swarm: 12, beacon: 3, dustmoths: 6 };
const WING_SLOTS = [[-26, -40], [-26, 40], [-52, -74], [-52, 74], [-74, 0], [-86, -110], [-86, 110], [-104, -40], [-104, 40]];
const CLONE_SLOTS = [[30, -120], [30, 120], [-20, -175], [-20, 175], [70, 0], [-10, -70], [-10, 70]];

class World {
  constructor(o) {
    this.mode = o.mode || 'run';
    this.W = o.W || 1280; this.H = LH;
    this.settings = o.settings; this.cb = o.cb || {};
    // 确定性：每局一个种子；所有影响玩法的随机都从这里取（多人时各端种子相同）
    this.seed = o.seed !== undefined ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    this.rng = new SeededRng(this.seed); SimRNG.cur = this.rng; this.eid = 1;
    // 玩家名单：单人就是一架；多人时每架飞机带着自己的机型、局外属性和大招容量
    const roster = o.players || [{ id: 'solo', name: '', plane: o.plane || 'moon', stats: o.stats, ultCap: o.ultCap || 1, cos: o.cos }];
    this.np = roster.length; this.mp = this.np > 1 || !!o.mp;
    this.first = !!o.first && !this.mp; this.tutorial = !!o.tutorial && !this.mp; this.targetName = o.target || null; // 这一局追的流派（和大厅“下一局目标”一致）
    this.stage = STAGES[o.stage] || STAGES['1-1']; this.stageId = this.stage.id;
    // 家园改变战场（v0.10）：上层风圈是否已修好、这次要救谁、NPC 职责带来的变化。多人时用房主的，各端一致
    this.wf = Object.assign({ upper: false, target: null, targets: null, rescued: [], clue: false, beacon: false, scout: false }, o.world || {});
    if (!Array.isArray(this.wf.targets)) this.wf.targets = this.wf.target ? [this.wf.target] : []; // 联机：房间里每个人当前要救的伙伴都在这里
    this.goalText = o.goalText || null; // HUD 只追踪家园的当前目标（纯显示）
    this.players = roster.map((r, i) => this.makePlayer(r, i));
    this.meIdx = o.me || 0; this.me = this.players[this.meIdx]; this.player = this.players[0];
    this.inputs = this.players.map(() => Object.assign({}, NEUTRAL_INPUT));
    this.scene = o.scene || new SeaScene(); this.scene.speed = 90; this.scene.dir = 1; this.scene.dim = this.mode === 'run' ? 1 : 0; this.scene.moonFx = null;
    this.low = this.settings.particles === 'low';
    this.diff = { warnBonus: 0.1 }; // 大众向：Boss 预警统一多给 0.1 秒
    this.t = 0; this.runT = 0; this.state = 'play'; this.phase = 'fight';
    this.slowT = 0; this.timeScale = 1; this.hitstop = 0; this.trauma = 0; this.flash = 0; this.flashColor = '255,250,235'; this.hurtFlash = 0;
    this.timeStop = 0; this.reverseT = 0; this.gone = [];
    this.arena = { top: TOP, bottom: BOTTOM }; this.arenaTarget = { top: TOP, bottom: BOTTOM };
    this.bullets = new Pool(() => ({ on: false }), 420);
    this.shots = new Pool(() => ({ on: false }), 520);
    this.parts = new Pool(() => ({ on: false }), this.low ? 360 : 1100);
    this.enemies = []; this.incoming = []; this.pickups = []; this.portals = []; this.surprise = null; this.lastStop = -9; this.burstKills = []; this.arcs = []; this.beams = []; this.rings = []; this.walls = [];
    this.warns = []; this.texts = []; this.events = []; this.timers = [];
    this.initBuild();
    this.streak = { n: 0, t: 0, best: 0, lastN: 0 }; this.recentKills = []; this.chainCd = 0; this.chainHiCd = 0;
    this.bursting = null; this.bfx = null; this.cloudWall = null;
    this.seg = null; this.segIdx = 0; this.boss = null; this.bossProxy = null; this.bossIntroT = 0; this.bossEarly = false; this.carnival = false;
    this.tutorCharge = false;
    // 全队共用的统计；星砂 / 宝箱 / 碎片 / 升级次数这些“自己的资源”在每架飞机的 res 里
    this.m = { kills: 0, bursts: 0, maxStreak: 0, elites: 0, highlights: 0, firstKill: null, firstSkill: null, firstSyn: null, firstBurst: null,
      killTimeSum: 0, killTimeN: 0, gapMax: 0, gapT: 0, talent: 0, route: [], streak100: 0, hitsTaken: 0, leaks: 0, offerMiss: 0, stockIdle: 0, segsDone: 0, workT: 0, rescuedNow: [], upperRoute: 0, unfair: 0, dmgOut: 0, golds: 0 };
    this.hintStep = this.first ? 0 : -1; this.hintShown = null;
    this.initMap(o);
    this.pickCd = { bolt: 0, mine: 0, zap: 0 };
    if (this.mode === 'preview') this.setupPreview();
    else if (o.vs && this.np > 1) this.initVs(); // 对抗（v0.11）：每人一条航道、三段计分，不走合作关卡的目标链
    else this.initDirector();
    this.eachPlayer(() => this.syncWingmen());
    this.player = this.me; // 模拟之外（界面、HUD、渲染）读到的“当前飞机”就是本机这架
  }
  /* 一架飞机的全部局内状态（多人时每人一份） */
  makePlayer(r, i) { // stats 每架飞机复制一份：成型会改 dmgK，不能改到大厅资料（联机重算 / 重进会叠加）
    const planeId = r.plane || 'moon', P = PLANES[planeId], stats = Object.assign({}, r.stats || planeStats(null, planeId)), cos = r.cos || {}, n = Math.max(1, this.np || 1);
    const expC = COSMETICS.exp.find((c) => c.id === cos.exp), trC = COSMETICS.trail.find((c) => c.id === cos.trail) || COSMETICS.trail[0];
    const y = (TOP + BOTTOM) / 2 + (i - (n - 1) / 2) * 90;
    return { idx: i, id: r.id || 'p' + i, name: r.name || '', planeId, P, stats, ultCap: r.ultCap || 1, expColors: (expC && expC.colors) || P.colors.exp, trailColors: trC.colors, trailId: trC.id,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length], wingmen: [], storm: null, skills: [], downT: 0, gone: false,
      x: this.W * 0.24 - (n > 1 ? (i % 2) * 40 : 0), y, vx: 0, vy: 0, r: 6, hp: stats.hearts, maxHp: stats.hearts, inv: 0, hurtT: 0, burst: 0, stock: 0, tilt: 0, blink: 0, blinkT: 2, cloudShield: false, cloudCd: 0, fireT: 0.1, alt: 1, trail: [], trailT: 0, alive: true, candy: 0, moved: 0,
      // 自己的 Build：三个槽、联动、流派、升级队列和正在进行的升级仪式
      gun: { pierce: 0, homing: 0, multi: 0, bomb: 0 }, support: null, bmod: null, links: new Set(), ritual: null, ritualQueue: [], offerN: 0, dryOffers: 0, picks: [], stream: null, recentMods: [], crystals: 0, rareNext: false,
      hudBuild: { gun: { pierce: 0, homing: 0, multi: 0, bomb: 0 }, support: null, bmod: null, links: [], recent: [] },
      // 自己的资源：各吃各的掉落、各算各的结算
      res: { dust: 0, frags: {}, chests: 0, candies: 0, crystals: 0, syns: 0, lv5: 0, offers: 0, choiceTimes: [], wood: 0, earned: 0 } };
  }
  /* 兼容单人代码：“当前行动的飞机”的这些属性，读的都是 this.player 身上的 */
  get planeId() { return this.player.planeId; }
  get P() { return this.player.P; }
  get stats() { return this.player.stats; }
  get ultCap() { return this.player.ultCap; }
  get expColors() { return this.player.expColors; }
  get trailColors() { return this.player.trailColors; }
  get trailId() { return this.player.trailId; }
  get wingmen() { return this.player.wingmen; }
  set wingmen(v) { this.player.wingmen = v; }
  get storm() { return this.player.storm; }
  set storm(v) { this.player.storm = v; }
  get syn() { return this.player.links; }
  /* 世界级的“升级焦点”：升级仪式让全场慢放、暂停刷怪和计时。
     联机（v0.11 §7）：同一轮升级全队同时开始，任何一架还在选，全场都处在安全减速里；选好的先等着，都选好了一起继续 */
  worldRitual() {
    if (!this.mp) return this.players[0].ritual;
    let any = null;
    for (const q of this.players) { if (q.gone || q.away || !q.ritual) continue; if (q.ritual.st !== 'resume') return q.ritual; any = any || q.ritual; } // 断线中的人不拖住全队
    return any;
  }
  worldRitualBusy() { return this.mp ? this.players.some((q) => !q.gone && !q.away && (q.ritual || (q.alive && q.ritualQueue.length))) : !!(this.players[0].ritual || this.players[0].ritualQueue.length); }
  /* 选好的飞机停在“等队友”；在线的都选好了，一起恢复（倒下 / 离开的人不拖住全队） */
  teamRitualSync() {
    const act = this.players.filter((q) => !q.gone && !q.away && q.ritual);
    if (!act.some((q) => q.ritual.st === 'wait') || !act.every((q) => q.ritual.st === 'wait' || q.ritual.st === 'resume')) return;
    for (const q of act) if (q.ritual.st === 'wait') this.withPlayer(q, () => this.ritStep('resume'));
  }
  mine() { return this.player === this.me; } // 只给本机看 / 听的表现（音效、横幅、仪式画面）
  /* 同步校验：把会影响结局的状态压成一个 32 位哈希（浮点按原始位比较，表现层的东西不算进来） */
  stateHash() {
    const f = new Float64Array(1), u = new Uint32Array(f.buffer); let h = 0x811c9dc5;
    const mix = (v) => { f[0] = +v || 0; h = Math.imul(h ^ u[0], 16777619); h = Math.imul(h ^ u[1], 16777619); };
    mix(this.t); mix(this.runT); mix(this.rng.s); mix(this.rng.n); mix(this.m.kills); mix(this.beatIdx || 0); mix(this.eid);
    for (const q of this.players) { mix(q.x); mix(q.y); mix(q.hp); mix(q.stock); mix(q.burst); mix(q.alive ? 1 : 0); mix(q.res.dust); mix(q.picks.length); mix(q.ritual ? 1 : 0); mix(q.away ? 1 : 0); }
    for (const e of this.enemies) { mix(e.id); mix(e.x); mix(e.y); mix(e.hp); }
    if (this.vs) { for (const v of this.vs.score) mix(v); mix(this.vs.t); }
    let nb = 0; this.bullets.each((b) => { nb++; mix(b.x); mix(b.y); }); mix(nb);
    let ns = 0; this.shots.each((s2) => { ns++; mix(s2.x); mix(s2.y); }); mix(ns);
    for (const k of this.pickups) { mix(k.x); mix(k.y); }
    if (this.boss) mix(this.boss.hp);
    return h >>> 0;
  }
  /* 分叉排查用：比哈希更细的明细 */
  stateDump() {
    return { t: this.t, runT: this.runT, rng: [this.rng.s, this.rng.n], kills: this.m.kills, beat: this.beatIdx, D: this.D && this.D.st, eid: this.eid,
      players: this.players.map((q) => [q.x, q.y, q.hp, q.stock, q.burst, q.alive, q.res.dust, q.picks.map((o) => o.kind + o.id), q.ritual && q.ritual.st, q.ritualQueue.length]), enemies: this.enemies.map((e) => [e.id, e.type, e.x, e.y, e.hp]),
      bullets: (() => { const L = []; this.bullets.each((b) => L.push([b.type, b.x, b.y])); return L; })(), shots: (() => { const L = []; this.shots.each((s2) => L.push([s2.kind, s2.x, s2.y, s2.owner])); return L; })(),
      pickups: this.pickups.map((k) => [k.kind, k.x, k.y, k.owner]), boss: this.boss ? this.boss.hp : null, timers: this.timers.length, incoming: this.incoming.length, map: this.mapObjs.map((o) => [o.kind, o.state, o.x, o.y]) };
  }
  /* 人数系数：主目标 / 精英 / Boss 按人数加厚，普通杂兵不变（一发一个的手感不丢） */
  teamK(per) { return 1 + per * Math.max(0, this.np - 1); }
  /* Boss / 队长会自愈（每秒回 regen × 最大生命，回不过本阶段的上限）：火力不够就打不动，只有成型的火力压得住 */
  bossRegen(b, cap, dt) {
    const r = BUILD_CHECK.regen; if (!r || this.vs || b.dying || !(b.hp > 0) || b.hp >= cap) return;
    b.hp = Math.min(cap, b.hp + r * b.maxHp * dt); b.regenAt = this.t; // 画面：血条发绿光、Boss 身边冒绿色“+”
  }
  /* 构筑考验看得见：自愈时身边冒绿色“+”，失控时一圈越来越红的光 */
  drawBossCheck(g, b) {
    if (b.dying || this.bossIntroT > 0) return;
    const t = this.t;
    if (b.rage > 0) {
      const pu = 0.75 + 0.25 * Math.sin(t * 10);
      g.save(); g.globalCompositeOperation = 'lighter'; drawGlow(g, b.x, b.y, 160 + 50 * b.rage, 'rgba(255,60,80,1)', (0.4 + 0.4 * b.rage) * pu); g.restore();
      g.save(); g.strokeStyle = `rgba(255,80,100,${(0.5 + 0.4 * b.rage) * pu})`; g.lineWidth = 4 + 3 * b.rage; g.setLineDash([18, 10]); g.lineDashOffset = -t * 120; g.beginPath(); g.arc(b.x, b.y, 118 + 6 * Math.sin(t * 10), 0, TAU); g.stroke(); g.restore(); // 一圈转动的红色虚线：失控中
    }
    if (b.regenAt !== undefined && t - b.regenAt < 0.4) {
      g.save(); g.strokeStyle = 'rgba(111,227,154,0.9)'; g.lineWidth = 4; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) { const k = (t * 0.8 + i / 3) % 1, x = b.x - 70 + i * 70, y = b.y - 60 - k * 60; g.globalAlpha = 1 - k; g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x + 8, y); g.moveTo(x, y - 8); g.lineTo(x, y + 8); g.stroke(); }
      g.restore();
    }
  }
  /* Boss / 队长打太久会失控：攻击速度倍数（1 = 正常）；跨过预告和失控那一刻各喊一次 */
  bossRageK(b) {
    const R = BUILD_CHECK.rage, at = R.at[this.stageId]; if (!at || !b || this.vs) return 1;
    const f = b.fightT || 0;
    if (!b.rageCall && f >= at - R.warn) { b.rageCall = 1; this.emit('flag', { text: `${R.warn} 秒后失控 · 快打！`, color: 'gold', dur: 1.6 }); Sound.sfx('weakOpen'); }
    if (b.rageCall === 1 && f >= at) { b.rageCall = 2; this.emit('flag', { text: '失控了 · 攻击越来越快', color: 'red', dur: 1.8 }); Sound.sfx('rewind'); this.shake(0.35); }
    b.rage = f <= at ? 0 : Math.min(1, (f - at) / R.ramp); // 画面用：越失控越红
    // 失控太久：每 pulse 秒一次全屏冲击（提前 1.5 秒预告），躲不掉——拖下去必输
    const over = f - at - R.wipe;
    if (over > 0) {
      const n = Math.floor(over / R.pulse);
      if (over - n * R.pulse >= R.pulse - 1.5 && b.pulseWarn !== n) { b.pulseWarn = n; this.emit('flag', { text: '失控冲击！', color: 'red', dur: 1.2 }); Sound.sfx('weakOpen'); }
      if (b.pulseN !== n) { b.pulseN = n; if (n > 0) { for (const q of this.players) if (q.alive && !q.gone) { q.inv = 0; this.hurtPlayer(1, 'c:rage', q); } this.shake(0.5); } }
    }
    return 1 + Math.min(R.max, (Math.max(0, f - at)) / R.ramp);
  }
  /* 模拟里默认的“当前飞机”：第一架还活着的（各端一致）；渲染 / HUD 用 this.me */
  anchor() { return this.players.find((q) => q.alive && !q.gone && !q.away) || this.players.find((q) => q.alive && !q.gone) || this.players.find((q) => !q.gone) || this.players[0]; }
  alivePlayers() { return this.players.filter((q) => q.alive && !q.gone && !q.away); } // 在线、能行动的（断线中的不算：救不了人，也不会被打）
  eachPlayer(fn) { const keep = this.player; for (const q of this.players) { if (q.gone) continue; this.player = q; fn(q); } this.player = keep; }
  withPlayer(q, fn) { const keep = this.player; this.player = q || keep; try { return fn(); } finally { this.player = keep; } }
  nearestPlayer(x, y) { let best = null, bd = 1e18; for (const q of this.players) { if (!q.alive || q.gone || q.away) continue; const d = dist2(x, y, q.x, q.y); if (d < bd) { bd = d; best = q; } } return best || this.anchor(); }
  pickTarget() { const L = this.alivePlayers(); return L.length ? spick(L) : this.anchor(); }
  setInput(i, inp) { const I = this.inputs[i]; if (!I) return; if (inp.gone) { this.dropPlayer(i); return; } this.setAway(i, !!inp.away); I.mx = inp.mx || 0; I.my = inp.my || 0; I.focus = !!inp.focus; I.burst = I.burst || !!inp.burst; I.dx = inp.dx || 0; I.dy = inp.dy || 0; }
  emit(type, data) { this.events.push(Object.assign({}, data || {}, { type })); } // 事件名永远不被数据里的同名字段覆盖
  later(t, fn) { this.timers.push({ t, fn }); }
  highlight() { this.m.highlights++; }
  /* Boss 打掉一段血（换阶段）：星砂从它身上喷出来飞回飞机、大招充一截。Boss 战中途也有奖励节拍（不回血：Boss 仍是这一关最难的一段） */
  bossBreak(x, y) {
    this.m.bossBreaks = (this.m.bossBreaks || 0) + 1;
    for (let i = 0; i < 12; i++) this.dropPickup('dust', x + srand(-30, 30), y + srand(-30, 30), { value: 3, big: i < 5, vx: srand(-260, 120), vy: srand(-420, -120) });
    for (const q of this.players) if (!q.gone && q.alive) this.withPlayer(q, () => this.addCharge(0.3));
    this.text('Boss 掉了一块！', x, y - 120, '#ffe38a', 22, 5);
  }
  /* 攻击者刚出现 0.5 秒内（入场演出开始算出现）或还在屏幕外：这一下玩家来不及反应（节奏报告记为不公平受击） */
  freshFoe(e) { if (!e) return false; if (e.isBoss) return this.bossIntroT > 0; const s = e.shownT != null ? e.shownT : e.seenT; return s === null || s === undefined || this.t - s < 0.5 || e.x - e.r > this.W; }
  /* 节奏采样（金牌制作人节奏报告，每秒一次）：intensity 屏幕上的威胁、rewards 累计奖励、unfair 不公平受击、power 有敌人在场时每秒打出的伤害 */
  pacing() {
    const p = this.me, W = this.W; let I = 0;
    if (this.state === 'play' && !this.worldRitual()) {
      for (const e of this.enemies) {
        if (!e.alive || e.x - e.r > W || e.x + e.r < 0) continue;
        const w = e.isBoss ? 10 : e.elite || e.type === 'cmdr' ? 4 : e.type === 'armor' || e.type === 'mirror' ? 3 : e.type === 'beacon' || e.type === 'wreck' ? 2 : e.type === 'jelly' || e.type === 'moth' || e.fodder ? 1 : 1.5;
        I += w * (1 + Math.max(0, 1 - Math.hypot(e.x - p.x, e.y - p.y) / 600));
      }
      if (this.boss && !this.enemies.includes(this.boss)) I += 10;
      this.bullets.each((b) => { if (b.ghost > 0) return; I += Math.abs(b.x - p.x) < 220 && Math.abs(b.y - p.y) < 160 ? 0.6 : 0.2; });
      I += this.warns.filter((w) => !w.fired).length * 2;
    }
    const d = this.m.dmgOut - (this._paceDmg || 0); this._paceDmg = this.m.dmgOut;
    const engaged = this.enemies.some((e) => e.alive && e.x - e.r < W && e.x + e.r > 0) || !!this.boss;
    const boss = this.wonRun ? 1 : 0;
    const rewards = p.picks.length + p.res.chests + this.m.golds + (this.m.goalTimes || []).length + this.m.interacts + this.m.elites + (this.m.bossBreaks || 0) + (this.m.lurkKills || 0) + boss;
    const sideSet = new Set((this.sideLog || []).filter((s) => this.t - s.t < 4).map((s) => s.side)); if (this.boss) sideSet.add('front'); // 最近 4 秒威胁从几个方向来（Boss 一直在前方）
    const sides = sideSet.size, tens = this.D && this.tension ? this.tension() : null;
    const phase = this.worldRitual() ? 'upgrade' : this.boss ? 'boss' : this.goal ? this.goal.B.kind : this.D ? this.D.st : 'none';
    return { intensity: I, rewards, over: !!this.done || this.state === 'dying' || this.state === 'victory', won: this.state === 'victory' || !!this.wonRun, phase, unfair: this.m.unfair, power: engaged && !this.worldRitual() ? d : 0, sides, tens };
  }

  /* ================================================== main step ================================================== */
  step(dt) {
    SimRNG.cur = this.rng; // 这一步里所有 srand 都来自这一局的随机源
    this.player = this.anchor();
    const rit = this.ritualFocus();
    if (this.hitstop > 0 && !rit) { this.hitstop -= dt; return; }
    this.focusK = approach(this.focusK, rit ? 0.1 : 1, dt / 0.25); // 奖励焦点：战场慢到 0.1 倍，仪式本身按真实时间走
    if (this.slowT > 0) { this.slowT -= dt; this.timeScale = smooth(this.timeScale, 0.3, 18, dt); } else this.timeScale = smooth(this.timeScale, 1, 8, dt);
    if (this.state === 'dying') this.timeScale = 0.35;
    const sdt = dt * this.timeScale * this.focusK;
    this.t += sdt;
    if (this.state === 'play' && this.mode === 'run' && !this.worldRitual()) { this.runT += sdt; this.m.workT += sdt; } // 仪式期间关卡计时暂停（单人）；有效战斗时间推进家园工作
    this.trauma = Math.max(0, this.trauma - dt * 6);
    this.flash = Math.max(0, this.flash - dt * 2.2); this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    this.arena.top = approach(this.arena.top, this.arenaTarget.top, 60 * dt); this.arena.bottom = approach(this.arena.bottom, this.arenaTarget.bottom, 60 * dt);
    this.scene.dir = this.boss && this.boss.phase === 3 ? -1 : 1;
    this.scene.speed = this.bursting ? 30 : this.worldRitual() ? 20 : this.phase === 'boss' && this.bossIntroT > 0 ? 12 : 90;
    this.scene.update(this.timeStop > 0 ? 0 : sdt);
    for (const tm of this.timers) { tm.t -= sdt; if (tm.t <= 0 && !tm.done) { tm.done = true; tm.fn(); } }
    this.timers = this.timers.filter((tm) => !tm.done);
    if (this.timeStop > 0) { this.timeStop -= sdt; if (this.timeStop <= 0) this.endTimeStop(); }
    if (this.reverseT > 0) this.reverseT -= sdt;

    for (const q of this.players) { if (q.gone) continue; this.player = q; this.updatePlayer(q.ritual ? dt : sdt); }
    this.player = this.anchor();
    if (this.state === 'play') {
      for (const q of this.players) {
        if (q.gone || !q.alive) continue; this.player = q;
        const own = rit || !!(q.ritual && q.ritual.st !== 'resume'); // 自己在升级时：自己的支援 / 僚机也停火
        if (!own) this.updateSkills(sdt); // 仪式期间：支援技能 / 冷却都暂停
        this.updateWingmen(q.ritual ? dt : sdt, own);
      }
      if (this.bursting) this.player = this.players[this.bursting.owner] || this.anchor();
      this.updateBurst(sdt);
      this.player = this.anchor();
      if (this.mode === 'run') { if (this.vs) this.updateVs(sdt); else { this.updateDirector(sdt); this.updateSurprise(sdt); } }
      else this.updatePreview(sdt);
      if (this.boss) { this._firer = 'boss'; this.boss.update(sdt); this._firer = null; if (this.bossProxy) { this.bossProxy.x = this.boss.x; this.bossProxy.y = this.boss.y; } }
      if (this.bossIntroT > 0) { this.bossIntroT -= sdt; if (this.bossIntroT <= 0) this.bossLand(); }
      if (this.phase === 'boss' && this.mode === 'run' && !this.vs) this.bossFlanks(sdt);
    } else if (this.state === 'dying') {
      this.stateT -= dt; if (this.stateT <= 0 && !this.done) this.finish(false);
    } else if (this.state === 'victory') {
      this.stateT -= dt;
      if (srnd() < 0.6) this.dropPickup('dust', srand(this.W * 0.2, this.W), -10, { vx: srand(-40, 40), vy: srand(120, 260), value: 3, big: true, rain: true, seed: 0 });
      if (this.stateT <= 0 && !this.done) this.finish(true);
    }
    this.updateIncoming(sdt);
    this.updateEnemies(sdt);
    this.updateBullets(sdt);
    this.updateShots(sdt);
    this.updatePickups(sdt);
    this.updateWarns(sdt);
    this.updateFx(sdt);
    if (!rit) this.updateStreak(sdt); // 连杀倒计时在仪式期间暂停
    this.updateHints();
    this.updateMap(sdt);
    for (const q of this.players) { if (q.gone) continue; this.player = q; this.updateRitual(dt); } // 每架飞机自己的升级队列 / 仪式
    if (this.mp) { this.teamRitualSync(); for (const q of this.players) if (q.away) q.awayClock = (q.awayClock || 0) + dt; } // 断线计时按真实时间（只用于显示剩余席位）
    this.player = this.anchor();
    if (this.mode === 'run' && this.state === 'play' && this.me.stock >= this.me.ultCap && !this.me.ritual) this.m.stockIdle += sdt;
    this.player = this.anchor();
    if (this.mode === 'run' && this.phase === 'fight' && this.state === 'play') {
      // 屏幕上有敌人，或 0.4 秒内刚击破过（敌人一进屏幕边缘就被打爆也算在战斗）
      const onScreen = this.enemies.some((e) => e.alive && !e.isBoss && e.x - e.r < this.W) || this.incoming.length > 0 || (this.recentKills.length > 0 && this.t - this.recentKills[this.recentKills.length - 1] < 0.4);
      // 时间暂停 / 大招演出不算空档
      // 选择升级 / 地图互动时刻意停刷怪，不算空档
      if (!onScreen && this.timeStop <= 0 && !this.bursting && !this.worldRitual() && !(this.surprise && this.surprise.busy)) this.m.gapT += sdt;
      else { this.m.gapMax = Math.max(this.m.gapMax, this.m.gapT); this.m.gapT = 0; }
    }
    this.player = this.me;
  }

  /* ================================================== player ================================================== */
  updatePlayer(dt) {
    const p = this.player, I = this.inputs[p.idx] || NEUTRAL_INPUT;
    p.inv = Math.max(0, p.inv - dt); p.hurtT = Math.max(0, p.hurtT - dt * 3); if (p.muzzle) p.muzzle = Math.max(0, p.muzzle - dt * 16); if (p.linkFx) p.linkFx = Math.max(0, p.linkFx - dt); p.cloudCd = Math.max(0, p.cloudCd - dt); p.candy = Math.max(0, p.candy - dt);
    p.blinkT -= dt; if (p.blinkT <= 0) { p.blink = 1; p.blinkT = 2 + Math.random() * 3; } p.blink = Math.max(0, p.blink - dt * 8); // 眨眼只是表现
    if (!p.alive) { this.downTick(p, dt); I.burst = false; return; }
    if (p.away) { p.inv = Math.max(p.inv, 0.2); p.vx = p.vy = 0; I.burst = false; I.dx = I.dy = 0; return; } // 断线占位：原地不动、不开火
    let mx = 0, my = 0, dx = I.dx || 0, dy = I.dy || 0;
    const lock = this.ritual && this.ritual.st !== 'choose' && this.ritual.st !== 'resume'; // 仪式里飞机稳住，只有选择阶段能动
    if (this.mode === 'run' && this.state === 'play' && !lock) { mx = I.mx; my = I.my; }
    if (lock || this.mode !== 'run') { dx = 0; dy = 0; }
    I.dx = 0; I.dy = 0; // 拖动位移只用一次
    if (this.mode === 'preview') my = clamp(((TOP + BOTTOM) / 2 + Math.sin(this.t * 1.2) * 60 - p.y) / 60, -1, 1);
    const spd = 400 * this.P.speed * (I.focus && this.mode === 'run' ? 0.5 : 1);
    const ox = p.x, oy = p.y;
    if (!(this.bfx && this.bfx.id === 'cloud' && this.bursting && this.bursting.owner === p.idx)) { p.x += mx * spd * dt + dx; p.y += my * spd * dt + dy; }
    p.x = clamp(p.x, 34, this.W * 0.82); p.y = clamp(p.y, this.arena.top + 14, this.arena.bottom - 14);
    if (this.vs) this.vsClamp(p, dt); // 对抗：只能在自己的航道里（冲突区开放时能伸进交界的带子）
    p.vx = (p.x - ox) / Math.max(dt, 1e-4); p.vy = (p.y - oy) / Math.max(dt, 1e-4);
    p.moved += Math.hypot(p.x - ox, p.y - oy);
    p.tilt = smooth(p.tilt, clamp(p.vy / 900, -0.35, 0.35), 12, dt);
    p.trailT -= dt; if (p.trailT <= 0) { p.trailT = 0.018; p.trail.push({ x: p.x - 26, y: p.y + 2, t: 0 }); if (p.trail.length > 28) p.trail.shift(); }
    for (const q of p.trail) { q.t += dt; q.x -= 180 * dt; }
    if (this.state !== 'play') return;
    if (this.mode === 'run' && I.burst) { I.burst = false; if (this.ritual && this.ritual.st === 'choose') this.chooseRecommended(); else this.tryBurst(); } // 选升级时大招键 = 选推荐
    p.fireT -= dt;
    const rate = this.P.rate * (p.candy > 0 ? 1.5 : 1) * (this.streak.n >= 30 ? 1.1 : 1);
    if (this.ritual && this.ritual.st !== 'resume') p.fireT = Math.max(p.fireT, 0.05); // 仪式期间自动射击暂停
    else if (p.fireT <= 0) { p.fireT += 1 / rate; if (p.fireT < -0.1) p.fireT = 0; this.fireMain(); }
    if (p.inv <= 0 && !(this.bfx && this.bfx.id === 'cloud' && this.bursting && this.bursting.owner === p.idx) && this.mode === 'run') {
      for (const e of this.enemies) {
        if (!e.alive || e.leaving || e.nocontact || this.freshFoe(e)) continue; // 刚出现的敌人还不能撞人（先看见，再受伤）
        const rr = (e.isBoss ? 110 : e.r) + 8;
        if (dist2(e.x, e.y, p.x, p.y) < rr * rr) { if (e.lurk && this.lurks) { const L = this.lurks.find((q) => q.id === e.lurk); if (L) L.hit = true; } this._hitFresh = this.freshFoe(e); this.hurtPlayer(1, 'c:' + (e.chaser ? 'chaser' : e.isBoss ? 'boss' : e.type)); if (!e.elite && !e.isBoss && !e.lurk && e.type !== 'mirror' && e.type !== 'armor' && e.type !== 'wreck') this.killEnemy(e, { contact: true }); break; }
      }
    }
  }
  /* 主炮：固定向右；多重 = 并排多路；每颗弹带上当前穿透 / 追踪 / 爆破等级 */
  fireMain() {
    const p = this.player, d = this.P.dmg * this.stats.dmgK, x = p.x + 24, y = p.y + 2, n = 1 + this.gun.multi;
    const lanes = [[0], [-9, 9], [-15, 0, 15], [-21, -7, 7, 21]][n - 1], dl = (d * BUILD_CHECK.multiK[n - 1]) / n; // 多重：多出来的几路扫得更宽，但打同一个大目标时总伤害只涨到 multiK 倍（不是路数倍）
    for (const off of lanes) this.gunShot(x, y + off, off * 0.004, dl, { side: off !== 0 });
    p.muzzle = 1; // 画面：炮口闪一下
    if (this.hasSyn('homing', 'wing')) for (const w of this.wingmen) if (!w.burst) w.fireT = Math.min(w.fireT, 0.02);
    if (p === this.me && Math.random() < 0.3) Sound.sfx('shoot', { gap: 120 });
  }
  gunShot(x, y, a, dmg, o = {}) {
    const kind = { moon: 'moon', cloud: 'puff', candy: 'candyS', paper: 'dart', whale: 'bubble', clock: 'hand' }[this.planeId] || 'moon';
    const s = this.addShot(o.from === 'wing' ? 'wingDart' : kind, x, y, a, 1150, { dmg, r: o.from === 'wing' ? 7 : 10, from: o.from || 'main', life: 1.25, knock: this.planeId === 'cloud' && !o.from ? 18 : 0, gold: o.gold });
    if (!s) return null;
    const pl = this.gun.pierce;
    s.gun = true; s.pierce = pl ? pl + this.stats.pierceX : 0; s.pierceMax = s.pierce; s.side = !!o.side; s.bombLv = this.gun.bomb; s.pierceLv = pl; s.hist = null;
    const hl = Math.min(3, this.gun.homing + (o.homBonus || 0));
    s.homLv = hl; s.target = null; s.lost = false;
    if (hl) { s.homTurn = (HOMING.turn[hl] * (1 + this.stats.homingX) * Math.PI) / 180; s.homCone = (HOMING.cone[hl] * Math.PI) / 180; }
    return s;
  }
  /* 追踪：只找前方搜索角内最近的敌人；1~2 级目标丢了就直飞，3 级会重新找 */
  findForward(s) {
    const a = Math.atan2(s.vy, s.vx); let best = null, bd = 760 * 760;
    for (const e of this.enemies) {
      if (!e.alive || s.hits.includes(e.id) || e.x > this.W + 30) continue;
      if (Math.abs(angDiff(a, angTo(s.x, s.y, e.x, e.y))) > s.homCone) continue;
      const d = dist2(s.x, s.y, e.x, e.y); if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  steerGunShot(s, dt) {
    if (s.target && (!s.target.alive || s.hits.includes(s.target.id))) { s.target = null; if (s.homLv < 3) s.lost = true; }
    if (!s.target && !s.lost) s.target = this.findForward(s);
    if (!s.target) return;
    const a = Math.atan2(s.vy, s.vx), d = angDiff(a, angTo(s.x, s.y, s.target.x, s.target.y));
    if (Math.abs(d) > Math.PI * 0.6) { s.target = null; if (s.homLv < 3) s.lost = true; return; } // 已经飞过头：不回头绕圈
    const na = a + clamp(d, -s.homTurn * dt, s.homTurn * dt), sp = Math.hypot(s.vx, s.vy);
    s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp;
  }
  hurtPlayer(n, src, who) {
    const p = who || this.player, fresh = this._hitFresh; this._hitFresh = false;
    if (!p.alive || p.away || p.inv > 0 || this.state !== 'play' || this.mode === 'preview') return;
    const inRit = !!(p.ritual && p.ritual.st !== 'resume');
    if (!inRit && p === this.me) { const c = hurtCat(src); this.m.hurt = this.m.hurt || {}; this.m.hurt[c] = (this.m.hurt[c] || 0) + 1; this.m.lastHurt = c; } // 受伤来源：结算复盘用（本机这架）
    if (inRit) return; // 升级仪式期间不会受伤
    if (p.cloudShield) { p.cloudShield = false; p.inv = 0.8; Sound.sfx('shieldPop'); this.text('缓冲云挡住了', p.x, p.y - 40, '#dcefff', 16, 4); for (let i = 0; i < 10; i++) this.part('puff', p.x, p.y, rand(-160, 160), rand(-160, 160), 0.6, rand(8, 14), 'rgba(255,255,255,0.9)'); return; }
    p.hp -= n; p.inv = 1.4; p.hurtT = 1; this.m.hitsTaken++;
    if (fresh) this.m.unfair++; // 节奏报告：攻击者刚出现（或在屏幕外）就打中了
    this.hitStop(0.05); // 受击：红色暗角 + 顿帧 + 手柄震，不晃镜头（暗角和震动只给被打的那位）
    if (p === this.me) { this.hurtFlash = 1; this.rumble(0.7, 0.9, 160); Sound.sfx('hurt', { prio: true }); }
    for (let i = 0; i < 12; i++) this.part('dot', p.x, p.y, rand(-220, 220), rand(-220, 220), 0.45, 3.5, 'rgba(255,122,107,0.95)');
    if (p.planeId === 'cloud' && p.cloudCd <= 0 && p.hp > 0) { p.cloudShield = true; p.cloudCd = 12; this.text('缓冲云层', p.x, p.y - 44, '#dcefff', 15, 3); }
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false;
      if (this.vs) { this.vsDown(p, src); return; } // 对抗：短暂击毁后原地复归
      if (this.np > 1 && this.alivePlayers().length) { // 多人：倒下后等队友来救（不自动复活）；在线的全部倒下才算失败
        p.downT = 0; p.saveT = 0; this.text(`${p.name || '队友'} 倒下了`, p.x, p.y - 40, '#ffb2a8', 18, 5);
        this.bullets.each((b) => { if (dist2(b.x, b.y, p.x, p.y) < RESCUE.clear * RESCUE.clear) b.on = false; }); // 救援点留出空间
        for (let i = 0; i < 14; i++) this.part('dot', p.x, p.y, rand(-220, 220), rand(-220, 220), 0.6, 4, 'rgba(255,122,107,0.95)');
        this.emit('down', { idx: p.idx });
      } else { this.state = 'dying'; this.stateT = 1.6; this.slowT = 1.4; Sound.sfx('lose'); this.clearBullets(false); }
    }
  }
  /* 多人：倒下的飞机留下残骸和一个宽救援圈——队友飞进圈里停约 2 秒就地救起（不加按键），不会自动复活（v0.11 §8）。
     救起后回约 40% 生命、约 2 秒保护；不送大招、不加全队 Buff。救援圈里的敌弹会化掉，队友不用贴着看不见的弹幕冒险 */
  downTick(p, dt) {
    if (this.np < 2 || p.gone || this.state !== 'play' || this.vs) return; // 对抗不用救援：到时间原地复归
    p.downT += dt; const R2 = RESCUE.r * RESCUE.r;
    this.bullets.each((b) => { if (dist2(b.x, b.y, p.x, p.y) < R2) { b.on = false; if (Math.random() < 0.4) this.part('mote', b.x, b.y, rand(-30, 30), rand(-60, -10), 0.5, 2.5, 'rgba(159,242,200,0.9)'); } });
    const near = this.alivePlayers().find((q) => dist2(q.x, q.y, p.x, p.y) < R2);
    p.saveT = near ? (p.saveT || 0) + dt : Math.max(0, (p.saveT || 0) - dt * 0.5);
    if (near && p.saveT >= RESCUE.dwell) {
      p.alive = true; p.hp = Math.max(1, Math.ceil(p.maxHp * RESCUE.hp)); p.inv = RESCUE.inv; p.saveT = 0; p.downT = 0;
      this.fx(p.x, p.y, 2, 80, ['#ffffff', '#9ff2c8', '#ffe38a']); this.text(`${near.name || '队友'} 救起了 ${p.name || '队友'}`, p.x, p.y - 44, '#9ff2c8', 18, 5); Sound.sfx('heart');
      this.emit('revive', { idx: p.idx, by: near.idx });
    }
  }
  /* 多人：断线中（v0.11 §8 保留席位）——从约定好的那一帧起这架飞机原地占位：不动、不开火、不受伤、敌人不瞄它，不拖住全队升级；回来后接着玩 */
  setAway(i, on) {
    const p = this.players[i]; if (!p || p.gone || !!p.away === on) return;
    p.away = on;
    if (on) { p.wingmen = []; p.awayClock = 0; this.text(`${p.name || (this.vs ? '对手' : '队友')} 断线中…`, p.x, p.y - 40, '#ffb2a8', 16, 4); this.emit('away', { idx: i }); }
    else { p.inv = Math.max(p.inv, 2); this.syncWingmenOf(p); this.text(`${p.name || '队友'} 回来了`, p.x, p.y - 40, '#9ff2c8', 16, 4); this.emit('back', { idx: i }); }
  }
  syncWingmenOf(p) { this.withPlayer(p, () => this.syncWingmen()); }
  /* 断线中还剩多少秒席位（按断线开始的那一帧算，各端看到的一样；只用于显示） */
  seatLeft(p) { return Math.max(0, Math.ceil(60 - (p.awayClock || 0))); }
  /* 多人：有人断线太久 / 退出 —— 从约定好的那一帧起移除这架飞机 */
  dropPlayer(i) {
    const p = this.players[i]; if (!p || p.gone) return;
    p.gone = true; p.alive = false; p.wingmen = []; p.ritual = null; p.ritualQueue = []; // 离开的人不再参与升级确认，其他人照常继续
    if (this.bursting && this.bursting.owner === i) { this.bursting = null; this.bfx = null; }
    this.text(p.away ? `${p.name || '玩家'} 断线超过 60 秒，按退出处理` : `${p.name || '玩家'} 离开了`, p.x, p.y - 40, '#ffb2a8', 18, 5); p.timedOut = !!p.away;
    this.emit('left', { idx: i });
    if (!this.alivePlayers().length && this.state === 'play') { this.state = 'dying'; this.stateT = 1.6; }
  }

  /* ================================================== shots ================================================== */
  addShot(kind, x, y, a, spd, o = {}) {
    const s = this.shots.get(); if (!s) return null;
    s.on = true; s.kind = kind; s.x = x; s.y = y; s.vx = Math.cos(a) * spd; s.vy = Math.sin(a) * spd; s.t = 0;
    s.dmg = o.dmg || 8; s.r = o.r || 6; s.life = o.life || 1.6; s.pierce = o.pierce || 0; s.hits = []; s.homing = o.homing || 0;
    s.from = o.from || 'skill'; s.knock = o.knock || 0; s.wave = o.wave || 0; s.freeze = o.freeze || 0; s.gold = !!o.gold;
    s.hitCd = null; s.chain = o.chain || 0; s.y0 = y; s.ty = o.ty || 0;
    s.gun = false; s.homLv = 0; s.pierceMax = 0; s.pierceLv = 0; s.bombLv = 0; s.side = false; s.target = null; s.lost = false; s.hist = null; s.histT = 0; // 对象池复用：上一发主炮弹的改造不能带到技能弹上
    s.owner = o.owner !== undefined ? o.owner : this.player.idx; // 谁打的：击杀充能记给谁
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
      if (s.homLv) { this.steerGunShot(s, dt); s.histT = (s.histT || 0) - dt; if (s.histT <= 0) { s.histT = 0.022; (s.hist = s.hist || []).push(s.x, s.y); if (s.hist.length > 16) s.hist.splice(0, 2); } } // 追踪弹的尾迹（画面用）
      else if (s.homing && s.t > 0.08) {
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
        this.withPlayer(this.players[s.owner], () => this.onShotHit(s, e)); // 命中 / 击杀算在开枪的人头上（充能、掉落）
        if (s.pierce-- <= 0) { s.on = false; return; }
      }
      if (this.vs && s.gun) this.vsPvpShot(s); // 对抗：冲突区里主炮能打到对手
    });
  }
  onShotHit(s, e) {
    const hx = s.x, hy = s.y;
    if (s.kind === 'orb') { this.zap(s.x, s.y, e, s.chain, s.dmg); Sound.sfx('zap', { pan: this.pan(e.x), gap: 50 }); return; }
    if (s.gun) return this.onGunHit(s, e, hx, hy);
    this.damageEnemy(e, s.dmg, { x: hx, y: hy, src: s.from, kind: s.kind });
    if (s.knock && !e.isBoss && !e.elite && e.alive) e.x += s.knock;
    if (!e.alive || e.isBoss) { this.part('dot', hx, hy, rand(-90, 90), rand(-90, 90), 0.2, 2.5, 'rgba(255,243,176,0.95)'); return; }
    if (s.freeze && srnd() < s.freeze) this.freezeEnemy(e, 1.2);
    this.part('dot', hx, hy, rand(-90, 90), rand(-90, 90), 0.2, 2.5, 'rgba(255,243,176,0.95)');
  }

  /* 主炮命中：先标记（爆破），再结算伤害；穿透不衰减，一颗弹对同一敌人只结算一次 */
  onGunHit(s, e, hx, hy) {
    const last = s.pierce <= 0, b = this.gun.bomb;
    if (b && !e.isBoss && srnd() < [0, 0.45, 0.6, 0.75][b]) e.mark = true;
    this.damageEnemy(e, s.dmg, { x: hx, y: hy, src: s.from, kind: s.kind, dir: Math.atan2(s.vy, s.vx) });
    if (s.knock && !e.isBoss && !e.elite && e.alive) e.x += s.knock;
    if (s.side && this.hasSyn('multi', 'ice') && e.alive) this.freezeEnemy(e, 0.8);
    if (s.homLv && this.hasSyn('homing', 'thunder') && srnd() < 0.5) { const n2 = this.nearestEnemy(hx, hy, 200, new Set([e.id])); if (n2) this.zap(hx, hy, n2, 0, 8 * this.stats.dmgK); }
    if (last) {
      if (s.pierceMax > 0 && this.hasSyn('pierce', 'bomb')) this.explode(hx, hy, 85 * this.stats.blastK, 30 * this.stats.dmgK, { level: 2 });
      else if (b >= 3) this.explode(hx, hy, 42 * this.stats.blastK, 8 * this.stats.dmgK, { level: 1, quiet: true });
    }
    if (s.pierceMax > 0 && !last) this.part('spark', hx, hy, s.vx * 0.3, s.vy * 0.3, 0.25, 3, '#ffe38a');
    this.part('dot', hx, hy, rand(-90, 90), rand(-90, 90), 0.2, 2.5, 'rgba(255,243,176,0.95)');
  }

  /* ================================================== enemies ================================================== */
  makeEnemy(type, o = {}) {
    const elite = type.endsWith('E'), base = elite ? type.slice(0, -1) : type;
    // 关卡基础配置固定：生命只随关卡变（×1 / ×9/8 / ×10/8），不随玩家变强偷偷加血
    const big = elite || type === 'armor' || type === 'cmdr' || type === 'wreck' || type === 'mirror' || o.elite || o.goal;
    const hpK = (this.stage ? this.stage.hpK : 1) * (big && this.np > 1 ? this.teamK(0.6) : 1); // 多人：硬目标按人数加厚
    const e = Object.assign({
      id: this.eid++, type, base, elite, x: this.W + 40, y: (TOP + BOTTOM) / 2, vx: -150, vy: 0, r: ENEMY_R[type] || 20, hp: (ENEMY_HP[type] || 10) * hpK,
      t: 0, seed: srand(10), path: 'line', amp: 0, freq: 0, phase: 0, fireT: srand(1.5, 3.5), charge: 0, alive: true, hitFlash: 0, frozen: 0, stun: 0,
      mark: false, clockMark: false, seenT: null, fire: null, fodder: false, leaving: false, shots: 0, pull: null,
    }, o);
    e.maxHp = e.hp; e.y0 = e.y;
    if (this.seg && this.seg.explosive && !elite) e.explosive = true;
    return e;
  }
  addEnemy(type, o = {}) { const e = this.makeEnemy(type, o); this.enemies.push(e); return e; }
  spawnFormation(kind) {
    const W = this.W, tier = this.seg ? this.seg.tier : 0, top = this.arena.top + 50, bot = this.arena.bottom - 50;
    const y0 = srand(top, bot), sp = 1 + tier * 0.05;
    switch (kind) {
      case 'line': { const n = 5 + Math.min(3, tier); for (let i = 0; i < n; i++) this.addEnemy('jelly', { x: W + 10 + i * 56, y: y0, path: 'sine', vx: -150 * sp, amp: 18, freq: 2.2, phase: i * 0.5 }); break; }
      case 'vee': for (let i = 0; i < 7; i++) { const k = i - 3; this.addEnemy('moth', { x: W + 10 + Math.abs(k) * 42, y: clamp(y0 + k * 32, top, bot), path: 'line', vx: -200 * sp }); } break;
      case 'snake': for (let i = 0; i < 8; i++) this.addEnemy('moth', { x: W + 10 + i * 44, y: clamp(y0, top + 60, bot - 60), path: 'sine', vx: -170 * sp, amp: 80, freq: 1.7, phase: -i * 0.4 }); break;
      case 'wall': { const n = 6, gap = srandi(1, 4); for (let i = 0; i < n; i++) if (i !== gap) this.addEnemy('jelly', { x: W + 10, y: lerp(top, bot, i / (n - 1)), path: 'line', vx: -125 * sp }); break; }
      case 'boats': for (let i = 0; i < 2 + (tier >= 3 ? 1 : 0); i++) this.addEnemy('boat', { x: W + 40 + i * 140, y: lerp(top, bot, (i + 0.5) / 3) + srand(-20, 20), path: 'line', vx: -95 * sp, fire: 'drop', fireT: srand(0.6, 1.4) }); break;
      case 'stars': for (let i = 0; i < 2; i++) this.addEnemy('star', { x: W + 40 + i * 90, y: clamp(y0 + (i ? 70 : -70), top, bot), path: 'dive', vx: -230 * sp, fire: 'aim' }); break;
      case 'ticks': for (let i = 0; i < 2 + (tier >= 4 ? 1 : 0); i++) this.addEnemy('tick', { x: W + 40, y: srand(top, bot), path: 'hover', tx: srand(W * 0.55, W * 0.86), ty: srand(top, bot), stay: 3.5, fire: 'ring', fireT: 1.2 }); break;
      case 'swarm': for (let i = 0; i < 12; i++) this.addEnemy('moth', { x: W + 10 + srand(0, 220), y: srand(top, bot), path: 'line', vx: -srand(160, 260) * sp }); break;
      case 'beacon': { const flip = srnd() < 0.5; this.addEnemy('beacon', { x: srand(W * 0.55, W * 0.86), y: flip ? this.arena.top - 2 : this.arena.bottom - 30, flip, path: 'fixed', fire: 'laser', fireT: 1.4, life: 12 }); break; }
      case 'dustmoths': for (let i = 0; i < 6; i++) this.addEnemy('moth', { x: W - 10 + i * 50, y: clamp(y0 + Math.sin(i) * 40, top, bot), path: 'sine', vx: -210, amp: 40, freq: 2, phase: i * 0.6, fodder: true }); break;
    }
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy({ line: 'jelly', vee: 'moth', snake: 'moth', wall: 'jelly', boats: 'boat', stars: 'star', ticks: 'tick', swarm: 'moth', beacon: 'beacon', dustmoths: 'moth' }[kind]);
  }
  spawnElite() {
    const type = spick(this.stage.elites);
    this.addEnemy(type, { x: this.W + 60, y: (this.arena.top + this.arena.bottom) / 2, path: 'elite', tx: this.W * 0.74, fireT: 1.6, life: 26 });
    this.emit('elite', { elite: type });
    if (this.cb.onSeenEnemy) this.cb.onSeenEnemy(type);
  }
  updateEnemies(dt) {
    const frozenWorld = this.timeStop > 0, quiet = this.ritualFocus();
    for (const e of this.enemies) {
      const p = this.np > 1 ? this.nearestPlayer(e.x, e.y) : this.player; // 多人：每个敌人盯离自己最近的飞机
      if (!e.alive || e.isBoss) continue;
      e.t += dt; e.hitFlash = Math.max(0, e.hitFlash - dt * 6); if (e.kick) e.kick = Math.max(0, e.kick - dt * 9);
      if (e.seenT === null && e.x < this.W - 10) e.seenT = this.t;
      if (frozenWorld) continue;
      if (e.frozen > 0) e.frozen -= dt;
      if (e.stun > 0) { e.stun -= dt; continue; }
      if (e.pull) { const a = angTo(e.x, e.y, e.pull.x, e.pull.y); e.x += Math.cos(a) * e.pull.v * dt; e.y += Math.sin(a) * e.pull.v * dt; continue; }
      const mdt = dt * (e.frozen > 0 ? 0.3 : 1);
      if (!this.moveFoe(e, mdt, p)) this.moveEnemy(e, mdt, p);
      this._firer = e.chaser ? 'chaser' : e.type; this._firerE = e;
      if (e.frozen <= 0 && this.mode === 'run' && this.state === 'play' && !e.fodder && !quiet && !this.freshFoe(e) && !this.foeFire(e, dt, p)) this.enemyFire(e, dt, p); // 仪式期间、刚出现 0.5 秒内敌人不发起新攻击
      if (e.life && e.t > e.life && !e.leaving) { e.leaving = true; e.vx = -320; if (e.path !== 'line') e.path = 'line'; }
      if (e.x < -80 || e.x > this.W + 400 || e.y < -120 || e.y > LH + 120) { e.alive = false; if (e.x < -80 && !e.fodder && !e.escort && this.mode === 'run') this.m.leaks++; } // 漏过只影响额外评分
    }
    this._firer = null; this._firerE = null;
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
      if (tier >= 1 && onScreen && e.fireT <= 0) { e.fireT = srand(3, 5.5); if (srnd() < 0.45) this.fire('pink', e.x - 10, e.y, this.aimAngle(e.x, e.y), 165 * spd); }
      return;
    }
    if (e.fire === 'drop') { if (onScreen && e.fireT <= 0) { e.fireT = 1.5; const a = angTo(e.x, e.y, p.x, p.y); this.fire('pink', e.x - 14, e.y + 8, Math.PI + clamp(angDiff(Math.PI, a), -0.5, 0.5), 175 * spd); } return; }
    if (e.fire === 'aim') { if (onScreen && e.shots < 1 && e.x < this.W * 0.82) { e.shots++; this.fire('gold', e.x - 16, e.y, this.aimAngle(e.x, e.y), 230 * spd); } return; }
    if (e.fire === 'ring') {
      if (!e.leaving && Math.abs(e.x - e.tx) < 30) {
        e.charge = e.fireT < 0.6 ? 1 - e.fireT / 0.6 : 0;
        if (e.fireT <= 0) { e.fireT = 2.6; const n = 8 + Math.min(4, tier), gap = srandi(0, n - 1), off = srand(TAU); for (let i = 0; i < n; i++) if (i !== gap && i !== (gap + 1) % n) this.fire('pink', e.x, e.y, off + (i / n) * TAU, 140 * spd, { silent: i > 0 }); }
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
      else if (e.base === 'tick') { const n = 14, off = srand(TAU); for (let i = 0; i < n; i++) if (i % 7) this.fire('pink', e.x, e.y, off + (i / n) * TAU, 135 * spd, { silent: i > 0 }); for (let q = 0; q < 4; q++) for (let j = 0; j < 3; j++) this.fire('blue', e.x, e.y, (q * Math.PI) / 2 + Math.PI / 4 + e.t, (140 + j * 40) * spd, { silent: true }); }
      else { let k = 0; const vol = () => { if (!e.alive || k++ >= 3 || this.state !== 'play') return; this.fire('gold', e.x - 20, e.y, this.aimAngle(e.x, e.y), 225 * spd); this.later(0.45, vol); }; vol(); }
      return;
    }
    if (e.type === 'mirror' && e.fireT <= 0) { e.fireT = 2.4; const a0 = this.aimAngle(e.x, e.y); for (let i = 0; i < 5; i++) this.fire('pink', e.x, e.y, a0 + (i - 2) * 0.2, 170, { silent: i > 0 }); }
  }
  damageEnemy(e, dmg, o = {}) {
    if (!e.alive) return;
    this.m.dmgOut += dmg;
    if (e.isBoss) {
      if (!this.boss) return;
      let k = this.stats.bossK / this.teamK(0.7) / (BUILD_CHECK.bossK[this.stageId] || 1); // 多人：Boss 按人数加厚（固定系数，不随成长变）；bossK：要成型的火力才打得动
      if (this.boss.conductive && o.kind === 'zap') k *= 1.3;
      if (this.boss.marked && o.kind === 'explosion') k *= 1.5;
      this.boss.hit({ dmg: dmg * k, x: o.x !== undefined ? o.x : e.x, y: o.y !== undefined ? o.y : e.y, kind: o.kind || 'shot' });
      if (this.carnival && srnd() < 0.02) this.dropPickup('candy', e.x - 60, e.y + srand(-80, 80));
      return;
    }
    const sk = this.shieldK(e, o);
    if (sk !== 1) { dmg *= sk; if (sk < 0.5) Sound.sfx('clink', { pan: this.pan(e.x), gap: 90, k: 0 }); }
    if (e.armorHp > 0) { dmg = this.armorDamage(e, dmg, o); if (dmg <= 0) return; } // 厚甲：先敲甲，碎了多出来的伤害才打到核心
    e.hp -= dmg * (e.frozen > 0 ? 1.25 : 1); e.hitFlash = 1;
    if (e.hp <= 0) this.killEnemy(e, o);
    else { e.kick = 1; e.kickA = o.dir !== undefined ? o.dir : 0; if (this.mine()) Sound.sfx('hit', { pan: this.pan(e.x), gap: e.elite || e.type === 'cmdr' ? 70 : 45 }); }
  }
  killEnemy(e, o = {}) {
    if (!e.alive) return;
    e.alive = false;
    const p = this.player, small = !e.elite && e.type !== 'mirror';
    this.m.kills++;
    if (e.lurk) this.onLurkKilled(e); // 打碎了地图伸出来的东西：额外奖励
    if (this.m.firstKill === null) this.m.firstKill = this.runT;
    if (small && e.seenT !== null && !e.fodder) { this.m.killTimeSum += this.t - e.seenT; this.m.killTimeN++; }
    this.streak.n++; this.streak.t = 2.5;
    const armored = e.type === 'armor';
    this.addCharge(e.elite ? 0.12 : armored ? 0.04 : 0.0032);
    this.killPop(e, o);
    this.recentKills.push(this.t); while (this.recentKills.length && this.t - this.recentKills[0] > 0.4) this.recentKills.shift();
    // 击杀声：连续击杀音高慢慢升（有上限）；精英 / 厚甲有自己的终结声
    Sound.sfx(e.elite ? 'eliteKill' : armored ? 'armorKill' : 'kill', { pan: this.pan(e.x), gap: 35, k: Math.min(6, this.recentKills.length - 1), prio: e.elite });
    if (e.elite) { this.hitStop(0.055); this.rumble(0.8, 0.6, 140); } else if (armored) { this.armorTimed(e); this.rumble(0.3, 0.5, 70); }
    if (this.bursting) this.burstKills.push({ x: e.x, y: e.y, key: e.elite || armored });
    if (this.recentKills.length >= 4 && this.chainCd <= 0) { this.chainCd = 0.5; this.fx(e.x, e.y, 2, 90); if (this.chainHiCd <= 0) { this.chainHiCd = 8; this.highlight(); } }
    if (e.elite) {
      this.m.elites++; this.highlight();
      for (let i = 0; i < 14; i++) this.dropPickup('dust', e.x + srand(-30, 30), e.y + srand(-30, 30), { value: 2, big: i < 4, vx: srand(-200, 140), vy: srand(-460, -160) }); // 喷泉一样喷出来
      this.addCharge(0.15); this.shake(0.4);
    } else if (armored) {
      for (let i = 0; i < 4; i++) this.dropPickup('dust', e.x, e.y, { value: 1, big: i === 0 });
    } else if (e.type === 'mirror' || e.type === 'wreck') {
      for (let i = 0; i < 6; i++) this.dropPickup('dust', e.x, e.y, { value: 2 });
    } else {
      const n = e.swell ? 1 : e.fodder ? 3 : e.base === 'moth' ? 2 : srnd() < 0.6 ? 1 : 0;
      for (let i = 0; i < n; i++) this.dropPickup('dust', e.x, e.y, { value: 1 });
      if (this.planeId === 'candy' && srnd() < 0.08) this.dropPickup('candy', e.x, e.y, this.mineDrop()); // 自己机型 / 技能带来的掉落只给自己
      if (o.src === 'beam' && this.lvOf('rainbow') >= 3 && srnd() < 0.35) this.dropPickup('candy', e.x, e.y, this.mineDrop());
      if (srnd() < 0.012 && p.hp < p.maxHp) this.dropPickup('heart', e.x, e.y);
      if (o.candify) this.dropPickup('candy', e.x, e.y, this.mineDrop());
    }
    const bombLv = this.lvOf('bomb');
    if ((e.mark && (bombLv || e.bigMark !== undefined)) || e.explosive) {
      const lv = Math.max(1, bombLv), rb = this.hasSyn('bomb', 'rainbow') ? 1.4 : 1, marked = e.mark && bombLv;
      const r = (marked ? 60 + 15 * lv : 50) * this.stats.blastK * rb * (e.bigMark ? 1.5 : 1), dmg = (marked ? (18 + 8 * lv) * (lv >= 4 ? 1.5 : 1) : 10) * this.stats.dmgK;
      this.later(0.05, () => this.explode(e.x, e.y, r, dmg, { level: lv >= 5 ? 3 : 2, chainMark: lv >= 3 && marked, fireworks: lv >= 5 || rb > 1 }));
    }
    const iceLv = this.lvOf('ice');
    if (e.frozen > 0 && iceLv >= 3) {
      const r = 70 * this.stats.blastK, dmg = (12 + 4 * iceLv) * (iceLv >= 4 ? 1.5 : 1);
      this.later(0.04, () => { this.shatter(e.x, e.y, r, dmg); if (this.hasSyn('bomb', 'ice')) this.explode(e.x, e.y, r * 0.9, dmg, { level: 2 }); });
      if (this.hasSyn('rainbow', 'ice') && srnd() < 0.4) this.dropPickup('candy', e.x, e.y, this.mineDrop());
      if (this.hasSyn('magnet', 'ice')) for (let i = 0; i < 2; i++) this.dropPickup('dust', e.x, e.y, Object.assign({ value: 1 }, this.mineDrop()));
    }
    if (e.clockMark && !o.clock) this.later(0.02, () => this.explode(e.x, e.y, 60 * this.stats.blastK, 40, { level: 2 }));
    this.onCompanionKill(e);
    if (this.mode === 'run' && this.onGoalEvent) this.onGoalEvent('kill', e);
    if (this.vs) this.vsKill(e);
    if (this.cb.onKill) this.cb.onKill(e.type);
  }
  freezeEnemy(e, s) { if (e.isBoss || !e.alive) return; if (e.frozen <= 0) Sound.sfx('freeze', { pan: this.pan(e.x), gap: 60 }); e.frozen = Math.max(e.frozen, s); }

  /* ================================================== enemy bullets ================================================== */
  fire(type, x, y, ang, spd, o = {}) {
    if (this.mode === 'preview') return null;
    if (x > this.W + 4) return null; // 屏幕外生成的子弹不算数：攻击必须看得见
    if (this._firer === 'boss' && this.boss && dist2(x, y, this.boss.x, this.boss.y) < 40 * 40) { x += Math.cos(ang) * 96; y += Math.sin(ang) * 96; } // Boss 从中心放的弹从表盘边缘出来：表盘始终看得清
    const b = this.bullets.get(); if (!b) return null;
    b.on = true; b.type = type; b.x = x; b.y = y; b.vx = Math.cos(ang) * spd; b.vy = Math.sin(ang) * spd;
    b.r = B_RADIUS[type] || 7; b.t = 0; b.life = o.life || 12; b.rot = ang; b.spin = type === 'blue' ? srand(-3, 3) : 0; b.ghost = o.ghost || 0;
    b.src = o.noRepeat ? null : { x, y, a: ang, s: spd, type }; b.pull = null; b.from = o.from || this._firer || 'shot'; b.fresh = this.freshFoe(this._firerE) || x > this.W + 5;
    if (!o.silent) Sound.sfx({ pink: 'spawnPink', blue: 'spawnBlue', gold: 'spawnGold', white: 'laser' }[type], { pan: this.pan(x), gap: 110 });
    return b;
  }
  aimAngle(x, y) { const q = this.np > 1 ? this.nearestPlayer(x, y) : this.player; return angTo(x, y, q.x, q.y); }
  dens(type, n) { return n; }
  clearBullets(toDust = true) {
    this.bullets.each((b) => { if (toDust && Math.random() < 0.5) this.part('mote', b.x, b.y, rand(-30, 30), rand(-60, -10), 0.6, 2.5, 'rgba(201,168,255,0.9)'); b.on = false; });
    this.warns = this.warns.filter((w) => w.keep);
  }
  clearEnemyBullets(toDust) { this.clearBullets(toDust); }
  recordGone(b) { if (!b.src || !this.boss || this.boss.phase !== 3) return; this.gone.push(b.src); if (this.gone.length > 36) this.gone.shift(); }
  updateBullets(dt) {
    const W = this.W, stop = this.timeStop > 0, rev = this.reverseT > 0 ? -1 : 1, wall = this.cloudWall;
    this.bullets.each((b) => {
      if (b.ghost > 0) { b.ghost -= dt; return; }
      if (b.pull) { const a = angTo(b.x, b.y, b.pull.x, b.pull.y); b.x += Math.cos(a) * 700 * dt; b.y += Math.sin(a) * 700 * dt; if (dist2(b.x, b.y, b.pull.x, b.pull.y) < 40 * 40) b.on = false; return; }
      if (stop) return;
      b.t += dt; b.x += b.vx * dt * rev; b.y += b.vy * dt * rev;
      b.rot = b.type === 'white' ? Math.atan2(b.vy, b.vx) : b.rot + b.spin * dt;
      if (b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > LH + 60 || b.t > b.life) { this.recordGone(b); b.on = false; return; }
      if (wall && Math.abs(b.x - wall.x) < 22 && Math.abs(b.y - wall.y) < 150) { b.on = false; this.part('puff', b.x, b.y, rand(-40, 40), rand(-40, 40), 0.4, 8, 'rgba(255,255,255,0.8)'); return; }
      if (this.state !== 'play') return;
      for (const q of this.players) {
        if (!q.alive || q.gone || q.inv > 0) continue;
        if (this.bfx && this.bfx.id === 'cloud' && this.bursting && this.bursting.owner === q.idx) continue;
        if (dist2(b.x, b.y, q.x, q.y) < (q.r + b.r) * (q.r + b.r)) { b.on = false; this._hitFresh = !!b.fresh; this.hurtPlayer(1, 'b:' + (b.from || 'shot'), q); return; }
      }
    });
    if (wall) { wall.t -= dt; if (wall.t <= 0) this.cloudWall = null; }
  }

  /* ================================================== warnings (预警线 / 区域) ================================================== */
  addWarn(w) { w.t = 0; w.fired = false; this.warns.push(w); if (!w.silent) Sound.sfx('warn', { pan: this.pan(w.x || this.W / 2), gap: 120 }); return w; }
  updateWarns(dt) {
    if (this.timeStop > 0) return;
    for (const w of this.warns) {
      w.t += dt;
      if (w.follow) { w.x = w.follow.x; w.y = w.follow.y; }
      if (!w.fired && w.t >= w.tWarn) { w.fired = true; if (w.onFire) w.onFire(w); w.beamT = w.beam || 0; }
      if (w.fired && w.beamT > 0) {
        w.beamT -= dt;
        const ex = w.x + Math.cos(w.a) * w.len, ey = w.y + Math.sin(w.a) * w.len;
        if (this.state === 'play') for (const q of this.players) if (q.alive && !q.gone && q.inv <= 0 && segDist2(q.x, q.y, w.x, w.y, ex, ey) < (w.w / 2 + q.r) * (w.w / 2 + q.r)) this.hurtPlayer(1, 'laser', q);
      }
    }
    this.warns = this.warns.filter((w) => !w.fired || w.beamT > 0 || (w.post && w.t < w.tWarn + w.post));
  }

  /* ================================================== 自动支援（雷球 / 彩虹 / 冰晶 / 磁吸；分身见下） ================================================== */
  updateSkills(dt) {
    const p = this.player, rp = this.stats.repeat;
    const again = (fn) => { fn(); if (rp > 0 && srnd() < rp) this.later(0.18, () => this.withPlayer(p, fn)); };
    for (const s of p.skills) { // 共享 Build，但每架飞机的支援技能冷却各算各的
      s.t -= dt;
      if (s.id === 'thunder') {
        if (s.t <= 0) {
          s.t = 1.35 - 0.08 * s.lv;
          const chain = [2, 3, 3, 5, 5][s.lv - 1] + (this.hasSyn('thunder', 'ice') ? 2 : 0), lv = s.lv;
          again(() => { for (let i = 0; i < (lv >= 2 ? 2 : 1); i++) this.addShot('orb', p.x + 10, p.y - 8 + i * 16, srand(-0.6, 0.6), 620, { dmg: (16 + 6 * lv) * (lv >= 4 ? 1.3 : 1), r: 10, homing: 6, life: 2, chain }); });
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
            if (this.hasSyn('thunder', 'rainbow') && e.alive && srnd() < 0.08) this.zap(e.x, e.y, e, 2, 14);
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
    for (let i = 1; i < n; i++) { const u = i / n; pts.push(lerp(x1, x2, u) + srand(-12, 12), lerp(y1, y2, u) + srand(-12, 12)); }
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
    if (!o.quiet || Math.random() < 0.15) Sound.sfx('explode', { pan: this.pan(x), gap: 45, v: r > 90 ? 1.4 : 1 });
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
    while (perm.length < want) { const w = { x: this.player.x, y: this.player.y, fireT: srand(0.2), temp: 0, orbT: srand(2), beamT: srand(3) }; perm.push(w); this.wingmen.push(w); }
    while (perm.length > want) { const w = perm.pop(); this.wingmen.splice(this.wingmen.indexOf(w), 1); }
  }
  addClone(t, burst) {
    if (!burst) {
      const temps = this.wingmen.filter((w) => w.temp && !w.burst);
      if (temps.length >= 3) { temps[0].temp = t; return; }
    }
    this.wingmen.push({ x: this.player.x, y: this.player.y, fireT: srand(0.1), temp: t, burst: !!burst, orbT: 1, beamT: 2 });
  }
  updateWingmen(dt, noFire) {
    const p = this.player, wl = this.lvOf('wing');
    let pi = 0, ci = 0;
    for (const w of this.wingmen) {
      if (w.temp) { w.temp -= dt; if (w.temp <= 0) { w.dead = true; this.part('shard', w.x, w.y, rand(-100, 100), rand(-100, 100), 0.5, 6, '#fff4dc'); continue; } }
      const slot = w.burst ? CLONE_SLOTS[ci++ % CLONE_SLOTS.length] : WING_SLOTS[pi++ % WING_SLOTS.length];
      w.x = smooth(w.x, p.x + slot[0], 8, dt); w.y = smooth(w.y, clamp(p.y + slot[1], this.arena.top + 10, this.arena.bottom - 10), 8, dt);
      if (!noFire) w.fireT -= dt;
      if (w.fireT <= 0 && !noFire) {
        // 分身和僚机：同样固定朝前，继承已经选到的主炮改造（蜂群同步开火时追踪 +1 级）
        const sync = this.hasSyn('homing', 'wing');
        w.fireT = w.burst ? 0.12 : sync ? 1 : wl >= 5 ? 0.16 : 0.22;
        const gold = wl >= 5 && !w.temp, dmg = (gold ? 8 : 6) * this.stats.dmgK;
        this.gunShot(w.x + 10, w.y, 0, dmg, { from: 'wing', gold, homBonus: sync ? 1 : 0 });
      }
      if (this.hasSyn('thunder', 'wing')) { w.orbT -= dt; if (w.orbT <= 0) { w.orbT = 2; this.addShot('orb', w.x, w.y, 0, 600, { dmg: 16, r: 9, homing: 6, life: 2, chain: 2 }); } }
      if (this.hasSyn('wing', 'rainbow')) { w.beamT -= dt; if (w.beamT <= 0) { w.beamT = 3; this.addBeam({ owner: w, a0: -0.3, a1: 0.3, dur: 0.5, len: 600, w: 8, dmg: 2.5 }); } }
      if (this.hasSyn('wing', 'magnet')) for (const k of this.pickups) if (k.kind === 'dust' && dist2(k.x, k.y, w.x, w.y) < 90 * 90) k.attract = true;
    }
    this.wingmen = this.wingmen.filter((w) => !w.dead);
  }

  /* ================================================== burst (专属大招) ================================================== */
  /* 大招库存：进度满一次 = 存 1 次，最多存到容量（账号共享：1 → 2 → 3）；满了之后多余能量只变成少量本局积分 */
  addCharge(v, force) {
    if (this.mode === 'preview') return;
    if (this.ritual && !force) return; // 仪式期间击杀不充能（仪式本身给的资源除外）
    const p = this.player;
    if (p.stock >= this.ultCap) { p.res.dust += v * 30; return; }
    p.burst += v * this.stats.chargeK * (this.bursting ? 0.5 : 1);
    while (p.burst >= 1 && p.stock < this.ultCap) { p.burst -= 1; this.addStock(1, true); }
    if (p.stock >= this.ultCap) { p.res.dust += p.burst * 30; p.burst = 0; }
  }
  addStock(n, fromCharge, quiet) {
    const p = this.player, before = p.stock;
    p.stock = Math.min(this.ultCap, p.stock + n);
    if (p.stock > before) { if (!quiet) this.emit('burstReady', { stock: p.stock, cap: this.ultCap, idx: p.idx }); if (p === this.me) Sound.sfx('resFull'); }
    else if (!fromCharge) p.res.dust += 30 * n;
    if (p.stock >= this.ultCap) p.burst = 0;
  }
  tryBurst() {
    const p = this.player;
    if (this.state !== 'play' || this.ritual || !p.alive) return;
    if (this.bursting) { if (p === this.me) { Sound.sfx('denied', { gap: 250 }); this.text(this.vs ? '别人的大招还在放' : '队友的大招还在放', p.x, p.y - 40, '#ffe38a', 15, 2); } return; } // 同一时间只放一个大招
    if (p.stock < 1) { if (p === this.me) Sound.sfx('denied', { gap: 250 }); return; }
    p.stock--;
    this.startBurst();
  }
  startBurst() {
    this.bursting = { stage: 'cut', t: 0, owner: this.player.idx }; this.slowT = 0.5; this.burstKills = [];
    if (this.mode === 'run') { this.m.bursts++; if (this.m.firstBurst === null) this.m.firstBurst = this.runT; this.highlight(); if (this.cb.onBurst) this.cb.onBurst(); }
    Sound.sfx('burstCut'); this.emit('burst', { plane: this.planeId, idx: this.player.idx });
  }
  updateBurst(dt) {
    const B = this.bursting;
    if (!B) return;
    B.t += dt;
    if (B.stage === 'cut' && B.t >= 0.5) { B.stage = 'active'; B.t = 0; this.executeBurst(); }
    else if (B.stage === 'active' && this.updateBfx(dt)) { this.bursting = null; this.bfx = null; this.gatherRewards(); this.burstAftermath(); }
  }
  executeBurst() {
    const p = this.player, st = this.stats.stars, big = st >= 2 ? 1.22 : 1, dK = this.stats.dmgK * (st >= 5 ? 1.2 : 1);
    Sound.sfx('b_' + this.planeId, { prio: true }); this.shake(0.6); this.flash = Math.max(this.flash, 0.55 * this.flashK()); this.flashColor = '255,250,235'; this.rumble(1, 0.8, 320);
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
    // 大招改造（第三个槽位）
    const bm = this.bmod;
    if (bm) {
      if (bm.id === 'thunderB') this.later(0.6, () => { const hit = new Set(); for (let i = 0; i < (bm.lv >= 2 ? 14 : 8); i++) { const e = this.nearestEnemy(srand(this.W * 0.3, this.W), srand(TOP, BOTTOM), 2000, hit); if (!e) break; hit.add(e.id); this.arc(e.x + srand(-30, 30), -20, e.x, e.y, '#dff4ff'); this.damageEnemy(e, 60 * dK, { kind: 'zap', x: e.x, y: e.y }); } Sound.sfx('zap'); });
      if (bm.id === 'iceB') { for (const e of this.enemies) if (e.alive && !e.isBoss) this.freezeEnemy(e, bm.lv >= 2 ? 3 : 1.5); if (bm.lv >= 2) this.later(1.2, () => { for (const e of this.enemies) if (e.alive && !e.isBoss && e.frozen > 0 && e.x < this.W) this.shatter(e.x, e.y, 70, 40 * dK); }); }
      if (bm.id === 'bombB') { for (const e of this.enemies) if (e.alive && !e.isBoss) { e.mark = true; e.bigMark = bm.lv >= 2; } }
      if (bm.id === 'dustB') { this.magnetPulse(); this.later(0.8, () => this.addCharge(bm.lv >= 2 ? 0.45 : 0.25)); }
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
        if (F.spawn <= 0 && F.t < F.dur) { F.spawn = 0.05; this.addShot('candyBomb', srand(this.W * 0.3, this.W - 30), -20, Math.PI / 2, 780, { dmg: 45 * F.dK, r: 12, life: 3, ty: srand(TOP + 40, BOTTOM - 20) }); }
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
  /* 大招余波：最后倒下的关键目标（精英 / 厚甲）当作收尾点，爆出战利品 */
  burstAftermath() {
    if (this.mode !== 'run') return;
    const L = this.burstKills, key = L.filter((k) => k.key).pop() || L[L.length - 1];
    Sound.sfx('ultEnd');
    if (!key) return;
    this.fx(key.x, key.y, 3, 110); this.hitStop(0.04);
    for (let i = 0; i < 6; i++) this.dropPickup('dust', key.x, key.y, { value: 1, big: i < 2 });
    this.text(L.length >= 8 ? `收尾 · 一口气 ${L.length} 个` : '收尾！', key.x, key.y - 50, '#ffe38a', 20, 5);
  }
  gatherRewards() {
    const p = this.player;
    for (const k of this.pickups) { k.gather = { x: Math.min(this.W - 60, p.x + 110 + srand(-20, 40)), y: clamp(p.y + srand(-60, 60), TOP + 20, BOTTOM - 20) }; k.gatherT = 0.6; }
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
      for (let i = 0; i < n; i++) this.addShot('wheelS', s.x, s.y, Math.PI * 0.5 + (i / n) * Math.PI + srand(-0.2, 0.2), 560, { dmg: 60 * this.stats.dmgK, r: 26, life: 2.4, pierce: 9999 });
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
      if (dist2(e.x, e.y, s.x, s.y) < rr * rr) { if (!e.elite && !e.isBoss && e.type !== 'mirror' && !e.armorHp && e.type !== 'wreck') this.killEnemy(e, { candify: true }); boom = true; break; }
    }
    if (boom || s.t > s.life) { s.on = false; this.explode(s.x, s.y, 55 * this.stats.blastK, s.dmg, { level: 1, fireworks: true }); }
  }

  /* ================================================== pickups ================================================== */
  /* 多人：掉落各吃各的——每架飞机各掉一份，只有自己看得见、吸得到；o.owner 指定时只给那一位（自己的机型 / 技能掉的） */
  dropPickup(kind, x, y, o = {}) {
    const k = Object.assign({ kind, x, y, vx: srand(-110, 110), vy: srand(-140, 60), t: 0, value: 1, seed: srand(10) }, o);
    if (this.vs && k.owner === undefined && !k.rain) k.owner = this.player.idx; // 对抗：击破掉的东西只归开枪的人（不出现在别人航道里）
    if (this.np > 1 && k.owner === undefined) { let first = null; for (const q of this.players) { if (q.gone) continue; const c = Object.assign({}, k, { owner: q.idx }); this.pickups.push(c); first = first || c; } return first; }
    this.pickups.push(k); return k;
  }
  mineDrop() { return this.np > 1 ? { owner: this.player.idx } : {}; } // 只掉给当前这架（糖果机被动、自己的联动）
  seesPickup(k) { return k.owner === undefined || k.owner === this.me.idx; }
  magnetRadius() { const lv = this.lvOf('magnet'); return (110 + (lv ? 60 + 60 * lv : 0)) * this.stats.magnetK; }
  updatePickups(dt) {
    this.pickCd.bolt -= dt; this.pickCd.mine -= dt; this.pickCd.zap -= dt;
    const radius = this.players.map((q) => this.withPlayer(q, () => this.magnetRadius()));
    for (const k of this.pickups) {
      k.t += dt;
      const p = k.owner !== undefined ? this.players[k.owner] : this.np > 1 ? this.nearestPlayer(k.x, k.y) : this.player; // 多人：每份掉落只属于自己的主人
      if (!p || p.gone) { k.done = true; continue; }
      const R = radius[p.idx];
      if (k.gather && k.gatherT > 0) { k.gatherT -= dt; k.x = smooth(k.x, k.gather.x, 6, dt); k.y = smooth(k.y, k.gather.y, 6, dt); if (k.gatherT <= 0) { k.gather = null; if (k.kind !== 'crystal') k.attract = true; } continue; }
      const d = Math.sqrt(dist2(k.x, k.y, p.x, p.y));
      if (k.kind === 'chest') k.near = clamp(1 - (d - 30) / 260, 0, 1);
      const pull = (k.kind !== 'crystal' || k.bunny) && (k.attract || (d < R && k.t > 0.25) || this.state === 'victory');
      if (pull && p.alive) { const a = angTo(k.x, k.y, p.x, p.y), sp = 560 + k.t * 120; k.vx = smooth(k.vx, Math.cos(a) * sp, 12, dt); k.vy = smooth(k.vy, Math.sin(a) * sp, 12, dt); }
      else if (k.kind === 'crystal' || k.kind === 'gold' || k.kind === 'chest') { k.vx = smooth(k.vx, -55, 2, dt); k.vy = smooth(k.vy, Math.sin(k.t * 2 + k.seed) * 20, 2, dt); }
      else if (!k.rain) { k.vx = smooth(k.vx, -70, 2.5, dt); k.vy = smooth(k.vy, 0, 2.5, dt); }
      k.x += k.vx * dt; k.y += k.vy * dt;
      if (k.kind === 'crystal') k.y = clamp(k.y, this.arena.top + 24, this.arena.bottom - 24);
      if (k.fade !== undefined) { k.fade -= dt * 2; if (k.fade <= 0) { k.done = true; continue; } }
      const reach = k.kind === 'crystal' ? 36 : k.kind === 'gold' ? 44 : 26;
      if (p.alive && d < reach && k.fade === undefined && this.state !== 'dying') this.withPlayer(p, () => this.collect(k));
      if (k.x < -60 || k.t > (k.kind === 'crystal' ? 16 : 14) || k.y > LH + 40) k.done = true;
    }
    this.pickups = this.pickups.filter((k) => !k.done);
  }
  collect(k) {
    const p = this.player; k.done = true;
    switch (k.kind) {
      case 'dust': {
        p.res.dust += k.value; this.addCharge(0.0008);
        if (p === this.me) { this.dustChain = this.t - (this.dustT || -9) < 0.35 ? Math.min(10, (this.dustChain || 0) + 1) : 0; this.dustT = this.t; Sound.sfx('dust', { gap: 30, k: this.dustChain }); }
        const ml = this.lvOf('magnet');
        if (ml && this.pickCd.bolt <= 0) { this.pickCd.bolt = 0.05; this.addShot('starbolt', p.x, p.y, srand(-0.5, 0.5), 700, { dmg: (8 + 3 * ml) * (ml >= 4 ? 1.5 : 1), r: 6, homing: 7, life: 1.4 }); }
        if (this.hasSyn('bomb', 'magnet') && this.pickCd.mine <= 0) { this.pickCd.mine = 0.1; this.explode(p.x + 30, p.y, 45 * this.stats.blastK, 14, { level: 1 }); }
        if (this.hasSyn('thunder', 'magnet') && this.pickCd.zap <= 0) { this.pickCd.zap = 0.15; const e = this.nearestEnemy(p.x, p.y, 220); if (e) this.zap(p.x, p.y, e, 1, 14); }
        break;
      }
      case 'wood': p.res.wood += k.value; if (p === this.me) Sound.sfx('dust', { gap: 60 }); break;
      case 'candy': p.candy = 5; p.res.candies++; if (p === this.me) Sound.sfx('candy'); this.text('糖果强化！', p.x, p.y - 40, '#ff9fcf', 16, 3); if (this.planeId === 'paper') this.addClone(10); break;
      case 'heart': if (p.hp < p.maxHp) p.hp++; if (p === this.me) Sound.sfx('heart'); this.text('+1', p.x, p.y - 40, '#9ff2c8', 18, 4); break;
      case 'chest': {
        // 开箱仪式（不打断操作）：靠近时越抖越厉害（画面）→ 盖子弹开、金光一圈 → 6 颗大星砂喷出来再一颗颗飞回（音高逐个升高）→ 最后碎片
        p.res.chests++;
        const pl = spick(PLANE_ORDER); p.res.frags[pl] = (p.res.frags[pl] || 0) + 3;
        for (let i = 0; i < 6; i++) this.dropPickup('dust', k.x, k.y - 6, Object.assign({ value: 5, big: true, vx: srand(-170, 170), vy: srand(-420, -240) }, this.np > 1 ? { owner: p.idx } : {}));
        if (p === this.me) { Sound.sfx('chest'); this.flash = Math.max(this.flash, 0.18 * this.flashK()); this.flashColor = '255,226,150'; }
        this.part('plate', k.x, k.y - 10, rand(-60, 60), -320, 0.9, 16, '#e0a860');
        this.part('ring', k.x, k.y, 0, 0, 0.35, 70, 'rgba(255,215,106,0.95)');
        this.fx(k.x, k.y, 2, 80, ['#ffd76a', '#ffb347', '#fff6c8']);
        this.later(0.55, () => this.text(`宝箱 · 星砂 +30 · ${PLANES[pl].name}碎片 +3`, p.x, p.y - 48, '#ffe38a', 18, 4));
        break;
      }
      case 'gold':
        if (p === this.me) { Sound.sfx('gold'); this.flash = 0.35; this.flashColor = '255,236,170'; } this.highlight();
        const full = p.stock >= p.ultCap; this.addCharge(1); p.res.dust += 60;
        p.candy = 8; this.m.golds++; this.emit('gold', { full }); this.text(full ? '金色强化 · 大招满了，星砂 +60' : '金色强化 · 大招 +1', p.x, p.y - 52, '#ffe38a', 18, 4); if (this.planeId === 'paper') this.addClone(10);
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
    this.eachPlayer((q) => { if (q.alive) this.addCharge(0.05); }); this.highlight();
    this.emit('streak', { n: ms });
    Sound.sfx('streak', { k: [10, 30, 50, 100].indexOf(ms) });
    if (ms === 10) { this.ring(p.x, p.y, 0, 150, 0.35, 30, 'rgba(255,243,200,0.9)'); Sound.sfx('nova'); }
    if (ms === 50) { this.ring(p.x, p.y, 0, 520, 0.8, 60 * this.stats.dmgK, 'rgba(255,215,106,0.95)', { clear: true }); this.fx(p.x, p.y, 3, 200); }
    if (ms === 100) { this.dropPickup('gold', Math.min(this.W - 100, p.x + 260), p.y, { vx: -30, vy: 0 }); this.m.streak100 = 1; }
  }

  /* ================================================== Boss（目标链最后一步；调度见 director.js） ================================================== */
  startBoss() {
    this.phase = 'boss'; this.bossEarly = false; this.m.route.push('boss'); this.m.segsDone = this.beatIdx;
    for (const q of this.players) q.ritualQueue = []; this.incoming = [];
    if (this.lurks) { for (const L of this.lurks) { if (L.e) L.e.alive = false; if (L.seals) for (const s of L.seals) s.alive = false; } this.lurks = []; this.arenaTarget = { top: TOP, bottom: BOTTOM }; } // Boss 场：地图不再出手，合拢的墙退回去
    if (this.props) this.props = []; // 之前的场景道具不带进 Boss 场（Boss 场里只有侧面小队的先兆道具）
    for (const e of this.enemies) if (e.alive) { e.leaving = true; e.vx = -380; e.path = 'line'; }
    this.clearBullets(true);
    this.seg = { type: 'boss', tier: Math.max(3, this.beatIdx + STAGE_ORDER.indexOf(this.stageId)), t: 0, dur: 0 };
    this.remember(this.stage.boss === 'clock' ? '闯进了失控闹钟的钟面' : `闯过了${this.stage.bossName}的防线`, 1);
    this.boss = this.stage.boss === 'clock' ? new ClockBoss(this) : new CaptainBoss(this, this.stage.boss, this.stage.bossHp);
    this.eachPlayer((q) => { if (q.alive && q.stock === 0) this.addStock(1); }); // Boss 入口：每架库存为 0 的飞机补到 1
    this.bossIntroT = 2.8;
    this.bossProxy = { id: 'boss', isBoss: true, type: 'boss', x: this.boss.x, y: this.boss.y, r: this.boss.radius || 118, alive: true };
    this.enemies.push(this.bossProxy);
    this.emit('boss');
    this.onMapBoss();
    if (this.cb.onPortal) this.cb.onPortal('boss');
  }
  /* Boss 入场仪式（v0.12）：2.8 秒蓄势（画面压暗、上下警示带滑过、背景停住、警报）→ 落地（冲击波、小震、名牌）→ 血条从空涨满 */
  bossLand() {
    const b = this.boss; if (!b) return;
    this.shake(0.6); this.flash = Math.max(this.flash, 0.35 * this.flashK()); this.flashColor = '255,226,236'; this.hitStop(0.06); this.rumble(0.8, 0.6, 220);
    Sound.sfx('phase'); this.part('ring', b.x, b.y, 0, 0, 0.5, 260, 'rgba(255,240,250,0.95)'); this.part('ring', b.x, b.y, 0, 0, 0.7, 380, 'rgba(255,170,200,0.7)');
    for (let i = 0; i < 24; i++) this.part(i % 2 ? 'petal' : 'shard', b.x, b.y, rand(-420, 420), rand(-360, 260), 0.9, rand(5, 9), pick(['#ffcf7a', '#ff9fcf', '#fff3c8']));
    this.emit('bossLand');
  }
  /* Boss 倒下的过程：三下越来越大的爆点（音高往上走），最后整只炸开 */
  bossDyingPops(b, total) {
    const left = b.dying, k = Math.floor((1 - left / total) * 4); // 0..3
    if (k > (b.popK || 0) && k <= 3) {
      b.popK = k; const x = b.x + rand(-70, 70), y = b.y + rand(-70, 70);
      this.fx(x, y, Math.min(4, 1 + k), 70 + k * 50, ['#fff3c8', '#ffcf7a', '#ff9fcf']); this.shake(0.2 + 0.15 * k); this.hitStop(0.04);
      Sound.sfx('kill', { k: 2 + k * 3, gap: 0 }); Sound.sfx('armorBreak', { gap: 0 });
    }
  }
  /* n = 0：阶段切换瞬间（闹钟号被动充能）；n = 2：第二乐章开始（Boss 回应 Build） */
  onBossPhase(n) {
    if (n === 0 && this.planeId === 'clock') { const p = this.player; this.addCharge(0.5); this.text('准点充能', p.x, p.y - 44, '#ffd76a', 16, 4); }
    if (n === 0) this.onCompanionBossPhase();
    if (n === 2) this.bossResponse();
  }
  /* Boss 看见你的 Build */
  bossResponse() {
    const b = this.boss, sid = this.support ? this.support.id : this.gun.bomb ? 'bomb' : this.topId();
    let title = '失控闹钟加快了节奏', sub = '先把 Build 养起来，Boss 会回应你的流派';
    if (sid === 'thunder') { b.conductive = true; title = '外壳开始导电！'; sub = '雷暴流：打闹钟会多跳几次电'; }
    else if (sid === 'wing') { title = '闹钟召唤了镜像！'; sub = '分身流：分身会自动锁定镜像闹钟'; for (let i = 0; i < 3; i++) { const ty = lerp(this.arena.top + 90, this.arena.bottom - 90, i / 2); this.addEnemy('mirror', { x: this.W + 60, y: ty, path: 'mirror', tx: this.W * (0.5 + i * 0.07), ty, fireT: 2 + i * 0.6 }); } }
    else if (sid === 'bomb') { b.marked = true; title = '护甲被标记了！'; sub = '爆破流：爆炸能撬开闹钟的核心'; }
    else if (sid === 'magnet') { title = '星砂海！'; sub = '吸星流：闹钟洒出一整片星砂，全部吸进来'; for (let i = 0; i < 70; i++) this.dropPickup('dust', b.x + srand(-160, 60), b.y + srand(-220, 220), { value: 2, vx: srand(-260, -60), vy: srand(-160, 160) }); }
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
    const bc = this.stage.boss === 'clock' ? ['#f4ecff', '#c9a8ff', '#ffcf7a', '#fff6c8'] : [(this.boss.C && this.boss.C.color) || '#ff9fcf', '#fff6c8', '#c9a8ff'];
    for (let i = 0; i < 14; i++) this.part('plate', this.boss.x + rand(-60, 60), this.boss.y + rand(-60, 60), rand(-520, 520), rand(-560, 200), 1.4, rand(22, 44), pick(bc)); // 整只碎成几大块飞开
    this.hitStop(0.1);
    this.highlight(); this.victoryT = 0;
    this.shake(1); this.flash = 0.8 * this.flashK(); this.flashColor = '255,243,200'; this.rumble(1, 1, 400);
  }
  finish(win) {
    this.done = true; this.phase = 'end';
    if (this.vs) { const v = this.vsResult(); win = v.rank === 1 && !v.draw; } // 对抗：赢 = 本机这架排第一（平局不算）
    this.wonRun = !!win;
    if (this.cb.onEnd) this.cb.onEnd(this.result(win));
  }
  result(win) { return this.withPlayer(this.me, () => this.resultOf(win)); }
  resultOf(win) {
    const R = this.me.res, m = Object.assign({}, this.m, R, { frags: Object.assign({}, R.frags), choiceTimes: R.choiceTimes.slice() }); // 自己的资源 + 全队统计
    return {
      win, plane: this.me.planeId, runT: this.runT, stats: m, mp: this.np > 1, team: this.players.map((q) => ({ name: q.name, plane: q.planeId, gone: q.gone })),
      stage: this.stageId, build: this.buildSummary(), progress: win ? 1 : this.vs ? clamp(this.vs.t / (VS.stages * VS.stageT), 0, 1) : clamp((this.beatIdx + (this.goal && this.goal.state === 'done' ? 1 : 0)) / this.plan.length, 0, 1),
      memories: this.pickMemories ? this.pickMemories() : [], hurt: Object.assign({}, m.hurt || {}), lastHurt: m.lastHurt || null, clue: pick(STAGE_CLUES[this.stageId] || ['']), goalTimes: (m.goalTimes || []).slice(),
      choiceAvg: m.choiceTimes.length ? m.choiceTimes.reduce((a, b) => a + b, 0) / m.choiceTimes.length : null,
      skills: [...GUN_ORDER.filter((id) => this.gun[id] > 0).map((id) => ({ id, lv: this.gun[id] })), ...(this.support ? [{ id: this.support.id, lv: this.support.ulv }] : [])],
      syns: [...this.links], stream: this.buildName(), streamId: this.topId(),
      avgKill: m.killTimeN ? m.killTimeSum / m.killTimeN : null, bossTime: this.bossTime || 0, bossEarly: this.bossEarly,
      journey: (this.journey || []).slice(), companions: (this.companions || []).map((c) => c.id), vs: this.vs ? this.vsResult() : null,
    };
  }

  /* ================================================== burst preview (抽卡 / 机库里的大招预览) ================================================== */
  setupPreview() {
    this.phase = 'preview'; this.player.x = this.W * 0.2; this.previewT = 0; this.previewFired = false; this.plan = []; this.D = null;
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
    if (!this.previewFired && this.previewT > 0.6) { this.previewFired = true; this.startBurst(); }
    if (this.previewT > 5.2 && !this.bursting) { this.previewT = 0; this.previewFired = false; this.pickups = []; this.spawnDummies(); }
  }

  /* ================================================== first-run hints ================================================== */
  updateHints() {
    if (this.hintStep < 0 || this.mode !== 'run' || this.state !== 'play') { if (this.hintShown) { this.hintShown = null; this.emit('hint', { id: null }); } return; }
    const p = this.me;
    if (this.hintStep === 0 && p.moved > 220) this.hintStep = 1;
    let want = null;
    if (this.hintStep === 0) want = 'move';
    else if (p.ritual && p.ritual.first && p.ritual.st === 'choose') want = 'offer';
    else if (p.stock >= 1 && !this.bursting && this.m.bursts === 0 && !(this.D && this.D.demo) && !p.ritual && !this.warns.length && !this.mapObjs.some((o) => ['idle', 'tow', 'blow'].includes(o.state) && o.x < this.W)) want = 'burst';
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
      if (q.kind === 'petal' || q.kind === 'shard' || q.kind === 'confetti' || q.kind === 'plate') { q.vy += (q.kind === 'plate' ? 700 : 420) * dt; q.vx *= 1 - dt * 1.4; }
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
    const p = this.me, B = this.hudBuild || this.buildSummary(); // 槽位按“已经飞进槽里”的状态显示；生命 / 大招看本机这架
    const h = { hp: p.hp, maxHp: p.maxHp, burst: p.burst, stock: p.stock, cap: p.ultCap, ready: p.stock >= 1 && !this.bursting && !this.ritual && p.alive, down: !p.alive && !p.gone, save: !p.alive && !p.gone ? clamp((p.saveT || 0) / RESCUE.dwell, 0, 1) : 0,
      vs: !!this.vs, respawn: this.vs && !p.alive ? Math.max(1, Math.ceil(p.vsRespawn || 0)) : 0,
      team: this.np > 1 ? this.players.map((q) => ({ idx: q.idx, name: q.name, plane: q.planeId, hp: q.hp, maxHp: q.maxHp, alive: q.alive, gone: q.gone, away: !!q.away, seat: q.away ? this.seatLeft(q) : 0, down: !q.alive && !q.gone, me: q === p, color: q.color })) : null,
      gun: Object.assign({}, B.gun), support: B.support ? Object.assign({}, B.support) : null, bmod: B.bmod ? Object.assign({}, B.bmod) : null, recent: (B.recent || []).slice(),
      syns: B.links.slice(), stream: this.stream ? this.stream.name : null, streak: this.streak.n, dust: Math.floor(p.res.dust), wood: Math.floor(p.res.wood), homeGoal: this.goalText, companions: (this.companions || []).map((c) => c.id),
      moved: p.moved, stage: this.stageId, phase: this.phase, candy: p.candy, ritual: this.myRitualFocus(),
      goal: this.mode === 'run' && this.phase === 'fight' && this.goalHud && !this.vs ? this.goalHud() : null };
    if (this.boss && this.phase === 'boss') h.boss = this.boss.hudInfo();
    return h;
  }

  /* ================================================== render ================================================== */
  render(g, o = {}) {
    const W = this.W, t = this.t, p = this.me, cb = this.settings.colorblind;
    g.save();
    if (this.trauma > 0) { const s = Math.min(6, this.trauma * 6); g.translate(rand(-s, s), rand(-s, s)); } // 一下小震：最多 6 像素、约 0.15 秒（FP2）
    if (this.mapObjs) this.applyCam(g);
    if (o.simpleBg) { const gr = g.createLinearGradient(0, 0, 0, LH); gr.addColorStop(0, '#1b1548'); gr.addColorStop(1, '#2e2670'); g.fillStyle = gr; g.fillRect(-20, -20, W + 40, LH + 40); }
    else this.scene.draw(g, W, LH);
    if (this.carnival) { g.globalCompositeOperation = 'soft-light'; const gr = g.createLinearGradient(0, 0, W, LH); gr.addColorStop(0, 'rgba(255,159,207,0.5)'); gr.addColorStop(0.5, 'rgba(255,227,138,0.5)'); gr.addColorStop(1, 'rgba(159,227,240,0.5)'); g.fillStyle = gr; g.fillRect(0, 0, W, LH); g.globalCompositeOperation = 'source-over'; }
    if (this.sky && this.sky.a > 0) { // 上层云桥：天色变亮，脚下一层云桥流过
      const a = this.sky.a, gr = g.createLinearGradient(0, 0, 0, LH); gr.addColorStop(0, `rgba(255,236,190,${0.3 * a})`); gr.addColorStop(0.55, `rgba(205,232,255,${0.12 * a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(-20, -20, W + 40, LH + 40);
      g.fillStyle = `rgba(255,252,240,${0.38 * a})`;
      for (let i = 0; i < 10; i++) { const x = ((i * 170 - t * 70) % (W + 220) + W + 220) % (W + 220) - 110; g.beginPath(); g.ellipse(x, this.arena.bottom - 6 + Math.sin(i) * 6, 96, 24, 0, 0, TAU); g.fill(); }
    }
    if (this.arena.top > TOP + 1 || this.arena.bottom < BOTTOM - 1) {
      g.fillStyle = 'rgba(255,138,92,0.14)'; g.fillRect(0, 0, W, this.arena.top); g.fillRect(0, this.arena.bottom, W, LH - this.arena.bottom);
      g.strokeStyle = 'rgba(255,190,150,0.55)'; g.setLineDash([10, 8]); g.lineWidth = 2; g.lineDashOffset = -t * 30;
      g.beginPath(); g.moveTo(0, this.arena.top); g.lineTo(W, this.arena.top); g.moveTo(0, this.arena.bottom); g.lineTo(W, this.arena.bottom); g.stroke(); g.setLineDash([]);
      const moving = Math.abs(this.arena.top - this.arenaTarget.top) > 1 || Math.abs(this.arena.bottom - this.arenaTarget.bottom) > 1;
      if (moving) { // 正在收缩：上下边缘一排往里压的箭头
        g.fillStyle = 'rgba(255,170,130,0.85)';
        for (let x = ((t * 120) % 80) - 80; x < W + 80; x += 80) { const y1 = this.arena.top, y2 = this.arena.bottom; g.beginPath(); g.moveTo(x, y1 - 14); g.lineTo(x + 14, y1 - 14); g.lineTo(x + 7, y1 - 2); g.closePath(); g.fill(); g.beginPath(); g.moveTo(x, y2 + 14); g.lineTo(x + 14, y2 + 14); g.lineTo(x + 7, y2 + 2); g.closePath(); g.fill(); }
      }
    }
    if (this.vs) this.drawVsUnder(g);
    if (this.mapObjs) this.drawMap(g);
    if (this.surprise) this.drawSurprise(g);
    for (const w of this.walls) { g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(w.x - 40, 0, w.x + 10, 0); gr.addColorStop(0, 'rgba(201,168,255,0)'); gr.addColorStop(1, 'rgba(255,243,200,0.7)'); g.fillStyle = gr; g.fillRect(w.x - 40, this.arena.top, 50, this.arena.bottom - this.arena.top); g.globalCompositeOperation = 'source-over'; }
    for (const k of this.pickups) if (k.kind !== 'crystal' && this.seesPickup(k)) drawPickup(g, k, t); // 别人的掉落看不见
    for (const q of this.incoming) this.drawIncoming(g, q);
    if (this.lurks) this.drawLurks(g); // 地图出手：先兆、手臂、合拢的墙（在敌人下面）
    for (const e of this.enemies) if (e.alive && !e.isBoss) this.drawEnemy(g, e);
    if (this.boss) { this.boss.draw(g); this.drawBossCheck(g, this.boss); }
    this.drawBeams(g);
    this.shots.each((s) => this.drawShot(g, s));
    this.drawArcs(g);
    for (const k of this.pickups) if (k.kind === 'crystal' && this.seesPickup(k)) drawPickup(g, k, t);
    this.drawPlayers(g);
    if (this.vs) this.drawVsMarks(g);
    if (this.mapObjs) this.drawMapFront(g);
    // 装饰性的爆炸在下面，危险轮廓（预警 / 入场提示 / 敌弹）永远压在上面
    this.drawParticles(g);
    this.drawWarns(g);
    if (this.props) this.drawProps(g);
    const stop = this.timeStop > 0;
    this.bullets.each((b) => {
      if (b.ghost > 0) { g.globalAlpha = 0.25 + 0.25 * Math.sin(t * 20); BulletArt.draw(g, b.type, b.x, b.y, b.type === 'blue' || b.type === 'white' ? b.rot : 0, 1, cb); g.globalAlpha = 1; return; }
      if (this.reverseT > 0) { g.globalAlpha = 0.22; BulletArt.draw(g, b.type, b.x + b.vx * 0.06, b.y + b.vy * 0.06, b.rot, 1, false); g.globalAlpha = 1; }
      g.fillStyle = 'rgba(16,10,40,0.55)'; g.beginPath(); g.arc(b.x, b.y, (b.r || 6) + 5, 0, TAU); g.fill(); // 敌弹统一压一圈深色底，和紫色场景、光点拉开
      BulletArt.draw(g, b.type, b.x, b.y, b.type === 'blue' || b.type === 'white' ? b.rot : b.type === 'gold' ? b.t * 3 : 0, 1, cb);
      if (stop) { g.strokeStyle = 'rgba(255,215,106,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.arc(b.x, b.y, 11, 0, TAU); g.stroke(); }
    });
    if (p.alive && this.settings.showHitbox && this.mode === 'run') { g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(255,122,107,0.95)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 3.4, 0, TAU); g.fill(); g.stroke(); }
    this.drawTexts(g);
    g.restore();
    // 奖励焦点：战场去饱和、压暗；奖励装置 / 候选 / 光轨 / 飞机画在上面保持鲜艳
    const f = clamp((1 - this.focusK) / 0.9, 0, 1);
    if (f > 0.01) {
      g.globalCompositeOperation = 'saturation'; g.fillStyle = `rgba(128,128,128,${0.88 * f})`; g.fillRect(0, 0, W, LH);
      g.globalCompositeOperation = 'source-over'; g.fillStyle = `rgba(14,10,40,${0.38 * f})`; g.fillRect(0, 0, W, LH);
    }
    if (this.ritual) { if (f > 0.01) this.drawPlayers(g); this.withPlayer(this.me, () => this.drawRitual(g)); }
    this.drawOverlays(g, o);
    if (this.vs) this.drawVsBoard(g);
  }
  drawPlayers(g) {
    const keep = this.player;
    for (const q of this.players) if (!q.gone && q !== this.me) { this.player = q; this.drawPlayer(g, false); }
    const me = this.me, off = this.viewOff, sx = me.x, sy = me.y; // 联机：本机飞机画在预测位置（画完原样还回去，不动模拟）
    if (off && (off.x || off.y)) { me.x = sx + off.x; me.y = sy + off.y; }
    this.player = me; try { this.drawPlayer(g, true); } finally { this.player = keep; me.x = sx; me.y = sy; } // 画面出错也一定还原
  }
  drawPlayer(g, isMe = true) {
    const p = this.player, t = this.t, C = this.trailColors;
    if (this.np > 1 && p.away && !p.gone) { // 断线占位：半透明 + 标签
      g.save(); g.globalAlpha = 0.3; drawPlane(g, p.planeId, p.x, p.y, 0.8, t, {}); g.restore();
      drawStepPill(g, p.x, p.y - 44, isMe ? '网络恢复中…' : `${p.name || (this.vs ? '对手' : '队友')} · 断线中 ${this.seatLeft(p)} 秒`, '#ffb2a8', 0.85); return;
    }
    if (this.np > 1) { // 多人：队友半透明 + 名字，倒下的显示救援圈
      if (!p.alive && !p.gone) {
        g.save(); g.globalAlpha = 0.35; drawPlane(g, p.planeId, p.x, p.y, 0.8, t, { hurt: true }); g.restore();
        if (this.vs) { drawStepPill(g, p.x, p.y - 44, `${isMe ? '' : (p.name || '对手') + ' · '}${Math.max(1, Math.ceil(p.vsRespawn || 0))} 秒后复归`, '#ffb2a8', 0.9); return; } // 对抗：短暂击毁后原地复归，没有救援
        g.fillStyle = 'rgba(159,242,200,0.07)'; g.beginPath(); g.arc(p.x, p.y, RESCUE.r, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(159,242,200,0.55)'; g.lineWidth = 2.5; g.setLineDash([6, 7]); g.lineDashOffset = -t * 20; g.beginPath(); g.arc(p.x, p.y, RESCUE.r, 0, TAU); g.stroke(); g.setLineDash([]); // 救援范围
        if (p.saveT > 0) { g.strokeStyle = '#9ff2c8'; g.lineWidth = 5; g.beginPath(); g.arc(p.x, p.y, 34, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, p.saveT / RESCUE.dwell)); g.stroke(); }
        drawStepPill(g, p.x, p.y - 44, isMe ? '等队友来救' : `${p.name || '队友'} · 飞进圈里救`, '#ffb2a8', 0.9); return;
      }
      if (p.ritual && p.ritual.st !== 'resume') { // 在升级的飞机：一层护盾（期间不受伤）；队友头上写着在选 / 已选好
        g.strokeStyle = hexA(p.color, 0.55); g.lineWidth = 2.5; g.beginPath(); g.arc(p.x, p.y, 40 + Math.sin(t * 5) * 2, 0, TAU); g.stroke();
        if (!isMe) { const left = p.ritual.st === 'choose' ? this.chooseLeft(p.ritual) : null; drawStepPill(g, p.x, p.y - 48, p.ritual.st === 'wait' ? `${p.name || '玩家'} ✓ 选好了` : `${p.name || '玩家'} · 选升级中${left !== null ? ` ${left}` : ''}`, p.ritual.st === 'wait' ? '#9ff2c8' : p.color, 0.85); }
        if (!isMe && p.lastPick && p.ritual.st === 'wait') drawIcon(g, p.lastPick.icon, p.x + 30, p.y - 22, 20, p.lastPick.color); // 队友这次拿了什么：只给一个小图标
      }
      g.strokeStyle = hexA(p.color, isMe ? 0.9 : 0.6); g.lineWidth = 2; g.beginPath(); g.ellipse(p.x, p.y + 22, 26, 7, 0, 0, TAU); g.stroke();
      if (!isMe) { g.font = '700 12px "Noto Sans SC", sans-serif'; g.textAlign = 'center'; g.fillStyle = p.color; g.fillText(p.name || `${p.idx + 1}P`, p.x, p.y - 32); g.textAlign = 'start'; }
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < p.trail.length; i++) {
      const q = p.trail[i], a = (i / p.trail.length) * 0.5 * (1 - q.t * 2); if (a <= 0) continue;
      const c = C[i % C.length]; drawGlow(g, q.x, q.y, 10 + i * 0.3, c.startsWith('#') ? hexA(c, 0.8) : c, a);
    }
    g.globalCompositeOperation = 'source-over';
    if (this.lvOf('magnet') && isMe) { g.strokeStyle = `rgba(201,168,255,${0.16 + Math.sin(t * 3) * 0.05})`; g.lineWidth = 2; g.setLineDash([6, 10]); g.lineDashOffset = -t * 20; g.beginPath(); g.arc(p.x, p.y, this.magnetRadius(), 0, TAU); g.stroke(); g.setLineDash([]); }
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
    if (p.linkFx > 0) { // 组合完成：飞机周围转一圈金色光环（2.5 秒）
      const k = Math.min(1, p.linkFx), r = 46 + (2.5 - p.linkFx) * 6; g.save(); g.globalCompositeOperation = 'lighter'; drawGlow(g, p.x, p.y, r * 1.6, GLOW.gold, 0.35 * k);
      g.strokeStyle = `rgba(255,227,138,${0.8 * k})`; g.lineWidth = 3; g.setLineDash([10, 8]); g.lineDashOffset = -t * 60; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke(); g.setLineDash([]);
      for (let i = 0; i < 4; i++) { const a = t * 3 + (i * TAU) / 4; g.fillStyle = `rgba(255,246,200,${k})`; g.beginPath(); g.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 4, 0, TAU); g.fill(); } g.restore();
    }
    if (p.muzzle > 0 && this.state === 'play') { // 炮口闪光：改造越多越亮，颜色是最高级那项改造的颜色
      const top = GUN_ORDER.filter((id) => p.gun[id]).sort((a, b) => p.gun[b] - p.gun[a])[0], c = top ? SKILLS[top].glow : 'rgba(255,246,220,0.9)', k = p.muzzle, sz = 10 + 3 * (top ? p.gun[top] : 0);
      g.globalCompositeOperation = 'lighter'; drawGlow(g, p.x + 30, p.y + 2, sz * 2.2, c, 0.75 * k);
      g.fillStyle = `rgba(255,255,255,${0.9 * k})`; g.beginPath(); g.moveTo(p.x + 22, p.y + 2 - sz * 0.35); g.lineTo(p.x + 30 + sz * 1.4 * k, p.y + 2); g.lineTo(p.x + 22, p.y + 2 + sz * 0.35); g.closePath(); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
  }
  drawEnemy(g, e) {
    const t = this.t;
    const k = e.kick || 0; // 被打中：顺着子弹方向退一点、压扁一下（只是画面）
    g.save(); g.translate(e.x + Math.cos(e.kickA || 0) * 5 * k, e.y + Math.sin(e.kickA || 0) * 5 * k);
    if (k > 0) g.scale(1 - 0.14 * k, 1 + 0.1 * k);
    if (e.type === 'mirror') { g.globalAlpha = 0.8; g.scale(0.3, 0.3); drawClockBoss(g, { x: 0, y: 0, phase: 2, minA: t * 2, hourA: t * 0.3, weakT: 0, mouth: 0, lookA: Math.PI, shield: 0, hitFlash: e.hitFlash }, t + e.seed); g.restore(); return; }
    (EnemyArt[e.type] || EnemyArt.jelly)(g, e, t + e.seed);
    if (e.hitFlash > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, e.r * 1.25, GLOW.white, e.hitFlash > 0.75 ? 0.95 : e.hitFlash * 0.45); g.globalCompositeOperation = 'source-over'; } // 前两帧整只发白，再淡出
    if (e.frozen > 0) { g.fillStyle = 'rgba(200,240,255,0.45)'; g.strokeStyle = 'rgba(232,251,255,0.9)'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 + 0.3; g.lineTo(Math.cos(a) * (e.r + 6), Math.sin(a) * (e.r + 6)); } g.closePath(); g.fill(); g.stroke(); }
    if (e.stun > 0) { g.strokeStyle = '#bfe9ff'; g.lineWidth = 1.6; for (let i = 0; i < 3; i++) { const a = t * 8 + i * 2; g.beginPath(); g.moveTo(Math.cos(a) * 12, -e.r - 6); g.lineTo(Math.cos(a) * 12 + 4, -e.r - 12); g.stroke(); } }
    if (e.mark) { g.strokeStyle = `rgba(255,120,90,${0.7 + Math.sin(t * 10) * 0.3})`; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, e.r + 8, 0, TAU); g.moveTo(-e.r - 12, 0); g.lineTo(-e.r - 4, 0); g.moveTo(e.r + 12, 0); g.lineTo(e.r + 4, 0); g.stroke(); }
    if (e.clockMark) { g.strokeStyle = '#ffd76a'; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, e.r + 10, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -e.r); g.moveTo(0, 0); g.lineTo(e.r * 0.6, 0); g.stroke(); }
    g.restore();
    if (e.elite || (e.lurk && e.hp < e.maxHp)) { const w = e.elite ? 80 : 56, y = e.part === 'hand' && e.from > 0 ? e.y - 84 : e.y - e.r - 26; g.fillStyle = 'rgba(14,11,40,0.75)'; g.fillRect(e.x - w / 2, y, w, 7); g.fillStyle = '#ff9d8c'; g.fillRect(e.x - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, 7); } // 地图伸出来的东西挨了打才显血条：看得出打得碎
    if (e.armorMax) drawArmorPips(g, e);
    if (e.goal && this.mode === 'run') drawGoalMark(g, e, t);
    // 第一只厚甲怪：一步一步教 —— 对准甲片 → 破甲 → 打核心
    if (e.type === 'armor' && e.goal && this.goal && this.goal.kind === 'armor1') drawStepPill(g, e.x, e.y - e.r - 62, e.broken ? '甲碎了 · 打核心！' : e.crack ? '甲片在裂 · 继续对准打' : '对准甲片连续打', e.broken ? '#ff9fcf' : '#e6ecff', 0.95);
  }
  /* 入场中的敌人：背景推近 / 裂缝钻出时从小变大、半透明；后方绕行时带虚线轮廓，都还不能碰撞 */
  drawIncoming(g, q) {
    const e = q.e, d = e.depth === undefined ? 0 : e.depth, s = q.mode === 'arc' || q.mode === 'drop' ? 1 : 0.35 + 0.65 * d;
    g.save(); g.globalAlpha = q.mode === 'arc' ? 0.7 : 0.35 + 0.6 * d; g.translate(e.x, e.y); g.scale(s, s);
    (EnemyArt[e.type] || EnemyArt.jelly)(g, e, this.t + e.seed);
    g.restore();
    if (q.mode === 'arc') { g.save(); g.strokeStyle = 'rgba(255,178,168,0.8)'; g.lineWidth = 2; g.setLineDash([4, 5]); g.beginPath(); g.arc(e.x, e.y, e.r + 8, 0, TAU); g.stroke(); g.setLineDash([]); g.restore(); }
  }
  drawShot(g, s) {
    const a = Math.atan2(s.vy, s.vx), t = this.t;
    if (s.gun) this.drawGunMods(g, s, a, t);
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
  /* 主炮弹上的改造：拿到什么，子弹就长什么样（每一发都看得见 Build） */
  drawGunMods(g, s, a, t) {
    const ux = Math.cos(a), uy = Math.sin(a), own = this.players[s.owner];
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    if (own && own.linkFx > 0) drawGlow(g, s.x, s.y, 22, GLOW.gold, 0.6 * Math.min(1, own.linkFx)); // 组合刚完成：这几秒的子弹都带金光
    if (s.pierceLv) { // 穿透：金色长光轨，越高级越长；3 级是一道白金光枪
      const L = 22 + 18 * s.pierceLv, x0 = s.x - ux * L, y0 = s.y - uy * L, gr = g.createLinearGradient(x0, y0, s.x, s.y);
      gr.addColorStop(0, 'rgba(255,227,138,0)'); gr.addColorStop(1, s.pierceLv >= 3 ? 'rgba(255,250,225,0.95)' : 'rgba(255,227,138,0.85)');
      g.strokeStyle = gr; g.lineWidth = s.pierceLv >= 3 ? 7 : 4.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(s.x, s.y); g.stroke();
      if (s.pierceLv >= 3) { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(s.x - ux * L * 0.6, s.y - uy * L * 0.6); g.lineTo(s.x + ux * 6, s.y + uy * 6); g.stroke(); }
    }
    if (s.homLv && s.hist && s.hist.length >= 4) { // 追踪：青色尾迹沿真实飞行路线弯过去；3 级带星屑
      const H = s.hist; g.strokeStyle = s.homLv >= 3 ? 'rgba(170,250,255,0.85)' : 'rgba(111,240,255,0.6)'; g.lineWidth = 2 + s.homLv;
      g.beginPath(); g.moveTo(H[0], H[1]); for (let i = 2; i < H.length; i += 2) g.lineTo(H[i], H[i + 1]); g.lineTo(s.x, s.y); g.stroke();
      if (s.homLv >= 3) { g.fillStyle = '#e8fdff'; for (let i = 0; i < H.length; i += 4) g.fillRect(H[i] - 1.5 + Math.sin(t * 20 + i) * 2, H[i + 1] - 1.5, 3, 3); }
    }
    if (s.bombLv) { // 爆破：橙色引信圈，越高级越大、闪得越快
      const r = 9 + s.bombLv * 2.5; drawGlow(g, s.x, s.y, r * 1.8, 'rgba(255,154,107,0.85)', 0.35 + 0.25 * Math.sin(t * (10 + s.bombLv * 6)));
      g.strokeStyle = 'rgba(255,170,120,0.9)'; g.lineWidth = 2; g.beginPath(); g.arc(s.x, s.y, r, t * 8, t * 8 + Math.PI * 1.3); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
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
      if (w.hidden) continue; // 地图出手的扑咬路线由 drawLurks 用危险色单独画
      if (w.kind === 'line') {
        const ex = w.x + Math.cos(w.a) * w.len, ey = w.y + Math.sin(w.a) * w.len;
        if (!w.fired) { g.strokeStyle = bright ? `rgba(255,255,255,${0.45 + 0.4 * u})` : 'rgba(255,255,255,0.14)'; g.lineWidth = bright ? 2 + u * 2 : 1.2; g.setLineDash(bright ? [14, 8] : []); g.lineDashOffset = -t * 120; g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]); }
        if (w.fired && w.beamT > 0) { g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,248,220,0.9)'; g.lineWidth = w.w; g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(ex, ey); g.stroke(); g.strokeStyle = 'rgba(255,207,74,0.4)'; g.lineWidth = w.w * 2.4; g.stroke(); g.globalCompositeOperation = 'source-over'; }
      } else if (w.kind === 'zone' && !w.fired) {
        g.fillStyle = `rgba(255,255,255,${0.05 + (bright ? 0.1 * u : 0)})`; g.fillRect(w.x, w.y, w.w, w.h);
        g.save(); g.beginPath(); g.rect(w.x, w.y, w.w, w.h); g.clip(); g.strokeStyle = `rgba(255,255,255,${bright ? 0.25 + 0.35 * u : 0.1})`; g.lineWidth = 3;
        for (let x = w.x - w.h; x < w.x + w.w; x += 36) { const o2 = (t * 60) % 36; g.beginPath(); g.moveTo(x + o2, w.y + w.h); g.lineTo(x + o2 + w.h, w.y); g.stroke(); }
        g.restore(); g.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * u})`; g.lineWidth = 3; g.strokeRect(w.x, w.y, w.w, w.h);
      } else if (w.kind === 'swell' && !w.fired) { // 鱼群潮：右边缘一道往里推的波光
        g.globalCompositeOperation = 'lighter';
        const gr = g.createLinearGradient(w.x + w.w, 0, w.x - 40 * u, 0); gr.addColorStop(0, `rgba(159,227,240,${0.35 + 0.3 * u})`); gr.addColorStop(1, 'rgba(159,227,240,0)');
        g.fillStyle = gr; g.fillRect(w.x - 40 * u, w.y, w.w + 40 * u, w.h);
        g.strokeStyle = `rgba(220,250,255,${0.3 + 0.5 * u})`; g.lineWidth = 2;
        for (let k = 0; k < 4; k++) { const x = w.x + w.w - ((t * 140 + k * 26) % w.w); g.beginPath(); g.moveTo(x, w.y + 6); g.quadraticCurveTo(x - 10, w.y + w.h / 2, x, w.y + w.h - 6); g.stroke(); }
        g.globalCompositeOperation = 'source-over';
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
        case 'squash': { // 击杀瞬间：朝受力方向压扁的轮廓，一闪就没
          g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.globalAlpha = a * 0.85; g.fillStyle = q.color;
          g.beginPath(); g.ellipse(0, 0, q.size * (0.55 - u * 0.3), q.size * (1.1 + u * 0.5), 0, 0, TAU); g.fill(); g.restore(); break;
        }
        case 'plate': { // 破甲掉下来的大甲片
          g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.globalAlpha = Math.min(1, a * 1.5); g.fillStyle = q.color; g.strokeStyle = PAL.ink; g.lineWidth = 2;
          g.beginPath(); g.roundRect ? g.roundRect(-q.size / 2, -q.size * 0.4, q.size, q.size * 0.8, 5) : g.rect(-q.size / 2, -q.size * 0.4, q.size, q.size * 0.8); g.fill(); g.stroke();
          g.fillStyle = '#5b6798'; g.beginPath(); g.arc(-q.size * 0.25, 0, 2, 0, TAU); g.arc(q.size * 0.25, 0, 2, 0, TAU); g.fill(); g.restore(); break;
        }
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
    const W = this.W, t = this.t, p = this.me, reduce = this.settings.reduceFlash, BO = this.bursting ? this.players[this.bursting.owner] || p : p;
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
    if (this.phase === 'boss' && this.bossIntroT > 0) { // Boss 入场蓄势：压暗 + 上下两条滑动的警示带
      const k = clamp(1 - this.bossIntroT / 2.8, 0, 1), a = Math.sin(k * Math.PI);
      g.fillStyle = `rgba(16,8,30,${0.38 * a})`; g.fillRect(0, 0, W, LH);
      for (const y of [this.arena.top + 6, this.arena.bottom - 34]) {
        g.save(); g.beginPath(); g.rect(0, y, W, 28); g.clip(); g.globalAlpha = 0.85 * a;
        g.fillStyle = '#2a1238'; g.fillRect(0, y, W, 28);
        g.fillStyle = '#ff7e9e'; for (let x = -60 + ((t * 160) % 60); x < W + 60; x += 60) { g.beginPath(); g.moveTo(x, y + 28); g.lineTo(x + 26, y); g.lineTo(x + 44, y); g.lineTo(x + 18, y + 28); g.closePath(); g.fill(); }
        g.restore();
      }
      g.globalAlpha = 1;
    }
    const low = p.hp <= 1 && p.alive && this.mode === 'run';
    const hf = Math.max(this.hurtFlash, low ? 0.4 : 0);
    if (hf > 0) { const gr = g.createRadialGradient(W / 2, LH / 2, LH * 0.45, W / 2, LH / 2, W * 0.7); gr.addColorStop(0, 'rgba(255,122,107,0)'); gr.addColorStop(1, `rgba(255,122,107,${0.42 * hf})`); g.fillStyle = gr; g.fillRect(0, 0, W, LH); }
    if (this.bursting && this.bursting.stage === 'cut') {
      const u = clamp(this.bursting.t / 0.5, 0, 1), C = BO.P.colors;
      g.save();
      g.fillStyle = `rgba(20,14,50,${0.5 * Math.sin(u * Math.PI)})`; g.fillRect(0, 0, W, LH);
      g.translate(W / 2, LH / 2); g.rotate(-0.12);
      const bandH = 190 * Math.min(1, u * 3), x = lerp(-W * 0.6, 0, Ease.outBack(Math.min(1, u * 1.6)));
      const gr = g.createLinearGradient(-W, 0, W, 0); gr.addColorStop(0, C.accent); gr.addColorStop(0.5, C.body); gr.addColorStop(1, C.accent);
      g.globalAlpha = 0.92; g.fillStyle = gr; g.fillRect(-W, -bandH / 2, W * 2, bandH);
      g.globalAlpha = 1; g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.strokeRect(-W, -bandH / 2, W * 2, bandH);
      for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-W + ((i * 173 + t * 1400) % (W * 2)), -bandH / 2 + ((i * 37) % Math.max(1, bandH)), 60, 3); }
      drawPlane(g, BO.planeId, x - 120, 0, 3.4, t, { bright: true });
      g.font = '400 56px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif'; g.textAlign = 'left';
      g.lineWidth = 8; g.strokeStyle = '#2d2358'; g.strokeText(BO.P.burst.name, x + 60, 20); g.fillStyle = '#ffffff'; g.fillText(BO.P.burst.name, x + 60, 20);
      g.restore();
    }
    if (this.flash > 0) { g.fillStyle = `rgba(${this.flashColor},${Math.min(0.55 * this.flashK(), this.flash * 0.6)})`; g.fillRect(0, 0, W, LH); }
    if (this.state === 'victory' && this.victoryT !== undefined) {
      const s = Ease.outBack(clamp(this.victoryT / 0.6, 0, 1));
      g.save(); g.translate(W / 2, LH * 0.42); g.scale(s, s); g.rotate(Math.sin(t * 2) * 0.05);
      g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 220, GLOW.gold, 0.8); g.globalCompositeOperation = 'source-over';
      drawIcon(g, 'star', 0, 0, 200, '#ffd76a', '#2d2358');
      const vt = this.vs ? '对抗结束' : `击败${this.stage.bossName}！`;
      g.font = '400 54px "ZCOOL KuaiLe", sans-serif'; g.textAlign = 'center'; g.lineWidth = 8; g.strokeStyle = '#2d2358'; g.strokeText(vt, 0, 150); g.fillStyle = '#fff6c8'; g.fillText(vt, 0, 150);
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
