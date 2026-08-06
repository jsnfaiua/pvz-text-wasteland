// _cdp-recent-room.mjs — C 联机小补强验证：最近房间快捷重进 UI
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
    await c.send('Page.enable');
    await c.navigate('http://localhost:8000/index.html');

    // 1. 有最近房间 → 按钮出现 + 点击填充输入框
    await c.eval(`localStorage.setItem('wasteland_recent_room', 'ABC123'); true`);
    await c.eval(`(async () => { const m = await import('./source-code/mod-wasteland/mpWasteland.js'); m.startWastelandMP('guest', {}); return 'started'; })()`, true);
    await sleep(900);
    const ui = await c.eval(`(() => {
        const btn = document.getElementById('wmp-recent');
        const input = document.getElementById('wmp-code-input');
        let filled = null;
        if (btn) { btn.click(); filled = input.value; }
        return JSON.stringify({ hasRecentBtn: !!btn, btnText: btn ? btn.textContent : null, filled });
    })()`);
    console.log('有最近房间 UI:', ui);
    await c.eval(`document.getElementById('wmp-cancel')?.click(); true`);

    // 2. 无最近房间 → 无按钮
    await c.eval(`localStorage.removeItem('wasteland_recent_room'); true`);
    await c.eval(`(async () => { const m = await import('./source-code/mod-wasteland/mpWasteland.js'); m.startWastelandMP('guest', {}); return 's2'; })()`, true);
    await sleep(700);
    const ui2 = await c.eval(`(() => ({ hasRecentBtn: !!document.getElementById('wmp-recent') }))()`);
    console.log('无最近房间 UI:', JSON.stringify(ui2));
    await c.eval(`document.getElementById('wmp-cancel')?.click(); true`);

    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    const ok = ui && ui.includes('"hasRecentBtn":true') && ui.includes('ABC123') && ui.includes('"filled":"ABC123"') && ui2 && ui2.hasRecentBtn === false && exc.length === 0;
    console.log(ok ? '=== C 联机小补强验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
