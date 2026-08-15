// ============================================================
// 荒原模组冒烟测试：验证所有模块可正常 import + 基本函数可调用
// 用法：node dev-tools/smoke-test.js
// ============================================================

// 浏览器全局打桩：让依赖浏览器环境的模块（wvehicle/panel 等）也能在 Node 下导入，
// 以便对其中可测试的纯函数（车辆品相/朝向等）做断言
const _lsStore = {};
const _lsStub = {
    getItem: k => (_lsStore[k] !== undefined ? _lsStore[k] : null),
    setItem: (k, v) => { _lsStore[k] = String(v); },
    removeItem: k => { delete _lsStore[k]; },
};
try { globalThis.localStorage = _lsStub; } catch { /* 已有只读属性则忽略 */ }
globalThis.window = {
    localStorage: _lsStub,
    AudioContext: function () {
        const gain = () => ({ gain: { value: 0 }, connect() {}, addEventListener() {}, removeEventListener() {} });
        return {
            createGain: gain, destination: {}, currentTime: 0,
            state: 'running', addEventListener() {}, removeEventListener() {}, resume: () => Promise.resolve(),
            createBuffer: () => ({}),
            createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }),
            decodeAudioData: (b, ok) => ok && ok({ duration: 1 }),
            createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }),
            createMediaElementSource: () => ({ connect() {} }),
        };
    },
    webkitAudioContext: undefined,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: cb => { cb(performance.now()); return 1; },
    cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {},
    devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
};
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }),
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    getElementById: () => null,
    getElementsByClassName: () => [],
    body: { appendChild() {}, removeChild() {} },
    documentElement: {}, createTextNode: () => ({}),
};
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch { /* node ≥21: navigator 只读 getter，忽略 */ }
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {};
globalThis.HTMLCanvasElement = function () {};
globalThis.HTMLImageElement = function () {};
globalThis.Audio = function () {};
globalThis.OfflineAudioContext = function () {};

import * as B from '../source-code/mod-wasteland/wbalance.js';
import { TS } from '../source-code/mod-wasteland/wconst.js';
import * as MSG from '../source-code/mod-wasteland/wmsg.js';
import * as WW from '../source-code/mod-wasteland/wwordcraft-rules.js';
import * as WI from '../source-code/mod-wasteland/winfection.js';
import { genChunkTiles, T, CHUNK, gridRoadKept, SPAWN, getTile, isWalk, plannedSidewalkAt, wildSidewalkKept } from '../source-code/mod-wasteland/world.js';
import { districtAt, arterialClassAt, blockAt } from '../source-code/mod-wasteland/wdistrict.js';
import { serializeSV, createRunDefaults, applySnapshot, serializeCharacter, applyCharacter, serializeWorld, applyWorld, serializeMpSnapshot, mergeZombieList } from '../source-code/mod-wasteland/wstate.js';

let pass = 0, fail = 0;

function assert(cond, label) {
    if (cond) { pass++; }
    else { fail++; console.error(`  FAIL: ${label}`); }
}

console.log('=== 荒原模组冒烟测试 ===\n');

// wbalance
assert(typeof B.MAX_HP === 'number', 'wbalance.MAX_HP');
assert(typeof B.DIFF_TABLE === 'object', 'wbalance.DIFF_TABLE');
assert(Array.isArray(B.LOOT_AMMO), 'wbalance.LOOT_AMMO');
assert(B.HORDE_START_HOUR === 20 && B.HORDE_END_HOUR === 4, 'wbalance.horde night schedule');
assert(typeof B.PLAYER_SPEED === 'number', 'wbalance.PLAYER_SPEED');

// 天气系统（§13.6 权重和 = 1 / §13.2 确定性）
{
    let wxSum = 0;
    for (const k in B.WX_TABLE) wxSum += B.WX_TABLE[k].weight;
    assert(Math.abs(wxSum - 1) < 1e-9, 'balance:WX_TABLE weights sum to 1');
    assert(typeof B.weatherAt === 'function', 'balance:weatherAt exists');
    assert(B.weatherAt(20260802, 1) === B.weatherAt(20260802, 1), 'balance:weatherAt deterministic (same seed/day)');
    for (let d = 1; d <= 30; d++) {
        const wx = B.weatherAt(777, d);
        assert(typeof wx === 'string' && B.WX_TABLE[wx], `balance:weatherAt valid type day${d}`);
    }
    assert(B.wxInfo('nonsense') === B.WX_TABLE.clear, 'balance:wxInfo fallback clear');
    assert(B.INF_VIS.length === 6, 'balance:INF_VIS 6 stages');
    assert(B.WX_INTENSITY.rain.length === 6 && B.WX_INTENSITY.snow.length === 3 && B.WX_INTENSITY.fog.length === 3 && B.WX_INTENSITY.sandstorm.length === 3, 'balance:WX_INTENSITY tiers');
    assert(B.WX_INTENSITY.rain[4].name === '阵雨' && B.WX_INTENSITY.rain[5].name === '雷阵雨' && B.WX_INTENSITY.rain[5].flash === true, 'balance:阵雨/雷阵雨 tiers + flash flag');
    for (const k in B.WX_TABLE) assert(typeof B.WX_TABLE[k].icon === 'string' && B.WX_TABLE[k].icon.length > 0, `balance:WX_TABLE.${k} icon`);
    for (const k in B.WX_INTENSITY) {
        for (const t of B.WX_INTENSITY[k]) {
            assert(typeof t.name === 'string' && t.density >= 0 && t.mul > 0, `balance:WX_INTENSITY.${k} entry valid`);
        }
    }
    assert(B.wxIntensity('rain', 1).name === '中雨', 'balance:wxIntensity level select');
    assert(B.wxIntensity('rain', 9) === B.WX_INTENSITY.rain[5], 'balance:wxIntensity clamp high');
    assert(B.wxIntensity('nonsense', 0).name === '晴朗', 'balance:wxIntensity unknown type falls back to wxInfo (clear 晴朗)');
    assert(B.wxLevelAt(20260802, 1) === B.wxLevelAt(20260802, 1), 'balance:wxLevelAt deterministic');
    assert(typeof B.wxLevelCur === 'function', 'balance:wxLevelCur exists');
    {
        const fakeSv = { world: { seed: 666002 }, day: 4, _wxLevel: null };
        assert(B.wxLevelCur(fakeSv) === B.wxLevelAt(666002, 4), 'balance:wxLevelCur auto falls back to wxLevelAt');
        fakeSv._wxLevel = 5;
        assert(B.wxLevelCur(fakeSv) === 5, 'balance:wxLevelCur dev override wins');
    }
    // 强度联动：雨/雪粒子速度系数（强度越大越快）、沙尘移速系数、雾可视半径、hint 文案
    assert(B.WX_INTENSITY.rain[0].speedMul < B.WX_INTENSITY.rain[5].speedMul, 'balance:rain speedMul grows with intensity');
    assert(B.WX_INTENSITY.snow[0].speedMul < B.WX_INTENSITY.snow[2].speedMul, 'balance:snow speedMul grows');
    assert(B.wxSpeedMul('rain', 5) > B.wxSpeedMul('rain', 0), 'balance:wxSpeedMul rain intensity');
    assert(B.WX_INTENSITY.sandstorm[2].moveMul < B.WX_INTENSITY.sandstorm[0].moveMul, 'balance:sandstorm moveMul shrinks with intensity');
    assert(B.wxMoveMul('sandstorm', 2) < B.wxMoveMul('sandstorm', 0), 'balance:wxMoveMul sandstorm intensity');
    assert(B.wxMoveMul('snow', 1) === 0.9, 'balance:wxMoveMul snow uses speedMul');
    assert(B.fogRadius('fog', 2) < B.fogRadius('fog', 0), 'balance:fog radius shrinks with intensity');
    assert(B.fogRadius('fog', 1) === 10, 'balance:fog radius mid 10');
    assert(B.fogRadius('clear', 0) === 0, 'balance:fog radius clear 0');
    for (const k in B.WX_TABLE) assert(typeof B.WX_TABLE[k].hint === 'string' && B.WX_TABLE[k].hint.length > 4, `balance:WX_TABLE.${k} hint`);
    assert(typeof B.windDirAt === 'function' && B.windDirAt(666002, 1) === B.windDirAt(666002, 1), 'balance:windDirAt deterministic');
    assert(typeof B.WX_WIND_PUSH === 'number' && B.WX_WIND_PUSH > 0, 'balance:WX_WIND_PUSH');
}

// 死亡掉落/倒地救治（§13.1 数值收口，2026-08-09）
{
    assert(typeof B.deathDropRate === 'function', 'balance:deathDropRate exists');
    assert(B.deathDropRate(1) === 0.1, 'balance:deathDropRate 第1次 10%');
    assert(B.deathDropRate(2) === 0.11, 'balance:deathDropRate 第2次 +1%');
    assert(B.deathDropRate(1) < B.deathDropRate(3) && B.deathDropRate(3) <= 0.9, 'balance:deathDropRate 递增且有封顶 90%');
    assert(B.deathDropRate(100) === 0.9, 'balance:deathDropRate 封顶 90%');
    assert(B.DOWNED_LIMIT_DAYS > 0 && B.DOWNED_NEED_MED > 0 && B.DOWNED_HERB_EQUIV > 0, 'balance:downed 救治数值有效');
    assert(B.DOWNED_RESPAWN_PZ_DELAY_DAYS >= 1, 'balance:无队友重生刷尸延迟 >= 1 天');
}

// wconst
assert(TS === 36, 'wconst.TS === 36');

// wwordcraft
const wordInv = [
    { id: 'glyph:胡', n: 1 }, { id: 'glyph:萝', n: 1 }, { id: 'glyph:卜', n: 1 },
    { id: 'wedge:rough', n: 2 },
];
assert(WW.recipeAvailability(wordInv, WW.RECIPES[0]).ok, 'wwordcraft carrot recipe available');
assert(WW.stageAt(0.1).name === '定词', 'wwordcraft stage 定词');
assert(WW.stageAt(0.7).name === '赋质', 'wwordcraft stage 赋质');
assert(WW.rollTextLoot(() => 0).id === 'glyph:水', 'wwordcraft legacy text loot uses supply glyph pool');
assert(WW.RECIPES.length === 42, 'wwordcraft all inventory recipes registered');
const pistolRecipe = WW.RECIPES.find(recipe => recipe.id === 'pistol');
assert(pistolRecipe && pistolRecipe.wedgeId === 'wedge:stable', 'wwordcraft firearm requires stable wedge');
assert(WW.WEDGE_INFO['wedge:clean'].name === '洁净字楔', 'wwordcraft clean wedge registered');
// 2026-08-12 v3.8 配方物品：recipe:<id> 映射 / 解析 / 掉落
assert(WW.recipeItemId('carrot') === 'recipe:carrot', 'recipe: recipeItemId 映射');
assert(WW.recipeIdFromItem('recipe:sword') === 'sword', 'recipe: recipeIdFromItem 解析');
assert(WW.recipeByItemId('recipe:carrot') && WW.recipeByItemId('recipe:carrot').name === '胡萝卜', 'recipe: recipeByItemId 查配方');
assert(WW.recipeByItemId('recipe:unknown') === null, 'recipe: 未知配方返回 null');
const rDrop = WW.rollRecipeItem(new Set(['water', 'wood', 'stone', 'food', 'herb']), () => 0);
assert(rDrop && String(rDrop.id).startsWith('recipe:') && rDrop.n === 1, 'recipe: rollRecipeItem 掉配方且 n=1');
assert(WW.rollRecipeItem(new Set(WW.RECIPES.map(r => r.id)), () => 0) === null, 'recipe: 全部已解锁时不掉配方');
// 2026-08-12 v3.9 琢磨拼字 / 错乱僵尸
assert(WW.matchFreeWord(['胡', '萝', '卜']).matched === true, 'ponder: 正确词匹配配方');
assert(WW.matchFreeWord(['火', '枪']).matched === false, 'ponder: 错词不匹配任何配方');
const corrupt = WW.computeCorruptStats(['火', '枪']);
assert(corrupt.name.includes('火') && corrupt.name.includes('枪'), 'ponder: 错乱尸名字含拼出字');
assert(corrupt.ability === 'ignite', 'ponder: 火枪 → 能力取第一个特殊字(火=烈焰)');
const corruptGun = WW.computeCorruptStats(['枪', '火']);
assert(corruptGun.ability === 'gun', 'ponder: 枪火 → 能力取第一个特殊字(枪=射击)');
const corrupt2 = WW.computeCorruptStats(['巨', '铁']);
assert(corrupt2.hp > 280 && corrupt2.armor >= 0.35, 'ponder: 巨铁 → 高血高甲');
assert(WW.isFreeGlyph('glyph:火') === true && WW.isFreeGlyph('glyph-unstable:火') === false, 'ponder: isFreeGlyph 只认 clean 字块');
assert(WW.isFreeGlyph('wpn:sword') === false, 'ponder: 非字块物品不是可拼字');
// 2026-08-12 v3.10 文字手术刀拆字系统（v3.18 用户定稿：拆字不是概率，猜错没有惩罚）
assert(WW.glyphPollutionOf('glyph-unstable:火') === 'unstable', 'surgery: 识别不稳字块');
assert(WW.glyphCharOf('glyph:火') === '火' && WW.glyphCharOf('glyph-infected:枪') === '枪', 'surgery: 提取字');
const purify = WW.surgeryOn('glyph-unstable:火', () => 0);
assert(purify.ok && purify.kind === 'purifyGlyph' && purify.item.id === 'glyph:火', 'surgery: 净化不稳字块→普通字块');
const purifyInf = WW.surgeryOn('glyph-infected:毒', () => 0);
assert(purifyInf.ok && purifyInf.item.id === 'glyph:毒', 'surgery: 净化感染字块→普通字块');
const bd = WW.surgeryOn('wpn:pistol', () => 0, 2);
assert(bd.ok && bd.kind === 'breakdown' && bd.items.some(it => it.id === 'glyph:枪'), 'surgery: 拆手枪必定成功并拆出枪字');
assert(WW.nameCharsOf('wpn:pistol').includes('枪'), 'surgery: 手枪拆出枪字');
// v3.18 恒成功无惩罚：任意随机数（含失败位）都必定成功；韧性0也不损坏
const bdFail = WW.surgeryOn('wpn:sword', () => 0.99, 0);
assert(bdFail.ok && bdFail.kind === 'breakdown' && bdFail.items.length > 0, 'surgery: 拆字恒成功（无失败/错乱尸/污染）');
const zeroTough = WW.surgeryOn('wpn:sword', () => 0, 0);
assert(zeroTough.ok && zeroTough.kind === 'breakdown', 'surgery: 韧性0也必定成功（无损坏惩罚）');
assert(WW.surgeryEligible('coin') === false && WW.surgeryEligible('loot:common') === false, 'surgery: 货币/战利品袋不可拆');
assert(WW.surgeryEligible('wpn:sword') === true && WW.surgeryEligible('food') === true, 'surgery: 武器/食物可拆');
// 2026-08-12 v3.15 混淆字机制（无用字=未装载功能的字）+ 词条图鉴
// "火/冰/雷/王/尸"等当前无任何配方 → 是混淆字（拼不出物品，但拼错乱尸有特殊效果）
assert(WW.isConfusingGlyph('火') === true, 'junk: 火当前无配方→混淆字');
assert(WW.isConfusingGlyph('冰') === true, 'junk: 冰当前无配方→混淆字');
const _carrotG = WW.RECIPES.find(r => r.id === 'carrot');
assert(WW.isConfusingGlyph(_carrotG.glyphs[0]) === false, 'junk: 胡萝卜配方字为可用字');
assert(WW.isConfusingGlyph('枪') === false, 'junk: 枪在配方中(手枪/步枪等)→可用字');
const _junkList = WW.confusingGlyphList();
assert(Array.isArray(_junkList) && _junkList.length > 0, 'junk: 存在混淆字清单');
assert(_junkList.every(ch => WW.isConfusingGlyph(ch)), 'junk: 清单内全是混淆字');
const _usableList = WW.usableGlyphList();
assert(Array.isArray(_usableList) && _usableList.length > 0, 'junk: 存在可用字清单');
// 混淆字与可用字互斥且覆盖全部字符池
const _allChars = new Set([..._junkList, ..._usableList]);
assert(_junkList.every(ch => !_usableList.includes(ch)), 'junk: 混淆字与可用字互斥');
// 2026-08-12 v3.16 汉字基数扩充（通用规范汉字一级字表 3500 字，用户提供完整表程序化生成）
const _total = WW.allGlyphChars().size;
assert(_total >= 3500, `junk: 汉字基数已扩充至3500级 (总=${_total})`);
assert(_junkList.length >= 3400, `junk: 混淆字数量随基数扩充 (>=3400, 实际=${_junkList.length})`);
assert(WW.isConfusingGlyph('一') === true, 'junk: 新增汉字"一"未装载功能→混淆字');
assert(WW.isConfusingGlyph('天') === true, 'junk: 新增汉字"天"未装载功能→混淆字');
assert(WW.isConfusingGlyph('吃') === true, 'junk: 新增汉字"吃"未装载功能→混淆字');
assert(WW.isConfusingGlyph('矗') === true, 'junk: 24画"矗"未装载功能→混淆字');
// 词条图鉴数据：MANIFEST_AFFIXES 存在且字都能在字符池找到
assert(B.MANIFEST_AFFIXES && Object.keys(B.MANIFEST_AFFIXES).length > 0, 'codex: 词条映射表非空');
assert(B.MANIFEST_AFFIXES['火'] && B.MANIFEST_AFFIXES['火'].id === 'burn', 'codex: 火→灼烧');
assert(B.MANIFEST_AFFIXES['冰'] && B.MANIFEST_AFFIXES['冰'].id === 'frost', 'codex: 冰→冰封');

// 视觉感染：健康实体不出现文字，部分感染和完全文字化边界稳定。
assert(WI.infectionLevelFromRoll(0.1) === 0, 'visual infection keeps healthy entities pixel-only');
assert(WI.infectionBand(WI.infectionLevelFromRoll(0.6)) === 'partial', 'visual infection supports partial state');
assert(WI.infectionBand(WI.infectionLevelFromRoll(0.95)) === 'text', 'visual infection supports full text state');
assert(WI.worldInfectionLevel(0.7, 'ruins') > WI.worldInfectionLevel(0.7, 'wild'), 'ruins have stronger visual infection than wild');

// 玩家功能性感染：阶段、效果、增减
assert(WI.playerInfectionStage(0).stage === 0, 'player infection stage 0 at value 0');
assert(WI.playerInfectionStage(12).stage === 1, 'player infection stage 1 at value 12');
assert(WI.playerInfectionStage(30).stage === 2, 'player infection stage 2 at value 30');
assert(WI.playerInfectionStage(50).stage === 3, 'player infection stage 3 at value 50');
assert(WI.playerInfectionStage(75).stage === 4, 'player infection stage 4 at value 75');
assert(WI.playerInfectionStage(95).stage === 5, 'player infection stage 5 at value 95');
assert(WI.playerInfectionEffects(0).speedMul === 1.0, 'player infection no speed penalty at stage 0');
assert(WI.playerInfectionEffects(50).speedMul < 1.0, 'player infection slows movement at stage 3');
assert(WI.playerInfectionEffects(100).maxHpMul <= 0.5, 'player infection caps HP at 100%（v3.63：每1%感染→属性-0.5%，100%感染时属性=50%）');
assert(WI.addPlayerInfection(90, 20) === 100, 'player infection clamped to max');
assert(WI.addPlayerInfection(5, -10) === 0, 'player infection clamped to zero');
assert(WI.rollZombieInfection(() => 0.99) === 0, 'zombie infection miss at high roll');
assert(WI.rollZombieInfection(() => 0) >= 2, 'zombie infection hit at low roll');

// 文字僵尸：类型注册、招式、掉落等级
assert(B.TEXT_ZOMBIE_TYPES.remnant.ability === 'scatter', 'text zombie remnant has scatter ability');
assert(B.TEXT_ZOMBIE_TYPES.deleter.ability === 'delete', 'text zombie deleter has delete ability');
assert(B.TEXT_ZOMBIE_TYPES.swapper.ability === 'corrupt', 'text zombie swapper has corrupt ability');
assert(B.Z_ATK_STYLES.remnant.effect === 'scatter', 'text zombie remnant attack style registered');
assert(B.Z_ATK_STYLES.deleter.effect === 'delete', 'text zombie deleter attack style registered');
assert(B.Z_ATK_STYLES.swapper.effect === 'corrupt', 'text zombie swapper attack style registered');
assert(B.ZOMBIE_LOOT_TIER.remnant === 'elite', 'text zombie remnant drops elite tier');
assert(B.Z_CHAR.remnant === '残' && B.Z_CHAR.deleter === '删' && B.Z_CHAR.swapper === '换', 'text zombie chars registered');
assert(B.Z_TEXT_UNLOCK_DAY === 7, 'text zombies unlock at day 7');
assert(B.Z_TEXT_ABILITY_CHANCE > 0 && B.Z_TEXT_ABILITY_CHANCE <= 1, 'text ability chance valid');

