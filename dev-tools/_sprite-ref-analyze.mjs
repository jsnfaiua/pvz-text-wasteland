// 分析 Soldier-Red sprite sheet：找出完整角色 cell，渲染像素网格，定位正面/侧面/背面站立帧
import fs from 'node:fs';
import { PNG } from 'pngjs';

const png = PNG.sync.read(fs.readFileSync('dev-tools/_qa_tmp/puny-ref-soldier.png'));
console.log(`尺寸 ${png.width}x${png.height}`);
const W = png.width, H = png.height;
const cols = W / 32, rows = H / 32;
console.log(`cell: ${cols} 列 x ${rows} 行`);

// 每个 cell 的非透明像素数 + 包围盒
const cells = [];
for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
        const ox = c * 32, oy = r * 32;
        let count = 0, minX = 99, maxX = -1, minY = 99, maxY = -1;
        for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
            const i = ((oy + py) * W + ox + px) * 4;
            if (png.data[i + 3] > 0) { count++; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
        }
        cells.push({ r, c, count, minX, maxX, minY, maxY });
    }
}
// 只输出像素数 >100 的 cell(完整角色)
const full = cells.filter(x => x.count > 100);
console.log(`完整角色 cell (px>100): ${full.length} 个`);
full.forEach(x => console.log(`  r${x.r}c${x.c} px=${x.count} 包围盒 x[${x.minX}-${x.maxX}] y[${x.minY}-${x.maxY}]`));

// 渲染指定 cell 的像素网格(用字符: 每像素一个字符太密, 用 2x2 合并为 '▀▄' 显示)
function renderCell(r, c, label) {
    const ox = c * 32, oy = r * 32;
    console.log(`\n=== cell r${r}c${c} ${label} (像素色块, 每格 1 像素) ===`);
    for (let py = 0; py < 32; py++) {
        let line = '';
        for (let px = 0; px < 32; px++) {
            const i = ((oy + py) * W + ox + px) * 4;
            const a = png.data[i + 3];
            if (a === 0) line += '.';
            else {
                const r2 = png.data[i], g2 = png.data[i + 1], b2 = png.data[i + 2];
                // 按色系分组
                if (g2 > 120 && r2 < 100 && b2 < 100) line += 'G'; // 绿
                else if (r2 > 150 && g2 < 100) line += 'R'; // 红
                else if (r2 > 150 && g2 > 100 && b2 < 100) line += 'O'; // 橙
                else if (r2 < 80 && g2 < 80 && b2 < 80) line += 'K'; // 黑
                else if (r2 > 150 && g2 > 130 && b2 > 120) line += 'S'; // 肤色
                else if (b2 > 120) line += 'B'; // 蓝
                else if (r2 > 120 && g2 > 100 && b2 > 100) line += 'W'; // 浅色
                else line += '?';
            }
        }
        console.log(String(py).padStart(2) + ' ' + line);
    }
}

// 假设行=方向: 常见的布局是每行一个方向(向下/向上/向左/向右...), 或每列一个方向
// 输出每行第一个完整 cell 和最后一个, 帮判断方向布局
for (let r = 0; r < rows; r++) {
    const rowCells = full.filter(x => x.r === r);
    if (rowCells.length) {
        const c0 = rowCells[0], c1 = rowCells[rowCells.length - 1];
        console.log(`行 ${r}: ${rowCells.length} 个角色 cell, c${c0.c}-c${c1.c}`);
    }
}

// 渲染每行第 0 帧(c0)看方向布局
for (let r = 0; r < 8; r++) renderCell(r, 0, `方向${r} 站立帧`);
