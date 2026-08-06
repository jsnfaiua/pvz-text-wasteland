// _cdp-wgrass.mjs — wgrass 模块接入验证
import fs from 'node:fs';
const CDP = 'http://127.0.0.1:9222';
async function getJson(url) { return (await fetch(url + '/json')).json(); }
async function main() {
    const tabs = await getJson(CDP);
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map(); const evts = [];
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m);
    };
    const send = (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
    await new Promise(r => setTimeout(r, 3000));
    // 确认页面加载成功（非 chromewebdata）
    const loc = await send('Runtime.evaluate', { expression: `location.href` });
    console.log('页面:', loc.result && loc.result.value);
    if (!loc.result || !String(loc.result.value).includes('localhost:8000')) {
        console.log('FAIL: 页面导航失败'); process.exit(1);
    }
    await send('Runtime.evaluate', { expression: `localStorage.setItem('u:__guest__:wasteland_save', '${JSON.stringify(JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } }))}'); true` });
    await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({});
        return 'entered';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 3500));

    // 1. 模块加载 + 草地渲染检查（canvas 非黑 + 颜色是草地绿系）
    const r = await send('Runtime.evaluate', { expression: `(async () => {
        const wg = await import('./source-code/mod-wasteland/wgrass.js');
        window.__wg = wg;
        const sv = window.__surv.debugGetSv();
        const g = sv.ctx.canvas.getContext('2d');
        const d = g.getImageData(200, 200, 80, 80).data;
        let greens = 0, total = 0;
        for (let i = 0; i < d.length; i += 4) {
            total++;
            if (d[i+1] > d[i] && d[i+1] > d[i+2] * 0.8) greens++;   // G 主导 = 绿
        }
        return JSON.stringify({
            wgLoaded: !!wg.grassRenderGround && !!wg.grassRenderLayer,
            season: (sv._season == null ? 1 : sv._season),
            grassRatio: (greens / total).toFixed(2),
            wgExports: Object.keys(wg).join(','),
        });
    })()`, awaitPromise: true });
    console.log('模块与草地:', r.result && r.result.value);

    // 2. 动态草层动画验证（手动调 grassRenderLayer 两次不同 sv.now → 帧不同）
    const anim = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const wg = window.__wg;
        const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
        const c = cv.getContext('2d');
        const t0 = sv.now;
        wg.grassRenderLayer(c, sv, sv.px - 160, sv.py - 90, 320, 180);
        const d1 = cv.toDataURL();
        sv.now = t0 + 0.5;
        wg.grassRenderLayer(c, sv, sv.px - 160, sv.py - 90, 320, 180);
        const d2 = cv.toDataURL();
        const img = c.getImageData(0, 0, 320, 180).data;
        let nonBg = 0;
        for (let i = 0; i < img.length; i += 4) if (img[i] > 10 || img[i+1] > 10 || img[i+2] > 10) nonBg++;
        return JSON.stringify({ moved: d1 !== d2, nonBg });
    })()` });
    console.log('草层动画:', anim.result && anim.result.value);

    // 3. 季节切换验证
    const seas = await send('Runtime.evaluate', { expression: `(() => {
        const wg = window.__wg;
        const sv = window.__surv.debugGetSv();
        wg.grassSetSeason(sv, 0);   // 春
        const s0 = sv._season;
        wg.grassSetSeason(sv, 3);   // 冬
        return JSON.stringify({ s0, s1: sv._season });
    })()` });
    console.log('季节切换:', seas.result && seas.result.value);

    // 4. FPS（RAF 帧率）
    const fps = await send('Runtime.evaluate', { expression: `(async () => {
        const secs = 1.5;
        return await new Promise(res => {
            let n = 0, last = 0;
            const t0 = performance.now();
            const cb = (t) => { last = t; n++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(cb); else res(Math.round(n / secs)); };
            requestAnimationFrame(cb);
        });
    })()`, awaitPromise: true });
    console.log('游戏 FPS:', fps.result && fps.result.value);

    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    const ok = r.result && r.result.value.includes('"wgLoaded":true') && r.result.value.includes('"season":1')
        && anim.result && anim.result.value.includes('"moved":true') && parseInt(anim.result.value.match(/"nonBg":(\d+)/)[1], 10) > 100
        && seas.result && seas.result.value.includes('"s0":0') && seas.result.value.includes('"s1":3')
        && fps.result && fps.result.value >= 55 && exc.length === 0;
    console.log(ok ? '=== wgrass 模块接入验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
