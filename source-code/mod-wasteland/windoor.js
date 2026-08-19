// ============================================================
// 【无尽植僵荒原】模组 · 室内独立空间（M8）
// 进门 → 生成小型室内地图 → 搜刮/战斗 → 走到出口回大世界
// 室内状态：sv.interior = null（大世界）或 { tiles, w, h, zombies, drops, ... }
// 已搜过的房间记录在 sv.mods.interiors { "doorKey": 1 }
// ============================================================

import { ZOMBIES } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import { T, CHUNK, getTile, isWalk } from './world.js';
import { TS } from './wconst.js';
import * as B from './wbalance.js';
import * as MSG from './wmsg.js';
import * as Panel from './panel.js';
import * as WA from './waction.js';
import { rollQualityLoot, rollLootContents, zombieBagDropChance } from './wzombie.js';
import { infectionLevelFromRoll } from './winfection.js';
import { buildingTypeAt, BUILDING_TYPES, zombieStrengthAt, districtAt } from './wdistrict.js';
import * as WNPC from './wnpc.js';   // v4.17 修复室内外切换：enterInterior/exitInterior 同步主控 inInterior
import * as WCorpse from './wcorpse.js';   // v4.39 室内击杀尸变丧尸 → 生成同房间"XX（尸变）"尸体（按当前 sv.interior 落地）

// 僵尸运行时 id 兜底（与室外 spawnZombie 同一自增序列 sv._zIdSeq，保证出门后 id 全局唯一）
function ensureZId(sv, z) {
    if (z && z.id) return z.id;
    return 'z' + ((sv._zIdSeq = (sv._zIdSeq || 0) + 1));
}

const IW = 12;
const IH = 10;
const IT = {
    FLOOR: 0, WALL: 1, BOX: 2, EXIT: 3, SHELF: 4, DEBRIS: 5, STAIRS_DOWN: 6, STAIRS_UP: 7, VOID: 8,
    WBOX: 9, MEDBOX: 10, MATBOX: 11, PLANT: 12,
};

export const INTERIOR_TILES = IT;
export const INTERIOR_W = IW;
export const INTERIOR_H = IH;

// 僵尸迁徙（室内外打通）：楼上僵尸会逐层下楼，1 层僵尸会走出门口（成为门口镇守），
// 室外僵尸也会从门口进屋。空闲僵尸按间隔触发迁徙（3 层→2 层→1 层→出门）。
const Z_MIGRATE_IDLE = 14;      // 空闲后首次触发迁徙的冷却（秒，+随机 0~26）
const Z_MIGRATE_RETRY = 20;     // 出发失败（无楼梯/无出口）后的重试间隔
const Z_MIGRATE_AFTER = 20;     // 迁徙完成后下一次迁徙的冷却
const Z_ENTRY_RANGE = 2.5;      // 门口拉人半径（格）：范围内的世界僵尸会进屋

function hash(s) {
    let h = s | 0;
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
}

export function measureBuilding(sv, doorX, doorY) {
    let minX = doorX, maxX = doorX, minY = doorY, maxY = doorY;
    const visited = new Set();
    const queue = [[doorX, doorY]];
    visited.add(doorX + ',' + doorY);
    let guard = 0;
    while (queue.length && guard < 500) {
        guard++;
        const [cx, cy] = queue.pop();
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            const key = nx + ',' + ny;
            if (visited.has(key)) continue;
            const m = sv.mods.tiles[key];
            const tt = (m && !m.built) ? m.t : getTile(sv, nx, ny);
            if (tt === T.WALL || tt === T.DOOR) {
                visited.add(key);
                queue.push([nx, ny]);
            }
        }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const footprint = new Array(bw * bh).fill(false);
    for (const key of visited) {
        const [x, y] = key.split(',').map(Number);
        footprint[(y - minY) * bw + (x - minX)] = true;
    }
    return {
        iw: bw, ih: bh, bw, bh, footprint,
        doorLocalX: doorX - minX, doorLocalY: doorY - minY,
        minX, minY,
    };
}

export function generateInterior(seed, doorKey, floor = 1, iw = IW, ih = IH, layout = null) {
    const h = hash(seed ^ hash(doorKey.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)) + floor * 7919);
    const hasFootprint = !!(layout && Array.isArray(layout.footprint) && layout.footprint.length === iw * ih);
    const footprint = hasFootprint ? layout.footprint : new Array(iw * ih).fill(true);
    const tiles = new Array(iw * ih).fill(IT.VOID);
    const hasCell = (x, y) => x >= 0 && x < iw && y >= 0 && y < ih && !!footprint[y * iw + x];
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
        if (!hasCell(x, y)) continue;
        const perimeter = !hasCell(x - 1, y) || !hasCell(x + 1, y) || !hasCell(x, y - 1) || !hasCell(x, y + 1);
        tiles[y * iw + x] = perimeter ? IT.WALL : IT.FLOOR;
    }

    const exitX = hasFootprint ? layout.doorLocalX : Math.floor(iw / 2);
    const exitY = hasFootprint ? layout.doorLocalY : ih - 1;
    // 只有 1 层通向室外；楼上/地下室出入口位封死成墙（不能从楼上跳下去）
    if (floor === 1) tiles[exitY * iw + exitX] = IT.EXIT;
    const inward = [[0, -1], [0, 1], [-1, 0], [1, 0]]
        .map(([dx, dy]) => ({ x: exitX + dx, y: exitY + dy }))
        .filter(p => hasCell(p.x, p.y))
        .sort((a, b) => {
            const score = p => [[1, 0], [-1, 0], [0, 1], [0, -1]].reduce((n, [dx, dy]) => n + (hasCell(p.x + dx, p.y + dy) ? 1 : 0), 0);
            return score(b) - score(a);
        })[0];
    const spawnX = inward ? inward.x : exitX;
    const spawnY = inward ? inward.y : exitY;
    if (inward) tiles[spawnY * iw + spawnX] = IT.FLOOR;

    const r1 = (h & 0xff) / 255;
    const r2 = ((h >> 8) & 0xff) / 255;
    const r3 = ((h >> 16) & 0xff) / 255;
    const r4 = ((h >> 24) & 0xff) / 255;

    const floorCells = () => {
        const result = [];
        for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
            if (tiles[y * iw + x] === IT.FLOOR && !(x === spawnX && y === spawnY)) result.push([x, y]);
        }
        return result;
    };
    const area = floorCells().length;
    const depthBonus = Math.abs(floor) > 1 ? 1 : 0;
    const boxCount = area >= 3 ? 1 + Math.floor(r1 * (area / 20)) + depthBonus : 0;
    const shelfCount = Math.floor(r2 * (area / 25));
    const debrisCount = area >= 5 ? 1 + Math.floor(r3 * (area / 15)) : 0;
    const region = (layout && layout.districtKey) || 'urban';
    const boxTypeAtRoll = roll => {
        const weights = region === 'ruins' ? [0.28, 0.18, 0.12, 0.42]
            : region === 'suburb' ? [0.45, 0.12, 0.18, 0.25]
                : region === 'wild' ? [0.50, 0.08, 0.22, 0.20]
                    : [0.35, 0.25, 0.22, 0.18];
        if (roll < weights[0]) return IT.BOX;
        if (roll < weights[0] + weights[1]) return IT.WBOX;
        if (roll < weights[0] + weights[1] + weights[2]) return IT.MEDBOX;
        return IT.MATBOX;
    };
    const place = (type, count, salt) => {
        for (let i = 0; i < count; i++) {
            const available = floorCells();
            if (!available.length) break;
            const [x, y] = available[hash(h + salt + i * 97) % available.length];
            tiles[y * iw + x] = type === IT.BOX ? boxTypeAtRoll((hash(h + salt + i * 131) & 0xffff) / 65536) : type;
        }
    };
    place(IT.BOX, boxCount, 10);
    place(IT.SHELF, shelfCount, 110);
    place(IT.DEBRIS, debrisCount, 210);
    const plantRate = region === 'ruins' ? 0.10 : region === 'wild' ? 0.12 : region === 'suburb' ? 0.06 : 0.025;
    const plantCount = Math.min(3, Math.floor(area * plantRate * (0.5 + r4)));
    place(IT.PLANT, plantCount, 310);

    // 楼梯连通性（与现实一致，任何一层都能走回 1 层）：
    // 1 层只有向上的楼梯；2+ 层一定有向下楼梯（回 1 层），未到顶还配向上楼梯；
    // 地下室始终有向上楼梯（回 1 层），未到底还配向下楼梯
    const maxAbove = B.FLOOR_MAX_ABOVE;
    const maxBelow = B.FLOOR_MAX_BELOW;
    const placeStairs = (salt, type) => {
        const available = floorCells();
        if (!available.length) return;
        const [sx, sy] = available[hash(h + salt) % available.length];
        tiles[sy * iw + sx] = type;
    };
    if (floor >= 1 && floor < maxAbove) placeStairs(800, IT.STAIRS_UP);
    if (floor > 1) placeStairs(900, IT.STAIRS_DOWN);
    if (floor < 0) {
        placeStairs(1200, IT.STAIRS_UP);
        if (floor > -maxBelow) placeStairs(1000, IT.STAIRS_DOWN);
    }

    return { tiles, w: iw, h: ih, exitX, exitY, spawnX, spawnY, floor };
}

