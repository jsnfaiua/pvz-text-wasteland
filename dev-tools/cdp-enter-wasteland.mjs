// ============================================================
// CDP 浏览器复现脚本：真实浏览器进入荒原模式，抓取 console 错误/异常
// 用法：
//   1. 先启动 Chrome：chrome --headless=new --remote-debugging-port=9222 --user-data-dir=... about:blank
//   2. node dev-tools/cdp-enter-wasteland.mjs
// ============================================================
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';

async function getJson(path) {
    const r = await fetch(CDP_URL + path);
    return r.json();
}

class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
    static async connect(url) {
        const ws = new WebSocket(url);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const c = new CDPClient(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id) {
                const p = c.pending.get(msg.id);
                if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
            } else {
                c.events.push(msg);
            }
        };
        return c;
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    eventsOf(method) { return this.events.filter(e => e.method === method); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    // 找可用 tab
    let tabs = await getJson('/json');
    if (!tabs.length) { console.error('无可用 tab'); process.exit(1); }
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const client = await CDPClient.connect(tab.webSocketDebuggerUrl);
    console.log('已连接 CDP:', tab.url);

    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Log.enable');
    await client.send('Console.enable');

    // 导航到游戏页
    await client.send('Page.navigate', { url: PAGE_URL });
    await sleep(6000);   // 等页面加载

    // 先注入最小存档（v3 seed 存档），跳过捏脸直接进游戏
    const seed = 20260802;
    const saveObj = {
        v: 3, seed,
        day: 1, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632' },
    };
    const r1 = await client.send('Runtime.evaluate', {
        expression: `localStorage.setItem('wasteland_save', ${JSON.stringify(JSON.stringify(saveObj))}); '存档已注入'`,
        returnByValue: true,
    });
    console.log('注入存档:', r1.result && r1.result.value);

    // 动态 import 并进入荒原（读档路径，跳过捏脸）
    const r2 = await client.send('Runtime.evaluate', {
        expression: `(async () => { try { const m = await import('./source-code/mod-wasteland/survival.js'); m.enterWasteland({}); return 'enterWasteland 调用完成'; } catch (e) { return '调用异常: ' + (e && e.stack ? e.stack : e); } })()`,
        awaitPromise: true,
        returnByValue: true,
    });
    console.log('enterWasteland:', r2.result && r2.result.value);

    // 等游戏循环跑几帧（让 update/draw 执行，暴露僵尸寻路等运行时错误）
    await sleep(5000);

    // 收集异常与错误日志
    const exceptions = client.eventsOf('Runtime.exceptionThrown');
    const consoleErrs = client.eventsOf('Runtime.consoleAPICalled').filter(e =>
        e.params.type === 'error' || e.params.type === 'assert');
    const logErrs = client.eventsOf('Log.entryAdded').filter(e => e.params.entry.level === 'error');

    console.log('\n=== 异常 (Runtime.exceptionThrown) ===');
    for (const e of exceptions) {
        const d = e.params.exceptionDetails;
        console.log('-', d.text, d.exception ? d.exception.description : '');
    }
    if (!exceptions.length) console.log('（无）');

    console.log('\n=== console.error/assert ===');
    for (const e of consoleErrs) {
        const args = e.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        console.log('-', args);
    }
    if (!consoleErrs.length) console.log('（无）');

    console.log('\n=== Log.error ===');
    for (const e of logErrs) console.log('-', e.params.entry.text);
    if (!logErrs.length) console.log('（无）');

    // 检查游戏状态
    const r3 = await client.send('Runtime.evaluate', {
        expression: `(() => {
            try {
                const el = document.getElementById('game');
                const screen = document.querySelector('#screen-games, #game-screen, .game-screen');
                return { canvas: !!el, canvasW: el ? el.width : -1, bodyText: document.body.innerText.slice(0, 120) };
            } catch (e) { return '状态检查异常: ' + e.message; }
        })()`,
        returnByValue: true,
    });
    console.log('\n=== 页面状态 ===');
    console.log(JSON.stringify(r3.result && r3.result.value, null, 2));

    // 截图
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    if (shot.data) {
        fs.writeFileSync('dev-tools/_cdp-game.png', Buffer.from(shot.data, 'base64'));
        console.log('\n截图已保存: dev-tools/_cdp-game.png');
    }
    process.exit(0);
}

main().catch(e => { console.error('脚本失败:', e); process.exit(1); });
