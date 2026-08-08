// CDP 验证：朝东步频 0.18s（快）+ 朝东/西镜像 + 待机显示新 sprite-side.png
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
const send = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.clearBrowserCache');
await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await send('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await send('Runtime.evaluate', { expression: `(async () => {
    const st = await import('./source-code/core/state.js');
    st.setSaveData({ ...st.saveData, devMode: true });
    const m = await import('./source-code/mod-wasteland/survival.js');
    window.__surv = m; m.enterWasteland({}); return 'entered';
})()`, awaitPromise: true });
await sleep(4000);

// 按下 D 键（朝东走）
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
await sleep(150);
const startProbe = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ keys: { d: sv.keys.d, arrowright: sv.keys.arrowright }, faceX: sv.faceX, faceY: sv.faceY, animMoving: sv.animMoving, animFrame: sv.animFrame }); })()` });
console.log('按 D 后:', startProbe.result.value);

// 1.2 秒内连续采样 animFrame（应每 0.18s 切换一次 f0/f1 = 1.2s 内应见 6-7 次切换）
const eastFrames = [];
for (let i = 0; i < 7; i++) {
    await sleep(170);
    const fr = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ frame: sv.animFrame, stepT: +(sv.stepT || 0).toFixed(3), moving: sv.animMoving }); })()` });
    eastFrames.push(JSON.parse(fr.result.value));
}
console.log('① 朝东走帧序列:', JSON.stringify(eastFrames));

// 截图 f0 帧（animFrame=0 朝东）
await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.animFrame = 0; return 'frame=0'; })()` });
await sleep(80);
const shotE0 = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
if (shotE0.result.value) fs.writeFileSync('dev-tools/_qa_tmp/sprite-east-f0.png', Buffer.from(shotE0.result.value, 'base64'));

// 截图 f1 帧（animFrame=1，朝东应是 f0 镜像）
await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.animFrame = 1; return 'frame=1'; })()` });
await sleep(80);
const shotE1 = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
if (shotE1.result.value) fs.writeFileSync('dev-tools/_qa_tmp/sprite-east-f1.png', Buffer.from(shotE1.result.value, 'base64'));

// 松开 D，按 A（朝西）
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a', windowsVirtualKeyCode: 65 });
await sleep(150);
const westProbe = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.animFrame = 0; return JSON.stringify({ faceX: sv.faceX, animFrame: sv.animFrame }); })()` });
console.log('按 A 后:', westProbe.result.value);
await sleep(80);
const shotW = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
if (shotW.result.value) fs.writeFileSync('dev-tools/_qa_tmp/sprite-west-f0.png', Buffer.from(shotW.result.value, 'base64'));

// 松开 A，待机
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a', windowsVirtualKeyCode: 65 });
await sleep(400);
const idleProbe = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ animMoving: sv.animMoving }); })()` });
console.log('待机:', idleProbe.result.value);
const shotI = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
if (shotI.result.value) fs.writeFileSync('dev-tools/_qa_tmp/sprite-idle-side.png', Buffer.from(shotI.result.value, 'base64'));

// 按 S（朝南走）测步频
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyS', key: 's', windowsVirtualKeyCode: 83 });
await sleep(150);
const southFrames = [];
for (let i = 0; i < 4; i++) {
    await sleep(300);
    const fr = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ frame: sv.animFrame, stepT: +(sv.stepT || 0).toFixed(3) }); })()` });
    southFrames.push(JSON.parse(fr.result.value));
}
console.log('⑥ 朝南走帧序列:', JSON.stringify(southFrames));
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyS', key: 's', windowsVirtualKeyCode: 83 });

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
if (exceptions.length) for (const e of exceptions) console.log('EXC:', (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0,200));
process.exit(0);