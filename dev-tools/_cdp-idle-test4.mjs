// 采样玩家实际位置（cx≈720）列的头发顶 y
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
await sendMethod('Page.reload', { ignoreCache: true });
await sleep(2500);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await sendMethod('Runtime.evaluate', { expression: `(async () => { const st = await import('./source-code/core/state.js'); st.setSaveData({ ...st.saveData, devMode: true }); const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'entered'; })()`, awaitPromise: true, returnByValue: true });
await sleep(6000);
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 500; sv.py = 500; sv.faceX = 1; sv.faceY = 0; sv.animMoving = false; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

// 在 ±30 px 范围内搜索玩家角色列（找头发列）
const samples = [];
for (let i = 0; i < 6; i++) {
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    const b64 = s.result.value;
    if (!b64) continue;
    fs.writeFileSync(outDir + '/idle-live2-' + i + '.png', Buffer.from(b64, 'base64'));
    const r4 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const b64 = ${JSON.stringify(b64)};
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        // 扫描画面下半部分（cy+100 到 cy+400），找棕色头发的列
        const yTop = c.height/2 + 100, yBot = c.height - 50;
        let bestX = -1, bestY = -1;
        for (let y = yTop; y < yBot; y++) {
            for (let x = 0; x < c.width; x++) {
                const i = (y*c.width+x)*4;
                if (d[i+3] > 150 && d[i] < 100 && d[i+1] < 80 && d[i+2] < 60) {
                    if (bestX === -1 || y < bestY) { bestX = x; bestY = y; }
                    break;
                }
            }
            if (bestX !== -1 && y > bestY + 60) break;
        }
        return JSON.stringify({ hairX: bestX, hairY: bestY });
    })()`, awaitPromise: true, returnByValue: true });
    samples.push(r4.result.value);
    await sleep(130);
}
console.log('玩家头发位置（6 次采样）:', samples);
process.exit(0);