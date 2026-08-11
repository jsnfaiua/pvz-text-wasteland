// 检测 walk-side 4 帧的蓝色像素（头发/鞋区域）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const sp = 'source-code/mod-wasteland/sprites/';
const b64s = {};
for (let i = 0; i < 4; i++) b64s[i] = fs.readFileSync(sp + 'walk-side-f' + i + '.png').toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B = ${JSON.stringify(b64s)};
    const out = {};
    for (const k in B) {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + B[k]; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const W = c.width, H = c.height;
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
            if (d[(y*W+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        const bh = mxy-mny+1;
        // 蓝色判定：B 比 R 高 >30 且 B>80（排除深蓝裤的纯色，那是正常）
        // 头发区 = 上部 30%；鞋区 = 底部 15%
        const headBot = mny + Math.floor(bh*0.30);
        const shoeTop = mxy - Math.floor(bh*0.15);
        const bluePix = { head: [], shoe: [], body: [] };
        for (let y=mnx?mny:0; y<=mxy; y++) for (let x=mnx; x<=mxx; x++) {
            const i=(y*W+x)*4;
            if (d[i+3]<150) continue;
            const rr=d[i], gg=d[i+1], bb=d[i+2];
            // 蓝色粒子：B 明显高于 R 和 G（亮蓝色/青色，不是深蓝裤）
            const isBlue = (bb - rr > 40 && bb - gg > 20 && bb > 70);
            if (!isBlue) continue;
            const zone = y < headBot ? 'head' : (y >= shoeTop ? 'shoe' : 'body');
            bluePix[zone].push({ x, y, rgb: rr+','+gg+','+bb });
        }
        // 汇总：每区域前几个样本 + 计数
        out[k] = {
          head: bluePix.head.length,
          shoe: bluePix.shoe.length,
          body: bluePix.body.length,
          headSamples: bluePix.head.slice(0,3),
          shoeSamples: bluePix.shoe.slice(0,3),
        };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);