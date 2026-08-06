// _cdp-events.mjs — E2 宝石+冷却 与 D Boss/随机事件 综合验证
const CDP = 'http://127.0.0.1:9222';
async function getJson(url) { return (await fetch(url + '/json')).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
    static async connect(url) {
        const tabs = await getJson(url);
        const tab = tabs.find(t => t.type === 'page') || tabs[0];
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const c = new CDPClient(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id) { const p = c.pending.get(msg.id); if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
            else c.events.push(msg);
        };
        return c;
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
    }
    eventsOf(method) { return this.events.filter(e => e.method === method); }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
        return r.result && r.result.value;
    }
    async navigate(url) { await this.send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 2500)); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const c = await CDPClient.connect(CDP);
    await c.send('Runtime.enable');
    await c.navigate('http://localhost:8000/index.html');
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', '${JSON.stringify(JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } }))}'); true`);
    await c.eval(`(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({});
        return 'entered';
    })()`, true);
    await sleep(2500);

    // ===== E2：宝石 + 冷却 =====
    const e2 = await c.eval(`(async () => {
        const sv = window.__surv.debugGetSv();
        sv.camp = { x: sv.px, y: sv.py, id: 'camp_t' };
        sv._tpCdReal = 0;
        // 无宝石：应拒绝
        sv.inv = [{ id: 'wood', n: 1 }, ...Array(23).fill(null)];
        const m = await import('./source-code/mod-wasteland/survival.js');
        // 直接调 tpToCamp（模块内不导出——改用 P 暂停面板按钮路径验证，此处先记录）
        return 'prepared';
    })()`, true);
    // 真实路径：暂停面板按钮
    const pause1 = await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); true`);
    await sleep(400);
    const btn1 = await c.eval(`(() => {
        const b = document.getElementById('wsl-p-tpcamp');
        return b ? b.textContent : 'no btn';
    })()`);
    console.log('无宝石按钮:', btn1);
    await c.eval(`document.getElementById('wsl-p-resume')?.click(); true`);   // 关暂停
    await sleep(300);

    // 给宝石 → 打开暂停 → 按钮应正常 → 传送成功
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv.inv = [{ id: 'tpgem', n: 1 }, ...Array(23).fill(null)]; sv._tpCdReal = 0; return true; })()`);
    await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); true`);
    await sleep(400);
    const btn2 = await c.eval(`(() => { const b = document.getElementById('wsl-p-tpcamp'); return b ? b.textContent : 'no btn'; })()`);
    console.log('有宝石按钮:', btn2);
    const tp1 = await c.eval(`(() => {
        const b = document.getElementById('wsl-p-tpcamp');
        if (!b) return 'no btn';
        b.click();
        const sv = window.__surv.debugGetSv();
        return JSON.stringify({ gemLeft: sv.inv.filter(x => x && x.id === 'tpgem').length, cdSet: sv._tpCdReal > performance.now(), paused: !!document.getElementById('wsl-pause') });
    })()`);
    console.log('传送后:', tp1);
    // 再点（冷却中）——打开暂停按钮应显示冷却
    await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); true`);
    await sleep(400);
    const btn3 = await c.eval(`(() => { const b = document.getElementById('wsl-p-tpcamp'); return b ? b.textContent : 'no btn'; })()`);
    console.log('冷却按钮:', btn3);
    await c.eval(`document.getElementById('wsl-p-resume')?.click(); true`);

    // ===== D：Boss 巨字尸 =====
    const boss = await c.eval(`(async () => {
        const sv = window.__surv.debugGetSv();
        const wz = await import('./source-code/mod-wasteland/wzombie.js');
        const z = wz.spawnZombie(sv, 'giant', sv.px + 100, sv.py + 100, true);
        const loot = wz.rollLootContents('epic', 'giant');
        return JSON.stringify({
            char: z.char, type: z.type, hp: z.hp, ability: z.textAbility,
            lootHasTpGem: loot.some(x => x.id === 'tpgem'),
        });
    })()`, true);
    console.log('Boss 巨字尸:', boss);

    // ===== D：随机事件（手动触发验证渲染/移动挂载无异常） =====
    const evt = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        sv._evt = { type: 'sandstorm', endT: sv.now + 30 };
        sv._lastEvtHour = (sv.t / sv.dayLen) * 24;
        return 'sandstorm set';
    })()`);
    await sleep(600);
    // 推进时间越过 endT，等下一帧 update 自动清除
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv.now = sv._evt.endT + 1; return true; })()`);
    await sleep(400);
    const evtOk = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        return JSON.stringify({ clearedAfterEnd: !sv._evt });
    })()`);
    console.log('沙尘暴结束自动清除:', evtOk);

    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('  EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 150));

    const ok = btn1 && btn1.includes('需传送宝石')
        && tp1 && tp1.includes('"gemLeft":0') && tp1.includes('"cdSet":true')
        && btn3 && btn3.includes('冷却')
        && boss && boss.includes('"type":"giant"') && boss.includes('"lootHasTpGem":true')
        && evtOk && evtOk.includes('"clearedAfterEnd":true')
        && exc.length === 0;
    console.log(ok ? '=== E2宝石+冷却 & D Boss+事件 验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
