// _cdp-weather-v7.mjs — 强度联动综合验证：雨速差异/雾可视半径/沙尘风力/公告/暗示
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
        localStorage.setItem('u:__guest__:wasteland_character_V', JSON.stringify({
            name: 'V', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' },
            inv: [{ id: 'wood', n: 30 }].concat(Array(23).fill(null)), hotbar: [], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0, stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_V', JSON.stringify({
            seed: 666008, t: 1800, day: 5, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [], npcs: {
                people: [{ id: 'player', isPlayer: true, name: 'V', role: 'friendly',
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
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: 'V', worldSeed: 666008 }));
        m.enterWasteland({ seed: 666008, characterName: 'V', difficulty: 'normal' });
        return 'ok';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));

    // 1) 雨速差异：小雨 vs 暴雨，帧差分雨丝位移
    const rainSpeed = async (lv) => {
        return send('Runtime.evaluate', { expression: `(async () => {
            const sv = window.__surv.debugGetSv();
            const B2 = await import('./source-code/mod-wasteland/wbalance.js');
            sv._devGfx = 2;
            sv.t = B2.DAY_LEN * 0.5;
            sv._weather = 'rain';
            sv._wxLevel = ${lv};
            await new Promise(r => setTimeout(r, 800));
            const grab = () => {
                const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
                const W = sv.ctx.canvas.width;
                const pts = new Set();
                for (let i = 0; i < img.length; i += 4) {
                    const R = img[i], G = img[i+1], B3 = img[i+2];
                    if (B3 > 130 && B3 > R + 30 && G > 100 && G < 190 && R < 170 && B3 < 220) pts.add(Math.floor(i / 4));
                }
                return { pts, W };
            };
            const a = grab();
            await new Promise(r => setTimeout(r, 100));
            const b = grab();
            // 帧B新像素找帧A最近蓝像素 → 位移
            let sum = 0, n = 0;
            for (const pb of b.pts) {
                if (a.pts.has(pb)) continue;
                let best = 9999;
                for (const pa of a.pts) {
                    const dx = (pb % a.W) - (pa % a.W), dy = Math.floor(pb / a.W) - Math.floor(pa / a.W);
                    const d = dx*dx + dy*dy;
                    if (d < best) best = d;
                    if (best < 400) break;
                }
                if (best < 6400) { sum += Math.sqrt(best); n++; }
            }
            return n ? +(sum / n).toFixed(1) : 0;
        })()`, awaitPromise: true, returnByValue: true });
    };
    const slow = await rainSpeed(0);
    const fast = await rainSpeed(5);
    console.log('[雨速] 小雨位移:', slow.result && slow.result.value, 'px/100ms | 雷阵雨:', fast.result && fast.result.value, 'px/100ms (期望雷阵雨明显更快)');

    // 2) 雾可视半径：浓雾 lv2 → 中心 vs 角落亮度（中心清楚暗、角落白蒙亮）
    const fogR = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._weather = 'fog'; sv._wxLevel = 2;
        await new Promise(r => setTimeout(r, 600));
        const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
        const W = sv.ctx.canvas.width, H = sv.ctx.canvas.height;
        const avgAt = (x, y) => { const i = (y * W + x) * 4; return (img[i] + img[i+1] + img[i+2]) / 3; };
        const center = avgAt(Math.floor(W/2), Math.floor(H/2));
        const corner = avgAt(30, 30);
        return JSON.stringify({ center: +center.toFixed(0), corner: +corner.toFixed(0), radiusPx: B2.fogRadius('fog', 2) * 36, W, H });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[雾] 浓雾中心/角落亮度:', fogR.result && fogR.result.value, '(期望 corner 明显 > center = 边缘白蒙)');

    // 3) 沙尘暴风力推挤：站着等 2s 看 px 变化
    const windR = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._weather = 'sandstorm'; sv._wxLevel = 1;
        sv.px = 18 * 36; sv.py = 18 * 36;
        const x0 = sv.px, y0 = sv.py;
        await new Promise(r => setTimeout(r, 2000));
        const dx = Math.hypot(sv.px - x0, sv.py - y0);
        return JSON.stringify({ movedPx: +dx.toFixed(1), wx: sv._weather });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[风力] 沙尘暴站立 2s 位移:', windR.result && windR.result.value, '(期望 > 5px = 被吹着走)');

    // 4) 公告文案「即将来袭」+ 7:00 暗示
    const annR = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._devWxLock = false;
        // 暗示：设 hour=7，lastHint=6.9 → 触发 hint log
        const hintLogs = [];
        const origLog = null;
        sv._lastHintHour = 6.9;
        sv._lastWxHour = 6.9;
        sv.t = B2.DAY_LEN * 7 / 24;
        sv._weather = 'clear';
        const before = window.__hintLogs ? window.__hintLogs.length : 0;
        await new Promise(r => setTimeout(r, 600));
        // 公告：跨 8:00
        sv._lastWxHour = 7.9;
        sv.t = B2.DAY_LEN * 8 / 24;
        await new Promise(r => setTimeout(r, 600));
        const wx = B2.weatherAt(sv.world.seed, sv.day);
        return JSON.stringify({ nowWeather: sv._weather, announce: sv.announce, wxAt: wx, hint: B2.WX_TABLE[wx].hint });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[公告+暗示]', annR.result && annR.result.value);

    await new Promise(r => setTimeout(r, 400));
    const shot = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shot.result && shot.result.value) writeFileSync('dev-tools/_qa_tmp/wx9-announce2.png', Buffer.from(shot.result.value, 'base64'));

    const exc = evts.filter(m => m.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    process.exit(0);
})();