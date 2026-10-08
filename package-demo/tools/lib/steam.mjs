// Steam 上传：生成 SteamPipe 脚本，调用 steamcmd 上传到测试分支
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PATHS, ROOT, resetDir, writeText } from './common.mjs';

const q = (s) => `"${String(s).replace(/\\/g, '/').replace(/"/g, '')}"`;

// Valve 给所有开发者测试用的应用（Spacewar）：拿到自己的 App ID 前，用它在 Steam 上试房间和 P2P
const TEST_APP_ID = 480;

function buildVdf({ appId, desc, contentRoot, buildOutput, setLive, depots }) {
  const lines = [
    '"AppBuild"', '{',
    `\t"AppID"\t${q(appId)}`,
    `\t"Desc"\t${q(desc)}`,
    `\t"ContentRoot"\t${q(contentRoot)}`,
    `\t"BuildOutput"\t${q(buildOutput)}`,
  ];
  if (setLive) lines.push(`\t"SetLive"\t${q(setLive)}`);
  lines.push('\t"Depots"', '\t{');
  for (const d of depots) {
    lines.push(`\t\t${q(d.depotId)}`, '\t\t{', '\t\t\t"FileMapping"', '\t\t\t{',
      `\t\t\t\t"LocalPath"\t${q(`${d.folder}/*`)}`, '\t\t\t\t"DepotPath"\t"."', '\t\t\t\t"recursive"\t"1"', '\t\t\t}', '\t\t}');
  }
  lines.push('\t}', '}', '');
  return lines.join('\n');
}

function findSteamcmd(configured) {
  const names = process.platform === 'win32' ? ['steamcmd.exe'] : ['steamcmd', 'steamcmd.sh'];
  const candidates = [];
  if (configured) candidates.push(path.isAbsolute(configured) ? configured : path.join(ROOT, configured));
  for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const n of names) candidates.push(path.join(dir, n));
  for (const n of names) candidates.push(path.join(PATHS.tools, 'steamcmd', n));
  return candidates.find((c) => c && fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

function runSteamcmd(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: path.dirname(exe), stdio: ['inherit', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (chunk) => { process.stdout.write(chunk); text += chunk; });
    child.stderr.on('data', (chunk) => { process.stderr.write(chunk); text += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, text }));
  });
}

export async function steamStep(ctx, cfg, packs, buildId) {
  const s = cfg.steam;
  if (s.appId === TEST_APP_ID) {
    ctx.skip('App ID 是 480（Valve 公开的测试应用 Spacewar）：这是测试包，只用来在 Steam 上试联机，不能上传');
    return { state: 'test-app' };
  }
  if (!s.appId) {
    ctx.skip('还没填 Steam App ID：正版校验和上传都已跳过。拿到 App ID 后填进 配置.jsonc 的 steam.appId');
    return { state: 'no-app-id' };
  }
  const depots = packs
    .filter((p) => Number(s.depots[p.target.key]) > 0)
    .map((p) => ({ depotId: Number(s.depots[p.target.key]), folder: p.target.outDir, label: p.target.label }));
  if (!depots.length) {
    ctx.warn('配置里还没填 depot 编号（steam.depots），无法生成上传脚本');
    return { state: 'no-depot' };
  }
  let setLive = String(s.branch || '').trim();
  if (setLive.toLowerCase() === 'default') {
    ctx.warn('出于安全不自动设为 default 分支：本次只上传，推给玩家请在 Steamworks 后台手动操作');
    setLive = '';
  }
  const scriptsDir = path.join(PATHS.build, 'steam-scripts');
  resetDir(scriptsDir);
  const buildOutput = path.join(scriptsDir, 'output');
  fs.mkdirSync(buildOutput);
  const vdf = path.join(scriptsDir, `app_build_${s.appId}.vdf`);
  writeText(vdf, buildVdf({ appId: s.appId, desc: `${cfg.version} (${buildId})`, contentRoot: PATHS.build, buildOutput, setLive, depots }));
  ctx.note(`上传脚本已生成：build/steam-scripts/${path.basename(vdf)}（${depots.map((d) => `${d.label}→depot ${d.depotId}`).join('，')}）`);

  if (!s.upload) {
    ctx.skip('steam.upload 为 false，本次不上传。要上传就改成 true');
    return { state: 'script-only', vdf, depots, setLive };
  }
  if (!s.buildAccount) throw new Error('要上传需要在配置里填 steam.buildAccount（上传用的 Steam 账号名）');
  const steamcmd = findSteamcmd(s.steamcmdPath);
  if (!steamcmd) {
    throw new Error('没找到 steamcmd。请从 Steamworks 官方文档（partner.steamgames.com/doc/sdk/uploading）下载，解压到 tools/steamcmd/，或在配置里填 steam.steamcmdPath');
  }
  ctx.note(`用 ${steamcmd} 上传。第一次上传需要你在这个窗口里输入密码和手机令牌，之后会记住登录`);
  const result = await runSteamcmd(steamcmd, ['+login', s.buildAccount, '+run_app_build', vdf, '+quit']);
  const buildIdMatch = result.text.match(/BuildID\s*\(?\s*(\d+)/i);
  if (result.code !== 0 || !buildIdMatch || /ERROR|Failed/i.test(result.text.split(/BuildID/i).pop())) {
    throw new Error(`上传没有成功（退出码 ${result.code}），详情看上面 steamcmd 的输出和 build/steam-scripts/output/`);
  }
  ctx.note(`上传成功：Steam BuildID ${buildIdMatch[1]}${setLive ? `，已设为 ${setLive} 分支的当前版本` : ''}`);
  return { state: 'uploaded', vdf, depots, setLive, steamBuildId: buildIdMatch[1] };
}
