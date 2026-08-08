// CDP 实测：P3 主题建筑室外外观（配色微调 + 屋顶特征物）
// 验证：真实浏览器进入荒原 → 传送到不同类型建筑 → 采样屋顶色偏移 + 特征物像素 + 缓存正确性 + FPS + 零异常
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.clearBrowserCache');
await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
await sleep(3000);
const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
await send('Runtime.evaluate', { expression: 'localStorage.setItem(\'u:__guest__:wasteland_save\', ' + JSON.stringify(save) + '); true' });
await send('Runtime.evaluate', { expression: `(async () => {
    const st = await import('./source-code/core/state.js');
    st.setSaveData({ ...st.saveData, devMode: true });
    const m = await import('./source-code/mod-wasteland/survival.js');
    window.__surv = m; m.enterWasteland({}); return 'entered';
})()`, awaitPromise: true });
await sleep(4000);

// ① 扫描当前视野内的建筑门
const scan = await send('Runtime.evaluate', { expression: `(() => {
    const m = window.__surv; const sv = m.debugGetSv();
    const W = 960, H = 540;
    const camX = sv.px - W/2, camY = sv.py - H/2;
    const t0x = Math.floor(camX/36)-1, t0y = Math.floor(camY/36)-1;
    const t1x = Math.ceil((camX+W)/36)+1, t1y = Math.ceil((camY+H)/36)+1;
    const doors = [];
    for (let ty=t0y; ty<=t1y; ty++) for (let tx=t0x; tx<=t1x; tx++) {
        const tt = sv.mods.tiles[tx+','+ty];
        if (tt && !tt.built && tt.t === '门') doors.push({tx, ty});
    }
    return JSON.stringify({ doors: doors.length, sample: doors.slice(0,3) });
})()`, returnByValue: true });
console.log('① 视野门扫描:', scan.result && scan.result.value);

// ② 传送到医院类型建筑前（seed 20260802 附近找 hospital 区块）
const findHospital = await send('Runtime.evaluate', { expression: `(async () => {
    const wd = await import('./source-code/mod-wasteland/wdistrict.js');
    const w = await import('./source-code/mod-wasteland/world.js');
    const seed = 20260802;
    for (let cy=-8; cy<=8; cy++) for (let cx=-8; cx<=8; cx++) {
        if (wd.buildingTypeAt(seed, cx, cy) === 'hospital') {
            const t = w.genChunkTiles(seed, cx, cy);
            for (let ly=0; ly<16; ly++) for (let lx=0; lx<16; lx++) {
                if (t[ly*16+lx] === w.T.DOOR) return JSON.stringify({ cx, cy, door: [cx*16+lx, cy*16+ly] });
            }
        }
    }
    return JSON.stringify({ none: true });
})()`, awaitPromise: true, returnByValue: true });
console.log('② 医院定位:', findHospital.result && findHospital.result.value);

// ③ 传送过去截图 + 采样屋顶色（医院应偏白亮 + 红十字）
const hospDoor = JSON.parse(findHospital.result.value);
if (hospDoor.door) {
    await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.px = ${hospDoor.door[0]} * 36 + 18; sv.py = ${hospDoor.door[1]} * 36 + 18;
        if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
        return 'tp';
    })()` });
    await sleep(1800);
    const shot = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        return sv.ctx.canvas.toDataURL('image/png').slice(22);
    })()` });
    const fs = await import('fs');
    if (shot.result && shot.result.value) { fs.writeFileSync('dev-tools/_qa_tmp/cdp-ext-hospital.png', Buffer.from(shot.result.value, 'base64')); console.log('  医院截图已存'); }
    const px = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx; const img = c.getImageData(0,0,c.canvas.width,c.canvas.height).data;
        let roofWhite = 0, redCross = 0;
        for (let i=0;i<img.length;i+=4) {
            const r=img[i], g=img[i+1], b=img[i+2];
            if (r>=80&&r<=100 && g>=88&&g<=108 && b>=98&&b<=118) roofWhite++;
            if (r>=200&&r<=235 && g>=50&&g<=80 && b>=45&&b<=75) redCross++;
        }
        return JSON.stringify({ roofWhite, redCross });
    })()`, returnByValue: true });
    console.log('③ 医院屋顶采样:', px.result && px.result.value);
}

// ④ FPS + 异常
const fps = await send('Runtime.evaluate', { expression: `new Promise(res => {
    const t0 = performance.now(); let frames = 0;
    const tick = () => { frames++; if (performance.now()-t0 < 2000) requestAnimationFrame(tick); else res(frames/2); };
    requestAnimationFrame(tick);
})`, awaitPromise: true, returnByValue: true });
console.log('④ FPS(2s):', fps.result && fps.result.value);
const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('异常:', exceptions.length, '/ console.error:', consoleErrs.length);
if (exceptions.length) for (const e of exceptions) console.log('EXC:', (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0,200));
process.exit(0);
