'use strict';
/* 梦潮：回声航线 v0.11 — 对抗（自由竞争，2~4 人）。每人一条航道，约 6 分钟，三段各约 2 分钟。
   · 主要胜负 = 累计目标分：清掉自己航道的风塔守卫（主要得分，本段第一个清掉的再加一点）→ 风塔变成两个干扰洞口，
     飞进一个，把“矿甲列阵”或“侧风”送进对手的航道（每人每段一次；对手已经有一个强干扰时排队，不会叠在一起）。
   · 普通击破是持续小分；防守方处理掉干扰也有分。冲突区开放时，航道交界那条标出来的带子里可以直接打对手：
     伤害按各自真实武器伤害换算，同一个人打同一个人有命中间隔，掉一颗心后有短暂无敌；击毁只给有限压制分。
   · 击毁：约 3 秒后在自己航道原地复归，保留 Build，扣有限的分。没有失败，三段打完按分数排名；同分比清塔数，再同分算平局。
   · 升级按阶段统一触发：全场一起进入安全选择（和合作同一套仪式），比赛计时停住，不把等待算成战斗时间。
   各端用同一个种子、同一串操作模拟，分数和结局在每台电脑上都一样。 */

const VS = {
  stages: 3, stageT: 120, towerAt: 14, offerAt: [3, 62], clash: [80, 106], clashWarn: 3, band: 72,
  pts: { kill: 0.25, big: 2, tower: 150, first: 50, sent: 40, held: 60, ko: 40, koLoss: 40 }, // 目标分为主：击破是持续小分（4 只 1 分）
  respawn: 3, respawnInv: 2, heart: 30, hitGap: 0.25, heartInv: 1, holeT: 12, holeR: 46, holeDwell: 0.35,
  windT: 8, windWarn: 1.5, windPush: 260, waveWarn: 1.8, waveLife: 26, fill: [1.4, 1.8, 2.2], laneCap: 14,
};
const VS_INT = { armor: { name: '矿甲列阵', icon: 'blast', color: '#ffb36b' }, wind: { name: '侧风', icon: 'wing', color: '#9fe3f0' } };

