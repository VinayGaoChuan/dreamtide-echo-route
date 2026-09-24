'use strict';
/* 梦潮回声航线 — design data taken from the gameplay & art documents (v0.2 / Q版 v0.1) */

const WEAPONS = {
  needle: {
    id: 'needle', name: '光针炮', icon: 'w-needle', tag: '稳定远程',
    line: '高速直线光针，站远一点也能稳稳输出。',
    range: '长', rangeN: 5, rateN: 5, cutN: 3, diffN: 1, cut: '中', diff: '低',
    rate: 7, dmg: 8, rangeK: 1.0, pierce: 0, res: 1, speedK: 1.0,
    cutR: 100, cutA: 1.3, meleeDmg: 18,
    who: '第一次进入梦境、喜欢稳扎稳打的玩家',
    problem: '保持距离边躲边射，把蓝色菱形弹留给「切」。',
    unlock: null,
  },
  blade: {
    id: 'blade', name: '梦刃', icon: 'w-blade', tag: '近战切弹',
    line: '挥出月牙刃波，刃波本身也能切开蓝弹。',
    range: '短', rangeN: 2, rateN: 2, cutN: 5, diffN: 3, cut: '强', diff: '中',
    rate: 2, dmg: 28, rangeK: 0.55, pierce: 1, res: 3, speedK: 1.06,
    cutR: 140, cutA: 1.75, meleeDmg: 40,
    who: '喜欢贴脸、享受切开弹幕的玩家',
    problem: '贴近敌人，切开最危险的弹幕。',
    unlock: null,
  },
  kite: {
    id: 'kite', name: '风筝弓', icon: 'w-kite', tag: '延迟输出',
    line: '箭矢先绕场飞一圈，再自己找到目标。',
    range: '中', rangeN: 4, rateN: 2, cutN: 1, diffN: 3, cut: '弱', diff: '中',
    rate: 1.5, dmg: 24, rangeK: 0.85, pierce: 0, res: 2, speedK: 1.03,
    cutR: 80, cutA: 1.05, meleeDmg: 14,
    who: '喜欢走位、让箭矢替自己绕场的玩家',
    problem: '箭会绕路追踪，你只管专心躲，别停下来。',
    unlock: { cost: 120 },
  },
  bell: {
    id: 'bell', name: '影子铃', icon: 'w-bell', tag: '陷阱输出',
    line: '把音符放到敌人身边，延迟后炸成一圈音波。',
    range: '中', rangeN: 3, rateN: 1, cutN: 3, diffN: 5, cut: '中', diff: '高',
    rate: 1, dmg: 12, rangeK: 0.75, pierce: 2, res: 2, speedK: 1.0,
    cutR: 100, cutA: 1.3, meleeDmg: 20,
    who: '喜欢预判、布置陷阱的玩家',
    problem: '把音符放在敌人要去的地方，而不是它现在的位置。',
    unlock: { cost: 180 },
  },
};

const PERFS = {
  echo: { id: 'echo', name: '时间回声', icon: 'p-echo', dur: 5, main: '全屏敌弹速度降到 40%', side: '自身移动速度 +10%', who: '需要观察弹幕的玩家', color: '#9db4ff', unlock: null },
  melody: { id: 'melody', name: '旋律反射', icon: 'p-melody', dur: 4, main: '30% 的敌弹转化为音符弹', side: '音符弹伤害 +35%', who: '喜欢弹反的玩家', color: '#ffe38a', unlock: null },
  gravity: { id: 'gravity', name: '重力倒置', icon: 'p-gravity', dur: 4, main: '敌弹轨迹上下反转', side: '普通敌人被抛向上方', who: '喜欢改变规则的玩家', color: '#8ff0ff', unlock: { cost: 100 } },
  still: { id: 'still', name: '梦境静止', icon: 'p-still', dur: 3, main: '普通敌人冻结', side: 'Boss 弱点暴露 1.5 秒', who: '喜欢稳定输出的玩家', color: '#d8c4ff', unlock: { cost: 150 } },
};

