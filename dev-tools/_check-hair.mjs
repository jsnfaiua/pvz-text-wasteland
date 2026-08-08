// 对比 front/back/side 各 sprite 的头发颜色
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const files = {
  'front-idle': 'source-code/mod-wasteland/sprites/sprite-front.png',
  'front-walk': 'source-code/mod-wasteland/sprites/walk-front-f2.png',
  'back-idle': 'source-code/mod-wasteland/sprites/sprite-back.png',
  'back-walk': 'source-code/mod-wasteland/sprites/walk-back-f0.png',
  'side-walk-f0': 'source-code/mod-wasteland/sprites/walk-side-f0.png',
  'side-walk-f1': 'source-code/mod-wasteland/sprites/walk-side-f1.png',
  'side-walk-f2': 'source-code/mod-wasteland/sprites/walk-side-f2.png',
  'side-walk-f3': 'source-code/mod-wasteland/sprites/walk-side-f3.png',
  'side-idle': 'source-code/mod-wasteland/sprites/sprite-side.png',
};
const b64s = {};
for (const k in files) { try { b64s[k] = fs.readFileSync(files[k]).toString('base64'); } catch(e) { b64s[k] = null; } }
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B64 = ${JSON.stringify(b64s)};
    const out = {};
    for (const k in B64) {
        if (!B64[k]) { out[k] = 'MISSING'; continue; }
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + B64[k]; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        // 不透明 bbox
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
            if (d[(y*c.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        // 头部 = bbox 上部 25%
        const hTop = mny, hBot = mny + Math.floor((mxy-mny)*0.25);
        // 头部颜色聚类（非肤色像素 = 头发）
        const colors = {};
        let headOpaque = 0;
        for (let y=hTop; y<hBot; y++) for (let x=mnx; x<=mxx; x++) {
            const i=(y*c.width+x)*4;
            if (d[i+3]<100) continue;
            headOpaque++;
            // 排除肤色（R>G>B 暖亮）
            const rr=d[i],gg=d[i+1],bb=d[i+2];
            if (rr>150 && gg>100 && bb>60 && rr>bb) continue;   // 肤色跳过
            const key = Math.floor(rr/32)+','+Math.floor(gg/32)+','+Math.floor(bb/32);
            colors[key]=(colors[key]||0)+1;
        }
        const top = Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,n])=>k+'='+n);
        out[k] = { size: c.width+'x'+c.height, headOpaque, topHairColors: top };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);