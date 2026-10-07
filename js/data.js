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
    burst: { name: '月轮清屏', desc: '巨型月轮穿过敌人，再分裂成小月轮四处弹' },
    passive: { name: '月光回收', desc: '月轮打中敌人会带回星砂' },
    star3: '月轮分裂更多',
    colors: { body: '#fff6ee', accent: '#ffd76a', exp: ['#fff3c8', '#c9a8ff', '#ffffff'] },
  },
  cloud: {
    id: 'cloud', name: '云朵号', rarity: 'N', look: '白云和小翅膀', hearts: 6, speed: 0.95, rate: 8, dmg: 10, shot: '软云团（轻微击退）',
    burst: { name: '云海冲撞', desc: '裹着云海横冲屏幕，碾碎沿途敌人和子弹' },
    passive: { name: '缓冲云层', desc: '挨打后长出一层云，挡下下一下' },
    star3: '冲撞结束后留下一面云墙挡子弹',
    colors: { body: '#ffffff', accent: '#aee9ff', exp: ['#ffffff', '#aee9ff', '#dcd0ff'] },
  },
  candy: {
    id: 'candy', name: '糖果号', rarity: 'R', look: '粉蓝糖果飞机', hearts: 5, speed: 1, rate: 8, dmg: 10, shot: '糖果弹',
    burst: { name: '彩虹糖雨', desc: '糖雨落满屏幕，砸中的小怪变成糖果' },
    passive: { name: '糖果掉落', desc: '击杀有机会掉糖果，吃到射速变快' },
    star3: '糖雨下得更久',
    colors: { body: '#ff9fcf', accent: '#9fe3f0', exp: ['#ff9fcf', '#9fe3f0', '#fff3c8'] },
  },
  paper: {
    id: 'paper', name: '纸飞机号', rarity: 'R', look: '奶油纸张质感', hearts: 4, speed: 1.1, rate: 8, dmg: 10, shot: '纸镖',
    burst: { name: '五重分身', desc: '变出一队纸飞机分身，自动锁敌齐射' },
    passive: { name: '折纸编队', desc: '每次升级多一架临时分身' },
    star3: '分身更多',
    colors: { body: '#fff4dc', accent: '#ffcf8a', exp: ['#fff4dc', '#ffcf8a', '#c9a8ff'] },
  },
  whale: {
    id: 'whale', name: '星鲸号', rarity: 'SR', look: '深蓝小鲸鱼', hearts: 6, speed: 0.95, rate: 8, dmg: 10, shot: '泡泡弹',
    burst: { name: '星砂海啸', desc: '先吸进敌人和子弹，再吐出星砂海啸' },
    passive: { name: '越多越大', desc: '敌人越多，海啸越大' },
    star3: '海啸之后再追加一道小浪',
    colors: { body: '#4f63d6', accent: '#ffe38a', exp: ['#6ff0ff', '#ffe38a', '#8f9dff'] },
  },
  clock: {
    id: 'clock', name: '闹钟号', rarity: 'SSR', look: '金色圆闹钟', hearts: 5, speed: 1, rate: 8, dmg: 10, shot: '指针弹',
    burst: { name: '时间暂停', desc: '时间暂停，恢复时被标记的敌人一起爆开' },
    passive: { name: '准点充能', desc: 'Boss 换阶段时大招自动充一截' },
    star3: '暂停更久',
    special: '暂停时失控闹钟的指针也会停下',
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
    lv: ['子弹穿过敌人继续飞', '穿得更多', '一颗子弹扫一整排'], fx: [[['穿透', 1]], [['穿透', 2]], [['穿透', 3]]], look: '弹头拉长，贯穿后留下短光轨' },
  homing: { id: 'homing', slot: 'gun', name: '追踪', stream: '追踪', icon: 's-homing', canvas: 'homing', color: '#6ff0ff', glow: 'rgba(111,240,255,0.9)', max: 3,
    lv: ['子弹自己拐弯找敌人', '拐得更快、找得更远', '目标没了自动换下一个'], fx: [[['追踪', 1]], [['追踪', 2]], [['追踪', 3]]], look: '子弹尾迹弯曲，转向清楚可见' },
  multi: { id: 'multi', slot: 'gun', name: '多重', stream: '散射', icon: 's-multi', canvas: 'multi', color: '#ffb347', glow: 'rgba(255,179,71,0.9)', max: 3,
    lv: ['主炮一次打出好几路', '路数更多', '火力铺满前方'], fx: [[['弹道', 1]], [['弹道', 2]], [['弹道', 3]]], look: '炮口分出几道并排弹' },
  bomb: { id: 'bomb', slot: 'gun', name: '爆破', stream: '爆破', icon: 's-bomb', canvas: 'bomb', color: '#ff9a6b', glow: 'rgba(255,154,107,0.9)', max: 3,
    lv: ['打过的敌人死时会爆炸', '炸得更大，还会连着标记', '每颗子弹最后都会炸开'], fx: [[['爆炸', 1]], [['爆炸', 2], ['范围', 1]], [['爆炸', 3], ['范围', 1]]], look: '命中处留下橙色准星' },
  thunder: { id: 'thunder', slot: 'support', name: '雷球', stream: '雷暴', icon: 's-thunder', canvas: 'bolt', color: '#8fd3ff', glow: 'rgba(143,211,255,0.9)', max: 3,
    lv: ['雷球追着敌人放电', '雷球更多，电到的会麻痹', '巨型雷球绕着你放电'], fx: [[['雷电', 1]], [['雷电', 2], ['控制', 1]], [['雷电', 3], ['控制', 1]]] },
  wing: { id: 'wing', slot: 'support', name: '分身', stream: '蜂群', icon: 's-wing', canvas: 'wing', color: '#fff3c8', glow: 'rgba(255,243,200,0.9)', max: 3,
    lv: ['纸飞机分身陪你一起打', '分身更多', '金色分身，打得更快'], fx: [[['分身', 1]], [['分身', 2]], [['分身', 3], ['射速', 1]]] },
  rainbow: { id: 'rainbow', slot: 'support', name: '彩虹光束', stream: '彩虹', icon: 's-rainbow', canvas: 'rainbow', color: '#ff9fcf', glow: 'rgba(255,159,207,0.9)', max: 3,
    lv: ['彩虹光束定时扫过前方', '光束更宽，打倒的会掉糖果', '两道彩虹交叉扫'], fx: [[['光束', 1]], [['光束', 2], ['范围', 1]], [['光束', 3], ['范围', 2]]] },
  ice: { id: 'ice', slot: 'support', name: '冰晶', stream: '冰晶', icon: 's-ice', canvas: 'snow', color: '#bff4ff', glow: 'rgba(191,244,255,0.9)', max: 3,
    lv: ['冰晶有机会冻住敌人', '一定冻住，碎冰伤到旁边', '暴风雪冻住身边所有敌人'], fx: [[['冻结', 1]], [['冻结', 2], ['伤害', 1]], [['冻结', 3], ['范围', 2]]] },
  magnet: { id: 'magnet', slot: 'support', name: '磁吸星砂', stream: '吸星', icon: 's-magnet', canvas: 'magnet', color: '#c9a8ff', glow: 'rgba(201,168,255,0.9)', max: 3,
    lv: ['吸得更远，吸到星砂就射出星弹', '定时磁暴，吸来全屏掉落', '定时掀起星砂浪'], fx: [[['吸附', 1], ['星弹', 1]], [['吸附', 2], ['星弹', 1]], [['吸附', 2], ['星弹', 2]]] },
};
/* 升级卡上的“这一级多了什么”：和上一级比，用看得见的数量 / 场景说（不写伤害、冷却秒数）；数量和 world.js 里的真实效果一致 */
const SKILL_STEP = {
  pierce: ['能穿过 1 个敌人', '穿透 1 → 2 个敌人', '穿透 2 → 3 个敌人：一整排'],
  homing: ['子弹会拐弯找前方的敌人', '拐弯更急，前方更宽的范围都能锁定', '目标被打掉后，子弹会重新找下一个'],
  multi: ['弹道 1 → 2 路', '弹道 2 → 3 路', '弹道 3 → 4 路'],
  bomb: ['命中会标记，被标记的敌人死时爆炸', '标记更常出现，爆炸更大，还会连着标记', '每颗子弹最后都会炸开'],
  thunder: ['放雷球，每个电 2 个敌人', '雷球 1 → 2 个，每个电 3 个，被电到会麻痹', '每个电 3 → 5 个，身边多一个绕圈放电的大雷球'],
  wing: ['1 架纸飞机分身', '分身 1 → 2 架', '分身 2 → 3 架，变成金色、射得更快'],
  rainbow: ['光束定时扫过前方', '扫得更勤、更宽，打倒的掉糖果', '两道光束交叉扫，扫得最勤'],
  ice: ['一次射 3 片冰，有机会冻住', '冰片 3 → 5 片，碰到一定冻住，碎冰伤到旁边', '冰片 5 → 7 片，还会定时冻住身边一圈'],
  magnet: ['吸星砂的范围变大，吸到就射出星弹', '多了定时磁暴：全屏掉落一起吸过来', '多了定时星砂浪'],
};
const GUN_ORDER = ['pierce', 'homing', 'multi', 'bomb'];
const SUPPORT_ORDER = ['thunder', 'wing', 'rainbow', 'ice', 'magnet'];
const SKILL_ORDER = [...GUN_ORDER, ...SUPPORT_ORDER];
const UPG_LEGACY = [0, 1, 3, 5]; // 支援 / 爆破的 1~3 级对应旧效果档位
const synKey = (a, b) => [a, b].sort((x, y) => SKILL_ORDER.indexOf(x) - SKILL_ORDER.indexOf(y)).join('+');
/* 追踪参数（原型值）：转向速度 度/秒，搜索半角 度 */
const HOMING = { turn: [0, 90, 150, 210], cone: [0, 35, 50, 65] };

