const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const sendMethod = (m, p={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method: m, params: p})); }); };
const r = await sendMethod('Runtime.evaluate', { expression: `(() => {
    try {
        const sv = window.__surv.debugGetSv();
        return JSON.stringify({ character: sv.character, keys: Object.keys(sv.character||{}) });
    } catch(e) { return 'ERR: ' + e.message; }
})()`, returnByValue: true });
console.log(r.result.value);
process.exit(0);
