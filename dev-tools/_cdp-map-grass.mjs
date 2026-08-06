// _cdp-map-grass.mjs — 真实地图草地验证（去粗线）：进游戏 → 截图 + 格间 seam 检测
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
    await send('Runtime.evaluate', { expression: `localStorage.setItem('u:__guest__:wasteland_save', '${JSON.stringify(JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } }))}'); true` });
    await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({});
        return 'entered';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));
    // 走到大草地（当前位置向左下移动避开出生点建筑）
    await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.px = 5 * 36; sv.py = 8 * 36;
        return true;
    })()` });
    await new Promise(r => setTimeout(r, 1500));
    // 截图
    const img = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        return sv.ctx.canvas.toDataURL('image/png').slice(22);
    })()` });
    if (img.result && img.result.value && img.result.value.length > 1000) {
        fs.writeFileSync('dev-tools/_cdp-map-grass.png', Buffer.from(img.result.value, 'base64'));
        console.log('地图截图已存', img.result.value.length);
    }
    // 格间 seam：游戏 canvas 960×540，格 36px → 检测 x=36k 边界 vs 非边界（只采样草地绿色区）
    const seam = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width;
        let seamSum = 0, baseSum = 0, n = 0;
        for (let gx = 1; gx < Math.floor(W / 36); gx++) {
            const bx = gx * 36;
            for (let y = 100; y < 440; y += 12) {
                // 只统计绿区（草地）
                const probe = ((y * W) + bx + 18) * 4;
                if (img[probe + 1] <= img[probe]) continue;   // 非绿跳过
                const iL = ((y * W) + bx - 1) * 4, iR = ((y * W) + bx) * 4;
                seamSum += Math.abs(img[iL]-img[iR]) + Math.abs(img[iL+1]-img[iR+1]) + Math.abs(img[iL+2]-img[iR+2]);
                const bx2 = bx - 8;
                const iL2 = ((y * W) + bx2 - 1) * 4, iR2 = ((y * W) + bx2) * 4;
                baseSum += Math.abs(img[iL2]-img[iR2]) + Math.abs(img[iL2+1]-img[iR2+1]) + Math.abs(img[iL2+2]-img[iR2+2]);
                n++;
            }
        }
        return JSON.stringify({ seam: (seamSum / n).toFixed(2), base: (baseSum / n).toFixed(2), ratio: (seamSum / baseSum).toFixed(2), n });
    })()` });
    console.log('真实地图格间 seam:', seam.result && seam.result.value);
    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
