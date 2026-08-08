// 精确采样玩家 sprite 区域（画面中心）
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
    // 玩家脚底 = 画面中心 (480, 270)，sprite 48px 高向上
    const cx = W>>1, cy = c.height>>1;
    // 扫描玩家真实 bbox（画面中心 ±60 内，找与地面颜色差异大的像素）
    // 地面深灰 ~(28,29,38)。玩家应明显不同
    let pts = [];
    for (let y=cy-60; y<cy+10; y++) for (let x=cx-40; x<cx+40; x++) {
        const [r2,g2,b2,a]=px(x,y);
        if (a>200 && (Math.abs(r2-28)>15 || Math.abs(g2-29)>15 || Math.abs(b2-38)>15)) pts.push({x,y,r2,g2,b2});
    }
    if (!pts.length) return JSON.stringify({ found: false });
    const mnx=Math.min(...pts.map(p=>p.x)), mxx=Math.max(...pts.map(p=>p.x));
    const mny=Math.min(...pts.map(p=>p.y)), mxy=Math.max(...pts.map(p=>p.y));
    // 玩家区域内颜色聚类
    const colors = {};
    for (const p of pts) {
        const key = Math.floor(p.r2/48)+','+Math.floor(p.g2/48)+','+Math.floor(p.b2/48);
        colors[key]=(colors[key]||0)+1;
    }
    const top = Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,n])=>k+'='+n);
    return JSON.stringify({ found: true, n: pts.length, bbox:[mnx,mny,mxx,mxy], topColors: top });
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);