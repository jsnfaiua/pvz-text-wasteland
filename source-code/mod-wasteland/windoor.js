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
    // 2026-08-10 收集建筑全部门（外部看几个门，内部就有几个出口——室内外空间一致）
    const doorsLocal = [];
    for (const key of visited) {
        const [x, y] = key.split(',').map(Number);
        footprint[(y - minY) * bw + (x - minX)] = true;
        const m = sv.mods.tiles[key];
        const tt = (m && !m.built) ? m.t : getTile(sv, x, y);
        if (tt === T.DOOR) doorsLocal.push([x - minX, y - minY]);
    }
    return {
        iw: bw, ih: bh, bw, bh, footprint,
        doorLocalX: doorX - minX, doorLocalY: doorY - minY,
        doorsLocal,   // 所有门（局部坐标，含起点门）
        minX, minY,
    };
}

export function generateInterior(seed, doorKey, floor = 1, iw = IW, ih = IH, layout = null) {
    const h = hash(seed ^ hash(doorKey.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)) + floor * 7919);
    const hasFootprint = !!(layout && Array.isArray(layout.footprint) && layout.footprint.length === iw * ih);
    const footprint = hasFootprint ? layout.footprint : new Array(iw * ih).fill(true);
    const tiles = new Array(iw * ih).fill(IT.VOID);
    const hasCell = (x, y) => x >= 0 && x < iw && y >= 0 && y < ih && !!footprint[y * iw + x];
    // 2026-08-10 用户要求"室外规格减一圈墙、墙公共边不断、角落不缺"：
    // 改用 8 邻腐蚀判定边界——仅 4 邻判定会让 L形/十字形建筑凹角处的墙
    // 被腐蚀成空洞（公共边中断、角落缺一格）。8 邻（含对角）在凹角处补墙，
    // 内部空间 = 外部 footprint 精确减一圈连续墙。
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
        if (!hasCell(x, y)) continue;
        let perimeter = false;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            if (!hasCell(x + dx, y + dy)) { perimeter = true; break; }
        }
        tiles[y * iw + x] = perimeter ? IT.WALL : IT.FLOOR;
    }

    const exitX = hasFootprint ? layout.doorLocalX : Math.floor(iw / 2);
    const exitY = hasFootprint ? layout.doorLocalY : ih - 1;
    // 只有 1 层通向室外；楼上/地下室出入口位封死成墙（不能从楼上跳下去）。
    // 2026-08-10 室内外空间一致：外部建筑有几个门（layout.doorsLocal），内部就有几个
    // 出口（EXIT）——从哪个门进就从哪个门出，双门建筑内部不再被墙封死第二个门。
    const exitCells = [];
    if (hasFootprint && Array.isArray(layout.doorsLocal) && layout.doorsLocal.length) {
        for (const [dx2, dy2] of layout.doorsLocal) exitCells.push([dx2, dy2]);
    } else {
        exitCells.push([exitX, exitY]);
    }
    if (floor === 1) {
        for (const [ex, ey] of exitCells) {
            if (ex >= 0 && ex < iw && ey >= 0 && ey < ih && hasCell(ex, ey)) tiles[ey * iw + ex] = IT.EXIT;
        }
    } else {
        // 楼上：所有门位封死成墙（不能从楼上跳出去）
        for (const [ex, ey] of exitCells) {
            if (ex >= 0 && ex < iw && ey >= 0 && ey < ih && hasCell(ex, ey)) tiles[ey * iw + ex] = IT.WALL;
        }
    }
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
    // 地下室始终有向上楼梯（回 1 层），未到底还配向下楼梯。
    // 2026-08-10 用户要求（关键）：层间楼梯上下对齐——F 层的 STAIRS_UP 与 F+1 层的
    // STAIRS_DOWN 必须放在【同一位置】（同一"层间通道" salt），这样：
    //   1 楼的上楼位置 = 2 楼的下楼位置（从 1 楼上楼到 2 楼，落点就在 2 楼楼梯口；
    //   从 2 楼下楼回 1 楼，落点就是 1 楼的上楼楼梯口），来回恒定不漂移。
    // 每层"去更高层"的上楼楼梯由各自的层间通道 salt 决定 → 2 楼的上楼位置与 1↔2 通道
    // 无关，独立随机。
    //
    // 关键实现：不能依赖 floorCells()（每层容器布局不同 → 候选格不同 → 位置漂移）。
    // 改用【全楼共用的 footprint】内缩 1 格的有效区（inner，每层完全一致）做候选格，
    // 并用【不含 floor 的 baseH】+ 通道 salt 取模定位 → 同通道 salt 在相邻两层取到
    // 完全相同的坐标。放置时强制清空该格 + 4 邻格（墙/容器/碎石/绿植 → 地板），
    // 保证楼梯可站、周围 8 格至少留出空地供落点站立，绝不卡在容器/建筑里。
    const baseH = hash(seed ^ hash(doorKey.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)));   // 不含 floor：全楼栋共用
    const maxAbove = B.FLOOR_MAX_ABOVE;
    const maxBelow = B.FLOOR_MAX_BELOW;
    // 层间通道候选区：footprint 内缩 1 格（每层相同），排除出生点（避免楼梯压出生位）
    const innerCells = [];
    for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) {
        if (!hasCell(x, y) || !hasCell(x - 1, y) || !hasCell(x + 1, y) || !hasCell(x, y - 1) || !hasCell(x, y + 1)) continue;
        if (x === spawnX && y === spawnY) continue;
        innerCells.push([x, y]);
    }
    const placeStairs = (channelSalt, type) => {
        if (!innerCells.length) return;
        // 同通道 salt（不含 floor）→ 相邻两层取到同一坐标 → 上下楼梯严格对齐
        const idx = ((baseH ^ hash(channelSalt)) >>> 0) % innerCells.length;
        const [sx, sy] = innerCells[idx];
        // 强制清空 3×3（楼梯格 + 4 邻格）：墙→地板、容器/碎石/绿植→地板，
        // 保证楼梯可站、落点周围留空（防卡死在容器/建筑里）。
        // 2026-08-10 修复"二楼墙体缺损"：3×3 清空【跳过外墙】（footprint 边界格）。
        // 楼梯候选虽已内缩 1 格，但 sx=1/iw-2 时 3×3 会触及 x=0/iw-1 的外墙并被强制
        // 变成地板 → 墙体缺损。二楼有两个楼梯（上下各一），命中外墙边缘概率是一楼的
        // 两倍，故二楼缺损更明显。修复：边界外墙保持 WALL，只清内墙/容器/碎石/绿植。
        const isPerimeter = (x, y) => {
            if (!hasCell(x, y)) return true;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                if (!hasCell(x + dx, y + dy)) return true;
            }
            return false;
        };
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const xx = sx + ox, yy = sy + oy;
            if (xx < 0 || xx >= iw || yy < 0 || yy >= ih) continue;
            if (!hasCell(xx, yy)) continue;
            if (isPerimeter(xx, yy)) continue;   // 外墙保留（防缺损）
            tiles[yy * iw + xx] = IT.FLOOR;
        }
        tiles[sy * iw + sx] = type;
    };
    // 通道 salt：正楼 floor→floor+1 用 800 + floor；地下室 floor→floor+1 用 1200 - floor。
    // F 层 STAIRS_UP 与 F+1 层 STAIRS_DOWN 传【同一个 channelSalt】→ 严格对齐。
    if (floor >= 1 && floor < maxAbove) placeStairs(800 + floor, IT.STAIRS_UP);
    if (floor > 1) placeStairs(800 + (floor - 1), IT.STAIRS_DOWN);
    if (floor < 0) {
        placeStairs(1200 - floor, IT.STAIRS_UP);
        if (floor > -maxBelow) placeStairs(1200 - (floor - 1), IT.STAIRS_DOWN);
    }

    return { tiles, w: iw, h: ih, exitX, exitY, spawnX, spawnY, floor };
}

// 出生点安全化：玩家到达楼层时，出生格必须可通行且四周至少有一个可通行邻格。
// 解决"上楼出生位恰好被物体/死角堵死而卡住"：旧存档 tile 与新生成 spawn 错位、
// 楼型变化（玩家改建外墙）或 1 格宽楼颈的死角，都会导致出生即卡死——自动 BFS 到最近可走格。
export function ensureSpawnWalkable(tiles, iw, ih, sx, sy) {
    // 2026-08-09 与 interiorWalkable 一致：容器/碎石/绿植是碰撞体，出生点必须落在纯地板/出口/楼梯上
    const walkable = v => v === IT.FLOOR || v === IT.EXIT || v === IT.STAIRS_UP || v === IT.STAIRS_DOWN;
    const free = (x, y) => x >= 0 && x < iw && y >= 0 && y < ih && walkable(tiles[y * iw + x]);
    // 2026-08-09 修复"上下楼梯卡住"：interiorCanStand 要求玩家中心 4 角点(r=11)全在可走格，
    // 即本格 + 4 邻格全部可走。此前只要求"至少 1 个邻格可走"，出生点若上下邻格是容器/墙，
    // 换层后玩家站上去 interiorCanStand 判定失败 → 卡死无法移动。改为 5 格全可走。
    const open = (x, y) => free(x, y) && free(x - 1, y) && free(x + 1, y) && free(x, y - 1) && free(x, y + 1);
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
// 概率：2 楼基准 0.15%，楼层每高一层 +0.03%（INTERIOR_NPC_CHANCE_BASE / _PER_FLOOR）。
function spawnInteriorNpcs(sv, it, floor) {
    if (!it.npcs) it.npcs = [];
    const key = it.key || '';
    const seed = (sv.world && sv.world.seed) || 0;
    // 楼层越高概率越高：chance = 基准 + (floor - 2) * 每层增量；floor<=1 直接不生成
    const chance = B.INTERIOR_NPC_CHANCE_BASE + Math.max(0, floor - 2) * B.INTERIOR_NPC_CHANCE_PER_FLOOR;
    // 确定性判定：hash(seed, doorKey, floor) < chance → 出现 1~INTERIOR_NPC_MAX 名
    const seedH = hash(seed ^ hash(key.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)) + floor * 9137);
    const r = ((seedH >> 8) & 0xffff) / 65536;
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
    // 联机：室内改为各自独立进出（host/guest 各按自己的 F 键进出；同 key 确定性生成室内一致）。
    // 不再广播 interior 事件——否则"一个人进房间，另一个人被强行拉进去"。
    // 2026-08-09 silent=true（切视角重建房间等静默路径）不弹"进入建筑"提示
    if (!silent) MSG.pushMsg(sv, cleared ? `进入${bName}（已清剿）` : `进入${bName}…`, '#D29A5B');
}

