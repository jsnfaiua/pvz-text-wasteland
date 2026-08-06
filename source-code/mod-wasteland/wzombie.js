// ============================================================
// 【无尽植僵荒原】模组 · 僵尸 AI / 刷新 / 死亡掉落
// 从 survival.js 拆出，数值引用 wbalance.js
// ============================================================

import { ZOMBIES } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import { T, getTile, isWalk, builtAt, CHUNK } from './world.js';
import { TS } from './wconst.js';
import { astarField } from './wpath.js';
import { BUILD_ITEMS, BUILD_HP } from './render.js';
import { districtProfile, zombieStrengthAt, eliteChanceAt } from './wdistrict.js';
import { damagePlantFromZombie } from './wplants.js';
import * as WA from './waction.js';
import * as Panel from './panel.js';
import * as MSG from './wmsg.js';
import * as B from './wbalance.js';
import * as WW from './wwordcraft-rules.js';
import { infectionLevelFromRoll } from './winfection.js';
import { interiorZombieCount } from './windoor.js';
import { killNpc, maybeWound, inAnyCamp } from './wnpc.js';

const PATH_MAX_NODES = 12000;
const Z_GUEST_CHASE_RANGE = 12;   // 联机：僵尸转向追逐远端队友的半径（格，≈半屏内）

function gridKey(gx, gy) { return gx + ',' + gy; }

function isNight(sv) {
    const hour = (sv.t / sv.dayLen) * 24;
    return hour >= B.HORDE_START_HOUR || hour < B.HORDE_END_HOUR;
}

// Z_CHASE_RANGE 表示警戒区的总边长，而不是以玩家为圆心的半径。
function isInPlayerAlertRange(sv, z) {
    const half = B.Z_CHASE_RANGE * TS / 2;
    return Math.abs(z.x - sv.px) < half && Math.abs(z.y - sv.py) < half;
}

function syncNightStrength(z, night) {
    if (z.hp <= 0 || !!z._nightStrengthActive === night) return;
    const mul = B.Z_NIGHT_STRENGTH_MUL;
    const scale = night ? mul : 1 / mul;
    z.hp = Math.max(1, Math.round(z.hp * scale));
    z.maxHp = Math.max(1, Math.round(z.maxHp * scale));
    z._nightStrengthActive = night;
}

// 以玩家为起点反向展开 A*（octile 启发式：一致且可采纳 → 路径与 Dijkstra 相同，但扩展节点更少、更快）。
// 搜索只进行一次，得到的 parent 表可供所有僵尸反查下一格，避免每只僵尸单独寻路。
// 硬约束与旧实现一致：8 方向、斜穿禁过两障碍角、PATH_MAX_NODES 上限（也是不可达的隐性边界）。
// 性能（host 端周期性卡顿主因）：targets 只取「玩家警戒范围内 或 尸潮」的僵尸——
// 远处野生僵尸走直线/游荡追击（原 fallback，line 474-488），不进流场。否则远处僵尸
// 持续落在流场外 → 每 0.5s 标记 _zombiePathNeedsRebuild → 全量 A*（1.2 万节点）周期重建
// → host 端每 ~0.5s 一次 30ms+ 帧尖峰（联机时 host 卡 → guest 体感跟着卡）。
function buildPlayerPathField(sv, zCanStand) {
    const startX = Math.floor(sv.px / TS), startY = Math.floor(sv.py / TS);
    const targets = new Set();
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        // 尸潮僵尸（战斗核心）与警戒范围内僵尸进流场；其余直线追击
        if (!z.horde && !isInPlayerAlertRange(sv, z)) continue;
        targets.add(gridKey(Math.floor(z.x / TS), Math.floor(z.y / TS)));
    }
    // reachable 始终初始化（含全灭场景），避免 updateZombies 在 targets 为空时读到 undefined 崩溃
    const field = astarField(startX, startY, targets, {
        canStand: (x, y) => zCanStand(x, y),
        ts: TS,
        maxNodes: PATH_MAX_NODES,
    });
    field.playerKey = gridKey(startX, startY);
    field.revision = sv._zombiePathRevision || 0;
    return field;
}

