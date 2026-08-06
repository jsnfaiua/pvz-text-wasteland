// 孤儿人行道深入诊断：检查具体格的规划判定与邻格状态
import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, districtAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const gx = 151, gy = -1014;
const tiles = new Map();
for (let cy = Math.floor((gy - 8) / CHUNK); cy <= Math.floor((gy + 8) / CHUNK); cy++)
for (let cx = Math.floor((gx - 8) / CHUNK); cx <= Math.floor((gx + 8) / CHUNK); cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (x, y) => tiles.get(x + ',' + y);
const name = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.GROUND]: '·', [T.WEED]: '杂' }[v] ?? '?');
const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
const BL = blockAt(seed, cx, cy);
console.log(`seed ${seed} 中心(${gx},${gy}) 区块(${cx},${cy}) ${districtAt(seed, cx, cy)} BLOCK=${BL}`);
console.log('中心格: 实际=' + name(tileAt(gx, gy)) + ' 保留路=' + gridRoadKept(seed, gx, gy) + ' 规划人行道=' + plannedSidewalkAt(seed, gx, gy) + ' 动脉=' + (arterialClassAt(seed, gx, gy) ?? '-'));
console.log('\n5x5 邻域 (左上=(' + (gx - 2) + ',' + (gy - 2) + ')):');
for (let dy = -2; dy <= 2; dy++) {
    let row = '', meta = '';
    for (let dx = -2; dx <= 2; dx++) {
        const x = gx + dx, y = gy + dy;
        const v = tileAt(x, y);
        row += name(v);
        meta += gridRoadKept(seed, x, y) ? 'R' : (plannedSidewalkAt(seed, x, y) ? 'P' : '-');
    }
    console.log(row + '   ' + meta);
}
console.log('\n中心格 band 位置: rx=' + (((gx % BL) + BL) % BL) + ' ry=' + (((gy % BL) + BL) % BL));
console.log('8 邻格中保留路数量:');
let n = 0;
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    if (gridRoadKept(seed, gx + dx, gy + dy)) n++;
}
console.log('  gridRoadKept 邻格=' + n);
n = 0;
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    if (arterialClassAt(seed, gx + dx, gy + dy) === 'road') n++;
}
console.log('  动脉road邻格=' + n);
