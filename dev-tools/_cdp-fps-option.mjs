// _cdp-fps-option.mjs — 普通玩家帧率显示验证
// 不开 dev 模式：workshop 面板设 showFps → 进荒原 → 右上角 FPS 小行出现
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

    // 注入存档（不设 devMode！）
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', '${JSON.stringify(JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } }))}'); true`);
    // 工作台设置 showFps（模拟玩家在面板点击）
    await c.eval(`document.getElementById('btn-workshop')?.click(); true`);
    await sleep(400);
    const panel = await c.eval(`(() => {
        const cards = [...document.querySelectorAll('#workshop-screen [data-mod], #workshop-screen .ws-card')];
        const t = cards.find(x => x.textContent && x.textContent.includes('荒原'));
        if (t) t.click();
        return 'clicked';
    })()`);
    await sleep(500);
    const fpsBtn = await c.eval(`(() => {
        const b = document.getElementById('ws-opt-fps');
        if (!b) return 'no btn';
        b.click();
        return 'toggled';
    })()`);
    console.log('面板帧率按钮:', fpsBtn);
    // 通过 enterWasteland 传入 opts（走 launchWasteland 等价路径：workshop 会传 mod state opts）
    const r = await c.eval(`(async () => {
        const ws = await import('./source-code/ui/workshop.js');
        // 直接读 mod state 看 showFps 是否已保存
        const st = ws.getModState('wasteland');
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({ ...(st && st.opts ? st.opts : {}) });
        return JSON.stringify({ modOpts: st ? st.opts : null });
    })()`, true);
    console.log('mod state opts:', r);
    await sleep(2500);
    // 检查 FPS 小行（不开 dev 模式）
    const hud = await c.eval(`(() => {
        const el = document.getElementById('wsl-hud');
        return JSON.stringify({ hasHud: !!el, text: el ? el.firstChild.textContent : null, devHud: false, showFps: window.__surv.debugGetSv()._showFps });
    })()`);
    console.log('FPS 显示:', hud);
    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    const ok = hud && hud.includes('"hasHud":true') && hud.includes('FPS') && hud.includes('"showFps":true') && exc.length === 0;
    console.log(ok ? '=== 普通玩家帧率显示验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
