// 检查各 sprite 实际尺寸（真实页面导航环境）
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
    await c.send('Runtime.enable');
    await sleep(300);
    const r = await c.eval(`(async () => {
        const base = new URL('source-code/mod-wasteland/sprites/', window.location.href).href;
        const names = ['sprite-front.png','sprite-side.png','sprite-back.png','sprite-front-idle0.png','sprite-back-idle0.png','sprite-side-idle0.png','walk-front-f0.png','walk-side-f0.png','walk-back-f0.png'];
        const out = {};
        for (const n of names) {
            const img = new Image();
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = base + n; });
            out[n] = img.width + 'x' + img.height;
        }
        return out;
    })()`, true);
    if (r && r.err) { console.log('err', r.err); process.exit(1); }
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
