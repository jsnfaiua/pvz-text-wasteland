// 玩家主体颜色分布（确认原图颜色保留）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const b64 = fs.readFileSync('dev-tools/_qa_tmp/4f-east-f0.png').toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,${b64}'; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const W = c.width;
    const px = (x,y) => { const i=(y*W+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]]; };
    // 玩家 bbox（画面中心附近，宽松）
    const cx = W>>1, cy = c.height>>1;
    let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
    for (let y=cy-90; y<cy+60; y++) for (let x=cx-50; x<cx+50; x++) {
        const [r2,g2,b2,a]=px(x,y);
        if (a>200 && (r2>40||g2>40||b2>40)) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
    }
    // bbox 内颜色聚类
    const colors = {};
    let total = 0;
    for (let y=mny; y<=mxy; y++) for (let x=mnx; x<=mxx; x++) {
        const [r2,g2,b2,a]=px(x,y);
        if (a<200) continue;
        const key = Math.floor(r2/48)+','+Math.floor(g2/48)+','+Math.floor(b2/48);
        colors[key]=(colors[key]||0)+1;
        total++;
    }
    const top = Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,n])=>k+'='+n);
    return JSON.stringify({ bbox:[mnx,mny,mxx,mxy], total, topColors: top });
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);