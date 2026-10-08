'use strict';
// 运行日志：每次启动一个 .jsonl 文件，写在 userData/logs/，保留最近 10 次。
// 正式版只记环境、报错、崩溃；测试版（配置 debugLog: true）额外记录控制台输出、帧率、内存、存档同步等。
// 每行一条 JSON：{ t, lvl, src, msg, data }，lvl 为 debug / info / warn / error。
const fs = require('node:fs');
const path = require('node:path');

const MAX_LINES = 20000;
const KEEP_FILES = 10;

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

class Logger {
  constructor({ dir, verbose }) {
    this.dir = dir;
    this.verbose = verbose;
    this.lines = 0;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const old = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
      for (const f of old.slice(0, Math.max(0, old.length - (KEEP_FILES - 1)))) fs.rmSync(path.join(dir, f), { force: true });
    } catch {
      // 日志目录不可写时不影响游戏
    }
    this.file = path.join(dir, `${stamp()}.jsonl`);
  }

  write(lvl, src, msg, data) {
    if (lvl === 'debug' && !this.verbose) return;
    if (this.lines >= MAX_LINES) return;
    this.lines += 1;
    const entry = { t: new Date().toISOString(), lvl, src, msg: String(msg).slice(0, 4000) };
    if (data !== undefined) entry.data = data;
    try {
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // 同上
    }
  }

  debug(src, msg, data) { this.write('debug', src, msg, data); }
  info(src, msg, data) { this.write('info', src, msg, data); }
  warn(src, msg, data) { this.write('warn', src, msg, data); }
  error(src, msg, data) { this.write('error', src, msg, data); }

  // 把全部日志（新的在前，最多约 8 MB）和附加信息合成一个文本文件，方便测试者发送
  exportTo(target, header, extras = []) {
    const parts = [`=== ${header} ===`, `导出时间 ${new Date().toISOString()}`, ''];
    for (const [title, text] of extras) parts.push(`=== ${title} ===`, text, '');
    let budget = 8 * 1024 * 1024;
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
    for (const f of files) {
      const text = fs.readFileSync(path.join(this.dir, f), 'utf8');
      if (text.length > budget) break;
      budget -= text.length;
      parts.push(`=== 日志 ${f} ===`, text);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, parts.join('\n'), 'utf8');
    return target;
  }
}

module.exports = { Logger, stamp };
