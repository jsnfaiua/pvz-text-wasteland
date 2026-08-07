// ============================================================
// 【无尽植僵荒原】模组 · 数值配置中心（统一收口，方便调平衡）
// 引用本体 PLANTS / WEAPONS / ZOMBIES 表作为基础数据源
// ============================================================

import { ZOMBIES, WEAPONS, AMMO_INFO } from '../core/constants.js';

// ---------- 全局 ----------
export const DAY_LEN = 3600;    // 1 现实小时 = 1 游戏天（昼夜系统时间流速）
export const MAX_HP = 100;
export const PLAYER_SPEED = 130;
export const HOTBAR_SIZE = 6;
export const SAVE_INTERVAL = 20;
export const PICKUP_RADIUS = 26;

// ---------- 区域（M-α 资源富集：连片大区，资源/僵尸/建筑密度按区画像） ----------
// REGION_CELL：区域噪声格子（单位=区块）。值噪声连片，典型 ≥64 格、保证 ≥48×48。
export const REGION_CELL = 4;
export const DISTRICT_KEYS = ['urban', 'suburb', 'wild', 'ruins'];
// resMul=资源(箱)密度倍率 zombieMul=僵尸刷新密度倍率 buildDensity=建筑密度(0~1) danger=危险度 crops=是否产野外作物(M-ζ)
export const DISTRICTS = {
    urban:  { name: '城区', biome: 1, resMul: 1.6, zombieMul: 1.5, buildDensity: 0.9, danger: 3, crops: false },
    suburb: { name: '郊区', biome: 1, resMul: 1.0, zombieMul: 0.7, buildDensity: 0.4, danger: 1, crops: false },
    wild:   { name: '荒野', biome: 0, resMul: 0.5, zombieMul: 0.5, buildDensity: 0.0, danger: 1, crops: true },
    ruins:  { name: '废墟', biome: 2, resMul: 1.2, zombieMul: 1.4, buildDensity: 0.5, danger: 3, crops: false },
};

// ---------- 难度（两档：正常 / 硬核·一条命） ----------
// normal：软死亡（丢部分背包重生）；hardcore：一条命（死亡即永久，怪物属性更高）
export const DIFF_TABLE = {
    normal:   { name: '正常', mul: 1.0,  soft: true },
    hardcore: { name: '硬核', mul: 1.5,  soft: false },
};

// ---------- 僵尸 ----------
export const Z_CHAR = { normal: '僵', cone: '障', bucket: '桶', pole: '杆', flag: '旗', door: '门', remnant: '残', deleter: '删', swapper: '换', giant: '巨' };
export const Z_SPEED_MUL = 2.6;
// 尸化玩家精英僵尸（hardcore 死亡后留世；§13.1 数值收口）
export const PZ_BASE_HP = 70;        // 基础生命（×天数/难度/环 ×精英系数）
export const PZ_ELITE_MUL = 1.8;     // 精英系数（血量）
export const PZ_SPEED = 0.22;        // 速度（× Z_SPEED_MUL）
export const PZ_DAMAGE = 22;         // 接触伤害基准
export const PZ_INF_LOW = 0.15;      // 尸化初期腐烂度下限
export const PZ_INF_RANGE = 0.2;     // 腐烂度随机幅度（运行时表现类，不进存档）
// 正常模式死亡：遗物包裹物品「不可抗力永久消失」比例（死亡次数越多代价越大）
export const DEATH_VANISH_BASE = 0.2;   // 基础消失率（第 1 次实际 30%）
export const DEATH_VANISH_STEP = 0.1;   // 每次死亡递增
export const DEATH_VANISH_MAX = 0.6;    // 封顶
export function deathVanishRate(count) {
    return Math.min(DEATH_VANISH_BASE + (count || 0) * DEATH_VANISH_STEP, DEATH_VANISH_MAX);
}
export const Z_DAY_SCALE = 0.05;
export const Z_CHASE_RANGE = 8;       // 格：玩家周围总宽/高为 8 格的方形警戒区
export const Z_WANDER_SPEED = 0.45;

