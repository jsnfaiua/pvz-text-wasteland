// 拍待机帧（front/side/back 三个方向的待机画面）
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
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 300; sv.py = 300; sv.faceX = 1; sv.faceY = 0; sv.animMoving = false; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

const snap = async (name, fx, fy) => {
    await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.faceX = ${fx}; sv.faceY = ${fy}; sv.animMoving = false; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return '${name}'; })()` });
    await sleep(400);
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (s.result.value) { fs.writeFileSync(outDir + '/' + name + '.png', Buffer.from(s.result.value, 'base64')); return 'saved'; }
    return 'FAIL';
};

console.log('朝南待机:', await snap('prev-idle-south', 0, 1));
console.log('朝东待机:', await snap('prev-idle-east', 1, 0));
console.log('朝北待机:', await snap('prev-idle-north', 0, -1));
process.exit(0);