const BURST_MODS = {
  thunderB: { id: 'thunderB', name: '雷霆大招', icon: 's-thunder', color: '#8fd3ff', lv: ['大招时降下落雷', '落雷更多'], fx: [[['落雷', 1]], [['落雷', 2]]] },
  iceB: { id: 'iceB', name: '冰封大招', icon: 's-ice', color: '#bff4ff', lv: ['大招冻住全场敌人', '冻得更久，冻住的会碎'], fx: [[['冻结', 1]], [['冻结', 2], ['伤害', 1]]] },
  bombB: { id: 'bombB', name: '连爆大招', icon: 's-bomb', color: '#ff9a6b', lv: ['大招让全场敌人死时爆炸', '炸得更大'], fx: [[['爆炸', 1]], [['爆炸', 1], ['范围', 2]]] },
  dustB: { id: 'dustB', name: '星砂回收', icon: 's-magnet', color: '#c9a8ff', lv: ['大招吸回星砂，返还充能', '返还更多充能'], fx: [[['充能', 1]], [['充能', 2]]] },
};
const BURST_MOD_ORDER = ['thunderB', 'iceB', 'bombB', 'dustB'];

/* 联动：两个前置都拿到后才会出现在候选里（第三次选择保证至少一个能联动） */
const SYNERGIES = {
  'pierce+bomb': { name: '贯穿终点爆炸', desc: '穿透子弹最后一下炸开一大团', fx: [['爆炸', 2]], need: ['pierce', 'bomb'], stream: '贯穿爆破流' },
  'homing+wing': { name: '蜂群同步开火', desc: '分身跟着主炮开火，子弹也会追踪', fx: [['分身', 1], ['追踪', 1]], need: ['homing', 'wing'], stream: '追踪蜂群流' },
  'homing+thunder': { name: '追踪雷链', desc: '追踪弹打中时顺带放电', fx: [['雷电', 1], ['追踪', 1]], need: ['homing', 'thunder'], stream: '追踪雷暴流' },
  'multi+ice': { name: '散射冰晶', desc: '侧翼子弹打中就冻住', fx: [['冻结', 2]], need: ['multi', 'ice'], stream: '散射冰晶流' },
  'bomb+thunder': { name: '雷爆连锁', desc: '雷击会标记，爆炸再放电', fx: [['爆炸', 1], ['雷电', 1]], need: ['bomb', 'thunder'], stream: '雷爆流' },
  'bomb+rainbow': { name: '彩虹烟火', desc: '爆炸变成彩色烟火', fx: [['范围', 2]], need: ['bomb', 'rainbow'], stream: '烟火流' },
  'multi+magnet': { name: '星砂散射', desc: '吸到星砂时射出一把星弹', fx: [['星弹', 2]], need: ['multi', 'magnet'], stream: '星砂散射流' },
};

