// 对当前 walk-side（已对齐 405x632）仅头部 28% 重着色（统一发色，保持画布尺寸）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const sp = 'source-code/mod-wasteland/sprites/';
const b64s = {};
for (let i = 0; i < 4; i++) b64s[i] = fs.readFileSync(sp + 'walk-side-f' + i + '.png').toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B64 = ${JSON.stringify(b64s)};
    const TARGET_HAIR = [94, 63, 32];
    const HEAD_RATIO = 0.28;
    const out = {};
    for (const k in B64) {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load')); img.src = 'data:image/png;base64,' + B64[k]; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const id = cc.getImageData(0, 0, c.width, c.height);
        const d = id.data;
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
            if (d[(y*c.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        const headBot = mny + Math.floor((mxy-mny)*HEAD_RATIO);
        let changed = 0;
        for (let y=mny; y<headBot; y++) for (let x=mnx; x<=mxx; x++) {
            const i=(y*c.width+x)*4;
            if (d[i+3]<100) continue;
            const rr=d[i], gg=d[i+1], bb=d[i+2];
            if (rr>=95 && rr<=200 && gg>=50 && gg<=135 && bb>=12 && bb<=95 && rr>gg && gg>bb) {
                d[i]=TARGET_HAIR[0]; d[i+1]=TARGET_HAIR[1]; d[i+2]=TARGET_HAIR[2]; changed++;
            }
        }
        cc.putImageData(id, 0, 0);
        out[k] = { changed, size: c.width+'x'+c.height, b64: c.toDataURL('image/png').split(',')[1] };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
const res = JSON.parse(r.result.value);
for (const k in res) {
    fs.writeFileSync(sp + 'walk-side-f' + k + '.png', Buffer.from(res[k].b64, 'base64'));
    console.log('walk-side-f' + k + '.png → 头部重着色', res[k].changed, '像素，画布', res[k].size);
}
process.exit(0);