Object.assign(World.prototype, {
  initVs() {
    // 合作关卡的调度器不用；这些字段留空，共用代码（结算、HUD、教学）读到的都是安全的值
    this.plan = []; this.beatIdx = 0; this.goal = null; this.props = []; this.traces = {}; this.memories = [];
    this.D = { st: 'vs', t: 0, budget: 0, next: null, advT: 0, noGoalT: 0, backlogT: 0, delay: 0, mapAt: -1, reward: null, dropSide: 1 };
    this.seg = { tier: 1 };
    const n = this.np, h = (BOTTOM - TOP) / n;
    this.vs = {
      n, h, stage: 0, t: 0, clash: false, over: false,
      lanes: this.players.map((q, k) => ({ top: TOP + k * h, bot: TOP + (k + 1) * h, budget: 1.5, next: null, wind: null, wave: null, queue: [] })),
      score: this.players.map(() => 0), towers: this.players.map(() => 0), held: this.players.map(() => 0), kos: this.players.map(() => 0),
      tower: [], holes: [], firstTower: -1, offered: {}, stageLog: [],
    };
    for (const q of this.players) { q.x = this.W * 0.22; q.y = this.vsMid(q.idx); q.pvpAcc = 0; q.pvpCd = {}; q.vsRespawn = 0; q.lastHitBy = -1; q.lastHitT = -9; }
    this.emit('vsStage', { stage: 1, of: VS.stages });
  },
  vsMid(k) { const L = this.vs.lanes[k]; return (L.top + L.bot) / 2; },
  /* 这架飞机此刻能飞的上下范围：自己的航道；冲突区开放时可以伸进相邻航道的那条带子里 */
  vsRange(p) {
    const V = this.vs, L = V.lanes[p.idx];
    return { top: L.top + 14 - (V.clash && p.idx > 0 ? VS.band : 0), bot: L.bot - 14 + (V.clash && p.idx < V.n - 1 ? VS.band : 0) };
  },
  vsClamp(p, dt) {
    if (p.ritual && p.ritual.st !== 'resume') return; // 选升级时可以飞去候选圈（全场都停着）
    const r = this.vsRange(p);
    if (p.y < r.top) p.y = Math.min(r.top, p.y + 600 * dt); else if (p.y > r.bot) p.y = Math.max(r.bot, p.y - 600 * dt); // 刚选完升级 / 冲突区关上：慢慢回到自己航道
  },
  /* 冲突区：两条航道交界处上下各一条带子 */
  vsInBand(y) { const V = this.vs; for (let k = 1; k < V.n; k++) { const b = V.lanes[k].top; if (Math.abs(y - b) < VS.band) return true; } return false; },
  vsLaneOf(y) { const V = this.vs; for (let k = 0; k < V.n; k++) if (y < V.lanes[k].bot) return k; return V.n - 1; },
  /* 在某条航道里刷怪：临时把场地缩成这条航道，复用合作的编队代码；新敌人记上航道 */
  vsSpawnIn(k, fn) {
    const V = this.vs, L = V.lanes[k], keep = this.arena, n0 = this.enemies.length, i0 = this.incoming.length;
    this.arena = { top: L.top, bottom: L.bot };
    try { fn(); } finally { this.arena = keep; }
    for (let i = n0; i < this.enemies.length; i++) this.enemies[i].lane = k;
    for (let i = i0; i < this.incoming.length; i++) this.incoming[i].e.lane = k;
  },
  vsPool(tier) { const L = ['line', 'vee', 'snake', 'wall']; if (tier >= 2) L.push('boats', 'stars'); if (tier >= 3) L.push('swarm'); return L; }, // 不刷会打穿别人航道的环形弹 / 激光

  updateVs(dt) {
    const V = this.vs; if (V.over) return;
    const frozen = !!this.worldRitual(); // 升级时比赛计时停住
    if (!frozen) V.t += dt;
    const st = V.stage, base = st * VS.stageT, lt = V.t - base;
    this.seg.tier = st + 1;
    // 统一升级：每段两次，全场同一刻开始
    for (let i = 0; i < VS.offerAt.length; i++) {
      const key = st + ':' + i;
      if (!V.offered[key] && lt >= VS.offerAt[i] && !this.bursting) { V.offered[key] = 1; this.queueRitual('vs', { full: st === 0 && i === 0 }); }
    }
    if (lt >= VS.towerAt && !V.tower.some((T) => T.stage === st)) this.vsTowers(st);
    const was = V.clash; V.clash = lt >= VS.clash[0] && lt < VS.clash[1];
    if (V.clash && !was) { this.emit('vsClash', { open: true }); Sound.sfx('warn', { gap: 200 }); }
    if (!V.clash && was) this.emit('vsClash', { open: false });
    if (!frozen) { this.vsFill(dt); this.vsHoles(dt); }
    this.vsTowerTick();
    this.vsInterference(dt, frozen);
    this.vsRespawnTick(dt);
    if (lt >= VS.stageT) this.vsStageEnd();
  },
  vsFill(dt) {
    const V = this.vs, rate = VS.fill[Math.min(V.stage, VS.fill.length - 1)];
    for (let k = 0; k < V.n; k++) {
      const q = this.players[k], L = V.lanes[k]; if (q.gone) continue;
      let active = 0; for (const e of this.enemies) if (e.alive && e.lane === k && e.x < this.W + 60) active++;
      if (active >= VS.laneCap) continue;
      L.budget = Math.min(L.budget + rate * dt * (L.wave ? 0.4 : 1), 12);
      const kind = L.next || (L.next = spick(this.vsPool(this.seg.tier))), size = FORMATION_SIZE[kind] || 5;
      if (L.budget >= size || (active === 0 && L.budget >= size * 0.3)) { this.vsSpawnIn(k, () => this.spawnFormation(kind)); L.budget = Math.max(0, L.budget - size); L.next = null; }
    }
  },
  /* 每段一次：每条航道出一座风塔，带三只厚甲守卫 */
  vsTowers(st) {
    const V = this.vs;
    for (let k = 0; k < V.n; k++) {
      if (this.players[k].gone) continue;
      const y = this.vsMid(k), T = { stage: st, lane: k, x: this.W * 0.8, y, st: 'guard', t: 0, guards: [] }, gap = Math.min(55, V.h * 0.28);
      this.vsSpawnIn(k, () => { for (const dy of [-gap, 0, gap]) { const e = this.addArmor({ x: this.W + 60 + Math.abs(dy), tx: this.W * 0.72 + Math.abs(dy) * 0.5, ty: y + dy, bob: 10, fireT: srand(2.2, 3.4) }); e.maxHp = e.hp = e.hp * (1 + st * 0.35); e.vsGuard = true; T.guards.push(e.id); } });
      V.tower.push(T);
    }
    V.firstTower = -1;
    this.emit('vsTower', { stage: st });
  },
  vsTowerTick() {
    const V = this.vs;
    for (const T of V.tower) {
      if (T.st !== 'guard') continue;
      if (this.players[T.lane].gone) { T.st = 'gone'; continue; }
      if (this.enemies.some((e) => e.alive && T.guards.includes(e.id)) || this.incoming.some((q) => T.guards.includes(q.e.id))) continue;
      // 风塔清掉：分数归这条航道的主人（不归“最后一发”）；本段第一个清掉的再加一点
      const k = T.lane, first = V.firstTower < 0;
      if (first) V.firstTower = k;
      this.vsAdd(k, VS.pts.tower + (first ? VS.pts.first : 0), first ? '风塔 · 第一个' : '风塔', T.x, T.y - 60);
      V.towers[k]++; T.st = 'open'; T.t = 0;
      const L = V.lanes[k], dy = Math.min(70, V.h * 0.3);
      V.holes.push({ lane: k, x: T.x - 90, y: clamp(T.y - dy, L.top + 40, L.bot - 40), kind: 'armor', t: 0, dwell: 0, st: 'open' }, { lane: k, x: T.x - 90, y: clamp(T.y + dy, L.top + 40, L.bot - 40), kind: 'wind', t: 0, dwell: 0, st: 'open' });
      this.highlight();
      if (this.players[k] === this.me) Sound.sfx('goalDone');
      this.emit('vsTowerDone', { lane: k, first });
    }
  },
  /* 干扰洞口：只有这条航道的主人能用；飞进去停一下就送出（两选一，另一个随之关上） */
  vsHoles(dt) {
    const V = this.vs;
    for (const H of V.holes) {
      if (H.st !== 'open') continue;
      H.t += dt; const p = this.players[H.lane];
      if (H.t > VS.holeT || !p || p.gone) { H.st = 'closed'; continue; }
      const inside = p.alive && dist2(p.x, p.y, H.x, H.y) < VS.holeR * VS.holeR;
      H.dwell = inside ? H.dwell + dt : Math.max(0, H.dwell - dt * 2);
      if (H.dwell >= VS.holeDwell) {
        for (const o of V.holes) if (o.lane === H.lane && o.st === 'open') o.st = 'closed';
        H.st = 'used'; this.vsSend(H.lane, H.kind);
      }
    }
  },
  /* 送给谁：除自己以外分数最高的（同分取编号小的）——领先的人受到的干扰最多，落后的人有追分机会 */
  vsTarget(from) {
    const V = this.vs; let best = -1;
    for (let k = 0; k < V.n; k++) { if (k === from || this.players[k].gone) continue; if (best < 0 || V.score[k] > V.score[best]) best = k; }
    return best;
  },
  vsSend(from, kind) {
    const V = this.vs, to = this.vsTarget(from); if (to < 0) return;
    this.vsAdd(from, VS.pts.sent, `送出${VS_INT[kind].name}`, this.players[from].x, this.players[from].y - 40);
    V.lanes[to].queue.push({ kind, from, id: this.eid++ });
    this.emit('vsSend', { from, to, kind });
    if (this.players[from] === this.me) Sound.sfx('select', { ui: true });
  },
  /* 干扰：每条航道同一时间最多一个强干扰，后来的排队；先预兆再生效 */
  vsInterference(dt, frozen) {
    const V = this.vs;
    for (let k = 0; k < V.n; k++) {
      const L = V.lanes[k], p = this.players[k];
      if (p.gone) { L.queue = []; L.wave = null; L.wind = null; continue; }
      if (!L.wave && !L.wind && L.queue.length && !frozen) {
        const q = L.queue.shift();
        if (q.kind === 'armor') L.wave = { st: 'warn', t: 0, from: q.from, ids: [], y: this.vsMid(k) };
        else { const L2 = this.vs.lanes[k], mid = (L2.top + L2.bot) / 2, upper = p.y < mid; L.wind = { st: 'warn', t: 0, from: q.from, top: upper ? L2.top : mid, bot: upper ? mid : L2.bot, dir: upper ? 1 : -1, hurt: p.hp, hit: false }; }
        if (p === this.me) Sound.sfx('warn', { prio: true });
        this.emit('vsIncoming', { to: k, kind: q.kind, from: q.from });
      }
      if (frozen) continue;
      const W2 = L.wave;
      if (W2) {
        W2.t += dt;
        if (W2.st === 'warn' && W2.t >= VS.waveWarn) {
          W2.st = 'live'; W2.t = 0;
          this.vsSpawnIn(k, () => {
            const e = this.addArmor({ x: this.W + 60, tx: this.W * 0.68, ty: W2.y, bob: 12 }); e.vsInt = true; W2.ids.push(e.id);
            for (let i = 0; i < 4; i++) { const j = this.addEnemy('jelly', { x: this.W + 30 + i * 46, y: W2.y + (i % 2 ? 34 : -34), path: 'sine', vx: -130, amp: 12, freq: 2, phase: i }); j.vsInt = true; W2.ids.push(j.id); }
          });
        } else if (W2.st === 'live') {
          const left = this.enemies.some((e) => e.alive && W2.ids.includes(e.id));
          if (!left) { if (W2.t < VS.waveLife) this.vsHeld(k, '挡住了矿甲列阵'); L.wave = null; }
          else if (W2.t > VS.waveLife) L.wave = null; // 太久没处理：不再算防守分，敌人留着继续打
        }
      }
      const WD = L.wind;
      if (WD) {
        WD.t += dt;
        if (WD.st === 'warn' && WD.t >= VS.windWarn) { WD.st = 'live'; WD.t = 0; WD.hurt = p.hp; }
        else if (WD.st === 'live') {
          // 侧风：这半条航道里的飞机被吹向另一半（只推位置，不改按键、不挡视线）
          if (p.alive && p.y >= WD.top && p.y <= WD.bot) p.y += WD.dir * VS.windPush * dt;
          if (p.hp < WD.hurt) WD.hit = true;
          if (WD.t >= VS.windT) { if (!WD.hit) this.vsHeld(k, '顶住了侧风'); L.wind = null; }
        }
      }
    }
  },
  vsHeld(k, why) { this.vs.held[k]++; this.vsAdd(k, VS.pts.held, why, this.players[k].x, this.players[k].y - 46); },
  vsAdd(k, n, why, x, y) {
    const V = this.vs; V.score[k] = Math.max(0, V.score[k] + n);
    if (why && x !== undefined) this.text(`${n > 0 ? '+' : ''}${n} ${why}`, x, y, n > 0 ? '#ffe38a' : '#ffb2a8', n >= 50 ? 20 : 15, 3);
  },
  /* 击破：普通小分，厚甲 / 精英多一点；记在开枪的人头上 */
  vsKill(e) { const p = this.player; if (!p || p.gone) return; this.vs.score[p.idx] += e.elite || e.type === 'armor' || e.type === 'cmdr' ? VS.pts.big : VS.pts.kill; },
  /* 主炮打到对手：只在冲突区开放、对手在冲突带里时；同一人打同一人有命中间隔，累计到一颗心才扣，扣完短暂无敌 */
  vsPvpShot(s) {
    const V = this.vs; if (!V.clash || !this.vsInBand(s.y)) return;
    for (const q of this.players) {
      if (q.idx === s.owner || !q.alive || q.gone || q.inv > 0 || !this.vsInBand(q.y)) continue;
      if (q.ritual && q.ritual.st !== 'resume') continue;
      if (dist2(q.x, q.y, s.x, s.y) > (q.r + s.r + 6) * (q.r + s.r + 6)) continue;
      s.on = false;
      const cd = q.pvpCd[s.owner] || -9; if (this.t - cd < VS.hitGap) return;
      q.pvpCd[s.owner] = this.t; q.pvpAcc += s.dmg; q.lastHitBy = s.owner; q.lastHitT = this.t;
      this.part('ring', q.x, q.y, 0, 0, 0.25, 26, '#ff8a7a');
      if (q.pvpAcc >= VS.heart) { q.pvpAcc -= VS.heart; this.withPlayer(q, () => this.hurtPlayer(1, 'pvp', q)); q.inv = Math.max(q.inv, VS.heartInv); }
      return;
    }
  },
  /* 击毁：不淘汰，约 3 秒后在自己航道原地复归；扣有限的分，刚被对手打过就给对手压制分 */
  vsDown(p) {
    const V = this.vs; p.hp = 0; p.alive = false; p.vsRespawn = VS.respawn; p.pvpAcc = 0; V.kos[p.idx]++;
    this.vsAdd(p.idx, -VS.pts.koLoss, '被击毁', p.x, p.y - 40);
    if (p.lastHitBy >= 0 && this.t - p.lastHitT < 3 && !this.players[p.lastHitBy].gone) { const k = p.lastHitBy; this.vsAdd(k, VS.pts.ko, `压制 ${p.name || ''}`, this.players[k].x, this.players[k].y - 40); }
    for (let i = 0; i < 14; i++) this.part('dot', p.x, p.y, rand(-220, 220), rand(-220, 220), 0.6, 4, 'rgba(255,122,107,0.95)');
    this.emit('down', { idx: p.idx });
  },
  vsRespawnTick(dt) {
    for (const p of this.players) {
      if (p.alive || p.gone) continue;
      p.vsRespawn -= dt; if (p.vsRespawn > 0) continue;
      p.alive = true; p.hp = p.maxHp; p.inv = VS.respawnInv; p.x = this.W * 0.22; p.y = this.vsMid(p.idx);
      this.fx(p.x, p.y, 2, 70, ['#ffffff', '#9ff2c8']); this.emit('revive', { idx: p.idx });
    }
  },
  vsStageEnd() {
    const V = this.vs, lead = this.vsRank()[0];
    V.stageLog.push(V.score.slice());
    for (const H of V.holes) if (H.st === 'open') H.st = 'closed';
    this.text(`第 ${V.stage + 1} 段结束 · ${this.players[lead].name || `${lead + 1}P`} 领先`, this.W / 2, LH * 0.3, '#ffe38a', 26, 6);
    V.stage++;
    if (V.stage >= VS.stages) { V.over = true; this.clearBullets(true); this.state = 'victory'; this.stateT = 2.4; this.victoryT = 0; Sound.sfx('win'); return; }
    this.emit('vsStage', { stage: V.stage + 1, of: VS.stages });
  },
  /* 排名：分数 → 清塔数 → 编号（只用来排序；真正的同分在结算里算平局） */
  vsRank() { const V = this.vs, S = (k) => Math.floor(V.score[k]); return this.players.map((q) => q.idx).filter((k) => !this.players[k].gone || V.score[k] > 0).sort((a, b) => S(b) - S(a) || V.towers[b] - V.towers[a] || a - b); },
  vsResult() {
    const V = this.vs, rank = this.vsRank(), me = this.me.idx, top = rank[0];
    const draw = rank.length > 1 && Math.floor(V.score[rank[1]]) === Math.floor(V.score[top]) && V.towers[rank[1]] === V.towers[top];
    return { scores: V.score.map((v) => Math.floor(v)), towers: V.towers.slice(), held: V.held.slice(), kos: V.kos.slice(), rank: rank.indexOf(me) + 1, of: rank.length, draw, winner: draw ? -1 : top, me,
      names: this.players.map((q) => q.name || `${q.idx + 1}P`), gone: this.players.map((q) => q.gone) };
  },

  /* ---------- 画 ---------- */
  drawVsUnder(g) {
    const V = this.vs, W = this.W, t = this.t;
    for (let k = 0; k < V.n; k++) {
      const L = V.lanes[k], q = this.players[k];
      g.fillStyle = hexA(q.color, q === this.me ? 0.07 : 0.035); g.fillRect(0, L.top, W, L.bot - L.top);
      g.fillStyle = hexA(q.color, 0.8); g.fillRect(0, L.top + 6, 5, L.bot - L.top - 12);
      g.font = '700 12px "Noto Sans SC", sans-serif'; g.textAlign = 'left'; g.fillStyle = hexA(q.color, 0.9); g.fillText(q === this.me ? `${q.name || '你'} · 你的航道` : q.name || `${k + 1}P`, 12, L.top + 18);
      if (k > 0) { // 航道交界
        const y = L.top, warn = !V.clash && V.t - V.stage * VS.stageT >= VS.clash[0] - VS.clashWarn && V.t - V.stage * VS.stageT < VS.clash[0];
        if (V.clash || warn) {
          g.save(); g.globalAlpha = V.clash ? 0.22 : 0.1 + 0.08 * Math.sin(t * 10); g.fillStyle = '#ff7a6b'; g.fillRect(0, y - VS.band, W, VS.band * 2); g.restore();
          g.strokeStyle = 'rgba(255,138,122,0.7)'; g.lineWidth = 2; g.setLineDash([12, 8]); g.lineDashOffset = -t * 40;
          g.beginPath(); g.moveTo(0, y - VS.band); g.lineTo(W, y - VS.band); g.moveTo(0, y + VS.band); g.lineTo(W, y + VS.band); g.stroke(); g.setLineDash([]);
          drawStepPill(g, W * 0.5, y, V.clash ? '冲突区 · 可以打对手' : `冲突区 ${Math.ceil(VS.clash[0] - (V.t - V.stage * VS.stageT))} 秒后开放`, '#ff8a7a', 0.95);
        } else { g.strokeStyle = 'rgba(223,242,255,0.28)'; g.lineWidth = 2; g.setLineDash([10, 10]); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]); }
      }
      // 侧风：预兆是虚线框，生效后是吹动的风线
      const WD = L.wind;
      if (WD) {
        g.save(); g.strokeStyle = 'rgba(159,227,240,0.8)'; g.lineWidth = 2;
        if (WD.st === 'warn') { g.setLineDash([8, 6]); g.strokeRect(4, WD.top + 4, W - 8, WD.bot - WD.top - 8); g.setLineDash([]); }
        else { for (let i = 0; i < 14; i++) { const x = ((i * 97 + t * 60) % W), y = WD.dir > 0 ? WD.top + ((i * 53 + t * 260) % (WD.bot - WD.top)) : WD.bot - ((i * 53 + t * 260) % (WD.bot - WD.top)); g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + WD.dir * 26); g.stroke(); } }
        g.restore();
        drawMapTag(g, W * 0.5, (WD.top + WD.bot) / 2, 'wing', WD.st === 'warn' ? '侧风要来了 · 换到另一半' : '侧风', '#9fe3f0', 0.9);
      }
      if (L.wave && L.wave.st === 'warn') { // 矿甲列阵：右侧预兆箭头
        const y = L.wave.y; g.save(); g.fillStyle = 'rgba(255,179,107,0.85)';
        for (let i = 0; i < 3; i++) { const x = W - 30 - i * 26 - ((t * 60) % 26); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14, y - 14); g.lineTo(x + 14, y + 14); g.closePath(); g.fill(); }
        g.restore(); drawMapTag(g, W - 170, y - 46, 'blast', '矿甲列阵来了', '#ffb36b', 0.95);
      }
    }
    // 风塔
    for (const T of V.tower) {
      if (T.st !== 'guard') continue;
      const x = T.x + 70, y = T.y;
      g.save(); g.strokeStyle = '#dff2ff'; g.fillStyle = 'rgba(40,30,100,0.9)'; g.lineWidth = 3;
      g.fillRect(x - 7, y - 10, 14, 70); g.strokeRect(x - 7, y - 10, 14, 70);
      g.translate(x, y - 14); g.rotate(t * 2);
      for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.fillStyle = i % 2 ? '#9fe3f0' : '#fff6ee'; g.beginPath(); g.ellipse(0, -18, 6, 18, 0, 0, TAU); g.fill(); }
      g.restore();
      if (this.players[T.lane] === this.me) drawStepPill(g, x, y - 52, '清掉风塔守卫 · 大分', '#ffe38a', 0.9);
    }
    // 干扰洞口
    for (const H of V.holes) {
      if (H.st !== 'open') continue;
      const I = VS_INT[H.kind], mine = this.players[H.lane] === this.me, a = clamp(1 - (H.t - VS.holeT + 2) / 2, 0.3, 1);
      g.save(); g.globalAlpha = a;
      g.fillStyle = 'rgba(20,14,50,0.9)'; g.beginPath(); g.arc(H.x, H.y, VS.holeR - 8, 0, TAU); g.fill();
      g.strokeStyle = I.color; g.lineWidth = 3; g.setLineDash([8, 6]); g.lineDashOffset = -t * 30; g.beginPath(); g.arc(H.x, H.y, VS.holeR, 0, TAU); g.stroke(); g.setLineDash([]);
      drawIcon(g, I.icon, H.x, H.y, 30, I.color);
      if (H.dwell > 0) { g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.beginPath(); g.arc(H.x, H.y, VS.holeR, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(H.dwell / VS.holeDwell, 0, 1)); g.stroke(); }
      g.restore();
      if (mine) { const to = this.vsTarget(H.lane); drawStepPill(g, H.x - 120, H.y, `${I.name} → ${to >= 0 ? this.players[to].name || `${to + 1}P` : '对手'}`, I.color, a); }
    }
  },
  /* 冲突区开放时：能打的对手套一个红圈 */
  drawVsMarks(g) {
    const V = this.vs; if (!V.clash) return;
    for (const q of this.players) {
      if (q === this.me || !q.alive || q.gone || !this.vsInBand(q.y)) continue;
      g.strokeStyle = '#ff7a6b'; g.lineWidth = 2.5; g.beginPath(); g.arc(q.x, q.y, 30, 0, TAU); g.stroke();
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; g.beginPath(); g.moveTo(q.x + Math.cos(a) * 24, q.y + Math.sin(a) * 24); g.lineTo(q.x + Math.cos(a) * 36, q.y + Math.sin(a) * 36); g.stroke(); }
    }
  },
  /* 顶部计分板：第几段 / 剩余时间 / 每人分数（领先的有皇冠）/ 现在能做什么 */
  drawVsBoard(g) {
    const V = this.vs, W = this.W, lt = V.t - V.stage * VS.stageT, left = Math.max(0, Math.ceil(VS.stageT - lt));
    const rank = this.vsRank(), cx = W / 2, y = 22;
    const items = this.players.map((q) => ({ q, txt: `${q.name || `${q.idx + 1}P`} ${Math.floor(V.score[q.idx])}` }));
    g.save(); g.font = '700 15px "Noto Sans SC", sans-serif';
    const head = V.over ? '对抗结束' : `第 ${Math.min(V.stage + 1, VS.stages)}/${VS.stages} 段 · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}${this.worldRitual() ? ' · 计时暂停' : ''}`;
    const ws = items.map((it) => g.measureText(it.txt).width + 34), hw = g.measureText(head).width + 24, total = hw + ws.reduce((a, b) => a + b, 0) + 8;
    let x = cx - total / 2;
    g.fillStyle = 'rgba(12,9,34,0.82)'; g.beginPath(); g.roundRect ? g.roundRect(x - 6, y - 16, total + 12, 32, 16) : g.rect(x - 6, y - 16, total + 12, 32); g.fill();
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = '#dff2ff'; g.fillText(head, x + 6, y + 1); x += hw;
    items.forEach((it, i) => {
      const lead = rank[0] === it.q.idx && V.score[it.q.idx] >= 1;
      g.fillStyle = it.q.color; g.beginPath(); g.arc(x + 10, y, 6, 0, TAU); g.fill();
      if (lead) drawIcon(g, 'crown', x + 10, y - 15, 14, '#ffd76a');
      g.fillStyle = it.q.gone ? 'rgba(255,255,255,0.4)' : it.q === this.me ? '#ffe38a' : '#ffffff'; g.fillText(it.txt, x + 22, y + 1); x += ws[i];
    });
    g.textBaseline = 'alphabetic'; g.restore();
    // 现在的得分机会（一句话）
    const me = this.me, T = V.tower.find((o) => o.lane === me.idx && o.stage === V.stage), H = V.holes.some((o) => o.lane === me.idx && o.st === 'open');
    const tip = V.over ? '' : !me.alive && !me.gone ? `被击毁 · ${Math.ceil(Math.max(0, me.vsRespawn))} 秒后复归` : H ? '飞进一个洞口：把干扰送给对手' : V.clash ? '冲突区开放：进带子里能打对手' : T && T.st === 'guard' ? '清掉风塔守卫：目标分' : '清怪攒分 · 风塔马上出现';
    if (tip) drawStepPill(g, cx, y + 30, tip, '#ffe38a', 0.95);
  },
});