/* ================================================== 文字规范 ==================================================
   机制 / 技能一律写成：图标 + 名字，换行一句话（不写数值），再配一排方向箭头。
   箭头：[词, n]——n > 0 绿色 ▲×n（更强 / 更多 / 更快），n < 0 红色 ▼×|n|（变弱 / 变少 / 变慢）；1~3 个，越多变化越大。 */
const FX_UP = '#6fe39a', FX_DOWN = '#ff7a6b';
function fxArrows(n) { return (n > 0 ? '▲' : '▼').repeat(clamp(Math.abs(Math.round(n)), 1, 3)); }
function fxHtml(fx) { return fx && fx.length ? `<span class="fxs">${fx.map(([w, n]) => `<span class="fx ${n > 0 ? 'up' : 'down'}">${esc(w)}<i>${fxArrows(n)}</i></span>`).join('')}</span>` : ''; }
function fxOf(kind, id, lv) { // 某个能力在某一级的箭头
  if (kind === 'gun' || kind === 'support') return (SKILLS[id].fx || [])[Math.max(0, (lv || 1) - 1)] || [];
  if (kind === 'bmod') return (BURST_MODS[id].fx || [])[Math.max(0, (lv || 1) - 1)] || [];
  if (kind === 'link') return [...(SYNERGIES[id].fx || []), ['火力', 2]]; // 联动是倍增件：成型后所有攻击大涨
  return [];
}
/* 飞机之间的差别：和标准机（5 颗心、标准速度）比 */
function planeFx(P) { const o = []; if (P.hearts !== 5) o.push(['生命', P.hearts - 5]); if (P.speed !== 1) o.push(['速度', P.speed > 1 ? 1 : -1]); return o; }
/* 共享等级：攻击随等级一档档变强，满 3 / 6 / 9 级各多一颗心 */
function sharedFx(lv) { const o = []; if (lv > 1) o.push(['攻击', lv >= 15 ? 3 : lv >= 8 ? 2 : 1]); const h = sharedHearts(lv); if (h) o.push(['生命', h]); return o; }

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
/* 推荐点亮的天赋节点（界面和连续玩的模拟共用） */
function recommendNode(rec) {
  let best = null, bs = -1;
  for (const r of ROUTE_ORDER) { const i = rec.lit[r]; if (i >= rec.map[r].length) continue; const n = rec.map[r][i], T = NODE_TYPES[n.type], sc = T.score - i * 0.2 + (T.needs ? -0.5 : 0); if (sc > bs) { bs = sc; best = r; } }
  return best;
}
const NODE_TYPES = {
  dmg: { name: '火力', icon: 'n-fire', min: 5, max: 8, fmt: () => '主炮伤害更高', word: '伤害', score: 3, why: '主炮清怪更快' },
  blast: { name: '爆炸', icon: 'n-blast', min: 12, max: 20, fmt: () => '爆炸范围更大', word: '爆炸', score: 2, why: '爆破类改造更好用' },
  charge: { name: '大招充能', icon: 'n-charge', min: 10, max: 16, fmt: () => '大招充得更快', word: '充能', score: 3, why: '更常放专属大招' },
  magnet: { name: '吸附', icon: 's-magnet', min: 25, max: 40, fmt: () => '掉落吸得更远', word: '吸附', score: 1, why: '捡星砂更轻松' },
  repeat: { name: '重复', icon: 'n-repeat', min: 6, max: 10, fmt: () => '支援技能有机会多放一次', word: '支援', score: 2, why: '支援打得更勤' },
  heart: { name: '生命', icon: 'i-heart', min: 1, max: 1, fmt: () => '多一颗心', word: '生命', score: 3, why: '多一次失误的余地' },
  boss: { name: 'Boss 伤害', icon: 'n-crown', min: 12, max: 20, fmt: () => '打 Boss 更疼', word: 'Boss 伤害', score: 2, why: '打 Boss 更快' },
  pierceX: { name: '穿透强化', icon: 's-pierce', min: 1, max: 1, fmt: () => '拿到穿透后穿得更多', word: '穿透', score: 2, why: '拿到穿透后才生效', needs: 'pierce' },
  homingX: { name: '追踪强化', icon: 's-homing', min: 15, max: 15, fmt: () => '拿到追踪后拐得更快', word: '追踪', score: 2, why: '拿到追踪后才生效', needs: 'homing' },
  houseFast: { name: '地图充能', icon: 'i-hangar', min: 15, max: 20, fmt: () => '梦灯屋和星砂矿更快出奖励', word: '地图', score: 2, why: '地图奖励来得更快' },
  npcBoost: { name: '伙伴辅助', icon: 'i-heart', min: 25, max: 35, fmt: () => '救出的伙伴更能打', word: '伙伴', score: 1, why: '伙伴更能打' },
};
/* 大招容量：账号共享的固定里程碑 */
const ULT_CAP = [{ cap: 1, need: null, text: '初始' }, { cap: 2, need: '1-1', text: '1-1 首次通关' }, { cap: 3, need: '1-3', text: '1-3 首次通关' }];
/* 共享等级：星尘升级，所有飞机一起变强（原型值） */
/* 共享等级（§7）：前期一两局升一级，后期越来越慢（满级十个多小时），下一局开局就看得见变强；每级攻击 × atk，每 4 级多一颗心；
   费用 150 起，10 级前每级 +60，之后每级 +180（三关连成一局后一局带回的星尘约翻倍，费用跟着乘了 1.5） */
