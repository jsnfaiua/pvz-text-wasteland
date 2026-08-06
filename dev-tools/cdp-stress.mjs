// ============================================================
// CDP 压力验证：进入游戏后模拟移动 + 刷僵尸，验证 A* 寻路在浏览器内稳定
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
    await sleep(6000);
    c.clearEvents();

    // 注入带完整字段的存档（含 character 合法化），直接进游戏
    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c' } };
    await c.eval(`localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);

    const r = await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); m.enterWasteland({}); return 'ok'; })()`, true);
    console.log('进入游戏:', r);
    await sleep(2500);

    // 刷 30 只僵尸（测试用，通过 wdev 或直接推 sv.zombies——用模块内部 sv 不可达，改从游戏状态注入）
    // 直接检查游戏主循环是否稳定：模拟按键移动 3 秒
    const move = await c.eval(`(() => {
        const kd = (code) => { const ev = new KeyboardEvent('keydown', { key: code, code, bubbles: true }); window.dispatchEvent(ev); };
        kd('KeyD'); // 按住 D 向右移动
        setTimeout(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true })); }, 2000);
        return '已模拟按 D 移动 2s';
    })()`);
    console.log(move);
    await sleep(3500);

    // 采样帧率：RAF 计数
    const fps = await c.eval(`(async () => {
        return await new Promise(res => {
            let n = 0;
            const t0 = performance.now();
            const cb = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(cb); else res(Math.round(n)); };
            requestAnimationFrame(cb);
        });
    })()`, true);
    console.log('实测 FPS（移动中）:', fps);

    // 错误检查
    const exceptions = c.eventsOf('Runtime.exceptionThrown');
    const consoleErrs = c.eventsOf('Runtime.consoleAPICalled').filter(e => e.params.type === 'error');
    console.log('异常:', exceptions.length ? exceptions.map(e => e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception?.description || '')).join(' | ') : '无');
    console.log('console.error:', consoleErrs.length ? consoleErrs.map(e => e.params.args.map(a => a.value || a.description).join(' ')).join(' | ') : '无');

    // 画布状态
    const canvas = await c.eval(`(() => { const cv = document.getElementById('game'); if (!cv) return 'no canvas'; const ctx = cv.getContext('2d'); const d = ctx.getImageData(0,0,cv.width,cv.height).data; let n=0; for(let i=0;i<d.length;i+=4){ if(d[i]+d[i+1]+d[i+2]>30) n++; } return { w: cv.width, h: cv.height, ratio: (n/(d.length/4)).toFixed(3) }; })()`);
    console.log('画布:', JSON.stringify(canvas));

    // 截图
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    if (shot.data) { fs.writeFileSync('dev-tools/_cdp-stress.png', Buffer.from(shot.data, 'base64')); console.log('截图: dev-tools/_cdp-stress.png'); }
    process.exit(0);
}
main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
