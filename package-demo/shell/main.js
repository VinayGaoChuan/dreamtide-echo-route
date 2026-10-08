'use strict';
// 网页游戏桌面外壳：把自包含的网页游戏装进窗口，离线运行，接入 Steam。
// 构建时会在同目录写入 app-config.json 和 game/（游戏本体）。

const { app, BrowserWindow, Menu, dialog, ipcMain, powerSaveBlocker, protocol, screen, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Logger, stamp } = require('./logger');
const { createSteamBridge } = require('./steam-bridge');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-config.json'), 'utf8'));

// 自动试跑只在打包工具提供本次构建的钥匙时开启（包里只存钥匙的哈希），玩家无法借此绕过 Steam 校验
function smokeDirFromEnv() {
  const dir = process.env.MC_SMOKE_OUT;
  const key = process.env.MC_SMOKE_KEY;
  if (!dir || !key || !CONFIG.smokeKeyHash) return '';
  return crypto.createHash('sha256').update(key).digest('hex') === CONFIG.smokeKeyHash ? dir : '';
}
const SMOKE_DIR = smokeDirFromEnv();
// 两个客户端联机测试（tools/lib/duo.mjs）：同样只在有试跑钥匙时生效，连本机假 Steam，不碰真 Steam
const FAKE_STEAM_PORT = SMOKE_DIR ? Number(process.env.MC_FAKE_STEAM) || 0 : 0;
const DUO_ROLE = FAKE_STEAM_PORT ? String(process.env.MC_DUO || '') : '';
if (DUO_ROLE) {
  // 两个窗口会互相遮挡：被挡住的窗口也要照常渲染和计时
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}
const GAME_DIR = path.join(__dirname, 'game');
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://game`;

const runtime = { blocked: [], missing: [], consoleErrors: [], crashes: [], steam: { state: 'off' } };

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (SMOKE_DIR) app.setPath('userData', path.join(SMOKE_DIR, 'userdata'));

// ── 运行日志：正式版只记环境、报错、崩溃；测试版（debugLog）全记，并显示角标、可一键导出 ──
const DEBUG_LOG = Boolean(CONFIG.debugLog);
const log = new Logger({ dir: path.join(app.getPath('userData'), 'logs'), verbose: DEBUG_LOG || Boolean(SMOKE_DIR) });
log.info('env', '启动', {
  game: CONFIG.gameName, version: CONFIG.version, buildId: CONFIG.buildId, debugLog: DEBUG_LOG, smoke: Boolean(SMOKE_DIR),
  electron: process.versions.electron, chrome: process.versions.chrome,
  os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: (os.cpus()[0] || {}).model, cores: os.cpus().length,
  memoryGB: Math.round(os.totalmem() / 1024 ** 3),
});
process.on('uncaughtExceptionMonitor', (err) => log.error('main', '主进程未捕获异常', { stack: String(err && err.stack || err) }));

if (!SMOKE_DIR && !app.requestSingleInstanceLock()) {
  app.exit(0);
}

// ── Steam：必须在 app ready 之前完成，覆盖层依赖启动参数 ──
function initSteam() {
  if (FAKE_STEAM_PORT) {
    const { createFakeSteam } = require('./steam-fake');
    runtime.steam = {
      state: 'ready',
      fake: true,
      client: createFakeSteam({
        port: FAKE_STEAM_PORT, id: process.env.MC_FAKE_STEAM_ID || '76561190000000101',
        name: process.env.MC_FAKE_STEAM_NAME || '玩家', language: process.env.MC_FAKE_STEAM_LANG || 'schinese', log,
      }),
    };
    return 'ok';
  }
  const appId = Number(CONFIG.steam && CONFIG.steam.appId) || 0;
  const enforce = Boolean(CONFIG.steam && CONFIG.steam.requireSteam) && !SMOKE_DIR;
  let steamworks;
  try {
    steamworks = require('steamworks.js');
  } catch (err) {
    runtime.steam = { state: 'module-error', message: String(err && err.message || err) };
    return appId && enforce ? 'fatal' : 'ok';
  }
  if (!appId) {
    runtime.steam = { state: SMOKE_DIR ? 'module-loaded' : 'no-app-id' };
    return 'ok';
  }
  // 不是从 Steam 启动的：交给 Steam 重新启动（试跑时不做，避免在打包电脑上拉起 Steam）
  if (enforce) {
    try {
      if (steamworks.restartAppIfNecessary(appId)) return 'relaunch';
    } catch (err) {
      runtime.steam = { state: 'restart-check-failed', message: String(err && err.message || err) };
    }
  }
  // Steam 没运行、或当前账号没有这款游戏，init 会失败
  try {
    runtime.steam = { state: 'ready', client: steamworks.init(appId) };
    steamworks.electronEnableSteamOverlay();
    return 'ok';
  } catch (err) {
    runtime.steam = { state: 'init-failed', message: String(err && err.message || err) };
    return enforce ? 'fatal' : 'ok';
  }
}

