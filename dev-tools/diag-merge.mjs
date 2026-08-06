const _lsStore = {};
globalThis.localStorage = { getItem: k => _lsStore[k] ?? null, setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
globalThis.window = { localStorage: globalThis.localStorage, AudioContext: function () { return {}; }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
globalThis.document = { createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {} }), addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, getElementsByClassName: () => [], body: {}, documentElement: {}, createTextNode: () => ({}) };
try { globalThis.navigator = { userAgent: 'node' }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {};
const { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } = await import('../source-code/mod-wasteland/world.js');
const { arterialClassAt, arterialInfoAt, districtAt, blockAt } = await import('../source-code/mod-wasteland/wdistrict.js');
const seed = 12345;
const tiles = new Map();
for (let cy = 8; cy <= 10; cy++) for (let cx = 45; cx <= 49; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
const name = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.GROUND]: '·', [T.CARWRECK]: '骸', [T.WEED]: '艹', [T.BOX]: '箱', [T.WATER]: '水' }[v] ?? '?');
const BL = blockAt(seed, 47, 9);
console.log('y=152 行 x=750..766 详细:');
for (let gx = 750; gx <= 766; gx++) {
    const info = arterialInfoAt(seed, gx, 152);
    const rx = ((gx % BL) + BL) % BL;
    console.log('x=' + gx + ' 实际=' + name(tileAt(gx, 152)) + ' 动脉=' + (info.cls ?? '-') + info.axis + ':' + info.line + ' 保留路=' + (gridRoadKept(seed, gx, 152) ? 1 : 0) + ' 规划人=' + (plannedSidewalkAt(seed, gx, 152) ? 1 : 0) + ' rx=' + rx + ' BL=' + BL);
}
