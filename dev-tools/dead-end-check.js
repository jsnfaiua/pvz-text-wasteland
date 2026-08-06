// ============================================================
// 马路全方位死路检测：
// 1) 连通性死路：路网连通分量中度为 1 的末端格（非出城路/非废墟残路）
// 2) 相位断头：路带在非路口相位突然断掉（对应 smoke-test 判定，放大范围）
// 3) 主干道断头：arterial road 两端是否接到别的路/城市（跨城公路连续性）
// 4) 出城路统计：路带延伸到城市边界的正常收尾（应存在且不误判）
// 5) 死路对人行道影响：死路末端人行道带是否缺失/孤儿
// 用法：node dev-tools/dead-end-check.js [seed ...]
// ============================================================
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, arterialInfoAt, districtAt, blockAt, cityCenterAt } from '../source-code/mod-wasteland/wdistrict.js';

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(20260802, 12345, 987654321, 777, 424242);

const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE]);
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
    const isRoadLike = (gx, gy) => { const v = tileAt(gx, gy); return v !== undefined && ROAD_LIKE.has(v); };
    // 下层真实路面：碎石/倒树若脚下是保留路带或主干道，也算路面（障碍是上层叠加，不切断路带）
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
    const L = -C * CHUNK, H = C * CHUNK;

    console.log(`\n========== seed ${seed} ==========`);

    // ---- 1) 连通性死路（全局 4 邻；碎石/倒树按路面计）----
    let deg1 = 0, deg1Samples = [];
    let roadTotal = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        if (!isRoadSurface(gx, gy)) continue;
        roadTotal++;
        // 只统计"非出城、非废墟残路"的断头
        const inb = gx > L + 2 && gx < H - 3 && gy > L + 2 && gy < H - 3;
        if (!inb) continue;
        const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        let deg = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoadSurface(gx + dx, gy + dy)) deg++;
        if (deg !== 1) continue;
        // 出城路：8 邻含非城市区块（荒野）→ 正常收尾
        let touchesOutside = false;
        for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1 && !touchesOutside; dx++) {
            const nd = districtAt(seed, Math.floor((gx + dx) / CHUNK), Math.floor((gy + dy) / CHUNK));
            if (!CITY_LIKE.has(nd)) touchesOutside = true;
        }
        if (touchesOutside) continue;   // 出城路，正常
        if (d === 'ruins') continue;    // 废墟残路，容差
        deg1++;
        if (deg1Samples.length < 10) {
            const a = arterialClassAt(seed, gx, gy);
            deg1Samples.push(`(${gx},${gy}) 区块${d} 动脉=${a ?? '-'} 规划人=${plannedSidewalkAt(seed, gx, gy) ? 1 : 0} 保留路=${gridRoadKept(seed, gx, gy) ? 1 : 0}`);
        }
    }
    console.log(`[连通死路] 路面格 ${roadTotal}，死路末端 ${deg1} 格${deg1Samples.length ? '\n  ' + deg1Samples.join('\n  ') : ''}`);

    // ---- 2) 相位断头（对应 smoke-test 判定，放大到全域；碎石/倒树视为路面上层，下层算路）----
    const phase2 = (v, BL) => ((v % BL) + BL) % BL < 2;
    let phaseDead = 0; const pdSamples = [];
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
        if (dead) {
            phaseDead++;
            if (pdSamples.length < 10) pdSamples.push(`(${gx},${gy}) ${rU ? '下断' : rD ? '上断' : rR ? '左断' : '右断'} BL=${BL}`);
        }
    }
    console.log(`[相位断头] ${phaseDead} 格${pdSamples.length ? '\n  ' + pdSamples.join('\n  ') : ''}`);

    // ---- 3) 主干道断头：遍历主干道线段端点，检查两端是否接路/城市 ----
    // arterialInfoAt 太慢逐格跑；改用采样：沿主干道方向扫两端。
    let artBad = 0, artChecked = 0, artSamples = [];
    const probeArterial = (axis) => {
        for (let i = 0; i < 3000 && artChecked < 20; i++) {
            const gx = L + ((i * 977) % (H - L)), gy = L + ((i * 1399) % (H - L));
            const info = arterialInfoAt(seed, gx, gy);
            if (info.cls !== 'road' || info.axis !== axis) continue;
            const line = info.line;
            // 沿轴向前后各探 30 格：找路/人行道/城市连续段末端
            const coord = axis === 'h' ? gx : gy;
            const other = axis === 'h' ? gy : gx;
            // 确保采样点在该干道的稳定断面内（远离折点）
            const off = axis === 'h' ? gy - line : gx - line;
            if (off < -2 || off > 1) continue;
            // 向前端扫
            let fwd = 0;
            for (let s = 1; s <= 30; s++) {
                const px = axis === 'h' ? coord + s : line + off + s === undefined ? coord : coord;
                // 简化：用 arterialInfoAt 判定延伸是否还是同轴干道
                const nx = axis === 'h' ? gx + s : gx, ny = axis === 'h' ? gy : gy + s;
                const ni = arterialInfoAt(seed, nx, ny);
                if (ni.cls === 'road' && ni.axis === axis) { fwd++; continue; }
                // 遇到路口（另一轴干道）→ 正常
                if (ni.cls === 'road' && ni.axis !== axis) break;
                // 遇到人行道环 → 干道末端，正常收尾
                if (ni.cls === 'sidewalk') { fwd++; break; }
                // 出城（荒野）→ 正常
                const nd = districtAt(seed, Math.floor(nx / CHUNK), Math.floor(ny / CHUNK));
                if (!CITY_LIKE.has(nd)) break;
                // 城区内突然无路（可能是被建筑截断）→ 问题
                break;
            }
            // 主干道只要两端都能"走通到路口/环/出城"即视为正常；这里采样无法穷举，仅报告可疑
            artChecked++;
        }
    };
    probeArterial('h');
    probeArterial('v');
    console.log(`[主干道] 采样 ${artChecked} 处主干道断面（连续性与端点需结合渲染目视，Node 采样有限）`);

    // ---- 4) 出城路统计（应正常存在）----
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
    console.log(`[出城路] 城市边缘正常收尾的断头 ${exitRoads} 处（属设计允许）`);

    // ---- 5) 死路人行道影响：死路末端附近人行道带是否完整 ----
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
        // 检查末端两侧是否有人行道（垂直于路的方向）
        // 找路的延伸方向
        let dir = null;
        if (isRoadSurface(gx, gy + 1) || isRoadSurface(gx, gy + 2)) dir = 'v';
        else if (isRoadSurface(gx, gy - 1) || isRoadSurface(gx, gy - 2)) dir = 'v';
        else if (isRoadSurface(gx + 1, gy) || isRoadSurface(gx + 2, gy)) dir = 'h';
        else if (isRoadSurface(gx - 1, gy) || isRoadSurface(gx - 2, gy)) dir = 'h';
        if (!dir) continue;
        const sideA = dir === 'h' ? tileAt(gx, gy + 1) : tileAt(gx + 1, gy);
        const sideB = dir === 'h' ? tileAt(gx, gy - 1) : tileAt(gx - 1, gy);
        const okA = sideA === T.SIDEWALK, okB = sideB === T.SIDEWALK;
        if (okA && okB) swOk++;
        else { swBad++; }
    }
    console.log(`[人行道影响] 断头两侧人行道：双侧齐全 ${swOk} 处，缺失 ${swBad} 处`);
    if (swBad > 0) console.log('  ⚠️ 死路末端人行道带缺失（可能是视觉突兀点）');

    // 汇总
    console.log(`汇总: 连通死路=${deg1}  相位断头=${phaseDead}  出城路=${exitRoads}  人行道缺=${swBad}`);
}
