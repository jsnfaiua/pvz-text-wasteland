// 直接渲染待机帧测试 bob 变化
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');
const outDir = 'dev-tools/_qa_tmp';
fs.mkdirSync(outDir, { recursive: true });
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await sendMethod('Runtime.evaluate', { expression: `(async () => { const st = await import('./source-code/core/state.js'); st.setSaveData({ ...st.saveData, devMode: true }); const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'entered'; })()`, awaitPromise: true, returnByValue: true });
await sleep(6000);

const res = [];
for (let i = 0; i < 5; i++) {
    const t = Date.now();
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const R = await import('./source-code/mod-wasteland/render.js?t=${t}`);
        const cv = document.createElement('canvas'); cv.width = 120; cv.height = 140;
        const c = cv.getContext('2d');
        c.fillStyle = '#20242c'; c.fillRect(0, 0, 120, 140);
        const anim = { dir: 'right', frame: 0, moving: false };
        R.drawPixelPlayerBody(c, 60, 110, '#39d98a', 0, null, anim);
        return cv.toDataURL('image/png');
    })()`, awaitPromise: true, returnByValue: true });
    const png = r2.result.value;
    if (!png) { res.push('FAIL'); continue; }
    fs.writeFileSync(outDir + '/idle-direct-' + i + '.png', Buffer.from(png.split(',')[1], 'base64'));
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
            if (d[i+3] > 150 && d[i] < 100 && d[i+1] < 80) { topY = y; break; }
        }
        return topY;
    })()`, awaitPromise: true, returnByValue: true });
    res.push(r4.result.value);
    await sleep(120);
}
console.log('直接渲染待机 5 次头发顶 y:', JSON.stringify(res));
process.exit(0);