// 用法: node diag-order.js A|B|C   （每个模式单独进程运行，避免缓存污染）
import { genChunkTiles, T, CHUNK } from '../source-code/mod-wasteland/world.js';
const seed = 20260802;
const mode = process.argv[2] || 'A';

const orderA = [];
for (let r = 0; r < 12; r++) for (let cy = -64 - r; cy <= -64 + r; cy++) for (let cx = 9 - r; cx <= 9 + r; cx++) {
    if (Math.max(Math.abs(cx - 9), Math.abs(cy + 64)) === r) orderA.push([cx, cy]);
}
let order;
if (mode === 'A') order = orderA;
else if (mode === 'B') order = [...orderA].sort(() => Math.random() - 0.5);
else order = [...orderA].reverse();

const tiles = new Map();
for (const [ccx, ccy] of order) {
    const t = genChunkTiles(seed, ccx, ccy);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
        tiles.set((ccx * CHUNK + lx) + ',' + (ccy * CHUNK + ly), t[ly * CHUNK + lx]);
}
const name = v => v === T.SIDEWALK ? 'SIDEWALK' : v === T.GROUND ? 'GROUND' : v === T.ROAD ? 'ROAD' : v === T.FLOOR ? 'FLOOR' : String(v);
console.log(`模式${mode}: (151,-1010)=${name(tiles.get('151,-1010'))} (151,-1011)=${name(tiles.get('151,-1011'))} (151,-1012)=${name(tiles.get('151,-1012'))} (151,-1013)=${name(tiles.get('151,-1013'))} (151,-1014)=${name(tiles.get('151,-1014'))}`);
