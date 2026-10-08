// 读取配置、准备依赖（首次运行自动安装，之后离线可用）
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT, npmCommand, parseJsonc, readText, run } from './common.mjs';

const DEFAULTS = {
  gameName: '我的游戏',
  executableName: 'MyGame',
  version: '0.1.0',
  company: '',
  platforms: ['windows', 'mac'],
  window: { fullscreen: true, width: 1600, height: 900 },
  icon: '',
  keepLocales: ['en-US', 'zh-CN', 'zh-TW'],
  obfuscate: true,
  debugLog: false,
  bot: {
    enabled: true, seconds: 60, seed: 1,
    prefer: ['开始', '继续', '确定', '下一', '出发', '进入', '前进', '选择', '购买', '领取', '跳过', '结算', '返回', '好的', '知道了', 'start', 'next', 'ok', 'continue', 'play'],
    avoid: ['重置', '删除', '清空', '清除', '退出', 'reset', 'delete', 'clear', 'quit', 'exit'],
  },
  smokeTest: true,
  smoke: { bootSeconds: 5, clicks: 2, stepSeconds: 4, timeoutSeconds: 90 },
  duo: { enabled: true, seconds: 40, leaveAt: 25, latencyMs: 80, jitterMs: 25, lobbyDelayMs: 300 },
  electronMirror: '',
  android: { packageId: '', orientation: 'landscape', outputs: ['apk', 'aab'], smokeTest: true, smokeDevice: 'emulator', keepEmulator: false },
  steam: { appId: 0, storeAppId: 0, requireSteam: true, upload: false, buildAccount: '', depots: { windows: 0, mac: 0 }, branch: 'beta', steamcmdPath: '' },
};

export function loadConfig(ctx) {
  if (!fs.existsSync(PATHS.config)) throw new Error(`找不到配置文件：${PATHS.config}`);
  let raw;
  try {
    raw = parseJsonc(readText(PATHS.config));
  } catch (err) {
    throw new Error(`配置.jsonc 格式有误（检查引号和逗号）：${err.message}`);
  }
  const cfg = {
    ...DEFAULTS,
    ...raw,
    window: { ...DEFAULTS.window, ...(raw.window || {}) },
    smoke: { ...DEFAULTS.smoke, ...(raw.smoke || {}) },
    duo: { ...DEFAULTS.duo, ...(raw.duo || {}) },
    bot: { ...DEFAULTS.bot, ...(raw.bot || {}) },
    android: { ...DEFAULTS.android, ...(raw.android || {}) },
    steam: { ...DEFAULTS.steam, ...(raw.steam || {}), depots: { ...DEFAULTS.steam.depots, ...((raw.steam || {}).depots || {}) } },
  };
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(cfg.executableName)) {
    throw new Error('executableName 只能用英文字母和数字，并以字母开头');
  }
  if (!/^\d+\.\d+\.\d+$/.test(cfg.version)) throw new Error('version 格式应为 数字.数字.数字，例如 0.1.0');
  cfg.platforms = [...new Set(cfg.platforms)].filter((p) => ['windows', 'mac', 'android'].includes(p));
  if (!cfg.platforms.length) throw new Error('platforms 至少要包含 "windows"、"mac" 或 "android" 之一');
  if (!cfg.android.packageId) cfg.android.packageId = `com.${(cfg.company || 'indie').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'indie'}.${cfg.executableName.toLowerCase()}`;
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(cfg.android.packageId)) throw new Error('android.packageId 格式应为 com.公司.游戏（只用小写字母、数字、下划线和点）');
  cfg.android.outputs = (cfg.android.outputs || []).filter((o) => ['apk', 'aab'].includes(o));
  if (cfg.platforms.includes('android') && !cfg.android.outputs.length) throw new Error('android.outputs 至少要包含 "apk" 或 "aab"');
  cfg.steam.appId = Number(cfg.steam.appId) || 0;
  cfg.steam.storeAppId = Number(cfg.steam.storeAppId) || 0;
  ctx.note(`游戏：${cfg.gameName} ${cfg.version}　程序名：${cfg.executableName}　平台：${cfg.platforms.join('、')}`);
  ctx.note(`代码混淆：${cfg.obfuscate ? '开' : '关'}　自动试跑：${cfg.smokeTest ? '开' : '关'}　Steam App ID：${cfg.steam.appId || '未填'}`);
  return cfg;
}

function hasPackages(dir, names) {
  return names.every((name) => fs.existsSync(path.join(dir, 'node_modules', ...name.split('/'), 'package.json')));
}

async function npmInstall(ctx, cwd, label) {
  const lock = fs.existsSync(path.join(cwd, 'package-lock.json'));
  ctx.note(`安装${label}（${lock ? 'npm ci，按锁定版本' : 'npm install'}）…`);
  const result = await run(npmCommand(), [lock ? 'ci' : 'install', '--no-fund', '--no-audit'], {
    cwd, shell: process.platform === 'win32', timeoutMs: 15 * 60 * 1000,
  });
  if (result.code !== 0) throw new Error(`${label}安装失败：${(result.stderr || result.stdout).trim().split('\n').slice(-5).join(' ')}`);
}

export function electronBinary() {
  const pkg = path.join(ROOT, 'node_modules', 'electron');
  const pathTxt = path.join(pkg, 'path.txt');
  if (!fs.existsSync(pathTxt)) return null;
  const binary = path.join(pkg, 'dist', fs.readFileSync(pathTxt, 'utf8').trim());
  return fs.existsSync(binary) ? binary : null;
}

export function electronVersion() {
  return JSON.parse(readText(path.join(ROOT, 'node_modules', 'electron', 'package.json'))).version;
}

export async function ensureDeps(ctx, cfg) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) throw new Error(`Node.js 版本太旧（当前 ${process.versions.node}），请安装 22 或更新的 LTS 版本`);
  const env = cfg.electronMirror ? { ELECTRON_MIRROR: cfg.electronMirror } : {};
  const rootPkg = JSON.parse(readText(path.join(ROOT, 'package.json')));
  if (!hasPackages(ROOT, Object.keys(rootPkg.devDependencies || {}))) await npmInstall(ctx, ROOT, '打包工具');
  if (!electronBinary()) {
    ctx.note('下载 Electron 运行时（约 100 MB，只需一次）…');
    const result = await run(process.execPath, [path.join(ROOT, 'node_modules', 'electron', 'install.js')], { env, timeoutMs: 15 * 60 * 1000 });
    if (result.code !== 0 || !electronBinary()) {
      throw new Error(`Electron 下载失败。网络慢可在配置里填 electronMirror。${(result.stderr || '').trim().split('\n').pop() || ''}`);
    }
  }
  const shellPkg = JSON.parse(readText(path.join(PATHS.shell, 'package.json')));
  if (!hasPackages(PATHS.shell, Object.keys(shellPkg.dependencies || {}))) await npmInstall(ctx, PATHS.shell, '游戏外壳依赖');
  ctx.note(`Node ${process.versions.node}　Electron ${electronVersion()}　全部依赖就绪`);
}