function getPlayerPathField(sv, zCanStand) {
    const playerKey = gridKey(Math.floor(sv.px / TS), Math.floor(sv.py / TS));
    const revision = sv._zombiePathRevision || 0;
    const field = sv._zombiePathField;
    const needsNew = !field || field.playerKey !== playerKey || field.revision !== revision || sv._zombiePathNeedsRebuild;
    if (needsNew) {
        // 性能（卡顿排查 P0-2 / 坐车卡顿主因）：玩家/车辆高速移动换格时，每次全量 A*
        // 重建（上限 PATH_MAX_NODES=1.2 万节点，含 targets=全部僵尸）在帧内执行。
        // 开车 260px/s ≈ 每秒换 7 格 → 每秒 7 次全量重建的帧尖峰。
        // 修复：非正确性触发（仅换格；僵尸生成由 _zombiePathNeedsRebuild 正常触发）让出
        // _pathRebuildCd 冷却（0.35s，update() 每帧递减）复用旧场——僵尸追旧目标格，
        // 0.35s 内偏移 ≤3 格（开车时），追逐/包围表现无感；地形变化（revision）无视冷却。
        if (field && sv._pathRebuildCd > 0 && !sv._zombiePathNeedsRebuild && field.revision === revision) {
            return field;   // 冷却内复用（仅换格触发）
        }
        sv._zombiePathField = buildPlayerPathField(sv, zCanStand);
        sv._zombiePathNeedsRebuild = false;
        sv._pathRebuildCd = 0.35;
    }
    return sv._zombiePathField;
}

export function spawnZombie(sv, type, x, y, horde) {
    // 生成点安全化：落在不可走格（建筑/障碍内）时就近找可走格，防卡墙
    const gx0 = Math.floor(x / TS), gy0 = Math.floor(y / TS);
    if (!isWalk(getTile(sv, gx0, gy0))) {
        let fx = null, fy = null;
        for (let r = 1; r <= 8 && fx == null; r++) {
            for (let dy = -r; dy <= r && fx == null; dy++) for (let dx = -r; dx <= r && fx == null; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                if (isWalk(getTile(sv, gx0 + dx, gy0 + dy))) { fx = (gx0 + dx + 0.5) * TS; fy = (gy0 + dy + 0.5) * TS; }
            }
        }
        if (fx != null) { x = fx; y = fy; }
    }
    const textDef = B.TEXT_ZOMBIE_TYPES[type];
    const def = textDef || ZOMBIES[type] || ZOMBIES.normal;
    const cx = Math.floor((x / TS) / CHUNK), cy = Math.floor((y / TS) / CHUNK);
    const ringMul = zombieStrengthAt(sv.world.seed, cx, cy);
    const mul = (1 + (sv.day - 1) * B.Z_DAY_SCALE) * (B.DIFF_TABLE[sv.diffKey] || B.DIFF_TABLE.normal).mul * ringMul;
    const baseHp = B.Z_SURVIVAL_HP[type] || 70;
    let totalHp = Math.round(baseHp * mul);
    const z = {
        id: 'z' + ((sv._zIdSeq = (sv._zIdSeq || 0) + 1)),   // 运行时 id：联机快照差分/击杀指定用
        type, char: B.Z_CHAR[type] || '僵', color: def.color, x, y,
        name: def.name || '僵尸',
        hp: totalHp, maxHp: totalHp,
        speed: def.speed * B.Z_SPEED_MUL, damage: def.damage,
        wt: 0, tx: x, ty: y, wDir: null, biteT: 0, hurt: 0, stunT: 0,
        biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0,
        horde: !!horde,
        infection: infectionLevelFromRoll(Math.random()),
        textAbility: textDef ? textDef.ability : null,
        atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false, auraT: 0, comboLeft: 0,
    };
    sv.zombies.push(z);
    sv._zombiePathNeedsRebuild = true;
    AudioSystem.playZombieSpawn();
    return z;
}

// 按僵尸强度掷品质（越强越好）
export function rollQualityLoot(type) {
    const tier = B.ZOMBIE_LOOT_TIER[type] || 'normal';
    const table = B.LOOT_QUALITY[tier] || B.LOOT_QUALITY.normal;
    const r = Math.random();
    let acc = 0;
    for (const [q, w] of table) { acc += w; if (r < acc) return q; }
    return 'common';
}

export function zombieBagDropChance(type) {
    const tier = B.ZOMBIE_LOOT_TIER[type] || 'normal';
    return B.ZOMBIE_BAG_DROP_CHANCE[tier] ?? B.ZOMBIE_BAG_DROP_CHANCE.normal;
}

