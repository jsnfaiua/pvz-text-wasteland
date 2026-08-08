// 采样 front-walk 精确发色 + 把 walk-side 4 帧头发重着色为一致
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const sp = 'source-code/mod-wasteland/sprites/';
const frontB64 = fs.readFileSync(sp + 'walk-front-f2.png').toString('base64');
const sideFiles = ['walk-side-f0.png', 'walk-side-f1.png', 'walk-side-f2.png', 'walk-side-f3.png'];
const sideB64s = {};
for (const f of sideFiles) sideB64s[f] = fs.readFileSync(sp + f).toString('base64');

const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const load = async (b) => {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return c;
    };
    // ① 采样 front-walk 头发精确色（头部区域非肤色像素平均）
    const front = await load('${frontB64}');
    const fd = front.getContext('2d').getImageData(0, 0, front.width, front.height).data;
    let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
    for (let y=0;y<front.height;y++) for (let x=0;x<front.width;x++) {
        if (fd[(y*front.width+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
    }
    const hTop = mny, hBot = mny + Math.floor((mxy-mny)*0.25);
    let sumR=0,sumG=0,sumB=0,n=0, samples=[];
    for (let y=hTop; y<hBot; y++) for (let x=mnx; x<=mxx; x++) {
        const i=(y*front.width+x)*4;
        if (fd[i+3]<100) continue;
        const rr=fd[i],gg=fd[i+1],bb=fd[i+2];
        if (rr>150 && gg>100 && bb>60 && rr>bb) continue;  // 肤色跳过
        if (rr<60 && gg<60 && bb<60) continue;  // 纯黑跳过
        sumR+=rr; sumG+=gg; sumB+=bb; n++;
        if (samples.length<20) samples.push([rr,gg,bb]);
    }
    const hairR=Math.round(sumR/n), hairG=Math.round(sumG/n), hairB=Math.round(sumB/n);

    // ② 把 side 4 帧头发重着色为 hairR/hairG/hairB
    const SIDE = ${JSON.stringify(sideB64s)};
    const out = {};
    for (const f in SIDE) {
        const c2 = await load(SIDE[f]);
        const ctx2 = c2.getContext('2d');
        const id2 = ctx2.getImageData(0, 0, c2.width, c2.height);
        const d2 = id2.data;
        let changed = 0;
        for (let i = 0; i < d2.length; i += 4) {
            if (d2[i+3] < 100) continue;
            const rr=d2[i], gg=d2[i+1], bb=d2[i+2];
            // 头发判定：亮棕黄（R 明显>G>B，R 100-190，G 55-130，B 15-90）→ 替换为 front 深棕
            if (rr>=95 && rr<=200 && gg>=50 && gg<=135 && bb>=12 && bb<=95 && rr>gg && gg>bb) {
                d2[i]=hairR; d2[i+1]=hairG; d2[i+2]=hairB; changed++;
            }
        }
        ctx2.putImageData(id2, 0, 0);
        out[f] = { changed, b64: c2.toDataURL('image/png').split(',')[1] };
    }
    return JSON.stringify({ hairColor: [hairR,hairG,hairB], hairSamples: samples, results: out });
})()`, awaitPromise: true, returnByValue: true });

const res = JSON.parse(r.result.value);
console.log('front 发色:', JSON.stringify(res.hairColor), '样本:', JSON.stringify(res.hairSamples));
// 保存重着色后的 side 4 帧
for (const f in res.results) {
    fs.writeFileSync(sp + f, Buffer.from(res.results[f].b64, 'base64'));
    console.log(f, '→ 头发重着色', res.results[f].changed, '像素');
}
process.exit(0);