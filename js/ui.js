'use strict';
/* 梦潮：回声航线 v0.4 — 界面与流程：标题 → 机库大厅 →（召唤 / 机库 / 星盘 / 任务 / 外观 / 图鉴）→ 出发 → 一局 → 结算 + 下一局诱因卡。
   画布负责战斗与背景；所有菜单、HUD 都在 DOM 里。 */

const G = {
  meta: null, world: null, screen: null, bg: 'title', back: null,
  W: 1280, scale: 1, dpr: 1, sea: null, hub: null, map: null,
  paused: false, preview: null, cap: { sample: null, downloads: null },
  hudRefs: null, hudLast: {}, endShownAt: null, lastRes: null,
};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const DUST_RATE = 5; // 航行中飘出的星尘粒子很多，5 粒合成 1 颗可用星尘
const PORTAL_SYM = { skill: 'p-skill', rare: 'p-rare', wing: 'p-wing', bomb: 'p-bomb', chest: 'p-chest', heal: 'p-heal', boss: 'p-boss' };

/* ================================================== persistence & helpers ================================================== */
function persist() { Store.save(G.meta); }
function applySettings() {
  const s = G.meta.settings;
  Sound.configure(s); Input.setBinds(s.binds);
  document.documentElement.style.setProperty('--tb', (Math.max(G.scale, 0.62) * (s.bigButtons ? 1.25 : 1)).toFixed(3));
}
function showScreen(id, html, o = {}) {
  const host = $('#screens');
  host.innerHTML = `<div class="screen ${o.cls || ''}" id="scr-${id}" role="region" aria-label="${esc(o.label || id)}">${html}</div>`;
  G.screen = id; G.back = o.back || null; if (o.bg) G.bg = o.bg;
  const el = host.firstElementChild;
  $$('[data-back]', el).forEach((b) => b.addEventListener('click', () => { Sound.sfx('uiBack'); if (G.back) G.back(); }));
  paintPlaneCanvases(el);
  if (Input.keyboardNav) { const f = $('[autofocus]', el) || $('.btn.primary', el); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30); }
  return el;
}
function clearScreens() { $('#screens').innerHTML = ''; G.screen = null; G.back = null; }
function backBtn() { return `<button class="btn back-btn" data-back type="button" aria-label="返回">${icon('i-back')} 返回</button>`; }
function paintPlaneCanvases(root) {
  $$('canvas[data-plane]', root).forEach((c) => {
    const g = c.getContext('2d'), id = c.dataset.plane, big = c.width;
    g.clearRect(0, 0, c.width, c.height);
    if (c.dataset.glow) { const gr = g.createRadialGradient(big / 2, big / 2, 4, big / 2, big / 2, big / 2); gr.addColorStop(0, c.dataset.glow); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, big, big); }
    drawPlane(g, id, big * 0.52, big * 0.56, big / 80, 1.3, { happy: !!c.dataset.happy });
  });
}
function banner(title, sub, dur = 1.6, color) {
  const b = $('#banner');
  b.classList.remove('out'); b.style.setProperty('--bgc', color || 'rgba(255,201,74,.6)');
  b.innerHTML = `${title ? `<div class="bt">${esc(title)}</div>` : ''}${sub ? `<div class="bs">${esc(sub)}</div>` : ''}`;
  clearTimeout(banner._t); clearTimeout(banner._t2);
  banner._t = setTimeout(() => { b.classList.add('out'); banner._t2 = setTimeout(() => { b.innerHTML = ''; b.classList.remove('out'); }, 360); }, dur * 1000);
}
function toast(text, color, sym, ms = 2200) {
  const t = $('#toast'), d = document.createElement('div');
  if (color) d.style.setProperty('--tc', color);
  d.innerHTML = `${sym ? icon(sym) : ''}<span></span>`; d.lastChild.textContent = text; t.appendChild(d);
  setTimeout(() => d.remove(), ms);
  while (t.children.length > 3) t.firstElementChild.remove();
}
function curRow() {
  const m = G.meta;
  return `<div class="cur-row">
    <span class="cur" title="星尘：点亮星盘">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}<span class="num">${Math.floor(m.stardust)}</span></span>
    <span class="cur" title="梦灯券：召唤飞机">${icon('i-ticket').replace('class="ic"', 'class="ic" style="fill:#ffe38a"')}<span class="num">${m.tickets}</span></span>
    <span class="cur" title="天赋点：锁定幸运路线">${icon('i-talent').replace('class="ic"', 'class="ic" style="fill:#9ff2c8"')}<span class="num">${m.talent}</span></span>
    <span class="cur" title="外观票：解锁爆炸颜色与拖尾">${icon('i-cos').replace('class="ic"', 'class="ic" style="fill:#ff9fcf"')}<span class="num">${m.cosTickets}</span></span>
  </div>`;
}
function starsHtml(n) { return `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`; }
function rarityChip(r) { return `<span class="chip r-${r}">${r}</span>`; }

/* 菜单的手柄 / 方向键焦点导航 */
function navUpdate() {
  const scr = $('#screens .screen');
  for (const d of ['up', 'down', 'left', 'right']) if (Input.consumeNav(d)) moveFocus(scr, d);
  if (Input.consumeNav('ok')) { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && !a.disabled && scr && scr.contains(a)) a.click(); else if (G.screen === 'title') startFromTitle(); }
  if (Input.consumeNav('back') && G.back) { Sound.sfx('uiBack'); G.back(); }
}
function moveFocus(scr, dir) {
  if (!scr) return;
  const items = $$('button:not([disabled])', scr).filter((b) => b.offsetParent !== null);
  if (!items.length) return;
  const cur = document.activeElement;
  if (!cur || !scr.contains(cur)) { items[0].focus(); return; }
  const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bestS = 1e9;
  for (const b of items) {
    if (b === cur) continue;
    const r = b.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
    const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
    if (!ok) continue;
    const s = dir === 'up' || dir === 'down' ? Math.abs(dy) + Math.abs(dx) * 2.2 : Math.abs(dx) + Math.abs(dy) * 2.2;
    if (s < bestS) { bestS = s; best = b; }
  }
  if (best) { best.focus(); Sound.sfx('ui', { gap: 60 }); }
}

/* ================================================== tasks ================================================== */
function taskDef(id) { return TASK_POOL.find((t) => t.id === id); }
function ensureTasks() {
  const T = G.meta.tasks;
  for (const id of T.active) if (T.progress[id] === undefined) T.progress[id] = G.meta.stats[taskDef(id).stat] || 0;
}
function taskProgress(id) { const d = taskDef(id); return clamp((G.meta.stats[d.stat] || 0) - (G.meta.tasks.progress[id] || 0), 0, d.goal); }
function anyTaskReady() { return G.meta.tasks.active.some((id) => taskProgress(id) >= taskDef(id).goal); }
function claimTask(id) {
  const T = G.meta.tasks, d = taskDef(id);
  if (taskProgress(id) < d.goal) return;
  G.meta.tickets += d.reward; T.claimed++;
  const pool = TASK_POOL.filter((t) => !T.active.includes(t.id));
  const nx = pick(pool.length ? pool : TASK_POOL);
  T.active[T.active.indexOf(id)] = nx.id; T.progress[nx.id] = G.meta.stats[nx.stat] || 0; delete T.progress[id];
  Sound.sfx('select'); toast(`梦灯券 +${d.reward}`, '#ffe38a', 'i-ticket'); persist();
}

/* ================================================== TITLE ================================================== */
function showTitle() {
  Sound.setMode('title'); G.bg = 'title';
  const first = !G.meta.seenTitle;
  const el = showScreen('title', `
    <div class="corner-tr"><button class="icon-btn" id="t-sound" type="button" aria-label="声音开关">${icon(G.meta.settings.muted ? 'i-mute' : 'i-sound')}<span>${G.meta.settings.muted ? '静音' : '声音'}</span></button></div>
    <div class="title-block">
      <h1 class="title-main">梦<em>潮</em></h1>
      <p class="title-sub">回声航线</p>
      <p class="title-tag">${first ? '拖动飞机，按下爆发键，一键清屏。' : '梦灯还亮着。欢迎回来。'}</p>
      <p class="title-start">点击任意处开始</p>
    </div>
    <p class="title-foot">触屏 · 键鼠 · 手柄 &nbsp;|&nbsp; 进度保存在这台设备的浏览器里</p>`, { bg: 'title', label: '标题' });
  el.addEventListener('click', (e) => { if (e.target.closest('#t-sound')) return; startFromTitle(); });
  $('#t-sound', el).addEventListener('click', () => {
    Sound.init(); G.meta.settings.muted = !G.meta.settings.muted; applySettings(); persist();
    $('#t-sound', el).innerHTML = `${icon(G.meta.settings.muted ? 'i-mute' : 'i-sound')}<span>${G.meta.settings.muted ? '静音' : '声音'}</span>`;
  });
}
function startFromTitle() {
  if (G.screen !== 'title') return;
  Sound.init(); Sound.sfx('select'); Tele.log('title_start_click');
  G.meta.seenTitle = true; persist();
  // 第一次打开：直接进入首局（文档 §14 首局体验）；之后进入机库
  if (!G.meta.firstRunDone) startRun(); else showHub();
}

