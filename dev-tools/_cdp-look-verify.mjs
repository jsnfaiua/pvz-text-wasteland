// ============================================================
// 捏脸/人物形象优化实测：局内三发型 × 站立/行走/挥击 + 捏脸界面截图
// 前置：node server.js + headless Chrome(:9222)；node dev-tools/_cdp-look-verify.mjs
// ============================================================
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
const OUT = 'dev-tools/_cdp-look';

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
            else { c.events.push(msg); if (msg.method === 'Runtime.exceptionThrown') console.log('[实时异常]', msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text); }
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
    await sleep(2000);
    await c.send('Network.clearBrowserCache');
    await c.send('Page.reload', { ignoreCache: true });
    await sleep(6000);
    c.clearEvents();

    const base = { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' };
    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { ...base, hairStyle: 0 } };
    await c.eval(`localStorage.removeItem('u:__guest__:wasteland_world_20260802'); localStorage.removeItem('u:__guest__:wasteland_profile'); localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'ok'; })()`, true);
    await sleep(2500);

    const shot = async (name) => {
        const r = await c.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${OUT}-${name}.png`, Buffer.from(r.data, 'base64'));
        console.log('截图:', name);
    };
    const setHair = async (n) => {
        await c.eval(`(() => { const sv = window.__surv.debugGetSv(); if (sv) sv.character.hairStyle = ${n}; return sv ? 'ok' : 'no-sv'; })()`);
        await sleep(600); // 等离屏缓存按新外观重建
    };

    // 站立 × 3 发型
    for (const h of [0, 1, 2]) { await setHair(h); await shot(`stand-h${h}`); }

    // 行走（按住 d 1s，抓 3 个动画帧）
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(500);
    await shot('walk-frame1');
    await sleep(160);
    await shot('walk-frame2');
    await sleep(160);
    await shot('walk-frame3');
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(300);

    // 奔跑（shift + d）
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', bubbles: true })); })()`);
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(600);
    await shot('run-frame');
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true })); })()`);
    await sleep(300);

    // 挥击（直接注入 swingT 触发挥击姿态；spacespace 也许不是攻击键，用状态注入）
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); if (sv) sv.swingT = 0.18; return 'ok'; })()`);
    await sleep(120);
    await shot('atk');
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); if (sv) sv.swingT = 0; return 'ok'; })()`);
    await sleep(400);

    // 捏脸界面
    await setHair(0);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/wlook.js'); window.__wlook = m; m.showLookCreator(()=>{}); return 'ok'; })()`, true);
    await sleep(900);
    await shot('creator-ui');
    // 切长发 + 双马尾预览
    await c.eval(`(() => { const el = document.querySelector('.wsl-look-hair[data-hair="1"]'); if (el) el.click(); return el ? 'ok' : 'no-el'; })()`);
    await sleep(400);
    await shot('creator-long');
    await c.eval(`(() => { const el = document.querySelector('.wsl-look-hair[data-hair="2"]'); if (el) el.click(); return el ? 'ok' : 'no-el'; })()`);
    await sleep(400);
    await shot('creator-tails');
    // 随机
    await c.eval(`(() => { document.getElementById('wsl-look-random').click(); return 'ok'; })()`);
    await sleep(400);
    await shot('creator-random');
    // ESC 关闭
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return 'ok'; })()`);
    await sleep(400);

    // 捏脸界面打开时的 FPS（预览缓存化后应稳定 60）
    await c.eval(`(async()=>{ window.__wlook.showLookCreator(()=>{}); return 'ok'; })()`, true);
    await sleep(800);
    console.log('捏脸界面 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    const errs = c.eventsOf('Runtime.exceptionThrown').map(e => e.params.exceptionDetails?.text).filter(Boolean);
    const logs = c.eventsOf('Log.entryAdded').map(e => e.params.entry.text).filter(t => /error|uncaught/i.test(t));
    console.log('运行时异常:', errs.length ? errs : '无');
    console.log('错误日志:', logs.length ? logs : '无');
    console.log('=== 完成 ===');
    process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
