import { genChunkTiles, T, CHUNK } from '../source-code/mod-wasteland/world.js';
import { districtAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const tiles = new Map();
for (let cy = -64; cy <= 63; cy++) for (let cx = -64; cx <= 63; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
const roadOnly = (gx, gy) => tileAt(gx, gy) === T.ROAD;
const run = (gx, gy, dx, dy, cap) => { let n = 0; while (n < cap && roadOnly(gx - dx * (n + 1), gy - dy * (n + 1))) n++; return n; };
const gx = 990, gy = -1005;
const dL = run(gx, gy, 1, 0, 64), dR = run(gx, gy, -1, 0, 64);
const dU = run(gx, gy, 0, 1, 64), dD = run(gx, gy, 0, -1, 64);
const hBand = dL + dR + 1, vBand = dU + dD + 1;
console.log('中心:', tileAt(gx,gy), 'hBand=', hBand, 'vBand=', vBand, '宽=', Math.min(hBand, vBand));
console.log('上2格:', tileAt(gx,gy-1), tileAt(gx,gy-2), '下2格:', tileAt(gx,gy+1), tileAt(gx,gy+2));
console.log('左2格:', tileAt(gx-1,gy), tileAt(gx-2,gy), '右2格:', tileAt(gx+1,gy), tileAt(gx+2,gy));
