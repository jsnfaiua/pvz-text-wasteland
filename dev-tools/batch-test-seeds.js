// ============================================================
// 批量种子地形质量测试：对多个种子运行完整三维度检查
// 1) 规划缺失 2) 带缺口 3) 孤儿人行道
// 用法: node dev-tools/batch-test-seeds.js <seed1> <seed2> ...
// ============================================================
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';

const SIDEWALK_OK = new Set([T.SIDEWALK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES, T.CAR, T.CARWRECK, T.RUBBLE, T.BOX, T.WBOX, T.MEDBOX, T.MATBOX]);
const BUILDING = new Set([T.WALL, T.DOOR]);
const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE]);

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(20260802, 12345, 987654321, 777, 424242, 20240101, 88888888, 31415926);

let allPass = true;
for (const seed of seeds) {
    const C = 32;   // 64×64 区块 ≈ 1024×1024 格，覆盖多城+主干道；单种子内存可控，连续跑多种子不爆
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const L = -C * CHUNK, H = C * CHUNK;

    let plan = 0, gap = 0, bandGap = 0, orphan = 0, roadCount = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        const v = tileAt(gx, gy);
        const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
        const d = districtAt(seed, cx, cy);

        if (v === T.ROAD) roadCount++;
        if (plannedSidewalkAt(seed, gx, gy)) {
            plan++;
            if (!BUILDING.has(v) && !SIDEWALK_OK.has(v)) gap++;
        }
        if (d === 'urban' || d === 'suburb') {
            const BL = blockAt(seed, cx, cy);
            const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
            const walkBand = rx === 4 || rx === BL - 1 || ry === 4 || ry === BL - 1;
            if (!walkBand) continue;
            let adjRoad = false;
            for (let dy = -1; dy <= 1 && !adjRoad; dy++) for (let dx = -1; dx <= 1 && !adjRoad; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (gridRoadKept(seed, gx + dx, gy + dy)) adjRoad = true;
                if (arterialClassAt(seed, gx + dx, gy + dy) === 'road') adjRoad = true;
            }
            if (v === T.SIDEWALK) {
                if (!adjRoad) orphan++;
            } else if (!ROAD_LIKE.has(v) && !SIDEWALK_OK.has(v) && !BUILDING.has(v)) {
                if (adjRoad) bandGap++;
            }
        }
    }
    const ok = gap === 0 && bandGap === 0 && orphan === 0;
    if (!ok) allPass = false;
    console.log(`seed ${seed}: 规划=${plan} 缺失=${gap} 带缺口=${bandGap} 孤儿=${orphan} 路面=${roadCount}  ${ok ? '✅' : '❌'}`);
    tiles.clear();   // 释放本种子占用的区块缓存，避免连续多种子累积内存
    if (global.gc) global.gc();
}
console.log(`\n=== 汇总: ${allPass ? '全部通过' : '存在失败'} (${seeds.length} 个种子) ===`);
process.exit(allPass ? 0 : 1);
