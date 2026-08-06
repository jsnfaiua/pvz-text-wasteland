// ============================================================
// 【无尽植僵荒原】模组 · 区域规划（圈层城市模型）
// 现实城市规划逻辑：市中心→内环→外环→工业→郊区→荒野
// 噪声扰动让边界不规整，过渡带混合相邻圈层建筑类型
// ============================================================

import { DISTRICTS, DISTRICT_KEYS, REGION_CELL } from './wbalance.js';

export const RINGS = {
    core:    { name: '市中心', minR: 0,  maxR: 3,  infection: 0.85, zombieMul: 2.2, buildDensity: 0.95 },
    inner:   { name: '内环',   minR: 3,  maxR: 7,  infection: 0.65, zombieMul: 1.7, buildDensity: 0.85 },
    mid:     { name: '外环',   minR: 7,  maxR: 12, infection: 0.45, zombieMul: 1.3, buildDensity: 0.60 },
    suburb:  { name: '郊区',   minR: 12, maxR: 20, infection: 0.22, zombieMul: 0.8, buildDensity: 0.30 },
    wild:    { name: '荒野',   minR: 20, maxR: Infinity, infection: 0.06, zombieMul: 0.4, buildDensity: 0.02 },
};

export const RING_KEYS = ['core', 'inner', 'mid', 'suburb', 'wild'];

export const BUILDING_TYPES = {
    commercial:  { name: '商业楼',   loot: 'supply',  glyphBias: 'supply',  dangerBonus: 0 },
    hospital:    { name: '医院',     loot: 'medical', glyphBias: 'medical', dangerBonus: 0.15 },
    school:      { name: '学校',     loot: 'interior', glyphBias: 'archive', dangerBonus: 0.05 },
    library:     { name: '图书馆',   loot: 'interior', glyphBias: 'archive', dangerBonus: 0.05 },
    archive:     { name: '档案室',   loot: 'interior', glyphBias: 'archive', dangerBonus: 0.10 },
    residential: { name: '居民楼',   loot: 'supply',  glyphBias: 'supply',  dangerBonus: -0.05 },
    shop:        { name: '商店',     loot: 'supply',  glyphBias: 'supply',  dangerBonus: -0.05 },
    warehouse:   { name: '仓库',     loot: 'material', glyphBias: 'material', dangerBonus: 0.05 },
    factory:     { name: '工厂',     loot: 'material', glyphBias: 'material', dangerBonus: 0.10 },
    printshop:   { name: '印刷设施', loot: 'interior', glyphBias: 'archive', dangerBonus: 0.08 },
    gasstation:  { name: '加油站',   loot: 'car',     glyphBias: 'car',     dangerBonus: 0 },
    house:       { name: '独立住宅', loot: 'supply',  glyphBias: 'supply',  dangerBonus: -0.10 },
    ruin:        { name: '废墟',     loot: 'weapon',  glyphBias: 'weapon',  dangerBonus: 0.20 },
};

const RING_BUILDINGS = {
    core:    ['commercial', 'commercial', 'hospital', 'library', 'archive', 'shop', 'commercial'],
    inner:   ['residential', 'residential', 'school', 'shop', 'hospital', 'residential', 'commercial'],
    mid:     ['residential', 'shop', 'gasstation', 'residential', 'school', 'house', 'residential'],
    suburb:  ['house', 'house', 'gasstation', 'house', 'warehouse', 'house'],
    wild:    [],
};

function dHash(seed, x, y) {
    let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export const CITY_SPACING = 52;

export function cityCenterAt(seed, cellX, cellY) {
    if (cellX === 0 && cellY === 0) return { x: 0, y: 0, cellX, cellY };
    const jitter = 9;
    const x = cellX * CITY_SPACING + Math.round((dHash(seed ^ 0xC171, cellX, cellY) * 2 - 1) * jitter);
    const y = cellY * CITY_SPACING + Math.round((dHash(seed ^ 0xC172, cellX, cellY) * 2 - 1) * jitter);
    return { x, y, cellX, cellY };
}

export function nearestCityAt(seed, cx, cy) {
    const baseX = Math.round(cx / CITY_SPACING), baseY = Math.round(cy / CITY_SPACING);
    let best = null;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const city = cityCenterAt(seed, baseX + ox, baseY + oy);
        const dist = Math.hypot(cx - city.x, cy - city.y);
        if (!best || dist < best.dist) best = { ...city, dist };
    }
    return best;
}

function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

const arterialCache = new Map();
const districtCache = new Map();