const steamResult = initSteam();
log.info('steam', `Steam：${runtime.steam.state}${runtime.steam.fake ? '（本机假 Steam，两个客户端联机测试用）' : ''}`, runtime.steam.message ? { message: runtime.steam.message } : undefined);
if (steamResult === 'relaunch') {
  app.exit(0);
}

// ── 给游戏的 kitBridge：Steam 联机、成就、状态（Steam 就绪时），以及退出、全屏、打开网页 ──
const sendToPages = (channel, ...args) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
};
let steamBridge = null;
if (runtime.steam.state === 'ready') {
  try {
    steamBridge = createSteamBridge({ client: runtime.steam.client, log, argv: process.argv, send: sendToPages });
  } catch (err) {
    log.error('steam', 'Steam 联机初始化失败，按单机运行', { error: String(err && err.stack || err) });
  }
}
ipcMain.on('kit:steam-ready', (event) => {
  event.returnValue = Boolean(steamBridge);
});
ipcMain.on('kit:quit', () => app.quit());
ipcMain.on('kit:fullscreen', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(Boolean(on));
});
ipcMain.on('kit:open-url', (event, url) => {
  const text = String(url || '');
  if (!/^https:\/\//i.test(text)) return;
  const client = runtime.steam.state === 'ready' ? runtime.steam.client : null;
  try {
    if (client) {
      client.overlay.activateToWebPage(text);
      return;
    }
  } catch {
    // 覆盖层不可用：用浏览器打开
  }
  shell.openExternal(text);
});
let selfCheck = null;
app.on('before-quit', () => {
  if (selfCheck) selfCheck.close();
  if (steamBridge) steamBridge.close();
});

// ── 存档镜像：localStorage ↔ userData/save/save.json（供 Steam 云存档同步）──
function saveFile() {
  return path.join(app.getPath('userData'), 'save', 'save.json');
}

ipcMain.on('save:load', (event) => {
  try {
    event.returnValue = JSON.parse(fs.readFileSync(saveFile(), 'utf8'));
  } catch {
    event.returnValue = null;
  }
});

ipcMain.on('save:store', (event, payload) => {
  try {
    const file = saveFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
    log.debug('save', '存档已同步到文件', { keys: Object.keys(payload.items || {}).length });
    event.returnValue = true;
  } catch (err) {
    log.error('save', '存档写入失败', { error: String(err && err.message || err) });
    event.returnValue = false;
  }
});

// ── 本地资源协议：只从 game/ 读文件，其他一律拒绝 ──
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};

function registerGameProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(GAME_DIR, rel));
    if (!file.startsWith(GAME_DIR + path.sep)) return new Response('forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      runtime.missing.push(rel);
      log.warn('file', `缺少文件 ${rel}`);
      return new Response('not found', { status: 404 });
    }
  });
}

function lockDownSession() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (/^(app|blob|data|devtools):/i.test(details.url)) return callback({});
    runtime.blocked.push(details.url);
    log.warn('net', `已拦截联网请求 ${details.url.slice(0, 200)}`);
    callback({ cancel: true });
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
}

function buildMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: CONFIG.gameName, submenu: [{ role: 'togglefullscreen', label: '切换全屏' }, { type: 'separator' }, { role: 'quit', label: `退出${CONFIG.gameName}` }] },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// 联机测试的两个窗口一左上、一右下，尽量少遮挡
function duoBounds() {
  if (!DUO_ROLE) return {};
  const area = screen.getPrimaryDisplay().workArea;
  const slot = Number(process.env.MC_DUO_SLOT) || 0;
  return { x: area.x + (slot ? Math.max(0, area.width - 960) : 0), y: area.y + (slot ? Math.max(0, area.height - 540) : 0) };
}

function createWindow() {
  const w = CONFIG.window || {};
  const win = new BrowserWindow({
    title: CONFIG.gameName,
    width: DUO_ROLE ? 960 : SMOKE_DIR ? 1280 : (w.width || 1600),
    height: DUO_ROLE ? 540 : SMOKE_DIR ? 720 : (w.height || 900),
    ...duoBounds(),
    minWidth: 960,
    minHeight: 540,
    useContentSize: true,
    fullscreen: !SMOKE_DIR && w.fullscreen !== false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      // 试跑时窗口可能被挡住或屏幕休眠：不降速，保证计时和截图正常
      backgroundThrottling: !SMOKE_DIR,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });
  win.webContents.on('did-finish-load', () => win.webContents.setVisualZoomLevelLimits(1, 1));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const mod = input.control || input.meta;
    if (mod && input.shift && key === 'l') {
      exportLogs(win);
      event.preventDefault();
    } else if (mod && input.shift && key === 'n' && selfCheck) {
      selfCheck.trigger();
      event.preventDefault();
    } else if (key === 'f11' || (input.alt && key === 'enter')) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (key === 'f5' || (mod && ['r', '=', '+', '-', '0'].includes(key)) || (mod && input.shift && key === 'i')) {
      event.preventDefault();
    }
  });
  win.webContents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySource) => {
    const level = event && event.level !== undefined ? event.level : legacyLevel;
    const message = event && event.message !== undefined ? event.message : legacyMessage;
    const source = event && event.sourceId !== undefined ? event.sourceId : legacySource;
    const line = event && event.lineNumber !== undefined ? event.lineNumber : legacyLine;
    const isError = level === 'error' || level === 3;
    if (isError) runtime.consoleErrors.push({ message: String(message), source: String(source || '') });
    const lvl = isError ? 'error' : (level === 'warning' || level === 2) ? 'warn' : 'debug';
    if (lvl !== 'warn' || DEBUG_LOG || SMOKE_DIR) log.write(lvl, 'console', message, source ? { source: String(source).slice(0, 200), line } : undefined);
  });
  win.webContents.on('unresponsive', () => log.warn('page', '页面无响应'));
  win.webContents.on('responsive', () => log.info('page', '页面恢复响应'));
  win.on('enter-full-screen', () => log.debug('window', '进入全屏'));
  win.on('leave-full-screen', () => log.debug('window', '退出全屏'));
  win.on('blur', () => log.debug('window', '失去焦点'));
  win.on('focus', () => log.debug('window', '获得焦点'));
  win.webContents.on('render-process-gone', (_event, details) => {
    runtime.crashes.push(details.reason);
    log.error('page', `渲染进程退出：${details.reason}`, { exitCode: details.exitCode });
    if (!SMOKE_DIR && details.reason !== 'clean-exit') win.reload();
  });

  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

