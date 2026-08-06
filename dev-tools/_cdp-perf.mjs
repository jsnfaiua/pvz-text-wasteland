// ============================================================
// CDP 性能验证 v2：步行 FPS → 手动驾驶 FPS → NPC 驾驶(坐车) FPS → 僵尸压力 FPS
// 前置：node server.js + headless Chrome(:9222)；node dev-tools/_cdp-perf.mjs
// ============================================================
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';

async function getJson(path) { return (await fetch(CDP_URL + path)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
    static async connect(url) {
        const ws = new WebSocket(url);
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
    clearEvents() { this.events.length = 0; }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
        return r.result && r.result.value;
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FPS_PROBE = `(async () => {
    const secs = 1.5;
    return await new Promise(res => {
        let n = 0, long = 0, last = 0, maxGap = 0;
        const t0 = performance.now();
        const cb = (t) => {
            if (last) { const gap = t - last; if (gap > 25) long++; if (gap > maxGap) maxGap = gap; }
            last = t; n++;
            if (performance.now() - t0 < secs * 1000) requestAnimationFrame(cb);
            else res({ fps: Math.round(n / secs), long, maxGap: Math.round(maxGap) });
        };
        requestAnimationFrame(cb);
    });
})()`;

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');
    await c.send('Console.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(6000);
    c.clearEvents();

    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' } };
    // 清掉历史世界档（防跨运行累积存档污染状态，保证每次全新开局）
    await c.eval(`localStorage.removeItem('u:__guest__:wasteland_world_20260802'); localStorage.removeItem('u:__guest__:wasteland_profile'); localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);

    const r = await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'ok'; })()`, true);
    console.log('进入游戏:', r);
    await sleep(2500);

    console.log('站立 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    // 步行
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(300);
    console.log('步行 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(300);

    // 手动驾驶：用测试钩子拿 sv，放车 + startDrive + 按住 W
    const drv2 = await c.eval(`(async () => {
        const mod = window.__surv;
        const sv = mod.debugGetSv();
        if (!sv) return 'no sv';
        const world = await import('./source-code/mod-wasteland/world.js');
        const wv = await import('./source-code/mod-wasteland/wvehicle.js');
        const gx = Math.floor(sv.px / 36), gy = Math.floor(sv.py / 36);
        const key = gx + ',' + gy;
        sv.mods.tiles[key] = { t: world.T.CAR, cond: 'intact', repaired: true, owner: '测试', dir: 0 };
        const ok = wv.startDrive(sv, key, null);
        if (!ok) return 'startDrive fail';
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
        return 'driving=' + !!sv.driving + ' key=' + key;
    })()`, true);
    console.log('手动驾驶启动:', drv2);
    await sleep(500);
    console.log('手动驾驶 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true })); })()`);

    // NPC 驾驶（坐车）：让 NPC 当司机，目标是近处营地（几秒内到达 → 走完停车/下车全流程）
    const npc = await c.eval(`(async () => {
        const mod = window.__surv;
        const sv = mod.debugGetSv();
        if (!sv) return 'no sv';
        const wnpc = await import('./source-code/mod-wasteland/wnpc.js');
        const world = await import('./source-code/mod-wasteland/world.js');
        // 退出玩家驾驶，放回车，再让 NPC 驾驶
        if (sv.driving) { sv.driving = null; sv.driveOrder = null; sv._chauffeured = false; }
        const gx = Math.floor(sv.px / 36), gy = Math.floor(sv.py / 36);
        const key = gx + ',' + gy;
        sv.mods.tiles[key] = { t: world.T.CAR, cond: 'intact', repaired: true, owner: '阿远', dir: 0 };
        // 营地放玩家东南 6 格（近目标：快速到达 → 触发停车/下车崩溃路径）
        sv.camp = { x: sv.px + 6 * 36, y: sv.py + 6 * 36 };
        if (!sv.npcs) sv.npcs = [];
        const driver = wnpc.makeNpc(sv, sv.px, sv.py, 'friendly', { name: '阿远', party: true, id: 'npcT' + Date.now() });
        sv.npcs.push(driver);
        const ok = wnpc.startDriveOrder(sv, driver, 'camp');
        return ok ? 'chauffeur=' + !!sv.driveOrder + ' key=' + key : 'startDriveOrder fail';
    })()`, true);
    console.log('NPC 驾驶启动:', npc);
    await sleep(6000);   // 等订单完成（到达营地 → 停车 → 乘客下车）
    console.log('NPC 订单完成(下车后) FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));
    // 再测行驶中：长距离自由探索（持续驾驶期间 FPS）
    const npc2 = await c.eval(`(async () => {
        const mod = window.__surv;
        const sv = mod.debugGetSv();
        if (!sv) return 'no sv';
        const wnpc = await import('./source-code/mod-wasteland/wnpc.js');
        const world = await import('./source-code/mod-wasteland/world.js');
        if (sv.driving) { sv.driving = null; sv.driveOrder = null; sv._chauffeured = false; }
        const gx = Math.floor(sv.px / 36), gy = Math.floor(sv.py / 36);
        const key = gx + ',' + gy;
        sv.mods.tiles[key] = { t: world.T.CAR, cond: 'intact', repaired: true, owner: '阿远', dir: 0 };
        if (!sv.npcs) sv.npcs = [];
        const driver = wnpc.makeNpc(sv, sv.px, sv.py, 'friendly', { name: '阿远', party: true, id: 'npcT' + Date.now() });
        sv.npcs.push(driver);
        const ok = wnpc.startDriveOrder(sv, driver, 'free');
        return ok ? 'chauffeur2=' + !!sv.driveOrder : 'fail';
    })()`, true);
    console.log('NPC 长途驾驶启动:', npc2);
    await sleep(800);
    console.log('NPC 长途驾驶(坐车) FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    // 僵尸压力：往玩家周围刷 40 只
    const zpush = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        const mod = window.__surv;
        const z = { id: 'z' + (sv._zIdSeq = (sv._zIdSeq || 0) + 1), type: 'normal', char: '僵', color: '#7fb39a', x: sv.px + 200, y: sv.py, name: '僵尸', hp: 100, maxHp: 100, speed: 40, damage: 8, wt: 0, tx: sv.px, ty: sv.py, wDir: null, biteT: 0, hurt: 0, stunT: 0, biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0, horde: false, auraT: 0 };
        for (let i = 0; i < 40; i++) { const zz = { ...z, id: 'z' + (sv._zIdSeq = (sv._zIdSeq || 0) + 1), x: sv.px + 150 + (i % 8) * 30, y: sv.py - 100 + Math.floor(i / 8) * 30, hp: 60 + i, wDir: Math.random() * 6 }; sv.zombies.push(zz); }
        sv._zombiePathNeedsRebuild = true;
        return 'zombies=' + sv.zombies.length;
    })()`);
    console.log('僵尸压力:', zpush);
    await sleep(500);
    console.log('40僵尸+驾驶 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    const exceptions = c.eventsOf('Runtime.exceptionThrown');
    const consoleErrs = c.eventsOf('Runtime.consoleAPICalled').filter(e => e.params.type === 'error');
    console.log('异常:', exceptions.length ? exceptions.map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).join(' | ').slice(0, 500) : '无');
    console.log('console.error:', consoleErrs.length ? consoleErrs.map(e => e.params.args.map(a => a.value || a.description).join(' ')).join(' | ').slice(0, 500) : '无');

    const canvas = await c.eval(`(() => { const cv = document.getElementById('game'); if (!cv) return 'no canvas'; const ctx = cv.getContext('2d'); const d = ctx.getImageData(0,0,cv.width,cv.height).data; let n=0; for(let i=0;i<d.length;i+=4){ if(d[i]+d[i+1]+d[i+2]>30) n++; } return { w: cv.width, h: cv.height, ratio: (n/(d.length/4)).toFixed(3) }; })()`);
    console.log('画布:', JSON.stringify(canvas));

    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    if (shot.data) { fs.writeFileSync('dev-tools/_cdp-perf.png', Buffer.from(shot.data, 'base64')); console.log('截图: dev-tools/_cdp-perf.png'); }
    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
