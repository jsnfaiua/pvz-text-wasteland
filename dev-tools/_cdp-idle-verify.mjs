// CDP 验证：待机动画循环（10fps 4 帧，上半身浮动）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
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
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 300; sv.py = 300; sv.faceX = 1; sv.faceY = 0; sv.animMoving = false; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

// 待机连续采样 5 次（每 120ms），检测玩家头部区域 y 位置变化（上半身浮动）
const snap = async (name) => {
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (s.result.value) fs.writeFileSync(outDir + '/' + name + '.png', Buffer.from(s.result.value, 'base64'));
    return s.result.value;
};
const checkHeadY = async (b64) => {
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const b64 = ${JSON.stringify(b64 ? 'x' : 'x')};   // placeholder
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + ${JSON.stringify('')}; });
        // 直接用真实 b64
        img.src = 'data:image/png;base64,' + ${'b64'};
        await new Promise(res => { img.onload = res; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        // 玩家在画面中央，找头发（棕色）最上 y
        const cx = c.width >> 1;
        let topY = -1;
        for (let y = 0; y < c.height; y++) {
            const i = (y*c.width+cx)*4;
            if (d[i+3] > 150 && Math.abs(d[i]-94) < 40 && Math.abs(d[i+1]-63) < 40 && Math.abs(d[i+2]-32) < 40) { topY = y; break; }
        }
        return topY;
    })()`, awaitPromise: true, returnByValue: true });
    return r2.result.value;
};

const b64s = [];
for (let i = 0; i < 5; i++) {
    const b64 = await snap('idle-test-' + i);
    if (b64) b64s.push(b64);
    await sleep(120);
}
// 分析每张的头发顶 y（应为 4 帧循环：2 种 y 值交替）
const heads = [];
for (let i = 0; i < b64s.length; i++) {
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const b64 = ${JSON.stringify(b64s[i])};
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const cx = c.width >> 1;
        let topY = -1;
        for (let y = 0; y < c.height; y++) {
            const i = (y*c.width+cx)*4;
            if (d[i+3] > 150 && Math.abs(d[i]-94) < 50 && Math.abs(d[i+1]-63) < 50) { topY = y; break; }
        }
        return topY;
    })()`, awaitPromise: true, returnByValue: true });
    heads.push(r2.result.value);
}
console.log('待机 5 次采样头发顶 y:', JSON.stringify(heads), '（应交替 2-3 个值 = 上半身浮动）');
const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
console.log('异常:', exceptions.length);
process.exit(0);