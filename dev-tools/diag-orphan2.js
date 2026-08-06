// 深挖孤儿人行道：复现 genChunkTiles 内部判定
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const gx = 151, gy = -1014;
const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
const BL = blockAt(seed, cx, cy);
const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
console.log(`区块(${cx},${cy}) ${districtAt(seed, cx, cy)} BLOCK=${BL} 格(${gx},${gy}) rx=${rx} ry=${ry}`);

// 复刻 genChunkTiles 中的 band 判定
const bandX = rx < 4 ? 'road' : ((rx === 4 || rx === BL - 1) ? 'walk' : ((rx === 6 || rx === BL - 3) ? 'tree' : 'in'));
const bandY = ry < 4 ? 'road' : ((ry === 4 || ry === BL - 1) ? 'walk' : ((ry === 6 || ry === BL - 3) ? 'tree' : 'in'));
console.log(`bandX=${bandX} bandY=${bandY} onRoad=${bandX==='road'||bandY==='road'} onSidewalk=${bandX==='walk'||bandY==='walk'}`);

// hasAdjacentRoad 复刻
let adj = false;
for (let dy = -1; dy <= 1 && !adj; dy++) for (let dx = -1; dx <= 1 && !adj; dx++) {
    if (!dx && !dy) continue;
    const nx = gx + dx, ny = gy + dy;
    if (gridRoadKept(seed, nx, ny)) { adj = true; console.log(`  邻格(${nx},${ny}) gridRoadKept=TRUE`); }
    if (arterialClassAt(seed, nx, ny) === 'road') { adj = true; console.log(`  邻格(${nx},${ny}) arterial=road`); }
}
console.log(`hasAdjacentRoad(中心) = ${adj}`);

// 8 邻格明细
console.log('\n8 邻格明细:');
for (let dy = -1; dy <= 1; dy++) {
    let row = '';
    for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx, y = gy + dy;
        const gk = gridRoadKept(seed, x, y);
        const ar = arterialClassAt(seed, x, y) ?? '-';
        row += (x === gx && y === gy ? '[*]' : `(${gk ? 'R' : '-'}${ar === 'road' ? 'A' : ar === 'sidewalk' ? 's' : '-'})`);
    }
    console.log(row);
}

// 该列 y=-1024..-1009 的 walk 带状态
console.log('\n列 x=151 (rx=4 walk带) y=-1025..-1008:');
const tiles = new Map();
for (let ccy = -65; ccy <= -62; ccy++) for (let ccx = 8; ccx <= 10; ccx++) {
    const t = genChunkTiles(seed, ccx, ccy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((ccx * CHUNK + lx) + ',' + (ccy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const nm = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.GROUND]: '·', [T.WEED]: '杂' }[v] ?? '?');
for (let y = -1025; y <= -1008; y++) {
    const v = tiles.get(gx + ',' + y);
    console.log(`  y=${y} ${nm(v)}  保留路=${gridRoadKept(seed, gx, y) ? 1 : 0} 规划人=${plannedSidewalkAt(seed, gx, y) ? 1 : 0}`);
}
