// 诊断朝北(back)玩家头部/脖子杂色：设置 faceY=-1 后截图并 dump 像素
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

const BASE = { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c', hairStyle: 0 };

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await sleep(500);
    // 设置朝北
    await c.eval(`(() => { const sv = window.__sv.debugGetSv(); if (sv) { sv.faceX = 0; sv.faceY = -1; sv.animMoving = false; } return 'ok'; })()`);
    await sleep(300);
    // 截图
    const pageShot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('dev-tools/_diag-back-screen.png', Buffer.from(pageShot.data, 'base64'));
    console.log('截图已存: _diag-back-screen.png');
    // dump 玩家本体像素（canvas 中心）
    const DUMP = `(async () => {
        const sv = window.__sv.debugGetSv();
        if (!sv || !sv.ctx) return { err: 'no sv' };
        const src = sv.ctx.canvas;
        const W = src.width, H = src.height;
        const px = Math.round(W / 2), py = Math.round(H / 2 + (sv.jumpOffset || 0));
        const x0 = Math.max(0, px - 14), y0 = Math.max(0, py - 18);
        const id = sv.ctx.getImageData(x0, y0, 28, 33);
        const d = id.data;
        const headBlack = [], neckBlack = [], allBlack = [];
        for (let y = 0; y < 33; y++) for (let x = 0; x < 28; x++) {
            const i = (y * 28 + x) * 4;
            const a = d[i + 3], r = d[i], g = d[i + 1], b = d[i + 2];
            if (a === 0) continue;
            const e = { x, y, r, g, b };
            if ((r + g + b) < 60) {
                allBlack.push(e);
                if (y < 10) headBlack.push(e); else if (y < 16) neckBlack.push(e);
            }
        }
        return { x0, y0, headBlack, neckBlack, allBlack };
    })()`;
    const r = await c.eval(DUMP, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log(`截取(${r.x0},${r.y0})`);
    console.log(`头部(y<10)黑色像素 ${r.headBlack.length}:`);
    r.headBlack.forEach(p => console.log(`  (${p.x},${p.y}) rgb(${p.r},${p.g},${p.b})`));
    console.log(`脖子(y10-16)黑色像素 ${r.neckBlack.length}:`);
    r.neckBlack.forEach(p => console.log(`  (${p.x},${p.y}) rgb(${p.r},${p.g},${p.b})`));
    console.log(`全部黑色 ${r.allBlack.length} 个`);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