// ---------- 天气系统（§13.1 数值收口 / §13.6 概率表权重和 = 1，smoke 断言） ----------
// sv._weather 每天 8:00 由 weatherAt(seed, day) 确定性切换（§13.2：世界状态禁 Math.random）；
// 单机/联机 host 同一公式，guest 经 wsync 快照同步（§5.1 零差异）。
// particles: 0 无粒子 / 1 雨 / 2 雪 / 3 雾（层）/ 4 沙尘
export const WX_TABLE = {
    clear:     { name: '晴朗',   color: '#E8E4D0', weight: 0.38, speedMul: 1.0, particles: 0, desc: '万里无云，视野开阔' },
    rain:      { name: '细雨',   color: '#6FA8D8', weight: 0.20, speedMul: 1.0, particles: 1, desc: '雨丝斜织，地面湿润' },
    snow:      { name: '飘雪',   color: '#E8F2FF', weight: 0.12, speedMul: 0.9, particles: 2, desc: '雪花纷飞，行动迟缓' },
    fog:       { name: '大雾',   color: '#B8C4C8', weight: 0.16, speedMul: 0.9, particles: 3, desc: '浓雾弥漫，视野受限' },
    sandstorm: { name: '沙尘暴', color: '#D8B878', weight: 0.14, speedMul: 0.7, particles: 4, desc: '狂风卷沙，行动困难' },
};   // 权重和 = 0.38+0.20+0.12+0.16+0.14 = 1.00
export function wxInfo(key) { return WX_TABLE[key] || WX_TABLE.clear; }
// 确定性哈希（内联纯函数，wbalance 无外部依赖）：weatherAt(seed, day) 每天固定
function wxHash(seed, a, b) {
    let h = (seed | 0) ^ Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
export function weatherAt(seed, day) {
    const r = wxHash(seed, day | 0, 0x57AB);
    let acc = 0;
    for (const k in WX_TABLE) { acc += WX_TABLE[k].weight; if (r < acc) return k; }
    return 'clear';
}

// ---------- 天气强度分级（用户：强度只影响疏密/浓度，不影响粒子速度） ----------
// density = 粒子密度倍数（雾无粒子，用 mul 缩放覆盖层）；mul = 覆盖层浓度倍数
export const WX_INTENSITY = {
    rain: [
        { name: '小雨', density: 0.45, mul: 0.7 },
        { name: '中雨', density: 1.0, mul: 1.0 },
        { name: '大雨', density: 1.6, mul: 1.35 },
        { name: '暴雨', density: 2.3, mul: 1.7 },
    ],
    snow: [
        { name: '小雪', density: 0.5, mul: 0.7 },
        { name: '中雪', density: 1.0, mul: 1.0 },
        { name: '大雪', density: 1.8, mul: 1.4 },
    ],
    fog: [
        { name: '薄雾', density: 0, mul: 0.6 },
        { name: '中雾', density: 0, mul: 1.0 },
        { name: '浓雾', density: 0, mul: 1.5 },
    ],
    sandstorm: [
        { name: '扬沙', density: 0.6, mul: 0.7 },
        { name: '沙尘暴', density: 1.0, mul: 1.0 },
        { name: '强沙暴', density: 1.7, mul: 1.4 },
    ],
};
export function wxIntensity(type, level) {
    const arr = WX_INTENSITY[type] || WX_INTENSITY.rain;
    const l = Math.max(0, Math.min(arr.length - 1, level || 0));
    return arr[l];
}
export function wxLevelAt(seed, day) {
    // 确定性强度（§13.2）：同一世界同一天强度固定；单机/联机 host/guest 一致（seed 相同）
    const type = weatherAt(seed, day);
    const arr = WX_INTENSITY[type] || WX_INTENSITY.rain;
    const r = wxHash(seed, day | 0, 0x2C1B);
    return Math.floor(r * arr.length);
}

// ---------- 感染视觉（§13.1 收口）：屏幕覆盖层随阶段增强 ----------
export const INF_VIS = [
    { stage: 0, name: '完整', alpha: 0.00, noise: 0 },    // 0+  无
    { stage: 1, name: '浮字', alpha: 0.00, noise: 0 },    // 10+ 无（身体剥落已表达）
    { stage: 2, name: '缺口', alpha: 0.10, noise: 0 },    // 25+ 轻绿灰呼吸
    { stage: 3, name: '字骨', alpha: 0.16, noise: 0 },    // 45+ 加深
    { stage: 4, name: '失名', alpha: 0.24, noise: 1 },    // 70+ 噪点（文字侵蚀感）
    { stage: 5, name: '文尸', alpha: 0.32, noise: 1 },    // 90+ 更深 + 更快呼吸
];
export function infVis(stage) { return INF_VIS[stage] || INF_VIS[0]; }
export const Z_CHASE_SPEED_MUL = 1.3;  // 探测到玩家后追击加速倍率
export const Z_HORDE_SPEED_MUL = 1.15;
export const Z_BITE_INTERVAL = 0.6;
export const Z_SPAWN_INTERVAL_MIN = 6;
export const Z_SPAWN_INTERVAL_RAND = 4;
export const Z_SPAWN_DIST_MIN = 18;
export const Z_SPAWN_DIST_RAND = 8;
export const Z_SPAWN_CAP_BASE = 4;
export const Z_SPAWN_CAP_MAX = 9;
// 生存模式专用HP（覆盖本体塔防数值，以豌豆射手30dmg为基准平衡）
export const Z_SURVIVAL_HP = {
    normal: 70, cone: 130, bucket: 280, pole: 80, flag: 50, door: 320,
    remnant: 160, deleter: 180, swapper: 120, giant: 1500,
};
// 僵尸袋生成率由类型映射到等级，不再全体共用单一概率。
export const ZOMBIE_LOOT_TIER = {
    normal: 'normal', cone: 'variant', pole: 'variant', bucket: 'variant', flag: 'variant', door: 'variant',
    remnant: 'elite', deleter: 'elite', swapper: 'elite',
};
export const ZOMBIE_BAG_DROP_CHANCE = { normal: 0.50, variant: 0.65, elite: 0.85, boss: 1.00 };
// 保留旧导出，供尚未迁移的外部调用兼容；模组内部不再使用。
export const Z_DROP_CHANCE = ZOMBIE_BAG_DROP_CHANCE.variant;
export const Z_NIGHT_STRENGTH_MUL = 1.12;

// ---------- 僵尸死亡战利品（道具化 + 品质） ----------
// 品质概率：僵尸越强，高品质概率越高；品质越高整体越稀有
export const LOOT_QUALITY = {
    normal: [['common', 0.96], ['rare', 0.04], ['epic', 0.00]],
    variant: [['common', 0.75], ['rare', 0.24], ['epic', 0.01]],
    elite: [['common', 0.25], ['rare', 0.68], ['epic', 0.07]],
    boss: [['common', 0.00], ['rare', 0.55], ['epic', 0.45]],
};

// ---------- v1.1 文字系统附加掉落 ----------
// 每行是一次成功搜索后的实际概率；基础物资在此判定前照常生成。
export const WORD_LOOT_SOURCE_TABLES = {
    supply:  { none: 0.48, glyph: 0.33, wedge: 0.10, lightFragment: 0.05, severeFragment: 0.03, complete: 0.01 },
    weapon:  { none: 0.53, glyph: 0.27, wedge: 0.10, lightFragment: 0.05, severeFragment: 0.04, complete: 0.01 },
    medical: { none: 0.48, glyph: 0.29, wedge: 0.12, lightFragment: 0.06, severeFragment: 0.04, complete: 0.01 },
    material:{ none: 0.51, glyph: 0.30, wedge: 0.10, lightFragment: 0.05, severeFragment: 0.03, complete: 0.01 },
    car:     { none: 0.55, glyph: 0.26, wedge: 0.10, lightFragment: 0.05, severeFragment: 0.03, complete: 0.01 },
};

export const WORD_LOOT_REGION_MODIFIERS = {
    urban: { none: -0.04, glyph: 0.02, wedge: 0.01, lightFragment: 0.01 },
    suburb: { none: 0.02, glyph: -0.01, wedge: -0.01 },
    wild: { none: 0.04, glyph: -0.02, lightFragment: -0.01, severeFragment: -0.01 },
    ruins: { none: -0.06, glyph: 0.02, wedge: 0.01, lightFragment: 0.01, severeFragment: 0.01, complete: 0.01 },
    underground1: { none: -0.05, glyph: 0.02, wedge: 0.01, lightFragment: 0.01, severeFragment: 0.01 },
    underground2: { none: -0.08, glyph: 0.02, wedge: 0.02, lightFragment: 0.01, severeFragment: 0.02, complete: 0.01 },
};

export const ZOMBIE_BAG_RESULT_TABLES = {
    common: { base: 0.47, glyph: 0.40, wedge: 0.05, lightFragment: 0.05, severeFragment: 0.03, complete: 0.00 },
    rare:   { base: 0.28, glyph: 0.40, wedge: 0.15, lightFragment: 0.10, severeFragment: 0.06, complete: 0.01 },
    epic:   { base: 0.14, glyph: 0.34, wedge: 0.25, lightFragment: 0.14, severeFragment: 0.09, complete: 0.04 },
};
// 各品质内容池 [物品种类, 权重]；种类更丰富
export const LOOT_CONTENTS = {
    common: { count: [1, 2], pool: [
        ['herb', 0.20], ['food', 0.25], ['wood', 0.20], ['water', 0.15], ['fert', 0.15], ['sun', 0.10],
    ] },
    rare: { count: [2, 3], pool: [
        ['ammo', 0.26], ['part', 0.18], ['food', 0.12], ['herb', 0.12], ['stone', 0.12], ['wood', 0.10], ['tool', 0.10],
    ] },
    epic: { count: [2, 3], pool: [
        ['ammo', 0.28], ['weapon', 0.22], ['tool', 0.18], ['part', 0.18], ['gem', 0.16], ['flag', 0.08],
    ] },
};

// ---------- 僵尸攻击（蓄力预警 → 单次挥击，可躲避） ----------
export const Z_ATK_RANGE = 1.7;      // 格：进入此距离开始蓄力
export const Z_WINDUP = 0.65;        // 秒：蓄力预警时长（玩家反应窗口）
export const Z_STRIKE_DIST = 48;     // 像素：挥击命中距离（含突进后）
export const Z_LUNGE = 16;           // 像素：挥击时向前突进距离
export const Z_ATK_CD = 0.9;         // 秒：两次攻击间隔

// 僵尸对植物的行为：侦测范围内会主动靠近并攻击植物
export const Z_PLANT_DETECT = 5;     // 格：侦测植物并靠近
export const Z_PLANT_ATK_RANGE = 1.6; // 格：贴近植物到此距离开始蓄力

// ---------- 特殊僵尸（M-δ） ----------
export const Z_POLE_UNLOCK_DAY = 3;   // 撑杆：第3天起出现
export const Z_DOOR_UNLOCK_DAY = 5;   // 铁门：第5天起出现
export const Z_FLAG_AURA_RANGE = 3;   // 格：旗帜加速光环半径
export const Z_FLAG_AURA_MUL = 1.35;  // 光环内僵尸移速倍率
export const Z_DOOR_HP = 500;         // 铁门总血量（调低，避免超标打不动）
export const Z_DOOR_FRONT_MUL = 0.4;  // 铁门正面减伤倍率（仅站定蓄力举盾时生效）
export const Z_DOOR_FRONT_ANGLE = Math.PI / 3; // 正面判定夹角（±60°）

// ---------- 文字僵尸（P2，稀有精英级） ----------
export const Z_TEXT_UNLOCK_DAY = 7;
export const Z_TEXT_SPAWN_CHANCE = 0.06;
export const TEXT_ZOMBIE_TYPES = {
    remnant: { name: '残名尸', char: '残', hp: 280, speed: 0.22, damage: 18, color: '#7a6b8a', ability: 'scatter', desc: '保留部分旧名，命中时震散玩家背包中的字块' },
    deleter: { name: '删字尸', char: '删', hp: 320, speed: 0.18, damage: 22, color: '#5a3030', ability: 'delete', desc: '命中时删除玩家正在追踪的一个字块' },
    swapper: { name: '换字尸', char: '换', hp: 260, speed: 0.25, damage: 15, color: '#3a5040', ability: 'corrupt', desc: '命中时将玩家一个字块污染为不稳状态' },
    giant: { name: '巨字尸', char: '巨', hp: 1500, speed: 0.08, damage: 45, color: '#8A3A5A', ability: 'stomp', desc: '尸潮首领：高血高伤，击杀必掉传送宝石与稀有字块' },
};
export const Z_TEXT_ABILITY_CHANCE = 0.35;
export const Z_GIANT_UNLOCK_DAY = 3;        // 巨字尸（尸潮首领）最早出现天数
export const Z_GIANT_HORDE_CHANCE = 0.25;   // 每次尸潮刷首领概率

// ---------- 僵尸碰撞属性（接触即伤害，各型差异化） ----------
// dmg 接触伤害 / biteCd 咬击间隔秒 / speedMul 移速倍率 / armor 减伤比例(0~1)
// lunge 扑咬突进像素(0=无) / stunTime 扑咬命中后控制玩家秒 / knockback 击退像素
export const Z_CONTACT = {
    normal:  { dmg: 8,  biteCd: 1.0, speedMul: 1.0,  armor: 0,    lunge: 0,  stunTime: 0,   knockback: 0 },
    cone:    { dmg: 7,  biteCd: 0.9, speedMul: 1.25, armor: 0.10, lunge: 40, stunTime: 0.4, knockback: 0 },
    bucket:  { dmg: 18, biteCd: 1.6, speedMul: 0.65, armor: 0.45, lunge: 0,  stunTime: 0,   knockback: 12 },
    pole:    { dmg: 6,  biteCd: 0.7, speedMul: 1.45, armor: 0,    lunge: 55, stunTime: 0.5, knockback: 0 },
    flag:    { dmg: 4,  biteCd: 1.2, speedMul: 1.1,  armor: 0.05, lunge: 0,  stunTime: 0,   knockback: 0 },
    door:    { dmg: 10, biteCd: 1.4, speedMul: 0.55, armor: 0.55, lunge: 0,  stunTime: 0,   knockback: 24 },
    remnant: { dmg: 14, biteCd: 1.1, speedMul: 0.9,  armor: 0.15, lunge: 0,  stunTime: 0,   knockback: 0 },
    deleter: { dmg: 16, biteCd: 1.3, speedMul: 0.8,  armor: 0.20, lunge: 0,  stunTime: 0,   knockback: 0 },
    swapper: { dmg: 12, biteCd: 0.8, speedMul: 1.3,  armor: 0.05, lunge: 35, stunTime: 0.3, knockback: 0 },
};
export const Z_CONTACT_DIST = 30;
export const Z_LUNGE_TRIGGER_DIST = 90;
export const Z_LUNGE_CD = 4.0;

// 旧接口兼容（渲染/状态机仍引用）
export const Z_ATK_STYLES = {
    normal: { windup: 0.60, dmg: 8, lunge: 0, strikeDist: 30, effect: 'headbutt' },
    cone:   { windup: 0.50, dmg: 7, lunge: 40, strikeDist: 30, effect: 'charge' },
    bucket: { windup: 1.00, dmg: 18, lunge: 0, strikeDist: 30, effect: 'slam' },
    pole:   { windup: 0.42, dmg: 6, lunge: 55, strikeDist: 30, effect: 'thrust' },
    flag:   { windup: 0.75, dmg: 4, lunge: 0, strikeDist: 30, effect: 'rally' },
    door:   { windup: 0.68, dmg: 10, lunge: 0, strikeDist: 30, effect: 'bash' },
    remnant: { windup: 0.80, dmg: 14, lunge: 0, strikeDist: 30, effect: 'scatter' },
    deleter: { windup: 0.90, dmg: 16, lunge: 0, strikeDist: 30, effect: 'delete' },
    swapper: { windup: 0.55, dmg: 12, lunge: 35, strikeDist: 30, effect: 'corrupt' },
    giant:   { windup: 1.30, dmg: 30, lunge: 0, strikeDist: 40, effect: 'slam' },
};

// 招式辅助参数
export const Z_COMBO_GAP = 0.22;        // 连击（撑杆跃刺）两击间隔秒
export const Z_SPLASH_SLOW_TIME = 1.2;  // 铁桶重砸命中后玩家减速时长

// ---------- 野外尸群 ----------
export const PACK_SPAWN_INTERVAL = 45;
export const PACK_SPAWN_INTERVAL_RAND = 30;
export const PACK_MIN_SIZE = 3;
export const PACK_MAX_SIZE = 6;
export const PACK_KING_TYPES = ['bucket', 'door', 'remnant', 'deleter'];
export const PACK_FOLLOW_RANGE = 5;
export const PACK_FOLLOW_SPEED_MUL = 1.1;

// ---------- 生物体型（渲染字号，按物种分大小） ----------
export const Z_BODY = { normal: 11, cone: 11, bucket: 13, pole: 10, flag: 11, door: 13 };
export const PLANT_BODY = 10;
export const PLAYER_BODY = 22;   // 玩家"戴"字字号（TS=36 格，占约 60%）

// ---------- 尸潮 ----------
export const HORDE_START_HOUR = 20;
export const HORDE_END_HOUR = 4;
export const HORDE_BATCH_MIN = 3;
export const HORDE_BATCH_RAND = 3;
export const HORDE_BATCH_INTERVAL_MIN = 3;
export const HORDE_BATCH_INTERVAL_RAND = 2;
export const HORDE_SPAWN_DIST_MIN = 18;
export const HORDE_SPAWN_DIST_RAND = 6;
export const HORDE_COUNT_BASE = 6;
export const HORDE_COUNT_PER_DAY = 2;
export const HORDE_MAX_ONFIELD = 45;   // 尸潮同时在场上限（高天数 total 无上限，超出暂缓下批再放，防卡顿）
export const HORDE_CONE_DAY = 3;
export const HORDE_BUCKET_DAY = 5;

// ---------- 建造 ----------
export const BUILD_RANGE = 3.2;
export const BUILD_COLLIDE_R = 13;
export const DEMOLISH_REFUND = 0.5;

// ---------- 搜刮掉落表 ----------
export const LOOT_WEAPONS = {
    common: ['dagger', 'pistol', 'knife'],
    rare:   ['sword', 'spear', 'bow', 'shotgun'],
    epic:   ['axe', 'smg', 'rifle', 'sniper'],
};
export const LOOT_AMMO = Object.keys(AMMO_INFO);
export const LOOT_WEAPON_CHANCE = 0.15;
export const LOOT_AMMO_CHANCE = 0.34;
export const LOOT_HERB_CHANCE = 0.52;
export const LOOT_WOOD_CHANCE = 0.74;
export const LOOT_FOOD_CHANCE = 0.84;
export const LOOT_FERT_CHANCE = 0.90;
export const LOOT_PART_CHANCE = 0.94;

// ---------- 死亡 ----------
export const SOFT_DEATH_LOSS = 0.3;
export const BED_HEAL = 40;

// ---------- 伐木 ----------
export const CHOP_DEFAULT = 8;
export const CHOP_AXE = 4;
export const CHOP_WOOD_MIN = 2;
export const CHOP_WOOD_RAND = 2;

// ---------- 采矿 ----------
export const MINE_DEFAULT = 3;

// ---------- 饥饿系统 ----------
export const HUNGER_MAX = 100;
export const HUNGER_DRAIN = 0.055;       // 基础每秒消耗（1 现实小时=1 游戏天：1 天约 2 管饱食）
export const HUNGER_SPRINT_DRAIN = 0.11; // 奔跑额外每秒消耗
export const HUNGER_LOW = 30;            // 低于此值开始减速
export const HUNGER_LOW_SPEED = 0.85;    // 饥饿减速倍率
export const HUNGER_STARVE_SPEED = 0.7;  // 挨饿（归零）减速倍率
export const HUNGER_STARVE_DMG = 2;      // 挨饿每秒掉血

// ---------- 水分系统（口渴） ----------
export const WATER_MAX = 100;
export const WATER_DRAIN = 0.05;          // 基础每秒消耗（1 天约 2 管水分）
export const WATER_SPRINT_DRAIN = 0.10;   // 奔跑额外每秒消耗
export const WATER_LOW = 30;              // 低于此值开始减速
export const WATER_LOW_SPEED = 0.9;       // 口渴减速倍率
export const WATER_DEHYDRATE_SPEED = 0.75;// 缺水（归零）减速倍率
export const WATER_DEHYDRATE_DMG = 1.2;   // 缺水每秒掉血（比挨饿慢）

// ---------- 生命恢复 ----------
export const HP_REGEN_NATURAL = 0.5;      // 血量<100% 且有粮有水时的自然缓慢回血 /s
export const HP_REGEN_FED = 2.5;          // 饱食充足时额外回血速度（随饱食 60→100 线性增强） /s
export const HP_REGEN_FED_AT = 60;        // 饱食达到此值启用"进食回血"
export const HP_REGEN_FUEL = 0.45;        // 进食回血额外消耗饱食 /s（以更快消耗饱食换更快回血）

// ---------- 体力恢复（进食/饮水加速） ----------
export const STAM_REGEN_FED_AT = 60;      // 饱食与水分均≥此值时启用"进食回体"
export const STAM_REGEN_FED = 24;         // 额外回体速度 /s（随两者最低值 60→100 线性增强）
export const STAM_REGEN_FUEL = 0.45;      // 加速回体时额外消耗饱食/水分 各 /s

// ---------- 城区要素（M-β） ----------
export const ROAD_SPEED = 1.25;     // 公路移动加速倍率
export const BARRICADE_HP = 150;    // 路障耐久
export const CAR_HP = 260;          // 汽车（掩护体）耐久

// ---------- 车辆燃油 ----------
export const FUEL_MAX = 100;           // 油量上限（单位）
export const FUEL_RANDOM_MIN = 20;     // 车辆自带油量随机下限（%）
export const FUEL_RANDOM_MAX = 75;     // 车辆自带油量随机上限（%）
export const FUEL_USE_RATE = 0.12;     // 行驶每秒消耗（满油约 14 分钟）
export const FUEL_REFILL = 35;         // 每桶汽油补充量
export const FUEL_SPEED_LIMIT = 0.25;  // 没油时速度保留比例

// ---------- 武器耐久（每次挥击/射击 -1；归零损坏，扳手+零件可修） ----------
export const WEAPON_DUR = {
    dagger: 40, sword: 35, spear: 40, axe: 30,             // 近战（拳头/铲子 ∞）
    pistol: 200, shotgun: 120, smg: 250, rifle: 250, sniper: 80, bow: 150, knife: 160,
};
export const WEAPON_REPAIR_PARTS = 2;  // 修复损坏武器消耗零件

// ---------- 领地旗帜（营地由旗帜确立；开局无营地） ----------
export const CAMP_RADIUS = 8;          // 领地范围（格）
export const CAMP_HP_REGEN = 0.8;      // 领地内每秒回血
export const CAMP_STAM_MUL = 1.5;      // 领地内体力恢复倍率
export const CAMP_SPEED_MUL = 1.05;    // 领地内移速倍率
export const CAMP_SPAWN_SKIP = 1;      // 领地内敌对生物生成直接跳过（减少生成）

// ---------- 植物生长 / 驯服（M6） ----------
export const PLANT_GROW = 2.0;          // 生长速度：growth/秒（上限100）
export const TAME_BASE = 0.9;           // 驯服基础成功率（幼苗）
export const TAME_STAGE_PENALTY = 0.25; // 每升一阶成功率降低

// ---------- 尸潮奖励 ----------
export const REWARD_WEAPON_DAY = 3;
export const REWARD_WEAPON_CHANCE = 0.4;
export const REWARD_EPIC_DAY = 5;
export const REWARD_EPIC_CHANCE = 0.3;

// ---------- 楼层系统（M-γ，待开发，数值先收口） ----------
// 决策点 ④ 已定：地上3层 + 地下2层，中曲线；地下层仅学校/医院/仓库
export const FLOOR_MAX_ABOVE = 3;      // 地上层数上限（第1层为入口层）
export const FLOOR_MAX_BELOW = 2;      // 地下层数上限（cur 为负）
export const FLOOR_BASEMENT_TYPES = ['school', 'hospital', 'warehouse']; // 可有地下层的建筑类型（对应未来 BUILDING_TYPES.type）
// 难度曲线：cur=层号（地上从1起，地下从-1起），|cur| 越大越深；地下层掉落品质+1档
export const FLOOR_ZOMBIE_MUL = cur => 1 + 0.20 * (Math.abs(cur) - 1); // 每层僵尸数量倍率
export const FLOOR_HP_MUL     = cur => 1 + 0.15 * (Math.abs(cur) - 1); // 每层僵尸血量倍率
export const FLOOR_DROP_BUMP  = cur => cur < 0 ? 1 : 0;                // 地下层掉落品质+1档（common->rare->epic）

// ---------- 货币与物品价值（NPC 交易按价值定价） ----------
export const COIN_ID = 'coin';
export const ITEM_VALUE = {
    food: 5, water: 5, herb: 8, wood: 3, stone: 4, part: 12, gem: 50, tpgem: 80,
    sun: 3, fert: 6, coin: 1, carrot: 6, corn: 6, potato: 6,
};
export function itemValue(id) {
    if (ITEM_VALUE[id] != null) return ITEM_VALUE[id];
    if (id.startsWith('wpn:')) {
        const w = WEAPONS[id.slice(4)];
        const base = w ? ({ common: 30, rare: 65, epic: 130 }[w.rarity] || 30) : 30;
        return base;
    }
    if (id.startsWith('ammo:')) return 4;
    if (id.startsWith('seed:')) return 15;
    if (id.startsWith('loot:')) return 20;
    return 2;   // 兜底
}
export const TRADE_MARKUP = 1.3;     // NPC 卖价倍率（玩家买入价）
export const TRADE_DISCOUNT = 0.6;   // NPC 收购倍率（玩家卖出价）

// ---------- 年龄系统（生老病死；主角与 NPC 一视同仁） ----------
export const AGE_STAGES = [
    { min: 0,  name: '幼年', hpMul: 0.70, speedMul: 0.90, atkMul: 0.60 },
    { min: 5,  name: '少年', hpMul: 0.85, speedMul: 0.95, atkMul: 0.80 },
    { min: 15, name: '青年', hpMul: 1.00, speedMul: 1.00, atkMul: 1.00 },
    { min: 40, name: '中年', hpMul: 1.05, speedMul: 1.00, atkMul: 1.00 },
    { min: 60, name: '老年', hpMul: 0.90, speedMul: 0.92, atkMul: 0.85 },
    { min: 75, name: '暮年', hpMul: 0.75, speedMul: 0.80, atkMul: 0.70 },
];
export function ageStage(age) {
    let stage = AGE_STAGES[0];
    for (const s of AGE_STAGES) if (age >= s.min) stage = s;
    return stage;
}
export function ageSpeedMul(age) { return ageStage(age).speedMul; }
// 每日自然死亡概率：60 岁起逐渐升高
export function ageDeathChance(age) {
    if (age < 60) return 0;
    return Math.min(0.3, (age - 60) * 0.008);
}
// 营地新生命：满足条件时每日概率
export const BIRTH_DAILY_CHANCE = 0.02;
export const BIRTH_CAMP_MIN = 2;      // 营地至少 2 名友善成员才可能添丁
// 营地刷新：营地是 NPC 居住地，每日有概率来新的成年居民（有阵营归属 campId）
export const CAMP_NEWCOMER_DAILY_CHANCE = 0.25;   // 每日来新居民概率
export const CAMP_NEWCOMER_RADIUS = 8;            // 新居民出生在营地范围内（格）

// ---------- 生病系统 ----------
// drain：每小时生命流失（游戏小时，未及时治疗几天内致命）；cure：治愈所需草药数（痢疾需同时有水）
export const SICKNESS = {
    cold:      { name: '感冒',     drain: 0.8, cure: 1, desc: '夜间/受寒受凉，虚弱乏力' },
    wound:     { name: '伤口感染', drain: 1.6, cure: 2, desc: '受伤未及时处理，持续失血' },
    poison:    { name: '食物中毒', drain: 1.2, cure: 1, desc: '吃了不干净的东西，又吐又泻' },
    dysentery: { name: '痢疾',     drain: 1.8, cure: 2, desc: '不洁饮水导致，需草药+足量水分' },
    heatstroke:{ name: '中暑',     drain: 1.0, cure: 1, desc: '高温暴晒/缺水导致，头晕乏力' },
};
export function sickDrainPerSec(type) {
    const s = SICKNESS[type];
    return s ? s.drain / 24 / 3600 : 0;   // 每小时流失（一天 24 游戏小时）
}
// 患病概率（每日判定；夜间=20:00-6:00，暴晒=10:00-16:00）
export function isNightHour(sv) {
    const h = (sv.t / sv.dayLen) * 24;
    return h >= 20 || h < 6;
}
export const SICK_COLD_CHANCE = 0.06;        // 夜间户外 或 水分<30
export const SICK_POISON_CHANCE = 0.06;      // 挨饿（食物归零）时
export const SICK_DYSENTERY_CHANCE = 0.10;   // 缺水归零时
export const SICK_HEAT_CHANCE = 0.05;        // 白天 10-16 点且水分<40
export const SICK_WOUND_CHANCE = 0.04;       // 每次受击
// 疾病对应药品（med:xxx；抗生素可治任意）
export const SICK_MED = { cold: 'med:cold', wound: 'med:wound', poison: 'med:poison', dysentery: 'med:dysentery', heatstroke: 'med:heat' };
// 疾病 UI 配色（HUD/世界标记/小人晕染）
export const SICK_COLORS = {
    cold: '#7AD6FF', wound: '#FF5544', poison: '#9AE88A', dysentery: '#C8A24A', heatstroke: '#FFB347',
};
export function sickColor(type) { return SICK_COLORS[type] || '#FF8866'; }

// ---------- 角色属性（随机 + 先天 + 后天） ----------
export const ATTRIB_KEYS = ['str', 'con', 'agi', 'int'];
export const ATTRIB_NAMES = { str: '力量', con: '体质', agi: '敏捷', int: '智力' };
export function rollAttrib() {   // 3d6：3~18
    return 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6);
}
export function attribBonus(v) { return (v - 10) * 0.03; }   // 每超/欠 10 的 ±3%

