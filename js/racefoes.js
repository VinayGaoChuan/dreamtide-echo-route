'use strict';
/* 七族的招牌敌人（docs/design.md §9.3）：每族一个只有它有的行为，先兆看得见、有解法。收账小偷在 foes.js。
   出现规则：这张图的族才会来（MAPS[m].races）；每种第一次出现时一句话教它（只在这一局第一次）。
   规则全用这一局的随机数（srand），联机各端一样；画法在本文件下半部分。 */

const RACE_FOES = {
  drill: { kind: 'charger', name: '钻头冲锋车', teach: '看地上的橙线：离开那条线', size: 4 },
  frost: { kind: 'icewall', name: '冰墙板', teach: '挡子弹：从缝里打后面的，或集中打碎', size: 8 },
  hive: { kind: 'bees', name: '分裂工蜂', teach: '打碎分成三只小的冲向你', size: 6 },
  arc: { kind: 'pylons', name: '连线电塔', teach: '两塔之间拉电：打掉任一座就断', size: 6 },
  neon: { kind: 'balls', name: '弹跳球', teach: '箭头是下一次弹的方向，越弹越快', size: 4 },
  forge: { kind: 'mortars', name: '迫击炮台', teach: '红圈是落点：离开红圈', size: 5 },
};
const RACE_FOE_KINDS = Object.fromEntries(Object.values(RACE_FOES).map((F) => [F.kind, F]));
const RACE_OF_KIND = Object.fromEntries(Object.entries(RACE_FOES).map(([r, F]) => [F.kind, r]));
Object.assign(ENEMY_HP, { charger: 40, iceslab: 34, bee: 24, beelet: 6, pylon: 60, ball: 36, mortar: 70 });
Object.assign(ENEMY_R, { charger: 26, iceslab: 24, bee: 22, beelet: 13, pylon: 24, ball: 22, mortar: 26 });
Object.assign(FORMATION_SIZE, Object.fromEntries(Object.values(RACE_FOES).map((F) => [F.kind, F.size])));
Object.assign(ENEMY_INFO, {
  charger: { name: '钻头冲锋车', desc: '钻头转起来、地上一条橙线，然后沿线直冲过去' },
  iceslab: { name: '冰墙板', desc: '一面冰板慢慢推过来，挡子弹；缝会移动' },
  bee: { name: '分裂工蜂', desc: '打碎分成三只小的冲向你' },
  beelet: { name: '小工蜂', desc: '分裂工蜂碎出来的，直冲过来' },
  pylon: { name: '连线电塔', desc: '两座塔之间拉一道电；打掉任一座就断' },
  ball: { name: '弹跳球', desc: '撞上边缘弹回来，越弹越快；箭头是下一次的方向' },
  mortar: { name: '迫击炮台', desc: '往你的位置抛炮弹，落点先亮红圈' },
});
const SIG = { chargeWarn: 0.9, chargeV: 820, wallV: 38, wallGapK: 0.55, pylonWarn: 0.7, pylonW: 9, ballV0: 210, ballK: 1.12, ballMax: 520, mortarEvery: 2.8, mortarWarn: 1.0, mortarR: 64 };

