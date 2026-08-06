import { genChunkTiles, T, CHUNK, gridRoadKept } from '../source-code/mod-wasteland/world.js';
import { arterialInfoAt, blockAt, districtAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const gx = -965, gy = -1008;
const tiles = new Map();
for (let cy = -65; cy <= -60; cy++) for (let cx = -62; cx <= -59; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++)
        tiles.set((cx*16+lx)+','+(cy*16+ly), t[ly*16+lx]);
}
const surf = (x, y) => {
    const v = tiles.get(x+','+y);
    if (v === T.ROAD || v === T.CAR || v === T.BARRICADE || v === T.CARWRECK) return true;
    if (v === T.RUBBLE || v === T.TREE) return gridRoadKept(seed, x, y) || arterialInfoAt(seed, x, y).cls === 'road';
    return false;
};
console.log('tile=', tiles.get(gx+','+gy), 'district=', districtAt(seed, Math.floor(gx/16), Math.floor(gy/16)), 'BL=', blockAt(seed, Math.floor(gx/16), Math.floor(gy/16)));
console.log('arterial=', JSON.stringify(arterialInfoAt(seed, gx, gy)));
for (let dy = -4; dy <= 4; dy++) {
    let row = '';
    for (let dx = -4; dx <= 4; dx++) {
        const v = tiles.get((gx+dx)+','+(gy+dy));
        const s = surf(gx+dx, gy+dy);
        row += (s ? '#' : '·') + (v === T.RUBBLE ? '石' : v === T.TREE ? '树' : v === T.SIDEWALK ? '人' : v === T.ROAD ? '路' : v === T.GROUND ? '草' : v === T.WALL ? '墙' : v === T.DOOR ? '门' : v === T.BARRICADE ? '栏' : v === T.CAR || v === T.CARWRECK ? '车' : '·') + ' ';
    }
    console.log(row);
}
