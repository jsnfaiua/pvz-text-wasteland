const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const fs = await import('fs');
const b64s = {};
for (const f of ['f0','f1']) b64s[f] = fs.readFileSync('source-code/mod-wasteland/sprites/walk-side-' + f + '.png').toString('base64');
const B64JSON = JSON.stringify(b64s);
const expr = `(async () => {
    try {
        const B64 = ${B64JSON};
        const out = {};
        for (const k in B64) {
            const img = new Image();
            await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img error')); img.src = 'data:image/png;base64,' + B64[k]; });
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const cc = c.getContext('2d');
            cc.drawImage(img, 0, 0);
            const d = cc.getImageData(0, 0, c.width, c.height).data;
            const W = c.width, H = c.height;
            let mnx=1e9,mny=1e9,mxx=-1,mxy=-1;
            for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
                if (d[(y*W+x)*4+3]>40) { if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; }
            }
            const bw = mxx-mnx+1, bh = mxy-mny+1;
            const ROWS = 40, COLS = 26;
            let art = '';
            for (let gy = 0; gy < ROWS; gy++) {
                let line = '';
                for (let gx = 0; gx < COLS; gx++) {
                    const x = mnx + Math.floor(gx * bw / COLS);
                    const y = mny + Math.floor(gy * bh / ROWS);
                    const i = (y*W+x)*4;
                    if (d[i+3] < 60) { line += ' '; continue; }
                    const rr=d[i],gg=d[i+1],bb=d[i+2];
                    let ch = '#';
                    if (rr > 150 && gg > 100 && bb > 60 && rr > bb) ch = 'S';
                    else if (gg >= rr+20 && gg >= 45) ch = 'G';
                    else if (bb > gg+10 && bb >= 45) ch = 'B';
                    else if (rr<90 && gg<90 && bb<90) ch = 'd';
                    else if (rr>90 && gg>90 && bb<90) ch = 'y';
                    line += ch;
                }
                art += line + '\\n';
            }
            out[k] = { size: W+'x'+H, bbox: bw+'x'+bh, ratio: (bw/bh).toFixed(2), art };
        }
        return JSON.stringify(out);
    } catch(e) { return JSON.stringify({ _err: e.message }); }
})()`;
const r = await sendMethod('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
const raw = r.result && r.result.value;
console.log('raw:', String(raw).slice(0, 400));
try {
    const res = JSON.parse(raw);
    if (res._err) { console.log('EVAL ERROR:', res._err); process.exit(1); }
    for (const k in res) {
        console.log('===== ' + k + '  ' + res[k].size + '  角色 ' + res[k].bbox + ' 比例 ' + res[k].ratio + ' =====');
        console.log(res[k].art);
    }
} catch(e) { console.log('PARSE FAIL:', e.message, 'raw=', raw); }
process.exit(0);
