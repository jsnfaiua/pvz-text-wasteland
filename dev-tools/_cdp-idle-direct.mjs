// 直接 import 强制新模块 + 渲染测试
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
await sendMethod('Page.reload', { ignoreCache: true });
await sleep(2500);

const res = [];
for (let i = 0; i < 6; i++) {
    const t = Date.now();
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const R = await import('./source-code/mod-wasteland/render.js?t=' + ${t});
        const cv = document.createElement('canvas'); cv.width = 120; cv.height = 140;
        const c = cv.getContext('2d');
        c.fillStyle = '#20242c'; c.fillRect(0, 0, 120, 140);
        R.drawPixelPlayerBody(c, 60, 110, '#39d98a', 0, null, {dir:'right', frame:0, moving:false});
        return cv.toDataURL('image/png');
    })()`, awaitPromise: true, returnByValue: true });
    const png = r2.result.value;
    if (!png) { res.push('FAIL'); continue; }
    const b64 = png.split(',')[1];
    const r4 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const b64 = ${JSON.stringify(b64)};
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const cx = c.width >> 1;
        let topY = -1;
        for (let y = 0; y < c.height; y++) {
            const i = (y*c.width+cx)*4;
            if (d[i+3] > 150 && d[i] < 100 && d[i+1] < 80 && d[i+2] < 60) { topY = y; break; }
        }
        return topY;
    })()`, awaitPromise: true, returnByValue: true });
    res.push(r4.result.value);
    await sleep(130);
}
console.log('直接渲染 6 次头发 y:', JSON.stringify(res));
process.exit(0);