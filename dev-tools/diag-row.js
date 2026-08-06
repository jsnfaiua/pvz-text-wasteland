import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialInfoAt, blockAt, districtAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const tiles = new Map();
for (let cy = -64; cy <= 63; cy++) for (let cx = -64; cx <= 63; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
const name = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.GROUND]: '·', [T.WEED]: '杂' }[v] ?? '?');
const gy = -606, BL = blockAt(seed, Math.floor(589 / CHUNK), Math.floor(gy / CHUNK));
console.log('BLOCK=' + BL + '  行 y=' + gy + '  (x=586..595)');
console.log('x    实际  保留路  规划人  rx  ry  bandX bandY');
for (let gx = 586; gx <= 595; gx++) {
    const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
    const bandX = rx < 4 ? 'road' : ((rx === 4 || rx === BL - 1) ? 'walk' : ((rx === 6 || rx === BL - 3) ? 'tree' : 'in'));
    const bandY = ry < 4 ? 'road' : ((ry === 4 || ry === BL - 1) ? 'walk' : ((ry === 6 || ry === BL - 3) ? 'tree' : 'in'));
    console.log(gx + '    ' + name(tileAt(gx, gy)) + '     ' + (gridRoadKept(seed, gx, gy) ? 1 : 0) + '       ' + (plannedSidewalkAt(seed, gx, gy) ? 1 : 0) + '    ' + String(rx).padStart(2) + '  ' + String(ry).padStart(2) + '   ' + bandX + '/' + bandY);
}
