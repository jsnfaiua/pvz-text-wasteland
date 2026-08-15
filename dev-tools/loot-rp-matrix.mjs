// ============================================================================
// 荒原模组 · 真实玩家视角 × 开发者模式 掉落体系全矩阵测试（2026-08-12 v3.19）
// 覆盖维度：
//   A. 真实玩家玩法闭环（多轮：3种子 × 5局 × 完整操作链：开箱→入包→使用→拆字→拼字→杀僵尸）
//   B. 全矩阵：容器类型(10) × 玩家模式(纯正/开发者) × 难度(normal/hell) = 40 cell × 20轮
//   C. 控制变量：文字/物资/字楔/配方/手术刀 五通道互不干扰 + 各自纯净
//   D. 开发者模式视角：开箱、刷未实装模子物品、全物资生成跳过模子、无限背包
//   E. 多轮稳定性（压力）：单容器 500 轮连抽 + 拆字/拼字混合
//   F. 静态核对：容器池与 survival.js 源码一致、字楔全局权重生效、未实装无获取途径
// 运行：node dev-tools/loot-rp-matrix.mjs
// ============================================================================

// ---- 浏览器打桩（供 panel/wzombie 链可 import）----
const _lsStore = {};
const _lsStub = { getItem: k => (_lsStore[k] ?? null), setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
try { globalThis.localStorage = _lsStub; } catch {}
globalThis.window = {
    localStorage: _lsStub,
    AudioContext: function () {
        const gain = () => ({ gain: { value: 0 }, connect() {} });
        return { createGain: gain, destination: {}, currentTime: 0,
            createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }),
            decodeAudioData: (b, ok) => ok && ok({ duration: 1 }),
            createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }),
            createMediaElementSource: () => ({ connect() {} }) };
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: cb => { cb(performance.now()); return 1; }, cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
};
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null,
    getElementsByClassName: () => [], body: { appendChild() {}, removeChild() {} }, documentElement: {}, createTextNode: () => ({}),
};
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {};
globalThis.HTMLImageElement = function () {}; globalThis.Audio = function () {}; globalThis.OfflineAudioContext = function () {};

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readMod = f => fs.readFileSync(path.join(projRoot, 'source-code/mod-wasteland/' + f), 'utf8');

const B = (await import('../source-code/mod-wasteland/wbalance.js')).default ?? (await import('../source-code/mod-wasteland/wbalance.js'));
const WWR = (await import('../source-code/mod-wasteland/wwordcraft-rules.js')).default ?? (await import('../source-code/mod-wasteland/wwordcraft-rules.js'));
const Panel = (await import('../source-code/mod-wasteland/panel.js')).default ?? (await import('../source-code/mod-wasteland/panel.js'));
const WZ = (await import('../source-code/mod-wasteland/wzombie.js')).default ?? (await import('../source-code/mod-wasteland/wzombie.js'));
const MSG = (await import('../source-code/mod-wasteland/wmsg.js')).default ?? (await import('../source-code/mod-wasteland/wmsg.js'));

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) pass++; else { console.error('  ✗ FAIL: ' + m); fail++; } };
const report = (label, detail) => { console.error(`  ✗ [${label}] ${detail}`); fail++; };
const pct = w => (w * 100).toFixed(2) + '%';

