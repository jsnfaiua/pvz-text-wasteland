// 合成对照图: 左列=专业参考(Soldier-Red), 右列=我们的实现(ours-*.png)
import fs from 'node:fs';
import { PNG } from 'pngjs';

const png = PNG.sync.read(fs.readFileSync('dev-tools/_qa_tmp/puny-ref-soldier.png'));
const W = png.width;
const ZOOM = 10;
const CELL = 32;
const FRAME_H = CELL * ZOOM;
const PAD = 40;
const WIDTH = PAD * 2 + 2 * (CELL * ZOOM) + PAD;
const HEIGHT = PAD * 2 + 4 * FRAME_H;
const dst = Buffer.alloc(WIDTH * HEIGHT * 4, 0);
for (let i = 0; i < WIDTH * HEIGHT; i++) {
    dst[i * 4 + 3] = 255; dst[i * 4] = 16; dst[i * 4 + 1] = 18; dst[i * 4 + 2] = 22;
}

function blitCell(cellData, dx, dy, scale) {
    for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
        const si = (py * 32 + px) * 4;
        const a = cellData[si + 3];
        if (!a) continue;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const X = dx + px * scale + sx, Y = dy + py * scale + sy;
            if (X < 0 || Y < 0 || X >= WIDTH || Y >= HEIGHT) continue;
            const di = (Y * WIDTH + X) * 4;
            dst[di] = cellData[si]; dst[di + 1] = cellData[si + 1]; dst[di + 2] = cellData[si + 2]; dst[di + 3] = 255;
        }
    }
}
function getRefCell(r, c) {
    const ox = c * 32, oy = r * 32;
    const out = Buffer.alloc(32 * 32 * 4);
    for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
        const i = ((oy + py) * W + ox + px) * 4;
        out[(py * 32 + px) * 4] = png.data[i]; out[(py * 32 + px) * 4 + 1] = png.data[i + 1];
        out[(py * 32 + px) * 4 + 2] = png.data[i + 2]; out[(py * 32 + px) * 4 + 3] = png.data[i + 3];
    }
    return out;
}
function getOurs(file) {
    const p = PNG.sync.read(fs.readFileSync(file));
    const out = Buffer.alloc(32 * 33 * 4, 0);
    for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
        const i = (py * p.width + px) * 4;
        out[(py * 32 + px) * 4] = p.data[i]; out[(py * 32 + px) * 4 + 1] = p.data[i + 1];
        out[(py * 32 + px) * 4 + 2] = p.data[i + 2]; out[(py * 32 + px) * 4 + 3] = p.data[i + 3];
    }
    return out;
}

const refRows = [0, 2, 4, 6];
const oursFiles = ['ours-front.png', 'ours-side-left.png', 'ours-back.png', 'ours-side-right.png'];
const labels = ['正面(向下)', '侧面(向左)', '背面(向上)', '侧面(向右)'];
const COL2_X = PAD + CELL * ZOOM + PAD;

for (let i = 0; i < 4; i++) {
    const dy = PAD + i * FRAME_H;
    const refCell = getRefCell(refRows[i], 0);
    blitCell(refCell, PAD, dy, ZOOM);
    const ours = getOurs('dev-tools/_qa_tmp/' + oursFiles[i]);
    for (let py = 0; py < 33; py++) for (let px = 0; px < 32; px++) {
        const si = (py * 32 + px) * 4;
        const a = ours[si + 3];
        if (!a) continue;
        for (let sy = 0; sy < ZOOM; sy++) for (let sx = 0; sx < ZOOM; sx++) {
            const X = COL2_X + px * ZOOM + sx, Y = dy + py * ZOOM + sy;
            if (X < 0 || Y < 0 || X >= WIDTH || Y >= HEIGHT) continue;
            const di = (Y * WIDTH + X) * 4;
            dst[di] = ours[si]; dst[di + 1] = ours[si + 1]; dst[di + 2] = ours[si + 2]; dst[di + 3] = 255;
        }
    }
    console.log('帧' + i + ' ' + labels[i] + ': 左列参考 / 右列实现');
}

const out = new PNG({ width: WIDTH, height: HEIGHT });
out.data = dst;
fs.writeFileSync('dev-tools/_qa_tmp/对照-正侧视图-参考vs实现.png', PNG.sync.write(out));
console.log('对照图已生成: dev-tools/_qa_tmp/对照-正侧视图-参考vs实现.png');
