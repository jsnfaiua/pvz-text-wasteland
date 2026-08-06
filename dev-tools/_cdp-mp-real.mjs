// ============================================================
// CDP 双 Chrome 真实联机实测：host(9222) ↔ guest(9223)
// 目的：实测 guest（玩家）端在真实 wsync/wevt 协议下的 FPS 与卡顿
// 前置：node server.js(:8000 + :9000) + 两个 headless Chrome(:9222/:9223)
// 用法：node dev-tools/_cdp-mp-real.mjs
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
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');
    await c.send('Console.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(6000);
    c.clearEvents();
    const prep = await c.eval(`(() => {
        localStorage.removeItem('u:__guest__:wasteland_world_${SEED}');
        localStorage.removeItem('u:__guest__:wasteland_save');
        localStorage.setItem('u:__guest__:wasteland_character_测试', ${JSON.stringify(JSON.stringify(CHAR_SAVE))});
        localStorage.setItem('u:__guest__:wasteland_profile', ${JSON.stringify(JSON.stringify(PROFILE))});
        localStorage.setItem('u:__guest__:wasteland_characters', JSON.stringify({ names: ['测试'] }));
        return 'ok';
    })()`);
    console.log(`[${label}] 预置:`, prep);
}

async function waitFor(c, label, expr, timeoutMs = 30000, hint = '') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const v = await c.eval(expr);
        if (v && !(v.err)) return v;
        await sleep(500);
    }
    console.error(`[${label}] 等待超时: ${hint} | expr=${expr.slice(0, 80)}`);
    return null;
}