function resolveLootItem(kind, quality) {
    if (kind === 'ammo') {
        const at = B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)];
        return { id: 'ammo:' + at, n: 4 + Math.floor(Math.random() * (quality === 'epic' ? 9 : 6)) };
    }
    if (kind === 'tool') {
        const tools = ['chopper', 'pick', 'hoe', 'wrench'];
        return { id: 'tool:' + tools[Math.floor(Math.random() * tools.length)], n: 1 };
    }
    if (kind === 'weapon') {
        const tier = quality === 'epic' ? (Math.random() < 0.5 ? 'rare' : 'epic') : (Math.random() < 0.6 ? 'common' : 'rare');
        const pool = B.LOOT_WEAPONS[tier];
        return { id: 'wpn:' + pool[Math.floor(Math.random() * pool.length)], n: 1 };
    }
    if (kind === 'gem') return { id: 'gem', n: 1 };
    if (kind === 'flag') return { id: 'flag', n: 1 };   // 史诗战利品袋：领地旗帜
    const base = { herb: 2, food: 2, wood: 3, stone: 3, water: 1, fert: 1, sun: 1 };
    const max = base[kind] || 1;
    return { id: kind, n: 1 + Math.floor(Math.random() * max) };
}

// 按品质生成内容（种类丰富）
function zombieGlyphPool(type) {
    const occupation = {
        normal: 'resident', cone: 'worker', bucket: 'worker', door: 'worker', pole: 'guard', flag: 'guard',
    }[type] || 'resident';
    return WW.ZOMBIE_GLYPH_POOLS[occupation];
}

function rollBaseLootContents(quality) {
    const def = B.LOOT_CONTENTS[quality] || B.LOOT_CONTENTS.common;
    const pool = def.pool;
    const total = pool.reduce((s, e) => s + e[1], 0);
    const count = def.count[0] + (Math.random() < 0.5 ? def.count[1] - def.count[0] : 0);
    const items = [];
    for (let i = 0; i < count; i++) {
        let r = Math.random() * total, kind = pool[0][0];
        for (const [k, w] of pool) { if (r < w) { kind = k; break; } r -= w; }
        items.push(resolveLootItem(kind, quality));
    }
    // 稀有/史诗容器：低概率额外掉落传送宝石（D/E2 联动）
    if ((quality === 'rare' || quality === 'epic') && Math.random() < 0.25) {
        items.push({ id: 'tpgem', n: 1 });
    }
    return items;
}

export function rollLootContents(quality, type = 'normal') {
    const resultTable = B.ZOMBIE_BAG_RESULT_TABLES[quality] || B.ZOMBIE_BAG_RESULT_TABLES.common;
    const countKey = quality === 'epic' ? 'zombieEpic' : quality === 'rare' ? 'zombieRare' : 'zombieCommon';
    const result = WW.rollWordLootOutcome('zombie', resultTable, {
        countTable: WW.GLYPH_COUNT_TABLES[countKey],
        glyphPool: zombieGlyphPool(type),
        wedgeSource: countKey,
        pollutionTable: WW.ZOMBIE_POLLUTION_TABLES[quality] || WW.ZOMBIE_POLLUTION_TABLES.common,
        completeSource: 'zombie',
    });
    const items = result.type === 'base' ? rollBaseLootContents(quality) : result.items;
    // 巨字尸（尸潮首领）：必掉传送宝石 + 额外宝石（E2 传送消耗品来源之一）
    if (type === 'giant') {
        items.push({ id: 'tpgem', n: 1 });
        if (Math.random() < 0.5) items.push({ id: 'gem', n: 1 });
    }
    return items;
}

export function updateSpawns(sv, dt, canStand) {
    sv.spawnT -= dt;
    if (sv.spawnT > 0) return;
    const pcx = Math.floor(sv.px / TS / CHUNK), pcy = Math.floor(sv.py / TS / CHUNK);
    const zMul = districtProfile(sv.world.seed, pcx, pcy).zombieMul || 1;
    sv.spawnT = (B.Z_SPAWN_INTERVAL_MIN + Math.random() * B.Z_SPAWN_INTERVAL_RAND) / zMul;
    const cap = Math.min(Math.round((B.Z_SPAWN_CAP_BASE + sv.day) * zMul), B.Z_SPAWN_CAP_MAX + Math.round((zMul - 1) * 4));
    if (sv.zombies.length >= cap) return;
    for (let tries = 0; tries < 12; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = (B.Z_SPAWN_DIST_MIN + Math.random() * B.Z_SPAWN_DIST_RAND) * TS;
        const x = sv.px + Math.cos(ang) * dist;
        const y = sv.py + Math.sin(ang) * dist;
        // 领地旗帜范围内减少敌对生物生成
        if (inAnyCamp(sv, Math.floor(x / TS), Math.floor(y / TS))) { sv.spawnT = B.Z_SPAWN_INTERVAL_MIN + Math.random() * B.Z_SPAWN_INTERVAL_RAND; return; }
        if (canStand(x, y)) {
            const r = Math.random();
            const day = sv.day;
            const scx = Math.floor((x / TS) / CHUNK), scy = Math.floor((y / TS) / CHUNK);
            const eliteC = eliteChanceAt(sv.world.seed, scx, scy);
            const textC = day >= B.Z_TEXT_UNLOCK_DAY ? Math.max(B.Z_TEXT_SPAWN_CHANCE, eliteC * 0.4) : 0;
            if (textC > 0 && r < textC) {
                const textKeys = Object.keys(B.TEXT_ZOMBIE_TYPES);
                const tType = textKeys[Math.floor(Math.random() * textKeys.length)];
                spawnZombie(sv, tType, x, y);
                return;
            }
            const poleC = day >= B.Z_POLE_UNLOCK_DAY ? Math.min(0.06 + day * 0.01, 0.18) : 0;
            const doorC = day >= B.Z_DOOR_UNLOCK_DAY ? Math.min(0.04 + (day - B.Z_DOOR_UNLOCK_DAY) * 0.01, 0.14) : 0;
            let type;
            if (r < textC + doorC) type = 'door';
            else if (r < textC + doorC + poleC) type = 'pole';
            else type = r < 0.55 ? 'normal' : (r < 0.85 ? 'cone' : 'bucket');
            spawnZombie(sv, type, x, y);
            return;
        }
    }
}