// 出生点安全化：玩家到达楼层时，出生格必须可通行且四周至少有一个可通行邻格。
// 解决"上楼出生位恰好被物体/死角堵死而卡住"：旧存档 tile 与新生成 spawn 错位、
// 楼型变化（玩家改建外墙）或 1 格宽楼颈的死角，都会导致出生即卡死——自动 BFS 到最近可走格。
export function ensureSpawnWalkable(tiles, iw, ih, sx, sy) {
    const walkable = v => v === IT.FLOOR || v === IT.EXIT || v === IT.STAIRS_UP || v === IT.STAIRS_DOWN
        || v === IT.BOX || v === IT.WBOX || v === IT.MEDBOX || v === IT.MATBOX || v === IT.DEBRIS || v === IT.PLANT;
    const free = (x, y) => x >= 0 && x < iw && y >= 0 && y < ih && walkable(tiles[y * iw + x]);
    const open = (x, y) => free(x, y) && (free(x - 1, y) || free(x + 1, y) || free(x, y - 1) || free(x, y + 1));
    if (open(sx, sy)) return [sx, sy];
    const seen = new Set([sy * iw + sx]);
    const queue = [[sx, sy]];
    for (let qi = 0; qi < queue.length; qi++) {
        const [cx, cy] = queue[qi];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= iw || ny < 0 || ny >= ih) continue;
            const k = ny * iw + nx;
            if (seen.has(k)) continue;
            seen.add(k);
            if (open(nx, ny)) return [nx, ny];
            if (free(nx, ny)) queue.push([nx, ny]);
        }
    }
    return [sx, sy];
}

// 室内僵尸数量规则（纯函数，确定性）：门口镇守僵尸与室内生成共用同一规则，
// 保证"门口守卫 = 室内僵尸跑出来的"（进入室内时按守卫数扣减 1 层数量）。
export function interiorZombieCount(seed, doorKey, floor, ringMul) {
    const h = hash(seed ^ hash(doorKey.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)) + 999 + floor * 3571);
    const floorZMul = B.FLOOR_ZOMBIE_MUL(floor);
    const roomRoll = (h % 100) / 100;
    let count;
    if (roomRoll < 0.30) count = 0;
    else if (roomRoll < 0.55) count = 1;
    else if (roomRoll < 0.75) count = Math.round((1 + (h % 2)) * floorZMul);
    else if (roomRoll < 0.92) count = Math.round((2 + (h % 3)) * floorZMul);
    else count = Math.round((4 + (h % 4)) * floorZMul * ringMul);
    return Math.max(0, Math.min(count, 10));
}

export function spawnInteriorZombies(sv, doorKey, floor = 1, subtractFromFloor1 = 0) {
    const seed = sv.world.seed;
    const parts = doorKey.split(',');
    const dx = parseInt(parts[0]) || 0, dy = parseInt(parts[1]) || 0;
    const cx = Math.floor(dx / CHUNK), cy = Math.floor(dy / CHUNK);
    const ringMul = zombieStrengthAt(seed, cx, cy);
    const h = hash(seed ^ hash(doorKey.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)) + 999 + floor * 3571);
    let count = interiorZombieCount(seed, doorKey, floor, ringMul);
    if (floor === 1 && subtractFromFloor1 > 0) count = Math.max(0, count - subtractFromFloor1);   // 门口守卫已在外，室内相应减少
    const floorZMul = B.FLOOR_ZOMBIE_MUL(floor);
    const interior = sv.interior;
    const iw = interior.w, ih = interior.h;
    const floorHpMul = B.FLOOR_HP_MUL(floor);
    for (let i = 0; i < count; i++) {
        let x, y, tries = 0;
        do {
            // 2 格宽房间 iw-2=0 → %0 = NaN（坐标全 NaN，30 次尝试后整层 0 僵尸）；max(1,..) 兜底
            x = 1 + (hash(h + i * 41 + tries) % Math.max(1, iw - 2));
            y = 1 + (hash(h + i * 53 + tries) % Math.max(1, ih - 3));
            tries++;
        } while (interior.tiles[y * iw + x] !== IT.FLOOR && tries < 30);
        if (tries >= 30) continue;

        const day = sv.day;
        const r = (hash(h + i * 67 + 300) & 0xff) / 255;
        const coneC = day >= 3 ? Math.min(0.15 + day * 0.03, 0.4) : 0;
        const bucketC = day >= 5 ? Math.min(0.05 + (day - 5) * 0.03, 0.25) : 0;
        const type = r < bucketC ? 'bucket' : (r < bucketC + coneC ? 'cone' : 'normal');
        const def = ZOMBIES[type] || ZOMBIES.normal;
        const mul = (1 + (day - 1) * B.Z_DAY_SCALE) * (B.DIFF_TABLE[sv.diffKey] || B.DIFF_TABLE.normal).mul * floorHpMul * ringMul;
        const baseHp = B.Z_SURVIVAL_HP[type] || 70;
        const totalHp = Math.round(baseHp * mul);
        interior.zombies.push({
            id: ensureZId(sv, null),   // 运行时 id：出门转世界僵尸/联机快照按 id 合并必需
            type, char: B.Z_CHAR[type] || '僵', color: def.color,
            infection: infectionLevelFromRoll((hash(h + i * 71 + 500) & 0xffff) / 65536),
            x: (x + 0.5) * TS, y: (y + 0.5) * TS,
            name: def.name || '僵尸',
            hp: totalHp, maxHp: totalHp,
            speed: def.speed * B.Z_SPEED_MUL, damage: def.damage,
            wt: 0, tx: (x + 0.5) * TS, ty: (y + 0.5) * TS, wDir: null,
            biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0,
            biteT: 0, hurt: 0, stunT: 0, horde: false,
            textAbility: null,
            atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false, comboLeft: 0,
        });
    }
}

