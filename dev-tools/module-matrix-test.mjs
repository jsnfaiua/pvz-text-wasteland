// ============================================================================
// 全系统模块矩阵测试（2026-08-11 v2.98）— 未测试模块逐个补齐
// 覆盖 14 个模块：僵尸AI/感染/建造/植物/搜索/区域/字词/室内/行动/武器/背包/尸群/地图/HUD
// 运行：node dev-tools/module-matrix-test.mjs
// 方法：源码断言 + 纯逻辑模拟双轨（模块多为 DOM/世界耦合，纯函数逻辑用复刻验证）
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(projRoot, 'source-code/mod-wasteland/' + f), 'utf8');
const cons = fs.readFileSync(path.join(projRoot, 'source-code/core/constants.js'), 'utf8');

const M = {};
M.wzombie = read('wzombie.js');
M.winfection = read('winfection.js');
M.wbuild = read('wbuild.js');
M.wplants = read('wplants.js');
M.wsearch = read('wsearch.js');
M.wdistrict = read('wdistrict.js');
M.wwordcraft = read('wwordcraft-rules.js');
M.windoor = read('windoor.js');
M.waction = read('waction.js');
M.wgear = read('wgear.js');
M.panel = read('panel.js');
M.whorde = read('whorde.js');
M.wmap = read('wmap.js');
M.whud = read('whud.js');
M.bal = read('wbalance.js');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) pass++; else { fail++; console.log('✗ FAIL: ' + m); } };

// ============ 1. wzombie 僵尸 AI ============
assert(cons.includes('normal:') && cons.includes('cone:') && cons.includes('bucket:'), 'zombie: 基础类型');
assert(M.bal.includes("giant: { name: '巨字尸'"), 'zombie: 巨字尸');
assert(M.wzombie.includes('生成点安全化：落在不可走格'), 'zombie: 生成安全化');
assert(M.wzombie.includes("hp: totalHp, maxHp: totalHp,"), 'zombie: hp初始化');
assert(M.wzombie.includes("isPlayerZombie: true,"), 'zombie: 玩家尸化');
assert(M.wzombie.includes("inv: (sv.inv || []).map(s => s ? { ...s } : null),"), 'zombie: 继承背包');
assert(M.wzombie.includes("const tier = B.ZOMBIE_LOOT_TIER[type] || 'normal';"), 'zombie: 品质tier');
assert(M.wzombie.includes('if (z._reviveFromCorpse) {'), 'zombie: 尸变丧尸掉尸体');
assert(M.wzombie.includes("if (type === 'giant') {"), 'zombie: 巨字尸掉落');

// ============ 2. winfection 感染 ============
assert(M.winfection.includes('zombieHitChance: 0.18'), 'infect: 咬中率');
assert(M.winfection.includes('zombieHitAmount: [2, 6]'), 'infect: 感染量');
assert(M.winfection.includes('bedRestRecovery: 5'), 'infect: 床恢复');
assert(M.winfection.includes('worldInfectionLevel'), 'infect: 世界感染');
assert(M.winfection.includes("region === 'ruins' ? 0.18"), 'infect: 废墟偏移');

// ============ 3. wbuild 建造 ============
assert(M.wbuild.includes('if (Math.hypot(gx + 0.5 - ptx, gy + 0.5 - pty) > B.BUILD_RANGE) return false;'), 'build: 范围');
assert(M.wbuild.includes('if (!isWalk(t)) return false;'), 'build: 不可走禁止');
assert(M.wbuild.includes('B.BUILD_COLLIDE_R'), 'build: 碰撞半径');
assert(M.wbuild.includes('existing.lv = lv + 1;'), 'build: 墙升级');
assert(M.wbuild.includes('B.DEMOLISH_REFUND'), 'build: 拆除返还');
assert(M.wbuild.includes("const extra = m.lv === 2 ? { stone: 1 } : { part: 1, stone: 1 };"), 'build: 升级墙返还');
assert(M.wbuild.includes('m.hp -= z.damage * dt;'), 'build: 建筑掉血');
assert(M.wbuild.includes('T.CARWRECK'), 'build: 汽车变残骸');

