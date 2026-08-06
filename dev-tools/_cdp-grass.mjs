// _cdp-grass.mjs — 草地视觉优化验证：抓取荒原 canvas 实际渲染画面
import fs from 'node:fs';
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

async function grab(c, path) {
    const r = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        const dataUrl = sv.ctx.canvas.toDataURL('image/png');
        return dataUrl.slice(22);   // 去 'data:image/png;base64,'
    })()`);
    if (r && r.length > 1000) fs.writeFileSync(path, Buffer.from(r, 'base64'));
    return !!r;
}

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
    await sleep(3000);

    // 场景1：出生点草地
    await grab(c, 'dev-tools/_cdp-grass-1.png');
    console.log('场景1 截图已存');
    // 场景2：向右走 100 格（可能跨 biome）再截
    await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        const dir = 1;
        for (let i = 0; i < 120; i++) {
            const k = Math.floor((sv.px + i * 36) / 36) + ',' + Math.floor(sv.py / 36);
            sv.mods.tiles[k] = sv.mods.tiles[k] || { t: '.' };
        }
        sv.px += 100 * 36;
        return true;
    })()`);
    await sleep(1500);
    await grab(c, 'dev-tools/_cdp-grass-2.png');
    console.log('场景2 截图已存');

    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    console.log('=== 草地截图完成（_cdp-grass-1/2.png）===');
    process.exit(exc.length === 0 ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
