// 生成"侧视走路动画参考图": 朝左/朝右 × 3 帧(frame 0/1/2 迈步循环), 10x 放大
// 展示: 前后脚交替(前腿亮/后腿暗) + 手前后摆动(step ±1)
import fs from 'node:fs';
import { PNG } from 'pngjs';

const ZOOM = 10;
const PAD = 40;
const FRAME_W = 28 * ZOOM, FRAME_H = 33 * ZOOM;
const files = ['ours-front.png', 'ours-side-left.png', 'ours-back.png', 'ours-side-right.png'];
const COL2_X = PAD + FRAME_W + 30; // 右侧(朝左)起点

// 加载单帧 png 并转成 28x33 RGBA 数组
function loadFrame(file) {
    const p = PNG.sync.read(fs.readFileSync('dev-tools/_qa_tmp/' + file));
    const out = Buffer.alloc(28 * 33 * 4);
    for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
        const i = (py * p.width + px) * 4;
        out[(py * 28 + px) * 4] = p.data[i];
        out[(py * 28 + px) * 4 + 1] = p.data[i + 1];
        out[(py * 28 + px) * 4 + 2] = p.data[i + 2];
        out[(py * 28 + px) * 4 + 3] = p.data[i + 3];
    }
    return out;
}

// 合成图: 2 列(朝左/朝右) x 3 帧
const WIDTH = PAD * 2 + 2 * FRAME_W + 30;
const HEIGHT = PAD * 2 + 3 * FRAME_H;
const dst = Buffer.alloc(WIDTH * HEIGHT * 4, 0);
for (let i = 0; i < WIDTH * HEIGHT; i++) { dst[i * 4 + 3] = 255; dst[i * 4] = 13; dst[i * 4 + 1] = 15; dst[i * 4 + 2] = 19; }

function blit(frameData, dx, dy) {
    for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
        const si = (py * 28 + px) * 4;
        const a = frameData[si + 3];
        if (!a) continue;
        for (let sy = 0; sy < ZOOM; sy++) for (let sx = 0; sx < ZOOM; sx++) {
            const X = dx + px * ZOOM + sx, Y = dy + py * ZOOM + sy;
            if (X < 0 || Y < 0 || X >= WIDTH || Y >= HEIGHT) continue;
            const di = (Y * WIDTH + X) * 4;
            dst[di] = frameData[si]; dst[di + 1] = frameData[si + 1]; dst[di + 2] = frameData[si + 2]; dst[di + 3] = 255;
        }
    }
}

// 帧顺序: 朝右(左列) frame0/1/2, 朝左(右列) frame0/1/2
// 直接用 CDP 生成的静态帧只含单帧; 这里用文件命名约定: 走 CDP 生成 side-right-frameN / side-left-frameN
const frameNames = [0, 1, 2];
for (let i = 0; i < 3; i++) {
    const dy = PAD + i * FRAME_H;
    // 朝右
    const rightFile = 'dev-tools/_qa_tmp/ours-side-right-frame' + frameNames[i] + '.png';
    const leftFile = 'dev-tools/_qa_tmp/ours-side-left-frame' + frameNames[i] + '.png';
    if (fs.existsSync(rightFile)) {
        blit(loadFrame('ours-side-right-frame' + frameNames[i] + '.png'), PAD, dy);
        console.log('帧' + frameNames[i] + ' 朝右 @y=' + dy);
    }
    if (fs.existsSync(leftFile)) {
        blit(loadFrame('ours-side-left-frame' + frameNames[i] + '.png'), COL2_X, dy);
        console.log('帧' + frameNames[i] + ' 朝左 @y=' + dy);
    }
}

const out = new PNG({ width: WIDTH, height: HEIGHT });
out.data = dst;
fs.writeFileSync('dev-tools/_qa_tmp/参考图-侧视走路动画.png', PNG.sync.write(out));
console.log('生成: 参考图-侧视走路动画.png ' + WIDTH + 'x' + HEIGHT);