// 2026-08-09 室内高楼层"躲藏幸存者"：2 层及以上按概率生成友善 NPC（占楼避世，无完整 AI）。
// 生成确定性（§13.2）：同 seed+doorKey+floor → 同一批躲藏者（双端进同一房间看到一样的人）。
// 存 it.npcs（简单静态对象：位置/名字/外观/背包/金币），交互复用 NPC 菜单（F 靠近交谈/交易）。
function spawnInteriorNpcs(sv, it, floor) {
    if (!it.npcs) it.npcs = [];
    const key = it.key || '';
    const seed = (sv.world && sv.world.seed) || 0;
    // 确定性判定：hash(seed, doorKey, floor) < INTERIOR_NPC_CHANCE → 出现 1~INTERIOR_NPC_MAX 名
    const seedH = hash(seed ^ hash(key.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)) + floor * 9137);
    const r = ((seedH >> 8) & 0xffff) / 65536;
    // 概率：2 楼基准 0.15%，楼层每高一层 +0.03%（INTERIOR_NPC_CHANCE_BASE / _PER_FLOOR）
    const chance = B.INTERIOR_NPC_CHANCE_BASE + Math.max(0, floor - 2) * B.INTERIOR_NPC_CHANCE_PER_FLOOR;
    if (r >= chance) return;
    const n = 1 + (seedH % B.INTERIOR_NPC_MAX);
    const iw = it.w, ih = it.h;
    const used = new Set();
    for (let i = 0; i < n; i++) {
        let x, y, tries = 0;
        do {
            x = 1 + ((seedH + i * 31 + tries * 7) % Math.max(1, iw - 2));
            y = 1 + ((seedH + i * 47 + tries * 13) % Math.max(1, ih - 3));
            tries++;
        } while ((it.tiles[y * iw + x] !== IT.FLOOR || used.has(x + ',' + y)) && tries < 40);
        if (tries >= 40) continue;
        used.add(x + ',' + y);
        const name = '幸存者' + (i + 1);
        const look = (sv.world && sv.world.look) ? null : null;   // 无外观时渲染用默认
        const inv = [{ id: 'food', n: 1 }, { id: 'water', n: 1 }];
        it.npcs.push({
            id: 'intnpc_' + key + '_' + floor + '_' + i,
            name, role: 'friendly', look: null,
            x: (x + 0.5) * TS, y: (y + 0.5) * TS,
            hp: 80, maxHp: 80, food: 70, water: 70,
            inv, coins: 30 + (seedH % 60),
            alive: true,   // 生存标记（菜单/交易检查 n.alive）
            state: 'hide',   // 躲藏：站定不动，玩家靠近 F 交谈/交易
        });
    }
}

export function enterInterior(sv, doorKey, silent) {
    if (!sv.mods.interiors) sv.mods.interiors = {};
    const floorKey = doorKey + ':1';
    const saved = sv.mods.interiors[floorKey];
    const parts = doorKey.split(',');
    const dx = parseInt(parts[0]) || 0, dy = parseInt(parts[1]) || 0;
    const meas = measureBuilding(sv, dx, dy);
    const cx = Math.floor(dx / CHUNK), cy = Math.floor(dy / CHUNK);
    const districtKey = districtAt(sv.world.seed, cx, cy);
    const gen = generateInterior(sv.world.seed, doorKey, 1, meas.iw, meas.ih, { ...meas, districtKey });
    const tiles = (saved && Array.isArray(saved.tiles) && saved.tiles.length === gen.tiles.length) ? saved.tiles.slice() : gen.tiles;
    // 2026-08-17 修复"进室内出不来"：进入室内时强制在出口位置设置 EXIT 瓦片
    // 此前 enterInterior 未像 changeFloor 那样强制设置 EXIT，导致旧存档或异常情况下
    // 出口位置可能是 WALL/FLOOR，玩家永远无法触发退出检测
    const exitIdx = gen.exitY * gen.w + gen.exitX;
    tiles[exitIdx] = IT.EXIT;
    const cleared = !!(saved && (saved === 1 || saved.cleared));
    const bType = buildingTypeAt(sv.world.seed, cx, cy);
    const bName = (bType && BUILDING_TYPES[bType]) ? BUILDING_TYPES[bType].name : '建筑';
    const [pSX, pSY] = ensureSpawnWalkable(tiles, gen.w, gen.h, gen.spawnX, gen.spawnY);
    // 门口镇守僵尸 = 室内 1 层僵尸跑出来的（带 guardDoor 标记的世界僵尸）：
    // 它们已在室外，进入室内时按数量扣减 1 层生成，避免重复计算
    const guards = (sv.zombies || []).filter(z => z.guardDoor === doorKey).length;
    sv.interior = {
        key: doorKey,
        floor: 1,
        buildingType: bType,
        districtKey,
        originX: meas.minX, originY: meas.minY,
        // 楼层规格沿用 1 层实测 footprint：楼上/地下室与 1 层同形同大
        footprint: meas.footprint,
        doorLocalX: meas.doorLocalX, doorLocalY: meas.doorLocalY,
        tiles, w: gen.w, h: gen.h, exitX: gen.exitX, exitY: gen.exitY,
        spawnX: pSX, spawnY: pSY,   // 出生位：室外僵尸进屋的落点
        zombies: [], drops: [], npcs: [],   // 2026-08-09 室内高楼层躲藏幸存者
        px: (pSX + 0.5) * TS, py: (pSY + 0.5) * TS,
        cleared,
        doorX: sv.px, doorY: sv.py,
    };
    // 1 层不生成躲藏者（低层易被清剿）；存档如有该层 npcs（从其它层切换回来？1层无）不处理
    if (!cleared) {
        if (saved && Array.isArray(saved.zombies) && saved.zombies.length) {
            for (const z of saved.zombies) sv.interior.zombies.push({ ...z, id: ensureZId(sv, z), atkState: null, atkT: 0, atkCd: 0, hasHit: false });
        } else {
            spawnInteriorZombies(sv, doorKey, 1, guards);
        }
    }
    // 2026-08-09 室内外 NPC 统一：室外跟随队员随玩家进室内——
    // party 且 state==='follow' 的 NPC 标记 inInterior（室内渲染/跟随），坐标映射到室内出生点旁。
    enterFollowers(sv, sv.interior);
    // 2026-08-17 v4.17 修复"室外能到室内，但室内到不了室外"：
    // 根因：主控 NPC（controllerId 默认 'player'）从未被标记 inInterior=true。
    // 每帧 update 开头的 syncControllerInterior 拿 wantIn=cur.inInterior（undefined/false）vs haveIn=!!sv.interior（true），
    // 立即触发 !wantIn && haveIn → WD.exitInterior(sv, true) → 玩家被强行拉回室外（甚至从未真正进入）。
    // enterFollowers 只处理 party && state==='follow' 的队员，主控 isPlayer: true 默认无 party/state 字段。
    // 修复：enterInterior / exitInterior 必须显式同步主控的 inInterior / interiorKey / interiorFloor。
    const _ctrl = WNPC.controlledNpc(sv);
    if (_ctrl) {
        _ctrl.inInterior = true;
        _ctrl.interiorKey = doorKey;
        _ctrl.interiorFloor = 1;
    }
    // 联机：室内改为各自独立进出（host/guest 各按自己的 F 键进出；同 key 确定性生成室内一致）。
    // 不再广播 interior 事件——否则"一个人进房间，另一个人被强行拉进去"。
    MSG.pushMsg(sv, cleared ? `进入${bName}（已清剿）` : `进入${bName}…`, '#D29A5B');
}

