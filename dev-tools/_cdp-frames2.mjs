// 精确渲染走路帧：直接调 drawPixelPlayerBody（指定 dir/frame/moving），不走主循环
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');
const outDir = 'dev-tools/_qa_tmp';
fs.mkdirSync(outDir, { recursive: true });
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await sendMethod('Runtime.evaluate', { expression: `(async () => { const st = await import('./source-code/core/state.js'); st.setSaveData({ ...st.saveData, devMode: true }); const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'entered'; })()`, awaitPromise: true, returnByValue: true });
await sleep(6000);

// 精确渲染一帧：返回 base64
const renderOne = async (name, dir, frame, moving) => {
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const R = await import('./source-code/mod-wasteland/render.js');
        const cv = document.createElement('canvas');
        cv.width = 220; cv.height = 140;   // 角色居中区域（画布中心 480,270 附近）
        const c = cv.getContext('2d');
        c.fillStyle = '#1c2230';           // 背景（模拟地面暗色）
        c.fillRect(0, 0, 220, 140);
        // 角色画在 canvas 中心 (110, 96)，脚底 y=96 留 44px 空白
        const anim = { dir: ${JSON.stringify(dir)}, frame: ${moving ? frame : 'null'}, moving: ${moving} };
        R.drawPixelPlayerBody(c, 110, 96, '#39d98a', 0, null, anim);
        return cv.toDataURL('image/png').split(',')[1];
    })()`, awaitPromise: true, returnByValue: true });
    if (r2.result.value) { fs.writeFileSync(outDir + '/' + name + '.png', Buffer.from(r2.result.value, 'base64')); return 'saved'; }
    return 'FAIL';
};

// 待机 3 方向
console.log('朝南待机:', await renderOne('v2-idle-south', 'down', 0, false));
console.log('朝东待机:', await renderOne('v2-idle-east', 'right', 0, false));
console.log('朝北待机:', await renderOne('v2-idle-north', 'up', 0, false));
// 朝东 4 帧
for (let f = 0; f < 4; f++) console.log('朝东 帧' + f + ':', await renderOne('v2-east-f' + f, 'right', f, true));
// 朝西 4 帧
for (let f = 0; f < 4; f++) console.log('朝西 帧' + f + ':', await renderOne('v2-west-f' + f, 'left', f, true));
// 朝南 2 帧
console.log('朝南 帧0:', await renderOne('v2-south-f0', 'down', 0, true));
console.log('朝南 帧1:', await renderOne('v2-south-f1', 'down', 1, true));
// 朝北 4 帧
for (let f = 0; f < 4; f++) console.log('朝北 帧' + f + ':', await renderOne('v2-north-f' + f, 'up', f, true));

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
console.log('异常:', exceptions.length);
process.exit(0);