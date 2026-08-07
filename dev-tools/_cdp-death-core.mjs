// _cdp-death-core.mjs — 直接验证 onDeath soft/hard 分支核心逻辑（绕过完整队伍系统干扰）
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

    // 准备：世界档 npcs 用正确结构 {people, controllerId, camp}，player maxHp=100 背包 4 件
    await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        for (const k of Object.keys(localStorage)) if (k.includes('wasteland_')) localStorage.removeItem(k);
        localStorage.setItem('u:__guest__:wasteland_character_测试救回', JSON.stringify({
            name: '测试救回', character: { skin: '#c49470', hair: '#34302d', shirt: '#39d98a', pants: '#314c58', shoes: '#20282b', eyes: '#232323' },
            inv: [{ id: 'wpn:rifle', n: 1, eq: 'ranged' }, { id: 'rifleAmmo', n: 60 }, { id: 'wood', n: 30 }, { id: 'med:bandage', n: 5 }].concat(Array(20).fill(null)),
            hotbar: ['wpn:rifle', null, null, null, null], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0,
            stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        const playerNpc = {
            id: 'player', isPlayer: true, name: '测试救回', role: 'friendly',
            look: { skin: '#c49470', hair: '#34302d', shirt: '#39d98a', pants: '#314c58', shoes: '#20282b', eyes: '#232323' },
            x: 18, y: 18, hp: 100, maxHp: 100, food: 100, water: 100,
            dmg: 10, wpnKey: null, wpnName: null,
            inv: [{ id: 'wpn:rifle', n: 1, eq: 'ranged' }, { id: 'rifleAmmo', n: 60 }, { id: 'wood', n: 30 }, { id: 'med:bandage', n: 5 }].concat(Array(20).fill(null)),
            wpn: null, coins: 0, sick: null,
            attrs: { str: 5, agi: 5, vit: 5, luc: 5 }, talent: null, congenital: null,
            act: { melee: 0, hit: 0, run: 0 }, bornDay: 1, alive: true,
            party: true, hired: false, hireFee: null, state: 'follow',
            campId: null, riding: false, workLog: [], _paidDay: 0, age: 1, _grown: 0,
        };
        localStorage.setItem('u:__guest__:wasteland_world_555001', JSON.stringify({
            seed: 555001, t: 3600, day: 3, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [],
            npcs: { people: [playerNpc], controllerId: 'player', camp: null },
            px: 18, py: 18, faceX: 1, faceY: 0,
        }));
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '测试救回', worldSeed: 555001 }));
        m.enterWasteland({ seed: 555001, characterName: '测试救回', difficulty: 'normal' });
        return 'entered';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 4000));

    const pre = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const p = (sv.npcs||[]).find(n => n.isPlayer);
        return JSON.stringify({ diff: sv.diffKey, invN: (sv.inv||[]).filter(Boolean).length, maxHp: sv.maxHp, npcMaxHp: p ? p.maxHp : 'none' });
    })()`, returnByValue: true });
    console.log('进入后:', pre.result && pre.result.value);

    // 死亡：直接调用 resolvePlayerHit 造成致命伤害（hp→0，死亡判定在 update 末尾统一触发）
    await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const p = (sv.npcs||[]).find(n => n.isPlayer);
        if (p) { p.maxHp = 100; sv.maxHp = 100; }
        const WA = await import('./source-code/mod-wasteland/waction.js');
        // 用一个临时僵尸造成 9999 伤害（hp 归零 → update 末尾 onDeath）
        WA.resolvePlayerHit(sv, { x: sv.px, y: sv.py, stunT: 0 }, 9999, () => true);
        return 'hit';
    })()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 2500));

    const chk = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const legacy = (sv.drops||[]).find(d => d.id === 'loot:legacy');
        return JSON.stringify({
            dead: sv.dead, hp: Math.round(sv.hp), maxHp: sv.maxHp,
            deathCount: sv._deathCount, invAfter: (sv.inv||[]).filter(Boolean).length,
            noPz: !(sv.zombies||[]).some(z => z.isPlayerZombie),
            legacyBag: legacy ? legacy.contents.length : null,
            guide: !!sv._legacyDrop,
            dropsCount: (sv.drops||[]).length,
        });
    })()`, returnByValue: true });
    console.log('正常模式死亡:', chk.result && chk.result.value);

    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 250));
    process.exit(0);
})();
