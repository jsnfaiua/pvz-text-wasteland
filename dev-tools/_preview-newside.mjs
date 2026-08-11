// 替换 sprite-side + 渲染待机呼吸/走路对比帧
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
// 复制新图
fs.copyFileSync('C:/Users/24601/Desktop/未标题-1.png', 'source-code/mod-wasteland/sprites/sprite-side.png');
console.log('sprite-side 已替换（新图 378x660 比例 0.57）');

await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
await sendMethod('Page.reload', { ignoreCache: true });
await sleep(2500);

// 渲染：待机呼吸 2 帧（bob 不同时刻）+ 走路 f0 + 走路 f1
const renderOne = async (name, dir, frame, moving) => {
    const t = Date.now();
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const R = await import('./source-code/mod-wasteland/render.js?t=${t}');
        const cv = document.createElement('canvas'); cv.width = 120; cv.height = 150;
        const c = cv.getContext('2d');
        c.fillStyle = '#20242c'; c.fillRect(0, 0, 120, 150);
        const anim = { dir: ${JSON.stringify(dir)}, frame: ${moving ? frame : 'null'}, moving: ${moving} };
        R.drawPixelPlayerBody(c, 60, 118, '#39d98a', 0, null, anim);
        return cv.toDataURL('image/png');
    })()`, awaitPromise: true, returnByValue: true });
    if (r2.result.value) { fs.writeFileSync(outDir + '/' + name + '.png', Buffer.from(r2.result.value.split(',')[1], 'base64')); return 'saved'; }
    return 'FAIL';
};

console.log('待机呼吸 t0:', await renderOne('pre-side-idle0', 'right', null, false));
await sleep(260);
console.log('待机呼吸 t1:', await renderOne('pre-side-idle1', 'right', null, false));
console.log('走路 f0:', await renderOne('pre-side-walk0', 'right', 0, true));
console.log('走路 f1:', await renderOne('pre-side-walk1', 'right', 1, true));
process.exit(0);