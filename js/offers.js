'use strict';
/* 梦潮：回声航线 v0.8 — 局内 Build 与升级仪式。
   三个槽位：主炮改造链（穿透 / 追踪 / 多重 / 爆破，兼容累积）· 自动支援（一个，换新的先展示前后）· 大招改造（一个）。
   升级仪式九步：触发（0.3s 回应）→ 变形（房子变转盘 / 核心变水晶轮 / 装置变浮空机）→ 转动（快 → 慢）→ 真实品质提升（结构 / 颜色 / 声音都变，只升不降）
   → 揭晓 → 选择（不限时、离开不取消）→ 中央展示 → 飞进真实槽位 → 验证编队。
   奖励焦点：从变形到入槽，除了奖励装置、候选、光轨、关键 UI 与音效，战场以 0.1 倍速运行、去饱和、变安静；飞机稳住并有护盾，不刷怪不攻击。
   数据在确认那一刻写入；飞入只是表现。首局第一次穿透 / 追踪是基础教学，不做稀有升级；中后期精英 / 核心 / 事件奖励有 1~2 次品质提升。 */

const RIT = {
  full: { trigger: 0.3, transform: 0.75, roll: 1.5, reveal: 0.5, show: 1.0, fly: 0.5, resume: 0.8 },
  short: { trigger: 0.2, transform: 0, roll: 0.45, reveal: 0.35, show: 0.7, fly: 0.45, resume: 0.8 },
};
const QUALITY = [{ name: '普通', color: '#e8e2ff' }, { name: '精良', color: '#7fd8ff' }, { name: '闪耀', color: '#ffd76a' }];
const GATE_R = 56;       // 候选确认圈半径
const GATE_DWELL = 0.3;  // 在圈里停多久确认
const SLOT_OF = { gun: 'gun', support: 'support', bmod: 'bmod', link: 'link', res: 'res' };
/* 两种主炮改造之间（没有联动时）的配合说明 */
const GUN_PAIR = {
  'multi|pierce': '每一路子弹都会穿透，整列敌人扫得更干净', 'multi|homing': '每一路子弹都会拐弯追敌', 'multi|bomb': '子弹多了，标记和爆炸也更多',
  'homing|pierce': '穿过第一个敌人后还会拐向下一个', 'homing|bomb': '追上去标记，四散的敌人也会连着炸',
};
const ARMOR_FIT = { multi: '对厚甲：每一路都在敲甲片，敲得更快', bomb: '对厚甲：爆炸敲甲比子弹更有效', homing: '对厚甲：它上下晃也打得中', pierce: '对厚甲编队：一发能敲一整列的甲' };

/* 每架飞机自己的 Build：World 上这些字段读写的都是 this.player（模拟里正在行动的那架；界面和渲染时是本机这架）身上的那份 */
for (const k of ['gun', 'support', 'bmod', 'links', 'ritual', 'ritualQueue', 'offerN', 'dryOffers', 'picks', 'stream', 'recentMods', 'crystals', 'rareNext', 'hudBuild']) {
  Object.defineProperty(World.prototype, k, { get() { return this.player[k]; }, set(v) { this.player[k] = v; }, configurable: true });
}

Object.assign(World.prototype, {
  initBuild() { this.focusK = 1; }, // Build 本身在 makePlayer 里，每架飞机一份
  /* 旧效果代码用的档位：支援 / 爆破 1~3 级 → 1 / 3 / 5 */
  lvOf(id) {
    if (id === 'bomb') return UPG_LEGACY[this.gun.bomb];
    if (id in this.gun) return this.gun[id];
    return this.support && this.support.id === id ? this.support.lv : 0;
  },
  ownLv(id) { return id in this.gun ? this.gun[id] : this.support && this.support.id === id ? this.support.ulv : 0; },
  hasSyn(a, b) { return this.links.has(synKey(a, b)); },

  /* ---------- 候选 ---------- */
  optGun(id, rare) { const from = this.gun[id]; if (from >= 3) return null; return { kind: 'gun', id, from, to: Math.min(3, from + (rare ? 2 : 1)) }; },
  optSupport(id, rare) {
    const cur = this.support;
    if (cur && cur.id === id) return cur.ulv >= 3 ? null : { kind: 'support', id, from: cur.ulv, to: Math.min(3, cur.ulv + (rare ? 2 : 1)) };
    return { kind: 'support', id, from: 0, to: rare ? 2 : 1, replace: cur ? { id: cur.id, lv: cur.ulv } : null };
  },
  optBmod(id) {
    const cur = this.bmod;
    if (cur && cur.id === id) return cur.lv >= 2 ? null : { kind: 'bmod', id, from: cur.lv, to: 2 };
    return { kind: 'bmod', id, from: 0, to: 1, replace: cur ? { id: cur.id, lv: cur.lv } : null };
  },
  optLink(key) { if (this.links.has(key)) return null; return SYNERGIES[key].need.every((n) => this.ownLv(n) > 0) ? { kind: 'link', id: key } : null; },
  enablesLink(o) {
    if (o.kind === 'link') return true;
    if (o.kind !== 'gun' && o.kind !== 'support') return false;
    return Object.entries(SYNERGIES).some(([k, L]) => !this.links.has(k) && L.need.includes(o.id) && L.need.every((n) => n === o.id || this.ownLv(n) > 0) && !(o.replace && L.need.includes(o.replace.id)));
  },
  optWeight(o) {
    if (o.kind === 'link') return 2.4;
    if (o.from > 0) return 1.7;
    if (o.kind === 'gun') return 1.3;
    if (o.kind === 'support') return o.replace ? 0.55 : 1.3;
    if (o.kind === 'bmod') return o.replace ? 0.35 : 0.9;
    return 0.5;
  },
  /* 公平奖励池：随机只决定“这次给哪两个好东西”，选择权在玩家 */
  makeOffer(source, rare) {
    if (this.offerN === 0) return [this.optGun('pierce'), this.optGun('homing')]; // 第一次：基础教学
    const gun = GUN_ORDER.map((id) => this.optGun(id, rare)).filter(Boolean);
    const sup = SUPPORT_ORDER.map((id) => this.optSupport(id, rare)).filter(Boolean);
    const bm = BURST_MOD_ORDER.map((id) => this.optBmod(id)).filter(Boolean);
    const lk = Object.keys(SYNERGIES).map((k) => this.optLink(k)).filter(Boolean);
    const everything = [...gun, ...sup, ...bm, ...lk];
    // 第一只厚甲怪之后：一个“集中打单体”的方案 + 一个“清一片”的方案，两者兼容
    if ((source === 'wind' || source === 'armor') && this.goal && this.goal.kind === 'armor1') {
      const focus = [this.optGun('multi', rare), this.gun.homing ? this.optGun('homing', rare) : null].filter(Boolean);
      const crowd = [this.gun.pierce ? this.optGun('pierce', rare) : null, this.optGun('bomb', rare)].filter(Boolean);
      if (focus.length && crowd.length) return [Object.assign({}, focus[0], { why: '集中火力 · 敲甲更快' }), Object.assign({}, spick(crowd), { why: '一次清一大片' })];
    }
    let pool;
    if (source === 'house') pool = gun;
    else if (source === 'npc') pool = sup;
    else if (source === 'mine') pool = [...lk, ...gun.filter((o) => o.from > 0), ...sup.filter((o) => o.from > 0), ...bm];
    else if (source === 'rare' || source === 'moon' || source === 'core') pool = [...lk, ...gun, ...sup.filter((o) => !o.replace), ...bm];
    else pool = everything;
    if (pool.length < 2) pool = everything;
    if (pool.length < 2) return [{ kind: 'res', id: 'charge' }, { kind: 'res', id: 'heal' }];
    const upgrades = pool.filter((o) => o.from > 0), fresh = pool.filter((o) => !(o.from > 0) && o.kind !== 'link');
    let a = null;
    if (this.offerN === 1 && upgrades.length && fresh.length) a = spick(upgrades);
    else if (this.offerN === 2 || rare || source === 'core' || source === 'moon') { const L = pool.filter((o) => this.enablesLink(o)); if (L.length) a = spick(L); }
    if (!a && this.dryOffers >= 2 && upgrades.length) a = spick(upgrades);
    const rest = pool.filter((o) => !a || o.id !== a.id);
    const second = this.offerN === 1 && a ? fresh.filter((o) => o.id !== a.id) : rest;
    const b = this.weightedPick(second.length ? second : rest);
    if (!a) a = this.weightedPick(rest.filter((o) => o.id !== b.id)) || spick(everything.filter((o) => o.id !== b.id));
    return [a, b];
  },
  stillValid(o) {
    if (o.kind === 'gun') return this.gun[o.id] === o.from;
    if (o.kind === 'support') return (this.support ? (this.support.id === o.id ? this.support.ulv : 0) : 0) === o.from && (o.from > 0 || (this.support ? this.support.id : null) === (o.replace ? o.replace.id : null));
    if (o.kind === 'bmod') return (this.bmod && this.bmod.id === o.id ? this.bmod.lv : 0) === o.from;
    if (o.kind === 'link') return !this.links.has(o.id);
    return true;
  },
  weightedPick(list) {
    if (!list.length) return null;
    const w = list.map((o) => this.optWeight(o)); let r = srnd() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  },
  /* 品质提升：只升不降——能升级就多升 1 级，满级了就附带一份大招能量 */
  upgradeOpt(o) {
    const c = Object.assign({}, o); c.qUp = (c.qUp || 0) + 1;
    if ((c.kind === 'gun' || c.kind === 'support') && c.to < 3) { c.to++; return c; }
    if (c.kind === 'bmod' && c.to < 2) { c.to = 2; return c; }
    c.bonus = (c.bonus || 0) + 0.35; return c;
  },
  /* 卡片信息：名字 + 等级、一句话（不写数值）、一排箭头；附带的大招能量也只是一个箭头 */
  optInfo(o) {
    const bonus = o.bonus ? [['充能', o.bonus >= 0.6 ? 2 : 1]] : [];
    if (o.kind === 'gun' || o.kind === 'support') { const S = SKILLS[o.id]; return { name: S.name, lv: o.from ? `Lv${o.from}→${o.to}` : `Lv${o.to}`, desc: S.lv[o.to - 1], fx: [...fxOf(o.kind, o.id, o.to), ...bonus], icon: S.canvas, color: S.color, tag: o.kind === 'gun' ? '主炮' : '支援', why: o.why || null, replace: o.replace ? `换掉 ${SKILLS[o.replace.id].name}` : null }; }
    if (o.kind === 'bmod') { const B = BURST_MODS[o.id]; return { name: B.name, lv: o.from ? 'Lv1→2' : `Lv${o.to}`, desc: B.lv[o.to - 1], fx: [...fxOf('bmod', o.id, o.to), ...bonus], icon: 'charge', color: B.color, tag: '大招', replace: o.replace ? `换掉 ${BURST_MODS[o.replace.id].name}` : null }; }
    if (o.kind === 'link') { const L = SYNERGIES[o.id]; return { name: L.name, lv: '联动', desc: L.desc, fx: [...fxOf('link', o.id), ...bonus], icon: 'star', color: '#ffd76a', tag: '联动', replace: null }; }
    return o.id === 'charge' ? { name: '大招能量', lv: '', desc: '大招马上充一截', fx: [['充能', 2]], icon: 'charge', color: '#ffd76a', tag: '资源' } : { name: '恢复', lv: '', desc: '回一颗心', fx: [['生命', 1]], icon: 'heart', color: '#6fe39a', tag: '资源' };
  },

  /* ---------- 仪式流程 ---------- */
  /* 升级来源（装置 / 精英核心 / 惊喜）：单人给自己；多人时每架飞机各来一次、各选各的（o.who 指定时只给那一位）。
     同一个装置的收尾回调（onRitual）只在第一位选完时调用一次。 */
  queueRitual(src, o = {}) {
    if (this.mode !== 'run') return;
    const tok = { done: false }, who = o.who !== undefined ? [this.players[o.who]] : this.np > 1 ? this.players.filter((q) => !q.gone) : [this.player];
    for (const q of who) if (q) q.ritualQueue.push({ src, full: !!o.full, q: o.q || 0, x: o.x, y: o.y, device: o.device || 'machine', opts: q === this.player ? o.opts : null, rare: !!o.rare, by: q.idx, obj: o.obj || null, tok, promise: o.promise || null });
  },
  queueOffer(src, o = {}) { this.queueRitual(src, o); }, // 兼容旧调用
  canRitual() { return this.mode === 'run' && this.state === 'play' && !this.bursting && !(this.surprise && this.surprise.busy) && this.phase === 'fight' && this.player.alive; },
  ritualFocus() { const R = this.worldRitual(); return !!(R && R.st !== 'resume'); }, // 全场慢放：只有单人
  myRitualFocus() { const R = this.me.ritual; return !!(R && R.st !== 'resume'); },
  startRitual(q) {
    const p = this.player, top = this.arena.top + 70, bot = this.arena.bottom - 70, mine = this.mine(); // 选的人就是候选卡摆放的参照
    if (this.rareNext) { this.rareNext = false; q.rare = true; }
    let opts = q.opts && q.opts.every((o) => o && this.stillValid(o)) ? q.opts : this.makeOffer(q.src, q.rare);
    opts = opts.map((o) => Object.assign({}, o));
    const T = q.full ? RIT.full : RIT.short;
    const first = this.offerN === 0;
    const x = q.x !== undefined ? clamp(q.x, 120, this.W - 120) : clamp(p.x + 320, this.W * 0.45, this.W * 0.74), y = q.y !== undefined ? clamp(q.y, top, bot) : clamp(p.y - 40, top, bot);
    const qPlan = q.full && !first ? clamp(q.q, 0, 2) : 0;
    this.ritual = { q, T, opts, st: 'trigger', t: 0, total: 0, x, y, rot: 0, spin: q.full ? 20 : 12, qNow: 0, qPlan, qAt: qPlan === 2 ? [0.35, 0.78] : qPlan === 1 ? [0.62] : [], gates: null, pick: -1, chooseT: 0, first, px: p.x, py: p.y, flyT: 0 };
    this.offerN++; p.res.offers++;
    const hasUp = opts.some((o) => o && o.from > 0);
    this.dryOffers = hasUp || this.offerN < 3 ? 0 : this.dryOffers + 1;
    // 危险隔离：敌弹化成星点、贴脸的敌人推开（多人时全队同一轮一起开始，战场一起进入安全减速）
    this.clearBullets(true); for (const e of this.enemies) if (e.alive && !e.isBoss && dist2(e.x, e.y, p.x, p.y) < 150 * 150) e.x = Math.max(e.x, p.x + 170);
    p.rx = p.x; p.ry = p.y;
    this.ritual.who = p.idx;
    if (mine) { Sound.sfx('ritualTrigger', { ui: true }); Sound.focus(true); this.rumble(0.2, 0.4, 60); this.emit('ritual', { src: q.src, first, full: q.full }); }
  },
  updateRitual(dt) {
    if (this.mode !== 'run') return;
    const R = this.ritual, p = this.player;
    if (!R) { if (this.ritualQueue.length && this.canRitual()) this.startRitual(this.ritualQueue.shift()); return; }
    R.t += dt; R.total += dt;
    const T = R.T;
    R.rot += R.spin * dt;
    switch (R.st) {
      case 'trigger': if (R.t >= T.trigger) this.ritStep(T.transform > 0 ? 'transform' : 'roll'); break;
      case 'transform': if (R.t >= T.transform) this.ritStep('roll'); break;
      case 'roll': {
        const u = clamp(R.t / T.roll, 0, 1);
        R.spin = lerp(R.q.full ? 20 : 12, 0.6, Ease.outCubic(u)); // 快 → 慢
        if (R.qAt.length && u >= R.qAt[0]) { R.qAt.shift(); this.qualityUp(R); }
        R.tick = (R.tick || 0) - dt * R.spin; if (R.tick <= 0) { R.tick = 3; Sound.sfx('rollTick', { ui: true, k: u, gap: 20 }); }
        if (R.t >= T.roll) this.ritStep('reveal');
        break;
      }
      case 'reveal': for (const G of R.gates) { G.x = lerp(G.x, G.tx, 1 - Math.pow(0.0005, dt / T.reveal)); G.y = lerp(G.y, G.ty, 1 - Math.pow(0.0005, dt / T.reveal)); G.alpha = Math.min(1, G.alpha + dt * 4); } if (R.t >= T.reveal) this.ritStep('choose'); break;
      case 'choose': {
        R.chooseT += dt;
        // 只有这场仪式的主人能选：飞进圆圈停住
        R.gates.forEach((G, i) => {
          if (R.st !== 'choose') return;
          const d = Math.sqrt(dist2(p.x, p.y, G.x, G.y)), inside = p.alive && d < GATE_R + (p.planeId === 'paper' ? 14 : 0);
          G.near = approach(G.near, d < 170 ? 1 : 0, dt * 5);
          if (inside) { G.dwell += dt; if (G.dwell >= GATE_DWELL) this.chooseRitual(i, p); }
          else G.dwell = Math.max(0, G.dwell - dt * 2);
        });
        break;
      }
      case 'show': {
        const G = R.gates[R.pick], u = clamp(R.t / 0.25, 0, 1);
        G.x = lerp(G.x, this.W / 2, u); G.y = lerp(G.y, LH * 0.42, u);
        R.gates.forEach((g2, i) => { if (i !== R.pick) { g2.alpha = Math.max(0, g2.alpha - dt * 4); g2.x = lerp(g2.x, R.x, dt * 4); g2.y = lerp(g2.y, R.y, dt * 4); } });
        if (R.t >= T.show) { this.ritStep('fly'); R.from = { x: this.W / 2, y: LH * 0.42 }; R.to = this.slotTarget(R.gates[R.pick].opt); if (this.mine()) Sound.sfx('flyIn', { ui: true }); }
        break;
      }
      case 'fly': {
        const u = clamp(R.t / T.fly, 0, 1), k = Ease.inOutCubic ? Ease.inOutCubic(u) : u, a = R.from, b = R.to, cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - 120;
        R.fx = (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * cx + k * k * b.x; R.fy = (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * cy + k * k * b.y;
        if (this.mine() && Math.random() < 0.9) this.part('mote', R.fx, R.fy, rand(-40, 40), rand(-40, 40), 0.35, 3.5, R.gates[R.pick].info.color);
        if (u >= 1) this.landRitual(R);
        break;
      }
      case 'wait': break; // 联机：自己选好了，等在线的队友都选好（teamRitualSync 一起恢复）
      case 'resume':
        if (R.t >= T.resume) {
          this.ritual = null;
          const first = !R.q.tok || !R.q.tok.done; if (R.q.tok) R.q.tok.done = true; // 多人：同一个装置各选各的，装置只收尾一次
          if (first) { this.onRitualDone(R.q.src, R.picked); if (R.q.obj && R.q.obj.onRitual) R.q.obj.onRitual(R.picked); }
        }
        break;
    }
    // 焦点期间飞机稳住（选择阶段除外）：只稳住选的这一架
    if (R.st !== 'choose' && R.st !== 'resume' && this.ritual && p.alive) { if (p.rx === undefined) { p.rx = p.x; p.ry = p.y; } p.x = smooth(p.x, p.rx, 6, dt); p.y = smooth(p.y, p.ry, 6, dt); }
  },
  ritStep(st) {
    const R = this.ritual, p = this.player, mine = this.mine();
    R.st = st; R.t = 0;
    if (st === 'transform' && mine) Sound.sfx('transform', { ui: true });
    if (st === 'roll' && mine) Sound.sfx('spin', { ui: true });
    if (st === 'reveal') {
      // 两个安全候选区：在飞机前方（飞机太靠右时放到它左边），上下各一个，离飞机至少 150
      const top = this.arena.top + 96, bot = this.arena.bottom - 100, mid = (top + bot) / 2, left = p.x > this.W * 0.55, side = left ? -1 : 1;
      const gx = left ? clamp(p.x - 250, 350, this.W * 0.7) : clamp(p.x + 250, this.W * 0.3, this.W - 350); // 确认圈朝着飞机，卡片在圈的另一边
      R.gates = R.opts.map((opt, i) => { const info = Object.assign(this.optInfo(opt), this.fitNote(opt)); return { opt, info, side, x: R.x, y: R.y, tx: gx, ty: clamp(mid + (i ? 135 : -135), top, bot), near: 0, dwell: 0, alpha: 0 }; });
      R.spin = 0.4; if (mine) Sound.sfx('reveal', { r: R.qNow >= 2 ? 'SR' : R.qNow ? 'R' : 'N', ui: true });
    }
    if (st === 'choose') { p.rx = p.x; p.ry = p.y; }
    if (st === 'resume') { p.inv = Math.max(p.inv, 0.8); if (mine) Sound.focus(false); }
  },
  qualityUp(R) {
    R.qNow++; R.opts = R.opts.map((o) => this.upgradeOpt(o));
    if (!this.mine()) return; // 别人的升级仪式不在本机上演
    Sound.sfx('qualityUp', { ui: true, k: R.qNow });
    const C = QUALITY[R.qNow].color;
    this.part('ring', R.x, R.y, 0, 0, 0.5, 120 + R.qNow * 30, C); this.part('flash', R.x, R.y, 0, 0, 0.25, 110, C);
    for (let i = 0; i < 18; i++) this.part('spark', R.x, R.y, rand(-420, 420), rand(-420, 420), 0.5, 3, C);
    this.text(`品质提升 · ${QUALITY[R.qNow].name}`, R.x, R.y - 110, C, 22, 6);
    this.rumble(0.3, 0.5, 70);
  },
  chooseRitual(i, who) {
    const R = this.ritual, G = R.gates[i], p = this.player; R.by = p.idx;
    R.pick = i; R.picked = G.opt; p.lastPick = { icon: G.info.icon, color: G.info.color };
    p.res.choiceTimes.push(R.chooseT);
    if (this.m.firstSkill === null) this.m.firstSkill = this.runT;
    const pre = this.buildSummary();
    this.applyOption(G.opt); // 数据在确认时写入
    R.word = G.opt.kind === 'link' ? '组合完成' : G.opt.from > 0 ? '升级' : '获得';
    R.prevBuild = pre;
    if (this.mine()) { Sound.sfx(G.opt.kind === 'link' ? 'synergy' : 'crystal', { ui: true }); this.rumble(0.35, 0.3, 80); }
    this.ritStep('show');
  },
  landRitual(R) {
    const G = R.gates[R.pick];
    this.hudBuild = this.buildSummary();
    if (this.mine()) {
      this.emit('slotLand', { slot: SLOT_OF[G.opt.kind] || 'gun', kind: G.opt.kind, id: G.opt.id, lv: G.info.lv, name: G.info.name, desc: G.info.desc, color: G.info.color, tag: G.info.tag, replace: G.opt.replace || null, word: R.word, first: this.picks.length === 1 });
      Sound.sfx('slotLand', { ui: true });
    }
    // 联机：还有在线队友没选完，就先停在“等队友”（世界继续安全减速），都选好了一起恢复
    const waiting = this.mp && this.players.some((q) => q !== this.player && !q.gone && q.ritual && q.ritual.st !== 'wait' && q.ritual.st !== 'resume');
    this.ritStep(waiting ? 'wait' : 'resume');
  },
  /* 大招键 = 选推荐（不会自动替玩家选）：能凑联动 > 升级已有的 > 第一个；单人时“目标流派”优先（联机不用本机的目标，保证各端一致） */
  recIndex(R) {
    const sc = (G) => (!this.mp && G.info.target ? 4 : 0) + (G.info.link ? 2 : 0) + (G.opt.from > 0 ? 1 : 0);
    let best = 0; R.gates.forEach((G, i) => { if (sc(G) > sc(R.gates[best])) best = i; }); return best;
  },
  chooseRecommended() { const R = this.ritual; if (R && R.st === 'choose' && R.gates && this.player.alive) this.chooseRitual(this.recIndex(R), this.player); },
  slotTarget(o) {
    const k = SLOT_OF[o.kind] || 'gun', pos = this.slotPos ? this.slotPos(k) : null;
    return pos || { gun: { x: 64, y: 150 }, support: { x: 120, y: 150 }, bmod: { x: 176, y: 150 }, link: { x: 100, y: 196 }, res: { x: this.W - 90, y: LH - 90 } }[k];
  },
  applyOption(o) {
    const p = this.player, info = this.optInfo(o), mine = this.mine();
    switch (o.kind) {
      case 'gun': this.gun[o.id] = o.to; if (o.to >= 3) p.res.lv5++; this.recentMods = [o.id, ...this.recentMods.filter((x) => x !== o.id)].slice(0, 3); break;
      case 'support':
        this.support = { id: o.id, ulv: o.to, lv: UPG_LEGACY[o.to], t: 0.4, t2: 3 };
        if (o.to >= 3) p.res.lv5++;
        if (o.replace && o.replace.id === 'thunder') this.storm = null;
        break;
      case 'bmod': this.bmod = { id: o.id, lv: o.to }; break;
      case 'link': this.links.add(o.id); p.res.syns++; if (this.m.firstSyn === null) this.m.firstSyn = this.runT; this.highlight(); if (mine) { this.remember(`完成了「${SYNERGIES[o.id].name}」`, 4); if (this.cb.onSynergy) this.cb.onSynergy(o.id); } break;
      case 'res': if (o.id === 'charge') this.addCharge(0.5, true); else if (p.hp < p.maxHp) p.hp++; break;
    }
    if (o.bonus) this.addCharge(o.bonus, true);
    p.skills = this.support ? [Object.assign({}, this.support, { t: 0.4, t2: 3 })] : []; // 自己的支援技能和冷却
    this.picks.push(o); this.crystals = this.picks.length; p.res.crystals++;
    if (mine && (o.kind === 'gun' || o.kind === 'support') && this.cb.onSkill) this.cb.onSkill(o.id);
    this.syncWingmen();
    this.updateStream();
    if (!mine) { this.onCompanionSkill(); if (!this.ritual) this.hudBuild = this.buildSummary(); return; } // 队友的升级：数据照常，表现只在他自己那边
    Sound.setCardMods([this.support ? { thunder: 'echo', wing: 'mirror', magnet: 'gentle', ice: 'tide', rainbow: 'paperboat' }[this.support.id] : null, this.gun.bomb ? 'overheat' : null].filter(Boolean));
    this.emit('pick', { kind: o.kind, id: o.id, name: info.name, lv: info.lv, desc: info.desc, color: info.color, tag: info.tag, first: this.picks.length === 1 });
    this.onCompanionSkill();
    if (!this.ritual) this.hudBuild = this.buildSummary();
    if (this.hintStep >= 0 && this.hintStep < 2) this.hintStep = 2;
  },
  buildName() {
    const lk = [...this.links].pop();
    if (lk) return SYNERGIES[lk].stream;
    const guns = GUN_ORDER.filter((id) => this.gun[id] > 0).sort((a, b) => this.gun[b] - this.gun[a]);
    if (!guns.length && !this.support) return null;
    const a = guns[0] ? SKILLS[guns[0]].stream : '', b = this.support ? SKILLS[this.support.id].stream : guns[1] ? SKILLS[guns[1]].stream : '';
    return `${a}${b}流`;
  },
  topId() { const guns = GUN_ORDER.filter((id) => this.gun[id] > 0).sort((a, b) => this.gun[b] - this.gun[a]); return guns[0] || (this.support ? this.support.id : null); },
  updateStream() {
    const name = this.buildName();
    if (!name) return;
    if (!this.stream && this.picks.length >= 4) {
      this.stream = { id: this.topId(), name };
      this.highlight(); if (this.mine()) { this.emit('stream', { id: this.stream.id, name }); Sound.sfx('stream', { ui: true }); }
    } else if (this.stream) this.stream = { id: this.topId(), name };
  },
  buildSummary() {
    return { gun: Object.assign({}, this.gun), support: this.support ? { id: this.support.id, lv: this.support.ulv } : null, bmod: this.bmod ? Object.assign({}, this.bmod) : null, links: [...this.links], recent: (this.recentMods || []).slice() };
  },

  /* ---------- 画：装置 / 候选 / 中央展示 / 飞入 ---------- */
  drawRitual(g) {
    const R = this.ritual; if (!R) return;
    const t = this.t, T = R.T, p = this.player, qc = QUALITY[R.qNow].color;
    // 奖励装置
    if (R.st !== 'resume' && R.st !== 'fly' && !(R.st === 'show' && R.t > 0.3)) {
      const tu = R.st === 'trigger' ? 0 : R.st === 'transform' ? clamp(R.t / T.transform, 0, 1) : 1;
      if (R.q.device === 'wheel' && tu < 1 && R.q.obj) { // 房子折起来：屋顶收拢、烟囱变摇柄
        g.save(); g.globalAlpha = 1 - tu; g.translate(R.q.obj.x, R.q.obj.y); g.scale(1 - tu * 0.4, 1 - tu * 0.6); drawLampHouse(g, 0, 0, { lit: 1, done: true, open: 1 }, t); g.restore();
      }
      const s = R.q.device === 'wheel' ? 0.4 + 0.6 * tu : 1;
      g.save(); g.translate(R.x, R.y); g.scale(s, s);
      for (let k = 0; k <= R.qNow; k++) { g.strokeStyle = hexA(QUALITY[k].color, 0.85); g.lineWidth = 3 + k; g.setLineDash(k ? [4, 6] : []); g.lineDashOffset = -t * 40 * (k + 1); g.beginPath(); g.arc(0, 0, 74 + k * 13, 0, TAU); g.stroke(); }
      g.setLineDash([]);
      glowAt(g, 0, 0, 120, hexA(qc, 0.7), 0.35 + R.qNow * 0.15);
      if (R.q.device === 'wheel') drawHouseWheel(g, 0, 0, 60, R.rot, t, tu, R.st === 'reveal' || R.st === 'choose' ? R.opts.map((o) => o.id) : null);
      else if (R.q.device === 'crystal') drawCrystalWheel(g, R.rot, qc, t);
      else drawFloatMachine(g, R.rot, qc, t);
      g.restore();
      if (R.st === 'roll' || R.st === 'transform') drawStepPill(g, R.x, R.y - 108, R.qNow ? `品质 · ${QUALITY[R.qNow].name}` : R.first ? '第一次升级' : '转动中…', qc, 1);
    }
    // 候选
    if (R.gates) R.gates.forEach((G, i) => {
      if (G.alpha <= 0.01) return;
      if (R.st === 'fly' || R.st === 'resume' || R.st === 'wait') return;
      if (R.st === 'show' && i === R.pick) return;
      this.drawGate(g, G, R, i);
    });
    if (R.st === 'choose' && p.alive) {
      if (R.first) R.gates.forEach((G, i) => { if (G.near < 0.5) drawPointer(g, p.x, p.y, G.x, G.y, G.info.color, t + i); });
      g.save(); g.globalAlpha = 0.6 + Math.sin(t * 6) * 0.15; g.strokeStyle = '#dff2ff'; g.lineWidth = 2.5; g.setLineDash([5, 6]); g.beginPath(); g.arc(p.x, p.y, 38, 0, TAU); g.stroke(); g.setLineDash([]); g.restore();
      const late = this.mp && R.chooseT > 30 && this.players.some((q) => q !== p && !q.gone && q.ritual && q.ritual.st === 'wait');
      if (!R.first || late) drawStepPill(g, this.W / 2, this.arena.bottom - 18, late ? '队友都选好了 · 飞进一个圆圈，或按大招选推荐' : '飞进一个方案的圆圈 · 大招键选推荐 · 不会受伤', late ? '#ffe38a' : '#dff2ff', 1); // 固定在底部，不跟着飞机压住卡片
    } else if (R.st !== 'resume' && p.alive) { // 稳住期间：清楚的护盾
      g.save(); g.strokeStyle = 'rgba(223,242,255,0.85)'; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, 36, 0, TAU); g.stroke(); glowAt(g, p.x, p.y, 60, 'rgba(200,235,255,0.6)', 0.4); g.restore();
    } else if (R.st === 'resume' && p.alive) { const a = 1 - R.t / T.resume; g.save(); g.globalAlpha = a; g.strokeStyle = '#dff2ff'; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, 36 + (1 - a) * 20, 0, TAU); g.stroke(); g.restore(); }
    if (R.st === 'wait') { const who = this.players.filter((q) => q !== p && !q.gone && q.ritual && q.ritual.st !== 'wait' && q.ritual.st !== 'resume').map((q) => q.name || `${q.idx + 1}P`); drawStepPill(g, this.W / 2, this.arena.bottom - 18, `✓ 选好了 · 等 ${who.join('、') || '队友'}`, '#9ff2c8', 1); }
    if (R.st === 'show') this.drawCentral(g, R);
    if (R.st === 'fly') { const G = R.gates[R.pick]; glowAt(g, R.fx, R.fy, 46, hexA(G.info.color, 0.9), 0.9); drawIcon(g, G.info.icon, R.fx, R.fy, 40, G.info.color); }
  },
  /* 候选卡：确认圈在卡片外侧（朝飞机那一边），圈里只放图标；卡片按 标签 / 名称 / 效果 / 和当前 Build 的关系 分行 */
  drawGate(g, G, R, i) {
    const I = G.info, t = this.t, qc = QUALITY[R.qNow].color, side = G.side || 1, s = 1 + G.near * 0.06;
    const note = I.replace || I.link || '', w = 250, h = 128 + (note ? 22 : 0), cx = G.x + side * (GATE_R + 12 + w / 2), cy = G.y;
    g.save(); g.globalAlpha = G.alpha;
    glowAt(g, G.x, G.y, 110, hexA(I.color, 0.7), 0.3 + G.near * 0.3);
    // 卡片
    g.save(); g.translate(cx, cy); g.scale(s, s);
    g.fillStyle = 'rgba(24,19,64,0.97)'; g.strokeStyle = R.qNow ? qc : I.color; g.lineWidth = 3 + R.qNow;
    g.beginPath(); g.roundRect ? g.roundRect(-w / 2, -h / 2, w, h, 16) : g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke();
    // 第一行：标签 + 品质 / 目标流派；第二行：图标 + 名字 + 等级；第三行：一句话；第四行：箭头；最后（有的话）：替换 / 能凑联动
    const L = -w / 2 + 14; g.textAlign = 'left';
    g.font = '700 12px "Noto Sans SC", sans-serif'; g.fillStyle = I.color; g.fillText(I.tag, L, -h / 2 + 22);
    const chip = I.target ? '★ 目标流派' : R.qNow ? QUALITY[R.qNow].name : '';
    if (chip) { g.textAlign = 'right'; g.fillStyle = I.target ? '#ffe38a' : qc; g.fillText(chip, w / 2 - 12, -h / 2 + 22); g.textAlign = 'left'; }
    drawIcon(g, I.icon, L + 12, -h / 2 + 44, 24, I.color);
    g.font = mapFont(21); g.fillStyle = '#fff6ee'; g.fillText(I.name, L + 30, -h / 2 + 52);
    const nw = g.measureText(I.name).width; g.font = '700 14px "Noto Sans SC", sans-serif'; g.fillStyle = '#ffe38a'; g.fillText(I.lv, L + 38 + nw, -h / 2 + 51);
    g.font = '500 14px "Noto Sans SC", sans-serif'; if (g.measureText(I.desc).width > w - 28) g.font = '500 12px "Noto Sans SC", sans-serif';
    g.fillStyle = 'rgba(236,230,255,0.95)'; g.fillText(I.desc, L, -h / 2 + 80);
    drawFx(g, I.fx, L, -h / 2 + 106, 14);
    if (note) { g.font = '700 12px "Noto Sans SC", sans-serif'; g.fillStyle = I.replace ? '#ffb2a8' : '#ffd76a'; g.fillText(note, L, -h / 2 + 132); }
    g.restore();
    // 确认圈（卡片外）
    g.save(); g.translate(G.x, G.y); g.scale(s, s);
    g.fillStyle = 'rgba(40,30,100,0.95)'; g.beginPath(); g.arc(0, 0, GATE_R - 14, 0, TAU); g.fill();
    g.strokeStyle = I.color; g.lineWidth = 3; g.setLineDash([8, 7]); g.lineDashOffset = -t * 30; g.beginPath(); g.arc(0, 0, GATE_R - 4, 0, TAU); g.stroke(); g.setLineDash([]);
    drawIcon(g, I.icon, 0, 0, 40, I.color);
    if (G.dwell > 0) { g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.arc(0, 0, GATE_R - 4, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(G.dwell / GATE_DWELL, 0, 1)); g.stroke(); }
    if (R.st === 'choose') { g.textAlign = 'center'; g.font = '700 12px "Noto Sans SC", sans-serif'; g.fillStyle = G.dwell > 0 ? '#ffffff' : 'rgba(255,255,255,0.7)'; g.fillText(G.dwell > 0 ? `确认中 ${Math.round((G.dwell / GATE_DWELL) * 100)}%` : i === this.recIndex(R) ? '飞进圆圈 · 或按大招' : '飞进圆圈', 0, GATE_R + 16); }
    g.restore();
    g.restore();
  },
  /* 这张卡和当前 Build 的关系，只用一个标记表达：★ 目标流派 / 能和已有的谁凑联动 / 对付厚甲的箭头 */
  fitNote(o) {
    const b = this.buildSummary(), P = buildPlan(b, this.targetName), own = (id) => buildOwned(b, id);
    const hasAim = !!this.targetName || P.have.length > 0; // 第一次选择前还没有方向，不硬塞一个“目标流派”
    const target = hasAim && (o.kind === 'link' ? o.id === P.link : P.comps.includes(o.id) && !own(o.id)) ? P.name : null;
    let link = '';
    if (o.kind === 'gun' || o.kind === 'support') {
      const others = [...GUN_ORDER.filter((id) => id !== o.id && own(id)), ...(this.support && this.support.id !== o.id && !(o.replace && o.replace.id === this.support.id) ? [this.support.id] : [])];
      for (const x of others) { const k = synKey(o.id, x); if (SYNERGIES[k] && !this.links.has(k)) { link = `★ 能和${SKILLS[x].name}凑联动`; break; } }
    }
    const armor = (o.kind === 'gun') && this.goal && (this.goal.kind === 'armor1' || this.goal.kind === 'pack') && ARMOR_FIT[o.id] ? [['敲甲', o.id === 'bomb' || o.id === 'multi' ? 2 : 1]] : [];
    const I = this.optInfo(o);
    return { target, link, fx: [...(I.fx || []), ...armor].slice(0, 3) };
  },
  /* 中央展示：大图标 + 名字 + 等级变化 + 一小段演示；0.8~1.2 秒 */
  drawCentral(g, R) {
    const G = R.gates[R.pick], I = G.info, o = G.opt, t = this.t, cx = this.W / 2, cy = LH * 0.42;
    const u = clamp(R.t / 0.25, 0, 1), s = Ease.outBack ? Ease.outBack(u) : u;
    g.save(); g.translate(cx, cy); g.scale(s, s);
    glowAt(g, 0, 0, 260, hexA(I.color, 0.6), 0.5);
    const w = 460, h = 200;
    g.fillStyle = 'rgba(20,15,56,0.96)'; g.strokeStyle = I.color; g.lineWidth = 4;
    g.beginPath(); g.roundRect ? g.roundRect(-w / 2, -h / 2, w, h, 24) : g.rect(-w / 2, -h / 2, w, h); g.fill(); g.stroke();
    g.fillStyle = 'rgba(40,30,100,0.95)'; g.beginPath(); g.arc(-w / 2 + 78, -10, 54, 0, TAU); g.fill();
    drawIcon(g, I.icon, -w / 2 + 78, -10, 64, I.color);
    g.textAlign = 'left';
    g.font = '700 16px "Noto Sans SC", sans-serif'; g.fillStyle = I.color; g.fillText(`${R.word} · ${I.tag}`, -w / 2 + 150, -h / 2 + 40);
    g.font = mapFont(34); g.fillStyle = '#fff6ee'; g.fillText(I.name, -w / 2 + 150, -h / 2 + 80);
    g.font = mapFont(22); g.fillStyle = '#ffe38a'; g.fillText(I.lv, -w / 2 + 150, -h / 2 + 112);
    g.font = '500 15px "Noto Sans SC", sans-serif'; g.fillStyle = 'rgba(236,230,255,0.96)'; g.fillText(I.desc, -w / 2 + 150, -h / 2 + 142);
    drawFx(g, I.fx, -w / 2 + 150, -h / 2 + 170, 15);
    drawDemo(g, o, R.t, w / 2 - 120, -h / 2 + 22, 100, 64, I.color);
    g.restore();
  },
});
/* 箭头行（画布版）：词 + 绿色 ▲ / 红色 ▼，箭头画成小三角，越多变化越大 */
function drawFx(g, fx, x, y, size = 14) {
  if (!fx || !fx.length) return x;
  g.save(); g.textAlign = 'left'; g.font = `700 ${size}px "Noto Sans SC", sans-serif`;
  const a = size * 0.36;
  for (const [w, n] of fx) {
    g.fillStyle = 'rgba(236,230,255,0.92)'; g.fillText(w, x, y); x += g.measureText(w).width + 4;
    const up = n > 0, k = clamp(Math.abs(Math.round(n)), 1, 3); g.fillStyle = up ? FX_UP : FX_DOWN;
    for (let i = 0; i < k; i++) { const cx = x + a, cy = y - size * 0.36; g.beginPath(); if (up) { g.moveTo(cx, cy - a); g.lineTo(cx + a, cy + a * 0.8); g.lineTo(cx - a, cy + a * 0.8); } else { g.moveTo(cx, cy + a); g.lineTo(cx + a, cy - a * 0.8); g.lineTo(cx - a, cy - a * 0.8); } g.closePath(); g.fill(); x += a * 2 + 2; }
    x += 12;
  }
  g.restore(); return x;
}
/* 中文按字数折行 */
function wrapText(str, n) { const out = []; for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n)); return out; }

/* 水晶转盘（精英核心 / 月光碎片变成的奖励装置） */
function drawCrystalWheel(g, rot, qc, t) {
  g.save(); g.rotate(rot);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    g.save(); g.rotate(a); g.fillStyle = i % 2 ? '#fff3c8' : hexA(qc, 0.9); g.strokeStyle = PAL.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -18); g.lineTo(14, -56); g.lineTo(0, -66); g.lineTo(-14, -56); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  g.restore();
  g.fillStyle = '#fff6c8'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 20, 0, TAU); g.fill(); g.stroke();
  glowAt(g, 0, 0, 40, GLOW.gold, 0.6 + Math.sin(t * 9) * 0.2);
}
/* 浮空小机器（风车 / 矿脉动力装置 / 伙伴修理台变成的奖励装置） */
function drawFloatMachine(g, rot, qc, t) {
  g.save(); g.rotate(rot);
  g.fillStyle = '#4b3d9c'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.beginPath(); g.moveTo(Math.cos(a) * 44, Math.sin(a) * 44); g.lineTo(Math.cos(a + 0.2) * 58, Math.sin(a + 0.2) * 58); g.lineTo(Math.cos(a + 0.4) * 44, Math.sin(a + 0.4) * 44); g.fill(); g.stroke(); }
  g.beginPath(); g.arc(0, 0, 46, 0, TAU); g.fill(); g.stroke();
  g.restore();
  g.fillStyle = hexA(qc, 0.95); g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(-7, -7, 6, 0, TAU); g.fill();
}
/* 中央展示里的一小段演示循环：只演示能力本身，不消耗库存 */
function drawDemo(g, o, tt, x, y, w, h, color) {
  const t = tt % 1.2, u = t / 1.2;
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(10,8,34,0.8)'; g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5; g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, h, 10) : g.rect(0, 0, w, h); g.fill(); g.stroke();
  const dots = [[60, h / 2], [74, h / 2], [88, h / 2]], dot = (dx, dy, hit) => { g.fillStyle = hit ? '#ffffff' : '#9fe3f0'; g.beginPath(); g.arc(dx, dy, 5, 0, TAU); g.fill(); };
  const id = o.kind === 'link' ? SYNERGIES[o.id].need[0] : o.id, bx = 8 + u * (w - 10);
  g.fillStyle = color;
  if (id === 'pierce') { dots.forEach(([dx, dy]) => dot(dx, dy, bx > dx)); g.fillRect(bx - 8, h / 2 - 2, 12, 4); }
  else if (id === 'homing') { dot(84, 14, u > 0.9); const k = u; g.beginPath(); g.arc(8 + k * 76, h / 2 - Math.sin(k * Math.PI / 2) * (h / 2 - 14), 4, 0, TAU); g.fill(); }
  else if (id === 'multi') { const n = 1 + (o.to || 1); for (let i = 0; i < n; i++) g.fillRect(bx - 8, h / 2 + (i - (n - 1) / 2) * 10 - 2, 12, 4); }
  else if (id === 'bomb') { dots.forEach(([dx, dy]) => dot(dx, dy - 10 + (dx - 74) * 0.6, u > 0.6)); if (u < 0.6) g.fillRect(8 + (u / 0.6) * 58, h / 2 - 2, 12, 4); else { g.strokeStyle = color; g.lineWidth = 3; g.beginPath(); g.arc(74, h / 2, (u - 0.6) * 70, 0, TAU); g.stroke(); } }
  else if (id === 'thunder') { dots.forEach(([dx, dy], i) => dot(dx - 30 + i * 14, dy + (i % 2 ? 12 : -12), u > 0.3 + i * 0.2)); g.strokeStyle = '#bfe9ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, h / 2); for (let i = 0; i < 3 && u > 0.3 + i * 0.2; i++) g.lineTo(30 + i * 14, h / 2 + (i % 2 ? 12 : -12)); g.stroke(); }
  else if (id === 'wing') { for (const s of [-1, 1]) { g.beginPath(); g.moveTo(24, h / 2 + s * 16); g.lineTo(12, h / 2 + s * 16 - 5); g.lineTo(12, h / 2 + s * 16 + 5); g.fill(); g.fillRect(bx - 6, h / 2 + s * 16 - 1.5, 8, 3); } }
  else if (id === 'rainbow') { g.strokeStyle = color; g.lineWidth = 6; g.globalAlpha = 0.8; const a = lerp(-0.5, 0.5, u); g.beginPath(); g.moveTo(10, h / 2); g.lineTo(10 + Math.cos(a) * 90, h / 2 + Math.sin(a) * 90); g.stroke(); }
  else if (id === 'ice') { dots.forEach(([dx, dy]) => { dot(dx, dy, false); if (u > 0.5) { g.strokeStyle = '#e8fbff'; g.lineWidth = 2; g.strokeRect(dx - 7, dy - 7, 14, 14); } }); }
  else if (id === 'magnet') { for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, r = 30 * (1 - u); g.fillStyle = '#c9a8ff'; g.beginPath(); g.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 3, 0, TAU); g.fill(); } }
  else { g.globalAlpha = 0.6 + Math.sin(tt * 10) * 0.4; drawIcon(g, 'charge', w / 2, h / 2, 34, color); }
  g.restore();
}
