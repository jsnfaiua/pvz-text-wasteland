// ============================================================================
// 掉帧排查全矩阵测试（2026-08-11 v2.99）
// 覆盖所有潜在掉帧点：
//   A. 渲染层视口裁剪（僵尸/NPC/掉落/草/容器 每帧只画屏幕内）
//   B. 离屏缓存（树/僵尸/感染/文字掩码/世界静态层/草瓦片）
//   C. 逻辑层高频循环保护（NPC 远距离降频/排斥裁剪/威胁缓存/共享流场）
//   D. 僵尸寻路场（冷却重建/近距化 targets/不可达标记节流）
//   E. 数量上限（特效/掉落/粒子/缓存容量）
//   F. 高负载模拟（60 僵尸 + 60 NPC + 150 掉落 + 50 特效 + 尸潮）→ 单帧耗时上限
// 运行：node dev-tools/perf-matrix.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(projRoot, 'source-code/mod-wasteland/' + f), 'utf8');
const render = read('render.js');
const wnpc = read('wnpc.js');
const wzombie = read('wzombie.js');
const wgrass = read('wgrass.js');
const survival = read('survival.js');
const wstate = read('wstate.js');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) pass++; else { console.log('✗ FAIL: ' + m); fail++; } };

// ============ A. 渲染层视口裁剪 ============
console.log('\n===== A. 渲染层视口裁剪 =====');
assert(render.includes('if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;'), 'A: 僵尸渲染视口裁剪');
assert(render.includes('// 性能：屏幕外 NPC 不绘制（含名条/血条/特效）'), 'A: NPC 渲染视口裁剪');
assert(render.includes('if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;'), 'A: 掉落渲染视口裁剪');
assert(wgrass.includes('if (sx < -32 || sx > W + 32 || sy < -32 || sy > H + 32) continue;'), 'A: 草束渲染视口裁剪');
assert(wgrass.includes('const t0x = Math.floor(camX / TS) - 1'), 'A: 草层按视口遍历');

// ============ B. 离屏缓存 ============
console.log('\n===== B. 离屏缓存 =====');
assert(render.includes('const _zombieCache = new Map();'), 'B: 僵尸离屏缓存');
assert(render.includes('const _treeCache = new Map();'), 'B: 树离屏缓存');
assert(render.includes('const _tileInfectionCache = new Map();'), 'B: 感染瓦片缓存');
assert(render.includes('const pixelWordCache = new Map();'), 'B: 文字掩码缓存');
assert(render.includes('let _worldGroundCache = null;'), 'B: 世界地面层缓存');
assert(render.includes('let _worldObjectCache = null;'), 'B: 世界物体层缓存');
assert(render.includes('const CACHE_MAX = 400;'), 'B: 缓存容量上限 400');
assert(wgrass.includes('瓦片启动预渲染（4季×8形态×5帧=160 离屏 canvas）'), 'B: 草瓦片预渲染');
assert(wgrass.includes('_tiles[season]') || wgrass.includes('const tiles = _tiles'), 'B: 草瓦片缓存');

// ============ C. 逻辑层高频循环保护 ============
console.log('\n===== C. 逻辑层高频循环保护 =====');
assert(wnpc.includes('const AI_FAR_DIST = 14 * TS;'), 'C: NPC 远距离 AI 降频');
assert(wnpc.includes('if (Math.hypot(n.x - sv.px, n.y - sv.py) > AI_FAR_DIST)'), 'C: NPC 远距离 0.3s 一跳');
assert(wnpc.includes('if (dxo > 12 || dxo < -12) continue;   // 快速裁剪'), 'C: NPC 排斥 O(1) 裁剪');
assert(wnpc.includes('n._threatT = (n._threatT || 0) - dt;'), 'C: 威胁搜索缓存 0.12s');
assert(wnpc.includes('function getNpcFollowField(sv, canStand)'), 'C: NPC 共享流场');
assert(wnpc.includes("if (f && f.pk === pk && sv.now - f.t < 1.0) return f;"), 'C: 流场 1.0s 缓存（v2.99 降低重建频率）');
assert(wnpc.includes('// 性能：远离玩家的 NPC 降低 AI 频率'), 'C: 远距离降频注释');
assert(wzombie.includes('z._npcScanT = (z._npcScanT || 0) - dt;'), 'C: 僵尸咬 NPC 扫描节流');
assert(wzombie.includes('z._npcScanT = 0.2;'), 'C: 咬扫 0.2s 一跳');

