// CDP 预览：4 帧走路循环 + 朝西镜像
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
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
const ent = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const st = await import('./source-code/core/state.js');
    st.setSaveData({ ...st.saveData, devMode: true });
    const m = await import('./source-code/mod-wasteland/survival.js');
    window.__surv = m; m.enterWasteland({}); return 'entered';
})()`, awaitPromise: true, returnByValue: true });
console.log('enter:', ent.result.value);
await sleep(5000);
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 200; sv.py = 200; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(900);

// sprite 加载状态
const spr = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const r = await import('./source-code/mod-wasteland/render.js');
    const out = {};
    for (let i = 0; i < 4; i++) out['side'+i] = r._mcWalk.side[i] ? r._mcWalk.side[i].width + 'x' + r._mcWalk.side[i].height + ' ['+(r._mcWalk.side[i].tagName||'')+']' : null;
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
console.log('sprite:', spr.result.value);

const snap = async (name, frame, faceX) => {
    await sendMethod('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.animFrame = ${frame}; sv.animMoving = true; sv.stepT = 0.18; sv.faceX = ${faceX}; sv.faceY = 0;
        if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
        return 'set';
    })()` });
    await sleep(400);
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (s.result.value) { fs.writeFileSync('dev-tools/_qa_tmp/' + name, Buffer.from(s.result.value, 'base64')); return 'saved'; }
    return 'FAIL';
};

console.log('朝东 f0:', await snap('4f-east-f0.png', 0, 1));
console.log('朝东 f1:', await snap('4f-east-f1.png', 1, 1));
console.log('朝东 f2:', await snap('4f-east-f2.png', 2, 1));
console.log('朝东 f3:', await snap('4f-east-f3.png', 3, 1));
console.log('朝西 f0:', await snap('4f-west-f0.png', 0, -1));
console.log('朝西 f1:', await snap('4f-west-f1.png', 1, -1));
console.log('朝西 f2:', await snap('4f-west-f2.png', 2, -1));
console.log('朝西 f3:', await snap('4f-west-f3.png', 3, -1));

// 帧序列验证
await sendMethod('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });
await sleep(150);
const seq = [];
for (let i = 0; i < 10; i++) {
    await sleep(180);
    const fr = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ frame: sv.animFrame }); })()` });
    seq.push(JSON.parse(fr.result.value).frame);
}
console.log('朝东走路 1.8s 帧序列:', JSON.stringify(seq));
await sendMethod('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68 });

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
process.exit(0);