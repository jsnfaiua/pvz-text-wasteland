// ============================================================
// 全局常量定义
// ============================================================

// 战场配置
export const FIELD = {
    left: 60,
    right: 960 - 40,
    top: 40,
    bottom: 540 - 40,
    rows: 5,
    activeRows: [0, 1, 2, 3, 4],
};
FIELD.rowHeight = (FIELD.bottom - FIELD.top) / FIELD.rows;

// 动作参数
export const ACTION = {
    dashSpeed: 900,
    dashDuration: 0.16,
    dashInvuln: 0.22,
    dashCooldown: 0.8,
    guardPerfectMs: 0.30,
    guardCooldown: 0.25,
    perfectReflectMul: 1.5,
    perfectStunTime: 1.0,
};

// 物理常量
export const GRAVITY = 1400;
export const JUMP_VELOCITY = 520;
export const JUMP_CD = 0.8;
export const MIN_PLANT_DIST = 60;

// 植物图鉴
export const PLANTS = {
    sunflower: {
        name: '向日葵', cost: 50, cooldown: 7.5, hp: 300, color: '#FFD700',
        produceInterval: 24, rarity: 'common',
    },
    peashooter: {
        name: '豌豆射手', cost: 100, cooldown: 7.5, hp: 300, color: '#00FF00',
        fireInterval: 1.5, range: FIELD.right, bulletDamage: 20,
        rarity: 'common',
    },
    wallnut: {
        name: '坚果', cost: 50, cooldown: 30, hp: 4000, color: '#C89060',
        rarity: 'rare',
    },
    cherry: {
        name: '樱桃', cost: 150, cooldown: 50, hp: 9999, color: '#DC143C',
        fuse: 1.0, blastRadius: 130, blastDamage: 1800,
        rarity: 'epic',
    },
    potatomine: {
        name: '土豆雷', cost: 25, cooldown: 30, hp: 300, color: '#C89060',
        fuse: 14, blastRadius: 100, blastDamage: 1800, armed: false,
        rarity: 'rare',
    },
    snowpea: {
        name: '寒冰射手', cost: 175, cooldown: 7.5, hp: 300, color: '#00CCFF',
        fireInterval: 1.5, range: FIELD.right, bulletDamage: 20, slowAmount: 0.5, slowDuration: 5,
        rarity: 'rare',
    },
    chomper: {
        name: '大嘴花', cost: 150, cooldown: 45, hp: 300, color: '#CC44FF',
        killRange: 160, digestTime: 42, rarity: 'rare',
    },
    repeater: {
        name: '双发射手', cost: 200, cooldown: 7.5, hp: 300, color: '#00DD00',
        fireInterval: 1.5, range: FIELD.right, bulletDamage: 20, burstCount: 2,
        rarity: 'rare',
    },
};

export const CARD_ORDER = ['sunflower','peashooter','wallnut','cherry','potatomine','snowpea','chomper','repeater'];

// 僵尸类型 → 碎片权重
export const ZOMBIE_FRAG_WEIGHTS = {
    normal:  { sunflower: 40, peashooter: 40, wallnut: 15, cherry: 5 },
    cone:    { sunflower: 30, peashooter: 30, wallnut: 25, cherry: 15 },
    bucket:  { sunflower: 20, peashooter: 25, wallnut: 25, cherry: 30 },
    flag:    { sunflower: 35, peashooter: 35, wallnut: 20, cherry: 10 },
    pole:    { sunflower: 30, peashooter: 25, wallnut: 25, cherry: 20 },
    door:    { sunflower: 20, peashooter: 30, wallnut: 20, cherry: 30 },
};

