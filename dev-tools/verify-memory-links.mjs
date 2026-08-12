import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname as d } from 'path';

const root = 'd:/Project/pvz-text-wasteland';
const memDir = join(root, 'docs', '记忆库');
const files = ['README.md', ...readdirSync(memDir).map(f => join('docs', '记忆库', f))];
const links = new Set();
const bad = [];

for (const f of files) {
    const abs = join(root, f);
    const content = readFileSync(abs, 'utf8');
    const re = /\[[^\]]*\]\(([^)#]*)\)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const link = m[1].trim();
        if (link && !link.startsWith('http') && !link.startsWith('#') && !link.includes('://')) {
            links.add(link);
        }
    }
}

// resolve each link relative to its own file location
function checkLink(link, fromFile) {
    // link is stored as "FILE -> LINK" mapping instead; do per-file now
}

// redo per-file to resolve relative to file dir
const badPerFile = [];
for (const f of files) {
    const abs = join(root, f);
    const content = readFileSync(abs, 'utf8');
    const re = /\[[^\]]*\]\(([^)#]*)\)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const link = m[1].trim();
        if (!link || link.startsWith('http') || link.startsWith('#') || link.includes('://')) continue;
        const base = d(abs);
        const resolved = resolve(base, link);
        if (!existsSync(resolved)) {
            badPerFile.push(`${f} -> ${link}`);
        }
    }
}

console.log(`Unique links: ${links.size}`);
if (badPerFile.length === 0) {
    console.log('ALL LINKS OK');
} else {
    console.log('BROKEN LINKS (file -> target):');
    badPerFile.forEach(b => console.log('  ' + b));
}