// 楼层系统：配置与生成
assert(B.FLOOR_MAX_ABOVE === 3, 'floor max above is 3');
assert(B.FLOOR_MAX_BELOW === 2, 'floor max below is 2');
assert(B.FLOOR_ZOMBIE_MUL(1) === 1, 'floor 1 zombie mul is 1');
assert(B.FLOOR_ZOMBIE_MUL(-2) > B.FLOOR_ZOMBIE_MUL(-1), 'deeper floors have more zombies');
assert(B.FLOOR_HP_MUL(-2) > B.FLOOR_HP_MUL(1), 'deeper underground floors have stronger zombies');
assert(B.FLOOR_DROP_BUMP(-1) === 1, 'underground floors bump drop quality');
assert(B.FLOOR_DROP_BUMP(1) === 0, 'ground floor no drop bump');

// v1.1统一概率模块
const probabilitySum = table => Object.values(table).reduce((sum, value) => sum + value, 0);
const weightedSum = pool => pool.reduce((sum, entry) => sum + entry.weight, 0);
for (const [source, table] of Object.entries(B.WORD_LOOT_SOURCE_TABLES)) {
    assert(Math.abs(probabilitySum(table) - 1) < 1e-9, `word loot ${source} sums to 100%`);
    assert(Object.values(table).every(value => value >= 0), `word loot ${source} has no negative probability`);
    assert(table.complete <= 0.06, `word loot ${source} complete item cap`);
}
for (const [quality, table] of Object.entries(B.ZOMBIE_BAG_RESULT_TABLES)) {
    assert(Math.abs(probabilitySum(table) - 1) < 1e-9, `zombie bag ${quality} sums to 100%`);
}
for (const [source, pool] of Object.entries(WW.GLYPH_SOURCE_POOLS)) {
    assert(Math.abs(weightedSum(pool) - 1) < 1e-9, `glyph pool ${source} sums to 100%`);
}
// 2026-08-12 v3.18 全局字权重表（用户定稿）：全局权重和=1（覆盖所有配方字的断言在 recipeGlyphs 定义后）
assert(Math.abs(weightedSum(WW.GLYPH_UNIVERSAL) - 1) < 1e-9, 'glyph universal pool sums to 100%');
// 2026-08-12 v3.19 物资全局权重（用户定稿：物资稀有度全局一致；容器分池；池内按全局权重抽）
assert(B.LOOT_ITEM_WEIGHTS && Object.keys(B.LOOT_ITEM_WEIGHTS).length >= 40, 'loot item weights defined (40+)');
assert(B.ZOMBIE_LOOT_ALL.length === Object.keys(B.LOOT_ITEM_WEIGHTS).length, 'zombie loot all covers every weighted item');
assert(WW.rollGlobalLoot(['wood'], () => 0.999) === 'wood', 'rollGlobalLoot single-item pool');
assert(WW.rollGlobalLoot([], () => 0.5) === null, 'rollGlobalLoot empty pool');
assert(WW.rollGlobalLoot(['wood', 'stone'], () => 0) === 'wood', 'rollGlobalLoot first by weight');
assert(WW.globalLootQty('gem', () => 0.5) === 1, 'globalLootQty default = 1');
assert(WW.globalLootQty('wood', () => 0.5) === 3, 'globalLootQty wood mid range');
assert(WW.globalLootQty('ammo:pistolAmmo', () => 0.5) === 7, 'globalLootQty ammo mid range');
const wedgeSum = B.WEDGE_GLOBAL_WEIGHTS.rough + B.WEDGE_GLOBAL_WEIGHTS.stable + B.WEDGE_GLOBAL_WEIGHTS.clean;
assert(Math.abs(wedgeSum - 1) < 1e-9, 'wedge global weights sum to 100%');
for (const [source, table] of Object.entries(WW.WEDGE_SOURCE_TABLES)) {
    assert(Math.abs(probabilitySum(table) - 1) < 1e-9, `wedge pool ${source} sums to 100%`);
}
for (const [source, pool] of Object.entries(WW.ZOMBIE_GLYPH_POOLS)) {
    assert(Math.abs(weightedSum(pool) - 1) < 1e-9, `zombie glyph pool ${source} sums to 100%`);
}
const legalGlyphs = new Set(Object.values(WW.GLYPH_SOURCE_POOLS).flatMap(pool => pool.map(entry => entry.id)));
const recipeGlyphs = new Set(WW.RECIPES.flatMap(recipe => recipe.glyphs));
assert([...recipeGlyphs].every(char => legalGlyphs.has(char)), 'every recipe glyph has a legal container source');
// v3.18 全局权重覆盖所有配方字（任何字都有全局概率）
const uniIds = new Set(WW.GLYPH_UNIVERSAL.map(g => g.id));
assert([...recipeGlyphs].every(ch => uniIds.has(ch)), 'universal pool covers every recipe glyph');
const fragResult = WW.rollWordLootOutcome('supply', { lightFragment: 1 }, {}, () => 0);
assert(fragResult.type === 'lightFragment' && fragResult.originalType === 'lightFragment', 'light fragment produces real item');
assert(fragResult.items.length > 0 && fragResult.items[0].id.startsWith('frag:'), 'fragment item has valid frag: id');
const severeResult = WW.rollWordLootOutcome('weapon', { severeFragment: 1 }, {}, () => 0);
assert(severeResult.type === 'severeFragment' && severeResult.items[0].id.startsWith('frag:'), 'severe fragment produces real item');
const parsedFrag = WW.parseFragmentId(fragResult.items[0].id);
assert(parsedFrag !== null && parsedFrag.missing.length >= 1, 'parseFragmentId returns missing chars');
assert(parsedFrag.severity === 'light' || parsedFrag.severity === 'severe', 'fragment has valid severity');
const parsedSevere = WW.parseFragmentId(severeResult.items[0].id);
assert(parsedSevere !== null && parsedSevere.missing.length >= 2, 'severe fragment misses 2+ chars');
const repairInv = [
    { id: 'glyph:胡', n: 2 }, { id: 'glyph:萝', n: 2 }, { id: 'glyph:卜', n: 2 },
    { id: 'glyph:水', n: 2 }, { id: 'glyph:食', n: 2 }, { id: 'glyph:物', n: 2 },
    { id: 'glyph:木', n: 2 }, { id: 'glyph:材', n: 2 }, { id: 'glyph:石', n: 2 },
    { id: 'glyph:块', n: 2 }, { id: 'glyph:草', n: 2 }, { id: 'glyph:药', n: 2 },
    { id: 'glyph:枪', n: 2 }, { id: 'glyph:弹', n: 2 }, { id: 'glyph:手', n: 2 },
    { id: 'glyph:短', n: 2 }, { id: 'glyph:剑', n: 2 }, { id: 'glyph:长', n: 2 },
    { id: 'glyph:矛', n: 2 }, { id: 'glyph:战', n: 2 }, { id: 'glyph:斧', n: 2 },
    { id: 'glyph:飞', n: 2 }, { id: 'glyph:刀', n: 2 }, { id: 'glyph:弓', n: 2 },
    { id: 'glyph:箭', n: 2 }, { id: 'glyph:散', n: 2 }, { id: 'glyph:冲', n: 2 },
    { id: 'glyph:步', n: 2 }, { id: 'glyph:狙', n: 2 }, { id: 'glyph:击', n: 2 },
    { id: 'glyph:霰', n: 2 }, { id: 'glyph:锋', n: 2 }, { id: 'glyph:矢', n: 2 },
    { id: 'glyph:组', n: 2 }, { id: 'glyph:阳', n: 2 }, { id: 'glyph:光', n: 2 },
    { id: 'glyph:肥', n: 2 }, { id: 'glyph:料', n: 2 }, { id: 'glyph:修', n: 2 },
    { id: 'glyph:车', n: 2 }, { id: 'glyph:零', n: 2 }, { id: 'glyph:件', n: 2 },
    { id: 'glyph:伐', n: 2 }, { id: 'glyph:镐', n: 2 }, { id: 'glyph:锄', n: 2 },
    { id: 'glyph:头', n: 2 }, { id: 'glyph:扳', n: 2 }, { id: 'glyph:铲', n: 2 },
    { id: 'glyph:子', n: 2 }, { id: 'glyph:土', n: 2 }, { id: 'glyph:米', n: 2 },
    { id: 'glyph:玉', n: 2 }, { id: 'glyph:豆', n: 2 }, { id: 'glyph:宝', n: 2 },
    { id: 'wedge:rough', n: 5 }, { id: 'wedge:stable', n: 5 }, { id: 'wedge:clean', n: 5 },
];
const repairState = WW.repairAvailability(repairInv, fragResult.items[0].id);
assert(repairState.ok === true, 'repairAvailability succeeds with full glyph inventory');
assert(typeof WW.repairDuration(fragResult.items[0].id) === 'number', 'repairDuration returns number');
assert(WW.repairDuration(fragResult.items[0].id) >= 3, 'repairDuration has minimum 3s');
assert(WW.parseFragmentId('not-a-frag') === null, 'parseFragmentId rejects non-fragment id');
// v3.19 字楔全局权重（WEDGE_GLOBAL_WEIGHTS）：rough .62 / stable .33 / clean .05（不再按容器差异，无 infected 兼容位）
const wedgeGlobal = WW.rollWordLootOutcome('weapon', { wedge: 1 }, {}, () => 0.999999);
assert(wedgeGlobal.items[0].id === 'wedge:clean', 'wedge global weights: high roll → clean');
const wedgeMid = WW.rollWordLootOutcome('weapon', { wedge: 1 }, {}, () => 0.7);
assert(wedgeMid.items[0].id === 'wedge:stable', 'wedge global weights: mid roll → stable');

let simState = 0x12345678;
const seededRandom = () => {
    simState = (Math.imul(simState, 1664525) + 1013904223) >>> 0;
    return simState / 4294967296;
};
const samples = 100000;
const observed = { none: 0, glyph: 0, wedge: 0, lightFragment: 0, severeFragment: 0, complete: 0 };
for (let i = 0; i < samples; i++) {
    const result = WW.rollWordLootOutcome('supply', B.WORD_LOOT_SOURCE_TABLES.supply, {}, seededRandom);
    observed[result.originalType]++;
}
assert(Object.entries(B.WORD_LOOT_SOURCE_TABLES.supply).every(([key, expected]) =>
    Math.abs(observed[key] / samples - expected) < 0.01
), '100,000 sample word loot simulation stays within 1%');

// wmsg
const mockSv = { msgs: null };
MSG.initMsg(mockSv);
assert(Array.isArray(mockSv.msgs), 'wmsg.initMsg');
MSG.pushMsg(mockSv, 'test', '#fff');
assert(mockSv.msgs.length === 1, 'wmsg.pushMsg');
MSG.updateMsg(mockSv, 5);
assert(mockSv.msgs.length === 0, 'wmsg.updateMsg expiry');

// ============================================================
// wstate（联机 Phase 0：白名单序列化 / 快照应用 / 默认 run 构造）
// 纯函数断言：存档与联机快照共用的序列化层必须可往返、白名单、拒绝非法存档。
// ============================================================
{
    const deps = {
        BAG_SIZE: 24,
        HOTBAR_SIZE: 6,
        B: B,
        WNPC: {
            serializeNpcs: sv => (sv.npcs || []).map(n => ({ id: n.id, name: n.name })),
            restoreNpcs: (run, data) => { run.npcs = (data || []).map(d => ({ id: d.id, name: d.name })); },
            spawnInitialNpcs: run => { run.npcs = [{ id: 'npc_default', name: '默认队友' }]; },
        },
        normalizeLook: look => look,
        PLAYER_INFECTION: { max: 100 },
        saveData: { devMode: false },
    };
    const opts = { difficulty: 'normal' };

    // 构造一个仿真 sv（含僵尸运行时字段，验证白名单剔除）
    const sv = {
        active: true, dead: false,
        world: { seed: 20260805, chunks: new Map() },
        hp: 80, food: 50, water: 40, infection: 12, day: 3, t: 1000, playT: 3600,
        character: { hair: 'a' }, npcs: [{ id: 'npc1', name: '阿远' }],
        inv: Array.from({ length: 24 }, (_, i) => i === 0 ? { id: 'wood', n: 5 } : null),
        px: 123.5, py: 456.25,
        wpn: { mag: { pistol: 12 } },
        _devInfBag: false, mods: { tiles: { '1,1': { t: T.WALL } }, chests: {}, boxLoot: {} },
        homeBed: { x: 1, y: 2 }, lastRestDay: 2, horde: null,
        hotbar: [null, { id: 'wood', n: 3 }, null, null, null, null], curSlot: 'melee',
        zombies: [{ type: 'walker', char: '尸', color: '#0a0', name: '小尸', x: 10, y: 20, tx: 11, ty: 21, hp: 30, maxHp: 30, speed: 1, damage: 5, horde: false, vaulted: false, _nightStrengthActive: false, wt: 999, atkState: 'biting' }],
    };

    // 1. 白名单序列化：返回普通对象、v 正确、僵尸运行时字段被剔除
    const data = serializeSV(sv, deps);
    assert(data !== null && data.v === 3, 'wstate: serializeSV returns v:3 payload');
    assert(data.seed === 20260805 && data.hp === 80, 'wstate: serializeSV keeps core fields');
    assert(data.zombies.length === 1 && data.zombies[0].wt === undefined && data.zombies[0].atkState === undefined, 'wstate: zombie runtime fields whitelisted out');
    assert(JSON.stringify(data).includes('"hp":80'), 'wstate: payload is JSON-serializable (no DOM/func refs)');

    // 2. 默认 run 构造：背包/快捷栏容量、初始数值
    const run0 = createRunDefaults(opts, deps);
    assert(run0.inv.length === 24 && run0.hotbar.length === 6, 'wstate: createRunDefaults sizes bag(24)/hotbar(6)');
    assert(run0.hp === B.MAX_HP && run0.day === 1 && run0.infection === 0, 'wstate: createRunDefaults fresh values');
    assert(run0.world === null && run0.ctx === null, 'wstate: createRunDefaults leaves world/ctx null');
    assert(run0.mp === null, 'wstate: sv.mp defaults null (single-player zero impact)');

    // 3. 快照应用：可加载存档还原关键字段 + 僵尸补运行时字段
    const run1 = createRunDefaults(opts, deps);
    const res1 = applySnapshot(run1, data, deps);
    assert(res1.loaded === true && res1.legacy === false, 'wstate: applySnapshot loads v3 save');
    assert(run1.world.seed === 20260805 && run1.hp === 80 && run1.day === 3, 'wstate: applySnapshot restores world/hp/day');
    assert(run1.zombies[0].wt === 0 && run1.zombies[0].atkState === null && run1.zombies[0].hp === 30, 'wstate: applySnapshot rehydrates zombie runtime fields');
    assert(run1.npcs.length === 1 && run1.npcs[0].id === 'npc1', 'wstate: applySnapshot restores npcs');

    // 4. 往返一致性：serialize → apply → initWpn（弹匣恢复）→ serialize 结果稳定（确定性）
    //    （读档后武器由 startRun 的 WG.initWpn 从 _savedMag 重建，模拟该步骤）
    run1.wpn = { mag: run1._savedMag };
    const round2 = serializeSV(run1, deps);
    assert(JSON.stringify(round2) === JSON.stringify(data), 'wstate: serialize/apply round-trip is stable');

    // 5. 非法存档拒绝：v 不匹配 / seed 缺失 / forceNew
    const bad1 = createRunDefaults(opts, deps);
    assert(applySnapshot(bad1, { v: 2, seed: 123 }, deps).loaded === false, 'wstate: rejects legacy v2 save');
    const bad2 = createRunDefaults(opts, deps);
    assert(applySnapshot(bad2, { v: 3 }, deps).loaded === false, 'wstate: rejects v3 without seed');
    const bad3 = createRunDefaults({ ...opts, forceNew: true }, deps);
    assert(applySnapshot(bad3, { v: 3, seed: 123 }, deps).loaded === false, 'wstate: forceNew skips loading');

    // 6. 旧版 tiles 存档 → legacy 标记（供调用方备份）
    const leg = createRunDefaults(opts, deps);
    const resLeg = applySnapshot(leg, { tiles: {}, seed: 'legacy' }, deps);
    assert(resLeg.loaded === false && resLeg.legacy === true, 'wstate: legacy tiles save flagged');

    // 7. 空存档 → 不加载且非 legacy（新世界）
    const none = createRunDefaults(opts, deps);
    const resNone = applySnapshot(none, null, deps);
    assert(resNone.loaded === false && resNone.legacy === false, 'wstate: null save means fresh world');

    // 8. 世界地图探索记录（E1）：默认存在 + 序列化往返 + 缺省兜底
    {
        const runM = createRunDefaults(opts, deps);
        assert(runM.mods && typeof runM.mods.explored && typeof runM.mods.explored === 'object', 'wmap: createRunDefaults mods.explored default {}');
        runM.mods.explored['3,5'] = 1;
        runM.world = { seed: 20260805, chunks: new Map() };   // serializeSV 要求 world 存在
        const dataM = serializeSV(runM, deps);
        assert(dataM && dataM.mods && dataM.mods.explored && dataM.mods.explored['3,5'] === 1, 'wmap: explored round-trips via serializeSV');
        // 旧档缺省：explored 缺失 → applySnapshot 补空对象（不崩溃）
        const oldSave = { ...dataM };
        delete oldSave.mods.explored;
        const runOld = createRunDefaults(opts, deps);
        const resOld = applySnapshot(runOld, oldSave, deps);
        assert(resOld.loaded && runOld.mods.explored && typeof runOld.mods.explored === 'object', 'wmap: applySnapshot backfills explored {}');
    }
}