const SHARED = { max: 20, cost: Array.from({ length: 21 }, (_, lv) => (lv < 2 ? 0 : lv <= 10 ? 150 + 60 * (lv - 2) : 630 + 180 * (lv - 10))), atk: 1.035, heartAt: [4, 8, 12, 16, 20] };
const sharedAtk = (lv) => Math.pow(SHARED.atk, lv - 1);
const sharedHearts = (lv) => SHARED.heartAt.filter((x) => lv >= x).length;

/* 章节 / 关卡：一关 = 一次完整出击（约 6~8 分钟），只在出击结束时结算。难度固定，不跟随玩家成长抬高。
   v0.8 起关卡按目标链推进（STAGE_PLANS），fill = 背景杂兵的出兵速度（只/秒）。 */
const STAGES = {
  '1-1': { id: '1-1', ch: 1, name: '梦灯海湾', theme: 'bay', segs: 6, segDur: 54, hpK: 1, avg: 5, peak: 9, fill: 2.3, elites: ['jellyE'], boss: 'captain', bossName: '泡泡小队长', bossHp: 6000, rec: 1, reward: 120, fail: [30, 90], ult: 1,
    map: ['house', 'mine', 'npc', 'house', 'mine', 'npc'], intro: '第一次出击：开局只会直射；先清普通怪群，再对付越来越硬的厚甲怪。' },
  '1-2': { id: '1-2', ch: 1, name: '纸船灯河', theme: 'river', segs: 7, segDur: 50, hpK: 9 / 8, avg: 6, peak: 11, fill: 2.7, elites: ['tickE', 'jellyE'], boss: 'captain2', bossName: '裂纹闹钟队长', bossHp: 9000, rec: 3, reward: 150, fail: [40, 100], ult: 2,
    map: ['house', 'bridge', 'mine', 'npc', 'house', 'mine', 'npc'], intro: '敌人会从裂缝、上下方钻出来；途中要护送一位伙伴。' },
  '1-3': { id: '1-3', ch: 1, name: '失眠钟塔', theme: 'tower', segs: 8, segDur: 42, hpK: 10 / 8, avg: 7, peak: 13, fill: 3.1, elites: ['starE', 'tickE', 'jellyE'], boss: 'clock', bossName: '失控闹钟', bossHp: 1000, rec: 7, reward: 190, fail: [50, 120], ult: 2,
    map: ['house', 'mine', 'bridge', 'npc', 'giant', 'house', 'mine', 'npc'], intro: '后方追兵和空间裂缝一起出现，最后是第一章 Boss：失控闹钟。' },
};
const STAGE_ORDER = ['1-1', '1-2', '1-3'];

