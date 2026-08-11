// 检测 未标题-1.png 角色 bbox 比例
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const b64 = fs.readFileSync('C:/Users/24601/Desktop/未标题-1.png').toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const b64 = ${JSON.stringify(b64)};
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
    for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
        if (d[(y*c.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
    }
    const bw = mxx-mnx+1, bh = mxy-mny+1;
    return JSON.stringify({ canvas: img.width+'x'+img.height, bbox: bw+'x'+bh+' ratio '+(bw/bh).toFixed(2), renderedW48: Math.round(bw * 48 / bh) });
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);