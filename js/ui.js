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
  Sound.setMode('hub'); Sound.focus(false); G.world = null; Input.gameActive = false; hideHud(); stopPreview();
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
      <button class="icon-btn" id="hub-mp" type="button">${icon('i-team')}<span>联机</span></button>
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
  $('#hub-mp', el).onclick = () => { Sound.sfx('ui'); showMultiplayer(showHub); };
  $('#hub-settings', el).onclick = () => { Sound.sfx('ui'); showSettings(showHub); };
}
/* 大厅“下一步”：每次都按当前余额、成本、天赋点实时计算，不用结算时存下的旧建议 */
function nextStep() {
  const m = G.meta, cost = nextLevelCost(), pts = treePoints(m, m.planes[m.current]), next = nextStage(), lv = m.shared.level;
  if (canLevelUp()) return `星尘够升级了：共享等级 Lv${lv} → Lv${lv + 1}（${cost} 星尘）`;
  if (pts > 0) return `${PLANES[m.current].name}还有 ${pts} 个天赋点没点`;
  if (m.tickets > 0 && Object.keys(m.planes).length < PLANE_ORDER.length) return `有 ${m.tickets} 张招募券，可以招募新飞机`;
  return `挑战 ${next} ${STAGES[next].name}${cost !== null ? ` · 升级还差 ${Math.ceil(cost - m.stardust)} 星尘` : ''}`;
}
function lureRows(L) {
  const P = L.plan || buildPlan(null, L.target || L.buildName || null, 0);
  const path = P.path.map((id, i) => `${i ? '<span class="arrow">›</span>' : ''}<span class="chip ${P.have.includes(id) || (id === P.link && P.linkOwned) ? 'owned' : ''}" style="color:${(SKILLS[id] || { color: '#ffd76a' }).color}">${compName(id).replace(/[「」]/g, '')}</span>`).join('');
  return `<div class="lure-row"><span class="label">上一局</span><span><b>${esc(L.stream || '还没成型')}</b></span></div>
    <div class="lure-row"><span class="label">目标</span><span class="lure-path"><b>${esc(P.name)}</b>${path}</span></div>
    <div class="lure-row"><span class="label">缺什么</span><span class="advice">${planHtml(P, false, true)}</span></div>
    <div class="lure-row"><span class="label">出发前</span><span>${esc(nextStep())}</span></div>${L.npc ? `
    <div class="lure-row"><span class="label">想救的</span><span class="lure-npc"><canvas width="64" height="64" data-npc="${L.npc}" data-mood="sleep"></canvas>${esc(NPCS[L.npc].name)}还困在航线上</span></div>` : ''}`;
}

/* ================================================== 联机房间 ================================================== */
/* 2–4 人同屏合作。只同步操作：每人每 1/30 秒的方向 / 大招 / 拖动，各端用同一个种子各自模拟同一局。
   网页版的转发：Claude Artifact 的房间（打开同一个链接的人互相可见）；不在 Claude 里打开时退回到“同一浏览器多窗口”，用来测试。 */
function mpProfile() {
  const m = G.meta, id = m.current;
  return { name: (m.nick || '').trim() || '玩家', plane: id, prof: { s: compactStats(planeStats(m, id)), u: ultCapNow(), c: { exp: m.cosmetics.exp, trail: m.cosmetics.trail } } };
}
function showMultiplayer(back) {
  const m = G.meta; if (!m.nick) m.nick = '玩家' + Math.floor(100 + Math.random() * 900);
  hideHud(); G.world = null; Input.gameActive = false; stopPreview();
  const leaveAndBack = () => { Lobby.leave(); Lobby.onUpdate = null; back(); };
  const el = showScreen('mp', `${backBtn()}
    <div class="screen-title"><h2>联机</h2><p>2–4 人同屏合作 · 升级和掉落各拿各的 · 倒下的队友飞过去就能救起</p></div>
    <div class="mp-wrap">
      <div class="panel set-sec mp-me">
        <h3>你</h3>
        <label class="mp-nick"><span class="label">昵称</span><input id="mp-nick" maxlength="12" autocomplete="off" spellcheck="false" value="${esc(m.nick)}"></label>
        <div class="row"><canvas width="72" height="72" data-plane="${m.current}" data-happy="1"></canvas><span>${PLANES[m.current].name}<br><small class="dim-text">带着你自己的天赋和共享等级出战</small></span></div>
        <p class="dim-text mp-net" id="mp-net">正在连接…</p>
      </div>
      <div class="panel set-sec mp-main" id="mp-body"><p class="dim-text">正在连接…</p></div>
    </div>`, { bg: 'hub', back: leaveAndBack, label: '联机' });
  const nick = $('#mp-nick', el);
  nick.addEventListener('keydown', (e) => e.stopPropagation()); // 打字时不触发方向键菜单导航
  nick.addEventListener('change', () => { m.nick = nick.value.trim().slice(0, 12) || m.nick; persist(); if (Lobby.code) Lobby.me({ name: m.nick }); });
  let sig = '', stage = G.mpStage || m.progress.selected || nextStage(), delay = 0;
  const paint = () => {
    if (G.screen !== 'mp' || !document.body.contains(el)) { Lobby.onUpdate = null; return; }
    const net = Lobby.net, body = $('#mp-body', el); if (!net) return;
    const rooms = Lobby.openRooms(), room = Lobby.code ? Lobby.room() : null;
    if (Lobby.code && !Lobby.isHost && !room) { Lobby.leave(); toast('房主离开了，房间已解散', '#ffb2a8'); }
    const k = JSON.stringify([Lobby.code, Lobby.isHost, stage, delay, room && room.members.map((x) => [x.peer, x.name, x.plane, x.playing]), room && room.started, !Lobby.code && rooms.map((r) => [r.code, r.members.length, r.started, r.stage, r.members[0].name])]);
    if (k === sig) return; sig = k;
    $('#mp-net', el).textContent = net.kind === 'room' ? '通过 Claude 房间连接：打开同一个游戏链接的人都能看到你的房间。' : '本机测试模式：在这个浏览器里再开一个窗口打开游戏，就能互相看到。（在 Claude 里打开游戏链接才能和别人联机）';
    if (!Lobby.code) {
      body.innerHTML = `<h3>房间</h3>
        <div class="row wrap"><button class="btn primary" id="mp-create" type="button" autofocus>${icon('i-play')} 创建房间</button><span class="dim-text">建好后把同一个链接发给朋友</span></div>
        <div class="mp-list">${rooms.length ? rooms.map((r) => `<div class="mp-room"><b class="mp-code">${esc(r.code)}</b><span>${esc(r.members[0].name)} 的房间 · ${r.members.length}/${MP_MAX} 人${r.started ? ' · 进行中' : r.stage ? ` · ${esc(r.stage)}` : ''}</span><button class="btn small" data-join="${esc(r.code)}" type="button" ${r.started || r.members.length >= MP_MAX ? 'disabled' : ''}>加入</button></div>`).join('') : '<p class="dim-text">现在没有可加入的房间。</p>'}</div>`;
      $('#mp-create', body).onclick = () => { Sound.sfx('select'); Lobby.create(mpProfile()); sig = ''; paint(); };
      $$('[data-join]', body).forEach((b) => b.onclick = () => { Sound.sfx('select'); Lobby.join(b.dataset.join, mpProfile()); sig = ''; paint(); });
      return;
    }
    const ms = room ? room.members : [], host = Lobby.isHost, n = ms.length;
    const chips = STAGE_ORDER.map((id) => { const ok = stageUnlocked(id); return `<button class="stage-chip ${id === stage ? 'sel' : ''} ${ok ? '' : 'locked'}" data-mst="${id}" type="button" ${ok ? '' : 'aria-disabled="true"'}><b>${id}</b><span>${STAGES[id].name}</span>${ok ? '' : icon('i-lock')}</button>`; }).join('');
    const dOpts = net.kind === 'room' ? [[4, '短'], [5, '标准'], [8, '长']] : [[3, '短'], [5, '标准'], [8, '长']], dNow = delay || (net.kind === 'room' ? 5 : 3);
    body.innerHTML = `<h3>房间 <b class="mp-code">${esc(Lobby.code)}</b> <small class="dim-text">${n}/${MP_MAX} 人</small></h3>
      <div class="mp-members">${ms.map((x, i) => `<div class="mp-mem ${x.isMe ? 'me' : ''}"><i style="background:${PLAYER_COLORS[i % 4]}"></i><canvas width="56" height="56" data-plane="${x.plane}"></canvas><span><b>${esc(x.name)}</b>${x.isMe ? ' <small class="chip">你</small>' : ''}${x.host ? ' <small class="chip gold">房主</small>' : ''}<br><small class="dim-text">${PLANES[x.plane].name}</small></span></div>`).join('')}</div>
      ${host ? `<div class="label">关卡</div><div class="stage-row">${chips}</div>
        <div class="row wrap"><span class="label">网络缓冲</span><div class="seg" role="group">${dOpts.map(([v, t]) => `<button type="button" data-md="${v}" class="${v === dNow ? 'on' : ''}">${t}</button>`).join('')}</div><span class="dim-text">卡顿多就调长，操作会晚一点点生效</span></div>
        <div class="row wrap"><button class="btn primary big" id="mp-start" type="button" ${n >= 2 ? '' : 'disabled'}>${icon('i-hangar')} 开始 · ${stage} ${STAGES[stage].name}</button>${n < 2 ? '<span class="dim-text">至少 2 人才能开始</span>' : ''}</div>`
        : `<p class="dim-text">${room && room.started ? '这一局已经开始了，等下一局。' : '等房主选关开始…'}</p>`}
      <div class="row"><button class="btn coral small" id="mp-leave" type="button">离开房间</button></div>`;
    paintPlaneCanvases(body);
    $('#mp-leave', body).onclick = () => { Sound.sfx('uiBack'); Lobby.leave(); sig = ''; paint(); };
    $$('[data-mst]', body).forEach((b) => b.onclick = () => { if (!stageUnlocked(b.dataset.mst)) { Sound.sfx('denied'); toast('你还没解锁这一关', '#ffb2a8'); return; } Sound.sfx('ui'); stage = G.mpStage = b.dataset.mst; Lobby.me({ stage }); paint(); });
    $$('[data-md]', body).forEach((b) => b.onclick = () => { Sound.sfx('ui'); delay = +b.dataset.md; paint(); });
    const sb = $('#mp-start', body); if (sb) sb.onclick = () => { if (!Lobby.start(stage, dNow)) { Sound.sfx('denied'); return; } Sound.sfx('select'); };
  };
  Lobby.onStart = (st) => { if (G.mpRun) return false; startMpRun(st); return true; };
  Lobby.connect().then(() => { if (Lobby.code) Lobby.me(mpProfile()); Lobby.onUpdate = paint; paint(); }).catch(() => { $('#mp-body', el).innerHTML = '<p class="dim-text">连接失败，请刷新页面重试。</p>'; });
}
function startMpRun(st) {
  const idx = Lobby.beginSession(st); if (idx < 0) return false;
  Lobby.onUpdate = null;
  startRun(st.stage, { st, idx });
  return true;
}

/* ================================================== RUN ================================================== */
function startRun(stageId, mp) {
  ensureTasks();
  const m = G.meta, id = m.current;
  stageId = mp ? mp.st.stage : stageId || m.progress.selected || nextStage();
  if (!mp && !stageUnlocked(stageId)) stageId = nextStage();
  m.progress.selected = stageId; m.progress.attempts[stageId] = (m.progress.attempts[stageId] || 0) + 1;
  if (G.endShownAt) { const dt = (performance.now() - G.endShownAt) / 1000; m.telemetry.lastRestart = Math.round(dt * 10) / 10; G.endShownAt = null; }
  if (m.records.runs === 1) Tele.log('second_run_started');
  const first = !mp && !m.firstRunDone && stageId === '1-1', cap = ultCapNow(); m.ultCap = cap;
  G.mpRun = mp || null; G.mpLock = !!mp; if (mp) window.dispatchEvent(new Event('resize')); // 多人：画面宽度固定 1280，各端世界一致
  m.records.runs++; Tele.log('run_started', { stage: stageId });
  applySettings(); clearScreens(); stopPreview();
  G.bg = 'world'; G.paused = false; G.mapHint = null; G.hintId = null;
  G.tutorial = { on: !mp && !m.tutorialDone }; // 联机不显示单人的开局教学清单
  G.world = new World({
    mode: 'run', W: mp ? 1280 : G.W, plane: id, stage: stageId, ultCap: cap, stats: planeStats(m, id), first,
    seed: mp ? mp.st.seed : undefined, me: mp ? mp.idx : 0,
    players: mp ? mp.st.roster.map((r) => ({ id: r.peer, name: r.name, plane: r.plane, stats: r.stats || planeStats(null, r.plane), ultCap: r.ultCap || 1, cos: r.cos || {} })) : undefined, target: (m.nextHint && (m.nextHint.target || m.nextHint.buildName)) || null, tutorial: !m.tutorialDone, settings: m.settings, scene: G.sea, cos: m.cosmetics, seenMap: Object.keys(m.codex.map || {}),
    cb: {
      onEnd: onRunEnd,
      onSkill: (sid) => { m.codex.skills[sid] = 1; },
      onSynergy: (key) => { m.codex.syns[key] = 1; },
      onSeenEnemy: (t) => { if (t) m.codex.enemies[t] = 1; },
      onPortal: (t) => { if (t === 'boss' && stageId === '1-3') m.codex.enemies.clock = 1; },
      onMap: (kind, sub) => { m.codex.map[kind] = 1; if (kind === 'npc') m.codex.npcs[sub] = 1; if (kind === 'giant') m.codex.giants[sub] = 1; },
    },
  });
  Sound.setMode('combat'); Sound.setCardMods([]); Sound.focus(false);
  Input.gameActive = true; Input.clearPresses();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  buildHud();
  // 升级仪式把图标飞进真实的 HUD 槽位：把 DOM 槽位换算成画布坐标
  G.world.slotPos = (k) => {
    const R = G.hudRefs; if (!R) return null;
    const el = k === 'gun' ? R.slots[0] : k === 'support' ? R.slots[1] : k === 'bmod' ? R.slots[2] : k === 'link' ? R.syns : R.burst;
    const sr = $('#stage').getBoundingClientRect(), r = el.getBoundingClientRect(); if (!r.width && k !== 'link') return null;
    return { x: (r.left + (r.width || 60) / 2 - sr.left) / G.scale, y: (r.top + (r.height || 20) / 2 - sr.top) / G.scale };
  };
  if (mp) { G.mpLoop = { t0: performance.now(), steps: 0, dx: 0, dy: 0, waitT: 0, desyncShown: false, last: performance.now() }; banner(`${stageId} ${STAGES[stageId].name} · ${mp.st.roster.length} 人联机`, '升级和掉落各拿各的：别人的掉落你看不见', 2.4); }
  else banner(`${stageId} ${STAGES[stageId].name}`, `${PLANES[id].name} · 目标一个一个来：先清掉普通怪群`, 2);
  persist();
}
function onRunEnd(res) {
  if (G.world && G.world._rewarded) return; // 奖励只发一次
  if (G.mpRun) { Lobby.endGame(); G.mpRun = null; G.mpLoop = null; G.mpLock = false; window.dispatchEvent(new Event('resize')); }
  if (G.world) G.world._rewarded = true;
  const m = G.meta, st = res.stats, S = STAGES[res.stage], P = m.progress, first = !m.firstRunDone;
  const firstClear = res.win && !P.cleared[res.stage];
  // 星尘：首通约 120（1-1），重复通关 60%，失败按完成进度 30~90；另加少量本局收集
  // 星尘 = 关卡奖励（首通 / 重复通关 60% / 失败按完成度）+ 本局星砂折算（每 50 星砂 = 1 星尘）
  const base = res.win ? (firstClear ? S.reward : Math.round(S.reward * 0.6)) : Math.round(lerp(S.fail[0], S.fail[1], res.progress));
  const sand = Math.floor(st.dust), sandStar = Math.floor(sand / 50), dust = base + sandStar, before = Math.floor(m.stardust);
  const baseLabel = res.win ? (firstClear ? '首通奖励' : '重复通关 60%') : `完成度 ${Math.round(res.progress * 100)}%`;
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
  runs.push({ at: Date.now(), stage: res.stage, win: res.win, plane: res.plane, level: m.shared.level, firstKill: st.firstKill, firstSkill: st.firstSkill, firstBurst: st.firstBurst, changes: st.crystals, highlights: st.highlights, avgKill: res.avgKill, gap: st.gapMax, runT: res.runT, noGoal: st.noGoalMax, backlogs: st.backlogs, goalTimes: res.goalTimes,
    interacts: st.interacts, interactTime: st.interactMax, choiceTime: res.choiceAvg, stockIdle: st.stockIdle, leaks: st.leaks, progress: res.progress, armorFirst: st.armorFirst, armorAfter: st.armorAfter, hurt: res.hurt });
  while (runs.length > 40) runs.shift();
  m.firstRunDone = true;
  const lure = makeLure(res);
  m.nextHint = lure;
  persist();
  G.lastRes = { res, rewards: { dust, base, baseLabel, sand, sandStar, before, after: Math.floor(m.stardust), tickets, cos, frags, firstClear, capUp, newRescues, newbie: first && res.stage === '1-1' && firstClear }, lure };
  showEnd(G.lastRes);
}
/* 下一局的构筑目标：大厅、暂停、结算、升级卡片都用同一个 buildPlan（data.js），不再各说各的 */
function makeLure(res) {
  const m = G.meta, stream = res.stream;
  const saved = new Set(res.companions || []), npc = NPC_ORDER.find((id) => !m.progress.rescued[id] && !saved.has(id)) || null;
  const plan = buildPlan(res.build, null, m.records.runs || 0);
  return { stream, target: plan.name, plan, npc };
}
/* 构筑推荐：围绕一个目标写已有 / 缺少 / 下一步先拿；只差一样的其他联动单独标成备选 */
const compName = (id) => (SKILLS[id] ? SKILLS[id].name : SYNERGIES[id] ? `「${SYNERGIES[id].name}」` : id);
function planHtml(P, now, noHead) {
  if (!P) return '';
  const list = (a) => (a.length ? a.map(compName).join('、') : '无');
  const next = P.done ? '<b>已凑齐</b> 这一局已经完成了这套流派' : `<b>${now ? '下一步先拿' : '下局先拿'}</b> ${compName(P.next)}${P.swap ? `（支援只能带一个，会替换${SKILLS[P.swap].name}）` : ''}${P.next === P.link ? '：两样都有了，升级里出现就选它' : ''}`;
  return `<div class="plan">${noHead ? '' : `<div><b>目标</b> ${esc(P.name)} <span class="dim-text">${esc(P.hint)}</span></div>`}<div><b>已有</b> ${list(P.have)} · <b>缺少</b> ${list(P.miss.concat(P.link && !P.linkOwned && P.miss.length ? [P.link] : []))}</div><div>${next}</div>${P.alt ? `<div class="alt"><b>备选路线</b> 已有 ${compName(P.alt.have)}，再拿 ${compName(P.alt.miss)} 可凑成「${SYNERGIES[P.alt.key].name}」</div>` : ''}</div>`;
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
  Input.gameActive = false; hideHud(); Sound.setMode('result'); Sound.focus(false); // 仪式中途结束也把音量压低撤掉
  $('#toast').innerHTML = ''; $('#banner').innerHTML = ''; banner._until = 0;
  G.endShownAt = performance.now();
  const r = E.res, st = r.stats, rw = E.rewards, P = PLANES[r.plane], S = STAGES[r.stage], m = G.meta;
  const nextId = STAGE_ORDER[STAGE_ORDER.indexOf(r.stage) + 1], cost = nextLevelCost();
  const fragTxt = Object.entries(rw.frags).map(([k, v]) => `${PLANES[k].name}碎片 +${v}`).join('、');
  const journey = (r.journey || []).map((j) => `<span class="jchip" style="--jc:${MAP_OBJECTS[j.kind].color}" title="${esc(j.desc || '')}"><canvas width="72" height="72" ${j.kind === 'npc' ? `data-npc="${j.sub}"` : `data-map="${j.kind}"${j.sub ? ` data-sub="${j.sub}"` : ''}`}></canvas><b>${j.verb}</b>${esc(j.name)}</span>`).join('');
  const grow = cost === null ? '<p class="dim-text">共享等级已满</p>'
    : m.stardust >= cost ? `<p><b class="good">这次已攒够升级！</b> 星尘 ${Math.floor(m.stardust)} / ${cost}</p><button class="btn primary small" id="end-lv" type="button">${icon('i-dust')} 一键升到 Lv${m.shared.level + 1}</button>`
    : `<p>星尘 ${Math.floor(m.stardust)} / ${cost}</p><div class="bar-mini"><i style="width:${(m.stardust / cost) * 100}%"></i></div><p class="dim-text" style="font-size:var(--fs-xs)">还差 ${Math.ceil(cost - m.stardust)} 星尘${rw.dust > 0 ? `（按这局 +${rw.dust} 估算，约还要 ${Math.ceil((cost - m.stardust) / rw.dust)} 局）` : ''}</p>`;
  const el = showScreen('end', `
    <div class="center-col">
      <div class="h-display" style="font-size:var(--fs-xl);color:${r.win ? 'var(--lamp2)' : 'var(--paper)'}">${r.win ? `${r.stage} ${S.name} 通关！` : r.abandoned ? '本局结束' : r.mp ? `全队 ${r.team.length} 架都被击落了` : `${P.name}被击落了`}</div>
      ${r.mp ? `<div class="dim-text">联机 · ${r.team.map((q) => esc(q.name) + (q.gone ? '（中途离开）' : '')).join('、')}</div>` : ''}
      <div class="dim-text">${r.win ? `出击 ${fmtTime(r.runT)} · ${S.bossName} ${fmtTime(r.bossTime)}${rw.capUp ? ` · <b class="good">大招容量升到 ${rw.capUp} 次（所有飞机）</b>` : ''}` : `出击 ${fmtTime(r.runT)} · 完成度 ${Math.round(r.progress * 100)}% · 成长资源照常结算`}</div>
      ${deathHtml(r)}
      ${(r.memories && r.memories.length) || r.clue ? `<div class="memo">${r.memories && r.memories.length ? `<span><b>这一局</b> ${r.memories.map(esc).join(' · ')}</span>` : ''}${r.clue ? `<span class="clue"><b>还没见过</b> ${esc(r.clue)}</span>` : ''}</div>` : ''}
      <div class="statrow">${[['击破', st.kills], ['最高连杀', st.maxStreak], ['升级选择', st.crystals], ['联动', st.syns], ['破甲', st.breaks || 0], ['大招', st.bursts]].map(([k, v]) => `<div class="stat-pill"><span class="num">${v}</span><span>${k}</span></div>`).join('')}</div>
      <div class="rewards">
        <span class="reward" title="星尘到账：${rw.before} → ${rw.after}">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}星尘 +${rw.dust} <small class="dim-text">= 关卡奖励 ${rw.base}（${rw.baseLabel}）+ 本局星砂 ${rw.sand} ÷ 50 = ${rw.sandStar} · 账户 ${rw.before} → ${rw.after}</small></span>
        <span class="reward">${icon('i-ticket').replace('class="ic"', 'class="ic" style="fill:#ffe38a"')}招募券 +${rw.tickets}${rw.newRescues.length ? `（含救援 ${rw.newRescues.length}）` : ''}</span>
        ${rw.cos ? `<span class="reward">${icon('i-cos').replace('class="ic"', 'class="ic" style="fill:#ff9fcf"')}外观票 +${rw.cos}</span>` : ''}
        ${fragTxt ? `<span class="reward">${icon('i-frag').replace('class="ic"', 'class="ic" style="fill:#aeeaff"')}${esc(fragTxt)}</span>` : ''}
      </div>
      <div class="end-grid3">
        <div class="panel end-card"><div class="label">① 成长 · 共享等级 Lv${m.shared.level}</div>${grow}<span class="dim-text" style="font-size:var(--fs-xs)">${sharedLine()} · 所有飞机一起变强</span></div>
        <div class="panel end-card"><div class="label">② Build ${r.stream ? `· <span style="color:var(--lamp2)">${esc(r.stream)}</span>` : ''}</div><div class="row wrap">${buildChips(r)}</div>
          ${journey ? `<div class="jrow">${journey}</div>` : ''}
          <div class="advice">${planHtml(E.lure.plan)}</div></div>
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
  $('#end-again', el).onclick = () => { Sound.sfx('select'); if (r.mp) showMultiplayer(showHub); else startRun(r.stage); };
  if (r.mp) { $('#end-again', el).innerHTML = `${icon('i-play')} 回到联机房间`; const en2 = $('#end-next', el); if (en2) en2.hidden = true; }
  const en = $('#end-next', el); if (en) en.onclick = () => { Sound.sfx('select'); startRun(nextId); };
  const eg = $('#end-gacha', el); if (eg) eg.onclick = () => { Sound.sfx('ui'); showGacha(showHub); };
  const lv = $('#end-lv', el); if (lv) lv.onclick = () => { if (levelUp()) showStarMap(m.current, () => showEnd(E), true); };
  setupDreamLog(el, E);
}
/* 失败复盘：只在被击落时出现（主动结束不显示），按这一局实际记下的受伤来源挑最常见的一类，给一条能照做的建议 */
function deathHtml(r) {
  if (r.win || r.abandoned || !r.hurt) return '';
  const top = Object.entries(r.hurt).sort((a, b) => b[1] - a[1] || (b[0] === r.lastHurt) - (a[0] === r.lastHurt))[0];
  if (!top || !HURT_TIPS[top[0]]) return '';
  const T = HURT_TIPS[top[0]], last = r.lastHurt && r.lastHurt !== top[0] && HURT_TIPS[r.lastHurt] ? ` · 最后一下是${HURT_TIPS[r.lastHurt].label}` : '';
  return `<div class="death"><span><b>这局主要被</b> ${esc(T.label)}击中 ${top[1]} 次${esc(last)}</span><span><b>下局试试</b> ${esc(T.tip)}</span></div>`;
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
/* 招募结果：只有第一次获得的飞机单独展示；重复的直接并进汇总；随时可以“跳过，查看全部” */
function showReveal(res, i, back) {
  while (i < res.length && !res[i].isNew) i++;
  if (i >= res.length) return res.length > 1 ? showRevealSummary(res, back) : res[0] && !res[0].isNew ? showRevealSummary(res, back) : showGacha(back);
  const it = res[i], P = PLANES[it.pid], R = RARITY[it.r], left = res.slice(i + 1).some((x) => x.isNew);
  Sound.sfx('reveal', { r: it.r });
  const el = showScreen('reveal', `
    <div class="reveal-card" style="--rc:${R.color};--rg:${R.glow}">
      <span class="newbadge">NEW!</span>
      <canvas width="420" height="420" data-plane="${it.pid}" data-glow="${R.glow}" data-happy="1"></canvas>
      <div class="row">${rarityChip(it.r)}<span class="dim-text">${P.look}</span></div>
      <h3>${P.name}</h3>
      <div class="burst-name">专属大招 · ${P.burst.name}</div>
      <div class="dim-text" style="font-size:var(--fs-s);max-width:36em">${P.burst.desc}</div>
    </div>
    <div class="row wrap" style="justify-content:center">
      <button class="btn cyan" id="rv-prev" type="button">${icon('i-play')} 大招预览</button>
      <button class="btn" id="rv-use" type="button">设为出战</button>
      ${res.length > 1 ? `<button class="btn" id="rv-skip" type="button">跳过，查看全部</button>` : ''}
      <button class="btn primary" id="rv-next" type="button" autofocus>${left ? '下一架新飞机' : res.length > 1 ? '查看全部' : '完成'}</button>
    </div>`, { bg: 'hub', cls: 'dim', label: '招募结果', back: () => showRevealSummary(res, back) });
  $('#rv-next', el).onclick = () => { Sound.sfx('card'); showReveal(res, i + 1, back); };
  const sk = $('#rv-skip', el); if (sk) sk.onclick = () => { Sound.sfx('card'); showRevealSummary(res, back); };
  $('#rv-use', el).onclick = () => { G.meta.current = it.pid; persist(); Sound.sfx('select'); toast(`${P.name} 已设为出战`, '#ffe38a'); $('#rv-use', el).disabled = true; };
  $('#rv-prev', el).onclick = () => openPreview(it.pid, () => showReveal(res, i, back));
}
function showRevealSummary(res, back) {
  const news = res.filter((x) => x.isNew), frags = {};
  for (const x of res) if (!x.isNew) frags[x.pid] = (frags[x.pid] || 0) + x.frags;
  const fragList = Object.entries(frags).map(([k, v]) => `<span class="chip r-${PLANES[k].rarity}">${PLANES[k].name}碎片 +${v}</span>`).join('');
  const el = showScreen('reveal', `
    <div class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">招募结果</div>
    <div class="dim-text">新飞机 ×${news.length} · 重复转碎片 ×${res.length - news.length}</div>
    <div class="reveal-sum">${res.map((it) => `<div class="mini ${it.isNew ? 'isnew' : ''}" style="--rc:${RARITY[it.r].color}"><canvas width="120" height="120" data-plane="${it.pid}"></canvas>${rarityChip(it.r)}<span>${it.isNew ? 'NEW' : `+${it.frags} 碎片`}</span></div>`).join('')}</div>
    ${fragList ? `<div class="row wrap" style="justify-content:center">${fragList}</div>` : ''}
    <div class="row wrap" style="justify-content:center">
      ${news.map((it) => `<button class="btn small cyan" data-pv="${it.pid}" type="button">${icon('i-play')} ${PLANES[it.pid].name} 大招预览</button>`).join('')}
      <button class="btn" id="rs-planes" type="button">${icon('i-hangar')} 去机库</button><button class="btn primary" id="rs-back" type="button" autofocus>完成</button></div>`, { bg: 'hub', cls: 'dim', label: '招募结果', back: () => showGacha(back) });
  $('#rs-back', el).onclick = () => showGacha(back);
  $('#rs-planes', el).onclick = () => showPlanes(back);
  $$('[data-pv]', el).forEach((b) => b.onclick = () => openPreview(b.dataset.pv, () => showRevealSummary(res, back)));
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
/* 选中节点的说明：效果、前置、是否已生效、成本；只有“点亮”按钮才花天赋点 */
function nodeDetail(rec, sel, pts, recR) {
  if (!sel || !rec.map[sel.r] || !rec.map[sel.r][sel.i]) return '<p class="dim-text">点一个节点查看说明</p>';
  const n = rec.map[sel.r][sel.i], T = NODE_TYPES[n.type], R = ROUTES[sel.r], lit = rec.lit[sel.r];
  const state = sel.i < lit ? '已点亮' : sel.i === lit ? (pts > 0 ? '可以点亮' : '需要天赋点（共享等级升级获得）') : `先点亮${R.name}路线前面的 ${sel.i - lit} 个节点`;
  const active = T.needs ? `条件型：本局拿到「${SKILLS[T.needs].name}」后才生效，没拿到时保持待激活` : '点亮后立刻生效，所有关卡都有用';
  const can = sel.i === lit && pts > 0;
  return `<div class="node-card" style="--rc:${R.color}">
    <div class="row">${icon(T.icon)}<b>${T.name}</b><span class="chip">${R.name} · 第 ${sel.i + 1} 个</span>${sel.r === recR && sel.i === lit && pts > 0 ? '<span class="chip gold">推荐</span>' : ''}</div>
    <p>${T.fmt(n.v)}</p><p class="dim-text">为什么选它：${T.why || ''}</p><p class="dim-text">${active}</p><p class="dim-text">状态：${state} · 成本 1 天赋点</p>
    <button class="btn ${can ? 'primary' : ''}" id="sm-light" type="button" ${can ? 'autofocus' : 'disabled'}>${icon('i-starmap')} 点亮（花 1 天赋点）</button></div>`;
}
function showStarMap(pid, back, fromLevel, sel) {
  Sound.setMode('hub');
  const m = G.meta, rec = m.planes[pid], P = PLANES[pid];
  if (!rec) return showPlanes(back, pid);
  const pts = treePoints(m, rec), recR = recommendNode(rec), stats = planeStats(m, pid).raw, cap = ultCapNow();
  if (!sel && recR) sel = { r: recR, i: rec.lit[recR] }; // 默认选中推荐节点（只是选中，不花点）
  let rows = '';
  for (const r of ROUTE_ORDER) {
    const list = rec.map[r], lit = rec.lit[r], R = ROUTES[r];
    const nodes = list.map((n, i) => {
      const T = NODE_TYPES[n.type], cls = i < lit ? 'lit' : i === lit ? (pts > 0 ? 'next' : 'wait') : '', isRec = r === recR && i === lit && pts > 0, isSel = sel && sel.r === r && sel.i === i;
      const lab = i < lit ? (T.needs ? '待激活' : T.max > 1 ? `+${n.v}${n.type === 'pierceX' ? '' : '%'}` : '+1') : i === lit && pts > 0 ? (isRec ? '推荐' : '可点亮') : T.name;
      return `<button class="snode ${cls} ${isRec ? 'rec' : ''} ${isSel ? 'sel' : ''} ${T.needs ? 'pending' : ''}" type="button" data-r="${r}" data-i="${i}" title="${T.fmt(n.v)}" aria-label="${R.name} 第 ${i + 1} 个：${T.fmt(n.v)}">${icon(T.icon)}<small>${lab}</small></button>`;
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
        ${nodeDetail(rec, sel, pts, recR)}
        ${canLevelUp() ? `<button class="btn small" id="sm-lv" type="button">${icon('i-dust')} 升级 Lv${m.shared.level + 1}（${nextLevelCost()} 星尘）</button>` : ''}
        <h3>当前收益</h3>
        <div class="effect-list">${eff.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
        <p class="dim-text" style="margin:0;font-size:var(--fs-xs);line-height:1.6">穿透 / 追踪节点只强化本局已经选到的能力，没选到时保持“待激活”，不会让开局子弹变追踪。天赋树在飞机解锁时生成一次并保存，不会重抽。</p>
      </div>
    </div>`, { bg: 'map', back, label: '天赋树' });
  const light = (r) => {
    const i = rec.lit[r], n = rec.map[r][i]; if (!n || treePoints(m, rec) < 1 || !sel || sel.i !== i) { Sound.sfx('denied'); return; }
    rec.lit[r]++; persist(); Sound.sfx('starLight'); toast(NODE_TYPES[n.type].fmt(n.v), ROUTES[r].color, NODE_TYPES[n.type].icon);
    showStarMap(pid, back);
  };
  $$('.snode', el).forEach((b) => b.onclick = () => { Sound.sfx('ui'); showStarMap(pid, back, false, { r: b.dataset.r, i: +b.dataset.i }); }); // 点节点只是选中看说明
  const lb2 = $('#sm-light', el); if (lb2) lb2.onclick = () => light(sel.r);
  const lb = $('#sm-lv', el); if (lb) lb.onclick = () => { if (levelUp()) showStarMap(pid, back, true); };
  if (fromLevel && pts > 0) toast('天赋点 +1：推荐节点已选中，看完说明再点亮', '#ffe38a', 'i-starmap');
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
  const tabs = [['planes', '飞机'], ['gun', '主炮改造'], ['skills', '支援'], ['bmod', '大招改造'], ['syns', '联动'], ['map', '地图'], ['npcs', '伙伴'], ['enemies', '敌人']];
  let body = '';
  if (tab === 'planes') body = PLANE_ORDER.map((id) => { const P = PLANES[id], own = m.planes[id]; return `<div class="panel cx ${own ? '' : 'unknown'}"><canvas width="120" height="120" data-plane="${id}"></canvas><div><h3>${own ? P.name : '？？？'} ${rarityChip(P.rarity)}</h3><p>${own ? `${P.look}。大招「${P.burst.name}」：${P.burst.desc}` : '召唤或集齐碎片后解锁。'}</p>${own ? `<p>被动「${P.passive.name}」：${P.passive.desc}</p>` : ''}</div></div>`; }).join('');
  else if (tab === 'gun' || tab === 'skills') body = (tab === 'gun' ? GUN_ORDER : SUPPORT_ORDER).map((id) => { const S = SKILLS[id], seen = m.codex.skills[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi" style="color:${S.color}">${icon(S.icon).replace('class="ic"', `class="ic" style="fill:${S.color}"`)}</div><div><h3>${S.name}${tab === 'gun' ? ' · 主炮改造' : ' · 自动支援'}</h3>${S.lv.map((t, i) => `<p>${i + 1} 级：${t}</p>`).join('')}${S.look ? `<p style="color:var(--lamp2)">看得见的变化：${S.look}</p>` : ''}</div></div>`; }).join('') + (tab === 'gun' ? '<div class="panel cx"><div class="cxi">' + icon('s-homing').replace('class="ic"', 'class="ic" style="fill:#6ff0ff"') + '</div><div><h3>开局规则</h3><p>自动开火，但固定向右、单发、命中即消失；穿透 / 追踪 / 多重 / 爆破只能在局内升级仪式里获得，互相兼容累积，新一局清空。厚甲怪的甲片只吃普通子弹 18% 的伤害——多重（多打几发）和爆破（炸开）都能更快敲碎。</p></div></div>' : '<div class="panel cx"><div class="cxi">' + icon('s-wing').replace('class="ic"', 'class="ic" style="fill:#fff3c8"') + '</div><div><h3>支援槽</h3><p>同时只带一个支援。出现新的支援时，候选会写明“替换前 → 替换后”。</p></div></div>');
  else if (tab === 'bmod') body = BURST_MOD_ORDER.map((id) => { const B = BURST_MODS[id]; return `<div class="panel cx"><div class="cxi">${icon(B.icon).replace('class="ic"', `class="ic" style="fill:${B.color}"`)}</div><div><h3>${B.name}</h3>${B.lv.map((t, i) => `<p>${i + 1} 级：${t}</p>`).join('')}</div></div>`; }).join('');
  else if (tab === 'syns') body = Object.entries(SYNERGIES).map(([k, v]) => { const [a, b] = v.need, seen = m.codex.syns[k]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi">${icon(SKILLS[a].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[a].color};width:40%;height:40%"`)}${icon(SKILLS[b].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[b].color};width:40%;height:40%"`)}</div><div><h3>${seen ? v.name : '？？？'} · ${v.stream}</h3><p>${SKILLS[a].name} + ${SKILLS[b].name}：两样都拿到后会出现在候选里</p><p>${seen ? v.desc : '选到一次后记录。'}</p></div></div>`; }).join('');
  else if (tab === 'map') body = MAP_ORDER.map((k) => { const O = MAP_OBJECTS[k], seen = m.codex.map[k]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="160" height="160" data-map="${k}"></canvas><div><h3>${O.verb} · ${O.name}</h3><p>${O.hint[0]}</p><p>${O.desc}</p></div></div>`; }).join('') + PLANE_ORDER.map((id) => `<div class="panel cx"><canvas width="120" height="120" data-plane="${id}"></canvas><div><h3>${PLANES[id].name} · 专属地图反应</h3><p>${PLANE_MAP_REACT[id]}</p></div></div>`).join('');
  else if (tab === 'npcs') body = NPC_ORDER.map((id) => { const N = NPCS[id], seen = m.codex.npcs[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="120" height="120" data-npc="${id}" data-mood="${seen ? 'happy' : 'sleep'}"></canvas><div><h3>${N.name}</h3><p>${seen ? N.effect : '还没救出来。碰一下救援吊舱，沿光带护送到修理点就行。'}</p><p>救出后跟着飞机一起射击；Boss 出现前帮一次忙。</p></div></div>`; }).join('');
  else body = Object.entries(ENEMY_INFO).map(([id, e]) => { const seen = m.codex.enemies[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="120" height="120" data-enemy="${id}"></canvas><div><h3>${seen ? e.name : '？？？'}</h3><p>${seen ? e.desc : '在航线上遇见后记录。'}</p></div></div>`; }).join('');
  const el = showScreen('codex', `${backBtn()}
    <div class="screen-title"><h2>图鉴</h2><p>飞机、主炮改造、支援、大招改造、联动、地图、伙伴、敌人</p></div>
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
  const val = { firstKill: [last && last.firstKill, avg('firstKill')], firstSkill: [last && last.firstSkill, avg('firstSkill')], choiceTime: [last && last.choiceTime, avg('choiceTime')], firstBurst: [last && last.firstBurst, avg('firstBurst')], changes: [last && last.changes, avg('changes')], highlights: [last && last.highlights, avg('highlights')], avgKill: [last && last.avgKill, avg('avgKill')], gap: [last && last.gap, avg('gap')], restart: [m.telemetry.lastRestart, null], second: [c.first_run_ended ? Math.round(((c.second_run_started || 0) / c.first_run_ended) * 100) : null, null], interacts: [last && last.interacts, avg('interacts')], interactTime: [last && last.interactTime, avg('interactTime')], stockIdle: [last && last.stockIdle, avg('stockIdle')], noGoal: [last && last.noGoal, avg('noGoal')], armorFirst: [last && last.armorFirst, avg('armorFirst')], armorAfter: [last && last.armorAfter, avg('armorAfter')] };
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
        <tr><th>地图互动</th><td class="num">${m.stats.interacts || 0}</td></tr><tr><th>救出的伙伴</th><td class="num">${Object.keys(m.codex.npcs || {}).length}/${NPC_ORDER.length}</td></tr>
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
      const data = JSON.stringify({ game: '梦潮：回声航线', version: 'v0.8', exportedAt: new Date().toISOString(), records: m.records, stats: m.stats, shared: m.shared, progress: m.progress, telemetry: m.telemetry }, null, 2);
      try { await dl.save({ filename: 'dreamtide-playtest.json', data }); toast('已导出'); }
      catch (e) { const code = e && e.code; if (code === 'declined') toast('已取消导出'); else if (code === 'rate_limited') toast('稍等一下再试'); else { btn.hidden = true; toast('这里暂时不能导出文件'); } }
    };
  }
}

/* ================================================== SETTINGS ================================================== */
function showSettings(back) {
  const s = G.meta.settings;
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, n]) => `<button type="button" data-seg="${key}" data-v="${v}" class="${s[key] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const segN = (key, opts) => `<div class="seg" role="group">${opts.map(([v, n]) => `<button type="button" data-segn="${key}" data-v="${v}" class="${Math.abs((s[key] === undefined ? 1 : s[key]) - v) < 0.01 ? 'on' : ''}">${n}</button>`).join('')}</div>`;
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
        ${tog('shake', '屏幕震动', '只在破甲、击倒精英、大招和大型互动时晃')}${tog('colorblind', '色弱模式', '敌方子弹多一个内部符号')}
        <div class="opt"><span>闪光强度<small>大招、通关时的全屏闪光</small></span>${segN('flash', [[0.3, '弱'], [0.6, '中'], [1, '强']])}</div>
        <div class="opt"><span>手柄震动<small>受击、破甲、击倒精英时的短震</small></span>${segN('rumble', [[0, '关'], [0.5, '弱'], [1, '强']])}</div>
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
  $$('[data-segn]', el).forEach((b) => b.onclick = () => { const k = b.dataset.segn; s[k] = +b.dataset.v; if (k === 'flash') s.reduceFlash = s.flash < 0.5; Sound.sfx('ui'); save(); if (k === 'rumble' && s.rumble > 0) { Input.rumble(0.6 * s.rumble, 0.6 * s.rumble, 120); Input.flushRumble(1); } showSettings(back); });
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
  showPauseMenu();
}
/* 暂停菜单：设置 / 图鉴 / 操作说明返回都回到这里；期间战斗一直冻结，点“继续”才恢复 */
function showPauseMenu() {
  const w = G.world; if (!w) return;
  G.paused = true; Input.gameActive = false;
  const b = w.buildSummary(), rows = [];
  for (const id of GUN_ORDER) if (b.gun[id]) rows.push(`<div class="row"><span class="chip" style="color:${SKILLS[id].color};border-color:${SKILLS[id].color}">${icon(SKILLS[id].icon)} 主炮 · ${SKILLS[id].name} Lv${b.gun[id]}</span><span class="dim-text" style="font-size:var(--fs-xs)">${SKILLS[id].lv[b.gun[id] - 1]}</span></div>`);
  if (b.support) rows.push(`<div class="row"><span class="chip" style="color:${SKILLS[b.support.id].color};border-color:${SKILLS[b.support.id].color}">${icon(SKILLS[b.support.id].icon)} 支援 · ${SKILLS[b.support.id].name} Lv${b.support.lv}</span><span class="dim-text" style="font-size:var(--fs-xs)">${SKILLS[b.support.id].lv[b.support.lv - 1]}（支援只能带一个，选新的会替换它）</span></div>`);
  if (b.bmod) rows.push(`<div class="row"><span class="chip" style="color:${BURST_MODS[b.bmod.id].color}">${icon(BURST_MODS[b.bmod.id].icon)} 大招 · ${BURST_MODS[b.bmod.id].name} Lv${b.bmod.lv}</span><span class="dim-text" style="font-size:var(--fs-xs)">${BURST_MODS[b.bmod.id].lv[b.bmod.lv - 1]}</span></div>`);
  for (const k of b.links) rows.push(`<div class="row"><span class="chip gold">联动 · ${SYNERGIES[k].name}</span><span class="dim-text" style="font-size:var(--fs-xs)">${SYNERGIES[k].desc}</span></div>`);
  for (const c of w.companions) rows.push(`<div class="row"><span class="chip pink">伙伴 · ${NPCS[c.id].name}</span><span class="dim-text" style="font-size:var(--fs-xs)">${NPCS[c.id].effect}</span></div>`);
  const adv = planHtml(buildPlan(b, w.targetName), true);
  $('#banner').innerHTML = ''; $('#toast').innerHTML = ''; banner._until = 0; // 暂停时收起横幅和轻提示，不压住菜单
  const el = showScreen('pause', `
    <div class="center-col" style="max-width:calc(860px*var(--u))">
      <div class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">暂停 <span class="dim-text" style="font-size:var(--fs-s)">${G.mpRun ? '联机战斗不会停，你的飞机原地不动' : '战斗已冻结'}</span></div>
      <div class="panel build-list" style="width:100%"><div class="label">当前 Build ${w.stream ? `· ${w.stream.name}` : ''}</div>${rows.join('') || '<span class="dim-text">还没选到升级：梦灯屋、风车塔、星砂矿、救援吊舱、精英核心都会给升级。</span>'}
        <div class="advice">${adv}</div></div>
      <div class="row wrap" style="justify-content:center">
        <button class="btn primary" id="p-resume" type="button" autofocus>${icon('i-play')} 继续</button>
        <button class="btn" id="p-help" type="button">${icon('i-book')} 操作说明</button>
        <button class="btn" id="p-settings" type="button">${icon('i-gear')} 设置</button>
        <button class="btn" id="p-codex" type="button">${icon('i-book')} 图鉴</button>
        <button class="btn coral" id="p-quit" type="button">${G.mpRun ? '退出联机' : '结束本局'}</button>
      </div>
      <span class="dim-text" style="font-size:var(--fs-xs)">结束本局按当前完成度结算：关卡奖励 × 完成度（现在 ${Math.round(w.result(false).progress * 100)}%）+ 本局星砂折算（每 50 星砂 = 1 星尘）。</span>
    </div>`, { bg: 'world', cls: 'dim', back: resumeGame, label: '暂停' });
  $('#p-resume', el).onclick = resumeGame;
  $('#p-help', el).onclick = () => { Sound.sfx('ui'); showHelp(showPauseMenu); };
  $('#p-settings', el).onclick = () => { Sound.sfx('ui'); showSettings(showPauseMenu); };
  $('#p-codex', el).onclick = () => { Sound.sfx('ui'); showCodex('gun', showPauseMenu); };
  let armed = false;
  $('#p-quit', el).onclick = () => {
    if (!armed) { armed = true; $('#p-quit', el).textContent = '确认结束本局'; return; }
    Tele.log('run_abandoned'); const ww = G.world; ww.done = true; const r = ww.result(false); r.abandoned = true; G.paused = false;
    if (G.mpRun) Lobby.leave(); // 多人：自己退出，其他人会在同一帧把你的飞机移除，继续玩
    onRunEnd(r);
  };
}
/* 操作说明：随时可从暂停里重看；按当前输入设备显示对应按键 */
function showHelp(back) {
  const pad = Input.device === 'pad', key = pad ? 'A / 任意主按钮' : Input.keyLabel(Input.binds.burst[0]);
  const rows = [
    ['移动', pad ? '左摇杆或十字键。' : 'WASD / 方向键；也可以按住鼠标左键拖动。按住 Shift 慢速精确飞行。'],
    ['射击', '自动开火，但子弹只会笔直向右：移动飞机对准敌人。拿到“追踪”“穿透”等升级后，子弹行为会改变。'],
    ['主目标', '屏幕上方一次只写一个主目标（清怪群 / 敲碎厚甲 / 打倒带队精英 / 场景惊喜 / Boss），旁边是目标的头像和进度。完成后先给奖励和几秒优势时间，再预告下一个。'],
    ['升级仪式', '碰一下装置，它会变形、转动、提升品质，然后给出两个方案：飞进一个的圆圈停 0.3 秒确认。仪式期间战场慢放、不会受伤、不刷怪，选多久都行；选完图标会飞进左上角对应的槽位。'],
    ['地图装置', '梦灯屋：碰门前的铃铛；风车塔：穿过风环；星砂矿：碰矿核再拖到发光岩壁；救援吊舱：碰一下挂上拖绳，沿光带送到修理点。装置旁会写着下一步该做什么。'],
    ['厚甲怪', '正面甲片只吃普通子弹两成伤害，分三段裂开；甲碎后核心一两发就倒。带队精英平时有护盾，举旗时打旗头水晶。'],
    ['大招', `击败敌人、精英、挖开星砂矿都会充能。右下角写着“充能 xx%”或“可释放”，满了按 ${key} 释放；最多存 ${ultCapNow()} 次。`],
    ['来敌方向', '敌人也会从后方（左边缘先有影子和引擎声，沿弧线绕到前面）、上方云影、下方海面、空间裂缝钻出来——都先有预警，直射就能解决。'],
    ['受击', '只有飞机正中的小白点会被打中（设置里可以把它显示出来）。敌弹都有一圈深色底，和背景光点区分。'],
  ];
  const el = showScreen('help', `${backBtn()}
    <div class="screen-title"><h2>操作说明</h2><p>${pad ? '手柄' : '键鼠'}（换输入设备后会自动切换说明）</p></div>
    <div class="panel help-list">${rows.map(([k, v]) => `<div class="help-row"><b>${k}</b><span>${v}</span></div>`).join('')}</div>
    <div class="row wrap" style="margin-top:12px"><button class="btn" id="help-tut" type="button">${icon('i-play')} 重看开局三步教学</button></div>`, { bg: G.world ? 'world' : 'hub', cls: G.world ? 'dim' : '', back, label: '操作说明' });
  $('#help-tut', el).onclick = () => { G.meta.tutorialDone = false; persist(); G.tutorial = { on: true, t: 0 }; toast('开局教学已打开：回到战斗就能看到三步清单', '#ffe38a'); };
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
      ${w.np > 1 ? '<div class="team" id="h-team" aria-label="队友"></div>' : ''}
      <div class="row"><span class="cur" title="本局星砂：结算时每 50 星砂折 1 星尘">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}<small class="curname">星砂</small><span class="num" id="h-dust">0</span></span><span class="stream-badge" id="h-stream"></span></div>
      <div class="slots" id="h-slots">
        <div class="slot gunslot" title="主炮改造链"><svg class="ic"><use href="#s-pierce"/></svg><b class="sl">主炮</b><div class="marks"></div></div>
        <div class="slot" title="自动支援"><svg class="ic"><use href="#s-thunder"/></svg><div class="lv"><i></i><i></i><i></i></div><b class="sl">支援</b></div>
        <div class="slot" title="大招改造"><svg class="ic"><use href="#s-bomb"/></svg><div class="lv"><i></i><i></i></div><b class="sl">大招</b></div>
      </div>
      <div class="syns" id="h-syns"></div>
      <div class="comps" id="h-comps"></div>
    </div>
    <div class="hud-tc goal" id="h-tc"><div class="goal-main" id="h-gm"><canvas width="96" height="96" id="h-gport"></canvas><div class="goal-txt"><div class="goal-t" id="h-gt"></div><div class="goal-p" id="h-gp"></div></div><span class="goal-step" id="h-gs"></span></div><div class="goal-opt" id="h-go" hidden></div></div>
    <div class="bossbar" id="h-boss" hidden><div class="bname"><span id="h-bname">Boss</span><small id="h-bphase"></small></div><div class="bar boss" id="h-bbar"><i id="h-bf"></i><span id="h-bticks"></span><span class="shield" id="h-bs"></span></div></div>
    <div class="hud-tr"><button class="pause-btn hb" id="h-pause" type="button" aria-label="暂停">${icon('i-pause')}</button></div>
    <div class="streak" id="h-streak" hidden><div class="n" id="h-sn">0</div><div class="t">连杀</div></div>
    <div class="tut hb" id="h-tut" hidden></div>
    <div class="bstate" id="h-bstate"></div>
    <button class="burst-btn hb" id="h-burst" type="button" aria-label="爆发：${PLANES[w.planeId].burst.name}"><div class="face"><canvas width="160" height="160" data-plane="${w.planeId}"></canvas></div><span class="stock" id="h-stock">0/1</span><span class="k kbd" id="h-bk"></span></button>
    <div class="hint-box" id="h-hint" hidden></div>`;
  hud.hidden = false;
  paintPlaneCanvases(hud);
  $('#h-pause').onclick = () => pauseGame();
  $('#h-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
  const bb = $('#h-burst');
  bb.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Input.press('burst'); });
  G.hudRefs = { hearts: $('#h-hearts'), dust: $('#h-dust'), stream: $('#h-stream'), slots: $$('#h-slots .slot'), marks: $('#h-slots .marks'), syns: $('#h-syns'), comps: $('#h-comps'), tc: $('#h-tc'), gm: $('#h-gm'), gport: $('#h-gport'), gt: $('#h-gt'), gp: $('#h-gp'), gs: $('#h-gs'), go: $('#h-go'), boss: $('#h-boss'), bname: $('#h-bname'), bphase: $('#h-bphase'), bbar: $('#h-bbar'), bf: $('#h-bf'), bticks: $('#h-bticks'), bs: $('#h-bs'), streak: $('#h-streak'), sn: $('#h-sn'), burst: bb, stock: $('#h-stock'), bk: $('#h-bk'), hint: $('#h-hint'), bstate: $('#h-bstate'), tut: $('#h-tut'), team: $('#h-team') };
  G.hudLast = {};
  updateHud(true);
  showHint();
}
function hideHud() { const hud = $('#hud'); hud.hidden = true; hud.innerHTML = ''; G.hudRefs = null; $('#stage').classList.remove('offering'); }
/* 目标卡头像：敌人 / 装置 / 惊喜 */
function paintPortrait(cv, key) {
  const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  if (MAP_OBJECTS[key] || key === 'core') { paintMapIcon(cv, key); return; }
  if (key === 'boss') { g.translate(cv.width / 2, cv.height / 2); drawIcon(g, 'crown', 0, 0, cv.width * 0.6, '#ff9d8c'); g.setTransform(1, 0, 0, 1, 0, 0); return; }
  paintEnemyIcon(cv, key === 'houseMimic' ? 'hmimic' : key === 'moon' ? 'mcore' : key, 1);
}
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
  const offering = !!h.ritual;
  if (L.offering !== offering) { L.offering = offering; $('#stage').classList.toggle('offering', offering); } // 升级仪式时淡化横幅和轻提示
  const hk = `${h.hp}/${h.maxHp}`;
  if (L.hp !== hk) { L.hp = hk; let s = ''; for (let i = 0; i < h.maxHp; i++) s += `<svg class="${i < h.hp ? '' : 'off'}" aria-hidden="true"><use href="#i-heart"/></svg>`; R.hearts.innerHTML = s; R.hearts.setAttribute('aria-label', `生命 ${h.hp}/${h.maxHp}`); }
  setText(R.dust, 'dust', String(h.dust));
  if (R.team && h.team) { // 联机：队友状态（生命 / 倒下倒计时 / 已离开）
    const tk = h.team.map((q) => `${q.hp}/${q.maxHp}/${q.alive}/${q.down}/${q.gone}`).join('|');
    if (L.team !== tk) { L.team = tk; R.team.innerHTML = h.team.filter((q) => !q.me).map((q) => `<div class="${q.gone ? 'gone' : !q.alive ? 'down' : ''}"><i style="background:${q.color}"></i><b>${esc(q.name)}</b>${q.gone ? '已离开' : !q.alive ? `倒下 · 飞过去救 · ${q.down}` : `<span class="hp">${'♥'.repeat(Math.max(0, q.hp))}</span>`}</div>`).join(''); }
  }
  setText(R.stream, 'stream', h.stream || '');
  // 三个槽：主炮改造链（只显示最高阶造型 + 各改造等级）/ 支援 / 大招改造
  const gk = GUN_ORDER.map((id) => h.gun[id]).join('');
  if (L.gun !== gk) {
    L.gun = gk; const top = GUN_ORDER.filter((id) => h.gun[id]).sort((a, b) => h.gun[b] - h.gun[a])[0];
    setSlot(R.slots[0], !!top, top ? SKILLS[top].icon : 's-pierce', top ? SKILLS[top].color : '#fff', 0, 0, top ? GUN_ORDER.filter((id) => h.gun[id]).map((id) => `${SKILLS[id].name} Lv${h.gun[id]}`).join(' · ') : '主炮：固定向前单发');
    // 主炮槽下的小标记：最近 3 个改造（穿透标 / 追踪弧 / 多重 / 爆破）+ 等级刻度
    const recent = (h.recent || []).filter((id) => h.gun[id]).slice(0, 3);
    R.marks.innerHTML = recent.map((id) => `<b style="--mc:${SKILLS[id].color}" title="${SKILLS[id].name} Lv${h.gun[id]}"><svg aria-hidden="true"><use href="#${SKILLS[id].icon}"/></svg><i>${'▮'.repeat(h.gun[id])}</i></b>`).join('');
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
    if (L.bossOn !== false) { L.bossOn = false; R.boss.hidden = true; }
    updateGoalCard(h.goal, R, L);
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
  const bs = h.down ? `倒下了 · 队友贴过来就能救起（${h.down} 秒后自动复活）` : h.stock >= h.cap ? `可释放 · 已存满 ${h.stock}/${h.cap}` : h.stock > 0 ? `可释放 · 还能再存 ${h.cap - h.stock} 次` : `大招充能 ${p}%`;
  if (L.bs !== bs) { L.bs = bs; R.bstate.textContent = bs; R.bstate.classList.toggle('ready', h.stock > 0); }
  updateTutorial(h, R);
  const key = Input.hintFor('burst');
  if (L.bk !== key) { L.bk = key; R.bk.textContent = key; R.bk.hidden = !key; }
}
/* 主目标卡：一次一个目标 + 头像 + 进度（数量 / 厚甲裂纹 / 血量）+ 最多一个可选地图目标 */
function updateGoalCard(G, R, L) {
  if (!G) { if (L.gOn !== false) { L.gOn = false; R.tc.hidden = true; } return; }
  if (L.gOn !== true) { L.gOn = true; R.tc.hidden = false; }
  if (L.gport !== G.portrait) { L.gport = G.portrait; paintPortrait(R.gport, G.portrait); }
  setText(R.gt, 'gt', G.title);
  setText(R.gs, 'gs', `${Math.min(G.step, G.steps)}/${G.steps}`);
  const cls = 'goal-main' + (G.adv ? ' adv' : G.next ? ' next' : G.reward ? ' reward' : '');
  if (L.gcls !== cls) { L.gcls = cls; R.gm.className = cls; }
  const P = G.prog; let pk = '', html = '';
  if (P && P.type === 'count') {
    pk = `c${P.n}/${P.total}/${P.crack}/${P.broken}/${P.need}/${G.sub}`;
    const pips = P.crack !== null && P.crack !== undefined ? `<span class="pips">${[0, 1, 2, 3].map((i) => `<i class="${i < P.crack ? 'done' : ''} ${i === 3 ? 'core' : ''}"></i>`).join('')}</span>` : '';
    html = `<span class="gbar"><i style="width:${(P.total ? P.n / P.total : 0) * 100}%"></i></span><span>${P.n}/${P.total}</span>${pips}${P.need ? `<em>${esc(P.need)}</em>` : G.sub ? `<em>${esc(G.sub)}</em>` : ''}`;
  } else if (P && P.type === 'hp') {
    pk = `h${Math.round(P.u * 40)}/${G.sub}`;
    html = `<span class="gbar hp"><i style="width:${Math.max(0, P.u) * 100}%"></i></span>${G.sub ? `<em>${esc(G.sub)}</em>` : ''}`;
  } else { pk = `n/${G.sub}`; html = G.sub ? `<em>${esc(G.sub)}</em>` : ''; }
  if (L.gp !== pk) { L.gp = pk; R.gp.innerHTML = html; R.gp.hidden = !html; }
  const opt = G.opt || '';
  if (L.go !== opt) { L.go = opt; R.go.hidden = !opt; R.go.textContent = opt; }
  if (L.gtitleFlash !== G.title) { L.gtitleFlash = G.title; R.tc.classList.remove('flash'); void R.tc.offsetWidth; R.tc.classList.add('flash'); }
}
/* 开局三步教学：移动 → 进入装置 → 释放一次大招；可跳过，暂停里的“操作说明”可以重看 */
function updateTutorial(h, R) {
  const T = G.tutorial; if (!T || !T.on || !R.tut) { if (R.tut && !R.tut.hidden) R.tut.hidden = true; return; }
  const w = G.world, pad = Input.device === 'pad';
  const steps = [
    [w.player.moved > 220, pad ? '用左摇杆移动飞机' : '移动飞机（WASD 或按住鼠标拖动）'],
    [w.m.interacts > 0, '碰一下梦灯屋门前的铃铛'],
    [w.m.bursts > 0, `释放一次大招（${pad ? 'A 键' : Input.keyLabel(Input.binds.burst[0])}）`],
  ];
  const k = steps.map((x) => (x[0] ? 1 : 0)).join('') + (pad ? 'p' : 'k');
  if (G.hudLast.tut !== k) {
    G.hudLast.tut = k; R.tut.hidden = false;
    const cur = steps.findIndex((x) => !x[0]), done = steps.filter((x) => x[0]).length; // 只显示当前这一步，不和目标卡、装置提示抢注意力
    R.tut.innerHTML = `<div class="tut-h">开局教学 ${done}/3 <button type="button" id="tut-skip">跳过</button></div>${cur >= 0 ? `<div class="tut-s"><i>${cur + 1}</i>${steps[cur][1]}</div>` : '<div class="tut-s ok"><i>✓</i>三步都完成了</div>'}`;
    const sk = $('#tut-skip', R.tut); sk.addEventListener('pointerdown', (e) => e.stopPropagation()); sk.onclick = () => endTutorial(true);
    if (steps.every((x) => x[0])) endTutorial(false);
  }
}
function endTutorial(skipped) {
  G.tutorial = { on: false }; G.meta.tutorialDone = true; persist();
  if (G.hudRefs && G.hudRefs.tut) setTimeout(() => { if (G.hudRefs && G.hudRefs.tut) G.hudRefs.tut.hidden = true; }, skipped ? 0 : 1600);
  if (!skipped) toast('开局教学完成！暂停里的“操作说明”随时可以重看', '#9ff2c8', null, 2600);
}
function drainWorldEvents() {
  const w = G.world; if (!w) return;
  if (w.done) { w.events.length = 0; return; }
  while (w.events.length) {
    const e = w.events.shift();
    switch (e.type) {
      case 'slotLand': slotLand(e); break;
      case 'goal': if (e.idx > 0) toast(`目标 ${e.idx + 1}/${e.n} · ${e.title}`, '#ffe38a', null, 1800); break; // 顶部目标卡会闪一下，不再占中央
      case 'goalDone': toast(`完成：${e.title}`, '#9ff2c8', null, 1800); break;
      case 'goalNext': toast(`${e.boss ? '前方是本关 Boss' : '下一个'} · ${e.title}`, e.boss ? '#ff9d8c' : '#ffb2a8', null, 2000); break;
      case 'burstDemo': G.hintId = null; showHint(); banner(`放一次大招：按 ${Input.device === 'pad' ? 'A' : Input.keyLabel(Input.binds.burst[0])}`, `「${e.name}」· 敌弹已经清空，前面一排是给你试的`, 9, 'rgba(255,215,106,.85)', 5); break;
      case 'burstDemoEnd': banner._until = 0; $('#banner').innerHTML = ''; break; // 教学结束：提示收回到大招按钮（按钮继续发光）
      case 'backlog': toast('敌人有点多：先清前面的，下一批会晚一点来', '#ffb2a8', null, 2400); break;
      case 'stream': toast(`${e.name}成型！这一局的 Build 有名字了`, '#ffd76a', null, 2200); break;
      case 'streak': if (e.n >= 50) toast(`${e.n} 连杀！${{ 50: '星环清场', 100: '金色强化出现' }[e.n] || '星环清场'}`, '#ff9fcf', null, 1600); break; // 连杀数字右侧一直显示，不再弹中央横幅
      case 'elite': toast(e.elite === 'cmdr' ? '带队精英出现 · 等它举旗再打旗头水晶' : '精英出现 · 击败它能充不少大招', '#ff9d8c', 'n-crown'); Sound.setBoost('tension', 0.3); setTimeout(() => Sound.setBoost('tension', 0), 12000); break;
      case 'boss': { const S = w.stage; banner(S.bossName, S.boss === 'clock' ? '第一乐章 · 指针卡住' : '先打碎正面三块护甲，核心才吃满伤害', 2.4, 'rgba(255,90,110,.7)', 4); Sound.setMode('boss1'); break; }
      case 'bossResponse': banner(e.title, e.sub, 2.6, 'rgba(255,215,106,.8)', 3); break;
      case 'phase': banner(e.name, e.captain ? '攻击更密，还带着散兵' : e.n === 2 ? '攻击越来越快，安全区在缩小' : '弹幕会逆行，消失的弹幕会重演', 1.8, null, 3); break;
      case 'flag': banner('', e.text, e.dur || 1, null, 1); break;
      case 'burstReady':
        toast(`${PLANES[w.planeId].burst.name} 可用 · 库存 ${e.stock || 1}/${e.cap || 1}`, '#ffe38a', 'i-play', 1600);
        break;
      case 'gold': banner('金色强化！', '大招充满 · 射速提高', 1.6, 'rgba(255,215,106,.9)'); break;
      case 'hint': G.hintId = e.id; showHint(); break;
      case 'maphint': G.mapHint = e.kind; showHint(); break;
      case 'mapDone': toast(`${e.verb}${e.name}！${e.desc}`, MAP_OBJECTS[e.kind].color, null, 2400); break; // 不用大横幅：仪式本身就是反馈
    }
  }
}
/* 仪式图标落进槽位：目标槽高亮、弹一下、显示等级；替换支援时旧图标先退出 */
function slotLand(e) {
  const R = G.hudRefs; if (!R) return;
  updateHud();
  const el = e.slot === 'gun' ? R.slots[0] : e.slot === 'support' ? R.slots[1] : e.slot === 'bmod' ? R.slots[2] : e.slot === 'link' ? R.syns : R.burst;
  if (el) { el.classList.remove('land', 'swap'); void el.offsetWidth; el.classList.add(e.replace ? 'swap' : 'land'); setTimeout(() => el.classList.remove('land', 'swap'), 900); }
  toast(`${e.word} · ${e.name} ${e.lv}`, e.color, null, 1800);
}
function showHint() {
  const R = G.hudRefs; if (!R) return;
  if (G.mapHint && MAP_OBJECTS[G.mapHint]) { const H = MAP_OBJECTS[G.mapHint].hint; R.hint.hidden = false; R.hint.innerHTML = `${esc(H[0])}<small>${esc(H[1])}</small>`; return; }
  const id = G.hintId;
  if (!id) { R.hint.hidden = true; return; }
  const d = Input.device;
  const T = {
    move: [d === 'touch' ? '按住屏幕任意位置拖动飞机' : d === 'pad' ? '左摇杆移动飞机' : 'WASD / 方向键移动，也可以按住鼠标拖动', '自动开火，但子弹只会笔直向右：移动飞机对准敌人。'],
    offer: ['飞进一个方案，停一下就选好了', '战场现在慢放、不会受伤，慢慢看。进圆圈停 0.3 秒确认，选完图标会飞进左上角的槽位。'],
    burst: [d === 'touch' ? '点右下角头像（或双击屏幕）释放专属大招' : d === 'pad' ? '按 A 释放专属大招' : `按 ${Input.hintFor('burst')} 释放专属大招`, `${PLANES[G.world.planeId].burst.name}：${PLANES[G.world.planeId].burst.desc}`],
  }[id];
  if (!T) { R.hint.hidden = true; return; }
  R.hint.hidden = false; R.hint.innerHTML = `${esc(T[0])}<small>${esc(T[1])}</small>`;
}
