// _cdp-map-grass2.mjs — 定位大片草地 → 传送 → 截图 + 格边界 seam 检测（验证"方框/分割块"）
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
    // 扫描 6x6 纯草地（用 world.js getTile，游戏真实读取）
    const spot = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const wm = await import('./source-code/mod-wasteland/world.js');
        const G = wm.T.GROUND;
        for (let y = 5; y < 80; y += 2) for (let x = 5; x < 80; x += 2) {
            let grass = 0;
            for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) if (wm.getTile(sv, x + dx, y + dy) === G) grass++;
            if (grass >= 34) return JSON.stringify({ gx: x, gy: y, px: (x + 3) * 36, py: (y + 3) * 36, grass });
        }
        return JSON.stringify({ none: true, groundVal: G, sample: wm.getTile(sv, 10, 10) });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('草地:', spot.result && spot.result.value);
    const sp = JSON.parse(spot.result.value);
    if (sp.none) { console.log('未找到大片草地'); process.exit(1); }
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = ${sp.px}; sv.py = ${sp.py}; return true; })()` });
    await new Promise(r => setTimeout(r, 1500));
    const img = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (img.result && img.result.value && img.result.value.length > 1000) {
        fs.writeFileSync('dev-tools/_cdp-grass-big.png', Buffer.from(img.result.value, 'base64'));
        console.log('大片草地截图已存', img.result.value.length);
    }
    const seam = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        let seamSum = 0, baseSum = 0, n = 0;
        for (let gx = 1; gx < Math.floor(W / 36) - 1; gx++) {
            const bx = gx * 36;
            for (let y = 60; y < H - 60; y += 10) {
                const probe = ((y * W) + bx + 18) * 4;
                if (!(img[probe + 1] > img[probe] && img[probe + 1] > 60)) continue;
                const iL = ((y * W) + bx - 1) * 4, iR = ((y * W) + bx) * 4;
                seamSum += Math.abs(img[iL]-img[iR]) + Math.abs(img[iL+1]-img[iR+1]) + Math.abs(img[iL+2]-img[iR+2]);
                const bx2 = bx - 10;
                const iL2 = ((y * W) + bx2 - 1) * 4, iR2 = ((y * W) + bx2) * 4;
                baseSum += Math.abs(img[iL2]-img[iR2]) + Math.abs(img[iL2+1]-img[iR2+1]) + Math.abs(img[iL2+2]-img[iR2+2]);
                n++;
            }
        }
        return JSON.stringify({ seam: n ? (seamSum / n).toFixed(2) : '0', base: n ? (baseSum / n).toFixed(2) : '0', ratio: n ? (seamSum / baseSum).toFixed(2) : '0', n });
    })()` });
    console.log('格间 seam（<1.5 无分割框）:', seam.result && seam.result.value);
    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
