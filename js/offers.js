'use strict';
/* 梦潮：回声航线 v0.7 — 局内 Build 与升级二选一。
   三个槽位：主炮改造链（穿透 / 追踪 / 多重 / 爆破，兼容累积）· 自动支援（一个，换新的先展示前后）· 大招改造（一个）。
   奖励流程：清波 / 地图互动 / 技能洞 → 预告 0.5s → 揭晓两个方案 0.6s → 飞进一个方案的确认圈停 0.35s → 图标装进主炮 → 下一队敌人验证。
   选择期间敌人不再开火、已有子弹淡出、刷怪暂停、世界慢速前进；不弹全屏选卡页。错过就记账，下一段安全位置再出现。 */

const OFFER_T = { preview: 0.5, reveal: 0.6, choose: 4, confirm: 0.5, dwell: 0.35 };
const OFFER_R = 50;       // 确认圈半径
const OFFER_NEAR = 150;   // 进入这个距离只预览

Object.assign(World.prototype, {
  initBuild() {
    this.gun = { pierce: 0, homing: 0, multi: 0, bomb: 0 };
    this.support = null; this.bmod = null; this.links = new Set();
    this.skills = [];
    this.offer = null; this.offerQueue = []; this.pendingOffers = 0; this.offerN = 0; this.dryOffers = 0;
    this.picks = []; this.stream = null;
  },
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
  /* 这个方案拿到后能不能和已有能力联动 */
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
    if (this.offerN === 0) return [this.optGun('pierce'), this.optGun('homing')];
    const gun = GUN_ORDER.map((id) => this.optGun(id, rare)).filter(Boolean);
    const sup = SUPPORT_ORDER.map((id) => this.optSupport(id, rare)).filter(Boolean);
    const bm = BURST_MOD_ORDER.map((id) => this.optBmod(id)).filter(Boolean);
    const lk = Object.keys(SYNERGIES).map((k) => this.optLink(k)).filter(Boolean);
    const everything = [...gun, ...sup, ...bm, ...lk];
    let pool;
    if (source === 'house') pool = gun;                                                     // 梦灯屋：两个主炮改造
    else if (source === 'npc') pool = sup;                                                  // 救援站：支援技能
    else if (source === 'mine') pool = [...lk, ...gun.filter((o) => o.from > 0), ...sup.filter((o) => o.from > 0), ...bm]; // 星砂矿：兼容强化
    else if (source === 'rare') pool = [...lk, ...gun, ...sup.filter((o) => !o.replace), ...bm];
    else pool = everything;
    if (pool.length < 2) pool = everything;
    if (pool.length < 2) return [{ kind: 'res', id: 'charge' }, { kind: 'res', id: 'heal' }];
    const upgrades = pool.filter((o) => o.from > 0), fresh = pool.filter((o) => !(o.from > 0) && o.kind !== 'link');
    let a = null;
    if (this.offerN === 1 && upgrades.length && fresh.length) a = pick(upgrades);           // 第二次：已有方向升级 + 兼容新方向
    else if (this.offerN === 2 || rare) { const L = pool.filter((o) => this.enablesLink(o)); if (L.length) a = pick(L); } // 第三次：至少一个能联动
    if (!a && this.dryOffers >= 2 && upgrades.length) a = pick(upgrades);                   // 连续两次没有可提升项：强制给
    const rest = pool.filter((o) => !a || o.id !== a.id);
    const second = this.offerN === 1 && a ? fresh.filter((o) => o.id !== a.id) : rest;
    const b = this.weightedPick(second.length ? second : rest);
    if (!a) a = this.weightedPick(rest.filter((o) => o.id !== b.id)) || pick(everything.filter((o) => o.id !== b.id));
    return [a, b];
  },
  /* 预先定好的候选（转盘 / 矿脉）在揭晓前是否仍然有效 */
  stillValid(o) {
    if (o.kind === 'gun') return this.gun[o.id] === o.from;
    if (o.kind === 'support') return (this.support ? (this.support.id === o.id ? this.support.ulv : 0) : 0) === o.from && (o.from > 0 || (this.support ? this.support.id : null) === (o.replace ? o.replace.id : null));
    if (o.kind === 'bmod') return (this.bmod && this.bmod.id === o.id ? this.bmod.lv : 0) === o.from;
    if (o.kind === 'link') return !this.links.has(o.id);
    return true;
  },
  weightedPick(list) {
    if (!list.length) return null;
    const w = list.map((o) => this.optWeight(o)); let r = Math.random() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  },
  optInfo(o) {
    if (o.kind === 'gun' || o.kind === 'support') { const S = SKILLS[o.id]; return { name: S.name, lv: o.from ? `Lv${o.from}→${o.to}` : `Lv${o.to}`, desc: S.lv[o.to - 1], icon: S.canvas, color: S.color, tag: o.kind === 'gun' ? '主炮' : '支援', replace: o.replace ? `替换 ${SKILLS[o.replace.id].name} Lv${o.replace.lv}` : null }; }
    if (o.kind === 'bmod') { const B = BURST_MODS[o.id]; return { name: B.name, lv: o.from ? 'Lv1→2' : 'Lv1', desc: B.lv[o.to - 1], icon: 'charge', color: B.color, tag: '大招', replace: o.replace ? `替换 ${BURST_MODS[o.replace.id].name}` : null }; }
    if (o.kind === 'link') { const L = SYNERGIES[o.id]; return { name: L.name, lv: '联动', desc: L.desc, icon: 'star', color: '#ffd76a', tag: '联动', replace: null }; }
    return o.id === 'charge' ? { name: '大招能量', lv: '', desc: '大招充能 +50%', icon: 'charge', color: '#ffd76a', tag: '资源' } : { name: '恢复', lv: '', desc: '生命 +1', icon: 'heart', color: '#6fe39a', tag: '资源' };
  },

  /* ---------- 流程 ---------- */
  queueOffer(source, o = {}) { if (this.mode !== 'run') return; this.offerQueue.push({ source, rare: !!o.rare, x: o.x, y: o.y, opts: o.opts }); },
  canOffer() { return this.mode === 'run' && this.state === 'play' && !this.bursting && this.phase === 'fight' && !this.mapDwell; },
  startOffer(q) {
    const p = this.player, top = this.arena.top + 90, bot = this.arena.bottom - 90;
    if (this.rareNext) { this.rareNext = false; q.rare = true; }
    const opts = q.opts && q.opts.every((o) => o && this.stillValid(o)) ? q.opts : this.makeOffer(q.source, q.rare);
    const gx = clamp(p.x + 330, this.W * 0.42, this.W * 0.74), cy = clamp(p.y, top + 80, bot - 80);
    this.offer = { q, opts, st: 'preview', t: 0, total: 0, chooseT: 0, pick: -1,
      gates: opts.map((opt, i) => ({ opt, info: this.optInfo(opt), x: q.x !== undefined ? q.x : this.W + 60, y: q.y !== undefined ? q.y : cy, tx: gx, ty: clamp(cy + (i ? 128 : -128), top, bot), near: 0, dwell: 0, alpha: 0 })) };
    const hasUp = opts.some((o) => o && o.from > 0);
    this.dryOffers = hasUp || this.offerN < 2 ? 0 : this.dryOffers + 1;
    this.offerN++; this.m.offers = (this.m.offers || 0) + 1;
    Sound.sfx('spin');
    this.emit('offer', { source: q.source, first: this.offerN === 1 });
  },
  updateOffer(dt) {
    if (this.mode !== 'run') return;
    const O = this.offer, p = this.player;
    if (!O) { if (this.offerQueue.length && this.canOffer()) this.startOffer(this.offerQueue.shift()); return; }
    O.t += dt; O.total += dt;
    // 选择中：敌弹淡出，警告撤掉
    if (O.st !== 'confirm') {
      this.bullets.each((b) => { b.fadeT = (b.fadeT || 0) + dt; if (b.fadeT > 0.45) { b.on = false; if (Math.random() < 0.4) this.part('mote', b.x, b.y, rand(-20, 20), rand(-50, -10), 0.5, 2.5, 'rgba(201,168,255,0.8)'); } });
      this.warns = this.warns.filter((w) => w.keep);
    }
    for (const G of O.gates) {
      if (O.st === 'preview' || O.st === 'reveal') { G.x = lerp(G.x, G.tx, 1 - Math.pow(0.001, dt / 0.6)); G.y = lerp(G.y, G.ty, 1 - Math.pow(0.001, dt / 0.6)); }
      else if (O.st === 'choose') G.x -= 22 * dt;
      G.alpha = Math.min(1, G.alpha + dt * 3);
    }
    if (O.st === 'preview' && O.t >= OFFER_T.preview) { O.st = 'reveal'; O.t = 0; Sound.sfx('reveal', { r: O.q.rare ? 'SR' : 'R' }); }
    else if (O.st === 'reveal' && O.t >= OFFER_T.reveal) { O.st = 'choose'; O.t = 0; }
    else if (O.st === 'choose') {
      O.chooseT += dt;
      let anyNear = false;
      const rr = OFFER_R + (this.planeId === 'paper' ? 14 : 0);
      O.gates.forEach((G, i) => {
        const d = Math.sqrt(dist2(p.x, p.y, G.x, G.y));
        G.near = approach(G.near, d < OFFER_NEAR ? 1 : 0, dt * 5);
        if (d < OFFER_NEAR) anyNear = true;
        if (p.alive && d < rr) { G.dwell += dt; if (G.dwell >= OFFER_T.dwell) this.chooseOffer(i); }
        else G.dwell = Math.max(0, G.dwell - dt * 2);
      });
      if (O.st === 'choose' && !anyNear && O.t >= OFFER_T.choose) this.missOffer();
    } else if (O.st === 'confirm') {
      const G = O.gates[O.pick]; G.x = lerp(G.x, p.x, 1 - Math.pow(0.0001, dt / 0.5)); G.y = lerp(G.y, p.y, 1 - Math.pow(0.0001, dt / 0.5));
      O.gates.forEach((g2, i) => { if (i !== O.pick) g2.alpha = Math.max(0, g2.alpha - dt * 4); });
      if (O.t >= OFFER_T.confirm) { this.offer = null; this.fx(p.x, p.y, 2, 80, [G.info.color, '#ffffff', '#ffe38a']); }
    }
  },
  chooseOffer(i) {
    const O = this.offer, G = O.gates[i];
    O.st = 'confirm'; O.t = 0; O.pick = i;
    this.m.choiceTimes = this.m.choiceTimes || []; this.m.choiceTimes.push(O.chooseT);
    if (this.m.firstSkill === null) this.m.firstSkill = this.runT;
    this.applyOption(G.opt);
    Sound.sfx(G.opt.kind === 'link' ? 'synergy' : 'crystal');
    this.shake(0.15);
  },
  missOffer() {
    this.offer = null; this.pendingOffers++; this.m.offerMiss = (this.m.offerMiss || 0) + 1;
    this.emit('flag', { text: '奖励先存着 · 下一段安全的地方再出现', dur: 1.4 });
  },
  applyOption(o) {
    const p = this.player, info = this.optInfo(o);
    switch (o.kind) {
      case 'gun': this.gun[o.id] = o.to; if (o.to >= 3) this.m.lv5++; break;
      case 'support':
        this.support = { id: o.id, ulv: o.to, lv: UPG_LEGACY[o.to], t: 0.4, t2: 3 };
        if (o.to >= 3) this.m.lv5++;
        if (o.replace && o.replace.id === 'thunder') this.storm = null;
        break;
      case 'bmod': this.bmod = { id: o.id, lv: o.to }; break;
      case 'link': this.links.add(o.id); this.m.syns++; if (this.m.firstSyn === null) this.m.firstSyn = this.runT; this.highlight(); if (this.cb.onSynergy) this.cb.onSynergy(o.id); break;
      case 'res': if (o.id === 'charge') this.addCharge(0.5); else if (p.hp < p.maxHp) p.hp++; break;
    }
    this.skills = this.support ? [this.support] : [];
    this.picks.push(o); this.crystals = this.picks.length; this.m.crystals++;
    if (o.kind === 'gun' || o.kind === 'support') { if (this.cb.onSkill) this.cb.onSkill(o.id); }
    this.syncWingmen();
    this.updateStream();
    Sound.setCardMods([this.support ? { thunder: 'echo', wing: 'mirror', magnet: 'gentle', ice: 'tide', rainbow: 'paperboat' }[this.support.id] : null, this.gun.bomb ? 'overheat' : null].filter(Boolean));
    this.emit('pick', { kind: o.kind, id: o.id, name: info.name, lv: info.lv, desc: info.desc, color: info.color, tag: info.tag });
    this.onCompanionSkill();
    this.fx(p.x, p.y, 2, 70, [info.color, '#ffffff', '#ffe38a']);
    if (this.hintStep >= 0 && this.hintStep < 2) this.hintStep = 2;
  },
  /* 流派名：拿到 4 次以上升级后按主炮 + 支援组合命名 */
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
      this.highlight(); this.emit('stream', { id: this.stream.id, name });
      Sound.sfx('stream'); this.flash = Math.max(this.flash, 0.3); this.flashColor = '255,243,200';
    } else if (this.stream) this.stream = { id: this.topId(), name };
  },
  buildSummary() {
    return { gun: Object.assign({}, this.gun), support: this.support ? { id: this.support.id, lv: this.support.ulv } : null, bmod: this.bmod ? Object.assign({}, this.bmod) : null, links: [...this.links] };
  },

  /* ---------- 画：奖励双门（圆角卡片边框，和路线洞口的圆形不同） ---------- */
  drawOffer(g) {
    const O = this.offer; if (!O) return;
    const t = this.t, p = this.player;
    O.gates.forEach((G, i) => {
      if (G.alpha <= 0.01) return;
      const I = G.info, show = O.st !== 'preview', chosen = O.pick === i, s = 1 + G.near * 0.1 + (chosen ? 0.1 : 0);
      g.save(); g.globalAlpha = G.alpha; g.translate(G.x, G.y); g.scale(s, s);
      const w = 212, h = 132;
      glowAt(g, 0, 0, 130, hexA(I.color, 0.7), 0.35 + G.near * 0.3);
      g.fillStyle = 'rgba(24,19,64,0.9)'; g.strokeStyle = show ? I.color : 'rgba(255,255,255,0.4)'; g.lineWidth = 3;
      g.beginPath(); g.roundRect ? g.roundRect(-w / 2, -40, w, h, 18) : g.rect(-w / 2, -40, w, h); g.fill(); g.stroke();
      // 确认圈
      g.strokeStyle = show ? I.color : 'rgba(255,255,255,0.5)'; g.lineWidth = 3; g.setLineDash([8, 7]); g.lineDashOffset = -t * 30;
      g.beginPath(); g.arc(0, -40, OFFER_R - 6, 0, TAU); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(40,30,100,0.95)'; g.beginPath(); g.arc(0, -40, 34, 0, TAU); g.fill();
      if (show) drawIcon(g, I.icon, 0, -40, 36, I.color); else { g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = mapFont(30); g.textAlign = 'center'; g.fillText('?', 0, -30); }
      if (G.dwell > 0) { g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.arc(0, -40, OFFER_R - 6, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(G.dwell / OFFER_T.dwell, 0, 1)); g.stroke(); }
      if (show) {
        g.textAlign = 'center';
        g.font = mapFont(21); g.fillStyle = '#fff6ee'; g.fillText(`${I.name} ${I.lv}`, 0, 14);
        g.font = '500 13px "Noto Sans SC", sans-serif'; g.fillStyle = 'rgba(230,222,255,0.9)';
        const lines = wrapText(I.desc, 15); lines.slice(0, 2).forEach((ln, k) => g.fillText(ln, 0, 34 + k * 17));
        g.font = '700 12px "Noto Sans SC", sans-serif'; g.fillStyle = I.color; g.fillText(I.tag, -w / 2 + 26, -24);
        if (I.replace) { g.fillStyle = '#ffb2a8'; g.fillText(I.replace, 0, 84); }
      }
      g.restore();
      if (O.st === 'choose' && this.offerN === 1 && p.alive && G.near < 0.5) drawPointer(g, p.x, p.y, G.x, G.y - 40, I.color, t + i);
    });
  },
});
/* 中文按字数折行 */
function wrapText(str, n) { const out = []; for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n)); return out; }
