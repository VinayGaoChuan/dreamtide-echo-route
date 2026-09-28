'use strict';
/* 梦潮：回声航线 v0.4 — 自动射击 + 轻度构筑 + 飞行分岔。设计数据来自《局内 Build 与局外成长策划文档 v0.4》，
   美术沿用《Q版美术风格规范 v0.1》。 */

const RARITY = {
  N: { id: 'N', color: '#dfe6ff', glow: 'rgba(223,230,255,0.85)', dupFrags: 10, unlockFrags: 30, rate: 0.55 },
  R: { id: 'R', color: '#7fd8ff', glow: 'rgba(127,216,255,0.9)', dupFrags: 15, unlockFrags: 50, rate: 0.33 },
  SR: { id: 'SR', color: '#c9a0ff', glow: 'rgba(201,160,255,0.9)', dupFrags: 25, unlockFrags: 80, rate: 0.09 },
  SSR: { id: 'SSR', color: '#ffd76a', glow: 'rgba(255,215,106,0.95)', dupFrags: 40, unlockFrags: 120, rate: 0.03 },
};

/* 飞机：v0.7 起所有飞机的主炮规则相同——自动开火、固定向右、单发、命中即消失（伤害 10，8 发/秒）。
   飞机之间的差别在外形、弹体造型、生命、速度、专属大招、被动和天赋树。 */
const PLANES = {
  moon: {
    id: 'moon', name: '月兔号', rarity: 'N', look: '白色月灯兔', hearts: 5, speed: 1, rate: 8, dmg: 10, shot: '月牙弹',
    burst: { name: '月轮清屏', desc: '放出巨型月轮，穿过敌人后分裂成六枚小月轮四处弹射。' },
    passive: { name: '月光回收', desc: '月轮命中敌人后回收星砂。' },
    star3: '月轮分裂数量翻倍',
    colors: { body: '#fff6ee', accent: '#ffd76a', exp: ['#fff3c8', '#c9a8ff', '#ffffff'] },
  },
  cloud: {
    id: 'cloud', name: '云朵号', rarity: 'N', look: '白云和小翅膀', hearts: 6, speed: 0.95, rate: 8, dmg: 10, shot: '软云团（轻微击退）',
    burst: { name: '云海冲撞', desc: '裹进一整片云海横冲过屏幕，沿途敌人和子弹全部碾碎。' },
    passive: { name: '缓冲云层', desc: '被攻击后生成一层缓冲云，挡下下一次伤害（12 秒冷却）。' },
    star3: '冲撞结束后留下一面云墙挡子弹',
    colors: { body: '#ffffff', accent: '#aee9ff', exp: ['#ffffff', '#aee9ff', '#dcd0ff'] },
  },
  candy: {
    id: 'candy', name: '糖果号', rarity: 'R', look: '粉蓝糖果飞机', hearts: 5, speed: 1, rate: 8, dmg: 10, shot: '糖果弹',
    burst: { name: '彩虹糖雨', desc: '彩虹糖雨落满屏幕，被砸中的小怪直接变成糖果。' },
    passive: { name: '糖果掉落', desc: '击杀有概率掉落糖果强化：射速 +50%，持续 5 秒。' },
    star3: '糖雨持续时间延长一半',
    colors: { body: '#ff9fcf', accent: '#9fe3f0', exp: ['#ff9fcf', '#9fe3f0', '#fff3c8'] },
  },
  paper: {
    id: 'paper', name: '纸飞机号', rarity: 'R', look: '奶油纸张质感', hearts: 4, speed: 1.1, rate: 8, dmg: 10, shot: '纸镖',
    burst: { name: '五重分身', desc: '生成五架纸飞机分身，自动锁敌齐射 6 秒。' },
    passive: { name: '折纸编队', desc: '每拾取一次强化，多一架临时分身（最多 3 架，10 秒）。' },
    star3: '分身增加到七架',
    colors: { body: '#fff4dc', accent: '#ffcf8a', exp: ['#fff4dc', '#ffcf8a', '#c9a8ff'] },
  },
  whale: {
    id: 'whale', name: '星鲸号', rarity: 'SR', look: '深蓝小鲸鱼', hearts: 6, speed: 0.95, rate: 8, dmg: 10, shot: '泡泡弹',
    burst: { name: '星砂海啸', desc: '先把屏幕里的敌人和子弹吸进来，再吐出一道星砂海啸。' },
    passive: { name: '越多越大', desc: '屏幕上敌人越多，海啸范围越大。' },
    star3: '海啸之后再追加一道小浪',
    colors: { body: '#4f63d6', accent: '#ffe38a', exp: ['#6ff0ff', '#ffe38a', '#8f9dff'] },
  },
  clock: {
    id: 'clock', name: '闹钟号', rarity: 'SSR', look: '金色圆闹钟', hearts: 5, speed: 1, rate: 8, dmg: 10, shot: '指针弹',
    burst: { name: '时间暂停', desc: '时间暂停 2 秒，所有敌人被标记，时间恢复时一起爆开。' },
    passive: { name: '准点充能', desc: 'Boss 切换阶段时自动充能一半大招。' },
    star3: '暂停时间延长到 3 秒',
    special: '专属 Boss 互动：暂停期间失控闹钟的指针也会停下，核心完全暴露。',
    colors: { body: '#ffd76a', accent: '#fff3c8', exp: ['#ffd76a', '#fff3c8', '#ff9a6b'] },
  },
};
const PLANE_ORDER = ['moon', 'cloud', 'candy', 'paper', 'whale', 'clock'];

