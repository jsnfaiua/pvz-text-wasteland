// ============================================================
// 【无尽植僵荒原】代码行数统计（按功能模块聚合）
// 用法: node dev-tools/count-lines.mjs [--detail]
//   默认输出: 顶层模块聚合 + mod-wasteland 单文件明细
//   --detail: 输出 source-code 下全部 .js 文件明细
// 口径: 文件总行数（含注释/空行）；仅统计 source-code/**/*.js
// 配套规则: AGENTS.md §13.13（每次功能迭代完成必须统计）
// ============================================================
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = join(import.meta.dirname, '..', 'source-code');
const detail = process.argv.includes('--detail');

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            out.push(...walk(p));
        } else if (name.endsWith('.js')) {
            out.push(p);
        }
    }
    return out;
}

const files = walk(ROOT);
const linesOf = p => readFileSync(p, 'utf8').split('\n').length;
const entries = files.map(p => ({ rel: relative(ROOT, p).split(sep).join('/'), lines: linesOf(p) }));

const byDir = new Map(); // 顶层目录 -> { lines, files }
for (const e of entries) {
    const top = e.rel.split('/')[0];
    const cur = byDir.get(top) || { lines: 0, files: 0 };
    cur.lines += e.lines;
    cur.files += 1;
    byDir.set(top, cur);
}

console.log('=== 代码行数统计（source-code/**/*.js）===');
let total = 0, totalFiles = 0;
for (const [dir, { lines, files: n }] of [...byDir.entries()].sort((a, b) => b[1].lines - a[1].lines)) {
    const mark = dir === 'mod-wasteland' ? ' ⭐' : '';
    console.log(`${dir.padEnd(14)} ${String(lines).padStart(6)} 行  (${n} 文件)${mark}`);
    total += lines;
    totalFiles += n;
    if (dir === 'mod-wasteland') {
        const subs = entries.filter(e => e.rel.startsWith('mod-wasteland/'))
            .sort((a, b) => b.lines - a.lines);
        for (const s of subs) {
            console.log(`    ├─ ${s.rel.split('/')[1].padEnd(26)} ${String(s.lines).padStart(5)} 行`);
        }
    }
}
console.log('─'.repeat(44));
console.log(`总计: ${total} 行 / ${totalFiles} 文件`);

if (detail) {
    console.log('\n=== 全部文件明细 ===');
    for (const e of entries.sort((a, b) => b.lines - a.lines)) {
        console.log(`${String(e.lines).padStart(6)}  ${e.rel}`);
    }
}
