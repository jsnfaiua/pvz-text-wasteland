// 多帧截图：走路循环 f0/f1/f2/f3 看"换脚"错觉
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');

await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.clearBrowserCache');
await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3000);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await send('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await send('Runtime.evaluate', { expression: `(async () => {
    const st = await import('./source-code/core/state.js');
    st.setSaveData({ ...st.saveData, devMode: true });
    const m = await import('./source-code/mod-wasteland/survival.js');
    window.__surv = m; m.enterWasteland({}); return 'entered';
})()`, awaitPromise: true });
await sleep(4000);

// 4 帧连续截图（朝右走路）
for (let f = 0; f < 4; f++) {
    await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.faceX = 1; sv.faceY = 0; sv.animMoving = true; sv.animFrame = ${f};
        if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
        return 'f${f}';
    })()` });
    await sleep(800);
    const shot = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shot.result && shot.result.value) fs.writeFileSync(`dev-tools/_qa_tmp/walk-f${f}.png`, Buffer.from(shot.result.value, 'base64'));
    console.log('  walk-f' + f + ' saved');
}

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
console.log('异常:', exceptions.length);
process.exit(0);
