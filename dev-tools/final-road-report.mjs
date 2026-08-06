// 马路死路最终权威报告：
// 1) 主干道折线连通性（修复 axis/line 错配后）
// 2) 主干道带内"非路格"统计（建筑/树骑带 = 视觉瑕疵但路网连通）
// 3) 人行道带完整性（规划层 vs 实际）
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
const { arterialClassAt } = await import('../source-code/mod-wasteland/wdistrict.js');
const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(20260802, 12345, 987654321, 777, 424242);
const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE]);

for (const seed of seeds) {
    const C = 40;
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const L = -C * CHUNK, H = C * CHUNK;

    // 主干道带内"非路格"统计
    let arterialCells = 0, bandNotRoad = 0; const bandSamples = [];
    for (let gy = L + 2; gy < H - 2; gy++) for (let gx = L + 2; gx < H - 2; gx++) {
        if (arterialClassAt(seed, gx, gy) !== 'road') continue;
        arterialCells++;
        const v = tileAt(gx, gy);
        if (ROAD_LIKE.has(v)) continue;
        bandNotRoad++;
        if (bandSamples.length < 6) bandSamples.push('(' + gx + ',' + gy + ')=' + (v === T.GROUND ? '草' : v === T.TREE ? '树' : v === T.WALL ? '墙' : String(v)));
    }

    // 人行道带完整性
    let swPlan = 0, swGap = 0;
    for (let gy = L; gy < H; gy++) for (let gx = L; gx < H; gx++) {
        if (!plannedSidewalkAt(seed, gx, gy)) continue;
        swPlan++;
        const v = tileAt(gx, gy);
        if (v !== T.SIDEWALK && v !== T.WALL && v !== T.DOOR) swGap++;
    }

    console.log('seed ' + seed + ':');
    console.log('  主干道带格=' + arterialCells + ' 带内非路格=' + bandNotRoad + (bandSamples.length ? '  ' + bandSamples.join(' | ') : ''));
    console.log('  人行道规划=' + swPlan + ' 缺失=' + swGap);
    console.log('');
}