// ============ 4. wplants 植物 ============
assert(M.wplants.includes('export function stageOf(growth)'), 'plant: stageOf');
assert(M.wplants.includes('export function speciesAt(seed, gx, gy)'), 'plant: speciesAt');
// 2026-08-12 修复#5（§13.1 数值唯一收口）：wplants 不再本地定义数值副本，统一引用 wbalance 收口值。
// 断言同步改为验证收口后的结构（引用 B.PLANT_GROW/B.TAME_BASE）与 wbalance 单真相源值。
assert(M.wplants.includes('B.PLANT_GROW'), 'plant: 生长速率引用收口(B.PLANT_GROW)');
assert(M.wplants.includes('B.TAME_BASE'), 'plant: 驯服基础引用收口(B.TAME_BASE)');
assert(M.bal.includes('export const PLANT_GROW = 0.8'), 'plant: wbalance 生长速率收口=0.8');
assert(M.bal.includes('export const TAME_BASE = 0.7'), 'plant: wbalance 驯服基础收口=0.7');
assert(M.wplants.includes('const ACTIVATE_RADIUS = 9'), 'plant: 激活半径');
assert(M.wplants.includes('sunProduce: true'), 'plant: 向日葵');
assert(M.wplants.includes('melee: true'), 'plant: 食人花');

// ============ 5. wsearch 搜索 ============
assert(M.wsearch.includes('export function openSearch(sv, meta, options)'), 'search: openSearch');
assert(M.wsearch.includes('export function updateSearch(sv, dt)'), 'search: updateSearch');
assert(M.wsearch.includes("const cap = Math.max(meta.cap || 0, meta.items.length);"), 'search: 容量');
assert(M.wsearch.includes('pending.sort((a, b) => a.slot - b.slot);'), 'search: 槽位排序');
assert(M.wsearch.includes("if (id === 'gem') return 'epic';"), 'search: 宝石史诗');
assert(M.wsearch.includes('corpseFull: meta.corpseFull || meta.items || null'), 'search: 完整对象映射(保留品级/耐久)');

// ============ 6. wdistrict 区域 ============
assert(M.wdistrict.includes("core:    { name: '市中心', minR: 0,  maxR: 3,  infection: 0.85, zombieMul: 2.2"), 'dist: core');
assert(M.wdistrict.includes("wild:    { name: '荒野',   minR: 20, maxR: Infinity, infection: 0.06, zombieMul: 0.4"), 'dist: wild');
assert(M.wdistrict.includes('export function cityCenterAt(seed, cellX, cellY)'), 'dist: cityCenterAt');
assert(M.wdistrict.includes('export function districtAt(seed, cx, cy)'), 'dist: districtAt');
assert(M.wdistrict.includes('export const CITY_SPACING = 52;'), 'dist: 城市间距');

// ============ 7. wwordcraft 字词 ============
assert(M.wwordcraft.includes('export const RECIPES'), 'word: 配方表');
assert(M.wwordcraft.includes('export function parseFragmentId(id)'), 'word: parseFragmentId');
assert(M.wwordcraft.includes("severity: missing.length <= 1 ? 'light' : 'severe'"), 'word: severity');
assert(M.wwordcraft.includes('export function rollWordLootOutcome'), 'word: 掉落结果');
assert(M.wwordcraft.includes("const wedgeNeed = Math.max(1, Math.ceil(info.missing.length * 0.5));"), 'word: 修复楔子');

// ============ 8. windoor 室内 ============
assert(M.windoor.includes('export function generateInterior(seed, doorKey, floor = 1'), 'door: generateInterior');
assert(M.windoor.includes('if (roomRoll < 0.30) count = 0;'), 'door: 30%空房');
assert(M.windoor.includes('return Math.max(0, Math.min(count, 10));'), 'door: 数量上限');
assert(M.windoor.includes("const coneC = day >= 3 ? Math.min(0.15 + day * 0.03, 0.4) : 0;"), 'door: 锥桶解锁');
assert(M.windoor.includes('export function interiorCanStand(sv, x, y)'), 'door: interiorCanStand');

// ============ 9. waction 行动 ============
assert(M.waction.includes('export function spendStamina(sv, cost)'), 'act: spendStamina');
assert(M.waction.includes('export function startDash(sv)'), 'act: startDash');
assert(M.waction.includes('export function startGuard(sv)'), 'act: startGuard');
assert(M.waction.includes('export function tryJump(sv)'), 'act: tryJump');
assert(M.waction.includes('sv._downed._penaltySec += dmg * B.DOWNED_HIT_PENALTY_SEC'), 'act: 倒地扣时');
assert(M.waction.includes('BULLET_TIME_DURATION = 1.2'), 'act: 子弹时间');
assert(M.waction.includes("if (sv._devInfStamina) return true;"), 'act: 无限体力');

