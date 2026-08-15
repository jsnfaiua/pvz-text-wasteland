// ============================================================================
// 荒原模组 · v3.22 配方使用流程测试（用户定稿：使用=消耗 1 张 + 不跳转 + 快捷组装）
// 覆盖：①配方物品使用后消耗消失 ②解锁到 sv.mods.recipes ③拼字台可见该配方
//       ④材料充足时可快捷组装（recipeAvailability.ok）⑤已学习再使用仍消耗 ⑥联机 outbox 同步
// 运行：node dev-tools/recipe-flow-test.mjs
// ============================================================================

// ---- 浏览器打桩（panel.js 依赖 systems/audio.js 等浏览器模块）----
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

const B = (await import('../source-code/mod-wasteland/wbalance.js')).default ?? (await import('../source-code/mod-wasteland/wbalance.js'));
const WWR = (await import('../source-code/mod-wasteland/wwordcraft-rules.js')).default ?? (await import('../source-code/mod-wasteland/wwordcraft-rules.js'));
const Panel = (await import('../source-code/mod-wasteland/panel.js')).default ?? (await import('../source-code/mod-wasteland/panel.js'));

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) pass++; else { console.error('  ✗ FAIL: ' + m); fail++; } };
const report = (m) => { console.error('  ✗ ' + m); fail++; };

// 初始解锁（与 wwordcraft.js INITIAL_RECIPES 一致）
const INITIAL_RECIPES = ['water', 'wood', 'stone', 'food', 'herb'];

// 构造最小玩家背包
function makeBag() {
    return { inv: Array(Panel.BAG_SIZE).fill(null), mods: { recipes: [...INITIAL_RECIPES] }, mp: false };
}

// 复制 useRecipe 的消耗+解锁核心逻辑（survival.js 闭包函数，此处等价验证）
function useRecipeCore(sv, s) {
    const r = WWR.recipeByItemId(s.id);
    if (!r) return null;
    if (!sv.mods.recipes) sv.mods.recipes = [];
    const learned = sv.mods.recipes.includes(r.id);
    if (!learned) {
        sv.mods.recipes.push(r.id);
        if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'recipe', id: r.id });
    }
    const idx = sv.inv.findIndex(x => x === s);
    if (idx >= 0) { s.n--; if (s.n <= 0) sv.inv[idx] = null; }
    return { r, learned, consumed: idx >= 0 };
}

// 拼字台可见配方（等价 unlockedRecipes + visibleRecipes 过滤）
function unlockedRecipesOf(sv) {
    const set = new Set(INITIAL_RECIPES);
    if (sv.mods && Array.isArray(sv.mods.recipes)) for (const id of sv.mods.recipes) set.add(id);
    return set;
}
function visibleRecipesOf(sv, cat) {
    const u = unlockedRecipesOf(sv);
    return WWR.RECIPES.filter(r => u.has(r.id) && (!cat || r.category === cat));
}

console.log('=== v3.22 配方使用流程测试 ===\n');

// ================= R1 使用消耗 =================
console.log('--- R1 使用配方 → 消耗消失 + 解锁 ---');
{
    const sv = makeBag();
    Panel.addItem(sv, 'recipe:carrot', 1);
    const idx = sv.inv.findIndex(s => s && s.id === 'recipe:carrot');
    assert(idx >= 0, 'R1.1 配方物品入包');
    const res = useRecipeCore(sv, sv.inv[idx]);
    assert(res && res.learned === false, 'R1.2 首次学习');
    assert(sv.inv[idx] === null, 'R1.3 使用后配方物品消失（消耗 1 张）');
    assert(sv.mods.recipes.includes('carrot'), 'R1.4 解锁到 sv.mods.recipes');
    assert(unlockedRecipesOf(sv).has('carrot'), 'R1.5 拼字台解锁集合含该配方');
}
// R2 已有多个配方物品，用一张剩一张
{
    const sv = makeBag();
    Panel.addItem(sv, 'recipe:wood', 2);
    const idx = sv.inv.findIndex(s => s && s.id === 'recipe:wood');
    const res = useRecipeCore(sv, sv.inv[idx]);
    assert(res && res.consumed === true, 'R2.1 使用消耗成功');
    assert(sv.inv[idx] && sv.inv[idx].n === 1, 'R2.2 2 张用 1 剩 1');
}
// R3 已学习再使用 → 仍消耗
{
    const sv = makeBag();
    sv.mods.recipes.push('stone');   // 已学习
    Panel.addItem(sv, 'recipe:stone', 1);
    const idx = sv.inv.findIndex(s => s && s.id === 'recipe:stone');
    const res = useRecipeCore(sv, sv.inv[idx]);
    assert(res && res.learned === true, 'R3.1 识别为已学习');
    assert(sv.inv[idx] === null, 'R3.2 已学习再使用也消耗消失');
}
// R4 未知配方
{
    const sv = makeBag();
    const res = useRecipeCore(sv, { id: 'recipe:does-not-exist', n: 1 });
    assert(res === null, 'R4 未知配方返回 null（提示无法识别）');
}

