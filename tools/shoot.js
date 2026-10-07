// 真实画面截图（商店页 / L1 预测 / 打磨对比）：无头 Chrome 打开游戏，自动驾驶打真实关卡，在指定时刻截 1920×1080。
// 用法：node tools/shoot.js <输出目录> [--chrome 路径] [--moments]
//   --moments：改拍“标志时刻”的连续帧（升级仪式、宝箱、Boss 入场 / 倒下、精英核心），每个时刻拼成一张 4×N 的接触表 raw/<名字>-sheet.png
//   输出：<目录>/raw/*.png（每个时刻一张）、<目录>/images/01-capsule.png（920×430）、02~06 截图、09-trailer-frames.png（3×3）
//   时刻表在下面 PLAN 里：每一步 = 一个条件（对 World w 求值）+ 最长等待秒数；满足后截一张。
//   Chrome：macOS 默认 /Applications/Google Chrome.app，Windows 默认 Program Files 下的 chrome.exe，或 --chrome / CHROME 环境变量。
const fs = require('fs'), path = require('path');
const { PILOT_SRC } = require('./sim-env');
const { ROOT, sleep, openGame } = require('./chrome-env'); // 找 Chrome、起本地服务、CDP（和 ui-check.js 共用）
const { EN_SRC } = require('./capture-en'); // --en：只给画面里出现的那几句换英文（录英文商店素材）；--collect：记下每张里的中文
const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--keep')) || path.join(ROOT, '.ai', 'shots'));
const W = 1920, H = 1080, EN_MODE = args.includes('--en'), COLLECT = args.includes('--collect');

/* 页面里的助手：自动驾驶接管本机飞机（截图时不受伤），按条件快进，截图时可以按住不动 */
const HELPER = PILOT_SRC + `
// 横幅 / 提示本来按真实时间消失；快进时改按游戏时间算，过期的在截图前收掉（否则旧标题挂在每一帧上）
(function () {
  const _b = banner, _t = toast;
  window.banner = function (...a) { __S.bannerAt = G.world ? G.world.t : 0; __S.bannerDur = a[2] === undefined ? 1.6 : a[2]; return _b.apply(this, a); };
  Object.assign(window.banner, _b); banner = window.banner;
  window.toast = function (...a) { const r = _t.apply(this, a), el = $('#toast').lastElementChild; if (el) el.dataset.gt = String((G.world ? G.world.t : 0) + (a[3] || 2200) / 1000); return r; };
  toast = window.toast;
})();
window.__S = {
  hold: false,
  // 摆拍用的一身装备：按地图给一身那个阶段像样的东西（装备长在船上，截图里看得见）
  loadout(mapN) {
    const R = Gear.rng(5150 + mapN), mk = (o) => Gear.make(Object.assign({ rnd: R, ilvl: [3, 9, 14, 19, 24][mapN - 1] || 9 }, o)), m = G.meta;
    const eq = mapN <= 1 ? { gun: mk({ q: 'blue', kind: 'gun', base: 'missile' }), armor: mk({ q: 'white', kind: 'armor' }), engine: mk({ q: 'blue', kind: 'engine' }) }
      : mapN <= 3 ? { gun: mk({ q: 'yellow', kind: 'gun', base: 'beam' }), armor: mk({ q: 'green', set: 'frost', kind: 'armor' }), aux: mk({ q: 'green', set: 'frost', kind: 'aux' }), engine: mk({ q: 'blue', kind: 'engine' }), radar: mk({ q: 'gold', uni: 'scavEye' }), chip1: mk({ q: 'blue', kind: 'chip' }) }
      : { gun: mk({ q: 'yellow', kind: 'gun', base: 'missile' }), armor: mk({ q: 'green', set: 'forge', kind: 'armor' }), aux: mk({ q: 'green', set: 'forge', kind: 'aux' }), core: mk({ q: 'yellow', kind: 'core' }), engine: mk({ q: 'yellow', kind: 'engine' }), radar: mk({ q: 'gold', uni: 'scavEye' }), chip1: mk({ q: 'gold', uni: 'twinChip' }), chip2: mk({ q: 'blue', kind: 'chip' }) };
    m.gear.eq = Object.assign({ gun: null, aux: null, core: null, armor: null, engine: null, radar: null, chip1: null, chip2: null }, eq);
  },
  expire() {
    const w = G.world; if (!w) return;
    if (__S.bannerAt !== undefined && w.t - __S.bannerAt > __S.bannerDur) { $('#banner').innerHTML = ''; banner._until = 0; __S.bannerAt = undefined; }
    for (const el of [...$('#toast').children]) if (el.dataset.gt && w.t > +el.dataset.gt) el.remove();
    const tc = G.hudRefs && G.hudRefs.tc; if (tc && tc.classList.contains('done') && __S.doneAt !== undefined && w.t - __S.doneAt > 1.3) tc.classList.remove('done');
    if (tc && tc.classList.contains('done') && __S.doneAt === undefined) __S.doneAt = w.t; if (tc && !tc.classList.contains('done')) __S.doneAt = undefined;
  },
  attach() {
    const w = G.world; if (!w || w.__wrapped) return; w.__wrapped = true;
    const st = w.step.bind(w); w.step = (dt) => { if (__S.freeze && !__S.manual) return; if (!__S.hold) pilot(w); st(dt); }; // freeze：连拍按游戏时间走，页面自己的循环只画不走
    w.hurtPlayer = function () {};
  },
  until(src, maxSec) {
    const f = new Function('w', 'return (' + src + ')'); __S.attach(); const w = G.world; let i = 0; const n = maxSec * 120; __S.manual = true;
    // 快进时横幅按真实时间排队会互相挡住：每次取事件前放开，屏幕上留下的是此刻该有的那条
    while (i < n && !w.done && !f(w)) { w.step(1 / 120); i++; if (i % 4 === 0) { banner._until = 0; drainWorldEvents(); __S.expire(); } }
    __S.manual = false; banner._until = 0; drainWorldEvents(); __S.expire(); return { ok: !!f(w), secs: Math.round(i / 12) / 10, runT: Math.round(w.runT) };
  },
};
`;

