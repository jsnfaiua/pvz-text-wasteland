// 打印 sprite-back.png 原图若干不透明像素，确认头部颜色
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
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        const d = id.data;
        // 找 bbox
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<img.height;y++) for (let x=0;x<img.width;x++) {
            const a = d[(y*img.width+x)*4+3];
            if (a>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        // 打印 bbox 内顶部区域每个不透明像素的原色（全宽扫描）
        const samples = [];
        for (let y = mny; y < mny + 30 && y <= mxy; y++) {
            for (let x = mnx; x <= mxx; x++) {
                const i = (y*img.width + x)*4;
                if (d[i+3] < 40) continue;
                samples.push({ x: x-mnx, y: y-mny, r: d[i], g: d[i+1], b: d[i+2] });
            }
        }
        return { bbox: [mnx, mny, mxx, mxy], count: samples.length, samples };
    })()`;
    const r = await c.eval(DUMP, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log('bbox:', r.bbox.join(','), '顶部30行不透明像素:', r.count);
    // 按 y 分行
    let curY = -1, line = '';
    for (const p of r.samples) {
        if (p.y !== curY) { if (line) console.log('y' + String(curY).padStart(2) + ': ' + line); curY = p.y; line = ''; }
        line += p.r + p.g + p.b < 90 ? 'B' : (p.r > p.g + 20 && p.r > p.b + 20 ? 'H' : (p.g > p.r + 20 && p.g > p.b + 20 ? 'G' : (p.b > p.r + 20 && p.b > p.g + 20 ? 'U' : '?')));
    }
    if (line) console.log('y' + String(curY).padStart(2) + ': ' + line);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
