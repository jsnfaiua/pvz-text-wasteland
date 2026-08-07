// _cdp-weather-v8.mjs — 强度切换立即生效 + 雾最远端完全白蒙验证
const CDP = 'http://127.0.0.1:9222';
(async () => {
    const tabs = await (await fetch(CDP + '/json')).json();
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0; const pend = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
    const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
    await send('Runtime.enable');

    // 1) 强度切换立即生效：rain lv0 → 测雨丝长度 → 切 lv5 → 300ms 内再测（应明显更长）
    const r = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._devGfx = 2;
        sv.t = B2.DAY_LEN * 0.5;
        sv._weather = 'rain'; sv._wxLevel = 0;
        await new Promise(r => setTimeout(r, 700));
        const measureLen = () => {
            const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
            const W = sv.ctx.canvas.width, H = sv.ctx.canvas.height;
            const colMin = new Array(W).fill(H), colMax = new Array(W).fill(-1);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                const i = (y*W+x)*4;
                if (img[i+2] > 130 && img[i+2] > img[i] + 30 && img[i+1] > 90 && img[i+1] < 200) {
                    if (y < colMin[x]) colMin[x] = y;
                    if (y > colMax[x]) colMax[x] = y;
                }
            }
            let sum = 0, n = 0;
            for (let x = 0; x < W; x++) if (colMax[x] >= 0) { sum += colMax[x] - colMin[x]; n++; }
            return n ? (sum / n) : 0;
        };
        const len0 = measureLen();
        sv._wxLevel = 5;
        await new Promise(r => setTimeout(r, 300));
        const len5 = measureLen();
        return JSON.stringify({ len0: +len0.toFixed(1), len5: +len5.toFixed(1), ratio: +(len5 / Math.max(1, len0)).toFixed(2) });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[强度切换] 雨丝长度 lv0→lv5:', r.result && r.result.value, '(期望 ratio > 1.4 = 立即变长)');

    // 2) 雾最远端完全白蒙
    const r2 = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._weather = 'fog'; sv._wxLevel = 2;
        await new Promise(r => setTimeout(r, 500));
        const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
        const W = sv.ctx.canvas.width, H = sv.ctx.canvas.height;
        const pxAt = (x, y) => { const i = (y*W+x)*4; return [img[i], img[i+1], img[i+2]]; };
        const corner = pxAt(10, 10);
        const whiteish = (c) => c[0] > 180 && c[1] > 185 && c[2] > 190;
        return JSON.stringify({ corner, cornerWhite: whiteish(corner) });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[雾最远端]', r2.result && r2.result.value, '(期望 cornerWhite=true 完全看不清)');
    process.exit(0);
})();