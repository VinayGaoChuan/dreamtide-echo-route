// 组装桌面程序并打包：Electron 外壳 + 游戏 → asar 归档 → 各平台程序 → 加固开关（fuses）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { packager } from '@electron/packager';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import { PATHS, dirSize, formatBytes, readText, resetDir, writeText } from './common.mjs';
import { electronVersion } from './setup.mjs';

export const TARGETS = {
  windows: { key: 'windows', label: 'Windows 版', platform: 'win32', arch: 'x64', outDir: 'steam-windows', steamDir: 'win64' },
  mac: { key: 'mac', label: 'Mac 版', platform: 'darwin', arch: process.platform === 'darwin' ? process.arch : 'arm64', outDir: 'steam-mac', steamDir: 'osx' },
};

export function assembleApp(ctx, cfg, processed, buildId, smokeKey) {
  const appDir = path.join(PATHS.work, 'app');
  resetDir(appDir);
  for (const file of fs.readdirSync(PATHS.shell).filter((f) => f.endsWith('.js'))) fs.copyFileSync(path.join(PATHS.shell, file), path.join(appDir, file));
  const shellPkg = JSON.parse(readText(path.join(PATHS.shell, 'package.json')));
  writeText(path.join(appDir, 'package.json'), JSON.stringify({
    name: cfg.executableName.toLowerCase(),
    productName: cfg.executableName,
    version: cfg.version,
    private: true,
    main: 'main.js',
    dependencies: shellPkg.dependencies,
  }, null, 2));
  fs.cpSync(path.join(PATHS.shell, 'node_modules'), path.join(appDir, 'node_modules'), { recursive: true });
  fs.cpSync(processed.gameDir, path.join(appDir, 'game'), { recursive: true });
  writeText(path.join(appDir, 'app-config.json'), JSON.stringify({
    gameName: cfg.gameName,
    version: cfg.version,
    buildId,
    window: cfg.window,
    smoke: cfg.smoke,
    debugLog: cfg.debugLog,
    bot: cfg.bot,
    smokeKeyHash: crypto.createHash('sha256').update(smokeKey).digest('hex'),
    steam: { appId: cfg.steam.appId, storeAppId: cfg.steam.storeAppId, requireSteam: cfg.steam.requireSteam },
  }, null, 2));
  ctx.note(`程序目录已组装：外壳 + 游戏（${formatBytes(dirSize(path.join(appDir, 'game')))}）+ Steam 组件`);
  return appDir;
}

// 只保留目标平台的 Steam 原生库
function keepSteamBinariesFor(target) {
  return ({ buildPath }) => {
    const dist = path.join(buildPath, 'node_modules', 'steamworks.js', 'dist');
    if (!fs.existsSync(dist)) return;
    for (const name of fs.readdirSync(dist)) {
      if (name !== target.steamDir) fs.rmSync(path.join(dist, name), { recursive: true, force: true });
    }
    const keep = path.join(dist, target.steamDir);
    if (fs.existsSync(keep)) {
      for (const name of fs.readdirSync(keep)) if (name.endsWith('.lib')) fs.rmSync(path.join(keep, name));
    }
  };
}

// 只保留配置里的界面语言包（Chromium 自带 55 种，约 45 MB）
function keepLocales(cfg) {
  const keep = new Set(cfg.keepLocales);
  const keepMac = new Set(cfg.keepLocales.map((l) => `${l.replace('-', '_').replace(/^en_US$/, 'en')}.lproj`));
  return ({ buildPath, platform }) => {
    if (!keep.size) return;
    if (platform === 'win32' || platform === 'linux') {
      const dir = path.join(buildPath, 'locales');
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) if (!keep.has(name.replace(/\.pak$/, ''))) fs.rmSync(path.join(dir, name));
    } else if (platform === 'darwin') {
      const dir = path.join(buildPath, 'Electron.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources');
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.lproj') && !keepMac.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      }
    }
  };
}

export function binaryPath(target, cfg, dir) {
  return target.platform === 'win32' ? path.join(dir, `${cfg.executableName}.exe`) : path.join(dir, `${cfg.executableName}.app`);
}

export function executablePath(target, cfg, dir) {
  return target.platform === 'win32'
    ? path.join(dir, `${cfg.executableName}.exe`)
    : path.join(dir, `${cfg.executableName}.app`, 'Contents', 'MacOS', cfg.executableName);
}

export function asarPath(target, cfg, dir) {
  return target.platform === 'win32'
    ? path.join(dir, 'resources', 'app.asar')
    : path.join(dir, `${cfg.executableName}.app`, 'Contents', 'Resources', 'app.asar');
}

export const FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};

export async function packPlatform(ctx, cfg, target, appDir, icons) {
  const out = path.join(PATHS.work, 'packager');
  fs.mkdirSync(out, { recursive: true });
  let icon;
  if (icons) icon = target.platform === 'win32' ? icons.base : (icons.icns ? icons.base : undefined);
  const [dir] = await packager({
    dir: appDir,
    out,
    overwrite: true,
    quiet: true,
    platform: target.platform,
    arch: target.arch,
    electronVersion: electronVersion(),
    name: cfg.executableName,
    executableName: cfg.executableName,
    appVersion: cfg.version,
    buildVersion: cfg.version,
    appCopyright: cfg.company ? `© ${new Date().getFullYear()} ${cfg.company}` : undefined,
    appBundleId: `com.${(cfg.company || 'indie').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'indie'}.${cfg.executableName.toLowerCase()}`,
    appCategoryType: 'public.app-category.games',
    win32metadata: {
      CompanyName: cfg.company || cfg.gameName,
      FileDescription: cfg.gameName,
      ProductName: cfg.gameName,
      InternalName: cfg.executableName,
    },
    icon,
    asar: { unpack: '**/*.{node,dll,dylib,so}' },
    prune: true,
    derefSymlinks: true,
    afterExtract: [keepLocales(cfg)],
    afterCopy: [keepSteamBinariesFor(target)],
    download: cfg.electronMirror ? { mirrorOptions: { mirror: cfg.electronMirror } } : undefined,
  });
  const finalDir = path.join(PATHS.build, target.outDir);
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(dir, finalDir);

  await flipFuses(binaryPath(target, cfg, finalDir), {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: target.platform === 'darwin',
    ...FUSES,
  });
  ctx.note('加固开关已写入：禁止当 Node 运行、禁止调试参数、只加载 asar、启用 asar 完整性校验');
  if (!icon) ctx.warn('这个平台没有设置图标，使用默认图标');
  ctx.note(`输出：build/${target.outDir}（${formatBytes(dirSize(finalDir))}）`);
  return { target, dir: finalDir };
}