/* ================================================== v0.7 局内 Build：三个槽位 ==================================================
   1 主炮改造链（穿透 / 追踪 / 多重 / 爆破，兼容累积，各 3 级）
   2 自动支援（雷球 / 分身 / 彩虹 / 冰晶 / 磁吸，同时只带一个，3 级；换新的会先展示替换前后）
   3 大招改造（同时一个，2 级）
   开局子弹固定向前、单发、命中即消失；这些能力只能在局内二选一获得，新一局清空。 */
const SKILLS = {
  pierce: { id: 'pierce', slot: 'gun', name: '穿透', stream: '贯穿', icon: 's-pierce', canvas: 'pierce', color: '#ffe38a', glow: 'rgba(255,227,138,0.9)', max: 3,
    lv: ['同一颗子弹最多命中 2 个不同敌人', '最多命中 3 个', '最多命中 4 个'], look: '弹头拉长，贯穿后留下短光轨' },
  homing: { id: 'homing', slot: 'gun', name: '追踪', stream: '追踪', icon: 's-homing', canvas: 'homing', color: '#6ff0ff', glow: 'rgba(111,240,255,0.9)', max: 3,
    lv: ['子弹缓慢转向前方目标', '转得更快、找得更宽', '目标死了会重新找前方敌人'], look: '子弹尾迹弯曲，转向清楚可见' },
  multi: { id: 'multi', slot: 'gun', name: '多重', stream: '散射', icon: 's-multi', canvas: 'multi', color: '#ffb347', glow: 'rgba(255,179,71,0.9)', max: 3,
    lv: ['主炮变成 2 路', '主炮 3 路', '主炮 4 路'], look: '炮口分出几道并排弹' },
  bomb: { id: 'bomb', slot: 'gun', name: '爆破', stream: '爆破', icon: 's-bomb', canvas: 'bomb', color: '#ff9a6b', glow: 'rgba(255,154,107,0.9)', max: 3,
    lv: ['命中会标记敌人，被标记的敌人死亡时爆炸', '爆炸更大，并把周围敌人一起标记', '每颗子弹最后一次命中时都会爆开'], look: '命中处留下橙色准星' },
  thunder: { id: 'thunder', slot: 'support', name: '雷球', stream: '雷暴', icon: 's-thunder', canvas: 'bolt', color: '#8fd3ff', glow: 'rgba(143,211,255,0.9)', max: 3,
    lv: ['定时放出追踪雷球，命中后跳电', '双雷球，被电到的小怪麻痹', '雷暴核心：巨型雷球环绕你持续放电'] },
  wing: { id: 'wing', slot: 'support', name: '分身', stream: '蜂群', icon: 's-wing', canvas: 'wing', color: '#fff3c8', glow: 'rgba(255,243,200,0.9)', max: 3,
    lv: ['1 架纸飞机分身，继承主炮改造', '2 架分身', '3 架金色分身，射速更快'] },
  rainbow: { id: 'rainbow', slot: 'support', name: '彩虹光束', stream: '彩虹', icon: 's-rainbow', canvas: 'rainbow', color: '#ff9fcf', glow: 'rgba(255,159,207,0.9)', max: 3,
    lv: ['定期扫出一道彩虹光束', '光束更宽，击败的敌人掉糖果强化', '双彩虹交叉扫射'] },
  ice: { id: 'ice', slot: 'support', name: '冰晶', stream: '冰晶', icon: 's-ice', canvas: 'snow', color: '#bff4ff', glow: 'rgba(191,244,255,0.9)', max: 3,
    lv: ['扇形冰晶，命中可能冻结', '必定冻结，冻住的敌人碎裂伤害周围', '暴风雪：定期冻结身边所有敌人'] },
  magnet: { id: 'magnet', slot: 'support', name: '磁吸星砂', stream: '吸星', icon: 's-magnet', canvas: 'magnet', color: '#c9a8ff', glow: 'rgba(201,168,255,0.9)', max: 3,
    lv: ['吸附变大，每吸一颗星砂射出一枚星弹', '每 6 秒一次磁暴，吸来全屏掉落物', '星砂海啸：定期掀起一道星尘浪'] },
};
const GUN_ORDER = ['pierce', 'homing', 'multi', 'bomb'];
const SUPPORT_ORDER = ['thunder', 'wing', 'rainbow', 'ice', 'magnet'];
const SKILL_ORDER = [...GUN_ORDER, ...SUPPORT_ORDER];
const UPG_LEGACY = [0, 1, 3, 5]; // 支援 / 爆破的 1~3 级对应旧效果档位
const synKey = (a, b) => [a, b].sort((x, y) => SKILL_ORDER.indexOf(x) - SKILL_ORDER.indexOf(y)).join('+');
/* 追踪参数（原型值）：转向速度 度/秒，搜索半角 度 */
const HOMING = { turn: [0, 90, 150, 210], cone: [0, 35, 50, 65] };

