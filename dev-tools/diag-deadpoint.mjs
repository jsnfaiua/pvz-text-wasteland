// 诊断连通分量死路点位：检查是否为"主干道带内植被"（路网连通）还是真断裂
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
const { arterialClassAt, districtAt } = await import('../source-code/mod-wasteland/wdistrict.js');

// 参数：seed gx gy [gx gy]...
const seed = Number(process.argv[2]);
const points = [];
for (let i = 3; i < process.argv.length; i += 2) points.push([Number(process.argv[i]), Number(process.argv[i + 1])]);

const C = 48;
const tiles = new Map();
for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
const NAME = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.GROUND]: '·', [T.CARWRECK]: '骸', [T.WEED]: '艹', [T.BOX]: '箱', [T.WATER]: '水', [T.TRASHBIN]: '桶', [T.CARDBOX]: '盒', [T.HYDRANT]: '栓', [T.NEWSSTAND]: '亭', [T.TIRES]: '胎', [T.WBOX]: '武', [T.MEDBOX]: '医', [T.MATBOX]: '材' }[v] ?? '?');

for (const [gx, gy] of points) {
    console.log(`\n=== seed ${seed} 点 (${gx},${gy}) 区块${districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK))} 动脉=${arterialClassAt(seed, gx, gy) ?? '-'} 保留路=${gridRoadKept(seed, gx, gy) ? 1 : 0} ===`);
    for (let dy = -3; dy <= 3; dy++) {
        let row = '';
        for (let dx = -3; dx <= 3; dx++) row += NAME(tileAt(gx + dx, gy + dy));
        console.log(row);
    }
    // 沿该点"唯一邻路方向"向前探 12 格，看是否连通
    let nx = gx, ny = gy, dir = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = tileAt(gx + dx, gy + dy);
        if (v === T.ROAD || v === T.CAR || v === T.BARRICADE || v === T.RUBBLE || v === T.TREE) { dir = [dx, dy]; break; }
    }
    if (dir) {
        let path = '从中心向' + (dir[0] ? (dir[0] > 0 ? '右' : '左') : (dir[1] > 0 ? '下' : '上')) + ': ';
        let cx = gx, cy = gy;
        for (let i = 0; i < 14; i++) {
            cx += dir[0]; cy += dir[1];
            const v = tileAt(cx, cy);
            const a = arterialClassAt(seed, cx, cy);
            path += NAME(v) + (a ? `(${a.slice(0, 1)})` : '') + ' ';
            if (v === undefined) break;
        }
        console.log(path);
    }
}
