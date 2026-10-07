'use strict';
/* 站（docs/design.md §7、§8）：存档里的装备、仓库、资源、设施、解锁、地图进度，以及一局结束时怎么结算。
   只有规则，不碰界面（界面在 stationui.js）。站里的随机（商人进货、赌博、改造台）用 Math.random：不在模拟里，不影响联机同步。 */

const SAVE_V = 4;
const Station = {
  /* 存档 v4 的新字段；老存档（v3）迁移：共享等级 → 驾驶员等级，星尘 → 信用点，1-3 通关过 → 第 1 张图算打通，送两件白装 */
  ensure(m) {
    if (!m) return m;
    const fresh = !m.pilot;
    m.pilot = m.pilot || { lv: Math.min(PILOT.max, (m.shared && m.shared.level) || 1), xp: 0 };
    if (m.credits === undefined) m.credits = Math.floor(m.stardust || 0) + Math.floor((m.tickets || 0) * 40 + (m.cosTickets || 0) * 30 + ((m.home && m.home.res && m.home.res.goods) || 0) * 20);
    m.mats = Object.assign({ scrap: 0, shard: 0, core: 0 }, m.mats || {});
    m.gear = m.gear || { eq: {}, stash: [], inbox: [], auto: { white: false, blue: false } };
    m.gear.eq = m.gear.eq || {}; m.gear.stash = m.gear.stash || []; m.gear.inbox = m.gear.inbox || []; m.gear.auto = Object.assign({ white: false, blue: false }, m.gear.auto || {});
    m.gear.outbox = m.gear.outbox || []; m.gear.giftsGot = m.gear.giftsGot || []; // 送装备（§13）：送出没确认的、收过的编号
    m.fac = Object.assign({ stash: 1, insure: 1, shop: 1, salvage: 1, cube: 1, black: 1 }, m.fac || {});
    m.unlock = Object.assign({ equip: true, starmap: true }, m.unlock || {});
    m.maps = m.maps || { reached: { '1-1': true }, cleared: {}, firstBoss: {}, sel: 1, start: null, kills: {} };
    m.maps.reached = m.maps.reached || { '1-1': true }; m.maps.cleared = m.maps.cleared || {}; m.maps.firstBoss = m.maps.firstBoss || {}; m.maps.kills = m.maps.kills || {};
    m.pity = Object.assign({ noRare: 0, noUni: 0, uniEver: false, runs: 0 }, m.pity || {});
    m.station = Object.assign({ returns: 0, gearHome: false, seen: {}, shop: null, everBlue: false, everSet: false, homes: {}, tut: {} }, m.station || {});
    m.codexGear = Object.assign({ sets: {}, uniques: {}, bases: {} }, m.codexGear || {});
    if (fresh && m.v === 3 && m.progress && m.progress.cleared) { // 老存档：1-1..1-3 的进度算到第 1 张图上
      for (const id of ['1-1', '1-2', '1-3']) if (m.progress.cleared[id]) { m.maps.firstBoss[id] = true; const n = stageNOf(id); if (n < 3) m.maps.reached[`1-${n + 1}`] = true; }
      if (m.progress.cleared['1-3']) { m.maps.cleared[1] = true; m.maps.reached['2-1'] = true; m.station.homes.beacon = true; }
      if (m.firstRunDone) { this.addItem(m, Gear.make({ ilvl: 1, q: 'white', kind: 'gun', base: 'rapid' }), true); this.addItem(m, Gear.make({ ilvl: 1, q: 'white', kind: 'armor', base: 'plate' }), true); m.station.returns = Math.max(m.station.returns, 1); this.checkUnlocks(m); }
    }
    m.v = SAVE_V;
    return m;
  },
  /* ---------- 仓库 ---------- */
  stashCap(m) { return FACILITIES.stash.lv[clamp((m.fac.stash || 1) - 1, 0, 4)]; },
  allItems(m) { return [...Object.values(m.gear.eq).filter(Boolean), ...m.gear.stash, ...m.gear.inbox]; },
  find(m, uid) {
    for (const s of GEAR_SLOTS) if (m.gear.eq[s] && m.gear.eq[s].uid === uid) return { it: m.gear.eq[s], where: 'eq', slot: s };
    let i = m.gear.stash.findIndex((x) => x.uid === uid); if (i >= 0) return { it: m.gear.stash[i], where: 'stash', i };
    i = m.gear.inbox.findIndex((x) => x.uid === uid); if (i >= 0) return { it: m.gear.inbox[i], where: 'inbox', i };
    return null;
  },
  remove(m, uid) { const f = this.find(m, uid); if (!f) return null; if (f.where === 'eq') m.gear.eq[f.slot] = null; else m.gear[f.where].splice(f.i, 1); return f.it; },
  /* 一件新装备到家：仓库满了进到货区；勾了自动拆的白 / 蓝直接拆（锁定的、套装、暗金不拆） */
  addItem(m, it, quiet) {
    if (!it) return null;
    this.codexNote(m, it);
    if (!quiet && m.gear.auto[it.q] && (it.q === 'white' || it.q === 'blue')) { const got = this.salvageGain(m, it); this.addMats(m, got); return { auto: true, got }; }
    if (m.gear.stash.length < this.stashCap(m)) m.gear.stash.push(it); else m.gear.inbox.push(it);
    return { stored: true };
  },
  codexNote(m, it) {
    const C = m.codexGear; C.bases[it.kind + ':' + it.base] = 1;
    if (it.set) { C.sets[it.set] = C.sets[it.set] || {}; C.sets[it.set][it.kind] = 1; m.station.everSet = true; }
    if (it.uni) C.uniques[it.uni] = 1;
    if (it.q === 'blue' || it.q === 'yellow') m.station.everBlue = true;
  },
  addMats(m, o) { for (const k in o) if (k === 'c') m.credits += o[k]; else m.mats[k] = (m.mats[k] || 0) + o[k]; },
  canPay(m, cost) { if (!cost) return true; for (const k in cost) { if (k === 'c' ? m.credits < cost[k] : (m.mats[k] || 0) < cost[k]) return false; } return true; },
  pay(m, cost) { if (!this.canPay(m, cost)) return false; for (const k in cost) { if (k === 'c') m.credits -= cost[k]; else m.mats[k] -= cost[k]; } return true; },
  costText(cost) { const n = { c: '信用点', scrap: '废料', shard: '晶片', core: '晶核' }; return Object.keys(cost || {}).map((k) => `${cost[k]} ${n[k]}`).join(' + '); },
  missing(m, cost) { const n = { c: '信用点', scrap: '废料', shard: '晶片', core: '晶核' }, L = []; for (const k in cost || {}) { const have = k === 'c' ? m.credits : m.mats[k] || 0; if (have < cost[k]) L.push(`${n[k]}还差 ${cost[k] - have}`); } return L.join('，'); },
  /* 局里的装备对象带着 safe / stage 标记：存进存档前去掉（复制一份，不改局里那份） */
  /* ---------- 送装备（§13，联机房间里）：蓝黄绿能送，暗金和改造台改过的不能；先进待送，对方收到的回执回来才算送完 ---------- */
  giftable(it) { return !!it && !it.lock && !it.bound && !it.uni && (it.q === 'blue' || it.q === 'yellow' || it.q === 'green'); },
  giftSend(m, uid, to, toName) {
    const f = this.find(m, uid); if (!f || f.where === 'eq' || !this.giftable(f.it) || m.gear.outbox.some((g) => g.to === to)) return null;
    this.remove(m, uid); const g = { id: `${uid}-${m.gear.outbox.length}-${Math.floor(Math.random() * 1e6)}`, to, toName: toName || '', item: this.clean(f.it) };
    m.gear.outbox.push(g); this.flushInbox(m); return g;
  },
  giftReceive(m, g, fromName) {
    if (!g || !g.item || m.gear.giftsGot.includes(g.id) || !this.giftable(g.item) || !GEAR_KINDS[g.item.kind] || !(g.item.ilvl >= 1 && g.item.ilvl <= MAX_ILVL)) return null; // 只收规则允许送的东西
    m.gear.giftsGot.push(g.id); while (m.gear.giftsGot.length > 40) m.gear.giftsGot.shift();
    const it = Object.assign(this.clean(g.item), { from: fromName || '' }); this.addItem(m, it, true); return it;
  },
  giftResolve(m, to, acks) { const n = m.gear.outbox.length; m.gear.outbox = m.gear.outbox.filter((g) => !(g.to === to && (acks || []).includes(g.id))); return n - m.gear.outbox.length; },
  giftCancel(m, id) { const i = m.gear.outbox.findIndex((g) => g.id === id); if (i < 0) return false; const g = m.gear.outbox.splice(i, 1)[0]; this.addItem(m, g.item, true); return true; },
  clean(it) { const o = Object.assign({}, it); delete o.safe; delete o.stage; return o; },
  /* 首领倒下、货舱送回家：当场写进存档（之后掉线、刷新、退出都不会丢） */
  shipHome(m, items, shipped) { for (const it of items) { if (shipped.has(it.uid)) continue; shipped.add(it.uid); this.addItem(m, Object.assign(this.clean(it), { fresh: true })); } if (items.length) m.station.gearHome = true; }, // fresh：带回来还没看过（仓库里一个“新”字）
  /* ---------- 换装 ---------- */
  slotFor(m, it) { if (it.kind !== 'chip') return it.kind; return !m.gear.eq.chip1 ? 'chip1' : !m.gear.eq.chip2 ? 'chip2' : 'chip1'; },
  canEquip(m, it) { return it.req <= m.pilot.lv; },
  equip(m, uid, slot) {
    const f = this.find(m, uid); if (!f || f.where === 'eq') return false;
    const it = f.it; if (!this.canEquip(m, it)) return false;
    slot = slot && SLOT_KIND[slot] === it.kind ? slot : this.slotFor(m, it);
    m.gear[f.where].splice(f.i, 1);
    const old = m.gear.eq[slot]; m.gear.eq[slot] = it;
    if (old) { if (f.where === 'inbox') m.gear.inbox.push(old); else m.gear.stash.splice(f.i, 0, old); }
    this.flushInbox(m);
    return { slot, old };
  },
  unequip(m, slot) {
    const it = m.gear.eq[slot]; if (!it) return false;
    if (m.gear.stash.length >= this.stashCap(m)) return false;
    m.gear.eq[slot] = null; m.gear.stash.push(it); return true;
  },
  flushInbox(m) { while (m.gear.inbox.length && m.gear.stash.length < this.stashCap(m)) m.gear.stash.push(m.gear.inbox.shift()); },
  /* 比身上的好多少（比较框的总结、仓库排序、机器人换装） */
  compare(m, it, planeId) {
    const slot = it.kind === 'chip' ? (!m.gear.eq.chip1 ? 'chip1' : !m.gear.eq.chip2 ? 'chip2' : this.weakerChip(m, planeId)) : it.kind;
    const cur = Object.assign({}, m.gear.eq), now = Gear.score(Gear.compute(cur), planeId); cur[slot] = it;
    const next = Gear.score(Gear.compute(cur), planeId);
    return { slot, old: m.gear.eq[slot] || null, dps: next.dps / now.dps, ehp: next.ehp / now.ehp, total: next.total / now.total };
  },
  weakerChip(m, planeId) {
    const a = Object.assign({}, m.gear.eq, { chip1: null }), b = Object.assign({}, m.gear.eq, { chip2: null });
    return Gear.score(Gear.compute(a), planeId).total > Gear.score(Gear.compute(b), planeId).total ? 'chip1' : 'chip2';
  },
  /* ---------- 卖、拆、标记 ---------- */
  sell(m, uid) { const f = this.find(m, uid); if (!f || f.where === 'eq' || f.it.lock) return 0; this.remove(m, uid); const c = Gear.sellPrice(f.it); m.credits += c; this.flushInbox(m); return c; },
  salvageGain(m, it) { return Gear.salvageOf(it, FACILITIES.salvage.lv[clamp((m.fac.salvage || 1) - 1, 0, 2)]); },
  salvage(m, uid) { const f = this.find(m, uid); if (!f || f.where === 'eq' || f.it.lock) return null; this.remove(m, uid); const got = this.salvageGain(m, f.it); this.addMats(m, got); this.flushInbox(m); return got; },
  salvageJunk(m) { const tot = {}; for (const it of [...m.gear.stash, ...m.gear.inbox].filter((x) => x.junk && !x.lock)) { const g = this.salvage(m, it.uid); if (g) for (const k in g) tot[k] = (tot[k] || 0) + g[k]; } return tot; },
  /* ---------- 商人 ---------- */
  maxIlvl(m) { let best = 1; for (const id of ALL_STAGES) if (m.maps.reached[id]) best = Math.max(best, ilvlOf(mapOfStage(id), stageNOf(id), true)); return best; },
  restock(m) {
    const lv = m.fac.shop || 1, il = this.maxIlvl(m), L = [];
    for (let i = 0; i < 6; i++) L.push({ it: Gear.make({ ilvl: il, q: 'white' }), mult: 5 });
    if (lv >= 2) for (let i = 0; i < 2; i++) L.push({ it: Gear.make({ ilvl: il, q: 'blue' }), mult: 8 });
    if (lv >= 3) L.push({ it: Gear.make({ ilvl: il, q: 'yellow' }), mult: 10 });
    m.station.shop = L.map((x) => ({ it: x.it, price: Gear.sellPrice(x.it) * x.mult }));
  },
  buy(m, i) {
    const S = m.station.shop, o = S && S[i]; if (!o || m.credits < o.price) return null;
    if (m.gear.stash.length >= this.stashCap(m) && m.gear.inbox.length > 60) return null;
    m.credits -= o.price; S.splice(i, 1); this.addItem(m, o.it, true); return o.it;
  },
  /* ---------- 黑市：赌博（先选位，也可以“随便”便宜两成） ---------- */
  gamblePrice(m, any) { return Gear.gamblePrice(m.pilot.lv, any); },
  gamble(m, kind) {
    const any = !kind, price = this.gamblePrice(m, any); if (m.credits < price) return null;
    m.credits -= price;
    const k = FACILITIES.black.lv[clamp((m.fac.black || 1) - 1, 0, 3)], rnd = Math.random;
    const it = Gear.roll({ rnd, src: 'gamble', kind: kind || null, ilvl: Gear.gambleIlvl(m.pilot.lv, this.maxIlvl(m), rnd), blackK: k, races: this.openRaces(m), mapRaces: this.openRaces(m) });
    this.addItem(m, it, true); this.notePity(m, [it]); return it;
  },
  openRaces(m) { const s = new Set(); for (const mm of MAP_ORDER) if (m.maps.reached[`${mm}-1`]) for (const r of MAPS[mm].races) s.add(r); return [...s]; },
  /* ---------- 改造台 ---------- */
  cube(m, recipe, uid) {
    const R = CUBE_RECIPES[recipe]; if (!R || (m.fac.cube || 1) < R.lv) return { err: `改造台 ${R ? R.lv : 2} 级才有这个配方` };
    if (!this.canPay(m, R.need)) return { err: this.missing(m, R.need) };
    if (recipe === 'scrapToShard' || recipe === 'shardToCore') { this.pay(m, R.need); const o = recipe === 'scrapToShard' ? { shard: 1 } : { core: 1 }; this.addMats(m, o); return { mats: o }; }
    const f = uid && this.find(m, uid); if (!f) return { err: '先放进去一件装备' };
    const it = f.it;
    if (recipe === 'rerollBlue' && it.q !== 'blue') return { err: '这个配方只收蓝装' };
    if (recipe === 'rerollYellow' && it.q !== 'yellow') return { err: '这个配方只收黄装' };
    if ((recipe === 'up1' || recipe === 'up2') && !(it.set || it.uni)) return { err: '升阶只收绿装和暗金' };
    if (recipe === 'up1' && it.grade !== 0) return { err: '这件已经是加强档以上' };
    if (recipe === 'up2' && it.grade !== 1) return { err: '先升到加强档' };
    this.pay(m, R.need);
    let out;
    if (recipe === 'rerollBlue' || recipe === 'rerollYellow') { out = Gear.make({ ilvl: it.ilvl, q: it.q, kind: it.kind, base: it.base, grade: it.grade, rnd: Math.random }); out.bound = true; }
    else { out = Object.assign({}, it, { uid: Gear.newUid(Math.random), grade: it.grade + 1, ilvl: Math.max(it.ilvl, GRADES[it.grade + 1].ilvl) }); out.imp = Gear.rollImp(out.kind, out.base, out.grade, Math.random); out.req = Gear.reqOf(out); }
    if (f.where === 'eq') m.gear.eq[f.slot] = out; else m.gear[f.where][f.i] = out;
    this.codexNote(m, out);
    return { item: out, from: it };
  },
  /* ---------- 设施升级 ---------- */
  facCost(m, id) { const F = FACILITIES[id]; if (!F || !F.cost) return null; return F.cost[m.fac[id] || 1] || null; },
  facUp(m, id) { const c = this.facCost(m, id); if (!c || !this.pay(m, c)) return false; m.fac[id] = (m.fac[id] || 1) + 1; if (id === 'stash') this.flushInbox(m); return true; },
  /* ---------- 解锁（按做过的事，§8.1） ---------- */
  checkUnlocks(m) {
    const U = m.unlock, S = m.station, add = [];
    const want = { stash: S.gearHome, shop: S.returns >= 1, insure: S.returns >= 1, salvage: S.returns >= 2, cube: S.everBlue, black: m.credits >= 500 || S.blackSeen, hangar: m.pilot.lv >= 5, codex: S.everSet, waypoint: ALL_STAGES.some((id) => stageNOf(id) > 1 && m.maps.reached[id]) };
    if (m.credits >= 500) S.blackSeen = true;
    for (const k in want) if (want[k] && !U[k]) { U[k] = true; add.push(k); }
    return add;
  },
  /* ---------- 地图 ---------- */
  mapOpen(m, mm) { return mm === 1 || !!m.maps.cleared[mm - 1]; },
  startStages(m, mm) { return MAPS[mm].stages.filter((id) => stageNOf(id) === 1 || (m.unlock.waypoint && m.maps.reached[id])); },
  /* 路标：从第 n 关开始补发的选择次数（模拟按中位定） */
  catchUp(stageId) { return [0, 0, 6, 12][stageNOf(stageId)] || 0; },
  /* ---------- 驾驶员等级 ---------- */
  addXp(m, xp) {
    const P = m.pilot, before = P.lv; P.xp += xp;
    while (P.lv < PILOT.max && P.xp >= pilotXpNeed(P.lv)) { P.xp -= pilotXpNeed(P.lv); P.lv++; }
    if (P.lv >= PILOT.max) P.xp = 0;
    return P.lv - before;
  },
  /* ---------- 一局结束：结算（§7、§8.2、§12.2） ---------- */
  settle(m, res) {
    this.ensure(m);
    const st = res.stats || {}, mm = res.map || mapOfStage(res.stage), mk = 1 + 0.6 * (mm - 1), done = res.cleared || [];
    const firstKills = done.filter((id) => !m.maps.firstBoss[id]);
    const goals = (res.goalTimes || []).length;
    // 装备：送回的都在；这一关新捡的，套装和暗金一定带回，其余由保险舱保住最好的几件
    const cargo = res.cargo || [], safe = cargo.filter((it) => it.safe), risky = cargo.filter((it) => !it.safe);
    const keepAlways = risky.filter((it) => it.set || it.uni), rest = risky.filter((it) => !(it.set || it.uni)).sort((a, b) => QUALS[b.q].rank - QUALS[a.q].rank || b.ilvl - a.ilvl);
    const ins = FACILITIES.insure.lv[clamp((m.fac.insure || 1) - 1, 0, 3)], insured = rest.slice(0, ins), lost = rest.slice(ins);
    const kept = [...safe, ...keepAlways, ...insured];
    const stored = []; let autoGot = {};
    const shipped = res.shipped || new Set();
    for (const it0 of kept) { const it = Object.assign(this.clean(it0), { fresh: true }); if (shipped.has(it.uid)) { stored.push(it); continue; } const r = this.addItem(m, it); if (r && r.auto) for (const k in r.got) autoGot[k] = (autoGot[k] || 0) + r.got[k]; else stored.push(it); }
    if (kept.length) m.station.gearHome = true;
    // 信用点、材料、经验：全部带回（输了也有，走得越远越多）
    const credK = 1 + ((res.creditK || 0)), bossC = done.reduce((a, id) => a + 60 * (1 + 0.6 * (mapOfStage(id) - 1)) * (m.maps.firstBoss[id] ? 1 : 2), 0);
    const credits = Math.round((Math.floor((st.dust || 0) / 10) + goals * beatPay(STAGES[`${mm}-1`]) + bossC) * credK);
    const scrap = done.length * 2 + (st.elites || 0) + Math.floor((st.wood || 0) / 2); // 地图装置蹦出来的废料（局里叫“星砂矿渣”）也带回
    const xp = Math.round((st.kills || 0) * 0.25 + (st.elites || 0) * 12 + goals * 15 * mk + done.reduce((a, id) => a + 60 * (1 + 0.6 * (mapOfStage(id) - 1)) * (m.maps.firstBoss[id] ? 1 : 2), 0));
    m.credits += credits; m.mats.scrap += scrap;
    const lvBefore = m.pilot.lv, lvUp = this.addXp(m, xp);
    // 地图进度：打倒的首领、走到的关（路标）、打通的地图（站里多一样东西、下一张图开放）
    for (const id of done) { m.maps.firstBoss[id] = true; m.maps.kills[id] = (m.maps.kills[id] || 0) + 1; const n = stageNOf(id); if (n < 3) m.maps.reached[`${mapOfStage(id)}-${n + 1}`] = true; }
    m.maps.reached[res.stage] = true;
    let mapClear = null;
    if (res.win && done.includes(`${mm}-3`)) { if (!m.maps.cleared[mm]) { mapClear = mm; m.station.homes[MAPS[mm].homeId] = true; } m.maps.cleared[mm] = true; if (MAPS[mm + 1]) m.maps.reached[`${mm + 1}-1`] = true; }
    // 保底计数：连续几局没有黄以上 / 没有暗金
    this.notePity(m, cargo, true);
    if (res.lootCfg && res.lootCfg.uniPity === false && m.pity.uniPityArmed) m.pity.uniPityArmed = false;
    m.station.returns++;
    this.restock(m); // 商人每次回家进一批新货
    const unlocks = this.checkUnlocks(m);
    return { kept: stored, lost, insured, autoGot, credits, scrap, xp, lvBefore, lvAfter: m.pilot.lv, lvUp, firstKills, mapClear, unlocks };
  },
  notePity(m, items, endOfRun) {
    const P = m.pity, rare = items.some((it) => QUALS[it.q].rank >= 2), uni = items.some((it) => it.uni);
    if (uni) { P.uniEver = true; P.noUni = 0; } else if (endOfRun) P.noUni++;
    if (endOfRun) { P.runs++; P.noRare = rare ? 0 : P.noRare + 1; }
  },
  /* 开局给模拟的掉落配置（只有本机这一份） */
  lootCfg(m) {
    const P = m.pity, uniPity = (!P.uniEver && P.runs + 1 >= PITY.uniFirst) || P.noUni >= PITY.uniRuns;
    return { races: this.openRaces(m).length ? this.openRaces(m) : MAPS[1].races, firstBoss: Object.assign({}, m.maps.firstBoss), noRare: P.noRare, uniPity, seed: (P.runs + 1) * 7919 + (m.pilot.lv || 1) };
  },
};