// 世界级交通网：每个城市向东、向南连接相邻城市。线路采用确定性折线，穿越荒野和废墟时不中断。
// 主干道与网格路带等宽：路面带恒为 4 格（行/列 [line-2, line+1]），两侧人行道环各 1 格
// （[line-3] 与 [line+2]）；line 为最近线段的轴坐标（水平段=行号，垂直段=列号）。
// 折线方向约定：hFirst=true → 先水平后垂直（段1 横/段2 竖）；hFirst=false → 先垂直后水平（段1 竖/段2 横）。
// 注意：bendX = horizontalFirst ? bx : ax；bendY = horizontalFirst ? ay : by，因此：
//   hFirst=true  → 段1 恒行(bendY=ay)，段2 恒列(bendX=bx)
//   hFirst=false → 段1 恒列(bendX=ax)，段2 恒行(bendY=by)
export function arterialInfoAt(seed, gx, gy) {
    const cacheKey = seed + ':' + gx + ',' + gy;
    const hit = arterialCache.get(cacheKey);
    if (hit) return hit;
    const chunkX = gx / 16, chunkY = gy / 16;
    const baseX = Math.round(chunkX / CITY_SPACING), baseY = Math.round(chunkY / CITY_SPACING);
    let best = Infinity, bestSeg = null;
    for (let cy = baseY - 1; cy <= baseY + 1; cy++) for (let cx = baseX - 1; cx <= baseX + 1; cx++) {
        const a = cityCenterAt(seed, cx, cy);
        for (const [nx, ny, salt] of [[cx + 1, cy, 0xE451], [cx, cy + 1, 0xE452]]) {
            const b = cityCenterAt(seed, nx, ny);
            const ax = a.x * 16 + 8, ay = a.y * 16 + 8;
            const bx = b.x * 16 + 8, by = b.y * 16 + 8;
            const horizontalFirst = dHash(seed ^ salt, cx, cy) < 0.5;
            const bendX = horizontalFirst ? bx : ax;
            const bendY = horizontalFirst ? ay : by;
            const segs = horizontalFirst ? [
                { axis: 'h', line: bendY, d: segmentDistance(gx + 0.5, gy + 0.5, ax, ay, bendX, bendY) },
                { axis: 'v', line: bendX, d: segmentDistance(gx + 0.5, gy + 0.5, bendX, bendY, bx, by) },
            ] : [
                { axis: 'v', line: bendX, d: segmentDistance(gx + 0.5, gy + 0.5, ax, ay, bendX, bendY) },
                { axis: 'h', line: bendY, d: segmentDistance(gx + 0.5, gy + 0.5, bendX, bendY, bx, by) },
            ];
            for (const s of segs) if (s.d < best) { best = s.d; bestSeg = s; }
        }
    }
    let cls = null;
    if (bestSeg) {
        const off = bestSeg.axis === 'h' ? gy - bestSeg.line : gx - bestSeg.line;
        if (best <= 2.05 && off >= -2 && off <= 1) cls = 'road';
        else if (best <= 3.05 && off >= -3 && off <= 2) cls = 'sidewalk';
    }
    const info = { cls, axis: bestSeg ? bestSeg.axis : null, line: bestSeg ? bestSeg.line : null };
    if (arterialCache.size > 60000) arterialCache.clear();
    arterialCache.set(cacheKey, info);
    return info;
}

export function arterialClassAt(seed, gx, gy) {
    return arterialInfoAt(seed, gx, gy).cls;
}

function ringNoise(seed, cx, cy) {
    const n1 = dHash(seed ^ 0xA1B6, Math.floor(cx / 2), Math.floor(cy / 2));
    const n2 = dHash(seed ^ 0xC2D7, Math.floor(cx / 3), Math.floor(cy / 3));
    return (n1 * 0.6 + n2 * 0.4 - 0.5) * 3.5;
}

function industryAngle(seed) {
    return dHash(seed ^ 0x1AD5, 0, 0) * Math.PI * 2;
}

// 指定城市（格坐标 cellX/cellY）的工业区朝向角（与 isIndustrialZone 使用的盐一致），
// 供 NPC 驾驶"探索废墟"寻点时瞄准真实废墟区域
export function industrialAngleAt(seed, cityCellX, cityCellY) {
    return industryAngle(seed ^ Math.imul(cityCellX, 911) ^ Math.imul(cityCellY, 3571));
}

export function ringAt(seed, cx, cy) {
    const city = nearestCityAt(seed, cx, cy);
    const dist = city.dist;
    const noise = ringNoise(seed, cx, cy);
    const effectiveDist = dist + noise;
    if (effectiveDist < RINGS.core.maxR) return 'core';
    if (effectiveDist < RINGS.inner.maxR) return 'inner';
    if (effectiveDist < RINGS.mid.maxR) return 'mid';
    if (effectiveDist < RINGS.suburb.maxR) return 'suburb';
    return 'wild';
}

