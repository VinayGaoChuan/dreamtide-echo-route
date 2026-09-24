'use strict';
/* 梦潮回声航线 — flow (TITLE → HUB → LOADOUT → ROUTE_MAP → ROOM → RESULT → CARD → … → BOSS → CHAPTER_RESULT),
   screens, HUD and touch controls. The canvas draws the world; the DOM carries every menu and readout. */

const G = {
  meta: null, run: null, world: null, screen: null, bg: 'sea', back: null,
  W: 1280, scale: 1, dpr: 1, sea: null, hub: null, map: null,
  paused: false, demo: null, anims: [], cap: { sample: null, downloads: null },
  hudRefs: null, hudLast: {}, touchBound: false, tipT: 0, tutSkip: false, lastEnd: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------------------------------------------------------- persistence ---------------------------------------------------------------- */
function persist() { G.meta.run = G.run || null; Store.save(G.meta); }
function isAssisted(s) { return s.difficulty === 'easy' || s.bulletSlow || s.simpleWarn; }
function applySettings() {
  const s = G.meta.settings;
  Sound.configure(s);
  Input.setBinds(s.binds);
  const tb = Math.max(G.scale, 0.62) * (s.bigButtons ? 1.3 : 1);
  document.documentElement.style.setProperty('--tb', tb.toFixed(3));
}

/* ---------------------------------------------------------------- screen plumbing ---------------------------------------------------------------- */
function showScreen(id, html, o = {}) {
  const host = $('#screens');
  host.innerHTML = `<div class="screen ${o.cls || ''}" id="scr-${id}" role="region" aria-label="${esc(o.label || id)}">${html}</div>`;
  G.screen = id; G.back = o.back || null; if (o.bg) G.bg = o.bg;
  G.anims = [];
  const el = host.firstElementChild;
  $$('[data-back]', el).forEach((b) => b.addEventListener('click', () => { Sound.sfx('uiBack'); if (G.back) G.back(); }));
  if (Input.keyboardNav) { const f = $('[autofocus]', el) || $('.btn.primary', el); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30); }
  return el;
}
function clearScreens() { $('#screens').innerHTML = ''; G.screen = null; G.back = null; G.anims = []; }
function backBtn() { return `<button class="btn back-btn" data-back type="button" aria-label="返回">${icon('i-back')} 返回</button>`; }
function banner(title, sub, dur = 1.6) {
  const b = $('#banner');
  b.classList.remove('out');
  b.innerHTML = `${title ? `<div class="bt">${esc(title)}</div>` : ''}${sub ? `<div class="bs">${esc(sub)}</div>` : ''}`;
  clearTimeout(banner._t); clearTimeout(banner._t2);
  banner._t = setTimeout(() => { b.classList.add('out'); banner._t2 = setTimeout(() => { b.innerHTML = ''; b.classList.remove('out'); }, 360); }, dur * 1000);
}
function toast(text, ms = 2200) {
  const t = $('#toast'), d = document.createElement('div'); d.textContent = text; t.appendChild(d);
  setTimeout(() => d.remove(), ms);
  while (t.children.length > 3) t.firstElementChild.remove();
}
function pips(n, cls = '') { let h = `<span class="pips ${cls}">`; for (let i = 0; i < 5; i++) h += `<i class="${i < n ? 'on' : ''}"></i>`; return h + '</span>'; }
function stars(n) { return n <= 0 ? '无战斗' : '★'.repeat(n) + '☆'.repeat(3 - n); }

/* menu focus navigation for gamepad / arrow keys */
function navUpdate() {
  const scr = $('#screens .screen');
  const dirs = ['up', 'down', 'left', 'right'];
  for (const d of dirs) if (Input.consumeNav(d)) moveFocus(scr, d);
  if (Input.consumeNav('ok')) { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && !a.disabled && scr && scr.contains(a)) a.click(); else if (G.screen === 'title') startFromTitle(); }
  if (Input.consumeNav('back') && G.back) { Sound.sfx('uiBack'); G.back(); }
}
function moveFocus(scr, dir) {
  if (!scr) return;
  const items = $$('button:not([disabled]), [tabindex="0"]', scr).filter((b) => b.offsetParent !== null);
  if (!items.length) return;
  const cur = document.activeElement;
  if (!cur || !scr.contains(cur)) { items[0].focus(); return; }
  const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bestS = 1e9;
  for (const b of items) {
    if (b === cur) continue;
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
    const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
    if (!ok) continue;
    const s = dir === 'up' || dir === 'down' ? Math.abs(dy) + Math.abs(dx) * 2.2 : Math.abs(dx) + Math.abs(dy) * 2.2;
    if (s < bestS) { bestS = s; best = b; }
  }
  if (best) { best.focus(); Sound.sfx('ui', { gap: 60 }); }
}

/* ---------------------------------------------------------------- TITLE ---------------------------------------------------------------- */
function showTitle() {
  Sound.setMode('title');
  const first = !G.meta.seenTitle;
  const el = showScreen('title', `
    <div class="corner-tr"><button class="icon-btn" id="t-sound" type="button" aria-label="声音开关">${icon(G.meta.settings.muted ? 'i-mute' : 'i-sound')}<span>${G.meta.settings.muted ? '静音' : '声音'}</span></button></div>
    <div class="title-block">
      <h1 class="title-main">梦<em>潮</em></h1>
      <p class="title-sub">回声航线</p>
      ${first ? '<p class="title-tag">把敌人的弹幕弹回去，编成自己的梦境音乐。</p>' : '<p class="title-tag">梦灯还亮着。欢迎回来。</p>'}
      <p class="title-start">点击任意处开始</p>
    </div>
    <p class="title-foot">键鼠 · 手柄 · 触屏 &nbsp;|&nbsp; 进度保存在这台设备的浏览器里</p>`, { bg: 'title', label: '标题' });
  el.addEventListener('click', (e) => { if (e.target.closest('#t-sound')) return; startFromTitle(); });
  $('#t-sound', el).addEventListener('click', () => {
    Sound.init(); G.meta.settings.muted = !G.meta.settings.muted; applySettings(); persist();
    $('#t-sound', el).innerHTML = `${icon(G.meta.settings.muted ? 'i-mute' : 'i-sound')}<span>${G.meta.settings.muted ? '静音' : '声音'}</span>`;
  });
}
function startFromTitle() {
  if (G.screen !== 'title') return;
  Sound.init(); Sound.sfx('select');
  Tele.log('title_start_click');
  G.meta.seenTitle = true; persist();
  showHub();
}

/* ---------------------------------------------------------------- HUB ---------------------------------------------------------------- */
function showHub() {
  Sound.setMode('hub'); G.world = null; Input.gameActive = false; hideHud();
  const m = G.meta, w = WEAPONS[m.loadout.weapon], p = PERFS[m.loadout.perf];
  const hasRun = !!G.run;
  const el = showScreen('hub', `
    <div class="hub-info panel">
      <div class="label">梦灯大厅 · 当前章节</div>
      <h2 class="h-display" style="font-size:var(--fs-l);color:var(--paper)">第一章 · 失眠之海</h2>
      <div class="hub-dust">${icon('i-dust')}<span class="num" id="hub-dust">${Math.floor(m.dust)}</span><span class="dim-text" style="font-size:var(--fs-xs)">梦尘储备</span></div>
      <div class="region-list">${REGIONS.map((r) => `<div class="region ${r.open ? 'on' : ''}"><i></i>${r.name}${r.open ? '' : ' · 尚未点亮'}</div>`).join('')}</div>
    </div>
    <div class="hub-side">
      <button class="icon-btn" id="hub-weapon" type="button">${icon(w.icon)}<span>选择武器</span></button>
      <button class="icon-btn" id="hub-perf" type="button">${icon(p.icon)}<span>梦境演奏</span></button>
      <button class="icon-btn" id="hub-codex" type="button">${icon('i-book')}<span>弹幕图鉴</span></button>
      <button class="icon-btn" id="hub-wcodex" type="button">${icon('w-blade')}<span>武器图鉴</span></button>
      <button class="icon-btn" id="hub-unlock" type="button">${icon('i-lock')}<span>解锁内容</span></button>
      <button class="icon-btn" id="hub-records" type="button">${icon('i-trophy')}<span>记录</span></button>
      <button class="icon-btn" id="hub-settings" type="button">${icon('i-gear')}<span>设置</span></button>
      <button class="icon-btn" id="hub-tut" type="button">${icon('i-lamp')}<span>重温教学</span></button>
    </div>
    ${hasRun ? `<div class="hub-cont"><button class="btn cyan" id="hub-continue" type="button">${icon('i-map')} 继续航线 · 第 ${(G.run.pos ? G.run.pos.col + 2 : 1)} 站</button><span class="dim-text" style="font-size:var(--fs-xs)">已保存到上一安全节点</span></div>` : ''}
    <div class="hub-start">
      <div class="hub-loadout">
        <span class="equip">${icon(w.icon)}${w.name}</span>
        <span class="equip">${icon(p.icon)}${p.name}</span>
        <span class="equip dim-text">${DIFFICULTY[m.settings.difficulty].name}难度</span>
      </div>
      <button class="btn primary big" id="hub-start" type="button" autofocus>${icon('i-lamp')} 开始航线</button>
      <span class="dim-text" id="hub-start-note" style="font-size:var(--fs-xs)">${hasRun ? '开始新航线会覆盖进行中的存档' : '先选武器与演奏，再出发'}</span>
    </div>`, { bg: 'hub', label: '梦灯大厅' });
  $('#hub-weapon', el).onclick = () => { Sound.sfx('ui'); showLoadout(1, showHub); };
  $('#hub-perf', el).onclick = () => { Sound.sfx('ui'); showLoadout(2, showHub); };
  $('#hub-codex', el).onclick = () => { Sound.sfx('ui'); showCodex('bullets', showHub); };
  $('#hub-wcodex', el).onclick = () => { Sound.sfx('ui'); showCodex('weapons', showHub); };
  $('#hub-unlock', el).onclick = () => { Sound.sfx('ui'); showUnlocks(showHub); };
  $('#hub-records', el).onclick = () => { Sound.sfx('ui'); showRecords(showHub); };
  $('#hub-settings', el).onclick = () => { Sound.sfx('ui'); showSettings(showHub); };
  $('#hub-tut', el).onclick = () => { Sound.sfx('ui'); startTutorial(true); };
  let armed = false;
  $('#hub-start', el).onclick = () => {
    if (hasRun && !armed) { armed = true; Sound.sfx('ui'); $('#hub-start', el).innerHTML = `${icon('i-lamp')} 确认：开始新航线`; $('#hub-start-note', el).textContent = '再按一次覆盖存档；或按右下角继续'; return; }
    Sound.sfx('select'); showLoadout(1, showHub);
  };
  if (hasRun) $('#hub-continue', el).onclick = () => { Sound.sfx('select'); applySettings(); Sound.setCardMods(G.run.cards.map((c) => c.id)); showMap(); };
}

