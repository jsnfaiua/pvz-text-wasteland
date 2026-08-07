// _cdp-newseed.mjs — 验证 forceNew 是否真的开新世界（随机种子 vs 旧档种子）
const CDP = 'http://127.0.0.1:9222';
async function getJson(url) { return (await fetch(url + '/json')).json(); }
async function main() {
    const tabs = await getJson(CDP);
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map();
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } }
    };
    const send = (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
    await new Promise(r => setTimeout(r, 3000));
    // 写一个明确的旧档：profile + 世界档 seed=12345
    const prof = JSON.stringify({ characterName: '测试', worldSeed: 12345 });
    const world = JSON.stringify({ v: 3, seed: 12345, day: 5, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
    await send('Runtime.evaluate', { expression: `localStorage.setItem('wasteland_profile', ${JSON.stringify(prof)}); localStorage.setItem('wasteland_world_12345', ${JSON.stringify(world)}); true` });
    // 场景1：正常进入（应读旧档 seed=12345）
    const s1 = await send('Runtime.evaluate', { expression: `(async () => {
        try {
            const st = await import('./source-code/core/state.js');
            st.setSaveData({ ...st.saveData, devMode: true });
            const m = await import('./source-code/mod-wasteland/survival.js');
            m.enterWasteland({});
            await new Promise(r => setTimeout(r, 1500));
            const sv = m.debugGetSv();
            return 'scene1 continue: seed=' + sv.world.seed + ' day=' + sv.day;
        } catch (e) { return 'ERR: ' + e.message; }
    })()`, awaitPromise: true });
    console.log(s1.result && s1.result.value);
    // 场景2：forceNew（应随机新种子，≠12345）
    const s2 = await send('Runtime.evaluate', { expression: `(async () => {
        try {
            const m = await import('./source-code/mod-wasteland/survival.js');
            m.enterWasteland({ forceNew: true });
            await new Promise(r => setTimeout(r, 1500));
            const sv = m.debugGetSv();
            return 'scene2 forceNew: seed=' + sv.world.seed + ' day=' + sv.day + ' isNew=' + (sv.world.seed !== 12345);
        } catch (e) { return 'ERR: ' + e.message; }
    })()`, awaitPromise: true });
    console.log(s2.result && s2.result.value);
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });