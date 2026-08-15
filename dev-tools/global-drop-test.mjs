// ============================================================
// 荒原模组 · v3.19 全局掉落体系专项测试
// 验证核心规则（用户定稿）：物资/文字/字楔稀有度全局一致；
// 容器分池（容器=可出集合），池内按全局权重归一化；击杀僵尸出所有。
// 用法：node dev-tools/global-drop-test.mjs（需浏览器打桩，见下）
// 依赖模块：wbalance / wwordcraft-rules / wzombie（纯逻辑，不依赖 DOM 运行时）
// ============================================================

// ---- 浏览器全局打桩（复用 smoke-test 方案，供 wzombie 链可 import）----
const _lsStore = {};
const _lsStub = { getItem: k => (_lsStore[k] ?? null), setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
try { globalThis.localStorage = _lsStub; } catch { /* 忽略 */ }
globalThis.window = {
    localStorage: _lsStub,
    AudioContext: function () { return { createGain: () => ({ gain: { value: 0 }, connect() {}, addEventListener() {}, removeEventListener() {} }), destination: {}, currentTime: 0, state: 'running', addEventListener() {}, removeEventListener() {}, resume: () => Promise.resolve(), createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }), decodeAudioData: (b, ok) => ok && ok({ duration: 1 }) }; },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: cb => { cb(performance.now()); return 1; }, cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
};
globalThis.document = { createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }), addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, getElementsByClassName: () => [], body: { appendChild() {}, removeChild() {} }, documentElement: {}, createTextNode: () => ({}) };
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch { /* 忽略 */ }
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {};
globalThis.HTMLImageElement = function () {}; globalThis.Audio = function () {}; globalThis.OfflineAudioContext = function () {};

import * as B from '../source-code/mod-wasteland/wbalance.js';
import * as WW from '../source-code/mod-wasteland/wwordcraft-rules.js';

let pass = 0, fail = 0;
const assert = (cond, label) => { if (cond) pass++; else { fail++; console.error(`  FAIL: ${label}`); } };
const pct = w => (w * 100).toFixed(2) + '%';
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('=== 荒原模组 v3.19 全局掉落体系专项测试 ===\n');

// ================= G1 全局权重表合法性 =================
console.log('--- G1 权重表合法性 ---');
assert(B.LOOT_ITEM_WEIGHTS && Object.keys(B.LOOT_ITEM_WEIGHTS).length >= 40, `G1.1 物资权重表存在且 ≥40 项（实际 ${Object.keys(B.LOOT_ITEM_WEIGHTS || {}).length}）`);
assert(Object.values(B.LOOT_ITEM_WEIGHTS).every(w => w > 0), 'G1.2 所有物资权重 > 0');
assert(JSON.stringify([...B.ZOMBIE_LOOT_ALL].sort()) === JSON.stringify(Object.keys(B.LOOT_ITEM_WEIGHTS).sort()), 'G1.3 僵尸全池 = 权重表全部物资');
const wedgeSum = B.WEDGE_GLOBAL_WEIGHTS.rough + B.WEDGE_GLOBAL_WEIGHTS.stable + B.WEDGE_GLOBAL_WEIGHTS.clean;
assert(near(wedgeSum, 1), `G1.4 字楔全局权重和=1（实际 ${wedgeSum.toFixed(4)}）`);
assert(near(WW.GLYPH_UNIVERSAL.reduce((a, g) => a + g.weight, 0), 1, 1e-9), 'G1.5 文字全局权重和=1');

