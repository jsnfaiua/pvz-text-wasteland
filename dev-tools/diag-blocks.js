import { genChunkTiles, T, CHUNK } from '../source-code/mod-wasteland/world.js';
import { blockAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
// 打印几个城区/郊区区块的 BLOCK，确认错落
for (let cy = -4; cy <= 4; cy++) {
    let row = '';
    for (let cx = -4; cx <= 4; cx++) row += String(blockAt(seed, cx, cy)).padStart(3);
    console.log(row);
}
console.log('--- 城区铺地图（路=路 人=人行道 墙=建筑 树/桶/盒=杂物） ---');
const x0 = -32, y0 = -48;
const tiles = new Map();
for (let cy = Math.floor(y0/CHUNK); cy <= Math.floor((y0+47)/CHUNK); cy++)
for (let cx = Math.floor(x0/CHUNK); cx <= Math.floor((x0+63)/CHUNK); cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx*CHUNK+lx)+','+(cy*CHUNK+ly), t[ly*CHUNK+lx]);
}
const ch = v => v === T.ROAD ? '路' : v === T.SIDEWALK ? '人' : v === T.WALL ? '墙' : v === T.DOOR ? '门'
    : v === T.TREE ? '树' : (v === T.TRASHBIN || v === T.CARDBOX || v === T.HYDRANT || v === T.NEWSSTAND || v === T.TIRES) ? '杂'
    : v === T.CAR ? '车' : v === T.BARRICADE ? '栏' : '·';
for (let y = y0; y < y0 + 48; y++) {
    let row = '';
    for (let x = x0; x < x0 + 64; x++) row += ch(tiles.get(x+','+y));
    console.log(row);
}
