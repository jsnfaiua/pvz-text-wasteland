// 用 base64 直接在页面内加载 sprite-back.png，dump 头部区域像素
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
        // 找真正 bbox（alpha>40）
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<img.height;y++) for (let x=0;x<img.width;x++) {
            const a = d[(y*img.width+x)*4+3];
            if (a>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        // dump bbox 顶部 30 行
        const rows = [];
        for (let y = 0; y < Math.min(30, mxy - mny + 1); y++) {
            let line = '';
            for (let x = 0; x < Math.min(40, mxx - mnx + 1); x++) {
                const i = ((mny+y)*img.width + (mnx+x))*4;
                const a = d[i+3];
                if (a < 40) { line += '..'; continue; }
                const r=d[i],g=d[i+1],b=d[i+2];
                if (r+g+b<90) line += 'B';
                else if (r>g+20 && r>b+20) line += 'H';
                else if (g>r+20 && g>b+20) line += 'G';
                else if (b>r+20 && b>g+20) line += 'U';
                else if (r>180 && g>150 && b>120) line += 'S';
                else line += '?';
            }
            rows.push('y' + String(y).padStart(2,' ') + ': ' + line);
        }
        return { W: img.width, H: img.height, mnx, mny, bw: mxx-mnx+1, bh: mxy-mny+1, rows };
    })()`;
    const r = await c.eval(DUMP, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log(`sprite-back 尺寸: ${r.W}x${r.H} bbox(${r.bw}x${r.bh} @${r.mnx},${r.mny})`);
    console.log('=== bbox 顶部 30 行 (B黑 H棕 G绿 U蓝 S肤色 ?其他) ===');
    r.rows.forEach(l => console.log(l));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