/* 时刻表：截图（02~06）和预告片 9 帧都从这里挑。五张截图是五个不同的场景（lessons SD9）：
   熔核前线的割草潮、霜晶环带大首领的战利品喷泉、霓虹电弧城的升级二选一、站里的装备栏和比较、混沌祭司的首领战 */
const STATION_JS = `clearScreens(); const m = G.meta; m.seenTitle = true; m.firstRunDone = true; m.tutorialDone = true; Station.ensure(m); m.pilot.lv = 14; m.credits = 4820; m.mats = { scrap: 64, shard: 23, core: 7 };
  for (const k of ['stash', 'shop', 'insure', 'salvage', 'cube', 'black', 'hangar', 'codex', 'waypoint']) m.unlock[k] = true; for (const id of ['1-1','1-2','1-3','2-1','2-2','2-3','3-1']) { m.maps.reached[id] = true; m.maps.firstBoss[id] = true; } m.maps.cleared[1] = true; m.maps.cleared[2] = true; m.station.homes.beacon = true; m.station.homes.dome = true;
  const R = Gear.rng(20261007); const mk = (o) => Gear.make(Object.assign({ rnd: R }, o));
  m.gear.eq = { gun: mk({ ilvl: 14, q: 'yellow', kind: 'gun', base: 'beam' }), aux: mk({ ilvl: 12, q: 'green', set: 'frost', kind: 'aux' }), core: mk({ ilvl: 11, q: 'blue', kind: 'core', base: 'coreTwin' }), armor: mk({ ilvl: 12, q: 'green', set: 'frost', kind: 'armor' }), engine: mk({ ilvl: 9, q: 'blue', kind: 'engine' }), radar: mk({ ilvl: 13, q: 'yellow', kind: 'radar' }), chip1: mk({ ilvl: 10, q: 'blue', kind: 'chip' }), chip2: null };
  m.gear.stash = []; for (let i = 0; i < 22; i++) m.gear.stash.push(mk({ ilvl: 6 + (i % 9), q: ['white','blue','blue','yellow','white','blue','yellow','green'][i % 8], kind: GEAR_KIND_ORDER[i % 7], set: i % 8 === 7 ? 'hive' : null }));
  const star = mk({ ilvl: 13, q: 'gold', uni: 'thunderThroat' }); m.gear.stash.unshift(star); m.gear.stash.push(mk({ ilvl: 13, q: 'gold', uni: 'scavEye' }));
  G.st.panel = 'equip'; G.st.filter = 'all'; G.st.sel = star.uid; showStation();`;