const BURST_MODS = {
  thunderB: { id: 'thunderB', name: '雷霆大招', icon: 's-thunder', color: '#8fd3ff', lv: ['大招时降下 8 道落雷', '落雷增加到 14 道'] },
  iceB: { id: 'iceB', name: '冰封大招', icon: 's-ice', color: '#bff4ff', lv: ['大招冻结全场敌人 1.5 秒', '冻结 3 秒，冻住的敌人碎裂'] },
  bombB: { id: 'bombB', name: '连爆大招', icon: 's-bomb', color: '#ff9a6b', lv: ['大招标记全场敌人，死亡即爆炸', '爆炸范围再大一半'] },
  dustB: { id: 'dustB', name: '星砂回收', icon: 's-magnet', color: '#c9a8ff', lv: ['大招吸回全场星砂，返还 25% 充能', '返还 45% 充能'] },
};
const BURST_MOD_ORDER = ['thunderB', 'iceB', 'bombB', 'dustB'];

/* 联动：两个前置都拿到后才会出现在候选里（第三次选择保证至少一个能联动） */
const SYNERGIES = {
  'pierce+bomb': { name: '贯穿终点爆炸', desc: '穿透子弹用完最后一次命中时炸开一大团。', need: ['pierce', 'bomb'], stream: '贯穿爆破流' },
  'homing+wing': { name: '蜂群同步开火', desc: '分身跟主炮同步开火，分身子弹追踪 +1 级。', need: ['homing', 'wing'], stream: '追踪蜂群流' },
  'homing+thunder': { name: '追踪雷链', desc: '追踪弹命中时再向旁边的敌人放一道电。', need: ['homing', 'thunder'], stream: '追踪雷暴流' },
  'multi+ice': { name: '散射冰晶', desc: '多重的侧翼子弹命中即冻结。', need: ['multi', 'ice'], stream: '散射冰晶流' },
  'bomb+thunder': { name: '雷爆连锁', desc: '雷击会标记目标，标记爆炸再放电。', need: ['bomb', 'thunder'], stream: '雷爆流' },
  'bomb+rainbow': { name: '彩虹烟火', desc: '标记爆炸变成彩色烟火，范围 +40%。', need: ['bomb', 'rainbow'], stream: '烟火流' },
  'multi+magnet': { name: '星砂散射', desc: '吸到星砂时一次射出三枚星弹。', need: ['multi', 'magnet'], stream: '星砂散射流' },
};

/* 分岔洞口：图标 + 颜色 + 运动特效，不弹说明框 */
const PORTALS = {
  skill: { id: 'skill', name: '技能洞', icon: 'bolt', color: '#5fb8ff', effect: '进洞后马上来一次升级二选一', short: '进洞马上升级二选一' },
  rare: { id: 'rare', name: '稀有洞', icon: 'star', color: '#ffd54a', effect: '进洞马上来一次稀有二选一：方案一次升 2 级，或直接给联动', short: '稀有二选一 · 一次升 2 级' },
  bomb: { id: 'bomb', name: '爆破洞', icon: 'bomb', color: '#ff8a5c', effect: '这一段的敌人死亡时会爆开，星砂更多', short: '敌人死亡会爆开 · 星砂更多' },
  chest: { id: 'chest', name: '宝箱洞', icon: 'chest', color: '#ffb347', effect: '这一段出现 3 个宝箱：星砂 + 飞机碎片', short: '3 个宝箱：星砂 + 飞机碎片' },
  heal: { id: 'heal', name: '回复洞', icon: 'heart', color: '#6fe39a', effect: '恢复 2 颗心，这一段敌人更少', short: '回 2 颗心 · 敌人更少' },
  boss: { id: 'boss', name: 'Boss 门', icon: 'crown', color: '#ff5a6e', effect: '进入本关 Boss；大招库存为 0 时补到 1 次', short: '挑战本关 Boss' },
};

/* 飞机随机天赋树：解锁飞机时按种子生成一次并保存；共享等级每升一级给 1 个天赋点，默认高亮推荐节点。
   穿透 / 追踪类节点只强化本局已经拿到的能力，拿到前保持“待激活”。大招容量是固定里程碑，不在随机池里。 */