// 室外跟随队员进屋：把 sv.npcs 中 party && follow 的 NPC 带入室内（inInterior 标记）
function enterFollowers(sv, it) {
    if (!sv.npcs || !it) return;
    const cx = (it.spawnX + 0.5) * TS, cy = (it.spawnY + 0.5) * TS;
    const istand = (x, y) => interiorCanStand(sv, x, y);
    let k = 0;
    for (const n of sv.npcs) {
        if (!n.alive || n.riding) continue;
        if (!(n.party && n.state === 'follow')) continue;
        // 2026-08-09 修复"切队友视角位置互换"：切视角重建房间（syncControllerInterior 调
        // enterInterior）时，已在同一房间的队员保持原坐标不动，绝不重置到出生点旁。
        // 仅真正从室外新进入的队员才在出生点旁安置。
        if (n.inInterior && n.interiorKey === it.key) continue;
        n.inInterior = true;
        n.interiorKey = it.key;
        n.interiorFloor = 1;
        // 分散在玩家出生点旁（找可走格，最多带 4 名队员）
        let px = cx, py = cy + 0.7 * TS;
        const offs = [[0, 1.2], [0.8, 0.9], [-0.8, 0.9], [0, 1.8]];
        if (k < offs.length) { px = cx + offs[k][0] * TS; py = cy + offs[k][1] * TS; }
        if (istand(px, py)) { n.x = px; n.y = py; }
        else if (istand(cx, cy)) { n.x = cx; n.y = cy; }
        // 兜底：出生点/偏移都不可走时，从出生点扫 4 邻域可走格（否则队员带室外坐标进室内 → 渲染错位/卡住）
        else {
            const b0x = it.spawnX, b0y = it.spawnY;
            let fallback = null;
            for (const [ox2, oy2] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
                const gx = b0x + ox2, gy = b0y + oy2;
                if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
                if (istand((gx + 0.5) * TS, (gy + 0.5) * TS)) { fallback = [(gx + 0.5) * TS, (gy + 0.5) * TS]; break; }
            }
            if (fallback) { n.x = fallback[0]; n.y = fallback[1]; }
        }
        k++;
        if (k >= 4) break;
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
    // 2026-08-10 多出口：玩家从哪个 EXIT 出门，就落在对应世界门位置。
    // 当前 EXIT 局部格 = 玩家所在格（updateInterior 已检测 EXIT 才调 exitInterior）。
    // 世界门坐标：originX/originY 是建筑左上角【格子索引】，EXIT 局部格 egx/egy 也是
    // 格子索引 → 世界格 = originX + egx，世界像素 = (originX + egx + 0.5) * TS。
    // 2026-08-10 修复"出门 NPC 卡在建筑里"：落点不在门格（墙格），而是【门外偏移格】——
    // 用 footprint 判断 EXIT 格的"外部方向"（四邻中 footprint 为空的侧），落点在门外 1 格中心，
    // 保证玩家/队员落在建筑外可走地面，绝不落在墙壳/门格上。
    let exitWorldX = it.doorX, exitWorldY = it.doorY;
    {
        const egx = Math.floor(it.px / TS), egy = Math.floor(it.py / TS);
        const eT = it.tiles[egy * it.w + egx];
        if (eT === IT.EXIT) {
            // 门外方向：EXIT 格四邻中 footprint 为空的侧（即建筑外墙外侧）
            const fp = it.footprint, w = it.w;
            const outside = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([ox, oy]) => {
                const nx = egx + ox, ny = egy + oy;
                return nx < 0 || nx >= w || ny < 0 || ny >= it.h || !fp[ny * w + nx];
            }) || [0, 1];
            exitWorldX = (it.originX + egx + 0.5 + outside[0]) * TS;
            exitWorldY = (it.originY + egy + 0.5 + outside[1]) * TS;
        }
    }
    // 2026-08-09 室内外 NPC 统一：把随玩家进室内的队员（或室内招募的队员）带出室外——
    // sv.npcs 中 inInterior 且 party 的 NPC 移到门口外；未招募的躲藏者留在 it.npcs（已存档）。
    // 2026-08-10 修复"出门后队员卡在建筑里"：队员落点【只允许真正的可行走地面 isWalk】，
    // 不允许 DOOR（门格在建筑外墙边缘，站在门格=卡在建筑轮廓内）。从门口向外径向扩展
    // 逐格扫描，找最近一个 isWalk 格；找不到才兜底门口偏移（交给寻路拉走）。
    if (sv.npcs && sv.npcs.length) {
        const dx = exitWorldX, dy = exitWorldY;
        const mdx = Math.floor(dx / TS), mdy = Math.floor(dy / TS);   // 门口所在格
        let k = 0;
        // 径向逐圈扫描可走格：从门口格往外 1~6 圈，找最近 isWalk 格
        const findOut = () => {
            for (let rr = 1; rr <= 6; rr++) {
                for (let dy2 = -rr; dy2 <= rr; dy2++) for (let dx2 = -rr; dx2 <= rr; dx2++) {
                    if (Math.max(Math.abs(dx2), Math.abs(dy2)) !== rr) continue;   // 只扫本圈外环
                    const gx = mdx + dx2, gy = mdy + dy2;
                    const t = getTile(sv, gx, gy);
                    if (isWalk(t)) return { x: (gx + 0.5) * TS, y: (gy + 0.5) * TS };
                }
            }
            return null;
        };
        const ground = findOut();
        for (const n of sv.npcs) {
            if (!n.alive || !n.inInterior) continue;
            n.inInterior = false;
            n.interiorKey = null;
            n.interiorFloor = null;
            if (n.party) {
                // 落点：优先门口外最近可走地面（isWalk 真地面，绝不落在门格/墙/建筑内）；
                // 找不到则以门口为基准做小幅扇形偏移（仍旧 isWalk 优先），兜底门口坐标交给寻路拉走
                let placed = false;
                if (ground) { n.x = ground.x; n.y = ground.y; placed = true; }
                else {
                    const a2 = (k++ / Math.max(1, 4)) * Math.PI * 2;
                    for (const rr of [1, 1.5, 2, 2.5, 3]) {
                        const wx = dx + Math.cos(a2) * rr * TS, wy = dy + Math.sin(a2) * rr * TS;
                        if (isWalk(getTile(sv, Math.floor(wx / TS), Math.floor(wy / TS)))) { n.x = wx; n.y = wy; placed = true; break; }
                    }
                    if (!placed) { n.x = dx; n.y = dy; }   // 兜底：门口（室外 updateNpcs 会寻路拉走）
                }
            }
        }
    }
    sv.px = exitWorldX;
    sv.py = exitWorldY;
    sv.interior = null;
    // 兜底：门外偏移格若不可走（墙/水/建筑），回退到门格本身（门可通行）
    {
        const tt = getTile(sv, Math.floor(sv.px / TS), Math.floor(sv.py / TS));
        if (!isWalk(tt) && tt !== T.DOOR) {
            const egx2 = Math.floor(it.px / TS), egy2 = Math.floor(it.py / TS);
            sv.px = (it.originX + egx2 + 0.5) * TS;
            sv.py = (it.originY + egy2 + 0.5) * TS;
        }
    }
    // 2026-08-10 修复"室内倒地出门后坐标错乱"：倒地主角记录（sv._downed）的 px/py
    // 是室内局部坐标，出门后必须同步到出门位置（世界坐标），否则 updateDowned 的
    // 背人/威胁检测/超时判定全部用错坐标 → 主控出门后异常死亡/无救助。
    if (sv._downed) {
        sv._downed.px = sv.px;
        sv._downed.py = sv.py;
    }
    // 联机：退出室内不再广播（各自独立进出）
    MSG.pushMsg(sv, allDead ? '已清剿，回到室外' : '回到室外（室内僵尸仍在）');
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
    // 2026-08-09 用户要求"室内物品容器要有碰撞体"：容器(箱/建材箱/医疗箱/木料箱)、
    // 碎石家具、室内绿植均为实体障碍，不可通行；仅地板/出口/楼梯可走。
    // 【注意】容器/碎石/绿植只是"行走碰撞体"，不阻挡子弹穿透与近战攻击（仅墙阻挡）。
    return t === IT.FLOOR || t === IT.EXIT || t === IT.STAIRS_UP || t === IT.STAIRS_DOWN;
}