/* ================================================== 家园（v0.10 第一阶段：救援 → 建设 → 改变下一局）==================================================
   资源三种：星尘（策划里叫“星砂”的账户货币；局内拾取的星砂按 50:1 折成星尘）、梦木（地图装置掉落）、货物（工坊用梦木加工）。
   工作周期按“有效战斗时间”推进（4 分钟一轮），不按现实时间；离线、暂停、升级仪式都不算。 */
const HOME = { cycle: 240, recipe: 8, sell: 20, startStardust: 120, plots: 8, cols: 4 };
/* 每个目标完成时当场入账的星尘（失败也保留）；通关另给终点奖励 */
const beatPay = (S) => Math.round(S.reward / 12);
const endPay = (S, first) => Math.round(S.reward * (first ? 0.5 : 0.3));
/* 地图装置给的梦木（每次出击 18~26 左右） */
const WOOD_DROP = { house: 4, wind: 4, mine: 8, npc: 4, cmdr: 3, bridge: 5, giant: 7 };
/* 常驻 NPC：一个主职 + 一个副职（成为“伙伴”后开放），职责免费改，每次回家最多改一项 */
const HOME_NPCS = {
  bunny: { bld: 'rescue', main: { id: 'clue', name: '整理救援线索', line: '下一局要救的伙伴更早出现，一路有箭头' }, side: { id: 'beacon', name: '准备救援信标', line: '修理点更大，吊舱更耐打' }, bond: '救回云朵爷爷' },
  grandpa: { bld: 'workshop', main: { id: 'craft', name: '看着工坊', line: '工坊每个工作周期把梦木加工成货物' }, side: { id: 'scout', name: '风向观察', line: '风车塔的上下两个风圈会写明各通向哪里' }, bond: '修好风道' },
  merchant: { bld: 'shop', main: { id: 'sell', name: '看店卖货', line: '每个工作周期卖出货架上的货物换星尘' }, side: { id: 'keep', name: '守着库存', line: '货物先留着不卖，攒给项目和委托' }, bond: '完成第一份委托' },
};
const NPC_STAGES = ['初见', '伙伴', '知己'];
/* 功能建筑：机库一开始就有；其他由救回的 NPC 开放（第一座免费摆放） */
const HOME_BUILDINGS = {
  hangar: { name: '机库', icon: 'i-hangar', color: '#ffd76a', line: '换飞机、点天赋、共享升级', fixed: true },
  rescue: { name: '救援台', icon: 'i-heart', color: '#ff9fcf', line: '追踪下一位要救的伙伴', npc: 'bunny', plot: 0 },
  workshop: { name: '工坊', icon: 'n-repeat', color: '#9fe3f0', line: '修风道；把梦木加工成货物', npc: 'grandpa', plot: 2, lock: '救回云朵爷爷后开放' },
  shop: { name: '巡游店', icon: 'i-gacha', color: '#ff9fcf', line: '卖货物换星尘；商人的委托', npc: 'merchant', plot: 5, lock: '修好风道、救回糖果商人后开放' },
};
/* 世界项目：交付就完成，下一局地图真的变了 */
const HOME_PROJECTS = {
  windRoad: { name: '修风道 · 上层云桥', bld: 'workshop', cost: { wood: 12 }, line: '风车塔多出一个上层风圈：飞进去走高空航路', done: '上层风圈亮了：下一局在风车塔上方' },
};
/* 商人的第一份委托：交货物 → 糖果号 */
const COMMISSIONS = {
  candy: { name: '糖果商人的第一份委托', need: { goods: 1 }, reward: 'candy', line: '交 1 件货物，商人把糖果号送给你' },
};

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
/* 难度和构筑挂钩（docs/design.md §3.5）：
   成型 = 一个流派的启动件和回报件都升到 needLv 级，再接上它们的联动（倍增件）；成型后所有攻击 × formK（各联动的倍率见 formKOf：爆炸类对单个 Boss 吃亏，倍率高一点，让每条流派成型后都打得过）。
   Boss / 队长打了 rage.at 秒还没倒就失控：攻击一路加快（rage.ramp 秒加满 rage.max），提前 rage.warn 秒预告。
   失控 wipe 秒后超载（先在血条上倒数，提前 5 秒喊）：全屏冲击、全队倒下——首领战有确定的期限，构筑强度按它算。
   只有成型的火力能在失控前打完；没成型的局要靠操作硬扛失控段 */
