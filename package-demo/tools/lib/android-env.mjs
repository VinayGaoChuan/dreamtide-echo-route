// 安卓环境：JDK 21 + Android SDK（+ 可选模拟器），全部装在用户目录，不需要管理员权限
// 下载文件都用官方给出的校验和核对
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const BAT = IS_WIN ? '.bat' : '';
export const TOOL_HOME = process.env.WGP_HOME || path.join(os.homedir(), '.web-game-packager');
const REPO = 'https://dl.google.com/android/repository/';

// 包名统一用新版 Android CLI 的斜杠格式；旧版 sdkmanager 自动换成分号格式
export const ANDROID = {
  platform: 'platforms/android-36',
  buildTools: 'build-tools/36.0.0',
  imageApi: 36,
  avdName: 'wgp_test',
  licenseUrl: 'https://developer.android.com/studio/terms',
};

export function sdkRoot() {
  for (const v of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) if (v && fs.existsSync(v)) return v;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Android', 'sdk');
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk');
  return path.join(os.homedir(), 'Android', 'Sdk');
}

export function sdkTools(root = sdkRoot()) {
  return {
    root,
    androidCli: path.join(root, 'cmdline-tools', 'latest', 'bin', `android${EXE}`),
    sdkmanager: path.join(root, 'cmdline-tools', 'latest', 'bin', `sdkmanager${BAT}`),
    avdmanager: path.join(root, 'cmdline-tools', 'latest', 'bin', `avdmanager${BAT}`),
    adb: path.join(root, 'platform-tools', `adb${EXE}`),
    emulator: path.join(root, 'emulator', `emulator${EXE}`),
    buildToolsDir: path.join(root, 'build-tools'),
  };
}

export function systemImage() {
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  return `system-images/android-${ANDROID.imageApi}/google_apis/${abi}`;
}

function javaMajor(home) {
  const java = path.join(home, 'bin', `java${EXE}`);
  if (!fs.existsSync(java)) return 0;
  const r = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const m = `${r.stderr}${r.stdout}`.match(/version "(\d+)/);
  return m ? Number(m[1]) : 0;
}

export function findJdk() {
  const own = path.join(TOOL_HOME, 'jdk-21');
  if (javaMajor(own) >= 21) return own;
  if (process.env.JAVA_HOME && javaMajor(process.env.JAVA_HOME) >= 21) return process.env.JAVA_HOME;
  return null;
}

export function androidEnv(jdk = findJdk(), root = sdkRoot()) {
  const extra = [path.join(jdk || '', 'bin'), path.join(root, 'platform-tools')].join(path.delimiter);
  return { JAVA_HOME: jdk || '', ANDROID_HOME: root, ANDROID_SDK_ROOT: root, PATH: `${extra}${path.delimiter}${process.env.PATH}` };
}

async function download(url, dest, { sha256, sha1, log }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash(sha256 ? 'sha256' : 'sha1');
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let nextMark = 0.1;
  for await (const chunk of res.body) {
    hash.update(chunk);
    got += chunk.length;
    if (!out.write(chunk)) await once(out, 'drain');
    if (total && got / total >= nextMark) {
      log(`     ${path.basename(dest)} ${Math.round((got / total) * 100)}%（${(got / 1024 ** 2).toFixed(0)}/${(total / 1024 ** 2).toFixed(0)} MB）`);
      nextMark += 0.1;
    }
  }
  out.end();
  await once(out, 'close');
  const digest = hash.digest('hex');
  const expected = (sha256 || sha1 || '').toLowerCase();
  if (expected && digest !== expected) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`校验和不一致，文件可能损坏或被篡改：${path.basename(dest)}`);
  }
  fs.renameSync(tmp, dest);
}

function extract(archive, into) {
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  const r = spawnSync('tar', ['-xf', archive, '-C', into], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`解压失败：${path.basename(archive)} ${r.stderr}`);
}

function findUp(dir, test, depth = 4) {
  if (test(dir)) return dir;
  if (depth === 0) return null;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const hit = findUp(path.join(dir, d.name), test, depth - 1);
    if (hit) return hit;
  }
  return null;
}

