// CDP 验证：移动速度减半 + 闪避短距离 + 子弹时间 dt 缩放
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
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 500; sv.py = 500; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

// ① 移动速度：按住 D 走 1 秒（按住 1s + 采样），px 变化应 ≈ 56
await sendMethod('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
await sleep(100);
const p0 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.px; })()`, returnByValue: true });
await sleep(1000);
const p1 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.px; })()`, returnByValue: true });
await sendMethod('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
console.log('① 移动速度：1s 位移 =', (p1.result.value - p0.result.value).toFixed(1), 'px（期望 ≈56）');

// ② 闪避：按 Q，测闪避位移（320×0.2 = 64px）
await sleep(300);
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.faceX = 1; sv.faceY = 0; sv.keys.d = true; return 'ready'; })()` });
await sendMethod('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyQ', key: 'q', windowsVirtualKeyCode: 81 });
await sleep(50);
const d0 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ px: sv.px, dashing: sv.dashing, dashTimer: sv.dashTimer, invuln: sv.invuln, dodgeWin: sv._dodgePerfectWindow }); })()`, returnByValue: true });
await sleep(300);
const d1 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ px: sv.px, dashing: sv.dashing }); })()`, returnByValue: true });
console.log('② 闪避开始:', d0.result.value);
console.log('② 闪避后:', d1.result.value, '位移 =', ((JSON.parse(d1.result.value).px) - (JSON.parse(d0.result.value).px)).toFixed(1), 'px（期望 ≈64）');
await sendMethod('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyQ', key: 'q', windowsVirtualKeyCode: 81 });

// ③ 子弹时间：设 sv._bulletT = 1.2，测 stepT 递减速度（0.36s/帧 → 慢 5 倍）
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv._bulletT = 1.2; sv.keys.d = true; sv.animFrame = 0; sv.stepT = 0.36; return 'bullet'; })()` });
await sleep(100);
const bt0 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ stepT: sv.stepT, bulletT: sv._bulletT }); })()`, returnByValue: true });
await sleep(1000);
const bt1 = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ stepT: sv.stepT, bulletT: sv._bulletT, frame: sv.animFrame }); })()`, returnByValue: true });
console.log('③ 子弹时间 1s 后:', bt0.result.value, '→', bt1.result.value, '（stepT 应几乎不变=慢动作；_bulletT 从 1.2 减到 ~1.0）');
await sendMethod('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv._bulletT = 0; return 'clear'; })()` });

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
if (exceptions.length) for (const e of exceptions) console.log('EXC:', (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0,200));
process.exit(0);