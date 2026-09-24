'use strict';
/* 梦潮：回声航线 v0.4 — 自动射击 + 轻度构筑 + 飞行分岔。设计数据来自《局内 Build 与局外成长策划文档 v0.4》，
   美术沿用《Q版美术风格规范 v0.1》。 */

const RARITY = {
  N: { id: 'N', color: '#dfe6ff', glow: 'rgba(223,230,255,0.85)', dupFrags: 10, unlockFrags: 30, rate: 0.55 },
  R: { id: 'R', color: '#7fd8ff', glow: 'rgba(127,216,255,0.9)', dupFrags: 15, unlockFrags: 50, rate: 0.33 },
  SR: { id: 'SR', color: '#c9a0ff', glow: 'rgba(201,160,255,0.9)', dupFrags: 25, unlockFrags: 80, rate: 0.09 },
  SSR: { id: 'SSR', color: '#ffd76a', glow: 'rgba(255,215,106,0.95)', dupFrags: 40, unlockFrags: 120, rate: 0.03 },
};

/* 首批飞机：每架自带基础攻击形状、专属大招、基础被动、随机星盘、专属爆炸颜色 */
const PLANES = {
  moon: {
    id: 'moon', name: '月兔号', rarity: 'N', look: '白色月灯兔', hearts: 5, speed: 1, rate: 8, dmg: 10, shot: '双月牙弹',
    burst: { name: '月轮清屏', desc: '放出巨型月轮，穿过敌人后分裂成六枚小月轮四处弹射。' },
    passive: { name: '月光回收', desc: '月轮命中敌人后回收星尘。' },
    star3: '月轮分裂数量翻倍',
    colors: { body: '#fff6ee', accent: '#ffd76a', exp: ['#fff3c8', '#c9a8ff', '#ffffff'] },
  },
  cloud: {
    id: 'cloud', name: '云朵号', rarity: 'N', look: '白云和小翅膀', hearts: 6, speed: 0.95, rate: 6, dmg: 18, shot: '软绵云团（击退）',
    burst: { name: '云海冲撞', desc: '裹进一整片云海横冲过屏幕，沿途敌人和子弹全部碾碎。' },
    passive: { name: '缓冲云层', desc: '被攻击后生成一层缓冲云，挡下下一次伤害（12 秒冷却）。' },
    star3: '冲撞结束后留下一面云墙挡子弹',
    colors: { body: '#ffffff', accent: '#aee9ff', exp: ['#ffffff', '#aee9ff', '#dcd0ff'] },
  },
  candy: {
    id: 'candy', name: '糖果号', rarity: 'R', look: '粉蓝糖果飞机', hearts: 5, speed: 1, rate: 6, dmg: 8, shot: '三向糖果弹',
    burst: { name: '彩虹糖雨', desc: '彩虹糖雨落满屏幕，被砸中的小怪直接变成糖果。' },
    passive: { name: '糖果掉落', desc: '击杀有概率掉落糖果强化：射速 +50%，持续 5 秒。' },
    star3: '糖雨持续时间延长一半',
    colors: { body: '#ff9fcf', accent: '#9fe3f0', exp: ['#ff9fcf', '#9fe3f0', '#fff3c8'] },
  },
  paper: {
    id: 'paper', name: '纸飞机号', rarity: 'R', look: '奶油纸张质感', hearts: 4, speed: 1.1, rate: 9, dmg: 7, shot: '追踪纸镖',
    burst: { name: '五重分身', desc: '生成五架纸飞机分身，自动锁敌齐射 6 秒。' },
    passive: { name: '折纸编队', desc: '每拾取一次强化，多一架临时分身（最多 3 架，10 秒）。' },
    star3: '分身增加到七架',
    colors: { body: '#fff4dc', accent: '#ffcf8a', exp: ['#fff4dc', '#ffcf8a', '#c9a8ff'] },
  },
  whale: {
    id: 'whale', name: '星鲸号', rarity: 'SR', look: '深蓝小鲸鱼', hearts: 6, speed: 0.95, rate: 10, dmg: 8, shot: '波浪泡泡流',
    burst: { name: '星尘海啸', desc: '先把屏幕里的敌人和子弹吸进来，再吐出一道星尘海啸。' },
    passive: { name: '越多越大', desc: '屏幕上敌人越多，海啸范围越大。' },
    star3: '海啸之后再追加一道小浪',
    colors: { body: '#4f63d6', accent: '#ffe38a', exp: ['#6ff0ff', '#ffe38a', '#8f9dff'] },
  },
  clock: {
    id: 'clock', name: '闹钟号', rarity: 'SSR', look: '金色圆闹钟', hearts: 5, speed: 1, rate: 7, dmg: 13, shot: '旋转指针光束（穿透）',
    burst: { name: '时间暂停', desc: '时间暂停 2 秒，所有敌人被标记，时间恢复时一起爆开。' },
    passive: { name: '准点充能', desc: 'Boss 切换阶段时自动充能一半大招。' },
    star3: '暂停时间延长到 3 秒',
    special: '专属 Boss 互动：暂停期间失控闹钟的指针也会停下，核心完全暴露。',
    colors: { body: '#ffd76a', accent: '#fff3c8', exp: ['#ffd76a', '#fff3c8', '#ff9a6b'] },
  },
};
const PLANE_ORDER = ['moon', 'cloud', 'candy', 'paper', 'whale', 'clock'];