// ── 日志导出：合成一个文本文件（测试者发给开发者）；试跑模式写到试跑目录，不碰桌面 ──
function exportLogs(win) {
  let saveText = '（没有存档文件）';
  try { saveText = fs.readFileSync(saveFile(), 'utf8'); } catch { /* 还没存过档 */ }
  const displays = screen.getAllDisplays().map((d) => `${d.size.width}x${d.size.height} 缩放${d.scaleFactor}`).join('，');
  const target = SMOKE_DIR
    ? path.join(SMOKE_DIR, 'log-export.txt')
    : path.join(app.getPath('desktop'), `${CONFIG.gameName}-日志-${stamp()}.txt`);
  try {
    log.info('export', '导出日志', { target });
    log.exportTo(target, `${CONFIG.gameName} 日志导出（版本 ${CONFIG.version}，构建 ${CONFIG.buildId}）`, [
      ['系统', `${os.type()} ${os.release()} ${os.arch()}；CPU ${(os.cpus()[0] || {}).model}；内存 ${Math.round(os.totalmem() / 1024 ** 3)} GB；显示器 ${displays}`],
      ['显卡状态', JSON.stringify(app.getGPUFeatureStatus())],
      ['存档 save.json', saveText],
    ]);
    if (!SMOKE_DIR && win) {
      shell.showItemInFolder(target);
      dialog.showMessageBox(win, { type: 'info', title: CONFIG.gameName, message: '日志已导出到桌面', detail: `${path.basename(target)}\n\n请把这个文件发给开发者。` });
    }
  } catch (err) {
    log.error('export', '导出日志失败', { error: String(err && err.message || err) });
  }
  return target;
}

ipcMain.on('wgp:export-logs', (event) => exportLogs(BrowserWindow.fromWebContents(event.sender)));

// ── 给游戏用：Steam 客户端的语言；打开商店页（试玩版的「加入愿望单」打开正式版）──
const steamClient = () => (runtime.steam && runtime.steam.state === 'ready' ? runtime.steam.client : null);
ipcMain.on('wgp:steam-language', (event) => {
  try {
    const client = steamClient();
    event.returnValue = client ? client.apps.currentGameLanguage() : null;
  } catch {
    event.returnValue = null;
  }
});
// 商店页：试玩版填 storeAppId（正式版的 App ID），正式版用自己的 appId；480 是测试应用，没有我们的商店页
const storeAppId = () => {
  const s = CONFIG.steam || {};
  const id = Number(s.storeAppId) || Number(s.appId) || 0;
  return id === 480 ? 0 : id;
};
ipcMain.on('wgp:store-ready', (event) => {
  event.returnValue = Boolean(storeAppId());
});
ipcMain.on('wgp:open-store', (event) => {
  const id = storeAppId();
  event.returnValue = Boolean(id);
  if (!id) return;
  try {
    const client = steamClient();
    if (client) {
      client.overlay.activateToStore(id, 0);
      log.info('store', `在 Steam 覆盖层打开商店页 ${id}`);
      return;
    }
  } catch (err) {
    log.warn('store', 'Steam 覆盖层打不开，改用浏览器', { error: String(err && err.message || err) });
  }
  shell.openExternal(`https://store.steampowered.com/app/${id}/`);
  log.info('store', `在浏览器打开商店页 ${id}`);
});

// 测试版：角落显示版本号（点击即导出日志），每 5 秒记录帧率、内存
const MARK_JS = (text) => `(() => { if (document.getElementById('__wgp_mark') || !document.body) return;
  const d = document.createElement('div'); d.id = '__wgp_mark'; d.textContent = ${JSON.stringify(text)};
  d.style.cssText = 'position:fixed;left:8px;bottom:6px;z-index:2147483647;font:12px/1.4 sans-serif;color:rgba(255,255,255,.75);background:rgba(0,0,0,.45);padding:2px 8px;border-radius:4px;cursor:pointer;user-select:none';
  d.onclick = () => window.__wgpNative && window.__wgpNative.exportLogs(); document.body.appendChild(d); })()`;
const PERF_JS = `new Promise((resolve) => { let f = 0, worst = 0, last = performance.now(); const s = last;
  const tick = (now) => { f += 1; worst = Math.max(worst, now - last); last = now; if (now - s < 1000) requestAnimationFrame(tick);
    else resolve({ fps: Math.round(f * 1000 / (now - s)), worstFrameMs: Math.round(worst), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }); };
  requestAnimationFrame(tick); })`;

