// 直接验证 back sprite tint 后的后脑勺像素颜色 + 判定部位
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
    const base = 'C:/Users/24601/Desktop/文字植物大战僵尸-优化版(1)(1)/文字植物大战僵尸-优化版(1)/source-code/mod-wasteland/sprites/';
    const b64 = fs.readFileSync(base + 'sprite-back.png').toString('base64');
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await sleep(300);
    const DUMP = `(async () => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${b64}'; });
        const mod = await import('./source-code/mod-wasteland/render.js?v=' + Date.now());
        const look = { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c', hairStyle: 0 };
        const tinted = mod.tintSprite(img, look);
        const ctx = tinted.getContext('2d');
        const id = ctx.getImageData(0, 0, tinted.width, tinted.height);
        const d = id.data;
        // bbox
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<tinted.height;y++) for (let x=0;x<tinted.width;x++) {
            if (d[(y*tinted.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        // tinted 后头部（顶部 8 行）中央区域像素
        const samples = [];
        for (let y = mny; y < mny + 8 && y < tinted.height; y++) {
            for (let x = Math.floor(mnx + (mxx-mnx)*0.35); x < Math.floor(mnx + (mxx-mnx)*0.65); x++) {
                const i = (y*tinted.width + x)*4;
                if (d[i+3] < 40) continue;
                samples.push({ x: x-mnx, y: y-mny, r: d[i], g: d[i+1], b: d[i+2] });
            }
        }
        return { tw: tinted.width, th: tinted.height, bbox: [mnx,mny,mxx,mxy], samples };
    })()`;
    const r = await c.eval(DUMP, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log(`tinted back: ${r.tw}x${r.th} bbox(${r.bbox.join(',')})`);
    const colors = {};
    for (const p of r.samples) {
        const k = p.r+','+p.g+','+p.b;
        if (!colors[k]) colors[k] = [];
        colors[k].push('('+p.x+','+p.y+')');
    }
    Object.entries(colors).sort((a,b)=>b[1].length-a[1].length).slice(0,10).forEach(([k,arr])=>{
        console.log(`  rgb(${k}) x${arr.length} e.g.${arr[0]} e.g.${arr[arr.length-1]}`);
    });
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
