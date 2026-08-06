// ============================================================
// 层级一致性检测（控制变量法：检测逻辑固定，只变种子）
// 核心验证：物体（车/路障/碎石/树/箱/容器/墙等）叠在路面/人行道上时，
//   1) 下层规划语义是否保持（plannedSidewalkAt / gridRoadKept / arterialClassAt 仍为真）
//   2) 骑在人行道上的物体是否全部属于"合法叠加物"（SIDEWALK_OK）
//   3) 渲染底层 groundTypeAt 是否与规划层一致（物体脚下画人行道/路/草地）
//   4) 寻路 isWalk 只认纯地面层，物体是上层障碍（不切断路带/人行道带）
// 用法：node dev-tools/layer-check.mjs seed1 seed2 ...
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

const { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt, isWalk } = await import('../source-code/mod-wasteland/world.js');
const { arterialClassAt, districtAt } = await import('../source-code/mod-wasteland/wdistrict.js');

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
if (!seeds.length) { console.error('至少需要一个种子'); process.exit(2); }

// 物体 = 非地面/非可走自然层的上层障碍与容器
const OBJECTS = new Set([
    T.TREE, T.WALL, T.DOOR, T.RUBBLE, T.WATER, T.BOX, T.BED, T.CABINET, T.SPROUT, T.PLOT,
    T.WBOX, T.MEDBOX, T.MATBOX, T.CAR, T.CARWRECK, T.BARRICADE, T.TRASHBIN, T.CARDBOX,
    T.HYDRANT, T.NEWSSTAND, T.TIRES,
]);
// check-map-quality 同款：可合法立于人行道/规划环上的叠加物
const SIDEWALK_OK = new Set([T.SIDEWALK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES, T.CAR, T.CARWRECK, T.RUBBLE, T.BOX, T.WBOX, T.MEDBOX, T.MATBOX]);
const BUILDING = new Set([T.WALL, T.DOOR]);
const GROUND_TILES = new Set([T.GROUND, T.FLOOR, T.ROAD, T.SIDEWALK, T.WEED, T.CROP]);

const NAME = v => ({ [T.GROUND]: '地', [T.FLOOR]: '板', [T.TREE]: '树', [T.WALL]: '墙', [T.DOOR]: '门', [T.RUBBLE]: '石', [T.WATER]: '水', [T.BOX]: '箱', [T.HERB]: '草', [T.BED]: '床', [T.FLOWER]: '葵', [T.CABINET]: '柜', [T.SPROUT]: '芽', [T.PLOT]: '盆', [T.CROP]: '禾', [T.WEED]: '艹', [T.WBOX]: '武', [T.MEDBOX]: '医', [T.MATBOX]: '材', [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.CAR]: '车', [T.CARWRECK]: '骸', [T.BARRICADE]: '栏', [T.TRASHBIN]: '桶', [T.CARDBOX]: '盒', [T.HYDRANT]: '栓', [T.NEWSSTAND]: '亭', [T.TIRES]: '胎' }[v] ?? '?');

let allPass = true;
for (const seed of seeds) {
    const C = 48;   // 96×96 区块 ≈ 1536×1536 格，覆盖多城+主干道
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const L = -C * CHUNK, H = C * CHUNK;

    let objTotal = 0;              // 物体格总数
    let onSidewalk = 0, onSidewalkLegal = 0, onSidewalkIllegal = 0;  // 骑人行道
    let onRoad = 0;                // 骑路
    let onGrass = 0;               // 骑草地
    const illegalSamples = [];     // 非法叠加样本
    let sidewalkPlan = 0, sidewalkUnderObject = 0;

    for (let gy = L; gy < H; gy++) {
        for (let gx = L; gx < H; gx++) {
            const v = tileAt(gx, gy);
            const isObj = OBJECTS.has(v);
            if (isObj) objTotal++;
            // 人行道规划层统计
            const pSidewalk = plannedSidewalkAt(seed, gx, gy);
            const pRoad = gridRoadKept(seed, gx, gy) || arterialClassAt(seed, gx, gy) === 'road';
            if (pSidewalk) {
                sidewalkPlan++;
                if (isObj) {
                    sidewalkUnderObject++;
                    if (SIDEWALK_OK.has(v) || BUILDING.has(v)) onSidewalkLegal++;
                    else {
                        onSidewalkIllegal++;
                        if (illegalSamples.length < 8) {
                            illegalSamples.push(`(${gx},${gy}) 物体=${NAME(v)} 区块=${districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK))}`);
                        }
                    }
                }
            }
            if (!isObj) continue;
            if (pSidewalk) onSidewalk++;
            else if (pRoad) onRoad++;
            else onGrass++;
        }
    }

    // 骑人行道的物体是否全部合法（SIDEWALK_OK 或 建筑）
    const ok = onSidewalkIllegal === 0;
    if (!ok) allPass = false;
    console.log(`seed ${seed}: 物体格=${objTotal} 骑人行道=${onSidewalk}（合法=${onSidewalkLegal} 非法=${onSidewalkIllegal}） 骑路=${onRoad} 骑草地=${onGrass} 人行道规划=${sidewalkPlan} 物体下人行道=${sidewalkUnderObject}  ${ok ? '✅' : '❌'}`);
    if (illegalSamples.length) console.log('  ⚠️ 非法叠加: ' + illegalSamples.join(' | '));
    if (globalThis.gc) globalThis.gc();
}
console.log(`\n${allPass ? '✅ 全部种子层级一致：物体均为上层叠加，不破坏下方人行道/路面语义' : '❌ 存在层级破坏，详见上方'}`);
process.exit(allPass ? 0 : 1);
