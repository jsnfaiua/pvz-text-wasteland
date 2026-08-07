// _cdp-road-fix.mjs — 荒野路网修复验证（A：1圈衰减 / C：走廊限制 / 人行道过渡）
const CDP = 'http://127.0.0.1:9222';

(async () => {
    const tabs = await (await fetch(CDP + '/json')).json();
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0; const pend = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
    const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
    await send('Runtime.enable');

    const r = await send('Runtime.evaluate', { expression: `(async () => {
        const wm = await import('./source-code/mod-wasteland/world.js');
        const T = wm.T, CHUNK = wm.CHUNK, genChunkTiles = wm.genChunkTiles;
        const dist = await import('./source-code/mod-wasteland/wdistrict.js');
        const seeds = [20260802, 777, 12345, 999888];
        const out = {};
        for (const seed of seeds) {
            const cells = new Map();
            for (let cy = -16; cy <= 16; cy++) for (let cx = -16; cx <= 16; cx++) {
                const t = genChunkTiles(seed, cx, cy);
                for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
                    cells.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
            }
            let wildDeepRoad = 0, wildDeepSidewalk = 0, wildBoundaryWalk = 0, wildRoadTotal = 0, wildWalkTotal = 0;
            for (const [k, v] of cells) {
                if (v !== T.ROAD && v !== T.SIDEWALK && v !== T.CAR && v !== T.BARRICADE) continue;
                const [x, y] = k.split(',').map(Number);
                const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
                const d = dist.districtAt(seed, cx, cy);
                if (d !== 'wild') continue;
                let nearCity = false;
                for (let dy = -1; dy <= 1 && !nearCity; dy++) for (let dx = -1; dx <= 1 && !nearCity; dx++) {
                    const nd = dist.districtAt(seed, cx + dx, cy + dy);
                    if (nd !== 'wild') nearCity = true;
                }
                const isRoadV = v === T.ROAD || v === T.CAR || v === T.BARRICADE;
                const arterial = dist.arterialClassAt(seed, x, y);
                if (isRoadV) {
                    wildRoadTotal++;
                    if (!nearCity && arterial !== 'road') wildDeepRoad++;
                } else {
                    wildWalkTotal++;
                    if (nearCity) wildBoundaryWalk++;
                    else wildDeepSidewalk++;
                }
            }
            out[seed] = { wildRoadTotal, wildDeepRoad, wildDeepSidewalk, wildBoundaryWalk, wildWalkTotal };
        }
        return JSON.stringify(out);
    })()`, awaitPromise: true, returnByValue: true });
    console.log('路网统计（应：wildDeepRoad=0 / wildDeepSidewalk=0 / wildBoundaryWalk>0）:', r.result && r.result.value);
    process.exit(0);
})();
