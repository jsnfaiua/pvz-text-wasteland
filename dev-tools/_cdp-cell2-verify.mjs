// _cdp-cell2-verify.mjs — cell=2 草叶密度连续化后验证：36px 边界 vs 格中暗像素占比
import fs from 'node:fs';
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
    await new Promise(r => setTimeout(r, 3500));
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 504.37; sv.py = 504.71; return true; })()` });
    await new Promise(r => setTimeout(r, 1200));
    const scan = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        const lum = (x, y) => { const i = (y*W+x)*4; return (img[i]+img[i+1]+img[i+2])/3; };
        const cy = Math.floor(H/2);
        let edgeDark = 0, edgeTotal = 0, midDark = 0, midTotal = 0;
        for (let k = 2; k < Math.floor(W/36) - 2; k++) {
            const bx = k * 36;
            for (let dy = -15; dy <= 15; dy++) {
                const y = cy + dy;
                for (let dx = -1; dx <= 1; dx++) {
                    const l = lum(bx + dx, y);
                    const avg = (lum(bx + dx - 4, y) + lum(bx + dx + 4, y)) / 2;
                    if (l < avg - 12 && l < 60) edgeDark++;
                    edgeTotal++;
                }
                const mx = bx + 18;
                for (let dx = -1; dx <= 1; dx++) {
                    const l = lum(mx + dx, y);
                    const avg = (lum(mx + dx - 4, y) + lum(mx + dx + 4, y)) / 2;
                    if (l < avg - 12 && l < 60) midDark++;
                    midTotal++;
                }
            }
        }
        return JSON.stringify({ edgeRatio: (edgeDark/edgeTotal*100).toFixed(1) + '%', midRatio: (midDark/midTotal*100).toFixed(1) + '%' });
    })()` });
    console.log('36px 边界 vs 格中 暗像素占比:', scan.result && scan.result.value);
    const img = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (img.result && img.result.value) { fs.writeFileSync('dev-tools/_cdp-grass-cell2.png', Buffer.from(img.result.value, 'base64')); console.log('截图已存'); }
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });