// CDP 验证：朝东/朝西走路玩家脸朝向 + 两帧交替
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
await sendMethod('Page.enable'); await sendMethod('Runtime.enable');
await sendMethod('Network.enable'); await sendMethod('Network.clearBrowserCache');
await sendMethod('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3500);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await sendMethod('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
const ent = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const st = await import('./source-code/core/state.js');
    st.setSaveData({ ...st.saveData, devMode: true });
    const m = await import('./source-code/mod-wasteland/survival.js');
    window.__surv = m; m.enterWasteland({}); return 'entered';
})()`, awaitPromise: true, returnByValue: true });
console.log('enter:', ent.result.value);
await sleep(5000);
await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 200; sv.py = 200; if (sv._zombiePathRevision != null) sv._zombiePathRevision++; return 'tp'; })()` });
await sleep(900);

// sprite 状态
const spr = await sendMethod('Runtime.evaluate', { expression: `(async () => {
    const r = await import('./source-code/mod-wasteland/render.js');
    return JSON.stringify({
        side0: r._mcWalk.side[0] ? r._mcWalk.side[0].width + 'x' + r._mcWalk.side[0].height + (r._mcWalk.side[0].tagName==='CANVAS'?'[canvas]':'[img]') : null,
        side1: r._mcWalk.side[1] ? r._mcWalk.side[1].width + 'x' + r._mcWalk.side[1].height + (r._mcWalk.side[1].tagName==='CANVAS'?'[canvas]':'[img]') : null,
    });
})()`, awaitPromise: true, returnByValue: true });
console.log('sprite:', spr.result.value);

// 截图函数：朝东/朝西 + 分析脸朝向（玩家头部肤色位置）
const snapAndFacing = async (name, frame, moving, faceX) => {
    await sendMethod('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.animFrame = ${frame}; sv.animMoving = ${moving}; sv.stepT = 0.18; sv.faceX = ${faceX}; sv.faceY = 0;
        if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
        return 'set';
    })()` });
    await sleep(400);
    const s = await sendMethod('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (!s.result.value) return { name, fail: true };
    fs.writeFileSync('dev-tools/_qa_tmp/' + name, Buffer.from(s.result.value, 'base64'));
    // 分析截图：玩家在画面中心，头在 (480, 222-246) 附近（sprite 48px 高）
    const r2 = await sendMethod('Runtime.evaluate', { expression: `(async () => {
        const b64 = ${JSON.stringify(s.result.value)};
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const cx = c.width >> 1;   // 480
        const cy = (c.height >> 1) + 8;  // 脚底 ~278
        // 玩家区域：x cx±20, y (cy-56)..(cy-8)（头+身）
        let skinLeft = 0, skinRight = 0, skinTotal = 0;
        let minSX = 1e9, maxSX = -1;
        for (let y = cy - 56; y < cy - 8; y++) for (let x = cx - 20; x < cx + 20; x++) {
            const i = (y * c.width + x) * 4;
            const rr=d[i],gg=d[i+1],bb=d[i+2],a=d[i+3];
            if (a < 100) continue;
            if (rr>150 && gg>100 && bb>60 && rr>bb) {  // 肤色
                skinTotal++;
                if (x < cx) skinLeft++; else skinRight++;
                if (x < minSX) minSX = x; if (x > maxSX) maxSX = x;
            }
        }
        return JSON.stringify({ skinTotal, skinLeft, skinRight, skinXRange: [minSX, maxSX] });
    })()`, awaitPromise: true, returnByValue: true });
    return { name, facing: r2.result.value };
};

console.log('朝东 f0:', await snapAndFacing('fx-east-f0.png', 0, true, 1));
console.log('朝东 f1:', await snapAndFacing('fx-east-f1.png', 1, true, 1));
console.log('朝西 f0:', await snapAndFacing('fx-west-f0.png', 0, true, -1));
console.log('朝西 f1:', await snapAndFacing('fx-west-f1.png', 1, true, -1));

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
process.exit(0);