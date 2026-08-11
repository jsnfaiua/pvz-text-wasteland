// 诊断 sprite-front/side：眼睛、黑点、脖子
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const b64s = {
  front: fs.readFileSync('source-code/mod-wasteland/sprites/sprite-front.png').toString('base64'),
  side: fs.readFileSync('source-code/mod-wasteland/sprites/sprite-side.png').toString('base64'),
};
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
        // 眼睛检测：头部（上部 25%）深色像素（<60）列投影
        const headBot = mny + Math.floor(bh*0.25);
        const colCount = new Uint32Array(W);
        const rows = [];
        for (let y=mny; y<headBot; y++) {
            let rowHas = false;
            for (let x=mnx; x<=mxx; x++) {
                const i=(y*W+x)*4;
                if (d[i+3]>140 && d[i]<60 && d[i+1]<60 && d[i+2]<60) { colCount[x]++; rowHas = true; }
            }
            if (rowHas) rows.push(y);
        }
        // 找眼睛列峰（两个簇）
        const peaks = [];
        for (let x=mnx; x<=mxx; x++) {
            if (colCount[x] >= 2) {
                if (peaks.length && x - peaks[peaks.length-1].x <= 3) { peaks[peaks.length-1].count += colCount[x]; peaks[peaks.length-1].x = Math.round((peaks[peaks.length-1].x + x)/2); }
                else peaks.push({ x, count: colCount[x] });
            }
        }
        // 黑点：孤立深色像素（<45），5×5 邻域主色
        let blackDots = 0; const dotSamples = [];
        for (let y=2; y<H-2; y++) for (let x=2; x<W-2; x++) {
            const i=(y*W+x)*4;
            if (d[i+3]<200 || !(d[i]<45 && d[i+1]<45 && d[i+2]<45)) continue;
            // 5×5 邻域非深色像素
            let nonDark = 0, sameN = 0;
            const freq = {};
            for (let dy=-2; dy<=2; dy++) for (let dx=-2; dx<=2; dx++) {
                if (dx===0&&dy===0) continue;
                const ni=((y+dy)*W+(x+dx))*4;
                if (d[ni+3]>150) {
                    nonDark++;
                    if (!(d[ni]<45&&d[ni+1]<45&&d[ni+2]<45)) { sameN++; const q=Math.floor(d[ni]/32)+','+Math.floor(d[ni+1]/32)+','+Math.floor(d[ni+2]/32); freq[q]=(freq[q]||0)+1; }
                }
            }
            // 邻域绝大多数是单一色（>12）且中心是孤立黑点 → 杂点
            if (nonDark >= 20 && sameN >= 16 && Object.keys(freq).length <= 2) {
                blackDots++;
                if (dotSamples.length < 5) dotSamples.push({ x, y, freq: Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,2) });
            }
        }
        out[k] = { size: W+'x'+H, bbox: [mnx,mny,mxx,mxy], bh, eyeRows: rows.length ? [rows[0], rows[rows.length-1]] : null, eyeColPeaks: peaks.filter(p=>p.count>=3).slice(0,8), blackDots, dotSamples };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);