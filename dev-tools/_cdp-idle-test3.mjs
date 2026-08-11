// 强制 reload 验证待机动画（破 ES module 缓存）
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
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 300; sv.py = 300; sv.faceX = 1; sv.faceY = 0; sv.animMoving = false; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

const res = [];
for (let i = 0; i < 6; i++) {
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    const b64 = s.result.value;
    if (b64) {
        fs.writeFileSync(outDir + '/idle-live-' + i + '.png', Buffer.from(b64, 'base64'));
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
    } else res.push('FAIL');
    await sleep(120);
}
console.log('待机实时采样头发顶 y:', JSON.stringify(res));
process.exit(0);