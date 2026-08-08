// CDP 多建筑类型实机截图：验证每种主题建筑的外观（配色偏移 + 特征物）
// 对 school/factory/warehouse/shop/hospital 各找一栋，传送→截图→像素采样
const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const evts = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = await import('fs');

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

// 目标建筑类型 + 特征物像素色
const TARGETS = [
    { type: 'hospital',  file: 'cdp-ext-hospital.png',  px: [{ name: 'roofWhite', r: [80,100], g: [88,108], b: [98,118] }, { name: 'redCross', r: [200,235], g: [50,80], b: [45,75] }] },
    { type: 'school',    file: 'cdp-ext-school.png',    px: [{ name: 'roofWarm', r: [84,92], g: [80,88], b: [86,94] }, { name: 'stepsGrey', r: [100,125], g: [110,135], b: [125,145] }] },
    { type: 'factory',   file: 'cdp-ext-factory.png',   px: [{ name: 'roofCool', r: [66,76], g: [80,88], b: [94,104] }, { name: 'ventsGrey', r: [85,100], g: [92,108], b: [100,116] }] },
    { type: 'shop',      file: 'cdp-ext-shop.png',      px: [{ name: 'roofOrange', r: [80,92], g: [84,92], b: [84,94] }, { name: 'signRed', r: [190,215], g: [55,75], b: [55,75] }] },
    { type: 'warehouse', file: 'cdp-ext-warehouse.png', px: [{ name: 'roofCool', r: [70,80], g: [78,88], b: [90,100] }] },
];

for (const t of TARGETS) {
    const found = await send('Runtime.evaluate', { expression: `(async () => {
        const wd = await import('./source-code/mod-wasteland/wdistrict.js');
        const w = await import('./source-code/mod-wasteland/world.js');
        const seed = 20260802;
        for (let cy=-10; cy<=10; cy++) for (let cx=-10; cx<=10; cx++) {
            if (wd.buildingTypeAt(seed, cx, cy) === '${t.type}') {
                const t2 = w.genChunkTiles(seed, cx, cy);
                for (let ly=0; ly<16; ly++) for (let lx=0; lx<16; lx++) {
                    if (t2[ly*16+lx] === w.T.DOOR) return JSON.stringify({ cx, cy, door: [cx*16+lx, cy*16+ly] });
                }
            }
        }
        return JSON.stringify({ none: true });
    })()`, awaitPromise: true, returnByValue: true });
    const info = JSON.parse(found.result.value);
    if (!info.door) { console.log(`${t.type}: 未找到门，跳过`); continue; }
    // 传送：玩家站在门侧偏上（能看全屋顶）
    await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        sv.px = ${info.door[0]} * 36 + 18; sv.py = ${info.door[1]} * 36 - 14;
        if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
        return 'tp ${t.type} @ ${info.door}';
    })()` });
    await sleep(1600);
    const shot = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        return sv.ctx.canvas.toDataURL('image/png').slice(22);
    })()` });
    if (shot.result && shot.result.value) {
        fs.writeFileSync('dev-tools/_qa_tmp/' + t.file, Buffer.from(shot.result.value, 'base64'));
    }
    // 像素采样
    const px = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx; const img = c.getImageData(0,0,c.canvas.width,c.canvas.height).data;
        const out = {};
        const ranges = ${JSON.stringify(t.px)};
        for (const range of ranges) {
            let n = 0;
            for (let i=0;i<img.length;i+=4) {
                const r=img[i], g=img[i+1], b=img[i+2];
                if (r>=range.r[0]&&r<=range.r[1] && g>=range.g[0]&&g<=range.g[1] && b>=range.b[0]&&b<=range.b[1]) n++;
            }
            out[range.name] = n;
        }
        return JSON.stringify(out);
    })()`, returnByValue: true });
    console.log(`${t.type} @ ${info.door}:`, px.result && px.result.value);
}

const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
console.log('\n异常:', exceptions.length, '/ console.error:', consoleErrs.length);
process.exit(0);