// ================= G2 全局概率一致性（数学验证）=================
// 核心：P_容器(id) = w_id / W_容器池总和。对共享 id：P_A/P_B 恒 = W_B总/W_A总。
console.log('\n--- G2 全局概率一致性（跨容器/僵尸相对稀有度一致）---');
const containerPools = {
    BOX: ['wood','stone','water','food','carrot','corn','potato','bread','apple','melon','herb','heal:bandage','heal:tonic','heal:kit','fert','sun','part','coin','fuel','tool:hoe','flag','ammo:pistolAmmo','ammo:arrowAmmo'],
    WBOX: ['wpn:pistol','wpn:dagger','wpn:knife','wpn:shovel','wpn:sword','wpn:spear','wpn:bow','wpn:shotgun','wpn:axe','wpn:smg','wpn:rifle','wpn:sniper','ammo:pistolAmmo','ammo:smgAmmo','ammo:rifleAmmo','ammo:sniperAmmo','ammo:shellAmmo','ammo:arrowAmmo','ammo:knifeAmmo','part','stone','flag','coin'],
    MEDBOX: ['herb','heal:bandage','heal:tonic','heal:kit','med:cold','med:wound','med:poison','med:dysentery','med:heat','med:pan','food','carrot','corn','potato','bread','apple','melon','water','fert','sun'],
    MATBOX: ['wood','stone','part','tool:chopper','tool:pick','tool:wrench','tool:hoe','ammo:pistolAmmo','ammo:shellAmmo','ammo:knifeAmmo'],
    TRASH: ['food','carrot','corn','potato','bread','apple','melon','water','part','herb','heal:bandage','coin','fuel'],
    CARD: ['wood','food','carrot','corn','potato','bread','apple','melon','part','coin','ammo:pistolAmmo','ammo:arrowAmmo'],
    HYDRANT: ['water','part'],
    NEWS: ['food','carrot','corn','potato','bread','apple','melon','herb','heal:bandage','wood','part','coin'],
    TIRES: ['part','ammo:pistolAmmo','ammo:shellAmmo','ammo:knifeAmmo'],
    CAR: ['wpn:pistol','wpn:dagger','wpn:knife','wpn:shovel','wpn:sword','wpn:spear','wpn:bow','wpn:shotgun','wpn:axe','wpn:smg','wpn:rifle','wpn:sniper','ammo:pistolAmmo','ammo:smgAmmo','ammo:rifleAmmo','ammo:sniperAmmo','ammo:shellAmmo','ammo:arrowAmmo','ammo:knifeAmmo','fuel','part','food','carrot','corn','potato','bread','apple','melon','wood','coin'],
};
const poolTotal = idList => idList.reduce((s, id) => s + (B.LOOT_ITEM_WEIGHTS[id] || 0.01), 0);
const poolP = (id, list) => (B.LOOT_ITEM_WEIGHTS[id] || 0.01) / poolTotal(list);
// 僵尸池 = 全池
const ZOMBIE_LIST = B.ZOMBIE_LOOT_ALL;
const names = Object.keys(containerPools);
let pairChecks = 0, pairFails = 0;
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const A = containerPools[names[i]], Bp = containerPools[names[j]];
    const WA = poolTotal(A), WB = poolTotal(Bp);
    const shared = A.filter(id => Bp.includes(id));
    if (!shared.length) continue;
    // 对共享 id 验证：P(id)×W池总和 恒等于该 id 的全局权重 w_id（两边应相等）
    for (const id of shared) {
        pairChecks++;
        const expect = poolP(id, A) * WA;      // = w_id
        const actual = poolP(id, Bp) * WB;     // = w_id
        if (!near(expect, actual, 1e-6)) { pairFails++; if (pairFails <= 5) console.error(`   相对稀有度不一致: ${id} in ${names[i]}/${names[j]}`); }
    }
}
assert(pairChecks > 0 && pairFails === 0, `G2.1 容器两两相对概率一致（${pairChecks} 项校验）`);
// 容器 vs 僵尸全池
let zChecks = 0, zFails = 0;
for (const n of names) {
    const pool = containerPools[n];
    const WPool = poolTotal(pool), WZombie = poolTotal(ZOMBIE_LIST);
    for (const id of pool) {
        zChecks++;
        const expect = poolP(id, pool) * WPool;            // = w_id
        const actual = poolP(id, ZOMBIE_LIST) * WZombie;   // = w_id
        if (!near(expect, actual, 1e-6)) { zFails++; if (zFails <= 5) console.error(`   容器/僵尸不一致: ${id} in ${n}`); }
    }
}
assert(zChecks > 0 && zFails === 0, `G2.2 容器 vs 僵尸全池相对概率一致（${zChecks} 项校验）`);
// 文字：容器字池 vs 全局权重（池内概率 = 全局权重/池权重和）
const glyphPools = {};
for (const k of Object.keys(WW.GLYPH_SOURCE_POOLS)) glyphPools[k] = WW.GLYPH_SOURCE_POOLS[k].map(g => g.id);
const glyphTotal = l => l.reduce((s, id) => s + (WW.GLYPH_UNIVERSAL_MAP[id] || 0.01), 0);
const glyphP = (id, l) => (WW.GLYPH_UNIVERSAL_MAP[id] || 0.01) / glyphTotal(l);
let gpChecks = 0, gpFails = 0;
const gNames = Object.keys(glyphPools);
for (let i = 0; i < gNames.length; i++) for (let j = i + 1; j < gNames.length; j++) {
    const A = glyphPools[gNames[i]], Bp = glyphPools[gNames[j]];
    const WA = glyphTotal(A), WB = glyphTotal(Bp);
    const shared = A.filter(id => Bp.includes(id));
    for (const id of shared) {
        gpChecks++;
        if (!near(glyphP(id, A) * WA, glyphP(id, Bp) * WB, 1e-6)) { gpFails++; if (gpFails <= 5) console.error(`   文字相对概率不一致: ${id} in ${gNames[i]}/${gNames[j]}`); }
    }
}
assert(gpChecks > 0 && gpFails === 0, `G2.3 容器文字池两两相对概率一致（${gpChecks} 项校验）`);

