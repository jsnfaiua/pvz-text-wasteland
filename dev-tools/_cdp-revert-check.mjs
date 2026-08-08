// CDP 验证回退：医院屋顶应回到城市灰蓝（无红十字、无偏白偏移）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
const found = await send('Runtime.evaluate', { expression: `(async () => {
    const wd = await import('./source-code/mod-wasteland/wdistrict.js');
    const w = await import('./source-code/mod-wasteland/world.js');
    for (let cy=-10; cy<=10; cy++) for (let cx=-10; cx<=10; cx++) {
        if (wd.buildingTypeAt(20260802, cx, cy) === 'hospital') {
            const t = w.genChunkTiles(20260802, cx, cy);
            for (let ly=0; ly<16; ly++) for (let lx=0; lx<16; lx++)
                if (t[ly*16+lx] === w.T.DOOR) return JSON.stringify([cx*16+lx, cy*16+ly]);
        }
    }
    return 'none';
})()`, awaitPromise: true, returnByValue: true });
const door = JSON.parse(found.result.value);
if (door !== 'none') {
    await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.px = ${door[0]} * 36 + 18; sv.py = ${door[1]} * 36 - 14;
        if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
        return 'tp';
    })()` });
    await sleep(1800);
    const shot = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    const fs = await import('fs');
    if (shot.result && shot.result.value) { fs.writeFileSync('dev-tools/_qa_tmp/cdp-revert-hospital.png', Buffer.from(shot.result.value, 'base64')); console.log('回退后医院截图已存'); }
    const px = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const img = sv.ctx.getImageData(0,0,sv.ctx.canvas.width,sv.ctx.canvas.height).data;
        let redCross = 0, urbanRoof = 0;
        for (let i=0;i<img.length;i+=4) {
            const r=img[i], g=img[i+1], b=img[i+2];
            if (r>=200&&r<=235 && g>=50&&g<=80 && b>=45&&b<=75) redCross++;
            if (r>=70&&r<=90 && g>=76&&g<=96 && b>=86&&b<=106) urbanRoof++;
        }
        return JSON.stringify({ redCross, urbanRoof });
    })()`, returnByValue: true });
    console.log('回退后采样:', px.result && px.result.value);
}
const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
process.exit(0);