const BUILD_CHECK = { needLv: 2, steer: 0.6, formK: 2, maxK: 1.5, formKOf: { 'pierce+bomb': 1.45, 'bomb+rainbow': 3.33, 'homing+thunder': 3.95, 'bomb+thunder': 3.9, 'homing+wing': 2.9, 'multi+ice': 2.8, 'multi+magnet': 3.0 }, free: { '1-1': true }, bossK: { '1-1': 1.3, '1-2': 8, '1-3': 15 }, regen: 0.003, multiK: [1, 1.45, 1.8, 2.1], rage: { at: { '1-1': 40, '1-2': 70, '1-3': 55 }, warn: 5, ramp: 15, max: 4, wipe: 35 } };
/* 第一局（§3.6，上手 = 上钩）：第一个完整仪式保底史诗，第一个联动只要两件 1 级（头几分钟一次构筑小爆发），鱼群潮更勤；
   第一个首领（free 里的关）在基础难度下不自愈、不失控：几乎人人打得过 */
const FIRST_RUN = { rareTier: 1, needLv: 1, swellK: 0.75, hearts: 2 }; // rareTier：第一局第一个完整仪式保底史诗（一档一档认识品质）；hearts：多两颗心
/* 品质（§3.4）：完整仪式掷一档。玩家一档一档认识：史诗从第一局就常见，传说从 luck ≥ legendAt 起出现，神话从 luck ≥ mythAt 起少量出现；
   之后都随共享等级涨（luck = 等级 - 1）。
   品质不加等级：只有对路（属于已成型的流派：两件 + 联动）的件，每件按 tierK 乘到全部火力上——给了不等于强，打穿要靠对路、凑齐、选对 */
const QUALITY_ROLL = { myth: [0.02, 0.006], legend: [0.08, 0.02], epic: [0.5, 0.015], legendAt: 1, mythAt: 7, floorLuck: 6 }; // [出现时的概率, 之后每点 luck 加多少]（累计）。装置保底的高档要 luck ≥ floorLuck 才生效
const QUALITY_K = [0, 0.3, 0.7, 1.5];
/* 难度阶梯“梦魇”（§3.7）：1-3 首通后解锁 1 级，在 N 级打通 1-3 解锁 N+1 级。每级多一条改变“哪些构筑能活”的规则（逐级叠加），
   再把首领加厚 hpK（逐级相乘：深度期玩家带着局外成长，前沿上仍要构筑决定胜负）；星尘奖励 × (1 + pay × 级数) */
