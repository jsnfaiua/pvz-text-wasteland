// ============================================================
// CDP 深度诊断：逐步进入游戏，检查 sv 状态、屏幕切换、画布内容
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

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    await c.send('Log.enable');
    await c.send('Console.enable');

    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(7000);
    c.clearEvents();

    // 注入最小存档
    const save = { v: 3, seed: 20260802, day: 1, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632' } };
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);

    // 步骤 1：检查初始 title 屏
    let info = await c.eval(`(() => {
        const screens = [...document.querySelectorAll('[id^="screen-"], [class*="screen"]')].map(s => ({id:s.id, cls:s.className, vis: getComputedStyle(s).display !== 'none' && getComputedStyle(s).visibility !== 'hidden'}));
        return { titleVisible: document.body.innerText.includes('点击任意键'), screens };
    })()`);
    console.log('\n【步骤1】初始 state:', JSON.stringify(info, null, 2));

    // 步骤 2：直接调用 enterWasteland
    const r = await c.eval(`(async()=>{ try { const m = await import('./source-code/mod-wasteland/survival.js'); m.enterWasteland({}); return 'ok'; } catch(e){ return 'THROW: '+e.message+' | '+(e.stack||''); } })()`, true);
    console.log('\n【步骤2】enterWasteland:', r);

    // 步骤 3：等 1 秒后查
    await sleep(1000);
    info = await c.eval(`(() => {
        const screens = [...document.querySelectorAll('[id^="screen-"], [class*="screen"]')].map(s => ({id:s.id, cls:s.className, vis: getComputedStyle(s).display !== 'none' && getComputedStyle(s).visibility !== 'hidden'}));
        return { titleVisible: document.body.innerText.includes('点击任意键'), screens, gameCanvas: !!document.getElementById('game'), bodyText: document.body.innerText.slice(0, 200) };
    })()`);
    console.log('\n【步骤3】+1s 后:', JSON.stringify(info, null, 2));

    // 步骤 4：再等 3 秒
    await sleep(3000);
    info = await c.eval(`(() => {
        const screens = [...document.querySelectorAll('[id^="screen-"], [class*="screen"]')].map(s => ({id:s.id, cls:s.className, vis: getComputedStyle(s).display !== 'none' && getComputedStyle(s).visibility !== 'hidden'}));
        return { titleVisible: document.body.innerText.includes('点击任意键'), screens, bodyText: document.body.innerText.slice(0, 200) };
    })()`);
    console.log('\n【步骤4】+4s 后:', JSON.stringify(info, null, 2));

    // 步骤 5：检查画布是否在画
    const canvasInfo = await c.eval(`(() => {
        const c = document.getElementById('game');
        if (!c) return 'no game canvas';
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let nonBlack = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i+1] + d[i+2] > 30) nonBlack++; }
        return { w: c.width, h: c.height, nonBlackPixels: nonBlack, total: d.length/4, ratio: (nonBlack/(d.length/4)).toFixed(4) };
    })()`);
    console.log('\n【步骤5】game 画布内容:', JSON.stringify(canvasInfo, null, 2));

    // 错误汇总
    console.log('\n=== 异常:', c.eventsOf('Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text).join('\n') || '(无)');
    console.log('=== console.error:', c.eventsOf('Runtime.consoleAPICalled').filter(e=>e.params.type==='error').map(e=>e.params.args.map(a=>a.value||a.description).join(' ')).join('\n') || '(无)');

    // 截图
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    if (shot.data) { fs.writeFileSync('dev-tools/_cdp-diagnose.png', Buffer.from(shot.data, 'base64')); console.log('\n截图: dev-tools/_cdp-diagnose.png'); }

    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
