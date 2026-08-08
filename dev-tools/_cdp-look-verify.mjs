// ============================================================
// 捏脸/人物形象优化实测：基于 sv.ctx.canvas.toDataURL() 截图（精确到游戏画布）
// 抓取玩家本体像素（28×33 → 8x 放大拼接）
// 前置：node server.js + headless Chrome(:9222)
// ============================================================
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
const OUT = 'dev-tools/_cdp-look2';

async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
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
        if (r.exceptionDetails) return { err: r.exceptionDetails.text + ' | ' + (r.exceptionDetails.exception?.description||'') };
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
            if (performance.now() - t0 < secs * 1000) requestAnimationFrame(cb)
            else res({ fps: Math.round(n / secs), long, maxGap: Math.round(maxGap) });
        };
        requestAnimationFrame(cb);
    });
})()`;

// 提取玩家本体 28×33 区域，按玩家坐标 -12,-17 到 +15,+15 截取，再放大 8 倍贴到黑底画布上方便人眼审阅。
// 并附带回退：从 sv.ctx.canvas 截整张画布（保留局内氛围）。
const SHOT_PLAYER = `(async () => {
    const sv = window.__sv.debugGetSv();
    if (!sv || !sv.ctx || !sv.ctx.canvas) return null;
    const src = sv.ctx.canvas;
    const ctx = sv.ctx;
    // 玩家屏幕坐标（camX/camY 是 ctx translate 后的偏移；从主循环传入 drawPlayer）
    const camX = sv.camX || 0, camY = sv.camY || 0;
    const px = Math.round(sv.px - camX), py = Math.round(sv.py - (sv.jumpOffset || 0) - camY);
    const x0 = Math.max(0, px - 14), y0 = Math.max(0, py - 18);
    const w = Math.min(28, src.width - x0), h = Math.min(33, src.height - y0);
    const whole = src.toDataURL('image/png').slice(22);
    // 8x 放大玩家本体到独立 canvas（人眼审阅用）
    const zoom = 8;
    const big = document.createElement('canvas');
    big.width = 28 * zoom; big.height = 33 * zoom;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    // 从源画布直接 drawImage 区域：仅当玩家在画面内时有效
    if (px - 12 >= 0 && py - 17 >= 0 && px + 16 <= src.width && py + 16 <= src.height) {
        bctx.drawImage(src, px - 12, py - 17, 28, 33, 0, 0, 28 * zoom, 33 * zoom);
    } else {
        bctx.fillStyle = '#000';
        bctx.fillRect(0, 0, 28 * zoom, 33 * zoom);
    }
    return { zoom: big.toDataURL('image/png').slice(22), whole };
})()`;

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable'); await c.send('Console.enable');
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
    console.log('enter:', await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__sv=m; m.enterWasteland({}); return 'ok'; })()`, true));
    await sleep(3000);
    // 确认 sv 激活
    const check = await c.eval(`(() => { const sv = window.__sv.debugGetSv(); return sv && sv.ctx && sv.character ? 'ok' : 'no-sv'; })()`);
    console.log('sv 状态:', check);
    if (check !== 'ok') { console.error('enterWasteland 后 sv 未就绪'); process.exit(1); }

    const shot = async (name) => {
        const r = await c.eval(SHOT_PLAYER, true);
        if (!r || r.err) { console.log('截图失败:', name, r && r.err); return; }
        if (r.zoom) fs.writeFileSync(`${OUT}-zoom-${name}.png`, Buffer.from(r.zoom, 'base64'));
        if (r.whole) fs.writeFileSync(`${OUT}-whole-${name}.png`, Buffer.from(r.whole, 'base64'));
        console.log('截图:', name);
    };
    const setHair = async (n) => {
        await c.eval(`(() => { const sv = window.__sv.debugGetSv(); if (sv) sv.character.hairStyle = ${n}; return sv ? 'ok' : 'no-sv'; })()`);
        await sleep(500);
    };

    // 站立 × 3 发型
    for (const h of [0, 1, 2]) { await setHair(h); await shot(`stand-h${h}`); }

    // 行走：模拟持方向键，多抓几帧
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(500);
    await shot('walk-a'); await sleep(170);
    await shot('walk-b'); await sleep(170);
    await shot('walk-c');
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(300);

    // 奔跑
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(500);
    await shot('run-a'); await sleep(170);
    await shot('run-b');
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true })); })()`);
    await sleep(300);

    // 挥击
    await c.eval(`(() => { const sv = window.__sv.debugGetSv(); if (sv) { sv.swingT = 0.20; sv.swingDir = 0.3; } return 'ok'; })()`);
    await sleep(140);
    await shot('atk');
    await c.eval(`(() => { const sv = window.__sv.debugGetSv(); if (sv) sv.swingT = 0; return 'ok'; })()`);
    await sleep(400);

    // 捏脸界面截图（用 Page 截全屏，看到的就是面板本身）
    await setHair(0);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/wlook.js'); window.__w=m; m.showLookCreator(()=>{}); return 'ok'; })()`, true);
    await sleep(900);
    const pageShot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}-page-creator.png`, Buffer.from(pageShot.data, 'base64'));
    console.log('截图: page-creator');

    // 切换发型 + 截图
    await c.eval(`(() => { document.querySelector('.wsl-look-hair[data-hair="1"]').click(); return 'ok'; })()`);
    await sleep(400);
    await c.eval(`(() => { document.querySelector('.wsl-look-hair[data-hair="2"]').click(); return 'ok'; })()`);
    await sleep(400);
    const pageShot2 = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}-page-tails.png`, Buffer.from(pageShot2.data, 'base64'));
    console.log('截图: page-tails');

    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return 'ok'; })()`);
    await sleep(400);

    // FPS：捏脸界面打开时
    await c.eval(`window.__w.showLookCreator(()=>{})`, true);
    await sleep(700);
    console.log('捏脸界面 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    const errs = c.eventsOf('Runtime.exceptionThrown').map(e => e.params.exceptionDetails?.text).filter(Boolean);
    console.log('=== 完成，运行时异常:', errs.length ? errs : '无', '===');
    process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });