// 日志：收集本机试跑日志，整理「收到的日志」里测试者发来的文件，生成摘要。
// 同时镜像一份到技能目录的 .ai/logs/<程序名>/（不进 Git），方便直接交给 AI 查问题。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS, ROOT, readText, writeText } from './common.mjs';

export const FEEDBACK_DIR = path.join(ROOT, '收到的日志');
const LOG_EXT = /\.(txt|log|jsonl)$/i;

export function skillLogDir(cfg) {
  const candidates = [process.env.WGP_SKILL_DIR];
  try {
    candidates.push(JSON.parse(readText(path.join(ROOT, '.wgp.json'))).skillDir);
  } catch {
    // 老项目没有 .wgp.json
  }
  // 打包工具链已并入金牌制作人；老项目的 .wgp.json 可能还指向已删除的 web-game-packager
  candidates.push(path.join(os.homedir(), '.claude', 'skills', 'gold-medal-producer'), path.join(os.homedir(), '.codex', 'skills', 'gold-medal-producer'));
  const skill = candidates.find((d) => d && fs.existsSync(path.join(d, 'SKILL.md')));
  return skill ? path.join(skill, '.ai', 'logs', cfg.executableName) : null;
}

// 解析日志：导出文件（带 === 小节 === 的文本）或原始 .jsonl 都支持
export function parseLog(text) {
  const entries = [];
  const sections = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(/^=== (.+) ===$/);
    if (head) { current = head[1]; continue; }
    if (line.startsWith('{')) {
      try {
        const e = JSON.parse(line);
        // 只有带时间和级别的才是日志行（导出文件里的显卡信息等也是 JSON）
        if (e && e.t && e.lvl) { entries.push(e); continue; }
      } catch { /* 不是日志行 */ }
    }
    if (current && line && !current.startsWith('日志')) sections[current] = sections[current] ? `${sections[current]}\n${line}` : line;
  }
  return { entries, sections };
}

const normalize = (msg) => String(msg)
  .replace(/blob:[^\s)]+/g, 'blob:…')
  .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '…')
  .replace(/\d+(\.\d+)?/g, '#')
  .slice(0, 160);

export function summarize({ entries, sections }) {
  const counts = { error: 0, warn: 0, info: 0, debug: 0 };
  const groups = new Map();
  const fps = [];
  let env = null;
  let crashes = 0;
  let hangs = 0;
  const selfcheck = [];
  const online = [];
  for (const e of entries) {
    // 测试版的联机自检（两台电脑、两个 Steam 账号）和 Steam 房间过程
    if (e.src === 'selfcheck' && /联机自检(通过|没通过|出错)|发起联机自检/.test(e.msg)) selfcheck.push({ t: e.t, msg: e.msg, data: e.data || {} });
    if (e.src === 'steam' && /房间|加入请求|接受|拒绝|连接失败|没有发出/.test(e.msg) && online.length < 30) online.push(`${e.t || ''} ${e.msg}`);
    counts[e.lvl] = (counts[e.lvl] || 0) + 1;
    if (e.src === 'env' && e.msg === '启动' && !env) env = e.data || null;
    if (e.src === 'perf' && e.data && typeof e.data.fps === 'number') fps.push(e.data.fps);
    if (/渲染进程退出|子进程退出|主进程未捕获异常|FATAL|崩溃/.test(e.msg)) crashes += 1;
    if (/没有响应|卡死/.test(e.msg)) hangs += 1;
    if (e.lvl === 'error' || e.lvl === 'warn') {
      const key = `${e.lvl}|${normalize(e.msg)}`;
      const g = groups.get(key) || { lvl: e.lvl, msg: String(e.msg).slice(0, 300), count: 0, first: e.t, where: e.data && (e.data.source || e.data.stack) ? String(e.data.source || e.data.stack).slice(0, 200) : '' };
      g.count += 1;
      groups.set(key, g);
    }
  }
  const sorted = [...groups.values()].sort((a, b) => (a.lvl === b.lvl ? b.count - a.count : a.lvl === 'error' ? -1 : 1));
  return {
    env, sections, counts, crashes, hangs, groups: sorted, selfcheck, online,
    fps: fps.length ? { min: Math.min(...fps), avg: Math.round(fps.reduce((s, v) => s + v, 0) / fps.length), samples: fps.length } : null,
    from: entries[0] && entries[0].t, to: entries.length ? entries[entries.length - 1].t : null,
  };
}