// 先天天赋（约 25% 概率获得其一）
export const TALENTS = {
    strong:     { name: '天生神力', str: 3, desc: '力量 +3' },
    tough:      { name: '铁打身体', con: 3, desc: '体质 +3，更抗病' },
    swift:      { name: '飞毛腿',   agi: 3, desc: '敏捷 +3' },
    smart:      { name: '聪明绝顶', int: 3, desc: '智力 +3，交易更划算' },
    hardy:      { name: '百毒不侵', resist: 1, desc: '染病概率减半' },
    lucky:      { name: '幸运儿',   luck: 1, desc: '搜刮更易出好东西' },
    marksman:   { name: '神射手',   ranged: 1, desc: '远程伤害 +10%' },
    nightowl:   { name: '夜行者',   night: 1, desc: '夜间移速 +10%' },
    herbalist:  { name: '草药师',   herb: 1, desc: '草药效果翻倍' },
    ironstomach:{ name: '铁胃',     resistPoison: 1, desc: '食物中毒免疫' },
};
export const TALENT_KEYS = Object.keys(TALENTS);

// 先天疾病（约 15% 概率，慢性不可愈，伴随一生）
export const CONGENITAL = {
    asthma:     { name: '哮喘',     stamMaxMul: 0.90, speedMul: 0.90, desc: '耐力上限 -10%，移动速度 -10%' },
    heart:      { name: '心脏病',   stamMaxMul: 0.75, desc: '耐力上限 -25%' },
    diabetes:   { name: '糖尿病',   hungerMul: 1.3,  desc: '饱食消耗 +30%' },
    arthritis:  { name: '关节炎',   stamMul: 0.85,  speedMul: 0.90, desc: '体力恢复 -15%，移动速度 -10%' },
    immune:     { name: '免疫缺陷', sickMul: 1.5,   desc: '染病概率 ×1.5' },
    anemia:     { name: '贫血',     maxHpMul: 0.92, stamMul: 0.90, desc: '血量上限 -8%，体力恢复 -10%' },
    nightblind: { name: '夜盲',     nightSpeedMul: 0.88, desc: '夜间移动速度 -12%' },
};
export const CONGENITAL_KEYS = Object.keys(CONGENITAL);

// ---------- 野外作物再生（M-ζ 补充，决策点 ③ 已定） ----------
// 采集后作物消失，该地块按 seed 在 N 天后可再生；存档记 sv.mods.crops{tileKey: 采集时天数}
export const CROP_REGEN_DAYS = 3;      // 作物再生所需天数
