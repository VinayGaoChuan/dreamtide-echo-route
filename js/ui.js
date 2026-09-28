'use strict';
/* 梦潮：回声航线 v0.7 — 界面与流程：标题 → 机库大厅 →（招募 / 机库 / 天赋 / 任务 / 外观 / 图鉴）→ 出击某一关 → 一局 → 结算 + 下一局诱因卡。
   画布负责战斗与背景；所有菜单、HUD 都在 DOM 里。 */

const G = {
  meta: null, world: null, screen: null, bg: 'title', back: null,
  W: 1280, scale: 1, dpr: 1, sea: null, hub: null, map: null,
  paused: false, preview: null, cap: { sample: null, downloads: null },
  hudRefs: null, hudLast: {}, endShownAt: null, lastRes: null,
};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
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
  $$('canvas[data-npc]', root).forEach((c) => paintNPC(c, c.dataset.npc, c.dataset.mood || 'happy'));
  $$('canvas[data-map]', root).forEach((c) => paintMapIcon(c, c.dataset.map, c.dataset.sub || null));
  $$('canvas[data-plane]', root).forEach((c) => {
    const g = c.getContext('2d'), id = c.dataset.plane, big = c.width;
    g.clearRect(0, 0, c.width, c.height);
    if (c.dataset.glow) { const gr = g.createRadialGradient(big / 2, big / 2, 4, big / 2, big / 2, big / 2); gr.addColorStop(0, c.dataset.glow); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, big, big); }
    drawPlane(g, id, big * 0.52, big * 0.56, big / 80, 1.3, { happy: !!c.dataset.happy });
  });
}
function banner(title, sub, dur = 1.6, color, prio = 2) {
  // 优先级：重要横幅（点亮梦灯屋、流派成型、Boss）在显示时，不会被连杀之类的小横幅盖掉，小的改成轻提示
  const now = performance.now();
  if (banner._until > now && prio < banner._prio) { toast([title, sub].filter(Boolean).join(' · '), null, null, 1600); return; }
  banner._prio = prio; banner._until = now + dur * 1000;
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
  while (t.children.length > 2) t.firstElementChild.remove();
}
function curRow() {
  const m = G.meta;
  return `<div class="cur-row">
    <span class="cur" title="星尘：提升共享等级">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}<span class="num">${Math.floor(m.stardust)}</span></span>
    <span class="cur" title="招募券：招募新飞机">${icon('i-ticket').replace('class="ic"', 'class="ic" style="fill:#ffe38a"')}<span class="num">${m.tickets}</span></span>
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
  Sound.sfx('select'); toast(`招募券 +${d.reward}`, '#ffe38a', 'i-ticket'); persist();
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
      <p class="title-tag">${first ? '移动飞机对准敌人，飞进奖励门挑升级，按下爆发键清屏。' : '梦灯还亮着。欢迎回来。'}</p>
      <p class="title-start">点击任意处开始</p>
    </div>
    <p class="title-foot">键鼠 · 手柄 &nbsp;|&nbsp; 进度自动保存在本机</p>`, { bg: 'title', label: '标题' });
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
  if (!G.meta.firstRunDone) startRun('1-1'); else showHub(); // 第一次打开直接进 1-1
}

/* ================================================== 共享成长 / 关卡进度 ================================================== */
function nextLevelCost() { const lv = G.meta.shared.level; return lv >= SHARED.max ? null : SHARED.cost[lv + 1]; }
function canLevelUp() { const c = nextLevelCost(); return c !== null && G.meta.stardust >= c; }
function sharedLine(lv) { lv = lv || G.meta.shared.level; const h = sharedHearts(lv); return `攻击 ×${sharedAtk(lv).toFixed(2)}${h ? ` · 生命 +${h}` : ''}`; }
function levelUp() {
  const m = G.meta, c = nextLevelCost();
  if (c === null || m.stardust < c) { Sound.sfx('denied'); return false; }
  m.stardust -= c; m.shared.level++;
  Tele.log('shared_level_up', { lv: m.shared.level }); persist(); Sound.sfx('levelup');
  banner(`共享等级 Lv${m.shared.level}`, `${sharedLine()} · 每架飞机天赋点 +1`, 1.8, 'rgba(255,215,106,.8)');
  return true;
}
function stageUnlocked(id) { const i = STAGE_ORDER.indexOf(id); return i === 0 || !!G.meta.progress.cleared[STAGE_ORDER[i - 1]]; }
function nextStage() { return STAGE_ORDER.find((id) => !G.meta.progress.cleared[id]) || STAGE_ORDER[STAGE_ORDER.length - 1]; }
function ultCapNow() { return ULT_CAP.reduce((c, u) => (!u.need || G.meta.progress.cleared[u.need] ? Math.max(c, u.cap) : c), 1); }
function stageChips(sel) {
  const P = G.meta.progress;
  return `<div class="stage-row" role="group" aria-label="第 1 章关卡">${STAGE_ORDER.map((id) => {
    const S = STAGES[id], ok = stageUnlocked(id), done = P.cleared[id];
    return `<button class="stage-chip ${id === sel ? 'sel' : ''} ${ok ? '' : 'locked'} ${done ? 'cleared' : ''}" data-stage="${id}" type="button" ${ok ? '' : 'aria-disabled="true"'}><b>${id}</b><span>${S.name}</span>${done ? '<i>✓</i>' : ok ? '' : icon('i-lock')}</button>`;
  }).join('')}<button class="stage-chip ch2" id="stage-ch2" type="button" aria-disabled="true"><b>第 2 章</b><span>制作中</span>${icon('i-lock')}</button></div>`;
}

/* ================================================== HUB（机库大厅）================================================== */
function showHub() {
  Sound.setMode('hub'); G.world = null; Input.gameActive = false; hideHud(); stopPreview();
  ensureTasks();
  const m = G.meta, P = PLANES[m.current], rec = m.planes[m.current], L = m.nextHint;
  let sel = m.progress.selected || nextStage(); if (!stageUnlocked(sel)) sel = nextStage();
  const S = STAGES[sel], cost = nextLevelCost(), pts = treePoints(m, rec), cap = ultCapNow();
  const el = showScreen('hub', `
    <div class="hub-left">
      <div class="panel"><div class="label">梦灯机库 · 失眠之海</div>${curRow()}
        <div class="lvbox"><span class="lvnum">Lv${m.shared.level}</span><span class="dim-text">共享等级 · ${sharedLine()}</span>
          ${cost === null ? '<span class="chip gold">已满级</span>' : `<button class="btn small ${canLevelUp() ? 'primary' : ''}" id="hub-lv" type="button" ${canLevelUp() ? '' : 'disabled'}>${icon('i-dust')} 升级 · ${cost}</button>`}</div>
      </div>
      ${L ? `<div class="panel lure"><div class="label">下一局</div>${lureRows(L)}</div>` : ''}
    </div>
    <div class="hub-side">
      <button class="icon-btn" id="hub-gacha" type="button">${icon('i-gacha')}<span>招募</span>${m.tickets > 0 ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn" id="hub-planes" type="button">${icon('i-hangar')}<span>机库</span></button>
      <button class="icon-btn" id="hub-star" type="button">${icon('i-starmap')}<span>天赋</span>${pts > 0 ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn" id="hub-tasks" type="button">${icon('i-task')}<span>任务</span>${anyTaskReady() ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn" id="hub-cos" type="button">${icon('i-cos')}<span>外观</span></button>
      <button class="icon-btn" id="hub-codex" type="button">${icon('i-book')}<span>图鉴</span></button>
      <button class="icon-btn" id="hub-records" type="button">${icon('i-trophy')}<span>记录</span></button>
      <button class="icon-btn" id="hub-settings" type="button">${icon('i-gear')}<span>设置</span></button>
    </div>
    <div class="hub-start">
      <div class="hub-plane">
        <div class="pname">${P.name} ${rarityChip(P.rarity)} ${starsHtml(rec.stars)}</div>
        <div class="row wrap" style="justify-content:center"><span class="chip gold">大招 · ${P.burst.name} · 最多存 ${cap} 次</span><button class="btn small cyan" id="hub-preview" type="button">${icon('i-play')} 大招预览</button></div>
      </div>
      ${stageChips(sel)}
      <button class="btn primary big" id="hub-go" type="button" autofocus>${icon('i-hangar')} 出击 · ${sel} ${S.name}</button>
      <span class="dim-text" style="font-size:var(--fs-xs)">建议共享等级 ${S.rec}${m.shared.level < S.rec ? '（建议只是提示，不锁关）' : ''} · ${S.intro}</span>
    </div>`, { bg: 'hub', label: '机库大厅' });
  $('#hub-go', el).onclick = () => { Sound.sfx('select'); startRun(sel); };
  $$('[data-stage]', el).forEach((b) => b.onclick = () => { if (!stageUnlocked(b.dataset.stage)) { Sound.sfx('denied'); toast('先通关上一关', '#ffb2a8'); return; } Sound.sfx('ui'); m.progress.selected = b.dataset.stage; persist(); showHub(); });
  $('#stage-ch2', el).onclick = () => { Sound.sfx('denied'); toast('第 2 章还在制作中', '#ffe38a'); };
  const lvb = $('#hub-lv', el); if (lvb) lvb.onclick = () => { if (levelUp()) showStarMap(m.current, showHub, true); };
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
  const path = (L.path || []).map((id, i) => `${i ? '<span class="arrow">›</span>' : ''}<span class="chip" style="color:${(SKILLS[id] || { color: '#ffd76a' }).color}">${SKILLS[id] ? SKILLS[id].name : SYNERGIES[id] ? SYNERGIES[id].name : id}</span>`).join('');
  return `<div class="lure-row"><span class="label">本局</span><span><b>${esc(L.stream || '还没成型')}</b></span></div>
    <div class="lure-row"><span class="label">想完成</span><span class="lure-path"><b>${esc(L.buildName || '')}</b>${path}</span></div>
    ${L.next ? `<div class="lure-row"><span class="label">下一步</span><span>${esc(L.next)}</span></div>` : ''}${L.npc ? `
    <div class="lure-row"><span class="label">想救的</span><span class="lure-npc"><canvas width="64" height="64" data-npc="${L.npc}" data-mood="sleep"></canvas>${esc(NPCS[L.npc].name)}还困在航线上</span></div>` : ''}`;
}

