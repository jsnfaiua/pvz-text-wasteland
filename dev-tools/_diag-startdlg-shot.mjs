// 最终 UI 截图验证：弹窗选世界（绑定 vs 未绑定）
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
    static async connect(url) {
        const ws = new WebSocket(url);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const c = new CDPClient(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id) { const p = c.pending.get(msg.id); if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
        };
        return c;
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
    }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text };
        return r.result && r.result.value;
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable'); await c.send('Page.enable');
    // 全新页面 + 清缓存
    await c.send('Network.enable');
    await c.send('Network.clearBrowserCache');
    await c.send('Page.navigate', { url: PAGE_URL });
    await sleep(3000);
    // 预置数据 + 打开弹窗 + 选中已绑定世界1001
    await c.eval(`(async () => {
        localStorage.clear();
        const st = await import('./source-code/persistence/storage.js?v=' + Date.now());
        st.setStorage('wasteland_world_1001', { seed: 1001, name: '已绑定世界', difficulty: 'normal', t: 10000, day: 3, playT: 300, mods: {}, npcs: null, px: 0, py: 0, characterName: '阿远' });
        st.setStorage('wasteland_character_阿远', { name: '阿远', character: { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c', hairStyle: 0 }, inv: [], hotbar: [], hp: 100, day: 3 });
        const mod = await import('./source-code/mod-wasteland/survival.js?v=' + Date.now());
        window.__sv = mod;
        mod.showGameStartDialog({ onLaunch: () => {} });
        await new Promise(res => setTimeout(res, 400));
        const el = document.getElementById('wsl-start');
        const ws = el.querySelector('#wsl-start-world');
        ws.value = '1001';
        ws.dispatchEvent(new Event('change'));
        await new Promise(res => setTimeout(res, 300));
        return { charText: el.querySelector('#wsl-start-char').textContent, okDisabled: el.querySelector('#wsl-start-ok').disabled, okText: el.querySelector('#wsl-start-ok').textContent };
    })()`, true);
    await sleep(500);
    const state = await c.eval(`(() => { const el = document.getElementById('wsl-start'); return { charText: el.querySelector('#wsl-start-char').textContent, okDisabled: el.querySelector('#wsl-start-ok').disabled, okText: el.querySelector('#wsl-start-ok').textContent, hint: el.querySelector('#wsl-start-hint').textContent, charNewDisabled: el.querySelector('#wsl-start-charnew').disabled }; })()`);
    // 截图
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('dev-tools/_diag-startdlg.png', Buffer.from(shot.data, 'base64'));
    console.log('=== 已绑定世界 1001 弹窗状态 ===');
    console.log(JSON.stringify(state, null, 2));
    console.log('截图: _diag-startdlg.png');
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