// 室外跟随队员进屋：v4.37 主控先进室，队员【陆续跟随】——主控先进 + 0.5s 延迟后队员
// 错峰进入（每个 0.4s 间隔），从室外门口坐标（it.doorX/it.doorY）寻路至室内出生点。
// 此前实现瞬移所有队员到出生点 → "我进去之后一瞬间，他们提前在里面准备好"，
// 失去了"陆续到达"的真实感（修复按用户定稿）。
function enterFollowers(sv, it) {
    if (!sv.npcs || !it) return;
    const cx = (it.spawnX + 0.5) * TS, cy = (it.spawnY + 0.5) * TS;
    const istand = (x, y) => interiorCanStand(sv, x, y);
    // v4.37 收集要跟随的队员（id 列表 + 延迟队列），主控单独立即摆放
    const _queues = [];
    for (const n of sv.npcs) {
        if (!n || !n.alive || n.riding) continue;
        if (!(n.party && n.state === 'follow')) continue;
        if (sv.controllerId && n.id === sv.controllerId) continue;
        // v4.52 进门时排除倒地/尸体成员：倒地和尸体的队员不应跟着主控穿入房间——
        // 它们留在原来的位置（可能是室外/另一房间），主控进门后走过来交互（救援/搜索）。
        if (n.downed || n._corpse) continue;
        n._exitQueued = null;   // v4.41 进门时清出门等待标记（防卡门口不动）
        _queues.push(n);
    }
    // v4.37 队长（最近主控）排第一优先入室，按与主控距离从近到远排队
    const _ctrl = WNPC.controlledNpc(sv);
    if (_ctrl) _queues.sort((a, b) => {
        const da = Math.hypot((a.x || 0) - _ctrl.x, (a.y || 0) - _ctrl.y);
        const db = Math.hypot((b.x || 0) - _ctrl.x, (b.y || 0) - _ctrl.y);
        return da - db;
    });
    // 每人错峰 0.5/0.9/1.3s ... 到达，最多 6 名（防卡墙）
    let idx = 0;
    const _doorX = it.doorX != null ? it.doorX : sv.px;
    const _doorY = it.doorY != null ? it.doorY : sv.py;
    for (const n of _queues) {
        if (idx >= 6) break;
        // 队列状态：队员仍留在室外门口，但标记进入调度（防止 ai 把他们拉去别的任务）
        n._enteringInterior = true;
        n._enterQDelay = 0.5 + idx * 0.4;
        // 在室外路径上标记 target（出生点），让他们开始往门口走再传送到室内
        if (idx === 0) {
            // 第一个跟随队员 0.5s 后立即穿入
            n._enterInterior = { key: it.key, floor: 1, cx, cy };
        } else {
            // 后续队员按延迟穿入（call 时机由 enterFollowersTick 触发）
            n._enterInteriorQueued = { key: it.key, floor: 1, cx, cy, dueAt: (sv.now || 0) + n._enterQDelay };
            n._enterQueueNote = 'entering interior soon';
            // 临时让队员立刻寻路到门口附近的临时出口点（视觉上"走向门口"）
            n._followTo = { x: _doorX + (Math.random() - 0.5) * 1.2 * TS, y: _doorY + 0.5 * TS + Math.random() * 0.6 * TS };
        }
        idx++;
    }
    // 启用渐进每帧驱动（updateInteriorMode 头部调用）
    enterFollowersTick(sv, it, cx, cy);
}

// v4.37 每帧推进队员【陆续】穿入：
// - _enterInterior 立即穿入（0.5s 后由第一个队员触发）；
// - _enterInteriorQueued 到 dueAt 时间穿入；
// - 已穿入队员在室内摆放到出生点旁（不再瞬移，用 searchSeats 给 N+1 个可走格中找空位）。
export function enterFollowersTick(sv, it, cx, cy) {
    if (!sv || !sv.npcs) return;
    const now = sv.now || 0;
    const istand = (x, y) => interiorCanStand(sv, x, y);
    const used = new Set();   // 已占据的格（避免重叠）
    const seat = (nx, ny) => {
        for (let r = 0; r < 3; r++) for (let cx2 = -r; cx2 <= r; cx2++) for (let cy2 = -r; cy2 <= r; cy2++) {
            if (Math.max(Math.abs(cx2), Math.abs(cy2)) !== r) continue;
            const tx = (nx + cx2 * 1.4 * TS), ty = (ny + cy2 * 1.0 * TS);
            if (!istand(tx, ty)) continue;
            const key = Math.floor(tx / (TS / 2)) + ',' + Math.floor(ty / (TS / 2));
            if (used.has(key)) continue;
            used.add(key);
            return { x: tx, y: ty };
        }
        return { x: nx, y: ny };
    };
    for (const n of sv.npcs) {
        if (!n || !n.alive) continue;
        if (n._enterInterior) {
            n.inInterior = true;
            n.interiorKey = n._enterInterior.key;
            n.interiorFloor = n._enterInterior.floor;
            const s = seat(n._enterInterior.cx, n._enterInterior.cy);
            n.x = s.x; n.y = s.y;
            n._enterInterior = null;
            n._enteringInterior = false;
            n._followTo = null;
            n._path = null;
            n._probeDir = null;
        } else if (n._enterInteriorQueued && now >= n._enterInteriorQueued.dueAt) {
            n.inInterior = true;
            n.interiorKey = n._enterInteriorQueued.key;
            n.interiorFloor = n._enterInteriorQueued.floor;
            const s = seat(n._enterInteriorQueued.cx, n._enterInteriorQueued.cy);
            n.x = s.x; n.y = s.y;
            n._enterInteriorQueued = null;
            n._enteringInterior = false;
            n._followTo = null;
            n._path = null;
            n._probeDir = null;
        }
    }
}

export function exitInterior(sv, silent) {
    const it = sv.interior;
    if (!it) return;
    const key = it.key;
    const allDead = it.zombies.length === 0;
    if (!sv.mods.interiors) sv.mods.interiors = {};
    const floorKey = key + ':' + (it.floor || 1);
    const prev = sv.mods.interiors[floorKey] || sv.mods.interiors[key];
    sv.mods.interiors[floorKey] = {
        v: 2,
        cleared: (allDead || (prev && (prev === 1 || prev.cleared))) ? 1 : 0,
        tiles: it.tiles,
        // 保存存活僵尸的血量/位置，进出门不重置
        zombies: it.zombies.map(z => ({
            id: z.id,
            type: z.type, char: z.char, color: z.color, name: z.name,
            x: z.x, y: z.y, tx: z.tx, ty: z.ty,
            hp: z.hp, maxHp: z.maxHp, speed: z.speed, damage: z.damage,
            wt: z.wt || 0, biteT: 0, hurt: 0, stunT: 0, horde: false,
            atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false,
        })),
        // 2026-08-09 室内高楼层躲藏幸存者存档
        npcs: (it.npcs || []).map(n => ({
            id: n.id, name: n.name, role: n.role || 'friendly', look: n.look || null,
            x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp,
            food: n.food, water: n.water, inv: n.inv || [], coins: n.coins || 0,
        })),
    };
    sv.px = it.doorX;
    sv.py = it.doorY;
    sv.interior = null;
    // 2026-08-17 v4.17 修复"室内到不了室外"：主控的 inInterior 标记必须随 sv.interior=null 同步清掉，
    // 否则下一帧 syncControllerInterior 看到 wantIn=true && haveIn=false 又会调 enterInterior 把玩家拉回室内。
    // （主控 isPlayer=true 在 enterInterior 中被显式设 inInterior=true，对称地 exitInterior 必须清掉）
    const _ctrl = WNPC.controlledNpc(sv);
    if (_ctrl) {
        _ctrl.inInterior = false;
        _ctrl.interiorKey = null;
        _ctrl.interiorFloor = null;
    }
    // v4.39 队伍成员跟着主控出门（用户反馈"出了房间队友没有跟着我出来"）：
    // 同房间的活 party 队员 inInterior 设为 false，放到门口世界坐标 sv.px/sv.py 偏移处。
    // 与 changeFloor（v4.35）"同房间同层队员跟着"语义一致——出房间 = 跨场景的"跟随"。
    // v4.41 修复"出房间一次性瞬移卡进建筑"（用户反馈）：① 不再固定 +0.6TS 偏移（可能卡墙），
    // 改为在门口格 3×3 环形找【最近可走格】；② 出门错峰——队员站门口 0.25/0.6/0.95s… 后逐个
    // 恢复跟随（exitFollowersTick 每帧到点唤醒），与"进屋陆续穿入"（v4.37）对称，不再是"一瞬间全出来"。
    if (sv.npcs) {
        const used = new Set();
        const seat = (nx, ny) => {
            for (let r = 0; r <= 3; r++) {
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const gx = nx + dx, gy = ny + dy;
                    if (!isWalk(getTile(sv, gx, gy))) continue;
                    const gkey = gx + ',' + gy;
                    if (used.has(gkey)) continue;
                    used.add(gkey);
                    return { x: (gx + 0.5) * TS, y: (gy + 0.5) * TS };
                }
            }
            return { x: nx * TS + TS / 2, y: ny * TS + TS / 2 };   // 兜底：门口中心（玩家能站，队友大概率也能站）
        };
        const _dgx = Math.floor(sv.px / TS), _dgy = Math.floor(sv.py / TS);
        let _seq = 0;
        for (const n of sv.npcs) {
            if (!n || !n.alive || n.riding) continue;
            if (!(n.party && n.inInterior)) continue;
            if (n.interiorKey !== key) continue;
            if (_ctrl && n.id === _ctrl.id) continue;
            // v4.52 排除倒地/尸体成员：倒地（downed）和尸体（_corpse）NPC 不应跟随主控切换场景——
            // 它们留在原地（inInterior 保留+原坐标），后续队友可在该房间交互（救援/搜索）。
            // 用户反馈"从室内出来时，尸体也跟出来了"——根因是 exitInterior 没过滤非活体。
            if (n.downed || n._corpse) continue;
            n.inInterior = false;
            n.interiorKey = null;
            n.interiorFloor = null;
            const s = seat(_dgx, _dgy);
            n.x = s.x; n.y = s.y;
            // 出门错峰：第 1 个 0.25s 后走，后续每个 +0.35s（与进屋 enterQDelay 对称）
            n._exitQueued = { dueAt: (sv.now != null ? sv.now : 0) + 0.25 + _seq * 0.35 };
            n._path = null;
            n._probeDir = null;
            n._lastSlideDir = null;
            _seq++;
        }
    }
    // 联机：退出室内不再广播（各自独立进出）
    MSG.pushMsg(sv, allDead ? '已清剿，回到室外' : '回到室外（室内僵尸仍在）');
}

// v4.41 出门错峰：队员标记 _exitQueued 期间站在门口等待（AI 由 updateNpcs 跳过），
// 到 dueAt 时间清除标记恢复跟随——视觉上"从门里陆续走出来"而非一次性瞬移。
export function exitFollowersTick(sv) {
    if (!sv || !sv.npcs) return;
    const now = sv.now || 0;
    for (const n of sv.npcs) {
        if (!n || !n.alive || !n._exitQueued) continue;
        if (now >= n._exitQueued.dueAt) n._exitQueued = null;
    }
}

// 僵尸存档序列化（进出门/换层/迁徙共用；不携带迁移临时状态）
function serializeZombie(z, x, y) {
    return {
        id: z.id,
        type: z.type, char: z.char, color: z.color, name: z.name,
        x: x != null ? x : z.x, y: y != null ? y : z.y, tx: x != null ? x : z.tx, ty: y != null ? y : z.ty,
        hp: z.hp, maxHp: z.maxHp, speed: z.speed, damage: z.damage,
        wt: z.wt || 0, biteT: 0, hurt: 0, stunT: 0, horde: false,
        infection: z.infection, textAbility: z.textAbility || null,
        atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false,
    };
}

// 迁徙目标格：楼上 → 楼梯口；1 层 → 门口（出口格）
function migrationTarget(it) {
    const want = it.floor > 1 ? IT.STAIRS_DOWN : IT.EXIT;
    for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
        if (it.tiles[y * it.w + x] === want) return { x, y };
    }
    return null;
}

// 迁徙到达目标：下楼（写入下层存档，玩家下楼时会遇到它）或出门（转为门口世界僵尸）
function migrateZombie(sv, it, z) {
    if (it.floor > 1) {
        const lower = it.floor - 1;
        const gen = generateInterior(sv.world.seed, it.key, lower, it.w, it.h, {
            footprint: it.footprint, doorLocalX: it.doorLocalX, doorLocalY: it.doorLocalY,
            districtKey: it.districtKey,
        });
        // 落点优先下层楼梯口（它从楼梯下来），没有则用出生点
        let lx = gen.spawnX, ly = gen.spawnY;
        for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
            if (gen.tiles[y * it.w + x] === IT.STAIRS_UP) { lx = x; ly = y; }
        }
        const [px, py] = ensureSpawnWalkable(gen.tiles, it.w, it.h, lx, ly);
        const fkey = it.key + ':' + lower;
        if (!sv.mods.interiors) sv.mods.interiors = {};
        if (!sv.mods.interiors[fkey]) sv.mods.interiors[fkey] = { v: 2, cleared: 0, zombies: [] };
        sv.mods.interiors[fkey].zombies.push(serializeZombie(z, (px + 0.5) * TS, (py + 0.5) * TS));
        z._migOut = true;
    } else {
        // 走出门口 → 门口可站格 → 世界僵尸（带 guardDoor 标记：重进室内按守卫扣减）
        const [dx, dy] = it.key.split(',').map(Number);
        let px = (dx + 0.5) * TS, py = (dy + 1.5) * TS;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const tt = getTile(sv, dx + ox, dy + oy);
            if (isWalk(tt)) { px = (dx + ox + 0.5) * TS; py = (dy + oy + 0.5) * TS; break; }
        }
        const nz = Object.assign({}, z, {
            x: px, y: py, tx: px, ty: py, wDir: null,
            guardDoor: it.key,
            atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false,
        });
        sv.zombies.push(nz);
        z._migOut = true;
    }
}

export function interiorWalkable(sv, gx, gy) {
    const it = sv.interior;
    if (!it) return false;
    if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) return false;
    const t = it.tiles[gy * it.w + gx];
    return t === IT.FLOOR || t === IT.EXIT || t === IT.BOX || t === IT.WBOX || t === IT.MEDBOX || t === IT.MATBOX || t === IT.DEBRIS || t === IT.PLANT || t === IT.STAIRS_UP || t === IT.STAIRS_DOWN;
}

export function interiorCanStand(sv, x, y) {
    const r = 11;
    for (let i = 0; i < 4; i++) {
        const cx = x + (i % 2 ? r : -r), cy = y + (i < 2 ? r : -r);
        if (!interiorWalkable(sv, Math.floor(cx / TS), Math.floor(cy / TS))) return false;
    }
    return true;
}

