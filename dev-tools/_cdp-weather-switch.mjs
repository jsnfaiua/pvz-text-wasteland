// _cdp-weather-switch.mjs — 切换天气瞬间参数残留验证
// rain 跑一阵 → 切 snow → 立即测雪点位移（60±6% → 100ms 移 ~6px；残留雨速 330 → ~33px）
import { writeFileSync } from 'fs';
const CDP = 'http://127.0.0.1:9222';

(async () => {
    const tabs = await (await fetch(CDP + '/json')).json();
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0; const pend = new Map(); const evts = [];
    ws.onmessage = e => { const m = JSON.parse(e.data);
        if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } else evts.push(m); };
    const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
    await send('Runtime.enable');

    // 复用当前页面 sv（_cdp-weather-v3 已进入游戏）；若无则提示
    const hasSv = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv && window.__surv.debugGetSv(); return sv && sv.active ? true : false; })()`, returnByValue: true });
    if (!hasSv.result || !hasSv.result.value) { console.log('未进入游戏，先跑 _cdp-weather-v3.mjs'); process.exit(1); }

    const r = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const B2 = await import('./source-code/mod-wasteland/wbalance.js');
        sv._devGfx = 2;
        sv.t = B2.DAY_LEN * 0.5;
        sv._weather = 'rain';
        await new Promise(r => setTimeout(r, 1500));   // 雨跑一阵，粒子池充满 rain kind（spd≈330）
        sv._weather = 'snow';                           // 切换天气
        await new Promise(r => setTimeout(r, 150));     // 立即测（修复后首帧已全重置 kind）
        const grab = () => {
            const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
            const W = sv.ctx.canvas.width;
            const pts = [];
            for (let i = 0; i < img.length; i += 4) {
                if (img[i] > 205 && img[i+1] > 210 && img[i+2] > 220) pts.push(Math.floor(i / 4));  // 雪白点
            }
            return { pts, W };
        };
        const a = grab();
        await new Promise(r => setTimeout(r, 100));
        const b = grab();
        // 最近邻匹配：帧B新白点找帧A最近白点 → 位移
        const setA = new Set(a.pts);
        const moves = [];
        for (const pb of b.pts) {
            if (setA.has(pb)) continue;
            let best = 999;
            for (const pa of a.pts) {
                const dx = (pb % a.W) - (pa % a.W), dy = Math.floor(pb / a.W) - Math.floor(pa / a.W);
                const d = dx * dx + dy * dy;
                if (d < best) best = d;
                if (best < 9) break;
            }
            if (best < 225) moves.push(Math.sqrt(best));
        }
        moves.sort((x, y) => x - y);
        const mid = moves.length ? moves[Math.floor(moves.length / 2)] : 0;
        const fast = moves.filter(m => m > 10).length;   // >10px = 残留雨速（雪应 ~6px）
        return JSON.stringify({ n1: a.pts.length, n2: b.pts.length, matched: moves.length, median: +mid.toFixed(1), fastOver10: fast, weather: sv._weather });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[切换验证] 雪点位移:', r.result && r.result.value, '(期望 median≈5~7px 且 fastOver10≈0)');

    // 再反向：snow → rain 立即测雨丝（330 → ~33px/100ms，残留雪速 60 → ~6px）
    const r2 = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        sv._weather = 'snow';
        await new Promise(r => setTimeout(r, 1200));
        sv._weather = 'rain';
        await new Promise(r => setTimeout(r, 150));
        const grab = () => {
            const img = sv.ctx.getImageData(0, 0, sv.ctx.canvas.width, sv.ctx.canvas.height).data;
            const W = sv.ctx.canvas.width;
            const pts = [];
            for (let i = 0; i < img.length; i += 4) {
                const R = img[i], G = img[i+1], B3 = img[i+2];
                if (B3 > 130 && B3 > R + 30 && G > 100 && G < 190 && R < 170 && B3 < 220) pts.push(Math.floor(i / 4));
            }
            return { pts, W };
        };
        const a = grab();
        await new Promise(r => setTimeout(r, 100));
        const b = grab();
        const setA = new Set(a.pts);
        const moves = [];
        for (const pb of b.pts) {
            if (setA.has(pb)) continue;
            let best = 999;
            for (const pa of a.pts) {
                const dx = (pb % a.W) - (pa % a.W), dy = Math.floor(pb / a.W) - Math.floor(pa / a.W);
                const d = dx * dx + dy * dy;
                if (d < best) best = d;
                if (best < 200) break;
            }
            if (best < 2600) moves.push(Math.sqrt(best));
        }
        moves.sort((x, y) => x - y);
        const mid = moves.length ? moves[Math.floor(moves.length / 2)] : 0;
        const slow = moves.filter(m => m < 15).length;   // <15px = 残留雪速（雨应 ~33px）
        return JSON.stringify({ matched: moves.length, median: +mid.toFixed(1), slowUnder15: slow, weather: sv._weather });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('[反向切换] 雨丝位移:', r2.result && r2.result.value, '(期望 median≈30~36px 且 slowUnder15≈0)');

    const exc = evts.filter(m => m.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    process.exit(0);
})();