// 掉落配置
export const DROP_TABLE = {
    normal: {
        silver:   { chance: 0.40, min: 1, max: 3 },
        gold:     { chance: 0.03, min: 1, max: 1 },
        gem:      { chance: 0.00, min: 0, max: 0 },
        heal:     { chance: 0.05 },
        fragment: { chance: 0.03, min: 1, max: 1 },
        card:     { chance: 0.02 },
        wfrag:    { chance: 0.04, min: 1, max: 1 },
    },
    cone: {
        silver:   { chance: 0.60, min: 2, max: 5 },
        gold:     { chance: 0.15, min: 1, max: 2 },
        gem:      { chance: 0.005, min: 1, max: 1 },
        heal:     { chance: 0.10 },
        fragment: { chance: 0.08, min: 1, max: 2 },
        card:     { chance: 0.05 },
        wfrag:    { chance: 0.10, min: 1, max: 2 },
    },
    bucket: {
        silver:   { chance: 0.80, min: 3, max: 8 },
        gold:     { chance: 0.35, min: 2, max: 5 },
        gem:      { chance: 0.02, min: 1, max: 1 },
        heal:     { chance: 0.20 },
        fragment: { chance: 0.15, min: 1, max: 3 },
        card:     { chance: 0.10 },
        wfrag:    { chance: 0.20, min: 1, max: 3 },
    },
    door: {
        silver:   { chance: 0.70, min: 3, max: 6 },
        gold:     { chance: 0.25, min: 2, max: 4 },
        gem:      { chance: 0.01, min: 1, max: 1 },
        heal:     { chance: 0.15 },
        fragment: { chance: 0.12, min: 1, max: 2 },
        card:     { chance: 0.08 },
        wfrag:    { chance: 0.15, min: 1, max: 2 },
    },
};

// 僵尸图鉴
// 僵尸图鉴（血量对齐原版 PvZ1：普僵 270 / 路障 270+370=640 / 铁桶 270+1100=1370 /
// 旗帜 270 / 撑杆 500 / 铁门 270+1100=1370）
export const ZOMBIES = {
    normal:  { name: '僵尸',     hp: 200,  armorHp: 0,    speed: 20, color: '#B0B0B0', damage: 100, rarity: 'common' },
    cone:    { name: '路障僵尸', hp: 200,  armorHp: 370,  speed: 20, color: '#FFA500', damage: 100, rarity: 'common' },
    bucket:  { name: '铁桶僵尸', hp: 200,  armorHp: 1100, speed: 20, color: '#909090', damage: 100, rarity: 'rare' },
    flag:    { name: '旗帜僵尸', hp: 200,  armorHp: 0,    speed: 20, color: '#CC4444', damage: 100, rarity: 'common' },
    pole:    { name: '撑杆僵尸', hp: 335,  armorHp: 0,    speed: 34, color: '#EEEEEE', damage: 100, rarity: 'common', jumper: true },
    door:    { name: '铁门僵尸', hp: 200,  armorHp: 1100, speed: 20, color: '#8B4513', damage: 100, rarity: 'rare' },
};

