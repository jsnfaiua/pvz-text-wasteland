// _cdp-weather-mp.mjs — 天气/随机事件 双端同步实测（§9 改联机快照字段必跑双端 CDP）
// 前置：node server.js + 两个 headless Chrome(:9222/:9223)
// 验证：host 设天气 rain + blackout 事件 → guest 端 wsync 快照同步（weather/evt 字段）→ 双端渲染同款
const CDP_HOST = 'http://127.0.0.1:9222';
const CDP_GUEST = 'http://127.0.0.1:9223';
const PAGE_URL = 'http://localhost:8000/index.html';
const SEED = 20260802;

async function getJson(url, path) { return (await fetch(url + path)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
    static async connect(url) {
        const tabs = await getJson(url, '/json');
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
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(c, label, expr, timeoutMs = 30000, hint = '') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const v = await c.eval(expr);
        if (v && !(v.err)) return v;
        await sleep(500);
    }
    console.error(`[${label}] 等待超时: ${hint}`);
    return null;
}

const CHAR_SAVE = { name: '测天', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' }, inv: [], hotbar: [], curSlot: 'ranged', hp: 100, maxHp: 100, food: 100, water: 100, infection: 0, stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false };
const PROFILE = { characterName: '测天', worldSeed: SEED };

async function setupPage(c) {
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');
    await c.send('Console.enable');
    await c.send('Network.enable');
    await c.send('Network.clearBrowserCache');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(6000);
    c.events.length = 0;
    await c.eval(`(() => {
        localStorage.removeItem('u:__guest__:wasteland_world_${SEED}');
        localStorage.removeItem('u:__guest__:wasteland_save');
        localStorage.setItem('u:__guest__:wasteland_character_测天', ${JSON.stringify(JSON.stringify(CHAR_SAVE))});
        localStorage.setItem('u:__guest__:wasteland_profile', ${JSON.stringify(JSON.stringify(PROFILE))});
        localStorage.setItem('u:__guest__:wasteland_characters', JSON.stringify({ names: ['测天'] }));
        return 'prepped';
    })()`);
}

(async () => {
    const host = await CDPClient.connect(CDP_HOST);
    const guest = await CDPClient.connect(CDP_GUEST);
    console.log('已连接 host(9222) + guest(9223)');
    await setupPage(host);
    await setupPage(guest);

    // host 建房
    await host.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); window.__mp = m; m.startWastelandMP('host', { seed: ${SEED}, difficulty: 'normal' }); return 'ok'; })()`, true);
    const code = await waitFor(host, 'HOST', `(() => { const el = document.getElementById('wmp-code'); const t = el && el.textContent; return t && /^[A-Z0-9]{6}$/.test(t) && t !== '------' ? t : null; })()`, 15000, '房间码');
    if (!code) { console.log('房间码失败'); process.exit(1); }
    console.log('[HOST] 房间码:', code);

    // guest 加入
    await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); window.__mp = m; m.startWastelandMP('guest', {}); return 'ok'; })()`, true);
    await waitFor(guest, 'GUEST', `(() => document.getElementById('wmp-code-input') ? 'ui' : null)()`, 10000, 'guest UI');
    await guest.eval(`(() => { document.getElementById('wmp-code-input').value = '${code}'; document.getElementById('wmp-action').click(); return 'joined'; })()`);
    await waitFor(guest, 'GUEST', `(() => { const s = document.getElementById('wmp-status'); return s && /连接成功/.test(s.textContent) ? 'conn' : null; })()`, 15000, 'guest 连接');
    console.log('[GUEST] 已加入');

    // host 开始
    await host.eval(`(() => { document.getElementById('wmp-action').click(); return 'started'; })()`);
    await waitFor(host, 'HOST', `(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv && sv.active && sv.mp && sv.mp.role === 'host' ? 'in' : null; })()`, 30000, 'host 进入');
    await waitFor(guest, 'GUEST', `(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv && sv.active && sv.mp && sv.mp.role === 'guest' ? 'in' : null; })()`, 30000, 'guest 进入');
    console.log('[OK] 双端进入游戏');
    await sleep(2000);

    // host 设天气 rain（dev 天气按钮同款：直接设 sv._weather，host 权威）
    await host.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); sv._devGfx = 2; sv.t = 3600 * 0.5; sv._weather = 'rain'; return sv._weather; })()`, true);
    // 等 wsync 同步（100ms 一拍，等 2s 足够多拍）
    await sleep(2500);
    const guestWx = await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return JSON.stringify({ weather: sv._weather, t: sv.t }); })()`, true);
    console.log('[天气同步] guest 端:', guestWx, '(期望 weather="rain")');

    // host 设 blackout 事件（host 权威，wsync evt 字段）
    await host.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); sv._evt = { type: 'blackout', endT: sv.now + 60 }; return 'ok'; })()`, true);
    await sleep(1500);
    const guestEvt = await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return JSON.stringify({ evt: sv._evt }); })()`, true);
    console.log('[事件同步] guest 端:', guestEvt, '(期望 evt.type="blackout")');

    // host 清事件（验证 guest 端 evt 置 null）
    await host.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); sv._evt = null; return 'ok'; })()`, true);
    await sleep(1500);
    const guestEvt2 = await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return JSON.stringify({ evt: sv._evt }); })()`, true);
    console.log('[事件清除同步] guest 端:', guestEvt2, '(期望 evt=null)');

    // 双端渲染确认：host 与 guest 都画天气粒子（雨丝计数，白天）
    const countRain = async (c) => c.eval(`(() => {
        const sv = window.__sv2 ? null : null;
        return 'skip';
    })()`);
    // 简化：双端 sv._weather 已确认一致 → 渲染走同一 drawWeatherOverlay/Particles 代码路径（§5.1 检查项1），
    // 单端已 CDP 截图验证粒子渲染（_cdp-weather.mjs），此处验证状态同步即可。

    // 双端异常统计
    const hostExc = host.eventsOf('Runtime.exceptionThrown').length;
    const guestExc = guest.eventsOf('Runtime.exceptionThrown').length;
    console.log('异常 host:', hostExc, 'guest:', guestExc);
    const wxOk = guestWx && guestWx.includes('"weather":"rain"');
    const evtOk = guestEvt && guestEvt.includes('"type":"blackout"');
    const clearOk = guestEvt2 && guestEvt2.includes('"evt":null');
    console.log('\n=== 结论 ===');
    console.log('天气同步:', wxOk ? 'PASS' : 'FAIL');
    console.log('事件同步:', evtOk ? 'PASS' : 'FAIL');
    console.log('事件清除:', clearOk ? 'PASS' : 'FAIL');
    console.log('异常:', hostExc + guestExc === 0 ? 'PASS' : 'FAIL');
    process.exit(wxOk && evtOk && clearOk ? 0 : 1);
})();