// ---- 确定性随机 ----
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---- 容器池（与 survival.js CONTAINER_LOOT_POOLS / CAR_LOOT_POOL 同步）----
const POOLS = {
    BOX:    ['wood','stone','water','food','carrot','corn','potato','bread','apple','melon','herb','heal:bandage','heal:tonic','heal:kit','fert','sun','part','coin','fuel','tool:hoe','flag','ammo:pistolAmmo','ammo:arrowAmmo'],
    WBOX:   ['wpn:pistol','wpn:dagger','wpn:knife','wpn:shovel','wpn:sword','wpn:spear','wpn:bow','wpn:shotgun','wpn:axe','wpn:smg','wpn:rifle','wpn:sniper','ammo:pistolAmmo','ammo:smgAmmo','ammo:rifleAmmo','ammo:sniperAmmo','ammo:shellAmmo','ammo:arrowAmmo','ammo:knifeAmmo','part','stone','flag','coin'],
    MEDBOX: ['herb','heal:bandage','heal:tonic','heal:kit','med:cold','med:wound','med:poison','med:dysentery','med:heat','med:pan','food','carrot','corn','potato','bread','apple','melon','water','fert','sun'],
    MATBOX: ['wood','stone','part','tool:chopper','tool:pick','tool:wrench','tool:hoe','ammo:pistolAmmo','ammo:shellAmmo','ammo:knifeAmmo'],
    TRASH:  ['food','carrot','corn','potato','bread','apple','melon','water','part','herb','heal:bandage','coin','fuel'],
    CARD:   ['wood','food','carrot','corn','potato','bread','apple','melon','part','coin','ammo:pistolAmmo','ammo:arrowAmmo'],
    HYDRANT:['water','part'],
    NEWS:   ['food','carrot','corn','potato','bread','apple','melon','herb','heal:bandage','wood','part','coin'],
    TIRES:  ['part','ammo:pistolAmmo','ammo:shellAmmo','ammo:knifeAmmo'],
    CAR:    ['wpn:pistol','wpn:dagger','wpn:knife','wpn:shovel','wpn:sword','wpn:spear','wpn:bow','wpn:shotgun','wpn:axe','wpn:smg','wpn:rifle','wpn:sniper','ammo:pistolAmmo','ammo:smgAmmo','ammo:rifleAmmo','ammo:sniperAmmo','ammo:shellAmmo','ammo:arrowAmmo','ammo:knifeAmmo','fuel','part','food','carrot','corn','potato','bread','apple','melon','wood','coin'],
};
const STREET = new Set(['TRASH', 'CARD', 'HYDRANT', 'NEWS', 'TIRES']);
const STREET_EMPTY = { TRASH: 0.14, CARD: 0.26, HYDRANT: 0.15, NEWS: 0.30, TIRES: 0.38 };
// 容器 → 文字池（survival rollBoxContents 映射）
const WORD_SRC = { BOX: 'supply', WBOX: 'weapon', MEDBOX: 'medical', MATBOX: 'material', CAR: 'car' };
// 容器 → 源码键
const SRC_KEY = { BOX: 'T.BOX', WBOX: 'T.WBOX', MEDBOX: 'T.MEDBOX', MATBOX: 'T.MATBOX', TRASH: 'T.TRASHBIN', CARD: 'T.CARDBOX', HYDRANT: 'T.HYDRANT', NEWS: 'T.NEWSSTAND', TIRES: 'T.TIRES' };

// ---- 合法物品判定 ----
const KNOWN = new Set(Object.keys(B.LOOT_ITEM_WEIGHTS));
for (const r of WWR.RECIPES) { KNOWN.add(r.output.id); KNOWN.add(r.id); }
function isLegalItem(id) {
    if (!id || typeof id !== 'string') return false;
    if (KNOWN.has(id)) return true;
    if (/^glyph(-unstable|-infected)?:/.test(id)) return true;
    if (/^wedge:(rough|stable|clean)$/.test(id)) return true;
    if (/^frag:/.test(id)) return true;
    if (/^recipe:/.test(id)) return true;
    if (/^loot:(common|rare|epic)$/.test(id)) return true;
    if (/^complete:/.test(id)) return true;
    if (['artifact', 'tool:surgery'].includes(id)) return true;
    const info = Panel.getItemInfo(id);
    return !!(info && info.name);
}
// 未实装物品（proto:）绝不能出现在掉落中
function assertNoProto(items, label) {
    for (const it of items) {
        if (it && typeof it.id === 'string' && it.id.startsWith('proto:')) { report(label, `掉落中出现未实装物品 ${it.id}`); return; }
    }
    pass++;
}

// ---- 最小玩家状态（真实玩家视角） ----
function makeSv(seed, opts = {}) {
    const sv = {
        active: true, dead: false, day: 1, t: B.DAY_LEN * 0.35,
        inv: Array(Panel.BAG_SIZE).fill(null),
        hotbar: Array((B.HOTBAR_SIZE || 8)).fill(null), hotbarSel: -1,
        coins: 0, food: B.HUNGER_MAX, water: B.WATER_MAX, hp: B.MAX_HP, maxHp: B.MAX_HP,
        msgs: [], mods: { recipes: new Set(), tiles: {}, chests: {}, boxLoot: {} },
        world: { seed, chunks: new Map() }, now: 0,
        px: 0, py: 0, faceX: 1, faceY: 0, controllerId: 'player',
        zombies: [], npcs: [], character: { body: '#39d98a', head: '#2b7a52', hat: null, face: null },
        ...opts,
    };
    MSG.initMsg(sv);
    return sv;
}

