// _cdp-tut.mjs — 教程引导验证：首次显示 → 点击关闭 → 标记 → 重进不再弹
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

    // 清除教程标记 + 注入存档 + 进荒原
    await c.eval(`localStorage.removeItem('wasteland_tutorial_seen'); localStorage.setItem('u:__guest__:wasteland_save', '${JSON.stringify(JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } }))}'); true`);
    await c.eval(`(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        m.enterWasteland({});
        return 'entered';
    })()`, true);
    await sleep(2500);
    const r1 = await c.eval(`(() => {
        const tut = document.getElementById('wsl-tut');
        return JSON.stringify({ shown: !!tut, hasOk: tut ? !!tut.querySelector('#wsl-tut-ok') : false, txt: tut ? tut.textContent.includes('生存指南') : false });
    })()`);
    console.log('首次进入提示卡:', r1);

    // 点击关闭 → 标记写入
    await c.eval(`document.getElementById('wsl-tut-ok')?.click(); true`);
    await sleep(400);
    const r2 = await c.eval(`(() => {
        const tut = document.getElementById('wsl-tut');
        const marked = localStorage.getItem('wasteland_tutorial_seen');
        return JSON.stringify({ gone: !tut, marked });
    })()`);
    console.log('点击后:', r2);

    // 重进不再弹
    await c.eval(`(async () => { const m = await import('./source-code/mod-wasteland/survival.js'); m.exitWasteland(true); return 'exited'; })()`, true);
    await sleep(1200);
    await c.eval(`(async () => { const m = await import('./source-code/mod-wasteland/survival.js'); m.enterWasteland({}); return 're-entered'; })()`, true);
    await sleep(2500);
    const r3 = await c.eval(`(() => JSON.stringify({ shownAgain: !!document.getElementById('wsl-tut') }))()`);
    console.log('重进后:', r3);

    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    const ok = r1 && r1.includes('"shown":true') && r2 && r2.includes('"gone":true') && r2.includes('"marked":"1"') && r3 && r3.includes('"shownAgain":false') && exc.length === 0;
    console.log(ok ? '=== 教程引导验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