/* ---------------------------------------------------------------- LOADOUT (武器 → 演奏 → 图鉴速览 → 启航) ---------------------------------------------------------------- */
function stepsBar(step) {
  const names = ['选择武器', '选择梦境演奏', '弹幕速览'];
  return `<div class="steps">${names.map((n, i) => `${i ? '<span class="step-sep"></span>' : ''}<span class="step ${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><b>${i + 1}</b>${n}</span>`).join('')}</div>`;
}
function weaponCard(w, sel) {
  const unlocked = G.meta.unlocked.weapons.includes(w.id);
  return `<button class="wcard ${sel ? 'sel' : ''} ${unlocked ? '' : 'locked'}" data-w="${w.id}" type="button" aria-pressed="${sel}">
    <div class="wtitle">${icon(w.icon)}${w.name}<span class="chip gold">${w.tag}</span></div>
    <div class="wtag">${w.line}</div>
    <div class="stat">射程${pips(w.rangeN)}</div>
    <div class="stat">攻速${pips(w.rateN)}</div>
    <div class="stat">切弹${pips(w.cutN)}</div>
    <div class="stat">上手难度${pips(w.diffN, 'coral')}</div>
    <div class="dim-text" style="font-size:var(--fs-xs)">推荐：${w.who}</div>
    ${unlocked ? '' : `<div class="lock-line">${icon('i-lock')}解锁条件：消耗 ${w.unlock.cost} 梦尘，或通关失眠之海</div>`}
  </button>`;
}
function perfCard(p, sel) {
  const unlocked = G.meta.unlocked.perfs.includes(p.id);
  return `<button class="wcard ${sel ? 'sel' : ''} ${unlocked ? '' : 'locked'}" data-p="${p.id}" type="button" aria-pressed="${sel}">
    <div class="wtitle">${icon(p.icon)}${p.name}<span class="chip cyan">${p.dur} 秒</span></div>
    <div class="eff pos" style="font-size:var(--fs-xs)">主效果：${p.main}</div>
    <div class="eff pos" style="font-size:var(--fs-xs)">副效果：${p.side}</div>
    <div class="dim-text" style="font-size:var(--fs-xs)">适合：${p.who}</div>
    ${unlocked ? '' : `<div class="lock-line">${icon('i-lock')}解锁条件：消耗 ${p.unlock.cost} 梦尘</div>`}
  </button>`;
}
function tryUnlock(kind, id, cost) {
  if (G.meta.dust < cost) { Sound.sfx('denied'); toast(`梦尘不足：还差 ${Math.ceil(cost - G.meta.dust)}`); return false; }
  G.meta.dust -= cost; G.meta.unlocked[kind].push(id); if (kind === 'weapons') G.meta.codex.weapons[id] = 1;
  Sound.sfx('select'); toast('已解锁'); persist(); return true;
}
function showLoadout(step, back) {
  Sound.setMode('hub');
  const m = G.meta;
  let preview = m.loadout.weapon;
  const render = () => {
    if (step === 1) {
      const w = WEAPONS[preview], unlocked = m.unlocked.weapons.includes(preview);
      const el = showScreen('loadout', `${backBtn()}
        <div class="screen-title"><h2>出航准备</h2>${stepsBar(1)}</div>
        <div class="lo-body">
          <div class="cards-grid">${Object.values(WEAPONS).map((x) => weaponCard(x, x.id === preview)).join('')}</div>
          <div class="lo-side">
            <div class="demo-wrap"><canvas id="demo-cv" width="640" height="360" aria-label="${w.name} 攻击演示"></canvas><span class="demo-cap">${w.name} · 5 秒攻击演示（自动循环）</span></div>
            <div class="panel problem"><b>你要解决的问题：</b>${w.problem}</div>
            ${unlocked ? '' : `<button class="btn primary" id="lo-unlock" type="button">${icon('i-dust')} 用 ${w.unlock.cost} 梦尘解锁（现有 ${Math.floor(m.dust)}）</button>`}
          </div>
        </div>
        <div class="lo-foot"><span class="dim-text" style="font-size:var(--fs-xs)">点卡片看演示；首次出航推荐光针炮。</span>
          <button class="btn primary" id="lo-next" type="button" ${unlocked ? '' : 'disabled'}>下一步：梦境演奏 ${icon('i-back', 'ic flip')}</button></div>`, { bg: 'hub', back, label: '选择武器' });
      $$('[data-w]', el).forEach((b) => b.onclick = () => { preview = b.dataset.w; Sound.sfx('card'); if (m.unlocked.weapons.includes(preview)) m.loadout.weapon = preview; render(); });
      if (!unlocked) $('#lo-unlock', el).onclick = () => { if (tryUnlock('weapons', preview, w.unlock.cost)) { m.loadout.weapon = preview; render(); } };
      $('#lo-next', el).onclick = () => { if (!m.unlocked.weapons.includes(preview)) return; m.loadout.weapon = preview; Tele.log('weapon_selected', { id: preview }); persist(); Sound.sfx('select'); step = 2; render(); };
      startDemo($('#demo-cv', el), preview);
      const f = $(`[data-w="${preview}"]`, el); if (f && Input.keyboardNav) f.focus({ preventScroll: true });
    } else if (step === 2) {
      stopDemo();
      const p = PERFS[m.loadout.perf];
      const el = showScreen('loadout', `${backBtn()}
        <div class="screen-title"><h2>出航准备</h2>${stepsBar(2)}</div>
        <div class="lo-body">
          <div class="cards-grid">${Object.values(PERFS).map((x) => perfCard(x, x.id === m.loadout.perf)).join('')}</div>
          <div class="lo-side">
            <div class="panel problem"><b>共振满 100 后按「奏」释放。</b><br>擦弹 +4 · 完美闪避 +8 · 切弹 +6 · 精准弹反 +10 · 击中 Boss 弱点 +12。受伤会清空连击，但不会清空共振。</div>
            <div class="panel problem" id="lo-perf-note"><b>${p.name}：</b>${p.main}；${p.side}。每条航线只能装备一个初始演奏。</div>
          </div>
        </div>
        <div class="lo-foot"><button class="btn" id="lo-prev" type="button">上一步</button>
          <button class="btn primary" id="lo-next" type="button">下一步：弹幕速览</button></div>`, { bg: 'hub', back, label: '选择梦境演奏' });
      $$('[data-p]', el).forEach((b) => b.onclick = () => {
        const id = b.dataset.p, P = PERFS[id];
        if (!m.unlocked.perfs.includes(id)) { if (tryUnlock('perfs', id, P.unlock.cost)) { m.loadout.perf = id; render(); } return; }
        m.loadout.perf = id; Sound.sfx('card'); render();
      });
      $('#lo-prev', el).onclick = () => { step = 1; render(); };
      $('#lo-next', el).onclick = () => { Tele.log('performance_selected', { id: m.loadout.perf }); persist(); Sound.sfx('select'); step = 3; render(); };
    } else {
      stopDemo();
      const el = showScreen('loadout', `${backBtn()}
        <div class="screen-title"><h2>出航准备</h2>${stepsBar(3)}</div>
        <div class="lo-body" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
          <div class="legend">${Object.values(BULLETS).map((b) => `<div class="legend-row"><canvas width="108" height="108" data-bicon="${b.id}"></canvas><div><div class="ln" style="color:${b.color}">${b.name} <span class="chip">${b.label}</span></div><div class="lt">${b.op} → ${b.reward}</div></div></div>`).join('')}</div>
          <div class="lo-side">
            <div class="panel problem"><b>颜色之外还有形状、声音和文字。</b><br>圆的躲，菱形切，星星进圈弹反，白线先预警，泡泡直接碰。设置里可以开启色弱模式：每种弹幕多一个内部符号。</div>
            <div class="panel problem"><b>本次出航：</b>${WEAPONS[m.loadout.weapon].name} · ${PERFS[m.loadout.perf].name} · ${DIFFICULTY[m.settings.difficulty].name}难度</div>
            <button class="btn" id="lo-codex" type="button">${icon('i-book')} 查看完整弹幕图鉴</button>
          </div>
        </div>
        <div class="lo-foot"><button class="btn" id="lo-prev" type="button">上一步</button>
          <button class="btn primary big" id="lo-go" type="button" autofocus>${icon('i-map')} 启航</button></div>`, { bg: 'hub', back, label: '弹幕速览' });
      $$('[data-bicon]', el).forEach((c) => paintBulletIcon(c, c.dataset.bicon, m.settings.colorblind));
      $('#lo-prev', el).onclick = () => { step = 2; render(); };
      $('#lo-codex', el).onclick = () => showCodex('bullets', () => showLoadout(3, back));
      $('#lo-go', el).onclick = () => { Sound.sfx('select'); newRun(); };
    }
  };
  render();
}
function startDemo(cv, weaponId) {
  stopDemo();
  const world = new World({ mode: 'demo', W: 1280, weapon: weaponId, settings: Object.assign({}, G.meta.settings, { particles: 'full', shake: false }) });
  G.demo = { world, cv, g: cv.getContext('2d'), acc: 0 };
}
function stopDemo() { G.demo = null; }
function tickDemo(dt) {
  const d = G.demo; if (!d) return;
  if (!document.body.contains(d.cv)) { G.demo = null; return; }
  d.acc += dt; let n = 0;
  while (d.acc >= 1 / 60 && n < 4) { d.world.step(1 / 60); d.acc -= 1 / 60; n++; }
  const g = d.g, k = d.cv.width / 800; // zoom onto the action: lantern on the left, target on the right
  g.setTransform(k, 0, 0, k, -240 * k, -135 * k);
  d.world.render(g, { simpleBg: true });
}

