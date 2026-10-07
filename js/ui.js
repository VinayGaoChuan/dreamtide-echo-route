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
  // 暂停菜单：收在屏幕外的战斗面板一起飞进来（目标、生命、构筑、资源）；进到设置 / 图鉴等别的界面就收回去
  const hud = $('#hud'); if (hud) hud.classList.toggle('all', id === 'pause');
  const el = host.firstElementChild;
  $$('[data-back]', el).forEach((b) => b.addEventListener('click', () => { Sound.sfx('uiBack'); if (G.back) G.back(); }));
  paintPlaneCanvases(el);
  if (Input.keyboardNav) { const f = $('[autofocus]', el) || $('.btn.primary', el); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30); }
  return el;
}
function clearScreens() { $('#screens').innerHTML = ''; G.screen = null; G.back = null; const hud = $('#hud'); if (hud) hud.classList.remove('all'); }
function backBtn() { return `<button class="btn back-btn" data-back type="button" aria-label="返回">${icon('i-back')} 返回</button>`; }
function paintPlaneCanvases(root) {
  $$('canvas[data-npc]', root).forEach((c) => paintNPC(c, c.dataset.npc, c.dataset.mood || 'happy'));
  $$('canvas[data-map]', root).forEach((c) => paintMapIcon(c, c.dataset.map, c.dataset.sub || null));
  $$('canvas[data-plane]', root).forEach((c) => {
    const g = c.getContext('2d'), id = c.dataset.plane, big = c.width;
    g.clearRect(0, 0, c.width, c.height);
    if (c.dataset.glow) { const gr = g.createRadialGradient(big / 2, big / 2, 4, big / 2, big / 2, big / 2); gr.addColorStop(0, c.dataset.glow); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, big, big); }
    const look = c.dataset.look ? Gear.look(G.meta && G.meta.gear ? G.meta.gear.eq : null) : null; // 自己的船：带着身上的装备画
    drawPlane(g, id, big * (look ? 0.5 : 0.52), big * 0.56, big / (look ? 100 : 80), 1.3, { happy: !!c.dataset.happy, look });
  });
}
function banner(title, sub, dur = 1.6, color, prio = 2) {
  // 优先级：重要横幅（点亮信标亭、流派成型、Boss）在显示时，不会被连杀之类的小横幅盖掉，小的改成轻提示
  const now = performance.now();
  if (banner._until > now && prio < banner._prio) { toast([title, sub].filter(Boolean).join(' · '), null, null, 1600); return; }
  banner._prio = prio; banner._until = now + dur * 1000;
  const b = $('#banner');
  b.classList.remove('out'); b.style.setProperty('--bgc', color || 'rgba(255,201,74,.6)');
  b.innerHTML = `${title ? `<div class="bt">${esc(title)}</div>` : ''}${sub ? `<div class="bs">${esc(sub)}</div>` : ''}`;
  clearTimeout(banner._t); clearTimeout(banner._t2);
  banner._t = setTimeout(() => { b.classList.add('out'); banner._t2 = setTimeout(() => { b.innerHTML = ''; b.classList.remove('out'); }, 360); }, dur * 1000);
}
/* 按钮反馈（lessons UT4：每个按钮要么按下有看得见的结果，要么灰着、按下说明原因）。
   offIf(条件, 原因)：条件成立时按钮灰掉，但仍能按，按下弹出原因（不用 disabled：禁用的按钮按了什么都不发生）；
   pulse(元素)：点了已经选中的东西，原地闪一下 */
const offIf = (cond, why) => (cond ? `aria-disabled="true" data-why="${esc(why)}"` : '');
function pulse(el) { if (!el) return; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); clearTimeout(el._pulseT); el._pulseT = setTimeout(() => el.classList.remove('pulse'), 900); }
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[aria-disabled="true"][data-why]'); if (!b) return;
  e.stopPropagation(); e.preventDefault(); Sound.sfx('denied'); toast(b.dataset.why, '#ffb2a8'); pulse(b);
}, true);
function toast(text, color, sym, ms = 2200) {
  const t = $('#toast'), d = document.createElement('div');
  if (color) d.style.setProperty('--tc', color);
  d.innerHTML = `${sym ? icon(sym) : ''}<span></span>`; d.lastChild.textContent = text; t.appendChild(d);
  setTimeout(() => d.remove(), ms);
  while (t.children.length > 1) t.firstElementChild.remove(); // 同一时间只留一条：新的顶掉旧的，顶部不叠字
}
function starsHtml(n) { return `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`; }
function rarityChip(r) { return `<span class="chip r-${r}">${r}</span>`; }
/* 机制 / 技能的统一样式：图标 + 名字（+ 等级 + 箭头）一行，下面一句话；不写数值 */
function abilityHtml(o) {
  const ics = (o.icons || (o.icon ? [o.icon] : [])).map((id, i) => icon(id).replace('class="ic"', `class="ic" style="fill:${(o.colors && o.colors[i]) || o.color || 'var(--paper)'}"`)).join('');
  return `<div class="abil">${ics ? `<span class="aic">${ics}</span>` : ''}<div class="abody"><div class="an"><b style="color:${o.color || 'var(--paper)'}">${esc(o.name)}</b>${o.lv ? `<small>${esc(String(o.lv))}</small>` : ''}${o.tag ? `<span class="atag">${esc(o.tag)}</span>` : ''}${fxHtml(o.fx)}</div>${o.line ? `<div class="al">${esc(o.line)}</div>` : ''}</div></div>`;
}
const skillAbil = (id, lv, tag) => { const S = SKILLS[id]; return abilityHtml({ icon: S.icon, color: S.color, name: S.name, lv: lv ? `Lv${lv}` : '', tag, line: S.lv[Math.max(0, (lv || 1) - 1)], fx: fxOf(S.slot, id, lv || 1) }); };
const modAbil = (id, lv) => { const B = BURST_MODS[id]; return abilityHtml({ icon: B.icon, color: B.color, name: B.name, lv: lv ? `Lv${lv}` : '', tag: '大招', line: B.lv[Math.max(0, (lv || 1) - 1)], fx: fxOf('bmod', id, lv || 1) }); };
const linkAbil = (k) => { const L = SYNERGIES[k], [a, b] = L.need; return abilityHtml({ icons: [SKILLS[a].icon, SKILLS[b].icon], colors: [SKILLS[a].color, SKILLS[b].color], color: '#ffd76a', name: L.name, tag: '联动', line: L.desc, fx: L.fx }); };

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