const ROUTES = {
  fire: { id: 'fire', name: '火力', icon: 'n-fire', color: '#ff8a5c', pool: ['dmg', 'pierceX', 'dmg', 'homingX', 'dmg'] },
  blast: { id: 'blast', name: '爆炸', icon: 'n-blast', color: '#ffb347', pool: ['blast', 'boss', 'blast', 'repeat', 'boss'] },
  collect: { id: 'collect', name: '探索', icon: 's-magnet', color: '#9ff2c8', pool: ['houseFast', 'magnet', 'npcBoost', 'magnet', 'houseFast'] },
  burst: { id: 'burst', name: '生存', icon: 'i-heart', color: '#ffd76a', pool: ['charge', 'heart', 'charge', 'heart', 'charge'] },
};
const ROUTE_ORDER = ['fire', 'blast', 'collect', 'burst'];
const NODE_TYPES = {
  dmg: { name: '火力', icon: 'n-fire', min: 5, max: 8, fmt: (v) => `普通攻击伤害 +${v}%`, score: 3, why: '所有关卡的主炮都更快清怪' },
  blast: { name: '爆炸', icon: 'n-blast', min: 12, max: 20, fmt: (v) => `爆炸范围 +${v}%`, score: 2, why: '爆破类改造和爆炸范围更大' },
  charge: { name: '大招充能', icon: 'n-charge', min: 10, max: 16, fmt: (v) => `大招充能速度 +${v}%`, score: 3, why: '更早、更常放专属大招' },
  magnet: { name: '吸附', icon: 's-magnet', min: 25, max: 40, fmt: (v) => `掉落物吸附范围 +${v}%`, score: 1, why: '捡星砂更轻松' },
  repeat: { name: '重复', icon: 'n-repeat', min: 6, max: 10, fmt: (v) => `支援技能 ${v}% 概率再触发一次`, score: 2, why: '支援技能有概率多放一次' },
  heart: { name: '生命', icon: 'i-heart', min: 1, max: 1, fmt: () => '最大生命 +1', score: 3, why: '多一次失误的余地' },
  boss: { name: 'Boss 伤害', icon: 'n-crown', min: 12, max: 20, fmt: (v) => `Boss 伤害 +${v}%`, score: 2, why: '打 Boss 更快' },
  pierceX: { name: '穿透强化', icon: 's-pierce', min: 1, max: 1, fmt: () => '已获得穿透时：额外多命中 1 个', score: 2, why: '拿到穿透后，每颗子弹多穿 1 个', needs: 'pierce' },
  homingX: { name: '追踪强化', icon: 's-homing', min: 15, max: 15, fmt: (v) => `已获得追踪时：转向 +${v}%`, score: 2, why: '拿到追踪后转弯更快', needs: 'homing' },
  houseFast: { name: '地图充能', icon: 'i-hangar', min: 15, max: 20, fmt: (v) => `梦灯屋 / 星砂矿充能快 ${v}%`, score: 2, why: '梦灯屋和星砂矿更快出奖励' },
  npcBoost: { name: '伙伴辅助', icon: 'i-heart', min: 25, max: 35, fmt: (v) => `伙伴射击与效果 +${v}%`, score: 1, why: '救出的伙伴更能打' },
};
/* 大招容量：账号共享的固定里程碑 */
const ULT_CAP = [{ cap: 1, need: null, text: '初始' }, { cap: 2, need: '1-1', text: '1-1 首次通关' }, { cap: 3, need: '1-3', text: '1-3 首次通关' }];
/* 共享等级：星尘升级，所有飞机一起变强（原型值） */
const SHARED = { max: 10, cost: [0, 0, 100, 160, 220, 280, 340, 400, 460, 520, 580], atk: 1.06, heartAt: [3, 6, 9] };
const sharedAtk = (lv) => Math.pow(SHARED.atk, lv - 1);
const sharedHearts = (lv) => SHARED.heartAt.filter((x) => lv >= x).length;

/* 章节 / 关卡：一关 = 一次完整出击（约 6~8 分钟），只在出击结束时结算。难度固定，不跟随玩家成长抬高。
   v0.8 起关卡按目标链推进（STAGE_PLANS），fill = 背景杂兵的出兵速度（只/秒）。 */
const STAGES = {
  '1-1': { id: '1-1', ch: 1, name: '梦灯海湾', segs: 6, segDur: 54, hpK: 1, avg: 5, peak: 9, fill: 2.3, elites: ['jellyE'], boss: 'captain', bossName: '泡泡小队长', bossHp: 6000, rec: 1, reward: 120, fail: [30, 90], ult: 1,
    map: ['house', 'mine', 'npc', 'house', 'mine', 'npc'], intro: '第一次出击：开局只会直射；先清普通怪群，再对付越来越硬的厚甲怪。' },
  '1-2': { id: '1-2', ch: 1, name: '纸船灯河', segs: 7, segDur: 50, hpK: 9 / 8, avg: 6, peak: 11, fill: 2.7, elites: ['tickE', 'jellyE'], boss: 'captain2', bossName: '裂纹闹钟队长', bossHp: 9000, rec: 2, reward: 150, fail: [40, 100], ult: 2,
    map: ['house', 'bridge', 'mine', 'npc', 'house', 'mine', 'npc'], intro: '敌人会从裂缝、上下方钻出来；途中要护送一位伙伴。' },
  '1-3': { id: '1-3', ch: 1, name: '失眠钟塔', segs: 8, segDur: 42, hpK: 10 / 8, avg: 7, peak: 13, fill: 3.1, elites: ['starE', 'tickE', 'jellyE'], boss: 'clock', bossName: '失控闹钟', bossHp: 1000, rec: 3, reward: 190, fail: [50, 120], ult: 2,
    map: ['house', 'mine', 'bridge', 'npc', 'giant', 'house', 'mine', 'npc'], intro: '后方追兵和空间裂缝一起出现，最后是第一章 Boss：失控闹钟。' },
};
const STAGE_ORDER = ['1-1', '1-2', '1-3'];

