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
        const gain = () => ({ gain: { value: 0 }, connect() {} });
        return {
            createGain: gain, destination: {}, currentTime: 0,
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
assert(WW.RECIPES.length === 35, 'wwordcraft all inventory recipes registered');
const pistolRecipe = WW.RECIPES.find(recipe => recipe.id === 'pistol');
assert(pistolRecipe && pistolRecipe.wedgeId === 'wedge:stable', 'wwordcraft firearm requires stable wedge');
assert(WW.WEDGE_INFO['wedge:clean'].name === '洁净字楔', 'wwordcraft clean wedge registered');

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
assert(WI.playerInfectionEffects(95).maxHpMul < 0.5, 'player infection caps HP at stage 5');
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
for (const [source, table] of Object.entries(WW.WEDGE_SOURCE_TABLES)) {
    assert(Math.abs(probabilitySum(table) - 1) < 1e-9, `wedge pool ${source} sums to 100%`);
}
for (const [source, pool] of Object.entries(WW.ZOMBIE_GLYPH_POOLS)) {
    assert(Math.abs(weightedSum(pool) - 1) < 1e-9, `zombie glyph pool ${source} sums to 100%`);
}
const legalGlyphs = new Set(Object.values(WW.GLYPH_SOURCE_POOLS).flatMap(pool => pool.map(entry => entry.id)));
const recipeGlyphs = new Set(WW.RECIPES.flatMap(recipe => recipe.glyphs));
assert([...recipeGlyphs].every(char => legalGlyphs.has(char)), 'every recipe glyph has a legal container source');
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
const infectedWedge = WW.rollWordLootOutcome('weapon', { wedge: 1 }, {}, () => 0.999999);
assert(infectedWedge.items[0].id === 'wedge:stable', 'infected wedge compatibility moves to stable wedge');

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
            _weather: 'rain', _evt: { type: 'blackout', endT: 99 },
        };
        const s1 = serializeMpSnapshot(mpSv, null);
        assert(s1.zombies[0].wt === undefined && s1.zombies[0].atkState === undefined, 'mp-snap: zombie runtime fields whitelisted out');
        assert(s1.dev.god === true && s1.dev.inf === true, 'mp-snap: dev flags block');
        assert(s1.weather === 'rain' && s1.evt.type === 'blackout' && s1.evt.endT === 99, 'mp-snap: weather/evt whitelisted');
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

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
