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

  // 大改（2026-10-07）：拾荒宇宙、站、装备
  '拾荒之翼': 'LOOTWING', '拾荒': 'LOOT', '之翼': 'WING', '点击任意处开始': 'Click anywhere to start', '声音': 'Sound', '联机': 'Online', '记录': 'Records', '设置': 'Settings', '星图': 'Star Map',
  '键鼠 · 手柄  |  进度自动保存在本机': 'Keyboard & mouse · Controller  |  Progress saves on this device', '地球失联第七年。开着捡来的船，从他们的地盘上抢东西。': 'Seven years since Earth went silent. Fly a salvaged ship and loot their territory.',
  '驾驶员': 'Pilot', '信用点': 'Credits', '废料': 'Scrap', '晶片': 'Shards', '晶核': 'Cores', '出击': 'Launch', '关闭': 'Close', '全部': 'All',
  '装备栏': 'Loadout', '换装、比较，看船的全部属性': 'Equip, compare and see every ship stat', '仓库': 'Stash', '商人': 'Merchant', '保险舱': 'Insurance Bay', '拆解台': 'Salvage Bench', '改造台': 'Cube', '黑市': 'Black Market', '机库': 'Hangar', '图鉴': 'Codex',
  '辅助': 'Support', '大招核心': 'Burst Core', '装甲': 'Armor', '引擎': 'Engine', '雷达': 'Radar', '芯片': 'Chip',
  '武器': 'Weapon', '每发伤害': 'Damage per shot', '射速': 'Fire rate', '暴击': 'Crit', '生命': 'Life', '减伤': 'Damage reduction', '移速': 'Move speed', '寻宝率': 'Magic find', '能量伤害': 'Energy damage', '对护盾': 'vs Shields', '对装甲': 'vs Armor', '开局自带': 'Starts with',
  '换上': 'Equip', '卖': 'Sell', '拆': 'Salvage', '标垃圾': 'Mark junk', '锁定': 'Lock', '身上的': 'Equipped', '按住 Alt 看每条词条的档位和范围': 'Hold Alt to see each affix tier and range',
  '火力': 'Firepower', '· 生存': '· Survival', '生存': 'Survival', '光束炮（能量）': 'Beam Cannon (Energy)', '光束炮 · 能量 · 长光枪，自带穿透': 'Beam Cannon · Energy · long lance, pierces',
  '外环废料带': 'Outer Scrap Belt', '残骸河': 'Wreck River', '停摆钟楼站': 'Stopped Clocktower', '锈带残骸场': 'Rust Belt Wreckfield', '霜晶环带': 'Frost Ring', '霓虹电弧城': 'Neon Arc City', '熔核前线': 'Molten Front', '寂静圣所': 'Silent Sanctum',
  '“接通第一座信号塔，让站里亮起灯。”': '“Hook up the first signal tower and light up the station.”', '回声：“从公司的地盘里偷出一张船坞许可证。”': 'Echo: “Steal a shipyard permit from the corporation’s turf.”',
  '穿甲矿业 · 装甲': 'Drill Mining · Armor', '星砂商会 · 护盾': 'Stardust Guild · Shield', '霜晶族 · 护盾': 'Frostkin · Shield', '群翼族 · 装甲': 'Swarmwing · Armor', '电弧公司 · 护盾': 'Arc Corp · Shield', '霓虹马戏 · 护盾': 'Neon Circus · Shield', '熔核军团 · 装甲': 'Molten Legion · Armor',
  '混沌祭司 · 护盾': 'Chaos Priest · Shield', '混沌祭司 · 装甲': 'Chaos Priest · Armor', '混沌祭司': 'Chaos Priest', '第一段 · 布道': 'Part I · Sermon', '第二段 · 静默': 'Part II · Silence', '终段 · 失序': 'Finale · Disorder', '静默': 'SILENCE',
  '熔核步兵长 · 装甲': 'Molten Sergeant · Armor', '击败熔核步兵长！': 'Molten Sergeant defeated!', '打碎正面护甲 0/3（护甲在时核心只吃三成伤害）': 'Break the 3 front plates (the core takes 30% while they stand)',
  '击败失控主钟！': 'Runaway Master Clock defeated!', '✓ 已送回家': '✓ Shipped home', '收账小偷！追上它': 'Collector Thief! Catch it', '钱袋里有装备 · 让它跑了就没了': 'Its sack is full of gear · let it go and it is gone', '袋子破了！': 'The sack burst!', '它带着钱袋跑了……': 'It got away with the sack…',
  '货舱': 'Cargo', '货舱送回家了': 'Cargo shipped home', '2 件装备安全了 · 死了也不会丢': '2 items safe · kept even if you die', '货舱 · 2 件送回家': 'Cargo · 2 items shipped home',
  '可选 · 碰一下吊舱，护送到修理点': 'Optional · touch the pod and escort it to the dock', '碰一下吊舱': 'Touch the pod', '碰一下救生舱': 'Touch the escape pod', '回一颗心': 'Heal one heart', '恢复': 'Heal',
  '追踪雷链': 'Homing Chain Lightning', '钻头': 'Drillhead', '账本': 'Ledger', '霜冠': 'Frost Crown', '蜂后': 'Hive Queen', '董事会': 'Boardroom', '烟火秀': 'Fireworks', '熔炉': 'Forge',
  '4 件：开局自带穿透 1 级；贯穿终点爆炸 +50%': '4 pieces: starts with Pierce Lv1; Piercing Finale +50%', '4 件：开局自带磁吸星砂 1 级': '4 pieces: starts with Stardust Magnet Lv1', '4 件：开局自带冰晶 1 级': '4 pieces: starts with Ice Shard Lv1',
  '4 件：开局自带分身 1 级': '4 pieces: starts with Wingman Lv1', '4 件：开局自带追踪 1 级': '4 pieces: starts with Homing Lv1', '4 件：开局自带彩虹光束 1 级': '4 pieces: starts with Rainbow Beam Lv1', '4 件：开局自带爆破 1 级': '4 pieces: starts with Blast Lv1', '霜冠套装': 'Frost Crown set', '需要驾驶员 14 级': 'Requires pilot level 14', '需要驾驶员 9 级': 'Requires pilot level 9', '开局自带雷球 1 级': 'Starts with Thunder Orb Lv1',
  '祭司召来了信徒 · 先打信徒，护罩才会散': 'The priest summons acolytes · break them to drop his ward', '静默带 · 待在里面打不出子弹': 'Silence band · you cannot fire inside it', '信徒散了 · 祭司的护罩没了': 'Acolytes down · the ward is gone',
  '碰一下发光的矿核': 'Touch the glowing ore core', '升级 · 主炮': 'Upgrade · Gun', '升级 · 支援': 'Upgrade · Support', '弹道': 'Lanes', '雷霆大招': 'Thunder Burst', '大招时降下落雷': 'Lightning strikes during your burst', '落雷': 'Lightning', '品质提升 · 传说': 'Quality up · Legendary', '品质提升 · 史诗': 'Quality up · Epic', '传说': 'Legendary', '史诗': 'Epic', '碰一下门前的铃铛': 'Ring the bell at the door', '碰一下信标亭门前的铃铛': 'Ring the bell at the beacon kiosk', '精英核心 · 碰一下': 'Elite core · touch it', '强化': 'Power-up', '支援模块': 'Support Module',
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
  [/^敲甲用时：第一只 ([\d.]+) 秒$/, 'Armor crack: first $1s'],
  [/^穿过第 (\d) 个灯环$/, 'Through ring $1'],
  [/^穿过灯环 (\d)\/(\d)$/, 'Lantern rings $1/$2'],
  [/^修好的炮台 · (\d+)$/, 'Repaired turret · $1'],
  [/^第一只厚甲：敲碎用了 ([\d.]+) 秒$/, 'First armored puffer: cracked in $1s'],
  [/^\+(\d+) 星砂$/, '+$1 Stardust'],
  [/^耐久 (\d)\/3$/, 'pod $1/3'],
  [/^下一个：(.+)$/, 'Next: $1'],
  [/^\+(\d+) 信用点$/, '+$1 Credits'],
  [/^2 件：(.+)$/, '2 pieces: $1'],
  [/^弹道 (\d) → (\d) 路$/, 'Lanes $1 → $2'],
  [/^敲甲用时：第一只 ([\d.]+) 秒$/, 'Armor crack: first $1s'],
  [/^键鼠 · 手柄\s+\|\s+进度自动保存在本机$/, 'Keyboard & mouse · Controller  |  Progress saves on this device'],
  [/^(穿甲矿业|星砂商会|霜晶族|群翼族|电弧公司|霓虹马戏|熔核军团) · (钻头|账本|霜冠|蜂后|董事会|烟火秀|熔炉)套装（(\d)\/4）$/, '$2 set ($3/4)'],
  [/^(\d+)（([\d.]+) 心）$/, '$1 ($2 hearts)'],
  [/^([\d.]+)\/秒$/, '$1/s'],
  [/^地图 (\d) · (.+?)( ✓)?$/, 'Map $1$3'],
  [/^货舱 \+1 · (.+)$/, 'Cargo +1 · $1'],
  [/^(\d+) 件装备安全了 · 死了也不会丢$/, '$1 items safe · kept even if you die'],
  [/^货舱 · (\d+) 件送回家$/, 'Cargo · $1 items shipped home'],
  [/^(主炮|辅助|大招核心|装甲|引擎|雷达|芯片) · (加强|普通|精英)档 · 物品等级 (\d+)$/, 'item level $3'],
  [/^需要驾驶员 (\d+) 级$/, 'Requires pilot level $1'],
  [/^需要驾驶员 (\d+) 级（现在 (\d+) 级）$/, 'Requires pilot level $1 (now $2)'],
  [/^敲甲用时：第一只 ([\d.]+) 秒 → 现在平均 ([\d.]+) 秒$/, 'Armor crack: first $1s → now $2s'],
];

