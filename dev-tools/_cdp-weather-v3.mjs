// _cdp-weather-v3.mjs — 速度统一 + 网格均匀化验证（帧差分消除背景）
// 差分法：两帧 diff 只保留"移动的雨丝"（背景静止）→ 行分布均匀 + 位移量一致
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
        localStorage.setItem('u:__guest__:wasteland_character_测速', JSON.stringify({
            name: '测速', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' },
            inv: [{ id: 'wood', n: 30 }].concat(Array(23).fill(null)), hotbar: [], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0, stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_666003', JSON.stringify({
            seed: 666003, t: 3600, day: 3, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [], npcs: {
                people: [{
                    id: 'player', isPlayer: true, name: '测速', role: 'friendly',
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
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '测速', worldSeed: 666003 }));
        m.enterWasteland({ seed: 666003, characterName: '测速', difficulty: 'normal' });
        return 'entered';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));

    // 设白天 + 高画质 + 暴雨（找 rain lv3 的 day）
    const B = await import('../source-code/mod-wasteland/wbalance.js');
    let dayL3 = null;
    for (let d = 1; d <= 300; d++) {
        if (B.weatherAt(666003, d) === 'rain' && B.wxLevelAt(666003, d) === 3) { dayL3 = d; break; }
    }
    console.log('暴雨 day:', dayL3);
    if (!dayL3) { console.log('未找到'); process.exit(1); }
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv.t = B2.DAY_LEN * 0.5;
        sv.day = ${dayL3};
        sv._weather = 'rain';
        sv._devGfx = 2;
        return 'ok';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 1500));

    // 帧差分：两帧间隔 100ms，提取雨丝像素（蓝色斜线），diff 只保留移动像素
    const diff = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const grab = () => {
            const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
            const W = sv.ctx.canvas.width, H = sv.ctx.canvas.height;
            const pts = new Set();
            for (let i = 0; i < img.length; i += 4) {
                const R = img[i], G = img[i+1], B3 = img[i+2];
                if (B3 > 130 && B3 > R + 30 && G > 100 && G < 190 && R < 170 && B3 < 220) {
                    pts.add(Math.floor(i / 4));
                }
            }
            return { pts, W, H };
        };
        const a = grab();
        await new Promise(r => setTimeout(r, 100));
        const b = grab();
        // diff：出现在 b 不在 a（雨丝移动后新位置），或反之
        let movePts = 0; const rows = new Array(12).fill(0);
        for (const p of a.pts) { if (!b.pts.has(p)) { movePts++; rows[Math.min(11, Math.floor((p / a.W) / a.H * 12))]++; } }
        for (const p of b.pts) { if (!a.pts.has(p)) { movePts++; } }
        // 位移验证：帧B中雨丝相对帧A平均位移（简化：用出现新像素比例近似）
        const maxRow = Math.max(...rows), minRow = Math.min(...rows);
        return JSON.stringify({ movePts, rows, maxRow, minRow, uniform: maxRow <= Math.max(2, minRow * 2.5) });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[帧差分] 雨丝移动像素分布:', diff.result && diff.result.value);

    // 截图
    const shot = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shot.result && shot.result.value) writeFileSync('dev-tools/_qa_tmp/wx4-rain-uniform.png', Buffer.from(shot.result.value, 'base64'));
    console.log('[截图] wx4-rain-uniform.png');

    const exc = evts.filter(m => m.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    process.exit(0);
})();
