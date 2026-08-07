// _cdp-weather-v2.mjs — 强度分级 + 世界坐标粒子修复验证
// 验证：①小雨 vs 暴雨密度差异（疏密不同） ②玩家瞬移后雨丝重新均匀（连续感+随相机） ③两帧动态移动
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

    // 进游戏（简化：直接进已有档）
    await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        for (const k of Object.keys(localStorage)) if (k.includes('wasteland_')) localStorage.removeItem(k);
        localStorage.setItem('u:__guest__:wasteland_character_测雨', JSON.stringify({
            name: '测雨', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' },
            inv: [{ id: 'wood', n: 30 }].concat(Array(23).fill(null)), hotbar: [], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0, stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_666002', JSON.stringify({
            seed: 666002, t: 3600, day: 3, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [], npcs: {
                people: [{
                    id: 'player', isPlayer: true, name: '测雨', role: 'friendly',
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
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '测雨', worldSeed: 666002 }));
        m.enterWasteland({ seed: 666002, characterName: '测雨', difficulty: 'normal' });
        return 'entered';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));

    // Node 侧枚举：seed=666002 找 rain + level0 / level3 的 day
    const B = await import('../source-code/mod-wasteland/wbalance.js');
    let dayL0 = null, dayL3 = null;
    for (let d = 1; d <= 300; d++) {
        if (B.weatherAt(666002, d) === 'rain') {
            const lv = B.wxLevelAt(666002, d);
            if (lv === 0 && !dayL0) dayL0 = d;
            if (lv === 3 && !dayL3) dayL3 = d;
        }
        if (dayL0 && dayL3) break;
    }
    console.log('找到 day: 小雨(lv0)=', dayL0, ' 暴雨(lv3)=', dayL3);
    if (!dayL0 || !dayL3) { console.log('seed 未覆盖两级强度，换 seed'); process.exit(1); }

    // 设白天 + 高画质
    const prep = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv.t = B2.DAY_LEN * 0.5;
        sv._devGfx = 2;
        return 'ok';
    })()`, awaitPromise: true });

    const countRain = async (label) => {
        const r = await send('Runtime.evaluate', { expression: `(() => {
            const sv = window.__surv.debugGetSv();
            const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
            const W = sv.ctx.canvas.width, H = sv.ctx.canvas.height;
            let rain = 0; const rows = new Array(12).fill(0);
            for (let i = 0; i < img.length; i += 4) {
                const R = img[i], G = img[i+1], B3 = img[i+2];
                if (B3 > 130 && B3 > R + 30 && G > 100 && G < 190 && R < 170 && B3 < 220) {
                    rain++;
                    rows[Math.min(11, Math.floor((i / 4 / W) / H * 12))]++;
                }
            }
            const maxRow = Math.max(...rows), minRow = Math.min(...rows);
            return JSON.stringify({ rain, rows, uniform: maxRow <= Math.max(2, minRow * 2.5), maxRow, minRow });
        })()`, returnByValue: true });
        console.log(`[${label}] 雨丝统计:`, r.result && r.result.value);
        return r.result && r.result.value ? JSON.parse(r.result.value) : null;
    };
    const shot = async (name) => {
        const r = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
        if (r.result && r.result.value) writeFileSync('dev-tools/_qa_tmp/' + name, Buffer.from(r.result.value, 'base64'));
    };

    // 1) 小雨（lv0）
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        sv.day = ${dayL0};
        sv._weather = 'rain';
        return 'ok';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 1200));
    const light = await countRain('小雨 lv0');
    await shot('wx3-rain-light.png');

    // 2) 暴雨（lv3）
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        sv.day = ${dayL3};
        return 'ok';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 1200));
    const heavy = await countRain('暴雨 lv3');
    await shot('wx3-rain-heavy.png');

    // 3) 动态两帧（暴雨，验证粒子移动）
    await new Promise(r => setTimeout(r, 400));
    const f1 = await countRain('暴雨帧1');
    await new Promise(r => setTimeout(r, 300));
    const f2 = await countRain('暴雨帧2');

    // 4) 玩家瞬移（验证粒子随相机：新视野雨丝重新均匀 + 数量不变）
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        sv.px += 3000;   // 瞬移 3000px（约 83 格）
        return 'ok';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 1500));
    const afterTp = await countRain('瞬移后');

    // 结论
    const ok = light && heavy && afterTp;
    const lightN = light ? light.rain : 0, heavyN = heavy ? heavy.rain : 0;
    const densityUp = heavyN > lightN * 1.5;
    const uniformOk = !!(light && light.uniform) && !!(afterTp && afterTp.uniform);
    const movingOk = f1 && f2 && Math.abs(f1.rain - f2.rain) > 20;
    console.log('\n=== 结论 ===');
    console.log('强度分级(暴雨>小雨×1.5):', densityUp ? 'PASS' : 'FAIL', `(${lightN} vs ${heavyN})`);
    console.log('连续均匀(垂直12行无聚集):', uniformOk ? 'PASS' : 'FAIL', `(小雨max/min=${light && light.maxRow}/${light && light.minRow} 瞬移后${afterTp && afterTp.maxRow}/${afterTp && afterTp.minRow})`);
    console.log('粒子动态(两帧变化):', movingOk ? 'PASS' : 'FAIL', `(${f1 && f1.rain} vs ${f2 && f2.rain})`);
    const exc = evts.filter(m => m.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length === 0 ? 'PASS' : 'FAIL ' + exc.length);
    process.exit(densityUp && uniformOk && movingOk && exc.length === 0 ? 0 : 1);
})();
