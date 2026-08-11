// 验证朝东/朝西待机 sprite-side.png 实际效果
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
const OUT = 'dev-tools/_qa_tmp/_side';

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
            else { c.events.push(msg); if (msg.method === 'Runtime.exceptionThrown') console.log('[异常]', msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text); }
        };
        return c;
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
    }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text };
        return r.result && r.result.value;
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable'); await c.send('Page.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(2000);
    await c.send('Network.clearBrowserCache');
    await c.send('Page.reload', { ignoreCache: true });
    await sleep(5000);

    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { skin: '#e0c098', hair: '#1a1a1a', shirt: '#39d98a', pants: '#4a90d9', shoes: '#ffea00', eyes: '#2c2c2c', hairStyle: 0 } };
    await c.eval(`localStorage.removeItem('u:__guest__:wasteland_world_20260802'); localStorage.removeItem('u:__guest__:wasteland_profile'); localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__sv=m; m.enterWasteland({}); return 'ok'; })()`, true);
    await sleep(2500);

    await c.eval(`(async () => {
        const sv = window.__sv.debugGetSv();
        sv.px = 220 * 32; sv.py = 220 * 32;
        sv.camX = sv.px - (sv.ctx.canvas.width >> 1);
        sv.camY = sv.py - (sv.ctx.canvas.height >> 1) + 32;
        sv.vx = 0; sv.vy = 0;
        return 'ok';
    })()`, true);
    await sleep(300);

    const SHOT = `(async () => {
        const sv = window.__sv.debugGetSv();
        if (!sv || !sv.ctx) return null;
        const src = sv.ctx.canvas;
        const camX = sv.camX || 0, camY = sv.camY || 0;
        const px = Math.round(sv.px - camX), py = Math.round(sv.py - (sv.jumpOffset || 0) - camY);
        const W = 32, H = 52;
        const x0 = px - (W >> 1), y0 = py - H;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        cx.drawImage(src, x0, y0, W, H, 0, 0, W, H);
        const Z = 6;
        const big = document.createElement('canvas');
        big.width = W * Z; big.height = H * Z;
        const bx = big.getContext('2d');
        bx.imageSmoothingEnabled = false;
        bx.drawImage(c, 0, 0, W * Z, H * Z);
        return { png: big.toDataURL('image/png').slice(22), dir: sv.dir };
    })()`;

    // 朝东站立：按 d 键后松开（保持朝东）
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(200);
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(700);
    const r1 = await c.eval(SHOT, true);
    if (r1 && r1.png) { fs.writeFileSync(`${OUT}-stand-east.png`, Buffer.from(r1.png, 'base64')); console.log('stand-east dir=', r1.dir); }

    // 朝西站立：按 a 键后松开
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true })); })()`);
    await sleep(200);
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true })); })()`);
    await sleep(700);
    const r2 = await c.eval(SHOT, true);
    if (r2 && r2.png) { fs.writeFileSync(`${OUT}-stand-west.png`, Buffer.from(r2.png, 'base64')); console.log('stand-west dir=', r2.dir); }

    process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });