// ============================================================
// CDP host 负载定位：流场重建 vs wsync 序列化 vs 渲染，各自贡献
// 单机进入 → 僵尸散布（近 10 + 远 35）→ 分段 FPS 对比
// 前置：node server.js + headless Chrome(:9222)；node dev-tools/_cdp-host-load.mjs
// ============================================================
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';

async function getJson(path) { return (await fetch(CDP_URL + path)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
    static async connect(url) {
        const tabs = await getJson('/json');
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

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');
    await c.send('Console.enable');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(6000);
    c.clearEvents();

    const save = { v: 3, seed: 20260802, day: 5, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' } };
    await c.eval(`localStorage.removeItem('u:__guest__:wasteland_world_20260802'); localStorage.removeItem('u:__guest__:wasteland_profile'); localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({}); return 'ok'; })()`, true);
    await sleep(2500);

    // 僵尸散布：近 10（6-12 格）+ 远 35（15-30 格，屏幕外）——真实长局分布
    const inject = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        const TS = 36;
        const mk = (i, dist) => {
            const ang = (i * 2.399963) ;   // 黄金角散布
            return { id: 'z' + (sv._zIdSeq = (sv._zIdSeq || 0) + 1), type: 'normal', char: '僵', color: '#7fb39a', name: '僵尸',
                x: sv.px + Math.cos(ang) * dist * TS, y: sv.py + Math.sin(ang) * dist * TS,
                hp: 100, maxHp: 100, speed: 40, damage: 8, wt: 0, tx: sv.px, ty: sv.py, wDir: null, biteT: 0, hurt: 0, stunT: 0,
                biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0, horde: false, auraT: 0, infection: 0 };
        };
        for (let i = 0; i < 10; i++) sv.zombies.push(mk(i, 6 + (i % 5)));
        for (let i = 0; i < 35; i++) sv.zombies.push(mk(100 + i, 15 + (i % 15)));
        // 掉落 60（散布）特效 30 植物 80
        for (let i = 0; i < 60; i++) { const ang = i * 2.399963; sv.drops.push({ x: sv.px + Math.cos(ang) * (5 + (i % 20)) * TS, y: sv.py + Math.sin(ang) * (5 + (i % 20)) * TS, id: 'wood', n: 1 }); }
        for (let i = 0; i < 30; i++) sv.effects.push({ kind: i % 2 ? 'hit' : 'muzzle', x: sv.px + (i % 6 - 3) * TS, y: sv.py + (Math.floor(i / 6) - 2) * TS, life: 3, maxLife: 3, label: '砰' });
        for (let i = 0; i < 80; i++) { const ang = i * 2.399963; const gx = Math.round(sv.px / TS + Math.cos(ang) * (6 + (i % 15))), gy = Math.round(sv.py / TS + Math.sin(ang) * (6 + (i % 15))); sv.mods.plants[gx + ',' + gy] = { hp: 80, maxHp: 80, species: 'sunflower', growth: 0.6, type: 'player', atkT: 0, hostile: false, sunT: 0 }; }
        sv._zombiePathNeedsRebuild = true;
        return '僵尸=' + sv.zombies.length + ' 掉落=' + sv.drops.length + ' 特效=' + sv.effects.length + ' 植物=' + Object.keys(sv.mods.plants).length;
    })()`);
    console.log('注入(近10远35):', inject);
    await sleep(800);

    // 段1：纯模拟+渲染（无 wsync）
    console.log('[1] 纯模拟+渲染 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    // 段2：+100ms wsync 全链路（getMpSnapshot + stringify + 模拟发送）
    const setup = await c.eval(`(() => {
        const surv = window.__surv;
        const sv = surv.debugGetSv();
        if (window.__wsyncT) clearInterval(window.__wsyncT);
        let stat = { n: 0, ms: 0, bytes: 0 };
        window.__wsyncT = setInterval(() => {
            const t0 = performance.now();
            const snap = surv.getMpSnapshot(true);
            const json = JSON.stringify(snap);
            stat.n++; stat.ms += performance.now() - t0; stat.bytes = json.length;
        }, 100);
        window.__wsyncStat = () => JSON.stringify(stat);
        return 'wsync 模拟启动';
    })()`);
    console.log(setup);
    await sleep(1200);
    console.log('[2] +wsync全链路 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));
    console.log('    wsync 统计(每拍):', await c.eval('window.__wsyncStat()'));

    // 段3：停掉流场重建（把 _zombiePathNeedsRebuild 失效 + 不移动 → 复用旧场）——直接测"渲染+序列化"无流场
    await c.eval(`(() => { window.__surv.debugGetSv()._zombiePathRebuildCd = 999; })()`);   // 冻结流场重建
    await sleep(600);
    console.log('[3] 冻结流场 FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));
    await c.eval(`(() => { window.__surv.debugGetSv()._zombiePathRebuildCd = 0; })()`);

    // 段4：移动中（流场随换格重建触发）
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(300);
    console.log('[4] 移动中+wsync FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); })()`);

    const exceptions = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exceptions.length ? exceptions.map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).join(' | ').slice(0, 300) : '无');
    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
