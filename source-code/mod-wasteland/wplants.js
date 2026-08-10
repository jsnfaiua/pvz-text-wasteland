// ============================================================
// 【无尽植僵荒原】模组 · 中立植物生态 + 培养/驯服系统（M6）
// 品种引用本体 PLANTS 表名称/颜色；数值按荒原比例缩放。
// 生长系统：植物有 growth(0~100)，分幼苗/成长/成熟三阶，体型越大伤害/血量越高。
//   野生植物按种子确定初始生长度，随时间缓慢长大。
// 驯服：F 对中立植物消耗食物尝试驯服，体型越大越难驯服；失败会激怒它。
// 数据存 sv.mods.plants { "gx,gy": { hp,maxHp,type,species,growth,atkT,hostile,sunT } }
//   type: 'neutral' 中立 / 'tamed' 驯服(友方) / 'player' 玩家培养(友方)
// ============================================================

import { PLANTS } from '../core/constants.js';
import { T, getTile, setTile, hash2 } from './world.js';
import { TS } from './wconst.js';
import AudioSystem from '../systems/audio.js';
import * as B from './wbalance.js';

// ---------- 荒原植物品种表（引用本体 PLANTS 名称/颜色，数值适配大世界） ----------
export const WILD_SPECIES = {
    peashooter: {
        name: PLANTS.peashooter.name, char: '豌', color: PLANTS.peashooter.color,
        hp: 320, dmg: 30, interval: 1.5, range: 4.2 * TS, bulletLabel: '噗', bulletColor: '#66DD44',
        rarity: 0.46,
    },
    snowpea: {
        name: PLANTS.snowpea.name, char: '冰', color: PLANTS.snowpea.color,
        hp: 300, dmg: 24, interval: 1.8, range: 4.0 * TS, bulletLabel: '冰', bulletColor: '#00CCFF',
        slow: 0.5, slowDur: 3,
        rarity: 0.22,
    },
    repeater: {
        name: PLANTS.repeater.name, char: '双', color: PLANTS.repeater.color,
        hp: 360, dmg: 28, interval: 1.8, range: 4.5 * TS, bulletLabel: '噗', bulletColor: '#00DD00',
        burst: 2,
        rarity: 0.12,
    },
    chomper: {
        name: PLANTS.chomper.name, char: '嘴', color: PLANTS.chomper.color,
        hp: 460, dmg: 110, interval: 2.6, range: 1.6 * TS, bulletLabel: null,
        melee: true,
        rarity: 0.08,
    },
    sunflower: {
        name: PLANTS.sunflower.name, char: '葵', color: PLANTS.sunflower.color,
        hp: 220, dmg: 0, interval: 0, range: 0,
        sunProduce: true, sunInterval: 18,
        rarity: 0.08,
    },
};

const SPECIES_KEYS = Object.keys(WILD_SPECIES);

// ---------- 生长阶段：体型越大，伤害/血量越高 ----------
const STAGES = [
    { name: '幼苗', max: 33,  sizeMul: 0.7, dmgMul: 0.6, hpMul: 0.6 },
    { name: '成长', max: 66,  sizeMul: 1.0, dmgMul: 1.0, hpMul: 1.0 },
    { name: '成熟', max: 100, sizeMul: 1.3, dmgMul: 1.5, hpMul: 1.4 },
];
const GROWTH_RATE = 0.8;      // growth/秒（约 2 分钟长满）
const TAME_BASE = 0.7;        // 驯服基础成功率（幼苗）
const TAME_STAGE_PENALTY = 0.2; // 每升一阶成功率下降
const ACTIVATE_RADIUS = 9;    // 玩家周围多少格内的植物会被"激活"参与战斗

export function stageOf(growth) {
    for (let i = 0; i < STAGES.length; i++) if (growth <= STAGES[i].max) return i;
    return STAGES.length - 1;
}
function stageOfG(growth) { return STAGES[stageOf(growth)]; }