/* ================================================== RUN ================================================== */
function startRun(stageId) {
  ensureTasks();
  const m = G.meta, id = m.current;
  stageId = stageId || m.progress.selected || nextStage();
  if (!stageUnlocked(stageId)) stageId = nextStage();
  m.progress.selected = stageId; m.progress.attempts[stageId] = (m.progress.attempts[stageId] || 0) + 1;
  if (G.endShownAt) { const dt = (performance.now() - G.endShownAt) / 1000; m.telemetry.lastRestart = Math.round(dt * 10) / 10; G.endShownAt = null; }
  if (m.records.runs === 1) Tele.log('second_run_started');
  const first = !m.firstRunDone && stageId === '1-1', cap = ultCapNow(); m.ultCap = cap;
  m.records.runs++; Tele.log('run_started', { stage: stageId });
  applySettings(); clearScreens(); stopPreview();
  G.bg = 'world'; G.paused = false; G.mapHint = null; G.hintId = null;
  G.world = new World({
    mode: 'run', W: G.W, plane: id, stage: stageId, ultCap: cap, stats: planeStats(m, id), first, settings: m.settings, scene: G.sea, cos: m.cosmetics, seenMap: Object.keys(m.codex.map || {}),
    cb: {
      onEnd: onRunEnd,
      onSkill: (sid) => { m.codex.skills[sid] = 1; },
      onSynergy: (key) => { m.codex.syns[key] = 1; },
      onSeenEnemy: (t) => { if (t) m.codex.enemies[t] = 1; },
      onPortal: (t) => { m.codex.portals[t] = 1; if (t === 'boss' && stageId === '1-3') m.codex.enemies.clock = 1; },
      onMap: (kind, sub) => { m.codex.map[kind] = 1; if (kind === 'npc') m.codex.npcs[sub] = 1; if (kind === 'giant') m.codex.giants[sub] = 1; },
    },
  });
  Sound.setMode('combat'); Sound.setCardMods([]);
  Input.gameActive = true; Input.clearPresses();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  buildHud();
  banner(`${stageId} ${STAGES[stageId].name}`, `${PLANES[id].name} · 开局只会直射，升级在路上挑`, 2);
  persist();
}
function onRunEnd(res) {
  const m = G.meta, st = res.stats, S = STAGES[res.stage], P = m.progress, first = !m.firstRunDone;
  const firstClear = res.win && !P.cleared[res.stage];
  // 星尘：首通约 120（1-1），重复通关 60%，失败按完成进度 30~90；另加少量本局收集
  const dust = (res.win ? (firstClear ? S.reward : Math.round(S.reward * 0.6)) : Math.round(lerp(S.fail[0], S.fail[1], res.progress))) + Math.floor(st.dust / 100);
  const newRescues = (res.companions || []).filter((id) => !P.rescued[id]);
  const tickets = (res.win ? (firstClear ? (res.stage === '1-1' ? 10 : 5) : 2) : 1) + newRescues.length;
  const cos = firstClear ? 1 : 0, frags = Object.assign({}, st.frags);
  const capBefore = ultCapNow();
  if (firstClear && STAGE_ORDER[STAGE_ORDER.indexOf(res.stage) + 1]) P.selected = STAGE_ORDER[STAGE_ORDER.indexOf(res.stage) + 1]; // 首通后默认选下一关
  if (res.win) { P.cleared[res.stage] = true; P.clears[res.stage] = (P.clears[res.stage] || 0) + 1; if (!P.best[res.stage] || res.runT < P.best[res.stage]) P.best[res.stage] = Math.round(res.runT); }
  for (const id of newRescues) P.rescued[id] = 1;
  const capUp = ultCapNow() > capBefore ? ultCapNow() : 0; m.ultCap = ultCapNow();
  m.stardust += dust; m.tickets += tickets; m.cosTickets += cos;
  for (const k in frags) m.frags[k] = (m.frags[k] || 0) + frags[k];
  const Sx = m.stats;
  Sx.kills += st.kills; Sx.bursts += st.bursts; Sx.runs += 1; Sx.syns += st.syns; Sx.streak100 += st.streak100 ? 1 : 0; Sx.crystals += st.crystals; Sx.bossKills += res.win ? 1 : 0; Sx.lv5 += st.lv5 ? 1 : 0; Sx.chests += st.chests;
  Sx.interacts = (Sx.interacts || 0) + (st.interacts || 0); Sx.rescues = (Sx.rescues || 0) + (st.rescues || 0); Sx.giants = (Sx.giants || 0) + (st.giants || 0);
  Tele.add('map_interacts', st.interacts); Tele.add('map_rescues', st.rescues); Tele.add('map_giants', st.giants); Tele.add('map_missed', st.interactFails); Tele.add('offers', st.offers); Tele.add('offer_missed', st.offerMiss);
  const R = m.records;
  if (res.win) { R.clears++; if (!R.bestTime || res.runT < R.bestTime) R.bestTime = Math.round(res.runT); }
  R.bestStreak = Math.max(R.bestStreak, st.maxStreak); R.bestCrystals = Math.max(R.bestCrystals, st.crystals);
  Tele.log(res.win ? 'run_completed' : 'run_failed', { stage: res.stage });
  if (first) Tele.log('first_run_ended');
  Tele.add('kills', st.kills); Tele.add('bursts', st.bursts); Tele.add('synergies', st.syns);
  const runs = m.telemetry.runs || (m.telemetry.runs = []);
  runs.push({ at: Date.now(), stage: res.stage, win: res.win, plane: res.plane, level: m.shared.level, firstKill: st.firstKill, firstSkill: st.firstSkill, firstBurst: st.firstBurst, changes: st.crystals, highlights: st.highlights, avgKill: res.avgKill, gap: st.gapMax, runT: res.runT,
    interacts: st.interacts, interactTime: st.interactMax, choiceTime: res.choiceAvg, stockIdle: st.stockIdle, leaks: st.leaks, progress: res.progress });
  while (runs.length > 40) runs.shift();
  m.firstRunDone = true;
  const lure = makeLure(res);
  m.nextHint = lure;
  persist();
  G.lastRes = { res, rewards: { dust, tickets, cos, frags, firstClear, capUp, newRescues, newbie: first && res.stage === '1-1' && firstClear }, lure };
  showEnd(G.lastRes);
}
/* “下次想完成的 Build”：给一条和这局不同的成长路线（取自两条示例流派和各联动） */
const BUILD_PATHS = [
  { name: '贯穿爆破流', path: ['pierce', 'pierce', 'bomb', 'multi', 'pierce+bomb'], hint: '一道火线清掉成排敌人' },
  { name: '追踪蜂群流', path: ['homing', 'wing', 'homing', 'wing', 'homing+wing'], hint: '飞机和分身扫掉四处散开的敌人' },
  { name: '追踪雷暴流', path: ['homing', 'thunder', 'homing+thunder', 'thunder'], hint: '追踪弹命中就放电' },
  { name: '散射冰晶流', path: ['multi', 'ice', 'multi+ice', 'multi'], hint: '一排冰弹把整队冻住' },
  { name: '烟火流', path: ['bomb', 'rainbow', 'bomb+rainbow', 'bomb'], hint: '标记爆炸变成彩色烟火' },
];
function makeLure(res) {
  const m = G.meta, stream = res.stream;
  const opts = BUILD_PATHS.filter((b) => b.name !== stream), B = opts[(m.records.runs || 0) % opts.length];
  const nextId = STAGE_ORDER[STAGE_ORDER.indexOf(res.stage) + 1];
  let next = null;
  if (res.win && nextId) next = `挑战 ${nextId} ${STAGES[nextId].name}`;
  else if (!res.win && canLevelUp()) next = '星尘够了：先升一级再回来打';
  else if (!res.win) next = `完成度 ${Math.round(res.progress * 100)}% · 回打更熟悉的关卡也能攒星尘`;
  const saved = new Set(res.companions || []), npc = NPC_ORDER.find((id) => !m.progress.rescued[id] && !saved.has(id)) || null;
  return { stream, buildName: B.name, path: B.path, buildHint: B.hint, next, npc };
}
function buildChips(r) {
  const b = r.build || { gun: {}, support: null, bmod: null, links: [] }, out = [];
  for (const id of GUN_ORDER) if (b.gun[id]) out.push(`<span class="chip" style="color:${SKILLS[id].color};border-color:${SKILLS[id].color}">${icon(SKILLS[id].icon)} ${SKILLS[id].name} Lv${b.gun[id]}</span>`);
  if (b.support) out.push(`<span class="chip" style="color:${SKILLS[b.support.id].color};border-color:${SKILLS[b.support.id].color}">${icon(SKILLS[b.support.id].icon)} ${SKILLS[b.support.id].name} Lv${b.support.lv}</span>`);
  if (b.bmod) out.push(`<span class="chip" style="color:${BURST_MODS[b.bmod.id].color}">${icon(BURST_MODS[b.bmod.id].icon)} ${BURST_MODS[b.bmod.id].name} Lv${b.bmod.lv}</span>`);
  for (const k of b.links || []) out.push(`<span class="chip gold">${SYNERGIES[k].name}</span>`);
  return out.join('') || '<span class="dim-text">这一局没有选到升级</span>';
}

