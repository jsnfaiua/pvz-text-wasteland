// 诊断玩家头部/脖子杂色：dump 玩家本体像素坐标 + 颜色
import fs from 'node:fs';
const CDP_URL = 'http://127.0.0.1:9222';
async function getJson(p) { return (await fetch(CDP_URL + p)).json(); }
class CDPClient {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
    static async connect(url) {
        const ws = new WebSocket(url);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const c = new CDPClient(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id) { const p = c.pending.get(msg.id); if (p) { c.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } }
        };
        return c;
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
    }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) return { err: r.exceptionDetails.text };
        return r.result && r.result.value;
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DUMP_PIXELS = `(async () => {
    const sv = window.__sv.debugGetSv();
    if (!sv || !sv.ctx) return { err: 'no sv' };
    const src = sv.ctx.canvas;
    const W = src.width, H = src.height;
    // 玩家屏幕坐标 = canvas 中心（camX = sv.px - W/2）
    const px = Math.round(W / 2), py = Math.round(H / 2 + (sv.jumpOffset || 0));
    const x0 = Math.max(0, px - 14), y0 = Math.max(0, py - 18);
    // 玩家本体 28x33 区域
    const id = sv.ctx.getImageData(x0, y0, 28, 33);
    const d = id.data;
    // 分区：y<10 头部、10<=y<16 脖子、y>=16 身上
    const headBlack = [], headOther = [], neckBlack = [], neckOther = [], allBlack = [];
    for (let y = 0; y < 33; y++) {
        for (let x = 0; x < 28; x++) {
            const i = (y * 28 + x) * 4;
            const a = d[i + 3], r = d[i], g = d[i + 1], b = d[i + 2];
            if (a === 0) continue;
            const sum = r + g + b;
            const isBlack = sum < 60;
            const e = { x, y, r, g, b, a };
            if (y < 10) {
                if (isBlack) headBlack.push(e); else headOther.push(e);
            } else if (y < 16) {
                if (isBlack) neckBlack.push(e); else neckOther.push(e);
            }
            if (isBlack) allBlack.push(e);
        }
    }
    // 找脖子里非黑但颜色异常的（与头发/皮肤/衣服/裤/鞋色板差距大）
    const MC_REF = [[247,205,155],[200,160,120],[216,176,136],[117,75,50],[120,78,53],[55,36,21],[74,46,22],[100,66,31],[56,40,24],[18,43,26],[20,45,24],[24,56,24],[40,80,40],[28,48,66],[41,62,81],[48,64,88],[16,32,48],[109,66,32],[39,25,15],[120,67,25],[136,88,48],[72,43,22],[28,24,20],[50,35,25],[45,30,22]];
    const nearest = (r,g,b) => { let bd=1e9,bp=null; for (const p of MC_REF) { const d2=(p[0]-r)*(p[0]-r)+(p[1]-g)*(p[1]-g)+(p[2]-b)*(p[2]-b); if (d2<bd){bd=d2;bp=p;} } return { d2: bd, p: bp }; };
    const neckAnomaly = neckOther.filter(e => nearest(e.r,e.g,e.b).d2 > 12000);
    return { x0, y0, px, py, W, H, headBlack, neckBlack, neckAnomaly, headOtherSample: headOther.slice(0,10), neckOtherSample: neckOther.slice(0,10), allBlack };
})()`;

async function main() {
    const tabs = await getJson('/json');
    const tab = tabs.find(t => t.type === 'page') || tabs[0];
    const c = await CDPClient.connect(tab.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    await sleep(500);
    // 强制 reload 清 tintSprite 缓存，让修复后的 nearestPart 生效
    await c.send('Page.reload', { ignoreCache: true });
    await sleep(2500);
    // 写入与 _cdp-look-verify 一致的 base look + enterWasteland
    const base = { skin: '#f0c8a0', hair: '#4a2f1b', shirt: '#3a7d44', pants: '#3a4a6a', shoes: '#5a4632', eyes: '#2c2c2c', hairStyle: 0 };
    const save = { v: 3, seed: 20260802, day: 3, hp: 100, food: 80, water: 80, px: 0, py: 0,
        inv: [], hotbar: [], npcs: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        character: { ...base } };
    await c.eval(`localStorage.removeItem('u:__guest__:wasteland_world_20260802'); localStorage.removeItem('u:__guest__:wasteland_profile'); localStorage.setItem('u:__guest__:wasteland_save', ${JSON.stringify(JSON.stringify(save))})`);
    await c.eval(`(async()=>{ const m = await import('./source-code/mod-wasteland/survival.js?v=' + Date.now()); window.__sv=m; m.enterWasteland({}); return 'ok'; })()`, true);
    await sleep(3500);
    const check = await c.eval(`(() => { const sv = window.__sv.debugGetSv(); return sv && sv.ctx && sv.character ? 'ok' : 'no'; })()`);
    console.log('sv:', check);
    // 诊断：检查 nearestPart 的修复分支是否被执行
    const diag = await c.eval(`(() => { return { eyesRedirect: window.__diagEyesRedirect || 0, hasMod: typeof window.__sv }; })()`);
    console.log('诊断:', JSON.stringify(diag));
    const r = await c.eval(DUMP_PIXELS, true);
    if (r && r.err) { console.log('err', r.err); return; }
    console.log(`截取 canvas(${r.W}x${r.H}) 玩家中心(${r.px},${r.py}) 区域(${r.x0},${r.y0})`);
    console.log(`\n=== 头部 (y<10) 黑色像素 ${r.headBlack.length} 个 ===`);
    r.headBlack.forEach(p => console.log(`  (${p.x},${p.y}) rgb(${p.r},${p.g},${p.b})`));
    console.log(`\n=== 头部非黑样本（前10）===`);
    r.headOtherSample.forEach(p => console.log(`  (${p.x},${p.y}) rgb(${p.r},${p.g},${p.b})`));
    console.log(`\n=== 脖子 (y 10-16) 黑色像素 ${r.neckBlack.length} 个 ===`);
    r.neckBlack.forEach(p => console.log(`  (${p.x},${p.y}) rgb(${p.r},${p.g},${p.b})`));
    console.log(`\n=== 脖子非黑异常色 (bestD²>12000) ${r.neckAnomaly.length} 个 ===`);
    r.neckAnomaly.forEach(p => {
        let bd=1e9,bp=null; for (const pp of [[247,205,155],[200,160,120],[216,176,136],[117,75,50],[120,78,53],[55,36,21],[74,46,22],[100,66,31],[56,40,24],[18,43,26],[20,45,24],[24,56,24],[40,80,40],[28,48,66],[41,62,81],[48,64,88],[16,32,48],[109,66,32],[39,25,15],[120,67,25],[136,88,48],[72,43,22],[28,24,20],[50,35,25],[45,30,22]]) { const d2=(pp[0]-p.r)*(pp[0]-p.r)+(pp[1]-p.g)*(pp[1]-p.g)+(pp[2]-p.b)*(pp[2]-p.b); if (d2<bd){bd=d2;bp=pp;} }
        console.log(`  (${p.x},${p.y}) rgb(${p.r},${p.g},${p.b}) 最近MC=rgb(${bp.join(',')}) d²=${Math.round(bd)}`);
    });
    console.log(`\n=== 全部黑色像素 ${r.allBlack.length} 个 ===`);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
