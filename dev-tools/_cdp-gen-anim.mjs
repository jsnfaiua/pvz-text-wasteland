// 用浏览器真实渲染函数生成走路动画帧序列(4 方向 × 走/跑 × 3 帧 = 24 张 PNG)
// 供 anim-preview.html 循环播放,用户实时预览动画确定帧
// 前置: node server.js + headless Chrome(:9222)
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';

async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
const tabs = await getJson('/json');
const tab = tabs.find(t => t.type === 'page') || tabs[0];
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = (expr, ap = false) => send('Runtime.evaluate', { expression: expr, awaitPromise: ap, returnByValue: true }).then(r => r.exceptionDetails ? { err: r.exceptionDetails.text + '|' + (r.exceptionDetails.exception?.description || '') } : r.result?.value);

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: PAGE_URL });
await new Promise(r => setTimeout(r, 3000));
await send('Network.clearBrowserCache');
await send('Page.reload', { ignoreCache: true });
await new Promise(r => setTimeout(r, 4000));

const result = await ev(`(async () => {
    const m = await import('./source-code/mod-wasteland/render.js');
    const look = { skin:'#f0c8a0', hair:'#4a2f1b', shirt:'#3a7d44', pants:'#3a4a6a', shoes:'#5a4632', eyes:'#2c2c2c', hairStyle:0 };
    const dirs = [
        { d:'down',  a:'down'  },  // 正面
        { d:'left',  a:'left'  },  // 侧左
        { d:'up',    a:'up'    },  // 背面
        { d:'right', a:'right' },  // 侧右
    ];
    const modes = [ { m:'walk', run:false }, { m:'run', run:true } ];
    const frames = [];
    for (const dir of dirs) for (const mode of modes) for (let f = 0; f < 3; f++) {
        const cv = document.createElement('canvas');
        cv.width = 48; cv.height = 96;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const anim = { dir: dir.a, frame: f, moving: true, run: mode.run };
        for (let py = 0; py < 96; py++) for (let px = 0; px < 48; px++) {
            const c = m.playerBodyColorAt(px, py, look.shirt, look, anim);
            if (c) { ctx.fillStyle = c; ctx.fillRect(px, py, 1, 1); }
        }
        frames.push({ name: 'anim-' + dir.d + '-' + mode.m + '-f' + f, data: cv.toDataURL('image/png').slice(22) });
    }
    return JSON.stringify(frames);
})()`, true);

if (result.err) { console.error('生成失败:', result.err); process.exit(1); }
const frames = JSON.parse(result);
import fs from 'node:fs';
for (const f of frames) {
    fs.writeFileSync('dev-tools/_qa_tmp/' + f.name + '.png', Buffer.from(f.data, 'base64'));
}
console.log('生成', frames.length, '帧:', frames.map(f => f.name).join(', '));
process.exit(0);