// 武器图鉴
export const WEAPONS = {
    pistol: {
        name: '手枪', kind: 'ranged', damage: 22, fireInterval: 0.38, stamina: 2,
        bulletSpeed: 500, ammoType: 'pistolAmmo', ammoLabel: '9mm手枪弹',
        range: 320, penArmor: 1.0,
        magSize: 15, reloadTime: 1.2, modes: ['semi'],
        color: '#B0C4DE', bulletLabel: '·', rarity: 'common',
    },
    shotgun: {
        name: '散弹枪', kind: 'ranged', damage: 18, pellets: 3, spread: 0.30, stamina: 5,
        fireInterval: 1.0, bulletSpeed: 460, ammoType: 'shellAmmo',
        range: 220, penArmor: 1.3,
        magSize: 7, reloadTime: 2.0, modes: ['semi'],
        ammoLabel: '12号霰弹', color: '#DAA520', bulletLabel: '․', rarity: 'rare',
    },
    dagger: {
        name: '短剑', kind: 'melee', damage: 24, fireInterval: 0.38, reach: 37, stamina: 6,
        arc: Math.PI * 0.45, attackStyle: 'stab', penArmor: 0.9, ammoType: 'durability', ammoLabel: '耐久',
        maxDurability: 15, color: '#C0C0C0', rarity: 'common',
    },
    fist: {
        name: '拳头', kind: 'melee', damage: 16, fireInterval: 0.35, reach: 32, stamina: 5,
        arc: Math.PI * 0.45, attackStyle: 'punch', penArmor: 0.6, ammoType: 'infinite', ammoLabel: '∞',
        color: '#FFCC99', rarity: 'common',
    },
    sword: {
        name: '长剑', kind: 'melee', damage: 62, fireInterval: 0.6, reach: 46, stamina: 12,
        arc: Math.PI * 0.6, attackStyle: 'slash', penArmor: 1.3, ammoType: 'durability', ammoLabel: '耐久',
        maxDurability: 10, color: '#E5E5E5', rarity: 'rare',
    },
    smg: {
        name: '冲锋枪', kind: 'ranged', damage: 13, fireInterval: 0.15, stamina: 1,
        autoInterval: 0.1,
        bulletSpeed: 520, ammoType: 'smgAmmo', ammoLabel: '9mm冲锋枪弹',
        range: 350, penArmor: 1.0,
        spread: 0.10,
        magSize: 30, reloadTime: 1.8, modes: ['semi', 'auto'], defaultMode: 'auto',
        color: '#ADFF2F', bulletLabel: '·', rarity: 'epic',
    },
    rifle: {
        name: '步枪', kind: 'ranged', damage: 26, fireInterval: 0.18, stamina: 4,
        autoInterval: 0.20,
        bulletSpeed: 700, ammoType: 'rifleAmmo', ammoLabel: '7.62mm步枪弹',
        range: 480, penArmor: 1.8, pierce: 1,
        spread: 0.06,
        magSize: 30, reloadTime: 2.2, modes: ['semi', 'auto'], defaultMode: 'auto',
        color: '#66CC99', bulletLabel: '·', rarity: 'epic',
    },
    sniper: {
        name: '狙击枪', kind: 'ranged', damage: 165, fireInterval: 1.5, stamina: 8,
        bulletSpeed: 900, ammoType: 'sniperAmmo', ammoLabel: '狙击弹',
        range: 900, penArmor: 2.5, pierce: 3,
        spread: 0.12, aimFactor: 0.05, scope: true, zoom: 1.35,
        magSize: 5, reloadTime: 3.0, modes: ['semi'],
        color: '#8A2BE2', bulletLabel: '—', rarity: 'epic',
    },
    bow: {
        name: '弓箭', kind: 'ranged', damage: 40, fireInterval: 0.6, stamina: 6,
        bulletSpeed: 600, ammoType: 'arrowAmmo', ammoLabel: '箭矢',
        range: 480, penArmor: 0.8,
        chargeable: true, maxCharge: 1.0, magSize: 1, reloadTime: 0.8, modes: ['semi'],
        color: '#DEB887', bulletLabel: '→', rarity: 'rare',
    },
    knife: {
        name: '飞刀', kind: 'ranged', damage: 25, fireInterval: 0.4, stamina: 3,
        bulletSpeed: 550, ammoType: 'knifeAmmo', ammoLabel: '飞刀',
        spin: true,
        range: 300, penArmor: 0.8,
        magSize: 6, reloadTime: 1.0, modes: ['semi'],
        color: '#C0C0C0', bulletLabel: '刀', rarity: 'common',
    },
    spear: {
        name: '长矛', kind: 'melee', damage: 50, fireInterval: 0.55, reach: 82, stamina: 10,
        arc: Math.PI * 0.25, attackStyle: 'thrust', penArmor: 1.4, ammoType: 'durability', ammoLabel: '耐久',
        maxDurability: 12, color: '#D2B48C', rarity: 'rare',
    },
    axe: {
        name: '战斧', kind: 'melee', damage: 95, fireInterval: 0.9, reach: 38, stamina: 15,
        arc: Math.PI * 0.55, attackStyle: 'chop', penArmor: 1.8, ammoType: 'durability', ammoLabel: '耐久',
        maxDurability: 8, color: '#A0522D', rarity: 'epic',
    },
    shovel: {
        name: '铲子', kind: 'melee', damage: 14, fireInterval: 0.35, reach: 38, stamina: 5,
        arc: Math.PI * 0.4, attackStyle: 'dig', penArmor: 0.5, ammoType: 'infinite', ammoLabel: '∞',
        color: '#B87333', canDigPlant: true, digRefundRate: 0.5,
        rarity: 'common',
    },
};