export function interiorCanStand(sv, x, y) {
    // 2026-08-10 格级碰撞判定（解决"NPC 室内卡在碰撞体旁"）+ 2026-08-10 修复"室内穿墙"：
    // 基础判定 = 目标点所在格可走（容器格不可站、贴边可绕行）。
    // 【新增】4 角点(r=10)检查所在格同样可走——防止角色/僵尸半个身体压进墙体穿模：
    //   仅查格中心时，角色从可走格逼近外墙，身体(±10px)已压进墙格但中心仍在可走格 →
    //   视觉穿模。补角点检查后，墙体/容器有真实碰撞体，任何单位无法压墙/穿墙。
    if (!interiorWalkable(sv, Math.floor(x / TS), Math.floor(y / TS))) return false;
    const it = sv.interior;
    if (!it) return false;
    const r = 10;
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
            // 2026-08-09 与 interiorWalkable 一致：容器/碎石/绿植是碰撞体，僵尸寻路绕行
            if (!(t === IT.FLOOR || t === IT.EXIT || t === IT.STAIRS_UP || t === IT.STAIRS_DOWN)) continue;
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
            // 出口：走到门口格自动出门（保持现状）
            exitInterior(sv);
        }
        // 2026-08-10 楼梯改为【交互式】：不再走到楼梯格自动上下楼。
        // 玩家需站在楼梯格旁按 F（updateInteriorPrompt/doInteriorInteract 处理），
        // 由交互触发 changeFloor——避免误走楼梯自动换层，交互更可控。
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
    // 2026-08-09 修复"上下楼卡脚/落点不固定"：
    // 换层落点固定绑定到新楼层的楼梯格（楼梯位置由 seed 确定性生成，来回恒定）。
    // 上楼（dir>0）→ 新楼层找 STAIRS_DOWN（回楼梯）；下楼（dir<0）→ 新楼层找 STAIRS_UP。
    // 落点 = 楼梯格中心 + 固定偏移（楼梯生成已保证本格+4邻格可走，绝不因随机障碍卡脚）。
    // 找不到对应楼梯（如顶楼无 STAIRS_UP）时回退出生点安全化。
    const findStairs = (wantType) => {
        for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
            if (tiles[y * it.w + x] === wantType) return { x, y };
        }
        return null;
    };
    let landX = null, landY = null;
    if (dir > 0) {
        // 上楼后落在新楼层楼梯口（STAIRS_DOWN 优先；若只有向上楼梯则用 STAIRS_UP）
        landX = (findStairs(IT.STAIRS_DOWN) || findStairs(IT.STAIRS_UP));
    } else {
        // 下楼后落在下层楼梯口（STAIRS_UP）
        landX = (findStairs(IT.STAIRS_UP) || findStairs(IT.STAIRS_DOWN));
    }
    if (landX) {
        // 落点 = 楼梯格旁固定位置（南侧紧邻格，2026-08-09 用户要求"落点固定"）。
        // 不落在楼梯格中心：否则玩家站楼梯格会立即再次触发换层（_floorCd 只有 1s）。
        // 楼梯生成已保证楼梯格 + 4 邻格全部可走 → 南侧落点必然可站、不卡脚。
        // 2026-08-09 彻底防卡脚：楼梯格 + 落点 5 格区域内的容器/碎石/绿植等障碍物
        // 全部清成地板——保证楼梯可站（触发换层）、落点可站且畅通，不受随机障碍影响。
        const clearObstacle = (gx, gy) => {
            if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) return;
            const t2 = tiles[gy * it.w + gx];
            if (t2 === IT.BOX || t2 === IT.WBOX || t2 === IT.MEDBOX || t2 === IT.MATBOX ||
                t2 === IT.DEBRIS || t2 === IT.PLANT || t2 === IT.SHELF) {
                tiles[gy * it.w + gx] = IT.FLOOR;
            }
        };
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) clearObstacle(landX.x + ox, landX.y + oy);
        const sx2 = landX.x, sy2 = landX.y + 1;   // 固定：楼梯南侧一格
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) clearObstacle(sx2 + ox, sy2 + oy);
        let landOk = false;
        if (sy2 < it.h && tiles[sy2 * it.w + sx2] === IT.FLOOR) {
            const lxp = (sx2 + 0.5) * TS, lyp = (sy2 + 0.5) * TS;
            if (interiorCanStand(sv, lxp, lyp)) { it.px = lxp; it.py = lyp; landOk = true; }
        }
        if (!landOk) {
            // 极端兜底（旧存档楼梯被障碍包围）：沿固定方向找最近可站格
            for (const [ox2, oy2] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
                const gx = landX.x + ox2, gy = landX.y + oy2;
                if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
                const cxp = (gx + 0.5) * TS, cyp = (gy + 0.5) * TS;
                if (interiorCanStand(sv, cxp, cyp)) { it.px = cxp; it.py = cyp; landOk = true; break; }
            }
            if (!landOk) { it.px = (landX.x + 0.5) * TS; it.py = (landX.y + 0.5) * TS; }
        }
    } else {
        // 无对应楼梯（顶层等）：回退出生点安全化
        const [pSX, pSY] = ensureSpawnWalkable(tiles, it.w, it.h, gen.spawnX, gen.spawnY);
        it.px = (pSX + 0.5) * TS;
        it.py = (pSY + 0.5) * TS;
    }
    it.cleared = cleared;
    it.npcs = [];
    // 2026-08-09 室内外统一：换楼层时，随行的 inInterior 队员重新定位到玩家落点旁
    if (sv.npcs && sv.npcs.length) {
        const cx0 = it.px, cy0 = it.py;
        const istand2 = (x, y) => interiorCanStand(sv, x, y);
        let k2 = 0;
        for (const n of sv.npcs) {
            if (!n.alive || !n.inInterior || !n.party) continue;
            n.interiorFloor = nextFloor;
            let px2 = cx0, py2 = cy0 + 0.7 * TS;
            const offs2 = [[0, 1.2], [0.8, 0.9], [-0.8, 0.9], [0, 1.8]];
            if (k2 < offs2.length) { px2 = cx0 + offs2[k2][0] * TS; py2 = cy0 + offs2[k2][1] * TS; }
            if (istand2(px2, py2)) { n.x = px2; n.y = py2; }
            else if (istand2(cx0, cy0)) { n.x = cx0; n.y = cy0; }
            k2++;
            if (k2 >= 4) break;
        }
    }
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
    // 联机：楼层切换不再广播（各自独立进出室内）
    MSG.pushMsg(sv, `${dir > 0 ? '上楼' : '下楼'} → ${floorName}`, '#D29A5B');
}

// （联机楼层切换已随室内独立进出取消：changeFloor 只由 updateInterior 本地触发）
