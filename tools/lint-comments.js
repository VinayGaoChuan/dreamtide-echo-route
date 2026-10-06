// 行尾注释吞代码检查：脚本改代码时把 `// 注释` 插进一行中间，后半行的代码就变成了注释（语法检查发现不了）。
// 这里找“注释里像代码”的行：注释正文里出现成员调用、break、条件语句、箭头函数、赋值加分号这类东西就报出来。
// 用法：node tools/lint-comments.js [文件或目录…]（默认 js/ 和 tools/）；有可疑行时退出码 1
const fs = require('fs'), path = require('path');
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['js', 'tools'].map((d) => path.join(__dirname, '..', d));
const files = roots.flatMap((r) => (fs.statSync(r).isDirectory() ? fs.readdirSync(r).filter((f) => f.endsWith('.js')).map((f) => path.join(r, f)) : [r]));
const CODE = /(\bthis\.[A-Za-z_]+\s*[(=.]|\bbreak;|\breturn\s+[^\s。，；]+;|\bif \([^)]*\)\s*[{A-Za-z]|\b(const|let|var) [A-Za-z_$][\w$]*\s*=|=>\s*[{(A-Za-z]|\}\s*else\b|\);\s*[A-Za-z_$])/;
let bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let tpl = 0; // 跨行的模板字符串层数（ui.js 里的 HTML）
  lines.forEach((line, i) => {
    let q = null, esc = false;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (tpl > 0 && !q) { if (c === '`') tpl--; continue; }
      if (q) { if (c === q) q = null; continue; }
      if (c === '`') { tpl++; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '/' && line[k + 1] === '/' && line[k - 1] !== ':') {
        const text = line.slice(k + 2);
        if (CODE.test(text)) { bad++; console.log(`${path.relative(process.cwd(), f)}:${i + 1}: 注释里像有代码 → ${text.trim().slice(0, 120)}`); }
        break;
      }
      if (c === '/' && line[k + 1] === '*') break; // 块注释不管
    }
  });
}
console.log(bad ? `行尾注释检查：${bad} 处可疑` : '行尾注释检查通过');
process.exitCode = bad ? 1 : 0;
