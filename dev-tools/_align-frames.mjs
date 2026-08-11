// 逐像素对齐素材：统一画布 + 躯干中心对齐（身体不晃）+ 脚底对齐 + 检测眼睛位置
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const srcMap = {
  'walk-side-f0.png': 'C:/Users/24601/Desktop/1.png',
  'walk-side-f1.png': 'C:/Users/24601/Desktop/2.png',
  'walk-side-f2.png': 'C:/Users/24601/Desktop/3.png',
  'walk-side-f3.png': 'C:/Users/24601/Desktop/4.png',
};
const b64s = {};
for (const k in srcMap) b64s[k] = fs.readFileSync(srcMap[k]).toString('base64');

const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const S = ${JSON.stringify(b64s)};
    const W0 = 405, H0 = 632;
    const FOOT_Y = 628;   // 脚底统一（略留边）
    const load = async (b) => { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load')); img.src = 'data:image/png;base64,' + b; }); return img; };
    const analyze = (img) => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const d = cc.getImageData(0, 0, c.width, c.height).data;
        const W = c.width, H = c.height;
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
            if (d[(y*W+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        const bh = mxy-mny+1;
        // 躯干区域 = bbox y 35%~65%（避开腿/手臂张开影响），取衣服绿像素 x 中心
        const torsoTop = mny + Math.floor(bh*0.35), torsoBot = mny + Math.floor(bh*0.65);
        let sxSum = 0, sn = 0;
        for (let y=torsoTop; y<torsoBot; y++) for (let x=mnx; x<=mxx; x++) {
            const i=(y*W+x)*4;
            if (d[i+3]<120) continue;
            const rr=d[i],gg=d[i+1],bb=d[i+2];
            if (gg >= rr+15 && gg >= 45) { sxSum += x; sn++; }   // 衣服绿
        }
        const torsoCX = sn ? sxSum / sn : (mnx+mxx)/2;
        // 眼睛 = 头部（bbox 上部 25%）深色像素中心
        const headTop = mny, headBot = mny + Math.floor(bh*0.25);
        let exSum = 0, eySum = 0, en = 0;
        for (let y=headTop; y<headBot; y++) for (let x=mnx; x<=mxx; x++) {
            const i=(y*W+x)*4;
            if (d[i+3]<140) continue;
            if (d[i]<60 && d[i+1]<60 && d[i+2]<60) { exSum += x; eySum += y; en++; }
        }
        const eye = en ? { x: exSum/en, y: eySum/en } : null;
        // 脚底
        const footY = mxy;
        return { c, cc, d, W, H, mnx, mny, mxx, mxy, bh, torsoCX, eye, footY };
    };
    const out = {};
    const infos = {};
    for (const f in S) {
        const img = await load(S[f]);
        infos[f] = analyze(img);
        out[f] = { b64: img.src.split(',')[1], W: img.width, H: img.height };
    }
    // 参考帧 = f0（1.png）
    const ref = infos['walk-side-f0.png'];
    const RES = {};
    // 对齐：每帧躯干中心 x → 画布中心 202；脚底 → FOOT_Y
    for (const f in S) {
        const info = infos[f];
        const dx = Math.round(W0/2 - info.torsoCX);
        const dy = FOOT_Y - info.footY;
        const img = await load(S[f]);
        const cv = document.createElement('canvas'); cv.width = W0; cv.height = H0;
        const cc = cv.getContext('2d');
        cc.drawImage(img, dx, dy);
        RES[f] = { dx, dy, torsoCX: info.torsoCX.toFixed(1), eye: info.eye ? info.eye.x.toFixed(1)+','+info.eye.y.toFixed(1) : 'none', b64: cv.toDataURL('image/png').split(',')[1] };
    }
    return JSON.stringify({ info: Object.fromEntries(Object.entries(infos).map(([k,v]) => [k, {torsoCX: v.torsoCX.toFixed(1), eye: v.eye ? v.eye.x.toFixed(1)+','+v.eye.y.toFixed(1) : 'none', footY: v.footY}])), RES });
})()`, awaitPromise: true, returnByValue: true });
if (r.error || !r.result.value) { console.log('ERR:', JSON.stringify(r.error || r.result)); process.exit(1); }
const res = JSON.parse(r.result.value);
console.log('== 原始检测 ==');
for (const k in res.info) console.log(k, '躯干中心x:', res.info[k].torsoCX, '眼睛:', res.info[k].eye, '脚底:', res.info[k].footY);
console.log('== 对齐结果 ==');
for (const f in res.RES) {
    fs.writeFileSync('source-code/mod-wasteland/sprites/' + f, Buffer.from(res.RES[f].b64, 'base64'));
    console.log(f, 'dx=' + res.RES[f].dx, 'dy=' + res.RES[f].dy, '（躯干→202, 脚底→628）');
}
process.exit(0);