/* 可以追的流派（大厅“下一局目标”、暂停、结算、升级卡片共用） */
const BUILD_PATHS = [
  { name: '贯穿爆破流', path: ['pierce', 'bomb', 'multi', 'pierce+bomb'], hint: '一道火线清掉成排敌人' },
  { name: '追踪蜂群流', path: ['homing', 'wing', 'homing+wing'], hint: '飞机和分身扫掉四处散开的敌人' },
  { name: '追踪雷暴流', path: ['homing', 'thunder', 'homing+thunder'], hint: '追踪弹命中就放电' },
  { name: '散射冰晶流', path: ['multi', 'ice', 'multi+ice'], hint: '一排冰弹把整队冻住' },
  { name: '烟火流', path: ['bomb', 'rainbow', 'bomb+rainbow'], hint: '标记爆炸变成彩色烟火' },
  { name: '雷爆流', path: ['bomb', 'thunder', 'bomb+thunder'], hint: '雷击标记目标，爆炸再放电' },
  { name: '星砂散射流', path: ['multi', 'magnet', 'multi+magnet'], hint: '吸到星砂就射出一把星弹' },
];
function buildOwned(b, id) { if (!b) return false; if (id.includes('+')) return (b.links || []).includes(id); return !!((b.gun && b.gun[id] > 0) || (b.support && b.support.id === id)); }
/* 目标流派：和当前 Build 最接近、还没做完的那条；一样接近时按局数轮换 */
function pickTarget(b, rot) {
  const N = BUILD_PATHS.length; let best = null, bs = -1e9;
  BUILD_PATHS.forEach((P, i) => {
    const comps = P.path.filter((x) => !x.includes('+')), link = P.path.find((x) => x.includes('+'));
    const own = comps.filter((id) => buildOwned(b, id)).length, done = own === comps.length && (!link || buildOwned(b, link));
    const s = (done ? -100 : 0) + own * 10 - ((i - (rot || 0) % N + N) % N) * 0.01;
    if (s > bs) { bs = s; best = P; }
  });
  return best;
}
function buildPlan(b, targetName, rot) {
  b = b || { gun: {}, support: null, links: [] };
  const P = BUILD_PATHS.find((x) => x.name === targetName) || pickTarget(b, rot);
  const comps = P.path.filter((x) => !x.includes('+')), link = P.path.find((x) => x.includes('+')) || null;
  const have = comps.filter((id) => buildOwned(b, id)), miss = comps.filter((id) => !buildOwned(b, id)), linkOwned = !!(link && buildOwned(b, link));
  const next = miss[0] || (link && !linkOwned ? link : null);
  const swap = next && SKILLS[next] && SKILLS[next].slot === 'support' && b.support && b.support.id !== next ? b.support.id : null;
  let alt = null;
  for (const [k, L] of Object.entries(SYNERGIES)) {
    if (k === link || buildOwned(b, k)) continue;
    const [x, y] = L.need; if (buildOwned(b, x) === buildOwned(b, y)) continue;
    alt = { key: k, have: buildOwned(b, x) ? x : y, miss: buildOwned(b, x) ? y : x }; break;
  }
  return { name: P.name, hint: P.hint, path: P.path, comps, link, linkOwned, have, miss, next, swap, done: !next, alt };
}

/* 失败复盘：按实际受伤来源归类，结算只挑最常见的一类给一条能照做的建议 */
const HURT_TIPS = {
  armorC: { label: '撞上厚甲怪', tip: '厚甲怪不会自己离开：别贴上去，停在它正前方稍远处连续打甲片' },
  contact: { label: '撞上小怪', tip: '别贴着敌群飞：和前面的敌人留一点距离，直线子弹才打得到' },
  rear: { label: '后方追兵', tip: '左边缘出现红影时，先移到虚线弧的另一侧，等追兵绕到前面再打' },
  lane: { label: '预警航道里的攻击', tip: '条纹航道亮起就先离开那条横线，攻击扫过去再回来' },
  aimed: { label: '瞄准你的子弹', tip: '敌人朝你当前的位置开火：连续打的时候隔一会儿上下挪一小段' },
  ring: { label: '闹钟的弹环', tip: '弹环总留着缺口：看准缺口从那里穿过去' },
  laser: { label: '白线激光', tip: '灯塔眼先画白线再射：看到白线就离开那条线' },
  drop: { label: '纸船投下的弹', tip: '纸船灯往下投弹：别待在它们正下方' },
  boss: { label: 'Boss 的弹幕', tip: '先对准正面护甲打；弹幕来时只小幅移动找空隙，别大范围乱飞' },
  surprise: { label: '惊喜怪的攻击', tip: '它咬过来前会先画出航道：离开那条航道再回头打' },
  shot: { label: '敌弹', tip: '被击中后有一小段无敌：趁这段时间换到安全的高度' },
};
function hurtCat(src) {
  if (!src) return 'shot';
  if (src === 'c:armor' || src === 'c:wreck') return 'armorC';
  if (src === 'c:chaser' || src === 'b:chaser') return 'rear';
  if (['c:mimic', 'c:hmimic', 'c:mcore', 'c:mtooth', 'b:bite', 'b:mimic', 'b:hmimic', 'b:moonArm'].includes(src)) return 'surprise';
  if (src === 'c:boss' || src === 'b:boss') return 'boss';
  if (src.startsWith('c:')) return 'contact';
  if (src === 'b:lane') return 'lane';
  if (src === 'laser' || src === 'b:beacon') return 'laser';
  if (src === 'b:tick' || src === 'b:tickE') return 'ring';
  if (src === 'b:boat') return 'drop';
  if (['b:star', 'b:starE', 'b:armor', 'b:jelly', 'b:jellyE', 'b:cmdr', 'b:moth', 'b:mirror'].includes(src)) return 'aimed';
  return 'shot';
}

