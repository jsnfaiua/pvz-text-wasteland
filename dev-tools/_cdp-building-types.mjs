// ============================================================
// CDP 实测：P3 主题建筑（城区深化）
// 验证：真实浏览器进入荒原 → 大世界建筑类型标签 → 真实室内（debugEnterInteriorReal）
//       → 主题家具存在（课桌/病床/书架…）→ 搜刮内容按建筑类型 loot → FPS + 零异常
// 用法：
//   1. 先启动 server：node server.js
//   2. 先启动 Chrome：chrome --headless=new --remote-debugging-port=9222 --user-data-dir=... about:blank
//   3. node dev-tools/_cdp-building-types.mjs
// ============================================================
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
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.clearBrowserCache');   // 改 ES module 后必须清缓存（AGENTS.md §11）
    await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
    await sleep(3000);

    const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632' } });
    await send('Runtime.evaluate', { expression: `localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(save)}); true` });
    const ent = await send('Runtime.evaluate', { expression: `(async () => {
        try {
            const st = await import('./source-code/core/state.js');
            st.setSaveData({ ...st.saveData, devMode: true });
            const m = await import('./source-code/mod-wasteland/survival.js');
            window.__surv = m;
            m.enterWasteland({});
            return 'entered';
        } catch (e) { return 'ERR: ' + (e.stack || e.message); }
    })()`, awaitPromise: true });
    console.log('enter:', ent.result && ent.result.value);
    await sleep(4000);

    // ── ① 大世界建筑类型标签：传送到真实建筑门前，截图看标签字（学/医/仓…）
    const doorKey = '13,-92';   // seed 20260802 真实 factory 门（_probe-door.mjs 探测）
    const labelScan = await send('Runtime.evaluate', { expression: `(() => {
        try {
            const m = window.__surv;
            const sv = m.debugGetSv();
            const [dx, dy] = '${doorKey}'.split(',').map(Number);
            // 传送门旁（门格偏上，站在门口）
            sv.px = dx * 36 + 18; sv.py = dy * 36 + 22;
            // 强制失效静态层缓存，让新视角重建（含建筑标签）
            if (sv._zombiePathRevision != null) sv._zombiePathRevision++;
            return JSON.stringify({ door: { tx: dx, ty: dy }, teleported: true });
        } catch (e) { return 'ERR: ' + e.message; }
    })()`, returnByValue: true });
    console.log('① 传送到真实门:', labelScan.result && labelScan.result.value);
    await sleep(1500);
    const shot1 = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shot1.result && shot1.result.value) { writeFileSync('dev-tools/_qa_tmp/cdp-building-outdoor.png', Buffer.from(shot1.result.value, 'base64')); console.log('  室外截图已存 _qa_tmp/cdp-building-outdoor.png'); }

    // ── ② 进真实室内（debugEnterInteriorReal 走完整路径，验证真实建筑类型 + 主题家具）──
    const int = await send('Runtime.evaluate', { expression: `(() => {
        try {
            const m = window.__surv;
            const sv = m.debugGetSv();
            m.debugEnterInteriorReal('${doorKey}');
            const it = sv.interior;
            if (!it) return 'ERR: interior null';
            const furn = {};
            for (const v of it.tiles) { if (v >= 13) furn[v] = (furn[v] || 0) + 1; }
            return JSON.stringify({ key: it.key, buildingType: it.buildingType, w: it.w, h: it.h, furniture: furn, zombieCount: it.zombies.length });
        } catch (e) { return 'ERR: ' + (e.stack || e.message); }
    })()`, returnByValue: true });
    console.log('② 进真实室内:', int.result && int.result.value);
    await sleep(2000);
    const shot2 = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shot2.result && shot2.result.value) { writeFileSync('dev-tools/_qa_tmp/cdp-building-indoor.png', Buffer.from(shot2.result.value, 'base64')); console.log('  室内截图已存 _qa_tmp/cdp-building-indoor.png'); }

    // ── ③ 家具统计：确认室内确有主题家具（RACK/MACHINE ≥13）──
    const walk = await send('Runtime.evaluate', { expression: `(() => {
        try {
            const m = window.__surv;
            const sv = m.debugGetSv();
            const it = sv.interior;
            let furnTotal = 0;
            for (const v of it.tiles) if (v >= 13) furnTotal++;
            return JSON.stringify({ furnTotal, floor: it.floor, inInterior: !!it });
        } catch (e) { return 'ERR: ' + (e.stack || e.message); }
    })()`, returnByValue: true });
    console.log('③ 家具统计:', walk.result && walk.result.value);

    // ── ④ FPS + 异常 ──
    const fps = await send('Runtime.evaluate', { expression: `(() => {
        return new Promise(res => {
            const sv = window.__surv.debugGetSv();
            const t0 = performance.now();
            let frames = 0;
            const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(frames / 2); };
            requestAnimationFrame(tick);
        });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('④ FPS(2s):', fps.result && fps.result.value);

    const exceptions = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    const consoleErrs = evts.filter(e => e.method === 'Runtime.consoleAPICalled' && (e.params.type === 'error' || e.params.type === 'assert'));
    console.log('\n=== 异常 (exceptionThrown) ===');
    if (!exceptions.length) console.log('（无）');
    for (const e of exceptions) console.log('-', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 300));
    console.log('=== console.error/assert ===');
    if (!consoleErrs.length) console.log('（无）');
    for (const e of consoleErrs) console.log('-', e.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ').slice(0, 200));
    process.exit(0);
})().catch(e => { console.error('脚本失败:', e); process.exit(1); });