// 装备名、词条：程序拼出来的，英文画面里按同样的规则拼英文（只用于录素材）
const GEAR_EN = {
  aff: { dmg: 'Damage', rate: 'Fire rate', crit: 'Crit chance', critD: 'Crit damage', energy: 'Energy damage', kinetic: 'Kinetic damage', vsShield: 'vs Shields', vsArmor: 'vs Armor', life: 'Life', dr: 'Damage taken', inv: 'Invulnerability', spd: 'Move speed', leech: 'Life per elite kill', blast: 'Blast radius', homing: 'Homing turn', pierceD: 'Damage after pierce', sideD: 'Side-shot damage', orb: 'Orb chains', wingD: 'Wingman damage', beamW: 'Beam width', iceT: 'Freeze time', starD: 'Starbolt damage', charge: 'Burst charge', burstK: 'Burst damage', mf: 'Magic find', credit: 'Credits', ritual: 'Ritual quality', supK: 'Support damage', pick: 'Pickup range', cap: 'Extra burst stock', gunDmg: 'Damage per shot' },
  pre: { '强袭的': 'Assault', '致命的': 'Deadly', '过载的': 'Overcharged', '沉重的': 'Heavy', '坚固的': 'Sturdy', '爆燃的': 'Blazing', '寻迹的': 'Tracking', '贯通的': 'Piercing', '并列的': 'Flanking', '编队的': 'Squadron', '炽亮的': 'Radiant', '星砂的': 'Stardust', '毁灭的': 'Ruinous', '祝福的': 'Blessed' },
  suf: { '之迅': 'of Haste', '之锐': 'of Precision', '之破盾': 'of Shieldbreaking', '之碎甲': 'of Armorbreaking', '之壁': 'of Walls', '之闪': 'of Flicker', '之疾': 'of Speed', '之饮': 'of Draining', '之链': 'of Chains', '之霜': 'of Frost', '之源': 'of the Source', '之运': 'of Fortune', '之财': 'of Wealth' },
  base: { rapid: ['Scavenger Rapid Cannon', 'Chain Rapid Cannon', 'Storm Rapid Cannon'], scatter: ['Buckshot Scatter Cannon', 'Plasma Scatter Cannon', 'Nova Scatter Cannon'], beam: ['Cutting Beam Cannon', 'Focused Beam Cannon', 'Stellar Beam Cannon'], missile: ['Hive Missiles', 'Hunter Missiles', 'Doom Missiles'],
    aux: ['Support Module', 'Reinforced Support Module', 'Elite Support Module'], coreFast: ['Spark Core', 'Arc Core', 'Stellar Core'], coreTwin: ['Twin Core', 'Heavy Twin Core', 'Elite Twin Core'], plate: ['Patchwork Armor', 'Composite Armor', 'Starsteel Armor'], eng: ['Old Thruster', 'Ion Engine', 'Warp Engine'], radar: ['Scavenger Radar', 'Phased Radar', 'Deep-Space Radar'], chip: ['Chip', 'Encrypted Chip', 'Quantum Chip'] },
  rareA: ['Rustfang', 'Ravenshade', 'Frostscar', 'Brokenstar', 'Ashen', 'Stillfire', 'Steelthroat', 'Wraith', 'Skyrend', 'Bloodmoon', 'Shardbell', 'Undertow', 'Lonelamp', 'Thundertooth', 'Lastpage', 'Coldflame'],
  rareB: { gun: ['Sting', 'Roar', 'Fang', 'Lance', 'Whisper', 'Verdict'], aux: ['Warden', 'Echo', 'Hum', 'Wing', 'Beacon', 'Companion'], core: ['Heart', 'Ember', 'Furnace', 'Pulse', 'Cinder', 'Sun'], armor: ['Shell', 'Scale', 'Bulwark', 'Curtain', 'Carapace', 'Plate'], engine: ['Exhaust', 'Comet', 'Gale', 'Escape', 'Wake', 'Thrust'], radar: ['Eye', 'Antenna', 'Murmur', 'Gaze', 'Echo', 'Lighthouse'], chip: ['Mark', 'Brand', 'Key', 'Rune', 'Core', 'Shard'] },
  kind: { gun: 'Gun', aux: 'Support', core: 'Burst Core', armor: 'Armor', engine: 'Engine', radar: 'Radar', chip: 'Chip' },
  set: { drill: 'Drillhead', ledger: 'Ledger', frost: 'Frost Crown', hive: 'Hive Queen', arc: 'Boardroom', neon: 'Fireworks', forge: 'Forge' },
  uni: { oldScav: 'The Old Scavenger', thunderThroat: 'Thunder Throat', thousandNeedles: 'Thousand Needles', reply: 'The Reply', wingOath: "Wingman's Oath", glacierClock: 'Glacier Clock', neonHeart: 'Neon Heart', moonHeart: 'Moonwheel Heart', timeBox: 'Time Box', kingTriple: "Scavenger King's Triple Bay", rustShell: 'Rust Shell', glassCannon: 'Glass Cannon', escape: 'Escape Velocity', comet: 'Comet Tail', scavEye: "Scavenger's Eye", prophet: 'The Prophet', twinChip: 'Twin Chip', counter: 'The Counter', earthEcho: 'Echo of Earth', chaosShard: 'Chaos Shard' },
  uniLine: { oldScav: '+1 Pierce level', thunderThroat: 'Starts with Thunder Orb Lv1', thousandNeedles: '+1 Multi level; the spread narrows by half', reply: 'Missiles home in slightly', wingOath: '+1 Wingman level', glacierClock: 'Starts with Ice Shard Lv1', neonHeart: 'Starts with Rainbow Beam Lv1', moonHeart: "Your burst becomes Moon Bunny's Moonwheel", timeBox: "Your burst becomes Alarm Clock's Time Stop", kingTriple: 'Stores 2 more bursts', rustShell: 'Moves slower', glassCannon: 'Trades life for firepower', escape: 'While invulnerable after a hit, touched bullets turn to stardust', comet: 'Your trail melts bullets it touches (every 4s)', scavEye: "Elites flash the color of what they'll drop", prophet: 'One extra full ritual at the start', twinChip: 'Crits split into two shots', counter: 'Your damage always counts as the counter type', earthEcho: '+1 level to every ability', chaosShard: 'Double damage for the first 10s of a boss fight' },
  skill: { pierce: 'Pierce', homing: 'Homing', multi: 'Multi', bomb: 'Blast', thunder: 'Thunder Orb', wing: 'Wingman', rainbow: 'Rainbow Beam', ice: 'Ice Shard', magnet: 'Stardust Magnet', burst: 'ship burst', all: 'every ability' },
  grade: { '普通': 'Normal', '加强': 'Exceptional', '精英': 'Elite' },
};
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

  // 装备：名字、底子、词条按英文拼（只在 __EN.on 时）
  const GE = ${JSON.stringify(GEAR_EN)};
  if (typeof Gear !== 'undefined') {
    const nm0 = Gear.name.bind(Gear), bn0 = Gear.baseName.bind(Gear), fa0 = Gear.fmtAffix.bind(Gear), ln0 = Gear.lines.bind(Gear);
    Gear.baseName = (it) => (E.on ? ((GE.base[it.base] || [])[it.grade] || bn0(it)) : bn0(it));
    Gear.name = (it) => {
      if (!E.on) return nm0(it);
      if (it._label) return it._label;
      if (it.uni) return GE.uni[it.uni] || nm0(it);
      if (it.set) return GE.set[it.set] + ' · ' + GE.kind[it.kind];
      if (it.q === 'yellow' && it.rare) return GE.rareA[it.rare[0] % GE.rareA.length] + ' ' + GE.rareB[it.kind][it.rare[1] % GE.rareB[it.kind].length];
      if (it.q === 'blue') { const pre = it.aff.find((a) => AFFIXES[a.k].pre), suf = it.aff.find((a) => AFFIXES[a.k].suf); const pn = pre ? (pre.k === 'plus' ? GE.skill[pre.sk] + ' Mastery ' : GE.pre[AFFIXES[pre.k].pre] + ' ') : ''; return pn + Gear.baseName(it) + (suf ? ' ' + GE.suf[AFFIXES[suf.k].suf] : ''); }
      return Gear.baseName(it);
    };
    Gear.fmtAffix = (k, v, sk) => {
      if (!E.on) return fa0(k, v, sk);
      if (k === 'plus') return '+' + v + ' ' + GE.skill[sk] + ' level';
      if (k === 'gunDmg') return 'Damage per shot ' + v;
      if (k === 'dr') return 'Damage taken −' + v + '%';
      if (k === 'cap') return 'Stores ' + v + ' more burst';
      const A = AFFIXES[k] || {}, pct = A.unit === '%' || k === 'supK' || k === 'pick' ? '%' : '';
      return (GE.aff[k] || k) + ' ' + (v < 0 ? '−' : '+') + Math.abs(v) + pct;
    };
    Gear.lines = (it) => {
      const L = ln0(it); if (!E.on) return L;
      return L.map((l) => { let t = l.t;
        if (it.uni && t === UNIQUES[it.uni].line) t = GE.uni && GE.uniLine[it.uni];
        const m = /^(.+) · (普通|加强|精英)档 · 物品等级 (\\d+)$/.exec(t); if (m) t = GE.kind[it.kind] + ' · ' + GE.grade[m[2]] + ' · item level ' + m[3];
        if (it.kind === 'gun' && t.indexOf(' · ') > 0 && GUN_BASES[it.base] && t.startsWith(GUN_BASES[it.base].weapon)) { const B = GUN_BASES[it.base]; t = ({ rapid: 'Rapid Cannon', scatter: 'Scatter Cannon', beam: 'Beam Cannon', missile: 'Missile Bay' })[B.id] + ' · ' + (B.dtype === 'energy' ? 'Energy' : 'Kinetic') + ' · ' + ({ rapid: 'single straight shots, fires fastest', scatter: 'three-shot fan, short range', beam: 'long lance, pierces', missile: 'slow missiles that splash' })[B.id]; }
        return Object.assign({}, l, { t }); });
    };
  }
  E.take = () => { const a = [...E.seen]; E.seen.clear(); return a; };
  E.takeMiss = () => { const a = [...E.miss]; E.miss.clear(); return a; };
  return E;
})();
`;
module.exports = { EN, EN_RE, EN_SRC };
