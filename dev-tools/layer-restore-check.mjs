// ============================================================
// 层级恢复验证（控制变量法）：物体被玩家清理/移除后，
// 该格是否恢复为下层人行道/路面（而非变成草地）——
// 证明"物体是上层叠加，不侵占下层人行道语义"。
// 用法：node dev-tools/layer-restore-check.mjs seed1 seed2 ...
// ============================================================
const _lsStore = {};
globalThis.localStorage = { getItem: k => _lsStore[k] ?? null, setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
globalThis.window = { localStorage: globalThis.localStorage, AudioContext: function () { return {}; }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null,
    getElementsByClassName: () => [], body: {}, documentElement: {}, createTextNode: () => ({}),
};
try { globalThis.navigator = { userAgent: 'node' }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {};

const { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt, getTile } = await import('../source-code/mod-wasteland/world.js');
const { arterialClassAt } = await import('../source-code/mod-wasteland/wdistrict.js');

// 可合法立于人行道/规划环上的叠加物（check-map-quality 同款）。玩家改动该格时，
// getTile 的城市规划保护层会保留这些"城市保留物"（街道容器/车/残骸/资源箱），
// 不把它们还原成草地——这是设计行为，不是下层人行道被侵占。
const SIDEWALK_OK = new Set([T.SIDEWALK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES, T.CAR, T.CARWRECK, T.RUBBLE, T.BOX, T.WBOX, T.MEDBOX, T.MATBOX]);

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
if (!seeds.length) { console.error('至少需要一个种子'); process.exit(2); }

const OBJECTS = new Set([
    T.TREE, T.RUBBLE, T.BOX, T.BED, T.CABINET, T.SPROUT, T.PLOT,
    T.WBOX, T.MEDBOX, T.MATBOX, T.CAR, T.CARWRECK, T.BARRICADE, T.TRASHBIN, T.CARDBOX,
    T.HYDRANT, T.NEWSSTAND, T.TIRES,
]);
const NAME = v => ({ [T.GROUND]: '地', [T.FLOOR]: '板', [T.TREE]: '树', [T.WALL]: '墙', [T.DOOR]: '门', [T.RUBBLE]: '石', [T.WATER]: '水', [T.BOX]: '箱', [T.HERB]: '草', [T.BED]: '床', [T.FLOWER]: '葵', [T.CABINET]: '柜', [T.SPROUT]: '芽', [T.PLOT]: '盆', [T.CROP]: '禾', [T.WEED]: '艹', [T.WBOX]: '武', [T.MEDBOX]: '医', [T.MATBOX]: '材', [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.CAR]: '车', [T.CARWRECK]: '骸', [T.BARRICADE]: '栏', [T.TRASHBIN]: '桶', [T.CARDBOX]: '盒', [T.HYDRANT]: '栓', [T.NEWSSTAND]: '亭', [T.TIRES]: '胎' }[v] ?? '?');

let allPass = true;
for (const seed of seeds) {
    const C = 24;   // 48×48 区块（抽样验证，够用）
    const sv = { world: { seed, chunks: new Map() }, mods: { tiles: {} } };
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            sv.world.chunks.set(cx + ',' + cy, { tiles: t });
    }
    const L = -C * CHUNK, H = C * CHUNK;

    // 收集"骑人行道的非建筑物体格"样本
    const samples = [];
    outer:
    for (let gy = L; gy < H; gy++) {
        for (let gx = L; gx < H; gx++) {
            if (samples.length >= 300) break outer;
            const v = getTile(sv, gx, gy);
            if (!OBJECTS.has(v)) continue;
            if (!plannedSidewalkAt(seed, gx, gy)) continue;
            if (arterialClassAt(seed, gx, gy) === 'road') continue;
            samples.push({ gx, gy, obj: v });
        }
    }

    let restoredSW = 0, restoredRoad = 0, protectedRetain = 0, notRestored = 0;
    const bad = [];
    for (const s of samples) {
        // 模拟玩家清理物体：把该格写成 GROUND（非建造改动）
        sv.mods.tiles[s.gx + ',' + s.gy] = { t: T.GROUND };
        const after = getTile(sv, s.gx, s.gy);
        if (after === T.SIDEWALK) restoredSW++;
        else if (after === T.ROAD) restoredRoad++;
        else if (SIDEWALK_OK.has(after)) protectedRetain++;   // 城市规划保护层保留合法叠加物（设计）
        else {
            notRestored++;
            if (bad.length < 6) bad.push(`(${s.gx},${s.gy}) ${NAME(s.obj)}→${NAME(after)}`);
        }
    }
    const ok = notRestored === 0;
    if (!ok) allPass = false;
    console.log(`seed ${seed}: 采样${samples.length}格 恢复人行道=${restoredSW} 恢复路=${restoredRoad} 保护层保留叠加物=${protectedRetain} 未恢复=${notRestored}  ${ok ? '✅' : '❌'}`);
    if (bad.length) console.log('  ⚠️ ' + bad.join(' | '));
    if (globalThis.gc) globalThis.gc();
}
console.log(`\n${allPass ? '✅ 全部通过：物体被清理后下层人行道/路面完整恢复（或由规划保护层保留合法叠加物），物体确为纯上层叠加' : '❌ 存在下层被侵占的情况'}`);
process.exit(allPass ? 0 : 1);