// 按种子确定品种 / 初始生长度（同一坐标永远一致）
export function speciesAt(seed, gx, gy) {
    const r = hash2(seed ^ 0x5EED, gx, gy);
    let acc = 0;
    for (const k of SPECIES_KEYS) {
        acc += WILD_SPECIES[k].rarity;
        if (r < acc) return k;
    }
    return 'peashooter';
}
function seededGrowth(seed, gx, gy) {
    return Math.floor(hash2(seed ^ 0x6ABE, gx, gy) * 70);   // 野生 0~69，少见天生成熟
}

const PLAYER_MUL = 1.5;   // 玩家培养/驯服植物属性强化

export function initPlants(sv) {
    if (!sv.mods.plants) sv.mods.plants = {};
}

function typeMul(type) { return type === 'neutral' ? 1 : PLAYER_MUL; }

function plantMaxHp(species, growth, type) {
    const sp = WILD_SPECIES[species] || WILD_SPECIES.peashooter;
    return Math.round(sp.hp * stageOfG(growth).hpMul * typeMul(type));
}
function plantDmg(species, growth, type) {
    const sp = WILD_SPECIES[species] || WILD_SPECIES.peashooter;
    return Math.round(sp.dmg * stageOfG(growth).dmgMul * typeMul(type));
}

function ensurePlant(sv, gx, gy, type, species, growth) {
    const key = gx + ',' + gy;
    if (sv.mods.plants[key]) return sv.mods.plants[key];
    const sp = WILD_SPECIES[species] || WILD_SPECIES.peashooter;
    const maxHp = plantMaxHp(species, growth, type);
    const p = {
        hp: maxHp, maxHp, type, species, growth,
        atkT: 0, hostile: false, sunT: sp.sunInterval || 0,
    };
    sv.mods.plants[key] = p;
    // 联机 guest：种植/驯服写入需上报 host（host 权威 plants，否则被 wsync 覆写冲掉）
    reportPlantChange(sv, key);
    return p;
}

// 联机植物变更上报：guest 端创建/伤害/击杀 → host 权威应用 → wsync 回传一致
function reportPlantChange(sv, key) {
    if (!sv.mp || sv.mp.role !== 'guest') return;
    const p = sv.mods.plants && sv.mods.plants[key];
    (sv.mpOutbox = sv.mpOutbox || []).push({
        type: 'plant',
        key,
        p: p ? { hp: p.hp, maxHp: p.maxHp, species: p.species, growth: p.growth, type: p.type } : null,
    });
}

// 生长：growth 增长并重算血量上限（成长时血量随之提升）
function grow(p, dt) {
    if (p.growth >= 100) return;
    const oldMax = p.maxHp;
    p.growth = Math.min(100, p.growth + GROWTH_RATE * dt);
    const newMax = plantMaxHp(p.species, p.growth, p.type);
    if (newMax > oldMax) {
        p.hp += (newMax - oldMax);
        p.maxHp = newMax;
    }
}

// 激活某格野生植物（如果是 SPROUT 且未激活）
function activatePlantAt(sv, gx, gy) {
    const t = getTile(sv, gx, gy);
    if (t !== T.SPROUT) return;
    const key = gx + ',' + gy;
    if (sv.mods.plants[key]) return;
    ensurePlant(sv, gx, gy, 'neutral', speciesAt(sv.world.seed, gx, gy), seededGrowth(sv.world.seed, gx, gy));
}

// 激活玩家和僵尸附近的野生植物（不用玩家靠近，植物也能反击靠近的僵尸）
function activateNearby(sv) {
    // 玩家附近
    const pcx = Math.floor(sv.px / TS), pcy = Math.floor(sv.py / TS);
    for (let dy = -ACTIVATE_RADIUS; dy <= ACTIVATE_RADIUS; dy++) {
        for (let dx = -ACTIVATE_RADIUS; dx <= ACTIVATE_RADIUS; dx++) {
            activatePlantAt(sv, pcx + dx, pcy + dy);
        }
    }
    // 僵尸附近（让远离玩家的植物也能自动反击）
    for (const z of sv.zombies) {
        const zcx = Math.floor(z.x / TS), zcy = Math.floor(z.y / TS);
        for (let dy = -6; dy <= 6; dy++) {
            for (let dx = -6; dx <= 6; dx++) {
                activatePlantAt(sv, zcx + dx, zcy + dy);
            }
        }
    }
}