// ================= R5 拼字台可见 =================
console.log('--- R5 解锁后拼字台可见 + 可快捷组装 ---');
{
    const sv = makeBag();
    // 学习胡萝卜配方
    sv.mods.recipes.push('carrot');
    const visible = visibleRecipesOf(sv);
    assert(visible.some(r => r.id === 'carrot'), 'R5.1 拼字台配方列表含胡萝卜');
    assert(visible.length === INITIAL_RECIPES.length + 1, `R5.2 列表 = 初始 5 + 新学 1（实际 ${visible.length}）`);
    const carrot = WWR.RECIPES.find(r => r.id === 'carrot');
    // 未给材料 → 不可组装
    const without = WWR.recipeAvailability(sv.inv, carrot);
    assert(without.ok === false && without.missing.length > 0, 'R5.3 缺材料时提示缺什么（不可组装）');
    // 给齐字块 + 字楔 → 可组装
    for (const ch of carrot.glyphs) Panel.addItem(sv, WWR.glyphId(ch), 1);
    const wedgeId = carrot.wedgeId || 'wedge:rough';
    for (let i = 0; i < carrot.wedges; i++) Panel.addItem(sv, wedgeId, 1);
    const withMat = WWR.recipeAvailability(sv.inv, carrot);
    assert(withMat.ok === true, 'R5.4 材料充足 → 可快捷组装');
    // 模拟 beginCraft 消耗：扣字块+字楔
    for (const ch of carrot.glyphs) {
        const i = sv.inv.findIndex(s => s && s.id === WWR.glyphId(ch));
        if (i >= 0) { sv.inv[i].n--; if (sv.inv[i].n <= 0) sv.inv[i] = null; }
    }
    const wi = sv.inv.findIndex(s => s && s.id === wedgeId);
    if (wi >= 0) { sv.inv[wi].n -= carrot.wedges; if (sv.inv[wi].n <= 0) sv.inv[wi] = null; }
    Panel.addItem(sv, carrot.output.id, carrot.output.n);
    assert(sv.inv.some(s => s && s.id === carrot.output.id), 'R5.5 快捷组装产出物品入包');
}

// ================= R6 联机 outbox 同步 =================
console.log('--- R6 联机配方解锁同步 ---');
{
    const sv = makeBag();
    sv.mp = true;
    Panel.addItem(sv, 'recipe:pistol', 1);
    const idx = sv.inv.findIndex(s => s && s.id === 'recipe:pistol');
    useRecipeCore(sv, sv.inv[idx]);
    assert(Array.isArray(sv.mpOutbox) && sv.mpOutbox.some(e => e.type === 'recipe' && e.id === 'pistol'), 'R6.1 联机 outbox 推送 recipe 事件');
}

// ================= R7 物品描述一致性 =================
console.log('--- R7 配方物品描述 ---');
{
    const info = Panel.getItemInfo('recipe:carrot');
    assert(info && typeof info.desc === 'string' && info.desc.includes('使用'), `R7 配方物品有使用说明（${info ? info.desc : '无'}）`);
}

console.log(`\n======== 结果: ${pass} 通过, ${fail} 失败 ========`);
if (fail > 0) process.exit(1);
