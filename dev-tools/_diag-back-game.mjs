// 检查游戏内 back sprite 加载状态（轮询等待加载）+ 玩家 look + 实际渲染
const CDP_URL = 'http://127.0.0.1:9222';
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
    // 轮询等待 sprite 加载
    let back = null;
    for (let i = 0; i < 20; i++) {
        const r = await c.eval(`(async () => {
            const mod = await import('./source-code/mod-wasteland/render.js?v=' + Date.now());
            return { backLoaded: !!(mod._mcSprites && mod._mcSprites.back), walkBack0: !!(mod._mcWalk && mod._mcWalk.back && mod._mcWalk.back[0]) };
        })()`, true);
        if (r && r.backLoaded) { back = r; break; }
        await sleep(500);
    }
    console.log('sprite 加载状态:', JSON.stringify(back));
    const r2 = await c.eval(`(async () => {
        const mod = await import('./source-code/mod-wasteland/render.js?v=' + Date.now());
        const sv = window.__sv.debugGetSv();
        const b = mod._mcSprites && mod._mcSprites.back;
        return {
            backW: b ? b.width : 0, backH: b ? b.height : 0,
            walkBack: (mod._mcWalk && mod._mcWalk.back || []).map(x => x ? (x.width + 'x' + x.height) : null),
            look: sv.character, faceX: sv.faceX, faceY: sv.faceY,
        };
    })()`, true);
    console.log(JSON.stringify(r2, null, 2));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