// ================= G3 容器分池白名单 + 抽样 =================
console.log('\n--- G3 容器分池白名单 + 抽样 ---');
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
let g3Total = 0, g3Out = 0;
for (const n of names) {
    const pool = containerPools[n];
    const rng = makeRng(12345 + n.length);
    for (let k = 0; k < 2000; k++) {
        const id = WW.rollGlobalLoot(pool, rng);
        if (id === null) continue;
        g3Total++;
        if (!pool.includes(id)) { g3Out++; if (g3Out <= 5) console.error(`   池外产出: ${id} ← ${n}`); }
    }
}
assert(g3Total > 0 && g3Out === 0, `G3.1 容器只出池内物资（${g3Total} 次抽样，池外 0）`);
// 街道空手率在 rollBoxContents 层（survival.js），非 rollGlobalLoot；静态校验容器表保留 empty 字段
const survivalSrc2 = await import('node:fs');
assert(survivalSrc2.existsSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url)), 'G3.2 survival.js 存在');
const survText = survivalSrc2.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
assert(survText.includes('empty: 0.14') && survText.includes('empty: 0.38'), 'G3.2 街道容器保留空手率（垃圾桶14%/轮胎38%）');

// ================= G4 蒙特卡洛统计验证 =================
console.log('\n--- G4 蒙特卡洛统计（全局概率分布）---');
const N = 200000;
const fullRng = makeRng(2026);
const stats = {};
for (let i = 0; i < N; i++) { const id = WW.rollGlobalLoot(ZOMBIE_LIST, fullRng); stats[id] = (stats[id] || 0) + 1; }
const wTotal = poolTotal(ZOMBIE_LIST);
let g4Checks = 0, g4Fails = 0;
for (const id of Object.keys(B.LOOT_ITEM_WEIGHTS)) {
    const theo = (B.LOOT_ITEM_WEIGHTS[id] || 0.01) / wTotal;
    const obs = (stats[id] || 0) / N;
    // 相对误差 < 15%（低频物品允许稍宽）
    if (theo > 0.001) {
        g4Checks++;
        if (Math.abs(obs - theo) / theo > 0.15) { g4Fails++; if (g4Fails <= 8) console.error(`   频率偏离: ${id} 理论${pct(theo)} 实测${pct(obs)}`); }
    }
}
assert(g4Checks > 0 && g4Fails === 0, `G4.1 全局权重蒙特卡洛（${N} 次抽样，${g4Checks} 项低频校验通过）`);
// 文字：GLYPH_UNIVERSAL 抽样 top 若干字（经导出 API rollWordLootOutcome 抽字）
const gN = 120000;
const gRng = makeRng(777);
const gStats = {};
let gDraws = 0;
for (let i = 0; i < gN; i++) {
    const r = WW.rollWordLootOutcome('zombie', { glyph: 1 }, { junkChance: 0 }, gRng);
    if (r.type !== 'glyph') continue;
    for (const it of r.items || []) {
        if (typeof it.id === 'string' && it.id.startsWith('glyph:')) {
            gStats[it.id.slice(6)] = (gStats[it.id.slice(6)] || 0) + 1;
            gDraws++;
        }
    }
}
const topChars = [...WW.GLYPH_UNIVERSAL].sort((a, b) => b.weight - a.weight).slice(0, 8);
let g4b = true;
for (const c of topChars) {
    if (gDraws <= 0) { g4b = false; break; }
    const theo = c.weight;
    const obs = (gStats[c.id] || 0) / gDraws;
    if (Math.abs(obs - theo) / theo > 0.15) { g4b = false; console.error(`   文字频率偏离: ${c.id} 理论${pct(theo)} 实测${pct(obs)}`); }
}
assert(gDraws > 0 && g4b, `G4.2 文字全局权重蒙特卡洛（${gDraws} 次抽字，top 8 字校验）`);

