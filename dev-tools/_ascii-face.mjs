// ASCII 渲染 sprite-front 脸部区域（看清眼睛）
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
    // 脸部区域：y 60~200, x 30~240，放大渲染（每像素 1 字符）
    let art = '';
    for (let y = 55; y < 200; y++) {
        let line = '';
        for (let x = 30; x < 240; x++) {
            const i=(y*W+x)*4;
            if (d[i+3] < 100) { line += '.'; continue; }
            const rr=d[i], gg=d[i+1], bb=d[i+2];
            let ch = '#';
            if (rr>150 && gg>90 && bb>50 && rr>bb) ch = 'S';      // 肤色
            else if (rr<70 && gg<70 && bb<70) ch = 'd';            // 深色（眼/发）
            else if (rr>90 && gg>90 && bb<90) ch = 'y';            // 棕发
            else if (gg >= rr+15 && gg>=45) ch = 'G';              // 绿衣
            line += ch;
        }
        art += line + '\n';
    }
    return art;
})()`, awaitPromise: true, returnByValue: true });
console.log(r.result.value);
process.exit(0);