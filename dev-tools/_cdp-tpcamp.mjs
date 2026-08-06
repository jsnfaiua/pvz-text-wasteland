// _cdp-tpcamp.mjs — E2 营地传送验证：设营地 → 走远 → 暂停面板传送按钮 → 回到营地
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

    // 设营地（当前玩家位置）+ 走远 300 格
    await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        sv.camp = { x: sv.px, y: sv.py, id: 'camp_test' };
        const farX = sv.px + 300 * 36;
        // 向远处铺一段可行走路（确保目标地可走）
        for (let i = 0; i < 10; i++) {
            const k = Math.floor((sv.px + i * 36) / 36) + ',' + Math.floor(sv.py / 36);
            sv.mods.tiles[k] = sv.mods.tiles[k] || { t: 0 };  // 0 = GROUND
        }
        sv.px = farX;
        return JSON.stringify({ camp: sv.camp, far: Math.round(farX), now: Math.round(sv.px) });
    })()`);
    // 用真实按键 P 打开暂停面板
    await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); true`);
    await sleep(400);
    const btn = await c.eval(`(() => {
        const b = document.getElementById('wsl-p-tpcamp');
        if (!b) return 'no btn';
        b.click();
        return 'clicked';
    })()`);
    console.log('传送按钮:', btn);
    await sleep(400);
    const after = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        return JSON.stringify({ px: Math.round(sv.px), campX: Math.round(sv.camp.x), dist: Math.round(Math.abs(sv.px - sv.camp.x)), paused: !!document.getElementById('wsl-pause') });
    })()`);
    console.log('传送后:', after);
    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    // dist < 36（一格内）即传送成功（落脚格中心与营地坐标有格心偏差）
    const dist = after ? parseInt(after.match(/"dist":(\d+)/)[1], 10) : 99999;
    const ok = btn === 'clicked' && dist < 36 && exc.length === 0;
    console.log(ok ? '=== E2 营地传送验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