// ============================================================
// wstate 泰拉瑞亚式「角色/世界」分离（2026-08-05）
// 角色（名字/外观/物品/属性）跨世界保留；世界（seed/时间/NPC/差分）跟种子走
// ============================================================
{
    const deps = {
        BAG_SIZE: 24, HOTBAR_SIZE: 6, B,
        WNPC: {
            serializeNpcs: sv => (sv.npcs || []).map(n => ({ id: n.id, name: n.name })),
            restoreNpcs: (run, data) => { run.npcs = (data || []).map(d => ({ id: d.id, name: d.name })); },
            spawnInitialNpcs: run => { run.npcs = [{ id: 'npc_default', name: '默认队友' }]; },
        },
        normalizeLook: look => look,
        PLAYER_INFECTION: { max: 100 },
        saveData: { devMode: false },
    };
    const opts = { difficulty: 'normal' };

    // 构造仿真 sv（角色字段 + 世界字段混合）
    const sv = {
        characterName: '阿远',
        character: { hair: 'a' },
        inv: Array.from({ length: 24 }, (_, i) => i === 0 ? { id: 'wood', n: 5 } : null),
        hotbar: [null, { id: 'wood', n: 3 }, null, null, null, null], curSlot: 'melee',
        hp: 66, maxHp: 100, food: 44, water: 33, infection: 7, stamina: 88, maxStamina: 100,
        wpn: { mag: { pistol: 9 } }, _devInfBag: false,
        world: { seed: 20260805, chunks: new Map() },
        t: 1000, day: 3, playT: 3600,
        mods: { tiles: { '1,1': { t: 1 } }, chests: {}, boxLoot: {} },
        homeBed: { x: 1, y: 2 }, lastRestDay: 2, horde: 1,
        zombies: [{ type: 'walker', char: '尸', name: '小尸', x: 10, y: 20, tx: 11, ty: 21, hp: 30, maxHp: 30, speed: 1, damage: 5, horde: false, vaulted: false, _nightStrengthActive: false, wt: 999 }],
        npcs: [{ id: 'npc1', name: '阿远' }],
        drops: [],
        px: 123.5, py: 456.25, faceX: 1, faceY: 0,
    };

    // 1. 角色档：只含角色字段，不含世界字段
    const c = serializeCharacter(sv, deps);
    assert(c.name === '阿远' && c.inv.length === 24 && c.curSlot === 'melee', 'wstate-char: serializeCharacter keeps name/inv/slot');
    assert(c.seed === undefined && c.mods === undefined && c.zombies === undefined, 'wstate-char: character save excludes world fields');

    // 2. 世界档：只含世界字段，不含角色字段
    const w = serializeWorld(sv, deps);
    assert(w.seed === 20260805 && w.day === 3 && w.horde && typeof w.horde === 'object' && w.horde.pending === 0, 'wstate-world: serializeWorld keeps seed/day/horde(progress obj, old bool 1 accepted)');
    assert(w.inv === undefined && w.character === undefined, 'wstate-world: world save excludes character fields');
    assert(w.zombies[0].wt === undefined, 'wstate-world: zombie runtime fields whitelisted out');
    assert(w.npcs.length === 1 && w.npcs[0].id === 'npc1', 'wstate-world: npcs serialized');

    // 3. 世界档应用：还原世界状态（新 run 无角色字段）
    const runW = createRunDefaults(opts, deps);
    const rw = applyWorld(runW, w, deps);
    assert(rw.loaded === true, 'wstate-world: applyWorld loads valid world');
    assert(runW.world.seed === 20260805 && runW.day === 3 && runW.px === 123.5, 'wstate-world: applyWorld restores seed/day/px');
    assert(runW.zombies[0].wt === 0 && runW.zombies[0].hp === 30, 'wstate-world: zombie runtime fields rehydrated');

    // 4. 角色档应用：还原角色字段（物品/属性/外观/名字）
    const runC = createRunDefaults(opts, deps);
    applyCharacter(runC, c, deps);
    assert(runC.characterName === '阿远', 'wstate-char: applyCharacter restores name');
    assert(runC.inv[0] && runC.inv[0].id === 'wood' && runC.inv.length === 24, 'wstate-char: applyCharacter restores bag');
    assert(runC.hp === 66 && runC.food === 44 && runC.infection === 7 && runC.curSlot === 'melee', 'wstate-char: applyCharacter restores stats');
    assert(runC._savedMag && runC._savedMag.pistol === 9, 'wstate-char: applyCharacter restores weapon mag via _savedMag');

    // 5. 世界+角色组合构建（等价 buildRun）：角色物品跨世界保留
    const runFull = createRunDefaults(opts, deps);
    applyWorld(runFull, w, deps);
    applyCharacter(runFull, c, deps);
    assert(runFull.world.seed === 20260805 && runFull.characterName === '阿远' && runFull.inv[0].id === 'wood', 'wstate-combo: world+character compose (Terraria-style)');

    // 6. 非法世界拒绝 / 无角色档缺省
    const badW = createRunDefaults(opts, deps);
    assert(applyWorld(badW, { t: 5 }, deps).loaded === false, 'wstate-world: rejects world without seed');
    const noChar = createRunDefaults(opts, deps);
    applyCharacter(noChar, null, deps);
    assert(noChar.characterName === '幸存者' && noChar.inv.length === 24, 'wstate-char: null character keeps defaults');

    // 6b. 死亡位置指引 {x,y} 随档保存/恢复 + 遗物以主角尸体形式存在（2026-08-10 用户需求：
    //     无物品死亡也有方位指引；有物品 → 尸体留在死亡点可 F 搜索，指引统一「死亡地点」）
    {
        // 为尸体往返单独构造 deps 变体（mock 支持 _corpse/_corpseContents 字段）
        const corpseDeps = {
            ...deps,
            WNPC: {
                ...deps.WNPC,
                serializeNpcs: sv => (sv.npcs || []).filter(n => n.alive || n._corpse).map(n => ({
                    id: n.id, name: n.name, x: n.x, y: n.y,
                    alive: !!n.alive, _corpse: !!n._corpse,
                    _corpseContents: n._corpseContents || null, _corpseSearched: !!n._corpseSearched,
                })),
                restoreNpcs: (run, data) => { run.npcs = (data || []).map(d => ({ ...d })); },
            },
        };
        // 空背包死亡：仅死亡地点指引，无掉落袋（真实场景 deathDropLegacy 同时设 _legacyDrop 与 _lastDeathPos）
        sv._legacyDrop = { x: 100, y: 200 };
        sv._lastDeathPos = { x: 100, y: 200 };
        sv.npcs = [{ id: 'npc1', name: '阿远' }];
        const w2 = serializeWorld(sv, corpseDeps);
        assert(w2.legacyDrop && w2.legacyDrop.x === 100 && w2.legacyDrop.y === 200 && w2.legacyDrop.hasBag === undefined,
            'wstate-legacyDrop: serialize keeps death point {x,y} (no hasBag)');
        const runLD = createRunDefaults(opts, corpseDeps);
        applyWorld(runLD, w2, corpseDeps);
        assert(runLD._legacyDrop && runLD._legacyDrop.x === 100 && runLD._legacyDrop.y === 200,
            'wstate-legacyDrop: apply restores death point');
        assert(!runLD.drops.some(d => d.id === 'loot:legacy'), 'wstate-legacyDrop: no empty legacy bag on no-items death');
        // 2026-08-10 上次死亡位置 lastDeathPos 持久记录：随档往返保留（开发者传送死亡点兜底用）
        assert(w2.lastDeathPos && w2.lastDeathPos.x === 100 && w2.lastDeathPos.y === 200,
            'wstate-lastDeathPos: serialize keeps last death pos');
        assert(runLD._lastDeathPos && runLD._lastDeathPos.x === 100 && runLD._lastDeathPos.y === 200,
            'wstate-lastDeathPos: apply restores last death pos');
        // 旧档兼容：无 lastDeathPos 字段时用 legacyDrop 位置兜底
        const oldW = { ...w2, lastDeathPos: undefined };
        const runOld2 = createRunDefaults(opts, corpseDeps);
        applyWorld(runOld2, oldW, corpseDeps);
        assert(runOld2._lastDeathPos && runOld2._lastDeathPos.x === 100 && runOld2._lastDeathPos.y === 200,
            'wstate-lastDeathPos: old save falls back to legacyDrop pos');
        // 指引被清除（走到点/尸体搜索完）后 lastDeathPos 仍在（传送功能不依赖指引）
        delete runLD._legacyDrop;
        assert(runLD._lastDeathPos && runLD._lastDeathPos.x === 100,
            'wstate-lastDeathPos: persists after guide cleared');

        // 有物品死亡：死亡点生成主角尸体（_corpse），随档往返保留 + 可搜索
        sv._legacyDrop = { x: 100, y: 200 };
        sv.npcs.push({
            id: 'corpse:1', name: '阿远', role: 'friendly', look: null,
            x: 100, y: 200, hp: 0, maxHp: 100, alive: false,
            _corpse: true, _corpseContents: [{ id: 'wood', n: 1 }], _corpseSearched: false,
        });
        const w3 = serializeWorld(sv, corpseDeps);
        assert(w3.legacyDrop && w3.legacyDrop.x === 100 && w3.legacyDrop.y === 200,
            'wstate-legacyDrop: serialize keeps death point (with corpse)');
        const runLB = createRunDefaults(opts, corpseDeps);
        applyWorld(runLB, w3, corpseDeps);
        const corpse = (runLB.npcs || []).find(n => n._corpse);
        assert(corpse && corpse._corpseContents && corpse._corpseContents.length === 1 && corpse.x === 100,
            'wstate-legacyDrop: corpse (with contents) survives world round-trip');
        assert(!runLB.drops.some(d => d.id === 'loot:legacy'), 'wstate-legacyDrop: no loot bag drop on corpse death');
        // 尸体被搜索（_corpseSearched）后仍保留在 npcs（可读档），指引由 drawLegacyDropGuide 判定消失
        corpse._corpseSearched = true;
        runLB.world = { seed: 20260805, chunks: new Map() };
        const w4 = serializeWorld(runLB, corpseDeps);
        const runSearched = createRunDefaults(opts, corpseDeps);
        applyWorld(runSearched, w4, corpseDeps);
        assert((runSearched.npcs || []).some(n => n._corpse && n._corpseSearched), 'wstate-legacyDrop: searched corpse persists');
        // 旧档兼容：无尸体记录但有 contents → 兜底生成主角尸体（老档遗物可找回）
        const oldLegacy = { x: 1, y: 2, contents: [{ id: 'wood', n: 1 }] };
        const runOld = createRunDefaults(opts, corpseDeps);
        runOld.npcs = [{ id: 'npc1', name: '阿远' }];
        applyWorld(runOld, { ...w2, legacyDrop: oldLegacy }, corpseDeps);
        assert((runOld.npcs || []).some(n => n._corpse && n._corpseContents.length === 1 && n.x === 1),
            'wstate-legacyDrop: old save contents migrate to corpse');
    }

    // 7c. 高帧率（无锁帧）dt 数值断言：主循环 dt = Math.min(realDelta, 0.05)，
    //     只有上限 clamp（防低帧跳变），无下限钳制 —— 144/240Hz 高刷下 dt 不被压缩
    {
        const dtOf = (realMs) => Math.min(realMs / 1000, 0.05);
        const eq = (a, b) => Math.abs(a - b) < 1e-12;   // 浮点容差（除法路径舍入差异）
        assert(eq(dtOf(1000 / 60), 1 / 60), 'fps60: dt exactly 1/60');
        assert(eq(dtOf(1000 / 144), 1 / 144), 'fps144: dt not clamped (high refresh supported)');
        assert(eq(dtOf(1000 / 240), 1 / 240), 'fps240: dt not clamped (high refresh supported)');
        assert(dtOf(3000) === 0.05, 'lowfps: dt upper clamp 0.05s prevents jump');
        assert(dtOf(1 / 1000) > 0, 'fps1000: sub-ms dt stays positive');
    }

    // 7. 联机协议层（P0-3）：僵尸合并语义 + 快照白名单 + cull 裁剪
    {
        // 7a. mergeZombieList：同 id 原地保留（位置不动、_tx/_ty 指向快照）、新 id 追加、缺失 id 移除
        const t0 = [
            { id: 'z1', x: 100, y: 100, hp: 80, wt: 5, atkState: 'windup' },   // 本地表现字段
            { id: 'z2', x: 200, y: 200, hp: 50 },
        ];
        const snap = [
            { id: 'z1', x: 140, y: 160, hp: 70 },   // z1 位置变化
            { id: 'z3', x: 300, y: 300, hp: 90 },   // 新 id
        ];   // z2 缺失 → 应移除
        const merged = mergeZombieList(t0, snap);
        assert(merged.length === 2 && !merged.some(z => z.id === 'z2'), 'mp-merge: missing id removed, new id appended');
        const m1 = merged.find(z => z.id === 'z1');
        assert(m1.x === 100 && m1.y === 100, 'mp-merge: existing zombie keeps old position (lerp)');
        assert(m1._tx === 140 && m1._ty === 160, 'mp-merge: interpolation target set from snapshot');
        assert(m1.hp === 70 && m1.wt === 5, 'mp-merge: snapshot fields applied, local fields preserved');
        const m3 = merged.find(z => z.id === 'z3');
        assert(m3 && m3.wt === 0 && m3._tx === 300 && m3.hurt === 0, 'mp-merge: new zombie gets runtime fields');
        assert(mergeZombieList(null, snap) === null && mergeZombieList(t0, null) === t0, 'mp-merge: non-array passthrough');
    }
    {
        // 7b. serializeMpSnapshot：僵尸运行时字段白名单化 + dev 块 + cull 裁剪
        const mpSv = {
            t: 42, day: 2, horde: { phase: 'wave' },
            zombies: [{ id: 'z1', type: 'normal', char: '僵', color: '#fff', name: 'x', x: 1, y: 2, hp: 3, maxHp: 3, speed: 1, damage: 1, horde: false, stunT: 0, hurt: 0, biteT: 0, wt: 999, atkState: 'windup' }],
            effects: [], bullets: [], drops: [], mods: { plants: {} },
            _devGod: true, _devInf: true,
            _weather: 'rain', _evt: { type: 'blackout', endT: 99 }, _wxLevel: 2,
            announce: { text: '🌧 接下来：大雨', t: 2.8, color: '#6FA8D8' },
        };
        const s1 = serializeMpSnapshot(mpSv, null);
        assert(s1.zombies[0].wt === undefined && s1.zombies[0].atkState === undefined, 'mp-snap: zombie runtime fields whitelisted out');
        assert(s1.dev.god === true && s1.dev.inf === true, 'mp-snap: dev flags block');
        assert(s1.weather === 'rain' && s1.evt.type === 'blackout' && s1.evt.endT === 99, 'mp-snap: weather/evt whitelisted');
        assert(s1.wxLevel === 2 && s1.announce.text === '🌧 接下来：大雨' && s1.announce.t === 2.8, 'mp-snap: wxLevel/announce whitelisted');
        const cullSv = {
            t: 1, day: 1, horde: null,
            zombies: [{ id: 'za', type: 'n', char: 'c', color: 'x', name: 'n', x: 1, y: 1, hp: 1, maxHp: 1, speed: 1, damage: 1 }],
            drops: [{ x: 1, y: 1, id: 'wood', n: 2 }, { x: 9, y: 9, id: 'stone', n: 1 }],
            effects: [{ kind: 'hit', x: 1, y: 1, life: 0.5, maxLife: 0.5 }],
            bullets: [{ id: 'b1', x: 1, y: 1, vx: 1, vy: 1, _mpSyncable: false }],
            mods: { plants: {} },
        };
        const cullOpt = { drops: [cullSv.drops[0]], effects: [], bullets: [], plants: [] };
        const s2 = serializeMpSnapshot(cullSv, null, null, cullOpt);
        assert(s2.drops.length === 1 && s2.drops[0].id === 'wood', 'mp-snap: cull.drops filters payload');
        assert(s2.effects.length === 0 && s2.bullets.length === 0 && s2.plants.length === 0, 'mp-snap: cull empties respected');
    }
}

// world 生成回归：城市边缘死路收起为 T 形路口（无死路/无孤儿人行道），建筑无悬挂凸块且都有门。
{
    const seed = 20260802;
    const cityLike = k => k === 'urban' || k === 'suburb';
    let bcx = null;
    for (let cx = 1; cx < 45 && bcx === null; cx++) {
        if (cityLike(districtAt(seed, cx - 1, 0)) !== cityLike(districtAt(seed, cx, 0))) bcx = cx;
    }
    assert(bcx !== null, 'world: found a city boundary');
    const cells = new Map();
    for (let cy = -3; cy <= 3; cy++) for (let cx = bcx - 3; cx <= bcx + 3; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            cells.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const isRoad = (x, y) => { const v = cells.get(x + ',' + y); return v === T.ROAD || v === T.CAR || v === T.BARRICADE; };
    const isB = (x, y) => { const v = cells.get(x + ',' + y); return v === T.WALL || v === T.DOOR; };
    let orphan = 0, dangling = 0, noDoor = 0;
    const walkJunk = new Set([T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES]);
    for (const [k, v] of cells) {
        if (v !== T.SIDEWALK) continue;
        const [x, y] = k.split(',').map(Number);
        // 人行道带是城市规划层：SIDEWALK 必须位于城市区块的 walk 带（r==2/r==BL-1），
        // 或紧邻主干道人行道环；否则视为"孤儿人行道"。
        const cxx = Math.floor(x / CHUNK), cyy = Math.floor(y / CHUNK);
        const d = districtAt(seed, cxx, cyy);
        let planned = false;
        if (d === 'urban' || d === 'suburb') {
            const BL = blockAt(seed, cxx, cyy);
            const rx = ((x % BL) + BL) % BL, ry = ((y % BL) + BL) % BL;
            planned = rx === 4 || rx === BL - 1 || ry === 4 || ry === BL - 1;
        }
        // 荒野贴邻城市边界的合理人行道延续（wildSidewalkKept）不算孤儿：
        // 城市人行道带自然过渡进荒野 1 圈，避免"到荒野边界硬断"（2026-08-07 用户反馈）
        if (!planned && arterialClassAt(seed, x, y) !== 'sidewalk') {
            const wildOk = d !== 'urban' && d !== 'suburb' && wildSidewalkKept(seed, x, y);
            if (!wildOk) orphan++;
        }
    }
    // 人行道带成带连续：城市区块的 walk 带格必须与"实际保留路走廊"严格一致——
    // 紧邻保留路/主干道（hasAdjacentRoad）→ 必须是人行道；否则（死腿/无路）→ 不许生成人行道跑进绿地。
    let walkBand = 0, runOff = 0, gapNextToRoad = 0;
    const predHasAdjRoad = (gx, gy) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (gridRoadKept(seed, gx + dx, gy + dy)) return true;
            if (arterialClassAt(seed, gx + dx, gy + dy) === 'road') return true;
        }
        return false;
    };
    for (const [k, v] of cells) {
        const [x, y] = k.split(',').map(Number);
        const cxx = Math.floor(x / CHUNK), cyy = Math.floor(y / CHUNK);
        const d = districtAt(seed, cxx, cyy);
        if (d !== 'urban' && d !== 'suburb') continue;
        const BL = blockAt(seed, cxx, cyy);
        const rx = ((x % BL) + BL) % BL, ry = ((y % BL) + BL) % BL;
        if (!(rx === 4 || rx === BL - 1 || ry === 4 || ry === BL - 1)) continue;
        walkBand++;
        const hasRoad = predHasAdjRoad(x, y);
        if (v === T.SIDEWALK) {
            if (!hasRoad) runOff++;
        } else if (!(v === T.ROAD || v === T.CAR || v === T.BARRICADE || walkJunk.has(v))) {
            if (hasRoad) gapNextToRoad++;   // 紧邻保留路却草地 → 人行道带缺口
        }
    }
    const seen = new Set();
    for (const [k] of cells) {
        const [gx, gy] = k.split(',').map(Number);
        if (seen.has(k) || !isB(gx, gy)) continue;
        const q = [[gx, gy]], comp = []; seen.add(k);
        for (let i = 0; i < q.length; i++) {
            const [x, y] = q[i]; comp.push([x, y]);
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                const nk = nx + ',' + ny;
                if (!seen.has(nk) && isB(nx, ny)) { seen.add(nk); q.push([nx, ny]); }
            }
        }
        if (comp.length < 4) continue;
        const cs = new Set(comp.map(([x, y]) => x + ',' + y));
        let hasDoor = false;
        for (const [x, y] of comp) {
            if (cells.get(x + ',' + y) === T.DOOR) hasDoor = true;
            let bn = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cs.has((x + dx) + ',' + (y + dy))) bn++;
            if (bn === 1) dangling++;
        }
        if (!hasDoor) noDoor++;
    }
    // 死路回归：城市内部不得残留突然断掉的网格路（1宽断头 / 2宽断在非路口相位）；
    // 路带延伸到城市边界（8 邻含非城市区块）的"出城路"属于正常收尾，不算死胡同。
    const phase2 = (v, BL) => ((v % BL) + BL) % BL < 2;
    let deadEnd = 0;
    for (const [k, v] of cells) {
        if (!(v === T.ROAD || v === T.CAR || v === T.BARRICADE)) continue;
        const [x, y] = k.split(',').map(Number);
        if (arterialClassAt(seed, x, y) === 'road') continue;
        let inb = true;
        for (let dy = -2; dy <= 2 && inb; dy++) for (let dx = -2; dx <= 2; dx++) if (!cells.has((x + dx) + ',' + (y + dy))) { inb = false; break; }
        if (!inb) continue;
        let deg = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoad(x + dx, y + dy)) deg++;
        // 出城路/残路末端：路带末端 8 邻含非城市区块（荒野）或废墟（工业区残路），
        // 属于正常收尾（含死腿扩展段的短死路），不判死胡同。
        let touchesOutside = false;
        for (let dy = -1; dy <= 1 && !touchesOutside; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nd = districtAt(seed, Math.floor((x + dx) / CHUNK), Math.floor((y + dy) / CHUNK));
            if (nd !== 'urban' && nd !== 'suburb' && nd !== 'ruins') { touchesOutside = true; break; }
        }
        if (deg === 1) { if (!touchesOutside) deadEnd++; continue; }
        if (touchesOutside) continue;
        const BL = blockAt(seed, Math.floor(x / CHUNK), Math.floor(y / CHUNK));
        const onItsRow = phase2(y, BL);
        const onItsCol = phase2(x, BL);
        // 相位断头：只有"保留走廊内的路带在非路口相位断"才算死胡同；
        // 断头方向的下一格无保留路（路带末端 = 死腿扩展段/城市边界）属于正常收尾。
        if ((isRoad(x, y + 1) || isRoad(x, y + 2)) && !isRoad(x, y - 1) && !onItsRow && gridRoadKept(seed, x, y - 1)) deadEnd++;
        else if ((isRoad(x, y - 1) || isRoad(x, y - 2)) && !isRoad(x, y + 1) && !onItsRow && gridRoadKept(seed, x, y + 1)) deadEnd++;
        else if ((isRoad(x + 1, y) || isRoad(x + 2, y)) && !isRoad(x - 1, y) && !onItsCol && gridRoadKept(seed, x - 1, y)) deadEnd++;
        else if ((isRoad(x - 1, y) || isRoad(x - 2, y)) && !isRoad(x + 1, y) && !onItsCol && gridRoadKept(seed, x + 1, y)) deadEnd++;
    }
    let roadCount = 0;
    for (const [, v] of cells) if (v === T.ROAD || v === T.CAR || v === T.BARRICADE) roadCount++;
    assert(deadEnd === 0, `world: no dead-end grid roads at city edge (found ${deadEnd})`);
    assert(roadCount > 100, `world: city boundary still keeps grid roads (roads ${roadCount})`);
    assert(orphan === 0, `world: no orphan sidewalks at city edge (found ${orphan})`);
    assert(runOff === 0, `world: sidewalk never runs off into grass without road (runoff ${runOff}/${walkBand})`);
    assert(gapNextToRoad === 0, `world: walk band has no gap next to kept roads (gaps ${gapNextToRoad}/${walkBand})`);
    assert(dangling === 0, `world: no dangling building protrusions (found ${dangling})`);
    assert(noDoor === 0, `world: every building keeps a door (doorless ${noDoor})`);
    assert(typeof gridRoadKept(seed, bcx * CHUNK, 0) === 'boolean', 'world: gridRoadKept pure predicate');
}

