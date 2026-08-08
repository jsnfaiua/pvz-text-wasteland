// 解码 walk-side-f0.png（=1.png 原图）颜色分布
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const b64 = fs.readFileSync('source-code/mod-wasteland/sprites/walk-side-f0.png').toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,${b64}'; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = {};
    let opaque = 0;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] < 200) continue;
        opaque++;
        const key = Math.floor(d[i]/48)+','+Math.floor(d[i+1]/48)+','+Math.floor(d[i+2]/48);
        colors[key]=(colors[key]||0)+1;
    }
    const top = Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,n])=>k+'='+n);
    return JSON.stringify({ size: c.width+'x'+c.height, opaque, topColors: top });
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);