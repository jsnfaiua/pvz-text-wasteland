const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
await send('Runtime.enable');
const probe = await send('Runtime.evaluate', { expression: `(() => {
  const sv = window.__surv.debugGetSv();
  const c = sv.ctx;
  const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
  let yellow = 0;
  for (let i = 0; i < img.length; i += 4) {
    const r=img[i], g=img[i+1], b=img[i+2];
    // 标签色 #FFD75E → 255,215,94
    if (r >= 240 && g >= 200 && g <= 235 && b >= 80 && b <= 115) yellow++;
  }
  return JSON.stringify({ yellow });
})()`, returnByValue: true });
console.log(probe.result.value);
process.exit(0);
