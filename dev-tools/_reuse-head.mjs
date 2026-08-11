// 素材复用：f1 头部 = f0（1.png）头部、f3 头部 = f2（3.png）头部（正面脸），身体保持原帧
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const srcMap = {
  '1.png': 'C:/Users/24601/Desktop/1.png',
  '2.png': 'C:/Users/24601/Desktop/2.png',
  '3.png': 'C:/Users/24601/Desktop/3.png',
  '4.png': 'C:/Users/24601/Desktop/4.png',
};
const b64s = {};
for (const k in srcMap) b64s[k] = fs.readFileSync(srcMap[k]).toString('base64');

const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const S = ${JSON.stringify(b64s)};
    const load = async (b) => { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load')); img.src = 'data:image/png;base64,' + b; }); return img; };
    const bboxOf = (img) => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const cc = c.getContext('2d'); cc.drawImage(img, 0, 0);
        const d = cc.getImageData(0, 0, c.width, c.height).data;
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
            if (d[(y*c.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        return { c, cc, d, mnx, mny, mxx, mxy, bw: mxx-mnx+1, bh: mxy-mny+1 };
    };
    const HEAD_RATIO = 0.30;   // 头部 = 角色 bbox 上部 30%
    const out = {};
    // ① f1（2.png）：身体=2.png，头部=1.png 头部
    {
        const src = await load(S['1.png']);   // 头部来源（正面）
        const dst = await load(S['2.png']);   // 目标帧
        const sb = bboxOf(src), db = bboxOf(dst);
        // 提取 1.png 头部区域
        const sHeadH = Math.floor(sb.bh * HEAD_RATIO);
        // 目标帧：创建 canvas，先画 dst 全身，再覆盖头部区域为 1.png 头部（缩放到 dst 头部区）
        const cv = document.createElement('canvas'); cv.width = dst.width; cv.height = dst.height;
        const cc = cv.getContext('2d');
        cc.drawImage(dst, 0, 0);
        // 头部目标区域 = dst bbox 上部（相对 dst 原图坐标）
        const tHeadY = db.mny, tHeadH = Math.floor(db.bh * HEAD_RATIO);
        const tHeadX = db.mnx, tHeadW = db.bw;
        // 源头部 = 1.png bbox 上部（按目标宽等比缩放源头部高度）
        const sHeadX = sb.mnx, sHeadW = sb.bw;
        const sHeadScale = tHeadW / sHeadW;
        const sHeadY = sb.mny, sHeadSrcH = Math.floor(sHeadW * sHeadScale);   // 保持宽高比
        // 画源头部到目标头部区域（覆盖原头部）
        cc.drawImage(src, sHeadX, sHeadY, sHeadW, sHeadSrcH, tHeadX, tHeadY, tHeadW, tHeadH);
        out['walk-side-f1.png'] = { w: dst.width, h: dst.height, b64: cv.toDataURL('image/png').split(',')[1] };
    }
    // ② f3（4.png）：身体=4.png，头部=3.png 头部
    {
        const src = await load(S['3.png']);
        const dst = await load(S['4.png']);
        const sb = bboxOf(src), db = bboxOf(dst);
        const cv = document.createElement('canvas'); cv.width = dst.width; cv.height = dst.height;
        const cc = cv.getContext('2d');
        cc.drawImage(dst, 0, 0);
        const tHeadY = db.mny, tHeadH = Math.floor(db.bh * HEAD_RATIO);
        const tHeadX = db.mnx, tHeadW = db.bw;
        const sHeadX = sb.mnx, sHeadW = sb.bw;
        const sHeadScale = tHeadW / sHeadW;
        const sHeadY = sb.mny, sHeadSrcH = Math.floor(sHeadW * sHeadScale);
        cc.drawImage(src, sHeadX, sHeadY, sHeadW, sHeadSrcH, tHeadX, tHeadY, tHeadW, tHeadH);
        out['walk-side-f3.png'] = { w: dst.width, h: dst.height, b64: cv.toDataURL('image/png').split(',')[1] };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
if (r.error || !r.result.value) { console.log('ERROR:', JSON.stringify(r.error || r.result)); process.exit(1); }
const res = JSON.parse(r.result.value);
for (const f in res) {
    fs.writeFileSync('source-code/mod-wasteland/sprites/' + f, Buffer.from(res[f].b64, 'base64'));
    console.log(f, '→ 头部复用（正面脸）', res[f].w + 'x' + res[f].h);
}
process.exit(0);