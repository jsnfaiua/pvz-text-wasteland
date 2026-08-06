// _cdp-grass-seasons2.mjs — 四季完整草地（季节背景 + 混合草）验证
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
            const cv = document.getElementById('g' + k);
            if (!cv) { out[k] = 'MISSING'; continue; }
            const d = cv.getContext('2d').getImageData(0, 0, 216, 144).data;
            let cnt = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] > 5 || d[i+1] > 5) cnt++;
            out[k] = (cnt / (216*144)).toFixed(2);
        }
        return JSON.stringify(out);
    })()` });
    console.log('4 季渲染:', chk.result && chk.result.value);
    await send('Runtime.evaluate', { expression: `document.getElementById('animToggle').click(); true` });
    await new Promise(r => setTimeout(r, 3000));
    const fps = await send('Runtime.evaluate', { expression: `document.getElementById('fps').textContent` });
    console.log('FPS:', fps.result && fps.result.value);
    // 采样每季底色（左上角 4×4 子块中心，验证季节背景色偏移）
    const colors = await send('Runtime.evaluate', { expression: `(() => {
        const out = {};
        for (const k of ['spring','summer','autumn','winter']) {
            const d = document.getElementById('g' + k).getContext('2d').getImageData(18, 18, 1, 1).data;
            out[k] = [d[0], d[1], d[2]];
        }
        return JSON.stringify(out);
    })()` });
    console.log('各季地面底色:', colors.result && colors.result.value);
    const big = await send('Runtime.evaluate', { expression: `(() => {
        const cv = document.createElement('canvas'); cv.width = 216*4; cv.height = 144;
        const c = cv.getContext('2d');
        for (const [i,k] of ['spring','summer','autumn','winter'].entries()) c.drawImage(document.getElementById('g'+k), i*216, 0);
        return cv.toDataURL('image/png').slice(22);
    })()` });
    if (big.result && big.result.value) fs.writeFileSync('dev-tools/_cdp-grass-seasons2.png', Buffer.from(big.result.value, 'base64'));
    console.log('已导出四季完整图');
    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
