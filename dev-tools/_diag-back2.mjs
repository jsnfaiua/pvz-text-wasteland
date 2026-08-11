// 诊断朝北(back)玩家所有像素分类：对比 MC_PAL，找 tint 后异常色块
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
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
    await c.send('Runtime.enable');
    await sleep(500);
    // 清 tint 缓存 + reload 强制新代码
    await c.send('Page.reload', { ignoreCache: true });
    await sleep(2500);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js?v=' + Date.now()); window.__sv=m; m.enterWasteland({}); return 'ok'; })()`, true);
    await sleep(3000);
    // 设朝北待机
    await c.eval(`(() => { const sv = window.__sv.debugGetSv(); if (sv) { sv.faceX = 0; sv.faceY = -1; sv.animMoving = false; } return 'ok'; })()`);
    await sleep(300);
    // dump 玩家本体所有非透明像素
    const DUMP = `(async () => {
        const sv = window.__sv.debugGetSv();
        if (!sv || !sv.ctx) return { err: 'no sv' };
        const src = sv.ctx.canvas;
        const W = src.width, H = src.height;
        const px = Math.round(W / 2), py = Math.round(H / 2 + (sv.jumpOffset || 0));
        const x0 = Math.max(0, px - 14), y0 = Math.max(0, py - 18);
        const id = sv.ctx.getImageData(x0, y0, 28, 33);
        const d = id.data;
        const pxls = [];
        for (let y = 0; y < 33; y++) for (let x = 0; x < 28; x++) {
            const i = (y * 28 + x) * 4;
            const a = d[i + 3];
            if (a === 0) continue;
            pxls.push({ x, y, r: d[i], g: d[i+1], b: d[i+2], a });
        }
        return { pxls };
    })()`;
    const r = await c.eval(DUMP, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    const pxls = r.pxls;
    console.log('玩家不透明像素数:', pxls.length);
    // 按颜色聚类：分组统计，找出数量不多但颜色"孤立"的（可能是杂色）
    const keyOf = p => `${p.r},${p.g},${p.b}`;
    const groups = {};
    for (const p of pxls) {
        const k = keyOf(p);
        if (!groups[k]) groups[k] = [];
        groups[k].push(p);
    }
    // 输出所有颜色分组（数量排序）
    const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    console.log('=== 颜色分组（前25组）===');
    entries.slice(0, 25).forEach(([k, arr]) => {
        console.log(`  rgb(${k}) x${arr.length}  e.g.(${arr[0].x},${arr[0].y})`);
    });
    console.log('=== 头部区域(y<10)所有像素（按行展示色块）===');
    for (let y = 0; y < 10; y++) {
        let line = `y${String(y).padStart(2,' ')}: `;
        for (let x = 0; x < 28; x++) {
            const p = pxls.find(q => q.x === x && q.y === y);
            if (!p) line += '..';
            else line += p.r + p.g + p.b < 90 ? 'B' : (p.r > p.b + 30 ? 'H' : (p.g > p.r + 20 ? 'G' : (p.b > p.r + 20 ? 'U' : '?')));
        }
        console.log(line);
    }
    console.log('=== 脖子区域(y10-16)所有像素 ===');
    for (let y = 10; y < 17; y++) {
        let line = `y${String(y).padStart(2,' ')}: `;
        for (let x = 0; x < 28; x++) {
            const p = pxls.find(q => q.x === x && q.y === y);
            if (!p) line += '..';
            else line += p.r + p.g + p.b < 90 ? 'B' : (p.r > p.b + 30 ? 'H' : (p.g > p.r + 20 ? 'G' : (p.b > p.r + 20 ? 'U' : '?')));
        }
        console.log(line);
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
