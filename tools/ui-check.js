// 死按钮检查（金牌制作人 lessons UT4；用户 2026-10-07：「点完之后没有效果的按钮，都不应该处于点击状态…操作之后一定要有反馈结果」）。
// 无头 Chrome 打开游戏，逐个界面按每一个看得见的按钮（真实的鼠标点击）：
//   - 死按钮：按下后 0.6 秒内画面上什么都没变（界面、文字、按钮状态、提示条、横幅、暂停 / 大招状态）。禁用的按钮按下也要说明原因。
//   - 被盖住：按钮看得见，可按钮中心点到的是别的东西（面板 / 透明层盖在上面），玩家按了没反应。
//   - 出了屏幕：按钮有一部分在屏幕外，所在的容器又不能滚动，玩家按不到。
//   - 无法判定：没按的时候画面自己也在变（计时、滚数），报出来但不算失败。
// 每按一个按钮前都用这个界面自己的入口函数重新打开，保证每次按之前的状态一样。
// 用法：node tools/ui-check.js [--chrome 路径] [--only 界面名,界面名] [--list]；有死按钮或被盖住时退出码 1
const { openGame, sleep } = require('./chrome-env');
const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('only') ? opt('only').split(',') : null;
const W = 1920, H = 1080, SETTLE = 450, WAIT = 600;

// 页面里的助手：画面指纹、可按的元素、准备一份玩过一阵的存档
const HELPER = `
window.__ui = {
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + s.length; },
  sig(loose) {
    const parts = [G.screen || '', String(!!G.paused), document.body.innerText];
    for (const e of document.querySelectorAll('button,[role=button],input,select,.chip,.panel,.seg,[aria-pressed],[hidden],.pulse')) parts.push(e.className + (e.disabled ? ':d' : '') + (e.hidden ? ':h' : '') + ':' + (e.value || '') + (e.checked ? ':c' : ''));
    const t = document.getElementById('toast'), b = document.getElementById('banner'); parts.push(t ? t.innerHTML : '', b ? b.innerHTML : '');
    const w = G.world; if (w && w.player) parts.push(String(!!w.bursting), String(w.player.stock | 0), String(w.state));
    let s = parts.join('\\u0001'); if (loose) s = s.replace(/[0-9]+/g, '#');
    return this.hash(s);
  },
  // 看得见、能按的元素：按钮、role=button；返回位置、名字、是否被盖住、盖住它的是什么
  list() {
    const out = [], seen = new Set();
    for (const e of document.querySelectorAll('button,[role=button],a[href]')) {
      if (e.closest('[hidden]') || e.closest('#hud') && !G.world) continue;
      let r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      // 收在屏幕外的战斗面板（自己或上层透明 = 飞出去了）：玩家看不见，不算按钮
      let up = e.parentElement, gone = false; while (up && up !== document.body) { if (+getComputedStyle(up).opacity === 0) { gone = true; break; } up = up.parentElement; } if (gone) continue;
      // 在可以滚动的列表里：先滚进来再量；滚不进来（容器不能滚）就是玩家按不到
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) { e.scrollIntoView({ block: 'center', inline: 'center' }); r = e.getBoundingClientRect(); }
      const off = r.top < 0 || r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1;
      if (e.tagName === 'A' && /^https?:/.test(e.getAttribute('href') || '')) continue; // 外部链接：浏览器新开页，不在这里查
      const cx = Math.min(innerWidth - 2, Math.max(1, r.left + r.width / 2)), cy = Math.min(innerHeight - 2, Math.max(1, r.top + r.height / 2));
      const hit = document.elementFromPoint(cx, cy), covered = !!hit && hit !== e && !e.contains(hit);
      const name = (e.id ? '#' + e.id : '') + ' ' + (e.getAttribute('aria-label') || e.innerText || e.title || e.className).replace(/\\s+/g, ' ').trim().slice(0, 40);
      let key = e.id ? '#' + e.id : null;
      if (!key) { const data = [...e.attributes].find((a) => a.name.startsWith('data-')); key = data ? '[' + data.name + '="' + data.value + '"]' : null; }
      if (!key) key = 'text:' + (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30);
      if (seen.has(key)) continue; seen.add(key);
      out.push({ key, name, x: cx, y: cy, covered, off, by: covered ? (hit.id ? '#' + hit.id : hit.className || hit.tagName) : null, disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true' });
    }
    return out;
  },
  find(key) {
    if (key.startsWith('text:')) { const t = key.slice(5); return [...document.querySelectorAll('button,[role=button],a[href]')].find((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30) === t) || null; }
    return document.querySelector(key);
  },
  pos(key) { const e = this.find(key); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  // 玩过一阵的存档：教学做完、1-1 打过、星尘和券够用，家园的建筑都在
  seed() {
    const m = G.meta; m.firstRunDone = true; m.tutorialDone = true; m.stardust = 5000; m.tickets = 5; m.cosTickets = 2;
    m.progress.cleared['1-1'] = true; m.records.runs = Math.max(m.records.runs, 3);
    Home.ensure(m); persist();
  },
  // 战斗里：没有本局就开一局，等它进入战斗
  async run() { if (!G.world || G.world.done) { startRun('1-1'); } for (let i = 0; i < 40 && !(G.world && G.world.state === 'play' && Input.gameActive); i++) await new Promise((r) => setTimeout(r, 100)); },
};
true`;

