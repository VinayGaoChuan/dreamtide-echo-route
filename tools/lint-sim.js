// 联机同步的写法检查：只给本机看的分支（mine 判断、isMe）里不许用这一局的随机数（srnd、srand、srandi、spick 这几个函数）。
// 那些分支只在一部分客户端执行，用了就会让各端的随机数序列错开，联机分叉（2026-10-07：冲锋车的火花这样写过一次）。
// 用法：node tools/lint-sim.js（有问题时退出码 1）
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'js');
const BAD = /(?:this\.mine\(\)|\bisMe\b)[^;{}]*\b(srnd|srand|srandi|spick)\(/;
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (BAD.test(code)) { n++; console.log(`${f}:${i + 1}  本机分支里用了这一局的随机数：${line.trim().slice(0, 140)}`); }
  });
}
console.log(n ? `联机写法检查：${n} 处要改（画面用 rand / pick，玩法用 srand 但不能放在本机分支里）` : '联机写法检查通过');
process.exitCode = n ? 1 : 0;
