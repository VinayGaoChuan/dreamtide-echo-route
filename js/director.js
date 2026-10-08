'use strict';
/* 梦潮：回声航线 v0.8 — 目标调度。
   关卡 = 一串主目标（STAGE_PLANS）：看见障碍 → 成长机会（地图装置 / 精英核心）→ 用同样的敌人验证变强 → 5~8 秒优势窗口 → 预告下一个威胁 → 再上压力。
   一次只有一个主目标 + 最多一个可选地图目标；目标完成才推进，慢的玩家不会被新压力叠上来；普通杂兵一直都有；不偷偷加血。
   事件调度：同一时间只有一个大焦点（升级仪式 / 惊喜变身 / 目标入场），其余排队。 */

const ADV_T = 7;       // 升级后的优势窗口（5~8 秒）
const PREVIEW_T = 2.4; // 下一个威胁先预告，真正的压力等它结束
const PORTRAIT_OF = { crowd: 'jelly', armor1: 'armor', pack: 'armor', cmdr: 'cmdr', chase: 'moth', spawner: 'wreck', boss: 'boss' };
const REWARD_GOAL = { wind: '穿过风车前的风环', mine: '碰一下矿核，拖到岩壁上', house: '碰一下信标亭的铃铛', npc: '碰一下吊舱，护送到修理点', core: '碰一下精英掉下的核心', bridge: '依次穿过三个灯环', giant: '飞到巨鲸的眼睛旁边' };

