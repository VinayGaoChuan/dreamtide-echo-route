'use strict';
/* 局内掉落与货舱（docs/design.md §6.7、§6.8、§7）：
   - 掉落只给本机这架看、只给本机这架捡（联机各拿各的）；品质、位、词条用每个玩家自己的随机数，不碰模拟的随机数，也不进同步哈希；
   - 捡到的进货舱；每打倒一个首领，货舱送回家（cb.onCargo 当场写进存档），从此安全；
   - 半路死了 / 退出：只丢这一关新捡的（结算时按套装、暗金、保险舱的规则处理）。 */

const LOOT_FX = {
  white: { beam: 0, label: 1.0, sfx: 'dust' },
  blue: { beam: 0.6, label: 1.5, sfx: 'lootBlue' },
  yellow: { beam: 0.8, label: 1.5, sfx: 'lootYellow' },
  green: { beam: 1.2, label: 2.2, sfx: 'lootGreen', slow: 0.25 },
  gold: { beam: 1.6, label: 2.6, sfx: 'lootGold', slow: 0.5 },
};

Object.assign(World.prototype, {
  /* 开局：掉落的配置（ui.js 传 o.loot：寻宝率在 stats 里；这里是本机存档里的东西：开放的族、第一次打首领、保底计数） */
  initLoot(o) {
    this.loot = []; this.lootCfg = Object.assign({ races: ['drill', 'ledger'], firstBoss: {}, noRare: 0, noUni: 0, uniEver: false, seed: 1 }, o.loot || {});
    this.lootSeed = ((o.seed !== undefined ? o.seed : this.seed) ^ (this.lootCfg.seed * 2654435761)) >>> 0;
    for (const q of this.players) { q.cargo = []; q.lootN = 0; q.lootRnd = Gear.rng((this.lootSeed + (q.idx + 1) * 40503) >>> 0); }
    this.m.loot = { n: 0, best: null, byQ: {} };
  },
  lootOn() { return this.mode === 'run' && !this.vs && !!this.loot; },
  /* 这一处掉的物品等级、族偏向 */
  lootCtx(boss) {
    const m = mapOfStage(this.stageId), n = stageNOf(this.stageId), M = MAPS[m] || MAPS[1];
    return { ilvl: ilvlOf(m, n, boss), mapRaces: M.races, races: this.lootCfg.races, bossMap: boss && n === 3 ? m : 0, priest: boss && this.stageId === '5-3' };
  },
  /* 掉一件（只给本机这架）。src：fodder / elite / boss；o.minQ、o.q、o.kind 用于首杀必掉和保底 */
  lootRoll(src, x, y, o = {}, v) {
    const p = this.me; if (!this.lootOn() || !p || p.gone) return null;
    const C = this.lootCtx(src === 'boss'), it = Gear.roll(Object.assign({ rnd: p.lootRnd, src }, C, o, { mf: ((p.stats && p.stats.mf) || 0) + (o.mfAdd || 0) }));
    const k = { item: it, x, y, vx: v ? v.vx : srand0(p.lootRnd, -80, 120), vy: v ? v.vy : srand0(p.lootRnd, -380, -220), t: 0, owner: p.idx, fx: LOOT_FX[it.q] || LOOT_FX.white };
    this.loot.push(k);
    if (p === this.me) {
      const F = k.fx; Sound.sfx(F.sfx, { pan: this.pan(x), gap: 40 });
      if (F.slow && !this.mp) this.slowT = Math.max(this.slowT, F.slow); // 绿、金：慢放半拍（只在单人：联机的模拟不能因为一个人的掉落变慢）
      if (it.q === 'gold') { this.flash = Math.max(this.flash, 0.3 * this.flashK()); this.flashColor = '255,214,140'; this.shake(0.25); }
      this.emit('lootDrop', { q: it.q, name: Gear.name(it) });
    }
    return k;
  },
  /* 敌人倒下：普通怪、精英、地图出手各按概率；拾荒者之眼会先在精英头上闪一下要掉的那件的颜色 */
  lootOnKill(e) {
    if (!this.lootOn() || e.isBoss) return;
    const p = this.me, elite = e.elite || e.type === 'cmdr';
    if (e.noLoot) return; // 分裂出来的小精英不掉
    const raceO = Object.assign(e.race ? { mapRaces: [e.race] } : {}, e.aff ? { mfAdd: 15 * e.aff.length } : {}); // 打倒哪个族的敌人，套装就偏向那一族（§6.7）；精英每条词缀 +15 寻宝
    if (e.lootPre !== undefined) { if (e.lootPre) this.lootRoll('elite', e.x, e.y, Object.assign({ q: e.lootPre }, raceO)); return; }
    const r = p.lootRnd();
    if (e.type === 'thief') return; // 袋子在 killEnemy 里喷
    if (e.lurk) { if (r < DROP_RATE.lurk) this.lootRoll('elite', e.x, e.y); return; }
    if (elite) { if (r < DROP_RATE.elite) this.lootRoll('elite', e.x, e.y, raceO); return; }
    if (!e.fodder && !e.swell && r < DROP_RATE.fodder) this.lootRoll('fodder', e.x, e.y, raceO);
  },
  /* 一堆东西一起掉：扇形喷开，每件一道光柱，不叠在一起（首领、收账小偷的袋子） */
  lootFan(i, n) { const s = i - (n - 1) / 2; return { vx: s * 240 - 110, vy: -520 + Math.abs(s) * 70 }; }, // 偏向左边（玩家这边），不喷出屏幕右缘
  /* 收账小偷的袋子（§9.3）：DROP_RATE.thief 件，至少 1 件蓝 */
  lootThief(e) {
    if (!this.lootOn()) return;
    const n = DROP_RATE.thief; for (let i = 0; i < n; i++) this.later(0.1 + i * 0.16, () => this.lootRoll('elite', e.x, e.y, i === n - 1 ? { minQ: 'blue', mapRaces: ['ledger'] } : { mapRaces: ['ledger'] }, this.lootFan(i, n)));
  },
  /* 精英出现时先定好掉不掉、掉什么品质（拾荒者之眼看得见） */
  lootPreRoll(e) {
    const p = this.me; if (!this.lootOn() || !p || !(p.stats.flags || {}).foresee) return;
    if (p.lootRnd() >= DROP_RATE.elite) { e.lootPre = null; return; }
    e.lootPre = Gear.pickW(p.lootRnd, Gear.mfTable(DROP_Q.elite, (p.stats.mf || 0) + (e.aff ? 15 * e.aff.length : 0)));
  },
  /* 首领倒下：2 件（第 3 关 3 件，至少一件黄）；首杀必掉；保底 */
  lootBoss(x, y) {
    if (!this.lootOn()) return;
    const n = stageNOf(this.stageId), m = mapOfStage(this.stageId), C = this.lootCfg, first = !C.firstBoss[this.stageId];
    const drops = [];
    if (first) {
      if (this.stageId === '1-1') drops.push({ q: 'blue', kind: 'gun', base: ['scatter', 'beam', 'missile'][Math.floor(this.me.lootRnd() * 3)] }); // 第一局：一把换了底子的蓝色主炮（回家第一件事就是换上它）
      else if (n < 3) drops.push({ q: 'yellow' });
      else drops.push({ q: 'green', mapOnly: true });
    }
    if (n === 3 && C.uniPity) { drops.push({ q: 'gold' }); C.uniPity = false; }
    if (C.noRare >= PITY.rareRuns && !drops.some((d) => QUALS[d.q].rank >= 2)) { drops.push({ minQ: 'yellow' }); C.noRare = 0; }
    while (drops.length < (n === 3 ? 3 : 2)) drops.push(n === 3 && drops.length === 0 ? { minQ: 'yellow' } : {}); // 大首领倒下是一堆（§6.7）
    if (n === 3 && !drops.some((d) => d.minQ || (d.q && QUALS[d.q].rank >= 2))) drops[drops.length - 1] = { minQ: 'yellow' };
    C.firstBoss[this.stageId] = true;
    // 战利品喷泉（§6.8）：一件接一件从残骸里扇形喷出来，最好的最后
    const N = drops.length; drops.sort((a, b) => (a.q || a.minQ ? 1 : 0) - (b.q || b.minQ ? 1 : 0));
    drops.forEach((d, i) => this.later(0.25 + i * 0.3, () => {
      const o = Object.assign({}, d); if (o.mapOnly) { o.races = MAPS[m].races; o.mapRaces = MAPS[m].races; delete o.mapOnly; }
      this.lootRoll('boss', x, y, o, this.lootFan(i, N));
    }));
  },
  /* 每帧：货箱往上弹一下再缓缓漂，飞近就吸进货舱；6 秒没捡也会自己飞过来（横版射击不能停下来捡） */
  updateLoot(dt) {
    if (!this.loot || !this.loot.length) return;
    const p = this.me, R = 70 * ((p.stats && p.stats.magnetK) || 1);
    for (const k of this.loot) {
      k.t += dt;
      if (!p.alive && this.state !== 'victory') { k.vx = smooth(k.vx, -40, 2, dt); k.vy = smooth(k.vy, 0, 2, dt); }
      else {
        const d = Math.hypot(k.x - p.x, k.y - p.y), pull = k.t > 0.7 && (d < R || k.t > 6 || this.state === 'victory');
        if (pull) { const a = angTo(k.x, k.y, p.x, p.y), sp = 520 + k.t * 160; k.vx = smooth(k.vx, Math.cos(a) * sp, 10, dt); k.vy = smooth(k.vy, Math.sin(a) * sp, 10, dt); }
        else { k.vx = smooth(k.vx, -30, 2.2, dt); k.vy = smooth(k.vy, Math.sin(k.t * 2) * 14, 2.2, dt); }
        if (d < 30 && k.t > 0.5) { this.lootCollect(k); continue; }
      }
      k.x += k.vx * dt; k.y += k.vy * dt; k.y = clamp(k.y, TOP + 20, BOTTOM - 20);
      if (k.x < 20) k.x = 20;
    }
    this.loot = this.loot.filter((k) => !k.done);
  },
  lootCollect(k) {
    const p = this.me; k.done = true; const it = k.item;
    it.stage = this.stageId; p.cargo.push(it); p.lootN++;
    const L = this.m.loot; L.n++; L.byQ[it.q] = (L.byQ[it.q] || 0) + 1; if (!L.best || QUALS[it.q].rank > QUALS[L.best].rank) L.best = it.q;
    Sound.sfx('pickLoot', { gap: 30, k: QUALS[it.q].rank });
    this.emit('loot', { q: it.q, name: Gear.name(it), n: p.cargo.filter((x) => !x.safe).length, total: p.cargo.length, best: L.best });
    if (this.cb.onLoot) this.cb.onLoot(it);
  },
  /* 首领倒下：货舱送回家（当场写进存档），这一关以前捡的都安全了 */
  shipCargo() {
    const p = this.me; if (!this.lootOn() || !p) return;
    for (const k of this.loot) if (!k.done) this.lootCollect(k); // 场上还没捡的一起吸进来
    const fresh = p.cargo.filter((it) => !it.safe); for (const it of fresh) it.safe = true;
    this.cargoPod = { t: 0, x: p.x - 20, y: p.y, n: fresh.length, total: p.cargo.length };
    this.emit('cargoShip', { n: fresh.length, total: p.cargo.length });
    if (this.cb.onCargo) this.cb.onCargo(fresh.slice());
  },
  /* ---------- 画 ---------- */
  drawLoot(g) {
    if (this.loot && this.loot.length) for (const k of this.loot) drawLootCrate(g, k, this.t);
    const P = this.cargoPod;
    if (P) {
      P.t += 1 / 60; const u = Math.min(1, P.t / 1.4), x = P.x - Ease.inCubic(u) * (P.x + 120), y = P.y - Math.sin(u * Math.PI) * 60;
      g.save(); g.translate(x, y); g.scale(1.8, 1.8);
      g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(255,190,120,${0.55 - i * 0.035})`; g.beginPath(); g.arc(20 + i * 10, Math.sin(i * 0.8 + P.t * 9) * 3, 7 - i * 0.4, 0, TAU); g.fill(); } g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#c9b08a'; g.strokeStyle = '#2a1e30'; g.lineWidth = 2.4; roundRect(g, -22, -14, 44, 28, 7); g.fill(); g.stroke();
      g.fillStyle = '#ffd27a'; g.fillRect(-18, -3, 36, 6); g.fillStyle = '#2a1e30'; g.fillRect(-4, -14, 8, 28);
      g.restore();
      g.save(); g.font = '18px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif'; g.textAlign = 'center'; g.fillStyle = `rgba(255,214,140,${Math.max(0, 1 - P.t / 1.6)})`; g.fillText(`货舱 · ${P.total} 件送回家`, x, y - 44); g.restore();
      if (P.t > 1.6) this.cargoPod = null;
    }
  },
});
function roundRect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
function srand0(rnd, a, b) { return a + rnd() * (b - a); }
/* 一个掉落的小货箱：品质色的光柱、头上的名字（暗黑 2 的地面标签） */
function drawLootCrate(g, k, t) {
  const it = k.item, c = QUALS[it.q].color, F = k.fx, a = Math.min(1, k.t * 4);
  g.save(); g.translate(k.x, k.y);
  if (F.beam) { // 光柱：越稀有越高越亮；金色从屏幕顶上砸下来
    const h = it.q === 'gold' ? k.y + 40 : 160 * F.beam, fade = Math.max(0, 1 - Math.max(0, k.t - 2.2) / 1.2);
    const gr = g.createLinearGradient(0, -h, 0, 0); gr.addColorStop(0, hexA(c, it.q === 'gold' ? 0.25 : 0)); gr.addColorStop(1, hexA(c, (it.q === 'gold' ? 0.85 : 0.55) * fade));
    g.fillStyle = gr; g.fillRect(-7 * F.beam, -h, 14 * F.beam, h);
    if (it.q === 'gold' || it.q === 'green') { g.globalCompositeOperation = 'lighter'; g.fillStyle = hexA('#fff6dc', 0.7 * fade); g.fillRect(-2.5 * F.beam, -h, 5 * F.beam, h); g.globalCompositeOperation = 'source-over'; }
    g.globalCompositeOperation = 'lighter'; drawGlow(g, 0, 0, 30 + 16 * F.beam, hexA(c, 0.9), 0.5 * fade); g.globalCompositeOperation = 'source-over';
  }
  const bob = Math.sin(t * 4 + k.x * 0.01) * 2;
  g.rotate(Math.sin(k.t * 3) * 0.12);
  g.fillStyle = '#2a2236'; g.strokeStyle = c; g.lineWidth = 2.5; roundRect(g, -11, -9 + bob, 22, 18, 4); g.fill(); g.stroke();
  g.fillStyle = c; g.fillRect(-11, -2 + bob, 22, 4);
  g.rotate(-Math.sin(k.t * 3) * 0.12);
  g.restore();
}
/* 掉落的名字（品质色，先浮起再淡出）：单独一层，画在敌人上面 */
function drawLootLabel(g, k) {
  const it = k.item, c = QUALS[it.q].color, F = k.fx, a = Math.min(1, k.t * 4);
  g.save(); g.translate(k.x, k.y);
  if (k.t < F.label + 1) { // 名字：品质色，先浮起再淡出
    const la = Math.min(a, Math.max(0, 1 - (k.t - F.label) / 1));
    const txt = it._label || Gear.name(it), ascii = /^[\x00-\x7f·]+$/.test(txt);
    g.globalAlpha = la; g.font = ascii ? `800 ${it.q === 'gold' ? 20 : 15}px "Baloo 2", sans-serif` : `${it.q === 'gold' ? 20 : 15}px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif`; g.textAlign = 'center';
    const w = g.measureText(txt).width + 14;
    g.fillStyle = 'rgba(10,8,18,0.72)'; g.fillRect(-w / 2, -40 - (it.q === 'gold' ? 4 : 0), w, it.q === 'gold' ? 26 : 21);
    g.fillStyle = c; g.fillText(txt, 0, -24); g.globalAlpha = 1;
  }
  g.restore();
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