Object.assign(World.prototype, {
  /* 这张图的族带来的招牌编队（director.formationPool 加进来） */
  raceFoeKinds() {
    if (this.mode !== 'run' || this.vs) return [];
    const M = MAPS[mapOfStage(this.stageId)] || MAPS[1];
    return M.races.map((r) => RACE_FOES[r] && RACE_FOES[r].kind).filter(Boolean);
  },
  teachRaceFoe(kind) {
    this.seenSig = this.seenSig || {}; if (this.seenSig[kind]) return; this.seenSig[kind] = true;
    const F = RACE_FOE_KINDS[kind]; if (F) this.emit('raceFoe', { kind, name: F.name, hint: F.teach, color: RACES[RACE_OF_KIND[kind]].color });
  },
  spawnRaceFoe(kind) {
    const W = this.W, top = this.arena.top + 50, bot = this.arena.bottom - 50, race = RACE_OF_KIND[kind], add = (type, o) => this.addEnemy(type, Object.assign({ race }, o));
    this.teachRaceFoe(kind);
    switch (kind) {
      case 'charger': { // 钻头冲锋车：停在右边缘蓄力，地上一条橙色虚线，然后沿线冲过整个屏幕
        const y = clamp(this.pickTarget().y + srand(-40, 40), top, bot);
        add('charger', { x: W + 30, y, path: 'charger', tx: W - 70, tough: true, fodder: false, st: 'in' });
        break;
      }
      case 'icewall': { // 冰墙板：一列冰板从右边推进来，中间空两格，空缺上下移动
        const n = 9, h = (bot - top + 60) / n, gid = this.eid;
        for (let i = 0; i < n - 2; i++) add('iceslab', { x: W + 40, y: top - 30 + (i + 0.5) * h, path: 'icewall', wall: gid, slot: i, n, slabH: h, tough: true, frostT: 0 });
        break;
      }
      case 'bees': { // 分裂工蜂：三只一组晃着飞来，打碎各分成三只小的
        const y0 = srand(top + 60, bot - 60);
        for (let i = 0; i < 3; i++) add('bee', { x: W + 30 + i * 70, y: clamp(y0 + (i - 1) * 60, top, bot), path: 'sine', vx: -120, amp: 26, freq: 2.4, phase: i });
        break;
      }
      case 'pylons': { // 连线电塔：上下各一座，先拉一道细线，0.7 秒后通电
        const x = W + 30, ya = srand(top, top + 90), yb = srand(bot - 90, bot), lid = this.eid;
        const a = add('pylon', { x, y: ya, path: 'pylon', link: lid, tx: srand(W * 0.62, W * 0.8), tough: true });
        const b = add('pylon', { x, y: yb, path: 'pylon', link: lid, tx: a.tx, tough: true });
        a.mate = b.id; b.mate = a.id; a.arcT = -SIG.pylonWarn; a.lead = true;
        break;
      }
      case 'balls': { // 弹跳球：从右上 / 右下斜着进来，撞上下边缘弹回，每弹一次更快
        const down = srnd() < 0.5;
        add('ball', { x: W + 20, y: down ? top + 10 : bot - 10, path: 'ball', vx: -SIG.ballV0 * 0.8, vy: (down ? 1 : -1) * SIG.ballV0, bounces: 0, tough: true });
        break;
      }
      case 'mortars': { // 迫击炮台：贴着下边缘慢慢滑进来，隔一阵往你的位置抛一发
        for (let i = 0; i < 2; i++) add('mortar', { x: W + 40 + i * 160, y: this.arena.bottom - 26, path: 'mortar', tx: W * (0.86 - i * 0.18), fireT: 1.6 + i * 1.2, tough: true });
        break;
      }
    }
  },
  /* 移动（foes.js moveFoe 先问这里） */
  moveRaceFoe(e, dt, p) {
    const top = this.arena.top + 30, bot = this.arena.bottom - 30;
    switch (e.path) {
      case 'charger':
        if (e.st === 'in') { e.x = smooth(e.x, e.tx, 3, dt); if (Math.abs(e.x - e.tx) < 6) { e.st = 'aim'; e.aimT = 0; this.addWarn({ kind: 'zone', x: 0, y: e.y - 22, w: e.x - 20, h: 44, tWarn: SIG.chargeWarn, silent: true, color: 'orange' }); Sound.sfx('weakOpen', { pan: this.pan(e.x) }); } }
        else if (e.st === 'aim') { e.aimT += dt; e.spin = e.aimT; if (e.aimT >= SIG.chargeWarn) { e.st = 'go'; this.shake(0.15); } }
        else { e.x -= SIG.chargeV * dt; e.spin = (e.spin || 0) + dt * 3; if (this.mine() && Math.random() < 0.5) this.part('spark', e.x + 24, e.y + rand(-12, 12), rand(60, 200), rand(-80, 80), 0.25, 3, '#ffb35c'); } // 火花只是画面：不碰这一局的随机数
        return true;
      case 'icewall': {
        e.frostT = (e.frostT || 0) + dt;
        e.x = Math.max(this.W * 0.42, e.x - SIG.wallV * dt * (e.x > this.W ? 3 : 1));
        // 缝：两个空格的位置随时间上下来回（按这面墙一起算）；冰板滑开让出那条缝
        const n = e.n, gap = (Math.sin(this.t * SIG.wallGapK + e.wall) * 0.5 + 0.5) * (n - 2), slotY = (k) => this.arena.top - 30 + (k + 0.5) * e.slabH;
        const ty = slotY(e.slot + (e.slot + 0.5 > gap ? 2 : 0));
        e.y = smooth(e.y, ty, 5, dt);
        if (e.t > 18) { e.leaving = true; e.x -= 140 * dt; }
        return true;
      }
      case 'pylon': {
        e.x = e.x > e.tx ? Math.max(e.tx, e.x - 160 * dt) : e.x - 26 * dt; e.y = e.y0 + Math.sin(e.t * 1.1 + (e.lead ? 0 : 2)) * 16;
        if (!e.lead) return true;
        const m = this.enemies.find((q) => q.id === e.mate && q.alive); if (!m) { e.arcT = null; return true; }
        if (e.arcT === null) return true;
        if (e.x < this.W - 20 && m.x < this.W - 20) e.arcT += dt; // 进了屏幕才开始预警
        if (e.arcT > 0) for (const q of this.players) { // 通电：飞机穿过这条线就受伤（有无敌时间）
          if (!q.alive || q.gone || q.away) continue;
          const rr = SIG.pylonW + (q.r || 10); if (q.inv <= 0 && segDist2(q.x, q.y, e.x, e.y, m.x, m.y) < rr * rr) this.hurtPlayer(1, 'laser', q);
        }
        if (e.t > 16) { e.leaving = true; m.leaving = true; e.x -= 200 * dt; m.x -= 200 * dt; }
        return true;
      }
      case 'ball': {
        e.x += e.vx * dt; e.y += e.vy * dt; e.rot = (e.rot || 0) + dt * 6;
        const bounce = () => { e.bounces++; const k = Math.min(SIG.ballMax / Math.hypot(e.vx, e.vy), SIG.ballK); e.vx *= k; e.vy *= k; if (this.mine()) { Sound.sfx('clink', { pan: this.pan(e.x), gap: 60 }); this.part('ring', e.x, e.y, 0, 0, 0.25, 30, 'rgba(255,111,224,0.8)'); } };
        if (e.y < top && e.vy < 0) { e.y = top; e.vy = -e.vy; bounce(); }
        if (e.y > bot && e.vy > 0) { e.y = bot; e.vy = -e.vy; bounce(); }
        if (e.x < 60 && e.vx < 0 && e.bounces < 6) { e.x = 60; e.vx = -e.vx; bounce(); } // 左边缘也弹回来一次两次：躲过一次不等于没事
        return true;
      }
      case 'mortar':
        e.x = e.x > e.tx ? Math.max(e.tx, e.x - 150 * dt) : e.x - 18 * dt; e.y = this.arena.bottom - 26;
        if (e.t > 20) { e.leaving = true; e.x -= 120 * dt; }
        return true;
    }
    return false;
  },
  /* 开火：只有迫击炮台主动开火（冲锋车、冰墙、电塔、球都靠身体） */
  fireRaceFoe(e, dt, p) {
    if (!RACE_FOE_TYPES[e.type]) return false;
    if (e.type !== 'mortar') return true;
    e.fireT -= dt; e.recoil = Math.max(0, (e.recoil || 0) - dt * 3); if (e.x > this.W - 30 || e.leaving) return true;
    if (e.fireT <= 0) {
      e.fireT = SIG.mortarEvery; const tg = this.pickTarget(), x = clamp(tg.x + srand(-30, 30), 40, this.W - 40), y = clamp(tg.y + srand(-30, 30), this.arena.top + 20, this.arena.bottom - 20);
      e.recoil = 1; this.addWarn({ kind: 'blast', x, y, r: SIG.mortarR, tWarn: SIG.mortarWarn, from: { x: e.x, y: e.y - 20 }, silent: true, onFire: (w) => {
        for (const q of this.players) if (q.alive && !q.gone && !q.away && dist2(q.x, q.y, w.x, w.y) < (w.r + 10) * (w.r + 10)) this.hurtPlayer(1, 'b:mortar', q);
        if (this.mine()) { this.fx(w.x, w.y, 2, w.r, ['#ff9a40', '#ffd27a', '#ff5a3a']); Sound.sfx('boom', { pan: this.pan(w.x), gap: 80 }); this.shake(0.12); }
      } });
    }
    return true;
  },
  /* 倒下：分裂工蜂碎成三只小的（直冲你），冰墙板碎成冰渣 */
  killRaceFoe(e) {
    if (e.type === 'bee') for (let i = 0; i < 3; i++) this.later(0.05, () => { if (this.state !== 'play') return; this.addEnemy('beelet', { x: e.x + srand(-10, 10), y: e.y + (i - 1) * 16, path: 'dive', vx: -260, fodder: true, shownT: this.t - 1 }); });
    if (e.type === 'iceslab' && this.mine()) for (let i = 0; i < 6; i++) this.part('shard', e.x, e.y, rand(-200, 200), rand(-260, 120), 0.6, rand(4, 7), '#dff6ff');
  },
});
const RACE_FOE_TYPES = { charger: 1, iceslab: 1, bee: 1, beelet: 1, pylon: 1, ball: 1, mortar: 1 };

