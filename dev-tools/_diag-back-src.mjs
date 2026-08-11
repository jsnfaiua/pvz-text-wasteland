// 分析 sprite-back.png 源图：dump 头部/脖子区域原始像素 + 按 MC_PAL 分类
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
    // 在页面里加载 back sprite 并 dump 头部区域原始像素
    const DUMP = `(async () => {
        const img = new Image();
        const base = new URL('source-code/mod-wasteland/sprites/', window.location.href).href;
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = base + 'sprite-back.png'; });
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, img.width, img.height);
        const d = id.data;
        // 找 bbox（alpha>40）
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1, anyPix=0;
        for (let y=0;y<img.height;y++) for (let x=0;x<img.width;x++) {
            const a = d[(y*img.width+x)*4+3];
            if (a>40) { anyPix++; if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        if (!anyPix) return { W: img.width, H: img.height, mnx: 0, mny: 0, rows: ['无透明像素??'], anyPix };
        const W = mxx-mnx+1, H = mxy-mny+1;
        // 头部区 = bbox 顶部 30%，脖子区 30-50%
        const rows = [];
        for (let y = 0; y < Math.min(20, H); y++) {
            let line = '';
            for (let x = 0; x < Math.min(28, W); x++) {
                const i = ((mny+y)*img.width + (mnx+x))*4;
                const a = d[i+3];
                if (a < 40) { line += '..'; continue; }
                const r=d[i],g=d[i+1],b=d[i+2];
                if (r+g+b<90) line += 'B';
                else if (r>g+20 && r>b+20) line += 'H';   // 暖棕
                else if (g>r+20 && g>b+20) line += 'G';   // 绿
                else if (b>r+20 && b>g+20) line += 'U';   // 蓝
                else if (r>180 && g>150 && b>120) line += 'S'; // 肤色亮
                else line += '?';
            }
            rows.push('y' + String(y).padStart(2,' ') + ': ' + line);
        }
        return { W, H, mnx, mny, rows, anyPix };
    })()`;
    const r = await c.eval(DUMP, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log(`sprite-back 实际尺寸/bbox: ${r.W}x${r.H} 左上(${r.mnx},${r.mny}) anyPix=${r.anyPix}`);
    console.log('=== 头部/脖子 原始像素（B=黑 H=棕 G=绿 U=蓝 S=肤色 ?=其他）===');
    r.rows.forEach(l => console.log(l));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