/* ================================================== TITLE ================================================== */
function showTitle() {
  Sound.setMode('title'); G.bg = 'title'; G.sea.setTheme('title');
  const first = !G.meta.seenTitle;
  const el = showScreen('title', `
    <div class="corner-tr"><button class="icon-btn" id="t-mp" type="button">${icon('i-team')}<span>联机</span></button><button class="icon-btn" id="t-sound" type="button" aria-label="声音开关">${icon(G.meta.settings.muted ? 'i-mute' : 'i-sound')}<span>${G.meta.settings.muted ? '静音' : '声音'}</span></button></div>
    <div class="title-block">
      <h1 class="title-main">拾荒<em>之翼</em></h1>
      <p class="title-sub">LOOTWING</p>
      <p class="title-tag">${first ? '地球失联第七年。开着捡来的船，从他们的地盘上抢东西。' : '回声：欢迎回站。'}</p>
      <p class="title-start">点击任意处开始</p>
    </div>
    <p class="title-foot">键鼠 · 手柄 &nbsp;|&nbsp; 进度自动保存在本机</p>`, { bg: 'title', label: '标题' });
  el.addEventListener('click', (e) => { if (e.target.closest('#t-sound') || e.target.closest('#t-mp')) return; startFromTitle(); });
  $('#t-mp', el).addEventListener('click', () => { Sound.init(); Sound.sfx('select'); G.meta.seenTitle = true; persist(); showMultiplayer(showHub); }); // 朋友第一次打开也能直接进联机，不用先打完单人教学
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

/* 梦魇（难度阶梯）先收着（§12.4）：开局一律基础难度 */
function ladderNow() { return 0; }
/* ================================================== 站（stationui.js 取代了原来的家园浮空港） ================================================== */
function showHub() { showStation(); }
/* 结算页的“出发前”：按当前存档实时算 */
function nextStep() {
  const m = G.meta;
  if (typeof stationUpgradeReady === 'function' && stationUpgradeReady()) return '仓库里有比身上更好的装备：去装备栏换上';
  if (m.gear && m.gear.inbox && m.gear.inbox.length) return `到货区有 ${m.gear.inbox.length} 件：仓库满了，先卖掉或拆掉一些`;
  const mm = (m.maps && m.maps.sel) || 1; return `出击 · 地图 ${mm} ${MAPS[mm].name}`;
}
function lureRows(L) {
  const P = L.plan || buildPlan(null, L.target || L.buildName || null, 0);
  const path = P.path.map((id) => compChip(P, id)).join('<span class="arrow">›</span>');
  return `<div class="lure-row"><span class="label">上一局</span><span><b>${esc(L.stream || '还没成型')}</b></span></div>
    <div class="lure-row"><span class="label">目标</span><span class="lure-path"><b>${esc(P.name)}</b>${path}</span></div>
    <div class="lure-row"><span class="label">下一步</span><span class="advice">${planHtml(P, false, true, true)}</span></div>
    <div class="lure-row"><span class="label">出发前</span><span>${esc(nextStep())}</span></div>${L.npc ? `
    <div class="lure-row"><span class="label">想救的</span><span class="lure-npc"><canvas width="64" height="64" data-npc="${L.npc}" data-mood="sleep"></canvas>${esc(NPCS[L.npc].name)}还困在航线上</span></div>` : ''}`;
}

/* ================================================== 联机房间 ================================================== */
/* 2–4 人同屏合作。只同步操作：每人每 1/30 秒的方向 / 大招 / 拖动，各端用同一个种子各自模拟同一局。
   网页版的转发：Claude Artifact 的房间（打开同一个链接的人互相可见）；不在 Claude 里打开时退回到“同一浏览器多窗口”，用来测试。 */
/* 规则说明：房间里开局前就能看完（对抗把每一项得分写清楚，数字来自 vs.js 的 VS）；战斗中按 H 弹出同一份，飞机照常能动 */
/* 战斗中按 H：在角落弹出规则卡（不挡操作、不暂停，飞机照常能动），再按一次收起 */
function toggleRulesCard(force) {
  let card = document.getElementById('mp-rules-card');
  if (card || force === false) { if (card) card.remove(); return; }
  if (!G.mpRun || !G.world) return;
  card = document.createElement('div'); card.id = 'mp-rules-card'; card.innerHTML = mpRulesHtml(G.world.vs ? 'vs' : 'coop', true);
  const me = G.world.me; card.className = me && me.y < LH / 2 ? 'at-bottom' : 'at-top'; // 放在自己飞机的另一半屏，不挡自己
  const st = document.getElementById('stage'); if (st) st.appendChild(card);
}
window.addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !e.repeat && G.mpRun && G.world && !G.world.done && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) toggleRulesCard(); });
function mpRulesHtml(mode, open) {
  const P = VS.pts, L = mode === 'vs' ? [
    `每人一条航道，三段各约 ${Math.round(VS.stageT / 60)} 分钟；三段打完按总分排名，同分比风塔数，再同分算平局`,
    `击破：每 ${Math.round(1 / P.kill)} 只小怪 +1，厚甲 / 精英 +${P.big}`,
    `风塔：每段约第 ${VS.towerAt} 秒出现，清掉自己航道的三只守卫 +${P.tower}，本段第一个清掉再 +${P.first}`,
    `干扰：清完风塔出现两个洞口，飞进一个，把矿甲列阵或侧风送给分最高的对手 +${P.sent}；处理掉别人送来的干扰 +${P.held}`,
    `冲突区：每段约第 ${VS.clash[0]}–${VS.clash[1]} 秒开放，航道交界的红色带子里主炮能打到对手；击毁对手 +${P.ko}`,
    `被击毁 -${P.koLoss}，约 ${VS.respawn} 秒后在自己航道原地复归，Build 保留`,
    `升级：每段两次，全场一起选，限时 ${CHOOSE_LIMIT.vs} 秒，超时自动选推荐；这时比赛计时暂停`,
    '联机不暂停：战斗中按 H 能边飞边看这份规则',
  ] : [
    '全队一起打同一关：升级、掉落、资源都是自己的',
    `升级：全队一起进入慢放各选各的，限时 ${CHOOSE_LIMIT.coop} 秒，超时自动选推荐`,
    '倒下：队友飞进残骸周围的救援圈停约 2 秒就能救起；在线的人全倒下才算失败',
    '掉线或刷新页面：60 秒内回来能接着打（飞机原地等你）；超过 60 秒按退出处理',
    '联机不暂停：战斗中按 H 能边飞边看这份规则',
  ];
  return `<details class="mp-rules" ${open ? 'open' : ''}><summary>${mode === 'vs' ? '对抗规则' : '合作规则'}</summary><ul>${L.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
}
/* 房间里每个人的真实成长（v0.11 §12：对抗用真实数值，开局前把差距摆出来，不暗中拉平） */
function growthHtml(prof) {
  const s = prof && prof.s; if (!s) return '';
  return `<br><small class="mp-grow">♥${Math.round(s.hearts || 0)} · 攻 ×${(s.dmgK || 1).toFixed(2)} · 大招 ${prof.u || 1}${s.level ? ` · Lv${s.level}` : ''}</small>`;
}
function vsGapHtml(ms) {
  const atk = ms.map((x) => (x.prof && x.prof.s && x.prof.s.dmgK) || 1), hp = ms.map((x) => (x.prof && x.prof.s && x.prof.s.hearts) || 5);
  const gap = Math.max(...atk) / Math.min(...atk) > 1.25 || Math.max(...hp) - Math.min(...hp) >= 2;
  return `<p class="dim-text mp-world">${gap ? '成长差距较大：按各自真实数值对抗，不会拉平' : '各自用真实成长参战'}</p>`;
}
function mpProfile() {
  const m = G.meta, id = m.current;
  Station.ensure(m);
  return { name: (m.nick || '').trim() || '玩家', plane: id, prof: { s: compactStats(planeStats(m, id)), u: 1, c: { exp: m.cosmetics.exp, trail: m.cosmetics.trail }, w: {}, g: `驾驶员 ${m.pilot.lv} 级`,
    gifts: m.gear.outbox.map((g) => ({ id: g.id, to: g.to, item: g.item })), acks: m.gear.giftsGot.slice(-10) } }; // 送装备（§13）：待送的东西和收到的回执都在自己的资料里
}
/* 送装备：收下队友送给我的（同一份只收一次），看到队友的回执就把我的待送清掉 */
function mpGiftSync(ms) {
  const m = G.meta, me = ms.find((x) => x.isMe); if (!me) return false; let changed = false;
  for (const x of ms) {
    if (x.isMe || !x.prof) continue;
    for (const g of x.prof.gifts || []) if (g && g.to === me.peer) { const it = Station.giftReceive(m, g, x.name); if (it) { changed = true; toast(`${x.name} 送你一件：${Gear.name(it)}`, QUALS[it.q].color, null, 3200); Sound.sfx('lootBlue'); } }
    if (Station.giftResolve(m, x.peer, x.prof.acks || [])) { changed = true; toast(`${x.name} 收到了你送的装备`, '#9ff2c8', null, 2200); }
  }
  if (changed) { persist(); Lobby.me(mpProfile()); }
  return changed;
}
/* 邀请链接：?join=房间号，打开后直接进那个房间 */
function inviteCode() { try { const c = new URLSearchParams(location.search).get('join'); return c && /^[A-Z0-9]{3,8}$/i.test(c) ? c.toUpperCase() : null; } catch (e) { return null; } }
function giftBtnHtml(x, mode, room) {
  if (x.isMe || mode === 'vs' || (room && room.started)) return '';
  const m = G.meta, out = m.gear.outbox.find((g) => g.to === x.peer);
  if (out) return `<br><small class="mp-gift-out" style="color:${QUALS[out.item.q].color}">送出中 · ${esc(Gear.name(out.item))}</small> <button class="btn small" type="button" data-giftcancel="${esc(out.id)}">取消</button>`;
  const n = m.gear.stash.filter((it) => Station.giftable(it)).length;
  return `<br><button class="btn small ${G.giftTo === x.peer ? 'primary' : ''}" type="button" data-gift="${esc(x.peer)}" ${offIf(!n, '仓库里没有能送的：蓝、黄、绿可以送，暗金和改过的不行')}>${icon('i-stash')} 送装备</button>`;
}
function giftPickHtml(x) {
  const m = G.meta, L = m.gear.stash.filter((it) => Station.giftable(it)).sort((a, b) => QUALS[b.q].rank - QUALS[a.q].rank || b.ilvl - a.ilvl).slice(0, 24);
  return `<div class="panel mp-giftpick"><div class="label">送给 ${esc(x.name)} 一件 <small class="dim-text">蓝、黄、绿可以送；暗金和改造台改过的不行</small></div><div class="cl-items">${L.map((it) => `<button class="cl-it" type="button" data-giftitem="${esc(it.uid)}" style="color:${QUALS[it.q].color}">${esc(Gear.name(it))} <small class="dim-text">Lv${it.req}</small></button>`).join('')}</div></div>`;
}
/* 结局（§9.5）：中继天线接上，“回声”第一次听到地球的杂音——“……还有人吗？”，然后是“未完”。点一下或按键继续（3 秒以后） */
function showRelayEnding(next) {
  const el = showScreen('ending', `<canvas class="relay-c" id="relay-c"></canvas><div class="relay-txt" id="relay-txt"></div><div class="relay-skip dim-text" id="relay-skip" hidden>点一下继续</div>`, { bg: 'station', cls: 'relay', label: '结局' });
  const c = $('#relay-c', el), g = c.getContext('2d'), txt = $('#relay-txt', el), t0 = performance.now(); let done = false;
  const lines = [[0.6, '中继天线接上了。'], [3.2, '（杂音）'], [5.4, '……还有人吗？'], [9.2, '未完']];
  Sound.setMode('hub'); Sound.sfx('cargoShip');
  const fin = () => { if (done || performance.now() - t0 < 3000) return; done = true; window.removeEventListener('keydown', fin); next(); };
  el.addEventListener('click', fin); window.addEventListener('keydown', fin);
  const draw = () => {
    if (done || !document.body.contains(c)) return;
    const W = (c.width = c.clientWidth || innerWidth), H = (c.height = c.clientHeight || innerHeight), t = (performance.now() - t0) / 1000;
    // 背后是站（主画布在画，中继天线已经装上）：这里只压暗四周、画信号和地球
    const vg = g.createRadialGradient(W * 0.6, H * 0.45, H * 0.2, W * 0.5, H * 0.5, H * 0.95); vg.addColorStop(0, 'rgba(5,3,12,0.15)'); vg.addColorStop(1, `rgba(5,3,12,${0.55 + 0.25 * Math.min(1, t / 3)})`);
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const rx = W * 0.78, ry = H * 0.42, ex = W * 0.9, ey = H * 0.12, k = clamp((t - 1.2) / 2, 0, 1); // 天线 → 地球
    g.globalCompositeOperation = 'lighter';
    if (k > 0) { // 一道往上走的信号，一段一段亮
      for (let i = 0; i < 18; i++) { const u = (i / 18 + t * 0.35) % 1; if (u > k) continue; const x = lerp(rx, ex, u), y = lerp(ry, ey, u); drawGlow(g, x, y, 10 + 6 * Math.sin(t * 6 + i), 'rgba(214,184,255,0.9)', 0.7); }
    }
    const ek = clamp((t - 3.2) / 1.5, 0, 1); // 地球：很远的一颗蓝点，听见杂音以后亮起来
    if (ek > 0) { drawGlow(g, ex, ey, 40 + 18 * ek + 8 * Math.sin(t * 2.4), 'rgba(110,180,255,0.9)', 0.6 * ek); g.globalCompositeOperation = 'source-over'; g.fillStyle = `rgba(150,205,255,${ek})`; g.beginPath(); g.arc(ex, ey, 5 + ek * 2, 0, TAU); g.fill(); g.globalCompositeOperation = 'lighter'; }
    drawGlow(g, rx, ry, 50 + 10 * Math.sin(t * 3), 'rgba(214,184,255,0.8)', 0.5 * clamp(t / 1.2, 0, 1));
    g.globalCompositeOperation = 'source-over';
    const amp = t < 3.2 ? 2 : t < 5.4 ? 18 * (0.5 + 0.5 * Math.sin(t * 9)) : 8 + 6 * Math.sin(t * 2); // 先是平线，再是杂音，然后像人的声音
    g.strokeStyle = 'rgba(159,242,200,0.85)'; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x <= W; x += 6) { const n = Math.sin(x * 0.05 + t * 8) * amp + (t > 3.2 && t < 5.4 ? (((x * 7919 + Math.floor(t * 30) * 104729) % 97) / 97 - 0.5) * amp * 1.6 : 0); g.lineTo(x, H * 0.9 + n); }
    g.stroke();
    const shown = lines.filter(([at]) => t >= at).map(([, s]) => s); txt.textContent = shown[shown.length - 1] || ''; txt.classList.toggle('end', t >= 9.2);
    const sk = $('#relay-skip', el); if (sk) sk.hidden = t < 3;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
function inviteLink(code) { return `${location.origin}${location.pathname}?join=${code}`; }
function showMultiplayer(back, joinCode, resumeData) {
  const m = G.meta; if (!m.nick) m.nick = '玩家' + Math.floor(100 + Math.random() * 900);
  hideHud(); G.world = null; Input.gameActive = false; stopPreview();
  const leaveAndBack = () => { Lobby.onUpdate = null; back(); }; // 回家园时留在房间里：可以先去交项目，房主开局会把你拉进来；“离开房间”才真的离开
  const el = showScreen('mp', `${backBtn()}
    <div class="screen-title"><h2>联机</h2><p>2–4 人 · 合作闯关或对抗 · 升级和掉落各拿各的</p></div>
    <div class="mp-wrap">
      <div class="panel set-sec mp-me">
        <h3>你</h3>
        <label class="mp-nick"><span class="label">昵称</span><input id="mp-nick" maxlength="12" autocomplete="off" spellcheck="false" value="${esc(m.nick)}"></label>
        <div class="row"><canvas width="72" height="72" data-plane="${m.current}" data-happy="1" data-look="1"></canvas><span>${PLANES[m.current].name}<br><small class="dim-text">带着你自己的装备和驾驶员等级出战；掉落各一份</small></span></div>
        <p class="dim-text mp-net" id="mp-net">正在连接…</p>
        <button class="btn small primary" id="mp-reload" type="button" hidden>刷新页面</button>
      </div>
      <div class="panel set-sec mp-main" id="mp-body"><p class="dim-text">正在连接…</p></div>
    </div>`, { bg: 'hub', back: leaveAndBack, label: '联机' });
  const nick = $('#mp-nick', el);
  nick.addEventListener('keydown', (e) => e.stopPropagation()); // 打字时不触发方向键菜单导航
  $('#mp-reload', el).onclick = () => location.reload();
  nick.addEventListener('change', () => { m.nick = nick.value.trim().slice(0, 12) || m.nick; persist(); if (Lobby.code) Lobby.me({ name: m.nick }); });
  const rm = resumeData && resumeData.isHost ? resumeData.mp || {} : {}; // 房主刷新回来：沿用刷新前的设置
  // 合作也是三关连成一局：固定从 1-1 打起
  let sig = '', stage = stationStart(), delay = 0, mode = G.mpMode || rm.mode || 'coop', stat = G.mpStat || rm.stat || 'real'; // 合作 / 对抗（v0.11）；对抗属性：真实成长 / 统一属性
  const lad = ladderNow(m); // 房主当前选的梦魇级，合作开局时带上
  const cfgNow = () => `${mode}|${mode === 'vs' ? stat : stage + '|' + lad}|${G.mpRound || 0}`; // 房主的配置号：改玩法 / 关卡 / 属性（或开过一局）就变，之前的“准备”自动作废
  let cdTimer = null;
  const paint = () => {
    if (G.screen !== 'mp' || !document.body.contains(el)) { Lobby.onUpdate = null; if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } return; }
    const net = Lobby.net, body = $('#mp-body', el); if (!net) return;
    const rooms = Lobby.openRooms(), room = Lobby.code ? Lobby.room() : null;
    // 房主不见了：等 8 秒（他可能只是刷新页面）还没回来才算解散
    if (Lobby.code && !Lobby.isHost && !room && net.connected() && !Lobby.resumeWait) { G.hostGoneAt = G.hostGoneAt || performance.now(); if (performance.now() - G.hostGoneAt > 8000) { G.hostGoneAt = 0; Lobby.leave(); toast('房主离开了，房间已解散', '#ffb2a8'); } else { setTimeout(paint, 1000); } } else G.hostGoneAt = 0;
    const stale = net.stale && net.stale(), nb = $('#mp-reload', el); if (nb) nb.hidden = !stale;
    $('#mp-net', el).textContent = stale ? '游戏有新版本了：刷新页面才能和大家联机' : net.kind === 'ws' ? (net.connected() ? `已连上联机服务器${net.rtt !== null ? ` · 延迟 ${net.rtt} 毫秒` : ''}` : '正在连接联机服务器…')
      : net.kind === 'room' ? '通过 Claude 房间连接：打开同一个游戏链接的人都能看到你的房间。' : '本机测试模式：在这个浏览器里再开一个窗口打开游戏，就能互相看到。';
    if (room && !Lobby.isHost) { if (room.mode) mode = room.mode; if (room.stat) stat = room.stat; } // 跟着房主选的玩法
    const host = Lobby.isHost, me = Lobby.myMp();
    if (host && room && me.cfg !== cfgNow()) Lobby.me({ cfg: cfgNow(), mode, stage, stat, ladder: lad, cd: null }); // 房主改了设置：发出新的配置号（准备全部作废、倒计时取消）
    const ms = room ? room.members : [], n = ms.length, cfg = room && room.cfg, others = ms.filter((x) => !x.host);
    const isReady = (x) => x.host || (cfg && x.rdy === cfg), notReady = others.filter((x) => !isReady(x)), allReady = n >= 2 && !notReady.length;
    const cd = room && room.cd && room.cd.cfg === cfg ? room.cd : null, now = net.serverNow ? net.serverNow() : Date.now(), cdLeft = cd && now !== null ? Math.max(0, Math.ceil((cd.at - now) / 1000)) : null;
    // 房主：倒计时到了就开局；倒计时中有人取消准备 / 设置变了就自动取消
    if (host && cd) { if (!allReady) Lobby.me({ cd: null }); else if (now !== null && now >= cd.at) { Lobby.me({ cd: null }); G.mpRound = (G.mpRound || 0) + 1; if (!Lobby.start(stage, delay, mode, stat, lad)) Sound.sfx('denied'); return; } }
    if (cd && !cdTimer) cdTimer = setInterval(paint, 200); else if (!cd && cdTimer) { clearInterval(cdTimer); cdTimer = null; }
    if (room && mode !== 'vs') mpGiftSync(ms);
    const k = JSON.stringify([Lobby.code, host, stage, delay, mode, stat, cfg, cdLeft, G.giftTo || null, m.gear.outbox.map((g) => g.id).join(), room && room.members.map((x) => [x.peer, (x.prof && x.prof.gifts || []).length, x.name, x.plane, x.playing, x.rdy, x.prof && x.prof.g, x.prof && x.prof.w && x.prof.w.target, x.prof && x.prof.w && x.prof.w.upper, x.prof && x.prof.s && x.prof.s.hearts, x.prof && x.prof.s && x.prof.s.dmgK, x.prof && x.prof.u]), room && room.started, !Lobby.code && rooms.map((r) => [r.code, r.members.length, r.started, r.stage, r.mode, r.stat, r.players.join(), r.members[0].name])]);
    if (k === sig) return; sig = k;
    if (!Lobby.code) {
      const myId = net.selfId;
      body.innerHTML = `<h3>房间</h3>
        <div class="row wrap"><button class="btn primary" id="mp-create" type="button" autofocus>${icon('i-play')} 创建房间</button><span class="dim-text">建好后把同一个链接发给朋友</span></div>
        <div class="mp-list">${rooms.length ? rooms.map((r) => { const mine = r.started && r.players.includes(myId); return `<div class="mp-room"><b class="mp-code">${esc(r.code)}</b><span>${esc(r.members[0].name)} 的房间 · ${r.mode === 'vs' ? `对抗 · ${r.stat === 'fair' ? '统一属性' : '真实成长'}` : '合作'} · ${r.members.length}/${MP_MAX} 人${r.started ? ' · 进行中' : r.stage && r.mode !== 'vs' ? ` · ${esc(r.stage)}` : ''}</span>${mine ? `<button class="btn small primary" data-back="${esc(r.code)}" type="button">回到对局</button>` : `<button class="btn small" data-join="${esc(r.code)}" type="button" ${r.started || r.members.length >= MP_MAX ? 'disabled' : ''}>${r.started ? '进行中' : '加入'}</button>`}</div>`; }).join('') : '<p class="dim-text">现在没有可加入的房间。</p>'}</div>`;
      $('#mp-create', body).onclick = () => { Sound.sfx('select'); G.mpRound = 0; Lobby.create(mpProfile()); sig = ''; paint(); };
      $$('[data-join]', body).forEach((b) => b.onclick = () => { Sound.sfx('select'); Lobby.join(b.dataset.join, mpProfile()); sig = ''; paint(); });
      $$('[data-back]', body).forEach((b) => b.onclick = () => { Sound.sfx('select'); const d = Lobby.savedRoom(); if (d && d.code === b.dataset.back) Lobby.resume(d); else { Lobby.join(b.dataset.back, mpProfile()); Lobby.resumeGame = rooms.find((r) => r.code === b.dataset.back).startId || null; } sig = ''; paint(); });
      return;
    }
    const dOpts = [[0, '自动'], [3, '短'], [6, '中'], [10, '长']], dNow = delay; // 0 = 按大家的延迟自动定
    const meReady = me.rdy && me.rdy === cfg;
    body.innerHTML = `<h3>房间 <b class="mp-code">${esc(Lobby.code)}</b> <small class="dim-text">${n}/${MP_MAX} 人 · ${mode === 'vs' ? `对抗 · ${stat === 'fair' ? '统一属性' : '真实成长'}` : `合作 · ${esc(MAPS[mapOfStage(host ? stage : (room && room.stage) || stage)].name)}`}</small></h3>
      <div class="mp-members">${ms.map((x, i) => `<div class="mp-mem ${x.isMe ? 'me' : ''}"><i style="background:${PLAYER_COLORS[i % 4]}"></i><canvas width="56" height="56" data-plane="${x.plane}"></canvas><span><b>${esc(x.name)}</b>${x.isMe ? ' <small class="chip">你</small>' : ''}${x.host ? ' <small class="chip gold">房主</small>' : isReady(x) ? ' <small class="chip ok">✓ 准备</small>' : ' <small class="chip">未准备</small>'}<br><small class="dim-text">${PLANES[x.plane].name}${mode === 'vs' ? '' : x.prof && x.prof.g ? ` · ${esc(x.prof.g)}` : ''}</small>${mode === 'vs' && stat === 'fair' ? '<br><small class="mp-grow">统一属性：♥5 · 攻 ×1.00 · 大招 1</small>' : growthHtml(x.prof)}${giftBtnHtml(x, mode, room)}</span></div>`).join('')}</div>
      ${G.giftTo && ms.some((x) => x.peer === G.giftTo) ? giftPickHtml(ms.find((x) => x.peer === G.giftTo)) : ''}
      ${mode === 'vs' ? (stat === 'fair' ? '<p class="dim-text mp-world">本场统一属性：所有人按 1 级基础属性、大招容量 1，不带局外成长</p>' : vsGapHtml(ms)) : ''}
      ${mpRulesHtml(mode, true)}
      ${host ? `<div class="row wrap"><span class="label">玩法</span><div class="seg" role="group"><button type="button" data-mm="coop" class="${mode === 'coop' ? 'on' : ''}">合作</button><button type="button" data-mm="vs" class="${mode === 'vs' ? 'on' : ''}">对抗</button></div></div>
        ${mode === 'vs' ? `<div class="row wrap"><span class="label">属性</span><div class="seg" role="group"><button type="button" data-ms="real" class="${stat === 'real' ? 'on' : ''}">真实成长</button><button type="button" data-ms="fair" class="${stat === 'fair' ? 'on' : ''}">统一属性</button></div><span class="dim-text">${stat === 'fair' ? '公平对抗：大家一样的属性' : '带着各自的局外成长：差距会摆在上面'}</span></div>` : `<div class="row wrap"><span class="label">地图</span><span class="dim-text">${esc(MAPS[mapOfStage(stage)].name)} · 从 ${stage} ${esc(STAGES[stage].name)} 开始（在站的星图里换）</span></div>`}
        <div class="row wrap"><span class="label">网络缓冲</span><div class="seg" role="group">${dOpts.map(([v, t]) => `<button type="button" data-md="${v}" class="${v === dNow ? 'on' : ''}">${t}</button>`).join('')}</div><span class="dim-text">卡顿就调长，操作会晚一点生效</span></div>
        <div class="row wrap">${cd ? `<button class="btn primary big" type="button" ${offIf(true, '马上开始：要取消就按旁边的「取消」')}>${cdLeft} 秒后开始</button><button class="btn small coral" id="mp-cancel" type="button">取消</button>` : `<button class="btn primary big" id="mp-start" type="button" ${offIf(!allReady, n < 2 ? '至少要两个人：把邀请链接发给朋友' : `等队友点「准备」：还差 ${notReady.length} 人`)}>${icon('i-hangar')} ${mode === 'vs' ? '开始对抗' : `开始 · ${stage} ${STAGES[stage].name}`}</button>`}${n < 2 ? '<span class="dim-text">至少 2 人才能开始</span>' : notReady.length ? `<span class="dim-text">等 ${notReady.map((x) => esc(x.name)).join('、')} 点准备</span>` : ''}</div>`
        : room && room.started ? `<p class="dim-text">这一局已经开始了，等下一局。</p>`
        : `<div class="row wrap">${cd ? `<b class="mp-cd">${cdLeft} 秒后开始</b><span class="dim-text">现在取消准备也来得及</span>` : ''}<button class="btn ${meReady ? 'coral' : 'primary'}" id="mp-ready" type="button">${meReady ? '取消准备' : '✓ 准备'}</button><span class="dim-text">${meReady ? '等房主开始…' : '看完上面的规则，点准备，房主才能开始'}</span></div>`}
      ${host && /^https?:$/.test(location.protocol) ? `<div class="row wrap"><span class="label">邀请链接</span><input class="mp-link" id="mp-link" readonly value="${esc(inviteLink(Lobby.code))}"><button class="btn small cyan" id="mp-copy" type="button">复制</button></div>` : ''}
      <div class="row"><button class="btn coral small" id="mp-leave" type="button">离开房间</button></div>`;
    paintPlaneCanvases(body);
    $('#mp-leave', body).onclick = () => { Sound.sfx('uiBack'); Lobby.leave(); sig = ''; paint(); };
    // 送装备：点队友的「送装备」→ 从仓库挑一件（蓝黄绿）→ 进待送；对方收到以后自动清掉；对方不在时可以取消拿回
    $$('[data-gift]', body).forEach((b) => b.onclick = () => { Sound.sfx('ui'); G.giftTo = G.giftTo === b.dataset.gift ? null : b.dataset.gift; sig = ''; paint(); });
    $$('[data-giftitem]', body).forEach((b) => b.onclick = () => { const to = ms.find((x) => x.peer === G.giftTo); const g = to && Station.giftSend(m, b.dataset.giftitem, to.peer, to.name); if (!g) { Sound.sfx('denied'); return; } Sound.sfx('select'); persist(); G.giftTo = null; Lobby.me(mpProfile()); toast(`送给 ${to.name}：${Gear.name(g.item)} · 对方收到就送到了`, QUALS[g.item.q].color, null, 2600); sig = ''; paint(); });
    $$('[data-giftcancel]', body).forEach((b) => b.onclick = () => { if (!Station.giftCancel(m, b.dataset.giftcancel)) return; Sound.sfx('uiBack'); persist(); Lobby.me(mpProfile()); toast('取消了，东西回到你的仓库', '#ffe38a'); sig = ''; paint(); });
    const cp = $('#mp-copy', body), li = $('#mp-link', body);
    if (li) li.addEventListener('keydown', (e) => e.stopPropagation());
    if (cp) cp.onclick = () => { const done = () => { Sound.sfx('ui'); toast('邀请链接已复制，发给朋友就行', '#9ff2c8'); }; try { navigator.clipboard.writeText(li.value).then(done, () => { li.select(); toast('按 Ctrl+C 复制', '#ffe38a'); }); } catch (e) { li.select(); toast('按 Ctrl+C 复制', '#ffe38a'); } };
    $$('[data-md]', body).forEach((b) => b.onclick = () => { Sound.sfx('ui'); delay = +b.dataset.md; paint(); });
    $$('[data-mm]', body).forEach((b) => b.onclick = () => { Sound.sfx('ui'); mode = G.mpMode = b.dataset.mm; paint(); });
    $$('[data-ms]', body).forEach((b) => b.onclick = () => { Sound.sfx('ui'); stat = G.mpStat = b.dataset.ms; paint(); });
    const rb = $('#mp-ready', body); if (rb) rb.onclick = () => { Sound.sfx(meReady ? 'uiBack' : 'select'); Lobby.me({ rdy: meReady ? null : cfg }); sig = ''; paint(); };
    const cb2 = $('#mp-cancel', body); if (cb2) cb2.onclick = () => { Sound.sfx('uiBack'); Lobby.me({ cd: null }); sig = ''; paint(); };
    const sb = $('#mp-start', body); if (sb) sb.onclick = () => { if (!allReady) { Sound.sfx('denied'); return; } const t = net.serverNow ? net.serverNow() : Date.now(); Sound.sfx('select'); Lobby.me({ cd: { at: Math.round((t === null ? Date.now() : t) + 3000), cfg } }); sig = ''; paint(); }; // 3 秒倒计时，可以取消
  };
  Lobby.onStart = (st) => { if (G.mpRun) return false; startMpRun(st); return true; };
  Lobby.connect().then(() => {
    if (resumeData && !Lobby.code) { Lobby.resume(resumeData); $('#mp-net', el).textContent = '正在回到刚才的房间…'; } // 刷新页面：回到原房间；那一局还在打就以原身份回去
    if (Lobby.code) Lobby.me(mpProfile()); Lobby.onUpdate = paint; paint();
    if (joinCode && !Lobby.code) { // 从邀请链接进来：房间出现就自动加入，最多等 8 秒
      const t0 = performance.now(); $('#mp-net', el).textContent = `正在进入房间 ${joinCode}…`;
      const tryJoin = () => {
        if (Lobby.code || G.screen !== 'mp') return;
        const r = Lobby.openRooms().find((x) => x.code === joinCode);
        if (r && !r.started && r.members.length < MP_MAX) { Lobby.join(joinCode, mpProfile()); sig = ''; paint(); return; }
        if (performance.now() - t0 > 8000) { toast(r ? (r.started ? '这个房间已经开局了' : '这个房间满了') : `房间 ${joinCode} 不在了`, '#ffb2a8'); return; }
        setTimeout(tryJoin, 300);
      };
      tryJoin();
    }
  }).catch(() => { $('#mp-body', el).innerHTML = '<p class="dim-text">连接失败，请刷新页面重试。</p>'; });
}
function startMpRun(st) {
  const idx = Lobby.beginSession(st); if (idx < 0) return false;
  Lobby.onUpdate = null;
  const net = Lobby.net, sync = st.at && net.serverNow && net.serverNow() !== null; // 按共同时钟换算成本机时间：大家同一刻开局
  startRun(st.stage, { st, idx, t0: sync ? net.localPerfOf(st.at) : performance.now(), rejoin: !!(Lobby.session && Lobby.session.rejoining) });
  return true;
}

/* ================================================== RUN ================================================== */
function startRun(stageId, mp) {
  const m = Station.ensure(G.meta), id = m.current;
  const vsRun = !!(mp && mp.st.mode === 'vs'); // 对抗不算地图进度
  // 一局 = 一张地图三关连打（§3.6）；从路标开始时从那一关打起，开场补发升级（§11.3）
  stageId = vsRun ? mp.st.stage : mp ? (STAGES[mp.st.stage] ? mp.st.stage : '1-1') : STAGES[stageId] ? stageId : stationStart();
  if (G.endShownAt) { const dt = (performance.now() - G.endShownAt) / 1000; m.telemetry.lastRestart = Math.round(dt * 10) / 10; G.endShownAt = null; }
  if (m.records.runs === 1) Tele.log('second_run_started');
  const first = !mp && !m.firstRunDone && stageId === '1-1';
  G.mpRun = mp || null; G.mpLock = !!mp; if (mp) window.dispatchEvent(new Event('resize')); // 多人：画面宽度固定 1280，各端世界一致
  if (!(mp && mp.rejoin)) { m.records.runs++; Tele.log('run_started', { stage: stageId }); if (!vsRun) m.maps.reached[stageId] = true; }
  applySettings(); clearScreens(); stopPreview();
  $('#banner').innerHTML = ''; banner._until = 0; $('#toast').innerHTML = ''; G.goldSeen = false; // 上一局的横幅 / 提示不带进新的一局
  G.bg = 'world'; G.paused = false; G.mapHint = null; G.lurkQ = null; G.lurkOn = null; G.hintId = null; G.hudPin = {}; // 新的一局：战斗界面从空屏开始
  G.sea.setTheme(vsRun ? '1-1' : stageId); // 每关自己的场景
  G.tutorial = { on: !mp && !m.tutorialDone }; // 联机不显示单人的开局教学清单
  G.runShipped = new Set(); G.stationArrive = null;
  const lootCfg = Station.lootCfg(m), catchUp = vsRun ? 0 : Station.catchUp(stageId);
  const mkWorld = () => new World({
    mode: 'run', W: mp ? 1280 : G.W, plane: id, stage: stageId, ultCap: 1, stats: planeStats(m, id), first, vs: vsRun,
    seed: mp ? mp.st.seed : undefined, me: mp ? mp.idx : 0, loot: lootCfg, catchUp,
    players: mp ? mp.st.roster.map((r) => ({ id: r.peer, name: r.name, plane: r.plane, stats: r.stats || planeStats(null, r.plane), ultCap: 1, cos: r.cos || {} })) : undefined,
    ladder: 0, chain: !vsRun, target: (m.nextHint && (m.nextHint.target || m.nextHint.buildName)) || null, tutorial: !m.tutorialDone, settings: m.settings, scene: G.sea, cos: m.cosmetics, seenMap: Object.keys(m.codex.map || {}),
    cb: {
      onEnd: onRunEnd,
      onCargo: (items) => { Station.shipHome(m, items, G.runShipped); persist(); }, // 首领倒下、货舱送回家：当场存档
      onSkill: (sid) => { m.codex.skills[sid] = 1; },
      onSynergy: (key) => { m.codex.syns[key] = 1; },
      onSeenEnemy: (t) => { if (t) m.codex.enemies[t] = 1; },
      onMap: (kind, sub) => { m.codex.map[kind] = 1; },
    },
  });
  G.world = mkWorld();
  // 联机断线回来要“从开局重算”时：用完全相同的参数再建一个世界（MpDriver 接着按操作记录追帧）
  Lobby.onReplay = mp ? () => { const old = G.world; if (!old || !G.mpRun || old.done) return false; const nw = mkWorld(); nw.slotPos = old.slotPos; G.world = nw; return true; } : null;
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
  const M = MAPS[mapOfStage(stageId)];
  if (mp) { G.mpLoop = { t0: mp.t0 || performance.now(), steps: 0, dx: 0, dy: 0, waitT: 0, desyncShown: false, last: performance.now() }; if (vsRun) banner(`对抗 · ${mp.st.roster.length} 人 · ${mp.st.stat === 'fair' ? '统一属性' : '真实成长'}`, '清风塔拿分 · 洞口送干扰 · 冲突区能打对手 · H 看规则', 2.6); else banner(`${M.name} · ${mp.st.roster.length} 人联机`, '升级和掉落各拿各的 · H 看规则', 2.4); }
  else banner(`地图 ${M.id} · ${M.name}`, `回声：“${M.mission}”`, 2.6);
  persist();
}
function onRunEnd(res) {
  if (G.world && G.world._rewarded) return; // 奖励只发一次
  const gid = G.mpRun && G.mpRun.st && G.mpRun.st.id; // 联机奖励账本（v0.11 §9）：同一局只结算一次，重连 / 重复结束只补展示
  if (G.mpRun) { Lobby.endGame(); G.mpRun = null; G.mpLoop = null; G.mpLock = false; window.dispatchEvent(new Event('resize')); }
  if (G.world) G.world._rewarded = true;
  if (gid) { const L = G.meta.mpLedger || (G.meta.mpLedger = []); if (L.includes(gid)) { toast('这一局已经结算过了', '#ffe38a'); showHub(); return; } L.push(gid); while (L.length > 40) L.shift(); }
  if (res.vs) { settleVs(res); return; }
  const m = Station.ensure(G.meta), st = res.stats, first = !m.firstRunDone;
  res.creditK = (G.world && G.world.me && G.world.me.stats.credit) || 0; res.shipped = G.runShipped || new Set();
  const out = Station.settle(m, res); // 装备（送回的、套装暗金、保险舱）、信用点、材料、经验、地图进度、解锁
  const Sx = m.stats;
  Sx.kills += st.kills; Sx.bursts += st.bursts; Sx.runs += 1; Sx.syns += st.syns; Sx.streak100 += st.streak100 ? 1 : 0; Sx.crystals += st.crystals; Sx.bossKills += (res.cleared || []).length; Sx.lv5 += st.lv5 ? 1 : 0; Sx.chests += st.chests;
  Sx.interacts = (Sx.interacts || 0) + (st.interacts || 0);
  Tele.add('map_interacts', st.interacts); Tele.add('offers', st.offers); Tele.add('offer_missed', st.offerMiss); Tele.add('loot', (res.loot && res.loot.n) || 0);
  const R = m.records; R.playT = (R.playT || 0) + (res.runT || 0);
  if (res.win) { R.clears++; if (!R.bestTime || res.runT < R.bestTime) R.bestTime = Math.round(res.runT); }
  R.bestStreak = Math.max(R.bestStreak, st.maxStreak); R.bestCrystals = Math.max(R.bestCrystals, st.crystals);
  Tele.log(res.win ? 'run_completed' : 'run_failed', { stage: res.stage, cleared: (res.cleared || []).length });
  if (first) Tele.log('first_run_ended');
  Tele.add('kills', st.kills); Tele.add('bursts', st.bursts); Tele.add('synergies', st.syns);
  const runs = m.telemetry.runs || (m.telemetry.runs = []);
  runs.push({ at: Date.now(), stage: res.stage, win: res.win, plane: res.plane, level: m.pilot.lv, firstKill: st.firstKill, firstSkill: st.firstSkill, firstBurst: st.firstBurst, changes: st.crystals, highlights: st.highlights, avgKill: res.avgKill, gap: st.gapMax, runT: res.runT, noGoal: st.noGoalMax, goalTimes: res.goalTimes,
    interacts: st.interacts, choiceTime: res.choiceAvg, stockIdle: st.stockIdle, leaks: st.leaks, progress: res.progress, hurt: res.hurt, loot: res.loot });
  while (runs.length > 40) runs.shift();
  m.firstRunDone = true;
  const lure = makeLure(res);
  m.nextHint = lure;
  persist();
  G.lastRes = { res, out, lure };
  G.stationArrive = { credits: out.credits, kept: out.kept.length, unlocks: out.unlocks, items: out.kept.map((it) => ({ q: it.q, name: Gear.name(it) })) }; // 回家开货舱（§14）
  if (first && out.kept.length) m.station.tut.equip = 1; // 第一次带着装备回家：站里强制引导换装（§8.4）
  const relay = G.relayPending && out.mapClear === 5; G.relayPending = false;
  if (relay) showRelayEnding(() => showEnd(G.lastRes)); else showEnd(G.lastRes); // 第一次打倒混沌祭司：先放结局（§9.5）
}
/* 对抗分数拆解：各项合计正好等于总分（vs.js 的分数账本） */
const VS_PART_NAMES = [['kill', '击破'], ['tower', '风塔'], ['sent', '送干扰'], ['held', '防守'], ['ko', '压制'], ['loss', '被击毁']];
function vsPartsHtml(v, k) {
  const P = v.parts && v.parts[k]; if (!P) return `风塔 ${v.towers[k]} · 防守 ${v.held[k]} · 被击毁 ${v.kos[k]}`;
  return VS_PART_NAMES.map(([id, nm]) => `${nm} ${P[id] > 0 ? '+' : ''}${P[id]}${id === 'tower' ? `（${v.towers[k]} 座）` : id === 'loss' ? `（${v.kos[k]} 次）` : ''}`).join(' · ');
}
/* 分差主要来自哪一项（和第一名比；自己是第一就和第二名比），给下局一个方向 */
function vsGapLine(v, order) {
  if (!v.parts || order.length < 2) return '';
  const me = v.me, other = order[0] === me ? order[1] : order[0], A = v.parts[me], B = v.parts[other], gap = v.scores[me] - v.scores[other];
  const d = VS_PART_NAMES.map(([id, nm]) => ({ id, nm, d: A[id] - B[id] })).filter((x) => x.d !== 0).sort((a, b) => (gap >= 0 ? b.d - a.d : a.d - b.d));
  if (!d.length) return '';
  const top = d.slice(0, 2).map((x) => `${x.nm} ${x.d > 0 ? '+' : ''}${x.d}`).join('、');
  const tip = gap >= 0 ? '' : { kill: '下局多清怪：Build 往清怪效率走', tower: '下局先清风塔：目标分最多', sent: '风塔清完记得进洞口送干扰', held: '对手送来的干扰要清掉：防守也有分', ko: '冲突区里多压制对手', loss: '下局少被击毁：冲突区和厚甲面前别贴太近' }[d[0].id];
  return `<p class="vs-gap">${gap >= 0 ? `领先 ${esc(v.names[other])} ${gap} 分，主要来自：${top}` : `和 ${esc(v.names[other])} 差 ${-gap} 分，主要差在：${top}`}${tip ? `<br><b>${tip}</b>` : ''}</p>`;
}
/* 对抗结算（v0.11 §12）：参与就有常规星尘，清塔另算，胜者额外一点（有限，不形成越强越赚）；不算关卡进度、不救伙伴；
   有效战斗时间照常推进家园工作（这是自己实际参与的出击） */
const VS_PAY = { base: 60, tower: 20, win: 50 }; // 信用点
function settleVs(res) {
  const m = Station.ensure(G.meta), st = res.stats, v = res.vs; m.records.playT = (m.records.playT || 0) + (res.runT || 0); // 对抗也算累计出击时间
  const won = !res.abandoned && v.rank === 1 && !v.draw, sand = Math.floor(st.dust), sandStar = Math.floor(sand / 10);
  // 参与奖要有效参与：打完全程；主动退出至少打满一段（约 2 分钟）；掉线被移出 / 队友那边先结束的，打满 1 分钟就给（不误罚掉线）
  const quit = res.abandoned && !res.kicked && !res.orphan, base = !res.abandoned ? VS_PAY.base : (quit ? v.t >= VS.stageT : v.t >= 60) ? VS_PAY.base : 0;
  const pay = base + v.towers[v.me] * VS_PAY.tower + (won ? VS_PAY.win : 0), dust = pay + sandStar, before = Math.floor(m.credits);
  m.credits += dust; Station.addXp(m, Math.round((st.kills || 0) * 0.25)); // 对抗不掉装备，给信用点和经验（§13）
  const Sx = m.stats; Sx.kills += st.kills; Sx.bursts += st.bursts; Sx.runs += 1; Sx.crystals += st.crystals;
  m.records.vs = m.records.vs || { n: 0, wins: 0 }; m.records.vs.n++; if (won) m.records.vs.wins++;
  Tele.log('vs_completed', { rank: v.rank, of: v.of });
  persist();
  G.lastRes = { res, rewards: { dust, pay, base, sand, sandStar, before, after: Math.floor(m.credits), won, quit } };
  G.stationArrive = { credits: dust, kept: 0, unlocks: Station.checkUnlocks(m) };
  showVsEnd(G.lastRes);
}
function showVsEnd(E) {
  Input.gameActive = false; hideHud(); toggleRulesCard(false); Sound.setMode('result'); Sound.focus(false);
  $('#toast').innerHTML = ''; $('#banner').innerHTML = ''; banner._until = 0;
  G.endShownAt = performance.now();
  const r = E.res, v = r.vs, rw = E.rewards;
  const order = v.scores.map((sc, k) => k).sort((a, b) => v.scores[b] - v.scores[a] || v.towers[b] - v.towers[a] || a - b);
  const rows = order.map((k, i) => `<div class="vs-row ${k === v.me ? 'me' : ''}"><b>${i + 1}</b><i style="background:${PLAYER_COLORS[k % 4]}"></i><span>${esc(v.names[k])}${v.gone[k] ? ` <small class="dim-text">${v.timedOut && v.timedOut[k] ? '（断线超过 60 秒，按退出处理）' : '（中途退出）'}</small>` : ''}</span><span class="num">${v.scores[k]}</span><small class="dim-text vs-parts">${vsPartsHtml(v, k)}</small></div>`).join('');
  const el = showScreen('end', `
    <div class="center-col">
      <div class="h-display" style="font-size:var(--fs-xl);color:${rw.won ? 'var(--lamp2)' : 'var(--paper)'}">${r.abandoned ? '已退出对抗' : v.draw ? '平局！' : rw.won ? '你赢了！' : `第 ${v.rank} 名`}</div>
      <div class="dim-text">对抗 · ${v.of} 人自由竞争 · ${fmtTime(r.runT)}</div>
      <div class="panel vs-board">${rows}${vsGapLine(v, order)}</div>
      <div class="rewards"><span class="reward">${icon('i-credit').replace('class="ic"', 'class="ic" style="fill:#ffd27a"')}信用点 +${rw.dust} <small class="dim-text">参与 ${rw.base}${!rw.base ? (rw.quit ? '（主动退出，没打满一段）' : '（打得太短）') : ''} · 风塔 ${v.towers[v.me] * VS_PAY.tower}${rw.won ? ` · 胜利 ${VS_PAY.win}` : ''} · 星砂折算 ${rw.sandStar}</small></span></div>
      <div class="panel end-card"><div class="label">这一局的 Build ${r.stream ? `· <span style="color:var(--lamp2)">${esc(r.stream)}</span>` : ''}</div><div class="row wrap">${buildChips(r)}</div></div>
      <div class="row wrap" style="justify-content:center"><button class="btn primary" id="end-again" type="button" autofocus>${icon('i-team')} 回到联机房间</button><button class="btn small" id="end-hub" type="button">${icon('i-hangar')} 回站</button></div>
    </div>`, { bg: 'world', cls: 'dim', label: '对抗结算' });
  $('#end-hub', el).onclick = () => { Sound.sfx('uiBack'); showHub(); };
  $('#end-again', el).onclick = () => { Sound.sfx('select'); showMultiplayer(showHub); };
}
/* 下一局的构筑目标：大厅、暂停、结算、升级卡片都用同一个 buildPlan（data.js），不再各说各的 */
function makeLure(res) {
  const m = G.meta, stream = res.stream;
  // 目标流派按上局的 Build 选（最接近做完的那条）；路线按“新一局从零开始”排——局内能力每局重新收集
  const target = buildPlan(res.build, null, m.records.runs || 0).name, plan = buildPlan(null, target);
  return { stream, target, plan };
}
/* 构筑推荐：围绕一个目标写已有 / 缺少 / 下一步先拿；只差一样的其他联动单独标成备选 */
const compName = (id) => (SKILLS[id] ? SKILLS[id].name : SYNERGIES[id] ? `「${SYNERGIES[id].name}」` : id);
/* 流派路线：图标链（已有的打勾）+ 下一步拿哪个；文字只剩名字 */
function compChip(P, id) {
  const own = P.have.includes(id) || (id === P.link && P.linkOwned), S = SKILLS[id], L = SYNERGIES[id];
  const ic = S ? icon(S.icon).replace('class="ic"', `class="ic" style="fill:${S.color}"`) : icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#ffd76a"');
  const lv = P.lv && S ? P.lv[id] || 0 : 0, prog = S && P.need && lv > 0 && lv < P.need ? ` ${lv}/${P.need}` : ''; // 联动要两件都到 need 级：已经有、还没到级的显示进度
  return `<span class="chip ${own ? 'owned' : ''}" style="color:${S ? S.color : '#ffd76a'}">${ic}${esc(S ? S.name : L ? L.name : id)}${prog}</span>`;
}
function planHtml(P, now, noHead, noPath) {
  if (!P) return '';
  const path = `<span class="lure-path">${P.path.map((id) => compChip(P, id)).join('<span class="arrow">›</span>')}</span>`;
  const next = P.done ? '<b class="good">已凑齐</b>' : `<b>${now ? '下一步' : '下局先拿'}</b> <span class="lure-path">${compChip(P, P.next)}</span>${P.swap ? fxHtml([[SKILLS[P.swap].name, -3]]) : ''}`;
  return `<div class="plan">${noHead ? '' : `<div><b>目标</b> ${esc(P.name)}</div>`}${noPath ? '' : `<div>${path}</div>`}<div class="row" style="gap:6px">${next}</div></div>`;
}
function buildChips(r) {
  const b = r.build || { gun: {}, support: null, bmod: null, links: [] }, out = [];
  for (const id of GUN_ORDER) if (b.gun[id]) out.push(`<span class="chip" style="color:${SKILLS[id].color};border-color:${SKILLS[id].color}">${icon(SKILLS[id].icon)} ${SKILLS[id].name} Lv${b.gun[id]}</span>`);
  if (b.support) out.push(`<span class="chip" style="color:${SKILLS[b.support.id].color};border-color:${SKILLS[b.support.id].color}">${icon(SKILLS[b.support.id].icon)} ${SKILLS[b.support.id].name} Lv${b.support.lv}</span>`);
  if (b.bmod) out.push(`<span class="chip" style="color:${BURST_MODS[b.bmod.id].color}">${icon(BURST_MODS[b.bmod.id].icon)} ${BURST_MODS[b.bmod.id].name} Lv${b.bmod.lv}</span>`);
  for (const k of b.links || []) out.push(`<span class="chip gold">${SYNERGIES[k].name}</span>`);
  return out.join('') || '<span class="dim-text">这一局没有选到升级</span>';
}

/* ================================================== END（结算：战利品 / 成长 / 构筑）================================================== */
function lootRowHtml(it, lost) { return `<span class="loot-chip ${lost ? 'lost' : ''} q-${it.q}" style="--qc:${QUALS[it.q].color}" title="${esc(Gear.name(it))}"><canvas width="40" height="40" data-gearobj="${esc(it.uid)}"></canvas>${esc(Gear.name(it))}</span>`; }
function showEnd(E) {
  Input.gameActive = false; hideHud(); toggleRulesCard(false); Sound.setMode('result'); Sound.focus(false); // 仪式中途结束也把音量压低撤掉
  $('#toast').innerHTML = ''; $('#banner').innerHTML = ''; banner._until = 0;
  G.endShownAt = performance.now();
  const r = E.res, st = r.stats, O = E.out, P = PLANES[r.plane], S = STAGES[r.stage], m = G.meta, M = MAPS[mapOfStage(r.stage)];
  const title = r.win ? `${M.name} 打通了！` : r.abandoned ? '本局结束' : r.mp ? `全队 ${r.team.length} 架都被击落了` : `${P.name}被击落了`;
  const route = `${r.win ? '' : `倒在第 ${stageNOf(r.stage)} 关 ${esc(S.name)} · `}${(r.cleared || []).length ? `打倒了 ${r.cleared.map((id) => STAGES[id].bossName).join('、')}` : '一个首领都还没打倒'} · 出击 ${fmtTime(r.runT)}`;
  // 战利品：带回的（品质从高到低），丢在半路的灰着列出来（§7）
  const kept = O.kept.slice().sort((a, b) => QUALS[b.q].rank - QUALS[a.q].rank || b.ilvl - a.ilvl);
  G.st.extra = Object.fromEntries([...kept, ...O.lost].map((it) => [it.uid, it]));
  const loot = `${kept.length ? kept.map((it) => lootRowHtml(it)).join('') : '<span class="dim-text">这一局没有带回装备</span>'}${O.lost.length ? `<div class="loot-lost"><span class="dim-text">丢在半路（保险舱保住了 ${O.insured.length} 件，套装和暗金一定带回）：</span>${O.lost.map((it) => lootRowHtml(it, true)).join('')}</div>` : ''}${Object.keys(O.autoGot || {}).length ? `<div class="dim-text">自动拆了一些：${esc(Station.costText(O.autoGot))}</div>` : ''}`;
  const need = pilotXpNeed(m.pilot.lv), pct = need === Infinity ? 100 : Math.round((m.pilot.xp / need) * 100);
  const grow = `<div class="rewards"><span class="reward">${icon('i-credit').replace('class="ic"', 'class="ic" style="fill:#ffd27a"')}信用点 +<b data-count="${O.credits}">${O.credits}</b></span><span class="reward">${icon('i-scrap').replace('class="ic"', `class="ic" style="fill:${MATS.scrap.color}"`)}废料 +${O.scrap}</span><span class="reward">经验 +<b data-count="${O.xp}">${O.xp}</b></span></div>
    <div class="pilot-badge big"><b>驾驶员 <span class="num">${m.pilot.lv}</span>${O.lvUp ? ` <span class="good">▲${O.lvUp}</span>` : ''}</b><span class="bar-mini"><i style="width:${pct}%"></i></span></div>
    ${O.unlocks.length ? `<div class="good">站里打开了：${O.unlocks.map((u) => FACILITIES[u] ? FACILITIES[u].name : u === 'waypoint' ? '路标' : u).join('、')}</div>` : ''}
    ${O.mapClear ? `<div class="good">站里多了：${esc(MAPS[O.mapClear].home)}${MAPS[O.mapClear + 1] ? ` · 地图 ${O.mapClear + 1} ${esc(MAPS[O.mapClear + 1].name)} 开放了` : ''}</div>` : ''}`;
  const bossDef = !r.win && r.stage && STAGES[r.stage].bossDef && (r.atBoss || (r.hurt && (r.hurt.boss || r.hurt.rage))) ? `<div class="death"><span><b>这个首领是${STAGES[r.stage].bossDef === 'armor' ? '装甲' : STAGES[r.stage].bossDef === 'shield' ? '护盾' : '护盾和装甲轮换'}</b> ${STAGES[r.stage].bossDef === 'armor' ? '动能伤害、对装甲的词条打它更疼' : STAGES[r.stage].bossDef === 'shield' ? '能量伤害、对护盾的词条打它更疼' : '两种伤害都带一点'}</span></div>` : '';
  const el = showScreen('end', `
    <div class="center-col">
      <div class="h-display" style="font-size:var(--fs-xl);color:${r.win ? 'var(--lamp2)' : 'var(--paper)'}">${esc(title)}</div>
      ${r.mp ? `<div class="dim-text">联机 · ${r.team.map((q) => esc(q.name) + (q.gone ? '（中途离开）' : '')).join('、')}</div>` : ''}
      <div class="dim-text">${route}</div>
      ${deathHtml(r)}${bossDef}
      <div class="end-grid3">
        <div class="panel end-card end-loot"><div class="label">① 战利品 · 带回 ${kept.length} 件</div><div class="loot-list">${loot}</div></div>
        <div class="panel end-card"><div class="label">② 成长</div>${grow}</div>
        <div class="panel end-card"><div class="label">③ 本局构筑 ${r.stream ? `· <span style="color:var(--lamp2)">${esc(r.stream)}</span>` : ''}</div><div class="row wrap">${buildChips(r)}</div>
          <div class="advice">${planHtml(E.lure.plan)}<small class="dim-text">局内能力每局重新收集：下一局从第一步开始</small></div></div>
      </div>
      <div class="statrow">${[['击破', st.kills], ['最高连杀', st.maxStreak], ['升级选择', st.crystals], ['联动', st.syns], ['大招', st.bursts]].map(([k, v]) => `<div class="stat-pill"><span class="num" data-count="${v}">${v}</span><span>${k}</span></div>`).join('')}</div>
      <div class="row wrap" style="justify-content:center"><button class="btn primary" id="end-hub" type="button" autofocus>${icon('i-hangar')} 回站</button><button class="btn" id="end-again" type="button">${icon('i-play')} ${r.mp ? '回到联机房间' : '再来一局'}</button></div>
    </div>`, { bg: 'world', cls: 'dim', label: r.win ? '通关结算' : '失败结算' });
  $$('canvas[data-gearobj]', el).forEach((c) => paintGearIcon(c, G.st.extra[c.dataset.gearobj]));
  $('#end-hub', el).onclick = () => { Sound.sfx('uiBack'); if (m.station.tut && m.station.tut.equip === 1) { G.st.panel = 'equip'; G.st.tut = { step: 1 }; } showHub(); };
  $('#end-again', el).onclick = () => { Sound.sfx('select'); if (r.mp) showMultiplayer(showHub); else startRun(stationStart()); };
  countUp(el);
  // 最好的那件最后出场：金、绿各一声
  const best = kept[0]; if (best && QUALS[best.q].rank >= 3) setTimeout(() => Sound.sfx(best.q === 'gold' ? 'lootGold' : 'lootGreen'), 600);
}
/* 结算数字一个个从 0 滚到真实值，音高逐个升高；奖励条一条条亮起（FP4 / FP10）。标签页在后台时直接显示最终值 */
function countUp(root) {
  const els = $$('[data-count]', root);
  els.forEach((n, i) => {
    const to = +n.dataset.count || 0, delay = 300 + i * 130, dur = 420;
    n.textContent = '0';
    setTimeout(() => {
      const t0 = performance.now();
      const step = (now) => { const u = Math.min(1, (now - t0) / dur); n.textContent = String(Math.round(to * Ease.outCubic(u))); if (u < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step); Sound.sfx('rollTick', { ui: true, k: i / Math.max(1, els.length - 1), gap: 0 });
    }, delay);
    setTimeout(() => { n.textContent = String(to); }, delay + dur + 80);
  });
  $$('.rewards .reward', root).forEach((r, i) => { r.style.animation = `revealIn .45s ${(0.4 + els.length * 0.13 + i * 0.16).toFixed(2)}s both`; });
}
/* 失败复盘：只在被击落时出现（主动结束不显示），按这一局实际记下的受伤来源挑最常见的一类，给一条能照做的建议 */
function deathHtml(r) {
  if (r.win || r.abandoned || !r.hurt) return '';
  const top = Object.entries(r.hurt).sort((a, b) => b[1] - a[1] || (b[0] === r.lastHurt) - (a[0] === r.lastHurt))[0];
  if (!top || !HURT_TIPS[top[0]]) return '';
  const T = HURT_TIPS[top[0]], last = r.lastHurt && r.lastHurt !== top[0] && HURT_TIPS[r.lastHurt] ? ` · 最后一下是${HURT_TIPS[r.lastHurt].label}` : '';
  return `<div class="death"><span><b>这局主要被</b> ${esc(T.label)}击中 ${top[1]} 次${esc(last)}</span><span><b>下局试试</b> ${esc(T.tip)}</span></div>`;
}
function showCodex(tab, back) {
  const m = G.meta;
  const tabs = [['planes', '飞机'], ['gun', '主炮改造'], ['skills', '支援'], ['bmod', '大招改造'], ['syns', '联动'], ['map', '地图'], ['npcs', '伙伴'], ['enemies', '敌人']];
  let body = '';
  if (tab === 'planes') body = PLANE_ORDER.map((id) => { const P = PLANES[id], own = m.planes[id]; return `<div class="panel cx ${own ? '' : 'unknown'}"><canvas width="120" height="120" data-plane="${id}"></canvas><div><h3>${own ? P.name : '？？？'} ${rarityChip(P.rarity)}</h3><p>${own ? `大招「${P.burst.name}」${P.burst.desc}` : '招募或集齐碎片后解锁'}</p>${own ? `<p>被动「${P.passive.name}」${P.passive.desc} ${fxHtml(planeFx(P))}</p>` : ''}</div></div>`; }).join('');
  else if (tab === 'gun' || tab === 'skills') body = (tab === 'gun' ? GUN_ORDER : SUPPORT_ORDER).map((id) => { const S = SKILLS[id], seen = m.codex.skills[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi" style="color:${S.color}">${icon(S.icon).replace('class="ic"', `class="ic" style="fill:${S.color}"`)}</div><div><h3>${S.name}${tab === 'gun' ? ' · 主炮改造' : ' · 自动支援'}</h3>${S.lv.map((t, i) => `<p>Lv${i + 1} ${esc(t)} ${fxHtml(S.fx[i])}</p>`).join('')}</div></div>`; }).join('') + (tab === 'gun' ? '<div class="panel cx"><div class="cxi">' + icon('s-homing').replace('class="ic"', 'class="ic" style="fill:#6ff0ff"') + '</div><div><h3>开局主炮</h3><p>笔直向右单发，靠局内升级改造</p></div></div>' : '<div class="panel cx"><div class="cxi">' + icon('s-wing').replace('class="ic"', 'class="ic" style="fill:#fff3c8"') + '</div><div><h3>支援槽</h3><p>同时只带一个，选新的会换掉旧的</p></div></div>');
  else if (tab === 'bmod') body = BURST_MOD_ORDER.map((id) => { const B = BURST_MODS[id]; return `<div class="panel cx"><div class="cxi">${icon(B.icon).replace('class="ic"', `class="ic" style="fill:${B.color}"`)}</div><div><h3>${B.name}</h3>${B.lv.map((t, i) => `<p>Lv${i + 1} ${esc(t)} ${fxHtml(B.fx[i])}</p>`).join('')}</div></div>`; }).join('');
  else if (tab === 'syns') body = Object.entries(SYNERGIES).map(([k, v]) => { const [a, b] = v.need, seen = m.codex.syns[k]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><div class="cxi">${icon(SKILLS[a].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[a].color};width:40%;height:40%"`)}${icon(SKILLS[b].icon).replace('class="ic"', `class="ic" style="fill:${SKILLS[b].color};width:40%;height:40%"`)}</div><div><h3>${seen ? v.name : '？？？'} · ${v.stream}</h3><p>${SKILLS[a].name} + ${SKILLS[b].name}</p><p>${seen ? `${esc(v.desc)} ${fxHtml(v.fx)}` : '选到一次后记录'}</p></div></div>`; }).join('');
  else if (tab === 'map') body = MAP_OBJ_ORDER.map((k) => { const O = MAP_OBJECTS[k], seen = m.codex.map[k]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="160" height="160" data-map="${k}"></canvas><div><h3>${O.verb} · ${O.name}</h3><p>${O.desc}</p></div></div>`; }).join('') + PLANE_ORDER.map((id) => `<div class="panel cx"><canvas width="120" height="120" data-plane="${id}"></canvas><div><h3>${PLANES[id].name} · 专属地图反应</h3><p>${PLANE_MAP_REACT[id]}</p></div></div>`).join('');
  else if (tab === 'npcs') body = NPC_ORDER.map((id) => { const N = NPCS[id], seen = m.codex.npcs[id]; return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="120" height="120" data-npc="${id}" data-mood="${seen ? 'happy' : 'sleep'}"></canvas><div><h3>${N.name}</h3><p>${seen ? N.effect : '还没救出来：把救援吊舱送到修理点'}</p></div></div>`; }).join('');
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
        <tr><th>出击次数</th><td class="num">${R.runs}</td></tr><tr><th>通关次数</th><td class="num">${R.clears}</td></tr><tr><th>驾驶员等级</th><td class="num">${m.pilot ? m.pilot.lv : 1}</td></tr><tr><th>打通的地图</th><td class="num">${Object.keys((m.maps && m.maps.cleared) || {}).length}/${MAP_ORDER.length}</td></tr>
        <tr><th>最高连杀</th><td class="num">${R.bestStreak}</td></tr><tr><th>最快通关</th><td class="num">${R.bestTime ? fmtTime(R.bestTime) : '—'}</td></tr>
        <tr><th>单局最多升级选择</th><td class="num">${R.bestCrystals}</td></tr><tr><th>暗金图鉴</th><td class="num">${Object.keys((m.codexGear && m.codexGear.uniques) || {}).length}/${UNIQUE_ORDER.length}</td></tr>
        <tr><th>拥有飞机</th><td class="num">${Object.keys(m.planes).length}/${PLANE_ORDER.length}</td></tr>
        <tr><th>地图互动</th><td class="num">${m.stats.interacts || 0}</td></tr>
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
  // 点已经选中的那一项：原地闪一下（不然按了什么都没变）
  $$('[data-seg]', el).forEach((b) => b.onclick = () => { if (b.classList.contains('on')) { Sound.sfx('ui'); pulse(b); return; } s[b.dataset.seg] = b.dataset.v; Sound.sfx('ui'); save(); if (G.world) G.world.low = s.particles === 'low'; showSettings(back); });
  $$('[data-segn]', el).forEach((b) => b.onclick = () => { if (b.classList.contains('on')) { Sound.sfx('ui'); pulse(b); return; } const k = b.dataset.segn; s[k] = +b.dataset.v; if (k === 'flash') s.reduceFlash = s.flash < 0.5; Sound.sfx('ui'); save(); if (k === 'rumble' && s.rumble > 0) { Input.rumble(0.6 * s.rumble, 0.6 * s.rumble, 120); Input.flushRumble(1); } showSettings(back); });
  $$('[data-tog]', el).forEach((b) => b.onclick = () => { const k = b.dataset.tog; s[k] = !s[k]; b.classList.toggle('on', s[k]); b.setAttribute('aria-checked', s[k]); Sound.sfx('ui'); save(); });
  $('#set-drag', el).oninput = (e) => { s.dragSens = +e.target.value; save(); };
  $('#set-music', el).oninput = (e) => { s.music = +e.target.value; save(); };
  $('#set-sfx', el).oninput = (e) => { s.sfx = +e.target.value; save(); Sound.sfx('ui', { gap: 120 }); };
  $$('[data-bind]', el).forEach((b) => b.onclick = () => { b.classList.add('wait'); b.textContent = '按下新键…'; Input.startRebind(b.dataset.bind, (bs) => { s.binds = JSON.parse(JSON.stringify(bs)); save(); showSettings(back); }); });
  $('#set-resetkeys', el).onclick = () => { s.binds = null; save(); Sound.sfx('ui'); showSettings(back); toast('按键已恢复默认', '#9ff2c8'); };
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
  for (const id of GUN_ORDER) if (b.gun[id]) rows.push(skillAbil(id, b.gun[id], '主炮'));
  if (b.support) rows.push(skillAbil(b.support.id, b.support.lv, '支援'));
  if (b.bmod) rows.push(modAbil(b.bmod.id, b.bmod.lv));
  for (const k of b.links) rows.push(linkAbil(k));
  for (const c of w.companions) rows.push(abilityHtml({ icon: 'i-heart', color: NPCS[c.id].color, name: NPCS[c.id].name, tag: '伙伴', line: NPCS[c.id].effect }));
  const adv = planHtml(buildPlan(b, w.targetName), true);
  // 货舱清单（§7）：出发前、暂停时都看得懂死了会丢什么
  const cargo = (w.me && w.me.cargo) || [], ins = FACILITIES.insure.lv[clamp(((G.meta.fac || {}).insure || 1) - 1, 0, 3)];
  const cargoHtml = w.lootOn() ? `<div class="panel cargo-list" style="width:100%"><div class="label">货舱 · ${cargo.length} 件 <small class="dim-text">✓ 已送回家的不会丢 · 这一关捡的：死了套装和暗金必带回，保险舱再保最好的 ${ins} 件</small></div>
    <div class="cl-items">${cargo.map((it) => `<span class="cl-it${it.safe ? ' safe' : ''}" style="color:${QUALS[it.q].color}">${esc(Gear.name(it))}</span>`).join('') || '<span class="dim-text">还没捡到装备</span>'}</div></div>` : '';
  $('#banner').innerHTML = ''; $('#toast').innerHTML = ''; banner._until = 0; // 暂停时收起横幅和轻提示，不压住菜单
  const el = showScreen('pause', `
    <div class="center-col" style="max-width:calc(860px*var(--u))">
      <div class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">暂停 <span class="dim-text" style="font-size:var(--fs-s)">${G.mpRun ? '联机战斗不会停，你的飞机原地不动 · 想看规则按 H，能边飞边看' : '战斗已冻结'}</span></div>
      <div class="panel build-list" style="width:100%"><div class="label">当前构筑 ${w.stream ? `· ${w.stream.name}` : ''}</div>${rows.join('') || '<span class="dim-text">还没选到升级</span>'}
        <div class="advice">${adv}</div></div>
      ${cargoHtml}
      <div class="row wrap" style="justify-content:center">
        <button class="btn primary" id="p-resume" type="button" autofocus>${icon('i-play')} 继续</button>
        <button class="btn" id="p-help" type="button">${icon('i-book')} 操作说明</button>
        <button class="btn" id="p-settings" type="button">${icon('i-gear')} 设置</button>
        <button class="btn" id="p-codex" type="button">${icon('i-book')} 图鉴</button>
        <button class="btn coral" id="p-quit" type="button">${G.mpRun ? '退出联机' : '结束本局'}</button>
      </div>
      <span class="dim-text" style="font-size:var(--fs-xs)">${w.vs ? '现在退出：已经拿到的成果照常保留，之后的不再算' : '现在结束：和半路倒下一样结算（信用点、材料、经验全带回）'}</span>
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
    ['移动', pad ? '左摇杆 / 十字键' : 'WASD / 方向键 / 按住鼠标拖动，Shift 慢速'],
    ['射击', '自动开火，子弹笔直向右：对准敌人'],
    ['主目标', '屏幕上方一次只写一个目标'],
    ['升级', '碰到装置后二选一：飞进圆圈停一下就选上'],
    ['地图装置', '装置旁会写下一步怎么做'],
    ['厚甲怪', '先敲碎正面的甲，再打软核心'],
    ['大招', `充满后按 ${key} 释放，右下角会亮`],
    ['来敌方向', '后方、上下、裂缝都会来敌，先有预警'],
    ['受击', '只有飞机中间的小白点会被打中'],
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
      <div class="hearts fly fl" data-fly="hearts" id="h-hearts" aria-label="生命"></div>
      ${w.np > 1 ? `<div class="team fly fl" data-fly="team" id="h-team" aria-label="${w.vs ? '对手' : '队友'}"></div>` : ''}
      <div class="row fly fl" data-fly="cur"><span class="cur" title="本局星砂：结算时每 10 星砂折 1 信用点">${icon('i-dust').replace('class="ic"', 'class="ic" style="fill:#dcc8ff"')}<small class="curname">星砂</small><span class="num" id="h-dust">0</span></span><span class="cur" title="废料：装置里蹦出来的零件，两个折一份；回家升级设施、用改造台">${icon('i-scrap').replace('class="ic"', 'class="ic" style="fill:#e8b48a"')}<small class="curname">废料</small><span class="num" id="h-wood">0</span></span><span class="stream-badge" id="h-stream"></span></div>
      <div class="hgoal fly fl" data-fly="hgoal" id="h-hgoal" hidden></div>
      <div class="slots fly fl" data-fly="slots" id="h-slots">
        <div class="slot gunslot" title="主炮改造链"><svg class="ic"><use href="#s-pierce"/></svg><b class="sl">主炮</b><div class="marks"></div></div>
        <div class="slot" title="自动支援"><svg class="ic"><use href="#s-thunder"/></svg><div class="lv"><i></i><i></i><i></i></div><b class="sl">支援</b></div>
        <div class="slot" title="大招改造"><svg class="ic"><use href="#s-bomb"/></svg><div class="lv"><i></i><i></i></div><b class="sl">大招</b></div>
      </div>
      <div class="syns fly fl" data-fly="syns" id="h-syns"></div>
      <div class="comps fly fl" data-fly="comps" id="h-comps"></div>
    </div>
    <div class="hud-tc goal fly ft" data-fly="goal" id="h-tc"><div class="goal-main" id="h-gm"><canvas width="96" height="96" id="h-gport"></canvas><div class="goal-txt"><div class="goal-t" id="h-gt"></div><div class="goal-p" id="h-gp"></div></div><span class="goal-step" id="h-gs"></span></div><div class="goal-opt" id="h-go" hidden></div></div>
    <div class="bossbar fly ft" data-fly="boss" id="h-boss" hidden><div class="bname"><span id="h-bname">Boss</span><small id="h-bphase"></small></div><div class="bar boss" id="h-bbar"><i id="h-bf"></i><span id="h-bticks"></span><span class="shield" id="h-bs"></span></div></div>
    <div class="hud-tr fly fr" data-fly="pause"><button class="pause-btn hb" id="h-pause" type="button" aria-label="暂停">${icon('i-pause')}</button></div>
    <div class="streak fly fr" data-fly="streak" id="h-streak"><div class="n" id="h-sn">0</div><div class="t">连杀</div></div>
    <div class="bstate fly fr" data-fly="bstate" id="h-bstate"></div>
    <div class="cargo-card fly fr" data-fly="cargo" id="h-cargo" aria-label="货舱">${icon('i-stash')}<span class="cc-t"><b>货舱</b><span class="cc-n" id="h-cn">0</span><i class="cc-best" id="h-cb"></i></span><small class="cc-last" id="h-cl"></small></div>
    <button class="burst-btn hb fly fr" data-fly="burst" id="h-burst" type="button" aria-label="爆发：${PLANES[w.planeId].burst.name}"><div class="face"><canvas width="160" height="160" data-plane="${w.planeId}"></canvas></div><span class="stock" id="h-stock">0/1</span><span class="k kbd" id="h-bk"></span></button>
    <div class="hint-box fly fb" data-fly="hint" id="h-hint"></div>`;
  hud.hidden = false;
  paintPlaneCanvases(hud);
  $('#h-pause').onclick = () => pauseGame();
  $('#h-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
  const bb = $('#h-burst');
  bb.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Input.press('burst'); });
  G.hudRefs = { hearts: $('#h-hearts'), dust: $('#h-dust'), stream: $('#h-stream'), slots: $$('#h-slots .slot'), marks: $('#h-slots .marks'), syns: $('#h-syns'), comps: $('#h-comps'), tc: $('#h-tc'), gm: $('#h-gm'), gport: $('#h-gport'), gt: $('#h-gt'), gp: $('#h-gp'), gs: $('#h-gs'), go: $('#h-go'), boss: $('#h-boss'), bname: $('#h-bname'), bphase: $('#h-bphase'), bbar: $('#h-bbar'), bf: $('#h-bf'), bticks: $('#h-bticks'), bs: $('#h-bs'), streak: $('#h-streak'), sn: $('#h-sn'), burst: bb, stock: $('#h-stock'), bk: $('#h-bk'), hint: $('#h-hint'), bstate: $('#h-bstate'), team: $('#h-team'), wood: $('#h-wood'), hgoal: $('#h-hgoal'), cn: $('#h-cn'), cb: $('#h-cb'), cl: $('#h-cl'), fly: {} };
  for (const f of $$('[data-fly]', hud)) G.hudRefs.fly[f.dataset.fly] = f;
  // 重建 HUD（暂停回来、换关）时保留已经钉住的块（比如受过伤以后的生命）
  for (const k in G.hudPin || {}) if (G.hudPin[k]) hudFly(k, Infinity);
  // 暂停键平时收着：鼠标移到右上角才出来（键盘 Esc、手柄 Start 一直能暂停）；触屏一直在
  if (Input.kind === 'touch') hudPin('pause', true);
  G.hudLast = {};
  updateHud(true);
  showHint();
}
/* ================================================== 战斗界面按需出现（lessons UT15，设计文档 §11.1）==================================================
   进战斗是空屏：只有飞机和世界。常驻的只留一直要看的（受过伤以后的生命、首领战的血条、充满的大招）；
   其余用时飞入、演完飞出（hudFly）；暂停时全部飞进来（#hud.all）。钉住的块记在 G.hudPin，重建 HUD 也不丢 */
// 飞入 sec 秒（按游戏时间算：暂停时停住，到点由 updateHud 里的 hudExpire 收回）；Infinity = 直到 hudOut
function hudFly(key, sec) {
  const R = G.hudRefs, el = R && R.fly[key]; if (!el) return;
  el.classList.add('in'); el._until = sec === Infinity ? Infinity : (G.world ? G.world.t : 0) + sec;
}
function hudExpire() {
  const R = G.hudRefs, w = G.world; if (!R || !w) return;
  for (const k in R.fly) { const el = R.fly[k]; if (el._until !== undefined && w.t > el._until && !(G.hudPin && G.hudPin[k])) { el._until = undefined; el.classList.remove('in'); } }
}
// 钉住 / 解钉：解钉只收回钉住过的块，不打断正在亮的临时飞入
function hudPin(key, on) {
  G.hudPin = G.hudPin || {}; on = !!on; if (!!G.hudPin[key] === on) return;
  G.hudPin[key] = on; const R = G.hudRefs, el = R && R.fly[key]; if (!el) return;
  el._until = undefined; el.classList.toggle('in', on);
}
// 暂停键平时收着：鼠标移到右上角时飞出来
window.addEventListener('pointermove', (e) => { if (!G.world || !G.hudRefs || G.paused || e.pointerType === 'touch') return; if (e.clientX > innerWidth - 260 && e.clientY < 170) hudFly('pause', 2.5); });
// 开局正在教移动：这时屏幕上只有飞机、世界和移动教学，别的都先不进来
const tutMoving = () => !!(G.world && G.world.hintStep === 0);
function hudOut(key) { const R = G.hudRefs, el = R && R.fly[key]; if (!el) return; if (G.hudPin) G.hudPin[key] = false; el._until = undefined; el.classList.remove('in'); }
/* 货舱小卡：捡到东西时飞进 2 秒（件数 + 这局最好那件的颜色 + 刚捡的那件）；暂停时和别的块一起常驻 */
function cargoCard(total, best, last, color, sec) {
  const R = G.hudRefs; if (!R || !R.cn) return;
  R.cn.textContent = String(total); if (best) { R.cb.style.background = QUALS[best].color; R.cb.title = QUALS[best].name; }
  R.cl.textContent = last; R.cl.style.color = color || '#fff'; hudFly('cargo', sec); pulse(R.fly.cargo);
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
  hudExpire();
  const offering = !!h.ritual;
  if (L.offering !== offering) { L.offering = offering; $('#stage').classList.toggle('offering', offering); } // 升级仪式时淡化横幅和轻提示
  const hk = `${h.hp}/${h.maxHp}`;
  // 生命：第一次受伤飞进来，之后一直在（要一直盯着）；没受过伤时回血只亮一下
  if (L.hp !== hk) { if (L.hp !== undefined) { if (h.hp < h.maxHp) hudPin('hearts', true); else hudFly('hearts', 2); } L.hp = hk; let s = ''; for (let i = 0; i < h.maxHp; i++) s += `<svg class="${i < h.hp ? '' : 'off'}" aria-hidden="true"><use href="#i-heart"/></svg>`; R.hearts.innerHTML = s; R.hearts.setAttribute('aria-label', `生命 ${h.hp}/${h.maxHp}`); }
  setText(R.dust, 'dust', String(h.dust));
  setText(R.wood, 'wood', String(Math.floor((h.wood || 0) / 2))); // 和结算同一个折法（station.js settle）
  if (L.hg !== h.homeGoal) { L.hg = h.homeGoal; R.hgoal.hidden = !h.homeGoal; R.hgoal.textContent = h.homeGoal || ''; } // HUD 只追踪家园的当前目标
  if (R.team && h.team) { // 联机：队友状态（生命 / 倒下倒计时 / 已离开）
    const tk = h.team.map((q) => `${q.hp}/${q.maxHp}/${q.alive}/${q.down}/${q.gone}/${q.away}/${q.seat}`).join('|');
    if (L.team !== tk) { L.team = tk; hudPin('team', h.team.some((q) => !q.me && (!q.alive || q.gone || q.away))); R.team.innerHTML = h.team.filter((q) => !q.me).map((q) => `<div class="${q.gone ? 'gone' : !q.alive ? 'down' : ''}"><i style="background:${q.color}"></i><b>${esc(q.name)}</b>${q.gone ? (h.vs ? '已退出' : '已离开') : q.away ? `断线中 · ${q.seat} 秒` : !q.alive ? (h.vs ? '被击毁 · 复归中' : '倒下 · 飞进圈里救') : `<span class="hp">${'♥'.repeat(Math.max(0, q.hp))}</span>`}</div>`).join(''); }
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
  if (L.comp !== ck) { if (L.comp !== undefined && ck) hudFly('comps', 3); L.comp = ck; R.comps.innerHTML = (h.companions || []).map((id) => `<canvas width="64" height="64" data-npc="${id}" title="${NPCS[id].name}：${NPCS[id].effect}"></canvas>`).join(''); paintPlaneCanvases(R.comps); }
  if (h.boss) {
    // 首领战：血条飞进来钉住，目标卡收起（暂停时也不出现）；先去掉 hidden、强制排版一次，飞入动画才放得出来
    if (L.bossOn !== true) { L.bossOn = true; R.boss.hidden = false; void R.boss.offsetWidth; hudPin('boss', true); hudOut('goal'); R.tc.hidden = true; R.bname.textContent = h.boss.name; R.bticks.innerHTML = (h.boss.ticks || [70, 35]).map((x) => `<span class="tick" style="left:${x}%"></span>`).join(''); }
    const B = w.boss, BB = w.bossBudget(), f = B ? B.fightT || 0 : 0, on = B && !w.vs && !BB.free && w.bossIntroT <= 0; // 构筑考验：失控、超载倒计时
    const toRage = Math.ceil(BB.at - f), toWipe = Math.ceil(BB.T - f);
    setText(R.bname, 'bnm', h.boss.name + (h.boss.def ? (h.boss.def === 'armor' ? ' · 装甲' : ' · 护盾') : ''));
    setText(R.bphase, 'bph', h.boss.phaseName + (h.boss.weak ? ' · 弱点暴露' : '') + (!on ? '' : toRage > 0 ? (toRage <= 15 ? ` · ${toRage} 秒后失控` : '') : toWipe > 0 ? ` · 失控中 · ${toWipe} 秒后超载` : ' · 超载'));
    // 血条：入场蓄势时是空的，落地那一刻从空涨满（FP10）
    const intro = w.bossIntroT > 0, bw = intro ? '0%' : `${(h.boss.hp / h.boss.maxHp) * 100}%`;
    if (L.bw !== bw) { if (!intro && L.bw === '0%' && !L.bossFill) { L.bossFill = true; R.bf.style.transition = 'width 1s cubic-bezier(.2,.8,.2,1)'; setTimeout(() => { R.bf.style.transition = ''; }, 1100); } L.bw = bw; R.bf.style.width = bw; }
    const sw = h.boss.shield > 0 ? `${(h.boss.shield / h.boss.shieldMax) * 100}%` : '0%'; if (L.sw !== sw) { L.sw = sw; R.bs.style.width = sw; }
    const pc = 'bar boss p' + h.boss.phase + (B && B.rage > 0 ? ' rage' : B && B.regenAt !== undefined && w.t - B.regenAt < 0.4 ? ' regen' : ''); if (L.bcls !== pc) { L.bcls = pc; R.bbar.className = pc; }
  } else {
    if (L.bossOn !== false) { L.bossOn = false; hudPin('boss', false); R.boss.hidden = true; R.tc.hidden = false; L.bossFill = false; }
    updateGoalCard(h.goal, R, L);
  }
  const sn = h.streak;
  if (L.sn !== sn) {
    // 连杀：只在 10、30、50、100…这些里程碑飞进来亮一下
    const show = sn >= 5, mile = sn === 10 || sn === 30 || (sn >= 50 && sn % 50 === 0);
    if (mile) hudFly('streak', 1.6);
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
  // 大招：有库存时一直在（随时要按），用完收起；没充满时按大招键，它飞进来给你看还差多少（burstEmpty）
  hudPin('burst', h.stock >= 1 && !h.down);
  // 升级仪式：技能槽和联动飞进来接住新图标，选完再停一会儿让人看清
  if (L.ritualFly !== offering) { const was = L.ritualFly; L.ritualFly = offering; hudPin('slots', offering); hudPin('syns', offering); if (was && !offering) { hudFly('slots', 1.8); hudFly('syns', 1.8); } }
  setText(R.stock, 'stock', `${h.stock}/${h.cap}`);
  const bs = h.down ? (h.vs ? `被击毁 · ${h.respawn} 秒后在自己航道复归` : `倒下了 · 等队友飞进圈里救${h.save > 0 ? ` ${Math.round(h.save * 100)}%` : ''}`) : h.stock >= h.cap ? `可释放 · 已存满 ${h.stock}/${h.cap}` : h.stock > 0 ? `可释放 · 还能再存 ${h.cap - h.stock} 次` : `大招充能 ${p}%`;
  if (L.bs !== bs) { L.bs = bs; R.bstate.textContent = bs; R.bstate.classList.toggle('ready', h.stock > 0); }
  const key = Input.hintFor('burst');
  if (L.bk !== key) { L.bk = key; R.bk.textContent = key; R.bk.hidden = !key; }
}
/* 主目标卡：一次一个目标 + 头像 + 进度（数量 / 厚甲裂纹 / 血量）+ 最多一个可选地图目标 */
function updateGoalCard(G, R, L) {
  if (!G) { if (L.gOn !== false) { L.gOn = false; hudOut('goal'); } return; }
  if (L.gOn !== true) { L.gOn = true; }
  if (L.gport !== G.portrait) { L.gport = G.portrait; paintPortrait(R.gport, G.portrait); }
  setText(R.gt, 'gt', G.title);
  setText(R.gs, 'gs', `目标 ${Math.min(G.step, G.steps)}/${G.steps}`); // 这一关的第几个目标（评审：只写 1/7 看不懂）
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
  // 换了新目标：目标卡飞进来亮 4 秒（玩家始终知道当前目标，lessons DE15）；暂停时也在
  if (L.gtitleFlash !== G.title) { L.gtitleFlash = G.title; R.tc.classList.remove('flash'); void R.tc.offsetWidth; R.tc.classList.add('flash'); if (!tutMoving()) hudFly('goal', 4); }
}
// 开局教学（只教移动）学会了：记下，之后不再教
function endTutorial() { G.tutorial = { on: false }; G.meta.tutorialDone = true; persist(); }
function drainWorldEvents() {
  const w = G.world; if (!w) return;
  if (w.done) { w.events.length = 0; return; }
  while (w.events.length) {
    const e = w.events.shift();
    switch (e.type) {
      case 'slotLand': slotLand(e); break;
      case 'goal': break; // 顶栏目标卡换标题时自己会闪一下，不再另弹文字条
      case 'goalDone': goalDoneFx(e); break; // 顶栏卡片打勾 + 星尘飘出来
      case 'goalNext': break; // 不再预告“下一个”：换目标时目标卡自己飞进来（一次只说一件事）
      case 'burstDemo': G.hintId = null; showHint(); hudFly('burst', 10); banner(`放一次大招：按 ${Input.device === 'pad' ? 'A' : Input.keyLabel(Input.binds.burst[0])}`, `「${e.name}」· 敌弹已经清空，前面一排是给你试的`, 9, 'rgba(255,215,106,.85)', 5); break;
      case 'burstDemoEnd': banner._until = 0; $('#banner').innerHTML = ''; break; // 教学结束：提示收回到大招按钮（按钮继续发光）
      case 'backlog': toast('敌人有点多：先清前面的，下一批会晚一点来', '#ffb2a8', null, 2400); break;
      case 'stream': hudFly('syns', 3); banner(`${e.name} 成型！`, '这一局的 Build 有名字了', 2, 'rgba(255,215,106,.9)', 3); break; // 一局一次的大时刻：横幅，不是小提示
      case 'streak': if (e.n >= 100 && !(G.streakToastAt > performance.now() - 20000)) { G.streakToastAt = performance.now(); toast(`${e.n} 连杀！金色强化出现`, '#ffd76a', null, 1600); } break; // 连杀常有（鱼群潮）：只提 100 连杀，20 秒内不重复；数字右侧一直显示
      case 'elite': toast(e.elite === 'cmdr' ? '带队精英出现 · 等它举旗再打旗头水晶' : '精英出现 · 击败它能充不少大招', '#ff9d8c', 'n-crown'); Sound.setBoost('tension', 0.3); setTimeout(() => Sound.setBoost('tension', 0), 12000); break;
      case 'boss': Sound.sfx('alarm'); break; // 入场蓄势：警报，名牌等它落地再出
      case 'raceFoe': banner(e.name, e.hint, 2.4, hexA(e.color, 0.8), 3); break; // 七族招牌敌人第一次出现：一句怎么对付（§9.3）
      case 'relay': G.relayPending = true; break; // 混沌祭司倒下：这一局结算前放结局
      case 'thief': toast('收账小偷！追上打倒它 · 钱袋里有装备', '#d9b8ff', null, 2600); break; // §9.3：一关一次的事，不占屏幕中间
      case 'thiefGone': toast('它带着钱袋跑了……', '#d9b8ff', null, 1800); break;
      // 地图第一次出手：讲一句怎么看先兆、怎么反制；正在教地图交互时先排队，教完再讲（一次只教一件事）
      case 'lurkTeach': if (G.mapHint) G.lurkQ = e; else { banner(e.name, e.hint, 2.6, hexA(e.color, 0.75), 3); G.lurkOn = { e, until: w.t + 2.6 }; } break;
      case 'bossLand': { const S = w.stage, B = w.boss, defT = B && B.chaosDef ? '护盾 ↔ 装甲' : B && B.def === 'armor' ? '装甲 · 动能伤害打它更疼' : B && B.def === 'shield' ? '护盾 · 能量伤害打它更疼' : ''; banner(S.bossName, w.stageId === '5-3' ? `第一段 · 布道 · ${defT}` : B && B.introSub ? `${B.introSub} · ${defT}` : S.boss === 'clock' ? `第一乐章 · 指针卡住 · ${defT}` : `先打碎正面三块护甲 · ${defT}`, 2, 'rgba(255,90,110,.7)', 4); Sound.setMode('boss1'); break; }
      case 'bossResponse': banner(e.title, e.sub, 1.6, 'rgba(255,215,106,.8)', 3); break;
      case 'phase': banner(e.name, e.captain ? '攻击更密，还带着散兵' : e.n === 2 ? '攻击越来越快，安全区在缩小' : '弹幕会逆行，消失的弹幕会重演', 1.8, null, 3); break;
      case 'flag': banner('', e.text, e.dur || 1, null, 1); break;
      case 'burstEmpty': if (G.hudRefs) { hudFly('burst', 1.6); pulse(G.hudRefs.burst); } break;
      case 'cargoShip': banner('货舱送回家了', `${e.total} 件装备安全了 · 死了也不会丢`, 2.2, 'rgba(255,190,120,.85)', 4); Sound.sfx('cargoShip'); cargoCard(e.total, null, '✓ 已送回家', '#ffd27a', 2.4); break;
      case 'loot': cargoCard(e.total, e.best, `+1 · ${e.name}`, QUALS[e.q].color, 2.2); break; // 右下角货舱小卡（§6.8）：件数、这局最好那件的颜色、刚捡的这件
      case 'stageAdvance':
        // 连成一局：首领倒下后原地进下一关，换天色和音乐，构筑留着
        G.sea.setTheme(STAGES[e.id].theme || 'bay'); Sound.setMode('combat'); G.hudLast = {};
        banner(`第 ${e.n} 关 · ${e.name}`, `构筑带着走 · 回了两颗心${e.n === STAGE_ORDER.length ? ' · 最后一关' : ''}`, 2.2, 'rgba(255,215,106,.8)', 4); break;
      case 'burstReady':
        if (e.idx !== undefined && e.idx !== w.meIdx) break; // 队友的大招充满不提示
        // 大招键自己会飞进来发光（updateHud 里钉住），这里只让它闪一下，不再弹文字
        hudFly('burst', Infinity); if (G.hudRefs) pulse(G.hudRefs.burst);
        break;
      case 'gold': if (!G.goldSeen) { G.goldSeen = true; banner('金色强化！', `100 连杀的奖励 · ${e.full ? '大招已存满，改给星砂 +60' : '大招 +1 次'} · 射速提高`, 1.6, 'rgba(255,215,106,.9)'); } break; // 第一次给横幅讲清楚；之后只有飞机旁的字和金光
      case 'hint': {
        // 学会移动：教学收起，第一个目标飞进来（玩家始终知道当前目标）
        const was = G.hintId; G.hintId = e.id; showHint();
        if (was === 'move' && e.id !== 'move') { if (G.tutorial && G.tutorial.on) endTutorial(); hudFly('goal', 4); }
        break;
      }
      case 'maphint':
        // 地图交互开始教时，刚讲到一半的“地图出手”收起来排到后面；教完再讲
        if (e.kind && G.lurkOn && w.t < G.lurkOn.until) { G.lurkQ = G.lurkOn.e; G.lurkOn = null; banner._until = 0; $('#banner').innerHTML = ''; }
        G.mapHint = e.kind; showHint();
        if (!e.kind && G.lurkQ) { const q = G.lurkQ; G.lurkQ = null; banner(q.name, q.hint, 2.6, hexA(q.color, 0.75), 3); G.lurkOn = { e: q, until: w.t + 2.6 }; }
        break;
      case 'mapDone': break; // 物件自己的变化和升级仪式就是反馈，不再叠文字条
    }
  }
}
/* 仪式图标落进槽位：目标槽高亮、弹一下、显示等级；替换支援时旧图标先退出 */
function slotLand(e) {
  const R = G.hudRefs; if (!R) return;
  updateHud();
  const el = e.slot === 'gun' ? R.slots[0] : e.slot === 'support' ? R.slots[1] : e.slot === 'bmod' ? R.slots[2] : e.slot === 'link' ? R.syns : R.burst;
  hudFly(e.slot === 'link' ? 'syns' : e.slot === 'gun' || e.slot === 'support' || e.slot === 'bmod' ? 'slots' : 'burst', 1.8); // 图标落位时那一栏在场
  if (el) {
    el.classList.remove('land', 'swap'); void el.offsetWidth; el.classList.add(e.replace ? 'swap' : 'land'); setTimeout(() => el.classList.remove('land', 'swap'), 900);
    const b = document.createElement('span'); b.className = 'slotburst'; b.style.setProperty('--sc', e.color || '#ffe38a'); el.appendChild(b); setTimeout(() => b.remove(), 800); // 落位：一圈光往外扩
    if (e.lv) { const l = document.createElement('span'); l.className = 'slotlv'; l.textContent = String(e.lv).replace('Lv', 'Lv '); el.appendChild(l); setTimeout(() => l.remove(), 1200); }
  }
}
/* 目标完成：顶栏卡片打勾、闪一圈绿光，入账的星尘从卡片下面飘出来（不在战场中间叠字） */
function goalDoneFx(e) {
  const R = G.hudRefs; if (!R) return;
  hudFly('goal', 2.4); // 完成的那一刻目标卡飞进来打勾，再收起
  R.tc.classList.remove('done'); void R.tc.offsetWidth; R.tc.classList.add('done');
  clearTimeout(goalDoneFx.t); goalDoneFx.t = setTimeout(() => R.tc.classList.remove('done'), 1300);
  if (e.pay) { const s = document.createElement('span'); s.className = 'gpay'; s.textContent = `+${e.pay} 信用点`; R.gm.appendChild(s); setTimeout(() => s.remove(), 1400); }
}
/* 开局只教移动（lessons UT15）：按玩家手上的设备给一段动画——键盘是 WASD 按键、鼠标是按住拖动、手柄是摇杆、触屏是手指拖动 */
function moveTutHtml() {
  const k = Input.kind;
  const pic = k === 'pad' ? '<span class="tm-pic tm-pad"><i class="stick"><b></b></i></span>'
    : k === 'key' ? '<span class="tm-pic tm-keys"><i class="kc kw">W</i><i class="kc ka">A</i><i class="kc ks">S</i><i class="kc kd">D</i></span>'
    : `<span class="tm-pic tm-drag ${k === 'touch' ? 'touch' : ''}"><i class="pl"></i><i class="ptr"></i></span>`;
  const line = k === 'pad' ? '左摇杆移动飞机' : k === 'key' ? 'WASD 或方向键移动飞机' : k === 'touch' ? '按住屏幕拖动飞机' : '按住鼠标拖动飞机';
  const sub = k === 'pad' ? '自动开火 · Start 暂停' : k === 'key' ? '自动开火 · Esc 暂停' : k === 'touch' ? '自动开火 · 右上角暂停' : '自动开火 · 鼠标移到右上角可以暂停';
  return `${pic}<span class="tm-txt">${line}<small>${sub}</small></span>`;
}
/* 底部提示：开局的移动教学、地图交互第一次出现（去哪看战场里的箭头和光圈，碰到会怎样看这句话）、第一次选升级、第一次放大招 */
function showHint() {
  const R = G.hudRefs; if (!R) return;
  const put = (html, move) => { R.hint.classList.toggle('tut-move', !!move); R.hint.innerHTML = html; hudFly('hint', Infinity); };
  if (G.mapHint && MAP_OBJECTS[G.mapHint]) { const H = MAP_OBJECTS[G.mapHint].hint; put(`${esc(H[0])}<small>${esc(H[1])}</small>`); return; }
  const id = G.hintId;
  if (!id) { hudOut('hint'); return; }
  if (id === 'move') { put(moveTutHtml(), true); return; }
  const d = Input.device;
  const T = {
    offer: ['飞进一个方案，停一下就选好了', '选的时候不会受伤，选完图标飞进技能栏'],
    burst: [d === 'touch' ? '点右下角头像（或双击屏幕）释放专属大招' : d === 'pad' ? '按 A 释放专属大招' : `按 ${Input.hintFor('burst')} 释放专属大招`, `${PLANES[G.world.planeId].burst.name}：${PLANES[G.world.planeId].burst.desc}`],
  }[id];
  if (!T) { hudOut('hint'); return; }
  put(`${esc(T[0])}<small>${esc(T[1])}</small>`);
  if (id === 'burst') hudFly('burst', 8);
}
