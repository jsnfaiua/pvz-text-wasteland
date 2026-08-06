// _cdp-grass-2rows.mjs — 两行四季（A1 四季 + A3 双色四季备用）验证
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
    await new Promise(r => setTimeout(r, 2400));
    const chk = await send('Runtime.evaluate', { expression: `(() => {
        const out = {};
        for (const k of ['spring','summer','autumn','winter']) {
            for (const row of ['', '2']) {
                const cv = document.getElementById('g' + row + k);
                if (!cv) { out[row + k] = 'MISSING'; continue; }
                const d = cv.getContext('2d').getImageData(0, 0, 216, 144).data;
                let cnt = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] > 5 || d[i+1] > 5) cnt++;
                out[row + k] = (cnt / (216*144)).toFixed(2);
            }
        }
        return JSON.stringify(out);
    })()` });
    console.log('两行渲染:', chk.result && chk.result.value);
    await send('Runtime.evaluate', { expression: `document.getElementById('animToggle').click(); true` });
    await new Promise(r => setTimeout(r, 3000));
    const fps = await send('Runtime.evaluate', { expression: `document.getElementById('fps').textContent` });
    console.log('FPS:', fps.result && fps.result.value);
    const big = await send('Runtime.evaluate', { expression: `(() => {
        const cv = document.createElement('canvas'); cv.width = 216*4; cv.height = 288;
        const c = cv.getContext('2d');
        for (const [i,k] of ['spring','summer','autumn','winter'].entries()) c.drawImage(document.getElementById('g'+k), i*216, 0);
        for (const [i,k] of ['spring','summer','autumn','winter'].entries()) c.drawImage(document.getElementById('g2'+k), i*216, 144);
        return cv.toDataURL('image/png').slice(22);
    })()` });
    if (big.result && big.result.value) fs.writeFileSync('dev-tools/_cdp-grass-2rows.png', Buffer.from(big.result.value, 'base64'));
    console.log('已导出两行对比图');
    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