async function main() {
    const host = await CDPClient.connect(CDP_HOST);
    const guest = await CDPClient.connect(CDP_GUEST);
    console.log('已连接 host(9222) + guest(9223)');

    await setupPage(host, 'HOST');
    await setupPage(guest, 'GUEST');

    // host 创建房间
    await host.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); window.__mp = m; m.startWastelandMP('host', { seed: ${SEED}, difficulty: 'normal' }); return 'ok'; })()`, true);
    const code = await waitFor(host, 'HOST', `(() => { const el = document.getElementById('wmp-code'); const t = el && el.textContent; return t && /^[A-Z0-9]{6}\$/.test(t) && t !== '------' ? t : null; })()`, 15000, '房间码');
    if (!code) return;
    console.log('[HOST] 房间码:', code);

    // guest 加入
    await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/mpWasteland.js'); window.__mp = m; m.startWastelandMP('guest', {}); return 'ok'; })()`, true);
    await waitFor(guest, 'GUEST', `(() => document.getElementById('wmp-code-input') ? 'ui' : null)()`, 10000, 'guest UI');
    await guest.eval(`(() => { document.getElementById('wmp-code-input').value = '${code}'; document.getElementById('wmp-action').click(); return 'joined'; })()`);
    await waitFor(guest, 'GUEST', `(() => { const s = document.getElementById('wmp-status'); return s && /连接成功/.test(s.textContent) ? 'conn' : null; })()`, 15000, 'guest 连接成功');
    console.log('[GUEST] 已加入房间');

    // host 点开始
    const btnOk = await waitFor(host, 'HOST', `(() => { const b = document.getElementById('wmp-action'); return b && /开始/.test(b.textContent) && !b.disabled ? 'go' : null; })()`, 15000, 'host 开始按钮');
    if (!btnOk) { console.log('host 按钮状态:', await host.eval(`(() => { const b = document.getElementById('wmp-action'); return b ? b.textContent + '|disabled=' + b.disabled : 'no btn'; })()`)); }
    await host.eval(`(() => { document.getElementById('wmp-action').click(); return 'started'; })()`);
    console.log('[HOST] 已点开始，等待双端进入游戏...');

    // 双端进入荒原
    await waitFor(host, 'HOST', `(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv && sv.active && sv.mp && sv.mp.role === 'host' ? 'in' : null; })()`, 30000, 'host 进入');
    const guestIn = await waitFor(guest, 'GUEST', `(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv && sv.active && sv.mp && sv.mp.role === 'guest' ? 'in' : null; })()`, 30000, 'guest 进入');
    console.log('[GUEST] 进入:', guestIn);
    await sleep(2000);

    // host 注入实体压力（会经 wsync 下发 guest）
    const inject = await host.eval(`(() => {
        const sv = window.__sv = undefined;
        return 'placeholder';
    })()`);
    // 用 survival.debugGetSv 拿 host sv 注入
    const inject2 = await host.eval(`(async()=>{
        const m = await import('./source-code/mod-wasteland/survival.js');
        const sv = m.debugGetSv();
        const TS = 36;
        for (let i = 0; i < 45; i++) {
            const ang = (i / 45) * Math.PI * 2;
            sv.zombies.push({ id: 'z' + (sv._zIdSeq = (sv._zIdSeq || 0) + 1), type: 'normal', char: '僵', color: '#7fb39a', name: '僵尸',
                x: sv.px + Math.cos(ang) * (8 + (i % 5)) * TS, y: sv.py + Math.sin(ang) * (8 + (i % 5)) * TS,
                hp: 100, maxHp: 100, speed: 40, damage: 8, wt: 0, tx: sv.px, ty: sv.py, wDir: null, biteT: 0, hurt: 0, stunT: 0,
                biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0, horde: false, auraT: 0, infection: 0 });
        }
        for (let i = 0; i < 30; i++) {
            const ang = (i / 30) * Math.PI * 2;
            sv.drops.push({ x: sv.px + Math.cos(ang) * (6 + (i % 8)) * TS, y: sv.py + Math.sin(ang) * (6 + (i % 8)) * TS, id: i % 3 === 0 ? 'wood' : i % 3 === 1 ? 'food' : 'stone', n: 2 });
        }
        for (let i = 0; i < 40; i++) {
            sv.effects.push({ kind: i % 4 === 0 ? 'muzzle' : i % 4 === 1 ? 'hit' : 'dead', x: sv.px + (i % 8 - 4) * TS, y: sv.py + (Math.floor(i / 8) - 2) * TS, life: 2, maxLife: 2, label: '砰' });
        }
        for (let i = 0; i < 60; i++) {
            const ang = (i / 60) * Math.PI * 2;
            const gx = Math.round(sv.px / TS + Math.cos(ang) * (7 + (i % 6))), gy = Math.round(sv.py / TS + Math.sin(ang) * (7 + (i % 6)));
            sv.mods.plants[gx + ',' + gy] = { hp: 80, maxHp: 80, species: 'sunflower', growth: 0.6, type: 'player', atkT: 0, hostile: false, sunT: 0 };
        }
        sv._zombiePathNeedsRebuild = true;
        return '僵尸=' + sv.zombies.length + ' 掉落=' + sv.drops.length + ' 特效=' + sv.effects.length + ' 植物=' + Object.keys(sv.mods.plants).length;
    })()`, true);
    console.log('[HOST] 注入实体:', inject2);
    await sleep(3000);   // 等 30 拍 wsync 下发

    // guest 端状态确认 + FPS
    const gstate = await guest.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); const sv = m.debugGetSv(); return sv ? { zombies: sv.zombies.length, drops: sv.drops.length, effects: sv.effects.length, plants: Object.keys(sv.mods.plants || {}).length, npcs: sv.npcs.length, mp: sv.mp } : null; })()`, true);
    console.log('[GUEST] 快照同步状态:', JSON.stringify(gstate));

    console.log('[GUEST] FPS(站立):', JSON.stringify(await guest.eval(FPS_PROBE, true)));

    // guest 移动
    await guest.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(300);
    console.log('[GUEST] FPS(移动):', JSON.stringify(await guest.eval(FPS_PROBE, true)));
    await guest.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); })()`);

    // host 端 FPS 对照
    console.log('[HOST] FPS(同场景):', JSON.stringify(await host.eval(FPS_PROBE, true)));

    // 异常汇总
    const hExc = host.eventsOf('Runtime.exceptionThrown');
    const gExc = guest.eventsOf('Runtime.exceptionThrown');
    console.log('[HOST] 异常:', hExc.length ? hExc.map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).join(' | ').slice(0, 300) : '无');
    console.log('[GUEST] 异常:', gExc.length ? gExc.map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).join(' | ').slice(0, 300) : '无');
    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