/* v0.8 目标链：每一段先让玩家看见障碍 → 给一个能理解的成长机会 → 用同样的敌人验证变强。
   前一个目标完成才推进（慢的玩家不会被新压力叠上来）；普通杂兵一直都在。
   kind：crowd 清普通怪群 / armor1 第一只厚甲怪 / pack 厚甲编队 / cmdr 带队精英 / chase 多方向来敌 / spawner 地形刷怪点 / surprise 场景惊喜 / boss
   from：主目标从哪里入场；map：目标期间出现的可选地图互动；reward：目标完成后出现的奖励装置（core = 精英掉落的核心）。 */
const STAGE_PLANS = {
  '1-1': [
    { id: 'crowd', goal: '清掉普通怪群', kind: 'crowd', n: 36, map: 'house', mapAt: 15 },
    { id: 'armor1', goal: '击破第一只厚甲怪', kind: 'armor1', from: 'shell', reward: 'wind' },
    { id: 'pack', goal: '快速处理厚甲编队', kind: 'pack', from: 'front', reward: 'mine' },
    { id: 'cmdr', goal: '击败带队精英', kind: 'cmdr', from: 'crack', reward: 'core' },
    { id: 'rear', goal: '挡住后方追兵', kind: 'chase', event: 'rear', waves: 4 },
    { id: 'moon', goal: '月亮不太对劲', kind: 'surprise', surprise: 'moon' },
    { id: 'boss', goal: '击败泡泡小队长', kind: 'boss' },
  ],
  '1-2': [
    { id: 'crowd', goal: '清掉普通怪群', kind: 'crowd', n: 38, map: 'house', mapAt: 15 },
    { id: 'armor1', goal: '击破从裂缝钻出的厚甲怪', kind: 'armor1', from: 'rift', reward: 'wind' },
    { id: 'pack', goal: '处理上下钻出的厚甲编队', kind: 'pack', from: 'drop', map: 'npc', mapAt: 3 },
    { id: 'spawner', goal: '摧毁残骸里的刷怪核心', kind: 'spawner', reward: 'mine' },
    { id: 'cmdr', goal: '击败带队精英', kind: 'cmdr', from: 'crack', reward: 'core' },
    { id: 'mimic', goal: '角落的贴纸在动？', kind: 'surprise', surprise: 'mimic' },
    { id: 'boss', goal: '击败裂纹闹钟队长', kind: 'boss' },
  ],
  '1-3': [
    { id: 'crowd', goal: '清掉普通怪群', kind: 'crowd', n: 40, map: 'house', mapAt: 15 },
    { id: 'armor1', goal: '击破后方绕来的厚甲怪', kind: 'armor1', from: 'rear', reward: 'wind' },
    { id: 'pack', goal: '处理从远处推近的厚甲编队', kind: 'pack', from: 'push', reward: 'mine' },
    { id: 'rift', goal: '清掉空间裂缝里的来敌', kind: 'chase', event: 'rift', waves: 4, map: 'npc', mapAt: 2 },
    { id: 'cmdr', goal: '击败带队精英', kind: 'cmdr', from: 'front', reward: 'core' },
    { id: 'hmimic', goal: '这间梦灯屋怪怪的', kind: 'surprise', surprise: 'houseMimic' },
    { id: 'boss', goal: '击败失控闹钟', kind: 'boss' },
  ],
};
/* 结算时留一个“还没见过”的场景线索，吸引下一局 */
const STAGE_CLUES = {
  '1-1': ['海面的倒影好像比你慢了半拍……', '远处那片像礁石的鲸鳍，一直没有浮上来。'],
  '1-2': ['纸船灯河的尽头，有一扇门只在起风时出现。', '有一间梦灯屋的烟囱，冒烟的节奏像在呼吸。'],
  '1-3': ['钟塔背后的天空，好像和海湾那道裂缝连在一起。', '救出的伙伴说，海面下还有一支跟着你的倒影小队。'],
};
const STAR_COST = [30, 60, 100, 150, 220, 300];
const STAR_UP = { 2: { cost: 10, gain: '大招视觉升级：更大、更亮' }, 3: { cost: 20, gain: '解锁第二段大招联动' }, 4: { cost: 30, gain: '星盘多一个随机节点' }, 5: { cost: 50, gain: '解锁终极爆炸演出' } };

const GACHA = { pityStart: 10, pityStep: 0.02, newbiePulls: 10 };

