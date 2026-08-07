// _cdp-find-grid-line.mjs — 精确定位 36px 网格深色线：扫描大片草地每格边界 ±2px 的暗像素
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
    // 大片草地（整数玩家位置 → 静态层缓存 blit 精确对齐；再测小数位置）
    const scan = async (label) => {
        const r = await send('Runtime.evaluate', { expression: `(() => {
            const sv = window.__surv.debugGetSv();
            const c = sv.ctx;
            const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
            const W = c.canvas.width, H = c.canvas.height;
            // 找草地参考亮度（画面中心区域多个采样取中位数）
            const lumAt = (x, y) => { const i = (y*W+x)*4; return (img[i]+img[i+1]+img[i+2])/3; };
            const cx = Math.floor(W/2), cy = Math.floor(H/2);
            // 沿中心行扫，找"比相邻草地深 20+"的暗像素（线特征）
            const results = [];
            for (let x = 40; x < W - 40; x++) {
                const l = lumAt(x, cy), lL = lumAt(x-1, cy), lR = lumAt(x+1, cy);
                const avg = (lL + lR) / 2;
                if (l < avg - 15 && l < 60) {
                    results.push({ x, l: Math.round(l), avg: Math.round(avg) });
                }
            }
            return JSON.stringify({ W, H, cx, cy, darkPixels: results.slice(0, 40), count: results.length });
        })()` });
        console.log(label, r.result && r.result.value);
    };
    // 整数位置
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 504; sv.py = 504; return true; })()` });
    await new Promise(r => setTimeout(r, 1200));
    await scan('整数位置:');
    // 小数位置（真实移动状态）
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 504.37; sv.py = 504.71; return true; })()` });
    await new Promise(r => setTimeout(r, 1200));
    await scan('小数位置:');
    // 截图保存
    const img = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (img.result && img.result.value) { fs.writeFileSync('dev-tools/_cdp-grid-line.png', Buffer.from(img.result.value, 'base64')); console.log('截图已存'); }
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });