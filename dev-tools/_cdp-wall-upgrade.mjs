// _cdp-wall-upgrade.mjs — B1 墙升级链验证：建木墙 → 升石墙 → 升金属墙 → 耐久/材料/拆除返还
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

    const r = await c.eval(`(async () => {
        const sv = window.__surv.debugGetSv();
        const wb = await import('./source-code/mod-wasteland/wbuild.js');
        const render = await import('./source-code/mod-wasteland/render.js');
        const world = await import('./source-code/mod-wasteland/world.js');
        // 材料：wood 8 / stone 8 / part 4
        sv.inv = [
            { id: 'wood', n: 8 }, { id: 'stone', n: 8 }, { id: 'part', n: 4 },
            ...Array(21).fill(null),
        ];
        // 选木墙（buildSel=0）并放到玩家脚下 3 格内空地
        sv.buildSel = 0;
        const gx = Math.floor(sv.px / 36) + 2, gy = Math.floor(sv.py / 36);
        const key = gx + ',' + gy;
        sv.mods.tiles[key] = { t: world.T.GROUND };   // 空地
        const countItem = (id) => { const s = sv.inv.find(x => x && x.id === id); return s ? s.n : 0; };
        const takeItem = (id, n) => { const s = sv.inv.find(x => x && x.id === id); if (s) s.n -= n; };
        // 1. 建木墙
        wb.placeBuild(sv, gx, gy, countItem, takeItem);
        const lv1 = sv.mods.tiles[key].lv || 1;
        const hp1 = sv.mods.tiles[key].hp;
        // 2. 升石墙（消耗 stone×3）
        wb.placeBuild(sv, gx, gy, countItem, takeItem);
        const lv2 = sv.mods.tiles[key].lv || 1;
        const hp2 = sv.mods.tiles[key].hp;
        // 3. 升金属墙（消耗 part×2+stone×3）
        wb.placeBuild(sv, gx, gy, countItem, takeItem);
        const lv3 = sv.mods.tiles[key].lv || 1;
        const hp3 = sv.mods.tiles[key].hp;
        // 4. 拆除返还
        wb.demolish(sv, gx, gy);
        const after = sv.inv.filter(Boolean).map(x => x.id + 'x' + x.n).join(',');
        return JSON.stringify({
            lv: [lv1, lv2, lv3],
            hp: [hp1, hp2, hp3],
            stoneLeft: countItem('stone'), partLeft: countItem('part'),
            afterDemolish: after,
            wallGone: sv.mods.tiles[key] && sv.mods.tiles[key].t === '.',
        });
    })()`, true);
    console.log('墙升级:', r);
    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    const d = JSON.parse(r || '{}');
    const ok = d.lv && d.lv[0] === 1 && d.lv[1] === 2 && d.lv[2] === 3
        && d.hp[1] > d.hp[0] && d.hp[2] > d.hp[1]
        && d.stoneLeft === 3 && d.partLeft === 3      // 8-3-3+1返还=3；4-2+1返还=3
        && d.afterDemolish && d.wallGone === true
        && exc.length === 0;
    console.log(ok ? '=== B1 墙升级链验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
