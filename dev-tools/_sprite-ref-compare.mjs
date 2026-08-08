// 生成"专业参考 vs 我们的实现"正/侧视对照图
// 左: Soldier-Red 正面站立(r0c0) + 侧面站立(r2c0 左 / r6c0 右)
// 右: 我们游戏实现(由 CDP 脚本截图后合成)
import fs from 'node:fs';
import { PNG } from 'pngjs';

const png = PNG.sync.read(fs.readFileSync('dev-tools/_qa_tmp/puny-ref-soldier.png'));
const W = png.width;
const ZOOM = 10;
const CELL = 32;

function getCell(r, c) {
    const ox = c * 32, oy = r * 32;
    const out = Buffer.alloc(32 * 32 * 4);
    for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
        const i = ((oy + py) * W + ox + px) * 4;
        out[(py * 32 + px) * 4] = png.data[i];
        out[(py * 32 + px) * 4 + 1] = png.data[i + 1];
        out[(py * 32 + px) * 4 + 2] = png.data[i + 2];
        out[(py * 32 + px) * 4 + 3] = png.data[i + 3];
    }
    return out;
}

// 把 32x32 cell 放大 ZOOM 倍并放到目标 canvas(带 padding)
function blitZoom(dst, dstW, dstH, cellData, dx, dy, scale) {
    for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
        const srcIdx = (py * 32 + px) * 4;
        const a = cellData[srcIdx + 3];
        if (!a) continue;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const X = dx + px * scale + sx, Y = dy + py * scale + sy;
            if (X < 0 || Y < 0 || X >= dstW || Y >= dstH) continue;
            const di = (Y * dstW + X) * 4;
            dst[di] = cellData[srcIdx]; dst[di + 1] = cellData[srcIdx + 1]; dst[di + 2] = cellData[srcIdx + 2]; dst[di + 3] = 255;
        }
    }
}

// 布局: 一列 4 帧(正面/左侧/背面/右侧), 每帧 32*10=320px 高
const FRAME_H = CELL * ZOOM; // 320
const PAD = 40;
const cols = 2; // 左列=专业参考 右列=我们实现(留白, 稍后贴)
const WIDTH = PAD * 2 + cols * (CELL * ZOOM + PAD);
const HEIGHT = PAD * 2 + 4 * FRAME_H;
const dst = Buffer.alloc(WIDTH * HEIGHT * 4, 0);

// 深色背景
for (let i = 0; i < WIDTH * HEIGHT; i++) { dst[i * 4 + 3] = 255; dst[i * 4] = 16; dst[i * 4 + 1] = 18; dst[i * 4 + 2] = 22; }

// 专业参考帧: r0=下(正面) r2=左(侧) r4=上(背面) r6=右(侧)
const refFrames = [
    { r: 0, label: '正面(向下)' },
    { r: 2, label: '侧面(向左)' },
    { r: 4, label: '背面(向上)' },
    { r: 6, label: '侧面(向右)' },
];
refFrames.forEach((f, i) => {
    const cell = getCell(f.r, 0);
    const dy = PAD + i * FRAME_H;
    const dx = PAD;
    blitZoom(dst, WIDTH, HEIGHT, cell, dx, dy, ZOOM);
});

// 输出
const out = new PNG({ width: WIDTH, height: HEIGHT });
out.data = dst;
fs.writeFileSync('dev-tools/_qa_tmp/ref-comparison-refonly.png', PNG.sync.write(out));
console.log(`参考图已生成: ${WIDTH}x${HEIGHT}`);
console.log('帧布局:');
refFrames.forEach((f, i) => console.log(`  y=${PAD + i * FRAME_H}: ${f.label}`));
console.log('右列(y同左)留给我们的实现');