export function summaryMarkdown(title, s) {
  const lines = [`## ${title}`, ''];
  if (s.env) lines.push(`- 游戏版本：${s.env.version || '?'}（构建 ${s.env.buildId || '?'}）${s.env.debugLog ? '，测试版' : ''}`, `- 系统：${s.env.os || s.env.device || '?'}，CPU ${s.env.cpu || '?'}，内存 ${s.env.memoryGB || '?'} GB`);
  if (s.sections['系统']) lines.push(`- 导出时的系统信息：${s.sections['系统'].replace(/\n/g, ' ')}`);
  lines.push(`- 时间范围：${s.from || '?'} → ${s.to || '?'}`);
  lines.push(`- 条数：报错 ${s.counts.error}，警告 ${s.counts.warn}，信息 ${s.counts.info}，详细 ${s.counts.debug}`);
  lines.push(`- 崩溃 ${s.crashes} 次，卡死 ${s.hangs} 次${s.fps ? `，帧率 最低 ${s.fps.min} / 平均 ${s.fps.avg}（${s.fps.samples} 次采样）` : ''}`);
  for (const c of s.selfcheck || []) {
    if (/发起/.test(c.msg)) { lines.push(`- ${c.t || ''} 房主发起联机自检`); continue; }
    lines.push(`- **${c.msg}**（${c.t || ''}）`);
    for (const x of c.data.problems || []) lines.push(`  - 问题：${x}`);
    for (const x of c.data.facts || []) lines.push(`  - ${x}`);
  }
  if ((s.online || []).length) lines.push('', '<details><summary>Steam 房间与连接过程</summary>', '', ...s.online.map((x) => `- ${x}`), '', '</details>');
  if (s.groups.length) {
    lines.push('', '| 级别 | 次数 | 首次 | 内容 | 位置 |', '|---|---|---|---|---|');
    for (const g of s.groups.slice(0, 20)) {
      lines.push(`| ${g.lvl === 'error' ? '报错' : '警告'} | ${g.count} | ${g.first || ''} | ${g.msg.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${g.where.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    }
  } else {
    lines.push('- 没有报错或警告');
  }
  return `${lines.join('\n')}\n`;
}

// 收集本机试跑日志 + 整理收到的日志；返回给报告用的数据
export function collectLogs(ctx, cfg, { smoke, buildId }) {
  const mirror = skillLogDir(cfg);
  const result = { mirror, smoke: null, feedback: [] };
  const parts = [`# ${cfg.gameName} 日志摘要`, '', `生成时间：${new Date().toLocaleString('zh-CN')}`, ''];

  if (smoke && smoke.logFile && fs.existsSync(smoke.logFile)) {
    const text = readText(smoke.logFile);
    fs.copyFileSync(smoke.logFile, path.join(PATHS.assets, '本机试跑日志.jsonl'));
    if (mirror) writeText(path.join(mirror, `本机试跑-${buildId}.jsonl`), text);
    result.smoke = summarize(parseLog(text));
    parts.push(summaryMarkdown(`本机试跑（构建 ${buildId}）`, result.smoke));
    ctx.note(`本机试跑日志：报错 ${result.smoke.counts.error} 条，警告 ${result.smoke.counts.warn} 条`);
  }

  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  const files = fs.readdirSync(FEEDBACK_DIR).filter((f) => LOG_EXT.test(f) && !f.startsWith('.')).sort();
  for (const file of files) {
    const text = readText(path.join(FEEDBACK_DIR, file));
    const parsed = parseLog(text);
    if (!parsed.entries.length) {
      ctx.warn(`「收到的日志/${file}」里没有可识别的日志内容`);
      continue;
    }
    const s = summarize(parsed);
    result.feedback.push({ file, ...s });
    parts.push(summaryMarkdown(`测试者日志：${file}`, s));
    if (mirror) writeText(path.join(mirror, '反馈', file), text);
  }
  if (files.length) ctx.note(`整理了「收到的日志」里的 ${result.feedback.length} 个文件`);
  const md = parts.join('\n');
  writeText(path.join(PATHS.output, '日志摘要.md'), md);
  if (mirror) {
    writeText(path.join(mirror, '日志摘要.md'), md);
    ctx.note(`日志已同步到技能目录：${mirror}`);
  } else {
    ctx.warn('没找到金牌制作人技能目录，日志只保存在项目的「输出」里');
  }
  return result;
}