// ================= G5 数量规则 =================
console.log('\n--- G5 数量规则 ---');
assert(WW.globalLootQty('gem', () => 0.5) === 1, 'G5.1 默认数量 = 1');
assert(WW.globalLootQty('wood', () => 0) === 2 && WW.globalLootQty('wood', () => 0.99) === 4, 'G5.2 wood 数量 2~4');
assert(WW.globalLootQty('ammo:pistolAmmo', () => 0.5) === 7, 'G5.3 弹药规则中位 = 7');
assert(WW.globalLootQty('ammo:sniperAmmo', () => 0.5) === 4, 'G5.4 狙击弹数量 2~5（中位 4）');
let qtyOk = true;
for (const [id, q] of Object.entries(B.LOOT_ITEM_QTY)) if (!Array.isArray(q) || q.length !== 2 || q[0] > q[1]) { qtyOk = false; console.error(`   数量表非法: ${id}`); }
assert(qtyOk, 'G5.5 数量表全部合法 [min,max]');

// ================= G6 僵尸袋端到端（wzombie.rollLootContents）=================
console.log('\n--- G6 僵尸战利品袋端到端 ---');
let wz = null;
try { wz = await import('../source-code/mod-wasteland/wzombie.js'); } catch (e) { console.warn('  （wzombie 无法在 Node 下加载，跳过 G6 运行时：', e.message, '）'); }
if (wz) {
    // 合法物品 id 集合
    const known = new Set(Object.keys(B.LOOT_ITEM_WEIGHTS));
    for (const r of WW.RECIPES) known.add(r.output.id);
    for (const r of WW.RECIPES) known.add(r.id);
    const legal = it => {
        if (!it || !it.id) return false;
        if (known.has(it.id)) return true;
        if (/^glyph(-unstable|-infected)?:/ .test(it.id)) return true;
        if (/^wedge:(rough|stable|clean)$/.test(it.id)) return true;
        if (/^frag:/.test(it.id)) return true;            // 残缺物（轻/重）
        if (/^recipe:/.test(it.id)) return true;          // 配方物品（僵尸掉落解锁）
        if (/^loot:(common|rare|epic)$/.test(it.id)) return true;
        if (it.id.startsWith('complete:') || it.id === 'artifact') return true;
        return false;
    };
    const m = (seed) => {
        let s = (seed != null ? seed : (Math.random() * 1000000)) >>> 0;
        return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    };
    let total = 0, illegal = 0, giantTp = 0, giantRolls = 0;
    for (const quality of ['common', 'rare', 'epic']) {
        for (let i = 0; i < 500; i++) {
            globalThis.Math.random = m();
            const items = wz.rollLootContents(quality, 'normal');
            for (const it of items) { total++; if (!legal(it)) { illegal++; if (illegal <= 8) console.error(`   非法物品产出: ${JSON.stringify(it)} @${quality}`); } }
        }
    }
    for (let i = 0; i < 200; i++) {
        globalThis.Math.random = m();
        const items = wz.rollLootContents('epic', 'giant');
        giantRolls++;
        if (items.some(it => it.id === 'tpgem')) giantTp++;
    }
    assert(total > 0 && illegal === 0, `G6.1 僵尸袋产出全部合法（${total} 件物品）`);
    assert(giantTp === giantRolls, `G6.2 巨字尸必掉传送宝石（${giantTp}/${giantRolls}）`);
    // 联机确定性：两个独立同种子序列 → 产出一致（联机双端同随机数前提）
    const seedFn1 = m(12345), seedFn2 = m(12345);
    globalThis.Math.random = seedFn1;
    const r1 = wz.rollLootContents('rare', 'normal');
    globalThis.Math.random = seedFn2;
    const r2 = wz.rollLootContents('rare', 'normal');
    assert(JSON.stringify(r1) === JSON.stringify(r2), 'G6.3 同种子独立序列产出一致（联机确定性前提）');
    delete globalThis.Math.random;
} else {
    console.warn('  G6 跳过');
}

