// 超宽格是否都位于路口区域？路口 = 该格 7x7 邻域内存在"十字"结构
import { genChunkTiles, T, CHUNK } from '../source-code/mod-wasteland/world.js';
import { districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';
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

let overWide = 0, nearIntersection = 0, notIntersection = [];
// 路口判定：该格 5x5 邻域内，横向有 >=3 连续路 且 纵向有 >=3 连续路（任意中心偏移）
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
        // 5x5 邻域内找"十字"：任一中心，水平连续路>=3 且 垂直连续路>=3
        let isCross = false;
        for (let dy = -2; dy <= 2 && !isCross; dy++) for (let dx = -2; dx <= 2 && !isCross; dx++) {
            let h = 0, v = 0;
            for (let i = -2; i <= 2; i++) {
                if (roadOnly(gx + dx + i, gy + dy)) h++;
                if (roadOnly(gx + dx, gy + dy + i)) v++;
            }
            if (h >= 3 && v >= 3) isCross = true;
        }
        if (isCross) nearIntersection++;
        else if (notIntersection.length < 8) notIntersection.push(`(${gx},${gy}) h=${hBand} v=${vBand}`);
    }
}
console.log(`seed ${seed}: 超宽格=${overWide}  其中在路口区=${nearIntersection}  不在路口区=${overWide - nearIntersection}`);
for (const s of notIntersection) console.log('  非路口: ' + s);