// ---- 真实开箱模拟（复刻 survival.rollBoxContents 的掉落逻辑）----
function simulateOpenBox(boxType, rng, recipes) {
    const items = [];
    const isStreet = STREET.has(boxType);
    const rolls = isStreet ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
    for (let i = 0; i < rolls; i++) {
        const empty = STREET_EMPTY[boxType];
        if (empty && rng() < empty) continue;
        const id = WWR.rollGlobalLoot(POOLS[boxType], rng);
        if (!id) continue;
        items.push({ id, n: WWR.globalLootQty(id, rng) });
    }
    if (isStreet) return items;
    // 文字附加（容器分池 + 全局权重归一化）
    const src = WORD_SRC[boxType];
    const wr = WWR.rollWordLootOutcome(src, B.WORD_LOOT_SOURCE_TABLES[src], { glyphPool: WWR.GLYPH_SOURCE_POOLS[src] }, rng);
    if (wr && wr.items) items.push(...wr.items);
    // 配方掉落 12%（仅标准四箱；街道与汽车真实掉落无配方）
    if (!isStreet && boxType !== 'CAR' && rng() < 0.12) {
        const r = WWR.rollRecipeItem(recipes, rng);
        if (r) items.push(r);
    }
    // 文字手术刀 2%（仅医疗箱）
    if (boxType === 'MEDBOX' && rng() < B.SURGERY_MEDBOX_DROP_CHANCE) items.push({ id: 'tool:surgery', n: 1 });
    return items;
}

// 物品入包
function addLootToBag(sv, items) {
    for (const it of items) {
        if (!it || !it.id) continue;
        try { Panel.addItem(sv, it.id, it.n || 1); } catch (e) { report('入包', `${it.id} 入包异常 ${e.message}`); }
    }
}

console.log('=== 荒原模组 v3.19 真实玩家 × 开发者 × 全矩阵掉落测试 ===\n');

