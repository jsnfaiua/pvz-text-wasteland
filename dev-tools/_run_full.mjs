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

// 冒烟测试
let r = spawnSync(process.execPath, [join(root, 'dev-tools/smoke-test.js')], { cwd: root, encoding: 'utf8', timeout: 120000 });
console.log(r.stdout);
if (r.status !== 0) { console.error('SMOKE FAIL', r.status); process.exit(1); }

// 完整功能模拟测试（如存在）
const fullCandidates = ['dev-tools/full-test.js', 'dev-tools/sim-test.js', 'dev-tools/qa-run.js'];
let fullRun = null;
for (const f of fullCandidates) {
    if (existsSync(join(root, f))) { fullRun = f; break; }
}
if (fullRun) {
    r = spawnSync(process.execPath, [join(root, fullRun)], { cwd: root, encoding: 'utf8', timeout: 180000 });
    console.log(r.stdout);
    if (r.status !== 0) { console.error('FULL FAIL', r.status); process.exit(1); }
} else {
    console.log('(no full-test script found)');
}
console.log('ALL OK');