const CARDS = {
  echo: { id: 'echo', name: '回声', icon: 'c-echo', rarity: 'common', max: 2, tag: '重复',
    trigger: '切断、弹反或擦过敌弹时', pos: '被你处理过的敌弹 2 秒后在原地响起回声，化作友方回声弹（伤害 50%）', neg: '弹幕密度 +15%',
    combo: '和梦刃、星屑回响一起用：处理得越多，回声越密。' },
  tide: { id: 'tide', name: '潮汐', icon: 'c-tide', rarity: 'common', max: 1, tag: '重力', excl: 'gravity',
    trigger: '每 10 秒（提前 1 秒预告）', pos: '潮汐翻转：场上所有敌弹上下反转，瞄准你的弹会偏开', neg: '移动速度 -8%',
    combo: '与「落星」同属重力规则，只能保留一张。' },
  gentle: { id: 'gentle', name: '温柔', icon: 'c-gentle', rarity: 'common', max: 2, tag: '恢复',
    trigger: '近战击杀（切弹、梦刃刃波）', pos: '有 20% 概率掉落梦心，恢复 8 点生命', neg: '每波敌人 +2',
    combo: '梦刃玩家的续航核心。' },
  unfocus: { id: 'unfocus', name: '失焦', icon: 'c-unfocus', rarity: 'rare', max: 1, tag: '视野',
    trigger: '持续生效', pos: '敌人本体隐入梦雾，只显示预警与弱点；它们的瞄准弹随之失焦，偏移约 15°', neg: '敌人伤害 +10%',
    combo: '盯住白色预警线和发光核心。' },
  rewind: { id: 'rewind', name: '倒带', icon: 'c-rewind', rarity: 'rare', max: 1, tag: '时间',
    trigger: '受到致命伤害时（每局一次）', pos: '回到 5 秒前的位置与生命值', neg: '最大生命值 -10',
    combo: '与「过热」同时持有属于高风险组合。' },
  mirror: { id: 'mirror', name: '镜中人', icon: 'c-mirror', rarity: 'rare', max: 1, tag: '分身',
    trigger: '持续生效', pos: '生成一个影子，复制你的射击（50% 伤害）并吸引部分敌人瞄准', neg: '影子被击中时，你的共振 -5',
    combo: '影子在画面另一侧，留意它挡在哪条弹道上。' },
  overheat: { id: 'overheat', name: '过热', icon: 'c-overheat', rarity: 'rare', max: 1, tag: '演奏',
    trigger: '释放梦境演奏时', pos: '梦境演奏伤害 +80%', neg: '演奏结束后损失 10% 最大生命',
    combo: '与「倒带」同时持有属于高风险组合。' },
  quiet: { id: 'quiet', name: '安静海', icon: 'c-quiet', rarity: 'common', max: 2, tag: '密度',
    trigger: '持续生效', pos: '弹幕密度 -25%', neg: '梦尘收益 -20%',
    combo: '想先活下来时的好选择。' },
  stardust: { id: 'stardust', name: '星屑回响', icon: 'c-stardust', rarity: 'common', max: 2, tag: '弹反',
    trigger: '精准或完美弹反时', pos: '反射出的音符分裂为 3 枚', neg: '金色星弹速度 +15%',
    combo: '配合旋律反射，音符会铺满画面。' },
  mint: { id: 'mint', name: '薄荷梦', icon: 'c-mint', rarity: 'common', max: 1, tag: '闪避',
    trigger: '持续生效', pos: '闪避充能加快到 3.2 秒一次', neg: '闪避距离 -20%',
    combo: '更适合贴身擦弹的打法。' },
  nightlamp: { id: 'nightlamp', name: '夜航灯', icon: 'c-lamp', rarity: 'common', max: 2, tag: '输出',
    trigger: '持续生效', pos: '射击伤害 +20%', neg: '受到伤害 +15%',
    combo: '越早击倒，越少挨打。' },
  paperboat: { id: 'paperboat', name: '纸船', icon: 'c-boat', rarity: 'rare', max: 1, tag: '护盾',
    trigger: '每个房间开始时', pos: '获得一层纸船护盾，抵挡一次伤害', neg: '梦尘收益 -15%',
    combo: '护盾在房间之间不叠加。' },
  fallstar: { id: 'fallstar', name: '落星', icon: 'c-fallstar', rarity: 'common', max: 1, tag: '重力', excl: 'gravity',
    trigger: '持续生效', pos: '敌弹受重力缓缓下坠，画面上方更安全', neg: '敌弹速度 +10%',
    combo: '与「潮汐」同属重力规则，只能保留一张。' },
};

const RELICS = {
  bellmint: { id: 'bellmint', name: '薄荷铃', icon: 'r-bell', price: 70, desc: '闪避充能上限 +1。' },
  pillow: { id: 'pillow', name: '棉花云枕', icon: 'r-pillow', price: 65, desc: '最大生命 +20，并立刻恢复 20。' },
  fork: { id: 'fork', name: '金色音叉', icon: 'r-fork', price: 60, desc: '弹反判定窗口 +0.04 秒。' },
  crane: { id: 'crane', name: '纸鹤', icon: 'r-crane', price: 70, desc: '每个战斗房间结束后恢复 6 点生命。' },
  sand: { id: 'sand', name: '星砂瓶', icon: 'r-sand', price: 55, desc: '擦弹获得的共振 +2。' },
  glass: { id: 'glass', name: '蓝玻璃刃', icon: 'r-glass', price: 60, desc: '切弹范围 +20%。' },
};

const BULLETS = {
  pink: { id: 'pink', name: '粉色圆弹', label: 'DODGE', shape: '圆形', danger: 1, cut: false, parry: false,
    op: '躲避', move: '直线、弧线或缓慢旋转', reward: '贴身擦过：擦弹，共振 +4', tip: '别硬接，擦边而过就是收益。', color: '#ff7eb6' },
  blue: { id: 'blue', name: '蓝色菱形弹', label: 'CUT', shape: '菱形', danger: 2, cut: true, parry: false,
    op: '靠近后「切」', move: '成列推进，会轻微旋转', reward: '裂成友方碎片追击敌人，共振 +6', tip: '它是冲你来的礼物——迎上去切开。', color: '#5fd4ff' },
  gold: { id: 'gold', name: '金色星弹', label: 'PARRY', shape: '星形', danger: 3, cut: false, parry: true,
    op: '进入危险圈后「切」即弹反', move: '瞄准你飞来，靠近时出现危险圈', reward: '反射成金色音符，共振 +10（完美 +14）', tip: '等它进圈再按，越晚越完美。', color: '#ffd54a' },
  white: { id: 'white', name: '白色细弹', label: 'WARN', shape: '细线', danger: 3, cut: false, parry: false,
    op: '看预警线，提前「闪」', move: '预警 0.3 秒后变亮，约 1 秒后沿线射出', reward: '无额外收益', tip: '先出现透明细线，变亮之后才会发射。', color: '#ffffff' },
  purple: { id: 'purple', name: '紫色泡泡', label: 'ABSORB', shape: '泡泡', danger: 0, cut: false, parry: false,
    op: '接触吸收', move: '慢慢漂浮', reward: '获得梦尘，偶尔是梦心', tip: '它不会伤害你，放心去碰。', color: '#b58cff' },
};

const ENEMY_INFO = {
  jelly: { name: '泡泡水母', desc: '顺着梦潮上下漂浮，钟罩发亮后吐出一小扇粉色圆弹。', bullet: 'pink' },
  boat: { name: '纸船灯', desc: '从右往左横渡梦海，沿途放下蓝色菱形弹。船头朝哪就往哪走。', bullet: 'blue' },
  tick: { name: '小闹钟', desc: '一蹦一跳地找地方站定，摇铃后炸开一圈粉弹，圈上总会留一道缝。', bullet: 'pink' },
  star: { name: '星星鱼', desc: '游到近处，鳍尖一闪，射出一枚金色星弹。', bullet: 'gold' },
  moth: { name: '梦尘蛾', desc: '乱飞的小蛾子，被打散时会掉落紫色梦尘泡泡。', bullet: 'purple' },
  beacon: { name: '灯塔眼', desc: '钉在画面边缘的独眼灯塔，先画出白色预警线，再沿线射出细弹。', bullet: 'white' },
  jellyE: { name: '守望水母', desc: '精英。三颗护盾珠环绕着它，会吐出旋转的粉弹涡。', bullet: 'pink', elite: true },
  tickE: { name: '裂纹闹钟', desc: '精英。表壳上的裂纹在发光，双层粉环夹着蓝色十字。', bullet: 'blue', elite: true },
  starE: { name: '双瞳星鱼', desc: '精英。一双特殊的眼睛，会连续射出三枚金色星弹。', bullet: 'gold', elite: true },
  clock: { name: '失控闹钟', desc: '区域 Boss。代表焦虑与停不下来的时间压力：三个乐章，节奏越来越快，最后让时间倒流。', bullet: 'gold', boss: true },
};

const AFFIXES = {
  fast: { id: 'fast', name: '加速', desc: '移动与弹幕速度提高' },
  echo: { id: 'echo', name: '回声', desc: '受到伤害后重复一次攻击' },
  drain: { id: 'drain', name: '吸梦', desc: '存活时你的共振获取减半' },
  shatter: { id: 'shatter', name: '破碎', desc: '死亡时炸开一圈高密度弹幕' },
};

