// 产物检查（不运行程序也能做的静态检查）+ 本机自动试跑
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import * as ResEdit from 'resedit';
import { PATHS, resetDir, run, writeText } from './common.mjs';
import { decodeEntry, gameScriptIds, parseBundle, sha1 } from './game.mjs';
import { FUSES, asarPath, binaryPath, executablePath } from './pack.mjs';

const REQUIRED_IN_ASAR = ['main.js', 'preload.js', 'logger.js', 'bot.js', 'steam-bridge.js', 'app-config.json', 'package.json', 'game/index.html'];

function asarFiles(file) {
  return new Set(asar.listPackage(file, {}).map((p) => p.replace(/\\/g, '/').replace(/^\//, '')));
}

function checkFuses(wire) {
  const problems = [];
  for (const [index, wanted] of Object.entries(FUSES)) {
    const state = wire[index];
    const ok = wanted ? state === FuseState.ENABLE : state === FuseState.DISABLE;
    if (!ok) problems.push(FuseV1Options[index]);
  }
  return problems;
}

function windowsIntegrity(exe, archive) {
  const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe));
  const res = ResEdit.NtExecutableResource.from(pe);
  const entry = res.entries.find((e) => e.type === 'INTEGRITY');
  if (!entry) return { ok: false, reason: 'exe 里没有 INTEGRITY 资源' };
  const list = JSON.parse(Buffer.from(entry.bin).toString('utf8'));
  const expected = crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
  const record = list.find((r) => /app\.asar$/i.test(r.file));
  return { ok: Boolean(record && record.value === expected), reason: record ? '哈希不一致' : '没有 app.asar 记录' };
}

export async function verifyOutputs(ctx, cfg, packs, processed) {
  const report = {};
  for (const pack of packs) {
    const { target, dir } = pack;
    const r = { label: target.label, checks: [] };
    report[target.key] = r;
    const add = (ok, text) => {
      r.checks.push({ ok, text });
      if (ok) ctx.note(`${target.label}：${text}`);
      else ctx.warn(`${target.label}：${text}`);
    };

    const exe = executablePath(target, cfg, dir);
    add(fs.existsSync(exe), `主程序 ${path.relative(PATHS.build, exe)} ${fs.existsSync(exe) ? '存在' : '缺失'}`);
    const archive = asarPath(target, cfg, dir);
    if (!fs.existsSync(archive)) {
      add(false, 'app.asar 缺失');
      continue;
    }
    const files = asarFiles(archive);
    const missing = REQUIRED_IN_ASAR.filter((f) => !files.has(f));
    add(!missing.length, missing.length ? `归档缺少：${missing.join('、')}` : '游戏与外壳都已打进 app.asar');

    const unpacked = path.join(`${archive}.unpacked`, 'node_modules', 'steamworks.js', 'dist');
    const present = fs.existsSync(unpacked) ? fs.readdirSync(unpacked) : [];
    const native = present.includes(target.steamDir) ? fs.readdirSync(path.join(unpacked, target.steamDir)) : [];
    const needLib = target.platform === 'win32' ? 'steam_api64.dll' : 'libsteam_api.dylib';
    add(native.includes(needLib) && native.some((n) => n.endsWith('.node')) && present.length === 1,
      `Steam 原生库：${native.join('、') || '缺失'}${present.length > 1 ? `（多余平台：${present.filter((p) => p !== target.steamDir).join('、')}）` : ''}`);

    const problems = checkFuses(await getCurrentFuseWire(binaryPath(target, cfg, dir)));
    add(!problems.length, problems.length ? `加固开关未生效：${problems.join('、')}` : '加固开关全部生效');
    if (target.platform === 'win32') {
      const integrity = windowsIntegrity(exe, archive);
      add(integrity.ok, integrity.ok ? 'exe 内嵌的 asar 完整性哈希正确（改动 app.asar 会拒绝启动）' : `完整性校验异常：${integrity.reason}`);
      const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe));
      const icons = ResEdit.NtExecutableResource.from(pe).entries.filter((e) => e.type === 14);
      add(true, `exe 图标资源 ${icons.length ? '已写入' : '未写入（默认图标）'}`);
    } else {
      const plist = fs.readFileSync(path.join(dir, `${cfg.executableName}.app`, 'Contents', 'Info.plist'), 'utf8');
      add(plist.includes('ElectronAsarIntegrity'), plist.includes('ElectronAsarIntegrity') ? 'Info.plist 已写入 asar 完整性哈希' : 'Info.plist 缺少完整性哈希');
      const sign = await run('codesign', ['--verify', '--deep', '--strict', binaryPath(target, cfg, dir)]);
      add(sign.code === 0, sign.code === 0 ? '签名校验通过（本机临时签名，可直接运行）' : `签名校验失败：${sign.stderr.trim()}`);
    }

    if (processed.stats.mode === 'bundle' && processed.stats.obfuscated) {
      const html = asar.extractFile(archive, 'game/index.html').toString('utf8');
      const bundle = parseBundle(html);
      const shipped = new Set(gameScriptIds(bundle).map((id) => sha1(decodeEntry(bundle.manifest[id]).toString('utf8'))));
      const original = processed.stats.scripts.filter((s) => shipped.has(s.originalHash)).length;
      const obfuscated = processed.stats.scripts.filter((s) => shipped.has(s.shippedHash)).length;
      const ok = original === 0 && obfuscated === processed.stats.scripts.length;
      add(ok, ok ? '包内游戏代码已是混淆后的版本' : `包内游戏代码与混淆结果不一致（原始 ${original} 段，混淆 ${obfuscated} 段）`);
    }
  }
  return report;
}