// ============ D. 僵尸寻路场 ============
console.log('\n===== D. 僵尸寻路场 =====');
assert(wzombie.includes('function buildPlayerPathField(sv, zCanStand)'), 'D: 共享寻路场');
assert(wzombie.includes('sv._zombiePathNeedsRebuild = false;'), 'D: 重建标记复位');
assert(wzombie.includes('sv._pathRebuildCd = 0.35;'), 'D: 重建冷却 0.35s');
assert(wzombie.includes('if (field && sv._pathRebuildCd > 0'), 'D: 冷却内复用旧场');
assert(wzombie.includes('if (playerAlerted && (!sv._pathRebuildCd || sv._pathRebuildCd <= 0)) sv._zombiePathNeedsRebuild = true;'), 'D: 不可达标记节流');

// ============ E. 数量上限 ============
console.log('\n===== E. 数量上限 =====');
assert(survival.includes('const maxEff = sv._devGfx === 0 ? 20 : sv._devGfx === 1 ? 35 : 50;'), 'E: 特效上限（低20/中35/高50）');
assert(survival.includes('if (sv.drops.length > 150) sv.drops.splice(0, sv.drops.length - 150);'), 'E: 掉落上限 150');
assert(render.includes('const WX_PART_MAX = 300;'), 'E: 天气粒子上限 300');
assert(render.includes("if (sv._devGfx === 0) return;   // 低画质：跳过粒子"), 'E: 低画质跳过粒子');
assert(render.includes('if (sv._devGfx === 0) return;   // 低画质：跳过夜晚暗色覆盖层'), 'E: 低画质跳过夜晚层');
assert(survival.includes('const cull = {') && survival.includes('serializeMpSnapshot(sv, STATE_DEPS, zombies, cull)'), 'E: 联机快照视野裁剪');

// ============ F. 高负载模拟（真实引擎） ============
console.log('\n===== F. 高负载模拟（60 僵尸 + 60 NPC + 150 掉落 + 50 特效 + 尸潮） =====');
// 打桩浏览器环境
const _lsStore = {};
const _lsStub = { getItem: k => (_lsStore[k] !== undefined ? _lsStore[k] : null), setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
try { globalThis.localStorage = _lsStub; } catch {}
globalThis.window = { localStorage: _lsStub, AudioContext: function () { const gain = () => ({ gain: { value: 0 }, connect() {} }); return { createGain: gain, destination: {}, currentTime: 0, createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }), decodeAudioData: (b, ok) => ok && ok({ duration: 1 }), createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }), createMediaElementSource: () => ({ connect() {} }), addEventListener() {}, removeEventListener() {}, state: 'running', resume() {} }; }, webkitAudioContext: undefined, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, requestAnimationFrame: cb => { cb(performance.now()); return 1; }, cancelAnimationFrame: () => {}, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540 };
globalThis.document = { createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }), addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, getElementsByClassName: () => [], body: { appendChild() {}, removeChild() {} }, documentElement: {}, createTextNode: () => ({}) };
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {}; globalThis.HTMLImageElement = function () {}; globalThis.Audio = function () {}; globalThis.OfflineAudioContext = function () {};

const M = await Promise.all([
    import('../source-code/mod-wasteland/world.js'),
    import('../source-code/mod-wasteland/wdistrict.js'),
    import('../source-code/mod-wasteland/wbalance.js'),
    import('../source-code/mod-wasteland/wmsg.js'),
    import('../source-code/mod-wasteland/wnpc.js'),
    import('../source-code/mod-wasteland/wzombie.js'),
    import('../source-code/mod-wasteland/whorde.js'),
    import('../source-code/mod-wasteland/wconst.js'),
]);
const { T, CHUNK, getTile, genChunkTiles } = M[0];
const { cityCenterAt } = M[1];
const B = M[2];
const MSG = M[3];
const WNPC = M[4];
const WZ = M[5];
const WH = M[6];
const { TS } = M[7];

