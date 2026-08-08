// 放大渲染图1/图2 头部 ASCII（看脸/眼睛/头发位置判断朝向）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const files = {
  '图1_ec6f8': 'C:/Users/24601/Desktop/ec6f8fe59366d36b3e61233d71ede4f7.png',
  '图2_62a68': 'C:/Users/24601/Desktop/62a681d021750ea7153270bf40108f83.png',
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
        // 头部区域 = bbox 上部 22%
        const hTop = mny, hBot = mny + Math.floor((mxy-mny)*0.22);
        const hW = mxx-mnx+1, hH = hBot-hTop+1;
        // 放大渲染头部（每像素块 3x3）
        const aw = hW, ah = hH;
        // 限制宽度 90
        const scale = Math.min(1, 90 / aw);
        const oaw = Math.max(20, Math.round(aw*scale)), oah = Math.max(20, Math.round(ah*scale));
        let art = '';
        for (let y = 0; y < oah; y++) {
            let row = '';
            for (let x = 0; x < oaw; x++) {
                const X = mnx + Math.floor(x/scale), Y = hTop + Math.floor(y/scale);
                const i=(Y*c.width+X)*4;
                const rr=d[i],gg=d[i+1],bb=d[i+2],a=d[i+3];
                if (a<40) { row += ' '; continue; }
                let ch2;
                if (rr>170 && gg>120 && bb>80 && rr>bb) ch2 = 'S';        // 肤色（脸）
                else if (rr>100 && rr<160 && gg>70 && gg<120 && bb<90) ch2 = 's';  // 暗肤色
                else if (rr<80 && gg<80 && bb<80) ch2 = '#';              // 深色（头发）
                else if (gg>100 && rr<120) ch2 = 'G';                     // 绿
                else ch2 = '+';
                row += ch2;
            }
            art += row + '\\n';
        }
        out[k] = { bbox: [mnx,mny,mxx,mxy], head: [hTop, hBot], art };
    }
    return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true });
const res = JSON.parse(r.result.value);
for (const k in res) {
    console.log('=== ' + k + ' 头部 (' + res[k].head.join('-') + ') ===');
    console.log(res[k].art);
}
process.exit(0);