/* ---------------------------------------------------------------- CODEX ---------------------------------------------------------------- */
function showCodex(tab, back) {
  const m = G.meta;
  const tabs = [['bullets', '弹幕'], ['weapons', '武器'], ['enemies', '敌人'], ['cards', '梦境卡'], ['memories', '记忆碎片']];
  let body = '';
  if (tab === 'bullets') {
    body = `<div class="codex-grid">${Object.values(BULLETS).map((b) => `
      <div class="panel cx"><div style="display:flex;flex-direction:column;gap:6px"><canvas width="140" height="140" data-bicon="${b.id}" aria-label="${b.name} 静态图"></canvas><canvas width="140" height="140" data-btraj="${b.id}" aria-label="${b.name} 运动轨迹"></canvas></div>
        <div><h3 style="color:${b.color}">${b.name}</h3>
        <div class="row"><span class="chip">${b.label}</span><span class="chip ${b.danger >= 3 ? 'coral' : ''}">危险 ${'●'.repeat(b.danger)}${'○'.repeat(3 - b.danger)}</span>
        <span class="chip ${b.cut ? 'cyan' : ''}">${b.cut ? '可切断' : '不可切'}</span><span class="chip ${b.parry ? 'gold' : ''}">${b.parry ? '可弹反' : '不可反'}</span></div>
        <p><b>形状</b> ${b.shape} · <b>轨迹</b> ${b.move}</p><p><b>成功收益</b> ${b.reward}</p><p><b>操作</b> ${b.tip}</p>
        ${m.codex.bullets[b.id] ? '' : '<p class="dim-text">（还没在航线上遇见过）</p>'}</div></div>`).join('')}</div>`;
  } else if (tab === 'weapons') {
    body = `<div class="codex-grid">${Object.values(WEAPONS).map((w) => {
      const own = m.unlocked.weapons.includes(w.id);
      return `<div class="panel cx"><div style="display:grid;place-items:center;width:max(64px,calc(92px*var(--u)));height:max(64px,calc(92px*var(--u)));border-radius:14px;background:rgba(12,10,36,.6)"><svg class="ic" style="width:60%;height:60%;fill:${own ? 'var(--lamp2)' : 'var(--mute)'}"><use href="#${w.icon}"/></svg></div>
      <div><h3>${w.name} <span class="chip gold">${w.tag}</span></h3><p>${w.line}</p>
      <p>每秒 ${w.rate} 次 · 单发 ${w.dmg} · 射程系数 ${w.rangeK} · 穿透 ${w.pierce} · 切弹${w.cut} · 难度${w.diff}</p><p>${own ? '已解锁' : `未解锁：${w.unlock.cost} 梦尘`}</p></div></div>`;
    }).join('')}</div>`;
  } else if (tab === 'enemies') {
    body = `<div class="codex-grid">${Object.entries(ENEMY_INFO).map(([id, e]) => {
      const seen = m.codex.enemies[id];
      return `<div class="panel cx ${seen ? '' : 'unknown'}"><canvas width="140" height="140" data-eicon="${id}"></canvas>
      <div><h3>${seen ? e.name : '？？？'} ${e.elite ? '<span class="chip coral">精英</span>' : ''}${e.boss ? '<span class="chip gold">Boss</span>' : ''}</h3>
      <p>${seen ? e.desc : '在航线上遇见后记录。'}</p>${seen ? `<p>主要弹幕：${BULLETS[e.bullet].name}</p>` : ''}</div></div>`;
    }).join('')}</div>`;
  } else if (tab === 'cards') {
    body = `<div class="codex-grid">${Object.values(CARDS).map((c) => {
      const seen = m.codex.cards[c.id];
      return `<div class="panel cx ${seen ? '' : 'unknown'}"><div style="display:grid;place-items:center;width:max(64px,calc(92px*var(--u)));height:max(64px,calc(92px*var(--u)));border-radius:50%;background:rgba(12,10,36,.6)"><svg class="ic" style="width:56%;height:56%;fill:${seen ? 'var(--lamp2)' : 'var(--mute)'}"><use href="#${c.icon}"/></svg></div>
      <div><h3>${seen ? c.name : '？？？'} <span class="chip ${c.rarity === 'rare' ? 'gold' : ''}">${c.rarity === 'rare' ? '稀有' : '普通'}</span> <span class="chip">${c.tag}</span></h3>
      ${seen ? `<p>触发：${c.trigger}</p><p style="color:#c8f2ff">＋ ${c.pos}</p><p style="color:#ffc6bd">－ ${c.neg}</p>` : '<p>在航线上选择过一次后记录。</p>'}</div></div>`;
    }).join('')}</div>`;
  } else {
    body = `<div class="codex-grid">${Object.values(MEMORIES).map((mm) => m.memories.includes(mm.id)
      ? `<div class="panel story"><h3>${mm.title}</h3>${mm.text}</div>`
      : `<div class="panel story" style="opacity:.55"><h3>？？？</h3>这段记忆还沉在梦海底。</div>`).join('')}</div>`;
  }
  const el = showScreen('codex', `${backBtn()}
    <div class="screen-title"><h2>图鉴</h2><p>新玩家看不懂颜色？先来这里。</p></div>
    <div class="tabs" role="tablist">${tabs.map(([id, n]) => `<button class="tab ${id === tab ? 'on' : ''}" data-tab="${id}" role="tab" aria-selected="${id === tab}" type="button">${n}</button>`).join('')}</div>
    ${body}`, { bg: 'hub', back, label: '图鉴' });
  $$('[data-tab]', el).forEach((b) => b.onclick = () => { Sound.sfx('ui'); showCodex(b.dataset.tab, back); });
  $$('[data-bicon]', el).forEach((c) => paintBulletIcon(c, c.dataset.bicon, m.settings.colorblind));
  $$('[data-eicon]', el).forEach((c) => { if (m.codex.enemies[c.dataset.eicon]) paintEnemyIcon(c, c.dataset.eicon); else { const g = c.getContext('2d'); g.fillStyle = 'rgba(169,200,255,.15)'; g.font = '700 60px "Baloo 2"'; g.textAlign = 'center'; g.fillText('?', 70, 92); } });
  $$('[data-btraj]', el).forEach((c) => G.anims.push({ c, type: c.dataset.btraj }));
}
/* animated trajectory previews for the bullet codex */
function tickAnims(t) {
  for (const a of G.anims) {
    const c = a.c, g = c.getContext('2d'), s = c.width, cb = G.meta.settings.colorblind;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s, s);
    g.fillStyle = 'rgba(12,10,36,.6)'; g.fillRect(0, 0, s, s);
    const u = (t % 2.4) / 2.4;
    if (a.type === 'pink') { for (let i = 0; i < 5; i++) { const an = Math.PI + (i / 4 - 0.5) * 0.9, d = u * 120; BulletArt.draw(g, 'pink', 120 + Math.cos(an) * d, 70 + Math.sin(an) * d, 0, 0.7, cb); } }
    else if (a.type === 'blue') {
      if (u < 0.6) for (let i = 0; i < 4; i++) BulletArt.draw(g, 'blue', 130 - u * 150, 22 + i * 32, t * 3, 0.7, cb);
      else { const v = (u - 0.6) / 0.4; for (let i = 0; i < 4; i++) { BulletArt.draw(g, 'shard', 40 + v * 90, 22 + i * 32 - v * 10, -0.2, 0.9); BulletArt.draw(g, 'shard', 40 + v * 90, 22 + i * 32 + v * 10, 0.2, 0.9); } }
    } else if (a.type === 'gold') {
      g.strokeStyle = 'rgba(255,213,74,.7)'; g.setLineDash([6, 5]); g.lineWidth = 2; g.beginPath(); g.arc(34, 70, 30, 0, TAU); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#fff6ee'; g.beginPath(); g.arc(34, 70, 7, 0, TAU); g.fill();
      if (u < 0.6) BulletArt.draw(g, 'gold', 130 - u * 150, 70, t * 3, 0.8, cb); else BulletArt.draw(g, 'note', 40 + ((u - 0.6) / 0.4) * 100, 70 - ((u - 0.6) / 0.4) * 30, 0, 0.9);
    } else if (a.type === 'white') {
      const bright = u > 0.15, fire = u > 0.5;
      g.strokeStyle = bright ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.18)'; g.lineWidth = bright ? 2.5 : 1.2; g.setLineDash(bright ? [10, 6] : []);
      g.beginPath(); g.moveTo(140, 40); g.lineTo(0, 100); g.stroke(); g.setLineDash([]);
      if (fire) for (let i = 0; i < 4; i++) { const v = (u - 0.5) * 2 * 180 - i * 22; if (v > 0) BulletArt.draw(g, 'white', 140 - v * 0.92, 40 + v * 0.39, Math.atan2(60, -140), 0.8, cb); }
    } else if (a.type === 'purple') {
      const x = 110 - u * 60, y = 60 + Math.sin(t * 3) * 10;
      if (u < 0.8) BulletArt.draw(g, 'purple', x, y, 0, 0.9, cb);
      g.fillStyle = '#fff6ee'; g.beginPath(); g.arc(38, 64, 9, 0, TAU); g.fill();
      if (u >= 0.8) { g.fillStyle = 'rgba(181,140,255,.8)'; for (let i = 0; i < 5; i++) g.fillRect(38 + Math.cos(i) * 16 * (u - 0.8) * 5, 64 + Math.sin(i) * 16 * (u - 0.8) * 5, 3, 3); }
    }
  }
}

/* ---------------------------------------------------------------- RUN / ROUTE MAP ---------------------------------------------------------------- */
function genMap() {
  const goalFor = (ci) => { if (ci < 2) return 'kill'; const r = Math.random(); return r < 0.6 ? 'kill' : r < 0.8 ? 'survive' : 'core'; };
  const cols = ROUTE_TEMPLATE.map((col, ci) => col.map(([type, lane]) => {
    const n = { id: `n${ci}-${lane}`, col: ci, lane, type, done: false };
    if (type === 'normal') n.goal = goalFor(ci);
    if (type === 'elite') { n.elite = pick(['jellyE', 'tickE', 'starE']); n.affix = pick(Object.keys(AFFIXES)); }
    return n;
  }));
  cols.push([{ id: 'boss', col: 8, lane: 1, type: 'boss', done: false }]);
  return { cols };
}
function availableNodes() {
  const run = G.run, cols = run.map.cols;
  if (!run.pos) return cols[0];
  const next = cols[run.pos.col + 1]; if (!next) return [];
  if (next[0].type === 'boss') return next;
  return next.filter((n) => Math.abs(n.lane - run.pos.lane) <= 1);
}
function nodeStars(n) { const T = ROOM_TYPES[n.type]; return n.type === 'normal' ? 1 + (n.col >= 4 ? 1 : 0) : T.stars; }
function newRun() {
  const m = G.meta, s = m.settings;
  G.run = {
    id: Date.now().toString(36), weaponId: m.loadout.weapon, perfId: m.loadout.perf, difficulty: s.difficulty, assisted: isAssisted(s),
    hp: 100, maxHp: 100, res: 0, resCap: 100, resCapRooms: 0, dashCharges: 2, cards: [], relics: [], buffRooms: 0, rewindUsed: false,
    seenBullets: {}, dust: 0, map: genMap(), pos: null, rooms: 0, castOnce: false,
    stats: { kills: 0, grazes: 0, cuts: 0, parries: 0, perfectParries: 0, perfectDodges: 0, damageTaken: 0, maxCombo: 0, time: 0 },
  };
  m.records.runs++; Tele.log('run_started');
  if (G.lastEnd === 'fail') Tele.log('restart_after_fail');
  G.lastEnd = null;
  Sound.setCardMods([]);
  persist();
  if (!m.tutorialDone) startTutorial(false); else showMap();
}
function runChips() {
  const r = G.run;
  const cards = r.cards.map((c) => `<span class="chip gold" title="${esc(CARDS[c.id].name)}">${icon(CARDS[c.id].icon)}${CARDS[c.id].name}${c.stacks > 1 ? ' ×' + c.stacks : ''}</span>`).join('');
  const relics = r.relics.map((id) => `<span class="chip cyan">${icon(RELICS[id].icon)}${RELICS[id].name}</span>`).join('');
  return `<div class="run-mini"><span class="chip coral">${icon('i-heart')}<span class="num">${Math.round(r.hp)}/${r.maxHp}</span></span><span class="chip gold">${icon('i-note')}<span class="num">${Math.floor(r.res)}</span></span><span class="chip dust">${icon('i-dust')}<span class="num">${Math.floor(r.dust)}</span></span>${cards}${relics}</div>`;
}
function showMap(selectId) {
  Sound.setMode('map'); G.world = null; Input.gameActive = false; hideHud(); stopDemo();
  const run = G.run, cols = run.map.cols, avail = availableNodes(), availIds = new Set(avail.map((n) => n.id));
  const xOf = (c) => 6 + c * (88 / 8), yOf = (l) => [18, 50, 82][l];
  let lines = '';
  for (let c = 0; c < cols.length - 1; c++) for (const a of cols[c]) for (const b of cols[c + 1]) {
    if (b.type !== 'boss' && Math.abs(a.lane - b.lane) > 1) continue;
    const onPath = run.pos && a.id === cols[run.pos.col].find((n) => n.lane === run.pos.lane)?.id && availIds.has(b.id);
    const walked = a.done && b.done;
    lines += `<line x1="${xOf(a.col)}" y1="${yOf(a.lane)}" x2="${xOf(b.col)}" y2="${b.type === 'boss' ? 50 : yOf(b.lane)}" stroke="${walked ? 'rgba(255,214,140,.85)' : onPath ? 'rgba(255,255,255,.75)' : 'rgba(190,205,255,.2)'}" stroke-width="${walked || onPath ? 3 : 2}" stroke-dasharray="${walked ? '0' : '6 6'}" vector-effect="non-scaling-stroke"/>`;
  }
  let nodes = '';
  for (const col of cols) for (const n of col) {
    const cur = run.pos && run.pos.col === n.col && run.pos.lane === n.lane;
    const cls = [`t-${n.type}`, n.done ? 'done' : '', cur ? 'cur' : '', availIds.has(n.id) ? 'avail' : 'locked'].join(' ');
    nodes += `<button class="node ${cls}" style="left:${xOf(n.col)}%;top:${n.type === 'boss' ? 50 : yOf(n.lane)}%" data-node="${n.id}" type="button" aria-label="${ROOM_TYPES[n.type].name}${availIds.has(n.id) ? '，可前往' : ''}">${icon(ROOM_TYPES[n.type].icon)}</button>`;
  }
  const el = showScreen('map', `
    <div class="map-head"><h2>失眠之海 · 航线图</h2><span class="dim-text" style="font-size:var(--fs-xs)">第 ${(run.pos ? run.pos.col + 2 : 1)} / 9 站 · ${DIFFICULTY[run.difficulty].name}${run.assisted ? ' · 辅助' : ''}</span><span class="spacer"></span>
      <button class="btn" id="map-codex" type="button">${icon('i-book')} 图鉴</button><button class="btn" id="map-hub" type="button">${icon('i-lamp')} 回大厅</button></div>
    <div class="map-area">
      <svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
      <span class="lane-label" style="top:${yOf(0) - 9}%">浅梦航道 · 更安全</span>
      <span class="lane-label" style="top:${yOf(2) + 9}%">深梦航道 · 奖励更高</span>
      ${nodes}
    </div>
    <aside class="map-panel panel" id="map-panel" aria-live="polite"></aside>`, { bg: 'map', back: showHub, label: '航线图' });
  const panel = $('#map-panel', el);
  let chosen = null;
  const describe = (n) => {
    const T = ROOM_TYPES[n.type], ok = availIds.has(n.id);
    const goal = n.type === 'normal' ? NORMAL_GOALS[n.goal].name : n.type === 'elite' ? `${ENEMY_INFO[n.elite].name} · ${AFFIXES[n.affix].name}` : n.type === 'challenge' ? '连续三波：密度 / 规则 / 精英混合' : n.type === 'boss' ? '三个乐章' : '—';
    panel.innerHTML = `<h3>${T.name}</h3>
      <div class="kv"><span>预估难度</span><b>${stars(nodeStars(n))}</b><span>目标</span><b>${goal}</b><span>可能奖励</span><b>${T.rewards}</b><span>包含精英</span><b>${n.type === 'elite' || n.type === 'challenge' ? '是' : '否'}</b><span>可否回退</span><b>选定后不可回退</b></div>
      ${ok ? `<button class="btn primary" id="map-go" type="button">${icon('i-map')} 出发</button>` : `<span class="dim-text" style="font-size:var(--fs-xs)">${n.done ? '已经走过' : '从当前位置到不了这里'}</span>`}
      <div class="label" style="margin-top:6px">本局状态</div>${runChips()}`;
    if (ok) $('#map-go', panel).onclick = () => enterNode(n);
  };
  const intro = () => {
    panel.innerHTML = `<h3>选一个节点</h3><p class="dim-text" style="font-size:var(--fs-xs);line-height:1.6;margin:0">亮着的节点可以前往。走上面更安全，走下面奖励更高。</p><div class="label">本局状态</div>${runChips()}`;
  };
  $$('[data-node]', el).forEach((b) => {
    const n = cols.flat().find((x) => x.id === b.dataset.node);
    b.addEventListener('pointerenter', () => { if (!chosen) describe(n); });
    b.addEventListener('focus', () => { describe(n); });
    b.onclick = () => {
      if (!availIds.has(n.id)) { describe(n); return; }
      if (chosen === n.id && Input.device === 'touch') { enterNode(n); return; }
      chosen = n.id; $$('.node.pick', el).forEach((x) => x.classList.remove('pick')); b.classList.add('pick'); Sound.sfx('card'); describe(n);
      const go = $('#map-go', panel); if (go && Input.keyboardNav) go.focus({ preventScroll: true });
    };
  });
  $('#map-codex', el).onclick = () => showCodex('bullets', showMap);
  $('#map-hub', el).onclick = () => { toast('已保存到上一安全节点'); showHub(); };
  if (selectId) { const n = cols.flat().find((x) => x.id === selectId); if (n) describe(n); } else intro();
  const first = $('.node.avail', el); if (first && Input.keyboardNav) first.focus({ preventScroll: true });
}
function enterNode(n) {
  Sound.sfx('select');
  const run = G.run;
  run.current = n.id; persist(); // 进入新房间时自动保存
  if (n.type === 'rest') return showRest(n);
  if (n.type === 'shop') return showShop(n);
  if (n.type === 'boss') { Tele.log('boss_reached'); return startCombat('boss', n); }
  Tele.log('room_enter', { type: n.type });
  if (n.type === 'normal' && !run.firstNormal) { run.firstNormal = true; Tele.log('first_normal_enter'); }
  startCombat('room', n);
}
function completeNode(n) {
  const run = G.run;
  n.done = true; run.pos = { col: n.col, lane: n.lane }; run.current = null; run.rooms++;
  persist();
}

