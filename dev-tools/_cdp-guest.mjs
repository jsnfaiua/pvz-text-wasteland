// ============================================================
// CDP guest 端实测：模拟「加入者」路径 —— 100ms wsync 快照
// （JSON.parse + applyMpSnapshot）+ 实体压力 + 渲染，对比单机路径 FPS
// 前置：node server.js + headless Chrome(:9222)；node dev-tools/_cdp-guest.mjs
// ============================================================
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';

async function getJson(path) { return (await fetch(CDP_URL + path)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
    static async connect(url) {
        const ws = new WebSocket(url);
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

    // 注入实体压力：45 僵尸 + 30 掉落 + 40 特效 + 60 植物 + 12 NPC
    const inject = await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        if (!sv) return 'no sv';
        const TS = 36;
        // 僵尸（绕玩家一圈，id 唯一）
        for (let i = 0; i < 45; i++) {
            const ang = (i / 45) * Math.PI * 2;
            sv.zombies.push({ id: 'z' + (sv._zIdSeq = (sv._zIdSeq || 0) + 1), type: 'normal', char: '僵', color: '#7fb39a', name: '僵尸',
                x: sv.px + Math.cos(ang) * (8 + (i % 5)) * TS, y: sv.py + Math.sin(ang) * (8 + (i % 5)) * TS,
                hp: 100, maxHp: 100, speed: 40, damage: 8, wt: 0, tx: sv.px, ty: sv.py, wDir: null, biteT: 0, hurt: 0, stunT: 0,
                biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0, horde: false, auraT: 0, infection: 0 });
        }
        // 掉落（玩家周围 6-14 格，防被拾取）
        for (let i = 0; i < 30; i++) {
            const ang = (i / 30) * Math.PI * 2;
            sv.drops.push({ x: sv.px + Math.cos(ang) * (6 + (i % 8)) * TS, y: sv.py + Math.sin(ang) * (6 + (i % 8)) * TS, id: i % 3 === 0 ? 'wood' : i % 3 === 1 ? 'food' : 'stone', n: 2 });
        }
        // 特效（长命 40 个）
        for (let i = 0; i < 40; i++) {
            sv.effects.push({ kind: i % 4 === 0 ? 'muzzle' : i % 4 === 1 ? 'hit' : 'dead', x: sv.px + (i % 8 - 4) * TS, y: sv.py + (Math.floor(i / 8) - 2) * TS, life: 2, maxLife: 2, label: '砰' });
        }
        // 植物（60 盆，绕玩家）
        for (let i = 0; i < 60; i++) {
            const ang = (i / 60) * Math.PI * 2;
            const gx = Math.round(sv.px / TS + Math.cos(ang) * (7 + (i % 6))), gy = Math.round(sv.py / TS + Math.sin(ang) * (7 + (i % 6)));
            sv.mods.plants[gx + ',' + gy] = { hp: 80, maxHp: 80, species: 'sunflower', growth: 0.6, type: 'player', atkT: 0, hostile: false, sunT: 0 };
        }
        // 队伍 NPC（本地管理，跟随玩家）
        if (!sv.npcs) sv.npcs = [];
        for (let i = 0; i < 12; i++) {
            const n = window.__surv.debugGetSv().npcs.find(n => n.id === 'player');
            sv.npcs.push({ id: 'n' + i, name: '队员' + i, role: 'friendly', x: sv.px + (i % 4 - 2) * TS, y: sv.py + (Math.floor(i / 4) - 1) * TS, hp: 80, maxHp: 80, food: 80, water: 80, dmg: 8, inv: [], coins: 0, attrs: { str: 10, con: 10, agi: 10, int: 10 }, alive: true, party: true, hired: false, state: 'follow', workLog: [], _mpRemote: false, look: null, followTarget: null, atkCd: 0, hurtT: 0, idleT: 0, wanderDir: null, swingT: 0, swingDir: 0, swingWeapon: null, bornDay: sv.day, campId: null, sick: null, act: { melee: 0, hit: 0, run: 0 }, talent: null, congenital: null, riding: false, campTask: null, workT: 0, _nextNeed: 4 });
        }
        sv._zombiePathNeedsRebuild = true;
        return '僵尸=' + sv.zombies.length + ' 掉落=' + sv.drops.length + ' 特效=' + sv.effects.length + ' 植物=' + Object.keys(sv.mods.plants).length + ' NPC=' + sv.npcs.length;
    })()`);
    console.log('实体压力注入:', inject);
    await sleep(800);

    // ── 阶段 A：单机路径（sv.mp = null）同实体量 FPS 基线 ──
    console.log('[A] 单机路径(同实体量) FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    // ── 阶段 B：guest 路径 —— 100ms wsync（JSON.parse + applyMpSnapshot）──
    const guestSetup = await c.eval(`(() => {
        const surv = window.__surv;
        const sv = surv.debugGetSv();
        // 预生成 host 视角快照 JSON（模拟 host 已序列化、经网络到达）
        window.__snapJson = JSON.stringify(surv.getMpSnapshot(true));
        sv.mp = { role: 'guest' };
        // 100ms 一拍：JSON.parse + applyMpSnapshot（模拟 PeerJS 消息回调）
        if (window.__guestTimer) clearInterval(window.__guestTimer);
        let count = 0, totalMs = 0;
        window.__guestTimer = setInterval(() => {
            const t0 = performance.now();
            const snap = JSON.parse(window.__snapJson);
            surv.applyMpSnapshot(snap, 'guest1');
            totalMs += performance.now() - t0;
            count++;
        }, 100);
        window.__guestStat = () => ({ count, avgMs: (totalMs / Math.max(1, count)).toFixed(2), totalMs: totalMs.toFixed(1) });
        return 'guest 模式启动，快照字节=' + window.__snapJson.length;
    })()`);
    console.log('guest 模拟:', guestSetup);
    await sleep(1200);   // 稳定几个快照周期
    console.log('[B] guest+100ms快照 FPS(站立):', JSON.stringify(await c.eval(FPS_PROBE, true)));
    console.log('    快照处理统计:', JSON.stringify(await c.eval('window.__guestStat()')));

    // 移动中 guest FPS
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })); })()`);
    await sleep(300);
    console.log('[B2] guest+快照 FPS(移动):', JSON.stringify(await c.eval(FPS_PROBE, true)));
    await c.eval(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); })()`);

    // 阶段 C：无快照但保留实体（对照：快照应用本身的开销）
    await c.eval(`(() => { clearInterval(window.__guestTimer); window.__guestTimer = null; window.__surv.debugGetSv().mp = null; })()`);
    await sleep(400);
    console.log('[C] 停快照后(实体压力仍在) FPS:', JSON.stringify(await c.eval(FPS_PROBE, true)));

    const exceptions = c.eventsOf('Runtime.exceptionThrown');
    console.log('异常:', exceptions.length ? exceptions.map(e => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).join(' | ').slice(0, 400) : '无');
    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