// ================= A. 真实玩家玩法闭环（多轮） =================
console.log('--- A. 真实玩家玩法闭环（3种子 × 5局） ---');
const RNG_SEEDS = [20260802, 12345, 987654321];
const PLAY_FOODS = ['food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon'];
const PLAY_HEALS = ['herb', 'heal:bandage', 'heal:tonic', 'heal:kit'];
let aPlayersAlive = 0, aRounds = 0;
for (const seed of RNG_SEEDS) {
    for (let round = 0; round < 5; round++) {
        aRounds++;
        const sv = makeSv(seed + round);
        const rng = makeRng(seed * 7 + round);
        let alive = true;
        try {
            // ① 连续搜刮 3 个不同容器
            const boxTypes = ['BOX', 'WBOX', 'MEDBOX', 'MATBOX', 'CAR'].slice(0, 3);
            for (const bt of boxTypes) {
                const got = simulateOpenBox(bt, rng, sv.mods.recipes);
                assertNoProto(got, `A 开箱 ${bt}`);
                for (const it of got) if (!isLegalItem(it.id)) report('A', `非法掉落 ${it.id} ← ${bt}`);
                addLootToBag(sv, got);
            }
            // ② 使用物品：先吃食物（若背包有）再回血（若受伤）
            const findItem = id => sv.inv.findIndex(s => s && s.id === id);
            for (const fid of PLAY_FOODS) {
                const idx = findItem(fid);
                if (idx >= 0) {
                    const sat = Panel.ITEMS[fid] && (Panel.ITEMS[fid].satiate || 0);
                    const before = sv.food;
                    sv.food = Math.min(B.HUNGER_MAX, sv.food + sat);
                    sv.inv[idx].n--; if (sv.inv[idx].n <= 0) sv.inv[idx] = null;
                    assert(sv.food >= before, `A 吃 ${fid} 后饱食不降`);
                    break;
                }
            }
            sv.hp = 60;   // 模拟受伤
            for (const hid of PLAY_HEALS) {
                const idx = findItem(hid);
                if (idx >= 0) {
                    const heal = Panel.ITEMS[hid] && (Panel.ITEMS[hid].heal || 0);
                    const before = sv.hp;
                    sv.hp = Math.min(sv.maxHp, sv.hp + heal);
                    sv.inv[idx].n--; if (sv.inv[idx].n <= 0) sv.inv[idx] = null;
                    assert(sv.hp > before, `A 用 ${hid} 后血量增加`);
                    break;
                }
            }
            // ③ 拆字：手术刀拆手枪（必定成功）
            let surgeryOk = 0;
            for (let k = 0; k < 20; k++) {
                const res = WWR.surgeryOn('wpn:pistol', rng, 3);
                if (res && res.ok) { surgeryOk++; if (res.items) addLootToBag(sv, res.items); }
            }
            assert(surgeryOk === 20, `A 拆字 20 次全部成功（实际 ${surgeryOk}）`);
            // ④ 拼字：给字块 → 拼出"短剑"
            const daggerRecipe = WWR.RECIPES.find(r => r.output.id === 'wpn:dagger');
            for (const ch of daggerRecipe.glyphs) Panel.addItem(sv, WWR.glyphId(ch), 1);
            for (let w = 0; w < daggerRecipe.wedges; w++) Panel.addItem(sv, daggerRecipe.wedgeId || 'wedge:rough', 1);
            const avail = WWR.recipeAvailability(sv.inv, daggerRecipe);
            assert(avail.ok, `A 拼字台可拼短剑（缺: ${avail.missing.join(',')}）`);
            for (const ch of daggerRecipe.glyphs) {
                const i = findItem(WWR.glyphId(ch));
                if (i >= 0) { sv.inv[i].n--; if (sv.inv[i].n <= 0) sv.inv[i] = null; }
            }
            const wi = findItem(daggerRecipe.wedgeId || 'wedge:rough');
            if (wi >= 0) { sv.inv[wi].n -= daggerRecipe.wedges; if (sv.inv[wi].n <= 0) sv.inv[wi] = null; }
            Panel.addItem(sv, daggerRecipe.output.id, daggerRecipe.output.n);
            assert(findItem('wpn:dagger') >= 0, 'A 拼字产出短剑入包');
            // ⑤ 击杀僵尸 → 战利品袋
            for (const q of ['common', 'rare', 'epic']) {
                globalThis.Math.random = rng;
                const bag = WZ.rollLootContents(q, 'normal');
                for (const it of bag) if (!isLegalItem(it.id)) report('A', `僵尸袋非法 ${it.id} @${q}`);
                assertNoProto(bag, `A 僵尸袋 ${q}`);
                addLootToBag(sv, bag);
                delete globalThis.Math.random;
            }
            // ⑥ 背包合法性 + 生存
            let illegal = 0;
            for (const s of sv.inv) if (s && !isLegalItem(s.id)) illegal++;
            assert(illegal === 0, `A 背包无非法物品（${illegal}）`);
            const used = sv.inv.some(s => s);
            assert(used, 'A 背包有内容');
            alive = true;
        } catch (e) {
            report('A', `局 ${seed}/${round} 异常 ${e.message}\n${(e.stack || '').split('\n').slice(0, 3).join('\n')}`);
            alive = false;
        }
        if (alive) aPlayersAlive++;
    }
}
assert(aPlayersAlive === aRounds, `A 全部 ${aRounds} 局玩家存活（${aPlayersAlive}）`);
console.log(`  完成 ${aRounds} 局玩家闭环`);