const LADDER = [
  { name: '基础', line: '' },
  { name: '厚甲', line: '精英和厚甲怪更结实：爆破、多重更值钱', fx: [['敌甲', 1]], eliteK: 1.4, hpK: 1.36 },
  { name: '护驾', line: '首领的散兵更多更结实，护盾回来更快：清群的流派更值钱', fx: [['散兵', 1]], addsK: 1.5, addHpK: 3, shieldT: 14, hpK: 1.05 },
  { name: '疾弹', line: '敌弹快两成：冰冻、追踪更值钱', fx: [['敌弹', 1]], bulletK: 1.2, hpK: 1.25 },
  { name: '自愈', line: '首领自愈更快：单体爆发更值钱', fx: [['自愈', 1]], regenK: 1.3 },
  { name: '失控', line: '首领更早失控、超载：只有最强的构筑打得过', fx: [['失控', 1]], rageK: 0.88 },
];
const LADDER_MAX = LADDER.length - 1, LADDER_PAY = 0.15;
function ladderRules(n) { const L = LADDER.slice(1, Math.max(0, Math.min(LADDER_MAX, n | 0)) + 1); return Object.assign({}, ...L, { hpK: L.reduce((k, x) => k * (x.hpK || 1), 1) }); } // hpK 逐级相乘，其余规则叠加
function buildLv(b, id) { if (!b) return 0; return (b.gun && b.gun[id]) || (b.support && b.support.id === id ? b.support.lv : 0); }
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
  const need = (b && b.need) || BUILD_CHECK.needLv, ready = (id) => buildLv(b, id) >= need; // 联动要两件都到 need 级（到了自动接上）
  const core = link ? SYNERGIES[link].need : comps, order = [...core, ...comps.filter((id) => !core.includes(id))]; // 先凑联动的两件，再凑流派的其他件
  const have = comps.filter(ready), miss = order.filter((id) => !ready(id)), linkOwned = !!(link && buildOwned(b, link));
  const next = (linkOwned ? core.find((id) => buildLv(b, id) < 3) : core.find((id) => !buildLv(b, id)) || core.find((id) => !ready(id))) || miss[0] || null; // 两件先各拿到，再各升到级；接上联动以后把两件升满（联动满级再乘 maxK）
  const swap = next && SKILLS[next] && SKILLS[next].slot === 'support' && b.support && b.support.id !== next ? b.support.id : null;
  let alt = null;
  for (const [k, L] of Object.entries(SYNERGIES)) {
    if (k === link || buildOwned(b, k)) continue;
    const [x, y] = L.need; if (buildOwned(b, x) === buildOwned(b, y)) continue;
    alt = { key: k, have: buildOwned(b, x) ? x : y, miss: buildOwned(b, x) ? y : x }; break;
  }
  const lv = {}; for (const id of comps) lv[id] = buildLv(b, id);
  return { name: P.name, hint: P.hint, path: P.path, comps, link, linkOwned, have, miss, next, swap, done: !next, alt, lv, need };
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
  rage: { label: 'Boss 超载', tip: '首领打太久会失控，再拖就超载（全屏冲击）：先凑齐流派、接上联动（成型后火力翻倍），在超载前打完' },
  lurk: { label: '地图伸出来的手 / 醒来的装饰', tip: '先看先兆：冒泡、抽动、睁眼、折痕出现时，离开那一列 / 那条白线，再回头打碎它拿奖励' },
  surprise: { label: '惊喜怪的攻击', tip: '它咬过来前会先画出航道：离开那条航道再回头打' },
  shot: { label: '敌弹', tip: '被击中后有一小段无敌：趁这段时间换到安全的高度' },
};
function hurtCat(src) {
  if (!src) return 'shot';
  if (src === 'c:armor' || src === 'c:wreck') return 'armorC';
  if (src === 'c:lurk') return 'lurk';
  if (src === 'c:rage') return 'rage';
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
    { id: 'pack', goal: '快速处理厚甲编队', kind: 'pack', from: 'front', reward: 'mine', map: 'npc', mapAt: 3 },
    { id: 'cmdr', goal: '击败带队精英', kind: 'cmdr', from: 'crack', reward: 'core' },
    { id: 'rear', goal: '挡住后方追兵', kind: 'chase', event: 'rear', waves: 4 },
    { id: 'moon', goal: '月亮不太对劲', kind: 'surprise', surprise: 'moon' },
    { id: 'boss', goal: '击败泡泡小队长', kind: 'boss' },
  ],
  '1-2': [
    { id: 'crowd', goal: '清掉普通怪群', kind: 'crowd', n: 38, map: 'house', mapAt: 15 },
    { id: 'armor1', goal: '击破从裂缝钻出的厚甲怪', kind: 'armor1', from: 'rift', reward: 'bridge' },
    { id: 'pack', goal: '处理上下钻出的厚甲编队', kind: 'pack', from: 'drop', map: 'npc', mapAt: 3 },
    { id: 'spawner', goal: '摧毁残骸里的刷怪核心', kind: 'spawner', reward: 'mine' },
    { id: 'cmdr', goal: '击败带队精英', kind: 'cmdr', from: 'crack', reward: 'core' },
    { id: 'mimic', goal: '角落的贴纸在动？', kind: 'surprise', surprise: 'mimic' },
    { id: 'boss', goal: '击败裂纹闹钟队长', kind: 'boss' },
  ],
  '1-3': [
    { id: 'crowd', goal: '清掉普通怪群', kind: 'crowd', n: 40, map: 'house', mapAt: 15 },
    { id: 'armor1', goal: '击破后方绕来的厚甲怪', kind: 'armor1', from: 'rear', reward: 'wind' },
    { id: 'pack', goal: '处理从远处推近的厚甲编队', kind: 'pack', from: 'push', reward: 'giant' },
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
  jelly: { name: '泡泡水母', desc: '成排漂来，一发就散' },
  moth: { name: '梦尘蛾', desc: '成群乱飞，掉很多星砂' },
  boat: { name: '纸船灯', desc: '横着飞过，往下投弹' },
  tick: { name: '小闹钟', desc: '摇铃炸出一圈子弹，圈上有缝' },
  star: { name: '星星鱼', desc: '冲到你的高度射星弹' },
  beacon: { name: '灯塔眼', desc: '先画白线，再沿线射击' },
  jellyE: { name: '守望水母', desc: '精英：吐旋转弹涡，打倒充很多大招' },
  tickE: { name: '裂纹闹钟', desc: '精英：双层弹环加十字弹' },
  starE: { name: '双瞳星鱼', desc: '精英：连射金色星弹' },
  armor: { name: '厚甲河豚', desc: '先敲碎正面的甲，再打软核心' },
  cmdr: { name: '带队精英', desc: '举旗时打旗头水晶，它倒下护卫就散' },
  wreck: { name: '残骸刷怪核心', desc: '一直放出梦尘蛾，打碎核心才停' },
  mcore: { name: '月亮怪', desc: '月亮掉下来了：先打碎片，再打核心' },
  mimic: { name: '贴纸拟态', desc: '角落的贴纸长出眼睛跳进战场' },
  hmimic: { name: '拟态梦灯屋', desc: '会呼吸的假梦灯屋，打倒照样有奖励' },
  mirror: { name: '镜像闹钟', desc: '闹钟召唤的镜像，分身会自动锁定' },
  clock: { name: '失控闹钟', desc: '第一章 Boss，会对你的 Build 做出反应' },
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
    hint: ['碰一下梦灯屋门前的铃铛', '屋子会变成转盘，转出主炮改造'], desc: '碰铃铛，转出两个主炮改造' },
  wind: { id: 'wind', name: '风车塔', verb: '吹开', how: 'ring', tag: '推一排', color: '#9fe3f0', icon: 'wing',
    hint: ['从风车前面的宽风环穿过去', '吹开入口，一排敌人被推到炮口前'], desc: '穿过风环，吹开入口、推来一排敌人' },
  mine: { id: 'mine', name: '星砂矿', verb: '炸开', how: 'tow', tag: '强化', color: '#c9a8ff', icon: 'charge',
    hint: ['碰一下发光的矿核，把它拖到标记的岩壁', '矿核会跟着你飞，碰到岩壁就炸开'], desc: '把矿核拖到岩壁，炸开新航道' },
  npc: { id: 'npc', name: '救援吊舱', verb: '救出', how: 'escort', tag: '支援', color: '#ff9fcf', icon: 'heart',
    hint: ['碰一下伙伴的吊舱，沿光带护送到修理点', '吊舱挨几下也不怕，送到后伙伴加入'], desc: '把吊舱送到修理点，伙伴加入' },
  bridge: { id: 'bridge', name: '断桥', verb: '修复', how: 'path', tag: '安全航道', color: '#9fe3f0', icon: 'wing',
    hint: ['依次穿过三个灯环', '尾流把灯环连成一座桥，桥上一段时间敌弹会化掉'], desc: '穿过三个灯环接起断桥：一段安全航道 + 二选一' },
  giant: { id: 'giant', name: '沉睡巨鲸', verb: '唤醒', how: 'eye', tag: '清场', color: '#6ff0ff', icon: 'crown',
    hint: ['飞到巨鲸的眼睛旁边停一下', '它醒来会把附近的敌人一口吞掉，不会伤到你'], desc: '飞到眼睛旁边叫醒巨鲸：吞掉附近的敌人 + 稀有二选一' },
};
const MAP_ORDER = ['house', 'wind', 'mine', 'npc'];
/* 伙伴：救出后跟着飞机，自动射击，并各有一个效果；Boss 出现前各帮一次忙 */
const NPCS = {
  bunny: { id: 'bunny', name: '小梦兔', trap: 'bubble', color: '#e7d8ff', effect: '把附近的奖励叼回来' },
  grandpa: { id: 'grandpa', name: '云朵爷爷', trap: 'vine', color: '#dff2ff', effect: '定时铺一层云，帮你挡一下' },
  miner: { id: 'miner', name: '星星矿工', trap: 'vine', color: '#ffe38a', effect: '打倒一排敌人就挖出星砂' },
  merchant: { id: 'merchant', name: '糖果商人', trap: 'bubble', color: '#ff9fcf', effect: '每次升级放一次糖果爆炸' },
  clockling: { id: 'clockling', name: '小闹钟', trap: 'gear', color: '#ffd76a', effect: 'Boss 每换一个阶段补一次大招' },
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
  moon: '靠近装置时充能更快',
  cloud: '在装置旁停留时，靠近的敌弹会散掉',
  candy: '装置完成时来一场糖果爆炸',
  paper: '离开装置充能也不掉，穿环更容易',
  whale: '星砂矿挖出的星砂更多',
  clock: '装置完成后时间停一下',
};
