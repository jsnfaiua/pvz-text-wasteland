// 生成侧视图 28x33 像素网格 ASCII 预览(用 render.js 真实渲染函数)
// 字符映射: S=肤色 H=头发 C=上衣 P=裤 K=鞋 E=眼睛 M=嘴 D=阴影 L=高光 .=空
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

const ascii = await ev(`(async () => {
    const m = await import('./source-code/mod-wasteland/render.js');
    const look = { skin:'#f0c8a0', hair:'#4a2f1b', shirt:'#3a7d44', pants:'#3a4a6a', shoes:'#5a4632', eyes:'#2c2c2c', hairStyle:0 };
    const anim = { dir:'left', frame:0, moving:true }; // 朝左迈步帧
    // 精确色板: 用 lookShades 的所有派生色做字符映射
    const shades = m.__lookShadesForAscii ? m.__lookShadesForAscii(look) : null;
    const out = [];
    for (let py = 0; py < 33; py++) {
        let line = '';
        for (let px = 0; px < 28; px++) {
            const c = m.playerBodyColorAt(px, py, look.shirt, look, anim);
            if (!c) { line += '.'; continue; }
            // 精确匹配: 与已知色板比较
            const pal = [
                ['S', look.skin], ['s', m.mixHexColor ? mixHex(look.skin,'#3d2a1c',0.38) : ''],
                ['H', look.hair], ['h', m.mixHexColor ? mixHex(look.hair,'#ffffff',0.24) : ''],
                ['C', look.shirt], ['P', look.pants], ['K', look.shoes], ['E', look.eyes],
            ];
            let ch = '?';
            for (const [pch, pc] of pal) {
                if (pc && c.toLowerCase() === pc.toLowerCase()) { ch = pch; break; }
            }
            if (ch === '?') {
                // 派生色近似: 直接比较 RGB 距离
                const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
                // 深色(眉/嘴/暗部)
                if (r<90 && g<70 && b<80) ch='d';
                else if (r<140 && g>80 && b<90) ch='m'; // 嘴/颊偏红
                else if (r>140 && g<110 && b<100) ch='r'; // 红
                else if (b>120 && g>100) ch='P'; // 蓝
                else if (r>150 && g>120 && b<100) ch='K'; // 棕
                else if (r>220 && g>210) ch='w'; // 白高光
                else if (g>100 && r<120 && b<110) ch='C'; // 绿
                else if (r>150 && g>140 && b>110) ch='S'; // 肤
                else ch='?';
            }
            line += ch;
        }
        out.push(String(py).padStart(2) + ' ' + line);
    }
    return out.join('\\n');
    function mixHex(a, b, t) {
        const ar = parseInt(a.slice(1,3),16), ag = parseInt(a.slice(3,5),16), ab = parseInt(a.slice(5,7),16);
        const br = parseInt(b.slice(1,3),16), bg = parseInt(b.slice(3,5),16), bb = parseInt(b.slice(5,7),16);
        const rr = Math.round(ar+(br-ar)*t), rg = Math.round(ag+(bg-ag)*t), rb = Math.round(ab+(bb-ab)*t);
        return '#' + [rr,rg,rb].map(v => v.toString(16).padStart(2,'0')).join('');
    }
})()`, true);

if (ascii.err) { console.error(ascii.err); process.exit(1); }
console.log('=== 侧视图(朝左, 迈步帧) 28x33 像素网格 ===');
console.log('S=肤 H=发 C=衣 P=裤 K=鞋 E=深色(眼/眉) L=白 . =空');
console.log(ascii);