/* 局内技能晶体：六个流派，每个 5 级。最多同时持有 3 种（3 个技能槽）。 */
const SKILLS = {
  thunder: { id: 'thunder', name: '雷球', stream: '雷暴流', icon: 's-thunder', color: '#8fd3ff', glow: 'rgba(143,211,255,0.9)',
    lv: ['发射追踪雷球，命中后跳电 2 次', '一次发射 2 颗，跳电 3 次', '被电到的敌人麻痹 0.6 秒', '跳电 5 次，伤害提高', '雷暴核心：巨型雷球环绕你持续放电'],
    burstMod: '大招后落下一轮连锁雷击' },
  wing: { id: 'wing', name: '纸飞机分身', stream: '分身流', icon: 's-wing', color: '#fff3c8', glow: 'rgba(255,243,200,0.9)',
    lv: ['1 架分身跟随射击', '2 架分身', '分身子弹追踪并穿透', '3 架分身，射速提高', '金色编队：分身变大并三连发'],
    burstMod: '大招时所有分身齐射一轮' },
  bomb: { id: 'bomb', name: '标记爆破', stream: '爆破流', icon: 's-bomb', color: '#ff9a6b', glow: 'rgba(255,154,107,0.9)',
    lv: ['命中时标记敌人，被标记的敌人死亡时爆炸', '标记概率与爆炸范围提高', '爆炸会标记周围敌人，形成连环爆', '爆炸伤害大幅提高', '烟花爆破：爆炸变成巨型彩色烟花'],
    burstMod: '大招时标记全屏敌人' },
  magnet: { id: 'magnet', name: '磁吸星尘', stream: '吸星流', icon: 's-magnet', color: '#c9a8ff', glow: 'rgba(201,168,255,0.9)',
    lv: ['吸附范围变大，每吸一颗星尘发射一枚星弹', '吸附范围继续变大', '每 6 秒一次磁暴，吸来全屏掉落物', '星弹伤害提高', '星尘海啸：定期掀起一道星尘浪'],
    burstMod: '大招时吸来全屏掉落物' },
  rainbow: { id: 'rainbow', name: '彩虹光束', stream: '彩虹流', icon: 's-rainbow', color: '#ff9fcf', glow: 'rgba(255,159,207,0.9)',
    lv: ['定期扫出一道彩虹光束', '光束更宽、间隔更短', '被光束击败的敌人掉落糖果强化', '光束伤害提高', '双彩虹：两道光束交叉扫射'],
    burstMod: '大招时放出一圈彩虹光环' },
  ice: { id: 'ice', name: '冰晶', stream: '冰晶流', icon: 's-ice', color: '#bff4ff', glow: 'rgba(191,244,255,0.9)',
    lv: ['扇形发射冰晶，命中可能冻结敌人', '冰晶数量增加', '必定冻结；冻住的敌人死亡时碎裂伤害周围', '碎裂伤害提高', '暴风雪：定期冻结身边所有敌人'],
    burstMod: '大招时冻结全屏敌人' },
};
const SKILL_ORDER = ['thunder', 'wing', 'bomb', 'magnet', 'rainbow', 'ice'];
const synKey = (a, b) => [a, b].sort((x, y) => SKILL_ORDER.indexOf(x) - SKILL_ORDER.indexOf(y)).join('+');

