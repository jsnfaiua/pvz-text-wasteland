// 计算 windDirAt 的 windH 值，确认风向
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
    static async connect(url) {
        const ws = new WebSocket(url);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const c = new CDPClient(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id) { const p = c.pending.get(msg.id); if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
        };
        return c;
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
    }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text };
        return r.result && r.result.value;
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable'); await c.send('Page.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(3000);
    const r = await c.eval(`(async () => {
        const b = await import('./source-code/mod-wasteland/wbalance.js?v=' + Date.now());
        const out = {};
        for (const d of [1,2,3,4,5]) {
            const wd = b.windDirAt(20260802, d);
            const wh = Math.cos(wd);
            const deg = (wd * 180 / Math.PI).toFixed(0);
            const dir = wh > 0.5 ? '东风' : wh < -0.5 ? '西风' : (Math.sin(wd) > 0 ? '南风' : '北风');
            out['day' + d] = { rad: wd.toFixed(3), deg, windH: wh.toFixed(3), dir };
        }
        return out;
    })()`, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log('seed=20260802 各天风向:');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