/* ---------------------------------------------------------------- COMBAT ---------------------------------------------------------------- */
function startCombat(mode, node) {
  const run = G.run;
  applySettings();
  clearScreens(); stopDemo();
  G.bg = 'world'; G.paused = false;
  const w = new World({
    mode, W: G.W, run, node, settings: G.meta.settings, scene: G.sea,
    cb: {
      onClear: (res) => (mode === 'boss' ? onBossClear(node, res) : onRoomClear(node, res)),
      onDeath: (res) => onDeath(node, res),
      onSeen: (type) => { G.meta.codex.bullets[type] = 1; },
      known: (type) => !!G.meta.codex.bullets[type],
      onSeenEnemy: (type) => { G.meta.codex.enemies[type] = 1; },
      onKill: () => {},
      onPerfectParry: () => { G.meta.records.perfectParries++; if (G.meta.records.perfectParries >= 10) unlockMemory('bell'); },
    },
  });
  G.world = w;
  if (mode === 'room') {
    const T = ROOM_TYPES[node.type];
    const sub = node.type === 'normal' ? NORMAL_GOALS[node.goal].name + (node.goal === 'kill' ? `（${w.waves} 波）` : '') : node.type === 'elite' ? '击破精英的护盾，再击败它' : '三波高压：生命保持在 30% 以上';
    banner(T.name, sub, 1.3);
    Sound.setMode(node.type === 'elite' || node.type === 'challenge' ? 'elite' : 'combat');
    if (w.mods.paperboat) toast('纸船护盾已展开');
  } else {
    banner('失控闹钟', CLOCK_PHASES[1].name, 3.0);
    Sound.setMode('boss1'); G.meta.codex.enemies.clock = 1;
  }
  Sound.setCardMods(run.cards.map((c) => c.id));
  Input.gameActive = true; Input.clearPresses();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  buildHud();
}
function startTutorial(replay) {
  G.tutReplay = replay;
  const run = tempRun(G.meta.loadout.weapon, 'echo');
  G.tutRun = run;
  applySettings(); clearScreens(); stopDemo(); G.bg = 'world'; G.paused = false;
  Tele.log('tutorial_start');
  const w = new World({
    mode: 'tutorial', W: G.W, run, settings: G.meta.settings, scene: G.sea,
    cb: {
      onTutorialDone: () => finishTutorial(),
      onTutMove: (t) => { Tele.flag('tut_move_time', Math.round(t * 10) / 10); Tele.log('tutorial_move_done'); },
      onSeen: (type) => { G.meta.codex.bullets[type] = 1; },
    },
  });
  G.world = w; Sound.setMode('combat');
  Input.gameActive = true; Input.clearPresses();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  buildHud();
}
function finishTutorial() {
  const m = G.meta;
  if (!m.tutorialDone) { m.tutorialDone = true; Tele.log('tutorial_complete'); unlockMemory('first'); }
  persist();
  if (G.tutReplay || !G.run) showHub(); else showMap();
}

function onRoomClear(node, res) {
  const run = G.run, st = res.stats;
  for (const k of Object.keys(run.stats)) if (k in st) run.stats[k] = k === 'maxCombo' ? Math.max(run.stats[k], st[k]) : run.stats[k] + st[k];
  const base = node.type === 'normal' ? 26 + node.col * 4 : node.type === 'elite' ? 70 : res.challengeFailed ? 45 : 110;
  const mods = computeMods(run, WEAPONS[run.weaponId]);
  const dust = Math.round(base * (res.coreBroken ? 0.4 : 1) * mods.dust);
  run.dust += dust;
  if (run.relics.includes('crane')) run.hp = Math.min(run.maxHp, run.hp + 6);
  if (run.buffRooms > 0) run.buffRooms--;
  if (run.resCapRooms > 0) { run.resCapRooms--; if (run.resCapRooms === 0) { run.resCap = 100; run.res = Math.min(run.res, 100); } }
  if (node.type === 'elite') { run.resCap = 130; run.resCapRooms = 1; }
  if (G.world && G.world.perf) run.castOnce = true;
  Tele.log('room_clear', { type: node.type });
  if (node.type === 'normal' && !run.firstNormalCleared) { run.firstNormalCleared = true; Tele.log('first_normal_clear'); }
  if (node.type === 'challenge' && !res.challengeFailed) { unlockMemory('sea'); const score = st.kills + st.cuts * 2 + st.parries * 3 - Math.round(st.damageTaken / 5); G.meta.records.challengeBest = Math.max(G.meta.records.challengeBest, score); }
  Tele.add('bullet_cut', st.cuts); Tele.add('bullet_parry', st.parries);
  G.meta.records.bestCombo = Math.max(G.meta.records.bestCombo, st.maxCombo);
  completeNode(node);
  const picks = node.type === 'challenge' && !res.challengeFailed ? 2 : 1;
  showRoomResult(node, res, dust, picks);
}
function gradeOf(st) {
  const act = st.cuts + st.parries + st.perfectDodges;
  if (st.damageTaken === 0 && act >= 3) return ['S', '梦中舞者'];
  if (st.damageTaken === 0) return ['A', '毫发无伤'];
  if (st.damageTaken < 25) return ['A', '轻盈航行'];
  if (st.damageTaken < 50) return ['B', '稳稳靠岸'];
  return ['C', '勉强靠岸'];
}
function statPills(st, extra = []) {
  const list = [['击破', st.kills], ['擦弹', st.grazes], ['切弹', st.cuts], ['弹反', st.parries], ['完美闪避', st.perfectDodges], ['最高连击', st.maxCombo], ['受到伤害', st.damageTaken], ...extra];
  return `<div class="statrow">${list.map(([k, v]) => `<div class="stat-pill"><span class="num">${v}</span><span>${k}</span></div>`).join('')}</div>`;
}
function showRoomResult(node, res, dust, picks) {
  Input.gameActive = false; hideHud(false);
  const [g, gname] = gradeOf(res.stats);
  const note = res.coreBroken ? '核心破碎：梦尘减少' : res.challengeFailed ? '挑战失败：没有额外梦境卡' : node.type === 'elite' ? '下个房间共振上限提高到 130' : '';
  const el = showScreen('result', `
    <div class="center-col">
      <div class="row" style="gap:calc(18px*var(--u));align-items:flex-end"><span class="grade">${g}</span><div><div class="h-display" style="font-size:var(--fs-l)">${gname}</div><div class="dim-text">${ROOM_TYPES[node.type].name} · 完成</div></div>
      <span class="chip dust" style="font-size:var(--fs-s)">${icon('i-dust')} +${dust} 梦尘</span></div>
      ${statPills(res.stats)}
      ${note ? `<div class="chip white">${note}</div>` : ''}
      <div class="h-display" style="font-size:var(--fs-m);color:var(--lamp2)" id="card-title">${picks > 1 ? '挑战奖励：连续选择两张梦境卡' : '选择一张梦境卡'}</div>
      <div class="card-row" id="card-row"></div>
    </div>`, { bg: 'world', cls: 'dim-soft', label: '房间结算' });
  let left = picks;
  const deal = () => {
    const offer = offerCards(node.type === 'elite' ? 0.6 : node.type === 'challenge' ? 0.5 : 0.28);
    const row = $('#card-row', el);
    row.innerHTML = offer.map((c, i) => cardHtml(c, i)).join('');
    const btns = $$('.dcard', row);
    btns.forEach((b) => { b.disabled = true; });
    setTimeout(() => { btns.forEach((b) => { b.disabled = false; }); if (Input.keyboardNav && btns[0]) btns[0].focus({ preventScroll: true }); }, 650);
    btns.forEach((b) => b.onclick = () => {
      const c = CARDS[b.dataset.card];
      takeCard(c); Sound.sfx('select');
      btns.forEach((x) => { if (x !== b) { x.style.transition = 'transform .3s, opacity .3s'; x.style.opacity = '0'; x.style.transform = 'translateY(40px) scale(.9)'; } });
      b.style.transform = 'translateY(-10px) scale(1.04)';
      left--;
      setTimeout(() => { if (left > 0) { $('#card-title', el).textContent = '再选一张'; deal(); } else { persist(); showMap(); } }, 520);
    });
  };
  setTimeout(() => { Sound.sfx('card'); deal(); }, 320);
}
function cardHtml(c, i) {
  const run = G.run, own = run.cards.find((k) => k.id === c.id);
  let warn = '';
  if (c.excl) { const old = run.cards.find((k) => CARDS[k.id].excl === c.excl && k.id !== c.id); if (old) warn = `<div class="eff warn">与「${CARDS[old.id].name}」互斥：选择后替换它</div>`; }
  const risky = (c.id === 'overheat' && run.cards.some((k) => k.id === 'rewind')) || (c.id === 'rewind' && run.cards.some((k) => k.id === 'overheat'));
  if (risky) warn += '<div class="eff warn">高风险组合：过热 + 倒带</div>';
  return `<button class="dcard ${c.rarity === 'rare' ? 'rare' : ''}" data-card="${c.id}" type="button" style="animation-delay:${0.12 * i}s">
    <div class="dicon">${icon(c.icon)}</div>
    <h3>${c.name}</h3>
    <div class="tags"><span class="chip ${c.rarity === 'rare' ? 'gold' : ''}">${c.rarity === 'rare' ? '稀有' : '普通'}</span><span class="chip">${c.tag}</span>${own ? `<span class="chip cyan">已持有 ${own.stacks}/${c.max}</span>` : ''}</div>
    <div class="eff hint">触发：${c.trigger}</div>
    <div class="eff pos">＋ ${c.pos}</div>
    <div class="eff neg">－ ${c.neg}</div>
    <div class="eff hint">${c.combo}</div>${warn}
  </button>`;
}
function offerCards(rareBias) {
  const run = G.run;
  const pool = Object.values(CARDS).filter((c) => { const o = run.cards.find((k) => k.id === c.id); return !o || o.stacks < c.max; });
  const out = [];
  while (out.length < 3 && pool.length) {
    const wantRare = Math.random() < rareBias;
    let cands = pool.filter((c) => (c.rarity === 'rare') === wantRare); if (!cands.length) cands = pool;
    const c = pick(cands); out.push(c); pool.splice(pool.indexOf(c), 1);
  }
  return out;
}
function takeCard(c) {
  const run = G.run;
  if (c.excl) { const old = run.cards.find((k) => CARDS[k.id].excl === c.excl && k.id !== c.id); if (old) { removeCard(old.id); toast(`「${CARDS[old.id].name}」已被替换`); } }
  const own = run.cards.find((k) => k.id === c.id);
  if (own) own.stacks++; else run.cards.push({ id: c.id, stacks: 1 });
  if (c.id === 'rewind') { run.maxHp -= 10; run.hp = Math.min(run.hp, run.maxHp); }
  G.meta.codex.cards[c.id] = 1;
  Sound.setCardMods(run.cards.map((k) => k.id));
  Tele.log('card_selected', { id: c.id });
}
function removeCard(id) {
  const run = G.run; run.cards = run.cards.filter((k) => k.id !== id);
  if (id === 'rewind') run.maxHp += 10;
  Sound.setCardMods(run.cards.map((k) => k.id));
}

/* ---------------------------------------------------------------- REST / SHOP ---------------------------------------------------------------- */
function showRest(node) {
  Sound.setMode('hub');
  const run = G.run, heal = Math.round(run.maxHp * 0.25);
  const el = showScreen('rest', `
    <div class="center-col">
      <h2 class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">恢复房间 · 月光码头</h2>
      <p class="dim-text" style="margin:0">只能选一项。恢复房间不给梦境卡。</p>
      ${runChips()}
      <div class="choice-row">
        <button class="choice" id="r-hp" type="button"><svg class="ic" style="fill:var(--coral)"><use href="#i-heart"/></svg><h3>安睡</h3><p>恢复 ${heal} 点生命（25%）</p></button>
        <button class="choice" id="r-res" type="button"><svg class="ic" style="fill:var(--lamp)"><use href="#i-note"/></svg><h3>哼歌</h3><p>恢复 50 点共振</p></button>
        <button class="choice" id="r-card" type="button" ${run.cards.length ? '' : 'disabled'}><svg class="ic" style="fill:var(--dust)"><use href="#c-rewind"/></svg><h3>遗忘</h3><p>${run.cards.length ? '移除一张梦境卡（正负效果一起移除）' : '还没有梦境卡可以移除'}</p></button>
      </div>
      <div class="card-row" id="rm-row"></div>
    </div>`, { bg: 'rest', cls: 'dim-soft', label: '恢复房间' });
  const done = (msg) => { Sound.sfx('heart'); toast(msg); completeNode(node); setTimeout(showMap, 450); };
  $('#r-hp', el).onclick = () => { run.hp = Math.min(run.maxHp, run.hp + heal); done(`生命 +${heal}`); };
  $('#r-res', el).onclick = () => { run.res = Math.min(run.resCap || 100, run.res + 50); done('共振 +50'); };
  $('#r-card', el).onclick = () => {
    $('#rm-row', el).innerHTML = run.cards.map((k) => `<button class="choice" data-rm="${k.id}" type="button"><svg class="ic" style="fill:var(--lamp2)"><use href="#${CARDS[k.id].icon}"/></svg><h3>${CARDS[k.id].name}</h3><p>－ ${CARDS[k.id].neg}</p></button>`).join('');
    $$('[data-rm]', el).forEach((b) => b.onclick = () => { removeCard(b.dataset.rm); done(`已遗忘「${CARDS[b.dataset.rm].name}」`); });
    const f = $('[data-rm]', el); if (f) f.focus();
  };
}
function showShop(node) {
  Sound.setMode('hub');
  const run = G.run;
  if (!node.stock) {
    const relics = Object.values(RELICS).filter((r) => !run.relics.includes(r.id));
    const pickR = []; while (pickR.length < 2 && relics.length) pickR.push(relics.splice(Math.floor(Math.random() * relics.length), 1)[0].id);
    node.stock = { relics: pickR, sold: [] };
  }
  const render = () => {
    const S = node.stock, can = (p) => run.dust >= p;
    const items = [
      ...S.relics.map((id) => ({ id, kind: 'relic', name: RELICS[id].name, icon: RELICS[id].icon, desc: RELICS[id].desc, price: RELICS[id].price })),
      { id: 'heart', kind: 'heart', name: '梦心', icon: 'r-heart', desc: '恢复 25 点生命。', price: 30 },
      { id: 'power', kind: 'power', name: '临时强化', icon: 'r-power', desc: '接下来 2 个战斗房间，射击伤害 +15%。', price: 45 },
    ];
    const el = showScreen('shop', `
      <div class="center-col">
        <h2 class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">梦尘商店 · 纸船摊</h2>
        ${runChips()}
        <div class="choice-row">${items.map((it) => { const sold = S.sold.includes(it.id); return `<button class="choice" data-buy="${it.id}" type="button" ${sold || !can(it.price) ? 'disabled' : ''}><svg class="ic" style="fill:var(--lamp2)"><use href="#${it.icon}"/></svg><h3>${it.name}</h3><p>${it.desc}</p><span class="price">${sold ? '已售出' : `${icon('i-dust')} ${it.price}`}</span></button>`; }).join('')}</div>
        <button class="btn primary" id="shop-leave" type="button">离开商店</button>
      </div>`, { bg: 'rest', cls: 'dim-soft', label: '商店' });
    $$('[data-buy]', el).forEach((b) => b.onclick = () => {
      const it = items.find((x) => x.id === b.dataset.buy); if (!it || run.dust < it.price) return;
      run.dust -= it.price; S.sold.push(it.id); Sound.sfx('select');
      if (it.kind === 'relic') { run.relics.push(it.id); if (it.id === 'pillow') { run.maxHp += 20; run.hp += 20; } toast(`获得遗物「${it.name}」`); }
      else if (it.kind === 'heart') { run.hp = Math.min(run.maxHp, run.hp + 25); toast('生命 +25'); }
      else { run.buffRooms = 2; toast('接下来 2 个房间伤害 +15%'); }
      persist(); render();
    });
    $('#shop-leave', el).onclick = () => { Sound.sfx('uiBack'); completeNode(node); showMap(); };
  };
  render();
}

