// 渲染走路+待机（带配色 tint），检查鞋/头发是否有蓝色粒子
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

// 用户配色：红橙深蓝肉色
const LOOK = { skin: '#f0c8a0', hair: '#c0392b', shirt: '#e67e22', pants: '#1a3a5c', shoes: '#5d3a1a' };

const renderOne = async (name, dir, frame, moving) => {
    const t = Date.now();
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const R = await import('./source-code/mod-wasteland/render.js?t=${t}');
        const LOOK = ${JSON.stringify(LOOK)};
        const cv = document.createElement('canvas'); cv.width = 120; cv.height = 150;
        const c = cv.getContext('2d');
        c.fillStyle = '#20242c'; c.fillRect(0, 0, 120, 150);
        const anim = { dir: ${JSON.stringify(dir)}, frame: ${moving ? frame : 'null'}, moving: ${moving} };
        R.drawPixelPlayerBody(c, 60, 118, '#39d98a', 0, LOOK, anim);
        return cv.toDataURL('image/png');
    })()`, awaitPromise: true, returnByValue: true });
    if (r2.result.value) { fs.writeFileSync(outDir + '/' + name + '.png', Buffer.from(r2.result.value.split(',')[1], 'base64')); return 'saved'; }
    return 'FAIL';
};

console.log('待机:', await renderOne('tint-idle', 'right', null, false));
console.log('走路f0:', await renderOne('tint-walk0', 'right', 0, true));
console.log('走路f1:', await renderOne('tint-walk1', 'right', 1, true));
console.log('走路f2:', await renderOne('tint-walk2', 'right', 2, true));
console.log('走路f3:', await renderOne('tint-walk3', 'right', 3, true));

// 检查 tint-walk0 鞋区域是否有异常蓝色
const r3 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const b64 = ${JSON.stringify(fs.readFileSync(outDir + '/tint-walk0.png').toString('base64'))};
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    // 鞋区 = 底部 25%（canvas 高 150，脚在底部）
    let blueCount = 0;
    for (let y = Math.floor(H*0.75); y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y*W+x)*4;
        if (d[i+3] < 100) continue;
        // 纯蓝（B 明显大于 R 且是亮蓝，排除深蓝裤阴影）
        if (d[i+2] > 120 && d[i+2] - d[i] > 60) blueCount++;
    }
    return JSON.stringify({ blueInShoe: blueCount });
})()`, awaitPromise: true, returnByValue: true });
console.log('走路f0鞋区亮蓝像素:', r3.result.value);
process.exit(0);