/* 技能联动：两种技能合计达到 3 层自动触发；只增加收益，没有负面条件 */
const SYNERGIES = {
  'thunder+wing': { name: '雷暴分身', desc: '每架分身每 2 秒发射一枚雷球。' },
  'thunder+bomb': { name: '雷爆连锁', desc: '雷击会标记目标，标记目标受到额外连锁雷击。' },
  'thunder+magnet': { name: '电磁风暴', desc: '每吸一颗星尘，就向附近敌人放一次电。' },
  'thunder+rainbow': { name: '彩虹电网', desc: '彩虹光束扫中的敌人会引发连锁雷击。' },
  'thunder+ice': { name: '超导冰雷', desc: '冻结的敌人受雷击伤害翻倍，跳电 +2。' },
  'wing+bomb': { name: '空投爆破', desc: '分身的子弹也会标记敌人。' },
  'wing+magnet': { name: '吸星编队', desc: '分身也能吸附星尘，吸到就发星弹。' },
  'wing+rainbow': { name: '彩虹编队', desc: '分身各自发射小型彩虹光束。' },
  'wing+ice': { name: '冰翼', desc: '分身的子弹会冻结敌人。' },
  'bomb+magnet': { name: '星尘地雷', desc: '吸来的星尘落地时爆炸。' },
  'bomb+rainbow': { name: '彩虹烟火', desc: '标记爆炸变成彩色烟火，范围 +40%。' },
  'bomb+ice': { name: '冰爆', desc: '冻结的敌人碎裂时引发爆炸。' },
  'magnet+rainbow': { name: '七彩吸附', desc: '光束扫过时把掉落物全部吸向你。' },
  'magnet+ice': { name: '冰晶星尘', desc: '冻结敌人碎裂时掉落双倍星尘。' },
  'rainbow+ice': { name: '冰彩碎', desc: '冰冻敌人碎裂后掉落彩色强化。' },
};

/* 分岔洞口：图标 + 颜色 + 运动特效，不弹说明框 */
const PORTALS = {
  skill: { id: 'skill', name: '技能洞', icon: 'bolt', color: '#5fb8ff', effect: '保证出现当前流派的技能晶体' },
  rare: { id: 'rare', name: '稀有洞', icon: 'star', color: '#ffd54a', effect: '出现稀有技能晶体（一次升 2 级）' },
  wing: { id: 'wing', name: '分身洞', icon: 'wing', color: '#fff3c8', effect: '出现分身相关技能' },
  bomb: { id: 'bomb', name: '爆破洞', icon: 'bomb', color: '#ff8a5c', effect: '出现爆炸相关技能，敌人死亡时会爆开' },
  chest: { id: 'chest', name: '宝箱洞', icon: 'chest', color: '#ffb347', effect: '获得大量星尘和天赋点' },
  heal: { id: 'heal', name: '回复洞', icon: 'heart', color: '#6fe39a', effect: '恢复生命，敌人更少' },
  boss: { id: 'boss', name: 'Boss 洞', icon: 'crown', color: '#ff5a6e', effect: '直接进入 Boss，越早进入奖励越高' },
};

