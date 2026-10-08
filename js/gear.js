'use strict';
/* 装备（docs/design.md §6）：照暗黑 2 的那一套——白 / 蓝 / 黄 / 绿套装 / 暗金；物品等级开词条档位，蓝装能出到黄装出不了的那一档；
   寻宝率、首杀必掉、保底；套装 2 件 / 4 件；暗金带技能或改变一件事。
   这里只有规则和数据（不碰界面、不碰模拟随机数）：掉落用每个玩家自己的随机数（联机时别人的掉落不影响同步）。 */

const GEAR_SLOTS = ['gun', 'aux', 'core', 'armor', 'engine', 'radar', 'chip1', 'chip2'];
const SLOT_KIND = { gun: 'gun', aux: 'aux', core: 'core', armor: 'armor', engine: 'engine', radar: 'radar', chip1: 'chip', chip2: 'chip' };
const GEAR_KINDS = {
  gun: { name: '主炮', w: 1, icon: 'g-gun' }, aux: { name: '辅助', w: 1, icon: 'g-aux' }, core: { name: '大招核心', w: 1, icon: 'g-core' },
  armor: { name: '装甲', w: 1, icon: 'g-armor' }, engine: { name: '引擎', w: 1, icon: 'g-engine' }, radar: { name: '雷达', w: 1, icon: 'g-radar' }, chip: { name: '芯片', w: 2, icon: 'g-chip' },
};
const GEAR_KIND_ORDER = ['gun', 'aux', 'core', 'armor', 'engine', 'radar', 'chip'];
const QUALS = {
  white: { name: '普通', color: '#e8e8e8', rank: 0 },
  blue: { name: '魔法', color: '#6f8dff', rank: 1 },
  yellow: { name: '稀有', color: '#ffe45c', rank: 2 },
  green: { name: '套装', color: '#3ee05a', rank: 3 },
  gold: { name: '暗金', color: '#d9a443', rank: 4 },
};
const QUAL_ORDER = ['white', 'blue', 'yellow', 'green', 'gold'];
/* 底子三档（暗黑 2 的普通 / 扩展 / 精英）：物品等级到了才掉高档 */
const GRADES = [{ name: '普通', ilvl: 1, k: 1, req: 1 }, { name: '加强', ilvl: 10, k: 1.6, req: 9 }, { name: '精英', ilvl: 20, k: 2.4, req: 13 }];
/* 需要的驾驶员等级跟着驾驶员的成长走，不和物品等级一比一（§6.3）：连续玩里走到第 2–5 张图时驾驶员中位 7 / 10 / 13 / 15 级、打倒祭司时 17 级；
   一比一的时候第 4、5 张图掉的几乎都穿不上，装备评分几十局不动 */
const REQ_CURVE = [[1, 1], [7, 8], [13, 12], [19, 15], [25, 17], [30, 19]];
const reqLvOf = (ilvl) => { for (let i = 1; i < REQ_CURVE.length; i++) { const [a, ra] = REQ_CURVE[i - 1], [b, rb] = REQ_CURVE[i]; if (ilvl <= b) return Math.round(ra + ((rb - ra) * (Math.max(ilvl, a) - a)) / (b - a)); } return REQ_CURVE[REQ_CURVE.length - 1][1]; };
const UNI_GRADE_K = [1, 1.5, 2.1]; // 套装、暗金的固定词条随底子档次成长
/* 词条档位：物品等级到了才开 */
const TIER_ILVL = [1, 6, 12, 18, 24, 28];
const MAX_ILVL = 30;

/* 主炮底子：决定开局武器（§6.3）。四种对单个目标的每秒伤害相同（约 80），差别在清群、射程、躲弹 */
const GUN_BASES = {
  rapid: { id: 'rapid', name: ['拾荒速射炮', '链式速射炮', '风暴速射炮'], weapon: '速射炮', dtype: 'kinetic', rate: 8, dmg: 10, n: 1, spread: 0, speed: 1150, life: 1.25, line: '直线单发，射得最勤' },
  scatter: { id: 'scatter', name: ['霰弹散射炮', '电浆散射炮', '新星散射炮'], weapon: '散射炮', dtype: 'energy', rate: 4, dmg: 6.7, n: 3, spread: 0.12, speed: 1050, life: 0.8, line: '一轮三发扇形，射程短' },
  beam: { id: 'beam', name: ['切割光束炮', '聚焦光束炮', '恒星光束炮'], weapon: '光束炮', dtype: 'energy', rate: 2.5, dmg: 32, n: 1, spread: 0, speed: 2100, life: 0.8, pierce: 1, line: '长光枪，自带穿透' },
  missile: { id: 'missile', name: ['蜂巢导弹', '猎手导弹', '末日导弹'], weapon: '导弹巢', dtype: 'kinetic', rate: 3, dmg: 13, n: 2, spread: 0.05, speed: 430, accel: 1100, life: 1.6, splash: 36, line: '慢弹，命中小范围溅射' },
};
const GUN_BASE_ORDER = ['rapid', 'scatter', 'beam', 'missile'];
/* 其他位的底子；imp = 普通档的固有属性（cap 不随档次成长） */
const OTHER_BASES = {
  aux: [{ id: 'aux', name: ['支援模块', '强化支援模块', '精英支援模块'], imp: { supK: 12 } }],
  core: [{ id: 'coreFast', name: ['火花核心', '电弧核心', '恒星核心'], imp: { burstK: 10, charge: 20 } }, { id: 'coreTwin', name: ['双联核心', '重型双联核心', '精英双联核心'], imp: { burstK: 10, cap: 1 } }],
  armor: [{ id: 'plate', name: ['拼接装甲', '复合装甲', '星钢装甲'], imp: { life: 10 } }],
  engine: [{ id: 'eng', name: ['旧推进器', '离子引擎', '曲速引擎'], imp: { spd: 5 } }],
  radar: [{ id: 'radar', name: ['拾荒雷达', '相控雷达', '深空雷达'], imp: { pick: 25, crit: 1 } }],
  chip: [{ id: 'chip', name: ['芯片', '加密芯片', '量子芯片'], imp: {} }],
};
const IMP_NOSCALE = { cap: 1 };