// ---------- 每帧推进 ----------
export function updatePlants(sv, dt) {
    initPlants(sv);
    activateNearby(sv);
    const plants = sv.mods.plants;
    for (const key of Object.keys(plants)) {
        const p = plants[key];
        const [gx, gy] = key.split(',').map(Number);
        const px = (gx + 0.5) * TS, py = (gy + 0.5) * TS;
        const tile = getTile(sv, gx, gy);
        if (p.hurtT > 0) p.hurtT -= dt;   // 受击闪白计时衰减
        if (tile !== T.SPROUT && tile !== T.PLOT) { delete plants[key]; continue; }

        grow(p, dt);
        const sp = WILD_SPECIES[p.species] || WILD_SPECIES.peashooter;
        const friendly = p.type !== 'neutral';   // 驯服/培养 = 友方
        const dmg = plantDmg(p.species, p.growth, p.type);

        // 向日葵产阳光
        if (sp.sunProduce) {
            p.sunT -= dt;
            if (p.sunT <= 0) {
                p.sunT = sp.sunInterval;
                sv.drops.push({ x: px, y: py, id: 'sun', n: 1 });
                sv.effects.push({ kind: 'hit', x: px, y: py, life: 0.4, maxLife: 0.4, label: '☀' });
            }
            continue;
        }

        p.atkT -= dt;
        if (p.atkT > 0) continue;

        // 中立且被激怒 → 反击玩家
        if (p.type === 'neutral' && p.hostile) {
            const d = Math.hypot(sv.px - px, sv.py - py);
            const hostileRange = 3.5 * TS;
            if (d < hostileRange) {
                p.atkT = 1.4;
                if (sp.melee) {
                    // 2026-08-09 开局昏迷苏醒：睁眼动画期间玩家无敌（食人花咬不伤）
                    if (d < sp.range && !sv._devGod && !(sv._wake && sv._wake.t < sv._wake.dur)) {
                        // 2026-08-11 v2.97 倒地玩家被植物咬 → 扣救援时间（不直接扣血，防负血）
                        if (sv._downed && (!sv.controllerId || (sv.npcs || []).find(n => n.id === sv.controllerId && n.downed))) {
                            if (sv._downed._penaltySec == null) sv._downed._penaltySec = 0;
                            sv._downed._penaltySec += Math.round(dmg * 0.6) * B.DOWNED_HIT_PENALTY_SEC;
                        } else {
                            sv.hp = Math.max(0, sv.hp - dmg * 0.6);
                        }
                        sv.hurtT = 0.3;
                        sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 0.2, maxLife: 0.2, label: '咬' });
                        AudioSystem.playChomper();
                    }
                } else {
                    sv.bullets.push({
                        id: 'b' + ((sv._bIdSeq = (sv._bIdSeq || 0) + 1)),
                        x: px, y: py,
                        vx: (sv.px - px) / d * 260, vy: (sv.py - py) / d * 260,
                        damage: Math.round(dmg * 0.6), color: '#FF6644', label: '刺',
                        life: 1.0, range: hostileRange, pierce: 0, pierced: 0,
                        hitList: null, spin: false, traveled: 0, srcPlant: true, hostile: true,
                    });
                }
            } else {
                p.hostile = false;   // 玩家走远，消气
            }
            continue;
        }

        // 友方 / 中立未激怒：自动打僵尸
        const range = sp.range * (friendly ? 1.2 : 1);
        const z = nearestZombie(sv, px, py, range);
        if (!z) continue;
        p.atkT = sp.interval * (friendly ? 0.8 : 1);
        const d = Math.hypot(z.x - px, z.y - py) || 1;

        if (sp.melee) {
            if (d < range) {
                z.hp -= dmg;
                z.hurt = 0.12;
                sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.2, maxLife: 0.2, label: '吞' });
                AudioSystem.playChomper();
            }
        } else {
            const burst = sp.burst || 1;
            for (let b = 0; b < burst; b++) {
                const spread = burst > 1 ? (b - (burst - 1) / 2) * 0.12 : 0;
                const a = Math.atan2(z.y - py, z.x - px) + spread;
                sv.bullets.push({
                    id: 'b' + ((sv._bIdSeq = (sv._bIdSeq || 0) + 1)),
                    x: px, y: py,
                    vx: Math.cos(a) * 280, vy: Math.sin(a) * 280,
                    damage: dmg, color: sp.bulletColor, label: sp.bulletLabel,
                    life: 1.2, range, pierce: 0, pierced: 0,
                    hitList: null, spin: false, traveled: 0, srcPlant: true, hostile: false,
                    slow: sp.slow || 0, slowDur: sp.slowDur || 0,
                });
            }
        }
    }
}

