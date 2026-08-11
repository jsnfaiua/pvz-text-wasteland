// 用不同 pants 配色验证：鞋区不再出现 pants 色粒子
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
await sendMethod('Page.reload', { ignoreCache: true });
await sleep(2500);

// 3 种 pants 配色，其余固定
const tests = {
  red:  { skin:'#f0c8a0', hair:'#c0392b', shirt:'#e67e22', pants:'#a33c2e', shoes:'#5d3a1a' },
  green:{ skin:'#f0c8a0', hair:'#c0392b', shirt:'#e67e22', pants:'#2e6b34', shoes:'#5d3a1a' },
  purple:{skin:'#f0c8a0', hair:'#c0392b', shirt:'#e67e22', pants:'#5a2e8a', shoes:'#5d3a1a' },
};

const results = {};
for (const k in tests) {
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const R = await import('./source-code/mod-wasteland/render.js?t=${Date.now()}');
        const LOOK = ${JSON.stringify(tests[k])};
        const cv = document.createElement('canvas'); cv.width = 120; cv.height = 150;
        const c = cv.getContext('2d');
        c.fillStyle = '#20242c'; c.fillRect(0, 0, 120, 150);
        R.drawPixelPlayerBody(c, 60, 118, '#39d98a', 0, LOOK, { dir: 'right', frame: 0, moving: true });
        const b64 = cv.toDataURL('image/png').split(',')[1];
        // 鞋区 = 底部 25%；检查是否有 pants 色（与目标 pants 相近）的粒子
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
        const cc = document.createElement('canvas'); cc.width = img.width; cc.height = img.height;
        cc.getContext('2d').drawImage(img, 0, 0);
        const d = cc.getContext('2d').getImageData(0, 0, cc.width, cc.height).data;
        const W = cc.width, H = cc.height;
        const PR = ${JSON.stringify(tests[k].pants)};
        const pr = parseInt(PR.slice(1,3),16), pg = parseInt(PR.slice(3,5),16), pb = parseInt(PR.slice(5,7),16);
        let pantsLike = 0;
        for (let y = Math.floor(H*0.75); y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y*W+x)*4;
            if (d[i+3] < 100) continue;
            const dr = Math.abs(d[i]-pr), dg = Math.abs(d[i+1]-pg), db = Math.abs(d[i+2]-pb);
            if (dr < 40 && dg < 40 && db < 40) pantsLike++;
        }
        return JSON.stringify({ pantsLike });
    })()`, awaitPromise: true, returnByValue: true });
    results[k] = r2.result.value;
}
console.log('不同裤子配色 → 鞋区 pants 色粒子:', JSON.stringify(results));
process.exit(0);