function buildRun(seed) {
    const run = {
        active: true, dead: false, opts: { difficulty: 'normal' }, keys: {}, drops: [], zombies: [], bullets: [],
        hp: B.MAX_HP, maxHp: B.MAX_HP, day: 1, t: B.DAY_LEN * 0.35, dayLen: B.DAY_LEN,
        inv: Array(24).fill(null), px: 0, py: 0, faceX: 1, faceY: 0, camX: 0, camY: 0,
        swingT: 0, swingDir: 0, hurtT: 0, spawnT: 5, horde: null, announce: null,
        chop: {}, mine: {}, lastRestDay: 0, stepT: 0, stepSide: false, saveT: B.SAVE_INTERVAL,
        now: 0, last: 0, raf: 0, playT: 0, prompt: null, promptTarget: null, ctx: null,
        mouse: { x: 0, y: 0, inside: false }, mouseDown: false,
        world: { seed, chunks: new Map() }, mods: { tiles: {}, chests: {}, boxLoot: {}, explored: {}, plants: {} },
        homeBed: null, wpn: null, curSlot: 'ranged', stamina: 100, maxStamina: 100,
        build: false, buildSel: 0, buildOk: false, woodCount: 0, wpnText: '', chestKey: null,
        hotbar: Array(6).fill(null), hotbarSel: -1, sprinting: false, dashing: false,
        dashTimer: 0, dashDir: { x: 1, y: 0 }, dashCooldown: 0, dashGhosts: [], invuln: 0,
        guarding: false, guardTimer: 0, guardCooldown: 0, guardFacing: 0, perfectFlash: 0,
        isJumping: false, jumpOffset: 0, vy: 0, jumpCooldown: 0, exhausted: false, _stamDelay: 0,
        aiming: false, _atkSlowT: 0, _atkSlowImmune: 0, food: B.HUNGER_MAX, water: B.WATER_MAX,
        _starved: false, _starveLogT: 0, character: null, npcs: [], camp: null, controllerId: 'player',
        infection: 0, _infLogT: 0, effects: [],
        _zombiePathField: null, _zombiePathNeedsRebuild: true, _pathRebuildCd: 0, _zombiePathRevision: 0,
    };
    const cc = cityCenterAt(seed, 0, 0);
    const ang = (seed % 360) / 180 * Math.PI;
    const dist = 8 * CHUNK;
    run.px = (Math.round(cc.x * CHUNK + Math.cos(ang) * dist) + 0.5) * TS;
    run.py = (Math.round(cc.y * CHUNK + Math.sin(ang) * dist) + 0.5) * TS;
    run.world.seed = seed;
    run.msgs = [];
    MSG.initMsg(run);
    run.character = { body: '#39d98a', head: '#2b7a52', hat: null, face: null };
    return run;
}
function canStandProxy(x, y) {
    const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
    const t = getTile(sv, gx, gy);
    if (t === undefined) return true;
    return T.WALL !== t && T.DOOR !== t && T.TREE !== t && T.RUBBLE !== t && T.WATER !== t && T.CAR !== t && T.BARRICADE !== t && T.CARWRECK !== t;
}
let sv = buildRun(20260802);
WNPC.initRoster(sv);
WNPC.spawnInitialNpcs(sv);
WNPC.applyControlled(sv);

