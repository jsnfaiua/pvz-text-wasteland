// 清理待机图孤立黑点（front/side）：孤立深色像素 → 邻域主色；保护眼睛/头发/裤缝长线
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
  front: fs.readFileSync(sp + 'sprite-front.png').toString('base64'),
  side: fs.readFileSync(sp + 'sprite-side.png').toString('base64'),
};
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B = ${JSON.stringify(b64s)};
    const out = {};
    for (const k in B) {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + B[k]; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const id = cc.getImageData(0, 0, c.width, c.height);
        const d = id.data;
        const W = c.width, H = c.height;
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
            if (d[(y*W+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        const bh = mxy-mny+1;
        const headBot = mny + Math.floor(bh * 0.30);   // 头部 30% 保护（眼睛/头发）
        const d2 = new Uint8ClampedArray(d);
        let cleaned = 0;
        for (let y=3; y<H-3; y++) for (let x=3; x<W-3; x++) {
            const i=(y*W+x)*4;
            if (d[i+3] < 220) continue;
            if (d[i]>=50 || d[i+1]>=50 || d[i+2]>=50) continue;   // 只处理深色黑点
            if (y < headBot) continue;   // 保护头部（眼睛/头发）
            // 保护纵向长线（裤缝/轮廓）：同列上下 ±6px 有 ≥8 个深色 → 长线跳过
            let colDark = 0;
            for (let oy=-6; oy<=6; oy++) {
                const ni=((y+oy)*W+x)*4;
                if (d[ni+3]>150 && d[ni]<60 && d[ni+1]<60 && d[ni+2]<60) colDark++;
            }
            if (colDark >= 8) continue;
            // 5×5 邻域主色
            const freq = new Map();
            let nonDark = 0, maxQ = '', maxN = 0;
            for (let dy=-2; dy<=2; dy++) for (let dx=-2; dx<=2; dx++) {
                if (dx===0 && dy===0) continue;
                const ni=((y+dy)*W+(x+dx))*4;
                if (d[ni+3] < 150) continue;
                const rr=d[ni], gg=d[ni+1], bb=d[ni+2];
                if (rr>=60 || gg>=60 || bb>=60) {   // 非深色邻居
                    nonDark++;
                    const q = Math.floor(rr/24)+','+Math.floor(gg/24)+','+Math.floor(bb/24);
                    const n = (freq.get(q)||0)+1;
                    freq.set(q, n);
                    if (n > maxN) { maxN = n; maxQ = q; }
                }
            }
            // 孤立黑点：邻域绝大多数非深色 + 主色占比高（单一色）
            if (nonDark >= 20 && maxN >= 14) {
                const [qr,qg,qb] = maxQ.split(',').map(Number);
                d2[i]=qr*24+12; d2[i+1]=qg*24+12; d2[i+2]=qb*24+12;
                cleaned++;
            }
        }
        cc.putImageData(new ImageData(d2, W, H), 0, 0);
        out[k] = { cleaned, b64: c.toDataURL('image/png').split(',')[1], W, H };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
if (r.error || !r.result.value) { console.log('ERR:', JSON.stringify(r.error || r.result)); process.exit(1); }
const res = JSON.parse(r.result.value);
for (const k in res) {
    fs.writeFileSync(sp + 'sprite-' + k + '.png', Buffer.from(res[k].b64, 'base64'));
    console.log('sprite-' + k + '.png → 清理孤立黑点', res[k].cleaned, '个');
}
process.exit(0);