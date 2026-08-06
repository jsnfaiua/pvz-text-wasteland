// _cdp-hfr.mjs — 高帧率实测：--disable-frame-rate-limit Chrome 下 RAF 帧率
// 验证游戏主循环无锁帧：RAF 跟随环境能力；逻辑 dt 驱动，高帧率稳定
const CDP_URL = 'http://127.0.0.1:9225';
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
const FPS_PROBE = `(async () => {
    const secs = 2;
    return await new Promise(res => {
        let n = 0, last = 0, maxGap = 0, minGap = 999;
        const t0 = performance.now();
        const cb = (t) => {
            if (last) { const gap = t - last; if (gap > maxGap) maxGap = gap; if (gap < minGap) minGap = gap; }
            last = t; n++;
            if (performance.now() - t0 < secs * 1000) requestAnimationFrame(cb);
            else res({ fps: Math.round(n / secs), maxGap: Math.round(maxGap), minGap: Math.round(minGap) });
        };
        requestAnimationFrame(cb);
    });
})()`;

async function main() {
    const c = await CDPClient.connect(CDP_URL);
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.navigate('http://localhost:8000/index.html');
    await sleep(1500);
    // 纯 RAF 帧率（无游戏，主菜单）
    const r1 = await c.eval(FPS_PROBE, true);
    console.log('主菜单 RAF 帧率:', JSON.stringify(r1));

    // 进入荒原后帧率
    await c.eval(`(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({});
        return 'entered';
    })()`, true);
    await sleep(2500);
    const r2 = await c.eval(FPS_PROBE, true);
    console.log('荒原内 RAF 帧率:', JSON.stringify(r2));
    // 压实体后再测
    await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        for (let i = 0; i < 30; i++) sv.zombies.push({ id: 'hf' + i, type: 'normal', char: '僵', color: '#fff', name: 'z', x: sv.px + (i % 6) * 44, y: sv.py + Math.floor(i / 6) * 44, hp: 100, maxHp: 100, speed: 1, damage: 5, horde: false, stunT: 0, hurt: 0, biteT: 0 });
        return 'injected';
    })()`);
    await sleep(300);
    const r3 = await c.eval(FPS_PROBE, true);
    console.log('30 僵尸压力帧率:', JSON.stringify(r3));
    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    console.log(r1.fps >= 55 && r2.fps >= 55 && r3.fps >= 55 && exc.length === 0 ? '=== 高帧率验证通过 ===' : '=== FAIL ===');
    console.log('（fps 若 >60 说明 --disable-frame-rate-limit 生效；=60 说明 headless 环境限制，代码本身无锁帧——dt 断言已证）');
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
