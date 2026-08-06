// ============================================================
// 主干道带完整性多种子检测：
// 1) 主干道带内"真断连"（非路且非碎石叠加）= 应 0
// 2) 主干道带内碎石（废墟合法破损）= 允许
// 3) wild 主干道环带被建筑/墙占 = 应 0（小屋已避让）
// 用法：node --max-old-space-size=3072 --expose-gc dev-tools/artery-band-check.mjs seed...
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
const { arterialInfoAt, districtAt } = await import('../source-code/mod-wasteland/wdistrict.js');

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
if (!seeds.length) seeds.push(20260802, 12345, 987654321, 777, 424242);
const NAME = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.GROUND]: '·', [T.CARWRECK]: '骸', [T.WEED]: '艹', [T.BOX]: '箱', [T.WATER]: '水', [T.HERB]: '草', [T.FLOOR]: '板' }[v] ?? '?');

let allPass = true;
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

    let bandGap = 0, rubble = 0, gapSamples = [];
    let wildSwBad = 0, wildSwSamples = [];
    for (let gy = L + 2; gy < H - 2; gy++) {
        for (let gx = L + 2; gx < H - 2; gx++) {
            const info = arterialInfoAt(seed, gx, gy);
            if (!info.cls) continue;
            const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
            const v = tileAt(gx, gy);
            if (info.cls === 'road') {
                if (v === T.ROAD || v === T.CAR || v === T.BARRICADE || v === T.CARWRECK) continue;
                if (v === T.RUBBLE && d === 'ruins') { rubble++; continue; }   // 废墟破损合法
                bandGap++;
                if (gapSamples.length < 5) gapSamples.push('(' + gx + ',' + gy + ')=' + NAME(v) + ' 区=' + d + ' 带=' + info.axis + ':' + info.line);
            } else if (info.cls === 'sidewalk' && d === 'wild') {
                // wild 环带合法叠加物：街道容器 + 车/残骸 + 资源箱 + 碎石（与 SIDEWALK_OK 一致）
                if (v === T.SIDEWALK || v === T.TRASHBIN || v === T.CARDBOX || v === T.HYDRANT || v === T.NEWSSTAND || v === T.TIRES || v === T.CAR || v === T.CARWRECK || v === T.BOX || v === T.WBOX || v === T.MEDBOX || v === T.MATBOX || v === T.RUBBLE) continue;
                wildSwBad++;
                if (wildSwSamples.length < 5) wildSwSamples.push('(' + gx + ',' + gy + ')=' + NAME(v) + ' 带=' + info.axis + ':' + info.line);
            }
        }
    }
    const ok = bandGap === 0 && wildSwBad === 0;
    if (!ok) allPass = false;
    console.log('seed ' + seed + ': 主干道带真断连=' + bandGap + ' 废墟碎石=' + rubble + ' wild环带被占=' + wildSwBad + '  ' + (ok ? '✅' : '❌'));
    if (gapSamples.length) console.log('  ⚠️ 断连: ' + gapSamples.join(' | '));
    if (wildSwSamples.length) console.log('  ⚠️ wild环带: ' + wildSwSamples.join(' | '));
    if (globalThis.gc) globalThis.gc();
}
console.log('\n' + (allPass ? '✅ 全部种子主干道带连续、wild 环带完整' : '❌ 存在断连/环带缺失'));
process.exit(allPass ? 0 : 1);
