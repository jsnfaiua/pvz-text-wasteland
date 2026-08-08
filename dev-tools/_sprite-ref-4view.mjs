// 生成"所有视角参考图": 我们实现的 4 视角(正面/侧左/背面/侧右) 放大 10x 并排, 带标签
import fs from 'node:fs';
import { PNG } from 'pngjs';

const ZOOM = 10;
const PAD = 50;
const LABEL_H = 30;
const FRAME_W = 28 * ZOOM, FRAME_H = 33 * ZOOM;
const files = ['ours-front.png', 'ours-side-left.png', 'ours-back.png', 'ours-side-right.png'];
const labels = ['正面(向下)', '侧面(向左)', '背面(向上)', '侧面(向右)'];
const WIDTH = PAD * 2 + 4 * FRAME_W + 3 * 24; // 4 帧横排 + 间隔
const HEIGHT = PAD + LABEL_H + FRAME_H + PAD;

const dst = Buffer.alloc(WIDTH * HEIGHT * 4, 0);
for (let i = 0; i < WIDTH * HEIGHT; i++) { dst[i * 4 + 3] = 255; dst[i * 4] = 13; dst[i * 4 + 1] = 15; dst[i * 4 + 2] = 19; }

for (let i = 0; i < 4; i++) {
    const p = PNG.sync.read(fs.readFileSync('dev-tools/_qa_tmp/' + files[i]));
    const dx = PAD + i * (FRAME_W + 24);
    const dy = PAD + LABEL_H;
    // 标签(用简单像素字? 直接画色条+位置, 标签文字由外部工具标注, 这里画在图上)
    // 简单标签: 帧顶画一条主题色条
    for (let y = 0; y < 6; y++) for (let x = 0; x < FRAME_W; x++) {
        const di = ((dy - 10 + y) * WIDTH + dx + x) * 4;
        dst[di] = 57; dst[di + 1] = 217; dst[di + 2] = 138; dst[di + 3] = 255;
    }
    // 贴帧
    for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
        const si = (py * p.width + px) * 4;
        const a = p.data[si + 3];
        if (!a) continue;
        for (let sy = 0; sy < ZOOM; sy++) for (let sx = 0; sx < ZOOM; sx++) {
            const X = dx + px * ZOOM + sx, Y = dy + py * ZOOM + sy;
            if (X < 0 || Y < 0 || X >= WIDTH || Y >= HEIGHT) continue;
            const di = (Y * WIDTH + X) * 4;
            dst[di] = p.data[si]; dst[di + 1] = p.data[si + 1]; dst[di + 2] = p.data[si + 2]; dst[di + 3] = 255;
        }
    }
    console.log('帧' + i + ' ' + labels[i] + ' @x=' + dx);
}

const out = new PNG({ width: WIDTH, height: HEIGHT });
out.data = dst;
fs.writeFileSync('dev-tools/_qa_tmp/参考图-四视角.png', PNG.sync.write(out));
console.log('生成: dev-tools/_qa_tmp/参考图-四视角.png ' + WIDTH + 'x' + HEIGHT);
