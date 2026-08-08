// 像素差对比（CDP 浏览器内 canvas getImageData）
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };

// 把截图直接显示在浏览器页面里、用 getImageData 比较
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const names = ['sprite-east-f0.png', 'sprite-east-f1.png', 'sprite-west-f0.png', 'sprite-idle-side.png'];
    const datas = {};
    for (const n of names) {
        const resp = await fetch('http://localhost:8000/index.html').catch(() => null);
        // 截图不在 server 公开路径，换 base64 注入
        datas[n] = null;
    }
    return 'noop';
})()`, awaitPromise: true, returnByValue: true });

// 直接读 PNG 文件 → base64 注入浏览器
const fs = await import('fs');
const files = ['sprite-east-f0.png', 'sprite-east-f1.png', 'sprite-west-f0.png', 'sprite-idle-side.png'];
const b64s = {};
for (const f of files) {
    const p = 'dev-tools/_qa_tmp/' + f;
    b64s[f] = fs.readFileSync(p).toString('base64');
}

const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const B64 = ${JSON.stringify(b64s)};
    const datas = {};
    for (const k in B64) {
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + B64[k]; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        datas[k] = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    }
    function diff(a, b) {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
            if (a[i+3] > 10 && (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2])) n++;
        }
        return n;
    }
    return JSON.stringify({
        east_f0_vs_f1: diff(datas['sprite-east-f0.png'], datas['sprite-east-f1.png']),
        east_f0_vs_west: diff(datas['sprite-east-f0.png'], datas['sprite-west-f0.png']),
        east_f0_vs_idle: diff(datas['sprite-east-f0.png'], datas['sprite-idle-side.png']),
        east_f1_vs_idle: diff(datas['sprite-east-f1.png'], datas['sprite-idle-side.png']),
        W: datas['sprite-east-f0.png'].length / 4,
    });
})()`, awaitPromise: true, returnByValue: true });
console.log(r2.result.value);
process.exit(0);