// 真实页面导航验证 back 方向：截图 + dump 玩家头部像素
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
    static async connect(url) {
        const ws = new WebSocket(url);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const c = new CDPClient(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id) { const p = c.pending.get(msg.id); if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
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
    await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(2500);
    await c.send('Network.clearBrowserCache');
    await c.send('Page.reload', { ignoreCache: true });
    await sleep(4000);
    const base = { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c', hairStyle: 0 };
    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { ...base } };
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__sv=m; m.enterWasteland({}); return 'ok'; })()`, true);
    await sleep(3500);
    // 设朝北待机
    await c.eval(`(() => { const sv = window.__sv.debugGetSv(); if (sv) { sv.faceX = 0; sv.faceY = -1; sv.animMoving = false; } return 'ok'; })()`);
    await sleep(400);
    // 截图
    const pageShot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('dev-tools/_diag-back-verify.png', Buffer.from(pageShot.data, 'base64'));
    console.log('截图: _diag-back-verify.png');
    // dump 玩家头部像素
    const DUMP = `(async () => {
        const sv = window.__sv.debugGetSv();
        if (!sv || !sv.ctx) return { err: 'no sv' };
        const src = sv.ctx.canvas;
        const W = src.width, H = src.height;
        const px = Math.round(W / 2), py = Math.round(H / 2 + (sv.jumpOffset || 0));
        const x0 = Math.max(0, px - 14), y0 = Math.max(0, py - 18);
        const id = sv.ctx.getImageData(x0, y0, 28, 33);
        const d = id.data;
        const headPx = [], neckPx = [];
        for (let y = 0; y < 33; y++) for (let x = 0; x < 28; x++) {
            const i = (y*28+x)*4;
            const a = d[i+3];
            if (a === 0) continue;
            const p = { x, y, r: d[i], g: d[i+1], b: d[i+2] };
            if (y < 12) headPx.push(p); else if (y < 17) neckPx.push(p);
        }
        return { headPx, neckPx };
    })()`;
    const r = await c.eval(DUMP, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    // 头部颜色聚类
    const cl = (arr, max) => {
        const g = {};
        for (const p of arr) { const k = p.r+','+p.g+','+p.b; (g[k] = g[k] || []).push('('+p.x+','+p.y+')'); }
        return Object.entries(g).sort((a,b)=>b[1].length-a[1].length).slice(0, max).map(([k,ls])=>`rgb(${k}) x${ls.length} e.g.${ls[0]} e.g.${ls[ls.length-1]}`);
    };
    console.log('=== 头部(y<12) 颜色分组 ===');
    cl(r.headPx, 12).forEach(l => console.log('  ' + l));
    console.log('=== 脖子(y12-17) 颜色分组 ===');
    cl(r.neckPx, 12).forEach(l => console.log('  ' + l));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
