// _cdp-pz-guide.mjs — 尸化自己距离指引 实测
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

    // 造世界档：含一只尸化僵尸（在远处 400 格）
    await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        localStorage.setItem('u:__guest__:wasteland_character_归来者2', JSON.stringify({
            name: '归来者2', character: { skin: '#c49470', hair: '#34302d', shirt: '#39d98a', pants: '#314c58', shoes: '#20282b', eyes: '#232323' },
            inv: [], hotbar: [], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0,
            stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_778899', JSON.stringify({
            seed: 778899, t: 3600, day: 5, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null,
            zombies: [{
                id: 'z1', type: 'playerzombie', char: '尸', color: '#39d98a', name: '测试尸化者',
                x: 14400, y: 14400, tx: 14400, ty: 14400, hp: 500, maxHp: 500, speed: 26, damage: 22,
                horde: false, vaulted: false, _nightStrengthActive: false,
                isPlayerZombie: true, playerName: '测试尸化者', skin: '#c49470',
                inv: [{ id: 'wpn:rifle', n: 1, eq: 'ranged' }], hotbar: ['wpn:rifle'], wpnKey: 'rifle',
            }],
            npcs: [], px: 720, py: 720, faceX: 1, faceY: 0,
        }));
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '归来者2', worldSeed: 778899 }));
        return 'prepared';
    })()`, awaitPromise: true, returnByValue: true });
    console.log('准备:', (await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({ seed: 778899, characterName: '归来者2', difficulty: 'normal' });
        return 'entered';
    })()`, awaitPromise: true })).result && 'entered');
    await new Promise(r => setTimeout(r, 3500));

    // 玩家在 (720,720) 格像素=20*36；尸化僵尸在 (14400,14400)=400*36 → 屏幕外
    // 先验证指引函数是否绘制（直接看屏幕边缘是否有紫黑色素）
    const chkFar = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        // 找紫色系像素（#9B6DFF ~ (155,109,255) 的近似）
        let purple = 0;
        for (let i = 0; i < img.length; i += 4) {
            const r = img[i], g = img[i+1], b = img[i+2];
            if (b > 180 && b > r + 40 && r > 100 && g > 60 && g < 170) purple++;
        }
        const pz = sv.zombies.find(z => z.isPlayerZombie);
        return JSON.stringify({ purplePx: purple, pzExists: !!pz, dist: pz ? Math.round(Math.hypot(pz.x - sv.px, pz.y - sv.py) / 36) : null });
    })()`, returnByValue: true });
    console.log('远处指引检测（紫色像素）:', chkFar.result && chkFar.result.value);

    // 截图远处
    const shotFar = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shotFar.result && shotFar.result.value) { writeFileSync('dev-tools/_cdp-pz-guide-far.png', Buffer.from(shotFar.result.value, 'base64')); console.log('远处截图已存'); }

    // 传送到尸化僵尸旁边（同屏 → 指引应消失，显示名字牌）
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = 14400; sv.py = 14400; return true; })()` });
    await new Promise(r => setTimeout(r, 1200));
    const chkNear = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        let purple = 0;
        for (let i = 0; i < img.length; i += 4) {
            const r = img[i], g = img[i+1], b = img[i+2];
            if (b > 180 && b > r + 40 && r > 100 && g > 60 && g < 170) purple++;
        }
        return JSON.stringify({ purplePx: purple });
    })()`, returnByValue: true });
    console.log('同屏指引检测（应≈0）:', chkNear.result && chkNear.result.value);
    const shotNear = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (shotNear.result && shotNear.result.value) { writeFileSync('dev-tools/_cdp-pz-guide-near.png', Buffer.from(shotNear.result.value, 'base64')); console.log('同屏截图已存'); }

    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
})();