async function installJdk(log) {
  const osName = { darwin: 'mac', win32: 'windows', linux: 'linux' }[process.platform];
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const api = `https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${arch}&image_type=jdk&os=${osName}&vendor=eclipse`;
  const assets = await (await fetch(api)).json();
  const pkg = assets && assets[0] && assets[0].binary && assets[0].binary.package;
  if (!pkg) throw new Error('没查到 JDK 21 下载地址（Adoptium）');
  log(`   · 下载 JDK 21（Eclipse Temurin，${(pkg.size / 1024 ** 2).toFixed(0)} MB）`);
  const archive = path.join(TOOL_HOME, 'downloads', pkg.name);
  if (!fs.existsSync(archive)) await download(pkg.link, archive, { sha256: pkg.checksum, log });
  const tmp = path.join(TOOL_HOME, 'tmp-jdk');
  extract(archive, tmp);
  const home = findUp(tmp, (d) => fs.existsSync(path.join(d, 'bin', `java${EXE}`)));
  if (!home) throw new Error('JDK 解压后找不到 java');
  const target = path.join(TOOL_HOME, 'jdk-21');
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(home, target);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  return target;
}

async function installCmdlineTools(root, log) {
  const xml = await (await fetch(`${REPO}repository2-3.xml`)).text();
  const block = xml.match(/<remotePackage path="cmdline-tools;latest">([\s\S]*?)<\/remotePackage>/);
  if (!block) throw new Error('没查到 Android 命令行工具的下载信息');
  const hostOs = { darwin: 'macosx', win32: 'windows', linux: 'linux' }[process.platform];
  const hostArch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const candidates = [...block[1].matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map((m) => m[1])
    .filter((a) => a.includes(`<host-os>${hostOs}</host-os>`));
  // 同一系统可能按芯片分包（如 Mac 的 arm64 / x86_64）：先找匹配芯片的，再找不分芯片的
  const archive = candidates.find((a) => a.includes(`<host-arch>${hostArch}</host-arch>`))
    || candidates.find((a) => !a.includes('<host-arch>'));
  if (!archive) throw new Error(`没有适合 ${hostOs} 的命令行工具`);
  const url = archive.match(/<url>(.*?)<\/url>/)[1];
  const sha1 = archive.match(/<checksum type="sha1">(.*?)<\/checksum>/)[1];
  log(`   · 下载 Android 命令行工具（${url}）`);
  const file = path.join(TOOL_HOME, 'downloads', url);
  if (!fs.existsSync(file)) await download(`${REPO}${url}`, file, { sha1, log });
  const tmp = path.join(TOOL_HOME, 'tmp-cmdline');
  extract(file, tmp);
  const target = path.join(root, 'cmdline-tools', 'latest');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(path.join(tmp, 'cmdline-tools'), target);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(file, { force: true });
}

// 运行 sdkmanager / avdmanager；acceptLicenses 时自动回答 y（仅在用户已同意许可协议时使用）
function runTool(cmd, args, env, { input, interactive, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      shell: IS_WIN,
    });
    let text = '';
    if (!interactive) {
      const onData = (chunk) => {
        text += chunk;
        const line = String(chunk).trim().split(/\r|\n/).pop();
        if (line && /\d+%/.test(line) && log) log(`     ${line.slice(0, 100)}`);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      if (input) {
        child.stdin.write(input);
      }
      child.stdin.end();
    }
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, text }));
  });
}

function licensesAccepted(root) {
  return fs.existsSync(path.join(root, 'licenses', 'android-sdk-license'));
}

async function askConsent(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(String(answer).trim());
}

// 安装 SDK 组件：有新版 Android CLI 就用它，否则用旧版 sdkmanager
async function sdkInstall(tools, env, packages, log) {
  const useCli = fs.existsSync(tools.androidCli);
  const cmd = useCli ? tools.androidCli : tools.sdkmanager;
  // 显式指定本机平台：不指定时，新版 CLI 在 Apple 芯片 Mac 上会装成 x86_64 的模拟器（实测）
  const hostPlatform = `${{ darwin: 'mac', win32: 'windows', linux: 'linux' }[process.platform]}_${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`;
  const args = useCli
    ? [`--sdk=${tools.root}`, 'sdk', `--platform=${hostPlatform}`, 'install', ...packages]
    : [`--sdk_root=${tools.root}`, ...packages.map((p) => p.replace(/\//g, ';'))];
  // 用户已同意许可协议；若工具仍逐条询问，自动回答 y
  return runTool(cmd, args, env, { input: 'y\n'.repeat(50), log });
}

// 安装/检查全部安卓依赖；返回 { jdk, root, tools, env }
// acceptLicenses：用户已在别处明确同意 Android SDK 许可协议；否则在终端里先问用户
export async function ensureAndroidEnv({ log = console.log, withEmulator = false, acceptLicenses = false } = {}) {
  fs.mkdirSync(TOOL_HOME, { recursive: true });
  const root = sdkRoot();
  const tools = sdkTools(root);
  const firstInstall = !fs.existsSync(tools.androidCli) && !fs.existsSync(tools.sdkmanager);
  if ((firstInstall || !licensesAccepted(root)) && !acceptLicenses) {
    log(`   · 第一次准备安卓环境：将下载 JDK 21 和 Android SDK（约 ${withEmulator ? '3–5' : '1–2'} GB），需要同意 Google 的 Android SDK 许可协议：${ANDROID.licenseUrl}`);
    if (!(await askConsent('     同意并继续安装吗？输入 y 回车：'))) {
      throw new Error(`没有同意 Android SDK 许可协议。可以在终端运行 node tools/android-env.mjs${withEmulator ? ' --emulator' : ''} 单独安装`);
    }
  }

  let jdk = findJdk();
  if (!jdk) jdk = await installJdk(log);
  log(`   · JDK：${jdk}`);
  if (firstInstall) await installCmdlineTools(root, log);
  log(`   · Android SDK：${root}`);
  const env = androidEnv(jdk, root);

  const want = ['platform-tools', ANDROID.platform, ANDROID.buildTools];
  if (withEmulator) want.push('emulator', systemImage());
  const missing = want.filter((pkg) => !fs.existsSync(path.join(root, ...pkg.split('/'))));
  if (missing.length) {
    log(`   · 安装 SDK 组件：${missing.join('、')}（第一次较慢）`);
    const r = await sdkInstall(tools, env, missing, log);
    const still = missing.filter((pkg) => !fs.existsSync(path.join(root, ...pkg.split('/'))));
    if (r.code !== 0 || still.length) throw new Error(`SDK 组件安装失败：${still.join('、') || r.text.trim().split('\n').pop()}`);
  }

  if (withEmulator && !fs.existsSync(path.join(os.homedir(), '.android', 'avd', `${ANDROID.avdName}.avd`))) {
    log(`   · 创建测试模拟器 ${ANDROID.avdName}`);
    const r = await runTool(tools.avdmanager, ['create', 'avd', '-n', ANDROID.avdName, '-k', systemImage().replace(/\//g, ';'), '-d', 'pixel_6', '--force'], env, { input: 'no\n' });
    if (r.code !== 0) throw new Error(`模拟器创建失败：${r.text.trim().split('\n').pop()}`);
    const ini = path.join(os.homedir(), '.android', 'avd', `${ANDROID.avdName}.avd`, 'config.ini');
    if (fs.existsSync(ini)) {
      let cfg = fs.readFileSync(ini, 'utf8');
      // config.ini 的格式是「键 = 值」（等号两边有空格）
      const set = (k, v) => {
        const re = new RegExp(`^${k.replace(/\./g, '\\.')}\\s*=.*$`, 'm');
        cfg = re.test(cfg) ? cfg.replace(re, `${k} = ${v}`) : `${cfg.trimEnd()}\n${k} = ${v}\n`;
      };
      // 数据分区不能调小：API 36 镜像启动时强制 6 GB（需约 7.4 GB 空闲磁盘，实测）；SD 卡用不到，调到最小
      set('sdcard.size', '64 MB');
      set('hw.keyboard', 'yes');
      set('hw.gpu.enabled', 'yes');
      fs.writeFileSync(ini, cfg, 'utf8');
    }
  }
  return { jdk, root, tools, env };
}
