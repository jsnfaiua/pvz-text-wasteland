// _cdp-interior-lowstate.mjs — 对比室内外低血量/低水分/低饱食的视觉效果
import { writeFileSync } from 'fs';
const CDP = 'http://127.0.0.1:9222';

(async () => {
    const tabs = await (await fetch(CDP + '/json')).json();
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0; const pend = new Map(); const evts = [];
    ws.onmessage = e => { const m = JSON.parse(e.data);
        if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
    const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };

    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
    await new Promise(r => setTimeout(r, 3000));

    const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
    await send('Runtime.evaluate', { expression: `localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(save)}); true` });
    const ent = await send('Runtime.evaluate', { expression: `(async () => {
        try {
            const st = await import('./source-code/core/state.js');
            st.setSaveData({ ...st.saveData, devMode: true });
            const m = await import('./source-code/mod-wasteland/survival.js');
            window.__surv = m;
            m.enterWasteland({});
            return 'entered';
        } catch (e) { return 'ERR: ' + e.message; }
    })()`, awaitPromise: true });
    console.log('enter:', ent.result && ent.result.value);
    await new Promise(r => setTimeout(r, 3500));

    // 设低状态：血量 15（≤20% 触发低血量光晕）/ 饱食 25 / 水分 25（"过低"但不会快速饿死干扰测试）
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.hp = 15; sv.food = 25; sv.water = 25; sv.px = 0; sv.py = 0; return true; })()` });
    await new Promise(r => setTimeout(r, 1200));
    const out1 = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (out1.result && out1.result.value) { writeFileSync('dev-tools/_cdp-lowstate-outdoor.png', Buffer.from(out1.result.value, 'base64')); console.log('室外低状态已存'); }

    // 进室内（debug），保持低属性
    const int = await send('Runtime.evaluate', { expression: `(() => { const m = window.__surv; m.debugEnterInterior(); const sv = m.debugGetSv(); sv.hp = 15; sv.food = 25; sv.water = 25; return !!sv.interior; })()`, returnByValue: true });
    console.log('进室内:', int.result && int.result.value);
    await new Promise(r => setTimeout(r, 1200));
    const out2 = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (out2.result && out2.result.value) { writeFileSync('dev-tools/_cdp-lowstate-indoor.png', Buffer.from(out2.result.value, 'base64')); console.log('室内低状态已存'); }

    // 分析：室内 HUD 左上角状态条（HP/饱食/水分）颜色 + 屏幕光晕
    const anal = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        const px = (x, y) => { const i = (y * W + x) * 4; return [img[i], img[i+1], img[i+2]]; };
        // HP 方块条文本在 (10, 17)（top bar 文字）；饱食条 (10,58)、水分条 (10,74)
        const hp = px(60, 17);
        const foodBar = px(12, 63), waterBar = px(12, 79);
        // 屏幕边缘 vs 中心（光晕会让边缘暗黄）
        const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
        const center = px(cx, cy), corner = px(20, 20);
        return JSON.stringify({ inInterior: !!sv.interior, hp, foodBar, waterBar, center, corner });
    })()`, returnByValue: true });
    console.log('室内分析:', anal.result && anal.result.value);

    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
})();