// 室内寻路场：从玩家所在格 BFS 反向扩展，parent 表给出每格"朝玩家"的下一步（与室外 A* 一致，房间小开销低）
function getInteriorPathField(sv) {
    const it = sv.interior;
    const key = 'I:' + (it.key || '') + ':' + Math.floor(it.px / TS) + ',' + Math.floor(it.py / TS);
    if (it._pathField && it._pathField.key === key) return it._pathField;
    const w = it.w, h = it.h;
    const sx = Math.floor(it.px / TS), sy = Math.floor(it.py / TS);
    const parent = new Map();
    const queue = [[sx, sy]];
    const sKey = sy * w + sx;
    parent.set(sKey, null);
    for (let qi = 0; qi < queue.length; qi++) {
        const [cx, cy] = queue[qi];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nKey = ny * w + nx;
            if (parent.has(nKey)) continue;
            const t = it.tiles[nKey];
            if (!(t === IT.FLOOR || t === IT.EXIT || t === IT.BOX || t === IT.WBOX || t === IT.MEDBOX || t === IT.MATBOX || t === IT.DEBRIS || t === IT.PLANT || t === IT.STAIRS_UP || t === IT.STAIRS_DOWN)) continue;
            parent.set(nKey, [cx, cy]);
            queue.push([nx, ny]);
        }
    }
    it._pathField = { key, parent };
    return it._pathField;
}

