// 诊断背面 sprite 头发底部未染色像素
// 模拟 nearestPart 逻辑，找出 ny<0.30 区域内不满足当前 hair 条件的暖棕像素

import { createCanvas, loadImage } from 'canvas';

const MC_PAL = {
    skin:  [[247, 205, 155], [200, 160, 120], [216, 176, 136], [117, 75, 50], [120, 78, 53]],
    hair:  [[55, 36, 21], [74, 46, 22], [100, 66, 31], [56, 40, 24]],
    shirt: [[18, 43, 26], [20, 45, 24], [24, 56, 24], [40, 80, 40]],
    pants: [[28, 48, 66], [41, 62, 81], [48, 64, 88], [16, 32, 48]],
    shoes: [[109, 66, 32], [39, 25, 15], [120, 67, 25], [136, 88, 48], [72, 43, 22]],
    eyes:  [[28, 24, 20], [50, 35, 25], [45, 30, 22]],
};
const MC_KEYS = Object.keys(MC_PAL);

function nearestPart(r, g, b, ny, nx) {
    let best = null, bestD = 1e9;
    for (const k of MC_KEYS) {
        for (const p of MC_PAL[k]) {
            const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
            if (d < bestD) { bestD = d; best = k; }
        }
    }
    // 头发区域色相硬约束（第 994 行）
    if (ny < 0.30 && r > g && g > b && r >= 55 && r <= 170 && g >= 38 && g <= 115 && b >= 8 && b <= 70
        && (r * 0.299 + g * 0.587 + b * 0.114) < 100) {
        return 'hair';
    }
    // 头部区域 shoes→hair（第 1001 行）
    if (best === 'shoes' && ny < 0.25) return 'hair';
    // 头发区域暖棕像素硬约束（第 1017 行，修改后）
    if (ny < 0.30 && r > b && r <= 170 && !(Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2 && Math.abs(r - b) <= 2)) {
        return 'hair';
    }
    // 鞋区暖棕硬约束（第 1028 行）
    if (ny >= 0.78 && r > g && g > b && r >= 8 && r <= 180 && g >= 4 && g <= 120 && b >= 1 && b <= 80) {
        return 'shoes';
    }
    if (bestD >= 12000) return null;
    // shoes 位置硬约束（第 1044 行）
    if (best === 'shoes' && ny < 0.78) return null;
    if (best === 'hair' && ny > 0.80) return 'shoes';
    if (best === 'hair' && ny >= 0.30 && ny <= 0.80) return null;
    if (best === 'pants' && ny >= 0.28 && ny < 0.55) return 'shirt';
    if (best === 'eyes') {
        if (ny < 0.30) return 'hair';
        if (ny >= 0.30 && ny < 0.55) return 'skin';
        if (ny >= 0.55 && ny < 0.78) return 'shirt';
        if (ny >= 0.78 && ny <= 0.95) return 'pants';
        return null;
    }
    return best;
}

async function main() {
    const img = await loadImage('c:/Users/24601/Desktop/文字植物大战僵尸-优化版(1)(1)/文字植物大战僵尸-优化版(1)/source-code/mod-wasteland/sprite-back.png');
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, img.width, img.height);
    const d = id.data;

    // 计算 bbox
    let mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const idx = (y * img.width + x) * 4;
            if (d[idx + 3] > 40) {
                if (x < mnx) mnx = x; if (x > mxx) mxx = x;
                if (y < mny) mny = y; if (y > mxy) mxy = y;
            }
        }
    }
    const bbH = mxy - mny + 1;
    const bbW = mxx - mnx + 1;
    console.log(`BBox: x=${mnx}, y=${mny}, w=${bbW}, h=${bbH}`);
    console.log(`Image: ${img.width}x${img.height}`);

    // 统计 ny<0.30 区域内未被染色的像素
    const uncolored = [];
    const colored = [];
    const total = { hair: 0, shoes: 0, skin: 0, shirt: 0, pants: 0, eyes: 0, null: 0 };

    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const idx = (y * img.width + x) * 4;
            if (d[idx + 3] === 0) continue;
            const r = d[idx], g = d[idx+1], b = d[idx+2];
            const ny = (y - mny) / bbH;
            const nx = (x - mnx) / bbW;

            if (ny < 0.30) {
                const part = nearestPart(r, g, b, ny, nx);
                if (part === 'hair') {
                    colored.push({ x, y, r, g, b, ny, nx });
                } else {
                    uncolored.push({ x, y, r, g, b, ny, nx, part });
                }
                total[part || 'null'] = (total[part || 'null'] || 0) + 1;
            }
        }
    }

    console.log(`\nny<0.30 区域统计:`);
    console.log(`  已染色 (hair): ${colored.length} px`);
    console.log(`  未染色: ${uncolored.length} px`);
    console.log(`  按部位:`, total);

    // 分析未染色像素的颜色分布
    console.log(`\n未染色像素颜色分布 (前 30 个):`);
    const colorGroups = {};
    for (const p of uncolored) {
        const key = `R${Math.round(p.r/10)*10} G${Math.round(p.g/10)*10} B${Math.round(p.b/10)*10}`;
        if (!colorGroups[key]) colorGroups[key] = { count: 0, samples: [] };
        colorGroups[key].count++;
        if (colorGroups[key].samples.length < 3) {
            colorGroups[key].samples.push(`[${p.r},${p.g},${p.b}] ny=${p.ny.toFixed(2)}`);
        }
    }
    const sorted = Object.entries(colorGroups).sort((a, b) => b[1].count - a[1].count);
    for (const [key, val] of sorted.slice(0, 30)) {
        console.log(`  ${key}: ${val.count}px - 示例: ${val.samples.join(', ')}`);
    }

    // 特别关注：未染色像素中，哪些是暖棕（R>B）但被拦截的
    const warmBrownBlocked = uncolored.filter(p => p.r > p.b && p.r <= 170);
    console.log(`\n暖棕被拦截 (R>B, R<=170): ${warmBrownBlocked.length} px`);
    if (warmBrownBlocked.length > 0) {
        console.log('  示例:', warmBrownBlocked.slice(0, 10).map(p => `[${p.r},${p.g},${p.b}] ny=${p.ny.toFixed(2)} part=${p.part}`).join(', '));
    }

    // 特别关注：未染色像素中，哪些不满足 R>B 的
    const notWarmBrown = uncolored.filter(p => p.r <= p.b);
    console.log(`\n非暖棕 (R<=B): ${notWarmBrown.length} px`);
    if (notWarmBrown.length > 0) {
        console.log('  示例:', notWarmBrown.slice(0, 10).map(p => `[${p.r},${p.g},${p.b}] ny=${p.ny.toFixed(2)} part=${p.part}`).join(', '));
    }
}

main().catch(console.error);