const ROOM_TYPES = {
  normal: { id: 'normal', name: '普通战斗', icon: 'i-battle', rewards: '梦尘 · 三选一梦境卡', stars: 1 },
  elite: { id: 'elite', name: '精英战斗', icon: 'i-elite', rewards: '更多梦尘 · 稀有卡概率提高 · 下个房间共振上限 130', stars: 3 },
  rest: { id: 'rest', name: '恢复房间', icon: 'i-rest', rewards: '三选一：恢复生命 / 恢复共振 / 移除一张卡（不给梦境卡）', stars: 0 },
  challenge: { id: 'challenge', name: '挑战房间', icon: 'i-challenge', rewards: '大量梦尘 · 额外一张梦境卡 · 记录成绩', stars: 3 },
  shop: { id: 'shop', name: '梦尘商店', icon: 'i-shop', rewards: '遗物 · 梦心 · 临时强化', stars: 0 },
  boss: { id: 'boss', name: '失控闹钟', icon: 'i-boss', rewards: '章节梦尘 · 新剧情 · 解锁新内容', stars: 3 },
};

const NORMAL_GOALS = {
  kill: { id: 'kill', name: '击败所有敌人', short: '击败所有敌人' },
  survive: { id: 'survive', name: '坚持 40 秒', short: '坚持到倒计时结束', time: 40 },
  core: { id: 'core', name: '守护梦境核心 35 秒', short: '守护梦境核心', time: 35 },
};

const REGIONS = [
  { id: 'sea', name: '失眠之海', open: true },
  { id: 'forest', name: '反刍森林', open: false },
  { id: 'glass', name: '玻璃海', open: false },
  { id: 'paper', name: '纸月工厂', open: false },
  { id: 'dawn', name: '黎明裂谷', open: false },
];

const DIFFICULTY = {
  easy: { id: 'easy', name: '新手', bulletSpeed: 0.8, warnBonus: 0.3, invuln: 1.45, resGain: 1.15, extraEnemies: 0, desc: '弹速 80%，预警提前 0.3 秒，受伤后无敌更久，演奏充能 +15%' },
  normal: { id: 'normal', name: '标准', bulletSpeed: 1.0, warnBonus: 0, invuln: 1.0, resGain: 1.0, extraEnemies: 0, desc: '基准数值，首发默认难度' },
  nightmare: { id: 'nightmare', name: '梦魇', bulletSpeed: 1.15, warnBonus: 0, invuln: 0.9, resGain: 1.0, extraEnemies: 1, desc: '弹速 115%，敌人更多，负面更重；通关标准难度后解锁' },
};

const MEMORIES = {
  first: { id: 'first', title: '第一盏梦灯', text: '很久以前，有人在睡不着的夜里点亮了第一盏梦灯。它说：只要还剩一点光，就能把噩梦折成纸船，放回海里。' },
  sleep: { id: 'sleep', title: '熄灭也没关系', text: '灯熄了。你在黑暗里数到七，听见远处有人把你的名字轻轻哼成一段旋律，于是你又亮了一点。' },
  clock: { id: 'clock', title: '失控闹钟的秘密', text: '闹钟其实只是怕迟到。它一遍又一遍拨快时间，想追上一个早就离开的人。现在它终于可以停下来，好好地响一次。' },
  sea: { id: 'sea', title: '失眠之海', text: '海面像一整块玻璃，映着城堡里亮了又灭的窗。每一扇窗后面，都有一个还没睡着的人。' },
  bell: { id: 'bell', title: '回声', text: '你第一次把星星弹回去的时候，它发出的声音像一句“谢谢”。后来你才知道，梦里的攻击，都是没说出口的话。' },
};

/* Route template: 8 columns + boss. Lane 0 = 浅梦航道（更安全）, lane 2 = 深梦航道（奖励更高）. */
const ROUTE_TEMPLATE = [
  [['normal', 0], ['normal', 2]],
  [['normal', 0], ['normal', 1], ['normal', 2]],
  [['normal', 0], ['shop', 1], ['elite', 2]],
  [['normal', 0], ['normal', 1], ['normal', 2]],
  [['rest', 0], ['normal', 1], ['challenge', 2]],
  [['normal', 0], ['normal', 1], ['elite', 2]],
  [['normal', 0], ['normal', 1], ['normal', 2]],
  [['rest', 0], ['shop', 1], ['challenge', 2]],
];
