// 素材修复：walk-side 4 帧从用户原图重新生成，仅头部 28% 头发重着色（修复鞋/腿部被全图重着色误改，画布保持原尺寸）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const srcMap = {
  'walk-side-f0.png': 'C:/Users/24601/Desktop/1.png',
  'walk-side-f1.png': 'C:/Users/24601/Desktop/2.png',
  'walk-side-f2.png': 'C:/Users/24601/Desktop/3.png',
  'walk-side-f3.png': 'C:/Users/24601/Desktop/4.png',
};
const b64s = {};
for (const k in srcMap) b64s[k] = fs.readFileSync(srcMap[k]).toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const TARGET_HAIR = [94, 63, 32];
    const HEAD_RATIO = 0.28;
    const SRC = ${JSON.stringify(b64s)};
    const out = {};
    for (const f in SRC) {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + SRC[f]; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, c.width, c.height);
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
        ctx.putImageData(id, 0, 0);
        out[f] = { changed, size: c.width+'x'+c.height, b64: c.toDataURL('image/png').split(',')[1] };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
const res = JSON.parse(r.result.value);
for (const f in res) {
    fs.writeFileSync('source-code/mod-wasteland/sprites/' + f, Buffer.from(res[f].b64, 'base64'));
    console.log(f, '→ 仅头部重着色', res[f].changed, '像素，画布保持', res[f].size);
}
process.exit(0);