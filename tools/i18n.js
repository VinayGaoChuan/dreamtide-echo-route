// 多语言（docs/design.md §16）：源码一直写中文；打包时把每一句给玩家看的中文换成 __T('整句', 参数…)，再按语言查表（函数名避开游戏里的局部变量 T）。
// 用法：
//   node tools/i18n.js extract                 把 js/*.js 里所有要翻译的句子写进 i18n/keys.json（键 = 整句，${…} 换成 {0} {1}…）
//   node tools/i18n.js transform <输出目录>      把 js/*.js 改写成查表版写进 <输出目录>/js，并写 js/i18n-data.js（所有语言的表）
//   node tools/i18n.js check                    每种语言缺几句、占位符对不对、标签对不对
// 规则：带 HTML 的模板按标签拆开，只翻标签之间（和属性值里）的文字；比较（===）、对象的键、console、字符串方法的参数不翻。
const fs = require('fs'), path = require('path');
const acorn = require('./vendor/acorn.js');
const ROOT = path.join(__dirname, '..'), JS = path.join(ROOT, 'js'), DIR = path.join(ROOT, 'i18n');
const CJK = /[㐀-鿿豈-﫿]/;
const LANGS = ['en', 'zh-TW', 'ja', 'ko', 'th', 'vi', 'id', 'ms', 'ar', 'bg', 'cs', 'da', 'nl', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'no', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'es', 'es-419', 'sv', 'tr', 'uk'];
const SKIP_METHODS = new Set(['includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'split', 'match', 'matchAll', 'search', 'test', 'replace', 'replaceAll', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll', 'getElementById']);

