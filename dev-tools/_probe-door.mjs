import { genChunkTiles, T } from '../source-code/mod-wasteland/world.js';
import { districtAt, buildingTypeAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const found = [];
for (let cy = -6; cy <= 6 && found.length < 8; cy++) {
  for (let cx = -6; cx <= 6 && found.length < 8; cx++) {
    const t = genChunkTiles(seed, cx, cy);
    for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
      if (t[ly * 16 + lx] === T.DOOR) {
        found.push({ cx, cy, door: [cx * 16 + lx, cy * 16 + ly], district: districtAt(seed, cx, cy), bType: buildingTypeAt(seed, cx, cy) });
        break;
      }
    }
  }
}
console.log(JSON.stringify(found, null, 1));