/* ================================================== END（结算：成长 / Build / 挑战 三件事）================================================== */
function showEnd(E) {
  Input.gameActive = false; hideHud(); Sound.setMode('result');
  $('#toast').innerHTML = ''; $('#banner').innerHTML = ''; banner._until = 0;
  G.endShownAt = performance.now();
  const r = E.res, st = r.stats, rw = E.rewards, P = PLANES[r.plane], S = STAGES[r.stage], m = G.meta;
  const nextId = STAGE_ORDER[STAGE_ORDER.indexOf(r.stage) + 1], cost = nextLevelCost();
  const fragTxt = Object.entries(rw.frags).map(([k, v]) => `${PLANES[k].name}碎片 +${v}`).join('、');
  const journey = (r.journey || []).map((j) => `<span class="jchip" style="--jc:${MAP_OBJECTS[j.kind].color}" title="${esc(j.desc || '')}"><canvas width="72" height="72" ${j.kind === 'npc' ? `data-npc="${j.sub}"` : `data-map="${j.kind}"${j.sub ? ` data-sub="${j.sub}"` : ''}`}></canvas><b>${j.verb}</b>${esc(j.name)}</span>`).join('');
  const grow = cost === null ? '<p class="dim-text">共享等级已满</p>'
    : m.stardust >= cost ? `<p><b class="good">这次已攒够升级！</b> 星尘 ${Math.floor(m.stardust)} / ${cost}</p><button class="btn primary small" id="end-lv" type="button">${icon('i-dust')} 一键升到 Lv${m.shared.level + 1}</button>`
    : `<p>星尘 ${Math.floor(m.stardust)} / ${cost}</p><div class="bar-mini"><i style="width:${(m.stardust / cost) * 100}%"></i></div><p class="dim-text" style="font-size:var(--fs-xs)">还差 ${Math.ceil(cost - m.stardust)}，再打一局就够</p>`;
  const el = showScreen('end', `
    <div class="center-col">
      <div class="h-display" style="font-size:var(--fs-xl);color:${r.win ? 'var(--lamp2)' : 'var(--paper)'}">${r.win ? `${r.stage} ${S.name} 通关！` : r.abandoned ? '本局结束' : `${P.name}被击落了`}</div>
      <div class="dim-text">${r.win ? `出击 ${fmtTime(r.runT)} · ${S.bossName} ${fmtTime(r.bossTime)}${rw.capUp ? ` · <b class="good">大招容量升到 ${rw.capUp} 次（所有飞机）</b>` : ''}` : `出击 ${fmtTime(r.runT)} · 完成度 ${Math.round(r.progress * 100)}% · 成长资源照常结算`}</div>
      <div class="statrow">${[['击破', st.kills], ['最高连杀', st.maxStreak], ['升级选择', st.crystals], ['联动', st.syns], ['大招', st.bursts], ['漏怪', st.leaks]].map(([k, v]) => `<div class="stat-pill"><span class="num">${v}</span><span>${k}</span></div>`).join('')}</div>
      <div class="rewards">
        <span class="reward">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}星尘 +${rw.dust}</span>
        <span class="reward">${icon('i-ticket').replace('class="ic"', 'class="ic" style="fill:#ffe38a"')}招募券 +${rw.tickets}${rw.newRescues.length ? `（含救援 ${rw.newRescues.length}）` : ''}</span>
        ${rw.cos ? `<span class="reward">${icon('i-cos').replace('class="ic"', 'class="ic" style="fill:#ff9fcf"')}外观票 +${rw.cos}</span>` : ''}
        ${fragTxt ? `<span class="reward">${icon('i-frag').replace('class="ic"', 'class="ic" style="fill:#aeeaff"')}${esc(fragTxt)}</span>` : ''}
      </div>
      <div class="end-grid3">
        <div class="panel end-card"><div class="label">① 成长 · 共享等级 Lv${m.shared.level}</div>${grow}<span class="dim-text" style="font-size:var(--fs-xs)">${sharedLine()} · 所有飞机一起变强</span></div>
        <div class="panel end-card"><div class="label">② Build ${r.stream ? `· <span style="color:var(--lamp2)">${esc(r.stream)}</span>` : ''}</div><div class="row wrap">${buildChips(r)}</div>
          ${journey ? `<div class="jrow">${journey}</div>` : ''}
          <div class="lure-mini"><span class="label">下次想完成</span> <b>${esc(E.lure.buildName)}</b><span class="dim-text"> · ${esc(E.lure.buildHint)}</span></div></div>
        <div class="panel end-card"><div class="label">③ 继续挑战</div>
          ${r.win && nextId ? `<button class="btn primary" id="end-next" type="button" autofocus>${icon('i-play')} 挑战 ${nextId} ${STAGES[nextId].name}</button>` : ''}
          <button class="btn ${r.win && nextId ? '' : 'primary'}" id="end-again" type="button" ${r.win && nextId ? '' : 'autofocus'}>${icon('i-play')} ${r.win ? '再打一次' : '再来一局'} ${r.stage}</button>
          <div class="row wrap"><button class="btn small" id="end-hub" type="button">${icon('i-hangar')} 机库</button>${m.tickets > 0 ? `<button class="btn small cyan" id="end-gacha" type="button">${icon('i-gacha')} 招募（${m.tickets}）</button>` : ''}</div>
          ${E.lure.npc ? `<span class="lure-npc dim-text" style="font-size:var(--fs-xs)"><canvas width="64" height="64" data-npc="${E.lure.npc}" data-mood="sleep"></canvas>${NPCS[E.lure.npc].name}还困在航线上</span>` : ''}
        </div>
      </div>
      <div class="panel memory" id="dream-box" hidden><h4>梦灯航海日志</h4><div class="dream-out" id="dream-out"></div></div>
      <div class="row wrap" style="justify-content:center"><button class="btn pink small" id="end-dream" type="button" hidden>${icon('i-note')} 让梦灯写下这一局</button></div>
    </div>`, { bg: 'world', cls: 'dim', label: r.win ? '通关结算' : '失败结算' });
  $('#end-hub', el).onclick = () => { Sound.sfx('uiBack'); showHub(); };
  $('#end-again', el).onclick = () => { Sound.sfx('select'); startRun(r.stage); };
  const en = $('#end-next', el); if (en) en.onclick = () => { Sound.sfx('select'); startRun(nextId); };
  const eg = $('#end-gacha', el); if (eg) eg.onclick = () => { Sound.sfx('ui'); showGacha(showHub); };
  const lv = $('#end-lv', el); if (lv) lv.onclick = () => { if (levelUp()) showStarMap(m.current, () => showEnd(E), true); };
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
      `结果：${r.win ? `通关 ${r.stage}，打败了${STAGES[r.stage].bossName}` : '被击落了'}\n流派：${r.stream || '未成型'}；技能：${skills}；联动：${syns}\n击破${st.kills}，最高连杀${st.maxStreak}，大招${st.bursts}次，专属大招「${PLANES[r.plane].burst.name}」。`;
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

/* ================================================== GACHA（飞机招募：只用游玩获得的招募券）================================================== */
function rollRarity() {
  const g = G.meta.gacha, bonus = Math.max(0, g.sinceHigh - GACHA.pityStart) * GACHA.pityStep;
  const ssr = RARITY.SSR.rate + bonus * 0.3, sr = RARITY.SR.rate + bonus * 0.7, r = RARITY.R.rate, x = Math.random();
  if (x < ssr) return 'SSR'; if (x < ssr + sr) return 'SR'; if (x < ssr + sr + r) return 'R'; return 'N';
}
function showGacha(back) {
  Sound.setMode('hub');
  const m = G.meta, g = m.gacha, pity = Math.max(0, g.sinceHigh - GACHA.pityStart) * GACHA.pityStep;
  const el = showScreen('gacha', `${backBtn()}
    <div class="screen-title"><h2>飞机招募</h2><p>只在机库里进行；重复的飞机自动变成它的碎片，不会浪费</p></div>
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
          <div class="dim-text" style="font-size:var(--fs-xs)">招募券来自：关卡首通、救出伙伴、任务目标。</div>
        </div>
        <div class="panel" style="padding:calc(12px*var(--u))"><div class="label">飞机池</div><div class="row wrap" style="margin-top:6px">${PLANE_ORDER.map((p) => `<span class="chip r-${PLANES[p].rarity}">${PLANES[p].name}${m.planes[p] ? ' ✓' : ''}</span>`).join('')}</div></div>
      </div>
    </div>`, { bg: 'hub', back, label: '招募' });
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
    </div>`, { bg: 'hub', cls: 'dim', label: '招募结果', back: () => showReveal(res, i + 1, back) });
  $('#rv-next', el).onclick = () => { Sound.sfx('card'); showReveal(res, i + 1, back); };
  $('#rv-go', el).onclick = () => { G.meta.current = it.pid; persist(); Sound.sfx('select'); startRun(); };
  $('#rv-prev', el).onclick = () => openPreview(it.pid, () => showReveal(res, i, back));
}
function showRevealSummary(res, back) {
  const el = showScreen('reveal', `
    <div class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">招募结果</div>
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
    <div class="screen-title"><h2>机库</h2><p>不装备、不配件：每架飞机自带大招、被动和天赋树；共享等级所有飞机通用</p></div>
    <div class="planes-wrap">
      <div class="plane-grid">${PLANE_ORDER.map(card).join('')}</div>
      <div class="panel pdetail">
        <h3>${rec ? P.name : '？？？'} ${rarityChip(P.rarity)} ${rec ? starsHtml(rec.stars) : ''}</h3>
        <p class="dim-text">${P.look} · 主炮：${P.shot}（固定向前单发） · 生命 ${P.hearts}</p>
        <div class="sec"><b>专属大招 · ${P.burst.name}</b><br>${P.burst.desc}</div>
        <div class="sec"><b>基础被动 · ${P.passive.name}</b><br>${P.passive.desc}${P.special ? `<br><span style="color:var(--lamp2)">${P.special}</span>` : ''}</div>
        <div class="sec"><b>专属地图反应</b><br>${PLANE_MAP_REACT[sel]}</div>
        <div class="starlist">${[2, 3, 4, 5].map((s) => `<span class="${rec && rec.stars >= s ? 'ok' : ''}">${'★'.repeat(s)} ${s === 3 ? `解锁第二段大招联动：${P.star3}` : STAR_UP[s].gain}${rec && rec.stars >= s ? ' ✓' : ''}</span>`).join('')}</div>
        <div class="row wrap">
          ${rec ? `${sel !== m.current ? `<button class="btn primary" id="pd-use" type="button">设为出战</button>` : ''}
            ${next ? `<button class="btn" id="pd-star" type="button" ${frags < next.cost ? 'disabled' : ''}>${icon('i-frag')} 升星（碎片 ${frags}/${next.cost}）</button>` : '<span class="chip gold">已满星</span>'}
            <button class="btn" id="pd-map" type="button">${icon('i-starmap')} 天赋树</button>`
          : `<button class="btn primary" id="pd-ex" type="button" ${frags < R.unlockFrags ? 'disabled' : ''}>${icon('i-frag')} 碎片兑换（${frags}/${R.unlockFrags}）</button>`}
          <button class="btn cyan" id="pd-prev" type="button">${icon('i-play')} 大招预览</button>
        </div>
        ${rec ? '' : '<p class="dim-text" style="font-size:var(--fs-xs)">获得方式：招募；宝箱会掉落指定飞机碎片。</p>'}
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

/* ================================================== 天赋树（每架飞机一棵，解锁时生成并保存）================================================== */
function recommendNode(rec) {
  let best = null, bs = -1;
  for (const r of ROUTE_ORDER) { const i = rec.lit[r]; if (i >= rec.map[r].length) continue; const n = rec.map[r][i], T = NODE_TYPES[n.type], sc = T.score - i * 0.2 + (T.needs ? -0.5 : 0); if (sc > bs) { bs = sc; best = r; } }
  return best;
}
function showStarMap(pid, back, fromLevel) {
  Sound.setMode('hub');
  const m = G.meta, rec = m.planes[pid], P = PLANES[pid];
  if (!rec) return showPlanes(back, pid);
  const pts = treePoints(m, rec), recR = pts > 0 ? recommendNode(rec) : null, stats = planeStats(m, pid).raw, cap = ultCapNow();
  let rows = '';
  for (const r of ROUTE_ORDER) {
    const list = rec.map[r], lit = rec.lit[r], R = ROUTES[r];
    const nodes = list.map((n, i) => {
      const T = NODE_TYPES[n.type], cls = i < lit ? 'lit' : i === lit ? (pts > 0 ? 'next' : 'wait') : '', isRec = r === recR && i === lit;
      const lab = i < lit ? (T.needs ? '待激活' : T.max > 1 ? `+${n.v}${n.type === 'pierceX' ? '' : '%'}` : '+1') : i === lit && pts > 0 ? (isRec ? '推荐' : '可点亮') : T.name;
      return `<button class="snode ${cls} ${isRec ? 'rec' : ''} ${T.needs ? 'pending' : ''}" type="button" data-r="${r}" data-i="${i}" ${cls === 'next' ? '' : 'tabindex="-1"'} title="${T.fmt(n.v)}" aria-label="${R.name} 第 ${i + 1} 个：${T.fmt(n.v)}">${icon(T.icon)}<small>${lab}</small></button>`;
    }).join('');
    const pct = list.length > 1 ? Math.min(1, Math.max(0, lit - 1) / (list.length - 1)) * 100 : 0;
    rows += `<div class="srow" style="--rc:${R.color}"><span class="route-label">${icon(R.icon)}${R.name}</span><div class="strack"><i class="strack-lit" style="width:${lit ? pct : 0}%"></i>${nodes}</div></div>`;
  }
  const capRow = `<div class="cap-row"><span class="label">大招容量（固定里程碑 · 账号共享）</span>${ULT_CAP.map((u) => `<span class="capn ${cap >= u.cap ? 'on' : ''}"><b>${u.cap}</b><small>${u.text}</small></span>`).join('')}</div>`;
  const eff = [['普通攻击', `×${(planeStats(m, pid).dmgK).toFixed(2)}`], ['爆炸范围', `+${stats.blast}%`], ['大招充能', `+${stats.charge}%`], ['吸附范围', `+${stats.magnet}%`], ['支援重复', `${stats.repeat}%`], ['最大生命', `+${stats.heart + sharedHearts(m.shared.level)}`], ['Boss 伤害', `+${stats.boss}%`], ['穿透强化', stats.pierceX ? `+${stats.pierceX}（待激活）` : '—'], ['追踪强化', stats.homingX ? `+${stats.homingX}%（待激活）` : '—'], ['地图充能', `快 ${stats.houseFast}%`], ['伙伴辅助', `+${stats.npcBoost}%`]];
  const el = showScreen('star', `${backBtn()}
    <div class="screen-title"><h2>${P.name} · 天赋树</h2><p>${pts > 0 ? `有 ${pts} 个天赋点：推荐节点已经高亮，也可以改选别的路线` : `共享等级每升 1 级，每架飞机各得 1 个天赋点`}</p></div>
    <div class="smap-wrap">
      <div class="panel smap">${rows}${capRow}</div>
      <div class="panel smap-side">
        ${curRow()}
        <div class="row wrap"><span class="chip gold">共享等级 Lv${m.shared.level}</span><span class="chip">天赋点 ${pts}</span></div>
        ${pts > 0 && recR ? `<button class="btn primary" id="sm-rec" type="button" autofocus>${icon('i-starmap')} 点亮推荐节点</button>` : canLevelUp() ? `<button class="btn primary" id="sm-lv" type="button">${icon('i-dust')} 升级 Lv${m.shared.level + 1}（${nextLevelCost()} 星尘）</button>` : ''}
        <h3>当前收益</h3>
        <div class="effect-list">${eff.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
        <p class="dim-text" style="margin:0;font-size:var(--fs-xs);line-height:1.6">穿透 / 追踪节点只强化本局已经选到的能力，没选到时保持“待激活”，不会让开局子弹变追踪。天赋树在飞机解锁时生成一次并保存，不会重抽。</p>
      </div>
    </div>`, { bg: 'map', back, label: '天赋树' });
  const light = (r) => {
    const i = rec.lit[r], n = rec.map[r][i]; if (!n || treePoints(m, rec) < 1) { Sound.sfx('denied'); return; }
    rec.lit[r]++; persist(); Sound.sfx('starLight'); toast(NODE_TYPES[n.type].fmt(n.v), ROUTES[r].color, NODE_TYPES[n.type].icon);
    showStarMap(pid, back);
  };
  $$('.snode.next', el).forEach((b) => b.onclick = () => light(b.dataset.r));
  const rb = $('#sm-rec', el); if (rb) rb.onclick = () => light(recR);
  const lb = $('#sm-lv', el); if (lb) lb.onclick = () => { if (levelUp()) showStarMap(pid, back, true); };
  if (fromLevel && pts > 0) toast('天赋点 +1：推荐节点已高亮', '#ffe38a', 'i-starmap');
}

/* ================================================== TASKS / COSMETICS ================================================== */
function showTasks(back) {
  ensureTasks();
  const T = G.meta.tasks;
  const el = showScreen('tasks', `${backBtn()}
    <div class="screen-title"><h2>活动任务</h2><p>完成后领取招募券；领完会补上新任务</p></div>
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
    <div class="screen-title"><h2>外观</h2><p>外观票来自关卡首通。只改变颜色和演出，不改变强度。</p></div>
    ${curRow()}
    <div class="label" style="margin:12px 0 6px">爆炸颜色</div><div class="grid-cards">${COSMETICS.exp.map((c) => item('exp', c)).join('')}</div>
    <div class="label" style="margin:12px 0 6px">飞行拖尾（梦灯屋的屋顶灯会跟着换色）</div><div class="grid-cards">${COSMETICS.trail.map((c) => item('trail', c)).join('')}</div>
`, { bg: 'hub', back, label: '外观' });
  $$('[data-eq]', el).forEach((b) => b.onclick = () => { const [k, id] = b.dataset.eq.split(':'); C[k] = id; persist(); Sound.sfx('select'); showCosmetics(back); });
  $$('[data-buy]', el).forEach((b) => b.onclick = () => { const [k, id] = b.dataset.buy.split(':'), c = COSMETICS[k].find((x) => x.id === id); if (m.cosTickets < c.cost) return; m.cosTickets -= c.cost; C.owned.push(b.dataset.buy); C[k] = id; persist(); Sound.sfx('levelup'); showCosmetics(back); });
}

/* ================================================== CODEX ================================================== */
function showCodex(tab, back) {
  const m = G.meta;
  const tabs = [['planes', '飞机'], ['gun', '主炮改造'], ['skills', '支援'], ['bmod', '大招改造'], ['syns', '联动'], ['map', '地图'], ['npcs', '伙伴'], ['portals', '洞口'], ['enemies', '敌人']];
  let body = '';
  if (tab === 'planes') body = PLANE_ORDER.map((id) => { const P = PLANES[id], own = m.planes[id]; return `<div class="panel cx ${own ? '' : 'unknown'}"><canvas width="120" height="120" data-plane="${id}"></canvas><div><h3>${own ? P.name : '？？？'} ${rarityChip(P.rarity)}</h3><p>${own ? `${P.look}。大招「${P.burst.name}」：${P.burst.desc}` : '召唤或集齐碎片后解锁。'}</p>${own ? `<p>被动「${P.passive.name}」：${P.passive.desc}</p>` : ''}</div></div>`; }).join('');
  else if (tab === 'gun' || tab === 'skills') body = (tab === 'gun' ? GUN_ORDER : SUPPORT_ORDER).map((id) => { const S = SKILLS[id], seen = m.codex.skills[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi" style="color:${S.color}">${icon(S.icon).replace('class="ic"', `class="ic" style="fill:${S.color}"`)}</div><div><h3>${S.name}${tab === 'gun' ? ' · 主炮改造' : ' · 自动支援'}</h3>${S.lv.map((t, i) => `<p>${i + 1} 级：${t}</p>`).join('')}${S.look ? `<p style="color:var(--lamp2)">看得见的变化：${S.look}</p>` : ''}</div></div>`; }).join('') + (tab === 'gun' ? '<div class="panel cx"><div class="cxi">' + icon('s-homing').replace('class="ic"', 'class="ic" style="fill:#6ff0ff"') + '</div><div><h3>开局规则</h3><p>自动开火，但固定向右、单发、命中即消失；穿透 / 追踪 / 多重 / 爆破只能在局内二选一获得，互相兼容累积，新一局清空。</p></div></div>' : '<div class="panel cx"><div class="cxi">' + icon('s-wing').replace('class="ic"', 'class="ic" style="fill:#fff3c8"') + '</div><div><h3>支援槽</h3><p>同时只带一个支援。出现新的支援时，候选会写明“替换前 → 替换后”。</p></div></div>');
  else if (tab === 'bmod') body = BURST_MOD_ORDER.map((id) => { const B = BURST_MODS[id]; return `<div class="panel cx"><div class="cxi">${icon(B.icon).replace('class="ic"', `class="ic" style="fill:${B.color}"`)}</div><div><h3>${B.name}</h3>${B.lv.map((t, i) => `<p>${i + 1} 级：${t}</p>`).join('')}</div></div>`; }).join('');
  else if (tab === 'syns') body = Object.entries(SYNERGIES).map(([k, v]) => { const [a, b] = v.need, seen = m.codex.syns[k]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi">${icon(SKILLS[a].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[a].color};width:40%;height:40%"`)}${icon(SKILLS[b].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[b].color};width:40%;height:40%"`)}</div><div><h3>${seen ? v.name : '？？？'} · ${v.stream}</h3><p>${SKILLS[a].name} + ${SKILLS[b].name}：两样都拿到后会出现在候选里</p><p>${seen ? v.desc : '选到一次后记录。'}</p></div></div>`; }).join('');
  else if (tab === 'portals') body = Object.values(PORTALS).map((P) => `<div class="panel cx ${m.codex.portals[P.id] || P.id === 'skill' || P.id === 'rare' ? '' : 'unknown'}"><div class="cxi">${icon(PORTAL_SYM[P.id]).replace('class="ic"', `class="ic" style="fill:${P.color}"`)}</div><div><h3>${P.name}</h3><p>${P.effect}</p></div></div>`).join('');
  else if (tab === 'map') body = MAP_ORDER.map((k) => { const O = MAP_OBJECTS[k], seen = m.codex.map[k]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="160" height="160" data-map="${k}"></canvas><div><h3>${O.verb} · ${O.name}</h3><p>${O.hint[0]}</p><p>${O.desc}</p></div></div>`; }).join('') + PLANE_ORDER.map((id) => `<div class="panel cx"><canvas width="120" height="120" data-plane="${id}"></canvas><div><h3>${PLANES[id].name} · 专属地图反应</h3><p>${PLANE_MAP_REACT[id]}</p></div></div>`).join('');
  else if (tab === 'npcs') body = NPC_ORDER.map((id) => { const N = NPCS[id], seen = m.codex.npcs[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="120" height="120" data-npc="${id}" data-mood="${seen ? 'happy' : 'sleep'}"></canvas><div><h3>${N.name}</h3><p>${seen ? N.effect : '还没救出来。飞过救援站前面的宽光环就行。'}</p><p>救出后跟着飞机一起射击；Boss 出现前帮一次忙。</p></div></div>`; }).join('') + GIANT_ORDER.map((id) => { const Gi = GIANTS[id], seen = m.codex.giants[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="160" height="160" data-map="giant" data-sub="${id}"></canvas><div><h3>巨型生物 · ${seen ? Gi.name : '？？？'}</h3><p>${seen ? Gi.effect : '飞到它的眼睛旁边叫醒它。'}</p></div></div>`; }).join('');
  else body = Object.entries(ENEMY_INFO).map(([id, e]) => { const seen = m.codex.enemies[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="120" height="120" data-enemy="${id}"></canvas><div><h3>${seen ? e.name : '？？？'}</h3><p>${seen ? e.desc : '在航线上遇见后记录。'}</p></div></div>`; }).join('');
  const el = showScreen('codex', `${backBtn()}
    <div class="screen-title"><h2>图鉴</h2><p>飞机、主炮改造、支援、大招改造、联动、地图、伙伴、洞口、敌人</p></div>
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
  const val = { firstKill: [last && last.firstKill, avg('firstKill')], firstSkill: [last && last.firstSkill, avg('firstSkill')], choiceTime: [last && last.choiceTime, avg('choiceTime')], firstBurst: [last && last.firstBurst, avg('firstBurst')], changes: [last && last.changes, avg('changes')], highlights: [last && last.highlights, avg('highlights')], avgKill: [last && last.avgKill, avg('avgKill')], gap: [last && last.gap, avg('gap')], restart: [m.telemetry.lastRestart, null], second: [c.first_run_ended ? Math.round(((c.second_run_started || 0) / c.first_run_ended) * 100) : null, null], interacts: [last && last.interacts, avg('interacts')], interactTime: [last && last.interactTime, avg('interactTime')], stockIdle: [last && last.stockIdle, avg('stockIdle')] };
  const PG = m.progress, stageRows = STAGE_ORDER.map((id) => { const rs = runs.filter((r) => r.stage === id), ch = rs.map((r) => r.choiceTime).filter((x) => x !== null && x !== undefined), ia = rs.map((r) => r.interacts || 0); return `<tr><td>${id} ${STAGES[id].name}</td><td class="num">${PG.attempts[id] || 0}</td><td class="num">${PG.clears[id] || 0}</td><td class="num">${PG.best[id] ? fmtTime(PG.best[id]) : '—'}</td><td class="num">${ch.length ? (ch.reduce((a, b) => a + b, 0) / ch.length).toFixed(1) + ' 秒' : '—'}</td><td class="num">${ia.length ? (ia.reduce((a, b) => a + b, 0) / ia.length).toFixed(1) : '—'}</td></tr>`; }).join('');
  const fmt = (v, u) => (v === null || v === undefined ? '—' : (Math.round(v * 10) / 10) + (u === '%' ? '%' : u === '秒' ? ' 秒' : ' 次'));
  const judge = (v, T) => (v === null || v === undefined ? '' : (T.cmp === 'le' ? v <= T.target : v >= T.target) ? 'ok' : 'bad');
  const el = showScreen('records', `${backBtn()}
    <div class="screen-title"><h2>记录</h2><p>数据只来自这台设备</p></div>
    <div class="set-wrap">
      <div class="panel set-sec"><h3>航行记录</h3><table class="metrics"><tbody>
        <tr><th>出击次数</th><td class="num">${R.runs}</td></tr><tr><th>通关次数</th><td class="num">${R.clears}</td></tr><tr><th>共享等级</th><td class="num">Lv${m.shared.level}</td></tr><tr><th>大招容量</th><td class="num">${ultCapNow()} 次</td></tr>
        <tr><th>最高连杀</th><td class="num">${R.bestStreak}</td></tr><tr><th>最快通关</th><td class="num">${R.bestTime ? fmtTime(R.bestTime) : '—'}</td></tr>
        <tr><th>单局最多升级选择</th><td class="num">${R.bestCrystals}</td></tr><tr><th>招募次数</th><td class="num">${m.gacha.pulls}</td></tr>
        <tr><th>拥有飞机</th><td class="num">${Object.keys(m.planes).length}/${PLANE_ORDER.length}</td></tr>
        <tr><th>地图互动</th><td class="num">${m.stats.interacts || 0}</td></tr><tr><th>救出的伙伴</th><td class="num">${Object.keys(m.codex.npcs || {}).length}/${NPC_ORDER.length}</td></tr><tr><th>唤醒的巨型生物</th><td class="num">${Object.keys(m.codex.giants || {}).length}/${GIANT_ORDER.length}</td></tr>
      </tbody></table></div>
      <div class="panel set-sec"><h3>按关卡看</h3><table class="metrics"><thead><tr><th>关卡</th><th>出击</th><th>通关</th><th>最快</th><th>选择耗时</th><th>互动次数</th></tr></thead><tbody>${stageRows}</tbody></table></div>
      <div class="panel set-sec"><h3>数据验收</h3><table class="metrics"><thead><tr><th>指标</th><th>最近一局</th><th>平均</th><th>目标</th></tr></thead><tbody>
        ${METRIC_TARGETS.map((T) => { const [a, b] = val[T.id]; return `<tr><td>${T.name}</td><td class="num ${judge(a, T)}">${fmt(a, T.unit)}</td><td class="num ${judge(b, T)}">${fmt(b, T.unit)}</td><td>${T.cmp === 'le' ? '≤' : '≥'}${T.target}${T.unit === '%' ? '%' : T.unit === '秒' ? ' 秒' : ' 次'}</td></tr>`; }).join('')}
      </tbody></table><p class="dim-text" style="font-size:var(--fs-xs);margin:0">失败后重开时间：从结算页出现到点「再来一局」。第二局点击率：打完第一局后开始第二局的比例。</p></div>
      <div class="panel set-sec"><h3>埋点计数</h3><table class="metrics"><tbody>${Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('') || '<tr><td>还没有数据</td></tr>'}</tbody></table>
        <button class="btn" id="rec-export" type="button" hidden>${icon('i-trophy')} 导出测试数据（JSON）</button></div>
    </div>`, { bg: 'hub', back, label: '记录' });
  const dl = G.cap.downloads, btn = $('#rec-export', el);
  if (dl) {
    btn.hidden = false;
    btn.onclick = async () => {
      const data = JSON.stringify({ game: '梦潮：回声航线', version: 'v0.7', exportedAt: new Date().toISOString(), records: m.records, stats: m.stats, shared: m.shared, progress: m.progress, telemetry: m.telemetry }, null, 2);
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
        <div class="opt"><span>拖动灵敏度<small>鼠标拖动的距离 × 这个倍率</small></span><input type="range" id="set-drag" min="0.6" max="1.8" step="0.1" value="${s.dragSens}" aria-label="拖动灵敏度"></div>
        ${tog('bigButtons', '放大爆发按钮')}
        ${tog('showHitbox', '显示碰撞核心', '飞机中间的小白点才是受击范围')}
        <p class="dim-text" style="font-size:var(--fs-xs);margin:0">键鼠：WASD / 方向键移动，也可以按住鼠标拖动；空格释放大招。手柄（含 Steam Deck）：左摇杆移动，任意主按钮释放大招。</p>
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
        <p class="dim-text" style="font-size:var(--fs-xs);margin:0">进度自动保存在本机${Store.ok ? '' : '（当前环境拒绝了本地存储，关掉游戏后进度不会保留）'}。</p>
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
  const r0 = { build: w.buildSummary() };
  const skills = `<div class="row wrap">${buildChips(r0)}</div>` + (w.picks.length ? '' : '<span class="dim-text">还没选到升级：清波、地图互动、技能洞都会给二选一。</span>');
  const syns = [...w.syn].map((k) => `<div class="row"><span class="chip gold">${SYNERGIES[k].name}</span><span class="dim-text" style="font-size:var(--fs-xs)">${SYNERGIES[k].desc}</span></div>`).join('');
  const comps = w.companions.map((c) => `<div class="row"><span class="chip pink">伙伴 · ${NPCS[c.id].name}</span><span class="dim-text" style="font-size:var(--fs-xs)">${NPCS[c.id].effect}</span></div>`).join('');
  const el = showScreen('pause', `
    <div class="center-col" style="max-width:calc(820px*var(--u))">
      <div class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">暂停</div>
      <div class="panel build-list" style="width:100%"><div class="label">当前 Build ${w.stream ? `· ${w.stream.name}` : ''}（主炮改造可叠加 · 支援一个 · 大招改造一个）</div>${skills}${syns}${comps}</div>
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
function openPreview(pid, back, cos) {
  const P = PLANES[pid];
  const el = showScreen('preview', `
    <div class="preview-box">
      <div class="h-display" style="font-size:var(--fs-l);color:var(--paper)">${P.name} · ${P.burst.name}</div>
      <div class="cvwrap"><canvas id="pv-cv" width="960" height="540" aria-label="${P.burst.name} 预览"></canvas></div>
      <div class="dim-text" style="font-size:var(--fs-s);text-align:center">${P.burst.desc}</div>
      <button class="btn primary" id="pv-close" type="button" autofocus>关闭</button>
    </div>`, { bg: G.bg === 'world' ? 'hub' : G.bg, cls: 'dim', back: () => { stopPreview(); back(); }, label: '大招预览' });
  const cv = $('#pv-cv', el);
  G.preview = { world: new World({ mode: 'preview', W: 1280, plane: pid, cos: cos || G.meta.cosmetics, settings: Object.assign({}, G.meta.settings, { shake: false }), stats: planeStats(G.meta, pid) }), cv, g: cv.getContext('2d'), acc: 0 };
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
      <div class="slots" id="h-slots">
        <div class="slot gunslot" title="主炮改造链"><svg class="ic"><use href="#s-pierce"/></svg><b class="sl">主炮</b></div>
        <div class="slot" title="自动支援"><svg class="ic"><use href="#s-thunder"/></svg><div class="lv"><i></i><i></i><i></i></div><b class="sl">支援</b></div>
        <div class="slot" title="大招改造"><svg class="ic"><use href="#s-bomb"/></svg><div class="lv"><i></i><i></i></div><b class="sl">大招</b></div>
      </div>
      <div class="modrow" id="h-mods"></div>
      <div class="syns" id="h-syns"></div>
      <div class="comps" id="h-comps"></div>
    </div>
    <div class="hud-tc" id="h-tc"><div class="seg-label" id="h-seg"></div><div class="seg-bar"><i id="h-segf"></i></div><div class="wave-label" id="h-wave" hidden></div></div>
    <div class="bossbar" id="h-boss" hidden><div class="bname"><span id="h-bname">Boss</span><small id="h-bphase"></small></div><div class="bar boss" id="h-bbar"><i id="h-bf"></i><span id="h-bticks"></span><span class="shield" id="h-bs"></span></div></div>
    <div class="hud-tr"><button class="pause-btn hb" id="h-pause" type="button" aria-label="暂停">${icon('i-pause')}</button></div>
    <div class="streak" id="h-streak" hidden><div class="n" id="h-sn">0</div><div class="t">连杀</div></div>
    <button class="burst-btn hb" id="h-burst" type="button" aria-label="爆发：${PLANES[w.planeId].burst.name}"><div class="face"><canvas width="160" height="160" data-plane="${w.planeId}"></canvas></div><span class="stock" id="h-stock">0/1</span><span class="k kbd" id="h-bk"></span></button>
    <div class="hint-box" id="h-hint" hidden></div>`;
  hud.hidden = false;
  paintPlaneCanvases(hud);
  $('#h-pause').onclick = () => pauseGame();
  $('#h-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
  const bb = $('#h-burst');
  bb.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Input.press('burst'); });
  G.hudRefs = { hearts: $('#h-hearts'), dust: $('#h-dust'), stream: $('#h-stream'), slots: $$('#h-slots .slot'), mods: $('#h-mods'), syns: $('#h-syns'), comps: $('#h-comps'), tc: $('#h-tc'), seg: $('#h-seg'), segf: $('#h-segf'), wave: $('#h-wave'), boss: $('#h-boss'), bname: $('#h-bname'), bphase: $('#h-bphase'), bbar: $('#h-bbar'), bf: $('#h-bf'), bticks: $('#h-bticks'), bs: $('#h-bs'), streak: $('#h-streak'), sn: $('#h-sn'), burst: bb, stock: $('#h-stock'), bk: $('#h-bk'), hint: $('#h-hint') };
  G.hudLast = {};
  updateHud(true);
  showHint();
}
function hideHud() { const hud = $('#hud'); hud.hidden = true; hud.innerHTML = ''; G.hudRefs = null; $('#stage').classList.remove('offering'); }
function setText(el, key, v) { if (G.hudLast[key] !== v) { G.hudLast[key] = v; el.textContent = v; } }
const GUN_SHORT = { pierce: '穿', homing: '追', multi: '多', bomb: '爆' };
function setSlot(el, on, iconId, color, pips, lv, title) {
  el.classList.toggle('on', on);
  if (!on) return;
  el.style.setProperty('--sc', color); el.firstElementChild.firstElementChild.setAttribute('href', '#' + iconId); el.title = title;
  const lvEl = el.querySelector('.lv'); if (lvEl) lvEl.innerHTML = Array.from({ length: pips }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('');
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function updateHud(force) {
  const w = G.world, R = G.hudRefs; if (!w || !R) return;
  if (force) G.hudLast = {};
  const h = w.hud(), L = G.hudLast;
  const offering = !!(w.offer && w.offer.st !== 'confirm');
  if (L.offering !== offering) { L.offering = offering; $('#stage').classList.toggle('offering', offering); } // 选择升级时淡化横幅和轻提示，不挡卡片
  const hk = `${h.hp}/${h.maxHp}`;
  if (L.hp !== hk) { L.hp = hk; let s = ''; for (let i = 0; i < h.maxHp; i++) s += `<svg class="${i < h.hp ? '' : 'off'}" aria-hidden="true"><use href="#i-heart"/></svg>`; R.hearts.innerHTML = s; R.hearts.setAttribute('aria-label', `生命 ${h.hp}/${h.maxHp}`); }
  setText(R.dust, 'dust', String(h.dust));
  setText(R.stream, 'stream', h.stream || '');
  // 三个槽：主炮改造链（只显示最高阶造型 + 各改造等级）/ 支援 / 大招改造
  const gk = GUN_ORDER.map((id) => h.gun[id]).join('');
  if (L.gun !== gk) {
    L.gun = gk; const top = GUN_ORDER.filter((id) => h.gun[id]).sort((a, b) => h.gun[b] - h.gun[a])[0];
    setSlot(R.slots[0], !!top, top ? SKILLS[top].icon : 's-pierce', top ? SKILLS[top].color : '#fff', 0, 0, top ? GUN_ORDER.filter((id) => h.gun[id]).map((id) => `${SKILLS[id].name} Lv${h.gun[id]}`).join(' · ') : '主炮：固定向前单发');
    R.mods.innerHTML = GUN_ORDER.filter((id) => h.gun[id]).map((id) => `<span style="color:${SKILLS[id].color}">${GUN_SHORT[id]}${h.gun[id]}</span>`).join('');
  }
  const sk = h.support ? h.support.id + h.support.lv : '';
  if (L.sup !== sk) { L.sup = sk; const S = h.support && SKILLS[h.support.id]; setSlot(R.slots[1], !!S, S ? S.icon : 's-thunder', S ? S.color : '#fff', 3, h.support ? h.support.lv : 0, S ? `${S.name} Lv${h.support.lv}` : '自动支援'); }
  const bk = h.bmod ? h.bmod.id + h.bmod.lv : '';
  if (L.bm !== bk) { L.bm = bk; const B = h.bmod && BURST_MODS[h.bmod.id]; setSlot(R.slots[2], !!B, B ? B.icon : 's-bomb', B ? B.color : '#fff', 2, h.bmod ? h.bmod.lv : 0, B ? `${B.name} Lv${h.bmod.lv}` : '大招改造'); }
  const synk = h.syns.join(',');
  if (L.syn !== synk) { L.syn = synk; R.syns.innerHTML = h.syns.map((k) => `<span class="chip gold">${SYNERGIES[k].name}</span>`).join(''); }
  const ck = (h.companions || []).join(',');
  if (L.comp !== ck) { L.comp = ck; R.comps.innerHTML = (h.companions || []).map((id) => `<canvas width="64" height="64" data-npc="${id}" title="${NPCS[id].name}：${NPCS[id].effect}"></canvas>`).join(''); paintPlaneCanvases(R.comps); }
  if (h.boss) {
    if (L.bossOn !== true) { L.bossOn = true; R.boss.hidden = false; R.tc.hidden = true; R.bname.textContent = h.boss.name; R.bticks.innerHTML = (h.boss.ticks || [70, 35]).map((x) => `<span class="tick" style="left:${x}%"></span>`).join(''); }
    setText(R.bphase, 'bph', h.boss.phaseName + (h.boss.weak ? ' · 弱点暴露' : ''));
    const bw = `${(h.boss.hp / h.boss.maxHp) * 100}%`; if (L.bw !== bw) { L.bw = bw; R.bf.style.width = bw; }
    const sw = h.boss.shield > 0 ? `${(h.boss.shield / h.boss.shieldMax) * 100}%` : '0%'; if (L.sw !== sw) { L.sw = sw; R.bs.style.width = sw; }
    const pc = 'bar boss p' + h.boss.phase; if (L.bcls !== pc) { L.bcls = pc; R.bbar.className = pc; }
  } else {
    if (L.bossOn !== false) { L.bossOn = false; R.boss.hidden = true; R.tc.hidden = false; }
    const lbl = h.phase === 'portal' ? `${h.stage} · 前方分岔 · 飞进一个洞口` : h.phase === 'boss' ? STAGES[h.stage].bossName : `${h.stage} · 第 ${h.seg}/${h.segs} 段 · ${h.segType === 'normal' ? '航行' : PORTALS[h.segType] ? PORTALS[h.segType].name : ''}`;
    setText(R.seg, 'seg', lbl);
    const sw = h.phase === 'portal' ? '100%' : `${Math.round(h.segU * 100)}%`; if (L.segw !== sw) { L.segw = sw; R.segf.style.width = sw; }
    const wv = h.wave ? `清波 ${Math.min(h.wave[0], h.wave[1])}/${h.wave[1]} · 达成后升级二选一` : '';
    if (L.wave !== wv) { L.wave = wv; R.wave.hidden = !wv; R.wave.textContent = wv; }
  }
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
  // 大招：进度环 + 库存 / 容量
  const p = h.stock >= h.cap ? 100 : Math.round(h.burst * 100);
  if (L.bp !== p) { L.bp = p; R.burst.style.setProperty('--p', p); }
  if (L.ready !== h.ready) { L.ready = h.ready; R.burst.classList.toggle('ready', h.ready); }
  setText(R.stock, 'stock', `${h.stock}/${h.cap}`);
  const key = Input.hintFor('burst');
  if (L.bk !== key) { L.bk = key; R.bk.textContent = key; R.bk.hidden = !key; }
}
function drainWorldEvents() {
  const w = G.world; if (!w) return;
  if (w.done) { w.events.length = 0; return; }
  while (w.events.length) {
    const e = w.events.shift();
    switch (e.type) {
      case 'pick': toast(`${e.tag} · ${e.name} ${e.lv}：${e.desc}`, e.color, null, 2600); break;
      case 'offer': if (!e.first) toast(e.source === 'house' ? '梦灯屋转出两个主炮改造' : e.source === 'mine' ? '矿脉里是两个兼容强化' : e.source === 'npc' ? '伙伴搬出两个支援技能' : e.source === 'retry' ? '上次错过的奖励又出现了' : e.source === 'rare' ? '稀有二选一' : '升级二选一', '#ffe38a', null, 1500); break;
      case 'backlog': toast('敌人太多了：飞向附近的梦灯屋或星砂矿，互动时附近不会再刷怪', '#ffb2a8', null, 2600); break;
      case 'stream': banner(`${e.name}成型！`, '这一局的 Build 有名字了', 1.9, 'rgba(255,215,106,.8)', 3); break;
      case 'streak': if (e.n >= 50) banner(`${e.n} 连杀！`, { 50: '星环清场', 100: '金色强化出现' }[e.n] || '星环清场', 1.3, 'rgba(255,159,207,.8)', 1); else toast(`${e.n} 连杀！${{ 10: '小爆炸', 30: '屏幕开始发光' }[e.n]}`, '#aeeaff'); break;
      case 'elite': toast('精英出现 · 击败它能充不少大招', '#ff9d8c', 'n-crown'); Sound.setBoost('tension', 0.3); setTimeout(() => Sound.setBoost('tension', 0), 12000); break;
      case 'segment': if (e.segType !== 'normal' && PORTALS[e.segType]) banner(PORTALS[e.segType].name, PORTALS[e.segType].effect, 1.3, PORTALS[e.segType].color, 1); break;
      case 'boss': { const S = w.stage; banner(S.bossName, S.boss === 'clock' ? '第一乐章 · 指针卡住' : '本关队长 · 打倒它就通关', 2.4, 'rgba(255,90,110,.7)', 4); Sound.setMode('boss1'); break; }
      case 'bossResponse': banner(e.title, e.sub, 2.6, 'rgba(255,215,106,.8)', 3); break;
      case 'phase': banner(e.name, e.captain ? '攻击更密，还带着散兵' : e.n === 2 ? '攻击越来越快，安全区在缩小' : '弹幕会逆行，消失的弹幕会重演', 1.8, null, 3); break;
      case 'flag': banner('', e.text, e.dur || 1, null, 1); break;
      case 'burstReady': toast(`${PLANES[w.planeId].burst.name} 可用 · 库存 ${e.stock || 1}/${e.cap || 1}`, '#ffe38a', 'i-play', 1600); break;
      case 'gold': banner('金色强化！', '大招充满 · 射速提高', 1.6, 'rgba(255,215,106,.9)'); break;
      case 'hint': G.hintId = e.id; showHint(); break;
      case 'maphint': G.mapHint = e.kind; showHint(); break;
      case 'mapDone': banner(`${e.verb}${e.name}！`, e.desc, 1.8, hexA(MAP_OBJECTS[e.kind].color, 0.8), 3); if (e.kind === 'npc') toast(`${e.name} 加入队伍，会一直跟着你飞`, NPCS[e.sub].color, null, 2400); break;
    }
  }
}
function showHint() {
  const R = G.hudRefs; if (!R) return;
  if (G.mapHint && MAP_OBJECTS[G.mapHint]) { const H = MAP_OBJECTS[G.mapHint].hint; R.hint.hidden = false; R.hint.innerHTML = `${esc(H[0])}<small>${esc(H[1])}</small>`; return; }
  const id = G.hintId;
  if (!id) { R.hint.hidden = true; return; }
  const d = Input.device;
  const T = {
    move: [d === 'touch' ? '按住屏幕任意位置拖动飞机' : d === 'pad' ? '左摇杆移动飞机' : 'WASD / 方向键移动，也可以按住鼠标拖动', '自动开火，但子弹只会笔直向右：移动飞机对准敌人。'],
    offer: ['飞进一个方案，停一下就选好了', '靠近只是预览；进确认圈停 0.35 秒才生效，另一个会关掉。'],
    portal: ['前方分岔：飞进一个洞口', '蓝色闪电 = 技能 · 金色星星 = 稀有 · 红色王冠 = Boss · 绿色爱心 = 回复'],
    burst: [d === 'touch' ? '点右下角头像（或双击屏幕）释放专属大招' : d === 'pad' ? '按 A 释放专属大招' : `按 ${Input.hintFor('burst')} 释放专属大招`, `${PLANES[G.world.planeId].burst.name}：${PLANES[G.world.planeId].burst.desc}`],
  }[id];
  if (!T) { R.hint.hidden = true; return; }
  R.hint.hidden = false; R.hint.innerHTML = `${esc(T[0])}<small>${esc(T[1])}</small>`;
}
