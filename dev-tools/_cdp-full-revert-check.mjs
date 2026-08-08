// CDP 验证全量回退：室内无主题家具（IT 枚举 13+ 不存在）、大世界无建筑标签、进楼正常
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

// ① 检查 windoor 模块：IT 枚举应只有 0-12（无主题家具）
const itCheck = await send('Runtime.evaluate', { expression: `(async () => {
    const WD = await import('./source-code/mod-wasteland/windoor.js');
    const vals = Object.values(WD.INTERIOR_TILES).filter(v => typeof v === 'number');
    return JSON.stringify({ maxEnum: Math.max(...vals), hasDesk: vals.includes(13), enumCount: vals.length });
})()`, awaitPromise: true, returnByValue: true });
console.log('① IT 枚举:', itCheck.result && itCheck.result.value);

// ② 进真实室内（找一栋非废墟建筑的门）
const intCheck = await send('Runtime.evaluate', { expression: `(async () => {
    const wd = await import('./source-code/mod-wasteland/wdistrict.js');
    const w = await import('./source-code/mod-wasteland/world.js');
    // 找 urban 区的门（非工业废墟）
    for (let cy=-8; cy<=8; cy++) for (let cx=-8; cx<=8; cx++) {
        const t = w.genChunkTiles(20260802, cx, cy);
        if (wd.districtAt(20260802, cx, cy) !== 'ruins') {
            for (let ly=0; ly<16; ly++) for (let lx=0; lx<16; lx++)
                if (t[ly*16+lx] === w.T.DOOR) return JSON.stringify([cx*16+lx, cy*16+ly]);
        }
    }
    return 'none';
})()`, awaitPromise: true, returnByValue: true });
const door = JSON.parse(intCheck.result.value);
let intRes = '跳过';
if (door !== 'none') {
    await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.px = ${door[0]} * 36 + 18; sv.py = ${door[1]} * 36 + 18;
        if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
        return 'tp';
    })()` });
    await sleep(1500);
    const int = await send('Runtime.evaluate', { expression: `(() => {
        const m = window.__surv;
        m.debugEnterInteriorReal('${door[0]},${door[1]}');
        const it = m.debugGetSv().interior;
        if (!it) return 'ERR: interior null';
        let furn = 0;
        for (const v of it.tiles) if (v >= 13) furn++;
        return JSON.stringify({ w: it.w, h: it.h, furn, zombies: it.zombies.length, buildingType: it.buildingType });
    })()`, returnByValue: true });
    intRes = int.result && int.result.value;
}
console.log('② 进室内:', door !== 'none' ? ('门@' + door) : 'none', '→', intRes);
await sleep(1500);

// ③ 大世界建筑标签检查：dyn 无 bldLabels
const lblCheck = await send('Runtime.evaluate', { expression: `(() => {
    const sv = window.__surv.debugGetSv();
    // 动态层缓存对象里不应有 bldLabels
    return JSON.stringify({ hasBldLabels: !!(sv._buildingShapeCache) });
})()`, returnByValue: true });
console.log('③ 建筑标签缓存:', lblCheck.result && lblCheck.result.value);

// ④ FPS + 异常
const fps = await send('Runtime.evaluate', { expression: `new Promise(res => {
    const t0 = performance.now(); let frames = 0;
    const tick = () => { frames++; if (performance.now()-t0 < 2000) requestAnimationFrame(tick); else res(frames/2); };
    requestAnimationFrame(tick);
})`, awaitPromise: true, returnByValue: true });
console.log('④ FPS(2s):', fps.result && fps.result.value);
const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
if (exceptions.length) for (const e of exceptions) console.log('EXC:', (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0,200));
process.exit(0);
