// 真实页面环境：验证 back sprite tint 后后脑勺像素 + face 判定
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
    const r = await c.eval(`(async () => {
        const mod = await import('./source-code/mod-wasteland/render.js?v=' + Date.now());
        const look = { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c', hairStyle: 0 };
        // 等 sprite 加载
        await new Promise(res => setTimeout(res, 1200));
        const img = mod._mcSprites.back;
        if (!img) return { err: 'back sprite not loaded', src: (mod._mcSprites.front || {}).src };
        const tinted = mod.tintSprite(img, look);
        const ctx = tinted.getContext('2d');
        const id = ctx.getImageData(0, 0, tinted.width, tinted.height);
        const d = id.data;
        // bbox
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<tinted.height;y++) for (let x=0;x<tinted.width;x++) {
            if (d[(y*tinted.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        // 头部（bbox 顶部 10% 高度）中央 60% 宽像素
        const headH = Math.round((mxy-mny+1) * 0.10);
        const samples = [];
        for (let y = mny; y < mny + headH; y++) {
            for (let x = Math.round(mnx + (mxx-mnx)*0.3); x <= Math.round(mnx + (mxx-mnx)*0.7); x++) {
                const i = (y*tinted.width + x)*4;
                if (d[i+3] < 40) continue;
                samples.push({ r: d[i], g: d[i+1], b: d[i+2] });
            }
        }
        const g = {};
        for (const p of samples) { const k = p.r+','+p.g+','+p.b; g[k]=(g[k]||0)+1; }
        return { src: img.src, tw: tinted.width, th: tinted.height, bbox: [mnx,mny,mxx,mxy], top: Object.entries(g).sort((a,b)=>b[1]-a[1]).slice(0,8) };
    })()`, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log('back img src:', r.src);
    console.log('tinted 尺寸:', r.tw, 'x', r.th, ' bbox:', r.bbox.join(','));
    console.log('=== 后脑勺(bbox顶部10%)颜色分布 ===');
    r.top.forEach(([k, n]) => console.log(`  rgb(${k}) x${n}`));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
