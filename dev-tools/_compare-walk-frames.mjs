// 像素差 f0 vs f1 vs f2 vs f3（走路 4 帧循环是否真的"换脚"）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
const fs = await import('fs');
await send('Runtime.enable');
const basePath = 'C:\\Users\\24601\\Desktop\\文字植物大战僵尸-优化版(1)(1)\\文字植物大战僵尸-优化版(1)\\dev-tools\\_qa_tmp\\';
const b64s = [0,1,2,3].map(i => fs.readFileSync(basePath + 'walk-f' + i + '.png').toString('base64'));
const r = await send('Runtime.evaluate', { expression: `(async () => {
    const arr = ${JSON.stringify(b64s)};
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
    const datas = [];
    for (const b64 of arr) datas.push(await load(b64));
    function centerDiff(a, b, sz) {
        const W = Math.sqrt(a.length / 4);
        const cx = W / 2, cy = W / 2;
        let n = 0;
        for (let y = cy - sz/2; y < cy + sz/2; y++) for (let x = cx - sz/2; x < cx + sz/2; x++) {
            const i = (y * W + x) * 4;
            if (a[i+3] < 10) continue;
            if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) n++;
        }
        return n;
    }
    const sz = 200;
    // 玩家在右上方：画面 (810±100, 270±100) → 中心点 (960/2, 540/2)=中心
    // 改用全图采样（不裁剪）
    function fullDiff(a, b) {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
            if (a[i+3] < 10) continue;
            if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) n++;
        }
        return n;
    }
    return JSON.stringify({
        f0_vs_f1_full: fullDiff(datas[0], datas[1]),
        f0_vs_f2_full: fullDiff(datas[0], datas[2]),
        f1_vs_f3_full: fullDiff(datas[1], datas[3]),
        f0_vs_f3_full: fullDiff(datas[0], datas[3]),
        total_pixels: datas[0].length / 4,
    });
})()`, awaitPromise: true, returnByValue: true });
console.log('4 帧像素差（中心 100x100）:', r.result && r.result.value);
process.exit(0);
