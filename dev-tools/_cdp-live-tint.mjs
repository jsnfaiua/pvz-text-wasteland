// CDP 强制 reload + 模拟红橙深蓝肉色配色 + 截图走路帧
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
await sendMethod('Page.reload', { ignoreCache: true });
await sleep(2500);
// 设置 role skin/styled 配色
const save = JSON.stringify({
  v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null,
  mods: { tiles: {}, chests: {}, boxLoot: {} },
  character: {
    skin: '#f0c8a0', hair: '#c0392b', shirt: '#e67e22', pants: '#1a3a5c', shoes: '#5d3a1a',
  },
});
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await sendMethod('Runtime.evaluate', { expression: `(async () => { const st = await import('./source-code/core/state.js'); st.setSaveData({ ...st.saveData, devMode: true }); const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'entered'; })()`, awaitPromise: true, returnByValue: true });
await sleep(6000);
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 500; sv.py = 500; sv.faceX = 1; sv.faceY = 0; sv.animMoving = true; sv.animFrame = 0; sv.stepT = 0.36; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'walk e'; })()` });
await sleep(800);
const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
fs.writeFileSync('dev-tools/_qa_tmp/live-walk-tint.png', Buffer.from(s.result.value, 'base64'));
console.log('live-walk-tint 已拍');
// 检查鞋区蓝像素
const r = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const b64 = ${JSON.stringify(s.result.value)};
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    // 玩家位置（之前测得 hairX=126, 范围±30）
    const px = 126;
    let blueInShoe = 0;
    for (let y = Math.floor(H*0.85); y < H; y++) for (let x = px-20; x < px+20; x++) {
        const i = (y*W+x)*4;
        if (d[i+3] < 100) continue;
        if (d[i+2] > 80 && d[i+2] - d[i] > 40 && d[i+2] - d[i+1] > 30) blueInShoe++;
    }
    return JSON.stringify({ blueInShoe });
})()`, awaitPromise: true, returnByValue: true });
console.log('鞋区亮蓝像素:', r.result.value);
process.exit(0);