// _cdp-seam-check.mjs — 无缝性定量检测（格边界 vs 基线差异比）
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
    await new Promise(r => setTimeout(r, 1800));
    const r = await send('Runtime.evaluate', { expression: `(() => {
        const nc = document.getElementById('cvNew').getContext('2d');
        // 逻辑 6 格区域（画布被 zoom 放大；按物理像素采样前，先把 zoom 换算：默认 3x → 取左上 216px 物理 = 逻辑 72px=2格）
        const img = nc.getImageData(0, 0, 648, 648);   // 取画布左上 648×648（覆盖前 6 格 × 6 行）
        // 从画布 (0,0) 采样，但画布内容是 3x 放大的——直接按物理坐标对比格边界物理列
        // 格边界在物理坐标 x = 36*3*k = 108k。检测 108k-1 与 108k 的差异 vs 基线
        let seamScore = 0, baseScore = 0, samples = 0;
        for (let k = 1; k < 8; k++) {   // 前 8 个格边界
            const bx = 108 * k;
            for (let y = 8; y < 1000; y += 12) {
                if (y >= 648) break;
                const iL = ((y * 648) + (bx - 1)) * 4, iR = ((y * 648) + bx) * 4;
                seamScore += Math.abs(img.data[iL] - img.data[iR]) + Math.abs(img.data[iL+1] - img.data[iR+1]) + Math.abs(img.data[iL+2] - img.data[iR+2]);
                const bx2 = bx - 24;
                const iL2 = ((y * 648) + (bx2 - 1)) * 4, iR2 = ((y * 648) + bx2) * 4;
                baseScore += Math.abs(img.data[iL2] - img.data[iR2]) + Math.abs(img.data[iL2+1] - img.data[iR2+1]) + Math.abs(img.data[iL2+2] - img.data[iR2+2]);
                samples++;
            }
        }
        return JSON.stringify({ seamAvg: (seamScore / samples).toFixed(2), baseAvg: (baseScore / samples).toFixed(2), ratio: (seamScore / baseScore).toFixed(2) });
    })()` });
    console.log('无缝检测:', r.result && r.result.value);
    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
