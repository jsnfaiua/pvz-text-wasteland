// 分析 ec6f8（图1）与 62a68（图2）的朝向 + 脚部差异
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const files = {
  'f1_ec6f8': 'C:/Users/24601/Desktop/ec6f8fe59366d36b3e61233d71ede4f7.png',
  'f2_62a68': 'C:/Users/24601/Desktop/62a681d021750ea7153270bf40108f83.png',
};
const b64s = {};
for (const k in files) b64s[k] = fs.readFileSync(files[k]).toString('base64');
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
        // 不透明 bbox
        let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
            if (d[(y*c.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
        }
        // 头部（bbox 上部 20%）左右肤色/发色分布（判断脸朝向）
        const headTop = mny, headBot = mny + Math.floor((mxy-mny)*0.20);
        const headW = mxx-mnx+1;
        let leftSkin=0, rightSkin=0, leftDark=0, rightDark=0;
        for (let y=headTop; y<headBot; y++) for (let x=mnx; x<=mxx; x++) {
            const i=(y*c.width+x)*4;
            if (d[i+3]<40) continue;
            const rr=d[i],gg=d[i+1],bb=d[i+2];
            const isSkin = rr>150 && gg>100 && bb>60 && rr>bb;
            const isDark = rr<90 && gg<90 && bb<90;
            if (x < mnx + headW*0.35) { if(isSkin)leftSkin++; if(isDark)leftDark++; }
            if (x > mxx - headW*0.35) { if(isSkin)rightSkin++; if(isDark)rightDark++; }
        }
        // 脚部区域（bbox 底部 30%）：左右脚的位置
        const footTop = mny + Math.floor((mxy-mny)*0.70);
        let footLeft=0, footRight=0, footLeftX=0, footRightX=0;
        const footW = mxx-mnx+1;
        for (let y=footTop; y<=mxy; y++) for (let x=mnx; x<=mxx; x++) {
            const i=(y*c.width+x)*4;
            if (d[i+3]<40) continue;
            const rr=d[i],gg=d[i+1],bb=d[i+2];
            const isFoot = rr<120 && gg<110 && bb<100;   // 深色鞋/裤
            if (isFoot) {
                if (x < mnx + footW*0.45) { footLeft++; footLeftX += x; }
                if (x > mxx - footW*0.45) { footRight++; footRightX += x; }
            }
        }
        out[k] = {
            size: c.width+'x'+c.height, bbox: [mnx,mny,mxx,mxy],
            head: { L: {skin:leftSkin,dark:leftDark}, R: {skin:rightSkin,dark:rightDark},
                    verdict: rightSkin>leftSkin+3?'face-RIGHT':(leftSkin>rightSkin+3?'face-LEFT':'CENTER?') },
            feet: { left: footLeft, right: footRight, leftAvgX: footLeftX/Math.max(1,footLeft), rightAvgX: footRightX/Math.max(1,footRight) },
        };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);