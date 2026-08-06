// ============================================================
// CDP 三 Chrome 真实联机实测：host(9222) ↔ guest1(9223) ↔ guest2(9224)
// 验证 3+ 人联机：3 人进入同世界、队友槽(teammates/p2s)、快照同步、独立血量、三端 FPS
// 前置：node server.js(:8000+:9000) + 3 个 headless Chrome(:9222/:9223/:9224)
// 用法：node dev-tools/_cdp-mp3.mjs
// ============================================================
const CDP_URLS = { host: 'http://127.0.0.1:9222', g1: 'http://127.0.0.1:9223', g2: 'http://127.0.0.1:9224' };
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
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');
    await c.send('Console.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(6000);
    c.clearEvents();
    await c.eval(`(() => {
        localStorage.removeItem('u:__guest__:wasteland_world_${SEED}');
        localStorage.removeItem('u:__guest__:wasteland_save');
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
    const host = await CDPClient.connect(CDP_URLS.host);
    const g1 = await CDPClient.connect(CDP_URLS.g1);
    const g2 = await CDPClient.connect(CDP_URLS.g2);
    console.log('已连接 host(9222) + guest1(9223) + guest2(9224)');
    await setupPage(host, 'HOST');
    await setupPage(g1, 'G1');
    await setupPage(g2, 'G2');

    // host 创建房间
    await host.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); window.__mp = m; m.startWastelandMP('host', { seed: ${SEED}, difficulty: 'normal' }); return 'ok'; })()`, true);
    const code = await waitFor(host, 'HOST', `(() => { const el = document.getElementById('wmp-code'); const t = el && el.textContent; return t && /^[A-Z0-9]{6}$/.test(t) && t !== '------' ? t : null; })()`, 15000, '房间码');
    if (!code) { console.log('[HOST] 房间码获取失败'); process.exit(1); }
    console.log('[HOST] 房间码:', code);

    // 两 guest 依次加入
    for (const [tag, c] of [['G1', g1], ['G2', g2]]) {
        await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); window.__mp = m; m.startWastelandMP('guest', {}); return 'ok'; })()`, true);
        await waitFor(c, tag, `(() => document.getElementById('wmp-code-input') ? 'ui' : null)()`, 10000, 'guest UI');
        await c.eval(`(() => { document.getElementById('wmp-code-input').value = '${code}'; document.getElementById('wmp-action').click(); return 'joined'; })()`);
        const ok = await waitFor(c, tag, `(() => { const s = document.getElementById('wmp-status'); return s && /连接成功/.test(s.textContent) ? 'conn' : null; })()`, 15000, '连接成功');
        console.log(`[${tag}] 加入:`, ok);
    }
    await sleep(1000);

    // host 开始（全员就绪才 wgo）
    await host.eval(`(() => { document.getElementById('wmp-action').click(); return 'clicked'; })()`);
    console.log('[HOST] 已点开始，等待三端进入...');

    // 三端进入荒原
    const enterAll = async () => {
        const results = {};
        for (const [tag, c] of [['HOST', host], ['G1', g1], ['G2', g2]]) {
            const r = await waitFor(c, tag, `(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv && sv.active && sv.mp ? sv.mp.role : null; })()`, 30000, '进入游戏');
            results[tag] = r;
        }
        return results;
    };
    const entered = await enterAll();
    console.log('三端进入:', JSON.stringify(entered));
    await sleep(2000);

    // host 注入实体压力（wsync 下发双 guest）
    const inject = await host.eval(`(async()=>{
        const m = await import('./source-code/mod-wasteland/survival.js');
        const sv = m.debugGetSv();
        const TS = 36;
        for (let i = 0; i < 40; i++) {
            const ang = (i / 40) * Math.PI * 2;
            sv.zombies.push({ id: 'z' + (sv._zIdSeq = (sv._zIdSeq || 0) + 1), type: 'normal', char: '僵', color: '#7fb39a', name: '僵尸',
                x: sv.px + Math.cos(ang) * (8 + (i % 5)) * TS, y: sv.py + Math.sin(ang) * (8 + (i % 5)) * TS,
                hp: 100, maxHp: 100, speed: 40, damage: 8, wt: 0, tx: sv.px, ty: sv.py, wDir: null, biteT: 0, hurt: 0, stunT: 0,
                biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0, horde: false, auraT: 0, infection: 0 });
        }
        for (let i = 0; i < 20; i++) {
            const ang = (i / 20) * Math.PI * 2;
            sv.drops.push({ x: sv.px + Math.cos(ang) * (6 + (i % 6)) * TS, y: sv.py + Math.sin(ang) * (6 + (i % 6)) * TS, id: i % 2 ? 'wood' : 'food', n: 2 });
        }
        sv._zombiePathNeedsRebuild = true;
        return '僵尸=' + sv.zombies.length + ' 掉落=' + sv.drops.length;
    })()`, true);
    console.log('[HOST] 注入实体:', inject);
    await sleep(3000);

    // 三端同步状态核对（快照实体数 + 队友槽）
    for (const [tag, c] of [['HOST', host], ['G1', g1], ['G2', g2]]) {
        const st = await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv ? {
            role: sv.mp && sv.mp.role, zombies: sv.zombies.length, drops: sv.drops.length,
            p2: sv.p2 ? sv.p2.name : null, p2s: sv.p2s ? Object.keys(sv.p2s).length : 0,
            mpGuestId: sv.mp ? (sv._mpGid || null) : null
        } : null; })()`, true);
        console.log(`[${tag}] 状态:`, JSON.stringify(st));
    }

    // 三端 FPS
    for (const [tag, c] of [['HOST', host], ['G1', g1], ['G2', g2]]) {
        console.log(`[${tag}] FPS(站立):`, JSON.stringify(await c.eval(FPS_PROBE, true)));
    }

    // 异常汇总
    for (const [tag, c] of [['HOST', host], ['G1', g1], ['G2', g2]]) {
        const exc = c.eventsOf('Runtime.exceptionThrown');
        const errs = c.eventsOf('Runtime.consoleAPICalled').filter(e => e.params.type === 'error');
        console.log(`[${tag}] 异常:`, exc.length ? exc.map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).join(' | ').slice(0, 300) : '无', '| console.error:', errs.length ? errs.length : '无');
    }
    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