export const WEAPON_FRAG_WEIGHTS = {
    normal:  { pistol: 30, dagger: 30, knife: 25, shotgun: 10, bow: 5 },
    cone:    { pistol: 25, dagger: 20, knife: 20, shotgun: 20, spear: 10, bow: 5 },
    bucket:  { pistol: 10, dagger: 10, knife: 10, shotgun: 25, sword: 15, spear: 10, axe: 10, rifle: 5, bow: 5, sniper: 3 },
    flag:    { pistol: 25, dagger: 20, knife: 15, shotgun: 15, spear: 10, bow: 10, sword: 5 },
    pole:    { pistol: 20, dagger: 15, knife: 15, shotgun: 20, spear: 10, bow: 10, smg: 5, sword: 5 },
    door:    { pistol: 10, dagger: 10, knife: 10, shotgun: 20, sword: 15, axe: 10, rifle: 10, smg: 5, sniper: 4 },
};

export const WEAPON_META = {
    pistol:  { fragKey: 'pistol',  fragLabel: '枪片', unlockCost: 15, baseDurability: 40 },
    shotgun: { fragKey: 'shotgun', fragLabel: '壳片', unlockCost: 25, baseDurability: 20 },
    dagger:  { fragKey: 'dagger',  fragLabel: '剑片', unlockCost: 10, baseDurability: 30 },
    sword:   { fragKey: 'sword',   fragLabel: '锋片', unlockCost: 20, baseDurability: 22 },
    knife:   { fragKey: 'knife',   fragLabel: '刀片', unlockCost: 12, baseDurability: 30 },
    spear:   { fragKey: 'spear',   fragLabel: '矛片', unlockCost: 18, baseDurability: 25 },
    bow:     { fragKey: 'bow',     fragLabel: '箭片', unlockCost: 22, baseDurability: 25 },
    axe:     { fragKey: 'axe',     fragLabel: '斧片', unlockCost: 28, baseDurability: 18 },
    rifle:   { fragKey: 'rifle',   fragLabel: '步片', unlockCost: 30, baseDurability: 30 },
    smg:     { fragKey: 'smg',     fragLabel: '冲片', unlockCost: 35, baseDurability: 50 },
    sniper:  { fragKey: 'sniper',  fragLabel: '镜片', unlockCost: 40, baseDurability: 20 },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper', 'shotgun', 'bow', 'knife', 'dagger', 'spear', 'axe', 'sword'];

// 弹药类型（商店购买/局内备弹共用）
export const AMMO_INFO = {
    pistolAmmo: { label: '9mm手枪弹',   pack: 30, price: { silver: 40 } },
    smgAmmo:    { label: '9mm冲锋枪弹', pack: 60, price: { silver: 60 } },
    rifleAmmo:  { label: '7.62mm步枪弹', pack: 30, price: { silver: 50 } },
    sniperAmmo: { label: '狙击弹',       pack: 10, price: { silver: 80 } },
    shellAmmo:  { label: '12号霰弹',    pack: 12, price: { silver: 60 } },
    arrowAmmo:  { label: '箭矢',        pack: 25, price: { silver: 45 } },
    knifeAmmo:  { label: '飞刀',        pack: 15, price: { silver: 35 } },
};
export const WEAPON_LEVEL_MUL = [1, 1, 1, 1, 1, 1]; // 武器暂不开放升级，倍率恒 1

// 难度参数
export const DIFFICULTY_PRESETS = {
    easy:   { hpMul: 0.7,  speedMul: 0.85, countMul: 0.6, intervalMul: 1.5, restMul: 1.4, initialSun: 100, dropRateMul: 0.7, rewardMul: 0.5, attackSpeedMul: 1.35 },
    normal: { hpMul: 1.0,  speedMul: 1.0,  countMul: 1.0, intervalMul: 1.0, restMul: 1.0, initialSun: 50,  dropRateMul: 1.0, rewardMul: 1.0, attackSpeedMul: 1.0  },
    hard:   { hpMul: 1.4,  speedMul: 1.15, countMul: 1.3, intervalMul: 0.75, restMul: 0.75, initialSun: 50,  dropRateMul: 1.3, rewardMul: 1.5, attackSpeedMul: 0.95 },
    hell:   { hpMul: 2.0,  speedMul: 1.4,  countMul: 1.6, intervalMul: 0.5, restMul: 0.5, initialSun: 50,  dropRateMul: 1.8, rewardMul: 2.5, attackSpeedMul: 0.85 },
};

export let DIFFICULTY = { ...DIFFICULTY_PRESETS.normal };
export let currentDifficulty = 'normal';

export function setDifficulty(name) {
    if (DIFFICULTY_PRESETS[name]) {
        DIFFICULTY = { ...DIFFICULTY_PRESETS[name] };
        currentDifficulty = name;
    }
}

export const LEVEL_REWARDS = {
    '1-1':  { type: 'plant', id: 'sunflower',  name: '向日葵',     label: '葵', desc: '生产阳光，战场经济的核心' },
    '1-2':  { type: 'plant', id: 'cherry',      name: '樱桃炸弹',   label: '樱', desc: '瞬间清场，对大群僵尸造成毁灭性伤害' },
    '1-3':  { type: 'plant', id: 'wallnut',     name: '坚果墙',     label: '坚', desc: '高血量护盾，阻挡僵尸掩护后排' },
    '1-4':  { type: 'tool',  id: 'shovel',      name: '铲子',       label: '铲', desc: '可铲除植物并返还50%阳光' },
    '1-5':  { type: 'plant', id: 'potatomine',  name: '土豆地雷',   label: '雷', desc: '廉价的延时炸弹，武装后触发即爆' },
    '1-6':  { type: 'plant', id: 'snowpea',      name: '寒冰射手',   label: '冰', desc: '发射冰豌豆，减速僵尸40%' },
    '1-7':  { type: 'plant', id: 'chomper',      name: '大嘴花',     label: '嘴', desc: '一口吞掉前方最近僵尸，消化45秒' },
    '1-8':  { type: 'plant', id: 'repeater',     name: '双发射手',   label: '双', desc: '一次发射两颗豌豆，伤害翻倍' },
    '1-9':  { type: 'none',  id: null,           name: '戴夫纸条',   label: '信', desc: '戴夫的留言，无实用奖励' },
    '1-10': { type: 'plant', id: 'lilypad',      name: '睡莲',       label: '莲', desc: '可在水面上种植其他植物（暂未实装）' },
};

// 关卡定义
export const LEVELS = [
    { id: '1-1',  name: '初遇僵尸', waves: 5, rows: [2],
        desc: '第一次遭遇僵尸。种植<span class="g">豌豆射手</span>抵御来犯。',
        zombiePool: ['normal','normal','normal','flag'], firstSun: 100,
        allowedCards: ['peashooter'],
        diffMod: { hpMul: 0.70, speedMul: 0.85, countMul: 0.50, intervalMul: 1.50, restMul: 1.40 } },
    { id: '1-2',  name: '援军到来', waves: 10, rows: [1,2,3],
        desc: '前方发现<span class="k">路障僵尸</span>！用<span class="g">向日葵</span>筹集阳光。',
        zombiePool: ['normal','normal','cone','flag'], firstSun: 75,
        allowedCards: ['sunflower','peashooter'],
        diffMod: { hpMul: 0.85, speedMul: 0.92, countMul: 0.65, intervalMul: 1.20, restMul: 1.20 } },
    { id: '1-3',  name: '突破防线', waves: 10, rows: [0,1,2,3,4],
        desc: '<span class="k">撑杆僵尸</span>会跳过前排！用<span class="r">樱桃</span>清场。',
        zombiePool: ['normal','normal','cone','flag','pole'], firstSun: 50,
        allowedCards: ['sunflower','peashooter','cherry'],
        diffMod: { hpMul: 0.85, speedMul: 0.92, countMul: 0.65, intervalMul: 1.20, restMul: 1.20 } },
    { id: '1-4',  name: '坚守阵地', waves: 15, rows: [0,1,2,3,4],
        desc: '全类型集结！用<span class="g">坚果墙</span>构筑防线，铲子回收植物。',
        zombiePool: ['normal','cone','cone','flag','pole'], firstSun: 50,
        allowedCards: ['sunflower','peashooter','cherry','wallnut'],
        diffMod: { hpMul: 1.00, speedMul: 1.00, countMul: 0.90, intervalMul: 1.00, restMul: 1.00 } },
    { id: '1-5',  name: '草坪终战', waves: 20, rows: [0,1,2,3,4],
        desc: '大波僵尸来袭。获得<span class="r">土豆地雷</span>——廉价大范围清场神器。',
        zombiePool: ['normal','normal','cone','cone','flag'], firstSun: 50,
        allowedCards: ['sunflower','peashooter','cherry','wallnut'],
        diffMod: { hpMul: 1.00, speedMul: 1.00, countMul: 0.90, intervalMul: 1.00, restMul: 1.00 } },
    { id: '1-6',  name: '冰霜初现', waves: 20, rows: [0,1,2,3,4],
        desc: '<span class="k">铁桶僵尸</span>登场！用<span class="g">寒冰射手</span>减速控场。',
        zombiePool: ['normal','cone','pole','bucket','flag'], firstSun: 50,
        allowedCards: ['sunflower','peashooter','cherry','wallnut','potatomine'],
        diffMod: { hpMul: 1.00, speedMul: 1.00, countMul: 1.00, intervalMul: 0.95, restMul: 0.95 } },
    { id: '1-7',  name: '铜墙铁壁', waves: 20, rows: [0,1,2,3,4],
        desc: '<span class="k">铁门僵尸</span>登场！用<span class="g">大嘴花</span>秒杀高防敌人。',
        zombiePool: ['normal','cone','pole','bucket','door','flag'], firstSun: 50,
        allowedCards: ['sunflower','peashooter','cherry','wallnut','potatomine','snowpea'],
        diffMod: { hpMul: 1.00, speedMul: 1.00, countMul: 1.00, intervalMul: 0.95, restMul: 0.95 } },
    { id: '1-8',  name: '双倍火力', waves: 25, rows: [0,1,2,3,4],
        desc: '高压关卡。获得<span class="g">双发射手</span>——一次两发，火力翻倍！',
        zombiePool: ['cone','pole','bucket','door','flag'], firstSun: 50,
        allowedCards: ['sunflower','peashooter','cherry','wallnut','potatomine','snowpea','chomper'],
        diffMod: { hpMul: 1.05, speedMul: 1.05, countMul: 1.10, intervalMul: 0.85, restMul: 0.85 } },
    { id: '1-9',  name: '全面战争', waves: 25, rows: [0,1,2,3,4],
        desc: '<span class="r">大关最终考验！</span>全部高阶僵尸倾巢而出。',
        zombiePool: ['cone','cone','bucket','door','pole','flag'], firstSun: 50,
        allowedCards: ['sunflower','peashooter','cherry','wallnut','potatomine','snowpea','chomper','repeater'],
        diffMod: { hpMul: 1.05, speedMul: 1.05, countMul: 1.10, intervalMul: 0.85, restMul: 0.85 } },
    { id: '1-10', name: '传送带-1', waves: 30, rows: [0,1,2,3,4],
        desc: '传送带关卡！随机获得植物，考验临场应变。',
        zombiePool: ['normal','cone','bucket','door','pole','flag'], firstSun: 100,
        allowedCards: ['sunflower','peashooter','cherry','wallnut','potatomine','snowpea','chomper','repeater'],
        diffMod: { hpMul: 1.00, speedMul: 1.00, countMul: 0.70, intervalMul: 1.20, restMul: 1.20 } },
];

// 升级系统
export const LEVEL_TABLE = [
    { lv: 1, cumulative: 0,   mul: 1.00, label: 'Lv1' },
    { lv: 2, cumulative: 30,  mul: 1.10, label: 'Lv2' },
    { lv: 3, cumulative: 80,  mul: 1.20, label: 'Lv3' },
    { lv: 4, cumulative: 130, mul: 1.35, label: 'Lv4' },
    { lv: 5, cumulative: 210, mul: 1.50, label: 'Lv5 觉醒' },
];

export const PLANT_LEVEL_STAT = {
    sunflower:   { field: 'produceRate', label: '产阳光速度', base: 24, invert: true },
    peashooter:  { field: 'damage',      label: '豌豆伤害',    base: 20 },
    wallnut:     { field: 'hp',          label: '血量',        base: 4000 },
    cherry:      { field: 'radius',      label: '爆炸半径',    base: 130 },
    potatomine:  { field: 'blastDamage', label: '爆炸伤害',    base: 1800 },
    snowpea:     { field: 'damage',      label: '豌豆伤害',    base: 20 },
    chomper:     { field: 'killRange',   label: '吞噬范围',    base: 160 },
    repeater:    { field: 'damage',      label: '豌豆伤害',    base: 20 },
};

// 拾取物定义
export const ARMOR_DEFS = {
    cone:   { name: '路障头盔', baseArmor: 150, dropRatio: 0.2, color: '#FFA500', type: 'helmet' },
    bucket: { name: '铁桶头盔', baseArmor: 700, dropRatio: 0.2, color: '#909090', type: 'helmet' },
    door:   { name: '铁门护盾', baseArmor: 500, dropRatio: 0.2, color: '#8B4513', type: 'shield' },
};

export const PICKUP_DEFS = {
    silver:   { label: '银', color: '#C0C0C0', shadow: '#909090' },
    gold:     { label: '金', color: '#FFD700', shadow: '#FFA500' },
    gem:      { label: '钻', color: '#66FFFF', shadow: '#00CCFF' },
    heal:     { label: '药', color: '#FF6688', shadow: '#FF3366' },
    fragment: { label: '片', color: '#AA88FF', shadow: '#7755CC' },
    card:     { label: '卡', color: '#00FFAA', shadow: '#00FF88' },
    wfrag:    { label: '械', color: '#FFCC66', shadow: '#CC9933' },
    armor:    { label: '甲', color: '#FFA500', shadow: '#CC7700' },
};

// 难度提示
export const DIFFICULTY_TIPS = {
    easy:   '简单：敌方弱化，植物攻速 1.35× · 奖励减半',
    normal: '普通：敌方标准 · 奖励标准',
    hard:   '困难：敌方加强 · 奖励 1.5× · 掉率 1.3×',
    hell:   '地狱：敌方强化 · 奖励 2.5× · 掉率 1.8×',
};

// Canvas相关
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;
