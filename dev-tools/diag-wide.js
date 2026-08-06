// ============================================================
// 超宽路成因统计：区分误报（路口区被车/栏截断）与真实超宽（路带拼接）
// ============================================================
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, arterialInfoAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';

const seed = Number(process.argv[2]) || 20260802;
const C = 64;
const tiles = new Map();
for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
const roadOnly = (gx, gy) => tileAt(gx, gy) === T.ROAD;
const run = (gx, gy, dx, dy, cap) => { let n = 0; while (n < cap && roadOnly(gx - dx * (n + 1), gy - dy * (n + 1))) n++; return n; };

const L = -C * CHUNK, H = C * CHUNK;
let overWide = 0;
const stats = { 路口障碍截断: 0, 主干道断面: 0, 路带贴邻主干道: 0, 其他: 0 };
const samples = { 路口障碍截断: [], 主干道断面: [], 路带贴邻主干道: [], 其他: [] };

for (let gy = L; gy < H; gy++) {
    for (let gx = L; gx < H; gx++) {
        if (!roadOnly(gx, gy)) continue;
        const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
        if (districtAt(seed, cx, cy) === 'ruins') continue;
        const dL = run(gx, gy, 1, 0, 64), dR = run(gx, gy, -1, 0, 64);
        const dU = run(gx, gy, 0, 1, 64), dD = run(gx, gy, 0, -1, 64);
        const hBand = dL + dR + 1, vBand = dU + dD + 1;
        if (hBand >= 8 && vBand >= 8) continue;
        const width = Math.min(hBand, vBand);
        if (width <= 4) continue;
        overWide++;

        // 判定成因
        const arterial = arterialClassAt(seed, gx, gy);
        const cx2 = Math.floor(gx / CHUNK), cy2 = Math.floor(gy / CHUNK);
        const BL = blockAt(seed, cx2, cy2);
        const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
        const onRoadBand = rx < 4 || ry < 4;

        // 1) 十字路口：另一轴的路面延伸 >= 6（路口核心区域），本轴被障碍物截断
        const longAxis = hBand >= vBand ? 'h' : 'v';
        const shortAxis = longAxis === 'h' ? 'v' : 'h';
        const longLen = longAxis === 'h' ? hBand : vBand;
        const shortLen = longAxis === 'h' ? vBand : hBand;
        const onArterialRoad = arterial === 'road';
        const gridAdjacent = arterialMergesGridAt(seed, gx, gy);

        if (longLen >= 12 && shortLen >= 5 && shortLen <= 7) {
            stats.路口障碍截断++;
            if (samples.路口障碍截断.length < 5) samples.路口障碍截断.push(`(${gx},${gy}) 长轴=${longLen} 短轴=${shortLen} 动脉=${arterial} 路带格=${onRoadBand ? '是' : '否'}`);
        } else if (onArterialRoad) {
            stats.主干道断面++;
            if (samples.主干道断面.length < 5) samples.主干道断面.push(`(${gx},${gy}) 长轴=${longLen} 短轴=${shortLen}`);
        } else if (gridAdjacent && shortLen >= 5 && shortLen <= 8) {
            stats.路带贴邻主干道++;
            if (samples.路带贴邻主干道.length < 5) samples.路带贴邻主干道.push(`(${gx},${gy}) 长轴=${longLen} 短轴=${shortLen}`);
        } else {
            stats.其他++;
            if (samples.其他.length < 8) samples.其他.push(`(${gx},${gy}) h=${hBand} v=${vBand} 动脉=${arterial} 路带格=${onRoadBand ? '是' : '否'} rx=${rx} ry=${ry} BL=${BL}`);
        }
    }
}

console.log(`seed ${seed}: 超宽格总数=${overWide}`);
for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k}: ${v}`);
    for (const s of samples[k]) console.log(`     ${s}`);
}

// 辅助：复刻 arterialMergesGrid 判定
function arterialMergesGridAt(seed, gx, gy) {
    const info = arterialInfoAt(seed, gx, gy);
    if (!info.cls) return false;
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    const BL = blockAt(seed, cx, cy);
    if (info.axis === 'h') {
        for (let r = info.line - 7; r <= info.line + 3; r++)
            if ((((r % BL) + BL) % BL) === 0 && gridRoadKept(seed, gx, r)) return true;
    } else {
        for (let c = info.line - 7; c <= info.line + 3; c++)
            if ((((c % BL) + BL) % BL) === 0 && gridRoadKept(seed, c, gy)) return true;
    }
    return false;
}
