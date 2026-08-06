// ============================================================
// 人行道缺失复查（多维度）：
// 1) plannedSidewalkAt 规划缺失：规划为人行道但实际不是（或非合法叠加物）
// 2) 人行道带缺口：walk 带格紧邻保留路/主干道，却生成成草地（缺铺）
// 3) 孤儿人行道：实际人行道不在 walk 带、也不紧邻主干道环（跑进绿地）
// 用法：node dev-tools/recheck-sidewalk.js [seed ...]
// ============================================================
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';

const SIDEWALK_OK = new Set([T.SIDEWALK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES, T.CAR, T.CARWRECK, T.RUBBLE, T.BOX, T.WBOX, T.MEDBOX, T.MATBOX]);
const BUILDING = new Set([T.WALL, T.DOOR]);
const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE]);

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(20260802, 12345, 987654321);

for (const seed of seeds) {
    const C = 64;
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const L = -C * CHUNK, H = C * CHUNK;

    // ---- 维度1：规划缺失 ----
    let plan = 0, gap = 0; const gapS = [];
    // ---- 维度2：带缺口（紧邻保留路/主干道却草地）----
    let bandGap = 0; const bandS = [];
    // ---- 维度3：孤儿人行道 ----
    let orphan = 0; const orphS = [];

    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        const v = tileAt(gx, gy);
        const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
        const d = districtAt(seed, cx, cy);

        // 维度1
        if (plannedSidewalkAt(seed, gx, gy)) {
            plan++;
            if (!BUILDING.has(v) && !SIDEWALK_OK.has(v)) {
                gap++;
                if (gapS.length < 10) gapS.push(`(${gx},${gy}) 实际=${v === T.GROUND ? '草地' : String(v)}`);
            }
        }

        // 维度2+3：城市/郊区 walk 带
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
                if (!adjRoad) { orphan++; if (orphS.length < 10) orphS.push(`(${gx},${gy}) 无人行道环邻路`); }
            } else if (!ROAD_LIKE.has(v) && !SIDEWALK_OK.has(v) && !BUILDING.has(v)) {
                if (adjRoad) { bandGap++; if (bandS.length < 10) bandS.push(`(${gx},${gy}) 实际=${v === T.GROUND ? '草地' : String(v)}`); }
            }
        }
    }
    console.log(`\n==== seed ${seed} ====`);
    console.log(`[规划缺失] 规划 ${plan} 格，缺失 ${gap} 格${gapS.length ? '\n  ' + gapS.join('\n  ') : ''}`);
    console.log(`[带缺口] walk带紧邻道路却草地 ${bandGap} 格${bandS.length ? '\n  ' + bandS.join('\n  ') : ''}`);
    console.log(`[孤儿] 人行道跑进绿地(无邻路) ${orphan} 格${orphS.length ? '\n  ' + orphS.join('\n  ') : ''}`);
}
