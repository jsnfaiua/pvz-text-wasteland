// 渲染朝东/朝西截图玩家区域，看脸朝哪边
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const files = ['walk-east-f0.png', 'walk-west-f0.png'];
const b64s = {};
for (const f of files) b64s[f] = fs.readFileSync('dev-tools/_qa_tmp/' + f).toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B64 = ${JSON.stringify(b64s)};
    const out = {};
    for (const k in B64) {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + B64[k]; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        // 全图找玩家：画面中心 ±80 内，肤色像素（脸）
        const cx = c.width >> 1, cy = c.height >> 1;
        const px = (x,y) => { const i=(y*c.width+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]]; };
        // 玩家 bbox（亮色像素）
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=cy-100; y<cy+60; y++) for (let x=cx-60; x<cx+60; x++) {
            const [r2,g2,b2,a] = px(x,y);
            if (a>200 && (r2>50 || g2>50 || b2>50)) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        if (mnx===1e9) { out[k] = 'player not found'; continue; }
        // 头部（玩家 bbox 上部 30%）左右肤色分布
        const headTop=mny, headBot=mny+Math.floor((mxy-mny)*0.30), headW=mxx-mnx+1;
        let leftSkin=0, rightSkin=0;
        for (let y=headTop; y<headBot; y++) for (let x=mnx; x<=mxx; x++) {
            const [r2,g2,b2,a] = px(x,y);
            if (a<100) continue;
            if (r2>150 && g2>100 && b2>60 && r2>b2) {
                if (x < mnx+headW*0.4) leftSkin++;
                if (x > mxx-headW*0.4) rightSkin++;
            }
        }
        out[k] = { playerBBox: [mnx,mny,mxx,mxy], headSkin: { L: leftSkin, R: rightSkin }, facing: rightSkin>leftSkin?'脸朝右(东)':(leftSkin>rightSkin?'脸朝左(西)':'中') };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);