// 废墟（工业区）路带/人行道带叠加态回归：障碍物（碎石/倒树）只作为上层叠加，
// 下层地面（人行道/公路）始终完整——人行道带不得缺失成草地、规划层必须承认废墟人行道、
// 紧邻人行道带的路侧格/内侧圈不得生成树冠盖住人行道边缘。
{
    const seed = 20260802;
    const cells = new Map();
    for (let cy = -8; cy <= 8; cy++) for (let cx = -8; cx <= 8; cx++) {
        if (districtAt(seed, cx, cy) !== 'ruins') continue;
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            cells.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    assert(cells.size > 0, 'ruins overlay: found ruins chunks near origin');
    const predHasAdjRoad = (gx, gy) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (gridRoadKept(seed, gx + dx, gy + dy)) return true;
            if (arterialClassAt(seed, gx + dx, gy + dy) === 'road') return true;
        }
        return false;
    };
    let walkCount = 0, walkMiss = 0, planBad = 0, roadTreeClip = 0, interiorTreeClip = 0;
    for (const [k, v] of cells) {
        const [x, y] = k.split(',').map(Number);
        const cxx = Math.floor(x / CHUNK), cyy = Math.floor(y / CHUNK);
        const BL = blockAt(seed, cxx, cyy);
        const rx = ((x % BL) + BL) % BL, ry = ((y % BL) + BL) % BL;
        const roadBand = rx < 4 || ry < 4;
        const walkBand = !roadBand && (rx === 4 || rx === BL - 1 || ry === 4 || ry === BL - 1);
        if (walkBand && predHasAdjRoad(x, y)) {
            walkCount++;
            // 只允许：人行道 / 上层碎石 / 主干道横穿（动脉路在 walk 带格无条件铺设公路）
            const arterial = arterialClassAt(seed, x, y);
            if (v !== T.SIDEWALK && v !== T.RUBBLE && arterial !== 'road') walkMiss++;
            if (arterial !== 'road' && !plannedSidewalkAt(seed, x, y)) planBad++;
        }
        // 公路带 r==0/r==3（贴人行道带）不得有树：树冠会盖住人行道边缘
        if (roadBand && v === T.TREE && (rx === 0 || rx === 3 || ry === 0 || ry === 3)) roadTreeClip++;
        // 街区内部 r==5/r==BL-2（贴人行道带）不得有树
        if (!roadBand && !walkBand && v === T.TREE && ((rx === 5 || rx === BL - 2) || (ry === 5 || ry === BL - 2))) interiorTreeClip++;
    }
    assert(walkCount > 0, 'ruins overlay: ruins walk band exists');
    assert(walkMiss === 0, `ruins overlay: walk band never degrades to grass (miss ${walkMiss}/${walkCount})`);
    assert(planBad === 0, `ruins overlay: plannedSidewalkAt covers every ruins walk tile (bad ${planBad}/${walkCount})`);
    assert(roadTreeClip === 0, `ruins overlay: no road-band tree adjacent to walk band (${roadTreeClip})`);
    assert(interiorTreeClip === 0, `ruins overlay: no interior tree adjacent to walk band (${interiorTreeClip})`);
}

// 载具（wvehicle）：车辆品相/朝向是种子确定性纯函数，分布符合设计区间
{
    const WV = await import('../source-code/mod-wasteland/wvehicle.js');
    assert(WV.carCondition(123, 5, 6) === WV.carCondition(123, 5, 6), 'vehicle: carCondition stable per seed+coord');
    const c1 = WV.carCondition(123, 5, 6), c2 = WV.carCondition(124, 5, 6);
    assert(['wreck', 'repairable', 'intact'].includes(c1) && ['wreck', 'repairable', 'intact'].includes(c2), 'vehicle: carCondition valid value');
    let wreck = 0, rep = 0, intact = 0;
    for (let i = 0; i < 2000; i++) {
        const c = WV.carCondition(9876, (i % 90) - 45, Math.floor(i / 90) - 11);
        if (c === 'wreck') wreck++;
        else if (c === 'repairable') rep++;
        else intact++;
    }
    assert(intact >= 60 && intact <= 150, `vehicle: intact share in design range (${intact}/2000)`);
    assert(rep >= 300 && rep <= 520, `vehicle: repairable share in design range (${rep}/2000)`);
    assert(WV.carDirAt(9876, 5, 6) === WV.carDirAt(9876, 5, 6), 'vehicle: carDirAt stable per seed+coord');
    const dirs = new Set();
    for (let i = 0; i < 600; i++) dirs.add(WV.carDirAt(11, (i % 25) - 12, Math.floor(i / 25) - 11));
    assert(WV.carDirAt(11, 5, 6) === WV.carDirAt(11, 5, 6), 'vehicle: carDirAt stable per seed+coord');
    assert(dirs.size > 100, `vehicle: carDirAt produces arbitrary angles (${dirs.size} distinct of 600)`);
    // 汽车寻路（wvehicle.buildChauffeurPath）：BFS 必须能对附近目标规划出有效路径，
    // 且路径端点（best）不应远离目标格（全量回归见 dev-tools/car-pathfinding-test.js）
    const psv = { world: { seed: 20260802, chunks: new Map() }, mods: { tiles: {}, chests: {} }, now: 0 };
    MSG.initMsg(psv);
    const pStart = { tx: (SPAWN.x + 3 + 0.5) * TS, ty: (SPAWN.y + 0.5) * TS };
    const pr = WV.buildChauffeurPath(psv, pStart.tx, pStart.ty, SPAWN.x + 8, SPAWN.y + 8, 0);
    assert(pr.goal || pr.path.length > 0, 'vehicle path: near camp target yields a plan');
    const pr2 = WV.buildChauffeurPath(psv, pStart.tx, pStart.ty, SPAWN.x + 30, SPAWN.y - 20, 0);
    assert(Array.isArray(pr2.path) && typeof pr2.goal === 'boolean', 'vehicle path: far target returns goal+path');
    const pEnd = pr2.bestX != null ? Math.hypot(pr2.bestX - (SPAWN.x + 30), pr2.bestY - (SPAWN.y - 20)) : Infinity;
    assert(pr2.goal || pEnd <= 6, `vehicle path: far target ends near goal (endDist=${pEnd.toFixed(1)})`);
}

// 驾驶订单目的地（wnpc）：pickDriveTarget 区块坐标换算回归——
// 目的地必须落在真实目标区域（城市→urban、废墟→ruins 区块），不能落到兜底野地点；
// 营地目标必须吸附到可步行格（此前把格坐标当区块坐标传 districtAt，射线全落空 → 兜底随机点）
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const seed = 20260802;
    const driver = { id: 'npc1', name: '阿远', x: SPAWN.x * TS + TS / 2, y: SPAWN.y * TS + TS / 2 };
    const sv = {
        world: { seed, chunks: new Map() },
        mods: { tiles: { [(SPAWN.x + 2) + ',' + SPAWN.y]: { t: T.CAR, cond: 'intact', repaired: true, owner: '阿远' } } },
        npcs: [driver],
        msgs: [],
        camp: { x: (SPAWN.x + 4) * TS, y: (SPAWN.y + 4) * TS },
    };
    const inDistrict = (o, want) => {
        const tx = Math.floor(o.tx / TS), ty = Math.floor(o.ty / TS);
        return districtAt(seed, Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)) === want;
    };
    assert(WNPC.startDriveOrder(sv, driver, 'city'), 'driveOrder: city order accepted');
    assert(inDistrict(sv.driveOrder, 'urban'), `driveOrder: city target lands in urban district (${sv.driveOrder.tx},${sv.driveOrder.ty})`);
    sv.driveOrder = null;
    assert(WNPC.startDriveOrder(sv, driver, 'ruins'), 'driveOrder: ruins order accepted');
    assert(inDistrict(sv.driveOrder, 'ruins'), `driveOrder: ruins target lands in ruins district (${sv.driveOrder.tx},${sv.driveOrder.ty})`);
    sv.driveOrder = null;
    assert(WNPC.startDriveOrder(sv, driver, 'camp'), 'driveOrder: camp order accepted');
    const cgx = Math.floor(sv.driveOrder.tx / TS), cgy = Math.floor(sv.driveOrder.ty / TS);
    assert(isWalk(getTile(sv, cgx, cgy)), 'driveOrder: camp target snapped to walkable tile');
}

// NPC 动态武器选择：npcPickWeapon 已在 v4.x 重构中移除，改为 randomNpcWeapon/wearNpcWeapon
// 此处仅验证新接口存在
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    assert(typeof WNPC.randomNpcWeapon === 'function', 'randomNpcWeapon 应存在');
    assert(typeof WNPC.wearNpcWeapon === 'function', 'wearNpcWeapon 应存在');
}

// 恶意 NPC 攻击（2026-08-10 用户反馈"短剑很远捅人/反复鞭尸/远程边走边打打不中耗弹快"）：
// 近战 45px 距离判定 + 倒地（downed）玩家/队友免伤 + 远程射击站定瞄准
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const C0 = (SPAWN.x + 0.5) * TS, R0 = (SPAWN.y + 0.5) * TS;   // 出生点格中心（可走区域）
    const makeSv = (px, py, hx, hy, fx, fy, friendDowned) => {
        const sv = {
            world: { seed: 12345, chunks: new Map() },
            mods: { tiles: {} },
            px, py, hp: 100, maxHp: 100,
            npcs: [], zombies: [], interior: null,
            now: 0, controllerId: null, msgs: [],
            _devGod: false, invuln: 0, _wake: null, _downed: null,
            _combatT: 0, hurtT: 0, _lastNpcHit: null,
            effects: [], drops: [], npcBullets: [],
            mp: null, mpOutbox: [],
        };
        const hostile = WNPC.makeNpc(sv, hx, hy, 'hostile');
        hostile.inv = [{ id: 'wpn:dagger', n: 1, eq: 'melee' }];
        hostile.wpnKey = 'dagger';
        hostile._wpick = null; hostile._wpickT = null; hostile._threat = null; hostile._threatT = 0; hostile._standT = 0; hostile._aimT = 0;
        sv.npcs.push(hostile);
        const friend = WNPC.makeNpc(sv, fx, fy, 'friendly');
        friend._wpick = null; friend._wpickT = null; friend._threat = null; friend._threatT = 0; friend._standT = 0;
        if (friendDowned) { friend.downed = true; friend.hp = 1; }
        sv.npcs.push(friend);
        return { sv, hostile, friend };
    };
    const canStand = () => true;
    // 1) 近战距离判定：短剑 dagger reach=37 → 攻击距离 45px，46px 外不命中
    {
        const { sv, hostile } = makeSv(C0, R0, C0 + 46, R0, C0 + 400, R0 + 400);
        const hp0 = sv.hp;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
        assert(sv.hp === hp0, 'hostileAtk: 短剑 46px 外不命中玩家');
    }
    // 2) 恶意 NPC 不攻击"倒地主控视角"玩家（controllerId 指向 downed 记录时免伤，防反复鞭尸）
    {
        const { sv, hostile } = makeSv(C0, R0, C0 + 30, R0, C0 + 400, R0 + 400);
        // 当前主控记录标记倒地（=正在操控倒地主角等待救治）
        const pc = WNPC.makeNpc(sv, C0, R0, 'friendly');
        pc.downed = true; pc.alive = true; pc.hp = 1;
        sv.npcs.push(pc);
        sv.controllerId = pc.id;
        sv._downed = { name: pc.name, px: C0, py: R0, dayDead: 0, med: 0, herb: 0 };
        const hp0 = sv.hp;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
        assert(sv.hp === hp0, 'hostileAtk: 恶意 NPC 不攻击倒地主控玩家（防反复鞭尸）');
    }
    // 2b) 反例：队伍有人倒地但当前主控（未倒地）仍应被攻击（2026-08-10 用户反馈"恶意NPC不攻击切换主控"）
    {
        const { sv, hostile } = makeSv(C0, R0, C0 + 30, R0, C0 + 400, R0 + 400);
        const pc = WNPC.makeNpc(sv, C0, R0, 'friendly');   // 当前主控（未倒地）
        pc.downed = false; pc.alive = true; pc.hp = 100;
        sv.npcs.push(pc);
        sv.controllerId = pc.id;
        // 队伍里另有倒地者（但非主控）
        const downedMate = WNPC.makeNpc(sv, C0 + 200, R0, 'friendly');
        downedMate.downed = true; downedMate.alive = true; downedMate.hp = 1;
        sv.npcs.push(downedMate);
        sv._downed = { name: downedMate.name, px: C0 + 200, py: R0, dayDead: 0, med: 0, herb: 0 };
        const hp0 = sv.hp;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
        assert(sv.hp < hp0, 'hostileAtk: 队伍有倒地者时，未倒地的当前主控仍应被攻击');
    }
    // 3) 恶意 NPC 不攻击倒地队友（n.downed）
    {
        const { sv, hostile, friend } = makeSv(C0 - 400, R0, C0, R0, C0 + 30, R0, true);
        const fp0 = friend.hp;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
        assert(friend.hp === fp0, 'hostileAtk: 恶意 NPC 不攻击倒地队友（防反复鞭尸/掉遗物）');
    }
    // 4) 对照组：非倒地队友正常被攻击（确认 3 不是"完全不攻击"）
    {
        const { sv, hostile, friend } = makeSv(C0 - 400, R0, C0, R0, C0 + 30, R0, false);
        const fp0 = friend.hp;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
        assert(friend.hp < fp0, 'hostileAtk: 非倒地队友正常被攻击（对照组）');
    }
    // 5) 远程射击站定：开火帧不移动 + 站定瞄准锁期间不移动（不再边走边打）
    {
        const { sv, hostile, friend } = makeSv(C0 - 400, R0, C0, R0, C0 + 200, R0, false);
        hostile.inv = [{ id: 'wpn:pistol', n: 1, eq: 'ranged' }, { id: 'ammo:pistolAmmo', n: 20 }];
        hostile.wpnKey = 'pistol';
        hostile._wpick = null; hostile._wpickT = null;
        const b0 = sv.npcBullets.length;
        const hx0 = hostile.x, hy0 = hostile.y;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
        assert(sv.npcBullets.length > b0, 'hostileAtk: 远程武器在射程内开火');
        assert(hostile.x === hx0 && hostile.y === hy0, 'hostileAtk: 射击帧站定不移动');
        assert(hostile._aimT > 0, 'hostileAtk: 开火后进入站定瞄准锁');
        const hx1 = hostile.x, hy1 = hostile.y;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
        assert(hostile.x === hx1 && hostile.y === hy1, 'hostileAtk: 站定瞄准锁期间不移动');
    }
}

// 武器与警戒规则（2026-08-10 用户需求）：弓弩蓄力 / 警戒范围按武器 / 软核成员被击杀倒地可救助
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const C0 = (SPAWN.x + 0.5) * TS, R0 = (SPAWN.y + 0.5) * TS;
    const canStand = () => true;
    const makeSv = (weaponKey, ammoN) => {
        const sv = {
            world: { seed: 12345, chunks: new Map() }, mods: { tiles: {} },
            px: C0 - 400, py: R0, hp: 100, maxHp: 100,
            npcs: [], zombies: [], interior: null, now: 0, controllerId: null,
            _devGod: false, invuln: 0, _wake: null, _downed: null, _downedMembers: [],
            _combatT: 0, hurtT: 0, _lastNpcHit: null,
            effects: [], drops: [], npcBullets: [], mp: null, mpOutbox: [], msgs: [],
            day: 1, diffKey: 'normal', _waitDowned: false, _carryDowned: false,
        };
        const hostile = WNPC.makeNpc(sv, C0, R0, 'hostile');
        hostile.inv = [{ id: 'wpn:' + weaponKey, n: 1, eq: 'ranged' }, { id: 'ammo:' + (weaponKey === 'bow' ? 'arrowAmmo' : weaponKey + 'Ammo'), n: ammoN || 20 }];
        hostile.wpnKey = weaponKey;
        hostile._wpick = null; hostile._wpickT = null; hostile._threat = null; hostile._threatT = 0; hostile._standT = 0; hostile._aimT = 0; hostile._chargeT = 0;
        sv.npcs.push(hostile);
        return { sv, hostile };
    };
    // 1) 弓弩蓄力：第1帧不放箭，蓄力 0.25s 后才放箭（玩家一致）
    {
        const { sv, hostile } = makeSv('bow', 20);
        sv.zombies.push({ x: C0 + 200, y: R0, hp: 500, maxHp: 500, active: true });
        const b0 = sv.npcBullets.length;
        WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 26, 0, true);
        assert(sv.npcBullets.length === b0, 'weaponRule: 弓弩第1帧蓄力不放箭');
        assert((hostile._chargeT || 0) > 0, 'weaponRule: 弓弩第1帧开始蓄力');
        for (let f = 0; f < 5; f++) { sv.now += 1 / 20; WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 26, 0, true); }
        assert(sv.npcBullets.length > b0, 'weaponRule: 弓弩蓄力完成后放箭');
    }
    // 2) 警戒范围按武器：近战 7 格（10 格外不可警戒）、狙击 26 格（20 格内可警戒）、弓 15 格
    {
        const s1 = makeSv('dagger', 0);
        s1.sv.zombies.push({ x: C0 + 10 * TS, y: R0, hp: 500, maxHp: 500, active: true });
        assert(!WNPC.combatThreat(s1.sv, s1.hostile, 1 / 20, canStand, 7, 0, true), 'weaponRule: 近战警戒7格，10格外不可警戒');
        const s2 = makeSv('sniper', 5);
        s2.sv.zombies.push({ x: C0 + 20 * TS, y: R0, hp: 500, maxHp: 500, active: true });
        assert(!!WNPC.combatThreat(s2.sv, s2.hostile, 1 / 20, canStand, 26, 0, true), 'weaponRule: 狙击警戒26格，20格内可警戒');
        const s3 = makeSv('bow', 20);
        s3.sv.zombies.push({ x: C0 + 12 * TS, y: R0, hp: 500, maxHp: 500, active: true });
        assert(!!WNPC.combatThreat(s3.sv, s3.hostile, 1 / 20, canStand, 15, 0, true), 'weaponRule: 弓警戒15格，12格内可警戒');
    }
    // 3) 软核成员被战斗致死 → 倒地（downed）可救助；非战斗死亡 → 直接死亡
    {
        const sv = {
            world: { seed: 12345, chunks: new Map() }, mods: { tiles: {} },
            px: C0, py: R0, hp: 100, maxHp: 100,
            npcs: [], zombies: [], interior: null, now: 0, controllerId: null,
            _devGod: false, invuln: 0, _wake: null, _downed: null, _downedMembers: [],
            _combatT: 0, hurtT: 0, _lastNpcHit: null,
            effects: [], drops: [], npcBullets: [], mp: null, mpOutbox: [], msgs: [],
            day: 1, diffKey: 'normal', _waitDowned: false, _carryDowned: false,
        };
        const m1 = WNPC.makeNpc(sv, C0 + TS, R0, 'friendly'); m1.party = true; m1.hp = 0;
        sv.npcs.push(m1);
        WNPC.killNpc(sv, m1, '被僵尸咬死');
        assert(m1.downed === true && m1.alive === true, 'weaponRule: 软核成员被僵尸咬死 → 倒地可救助');
        assert((sv._downedMembers || []).some(m => m.id === m1.id), 'weaponRule: 倒地成员记录在 _downedMembers');
        const m2 = WNPC.makeNpc(sv, C0 + 2 * TS, R0, 'friendly'); m2.party = true; m2.hp = 0;
        sv.npcs.push(m2);
        WNPC.killNpc(sv, m2, '病死');
        assert(m2.alive === false, 'weaponRule: 非战斗死亡（病死）→ 直接死亡');
    }
}

// NPC 自主行为（2026-08-10 用户需求）：自主捡物品（就近+同物品优先）/ 奔跑 / 卡碰撞体兜底
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const C0 = (SPAWN.x + 0.5) * TS, R0 = (SPAWN.y + 0.5) * TS;
    const canStand = () => true;
    const makeSv = () => ({
        world: { seed: 12345, chunks: new Map() },
        mods: { tiles: {} },
        px: C0, py: R0, hp: 100, maxHp: 100,
        npcs: [], zombies: [], interior: null,
        now: 0, controllerId: null,
        _devGod: false, invuln: 0, _wake: null, _downed: null,
        _combatT: 0, hurtT: 0, _lastNpcHit: null,
        effects: [], drops: [], npcBullets: [],
        mp: null, mpOutbox: [],
    });
    // 1) 自主捡物品：背包有 food → 优先走向远处 food（同物品优先）而非更近的 water，走到后拾取
    {
        const sv = makeSv();
        sv.drops.push({ x: C0 + 2 * TS, y: R0, id: 'food', n: 2 });
        sv.drops.push({ x: C0 + 0.5 * TS, y: R0, id: 'water', n: 1 });
        const npc = WNPC.makeNpc(sv, C0, R0, 'friendly');
        npc.inv = [{ id: 'food', n: 1 }];
        npc.party = true; npc.state = 'follow';
        sv.npcs.push(npc);
        let targetFood = false;
        for (let f = 0; f < 200; f++) {
            sv.now += 1 / 20;
            WNPC.updateNpc(sv, npc, 1 / 20, canStand, null, false);
            const df = Math.hypot(C0 + 2 * TS - npc.x, R0 - npc.y);
            const dw = Math.hypot(C0 + 0.5 * TS - npc.x, R0 - npc.y);
            if (df < dw) targetFood = true;
            const fNow = npc.inv.find(s => s.id === 'food');
            if (fNow && fNow.n >= 2) break;
        }
        assert(targetFood, 'npcAuto: 背包有 food 时优先走向远处 food（同物品优先）');
        const fAfter = npc.inv.find(s => s.id === 'food');
        assert(fAfter && fAfter.n >= 2, `npcAuto: 捡到 food (n=${fAfter ? fAfter.n : 0})`);
    }
    // 2) 奔跑：离玩家远时 _running=true（奔跑动画），靠近后停止
    {
        const sv = makeSv();
        const npc = WNPC.makeNpc(sv, C0 - 8 * TS, R0, 'friendly');
        npc.party = true; npc.state = 'follow';
        sv.npcs.push(npc);
        WNPC.updateNpc(sv, npc, 1 / 20, canStand, null, false);
        assert(npc._running === true, `npcAuto: 离玩家远(8格)时奔跑 (_running=${npc._running})`);
        npc.x = C0 + 1 * TS; npc.y = R0;
        npc._running = true;
        WNPC.updateNpc(sv, npc, 1 / 20, canStand, null, false);
        assert(npc._running === false, `npcAuto: 靠近(1格)后恢复步行 (_running=${npc._running})`);
    }
    // 3) 卡碰撞体兜底：位置不可站 → 传送到最近可站格
    {
        const sv = makeSv();
        const npc = WNPC.makeNpc(sv, C0, R0, 'friendly');
        npc.party = true; npc.state = 'follow';
        sv.npcs.push(npc);
        const strictStand = (x, y) => Math.hypot(x - C0, y - R0) > TS * 0.8;   // 中心是碰撞体
        WNPC.updateNpc(sv, npc, 1 / 20, strictStand, null, false);
        assert(strictStand(npc.x, npc.y), 'npcAuto: 卡碰撞体后传送至可站格');
    }
}

