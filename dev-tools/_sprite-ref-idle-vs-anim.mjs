// 合成"静止侧视 vs 走路动画帧"对比图: 每行 4 格(静止 / 帧0 / 帧1 / 帧2), 上排朝右, 下排朝左
import fs from 'node:fs';
import { PNG } from 'pngjs';

const ZOOM = 10;
const PAD = 40;
const FRAME_W = 28 * ZOOM, FRAME_H = 33 * ZOOM;
const WIDTH = PAD * 2 + 4 * FRAME_W + 3 * 24;
const HEIGHT = PAD * 2 + 2 * FRAME_H;
const dst = Buffer.alloc(WIDTH * HEIGHT * 4, 0);
for (let i = 0; i < WIDTH * HEIGHT; i++) { dst[i * 4 + 3] = 255; dst[i * 4] = 13; dst[i * 4 + 1] = 15; dst[i * 4 + 2] = 19; }

function loadFrame(file) {
    const p = PNG.sync.read(fs.readFileSync('dev-tools/_qa_tmp/' + file));
    const out = Buffer.alloc(28 * 33 * 4);
    for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
        const i = (py * p.width + px) * 4;
        out[(py * 28 + px) * 4] = p.data[i]; out[(py * 28 + px) * 4 + 1] = p.data[i + 1];
        out[(py * 28 + px) * 4 + 2] = p.data[i + 2]; out[(py * 28 + px) * 4 + 3] = p.data[i + 3];
    }
    return out;
}
function blit(fd, dx, dy) {
    for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
        const si = (py * 28 + px) * 4;
        if (!fd[si + 3]) continue;
        for (let sy = 0; sy < ZOOM; sy++) for (let sx = 0; sx < ZOOM; sx++) {
            const X = dx + px * ZOOM + sx, Y = dy + py * ZOOM + sy;
            const di = (Y * WIDTH + X) * 4;
            dst[di] = fd[si]; dst[di + 1] = fd[si + 1]; dst[di + 2] = fd[si + 2]; dst[di + 3] = 255;
        }
    }
}

const rows = [
    { label: '朝右', files: ['ours-side-right-idle.png', 'ours-side-right-frame0.png', 'ours-side-right-frame1.png', 'ours-side-right-frame2.png'] },
    { label: '朝左', files: ['ours-side-left-idle.png', 'ours-side-left-frame0.png', 'ours-side-left-frame1.png', 'ours-side-left-frame2.png'] },
];
rows.forEach((row, ri) => {
    const dy = PAD + ri * FRAME_H;
    row.files.forEach((f, fi) => {
        const dx = PAD + fi * (FRAME_W + 24);
        blit(loadFrame(f), dx, dy);
    });
    console.log(row.label + ' 行 @y=' + dy);
});

const out = new PNG({ width: WIDTH, height: HEIGHT });
out.data = dst;
fs.writeFileSync('dev-tools/_qa_tmp/对比-静止侧视vs动画.png', PNG.sync.write(out));
console.log('生成: 对比-静止侧视vs动画.png');
