const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 沿用当前页面状态（已进游戏），重新传送
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 800; sv.py = 800; sv.faceX = 1; sv.faceY = 0; sv.animMoving = false; sv.stepT = 0.4; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(600);

// ① 移速：朝东走 2s 测位移
await sendMethod('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
await sleep(200);
const p0 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.px; })()`, returnByValue: true });
await sleep(2000);
const p1 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.px; })()`, returnByValue: true });
await sendMethod('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
console.log('① 移速 2s 位移:', ((p1.result.value - p0.result.value)/2).toFixed(1), 'px/s（期望 ~61.6）');

// ② 朝南 stepT：设 stepT 触发值，sleep 0.15 采样（递减中）
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.faceX = 0; sv.faceY = 1; sv.animMoving = true; sv.stepT = 0.001; return 'south-trigger'; })()` });
await sleep(200);
const s1 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return +sv.stepT.toFixed(3); })()`, returnByValue: true });
await sleep(100);
const s2 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return +sv.stepT.toFixed(3); })()`, returnByValue: true });
console.log('② 朝南 stepT（期望 ~0.432 起始）:', s1.result.value, '→', s2.result.value, '（0.1s 递减 ~0.043）');

// ③ 朝东 stepT
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.faceX = 1; sv.faceY = 0; sv.animMoving = true; sv.stepT = 0.001; return 'east-trigger'; })()` });
await sleep(200);
const e1 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return +sv.stepT.toFixed(3); })()`, returnByValue: true });
console.log('③ 朝东 stepT（期望 ~0.36 起始）:', e1.result.value);
process.exit(0);
