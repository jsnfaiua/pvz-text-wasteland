// _cdp-weather.mjs — 天气/染病实测（强制白天 12:00 让粒子清晰可见）
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
        localStorage.setItem('u:__guest__:wasteland_character_天气测试', JSON.stringify({
            name: '天气测试', character: { skin: '#c49470', hair: '#34302d', shirt: '#39d98a', pants: '#314c58', shoes: '#20282b', eyes: '#232323' },
            inv: [{ id: 'wpn:rifle', n: 1, eq: 'ranged' }, { id: 'wood', n: 30 }].concat(Array(22).fill(null)),
            hotbar: ['wpn:rifle', null, null, null, null], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0,
            stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_666001', JSON.stringify({
            seed: 666001, t: 3600, day: 3, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [], npcs: {
                people: [{
                    id: 'player', isPlayer: true, name: '天气测试', role: 'friendly',
                    look: { skin: '#c49470', hair: '#34302d', shirt: '#39d98a', pants: '#314c58', shoes: '#20282b', eyes: '#232323' },
                    x: 18, y: 18, hp: 100, maxHp: 100, food: 100, water: 100,
                    dmg: 10, wpnKey: null, wpnName: null,
                    inv: [{ id: 'wpn:rifle', n: 1, eq: 'ranged' }, { id: 'wood', n: 30 }].concat(Array(22).fill(null)),
                    wpn: null, coins: 0, sick: null,
                    attrs: { str: 5, agi: 5, vit: 5, luc: 5 }, talent: null, congenital: null,
                    act: { melee: 0, hit: 0, run: 0 }, bornDay: 1, alive: true,
                    party: true, hired: false, hireFee: null, state: 'follow',
                    campId: null, riding: false, workLog: [], _paidDay: 0, age: 1, _grown: 0,
                }],
                controllerId: 'player', camp: null,
            }, px: 18, py: 18, faceX: 1, faceY: 0,
        }));
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '天气测试', worldSeed: 666001 }));
        m.enterWasteland({ seed: 666001, characterName: '天气测试', difficulty: 'normal' });
        return 'entered';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));

    // 强制白天 12:00 + 高画质 + 取消昼夜压暗（让天气粒子在亮背景下清晰可见）
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        // 取 B.DAY_LEN
        const B = await import('./source-code/mod-wasteland/wbalance.js');
        sv.t = B.DAY_LEN * 0.5;    // 中午 12:00 → dayNightAlpha=0（白天无压暗）
        sv._devGfx = 2;             // 高画质
        sv._devTimeScale = 0;       // 暂停时间避免昼夜变化干扰
        return 'daytime set';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 800));

    const shot = async (name) => {
        const r = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
        if (r.result && r.result.value) { writeFileSync('dev-tools/_qa_tmp/' + name, Buffer.from(r.result.value, 'base64')); return true; }
        return false;
    };
    const countParticles = async () => {
        // 雨丝=蓝灰斜线 / 雪=白点 / 沙=黄横线 / 雾=全屏灰白（不数）
        const r = await send('Runtime.evaluate', { expression: `(() => {
            const sv = window.__surv.debugGetSv();
            const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
            const W = sv.ctx.canvas.width, H = sv.ctx.canvas.height;
            let rain = 0, snow = 0, sand = 0;
            for (let i = 0; i < img.length; i += 4) {
                const R = img[i], G = img[i+1], B = img[i+2];
                // 雨：蓝灰（中等亮蓝）
                if (B > 130 && B > R + 30 && G > 100 && G < 190 && R < 170 && B < 220) rain++;
                // 雪：纯白小点（RGB 都 > 200）
                if (R > 210 && G > 215 && B > 225) snow++;
                // 沙：暖黄横线（R 高 G 中 B 低）
                if (R > 180 && G > 120 && G < 180 && B < 120 && R < 235) sand++;
            }
            return JSON.stringify({ rain, snow, sand, weather: sv._weather });
        })()`, returnByValue: true });
        return r.result && r.result.value;
    };

    // 1) 动态验证：rain 天两帧粒子位置变化
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv._weather = 'rain'; return true; })()` });
    await new Promise(r => setTimeout(r, 800));
    const frameA = await countParticles();
    await new Promise(r => setTimeout(r, 300));
    const frameB = await countParticles();
    console.log('[动态] 雨两帧粒子数:', frameA, '→', frameB, '(变化即移动)');

    // 截图：rain
    await shot('wx2-rain.png');
    console.log('[雨] 截图 wx2-rain.png');

    // snow
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv._weather = 'snow'; return true; })()` });
    await new Promise(r => setTimeout(r, 800));
    console.log('[雪] 粒子统计:', await countParticles());
    await shot('wx2-snow.png');
    console.log('[雪] 截图 wx2-snow.png');

    // fog（无粒子，用雾层验证）
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv._weather = 'fog'; return true; })()` });
    await new Promise(r => setTimeout(r, 800));
    console.log('[雾] 粒子统计:', await countParticles());
    await shot('wx2-fog.png');
    console.log('[雾] 截图 wx2-fog.png');

    // sandstorm
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv._weather = 'sandstorm'; return true; })()` });
    await new Promise(r => setTimeout(r, 800));
    console.log('[沙] 粒子统计:', await countParticles());
    await shot('wx2-sandstorm.png');
    console.log('[沙] 截图 wx2-sandstorm.png');

    // clear 对照
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv._weather = 'clear'; return true; })()` });
    await new Promise(r => setTimeout(r, 800));
    console.log('[晴] 粒子统计:', await countParticles());
    await shot('wx2-clear.png');

    // 感染 stage5（文尸 90+）最强：触发升阶特效 + 覆盖层 + 噪点
    const infShot = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        sv._weather = 'clear';
        sv.infection = 95;   // stage5 文尸（噪点+深绿灰）
        sv.effects.push({ kind: 'infect', x: sv.px, y: sv.py - 10, life: 1.2, maxLife: 1.2, label: '文尸' });
        await new Promise(r => setTimeout(r, 500));
        return sv.ctx.canvas.toDataURL('image/png').slice(22);
    })()`, awaitPromise: true, returnByValue: true });
    if (infShot.result && infShot.result.value) { writeFileSync('dev-tools/_qa_tmp/wx2-infection-s5.png', Buffer.from(infShot.result.value, 'base64')); console.log('[感染s5] 截图'); }

    // 异常
    const exc = evts.filter(m => m.method === 'Runtime.exceptionThrown');
    console.log('异常数:', exc.length);
    process.exit(0);
})();