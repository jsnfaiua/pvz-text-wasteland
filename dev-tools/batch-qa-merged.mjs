// ============================================================
// 批量 QA 合并版（单进程，控制变量法：检查逻辑固定，只变种子）
// 每种子只生成一次地形，依次跑：
//   A. 地图质量：人行道缺失 / 马路过宽 / 建筑间地板感 / 主干道断面
//   B. 死路检测：连通死路 / 相位断头 / 出城路 / 死路人行道影响
// 判定逻辑与 dev-tools/check-map-quality.js、dead-end-check.js 完全一致。
// 用法：node --max-old-space-size=3072 --expose-gc dev-tools/batch-qa-merged.mjs seed1 seed2 ...
// ============================================================
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, arterialInfoAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';

const seeds = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n));
if (seeds.length < 2) { console.error('至少需要 2 个种子'); process.exit(2); }

const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE]);
const ROAD_LIKE_FULL = new Set([T.ROAD, T.CAR, T.BARRICADE, T.CARWRECK]);
const CITY_LIKE = new Set(['urban', 'suburb', 'ruins']);
const SIDEWALK_OK = new Set([T.SIDEWALK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES, T.CAR, T.CARWRECK, T.RUBBLE, T.BOX, T.WBOX, T.MEDBOX, T.MATBOX]);
const BUILDING = new Set([T.WALL, T.DOOR]);

let allPass = true;
let tiles = null;
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);

const neighborRoad = (gx, gy) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = tileAt(gx + dx, gy + dy);
        if (t === T.ROAD || t === T.CAR || t === T.BARRICADE) return true;
    }
    return false;
};

