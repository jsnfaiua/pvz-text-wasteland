// _cdp-scan-lines.mjs — 扫描贯穿性暗色行/列（找"草地分割线"真凶）
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
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 0; sv.py = 0; return true; })()` });
    await new Promise(r => setTimeout(r, 1500));
    const scan = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        const isLine = (r, g, b) => r < 35 && g < 35 && b < 40;
        const rowLines = [];
        for (let y = 0; y < H; y++) {
            let maxRun = 0, run = 0;
            for (let x = 0; x < W; x++) {
                const i = (y*W+x)*4;
                if (isLine(img[i], img[i+1], img[i+2])) run++; else { if (run > maxRun) maxRun = run; run = 0; }
            }
            if (run > maxRun) maxRun = run;
            if (maxRun > 80) rowLines.push({ y, maxRun });
        }
        const colLines = [];
        for (let x = 0; x < W; x++) {
            let maxRun = 0, run = 0;
            for (let y = 0; y < H; y++) {
                const i = (y*W+x)*4;
                if (isLine(img[i], img[i+1], img[i+2])) run++; else { if (run > maxRun) maxRun = run; run = 0; }
            }
            if (run > maxRun) maxRun = run;
            if (maxRun > 80) colLines.push({ x, maxRun });
        }
        return JSON.stringify({ W, H, rowLines, colLines });
    })()` });
    console.log('贯穿暗线:', scan.result && scan.result.value);
    const img = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (img.result && img.result.value) { fs.writeFileSync('dev-tools/_cdp-spawn.png', Buffer.from(img.result.value, 'base64')); console.log('出生点截图已存'); }
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });