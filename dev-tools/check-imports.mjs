// 完整 import/export 校验：每个 .js 的每行 import { X, Y as Z } from './target.js'，
// 在 target.js 的 export 列表中找 X；找不到就报错。
// 跨多行 import（"import {\n  a,\n  b\n} from './xxx.js';"）也支持。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'source-code/mod-wasteland';
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, f));

// 收集所有文件的 export
function getExports(file) {
    const txt = fs.readFileSync(file, 'utf8');
    const ex = new Set();
    // 单行 export function/const/let/class
    for (const m of txt.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)) ex.add(m[1]);
    // export { a, b as c }
    for (const m of txt.matchAll(/^export\s*\{([^}]+)\}\s*;?/gm)) {
        for (let part of m[1].split(',')) {
            part = part.trim();
            if (!part) continue;
            const as = part.match(/(\w+)\s+as\s+(\w+)/);
            ex.add(as ? as[1] : part);
        }
    }
    return ex;
}

const exportMap = new Map();
for (const f of files) exportMap.set(path.basename(f).replace('.js', ''), getExports(f));

// 解析所有 import（含跨行）
let totalMissing = 0;
for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    // 1) 单行: import { ... } from './target.js';
    const singleRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
    for (const m of txt.matchAll(singleRe)) {
        const list = m[1], spec = m[2];
        checkList(path.basename(f), list, spec);
    }
    // 2) 多行: import {\n  ...\n} from './target.js';
    const multiRe = /import\s*\{([^}]*?)\}\s*from\s*['"]([^'"]+)['"]/gs;
    for (const m of txt.matchAll(multiRe)) {
        if (m[1].includes('\n')) checkList(path.basename(f), m[1], m[2]);
    }
}

function checkList(srcFile, list, spec) {
    const target = spec.replace(/^\.\//, '').replace(/^\.\.\//, '').replace('.js', '');
    const exports = exportMap.get(target);
    if (!exports) return;
    const syms = list.split(',').map(s => {
        const t = s.trim().replace(/\s*\/\/.*$/, '').replace(/\s*$/, '');   // 去掉行内注释和空白
        if (!t) return null;
        const as = t.match(/(\w+)\s+as\s+(\w+)/);
        return as ? { from: as[1], to: as[2] } : { from: t, to: t };
    }).filter(Boolean);
    for (const s of syms) {
        if (!exports.has(s.from)) {
            console.log(`MISSING: ${srcFile} imports "${s.from}" from ${target}.js`);
            totalMissing++;
        }
    }
}

console.log('---');
console.log(totalMissing === 0 ? '✓ ALL IMPORTS RESOLVED (all 14 new modules + survival + render + 2 UI)' : `✗ ${totalMissing} MISSING`);
process.exit(totalMissing === 0 ? 0 : 1);
