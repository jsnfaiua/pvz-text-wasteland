// ============================================================
// CDP 专项验证：host NPC 代驾（坐车）时 guest 端表现
// 验证：guest 端 p2.driving 状态同步、渲染不崩、FPS 满帧、零异常
// 前置：node server.js + Chrome :9222(host) / :9223(guest)
// 用法：node dev-tools/_cdp-mp-car.mjs
// ============================================================
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
    clearEvents() { this.events.length = 0; }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
        return r.result && r.result.value;
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FPS_PROBE = `(async () => {
    const secs = 2.0;
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
const CHAR_SAVE = { name: '测试', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' }, inv: [], hotbar: [], curSlot: 'ranged', hp: 100, maxHp: 100, food: 100, water: 100, infection: 0, stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false };
const PROFILE = { characterName: '测试', worldSeed: SEED };
async function setupPage(c, label) {
    await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable'); await c.send('Console.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(6000);
    c.clearEvents();
    await c.eval(`(() => {
        localStorage.removeItem('u:__guest__:wasteland_world_${SEED}'); localStorage.removeItem('u:__guest__:wasteland_save');
        localStorage.setItem('u:__guest__:wasteland_character_测试', ${JSON.stringify(JSON.stringify(CHAR_SAVE))});
        localStorage.setItem('u:__guest__:wasteland_profile', ${JSON.stringify(JSON.stringify(PROFILE))});
        localStorage.setItem('u:__guest__:wasteland_characters', JSON.stringify({ names: ['测试'] }));
        return 'ok';
    })()`);
    console.log(`[${label}] 预置 ok`);
}
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

async function main() {
    const host = await CDPClient.connect(CDP_HOST);
    const guest = await CDPClient.connect(CDP_GUEST);
    await setupPage(host, 'HOST');
    await setupPage(guest, 'GUEST');
    await host.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); m.startWastelandMP('host', { seed: ${SEED}, difficulty: 'normal' }); return 'ok'; })()`, true);
    const code = await waitFor(host, 'HOST', `(() => { const el = document.getElementById('wmp-code'); const t = el && el.textContent; return t && /^[A-Z0-9]{6}$/.test(t) && t !== '------' ? t : null; })()`, 15000, '房间码');
    if (!code) process.exit(1);
    await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); m.startWastelandMP('guest', {}); return 'ok'; })()`, true);
    await waitFor(guest, 'GUEST', `(() => document.getElementById('wmp-code-input') ? 'ui' : null)()`, 10000, 'guest UI');
    await guest.eval(`(() => { document.getElementById('wmp-code-input').value = '${code}'; document.getElementById('wmp-action').click(); return 'joined'; })()`);
    await waitFor(guest, 'GUEST', `(() => { const s = document.getElementById('wmp-status'); return s && /连接成功/.test(s.textContent) ? 'conn' : null; })()`, 15000, '连接成功');
    await host.eval(`(() => { document.getElementById('wmp-action').click(); return 'started'; })()`);
    console.log('双端握手完成，进入游戏...');
    await waitFor(host, 'HOST', `(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv && sv.active && sv.mp && sv.mp.role === 'host' ? 'in' : null; })()`, 30000, 'host 进入');
    await waitFor(guest, 'GUEST', `(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv && sv.active && sv.mp && sv.mp.role === 'guest' ? 'in' : null; })()`, 30000, 'guest 进入');
    await sleep(2000);

    // host 发车：放车 + NPC 司机 + 近处营地目标（几秒到达，行驶窗口内测 guest）
    const drive = await host.eval(`(async()=>{
        const m = await import('./source-code/mod-wasteland/survival.js');
        const wnpc = await import('./source-code/mod-wasteland/wnpc.js');
        const world = await import('./source-code/mod-wasteland/world.js');
        const sv = m.debugGetSv();
        const TS = 36;
        const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
        sv.mods.tiles[gx + ',' + gy] = { t: world.T.CAR, cond: 'intact', repaired: true, owner: '阿远', dir: 0 };
        sv.camp = { x: sv.px + 10 * TS, y: sv.py + 2 * TS };   // 近目标：行驶 ~10s
        const driver = wnpc.makeNpc(sv, sv.px, sv.py, 'friendly', { name: '阿远', party: true, id: 'npcT' + Date.now() });
        sv.npcs.push(driver);
        const ok = wnpc.startDriveOrder(sv, driver, 'camp');
        return ok ? 'chauffeur started, driving=' + !!sv.driving : 'fail';
    })()`, true);
    console.log('[HOST] 发车:', drive);
    await sleep(1500);

    // guest 端行驶中采样
    const gstate = await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv();
        return sv ? { driving: sv.p2 && sv.p2.driving ? { x: Math.round(sv.p2.driving.x / 36), y: Math.round(sv.p2.driving.y / 36) } : null,
            p2x: sv.p2 ? Math.round(sv.p2.x / 36) : null, zombies: sv.zombies.length } : null; })()`, true);
    console.log('[GUEST] host 驾驶状态同步:', JSON.stringify(gstate));
    console.log('[GUEST] FPS(host 开车中):', JSON.stringify(await guest.eval(FPS_PROBE, true)));
    console.log('[HOST] FPS(代驾中):', JSON.stringify(await host.eval(FPS_PROBE, true)));

    // 等订单完成（到达下车）再测一次
    await sleep(12000);
    const g2 = await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv ? { driving: sv.driving ? 'guest-driving' : null, hostDriving: sv.p2 && sv.p2.driving ? 'still' : null, fps: 'measured' } : null; })()`, true);
    console.log('[GUEST] 订单完成后:', JSON.stringify(g2));
    console.log('[GUEST] FPS(订单完成下车后):', JSON.stringify(await guest.eval(FPS_PROBE, true)));

    for (const [tag, c] of [['HOST', host], ['GUEST', guest]]) {
        const exc = c.eventsOf('Runtime.exceptionThrown');
        const errs = c.eventsOf('Runtime.consoleAPICalled').filter(e => e.params.type === 'error');
        console.log(`[${tag}] 异常:`, exc.length ? exc.map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).join(' | ').slice(0, 300) : '无', '| console.error:', errs.length ? errs.length : '无');
    }
    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