/* ================================================== HUB（机库大厅）================================================== */
function showHub() {
  Sound.setMode('hub'); G.world = null; Input.gameActive = false; hideHud(); stopPreview();
  ensureTasks();
  const m = G.meta, P = PLANES[m.current], rec = m.planes[m.current], L = m.nextHint;
  const el = showScreen('hub', `
    <div class="hub-left">
      <div class="panel"><div class="label">梦灯机库 · 失眠之海</div>${curRow()}</div>
      ${L ? `<div class="panel lure"><div class="label">下一局诱因卡</div>${lureRows(L)}</div>` : ''}
    </div>
    <div class="hub-side">
      <button class="icon-btn" id="hub-gacha" type="button">${icon('i-gacha')}<span>召唤</span>${m.tickets > 0 ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn" id="hub-planes" type="button">${icon('i-hangar')}<span>机库</span></button>
      <button class="icon-btn" id="hub-star" type="button">${icon('i-starmap')}<span>星盘</span>${nextStarCost(m.current) !== null && m.stardust >= nextStarCost(m.current) ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn" id="hub-tasks" type="button">${icon('i-task')}<span>任务</span>${anyTaskReady() ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn" id="hub-cos" type="button">${icon('i-cos')}<span>外观</span></button>
      <button class="icon-btn" id="hub-codex" type="button">${icon('i-book')}<span>图鉴</span></button>
      <button class="icon-btn" id="hub-records" type="button">${icon('i-trophy')}<span>记录</span></button>
      <button class="icon-btn" id="hub-settings" type="button">${icon('i-gear')}<span>设置</span></button>
    </div>
    <div class="hub-start">
      <div class="hub-plane">
        <div class="pname">${P.name} ${rarityChip(P.rarity)} ${starsHtml(rec.stars)}</div>
        <div class="row wrap" style="justify-content:center"><span class="chip gold">大招 · ${P.burst.name}</span><button class="btn small cyan" id="hub-preview" type="button">${icon('i-play')} 大招预览</button></div>
      </div>
      <button class="btn primary big" id="hub-go" type="button" autofocus>${icon('i-hangar')} 出发</button>
      <span class="dim-text" style="font-size:var(--fs-xs)">${m.lockRoute ? `下一局幸运路线已锁定：${ROUTES[m.lockRoute].name}` : '每局随机点亮一条幸运路线'}</span>
    </div>`, { bg: 'hub', label: '机库大厅' });
  $('#hub-go', el).onclick = () => { Sound.sfx('select'); startRun(); };
  $('#hub-preview', el).onclick = () => openPreview(m.current, showHub);
  $('#hub-gacha', el).onclick = () => { Sound.sfx('ui'); showGacha(showHub); };
  $('#hub-planes', el).onclick = () => { Sound.sfx('ui'); showPlanes(showHub); };
  $('#hub-star', el).onclick = () => { Sound.sfx('ui'); showStarMap(m.current, showHub); };
  $('#hub-tasks', el).onclick = () => { Sound.sfx('ui'); showTasks(showHub); };
  $('#hub-cos', el).onclick = () => { Sound.sfx('ui'); showCosmetics(showHub); };
  $('#hub-codex', el).onclick = () => { Sound.sfx('ui'); showCodex('planes', showHub); };
  $('#hub-records', el).onclick = () => { Sound.sfx('ui'); showRecords(showHub); };
  $('#hub-settings', el).onclick = () => { Sound.sfx('ui'); showSettings(showHub); };
}
function lureRows(L) {
  const bars = `<span>${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= L.lv ? 'on' : ''}"></i>`).join('')}</span>`;
  const route = L.route.map((t, i) => `${i ? icon('i-back', 'ic flip') : ''}<span class="picon" style="color:${PORTALS[t].color}" title="${PORTALS[t].name}">${icon(PORTAL_SYM[t])}</span>`).join('');
  return `<div class="lure-row"><span class="label">本局</span><span class="lure-bar"><b>${esc(L.stream)}</b>${bars}</span></div>
    <div class="lure-row"><span class="label">下一局</span><span>${esc(L.next)}</span></div>
    <div class="lure-row"><span class="label">推荐路线</span><span class="route-icons">${route}</span></div>`;
}

/* ================================================== RUN ================================================== */
function startRun() {
  ensureTasks();
  const m = G.meta, id = m.current;
  const lucky = m.lockRoute || pick(ROUTE_ORDER), locked = !!m.lockRoute;
  m.lockRoute = null;
  if (G.endShownAt) { const dt = (performance.now() - G.endShownAt) / 1000; m.telemetry.lastRestart = Math.round(dt * 10) / 10; G.endShownAt = null; }
  if (m.records.runs === 1) Tele.log('second_run_started');
  const first = !m.firstRunDone;
  m.records.runs++; Tele.log('run_started');
  applySettings(); clearScreens(); stopPreview();
  G.bg = 'world'; G.paused = false;
  G.world = new World({
    mode: 'run', W: G.W, plane: id, stats: planeStats(m, id, lucky), first, lucky, settings: m.settings, scene: G.sea, cos: m.cosmetics,
    cb: {
      onEnd: onRunEnd,
      onSkill: (sid) => { m.codex.skills[sid] = 1; },
      onSynergy: (key) => { m.codex.syns[key] = 1; },
      onSeenEnemy: (t) => { if (t) m.codex.enemies[t] = 1; },
      onPortal: (t) => { m.codex.portals[t] = 1; if (t === 'boss') m.codex.enemies.clock = 1; },
    },
  });
  Sound.setMode('combat'); Sound.setCardMods([]);
  Input.gameActive = true; Input.clearPresses();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  buildHud();
  banner(PLANES[id].name, `本局幸运路线：${ROUTES[lucky].name}${locked ? '（已锁定）' : ''}`, 1.6);
  persist();
}
function onRunEnd(res) {
  const m = G.meta, st = res.stats, first = !m.firstRunDone;
  const dust = Math.floor(st.dust / DUST_RATE) + (res.win ? 100 : 0) + (res.win && res.bossEarly ? 60 : 0);
  const tickets = 1 + (res.win ? 2 : 0) + (first ? 10 : 0), talent = st.talent, cos = res.win ? 1 : 0;
  const frags = Object.assign({}, st.frags);
  let bossFirst = false;
  if (res.win && !m.bossFirstClear) { frags.clock = (frags.clock || 0) + 40; m.bossFirstClear = true; bossFirst = true; }
  m.stardust += dust; m.tickets += tickets; m.talent += talent; m.cosTickets += cos;
  for (const k in frags) m.frags[k] = (m.frags[k] || 0) + frags[k];
  const S = m.stats;
  S.kills += st.kills; S.bursts += st.bursts; S.runs += 1; S.syns += st.syns; S.streak100 += st.streak100 ? 1 : 0; S.crystals += st.crystals; S.bossKills += res.win ? 1 : 0; S.lv5 += st.lv5 ? 1 : 0; S.chests += st.chests;
  const R = m.records;
  if (res.win) { R.clears++; if (!R.bestTime || res.runT < R.bestTime) R.bestTime = Math.round(res.runT); }
  R.bestStreak = Math.max(R.bestStreak, st.maxStreak); R.bestCrystals = Math.max(R.bestCrystals, st.crystals);
  Tele.log(res.win ? 'run_completed' : 'run_failed');
  if (first) Tele.log('first_run_ended');
  Tele.add('kills', st.kills); Tele.add('bursts', st.bursts); Tele.add('synergies', st.syns);
  const runs = m.telemetry.runs || (m.telemetry.runs = []);
  runs.push({ at: Date.now(), win: res.win, plane: res.plane, firstKill: st.firstKill, firstSkill: st.firstSkill, firstSyn: st.firstSyn, firstBurst: st.firstBurst, changes: st.crystals, highlights: st.highlights, avgKill: res.avgKill, gap: st.gapMax, runT: res.runT });
  while (runs.length > 30) runs.shift();
  m.firstRunDone = true;
  const lure = makeLure(res);
  m.nextHint = lure;
  persist();
  G.lastRes = { res, rewards: { dust, tickets, talent, cos, frags, bossFirst, newbie: first }, lure };
  showEnd(G.lastRes);
}
function nextStarCost(pid) {
  const rec = G.meta.planes[pid]; if (!rec) return null;
  let best = null;
  for (const r of ROUTE_ORDER) { const i = rec.lit[r]; if (i < rec.map[r].length) { const c = STAR_COST[i]; if (best === null || c < best) best = c; } }
  return best;
}
function makeLure(res) {
  const m = G.meta;
  const top = res.skills.slice().sort((a, b) => b.lv - a.lv)[0];
  const streamId = res.streamId || (top ? top.id : null);
  const stream = res.stream || (streamId ? `${SKILLS[streamId].stream}（未成型）` : '还没形成流派');
  const lv = streamId ? (res.skills.find((s) => s.id === streamId) || { lv: 0 }).lv : 0;
  let next;
  const unowned = PLANE_ORDER.filter((p) => !m.planes[p]);
  const exch = unowned.find((p) => (m.frags[p] || 0) >= RARITY[PLANES[p].rarity].unlockFrags);
  const cost = nextStarCost(m.current);
  if (exch) next = `碎片已集齐，可以兑换「${PLANES[exch].name}」专属大招「${PLANES[exch].burst.name}」`;
  else if (m.tickets >= 10) next = `梦灯券 ×${m.tickets}：十连召唤一架新飞机`;
  else if (m.tickets >= 1) next = `梦灯券 ×${m.tickets}：召唤新飞机，试试另一种大招`;
  else if (cost !== null && m.stardust >= cost) next = `星尘够点亮 ${PLANES[m.current].name} 的下一颗星`;
  else next = `下一局试试把「${streamId ? SKILLS[streamId].name : '雷球'}」升到 5 级`;
  const others = SKILL_ORDER.filter((s) => s !== streamId), tryId = Math.random() < 0.5 && streamId ? streamId : pick(others);
  const routes = { thunder: ['skill', 'rare', 'boss'], wing: ['wing', 'rare', 'boss'], bomb: ['bomb', 'rare', 'boss'], magnet: ['chest', 'skill', 'boss'], rainbow: ['rare', 'skill', 'boss'], ice: ['skill', 'rare', 'boss'] };
  return { stream, lv, next, route: routes[tryId], tryStream: SKILLS[tryId].stream };
}

/* ================================================== END（结算）================================================== */
function showEnd(E) {
  Input.gameActive = false; hideHud(); Sound.setMode('result');
  G.endShownAt = performance.now();
  const r = E.res, st = r.stats, rw = E.rewards, P = PLANES[r.plane];
  const fragTxt = Object.entries(rw.frags).map(([k, v]) => `${PLANES[k].name}碎片 +${v}`).join('、');
  const build = r.skills.length ? r.skills.map((s) => `<div class="row"><span class="chip" style="color:${SKILLS[s.id].color};border-color:${SKILLS[s.id].color}">${icon(SKILLS[s.id].icon)} ${SKILLS[s.id].name} Lv${s.lv}</span><span class="dim-text" style="font-size:var(--fs-xs)">${SKILLS[s.id].lv[s.lv - 1]}</span></div>`).join('') : '<span class="dim-text">这一局没有拾取技能晶体</span>';
  const syns = r.syns.map((k) => `<span class="chip gold">${SYNERGIES[k].name}</span>`).join(' ');
  const el = showScreen('end', `
    <div class="center-col">
      <div class="h-display" style="font-size:var(--fs-xl);color:${r.win ? 'var(--lamp2)' : 'var(--paper)'}">${r.win ? '清屏！失控闹钟停了下来' : r.abandoned ? '本局结束' : `${P.name}被击落了`}</div>
      <div class="dim-text">${r.win ? `航行 ${fmtTime(r.runT)} · Boss 战 ${fmtTime(r.bossTime)}${r.bossEarly ? ' · 提前进入 Boss，奖励提高' : ''}` : `航行 ${fmtTime(r.runT)} · 收集到的星尘和碎片全部保留`}</div>
      <div class="statrow">${[['击破', st.kills], ['最高连杀', st.maxStreak], ['技能变化', st.crystals], ['技能联动', st.syns], ['大招', st.bursts], ['爽点', st.highlights]].map(([k, v]) => `<div class="stat-pill"><span class="num">${v}</span><span>${k}</span></div>`).join('')}</div>
      <div class="rewards">
        <span class="reward">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}星尘 +${rw.dust}</span>
        <span class="reward">${icon('i-ticket').replace('class="ic"', 'class="ic" style="fill:#ffe38a"')}梦灯券 +${rw.tickets}${rw.newbie ? '（含新手礼 10）' : ''}</span>
        ${rw.talent ? `<span class="reward">${icon('i-talent').replace('class="ic"', 'class="ic" style="fill:#9ff2c8"')}天赋点 +${rw.talent}</span>` : ''}
        ${rw.cos ? `<span class="reward">${icon('i-cos').replace('class="ic"', 'class="ic" style="fill:#ff9fcf"')}外观票 +${rw.cos}</span>` : ''}
        ${fragTxt ? `<span class="reward">${icon('i-frag').replace('class="ic"', 'class="ic" style="fill:#aeeaff"')}${esc(fragTxt)}${rw.bossFirst ? '（首通奖励）' : ''}</span>` : ''}
      </div>
      <div class="end-grid">
        <div class="panel build-list"><div class="label">本局 Build ${r.stream ? `· <span style="color:var(--lamp2)">${esc(r.stream)}</span>` : ''}</div>${build}${syns ? `<div class="row wrap">${syns}</div>` : ''}</div>
        <div class="panel lure"><div class="label">下一局诱因卡</div>${lureRows(E.lure)}</div>
      </div>
      <div class="panel memory" id="dream-box" hidden><h4>梦灯航海日志</h4><div class="dream-out" id="dream-out"></div></div>
      <div class="row wrap" style="justify-content:center">
        <button class="btn" id="end-hub" type="button">${icon('i-hangar')} 返回机库</button>
        ${G.meta.tickets > 0 ? `<button class="btn cyan" id="end-gacha" type="button">${icon('i-gacha')} 去召唤（${G.meta.tickets} 券）</button>` : ''}
        <button class="btn primary" id="end-again" type="button" autofocus>${icon('i-play')} 再来一局</button>
        <button class="btn pink" id="end-dream" type="button" hidden>${icon('i-note')} 让梦灯写下这一局</button>
      </div>
    </div>`, { bg: 'world', cls: 'dim', label: r.win ? '胜利结算' : '失败结算' });
  $('#end-hub', el).onclick = () => { Sound.sfx('uiBack'); showHub(); };
  $('#end-again', el).onclick = () => { Sound.sfx('select'); startRun(); };
  const eg = $('#end-gacha', el); if (eg) eg.onclick = () => { Sound.sfx('ui'); showGacha(showHub); };
  setupDreamLog(el, E);
}
/* 可选：请 Claude 把这一局写成四行航海日志（sample capability；不可用时按钮不出现） */
function setupDreamLog(el, E) {
  const btn = $('#end-dream', el), box = $('#dream-box', el), out = $('#dream-out', el), sample = G.cap.sample;
  if (!sample) return;
  btn.hidden = false;
  let ctl = null;
  btn.onclick = async () => {
    if (ctl) { ctl.abort(); return; }
    const r = E.res, st = r.stats;
    const skills = r.skills.map((s) => `${SKILLS[s.id].name}${s.lv}级`).join('、') || '无';
    const syns = r.syns.map((k) => SYNERGIES[k].name).join('、') || '无';
    const prompt = `你是 HTML 小游戏《梦潮：回声航线》里的一架 Q 版梦境飞机「${PLANES[r.plane].name}」。请根据这一局的数据，用第一人称写 4 行中文短诗，明亮、爽快、带一点梦幻，像飞行日志。不要阿拉伯数字，不要标题，不要 Markdown，每行不超过 18 个字。\n` +
      `结果：${r.win ? '打败了失控闹钟，清屏' : '被击落了'}\n流派：${r.stream || '未成型'}；技能：${skills}；联动：${syns}\n击破${st.kills}，最高连杀${st.maxStreak}，大招${st.bursts}次，专属大招「${PLANES[r.plane].burst.name}」。`;
    ctl = new AbortController();
    box.hidden = false; out.textContent = '飞机正在想……'; btn.innerHTML = `${icon('i-pause')} 停止`;
    try {
      await sample(prompt, { signal: ctl.signal, modelTier: 'quick', cache: false, onText: ({ text }) => { out.textContent = text; } });
      btn.innerHTML = `${icon('i-note')} 再写一次`;
    } catch (e) {
      const code = e && e.code;
      if (e && e.text) out.textContent = e.text;
      if (code === 'cancelled') { if (!e.text) out.textContent = '（停下了）'; btn.innerHTML = `${icon('i-note')} 让梦灯写下这一局`; }
      else if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) { btn.hidden = true; if (!e.text) box.hidden = true; }
      else if (code === 'rate_limited') { out.textContent = (e.text || '') + '\n（有点累了，过一会儿再试）'; btn.innerHTML = `${icon('i-note')} 再试一次`; }
      else if (code === 'refused') { out.textContent = '（这一次没有写下来）'; btn.innerHTML = `${icon('i-note')} 再试一次`; }
      else { out.textContent = (e && e.text ? e.text + '\n' : '') + '（信号被梦雾打断了）'; btn.innerHTML = `${icon('i-note')} 再试一次`; }
    } finally { ctl = null; }
  };
}

/* ================================================== GACHA（梦灯召唤）================================================== */
function rollRarity() {
  const g = G.meta.gacha, bonus = Math.max(0, g.sinceHigh - GACHA.pityStart) * GACHA.pityStep;
  const ssr = RARITY.SSR.rate + bonus * 0.3, sr = RARITY.SR.rate + bonus * 0.7, r = RARITY.R.rate, x = Math.random();
  if (x < ssr) return 'SSR'; if (x < ssr + sr) return 'SR'; if (x < ssr + sr + r) return 'R'; return 'N';
}
function showGacha(back) {
  Sound.setMode('hub');
  const m = G.meta, g = m.gacha, pity = Math.max(0, g.sinceHigh - GACHA.pityStart) * GACHA.pityStep;
  const el = showScreen('gacha', `${backBtn()}
    <div class="screen-title"><h2>梦灯召唤</h2><p>重复飞机自动变成碎片，不会浪费</p></div>
    <div class="gacha-wrap">
      <div class="panel banner-card">
        <canvas width="360" height="360" data-plane="clock" data-glow="rgba(255,215,106,0.55)"></canvas>
        <span class="chip r-SSR" style="position:relative;align-self:flex-start">本期招牌 · SSR</span>
        <h3>闹钟号 · 时间暂停</h3>
        <p>时间暂停 2 秒，全屏敌人被标记，恢复时一起爆开。面对失控闹钟时，它的指针也会停下。</p>
      </div>
      <div class="gacha-side">
        <div class="panel" style="padding:calc(14px*var(--u));display:flex;flex-direction:column;gap:10px">
          ${curRow()}
          <div class="row wrap">
            <button class="btn primary" id="g-1" type="button" ${m.tickets < 1 ? 'disabled' : ''}>${icon('i-ticket')} 单抽 · 1 券</button>
            <button class="btn primary" id="g-10" type="button" ${m.tickets < 10 ? 'disabled' : ''} autofocus>${icon('i-ticket')} 十连 · 10 券</button>
          </div>
          <div class="dim-text" style="font-size:var(--fs-xs);line-height:1.6">十连必出 R 或以上 · 连续 ${GACHA.pityStart} 次没出 SR 以上后概率逐次提高（当前 +${Math.round(pity * 100)}%）${g.newbieDone ? '' : ` · 新手前 ${GACHA.newbiePulls} 次内必得一架完整 R 飞机`}</div>
          <div class="rates">${['N', 'R', 'SR', 'SSR'].map((r) => `<div><span class="chip r-${r}">${r}</span><div class="num" style="margin-top:4px">${Math.round((RARITY[r].rate + (r === 'SSR' ? pity * 0.3 : r === 'SR' ? pity * 0.7 : 0)) * 1000) / 10}%</div></div>`).join('')}</div>
          <div class="dim-text" style="font-size:var(--fs-xs)">梦灯券来自：完成一局、任务、击败 Boss。</div>
        </div>
        <div class="panel" style="padding:calc(12px*var(--u))"><div class="label">飞机池</div><div class="row wrap" style="margin-top:6px">${PLANE_ORDER.map((p) => `<span class="chip r-${PLANES[p].rarity}">${PLANES[p].name}${m.planes[p] ? ' ✓' : ''}</span>`).join('')}</div></div>
      </div>
    </div>`, { bg: 'hub', back, label: '召唤' });
  $('#g-1', el).onclick = () => doPull(1, back);
  $('#g-10', el).onclick = () => doPull(10, back);
}
function doPull(n, back) {
  const m = G.meta;
  if (m.tickets < n) { Sound.sfx('denied'); return; }
  m.tickets -= n;
  const res = [];
  for (let i = 0; i < n; i++) {
    m.gacha.pulls++;
    let r = rollRarity();
    if (n === 10 && i === 9 && r === 'N' && !res.some((x) => x.r !== 'N')) r = 'R';
    let pid = pick(PLANE_ORDER.filter((p) => PLANES[p].rarity === r));
    if (!m.gacha.newbieDone && m.gacha.pulls >= GACHA.newbiePulls && !res.some((x) => x.isNew && x.r !== 'N')) {
      const cand = PLANE_ORDER.filter((p) => PLANES[p].rarity === 'R' && !m.planes[p]);
      if (cand.length) { pid = pick(cand); r = 'R'; }
    }
    let item;
    if (m.planes[pid]) { const f = RARITY[r].dupFrags; m.frags[pid] = (m.frags[pid] || 0) + f; item = { pid, r, frags: f }; }
    else { m.planes[pid] = newPlaneRecord(pid); m.codex.planes[pid] = 1; item = { pid, r, isNew: true }; if (r !== 'N') m.gacha.newbieDone = true; }
    if (r === 'SR' || r === 'SSR') m.gacha.sinceHigh = 0; else m.gacha.sinceHigh++;
    res.push(item);
  }
  Tele.log('gacha_pull', { n }); persist();
  Sound.sfx('gachaRoll');
  setTimeout(() => showReveal(res, 0, back), 700);
}
function showReveal(res, i, back) {
  if (i >= res.length) return res.length > 1 ? showRevealSummary(res, back) : showGacha(back);
  const it = res[i], P = PLANES[it.pid], R = RARITY[it.r];
  Sound.sfx('reveal', { r: it.r });
  const el = showScreen('reveal', `
    <div class="reveal-card" style="--rc:${R.color};--rg:${R.glow}">
      ${it.isNew ? '<span class="newbadge">NEW!</span>' : ''}
      <canvas width="420" height="420" data-plane="${it.pid}" data-glow="${R.glow}" data-happy="1"></canvas>
      <div class="row">${rarityChip(it.r)}<span class="dim-text">${P.look}</span></div>
      <h3>${P.name}</h3>
      <div class="burst-name">专属大招 · ${P.burst.name}</div>
      <div class="dim-text" style="font-size:var(--fs-s);max-width:36em">${P.burst.desc}</div>
      ${it.isNew ? '' : `<div class="chip cyan">${icon('i-frag')} 已拥有，转为 ${P.name}碎片 +${it.frags}</div>`}
    </div>
    <div class="row wrap" style="justify-content:center">
      <button class="btn cyan" id="rv-prev" type="button">${icon('i-play')} 大招预览</button>
      <button class="btn" id="rv-go" type="button">立即出战</button>
      <button class="btn primary" id="rv-next" type="button" autofocus>${i + 1 < res.length ? `下一个（${i + 1}/${res.length}）` : '完成'}</button>
    </div>`, { bg: 'hub', cls: 'dim', label: '召唤结果', back: () => showReveal(res, i + 1, back) });
  $('#rv-next', el).onclick = () => { Sound.sfx('card'); showReveal(res, i + 1, back); };
  $('#rv-go', el).onclick = () => { G.meta.current = it.pid; persist(); Sound.sfx('select'); startRun(); };
  $('#rv-prev', el).onclick = () => openPreview(it.pid, () => showReveal(res, i, back));
}
function showRevealSummary(res, back) {
  const el = showScreen('reveal', `
    <div class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">召唤结果</div>
    <div class="reveal-sum">${res.map((it) => `<div class="mini" style="--rc:${RARITY[it.r].color}"><canvas width="120" height="120" data-plane="${it.pid}"></canvas>${rarityChip(it.r)}<span>${it.isNew ? 'NEW' : `+${it.frags} 碎片`}</span></div>`).join('')}</div>
    <div class="row wrap" style="justify-content:center"><button class="btn" id="rs-planes" type="button">${icon('i-hangar')} 去机库</button><button class="btn primary" id="rs-back" type="button" autofocus>完成</button></div>`, { bg: 'hub', cls: 'dim', label: '召唤结果', back: () => showGacha(back) });
  $('#rs-back', el).onclick = () => showGacha(back);
  $('#rs-planes', el).onclick = () => showPlanes(back);
}

/* ================================================== PLANES（机库 / 升星 / 碎片兑换）================================================== */
function showPlanes(back, sel) {
  Sound.setMode('hub');
  const m = G.meta; sel = sel || m.current;
  const P = PLANES[sel], rec = m.planes[sel], frags = m.frags[sel] || 0, R = RARITY[P.rarity];
  const next = rec ? STAR_UP[rec.stars + 1] : null;
  const card = (id) => {
    const Q = PLANES[id], own = m.planes[id], f = m.frags[id] || 0, need = RARITY[Q.rarity].unlockFrags;
    return `<button class="pcard ${id === sel ? 'sel' : ''} ${own ? '' : 'locked'}" data-p="${id}" type="button">
      ${id === m.current ? '<span class="chip gold using">出战中</span>' : ''}
      <canvas width="160" height="160" data-plane="${id}"></canvas>
      <span class="pn">${own ? Q.name : '？？？'}</span>
      <span class="row" style="gap:4px">${rarityChip(Q.rarity)}${own ? starsHtml(own.stars) : ''}</span>
      ${own ? '' : `<span class="bar-mini" title="碎片 ${f}/${need}"><i style="width:${Math.min(100, (f / need) * 100)}%"></i></span><span class="tagline">碎片 ${f}/${need}</span>`}
    </button>`;
  };
  const el = showScreen('planes', `${backBtn()}
    <div class="screen-title"><h2>机库</h2><p>不装备、不配件：每架飞机自带大招、被动和星盘</p></div>
    <div class="planes-wrap">
      <div class="plane-grid">${PLANE_ORDER.map(card).join('')}</div>
      <div class="panel pdetail">
        <h3>${rec ? P.name : '？？？'} ${rarityChip(P.rarity)} ${rec ? starsHtml(rec.stars) : ''}</h3>
        <p class="dim-text">${P.look} · 基础攻击：${P.shot} · 生命 ${P.hearts}</p>
        <div class="sec"><b>专属大招 · ${P.burst.name}</b><br>${P.burst.desc}</div>
        <div class="sec"><b>基础被动 · ${P.passive.name}</b><br>${P.passive.desc}${P.special ? `<br><span style="color:var(--lamp2)">${P.special}</span>` : ''}</div>
        <div class="starlist">${[2, 3, 4, 5].map((s) => `<span class="${rec && rec.stars >= s ? 'ok' : ''}">${'★'.repeat(s)} ${s === 3 ? `解锁第二段大招联动：${P.star3}` : STAR_UP[s].gain}${rec && rec.stars >= s ? ' ✓' : ''}</span>`).join('')}</div>
        <div class="row wrap">
          ${rec ? `${sel !== m.current ? `<button class="btn primary" id="pd-use" type="button">设为出战</button>` : ''}
            ${next ? `<button class="btn" id="pd-star" type="button" ${frags < next.cost ? 'disabled' : ''}>${icon('i-frag')} 升星（碎片 ${frags}/${next.cost}）</button>` : '<span class="chip gold">已满星</span>'}
            <button class="btn" id="pd-map" type="button">${icon('i-starmap')} 星盘</button>`
          : `<button class="btn primary" id="pd-ex" type="button" ${frags < R.unlockFrags ? 'disabled' : ''}>${icon('i-frag')} 碎片兑换（${frags}/${R.unlockFrags}）</button>`}
          <button class="btn cyan" id="pd-prev" type="button">${icon('i-play')} 大招预览</button>
        </div>
        ${rec ? '' : '<p class="dim-text" style="font-size:var(--fs-xs)">获得方式：召唤；宝箱洞和 Boss 首通会掉落指定飞机碎片。</p>'}
      </div>
    </div>`, { bg: 'hub', back, label: '机库' });
  $$('[data-p]', el).forEach((b) => b.onclick = () => { Sound.sfx('card'); showPlanes(back, b.dataset.p); });
  const use = $('#pd-use', el); if (use) use.onclick = () => { m.current = sel; persist(); Sound.sfx('select'); toast(`${P.name} 出战`, '#ffe38a'); showPlanes(back, sel); };
  const star = $('#pd-star', el); if (star) star.onclick = () => {
    const nx = STAR_UP[rec.stars + 1]; if (!nx || (m.frags[sel] || 0) < nx.cost) return;
    m.frags[sel] -= nx.cost; rec.stars++;
    let extra = ''; if (rec.stars === 4) { const r = addStarNode(rec); extra = `，${ROUTES[r].name}路线多了一颗星`; }
    persist(); Sound.sfx('levelup'); banner(`${P.name} 升到 ${rec.stars} 星`, (rec.stars === 3 ? P.star3 : STAR_UP[rec.stars].gain) + extra, 1.8);
    showPlanes(back, sel);
  };
  const map = $('#pd-map', el); if (map) map.onclick = () => showStarMap(sel, () => showPlanes(back, sel));
  const ex = $('#pd-ex', el); if (ex) ex.onclick = () => {
    if ((m.frags[sel] || 0) < R.unlockFrags) return;
    m.frags[sel] -= R.unlockFrags; m.planes[sel] = newPlaneRecord(sel); m.codex.planes[sel] = 1;
    persist(); Sound.sfx('reveal', { r: P.rarity }); banner(`获得 ${P.name}`, `专属大招 · ${P.burst.name}`, 1.8); showPlanes(back, sel);
  };
  $('#pd-prev', el).onclick = () => openPreview(sel, () => showPlanes(back, sel));
}

/* ================================================== STAR MAP（随机天赋星盘）================================================== */
function showStarMap(pid, back) {
  Sound.setMode('hub');
  const m = G.meta, rec = m.planes[pid], P = PLANES[pid];
  if (!rec) return showPlanes(back, pid);
  const stats = planeStats(m, pid, null).raw;
  // 四条星路各占一行：从左往右依次点亮；每一行一种颜色（上 / 左 / 右 / 下 四个方向在这里排成四行，手机横屏也放得下）
  let rows = '';
  for (const r of ROUTE_ORDER) {
    const list = rec.map[r], lit = rec.lit[r], R = ROUTES[r];
    const nodes = list.map((n, i) => {
      const T = NODE_TYPES[n.type], cls = i < lit ? 'lit' : i === lit ? 'next' : '';
      return `<button class="snode ${cls}" type="button" data-r="${r}" data-i="${i}" ${cls === 'next' ? '' : 'tabindex="-1"'} title="${T.fmt(n.v)}" aria-label="${R.name} 第 ${i + 1} 颗：${T.fmt(n.v)}">${icon(T.icon)}<small>${i === lit ? `${STAR_COST[i]} 星尘` : i < lit ? (T.max > 1 ? `+${n.v}%` : '+1') : T.name}</small></button>`;
    }).join('');
    const pct = list.length > 1 ? Math.min(1, Math.max(0, lit - 1) / (list.length - 1)) * 100 : 0;
    rows += `<div class="srow" style="--rc:${R.color}"><span class="route-label">${icon(R.icon)}${R.name}${m.lockRoute === r ? '<em>已锁定</em>' : ''}</span><div class="strack"><i class="strack-lit" style="width:${lit ? pct : 0}%"></i>${nodes}</div></div>`;
  }
  const eff = [['普通攻击伤害', `+${stats.dmg}%`], ['爆炸范围', `+${stats.blast}%`], ['大招充能', `+${stats.charge}%`], ['吸附范围', `+${stats.magnet}%`], ['技能重复', `${stats.repeat}%`], ['开局分身', `+${stats.wing}`], ['最大生命', `+${stats.heart}`], ['Boss 伤害', `+${stats.boss}%`]];
  const el = showScreen('star', `${backBtn()}
    <div class="screen-title"><h2>${P.name} · 星盘</h2><p>点亮一个大图标，立刻获得收益。节点只有正向效果。</p></div>
    <div class="smap-wrap">
      <div class="panel smap">${rows}</div>
      <div class="panel smap-side">
        ${curRow()}
        <h3>当前星盘收益</h3>
        <div class="effect-list">${eff.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
        <h3>下一局幸运路线</h3>
        <p class="dim-text" style="margin:0;font-size:var(--fs-xs);line-height:1.6">每局开始随机点亮一条路线的下一颗星（本局有效）。花 1 天赋点可以锁定你想要的路线。</p>
        <div class="row wrap">${ROUTE_ORDER.map((r) => `<button class="btn small ${m.lockRoute === r ? 'primary' : ''}" data-lock="${r}" type="button" style="border-color:${ROUTES[r].color}" ${m.lockRoute === r ? 'disabled' : ''}>${m.lockRoute === r ? '已锁定 · ' : ''}${ROUTES[r].name}</button>`).join('')}</div>
      </div>
    </div>`, { bg: 'map', back, label: '星盘' });
  $$('.snode.next', el).forEach((b) => b.onclick = () => {
    const r = b.dataset.r, i = +b.dataset.i, cost = STAR_COST[i], n = rec.map[r][i];
    if (m.stardust < cost) { Sound.sfx('denied'); toast(`星尘不足：还差 ${Math.ceil(cost - m.stardust)}`, '#dcc8ff', 'i-dust'); return; }
    m.stardust -= cost; rec.lit[r]++; persist();
    Sound.sfx('starLight'); toast(NODE_TYPES[n.type].fmt(n.v), ROUTES[r].color, NODE_TYPES[n.type].icon);
    showStarMap(pid, back);
  });
  $$('[data-lock]', el).forEach((b) => b.onclick = () => {
    if (m.talent < 1) { Sound.sfx('denied'); toast('天赋点不足：宝箱洞里的宝箱会掉天赋点', '#9ff2c8', 'i-talent'); return; }
    m.talent -= 1; m.lockRoute = b.dataset.lock; persist(); Sound.sfx('select'); showStarMap(pid, back);
  });
}

/* ================================================== TASKS / COSMETICS ================================================== */
function showTasks(back) {
  ensureTasks();
  const T = G.meta.tasks;
  const el = showScreen('tasks', `${backBtn()}
    <div class="screen-title"><h2>活动任务</h2><p>完成后领取梦灯券；领完会补上新任务</p></div>
    <div class="grid-cards">${T.active.map((id) => { const d = taskDef(id), p = taskProgress(id), done = p >= d.goal; return `<div class="panel task"><h3>${d.name}</h3><div class="bar-mini"><i style="width:${(p / d.goal) * 100}%"></i></div><div class="row"><span class="num">${p}/${d.goal}</span><span class="spacer"></span><span class="chip gold">${icon('i-ticket')} ×${d.reward}</span></div><button class="btn ${done ? 'primary' : ''} small" data-claim="${id}" type="button" ${done ? '' : 'disabled'}>${done ? '领取' : '进行中'}</button></div>`; }).join('')}</div>
    <p class="dim-text" style="font-size:var(--fs-xs);margin-top:12px">已领取 ${T.claimed} 次。${curRow()}</p>`, { bg: 'hub', back, label: '任务' });
  $$('[data-claim]', el).forEach((b) => b.onclick = () => { claimTask(b.dataset.claim); showTasks(back); });
}
function showCosmetics(back) {
  const m = G.meta, C = m.cosmetics;
  const item = (kind, c) => {
    const key = `${kind}:${c.id}`, own = C.owned.includes(key), on = C[kind] === c.id;
    const cols = c.colors || (kind === 'exp' ? PLANES[m.current].colors.exp : []);
    return `<div class="panel cos"><b style="font-family:var(--f-display);font-weight:400;font-size:var(--fs-m)">${c.name}</b><span class="swatch">${cols.map((x) => `<i style="background:${x}"></i>`).join('')}</span>
      ${on ? '<span class="chip gold">使用中</span>' : own ? `<button class="btn small" data-eq="${key}" type="button">使用</button>` : `<button class="btn small primary" data-buy="${key}" type="button" ${m.cosTickets < c.cost ? 'disabled' : ''}>${icon('i-cos')} ${c.cost} 张解锁</button>`}</div>`;
  };
  const el = showScreen('cos', `${backBtn()}
    <div class="screen-title"><h2>外观</h2><p>外观票来自击败 Boss。只改变颜色和演出，不改变强度。</p></div>
    ${curRow()}
    <div class="label" style="margin:12px 0 6px">爆炸颜色</div><div class="grid-cards">${COSMETICS.exp.map((c) => item('exp', c)).join('')}</div>
    <div class="label" style="margin:12px 0 6px">飞行拖尾</div><div class="grid-cards">${COSMETICS.trail.map((c) => item('trail', c)).join('')}</div>`, { bg: 'hub', back, label: '外观' });
  $$('[data-eq]', el).forEach((b) => b.onclick = () => { const [k, id] = b.dataset.eq.split(':'); C[k] = id; persist(); Sound.sfx('select'); showCosmetics(back); });
  $$('[data-buy]', el).forEach((b) => b.onclick = () => { const [k, id] = b.dataset.buy.split(':'), c = COSMETICS[k].find((x) => x.id === id); if (m.cosTickets < c.cost) return; m.cosTickets -= c.cost; C.owned.push(b.dataset.buy); C[k] = id; persist(); Sound.sfx('levelup'); showCosmetics(back); });
}

/* ================================================== CODEX ================================================== */
function showCodex(tab, back) {
  const m = G.meta;
  const tabs = [['planes', '飞机'], ['skills', '技能'], ['syns', '联动'], ['portals', '洞口'], ['enemies', '敌人']];
  let body = '';
  if (tab === 'planes') body = PLANE_ORDER.map((id) => { const P = PLANES[id], own = m.planes[id]; return `<div class="panel cx ${own ? '' : 'unknown'}"><canvas width="120" height="120" data-plane="${id}"></canvas><div><h3>${own ? P.name : '？？？'} ${rarityChip(P.rarity)}</h3><p>${own ? `${P.look}。大招「${P.burst.name}」：${P.burst.desc}` : '召唤或集齐碎片后解锁。'}</p>${own ? `<p>被动「${P.passive.name}」：${P.passive.desc}</p>` : ''}</div></div>`; }).join('');
  else if (tab === 'skills') body = SKILL_ORDER.map((id) => { const S = SKILLS[id], seen = m.codex.skills[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi" style="color:${S.color}">${icon(S.icon).replace('class="ic"', `class="ic" style="fill:${S.color}"`)}</div><div><h3>${S.name} · ${S.stream}</h3>${S.lv.map((t, i) => `<p>${i + 1} 级：${t}</p>`).join('')}<p style="color:var(--lamp2)">改造大招：${S.burstMod}</p></div></div>`; }).join('');
  else if (tab === 'syns') body = Object.entries(SYNERGIES).map(([k, v]) => { const [a, b] = k.split('+'), seen = m.codex.syns[k]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi">${icon(SKILLS[a].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[a].color};width:40%;height:40%"`)}${icon(SKILLS[b].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[b].color};width:40%;height:40%"`)}</div><div><h3>${seen ? v.name : '？？？'}</h3><p>${SKILLS[a].name} + ${SKILLS[b].name}：两者合计 3 级自动触发</p><p>${seen ? v.desc : '触发一次后记录。'}</p></div></div>`; }).join('') + '<div class="panel cx"><div class="cxi">' + icon('p-boss').replace('class="ic"', 'class="ic" style="fill:#ff5a6e"') + '</div><div><h3>Boss 标记 + 大招</h3><p>Boss 战里，大招和追踪弹优先锁定 Boss 核心。</p></div></div>';
  else if (tab === 'portals') body = Object.values(PORTALS).map((P) => `<div class="panel cx ${m.codex.portals[P.id] || P.id === 'skill' || P.id === 'rare' ? '' : 'unknown'}"><div class="cxi">${icon(PORTAL_SYM[P.id]).replace('class="ic"', `class="ic" style="fill:${P.color}"`)}</div><div><h3>${P.name}</h3><p>${P.effect}</p></div></div>`).join('');
  else body = Object.entries(ENEMY_INFO).map(([id, e]) => { const seen = m.codex.enemies[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="120" height="120" data-enemy="${id}"></canvas><div><h3>${seen ? e.name : '？？？'}</h3><p>${seen ? e.desc : '在航线上遇见后记录。'}</p></div></div>`; }).join('');
  const el = showScreen('codex', `${backBtn()}
    <div class="screen-title"><h2>图鉴</h2><p>飞机、技能、联动、洞口、敌人</p></div>
    <div class="tabs" role="tablist">${tabs.map(([id, n]) => `<button class="tab ${id === tab ? 'on' : ''}" data-tab="${id}" role="tab" aria-selected="${id === tab}" type="button">${n}</button>`).join('')}</div>
    <div class="grid-cards">${body}</div>`, { bg: 'hub', back, label: '图鉴' });
  $$('[data-tab]', el).forEach((b) => b.onclick = () => { Sound.sfx('ui'); showCodex(b.dataset.tab, back); });
  $$('canvas[data-enemy]', el).forEach((c) => { if (m.codex.enemies[c.dataset.enemy]) paintEnemyIcon(c, c.dataset.enemy === 'mirror' ? 'clock' : c.dataset.enemy); });
}

