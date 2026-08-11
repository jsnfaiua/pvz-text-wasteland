// 精确采样玩家附近列头发 y
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
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await sendMethod('Runtime.evaluate', { expression: `(async () => { const st = await import('./source-code/core/state.js'); st.setSaveData({ ...st.saveData, devMode: true }); const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'entered'; })()`, awaitPromise: true, returnByValue: true });
await sleep(6000);
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 500; sv.py = 500; sv.faceX = 1; sv.faceY = 0; sv.animMoving = false; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

const samples = [];
for (let i = 0; i < 6; i++) {
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    const b64 = s.result.value;
    if (!b64) continue;
    const r4 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const b64 = ${JSON.stringify(b64)};
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        // 扫描画面中下部（玩家站位）找头顶：y 最小且 r<100 g<80 b<60 的像素
        const yStart = Math.floor(c.height * 0.45), yEnd = c.height - 30;
        let bestY = -1, bestX = -1;
        // 先粗略找到玩家 x（找最长的连贯棕色列）
        const brownCount = new Uint32Array(c.width);
        for (let x = 100; x < c.width-100; x++) {
            for (let y = yStart; y < yEnd; y++) {
                const i = (y*c.width+x)*4;
                if (d[i+3] > 150 && d[i] < 100 && d[i+1] < 80 && d[i+2] < 60) brownCount[x]++;
            }
        }
        // 找峰值列
        let maxX = 0, maxV = 0;
        for (let x = 100; x < c.width-100; x++) { if (brownCount[x] > maxV) { maxV = brownCount[x]; maxX = x; } }
        if (maxV < 3) return JSON.stringify({ noPlayer: true, maxX, maxV });
        // 在 maxX±10 找 y 最小棕色像素
        const xC = maxX;
        for (let y = yStart; y < yEnd; y++) {
            let ok = false;
            for (let dx = -10; dx <= 10; dx++) {
                const i = (y*c.width+(xC+dx))*4;
                if (d[i+3] > 150 && d[i] < 100 && d[i+1] < 80 && d[i+2] < 60) { ok = true; break; }
            }
            if (ok) { bestY = y; bestX = xC; break; }
        }
        return JSON.stringify({ hairX: bestX, hairY: bestY, maxX, maxV });
    })()`, awaitPromise: true, returnByValue: true });
    samples.push(r4.result.value);
    await sleep(130);
}
console.log('玩家头发位置:', samples);
process.exit(0);