for (const seed of seeds) {
    const C = 48;   // 96×96 区块 ≈ 1536×1536 格
    tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const L = -C * CHUNK, H = C * CHUNK;
    const isRoadSurface = (gx, gy) => {
        const v = tileAt(gx, gy);
        if (v === undefined) return false;
        if (ROAD_LIKE.has(v)) return true;
        if (v === T.RUBBLE || v === T.TREE) {
            if (gridRoadKept(seed, gx, gy)) return true;
            if (arterialClassAt(seed, gx, gy) === 'road') return true;
        }
        return false;
    };

    // ---- A1) 人行道缺失 ----
    let sidewalkPlan = 0, sidewalkGap = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        if (!plannedSidewalkAt(seed, gx, gy)) continue;
        sidewalkPlan++;
        const t = tileAt(gx, gy);
        if (BUILDING.has(t)) continue;
        if (!SIDEWALK_OK.has(t)) sidewalkGap++;
    }

    // ---- A2) 马路过宽 ----
    const roadOnly = (gx, gy) => tileAt(gx, gy) === T.ROAD;
    const run = (gx, gy, dx, dy, cap) => {
        let n = 0;
        while (n < cap && roadOnly(gx - dx * (n + 1), gy - dy * (n + 1))) n++;
        return n;
    };
    const isIntersection = (gx, gy) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            let h = 0, v = 0;
            for (let i = -2; i <= 2; i++) {
                if (roadOnly(gx + dx + i, gy + dy)) h++;
                if (roadOnly(gx + dx, gy + dy + i)) v++;
            }
            if (h >= 3 && v >= 3) return true;
        }
        return false;
    };
    let roadCount = 0, overWide = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        if (!roadOnly(gx, gy)) continue;
        roadCount++;
        const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
        if (districtAt(seed, cx, cy) === 'ruins') continue;
        const dL = run(gx, gy, 1, 0, 64), dR = run(gx, gy, -1, 0, 64);
        const dU = run(gx, gy, 0, 1, 64), dD = run(gx, gy, 0, -1, 64);
        const hBand = dL + dR + 1, vBand = dU + dD + 1;
        if (hBand >= 8 && vBand >= 8) continue;
        const width = Math.min(hBand, vBand);
        if (width > 4 && !isIntersection(gx, gy)) overWide++;
    }

    // ---- A3) 建筑间地板感 ----
    let alley = 0;
    for (let gy = L + 1; gy < H - 1; gy++) for (let gx = L + 1; gx < H - 1; gx++) {
        const t = tileAt(gx, gy);
        if (t !== T.GROUND && t !== T.WEED) continue;
        const U = tileAt(gx, gy - 1), D = tileAt(gx, gy + 1);
        const Lft = tileAt(gx - 1, gy), Rgt = tileAt(gx + 1, gy);
        if ((BUILDING.has(U) && BUILDING.has(D)) || (BUILDING.has(Lft) && BUILDING.has(Rgt))) alley++;
    }

    // ---- B1) 连通死路 ----
    let deg1 = 0, roadTotal = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        if (!isRoadSurface(gx, gy)) continue;
        roadTotal++;
        const inb = gx > L + 2 && gx < H - 3 && gy > L + 2 && gy < H - 3;
        if (!inb) continue;
        const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        let deg = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoadSurface(gx + dx, gy + dy)) deg++;
        if (deg !== 1) continue;
        let touchesOutside = false;
        for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1 && !touchesOutside; dx++) {
            const nd = districtAt(seed, Math.floor((gx + dx) / CHUNK), Math.floor((gy + dy) / CHUNK));
            if (!CITY_LIKE.has(nd)) touchesOutside = true;
        }
        if (touchesOutside) continue;
        if (d === 'ruins') continue;
        deg1++;
    }

    // ---- B2) 相位断头 ----
    const phase2 = (v, BL) => ((v % BL) + BL) % BL < 2;
    let phaseDead = 0;
    for (let gy = L + 2; gy < H - 2; gy++) for (let gx = L + 2; gx < H - 2; gx++) {
        if (!isRoadSurface(gx, gy)) continue;
        if (arterialClassAt(seed, gx, gy) === 'road') continue;
        const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        if (d === 'ruins') continue;
        let touchesOutside = false;
        for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1 && !touchesOutside; dx++) {
            const nd = districtAt(seed, Math.floor((gx + dx) / CHUNK), Math.floor((gy + dy) / CHUNK));
            if (!CITY_LIKE.has(nd)) touchesOutside = true;
        }
        if (touchesOutside) continue;
        const BL = blockAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        const onItsRow = phase2(gy, BL), onItsCol = phase2(gx, BL);
        const rU = isRoadSurface(gx, gy + 1), rD = isRoadSurface(gx, gy - 1);
        const rL = isRoadSurface(gx - 1, gy), rR = isRoadSurface(gx + 1, gy);
        let dead = false;
        if ((rU || isRoadSurface(gx, gy + 2)) && !rD && !onItsRow && gridRoadKept(seed, gx, gy - 1)) dead = true;
        else if ((rD || isRoadSurface(gx, gy - 2)) && !rU && !onItsRow && gridRoadKept(seed, gx, gy + 1)) dead = true;
        else if ((rR || isRoadSurface(gx + 2, gy)) && !rL && !onItsCol && gridRoadKept(seed, gx - 1, gy)) dead = true;
        else if ((rL || isRoadSurface(gx - 2, gy)) && !rR && !onItsCol && gridRoadKept(seed, gx + 1, gy)) dead = true;
        if (dead) phaseDead++;
    }

    // ---- B3) 出城路 ----
    let exitRoads = 0;
    for (let gy = L + 2; gy < H - 2; gy++) for (let gx = L + 2; gx < H - 2; gx++) {
        if (!isRoadSurface(gx, gy)) continue;
        let deg = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoadSurface(gx + dx, gy + dy)) deg++;
        if (deg !== 1) continue;
        let touchesOutside = false;
        for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1 && !touchesOutside; dx++) {
            const nd = districtAt(seed, Math.floor((gx + dx) / CHUNK), Math.floor((gy + dy) / CHUNK));
            if (!CITY_LIKE.has(nd)) touchesOutside = true;
        }
        if (touchesOutside) exitRoads++;
    }

    // ---- B4) 死路人行道影响 ----
    let swOk = 0, swBad = 0;
    for (let gy = L + 2; gy < H - 2; gy++) for (let gx = L + 2; gx < H - 2; gx++) {
        if (!isRoadSurface(gx, gy)) continue;
        let deg = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoadSurface(gx + dx, gy + dy)) deg++;
        if (deg !== 1) continue;
        const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        if (d !== 'urban' && d !== 'suburb') continue;
        let touchesOutside = false;
        for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1 && !touchesOutside; dx++) {
            const nd = districtAt(seed, Math.floor((gx + dx) / CHUNK), Math.floor((gy + dy) / CHUNK));
            if (!CITY_LIKE.has(nd)) touchesOutside = true;
        }
        if (touchesOutside) continue;
        let dir = null;
        if (isRoadSurface(gx, gy + 1) || isRoadSurface(gx, gy + 2)) dir = 'v';
        else if (isRoadSurface(gx, gy - 1) || isRoadSurface(gx, gy - 2)) dir = 'v';
        else if (isRoadSurface(gx + 1, gy) || isRoadSurface(gx + 2, gy)) dir = 'h';
        else if (isRoadSurface(gx - 1, gy) || isRoadSurface(gx - 2, gy)) dir = 'h';
        if (!dir) continue;
        const sideA = dir === 'h' ? tileAt(gx, gy + 1) : tileAt(gx + 1, gy);
        const sideB = dir === 'h' ? tileAt(gx, gy - 1) : tileAt(gx - 1, gy);
        const okA = sideA === T.SIDEWALK, okB = sideB === T.SIDEWALK;
        if (okA && okB) swOk++; else swBad++;
    }

    const pass = sidewalkGap === 0 && overWide === 0 && deg1 === 0 && phaseDead === 0 && swBad === 0;
    if (!pass) allPass = false;
    console.log(`seed ${seed}: 人行道缺=${sidewalkGap}/${sidewalkPlan} 超宽=${overWide} 建筑间=${alley} 死路=${deg1} 相位断头=${phaseDead} 出城路=${exitRoads} 人行道缺(死路端)=${swBad}  ${pass ? '✅' : '❌'}`);
    tiles = null;
    if (globalThis.gc) globalThis.gc();
}
console.log(`\n${allPass ? '✅ 全部种子通过：无死路、无人行道缺失、无超宽路' : '❌ 存在异常种子，详见上方'}`);
process.exit(allPass ? 0 : 1);