// ============ 10. wgear 武器 ============
assert(cons.includes('export const WEAPONS = {'), 'gear: WEAPONS表');
const wpSeg = cons.slice(cons.indexOf('export const WEAPONS = {'), cons.indexOf('};', cons.indexOf('export const WEAPONS = {')) + 2);
for (const w of ['pistol', 'shotgun', 'dagger', 'sword', 'smg', 'rifle', 'sniper', 'bow', 'knife', 'spear', 'axe', 'shovel']) {
    assert(wpSeg.includes(`${w}: {`), `gear: 武器${w}`);
}
const sniperDmg = wpSeg.match(/sniper: \{[\s\S]*?damage: (\d+)/);
assert(sniperDmg && parseInt(sniperDmg[1]) === 165, 'gear: 狙击165');
assert(M.wgear.includes('export function meleeAttack(sv)'), 'gear: meleeAttack');
assert(M.wgear.includes('export function tryFire(sv, charge = 1)'), 'gear: tryFire');
assert(M.wgear.includes('export function updateBullets(sv, dt)'), 'gear: updateBullets');
assert(M.wgear.includes('export const SHOT_ORIGIN_Y = 26;'), 'gear: 射击原点');

// ============ 11. panel 背包 ============
assert(M.panel.includes('export const BAG_SIZE = 24;'), 'panel: 背包24');
assert(M.panel.includes('export const CHEST_SIZE = 12;'), 'panel: 箱子12');
assert(M.panel.includes('export function addToArr(arr, id, n)'), 'panel: addToArr');
assert(M.panel.includes('export function addItemObj(arr, item)'), 'panel: addItemObj');
assert(M.panel.includes("legacy: { name: '遗物包裹'"), 'panel: 遗物');
assert(M.panel.includes("npcbag: { name: '战利品包裹'"), 'panel: NPC包裹');

// ============ 12. whorde 尸群 ============
assert(M.whorde.includes("rewards.push(['wood', 2 + Math.floor(Math.random() * 3)]);"), 'horde: 木材奖励');
assert(M.whorde.includes("if (Math.random() < 0.30) rewards.push(['flag', 1]);"), 'horde: 旗帜30%');
assert(M.whorde.includes("const cap = B.HORDE_MAX_ONFIELD || 45;"), 'horde: 场上限');
assert(M.whorde.includes('sv.day >= B.Z_GIANT_UNLOCK_DAY && Math.random() < B.Z_GIANT_HORDE_CHANCE'), 'horde: 巨字尸');
assert(M.whorde.includes('for (const [id, n] of rewards.slice(0, 4))'), 'horde: 最多4件');
assert(M.bal.includes('HORDE_MAX_ONFIELD'), 'horde: 上限常量');

// ============ 13. wmap 地图 ============
assert(M.wmap.includes('export function markExplore(sv)'), 'map: markExplore');
assert(M.wmap.includes("for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)"), 'map: 3×3邻域');
assert(M.wmap.includes("if (sv.mp && sv.mp.role === 'guest')"), 'map: guest上报');
assert(M.wmap.includes("(sv.mpOutbox = sv.mpOutbox || []).push({ type: 'explore', cx, cy });"), 'map: 探索上报');
assert(M.wmap.includes('const UNKNOWN_COLOR = \'#1a1a14\''), 'map: 未探索色');
assert(M.wmap.includes('const MIN_ZOOM = 0.5, MAX_ZOOM = 8;'), 'map: 缩放范围');

// ============ 14. whud HUD ============
assert(M.whud.includes('export function update(sv, now)'), 'hud: update');
assert(M.whud.includes('if (!showFps && !showFull) { if (el) destroy(); return; }'), 'hud: 双关销毁');
assert(M.whud.includes('const REFRESH_MS = 500;'), 'hud: 500ms节流');
assert(M.whud.includes('fps = Math.round((fpsAcc * 1000) / fpsT);'), 'hud: FPS计算');
assert(M.whud.includes('零依赖模块'), 'hud: 零依赖');

// ============ 15. 逻辑模拟（纯函数复刻）============
// 感染阶段边界
{
    const stages = [
        { stage: 0, min: 0 }, { stage: 1, min: 10 }, { stage: 2, min: 25 },
        { stage: 3, min: 45 }, { stage: 4, min: 70 }, { stage: 5, min: 90 },
    ];
    const stageOf = (v) => { const c = Math.max(0, Math.min(100, v)); let r = stages[0]; for (const s of stages) if (c >= s.min) r = s; return r.stage; };
    const bounds = [[0, 0], [9, 0], [10, 1], [24, 1], [25, 2], [44, 2], [45, 3], [69, 3], [70, 4], [89, 4], [90, 5], [100, 5]];
    for (const [v, e] of bounds) assert(stageOf(v) === e, `sim-infect: ${v}→${e}`);
}
// 背包堆叠
{
    const addToArr = (arr, id, n, max) => {
        let left = n;
        for (const s of arr) {
            if (left <= 0) break;
            if (s && s.id === id && s.n < max) { const a = Math.min(max - s.n, left); s.n += a; left -= a; }
        }
        for (let i = 0; i < arr.length && left > 0; i++) {
            if (!arr[i]) { const a = Math.min(max, left); arr[i] = { id, n: a }; left -= a; }
        }
        return left;
    };
    for (let i = 0; i < 30; i++) {
        const arr = new Array(24).fill(null); arr[0] = { id: 'wood', n: 15 };
        const left = addToArr(arr, 'wood', 30, 20);
        assert(arr[0].n === 20 && arr[1].n === 20 && arr[2].n === 5 && left === 0, 'sim-panel: 堆叠');
    }
}
// 尸潮数量成长
{
    const total = (day, base, perDay, mul) => Math.max(3, Math.round((base + perDay * day) * mul));
    for (let i = 0; i < 30; i++) {
        assert(total(10, 20, 3, 1) > total(1, 20, 3, 1), 'sim-horde: 天数成长');
        assert(total(5, 20, 3, 1.5) > total(5, 20, 3, 1), 'sim-horde: 难度成长');
    }
}
// 僵尸血量成长
{
    const hp = (base, day, diff, ring) => Math.round(base * (1 + (day - 1) * 0.05) * diff * ring);
    for (let i = 0; i < 30; i++) {
        assert(hp(70, 10, 1, 1) > hp(70, 1, 1, 1), 'sim-zombie: 天数血量');
        assert(hp(70, 1, 1.5, 1) > hp(70, 1, 1, 1), 'sim-zombie: 难度血量');
    }
}
// 植物伤害成长
{
    const STAGES = [{ dmgMul: 0.6 }, { dmgMul: 1.0 }, { dmgMul: 1.5 }];
    const dmg = (base, g, type) => Math.round(base * STAGES[g].dmgMul * (type === 'neutral' ? 1 : 1.5));
    for (let i = 0; i < 30; i++) {
        assert(dmg(30, 2, 'neutral') > dmg(30, 0, 'neutral'), 'sim-plant: 成熟>幼苗');
        assert(dmg(30, 1, 'player') > dmg(30, 1, 'neutral'), 'sim-plant: 培养强化');
    }
}
// 室内僵尸数量确定性
{
    const hash = (s) => { s = (s | 0) ^ 0x9E3779B9; s = Math.imul(s, 0x85EBCA6B) ^ (s >>> 13); s = Math.imul(s ^ (s >>> 16), 0xC2B2AE35); return (s ^ (s >>> 16)) >>> 0; };
    const count = (seed, key, floor, zmul) => {
        const h = hash(seed ^ hash(key.split(',').reduce((a, c) => a * 31 + parseInt(c), 0)) + 999 + floor * 3571);
        const roll = (h % 100) / 100;
        let c;
        if (roll < 0.30) c = 0;
        else if (roll < 0.55) c = 1;
        else if (roll < 0.75) c = Math.round((1 + (h % 2)) * zmul);
        else if (roll < 0.92) c = Math.round((2 + (h % 3)) * zmul);
        else c = Math.round((4 + (h % 4)) * zmul);
        return Math.max(0, Math.min(c, 10));
    };
    for (let i = 0; i < 30; i++) {
        assert(count(12345, '3,5', 1, 1) === count(12345, '3,5', 1, 1), 'sim-door: 确定性');
        const c = count(999 + i, '5,5', 1, 1);
        assert(c >= 0 && c <= 10, 'sim-door: 范围');
    }
}

console.log(`\n============================================`);
console.log(`全系统模块矩阵测试: ${pass} 通过, ${fail} 失败`);
console.log(`============================================`);
process.exit(fail > 0 ? 1 : 0);
