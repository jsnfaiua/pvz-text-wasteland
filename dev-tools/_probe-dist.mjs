import { buildingTypeAt, districtAt, isIndustrialZone, ringAt } from '../source-code/mod-wasteland/wdistrict.js';
const seed = 20260802;
const spots = [[-89,-158],[-71,-151],[117,-6],[157,-75],[-8,-58]];
for (const [cx, cy] of spots) {
    console.log('(' + cx + ',' + cy + '): type=' + buildingTypeAt(seed,cx,cy) + ' district=' + districtAt(seed,cx,cy) + ' industrial=' + isIndustrialZone(seed,cx,cy) + ' ring=' + ringAt(seed,cx,cy));
}