/* 活动任务：同时挂 3 个，领奖后从池里补新任务 */
const TASK_POOL = [
  { id: 'kills', name: '累计击败 400 只小怪', stat: 'kills', goal: 400, reward: 3 },
  { id: 'bursts', name: '释放大招 8 次', stat: 'bursts', goal: 8, reward: 2 },
  { id: 'runs', name: '完成 3 局航行', stat: 'runs', goal: 3, reward: 3 },
  { id: 'syns', name: '拿到 3 次联动', stat: 'syns', goal: 3, reward: 2 },
  { id: 'streak', name: '单局达成 100 连杀', stat: 'streak100', goal: 1, reward: 2 },
  { id: 'crystals', name: '完成 20 次升级二选一', stat: 'crystals', goal: 20, reward: 2 },
  { id: 'boss', name: '通关一次关卡', stat: 'bossKills', goal: 1, reward: 3 },
  { id: 'lv5', name: '把任意主炮改造升到 3 级', stat: 'lv5', goal: 1, reward: 2 },
  { id: 'stage', name: '通关任意关卡 2 次', stat: 'bossKills', goal: 2, reward: 3 },
  { id: 'chest', name: '打开 5 个宝箱', stat: 'chests', goal: 5, reward: 2 },
  { id: 'interact', name: '完成 10 次地图互动', stat: 'interacts', goal: 10, reward: 3 },
  { id: 'rescue', name: '救出 3 位伙伴', stat: 'rescues', goal: 3, reward: 2 },
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
  moth: { name: '梦尘蛾', desc: '成群乱飞，会掉很多星砂，是连杀的好材料。' },
  boat: { name: '纸船灯', desc: '横渡梦海，沿途往下投粉色圆弹。' },
  tick: { name: '小闹钟', desc: '跳到位置后摇铃，炸开一圈子弹，圈上留着缝。' },
  star: { name: '星星鱼', desc: '朝你所在的高度俯冲，射出一枚金色星弹。' },
  beacon: { name: '灯塔眼', desc: '先画出白色预警线，再沿线射出细弹。' },
  jellyE: { name: '守望水母', desc: '精英。吐出旋转的粉弹涡，击败后掉技能晶体和大量充能。' },
  tickE: { name: '裂纹闹钟', desc: '精英。双层弹环加十字弹列。' },
  starE: { name: '双瞳星鱼', desc: '精英。连续射出三枚金色星弹。' },
  armor: { name: '厚甲河豚', desc: '正面三块甲片，普通子弹只能慢慢敲裂；甲碎后露出软核心，一两发就倒。多重、爆破、穿透都会让它变快。' },
  cmdr: { name: '带队精英', desc: '上下各带一队护卫。平时有护盾，举旗时旗头水晶是弱点；它倒下护卫就散。' },
  wreck: { name: '残骸刷怪核心', desc: '沉船里的核心会一直放出梦尘蛾，打碎核心才会停。' },
  mcore: { name: '月亮怪', desc: '1-1 的惊喜：月亮从天上掉下来。先打碎嘴边四块碎片，再打核心。' },
  mimic: { name: '贴纸拟态', desc: '1-2 的惊喜：角落的装饰贴纸长出眼睛跳进战场。真正的血条和按钮不会被它影响。' },
  hmimic: { name: '拟态梦灯屋', desc: '1-3 的惊喜：窗户跟着心跳闪、烟囱像在呼吸的梦灯屋。打倒它奖励照样拿。' },
  mirror: { name: '镜像闹钟', desc: '失控闹钟面对分身流时召唤的镜像，分身会自动锁定它们。' },
  clock: { name: '失控闹钟', desc: '第一章 Boss（1-3）。会看见你的 Build：雷球让它导电，爆破打开它的护甲，冰晶冻住它的指针。' },
};

/* 数据验收标准（文档 §16） */
const METRIC_TARGETS = [
  { id: 'firstKill', name: '首次击杀时间', target: 5, cmp: 'le', unit: '秒' },
  { id: 'firstSkill', name: '首次升级二选一', target: 30, cmp: 'le', unit: '秒' },
  { id: 'choiceTime', name: '技能选择平均耗时', target: 4, cmp: 'le', unit: '秒' },
  { id: 'firstBurst', name: '首次大招', target: 90, cmp: 'le', unit: '秒' },
  { id: 'changes', name: '单局升级选择', target: 5, cmp: 'ge', unit: '次' },
  { id: 'highlights', name: '单局明显爽点', target: 8, cmp: 'ge', unit: '次' },
  { id: 'avgKill', name: '普通小怪平均击杀时间', target: 0.5, cmp: 'le', unit: '秒' },
  { id: 'gap', name: '战斗段之间的空档', target: 1.2, cmp: 'le', unit: '秒' },
  { id: 'noGoal', name: '最长无主目标时段', target: 10, cmp: 'le', unit: '秒' },
  { id: 'armorFirst', name: '第一只厚甲怪敲碎用时', target: 5, cmp: 'le', unit: '秒' },
  { id: 'armorAfter', name: '升级后同型厚甲敲碎用时', target: 3, cmp: 'le', unit: '秒' },
  { id: 'restart', name: '失败后重开时间', target: 3, cmp: 'le', unit: '秒' },
  { id: 'second', name: '第二局点击率', target: 55, cmp: 'ge', unit: '%' },
  { id: 'interacts', name: '单局主动触发互动', target: 3, cmp: 'ge', unit: '次' },
  { id: 'interactTime', name: '单次互动最长用时（护送吊舱是一段路）', target: 8, cmp: 'le', unit: '秒' },
  { id: 'stockIdle', name: '大招满库存不用的时长', target: 20, cmp: 'le', unit: '秒' },
];

