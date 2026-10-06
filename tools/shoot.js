// 真实画面截图（商店页 / L1 预测 / 打磨对比）：无头 Chrome 打开游戏，自动驾驶打真实关卡，在指定时刻截 1920×1080。
// 用法：node tools/shoot.js <输出目录> [--chrome 路径] [--moments]
//   --moments：改拍“标志时刻”的连续帧（升级仪式、宝箱、Boss 入场 / 倒下、精英核心），每个时刻拼成一张 4×N 的接触表 raw/<名字>-sheet.png
//   输出：<目录>/raw/*.png（每个时刻一张）、<目录>/images/01-capsule.png（920×430）、02~06 截图、09-trailer-frames.png（3×3）
//   时刻表在下面 PLAN 里：每一步 = 一个条件（对 World w 求值）+ 最长等待秒数；满足后截一张。
//   Chrome：macOS 默认 /Applications/Google Chrome.app，Windows 默认 Program Files 下的 chrome.exe，或 --chrome / CHROME 环境变量。
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), { spawn } = require('child_process');
const { PILOT_SRC } = require('./sim-env');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--keep')) || path.join(ROOT, '.ai', 'shots'));
const W = 1920, H = 1080;

function chromePath() {
  const c = opt('chrome') || process.env.CHROME;
  if (c) return c;
  const list = process.platform === 'win32'
    ? [path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe')]
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const f = list.find((p) => fs.existsSync(p)); if (!f) throw new Error('找不到 Chrome：用 --chrome 指定'); return f;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname), f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 一个 CDP 连接：send(method, params) → result */
function cdp(wsUrl) {
  return new Promise((ok, bad) => {
    const ws = new WebSocket(wsUrl); let id = 0; const wait = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { const [a, b] = wait.get(d.id); wait.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } };
    ws.onerror = (e) => bad(e); ws.onopen = () => ok({ send: (method, params = {}) => new Promise((a, b) => { const i = ++id; wait.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() });
  });
}

/* 页面里的助手：自动驾驶接管本机飞机（截图时不受伤），按条件快进，截图时可以按住不动 */
const HELPER = PILOT_SRC + `
// 横幅 / 提示本来按真实时间消失；快进时改按游戏时间算，过期的在截图前收掉（否则旧标题挂在每一帧上）
(function () {
  const _b = banner, _t = toast;
  window.banner = function (...a) { __S.bannerAt = G.world ? G.world.t : 0; __S.bannerDur = a[2] === undefined ? 1.6 : a[2]; return _b.apply(this, a); };
  Object.assign(window.banner, _b); banner = window.banner;
  window.toast = function (...a) { const r = _t.apply(this, a), el = $('#toast').lastElementChild; if (el) el.dataset.gt = String((G.world ? G.world.t : 0) + (a[3] || 2200) / 1000); return r; };
  toast = window.toast;
})();
window.__S = {
  hold: false,
  expire() {
    const w = G.world; if (!w) return;
    if (__S.bannerAt !== undefined && w.t - __S.bannerAt > __S.bannerDur) { $('#banner').innerHTML = ''; banner._until = 0; __S.bannerAt = undefined; }
    for (const el of [...$('#toast').children]) if (el.dataset.gt && w.t > +el.dataset.gt) el.remove();
    const tc = G.hudRefs && G.hudRefs.tc; if (tc && tc.classList.contains('done') && __S.doneAt !== undefined && w.t - __S.doneAt > 1.3) tc.classList.remove('done');
    if (tc && tc.classList.contains('done') && __S.doneAt === undefined) __S.doneAt = w.t; if (tc && !tc.classList.contains('done')) __S.doneAt = undefined;
  },
  attach() {
    const w = G.world; if (!w || w.__wrapped) return; w.__wrapped = true;
    const st = w.step.bind(w); w.step = (dt) => { if (__S.freeze && !__S.manual) return; if (!__S.hold) pilot(w); st(dt); }; // freeze：连拍按游戏时间走，页面自己的循环只画不走
    w.hurtPlayer = function () {};
  },
  until(src, maxSec) {
    const f = new Function('w', 'return (' + src + ')'); __S.attach(); const w = G.world; let i = 0; const n = maxSec * 120; __S.manual = true;
    // 快进时横幅按真实时间排队会互相挡住：每次取事件前放开，屏幕上留下的是此刻该有的那条
    while (i < n && !w.done && !f(w)) { w.step(1 / 120); i++; if (i % 4 === 0) { banner._until = 0; drainWorldEvents(); __S.expire(); } }
    __S.manual = false; banner._until = 0; drainWorldEvents(); __S.expire(); return { ok: !!f(w), secs: Math.round(i / 12) / 10, runT: Math.round(w.runT) };
  },
};
`;

/* 时刻表：截图（02~06）和预告片 9 帧都从这里挑 */
const PLAN = [
  { name: 'title', screen: 'title' },
  { name: 'keyart', screen: 'keyart' }, // 商店主图：游戏自己的画法拼的关键美术
  // 1-1 梦灯海湾：开场、梦灯屋转盘、二选一、风车塔推一排、带队精英
  { name: 'open', start: '1-1', until: 'w.runT > 5', max: 10 },
  { name: 'ritual-roll', until: "w.ritual && w.ritual.st === 'roll'", max: 60 },
  { name: 'ritual-choose', until: "w.ritual && w.ritual.st === 'choose'", max: 10, hold: true },
  { name: 'wind', until: "w.mapObjs.some((o) => o.kind === 'wind' && o.state === 'blow' && o.blowT > 0.5)", max: 120 },
  { name: 'hand', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.spawnLurk(LURK_THEMES.bay.kinds[0], false)", until: "w.lurks && w.lurks.some((L) => L.kind === 'hand' && ((L.st === 'reach' && L.t > 0.3) || L.st === 'grab'))", max: 30, clean: true, wait: 60 }, // 地图出手：海里伸出来的手（真实机制，在这一刻触发）
  { name: 'elite', until: "w.goal && w.goal.kind === 'cmdr' && w.enemies.some((e) => e.alive && e.type === 'cmdr' && e.x < w.W - 60 && e.rally > 0)", max: 150 },
  // 1-2 纸船灯河：断桥灯环、厚甲编队、大招、队长
  { name: 'bridge', start: '1-2', until: "w.mapObjs.some((o) => o.kind === 'bridge' && (o.lit.filter(Boolean).length >= 2 || o.state === 'build'))", max: 120 },
  { name: 'pack', until: "w.goal && w.goal.kind === 'pack' && w.enemies.filter((e) => e.alive && e.type === 'armor' && e.x < w.W).length >= 3", max: 120 },
  { name: 'burst', setup: 'G.world.pilotNoBurst = false; G.world.me.stock = Math.max(1, G.world.me.stock); G.world.setInput(0, { burst: true })', until: 'w.bursting && w.bursting.t > 0.5', max: 6 },
  { name: 'captain', setup: 'G.world.pilotNoBurst = true', until: 'w.boss && w.bossIntroT <= 0 && w.boss.t > 5 && w.bullets.count() > 12', max: 240 },
  // 1-3 失眠钟塔：巨鲸、Boss、通关
  { name: 'giant', start: '1-3', until: "w.mapObjs.some((o) => o.kind === 'giant' && o.state === 'gulp' && o.stT > 0.35)", max: 160 },
  { name: 'swell', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.swell()", until: "w.enemies.filter((e) => e.alive && e.swell && e.x < w.W * 0.95).length >= 6 || (!w.warns.some((x) => x.kind === 'swell') && !w.enemies.some((e) => e.alive && e.swell) && !w.focusBusy() && w.D.st === 'goal' && !w.mapObjs.some((o) => o.kind === 'giant' && o.state === 'gulp') && (w.swell(), false))", max: 30, clean: true, wait: 60 }, // 鱼群潮：满屏割草（这张清掉临时横幅，只看玩法）；被巨鲸吞掉或换目标清掉了就再叫一次
  { name: 'boss-late', until: 'w.boss && w.boss.phase >= 2 && w.bullets.count() > 20', max: 240 },
  { name: 'victory', until: "w.state === 'victory'", max: 200 },
  { name: 'result', wait: 3500 },
  { name: 'hub-ladder', screen: 'eval', js: "clearScreens(); const P = G.meta.progress; P.ladder = 3; P.ladderSel = 2; P.selected = '1-3'; showHub()", wait: 1200 }, // 家园出击区：梦魇级选择
];
const SHOTS = ['hand', 'ritual-choose', 'bridge', 'swell', 'boss-late']; // 02~06：地图出手、升级、断桥、割草、Boss
/* 标志时刻：到点后按真实时间连拍（游戏照常跑），看动画而不是一张静帧 */
const MOMENTS = [
  { name: 'ritual', start: '1-1', until: "w.ritual && w.ritual.st === 'trigger'", max: 60, seq: { n: 16, every: 260 } },
  { name: 'lurk-hand', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.spawnLurk(LURK_THEMES.bay.kinds[0], false)", until: "w.lurks && w.lurks.some((L) => L.kind === 'hand')", max: 4, seq: { n: 12, dt: 0.3 } },
  { name: 'lurk-wake', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.spawnLurk(LURK_THEMES.bay.kinds[1], false)", until: "w.lurks && w.lurks.some((L) => L.kind === 'wake')", max: 4, seq: { n: 12, dt: 0.25 } },
  { name: 'lurk-break', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.spawnLurk(LURK_THEMES.bay.kinds[0], false); __S.until('w.lurks.some((L) => L.kind === \\'hand\\' && L.e && L.e.alive)', 4)", until: 'true', max: 1, seq: { n: 10, dt: 0.12, each: "const L = G.world.lurks.find((q) => q.kind === 'hand' && q.e && q.e.alive); if (L) G.world.damageEnemy(L.e, L.e.maxHp * 0.2)" } }, // 打碎地图伸出来的手：裂纹、血条、原地弹奖励（模拟连续命中）
  { name: 'link', until: "w.ritual && w.ritual.st === 'choose' && w.ritual.gates.some((G) => G.opt.kind === 'link')", max: 200, seq: { n: 14, every: 200 } },
  { name: 'core', until: "w.props && w.props.some((q) => q.kind === 'core')", max: 200, seq: { n: 16, every: 300 } },
  { name: 'chest', until: "w.pickups.some((k) => k.kind === 'chest' && k.near > 0.2)", max: 20, seq: { n: 8, every: 120 } },
  { name: 'lurk-close', start: '1-2', until: "w.lurks && w.lurks.some((L) => L.kind === 'close' && L.st === 'omen')", max: 200, seq: { n: 12, dt: 0.75 } },
  { name: 'boss-rage', start: '1-1', setup: "G.world.beginBeat(G.world.plan.length - 1); __S.until('w.phase === \\'boss\\' && w.boss && w.bossIntroT <= 0', 30); G.world.boss.fightT = BUILD_CHECK.rage.at[G.world.stageId] - 7", until: 'w.boss && w.boss.fightT > BUILD_CHECK.rage.at[w.stageId] - 6', max: 5, seq: { n: 10, dt: 0.9 } }, // 构筑考验：自愈的绿光、失控倒计时、失控后的红光
  { name: 'boss-in', start: '1-3', setup: 'G.world.beginBeat(G.world.plan.length - 1)', until: 'w.phase === "boss" && w.bossIntroT > 2.4', max: 20, seq: { n: 12, every: 280 } },
  { name: 'boss-down', setup: 'const b = G.world.boss; if (b) { b.phase = 3; b.nextPhase = 3; b.transT = 0; b.shield = 0; b.hp = 25; }', until: 'w.boss && w.boss.dying > 0', max: 60, seq: { n: 16, every: 260 } },
];
const TRAILER = ['open', 'hand', 'ritual-roll', 'bridge', 'swell', 'burst', 'giant', 'boss-late', 'victory']; // 3×3
const MOMENTS_MODE = args.includes('--moments'), ONLY = opt('only'); // --only a,b：只拍这几个时刻（同一局里按顺序走）

(async () => {
  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
  const server = await serve(), port = server.address().port, dbg = 9300 + Math.floor(Math.random() * 400);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamtide-shoot-'));
  const chrome = spawn(chromePath(), ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  try {
    let list = null;
    for (let i = 0; i < 60 && !list; i++) { await sleep(250); try { list = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); } catch (e) { list = null; } }
    const tgt = list.find((t) => t.type === 'page');
    page = await cdp(tgt.webSocketDebuggerUrl);
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Page.enable'); await page.send('Runtime.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    const ev = async (expr) => { const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; };
    for (let i = 0; i < 80; i++) { await sleep(250); try { if (await ev("typeof G !== 'undefined' && !!G.meta && document.readyState === 'complete'")) break; } catch (e) { /* 还在加载 */ } }
    await ev(HELPER + ';true');
    const shot = async (name) => { const r = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'raw', name + '.png'), Buffer.from(r.data, 'base64')); };
    const log = [];
    const SEL = !MOMENTS_MODE ? PLAN : !ONLY ? MOMENTS : MOMENTS.filter((m) => ONLY.split(',').includes(m.name)).map((m, i) => (i === 0 && !m.start ? Object.assign({}, m, { start: '1-1' }) : m));
    for (const s of SEL) {
      if (s.screen === 'title') { await sleep(1500); await shot(s.name); log.push({ name: s.name, ok: true }); continue; }
      if (s.screen === 'eval') { await ev(s.js + '; true'); await sleep(s.wait || 900); await shot(s.name); log.push({ name: s.name, ok: true }); continue; } // 任意界面：先执行 js 再截
      if (s.screen === 'keyart') { await ev("clearScreens(); G.bg = 'keyart'; true"); await sleep(900); await shot(s.name); log.push({ name: s.name, ok: true }); continue; }
      if (s.start) {
        await ev(`(() => { const m = G.meta; m.seenTitle = true; m.firstRunDone = true; m.tutorialDone = true; m.shared.level = 16; m.progress.cleared['1-1'] = true; m.progress.cleared['1-2'] = true; startRun('${s.start}'); return true; })()`);
        await sleep(400); await ev('__S.attach(); G.world.pilotNoBurst = true; true'); // 像玩家一样攒着大招，只在“大招”那一刻放
      }
      if (s.setup) await ev(s.setup);
      let r = { ok: true };
      if (s.until) r = await ev(`__S.until(${JSON.stringify(s.until)}, ${s.max})`);
      if (s.hold) await ev('__S.hold = true; true');
      if (s.clean) await ev("banner._until = 0; $('#banner').innerHTML = ''; $('#toast').innerHTML = ''; true");
      if (s.seq) { // 连拍：默认游戏按真实时间跑，每隔 every 毫秒一张；给了 dt 就冻住游戏，每张之间快进 dt 秒游戏时间（短先兆也能拍到每一步）
        if (s.seq.dt) await ev('__S.freeze = true; true');
        for (let k = 0; k < s.seq.n; k++) { await sleep(120); await shot(`${s.name}-${String(k + 1).padStart(2, '0')}`); if (s.seq.each) await ev('{ ' + s.seq.each + ' } true'); if (s.seq.dt) await ev(`__S.until('false', ${s.seq.dt})`); else await sleep(s.seq.every); }
        if (s.seq.dt) await ev('__S.freeze = false; true');
        log.push(Object.assign({ name: s.name }, r)); console.log(s.name, JSON.stringify(r)); continue;
      }
      await sleep(s.wait || 180);
      await shot(s.name);
      if (s.hold) await ev('__S.hold = false; true');
      log.push(Object.assign({ name: s.name }, r));
      console.log(s.name, JSON.stringify(r));
    }
    fs.writeFileSync(path.join(OUT, 'raw', 'log.json'), JSON.stringify(log, null, 1));
    // 合成：在同一个页面的画布里拼（不依赖图像库），导出 PNG
    const b64 = (n) => fs.readFileSync(path.join(OUT, 'raw', n + '.png')).toString('base64');
    const compose = async (spec) => {
      const url = await ev(`(async () => {
        const S = ${JSON.stringify(spec)}, c = document.createElement('canvas'); c.width = S.w; c.height = S.h; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, S.w, S.h);
        for (const it of S.items) { const im = new Image(); im.src = 'data:image/png;base64,' + it.b64; await im.decode(); g.imageSmoothingQuality = 'high'; g.drawImage(im, it.sx, it.sy, it.sw, it.sh, it.x, it.y, it.w, it.h); }
        return c.toDataURL('image/png'); })()`);
      return Buffer.from(url.split(',')[1], 'base64');
    };
    if (MOMENTS_MODE) { // 每个时刻一张接触表：4 列，每格 480×270
      for (const s of MOMENTS) {
        const files = Array.from({ length: s.seq.n }, (_, k) => `${s.name}-${String(k + 1).padStart(2, '0')}`).filter((n) => fs.existsSync(path.join(OUT, 'raw', n + '.png')));
        if (!files.length) continue;
        const rows = Math.ceil(files.length / 4), cw = 480, chh = 270;
        fs.writeFileSync(path.join(OUT, 'raw', `${s.name}-sheet.png`), await compose({ w: cw * 4, h: chh * rows, items: files.map((n, i) => ({ b64: b64(n), sx: 0, sy: 0, sw: W, sh: H, x: (i % 4) * cw, y: Math.floor(i / 4) * chh, w: cw, h: chh })) }));
      }
      console.log('连拍完成', OUT); return;
    }
    // 商店主图 920×430：标题画面按 2.14:1 居中裁
    const ch = Math.round(W * 430 / 920);
    fs.writeFileSync(path.join(OUT, 'images', '01-capsule.png'), await compose({ w: 920, h: 430, items: [{ b64: b64(fs.existsSync(path.join(OUT, 'raw', 'keyart.png')) ? 'keyart' : 'title'), sx: 0, sy: Math.round((H - ch) / 2), sw: W, sh: ch, x: 0, y: 0, w: 920, h: 430 }] }));
    SHOTS.forEach((n, i) => fs.copyFileSync(path.join(OUT, 'raw', n + '.png'), path.join(OUT, 'images', `0${i + 2}-${n}.png`)));
    fs.writeFileSync(path.join(OUT, 'images', '09-trailer-frames.png'), await compose({ w: W, h: H, items: TRAILER.map((n, i) => ({ b64: b64(n), sx: 0, sy: 0, sw: W, sh: H, x: (i % 3) * W / 3, y: Math.floor(i / 3) * H / 3, w: W / 3, h: H / 3 })) }));
    const errs = await ev('(window.__errs || []).length');
    console.log('截图完成', OUT, '页面错误', errs);
  } finally {
    if (page) page.close();
    chrome.kill(); server.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* Chrome 还没完全退出 */ }
  }
})().catch((e) => { console.error('截图失败', e && e.stack || e); process.exitCode = 1; });
