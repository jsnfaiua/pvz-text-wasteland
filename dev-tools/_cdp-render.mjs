// ============================================================
// _cdp-render.mjs — 渲染热路径验证（方向 D）
// 压力场景：40 僵尸 + 150 掉落（含 loot 袋 shadow 分支）+ 玩家病种绘制
// 验证：FPS 满帧零长帧零异常 + 截图存档（视觉回归检查用）
// 前置：node server.js(:8000) + headless Chrome(:9222)
// ============================================================
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
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
    async screenshot(path) {
        const r = await this.send('Page.captureScreenshot', { format: 'png' });
        if (r && r.data) fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FPS_PROBE = `(async () => {
    const secs = 1.5;
    return await new Promise(res => {
        let n = 0, long = 0, last = 0, maxGap = 0;
        const t0 = performance.now();
        const cb = (t) => {
            if (last) { const gap = t - last; if (gap > 25) long++; if (gap > maxGap) maxGap = gap; }
            last = t; n++;
            if (performance.now() - t0 < secs * 1000) requestAnimationFrame(cb);
            else res({ fps: Math.round(n / secs), long, maxGap: Math.round(maxGap) });
        };
        requestAnimationFrame(cb);
    });
})()`;

async function main() {
    const c = await CDPClient.connect(CDP_URL);
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');
    await c.eval(`(() => { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.includes('wasteland_')) localStorage.removeItem(k); } return true; })()`);
    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' } };
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))}); true`);
    await c.navigate('http://localhost:8000/index.html');
    await sleep(2500);
    await c.eval(`(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({});
        return 'entered';
    })()`, true);
    await sleep(2500);
    c.events.length = 0;

    // 压力注入：40 僵尸 + 150 掉落（80 loot 袋带 shadow + 70 普通）+ 病种（触发病种绘制分支）
    await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        for (let i = 0; i < 40; i++) {
            sv.zombies.push({ id: 'rz' + i, type: 'normal', char: '僵', color: '#fff', name: 'z', x: sv.px + (i % 8) * 44, y: sv.py + Math.floor(i / 8) * 44, hp: 100, maxHp: 100, speed: 1, damage: 5, horde: false, stunT: 0, hurt: 0, biteT: 0, infection: 0.3, atkState: null });
        }
        for (let i = 0; i < 150; i++) {
            sv.drops.push(i % 2 === 0
                ? { x: sv.px + (i % 15) * 22, y: sv.py + Math.floor(i / 15) * 22, id: 'loot:wood:' + i, n: 1, contents: [], searched: false }
                : { x: sv.px + (i % 15) * 22, y: sv.py + Math.floor(i / 15) * 22, id: 'wood', n: 1 });
        }
        sv._sick = { type: 'cold', duration: 99, startT: 0, cured: false };
        return 'injected: z=' + sv.zombies.length + ' drops=' + sv.drops.length + ' sick=' + (sv._sick.type);
    })()`);
    await sleep(500);

    const r = await c.eval(FPS_PROBE, true);
    console.log('压力场景 FPS:', JSON.stringify(r));
    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('  EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));

    await c.screenshot('dev-tools/_cdp-render-stress.png');
    console.log('截图已存: dev-tools/_cdp-render-stress.png');

    const ok = r.fps >= 55 && r.long === 0 && exc.length === 0;
    console.log(ok ? '=== D 渲染热路径验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
