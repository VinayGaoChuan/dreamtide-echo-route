// 导入游戏包 + 处理游戏文件（改标题、启动底色、代码混淆）
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as acorn from 'acorn';
import AdmZip from 'adm-zip';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { PATHS, formatBytes, resetDir, writeText } from './common.mjs';

export const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

const BUNDLE_MARKER = '__bundler/manifest';
const RUNTIME_MARKER = 'dc-runtime';

function decodeName(raw) {
  for (const encoding of ['utf-8', 'gbk']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(raw);
    } catch {
      // 换下一种编码
    }
  }
  return Buffer.from(raw).toString('latin1');
}

// ── 导入：取「放游戏包」里最新的 .zip / .html ──
export function importGame(ctx) {
  fs.mkdirSync(PATHS.input, { recursive: true });
  const files = fs.readdirSync(PATHS.input)
    .filter((name) => /\.(zip|html?)$/i.test(name) && !name.startsWith('.'))
    .map((name) => ({ name, full: path.join(PATHS.input, name), mtime: fs.statSync(path.join(PATHS.input, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error('「放游戏包」文件夹里没有 .zip 或 .html 文件，请把导出的游戏包放进去');
  const source = files[0];
  if (files.length > 1) ctx.note(`文件夹里有 ${files.length} 个包，使用最新修改的那个`);
  ctx.note(`游戏包：${source.name}（${formatBytes(fs.statSync(source.full).size)}）`);

  if (/\.html?$/i.test(source.name)) {
    const html = fs.readFileSync(source.full, 'utf8');
    if (!html.includes(BUNDLE_MARKER)) ctx.note('普通单文件网页（不是"分享版"格式；金牌制作人套件的游戏就是这种），外部网络资源在下一步检查');
    return { mode: html.includes(BUNDLE_MARKER) ? 'bundle' : 'single', html, sourceName: source.name, entryName: source.name };
  }

  const zip = new AdmZip(source.full);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const htmlEntries = entries
    .map((e) => ({ entry: e, name: decodeName(e.rawEntryName) }))
    .filter((e) => /\.html?$/i.test(e.name));
  const bundles = htmlEntries
    .map((e) => ({ ...e, data: e.entry.getData() }))
    .filter((e) => e.data.includes(BUNDLE_MARKER))
    .sort((a, b) => b.data.length - a.data.length);
  if (bundles.length) {
    const pick = bundles[0];
    ctx.note(`压缩包共 ${entries.length} 个文件，识别到分享版单文件：${pick.name}（${formatBytes(pick.data.length)}）`);
    if (bundles.length > 1) ctx.note(`另有 ${bundles.length - 1} 个分享版文件，已选最大的那个`);
    return { mode: 'bundle', html: pick.data.toString('utf8'), sourceName: source.name, entryName: pick.name };
  }

  // 没有分享版：找 index.html 所在的文件夹整体打包
  const index = htmlEntries
    .filter((e) => /(^|\/)index\.html?$/i.test(e.name))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  if (!index) {
    throw new Error('压缩包里既没有"分享版"单文件 HTML，也没有 index.html。请导出分享版，或把游戏文件夹（含 index.html）打成 zip');
  }
  const base = index.name.includes('/') ? index.name.slice(0, index.name.lastIndexOf('/') + 1) : '';
  const folder = path.join(PATHS.work, 'import');
  resetDir(folder);
  let count = 0;
  for (const entry of entries) {
    const name = decodeName(entry.rawEntryName);
    if (!name.startsWith(base)) continue;
    const rel = name.slice(base.length);
    const target = path.normalize(path.join(folder, rel));
    if (!target.startsWith(folder + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    count += 1;
  }
  ctx.note(`没有分享版单文件，改用文件夹模式：${base || '(根目录)'}index.html，共 ${count} 个文件`);
  return { mode: 'folder', folder, sourceName: source.name, entryName: index.name };
}

// ── 分享版格式：manifest 里按 uuid 存放资源（base64，可选 gzip）──
function scriptBlock(html, type) {
  const re = new RegExp(`(<script type="${type.replace('/', '\\/')}">)([\\s\\S]*?)(</script>)`);
  const match = html.match(re);
  return match ? { match, content: match[2] } : null;
}

export function parseBundle(html) {
  const block = scriptBlock(html, '__bundler/manifest');
  if (!block) throw new Error('分享版里找不到资源清单（__bundler/manifest）');
  const manifest = JSON.parse(block.content);
  const extBlock = scriptBlock(html, '__bundler/ext_resources');
  const ext = extBlock && extBlock.content.trim() ? JSON.parse(extBlock.content) : [];
  return { html, manifest, extIds: new Set(ext.map((e) => e.uuid)) };
}

export function decodeEntry(entry) {
  const buf = Buffer.from(entry.data, 'base64');
  return entry.compressed ? zlib.gunzipSync(buf) : buf;
}

function encodeEntry(entry, buf) {
  entry.data = (entry.compressed ? zlib.gzipSync(buf, { level: 9 }) : buf).toString('base64');
}

export function gameScriptIds(bundle) {
  return Object.entries(bundle.manifest)
    .filter(([id, entry]) => /javascript/.test(entry.mime || '') && !bundle.extIds.has(id))
    .filter(([, entry]) => !decodeEntry(entry).toString('utf8').includes(RUNTIME_MARKER))
    .map(([id]) => id);
}

function serializeBundle(bundle) {
  const block = scriptBlock(bundle.html, '__bundler/manifest');
  const json = JSON.stringify(bundle.manifest);
  return bundle.html.slice(0, block.match.index) + block.match[1] + json + block.match[3]
    + bundle.html.slice(block.match.index + block.match[0].length);
}

// 加载壳（模板展开前）改成游戏名 + 黑底，避免启动时闪一下白屏
function patchLoaderShell(html, gameName) {
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) return html;
  const safeName = gameName.replace(/[<>&"]/g, '');
  let head = html.slice(0, headEnd);
  head = /<title>[\s\S]*?<\/title>/.test(head)
    ? head.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${safeName}</title>`)
    : head.replace(/<head>/i, () => `<head>\n  <title>${safeName}</title>`);
  head = head.replace(/background:\s*#faf9f5/gi, 'background: #000');
  return head + html.slice(headEnd);
}

// ── 混淆：固定种子，同样的输入每次产出同样的结果 ──
const OBFUSCATOR_OPTIONS = {
  target: 'browser',
  seed: 20260923,
  compact: true,
  simplify: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  transformObjectKeys: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  numbersToExpressions: false,
  splitStrings: false,
  unicodeEscapeSequence: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: [],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersType: 'variable',
  stringArrayCallsTransform: false,
  sourceMap: false,
};

// 正式版强档（debugLog=false 时叠加在上面）：把字符串藏起来、拆开、包起来，数字写成表达式，再加一层抗美化/抗格式化的自卫壳，
// 让「直接读源码」「自动一键还原」这条最省力的路走不通。只开不伤帧率、不破坏套件跨脚本共享全局（K / MC）和对象键的项：
// 不开控制流扁平化（最吃帧率）、不开 renameGlobals / transformObjectKeys（会改掉跨脚本共享的全局名和对象键，游戏会崩）。
// 字符串数组解码后会被缓存，每帧重复取同一条文字只付一次解码成本。测试版（debugLog=true）不叠加，保留可读的报错栈。
const RELEASE_EXTRA = {
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  splitStrings: true,
  splitStringsChunkLength: 10,
  numbersToExpressions: true,
  selfDefending: true,
};

function declaredFunctionNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]{3,})\s*\(/g)) names.add(m[1]);
  return [...names];
}

export function residualNames(original, obfuscated) {
  const names = declaredFunctionNames(original);
  const kept = names.filter((n) => new RegExp(`\\bfunction\\s+${n.replace(/\$/g, '\\$')}\\s*\\(`).test(obfuscated));
  return { total: names.length, kept: kept.length, sample: kept.slice(0, 8) };
}

function hasTopLevelDeclarations(code) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  return ast.body.some((node) => /Declaration$/.test(node.type));
}

// 每段脚本单独混淆，但它们共享同一个全局作用域，而且分享版运行时可能把同一段脚本执行两次：
// - 不同的种子和全局名前缀，避免两段脚本生成同名全局变量；
// - 原代码最外层没有声明（全是自执行函数）时，把混淆结果整体包进函数作用域，重复执行也不冲突；
//   否则改用函数形式的字符串包装器，避免生成最外层 const。
function obfuscate(code, label, index, strong) {
  const wrap = !hasTopLevelDeclarations(code);
  let out = JavaScriptObfuscator.obfuscate(code, {
    ...OBFUSCATOR_OPTIONS,
    ...(strong ? RELEASE_EXTRA : {}),
    seed: OBFUSCATOR_OPTIONS.seed + index,
    identifiersPrefix: `_mc${index}`,
    stringArrayWrappersType: wrap ? 'variable' : 'function',
  }).getObfuscatedCode();
  if (wrap) out = `(function(){${out}\n})();`;
  try {
    new vm.Script(out, { filename: label });
  } catch (err) {
    throw new Error(`混淆后的代码无法解析（${label}）：${err.message}`);
  }
  return out;
}

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const EXTERNAL_REF = /\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi;

export function processGame(ctx, cfg, imported) {
  const gameDir = path.join(PATHS.work, 'game');
  resetDir(gameDir);
  const stats = { mode: imported.mode, scripts: [], obfuscated: false, thumbnailSvg: null };
  // 正式版（debugLog=false）用强档混淆；测试版保留可读报错栈。
  const strong = !cfg.debugLog;

  if (imported.mode === 'bundle') {
    const bundle = parseBundle(imported.html);
    const ids = gameScriptIds(bundle);
    ctx.note(`资源清单 ${Object.keys(bundle.manifest).length} 项，其中游戏代码 ${ids.length} 段（框架与 React 不动）`);
    for (const [index, id] of ids.entries()) {
      const entry = bundle.manifest[id];
      const original = decodeEntry(entry).toString('utf8');
      const info = { id, before: original.length, after: original.length, originalHash: sha1(original) };
      if (cfg.obfuscate) {
        const out = obfuscate(original, id, index, strong);
        encodeEntry(entry, Buffer.from(out, 'utf8'));
        info.after = out.length;
        info.shippedHash = sha1(out);
        info.residual = residualNames(original, out);
        info.excerpt = out.slice(0, 220);
      }
      stats.scripts.push(info);
    }
    stats.obfuscated = Boolean(cfg.obfuscate && ids.length);
    if (stats.obfuscated) {
      const kept = stats.scripts.reduce((s, x) => s + x.residual.kept, 0);
      const total = stats.scripts.reduce((s, x) => s + x.residual.total, 0);
      ctx.note(`混淆完成（${strong ? '正式版强档' : '测试版'}）：${stats.scripts.map((s) => `${formatBytes(s.before)}→${formatBytes(s.after)}`).join('，')}；原始函数名残留 ${kept}/${total}`);
    }
    let html = serializeBundle(bundle);
    html = patchLoaderShell(html, cfg.gameName);
    const svg = html.match(/<div id="__bundler_thumbnail">\s*(<svg[\s\S]*?<\/svg>)/);
    if (svg) stats.thumbnailSvg = svg[1].replace(/sc-camel-view-box=/g, 'viewBox=');
    writeText(path.join(gameDir, 'index.html'), html);
    ctx.note('窗口标题改为游戏名，启动底色改为黑色');
  } else if (imported.mode === 'single') {
    writeText(path.join(gameDir, 'index.html'), patchLoaderShell(imported.html, cfg.gameName));
    const refs = imported.html.match(EXTERNAL_REF) || [];
    if (refs.length) ctx.warn(`页面引用了 ${refs.length} 个外部网络资源，离线运行会缺失：${refs.slice(0, 3).join('，')}`);
    if (cfg.obfuscate) {
      // 单文件里的内联脚本逐段混淆（金牌制作人套件 build.py 的产物就是这种：一个离线 index.html，内联一段脚本）
      let index = 0;
      const html = fs.readFileSync(path.join(gameDir, 'index.html'), 'utf8').replace(INLINE_SCRIPT, (whole, attrs, code) => {
        if (!code.trim() || /\bsrc\s*=/i.test(attrs) || (/\btype\s*=/i.test(attrs) && !/\btype\s*=\s*["']?text\/javascript\b/i.test(attrs))) return whole;
        const label = `inline-${index + 1}`;
        const out = obfuscate(code, label, index, strong);
        stats.scripts.push({ id: label, before: code.length, after: out.length, residual: residualNames(code, out), excerpt: out.slice(0, 220) });
        index += 1;
        return `<script${attrs}>${out.replace(/<\/script/gi, '<\\/script')}</script>`;
      });
      writeText(path.join(gameDir, 'index.html'), html);
      stats.obfuscated = stats.scripts.length > 0;
      ctx.note(stats.obfuscated ? `混淆了 ${stats.scripts.length} 段内联脚本：${stats.scripts.map((s) => `${formatBytes(s.before)}→${formatBytes(s.after)}`).join('，')}` : '页面里没有内联脚本，没有可混淆的代码');
    }
  } else {
    fs.cpSync(imported.folder, gameDir, { recursive: true });
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    const files = walk(gameDir);
    for (const file of files.filter((f) => /\.html?$/i.test(f))) {
      const refs = fs.readFileSync(file, 'utf8').match(EXTERNAL_REF) || [];
      if (refs.length) ctx.warn(`${path.relative(gameDir, file)} 引用了外部网络资源，离线运行会缺失：${refs.slice(0, 3).join('，')}`);
    }
    if (cfg.obfuscate) {
      for (const [index, file] of files.filter((f) => /\.m?js$/i.test(f) && !/\.min\.js$/i.test(f)).entries()) {
        const original = fs.readFileSync(file, 'utf8');
        const out = obfuscate(original, path.relative(gameDir, file), index, strong);
        fs.writeFileSync(file, out, 'utf8');
        stats.scripts.push({ id: path.relative(gameDir, file), before: original.length, after: out.length, residual: residualNames(original, out), excerpt: out.slice(0, 220) });
      }
      stats.obfuscated = stats.scripts.length > 0;
      ctx.note(`混淆了 ${stats.scripts.length} 个脚本（跳过 .min.js）`);
    }
    const indexFile = path.join(gameDir, 'index.html');
    if (fs.existsSync(indexFile)) fs.writeFileSync(indexFile, patchLoaderShell(fs.readFileSync(indexFile, 'utf8'), cfg.gameName), 'utf8');
  }
  return { gameDir, stats };
}