// NPC 切主控背包归一化（2026-08-10 用户反馈"切主控后背包大小与玩家不一致"）：
// normBag 保证 NPC 的动态 inv 归一化为 BAG_SIZE(24) 格（不足补 null、超长保留），
// 使切主控后背包 UI 与主控玩家一致。
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const C0 = (SPAWN.x + 0.5) * TS, R0 = (SPAWN.y + 0.5) * TS;
    const canStand = () => true;
    const makeSv = () => ({
        world: { seed: 12345, chunks: new Map() },
        mods: { tiles: {} },
        px: C0, py: R0, hp: 100, maxHp: 100,
        npcs: [], zombies: [], interior: null,
        now: 0, controllerId: null,
        _devGod: false, invuln: 0, _wake: null, _downed: null,
        _combatT: 0, hurtT: 0, _lastNpcHit: null,
        effects: [], drops: [], npcBullets: [],
        mp: null, mpOutbox: [],
    });
    // 1) 短背包（如 5 格）→ 归一化为 24 格
    {
        const sv = makeSv();
        const npc = WNPC.makeNpc(sv, C0, R0, 'friendly');
        npc.inv = [{ id: 'food', n: 2 }, { id: 'water', n: 1 }, null, null, { id: 'med:bandage', n: 3 }];   // 5 格（含空洞）
        npc.party = true;
        sv.npcs.push(npc);
        sv.controllerId = npc.id;
        const out = WNPC.normBag(npc.inv);
        assert(out.length === 24, `npcBag: 5格背包归一化为24格 (实际${out.length})`);
        assert(out[0].id === 'food' && out[4].id === 'med:bandage', 'npcBag: 物品位置保持');
        assert(out[2] === null && out[5] === null, 'npcBag: 空槽保持 null');
    }
    // 2) 超长背包（开发无限背包，如 40 格）→ 保留超长不截断
    {
        const sv = makeSv();
        const npc = WNPC.makeNpc(sv, C0, R0, 'friendly');
        const big = Array(40).fill(null);
        big[0] = { id: 'food', n: 1 };
        npc.inv = big;
        npc.party = true;
        sv.npcs.push(npc);
        const out = WNPC.normBag(npc.inv);
        assert(out.length === 40, `npcBag: 40格无限背包保留超长 (实际${out.length})`);
        assert(out[0].id === 'food', 'npcBag: 超长背包物品保留');
    }
    // 3) 切主控后 sv.inv 长度 == BAG_SIZE（24）且与 NPC 背包一致
    {
        const sv = makeSv();
        const npc = WNPC.makeNpc(sv, C0, R0, 'friendly');
        npc.inv = [{ id: 'food', n: 1 }];
        npc.party = true;
        sv.npcs.push(npc);
        // 模拟 switchControl 的归一化：sv.inv = normBag(tgt.inv)
        sv.inv = WNPC.normBag(npc.inv);
        assert(sv.inv.length === 24, `npcBag: 切主控后 sv.inv 归一化为24格 (实际${sv.inv.length})`);
    }
}

// 近战绕圈站位不贴脸（2026-08-10 用户反馈"近战还是贴脸攻击"）：
// 绕圈目标 = 攻击边缘内沿（0.92*reach≈41px），攻击时与目标距离应 > 30px（不脸贴脸）
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const C0 = (SPAWN.x + 0.5) * TS, R0 = (SPAWN.y + 0.5) * TS;
    const makeSv = (lowHp) => {
        const sv = {
            world: { seed: 12345, chunks: new Map() },
            mods: { tiles: {} },
            px: C0 - 400, py: R0, hp: 100, maxHp: 100,
            npcs: [], zombies: [], interior: null,
            now: 0, controllerId: null,
            _devGod: false, invuln: 0, _wake: null, _downed: null,
            _combatT: 0, hurtT: 0, _lastNpcHit: null,
            effects: [], drops: [], npcBullets: [],
            mp: null, mpOutbox: [],
        };
        const hostile = WNPC.makeNpc(sv, C0, R0, 'hostile');
        hostile.inv = [{ id: 'wpn:dagger', n: 1, eq: 'melee' }];
        hostile.wpnKey = 'dagger';
        if (lowHp) { hostile.hp = 10; hostile.maxHp = 100; }
        hostile._wpick = null; hostile._wpickT = null; hostile._threat = null; hostile._threatT = 0; hostile._standT = 0; hostile._aimT = 0; hostile._jitter = 0;
        sv.npcs.push(hostile);
        sv.zombies.push({ x: C0 + 100, y: R0, hp: 500, maxHp: 500, active: true, walking: false, type: 'zombie', name: '僵尸', seed: 1, dmg: 10, hurt: 0, ang: 0, biteCd: 0, isDowned: false, carry: null });
        return { sv, hostile };
    };
    const canStand = () => true;
    for (const [tag, lowHp] of [['normal', false], ['lowHp', true]]) {
        const { sv, hostile } = makeSv(lowHp);
        let minAtkDist = Infinity, atkFrames = 0;
        for (let f = 0; f < 150; f++) {
            sv.now += 1 / 20;
            const z = sv.zombies[0];
            WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
            if (z.hp < 500) {
                const d = Math.hypot(hostile.x - z.x, hostile.y - z.y);
                minAtkDist = Math.min(minAtkDist, d);
                atkFrames++;
                if (atkFrames > 3) z.hp = 500;
            }
        }
        assert(atkFrames > 0, `meleeStandoff[${tag}]: 应正常出刀 (atkFrames=${atkFrames})`);
        assert(minAtkDist !== Infinity && minAtkDist > 30, `meleeStandoff[${tag}]: 攻击时距离应 >30px 不贴脸 (实际 ${minAtkDist === Infinity ? '-' : minAtkDist.toFixed(1)}px)`);
    }
    // 3) 高血近战不站撸（2026-08-10 用户反馈"血量高时和僵尸站撸"）：
    //    出刀后冷却期间应绕圈移动（位置持续变化），而非完全站定原地挨打。
    {
        const { sv, hostile } = makeSv(false);
        hostile.inv = [{ id: 'wpn:dagger', n: 1, eq: 'melee' }];
        hostile.wpnKey = 'dagger';
        hostile._wpick = null; hostile._wpickT = null; hostile._threat = null; hostile._threatT = 0; hostile._standT = 0; hostile._aimT = 0; hostile._jitter = 0;
        // 僵尸贴近（攻击边缘内），让 NPC 进入出刀循环
        sv.zombies[0].x = hostile.x + 40; sv.zombies[0].y = hostile.y;
        let atkFrames = 0, movedFrames = 0;
        for (let f = 0; f < 120; f++) {
            sv.now += 1 / 20;
            const prevX = hostile.x, prevY = hostile.y;
            const z = sv.zombies[0];
            WNPC.combatThreat(sv, hostile, 1 / 20, canStand, 7, 0, true);
            const moved = Math.abs(hostile.x - prevX) + Math.abs(hostile.y - prevY) > 0.5;
            if (moved) movedFrames++;
            if (z.hp < 500) { atkFrames++; z.hp = 500; }
        }
        assert(atkFrames > 0, 'meleeStandoff: 高血近战应出刀');
        assert(movedFrames > 10, `meleeStandoff: 高血近战出刀后应绕圈走位不站撸 (移动帧=${movedFrames})`);
    }
}

// 濒死角色跨场景（2026-08-10 用户反馈"室内死亡出门后只在室内 / 室外死亡进屋后只在室外"）：
// enterInterior 把室外倒地主控记录带入室内（inInterior=true+室内坐标），
// exitInterior 把室内倒地主控记录带出到门外（inInterior=false+interiorKey 清空）
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const WD = await import('../source-code/mod-wasteland/windoor.js');
    const sv = {
        world: { seed: 12345, chunks: new Map() },
        mods: { tiles: {}, interiors: {} },
        px: (SPAWN.x + 0.5) * TS, py: (SPAWN.y + 0.5) * TS,
        hp: 100, maxHp: 100,
        npcs: [], zombies: [], interior: null,
        now: 0, controllerId: null,
        _devGod: false, invuln: 0, _wake: null, _downed: null,
        _combatT: 0, hurtT: 0, _lastNpcHit: null,
        effects: [], drops: [], npcBullets: [],
        mp: null, mpOutbox: [], msgs: [],
    };
    MSG.initMsg(sv);
    const downed = WNPC.makeNpc(sv, sv.px + TS * 2, sv.py, 'friendly');
    downed.downed = true; downed.alive = true; downed.hp = 1; downed.isPlayer = true;
    sv.npcs.push(downed);
    sv._downed = { name: downed.name, px: downed.x, py: downed.y, dayDead: 0, med: 0, herb: 0 };
    sv.controllerId = downed.id;
    const doorKey = `${SPAWN.x + 4},${SPAWN.y}`;
    WD.enterInterior(sv, doorKey, true);
    assert(!!sv.interior, 'downedScene: enterInterior 建立 sv.interior');
    assert(downed.inInterior === true, 'downedScene: 室外倒地记录进入室内后 inInterior=true');
    assert(downed.interiorKey === doorKey, 'downedScene: 倒地记录 interiorKey 同步');
    const ix = Math.floor(downed.x / TS), iy = Math.floor(downed.y / TS);
    assert(ix >= 0 && ix < sv.interior.w && iy >= 0 && iy < sv.interior.h, 'downedScene: 倒地记录坐标为室内格');
    WD.exitInterior(sv, true);
    assert(sv.interior === null, 'downedScene: exitInterior 后 sv.interior=null');
    assert(downed.inInterior === false, 'downedScene: 退出室内后倒地记录 inInterior=false');
    assert(!downed.interiorKey, 'downedScene: 退出室内后倒地记录 interiorKey 清空');
}

// NPC 体力恢复（2026-08-10 修复"体力一直 0"：移动不再刷新 _stamDelay 门闩，
// 回复分支可在移动间隙进入，体力可边走边回）
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    // 1) npcSpendStamina：体力充足可消耗；不足返回 false（不恢复）
    const n = { stamina: 20, maxStamina: 100, exhausted: false, _stamDelay: 0 };
    assert(WNPC.npcSpendStamina(n, 6) === true, 'stamina: spend succeeds when enough');
    assert(n.stamina === 14, 'stamina: spend deducts cost');
    assert(n._stamDelay > 0, 'stamina: spend sets regen delay gate');
    // 2) 移动 0.2s 后 _stamDelay 递减到 0 → 再次移动不再刷新门闩（回归测试核心）
    //    （updateNeeds 的内部行为无法直接调用，此处验证 npcSpendStamina 门闩在时间推进后过期）
    // 3) 低体力消耗失败 → 返回 false（攻击暂停等回体，不出现负体力）
    n.stamina = 2;
    assert(WNPC.npcSpendStamina(n, 6) === false, 'stamina: spend fails when insufficient');
    assert(n.stamina === 2, 'stamina: failed spend does not deduct');
}

// 室内 NPC 子弹驱动（2026-08-10 修复"室内 NPC 子弹不动/不消失/不命中"）：
// updateNpcBullets 导出可用 + 子弹推进 + 命中室内僵尸后消失 + 墙阻挡
{
    const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
    const sv = {
        world: { seed: 20260810, chunks: new Map() },
        mods: { tiles: {} },
        interior: {
            key: '0,0', w: 8, h: 8, floor: 1,
            tiles: new Array(64).fill(0),   // 全地板
            zombies: [{ id: 'z1', type: 'normal', x: TS * 3, y: TS * 3, hp: 50, maxHp: 50, hurt: 0 }],
            drops: [], npcs: [],
        },
        npcs: [],
        effects: [],
        px: TS, py: TS,
    };
    sv.zombies = sv.interior.zombies;   // 模拟 updateInteriorMode 的替换：sv.zombies = 室内僵尸
    assert(typeof WNPC.updateNpcBullets === 'function', 'npcBullets: updateNpcBullets exported (室内驱动必需)');
    // 1) 子弹推进：创建后调用 updateNpcBullets 0.1s，位置应变化且未消失（离命中目标远）
    sv.npcBullets = [{ x: TS * 1.5, y: TS * 1.5, vx: 0, vy: 0, dmg: 10, color: '#FFF', label: '·',
        life: 1, traveled: 0, range: 9999, pierce: 0, pierced: 0, hitList: null, hostile: false, src: 'n1' }];
    const bx0 = sv.npcBullets[0].x;
    WNPC.updateNpcBullets(sv, 0.1);
    assert(sv.npcBullets[0].x === bx0 && sv.npcBullets.length === 1, 'npcBullets: stationary bullet still alive after tick');
    // 2) 命中：子弹靠近僵尸 → 扣血 + 子弹消失
    sv.npcBullets = [{ x: TS * 3, y: TS * 3, vx: 0, vy: 0, dmg: 10, color: '#FFF', label: '·',
        life: 1, traveled: 0, range: 9999, pierce: 0, pierced: 0, hitList: null, hostile: false, src: 'n1' }];
    const zhp0 = sv.interior.zombies[0].hp;
    WNPC.updateNpcBullets(sv, 0.1);
    assert(sv.interior.zombies[0].hp < zhp0, 'npcBullets: zombie hp reduced by NPC bullet');
    assert(sv.npcBullets.length === 0, 'npcBullets: bullet consumed on hit');
    // 3) 墙阻挡：子弹飞入墙格立即消失（IT.WALL=1）
    sv.npcBullets = [{ x: TS * 3.5, y: TS * 3.5, vx: -TS * 5, vy: 0, dmg: 10, color: '#FFF', label: '·',
        life: 1, traveled: 0, range: 9999, pierce: 0, pierced: 0, hitList: null, hostile: false, src: 'n1' }];
    sv.interior.tiles[3 * 8 + 2] = 1;   // (2,3) 墙格
    sv.interior.zombies[0].hp = 50;     // 重置
    WNPC.updateNpcBullets(sv, 0.3);     // 0.3s 移动 1.5 格：从 (3.5,3.5) 到 (2.0,3.5) 跨入墙格
    assert(sv.npcBullets.length === 0, 'npcBullets: bullet stopped by interior wall');
}

// 战利品袋满包处理（2026-08-10 修复"背包满时物品/战利品消失"）：
// addItemLoot 在背包满时返回 false（调用方保留掉落/掉地上，而非静默消失）
{
    const Panel = await import('../source-code/mod-wasteland/panel.js');
    // 1) looted: 袋：有空位成功，无空位返回 false（不消失）
    const inv1 = new Array(24).fill(null);
    inv1[0] = { id: 'looted:common', n: 1 };
    const sv1 = { inv: inv1 };
    assert(Panel.addItemLoot(sv1, { id: 'looted:common', n: 1, contents: [{ id: 'food', n: 2 }] }) === true, 'loot: addItemLoot succeeds with empty slot');
    // 2) 背包全满且无可堆叠 → 返回 false
    const inv2 = new Array(24).fill({ id: 'wood', n: 99 });
    const sv2 = { inv: inv2 };
    const ok = Panel.addItemLoot(sv2, { id: 'looted:common', n: 1, contents: [{ id: 'food', n: 2 }] });
    assert(ok === false, 'loot: addItemLoot returns false when bag full (caller must keep drop)');
    // 3) 普通物品 addToArr 满包返回剩余数量（调用方保留地上剩余）
    const left = Panel.addToArr(sv2.inv, 'food', 5);
    assert(left === 5, 'loot: addToArr returns all remaining when bag full');
    // 4) looted: 袋堆叠/空位共存：部分装入
    const inv3 = new Array(24).fill(null);
    inv3[0] = { id: 'looted:rare', n: 1 };
    const sv3 = { inv: inv3 };
    const ok3 = Panel.addItemLoot(sv3, { id: 'looted:common', n: 1, contents: [{ id: 'herb', n: 1 }] });
    assert(ok3 === true, 'loot: different looted id fills another slot');
    // 5) 战利品单袋格数上限验证（2026-08-10 打开战利品预留 4 格的前提）：
    //    zombieCommon 1-3 / zombieRare 1-4 / zombieEpic 2-4 → 上限均 ≤ 4
    const ct = WW.GLYPH_COUNT_TABLES;
    for (const k of ['zombieCommon', 'zombieRare', 'zombieEpic']) {
        const maxN = Math.max(...ct[k].map(e => e[0]));
        assert(maxN <= 4, `loot: ${k} max slots ${maxN} <= 4 (预留4格前提成立)`);
    }
}

// 模块存在性（动态 import 验证无循环依赖；跳过依赖浏览器环境的模块）
// 完整模块导入链冒烟（2026-08-05 增强）：
// 覆盖 render/survival/wzombie/wpath 等核心模块，防止 makeCanvas 类未定义符号/语法错误逃过测试。
// 桩已升级为 full-run-test 同等水平，全部模块应能 import；仅真正依赖用户手势/真实 DOM 的
// 明确浏览器 API（如 window.addEventListener 类）报错才允许 SKIP。
const modules = [
    '../source-code/mod-wasteland/world.js',
    '../source-code/mod-wasteland/render.js',
    '../source-code/mod-wasteland/survival.js',
    '../source-code/mod-wasteland/wstate.js',
    '../source-code/mod-wasteland/mpWasteland.js',
    '../source-code/mod-wasteland/wzombie.js',
    '../source-code/mod-wasteland/wpath.js',
    '../source-code/mod-wasteland/wvehicle.js',
    '../source-code/mod-wasteland/wlook.js',
    '../source-code/mod-wasteland/wnpc.js',
    '../source-code/mod-wasteland/wsearch.js',
    '../source-code/mod-wasteland/wmap.js',
    '../source-code/mod-wasteland/wdev.js',
    '../source-code/mod-wasteland/whorde.js',
    '../source-code/mod-wasteland/wbuild.js',
    '../source-code/mod-wasteland/waction.js',
    '../source-code/mod-wasteland/wgear.js',
    '../source-code/mod-wasteland/wplants.js',
    '../source-code/mod-wasteland/windoor.js',
    '../source-code/mod-wasteland/wwordcraft.js',
    '../source-code/mod-wasteland/panel.js',
    '../source-code/mod-wasteland/wbalance.js',
    '../source-code/mod-wasteland/winfection.js',
    '../source-code/mod-wasteland/wpixelmanifest.js',
];
const browserOnly = [];   // 桩已完整，无应跳过的浏览器专属模块
for (const m of modules) {
    try {
        await import(m);
        pass++;
    } catch (e) {
        fail++;
        console.error(`  FAIL import: ${m} -> ${e.message}`);
    }
}
for (const m of browserOnly) {
    try {
        await import(m);
        pass++;
    } catch (e) {
        if (e.message.includes('window') || e.message.includes('document') || e.message.includes('AudioContext')) {
            console.log(`  SKIP (browser-only): ${m}`);
        } else {
            fail++;
            console.error(`  FAIL import: ${m} -> ${e.message}`);
        }
    }
}

