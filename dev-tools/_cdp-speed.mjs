const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const st = await import('./source-code/core/state.js');
    st.setSaveData({ ...st.saveData, devMode: true });
    const m = await import('./source-code/mod-wasteland/survival.js');
    window.__surv = m; m.enterWasteland({}); return 'entered';
})()`, awaitPromise: true, returnByValue: true });
await sleep(5000);
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 500; sv.py = 500; sv.faceX = 1; sv.faceY = 0; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

// ① 移速（朝东走 1s）
await sendMethod('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
await sleep(100);
const p0 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.px; })()`, returnByValue: true });
await sleep(1000);
const p1 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.px; })()`, returnByValue: true });
await sendMethod('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
console.log('① 移速 1s 位移:', (p1.result.value - p0.result.value).toFixed(1), 'px（期望 ~61.6）');

// ② 朝南走路 stepT（应 0.432）
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.faceX = 0; sv.faceY = 1; sv.animMoving = true; sv.stepT = 0; return 'south'; })()` });
await sleep(600);
const s0 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ stepT: sv.stepT, faceX: sv.faceX, faceY: sv.faceY }); })()`, returnByValue: true });
console.log('② 朝南 stepT 采样:', s0.result.value, '（期望 stepT 初始 0.432）');

// ③ 朝东走路 stepT（应 0.36）
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.faceX = 1; sv.faceY = 0; sv.animMoving = true; sv.stepT = 0; return 'east'; })()` });
await sleep(600);
const e0 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ stepT: sv.stepT }); })()`, returnByValue: true });
console.log('③ 朝东 stepT 采样:', e0.result.value, '（期望 stepT 初始 0.36）');

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
process.exit(0);
