// _cdp-wake-scene.mjs — 触发"刚醒来"开局剧情截图（复现用户看到的十字线）
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
    // 清存档 + 进游戏（新区 → 触发"你醒来时发现..."开局剧情）
    await send('Runtime.evaluate', { expression: `localStorage.removeItem('u:__guest__:wasteland_save'); true` });
    await send('Network.clearBrowserCache');
    await send('Page.reload', { ignoreCache: true });
    await new Promise(r => setTimeout(r, 3500));
    // 进入游戏
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
    await new Promise(r => setTimeout(r, 1500));
    // 截图（开局剧情状态）
    const img = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (img.result && img.result.value) { fs.writeFileSync('dev-tools/_cdp-wake.png', Buffer.from(img.result.value, 'base64')); console.log('开局剧情截图已存'); }
    // 同时扫描贯穿性暗线
    const scan = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        const isLine = (r, g, b) => r < 40 && g < 50 && b < 45 && g >= r && g >= b - 10;   // 草地绿暗色
        const rowLines = [];
        for (let y = 0; y < H; y++) {
            let maxRun = 0, run = 0;
            for (let x = 0; x < W; x++) {
                const i = (y*W+x)*4;
                if (isLine(img[i], img[i+1], img[i+2])) run++; else { if (run > maxRun) maxRun = run; run = 0; }
            }
            if (run > maxRun) maxRun = run;
            if (maxRun > 200) rowLines.push({ y, maxRun, sample: [img[y*W*4], img[y*W*4+1], img[y*W*4+2]] });
        }
        const colLines = [];
        for (let x = 0; x < W; x++) {
            let maxRun = 0, run = 0;
            for (let y = 0; y < H; y++) {
                const i = (y*W+x)*4;
                if (isLine(img[i], img[i+1], img[i+2])) run++; else { if (run > maxRun) maxRun = run; run = 0; }
            }
            if (run > maxRun) maxRun = run;
            if (maxRun > 200) colLines.push({ x, maxRun, sample: [img[x*4], img[x*4+1], img[x*4+2]] });
        }
        return JSON.stringify({ W, H, rowLines, colLines });
    })()` });
    console.log('开局剧情暗线:', JSON.stringify(scan.result.value, null, 0));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });