// ============================================================
// 多目标 A* 性能基准：模拟 wzombie 僵尸流场场景
// 玩家移动 → 每帧重建流场（targets = 全部存活僵尸）
// 对比：wpath.astarField（min 模式 / box 模式）vs 旧 Dijkstra 复刻
// 运行：node --max-old-space-size=2048 dev-tools/astar-multitarget-bench.mjs
// ============================================================
import * as World from '../source-code/mod-wasteland/world.js';
import { astarField } from '../source-code/mod-wasteland/wpath.js';
import { TS } from '../source-code/mod-wasteland/wconst.js';

const { genChunkTiles, T, CHUNK, getTile, setTile, isWalk, newSeed, hash2 } = World;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const gk = (x, y) => x + ',' + y;

function makeSv(seed) {
    const sv = { world: { seed, chunks: new Map(), tiles: new Map() }, mods: { tiles: new Map() } };
    genChunkTiles(sv.world, Math.floor(0 / CHUNK), Math.floor(0 / CHUNK));
    genChunkTiles(sv.world, Math.floor(1 / CHUNK), Math.floor(0 / CHUNK));
    return sv;
}

// 简单 zCanStand：isWalk 或 是路/人行道/地板
function zCanStand(x, y) {
    const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
    const t = getTile(sv, gx, gy);
    return isWalk(t) || t === T.ROAD || t === T.SIDEWALK || t === T.FLOOR;
}

// 旧 Dijkstra 复刻（发现锁定）
function dijkstraField(sv, sx, sy, targets, maxNodes) {
    const field = { parent: new Map(), reachable: new Set([gk(sx, sy)]) };
    if (!targets.size) return field;
    const heap = [[0, sx, sy]];
    const push = (e) => {
        heap.push(e);
        let i = heap.length - 1;
        for (; i > 0;) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= e[0]) break;
            heap[i] = heap[p]; i = p;
        }
        heap[i] = e;
    };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            let i = 0;
            while (i * 2 + 1 < heap.length) {
                let c = i * 2 + 1;
                if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
                if (heap[c][0] >= last[0]) break;
                heap[i] = heap[c]; i = c;
            }
            heap[i] = last;
        }
        return top;
    };
    const seen = new Set([gk(sx, sy)]);
    let found = targets.has(gk(sx, sy)) ? 1 : 0;
    while (heap.length && found < targets.size && seen.size < maxNodes) {
        const [cost, gx, gy] = pop();
        for (const [dx, dy] of DIRS) {
            const nx = gx + dx, ny = gy + dy, key = gk(nx, ny);
            if (seen.has(key) || !zCanStand((nx + 0.5) * TS, (ny + 0.5) * TS)) continue;
            if (dx && dy && (!zCanStand((gx + dx + 0.5) * TS, (gy + 0.5) * TS) || !zCanStand((gx + 0.5) * TS, (gy + dy + 0.5) * TS))) continue;
            seen.add(key);
            field.parent.set(key, { gx, gy });
            if (targets.has(key)) found++;
            push([cost + (dx && dy ? 14 : 10), nx, ny]);
        }
    }
    return field;
}

// 在玩家周围随机撒僵尸（可走格）
function spawnZombies(sv, px, py, count, rng) {
    const targets = new Set();
    let guard = 0;
    while (targets.size < count && guard++ < count * 50) {
        const gx = Math.floor(px / TS) + Math.floor(rng() * 40 - 20);
        const gy = Math.floor(py / TS) + Math.floor(rng() * 40 - 20);
        const t = getTile(sv, gx, gy);
        if (isWalk(t) || t === T.ROAD || t === T.SIDEWALK || t === T.FLOOR) targets.add(gk(gx, gy));
    }
    return targets;
}

let sv;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const seeds = [20260802, 12345, 987654321, 777, 42];
for (const seed of seeds) {
    sv = makeSv(seed);
    const rng = mulberry32(seed + 1);
    for (const zcount of [10, 30, 60, 100]) {
        const px = 0.5 * TS + Math.floor(rng() * 8) * TS;
        const py = 0.5 * TS + Math.floor(rng() * 8) * TS;
        const targets = spawnZombies(sv, px, py, zcount, rng);
        const sx = Math.floor(px / TS), sy = Math.floor(py / TS);
        const opts = { canStand: zCanStand, ts: TS, maxNodes: 12000 };

        // 预热
        astarField(sx, sy, targets, { ...opts, heuristic: 'min' });
        astarField(sx, sy, targets, { ...opts, heuristic: 'box' });
        dijkstraField(sv, sx, sy, targets, 12000);

        let t0 = performance.now();
        for (let i = 0; i < 30; i++) astarField(sx, sy, targets, { ...opts, heuristic: 'min' });
        const minMs = (performance.now() - t0) / 30;

        t0 = performance.now();
        for (let i = 0; i < 30; i++) astarField(sx, sy, targets, { ...opts, heuristic: 'box' });
        const boxMs = (performance.now() - t0) / 30;

        t0 = performance.now();
        for (let i = 0; i < 30; i++) dijkstraField(sv, sx, sy, targets, 12000);
        const dijMs = (performance.now() - t0) / 30;

        console.log(`seed=${seed} 僵尸=${zcount} 目标=${targets.size} | min=${minMs.toFixed(1)}ms box=${boxMs.toFixed(1)}ms dijkstra=${dijMs.toFixed(1)}ms`);
    }
}
console.log('\n⚠ 结论：60fps 预算 = 16.7ms/帧。wzombie 默认 heuristic 未指定 → targets≤64 走 min 模式。');
