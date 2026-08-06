// ============================================================
// 随机种子压力测试：对 N 个随机种子跑核心地形质量检查
//   A. 主干道带真断连（应 0，废墟碎石除外）
//   B. wild 环带被建筑占（应 0，合法叠加物除外）
//   C. 人行道规划缺失（应 0）
//   D. 超宽路（应 0）
//   E. 连通分量级死路（应 0）
// 用法：node --max-old-space-size=3072 --expose-gc dev-tools/stress-test.mjs [种子数] [C]
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

const { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } = await import('../source-code/mod-wasteland/world.js');
const { arterialInfoAt, districtAt, blockAt } = await import('../source-code/mod-wasteland/wdistrict.js');

const COUNT = Number(process.argv[2]) || 20;
const C = Number(process.argv[3]) || 32;

// 生成随机种子（确定性伪随机，可复现）
let rngState = 0x9E3779B9;
function rng() {
    rngState = Math.imul(rngState ^ (rngState >>> 15), 2246822519);
    rngState = Math.imul(rngState ^ (rngState >>> 13), 3266489917);
    rngState ^= rngState >>> 16;
    return (rngState >>> 0) / 4294967296;
}
const seeds = [];
for (let i = 0; i < COUNT; i++) seeds.push((rng() * 0x7fffffff) | 0);

const SIDEWALK_OK = new Set([T.SIDEWALK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES, T.CAR, T.CARWRECK, T.RUBBLE, T.BOX, T.WBOX, T.MEDBOX, T.MATBOX]);
const BUILDING = new Set([T.WALL, T.DOOR]);
const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE]);

let totalFail = 0;
for (const seed of seeds) {
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const L = -C * CHUNK, H = C * CHUNK;

    // A. 主干道带真断连
    let bandGap = 0;
    for (let gy = L + 1; gy < H - 1; gy++) for (let gx = L + 1; gx < H - 1; gx++) {
        const info = arterialInfoAt(seed, gx, gy);
        if (info.cls !== 'road') continue;
        const v = tileAt(gx, gy);
        if (v === T.ROAD || v === T.CAR || v === T.BARRICADE || v === T.CARWRECK) continue;
        if (v === T.RUBBLE) continue;   // 废墟碎石合法
        bandGap++;
    }

    // B. wild 环带被建筑占
    let wildSwBad = 0;
    for (let gy = L + 1; gy < H - 1; gy++) for (let gx = L + 1; gx < H - 1; gx++) {
        const info = arterialInfoAt(seed, gx, gy);
        if (info.cls !== 'sidewalk') continue;
        if (districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)) !== 'wild') continue;
        const v = tileAt(gx, gy);
        if (SIDEWALK_OK.has(v) || BUILDING.has(v)) continue;
        wildSwBad++;
    }

    // C. 人行道规划缺失
    let swPlan = 0, swGap = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        if (!plannedSidewalkAt(seed, gx, gy)) continue;
        swPlan++;
        const v = tileAt(gx, gy);
        if (BUILDING.has(v)) continue;
        if (!SIDEWALK_OK.has(v)) swGap++;
    }

    // D. 超宽路
    const roadOnly = (gx, gy) => tileAt(gx, gy) === T.ROAD;
    const run = (gx, gy, dx, dy, cap) => {
        let n = 0;
        while (n < cap && roadOnly(gx - dx * (n + 1), gy - dy * (n + 1))) n++;
        return n;
    };
    const isIntersection = (gx, gy) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            let h = 0, v = 0;
            for (let i = -2; i <= 2; i++) {
                if (roadOnly(gx + dx + i, gy + dy)) h++;
                if (roadOnly(gx + dx, gy + dy + i)) v++;
            }
            if (h >= 3 && v >= 3) return true;
        }
        return false;
    };
    let overWide = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        if (!roadOnly(gx, gy)) continue;
        if (districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)) === 'ruins') continue;
        const dL = run(gx, gy, 1, 0, 64), dR = run(gx, gy, -1, 0, 64);
        const dU = run(gx, gy, 0, 1, 64), dD = run(gx, gy, 0, -1, 64);
        const hBand = dL + dR + 1, vBand = dU + dD + 1;
        if (hBand >= 8 && vBand >= 8) continue;
        if (Math.min(hBand, vBand) > 4 && !isIntersection(gx, gy)) overWide++;
    }

    // E. 连通分量死路（简化：deg=1 末端且非出城/废墟）
    let deadEnds = 0;
    const isRoadSurface = (gx, gy) => {
        const v = tileAt(gx, gy);
        if (v === undefined) return false;
        if (ROAD_LIKE.has(v)) return true;
        if (v === T.RUBBLE || v === T.TREE) {
            if (gridRoadKept(seed, gx, gy)) return true;
            if (arterialInfoAt(seed, gx, gy).cls === 'road') return true;
        }
        return false;
    };
    for (let gy = L + 2; gy < H - 3; gy++) for (let gx = L + 2; gx < H - 3; gx++) {
        if (!isRoadSurface(gx, gy)) continue;
        const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        let deg = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoadSurface(gx + dx, gy + dy)) deg++;
        if (deg !== 1) continue;
        let touchesOutside = false;
        for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1 && !touchesOutside; dx++) {
            const nd = districtAt(seed, Math.floor((gx + dx) / CHUNK), Math.floor((gy + dy) / CHUNK));
            if (nd === 'wild') touchesOutside = true;
        }
        if (touchesOutside) continue;
        if (d === 'ruins') continue;
        deadEnds++;
    }

    const ok = bandGap === 0 && wildSwBad === 0 && swGap === 0 && overWide === 0 && deadEnds === 0;
    if (!ok) totalFail++;
    console.log(`seed ${seed}: 带断连=${bandGap} wild环=${wildSwBad} 人行道缺=${swGap}/${swPlan} 超宽=${overWide} 死路=${deadEnds}  ${ok ? '✅' : '❌'}`);
    tiles.clear();
    if (globalThis.gc) globalThis.gc();
}
console.log(`\n随机压力测试完成：${seeds.length} 个种子，失败 ${totalFail} 个`);
console.log(`种子列表: ${seeds.join(' ')}`);
process.exit(totalFail ? 1 : 0);