/* 随机天赋星盘：四条路线 × 5 节点，节点只提供正向收益 */
const ROUTES = {
  blast: { id: 'blast', name: '爆炸', icon: 'n-blast', color: '#ffb347', pool: ['blast', 'blast', 'repeat', 'wing', 'blast', 'blast'] },
  fire: { id: 'fire', name: '火力', icon: 'n-fire', color: '#ff8a5c', pool: ['dmg', 'dmg', 'repeat', 'boss', 'dmg', 'dmg'] },
  collect: { id: 'collect', name: '收集', icon: 's-magnet', color: '#9ff2c8', pool: ['magnet', 'magnet', 'heart', 'charge', 'magnet', 'heart'] },
  burst: { id: 'burst', name: '大招', icon: 's-rainbow', color: '#ffd76a', pool: ['charge', 'charge', 'boss', 'blast', 'charge', 'charge'] },
};
const ROUTE_ORDER = ['blast', 'fire', 'collect', 'burst']; // 上 / 左 / 右 / 下
const NODE_TYPES = {
  dmg: { name: '火力', icon: 'n-fire', min: 8, max: 15, fmt: (v) => `普通攻击伤害 +${v}%` },
  blast: { name: '爆炸', icon: 'n-blast', min: 12, max: 20, fmt: (v) => `爆炸范围 +${v}%` },
  charge: { name: '大招充能', icon: 'n-charge', min: 10, max: 18, fmt: (v) => `大招充能速度 +${v}%` },
  magnet: { name: '吸附', icon: 's-magnet', min: 25, max: 40, fmt: (v) => `强化吸附范围 +${v}%` },
  repeat: { name: '重复', icon: 'n-repeat', min: 6, max: 10, fmt: (v) => `技能触发后 ${v}% 概率再触发一次` },
  wing: { name: '分身', icon: 's-wing', min: 1, max: 1, fmt: () => '开局多一架自动分身' },
  heart: { name: '生命', icon: 'i-heart', min: 1, max: 1, fmt: () => '最大生命 +1' },
  boss: { name: 'Boss 伤害', icon: 'n-crown', min: 15, max: 25, fmt: (v) => `Boss 阶段伤害 +${v}%` },
};
const STAR_COST = [30, 60, 100, 150, 220, 300];
const STAR_UP = { 2: { cost: 10, gain: '大招视觉升级：更大、更亮' }, 3: { cost: 20, gain: '解锁第二段大招联动' }, 4: { cost: 30, gain: '星盘多一个随机节点' }, 5: { cost: 50, gain: '解锁终极爆炸演出' } };

const GACHA = { pityStart: 10, pityStep: 0.02, newbiePulls: 10 };

/* 活动任务：同时挂 3 个，领奖后从池里补新任务 */
const TASK_POOL = [
  { id: 'kills', name: '累计击败 400 只小怪', stat: 'kills', goal: 400, reward: 3 },
  { id: 'bursts', name: '释放大招 8 次', stat: 'bursts', goal: 8, reward: 2 },
  { id: 'runs', name: '完成 3 局航行', stat: 'runs', goal: 3, reward: 3 },
  { id: 'syns', name: '触发 4 次技能联动', stat: 'syns', goal: 4, reward: 2 },
  { id: 'streak', name: '单局达成 100 连杀', stat: 'streak100', goal: 1, reward: 2 },
  { id: 'crystals', name: '拾取 20 个技能晶体', stat: 'crystals', goal: 20, reward: 2 },
  { id: 'boss', name: '击败失控闹钟', stat: 'bossKills', goal: 1, reward: 3 },
  { id: 'lv5', name: '把任意技能升到 5 级', stat: 'lv5', goal: 1, reward: 2 },
  { id: 'chest', name: '打开 5 个宝箱', stat: 'chests', goal: 5, reward: 2 },
];