export function updatePackSpawns(sv, dt, canStand) {
    sv._packT = (sv._packT || (B.PACK_SPAWN_INTERVAL + Math.random() * B.PACK_SPAWN_INTERVAL_RAND));
    sv._packT -= dt;
    if (sv._packT > 0) return;
    sv._packT = B.PACK_SPAWN_INTERVAL + Math.random() * B.PACK_SPAWN_INTERVAL_RAND;
    const pcx = Math.floor(sv.px / TS / CHUNK), pcy = Math.floor(sv.py / TS / CHUNK);
    const dist = Math.hypot(pcx, pcy);
    if (dist < 8) return;
    const cap = B.Z_SPAWN_CAP_MAX + 4;
    if (sv.zombies.length >= cap) return;
    let kx = null, ky = null;
    for (let tries = 0; tries < 15; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (B.Z_SPAWN_DIST_MIN + 4 + Math.random() * 6) * TS;
        const x = sv.px + Math.cos(ang) * d, y = sv.py + Math.sin(ang) * d;
        if (canStand(x, y)) { kx = x; ky = y; break; }
    }
    if (kx == null) return;
    const kingType = B.PACK_KING_TYPES[Math.floor(Math.random() * B.PACK_KING_TYPES.length)];
    spawnZombie(sv, kingType, kx, ky);
    const king = sv.zombies[sv.zombies.length - 1];
    king.packKing = true;
    const size = B.PACK_MIN_SIZE + Math.floor(Math.random() * (B.PACK_MAX_SIZE - B.PACK_MIN_SIZE + 1));
    for (let i = 0; i < size; i++) {
        const ox = kx + (Math.random() - 0.5) * 3 * TS;
        const oy = ky + (Math.random() - 0.5) * 3 * TS;
        if (!canStand(ox, oy)) continue;
        const r = Math.random();
        const followerType = r < 0.5 ? 'normal' : (r < 0.8 ? 'cone' : 'pole');
        spawnZombie(sv, followerType, ox, oy);
        const follower = sv.zombies[sv.zombies.length - 1];
        follower.packKingId = king.id;   // 存 id 不存对象引用：快照/存档可序列化，guest 端按 id 查回
    }
}

function updatePackFollow(sv, z, dt, zCanStand) {
    // packKingId 存的是 id（联机快照序列化需要）；运行时按 id 从当前数组查回王
    const king = z.packKingId ? sv.zombies.find(k => k.id === z.packKingId) : null;
    if (!king || king.hp <= 0) { z.packKingId = null; return false; }
    const dx = king.x - z.x, dy = king.y - z.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < B.PACK_FOLLOW_RANGE * TS) {
        z.wt -= dt;
        if (z.wt <= 0 || z.wDir == null) { z.wt = 1 + Math.random() * 2; z.wDir = Math.random() * Math.PI * 2; }
        return false;
    }
    const spd = z.speed * (B.Z_CONTACT[z.type] || B.Z_CONTACT.normal).speedMul * B.PACK_FOLLOW_SPEED_MUL;
    const nx = z.x + (dx / dist) * spd * dt;
    const ny = z.y + (dy / dist) * spd * dt;
    if (zCanStand(nx, z.y)) z.x = nx;
    if (zCanStand(z.x, ny)) z.y = ny;
    return true;
}