/* ================================================== v0.6 飞机—地图交互 ================================================== */
/* 地图物件：飞近会回应；停留 / 穿环 / 绕行 / 看眼睛，全部只靠移动完成 */
const MAP_OBJECTS = {
  house: { id: 'house', name: '梦灯屋', verb: '点亮', how: 'touch', tag: '主炮', color: '#ffd76a', icon: 'star',
    hint: ['碰一下梦灯屋门前的铃铛', '屋顶折起、烟囱变成摇柄，整间屋子变成转盘，转出两个主炮改造。'], desc: '碰一下门前的铃铛：屋子变成转盘，转出两个主炮改造二选一；之后它会变成亮着的补给点，敌人经过时帮你打一发。' },
  wind: { id: 'wind', name: '风车塔', verb: '吹开', how: 'ring', tag: '推一排', color: '#9fe3f0', icon: 'wing',
    hint: ['从风车前面的宽风环穿过去', '风会吹散云层、露出藏着的入口，还把一排敌人推到你的炮口前。'], desc: '穿过宽风环：云层被吹开、露出隐藏入口，一排敌人被推到炮口前，然后给一次二选一。' },
  mine: { id: 'mine', name: '星砂矿', verb: '炸开', how: 'tow', tag: '强化', color: '#c9a8ff', icon: 'charge',
    hint: ['碰一下发光的矿核，把它拖到标记的岩壁', '矿核会自己跟着你飞；碰到岩壁就炸开，露出新航道和动力装置。'], desc: '碰一下矿核，它会跟着你飞；拖到标记的岩壁上炸开：出现新航道、一台动力装置（兼容强化二选一），之后敌人会从裂口钻出。' },
  npc: { id: 'npc', name: '救援吊舱', verb: '救出', how: 'escort', tag: '支援', color: '#ff9fcf', icon: 'heart',
    hint: ['碰一下伙伴的吊舱，沿光带护送到修理点', '吊舱挨一发不会坏（有三格耐久）；送到后伙伴加入，还会搬出两个支援技能。'], desc: '碰一下吊舱挂上拖绳，沿安全光带护送到修理点：伙伴加入并修好炮台，给一次支援二选一。' },
  bridge: { id: 'bridge', name: '断桥', verb: '修复', how: 'path', tag: '捷径', color: '#9fe3f0', icon: 'wing',
    hint: ['穿过三个灯环，把断桥接起来', '尾流会把灯环连成桥。'], desc: '（旧版装置，当前航线不再出现）' },
  giant: { id: 'giant', name: '巨型梦境生物', verb: '唤醒', how: 'eye', tag: '清场', color: '#6ff0ff', icon: 'crown',
    hint: ['飞到它的眼睛旁边', '它不会攻击你。'], desc: '（旧版装置，当前航线不再出现）' },
};
const MAP_ORDER = ['house', 'wind', 'mine', 'npc'];
/* 伙伴：救出后跟着飞机，自动射击，并各有一个效果；Boss 出现前各帮一次忙 */
const NPCS = {
  bunny: { id: 'bunny', name: '小梦兔', trap: 'bubble', color: '#e7d8ff', effect: '自动把附近的奖励叼回来（二选一的技能晶体除外）' },
  grandpa: { id: 'grandpa', name: '云朵爷爷', trap: 'vine', color: '#dff2ff', effect: '每 15 秒给飞机铺一层缓冲云，挡下一次伤害' },
  miner: { id: 'miner', name: '星星矿工', trap: 'vine', color: '#ffe38a', effect: '每击败一行敌人（8 只）挖出一把星砂，顺便充一点大招' },
  merchant: { id: 'merchant', name: '糖果商人', trap: 'bubble', color: '#ff9fcf', effect: '技能每次升级，额外放一次糖果爆炸' },
  clockling: { id: 'clockling', name: '小闹钟', trap: 'gear', color: '#ffd76a', effect: 'Boss 每个阶段开始时，补满一次大招' },
};
const NPC_ORDER = ['bunny', 'grandpa', 'miner', 'merchant', 'clockling'];
/* 巨型梦境生物：可以互动的活景观 */
const GIANTS = {
  whale: { id: 'whale', name: '睡鲸', effect: '张嘴吸走前方的敌人和弹幕' },
  turtle: { id: 'turtle', name: '云龟', effect: '展开背甲，7 秒安全航道：靠近飞机的敌弹全部化成星砂' },
  deer: { id: 'deer', name: '花海鹿', effect: '撒下彩色强化花瓣：最低级技能 +1 级，射速提高 8 秒' },
  moonbunny: { id: 'moonbunny', name: '月亮兔', effect: '让下一颗技能晶体变成稀有，下一次洞口必有稀有洞' },
};
const GIANT_ORDER = ['whale', 'turtle', 'deer', 'moonbunny'];
/* P2：每架飞机对地图的专属反应（云朵号文档没写，按它的缓冲云被动补了一条） */
const PLANE_MAP_REACT = {
  moon: '月光物件提前亮起：感应范围更大，停留充能快 30%',
  cloud: '在地图物件旁停留时铺开云垫，靠近的敌弹直接散掉',
  candy: '互动完成时，奖励变成一场糖果爆炸',
  paper: '尾流留下充能点：离开物件时充能不会消退，穿环、救援光环判定更宽',
  whale: '靠近星砂矿就能把周围的星砂吸过来，挖开后星砂翻倍',
  clock: '互动完成后，时间短暂停止 1.2 秒',
};
