// 像素对比：base64 注入浏览器后用 Image 解码
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
const fs = await import('fs');
await send('Runtime.enable');
// 读取 3 张 PNG 转 base64 注入到浏览器
const basePath = 'C:\\Users\\24601\\Desktop\\文字植物大战僵尸-优化版(1)(1)\\文字植物大战僵尸-优化版(1)\\dev-tools\\_qa_tmp\\';
const idleB64 = fs.readFileSync(basePath + 'sprite-side-idle.png').toString('base64');
const walkB64 = fs.readFileSync(basePath + 'sprite-side-walk.png').toString('base64');
const walkLB64 = fs.readFileSync(basePath + 'sprite-side-walk-left.png').toString('base64');
const r = await send('Runtime.evaluate', { expression: `(async () => {
    async function load(b64) {
        return new Promise(res => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
                res(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
            };
            img.src = 'data:image/png;base64,' + b64;
        });
    }
    const idle = await load(${JSON.stringify(idleB64)});
    const walk = await load(${JSON.stringify(walkB64)});
    const walkL = await load(${JSON.stringify(walkLB64)});
    function centerDiff(a, b, sz) {
        if (a.length !== b.length) return -1;
        const W = Math.sqrt(a.length / 4);
        const cx = W / 2, cy = W / 2;
        let n = 0, total = 0;
        for (let y = cy - sz/2; y < cy + sz/2; y++) for (let x = cx - sz/2; x < cx + sz/2; x++) {
            const i = (y * W + x) * 4;
            if (a[i+3] < 10) continue;
            total++;
            if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) n++;
        }
        return { diff: n, total: total };
    }
    return JSON.stringify({
        idle_vs_walk: centerDiff(idle, walk, 400),
        walk_right_vs_walk_left: centerDiff(walk, walkL, 400),
        total_pixels: idle.length / 4,
    });
})()`, awaitPromise: true, returnByValue: true });
console.log('像素差:', r.result && r.result.value);
process.exit(0);
