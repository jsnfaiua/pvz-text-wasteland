// ============================================================
// 地形诊断：可视化超宽路 / 建筑间地板感区域的实际铺地图
// 用法：node dev-tools/diag-terrain.js <seed> <gx> <gy> <R>
// ============================================================
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, arterialInfoAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';

const seed = Number(process.argv[2]) || 20260802;
const cx0 = Number(process.argv[3]) || -16;
const cy0 = Number(process.argv[4]) || -32;
const R = Number(process.argv[5]) || 48;

const tiles = new Map();
for (let cy = Math.floor(cy0 / CHUNK) - 1; cy <= Math.floor((cy0 + R) / CHUNK) + 1; cy++)
for (let cx = Math.floor(cx0 / CHUNK) - 1; cx <= Math.floor((cx0 + R) / CHUNK) + 1; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);

const ch = v => {
    if (v === T.ROAD) return '路';
    if (v === T.SIDEWALK) return '人';
    if (v === T.WALL) return '墙';
    if (v === T.DOOR) return '门';
    if (v === T.TREE) return '树';
    if (v === T.CAR) return '车';
    if (v === T.BARRICADE) return '栏';
    if (v === T.RUBBLE) return '石';
    if (v === T.CARWRECK) return '残';
    return '·';
};

console.log(`==== seed ${seed}  区域 (${cx0},${cy0}) ~ (${cx0 + R - 1},${cy0 + R - 1})  ====`);
console.log('图例: 路=公路 人=人行道 墙/门=建筑 树/车/栏/石/残=障碍物 ·=草地');
console.log('行列注: A=主干道路面 a=主干道人行道带 S=规划人行道 G=保留路带\n');

for (let gy = cy0; gy < cy0 + R; gy++) {
    let row = '';
    for (let gx = cx0; gx < cx0 + R; gx++) {
        const v = tileAt(gx, gy);
        row += ch(v);
    }
    // 附加标注：主干道信息
    console.log(row);
}

// 统计信息
let road = 0, walk = 0, plan = 0, gap = 0;
for (let gy = cy0; gy < cy0 + R; gy++)
for (let gx = cx0; gx < cx0 + R; gx++) {
    const v = tileAt(gx, gy);
    if (v === T.ROAD) road++;
    if (v === T.SIDEWALK) walk++;
    if (plannedSidewalkAt(seed, gx, gy)) { plan++; if (v !== T.SIDEWALK && v !== T.WALL && v !== T.DOOR) gap++; }
}
console.log(`\n统计: 路面格=${road} 人行道格=${walk} 规划人行道=${plan} 缺失=${gap}`);
console.log(`区块: ${districtAt(seed, Math.floor(cx0 / CHUNK), Math.floor(cy0 / CHUNK))}  BLOCK=${blockAt(seed, Math.floor(cx0 / CHUNK), Math.floor(cy0 / CHUNK))}`);
