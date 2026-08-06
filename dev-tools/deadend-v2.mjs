// 连通分量级死路检测：找"真死胡同"（从路网末端回溯，只有一条路径且尽头无路）
// 比 deg=1 更准确：一个路带端点如果是"出城/路口/另一条路"则正常；只有"末端被建筑/草地完全堵死"才算死路。
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, districtAt } from '../source-code/mod-wasteland/wdistrict.js';

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

    // 统计死胡同：deg=1 的格，且其唯一邻居方向的延伸（沿路往前 3 格）也走不到任何路口/出城
    let deadEnds = 0; const samples = [];
    for (let gy = L + 2; gy < H - 2; gy++) for (let gx = L + 2; gx < H - 2; gx++) {
        if (!isRoadSurface(gx, gy)) continue;
        const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        if (d !== 'urban' && d !== 'suburb') continue;
        // 找唯一邻居方向
        let nbr = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (isRoadSurface(gx + dx, gy + dy)) {
                if (nbr) { nbr = null; break; }   // 2+ 邻居，非末端
                nbr = { dx, dy };
            }
        }
        if (!nbr) continue;
        // 沿延伸方向走 4 格：若都只是"路"且周围无其它路/人行道/出城 → 死胡同
        let len = 1;
        let cx = gx, cy = gy;
        for (let i = 0; i < 6; i++) {
            cx += nbr.dx; cy += nbr.dy;
            if (!isRoadSurface(cx, cy)) break;
            len++;
            // 检查该格是否有分支（垂直方向的其它路）或已出城
            let branch = false;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx === cx - nbr.dx && ny === cy - nbr.dy) continue;   // 回头路
                if (isRoadSurface(nx, ny)) { branch = true; break; }
            }
            const nd = districtAt(seed, Math.floor(cx / CHUNK), Math.floor(cy / CHUNK));
            if (branch || !CITY_LIKE.has(nd)) break;   // 遇到路口/出城 → 不是死路
        }
        // 如果走了 6 格还在城区内且无分支 → 疑似死路（路带长度有限但尽头无路口）
        // 更精确：路的尽头（deg=1 的另一端）应接人行道环或出城，否则是真死路
        let endGx = gx, endGy = gy;
        let prevX = gx - nbr.dx, prevY = gy - nbr.dy;   // 反向：找另一端
        // 从末端反向走到另一端
        let px = gx, py = gy, lastDx = nbr.dx, lastDy = nbr.dy, steps = 0;
        while (steps < 30) {
            let found = null;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (dx === -lastDx && dy === -lastDy) continue;   // 不回头
                if (isRoadSurface(px + dx, py + dy)) { found = { dx, dy }; break; }
            }
            if (!found) break;   // 到达另一端
            px += found.dx; py += found.dy;
            lastDx = found.dx; lastDy = found.dy;
            steps++;
            // 检查该点是否有分支路口
            let br = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (isRoadSurface(px + dx, py + dy)) br++;
            }
            if (br >= 3) break;   // 十字/丁字路口 → 正常
        }
        // 走到另一端后，检查端点的"前方"是否接人行道/出城
        const endNX = px + lastDx, endNY = py + lastDy;
        const endND = districtAt(seed, Math.floor(endNX / CHUNK), Math.floor(endNY / CHUNK));
        const endIsSidewalk = tileAt(endNX, endNY) === T.SIDEWALK;
        const endOutside = !CITY_LIKE.has(endND);
        // 只有"另一端前方是人行道环/出城"才算正常收尾
        if (!endIsSidewalk && !endOutside && steps > 0) {
            // 再确认：端点是否直接邻接人行道（路带末端自然收口）
            let adjSw = false;
            for (let dy = -1; dy <= 1 && !adjSw; dy++) for (let dx = -1; dx <= 1 && !adjSw; dx++) {
                if (tileAt(px + dx, py + dy) === T.SIDEWALK) adjSw = true;
            }
            if (!adjSw) {
                deadEnds++;
                if (samples.length < 8) samples.push('(' + px + ',' + py + ') 末端前方=(' + endNX + ',' + endNY + ') ' + (tileAt(endNX, endNY) === T.GROUND ? '草' : String(tileAt(endNX, endNY))));
            }
        }
    }
    console.log('seed ' + seed + ': 真死胡同 ' + deadEnds + ' 处' + (samples.length ? '\n  ' + samples.join('\n  ') : ''));
}
