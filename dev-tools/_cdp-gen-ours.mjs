// 用浏览器真实渲染函数生成"我们的实现"4 方向帧(28x33),输出 base64 供 Node 合成对照图
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

// 用游戏真实渲染函数生成 4 帧
const result = await ev(`(async () => {
    const m = await import('./source-code/mod-wasteland/render.js');
    const look = { skin:'#f0c8a0', hair:'#4a2f1b', shirt:'#3a7d44', pants:'#3a4a6a', shoes:'#5a4632', eyes:'#2c2c2c', hairStyle:0 };
    const frames = [];
    const defs = [
        { name:'front', anim:null },
        { name:'side-left', anim:{ dir:'left', frame:0, moving:true } },
        { name:'back', anim:{ dir:'up', frame:0, moving:false } },
        { name:'side-right', anim:{ dir:'right', frame:0, moving:true } },
        // 侧视走路 3 帧(前后脚交替+手摆动)
        { name:'side-right-frame0', anim:{ dir:'right', frame:0, moving:true } },
        { name:'side-right-frame1', anim:{ dir:'right', frame:1, moving:true } },
        { name:'side-right-frame2', anim:{ dir:'right', frame:2, moving:true } },
        { name:'side-left-frame0', anim:{ dir:'left', frame:0, moving:true } },
        { name:'side-left-frame1', anim:{ dir:'left', frame:1, moving:true } },
        { name:'side-left-frame2', anim:{ dir:'left', frame:2, moving:true } },
        // 静止侧视(站立朝左/右,应与动画帧同侧视轮廓)
        { name:'side-right-idle', anim:{ dir:'right', frame:0, moving:false } },
        { name:'side-left-idle', anim:{ dir:'left', frame:0, moving:false } },
    ];
    for (const d of defs) {
        const cv = document.createElement('canvas');
        cv.width = 48; cv.height = 96;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        for (let py = 0; py < 96; py++) for (let px = 0; px < 48; px++) {
            const c = m.playerBodyColorAt(px, py, look.shirt, look, d.anim);
            if (c) { ctx.fillStyle = c; ctx.fillRect(px, py, 1, 1); }
        }
        frames.push({ name: d.name, data: cv.toDataURL('image/png').slice(22) });
    }
    return JSON.stringify(frames);
})()`, true);

if (result.err) { console.error('生成失败:', result.err); process.exit(1); }
const frames = JSON.parse(result);
console.log('帧生成:', frames.map(f => f.name).join(', '));
// 输出到 stdout 前面加标记, Node 侧解析? 直接写文件更稳
import fs from 'node:fs';
for (const f of frames) {
    fs.writeFileSync('dev-tools/_qa_tmp/ours-' + f.name + '.png', Buffer.from(f.data, 'base64'));
    console.log('写出 ours-' + f.name + '.png');
}
process.exit(0);