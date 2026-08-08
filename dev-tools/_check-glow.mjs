// 验证：玩家周围无绿色光晕残留 + 原图颜色
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const b64 = fs.readFileSync('dev-tools/_qa_tmp/4f-east-f0.png').toString('base64');
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,${b64}'; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const W = c.width;
    const px = (x,y) => { const i=(y*W+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]]; };
    // 玩家 bbox（画面中心附近亮色像素）
    const cx = W>>1, cy = c.height>>1;
    let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
    for (let y=cy-80; y<cy+60; y++) for (let x=cx-40; x<cx+40; x++) {
        const [r2,g2,b2,a]=px(x,y);
        if (a>200 && (r2>50||g2>50||b2>50)) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
    }
    // 玩家 bbox 外扩 8px 环带：统计"半透明绿色发光"（shadowBlur 特征 = 低 alpha + 绿色调）
    let glow = 0, semi = 0;
    for (let y=mny-8; y<=mxy+8; y++) for (let x=mnx-8; x<=mxx+8; x++) {
        const inBox = x>=mnx && x<=mxx && y>=mny && y<=mxy;
        if (inBox) continue;
        if (x<0||y<0||x>=W||y>=c.height) continue;
        const [r2,g2,b2,a]=px(x,y);
        if (a>20 && a<200) { semi++; if (g2>r2+20 && g2>b2+10) glow++; }
    }
    // 玩家主体颜色（bbox 内绿衣像素）
    let green=0, skin=0;
    for (let y=mny; y<=mxy; y++) for (let x=mnx; x<=mxx; x++) {
        const [r2,g2,b2,a]=px(x,y);
        if (a<200) continue;
        if (g2>100 && r2<130 && b2<130) green++;
        if (r2>150 && g2>100 && b2>60 && r2>b2) skin++;
    }
    return JSON.stringify({ bbox:[mnx,mny,mxx,mxy], glowSemiPx: glow, semiTotal: semi, greenPx: green, skinPx: skin });
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);