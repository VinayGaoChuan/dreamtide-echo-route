// 录商店素材时的英文（金牌制作人 lessons L6）：游戏开发期只有中文；给英文商店页拍截图、预告片时，只把画面里出现的那几句换成英文，
// 只用于录素材，游戏本身不变。shoot.js --en 时注入页面：画布的 fillText / strokeText / measureText 和界面上的文字都过一遍对照表。
// shoot.js --collect：不换，只把每一张里出现的中文记下来（找出还缺哪几句）。
// 对照表只收商店截图和预告片里真的出现的句子；带数字的句子用正则。
const EN = {
  // 升级仪式
  '主炮': 'Gun', '支援': 'Support', '大招': 'Burst', '联动': 'Link', '资源': 'Bonus',
  '穿透': 'Pierce', '追踪': 'Homing', '多重': 'Multi', '爆破': 'Blast',
  '雷球': 'Thunder Orb', '分身': 'Wingman', '彩虹光束': 'Rainbow Beam', '冰晶': 'Ice Shard', '磁吸星砂': 'Stardust Magnet',
  '子弹穿过敌人继续飞': 'Shots pass through enemies', '子弹自己拐弯找敌人': 'Shots curve toward enemies',
  '飞进圆圈': 'Fly into a circle', '推荐 · 按大招键选它（不耗大招）': 'Recommended · press Burst to pick it',
  '第一次升级': 'First upgrade', '品质提升': 'Quality up',
  // 目标、地图
  '快速处理厚甲编队': 'Break the armored formation fast', '空格': 'Space', '碰这里': 'Touch here', '送到这里': 'Bring it here', '修理点': 'Repair dock',
  '安全航道': 'Safe lane', '依次穿过三个灯环': 'Fly through the three lantern rings', '尾流把灯环连成一座桥，桥上一段时间敌弹会化掉': 'Your trail links them into a bridge that melts enemy shots',
  '风吹开的暗门': 'Wind-blown hatch', '之后会有敌人从这里出来': 'enemies will come out here', '巨鲸醒了': 'The whale wakes', '把附近的敌人一口吞掉': 'and swallows nearby enemies whole',
  '破甲！': 'Armor cracked!', '队友的大招还在放': 'Burst in progress', '大招正在放': 'Burst in progress',
  // 首领
  '失控闹钟': 'Runaway Alarm Clock', '第一乐章': 'Movement I', '第二乐章': 'Movement II', '第三乐章': 'Movement III', '秒针加速': 'second hand speeds up', '指针卡住': 'hands jammed',
  '失控中': 'raging', '超载': 'overload', '弱点暴露': 'weak point open', '彩色狂欢阶段！': 'Color Carnival!', '彩虹流：击中闹钟会掉落更多糖果强化': 'Rainbow build: hitting the clock drops more candy boosts',
  '糖果强化！': 'Candy boost!', '击败失控闹钟！': 'Runaway Alarm Clock defeated!', '指针被冻住了！': 'Hands frozen!',
  '冰晶流：闹钟指针会周期性冻结，核心更常暴露': 'Ice build: the hands freeze now and then and the core opens more often',
  '分身流：分身会自动锁定镜像闹钟': 'Wingman build: wingmen lock onto the mirror clocks',
  '吸星流：闹钟洒出一整片星砂，全部吸进来': 'Magnet build: the clock spills stardust and you pull it all in',
  '爆破流：爆炸能撬开闹钟的核心': 'Blast build: explosions pry the core open',
  '雷暴流：打闹钟会多跳几次电': 'Thunder build: hits on the clock chain extra lightning',
  '失控了': 'Raging', '攻击越来越快': 'attacks keep speeding up', '快打！': 'hit it now!', '5 秒后超载！': 'Overload in 5s!', '超载！': 'Overload!',
  '失控闹钟加快了节奏': 'The Runaway Alarm Clock speeds up', '闯进了失控闹钟的钟面': 'Into the Runaway Alarm Clock’s face',
  '弱点!': 'Weak point!', '护盾破碎!': 'Shield broken!', '护卫散了！': 'Guards scattered!', '先清掉冲出来的护卫': 'Clear the guards first',
  // 首领
  '上半区即将被淹没': 'Upper half about to flood', '下半区即将被淹没': 'Lower half about to flood', '护盾恢复': 'Shield back', '指针冻住了': 'hands frozen', '核心暴露': 'core exposed',
  '时间倒流': 'time rewinds', '终章': 'Finale', '消失的弹幕在原处重演': 'Vanished bullets replay where they were', '爆炸撬开了核心！': 'The blast pried the core open!',
  '闹钟召唤了镜像！': 'The clock summons mirrors!', '散兵清光了': 'Guards cleared', '护盾消失': 'shield down', '散兵来了': 'Guards incoming', '护盾撑起来了': 'shield up',
  // 目标卡
  '击破从裂缝钻出的厚甲怪': 'Crack the armored puffer from the rift', '击破后方绕来的厚甲怪': 'Crack the armored puffer from behind', '击破第一只厚甲怪': 'Crack the first armored puffer',
  '击败失控闹钟': 'Defeat the Runaway Alarm Clock', '击败带队精英': 'Defeat the flag-bearing elite', '击败泡泡小队长': 'Defeat Captain Bubble', '击败裂纹闹钟队长': 'Defeat Captain Cracked Clock',
  '处理上下钻出的厚甲编队': 'Break the formation from above and below', '处理从远处推近的厚甲编队': 'Break the formation pushing in', '挡住后方追兵': 'Hold off the pursuers',
  '摧毁残骸里的刷怪核心': 'Destroy the spawner core in the wreck', '月亮不太对劲': 'Something is off with the moon', '清掉普通怪群': 'Clear the crowd', '清掉空间裂缝里的来敌': 'Clear the rift',
  '角落的贴纸在动？': 'Is that sticker moving?', '这间梦灯屋怪怪的': 'This dream-lamp house looks odd', '等它举旗再集中火力': 'Focus fire when it raises its flag', '对准它连续敲甲片': 'Keep hitting its plates',
  '甲碎了': 'Armor cracked', '打核心': 'hit the core', '最后一段甲': 'Last plate', '裂开一段了': 'One plate down', '继续': 'keep going', '拿奖励': 'Grab the reward', '强化 Build': 'Power up your build',
  '选择强化': 'Pick a power-up', '飞进一个方案': 'fly into one', '选择主炮改造': 'Pick a gun mod', '选择支援': 'Pick a support', '强化来了': 'Power-up incoming', '看它转出什么': 'see what it spins',
  '强化装置启动中…': 'Power-up device starting…', '断桥接上了': 'Bridge rebuilt', '岩壁炸开了': 'The cliff blew open', '岩壁裂口': 'Cliff breach', '之后会有敌人从这里钻出': 'enemies will crawl out here',
  '风环已激活': 'Wind ring on', '一排敌人被推到炮口前': 'a row of enemies pushed into your guns', '风！一排敌人被推到炮口前': 'Wind! A row of enemies pushed into your guns',
  '举旗了': 'Flag raised', '打旗头水晶！': 'hit the flag crystal!', '举旗！弱点露出来了': 'Flag up! Weak point open', '精英叫来了援兵！': 'The elite called for backup!',
  '巨鲸醒了！': 'The whale wakes!', '断桥接上了！桥上一段时间敌弹会化掉': 'Bridge rebuilt! Enemy shots melt on it for a while', 'Boss 掉了一块！': 'A piece of the boss broke off!',
  '躲开了！': 'Dodged!', '大招还没充满': 'Burst not charged', '准点充能': 'On-time charge', '伙伴助力！': 'Friend assist!', '成型！火力大涨': 'Build formed! Firepower up',
  '后方追兵': 'Pursuers from behind', '会从下方绕到前面': 'circling up from below', '会从上方绕到前面': 'circling down from above',
  '上面也会来敌：看云影': 'Enemies from above too: watch the cloud shadows', '下面也会来敌：看海面鼓起': 'Enemies from below too: watch the sea bulge',
  '再来一只厚甲怪：看看现在几秒敲碎': 'Another armored puffer: see how fast it cracks now',
  '连杀': 'combo', '星砂': 'Stardust', '梦木': 'Dreamwood', '星砂海！': 'Stardust tide!', '护卫散了！': 'Guards scattered!', '矿核跟上来了': 'Ore core in tow', '拖到发光的岩壁': 'drag it to the glowing cliff', '挂上拖绳了': 'is on the tow line',
  '沿光带送到修理点': 'follow the light band to the repair dock', '大招充能 ▲▲': 'Burst charge ▲▲', '上层云桥': 'Upper cloud bridge', '糖果商人困在这里！': 'the candy merchant is stuck here!',
  '一大串梦尘蛾扑下来': 'a swarm of dust moths dives in', '云朵爷爷铺了一层云': 'Grandpa Cloud laid a cloud layer', '糖果爆炸': 'Candy blast', 'Boss 来了': 'Boss incoming', '没有大招的补上一次': 'empty bursts get one charge',
  '小闹钟：准点补一次大招': 'Little Clock: one burst charge on time', '月亮刚刚……眨了一下眼？': 'Did the moon just… blink?', '核心露出来了！': 'Core exposed!', '要咬了': 'About to bite',
  '离开那条航道': 'leave that lane', '碎片变成了光环航道': 'The shards became a ring lane', '天上的裂缝里，好像就是 Boss 的入口': 'The crack in the sky looks like the boss gate',
  '缓冲云挡住了': 'Cloud buffer blocked it', '缓冲云层': 'Cloud buffer',
  // 战场提示
  '上方来敌': 'Incoming from above', '下方来敌': 'Incoming from below', '厚甲怪钻出来了！': 'Armored puffer!', '厚甲编队：排成一列': 'Armored formation: lined up',
  '同样的厚甲怪：看看现在几秒敲碎': 'Same armored puffer: see how fast it cracks now', '后面也会来敌：看左边的红影': 'Enemies from behind too: watch the red shadows on the left',
  '沉船里有东西在发光': 'Something glows in the wreck', '裂口里钻出了带队精英': 'A flag-bearing elite burst out of the rift',
};
// 带数字的句子
const EN_RE = [
  [/^Lv(\d)$/, 'Lv$1'],
  [/^\+(\d+) 星尘$/, '+$1 Stardust'],
  [/^([\d.]+) 秒$/, '$1s'],
  [/^(\d+) 秒后超载$/, 'overload in $1s'],
  [/^(\d+) 秒后失控$/, 'rage in $1s'],
  [/^敲甲用时：第一只 ([\d.]+) 秒 → 现在平均 ([\d.]+) 秒$/, 'Armor crack: first $1s → now $2s'],
  [/^穿过第 (\d) 个灯环$/, 'Through ring $1'],
  [/^穿过灯环 (\d)\/(\d)$/, 'Lantern rings $1/$2'],
  [/^修好的炮台 · (\d+)$/, 'Repaired turret · $1'],
  [/^第一只厚甲：敲碎用了 ([\d.]+) 秒$/, 'First armored puffer: cracked in $1s'],
  [/^\+(\d+) 星砂$/, '+$1 Stardust'],
  [/^耐久 (\d)\/3$/, 'pod $1/3'],
  [/^下一个：(.+)$/, 'Next: $1'],
];
const EN_SRC = `
window.__EN = (function () {
  const D = ${JSON.stringify(EN)}, RX = ${JSON.stringify(EN_RE.map(([re, r]) => [re.source, r]))}.map(([s, r]) => [new RegExp(s), r]);
  const CJK = /[\\u3400-\\u9fff\\uff01-\\uff5e\\u3000-\\u303f]/;
  const E = { on: false, collect: false, seen: new Set(), miss: new Set() };
  const tr = (t) => {
    if (typeof t !== 'string' || !CJK.test(t)) return t;
    const k = t.trim();
    if (E.collect) E.seen.add(k);
    if (!E.on) return t;
    const one = (x) => { if (D[x] !== undefined) return D[x]; for (const [re, rep] of RX) if (re.test(x)) return x.replace(re, rep); return null; };
    let o = one(k);
    // 用“ · ”拼起来的一句：每段分别换，全都换得了才用
    if (o === null && k.includes(' · ')) { const ps = k.split(' · ').map(one); if (ps.every((x) => x !== null)) o = ps.join(' · '); }
    if (o === null) { E.miss.add(k); return t; }
    return t.replace(k, o);
  };
  const P = CanvasRenderingContext2D.prototype, f0 = P.fillText, s0 = P.strokeText, m0 = P.measureText;
  P.fillText = function (t, ...a) { return f0.call(this, tr(t), ...a); };
  P.strokeText = function (t, ...a) { return s0.call(this, tr(t), ...a); };
  P.measureText = function (t) { return m0.call(this, E.on ? tr(t) : t); };
  // 界面上看得见的文字（战斗 HUD、横幅、轻提示、当前界面）
  E.dom = () => {
    const out = [];
    for (const root of ['#hud', '#banner', '#toast', '#screens']) {
      const r = document.querySelector(root); if (!r) continue;
      const it = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n;
      while ((n = it.nextNode())) {
        const el = n.parentElement; if (!el || !CJK.test(n.nodeValue)) continue;
        const b = el.getBoundingClientRect(), cs = getComputedStyle(el); if (b.width < 1 || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
        let up = el, gone = false; while (up && up !== document.body) { if (+getComputedStyle(up).opacity === 0) { gone = true; break; } up = up.parentElement; } if (gone) continue;
        if (E.collect) E.seen.add(n.nodeValue.trim());
        if (E.on) n.nodeValue = tr(n.nodeValue);
      }
    }
  };
  E.take = () => { const a = [...E.seen]; E.seen.clear(); return a; };
  E.takeMiss = () => { const a = [...E.miss]; E.miss.clear(); return a; };
  return E;
})();
`;
module.exports = { EN, EN_RE, EN_SRC };
