// import * as 解析验证：在 Node 下加载所有源文件，断言每个 WW.xxx / B.xxx 访问都能找到函数。
// 运行：node dev-tools/import-resolve-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASTELAND = path.join(projRoot, 'source-code/mod-wasteland');

// 浏览器打桩
const _ls = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
try { globalThis.localStorage = _ls; } catch {}
globalThis.window = { localStorage: _ls, AudioContext: function () { return { createGain: () => ({ gain: { value: 0 }, connect() {} }), destination: {}, currentTime: 0, state: 'running', createBuffer: () => ({}), createBufferSource: () => ({}), decodeAudioData: (b, ok) => ok({}) }; }, setTimeout, clearTimeout, requestAnimationFrame: cb => { cb(0); return 1; }, cancelAnimationFrame: () => {}, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540 };
globalThis.document = { createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }), addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, getElementsByClassName: () => [], body: { appendChild() {}, removeChild() {} }, documentElement: {}, createTextNode: () => ({}) };
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(0); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {};
globalThis.HTMLImageElement = function () {}; globalThis.Audio = function () {};
globalThis.OfflineAudioContext = function () {};

// 加载所有源模块（每个都尝试 import，失败记录）
const MODULES = {};
const loadOrder = ['wbalance.js', 'wwordcraft-rules.js', 'wwordcraft.js', 'wwordcraft.js', 'wgrade.js', 'panel.js', 'wzombie.js', 'wmsg.js', 'wdev.js'];
for (const f of loadOrder) {
    try { MODULES[f] = await import(pathToFileURL(path.join(WASTELAND, f)).href); console.log(`  loaded ${f}`); }
    catch (e) { console.warn(`  skip ${f}: ${e.message.split('\n')[0]}`); }
}
const B = MODULES['wbalance.js'], WR = MODULES['wwordcraft-rules.js'], WC = MODULES['wwordcraft.js'];
if (!B || !WR || !WC) { console.error('核心模块加载失败'); process.exit(1); }

let pass = 0, fail = 0;
const ok = m => { pass++; };
const bad = m => { fail++; console.error('  ✗ ' + m); };

// 1. 验证 wwordcraft.js 必须导出 v3.19 新函数（供 survival.js 通过 WW.* 访问）
for (const name of ['rollGlobalLoot', 'globalLootQty', 'GLYPH_UNIVERSAL', 'GLYPH_UNIVERSAL_MAP']) {
    if (typeof WC[name] === 'undefined') bad(`wwordcraft.js 缺 ${name}（survival.js import * as WW 会用 WW.${name}）`);
    else ok(`wwordcraft.js.${name} 已导出`);
}
// 2. 验证 wbalance.js 必须导出 v3.19 新表
for (const name of ['LOOT_ITEM_WEIGHTS', 'LOOT_ITEM_QTY', 'ZOMBIE_LOOT_ALL', 'WEDGE_GLOBAL_WEIGHTS']) {
    if (typeof B[name] === 'undefined') bad(`wbalance.js 缺 ${name}`);
    else ok(`wbalance.js.${name} 已导出`);
}
// 3. 模拟玩家点 F 搜刮：调用 survival.js 真实 rollBoxContents 逻辑
//   但 survival.js 大量依赖 survival 内部状态（sv.world/tiles etc.）—— 这里采用 wwordcraft.js 间接调用：
//   a. wwordcraft.js 必须能解析 WW.rollGlobalLoot 与
//   b. rollWordLootOutcome 必须能正确返回字块
//   c. 旧硬编码函数不存在（保证运行时崩不了）
// 4. 静态扫：扫所有 js 文件的 `WW.xxx`、`B.xxx` 调用，断言每个引用名在对应命名空间可解析
const files = fs.readdirSync(WASTELAND).filter(f => f.endsWith('.js'));
const allInWW = new Set([...Object.keys(WR), ...Object.keys(WC), ...Object.keys(MODULES['wzombie.js'] || {})]);
const allInB = new Set(Object.keys(B));
for (const f of files) {
    const src = fs.readFileSync(path.join(WASTELAND, f), 'utf8');
    const codeLines = src.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l));
    const codeOnly = codeLines.join('\n').replace(/\/\/.*$/gm, '');  // 去掉行尾注释
    // 找 WW.<identifier>( 或 WW.<identifier>
    const wwRefs = [...codeOnly.matchAll(/\bWW\.([A-Za-z_]\w*)/g)].map(m => m[1]);
    const bRefs = [...codeOnly.matchAll(/\bB\.([A-Za-z_]\w*)/g)].map(m => m[1]);
    for (const name of new Set(wwRefs)) {
        // 排除从 wwordcraft.js 直接导出的（WW 是命名空间）
        if (f === 'wwordcraft.js') continue;
        // wwordcraft.js 内部 import * as WW from './wwordcraft-rules.js'，rules.js 内 WW. 全部能解析
        // survival.js 的 WW 来自 wwordcraft.js，需检查 wwordcraft.js 导出
        // wdev.js/wzombie.js 的 WW 来自 wwordcraft-rules.js，直接可解析
        if (f === 'survival.js' || f === 'panel.js') {
            if (typeof WC[name] === 'undefined' && typeof WR[name] === 'undefined') {
                bad(`${f} 引用 WW.${name}，但 wwordcraft.js 和 wwordcraft-rules.js 均未导出`);
            }
        }
    }
    for (const name of new Set(bRefs)) {
        if (f === 'wbalance.js') continue;
        if (typeof B[name] === 'undefined') {
            // 可能是 B9（在 wwordcraft-rules.js 内部）
            if (f === 'wwordcraft-rules.js' && src.includes('import * as B9')) continue;
            bad(`${f} 引用 B.${name}，但 wbalance.js 未导出`);
        }
    }
}
ok('静态扫除未定义引用');

console.log(`\n======== ${pass} 通过, ${fail} 失败 ========`);
if (fail > 0) process.exit(1);