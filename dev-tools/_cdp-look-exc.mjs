// 单独抓 "Uncaught" 详情
import { WebSocket } from 'ws';
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://localhost:8000/index.html';
async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
const tabs = await getJson('/json');
const tab = tabs.find(t => t.type === 'page') || tabs[0];
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else events.push(m);
};
const send = (method, params={}) => new Promise((res, rej) => { const i=++id; pending.set(i,{res,rej}); ws.send(JSON.stringify({id:i,method,params})); });
const ev = (expr, ap=false) => send('Runtime.evaluate', { expression: expr, awaitPromise: ap, returnByValue: true }).then(r => r.exceptionDetails ? { err: r.exceptionDetails.text + ' | ' + (r.exceptionDetails.exception?.description||'') + ' | ' + JSON.stringify(r.exceptionDetails.stackTrace?.callFrames?.slice(0,3)||[]) } : r.result?.value);
await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: PAGE_URL });
await new Promise(r => setTimeout(r, 5000));
events.length = 0;
const save = { v:3, seed:20260802, day:3, hp:100, food:80, water:80, px:0, py:0, inv:[], hotbar:[], npcs:null, mods:{tiles:{},chests:{},boxLoot:{}}, character:{ skin:'#f0c8a0', hair:'#4a2f1b', shirt:'#3a7d44', pants:'#3a4a6a', shoes:'#5a4632', eyes:'#2c2c2c', hairStyle:0 }};
await ev(`localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
console.log('enter:', await ev(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js'); window.__s=m; m.enterWasteland({}); return 'ok'; })()`, true));
await new Promise(r => setTimeout(r, 2000));

console.log('--- showLookCreator 1st ---');
events.length = 0;
console.log(await ev(`(async()=>{ const m = await import('./source-code/mod-wasteland/wlook.js'); window.__w=m; m.showLookCreator(()=>{}); return 'ok'; })()`, true));
await new Promise(r => setTimeout(r, 800));
const e1 = events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => JSON.stringify(e.params, null, 2));
console.log('异常:', e1.length ? e1 : '无');

// 关掉
await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return 'ok'; })()`);
await new Promise(r => setTimeout(r, 400));

console.log('--- showLookCreator 2nd (重复打开) ---');
events.length = 0;
console.log(await ev(`(async()=>{ window.__w.showLookCreator(()=>{}); return 'ok'; })()`, true));
await new Promise(r => setTimeout(r, 800));
const e2 = events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => JSON.stringify(e.params, null, 2));
console.log('异常:', e2.length ? e2 : '无');

process.exit(0);