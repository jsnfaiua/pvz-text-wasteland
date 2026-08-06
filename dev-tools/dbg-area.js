import { genChunkTiles, T, CHUNK } from '../source-code/mod-wasteland/world.js';
import { arterialInfoAt, districtAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const x0 = -1030, y0 = -1025, W = 44, H = 30;
const tiles = new Map();
for (let cy = Math.floor(y0/16); cy <= Math.floor((y0+H-1)/16); cy++)
for (let cx = Math.floor(x0/16); cx <= Math.floor((x0+W-1)/16); cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++)
        tiles.set((cx*16+lx)+','+(cy*16+ly), t[ly*16+lx]);
}
const ch = (gx, gy) => {
    const v = tiles.get(gx+','+gy);
    const a = arterialInfoAt(seed, gx, gy);
    let c = v === T.ROAD ? '路' : v === T.SIDEWALK ? '人' : v === T.WALL ? '墙' : v === T.DOOR ? '门'
        : v === T.TREE ? '树' : v === T.RUBBLE ? '石' : (v === T.CAR || v === T.CARWRECK) ? '车'
        : v === T.BARRICADE ? '栏' : v === T.BOX || v === T.WBOX || v === T.MEDBOX || v === T.MATBOX ? '箱' : '·';
    if (a.cls === 'road') return c + 'R';
    if (a.cls === 'sidewalk') return c + 'S';
    return c;
};
console.log('区(0,0)=', districtAt(seed, 0, 0));
for (let y = y0; y < y0 + H; y++) {
    let row = '';
    for (let x = x0; x < x0 + W; x++) row += ch(x, y);
    console.log(row);
}
