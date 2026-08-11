const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
await sendMethod('Page.reload', { ignoreCache: true });
await sleep(2500);
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const R = await import('./source-code/mod-wasteland/render.js?t=${Date.now()}');
    const LOOK = { skin:'#f0c8a0', hair:'#c0392b', shirt:'#e67e22', pants:'#1a3a5c', shoes:'#5d3a1a' };
    // 用走路帧 + tint，检查尺寸
    const img = R._mcWalk.side[0];
    if (!img) return 'walk not loaded';
    const tinted = R.tintSprite(img, LOOK);
    return JSON.stringify({ orig: img.width+'x'+img.height, tinted: tinted.width+'x'+tinted.height, same: img.width===tinted.width && img.height===tinted.height });
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);