/* ================================================== 画法（族色、胖胖的、预警清楚） ================================================== */
EnemyArt.charger = (g, e, t) => { // 钻头冲锋车：橙色矮胖车身，前面一个会转的钻头
  const P = racePal(e), spin = (e.spin || 0) * 30;
  g.save(); g.scale(1.25, 1.25); g.lineJoin = 'round';
  g.fillStyle = hullFill(g, P, 0, 0, 16); g.strokeStyle = PAL.ink; g.lineWidth = 2.2;
  g.beginPath(); g.roundRect ? g.roundRect(-6, -13, 30, 26, 9) : g.rect(-6, -13, 30, 26); g.fill(); g.stroke();
  g.fillStyle = '#9aa0b4'; g.beginPath(); g.moveTo(-6, -11); g.lineTo(-30, 0); g.lineTo(-6, 11); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = '#4c4a66'; g.lineWidth = 1.6; for (let i = 0; i < 4; i++) { const u = ((i * 6 + spin) % 24) / 24; g.beginPath(); g.moveTo(-6 - u * 24, -11 * (1 - u)); g.lineTo(-6 - u * 24 + 4, 11 * (1 - u)); g.stroke(); }
  g.fillStyle = '#2a2440'; for (const x of [2, 18]) { g.beginPath(); g.arc(x, 13, 5, 0, TAU); g.fill(); }
  visor(g, 10, -3, 16, 7, { look: -1, angry: e.st !== 'in' });
  if (e.st === 'aim' && Math.sin(t * 30) > 0) { g.globalCompositeOperation = 'lighter'; drawGlow(g, -28, 0, 18, 'rgba(255,170,80,0.9)', 0.9); g.globalCompositeOperation = 'source-over'; }
  g.restore();
};
EnemyArt.iceslab = (g, e, t) => { // 冰墙板：一块半透明的冰砖，边上一圈霜
  const r = e.r, h = (e.slabH || 50) * 0.5, crack = 1 - e.hp / e.maxHp;
  g.save(); g.fillStyle = 'rgba(190,233,255,0.55)'; g.strokeStyle = 'rgba(230,250,255,0.9)'; g.lineWidth = 2.2;
  g.beginPath(); g.roundRect ? g.roundRect(-r * 0.7, -h + 2, r * 1.4, h * 2 - 4, 6) : g.rect(-r * 0.7, -h + 2, r * 1.4, h * 2 - 4); g.fill(); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-r * 0.5, -h + 6, 4, h * 2 - 14);
  if (crack > 0.3) { g.strokeStyle = 'rgba(40,70,110,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-r * 0.5, -h * 0.4); g.lineTo(0, 0); g.lineTo(r * 0.4, h * 0.5); if (crack > 0.6) { g.moveTo(0, 0); g.lineTo(r * 0.5, -h * 0.6); } g.stroke(); }
  g.restore();
};
EnemyArt.bee = (g, e, t) => { // 分裂工蜂：圆滚滚的青绿工蜂，身上三道缝（打碎会分成三只）
  const P = racePal(e), flap = Math.sin(t * 30);
  g.lineJoin = 'round'; g.strokeStyle = PAL.ink;
  for (const s of [-1, 1]) { g.fillStyle = 'rgba(220,255,245,0.7)'; g.lineWidth = 1.6; g.beginPath(); g.ellipse(4, s * 14, 11, 5 + flap * 3, s * 0.4, 0, TAU); g.fill(); g.stroke(); }
  g.fillStyle = hullFill(g, P, 0, 0, 17); g.lineWidth = 2.4; g.beginPath(); g.ellipse(0, 0, 19, 16, 0, 0, TAU); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(20,30,40,0.6)'; g.lineWidth = 2; for (const x of [-6, 2, 10]) { g.beginPath(); g.moveTo(x, -14); g.lineTo(x - 2, 14); g.stroke(); }
  visor(g, -6, -3, 16, 7, { look: -1 });
};
EnemyArt.beelet = (g, e, t) => { g.save(); g.scale(0.55, 0.55); EnemyArt.bee(g, e, t); g.restore(); };
EnemyArt.pylon = (g, e, t) => { // 连线电塔：一根电青色的塔，顶上一颗电球
  const P = racePal(e);
  g.lineJoin = 'round'; g.strokeStyle = PAL.ink; g.lineWidth = 2;
  g.fillStyle = '#3a3f5a'; g.beginPath(); g.moveTo(-12, 22); g.lineTo(-5, -12); g.lineTo(5, -12); g.lineTo(12, 22); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = P.c; g.lineWidth = 1.4; for (const y of [0, 10]) { g.beginPath(); g.moveTo(-8, y); g.lineTo(8, y); g.stroke(); }
  g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, -18, 22, hexA(P.c, 0.9), 0.7 + Math.sin(t * 12) * 0.2); g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#e8fdff'; g.strokeStyle = PAL.ink; g.lineWidth = 2; g.beginPath(); g.arc(0, -18, 8, 0, TAU); g.fill(); g.stroke();
  visor(g, 0, 6, 12, 5, { color: P.c });
};
EnemyArt.ball = (g, e, t) => { // 弹跳球：品红条纹球 + 下一次弹的方向箭头
  const P = racePal(e), sp = Math.hypot(e.vx || 0, e.vy || 0);
  g.save(); g.rotate(e.rot || 0);
  g.fillStyle = P.c; g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 19, 0, TAU); g.fill(); g.stroke();
  g.save(); g.beginPath(); g.arc(0, 0, 18, 0, TAU); g.clip(); g.fillStyle = '#fff3fb'; for (let i = -2; i <= 2; i++) g.fillRect(i * 12 - 3, -20, 6, 40); g.restore();
  g.restore();
  visor(g, 0, -2, 18, 8, { look: Math.sign(e.vx || -1) * 2 });
  if (sp > 0) { // 箭头：沿着现在的方向，碰到边缘会翻过来
    const a = Math.atan2(e.vy, e.vx); g.save(); g.rotate(a); g.strokeStyle = `rgba(255,111,224,${0.6 + 0.3 * Math.sin(t * 12)})`; g.fillStyle = g.strokeStyle; g.lineWidth = 3;
    g.beginPath(); g.moveTo(26, 0); g.lineTo(44, 0); g.stroke(); g.beginPath(); g.moveTo(50, 0); g.lineTo(40, -6); g.lineTo(40, 6); g.closePath(); g.fill(); g.restore();
  }
};
EnemyArt.mortar = (g, e, t) => { // 迫击炮台：熔核红的矮炮台，炮管朝上
  const P = racePal(e), rc = e.recoil || 0;
  g.lineJoin = 'round'; g.strokeStyle = PAL.ink; g.lineWidth = 2.2;
  g.save(); g.translate(0, -8); g.rotate(-0.9); g.fillStyle = '#4c4a66'; g.fillRect(0, -6, 30 - rc * 6, 12); g.strokeRect(0, -6, 30 - rc * 6, 12); g.restore();
  g.fillStyle = hullFill(g, P, 0, 4, 16); g.beginPath(); g.arc(0, 6, 20, Math.PI, 0); g.lineTo(22, 20); g.lineTo(-22, 20); g.closePath(); g.fill(); g.stroke();
  visor(g, -4, 6, 18, 7, { look: -1, angry: (e.fireT || 9) < 0.8 });
};
