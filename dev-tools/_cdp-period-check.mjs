// _cdp-period-check.mjs — 检测草地基底是否还有 7.11 格（256px 瓦片）周期线条
// 原理：画布内取大片草地，按 36px 相位累计亮度差。若存在瓦片周期（256px≈7.11格），
// 亮度自相关会在 256px 位移处出现峰值；函数化噪声无任何周期 → 无峰值。
const CDP = 'http://127.0.0.1:9222';
import { writeFileSync } from 'fs';

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
    await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Page.navigate', { url: 'http://localhost:8000/index.html' });
    await new Promise(r => setTimeout(r, 3000));

    const save = JSON.stringify({ v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0, inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} }, character: { skin: '#f0c8a0' } });
    await send('Runtime.evaluate', { expression: `localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(save)}); true` });
    const ent = await send('Runtime.evaluate', { expression: `(async () => {
        try {
            const st = await import('./source-code/core/state.js');
            st.setSaveData({ ...st.saveData, devMode: true });
            const m = await import('./source-code/mod-wasteland/survival.js');
            window.__surv = m;
            m.enterWasteland({});
            return 'entered';
        } catch (e) { return 'ERR: ' + e.message; }
    })()`, awaitPromise: true });
    console.log('enter:', ent.result && ent.result.value);
    await new Promise(r => setTimeout(r, 3500));

    // 找大片草地（6×6 纯草地）传送过去（小数位置=真实移动状态）
    const spot = await send('Runtime.evaluate', { expression: `(async () => {
        const sv = window.__surv.debugGetSv();
        const wm = await import('./source-code/mod-wasteland/world.js');
        const G = wm.T.GROUND;
        for (let y = 5; y < 90; y += 2) for (let x = 5; x < 90; x += 2) {
            let grass = 0;
            for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) if (wm.getTile(sv, x + dx, y + dy) === G) grass++;
            if (grass >= 34) return JSON.stringify({ px: (x + 3) * 36 + 0.37, py: (y + 3) * 36 + 0.71 });
        }
        return JSON.stringify({ none: true });
    })()`, awaitPromise: true, returnByValue: true });
    console.log('草地:', spot.result && spot.result.value);
    const sp = JSON.parse(spot.result.value);
    if (sp.none) { console.log('未找到草地'); process.exit(1); }

    await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); sv.px = ${sp.px}; sv.py = ${sp.py}; return true; })()` });
    await new Promise(r => setTimeout(r, 1500));

    // 核心检测：亮度自相关 + 模 256px 相位累计
    const r = await send('Runtime.evaluate', { expression: `(() => {
        const sv = window.__surv.debugGetSv();
        const c = sv.ctx;
        const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
        const W = c.canvas.width, H = c.canvas.height;
        // 亮度数组（降采样每 2px 一行，避免过采样）
        const lum = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            lum[y * W + x] = (img[i] + img[i+1] + img[i+2]) / 3;
        }
        // 只统计"草地色"区域（绿为主），排除路面/建筑/草叶暗点噪声干扰：亮度 30~90 且 G 通道占优
        const valid = new Uint8Array(W * H);
        let vCount = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (img[i+1] > img[i] && img[i+1] > img[i+2] && lum[y*W+x] > 25 && lum[y*W+x] < 110) { valid[y*W+x] = 1; vCount++; }
        }
        // 1) 模 256px 相位累计（瓦片周期检测）：对每行，按 x%256 累加亮度，看是否 256 对齐有偏差
        //    无周期时：任意 8px 相位段的平均亮度差 ≈ 0（噪声随机）
        //    有周期时：256px 重复 → x%256 的固定相位亮度偏高/偏低
        const phaseAcc = new Float32Array(256);
        const phaseCnt = new Uint32Array(256);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (!valid[y*W+x]) continue;
            const ph = x % 256;
            phaseAcc[ph] += lum[y*W+x]; phaseCnt[ph]++;
        }
        // 相位段统计：分 32 段（每 8px），段间亮度差 = 周期强弱
        const segs = [];
        for (let s = 0; s < 32; s++) {
            let sum = 0, n = 0;
            for (let p = s * 8; p < s * 8 + 8; p++) if (phaseCnt[p]) { sum += phaseAcc[p] / phaseCnt[p]; n++; }
            segs.push(n ? sum / n : 0);
        }
        let segMax = 0, segMin = 1e9;
        for (const s of segs) { if (s > segMax) segMax = s; if (s < segMin) segMin = s; }
        const phaseRange = segMax - segMin;

        // 2) 相邻格 36px 边界检测（对照基准）
        let seamSum = 0, baseSum = 0, n = 0;
        for (let gx = 2; gx < Math.floor(W / 36) - 2; gx++) {
            const bx = gx * 36;
            for (let y = 40; y < H - 40; y += 8) {
                const probe = ((y * W) + bx + 18) * 4;
                if (!(img[probe+1] > img[probe] && img[probe+1] > 40)) continue;
                const iL = ((y * W) + bx - 1) * 4, iR = ((y * W) + bx) * 4;
                seamSum += Math.abs(img[iL]-img[iR]) + Math.abs(img[iL+1]-img[iR+1]) + Math.abs(img[iL+2]-img[iR+2]);
                const bx2 = bx - 8;
                const iL2 = ((y * W) + bx2 - 1) * 4, iR2 = ((y * W) + bx2) * 4;
                baseSum += Math.abs(img[iL2]-img[iR2]) + Math.abs(img[iL2+1]-img[iR2+1]) + Math.abs(img[iL2+2]-img[iR2+2]);
                n++;
            }
        }
        return JSON.stringify({
            vCount,
            phaseRange: phaseRange.toFixed(2),
            segs: segs.map(s => s.toFixed(1)).join(','),
            seamRatio: n ? (seamSum / baseSum).toFixed(2) : '0',
            n
        });
    })()`, returnByValue: true });
    console.log('周期检测:', r.result && r.result.value);

    // 截图
    const img = await send('Runtime.evaluate', { expression: `(() => { const sv = window.__surv.debugGetSv(); return sv.ctx.canvas.toDataURL('image/png').slice(22); })()` });
    if (img.result && img.result.value) { writeFileSync('dev-tools/_cdp-period-check.png', Buffer.from(img.result.value, 'base64')); console.log('截图已存'); }

    const exc = evts.filter(e => e.method === 'Runtime.exceptionThrown');
    console.log('异常:', exc.length);
    if (exc.length) for (const e of exc) console.log('EXC:', (e.params.exceptionDetails && e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || '').slice(0, 200));
    process.exit(0);
})();