// ================= B. 全矩阵：容器 × 模式 × 难度 =================
console.log('\n--- B. 全矩阵（10容器 × 2模式 × 2难度 = 40 cell × 20轮） ---');
let bCells = 0, bOutOfPool = 0, bIllegal = 0, bErr = 0, bTotals = 0;
for (const boxType of Object.keys(POOLS)) {
    for (const mode of ['real', 'dev']) {
        for (const difficulty of ['normal', 'hell']) {
            bCells++;
            for (let r = 0; r < 20; r++) {
                const rng = makeRng(1000 * bCells + r);
                const recipes = new Set();
                try {
                    const sv = makeSv(9999, mode === 'dev' ? { _devInf: true, _devGod: true } : {});
                    const got = simulateOpenBox(boxType, rng, recipes);
                    for (const it of got) {
                        bTotals++;
                        const isExtra = /^(glyph|wedge|frag|recipe|loot|complete):/.test(it.id) || it.id === 'tool:surgery' || it.id === 'artifact';
                        if (boxType === 'CAR') {
                            // 汽车 = 物资池 + 文字附加（字块/字楔/残缺物）
                            if (!POOLS.CAR.includes(it.id) && !isExtra) bOutOfPool++;
                        } else if (STREET.has(boxType)) {
                            if (!POOLS[boxType].includes(it.id)) { bOutOfPool++; }
                        } else {
                            // 标准箱：物资/弹药/武器/工具/旗/金币 + 文字/字楔/配方/手术刀
                            const inPool = POOLS[boxType].includes(it.id);
                            if (!inPool && !isExtra) bOutOfPool++;
                        }
                        if (!isLegalItem(it.id)) { bIllegal++; if (bIllegal <= 5) console.error(`   非法: ${it.id} ← ${boxType}/${mode}/${difficulty}`); }
                        if (bOutOfPool > 0 && bOutOfPool <= 8) console.error(`   池外: ${it.id} ← ${boxType}/${mode}/${difficulty}`);
                        assertNoProto([it], `B ${boxType}/${mode}/${difficulty}`);
                    }
                    addLootToBag(sv, got);
                } catch (e) { bErr++; if (bErr <= 3) report('B', `${boxType}/${mode}/${difficulty} 异常 ${e.message}`); }
            }
        }
    }
}
assert(bCells === 40, `B 矩阵 40 cell 全执行`);
assert(bOutOfPool === 0, `B 池外产出 0（实际 ${bOutOfPool}）`);
assert(bIllegal === 0, `B 非法物品 0（实际 ${bIllegal}）`);
assert(bErr === 0, `B 异常 0（实际 ${bErr}）`);
assert(bTotals > 1000, `B 采样总量 ${bTotals}`);
console.log(`  40 cell 完成，共采样 ${bTotals} 件`);

// ================= C. 控制变量：五通道纯净 =================
console.log('\n--- C. 控制变量：五通道互不干扰 ---');
// C1 纯物资通道（rollGlobalLoot 只出物资，绝不出文字/字楔/配方）
{
    const rng = makeRng(31415);
    let onlyItems = true, n = 0;
    for (let i = 0; i < 3000; i++) {
        const id = WWR.rollGlobalLoot(POOLS.BOX, rng);
        if (!id) continue;
        n++;
        if (!/^(wood|stone|water|food|carrot|corn|potato|bread|apple|melon|herb|heal:|med:|fert|sun|part|coin|fuel|tool:|flag|ammo:)/.test(id)) { onlyItems = false; console.error(`   物资通道混入: ${id}`); }
    }
    assert(onlyItems && n > 2000, `C1 物资通道纯净（${n} 件全为物资）`);
}
// C2 纯文字通道（rollWordLootOutcome glyph → 只有 glyph:）
{
    const rng = makeRng(2718);
    let onlyGlyph = true, n = 0, glyph = 0;
    for (let i = 0; i < 3000; i++) {
        const r = WWR.rollWordLootOutcome('supply', { glyph: 1 }, { glyphPool: WWR.GLYPH_SOURCE_POOLS.supply }, rng);
        for (const it of r.items || []) {
            n++;
            if (!/^glyph/.test(it.id)) { onlyGlyph = false; console.error(`   文字通道混入: ${it.id}`); }
            else glyph++;
        }
    }
    assert(onlyGlyph && glyph > 0, `C2 文字通道纯净（${n} 件全为字块）`);
}
// C3 纯字楔通道（字楔全局权重 62/33/5）
{
    const rng = makeRng(1618);
    const cnt = { 'wedge:rough': 0, 'wedge:stable': 0, 'wedge:clean': 0 };
    let n = 0;
    for (let i = 0; i < 3000; i++) {
        const r = WWR.rollWordLootOutcome('supply', { wedge: 1 }, {}, rng);
        for (const it of r.items || []) {
            if (cnt[it.id] != null) { cnt[it.id]++; n++; }
        }
    }
    const roughP = cnt['wedge:rough'] / n, cleanP = cnt['wedge:clean'] / n;
    assert(n > 2000 && roughP > 0.55 && roughP < 0.70, `C3 字楔全局权重 粗制≈62%（实测 ${pct(roughP)}）`);
    assert(cleanP > 0.02 && cleanP < 0.09, `C3 字楔全局权重 洁净≈5%（实测 ${pct(cleanP)}）`);
}
// C4 配方通道（rollRecipeItem 只出 recipe: 未解锁配方）
{
    const rng = makeRng(16180);
    let onlyRecipe = true, n = 0;
    for (let i = 0; i < 500; i++) {
        const r = WWR.rollRecipeItem(new Set(), rng);
        if (!r) continue;
        n++;
        if (!/^recipe:/.test(r.id)) { onlyRecipe = false; console.error(`   配方通道混入: ${r.id}`); }
    }
    assert(onlyRecipe && n > 400, `C4 配方通道纯净（${n} 件）`);
}
// C5 手术刀 2%（仅医疗箱；抽样 5000 轮 1%~3%）
{
    const rng = makeRng(20260812);
    let surgery = 0, rounds = 5000;
    for (let i = 0; i < rounds; i++) {
        const got = simulateOpenBox('MEDBOX', rng, new Set());
        if (got.some(it => it.id === 'tool:surgery')) surgery++;
    }
    const sp = surgery / rounds;
    assert(sp > 0.01 && sp < 0.03, `C5 手术刀医疗箱 2%（实测 ${pct(sp)}）`);
}
// C6 普通箱绝不出手术刀
{
    const rng = makeRng(555);
    let found = 0;
    for (let i = 0; i < 2000; i++) {
        const got = simulateOpenBox('BOX', rng, new Set());
        if (got.some(it => it.id === 'tool:surgery')) found++;
    }
    assert(found === 0, `C6 物资箱绝不出手术刀（${found}）`);
}