/* 词条（§6.4）：t = T1…T6 的范围；pre / suf = 前缀 / 后缀的名字；at = 能出在哪些位 */
const R6 = (a) => a; // 可读性：六档
const AFFIXES = {
  dmg: { name: '伤害', unit: '%', pre: '强袭的', t: R6([[5, 8], [9, 13], [14, 19], [20, 26], [27, 34], [35, 45]]), at: ['gun', 'aux', 'core', 'chip'], cat: 'atk' },
  rate: { name: '射速', unit: '%', suf: '之迅', t: R6([[3, 5], [6, 8], [9, 12], [13, 16], [17, 20], [21, 26]]), at: ['gun', 'chip'], cat: 'atk' },
  crit: { name: '暴击率', unit: '%', suf: '之锐', t: R6([[1, 2], [2, 3], [3, 4], [4, 6], [6, 8], [8, 10]]), at: ['gun', 'radar', 'chip'], cat: 'atk' },
  critD: { name: '暴击伤害', unit: '%', pre: '致命的', t: R6([[10, 15], [16, 22], [23, 30], [31, 40], [41, 52], [53, 65]]), at: ['gun', 'radar', 'chip'], cat: 'atk' },
  energy: { name: '能量伤害', unit: '%', pre: '过载的', t: R6([[8, 12], [13, 18], [19, 25], [26, 34], [35, 44], [45, 56]]), at: ['gun', 'aux', 'chip'], cat: 'atk' },
  kinetic: { name: '动能伤害', unit: '%', pre: '沉重的', t: R6([[8, 12], [13, 18], [19, 25], [26, 34], [35, 44], [45, 56]]), at: ['gun', 'aux', 'chip'], cat: 'atk' },
  vsShield: { name: '对护盾', unit: '%', suf: '之破盾', t: R6([[10, 15], [16, 22], [23, 30], [31, 40], [41, 52], [53, 65]]), at: ['gun', 'aux', 'radar', 'chip'], cat: 'atk' },
  vsArmor: { name: '对装甲', unit: '%', suf: '之碎甲', t: R6([[10, 15], [16, 22], [23, 30], [31, 40], [41, 52], [53, 65]]), at: ['gun', 'aux', 'radar', 'chip'], cat: 'atk' },
  life: { name: '生命', unit: '', pre: '坚固的', t: R6([[4, 6], [7, 10], [11, 15], [16, 21], [22, 28], [29, 36]]), at: ['armor', 'engine', 'core', 'chip'], cat: 'def' },
  dr: { name: '减伤', unit: '%', suf: '之壁', t: R6([[2, 3], [3, 4], [4, 6], [6, 8], [8, 10], [10, 13]]), at: ['armor', 'chip'], cat: 'def' },
  inv: { name: '无敌时间', unit: '%', suf: '之闪', t: R6([[8, 12], [13, 18], [19, 25], [26, 33], [34, 42], [43, 52]]), at: ['armor', 'engine'], cat: 'def' },
  spd: { name: '移速', unit: '%', suf: '之疾', t: R6([[3, 4], [4, 5], [5, 7], [7, 9], [9, 11], [11, 14]]), at: ['engine', 'chip'], cat: 'def' },
  leech: { name: '打倒精英回生命', unit: '', suf: '之饮', t: R6([[2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [8, 8]]), at: ['gun', 'armor', 'chip'], cat: 'def' },
  blast: { name: '爆炸范围', unit: '%', pre: '爆燃的', t: R6([[6, 9], [10, 14], [15, 20], [21, 27], [28, 35], [36, 45]]), at: ['gun', 'aux', 'chip'], cat: 'bet', sk: 'bomb' },
  homing: { name: '追踪转向', unit: '%', pre: '寻迹的', t: R6([[6, 9], [10, 14], [15, 20], [21, 27], [28, 35], [36, 45]]), at: ['gun', 'radar', 'chip'], cat: 'bet', sk: 'homing' },
  pierceD: { name: '穿透后伤害', unit: '%', pre: '贯通的', t: R6([[6, 9], [10, 14], [15, 20], [21, 27], [28, 35], [36, 45]]), at: ['gun', 'chip'], cat: 'bet', sk: 'pierce' },
  sideD: { name: '侧翼弹伤害', unit: '%', pre: '并列的', t: R6([[8, 12], [13, 18], [19, 25], [26, 34], [35, 44], [45, 56]]), at: ['gun', 'chip'], cat: 'bet', sk: 'multi' },
  orb: { name: '雷球多弹', unit: '次', suf: '之链', t: R6([null, null, [1, 1], [1, 1], [1, 1], [2, 2]]), at: ['aux', 'chip'], cat: 'bet', sk: 'thunder' },
  wingD: { name: '分身伤害', unit: '%', pre: '编队的', t: R6([[8, 12], [13, 18], [19, 25], [26, 34], [35, 44], [45, 56]]), at: ['aux', 'chip'], cat: 'bet', sk: 'wing' },
  beamW: { name: '光束宽度', unit: '%', pre: '炽亮的', t: R6([[8, 12], [13, 18], [19, 25], [26, 34], [35, 44], [45, 56]]), at: ['aux', 'chip'], cat: 'bet', sk: 'rainbow' },
  iceT: { name: '冰冻时间', unit: '%', suf: '之霜', t: R6([[10, 15], [16, 22], [23, 30], [31, 40], [41, 52], [53, 65]]), at: ['aux', 'chip'], cat: 'bet', sk: 'ice' },
  starD: { name: '星弹伤害', unit: '%', pre: '星砂的', t: R6([[8, 12], [13, 18], [19, 25], [26, 34], [35, 44], [45, 56]]), at: ['aux', 'radar', 'chip'], cat: 'bet', sk: 'magnet' },
  charge: { name: '大招充能', unit: '%', suf: '之源', t: R6([[5, 8], [9, 13], [14, 19], [20, 26], [27, 34], [35, 45]]), at: ['core', 'radar', 'chip'], cat: 'atk' },
  burstK: { name: '大招伤害', unit: '%', pre: '毁灭的', t: R6([[10, 15], [16, 22], [23, 30], [31, 40], [41, 52], [53, 65]]), at: ['core'], cat: 'atk' },
  mf: { name: '寻宝率', unit: '%', suf: '之运', t: R6([[5, 8], [9, 13], [14, 20], [21, 28], [29, 38], [39, 50]]), at: ['radar', 'engine', 'armor', 'chip'], cat: 'loot' },
  credit: { name: '信用点', unit: '%', suf: '之财', t: R6([[8, 12], [13, 18], [19, 25], [26, 34], [35, 44], [45, 56]]), at: ['radar', 'chip'], cat: 'loot' },
  ritual: { name: '仪式品质', unit: '%', pre: '祝福的', t: R6([[2, 3], [3, 5], [5, 7], [7, 9], [9, 12], [12, 15]]), at: ['radar', 'core', 'chip'], cat: 'loot' },
  plus: { name: '+1 级', unit: '级', pre: '专精', t: R6([null, null, [1, 1], [1, 1], [1, 1], [1, 1]]), at: ['gun', 'aux', 'core', 'chip'], cat: 'skill' },
};
const AFFIX_ORDER = Object.keys(AFFIXES);
/* “+1 级某能力”：主炮出主炮改造，辅助出支援，大招核心出飞船大招，芯片什么都能出 */
const PLUS_POOL = { gun: ['pierce', 'homing', 'multi', 'bomb'], aux: ['thunder', 'wing', 'rainbow', 'ice', 'magnet'], core: ['burst'], chip: ['pierce', 'homing', 'multi', 'bomb', 'thunder', 'wing', 'rainbow', 'ice', 'magnet', 'burst'] };
const PLUS_NAME = (sk) => (sk === 'burst' ? '飞船大招' : sk === 'all' ? '所有能力' : (SKILLS[sk] && SKILLS[sk].name) || sk);
/* 黄装的名字：按位取两个词（随机的两词名，暗黑 2 的稀有物品） */
const RARE_WORDS = {
  a: ['锈牙', '鸦影', '霜痕', '断星', '灰烬', '寂火', '钢喉', '幽航', '裂穹', '血月', '碎铃', '暗潮', '孤灯', '雷齿', '残章', '冷焰'],
  gun: ['毒刺', '咆哮', '獠牙', '长矛', '低语', '裁决'], aux: ['守望', '回声', '低鸣', '翼翅', '信标', '伴星'], core: ['心脏', '火种', '熔芯', '脉冲', '余烬', '太阳'],
  armor: ['外壳', '鳞甲', '壁垒', '铁幕', '护壳', '甲胄'], engine: ['尾焰', '彗尾', '疾风', '逃逸', '航迹', '推力'], radar: ['之眼', '天线', '耳语', '凝视', '回波', '灯塔'], chip: ['印记', '烙印', '密钥', '符文', '晶核', '残片'],
};

/* 七族与套装（§2.2、§6.5）：每套 4 件；2 件 / 4 件效果；4 件开局自带这一族流派的一件组件 */
const RACES = {
  drill: { id: 'drill', name: '穿甲矿业', color: '#ff8a3d', def: 'armor', path: '贯穿爆破流', set: '钻头' },
  ledger: { id: 'ledger', name: '星砂商会', color: '#a77bff', def: 'shield', path: '星砂散射流', set: '账本' },
  frost: { id: 'frost', name: '霜晶族', color: '#bfe9ff', def: 'shield', path: '散射冰晶流', set: '霜冠' },
  hive: { id: 'hive', name: '群翼族', color: '#2fe0b8', def: 'armor', path: '追踪蜂群流', set: '蜂后' },
  arc: { id: 'arc', name: '电弧公司', color: '#3ef0ff', def: 'shield', path: '追踪雷暴流', set: '董事会' },
  neon: { id: 'neon', name: '霓虹马戏', color: '#ff4fd8', def: 'shield', path: '烟火流', set: '烟火秀' },
  forge: { id: 'forge', name: '熔核军团', color: '#ff4b4b', def: 'armor', path: '雷爆流', set: '熔炉' },
};
const RACE_ORDER = ['drill', 'ledger', 'frost', 'hive', 'arc', 'neon', 'forge'];
/* 套装件：fix = 普通档的固定词条（相当于 T4–T5），随底子档次 × UNI_GRADE_K */
const SETS = {
  drill: { race: 'drill', name: '钻头', pieces: { gun: { base: 'rapid', fix: { dmg: 18, pierceD: 20 } }, armor: { fix: { life: 18, vsArmor: 25 } }, engine: { fix: { spd: 7, inv: 20 } }, chip: { fix: { crit: 4, blast: 18 } } },
    two: { pierceD: 25, blast: 20 }, four: { grant: 'pierce', line: '开局自带穿透 1 级；贯穿终点爆炸 +50%', link: 'pierce+bomb' } },
  ledger: { race: 'ledger', name: '账本', pieces: { gun: { base: 'scatter', fix: { dmg: 16, sideD: 22 } }, radar: { fix: { mf: 20, credit: 25 } }, engine: { fix: { spd: 6, life: 12 } }, chip: { fix: { starD: 25, vsShield: 20 } } },
    two: { starD: 30, credit: 25 }, four: { grant: 'magnet', line: '开局自带磁吸星砂 1 级' } },
  frost: { race: 'frost', name: '霜冠', pieces: { aux: { fix: { supK: 20, iceT: 30 } }, armor: { fix: { life: 20, dr: 6 } }, radar: { fix: { crit: 4, vsShield: 22 } }, chip: { fix: { sideD: 22, iceT: 20 } } },
    two: { iceT: 35, sideD: 20 }, four: { grant: 'ice', line: '开局自带冰晶 1 级' } },
  hive: { race: 'hive', name: '蜂后', pieces: { aux: { fix: { supK: 18, wingD: 28 } }, radar: { fix: { homing: 22, crit: 3 } }, engine: { fix: { spd: 8, life: 10 } }, chip: { fix: { wingD: 22, vsArmor: 22 } } },
    two: { wingD: 35 }, four: { grant: 'wing', line: '开局自带分身 1 级' } },
  arc: { race: 'arc', name: '董事会', pieces: { gun: { base: 'beam', fix: { energy: 28, homing: 18 } }, aux: { fix: { supK: 18, orb: 1 } }, radar: { fix: { crit: 4, vsShield: 25 } }, chip: { fix: { energy: 22, charge: 14 } } },
    two: { orb: 1, homing: 20 }, four: { grant: 'homing', line: '开局自带追踪 1 级' } },
  neon: { race: 'neon', name: '烟火秀', pieces: { aux: { fix: { supK: 18, beamW: 28 } }, core: { fix: { burstK: 25, charge: 15 } }, engine: { fix: { spd: 7, mf: 15 } }, chip: { fix: { blast: 18, beamW: 20 } } },
    two: { beamW: 30, blast: 15 }, four: { grant: 'rainbow', line: '开局自带彩虹光束 1 级' } },
  forge: { race: 'forge', name: '熔炉', pieces: { gun: { base: 'missile', fix: { kinetic: 28, blast: 18 } }, core: { fix: { burstK: 28, life: 12 } }, armor: { fix: { life: 22, vsArmor: 22 } }, chip: { fix: { blast: 20, dmg: 12 } } },
    two: { blast: 25, burstK: 20 }, four: { grant: 'bomb', line: '开局自带爆破 1 级' } },
};
/* 暗金（§6.6）：每一件都带技能或改变一件事。min = 最低物品等级；boss = 偏爱它的大首领（那张图第 3 关） */
const UNIQUES = {
  oldScav: { name: '老拾荒者', kind: 'gun', base: 'rapid', min: 1, fix: { dmg: 25, rate: 15 }, plus: { pierce: 1 }, line: '+1 级穿透', boss: 1 },
  thunderThroat: { name: '雷鸣之喉', kind: 'gun', base: 'beam', min: 7, fix: { energy: 40, vsShield: 30 }, grant: 'thunder', line: '开局自带雷球 1 级', boss: 3 },
  thousandNeedles: { name: '千针', kind: 'gun', base: 'scatter', min: 7, fix: { sideD: 50 }, plus: { multi: 1 }, flag: 'narrow', line: '+1 级多重；扇形收窄一半，全打在前方', boss: 2 },
  reply: { name: '回信', kind: 'gun', base: 'missile', min: 13, fix: { homing: 40, kinetic: 30 }, flag: 'seek', line: '导弹自带轻微追踪', boss: 4 },
  wingOath: { name: '僚机之誓', kind: 'aux', min: 7, fix: { wingD: 50 }, plus: { wing: 1 }, line: '+1 级分身', boss: 2 },
  glacierClock: { name: '冰河时钟', kind: 'aux', min: 13, fix: { iceT: 50 }, grant: 'ice', line: '开局自带冰晶 1 级', boss: 2 },
  neonHeart: { name: '霓虹心', kind: 'aux', min: 19, fix: { beamW: 40, supK: 30 }, grant: 'rainbow', line: '开局自带彩虹光束 1 级', boss: 3 },
  moonHeart: { name: '月轮之心', kind: 'core', base: 'coreFast', min: 7, fix: { burstK: 30 }, burst: 'moon', line: '大招换成月兔号的「月轮清屏」', boss: 1 },
  timeBox: { name: '时间之匣', kind: 'core', base: 'coreFast', min: 19, fix: { charge: 30 }, burst: 'clock', line: '大招换成闹钟号的「时间暂停」', boss: 4 },
  kingTriple: { name: '拾荒王的三联仓', kind: 'core', base: 'coreTwin', min: 25, fix: { burstK: 40, cap: 1 }, line: '大招多存 2 次', boss: 5 },
  rustShell: { name: '锈壳', kind: 'armor', min: 1, fix: { life: 40, dr: 12, spd: -8 }, line: '移速变慢', boss: 1 },
  glassCannon: { name: '玻璃大炮', kind: 'armor', min: 13, fix: { dmg: 45, life: -20 }, line: '用生命换火力', boss: 3 },
  escape: { name: '逃逸速度', kind: 'engine', min: 7, fix: { spd: 18, inv: 50 }, flag: 'escape', line: '受击后的无敌时间里，碰到的敌弹化成星砂', boss: 2 },
  comet: { name: '彗尾', kind: 'engine', min: 19, fix: { spd: 10 }, flag: 'comet', line: '移动时尾迹化掉碰到的敌弹（每 4 秒一次）', boss: 4 },
  scavEye: { name: '拾荒者之眼', kind: 'radar', min: 1, fix: { mf: 60, credit: 40 }, flag: 'foresee', line: '精英要掉东西时，头上先闪一下那件的品质色', boss: 1 },
  prophet: { name: '预言者', kind: 'radar', min: 19, fix: { ritual: 20, crit: 5 }, flag: 'prophet', line: '开局多一次完整升级仪式', boss: 5 },
  twinChip: { name: '双生芯片', kind: 'chip', min: 13, fix: { crit: 6, critD: 50 }, flag: 'twin', line: '暴击的子弹分成两发', boss: 3 },
  counter: { name: '克制者', kind: 'chip', min: 13, fix: { dmg: -10 }, flag: 'counter', line: '你的伤害永远按克制算', boss: 4 },
  earthEcho: { name: '地球的回声', kind: 'chip', min: 25, fix: { life: 20 }, plus: { all: 1 }, line: '所有能力 +1 级', boss: 5 },
  chaosShard: { name: '混沌碎片', kind: 'chip', min: 25, fix: { dmg: 30, vsShield: 30, vsArmor: 30 }, flag: 'chaos', line: '首领战开场 10 秒伤害翻倍', boss: 5, only: 'priest' },
};
const UNIQUE_ORDER = Object.keys(UNIQUES);

/* 掉落（§6.7）：每件先抽位，再抽底子；品质概率按来源 */
const DROP_Q = {
  fodder: { white: 70, blue: 25, yellow: 4, green: 0.7, gold: 0.3 },
  elite: { white: 50, blue: 40, yellow: 7, green: 2.2, gold: 0.8 },
  boss: { white: 25, blue: 50, yellow: 17, green: 5.5, gold: 2.5 },
  gamble: { white: 0, blue: 85, yellow: 13, green: 1.5, gold: 0.5 },
};
const DROP_RATE = { fodder: 0.0012, elite: 0.4, lurk: 0.1, thief: 2 }; // 连续玩量过（§19）：打穿一张图 15–20 件
const PITY = { rareRuns: 3, uniFirst: 5, uniRuns: 12 };
/* 败北补给（§11）：在还没打通的地图上倒在同一个首领面前，每 every 次站里送一箱，箱子里每个位各一件、自己挑；一箱比一箱好 */
const LOSS_PITY = { every: 3, everyFinal: 2, q: ['yellow', 'green', 'gold'] }; // 最后的混沌祭司每 2 次一箱
const MAP_COUNT = 5;
const ilvlOf = (mapN, stageN, boss) => Math.min(MAX_ILVL, 1 + 6 * (mapN - 1) + 2 * (stageN - 1) + (boss ? 1 : 0));

/* 驾驶员等级（§12.1） */
const PILOT = { max: 30, dmg: 0.02, heartAt: [8, 16, 24] };
const pilotXpNeed = (lv) => (lv >= PILOT.max ? Infinity : Math.round(120 * Math.pow(lv, 1.55)));
const pilotHearts = (lv) => PILOT.heartAt.filter((x) => lv >= x).length;

/* 站（§8）：解锁按做过的事；设施升级 */
const FACILITIES = {
  equip: { name: '装备栏', line: '换装、比较，看船的全部属性' },
  stash: { name: '仓库', line: '所有船共用；一件一格', lv: [40, 60, 90, 130, 180], cost: [null, { c: 300, scrap: 10 }, { c: 900, scrap: 20, shard: 5 }, { c: 2000, shard: 10 }, { c: 4000, core: 4 }] },
  insure: { name: '保险舱', line: '死在半路时保住最好的几件', lv: [1, 2, 3, 4], cost: [null, { c: 400, scrap: 10 }, { c: 1500, shard: 8 }, { c: 3500, core: 4 }] },
  shop: { name: '商人', line: '卖装备换信用点，买基础装备', lv: [1, 2, 3], cost: [null, { c: 500 }, { c: 2500, shard: 4 }] },
  salvage: { name: '拆解台', line: '把用不上的装备拆成材料', lv: [1, 1.25, 1.5], cost: [null, { c: 500, scrap: 15 }, { c: 2000, shard: 6 }] },
  cube: { name: '改造台', line: '整件重铸、合成材料、升阶套装和暗金', lv: [1, 2, 3], cost: [null, { c: 800, shard: 5 }, { c: 3000, core: 5 }] },
  black: { name: '黑市', line: '赌博：买一件看不到词条的装备；也卖飞船', lv: [1, 1.4, 1.8, 2.2], cost: [null, { c: 600, shard: 6 }, { c: 2000, core: 3 }, { c: 5000, core: 6 }] },
  hangar: { name: '机库', line: '换飞船' },
  codex: { name: '图鉴', line: '套装、暗金，谁掉什么' },
  starmap: { name: '星图', line: '选地图；走到过的关可以直接开始（路标）' },
};
const FAC_ORDER = ['equip', 'stash', 'shop', 'insure', 'salvage', 'cube', 'black', 'hangar', 'codex', 'starmap'];
/* 什么时候打开（§8.1）：按做过的事，不按打通地图 */
const UNLOCK_RULES = [
  { id: 'equip', why: '第一局开局就有' },
  { id: 'starmap', why: '第一局开局就有' },
  { id: 'stash', why: '第一次把装备带回家后打开' },
  { id: 'shop', why: '第一次回家后打开' },
  { id: 'insure', why: '第一次回家后打开' },
  { id: 'salvage', why: '第二次回家后打开' },
  { id: 'cube', why: '第一次拿到蓝装或黄装后打开' },
  { id: 'black', why: '第一次攒到 500 信用点后打开' },
  { id: 'hangar', why: '驾驶员 5 级打开' },
  { id: 'codex', why: '第一次拿到套装件后打开' },
];
const SELL_BASE = { white: 4, blue: 12, yellow: 30, green: 60, gold: 80 };
const SHIP_PRICES = [2500, 5000, 8000, 12000];
const CUBE_RECIPES = {
  rerollBlue: { name: '重铸蓝装', need: { shard: 3 }, lv: 1, line: '1 件蓝 + 3 晶片 → 同位、同物品等级的一件新蓝装' },
  rerollYellow: { name: '重铸黄装', need: { core: 2, scrap: 4 }, lv: 1, line: '1 件黄 + 2 晶核 + 4 废料 → 同位、同物品等级的一件新黄装' },
  scrapToShard: { name: '合成晶片', need: { scrap: 5 }, lv: 1, line: '5 废料 → 1 晶片' },
  shardToCore: { name: '合成晶核', need: { shard: 4 }, lv: 1, line: '4 晶片 → 1 晶核' },
  up1: { name: '升阶 · 加强', need: { core: 6, c: 300 }, lv: 2, line: '1 件普通档的绿或金 + 6 晶核 + 300 信用点 → 同一件，加强档' },
  up2: { name: '升阶 · 精英', need: { core: 12, c: 900 }, lv: 3, line: '1 件加强档的绿或金 + 12 晶核 + 900 信用点 → 同一件，精英档' },
};
const MATS = { scrap: { name: '废料', color: '#b9a48a' }, shard: { name: '晶片', color: '#8fb2ff' }, core: { name: '晶核', color: '#ffe27a' } };

/* ================================================== 规则 ================================================== */
const Gear = {
  uid: 1,
  rng(seed) { const r = new SeededRng(seed >>> 0); return () => r.next(); },
  pickW(rnd, table) { // {key: weight}
    let sum = 0; for (const k in table) sum += Math.max(0, table[k]);
    let x = rnd() * sum; for (const k in table) { x -= Math.max(0, table[k]); if (x <= 0) return k; }
    return Object.keys(table).pop();
  },
  maxTier(ilvl) { let t = 0; for (let i = 0; i < TIER_ILVL.length; i++) if (ilvl >= TIER_ILVL[i]) t = i; return t; }, // 0-based
  gradeOf(ilvl) { return ilvl >= GRADES[2].ilvl ? 2 : ilvl >= GRADES[1].ilvl ? 1 : 0; },
  /* 寻宝率：蓝全额；黄、绿、金照暗黑 2 递减 */
  mfTable(base, mf) {
    const t = Object.assign({}, base), m = Math.max(0, mf || 0) / 100;
    const eff = (k) => (m * 100 * k) / (m * 100 + k) / 100;
    t.blue *= 1 + m; t.yellow *= 1 + eff(600); t.green *= 1 + eff(500); t.gold *= 1 + eff(250);
    return t;
  },
  baseList(kind) { return kind === 'gun' ? GUN_BASE_ORDER : OTHER_BASES[kind].map((b) => b.id); },
  baseDef(kind, id) { return kind === 'gun' ? GUN_BASES[id] : OTHER_BASES[kind].find((b) => b.id === id); },
  /* 一件新装备。o: { ilvl, q, kind, base, set, uni, rnd, races（能掉的族）, mapRaces, bossMap } */
  make(o) {
    const rnd = o.rnd || Math.random, ilvl = clamp(Math.round(o.ilvl || 1), 1, MAX_ILVL);
    let q = o.q || 'white', kind = o.kind, base = o.base, set = o.set || null, uni = o.uni || null;
    if (q === 'gold' && !uni) uni = this.pickUnique(rnd, ilvl, kind, o.bossMap, o.priest);
    if (q === 'gold' && !uni) q = 'yellow'; // 这个位 / 物品等级没有能掉的暗金
    if (q === 'green' && !set) { const s = this.pickSetPiece(rnd, kind, o.races, o.mapRaces); if (s) { set = s.set; kind = s.kind; } else q = 'yellow'; }
    if (uni) { const U = UNIQUES[uni]; kind = U.kind; base = U.base || base; }
    if (set) { const P = SETS[set].pieces[kind]; if (P && P.base) base = P.base; }
    if (!kind) kind = this.pickW(rnd, Object.fromEntries(GEAR_KIND_ORDER.map((k) => [k, GEAR_KINDS[k].w])));
    if (!base && kind === 'gun' && (o.counter === 'shield' || o.counter === 'armor') && rnd() < 0.5) { const L = GUN_BASE_ORDER.filter((b) => GUN_BASES[b].dtype === (o.counter === 'shield' ? 'energy' : 'kinetic')); base = L[Math.floor(rnd() * L.length)]; } // 主炮底子也偏向克制它的伤害
    if (!base) { const L = this.baseList(kind); base = L[Math.floor(rnd() * L.length)]; }
    const grade = o.grade !== undefined ? o.grade : this.gradeOf(ilvl);
    const it = { uid: this.newUid(rnd), kind, base, grade, q, ilvl, imp: this.rollImp(kind, base, grade, rnd), aff: [], set, uni, bound: false, junk: false, lock: false, roll: Math.floor(rnd() * 1e9) };
    if (q === 'blue') this.rollMagic(it, rnd);
    else if (q === 'yellow') this.rollRare(it, rnd);
    if (q === 'yellow') it.rare = [Math.floor(rnd() * RARE_WORDS.a.length), Math.floor(rnd() * RARE_WORDS[kind].length)];
    if (o.counter && (q === 'blue' || q === 'yellow') && (o.counterAll || rnd() < 0.6)) this.addCounter(it, o.counter, rnd); // 输给这张图的首领以后，掉落偏向克制它的词条
    it.req = this.reqOf(it);
    return it;
  },
  newUid(rnd) { return (Date.now() % 1e9).toString(36) + '-' + Math.floor(rnd() * 1e9).toString(36) + '-' + (this.uid++).toString(36); },
  rollImp(kind, base, grade, rnd) {
    const out = {};
    if (kind === 'gun') { const B = GUN_BASES[base]; out.gunDmg = +(B.dmg * GRADES[grade].k * (0.9 + 0.2 * rnd())).toFixed(1); return out; }
    const B = this.baseDef(kind, base); if (!B) return out;
    for (const k in B.imp) out[k] = IMP_NOSCALE[k] ? B.imp[k] : Math.round(B.imp[k] * GRADES[grade].k * (0.9 + 0.2 * rnd()));
    return out;
  },
  affixPool(kind, used, pre) {
    return AFFIX_ORDER.filter((k) => { const A = AFFIXES[k]; return A.at.includes(kind) && !used.includes(k) && (pre === undefined || !!A.pre === pre); });
  },
  rollAffix(k, kind, maxT, rnd) {
    const A = AFFIXES[k]; const ok = []; for (let t = 0; t <= maxT; t++) if (A.t[t]) ok.push(t);
    if (!ok.length) return null;
    const t = ok[Math.floor(rnd() * ok.length)], [a, b] = A.t[t];
    const a1 = { k, v: a + Math.floor(rnd() * (b - a + 1)), t };
    if (k === 'plus') { const pool = PLUS_POOL[kind] || PLUS_POOL.chip; a1.sk = pool[Math.floor(rnd() * pool.length)]; }
    return a1;
  },
  /* 蓝：1 前缀和 / 或 1 后缀（30% 只有前缀、30% 只有后缀、40% 都有），能出到这个物品等级的最高档 */
  rollMagic(it, rnd) {
    const r = rnd(), want = r < 0.3 ? [true] : r < 0.6 ? [false] : [true, false], maxT = this.maxTier(it.ilvl);
    for (const pre of want) { const pool = this.affixPool(it.kind, it.aff.map((a) => a.k), pre).filter((k) => AFFIXES[k].t.slice(0, maxT + 1).some(Boolean)); if (!pool.length) continue; const a = this.rollAffix(pool[Math.floor(rnd() * pool.length)], it.kind, maxT, rnd); if (a) it.aff.push(a); }
    if (!it.aff.length) { const pool = this.affixPool(it.kind, [], undefined).filter((k) => AFFIXES[k].t[0]); const a = this.rollAffix(pool[Math.floor(rnd() * pool.length)], it.kind, maxT, rnd); if (a) it.aff.push(a); }
  },
  /* 黄：4–6 条，前后缀各最多 3 条；档位上限比同物品等级的蓝装低一档 */
  rollRare(it, rnd) {
    const r = rnd(), n = r < 0.5 ? 4 : r < 0.85 ? 5 : 6, maxT = Math.max(0, this.maxTier(it.ilvl) - 1);
    let np = 0, ns = 0, guard = 0;
    while (it.aff.length < n && guard++ < 40) {
      const pre = np >= 3 ? false : ns >= 3 ? true : rnd() < 0.5;
      const pool = this.affixPool(it.kind, it.aff.map((a) => a.k), pre).filter((k) => AFFIXES[k].t.slice(0, maxT + 1).some(Boolean)); if (!pool.length) { if (np >= 3 || ns >= 3) break; continue; }
      const a = this.rollAffix(pool[Math.floor(rnd() * pool.length)], it.kind, maxT, rnd); if (!a) continue;
      it.aff.push(a); if (pre) np++; else ns++;
    }
  },
  /* 克制词条：护盾 → 对护盾，装甲 → 对装甲，轮换（祭司）→ 两条里缺的那条；位放不下就顶掉一条后缀 */
  addCounter(it, def, rnd) {
    const want = (def === 'shield' ? ['vsShield'] : def === 'armor' ? ['vsArmor'] : ['vsShield', 'vsArmor']).filter((k) => AFFIXES[k].at.includes(it.kind) && !it.aff.some((a) => a.k === k));
    if (!want.length) return;
    const k = want[Math.floor(rnd() * want.length)], maxT = it.q === 'yellow' ? Math.max(0, this.maxTier(it.ilvl) - 1) : this.maxTier(it.ilvl), a = this.rollAffix(k, it.kind, maxT, rnd); if (!a) return;
    const sufs = it.aff.filter((x) => !AFFIXES[x.k].pre), full = it.q === 'blue' ? sufs.length >= 1 : sufs.length >= 3 || it.aff.length >= 6;
    if (full) { const out = sufs.filter((x) => x.k !== 'vsShield' && x.k !== 'vsArmor'); if (!out.length) return; it.aff.splice(it.aff.indexOf(out[Math.floor(rnd() * out.length)]), 1); }
    it.aff.push(a);
  },
  pickUnique(rnd, ilvl, kind, bossMap, priest) {
    const pool = {}; for (const id of UNIQUE_ORDER) { const U = UNIQUES[id]; if (U.min > ilvl || (kind && U.kind !== kind) || (U.only === 'priest' && !priest)) continue; pool[id] = bossMap && U.boss === bossMap ? 4 : 1; if (U.only === 'priest' && priest) pool[id] = 6; }
    if (!Object.keys(pool).length) return null;
    return this.pickW(rnd, pool);
  },
  /* 套装：六成从这张地图的族里出，四成从已经开放的所有族里出 */
  pickSetPiece(rnd, kind, races, mapRaces) {
    const open = (races && races.length ? races : RACE_ORDER).filter((r) => SETS[r]);
    const local = (mapRaces || []).filter((r) => open.includes(r));
    const fromPool = (L) => { const opts = []; for (const r of L) for (const k in SETS[r].pieces) if (!kind || k === kind) opts.push({ set: r, kind: k }); return opts; };
    let opts = local.length && rnd() < 0.6 ? fromPool(local) : fromPool(open); // local：打倒的那个敌人所属的族，或这张图的族
    if (!opts.length) opts = fromPool(open);
    if (!opts.length) return null;
    return opts[Math.floor(rnd() * opts.length)];
  },
  reqOf(it) {
    if (it.uni) return Math.max(GRADES[it.grade].req, reqLvOf(UNIQUES[it.uni].min));
    if (it.set) return GRADES[it.grade].req + 2;
    const add = { white: 0, blue: 1, yellow: 3 }[it.q] || 0;
    return clamp(Math.max(GRADES[it.grade].req, reqLvOf(it.ilvl) - 3 + add), 1, PILOT.max);
  },
  /* 掉落一件：品质（寻宝率）→ 位 → 底子 → 词条 */
  roll(o) {
    const rnd = o.rnd, table = this.mfTable(DROP_Q[o.src || 'elite'], o.mf);
    if (o.minQ) for (const q of QUAL_ORDER) if (QUALS[q].rank < QUALS[o.minQ].rank) table[q] = 0;
    if (o.blackK) { table.green *= o.blackK; table.gold *= o.blackK; }
    const q = o.q || this.pickW(rnd, table);
    return this.make(Object.assign({}, o, { q, rnd }));
  },
  /* ---------- 名字和说明 ---------- */
  baseName(it) { const B = this.baseDef(it.kind, it.base); return B ? B.name[it.grade] : '?'; },
  name(it) {
    if (it.uni) return UNIQUES[it.uni].name;
    if (it.set) return `${SETS[it.set].name} · ${GEAR_KINDS[it.kind].name}`;
    if (it.q === 'yellow' && it.rare) return RARE_WORDS.a[it.rare[0] % RARE_WORDS.a.length] + ' ' + RARE_WORDS[it.kind][it.rare[1] % RARE_WORDS[it.kind].length];
    if (it.q === 'blue') {
      const pre = it.aff.find((a) => AFFIXES[a.k].pre), suf = it.aff.find((a) => AFFIXES[a.k].suf);
      const pn = pre ? (pre.k === 'plus' ? PLUS_NAME(pre.sk) + '专精的' : AFFIXES[pre.k].pre) : '';
      return pn + this.baseName(it) + (suf ? AFFIXES[suf.k].suf : '');
    }
    return this.baseName(it);
  },
  color(it) { return QUALS[it.q].color; },
  fmtAffix(k, v, sk) {
    const A = AFFIXES[k] || { name: k, unit: '' };
    if (k === 'plus') return `+${v} 级${PLUS_NAME(sk)}`;
    if (k === 'orb') return `雷球多弹 +${v} 次`;
    if (k === 'cap') return `大招多存 ${v} 次`;
    if (k === 'supK') return `支援伤害 +${v}%`;
    if (k === 'pick') return `拾取范围 +${v}%`;
    if (k === 'gunDmg') return `每发伤害 ${v}`;
    if (k === 'dr') return `受到伤害 −${v}%`;
    const sign = v < 0 ? '−' : '+';
    return `${A.name} ${sign}${Math.abs(v)}${A.unit === '%' ? '%' : ''}`;
  },
  /* 这一件的全部属性（固有 + 词条 + 套装 / 暗金的固定词条）：{k: v} 和技能 */
  itemStats(it) {
    const s = {}, add = (k, v) => { s[k] = (s[k] || 0) + v; };
    for (const k in it.imp) if (k !== 'gunDmg') add(k, it.imp[k]);
    for (const a of it.aff) { if (a.k === 'plus') continue; add(a.k, a.v); }
    const gk = UNI_GRADE_K[it.grade] || 1;
    if (it.set) { const P = SETS[it.set].pieces[it.kind]; if (P) for (const k in P.fix) add(k, Math.round(P.fix[k] * (k === 'orb' ? 1 : gk))); }
    if (it.uni) { const U = UNIQUES[it.uni]; for (const k in U.fix) add(k, IMP_NOSCALE[k] ? U.fix[k] : Math.round(U.fix[k] * gk)); }
    return s;
  },
  plusOf(it) {
    const o = {}; for (const a of it.aff) if (a.k === 'plus') o[a.sk] = (o[a.sk] || 0) + a.v;
    if (it.uni && UNIQUES[it.uni].plus) for (const k in UNIQUES[it.uni].plus) o[k] = (o[k] || 0) + UNIQUES[it.uni].plus[k];
    return o;
  },
  /* 说明框的行：[{text, color, kind}] */
  lines(it) {
    const L = [], blue = '#8fb2ff';
    L.push({ t: this.name(it), c: this.color(it), big: true });
    if (it.uni || it.set || it.q === 'yellow' || it.q === 'blue') L.push({ t: this.baseName(it), c: '#a7a3b8' });
    L.push({ t: `${GEAR_KINDS[it.kind].name} · ${GRADES[it.grade].name}档 · 物品等级 ${it.ilvl}`, c: '#8a86a0', small: true });
    if (it.kind === 'gun') { const B = GUN_BASES[it.base]; L.push({ t: `${B.weapon} · ${B.dtype === 'energy' ? '能量' : '动能'} · ${B.line}`, c: '#d8d4ea' }); L.push({ t: this.fmtAffix('gunDmg', it.imp.gunDmg), c: '#d8d4ea' }); }
    else for (const k in it.imp) L.push({ t: this.fmtAffix(k, it.imp[k]), c: '#d8d4ea' });
    const gk = UNI_GRADE_K[it.grade] || 1;
    for (const a of it.aff) L.push({ t: this.fmtAffix(a.k, a.v, a.sk), c: blue, tier: a.t, k: a.k });
    if (it.set) { const P = SETS[it.set].pieces[it.kind]; for (const k in P.fix) L.push({ t: this.fmtAffix(k, Math.round(P.fix[k] * (k === 'orb' ? 1 : gk))), c: blue }); }
    if (it.uni) { const U = UNIQUES[it.uni]; for (const k in U.fix) L.push({ t: this.fmtAffix(k, IMP_NOSCALE[k] ? U.fix[k] : Math.round(U.fix[k] * gk)), c: blue }); L.push({ t: U.line, c: '#e6c37a' }); }
    return L;
  },
  /* ---------- 身上的装备 → 飞船属性 ---------- */
  compute(eq) {
    const g = { sets: {}, plus: {}, grant: [], flags: {}, burst: null, gun: null };
    const add = (k, v) => { g[k] = (g[k] || 0) + v; };
    for (const slot of GEAR_SLOTS) {
      const it = eq && eq[slot]; if (!it) continue;
      const s = this.itemStats(it); for (const k in s) add(k, s[k]);
      const pl = this.plusOf(it); for (const k in pl) g.plus[k] = (g.plus[k] || 0) + pl[k];
      if (it.set) g.sets[it.set] = (g.sets[it.set] || 0) + 1;
      if (it.uni) { const U = UNIQUES[it.uni]; if (U.grant) g.grant.push(U.grant); if (U.flag) g.flags[U.flag] = true; if (U.burst) g.burst = U.burst; }
      if (slot === 'gun') g.gun = { base: it.base, dmg: it.imp.gunDmg, uni: it.uni || null };
    }
    for (const r in g.sets) {
      const S = SETS[r]; if (g.sets[r] >= 2) for (const k in S.two) add(k, S.two[k]);
      if (g.sets[r] >= 4) { g.grant.push(S.four.grant); if (S.four.link) g.flags['link:' + S.four.link] = true; }
    }
    if (!g.gun) g.gun = { base: 'rapid', dmg: GUN_BASES.rapid.dmg, uni: null };
    g.dr = Math.min(50, g.dr || 0);
    return g;
  },
  /* ---------- 身上的装备长在船上（§6.2、§15）：主炮底子换炮口，装甲 / 引擎 / 雷达 / 辅助各挂一个看得见的部件，颜色是品质色；
     同族两件以上加一对族色尾鳍，暗金让船身带一圈金色闪光。只给画面用，联机随名单带给每一端 ---------- */
  look(eq) {
    if (!eq) return null; const o = {}, races = {};
    for (const slot of GEAR_SLOTS) {
      const it = eq[slot]; if (!it) continue;
      if (slot === 'chip1' || slot === 'chip2') { if (!o.chip || QUALS[it.q].rank > QUALS[o.chip].rank) o.chip = it.q; }
      else o[slot] = it.q;
      if (slot === 'gun') o.base = it.base || 'rapid';
      if (it.set) races[it.set] = (races[it.set] || 0) + 1;
      if (it.q === 'gold') o.uni = (o.uni || 0) + 1;
    }
    const best = Object.keys(races).sort((a, b) => races[b] - races[a])[0]; if (best && races[best] >= 2) o.set = best;
    return o;
  },
  /* ---------- 估一件装备的“好坏”（比较框的总结、机器人换装） ---------- */
  score(eqStats, planeId) {
    const g = eqStats, B = GUN_BASES[g.gun.base], P = PLANES[planeId || 'moon'];
    const dps = (g.gun.dmg / B.dmg) * 80 * (1 + (g.dmg || 0) / 100) * (1 + (g.rate || 0) / 100) * (1 + (((g.crit || 0) + 5) / 100) * ((50 + (g.critD || 0)) / 100))
      * (1 + ((B.dtype === 'energy' ? g.energy : g.kinetic) || 0) / 100) * (1 + ((g.vsShield || 0) + (g.vsArmor || 0)) / 200) * (1 + 0.15 * ((g.supK || 0) / 100));
    const ehp = (P.hearts * 10 + (g.life || 0)) / (1 - (g.dr || 0) / 100) * (1 + (g.inv || 0) / 300) * (1 + (g.spd || 0) / 100);
    return { dps, ehp, total: dps * Math.sqrt(ehp / 50) };
  },
  /* ---------- 站里的经济 ---------- */
  sellPrice(it) { return Math.round(SELL_BASE[it.q] * (1 + it.ilvl / 10)); },
  salvageOf(it, k) {
    k = k || 1; const o = {};
    if (it.q === 'white') o.scrap = it.ilvl >= 10 ? 3 : 2;
    else if (it.q === 'blue') { o.shard = 1; o.scrap = 2; }
    else if (it.q === 'yellow') { o.core = 1; o.shard = 1; }
    else { o.core = 2; o.shard = 3; }
    for (const m in o) o[m] = Math.max(1, Math.round(o[m] * k));
    return o;
  },
  gamblePrice(lv, any) { return Math.round((100 + 25 * lv) * (any ? 0.8 : 1)); },
  gambleIlvl(lv, maxIlvl, rnd) { return clamp(lv - 3 + Math.floor(rnd() * 6), 1, Math.min(MAX_ILVL, (maxIlvl || 1) + 2)); },
};