export function updateInterior(sv, dt) {
    const it = sv.interior;
    if (!it) return;

    const idiff = (B.DIFF_TABLE[sv.diffKey] || B.DIFF_TABLE.normal).mul;
    const istand = (x, y) => interiorCanStand(sv, x, y);
    const pathField = getInteriorPathField(sv);
    for (const z of it.zombies) {
        if (z.hurt > 0) z.hurt -= dt;
        if (z.slowT > 0) z.slowT -= dt;
        else z.slowMul = 0;
        if (z.stunT > 0) { z.stunT -= dt; continue; }
        if (z.biteCd > 0) z.biteCd -= dt;
        if (z.lungeCd > 0) z.lungeCd -= dt;
        if (z.lungeT > 0) z.lungeT -= dt;
        const dx = it.px - z.x, dy = it.py - z.y;
        const dist = Math.hypot(dx, dy) || 1;
        const contact = B.Z_CONTACT[z.type] || B.Z_CONTACT.normal;
        const dmgTo = contact.dmg * idiff;

        // 碰撞攻击（与室外一致：持续啃咬——血条缓慢减少，DPS=dmgTo/biteCd，0.3s 节拍反馈；
        // 触发距离用 Z_BITE_RANGE(44) 覆盖相邻格，同室外修复 2026-08-09）
        if (dist < B.Z_BITE_RANGE) {
            const dps = dmgTo / (contact.biteCd || 1);
            WA.resolvePlayerBiteTick(sv, z, dps, dt, istand);
        }
        // v4.11 室内僵尸也咬 NPC（与室外 wzombie.js 同款咬扫；此前室内只咬主控 → 队友/敌对NPC
        // 在室内免疫僵尸攻击，室内外玩法不同步）：
        //   · 已倒地成员：npcApplyDownedHit 扣救援时间（每 1 点伤害 -10 秒，v4.11 已修）；
        //   · 存活 NPC：持续扣血（hp 下限 0）+ 节拍触发 maybeWound/maybeInfectNpc（感染/侵蚀/属性降）；
        //   · hp≤0：队员（n.party）走 npcDowned 倒地待救，非队员直接死亡；
        //   · 只咬"当前房间"的 NPC（inInterior 且 interiorKey 匹配当前房），室外 NPC 坐标不同不能咬。
        z._npcScanT = (z._npcScanT || 0) - dt;
        if (sv.npcs && z._npcScanT <= 0) {
            z._npcScanT = 0.2;
            for (const n of sv.npcs) {
                if (!n.alive) continue;
                if (!n.inInterior || (sv.interior && n.interiorKey && sv.interior.key && n.interiorKey !== sv.interior.key)) continue;
                // v4.35 只咬当前楼层 NPC：不同楼层共享坐标空间，不隔离会"隔层啃咬"（楼上僵尸咬楼下队员）
                if ((n.interiorFloor == null ? 1 : n.interiorFloor) !== (it.floor || 1)) continue;
                if (sv.controllerId && n.id === sv.controllerId) continue;   // 主控走玩家受伤路径
                if (Math.hypot(n.x - z.x, n.y - z.y) >= B.Z_BITE_RANGE) continue;
                if (n.downed) {
                    z.faceDir = Math.atan2(n.y - z.y, n.x - z.x);
                    WNPC.npcApplyDownedHit(sv, n, (dmgTo / (contact.biteCd || 1)) * 0.2);
                    continue;
                }
                // 车内护甲（与室外一致）：乘车成员不受伤，车壳吃半伤
                if (n.riding && sv.driving) {
                    if (sv.driving.hp > 0) sv.driving.hp = Math.max(0, sv.driving.hp - (dmgTo / (contact.biteCd || 1)) * 0.5 * 0.2);
                    continue;
                }
                z.faceDir = Math.atan2(n.y - z.y, n.x - z.x);
                const npcDps = dmgTo / (contact.biteCd || 1);
                n.hp = Math.max(0, n.hp - npcDps * 0.2);
                n._lastBiter = z;   // v4.23 死因（"被<僵尸名>击杀"）
                z._biteSfxT = (z._biteSfxT || 0) - 0.2;
                if (z._biteSfxT <= 0) {
                    z._biteSfxT = B.Z_BITE_INTERVAL; n.hurtT = 0.3;
                    WNPC.maybeWound(sv, n);
                    WNPC.maybeInfectNpc(sv, n);   // 被咬累积感染（所有 NPC 生效，v4.11）
                    sv.effects.push({ kind: 'hit', x: n.x, y: n.y, life: 0.2, maxLife: 0.2, label: '咬' });
                }
                if (n.hp <= 0) {
                    WNPC.npcDowned(sv, n, '被僵尸啃咬濒死');
                    break;
                }
            }
        }
        // 扑咬（快速型：中距离突进 + 命中控制）
        if (contact.lunge > 0 && z.lungeCd <= 0 && dist < B.Z_LUNGE_TRIGGER_DIST && dist > B.Z_CONTACT_DIST) {
            z.lungeCd = B.Z_LUNGE_CD;
            z.lungeT = 0.2;
            const la = Math.atan2(dy, dx);
            const lx = z.x + Math.cos(la) * contact.lunge, ly = z.y + Math.sin(la) * contact.lunge;
            if (istand(lx, z.y)) z.x = lx;
            if (istand(z.x, ly)) z.y = ly;
            if (Math.hypot(it.px - z.x, it.py - z.y) < B.Z_CONTACT_DIST + 10) {
                WA.resolvePlayerHit(sv, z, dmgTo, istand);
                if (contact.stunTime > 0) WA.applyAtkSlow(sv, contact.stunTime * 1.5);
            }
        }

        // 移动（与室外一致：扑咬突进 → 寻路跟随 → 追击 → 游荡；空闲僵尸会向楼下/门口迁徙）
        let mvx, mvy, spd;
        const typeSpd = contact.speedMul || 1;
        const zKey = Math.floor(z.y / TS) * it.w + Math.floor(z.x / TS);
        const pathStep = pathField.parent.get(zKey);
        // 迁徙中：径直走向楼下楼梯 / 1 层门口，到达即下楼或出门
        if (z._migrating && z._migTarget) {
            const mx = z._migTarget.x - z.x, my = z._migTarget.y - z.y;
            const md = Math.hypot(mx, my) || 1;
            const mspd = z.speed * typeSpd * B.Z_WANDER_SPEED;
            const mnx = z.x + mx / md * mspd * dt, mny = z.y + my / md * mspd * dt;
            if (istand(mnx, z.y)) z.x = mnx;
            if (istand(z.x, mny)) z.y = mny;
            if (md < TS * 0.6) migrateZombie(sv, it, z);
            continue;
        }
        if (z.lungeT > 0) {
            mvx = dx / dist; mvy = dy / dist;
            spd = z.speed * typeSpd * 3.5;
        } else if (pathStep) {
            const qx = (pathStep[0] + 0.5) * TS - z.x, qy = (pathStep[1] + 0.5) * TS - z.y;
            const qd = Math.hypot(qx, qy) || 1;
            mvx = qx / qd; mvy = qy / qd;
            spd = z.speed * typeSpd * B.Z_CHASE_SPEED_MUL;
        } else if (dist < 4 * TS) {
            mvx = dx / dist; mvy = dy / dist;
            spd = z.speed * typeSpd * B.Z_CHASE_SPEED_MUL;
        } else {
            // 空闲游荡：间隔性触发迁徙（3 层→2 层→1 层→走出门口当守卫）
            z._migT = (z._migT == null) ? Z_MIGRATE_IDLE + Math.random() * 26 : z._migT;
            z._migT -= dt;
            if (z._migT <= 0) {
                z._migT = Z_MIGRATE_RETRY + Math.random() * 25;
                const tg = migrationTarget(it);
                if (tg) {
                    z._migrating = true;
                    z._migTarget = { x: (tg.x + 0.5) * TS, y: (tg.y + 0.5) * TS };
                    continue;
                }
            }
            z.wt -= dt;
            if (z.wt <= 0 || z.wDir == null) {
                z.wt = 1.5 + Math.random() * 2.5;
                z.wDir = Math.random() * Math.PI * 2;
            }
            mvx = Math.cos(z.wDir); mvy = Math.sin(z.wDir);
            spd = z.speed * typeSpd * B.Z_WANDER_SPEED;
        }
        const slowFactor = z.slowMul ? (1 - z.slowMul) : 1;
        const nx = z.x + mvx * spd * slowFactor * dt;
        const ny = z.y + mvy * spd * slowFactor * dt;
        if (istand(nx, z.y)) z.x = nx;
        if (istand(z.x, ny)) z.y = ny;
        if (!pathStep && !istand(nx, z.y) && !istand(z.x, ny)) {
            z.wDir = Math.random() * Math.PI * 2;
            z.wt = 1.5 + Math.random() * 2;
        }
    }

    for (let i = it.zombies.length - 1; i >= 0; i--) {
        const z = it.zombies[i];
        if (z._migOut) { it.zombies.splice(i, 1); continue; }   // 已下楼 / 已出门
        if (z.hp > 0) continue;
        // v4.39 用户反馈"室内队员尸变丧尸被击败未生成对应尸体"：原实现室内击杀走 loot 掉落 + 移除 it.zombies，
        // 漏掉 wzombie.js 处的 `z._reviveFromCorpse` 分支（生成"XX（尸变）"尸体），导致室内的尸变丧尸击杀没产生可搜尸体。
        // 修复：调用 WCorpse.reviveZombieToCorpse（已按 sv.interior 落地同房间/楼层，v4.37）。
        if (z._reviveFromCorpse && typeof WCorpse !== 'undefined' && WCorpse.reviveZombieToCorpse) {
            WCorpse.reviveZombieToCorpse(sv, z);
        }
        if (Math.random() < zombieBagDropChance(z.type)) {
            const quality = rollQualityLoot(z.type);
            const contents = rollLootContents(quality, z.type);
            if (contents.length) it.drops.push({ x: z.x, y: z.y, id: 'loot:' + quality, n: 1, contents });
        }
        sv.effects.push({ kind: 'dead', x: z.x, y: z.y, life: 0.6, maxLife: 0.6, label: z.name });
        AudioSystem.playZombieDie();
        it.zombies.splice(i, 1);
    }

    // 室外僵尸进屋：门口附近（世界坐标）的僵尸被拉进室内 1 层出生点（仅 1 层生效）
    // 联机 guest：sv.zombies 是 host 快照的室外僵尸，本地拉进室内会造成双端不一致 → 跳过
    if (it.floor === 1 && sv.zombies && (!sv.mp || sv.mp.role === 'host')) {
        it._pullT = (it._pullT || 0) - dt;
        if (it._pullT <= 0) {
            it._pullT = 2;
            const [dx, dy] = it.key.split(',').map(Number);
            const doorX = (dx + 0.5) * TS, doorY = (dy + 0.5) * TS;
            for (let i = sv.zombies.length - 1; i >= 0; i--) {
                const wz = sv.zombies[i];
                if (wz.hp <= 0) continue;
                if (Math.hypot(wz.x - doorX, wz.y - doorY) > Z_ENTRY_RANGE * TS) continue;
                sv.zombies.splice(i, 1);
                const sx = (it.spawnX + 0.5) * TS, sy = (it.spawnY + 0.5) * TS;
                const nz = Object.assign({}, wz, {
                    x: sx, y: sy, tx: sx, ty: sy, wDir: null,
                    atkState: null, atkT: 0, atkCd: 0, hasHit: false,
                });
                it.zombies.push(nz);
                if (it.zombies.length < 14) continue;   // 每轮可多拉几只，但避免室内挤爆
                break;
            }
        }
    }

    for (let i = it.drops.length - 1; i >= 0; i--) {
        const d = it.drops[i];
        if (Math.hypot(d.x - it.px, d.y - it.py) < B.PICKUP_RADIUS) {
            if (d.id.startsWith('loot:')) {
                if (Panel.addItemLoot(sv, { id: d.id, n: 1, contents: d.contents || [] })) {
                    MSG.pushMsg(sv, `拾取 ${Panel.getItemInfo(d.id).name}`);
                    AudioSystem.playCollect();
                    it.drops.splice(i, 1);
                }
            } else {
                const info = Panel.getItemInfo(d.id);
                const left = Panel.addItem(sv, d.id, d.n);
                if (left < d.n) {
                    MSG.pushMsg(sv, `拾取 ${info.name} ×${d.n - left}`);
                    if (d.id === 'sun') AudioSystem.playCollect();
                    else if (d.id === 'gem') AudioSystem.playGemPickup();
                }
                if (left <= 0) it.drops.splice(i, 1);
                else d.n = left;
            }
        }
    }

    const pgx = Math.floor(it.px / TS), pgy = Math.floor(it.py / TS);
    if (sv._floorCd > 0) { sv._floorCd -= dt; }
    else if (pgx >= 0 && pgx < it.w && pgy >= 0 && pgy < it.h) {
        const tile = it.tiles[pgy * it.w + pgx];
        if (tile === IT.EXIT) {
            exitInterior(sv);
            sv._floorCd = 0.5;
            return;
        }
        // v4.43 用户定稿："上下楼梯必须要用交互按F才能上下楼，角色接触是不会上下楼的"——
        // 楼梯不自动换层（角色接触/踩到楼梯均不触发），只走 F 交互（doInteriorInteract 读 promptTarget.stairs）。
    }
}