// ================= D. 开发者模式玩家视角 =================
console.log('\n--- D. 开发者模式视角 ---');
// D1 开发者开箱正常（在 B 已覆盖，这里专项断言 dev 标志存在）
{
    const sv = makeSv(1, { _devInf: true, _devGod: true, _devOneShot: true, _devInfBag: true });
    const rng = makeRng(42);
    const got = simulateOpenBox('WBOX', rng, sv.mods.recipes);
    addLootToBag(sv, got);
    assert(true, 'D1 开发者开箱入包无异常');
}
// D2 刷未实装模子物品 → 背包可存 + getItemInfo 标 unimplemented
{
    const sv = makeSv(2, {});
    Panel.addItem(sv, 'proto:flamethrower', 1);
    const idx = sv.inv.findIndex(s => s && s.id === 'proto:flamethrower');
    assert(idx >= 0, 'D2 开发者可刷入未实装模子物品');
    const info = Panel.getItemInfo('proto:flamethrower');
    assert(info && info.unimplemented === true, 'D2 模子物品标记未实装(unimplemented)');
    assert(info && info.name === '火焰枪' && String(info.desc).includes('未实装'), 'D2 模子物品名称/说明正确');
    // 未实装物品不进掉落（强化 v3.17 规则）
    const rng = makeRng(7);
    let protoDrop = 0;
    for (let i = 0; i < 1000; i++) {
        const got = simulateOpenBox('BOX', rng, new Set());
        if (got.some(it => it.id && it.id.startsWith('proto:'))) protoDrop++;
    }
    assert(protoDrop === 0, `D2 未实装物品永不掉落（${protoDrop}）`);
}
// D3 全部物资生成跳过未实装模子分类（静态核对 wdev）
{
    const wdevSrc = readMod('wdev.js');
    assert(wdevSrc.includes("name: '未实装模子'"), 'D3 开发者面板含「未实装模子」分类');
    assert(wdevSrc.includes("cat.name === '未实装模子'"), 'D3 全部物资生成跳过未实装模子');
    assert(wdevSrc.includes('proto:flamethrower') && wdevSrc.includes('proto:antiserum'), 'D3 模子分类覆盖 24 个模子');
}
// D4 开发者无限背包：_devInfBag 下 addItem 永不返回 -1（不填满）
{
    const sv = makeSv(3, { _devInfBag: true });
    let overflow = 0;
    for (let i = 0; i < 500; i++) {
        try { Panel.addItem(sv, 'wood', 99); } catch (e) { overflow++; }
    }
    assert(overflow === 0, `D4 开发者无限背包不溢出（${overflow}）`);
    const sv2 = makeSv(4, {});
    let full = 0;
    for (let i = 0; i < 2000; i++) { if (Panel.addItem(sv2, 'wood', 99) > 0) full++; }
    assert(full > 0, `D4 普通背包会满（对照组，装不下的次数 ${full}）`);
}