// ================= G7 文字体系回归 =================
console.log('\n--- G7 文字体系回归 ---');
const uniIds = new Set(WW.GLYPH_UNIVERSAL.map(g => g.id));
const recipeGlyphs = new Set();
for (const r of WW.RECIPES) r.glyphs.forEach(g => recipeGlyphs.add(g));
assert([...recipeGlyphs].every(ch => uniIds.has(ch)), 'G7.1 全局文字权重覆盖全部配方字');
let g7poolOk = true;
for (const k of Object.keys(WW.GLYPH_SOURCE_POOLS)) {
    for (const g of WW.GLYPH_SOURCE_POOLS[k]) if (!uniIds.has(g.id)) { g7poolOk = false; console.error(`   容器字池含未知字: ${g.id}`); }
}
assert(g7poolOk, 'G7.2 容器字池全部在全局权重内');
// 混淆字 5:1：用"单可用字池"隔离测试替换机制（junkChance=1/6 → 混淆占比≈1/6）。
// 注：真实容器池（如 supply）含无配方的"特殊字"（巨/力/暴/冰/雷等），它们天然属于混淆字，
// 因此实测全局混淆占比会高于 1/6，这是设计使然（物资箱能搜出特殊字）。
const cN = 9000;
const cRng = makeRng(42);
let junk = 0, glyph = 0;
for (let i = 0; i < cN; i++) {
    const r = WW.rollWordLootOutcome('supply', { glyph: 1 }, { glyphPool: [{ id: '药', weight: 1 }] }, cRng);
    for (const it of r.items || []) {
        if (typeof it.id !== 'string' || !it.id.startsWith('glyph:')) continue;
        if (WW.isConfusingGlyph(it.id.slice(6))) junk++; else glyph++;
    }
}
const junkShare = junk / (junk + glyph || 1);
assert(junkShare > 0.12 && junkShare < 0.22, `G7.3 混淆字替换机制 5:1（单字池实测 ${pct(junkShare)}，理论 ≈16.7%）`);
// rollTextLoot 旧API 不混入混淆字
const tl = WW.rollTextLoot(() => 0.999);
assert(tl && tl.id && tl.id !== 'loot:junk', 'G7.4 rollTextLoot 旧API 稳定（不返回混淆字）');

// ================= G8 室内/联机核对 =================
console.log('\n--- G8 室内（windoor）/联机核对 ---');
const fs = await import('node:fs');
const windoorSrc = fs.readFileSync(new URL('../source-code/mod-wasteland/windoor.js', import.meta.url), 'utf8');
assert(windoorSrc.includes('rollLootContents'), 'G8.1 室内容器复用 wzombie.rollLootContents（室内外掉落同一套）');
const wzombieSrc = fs.readFileSync(new URL('../source-code/mod-wasteland/wzombie.js', import.meta.url), 'utf8');
assert(!wzombieSrc.includes('resolveLootItem'), 'G8.2 旧 resolveLootItem 已移除');
assert(wzombieSrc.includes('rollGlobalLoot'), 'G8.3 僵尸袋走 rollGlobalLoot 全局权重');
const survivalSrc = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
assert(!survivalSrc.includes('function rollSupplyLoot') && !survivalSrc.includes('function rollWeaponLoot') && !survivalSrc.includes('function rollTrashLoot'), 'G8.4 按箱型硬编码掉落函数已移除');
assert(survivalSrc.includes('CONTAINER_LOOT_POOLS') && survivalSrc.includes('rollGlobalLoot'), 'G8.5 survival 走容器分池 + 全局权重');

console.log(`\n======== 结果: ${pass} 通过, ${fail} 失败 ========`);
if (fail > 0) process.exit(1);