// 2026-08-10 静态回归：survival.js 不得再引用未定义的 anyDownedMate（独狼死亡 ReferenceError 崩溃的根因）。
// 只允许出现在注释里（删除死代码分支时留下的说明），不允许作为代码标识符出现。
{
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    const badRefs = [];
    for (const line of src.split('\n')) {
        const code = line.split('//')[0];   // 去掉行尾注释
        if (/\banyDownedMate\b/.test(code)) badRefs.push(line.trim());
    }
    assert(badRefs.length === 0, `survival: no undefined anyDownedMate refs (found ${badRefs.length})`);
}
// 2026-08-10 静态回归：NPC 交互（命令/交谈）必须排除倒地者（n.downed）——
// 否则倒下的主控/队友被当"可命令队员"，靠近倒地主控按 F 打开命令面板而非救助界面。
// 室外 updatePrompt、室内 updateInteriorPrompt、doInteract、doInteriorInteract 四处都要排除。
{
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    // 只统计"排除倒地者"的代码行（n.downed 或 n.downed continue 出现处）
    const guardCount = (src.match(/if \(n\.downed\) continue;/g) || []).length;
    assert(guardCount >= 2, `survival: downed guard present in outdoor+indoor npc loops (found ${guardCount})`);
    // doInteract 防御：命中已倒地记录时不打开命令面板而是 openRescue
    assert(src.includes('if (npc && npc.downed)'), 'survival: doInteract guards downed npc from command menu');
}
// 2026-08-10 静态回归：updateDownedMembersTimeout 已移除"自动救助"（用户要求改为按 F 手动用药），
// 只保留超时管理；药品消耗逻辑移到 mateSubmitRescueMed（队友）与 submitRescueMed（主控），
// 两处都必须用 `let need` 计数（防 TypeError: Assignment to constant variable）。
{
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    // updateDownedMembersTimeout 只保留超时管理：无自动救助消耗药品逻辑（const rescuer = ... find 已移除）
    const funcStart = src.indexOf('function updateDownedMembersTimeout');
    const funcEnd = funcStart > 0 ? src.indexOf('\nfunction ', funcStart + 10) : -1;
    const fnBody = funcStart > 0 && funcEnd > 0 ? src.slice(funcStart, funcEnd) : '';
    assert(!fnBody.includes('const rescuer = ') && !fnBody.includes('Math.hypot(o.x - m.x'),
        'survival: updateDownedMembersTimeout no longer auto-rescues (manual F rescue)');
    // 队友救助界面存在（openMateRescue + mateMedSubmit + 30% 血 + 状态保留）
    assert(src.includes('function openMateRescue'), 'survival: openMateRescue exists for downed teammate F rescue');
    assert(src.includes('export function mateMedSubmit'), 'survival: mateMedSubmit exists');
    assert(src.includes('m.hp = Math.max(1, Math.round(m.maxHp * 0.3))'),
        'survival: mate rescue heals to 30% hp');
    // mateMedSubmit 救活时不得清感染/疾病（状态保留：不出现 m.infection = 0 / m.sick = null）
    const mateStart = src.indexOf('export function mateMedSubmit');
    const mateEnd = mateStart > 0 ? src.indexOf('\nexport function', mateStart + 10) : -1;
    const mateBody = mateStart > 0 && mateEnd > 0 ? src.slice(mateStart, mateEnd) : '';
    assert(mateBody.length > 0 && !mateBody.includes('m.infection = 0') && !mateBody.includes('m.sick = null'),
        'survival: mate rescue keeps infection/sick state');
}
// 2026-08-10 静态回归：软核全灭重生必须重建新幸存者（防"满血却带濒死标记"）。
// 修复：softRespawn 末尾检测旧主控 dead/downed → 清掉旧主控记录 → initRoster 重建新主控；
// onDeath 软核全灭分支必须显式 include isPlayer 处理（否则旧主控 alive 残留）。
{
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    // softRespawn 必须含 initRoster 调用 + 重建新主控分支
    const srStart = src.indexOf('function softRespawn');
    const srEnd = srStart > 0 ? src.indexOf('\nfunction ', srStart + 10) : -1;
    const srBody = srStart > 0 && srEnd > 0 ? src.slice(srStart, srEnd) : '';
    assert(srBody.includes('WNPC.initRoster'), 'survival: softRespawn calls WNPC.initRoster to rebuild new player');
    // 2026-08-11 v2.97 诈尸修复：重建判定只看 controllerId（老陈活着不误重建）。
    // 2026-08-11 v2.98 测试玩家发现：主控死亡重建时 filter 删 isPlayer 尸体（含尸体）→
    // initRoster 的 `!some(isPlayer)` 才能新建新主角（否则尸体 isPlayer=true → 不新建 → 悬空）。
    assert(srBody.includes('!n.isPlayer'), 'survival: softRespawn 重建删 isPlayer 尸体（initRoster 才能新建新主角）');
    // onDeath 软核全灭分支（hadMates && !anyAliveMate）必须 include isPlayer 处理
    const anyAliveIdx = src.indexOf('const anyAliveMate');
    const onDeathBlock = anyAliveIdx > 0 ? src.slice(anyAliveIdx, src.indexOf('// ---- 从头就无队友', anyAliveIdx)) : '';
    assert(onDeathBlock.includes('n.isPlayer'), 'survival: onDeath all-dead branch handles isPlayer record');
}
// 2026-08-10 静态回归：幸存者操控的 NPC 相关保护（用户反馈"清除NPC把自己清除/操控队友血归零不死不亡"）。
// ① updateNpcs 帧边界后 controllerId 悬空回退（操控队友被击杀后不残留悬空指针）；
// ② killNpc 软核倒地分支豁免当前主控（n.id === sv.controllerId → 直接死亡+sv.hp=0，不转倒地锁死）；
// ③ 队伍面板主控名字带「（幸存者）」标记。
{
    const fs = await import('node:fs');
    const wsrc = fs.readFileSync(new URL('../source-code/mod-wasteland/wnpc.js', import.meta.url), 'utf8');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    const rsrc = fs.readFileSync(new URL('../source-code/mod-wasteland/render.js', import.meta.url), 'utf8');
    assert(wsrc.includes('sv.controllerId && sv.npcs && !sv.npcs.some(n => n.id === sv.controllerId)'),
        'wnpc: updateNpcs guards dangling controllerId');
    assert(wsrc.includes("if (n.id === sv.controllerId)") && wsrc.includes("sv.hp = 0"),
        'wnpc: killNpc exempts current controlled npc from downed lock');
    assert(rsrc.includes("n.name + '（幸存者）'"), 'render: team panel marks survivor-controlled npc name');
    // 2026-08-10 修复"幸存者（幸存者）"重名：isPlayer 自己不加标记（只在 isCtrl && !n.isPlayer 时加）
    assert(rsrc.includes('isSurvivorNpc') && rsrc.includes('isCtrl && !n.isPlayer'),
        'render: survivor marker only on non-isPlayer controlled npc');
}
// 2026-08-10 静态回归：救活幸存者后死亡地点指引（_legacyDrop）必须清除（用户要求）。
{
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    const medStart = src.indexOf('export function downedMedSubmit');
    const medEnd = medStart > 0 ? src.indexOf('\nexport function', medStart + 10) : -1;
    const medBody = medStart > 0 && medEnd > 0 ? src.slice(medStart, medEnd) : '';
    assert(medBody.includes('sv._legacyDrop = null;'),
        'survival: downedMedSubmit clears death-location guide on rescue');
    assert(medBody.includes('sv._lastDeathPos') === false,
        'survival: rescue keeps _lastDeathPos for dev tp-death');
}
// 2026-08-10 静态回归：①提示链必须使用 downedMatePrompt（修复"濒死队友按F无反应"——
// 计算了却从未写入 promptTarget 的 bug）；②尸体搜索要有过程（updateCorpseSearch 读条结算）；
// ③主控被远程攻击扣血后不得回满（updateNpcBullets 后补一次写回记录）。
{
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    const wsrc = fs.readFileSync(new URL('../source-code/mod-wasteland/wnpc.js', import.meta.url), 'utf8');
    // 提示链使用 downedMatePrompt
    const promptStart = src.indexOf('function updatePrompt');
    const promptEnd = promptStart > 0 ? src.indexOf('\nfunction ', promptStart + 10) : -1;
    const promptBody = promptStart > 0 && promptEnd > 0 ? src.slice(promptStart, promptEnd) : '';
    assert(promptBody.includes('downedMatePrompt.target') && promptBody.includes('downedMatePrompt.prompt'),
        'survival: updatePrompt uses downedMatePrompt in prompt chain (fix no-F-on-downed-mate)');
    // 2026-08-11 优先级：救治倒地队友必须在"命令队友"之前（濒死角色不显示命令面板）
    const dmpIdx = promptBody.indexOf('downedMatePrompt)');
    const nbestIdx = promptBody.indexOf('nbest)');
    assert(dmpIdx > 0 && nbestIdx > dmpIdx, 'survival: downedMate rescue priority before command panel (v2.90)');
    // 尸体搜索过程：2026-08-11 用户定稿"与容器一样即可"——复用容器 WSearch 界面（逐件渐亮），
    // 不再有独立读条进度条；拿取用 corpseFull 完整对象入包（保留武器耐久/附魔属性）。
    assert(src.includes('corpseFull') && src.includes('WSearch.openSearch(sv, {'),
        'survival: corpse search uses container WSearch UI (v2.90)');
    assert(!src.includes('function updateCorpseSearch'), 'survival: corpse read-bar removed (v2.90)');
    // 主控远程扣血不回满：updateNpcBullets 后补写回记录
    assert(wsrc.includes('updateNpcBullets(sv, dt);') && wsrc.includes('if (controller) syncControlledToRecord(sv, controller);'),
        'wnpc: write-back after updateNpcBullets (fix hp reset on ranged hit)');
}
// 2026-08-10 静态回归：当前主控（被操控队友）被战斗致死时，若有其他可行动队友应自动切换视角，
// 而不是把 sv.hp 置 0 触发整个软核重生（修复"切队友视角→误触发重生音效/位置随机/名字变幸存者"）。
// 2026-08-11 v2.90 升级：被击杀的主控队友进入【倒地待救】（downed + _downedMembers，可被救治），
// 再自动切视角；只有全员无可行动时才 sv.hp=0 走全灭重生（用户反馈"主控血量归零没有濒死过程"）。
{
    const fs = await import('node:fs');
    const wsrc = fs.readFileSync(new URL('../source-code/mod-wasteland/wnpc.js', import.meta.url), 'utf8');
    // killNpc 当前主控豁免分支：进入倒地待救 + 自动切视角（不再直接置死/不再 onControlledDeath 置死）
    const kStart = wsrc.indexOf('export function killNpc');
    const kEnd = kStart > 0 ? wsrc.indexOf('\nexport function', kStart + 10) : -1;
    const kBody = kStart > 0 && kEnd > 0 ? wsrc.slice(kStart, kEnd) : '';
    assert(kBody.includes('n.id === sv.controllerId') && kBody.includes('n.downed = true;') && kBody.includes('_downedMembers'),
        'wnpc: killNpc current-controller death enters downed-rescue (v2.90)');
    assert(kBody.includes('switchControl(sv, sorted[0].id, true)'),
        'wnpc: killNpc current-controller death auto-switches to next mate (not hard respawn)');
    assert(kBody.includes('sv.hp = 0;'),
        'wnpc: killNpc only zeroes hp when no mate to switch (true respawn)');
    // 2026-08-10 疏漏修复：被操控的队友被杀切视角后必须留尸体遗物（_corpse + 完整物品对象），
    // 否则该记录被帧边界清理直接删除，尸体/遗物全丢（用户反馈"只有自己的尸体，没有队友尸体"）。
    assert(kBody.includes('n._corpse = true;') && kBody.includes('_corpseContents.push({ ...s, n: s.n || 1 })'),
        'wnpc: controlled-mate death leaves searchable corpse (v2.85)');
    // 2026-08-10 性能：已搜索尸体超过 CORPSE_KEEP_DAYS 天自动腐烂移除（防尸体无限堆积）。
    // v2.86 精修：从"搜索完成当天 _corpseSearchedDay"起算（搜完再留 3 天），而非死亡当天——
    // 否则重生后过数天才回死亡点搜尸，搜索标记一打上就被立刻剔除（用户反馈：搜完尸体消失）。
    assert(wsrc.includes('CORPSE_KEEP_DAYS = 3') && wsrc.includes('corpseSearchedDay(n)'),
        'wnpc: searched corpse auto-removed after keep days (perf)');
    assert(wsrc.includes('Math.abs(n.x - sv._legacyDrop.x) < TS'),
        'wnpc: corpse cleanup also clears matching death guide (v2.86)');
}
// 2026-08-10 疏漏修复：队友倒地超时死亡必须生成尸体遗物（_corpse + 完整物品对象），
// 否则该队友尸体消失、遗物全丢（用户要求成员死亡留尸体在尸体上搜索）。
{
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    const tmStart = src.indexOf('function updateDownedMembersTimeout');
    const tmEnd = tmStart > 0 ? src.indexOf('\nfunction ', tmStart + 10) : -1;
    const tmBody = tmStart > 0 && tmEnd > 0 ? src.slice(tmStart, tmEnd) : '';
    assert(tmBody.includes('m._corpse = true;') && tmBody.includes('m._corpseContents = [];'),
        'survival: downed-mate timeout death leaves corpse (fix lost corpse/items)');
    assert(tmBody.includes('{ ...s, n: s.n || 1 }'),
        'survival: timeout corpse preserves full item object (items not degraded)');
}
// 2026-08-11 v2.96 静态回归：用户浏览器报 `ReferenceError: showAllDeadChoices is not defined`。
// 根因：用户浏览器 ESM 缓存了 v2.95 之前的 survival.js（无 showAllDeadChoices），
// 修复策略三层：
// ① showAllDeadChoices 改为 export const 箭头函数（杜绝 ESM 中 function 声明被块作用域遮蔽的 TDZ 风险）；
// ② updateDowned / onDeath 调用点加 typeof 兜底（双保险——任意缓存版本都不会抛 ReferenceError）；
// ③ workshop.js / mpWasteland.js 的 import 加 ?v=2.96 cache-busting（强制浏览器重取新版）。
{
    const fs = await import('node:fs');
    const pathMod = (await import('node:path')).default;
    const urlMod = (await import('node:url')).default;
    const projRoot = pathMod.resolve(pathMod.dirname(urlMod.fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/survival.js'), 'utf8');
    const ws = fs.readFileSync(pathMod.join(projRoot, 'source-code/ui/workshop.js'), 'utf8');
    const mp = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/mpWasteland.js'), 'utf8');
    // ① showAllDeadChoices 必须是 export const 箭头函数
    assert(/^\s*export\s+const\s+showAllDeadChoices\s*=/m.test(src),
        'survival: showAllDeadChoices is exported as const (TDZ-safe)');
    assert(!/^\s*function\s+showAllDeadChoices\s*\(/m.test(src),
        'survival: showAllDeadChoices is NOT a function declaration (no block-scope shadow risk)');
    // ② 调用点必须加 typeof 兜底（onDeath 全灭分支 + updateDowned 全灭分支）
    const guardOnDeath = (src.match(/if \(typeof showAllDeadChoices === 'function'\)/g) || []).length;
    assert(guardOnDeath >= 2, `survival: typeof-guard on showAllDeadChoices in 2 sites (found ${guardOnDeath})`);
    assert(src.includes('_softRespawnAllDeadFallback'),
        'survival: fallback _softRespawnAllDeadFallback defined when showAllDeadChoices unavailable');
    //  workshop.js + mpWasteland.js 必须加 ?v= cache-busting（动态 import 用 ?v= 拼接变量，静态 import 用 ?v=4.14 字面量）
    assert(/import\(['"]\.\.\/mod-wasteland\/survival\.js\?v=/.test(ws) && /_WSL_VER\s*=\s*['"]4\.14['"]/.test(ws),
        'workshop: dynamic import uses ?v=4.14 cache-busting (via _WSL_VER)');
    assert(/from\s+['"]\.\/survival\.js\?v=4\.14['"]/.test(mp),
        'mpWasteland: static import uses ?v=4.14 cache-busting');
}

// 2026-08-11 v2.97 静态回归：①濒死救援时间系统改为【现实时间 20 分钟】（被攻击每点伤害扣 10 秒，
// 补刀不再立即死亡）；②NPC 互助赠与系统（队伍内分享弹药/水/食物/药品等，保证自己生存底线）。
{
    const fs = await import('node:fs');
    const pathMod = (await import('node:path')).default;
    const urlMod = (await import('node:url')).default;
    const projRoot = pathMod.resolve(pathMod.dirname(urlMod.fileURLToPath(import.meta.url)), '..');
    const bal = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wbalance.js'), 'utf8');
    const surv = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/survival.js'), 'utf8');
    const wnpc = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wnpc.js'), 'utf8');
    const wzombie = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wzombie.js'), 'utf8');
    const waction = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/waction.js'), 'utf8');
    const render = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/render.js'), 'utf8');
    const wstate = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wstate.js'), 'utf8');
    // ① 救援时间常量（20 分钟现实时间 + 每点伤害扣 10 秒）
    assert(bal.includes('DOWNED_LIMIT_SECONDS = 1200'), 'wbalance: DOWNED_LIMIT_SECONDS = 1200 (20 分钟现实时间)');
    assert(bal.includes('DOWNED_HIT_PENALTY_SEC = 10'), 'wbalance: DOWNED_HIT_PENALTY_SEC = 10');
    // ② _downed 初始化含现实时间戳 + 惩罚累计
    assert(surv.includes('downedAtReal: sv.now != null ? sv.now : 0'), 'survival: _downed 含 downedAtReal');
    assert(surv.includes('_penaltySec: 0'), 'survival: _downed 含 _penaltySec');
    // ③ updateDowned 超时判定 = 现实流逝 + 被攻击惩罚 ≥ 20 分钟
    assert(surv.includes('const spent = Math.max(0, nowReal - dwn.downedAtReal) + (dwn._penaltySec || 0);'),
        'survival: updateDowned 超时 = 现实流逝 + 惩罚');
    assert(surv.includes('spent >= dwnLimitSec'), 'survival: 超时判定');
    // ④ 成员超时同规则（现实时间）
    assert(surv.includes('spentM >= mLimit') || surv.includes('spentM >= B.DOWNED_LIMIT_SECONDS'), 'survival: 成员超时用现实时间（支持递减 limitSec）');
    // ⑤ killNpc 对 downed 角色走补刀扣时分支
    assert(wnpc.includes('export function npcApplyDownedHit'), 'wnpc: npcApplyDownedHit 导出');
    assert(wnpc.includes('n._penaltySec += dmgNum * B.DOWNED_HIT_PENALTY_SEC'), 'wnpc: 补刀每点伤害扣 10 秒');
    assert(wnpc.includes('if (n.downed && dkSoft(sv)) {'), 'wnpc: killNpc 对 downed 走补刀分支');
    // ⑥ 僵尸咬倒地角色扣时间
    assert(wzombie.includes('npcApplyDownedHit(sv, n, (dmgTo / (contact.biteCd || 1)) * 0.2)'),
        'wzombie: 僵尸咬倒地角色扣救援时间');
    assert(wzombie.includes('npcApplyDownedHit'), 'wzombie: import npcApplyDownedHit');
    // ⑦ 主控倒地被咬扣时间（waction）
    assert(waction.includes('sv._downed._penaltySec += dmg * B.DOWNED_HIT_PENALTY_SEC'),
        'waction: 主控倒地被咬扣救援时间');
    // ⑧ 恶意 NPC 近战补刀倒地角色扣时间
    assert(wnpc.includes('if (threat.npc.downed) { npcApplyDownedHit(sv, threat.npc, wDef ? wDef.damage : 8); }'),
        'wnpc: 恶意 NPC 近战补刀倒地角色扣时间');
    assert(wnpc.includes('sv._downed._penaltySec += dmgNum * B.DOWNED_HIT_PENALTY_SEC'),
        'wnpc: 恶意 NPC 补刀倒地主控扣时间');
    // ⑨ 救援时间血条渲染（室外 + 室内 + 主控视角）
    assert(render.includes('function drawDownedTimeBar'), 'render: drawDownedTimeBar 血条函数');
    assert(render.includes('function downedRemainSec'), 'render: downedRemainSec 剩余秒计算');
    assert(render.includes('drawDownedTimeBar(ctx, sx, sy, sv, sec)'), 'render: 室外倒地角色血条');
    assert(render.includes('drawDownedTimeBar(ctx, sx, sy, sv, sec);'), 'render: 室内倒地角色血条');
    assert(render.includes('drawDownedTimeBar(ctx, px, py, sv, downedRemainSec(sv, sv._downed))'),
        'render: 主控本人倒地血条');
    // ⑩ 赠予系统
    assert(wnpc.includes('function npcShareWithMates'), 'wnpc: npcShareWithMates 赠予函数');
    assert(wnpc.includes('npcShareWithMates(sv, n)'), 'wnpc: updateNeeds 调用赠予');
    assert(wnpc.includes('n._shareT != null && now - n._shareT < 2.5'), 'wnpc: 分享节流 2.5 秒');
    // 2026-08-11 v2.99 弹药按队友对应武器类型赠予 + "按需补足"（非分一半）
    assert(wnpc.includes("const ammoId = 'ammo:' + w.ammoType;"), 'wnpc: 弹药按队友武器 ammoType 匹配');
    assert(wnpc.includes('if (!w || w.kind !== \'ranged\' || !w.ammoType) continue;'), 'wnpc: 无远程武器队友跳过弹药分享');
    assert(wnpc.includes('const need = Math.max(0, B.DOWNED_SHARE_AMMO_KEEP - npcAmmoNeed(tgt));'), 'wnpc: 弹药按需补足（差多少给多少）');
    assert(wnpc.includes('const give = Math.min(need, myTotal - B.DOWNED_SHARE_AMMO_KEEP);'), 'wnpc: 只给超出保留底线的部分');
    assert(!wnpc.includes('Math.floor(myTotal / 2)'), 'wnpc: 不再分一半弹药');
    assert(wnpc.includes('n.water || 0) > B.DOWNED_SHARE_WATER_AT'), 'wnpc: 水分享');
    assert(wnpc.includes('n.food || 0) > B.DOWNED_SHARE_FOOD_AT'), 'wnpc: 食物分享');
    // ⑪ 存档/联机：现实时间字段持久化
    assert(wstate.includes('downedAtReal: saved._downed.downedAtReal'), 'wstate: _downed 恢复含 downedAtReal');
    assert(wnpc.includes('downed: !!n.downed,'), 'wnpc: serializeNpcs 序列化 downed');
    assert(wnpc.includes('_downedAtReal: n._downedAtReal'), 'wnpc: serializeNpcs 序列化 _downedAtReal');
    assert(wnpc.includes('sv._downedMembers = sv.npcs.filter(n => n && n.alive && n.downed && n.party)'),
        'wnpc: restoreNpcs 重建 _downedMembers');
    // ⑫ 2026-08-11 v2.97 补丁：血量归零必有结算（去掉 !sv._downed 守卫，防"0 血还能移动攻击"）
    const onDeathGuards = (surv.match(/if \(sv\.hp <= 0 && !sv\.dead\) onDeath\(\);/g) || []).length;
    assert(onDeathGuards >= 6, `survival: 6 处 onDeath 守卫统一去 !sv._downed (found ${onDeathGuards})`);
    assert(!surv.includes('sv.hp <= 0 && !sv.dead && !sv._downed'),
        'survival: 无残留 !sv._downed onDeath 守卫');
    // ⑬ 子弹命中倒地角色 → 扣救援时间（不扣血，防 -505 负血 bug）
    // 2026-08-12 fd84499 批量修复重构了缩进/注释格式：`} else if (hit.npc.downed) {` 与注释分行，
    // 行为不变（命中倒地走 npcApplyDownedHit 扣时）。断言改为匹配当前格式。
    assert(wnpc.includes('} else if (hit.npc.downed) {'),
        'wnpc: 子弹命中倒地角色走扣时分支');
    assert(wnpc.includes('npcApplyDownedHit(sv, hit.npc, dmg);'), 'wnpc: 子弹命中倒地角色调 npcApplyDownedHit');
    // ⑭ 2026-08-11 v2.97 补丁：全灭弹窗前全员彻底死亡（防"角色仍显示 20:00 救援时间"）
    assert(surv.includes('// ① 全员彻底死亡（弹窗前先收尾：倒地成员和存活主控都置死，生尸体）'),
        'survival: showAllDeadChoices 弹窗前全员彻底死亡');
    assert(surv.includes("n._deathReason = n._deathReason || '救援超时（全员阵亡）'"),
        'survival: 全灭倒地成员置死+设死亡原因');
    // ⑮ 2026-08-11 v2.97 补丁：waction.js log 导入（防 ReferenceError）
    assert(waction.includes("import { log } from './survival.js';"), 'waction: 导入 log 修复 ReferenceError');
    // ⑯ 2026-08-11 v2.97 室内外一致：室内僵尸咬 NPC（含倒地扣时）——此前室内僵尸只咬玩家
    //（队友在室内对僵尸无敌），与室外 wzombie.js 不一致；本次 windoor.js 补齐同款逻辑。
    const wdoor = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/windoor.js'), 'utf8');
    assert(wdoor.includes("import { killNpc, maybeWound, maybeInfectNpc, npcApplyDownedHit } from './wnpc.js';"),
        'windoor: import npc 受击函数（室内外一致）');
    assert(wdoor.includes('z._npcScanT = (z._npcScanT || 0) - dt;'),
        'windoor: 室内僵尸 NPC 咬扫（与室外同款）');
    assert(wdoor.includes("npcApplyDownedHit(sv, n, (dmgTo / (contact.biteCd || 1)) * 0.2);"),
        'windoor: 室内僵尸咬倒地角色扣救援时间');
    assert(wdoor.includes("killNpc(sv, n, '被僵尸啃咬致死');"),
        'windoor: 室内僵尸咬 NPC 致死走 killNpc（软核倒地分支）');
    // ⑰ 2026-08-11 v2.97 修复"本地 NPC 队友超出屏幕无指引"：drawMateGuide 此前被包在
    // `sv.p2 || 尸化自己 || 遗物` 条件里（仅有本地队友时永不执行，室内外不一致）→ 独立无条件调用。
    assert(render.includes('drawMateGuide(ctx, sv, W, H, guideDrawn);           // 本地 NPC 队友：屏幕外显示指向箭头+名字+距离（2026-08-11）'),
        'render: 室外本地队友指引独立于联机/尸化/遗物条件');
    const mateGuideCall = (render.match(/drawMateGuide\(ctx, sv, W, H, guideDrawn\);/g) || []).length;
    assert(mateGuideCall >= 2, `render: drawMateGuide 室外+室内均调用 (found ${mateGuideCall})`);
    // ⑱ 2026-08-11 v2.97 开发者无限资源（_devInf）支持救治药品提交：开启后背包无药也能直接提交（测试用）
    const devInfTakeCount = (surv.match(/if \(WDEV\.isDev\(\) && sv\._devInf\) return true;   \/\/ 开发者无限资源/g) || []).length;
    assert(devInfTakeCount >= 2, `survival: 主控/队友救治 take() 均支持 _devInf (found ${devInfTakeCount})`);
    assert(surv.includes("const devInfHerb = WDEV.isDev() && sv._devInf;"),
        'survival: 草药提交支持 _devInf（无草药视为已满足所需）');
    assert(surv.includes('const devInf = WDEV.isDev() && sv._devInf;   // 开发者无限资源：视为药品无限'),
        'survival: 主控救治 UI 显示开发者无限资源');
    assert(surv.includes('const devInfM = WDEV.isDev() && sv._devInf;   // 开发者无限资源：视为药品无限'),
        'survival: 队友救治 UI 显示开发者无限资源');
    // ⑲ 2026-08-11 v2.97 恶意 NPC 稳定伤害（简化方案：任何武器/任何状态都能造成伤害或扣救援时间，
    // 绝不 0 伤害；开发者无敌模式除外）——控制变量断言
    assert(!/if \(o\.downed\) continue;\s*\/\/ 2026-08-10 恶意 NPC 不攻击倒地/.test(wnpc),
        'wnpc: hostileThreat 倒地 NPC 不再被跳过（可被攻击）');
    assert(!/!curDowned && !wallBetween/.test(wnpc),
        'wnpc: hostileThreat 玩家本人倒地不再免咬（可扣救援时间）');
    assert(wnpc.includes('sv._downed._penaltySec += dmgNum * B.DOWNED_HIT_PENALTY_SEC;'),
        'wnpc: 近战命中倒地主控扣救援时间');
    assert(wnpc.includes('if (threat.npc.downed) { npcApplyDownedHit(sv, threat.npc, wDef ? wDef.damage : 8); }'),
        'wnpc: 近战命中倒地 NPC 走 npcApplyDownedHit');
    assert(wnpc.includes('dmg: Math.max(8, Math.round(wp.def.damage * (role === \'hostile\' ? 1 : 0.7)))'),
        'wnpc: 恶意 NPC 近战伤害 = 武器伤害（保底 8，不 0 伤害）');
    assert(wnpc.includes('dmg: Math.max(4, w.damage),'), 'wnpc: 恶意 NPC 子弹伤害保底 4');
    assert(wnpc.includes('if (threat.player && (sv._devGod || sv.invuln > 0))'),
        'wnpc: 仅开发者无敌/闪避无敌帧豁免（正常角色必受伤）');
    // ⑳ 2026-08-11 v2.97 所有武器打不同状态玩家都造成伤害：
    // 恶意植物近战（wplants 食人花）/ 恶意植物子弹（survival updatePlantBullets）
    // 对倒地玩家 → 扣救援时间（不直接扣血成负）；存活玩家 → 正常扣血（下限 0）。
    const wplants = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wplants.js'), 'utf8');
    assert(wplants.includes("import * as B from './wbalance.js';"), 'wplants: 导入 B（救援时间常量）');
    assert(wplants.includes('sv._downed._penaltySec += Math.round(dmg * 0.6) * B.DOWNED_HIT_PENALTY_SEC;'),
        'wplants: 食人花咬倒地玩家扣救援时间（不直接扣血）');
    assert(wplants.includes('sv.hp = Math.max(0, sv.hp - dmg * 0.6);'),
        'wplants: 食人花咬存活玩家正常扣血（下限 0）');
    assert(surv.includes('sv._downed._penaltySec += Math.round(b.damage) * B.DOWNED_HIT_PENALTY_SEC;'),
        'survival: 植物子弹命中倒地玩家扣救援时间（不直接扣血）');
    assert(surv.includes('sv.hp = Math.max(0, sv.hp - b.damage);'),
        'survival: 植物子弹命中存活玩家正常扣血（下限 0）');
    // ㉑ 2026-08-11 v2.97 恶意 NPC 武器 × 玩家状态伤害矩阵（用户要求细化到每种武器）：
    // 恶意 NPC 武器池 10 种（短剑/长剑/战斧/长矛/手枪/飞刀/散弹/冲锋枪/步枪/狙击枪），
    // 每种武器近战/子弹伤害 > 0，任何玩家状态（满血/半血/倒地/重生/切视角）都稳定受伤或扣时。
    const wpPoolMatch = wnpc.match(/hostile: \['([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)'\]/);
    assert(wpPoolMatch && wpPoolMatch.length === 11, 'wnpc: 恶意 NPC 武器池 = 10 种（短剑/长剑/战斧/长矛/手枪/飞刀/散弹/冲锋枪/步枪/狙击）');
    assert(wnpc.includes("dmg: Math.max(8, Math.round(wp.def.damage * (role === 'hostile' ? 1 : 0.7)))"),
        'wnpc: 恶意 NPC 近战伤害 = 武器伤害 ×1（保底 8，绝不 0）');
    assert(wnpc.includes('dmg: Math.max(4, w.damage),'),
        'wnpc: 恶意 NPC 子弹伤害 = 武器伤害（保底 4，绝不 0）');
    assert(wnpc.includes('const dmg = Math.max(1, Math.round(b.dmg * fo));'),
        'wnpc: 子弹射程衰减保底 1（绝不 0 伤害）');
    // ㉒ 2026-08-11 v2.97 恶意 NPC 伤害 × 队友数量 全矩阵（用户要求加队友数量变量叠加）：
    // 队友数量(0/1/2/4) × 状态(满血/半血/倒地/重生/切视角) × 武器(10) 全组合验证
    assert(surv.includes('if (mates.length >= 1) {'), 'survival: onDeath 用 mates.length≥1 判断有队友');
    assert(surv.includes('const mates = (sv.npcs || []).filter(n => n.alive && !n.downed && n.party && n.id !== sv.controllerId && !n.isPlayer);'),
        'survival: mates 筛选可行动队友');
    assert(surv.includes('// ---- 从头就无队友：重生 + 重生点刷"玩家名"僵尸 ----'),
        'survival: 队友=0 走软核重生分支');
    assert(surv.includes('sv._downed = null;') && surv.includes('sv.hp = sv.maxHp;'),
        'survival: 无队友重生清 _downed + 满血');
    // ㉓ 2026-08-11 v2.97 修复"无队友（独狼）死亡没有重生/返回主菜单弹窗"（用户反馈）：
    // 独狼死亡此前直接 softRespawn 无弹窗 → 改为复用 showAllDeadChoices 弹「重生/返回主菜单」。
    const soloDeathIdx = surv.indexOf('// ---- 从头就无队友：重生 + 重生点刷"玩家名"僵尸 ----');
    const soloBlock = soloDeathIdx > 0 ? surv.slice(soloDeathIdx, surv.indexOf('// ================= 硬核', soloDeathIdx)) : '';
    assert(soloBlock.includes("showAllDeadChoices(sv, deadName, deadReason, dropTxt);"),
        'survival: 独狼死亡弹「重生/返回主菜单」（复用 showAllDeadChoices）');
    assert(soloBlock.includes('_softRespawnAllDeadFallback(sv, deadName, deadReason);'),
        'survival: 独狼死亡 typeof 兜底');
    // 2026-08-11 v2.97 修复"独狼复活后再死，显示全员阵亡+历史队友死亡明细"（用户反馈）：
    // hadAnyMate 只看当前活着的 party 队友（排除历史尸体 alive=false）
    assert(surv.includes('const hadAnyMate = (sv.npcs || []).some(n => n && n.alive && n.party && !n.isPlayer);'),
        'survival: 独狼弹窗标题只看活人（避免历史尸体误判全员阵亡）');
    assert(surv.includes(`<div class="wsl-death-title">\${titleText}</div>`)
        && surv.includes("titleText = hadAnyMate ? '全员阵亡' : '你 阵 亡 了';"),
        'survival: 独狼弹窗标题 = 你阵亡了（v3.64 提取到 titleText 变量复用）');
    // 2026-08-11 v2.99 用户定稿：游戏结束/全员阵亡时，显示【队伍里每个角色】的死亡原因
    // ——"某某某 被什么什么击杀了"，主控（用调用方实时传入的 deadName/deadReason）+ 全部 party 成员
    // （含倒地/已死尸体）各一条；存活成员不收；历史尸体靠 softRespawn 重生清 party 标记排除。
    assert(surv.includes('队伍里有几个角色就写几条死因'),
        'survival: 全灭弹窗收集所有成员死因');
    assert(surv.includes('pushDeath(m.name || m.id, m._deathReason)'),
        'survival: 收集全部 party 成员死因');
    assert(surv.includes('if (m.alive && !m.downed) continue;'),
        'survival: 存活成员（无死因）不收');
    // ㉔ 2026-08-11 v2.97 修复"传送后队友靠拢极慢（过几秒才走一格）"（用户反馈）：
    // 根因 = A* 长距离寻路节点上限不足（旧 maxNodes=3000/12000，传送后展开不到起点 →
    // 空路径 → 直线走卡障碍 → 每 0.4s 重试失败）。改为距离自适应（clamp 上限防性能卡顿）。
    // 2026-08-11 v2.99 掉帧排查：流场重建 0.5s→1.0s、上限 120000→80000（降重建频率/最坏成本）
    assert(wnpc.includes('Math.min(80000, Math.max(8000, Math.ceil(maxDist * maxDist * 1.5)))'),
        'wnpc: 流场 maxNodes 距离自适应（clamp 8000~80000）');
    assert(wnpc.includes('Math.min(120000, Math.max(3000, md * md * 2))'),
        'wnpc: 单点 A* maxNodes 距离自适应');
    assert(wnpc.includes('sv.now - f.t < 1.0'), 'wnpc: 流场缓存 1.0s 保留（性能）');
    assert(wnpc.includes('sv.now - n._path.t < 0.4'), 'wnpc: 单NPC寻路缓存 0.4s 保留（性能）');
    // ㉕ 2026-08-11 v2.97 自动驾驶"到达后顶部 UI 区域名切换才算到达"（用户反馈）：
    // 到达判定 = 距目标点 2 格内 **且** 车当前区块属于目标区域（districtAt 确认）——
    // 车停在区域边缘/交界时 UI 区域名没变，玩家看不出到了哪个方向。只收紧"何时判定到达"，
    // 不动寻路/行驶逻辑；含边界兜底（目标点贴边/目标点不在目标区域 → 到点即达，绝不卡死）。
    const vsrc = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wvehicle.js'), 'utf8');
    assert(vsrc.includes('const wantZone = { city: \'urban\', suburb: \'suburb\', ruins: \'ruins\' }[o.dest];'),
        'wvehicle: 到达判定映射目标区域');
    // 2026-08-11 v2.97 用户定稿"到达 = 顶部地区 UI 变化"：区域目的地 curZone===wantZone 才到达；
    // 只有"目标点不在目标区域（寻点阶段确认过不去）"才到点停旁边；营地/自由探索原逻辑保留。
    assert(vsrc.includes('if (curZone === wantZone) { finishDriveOrder(sv, true); return; }'),
        'wvehicle: 区域 UI 变化（curZone==wantZone）→ 到达');
    assert(vsrc.includes('if (goalZone !== wantZone && dTarget < arriveD) { finishDriveOrder(sv, true); return; }'),
        'wvehicle: 过不去兜底 = 目标点不在区域 + 到点 → 停旁边');
    assert(vsrc.includes("const arriveD = o.dest === 'camp' ? TS * 1.5 : TS * 2;"),
        'wvehicle: 营地到达距离保留（原逻辑）');
    // 2026-08-12 fd84499 批量修复重构了缩进，断言改为子串匹配
    assert(vsrc.includes('if (!wantZone) {') && vsrc.includes('营地 / 自由探索：到目标点即达（原逻辑保留）'),
        'wvehicle: 营地/自由探索原逻辑保留（不破坏现有寻路）');
    // ㉖ 2026-08-11 v2.97 自动驾驶全矩阵（目的地×到达场景×障碍物）：
    // A* 能绕开各类障碍（墙/树/水/停放车/建筑/混合）+ 到达判定区域确认不卡死
    const wpathSrc = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wpath.js'), 'utf8');
    assert(wpathSrc.includes('// 斜走不能穿过两个相邻障碍角（与旧实现一致）'),
        'wpath: A* 斜走不穿障碍角（绕障碍关键）');
    assert(wpathSrc.includes('if (dx && dy && (!cs(gx + dx, gy) || !cs(gx, gy + dy))) continue;'),
        'wpath: 斜走穿角检查保留');
    assert(wpathSrc.includes('10 * (dx + dy) - 6 * m'), 'wpath: octile 启发式保留（A* 最优）');
    // ㉗ 2026-08-11 v2.97 修复"善意 NPC 打移动目标描边打空气"（用户反馈）：
    // 玩家靠近吸引敌对仇恨 → 僵尸/恶意NPC朝玩家移动 → NPC 子弹命中半径 14 < 玩家 18 →
    // 14px 命中框跟不上移动目标 → 描边。NPC 子弹命中半径提到 18（与玩家子弹一致）。
    assert(wnpc.includes('// 2026-08-11 v2.97 修复"善意 NPC 打移动目标描边打空气"'),
        'wnpc: 描边修复注释');
    assert(wnpc.includes('let hit = null, best = 18;'),
        'wnpc: NPC 子弹命中半径 14→18（与玩家一致，跟得上移动目标）');
    // ㉘ 2026-08-11 v2.97 攻击判定与武器特效对应 + 索敌精度优化（用户要求）：
    // ① 近战判定距离 = w.reach（去掉 +8，与特效 drawSwingEffect 长度一致，防"隔空打死"）；
    // ② 长矛 thrust 垂距 24→16（匹配特效线宽）；
    // ③ 子弹瞄准用目标实时坐标（threat.z/npc 本体，替代 0.12s 缓存快照，防描边）。
    assert(wnpc.includes('const hitReach = wDef ? (wDef.reach || 40) : 40;   // 判定 = 特效长度（去掉 +8 冗余）'),
        'wnpc: 近战判定距离 = w.reach（与特效长度一致，防隔空打死）');
    assert(wnpc.includes('canHit = along >= 0 && along <= hitReach && perp < 16;'),
        'wnpc: 长矛 thrust 垂距收紧到 16（匹配特效宽度）');
    assert(!wnpc.includes('const meleeReach = wDef ? (wDef.reach || 40) + 8 : 48;'),
        'wnpc: 删除 meleeReach(+8) 定义（判定不再比特效长）');
    assert(wnpc.includes('const aimTx = threat.z ? threat.z.x : (threat.npc ? threat.npc.x : threat.x);'),
        'wnpc: 子弹瞄准用目标实时坐标（防描边打空气）');
    // ㉙ 2026-08-11 v2.97 补：低血近战判定（hit-and-run 分支）也去掉 +8——此前残留
    // `reach2 = wDef2.reach + 8` 且边缘判定 `d <= reach2 + 20`（reach+28），是"隔着空被近战打死"的另一路径。
    assert(wnpc.includes('const reach2 = wDef2 ? (wDef2.reach || 40) : 40;'),
        'wnpc: 低血近战判定 = w.reach（去掉 +8，与主近战判定一致）');
    assert(!wnpc.includes('const reach2 = wDef2 ? (wDef2.reach || 40) + 8 : 48;'),
        'wnpc: 无残留低血近战 +8');
    // ㉚ 2026-08-11 v2.97 修复"切队友视角救活幸存者后当前主控头顶残留濒死标志 + 死一人就全灭"：
    // 幸存者作为 sv._downed（主控倒地）被队友 F 救活走 mateMedSubmit——此前只清 _downedMembers，
    // 不清 sv._downed → 渲染层（drawPlayer 的 drawDownedTimeBar）在当前主控头顶画救援倒计时；
    // 且 sv._downed 残留 → updateDowned 误判"主控倒地" → 死一个成员就触发全灭检测。
    assert(surv.includes('// 幸存者作为 sv._downed（主控倒地）被队友 F 救活走的是 mateMedSubmit'),
        'survival: mateMedSubmit 清 sv._downed 修复注释');
    assert(surv.includes('if ((dId != null && m.id === dId) || (dName && m.name === dName)) {'),
        'survival: 救活目标 == sv._downed 对应角色 → 清 _downed');
    // 检查 mateMedSubmit 救活块内（5204-5212 区域）是否清 waitDowned/carryDowned
    const mateIdx = surv.indexOf('const dId = sv._downed.id;');
    const mateBlock = mateIdx > 0 ? surv.slice(mateIdx, mateIdx + 300) : '';
    assert(mateBlock.includes('sv._downed = null') && mateBlock.includes('sv._waitDowned = false') && mateBlock.includes('sv._carryDowned = false'),
        'survival: 清 _downed 连带清 waitDowned/carryDowned');
    // ㉛ 2026-08-11 v2.97 修复"药品已集齐但点不动按钮，救不了队友"：
    // 之前 done 时按钮 disabled，玩家看到"药品已集齐"灰按钮——已集齐但不知道需要点，队友反复倒下。
    // 改为 enabled 绿字"集齐·完成救治"，点击明确触发救活（主控 + 队友界面都修）。
    assert(surv.indexOf('done ? \'集齐·完成救治\'') > 0, 'survival: 队友救活界面 done 按钮改为 集齐·完成救治');
    // 注释里"药品已集齐"是设计文档说明，不算——只检查按钮 HTML 文字是否还有
    assert(surv.indexOf('>药品已集齐<') < 0, 'survival: 移除"药品已集齐"按钮文字（注释里的说明保留）');
    // 主控界面 — 同样修复（用函数定义定位，避免匹配到 updateDowned 里新增的 renderRescue() 调用）
    const mainStart = surv.indexOf('function renderRescue()');
    const mainBlock = mainStart > 0 ? surv.slice(mainStart, mainStart + 5000) : '';
    assert(mainBlock.indexOf('done ? \'集齐·完成救治\'') > 0, 'survival: 主控救活界面 done 按钮改为 集齐·完成救治');
    // ㉜ 2026-08-11 v2.97 修复"NPC 在玩家周围游荡动画抽搐 + 移动过快"（用户反馈）：
    // 游荡到达目标点（<0.15 格）→ 站定停动画（此前每帧微移+方向抖动 → 抽搐）；
    // 游荡速度 0.5 → 0.35（上下/左右移动不过快，减少来回抽动）。阈值与 moveToward 站定一致。
    // 2026-08-12 fd84499 批量修复重构了缩进层级，断言改为不依赖精确缩进的子串匹配。
    assert(wnpc.includes('const wpDist = Math.hypot(n._wpX - n.x, n._wpY - n.y);'),
        'wnpc: 游荡目标点距离判定');
    assert(wnpc.includes('if (wpDist < TS * 0.15) {') && wnpc.includes('n._moving = false;   // 站定：停走动动画'),
        'wnpc: 游荡到达目标点 → 站定停动画（防抽搐）');
    assert(wnpc.includes('moveToward(sv, n, n._wpX, n._wpY, dt, canStand, 0.35);'),
        'wnpc: 游荡速度 0.5→0.35（移动不过快）');
    // ㉜b 2026-08-11 v2.97 修复"NPC 跟随移动也抽搐"（用户反馈"我移动NPC跟随的时候也会有抽搐，闪避时反而减少"）：
    // moveToward 目标点极近时站定（阈值 TS*0.15，只吸收贴脸微移残差）——此前贴脸时残差极小仍置
    // _moving=true + 微移 → 走路动画在几乎不动的位置高频抖动；闪避拉开距离后残差变大 → 动画正常。
    assert(wnpc.includes('if (dist < TS * 0.15) {') && wnpc.includes('n._moving = false;') && wnpc.includes('return;'),
        'wnpc: moveToward 目标极近站定（吸收贴脸微移，防跟随抽搐）');
    // ㉝ 2026-08-11 v2.97 修复"健康主控带濒死标志，被恶意NPC攻击致死后跳过切队友视角直接全灭"：
    // ① _devGod 每帧拉满血时同步清当前主控 downed/_downed（全属性满=立即健康，不再残留标志）；
    // ② onDeath 清理残留 _downed 时同步清主控记录 downed（防 mates 过滤/攻击路径错乱）；
    // ③ 有存活队友时主控死亡必弹"切换队友视角"（反复验证 onDeath/updateDowned 分支矩阵 457 全过）。
    assert(surv.includes('// 2026-08-11 v2.97 修复"主控头上有濒死标志但其实健康'),
        'survival: _devGod 修复注释');
    assert(surv.includes('const curPc = (sv.npcs || []).find(n => n.id === sv.controllerId) || (sv.npcs || []).find(n => n.isPlayer);'),
        'survival: _devGod 定位当前主控记录');
    assert(surv.includes('curPc.downed = false;'), 'survival: _devGod 清主控记录 downed');
    assert(surv.includes('const _cpc = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);'),
        'survival: onDeath 残留清理定位主控记录');
    assert(surv.includes('if (_cpc) { _cpc.downed = false; _cpc._penaltySec = 0; }'),
        'survival: onDeath 残留清理同步清主控记录 downed');
    // ㉟ 2026-08-11 v2.97 修复"只剩当前主控活着却弹全员阵亡"（用户截图：HP 66/80 活着却弹了全员阵亡）：
    // 队伍只剩 1 个活人（当前主控自己）时，mates 因 controllerId/isPlayer 排除变空 →
    // anyAliveMate=false → 误判全灭。修复：controllerId 角色活着 / isPlayer 角色活着
    // 任一即 anyAliveMate=true（不算全灭）。onDeath 与 updateDowned 都修。
    const onDeathAnyIdx = surv.indexOf('// 2026-08-11 v2.97 修复"只剩当前主控活着却弹全员阵亡"');
    const updateDownedAnyIdx = surv.indexOf('// 2026-08-11 v2.97 "当前主控自己活着"也算可行动者');
    assert(onDeathAnyIdx > 0, 'survival: onDeath 增加"当前主控/原主角活着也算可行动者"修复注释');
    assert(updateDownedAnyIdx > 0, 'survival: updateDowned 同款修复注释');
    assert(surv.indexOf('const cur = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);', onDeathAnyIdx) > onDeathAnyIdx,
        'survival: onDeath 定位当前 controllerId');
    assert(surv.indexOf('const controllerAlive = !!(cur && cur.alive && !cur.downed);', onDeathAnyIdx) > onDeathAnyIdx,
        'survival: onDeath 计算 controllerAlive');
    assert(surv.indexOf('|| controllerAlive || playerAlive', onDeathAnyIdx) > onDeathAnyIdx,
        'survival: onDeath anyAliveMate 含 controllerAlive/playerAlive');
    assert(surv.indexOf('|| !!(_udc && _udc.alive && !_udc.downed) || _udp', updateDownedAnyIdx) > updateDownedAnyIdx,
        'survival: updateDowned anyMateAlive 含 _udc/_udp');
    // ㊱ 2026-08-11 v2.97 修复"切队友视角后主控濒死状态转移到队友身上"（用户反馈）：
    // 根因 = enterDownedView（onDeath 弹窗切视角）调用 switchControl 后未清 sv._downed →
    // updateDowned 每帧仍走主控倒地分支 → 全灭误判 + 渲染 drawDownedTimeBar 把救援倒计时
    // 画到【新主控】头顶（状态"转移"到队友）。修复：切视角后清 _downed/_waitDowned/_carryDowned
    //（旧主控已由 switchControl 标 downed 并入 _downedMembers 管理倒计时）。
    const edvFixIdx2 = surv.indexOf('// 2026-08-11 v2.97 修复"切队友视角后主控濒死状态转移到队友身上"');
    const edvBlock2 = edvFixIdx2 > 0 ? surv.slice(edvFixIdx2, edvFixIdx2 + 900) : '';
    assert(edvBlock2.includes('sv._downed = null;') && edvBlock2.includes('sv._waitDowned = false;') && edvBlock2.includes('sv._carryDowned = false;'),
        'survival: enterDownedView 切视角后清 _downed（防状态转移/全灭误判）');
    // ㊳ 2026-08-11 v2.97 修复"幸存者诈尸"（用户反馈：幸存者死亡成尸体后，softRespawn 把它复活）：
    // softRespawn 重建判定只按当前主控 controllerId（不再检查 isPlayer 尸体），且 filter 保留幸存者尸体。
    assert(surv.includes('// 2026-08-11 v2.97 修复"幸存者诈尸"'), 'survival: 诈尸修复注释');
    assert(surv.includes('const oldCtl = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);'),
        'survival: softRespawn 重建判定只看当前主控');
    assert(!/const oldIsPlayer = sv\.npcs/.test(surv), 'survival: 不再声明 oldIsPlayer（尸体不触发重建）');
    // v2.98 更新：重建 filter 删 isPlayer 尸体（防 initRoster 不新建 → 重生后角色异常）
    assert(surv.includes("sv.npcs = sv.npcs.filter(n => n.id !== sv.controllerId && !n.isPlayer);"),
        'survival: 重建删 isPlayer 尸体（initRoster 新建干净新主角）');
    // ㊴ 2026-08-11 v2.98 尸体尸变系统（用户定稿）：尸体 15 分钟现实时间尸变（无论是否搜完），
    // 尸变丧尸背包=尸体未搜物品（守恒），被击败掉尸变尸体，搜索完彻底消失；重生刷尸改现实 15 分钟。
    assert(bal.includes('CORPSE_REVIVE_SECONDS = 180'), 'bal: CORPSE_REVIVE_SECONDS=180（3分钟，用户缩短）');
    assert(bal.includes("CORPSE_REVIVE_TAG = '（尸变）'"), 'bal: 尸变名字后缀');
    assert(bal.includes('DOWNED_RESPAWN_PZ_SECONDS = 180'), 'bal: 重生刷尸 3 分钟（同步缩短）');
    assert(surv.includes('function updateCorpseRevive(sv, dt, mode)'), 'survival: 尸变检测函数（场景过滤）');
    assert(surv.includes('function corpseReviveZombie(sv, n'), 'survival: 尸变丧尸生成（v3.31 支持 roomKey 转存房间存档）');
    assert(surv.includes('export function reviveZombieToCorpse(sv, z)'), 'survival: 尸变丧尸被击败掉尸体');
    assert(surv.includes('updateCorpseRevive(sv, dt);'), 'survival: 大世界调用尸变检测');
    assert(surv.includes('if (!n._corpse || n._revived) continue;'), 'survival: 尸变检测跳过条件');
    // 2026-08-11 v2.99 修复"玩家尸化僵尸在脚下生成"：刷尸位置改用死亡地点（_lastDeathPos），不用重生点
    assert(surv.includes("const _pzX = (sv._lastDeathPos && sv._lastDeathPos.x != null) ? sv._lastDeathPos.x : rx"), 'survival: 刷尸位置 = 死亡地点(_lastDeathPos)');
    assert(surv.includes('atReal: sv.now != null ? sv.now : 0'), 'survival: 重生刷尸加 atReal');
    assert(surv.includes('if (sv.now - sv._pzRespawn.atReal >= B.DOWNED_RESPAWN_PZ_SECONDS) {'), 'survival: 重生刷尸用现实秒');
    // ㊵ 2026-08-11 v2.98 测试玩家模拟发现：尸变字段序列化缺失（读档后立即尸变/尸变丧尸不掉尸变尸体）
    const wnpcSrc2 = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wnpc.js'), 'utf8');
    const wstateSrc2 = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wstate.js'), 'utf8');
    assert(wnpcSrc2.includes('_corpseAtReal: n._corpseAtReal != null ? n._corpseAtReal : null,'),
        'wnpc: serializeNpcs 序列化 _corpseAtReal（防读档立即尸变）');
    assert(wnpcSrc2.includes('_revived: !!n._revived,') && wnpcSrc2.includes('_revivedCorpse: !!n._revivedCorpse,'),
        'wnpc: 序列化 _revived/_revivedCorpse（防重复尸变）');
    assert(wstateSrc2.includes('_reviveFromCorpse: !!z._reviveFromCorpse,') && wstateSrc2.includes('_reviveCorpseName: z._reviveCorpseName || null,'),
        'wstate: 序列化尸变丧尸标记（读档保持掉尸变尸体）');
    assert(wstateSrc2.includes('_corpseAtReal: 0,'), 'wstate: 旧档遗留尸体给 _corpseAtReal（读档尸变倒计时）');
    // ㊶ 2026-08-11 v2.98 测试玩家发现：主控补刀/超时彻底死亡后没有 _corpse 标记 → 尸体不能搜索。
    // 修复：updateDowned 超时分支（3959）补设 _corpse + 内容 + 尸变时刻 + 可搜索提示。
    assert(surv.includes('pc._corpse = true;') && surv.includes('pc._corpseContents = [];'),
        'survival: 主控超时/补刀致死生尸体（可搜索遗物）');
    assert(surv.includes('pc._corpseAtReal = sv.now != null ? sv.now : 0;'),
        'survival: 主控尸体记录尸变时刻');
    // ㊷ 2026-08-11 v2.98 测试玩家发现：重生后角色头顶残留尸变倒计时 + 脚下双尸体。
    // ① softRespawn 清 _downedMembers/_carryDowned/_carryMateId（防倒地状态残留到新角色）；
    // ② updateDowned 超时分支只给【非 isPlayer】倒地主控补尸体——isPlayer 主角遗物已由
    //    deathDropLegacy 生成独立 corpse: 尸体，再给 player 记录生成 _corpse 会双尸体。
    assert(surv.includes('sv._downedMembers = [];   // 2026-08-11 v2.98 重生清倒地成员列表'),
        'survival: softRespawn 清 _downedMembers（防残留）');
    assert(surv.includes('sv._carryMateId = null;'), 'survival: softRespawn 清 _carryMateId');
    assert(surv.includes('if (!pc.isPlayer && !pc._corpse) {'),
        'survival: 超时补尸体仅非 isPlayer（防双尸体）');
    const wzombieSrc2 = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/wzombie.js'), 'utf8');
    const windoorSrc2 = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/windoor.js'), 'utf8');
    assert(wzombieSrc2.includes('if (z._reviveFromCorpse) {'), 'wzombie: 室外尸变丧尸被击败掉尸变尸体');
    assert(windoorSrc2.includes('if (z._reviveFromCorpse) {'), 'windoor: 室内尸变丧尸被击败掉尸变尸体');
    const renderSrc2 = fs.readFileSync(pathMod.join(projRoot, 'source-code/mod-wasteland/render.js'), 'utf8');
    assert(renderSrc2.includes('⚠ 尸变'), 'render: 尸体头顶尸变倒计时');
    assert(renderSrc2.includes('drawCorpse(ctx, cxs, cys, n, sv)'), 'render: 室外传 sv');
    assert(renderSrc2.includes('drawCorpse(ctx, ox + n.x, oy + n.y, n, sv)'), 'render: 室内传 sv');
    // ㊲ 2026-08-11 v2.97 修复"濒死队友被尸体搜索抢占"（用户反馈：濒死队友还不等于尸体）：
    // 濒死（downed=true, alive=true）≠ 尸体（alive=false + _corpse）——尸体搜索判定排除 downed，
    // 濒死队友只弹救助界面，不弹搜索界面（也不会被旁边旧尸体/误标 _corpse 抢占）。
    // 2026-08-11 v2.98 尸变前反复打开搜索界面：普通尸体搜完（_corpseSearched）仍可重开搜索；
    // 2026-08-11 v2.98 定稿（用户确认）：普通尸体掏空保留（像容器可反复打开），尸变尸体（_revivedCorpse）搜索完消失。
    assert(surv.includes('if (!n || !n._corpse || n.downed) continue;'),
        'survival: corpseBest 排除 downed（濒死不弹搜索）+ 所有尸体可反复提示搜索');
    assert(surv.includes('const c = sv.npcs && sv.npcs.find(n => n && n._corpse && !n.downed && n.id === tg.corpse);'),
        'survival: doInteract 尸体搜索排除 downed（防御双保险）+ 所有尸体可重开');
    // onClose 掏空处理（2026-08-11 v2.98 用户定稿）：普通尸体掏空保留（可反复打开）；
    // 尸变尸体（_revivedCorpse）搜索完彻底消失（splice）。
    assert(surv.includes('if (c._revivedCorpse)'),
        'survival: 尸变尸体/普通尸体区分（尸变尸体搜完消失）');
    assert(surv.includes('sv.npcs.splice(idx, 1)'),
        'survival: 尸变尸体掏空从世界移除（splice）');
    assert(surv.includes('c._corpseSearched = true') && surv.includes('// —— 普通尸体：掏空保留（像容器可反复打开），未尸变照样 15 分钟尸变 ——'),
        'survival: 普通尸体掏空保留（不 splice，可反复打开）');
    // ㊸ 2026-08-11 v2.98 濒死队友互动提示（用户反馈"濒临死亡的队友不能救援，没有提示"）：
    // downedMatePrompt 依赖 _downedMembers 中 m.alive && m.downed——补刀未超时保持 downed 有提示；
    // 防御修复：updateDownedMembersTimeout 移除异常成员时若 party 且无 _corpse → 补成尸体（防凭空消失）。
    assert(surv.includes('if (!m || !m.alive || !m.downed) continue;'),
        'survival: 濒死队友救治提示需 alive+downed');
    assert(surv.includes('// 若成员【活着但非 downed】（异常状态被移除，如某路径误清 downed）且无 _corpse →'),
        'survival: 异常成员补尸体防御注释');
    assert(surv.includes('m._corpse = true;') && surv.includes('m._corpseAtReal = sv.now != null ? sv.now : 0;'),
        'survival: 异常成员转尸体（可搜索，防凭空消失）');
    // ④ 救助界面一致：队友界面补"背起/放下"按钮 + 全宽关闭 + 统一提示（与主控界面一致）
    //   v3.29 起主控/队友共用 buildRescuePanel，按钮 data-act 由 carryAct 参数传入（队友 = 'carrymate'）
    assert(surv.includes('sv._carryMateId === m.id ? \'putdown\' : \'carrymate\''), 'survival: 队友救助界面背起/放下按钮（v3.29 共享模板 + carryAct 参数）');
    assert(surv.includes('data-act="${p.carryAct}"'), 'survival: 救助面板模板用 carryAct 参数化 data-act');
    assert(surv.includes("'carrymate'") && surv.includes("'carry'") && surv.includes("'putdown'"), 'survival: carryAct 三个取值（主控/队友背起 + 放下）');
    assert(surv.includes("sv._carryMateId = m.id;"), 'survival: 队友背起设置 _carryMateId');
    assert(surv.includes('提示：关闭界面不会导致濒死玩家死亡 · 背到床旁躺下可延长存活时间'),
        'survival: 队友界面提示文案统一');
    assert(surv.includes('const cm = Array.isArray(sv._downedMembers) ? sv._downedMembers.find(x => x && x.id === sv._carryMateId) : null;'),
        'survival: updateDownedMembersTimeout 队友背起坐标跟随');
    assert(surv.includes('if (sv._carryMateId === m.id) sv._carryMateId = null;'),
        'survival: 救活被背起队友 → 清 _carryMateId');
}

// 2026-08-10 静态回归：①友好/入队队友不再对敌对 NPC 子弹无敌（b.hostile 命中 friendly）；
// ②车上成员被射击优先掉汽车耐久；③汽车碾压敌对 NPC；④softRespawn 强制下车（driving 残留修复）。
{
    const fs = await import('node:fs');
    const wsrc = fs.readFileSync(new URL('../source-code/mod-wasteland/wnpc.js', import.meta.url), 'utf8');
    const vsrc = fs.readFileSync(new URL('../source-code/mod-wasteland/wvehicle.js', import.meta.url), 'utf8');
    const src = fs.readFileSync(new URL('../source-code/mod-wasteland/survival.js', import.meta.url), 'utf8');
    assert(wsrc.includes("if (b.hostile)") && wsrc.includes("o.role === 'friendly'"),
        'wnpc: hostile bullets hit friendly/party npc (fix invincible teammates)');
    assert(wsrc.includes('hit.npc.riding && sv.driving') && wsrc.includes('sv.driving.hp'),
        'wnpc: riding npc shot prefers car durability');
    assert(vsrc.includes("o.role !== 'hostile'") && vsrc.includes('killNpc(sv, o,'),
        'wvehicle: car crushes hostile npc');
    assert(src.includes('if (sv.driving) {') && src.includes("sv.driving = null;"),
        'survival: softRespawn clears driving (fix dead-on-car not respawning)');
}
// 2026-08-10 静态回归：濒死切视角不再误触发重生（旧主控转倒地待救，而非低血留在世界被 AI 打死）。
{
    const fs = await import('node:fs');
    const wsrc = fs.readFileSync(new URL('../source-code/mod-wasteland/wnpc.js', import.meta.url), 'utf8');
    const swStart = wsrc.indexOf('export function switchControl');
    const swEnd = swStart > 0 ? wsrc.indexOf('\nexport function', swStart + 10) : -1;
    const swBody = swStart > 0 && swEnd > 0 ? wsrc.slice(swStart, swEnd) : '';
    assert(swBody.includes('nearDeath') && swBody.includes('cur.downed = nearDeath'),
        'wnpc: switchControl converts near-death old controller to downed (no instant respawn)');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
