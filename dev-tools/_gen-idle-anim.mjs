// 生成 4 帧待机动画：上半身像素浮动（+1/0/-1/0），腿固定，深灰背景，画框不动
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
    const analyze = (img) => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const d = cc.getImageData(0, 0, c.width, c.height);
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
            if (d.data[(y*c.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        return { d, W: c.width, H: c.height, mnx, mny, mxx, mxy, bw: mxx-mnx+1, bh: mxy-mny+1 };
    };
    const genFrames = (info, pad) => {
        // 画布 = bbox + 边距
        const W = info.bw + pad*2, H = info.bh + pad*2;
        const offsets = [1, 0, -1, 0];   // 上半身 y 浮动（循环无缝）
        const frames = [];
        const splitY = 0.72;   // 上半身 = bbox 上部 72%（头+躯干+臂），腿 = 底部 28%
        const legTop = info.mny + Math.floor(info.bh * splitY);
        for (let oi = 0; oi < 4; oi++) {
            const o = offsets[oi];
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            const cc = cv.getContext('2d');
            // 深灰背景
            cc.fillStyle = '#20242c';
            cc.fillRect(0, 0, W, H);
            cc.imageSmoothingEnabled = false;
            // 先画腿（下半身固定）
            const legH = info.mxy - legTop + 1;
            cc.drawImage(info.c, info.mnx, legTop, info.bw, legH, pad, pad + info.bh - legH, info.bw, legH);
            // 再画上半身（y 浮动 o）
            const upperH = legTop - info.mny;
            cc.drawImage(info.c, info.mnx, info.mny, info.bw, upperH, pad, pad + o, info.bw, upperH);
            frames.push({ o, b64: cv.toDataURL('image/png').split(',')[1], W, H });
        }
        return frames;
    };
    const out = {};
    for (const dir of ['side', 'front', 'back']) {
        const img = await load(B64[dir]);
        // 需要 info 含 c（canvas 引用），重建
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const info0 = analyze(img);
        info0.c = c;
        const frames = genFrames(info0, 12);
        out[dir] = frames;
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
if (r.error || !r.result.value) { console.log('ERR:', JSON.stringify(r.error || r.result)); process.exit(1); }
const res = JSON.parse(r.result.value);
const fs2 = await import('fs');
const outDir = 'dev-tools/_qa_tmp';
fs2.mkdirSync(outDir, { recursive: true });
for (const dir in res) {
    for (let i = 0; i < res[dir].length; i++) {
        fs2.writeFileSync(outDir + '/idle-anim-' + dir + '-' + i + '.png', Buffer.from(res[dir][i].b64, 'base64'));
    }
    console.log(dir, '→ 4 帧待机动画生成（浮动偏移', res[dir].map(f => f.o).join(','), '）画布', res[dir][0].W + 'x' + res[dir][0].H);
}
process.exit(0);