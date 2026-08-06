// ============================================================
// _cdp-backup.mjs — 存档导出/导入专项验证（方向 A）
// 流程：注入存档 → 打开工作台 → 点「导出存档」下载文件 →
//       清空荒原存档 → 用下载的文件构造 File 派发「导入存档」→
//       验证 localStorage 恢复一致。
// 前置：node server.js(:8000) + headless Chrome(:9222)
// 用法：node dev-tools/_cdp-backup.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
const DL_DIR = path.resolve('dev-tools/_qa_tmp');
fs.mkdirSync(DL_DIR, { recursive: true });

async function getJson(url) { return (await fetch(url + '/json')).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
    static async connect(url) {
        const tabs = await getJson(url);
        const tab = tabs.find(t => t.type === 'page') || tabs[0];
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const c = new CDPClient(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id) { const p = c.pending.get(msg.id); if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
            else c.events.push(msg);
        };
        return c;
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
    }
    eventsOf(method) { return this.events.filter(e => e.method === method); }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
        return r.result && r.result.value;
    }
    async navigate(url) {
        await this.send('Page.navigate', { url });
        await new Promise(r => setTimeout(r, 1500));
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const c = await CDPClient.connect(CDP_URL);
    await c.send('Runtime.enable');
    await c.send('Page.enable');

    // 清干净 + 注入最小存档（角色档/世界档/profile/角色列表）
    await c.eval(`(() => {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.includes('wasteland_')) localStorage.removeItem(k);
        }
        localStorage.setItem('u:__guest__:wasteland_character_测试员', JSON.stringify({ v: 3, name: '测试员', day: 7, hp: 88, food: 66, water: 44, inv: [{ id: 'wood', n: 10 }], hotbar: [], mods: { tiles: { '1,1': { t: 1 } } }, character: { skin: '#f0c8a0' } }));
        localStorage.setItem('u:__guest__:wasteland_world_20260802', JSON.stringify({ v: 3, seed: 20260802, day: 7, mods: { tiles: {} } }));
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '测试员', worldSeed: 20260802 }));
        localStorage.setItem('u:__guest__:wasteland_characters', JSON.stringify({ names: ['测试员'] }));
        return 'seeded';
    })()`);

    // 打开工作台 → 点荒原卡片
    await c.navigate(PAGE_URL);
    await sleep(2500);
    await c.eval(`document.getElementById('btn-workshop')?.click()`);
    await sleep(400);
    const cardClick = await c.eval(`(() => {
        const cards = [...document.querySelectorAll('#workshop-screen .ws-card, #workshop-screen [data-mod]')];
        const target = cards.find(x => x.textContent && x.textContent.includes('荒原'));
        if (target) { target.click(); return 'clicked'; }
        return 'cards=' + cards.length + ' html=' + (document.getElementById('workshop-screen') ? document.getElementById('workshop-screen').innerHTML.slice(0, 80) : 'no screen');
    })()`);
    console.log('打开工作台/荒原卡片:', cardClick);
    await sleep(600);

    // 确认导出/导入按钮存在
    const btns = await c.eval(`(() => ({
        exp: !!document.getElementById('ws-save-export'),
        imp: !!document.getElementById('ws-save-import'),
        file: !!document.getElementById('ws-save-file'),
    }))()`);
    console.log('备份按钮:', JSON.stringify(btns));
    if (!btns.exp || !btns.imp) { console.log('FAIL: 按钮缺失'); process.exit(1); }

    // 设置下载行为 → 点导出
    await c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });
    await c.eval(`document.getElementById('ws-save-export')?.click()`);
    await sleep(1200);

    // 读取下载文件
    const files = fs.readdirSync(DL_DIR).filter(f => f.endsWith('.json'));
    console.log('下载文件:', files);
    if (files.length === 0) { console.log('FAIL: 未下载备份文件'); process.exit(1); }
    const backupPath = path.join(DL_DIR, files[files.length - 1]);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    console.log('备份结构: __wslBackup=' + backup.__wslBackup + ' username=' + backup.username + ' entries=' + Object.keys(backup.entries).length);
    console.log('  entries 键:', Object.keys(backup.entries).join(', '));
    const okExport = backup.__wslBackup === 1 && Object.keys(backup.entries).length >= 4;
    if (!okExport) { console.log('FAIL: 备份内容不完整'); process.exit(1); }
    console.log('✅ 导出验证通过（4 类存档键齐全）');

    // 清空 localStorage 荒原键（模拟丢档）
    await c.eval(`(() => {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.includes('wasteland_')) localStorage.removeItem(k);
        }
        return 'cleared: ' + localStorage.length;
    })()`);
    const afterClear = await c.eval(`localStorage.getItem('u:__guest__:wasteland_profile')`);
    console.log('清空后 profile:', afterClear === null ? 'null（已丢失）' : afterClear);

    // 构造 File 派发 change 事件（真实导入路径）
    const fileJson = JSON.stringify(backup);
    const impR = await c.eval(`(() => {
        const input = document.getElementById('ws-save-file');
        if (!input) return 'no input';
        const f = new File([${JSON.stringify(fileJson)}], 'test-backup.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
        return 'dispatched';
    })()`);
    console.log('导入派发:', impR);
    await sleep(1500);

    // 验证恢复
    const restored = await c.eval(`(() => {
        const prof = JSON.parse(localStorage.getItem('u:__guest__:wasteland_profile') || 'null');
        const char = JSON.parse(localStorage.getItem('u:__guest__:wasteland_character_测试员') || 'null');
        const world = JSON.parse(localStorage.getItem('u:__guest__:wasteland_world_20260802') || 'null');
        const chars = JSON.parse(localStorage.getItem('u:__guest__:wasteland_characters') || 'null');
        return {
            prof: prof ? prof.characterName + '@' + prof.worldSeed : null,
            charHp: char ? char.hp : null,
            worldSeed: world ? world.seed : null,
            chars: chars ? chars.names.join(',') : null,
        };
    })()`);
    console.log('导入后恢复:', JSON.stringify(restored));
    const okImport = restored.prof === '测试员@20260802' && restored.charHp === 88 && restored.worldSeed === 20260802 && restored.chars === '测试员';
    console.log(okImport ? '=== A 存档导出/导入验证通过 ===' : '=== FAIL: 恢复不一致 ===');

    // 异常检查
    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('  EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));

    process.exit(okExport && okImport && exc.length === 0 ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