// 界面：名字 + 打开它的代码（每按一个按钮前都重新执行）
const SCREENS = [
  ['标题', 'showTitle()'],
  ['家园', "G.homeUI.panel = null; G.homeUI.place = null; showHub()"],
  ['机库', 'showPlanes(showHub)'],
  ['天赋', 'showStarMap(G.meta.current, showHub)'],
  ['任务', 'showTasks(showHub)'],
  ['外观', 'showCosmetics(showHub)'],
  ['图鉴', 'showCodex(null, showHub)'],
  ['记录', 'showRecords(showHub)'],
  ['设置', 'showSettings(showHub)'],
  ['操作说明', 'showHelp(showHub)'],
  ['招募', 'showGacha(showHub)'],
  ['联机大厅', 'if (Lobby.code) Lobby.leave(); showMultiplayer(showHub)'],
  // 战斗：暂停键平时收着、大招键有库存才在——像玩家那样先把它们叫出来（鼠标移到右上角 / 按大招键）
  ['战斗', "await __ui.run(); if (G.paused) resumeGame(); hudFly('pause', 30); hudFly('burst', 30)"],
  ['暂停', 'await __ui.run(); showPauseMenu()'],
  ['结算（倒在第 2 关）', "if (!__ui.endRes) { await __ui.run(); const w = G.world; w.cleared.push({ id: '1-1', bossTime: 50, runT: 200 }); w.advanceStage(); w.finish(false); __ui.endRes = G.lastRes; } showEnd(__ui.endRes)"],
];

(async () => {
  const G0 = await openGame({ W, H, chrome: opt('chrome') }), { page, ev } = G0;
  const issues = [], unjudged = [];
  let pressed = 0;
  try {
    await ev(HELPER);
    await ev('__ui.seed(); true');
    // 家园里每个建筑的面板也是一个界面（点场景里的建筑打开）
    await ev("G.homeUI.panel = null; showHub(); true"); await sleep(SETTLE);
    const hots = await ev("[...document.querySelectorAll('[data-hot]')].map((e) => e.dataset.hot)");
    for (const h of hots) SCREENS.splice(2, 0, ['家园面板 ' + h, `G.homeUI.panel = ${JSON.stringify(h)}; G.homeUI.place = null; showHub()`]);
    const click = async (x, y) => {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    // 按之前清掉上一次留下的提示条和横幅：同一句提示还挂着时再按一次看不出变化，会被误判成死按钮
    const open = async (code) => { await ev(`(async () => { ${code}; document.getElementById('toast').innerHTML = ''; document.getElementById('banner').innerHTML = ''; banner._until = 0; })()`); await sleep(SETTLE); };
    for (const [name, code] of SCREENS) {
      if (ONLY && !ONLY.some((o) => name.includes(o))) continue;
      await open(code);
      const list = await ev('__ui.list()');
      if (args.includes('--list')) console.log(name, list.map((b) => b.key).join(' '));
      for (const b of list) {
        if (b.off) { issues.push(`出了屏幕  ${name}  ${b.name}（滚不进来，按不到）`); continue; }
        if (b.covered) { if (!b.disabled) issues.push(`被盖住  ${name}  ${b.name}（盖在上面的是 ${b.by}）`); continue; }
        await open(code);
        const p = await ev(`__ui.pos(${JSON.stringify(b.key)})`); if (!p) continue;
        const s1 = await ev('__ui.sig()'), l1 = await ev('__ui.sig(true)'); await sleep(WAIT);
        const s2 = await ev('__ui.sig()'), l2 = await ev('__ui.sig(true)');
        const strict = s1 === s2, loose = l1 === l2;
        await click(p.x, p.y); pressed++;
        await sleep(WAIT);
        const s3 = await ev('__ui.sig()'), l3 = await ev('__ui.sig(true)');
        if (strict) { if (s3 === s2) issues.push(`死按钮  ${name}  ${b.name}${b.disabled ? '（禁用，按下没说原因）' : ''}`); }
        else if (loose) { if (l3 === l2) issues.push(`死按钮  ${name}  ${b.name}（只有数字在走，按下后别的都没变）`); }
        else unjudged.push(`${name}  ${b.name}`);
      }
    }
    const errs = await ev('(window.__errs || []).map(String)');
    for (const e of errs || []) issues.push('页面错误  ' + e);
  } finally { G0.close(); }
  for (const s of issues) console.log('✗ ' + s);
  if (unjudged.length) console.log(`无法判定（画面自己在变）${unjudged.length} 个：${unjudged.join('；')}`);
  console.log(issues.length ? `按钮检查：按了 ${pressed} 个，${issues.length} 个问题` : `按钮检查通过：按了 ${pressed} 个，每个都有看得见的反应`);
  process.exitCode = issues.length ? 1 : 0;
})().catch((e) => { console.error('按钮检查失败', e && e.stack || e); process.exitCode = 2; });
