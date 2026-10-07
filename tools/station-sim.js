// 站的规则自测（docs/design.md §7、§8）：一局结束怎么结算（送回的、套装暗金、保险舱、丢掉的）、按做过的事解锁、
// 老存档迁移、换装门槛、卖 / 拆 / 改造台 / 赌博、仓库满了进到货区、首领送回家以后结算不重复。任何一条不对就退出码 1。
// 用法：node tools/station-sim.js
const path = require('path'), { load } = require('./sim-env');
const fs = require('fs'), vm = require('vm'), dir = path.join(__dirname, '..', 'js'), { R, ctx } = load(dir);
vm.runInContext(fs.readFileSync(path.join(dir, 'net.js'), 'utf8'), ctx, { filename: 'net.js' }); // compactStats
let fails = 0; const ok = (cond, msg) => { if (!cond) { fails++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };
const run = (code) => R(`(() => { ${code} })()`);

// 1. 新存档：v4 字段齐全，只开装备栏和星图
ok(run(`const m = Station.ensure(freshMeta()); return m.v === 4 && m.pilot.lv === 1 && m.unlock.equip && !m.unlock.stash && Station.stashCap(m) === 40 && m.gear.stash.length === 0;`), '新存档：v4 字段、只开装备栏和星图、仓库 40 格');

// 2. 第一局：打倒第一个首领（送回 1 件蓝），倒在第二关（这一关捡了 1 白 1 蓝 1 金）：保险舱保 1 件（蓝），金一定带回，白丢掉
const r1 = run(`
  const m = Station.ensure(freshMeta()), rnd = Gear.rng(11), mk = (q, o) => Object.assign(Gear.make(Object.assign({ rnd, ilvl: 3, q }, o || {})), { safe: false });
  const shipped = Object.assign(mk('blue', { kind: 'gun', base: 'beam' }), { safe: true }), w = mk('white'), b = mk('blue'), g = mk('gold', { uni: 'oldScav' });
  const res = { stage: '1-2', map: 1, win: false, cleared: ['1-1'], cargo: [shipped, w, b, g], stats: { dust: 300, kills: 400, elites: 3 }, goalTimes: [1, 2, 3, 4, 5, 6, 7, 8], creditK: 0 };
  const out = Station.settle(m, res);
  globalThis.__m1 = m; globalThis.__out1 = out;
  return { kept: out.kept.map((x) => x.q).sort().join(','), lost: out.lost.map((x) => x.q).join(','), credits: out.credits, xp: out.xp, unlocks: out.unlocks.join(','), firstBoss: !!m.maps.firstBoss['1-1'], reached: !!m.maps.reached['1-2'], stash: m.gear.stash.length };`);
ok(r1.kept === 'blue,blue,gold' && r1.lost === 'white', `半路死了：送回的在、暗金带回、保险舱保住最好的 1 件、白的丢了（带回 ${r1.kept}，丢 ${r1.lost}）`);
ok(r1.credits > 0 && r1.xp > 0, `信用点和经验照算（信用点 ${r1.credits}，经验 ${r1.xp}）`);
ok(r1.unlocks.includes('stash') && r1.unlocks.includes('shop') && r1.unlocks.includes('insure') && r1.unlocks.includes('cube'), `第一次回家：仓库、商人、保险舱、改造台打开（${r1.unlocks}）`);
ok(r1.firstBoss && r1.reached && r1.stash === 3, '地图进度：第一个首领记下、走到过 1-2（路标）、三件进了仓库');

// 3. 第二次回家：拆解台打开；500 信用点：黑市打开；5 级：机库
const r2 = run(`const m = __m1; const out = Station.settle(m, { stage: '1-1', map: 1, win: false, cleared: [], cargo: [], stats: { dust: 0, kills: 10 }, goalTimes: [] }); m.credits = 600; m.pilot.lv = 5; const more = Station.checkUnlocks(m); return { a: out.unlocks.join(','), b: more.join(',') };`);
ok(r2.a.includes('salvage'), `第二次回家：拆解台打开（${r2.a}）`);
ok(r2.b.includes('black') && r2.b.includes('hangar'), `攒到 500 信用点开黑市、驾驶员 5 级开机库（${r2.b}）`);

// 4. 首领倒下时已经送回家的东西，结算时不再放一遍
const r3 = run(`const m = Station.ensure(freshMeta()), it = Object.assign(Gear.make({ rnd: Gear.rng(3), ilvl: 3, q: 'yellow' }), { safe: true }), shipped = new Set();
  Station.shipHome(m, [it], shipped); const n1 = m.gear.stash.length; Station.settle(m, { stage: '1-1', map: 1, win: false, cleared: ['1-1'], cargo: [it], stats: {}, goalTimes: [], shipped }); return [n1, m.gear.stash.length];`);
ok(r3[0] === 1 && r3[1] === 1, `首领送回家当场存档，结算不重复（${r3.join(' → ')} 件）`);

// 5. 打通地图：站里多一样东西、下一张图开放
const r4 = run(`const m = Station.ensure(freshMeta()); const out = Station.settle(m, { stage: '1-3', map: 1, win: true, cleared: ['1-1', '1-2', '1-3'], cargo: [], stats: {}, goalTimes: [] }); return { clear: out.mapClear, home: !!m.station.homes.beacon, next: !!m.maps.reached['2-1'], open: Station.mapOpen(m, 2) };`);
ok(r4.clear === 1 && r4.home && r4.next && r4.open, '打通第 1 张图：信号塔装上、第 2 张图开放');

// 6. 老存档迁移：共享等级 → 驾驶员等级、星尘 → 信用点、1-3 通关过 → 第 1 张图算打通、送两件白装
const r5 = run(`const o = freshMeta(); o.shared.level = 7; o.stardust = 900; o.progress.cleared = { '1-1': true, '1-2': true, '1-3': true }; o.firstRunDone = true; delete o.pilot; const m = Station.ensure(o);
  return { lv: m.pilot.lv, c: m.credits, cleared: !!m.maps.cleared[1], gear: m.gear.stash.length, v: m.v };`);
ok(r5.lv === 7 && r5.c >= 900 && r5.cleared && r5.gear === 2 && r5.v === 4, `老存档迁移（驾驶员 ${r5.lv} 级、信用点 ${r5.c}、第 1 张图${r5.cleared ? '已' : '未'}打通、送 ${r5.gear} 件）`);

// 7. 换装门槛、卖、拆、锁定
const r6 = run(`const m = Station.ensure(freshMeta()); const hi = Gear.make({ rnd: Gear.rng(5), ilvl: 20, q: 'blue', kind: 'gun' }), lo = Gear.make({ rnd: Gear.rng(6), ilvl: 1, q: 'white', kind: 'armor' });
  Station.addItem(m, hi, true); Station.addItem(m, lo, true);
  const no = Station.equip(m, hi.uid), yes = Station.equip(m, lo.uid); const c0 = m.credits; const lock = Gear.make({ rnd: Gear.rng(9), ilvl: 2, q: 'white' }); lock.lock = true; Station.addItem(m, lock, true);
  const soldLocked = Station.sell(m, lock.uid), sold = Station.sell(m, hi.uid); const scrap0 = m.mats.scrap; const lo2 = Gear.make({ rnd: Gear.rng(7), ilvl: 1, q: 'white' }); Station.addItem(m, lo2, true); Station.salvage(m, lo2.uid);
  return { no: !!no, yes: !!yes && m.gear.eq.armor === lo, soldLocked, sold: m.credits - c0, scrap: m.mats.scrap - scrap0 };`);
ok(!r6.no && r6.yes, '够不上驾驶员等级的穿不上，够得上的换上');
ok(r6.soldLocked === 0 && r6.sold > 0 && r6.scrap > 0, `锁定的不能卖；卖出得信用点（${r6.sold}）；拆出废料（${r6.scrap}）`);

// 8. 改造台：重铸蓝装（同位、同物品等级、算改过的）；升阶暗金；材料合成。赌博：扣钱、给一件这个位的
const r7 = run(`const m = Station.ensure(freshMeta()); m.mats = { scrap: 20, shard: 20, core: 30 }; m.credits = 5000; m.fac.cube = 3;
  const b = Gear.make({ rnd: Gear.rng(2), ilvl: 9, q: 'blue', kind: 'radar' }); Station.addItem(m, b, true); const r = Station.cube(m, 'rerollBlue', b.uid);
  const u = Gear.make({ rnd: Gear.rng(4), ilvl: 5, q: 'gold', uni: 'oldScav' }); Station.addItem(m, u, true); const up = Station.cube(m, 'up1', u.uid);
  const mix = Station.cube(m, 'scrapToShard'); const c0 = m.credits, g = Station.gamble(m, 'engine');
  return { reroll: r.item && r.item.kind === 'radar' && r.item.ilvl === 9 && r.item.q === 'blue' && r.item.bound, up: up.item && up.item.grade === 1 && up.item.uni === 'oldScav', mix: !!(mix.mats && mix.mats.shard), gamble: g && g.kind === 'engine' && QUALS[g.q].rank >= 1 && m.credits < c0 };`);
ok(r7.reroll, '改造台：重铸蓝装 → 同位、同物品等级的新蓝装，标成改过的（不能送人）');
ok(r7.up && r7.mix, '改造台：暗金升阶到加强档；5 废料合成 1 晶片');
ok(r7.gamble, '黑市：选位赌博扣信用点，开出一件那个位的蓝装以上');

// 9. 仓库满了：新的进到货区；扩容以后挪回来
const r8 = run(`const m = Station.ensure(freshMeta()); for (let i = 0; i < 45; i++) Station.addItem(m, Gear.make({ rnd: Gear.rng(100 + i), ilvl: 3, q: 'white' }), true); const a = [m.gear.stash.length, m.gear.inbox.length]; m.credits = 1000; m.mats.scrap = 50; Station.facUp(m, 'stash'); return [a, [m.gear.stash.length, m.gear.inbox.length]];`);
ok(r8[0][0] === 40 && r8[0][1] === 5 && r8[1][0] === 45 && r8[1][1] === 0, `仓库满了进到货区，扩容后挪回来（${JSON.stringify(r8)}）`);

// 10. 装备进飞船属性：同一份装备算出的属性每次一样（联机各端用同一份）
const r9 = run(`const R1 = Gear.rng(42), R2 = Gear.rng(42); const a = Gear.make({ rnd: R1, ilvl: 15, q: 'yellow', kind: 'gun' }), b = Gear.make({ rnd: R2, ilvl: 15, q: 'yellow', kind: 'gun' }); a.uid = b.uid = 'x';
  const m = Station.ensure(freshMeta()); m.gear.eq.gun = a; const s1 = JSON.stringify(compactStats(planeStats(m, 'moon'))); m.gear.eq.gun = b; const s2 = JSON.stringify(compactStats(planeStats(m, 'moon'))); return s1 === s2 && JSON.stringify(a.aff) === JSON.stringify(b.aff);`);
ok(r9, '同一个种子掉出同一件装备，算出同一份飞船属性');

console.log(fails ? `站的规则自测：${fails} 条不对` : '站的规则自测通过');
process.exitCode = fails ? 1 : 0;
