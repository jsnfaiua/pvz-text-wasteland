// 验证孤儿格到底是 SIDEWALK 还是 FLOOR（两者枚举值都是 '·'）
import { genChunkTiles, T, CHUNK } from '../source-code/mod-wasteland/world.js';
const seed = 20260802;
const tiles = new Map();
for (let cy = -65; cy <= -62; cy++) for (let cx = 8; cx <= 10; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (x, y) => tiles.get(x + ',' + y);
console.log('T.SIDEWALK = ' + JSON.stringify(T.SIDEWALK) + '  T.FLOOR = ' + JSON.stringify(T.FLOOR));
console.log('两者相等? ' + (T.SIDEWALK === T.FLOOR));
console.log('\n列 x=151 y=-1025..-1008:');
for (let y = -1025; y <= -1008; y++) {
    const v = tileAt(151, y);
    let kind;
    if (v === T.SIDEWALK) kind = 'SIDEWALK(人行道)';
    else if (v === T.FLOOR) kind = 'FLOOR(地板)';
    else if (v === T.GROUND) kind = 'GROUND(草)';
    else if (v === T.ROAD) kind = 'ROAD(路)';
    else kind = String(v);
    console.log(`  y=${y} ${kind}`);
}
