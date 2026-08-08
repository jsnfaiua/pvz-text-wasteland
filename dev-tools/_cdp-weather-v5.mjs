// _cdp-weather-v5.mjs — 雷阵雨闪电闪光 + HUD 天气指示验证
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

    await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        for (const k of Object.keys(localStorage)) if (k.includes('wasteland_')) localStorage.removeItem(k);
        localStorage.setItem('u:__guest__:wasteland_character_测雷', JSON.stringify({
            name: '测雷', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' },
            inv: [{ id: 'wood', n: 30 }].concat(Array(23).fill(null)), hotbar: [], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0, stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_666004', JSON.stringify({
            seed: 666004, t: 3600, day: 3, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [], npcs: {
                people: [{
                    id: 'player', isPlayer: true, name: '测雷', role: 'friendly',
                    look: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' },
                    x: 18, y: 18, hp: 100, maxHp: 100, food: 100, water: 100,
                    dmg: 10, wpnKey: null, wpnName: null, inv: [{ id: 'wood', n: 30 }].concat(Array(23).fill(null)),
                    wpn: null, coins: 0, sick: null,
                    attrs: { str: 5, agi: 5, vit: 5, luc: 5 }, talent: null, congenital: null,
                    act: { melee: 0, hit: 0, run: 0 }, bornDay: 1, alive: true,
                    party: true, hired: false, hireFee: null, state: 'follow',
                    campId: null, riding: false, workLog: [], _paidDay: 0, age: 1, _grown: 0,
                }],
                controllerId: 'player', camp: null,
            }, px: 18, py: 18, faceX: 1, faceY: 0,
        }));
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '测雷', worldSeed: 666004 }));
        m.enterWasteland({ seed: 666004, characterName: '测雷', difficulty: 'normal' });
        return 'entered';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));

    // 设雷阵雨（rain:5）白天
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._devGfx = 2;
        sv.t = B2.DAY_LEN * 0.5;
        sv._weather = 'rain';
        sv._wxLevel = 5;   // 雷阵雨
        return 'ok';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 1000));

    // 1) 8s 轮询抓闪白帧
    const r = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const peaks = [];
        let flashes = 0, maxA = 0;
        const t0 = performance.now();
        while (performance.now() - t0 < 8000) {
            const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
            let sum = 0, n = 0;
            for (let i = 0; i < img.length; i += 64) { sum += img[i] + img[i+1] + img[i+2]; n += 3; }
            const avg = sum / n;
            if (avg > 90) { flashes++; maxA = Math.max(maxA, avg); peaks.push(Math.round(avg)); }
            await new Promise(r => setTimeout(r, 100));
        }
        return JSON.stringify({ flashes, maxA, peaks: peaks.slice(0, 10) });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[雷阵雨] 8s 闪白检测:', r.result && r.result.value);

    // 2) HUD 天气指示截图
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        sv._wxLevel = 5;
        await new Promise(r => setTimeout(r, 600));
        return true;
    })()`, awaitPromise: true });
    const shot = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shot.result && shot.result.value) { writeFileSync('dev-tools/_qa_tmp/wx6-thunder.png', Buffer.from(shot.result.value, 'base64')); console.log('[截图] wx6-thunder.png'); }

    const exc = evts.filter(m => m.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    process.exit(0);
})();
