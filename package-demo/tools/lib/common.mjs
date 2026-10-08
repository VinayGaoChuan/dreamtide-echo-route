// 通用：路径、配置读取、步骤记录、子进程
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PATHS = {
  config: path.join(ROOT, '配置.jsonc'),
  input: path.join(ROOT, '放游戏包'),
  output: path.join(ROOT, '输出'),
  assets: path.join(ROOT, '输出', '报告素材'),
  build: path.join(ROOT, 'build'),
  work: path.join(ROOT, 'build', 'work'),
  shell: path.join(ROOT, 'shell'),
  tools: path.join(ROOT, 'tools'),
};

export const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

// 带 // 和 /* */ 注释的 JSON
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1'));
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

export function dirSize(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, name) => sum + dirSize(path.join(target, name)), 0);
}

export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      shell: options.shell || false,
      windowsHide: !options.inherit,
    });
    let stdout = '';
    let stderr = '';
    if (!options.inherit) {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    let timer = null;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`运行超时（${Math.round(options.timeoutMs / 1000)} 秒）：${path.basename(command)}`));
      }, options.timeoutMs);
    }
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

const ICON = { ok: '✅', warn: '⚠️', skipped: '⏭️', failed: '❌' };
export const STATUS_ICON = ICON;

// 步骤记录：每一步的状态、说明、警告都进报告
export class Recorder {
  constructor() {
    this.steps = [];
    this.lines = [];
    this.startedAt = new Date();
  }

  log(message) {
    console.log(message);
    this.lines.push(message);
  }

  async step(title, fn, { critical = true } = {}) {
    const step = { title, status: 'running', notes: [], warnings: [], startedAt: Date.now() };
    this.steps.push(step);
    this.log(`\n▶ ${title}`);
    const ctx = {
      note: (message) => { step.notes.push(message); this.log(`   · ${message}`); },
      warn: (message) => {
        step.warnings.push(message);
        if (step.status === 'running') step.status = 'warn';
        this.log(`   ⚠️ ${message}`);
      },
      skip: (message) => { step.status = 'skipped'; step.notes.push(message); this.log(`   ⏭️ ${message}`); },
      fail: (message) => { step.status = 'failed'; step.error = step.error ? `${step.error}；${message}` : message; this.log(`   ❌ ${message}`); },
    };
    try {
      const value = await fn(ctx);
      if (step.status === 'running') step.status = 'ok';
      step.ms = Date.now() - step.startedAt;
      const word = { skipped: '已跳过', failed: '未通过' }[step.status] || '完成';
      this.log(`   ${ICON[step.status]} ${word}（${(step.ms / 1000).toFixed(1)} 秒）`);
      return value;
    } catch (err) {
      step.status = 'failed';
      step.error = err && err.message ? err.message : String(err);
      step.ms = Date.now() - step.startedAt;
      this.log(`   ❌ 失败：${step.error}`);
      if (process.env.MC_DEBUG && err && err.stack) this.log(err.stack);
      if (critical) throw new StopBuild(title);
      return undefined;
    }
  }

  get failed() {
    return this.steps.some((s) => s.status === 'failed');
  }

  get warnings() {
    return this.steps.flatMap((s) => s.warnings.map((w) => `${s.title}：${w}`));
  }
}

export class StopBuild extends Error {}
