import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialInfoAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const tiles = new Map();
for (let cy = -64; cy <= 63; cy++) for (let cx = -64; cx <= 63; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
const name = v => ({ [T.ROAD]: '路', [T.SIDEWALK]: '人', [T.WALL]: '墙', [T.DOOR]: '门', [T.TREE]: '树', [T.CAR]: '车', [T.BARRICADE]: '栏', [T.RUBBLE]: '石', [T.GROUND]: '·', [T.WEED]: '杂' }[v] ?? '?');
const gx = 990;
console.log('x=' + gx + ' 纵向切片 (y=-1016..-994):');
for (let gy = -1016; gy <= -994; gy++) {
    const v = tileAt(gx, gy);
    const a = arterialInfoAt(seed, gx, gy);
    console.log('y=' + gy + '  ' + name(v) + '  保留路=' + (gridRoadKept(seed, gx, gy) ? 1 : 0) + ' 规划人=' + (plannedSidewalkAt(seed, gx, gy) ? 1 : 0) + ' 动脉=' + (a.cls ?? '-') + '(axis=' + (a.axis ?? '-') + ' line=' + (a.line ?? '-') + ')');
}
