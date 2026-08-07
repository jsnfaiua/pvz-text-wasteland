// _cdp-grass-plot.mjs — 定位"人行道/路面中间的草地块" → 传送 → 截图（验证横竖网格线消失）
import fs from 'node:fs';
const CDP = 'http://127.0.0.1:9222';
async function getJson(url) { return (await fetch(url + '/json')).json(); }
async function main() {
    const tabs = await getJson(CDP);
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map(); const evts = [];
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m);
    };
    const send = (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
    await new Promise(r => setTimeout(r, 3000));
    const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
    await send('Runtime.evaluate', { expression: `localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(save)}); true` });
    const ent = await send('Runtime.evaluate', { expression: `(async () => {
        try {
            const st = await import('./source-code/core/state.js');
            st.setSaveData({ ...st.saveData, devMode: true });
            const m = await import('./source-code/mod-wasteland/survival.js');
            window.__surv = m;
            m.enterWasteland({});
            return 'entered';
        } catch (e) { return 'ERR: ' + e.message; }
    })()`, awaitPromise: true });
    console.log('enter:', ent.result && ent.result.value);
    await new Promise(r => setTimeout(r, 4000));
    // 找 3x3 草地 + 外圈（3 格外）有路面/人行道的"草地块"
    const spot = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const wm = await import('./source-code/mod-wasteland/world.js');
        const G = wm.T.GROUND, SIDEWALK = wm.T.SIDEWALK, ROAD = wm.T.ROAD;
        for (let y = 3; y < 60; y += 1) for (let x = 3; x < 60; x += 1) {
            if (wm.getTile(sv, x, y) !== G) continue;
            let inner = true;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (wm.getTile(sv, x + dx, y + dy) !== G) { inner = false; break; }
            }
            if (!inner) continue;
            const up = wm.getTile(sv, x, y - 3), down = wm.getTile(sv, x, y + 3);
            const left = wm.getTile(sv, x - 3, y), right = wm.getTile(sv, x + 3, y);
            const surround = [up, down, left, right];
            if (surround.some(t => t === SIDEWALK || t === ROAD)) {
                return JSON.stringify({ gx: x, gy: y, px: x * 36 + 18, py: y * 36 + 18, up, down, left, right });
            }
        }
        return JSON.stringify({ notFound: true });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('草地块:', spot.result && spot.result.value);
    const sp = JSON.parse(spot.result.value);
    if (sp.notFound) { console.log('未找到草地块'); process.exit(1); }
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = ${sp.px}; sv.py = ${sp.py}; return true; })()` });
    await new Promise(r => setTimeout(r, 1500));
    const img = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (img.result && img.result.value && img.result.value.length > 1000) {
        fs.writeFileSync('dev-tools/_cdp-grass-plot.png', Buffer.from(img.result.value, 'base64'));
        console.log('草地块截图已存', img.result.value.length);
    }
    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
