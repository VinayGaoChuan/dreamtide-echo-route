// 无头 Chrome 公共环境：找 Chrome、起本地静态服务、CDP 连接、打开游戏页。shoot.js（截图）和 ui-check.js（死按钮检查）共用。
// Chrome：macOS 默认 /Applications/Google Chrome.app，Windows 默认 Program Files 下的 chrome.exe，Linux 找 google-chrome / chromium；
// 也可以用参数或 CHROME 环境变量指定。
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath(given) {
  const c = given || process.env.CHROME;
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
/* 一个 CDP 连接：send(method, params) → result */
function cdp(wsUrl) {
  return new Promise((ok, bad) => {
    const ws = new WebSocket(wsUrl); let id = 0; const wait = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { const [a, b] = wait.get(d.id); wait.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } };
    ws.onerror = (e) => bad(e); ws.onopen = () => ok({ send: (method, params = {}) => new Promise((a, b) => { const i = ++id; wait.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() });
  });
}
/* 打开游戏页（W×H，存档在一个临时的浏览器资料夹里，每次都是新存档）：返回 { page, ev, close } */
async function openGame({ W, H, chrome }) {
  const server = await serve(), port = server.address().port, dbg = 9300 + Math.floor(Math.random() * 400);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamtide-chrome-'));
  const proc = spawn(chromePath(chrome), ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  const close = () => { if (page) page.close(); proc.kill(); server.close(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* Chrome 还没完全退出 */ } };
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
    return { page, ev, close };
  } catch (e) { close(); throw e; }
}
module.exports = { ROOT, sleep, chromePath, serve, cdp, openGame };
