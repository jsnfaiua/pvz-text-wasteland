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
// file:// 打开纯静态预览页
const url = 'file:///C:/Users/24601/Desktop/%E6%96%87%E5%AD%97%E6%A4%8D%E7%89%A9%E5%A4%A7%E6%88%98%E5%83%B5%E5%B0%B8-%E4%BC%98%E5%8C%96%E7%89%88(1)(1)/%E6%96%87%E5%AD%97%E6%A4%8D%E7%89%A9%E5%A4%A7%E6%88%98%E5%83%B5%E5%B0%B8-%E4%BC%98%E5%8C%96%E7%89%88(1)/dev-tools/_qa_tmp/building-theme-preview.html';
await send('Page.navigate', { url });
await sleep(2500);
const r = await send('Runtime.evaluate', { expression: `(() => {
  const cvs = document.querySelectorAll('canvas');
  if (!cvs.length) return 'NO_CANVAS: ' + (document.body.innerText||'').slice(0,80);
  // 统计各方案颜色是否渲染（全 canvas 像素采样）
  const near = (r,g,b,tol) => { let n=0; for (const cv of cvs) {
    const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    for (let i=0;i<d.length;i+=4) if (Math.abs(d[i]-r)<tol && Math.abs(d[i+1]-g)<tol && Math.abs(d[i+2]-b)<tol) n++;
  } return n; };
  return JSON.stringify({
    canvasCount: cvs.length,
    floor: near(46,38,30,8),            // 木地板 rgb(44,36,28)+n
    deskA: near(200,168,120,8),         // #C8A878
    bedB: near(232,238,244,8),          // #E8EEF4
    rackC: near(154,160,168,8),         // #9AA0A8
    machineD: near(120,128,138,8),      // #78808A
    wall: near(58,58,66,8),             // #3a3a42
  });
})()`, returnByValue: true });
console.log(r.result && r.result.value);
// 截图存档供用户看
const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('fs');
if (shot.data) { fs.writeFileSync('dev-tools/_qa_tmp/building-theme-preview.png', Buffer.from(shot.data, 'base64')); console.log('截图已存 _qa_tmp/building-theme-preview.png'); }
process.exit(0);
