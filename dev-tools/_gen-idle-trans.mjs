// 生成透明背景待机动画帧（游戏渲染用）：4 帧循环 sprite-{dir}-idle{0..3}.png
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
  side: fs.readFileSync(sp + 'sprite-side.png').toString('base64'),
  front: fs.readFileSync(sp + 'sprite-front.png').toString('base64'),
  back: fs.readFileSync(sp + 'sprite-back.png').toString('base64'),
};
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B64 = ${JSON.stringify(b64s)};
    const load = async (b) => { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load')); img.src = 'data:image/png;base64,' + b; }); return img; };
    const out = {};
    for (const dir of ['side', 'front', 'back']) {
        const img = await load(B64[dir]);
        const W = img.width, H = img.height;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const d = cc.getImageData(0, 0, W, H).data;
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
            if (d[(y*W+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        const bw = mxx-mnx+1, bh = mxy-mny+1;
        const splitY = 0.72;   // 上半身 72%（浮动），腿 28%（固定）
        const legTop = mny + Math.floor(bh * splitY);
        const legH = mxy - legTop + 1;
        const upperH = legTop - mny;
        // 画布 = 原画布尺寸（含原透明边，保持锚点/渲染兼容）
        const offsets = [1, 0, -1, 0];
        const frames = [];
        for (let oi = 0; oi < 4; oi++) {
            const o = offsets[oi];
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            const c2 = cv.getContext('2d');
            c2.imageSmoothingEnabled = false;
            // 腿（固定）
            c2.drawImage(c, mnx, legTop, bw, legH, mnx, legTop, bw, legH);
            // 上半身（浮动 o）
            c2.drawImage(c, mnx, mny, bw, upperH, mnx, mny + o, bw, upperH);
            frames.push(cv.toDataURL('image/png').split(',')[1]);
        }
        out[dir] = { frames, W, H };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
if (r.error || !r.result.value) { console.log('ERR:', JSON.stringify(r.error || r.result)); process.exit(1); }
const res = JSON.parse(r.result.value);
for (const dir in res) {
    for (let i = 0; i < 4; i++) {
        fs.writeFileSync(sp + 'sprite-' + dir + '-idle' + i + '.png', Buffer.from(res[dir].frames[i], 'base64'));
    }
    console.log(dir, '→ sprite-' + dir + '-idle0~3.png 生成（透明背景', res[dir].W + 'x' + res[dir].H + '）');
}
process.exit(0);