function startDebugMonitors(win, { showMark }) {
  const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const mark = `测试版 ${CONFIG.version} · ${CONFIG.buildId} · ${mod}+Shift+L 或点这里导出日志${selfCheck ? ` · 联机自检：两人进房后房主按 ${mod}+Shift+N` : ''}`;
  const timer = setInterval(async () => {
    if (win.isDestroyed()) { clearInterval(timer); return; }
    const wc = win.webContents;
    if (showMark) wc.executeJavaScript(MARK_JS(mark)).catch(() => {});
    const perf = await Promise.race([wc.executeJavaScript(PERF_JS).catch(() => null), new Promise((r) => setTimeout(() => r('timeout'), 4000))]);
    if (perf === 'timeout') log.warn('perf', '页面 4 秒没有响应（可能卡死）');
    else if (perf) {
      const mem = app.getAppMetrics().reduce((sum, m) => sum + (m.memory ? m.memory.workingSetSize : 0), 0);
      log.debug('perf', `帧率 ${perf.fps}`, { ...perf, appMemoryMB: Math.round(mem / 1024) });
    }
  }, 5000);
}

// ── 自动试跑：启动 → 截图 → 模拟点击 → 截图 → 测帧率 → 存档自检 → 机器人试玩 → 写结果退出 ──
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function imageStats(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let lit = 0;
  let samples = 0;
  for (let i = 0; i < bitmap.length; i += 4 * 97) {
    samples += 1;
    if (bitmap[i] + bitmap[i + 1] + bitmap[i + 2] > 60) lit += 1;
  }
  return { width, height, litRatio: samples ? lit / samples : 0 };
}

async function runSmoke(win) {
  // 打包电脑无人值守时（屏幕休眠、窗口被挡），macOS 的 App Nap 会让程序几乎停下，试跑因此偶发超时
  powerSaveBlocker.start('prevent-app-suspension');
  const t = CONFIG.smoke || {};
  const result = { ok: false, shots: [], steps: [] };
  const finish = (code) => {
    Object.assign(result, {
      blocked: runtime.blocked, missing: runtime.missing, consoleErrors: runtime.consoleErrors,
      crashes: runtime.crashes, steam: { state: runtime.steam.state, message: runtime.steam.message || '' },
    });
    fs.writeFileSync(path.join(SMOKE_DIR, 'smoke-result.json'), JSON.stringify(result, null, 2), 'utf8');
    app.exit(code);
  };
  const bot = CONFIG.bot || {};
  const botSeconds = bot.enabled ? (bot.seconds || 60) : 0;
  const watchdog = setTimeout(() => { result.steps.push('超时'); finish(2); }, ((t.timeoutSeconds || 90) + botSeconds + 30) * 1000);

  const shot = async (name) => {
    const image = await Promise.race([win.webContents.capturePage(), new Promise((_, reject) => setTimeout(() => reject(new Error(`截图超时：${name}`)), 8000))]);
    const file = path.join(SMOKE_DIR, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    result.shots.push({ file: path.basename(file), ...imageStats(image) });
  };
  const click = async () => {
    const [w, h] = win.getContentSize();
    const x = Math.round(w / 2);
    const y = Math.round(h / 2);
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  };

  try {
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once('did-finish-load', resolve);
    });
    result.steps.push('页面加载完成');
    await sleep((t.bootSeconds || 5) * 1000);
    await shot('1-启动画面');
    for (let i = 0; i < (t.clicks || 2); i += 1) {
      await click();
      await sleep((t.stepSeconds || 4) * 1000);
      await shot(`${i + 2}-点击${i + 1}次后`);
    }
    result.fps = await win.webContents.executeJavaScript(`new Promise((resolve) => {
      let frames = 0; const start = performance.now();
      const tick = () => { frames += 1; const t = performance.now() - start; if (t < 2000) requestAnimationFrame(tick); else resolve(Math.round(frames * 1000 / t)); };
      requestAnimationFrame(tick);
    })`);
    result.steps.push('帧率测量完成');
    result.loaderText = await win.webContents.executeJavaScript(
      `(document.getElementById('__bundler_loading') || {}).textContent || ''`);

    // 存档自检：恢复（启动前预置的 save.json 是否写回 localStorage）+ 导出（改动是否落到文件）
    result.save = {};
    result.save.restored = await win.webContents.executeJavaScript(`localStorage.getItem('__mc_smoke_restore')`) === 'ok';
    const marker = `smoke-${Date.now()}`;
    await win.webContents.executeJavaScript(`localStorage.setItem('__mc_smoke_export', '${marker}'); window.dispatchEvent(new Event('mc:flush-save')); true`);
    await sleep(500);
    try {
      const saved = JSON.parse(fs.readFileSync(saveFile(), 'utf8'));
      result.save.exported = saved.items && saved.items.__mc_smoke_export === marker;
      result.save.keys = Object.keys(saved.items || {});
    } catch (err) {
      result.save.exported = false;
      result.save.error = String(err.message || err);
    }
    // 日志导出自检：导出文件应包含本次启动的日志
    const exported = exportLogs(win);
    result.logExport = fs.existsSync(exported) && fs.readFileSync(exported, 'utf8').includes('"src":"env"');
    result.steps.push('日志导出自检完成');

    if (bot.enabled) {
      const { runBot } = require('./bot');
      result.bot = await runBot(win, {
        seconds: botSeconds, seed: bot.seed || 1, prefer: bot.prefer || [], avoid: bot.avoid || [],
        outDir: SMOKE_DIR, log, errorCount: () => runtime.consoleErrors.length,
      });
      result.steps.push('机器人试玩完成');
    }
    result.logFile = log.file;
    result.ok = true;
    clearTimeout(watchdog);
    finish(0);
  } catch (err) {
    result.error = String(err && err.stack || err);
    clearTimeout(watchdog);
    finish(1);
  }
}