// 资源点驻守：概率制，只在屏幕外刷（带边距），资源密集区才有；每箱一次性掷定，之后不再重掷
const GUARD_TILES = { [T.BOX]: 1, [T.WBOX]: 1, [T.MEDBOX]: 1, [T.MATBOX]: 1, [T.DOOR]: 1 };
// 画布 960×540、TS=36：半屏宽 ≈13.3 格、半屏高 7.5 格，各加约 1.5 格安全边距
const GUARD_SCREEN_HALF_X = 15;
const GUARD_SCREEN_HALF_Y = 9;
export function updateGuardSpawns(sv, dt, canStand) {
    sv._guardT = (sv._guardT || 0) - dt;
    if (sv._guardT > 0) return;
    sv._guardT = 0.5;
    if (!sv.mods.guarded) sv.mods.guarded = {};
    const pcx = Math.floor(sv.px / TS), pcy = Math.floor(sv.py / TS);
    const R = 17;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const gx = pcx + dx, gy = pcy + dy;
        const t = getTile(sv, gx, gy);
        if (!GUARD_TILES[t]) continue;
        const key = gx + ',' + gy;
        if (sv.mods.guarded[key] != null) continue;
        // 领地旗帜范围内不刷守卫生成（敌对生物减少）
        if (inAnyCamp(sv, gx, gy)) { sv.mods.guarded[key] = 0; continue; }
        const cd = Math.hypot(gx - pcx, gy - pcy);
        if (cd > R) continue;
        // 屏幕内（含边距）不刷：避免僵尸在视野里凭空出现
        if (Math.abs(dx) <= GUARD_SCREEN_HALF_X && Math.abs(dy) <= GUARD_SCREEN_HALF_Y) continue;
        const h = (Math.abs((gx * 73856093) ^ (gy * 19349663)) % 1000) / 1000;
        const zMul = districtProfile(sv.world.seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)).zombieMul || 1;
        if (t === T.DOOR) {
            // 门口镇守僵尸 = 室内 1 层僵尸"跑出来"的（与室内生成共用数量规则）：
            // 室内 1 层有僵尸才有守卫；50% 概率已走出 1 只；带 guardDoor 标记，
            // 玩家进入室内时按守卫数扣减 1 层生成，不重复计算
            const ringMul = zombieStrengthAt(sv.world.seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
            const inner = interiorZombieCount(sv.world.seed, key, 1, ringMul);
            if (inner <= 0 || h > 0.50) { sv.mods.guarded[key] = 0; continue; }
        } else {
            const guardChance = 0.35 * zMul;
            if (h > guardChance) { sv.mods.guarded[key] = 0; continue; }
        }
        let sx = null, sy = null;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const cx = (gx + ox + 0.5) * TS, cy = (gy + oy + 0.5) * TS;
            if (canStand(cx, cy)) { sx = cx; sy = cy; break; }
        }
        if (sx == null) { sv.mods.guarded[key] = 0; continue; }
        sv.mods.guarded[key] = 1;
        const typeH = (Math.abs((gx * 19349663) ^ (gy * 73856093)) % 100) / 100;
        const day = sv.day;
        let type = 'normal';
        if (day >= B.Z_DOOR_UNLOCK_DAY && typeH < 0.10 * zMul) type = 'door';
        else if (typeH < 0.20 * zMul) type = 'bucket';
        else if (typeH < 0.50) type = 'cone';
        const z = spawnZombie(sv, type, sx, sy);
        if (t === T.DOOR) z.guardDoor = key;
        return;
    }
}

// 范围内最近的植物（野草芽/种植盆）
function nearestPlantTarget(sv, z, range) {
    const cx = Math.floor(z.x / TS), cy = Math.floor(z.y / TS);
    const R = Math.ceil(range / TS);
    let best = null, bestD = range;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const gx = cx + dx, gy = cy + dy;
        const t = getTile(sv, gx, gy);
        if (t !== T.SPROUT && t !== T.PLOT) continue;
        const px = (gx + 0.5) * TS, py = (gy + 0.5) * TS;
        const d = Math.hypot(px - z.x, py - z.y);
        if (d < bestD) { bestD = d; best = { gx, gy, x: px, y: py, dist: d }; }
    }
    return best;
}

