import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const desktop = 'C:/Users/24601/Desktop';
function findProject(dir, depth) {
    if (depth > 3) return null;
    let entries = [];
    try { entries = readdirSync(dir); } catch { return null; }
    for (const e of entries) {
        if (e.startsWith('.') || e === 'node_modules') continue;
        const p = join(dir, e);
        let st = null; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
            const r = findProject(p, depth + 1);
            if (r) return r;
        } else if (e === 'server.js') {
            if (existsSync(join(dir, 'dev-tools/_serve-qa.mjs'))) return dir;
        }
    }
    return null;
}
const root = findProject(desktop, 0);
if (!root) { console.error('PROJECT NOT FOUND'); process.exit(2); }
console.log('project:', root);

const files = [
    'source-code/mod-wasteland/survival.js',
    'source-code/mod-wasteland/windoor.js',
    'source-code/mod-wasteland/render.js',
];
let bad = 0;
for (const rel of files) {
    const f = join(root, rel);
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) { console.error('SYNTAX FAIL:', rel); console.error(r.stderr.slice(0, 1500)); bad++; }
    else console.log('OK:', rel.split('/').pop());
}
if (bad) process.exit(1);

const r = spawnSync(process.execPath, [join(root, 'dev-tools/smoke-test.js')], { cwd: root, encoding: 'utf8', timeout: 120000 });
console.log(r.stdout);
if (r.status !== 0) { console.error('SMOKE FAIL', r.status); process.exit(1); }
console.log('ALL OK');