/* ================================================== RECORDS（记录 + 数据验收）================================================== */
function showRecords(back) {
  const m = G.meta, R = m.records, runs = m.telemetry.runs || [], c = m.telemetry.counts;
  const last = runs[runs.length - 1];
  const avg = (k) => { const v = runs.map((r) => r[k]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const val = { firstKill: [last && last.firstKill, avg('firstKill')], firstSkill: [last && last.firstSkill, avg('firstSkill')], firstSyn: [last && last.firstSyn, avg('firstSyn')], firstBurst: [last && last.firstBurst, avg('firstBurst')], changes: [last && last.changes, avg('changes')], highlights: [last && last.highlights, avg('highlights')], avgKill: [last && last.avgKill, avg('avgKill')], gap: [last && last.gap, avg('gap')], restart: [m.telemetry.lastRestart, null], second: [c.first_run_ended ? Math.round(((c.second_run_started || 0) / c.first_run_ended) * 100) : null, null] };
  const fmt = (v, u) => (v === null || v === undefined ? '—' : (Math.round(v * 10) / 10) + (u === '%' ? '%' : u === '秒' ? ' 秒' : ' 次'));
  const judge = (v, T) => (v === null || v === undefined ? '' : (T.cmp === 'le' ? v <= T.target : v >= T.target) ? 'ok' : 'bad');
  const el = showScreen('records', `${backBtn()}
    <div class="screen-title"><h2>记录</h2><p>数据只来自这台设备</p></div>
    <div class="set-wrap">
      <div class="panel set-sec"><h3>航行记录</h3><table class="metrics"><tbody>
        <tr><th>出航次数</th><td class="num">${R.runs}</td></tr><tr><th>击败失控闹钟</th><td class="num">${R.clears}</td></tr>
        <tr><th>最高连杀</th><td class="num">${R.bestStreak}</td></tr><tr><th>最快通关</th><td class="num">${R.bestTime ? fmtTime(R.bestTime) : '—'}</td></tr>
        <tr><th>单局最多技能晶体</th><td class="num">${R.bestCrystals}</td></tr><tr><th>召唤次数</th><td class="num">${m.gacha.pulls}</td></tr>
        <tr><th>拥有飞机</th><td class="num">${Object.keys(m.planes).length}/${PLANE_ORDER.length}</td></tr>
      </tbody></table></div>
      <div class="panel set-sec"><h3>数据验收（文档 §16）</h3><table class="metrics"><thead><tr><th>指标</th><th>最近一局</th><th>平均</th><th>目标</th></tr></thead><tbody>
        ${METRIC_TARGETS.map((T) => { const [a, b] = val[T.id]; return `<tr><td>${T.name}</td><td class="num ${judge(a, T)}">${fmt(a, T.unit)}</td><td class="num ${judge(b, T)}">${fmt(b, T.unit)}</td><td>${T.cmp === 'le' ? '≤' : '≥'}${T.target}${T.unit === '%' ? '%' : T.unit === '秒' ? ' 秒' : ' 次'}</td></tr>`; }).join('')}
      </tbody></table><p class="dim-text" style="font-size:var(--fs-xs);margin:0">失败后重开时间：从结算页出现到点「再来一局」。第二局点击率：打完第一局后开始第二局的比例。</p></div>
      <div class="panel set-sec"><h3>埋点计数</h3><table class="metrics"><tbody>${Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('') || '<tr><td>还没有数据</td></tr>'}</tbody></table>
        <button class="btn" id="rec-export" type="button" hidden>${icon('i-trophy')} 导出测试数据（JSON）</button></div>
    </div>`, { bg: 'hub', back, label: '记录' });
  const dl = G.cap.downloads, btn = $('#rec-export', el);
  if (dl) {
    btn.hidden = false;
    btn.onclick = async () => {
      const data = JSON.stringify({ game: '梦潮：回声航线', version: 'v0.4', exportedAt: new Date().toISOString(), records: m.records, stats: m.stats, telemetry: m.telemetry }, null, 2);
      try { await dl.save({ filename: 'dreamtide-playtest.json', data }); toast('已导出'); }
      catch (e) { const code = e && e.code; if (code === 'declined') toast('已取消导出'); else if (code === 'rate_limited') toast('稍等一下再试'); else { btn.hidden = true; toast('这里暂时不能导出文件'); } }
    };
  }
}

/* ================================================== SETTINGS ================================================== */
function showSettings(back) {
  const s = G.meta.settings;
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, n]) => `<button type="button" data-seg="${key}" data-v="${v}" class="${s[key] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const tog = (key, name, sub) => `<div class="opt"><span>${name}${sub ? `<small>${sub}</small>` : ''}</span><button type="button" class="tog ${s[key] ? 'on' : ''}" data-tog="${key}" role="switch" aria-checked="${!!s[key]}" aria-label="${name}"></button></div>`;
  const binds = ['burst', 'up', 'down', 'left', 'right', 'focus', 'pause'].map((a) => `<div class="opt"><span>${Input.ACTION_NAMES[a]}</span><button type="button" class="bind" data-bind="${a}">${Input.keyLabel(Input.binds[a][0])}</button></div>`).join('');
  const el = showScreen('settings', `${backBtn()}
    <div class="screen-title"><h2>设置</h2><p>操作只有两个：拖动飞机、按爆发键</p></div>
    <div class="set-wrap">
      <div class="panel set-sec"><h3>操作</h3>
        <div class="opt"><span>拖动灵敏度<small>手指 / 鼠标拖动的距离 × 这个倍率</small></span><input type="range" id="set-drag" min="0.6" max="1.8" step="0.1" value="${s.dragSens}" aria-label="拖动灵敏度"></div>
        ${tog('bigButtons', '放大爆发按钮')}
        ${tog('showHitbox', '显示碰撞核心', '飞机中间的小白点才是受击范围')}
        <p class="dim-text" style="font-size:var(--fs-xs);margin:0">手机：按住屏幕任意处拖动；点右下角头像或双击屏幕释放大招。手柄：左摇杆 + 任意主按钮。</p>
      </div>
      <div class="panel set-sec"><h3>画面</h3>
        ${tog('shake', '屏幕震动')}${tog('reduceFlash', '减少闪烁')}${tog('colorblind', '色弱模式', '敌方子弹多一个内部符号')}
        <div class="opt"><span>特效<small>精简 = 低特效模式，保留关键反馈</small></span>${seg('particles', [['full', '完整'], ['low', '精简']])}</div>
      </div>
      <div class="panel set-sec"><h3>声音</h3>
        <div class="opt"><span>音乐</span><input type="range" id="set-music" min="0" max="1" step="0.05" value="${s.music}" aria-label="音乐音量"></div>
        <div class="opt"><span>音效</span><input type="range" id="set-sfx" min="0" max="1" step="0.05" value="${s.sfx}" aria-label="音效音量"></div>
        ${tog('muted', '静音')}
      </div>
      <div class="panel set-sec"><h3>按键（点一下再按新键，Esc 取消）</h3>${binds}<button class="btn small" id="set-resetkeys" type="button">恢复默认按键</button></div>
      <div class="panel set-sec"><h3>存档</h3>
        <p class="dim-text" style="font-size:var(--fs-xs);margin:0">进度只存在这台设备的浏览器里${Store.ok ? '' : '（当前浏览器拒绝了本地存储，关掉页面后进度不会保留）'}。</p>
        <button class="btn coral" id="set-wipe" type="button">清除全部存档</button>
      </div>
    </div>`, { bg: G.world ? 'world' : 'hub', cls: G.world ? 'dim' : '', back: () => { persist(); back(); }, label: '设置' });
  const save = () => { applySettings(); persist(); };
  $$('[data-seg]', el).forEach((b) => b.onclick = () => { s[b.dataset.seg] = b.dataset.v; Sound.sfx('ui'); save(); if (G.world) G.world.low = s.particles === 'low'; showSettings(back); });
  $$('[data-tog]', el).forEach((b) => b.onclick = () => { const k = b.dataset.tog; s[k] = !s[k]; b.classList.toggle('on', s[k]); b.setAttribute('aria-checked', s[k]); Sound.sfx('ui'); save(); });
  $('#set-drag', el).oninput = (e) => { s.dragSens = +e.target.value; save(); };
  $('#set-music', el).oninput = (e) => { s.music = +e.target.value; save(); };
  $('#set-sfx', el).oninput = (e) => { s.sfx = +e.target.value; save(); Sound.sfx('ui', { gap: 120 }); };
  $$('[data-bind]', el).forEach((b) => b.onclick = () => { b.classList.add('wait'); b.textContent = '按下新键…'; Input.startRebind(b.dataset.bind, (bs) => { s.binds = JSON.parse(JSON.stringify(bs)); save(); showSettings(back); }); });
  $('#set-resetkeys', el).onclick = () => { s.binds = null; save(); showSettings(back); };
  let armed = false;
  $('#set-wipe', el).onclick = () => {
    if (!armed) { armed = true; $('#set-wipe', el).textContent = '确认清除（不可恢复）'; return; }
    Store.wipe(); G.meta = freshMeta(); Tele.bind(G.meta); G.world = null; applySettings(); persist(); toast('存档已清除'); showTitle();
  };
}

/* ================================================== PAUSE ================================================== */
function pauseGame() {
  const w = G.world;
  if (!w || G.paused || w.state !== 'play' || !Input.gameActive) return;
  G.paused = true; Input.gameActive = false;
  const skills = w.skills.map((s) => `<div class="row"><span class="chip" style="color:${SKILLS[s.id].color};border-color:${SKILLS[s.id].color}">${icon(SKILLS[s.id].icon)} ${SKILLS[s.id].name} Lv${s.lv}</span><span class="dim-text" style="font-size:var(--fs-xs)">${SKILLS[s.id].lv[s.lv - 1]}</span></div>`).join('') || '<span class="dim-text">还没有技能晶体：击败小怪，飞过去拾取发光的晶体。</span>';
  const syns = [...w.syn].map((k) => `<div class="row"><span class="chip gold">${SYNERGIES[k].name}</span><span class="dim-text" style="font-size:var(--fs-xs)">${SYNERGIES[k].desc}</span></div>`).join('');
  const el = showScreen('pause', `
    <div class="center-col" style="max-width:calc(820px*var(--u))">
      <div class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">暂停</div>
      <div class="panel build-list" style="width:100%"><div class="label">当前 Build ${w.stream ? `· ${w.stream.name}` : ''}（最多 3 个技能槽，同类晶体自动升级）</div>${skills}${syns}</div>
      <div class="row wrap" style="justify-content:center">
        <button class="btn primary" id="p-resume" type="button" autofocus>${icon('i-play')} 继续</button>
        <button class="btn" id="p-settings" type="button">${icon('i-gear')} 设置</button>
        <button class="btn" id="p-codex" type="button">${icon('i-book')} 图鉴</button>
        <button class="btn coral" id="p-quit" type="button">结束本局</button>
      </div>
      <span class="dim-text" style="font-size:var(--fs-xs)">结束本局会直接结算，已收集的星尘和碎片全部保留。</span>
    </div>`, { bg: 'world', cls: 'dim', back: resumeGame, label: '暂停' });
  $('#p-resume', el).onclick = resumeGame;
  $('#p-settings', el).onclick = () => showSettings(() => { G.paused = false; pauseGame(); });
  $('#p-codex', el).onclick = () => showCodex('skills', () => { G.paused = false; pauseGame(); });
  let armed = false;
  $('#p-quit', el).onclick = () => {
    if (!armed) { armed = true; $('#p-quit', el).textContent = '确认结束本局'; return; }
    Tele.log('run_abandoned'); G.paused = false; const ww = G.world; ww.done = true; const r = ww.result(false); r.abandoned = true; onRunEnd(r);
  };
}
function resumeGame() {
  if (!G.world) return;
  clearScreens(); G.paused = false; G.bg = 'world'; Input.gameActive = true; Input.clearPresses();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  applySettings(); buildHud();
}

/* ================================================== BURST PREVIEW（大招预览）================================================== */
function openPreview(pid, back) {
  const P = PLANES[pid];
  const el = showScreen('preview', `
    <div class="preview-box">
      <div class="h-display" style="font-size:var(--fs-l);color:var(--paper)">${P.name} · ${P.burst.name}</div>
      <div class="cvwrap"><canvas id="pv-cv" width="960" height="540" aria-label="${P.burst.name} 预览"></canvas></div>
      <div class="dim-text" style="font-size:var(--fs-s);text-align:center">${P.burst.desc}</div>
      <button class="btn primary" id="pv-close" type="button" autofocus>关闭</button>
    </div>`, { bg: G.bg === 'world' ? 'hub' : G.bg, cls: 'dim', back: () => { stopPreview(); back(); }, label: '大招预览' });
  const cv = $('#pv-cv', el);
  G.preview = { world: new World({ mode: 'preview', W: 1280, plane: pid, settings: Object.assign({}, G.meta.settings, { shake: false }), stats: planeStats(G.meta, pid, null) }), cv, g: cv.getContext('2d'), acc: 0 };
  $('#pv-close', el).onclick = () => { stopPreview(); back(); };
}
function stopPreview() { G.preview = null; }
function tickPreview(dt) {
  const d = G.preview; if (!d) return;
  if (!document.body.contains(d.cv)) { G.preview = null; return; }
  d.acc += dt; let n = 0;
  while (d.acc >= 1 / 60 && n < 4) { d.world.step(1 / 60); d.acc -= 1 / 60; n++; }
  d.world.events.length = 0;
  const k = d.cv.width / 1280; d.g.setTransform(k, 0, 0, k, 0, 0);
  d.world.render(d.g, { simpleBg: true });
}

/* ================================================== HUD ================================================== */
function buildHud() {
  const w = G.world, hud = $('#hud');
  hud.innerHTML = `
    <div class="hud-tl">
      <div class="hearts" id="h-hearts" aria-label="生命"></div>
      <div class="row"><span class="cur">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}<span class="num" id="h-dust">0</span></span><span class="stream-badge" id="h-stream"></span></div>
      <div class="slots" id="h-slots">${[0, 1, 2].map((i) => `<div class="slot" data-i="${i}" title="技能槽 ${i + 1}"><svg class="ic"><use href="#s-thunder"/></svg><div class="lv">${'<i></i>'.repeat(5)}</div></div>`).join('')}</div>
      <div class="syns" id="h-syns"></div>
    </div>
    <div class="hud-tc" id="h-tc"><div class="seg-label" id="h-seg"></div><div class="seg-bar"><i id="h-segf"></i></div></div>
    <div class="bossbar" id="h-boss" hidden><div class="bname"><span>失控闹钟</span><small id="h-bphase"></small></div><div class="bar boss" id="h-bbar"><i id="h-bf"></i><span class="tick" style="left:70%"></span><span class="tick" style="left:35%"></span><span class="shield" id="h-bs"></span></div></div>
    <div class="hud-tr"><button class="pause-btn hb" id="h-pause" type="button" aria-label="暂停">${icon('i-pause')}</button></div>
    <div class="streak" id="h-streak" hidden><div class="n" id="h-sn">0</div><div class="t">连杀</div></div>
    <button class="burst-btn hb" id="h-burst" type="button" aria-label="爆发：${PLANES[w.planeId].burst.name}"><div class="face"><canvas width="160" height="160" data-plane="${w.planeId}"></canvas></div><span class="k kbd" id="h-bk"></span></button>
    <div class="hint-box" id="h-hint" hidden></div>`;
  hud.hidden = false;
  paintPlaneCanvases(hud);
  $('#h-pause').onclick = () => pauseGame();
  $('#h-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
  const bb = $('#h-burst');
  bb.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Input.press('burst'); });
  G.hudRefs = { hearts: $('#h-hearts'), dust: $('#h-dust'), stream: $('#h-stream'), slots: $$('#h-slots .slot'), syns: $('#h-syns'), tc: $('#h-tc'), seg: $('#h-seg'), segf: $('#h-segf'), boss: $('#h-boss'), bphase: $('#h-bphase'), bbar: $('#h-bbar'), bf: $('#h-bf'), bs: $('#h-bs'), streak: $('#h-streak'), sn: $('#h-sn'), burst: bb, bk: $('#h-bk'), hint: $('#h-hint') };
  G.hudLast = {};
  updateHud(true);
}
function hideHud() { const hud = $('#hud'); hud.hidden = true; hud.innerHTML = ''; G.hudRefs = null; }
function setText(el, key, v) { if (G.hudLast[key] !== v) { G.hudLast[key] = v; el.textContent = v; } }
function updateHud(force) {
  const w = G.world, R = G.hudRefs; if (!w || !R) return;
  if (force) G.hudLast = {};
  const h = w.hud(), L = G.hudLast;
  const hk = `${h.hp}/${h.maxHp}`;
  if (L.hp !== hk) { L.hp = hk; let s = ''; for (let i = 0; i < h.maxHp; i++) s += `<svg class="${i < h.hp ? '' : 'off'}" aria-hidden="true"><use href="#i-heart"/></svg>`; R.hearts.innerHTML = s; R.hearts.setAttribute('aria-label', `生命 ${h.hp}/${h.maxHp}`); }
  setText(R.dust, 'dust', String(Math.floor(h.dust / DUST_RATE)));
  setText(R.stream, 'stream', h.stream || '');
  const sk = h.skills.map((s) => s.id + s.lv).join(',');
  if (L.sk !== sk) {
    const prev = L.skArr || [];
    R.slots.forEach((el, i) => {
      const s = h.skills[i];
      el.classList.toggle('on', !!s);
      if (s) {
        const S = SKILLS[s.id]; el.style.setProperty('--sc', S.color); el.firstElementChild.firstElementChild.setAttribute('href', '#' + S.icon); el.title = `${S.name} Lv${s.lv}`;
        el.lastElementChild.innerHTML = [1, 2, 3, 4, 5].map((k) => `<i class="${k <= s.lv ? 'on' : ''}"></i>`).join('');
        const p = prev[i]; if (!p || p.id !== s.id || p.lv !== s.lv) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
      }
    });
    L.sk = sk; L.skArr = h.skills.map((s) => ({ id: s.id, lv: s.lv }));
  }
  const synk = h.syns.join(',');
  if (L.syn !== synk) { L.syn = synk; R.syns.innerHTML = h.syns.map((k) => `<span class="chip gold">${SYNERGIES[k].name}</span>`).join(''); }
  if (h.boss) {
    if (L.bossOn !== true) { L.bossOn = true; R.boss.hidden = false; R.tc.hidden = true; }
    setText(R.bphase, 'bph', h.boss.phaseName + (h.boss.weak ? ' · 弱点暴露' : ''));
    const bw = `${(h.boss.hp / h.boss.maxHp) * 100}%`; if (L.bw !== bw) { L.bw = bw; R.bf.style.width = bw; }
    const sw = h.boss.shield > 0 ? `${(h.boss.shield / h.boss.shieldMax) * 100}%` : '0%'; if (L.sw !== sw) { L.sw = sw; R.bs.style.width = sw; }
    const pc = 'bar boss p' + h.boss.phase; if (L.bcls !== pc) { L.bcls = pc; R.bbar.className = pc; }
  } else {
    if (L.bossOn !== false) { L.bossOn = false; R.boss.hidden = true; R.tc.hidden = false; }
    const lbl = h.phase === 'portal' ? '前方分岔 · 飞进一个洞口' : h.phase === 'boss' ? '失控闹钟' : `第 ${h.seg} 段 · ${h.segType === 'normal' ? '航行' : PORTALS[h.segType] ? PORTALS[h.segType].name : ''}`;
    setText(R.seg, 'seg', lbl);
    const sw = h.phase === 'portal' ? '100%' : `${Math.round(h.segU * 100)}%`; if (L.segw !== sw) { L.segw = sw; R.segf.style.width = sw; }
  }
  // streak heat
  const sn = h.streak;
  if (L.sn !== sn) {
    const show = sn >= 5;
    if (L.snShow !== show) { L.snShow = show; R.streak.hidden = !show; }
    if (show) {
      R.sn.textContent = sn; R.streak.classList.remove('bump'); void R.streak.offsetWidth; R.streak.classList.add('bump');
      const c = sn >= 100 ? ['#ffd76a', '#fff6c8'] : sn >= 50 ? ['#ff9fcf', '#fff'] : sn >= 30 ? ['#6ff0ff', '#fff'] : ['#aeeaff', '#fff'];
      R.streak.style.setProperty('--hc', c[0]); R.streak.style.setProperty('--hc2', c[1]);
    }
    L.sn = sn;
  }
  // burst button
  const p = Math.round(h.burst * 100);
  if (L.bp !== p) { L.bp = p; R.burst.style.setProperty('--p', p); }
  if (L.ready !== h.ready) { L.ready = h.ready; R.burst.classList.toggle('ready', h.ready); }
  const key = Input.hintFor('burst');
  if (L.bk !== key) { L.bk = key; R.bk.textContent = key; R.bk.hidden = !key; }
}
function drainWorldEvents() {
  const w = G.world; if (!w) return;
  if (w.done) { w.events.length = 0; return; }
  while (w.events.length) {
    const e = w.events.shift();
    switch (e.type) {
      case 'skill': { const S = SKILLS[e.id]; toast(`${S.name} ${e.isNew ? '装入技能槽' : `升到 ${e.lv} 级`} · ${e.text}`, S.color, S.icon, 2600); break; }
      case 'synergy': banner(`技能联动：${e.name}`, e.desc, 1.9, 'rgba(255,215,106,.8)'); break;
      case 'stream': banner(`${e.name}成型！`, '6 个技能晶体到手，Build 定型', 1.9, SKILLS[e.id].glow); break;
      case 'lv5': banner(`${SKILLS[e.id].name} 满级！`, SKILLS[e.id].lv[4], 1.8, SKILLS[e.id].glow); break;
      case 'streak': if (e.n >= 50) banner(`${e.n} 连杀！`, { 50: '星环清场', 100: '金色巨型强化出现' }[e.n] || '星环清场', 1.3, 'rgba(255,159,207,.8)'); else toast(`${e.n} 连杀！${{ 10: '小爆炸', 30: '屏幕开始发光' }[e.n]}`, '#aeeaff'); break;
      case 'elite': toast('精英出现 · 击败它会掉技能晶体', '#ff9d8c', 'n-crown'); Sound.setBoost('tension', 0.3); setTimeout(() => Sound.setBoost('tension', 0), 12000); break;
      case 'segment': if (e.type !== 'normal' && PORTALS[e.type]) banner(PORTALS[e.type].name, PORTALS[e.type].effect, 1.3, PORTALS[e.type].color); break;
      case 'boss': banner('失控闹钟', '第一乐章 · 指针卡住', 2.4, 'rgba(255,90,110,.7)'); Sound.setMode('boss1'); break;
      case 'bossResponse': banner(e.title, e.sub, 2.6, 'rgba(255,215,106,.8)'); break;
      case 'phase': banner(e.name, e.n === 2 ? '攻击越来越快，安全区在缩小' : '弹幕会逆行，消失的弹幕会重演', 1.8); break;
      case 'flag': banner('', e.text, e.dur || 1); break;
      case 'burstReady': toast(`${PLANES[w.planeId].burst.name} 充能完成！`, '#ffe38a', 'i-play', 1600); break;
      case 'gold': banner('金色巨型强化！', '所有技能 +1 级', 1.6, 'rgba(255,215,106,.9)'); break;
      case 'hint': showHint(e.id); break;
    }
  }
}
function showHint(id) {
  const R = G.hudRefs; if (!R) return;
  if (!id) { R.hint.hidden = true; return; }
  const d = Input.device;
  const T = {
    move: [d === 'touch' ? '按住屏幕任意位置拖动飞机' : d === 'pad' ? '左摇杆移动飞机' : 'WASD / 方向键移动，也可以按住鼠标拖动', '攻击是自动的，你只管飞。'],
    crystal: ['飞过去拾取发光的技能晶体', '技能会自动装进技能槽，同类晶体自动升级。'],
    portal: ['前方分岔：飞进一个洞口', '蓝色闪电 = 技能 · 金色星星 = 稀有 · 红色王冠 = Boss · 绿色爱心 = 回复'],
    burst: [d === 'touch' ? '点右下角头像（或双击屏幕）释放专属大招' : d === 'pad' ? '按 A 释放专属大招' : `按 ${Input.hintFor('burst')} 释放专属大招`, `${PLANES[G.world.planeId].burst.name}：${PLANES[G.world.planeId].burst.desc}`],
  }[id];
  if (!T) { R.hint.hidden = true; return; }
  R.hint.hidden = false; R.hint.innerHTML = `${esc(T[0])}<small>${esc(T[1])}</small>`;
}
