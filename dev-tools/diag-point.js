// ============================================================
// 精确点诊断：给定坐标打印其 7x7 邻域 + 规划层信息
// 用法：node dev-tools/diag-point.js <seed> <gx> <gy>
// ============================================================
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, arterialInfoAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';

const seed = Number(process.argv[2]) || 20260802;
const gx0 = Number(process.argv[3]), gy0 = Number(process.argv[4]);
if (isNaN(gx0) || isNaN(gy0)) { console.log('用法: node dev-tools/diag-point.js <seed> <gx> <gy>'); process.exit(1); }

const tiles = new Map();
for (let cy = Math.floor((gy0 - 6) / CHUNK); cy <= Math.floor((gy0 + 6) / CHUNK); cy++)
for (let cx = Math.floor((gx0 - 6) / CHUNK); cx <= Math.floor((gx0 + 6) / CHUNK); cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
const name = v => ({
    [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树',
    [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.CARWRECK]: '残', [T.GROUND]: '·',
}[v] ?? '?');

const ch = v => (v === T.GROUND || v === T.WEED) ? '·' : name(v);

console.log(`==== seed ${seed}  中心 (${gx0},${gy0})  区块(${Math.floor(gx0/CHUNK)},${Math.floor(gy0/CHUNK)}) ${districtAt(seed, Math.floor(gx0/CHUNK), Math.floor(gy0/CHUNK))} BLOCK=${blockAt(seed, Math.floor(gx0/CHUNK), Math.floor(gy0/CHUNK))}`);
console.log('左上角: (x-' + 3 + ', y-' + 3 + ')\n');

for (let dy = -3; dy <= 3; dy++) {
    let row = '';
    for (let dx = -3; dx <= 3; dx++) {
        const gx = gx0 + dx, gy = gy0 + dy;
        const v = tileAt(gx, gy);
        row += ch(v);
    }
    console.log(row);
}
console.log('\n-- 中心格规划信息 --');
const info = arterialInfoAt(seed, gx0, gy0);
console.log('中心格: 实际=' + name(tileAt(gx0, gy0)) + ' 保留路带=' + gridRoadKept(seed, gx0, gy0) + ' 规划人行道=' + plannedSidewalkAt(seed, gx0, gy0) + ' 主干道=' + info.cls + ' (axis=' + info.axis + ' line=' + info.line + ')');