export function updateZombies(sv, dt, canStand, zCanStand, damageBuilding, damageObstacleCb) {
    const diffMul = (B.DIFF_TABLE[sv.diffKey] || B.DIFF_TABLE.normal).mul;
    const night = isNight(sv);
    const nightMul = night ? B.Z_NIGHT_STRENGTH_MUL : 1;
    // 联机 host：远端队友（guest）作为第二追逐目标——guest 在室外且位置有效时，僵尸会主动追她/他
    // （guest 端不模拟世界，追逐/咬伤都由 host 权威；guest 在室内时空间隔离，不追）
    const guest = (sv.mp && sv.mp.role === 'host' && sv.p2 && !sv.p2.inInterior && sv.p2.tx != null) ? sv.p2 : null;
    // 同一玩家格、同一地形版本只构建一次；每只僵尸之后只读取该结果。
    const pathField = getPlayerPathField(sv, zCanStand);
    // 旗帜光环：每帧收集一次存活 flag 僵尸（通常 1-2 只）——光环扫描从 O(n²) 降到 O(n×flag)（审查 M3）
    const flagZombies = [];
    for (const zz of sv.zombies) if (zz.type === 'flag' && zz.hp > 0) flagZombies.push(zz);
    for (const z of sv.zombies) {
        syncNightStrength(z, night);
        if (z.hurt > 0) z.hurt -= dt;
        if (z.slowT > 0) z.slowT -= dt;
        else z.slowMul = 0;
        if (z.stunT > 0) { z.stunT -= dt; continue; }
        if (z.biteCd > 0) z.biteCd -= dt;
        if (z.lungeCd > 0) z.lungeCd -= dt;
        if (z.lungeT > 0) z.lungeT -= dt;
        const pdx = sv.px - z.x, pdy = sv.py - z.y;
        const pdist = Math.hypot(pdx, pdy) || 1;
        const playerAlerted = isInPlayerAlertRange(sv, z);
        const plant = nearestPlantTarget(sv, z, B.Z_PLANT_DETECT * TS);
        const contact = B.Z_CONTACT[z.type] || B.Z_CONTACT.normal;
        const dmgTo = contact.dmg * diffMul * nightMul;
        if (z.auraT > 0) z.auraT -= dt;

        // 碰撞攻击：进入接触距离即咬击（有冷却）
        if (pdist < B.Z_CONTACT_DIST && z.biteCd <= 0) {
            z.biteCd = contact.biteCd;
            // 车内护甲（M7）：驾驶中车壳挡咬——驾驶员不受咬伤，车吃半伤 + "铛"特效；
            // 车报废由 driveCommon 每帧检测处理
            if (sv.driving) {
                if (sv.driving.hp > 0) sv.driving.hp = Math.max(0, sv.driving.hp - dmgTo * 0.5);
                sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.2, maxLife: 0.2, label: '铛' });
            } else {
                WA.resolvePlayerHit(sv, z, dmgTo, zCanStand);
            }
        }
        // 僵尸啃咬附近的角色/NPC（含恶意 NPC：僵尸攻击除同类外的一切生物；受击原则与主角一致）
        // 性能：NPC 咬扫每 0.2s 一跳（僵尸 × NPC 数量多时不卡）
        z._npcScanT = (z._npcScanT || 0) - dt;
        if (sv.npcs && z.biteCd <= 0 && z._npcScanT <= 0) {
            z._npcScanT = 0.2;
            for (const n of sv.npcs) {
                if (!n.alive) continue;
                if (sv.controllerId && n.id === sv.controllerId) continue;   // 主控走玩家受伤路径
                if (Math.hypot(n.x - z.x, n.y - z.y) < B.Z_CONTACT_DIST + 6) {
                    z.biteCd = contact.biteCd;
                    n.hp -= dmgTo;
                    n.hurtT = 0.3;
                    maybeWound(sv, n);
                    if (n.hp <= 0) killNpc(sv, n, '被僵尸咬死');
                    break;
                }
            }
        }

        // 攻击植物：进入植物范围即啃咬
        if (z.plantBiteCd > 0) z.plantBiteCd -= dt;
        if (plant && plant.dist < B.Z_PLANT_ATK_RANGE * TS && z.plantBiteCd <= 0) {
            z.plantBiteCd = contact.biteCd;
            damagePlantFromZombie(sv, plant.gx, plant.gy, dmgTo);
            AudioSystem.playZombieEating();
        }

        // 扑咬：快速型僵尸在中距离时突进
        if (contact.lunge > 0 && z.lungeCd <= 0 && pdist < B.Z_LUNGE_TRIGGER_DIST && pdist > B.Z_CONTACT_DIST && (playerAlerted || z.horde)) {
            z.lungeCd = B.Z_LUNGE_CD;
            z.lungeT = 0.2;
            const la = Math.atan2(pdy, pdx);
            const lx = z.x + Math.cos(la) * contact.lunge, ly = z.y + Math.sin(la) * contact.lunge;
            if (zCanStand(lx, z.y)) z.x = lx;
            if (zCanStand(z.x, ly)) z.y = ly;
            sv.effects.push({ kind: 'zswing', x: z.x, y: z.y, angle: la, life: 0.2, maxLife: 0.2, style: 'thrust' });
            if (Math.hypot(sv.px - z.x, sv.py - z.y) < B.Z_CONTACT_DIST + 10) {
                WA.resolvePlayerHit(sv, z, dmgTo, zCanStand);
                // 扑咬控制：短暂减速 + 2 秒免疫再次控制（applyAtkSlow 内处理免疫标记）
                if (contact.stunTime > 0 && !sv.isJumping && sv.invuln <= 0 && !sv.guarding) {
                    WA.applyAtkSlow(sv, contact.stunTime * 1.5);
                }
            }
        }

        // ---- 移动：尸群跟随 → 追玩家 → 奔植物 → 游荡 ----
        if (z.packKingId && !playerAlerted && !z.horde) {
            if (updatePackFollow(sv, z, dt, zCanStand)) continue;
        }
        let mvx, mvy, spd;
        const typeSpd = contact.speedMul || 1;
        const lungeDashing = z.lungeT > 0;
        // 旗帜光环：范围内友方僵尸提速（flag 列表每帧预收集，O(flag) 而非 O(n)）
        let auraMul = 1;
        if (z.type !== 'flag') {
            for (const o of flagZombies) {
                if (o !== z && Math.hypot(o.x - z.x, o.y - z.y) < B.Z_FLAG_AURA_RANGE * TS) { auraMul = B.Z_FLAG_AURA_MUL; break; }
            }
        }
        if (z.auraT > 0) auraMul = Math.max(auraMul, B.Z_FLAG_AURA_MUL);
        const seekingPlant = !z.horde && plant && plant.dist < B.Z_PLANT_DETECT * TS && !playerAlerted;
        // 联机 host：远端队友更近时僵尸转向追队友（直线追击 + 滑动避障，绕过路径场——
        // 路径场是朝房主 BFS 的，追 guest 只能直线逼近；guest 被咬由 hostGuestBiteCheck 权威判定）
        let gChase = null;
        if (guest && !z.horde && !seekingPlant) {
            const gdx = guest.tx - z.x, gdy = guest.ty - z.y;
            const gd = Math.hypot(gdx, gdy);
            if (gd < Z_GUEST_CHASE_RANGE * TS && gd < pdist * 0.9) gChase = { dx: gdx / gd, dy: gdy / gd };
        }
        const pathStep = pathField.parent.get(gridKey(Math.floor(z.x / TS), Math.floor(z.y / TS)));
        const canFollowPath = (z.horde || playerAlerted) && !seekingPlant && pathStep;
        if (lungeDashing) {
            mvx = pdx / pdist; mvy = pdy / pdist; spd = z.speed * typeSpd * 3.5;
        } else if (gChase) {
            mvx = gChase.dx; mvy = gChase.dy;
            spd = z.speed * typeSpd * B.Z_CHASE_SPEED_MUL * auraMul * nightMul;
        } else if (canFollowPath) {
            const qx = (pathStep.gx + 0.5) * TS - z.x, qy = (pathStep.gy + 0.5) * TS - z.y;
            const qd = Math.hypot(qx, qy) || 1;
            mvx = qx / qd; mvy = qy / qd;
            spd = z.speed * typeSpd * (z.horde ? B.Z_HORDE_SPEED_MUL : B.Z_CHASE_SPEED_MUL) * auraMul * nightMul;
        } else if (z.horde) {
            mvx = pdx / pdist; mvy = pdy / pdist; spd = z.speed * typeSpd * B.Z_HORDE_SPEED_MUL * auraMul * nightMul;
        } else if (playerAlerted) {
            mvx = pdx / pdist; mvy = pdy / pdist; spd = z.speed * typeSpd * B.Z_CHASE_SPEED_MUL * auraMul * nightMul;
        } else if (seekingPlant) {
            const qx = plant.x - z.x, qy = plant.y - z.y;
            const qd = Math.hypot(qx, qy) || 1;
            mvx = qx / qd; mvy = qy / qd; spd = z.speed * typeSpd * 0.8 * auraMul * nightMul;
        } else {
            z.wt -= dt;
            if (z.wt <= 0 || z.wDir == null) {
                z.wt = 1.5 + Math.random() * 2.5;
                z.wDir = Math.random() * Math.PI * 2;
            }
            mvx = Math.cos(z.wDir); mvy = Math.sin(z.wDir); spd = z.speed * typeSpd * B.Z_WANDER_SPEED * auraMul * nightMul;
        }
        const slowFactor = z.slowMul ? (1 - z.slowMul) : 1;
        const nx = z.x + mvx * spd * slowFactor * dt, ny = z.y + mvy * spd * slowFactor * dt;
        const okX = zCanStand(nx, z.y), okY = zCanStand(z.x, ny);
        if (okX || okY) z.faceDir = Math.atan2(mvy, mvx);   // 持盾/朝向跟随移动方向
        if (okX) z.x = nx;
        if (okY) z.y = ny;
        // 新建/摧毁障碍或僵尸落在路径场外时，标记重建（节流：最多每0.5s一次）。
        // 性能：只有「玩家警戒范围内」的僵尸才标记——远处僵尸走直线追击（流场
        // targets 已近距化），不再周期触发全量 A* 重建（host 端周期性帧尖峰主源）
        if (!seekingPlant && !pathStep && !pathField.reachable.has(gridKey(Math.floor(z.x / TS), Math.floor(z.y / TS)))) {
            if (playerAlerted && (!sv._pathRebuildCd || sv._pathRebuildCd <= 0)) sv._zombiePathNeedsRebuild = true;
        }
        if (!seekingPlant && !okX && !okY) {
            if (playerAlerted && (!sv._pathRebuildCd || sv._pathRebuildCd <= 0)) sv._zombiePathNeedsRebuild = true;
        }
        // 漫游撞墙：立即换个随机方向（避免贴墙抽搐）
        if (!okX && !okY && z.wDir != null && !playerAlerted && !z.horde) {
            z.wDir = Math.random() * Math.PI * 2;
            z.wt = 1.5 + Math.random() * 2.5;
        }
        // 撑杆：未跳过且正前方有障碍 → 跳过（一次）
        if (z.type === 'pole' && !z.vaulted) {
            const bx = z.x + mvx * TS, by = z.y + mvy * TS;
            if (!zCanStand(bx, by)) {
                z.vaulted = true;
                AudioSystem.playPoleVault();
                sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.35, maxLife: 0.35, label: '跳' });
                const jx = z.x + mvx * 2.4 * TS, jy = z.y + mvy * 2.4 * TS;
                if (zCanStand(jx, jy)) { z.x = jx; z.y = jy; continue; }
            }
        }
        // 被建筑/障碍阻挡时啃咬（尸潮/追击/奔植物途中）
        if ((!okX || !okY) && (z.horde || playerAlerted || seekingPlant)) {
            const g1 = okX ? null : [Math.floor(nx / TS), Math.floor(z.y / TS)];
            const g2 = okY ? null : [Math.floor(z.x / TS), Math.floor(ny / TS)];
            for (const g of [g1, g2]) {
                if (!g) continue;
                const m = builtAt(sv, g[0], g[1]);
                if (m) { damageBuilding(z, g[0], g[1], m, dt); break; }
                const tt = getTile(sv, g[0], g[1]);
                if ((tt === T.BARRICADE || tt === T.CAR || tt === T.CARWRECK) && damageObstacleCb) {
                    z.biteT -= dt;
                    if (z.biteT <= 0) { z.biteT = 0.6; AudioSystem.playDigStone(); }
                    damageObstacleCb(g[0], g[1], z.damage * dt * 0.6);
                    break;
                }
            }
        }
    }

    for (let i = sv.zombies.length - 1; i >= 0; i--) {
        const z = sv.zombies[i];
        if (z.hp > 0) continue;
        // 联机：host 击杀广播 wevt（guest 端播放音效/特效；僵尸移除由 wsync 同步）；
        // guest 室内击杀也上报（host 转发其余客人，击杀播报/音效双端一致）
        if (sv.mp && (sv.mp.role === 'host' || sv.mp.role === 'guest')) {
            (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'kill', id: z.id, x: z.x, y: z.y });
            if (sv.mp.role === 'guest') {
                // guest 本地已结算（室内）：记录本次击杀，host 转发回包时去重（防双播音效/特效）
                (sv._mpLocalKills = sv._mpLocalKills || []).push(z.id);
                if (sv._mpLocalKills.length > 20) sv._mpLocalKills.shift();
            }
        }
        // 战利品道具：按强度掉品质袋，走过去拾取入包，随时打开
        if (Math.random() < zombieBagDropChance(z.type)) {
            const quality = rollQualityLoot(z.type);
            const contents = rollLootContents(quality, z.type);
            if (contents.length) sv.drops.push({ x: z.x, y: z.y, id: 'loot:' + quality, n: 1, contents });
        }
        sv.effects.push({ kind: 'dead', x: z.x, y: z.y, life: 0.6, maxLife: 0.6, label: z.name });
        AudioSystem.playZombieDie();
        sv.zombies.splice(i, 1);
    }
}
