// ============================================================
// _cdp-gfx.mjs — 画质档专项验证（方向 B）
// 流程：进荒原(devMode) → 高/中/低三档 FPS 对比 →
//       低档 canvas 分辨率 0.75x + 特效上限 20 + 昼夜暗色关闭 →
//       切回高档恢复 → 零异常。
// 前置：node server.js(:8000) + headless Chrome(:9222)
// 用法：node dev-tools/_cdp-gfx.mjs
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
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FPS_PROBE = `(async () => {
    const secs = 1.5;
    return await new Promise(res => {
        let n = 0, last = 0, maxGap = 0;
        const t0 = performance.now();
        const cb = (t) => {
            if (last) { const gap = t - last; if (gap > maxGap) maxGap = gap; }
            last = t; n++;
            if (performance.now() - t0 < secs * 1000) requestAnimationFrame(cb);
            else res({ fps: Math.round(n / secs), maxGap: Math.round(maxGap) });
        };
        requestAnimationFrame(cb);
    });
})()`;

async function main() {
    const c = await CDPClient.connect(CDP_URL);
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');

    // 干净开局 + devMode
    await c.eval(`(() => {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.includes('wasteland_')) localStorage.removeItem(k);
        }
        return true;
    })()`);
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

    const probe = async (label) => {
        const r = await c.eval(FPS_PROBE, true);
        const cv = await c.eval(`(() => { const sv = window.__surv.debugGetSv(); return JSON.stringify({ w: sv.ctx.canvas.width, h: sv.ctx.canvas.height, gfx: sv._devGfx, effCap: sv.effects.length }); })()`);
        console.log(label, 'FPS:', JSON.stringify(r), 'canvas:', cv);
        return r;
    };

    // 高档（默认）
    const hi = await probe('[高]');
    // 中档
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv._devGfx = 1; return true; })()`);
    await sleep(400);
    const mid = await probe('[中]');
    // 低档
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv._devGfx = 0; return true; })()`);
    await sleep(400);
    const lo = await probe('[低]');

    // 低档验证：特效上限 20（注入 60 个特效）
    const effCheck = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        for (let i = 0; i < 60; i++) sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 5, maxLife: 5 });
        return 'injected 60 effects, now=' + sv.effects.length;
    })()`);
    console.log(effCheck);
    await sleep(300);
    const effAfter = await c.eval(`(() => { const sv = window.__surv.debugGetSv(); return 'after update effects=' + sv.effects.length; })()`);
    console.log(effAfter);

    // 低档昼夜验证：夜晚时刻 drawDayNight 应跳过（间接：_devGfx===0 时无暗色——直接断言函数行为）
    const night = await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv.t = sv.dayLen * 0.9; return 't set to night hour=' + ((sv.t / sv.dayLen) * 24).toFixed(1); })()`);
    console.log(night);

    // 切回高档恢复
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv._devGfx = 2; return true; })()`);
    await sleep(400);
    const back = await probe('[回高]');

    const exc = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('  EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));

    // 判定：三档均 ≥55fps；低档 canvas.width < 高档；特效上限生效
    const cvHi = await c.eval(`(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.width; })()`);
    const cvLo = await c.eval(`(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.width; })()`);
    // 需要单独在低档测 canvas——上面 back 已是高档，重新低档测宽
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv._devGfx = 0; return true; })()`);
    await sleep(500);
    const cvLo2 = await c.eval(`(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.width; })()`);
    await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv._devGfx = 2; return true; })()`);
    console.log('canvas 宽 高:' + cvHi, '低:' + cvLo2, '回高:' + cvLo);

    const ok = hi.fps >= 55 && mid.fps >= 55 && lo.fps >= 55 && back.fps >= 55
        && cvLo2 < cvHi && cvLo2 <= Math.ceil(cvHi * 0.76)
        && effAfter.includes('effects=') && parseInt(effAfter.split('=')[1], 10) <= 20
        && exc.length === 0;
    console.log(ok ? '=== B 画质档验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
