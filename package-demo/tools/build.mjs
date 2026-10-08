// 网页游戏一键打包：导入 → 处理 → 桌面打包 → 检查 → 试跑 → 两个客户端联机测试 → 安卓打包 → 检查 → 模拟器试跑 → Steam → 报告
// 全程只调用本地工具，不调用任何 AI 服务。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { PATHS, Recorder, StopBuild, resetDir, timestamp } from './lib/common.mjs';

const recorder = new Recorder();
const buildId = timestamp(recorder.startedAt);
// 每次构建随机生成试跑钥匙，只留在这台电脑的内存里
const smokeKey = crypto.randomBytes(24).toString('hex');
const data = { buildId };

console.log('══════════════════════════════════════');
console.log('  网页游戏 · 一键打包（Steam / 安卓）');
console.log('══════════════════════════════════════');

try {
  data.cfg = await recorder.step('读取配置', async (ctx) => {
    const { loadConfig } = await import('./lib/setup.mjs');
    return loadConfig(ctx);
  });
  await recorder.step('准备工具（首次运行会自动下载）', async (ctx) => {
    const { ensureDeps } = await import('./lib/setup.mjs');
    await ensureDeps(ctx, data.cfg);
  });

  // 依赖就绪后才能加载用到第三方库的模块
  const { importGame, processGame } = await import('./lib/game.mjs');
  const { makeIcons } = await import('./lib/icon.mjs');
  const { TARGETS, assembleApp, packPlatform } = await import('./lib/pack.mjs');
  const { verifyOutputs, smokeTest } = await import('./lib/verify.mjs');
  const { steamStep } = await import('./lib/steam.mjs');
  const { packAndroid, verifyAndroid, smokeAndroid } = await import('./lib/android.mjs');
  const { collectLogs } = await import('./lib/logs.mjs');

  resetDir(PATHS.build);
  resetDir(PATHS.output);
  fs.mkdirSync(PATHS.assets, { recursive: true });
  fs.mkdirSync(PATHS.work, { recursive: true });

  const imported = await recorder.step('导入游戏包', (ctx) => importGame(ctx));
  data.processed = await recorder.step('处理游戏文件（标题、底色、代码混淆）', (ctx) => processGame(ctx, data.cfg, imported));
  const icons = await recorder.step('生成图标', (ctx) => makeIcons(ctx, data.cfg, data.processed), { critical: false });
  const appDir = await recorder.step('组装桌面程序', (ctx) => assembleApp(ctx, data.cfg, data.processed, buildId, smokeKey));

  data.packs = [];
  for (const key of data.cfg.platforms.filter((k) => TARGETS[k])) {
    const target = TARGETS[key];
    const pack = await recorder.step(`打包 ${target.label}`, (ctx) => {
      // Mac 程序改动后必须用 macOS 自带的 codesign 重新签名，否则 Apple 芯片的 Mac 拒绝运行
      if (target.platform === 'darwin' && process.platform !== 'darwin') {
        ctx.skip('Mac 版需要在 Mac 电脑上打包（要用 macOS 自带的签名工具），本次跳过');
        return null;
      }
      return packPlatform(ctx, data.cfg, target, appDir, icons);
    }, { critical: false });
    if (pack) data.packs.push(pack);
  }
  if (data.packs.length) {
    await recorder.step('产物检查', (ctx) => verifyOutputs(ctx, data.cfg, data.packs, data.processed), { critical: false });
    if (data.cfg.smokeTest) {
      data.smoke = await recorder.step('自动试跑', (ctx) => smokeTest(ctx, data.cfg, data.packs, smokeKey), { critical: false });
    }
    // 两个打好的程序在这台电脑上用本机假 Steam 联机（套件游戏）；真 Steam 那一段用测试版的联机自检
    if (data.cfg.smokeTest && data.cfg.duo.enabled) {
      const { duoTest } = await import('./lib/duo.mjs');
      data.duo = await recorder.step('两个客户端联机测试', (ctx) => duoTest(ctx, data.cfg, data.packs, smokeKey), { critical: false });
    }
  }

  if (data.cfg.platforms.includes('android')) {
    data.android = await recorder.step('打包 安卓版', (ctx) => packAndroid(ctx, data.cfg, data.processed, icons, buildId), { critical: false });
    if (data.android) {
      await recorder.step('安卓产物检查', (ctx) => verifyAndroid(ctx, data.cfg, data.android, data.processed), { critical: false });
      if (data.cfg.android.smokeTest) {
        data.androidSmoke = await recorder.step('安卓模拟器试跑', (ctx) => smokeAndroid(ctx, data.cfg, data.android), { critical: false });
      }
    }
  }
  if (!data.packs.length && !data.android) throw new StopBuild('没有任何平台打包成功');
  data.logs = await recorder.step('整理日志', (ctx) => collectLogs(ctx, data.cfg, { smoke: data.smoke, buildId }), { critical: false });
  if (data.packs.length) data.steam = await recorder.step('Steam 上传', (ctx) => steamStep(ctx, data.cfg, data.packs, buildId), { critical: false });
} catch (err) {
  if (!(err instanceof StopBuild)) {
    recorder.steps.push({ title: '意外错误', status: 'failed', notes: [], warnings: [], error: err && err.stack ? err.stack : String(err) });
    recorder.log(`\n❌ 意外错误：${err && err.stack ? err.stack : err}`);
  }
}

// 中间文件（打包暂存、安卓工程编译产物）用完即删，产物在 build/ 下的各平台文件夹里
if (!process.env.MC_KEEP_WORK) fs.rmSync(PATHS.work, { recursive: true, force: true });

let reportFile = null;
try {
  fs.mkdirSync(PATHS.assets, { recursive: true });
  const { writeReport } = await import('./lib/report.mjs');
  reportFile = writeReport(recorder, data);
} catch (err) {
  console.error(`报告生成失败：${err.message}`);
}

console.log('\n══════════════════════════════════════');
if (recorder.failed) console.log('  ❌ 有步骤失败，详情看报告');
else if (recorder.warnings.length) console.log(`  ⚠️  完成，有 ${recorder.warnings.length} 条提醒`);
else console.log('  ✅ 全部完成');
const skipped = recorder.steps.filter((s) => s.status === 'skipped').map((s) => s.title);
if (skipped.length) console.log(`  ⏭️  跳过：${skipped.join('、')}（原因见报告）`);
if (reportFile) console.log(`  报告：${reportFile}`);
console.log('══════════════════════════════════════');

if (reportFile && !process.env.MC_NO_OPEN) {
  const opener = process.platform === 'darwin' ? ['open', [reportFile]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', reportFile]] : ['xdg-open', [reportFile]];
  try {
    spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // 打不开浏览器不影响结果
  }
}
process.exitCode = recorder.failed ? 1 : 0;
