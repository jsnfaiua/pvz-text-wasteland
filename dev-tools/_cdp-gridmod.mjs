// _cdp-gridmod.mjs — 全画布暗像素模 36 分布：检测格边界线（x%36≈0 聚集 = 36px 网格线）
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
    // 当前页面应在游戏（_cdp-cell2 刚跑过，玩家 504.37,504.71 大片草地）
    // 统计暗像素（比周围暗 12+ 且亮度 <60）的 x%36 / y%36 分布
    const r = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        const lum = (x, y) => { const i = (y*W+x)*4; return (img[i]+img[i+1]+img[i+2])/3; };
        const xMod = new Array(36).fill(0), yMod = new Array(36).fill(0);
        let total = 0;
        // 每 2px 采样（加速），跳过边缘 30px（避开 UI/黑边）
        for (let y = 30; y < H - 30; y += 2) for (let x = 30; x < W - 30; x += 2) {
            const l = lum(x, y);
            const avg = (lum(x - 3, y) + lum(x + 3, y)) / 2;
            if (l < avg - 12 && l < 60) {
                xMod[x % 36]++; yMod[y % 36]++; total++;
            }
        }
        return JSON.stringify({ total, xMod: xMod.join(','), yMod: yMod.join(',') });
    })()` });
    console.log('暗像素模36:', r.result && r.result.value);
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });