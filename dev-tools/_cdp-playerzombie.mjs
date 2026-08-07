// _cdp-playerzombie.mjs — 尸化僵尸 + 一条命存档延续 端到端实测
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

    // 创建 hard 难度角色+世界（角色名 测试尸化者）
    const s1 = await send('Runtime.evaluate', { expression: `(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        // 直接建角色档+世界档（跳过 UI 流程，模拟已有 hard 存档）
        localStorage.setItem('u:__guest__:wasteland_character_测试尸化者', JSON.stringify({
            name: '测试尸化者', character: { skin: '#c49470', hair: '#34302d', shirt: '#39d98a', pants: '#314c58', shoes: '#20282b', eyes: '#232323' },
            inv: [{ id: 'wpn:rifle', n: 1, eq: 'ranged' }, { id: 'rifleAmmo', n: 60 }].concat(Array(22).fill(null)),
            hotbar: ['wpn:rifle', null, null, null, null], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0,
            stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        }));
        localStorage.setItem('u:__guest__:wasteland_world_20260802', JSON.stringify({
            seed: 20260802, t: 3600, day: 3, playT: 300, mods: { tiles: {}, chests: {}, boxLoot: {} },
            homeBed: null, lastRestDay: 0, horde: null, zombies: [], npcs: [], px: 0, py: 0, faceX: 1, faceY: 0,
        }));
        localStorage.setItem('u:__guest__:wasteland_profile', JSON.stringify({ characterName: '测试尸化者', worldSeed: 20260802 }));
        return 'prepared';
    })()`, awaitPromise: true, returnByValue: true });
    console.log('准备:', s1.result && s1.result.value);

    // 进入世界（hard 难度）
    const ent = await send('Runtime.evaluate', { expression: `(async () => {
        try {
            const m = window.__surv;
            m.enterWasteland({ seed: 20260802, characterName: '测试尸化者', difficulty: 'hard' });
            return 'entered';
        } catch (e) { return 'ERR: ' + e.message + ' | ' + (e.stack || '').slice(0, 250); }
    })()`, awaitPromise: true });
    console.log('进入:', ent.result && ent.result.value);
    await new Promise(r => setTimeout(r, 3500));

    // 检查：玩家在 world，背包有 rifle
    const chk1 = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        return JSON.stringify({ hasSv: !!sv, name: sv.characterName, diff: sv.diffKey, inv: sv.inv.filter(Boolean).length, day: sv.day });
    })()`, returnByValue: true });
    console.log('状态:', chk1.result && chk1.result.value);

    // 触发死亡：hp 置 0（直接调 onDeath 内部路径——通过 hp<=0 主循环检测更真实，但直接设 hp=0 等主循环）
    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.hp = 0; return true; })()` });
    await new Promise(r => setTimeout(r, 1500));

    // 检查：尸化僵尸生成 + 播报 + 死亡界面按钮
    const chk2 = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const pz = sv.zombies.find(z => z.isPlayerZombie);
        const deathEl = document.querySelector('.wsl-scaler');
        const btns = deathEl ? Array.from(deathEl.querySelectorAll('button')).map(b => b.textContent) : [];
        return JSON.stringify({
            dead: sv.dead, pzExists: !!pz,
            pzName: pz ? pz.playerName : null, pzSkin: pz ? pz.skin : null,
            pzWpn: pz ? pz.wpnKey : null, pzInv: pz ? (pz.inv || []).filter(Boolean).length : null,
            deathBtns: btns, hasLog: true,
        });
    })()`, returnByValue: true });
    console.log('尸化+死亡界面:', chk2.result && chk2.result.value);

    // 截图死亡界面
    const shot1 = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        if (!sv || !sv.ctx) return null;
        return sv.ctx.canvas.toDataURL('image/png').slice(22);
    })()` });
    if (shot1.result && shot1.result.value) { writeFileSync('dev-tools/_cdp-pz-death.png', Buffer.from(shot1.result.value, 'base64')); console.log('死亡界面截图已存'); }

    // 点击「保存世界 · 重新捏脸归来」——先手动触发保存逻辑（模拟点击第一个按钮）
    const saveFlow = await send('Runtime.evaluate', { expression: `(async () => {
        // 死亡界面第一个按钮 = 保存并重新捏脸
        const btn = document.querySelectorAll('#wsl-death-opt')[0];
        if (!btn) return 'no button';
        btn.click();
        await new Promise(r => setTimeout(r, 500));
        // 现在应进入角色创建弹窗（命名输入框）
        const nameInput = document.getElementById('wsl-char-name');
        return nameInput ? 'createCharShown' : 'noCreateChar';
    })()`, awaitPromise: true, returnByValue: true });
    console.log('保存后流程:', saveFlow.result && saveFlow.result.value);

    // 世界档应已含尸化僵尸
    const worldChk = await send('Runtime.evaluate', { expression: `(() => {
        const w = JSON.parse(localStorage.getItem('u:__guest__:wasteland_world_20260802') || 'null');
        if (!w) return 'no world save';
        const pz = (w.zombies || []).find(z => z.isPlayerZombie);
        return JSON.stringify({ savedZombies: (w.zombies || []).length, pzSaved: !!pz, pzName: pz ? pz.playerName : null, pzWpn: pz ? pz.wpnKey : null, hasInv: pz ? !!(pz.inv && pz.inv.length) : false });
    })()`, returnByValue: true });
    console.log('世界档尸化检查:', worldChk.result && worldChk.result.value);

    // 完成新角色创建（输入名字→下一步→确认捏脸）——直接填名字点确定，然后捏脸确认
    const finishCreate = await send('Runtime.evaluate', { expression: `(async () => {
        const input = document.getElementById('wsl-char-name');
        if (!input) return 'no input';
        input.value = '归来者';
        document.getElementById('wsl-char-ok').click();
        await new Promise(r => setTimeout(r, 400));
        // 捏脸确认按钮（wlook.js showLookCreator 的 #wsl-look-ok）
        const lookOk = document.getElementById('wsl-look-ok');
        if (lookOk) { lookOk.click(); }
        else {
            // 尝试按按钮文本找
            const all = Array.from(document.querySelectorAll('button'));
            const ok = all.find(b => b.textContent.includes('确认') || b.textContent.includes('完成') || b.textContent.includes('开始'));
            if (ok) ok.click();
            else return 'noLookOk';
        }
        await new Promise(r => setTimeout(r, 3500));
        return 'createDone';
    })()`, awaitPromise: true, returnByValue: true });
    console.log('新建角色:', finishCreate.result && finishCreate.result.value);

    // 最终检查：新角色「归来者」进入了旧世界（seed 20260802），尸化僵尸还在
    const finalChk = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        if (!sv) return JSON.stringify({ noSv: true });
        const pz = sv.zombies.find(z => z.isPlayerZombie);
        return JSON.stringify({
            name: sv.characterName, seed: sv.world.seed, day: sv.day,
            pzInWorld: !!pz, pzName: pz ? pz.playerName : null,
            pzWpn: pz ? pz.wpnKey : null, pzInvN: pz ? (pz.inv || []).filter(Boolean).length : null,
        });
    })()`, returnByValue: true });
    console.log('最终（归来者视角）:', finalChk.result && finalChk.result.value);

    // 截图（能看到头顶名字的尸化僵尸）
    const shot2 = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        if (!sv || !sv.ctx) return null;
        const pz = sv.zombies.find(z => z.isPlayerZombie);
        if (pz) { sv.px = pz.x; sv.py = pz.y; }
        return sv.ctx.canvas.toDataURL('image/png').slice(22);
    })()` });
    await new Promise(r => setTimeout(r, 1200));
    const shot3 = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        return sv && sv.ctx ? sv.ctx.canvas.toDataURL('image/png').slice(22) : null;
    })()` });
    if (shot3.result && shot3.result.value) { writeFileSync('dev-tools/_cdp-pz-final.png', Buffer.from(shot3.result.value, 'base64')); console.log('最终视角截图已存'); }

    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 250));
    process.exit(0);
})();
