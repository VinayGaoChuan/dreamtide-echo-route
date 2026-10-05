'use strict';
/* 梦潮：回声航线 v0.10 — 家园的规则（只有数据和规则：界面在 ui.js，画面在 art.js 的 HomeScene）。
   第一阶段的因果链：救小梦兔 → 救援台；救云朵爷爷 → 工坊；修风道 → 下一局风车塔多一个上层风圈；上层云桥救糖果商人 → 巡游店；
   交一件货物完成商人委托 → 糖果号。
   永久变化一律“先查条件 → 扣费和发放一起改 → 记一条唯一记录”，调用方随后立刻存档；同一条记录不会发第二次（重启、重复触发都安全）。 */
const Home = {
  fresh() {
    return {
      res: { wood: 0, goods: 0 },        // 梦木 / 货物（星尘还在 meta.stardust）
      events: {},                         // 唯一记录：rescue:bunny、project:windRoad、commission:candy …
      npcs: {},                           // 常驻 NPC：{ stage 0 初见 / 1 伙伴 / 2 知己, job 'main' | 'side' }
      built: {},                          // 已开放的功能建筑
      plots: {},                          // 建筑摆在哪一格（机库固定，不占格）
      projects: {},                       // 已完成的世界项目
      work: { t: 0, last: [] },           // 工作周期：累计的有效战斗秒数；上一次回家时的工作结果
      reserve: 0,                         // 玩家自己设的梦木保留下限（项目需要的会自动多留）
      shelves: [true, true],              // 巡游店两个货架：卖不卖货物
      visit: 0, jobVisit: -1, jobNpc: null, // 每次回家最多改一项职责
    };
  },
  /* 读档时补齐结构；老存档里已经救过的伙伴直接住进来、开放对应建筑 */
  ensure(m) {
    const f = Home.fresh(), h = m.home || {};
    m.home = Object.assign(f, h, { res: Object.assign(f.res, h.res || {}), work: Object.assign(f.work, h.work || {}) });
    for (const k of ['events', 'npcs', 'built', 'plots', 'projects']) m.home[k] = Object.assign({}, h[k] || {});
    if (!Array.isArray(m.home.shelves) || m.home.shelves.length !== 2) m.home.shelves = [true, true];
    for (const id of Object.keys((m.progress && m.progress.rescued) || {})) Home.rescue(m, id);
    for (const k of ['wood', 'goods']) m.home.res[k] = Math.max(0, Math.floor(m.home.res[k] || 0)); // 读档校验：资源不为负
    return m.home;
  },
  has(m, ev) { return !!(m.home && m.home.events[ev]); },
  rescued(m, id) { return Home.has(m, 'rescue:' + id); },
  /* 救出一位伙伴（NPC 到达修理点那一刻就调用，随后立刻存档）：常驻 NPC 住进来并开放自己的建筑，自动摆到空格 */
  rescue(m, id) {
    const H = m.home, ev = 'rescue:' + id;
    if (!NPCS[id] || H.events[ev]) return null;
    H.events[ev] = Date.now(); m.progress.rescued[id] = 1;
    const N = HOME_NPCS[id];
    if (!N) return { id, resident: false };                // 第二阶段才有家园工作的伙伴：先记在救援台
    H.npcs[id] = H.npcs[id] || { stage: 0, job: 'main' };
    let opened = null;
    if (!H.built[N.bld]) { // 默认摆在它原来那片残骸的位置；那格被占了就找空格
      H.built[N.bld] = 1; opened = N.bld; const pref = HOME_BUILDINGS[N.bld].plot, taken = Object.values(H.plots).includes(pref);
      const c = !taken && pref !== undefined ? pref : Home.freePlot(m); if (c !== null) H.plots[N.bld] = c;
    }
    if (id === 'grandpa') Home.bond(m, 'bunny');           // 小梦兔的线索带回了爷爷：成为伙伴
    return { id, resident: true, opened };
  },
  bond(m, id) { const n = m.home.npcs[id]; if (n && n.stage < 1) { n.stage = 1; return true; } return false; },
  freePlot(m) { const used = new Set(Object.values(m.home.plots)); for (let i = 0; i < HOME.plots; i++) if (!used.has(i) && !Home.ruinAt(m, i)) return i; for (let i = 0; i < HOME.plots; i++) if (!used.has(i)) return i; return null; },
  /* 还没开放的建筑：在它的默认格上留一片残骸（看得出来以后会是什么） */
  ruins(m) { const H = m.home, used = new Set(Object.values(H.plots)); return Object.keys(HOME_BUILDINGS).filter((b) => !H.built[b] && HOME_BUILDINGS[b].plot !== undefined && !used.has(HOME_BUILDINGS[b].plot)).map((b) => ({ b, plot: HOME_BUILDINGS[b].plot })); },
  ruinAt(m, i) { return Home.ruins(m).some((r) => r.plot === i); },
  /* 摆放：移动不收费；目标格有别的建筑就互换 */
  place(m, b, cell) {
    const H = m.home;
    if (!H.built[b] || (HOME_BUILDINGS[b] && HOME_BUILDINGS[b].fixed) || !(cell >= 0 && cell < HOME.plots)) return false;
    const other = Object.keys(H.plots).find((k) => k !== b && H.plots[k] === cell);
    if (other) H.plots[other] = H.plots[b] !== undefined ? H.plots[b] : Home.freePlot(m);
    H.plots[b] = cell; return true;
  },

  /* ---------- 资源保留：追踪中的项目 / 委托需要的先留着 ---------- */
  keepWood(m) { const H = m.home; let k = H.reserve || 0; if (!H.projects.windRoad && H.built.workshop) k = Math.max(k, HOME_PROJECTS.windRoad.cost.wood); return k; },
  keepGoods(m) { const H = m.home, n = H.npcs.merchant; let k = 0; if (H.built.shop && !H.events['commission:candy']) k = COMMISSIONS.candy.need.goods; if (n && n.job === 'side') k = Infinity; return k; },

  /* ---------- 世界项目 ---------- */
  projectState(m, pid) {
    const P = HOME_PROJECTS[pid], H = m.home;
    if (H.projects[pid]) return { done: true };
    if (!H.built[P.bld]) return { locked: true };
    const miss = Object.entries(P.cost).filter(([k, v]) => (H.res[k] || 0) < v).map(([k, v]) => ({ k, have: H.res[k] || 0, need: v }));
    return { ok: !miss.length, miss };
  },
  deliverProject(m, pid) {
    const st = Home.projectState(m, pid); if (!st.ok) return null;
    const P = HOME_PROJECTS[pid], H = m.home;
    for (const [k, v] of Object.entries(P.cost)) H.res[k] -= v;
    H.projects[pid] = Date.now(); H.events['project:' + pid] = H.projects[pid];
    if (pid === 'windRoad') Home.bond(m, 'grandpa');
    return { pid };
  },
  /* ---------- 商人的委托 ---------- */
  commissionState(m, cid) {
    const C = COMMISSIONS[cid], H = m.home;
    if (H.events['commission:' + cid]) return { done: true };
    if (!H.built.shop) return { locked: true };
    const have = H.res.goods, need = C.need.goods; return { ok: have >= need, have, need };
  },
  deliverCommission(m, cid) {
    const st = Home.commissionState(m, cid); if (!st.ok) return null;
    const C = COMMISSIONS[cid], H = m.home;
    H.res.goods -= C.need.goods; H.events['commission:' + cid] = Date.now();
    Home.bond(m, 'merchant');
    const pid = C.reward, had = !!m.planes[pid];
    if (!had) { m.planes[pid] = newPlaneRecord(pid); m.codex.planes[pid] = 1; } else m.tickets += 3; // 已经有了就换成招募券
    return { plane: pid, had };
  },

  /* ---------- 工作周期：按有效战斗时间推进，同一周期先加工再卖，只动真实库存 ---------- */
  work(m, seconds) {
    const H = m.home, log = [];
    H.work.t += Math.max(0, seconds || 0);
    let guard = 0;
    while (H.work.t >= HOME.cycle && guard++ < 20) { H.work.t -= HOME.cycle; Home.cycle(m, log); }
    H.work.last = log;
    return log;
  },
  cycle(m, log) {
    const H = m.home, g = H.npcs.grandpa, s = H.npcs.merchant;
    if (H.built.workshop && g && g.job === 'main' && H.res.wood - Home.keepWood(m) >= HOME.recipe) { H.res.wood -= HOME.recipe; H.res.goods += 1; log.push({ k: 'craft' }); }
    else if (H.built.workshop && g && g.job === 'main') log.push({ k: 'craftIdle', why: H.res.wood < HOME.recipe ? '梦木不够' : '梦木留给项目' });
    if (H.built.shop && s && s.job === 'main') for (const on of H.shelves) {
      if (!on) continue;
      if (H.res.goods - Home.keepGoods(m) >= 1) { H.res.goods -= 1; m.stardust += HOME.sell; log.push({ k: 'sell' }); }
    }
  },
  /* 职责：免费改；副职要成为“伙伴”后才开放；每次回家最多改一项 */
  canSetJob(m, id) { const H = m.home; return H.jobVisit !== H.visit || H.jobNpc === id; },
  setJob(m, id, job) {
    const H = m.home, n = H.npcs[id]; if (!n || n.job === job) return false;
    if (job === 'side' && n.stage < 1) return false;
    if (!Home.canSetJob(m, id)) return false;
    n.job = job; H.jobVisit = H.visit; H.jobNpc = id; return true;
  },
  recommend(m) { const H = m.home; for (const id of Object.keys(H.npcs)) H.npcs[id].job = 'main'; },

  /* ---------- 下一局：交给 World 的世界状态（多人时用房主的） ---------- */
  storyTarget(m) {
    if (!Home.rescued(m, 'bunny')) return 'bunny';
    if (!Home.rescued(m, 'grandpa')) return 'grandpa';
    if (m.home.projects.windRoad && !Home.rescued(m, 'merchant')) return 'merchant';
    return null;
  },
  worldFor(m) {
    const H = m.home, b = H.npcs.bunny, g = H.npcs.grandpa;
    return { upper: !!H.projects.windRoad, target: Home.storyTarget(m), rescued: Object.keys(m.progress.rescued || {}),
      clue: !!(b && b.job === 'main'), beacon: !!(b && b.job === 'side'), scout: !!(g && g.job === 'side') };
  },

  /* ---------- 当前目标：家园只突出一个（图标 + 地点 + 一个前置 + 会带来什么变化） ---------- */
  goal(m) {
    const H = m.home, P = m.progress;
    if (!Home.rescued(m, 'bunny')) return { key: 'bunny', npc: 'bunny', title: '救小梦兔', where: '1-1 · 航线中段的救援吊舱', change: '救援台开放，码头亮起来' };
    if (!Home.rescued(m, 'grandpa')) return { key: 'grandpa', npc: 'grandpa', title: '救云朵爷爷', where: '1-2 · 旧风塔附近的救援吊舱', change: '工坊开放' };
    if (!H.projects.windRoad) {
      const need = HOME_PROJECTS.windRoad.cost.wood, have = H.res.wood;
      return { key: 'windRoad', icon: 'n-repeat', title: '修风道', where: '工坊', need: `梦木 ${Math.min(have, need)}/${need}`, ready: have >= need, change: '风车塔多一个上层风圈', hint: have < need ? '风车塔、星砂矿、救援都会掉梦木' : '去工坊交付' };
    }
    if (!Home.rescued(m, 'merchant')) return { key: 'merchant', npc: 'merchant', title: '走上层云桥，救糖果商人', where: '任意一关 · 风车塔上方的风圈', change: '巡游店开放' };
    if (!H.events['commission:candy']) {
      const have = H.res.goods;
      return { key: 'candy', icon: 'i-gacha', title: '商人的委托', where: '巡游店', need: `货物 ${Math.min(have, 1)}/1`, ready: have >= 1, change: m.planes.candy ? '招募券 +3' : '得到糖果号', hint: have < 1 ? `工坊每 4 分钟有效战斗加工 1 件（${HOME.recipe} 梦木）` : '去巡游店交付' };
    }
    if (!P.cleared['1-3']) return { key: 'boss', icon: 'n-crown', title: '击败失控闹钟', where: '1-3 · 失眠钟塔', change: '第一章通关' };
    return { key: 'next', icon: 'i-starmap', title: '第二章：矿工与矿坊', where: '制作中', change: '' };
  },
  /* 家园和 HUD 共用：这个目标这一局能不能完成（HUD 只追踪当前目标） */
  runGoalText(m) {
    const g = Home.goal(m);
    if (g.key === 'bunny' || g.key === 'grandpa' || g.key === 'merchant') return `家园目标 · ${g.title}`;
    if (g.key === 'windRoad' && !g.ready) return '家园目标 · 带回梦木修风道';
    if (g.key === 'candy' && !g.ready) return '家园目标 · 有效战斗让工坊加工货物';
    return null;
  },
  /* 场景布局：网页按钮和画布共用同一套坐标（逻辑尺寸 W × 720） */
  layout(W) {
    const H = 720, x0 = W * 0.37, x1 = W * 0.85, cw = (x1 - x0) / HOME.cols, rows = [H * 0.5, H * 0.65], plots = [];
    for (let i = 0; i < HOME.plots; i++) { const c = i % HOME.cols, r = Math.floor(i / HOME.cols); plots.push({ x: x0 + cw * (c + 0.5) - (r ? cw * 0.2 : 0), y: rows[r], w: cw * 0.92, h: 80 }); }
    return { plots, dock: { x: W * 0.11, y: H * 0.63 }, hangar: { x: W * 0.27, y: H * 0.58 }, ruin: { x: W * 0.58, y: H * 0.27 }, tower: { x: W * 0.78, y: H * 0.29 } };
  },
};
