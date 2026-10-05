// 家园规则自测（v0.10 第一阶段）：按“第一小时”的顺序走一遍因果链，并检查存档安全——
// 每个永久事件只发一次、资源不为负、项目 / 委托要的资源会先留着、每次回家只改一项职责、老存档能迁移。
// 用法：node tools/home-sim.js（失败时退出码 1）
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'js');
const ctx = { console, Math, Date, JSON, window: {}, document: { createElement: () => ({ getContext: () => ({}) }) }, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['util', 'data', 'home']) vm.runInContext(fs.readFileSync(path.join(dir, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const R = (code) => vm.runInContext(code, ctx);
let failed = 0; const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };
const nonNeg = () => R('m.home.res.wood >= 0 && m.home.res.goods >= 0 && m.stardust >= 0');

R('var m = freshMeta(); Home.ensure(m);');
check(R('m.stardust') === 120 && R('Home.goal(m).key') === 'bunny', '新存档：初始 120 星尘，当前目标“救小梦兔”');
check(R('Home.worldFor(m).target') === 'bunny', '下一局要救的是小梦兔');

// 第一次出击：救出小梦兔 → 救援台开放、自动摆到空格；重复触发不会再发
R('var r1 = Home.rescue(m, "bunny"); var r1b = Home.rescue(m, "bunny");');
check(R('r1.opened') === 'rescue' && R('m.home.plots.rescue') === 0 && R('r1b') === null, '救出小梦兔：救援台开放并摆好；第二次触发不重复发放');
check(R('Home.goal(m).key') === 'grandpa', '下一个目标：救云朵爷爷');
R('m.home.res.wood += 23; m.home.visit++; var log1 = Home.work(m, 176);');
check(R('log1.length') === 0 && R('m.home.work.t') === 176, '没有工坊时有效战斗时间先攒着（不丢）');

// 第二次出击：救出云朵爷爷 → 工坊；小梦兔成为伙伴
R('Home.rescue(m, "grandpa"); m.home.res.wood += 23; m.home.visit++; var log2 = Home.work(m, 218);');
check(R('m.home.built.workshop') === 1 && R('m.home.npcs.bunny.stage') === 1, '救出云朵爷爷：工坊开放，小梦兔成为伙伴（副职开放）');
check(R('log2.filter((e) => e.k === "craft").length') === 1 && R('m.home.res.wood') === 38 && R('m.home.res.goods') === 1, '跨两局攒够 4 分钟：加工一次（46 梦木 → 38 + 1 件货物），风道要的 12 梦木先留着');
check(R('Home.goal(m).key') === 'windRoad' && R('Home.goal(m).ready') === true, '目标：修风道（梦木够了）');
R('var d1 = Home.deliverProject(m, "windRoad"); var d2 = Home.deliverProject(m, "windRoad");');
check(R('!!d1 && d2 === null') && R('m.home.res.wood') === 26 && R('!!m.home.projects.windRoad'), '修风道：扣 12 梦木、只能完成一次');
check(R('Home.worldFor(m).upper') === true && R('Home.worldFor(m).target') === 'merchant' && R('m.home.npcs.grandpa.stage') === 1, '下一局：上层风圈出现，要救的是糖果商人；爷爷成为伙伴');

// 第三次出击：上层云桥救出糖果商人 → 巡游店；委托要 1 件货物
R('Home.rescue(m, "merchant"); m.home.visit++;');
check(R('m.home.built.shop') === 1 && R('Home.goal(m).key') === 'candy', '救出糖果商人：巡游店开放，目标变成商人的委托');
R('m.home.res.wood = 0; m.home.res.goods = 1; m.home.work.t = 0; var before = m.stardust; Home.work(m, 240);');
check(R('m.stardust') === R('before') && R('m.home.res.goods') === 1, '委托要的那 1 件货物先留着，不会被卖掉');
R('var c1 = Home.deliverCommission(m, "candy"); var c2 = Home.deliverCommission(m, "candy");');
check(R('c1 && c1.plane === "candy" && !c1.had && c2 === null') && R('!!m.planes.candy'), '交付委托：得到糖果号；不能再领第二次');
R('m.home.res.wood = 0; m.home.res.goods = 2; m.home.work.t = 0; var s0 = m.stardust; Home.work(m, 240);');
check(R('m.stardust - s0') === 40 && R('m.home.res.goods') === 0, '委托完成后货架开卖：两个货架各卖 1 件，各 20 星尘');
R('Home.work(m, 240);');
check(nonNeg(), '没货时暂停：资源不为负，不借债');

// 职责：每次回家最多改一项；副职要先成为伙伴
R('m.home.visit++; var j1 = Home.setJob(m, "grandpa", "side"); var j2 = Home.setJob(m, "bunny", "side"); m.home.visit++; var j3 = Home.setJob(m, "bunny", "side");');
check(R('j1 === true && j2 === false && j3 === true'), '每次回家只改一项职责，下次回家可以再改');
R('var m2 = freshMeta(); Home.ensure(m2); var j4 = Home.setJob(m2, "bunny", "side");');
check(R('j4') === false, '没救出的 / 还不是伙伴的 NPC 不能改副职');

// 摆放：移到有建筑的格子就互换，不花钱
R('var p0 = m.home.plots.rescue, p1 = m.home.plots.workshop; Home.place(m, "rescue", p1);');
check(R('m.home.plots.rescue') === R('p1') && R('m.home.plots.workshop') === R('p0'), '移动建筑：目标格有建筑就互换');

// 老存档迁移：已经救过的伙伴直接住进来、开放建筑；资源异常值被修正
R('var old = freshMeta(); old.progress.rescued = { bunny: 1, merchant: 1 }; delete old.home; Home.ensure(old); old.home.res.wood = -5; Home.ensure(old);');
check(R('old.home.built.rescue === 1 && old.home.built.shop === 1 && !old.home.built.workshop') && R('old.home.res.wood') === 0, '老存档：已救的伙伴住进来、开放对应建筑；负数资源读档时归零');
check(R('Home.goal(old).key') === 'grandpa', '老存档的当前目标从缺的那一步接上（救云朵爷爷）');

console.log(failed ? `家园规则测试失败 ${failed} 项` : '家园规则测试通过');
process.exitCode = failed ? 1 : 0;
