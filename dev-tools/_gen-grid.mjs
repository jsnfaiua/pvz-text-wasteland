// 生成 sprite-front/side 带坐标网格放大图（用户指认问题位置用）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const sp = 'source-code/mod-wasteland/sprites/';
const b64s = {
  front: fs.readFileSync(sp + 'sprite-front.png').toString('base64'),
  side: fs.readFileSync(sp + 'sprite-side.png').toString('base64'),
};
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B = ${JSON.stringify(b64s)};
    const out = {};
    for (const k in B) {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + B[k]; });
        const SCALE = 2;
        const W = img.width * SCALE, H = img.height * SCALE;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const cc = cv.getContext('2d');
        cc.imageSmoothingEnabled = false;
        cc.drawImage(img, 0, 0, W, H);
        // 网格（每 25 原图像素 = 50 显示像素）
        cc.strokeStyle = 'rgba(255,80,80,0.45)';
        cc.lineWidth = 1;
        cc.beginPath();
        for (let g = 0; g * SCALE <= W; g += 50) { cc.moveTo(g, 0); cc.lineTo(g, H); }
        for (let g = 0; g * SCALE <= H; g += 50) { cc.moveTo(0, g); cc.lineTo(W, g); }
        cc.stroke();
        // 坐标标注（每 50 原图像素）
        cc.fillStyle = 'rgba(255,255,80,0.9)';
        cc.font = '9px monospace';
        for (let x = 0; x <= img.width; x += 50) cc.fillText('x=' + x, x * SCALE + 2, 10);
        for (let y = 0; y <= img.height; y += 50) cc.fillText('y=' + y, 2, y * SCALE + 10);
        out[k] = cv.toDataURL('image/png').split(',')[1];
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
if (r.error || !r.result.value) { console.log('ERR:', JSON.stringify(r.error || r.result)); process.exit(1); }
const res = JSON.parse(r.result.value);
const outDir = 'dev-tools/_qa_tmp';
fs.mkdirSync(outDir, { recursive: true });
for (const k in res) {
    fs.writeFileSync(outDir + '/grid-' + k + '.png', Buffer.from(res[k], 'base64'));
    console.log('grid-' + k + '.png 生成');
}
process.exit(0);