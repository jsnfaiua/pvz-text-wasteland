// ============================================================
// 荒原模组 · 性能基准（性能护栏第 ⑪ 条：性能基准回跑）
// 运行：node dev-tools/perf-bench.mjs
//        node dev-tools/perf-bench.mjs --commit   （无退化时更新基线）
// 作用：量化关键热路径耗时，与持久化基线对比。
// 退化规则：任一单项相对基线退化 > 30% → 打印 REGRESSION 并退出码非 0（性能回归必须修复）。
// 基线存储：dev-tools/.perf-baseline.json（首次运行自动创建；--commit 更新为本次数值）。
// 指标清单（全部为可复现的纯算法微基准）：
//   1. A* 单点路径搜索   (astarPath, 1500 节点上限)
//   2. 多目标流场        (astarField, 60 目标 / 80000 节点上限)
//   3. 曼哈顿粗筛        (nearestThreat 风格：粗筛 vs 全量 sqrt)
//   4. 空间哈希排斥      (buildNpcRepelGrid + repelNearNpcs 风格)
//   5. 全量距离计算      (旧 O(N²) 排斥，对比用)
// 结果打印：每次运行输出 ms，与基线比值，退化标记；最后退出码 0=通过 / 1=性能回归。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { astarPath, astarField } from '../source-code/mod-wasteland/wpath.js';
import * as World from '../source-code/mod-wasteland/world.js';
import { TS } from '../source-code/mod-wasteland/wconst.js';

const { genChunkTiles, T, getTile, isWalk } = World;

// ---- 测试世界 ----
const sv = { world: { seed: 777, chunks: new Map(), tiles: new Map() }, mods: { tiles: new Map() } };
for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) genChunkTiles(sv.world, cx, cy);
function canStand(x, y) {
    const t = getTile(sv, Math.floor(x / TS), Math.floor(y / TS));
    return isWalk(t) || t === T.ROAD || t === T.SIDEWALK || t === T.FLOOR;
}

// ---- 性能工具 ----
// v4.52 抗噪：每次取 3 轮中位数（微秒级指标对 CPU 调度噪声极度敏感，单次测量 ±70% 波动常见）。
function bench(name, fn, iters = 1) {
    // 预热（JIT）
    for (let i = 0; i < 20; i++) fn();
    const samples = [];
    for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        for (let i = 0; i < iters; i++) fn();
        samples.push((performance.now() - t0) / iters);
    }
    samples.sort((a, b) => a - b);
    const dt = samples[1];   // 中位数
    console.log(`${name.padEnd(34)} ${dt.toFixed(3).padStart(8)} ms  (3轮中位)`);
    return dt;
}

// 假数据：模拟 60 个 NPC 散布在 3 区块内
const NPCS = 60;
const npcs = [];
for (let i = 0; i < NPCS; i++) {
    npcs.push({
        x: (Math.random() * 96 - 48) * TS + TS / 2,
        y: (Math.random() * 96 - 48) * TS + TS / 2,
        alive: true, riding: false,
    });
}
// 60 个僵尸目标
const zombies = [];
for (let i = 0; i < 60; i++) zombies.push({ x: (Math.random() * 96 - 48) * TS, y: (Math.random() * 96 - 48) * TS });

const _NPC_CELL = 40;
const gkey = (x, y) => ((x * 73856093) ^ (y * 19349663));
function buildGrid() {
    const g = new Map();
    for (const o of npcs) {
        if (!o.alive || o.riding) continue;
        const k = gkey(Math.floor(o.x / _NPC_CELL), Math.floor(o.y / _NPC_CELL));
        let l = g.get(k); if (!l) { l = []; g.set(k, l); } l.push(o);
    }
    return g;
}
function repelViaGrid(g, n) {
    const cx = Math.floor(n.x / _NPC_CELL), cy = Math.floor(n.y / _NPC_CELL);
    let out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = g.get(gkey(cx + dx, cy + dy)); if (!l) continue;
        for (const o of l) {
            if (o === n) continue;
            const dxo = n.x - o.x, dyo = n.y - o.y;
            if (dxo * dxo + dyo * dyo < 144) out.push(o);
        }
    }
    return out;
}

// ---- 基准执行 ----
console.log('='.repeat(70));
console.log('荒原模组 · 性能基线（v4.48 基准）');
console.log('='.repeat(70));

// 1. A* 单点
const r1 = bench('astarPath 单点(1500上限)', () => {
    astarPath(10, 10, 40, 40, { canStand, ts: TS, maxNodes: 1500, maxPathLen: 512 });
}, 30);

// 2. 多目标流场
const r2 = bench('astarField 60目标(8万上限)', () => {
    const targets = new Set(zombies.map(z => Math.floor(z.x / TS) + ',' + Math.floor(z.y / TS)));
    astarField(10, 10, targets, { canStand, ts: TS, maxNodes: 80000 });
}, 10);

// 3. 曼哈顿粗筛 vs 全量（60 NPC + 60 僵尸的威胁收集）
function threatFull() {
    let best = null, bestD = 8 * TS;
    for (const z of zombies) {
        const d = Math.hypot(z.x - npcs[0].x, z.y - npcs[0].y);
        if (d < bestD) { bestD = d; best = z; }
    }
    for (const o of npcs) {
        if (o === npcs[0]) continue;
        const d = Math.hypot(o.x - npcs[0].x, o.y - npcs[0].y);
        if (d < bestD) { bestD = d; best = o; }
    }
    return best;
}
function threatCoarse() {
    let best = null, bestD = 8 * TS;
    const nx = npcs[0].x, ny = npcs[0].y;
    for (const z of zombies) {
        const dx = z.x - nx, dy = z.y - ny;
        if (Math.abs(dx) > bestD || Math.abs(dy) > bestD) continue;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = z; }
    }
    for (const o of npcs) {
        if (o === npcs[0]) continue;
        const dx = o.x - nx, dy = o.y - ny;
        if (Math.abs(dx) > bestD || Math.abs(dy) > bestD) continue;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = o; }
    }
    return best;
}
const r3a = bench('nearestThreat 全量sqrt(120目标)', threatFull, 200);
const r3b = bench('nearestThreat 曼哈顿粗筛(120目标)', threatCoarse, 200);

// 4. 空间哈希排斥 vs 全遍历（60 NPC 每帧）
const g = buildGrid();
const r4a = bench('排斥:网格构建+60次查询', () => {
    const g2 = buildGrid();
    for (const n of npcs) repelViaGrid(g2, n);
}, 200);
const r4b = bench('排斥:旧O(N²)全遍历', () => {
    for (const n of npcs) {
        for (const o of npcs) {
            if (o === n || !o.alive) continue;
            const dxo = n.x - o.x, dyo = n.y - o.y;
            if (dxo * dxo + dyo * dyo < 144) { /* push */ }
        }
    }
}, 200);

console.log('-'.repeat(70));
console.log('粗筛节省:  ' + (100 * (1 - r3b / r3a)).toFixed(1) + '%   （越快越好，越大越好）');
console.log('网格节省:  ' + (100 * (1 - r4a / r4b)).toFixed(1) + '%   （越快越好，越大越好）');
console.log('='.repeat(70));

// ---- 持久化基线 + 退化判定（性能护栏第 ⑪ 条）----
const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_FILE = path.join(__dir, '.perf-baseline.json');
const results = {
    astarPath: r1, astarField: r2, threatCoarse: r3b, repelGrid: r4a,
    savedAt: new Date().toISOString(),
};
const THRESHOLD = 0.30;   // >30% 退化判定
const COMMIT = process.argv.includes('--commit');
let baseline = null;
try { baseline = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (e) { baseline = null; }

console.log('性能指标（ms）:');
let regressions = [];
// v4.52 抗噪：极微秒级指标（单次 <0.01ms，如 threatCoarse≈0.004ms）受 CPU 调度噪声影响大
// （实测 ±70% 波动），阈值放宽到 50%；毫秒级指标（astarPath/astarField/repelGrid）保持 30%。
for (const k of ['astarPath', 'astarField', 'threatCoarse', 'repelGrid']) {
    const cur = results[k];
    const base = baseline ? baseline[k] : null;
    const thr = cur < 0.01 ? 0.50 : THRESHOLD;
    let line = `  ${k.padEnd(14)} ${cur.toFixed(base && k !== 'astarPath' ? 4 : 2).padStart(9)} ms`;
    if (base != null && base > 0) {
        const ratio = cur / base;
        const mark = ratio > 1 + thr ? '  ⚠ REGRESSION' : (ratio < 1 - thr ? '  (improved)' : '  ok');
        line += `   vs基线 ${ratio.toFixed(2)}x${mark}${thr !== THRESHOLD ? '  (噪声阈值50%)' : ''}`;
        if (ratio > 1 + thr) regressions.push(`${k} ${cur.toFixed(4)} vs ${base.toFixed(4)} (${ratio.toFixed(2)}x)`);
    } else {
        line += '   （首次运行，已存为基线）';
    }
    console.log(line);
}

if (baseline == null || COMMIT) {
    fs.writeFileSync(BASE_FILE, JSON.stringify(results, null, 2));
    console.log(baseline == null ? '\n[基线] 首次运行：已写入 ' + path.basename(BASE_FILE)
        : '\n[基线] --commit：基线已更新为本次数值');
}
if (regressions.length) {
    console.log('\n❌ 性能回归（退化 >30%），必须修复：');
    for (const r of regressions) console.log('   - ' + r);
    console.log('\n若确认本次改动必要，可先优化再跑；基线更新用: node dev-tools/perf-bench.mjs --commit');
    process.exit(1);   // 非 0 退出码 → 开发流程拦截
} else {
    console.log(baseline ? '\n✅ 通过：无性能回归（相对上次基线）' : '\n✅ 已建立基线');
}
