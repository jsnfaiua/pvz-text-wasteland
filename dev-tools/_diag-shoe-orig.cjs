// 诊断：对比 原图 vs tint后 的侧视/正面 sprite 鞋底区域
const fs = require('node:fs');
(async () => {
    const res = await fetch('http://127.0.0.1:9222/json');
    const tabs = await res.json();
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const WebSocket = require('ws');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
    };
    function send(method, params = {}) {
        const i = ++id;
        return new Promise((res, rej) => { pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    }
    async function evalJs(expression, awaitPromise = false) {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text };
        return r.result && r.result.value;
    }
    const expr = `(async () => {
        const files = ['sprite-side.png', 'sprite-front.png', 'walk-side-f0.png'];
        const look = { skin: '#e0c098', hair: '#1a1a1a', shirt: '#39d98a', pants: '#4a90d9', shoes: '#8a5a2b', eyes: '#2c2c2c' };
        const m = await import('./source-code/mod-wasteland/render.js?r=' + Date.now());
        if (m._tintCache) m._tintCache.clear();
        const results = [];
        for (const f of files) {
            const img = new Image();
            img.src = 'source-code/mod-wasteland/sprites/' + f + '?v=' + Date.now();
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
            // 原图鞋底颜色
            const oc = document.createElement('canvas');
            oc.width = img.width; oc.height = img.height;
            const ox = oc.getContext('2d');
            ox.drawImage(img, 0, 0);
            const oid = ox.getImageData(0, 0, img.width, img.height);
            const od = oid.data;
            // bbox
            let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
            for (let y=0;y<img.height;y++) for (let x=0;x<img.width;x++) {
                const i=(y*img.width+x)*4;
                if (od[i+3]>10){if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;}
            }
            const origShoe = {};
            const shoeTop = mny + Math.floor((mxy-mny)*0.88);
            for (let y=shoeTop;y<=mxy;y++) for (let x=mnx;x<=mxx;x++) {
                const i=(y*img.width+x)*4;
                if (od[i+3]<10) continue;
                const k=[od[i],od[i+1],od[i+2]].join(',');
                origShoe[k]=(origShoe[k]||0)+1;
            }
            // tint 后
            const tinted = m.tintSprite(img, look);
            const c = document.createElement('canvas');
            c.width = tinted.width; c.height = tinted.height;
            const cx = c.getContext('2d');
            cx.drawImage(tinted, 0, 0);
            const tid = cx.getImageData(0, 0, c.width, c.height);
            const td = tid.data;
            const tintShoe = {};
            for (let y=shoeTop;y<=mxy;y++) for (let x=mnx;x<=mxx;x++) {
                const i=(y*c.width+x)*4;
                if (td[i+3]<10) continue;
                const k=[td[i],td[i+1],td[i+2]].join(',');
                tintShoe[k]=(tintShoe[k]||0)+1;
            }
            results.push({
                name: f,
                bboxY: [mny, mxy],
                orig: Object.entries(origShoe).sort((a,b)=>b[1]-a[1]).slice(0,6),
                tint: Object.entries(tintShoe).sort((a,b)=>b[1]-a[1]).slice(0,6)
            });
        }
        return results;
    })()`;
    const r = await evalJs(expr, true);
    if (r.err) { console.log('ERR:', r.err); process.exit(1); }
    for (const row of r) {
        console.log(`\n=== ${row.name} (bbox y=[${row.bboxY[0]},${row.bboxY[1]}]) ===`);
        console.log('  原图鞋底:', JSON.stringify(row.orig));
        console.log('  tint后  :', JSON.stringify(row.tint));
    }
    process.exit(0);
})();