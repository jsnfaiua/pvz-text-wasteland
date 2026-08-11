// 渲染待机呼吸 4 帧 + 走路 4 帧（新 sprite-side），供动态预览
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');
const outDir = 'dev-tools/_qa_tmp';
fs.mkdirSync(outDir, { recursive: true });
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
await sendMethod('Page.reload', { ignoreCache: true });
await sleep(2500);

const renderOne = async (name, dir, frame, moving) => {
    const t = Date.now();
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const R = await import('./source-code/mod-wasteland/render.js?t=${t}');
        const cv = document.createElement('canvas'); cv.width = 110; cv.height = 150;
        const c = cv.getContext('2d');
        c.fillStyle = '#20242c'; c.fillRect(0, 0, 110, 150);
        const anim = { dir: ${JSON.stringify(dir)}, frame: ${moving ? frame : 'null'}, moving: ${moving} };
        R.drawPixelPlayerBody(c, 55, 118, '#39d98a', 0, null, anim);
        return cv.toDataURL('image/png');
    })()`, awaitPromise: true, returnByValue: true });
    if (r2.result.value) { fs.writeFileSync(outDir + '/' + name + '.png', Buffer.from(r2.result.value.split(',')[1], 'base64')); return 'saved'; }
    return 'FAIL';
};

// 待机呼吸 4 帧（sin 0.6Hz，每 0.3s 一帧，跨 ~0.9s 覆盖 bob 0/±1 变化）
const labels = ['idle0', 'idle1', 'idle2', 'idle3'];
for (let i = 0; i < 4; i++) {
    console.log('待机', labels[i] + ':', await renderOne('new-idle-' + labels[i], 'right', null, false));
    await sleep(300);
}
// 走路 4 帧
for (let i = 0; i < 4; i++) console.log('走路 f' + i + ':', await renderOne('new-walk-f' + i, 'right', i, true));
process.exit(0);