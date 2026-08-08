const CDP = 'http://127.0.0.1:9222';
const tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } };
const send = (method, params={}) => { const i = ++id; return new Promise((res, rej) => { pend.set(i, {resolve: res, reject: rej}); ws.send(JSON.stringify({id: i, method, params})); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable');
await send('Runtime.enable');
const url = 'file:///C:/Users/24601/Desktop/%E6%96%87%E5%AD%97%E6%A4%8D%E7%89%A9%E5%A4%A7%E6%88%98%E5%83%B5%E5%B0%B8-%E4%BC%98%E5%8C%96%E7%89%88(1)(1)/%E6%96%87%E5%AD%97%E6%A4%8D%E7%89%A9%E5%A4%A7%E6%88%98%E5%83%B5%E5%B0%B8-%E4%BC%98%E5%8C%96%E7%89%88(1)/dev-tools/_qa_tmp/building-style-adjust.html';
await send('Page.navigate', { url });
await sleep(2500);
const r = await send('Runtime.evaluate', { expression: `(() => {
  const cvs = document.querySelectorAll('canvas');
  if (!cvs.length) return 'NO_CANVAS: ' + (document.body.innerText||'').slice(0,80);
  return JSON.stringify({
    canvasCount: cvs.length,
    urbanRows: document.getElementById('urbanBody').children.length,
    suburbRows: document.getElementById('suburbBody').children.length,
    rows: document.querySelectorAll('tr').length,
    urbanBase: (document.querySelector('#urbanBody canvas')||{}).width||0,
    hasHospital: [...document.querySelectorAll('.type')].some(t=>t.textContent==='医院'),
  });
})()`, returnByValue: true });
console.log(r.result && r.result.value);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
if (shot.data) { fs.writeFileSync('dev-tools/_qa_tmp/building-style-adjust.png', Buffer.from(shot.data, 'base64')); console.log('截图已存'); }
process.exit(0);