Object.assign(World.prototype, {
  initDirector() {
    this.plan = (STAGE_PLANS[this.stageId] || STAGE_PLANS['1-1']).map((b) => Object.assign({}, b));
    this.beatIdx = -1; this.goal = null; this.props = []; this.traces = {}; this.memories = [];
    this.D = { st: 'goal', t: 0, budget: 3, next: null, advT: 0, noGoalT: 0, backlogT: 0, delay: 0, mapAt: -1, reward: null, dropSide: 1 };
    this.seg = { tier: 0 };
    Object.assign(this.m, { noGoalMax: 0, goalTimes: [], breaks: 0, backlogs: 0 });
    // 出怪方向跟着压力曲线（v0.12）：一开始只有前方；之后每个目标在平静时教一个新方向 / 一种会出手的地图元素（一次只开一个）
    const TH = this.lurkTheme(); this.sideLog = []; this.lurks = this.lurks || [];
    this.D.open = ['front']; this.D.taught = []; this.D.flankT = 0; this.D.peakT = 0; this.D.lurkT = 0; this.D.teachBeat = -1;
    this.D.teachQ = [];
    for (const dir of TH.order) { const ks = TH.kinds.filter((k) => k.side === dir); if (ks.length) for (const k of ks) this.D.teachQ.push({ dir, lurk: k }); else this.D.teachQ.push({ dir }); }
    for (let i = 0; i < 6; i++) this.addEnemy('jelly', { x: this.W - 80 + i * 56, y: this.player.y, path: 'sine', vx: -150, amp: 14, freq: 2.2, phase: i * 0.5 }); // 开局第一排：第一秒就有东西打
    this.beginBeat(0);
  },
  /* 结算记忆点：惊喜 > 救出伙伴 > 联动 > 关键目标 > 其余；最多挑 3 个，按发生顺序显示 */
  remember(txt, prio = 2) { if (!this.memories.some((m) => m.txt === txt)) this.memories.push({ txt, prio, i: this.memories.length }); },
  pickMemories() { return this.memories.slice().sort((a, b) => b.prio - a.prio || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i).map((m) => m.txt); },

  /* ---------- 目标 ---------- */
  beginBeat(i) {
    const B = this.plan[i]; this.beatIdx = i;
    if (this.D) { this.D.swellT = 9; this.D.peakT = 0; } // 每个目标自己一轮压力：平静 → 蓄压（鱼群潮前 5 秒）→ 鱼群潮 + 7 秒高潮
    this.seg = { tier: i + this.stageTier(), explosive: false };
    this.goal = { B, id: B.id, kind: B.kind, title: B.goal, t: 0, n: 0, total: B.n || 0, targets: [], wave: 0, waves: 0, state: 'active', portrait: B.kind === 'surprise' ? B.surprise : PORTRAIT_OF[B.kind] || 'jelly', sub: null };
    this.D.st = 'goal'; this.D.t = 0; this.D.mapAt = B.map ? B.mapAt || 6 : -1;
    if (B.map === 'npc' && this.wf.clue && this.nextTarget()) this.D.mapAt = Math.min(this.D.mapAt, 1); // 小梦兔整理了线索：要救的伙伴更早出现
    this.m.segsDone = i;
    const G = this.goal;
    switch (B.kind) {
      case 'armor1': this.entrance(B.from, 'armor', { goal: true }, 1); G.total = 1; break;
      case 'pack': G.waves = 3; G.total = 7; this.packWave(G, 0); break;
      case 'cmdr': this.entrance(B.from, 'cmdr', {}, 1); G.total = 1; break;
      case 'chase': G.waves = B.waves || 3; this.chaseWave(G); break;
      case 'spawner': this.spawnWreck(G); G.total = 1; break;
      case 'surprise': this.startSurprise(B.surprise); break;
      case 'boss': this.startBoss(); break;
    }
    this.emit('goal', { idx: i, n: this.plan.length, title: B.goal, kind: B.kind, portrait: G.portrait });
  },
  addTarget(e) { e.goal = true; this.goal.targets.push(e.id); },
  targetsAlive() { const G = this.goal; if (!G) return 0; let n = 0; for (const e of this.enemies) if (e.alive && G.targets.includes(e.id)) n++; for (const q of this.incoming) if (G.targets.includes(q.e.id)) n++; return n + (G.pendingT || 0); },
  packWave(G, w) {
    G.wave = w;
    const mid = (this.arena.top + this.arena.bottom) / 2, from = G.B.from;
    if (w === 0) { // 先两只并排
      for (const k of [-1, 1]) this.entrance(from, 'armor', { goal: true, ty: mid + k * 120 }, 1);
    } else if (w === 2) { // 最后一波只换一个变量：从另一个方向进来
      const side = this.player.y < mid ? 1 : -1; // 两只都从离飞机远的那一边进，不会上下同时封住
      this.entrance(from === 'drop' ? 'front' : 'drop', 'armor', { goal: true, ty: mid - 110, side }, 1);
      this.entrance(from === 'drop' ? 'front' : 'drop', 'armor', { goal: true, ty: mid + 110, tx: this.W * 0.68, side }, 1, 0.8);
    } else { // 再一整队：同一高度排成纵队 + 前面两只护卫 —— 穿透在这里最值
      const ty = clamp(this.player.y, this.arena.top + 90, this.arena.bottom - 90);
      for (let i = 0; i < 3; i++) this.entrance(from === 'drop' ? 'front' : from, 'armor', { goal: true, ty, tx: this.W * (0.66 + i * 0.07), bob: 26, phase: 0 }, 1, i * 0.25);
      for (let i = 0; i < 2; i++) this.addEnemy('jelly', { x: this.W + 20 + i * 40, y: ty, path: 'line', vx: -150 });
      this.text('厚甲编队：排成一列', this.W * 0.7, ty - 80, '#e6ecff', 18, 4);
    }
  },
  chaseWave(G) {
    G.wave++;
    const ev = G.B.event, n = 7;
    if (ev === 'rear') this.rearChase(n, G);
    else this.riftWave(n, G);
  },
  onGoalEvent(type, e) {
    const G = this.goal; if (!G || G.state !== 'active') return;
    if (type !== 'kill') return;
    if (G.kind === 'crowd' && !e.escort && !e.fodder && !e.elite && e.type !== 'armor') G.n++;
    if (G.kind === 'chase' && e.chaser) G.n++;
    if (G.targets.includes(e.id)) {
      G.n = Math.min(G.total, G.n + 1);
      if (e.type === 'cmdr') this.cmdrDown(e);
      if (G.kind === 'armor1' || (G.kind === 'pack' && G.n === G.total)) this.hitStop(0.05);
    }
  },
  goalTick(dt) {
    const G = this.goal; if (!G || G.state !== 'active') return;
    G.t += dt;
    if (this.D.mapAt >= 0 && G.t >= this.D.mapAt && !this.focusBusy()) { this.D.mapAt = -1; this.spawnMapObject(G.B.map, { optional: true }); }
    let done = false;
    switch (G.kind) {
      case 'crowd': done = G.n >= G.total && this.m.firstSkill !== null && !this.worldRitualBusy(); break;
      case 'armor1': case 'cmdr': case 'spawner': done = G.t > 1 && this.targetsAlive() === 0; break;
      case 'pack': if (G.t > 1 && this.targetsAlive() === 0) { if (G.wave + 1 < G.waves) this.packWave(G, G.wave + 1); else done = true; } break;
      case 'chase': {
        const alive = this.enemies.some((e) => e.alive && e.chaser) || this.incoming.some((q) => q.e.chaser) || this.props.some((p) => p.chase);
        if (!alive && G.wave < G.waves) this.chaseWave(G);
        else if (!alive && G.wave >= G.waves) done = true;
        G.total = G.waves * 7; break;
      }
      case 'surprise': done = !!(this.surprise && this.surprise.done); break;
    }
    if (G.kind === 'spawner') this.wreckTick(G, dt);
    if (done) this.goalComplete();
  },
  goalComplete() {
    const G = this.goal, B = G.B; G.state = 'done';
    this.m.goalTimes.push(Math.round(G.t));
    const mem = { armor1: '敲碎了第一身厚甲', pack: '拆散了厚甲编队', cmdr: '打倒了带队精英', spawner: '摧毁了残骸刷怪核心', chase: B.event === 'rear' ? '挡住了后方追兵' : '清空了空间裂缝' }[B.kind];
    if (mem) this.remember(mem);
    Sound.sfx('goalDone'); this.highlight();
    // 每完成一个目标当场入账一份赏金（失败也保留，§8.2）；带队精英再掉一把零件（回家折成废料）
    const pay = beatPay(this.stage); for (const q of this.players) if (!q.gone) q.res.earned += pay;
    if (B.kind === 'cmdr') this.dropWood(this.W * 0.7, (this.arena.top + this.arena.bottom) / 2, WOOD_DROP.cmdr);
    this.emit('goalDone', { title: B.goal, idx: this.beatIdx, pay });
    this.maybeThief();
    if (B.reward) {
      this.D.st = 'reward'; this.D.reward = B.reward; this.D.t = 0;
      if (B.reward !== 'core') this.later(0.6, () => this.spawnMapObject(B.reward, { reward: true }));
    } else { this.D.st = 'adv'; this.D.advT = 3; }
  },
  /* 升级仪式结束：验证编队 + 优势窗口 */
  onRitualDone(src, opt) {
    this.D.verify = null;
    this.verifyFormation(opt, src);
    if (this.D.st === 'reward') { this.D.st = 'adv'; this.D.advT = ADV_T; this.D.reward = null; }
  },
  updateDirector(dt) {
    if (this.phase !== 'fight') return;
    const D = this.D; D.t += dt;
    this.updateProps(dt);
    if (D.st === 'goal') this.goalTick(dt);
    else if (D.st === 'adv') { if (!this.worldRitual() && !D.demo) D.advT -= dt; if (D.advT <= 0) this.previewNext(); }
    else if (D.st === 'preview') {
      const busy = this.enemies.filter((e) => e.alive && !e.fodder && e.x < this.W + 40).length;
      if (D.t >= PREVIEW_T && (busy < 10 || D.t > 5) && !this.focusBusy() && !D.demo) this.beginBeat(this.beatIdx + 1);
    } else if (D.st === 'reward' && D.reward === 'core' && D.t > 30 && !this.props.some((p) => p.kind === 'core') && !this.worldRitualBusy()) { D.st = 'adv'; D.advT = 3; }
    // 验收记录：没有主目标、屏幕上也没有可打的东西的时长（优势窗口里验证编队还在就不算）
    const idle = D.st === 'preview' || (D.st === 'adv' && !this.enemies.some((e) => e.alive && !e.isBoss && e.x < this.W));
    if (idle && !this.worldRitual()) { D.noGoalT += dt; this.m.noGoalMax = Math.max(this.m.noGoalMax, D.noGoalT); } else D.noGoalT = 0;
    this.fill(dt);
    this.burstDemo(dt);
  },
  previewNext() {
    const nb = this.plan[this.beatIdx + 1]; if (!nb) return;
    this.D.st = 'preview'; this.D.t = 0; this.D.verify = null;
    this.emit('goalNext', { title: nb.goal, kind: nb.kind, portrait: nb.kind === 'surprise' ? nb.surprise : PORTRAIT_OF[nb.kind] || 'jelly', boss: nb.kind === 'boss' });
  },
  focusBusy() { return !!(this.worldRitual() || (this.surprise && this.surprise.busy) || this.bursting); },
  /* 压力曲线：平静（目标刚开始）→ 蓄压（鱼群潮快来了）→ 高潮（鱼群潮后 7 秒）→ 喘息（优势窗口 / 预告 / 拿奖励） */
  tension() {
    const D = this.D; if (this.phase !== 'fight' || !D) return 'boss';
    if (D.st !== 'goal') return 'breathe';
    if (D.peakT > 0) return 'peak';
    return D.swellT === undefined || D.swellT > 5 ? 'calm' : 'build';
  },
  /* Boss 战是一局的高潮：打了 12 秒或血掉到八成以下后，每 7 秒从已经开过的侧面来一小队（各带先兆） */
  bossFlanks(dt) {
    if (this.props && this.props.length) this.updateProps(dt); // Boss 场里侧面小队的先兆道具也要走（平时由 updateDirector 推进）
    const D = this.D, b = this.boss; if (!D || !b || this.bossIntroT > 0 || this.focusBusy() || !b.maxHp || ((b.fightT || 0) < 12 && b.hp / b.maxHp > 0.8)) return;
    D.bossFlankT = (D.bossFlankT === undefined ? 4 : D.bossFlankT) - dt;
    const flanks = (D.open || []).filter((s) => s === 'top' || s === 'bottom' || s === 'rear');
    if (D.bossFlankT <= 0 && flanks.length) { D.bossFlankT = 7; this.flankGroup(spick(flanks), 3); }
  },
  noteSide(side) { if (!this.sideLog) this.sideLog = []; this.sideLog.push({ t: this.t, side }); if (this.sideLog.length > 60) this.sideLog.splice(0, 20); },
  /* 侧面来的一小队：上 / 下先有云影或海面鼓起（1 秒），后方先有左边缘红影（1.3 秒）。teach = 第一次，带一句话 */
  flankGroup(side, n, teach) {
    const W = this.W, top = this.arena.top + 50, bot = this.arena.bottom - 50, mid = (top + bot) / 2;
    if (side === 'rear') { this.rearChase(n, null, null); if (teach) this.text('后面也会来敌：看左边的红影', W * 0.3, mid - 120, '#ffb2a8', 20, 5); return; }
    const s = side === 'top' ? -1 : 1, x = srand(W * 0.56, W * 0.8);
    this.props.push({ kind: 'drop', flank: true, side: s, x, t: 0, warn: 1.0, spawn: () => {
      this.noteSide(side);
      for (let i = 0; i < n; i++) this.addIncoming(i % 2 ? 'moth' : 'jelly', { path: 'line', vx: -125 - i * 8 }, 'drop', { x0: x + 40 + i * 24, y0: s < 0 ? TOP - 50 : BOTTOM + 50, x1: x - 30 - i * 34, y1: clamp(mid + (i - (n - 1) / 2) * 46 + s * 40, top, bot), dur: 0.9 });
    } });
    if (teach) this.text(side === 'top' ? '上面也会来敌：看云影' : '下面也会来敌：看海面鼓起', x, s < 0 ? this.arena.top + 110 : this.arena.bottom - 110, '#ffb2a8', 20, 5);
  },
  /* 每帧：按压力决定从哪些方向来，以及什么时候让地图出手 */
  directSides(dt, active) {
    const D = this.D, T = this.tension(); D.tens = T;
    if (D.peakT > 0) D.peakT -= dt;
    D.flankT -= dt; D.lurkT -= dt;
    if (this.focusBusy() || this.phase !== 'fight') return;
    const live = (this.lurks || []).length;
    // 单人时正在教一个第一次见到的装置：地图先不出手（它的预警像在指路），一次只教一件事；
    // 联机各端看过的装置不同，不按它改出怪，保证同步。出怪方向照常开（目标链要靠它推进）
    const teaching = !this.mp && !!this.mapHintKind;
    // 教学：每个目标（从第二个起）在平静时开一个新方向 / 一种地图元素，一次只开一个
    if (T === 'calm' && D.teachQ.length && this.beatIdx >= 1 && D.teachBeat !== this.beatIdx && D.t > 2 && !live && !(teaching && D.teachQ[0].lurk)) {
      const q = D.teachQ.shift(); D.teachBeat = this.beatIdx;
      if (!D.open.includes(q.dir)) D.open.push(q.dir);
      if (q.lurk) { this.spawnLurk(q.lurk, true); D.taught.push(q.lurk); D.lurkT = 10; }
      else this.flankGroup(q.dir, 3, true);
      return;
    }
    const flanks = D.open.filter((s) => s === 'top' || s === 'bottom' || s === 'rear');
    if (T === 'build' && flanks.length && D.flankT <= 0 && active < 28) { D.buildSide = D.buildSide || spick(flanks); D.flankT = 5; this.flankGroup(D.buildSide, 3); } // 蓄压：前方 + 固定的一侧（带预告）
    if (T !== 'build') D.buildSide = null;
    if (T === 'peak') {
      if (flanks.length && D.flankT <= 0 && active < 30) { D.flankT = 2.6; this.flankGroup(spick(flanks), 4); } // 高潮：多个方向轮流来
      if (D.taught.length && !live && D.lurkT <= 0 && !teaching) { D.lurkT = 14; this.spawnLurk(spick(D.taught), false); } // 高潮：地图出手
    }
  },
  /* 首次大招教学：只在“预告下一个目标”的空档里开（不和验证编队、装置操作抢）；清掉敌弹、停刷怪、摆一排好打的靶子，
     同一时间只有这一个中央教学；放过一次（或 9 秒后）就收回，之后只剩大招按钮发光 */
  burstDemo(dt) {
    const D = this.D, p = this.player;
    if (D.demo) {
      D.demo.t += dt; this.bullets.each((b) => { b.on = false; });
      if (this.m.bursts > 0 || D.demo.t > 9) { D.demo = null; this.emit('burstDemoEnd'); }
      return;
    }
    if (!(this.first || this.tutorial) || this.tutorCharge || this.m.bursts > 0 || this.runT < 40 || this.worldRitualBusy()) return;
    if (D.st !== 'preview' || this.mapObjs.some((o) => ['idle', 'tow', 'blow', 'boom'].includes(o.state) && o.x < this.W) || (this.surprise && this.surprise.busy)) return;
    this.tutorCharge = true; D.demo = { t: 0 };
    if (p.stock < 1) this.addStock(1, false, true);
    this.clearBullets(true); this.warns = [];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) this.addEnemy(i % 2 ? 'moth' : 'jelly', { x: this.W + 20 + i * 46, y: clamp(p.y + (r - 1) * 70, this.arena.top + 40, this.arena.bottom - 40), path: 'line', vx: -70, fodder: true });
    this.emit('burstDemo', { name: this.P.burst.name });
  },

  /* ---------- 背景杂兵：一直都有，主目标在场 / 预告 / 仪式时减少 ---------- */
  fill(dt) {
    const D = this.D, st = this.stage;
    if (this.worldRitual() || (this.surprise && this.surprise.busy) || D.demo) return;
    let rate = st.fill || 2.3;
    if (this.runT < 6) rate *= 0.5;
    if (D.st === 'preview') rate *= 0.35;
    else if (D.st === 'goal' && this.goal && this.goal.kind !== 'crowd') rate *= this.goal.kind === 'surprise' ? 0.3 : 0.5;
    else if (D.st === 'reward') rate *= 0.6;
    rate *= 1 + 0.06 * Math.max(0, this.beatIdx); // 越往后的目标，背景杂兵越密
    rate *= this.chainFoe().fill; // 连打的第 2、3 关更密（CHAIN_FOE）
    // 推压与喘息（v0.12）：主目标进行中隔一阵来一波“鱼群潮”——一大群一发就散的杂兵，右边先起一道波光预告。
    // 数量跟着这一局拿到的能力变多（越强越能割草，不加血）；杂兵不开火，只会撞人
    let alive = 0, active = 0, onScreen = false;
    for (const e of this.enemies) { if (!e.alive || e.isBoss) continue; if (!e.swell) alive++; if (e.x < this.W + 60) active++; if (e.x - e.r < this.W) onScreen = true; } // 鱼群潮是给你割的，不算“积压”
    if (D.st === 'goal' && this.goal && this.goal.kind !== 'boss') {
      D.swellT = (D.swellT === undefined ? 12 : D.swellT) - dt;
      if (D.swellT <= 0) { D.swellT = (16 - Math.min(6, this.beatIdx)) * (this.first ? FIRST_RUN.swellK : 1); if (!this.focusBusy() && active < 30) { this.swell(); D.peakT = 7; } } // 屏幕上已经很满就跳过这一波（同屏上限）；鱼群潮之后 7 秒是高潮
    }
    this.directSides(dt, active);
    if (alive > 24) D.backlogT += dt; else D.backlogT = 0;
    if (D.backlogT >= 3) { D.backlogT = 0; D.delay = 3; this.m.backlogs++; this.emit('backlog'); }
    if (D.delay > 0) { D.delay -= dt; return; }
    D.budget = Math.min(D.budget + rate * dt, 14);
    if (active >= 36) return;
    const kind = D.next || (D.next = spick(this.formationPool(this.seg.tier)));
    const size = FORMATION_SIZE[kind] || 5;
    if (D.budget >= size || (!onScreen && D.budget >= size * 0.3)) {
      // 装置留下的入口（岩壁裂口 / 风吹开的门）也会放杂兵出来
      const tr = this.traces.crack || this.traces.door, r = srnd();
      if (RACE_FOE_KINDS[kind]) this.spawnRaceFoe(kind);
      else if (tr && r < 0.3 && kind !== 'beacon' && kind !== 'ticks') this.spawnFromTrace(tr, kind === 'vee' || kind === 'swarm' ? 'moth' : 'jelly', 5);
      else if (this.seg.tier >= 2 && r > 0.8 && (kind === 'boats' || kind === 'line' || kind === 'vee')) this.spawnPushed(kind === 'boats' ? 'boat' : kind === 'vee' ? 'moth' : 'jelly', kind === 'boats' ? 3 : 5);
      else this.spawnFormation(kind);
      this.noteSide('front');
      D.budget = Math.max(0, D.budget - size); D.next = null;
    }
  },
  swell() {
    const W = this.W, top = this.arena.top + 50, bot = this.arena.bottom - 50, picks = Math.max(...this.players.map((q) => (q.gone ? 0 : q.picks.length)));
    // 割草潮 / 跃迁潮（§10.3）：数量跟着这一局拿到的能力涨到铺满屏幕；一整群拾荒无人机先在右半屏亮起跃迁点（预告 1 秒），
    // 然后从右往左一列列跳进来——成型的构筑一扫一大片，是这类游戏直播和短视频里的那个画面
    const n = Math.min(64, 16 + picks * 4), h = Math.min(bot - top, 240 + picks * 24), cy = srand(top + h / 2, bot - h / 2), rows = n > 40 ? 8 : 6;
    const cols = Math.ceil(n / rows), x0 = W * 0.5, cw = (W * 0.46) / cols, pts = [];
    for (let i = 0; i < n; i++) { const col = Math.floor(i / rows), row = i % rows; pts.push({ col, row, x: x0 + (col + 0.5) * cw + srand(-cw * 0.42, cw * 0.42), y: clamp(cy - h / 2 + (row + 0.5 + (col % 2) * 0.5) * (h / rows) + srand(-16, 16), top, bot) }); } // 错开半格、加大抖动：一群，不是一张方阵
    let stars = 0;
    this.addWarn({ kind: 'swell', x: x0, y: cy - h / 2, w: W - x0, h, pts, tWarn: 1.0, silent: true, onFire: () => {
      for (const P of pts) this.later((cols - 1 - P.col) * 0.03, () => {
        if (this.state !== 'play') return;
        // 后面的目标里，混几条会开火的突击艇：割草的同时要留神（出现 0.5 秒后才开火）
        if (this.beatIdx >= 3 && P.col >= 2 && P.row % 2 === 0 && (P.col + P.row) % 4 === 0 && stars++ < 4) this.addEnemy('star', { x: P.x, y: P.y, path: 'sine', amp: 10, freq: 1.6, phase: srand(TAU), vx: -110, swell: true });
        else this.addEnemy((P.col + P.row) % 3 ? 'jelly' : 'moth', { x: P.x, y: P.y, path: 'sine', amp: 12, freq: 2.2, phase: srand(TAU), vx: -120 - srand(0, 30), fodder: true, swell: true });
        if (this.mine()) this.part('flash', P.x, P.y, 0, 0, 0.18, 26, 'rgba(159,227,240,0.6)'); // 跳进来的那一下：一闪，不留圈
      });
    } });
    Sound.sfx('wind', { pan: 0.8 }); this.noteSide('front');
  },
  formationPool(tier) {
    const L = ['line', 'vee', 'snake', 'wall'];
    if (tier >= 2) L.push('boats', 'stars');
    if (tier >= 3) L.push('ticks', 'swarm');
    if (tier >= 5) L.push('beacon', 'stars');
    if (tier >= 1) for (const k of this.raceFoeKinds()) L.push(k); // 这张图的族的招牌敌人（§9.3）
    return L;
  },

  /* ---------- 验证编队：拿到什么就给什么样的敌人 ---------- */
  verifyFormation(opt, src) {
    if (!opt || this.phase !== 'fight') return;
    const W = this.W, p = this.player, top = this.arena.top + 60, bot = this.arena.bottom - 60, y = clamp(p.y, top + 20, bot - 20);
    const id = opt.kind === 'link' ? SYNERGIES[opt.id].need[0] : opt.id;
    let label = '';
    // 验证编队来两波（第二波 1.6 秒后）：新能力要有足够的东西打，力量感才落地
    const wave = (yy) => {
      if (id === 'pierce') { for (let i = 0; i < 7; i++) this.addEnemy('jelly', { x: W + 20 + i * 44, y: yy, path: 'line', vx: -140 }); label = '一整列：一发穿过去'; }
      else if (id === 'homing') { for (let i = 0; i < 8; i++) this.addEnemy('moth', { x: W + 20 + srand(0, 200), y: srand(top, bot), path: 'sine', vx: -120, amp: 30, freq: 1.5, phase: i }); label = '四散的敌人：子弹会拐弯'; }
      else if (id === 'multi') { for (let i = 0; i < 6; i++) this.addEnemy('jelly', { x: W + 20 + (i % 2) * 30, y: clamp(yy + (i - 2.5) * 30, top, bot), path: 'line', vx: -130 }); label = '一面墙：几路子弹一起扫'; }
      else if (id === 'bomb') { for (let i = 0; i < 10; i++) this.addEnemy('moth', { x: W + 30 + srand(-30, 30), y: clamp(yy + srand(-50, 50), top, bot), path: 'line', vx: -120 }); label = '挤成一团：一炸一片'; }
      else { this.spawnFormation('swarm'); label = '一群碎屑虫：试试新支援'; }
    };
    wave(y);
    this.later(1.6, () => { if (this.phase === 'fight') wave(clamp(this.player.y, top + 20, bot - 20)); });
    // 刚拿到打厚甲的能力：再来一只单独的厚甲怪，看看现在几秒能敲碎
    if ((src === 'wind' || src === 'armor') && this.goal && this.goal.kind === 'armor1') { this.later(1.2, () => { if (this.phase === 'fight') { this.addArmor({ x: W + 60, ty: clamp(p.y + 60, top, bot), verify: true }); this.text('同样的厚甲怪：看看现在几秒敲碎', W * 0.72, clamp(p.y, top, bot), '#e6ecff', 17, 4); } }); }
    const armorCheck = (src === 'wind' || src === 'armor') && this.goal && this.goal.kind === 'armor1';
    const info = this.optInfo(opt);
    this.D.verify = { name: `${info.name} ${info.lv}`, label: armorCheck ? '再来一只厚甲怪：看看现在几秒敲碎' : label };
    if (label && !armorCheck) this.text(`试试看 · ${label}`, W * 0.68, clamp(y - 70, top, bot), '#fff3c8', 17, 4);
  },

  /* ---------- 入场方式 ---------- */
  entrance(from, type, o = {}, n = 1, delay = 0) {
    if (delay > 0) { const G = this.goal; if (G && o.goal) G.pendingT = (G.pendingT || 0) + 1; this.later(delay, () => { if (G && o.goal) G.pendingT--; this.entrance(from, type, o, n, 0); }); return; }
    const W = this.W, mid = (this.arena.top + this.arena.bottom) / 2, ty = o.ty !== undefined ? o.ty : mid, tx = o.tx || W * 0.74;
    const make = (mode, P, base) => {
      const e = type === 'cmdr' ? null : this.addIncoming(type, Object.assign({ path: 'hold', tx, ty, bob: 36, fire: 'slow', fireT: srand(1.6, 2.4) }, base || {}), mode, P);
      if (e && o.goal) this.addTarget(e);
      return e;
    };
    if (type === 'cmdr') { // 带队精英：从岩壁裂口 / 前方带着两队护卫出场
      const tr = from === 'crack' && this.traces.crack;
      const c = this.spawnCommander(tr ? { x: tr.x, y: tr.y } : {});
      this.addTarget(c);
      if (tr) { c.x = tr.x; c.y = tr.y; this.text('裂口里钻出了带队精英', tr.x, tr.y + (tr.side < 0 ? 70 : -60), '#ffb2a8', 18, 4); }
      return;
    }
    this.noteSide({ shell: 'scene', rift: 'scene', crack: 'scene', rear: 'rear', drop: 'drop' }[from] || 'front');
    switch (from) {
      case 'shell': this.props.push({ kind: 'shell', x: W + 120, y: ty, tx, t: 0, st: 'in', goal: o.goal }); this.goal.pendingT = (this.goal.pendingT || 0) + 1; break;
      case 'rift': this.openRift(Math.max(W * 0.6, this.player.x + 340), ty, type === 'armor' && this.goal && this.goal.kind === 'armor1' ? ['moth', 'moth', 'moth', 'moth', 'moth', 'armor'] : [type], { goal: o.goal, tx, ty }); if (o.goal) this.goal.pendingT = (this.goal.pendingT || 0) + 1; break;
      case 'rear': this.rearChase(1, null, { type, goal: o.goal, ty }); if (o.goal) this.goal.pendingT = (this.goal.pendingT || 0) + 1; break;
      case 'drop': {
        const side = o.side || (this.D.dropSide = -this.D.dropSide), x = srand(W * 0.62, W * 0.8); // 上下交替，一次只从一边进，不会同时封死
        if (this.sideLog && this.sideLog.length && this.sideLog[this.sideLog.length - 1].side === 'drop') this.sideLog[this.sideLog.length - 1].side = side < 0 ? 'top' : 'bottom';
        this.props.push({ kind: 'drop', side, x, t: 0, warn: 1.0, spawn: () => make('drop', { x0: x + 60, y0: side < 0 ? TOP - 50 : BOTTOM + 50, x1: tx, y1: ty, dur: 0.9 }) });
        if (o.goal) this.goal.pendingT = (this.goal.pendingT || 0) + 1;
        break;
      }
      case 'crack': {
        const tr = this.traces.crack;
        if (tr) make('emerge', { x0: tr.x, y0: tr.y, x1: tx, y1: ty, dur: 1.1 });
        else make('push', { x0: tx + 40, y0: ty - 20, x1: tx, y1: ty, dur: 1.4 });
        break;
      }
      case 'push': make('push', { x0: tx + 40, y0: ty - 20, x1: tx, y1: ty, dur: 1.5 }); break;
      default: { const e = this.addArmor({ x: W + 60, tx, ty }); if (o.goal) this.addTarget(e); }
    }
  },
  /* 背景推近：剪影从远处慢慢变大，越过景深线之前不会碰撞 */
  spawnPushed(type, n) {
    const x = srand(this.W * 0.6, this.W * 0.8), top = this.arena.top + 60, bot = this.arena.bottom - 60, y0 = srand(top + 60, bot - 60);
    for (let i = 0; i < n; i++) {
      const y = clamp(y0 + (i - (n - 1) / 2) * 48, top, bot);
      this.addIncoming(type, type === 'boat' ? { path: 'line', vx: -80, fire: 'drop', fireT: srand(1, 2) } : { path: 'line', vx: -120 }, 'push', { x0: x + 20 + i * 8, y0: y - 30, x1: x + i * 30, y1: y, dur: 1.6 + i * 0.1 });
    }
  },
  spawnFromTrace(tr, type, n) {
    tr.flash = 1;
    for (let i = 0; i < n; i++) this.addIncoming(type, { path: 'line', vx: -150 }, 'emerge', { x0: tr.x, y0: tr.y, x1: tr.x - 90 - i * 30, y1: clamp(tr.y + tr.side * -1 * (60 + i * 26), this.arena.top + 30, this.arena.bottom - 30), dur: 0.7 + i * 0.08 });
  },
  /* 后方追兵：左边缘先有引擎声和影子，沿看得见的弧线从飞机上方或下方绕到右前方；不要求向后射击 */
  rearChase(n, G, one) {
    const p = this.player, mid = (this.arena.top + this.arena.bottom) / 2, below = p.y < mid;
    const cy = below ? this.arena.bottom - 30 : this.arena.top + 30, y0 = below ? this.arena.bottom - 90 : this.arena.top + 90;
    const prop = { kind: 'rear', t: 0, warn: 1.3, below, y0, cy, chase: !one, spawn: null };
    prop.spawn = () => {
      this.noteSide('rear');
      if (one) {
        for (let i = 0; i < 4; i++) this.later(i * 0.15, () => this.addIncoming('moth', { path: 'line', vx: -110 }, 'arc', { x0: -50, y0: y0 + i * 10, cx: p.x + 40, cy, x1: this.W * (0.62 + i * 0.04), y1: clamp(one.ty + (i - 1.5) * 50, this.arena.top + 40, this.arena.bottom - 40), dur: 1.8 }));
        this.later(0.8, () => { const e = this.addIncoming(one.type, { path: 'hold', tx: this.W * 0.74, ty: one.ty, bob: 36, fire: 'slow', fireT: 2.5 }, 'arc', { x0: -60, y0, cx: p.x, cy, x1: this.W * 0.74, y1: one.ty, dur: 2.2 }); if (one.goal) { this.addTarget(e); if (this.goal) this.goal.pendingT--; } });
        return;
      }
      for (let i = 0; i < n; i++) {
        const ty = clamp(mid + (i - (n - 1) / 2) * 44, this.arena.top + 40, this.arena.bottom - 40);
        this.later(i * 0.14, () => this.addIncoming('moth', { path: 'line', vx: -110, chaser: true }, 'arc', { x0: -50, y0: y0 + (i - n / 2) * 8, cx: p.x + 40, cy, x1: this.W * (0.68 + (i % 3) * 0.05), y1: ty, dur: 1.9 }));
      }
    };
    this.props.push(prop);
    Sound.sfx('engine');
  },
  /* 空间裂缝：远离飞机、至少 0.8 秒预警（先扭曲 → 再出轮廓）→ 吐出敌人 → 合上 */
  openRift(x, y, types, o = {}) {
    const p = this.player; x = Math.max(x, p.x + 320); y = clamp(y, this.arena.top + 80, this.arena.bottom - 80);
    if (Math.abs(y - p.y) < 90 && x - p.x < 380) y = clamp(y + (y > p.y ? 120 : -120), this.arena.top + 80, this.arena.bottom - 80);
    this.props.push({ kind: 'rift', x, y, t: 0, warn: 0.95, types: types.slice(), spitT: 0, o, chase: !!o.chase, open: 0 });
    Sound.sfx('riftOpen', { pan: this.pan(x) });
  },
  riftWave(n, G) {
    const p = this.player, top = this.arena.top + 90, bot = this.arena.bottom - 90;
    const y = p.y < (top + bot) / 2 ? srand((top + bot) / 2 + 40, bot) : srand(top, (top + bot) / 2 - 40);
    this.openRift(srand(this.W * 0.62, this.W * 0.8), y, Array(n).fill('moth'), { chase: true });
  },
  /* 地形刷怪点：沉船核心没被打碎前会一直放出蛾子 */
  spawnWreck(G) {
    const y = srand(this.arena.top + 120, this.arena.bottom - 120);
    const e = this.addEnemy('wreck', { x: this.W + 120, y, path: 'wreck', tx: this.W * 0.8, ty: y, elite: false, portrait: 'wreck' });
    this.addTarget(e); G.spawnT = 2.5;
    this.text('沉船里有东西在发光', this.W * 0.78, y - 80, '#ff9fcf', 18, 4);
  },
  wreckTick(G, dt) {
    const e = this.enemies.find((q) => q.alive && q.type === 'wreck'); if (!e || e.x > this.W - 40) return;
    G.spawnT -= dt;
    if (G.spawnT <= 0) { G.spawnT = 2.6; for (let i = 0; i < 2; i++) this.addIncoming('moth', { path: 'line', vx: -170 }, 'emerge', { x0: e.x - 10, y0: e.y, x1: e.x - 90, y1: clamp(e.y + (i ? 60 : -60), this.arena.top + 30, this.arena.bottom - 30), dur: 0.6 }); }
  },
  /* 带队精英倒下：护卫散开 + 掉出核心（完整升级仪式） */
  cmdrDown(e) {
    for (const q of this.enemies) if (q.alive && q.leader === e.id) { q.disband = true; q.fleeAt = q.t + 7; q.stun = 0.8; }
    this.text('护卫散了！', e.x, e.y - 90, '#ffe38a', 22, 5);
    this.hitStop(0.06); this.shake(0.45); this.rumble(0.8, 0.5, 140);
    const p = this.player;
    if (p.hp < p.maxHp) this.dropPickup('heart', e.x, e.y + 30);
    this.dropPickup('chest', e.x, e.y - 30, { vx: -60, vy: 0 });
    this.props.push({ kind: 'core', x: e.x, y: e.y, t: 0, v: 0 });
  },

  /* ---------- 场景道具（入场预警 / 贝壳 / 裂缝 / 核心） ---------- */
  updateProps(dt) {
    const p = this.player;
    for (const P of this.props) {
      P.t += dt;
      switch (P.kind) {
        case 'shell': // 破碎的场景外壳漂进来 → 裂开 → 第一只厚甲怪钻出来（前面有护卫要先清）
          if (P.st === 'in') { P.x = smooth(P.x, P.tx + 30, 1.3, dt); if (P.t > 2.2) { P.st = 'crack'; P.t = 0; Sound.sfx('crack', { pan: this.pan(P.x) }); this.shake(0.15); } }
          else if (P.st === 'crack' && P.t > 0.9) { // 外壳裂开：护卫先冲出来，厚甲怪躲在壳里看着
            P.st = 'guard'; P.t = 0; Sound.sfx('crack', { pan: this.pan(P.x) });
            P.escorts = [];
            for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) P.escorts.push(this.addEnemy('jelly', { x: P.x - 50 - i * 42, y: P.y + (r ? 46 : -46), path: 'line', vx: -95, escort: true }).id);
            this.text('先清掉冲出来的护卫', P.x - 100, P.y - 100, '#ffe38a', 18, 4);
          } else if (P.st === 'guard' && (P.t > 12 || !this.enemies.some((e) => e.alive && P.escorts.includes(e.id) && e.x > 0))) {
            P.st = 'open'; P.t = 0; Sound.sfx('armorBreak', { pan: this.pan(P.x) }); this.shake(0.2);
            for (let i = 0; i < 10; i++) this.part('shard', P.x, P.y, rand(-260, 120), rand(-260, 200), 0.8, rand(6, 11), pick(['#6d5fb8', '#8f82d6', '#c7d0f0']));
            const e = this.addIncoming('armor', { path: 'hold', tx: P.tx, ty: P.y, bob: 34, fire: 'slow', fireT: 2.4 }, 'emerge', { x0: P.x, y0: P.y, x1: P.tx, y1: P.y, dur: 0.8 });
            if (P.goal) { this.addTarget(e); this.goal.pendingT--; }
            this.text('厚甲怪钻出来了！', P.x - 60, P.y - 100, '#e6ecff', 20, 5);
          } else if (P.st === 'open' && P.t > 3) P.done = true;
          if (P.st === 'open') P.x -= 40 * dt;
          break;
        case 'drop': if (!P.fired && P.t >= P.warn) { P.fired = true; P.spawn(); if (this.goal && !P.flank) this.goal.pendingT = Math.max(0, (this.goal.pendingT || 0) - 1); } if (P.t > P.warn + 1) P.done = true; break;
        case 'rear': if (!P.fired && P.t >= P.warn) { P.fired = true; P.spawn(); } if (P.t > P.warn + 2.4) P.done = true; break;
        case 'rift':
          P.open = P.t < P.warn ? 0 : Math.min(1, (P.t - P.warn) / 0.3);
          if (P.t >= P.warn && P.types.length) {
            P.spitT -= dt;
            if (P.spitT <= 0) {
              P.spitT = 0.22; const type = P.types.shift(), o = P.o;
              const base = type === 'armor' ? { path: 'hold', tx: o.tx || P.x - 60, ty: o.ty || P.y, bob: 36, fire: 'slow', fireT: 2.2 } : { path: 'line', vx: -140, chaser: !!P.chase };
              const e = this.addIncoming(type, base, 'emerge', { x0: P.x, y0: P.y, x1: P.x - 70 - srand(0, 60), y1: clamp(P.y + srand(-80, 80), this.arena.top + 30, this.arena.bottom - 30), dur: 0.55 });
              if (o.goal && type === 'armor') { this.addTarget(e); this.goal.pendingT--; }
              Sound.sfx('riftSpit', { pan: this.pan(P.x), gap: 90 });
              if (type === 'armor' && P.types.length === 0 && o.goal) P.spitT = 0; else if (P.types[0] === 'armor') P.spitT = 1.4; // 厚甲怪最后才挤出来
            }
          }
          if (P.t >= P.warn && !P.types.length) { P.closeT = (P.closeT || 0) + dt; if (P.closeT > 0.8) P.done = true; }
          break;
        case 'core': { // 精英核心：飘到飞机前方，碰到（或 3 秒后）变成水晶转盘
          const tx = clamp(p.x + 220, this.W * 0.35, this.W * 0.7), ty = clamp(p.y, this.arena.top + 90, this.arena.bottom - 90);
          P.x = smooth(P.x, tx, 1.5, dt); P.y = smooth(P.y, ty, 1.5, dt);
          if ((dist2(P.x, P.y, p.x, p.y) < 70 * 70 || P.t > 3.2) && !P.done && !this.worldRitual()) { // 多人：碰到后每架飞机各来一次升级
            P.done = true;
            this.queueRitual('core', { full: true, q: 1, x: P.x, y: P.y, device: 'crystal', promise: '强化 Build' });
            this.m.interacts++;
          }
          break;
        }
      }
    }
    this.props = this.props.filter((P) => !P.done);
  },
  drawProps(g) {
    const t = this.t, W = this.W;
    // 持续的场景痕迹：岩壁裂口 / 风吹开的门
    const tr = this.traces;
    if (tr.crack) { drawCrackTrace(g, tr.crack, t); drawTraceLabel(g, tr.crack, '岩壁裂口 · 之后会有敌人从这里钻出', '#c9a8ff', t, W); tr.crack.flash = Math.max(0, (tr.crack.flash || 0) - 0.03); }
    if (tr.door) { drawDoorTrace(g, tr.door, t); drawTraceLabel(g, tr.door, '风吹开的暗门 · 之后会有敌人从这里出来', '#9fe3f0', t, W); tr.door.flash = Math.max(0, (tr.door.flash || 0) - 0.03); }
    for (const P of this.props) {
      switch (P.kind) {
        case 'shell': drawShell(g, P.x, P.y, P.st === 'crack' ? P.t / 0.9 : P.st === 'open' ? 1 : P.st === 'guard' ? 0.95 : 0, P.st === 'open' ? clamp(1 - P.t / 3, 0, 1) : 1, t, P.st === 'guard'); break;
        case 'drop': { // 上方：云影；下方：海面鼓起
          const u = clamp(P.t / P.warn, 0, 1), a = P.fired ? clamp(1 - (P.t - P.warn), 0, 1) : 0.4 + 0.5 * u;
          g.save(); g.globalAlpha = a;
          if (P.side < 0) { const gr = g.createRadialGradient(P.x, TOP, 10, P.x, TOP, 150); gr.addColorStop(0, 'rgba(10,6,30,0.75)'); gr.addColorStop(1, 'rgba(10,6,30,0)'); g.fillStyle = gr; g.fillRect(P.x - 170, TOP - 20, 340, 170); drawStepPill(g, P.x, TOP + 60, '上方来敌', '#ffb2a8', 1); }
          else { g.fillStyle = 'rgba(160,140,255,0.35)'; g.beginPath(); g.ellipse(P.x, BOTTOM - 4, 120, 22 + u * 18, 0, Math.PI, TAU); g.fill(); g.strokeStyle = 'rgba(220,210,255,0.8)'; g.lineWidth = 2; g.stroke(); drawStepPill(g, P.x, BOTTOM - 60, '下方来敌', '#ffb2a8', 1); }
          g.restore(); break;
        }
        case 'rear': { // 左边缘影子 + 看得见的绕行弧线
          const u = clamp(P.t / P.warn, 0, 1), a = P.fired ? clamp(1 - (P.t - P.warn) / 1.5, 0, 1) : u;
          const gr = g.createLinearGradient(0, 0, 130, 0); gr.addColorStop(0, `rgba(255,110,90,${(0.55 + Math.sin(t * 14) * 0.15) * a})`); gr.addColorStop(1, 'rgba(255,110,90,0)');
          g.fillStyle = gr; g.fillRect(0, this.arena.top, 130, this.arena.bottom - this.arena.top);
          if (!P.fired) for (let i = 0; i < 3; i++) { const yy = P.y0 + (i - 1) * 26; g.fillStyle = `rgba(20,10,40,${0.5 * a})`; g.beginPath(); g.ellipse(18 + Math.sin(t * 10 + i) * 4, yy, 16, 9, 0, 0, TAU); g.fill(); } // 引擎影子
          g.save(); g.globalAlpha = a * 0.8; g.strokeStyle = '#ffb2a8'; g.lineWidth = 3; g.setLineDash([10, 10]); g.lineDashOffset = -t * 90;
          const p = this.player; g.beginPath(); g.moveTo(0, P.y0); g.quadraticCurveTo(p.x + 40, P.cy, W * 0.72, (this.arena.top + this.arena.bottom) / 2); g.stroke(); g.setLineDash([]); g.restore();
          if (!P.fired) drawStepPill(g, 120, P.below ? this.arena.bottom - 40 : this.arena.top + 40, (P.below ? '后方追兵 · 会从下方绕到前面' : '后方追兵 · 会从上方绕到前面'), '#ffb2a8', a);
          break;
        }
        case 'rift': drawRift(g, P.x, P.y, P.t, P.warn, P.open, P.closeT || 0, t); break;
        case 'core': drawCoreProp(g, P.x, P.y, t); break;
      }
    }
  },
  /* 奖励装置的当前一步：穿过风环 → 已激活 → 选择强化（之后是“验证新能力”） */
  rewardStep(k) {
    const MR = this.me.ritual; // 目标卡上的提示只看本机这架
    if (MR) return MR.st === 'choose' ? '选择强化 · 飞进一个方案' : '强化来了 · 看它转出什么';
    if (this.me.ritualQueue.length) return '强化装置启动中…';
    if (k === 'core') return this.props.some((p) => p.kind === 'core') ? '碰一下精英掉下的核心' : '强化装置启动中…';
    const o = this.mapObjs.find((q) => q.kind === k && q.reward);
    if (!o) return REWARD_GOAL[k] || '拿奖励';
    const st = o.state;
    if (k === 'wind') return st === 'idle' ? '穿过风车前的风环' : st === 'blow' ? '风环已激活 · 一排敌人被推到炮口前' : '选择强化';
    if (k === 'bridge') return st === 'idle' ? `穿过灯环 ${o.lit.filter(Boolean).length}/3` : st === 'build' ? '断桥接上了' : '选择强化';
    if (k === 'giant') return st === 'idle' ? '飞到巨鲸的眼睛旁边' : st === 'wake' || st === 'gulp' ? '巨鲸醒了 · 把附近的敌人一口吞掉' : '选择强化';
    if (k === 'mine') return st === 'idle' ? '碰一下发光的矿核' : st === 'tow' ? '把矿核拖到发光的岩壁' : '岩壁炸开了 · 选择强化';
    if (k === 'npc') return st === 'idle' ? '碰一下救生舱' : st === 'tow' ? `沿光带护送到修理点 · 耐久 ${o.pod.hp}/3` : st === 'bail' ? '幸存者自己跳伞去修理点了' : '选择支援';
    if (k === 'house') return st === 'idle' ? '碰一下信标亭的铃铛' : '选择主炮改造';
    return REWARD_GOAL[k] || '拿奖励';
  },
  /* ---------- HUD 用的目标信息 ---------- */
  goalHud() {
    const D = this.D, G = this.goal; if (!G) return null;
    const out = { step: this.beatIdx + 1, steps: this.plan.length, title: G.title, portrait: G.portrait, prog: null, opt: null, state: D.st };
    if (D.st === 'reward') { const k = D.reward; out.title = this.rewardStep(k); out.portrait = k; out.prog = null; out.reward = true; }
    else if (D.st === 'adv') { const v = D.verify; out.title = v ? `验证新能力 · ${v.name}` : '优势时间 · 用新能力扫一扫'; out.sub = v ? v.label : null; out.portrait = G.portrait; out.adv = true; }
    else if (D.st === 'preview') { const nb = this.plan[this.beatIdx + 1]; out.title = nb ? `下一个：${nb.goal}` : ''; out.portrait = nb ? (nb.kind === 'surprise' ? nb.surprise : PORTRAIT_OF[nb.kind]) : G.portrait; out.next = true; out.step = this.beatIdx + 2; }
    else {
      const houseWait = this.mapObjs.some((o) => o.kind === 'house' && o.state === 'idle' && o.x < this.W);
      if (G.kind === 'crowd') out.prog = { type: 'count', n: Math.min(G.n, G.total), total: G.total, need: this.m.firstSkill === null && houseWait ? (G.n >= G.total ? '还差一步：碰一下信标亭的铃铛' : '信标亭来了 · 碰一下铃铛') : null };
      else if (G.kind === 'armor1' || G.kind === 'pack') {
        const e = this.enemies.find((q) => q.alive && q.goal && q.type === 'armor');
        out.prog = { type: 'count', n: G.n, total: G.total, crack: e ? (e.broken ? ARMOR.stages : e.crack || 0) : null, broken: e ? !!e.broken : false };
        if (G.kind === 'pack' && this.armorBase !== undefined) out.sub = `敲甲用时：第一只 ${this.armorBase.toFixed(1)} 秒${this.m.armorAfter ? ` → 现在平均 ${this.m.armorAfter.toFixed(1)} 秒` : ''}`;
        else if (e && !e.broken) out.sub = ['对准它连续敲甲片', '裂开一段了 · 继续', '最后一段甲'][e.crack || 0]; else if (e) out.sub = '甲碎了 · 打核心';
      } else if (G.kind === 'cmdr') { const e = this.enemies.find((q) => q.alive && q.type === 'cmdr'); out.prog = { type: 'hp', u: e ? e.hp / e.maxHp : 0 }; out.sub = e && e.rally > 0 ? '举旗了 · 打旗头水晶！' : '等它举旗再集中火力'; }
      else if (G.kind === 'chase') out.prog = { type: 'count', n: Math.min(G.n, G.total), total: G.total };
      else if (G.kind === 'spawner') { const e = this.enemies.find((q) => q.alive && q.type === 'wreck'); out.prog = { type: 'hp', u: e ? e.hp / e.maxHp : 0 }; }
      else if (G.kind === 'surprise' && this.surprise) { out.title = this.surprise.title || G.title; out.prog = this.surprise.prog || null; out.sub = this.surprise.sub || null; }
      const opt = this.mapObjs.find((o) => o.optional && o.state === 'idle' && !(G.kind === 'crowd' && o.kind === 'house' && this.m.firstSkill === null));
      if (opt) out.opt = `可选 · ${REWARD_GOAL[opt.kind] || MAP_OBJECTS[opt.kind].name}`;
    }
    return out;
  },
});

