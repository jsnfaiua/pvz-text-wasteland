// ============================================================
// 修复 walk sprite 中的"撞鞋色"像素
// 根因：sprite 头顶/脸颊的"亮棕色" [104,72,40] 与 MC_PAL shoes[0] 完全相同，
// tintSprite 会把它染成玩家鞋色（与玩家头发色对比显眼）→ 形成"杂点"。
//
// 修复思路：直接在 sprite 文件里把这些"撞色"像素替换为"接近 hair 主色"的值。
// 判定标准：sprite 中某像素颜色与 shoes 主色 [104,72,40] 距离 < 50，
// 且位置在 sprite 上半部（ny < 0.5），则替换为 hair 主色 [56,40,24] 的近似值。
//
// 同时清理 walk-back-f0、walk-side-f0/f2 头顶孤立的"飞起来"的小色块
// （与 maskIsolatedPixels 同样的逻辑：连通分量 < 8 像素的孤立小块 mask）。
//
// 输出原位替换源文件，便于游戏直接加载干净 sprite。
// ============================================================
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const SPRITE_DIR = 'source-code/mod-wasteland/sprites';

// 修复目标 sprite（按用户报告的"行走时杂点"主要是侧视和背视）
const targets = [
    // 侧视（西/东方向行走）：f0/f2 头顶有亮棕色撞鞋色，f1/f3 干净
    'walk-side-f0.png',
    'walk-side-f2.png',
    // 背视（北方向行走）
    'walk-back-f0.png',
    // 前视（南方向行走）：f0 干净，f1/f2/f3 撞色严重
    'walk-front-f1.png',
    'walk-front-f2.png',
    'walk-front-f3.png',
    // 待机帧：idle 动画帧可能也有相同问题
    'sprite-back-idle0.png',
    'sprite-side-idle0.png',
    // 所有 walk-back 帧都可能有问题
    'walk-back-f1.png',
    'walk-back-f2.png',
    'walk-back-f3.png',
    // 站立帧：用户报告"站立干净"但 tinted 后头顶仍有少量黄色残留
    'sprite-front.png',
    'sprite-side.png',
    // walk-front-f0：之前的截图显示干净，但保险起见也修一下
    'walk-front-f0.png',
];

// 头发主色（与 MC_PAL.hair 一致）：把头顶撞鞋色的像素替换为这个
const HAIR_COLOR = [56, 40, 24];
const SHOES_KEY = [104, 72, 40];   // 与之撞色的 shoes 主色

// RGB 距离平方
const dist2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;

function fixCollisions(png) {
    const { width: W, height: H, data } = png;
    let replaced = 0;
    // 替换顶部 ny < 0.5 且颜色接近 [104,72,40] 的像素（撞 shoes 主色）。
    // 距离阈值 2500（RGB 距离 ≈50）：覆盖 [129,83,39]、[131,82,35]、[135,90,50] 等
    // 接近色。sprite 顶部的"亮棕色"若不修复会被 nearestPart 判给 shoes → 染成玩家鞋色（杂点）。
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (data[i + 3] === 0) continue;
            const ny = y / H;
            if (ny >= 0.5) continue;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const dShoes = dist2([r, g, b], SHOES_KEY);
            if (dShoes < 2500) {
                data[i] = HAIR_COLOR[0];
                data[i + 1] = HAIR_COLOR[1];
                data[i + 2] = HAIR_COLOR[2];
                replaced++;
            }
        }
    }
    return replaced;
}

// 清理孤立小块（CC + 阈值）
function removeIsolatedBlocks(png, threshold = 6) {
    const { width: W, height: H, data } = png;
    const N = W * H;
    const labels = new Int32Array(N);
    for (let i = 0; i < N; i++) labels[i] = -1;
    const sizes = [];
    let nextLabel = 0;
    const stack = [];
    for (let start = 0; start < N; start++) {
        if (data[start * 4 + 3] === 0) { labels[start] = 0; continue; }
        if (labels[start] !== -1) continue;
        const lab = ++nextLabel;
        let size = 0;
        stack.length = 0;
        stack.push(start);
        labels[start] = lab;
        while (stack.length) {
            const cur = stack.pop();
            size++;
            const cx = cur % W, cy = (cur / W) | 0;
            if (cx > 0) { const n = cur - 1; if (labels[n] === -1 && data[n * 4 + 3] !== 0) { labels[n] = lab; stack.push(n); } }
            if (cx < W - 1) { const n = cur + 1; if (labels[n] === -1 && data[n * 4 + 3] !== 0) { labels[n] = lab; stack.push(n); } }
            if (cy > 0) { const n = cur - W; if (labels[n] === -1 && data[n * 4 + 3] !== 0) { labels[n] = lab; stack.push(n); } }
            if (cy < H - 1) { const n = cur + W; if (labels[n] === -1 && data[n * 4 + 3] !== 0) { labels[n] = lab; stack.push(n); } }
        }
        sizes[lab] = size;
    }
    let removed = 0;
    for (let i = 0; i < N; i++) {
        const lab = labels[i];
        if (lab > 0 && sizes[lab] < threshold) {
            data[i * 4 + 3] = 0;
            removed++;
        }
    }
    return removed;
}

function main() {
    for (const name of targets) {
        const p = path.join(SPRITE_DIR, name);
        if (!fs.existsSync(p)) { console.log(`[skip] ${name} 不存在`); continue; }
        const buf = fs.readFileSync(p);
        const png = PNG.sync.read(buf);
        const r1 = fixCollisions(png);
        const r2 = removeIsolatedBlocks(png);
        const out = PNG.sync.write(png);
        // 仅在有改动时写回
        if (r1 + r2 > 0) {
            fs.writeFileSync(p, out);
            console.log(`[fix] ${name}  撞色替换 ${r1} 像素，孤立清理 ${r2} 像素`);
        } else {
            console.log(`[ok ] ${name}  无需修改`);
        }
    }
}
main();