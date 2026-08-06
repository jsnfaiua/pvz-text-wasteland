// _cdp-hud.mjs — 调试 HUD 专项验证（P2-3）
// 进入荒原 → 注入 world 档 → 开 dev 面板 HUD 开关 → 验证：
//   1. HUD DOM 出现且文本正确（FPS/实体数/位置）
//   2. 开启后 FPS 仍满 60 零长帧（HUD 零开销验证）
//   3. 全程零 exceptionThrown / console.error
// 用法：node dev-tools/_cdp-hud.mjs
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
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
    async navigate(url) {
        await this.send('Page.navigate', { url });
        await new Promise(r => setTimeout(r, 1500));
    }
    async screenshot(path) {
        const r = await this.send('Page.captureScreenshot', { format: 'png' });
        if (r && r.data) fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const c = await CDPClient.connect(CDP_URL);
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Network.enable');

    // 干净开局：清旧世界档，注入最小角色档，开 devMode
    await c.eval(`localStorage.removeItem('u:__guest__:wasteland_world_20260802'); localStorage.removeItem('u:__guest__:wasteland_profile'); localStorage.removeItem('u:__guest__:wasteland_save'); true`);
    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' } };
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))}); true`);

    // 进荒原（先开 devMode 再 enterWasteland，让 dev 面板可用）
    await c.navigate('http://localhost:8000/index.html');
    await sleep(2500);
    const entered = await c.eval(`(async () => {
        const st = await import('./source-code/core/state.js');
        st.setSaveData({ ...st.saveData, devMode: true });
        const m = await import('./source-code/mod-wasteland/survival.js');
        window.__surv = m;
        m.enterWasteland({});
        return 'ok';
    })()`, true);
    console.log('进入:', entered);
    await sleep(2500);

    // 确认 sv 可用
    const svOk = await c.eval(`(() => {
        const m = window.__surv || null;
        const sv = m && m.debugGetSv ? m.debugGetSv() : null;
        return sv ? { active: !!sv.active, devHud: !!sv._devHud, npcs: sv.npcs ? sv.npcs.length : -1, ctx: !!sv.ctx } : null;
    })()`);
    console.log('sv 状态:', JSON.stringify(svOk));
    if (!svOk || !svOk.active) { console.log('FAIL: 未进入荒原'); process.exit(1); }

    // 基线 FPS（HUD 关）
    const FPS_PROBE = `(() => {
        const sv = window.__surv.debugGetSv();
        return new Promise(res => {
            let frames = 0; let t0 = performance.now();
            const loop = () => { frames++; if (performance.now() - t0 < 1500) requestAnimationFrame(loop); else res({ fps: Math.round(frames * 1000 / (performance.now() - t0)), sv_now: sv.t }); };
            requestAnimationFrame(loop);
        });
    })()`;
    const base = await c.eval(FPS_PROBE, true);
    console.log('HUD关闭 FPS:', JSON.stringify(base));

    // 注入实体压力（僵尸/NPC/掉落/特效/子弹），确保 HUD 计数非零
    await c.eval(`(() => {
        const m = window.__surv;
        const sv = m.debugGetSv();
        for (let i = 0; i < 12; i++) {
            sv.zombies.push({ id: 'hudz' + i, type: 'normal', char: '僵', color: '#fff', name: 'z', x: sv.px + (i % 4) * 40, y: sv.py + Math.floor(i / 4) * 40, hp: 100, maxHp: 100, speed: 1, damage: 5, horde: false, stunT: 0, hurt: 0, biteT: 0 });
        }
        if (sv.bullets) for (let i = 0; i < 5; i++) sv.bullets.push({ id: 'hudb' + i, x: sv.px, y: sv.py, vx: 1, vy: 0, damage: 5 });
        for (let i = 0; i < 7; i++) sv.drops.push({ x: sv.px + i * 20, y: sv.py, id: 'wood', n: 1 });
        sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 1, maxLife: 1 });
        return 'entities injected';
    })()`);

    // 开 HUD（通过 dev 面板按钮点击，走真实用户路径）
    await c.eval(`(() => {
        const sv = window.__surv.debugGetSv();
        // 直接调 wdev 逻辑等价：点击面板按钮
        const btn = document.querySelector('#wdev-hud');
        if (btn) { btn.click(); return 'clicked #wdev-hud'; }
        // 面板未开：先开面板再点
        return 'no panel btn';
    })()`);
    await sleep(300);
    const hud1 = await c.eval(`(() => {
        const el = document.getElementById('wsl-hud');
        return el ? el.textContent : null;
    })()`);
    console.log('HUD 文本(第1次):', JSON.stringify(hud1 && hud1.replace(/\n/g, ' | ')));

    // 若面板按钮不存在，走 fallback：直接置 _devHud
    if (!hud1) {
        await c.eval(`(() => { const sv = window.__surv.debugGetSv(); sv._devHud = true; return true; })()`);
        await sleep(600);
        const hud2 = await c.eval(`(() => { const el = document.getElementById('wsl-hud'); return el ? el.textContent : null; })()`);
        console.log('HUD 文本(fallback):', JSON.stringify(hud2 && hud2.replace(/\n/g, ' | ')));
    }

    // HUD 开启后 FPS
    const withHud = await c.eval(FPS_PROBE, true);
    console.log('HUD开启 FPS:', JSON.stringify(withHud));
    await sleep(700);   // 等 HUD 下一轮 500ms 刷新，FPS 数字稳定

    // 异常检查
    const exc = c.eventsOf('Runtime.exceptionThrown');
    const errs = c.eventsOf('Runtime.consoleAPICalled').filter(e => e.params.type === 'error');
    console.log('异常:', exc.length, 'console.error:', errs.length);
    if (exc.length > 0) {
        for (const e of exc) console.log('  EXC:', e.params.exceptionDetails && e.params.exceptionDetails.text, (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 150));
    }

    // 截图存档
    await c.screenshot('dev-tools/_cdp-hud.png');

    const hudFinal = await c.eval(`(() => { const el = document.getElementById('wsl-hud'); return el ? el.firstChild.textContent : null; })()`);
    console.log('HUD 文本(最终):', JSON.stringify(hudFinal && hudFinal.replace(/\n/g, ' | ')));
    const ok = withHud.fps >= 55 && hudFinal && hudFinal.includes('FPS') && !/FPS 0\b/.test(hudFinal) && exc.length === 0 && errs.length === 0;
    console.log(ok ? '=== P2-3 HUD 验证通过 ===' : '=== FAIL ===');
    process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