/* ---------- 道具的画法 ---------- */
function drawShell(g, x, y, crack, alpha, t, peek) {
  g.save(); g.globalAlpha = alpha; g.translate(x, y);
  g.fillStyle = '#4a3f8f'; g.strokeStyle = PAL.ink; g.lineWidth = 3;
  const open = crack >= 1 ? 1 : 0;
  for (const s of [-1, 1]) { g.save(); g.rotate(s * open * 0.5); g.beginPath(); g.ellipse(0, s * 18, 70, 42, 0, s < 0 ? Math.PI : 0, s < 0 ? TAU : Math.PI); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#6d5fb8'; g.lineWidth = 2; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 22, s * 18); g.lineTo(i * 14, s * 52); g.stroke(); } g.strokeStyle = PAL.ink; g.lineWidth = 3; g.restore(); }
  if (peek) { g.save(); g.scale(0.8, 0.8); g.translate(0, Math.sin(t * 3) * 3); EnemyArt.armor(g, { crack: 0, armorHp: 1, armorMax: 1, seed: 1 }, t); g.restore(); }
  if (crack > 0 && crack < 1) { g.strokeStyle = `rgba(255,243,200,${0.5 + crack * 0.5})`; g.lineWidth = 2 + crack * 2; g.beginPath(); g.moveTo(-60, 0); for (let i = 0; i < 6; i++) g.lineTo(-60 + i * 24, (i % 2 ? -8 : 8) * crack); g.stroke(); glowAt(g, 0, 0, 90, GLOW.gold, crack * 0.6); }
  g.restore();
}
function drawRift(g, x, y, tt, warn, open, closeT, t) {
  const pre = clamp(tt / (warn * 0.55), 0, 1), line = clamp((tt - warn * 0.55) / (warn * 0.45), 0, 1), close = clamp(1 - closeT / 0.8, 0, 1);
  g.save(); g.translate(x, y);
  // 先是背景扭曲（一圈圈的波纹），再出现裂缝轮廓
  g.strokeStyle = `rgba(200,180,255,${0.35 * pre * close})`; g.lineWidth = 2;
  for (let i = 0; i < 3; i++) { const r = 30 + ((t * 40 + i * 20) % 60); g.beginPath(); g.ellipse(0, 0, r * 0.6, r * 1.3, 0, 0, TAU); g.stroke(); }
  if (line > 0) {
    const h = 90 * line * close, w = 10 + 26 * open * close;
    g.fillStyle = `rgba(20,8,50,${0.9 * close})`; g.beginPath(); g.moveTo(0, -h); g.quadraticCurveTo(w, 0, 0, h); g.quadraticCurveTo(-w, 0, 0, -h); g.fill();
    g.strokeStyle = `rgba(255,159,207,${0.9 * close})`; g.lineWidth = 3; g.stroke();
    glowAt(g, 0, 0, 80, GLOW.pink, 0.5 * close);
  }
  if (tt < warn) drawStepPill(g, 0, -120, '裂缝要开了', '#ff9fcf', 1);
  g.restore();
}
function drawCoreProp(g, x, y, t) {
  glowAt(g, x, y, 70, GLOW.gold, 0.7 + Math.sin(t * 8) * 0.2);
  g.save(); g.translate(x, y); g.rotate(t * 1.5);
  g.fillStyle = '#fff3c8'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(0, -22); g.lineTo(16, 0); g.lineTo(0, 22); g.lineTo(-16, 0); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ffd76a'; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 0); g.lineTo(0, 11); g.lineTo(-8, 0); g.closePath(); g.fill();
  g.restore();
  drawStepPill(g, x, y - 48, '精英核心 · 碰一下', '#ffd76a', 1);
}
function drawTraceLabel(g, tr, text, color, t, W) {
  const a = tr.born === undefined ? 0 : clamp(1 - (t - tr.born - 3.5) / 0.8, 0, 1);
  if (a > 0) drawStepPill(g, clamp(tr.x, 170, W - 190), tr.y + (tr.side < 0 ? 78 : -74), text, color, a);
}
function drawCrackTrace(g, c, t) {
  g.save(); g.translate(c.x, c.y); g.globalAlpha = 0.55 + 0.45 * clamp(c.flash || 0, 0, 1); // 场景痕迹：平时压暗，敌人钻出来时亮一下
  const s = c.side; // -1 顶部岩壁 / 1 底部岩壁
  g.fillStyle = '#231a4f'; g.beginPath(); g.moveTo(-90, 0); g.lineTo(-60, -s * 30); g.lineTo(-20, -s * 12); g.lineTo(10, -s * 44); g.lineTo(50, -s * 16); g.lineTo(90, 0); g.lineTo(90, s * 80); g.lineTo(-90, s * 80); g.closePath(); g.fill();
  g.fillStyle = 'rgba(10,4,30,0.95)'; g.beginPath(); g.ellipse(0, -s * 4, 36, 18, 0, 0, TAU); g.fill();
  glowAt(g, 0, -s * 4, 50, GLOW.purple, 0.45 + Math.sin(t * 3) * 0.1);
  g.strokeStyle = 'rgba(201,168,255,0.8)'; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -s * 4, 36, 18, 0, 0, TAU); g.stroke();
  g.restore();
}
function drawDoorTrace(g, d, t) {
  g.save(); g.translate(d.x, d.y); g.globalAlpha = 0.4 + 0.5 * clamp(d.flash || 0, 0, 1); // 只是场景里的暗门：不发光、不像能进去的入口
  g.fillStyle = 'rgba(30,24,80,0.9)'; g.strokeStyle = 'rgba(159,227,240,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-26, 34); g.lineTo(-26, -10); g.quadraticCurveTo(0, -44, 26, -10); g.lineTo(26, 34); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
