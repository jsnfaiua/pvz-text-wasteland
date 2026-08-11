// 精确分析 sprite-front 眼睛：脸部区域（肤色包围的深色小簇）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const b64 = fs.readFileSync('source-code/mod-wasteland/sprites/sprite-front.png').toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const b64 = ${JSON.stringify(b64)};
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    // 头部区域（上半部分），找肤色行范围
    let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
        if (d[(y*W+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
    }
    // 脸 = 肤色（R>150 G>90 B>50 R>B）行范围
    const skinRows = [];
    for (let y=mny; y<mny+260; y++) {
        let cnt = 0;
        for (let x=mnx; x<=mxx; x++) {
            const i=(y*W+x)*4;
            if (d[i+3]>120 && d[i]>150 && d[i+1]>90 && d[i+2]>50 && d[i]>d[i+2]) cnt++;
        }
        if (cnt > 15) skinRows.push(y);
    }
    // 脸部 y 范围
    const faceTop = skinRows.length ? skinRows[0] : -1;
    const faceBot = skinRows.length ? skinRows[skinRows.length-1] : -1;
    // 眼睛 = 脸内深色簇（每行的深色像素聚簇）
    const eyes = [];
    for (let y=faceTop; y<=faceBot; y++) {
        // 找该行深色像素段
        let start = -1;
        for (let x=mnx; x<=mxx+1; x++) {
            let isDark = false;
            if (x <= mxx) {
                const i=(y*W+x)*4;
                if (d[i+3]>150 && d[i]<70 && d[i+1]<70 && d[i+2]<70) isDark = true;
            }
            if (isDark && start === -1) start = x;
            if (!isDark && start !== -1) {
                const wd = x - start;
                if (wd >= 1) eyes.push({ y, x1: start, x2: x-1, wd });
                start = -1;
            }
        }
    }
    // 聚簇：把相邻行同列段的眼聚合
    const clusters = [];
    for (const e of eyes) {
        let found = false;
        for (const cl of clusters) {
            if (Math.abs(cl.cy - e.y) <= 4 && Math.abs(cl.cx - (e.x1+e.x2)/2) <= 4) {
                cl.rows++; cl.cy = Math.round((cl.cy*cl.rows + e.y)/(cl.rows+1));
                cl.cx = Math.round((cl.cx*cl.rows + (e.x1+e.x2)/2)/(cl.rows+1));
                cl.minX = Math.min(cl.minX, e.x1); cl.maxX = Math.max(cl.maxX, e.x2);
                found = true; break;
            }
        }
        if (!found) clusters.push({ rows:1, cy:e.y, cx:Math.round((e.x1+e.x2)/2), minX:e.x1, maxX:e.x2 });
    }
    return JSON.stringify({ faceTop, faceBot, eyeClusters: clusters.filter(cl => cl.rows >= 2).map(cl => ({ cx: cl.cx, cy: cl.cy, rows: cl.rows, w: cl.maxX-cl.minX+1 })) });
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);