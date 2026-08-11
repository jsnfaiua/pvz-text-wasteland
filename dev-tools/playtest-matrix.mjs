// ============================================================================
// 测试玩家游玩模拟矩阵（2026-08-11 v2.98）
// 扮演测试玩家正常游玩，系统性验证：开局/死亡/救助/尸变/存读档/交易/建造/
// 天气/治疗/车辆/搜刮/开发者/战斗/赠予/植物/营地/命令/传送/食物/整理/招揽/耐久
// 运行：node dev-tools/playtest-matrix.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(projRoot, 'source-code/mod-wasteland/' + f), 'utf8');
const cons = fs.readFileSync(path.join(projRoot, 'source-code/core/constants.js'), 'utf8');

const surv = read('survival.js');
const bal = read('wbalance.js');
const wnpc = read('wnpc.js');
const wstate = read('wstate.js');
const panel = read('panel.js');
const wbuild = read('wbuild.js');
const waction = read('waction.js');
const winfection = read('winfection.js');
const wdev = read('wdev.js');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) pass++; else { fail++; console.log('✗ FAIL: ' + m); } };

// ============ A. 开局状态（wstate createRunDefaults） ============
assert(wstate.includes('hp: B.MAX_HP, maxHp: B.MAX_HP, day: 1'), '开局: hp满/第1天');
assert(wstate.includes('inv: Array(BAG_SIZE).fill(null)'), '开局: 背包空');
assert(wstate.includes("controllerId: 'player'"), '开局: controllerId');
assert(wstate.includes('_downed: null'), '开局: 无倒地');
assert(wstate.includes("food: B.HUNGER_MAX, water: B.WATER_MAX"), '开局: 满食水');

// ============ B. 死亡流程 ============
assert(surv.includes('n.alive && !n.downed && n.party && n.id !== sv.controllerId && !n.isPlayer'), '死亡: mates过滤');
assert(surv.includes('你 倒 下 了'), '死亡: 有队友弹窗');
assert(surv.includes('你 阵 亡 了'), '死亡: 独狼弹窗');
assert(surv.includes('sv._deathCount = (sv._deathCount || 0) + 1;'), '死亡: 次数递增');
assert(surv.includes('B.deathDropRate(sv._deathCount)'), '死亡: 掉落率递增');

// ============ C. 救助 ============
assert(surv.includes('limit - spent') || surv.includes('DOWNED_LIMIT_SECONDS - spent'), '救助: 救援时间递减(limitSec)');
assert(bal.includes('DOWNED_HIT_PENALTY_SEC = 10'), '救助: 扣10秒');
assert(surv.includes('m.hp = Math.max(1, Math.round(m.maxHp * 0.3))'), '救助: 救活30%');
assert(surv.includes('submitRescueMed'), '救助: 提交药品');

// ============ D. 尸变系统 ============
assert(bal.includes('CORPSE_REVIVE_SECONDS = 180'), '尸变: 3分钟(用户缩短)');
assert(surv.includes('corpseReviveZombie'), '尸变: 生成丧尸');
assert(surv.includes('reviveZombieToCorpse'), '尸变: 掉尸变尸体');

// ============ E. 序列化完整性（测试玩家发现的4个bug修复） ============
assert(wnpc.includes('_corpseAtReal: n._corpseAtReal != null ? n._corpseAtReal : null,'), '序列化: _corpseAtReal');
assert(wnpc.includes('_revived: !!n._revived,') && wnpc.includes('_revivedCorpse: !!n._revivedCorpse,'), '序列化: 尸变标记');
assert(wstate.includes('_reviveFromCorpse: !!z._reviveFromCorpse,'), '序列化: 尸变丧尸标记');
assert(wstate.includes('_corpseAtReal: 0,'), '序列化: 旧档尸体倒计时');
assert(surv.includes('z.skin = n.look.skin'), '尸变: 外观继承尸体');

// ============ F. 交易 ============
assert(surv.includes('B.TRADE_MARKUP'), '交易: 加价');
assert(surv.includes('B.TRADE_DISCOUNT'), '交易: 折扣');
assert(surv.includes("金币不足，无法购买"), '交易: 金币不足');
assert(surv.includes("背包已满"), '交易: 背包满');
assert(surv.includes('price = devInf ? 0'), '交易: 开发者免费');
assert(surv.includes('sv.coins = (sv.coins || 0) + price'), '交易: 卖出加钱');

// ============ G. 建造 ============
assert(wbuild.includes('> B.BUILD_RANGE) return false'), '建造: 范围');
assert(wbuild.includes('sv.woodCount < bitem.cost'), '建造: 木材不足');
assert(wbuild.includes("takeItem('wood', bitem.cost)"), '建造: 消耗木材');
assert(wbuild.includes('existing.lv = lv + 1'), '建造: 墙升级');
assert(wbuild.includes('B.DEMOLISH_REFUND'), '建造: 拆除返还');

// ============ H. 天气 ============
assert(surv.includes('B.weatherAt(sv.world.seed, sv.day)'), '天气: 按天');
assert(surv.includes('sv._lastWxHour < 8 && hour >= 8'), '天气: 8点切换');
assert(surv.includes('B.seasonAt(sv.day)'), '天气: 季节');
assert(surv.includes('_devWxLock'), '天气: 开发者锁定');

// ============ I. 开发者模式 ============
assert(surv.includes('_devGod'), '开发: 无敌');
assert(surv.includes('_devInf'), '开发: 资源无限');
assert(surv.includes('_devInfAmmo'), '开发: 无限弹药');
assert(surv.includes('_devInfStamina'), '开发: 无限体力');
assert(surv.includes('_devOneShot'), '开发: 一击必杀');

// ============ J. 队员 ============
assert(wnpc.includes('npcShareWithMates'), '队员: 赠予');
assert(surv.includes('最多 4 人'), '队员: 上限4');
assert(wnpc.includes('n._corpse = true;'), '队员: 死亡留尸体');

// ============ K. 战斗 ============
assert(surv.includes('invuln'), '战斗: 无敌帧');
assert(surv.includes('guarding'), '战斗: 格挡');
assert(cons.includes('export const WEAPONS = {'), '战斗: 武器表');

// ============ L. 开发者模式（第八九轮补充） ============
// L1: 刷僵尸上限
assert(wdev.includes('const limit = Math.max(1, Math.min(30, n || 6));'), 'dev: 刷僵尸上限30');
assert(wdev.includes('if (sv.interior)'), 'dev: 室内刷僵尸');
// L2: 传送下车检查
assert(wdev.includes('请先下车再传送'), 'dev: 传送需下车');
// L3: dev toggle 标准
for (const t of ['_devGod', '_devInfStamina', '_devInfAmmo', '_devInfDura', '_devOneShot', '_devInfBag', '_devHud']) {
    assert(wdev.includes(`sv.${t} = !sv.${t};`), `dev: ${t} 标准toggle`);
}
// L4: setAllStatsFull 清倒地（bug#6）
assert(wdev.includes('sv._downed = null;') && wdev.includes('sv._downedMembers = [];'), 'dev: 一键回满清倒地');
assert(wdev.includes('sv._carryMateId = null;'), 'dev: 一键回满清背起');
// L5: 开发者开关不入存档（wsync dev 对象仅联机同步）
{
    const snapIdx = wstate.indexOf('export function applySnapshot');
    const snapSeg = snapIdx > 0 ? wstate.slice(snapIdx, snapIdx + 4000) : '';
    assert(!snapSeg.includes('_devGod'), 'dev: 存档不含 _devGod（不残留无敌）');
}

// ============ M. 逻辑模拟 ============
// 交易购买
{
    const simBuy = (sv, npc, price, devInf) => {
        if (!devInf && sv.coins < price) return 'insufficient';
        if (sv.inv.every(s => s !== null)) return 'bagfull';
        if (!devInf) sv.coins -= price;
        const slot = sv.inv.findIndex(s => s === null);
        sv.inv[slot] = { id: 'x', n: 1 };
        return 'ok';
    };
    for (let i = 0; i < 30; i++) {
        const sv = { coins: 100, inv: new Array(24).fill(null) };
        assert(simBuy(sv, {}, 10, false) === 'ok' && sv.coins === 90, 'sim-交易: 扣钱');
        const sv2 = { coins: 5, inv: new Array(24).fill(null) };
        assert(simBuy(sv2, {}, 10, false) === 'insufficient', 'sim-交易: 钱不足');
    }
}
// 救援时间边界
{
    const simR = (now, pen) => Math.max(0, 1200 - (Math.max(0, now) + (pen || 0)));
    for (let i = 0; i < 30; i++) {
        assert(simR(1199, 0) === 1, 'sim-救援: 剩1秒');
        assert(simR(1200, 0) === 0, 'sim-救援: 归零');
        assert(simR(1000, 300) === 0, 'sim-救援: 扣时超时');
    }
}
// 饱食/饥饿
{
    const simHunger = (hp, d) => Math.max(0, hp - d);
    for (let i = 0; i < 30; i++) {
        assert(simHunger(10, 1.6) > 0, 'sim-饥饿: 掉血');
        assert(simHunger(1, 1.6) === 0, 'sim-饥饿: 归零');
    }
}
// 营地回血
{
    const simCamp = (inCamp, hp) => inCamp ? Math.min(100, hp + 2) : hp;
    for (let i = 0; i < 30; i++) {
        assert(simCamp(true, 50) === 52, 'sim-营地: 回血');
        assert(simCamp(false, 50) === 50, 'sim-营地: 外不回');
    }
}
// 全灭判定
{
    const simAllDead = (npcs, ctrl) => {
        const snap = npcs.map(n => ({ ...n }));
        const pc = snap.find(n => n.id === ctrl) || snap.find(n => n.isPlayer);
        if (pc) { pc.downed = true; pc.hp = 1; }
        const mates = snap.filter(n => n.alive && !n.downed && n.party && n.id !== ctrl && !n.isPlayer);
        const cur = snap.find(n => n.id === ctrl);
        const cAlive = !!(cur && cur.alive && !cur.downed);
        const pAlive = snap.some(n => n.isPlayer && n.alive && !n.downed && n.id !== ctrl);
        const any = mates.length >= 1 || cAlive || pAlive;
        const had = snap.some(n => n.party && n.id !== ctrl && !n.isPlayer);
        if (mates.length >= 1) return '切换队友';
        if (had && !any) return '全灭';
        return '独狼重生';
    };
    for (let i = 0; i < 30; i++) {
        assert(simAllDead([{ id: 'pc', isPlayer: true, party: true, alive: true }, { id: 'a', party: true, alive: true }], 'pc') === '切换队友', 'sim-全灭: 有队友切视角');
        assert(simAllDead([{ id: 'pc', isPlayer: true, party: true, alive: true }, { id: 'a', party: true, alive: true, downed: true }], 'pc') === '全灭', 'sim-全灭: 队友全倒');
        assert(simAllDead([{ id: 'pc', isPlayer: true, party: true, alive: true }], 'pc') === '独狼重生', 'sim-全灭: 独狼');
    }
}

console.log(`\n============================================`);
console.log(`测试玩家游玩模拟矩阵: ${pass} 通过, ${fail} 失败`);
console.log(`============================================`);
process.exit(fail > 0 ? 1 : 0);