function scriptOrder() { // 照 index.html 的顺序
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="js\/([\w.-]+\.js)"/g)].map((m) => m[1]).filter((f) => f !== 'i18n-data.js');
}
const NO_TRANSFORM = new Set(['i18n.js']); // 语言名字用各自的文字写，不翻
function htmlKeys(keys) { // index.html 里写死的几句（data-t / data-t-aria）和标题（试玩版标题也算一句）
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), add = (k) => { k = k.trim(); if (CJK.test(k)) { const o = keys[k] || (keys[k] = { n: 0, files: [] }); o.n++; if (!o.files.includes('index.html')) o.files.push('index.html'); } };
  for (const m of html.matchAll(/<[^>]+data-t[^>]*>([^<]+)</g)) add(m[1]);
  for (const m of html.matchAll(/aria-label="([^"]+)"[^>]*data-t-aria/g)) add(m[1]);
  const t = html.match(/<title>([^<]+)<\/title>/); if (t) { add(t[1]); add(t[1] + ' 试玩版'); }
}
function cook(raw) { return Function('"use strict"; return `' + raw + '`;')(); } // 模板里的一段原文 → 实际字符串（转义照算）
function walk(node, parent, fn) {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node, parent) === false) return;
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) walk(c, node, fn); else if (v && typeof v.type === 'string') walk(v, node, fn);
  }
}
function skipContext(node, parent) {
  if (!parent) return false;
  if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === node && !parent.computed) return true;
  if (parent.type === 'MemberExpression' && parent.property === node) return true;
  if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) return true;
  if (parent.type === 'SwitchCase' && parent.test === node) return true;
  if (parent.type === 'TaggedTemplateExpression') return true;
  if (parent.type === 'NewExpression' && parent.callee.type === 'Identifier' && /Error$/.test(parent.callee.name)) return true;
  if (parent.type === 'CallExpression' && parent.callee.type === 'MemberExpression') {
    const c = parent.callee, obj = c.object, prop = c.property && (c.property.name || c.property.value);
    if (obj.type === 'Identifier' && obj.name === 'console') return true;
    if (SKIP_METHODS.has(prop)) return true;
  }
  return false;
}
/* 一条字符串 / 模板 → 原子序列：{c: 一段原文字符（转义算一个）} 或 {e: 表达式节点} */
function atomsOf(node, src) {
  const out = [];
  const pushRaw = (raw) => { for (let i = 0; i < raw.length; i++) { let u = raw[i]; if (u === '\\') { u = raw.slice(i, i + 2); if (raw[i + 1] === 'u' && raw[i + 2] === '{') u = raw.slice(i, raw.indexOf('}', i) + 1); else if (raw[i + 1] === 'u') u = raw.slice(i, i + 6); else if (raw[i + 1] === 'x') u = raw.slice(i, i + 4); i += u.length - 1; } out.push({ c: u }); } };
  if (node.type === 'Literal') { for (const ch of node.value) out.push({ c: ch.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${'), cooked: ch }); return out; }
  node.quasis.forEach((q, i) => { pushRaw(q.value.raw); if (i < node.expressions.length) out.push({ e: node.expressions[i] }); });
  return out;
}
const cookedOf = (a) => (a.cooked !== undefined ? a.cooked : cook(a.c));
/* 把原子序列切成要翻的“句子”：HTML 标签之外的文字段、标签里加引号的属性值；不含中文的段原样留下 */
function runsOf(atoms) {
  const hasTag = atoms.some((a, i) => a.c === '<' && atoms[i + 1] && atoms[i + 1].c && /[a-zA-Z/!]/.test(atoms[i + 1].c));
  if (!hasTag) return [{ trans: true, atoms }];
  const runs = []; let cur = { trans: true, atoms: [] }, inTag = false, quote = null;
  const flush = (trans) => { if (cur.atoms.length) runs.push(cur); cur = { trans, atoms: [] }; };
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i], c = a.c;
    if (!inTag) {
      if (c === '<' && atoms[i + 1] && atoms[i + 1].c && /[a-zA-Z/!]/.test(atoms[i + 1].c)) { flush(false); inTag = true; cur.atoms.push(a); continue; }
      cur.atoms.push(a); continue;
    }
    if (quote) { if (c === quote) { flush(false); quote = null; cur.atoms.push(a); continue; } cur.atoms.push(a); continue; }
    if (c === '"' || c === "'") { cur.atoms.push(a); flush(true); quote = c; continue; }
    if (c === '>') { cur.atoms.push(a); flush(true); inTag = false; continue; }
    cur.atoms.push(a);
  }
  flush(true);
  return runs;
}
/* 一段要翻的文字 → { key, exprs }；首尾空白不进键（原样留在外面） */
function keyOf(atoms) {
  let a = 0, b = atoms.length; const ws = (x) => x.c !== undefined && /^\s$/.test(cookedOf(x));
  while (a < b && ws(atoms[a])) a++; while (b > a && ws(atoms[b - 1])) b--;
  const mid = atoms.slice(a, b), exprs = []; let key = '';
  for (const x of mid) { if (x.e) { key += `{${exprs.length}}`; exprs.push(x.e); } else key += cookedOf(x); }
  return { head: atoms.slice(0, a), mid, tail: atoms.slice(b), key, exprs };
}
const rawOf = (atoms) => atoms.map((x) => x.c).join('');

/* 改写一个文件：返回新源码；keys 收集用到的句子 */
function transform(src, file, keys) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const targets = [];
  walk(ast, null, (node, parent) => {
    const isStr = node.type === 'Literal' && typeof node.value === 'string' && CJK.test(node.value);
    const isTpl = node.type === 'TemplateLiteral' && node.quasis.some((q) => CJK.test(q.value.cooked || ''));
    if ((isStr || isTpl) && !skipContext(node, parent)) targets.push(node);
  });
  const isTarget = new Set(targets);
  // 渲染 [start, end) 的源码，把其中的目标节点换掉（只换最外层，里面的由递归处理）
  function render(start, end) {
    let out = '', pos = start;
    const inside = targets.filter((t) => t.start >= start && t.end <= end && !targets.some((o) => o !== t && o.start <= t.start && o.end >= t.end && o.start >= start && o.end <= end && (o.start < t.start || o.end > t.end)));
    inside.sort((x, y) => x.start - y.start);
    for (const t of inside) { out += src.slice(pos, t.start) + rewrite(t); pos = t.end; }
    return out + src.slice(pos, end);
  }
  function rewrite(node) {
    const atoms = atomsOf(node, src), runs = runsOf(atoms);
    const exprSrc = (e) => render(e.start, e.end);
    if (runs.length === 1 && runs[0].trans) { // 整条就是一句
      const k = keyOf(atoms);
      if (!CJK.test(k.key)) return node.type === 'Literal' ? src.slice(node.start, node.end) : '`' + atoms.map((x) => (x.e ? '${' + exprSrc(x.e) + '}' : x.c)).join('') + '`';
      note(k.key);
      const call = `__T(${JSON.stringify(k.key)}${k.exprs.map((e) => ', ' + exprSrc(e)).join('')})`;
      if (!k.head.length && !k.tail.length) return call;
      return '`' + rawOf(k.head) + '${' + call + '}' + rawOf(k.tail) + '`';
    }
    let out = '`';
    for (const r of runs) {
      const k = r.trans ? keyOf(r.atoms) : null;
      if (k && CJK.test(k.key)) { note(k.key); out += rawOf(k.head) + '${__T(' + JSON.stringify(k.key) + k.exprs.map((e) => ', ' + exprSrc(e)).join('') + ')}' + rawOf(k.tail); }
      else out += r.atoms.map((x) => (x.e ? '${' + exprSrc(x.e) + '}' : x.c)).join('');
    }
    return out + '`';
  }
  function note(key) { const k = keys[key] || (keys[key] = { n: 0, files: [] }); k.n++; if (!k.files.includes(file)) k.files.push(file); }
  void isTarget;
  return render(0, src.length);
}

function loadKeys() { return JSON.parse(fs.readFileSync(path.join(DIR, 'keys.json'), 'utf8')); }
function loadLang(l) { const f = path.join(DIR, `${l}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }
function placeholders(s) { return (s.match(/\{\d+\}/g) || []).sort().join(','); }
function tags(s) { return (s.match(/<\/?[a-zA-Z][^>]*>/g) || []).map((t) => t.replace(/\s.*$/, '')).sort().join(','); }

const cmd = process.argv[2];
if (cmd === 'extract' || cmd === 'transform') {
  const keys = {}, outDir = cmd === 'transform' ? process.argv[3] : null;
  if (outDir) fs.mkdirSync(path.join(outDir, 'js'), { recursive: true });
  for (const f of scriptOrder()) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8'), out = NO_TRANSFORM.has(f) ? src : transform(src, f, keys);
    acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); // 改写后的代码必须还能解析
    if (outDir) fs.writeFileSync(path.join(outDir, 'js', f), out, 'utf8');
  }
  htmlKeys(keys);
  if (cmd === 'extract') {
    fs.mkdirSync(DIR, { recursive: true });
    const sorted = Object.fromEntries(Object.keys(keys).sort().map((k) => [k, keys[k]]));
    fs.writeFileSync(path.join(DIR, 'keys.json'), JSON.stringify(sorted, null, 1) + '\n', 'utf8');
    const n = Object.keys(keys).length, chars = Object.keys(keys).reduce((a, k) => a + k.length, 0);
    console.log(`句子 ${n} 条，${chars} 个字符（i18n/keys.json）`);
  } else {
    const data = { zh: {} }; for (const l of LANGS) { const d = loadLang(l), o = {}; for (const k in keys) if (d[k]) o[k] = d[k]; data[l] = o; }
    fs.writeFileSync(path.join(outDir, 'js', 'i18n-data.js'), `'use strict';\n/* 生成的文件（tools/i18n.js transform）：所有语言的句子表 */\nconst I18N_DATA = ${JSON.stringify(data)};\n`, 'utf8');
    const miss = LANGS.map((l) => [l, Object.keys(keys).filter((k) => !data[l][k]).length]).filter((x) => x[1]);
    console.log(`改写了 ${scriptOrder().length} 个脚本，句子 ${Object.keys(keys).length} 条${miss.length ? `；缺翻译：${miss.map(([l, n]) => `${l} ${n}`).join('，')}` : '；所有语言齐全'}`);
  }
} else if (cmd === 'check') {
  const keys = loadKeys(); let bad = 0;
  for (const l of LANGS) {
    const d = loadLang(l), miss = Object.keys(keys).filter((k) => !d[k]), extra = Object.keys(d).filter((k) => !keys[k]);
    const ph = Object.keys(d).filter((k) => keys[k] && placeholders(k) !== placeholders(d[k])), tg = Object.keys(d).filter((k) => keys[k] && tags(k) !== tags(d[k]));
    if (miss.length || ph.length || tg.length) bad++;
    console.log(`${l}: 缺 ${miss.length}，多 ${extra.length}，占位符不对 ${ph.length}，标签不对 ${tg.length}${ph.length ? '  例：' + JSON.stringify(ph[0]) : ''}${tg.length ? '  例：' + JSON.stringify(tg[0]) : ''}`);
  }
  process.exitCode = bad ? 1 : 0;
} else {
  console.log('用法：node tools/i18n.js extract | transform <输出目录> | check');
}
