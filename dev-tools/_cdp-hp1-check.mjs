// CDP 快速检测：正常模式单只僵尸，hp 从 1 开始，4 秒内是否归零
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id) { const q = pending.get(m.id); if (q) { pending.delete(m.id); q(m.result); } } };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJS = async (expression, awaitPromise = false) => { const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }); return r.result && r.result.value; };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Page.reload', { ignoreCache: true });
    await sleep(5000);
    const save = { v: 3, seed: 20260814, day: 1, hp: 1, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' } };
    await evalJS(`localStorage.removeItem('u:__guest__:wasteland_world_20260814'); localStorage.removeItem('u:__guest__:wasteland_profile'); localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
    await evalJS(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__surv = m; m.enterWasteland({ difficulty: 'normal' }); return 'ok'; })()`, true);
    await sleep(2000);
    const r = await evalJS(`(async () => {
        const sv = window.__surv.debugGetSv();
        const z = { id: 'z1', type: 'normal', char: '僵', color: '#7fb39a', x: sv.px + 20, y: sv.py, name: '僵尸', hp: 5000, maxHp: 5000, speed: 0, wt: 0, tx: sv.px, ty: sv.py, wDir: null, biteT: 0, hurt: 0, stunT: 0, biteCd: 0, lungeCd: 0, lungeT: 0, plantBiteCd: 0, horde: false, auraT: 0, _biteSfxT: 0 };
        sv.zombies.push(z);
        sv.hp = 1; sv.isJumping = false; sv.guarding = false; sv.invuln = 0; sv._devGod = false; sv._combatT = 0;
        const out = [];
        const t0 = performance.now();
        return await new Promise(res => {
            let last = t0;
            const cb = () => {
                const now = performance.now();
                if (now - last >= 500) { last = now; out.push({ t: Math.round(now - t0), hp: sv.hp.toFixed(3), combat: sv._combatT, dead: !!sv.dead }); }
                if (now - t0 < 4000) requestAnimationFrame(cb); else res(out);
            };
            requestAnimationFrame(cb);
        });
    })()`, true);
    console.log('单僵尸 hp=1 起 4 秒:', JSON.stringify(r));
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