function nearestZombie(sv, px, py, range) {
    let best = null, bestD = range;
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        const d = Math.hypot(z.x - px, z.y - py);
        if (d < bestD) { bestD = d; best = z; }
    }
    return best;
}

// ---------- 中立植物受到玩家攻击 ----------
export function hurtPlant(sv, gx, gy, dmg) {
    initPlants(sv);
    const key = gx + ',' + gy;
    const t = getTile(sv, gx, gy);
    if (t !== T.SPROUT && t !== T.PLOT) return false;
    let sp, growth;
    if (t === T.SPROUT) {
        sp = speciesAt(sv.world.seed, gx, gy);
        growth = seededGrowth(sv.world.seed, gx, gy);
    } else {
        const ex = sv.mods.plants[key];
        sp = ex ? ex.species : 'peashooter';
        growth = ex ? ex.growth : 0;
    }
    const p = ensurePlant(sv, gx, gy, t === T.SPROUT ? 'neutral' : 'player', sp, growth);
    p.hp -= dmg;
    if (p.type === 'neutral') p.hostile = true;
    reportPlantChange(sv, key);   // 联机 guest：伤害上报 host（hp 权威）
    if (p.hp <= 0) killPlant(sv, gx, gy, p);
    return true;
}

// ---------- 植物受到僵尸攻击（不激怒对玩家的敌意；返回是否被击杀） ----------
export function damagePlantFromZombie(sv, gx, gy, dmg) {
    initPlants(sv);
    const key = gx + ',' + gy;
    const t = getTile(sv, gx, gy);
    if (t !== T.SPROUT && t !== T.PLOT) return false;
    let sp, growth;
    if (t === T.SPROUT) {
        sp = speciesAt(sv.world.seed, gx, gy);
        growth = seededGrowth(sv.world.seed, gx, gy);
    } else {
        const ex = sv.mods.plants[key];
        sp = ex ? ex.species : 'peashooter';
        growth = ex ? ex.growth : 0;
    }
    const p = ensurePlant(sv, gx, gy, t === T.SPROUT ? 'neutral' : 'player', sp, growth);
    p.hp -= dmg;
    p.hurtT = 0.15;   // 受击闪白（渲染层 plantDisplay 据此把本体闪白，与玩家/NPC 受击反馈一致）
    reportPlantChange(sv, key);   // 联机 guest：伤害上报 host（hp 权威）
    if (p.hp <= 0) { killPlant(sv, gx, gy, p); return true; }
    return false;
}

function killPlant(sv, gx, gy, p) {
    const key = gx + ',' + gy;
    delete sv.mods.plants[key];
    reportPlantChange(sv, key);   // 联机 guest：收割/击杀上报 host 移除
    const cx = (gx + 0.5) * TS, cy = (gy + 0.5) * TS;
    const sp = WILD_SPECIES[p.species] || WILD_SPECIES.peashooter;
    setTile(sv, gx, gy, T.GROUND);
    sv.drops.push({ x: cx, y: cy, id: 'seed:' + p.species, n: 1 });
    if (p.type === 'neutral' && Math.random() < 0.35) sv.drops.push({ x: cx + 8, y: cy, id: 'herb', n: 1 });
    sv.effects.push({ kind: 'dead', x: cx, y: cy, life: 0.6, maxLife: 0.6, label: sp.name });
    AudioSystem.playPlantDig();
}