/* ---------------------------------------------------------------- END: 章节完成 / 失败结算 ---------------------------------------------------------------- */
function onBossClear(node, res) {
  const run = G.run, m = G.meta, st = res.stats;
  for (const k of Object.keys(run.stats)) if (k in st) run.stats[k] = k === 'maxCombo' ? Math.max(run.stats[k], st[k]) : run.stats[k] + st[k];
  completeNode(node);
  const chapterDust = 150, total = Math.round(run.dust + chapterDust);
  m.dust += total;
  m.records.clears++; if (run.assisted) m.records.assistedClear = true;
  if (res.bossTime && (!m.records.bestBossTime || res.bossTime < m.records.bestBossTime)) m.records.bestBossTime = Math.round(res.bossTime);
  m.records.bestCombo = Math.max(m.records.bestCombo, run.stats.maxCombo);
  const unlocks = [];
  if (run.difficulty !== 'easy' && !m.unlocked.nightmare) { m.unlocked.nightmare = true; unlocks.push('梦魇难度'); }
  const nextW = ['kite', 'bell'].find((id) => !m.unlocked.weapons.includes(id));
  if (nextW) { m.unlocked.weapons.push(nextW); m.codex.weapons[nextW] = 1; unlocks.push(`新武器：${WEAPONS[nextW].name}`); }
  else { m.dust += 100; unlocks.push('武器升级材料（梦尘 +100）'); }
  const newMem = unlockMemory('clock');
  if (run.castOnce) Tele.log('run_with_cast');
  Tele.log('run_completed');
  G.lastEnd = 'win';
  const summary = { win: true, run: JSON.parse(JSON.stringify(run)), total, unlocks, memory: newMem ? MEMORIES.clock : null, bossTime: res.bossTime };
  G.run = null; persist();
  showEnd(summary);
}
function onDeath(node, res) {
  const run = G.run || G.tutRun, m = G.meta, st = res.stats;
  if (!G.run) return showHub();
  for (const k of Object.keys(run.stats)) if (k in st) run.stats[k] = k === 'maxCombo' ? Math.max(run.stats[k], st[k]) : run.stats[k] + st[k];
  if (G.world && G.world.perf) run.castOnce = true;
  const kept = Math.floor(run.dust * 0.7);
  m.dust += kept; m.records.deaths++; m.records.bestCombo = Math.max(m.records.bestCombo, run.stats.maxCombo);
  Tele.log('room_fail', { type: node ? node.type : '' }); Tele.log('run_failed');
  if (run.castOnce) Tele.log('run_with_cast');
  const newMem = unlockMemory('sleep');
  G.lastEnd = 'fail';
  const summary = { win: false, run: JSON.parse(JSON.stringify(run)), total: kept, lost: Math.ceil(run.dust - kept), memory: newMem ? MEMORIES.sleep : null, at: node ? ROOM_TYPES[node.type].name : '' };
  G.run = null; persist();
  showEnd(summary);
}
function unlockMemory(id) { const m = G.meta; if (m.memories.includes(id)) return false; m.memories.push(id); persist(); return true; }
function showEnd(S) {
  Input.gameActive = false; hideHud(false); Sound.setMode('result');
  const r = S.run, st = r.stats;
  const el = showScreen('end', `
    <div class="center-col">
      <div class="h-display" style="font-size:var(--fs-xl);color:${S.win ? 'var(--lamp2)' : 'var(--paper)'}">${S.win ? '章节完成 · 失眠之海' : '梦灯熄灭了'}</div>
      <div class="dim-text">${S.win ? `失控闹钟终于停了下来。${S.bossTime ? `Boss 战用时 ${fmtTime(S.bossTime)}。` : ''}` : `${S.at ? `在「${esc(S.at)}」睡着了。` : '航线在半途停了下来。'}没关系，灯还会再亮。`}</div>
      ${statPills(st, [['站点', r.rooms]])}
      <div class="panel" style="padding:calc(14px*var(--u)) calc(18px*var(--u));max-width:calc(700px*var(--u));font-size:var(--fs-s);line-height:1.7">
        ${S.win ? `带回梦尘 <b class="num" style="color:#e3d2ff">${S.total}</b>（含章节奖励 150）。${S.unlocks.length ? `<br>解锁：${S.unlocks.map(esc).join('、')}` : ''}`
          : `保留 70% 梦尘：<b class="num" style="color:#e3d2ff">${S.total}</b>（失去 ${S.lost}）。<br>保留：图鉴、剧情、已解锁武器、最高连击记录。<br>不保留：本局梦境卡、临时强化、未完成的 Boss 进度。`}
      </div>
      ${S.memory ? `<div class="panel memory"><h4>新的记忆碎片 · ${S.memory.title}</h4>${S.memory.text}</div>` : ''}
      <div class="panel memory" id="dream-box" hidden><h4>梦灯的航海日志</h4><div class="dream-out" id="dream-out"></div></div>
      <div class="row wrap" style="justify-content:center">
        <button class="btn" id="end-hub" type="button">${icon('i-lamp')} 返回大厅</button>
        <button class="btn primary" id="end-again" type="button" autofocus>${icon('i-map')} 再来一局</button>
        <button class="btn cyan" id="end-dream" type="button" hidden>${icon('i-note')} 让梦灯写下这一局</button>
      </div>
    </div>`, { bg: G.world ? 'world' : 'sea', cls: 'dim', label: S.win ? '章节完成' : '失败结算' });
  $('#end-hub', el).onclick = () => { Sound.sfx('uiBack'); showHub(); };
  $('#end-again', el).onclick = () => { Sound.sfx('select'); newRun(); };
  setupDreamLog(el, S);
}
/* 可选：请 Claude 把这一局写成四行短诗（sample capability；不可用时按钮不出现） */
function setupDreamLog(el, S) {
  const btn = $('#end-dream', el), box = $('#dream-box', el), out = $('#dream-out', el);
  const sample = G.cap.sample;
  if (!sample) return;
  btn.hidden = false;
  let ctl = null;
  btn.onclick = async () => {
    if (ctl) { ctl.abort(); return; }
    const r = S.run, st = r.stats;
    const cards = r.cards.map((c) => CARDS[c.id].name).join('、') || '无';
    const prompt = `你是 HTML 小游戏《梦潮：回声航线》里那只头顶小梦灯的梦灯生物。请根据下面这一局的数据，用第一人称写 4 行中文短诗，温柔、梦幻、带一点点神秘，像写在纸船上的航海日志。不要出现阿拉伯数字，不要标题，不要 Markdown，每行不超过 18 个字。\n` +
      `结果：${S.win ? '打败了失控闹钟，完成了失眠之海' : `在${S.at}熄灭`}\n武器：${WEAPONS[r.weaponId].name}；梦境演奏：${PERFS[r.perfId].name}；梦境卡：${cards}\n` +
      `击破${st.kills}，擦弹${st.grazes}，切弹${st.cuts}，弹反${st.parries}（完美${st.perfectParries}），完美闪避${st.perfectDodges}，受伤${st.damageTaken}，最高连击${st.maxCombo}。`;
    ctl = new AbortController();
    box.hidden = false; out.textContent = '梦灯正在想……'; btn.innerHTML = `${icon('i-pause')} 停止`;
    try {
      await sample(prompt, { signal: ctl.signal, modelTier: 'quick', cache: false, onText: ({ text }) => { out.textContent = text; } });
      btn.innerHTML = `${icon('i-note')} 再写一次`;
    } catch (e) {
      if (e && e.text) out.textContent = e.text;
      const code = e && e.code;
      if (code === 'cancelled') { if (!e.text) out.textContent = '（停下了）'; btn.innerHTML = `${icon('i-note')} 让梦灯写下这一局`; }
      else if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') { btn.hidden = true; if (!e.text) box.hidden = true; }
      else if (code === 'rate_limited') { out.textContent = (e.text || '') + '\n（梦灯有点累，过一会儿再试）'; btn.innerHTML = `${icon('i-note')} 再试一次`; }
      else if (code === 'refused') { out.textContent = '（这一次，梦灯没有写下来）'; btn.innerHTML = `${icon('i-note')} 再试一次`; }
      else { out.textContent = (e && e.text ? e.text + '\n' : '') + '（信号被梦雾打断了）'; btn.innerHTML = `${icon('i-note')} 再试一次`; }
    } finally { ctl = null; }
  };
}

/* ---------------------------------------------------------------- PAUSE ---------------------------------------------------------------- */
function pauseGame() {
  if (!G.world || G.paused || G.world.state === 'dying') return;
  G.paused = true; Input.gameActive = false; Sound.setBoost('tension', 0);
  const run = G.run, tut = G.world.mode === 'tutorial';
  const owned = run ? [
    ...run.cards.map((k) => { const c = CARDS[k.id]; return `<div class="own-item"><svg class="ic"><use href="#${c.icon}"/></svg><div><b>${c.name}${k.stacks > 1 ? ' ×' + k.stacks : ''}</b> <span class="chip">${c.tag}</span><p>触发：${c.trigger}</p><p style="color:#c8f2ff">＋ ${c.pos}</p><p style="color:#ffc6bd">－ ${c.neg}</p><p>当前：生效中</p></div></div>`; }),
    ...run.relics.map((id) => `<div class="own-item"><svg class="ic" style="fill:#9ff2c8"><use href="#${RELICS[id].icon}"/></svg><div><b>${RELICS[id].name}</b> <span class="chip cyan">遗物</span><p>${RELICS[id].desc}</p></div></div>`),
  ].join('') : '';
  const el = showScreen('pause', `
    <div class="pause-grid">
      <div class="panel pause-menu">
        <h2 class="h-display" style="font-size:var(--fs-xl);color:var(--paper)">暂停</h2>
        <button class="btn primary" id="p-resume" type="button" autofocus>继续</button>
        <button class="btn" id="p-settings" type="button">${icon('i-gear')} 设置</button>
        <button class="btn" id="p-codex" type="button">${icon('i-book')} 弹幕图鉴</button>
        ${tut ? `<button class="btn" id="p-skip" type="button">跳过教学</button>` : `<button class="btn" id="p-hub" type="button">${icon('i-lamp')} 返回大厅</button><span class="dim-text" style="font-size:var(--fs-xs)">${G.world.mode === 'boss' ? 'Boss 战中途不保存：返回后需从 Boss 节点重新开始' : '会回到上一安全节点，这个房间需要重打'}</span>
        <button class="btn coral" id="p-quit" type="button">放弃本局</button>`}
      </div>
      <div class="panel owned"><div class="label">当前生效的梦境卡与遗物</div>${owned || '<p class="dim-text" style="font-size:var(--fs-s)">还没有梦境卡。清完房间后三选一。</p>'}</div>
    </div>`, { bg: 'world', cls: 'dim', back: resumeGame, label: '暂停' });
  $('#p-resume', el).onclick = resumeGame;
  $('#p-settings', el).onclick = () => showSettings(() => { G.paused = false; pauseGame(); });
  $('#p-codex', el).onclick = () => showCodex('bullets', () => { G.paused = false; pauseGame(); });
  if (tut) $('#p-skip', el).onclick = () => { G.world = null; finishTutorial(); };
  else {
    $('#p-hub', el).onclick = () => { G.world = null; G.paused = false; toast('已保存到上一安全节点'); if (G.run) G.run.current = null; persist(); showHub(); };
    let armed = false;
    $('#p-quit', el).onclick = () => {
      if (!armed) { armed = true; $('#p-quit', el).textContent = '确认放弃（保留 70% 梦尘）'; return; }
      Tele.log('run_abandoned'); G.paused = false; const w = G.world; G.world = null; onDeath(null, w.result());
    };
  }
}
function resumeGame() {
  if (!G.world) return;
  clearScreens(); G.paused = false; G.bg = 'world'; Input.gameActive = true; Input.clearPresses();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  applySettings(); buildHud();
}

