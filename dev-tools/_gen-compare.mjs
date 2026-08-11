// 生成"待机 vs 走路"大小对比图（3 方案）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const sp = 'source-code/mod-wasteland/sprites/';
const b64s = {
  idle: fs.readFileSync(sp + 'sprite-side.png').toString('base64'),
  walk: fs.readFileSync(sp + 'walk-side-f0.png').toString('base64'),
};
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B = ${JSON.stringify(b64s)};
    const load = async (b) => { const img = new Image(); await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b; }); return img; };
    const bboxOf = (img) => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const d = cc.getImageData(0, 0, c.width, c.height).data;
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
            if (d[(y*c.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        return { mnx, mny, w: mxx-mnx+1, h: mxy-mny+1 };
    };
    const idle = await load(B.idle);
    const walk = await load(B.walk);
    const ib = bboxOf(idle), wb = bboxOf(walk);
    const out = {};
    // 方案 A：统一固定 26×48（bbox 裁剪）
    // 方案 B：现状（高度 48，宽度按画布比例）
    // 方案 C：高度 48 + 宽度按 bbox 比例
    const SCHEMES = { A: '26x48 固定', B: '现状(画布高48)', C: 'bbox高48' };
    for (const sk in SCHEMES) {
        const cv = document.createElement('canvas'); cv.width = 300; cv.height = 120;
        const cc = cv.getContext('2d');
        cc.fillStyle = '#20242c'; cc.fillRect(0, 0, 300, 120);
        cc.imageSmoothingEnabled = false;
        cc.fillStyle = '#8fd4ff'; cc.font = '10px monospace';
        cc.fillText(sk + ' ' + SCHEMES[sk], 8, 12);
        // 待机（左）+ 走路（右）并排
        const drawOne = (img, bb, x, y) => {
            let dw, dh;
            if (sk === 'A') { dw = 26; dh = 48; }
            else if (sk === 'B') { const s = 48 / img.height; dw = img.width * s; dh = 48; }
            else { const s = 48 / bb.h; dw = bb.w * s; dh = 48; }
            cc.drawImage(img, bb.mnx, bb.mny, bb.w, bb.h, x - dw/2, y - dh, dw, dh);
            cc.strokeStyle = 'rgba(255,255,255,0.4)';
            cc.strokeRect(x - dw/2 - 1, y - dh - 1, dw + 2, dh + 2);
            cc.fillStyle = '#ffd27f';
            cc.fillText(Math.round(dw) + 'x' + dh, x - dw/2, y + 6);
        };
        drawOne(idle, ib, 75, 96);
        drawOne(walk, wb, 225, 96);
        out[sk] = cv.toDataURL('image/png').split(',')[1];
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
if (r.error || !r.result.value) { console.log('ERR:', JSON.stringify(r.error || r.result)); process.exit(1); }
const res = JSON.parse(r.result.value);
const outDir = 'dev-tools/_qa_tmp';
fs.mkdirSync(outDir, { recursive: true });
for (const k in res) fs.writeFileSync(outDir + '/cmp-' + k + '.png', Buffer.from(res[k], 'base64'));
console.log('对比图生成:', Object.keys(res).join(', '));
process.exit(0);