// ── 自动试跑 ──
function sameFile(a, b) {
  const h = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  return h(a) === h(b);
}

export async function smokeTest(ctx, cfg, packs, smokeKey) {
  const hostKey = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : null;
  const pack = packs.find((p) => p.target.key === hostKey);
  if (!pack) {
    ctx.skip(`这台电脑（${process.platform}）上没有可直接运行的版本，跳过试跑。${hostKey === 'mac' ? '在配置 platforms 里加上 "mac" 即可在本机试跑' : ''}`);
    return null;
  }
  const smokeDir = path.join(PATHS.work, 'smoke');
  resetDir(smokeDir);
  writeText(path.join(smokeDir, 'userdata', 'save', 'save.json'), JSON.stringify({ savedAt: Date.now(), items: { __mc_smoke_restore: 'ok' } }));

  const exe = executablePath(pack.target, cfg, pack.dir);
  const botSeconds = cfg.bot.enabled ? cfg.bot.seconds : 0;
  ctx.note(`启动 ${pack.target.label}，自动点击、截图${botSeconds ? `，再让机器人试玩 ${botSeconds} 秒` : ''}（约 ${cfg.smoke.bootSeconds + cfg.smoke.clicks * cfg.smoke.stepSeconds + 3 + botSeconds} 秒，会弹出游戏窗口）…`);
  const proc = await run(exe, [], { env: { MC_SMOKE_OUT: smokeDir, MC_SMOKE_KEY: smokeKey }, timeoutMs: (cfg.smoke.timeoutSeconds + botSeconds + 60) * 1000 });
  const resultFile = path.join(smokeDir, 'smoke-result.json');
  if (!fs.existsSync(resultFile)) {
    throw new Error(`游戏没有正常跑完试跑流程（退出码 ${proc.code}）。${proc.stderr.trim().split('\n').slice(-3).join(' ')}`);
  }
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  result.exitCode = proc.code;
  for (const shot of [...(result.shots || []), ...((result.bot && result.bot.shots) || [])]) {
    fs.copyFileSync(path.join(smokeDir, shot.file), path.join(PATHS.assets, shot.file));
  }

  if (!result.ok) throw new Error(`试跑中断：${result.error || result.steps.join(' → ')}`);
  ctx.note(`流程：${result.steps.join(' → ')}`);

  const shots = result.shots || [];
  const dark = shots.filter((s) => s.litRatio < 0.02);
  if (dark.length) ctx.warn(`${dark.length} 张截图几乎全黑：${dark.map((s) => s.file).join('、')}`);
  else ctx.note(`截图 ${shots.length} 张，画面正常（非黑屏）`);
  if (shots.length >= 2) {
    const last = path.join(smokeDir, shots[shots.length - 1].file);
    const first = path.join(smokeDir, shots[0].file);
    if (sameFile(first, last)) ctx.warn('点击前后画面完全相同，游戏可能没有响应点击');
    else ctx.note('点击后画面有变化，游戏在响应输入');
  }

  const placeholder = (s) => /%7B%7B|\{\{/.test(s);
  const realMissing = result.missing.filter((m) => !placeholder(m));
  const placeholderCount = result.missing.length - realMissing.length;
  if (realMissing.length) ctx.warn(`游戏请求了不存在的文件：${[...new Set(realMissing)].slice(0, 5).join('、')}`);
  if (placeholderCount) ctx.note(`模板占位符请求 ${placeholderCount} 次（游戏自身的小问题，不影响运行）`);

  const realErrors = result.consoleErrors.filter((e) => !(/Failed to load resource/.test(e.message) && (!e.source || placeholder(e.source) || !realMissing.length)));
  const uncaught = realErrors.filter((e) => /Uncaught/.test(e.message));
  if (uncaught.length) ctx.fail(`游戏运行时出现未捕获的错误 ${uncaught.length} 条（玩家会看到报错条）：${uncaught.slice(0, 3).map((e) => e.message.slice(0, 120)).join(' | ')}`);
  else if (realErrors.length) ctx.warn(`脚本报错 ${realErrors.length} 条：${realErrors.slice(0, 3).map((e) => e.message.slice(0, 120)).join(' | ')}`);
  else ctx.note('没有脚本报错');

  if (result.blocked.length) ctx.warn(`游戏尝试联网 ${result.blocked.length} 次（已拦截）：${[...new Set(result.blocked)].slice(0, 3).join('、')}`);
  else ctx.note('全程没有任何联网请求（完全离线可玩）');

  if (result.crashes.length) ctx.warn(`渲染进程崩溃：${result.crashes.join('、')}`);
  if (typeof result.fps === 'number') {
    if (result.fps < 30) ctx.warn(`帧率偏低：${result.fps} 帧/秒`);
    else ctx.note(`帧率：${result.fps} 帧/秒`);
  }
  if (result.save && result.save.restored && result.save.exported) ctx.note('存档同步正常：云端存档能写回游戏，游戏存档能导出成文件');
  else ctx.warn(`存档同步异常：写回 ${result.save && result.save.restored ? '正常' : '失败'}，导出 ${result.save && result.save.exported ? '正常' : '失败'}`);
  if (result.logExport) ctx.note('日志导出正常（测试者按 Ctrl+Shift+L 得到的文件里有完整日志）');
  else ctx.warn('日志导出自检失败');

  const bot = result.bot;
  if (bot) {
    const fps = bot.fps.length ? `帧率最低 ${Math.min(...bot.fps)} / 平均 ${Math.round(bot.fps.reduce((s, v) => s + v, 0) / bot.fps.length)}` : '没有帧率数据';
    const who = bot.kitBot ? `游戏自带的机器人试玩 ${bot.elapsed} 秒` : `机器人试玩 ${bot.elapsed} 秒：操作 ${bot.actions} 次（点击 ${bot.clicks}，按键 ${bot.keys}）`;
    ctx.note(`${who}，经过 ${bot.screens} 个不同画面，${fps}${bot.heapStart !== null ? `，内存 ${bot.heapStart}→${bot.heapEnd} MB` : ''}`);
    if (bot.crashed) ctx.fail('机器人试玩时游戏崩溃了');
    if (bot.errors > 0) ctx.fail(`机器人试玩时出现 ${bot.errors} 条报错（最后的操作记录见报告）`);
    if (bot.hangs > 0) ctx.warn(`页面有 ${bot.hangs} 次超过 5 秒没有响应`);
    if (bot.stalls > 0) ctx.warn(`画面有 ${bot.stalls} 次 30 秒完全不变（可能卡在某个界面，看报告里的机器人截图）`);
    if (bot.kitBot && !bot.kit) ctx.warn('游戏自带的机器人没有交回报告');
    if (bot.kit) {
      ctx.note(`游戏自带的机器人走过的画面：${bot.kit.scenes.join('、') || '无'}`);
      if (bot.kit.errors > 0) ctx.fail(`游戏自己记下 ${bot.kit.errors} 条报错：${bot.kit.errorSample.join('；')}`);
      if (bot.kit.issues > 0) ctx.warn(`游戏自带的检查发现 ${bot.kit.issues} 处文字或布局问题：${bot.kit.issueSample.join('；')}`);
    }
    if (bot.screens < 3) ctx.warn(`机器人只到过 ${bot.screens} 个画面，可能没能推进游戏（可在配置 bot.prefer 里加上关键按钮的文字）`);
  }

  const steamState = result.steam.state;
  if (steamState === 'module-loaded') ctx.note('Steam 组件在打包后的程序里加载成功（还没填 App ID，正版校验未启用）');
  else if (steamState === 'ready') ctx.note('已连上 Steam，当前账号拥有这款游戏，正版校验通过');
  else if (steamState === 'init-failed') ctx.note(`正版校验已启用：这台电脑没有通过 Steam 运行本游戏（${result.steam.message}），正式版在这种情况下会拒绝启动`);
  else ctx.warn(`Steam 组件加载异常：${steamState} ${result.steam.message}`);
  result.realErrors = realErrors;
  result.realMissing = realMissing;
  result.placeholderCount = placeholderCount;
  return result;
}
