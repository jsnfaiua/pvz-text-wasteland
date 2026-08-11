// 天气 CDP 验证：强制下雨，截图 + 分析雨粒子在画布上的分布（找右侧空白）
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
    await c.send('Runtime.enable'); await c.send('Page.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(3000);
    const base = { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c', hairStyle: 0 };
    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { ...base } };
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__sv=m; m.enterWasteland({}); return 'ok'; })()`, true);
    await sleep(4000);
    // 强制雷阵雨 + 站定 + day=5（东风 seed=20260802）
    await c.eval(`(() => { const sv = window.__sv.debugGetSv(); if (sv) { sv.day=5; sv._weather='rain'; sv._wxLevel=3; sv._devWxLock=true; sv.px=0; sv.py=0; sv.animMoving=false; } return 'ok'; })()`);
    await sleep(1200);
    // 截图（直接抓游戏 canvas toDataURL，绕开首页遮罩）
    const dataUrl = await c.eval(`(() => { const sv = window.__sv.debugGetSv(); return sv && sv.ctx ? sv.ctx.canvas.toDataURL('image/png') : ''; })()`);
    if (dataUrl) {
        const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
        fs.writeFileSync('dev-tools/_diag-rain.png', buf);
        console.log('游戏 canvas 截图: _diag-rain.png');
    }
    // 分析画布雨粒子分布：按 10 列统计雨丝像素数
    const AN = `(async () => {
        const sv = window.__sv.debugGetSv();
        if (!sv || !sv.ctx) return { err: 'no sv' };
        const id = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height);
        const d = id.data, W = id.width, H = id.height;
        const cols = 12, colW = Math.floor(W / cols);
        const colCount = new Array(cols).fill(0);
        let total = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const a = d[i + 3], r = d[i], g = d[i + 1], b = d[i + 2];
            // 雨丝：偏蓝灰、半透明，非背景黑
            if (a > 20 && b > 80 && b >= r + 30 && g < b) {
                const col = Math.floor(x / colW);
                colCount[col]++;
                total++;
            }
        }
        return { W, H, colW, colCount, total };
    })()`;
    const r = await c.eval(AN, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log(`画布 ${r.W}x${r.H}，雨像素总数 ${r.total}`);
    console.log('=== 每列雨像素分布（右端应有雨）===');
    r.colCount.forEach((n, i) => {
        const bar = '#'.repeat(Math.round(n / 20));
        console.log(`  列${String(i).padStart(2)} [x${(i*r.colW)}-${(i+1)*r.colW-1}]: ${String(n).padStart(4)} ${bar}`);
    });
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