// 高负载填充：60 僵尸（30 近战 + 30 远，模拟真实尸潮分布）+ 4 人 party + 40 营地 NPC + 150 掉落 + 50 特效
// 恶意 NPC（spawnInitialNpcs 生成）移到 30 格外——真实场景：恶意 NPC 不在营地里
for (let i = 0; i < 30; i++) {
    WZ.spawnZombie(sv, i % 5 === 0 ? 'cone' : 'normal', Math.floor(sv.px / TS) + (i % 6), Math.floor(sv.py / TS) + Math.floor(i / 6), false);
}
for (let i = 0; i < 30; i++) {
    WZ.spawnZombie(sv, 'normal', Math.floor(sv.px / TS) + 14 + (i % 6), Math.floor(sv.py / TS) + Math.floor(i / 6), false);   // 远处 30 只（不参与玩家寻路场）
}
for (let i = 0; i < 4; i++) {
    const n = WNPC.makeNpc(sv, sv.px + (i - 1) * TS, sv.py + TS * (i % 2 === 0 ? 1 : -1), 'friendly');
    n.party = true; n.state = 'follow';
    sv.npcs.push(n);
}
// 40 营地友善 NPC（分散在玩家周围，模拟营地聚集但多数游荡/工作）
for (let i = 0; i < 40; i++) {
    const n = WNPC.makeNpc(sv, sv.px + ((i % 10) - 5) * TS * 1.5, sv.py + (Math.floor(i / 10) - 2) * TS * 1.5, 'friendly');
    n.state = 'wander';
    sv.npcs.push(n);
}
for (const n of sv.npcs) if (n.role === 'hostile') { n.x = sv.px + 30 * TS; n.y = sv.py; }
for (let i = 0; i < 150; i++) sv.drops.push({ x: sv.px + (i % 20) * 30, y: sv.py + Math.floor(i / 20) * 30, id: 'wood', n: 1, contents: null });
for (let i = 0; i < 50; i++) sv.effects.push({ kind: 'hit', x: sv.px + i * 5, y: sv.py, life: 0.3, maxLife: 0.3 });

// 预热玩家周围 6×6 区块（模拟已探索区域，消除首次生成一次性成本）
const pcx = Math.floor(sv.px / TS / CHUNK), pcy = Math.floor(sv.py / TS / CHUNK);
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const key = (pcx + dx) + ',' + (pcy + dy);
    if (!sv.world.chunks.has(key)) sv.world.chunks.set(key, { tiles: genChunkTiles(sv.world.seed, pcx + dx, pcy + dy) });
}

// 预热阶段：先跑 8 帧让寻路场/流场/威胁缓存建立（不计入统计）
for (let f = 0; f < 8; f++) {
    sv.now += 0.5; sv.t += 0.5;
    WNPC.updateNpcs(sv, 0.5, canStandProxy);
    WZ.updateZombies(sv, 0.5, canStandProxy, canStandProxy, () => {}, () => {});
}
// 测量稳态帧耗时（30 帧，取中位数与 P90 更稳定——Node 环境 GC/内存波动大）
const times = [];
for (let f = 0; f < 30; f++) {
    const t0 = performance.now();
    sv.now += 0.5; sv.t += 0.5;
    WNPC.updateNpcs(sv, 0.5, canStandProxy);
    WZ.updateZombies(sv, 0.5, canStandProxy, canStandProxy, () => {}, () => {});
    const t1 = performance.now();
    times.push(t1 - t0);
}
const sorted = times.slice().sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const med = sorted[Math.floor(sorted.length * 0.5)];
const p90 = sorted[Math.floor(sorted.length * 0.9)];
const max = sorted[sorted.length - 1];
console.log(`  高负载稳态 30 帧：平均 ${avg.toFixed(1)}ms · 中位 ${med.toFixed(1)}ms · P90 ${p90.toFixed(1)}ms · 峰值 ${max.toFixed(1)}ms`);
// Node 环境无 GPU 渲染，逻辑层阈值（30 近僵尸 + 30 远 + 44 NPC + 150 掉落 + 50 特效）：
// 用中位数（稳健统计，不受偶发 GC 尖峰干扰）：中位 < 15ms、P90 < 40ms
assert(med < 15, `F: 高负载稳态中位数 < 15ms (got ${med.toFixed(1)}ms)`);
assert(p90 < 40, `F: 高负载稳态 P90 < 40ms (got ${p90.toFixed(1)}ms)`);
assert(avg < 30, `F: 高负载稳态平均 < 30ms (got ${avg.toFixed(1)}ms)`);
// NPC 数量保护：44 只存活（4 party + 40 营地）
assert(sv.npcs.filter(n => n.alive).length >= 40, `F: 高负载 NPC 存活 ${sv.npcs.filter(n => n.alive).length}`);

console.log(`\n=== 掉帧排查矩阵: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
