// _cdp-grass-styles.mjs — 4 种草样式验证
import fs from 'node:fs';
const CDP = 'http://127.0.0.1:9222';
async function getJson(url) { return (await fetch(url + '/json')).json(); }
async function main() {
    const tabs = await getJson(CDP);
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map(); const evts = [];
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m);
    };
    const send = (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
    await send('Runtime.enable');
    await send('Page.reload', { ignoreCache: true });
    await new Promise(r => setTimeout(r, 2200));
    const chk = await send('Runtime.evaluate', { expression: `(() => {
        const out = {};
        for (const k of ['A','B','C','D']) {
            const cv = document.getElementById('g' + k);
            const d = cv.getContext('2d').getImageData(0, 0, 216, 144).data;
            let cnt = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] > 5 || d[i+1] > 5) cnt++;
            out[k] = { filled: (cnt / (216*144)).toFixed(2) };
        }
        return JSON.stringify(out);
    })()` });
    console.log('4 列画布:', chk.result && chk.result.value);
    await send('Runtime.evaluate', { expression: `document.getElementById('animToggle').click(); true` });
    await new Promise(r => setTimeout(r, 3000));
    const fps = await send('Runtime.evaluate', { expression: `document.getElementById('fps').textContent` });
    console.log('FPS:', fps.result && fps.result.value);
    const r1 = await send('Runtime.evaluate', { expression: `document.getElementById('gA').toDataURL('image/png').slice(22)` });
    await new Promise(r => setTimeout(r, 250));
    const r2 = await send('Runtime.evaluate', { expression: `document.getElementById('gA').toDataURL('image/png').slice(22)` });
    console.log('A 列动画在动:', r1.result && r2.result && r1.result.value !== r2.result.value);
    const big = await send('Runtime.evaluate', { expression: `(() => {
        const cv = document.createElement('canvas'); cv.width = 216*4; cv.height = 144;
        const c = cv.getContext('2d');
        for (const [i,k] of ['A','B','C','D'].entries()) c.drawImage(document.getElementById('g'+k), i*216, 0);
        return cv.toDataURL('image/png').slice(22);
    })()` });
    if (big.result && big.result.value) fs.writeFileSync('dev-tools/_cdp-grass-4styles.png', Buffer.from(big.result.value, 'base64'));
    console.log('已导出 4 列对比图');
    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