const PLAN = [
  { name: 'title', screen: 'title' },
  { name: 'keyart', screen: 'keyart' }, // 商店主图：游戏自己的画法拼的关键美术
  // 1-1 锈带残骸场：开场
  { name: 'open', start: '1-1', until: 'w.runT > 3', max: 12 },
  // 1-2 锈带残骸场：收账小偷背着越吸越鼓的钱袋躲你的高度（摆拍：这一只打不死，周围撒一把星砂让它吸）
  { name: 'thief', start: '1-2', build: true, setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); const w = G.world; w.spawnFormation('vee'); w.spawnFormation('line'); __S.until('false', 1.2); const e = w.spawnThief(); e.hp = e.maxHp = 1e6; e.x = w.W * 0.86; for (let i = 0; i < 26; i++) w.dropPickup('dust', w.W * (0.6 + 0.012 * i), e.y + srand(-90, 90), { value: 1, vx: -20, vy: 0 });",
    until: "(() => { const e = w.enemies.find((q) => q.type === 'thief'); return e && e.t > 1.1 && e.sack > 0.25; })()", max: 8, wait: 60 },
  // 2-1 霜晶环带：精英炸开，金光柱砸下来（摆拍：这一刻真的掉一件暗金）
  { name: 'loot', start: '2-1', hold: true, until: "w.goal && w.goal.kind === 'pack' && w.enemies.filter((e) => e.alive && e.x < w.W && e.x > w.W * 0.4).length >= 3", max: 200, clean: true, wait: 60,
    setup2: "const w = G.world; w.spawnFormation('vee'); w.spawnFormation('line'); w.spawnFormation('boats'); __S.until('false', 2.2); w.texts.length = 0; w.loot = []; const P = [[0.6, 0.4, 'gold'], [0.71, 0.62, 'yellow'], [0.5, 0.7, 'blue'], [0.79, 0.34, 'green']]; for (const [fx, fy, q] of P) { const k = w.lootRoll('elite', w.W * fx, LH * fy, { q }); if (k) { k.vx = 0; k.vy = -30; } } __S.hold = true; __S.until('false', 0.45); w.texts.length = 0; banner._until = 0; $('#banner').innerHTML = ''; $('#toast').innerHTML = '';" },
  // 3-1 霓虹电弧城：升级仪式二选一
  { name: 'ritual-roll', start: '3-1', build: true, setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1', 40); const w = G.world, q = w.me; w.queueRitual('core', { who: q.idx, full: true, q: 2, x: w.W * 0.58, y: (TOP + BOTTOM) / 2, device: 'crystal', opts: [w.withPlayer(q, () => w.optGun('multi')), w.withPlayer(q, () => w.optBmod('thunderB'))] })", until: "w.ritual && w.ritual.st === 'roll'", max: 60 },
  { name: 'ritual-choose', until: "w.ritual && w.ritual.st === 'choose'", max: 10, hold: true, clean: true, wait: 500 },
  // 站：装备栏，选中一件暗金，和身上的并排比较
  { name: 'station', screen: 'eval', js: STATION_JS, wait: 1500 },
  // 4-1 熔核前线：成型的追踪雷链扫一整屏的割草潮
  { name: 'swell', start: '4-1', build: true, setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.swell()", until: "w.enemies.filter((e) => e.alive && e.swell && e.x < w.W - 10).length >= 30 || (!w.warns.some((x) => x.kind === 'swell') && !w.enemies.some((e) => e.alive && e.swell) && !w.focusBusy() && (w.swell(), false))", max: 40, clean: true, freeze: true, wait: 60 },
  { name: 'burst', setup: 'G.world.pilotNoBurst = false; G.world.me.stock = Math.max(1, G.world.me.stock); G.world.setInput(0, { burst: true })', until: 'w.bursting && w.bursting.t > 0.5', max: 6 },
  // 1-3 锈带残骸场的大首领（失控主钟）倒下：3 件战利品一件接一件扇形喷开（首杀：一件本图族的套装 + 至少一件黄）
  { name: 'fountain', start: '1-3', build: true, setup: "const w = G.world; w.pilotNoBurst = true; w.testNoWipe = true; w.lootCfg.firstBoss = {}; w.beginBeat(w.plan.length - 1); __S.until('w.boss && w.bossIntroT <= 0 && w.boss.t > 3', 120); const b = w.boss; if (b) { b.phase = 3; b.nextPhase = 3; b.transT = 0; b.shield = 0; b.hp = 25; }",
    until: 'w.loot && w.loot.length >= 3 && w.loot[w.loot.length - 1].t > 0.5', max: 40, hold: true, clean: true, wait: 60 },
  { name: 'cargo', until: '!!w.cargoPod', max: 20, freeze: true, wait: 450 }, // 货运舱的动画按画面时间走：停住世界，画面照常把它画出去
  // 5-3 寂静圣所：混沌祭司
  { name: 'priest', start: '5-3', build: true, setup: "G.world.testNoWipe = true; G.world.beginBeat(G.world.plan.length - 1)", until: 'w.boss && w.bossIntroT <= 0 && w.boss.fightT > 4 && w.bullets.count() > 18', max: 160 },
  { name: 'priest-late', setup: 'const b = G.world.boss; if (b && b.phase === 1) { b.hp = 640; b.startTransition(2); }', until: 'w.boss && w.boss.phase >= 2 && w.boss.bands && w.boss.bands.some((x) => x.t > x.warn) && w.bullets.count() > 14', max: 60 },
];
const SHOTS = ['swell', 'fountain', 'ritual-choose', 'station', 'priest-late']; // 02~06：五个不同的场景
/* 标志时刻：到点后按真实时间连拍（游戏照常跑），看动画而不是一张静帧 */
const MOMENTS = [
  { name: 'ritual', start: '1-1', until: "w.ritual && w.ritual.st === 'trigger'", max: 60, seq: { n: 16, every: 260 } },
  { name: 'lurk-hand', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.spawnLurk(LURK_THEMES.bay.kinds[0], false)", until: "w.lurks && w.lurks.some((L) => L.kind === 'hand')", max: 4, seq: { n: 12, dt: 0.3 } },
  { name: 'lurk-wake', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.spawnLurk(LURK_THEMES.bay.kinds[1], false)", until: "w.lurks && w.lurks.some((L) => L.kind === 'wake')", max: 4, seq: { n: 12, dt: 0.25 } },
  { name: 'lurk-break', setup: "__S.until('!w.focusBusy() && w.phase === \\'fight\\' && w.D && w.D.st === \\'goal\\' && w.D.t > 1 && !(w.lurks || []).length', 40); G.world.spawnLurk(LURK_THEMES.bay.kinds[0], false); __S.until('w.lurks.some((L) => L.kind === \\'hand\\' && L.e && L.e.alive)', 4)", until: 'true', max: 1, seq: { n: 10, dt: 0.12, each: "const L = G.world.lurks.find((q) => q.kind === 'hand' && q.e && q.e.alive); if (L) G.world.damageEnemy(L.e, L.e.maxHp * 0.2)" } }, // 打碎地图伸出来的手：裂纹、血条、原地弹奖励（模拟连续命中）
  { name: 'link', until: "w.ritual && w.ritual.st === 'choose' && w.ritual.gates.some((G) => G.opt.kind === 'link')", max: 200, seq: { n: 14, every: 200 } },
  { name: 'core', until: "w.props && w.props.some((q) => q.kind === 'core')", max: 200, seq: { n: 16, every: 300 } },
  { name: 'chest', until: "w.pickups.some((k) => k.kind === 'chest' && k.near > 0.2)", max: 20, seq: { n: 8, every: 120 } },
  { name: 'lurk-close', start: '1-2', until: "w.lurks && w.lurks.some((L) => L.kind === 'close' && L.st === 'omen')", max: 200, seq: { n: 12, dt: 0.75 } },
  { name: 'boss-rage', start: '1-1', setup: "G.world.beginBeat(G.world.plan.length - 1); __S.until('w.phase === \\'boss\\' && w.boss && w.bossIntroT <= 0', 30); G.world.boss.fightT = BUILD_CHECK.rage.at[G.world.stageId] - 7", until: 'w.boss && w.boss.fightT > BUILD_CHECK.rage.at[w.stageId] - 6', max: 5, seq: { n: 10, dt: 0.9 } }, // 构筑考验：自愈的绿光、失控倒计时、失控后的红光
  { name: 'boss-in', start: '1-3', setup: 'G.world.beginBeat(G.world.plan.length - 1)', until: 'w.phase === "boss" && w.bossIntroT > 2.4', max: 20, seq: { n: 12, every: 280 } },
  { name: 'boss-down', setup: 'const b = G.world.boss; if (b) { b.phase = 3; b.nextPhase = 3; b.transT = 0; b.shield = 0; b.hp = 25; }', until: 'w.boss && w.boss.dying > 0', max: 60, seq: { n: 16, every: 260 } },
];
const TRAILER = ['open', 'loot', 'thief', 'ritual-roll', 'swell', 'fountain', 'cargo', 'station', 'priest']; // 3×3
const MOMENTS_MODE = args.includes('--moments'), ONLY = opt('only'); // --only a,b：只拍这几个时刻（同一局里按顺序走）

(async () => {
  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
  const G0 = await openGame({ W, H, chrome: opt('chrome') }), page = G0.page, ev = G0.ev;
  try {
    await ev(HELPER + ';true');
    if (EN_MODE || COLLECT) await ev(EN_SRC + `; __EN.on = ${EN_MODE}; __EN.collect = ${COLLECT}; true`);
    const strings = {};
    const shot = async (name) => {
      // 英文素材：先把界面上的字换掉；收集：只记这一帧前后画出来、看得见的中文
      if (COLLECT) { await ev('__EN.take(); true'); await sleep(160); strings[name] = await ev('__EN.dom(); __EN.take()'); }
      // 英文素材：这一张里还有没换掉的中文就记下来（对照表缺句子）
      if (EN_MODE) { await ev('__EN.takeMiss(); true'); await sleep(160); await ev('__EN.dom(); true'); await sleep(60); const miss = await ev('__EN.takeMiss()'); if (miss.length) strings[name] = miss; }
      const r = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'raw', name + '.png'), Buffer.from(r.data, 'base64'));
    };
    const log = [];
    const SEL = !MOMENTS_MODE ? PLAN : !ONLY ? MOMENTS : MOMENTS.filter((m) => ONLY.split(',').includes(m.name)).map((m, i) => (i === 0 && !m.start ? Object.assign({}, m, { start: '1-1' }) : m));
    for (const s of SEL) {
      if (s.screen === 'title') { await sleep(1500); await shot(s.name); log.push({ name: s.name, ok: true }); continue; }
      if (s.screen === 'eval') { await ev(s.js + '; true'); await sleep(s.wait || 900); await shot(s.name); log.push({ name: s.name, ok: true }); continue; } // 任意界面：先执行 js 再截
      if (s.screen === 'keyart') { await ev(`clearScreens(); G.keyEn = ${EN_MODE}; G.bg = 'keyart'; true`); await sleep(900); await shot(s.name); log.push({ name: s.name, ok: true }); continue; }
      if (s.start) {
        await ev(`(() => { const m = Station.ensure(G.meta); m.seenTitle = true; m.firstRunDone = true; m.tutorialDone = true; m.pilot.lv = 24; G.st.panel = null; __S.loadout(mapOfStage('${s.start}')); startRun('${s.start}');
          const w = G.world; w.catchUp = 0; for (const q of w.players) q.ritualQueue = []; // 截图：不走路标的补发仪式
          // 摆拍：走到后面的图时手上本来就有一套成型的构筑——追踪、雷球升满（自动接上追踪雷链），再加爆破、多重
          if (${!!s.build}) { const add = (kind, id, to) => w.applyOption({ kind, id, from: to - 1, to }); for (const [k, id, to] of [['gun', 'homing', 1], ['support', 'thunder', 1], ['gun', 'homing', 2], ['support', 'thunder', 2], ['gun', 'homing', 3], ['support', 'thunder', 3], ['gun', 'bomb', 1], ['gun', 'bomb', 2], ['gun', 'multi', 1]]) add(k, id, to); w.events.length = 0; }
          return true; })()`);
        await sleep(400); await ev("__S.attach(); G.world.pilotNoBurst = true; hudPin('hearts', true); true"); // 像玩家一样攒着大招，只在“大招”那一刻放；生命按挨过一下以后常驻（UT15）
      }
      if (s.setup) await ev('{ ' + s.setup + ' } true');
      let r = { ok: true };
      if (s.until) r = await ev(`__S.until(${JSON.stringify(s.until)}, ${s.max})`);
      if (s.setup2) await ev('{ ' + s.setup2 + ' } true');
      if (s.hold) await ev('__S.hold = true; true');
      if (s.freeze) await ev('__S.freeze = true; true'); // 停在这一帧（页面照常画）：一闪而过的时刻也拍得到
      if (s.clean) await ev("banner._until = 0; $('#banner').innerHTML = ''; $('#toast').innerHTML = ''; true");
      if (s.seq) { // 连拍：默认游戏按真实时间跑，每隔 every 毫秒一张；给了 dt 就冻住游戏，每张之间快进 dt 秒游戏时间（短先兆也能拍到每一步）
        if (s.seq.dt) await ev('__S.freeze = true; true');
        for (let k = 0; k < s.seq.n; k++) { await sleep(120); await shot(`${s.name}-${String(k + 1).padStart(2, '0')}`); if (s.seq.each) await ev('{ ' + s.seq.each + ' } true'); if (s.seq.dt) await ev(`__S.until('false', ${s.seq.dt})`); else await sleep(s.seq.every); }
        if (s.seq.dt) await ev('__S.freeze = false; true');
        log.push(Object.assign({ name: s.name }, r)); console.log(s.name, JSON.stringify(r)); continue;
      }
      await sleep(s.wait || 180);
      await shot(s.name);
      if (s.hold) await ev('__S.hold = false; true');
      if (s.freeze) await ev('__S.freeze = false; true');
      log.push(Object.assign({ name: s.name }, r));
      console.log(s.name, JSON.stringify(r));
    }
    fs.writeFileSync(path.join(OUT, 'raw', 'log.json'), JSON.stringify(log, null, 1));
    // 合成：在同一个页面的画布里拼（不依赖图像库），导出 PNG
    const b64 = (n) => fs.readFileSync(path.join(OUT, 'raw', n + '.png')).toString('base64');
    const compose = async (spec) => {
      const url = await ev(`(async () => {
        const S = ${JSON.stringify(spec)}, c = document.createElement('canvas'); c.width = S.w; c.height = S.h; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, S.w, S.h);
        for (const it of S.items) { const im = new Image(); im.src = 'data:image/png;base64,' + it.b64; await im.decode(); g.imageSmoothingQuality = 'high'; g.drawImage(im, it.sx, it.sy, it.sw, it.sh, it.x, it.y, it.w, it.h); }
        return c.toDataURL('image/png'); })()`);
      return Buffer.from(url.split(',')[1], 'base64');
    };
    if (MOMENTS_MODE) { // 每个时刻一张接触表：4 列，每格 480×270
      for (const s of MOMENTS) {
        const files = Array.from({ length: s.seq.n }, (_, k) => `${s.name}-${String(k + 1).padStart(2, '0')}`).filter((n) => fs.existsSync(path.join(OUT, 'raw', n + '.png')));
        if (!files.length) continue;
        const rows = Math.ceil(files.length / 4), cw = 480, chh = 270;
        fs.writeFileSync(path.join(OUT, 'raw', `${s.name}-sheet.png`), await compose({ w: cw * 4, h: chh * rows, items: files.map((n, i) => ({ b64: b64(n), sx: 0, sy: 0, sw: W, sh: H, x: (i % 4) * cw, y: Math.floor(i / 4) * chh, w: cw, h: chh })) }));
      }
      console.log('连拍完成', OUT); return;
    }
    // 商店主图 920×430：标题画面按 2.14:1 居中裁
    const ch = Math.round(W * 430 / 920);
    fs.writeFileSync(path.join(OUT, 'images', '01-capsule.png'), await compose({ w: 920, h: 430, items: [{ b64: b64(fs.existsSync(path.join(OUT, 'raw', 'keyart.png')) ? 'keyart' : 'title'), sx: 0, sy: Math.round((H - ch) / 2), sw: W, sh: ch, x: 0, y: 0, w: 920, h: 430 }] }));
    SHOTS.forEach((n, i) => fs.copyFileSync(path.join(OUT, 'raw', n + '.png'), path.join(OUT, 'images', `0${i + 2}-${n}.png`)));
    fs.writeFileSync(path.join(OUT, 'images', '09-trailer-frames.png'), await compose({ w: W, h: H, items: TRAILER.map((n, i) => ({ b64: b64(n), sx: 0, sy: 0, sw: W, sh: H, x: (i % 3) * W / 3, y: Math.floor(i / 3) * H / 3, w: W / 3, h: H / 3 })) }));
    if (COLLECT || EN_MODE) fs.writeFileSync(path.join(OUT, EN_MODE ? 'en-missing.json' : 'strings.json'), JSON.stringify(strings, null, 1));
    const errs = await ev('(window.__errs || []).length');
    console.log('截图完成', OUT, '页面错误', errs);
  } finally {
    G0.close();
  }
})().catch((e) => { console.error('截图失败', e && e.stack || e); process.exitCode = 1; });
