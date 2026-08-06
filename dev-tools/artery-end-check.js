// 主干道端点检测 v2：直接逐格扫描，找"沿轴向前一格不是同轴主干道"的端点
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, arterialInfoAt, districtAt } from '../source-code/mod-wasteland/wdistrict.js';

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(20260802, 12345, 987654321, 777, 424242);
const CITY_LIKE = new Set(['urban', 'suburb', 'ruins']);

for (const seed of seeds) {
    const C = 48;
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const L = -C * CHUNK, H = C * CHUNK;
    const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE]);
    const isRoadLike = (gx, gy) => { const v = tileAt(gx, gy); return v !== undefined && ROAD_LIKE.has(v); };

    // 主干道端点格：本格是主干道 road，沿 axis 方向的前一格不是同轴主干道 road
    let endCount = 0, bad = 0; const badSamples = [];
    const seen = new Set();

    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        const info = arterialInfoAt(seed, gx, gy);
        if (info.cls !== 'road') continue;
        const axis = info.axis, line = info.line;
        // 只处理路面带内的格（off ∈ [-2,1]），避免折点附近误判
        const off = axis === 'h' ? gy - line : gx - line;
        if (off < -2 || off > 1) continue;
        // 沿正负方向检查是否端点：前一格（沿轴反向）不是同轴 road
        for (const sgn of [1, -1]) {
            const nx = axis === 'h' ? gx + sgn : gx;
            const ny = axis === 'h' ? gy : gy + sgn;
            const ni = arterialInfoAt(seed, nx, ny);
            if (ni.cls === 'road' && ni.axis === axis) continue;   // 延续，不是端点
            // 这是端点：本格 (gx,gy) 是主干道最后一格（沿 sgn 方向）
            const key = gx + ',' + gy + ',' + sgn;
            if (seen.has(key)) continue;
            seen.add(key);
            endCount++;
            // 端点后一格 (nx,ny) 的判定
            // 1) 出城 → 正常
            const nd = districtAt(seed, Math.floor(nx / CHUNK), Math.floor(ny / CHUNK));
            const ndSelf = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
            if (!CITY_LIKE.has(nd)) continue;   // 出城正常
            // 2) 端点是网格路/另一条主干道 → 路口，正常
            if (isRoadLike(nx, ny) || arterialClassAt(seed, nx, ny) === 'road') continue;
            // 3) 端点是人行道环 → 自然收口，正常
            if (plannedSidewalkAt(seed, nx, ny)) continue;
            // 4) 端点前一格有垂直路（T 形）→ 正常
            const px = axis === 'h' ? gx : gx, py = axis === 'h' ? gy : gy;   // 本格即最后路面格
            let sideRoad = false;
            if (axis === 'h') {
                for (let dy = -1; dy <= 1; dy++) if (isRoadLike(px, py + dy)) sideRoad = true;
            } else {
                for (let dx = -1; dx <= 1; dx++) if (isRoadLike(px + dx, py)) sideRoad = true;
            }
            if (sideRoad) continue;
            // 城区内部，端点后无任何路/人行道 → 异常断头
            bad++;
            if (badSamples.length < 12) {
                const v = tileAt(nx, ny);
                badSamples.push(`(${nx},${ny}) 本区块${ndSelf} 后格区块${nd} 实际=${v === T.GROUND ? '草' : String(v)} axis=${axis}`);
            }
        }
    }
    console.log(`\n========== seed ${seed} ==========`);
    console.log(`[主干道端点] 端点 ${endCount} 个，异常断头 ${bad} 处${badSamples.length ? '\n  ' + badSamples.join('\n  ') : ''}`);
}