export function isIndustrialZone(seed, cx, cy) {
    const city = nearestCityAt(seed, cx, cy);
    const dist = city.dist;
    if (dist < 5 || dist > 16) return false;
    const angle = Math.atan2(cy - city.y, cx - city.x);
    const indAngle = industryAngle(seed ^ Math.imul(city.cellX, 911) ^ Math.imul(city.cellY, 3571));
    let diff = Math.abs(angle - indAngle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    const noise = dHash(seed ^ 0x1FA2, cx, cy);
    return diff < 0.5 + noise * 0.3;
}

// 每颗世界种子取一个统一的街区尺寸（BLOCK）：所有城市共用同一相位，
// 城市↔郊区↔废墟、以及不同城市交界处的网格路带完全对齐，"两个城市郊区一个原则"，
// 公路跨城连续衔接不突兀；不同种子仍可得到不同的街区尺寸（世界多样性由种子承担）。
const blockCache = new Map();
export function blockAt(seed, cx, cy) {
    const key = seed + ':B:' + cx + ',' + cy;
    const hit = blockCache.get(key);
    if (hit !== undefined) return hit;
    const d = districtAt(seed, cx, cy);
    const h = dHash(seed ^ 0xB10C, 0, 0);
    const base = 18 + Math.floor(h * 7);   // 街区尺寸 18~24，全种子统一
    let BL;
    if (d === 'urban' || d === 'suburb' || d === 'ruins') BL = base;
    else BL = 14;
    if (blockCache.size > 60000) blockCache.clear();
    blockCache.set(key, BL);
    return BL;
}

export function buildingTypeAt(seed, cx, cy) {
    const ring = ringAt(seed, cx, cy);
    if (ring === 'wild') return null;
    if (isIndustrialZone(seed, cx, cy)) {
        const r = dHash(seed ^ 0xB1D1, cx, cy);
        if (r < 0.45) return 'factory';
        if (r < 0.80) return 'warehouse';
        return 'printshop';
    }
    const pool = RING_BUILDINGS[ring];
    if (!pool || pool.length === 0) return null;
    const density = RINGS[ring].buildDensity;
    const occupancy = dHash(seed ^ 0x0CC2, cx, cy);
    if (occupancy > density) return null;
    const r = dHash(seed ^ 0xB1D2, cx * 7 + cy * 13, cy * 3 + cx);
    const idx = Math.floor(r * pool.length) % pool.length;
    return pool[idx];
}

export function infectionAt(seed, cx, cy) {
    const dist = nearestCityAt(seed, cx, cy).dist;
    const noise = ringNoise(seed, cx, cy) * 0.5;
    const effectiveDist = Math.max(0, dist + noise);
    let base;
    if (effectiveDist < 3) base = 0.40;
    else if (effectiveDist < 7) base = 0.40 - (effectiveDist - 3) * 0.035;
    else if (effectiveDist < 12) base = 0.26 - (effectiveDist - 7) * 0.024;
    else if (effectiveDist < 20) base = 0.14 - (effectiveDist - 12) * 0.012;
    else base = Math.max(0.01, 0.05 - (effectiveDist - 20) * 0.003);
    if (isIndustrialZone(seed, cx, cy)) base += 0.06;
    return Math.max(0, Math.min(0.7, base));
}

export function zombieStrengthAt(seed, cx, cy) {
    const dist = nearestCityAt(seed, cx, cy).dist;
    const noise = dHash(seed ^ 0x2E4B, cx, cy) * 0.2 - 0.1;
    const effectiveDist = Math.max(0, dist + noise * 3);
    if (effectiveDist < 3) return 1.5;
    if (effectiveDist < 7) return 1.5 - (effectiveDist - 3) * 0.075;
    if (effectiveDist < 12) return 1.2 - (effectiveDist - 7) * 0.04;
    if (effectiveDist < 20) return 1.0 - (effectiveDist - 12) * 0.03;
    return Math.max(0.6, 0.76 - (effectiveDist - 20) * 0.01);
}

export function eliteChanceAt(seed, cx, cy) {
    const dist = nearestCityAt(seed, cx, cy).dist;
    if (dist < 3) return 0.18;
    if (dist < 7) return 0.10;
    if (dist < 12) return 0.04;
    if (dist < 20) return 0.01;
    return 0;
}

export function districtAt(seed, cx, cy) {
    const key = seed + ':' + cx + ',' + cy;
    const hit = districtCache.get(key);
    if (hit !== undefined) return hit;
    const ring = ringAt(seed, cx, cy);
    const compat = { core: 'urban', inner: 'urban', mid: 'urban', suburb: 'suburb', wild: 'wild' };
    const result = isIndustrialZone(seed, cx, cy) ? 'ruins' : (compat[ring] || 'wild');
    if (districtCache.size > 80000) districtCache.clear();
    districtCache.set(key, result);
    return result;
}

export function districtProfile(seed, cx, cy) {
    return DISTRICTS[districtAt(seed, cx, cy)];
}