app.whenReady().then(() => {
  if (steamResult === 'fatal') {
    dialog.showErrorBox(CONFIG.gameName, `请通过 Steam 启动《${CONFIG.gameName}》。\n\n${runtime.steam.message || ''}`);
    app.exit(1);
    return;
  }
  buildMenu();
  lockDownSession();
  registerGameProtocol();
  log.info('env', '显示与显卡', {
    displays: screen.getAllDisplays().map((d) => ({ size: `${d.size.width}x${d.size.height}`, scale: d.scaleFactor })),
    gpu: app.getGPUFeatureStatus(), locale: app.getLocale(),
  });
  const win = createWindow();
  // 测试版接上 Steam 时提供联机自检（两个账号各一台电脑，房主按快捷键）；打包工具的联机测试会在假 Steam 上演练一遍
  if (DEBUG_LOG && steamBridge && (!SMOKE_DIR || DUO_ROLE)) {
    const { createSelfCheck } = require('./duo');
    const secs = DUO_ROLE ? Number(process.env.MC_DUO_SECS) || 20 : undefined;
    selfCheck = createSelfCheck({ win, bridge: steamBridge, log, exportLogs: () => exportLogs(win), secs });
  }
  if (DEBUG_LOG || SMOKE_DIR) startDebugMonitors(win, { showMark: DEBUG_LOG });
  if (DUO_ROLE) runDuoTest(win);
  else if (SMOKE_DIR) runSmoke(win);
});

// ── 两个客户端联机测试：本机假 Steam 上，房主和加入者各一个程序 ──
function runDuoTest(win) {
  powerSaveBlocker.start('prevent-app-suspension');
  const secs = Number(process.env.MC_DUO_SECS) || 40;
  const tail = Number(process.env.MC_DUO_TAIL) || 0;
  const watchdog = setTimeout(() => {
    log.error('duo', '联机测试超时');
    app.exit(2);
  }, (secs + tail + 180) * 1000);
  const { runDuo } = require('./duo');
  runDuo(win, {
    dir: SMOKE_DIR, role: DUO_ROLE, mode: process.env.MC_DUO_MODE || 'invite', round: process.env.MC_DUO_ROUND || '1',
    secs, tail, seed: Number(process.env.MC_DUO_SEED) || 777, log, client: runtime.steam.client, runtime, selfCheck,
    finish: (code) => {
      clearTimeout(watchdog);
      app.exit(code);
    },
  });
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') log.error('process', `子进程退出：${details.type} ${details.reason}`, { exitCode: details.exitCode });
});

app.on('window-all-closed', () => app.quit());