export function changeFloor(sv, dir, silent) {
    const it = sv.interior;
    const curFloor = it.floor || 1;
    const nextFloor = curFloor + dir;
    if (nextFloor > B.FLOOR_MAX_ABOVE || nextFloor < -B.FLOOR_MAX_BELOW) return;
    if (!sv.mods.interiors) sv.mods.interiors = {};
    const key = it.key;
    const floorKey = key + ':' + curFloor;
    sv.mods.interiors[floorKey] = {
        v: 2,
        cleared: it.zombies.length === 0 ? 1 : 0,
        tiles: it.tiles,
        zombies: it.zombies.map(z => ({
            id: z.id,
            type: z.type, char: z.char, color: z.color, name: z.name,
            x: z.x, y: z.y, tx: z.tx, ty: z.ty,
            hp: z.hp, maxHp: z.maxHp, speed: z.speed, damage: z.damage,
            wt: 0, biteT: 0, hurt: 0, stunT: 0, horde: false,
            infection: z.infection, textAbility: z.textAbility || null,
            atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false,
        })),
        // 2026-08-09 室内高楼层躲藏幸存者存档（离开楼层时保存）
        npcs: (it.npcs || []).map(n => ({
            id: n.id, name: n.name, role: n.role || 'friendly', look: n.look || null,
            x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp,
            food: n.food, water: n.water, inv: n.inv || [], coins: n.coins || 0,
        })),
    };
    const nextKey = key + ':' + nextFloor;
    const saved = sv.mods.interiors[nextKey];
    // 楼层规格与 1 层同形：上层沿用 1 层实测 footprint（旧存档缺 v:2 标记 = 旧全矩形布局，重新生成）
    const gen = generateInterior(sv.world.seed, key, nextFloor, it.w, it.h, {
        footprint: it.footprint, doorLocalX: it.doorLocalX, doorLocalY: it.doorLocalY,
        districtKey: it.districtKey,
    });
    // 尺寸不符（楼型被玩家改建导致 footprint 变化）的旧存档直接作废重生成，避免 tile 与坐标错位
    const tiles = (saved && saved.v === 2 && Array.isArray(saved.tiles) && saved.tiles.length === it.w * it.h) ? saved.tiles.slice() : gen.tiles;
    const exitIdx = gen.exitY * it.w + gen.exitX;
    if (nextFloor === 1) tiles[exitIdx] = IT.EXIT;
    else if (tiles[exitIdx] === IT.EXIT) tiles[exitIdx] = IT.WALL;
    const cleared = !!(saved && (saved === 1 || saved.cleared));
    it.tiles = tiles;
    it.floor = nextFloor;
    it.zombies = [];
    it.drops = [];
    // 出生点安全化：杜绝上楼出生位被物体/死角堵住而卡死
    const [pSX, pSY] = ensureSpawnWalkable(tiles, it.w, it.h, gen.spawnX, gen.spawnY);
    it.px = (pSX + 0.5) * TS;
    it.py = (pSY + 0.5) * TS;
    it.cleared = cleared;
    it.npcs = [];
    if (!cleared) {
        if (saved && Array.isArray(saved.zombies) && saved.zombies.length) {
            for (const z of saved.zombies) it.zombies.push({ ...z, id: ensureZId(sv, z), atkState: null, atkT: 0, atkCd: 0, hasHit: false });
        } else {
            spawnInteriorZombies(sv, key, nextFloor);
        }
    }
    // 2026-08-09 室内高楼层 NPC：2 层及以上首次进入（无存档）时按概率出现"躲藏幸存者"（友善 NPC）
    // 存 it.npcs（简单静态对象，无完整 AI——躲在楼里的幸存者）；存档恢复（saved.npcs）
    if (saved && Array.isArray(saved.npcs) && saved.npcs.length) {
        for (const n of saved.npcs) it.npcs.push({ ...n });
    } else if (nextFloor >= 2 && !cleared) {
        spawnInteriorNpcs(sv, it, nextFloor);
    }
    const floorName = nextFloor > 1 ? `${nextFloor}层` : nextFloor < 0 ? `地下${Math.abs(nextFloor)}层` : '1层';
    const _ctrl = WNPC.controlledNpc(sv);
    // v4.35 队伍成员跟着上下楼（用户反馈"主控上楼，队伍成员没跟着上楼，却在二楼隔层造成伤害"）：
    // 同房间、同楼层的 party 队员（非主控）切到新楼层，位置放到新楼层对应楼梯口
    //（上楼 → 新楼层 STAIRS_DOWN 格旁；下楼 → 新楼层 STAIRS_UP 格旁），与主控瞬移上楼一致。
    // 否则队员 interiorFloor 停留在旧楼层：室内驱动仍会驱动它（updateInteriorMode 只查 inInterior），
    // 且不同楼层共享坐标空间 → 队员"看不见人影却能对其它楼层僵尸造成伤害"。
    {
        let _destStair = null;
        const _want = dir > 0 ? IT.STAIRS_DOWN : IT.STAIRS_UP;
        for (let y = 0; y < it.h && !_destStair; y++) for (let x = 0; x < it.w; x++) {
            if (tiles[y * it.w + x] === _want) { _destStair = { x: (x + 0.5) * TS, y: (y + 0.5) * TS }; break; }
        }
        if (sv.npcs) for (const n of sv.npcs) {
            if (!n || !n.alive || n.inInterior !== true) continue;
            if (n.interiorKey !== it.key) continue;
            if ((n.interiorFloor == null ? 1 : n.interiorFloor) !== curFloor) continue;
            if (_ctrl && n.id === _ctrl.id) continue;   // 主控已在出生点
            // v4.52 排除倒地/尸体成员：倒地和尸体的队员留在原楼层（不跟着上楼/下楼），
            // 后续主控或队友可在该楼层原位置交互（救援/搜索）。
            if (n.downed || n._corpse) continue;
            n.interiorFloor = nextFloor;
            if (_destStair) { n.x = _destStair.x; n.y = _destStair.y; }
            n._path = null;   // 清寻路缓存（新楼层布局不同）
            n._pathF = null;
            n._lastSlideDir = null;
        }
    }
    // 2026-08-17 v4.17 同步主控的 interiorFloor（与 enterInterior 配对）：changeFloor 不改 inInterior（玩家始终在室内），
    // 但 interiorFloor 必须更新，否则 syncControllerInterior 拿 wantIn=true && haveIn=true → 不会重入，
    // 但 saved 重新进入同房间会跳回旧楼层（curFloor=1）→ 玩家被困在旧层。
    if (_ctrl) _ctrl.interiorFloor = nextFloor;
    // 联机：楼层切换不再广播（各自独立进出室内）
    MSG.pushMsg(sv, `${dir > 0 ? '上楼' : '下楼'} → ${floorName}`, '#D29A5B');
}

// （联机楼层切换已随室内独立进出取消：changeFloor 只由 updateInterior 本地触发）

// 2026-08-17 v4.16 室内相机：小房间（≤画布）居中显示；大房间（>画布，玩家自建超大房）让玩家居中跟随。
// 此前 ox = (W - totalW) / 2 写死导致大房间被裁剪（左/上/右/下出屏），玩家走出屏幕。
// 抽成公共函数供 drawInterior（render.js）和 updateInteriorMode（survival.js）共用——
// 两处必须算同一份 ox/oy，否则 sv.camX/camY（外部代码用）与 draw 内部偏移不一致，
// 鼠标→世界坐标换算会偏，玩家屏幕位置错乱。
export function computeInteriorCam(sv, W, H) {
    const it = sv && sv.interior;
    if (!it) return { ox: 0, oy: 0 };
    const totalW = it.w * TS, totalH = it.h * TS;
    if (totalW <= W && totalH <= H) {
        // 小房间：完整居中（四边有黑边）
        return { ox: (W - totalW) / 2, oy: (H - totalH) / 2 };
    }
    // 大房间：玩家居中（屏幕中心），相机夹紧到房间边界（保证房间不出屏）
    // 玩家屏幕 x = ox + sv.px = W/2 → ox = W/2 - sv.px
    // 夹紧：ox >= W - totalW（右边贴屏幕）且 ox <= 0（左边贴屏幕）
    return {
        ox: Math.max(W - totalW, Math.min(0, W / 2 - sv.px)),
        oy: Math.max(H - totalH, Math.min(0, H / 2 - sv.py)),
    };
}
