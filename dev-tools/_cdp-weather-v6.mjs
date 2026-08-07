// _cdp-weather-v6.mjs — 雷阵雨闪电单帧验证 + HUD 天气指示 + 锁定
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
        localStorage.setItem('u:__guest__:wasteland_character_T', JSON.stringify({
            name: 'T', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' },
            inv: [{ id: 'wood', n: 30 }].concat(Array(23).fill(null)), hotbar: [], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0, stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_T6', JSON.stringify({
            seed: 666006, t: 1800, day: 4, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [], npcs: {
                people: [{ id: 'player', isPlayer: true, name: 'T', role: 'friendly',
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
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: 'T', worldSeed: 666006 }));
        m.enterWasteland({ seed: 666006, characterName: 'T', difficulty: 'normal' });
        return 'ok';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));

    // 1) 设雷阵雨 + 锁定 → 验证不被覆盖
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._devGfx = 2;
        sv.t = B2.DAY_LEN * 0.5;
        sv._weather = 'rain';
        sv._wxLevel = 5;
        sv._devWxLock = true;
        return 'set';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 1500));
    const state1 = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ weather: sv._weather, wxLevel: sv._wxLevel, lock: sv._devWxLock }); })()`, returnByValue: true });
    console.log('[锁定1.5s后]', state1.result && state1.result.value);

    // 2) 枚举 win 找 hash2<0.7 的窗口 → 设 sv.t 强制触发闪电 → 单帧检测闪白
    const flashRes = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const wxHash = (s, a, b) => { let h = (s|0) ^ Math.imul(a|0, 374761393) ^ Math.imul(b|0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
        const seed = 666006, PER = 5;
        let winHit = -1, atHit = 0;
        for (let w = 360; w < 420; w++) {
            if (wxHash(seed, w, 0x51E1) < 0.7) { winHit = w; atHit = 0.15 + wxHash(seed, w, 0x31A9) * 1.45; break; }
        }
        if (winHit < 0) return JSON.stringify({ err: 'no window' });
        sv.t = winHit * PER + atHit + 0.05;
        await new Promise(r => setTimeout(r, 120));
        const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
        let sum = 0, n = 0;
        for (let i = 0; i < img.length; i += 64) { sum += img[i] + img[i+1] + img[i+2]; n += 3; }
        const avgFlash = sum / n;
        const w2 = winHit, a2 = atHit;
        sv.t = w2 * PER + a2 + 1.5;
        await new Promise(r => setTimeout(r, 120));
        const img2 = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
        let sum2 = 0;
        for (let i = 0; i < img2.length; i += 64) { sum2 += img2[i] + img2[i+1] + img2[i+2]; }
        const avgBase = sum2 / (img2.length / 64) / 3;
        return JSON.stringify({ winHit, atHit: +atHit.toFixed(2), avgFlash: +avgFlash.toFixed(1), avgBase: +avgBase.toFixed(1), diff: +(avgFlash - avgBase).toFixed(1) });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[闪电单帧] 设强制窗口:', flashRes.result && flashRes.result.value, '(期望 diff>10 = 闪电明显提亮)');

    // 截图：设强制窗口状态
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const wxHash = (s, a, b) => { let h = (s|0) ^ Math.imul(a|0, 374761393) ^ Math.imul(b|0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
        const seed = 666006;
        for (let w = 360; w < 420; w++) if (wxHash(seed, w, 0x51E1) < 0.7) { sv.t = w * 5 + 0.2; break; }
        await new Promise(r => setTimeout(r, 120));
        return true;
    })()`, awaitPromise: true });
    const shot = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shot.result && shot.result.value) { writeFileSync('dev-tools/_qa_tmp/wx7-thunder-flash.png', Buffer.from(shot.result.value, 'base64')); console.log('[截图] wx7-thunder-flash.png'); }

    const exc = evts.filter(m => m.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    process.exit(0);
})();