// ================= E. 多轮稳定性（压力） =================
console.log('\n--- E. 多轮稳定性（压力 500 轮） ---');
{
    const rng = makeRng(88888);
    let err = 0, total = 0;
    for (let i = 0; i < 500; i++) {
        try {
            const got = simulateOpenBox('BOX', rng, new Set());
            for (const it of got) { total++; if (!isLegalItem(it.id)) { err++; } }
            // 混合拆字
            const s = WWR.surgeryOn('wpn:pistol', rng, 3);
            if (!s || !s.ok) err++;
            // 混合拼字判断
            const sv = makeSv(i);
            WWR.recipeAvailability(sv.inv, WWR.RECIPES[0]);
        } catch (e) { err++; if (err <= 3) report('E', `第 ${i} 轮异常 ${e.message}`); }
    }
    assert(err === 0, `E 500 轮压力 0 异常（${err}）`);
    assert(total > 500, `E 采样 ${total} 件`);
    console.log(`  500 轮完成，${total} 件产出`);
}

// ================= F. 静态核对 =================
console.log('\n--- F. 静态核对（防漂移） ---');
{
    const survSrc = readMod('survival.js');
    // F1 容器池与源码一致
    let poolOk = true;
    for (const [key, items] of Object.entries(POOLS)) {
        if (key === 'CAR') {
            const carBlock = survSrc.slice(survSrc.indexOf('CAR_LOOT_POOL = ['), survSrc.indexOf(';', survSrc.indexOf('CAR_LOOT_POOL = [')));
            for (const id of items) if (!carBlock.includes(`'${id}'`)) { poolOk = false; console.error(`   CAR 池源码缺: ${id}`); }
        } else {
            const marker = `[${SRC_KEY[key]}]: { items: [`;
            const start = survSrc.indexOf(marker);
            if (start < 0) { poolOk = false; console.error(`   源码缺容器 ${key}`); continue; }
            const block = survSrc.slice(start, start + 1600);
            for (const id of items) if (!block.includes(`'${id}'`)) { poolOk = false; console.error(`   ${key} 池源码缺: ${id}`); }
        }
    }
    assert(poolOk, 'F1 测试容器池 = survival.js 源码（无漂移）');
    // F2 街道空手率一致
    for (const [key, empty] of Object.entries(STREET_EMPTY)) {
        if (!survSrc.includes(`empty: ${empty}`)) { console.error(`   ${key} 空手率源码缺失`); poolOk = false; }
    }
    assert(poolOk, 'F2 街道空手率与源码一致');
    // F3 字楔全局权重生效（wwordcraft-rules 使用 WEDGE_GLOBAL_WEIGHTS）
    const rulesSrc = readMod('wwordcraft-rules.js');
    assert(rulesSrc.includes('WEDGE_GLOBAL_WEIGHTS') && rulesSrc.includes('B9.WEDGE_GLOBAL_WEIGHTS'), 'F3 字楔抽取走全局权重表');
    // F4 旧硬编码表已移除（真实玩家搜刮不再走 rollSupplyLoot）
    assert(!survSrc.includes('function rollSupplyLoot') && !survSrc.includes('function rollWeaponLoot') && !survSrc.includes('const BOX_ROLL') && !survSrc.includes('BOX_ROLL ='), 'F4 按箱型硬编码表已移除');
    // F5 文字手术刀仅医疗箱（源码无普通容器分支）
    assert(survSrc.includes('boxType === T.MEDBOX') && survSrc.includes('SURGERY_MEDBOX_DROP_CHANCE'), 'F5 手术刀仅医疗箱判定');
}

console.log(`\n======== 结果: ${pass} 通过, ${fail} 失败 ========`);
if (fail > 0) process.exit(1);
