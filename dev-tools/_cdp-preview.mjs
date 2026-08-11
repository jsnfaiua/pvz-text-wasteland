// CDP 预览：四方向走路帧截图 + 玩家大小一致性分析（新规则：先预览确认预期）
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
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 300; sv.py = 300; sv.faceX = 1; sv.faceY = 0; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(800);

const snap = async (name, fx, fy, frame) => {
    await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.faceX = ${fx}; sv.faceY = ${fy}; sv.animFrame = ${frame}; sv.animMoving = true; sv.stepT = 0.36; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return '${name}'; })()` });
    await sleep(400);
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (!s.result.value) return 'no-shot';
    fs.writeFileSync(outDir + '/' + name + '.png', Buffer.from(s.result.value, 'base64'));
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const b64 = ${JSON.stringify(s.result.value)};
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const W = c.width, H = c.height;
        const cx = W>>1, cy = H>>1;
        // 玩家 = 中心区域与地面(28,29,38)差异大的像素（宽松阈值抓全轮廓）
        let xs=[], ys=[];
        for (let y=cy-90; y<cy+20; y++) for (let x=cx-50; x<cx+50; x++) {
            const i=(y*W+x)*4;
            if (d[i+3]>120 && (Math.abs(d[i]-28)+Math.abs(d[i+1]-29)+Math.abs(d[i+2]-38)) > 45) { xs.push(x); ys.push(y); }
        }
        if (!xs.length) return 'none';
        return JSON.stringify({ w: Math.max(...xs)-Math.min(...xs)+1, h: Math.max(...ys)-Math.min(...ys)+1, n: xs.length });
    })()`, awaitPromise: true, returnByValue: true });
    return r2.result.value;
};

const results = {};
results['朝东 f0'] = await snap('prev-east-f0', 1, 0, 0);
results['朝东 f1'] = await snap('prev-east-f1', 1, 0, 1);
results['朝东 f2'] = await snap('prev-east-f2', 1, 0, 2);
results['朝东 f3'] = await snap('prev-east-f3', 1, 0, 3);
results['朝西 f1'] = await snap('prev-west-f1', -1, 0, 1);
results['朝南 f0'] = await snap('prev-south-f0', 0, 1, 0);
results['朝北 f0'] = await snap('prev-north-f0', 0, -1, 0);
for (const k in results) console.log(k.padEnd(10), '→', results[k]);

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
process.exit(0);