/* 外观：爆炸颜色与拖尾，用外观票解锁 */
const COSMETICS = {
  exp: [
    { id: 'default', name: '飞机原色', colors: null, cost: 0 },
    { id: 'candy', name: '糖果', colors: ['#ff9fcf', '#9fe3f0', '#fff3c8'], cost: 1 },
    { id: 'aurora', name: '极光', colors: ['#6ff0ff', '#9dffb0', '#c9a8ff'], cost: 1 },
    { id: 'gold', name: '熔金', colors: ['#ffd76a', '#ffb347', '#fff6c8'], cost: 1 },
    { id: 'violet', name: '星紫', colors: ['#c9a8ff', '#8f7cf0', '#ffffff'], cost: 1 },
  ],
  trail: [
    { id: 'default', name: '月光', colors: ['rgba(255,246,238,0.7)', 'rgba(201,168,255,0.4)'], cost: 0 },
    { id: 'rainbow', name: '彩虹', colors: ['#ff9fcf', '#ffe38a', '#9fe3f0', '#c9a8ff'], cost: 1 },
    { id: 'stardust', name: '星屑', colors: ['#ffe38a', '#fff6c8'], cost: 1 },
    { id: 'frost', name: '霜蓝', colors: ['#bff4ff', '#6ff0ff'], cost: 1 },
  ],
};

const ENEMY_INFO = {
  jelly: { name: '泡泡水母', desc: '成排漂过来的小怪，一发就散。偶尔吐一颗粉色圆弹。' },
  moth: { name: '梦尘蛾', desc: '成群乱飞，会掉很多星尘，是连杀的好材料。' },
  boat: { name: '纸船灯', desc: '横渡梦海，沿途往下投粉色圆弹。' },
  tick: { name: '小闹钟', desc: '跳到位置后摇铃，炸开一圈子弹，圈上留着缝。' },
  star: { name: '星星鱼', desc: '朝你所在的高度俯冲，射出一枚金色星弹。' },
  beacon: { name: '灯塔眼', desc: '先画出白色预警线，再沿线射出细弹。' },
  jellyE: { name: '守望水母', desc: '精英。吐出旋转的粉弹涡，击败后掉技能晶体和大量充能。' },
  tickE: { name: '裂纹闹钟', desc: '精英。双层弹环加十字弹列。' },
  starE: { name: '双瞳星鱼', desc: '精英。连续射出三枚金色星弹。' },
  mirror: { name: '镜像闹钟', desc: '失控闹钟面对分身流时召唤的镜像，分身会自动锁定它们。' },
  clock: { name: '失控闹钟', desc: '区域 Boss。会看见你的 Build：雷暴让它导电，爆破打开它的护甲，冰晶冻住它的指针。' },
};

/* 数据验收标准（文档 §16） */
const METRIC_TARGETS = [
  { id: 'firstKill', name: '首次击杀时间', target: 5, cmp: 'le', unit: '秒' },
  { id: 'firstSkill', name: '首次技能获取', target: 20, cmp: 'le', unit: '秒' },
  { id: 'firstSyn', name: '首次联动', target: 60, cmp: 'le', unit: '秒' },
  { id: 'firstBurst', name: '首次大招', target: 90, cmp: 'le', unit: '秒' },
  { id: 'changes', name: '单局技能变化', target: 6, cmp: 'ge', unit: '次' },
  { id: 'highlights', name: '单局明显爽点', target: 8, cmp: 'ge', unit: '次' },
  { id: 'avgKill', name: '普通小怪平均击杀时间', target: 0.5, cmp: 'le', unit: '秒' },
  { id: 'gap', name: '战斗段之间的空档', target: 1.2, cmp: 'le', unit: '秒' },
  { id: 'restart', name: '失败后重开时间', target: 3, cmp: 'le', unit: '秒' },
  { id: 'second', name: '第二局点击率', target: 55, cmp: 'ge', unit: '%' },
];
