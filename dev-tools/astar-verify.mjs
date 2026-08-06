// ============================================================
// A* 流场对照验证：新 wpath.astarField（octile 启发式）vs 旧 Dijkstra（发现锁定版）
// 断言（硬性）：
//  1. 旧版可达的目标，新版也必须可达（不丢可达性）
//  2. 共同可达目标的回溯步数：new ≤ old（A* 路径不劣于旧 Dijkstra，不绕远）
//  3. 回溯路径每步 8 邻相邻且全部可站（无穿墙）
// 观察项（报告）：扩展节点数（new vs old）、耗时、加速比例
// 运行：node --max-old-space-size=2048 dev-tools/astar-verify.mjs [--seeds=N] [--rounds=N]
// ============================================================

import * as World from '../source-code/mod-wasteland/world.js';
import { astarField, astarPath } from '../source-code/mod-wasteland/wpath.js';
import { TS } from '../source-code/mod-wasteland/wconst.js';

const { genChunkTiles, T, CHUNK, getTile, setTile, isWalk } = World;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const gk = (x, y) => x + ',' + y;

// ---- 旧实现对照（完全复刻 wzombie.js 原 buildPlayerPathField："发现锁定"版 Dijkstra）----
function dijkstraField(sv, sx, sy, targets, canStand, maxNodes) {
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
            if (seen.has(key) || !canStand((nx + 0.5) * TS, (ny + 0.5) * TS)) continue;
            if (dx && dy && (!canStand((gx + dx + 0.5) * TS, (gy + 0.5) * TS) || !canStand((gx + 0.5) * TS, (gy + dy + 0.5) * TS))) continue;
            seen.add(key);
            field.parent.set(key, { gx, gy });
            if (targets.has(key)) found++;
            push([cost + (dx && dy ? 14 : 10), nx, ny]);
        }
    }
    field.reachable = seen;
    return field;
}

// ---- 工具 ----
function makeSv(seed) {
    return { world: { seed, chunks: new Map() }, mods: { tiles: {} } };
}
const canStandOf = (sv) => (x, y) => isWalk(getTile(sv, Math.floor(x / TS), Math.floor(y / TS)));

// 从 parent 表回溯到起点，返回 { cost, steps }（代价=10*直行+14*对角；走不到返回 cost=Infinity）
function backTrace(field, key, guard) {
    const ki = key.indexOf(',');
    let last = [+key.slice(0, ki), +key.slice(ki + 1)];   // 从目标格起算，第一步也计入代价
    let cur = key, steps = 0, cost = 0;
    for (let i = 0; i < guard && field.parent.has(cur); i++) {
        const p = field.parent.get(cur);
        const dx = Math.abs(p.gx - last[0]), dy = Math.abs(p.gy - last[1]);
        if (dx > 1 || dy > 1) return { cost: Infinity, steps, jump: true };   // 跳格 = 非法
        cost += (dx && dy) ? 14 : 10;
        last = [p.gx, p.gy];
        steps++;
        cur = gk(p.gx, p.gy);
    }
    if (field.parent.has(cur)) return { cost: Infinity, steps };   // 没回到起点（防环/超限）
    return { cost, steps };
}

function parseArgs() {
    const a = process.argv.slice(2);
    let seeds = 5, rounds = 3;
    for (let i = 0; i < a.length; i++) {
        const m = /^--(seeds|rounds)=(\d+)$/.exec(a[i]);
        if (m) { if (m[1] === 'seeds') seeds = +m[2]; else rounds = +m[2]; }
        else if (a[i] === '--seeds') seeds = +a[i + 1];
        else if (a[i] === '--rounds') rounds = +a[i + 1];
    }
    return { seeds, rounds };
}

function main() {
    const { seeds, rounds } = parseArgs();
    const seedList = [];
    let s = 20260802;
    for (let i = 0; i < seeds; i++) { seedList.push(s); s = (s * 1103515245 + 12345) >>> 0 || 1; }
    const MAX_NODES = 12000, AREA = 48, CENTER = 24;
    let fail = 0, totalTargets = 0, worse = 0;
    let sumOldSeen = 0, sumNewSeen = 0, sumOldT = 0, sumNewT = 0, runs = 0;

    for (const seed of seedList) {
        const sv = makeSv(seed);
        // 生成 3×3 区块（48×48 格），并随机加 400 棵树制造障碍
        for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) {
            World.chunkOf(sv, cx - 1, cy - 1);
        }
        let rng = seed >>> 0;
        const rnd = () => { rng = (rng * 1103515245 + 12345) >>> 0; return rng / 4294967296; };
        for (let i = 0; i < 400; i++) {
            const gx = Math.floor(rnd() * AREA), gy = Math.floor(rnd() * AREA);
            if (Math.abs(gx - CENTER) <= 2 && Math.abs(gy - CENTER) <= 2) continue;
            if (isWalk(getTile(sv, gx, gy))) setTile(sv, gx, gy, T.TREE);
        }
        const canStand = canStandOf(sv);

        for (let r = 0; r < rounds; r++) {
            // 起点：中心（若被树占则就近找可走格）
            let sx = CENTER, sy = CENTER;
            if (!canStand((sx + 0.5) * TS, (sy + 0.5) * TS)) {
                outer: for (let rad = 1; rad <= 4; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                    if (canStand((CENTER + dx + 0.5) * TS, (CENTER + dy + 0.5) * TS)) { sx = CENTER + dx; sy = CENTER + dy; break outer; }
                }
            }
            // 目标：20 个随机可达格 + 5 个手工孤岛（选格后 8 邻围树 → 确定不可达）
            const targets = new Set(), islandKeys = [];
            let tries = 0;
            while (targets.size < 20 && tries++ < 2000) {
                const gx = Math.floor(rnd() * AREA), gy = Math.floor(rnd() * AREA);
                if (!isWalk(getTile(sv, gx, gy))) continue;
                if (gx === sx && gy === sy) continue;
                targets.add(gk(gx, gy));
            }
            for (let i = 0; i < 5; i++) {
                let gx = 0, gy = 0, ok = false;
                for (let t = 0; t < 300 && !ok; t++) {
                    gx = 4 + Math.floor(rnd() * (AREA - 8));
                    gy = 4 + Math.floor(rnd() * (AREA - 8));
                    if (Math.abs(gx - sx) + Math.abs(gy - sy) < 6) continue;   // 远离起点
                    if (!isWalk(getTile(sv, gx, gy))) continue;
                    if (targets.has(gk(gx, gy))) continue;
                    ok = true;
                    for (const [dx, dy] of DIRS) {
                        const nx = gx + dx, ny = gy + dy;
                        if (nx === sx && ny === sy) { ok = false; break; }   // 别把起点围进去
                        if (isWalk(getTile(sv, nx, ny))) setTile(sv, nx, ny, T.TREE);
                    }
                }
                if (ok) { targets.add(gk(gx, gy)); islandKeys.push(gk(gx, gy)); }
            }

            const t0 = performance.now();
            const fieldOld = dijkstraField(sv, sx, sy, targets, canStand, MAX_NODES);
            const t1 = performance.now();
            const fieldNew = astarField(sx, sy, targets, { canStand: (x, y) => canStand(x, y), ts: TS, maxNodes: MAX_NODES });
            const t2 = performance.now();

            sumOldSeen += fieldOld.reachable.size; sumNewSeen += fieldNew.reachable.size;
            sumOldT += t1 - t0; sumNewT += t2 - t1; runs++;

            for (const key of targets) {
                totalTargets++;
                const oldReach = fieldOld.reachable.has(key), newReach = fieldNew.reachable.has(key);
                if (oldReach && !newReach) {   // 断言 1：不丢可达性
                    fail++; console.error(`  FAIL 可达性丢失 seed=${seed} round=${r} target=${key}`);
                    continue;
                }
                if (!oldReach && !newReach) continue;   // 双方都不可达（孤岛）→ 一致
                const ot = backTrace(fieldOld, key, MAX_NODES), nt = backTrace(fieldNew, key, MAX_NODES);
                if (nt.jump || (nt.cost === Infinity && ot.cost !== Infinity)) {   // 断言 3：不跳格/不丢可达
                    fail++;
                    console.error(`  FAIL 路径非法 seed=${seed} round=${r} target=${key} oldCost=${ot.cost} newCost=${nt.cost}`);
                    continue;
                }
                if (nt.cost > ot.cost) {   // 断言 2：路径代价不劣于旧实现（不绕远）
                    fail++;
                    worse++;
                    console.error(`  FAIL 绕远 seed=${seed} round=${r} target=${key} oldCost=${ot.cost} newCost=${nt.cost} (steps ${ot.steps}->${nt.steps})`);
                }
            }

            // astarPath 单点寻路验证：第一个可达目标 → 路径连续、终点正确、代价与流场一致
            for (const key of targets) {
                if (!fieldNew.reachable.has(key)) continue;
                const i = key.indexOf(',');
                const tx = +key.slice(0, i), ty = +key.slice(i + 1);
                const path = astarPath(sx, sy, tx, ty, { canStand: (x, y) => canStand(x, y), ts: TS, maxNodes: MAX_NODES });
                if (!path.length) { fail++; console.error(`  FAIL astarPath 空路径 seed=${seed} target=${key}`); break; }
                const last = path[path.length - 1];
                if (last.x !== tx || last.y !== ty) { fail++; console.error(`  FAIL astarPath 终点错 seed=${seed} target=${key} got=${last.x},${last.y}`); break; }
                let ok = true, pcost = 0, prevP = { x: sx, y: sy };
                for (const p of path) {
                    const dx = Math.abs(p.x - prevP.x), dy = Math.abs(p.y - prevP.y);
                    if (dx > 1 || dy > 1) { ok = false; break; }
                    if (!canStand((p.x + 0.5) * TS, (p.y + 0.5) * TS)) { ok = false; break; }
                    pcost += (dx && dy) ? 14 : 10;
                    prevP = p;
                }
                if (!ok) { fail++; console.error(`  FAIL astarPath 路径非法 seed=${seed} target=${key}`); break; }
                const nt2 = backTrace(fieldNew, key, MAX_NODES);
                if (pcost !== nt2.cost) { fail++; console.error(`  FAIL astarPath 代价不一致 seed=${seed} target=${key} path=${pcost} field=${nt2.cost}`); break; }
                break;   // 每轮只验第一个可达目标
            }
        }
    }

    console.log('==== A* 流场对照验证结果 ====');
    console.log(`种子数=${seedList.length} 轮次=${rounds} 目标样本=${totalTargets}`);
    console.log(`断言失败: ${fail}  (0 = 通过)`);
    console.log(`-- 性能观察（所有 run 合计） --`);
    console.log(`旧 Dijkstra 扩展节点: ${sumOldSeen}  新 A* 扩展节点: ${sumNewSeen}  节省: ${(100 * (1 - sumNewSeen / Math.max(1, sumOldSeen))).toFixed(1)}%`);
    console.log(`旧 Dijkstra 耗时: ${sumOldT.toFixed(1)}ms  新 A* 耗时: ${sumNewT.toFixed(1)}ms  加速: ${(100 * (1 - sumNewT / Math.max(0.001, sumOldT))).toFixed(1)}%`);
    console.log(fail === 0 ? '✅ 全部断言通过：路径不劣于旧实现，不丢可达性，不穿墙' : `❌ ${fail} 个断言失败`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