// ---------- 驯服（F，消耗食物；体型越大越难） ----------
// 返回: 'ok' 成功 / 'fail' 失败(激怒) / 'need:food' 缺食物 / 'not-neutral' 非中立
export function tryTame(sv, gx, gy, countItem, takeItem) {
    const t = getTile(sv, gx, gy);
    if (t !== T.SPROUT) return false;
    initPlants(sv);
    const key = gx + ',' + gy;
    const species = speciesAt(sv.world.seed, gx, gy);
    const growth = seededGrowth(sv.world.seed, gx, gy);
    const p = ensurePlant(sv, gx, gy, 'neutral', species, growth);
    if (p.type !== 'neutral') return 'not-neutral';
    if (countItem('food') < 1) return 'need:food';
    const chance = Math.max(0.1, TAME_BASE - stageOf(p.growth) * TAME_STAGE_PENALTY);
    takeItem('food', 1);
    if (Math.random() < chance) {
        p.type = 'tamed';
        p.hostile = false;
        return 'ok';
    }
    p.hostile = true;
    return 'fail';
}

// ---------- 培养（种子+水+肥料+阳光 → 种植盆 → 幼苗起步） ----------
export function tryCultivate(sv, gx, gy, countItem, takeItem) {
    const t = getTile(sv, gx, gy);
    if (t !== T.PLOT) return false;
    const key = gx + ',' + gy;
    if (sv.mods.plants[key]) return false;
    let seedId = null;
    for (const k of SPECIES_KEYS) {
        if (countItem('seed:' + k) > 0) { seedId = 'seed:' + k; break; }
    }
    if (!seedId) return 'need:seed';
    if (countItem('water') < 1) return 'need:water';
    if (countItem('fert') < 1) return 'need:fert';
    if (countItem('sun') < 1) return 'need:sun';
    takeItem(seedId, 1);
    takeItem('water', 1);
    takeItem('fert', 1);
    takeItem('sun', 1);
    const species = seedId.slice(5);
    initPlants(sv);
    ensurePlant(sv, gx, gy, 'player', species, 0);   // 从幼苗起步
    AudioSystem.playPlant();
    return true;
}

// ---------- 查询接口 ----------
export function plantHpAt(sv, gx, gy) {
    if (!sv.mods.plants) return null;
    return sv.mods.plants[gx + ',' + gy] || null;
}

export function plantSpeciesAt(sv, gx, gy) {
    const p = plantHpAt(sv, gx, gy);
    if (p) return p.species;
    const t = getTile(sv, gx, gy);
    if (t === T.SPROUT) return speciesAt(sv.world.seed, gx, gy);
    return null;
}

export function speciesInfo(species) {
    return WILD_SPECIES[species] || WILD_SPECIES.peashooter;
}

// 渲染用：返回某格植物的显示信息 { char,color,sizeMul,stageName,type }
export function plantDisplay(sv, gx, gy) {
    const t = getTile(sv, gx, gy);
    if (t !== T.SPROUT && t !== T.PLOT) return null;
    const p = plantHpAt(sv, gx, gy);
    let species, growth, type;
    if (p) { species = p.species; growth = p.growth; type = p.type; }
    else if (t === T.SPROUT) { species = speciesAt(sv.world.seed, gx, gy); growth = seededGrowth(sv.world.seed, gx, gy); type = 'neutral'; }
    else return null;
    const sp = WILD_SPECIES[species] || WILD_SPECIES.peashooter;
    const st = stageOfG(growth);
    return { char: sp.char, name: sp.name, color: sp.color, sizeMul: st.sizeMul, stageName: st.name, type, hurt: (p && p.hurtT > 0) ? p.hurtT : 0 };
}