/* ---------------------------------------------------------------- SETTINGS ---------------------------------------------------------------- */
function showSettings(back) {
  const s = G.meta.settings;
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, n, dis]) => `<button type="button" data-seg="${key}" data-v="${v}" class="${s[key] === v ? 'on' : ''}" ${dis ? 'disabled' : ''}>${n}</button>`).join('')}</div>`;
  const tog = (key, name, sub) => `<div class="opt"><span>${name}${sub ? `<small>${sub}</small>` : ''}</span><button type="button" class="tog ${s[key] ? 'on' : ''}" data-tog="${key}" role="switch" aria-checked="${!!s[key]}" aria-label="${name}"></button></div>`;
  const binds = Object.keys(Input.ACTION_NAMES).map((a) => `<div class="opt"><span>${Input.ACTION_NAMES[a]}</span><button type="button" class="bind" data-bind="${a}">${Input.keyLabel(Input.binds[a][0])}</button></div>`).join('');
  const el = showScreen('settings', `${backBtn()}
    <div class="screen-title"><h2>设置</h2><p>辅助选项不会挡住主线剧情，只会在记录里标上「辅助」。</p></div>
    <div class="set-wrap">
      <div class="panel set-sec"><h3>难度</h3>
        <div class="opt"><span>难度<small>${esc(DIFFICULTY[s.difficulty].desc)}${G.run ? '；进行中的航线保持原难度' : ''}</small></span>${seg('difficulty', [['easy', '新手'], ['normal', '标准'], ['nightmare', '梦魇', !G.meta.unlocked.nightmare]])}</div>
        ${G.meta.unlocked.nightmare ? '' : '<p class="dim-text" style="font-size:var(--fs-xs);margin:0">梦魇：通关标准难度后解锁。</p>'}
      </div>
      <div class="panel set-sec"><h3>瞄准与攻击</h3>
        <div class="opt"><span>瞄准方式<small>自动：锁定最近且在前方的敌人，Boss 弱点优先</small></span>${seg('aimMode', [['auto', '自动'], ['assist', '辅助'], ['manual', '手动']])}</div>
        ${tog('autoFire', '自动攻击', '关闭后按住射击键 / 鼠标左键 / RT / 右侧区域才会射击')}
        ${tog('showHitbox', '显示碰撞核心', '主角身上的小白点就是真正的受击范围')}
      </div>
      <div class="panel set-sec"><h3>可读性与辅助</h3>
        ${tog('colorblind', '色弱模式', '每种弹幕多一个内部符号')}
        ${tog('bulletSlow', '弹幕减速', '所有敌弹 85% 速度（标记为辅助）')}
        ${tog('simpleWarn', '简化 Boss 预警', '预警更粗、更早 0.15 秒（标记为辅助）')}
        ${tog('shake', '屏幕震动')}
        ${tog('reduceFlash', '减少闪烁')}
        <div class="opt"><span>粒子与特效<small>精简 = 低特效模式，保留关键反馈</small></span>${seg('particles', [['full', '完整'], ['low', '精简']])}</div>
        ${tog('bigButtons', '扩大触屏按钮')}
      </div>
      <div class="panel set-sec"><h3>声音</h3>
        <div class="opt"><span>音乐</span><input type="range" id="set-music" min="0" max="1" step="0.05" value="${s.music}" aria-label="音乐音量"></div>
        <div class="opt"><span>音效</span><input type="range" id="set-sfx" min="0" max="1" step="0.05" value="${s.sfx}" aria-label="音效音量"></div>
        ${tog('muted', '静音')}
      </div>
      <div class="panel set-sec"><h3>按键（点一下再按新键，Esc 取消）</h3>${binds}
        <button class="btn" id="set-resetkeys" type="button">恢复默认按键</button>
        <p class="dim-text" style="font-size:var(--fs-xs);margin:0">手柄：左摇杆移动 · X 切/弹反 · A 闪避 · Y/RB 演奏 · LT 精确移动 · RT 射击 · Start 暂停</p>
      </div>
      <div class="panel set-sec"><h3>存档</h3>
        <p class="dim-text" style="font-size:var(--fs-xs);margin:0">进度只存在这台设备的浏览器里${Store.ok ? '' : '（当前浏览器拒绝了本地存储，关掉页面后进度不会保留）'}。</p>
        <button class="btn coral" id="set-wipe" type="button">清除全部存档</button>
      </div>
    </div>`, { bg: G.world ? 'world' : 'hub', cls: G.world ? 'dim' : '', back: () => { persist(); back(); }, label: '设置' });
  const save = () => { applySettings(); persist(); };
  $$('[data-seg]', el).forEach((b) => b.onclick = () => { s[b.dataset.seg] = b.dataset.v; Sound.sfx('ui'); save(); showSettings(back); });
  $$('[data-tog]', el).forEach((b) => b.onclick = () => { const k = b.dataset.tog; s[k] = !s[k]; b.classList.toggle('on', s[k]); b.setAttribute('aria-checked', s[k]); Sound.sfx('ui'); save(); if (G.world) G.world.low = s.particles === 'low'; });
  $('#set-music', el).oninput = (e) => { s.music = +e.target.value; save(); };
  $('#set-sfx', el).oninput = (e) => { s.sfx = +e.target.value; save(); Sound.sfx('ui', { gap: 120 }); };
  $$('[data-bind]', el).forEach((b) => b.onclick = () => {
    b.classList.add('wait'); b.textContent = '按下新键…';
    Input.startRebind(b.dataset.bind, (binds) => { s.binds = JSON.parse(JSON.stringify(binds)); save(); showSettings(back); });
  });
  $('#set-resetkeys', el).onclick = () => { s.binds = null; save(); showSettings(back); };
  let armed = false;
  $('#set-wipe', el).onclick = () => {
    if (!armed) { armed = true; $('#set-wipe', el).textContent = '确认清除（不可恢复）'; return; }
    Store.wipe(); G.meta = freshMeta(); Tele.bind(G.meta); G.run = null; G.world = null; applySettings(); persist(); toast('存档已清除'); showTitle();
  };
}

/* ---------------------------------------------------------------- RECORDS & 测试指标 ---------------------------------------------------------------- */
function showRecords(back) {
  const m = G.meta, R = m.records, c = m.telemetry.counts, f = m.telemetry.firsts;
  const ratio = (a, b) => (b ? Math.round(((c[a] || 0) / b) * 100) : null);
  const rows = [
    ['30 秒内完成移动教学', f.tut_move_time !== undefined ? `${f.tut_move_time} 秒` : '—', f.tut_move_time !== undefined ? f.tut_move_time <= 30 : null, '90% 以上'],
    ['教学完成率', ratio('tutorial_complete', c.tutorial_start), null, '75% 以上', 75],
    ['首个普通房间完成率', ratio('first_normal_clear', c.first_normal_enter), null, '65% 以上', 65],
    ['第一次梦境演奏使用率', ratio('run_with_cast', (c.run_completed || 0) + (c.run_failed || 0)), null, '80% 以上', 80],
    ['失败后重新开始率', ratio('restart_after_fail', c.run_failed), null, '25% 以上', 25],
    ['首次 Boss 到达率', ratio('boss_reached', c.run_started), null, '35% 以上', 35],
    ['首次 Boss 击败率', ratio('boss_defeated', c.run_started), null, '15%—25%', 15],
  ];
  const events = ['title_start_click', 'weapon_selected', 'performance_selected', 'room_enter', 'room_clear', 'room_fail', 'card_selected', 'bullet_cut', 'bullet_parry', 'perfect_dodge', 'resonance_full', 'performance_cast', 'boss_phase_change', 'boss_defeated', 'run_abandoned', 'run_completed'];
  const el = showScreen('records', `${backBtn()}
    <div class="screen-title"><h2>记录</h2><p>数据只来自这台设备${R.assistedClear ? ' · 含辅助通关' : ''}</p></div>
    <div class="set-wrap">
      <div class="panel set-sec"><h3>航海记录</h3>
        <table class="metrics"><tbody>
          <tr><th>出航次数</th><td class="num">${R.runs}</td></tr><tr><th>通关失眠之海</th><td class="num">${R.clears}</td></tr><tr><th>熄灭次数</th><td class="num">${R.deaths}</td></tr>
          <tr><th>最高连击</th><td class="num">${R.bestCombo}</td></tr><tr><th>最快击败失控闹钟</th><td class="num">${R.bestBossTime ? fmtTime(R.bestBossTime) : '—'}</td></tr>
          <tr><th>挑战房间最佳成绩</th><td class="num">${R.challengeBest || '—'}</td></tr><tr><th>累计完美弹反</th><td class="num">${R.perfectParries}</td></tr>
        </tbody></table></div>
      <div class="panel set-sec"><h3>测试指标（对照首轮目标）</h3>
        <table class="metrics"><thead><tr><th>指标</th><th>本机</th><th>目标</th></tr></thead><tbody>
          ${rows.map(([n, v, okFlag, target, th]) => { const val = typeof v === 'number' ? `${v}%` : v === null ? '—' : v; const ok = okFlag !== null && okFlag !== undefined ? okFlag : typeof v === 'number' ? v >= th : null; return `<tr><td>${n}</td><td class="num ${ok === null ? '' : ok ? 'ok' : 'bad'}">${val}</td><td>${target}</td></tr>`; }).join('')}
        </tbody></table></div>
      <div class="panel set-sec"><h3>埋点计数</h3>
        <table class="metrics"><tbody>${events.map((e) => `<tr><td>${e}</td><td class="num">${c[e] || 0}</td></tr>`).join('')}</tbody></table>
        <button class="btn" id="rec-export" type="button" hidden>${icon('i-trophy')} 导出测试数据（JSON）</button>
      </div>
    </div>`, { bg: 'hub', back, label: '记录' });
  const dl = G.cap.downloads, btn = $('#rec-export', el);
  if (dl) {
    btn.hidden = false;
    btn.onclick = async () => {
      const data = JSON.stringify({ game: '梦潮回声航线', exportedAt: new Date().toISOString(), records: m.records, telemetry: m.telemetry, recent: Tele.recent }, null, 2);
      try { await dl.save({ filename: 'dreamtide-playtest.json', data }); toast('已导出'); }
      catch (e) { const code = e && e.code; if (code === 'declined') toast('已取消导出'); else if (code === 'rate_limited') toast('稍等一下再试'); else { btn.hidden = true; toast('这里暂时不能导出文件'); } }
    };
  }
}

/* ---------------------------------------------------------------- UNLOCKS (梦灯工坊) ---------------------------------------------------------------- */
function showUnlocks(back) {
  const m = G.meta;
  const row = (kind, obj) => {
    const own = m.unlocked[kind].includes(obj.id);
    return `<div class="own-item"><svg class="ic"><use href="#${obj.icon}"/></svg><div><b>${obj.name}</b> ${own ? '<span class="chip cyan">已解锁</span>' : `<span class="chip dust">${obj.unlock.cost} 梦尘</span>`}
      <p>${kind === 'weapons' ? obj.line : obj.main + '；' + obj.side}</p>${own ? '' : `<button class="btn" data-ul="${kind}:${obj.id}" type="button" ${m.dust < obj.unlock.cost ? 'disabled' : ''}>解锁</button>`}</div></div>`;
  };
  const el = showScreen('unlocks', `${backBtn()}
    <div class="screen-title"><h2>解锁内容</h2><p>永久成长只打开新的选择，不堆基础攻击力。现有梦尘 <b class="num" style="color:#e3d2ff">${Math.floor(m.dust)}</b></p></div>
    <div class="set-wrap">
      <div class="panel set-sec"><h3>武器</h3>${Object.values(WEAPONS).map((w) => row('weapons', w)).join('')}</div>
      <div class="panel set-sec"><h3>梦境演奏</h3>${Object.values(PERFS).map((p) => row('perfs', p)).join('')}</div>
      <div class="panel set-sec"><h3>难度与区域</h3>
        <div class="own-item"><svg class="ic"><use href="#i-elite"/></svg><div><b>梦魇难度</b> ${m.unlocked.nightmare ? '<span class="chip cyan">已解锁</span>' : '<span class="chip">通关标准难度后解锁</span>'}<p>${DIFFICULTY.nightmare.desc}</p></div></div>
        ${REGIONS.slice(1).map((r) => `<div class="own-item"><svg class="ic" style="fill:var(--mute)"><use href="#i-map"/></svg><div><b>${r.name}</b> <span class="chip">尚未点亮</span><p>后续章节。</p></div></div>`).join('')}
      </div>
    </div>`, { bg: 'hub', back, label: '解锁内容' });
  $$('[data-ul]', el).forEach((b) => b.onclick = () => { const [kind, id] = b.dataset.ul.split(':'); const obj = kind === 'weapons' ? WEAPONS[id] : PERFS[id]; if (tryUnlock(kind, id, obj.unlock.cost)) showUnlocks(back); });
}

/* ---------------------------------------------------------------- HUD ---------------------------------------------------------------- */
function buildHud() {
  const w = G.world, run = w.run, hud = $('#hud');
  const W = WEAPONS[w.weapon.id], P = PERFS[w.perfId];
  hud.innerHTML = `
    <div class="hud-tl">
      <div class="bar-line">${icon('i-heart', 'ic').replace('class="ic"', 'class="ic" style="fill:var(--coral)"')}<div class="bar hp"><i class="ghost" id="h-hpg"></i><i id="h-hpf"></i></div><span class="num" id="h-hp"></span></div>
      <div class="bar-line">${icon('i-note', 'ic').replace('class="ic"', 'class="ic" style="fill:var(--lamp)"')}<div class="bar res" id="h-resbar"><i id="h-resf"></i><span class="over" id="h-reso"></span></div><span class="num" id="h-res"></span></div>
      <div class="row"><span class="hud-flag" id="h-full" hidden>共振满溢 · 按「奏」</span><span class="combo" id="h-combo"></span></div>
      <div class="hud-icons" id="h-icons">${run.cards.map((k) => `<button class="hb" data-hcard="${k.id}" type="button" aria-label="${CARDS[k.id].name}">${icon(CARDS[k.id].icon)}${k.stacks > 1 ? `<b>${k.stacks}</b>` : ''}</button>`).join('')}${run.relics.map((id) => `<button class="hb relic" data-hrelic="${id}" type="button" aria-label="${RELICS[id].name}">${icon(RELICS[id].icon)}</button>`).join('')}</div>
    </div>
    <div class="hud-tc" id="h-tc"><div class="hud-wave" id="h-wave"></div><div class="hud-obj" id="h-obj"></div></div>
    <div class="bossbar" id="h-boss" hidden><div class="bname"><span>失控闹钟</span><small id="h-bphase"></small></div><div class="bar boss" id="h-bbar"><i id="h-bf"></i><span class="tick" style="left:70%"></span><span class="tick" style="left:35%"></span><span class="shield" id="h-bs"></span></div></div>
    <div class="hud-tr"><button class="pause-btn hb" id="h-pause" type="button" aria-label="暂停">${icon('i-pause')}</button></div>
    <div class="hud-bl" id="h-bl"><span class="wpn">${icon(W.icon)}${W.name}</span><span class="dashpips" id="h-dash" aria-label="闪避充能"></span><span class="wpn">${icon(P.icon)}${P.name}</span></div>
    <div class="hud-br" id="h-br"></div>
    <div class="tut" id="h-tut" hidden></div>
    <button class="btn tut-skip hb" id="h-skip" type="button" hidden>跳过教学</button>
    <div class="newtip" id="h-tip" hidden></div>`;
  hud.hidden = false; hud.classList.toggle('touchmode', Input.device === 'touch');
  $('#h-pause').onclick = () => pauseGame();
  $$('[data-hcard],[data-hrelic]', hud).forEach((b) => b.onclick = () => pauseGame());
  if (w.mode === 'tutorial') { const sk = $('#h-skip'); sk.hidden = false; sk.onclick = () => { G.world = null; finishTutorial(); }; }
  G.hudRefs = {
    hpf: $('#h-hpf'), hpg: $('#h-hpg'), hp: $('#h-hp'), resf: $('#h-resf'), reso: $('#h-reso'), res: $('#h-res'), resbar: $('#h-resbar'), full: $('#h-full'), combo: $('#h-combo'),
    wave: $('#h-wave'), obj: $('#h-obj'), tc: $('#h-tc'), boss: $('#h-boss'), bphase: $('#h-bphase'), bbar: $('#h-bbar'), bf: $('#h-bf'), bs: $('#h-bs'), dash: $('#h-dash'), br: $('#h-br'), tut: $('#h-tut'), tip: $('#h-tip'), bl: $('#h-bl'),
  };
  G.hudLast = {};
  buildTouch();
  updateHud(true);
}
function hideHud(clearTouch = true) {
  const hud = $('#hud'); hud.hidden = true; hud.innerHTML = ''; G.hudRefs = null;
  $('#touch').hidden = true;
}
function buildTouch() {
  const t = $('#touch');
  if (!G.touchBound) {
    t.innerHTML = `<div class="zone" aria-hidden="true"></div><div class="aimzone" aria-hidden="true"></div><div class="joy idle"><i></i></div>
      <div class="tbtns"><button class="tbtn cut" data-act="cut" type="button" aria-label="切 / 弹反"><span>切</span></button>
      <button class="tbtn dash" data-act="dash" type="button" aria-label="闪避"><span>闪</span><small>2</small></button>
      <button class="tbtn play" data-act="perform" type="button" aria-label="梦境演奏"><span>奏</span></button></div>`;
    Input.bindTouch(t); G.touchBound = true;
  }
  t.hidden = Input.device !== 'touch';
  if (!t.hidden) Input.resetJoy();
}
function setText(el, key, v) { if (G.hudLast[key] !== v) { G.hudLast[key] = v; el.textContent = v; } }
function setStyle(el, key, prop, v) { if (G.hudLast[key] !== v) { G.hudLast[key] = v; el.style[prop] = v; } }
function updateHud(force) {
  const w = G.world, R = G.hudRefs; if (!w || !R) return;
  if (force) G.hudLast = {};
  const h = w.hud();
  setStyle(R.hpf, 'hpf', 'width', `${(h.hp / h.maxHp) * 100}%`); setStyle(R.hpg, 'hpg', 'width', `${(h.hp / h.maxHp) * 100}%`);
  setText(R.hp, 'hp', `${Math.ceil(h.hp)}/${h.maxHp}`);
  setStyle(R.resf, 'resf', 'width', `${Math.min(100, h.res)}%`);
  setStyle(R.reso, 'reso', 'width', h.res > 100 ? `${((h.res - 100) / 100) * 100}%` : '0%'); setStyle(R.reso, 'resoL', 'left', '100%');
  if (h.res > 100) { setStyle(R.reso, 'resoL', 'left', `${(100 / h.resCap) * 100}%`); setStyle(R.resf, 'resf', 'width', `${(100 / h.resCap) * 100}%`); setStyle(R.reso, 'reso', 'width', `${((h.res - 100) / h.resCap) * 100}%`); }
  setText(R.res, 'res', `${Math.floor(h.res)}${h.resCap > 100 ? '/' + h.resCap : ''}`);
  const full = h.full && !h.perf;
  if (G.hudLast.full !== full) { G.hudLast.full = full; R.resbar.classList.toggle('full', full); R.full.hidden = !full; }
  setText(R.combo, 'combo', h.combo >= 3 ? `连击 ${h.combo}` : '');
  // wave / objective / boss
  if (h.boss) {
    if (G.hudLast.bossOn !== true) { G.hudLast.bossOn = true; R.boss.hidden = false; R.tc.hidden = true; }
    setText(R.bphase, 'bph', h.boss.phaseName + (h.boss.weak ? ' · 弱点暴露' : ''));
    setStyle(R.bf, 'bf', 'width', `${(h.boss.hp / h.boss.maxHp) * 100}%`);
    setStyle(R.bs, 'bs', 'width', h.boss.shield > 0 ? `${(h.boss.shield / h.boss.shieldMax) * 100}%` : '0%');
    const pc = 'bar boss p' + h.boss.phase; if (G.hudLast.bcls !== pc) { G.hudLast.bcls = pc; R.bbar.className = pc; }
  } else {
    if (G.hudLast.bossOn !== false) { G.hudLast.bossOn = false; R.boss.hidden = true; R.tc.hidden = w.mode === 'tutorial'; }
    const waveTxt = h.timer !== undefined ? fmtTime(h.timer) : h.wave ? `第 ${h.wave} / ${h.waves} 波` : '';
    setText(R.wave, 'wave', waveTxt);
    setText(R.obj, 'obj', (h.obj || '') + (h.core !== undefined ? ` · 核心 ${Math.ceil(h.core)}%` : '') + (h.failed ? ' · 挑战已失败' : ''));
    if (G.hudLast.waveVis !== !!waveTxt) { G.hudLast.waveVis = !!waveTxt; R.wave.hidden = !waveTxt; }
  }
  // dash pips
  const dk = `${h.dash}/${h.dashMax}/${Math.round(h.dashRe * 20)}`;
  if (G.hudLast.dash !== dk) {
    G.hudLast.dash = dk;
    let s = ''; for (let i = 0; i < h.dashMax; i++) s += i < h.dash ? '<i class="on"></i>' : i === h.dash ? `<i><span class="fill" style="height:${Math.round(h.dashRe * 100)}%"></span></i>` : '<i></i>';
    R.dash.innerHTML = s;
  }
  // key hints (desktop / pad) and touch button states
  const dev = Input.device;
  const hk = `${dev}|${h.hint}|${full}`;
  if (G.hudLast.br !== hk) {
    G.hudLast.br = hk;
    if (dev === 'touch') R.br.innerHTML = '';
    else R.br.innerHTML = `<span class="hint ${h.hint === 'parry' ? 'hot' : h.hint === 'cut' ? 'cyanhot' : ''}"><span class="kbd">${Input.hintFor('cut')}</span>${h.hint === 'parry' ? '弹反！' : '切'}</span>
      <span class="hint"><span class="kbd">${Input.hintFor('dash')}</span>闪</span><span class="hint ${full ? 'hot' : ''}"><span class="kbd">${Input.hintFor('perform')}</span>奏</span>
      <span class="hint"><span class="kbd">${Input.hintFor('pause')}</span>暂停</span>`;
    const tl = $('.hud-tl');
    if (dev === 'touch' && R.bl.parentElement !== tl) tl.appendChild(R.bl);
    else if (dev !== 'touch' && R.bl.parentElement === tl) $('#hud').appendChild(R.bl);
    const t = $('#touch');
    const wantTouch = dev === 'touch';
    if (t.hidden === wantTouch) { t.hidden = !wantTouch; if (wantTouch) Input.resetJoy(); }
  }
  if (dev === 'touch') {
    const cut = $('#touch .tbtn.cut'), dash = $('#touch .tbtn.dash'), play = $('#touch .tbtn.play');
    const ck = h.hint || 'none';
    if (G.hudLast.tcut !== ck) { G.hudLast.tcut = ck; cut.classList.toggle('hot-cut', ck === 'cut'); cut.classList.toggle('hot-parry', ck === 'parry'); cut.firstElementChild.textContent = ck === 'parry' ? '反' : '切'; }
    setText(dash.lastElementChild, 'tdash', String(h.dash));
    if (G.hudLast.tdashOff !== (h.dash === 0)) { G.hudLast.tdashOff = h.dash === 0; dash.classList.toggle('off', h.dash === 0); }
    if (G.hudLast.tfull !== full) { G.hudLast.tfull = full; play.classList.toggle('full', full); play.classList.toggle('off', !full && !h.perf); }
  }
}
function drainWorldEvents() {
  const w = G.world; if (!w) return;
  while (w.events.length) {
    const e = w.events.shift();
    if (e.type === 'banner') banner(e.title, e.sub, e.dur || 1.6);
    else if (e.type === 'flag') banner('', e.text, e.dur || 1);
    else if (e.type === 'toast') toast(e.text);
    else if (e.type === 'wave') { if (e.n > 1) banner(`第 ${e.n} 波`, e.n === e.of ? '最后一波' : '', 0.9); }
    else if (e.type === 'full') { if (G.hudRefs) { G.hudLast.full = null; } }
    else if (e.type === 'perf') { banner(PERFS[e.id].name, PERFS[e.id].main, 1.2); if (G.run) G.run.castOnce = true; }
    else if (e.type === 'phase') banner(e.name, e.n === 2 ? '攻击越来越快，安全区在缩小' : '弹幕会逆行，消失的危险会重演', 1.8);
    else if (e.type === 'tip') showNewTip(e.bullet);
    else if (e.type === 'tut') showTut(e);
  }
}
function showNewTip(type) {
  const R = G.hudRefs; if (!R) return;
  const b = BULLETS[type];
  R.tip.innerHTML = `<canvas width="76" height="76"></canvas><div><b style="color:${b.color}">新弹幕：${b.name}</b><div>${b.op} · ${b.reward}</div></div>`;
  paintBulletIcon($('canvas', R.tip), type, G.meta.settings.colorblind);
  R.tip.hidden = false; clearTimeout(showNewTip._t); showNewTip._t = setTimeout(() => { if (G.hudRefs) G.hudRefs.tip.hidden = true; }, 4200);
}
function showTut(e) {
  const R = G.hudRefs; if (!R) return;
  R.tut.hidden = false;
  R.tut.innerHTML = `${e.step !== undefined ? `<span class="label">教学 ${e.step + 1} / 6</span><br>` : ''}${esc(e.text)}${e.sub ? `<small>${esc(e.sub)}</small>` : ''}`;
}

Tele.add = function (name, n) { if (!this.meta || !n) return; const c = this.meta.telemetry.counts; c[name] = (c[name] || 0) + n; };
