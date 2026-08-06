// ============================================================
// 荒野/郊区主干道带完整性诊断：
// 按区块类型分类统计主干道带（road 4格 + 两侧环各1格）内
// 1) 路带内非 ROAD 格（断连/被植被覆盖）
// 2) 人行道环内非 SIDEWALK 格（人行道缺失）
// 用法：node dev-tools/diag-wild-artery.mjs seed...
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

const NAME = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.GROUND]: '·', [T.CARWRECK]: '骸', [T.WEED]: '艹', [T.BOX]: '箱', [T.WATER]: '水', [T.TRASHBIN]: '桶', [T.CARDBOX]: '盒', [T.HYDRANT]: '栓', [T.NEWSSTAND]: '亭', [T.TIRES]: '胎', [T.WBOX]: '武', [T.MEDBOX]: '医', [T.MATBOX]: '材', [T.HERB]: '草', [T.FLOWER]: '葵', [T.CROP]: '禾', [T.SPROUT]: '芽', [T.PLOT]: '盆', [T.BED]: '床', [T.CABINET]: '柜' }[v] ?? '?');

for (const seed of seeds) {
    const C = 56;
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const L = -C * CHUNK, H = C * CHUNK;

    // 统计：road 带内非路格 / sidewalk 环内非人行道格，按区块类型分类
    const roadBand = { urban: { total: 0, bad: 0, samples: [] }, suburb: { total: 0, bad: 0, samples: [] }, wild: { total: 0, bad: 0, samples: [] }, ruins: { total: 0, bad: 0, samples: [] } };
    const swRing = { urban: { total: 0, bad: 0, samples: [] }, suburb: { total: 0, bad: 0, samples: [] }, wild: { total: 0, bad: 0, samples: [] }, ruins: { total: 0, bad: 0, samples: [] } };

    for (let gy = L + 1; gy < H - 1; gy++) {
        for (let gx = L + 1; gx < H - 1; gx++) {
            const info = arterialInfoAt(seed, gx, gy);
            if (!info.cls) continue;
            const d = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
            const bucket = roadBand[d] ? d : 'wild';
            const v = tileAt(gx, gy);
            if (info.cls === 'road') {
                roadBand[bucket].total++;
                // 路带格：期望是路（碎石/倒树/车/路障在废墟属合法叠加，但荒野应纯路）
                const ok = v === T.ROAD || v === T.CAR || v === T.BARRICADE || v === T.CARWRECK || v === T.RUBBLE;
                if (!ok) {
                    roadBand[bucket].bad++;
                    if (roadBand[bucket].samples.length < 5)
                        roadBand[bucket].samples.push(`(${gx},${gy}) 实际=${NAME(v)} 动脉=${info.axis}:${info.line}`);
                }
            } else if (info.cls === 'sidewalk') {
                swRing[bucket].total++;
                const ok = v === T.SIDEWALK || v === T.TRASHBIN || v === T.CARDBOX || v === T.HYDRANT || v === T.NEWSSTAND || v === T.TIRES || v === T.CAR || v === T.CARWRECK;
                if (!ok) {
                    swRing[bucket].bad++;
                    if (swRing[bucket].samples.length < 5)
                        swRing[bucket].samples.push(`(${gx},${gy}) 实际=${NAME(v)} 动脉=${info.axis}:${info.line}`);
                }
            }
        }
    }

    console.log(`\n=== seed ${seed} 主干道带完整性（C=${C} 区块）===`);
    for (const d of ['urban', 'suburb', 'wild', 'ruins']) {
        const rb = roadBand[d], sw = swRing[d];
        console.log(`[${d}] 路带 ${rb.total} 格 非路=${rb.bad}${rb.samples.length ? '  ' + rb.samples.join(' | ') : ''}`);
        console.log(`[${d}] 环带 ${sw.total} 格 非人行道=${sw.bad}${sw.samples.length ? '  ' + sw.samples.join(' | ') : ''}`);
    }
    if (globalThis.gc) globalThis.gc();
}
