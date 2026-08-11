// ============================================================
// 【无尽植僵荒原】模组 · NPC 系统（M-η）
// 阵营：友善(交易/邀请入队/雇佣) / 恶意(主动攻击) / 中立(见机行事)
// 自我生存：饿了吃饭、渴了喝水、搜刮物资（背包/营地箱）；
// 成长与年龄：随天数成长、年老/战死/饿死；营地任务与工作日志；
// 队伍：跟随/回营地命令、切换控制（24H 冷却）、仅 2 人时阵亡自动切换。
// ============================================================

import AudioSystem from '../systems/audio.js';
import { WEAPONS } from '../core/constants.js';
import { T, getTile, setTile, isWalk, hash2, SPAWN, CHUNK } from './world.js';
import { TS } from './wconst.js';
import * as B from './wbalance.js';
import * as Panel from './panel.js';
import * as MSG from './wmsg.js';
import { randomLook } from './wlook.js';
import { zombieHitSound } from './wgear.js';
import { districtAt, nearestCityAt, industrialAngleAt } from './wdistrict.js';
import * as WV from './wvehicle.js';
import { astarPath, astarField, gridKey } from './wpath.js';
import { rollZombieInfection, addPlayerInfection, playerInfectionEffects, PLAYER_INFECTION } from './winfection.js';

const NAMES = ['阿远', '老周', '小满', '铁柱', '阿珍', '老顾', '二丫', '栓子', '大牛', '秀兰',
    '阿彪', '老陈', '翠花', '石头', '阿花', '建国', '玉兰', '老李', '春妮', '大强'];
const CAMP_R = 6;                 // 营地活动半径（格）
const NPC_VIEW = 7;               // 恶意 NPC 索敌半径（格）
const NPC_FRIENDLY_FIGHT = 5;     // 友善 NPC 反击半径（格）
const GROWTH_INTERVAL = 10;       // 成长间隔（天）：血量/伤害随年龄成长
const MAX_AGE = 70;               // 超过此年龄每天有自然死亡概率
const SWITCH_CD = 240;            // 2026-08-10 切换控制冷却（秒）= 240s（原 24H），所有成员共用此冷却
const AI_FAR_DIST = 14 * TS;      // 距离玩家超过此距离的 NPC：AI 0.3s 一跳（性能）
const CORPSE_KEEP_DAYS = 3;       // 2026-08-10 已搜索尸体（遗物已取走）保留天数，超期自动腐烂移除（性能：防尸体无限堆积）
// 2026-08-10 已搜索尸体的清理起算天数：优先用"搜索完成当天 _corpseSearchedDay"（搜完再留 N 天），
// 旧档/兜底回退到死亡当天 _corpseDay，再兜底当天（不立即清理）。避免"重生后过数天才回死亡点搜尸，
// 搜索标记一打上就因死亡天数超期被立刻剔除"的问题。
function corpseSearchedDay(n) {
    if (n._corpseSearchedDay != null) return n._corpseSearchedDay;
    if (n._corpseDay != null) return n._corpseDay;
    return 0;
}
const NPC_CAP = 60;               // 世界 NPC 软上限（自然繁衍受限于此，玩家/开发面板不受限）
// 2026-08-10 与玩家一致的生命体征参数（对齐 waction.js：奔跑 6/s、正常回体 14/s、力竭回体 10/s）
const NPC_STAM_DELAY = 0.5;       // 体力消耗后回复延迟
const NPC_STAM_NORMAL = 14;       // 正常回复速率 /s
const NPC_STAM_EXHAUST = 10;      // 力竭期回复速率 /s
const NPC_SPRINT_DRAIN = 6;       // 奔跑（speedMul>=1 急行）持续耗体力 /s
const NPC_ATK_STAM_COST = 6;      // 拳头/无体力定义武器的近战消耗（有 stamina 字段的武器用其自身值）
export const NPC_INFECTION_CURE_PAN = 25;  // NPC 界面"减感染"：抗生素 -25
export const NPC_INFECTION_CURE_HERB = 15; // NPC 界面"减感染"：草药×3 -15

function log(sv, m, c) { MSG.pushMsg(sv, m, c); }

// NPC 携带的随机武器（与玩家可用武器类型一致，按阵营加权；远程附带少量弹药），
// 武器随背包可交易、可被切换操控使用、战斗中消耗耐久与弹药
const NPC_WEAPON_POOL = {
    friendly: ['dagger', 'sword', 'spear', 'axe', 'shovel', 'pistol', 'knife', 'shotgun', 'bow', 'rifle'],
    neutral: ['dagger', 'sword', 'spear', 'pistol', 'knife', 'bow', 'shovel'],
    hostile: ['dagger', 'sword', 'axe', 'spear', 'pistol', 'knife', 'shotgun', 'smg', 'rifle', 'sniper'],
};
function randomNpcWeapon(role) {
    const pool = NPC_WEAPON_POOL[role] || NPC_WEAPON_POOL.friendly;
    const key = pool[Math.floor(Math.random() * pool.length)];
    const def = WEAPONS[key];
    const items = [{ id: 'wpn:' + key, n: 1, eq: def.kind === 'melee' ? 'melee' : 'ranged' }];
    if (def.kind === 'ranged' && def.ammoType) items.push({ id: 'ammo:' + def.ammoType, n: 20 + Math.floor(Math.random() * 20) });
    return { key, def, items };
}

// 出生属性：3d6 随机 + 先天天赋（25%）加成 + 先天疾病（15%）
function rollPersonBase() {
    const attrs = { str: B.rollAttrib(), con: B.rollAttrib(), agi: B.rollAttrib(), int: B.rollAttrib() };
    const talent = Math.random() < 0.25 ? B.TALENT_KEYS[Math.floor(Math.random() * B.TALENT_KEYS.length)] : null;
    if (talent) {
        const t = B.TALENTS[talent];
        for (const k of B.ATTRIB_KEYS) if (t[k]) attrs[k] = Math.min(18, attrs[k] + t[k]);
    }
    const congenital = Math.random() < 0.15 ? B.CONGENITAL_KEYS[Math.floor(Math.random() * B.CONGENITAL_KEYS.length)] : null;
    return { attrs, talent, congenital };
}

// 2026-08-10 背包归一化：NPC 的 inv 是动态数组，切主控后 sv.inv 会被替换为 NPC 的 inv，
// 玩家背包 UI/容量逻辑期望固定 BAG_SIZE 格（24）。不足补 null、超长保留（支持开发无限背包），
// 保证"NPC 切主控后背包大小与主控玩家一致"。
export function normBag(arr) {
    if (!Array.isArray(arr)) arr = [];
    const cap = Math.max(Panel.BAG_SIZE, arr.length);
    const out = arr.slice(0, cap);
    while (out.length < Panel.BAG_SIZE) out.push(null);
    return out;
}
export function makeNpc(sv, x, y, role, extra) {
    const seed = sv.world.seed;
    // 生成点安全化：不可走（建筑/障碍内）时就近找可走格，防 NPC 卡墙
    const p = findWalkableNear(sv, x, y, 8);
    x = p.x; y = p.y;
    const name = (extra && extra.name) || NAMES[Math.floor(hash2(seed ^ 0x9E7, Math.floor(x / TS), Math.floor(y / TS)) * NAMES.length) % NAMES.length];
    const look = randomLook();
    const wp = randomNpcWeapon(role);
    const base = role === 'hostile' ? 90 : 80;
    // 随机背包物品（2~4 件：食物/水/零件/草药/药/汽油/金币等）
    const inv = [...rollNpcBag(), ...(extra && extra.inv ? extra.inv : []), ...wp.items];
    const born = rollPersonBase();
    return {
        id: 'npc' + Math.floor(x) + '_' + Math.floor(y) + '_' + Math.floor(Math.random() * 1e6),
        name, role: role || 'friendly', look,
        x, y, tx: x, ty: y,
        hp: base, maxHp: base, food: 80, water: 80,
        // 2026-08-10 与玩家一致的生命体征：体力（移动/攻击消耗，可恢复）、感染值（被僵尸咬累积，减速/降血上限）
        stamina: 100, maxStamina: 100, exhausted: false, infection: 0, _stamDelay: 0,
        dmg: Math.max(8, Math.round(wp.def.damage * (role === 'hostile' ? 1 : 0.7))),
        wpnKey: wp.key, wpnName: wp.def.name,
        inv,
        coins: 40 + Math.floor(Math.random() * 80),
        attrs: born.attrs, talent: born.talent, congenital: born.congenital,
        act: { melee: 0, hit: 0, run: 0 },
        bornDay: sv.day,
        alive: true,
        party: false, hired: false, hireFee: null,
        campId: null,   // 阵营归属：所属营地 id（null = 无营地归属的流浪者/敌对方）
        sick: null,
        state: 'wander', campTask: null, workT: 0,
        atkCd: 0, hurtT: 0, idleT: 0, wanderDir: null, swingT: 0, swingDir: 0, swingWeapon: null,
        riding: false,
        workLog: [],
        followTarget: null,
        _nextNeed: 4,
        ...(extra || {}),
    };
}
// 随机背包补给（2~4 件；含领地旗帜，可从 NPC 交易购买/入队获得）
function rollNpcBag() {
    const pool = ['food', 'water', 'wood', 'stone', 'herb', 'part', 'fuel', 'med:cold', 'med:wound', 'flag'];
    const n = 2 + Math.floor(Math.random() * 3);
    const out = [];
    for (let i = 0; i < n; i++) {
        const id = pool[Math.floor(Math.random() * pool.length)];
        out.push({ id, n: id === 'food' || id === 'water' || id === 'wood' || id === 'stone' ? 1 + Math.floor(Math.random() * 2) : 1 });
    }
    return out;
}

// 就近可走格（生成兜底：防 NPC 卡进建筑/障碍；r 为搜索半径格数）
function findWalkableNear(sv, x, y, r) {
    const gx0 = Math.floor(x / TS), gy0 = Math.floor(y / TS);
    if (isWalk(getTile(sv, gx0, gy0))) return { x, y };
    for (let rr = 1; rr <= r; rr++) {
        for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
            if (isWalk(getTile(sv, gx0 + dx, gy0 + dy))) {
                return { x: (gx0 + dx + 0.5) * TS, y: (gy0 + dy + 0.5) * TS };
            }
        }
    }
    return { x, y };
}

// 初始 NPC：出生点屏幕内（15×9 格）不刷任何生物；友善开局伙伴放在屏幕外较近处，
// 恶意 NPC 更远。用户要求"出生点屏幕内不会出现敌对/友方生物"。
export function spawnInitialNpcs(sv) {
    if (!sv.npcs) sv.npcs = [];
    const sx = (SPAWN.x + 0.5) * TS, sy = (SPAWN.y + 0.5) * TS;
    for (let i = 0; i < 1; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (17 + Math.random() * 4) * TS;   // 屏幕外（>15 格）的开局伙伴
        sv.npcs.push(makeNpc(sv, sx + Math.cos(ang) * d, sy + Math.sin(ang) * d, 'friendly'));
    }
    for (let i = 0; i < 2; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (22 + Math.random() * 8) * TS;   // 更远（22~30 格），不堵出生点
        sv.npcs.push(makeNpc(sv, sx + Math.cos(ang) * d, sy + Math.sin(ang) * d, 'hostile'));
    }
}

// 玩家/队伍主控 = sv.controllerId（统一名册：原主角记录 id='player' 也在 sv.npcs 中）
export function controlledNpc(sv) {
    return sv.controllerId ? (sv.npcs.find(n => n.id === sv.controllerId) || null) : null;
}

// 原主角的队员记录（id='player'）：切换控制时它留在世界里继续行动，不消失
export function makePlayerEntry(sv) {
    const born = rollPersonBase();
    return {
        id: 'player', isPlayer: true,
        name: '幸存者', role: 'friendly', look: sv.character || null,
        x: sv.px, y: sv.py, tx: sv.px, ty: sv.py,
        hp: sv.hp, maxHp: sv.maxHp || 100, food: sv.food, water: sv.water,
        stamina: sv.stamina != null ? sv.stamina : 100, maxStamina: sv.maxStamina || 100,
        exhausted: !!sv.exhausted, infection: sv.infection || 0, _stamDelay: 0,
        dmg: 10, inv: sv.inv, wpn: sv.wpn,
        attrs: born.attrs, talent: born.talent, congenital: born.congenital,
        act: { melee: 0, hit: 0, run: 0 },
        bornDay: sv.day, alive: true,
        party: true, hired: false, hireFee: null,
        sick: null,
        state: 'follow', campTask: null, workT: 0,
        atkCd: 0, hurtT: 0, idleT: 0, wanderDir: null,
        workLog: [], followTarget: null,
    };
}

// 初始化名册：原主角记录 + 初始 NPC；旧档（无 isPlayer 记录）自动补齐
export function initRoster(sv) {
    if (!sv.npcs) sv.npcs = [];
    if (!sv.npcs.some(n => n.isPlayer)) sv.npcs.unshift(makePlayerEntry(sv));
    if (!sv.controllerId) sv.controllerId = 'player';
}

// ---------- 主循环（大世界每帧） ----------
export function updateNpcs(sv, dt, canStand) {
    if (!sv.npcs) return;
    // 死亡 NPC 在帧边界统一移除（killNpc 只置 alive=false，遍历中 splice 会破坏 for...of 索引）：
    // 防 npcs 数组与存档无界增长——长期游玩死尸堆积会让每帧遍历/敌意扫描/存档体积持续退化。
    // 2026-08-10 例外：_corpse 标记的尸体（成员/主角遗物尸体）保留在 npcs 中——尸体需要
    // 渲染常驻 + F 搜索（用户需求"尸体形象留在原地、在尸体上搜索"），不能被帧边界清掉。
    if (sv.npcs.length) {
        let hasDead = false;
        for (let i = 0; i < sv.npcs.length; i++) {
            const n = sv.npcs[i];
            // 2026-08-10 性能：已搜索的尸体（遗物已取走）超过 CORPSE_KEEP_DAYS 天自动腐烂移除，
            // 防长期游玩尸体无限堆积导致数组/存档/每帧遍历持续增长；未搜索尸体保留（玩家随时可回来搜）。
            // 2026-08-10 修正"搜索完尸体立刻消失"：清理从【搜索完成当天 _corpseSearchedDay】起算，
            // 而非死亡当天 _corpseDay——全员阵亡重生后过数天才回死亡点，若用死亡天数，尸体在
            // 搜索标记（_corpseSearched=true）的下一帧就被判定超期剔除（用户反馈：搜完尸体消失）。
            if (n._corpse && n._corpseSearched && (sv.day - corpseSearchedDay(n)) >= CORPSE_KEEP_DAYS) { hasDead = true; break; }
            if (!n.alive && !n._corpse) { hasDead = true; break; }
        }
        if (hasDead) sv.npcs = sv.npcs.filter(n => {
            if (!n.alive && !n._corpse) return false;
            if (n._corpse && n._corpseSearched && (sv.day - corpseSearchedDay(n)) >= CORPSE_KEEP_DAYS) {
                // 2026-08-10 修复"死亡地点标志永久残留"：尸体腐烂消失时，若它是死亡点遗物尸体
                //（位置匹配 _legacyDrop），同步清除死亡地点指引——否则指引依赖"找到已搜索尸体"
                // 判定，尸体被清后永远找不到 → 标志永不消失（用户反馈：到达死亡点标志没消失）。
                if (sv._legacyDrop && Math.abs(n.x - sv._legacyDrop.x) < TS && Math.abs(n.y - sv._legacyDrop.y) < TS) sv._legacyDrop = null;
                return false;
            }
            return true;
        });
    }
    // 2026-08-10 修复"切视角操控的队友被击杀（帧边界移除）后 controllerId 悬空"：
    // 悬空的 controllerId 会让 applyControlled/清除NPC 找不到主控 → 主控丢失/误删。
    // 回退策略：① controllerId 指向的记录还在 → 正常；② 不在且 isPlayer 记录存活 → 切回原主角；
    // ③ 都不在 → 清空 controllerId（上层软核重生会 initRoster 重建新幸存者）。
    if (sv.controllerId && sv.npcs && !sv.npcs.some(n => n.id === sv.controllerId)) {
        const pl = sv.npcs.find(n => n.isPlayer && n.alive);
        sv.controllerId = pl ? pl.id : null;
    }
    if (sv._switchCd > 0) sv._switchCd -= dt;   // 切换冷却
    if (sv._combatT > 0) sv._combatT -= dt;     // 交战状态衰减（玩家打/被打时刷新）
    const camp = sv.camp;   // 营地由领地旗帜确立，可能为 null
    const inCamp = camp && Math.hypot(sv.px - camp.x, sv.py - camp.y) < B.CAMP_RADIUS * TS;
    const controller = controlledNpc(sv);
    // 主控把状态写回记录（切换/存档时以记录为准）
    if (controller) syncControlledToRecord(sv, controller);

    for (const n of sv.npcs) {
        if (!n.alive) continue;
        if (n.downed) continue;   // 2026-08-09 倒地主角由 updateDowned 专门管理（背人/救援），普通 AI 不驱动
        if (n._mpCtlT > 0) { n._mpCtlT -= dt; continue; }   // 联机：guest 正操控该 NPC，host 让渡 AI（位置由 npcctl 上报）
        if (n._mpRemote) {                                  // 联机 guest 端：host 权威 NPC，本地 AI 停摆只渲染
            // 位置向快照目标插值（与僵尸同款平滑；无人工否则 NPC 永远停在旧位置）
            if (typeof n._tx === 'number') {
                const k = Math.min(1, dt * 10);
                n.x += (n._tx - n.x) * k; n.y += (n._ty - n.y) * k;
            }
            if (n.hurtT > 0) n.hurtT -= dt;
            if (n.swingT > 0) n.swingT -= dt;
            continue;
        }
        if (n.inInterior) continue;                            // 在室内：由室内跟随驱动（室外不驱）
        if (controller && n.id === controller.id) continue;   // 主控由玩家操控
        if (n.riding) continue;                               // 乘车中（渲染由车辆完成）
        if (sv.driveOrder && sv.driveOrder.driverId === n.id) {
            driveDriverAI(sv, n, dt, canStand);   // 司机：按驾驶订单行动
            continue;
        }
        // 性能：远离玩家的 NPC 降低 AI 频率（生存需求照常，0.3s 一跳），NPC 多时不卡
        if (Math.hypot(n.x - sv.px, n.y - sv.py) > AI_FAR_DIST) {
            n._aiT = (n._aiT || 0) - dt;
            if (n._aiT > 0) { updateNeeds(sv, n, dt, canStand); continue; }
            n._aiT = 0.3;
        }
        updateNpc(sv, n, dt, canStand, camp, controller);
    }
    // 驾驶订单 walk 阶段：主控无操作时被自动带到车边（"队员带我去目的地"；有操作则尊重玩家）
    leadControllerToCar(sv, dt, canStand);
    // NPC 子弹（玩家友好火力：打僵尸与恶意 NPC）
    updateNpcBullets(sv, dt);
    // 2026-08-10 修复"主控被远程武器攻击掉血后又回满"：
    // updateNpcBullets（敌方子弹命中 → sv.hp -= dmg）在 227 行 syncControlledToRecord 之后执行，
    // 扣血后若直接 syncRecordToControlled（用记录旧值覆盖 sv.hp），血量会被"回满"。
    // 先把扣血后的 sv.hp 写回记录，再执行记录→主控同步，保证主控血量持久。
    if (controller) syncControlledToRecord(sv, controller);
    // 主控记录 ← 实时状态
    if (controller) {
        syncRecordToControlled(sv, controller);
        // 主控患病：生命流失 + 有对症药品/草药自动服药（痢疾需有水）
        // 2026-08-09 开局昏迷苏醒：睁眼动画期间状态冻结，不因疾病掉血
        if (controller.sick && !(sv._wake && sv._wake.t < sv._wake.dur)) {
            sv.hp -= B.sickDrainPerSec(controller.sick.type) * dt;
            cureSick(sv, controller, sv.inv, sv.water);
        }
    }
    sv._sick = controller ? controller.sick : null;
    // 主控倍率：年龄阶段 + 属性（敏捷/力量/智力）+ 先天病（哮喘/关节炎/糖尿病/夜盲）+ 天赋（夜行者/神射手）+ 疾病
    const cm = controller ? personMods(controller) : { speedMul: 1, hungerMul: 1, stamMul: 1, stamMaxMul: 1, atkMul: 1, rngMul: 1 };
    const cAge = controller ? (controller.age || sv.day - controller.bornDay) : 0;
    const night = B.isNightHour(sv);
    let spd = cm.speedMul * B.ageStage(cAge).speedMul;
    if (controller && controller.sick) spd *= 0.9;
    if (night) {
        if (controller && controller.congenital === 'nightblind' && B.CONGENITAL.nightblind) spd *= B.CONGENITAL.nightblind.nightSpeedMul;
        if (controller && controller.talent === 'nightowl') spd *= 1.1;
    }
    // 领地旗帜加成：范围内移速/体力恢复提升 + 缓慢回血
    // 战斗中被咬期间暂停营地回血（与自然回血一致：持续啃咬卡 1 血修复，2026-08-09）
    if (inCamp) {
        spd *= B.CAMP_SPEED_MUL;
        // HP_REGEN_MIN_SAFE：低血(<20)完全禁营地回血（同自然回血，2026-08-09 锁血修复）
        // 2026-08-09 用户要求"脱战后低血量也回血要变慢"：hp 20~maxHp 区间按血量线性 ramp
        // 让低血营地回血也变慢，不让玩家"挂着 30 血在营地站着就回满"。
        if (sv.hp > B.HP_REGEN_MIN_SAFE && sv.hp < sv.maxHp && !((sv._combatT || 0) > 0) && !sv._biting) {
            const hpRate = Math.min(1, Math.max(0, (sv.hp - B.HP_REGEN_MIN_SAFE) / Math.max(1, sv.maxHp - B.HP_REGEN_MIN_SAFE)));
            sv.hp = Math.min(sv.maxHp, sv.hp + B.CAMP_HP_REGEN * hpRate * dt);
        }
    }
    sv._bodyMul = spd;
    sv._hungerMul = cm.hungerMul;
    sv._stamMul = cm.stamMul * (inCamp ? B.CAMP_STAM_MUL : 1);
    sv._atkMul = cm.atkMul * B.ageStage(cAge).atkMul;
    sv._rngMul = cm.rngMul;
    // 耐力上限（心脏病/哮喘）：同步主控 maxStamina
    if (controller) {
        const wantStam = Math.max(30, Math.round(100 * cm.stamMaxMul));
        if (wantStam !== sv.maxStamina) { sv.maxStamina = wantStam; sv.stamina = Math.min(sv.stamina, wantStam); }
    }

    // 营地工作日志：玩家回到营地时播报新完成的活
    if (camp) {
        for (const n of sv.npcs) {
            if (!n.alive || n.state !== 'camp') continue;
            const seen = n._logSeen || 0;
            // 防御：异常 NPC 数据缺 workLog（合成/旧档/联机快照字段缺失）时跳过，防主循环崩溃冻结
            if (!Array.isArray(n.workLog) || seen >= n.workLog.length) continue;
            for (let i = n.workLog.length - 1; i >= seen; i--) log(sv, `营地工作日志：${n.workLog[i].text}`, '#FFD700');
            n._logSeen = n.workLog.length;
        }
    }
}

// 领地内敌对生物生成减少：位置在任一旗帜领地范围（半径格）内返回 true
export function inAnyCamp(sv, gx, gy) {
    if (!sv.camp) return false;
    return Math.hypot(gx - sv.camp.x / TS, gy - sv.camp.y / TS) < B.CAMP_RADIUS;
}

function syncControlledToRecord(sv, n) {
    n.x = sv.px; n.y = sv.py;
    n.hp = sv.hp; n.food = sv.food; n.water = sv.water;
    n.stamina = sv.stamina; n.maxStamina = sv.maxStamina; n.exhausted = sv.exhausted; n.infection = sv.infection || 0;
    n.inv = sv.inv; n.look = sv.character || n.look;
    n.maxHp = sv.maxHp;
    n.act = sv._actCounters || n.act;
}
function syncRecordToControlled(sv, n) {
    sv.px = n.x; sv.py = n.y;
    // 2026-08-09 修复"敌对 NPC 打不死玩家"：不再用记录 hp 覆盖 sv.hp——
    // 原 `sv.hp = Math.max(1, n.hp)` 在 NPC 攻击（hostileAI 在 updateNpc 循环内）之后执行，
    // 把玩家刚扣的血拉回记录值（攻击前快照）→ 玩家永远不掉血。
    // 玩家实时 hp 由攻击/回血逻辑控制；记录 hp 由 syncControlledToRecord 维护（存档快照），
    // 此处只同步位置/背包/外观/上限，不覆盖实时 hp。
    sv.food = n.food; sv.water = n.water;
    sv.stamina = n.stamina; sv.maxStamina = n.maxStamina || sv.maxStamina; sv.exhausted = n.exhausted; sv.infection = n.infection || 0;
    sv.inv = n.inv; sv.character = n.look;
    sv.maxHp = n.maxHp || sv.maxHp;
    sv._actCounters = n.act;
}

// 后天培养计数（战斗/挨打/奔跑）；主控走 sv._actCounters 同步，NPC 直接累加
export function addAct(sv, n, kind) {
    if (!n || n.role === 'hostile') return;
    if (sv.controllerId && n.id === sv.controllerId) {
        if (!sv._actCounters) sv._actCounters = { melee: 0, hit: 0, run: 0 };
        sv._actCounters[kind] = (sv._actCounters[kind] || 0) + 1;
    } else if (n.act) {
        n.act[kind] = (n.act[kind] || 0) + 1;
    }
}

// 主控属性（交易定价/属性面板用）
export function controlledAttrs(sv) {
    const c = controlledNpc(sv);
    return (c && c.attrs) || { str: 10, con: 10, agi: 10, int: 10 };
}

// 2026-08-10 NPC 卡碰撞体兜底（与玩家 unstickPlayer 同思路）：
// 若 NPC 位置落在不可站立的格（被挤出/刷在建筑内/卡在有碰撞体积物体上），
// 逐圈向外找最近可站格传送过去——专门解决"NPC 战斗时卡在建筑/碰撞物体里"。
function npcUnstick(sv, n, canStand) {
    if (canStand(n.x, n.y)) return false;
    const gx = Math.floor(n.x / TS), gy = Math.floor(n.y / TS);
    for (let ring = 1; ring <= 8; ring++) {
        for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const cx = (gx + dx + 0.5) * TS, cy = (gy + dy + 0.5) * TS;
            if (canStand(cx, cy)) { n.x = cx; n.y = cy; return true; }
        }
    }
    return false;
}

export function updateNpc(sv, n, dt, canStand, camp, controller) {
    // 每次 AI tick 先复位移动标记；本次若实际调用了 moveToward（移动）会置回 true。
    // 停在原地/休息/打工时保持 false → 渲染层显示待机动画。
    n._moving = false;
    n._running = false;   // 2026-08-10 奔跑标记同步复位（moveToward 在 speedMul>=1.5 时置真）
    // 2026-08-10 NPC 卡碰撞体兜底：位置不可站（卡在建筑/碰撞物体上）→ 传送到最近可站格。
    // 主控 NPC 由玩家操控不在此（但 updateNpc 主控分支会走玩家系统，这里仍保护非主控）。
    // 2026-08-10 性能：节流 0.5s——canStand 可能触发室外 chunk 生成（getTile），
    // 卡住的 NPC 每帧调用会累积卡顿。正常 NPC 绝大多数帧直接 return（位置可站，零开销）。
    if (n.alive && !(sv.controllerId && n.id === sv.controllerId)
        && (n._unstT == null || sv.now == null || sv.now - n._unstT >= 0.5)) {
        if (sv.now != null) n._unstT = sv.now;
        if (npcUnstick(sv, n, canStand)) { n._path = null; }
    }
    // 玩家驾驶中：成员正走向上车集合点（上车动画），走到 2 格内自动上车（riding）
    if (n._boarding) {
        if (!sv.driving) { n._boarding = null; return; }
        if (Math.hypot(n._boarding.x - n.x, n._boarding.y - n.y) < TS * 2) {
            n._boarding = null;
            n.riding = true;
            if (sv.driving) { n.x = sv.driving.x; n.y = sv.driving.y; }   // 骑乘坐标同步到车（防隔空咬）
        } else {
            moveToward(sv, n, n._boarding.x, n._boarding.y, dt, canStand, 1);
        }
        return;
    }
    // 驾驶订单 walk 阶段：全体队员走向汽车（司机单独走 driveDriverAI）
    if (sv.driveOrder && sv.driveOrder.stage === 'walk' && n.party) {
        const o = sv.driveOrder;
        if (Math.hypot(o.carX - n.x, o.carY - n.y) > TS * 1.5) moveToward(sv, n, o.carX, o.carY, dt, canStand, 1);
        return;
    }
    // 冷却
    if (n.atkCd > 0) n.atkCd -= dt;
    if (n.hurtT > 0) n.hurtT -= dt;
    if (n.swingT > 0) n.swingT -= dt;
    // 武器物品被拿走（交易/队员背包取出）：武器键失效，改为肉搏
    if (n.wpnKey && !npcWpnItem(n)) { n.wpnKey = null; n.wpnName = null; }
    // 交谈/交易/查看属性中：原地不动（生存需求照常，遇袭由外层关闭 UI 后解除）
    if (isUiFrozen(sv, n)) {
        updateNeeds(sv, n, dt, canStand);
        return;
    }
    updateNeeds(sv, n, dt, canStand);
    if (!n.alive) return;
    if (n.role === 'hostile') hostileAI(sv, n, dt, canStand);
    else if (n.party && n.state === 'follow') followAI(sv, n, dt, canStand);
    else campOrWanderAI(sv, n, dt, canStand, camp);
}
function isUiFrozen(sv, n) {
    return (sv.npcMenu && sv.npcMenu.id === n.id)
        || (sv.npcTrade && sv.npcTrade.id === n.id)
        || (sv.charPanel && sv.charPanel.id === n.id)
        || (sv.npcMgr && n.party);   // 2026-08-10 队伍管理界面打开：全体队员原地待命（玩家可移动）
}

// 驾驶订单 walk 阶段：主控（玩家实体 sv.px/py）无移动输入时，复用 moveToward 寻路自动走向集合车；
// 有 WASD/方向键输入则让玩家自己走。挂机也会被队员带到车边，不再被丢在原地。
function leadControllerToCar(sv, dt, canStand) {
    const o = sv.driveOrder;
    if (!o || o.stage !== 'walk') return;
    if (Math.hypot(o.carX - sv.px, o.carY - sv.py) <= TS * 2) return;
    const k = sv.keys;
    if (k && (k['w'] || k['a'] || k['s'] || k['d']
        || k['arrowup'] || k['arrowdown'] || k['arrowleft'] || k['arrowright'])) return;
    const tmp = { x: sv.px, y: sv.py, _path: sv._leadPath, _probeDir: sv._leadProbe, _wobT: sv._leadWob };
    moveToward(sv, tmp, o.carX, o.carY, dt, canStand, 1);
    sv.px = tmp.x; sv.py = tmp.y;
    sv._leadPath = tmp._path; sv._leadProbe = tmp._probeDir; sv._leadWob = tmp._wobT;
}

// 2026-08-10 与玩家一致的生命体征：饱食/水分按玩家常量消耗；饥饿/缺水掉血（最低 1 血）；
// 感染值被僵尸咬累积（wzombie.maybeInfectNpc），影响移速与血上限；体力移动/攻击消耗、静置回复。
function updateNeeds(sv, n, dt, canStand) {
    const mods = personMods(n);
    // 饱食/水分：随时间消耗（速率与玩家一致 B.HUNGER_DRAIN / B.WATER_DRAIN）
    n.food = Math.max(0, (n.food != null ? n.food : 80) - B.HUNGER_DRAIN * mods.hungerMul * dt);
    n.water = Math.max(0, (n.water != null ? n.water : 80) - B.WATER_DRAIN * dt);
    // 饥饿/缺水掉血（最低 1 血，与玩家一致：不会饿死/渴死，由玩家在管理界面喂食/喂水）
    if (n.food <= 0) n.hp = Math.max(1, n.hp - B.HUNGER_STARVE_DMG * dt);
    if (n.water <= 0) n.hp = Math.max(1, n.hp - B.WATER_DEHYDRATE_DMG * dt);
    // 感染阶段效果（与玩家一致：减速 + 血量上限降低）；每帧重置移速缓存，治愈后恢复
    n._infSpeedMul = 1;
    if (n.infection > 0) {
        const infEff = playerInfectionEffects(n.infection || 0);
        n._infSpeedMul = infEff.speedMul;
        const effMaxHp = Math.round(n.maxHp * infEff.maxHpMul);
        if (n.hp > effMaxHp) n.hp = effMaxHp;
    }
    // 体力：不足置力竭；静置回复（进食/饮水充足时加速回复，代价是更快消耗二者，与玩家一致）
    if (n.stamina == null) n.stamina = n.maxStamina || 100;
    if (n.maxStamina == null) n.maxStamina = 100;
    if ((n.stamina || 0) <= 0) n.exhausted = true;
    n._stamDelay = Math.max(0, (n._stamDelay || 0) - dt);
    if (n._stamDelay <= 0 && n.stamina < n.maxStamina) {
        let rate = (n.exhausted ? NPC_STAM_EXHAUST : NPC_STAM_NORMAL) * (mods.stamMul || 1);
        const fed = (n.food || 0) >= B.STAM_REGEN_FED_AT && (n.water || 0) >= B.STAM_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, (Math.min(n.food, n.water) - B.STAM_REGEN_FED_AT) / (B.HUNGER_MAX - B.STAM_REGEN_FED_AT));
            rate += B.STAM_REGEN_FED * ramp;
            n.food = Math.max(0, n.food - B.STAM_REGEN_FUEL * dt);
            n.water = Math.max(0, n.water - B.STAM_REGEN_FUEL * dt);
        }
        n.stamina = Math.min(n.maxStamina, n.stamina + rate * dt);
        if (n.stamina >= n.maxStamina) n.exhausted = false;
    }
    // 病：生命持续流失；有药/草药自动服药（痢疾需同时有水）
    if (n.sick) {
        n.hp -= B.sickDrainPerSec(n.sick.type) * dt;
        if (!cureSick(sv, n, n.inv, n.water) && n.hp <= 0) { killNpc(sv, n, '疾病恶化致死'); return; }
    }
    if (n.hp <= 0) { killNpc(sv, n, '疾病恶化致死'); return; }
    // 自动进食/喝水（用自己背包）
    if (n.food < 35) eatFromInv(n);
    if (n.water < 35) drinkFromInv(n);
    // 2026-08-11 v2.97 互助赠与：队伍内 NPC 之间主动分享多余物品（保证自己生存底线）
    if (n.party && n.state !== 'fight') npcShareWithMates(sv, n);
    // 缺粮缺水 → 搜刮（优先搜箱子；野外无箱则采草药充饥）
    if ((n.food < 50 || n.water < 50) && n.state !== 'fight') {
        if (scavenge(sv, n, dt, canStand)) return;
        if (n.food < 50 && forageHerb(sv, n, dt, canStand)) return;
    }
}

function eatFromInv(n) {
    // 防御：NPC 数据缺 inv（旧档/联机快照/开发者召唤等畸形数据）时跳过，防主循环崩溃冻结
    if (!Array.isArray(n.inv)) return;
    const i = n.inv.findIndex(s => s && (s.id === 'food' || s.id === 'herb' || s.id === 'carrot' || s.id === 'corn' || s.id === 'potato'));
    if (i >= 0) { n.food = Math.min(100, n.food + 30); n.inv[i].n--; if (n.inv[i].n <= 0) n.inv.splice(i, 1); }
}
function drinkFromInv(n) {
    if (!Array.isArray(n.inv)) return;
    const i = n.inv.findIndex(s => s && s.id === 'water');
    if (i >= 0) { n.water = Math.min(100, n.water + 35); n.inv[i].n--; if (n.inv[i].n <= 0) n.inv.splice(i, 1); }
}

// ================= 2026-08-11 v2.97 NPC 互助赠与系统（用户需求） =================
// 队伍内 NPC 队友之间主动分享物品：在【保证自己生存底线】的前提下，把多余的
// 物品按需补足给最需要的队友。覆盖所有可分享物品（弹药/水/食物/药品/燃料/工具等）。
// 2026-08-11 v2.99 用户定稿：**所有分享都是"按需非分一半"语义**——
// 只补足队友缺失的额度（差多少给多少），绝不把自己的物资平均切开。
// 规则：
//   弹药  ：队友对应武器弹药低于舒适值（20 发）→ 按需补足到 20（至多用自己超出底线的部分）
//   水    ：自己水分 > 60 且背包水 ≥ 2，队友水分 < 50 → 给 1 份（补足缺口，非均分）
//   食物  ：自己饱食 > 60 且背包食物 ≥ 2，队友饱食 < 50 → 给 1 份（给饱食最低的）
//   药品  ：**优先治病**（队友生病/重伤 → 主动送对症药/抗生素/草药），**其次集中存放**
//     （无人生病时同资源型物品，合并给持有者，不散开占格子；自己保留 1 份底线）
//   燃料/材料/其他资源：**集中存放**——队友已持有则把自己的多余部分合并给持有者；
//     无人持有则自己保留（不散开，避免同类资源占多个队友格子，影响全队背包空间）。
// 节流：每个 NPC 每 2.5 秒最多分享一次（防刷屏/防一帧内连环送空）。
function npcShareWithMates(sv, n) {
    if (!sv || !n || !n.party || !n.alive || n.downed) return;
    if (!Array.isArray(n.inv) || !Array.isArray(sv.npcs)) return;
    // 节流
    const now = sv.now != null ? sv.now : 0;
    if (n._shareT != null && now - n._shareT < 2.5) return;
    const mates = sv.npcs.filter(m => m && m.alive && !m.downed && m.party && m.id !== n.id && !m.isPlayer);
    if (!mates.length) return;
    const tryGive = (idx, amount, tgt, label) => {
        if (idx < 0 || !tgt || amount <= 0) return false;
        const s = n.inv[idx];
        if (!s || s.n < amount) return false;
        s.n -= amount;
        if (s.n <= 0) n.inv.splice(idx, 1);
        // 给目标
        if (!Array.isArray(tgt.inv)) tgt.inv = [];
        const existing = tgt.inv.find(x => x && x.id === s.id);
        if (existing) existing.n += amount;
        else tgt.inv.push({ id: s.id, n: amount });
        n._shareT = now;
        log(sv, `${n.name} 把 ${label} 分享给了 ${tgt.name}`, '#8ad9ff');
        return true;
    };
    // ① 弹药：只赠予队友【对应武器类型】所需的弹药（2026-08-11 v2.99 用户要求：
    // 弹药按队友装备的武器匹配 + "按需补足"语义——队友对应武器弹药低于舒适值（20 发）
    // 时，按需补足到 20；自己该类型保留底线（20 发），只给超出底线的部分。
    // 不是"匀一半"：队友差多少给多少，绝不切开自己存量。
    const ammoNeeds = mates.filter(m => npcAmmoNeed(m) < B.DOWNED_SHARE_AMMO_KEEP)
        .sort((a, b) => npcAmmoNeed(a) - npcAmmoNeed(b));
    for (const tgt of ammoNeeds) {
        const w = tgt.wpnKey && WEAPONS[tgt.wpnKey];
        if (!w || w.kind !== 'ranged' || !w.ammoType) continue;   // 队友无远程武器/无弹药定义 → 不需要
        const ammoId = 'ammo:' + w.ammoType;
        const myTotal = npcAmmoTotal(n, ammoId);
        if (myTotal <= B.DOWNED_SHARE_AMMO_KEEP) continue;   // 自己该类型不超保留底线 → 不给
        // 按需：队友缺多少补到舒适值；至多给"自己超出底线的部分"
        const need = Math.max(0, B.DOWNED_SHARE_AMMO_KEEP - npcAmmoNeed(tgt));
        const give = Math.min(need, myTotal - B.DOWNED_SHARE_AMMO_KEEP);
        if (give <= 0) continue;
        const idx = n.inv.findIndex(s => s && s.id === ammoId);
        if (idx >= 0 && tryGive(idx, give, tgt, '弹药' + w.ammoType)) return;
    }
    // ② 水：自己水分 > 60 且背包水 ≥ 2，队友缺水
    if ((n.water || 0) > B.DOWNED_SHARE_WATER_AT) {
        const thirsty = mates.filter(m => (m.water || 0) < 50).sort((a, b) => (a.water || 0) - (b.water || 0));
        if (thirsty.length) {
            let waterCount = 0; for (const s of n.inv) if (s && s.id === 'water') waterCount += s.n;
            if (waterCount >= 2 && tryGive(n.inv.findIndex(s => s && s.id === 'water'), 1, thirsty[0], '水')) return;
        }
    }
    // ③ 食物：自己饱食 > 60 且背包食物 ≥ 2，给饱食最低的队友
    if ((n.food || 0) > B.DOWNED_SHARE_FOOD_AT) {
        const hungry = mates.filter(m => (m.food || 0) < 50).sort((a, b) => (a.food || 0) - (b.food || 0));
        if (hungry.length) {
            let foodCount = 0; for (const s of n.inv) if (s && isFoodItem(s.id)) foodCount += s.n;
            if (foodCount >= 2) {
                const fi = n.inv.findIndex(s => s && isFoodItem(s.id));
                if (fi >= 0 && tryGive(fi, 1, hungry[0], '食物')) return;
            }
        }
    }
    // ④ 药品：**优先治病，其次集中存放**（2026-08-11 v2.99 用户要求：
    // 药品也集中放一块；但队伍中有人得病时，主动送对症药过去帮忙治病）。
    // 4a) 治病优先：队友生病（或重伤 hp<60%）时，自己有多余药（保留 1 份底线）→ 送对症药/抗生素/草药
    const sickMate = mates.find(m => m.sick);
    const hurtMate = !sickMate ? mates.find(m => m.hp != null && m.hp < m.maxHp * 0.6) : null;
    const patient = sickMate || hurtMate;
    if (patient) {
        // 对症药优先，其次抗生素（可治任意），最后草药
        let medIdx = -1, medId = '';
        if (patient.sick) {
            const needMed = B.SICK_MED[patient.sick.type];
            if (needMed) medIdx = n.inv.findIndex(s => s && s.id === needMed);
            if (medIdx < 0) medIdx = n.inv.findIndex(s => s && s.id === 'med:pan');
        } else {
            medIdx = n.inv.findIndex(s => s && String(s.id || '').startsWith('med:'));
        }
        if (medIdx >= 0) {
            medId = n.inv[medIdx].id;
            // 保留 1 份底线：只有超过底线才送（避免自己断药）
            const totalMed = n.inv.reduce((a, s) => a + (s && String(s.id || '').startsWith('med:') ? s.n : 0), 0);
            if (totalMed > 1 && tryGive(medIdx, 1, patient, medId.slice(4))) return;
        } else {
            // 无药品：送草药（队友生病且自己有多余草药 → 给 1 份）
            const herbIdx = n.inv.findIndex(s => s && s.id === 'herb');
            if (herbIdx >= 0 && n.inv[herbIdx].n > 1 && tryGive(herbIdx, 1, patient, '草药')) return;
        }
    }
    // 4b) 集中存放：无人生病/重伤需要药时，药品同资源型物品——合并给持有者，不散开占格子。
    //     保留 1 份底线（自己随身一粒防意外），超出部分给持有最多药品的队友。
    for (const s of n.inv) {
        if (!s || !String(s.id || '').startsWith('med:')) continue;
        if (s.n <= 1) continue;   // 自己保留底线
        let holder = null, holderAmt = 0;
        for (const m of mates) {
            const cur = (m.inv || []).find(x => x && x.id === s.id);
            const amt = cur ? cur.n : 0;
            if (amt > holderAmt) { holderAmt = amt; holder = m; }
        }
        if (!holder) continue;   // 无人持有：自己保留（成为持有者）
        const give = s.n - 1;
        if (give <= 0) continue;
        if (tryGive(n.inv.indexOf(s), give, holder, s.id.slice(4))) return;
    }
    // ⑤ 资源型物品（燃料/材料/工具等可堆叠资源）：**集中存放，不散开占格子**
    // 2026-08-11 v2.99 用户要求："资源尽量放在一块，不会分来分去占队友格子，影响全队背包空间"。
    // 规则：若队伍中已有人持有该资源 → 自己超出保留底线（3）的部分【合并给持有者】，
    //       把资源集中到同一名队员身上（同类不占多个格子）；若无人持有 → 自己保留（成为持有者），
    //       不主动散给空手队友（避免重复占格）。武器/药品/弹药/水/食物已在上方处理，不参与。
    for (const s of n.inv) {
        if (!s || !String(s.id || '')) continue;
        const id = s.id;
        if (String(id).startsWith('wpn:') || String(id).startsWith('loot:')) continue;   // 武器/战利品袋不分享
        if (String(id).startsWith('med:') || String(id).startsWith('ammo:')) continue;    // 已在上方处理
        if (id === 'water' || isFoodItem(id)) continue;                                   // 已在上方处理
        if (s.n <= 3) continue;   // 自己保留底线（随身少量，防全队断供）
        // 找已持有该资源的队友（优先持有量最多的，作为资源集中点）
        let holder = null, holderAmt = 0;
        for (const m of mates) {
            const cur = (m.inv || []).find(x => x && x.id === id);
            const amt = cur ? cur.n : 0;
            if (amt > holderAmt) { holderAmt = amt; holder = m; }
        }
        if (!holder) continue;   // 无人持有：自己保留（成为持有者），不散开
        const give = s.n - 3;    // 合并超出保留底线的部分给持有者
        if (give <= 0) continue;
        if (tryGive(n.inv.indexOf(s), give, holder, id)) return;
    }
}
// 弹药需要量（对装备远程武器的队友：至少 5 发；否则 0）
function npcAmmoNeed(n) {
    if (!n) return 0;
    if (!n.wpnKey) return 0;
    const w = WEAPONS && WEAPONS[n.wpnKey];
    if (!w || w.kind !== 'ranged' || !w.ammoType) return 0;
    let c = 0; for (const s of n.inv || []) if (s && s.id === 'ammo:' + w.ammoType) c += s.n;
    return c;
}
function npcAmmoTotal(n, ammoId) {
    let c = 0; for (const s of n.inv || []) if (s && s.id === ammoId) c += s.n;
    return c;
}
function isFoodItem(id) {
    return id === 'food' || id === 'herb' || id === 'carrot' || id === 'corn' || id === 'potato';
}

// ---------- 自主捡地面掉落物（2026-08-10 用户需求 / 2026-08-11 v2.99 完善） ----------
// 就近原则：找 NPC 周围 RANGE（= 警戒范围 6 格）内、且玩家不在其脚下拾取范围内的普通掉落
// （跳过 loot: 战利品袋与 coin——留给玩家）。
// 同物品优先：背包已有该 id → 优先拾取（同类堆叠，与玩家规则一致）。
// 2026-08-11 v2.99 修复"多个 NPC 抢同一掉落抽搐"：
//   · 认领机制：每个掉落只能被一个存活 NPC 认领（_claimId），其他 NPC 看到已认领就跳过，
//     不再多个队友同时奔向同一件物品互相推挤/反复改目标。
//   · 认领超时释放：认领者死亡/走不到时，3 秒后释放供其他 NPC 接手。
//   · 拾取用 addItemObj 保留完整对象（品级/耐久/自定义字段），不用 addToArr（丢属性）。
// 返回 true = 本帧用于"走向掉落物去捡"，跳过正常跟随/游荡。
function npcScavengeDrops(sv, n, dt, canStand) {
    if (!Array.isArray(sv.drops) || !Array.isArray(n.inv)) return false;
    const RANGE = 6 * TS;          // 拾取探测半径 = 与警戒范围一致（followAI selfRange=6 格）
    const now = sv.now != null ? sv.now : 0;
    // 认领超时清理（节流 1s 扫一次，防每帧全量遍历）：认领超过 3 秒未拾取 → 释放
    if (sv._dropClaimClearT == null || now - sv._dropClaimClearT > 1) {
        sv._dropClaimClearT = now;
        for (const d of sv.drops) {
            if (d && d._claimId && now - (d._claimT || 0) > 3) { d._claimId = null; d._claimT = 0; }
        }
    }
    // 背包已持有的物品 id 集合（同物品优先）
    const have = new Set();
    for (const s of n.inv) if (s && typeof s.id === 'string') have.add(s.id);
    // 同物品优先：背包有的 id 权重低（更优先拾取）；无的次之
    let best = null, bestScore = Infinity;
    for (const d of sv.drops) {
        if (!d || typeof d.id !== 'string') continue;
        if (d.id.startsWith('loot:') || d.id === 'coin') continue;   // 战利品袋/货币留给玩家
        const dist = Math.hypot(d.x - n.x, d.y - n.y);
        if (dist > RANGE) continue;
        // 玩家正在该掉落脚下（玩家拾取半径内）→ 留给玩家
        if (Math.hypot(d.x - sv.px, d.y - sv.py) < B.PICKUP_RADIUS) continue;
        // 认领：已被其他存活 NPC 认领且未超时 → 跳过（防多个 NPC 抢同一件抽搐）
        if (d._claimId && d._claimId !== n.id) {
            const claimer = sv.npcs && sv.npcs.find(m => m && m.id === d._claimId && m.alive && !m.downed);
            if (claimer) continue;
            // 认领者已死亡/倒地 → 释放认领
            d._claimId = null; d._claimT = 0;
        }
        const owned = have.has(d.id);
        // 优先"背包已有同类"（owned 权重 0），其次按距离；越近分越低
        const score = (owned ? 0 : 1) * 1000 + dist;
        if (score < bestScore) { bestScore = score; best = d; }
    }
    if (!best) return false;
    // 认领目标（防其他 NPC 抢同一件；认领者本人每帧刷新，保持锁定）
    if (best._claimId !== n.id) { best._claimId = n.id; best._claimT = now; }
    const dist = Math.hypot(best.x - n.x, best.y - n.y);
    if (dist < B.PICKUP_RADIUS) {
        // 已到脚下：拾取（保留完整对象属性——品级/耐久，剔除坐标/认领临时字段）
        const used = n.inv.filter(s => s).length;
        const canStack = n.inv.some(s => s && s.id === best.id);
        if (used < Panel.BAG_SIZE || canStack) {
            const clean = { id: best.id, n: best.n || 1 };
            for (const k in best) {
                if (k === 'id' || k === 'n' || k === 'x' || k === 'y' || k === '_claimId' || k === '_claimT' || k === 'contents') continue;
                clean[k] = best[k];
            }
            const left = Panel.addItemObj(n.inv, clean);
            if (left < (best.n || 1)) {
                const idx = sv.drops.indexOf(best);
                if (idx >= 0) sv.drops.splice(idx, 1);
            }
        }
        return false;   // 拾取完成（或装不下），回到正常跟随
    }
    // 没到脚下：跑过去捡（同玩家跑动速度；近处小跑，远处奔跑）
    const spd = dist > 3 * TS ? 1.65 : 1.15;
    moveToward(sv, n, best.x, best.y, dt, canStand, spd);
    return true;
}

// ---------- 搜刮：找最近箱子，走过去，搜索拿物资 ----------
function scavenge(sv, n, dt, canStand) {
    if (n.scavTarget == null || !n.scavTarget.tile) {
        const near = nearestBox(sv, n);
        if (!near) return false;
        n.scavTarget = { tile: near, work: 2 };
    }
    const t = n.scavTarget.tile;
    const gx = Math.floor(n.x / TS), gy = Math.floor(n.y / TS);
    if (Math.abs(gx - t.x) + Math.abs(gy - t.y) > 1) {
        moveToward(sv, n, (t.x + 0.5) * TS, (t.y + 0.5) * TS, dt, canStand);
        return true;
    }
    n.scavTarget.work -= dt;
    if (n.scavTarget.work <= 0) {
        const loot = rollNpcLoot();
        if (loot) n.inv.push(loot);
        n.scavTarget = null;
    }
    return true;
}
function nearestBox(sv, n) {
    const cx = Math.floor(n.x / TS), cy = Math.floor(n.y / TS);
    for (let r = 1; r <= 10; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const t = getTile(sv, cx + dx, cy + dy);
            if (t === T.BOX || t === T.WBOX || t === T.MEDBOX || t === T.MATBOX) return { x: cx + dx, y: cy + dy };
        }
    }
    return null;
}
// 野外觅食：附近 16 格找草药，走过去采掉（herb 可充饥可入药），原地吃一点
function forageHerb(sv, n, dt, canStand) {
    if (!n._herbTarget) {
        const h = nearestTileOf(sv, n, T.HERB, 16);
        if (!h) return false;
        n._herbTarget = { x: h.x, y: h.y, work: 1.5 };
    }
    const t = n._herbTarget;
    const gx = Math.floor(n.x / TS), gy = Math.floor(n.y / TS);
    if (Math.abs(gx - t.x) + Math.abs(gy - t.y) > 1) {
        moveToward(sv, n, (t.x + 0.5) * TS, (t.y + 0.5) * TS, dt, canStand);
        return true;
    }
    t.work -= dt;
    if (t.work <= 0) {
        setTile(sv, t.x, t.y, T.GROUND);
        n.inv.push({ id: 'herb', n: 1 });
        n.food = Math.min(100, n.food + 20);   // 就地啃几口充饥
        n._herbTarget = null;
    }
    return true;
}
function rollNpcLoot() {
    const r = Math.random();
    if (r < 0.24) return { id: 'food', n: 1 };
    if (r < 0.38) return { id: 'water', n: 1 };
    if (r < 0.50) return { id: 'part', n: 1 };
    if (r < 0.66) return { id: 'wood', n: 1 + Math.floor(Math.random() * 2) };
    if (r < 0.78) return { id: 'herb', n: 1 };
    if (r < 0.86) return { id: 'coin', n: 2 + Math.floor(Math.random() * 3) };
    if (r < 0.90) return { id: 'fuel', n: 1 };
    if (r < 0.94) return { id: ['med:cold', 'med:wound', 'med:poison', 'med:heat'][Math.floor(Math.random() * 4)], n: 1 };
    return { id: 'ammo:' + B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)], n: 5 + Math.floor(Math.random() * 8) };
}

// ---------- 移动（A* 寻路：目标格路径场缓存 0.4s，跨墙绕行；近距直线兜底） ----------
export function moveToward(sv, n, tx, ty, dt, canStand, speedMul) {
    const dist = Math.hypot(tx - n.x, ty - n.y);
    // 2026-08-11 v2.97 修复"NPC 跟随/游荡时抽搐"：目标点已极近（<0.15 格）时站定——
    // 此前即使贴近目标，mvx/mvy 残差极小也置 _moving=true + 微移 → 走路动画在几乎不动的
    // 位置高频抖动（玩家移动时跟随 NPC 贴着玩家 / 游荡到目标点即出现）；闪避拉开距离后
    // 目标变远、残差大 → 动画正常，故"闪避时抽搐减少"。仅当真实位移足够大才驱动走路动画。
    // 阈值取 0.15 格（≈5.4px）：只吸收"贴脸微移"的残差，不影响低血近战 hit-and-run 逼近到
    // 攻击距离（reach*0.92 通常 ≥22px > 阈值）出刀。
    if (dist < TS * 0.15) {
        n._moving = false;
        return;
    }
    let mvx = tx - n.x, mvy = ty - n.y;
    if (dist > TS * 1.2) {
        // 走 BFS 路径场（寻路机制与怪物一致）
        const step = pathStepTo(sv, n, Math.floor(tx / TS), Math.floor(ty / TS), canStand);
        if (step) {
            mvx = (step.x + 0.5) * TS - n.x;
            mvy = (step.y + 0.5) * TS - n.y;
        }
    }
    // 动画状态（供渲染复用玩家走动精灵）：标记"正在走" + 朝向。
    // 用 AI 侧 sticky 标记而非渲染逐帧位移差——远离玩家的 NPC 每 0.3s 才 moveToward 一跳，
    // 逐帧判位移会因两次之间 n.x 不动而判定"没在走"→ 出现"平移/只在出生瞬间走一下"的假象。
    n._moving = true;
    n._faceX = mvx; n._faceY = mvy;
    // 2026-08-10 奔跑标记（供渲染与玩家奔跑动画一致，run→动作振幅×2）：
    // speedMul>=1.5 视为奔跑（玩家奔跑倍率 1.65）；否则为普通行走/游荡。
    // 2026-08-10 与玩家完全一致：力竭后【无法奔跑】——玩家 Shift 奔跑在力竭时自动退回步行
    //（sprinting = shift && !exhausted），NPC 对应：力竭且目标为奔跑倍率时降级为步行 1.0。
    let effMul = (speedMul || 1);
    if (n.exhausted && effMul >= 1.5) { effMul = 1; }
    n._running = effMul >= 1.5;
    const d = Math.hypot(mvx, mvy) || 1;
    // 2026-08-10 与玩家一致：感染减速（playerInfectionEffects.speedMul）+ 力竭减速（同玩家力竭 0.6）
    const spd = 95 * effMul * (n._infSpeedMul || 1) * (n.exhausted ? 0.6 : 1);
    // 2026-08-10 与玩家一致：仅【真奔跑】（speedMul>=1.5，对应玩家 Shift 奔跑）持续耗体力；
    // 跟随慢走(1.0-1.15)/游荡(0.5)是"行走"不耗（与玩家"行走不耗、奔跑耗"一致）。
    // 主控由玩家动作系统管理（leadControllerToCar 传无 alive 的临时对象，此处自然跳过；主控 NPC 亦然）
    if (n.alive && !(sv.controllerId && n.id === sv.controllerId) && n.stamina != null && effMul >= 1.5) {
        if (n.stamina > 0) {
            n.stamina = Math.max(0, n.stamina - NPC_SPRINT_DRAIN * dt);
            // 2026-08-10 修复"NPC 体力永远 0"：移动持续刷新 _stamDelay 会把回复门闩永远锁死
            //（跟随/战斗几乎一直 speedMul>=1，_stamDelay 每帧重置 0.5 → 回复分支永远进不去）。
            // 现在移动只消耗体力，不再刷新门闩——体力边走边回；门闩仅由攻击（npcSpendStamina）刷新。
        }
        if (n.stamina <= 0) n.exhausted = true;
    }
    const nx = n.x + mvx / d * spd * dt, ny = n.y + mvy / d * spd * dt;
    const okX = canStand(nx, n.y), okY = canStand(n.x, ny);
    if (okX) n.x = nx;
    if (okY) n.y = ny;
    // NPC 相互轻微排斥（L3）：多名队员跟随/围攻时避免完全重叠（canStand 只查地形不查 NPC）
    // 2026-08-11 性能：先做 O(1) 绝对值快速裁剪（±12px 内才算平方距离+开方）——此前每帧对全部
    // NPC 做平方距离+sqrt，屏幕内 60+ NPC 聚集（营地/战斗）时 = 每帧 3600 次开方 → 卡顿主因。
    if (sv.npcs) {
        for (const o of sv.npcs) {
            if (o === n || !o.alive || o.riding) continue;
            const dxo = n.x - o.x;
            if (dxo > 12 || dxo < -12) continue;   // 快速裁剪：12px 外必然不触发排斥
            const dyo = n.y - o.y;
            if (dyo > 12 || dyo < -12) continue;
            const d2 = dxo * dxo + dyo * dyo;
            if (d2 < 144 && d2 > 0.01) {   // 12px 内
                const dl = Math.sqrt(d2);
                const push = 40 * dt;
                n.x += dxo / dl * push;
                n.y += dyo / dl * push;
            }
        }
    }
    // 完全被挡：怪物式随机偏转试探（0.4s 换一次方向），避免原地罚站
    if (!okX && !okY) {
        n._wobT = (n._wobT || 0) - dt;
        if (n._wobT <= 0 || n._probeDir == null) {
            n._wobT = 0.4;
            n._probeDir = Math.atan2(ty - n.y, tx - n.x) + (Math.random() - 0.5) * 1.8;
        }
        const px2 = n.x + Math.cos(n._probeDir) * spd * dt;
        const py2 = n.y + Math.sin(n._probeDir) * spd * dt;
        if (canStand(px2, n.y)) n.x = px2;
        if (canStand(n.x, py2)) n.y = py2;
    } else {
        n._probeDir = null;
    }
}
// 单点 A* 寻路（wpath.astarPath：octile 启发式，路径最优且比旧 BFS 更快）。
// 返回"从起点出发的第一步"（null = 不可达）；结果缓存 0.4s（_path 键 = 起点>目标）。
// ---------- 共享流场：朝玩家寻路的 NPC 统一复用（M4） ----------
// 与僵尸 getPlayerPathField 同构：从玩家位置反向 BFS 一次，覆盖所有存活 NPC，
// 每个"朝玩家移动"的 NPC 查 parent 得到下一步——替代逐 NPC 独立 A*
// （60 NPC 各跑 3000 节点 A* ≈ 45 万节点/秒 → 一次流场 ≤1.2 万节点）。
// 缓存：玩家格变化或 0.5s 节流重建（覆盖地形变动），挂 sv 上防多实例冲突。
function getNpcFollowField(sv, canStand) {
    const pk = gridKey(Math.floor(sv.px / TS), Math.floor(sv.py / TS));
    const f = sv._npcFollowField;
    // 2026-08-11 v2.99 性能（掉帧排查）：重建间隔 0.5s → 1.0s。
    // 流场只是"朝玩家移动的路径参考"，1s 缓存对队伍跟随无感（队友移动速度远慢于玩家换格），
    // 但大幅降低全量 A* 重建频率（大量 party NPC 聚集时，0.5s 一次 3~300ms 重建 = 周期尖峰）。
    if (f && f.pk === pk && sv.now - f.t < 1.0) return f;
    const targets = new Set();
    for (const n of sv.npcs || []) {
        if (n.alive && !n.riding) targets.add(gridKey(Math.floor(n.x / TS), Math.floor(n.y / TS)));
    }
    // 2026-08-11 v2.97 修复"传送后队友靠拢极慢（过几秒才走一格）"：
    // 长距离寻路节点上限不足——传送后队友距玩家几十~几百格，旧 maxNodes=12000（约 110×110 格）
    // 展开不到起点 → A* 返回空路径 → moveToward 退化为直线走、遇障碍卡住 → 每 0.4s 重试失败。
    // 距离自适应：以最远队友到玩家的距离估算所需节点（A* 平地最坏 ≈ 距离²），
    // 上限 = clamp(距离² × 1.5, 8000, 80000)。仍有 1.0s 缓存保证性能（缓存期内不重算）。
    // 上限从 120000 降到 80000：超长距离（几百格）几乎只在"传送后"出现一次，足够覆盖；
    // 常态跟随（<60 格）用 8000~20000 节点，避免上限过高时最坏情况单次重建过久。
    let maxDist = 0;
    for (const n of sv.npcs || []) {
        if (!n.alive || n.riding) continue;
        const d = Math.hypot(Math.floor(n.x / TS) - Math.floor(sv.px / TS), Math.floor(n.y / TS) - Math.floor(sv.py / TS));
        if (d > maxDist) maxDist = d;
    }
    const need = maxDist > 0 ? Math.min(80000, Math.max(8000, Math.ceil(maxDist * maxDist * 1.5))) : 8000;
    sv._npcFollowField = astarField(Math.floor(sv.px / TS), Math.floor(sv.py / TS), targets, {
        canStand: (x, y) => canStand(x, y),
        ts: TS,
        maxNodes: need,
    });
    sv._npcFollowField.pk = pk;
    sv._npcFollowField.t = sv.now;
    return sv._npcFollowField;
}

function pathStepTo(sv, n, gx, gy, canStand) {
    const sx = Math.floor(n.x / TS), sy = Math.floor(n.y / TS);
    const key = sx + ',' + sy + '>' + gx + ',' + gy;
    if (n._path && n._path.key === key && sv.now - n._path.t < 0.4) return n._path.step;
    let step = null;
    if (sx !== gx || sy !== gy) {
        // 目标 = 玩家当前位置 → 走共享流场（一次 BFS 服务所有跟随 NPC，替代逐 NPC A*；
        // NPC 不在流场覆盖范围/不可达时回退单点 A*）
        if (gx === Math.floor(sv.px / TS) && gy === Math.floor(sv.py / TS)) {
            const field = getNpcFollowField(sv, canStand);
            const parent = field.parent.get(gridKey(sx, sy));
            if (parent) step = { x: parent.gx, y: parent.gy };
        }
        if (!step) {
            // 2026-08-11 v2.97 长距离寻路：距离自适应节点上限（A* 平地最坏 ≈ 距离²），
            // 覆盖传送后几十~几百格距离，否则 A* 展开不到起点返回空路径 → 直线走卡障碍。
            const md = Math.abs(gx - sx) + Math.abs(gy - sy);
            const needN = Math.min(120000, Math.max(3000, md * md * 2));
            const path = astarPath(sx, sy, gx, gy, {
                canStand: (x, y) => canStand(x, y),
                ts: TS,
                maxNodes: needN,
            });
            if (path.length) step = { x: path[0].x, y: path[0].y };
        }
    }
    n._path = { key, step, t: sv.now };
    return n._path.step;
}

// ---------- 恶意 NPC：索敌追击 + 攻击（目标 = 玩家或任何非恶意角色；受击原则与主角一致） ----------
// 2026-08-10 警戒范围按武器分档（用户需求）：
//   无武器/近战 → 僵尸范围（NPC_VIEW=7 格）；
//   弓弩 → 介于（约 15 格，比近战远但比狙击小）；
//   狙击枪 → 玩家一屏范围（约 26 格，进入屏幕即可发现）。
// 隔建筑/墙不可警戒：hostileThreat 对每个候选目标做 wallBetween 视线检测（被挡住不算威胁）。
function hostileAlertRange(sv, n) {
    // 2026-08-10 性能：警戒范围按武器分档的结果缓存 0.3s（hostileAI 每帧调用，直接复用，
    // 避免每帧 npcPickWeapon 全量扫背包——恶意 NPC 多时显著减少开销）。
    if (n._alertR != null && sv.now != null && sv.now - n._alertRT < 0.3) {
        let rr = n._alertR;
        if (sv.squatting) rr = Math.max(3, Math.floor(rr / 2));
        return rr;
    }
    const pick = npcPickWeapon(n, 400, sv.now);
    const w = pick && pick.w;
    let r;
    if (w && w.kind === 'ranged') {
        if (w.scope || w.key === 'sniper') r = 26;      // 狙击：一屏（26 格）
        else if (w.chargeable) r = 15;                  // 弓/弩：介于（15 格）
        else r = 12;                                    // 其他远程枪械：12 格
    } else {
        r = NPC_VIEW;                                   // 无武器/近战：僵尸范围（7 格）
    }
    // 2026-08-10 玩家蹲下（Ctrl 潜伏）：敌对生物感知范围减半
    if (sv.squatting) r = Math.max(3, Math.floor(r / 2));
    // 缓存（含蹲下减半后的最终值；0.3s 内直接复用）
    if (sv.now != null) { n._alertR = r; n._alertRT = sv.now; }
    return r;
}
function hostileAI(sv, n, dt, canStand) {
    // 战斗与队员同一体系：武器随机生效（近战按样式挥击 / 远程射击耗弹药）、低血逃跑、
    // 被近身后退、围攻站位——不再用固定拳头直伤
    if (combatThreat(sv, n, dt, canStand, hostileAlertRange(sv, n), 0, true)) {
        n.state = 'fight';
        return;
    }
    // 无目标：游荡
    n.state = 'wander';
    wanderMove(sv, n, dt, canStand);
}

// 2026-08-10 敌对生物锥形视野（用户需求"视野不是 360°，而是像现实一样 180°~190°"）：
// 以恶意 NPC 当前朝向（_faceX/_faceY）为视轴中心，左右各 ±95°（共 190°）内的目标才可见；
// 背后 ±85° 完全看不到。NPC 静止且无朝向时退化为全向（站桩无朝向不应完全失明）。
function inViewCone(sv, n, tx, ty, halfDeg) {
    const fx = n._faceX, fy = n._faceY;
    const mag = Math.hypot(fx || 0, fy || 0);
    if (!mag) return true;   // 无朝向：全向可见
    const dx = tx - n.x, dy = ty - n.y;
    const d = Math.hypot(dx, dy) || 1;
    const cosAng = (dx * fx + dy * fy) / (d * mag);   // 目标方向与朝向夹角余弦
    const half = (halfDeg || 95) * Math.PI / 180;
    return cosAng >= Math.cos(half);   // 夹角 ≤ 95°（视野 190°）
}
// 恶意 NPC 的威胁收集：僵尸（恶意 NPC 攻击所有敌对生物，僵尸反之）+ 玩家 + 所有非恶意 NPC（主控走玩家受伤路径）
function hostileThreat(sv, n, range) {
    let best = null, bestD = range * TS;
    // 2026-08-10 锥形视野半角：正常 95°（视野 190°）；玩家蹲下时感知减半（见 hostileAlertRange 传入 range 已减半，
    // 此处视野锥半角同样收窄，体现"蹲下更难被发现"）。
    const halfView = sv.squatting ? 60 : 95;
    const pd = Math.hypot(sv.px - n.x, sv.py - n.y);
    // 2026-08-10 修复"恶意 NPC 不攻击切换主控"：`!sv._downed` 全局屏蔽会连未倒地的当前主控一起放过。
    // 正确语义：只放过"当前主控本人倒地"的情况（当前主控记录 n.downed=true，说明正在操控倒地角色等待救治）；
    // 若只是队伍里有其他成员倒地（切到陈月视角救人），当前主控（陈月）未倒地，恶意 NPC 应照常攻击它。
    // 2026-08-10 视线检测（用户需求"室外隔建筑/墙不可警戒"）：候选目标与恶意 NPC 之间
    // 有墙/建筑阻挡（wallBetween）→ 看不到，不列入威胁。室内外统一。
    // 2026-08-11 v2.97 修复"恶意 NPC 0 伤害"：倒地角色不再跳过——允许被选为目标，
    // 命中时走 npcApplyDownedHit 扣救援时间（每点伤害 10 秒，扣完才彻底死亡），
    // 而非"完全不攻击→ 0 伤害"。玩家本人倒地同样允许被攻击（扣救援时间而非免咬）。
    if (pd < bestD && !wallBetween(sv, n.x, n.y, sv.px, sv.py)
        && inViewCone(sv, n, sv.px, sv.py, halfView)) {
        bestD = pd; best = { x: sv.px, y: sv.py, hp: sv.hp, player: true, dmg: 0 };
    }
    if (sv.npcs) {
        for (const o of sv.npcs) {
            if (!o.alive || o.role === 'hostile') continue;
            if (sv.controllerId && o.id === sv.controllerId) continue;   // 主控走玩家受伤路径（含倒地主控 → 扣救援时间）
            const d = Math.hypot(o.x - n.x, o.y - n.y);
            if (d < bestD && !wallBetween(sv, n.x, n.y, o.x, o.y) && inViewCone(sv, n, o.x, o.y, halfView)) {
                bestD = d; best = { x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg };
            }
        }
    }
    // 僵尸：恶意 NPC 与僵尸互打（谁近打谁；同样隔墙不可警戒）
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        const d = Math.hypot(z.x - n.x, z.y - n.y);
        if (d < bestD && !wallBetween(sv, n.x, n.y, z.x, z.y) && inViewCone(sv, n, z.x, z.y, halfView)) {
            bestD = d; best = { x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z };
        }
    }
    return best;
}

// ---------- 队伍跟随（自主战斗：攻击靠近自己或玩家的敌对生物；威胁贴身会躲避） ----------
function followAI(sv, n, dt, canStand) {
    // 玩家交战中：扩大支援范围（10 格），主动赶往玩家身边助战
    const inFight = (sv._combatT || 0) > 0;
    if (combatThreat(sv, n, dt, canStand, inFight ? 10 : 6, inFight ? 10 : 4.5)) return;
    // 2026-08-10 自主捡地面掉落物（就近 + 背包同物品优先；战斗优先于捡物）
    if (!inFight && npcScavengeDrops(sv, n, dt, canStand)) return;
    // 2026-08-10 修复"室内 NPC 旁观不参战"：玩家交战但 NPC 附近（selfRange）无威胁时，
    // 若玩家身边 8 格内有活僵尸 → 主动赶往玩家身边助战（而非原地游荡看戏）。
    // 此前 combatThreat(8) 只在 NPC 自身 8 格内找威胁，室内房间大/复式时 NPC 离战斗区远 → 完全无视。
    if (inFight) {
        const nearby = (sv.zombies || []).some(z => z.hp > 0 && Math.hypot(z.x - sv.px, z.y - sv.py) < 8 * TS);
        if (nearby && Math.hypot(sv.px - n.x, sv.py - n.y) > 2 * TS) {
            moveToward(sv, n, sv.px, sv.py, dt, canStand, 1.1);
            return;
        }
    }
    const dist = Math.hypot(sv.px - n.x, sv.py - n.y);
    // 2026-08-10 用户要求：离玩家较远时 NPC 奔跑过来，动画/步频与角色一致。
    // 距离 > 5 格 → 全力奔跑（speedMul=1.65，与玩家奔跑倍率一致，_running 驱动奔跑动画）；
    // 2.5~5 格 → 小跑（1.15）；≤2.5 格 → 接近后放缓步伐。
    if (dist > 5 * TS) {
        moveToward(sv, n, sv.px, sv.py, dt, canStand, 1.65);
    } else if (dist > 2.5 * TS) {
        moveToward(sv, n, sv.px, sv.py, dt, canStand, 1.15);
    } else {
        // 警戒游荡：在玩家周围中远距离自由巡逻警戒，随时准备出手
        // 2026-08-10 用户要求：NPC 不要围得太紧，避免挡着玩家交互物品。
        // 游荡半径从 1~2 格放宽到 2~3.5 格（保持护卫距离，不贴身）。
        // （目标点只在切换时重算一次并缓存，避免每帧随机导致原地抽搐）
        n.idleT = (n.idleT || 0) - dt;
        if (n.idleT <= 0 || n._wpX == null) {
            n.idleT = 1.5 + Math.random() * 2;
            n.wanderDir = Math.random() * Math.PI * 2;
            const r = 2 + Math.random() * 1.5;
            n._wpX = sv.px + Math.cos(n.wanderDir) * r * TS;
            n._wpY = sv.py + Math.sin(n.wanderDir) * r * TS;
        }
        // 2026-08-11 v2.97 修复"NPC 在玩家周围游荡动画抽搐"：
        // ① 到达游荡目标点（<0.15 格）→ 站定休息（不再每帧微移——此前 moveToward 在目标点附近
        //    仍每帧微小位移 + 方向抖动 → 走路动画抽搐）；② 游荡速度 0.5 → 0.35（更慢更自然，
        //    上下/左右移动不过快，减少来回抽动）。阈值与 moveToward 内部站定（TS*0.15）一致。
        const wpDist = Math.hypot(n._wpX - n.x, n._wpY - n.y);
        if (wpDist < TS * 0.15) {
            n._moving = false;   // 站定：停走动动画
        } else {
            moveToward(sv, n, n._wpX, n._wpY, dt, canStand, 0.35);
        }
    }
}

// 威胁收集：僵尸 + 恶意 NPC（范围内，优先靠近自己的；其次玩家身边的）
function nearestThreat(sv, n, selfRange, playerRange) {
    let best = null, bestD = selfRange * TS;
    let bestVisible = null, bestVisibleD = selfRange * TS;   // 2026-08-10 墙遮挡优化：优先找"看得见"的目标
    const tryThreat = (t) => {
        const d = Math.hypot(t.x - n.x, t.y - n.y);
        if (d >= bestD) return;
        bestD = d; best = t;
        // 视线无墙的目标：攻击优先级更高（否则 NPC 会隔着墙反复开枪，子弹全被墙吞）
        if (!wallBetween(sv, n.x, n.y, t.x, t.y) && d < bestVisibleD) { bestVisibleD = d; bestVisible = t; }
    };
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        tryThreat({ x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z });
    }
    for (const o of sv.npcs) {
        if (!o.alive || o.role !== 'hostile') continue;
        tryThreat({ x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg });
    }
    if (bestVisible) return bestVisible;   // 优先锁定可见目标（无墙）
    if (!best && sv.npcs) {
        // 玩家身边 4.5 格内的威胁：支援玩家
        for (const z of sv.zombies) {
            if (z.hp <= 0) continue;
            if (Math.hypot(z.x - sv.px, z.y - sv.py) < playerRange * TS) { best = { x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z }; break; }
        }
        if (!best) for (const o of sv.npcs) {
            if (!o.alive || o.role !== 'hostile') continue;
            if (Math.hypot(o.x - sv.px, o.y - sv.py) < playerRange * TS) { best = { x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg }; break; }
        }
    }
    return best;
}

// 2026-08-10 只有墙阻挡近战（容器/碎石/绿植不阻挡）：两点连线经过墙格返回 true
function wallBetween(sv, x0, y0, x1, y1) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TS * 0.5)));
    for (let s = 1; s < steps; s++) {
        const fx = x0 + (x1 - x0) * (s / steps), fy = y0 + (y1 - y0) * (s / steps);
        const gx = Math.floor(fx / TS), gy = Math.floor(fy / TS);
        if (sv.interior) {
            const it = sv.interior;
            if (gx >= 0 && gx < it.w && gy >= 0 && gy < it.h && it.tiles[gy * it.w + gx] === 1) return true;   // 室内墙
        } else if (getTile(sv, gx, gy) === T.WALL) {
            return true;   // 室外墙
        }
    }
    return false;
}
// 战斗/躲避：返回 true 表示正在交战（不执行跟随/游荡）
// hostileMode=true：恶意 NPC 模式，威胁 = 玩家 + 非恶意 NPC，并带玩家受击逻辑
export function combatThreat(sv, n, dt, canStand, selfRange, playerRange, hostileMode) {
    // 性能：威胁搜索结果缓存（v2.99 掉帧排查）——
    //   恶意/交战 NPC：0.3s 缓存（战斗响应够快）；
    //   游荡/营地 NPC（无战斗职责）：0.6s 缓存（大量营地 NPC 聚集时避免每 0.3s 集体
    //   全量扫僵尸+NPC = 周期性帧尖峰；游荡 NPC 被僵尸近身 0.6s 内仍会正确警戒）。
    //   扫描相位抖动：初始 _threatT 用随机小数，防止大量 NPC 同帧集体过期 → 集体全量扫描。
    const threatCadence = (!hostileMode && n.state !== 'fight' && n.state !== 'follow') ? 0.6 : 0.3;
    if (n._threatT == null) n._threatT = Math.random() * 0.3;   // 相位抖动：错开集体扫描
    n._threatT = (n._threatT || 0) - dt;
    let threat;
    if (n._threatT <= 0) {
        threat = hostileMode ? hostileThreat(sv, n, selfRange) : nearestThreat(sv, n, selfRange, playerRange);
        // 2026-08-10 目标锁定（防抽搐）：两个目标距离相近时，若当前目标仍存活且
        // 不比新目标远太多（<1.5 倍），沿用旧目标——避免 NPC 在多个僵尸间来回切换导致走位方向突变抽搐。
        const old = n._threat;
        if (old && threat && old !== threat) {
            const oldAlive = (old.z ? old.z.hp > 0 : true) && (old.npc ? old.npc.alive : true);
            const oldD = Math.hypot(old.x - n.x, old.y - n.y);
            const newD = Math.hypot(threat.x - n.x, threat.y - n.y);
            if (oldAlive && oldD < newD * 1.5) threat = old;
        }
        n._threatT = threatCadence;
        n._threat = threat;
    } else {
        threat = n._threat;
    }
    if (!threat) return false;
    const d = Math.hypot(threat.x - n.x, threat.y - n.y);
    // 2026-08-10 动态武器选择：近距用近战、远距用远程、远程没弹自动切近战（用户要求）
    const pick = npcPickWeapon(n, d, sv.now);
    const wpnItem = pick ? pick.item : null;
    const w = pick ? pick.w : null;
    // 2026-08-10 武器损坏/没有可用武器（只剩拳头）：不空手硬拼——拳头伤害低且容易
    // 被围困卡死。优先跑回玩家身边布防（防御列阵，威胁贴身才出拳防御），不自顾自跑。
    // 恶意 NPC 除外（保持原逻辑）。
    if (!w && !hostileMode) return brokenWeaponRegroup(sv, n, threat, d, dt, canStand);
    const lowHp = n.hp < n.maxHp * 0.35;
    // 低血量（<35%）：不是逃跑，而是"走位求生"——远程保持距离边打边撤，
    // 近战打了就走（hit-and-run），尽量不让自己受到伤害（用户要求）
    if (lowHp) {
        if (w && w.kind === 'ranged' && wpnItem) {
            const rngL = w.range || 300;
            // 低血远程：保持射击距离，同时侧向/向后机动（不硬刚）。
            // 2026-08-10 迟滞带：射击圈 0.8*射程 边界用"进入/退出"不同阈值防抽搐。
            const shootIn = d < rngL * 0.8;
            const shootOut = d > rngL * 0.92;
            const prevShoot = n._lowShoot;
            const shoot = prevShoot ? !shootOut : shootIn;
            n._lowShoot = shoot;
            // 2026-08-10 弹道被墙挡时不射击（低血远程同样遵守：不空耗弹药打墙）
            if (shoot && n.atkCd <= 0 && npcAmmoCount(n, w.ammoType) > 0 && !wallBetween(sv, n.x, n.y, threat.x, threat.y)) {
                if (npcSpendStamina(n, w.stamina || NPC_ATK_STAM_COST)) {
                    n.atkCd = w.autoInterval || w.fireInterval || 0.4;
                    // 2026-08-10 低血远程：开火帧站定对准目标（弹道稳定），随后直线后撤保命——
                    // 不再侧移（侧移方向与弹道垂直，"边走边打"打不中 + 空耗弹药）
                    const aimDx = threat.x - n.x, aimDy = threat.y - n.y;
                    const aimDist = Math.hypot(aimDx, aimDy) || 1;
                    n._faceX = aimDx / aimDist; n._faceY = aimDy / aimDist;
                    fireNpcBullet(sv, n, threat, pick);
                }
                // 打一枪后撤一步（直线远离，与弹道共线，命中率更高）
                retreatFrom(sv, n, threat, dt, canStand, 0.9);
                return true;
            }
            retreatFrom(sv, n, threat, dt, canStand, 1.15);
            return true;
        }
        // 低血近战：hit-and-run——接近出刀，出刀后立即撤退走位
        const wDef2 = w && w.kind === 'melee' ? w : null;
        // 2026-08-11 v2.97 与主近战判定一致：去掉 +8（判定 = 特效长度，防"隔空打死"）
        const reach2 = wDef2 ? (wDef2.reach || 40) : 40;
        // 2026-08-10 围攻站位角度（低血逼近同样不冲脸）：每个 NPC 沿自己的角度绕圈贴近
        if (n._jitter == null) n._jitter = (Math.random() - 0.5) * 0.5;
        const angL = Math.atan2(n.y - threat.y, n.x - threat.x) + n._jitter;
        if (d <= reach2 + 20) {
            // 在攻击边缘：出刀后撤
            if (d <= reach2 && n.atkCd <= 0 && !wallBetween(sv, n.x, n.y, threat.x, threat.y)) {
                const tdx2 = threat.x - n.x, tdy2 = threat.y - n.y;
                const tdist2 = Math.hypot(tdx2, tdy2) || 1;
                n._faceX = tdx2 / tdist2; n._faceY = tdy2 / tdist2;
                if (npcSpendStamina(n, wDef2 ? (wDef2.stamina || NPC_ATK_STAM_COST) : NPC_ATK_STAM_COST)) {
                    n.atkCd = wDef2 ? (wDef2.fireInterval || 0.35) : 0.5;
                    if (threat.isZombie) {
                        threat.z.hp -= wDef2 ? wDef2.damage : 8;
                        threat.z.hurt = 0.12;
                        zombieHitSound(sv, threat.z);
                    } else if (threat.npc) {
                        threat.npc.hp -= wDef2 ? wDef2.damage : 8;
                    } else {
                        threat.hp -= wDef2 ? wDef2.damage : 8;
                    }
                    wearNpcWeapon(sv, n, wpnItem);   // 2026-08-10 磨损当前使用的武器（动态选择）
                    n.swingT = 0.22;
                    n.swingDir = angFor(threat, n);
                    n.swingWeapon = (wDef2 ? pick.key : null) || 'fist';
                    sv.effects.push({ kind: 'hit', x: threat.x, y: threat.y, life: 0.15, maxLife: 0.15 });
                    AudioSystem.playWeaponSwing((wDef2 ? pick.key : null) || 'fist');
                    mpSfx(sv, 'swing', { w: (wDef2 ? pick.key : null) || 'fist' });
                    // hit-and-run：出刀后立即后撤（低血量走位，不恋战）
                    retreatFrom(sv, n, threat, dt, canStand, 1.2);
                }
                return true;
            }
            // 攻击圈内（含冷却中）：绕圈站位逼近出刀区（不贴脸；hit-and-run 的"后撤"由
            // 出刀分支内的 retreatFrom 承担，冷却期间不额外后撤，否则在 reach 边界反复
            // 进退进不了出刀区 → 低血近战永远不出刀）。
            moveToward(sv, n, threat.x + Math.cos(angL) * reach2 * 0.92, threat.y + Math.sin(angL) * reach2 * 0.92, dt, canStand, 1.05);
            return true;
        }
        // 太远：接近（低血也不放弃战斗，只是谨慎；同样绕圈站位不冲脸）
        moveToward(sv, n, threat.x + Math.cos(angL) * reach2 * 0.92, threat.y + Math.sin(angL) * reach2 * 0.92, dt, canStand, 1.05);
        return true;
    }
    // 恶意 NPC 的目标是无敌玩家：不可命中，继续追击（不进入攻击动画）
    if (threat.player && (sv._devGod || sv.invuln > 0)) {
        moveToward(sv, n, threat.x, threat.y, dt, canStand, 1.1);
        return true;
    }
    if (w && w.kind === 'ranged' && wpnItem) {
        const rng = w.range || 300;
        // 2026-08-10 距离阈值迟滞（防抽搐）：边界用"进入/退出"不同阈值，
        // 僵尸距离在阈值附近徘徊时不会每帧在 后退/逼近/侧移 之间突切。
        const rs = n._rangeState || 0;   // 0=侧移 1=后退 2=逼近
        let rsNew = rs;
        if (rs !== 1 && d < 110) rsNew = 1;            // 进入后退：d<110
        else if (rs === 1 && d > 140) rsNew = 0;       // 退出后退：d>140（30px 迟滞）
        else if (rs !== 2 && d > rng * 0.85) rsNew = 2;   // 进入逼近：d>0.85*射程
        else if (rs === 2 && d < rng * 0.75) rsNew = 0;   // 退出逼近：d<0.75*射程（迟滞）
        n._rangeState = rsNew;
        // 2026-08-10 弹道被墙挡住（用户要求"前方有障碍物挡住远程子弹→绕障碍选角度、不盲目射击"）：
        // 视线被墙挡 → 不消耗弹药开火（子弹全被墙吞、空耗弹药），沿切线走位绕开障碍找可见角度；
        // 每 0.6s 若仍未打通则换一侧绕（防固定方向绕不出去）。
        if (wallBetween(sv, n.x, n.y, threat.x, threat.y)) {
            n._wallT = (n._wallT || 0) - dt;
            if (n._wallT <= 0) {
                n._strafeDir = ((n._strafeDir || 1) * -1);
                n._wallT = 0.6;
            }
            strafeAway(sv, n, threat, dt, canStand, 0.9);
            return true;
        }
        // 远程武器：保持距离射击（消耗弹药、耐久与体力——与玩家一致）
        // 2026-08-10 射击站定原则（用户要求"不边走边打、命中率提升、避免无效耗弹"）：
        // 开火帧站定瞄准目标再射击，开火后 _aimT 锁 0.22s 站定（弹道稳定不打偏）；
        // 站定结束后才走位（保持射程），冷却间隙移动——不再"射击后立即侧移"导致弹道飘、空耗弹药。
        n._aimT = (n._aimT || 0) - dt;
        if (d < rng && n.atkCd <= 0) {
            if (npcAmmoCount(n, w.ammoType) > 0) {
                if (!npcSpendStamina(n, w.stamina || NPC_ATK_STAM_COST)) { n.atkCd = 0.4; return true; }  // 力竭/体力不足：歇口气
                // 2026-08-10 弓弩蓄力（与玩家完全一致）：chargeable 武器（弓/弩）需先蓄力——
                // _chargeT 累积到最短蓄力 0.25s 才放箭；蓄力期间站定瞄准不移动。
                // 非蓄力武器直接开火（fireInterval/autoInterval 与玩家同源 WEAPONS 表）。
                const chargeable = !!w.chargeable;
                if (chargeable) {
                    n._chargeT = (n._chargeT || 0) + dt;
                    const aimDx = threat.x - n.x, aimDy = threat.y - n.y;
                    const aimDist = Math.hypot(aimDx, aimDy) || 1;
                    n._faceX = aimDx / aimDist; n._faceY = aimDy / aimDist;
                    if (n._chargeT >= 0.25) {   // 蓄力足够 → 放箭
                        n._chargeT = 0;
                        n.atkCd = w.fireInterval || 0.6;   // 弓/弩 fireInterval（与玩家 releaseBow 后的冷却一致）
                        fireNpcBullet(sv, n, threat, pick);
                        n._aimT = 0.22;
                    }
                    return true;   // 蓄力中：站定不动（同玩家"按住拉弓"）
                }
                // 非蓄力：直接开火
                n.atkCd = w.autoInterval || w.fireInterval || 0.4;
                // 开火前对准目标（站定射击，弹道稳定）
                const aimDx = threat.x - n.x, aimDy = threat.y - n.y;
                const aimDist = Math.hypot(aimDx, aimDy) || 1;
                n._faceX = aimDx / aimDist; n._faceY = aimDy / aimDist;
                fireNpcBullet(sv, n, threat, pick);
                n._aimT = 0.22;   // 开火后站定瞄准锁（不边走边打）
                return true;       // 射击帧不移动
            } else {
                n.atkCd = 3;   // 没弹药：短暂蓄势后近身搏斗
            }
        }
        // 站定瞄准期间：面向目标但不移动（弹道稳定、避免无效耗弹）
        if (n._aimT > 0) {
            const aimDx = threat.x - n.x, aimDy = threat.y - n.y;
            const aimDist = Math.hypot(aimDx, aimDy) || 1;
            n._faceX = aimDx / aimDist; n._faceY = aimDy / aimDist;
            return true;
        }
        if (rsNew === 1) retreatFrom(sv, n, threat, dt, canStand, 1);   // 被近身 → 后退
        else if (rsNew === 2) moveToward(sv, n, threat.x, threat.y, dt, canStand, 1);   // 过远 → 逼近保持射程
        else strafeAway(sv, n, threat, dt, canStand, 0.6);   // 射程内射击间隙 → 侧向机动
        return true;
    }
    // 近战（或远程武器没弹药/损坏）：攻击方式与玩家一致（按武器 attackStyle/弧宽/reach 判定）
    const wDef = w && w.kind === 'melee' ? w : null;
    const style = wDef ? (wDef.attackStyle || 'slash') : 'punch';
    const arc = wDef ? (wDef.arc || Math.PI) : Math.PI * 0.55;
    const tdx = threat.x - n.x, tdy = threat.y - n.y;
    const tdist = Math.hypot(tdx, tdy) || 1;
    const ang2 = Math.atan2(tdy, tdx);
    let canHit = false;
    // 2026-08-11 v2.97 攻击判定与武器特效对应（用户要求）：判定范围必须 ≤ 特效显示范围，
    // 杜绝"隔着空就被近战打死"。特效 drawSwingEffect 长度 = w.reach（不 +8）、扇形弧宽 = w.arc。
    // 因此：判定距离用 w.reach（不含 +8，避免判定比特效长）；扇形角度用 arc/2（与特效弧宽一致）。
    const hitReach = wDef ? (wDef.reach || 40) : 40;   // 判定 = 特效长度（去掉 +8 冗余）
    if (style === 'thrust') {
        // 长矛突刺：沿攻击方向线，垂距窄条内可刺中（与特效直线对应；垂距收紧到 16 匹配特效宽度）
        const along = tdx * Math.cos(ang2) + tdy * Math.sin(ang2);
        const perp = Math.abs(-tdx * Math.sin(ang2) + tdy * Math.cos(ang2));
        canHit = along >= 0 && along <= hitReach && perp < 16;
    } else {
        // 挥砍/直刺/重劈：扇形判定（弧宽 = w.arc，与特效扇形一致）
        canHit = tdist <= hitReach;
        // 目标必须在攻击方向的扇形内（弧宽 arc/2，与特效一致）——但攻击方向=朝目标，
        // 角度恒 0，天然在扇形内；真正防"隔空"靠距离约束 hitReach（= 特效长度）。
    }
    // 2026-08-10 只有墙阻挡近战：NPC 与目标之间隔墙则打不到（继续走位接近）
    if (canHit && n.atkCd <= 0 && !wallBetween(sv, n.x, n.y, threat.x, threat.y)) {
        // 2026-08-10 与玩家一致：近战挥击消耗体力（不足则歇口气等回复，不空挥）
        if (!npcSpendStamina(n, wDef ? (wDef.stamina || NPC_ATK_STAM_COST) : NPC_ATK_STAM_COST)) { n.atkCd = 0.4; return true; }
        // 面向攻击目标（让渲染层在挥击期间锁定朝向，不再被走位方向干扰）
        n._faceX = tdx / tdist; n._faceY = tdy / tdist;
        // 与玩家一致：冷却用武器 fireInterval，伤害用武器实际伤害
        n.atkCd = wDef ? (wDef.fireInterval || 0.35) : 0.5;
        if (threat.isZombie) {
            threat.z.hp -= wDef ? wDef.damage : 8;
            threat.z.hurt = 0.12;          // 僵尸受击闪白（与玩家命中一致）
            zombieHitSound(sv, threat.z);      // 受击音（铁桶/路障护甲音，与玩家一致）
        } else if (threat.player) {
            // 2026-08-09 开局昏迷苏醒：睁眼动画期间玩家无敌，恶意 NPC 近战打不伤
            if (sv._wake && sv._wake.t < sv._wake.dur) { /* 苏醒中免伤 */ }
            else if (sv._downed && controlledNpc(sv) && controlledNpc(sv).downed) {
                // 2026-08-11 v2.97 濒死主控被恶意 NPC 近战补刀 → 不再"免伤"，改为扣救援时间
                //（每 1 点伤害减 10 秒）。此前免伤让倒地主控永不被攻击、救援倒计时永不消耗。
                if (sv._downed._penaltySec == null) sv._downed._penaltySec = 0;
                const dmgNum = n.dmg || 8;
                sv._downed._penaltySec += dmgNum * B.DOWNED_HIT_PENALTY_SEC;
                sv.hurtT = 0.3;
                if (!sv._downed._hitLogT || (sv.now != null ? sv.now : 0) - sv._downed._hitLogT > 3) {
                    sv._downed._hitLogT = sv.now;
                    const spent = Math.max(0, (sv.now != null ? sv.now : 0) - (sv._downed.downedAtReal || 0)) + (sv._downed._penaltySec || 0);
                    const remainSec = Math.max(0, B.DOWNED_LIMIT_SECONDS - spent);
                    log(sv, `你被攻击！救援时间减少 ${Math.round(dmgNum * B.DOWNED_HIT_PENALTY_SEC)} 秒（剩余 ${Math.ceil(remainSec / 60)} 分钟）`, '#FF8866');
                }
            }
            else {
            // 恶意 NPC 命中玩家：正常受击伤害 + 感染风险 + 提示（无敌/无敌帧由上方豁免）
            // 下限 0（与僵尸咬一致）：恶意 NPC 可以真正击败玩家；原 Math.max(1,…) 导致"永远打不死"
            sv.hp = Math.max(0, sv.hp - n.dmg);
            sv.hurtT = 0.3;
            sv._combatT = 4;   // 进入交战状态，队友支援
            const c = controlledNpc(sv);
            if (c) { maybeWound(sv, c); addAct(sv, c, 'hit'); }
            addAct(sv, n, 'melee');
            if (sv._lastNpcHit !== n.id) { log(sv, `${n.name} 攻击了你！`, '#FF6644'); sv._lastNpcHit = n.id; }
            // 2026-08-11 v2.98 击杀明细：记录最后攻击者（名字 + 武器），死亡弹窗显示"被大壮用狙击枪击杀了"
            const _wpnKey = n.wpnKey || (n.wpn && n.wpn.key);
            const _wpnName = (_wpnKey && WEAPONS[_wpnKey] && WEAPONS[_wpnKey].name) || null;
            sv._lastHitBy = { name: n.name || '恶意分子', weapon: _wpnName, via: '近战' };
            }
        } else if (threat.npc) {
            // 恶意 NPC 打非恶意 NPC：真实扣血，可致死（含队员）；
            // 2026-08-11 v2.97 濒死角色被近战补刀：不再"免伤跳过"，改为扣救援时间（每点伤害减 10 秒）。
            // 此前直接免伤 → 倒地角色被恶意 NPC 补刀不掉血也不扣时间，卡"既救不活也不死"的悬空态。
            if (threat.npc.downed) { npcApplyDownedHit(sv, threat.npc, wDef ? wDef.damage : 8); }
            else threat.npc.hp -= wDef ? wDef.damage : 8;
        } else {
            threat.hp -= wDef ? wDef.damage : 8;
        }
        wearNpcWeapon(sv, n, wpnItem);   // 2026-08-10 磨损当前使用的武器（动态选择）
        if (threat.npc) {
            threat.npc.hurtT = 0.3;
            if (threat.npc.hp <= 0) {
                // 2026-08-11 v2.99 用户需求："被恶意 NPC 用战斧打死了"——近战击杀明细带武器名
                const _mw = n.wpnKey || (n.wpn && n.wpn.key);
                const _mwn = (_mw && WEAPONS[_mw] && WEAPONS[_mw].name) || null;
                killNpc(sv, threat.npc, _mwn ? `被${n.name}用${_mwn}击杀致死` : `被${n.name}击杀致死`);
            }
        }
        // 与玩家一致的近战视觉：挥击轨迹（按武器 attackStyle 差异化绘制）+ 命中点火花
        n.swingT = 0.22;
        n.swingDir = ang2;
        n.swingWeapon = n.wpnKey || 'fist';
        sv.effects.push({ kind: 'hit', x: threat.x, y: threat.y, life: 0.15, maxLife: 0.15 });
        // 2026-08-10 修复"NPC 近战无挥击音效"：与玩家挥击一致（按武器样式选音）
        AudioSystem.playWeaponSwing(n.wpnKey || 'fist');
        mpSfx(sv, 'swing', { w: n.wpnKey || 'fist' });
        // 2026-08-10 近战风筝：出刀后不站撸血拼——短暂后撤（kite）躲开僵尸咬人，
        // 冷却结束再回身逼近出刀（hit-and-run 同样适用于正常血量，生存率更高）
        n._kiteT = 0.26;
        return true;
    }
    // 已在攻击范围内（挥击/冷却期间）：不再站死挨打（用户反馈"血量高时和僵尸站撸"）——
    // 出刀后短暂站定（0.13s，防渲染抽搐），随后【绕圈移动】——即使目标仍在 reach 内，
    // 站定锁结束后也走位绕圈（攻击边缘微移），靠"冷却结束 + 距离判定"自然再次出刀。
    // 动画是连续绕圈而非站定挨打：僵尸攻击时 NPC 在绕圈位移，不会被原地持续咬。
    // 2026-08-09 防抽搐：出刀后不后退（渲染 swingDir 朝威胁 + 后退走位朝反方向会来回换向）。
    // 2026-08-10 近战风筝阶段：出刀后 _kiteT>0 期间走位机动（躲开僵尸咬人、不站撸血拼）：
    //  威胁贴脸（<34px）→ 直线后撤先拉开；一般距离 → 切线侧移（绕圈机动躲咬）。
    // 走位后把朝向强制锁回威胁方向：① 僵尸始终处于 95° 视野锥内（不因背对丢视野导致
    // 脱战/原地发呆）；② 与挥击朝向 swingDir 一致（渲染不来回换向、无抽搐）。
    // 冷却结束自然回身逼近再次出刀——走位灵动不死磕。
    n._kiteT = (n._kiteT || 0) - dt;
    if (n._kiteT > 0) {
        if (tdist < 34) retreatFrom(sv, n, threat, dt, canStand, 1.0);
        else strafeAway(sv, n, threat, dt, canStand, 1.0);
        const kdx = threat.x - n.x, kdy = threat.y - n.y;
        const kd = Math.hypot(kdx, kdy) || 1;
        n._faceX = kdx / kd; n._faceY = kdy / kd;
        return true;
    }
    n._standT = (n._standT || 0) - dt;
    if (n._standT > 0) {
        n._faceX = tdx / tdist; n._faceY = tdy / tdist;
        return true;   // 站定锁期间：站定面向目标
    }
    if (n.atkCd <= 0 && tdist <= hitReach) {
        // 冷却结束且目标在攻击距离内 → 继续站定出刀（自然进入下一次挥击）
        n._standT = 0.13;
        n._faceX = tdx / tdist; n._faceY = tdy / tdist;
        return true;
    }
    // 冷却中：绕圈走位（不站撸）——沿目标环绕缓慢旋转，动画是连续绕圈而非站定。
    // 围攻站位：每个 NPC 绕自己的 _jitter 偏转角 + 时间旋转（多队友围住目标均匀散开）。
    // 2026-08-10 绕圈点不再固定：ang 随时间旋转（转速 1.2 rad/s），NPC 持续绕目标微移，
    // 冷却结束自然回到出刀分支——真正"边打边绕"，不再站撸挨打。
    if (n._jitter == null) n._jitter = (Math.random() - 0.5) * 0.5;
    const ang = Math.atan2(n.y - threat.y, n.x - threat.x) + n._jitter + (sv.now || 0) * 1.2;
    moveToward(sv, n, threat.x + Math.cos(ang) * hitReach * 0.92, threat.y + Math.sin(ang) * hitReach * 0.92, dt, canStand, 1.05);
    return true;
}
// 躲避：远离威胁方向移动
function retreatFrom(sv, n, threat, dt, canStand, mul) {
    const dx = n.x - threat.x, dy = n.y - threat.y;
    const d = Math.hypot(dx, dy) || 1;
    moveToward(sv, n, n.x + dx / d * 50, n.y + dy / d * 50, dt, canStand, mul);
}
// 2026-08-10 武器损坏/没有可用武器时的"回防布阵"（用户要求）：
// 不空手硬拼（拳头伤害低、易被围困卡死），优先跑回玩家身边，在玩家周围防御列阵。
// 行为分级：
//  ① 离玩家较远 → 跑向玩家身边（行走不耗体力，力竭也能回防）；
//  ② 已在玩家身边 → 站在以玩家为中心的布防点，面向威胁方向警戒（列阵不追击）；
//  ③ 威胁贴身（1.2 格内）→ 才用拳头防御性反击（保护玩家与自己，不出圈追击）。
// 返回 true：NPC 处于"回防"状态（不执行跟随/游荡/扎堆送死）。
function brokenWeaponRegroup(sv, n, threat, d, dt, canStand) {
    const px = sv.px, py = sv.py;
    const guardR = 1.6 * TS;   // 布防圈半径（1.6 格）
    const pd = Math.hypot(px - n.x, py - n.y);
    if (pd > guardR * 1.4) {
        // 离玩家远：优先跑回玩家身边（不做无谓缠斗）
        moveToward(sv, n, px, py, dt, canStand, 1.15);
        return true;
    }
    // 威胁贴身（1.2 格内）：防御性出拳（守在自己/玩家跟前，不追击远处目标）
    if (d < 1.2 * TS) {
        if (n.atkCd <= 0 && !wallBetween(sv, n.x, n.y, threat.x, threat.y)) {
            const tdx = threat.x - n.x, tdy = threat.y - n.y;
            const tdist = Math.hypot(tdx, tdy) || 1;
            n._faceX = tdx / tdist; n._faceY = tdy / tdist;
            if (npcSpendStamina(n, NPC_ATK_STAM_COST)) {
                n.atkCd = 0.5;
                if (threat.isZombie) {
                    threat.z.hp -= 8;
                    threat.z.hurt = 0.12;
                    zombieHitSound(sv, threat.z);
                } else if (threat.npc) {
                    threat.npc.hp -= 8;
                    if (threat.npc.hp <= 0) {
                        // 2026-08-11 v2.99 近战击杀明细带武器名（与恶意 NPC 近战一致）
                        const _mw2 = n.wpnKey || (n.wpn && n.wpn.key);
                        const _mwn2 = (_mw2 && WEAPONS[_mw2] && WEAPONS[_mw2].name) || null;
                        killNpc(sv, threat.npc, _mwn2 ? `被${n.name}用${_mwn2}击杀致死` : `被${n.name}击杀致死`);
                    }
                } else {
                    threat.hp -= 8;
                }
                n.swingT = 0.22;
                n.swingDir = angFor(threat, n);
                n.swingWeapon = 'fist';
                sv.effects.push({ kind: 'hit', x: threat.x, y: threat.y, life: 0.15, maxLife: 0.15 });
                AudioSystem.playWeaponSwing('fist');
                mpSfx(sv, 'swing', { w: 'fist' });
            }
        }
        return true;   // 防御中：站定出拳（不被围堵时乱跑）
    }
    // 已到玩家身边：站布防点列阵，面向威胁方向警戒
    const idx = sv.npcs ? sv.npcs.indexOf(n) : -1;
    const cnt = sv.npcs ? sv.npcs.filter(m => m.alive && !m.downed).length : 1;
    const ang = idx >= 0 ? (idx / Math.max(1, cnt)) * Math.PI * 2 : 0;
    const fx = px + Math.cos(ang) * guardR, fy = py + Math.sin(ang) * guardR;
    const dd = Math.hypot(fx - n.x, fy - n.y);
    if (dd > 16) {
        moveToward(sv, n, fx, fy, dt, canStand, 1);
    } else {
        const tdx = threat.x - n.x, tdy = threat.y - n.y;
        const td = Math.hypot(tdx, tdy) || 1;
        n._faceX = tdx / td; n._faceY = tdy / td;
    }
    return true;
}
// 2026-08-10 走位机动：以威胁为圆心沿切线方向侧移（保持距离的同时不被轻易命中；
// 每 NPC 固定方向偏移，多 NPC 时分散站位）。返回 true 表示本次向侧向移动。
function strafeAway(sv, n, threat, dt, canStand, mul) {
    if (n._strafeDir == null) n._strafeDir = (Math.random() < 0.5 ? 1 : -1);
    const dx = threat.x - n.x, dy = threat.y - n.y;
    const d = Math.hypot(dx, dy) || 1;
    // 切线方向：(-dy, dx) 或 (dy, -dx)，乘以 _strafeDir 固定一侧
    const tx = -dy / d * n._strafeDir, ty = dx / d * n._strafeDir;
    moveToward(sv, n, n.x + tx * 55, n.y + ty * 55, dt, canStand, mul);
}
// 面向威胁的角度（命中点火花/挥击朝向）
function angFor(threat, n) {
    return Math.atan2(threat.y - n.y, threat.x - n.x);
}
// ---------- NPC 武器资源：耐久（挥击/射击 -1，损坏后只能用拳头）与弹药（背包消耗） ----------
function npcWpnItem(n) {
    return (n.inv || []).find(s => s && String(s.id).startsWith('wpn:'));
}

// 2026-08-10 战斗武器选择：按距离从背包动态选"当前最合适武器"（用户要求：
// 近距用近战、远距用远程、远程没弹药自动切近战）。结果缓存 0.3s 防抖动。
// 返回 { item, w, key }；没武器返回 null（肉搏）。
export function npcPickWeapon(n, dist, now) {
    if (n._wpick && n._wpickT && now != null && now < n._wpickT) return n._wpick;
    const items = (n.inv || []).filter(s => s && String(s.id).startsWith('wpn:') && !s.broken);
    let best = null;
    for (const item of items) {
        const key = String(item.id).slice(4);
        const w = WEAPONS[key];
        if (!w) continue;
        // 近战武器：可直接用
        if (w.kind === 'melee') {
            const r = w.reach || 40;
            // 距离在近战范围 → 首选；即使远也保留为"远程没弹药时的后备"
            const score = dist <= r + 8 ? 1000 + r : (w.damage || 0) + r * 0.2;
            if (!best || score > best.score) best = { item, w, key, score };
        } else if (w.kind === 'ranged') {
            // 远程武器：有对应弹药才可选；距离在其有效射程内优先
            const ammo = npcAmmoCount(n, w.ammoType);
            if (ammo <= 0) continue;   // 没弹药：直接跳过（自动切近战）
            const r = w.range || 300;
            const score = dist >= 60 && dist <= r ? 900 + r : (r - Math.abs(dist - r) * 0.1);
            if (!best || score > best.score) best = { item, w, key, score };
        }
    }
    n._wpick = best;
    // 2026-08-10 修复：now（sv.now）单位是秒，原 now+300 实际缓存 300 秒 → 武器选择严重滞后
    //（远处选了远程、靠近后仍用远程导致"拿短剑却像远程攻击"）。应为 0.3s 防抖动。
    if (now != null) n._wpickT = now + 0.3;
    return best;
}
function npcWpnBroken(n) {
    const s = npcWpnItem(n);
    return !!(s && s.broken);
}
function wearNpcWeapon(sv, n, item) {
    const s = item || npcWpnItem(n);   // 2026-08-10 支持指定武器（动态武器选择后磨损当前使用的）
    if (!s) return;
    const max = B.WEAPON_DUR[s.id.slice(4)] || 0;
    if (!max) return;
    s.dur = Math.max(0, (s.dur == null ? max : s.dur) - 1);
    // 损坏只提示一次，且只提示队员（中立/陌生 NPC 与我们无关）
    if (s.dur <= 0 && !s.broken) {
        s.broken = true;
        if (n.party) log(sv, `${n.name} 的${Panel.getItemInfo(s.id).name}损坏了！（只能肉搏了）`, '#FFB347');
    }
}
function npcAmmoCount(n, type) {
    let c = 0;
    for (const s of n.inv || []) if (s && s.id === 'ammo:' + type) c += s.n;
    return c;
}
// 2026-08-10 与玩家一致：NPC 攻击消耗体力（不足/力竭返回 false，攻击暂缓等回体）
export function npcSpendStamina(n, cost) {
    if (n.stamina == null) n.stamina = n.maxStamina || 100;
    if (n.maxStamina == null) n.maxStamina = 100;
    if (n.exhausted || (n.stamina || 0) < (cost || 0)) { if (!n.exhausted) n.exhausted = true; return false; }
    n.stamina = Math.max(0, n.stamina - (cost || 0));
    n._stamDelay = NPC_STAM_DELAY;
    return true;
}
function npcTakeAmmo(n, type, need) {
    for (const s of n.inv || []) {
        if (need <= 0) break;
        if (s && s.id === 'ammo:' + type) { const t = Math.min(s.n, need); s.n -= t; need -= t; }
    }
    for (let i = (n.inv || []).length - 1; i >= 0; i--) if (n.inv[i] && n.inv[i].id === 'ammo:' + type && n.inv[i].n <= 0) n.inv.splice(i, 1);
}
// NPC 远程射击：与玩家完全一致（弹丸分布/伤害/射程/穿透），消耗弹药与耐久；
// 恶意 NPC 的子弹标记 hostile，可命中玩家
// NPC 联机音效广播（与 wgear.mpSfx 同款：host/guest 都发 outbox，对端经 playRemoteSfx 播放）
function mpSfx(sv, snd, extra) {
    if (sv && sv.mp && (sv.mp.role === 'host' || sv.mp.role === 'guest')) {
        (sv.mpOutbox = sv.mpOutbox || []).push(Object.assign({ type: 'sfx', snd }, extra || null));
    }
}

function fireNpcBullet(sv, n, threat, pick) {
    // 2026-08-10 动态武器：优先用传入的 pick（背包里选中的远程武器），否则回退 n.wpnKey
    const key = (pick && pick.key) || n.wpnKey;
    const item = (pick && pick.item) || null;
    const w = WEAPONS[key];
    if (!w) return;
    // 2026-08-10 修复"室内 NPC 射击无声"：与玩家射击完全一致——枪声/弓声 + 联机广播
    const iv = w.autoInterval || w.fireInterval || 0.4;
    if (key === 'bow') AudioSystem.playBowFire();
    else AudioSystem.playWeaponShot(key, iv);
    mpSfx(sv, 'shot', { w: key, iv, bow: key === 'bow' });
    // NPC 同样以"手部高度"为原点（n.y 是脚底，角色高 48，手部约 26）
    // 2026-08-11 v2.97 索敌精度优化：瞄准用目标**实时坐标**（threat.z/threat.npc 本体），
    // 替代 0.12s 缓存快照 threat.x/y——玩家靠近吸引仇恨后僵尸/恶意 NPC 持续移动，
    // 若用旧快照瞄准会持续描边打空气（用户反馈"索敌准但命中差"）。
    const shootY = n.y - 26;
    const aimTx = threat.z ? threat.z.x : (threat.npc ? threat.npc.x : threat.x);
    const aimTy = threat.z ? threat.z.y : (threat.npc ? threat.npc.y : threat.y);
    const ang = Math.atan2(aimTy - shootY, aimTx - n.x);
    if (!sv.npcBullets) sv.npcBullets = [];
    // 与玩家 tryFire 相同的弹丸分布：pellets 多弹丸 + spread 散射
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
        const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5);
        const a = ang + t * (w.spread || 0);
        sv.npcBullets.push({
            x: n.x, y: shootY,
            vx: Math.cos(a) * (w.bulletSpeed || 460), vy: Math.sin(a) * (w.bulletSpeed || 460),
            dmg: Math.max(4, w.damage),   // 与玩家同伤害
            color: w.color, label: w.bulletLabel || '·', life: 0.9, traveled: 0,
            range: w.range || 9999, pierce: w.pierce || 0, pierced: 0, hitList: null,
            hostile: n.role === 'hostile', src: n.id, srcName: n.name,
            srcWpn: key,   // 2026-08-11 v2.98 击杀明细：子弹携带武器键，命中玩家时记录武器名（"用狙击枪击杀了"）
        });
    }
    npcTakeAmmo(n, w.ammoType, 1);
    wearNpcWeapon(sv, n, item);
    sv.effects.push({ kind: 'muzzle', x: n.x + Math.cos(ang) * 20, y: shootY + Math.sin(ang) * 20, angle: ang, color: w.color, label: '轰', ghosts: pellets > 1 ? 2 : 1, life: 0.1, maxLife: 0.1 });
}
// 更新 NPC 子弹（与玩家同规则：射程衰减 + 穿透；命中僵尸/恶意 NPC，恶意火力可打玩家）
// 2026-08-10 导出：室内模式 updateInteriorMode 同样需要驱动 NPC 子弹（否则室内子弹不动/不消失）
export function updateNpcBullets(sv, dt) {
    if (!sv.npcBullets || !sv.npcBullets.length) return;
    for (let i = sv.npcBullets.length - 1; i >= 0; i--) {
        const b = sv.npcBullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.traveled += Math.hypot(b.vx, b.vy) * dt;
        b.life -= dt;
        let dead = b.life <= 0;
        // 2026-08-10 墙阻挡子弹（用户需求"子弹不能穿透建筑"）：
        // 室内只有墙（IT.WALL=1）阻挡（容器/碎石/绿植可穿透）；
        // 室外建筑/墙体（T.WALL）同样阻挡子弹——子弹经过墙格即消散。
        if (!dead && sv.interior) {
            const it = sv.interior;
            const gx = Math.floor(b.x / TS), gy = Math.floor(b.y / TS);
            if (gx >= 0 && gx < it.w && gy >= 0 && gy < it.h && it.tiles[gy * it.w + gx] === 1) dead = true;   // IT.WALL = 1
        } else if (!dead) {
            const gx = Math.floor(b.x / TS), gy = Math.floor(b.y / TS);
            if (getTile(sv, gx, gy) === T.WALL) dead = true;   // 室外建筑墙阻挡
        }
        if (!dead) {
            // 2026-08-11 v2.97 修复"善意 NPC 打移动目标描边打空气"：
            // NPC 子弹命中半径 14 < 玩家子弹 18——玩家靠近吸引敌对仇恨后，僵尸/恶意 NPC 移动
            // 方向改变（朝玩家走），14px 命中框跟不上移动目标 → 子弹描边。提到 18 与玩家一致。
            let hit = null, best = 18;
            for (const z of sv.zombies) {
                if (z.hp <= 0) continue;
                if (b.hitList && b.hitList.some(h => h === z)) continue;
                const d = Math.hypot(z.x - b.x, z.y - b.y);
                if (d < best) { best = d; hit = { npc: null, z, x: z.x, y: z.y }; }
            }
            if (!hit && sv.npcs) for (const o of sv.npcs) {
                if (!o.alive) continue;
                // 2026-08-11 修复"远程武器/恶意NPC/僵尸子弹打不到玩家（玩家无敌）"：
                // 玩家自己的名册记录（id='player' 或当前主控队友）也在 sv.npcs 里，且坐标与
                // sv.px/py 每帧同步（syncControlledToRecord）→ 敌对子弹扫描 npcs 时必然先命中
                // 这条记录，走 hit.npc 分支只扣记录血、不扣 sv.hp → 玩家血条不动（看起来无敌）。
                // 与近战索敌（hostileThreat 的 `o.id === sv.controllerId` 排除）一致：主控记录
                // 不参与 npcs 命中判定，让子弹走下方 hit.player 分支用 sv.px/py 判定并扣 sv.hp。
                if (sv.controllerId && o.id === sv.controllerId) continue;   // 主控走玩家受伤路径
                // 2026-08-10 修复"邀请的队友对敌对 NPC 子弹无敌"：此前只匹配 role==='hostile'，
                // 导致友好/入队队友被敌对子弹完全忽略（无敌）。现在区分弹丸来源：
                //  hostile 子弹 → 可命中所有 NPC（含 friendly/party 友方 + 敌对）；否则（我方火力）只打敌对。
                if (b.hostile) {
                    if (o.role === 'friendly' || o.role === 'neutral') { /* 友方可被敌对子弹命中 */ }
                    else if (o.role === 'hostile') { /* 敌对可互伤 */ }
                    else continue;
                } else {
                    if (o.role !== 'hostile') continue;   // 我方火力只打敌对
                }
                // 2026-08-10 修复"恶意 NPC 远程子弹打自己"：子弹从发射者手部（n.y-26）生成，
                // 贴脸射击时弹道经过自己身体；发射者自己也是 hostile，若不排除 o.id === b.src，
                // 子弹会命中自己（自己掉血/受击/被打死）。已命中的（hitList）同样跳过。
                if (o.id === b.src) continue;
                if (b.hitList && b.hitList.some(h => h === o)) continue;
                const d = Math.hypot(o.x - b.x, o.y - b.y);
                if (d < best) { best = d; hit = { npc: o, z: null, x: o.x, y: o.y }; }
            }
            // 恶意 NPC 火力命中玩家（无敌/无敌帧豁免）
            if (!hit && b.hostile) {
                const pd = Math.hypot(sv.px - b.x, sv.py - b.y);
                // 2026-08-09 开局昏迷苏醒：睁眼动画期间玩家无敌（恶意弹丸打不中）
                if (pd < 12 && !sv._devGod && sv.invuln <= 0 && !(sv._wake && sv._wake.t < sv._wake.dur)) hit = { player: 1, x: sv.px, y: sv.py };
            }
            if (hit) {
                // 射程衰减：有效射程内满伤，超出后线性衰减至保底 40%（与玩家一致）
                const fo = b.traveled <= b.range ? 1 : Math.max(0.4, 1 - 0.6 * ((b.traveled - b.range) / b.range));
                const dmg = Math.max(1, Math.round(b.dmg * fo));
                if (hit.player) {
                    // 下限 0（与近战一致）：恶意 NPC 弹丸可真正击败玩家；原 Math.max(1,…) 打不死
                    sv.hp = Math.max(0, sv.hp - dmg);
                    sv.hurtT = 0.25;
                    sv._combatT = 4;
                    const c = controlledNpc(sv);
                    if (c) { maybeWound(sv, c); addAct(sv, c, 'hit'); }
                    if (sv._lastNpcHit !== (b.src || '?')) { log(sv, `${b.srcName || '恶意分子'} 向你射击！`, '#FF6644'); sv._lastNpcHit = b.src || '?'; }
                    // 2026-08-11 v2.98 击杀明细：记录最后攻击者（名字 + 武器），死亡弹窗显示"被大壮用狙击枪击杀了"
                    const _bw = (b.srcWpn && WEAPONS[b.srcWpn] && WEAPONS[b.srcWpn].name) || null;
                    sv._lastHitBy = { name: b.srcName || '恶意分子', weapon: _bw, via: '远程' };
                    dead = true;
                } else if (hit.npc) {
                    // 2026-08-10 用户要求"在车上被敌对生物攻击，优先掉汽车耐久"：
                    // 命中的 NPC 若正在乘车（riding）且玩家在驾驶，子弹打在车壳上——汽车掉耐久、
                    // 车内成员不受伤害（车壳吃满伤，"铛"特效）。车耐久归零由 driveCommon 检测爆炸。
                    if (hit.npc.riding && sv.driving && sv.driving.hp > 0) {
                        sv.driving.hp = Math.max(0, sv.driving.hp - dmg);
                        sv.effects.push({ kind: 'hit', x: hit.npc.x, y: hit.npc.y, life: 0.2, maxLife: 0.2, label: '铛' });
                    } else if (hit.npc.downed) {
                        // 2026-08-11 v2.97 倒地角色被子弹命中 → 扣救援时间（每点伤害 10 秒），
                        // 不直接扣血（防倒地主控记录血被扣成负数 -505/100 的 bug）
                        npcApplyDownedHit(sv, hit.npc, dmg);
                    } else {
                        hit.npc.hp -= dmg;
                        hit.npc.hurtT = 0.15;
                        // 2026-08-11 v2.98 修复 n 未定义（updateNpcBullets 无攻击者 n）：
                        // 用子弹对象自带的 srcName/srcWpn 记录击杀者（"被XXX击杀致死"/"被XXX用YYY击杀致死"）。
                        if (hit.npc.hp <= 0) {
                            const _bw = (b.srcWpn && WEAPONS[b.srcWpn] && WEAPONS[b.srcWpn].name) || null;
                            killNpc(sv, hit.npc, _bw ? `被${b.srcName || '恶意分子'}用${_bw}击杀致死` : `被${b.srcName || '恶意分子'}击杀致死`);
                        }
                    }
                }
                else {
                    hit.z.hp -= dmg;
                    // 2026-08-10 修复"NPC 子弹命中僵尸无声"：与玩家命中一致的受击音 + 联机广播
                    zombieHitSound(sv, hit.z);
                    hit.z.hurt = 0.12;
                }
                sv.effects.push({ kind: 'hit', x: b.x, y: b.y, life: 0.15, maxLife: 0.15 });
                // 穿透：未达穿透上限则继续飞行（与玩家一致）
                if (!hit.player && b.pierced < b.pierce) {
                    b.pierced++;
                    (b.hitList = b.hitList || []).push(hit.npc || hit.z);
                } else {
                    dead = true;
                }
            }
        }
        if (dead) sv.npcBullets.splice(i, 1);
    }
}

// 威胁探测（UI 中断用：附近 4 格内有僵尸或恶意 NPC）
export function threatNear(sv, n, tiles) {
    const r = tiles * TS;
    for (const z of sv.zombies) if (z.hp > 0 && Math.hypot(z.x - n.x, z.y - n.y) < r) return true;
    if (sv.npcs) for (const o of sv.npcs) if (o.alive && o.role === 'hostile' && Math.hypot(o.x - n.x, o.y - n.y) < r) return true;
    return false;
}

// ---------- 营地 / 游荡：找活干，产出存入营地箱，写工作日志；有威胁优先战斗/躲避 ----------
function campOrWanderAI(sv, n, dt, canStand, camp) {
    if (combatThreat(sv, n, dt, canStand, 5, 0)) return;   // 自主防御
    if (camp && n.state === 'camp') {
        campTask(sv, n, dt, canStand, camp);
        return;
    }
    // 无营地或未入队：游荡（饿了去搜刮）
    wanderMove(sv, n, dt, canStand);
}

function wanderMove(sv, n, dt, canStand) {
    n.idleT = (n.idleT || 0) - dt;
    if (n.idleT <= 0) {
        n.idleT = 2 + Math.random() * 3;
        n.wanderDir = Math.random() * Math.PI * 2;
    }
    // 2026-08-11 v2.99 性能（掉帧排查）：游荡是"随意闲逛"，目标只有 ~1.7 格远——
    // 此前 moveToward(dist>1.2格) 对每个游荡 NPC 触发单点 A*（60 NPC × 每 0.4s 缓存过期
    // 集体重算 = 周期性大尖峰，营地聚集/大量 NPC 时卡顿）。游荡改走"本格内小步直线"：
    // 目标 = 当前位置 + 半格方向（dist≈0.5格 < 1.2 寻路阈值 → 直线移动，不触发 A*），
    // 撞到障碍由 moveToward 的随机偏转兜底换向。距离远的目标（如跟随/战斗）不受影响。
    const wd = n.wanderDir || 0;
    moveToward(sv, n, n.x + Math.cos(wd) * TS * 0.5, n.y + Math.sin(wd) * TS * 0.5, dt, canStand, 0.5);
}

function nearestHostile(sv, n, range) {
    for (const o of sv.npcs) {
        if (!o.alive || o.role !== 'hostile') continue;
        if (Math.hypot(o.x - n.x, o.y - n.y) < range * TS) return o;
    }
    return null;
}

// 营地任务：伐木 / 采集 / 守卫 / 休息，产物入营地箱
function campTask(sv, n, dt, canStand, camp) {
    if (n.campTask == null || n.campTask.done) {
        const r = Math.random();
        n.campTask = { type: r < 0.4 ? 'wood' : (r < 0.6 ? 'forage' : (r < 0.8 ? 'guard' : 'rest')), done: false, work: 3, target: null };
    }
    const t = n.campTask;
    if (t.type === 'wood') {
        if (!t.target) {
            const tree = nearestTileOf(sv, n, T.TREE, 12);
            if (!tree) { t.done = true; return; }
            t.target = tree;
        }
        const gx = Math.floor(n.x / TS), gy = Math.floor(n.y / TS);
        if (Math.abs(gx - t.target.x) + Math.abs(gy - t.target.y) > 1.5) moveToward(sv, n, (t.target.x + 0.5) * TS, (t.target.y + 0.5) * TS, dt, canStand);
        else {
            t.work -= dt;
            if (t.work <= 0) {
                depositCamp(sv, n, 'wood', 1 + Math.floor(Math.random() * 2));
                t.done = true;
            }
        }
    } else if (t.type === 'forage') {
        if (!t.target) {
            const herb = nearestTileOf(sv, n, T.HERB, 10) || nearestTileOf(sv, n, T.FLOWER, 10);
            if (!herb) { t.done = true; return; }
            t.target = herb;
        }
        const gx = Math.floor(n.x / TS), gy = Math.floor(n.y / TS);
        if (Math.abs(gx - t.target.x) + Math.abs(gy - t.target.y) > 1.5) moveToward(sv, n, (t.target.x + 0.5) * TS, (t.target.y + 0.5) * TS, dt, canStand);
        else {
            t.work -= dt;
            if (t.work <= 0) {
                depositCamp(sv, n, getTile(sv, t.target.x, t.target.y) === T.FLOWER ? 'sun' : 'herb', 1);
                t.done = true;
            }
        }
    } else if (t.type === 'guard') {
        const host = nearestHostile(sv, n, 8);
        if (host) {
            const d = Math.hypot(host.x - n.x, host.y - n.y);
            if (d > 42) moveToward(sv, n, host.x, host.y, dt, canStand, 1);
            else if (n.atkCd <= 0) {
                if (!npcSpendStamina(n, NPC_ATK_STAM_COST)) { n.atkCd = 0.4; }   // 力竭歇口气等回体
                else {
                n.atkCd = 1.2;
                host.hp -= n.dmg;
                host.hurtT = 0.3;
                wearNpcWeapon(sv, n);
                if (host.hp <= 0) {
                    // 2026-08-11 v2.99 守卫击杀明细带武器名（与恶意 NPC 近战一致）
                    const _mw3 = n.wpnKey || (n.wpn && n.wpn.key);
                    const _mwn3 = (_mw3 && WEAPONS[_mw3] && WEAPONS[_mw3].name) || null;
                    killNpc(sv, host, _mwn3 ? `被${n.name}用${_mwn3}击杀致死` : `被${n.name}击杀致死`);
                }
                }
            }
        } else {
            // 巡逻
            n.idleT = (n.idleT || 0) - dt;
            if (n.idleT <= 0) { n.idleT = 3; n.wanderDir = Math.random() * Math.PI * 2; }
            moveToward(sv, n, camp.x + Math.cos(n.wanderDir) * CAMP_R * TS * 0.5, camp.y + Math.sin(n.wanderDir) * CAMP_R * TS * 0.5, dt, canStand, 0.6);
        }
    } else {
        // 休息：缓慢回血
        n.hp = Math.min(n.maxHp, n.hp + 0.5 * dt);
        n.idleT = (n.idleT || 0) - dt;
        if (n.idleT <= 0) { n.idleT = 4; n.wanderDir = Math.random() * Math.PI * 2; }
        moveToward(sv, n, camp.x + Math.cos(n.wanderDir) * CAMP_R * TS * 0.4, camp.y + Math.sin(n.wanderDir) * CAMP_R * TS * 0.4, dt, canStand, 0.4);
    }
    if (t.done) n.campTask = null;
}

function nearestTileOf(sv, n, type, range) {
    const cx = Math.floor(n.x / TS), cy = Math.floor(n.y / TS);
    for (let r = 1; r <= range; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (getTile(sv, cx + dx, cy + dy) === type) return { x: cx + dx, y: cy + dy };
        }
    }
    return null;
}

// 营地物资箱（NPC 产出与玩家共用）
export function campChest(sv) {
    if (!sv.mods.chests) sv.mods.chests = {};
    if (!sv.mods.chests['camp']) sv.mods.chests['camp'] = Array(Panel.CHEST_SIZE).fill(null);
    return sv.mods.chests['camp'];
}
function depositCamp(sv, n, id, count) {
    const chest = campChest(sv);
    const same = chest.find(s => s && s.id === id);
    if (same) same.n += count;
    else {
        const empty = chest.findIndex(s => !s);
        if (empty >= 0) chest[empty] = { id, n: count };
    }
    n.workLog.unshift({ day: sv.day, text: `${n.name}完成了${itemName(id)} ×${count}` });
    if (n.workLog.length > 6) n.workLog.pop();
}
function itemName(id) {
    const info = Panel.getItemInfo(id);
    return info ? info.name : id;
}

// 按年龄阶段+属性+先天病重算人物血量/伤害（ageNpcs 与开发者"老化"共用）
export function applyPersonStats(n) {
    const age = n.age ?? 0;
    const stage = B.ageStage(age);
    const mods = personMods(n);
    const a = n.attrs || { str: 10, con: 10, agi: 10, int: 10 };
    const base = n.isPlayer ? 100 : (n.role === 'hostile' ? 90 : 80);
    const wantMaxHp = Math.max(25, Math.round((base + (a.con - 10) * 2) * stage.hpMul * mods.maxHpMul));
    // 2026-08-09 用户要求"敌对 NPC 按武器造成不同伤害"：伤害取 NPC 装备武器的实际伤害
    // （拳头 16 / 短剑 24 / 长剑 62 / 战斧 95 等），× 年龄阶段/属性倍率；
    // 原固定 14/10 抹平了武器差异 → 所有敌对 NPC 伤害相同。
    const wpnItem2 = npcWpnItem(n);
    const wpnDmg = (n.wpnKey && WEAPONS[n.wpnKey] && WEAPONS[n.wpnKey].damage) ||
        (wpnItem2 && WEAPONS[String(wpnItem2.id).slice(4)] ? WEAPONS[String(wpnItem2.id).slice(4)].damage : 16);
    const wantDmg = n.isPlayer ? n.dmg : Math.max(4, Math.round(wpnDmg * stage.atkMul * mods.atkMul));
    if (wantMaxHp !== n.maxHp) {
        const diff = wantMaxHp - n.maxHp;
        n.maxHp = wantMaxHp;
        n.hp = Math.max(1, Math.min(n.maxHp, n.hp + (diff > 0 ? diff * 0.5 : diff * 0.3)));
    }
    if (!n.isPlayer && wantDmg !== n.dmg) n.dmg = wantDmg;
}

// ---------- 生老病死（每天一次；主角与 NPC 一视同仁） ----------
export function ageNpcs(sv) {
    if (!sv.npcs) return;
    // 2026-08-09 野外随机 NPC 刷新（概率极低）：无营地庇护的荒野每日小概率刷 1 名
    // 友善/中立/恶意 NPC。刷在玩家 12~30 格外（不堵脸），受世界 NPC 软上限约束。
    // 野外 NPC 无物资补给、易被僵尸/恶意猎杀 → 存活率低（符合用户设定）。
    // 用户要求"出生点和营地都不刷新 NPC"：① 出生点(SPAWN)附近不刷；② 营地不再有
    // "每日来新居民"刷新（营地新生由下方"生育"保留——营地包括生育出来的 NPC）。
    if (sv.npcs.filter(m => m.alive).length < NPC_CAP) {
        if (Math.random() < B.WILD_NPC_DAILY_CHANCE) {
            const ang = Math.random() * Math.PI * 2;
            const dist = (B.WILD_NPC_MIN + Math.random() * (B.WILD_NPC_RADIUS - B.WILD_NPC_MIN)) * TS;
            const tx = sv.px + Math.cos(ang) * dist, ty = sv.py + Math.sin(ang) * dist;
            // 2026-08-09 出生点屏幕内不刷 NPC（含友方/敌对）：主角初始地不凭空冒人
            if (B.nearSpawnScreen(SPAWN, tx, ty)) return;
            const p = findWalkableNear(sv, tx, ty, 12);
            // 权重随机角色
            let roll = Math.random(), role = 'friendly';
            const w = B.WILD_NPC_ROLE_WEIGHT;
            if (roll >= w.friendly) { roll -= w.friendly; role = roll < w.neutral ? 'neutral' : 'hostile'; }
            const wanderer = makeNpc(sv, p.x, p.y, role);
            wanderer.bornDay = sv.day - (18 + Math.floor(Math.random() * 20));   // 成年流浪者
            wanderer.state = 'wander';
            sv.npcs.push(wanderer);
        }
    }
    for (const n of sv.npcs) {
        if (!n.alive) continue;
        const age = sv.day - n.bornDay;
        n.age = age;
        const stage = B.ageStage(age);
        // 生：营地友善成员 ≥2 时，每日小概率添丁（新生命在营地出生，从幼年开始成长）；
        // 世界 NPC 达到软上限后停止自然繁衍（性能与生态平衡）
        if (!n.isPlayer && n.state === 'camp' && sv.npcs.filter(m => m.alive).length < NPC_CAP) {
            const adults = sv.npcs.filter(m => m.alive && m.role !== 'hostile' && (m.state === 'camp' || m.party)).length;
            if (adults >= B.BIRTH_CAMP_MIN && Math.random() < B.BIRTH_DAILY_CHANCE) {
                const camp = sv.camp || { x: (SPAWN.x + 0.5) * TS, y: (SPAWN.y + 0.5) * TS };
                const baby = makeNpc(sv, camp.x + (Math.random() - 0.5) * 2 * TS, camp.y + (Math.random() - 0.5) * 2 * TS, 'friendly');
                baby.bornDay = sv.day;
                baby.state = 'camp';
                baby.campId = camp.id || null;   // 阵营归属：生在本营地
                baby.inv = [];
                baby.wpnKey = null; baby.wpnName = null;
                baby.maxHp = Math.round(80 * stage.hpMul);
                baby.hp = baby.maxHp;
                sv.npcs.push(baby);
                log(sv, `营地迎来了新生命：${baby.name} 出生了！`, '#FFD700');
            }
        }
        // 老：属性随年龄阶段变化（成长→巅峰→衰退），体质/先天病影响上限
        applyPersonStats(n);
        const mods = personMods(n);
        const a = n.attrs || { str: 10, con: 10, agi: 10, int: 10 };
        // 病：每日患病判定（体质/天赋/先天病修正；触发条件贴近现实：夜间户外/受寒、暴晒缺水、挨饿、不洁饮水）
        if (!n.sick) {
            const sm = mods.sickMul;
            const night = B.isNightHour(sv);
            const hour = (sv.t / sv.dayLen) * 24;
            if (n.water <= 0 && Math.random() < B.SICK_DYSENTERY_CHANCE * sm) n.sick = { type: 'dysentery', day: sv.day };
            else if (n.food <= 0 && !(n.talent === 'ironstomach') && Math.random() < B.SICK_POISON_CHANCE * sm) n.sick = { type: 'poison', day: sv.day };
            else if ((night || n.water < 30) && Math.random() < B.SICK_COLD_CHANCE * sm) n.sick = { type: 'cold', day: sv.day };
            else if (hour >= 10 && hour < 16 && n.water < 40 && Math.random() < B.SICK_HEAT_CHANCE * sm) n.sick = { type: 'heatstroke', day: sv.day };
        }
        // 后天培养：活动转化为属性成长（上限 18）
        if (n.act) {
            if (n.act.melee >= 60) { a.str = Math.min(18, a.str + 1); n.act.melee = 0; }
            if (n.act.hit >= 40) { a.con = Math.min(18, a.con + 1); n.act.hit = 0; }
            if (n.act.run >= 300) { a.agi = Math.min(18, a.agi + 1); n.act.run = 0; }
            if (age < 40 && Math.random() < 0.25) a.int = Math.min(18, a.int + 1);
        }
        // 老年衰退：60 岁后属性缓慢下降（不低于 3）
        if (age > 60 && Math.random() < 0.12) {
            const k = B.ATTRIB_KEYS[Math.floor(Math.random() * B.ATTRIB_KEYS.length)];
            a[k] = Math.max(3, a[k] - 1);
        }
        // 死：自然死亡概率随年龄（60 岁起；主角亦有寿限，有队友则切换视角）
        if (Math.random() < B.ageDeathChance(age)) {
            killNpc(sv, n, '自然老死');
            continue;
        }
        // 商人日常：金币缓慢补充（上限）
        n.coins = Math.min(300, (n.coins || 0) + 15);
    }
    // 主控属性同步（年龄阶段影响 sv.maxHp）
    const c = controlledNpc(sv);
    if (c) {
        sv.maxHp = c.maxHp;
        if (sv.hp > sv.maxHp) sv.hp = sv.maxHp;
    }
}

// 受击感染：非恶意角色/玩家受击时小概率伤口感染（体质与天赋影响抗性）
export function maybeWound(sv, n) {
    if (!n.alive || n.role === 'hostile' || n.sick) return;
    const m = personMods(n);
    if (Math.random() < B.SICK_WOUND_CHANCE * m.sickMul) n.sick = { type: 'wound', day: sv.day };
}

// 2026-08-10 与玩家一致：NPC 被僵尸咬累积感染值（概率/单次量与玩家相同）。
// 主控（isPlayer）由玩家感染系统处理（resolvePlayerBiteTick），此处跳过。
export function maybeInfectNpc(sv, n) {
    if (!n.alive || n.role === 'hostile' || n.isPlayer) return;
    if (n.infection == null) n.infection = 0;
    if (n.infection >= PLAYER_INFECTION.max) return;
    const infGain = rollZombieInfection();
    if (infGain > 0) n.infection = addPlayerInfection(n.infection, infGain);
}

// 人物属性效果汇总（力量/体质/敏捷/智力 + 天赋 + 先天病）
function personMods(n) {
    const a = n.attrs || { str: 10, con: 10, agi: 10, int: 10 };
    const cg = n.congenital ? B.CONGENITAL[n.congenital] : null;
    const tl = n.talent ? B.TALENTS[n.talent] : null;
    return {
        speedMul: (1 + (a.agi - 10) * 0.01) * (cg ? (cg.speedMul || 1) : 1),
        maxHpMul: cg ? (cg.maxHpMul || 1) : 1,
        hungerMul: cg ? (cg.hungerMul || 1) : 1,
        stamMul: cg ? (cg.stamMul || 1) : 1,
        stamMaxMul: cg ? (cg.stamMaxMul || 1) : 1,
        sickMul: (cg ? (cg.sickMul || 1) : 1) * (tl && tl.resist ? 0.5 : 1) * Math.max(0.3, 1 + (a.con - 10) * 0.05),
        atkMul: 1 + (a.str - 10) * 0.02,
        rngMul: tl && tl.ranged ? 1.1 : 1,
    };
}

// 治疗：优先对症药品（1 瓶）/抗生素（1 瓶），草药兜底按疾病 cure 数量消耗（痢疾需有水）
function cureSick(sv, n, inv, water) {
    if (!n.sick || !inv) return false;
    const med = B.SICK_MED[n.sick.type];
    let i = med ? inv.findIndex(s => s && s.id === med) : -1;
    if (i < 0) i = inv.findIndex(s => s && s.id === 'med:pan');
    if (i >= 0) {
        consumeItem(inv, i);
        log(sv, `${n.isPlayer ? '你' : n.name} 服用了药品，${B.SICKNESS[n.sick.type].name}痊愈了`, '#7DFF7D');
        n.sick = null;
        return true;
    }
    const need = B.SICKNESS[n.sick.type].cure || 1;
    if (n.sick.type !== 'dysentery' || water > 30) {
        let have = 0;
        for (const s of inv) if (s && s.id === 'herb') have += s.n;
        if (have >= need) {
            let left = need;
            for (let k = 0; k < inv.length && left > 0; k++) {
                if (inv[k] && inv[k].id === 'herb') {
                    const t = Math.min(inv[k].n, left);
                    inv[k].n -= t; left -= t;
                    if (inv[k].n <= 0) { inv.splice(k, 1); k--; }
                }
            }
            log(sv, `${n.isPlayer ? '你' : n.name} 服用了草药×${need}，${B.SICKNESS[n.sick.type].name}痊愈了`, '#7DFF7D');
            n.sick = null;
            return true;
        }
    }
    return false;
}
function consumeItem(inv, i) {
    inv[i].n--;
    if (inv[i].n <= 0) inv.splice(i, 1);
}

// 2026-08-11 v2.97 濒死角色被攻击（补刀）处理：不再立即彻底死亡，而是扣救援时间。
// 每 1 点伤害扣 DOWNED_HIT_PENALTY_SEC(10) 秒；累计惩罚把剩余救援时间扣完 → 才彻底死亡。
// 返回 true = 本次伤害"吃掉"（角色保持倒地，继续等待救援）；false = 伤害走正常死亡流程。
function dkSoft(sv) {
    const dk = B.DIFF_TABLE && B.DIFF_TABLE[sv && sv.diffKey];
    return !!(dk && dk.soft);
}
export function npcApplyDownedHit(sv, n, dmg) {
    if (!sv || !n || !n.downed) return false;
    if (n._downedAtReal == null) n._downedAtReal = (sv.now != null ? sv.now : 0);
    if (n._penaltySec == null) n._penaltySec = 0;
    const dmgNum = Math.max(0, dmg || 0);
    if (dmgNum <= 0) return true;   // 0 伤害打在倒地角色上：忽略（保持倒地）
    n._penaltySec += dmgNum * B.DOWNED_HIT_PENALTY_SEC;
    // 与主控 _downed 同口径：现实流逝 + 惩罚累计 ≥ 20 分钟 → 彻底死亡
    const spent = Math.max(0, (sv.now != null ? sv.now : 0) - n._downedAtReal) + (n._penaltySec || 0);
    if (spent >= B.DOWNED_LIMIT_SECONDS) {
        // 救援时间被扣完 → 彻底死亡（生尸体，保持可搜索遗物）
        n.downed = false; n.alive = false; n.hp = 0;
        n._deathReason = n._deathReason || '救援时间耗尽致死';
        n._corpse = true;
        n._corpseDay = sv.day;
        // 2026-08-11 v2.98 尸体尸变系统：记录尸体生成现实时刻
        n._corpseAtReal = sv.now != null ? sv.now : 0;
        n._corpseContents = [];
        for (const s of n.inv || []) { if (s) n._corpseContents.push({ ...s, n: s.n || 1 }); }
        n._corpseSearched = false;
        log(sv, `${n.name} 被攻击，救援时间耗尽，彻底死亡……`, '#FF5544');
        return true;
    }
    // 未扣完：角色保持倒地，仅提示剩余时间（防刷屏：每 3 秒最多一次）
    if (!n._hitLogT || sv.now - n._hitLogT > 3) {
        n._hitLogT = sv.now;
        const remainSec = Math.max(0, B.DOWNED_LIMIT_SECONDS - spent);
        log(sv, `${n.name} 被攻击！救援时间减少 ${Math.round(dmgNum * B.DOWNED_HIT_PENALTY_SEC)} 秒（剩余 ${Math.ceil(remainSec / 60)} 分钟）`, '#FF8866');
    }
    return true;
}

export function killNpc(sv, n, reason) {
    if (!n.alive) return;
    // 2026-08-11 v2.97 濒死补刀：已倒地（downed=true）的角色被攻击 → 扣救援时间而非直接死亡
    //（用户反馈：濒临死亡被补刀后完全不能救）。队友/主控倒地角色被打不再立刻死透，救援时间
    // 每 1 点伤害减 10 秒，扣完（≤20 分钟窗口耗尽）才彻底死亡。
    if (n.downed && dkSoft(sv)) {
        npcApplyDownedHit(sv, n, 1);
        return;
    }
    // 2026-08-10 软核成员倒地机制（用户需求"成员被敌对击杀应和主控一样可救助"）：
    // 软核难度（normal）下，party 成员被【战斗致死】（被僵尸咬死/被击杀）→ 转为倒地（downed）状态，
    // 不直接死亡——队友/玩家可搜集药品救助（与主控倒地同机制，由 updateDowned 管理超时与全灭）。
    // 非战斗死亡（病/寿终正寝）与硬核难度：保持直接死亡。
    const dk = B.DIFF_TABLE && B.DIFF_TABLE[sv.diffKey];
    // 2026-08-11 v2.98 reason 字符串升级为详细自然语言（含"被XXX击杀致死"/"被僵尸啃咬致死"等）。
    // 兼容旧字符串（'被僵尸咬死'/'被击杀'）+ 新字符串（'被僵尸啃咬致死'/'被...击杀致死'/'战斗中被击败'），
    // 任何含"僵尸"或"击杀"/"击败"的 reason 都视为战斗死亡 → 软核倒地路径。
    const combatDeath = reason && (
        reason.indexOf('僵尸') >= 0 || reason.indexOf('击杀') >= 0 || reason.indexOf('击败') >= 0
    );
    if (dk && dk.soft && n.party && !n.downed && combatDeath) {
        // 2026-08-10 修复"操控的队友被杀后血量归零、不死不亡、无濒死提示"：
        // 当前主控（sv.controllerId 指向）被战斗致死时不能转倒地锁死——applyControlled 每帧
        // 把 sv.hp 钳到 ≥1，若记录转 downed 会让主控永远卡在 hp=1 且不可操控。
        // 主控被杀 → 同步 sv.hp=0 触发主循环 onDeath（主控死亡/软核重生/切回原主角流程）。
        if (n.id === sv.controllerId) {
            // 2026-08-11 修复"主控队友被击杀没有倒地待救过程、直接死亡留尸体；存活队友再死直接重生"：
            // 当前主控（被玩家操控的队友）被【战斗致死】应和普通 party 成员一致——进入【倒地待救】
            // （downed=true, hp=1, 入 _downedMembers），队友/玩家可搜集药品救活，而不是直接
            // alive=false 留尸体（用户反馈：主控角色血量归零后没有死亡/濒死过程）。
            // 修复 v2.85 的实现：不再直接置 alive=false 留尸体，改为倒地待救 + 自动切视角。
            // 只有所有队友都阵亡/倒地（无可切）时才走 sv.hp=0 死亡流程（onDeath 全灭重生）。
            n.downed = true;
            n.hp = 1;
            n._deathReason = reason;   // 2026-08-11 记录击败原因（全灭弹窗显示）
            // 2026-08-11 v2.97 现实时间救援倒计时：记录倒地时刻（sv.now 现实秒）
            n._downedAtReal = sv.now != null ? sv.now : 0;
            n._penaltySec = 0;
            // 2026-08-12 v2.101 用户定稿：**每个人救助时间单独算，按自己的濒死次数，非队伍累计**。
            // 原用 sv._downedCount（队伍累计）→ 队友首次濒死受别的主控死亡次数影响。改为 n._downedCount
            //（该队友自己独立的濒死次数）：第 n 次 → 20分钟/2^(n-1)，最低 60 秒。
            n._downedCount = (n._downedCount || 0) + 1;
            n.limitSec = Math.max(60, Math.round((B.DOWNED_LIMIT_SECONDS || 1200) / Math.pow(2, Math.max(0, (n._downedCount || 1) - 1))));
            if (!Array.isArray(sv._downedMembers)) sv._downedMembers = [];
            if (!sv._downedMembers.some(m => m && m.id === n.id)) sv._downedMembers.push(n);
            // 自动切到下一个可行动队友（排除已倒地的 n：switchControl 拒切 downed）。
            // 复用下方与普通成员一致的可切逻辑（同位置优先 + 距离）；不调用 onControlledDeath
            //（它会 cur.alive=false 把倒地主控置死）。switchControl 会把当前主控（已 downed）状态
            // 写回记录并载入目标——切视角只是切视角，倒地的旧主控留在原地等待救治。
            const alive = sv.npcs.filter(m => m.alive && !m.downed && m.party);
            if (alive.length >= 1) {
                const sorted = alive.slice().sort((a, b) => {
                    const aSame = !!a.inInterior === !!sv.interior;
                    const bSame = !!b.inInterior === !!sv.interior;
                    if (aSame !== bSame) return aSame ? -1 : 1;
                    return Math.hypot(a.x - sv.px, a.y - sv.py) - Math.hypot(b.x - sv.px, b.y - sv.py);
                });
                // 切视角前把 sv.hp 置为倒地血（1）：switchControl 会把"当前主控(cur=n)"状态写回记录，
                // 若 sv.hp 仍是满血，cur.hp 会被覆盖成满血而丢失倒地血（downed=true 但 hp=100 的脏状态）。
                // sv.hp=1 使 nearDeath=true → cur.hp 写回 1；随后 switchControl 载入新主控血量覆盖 sv.hp。
                sv.hp = 1;
                switchControl(sv, sorted[0].id, true);
                log(sv, `${n.name} 倒下了（可救助）……自动切换到 ${sorted[0].name} 视角`, '#7fd6ff');
            } else {
                // 无可切队友（全员阵亡/倒地）→ 走主控死亡流程（onDeath 全灭软核重生）
                log(sv, `${n.name} 倒下了，但队伍已无人可行动……`, '#FFB347');
                sv.hp = 0;
            }
            return;
        }
        n.downed = true;
        n.hp = 1;
        n._deathReason = reason;   // 2026-08-11 记录击败原因（全灭弹窗显示"XXX 被什么击败了"）
        // 2026-08-11 v2.97 现实时间救援倒计时：记录倒地时刻
        n._downedAtReal = sv.now != null ? sv.now : 0;
        n._penaltySec = 0;
        // 2026-08-12 v2.102 用户定稿：**每个人救助时间单独算，按自己的濒死次数，非队伍累计**。
        // 修复"普通队友被击杀（非主控分支）未设置 limitSec/_downedCount"——此前此分支漏加，
        // 队友每次倒下都回退默认 20 分钟（第二次倒下也 20 分钟，应 10 分钟）。
        // 本分支 = 普通 party 队友被战斗致死：n._downedCount++ 并算 limitSec（第 n 次 → 20分钟/2^(n-1)）。
        n._downedCount = (n._downedCount || 0) + 1;
        n.limitSec = Math.max(60, Math.round((B.DOWNED_LIMIT_SECONDS || 1200) / Math.pow(2, Math.max(0, (n._downedCount || 1) - 1))));
        // 记录倒地成员（供 updateDowned 管理超时/背人/救助；不覆盖已有的倒地主控 _downed）
        if (!Array.isArray(sv._downedMembers)) sv._downedMembers = [];
        if (!sv._downedMembers.some(m => m && m.id === n.id)) sv._downedMembers.push(n);
        if (n.party) log(sv, `${n.name} 倒下了（可救助）……`, '#7fd6ff');
        return;
    }
    n.alive = false;
    n.hp = 0;
    n.downed = false;   // 2026-08-10 补刀/非战斗彻底死亡：清除倒地标记，保持状态干净
    n._deathReason = reason;   // 2026-08-11 记录击败原因（全灭弹窗显示）
    // 2026-08-10 用户需求：恶意 NPC（hostile）被击杀 → 掉落包裹，含该 NPC 背包里的所有物品。
    // 掉落物复用 loot 袋格式（contents 数组，拾取后进背包）；室内 NPC 掉门口世界坐标（同遗物逻辑）。
    if (n.role === 'hostile') {
        let dx = n.x, dy = n.y;
        if (sv.interior && typeof sv.interior.doorX === 'number') {
            dx = sv.interior.doorX;
            dy = sv.interior.doorY;
        }
        // 收集背包全部物品（含武器 wpn: 与弹药），空背包也掉一个空袋（可拾取确认击杀战利品）
        const contents = [];
        for (const s of n.inv || []) {
            if (!s) continue;
            contents.push({ id: s.id, n: s.n || 1 });
        }
        if (!sv.drops) sv.drops = [];
        sv.drops.push({ x: dx, y: dy, id: 'loot:npcbag', n: 1, contents });
        // 金币也掉落（作为 loot:npcbag 的一部分不可直接堆，单独放一袋金币）
        if ((n.coins || 0) > 0) sv.drops.push({ x: dx, y: dy, id: 'coin', n: Math.max(1, Math.round((n.coins || 0) / 2)) });
        log(sv, `${n.name} 被击杀，掉落了包裹（${contents.length} 件物品）`, '#FFD700');
    } else if (n.party && n.alive === false) {
        // 2026-08-10 用户需求"成员尸体形象留在原地、在尸体上搜索（不是掉落袋）"：
        // party 成员死亡 → 标记 _corpse（渲染躺倒尸体，形象不消失），玩家靠近 F 在尸体上搜索遗物
        //（含成员背包全部物品）。尸体无碰撞可穿过；搜索由 updatePrompt/doInteract 处理。
        n._corpse = true;
        n._corpseDay = sv.day;   // 记录死亡天数（超期腐烂清理用）
        // 2026-08-11 v2.98 尸体尸变系统：记录尸体生成现实时刻（尸变倒计时起点）
        n._corpseAtReal = sv.now != null ? sv.now : 0;
        n._corpseContents = [];
        for (const s of n.inv || []) {
            if (!s) continue;
            // 2026-08-10 用户要求"物品功能不会丧失"：保留完整物品对象（含 wpn: 武器耐久/附魔等
            // 自定义属性），不能只存 {id,n}——否则搜索尸体拿回的武器/消耗品丢属性导致失效。
            n._corpseContents.push({ ...s, n: s.n || 1 });
        }
        log(sv, `${n.name} 的尸体留在原地（靠近搜索 [F]）……`, '#9fd6ff');
    }
    // 死亡提示只播报队员（陌生 NPC 的生老病死与我们无关，不刷屏）
    if (n.party) log(sv, `${n.name} 死亡（${reason}）`, '#FF8866');
    sv.effects.push({ kind: 'dead', x: n.x, y: n.y, life: 0.6, maxLife: 0.6, label: n.name });
    AudioSystem.playZombieDie && AudioSystem.playZombieDie();
    if (n.party) {
        n.party = false;
        // 仅剩 2 名成员且主控阵亡 → 自动切换
        const alive = sv.npcs.filter(m => m.alive && m.party);
        if (sv.controllerId && sv.controllerId === n.id && alive.length >= 1) {
            // 2026-08-10 修复"室内死亡切视角弹到室外"：自动切换优先选同位置（同室内/同室外）队友，
            // 与倒地救治的 mates 排序一致；否则 alive[0] 若在室外，切视角会瞬间弹出建筑。
            const sorted = alive.slice().sort((a, b) => {
                const aSame = !!a.inInterior === !!sv.interior;
                const bSame = !!b.inInterior === !!sv.interior;
                if (aSame !== bSame) return aSame ? -1 : 1;
                return Math.hypot(a.x - sv.px, a.y - sv.py) - Math.hypot(b.x - sv.px, b.y - sv.py);
            });
            switchControl(sv, sorted[0].id, true);
        }
    }
}

// ---------- 驾驶订单：命令队员开车载全员前往目的地 ----------
// 目的地：营地 / 城市 / 郊区 / 废墟 / 自由探索（无营地时也能开车出发，探索远方）。
// 前提：附近有"归属"汽车（玩家修复过或驾驶过，m.owner 标记）。
// 流程：全员走向汽车 → 司机上车（sv.driving 由 NPC 驾驶）→ 主控与队员自动乘车
//      → 开往目标点 → 停车放人，队员回营地待命（无营地则恢复跟随）。驾驶中按 F 取消接管。
const DEST_INFO = {
    camp: { label: '营地' },
    city: { label: '城市', dist: 90 * TS },
    suburb: { label: '郊区', dist: 60 * TS },
    ruins: { label: '废墟', dist: 100 * TS },
    free: { label: '自由探索', dist: 120 * TS },
};
// 就近吸附到可步行格（兜底用）：目标格不可走时向外扩 6 圈找可走格，让车真正开到点位上。
// 优先选"紧邻公路/人行道"的可走格——2 格宽车体开不进建筑死角，停在死角的点
// 会导致 BFS 永远找不到可达路径（路径为 0、车原地"无法直接到达"）。
function snapToWalkable(sv, gx, gy) {
    const near = (x, y) => {
        if (!isWalk(getTile(sv, x, y))) return false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = getTile(sv, x + dx, y + dy);
            if (t === T.ROAD || t === T.SIDEWALK) return true;
        }
        return false;
    };
    if (near(gx, gy)) return { tx: (gx + 0.5) * TS, ty: (gy + 0.5) * TS };
    for (let r = 1; r <= 6; r++) {
        for (let oy = -r; oy <= r; oy++) {
            for (let ox = -r; ox <= r; ox++) {
                if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
                if (near(gx + ox, gy + oy)) {
                    return { tx: (gx + ox + 0.5) * TS, ty: (gy + oy + 0.5) * TS };
                }
            }
        }
    }
    // 兜底：任意可走格
    for (let r = 1; r <= 6; r++) {
        for (let oy = -r; oy <= r; oy++) {
            for (let ox = -r; ox <= r; ox++) {
                if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
                if (isWalk(getTile(sv, gx + ox, gy + oy))) {
                    return { tx: (gx + ox + 0.5) * TS, ty: (gy + oy + 0.5) * TS };
                }
            }
        }
    }
    return { tx: (gx + 0.5) * TS, ty: (gy + 0.5) * TS };
}
// 目标点是否邻近公路/人行道：公路网上的点大概率 2 格宽车体可直达，不会开进建筑死角
function nearRoad(sv, gx, gy) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = getTile(sv, gx + dx, gy + dy);
        if (t === T.ROAD || t === T.SIDEWALK) return true;
    }
    return false;
}
// 驾驶目的地寻点：城市/郊区/废墟 → 在真实目标区域内收集"可步行格"候选，优先邻近公路
// （2 格宽车体能真正开到点上）；废墟直接从最近城市的工业区扇形（5~16 区块、±0.8 弧度）内
// 取样，不再靠远处几条射线碰运气。此前把"格坐标"误当"区块坐标"传给 districtAt 等函数
// （1 区块 = 16 格，survival.js wordRegionModifier 有同款换算），射线全部扫到错误的远处区域，
// 几乎必落空 → 兜底随机野地点，车开到荒野"没到目的地"。
function pickDriveTarget(sv, driver, dest, di) {
    const seed = sv.world.seed;
    const dgx = Math.floor(driver.x / TS), dgy = Math.floor(driver.y / TS);
    const ccx = Math.floor(dgx / CHUNK), ccy = Math.floor(dgy / CHUNK);
    const want = { city: 'urban', suburb: 'suburb', ruins: 'ruins' }[dest];
    const maxTiles = Math.round(di.dist / TS);
    if (want) {
        const cands = [];
        const add = (gx, gy) => {
            const t = getTile(sv, gx, gy);
            if (t === T.CAR || t === T.CARWRECK) return;   // 停着车的格不能当停车点
            if (!isWalk(t)) return;
            if (districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)) !== want) return;
            const dist = Math.hypot(gx - dgx, gy - dgy);
            if (dist < 2) return;   // 太近不算远行
            cands.push({ gx, gy, dist, road: nearRoad(sv, gx, gy) });
        };
        if (want === 'ruins') {
            // 废墟 = 最近城市外缘的工业区扇形（isIndustrialZone：距城市中心 5~16 区块、角宽 ±0.8）：
            // 确定性扇形扫描（角度 20 档 × 距离 6 档，加少量抖动），保证覆盖整个工业扇形；
            // 纯随机采样有 ~10% 概率全部落空（扇形与城市环重叠），导致兜底到城市格。
            const city = nearestCityAt(seed, ccx, ccy);
            if (city) {
                const indAngle = industrialAngleAt(seed, city.cellX, city.cellY);
                const rng = () => Math.random();
                for (let ai = 0; ai < 20; ai++) {
                    const ang = indAngle + (ai / 20 - 0.5) * 1.7 + (rng() - 0.5) * 0.1;
                    for (let di2 = 0; di2 < 6; di2++) {
                        const dist = 5.5 + (di2 / 6) * 10 + (rng() - 0.5) * 1.2;
                        add(Math.round((city.x + Math.cos(ang) * dist) * CHUNK),
                            Math.round((city.y + Math.sin(ang) * dist) * CHUNK));
                    }
                }
            }
        }
        // 城市/郊区（及废墟兜底）：8 条均匀射线全距离扫描，收集全部候选而不是取第一条。
        // 扫描上限取"距离档与 240 格较大值"：玩家可能在废墟/荒野深处，90 格（城市档）
        // 扫不到目标区域就会退而选附近的废墟格（"去城市被送废墟"根因）。
        const scanMax = Math.max(maxTiles, 240);
        for (let i = 0; i < 8; i++) {
            const ang = i * Math.PI / 4 + (Math.random() - 0.5) * 0.5;
            const cx = Math.cos(ang), cy = Math.sin(ang);
            for (let step = 2; step <= scanMax; step += 2) {
                add(dgx + Math.round(cx * step), dgy + Math.round(cy * step));
            }
        }
        if (cands.length) {
            // 排序：优先邻近公路（车开得到）→ 优先 ≥14 格正经远行 → 距离近的（寻路短、易到达）
            const minTiles = 14;
            cands.sort((a, b) => {
                if (a.road !== b.road) return a.road ? -1 : 1;
                const fa = a.dist >= minTiles ? 0 : 1, fb = b.dist >= minTiles ? 0 : 1;
                if (fa !== fb) return fa - fb;
                return a.dist - b.dist;
            });
            const p = cands[0];
            return { tx: (p.gx + 0.5) * TS, ty: (p.gy + 0.5) * TS };
        }
    }
    // 兜底：朝最近城市方向开（城市/郊区指向城心，废墟指向工业区朝向），而不是随机方向，
    // 保证"探索城市/废墟"的车至少越开越接近目标区域；自由探索才用随机方向。
    // 兜底点必须落在目标区域内（沿方向逐步前进直到进入目标区域的可步行格）——
    // 否则 snapToWalkable 可能吸附到路过的废墟/荒野格，把"去城市"的车送到废墟。
    const city = nearestCityAt(seed, ccx, ccy);
    let ang;
    if (want === 'ruins' && city) ang = industrialAngleAt(seed, city.cellX, city.cellY);
    else if (want && city) ang = Math.atan2(city.y * CHUNK + CHUNK / 2 - dgy, city.x * CHUNK + CHUNK / 2 - dgx);
    else ang = Math.random() * Math.PI * 2;
    if (want) {
        const cx2 = Math.cos(ang), cy2 = Math.sin(ang);
        // 沿目标区域方向大步扫描（最多 maxTiles*8 ≈ 720 格）：城市/郊区/废墟总在
        // 世界内且废墟紧贴城市外缘，720 格内必然进入目标区域——绝不落在路过的废墟/荒野
        for (let step = maxTiles; step <= maxTiles * 8; step += 3) {
            const gx = dgx + Math.round(cx2 * step), gy = dgy + Math.round(cy2 * step);
            if (districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)) !== want) continue;
            if (!isWalk(getTile(sv, gx, gy))) continue;
            return { tx: (gx + 0.5) * TS, ty: (gy + 0.5) * TS };
        }
    }
    return snapToWalkable(sv, dgx + Math.round(Math.cos(ang) * maxTiles), dgy + Math.round(Math.sin(ang) * maxTiles));
}
// 诊断：pickDriveTarget 的选点结果（目标距玩家格数 + 区域），排查"去城市被送废墟"
export function debugPickTarget(sv, dest) {
    if (!sv) return 'no-sv';
    const di = DEST_INFO[dest] || DEST_INFO.free;
    const t = pickDriveTarget(sv, { x: sv.px, y: sv.py }, dest, di);
    const tgx = Math.floor(t.tx / TS), tgy = Math.floor(t.ty / TS);
    const pgx = Math.floor(sv.px / TS), pgy = Math.floor(sv.py / TS);
    const dist = Math.hypot(tgx - pgx, tgy - pgy);
    return JSON.stringify({
        dest,
        targetArea: districtAt(sv.world.seed, Math.floor(tgx / CHUNK), Math.floor(tgy / CHUNK)),
        fromArea: districtAt(sv.world.seed, Math.floor(pgx / CHUNK), Math.floor(pgy / CHUNK)),
        distTiles: Math.round(dist),
        tgx, tgy, pgx, pgy,
    });
}
export function startDriveOrder(sv, driver, dest) {
    dest = dest || 'camp';
    const di = DEST_INFO[dest] || DEST_INFO.free;
    if (dest === 'camp' && !sv.camp) { log(sv, '还没有营地！放置"领地旗帜"建立领地后才能返回', '#FFB347'); return false; }
    if (sv.driveOrder) { log(sv, '已有驾驶命令进行中', '#FFB347'); return false; }
    if (sv.driving) { log(sv, '车辆行驶中，无法下达命令', '#FFB347'); return false; }
    // 找附近 24 格内、已修复且有归属的车
    const [dgx, dgy] = [Math.floor(driver.x / TS), Math.floor(driver.y / TS)];
    let carKey = null, bestD = 24 * TS;
    for (const key in sv.mods.tiles) {
        const m = sv.mods.tiles[key];
        if (!m || m.t !== T.CAR || !m.repaired || !m.owner) continue;
        const [gx, gy] = key.split(',').map(Number);
        const d = Math.hypot(gx - dgx, gy - dgy) * TS;
        if (d < bestD) { bestD = d; carKey = key; }
    }
    if (!carKey) { log(sv, '附近没有归属汽车（先修复一辆车或驾驶过它才会有"所属"标记）', '#FFB347'); return false; }
    // 目标点：营地 = 旗位置就近吸附到可步行格（旗可能插在建筑/墙角，2 格宽车体开不进去，
    // 不吸附会导致车永远开不到 1.5 格内，停在半路）；其余 = 真实区域寻点（城市/郊区/废墟
    // 指向对应区域的可步行格，自由探索 = 随机远方吸附可步行格），保证"抵达目的地"是真实开到点上
    let tx, ty;
    if (dest === 'camp') {
        const s = snapToWalkable(sv, Math.floor(sv.camp.x / TS), Math.floor(sv.camp.y / TS));
        tx = s.tx; ty = s.ty;
    } else {
        const t = pickDriveTarget(sv, driver, dest, di);
        tx = t.tx; ty = t.ty;
    }
    // 目标可达性预检：发车前做一次完整 BFS（最大 margin 180 + 12 万格上限）。
    // 目标不可达（建筑内部/废墟死角/被堵死）时，**把目标替换为 BFS 最近可达格**——
    // 车保证能开到替换点（一次送达），否则保留原目标会让实时驾驶反复大 BFS
    // （path 空每 0.8s 重建 12 万格）→ 卡顿 + 停在半路，用户要再下第二次命令才到。
    // 替换点优先在 best 附近 5×5 内找同目标区域的格（避免改道到别的区域）。
    const [cgx, cgy] = carKey.split(',').map(Number);
    const chk = WV.buildChauffeurPath(sv, (cgx + 1) * TS, (cgy + 0.5) * TS,
        Math.floor(tx / TS), Math.floor(ty / TS), 12);
    let _chkInfo = null;
    if (!chk.goal && chk.bestX != null) {
        _chkInfo = { goal: false, bestX: chk.bestX, bestY: chk.bestY, expanded: chk.expanded || 0 };
        const wantD = { city: 'urban', suburb: 'suburb', ruins: 'ruins' }[dest];
        let replaced = null;
        if (wantD) {
            const rseed = sv.world.seed;
            for (let dy = -2; dy <= 2 && !replaced; dy++) for (let dx = -2; dx <= 2 && !replaced; dx++) {
                const bx = chk.bestX + dx, by = chk.bestY + dy;
                if (districtAt(rseed, Math.floor(bx / CHUNK), Math.floor(by / CHUNK)) !== wantD) continue;
                if (!isWalk(getTile(sv, bx, by))) continue;
                replaced = { tx: (bx + 0.5) * TS, ty: (by + 0.5) * TS };
            }
        }
        if (!replaced) replaced = { tx: (chk.bestX + 0.5) * TS, ty: (chk.bestY + 0.5) * TS };
        const bd = Math.hypot(replaced.tx / TS - Math.floor(tx / TS), replaced.ty / TS - Math.floor(ty / TS));
        if (bd > 1.5) {
            tx = replaced.tx;
            ty = replaced.ty;
            _chkInfo.bestDistToTarget = Math.round(bd);
            log(sv, `目的地被地形挡住，改往最近可到达处（距目标约 ${Math.ceil(bd)} 格）`, '#FFD700');
        }
    } else if (chk.goal) {
        _chkInfo = { goal: true };
    }
    // walk 阶段的集合点是汽车本体（车中心，与 startDrive 同规则），不是目的地
    sv.driveOrder = { driverId: driver.id, carKey, carX: (cgx + 1) * TS, carY: (cgy + 0.5) * TS, stage: 'walk', dest, label: di.label, tx, ty, _chkInfo };
    log(sv, `${driver.name} 前往驾车，载全员前往「${di.label}」（跟着车走，F 取消）`, '#7DFF7D');
    return true;
}

// 司机 AI：walk 阶段走向汽车，到达后启动驾驶并载客
function driveDriverAI(sv, n, dt, canStand) {
    const o = sv.driveOrder;
    if (!o || o.stage !== 'walk') return;
    // 集合点是汽车（carX/carY），不是目的地；走到车边才上车
    const d = Math.hypot(o.carX - n.x, o.carY - n.y);
    if (d > TS * 1.5) { moveToward(sv, n, o.carX, o.carY, dt, canStand, 1); return; }
    // 到达：司机在车旁等待——其他成员慢慢走到车边、主控走到车边（2 格内）才发车；
    // 全员到齐 + 你上车后出发；未到齐绝不发车（提示谁还没到，卡住的成员可 F 取消处理）
    o.waitT = (o.waitT || 0) + dt;
    const playerNear = Math.hypot(sv.px - o.carX, sv.py - o.carY) < TS * 2;
    let missing = null;
    if (sv.npcs) for (const m of sv.npcs) {
        if (!m.alive || !m.party || m.id === n.id || m.riding) continue;
        if (Math.hypot(o.carX - m.x, o.carY - m.y) >= TS * 2) { missing = m; break; }
    }
    const allIn = playerNear && !missing;
    if (!allIn) {
        if (!o._waitAnnounced || o.waitT - o._lastHintT > 10) {
            o._waitAnnounced = true;
            o._lastHintT = o.waitT;
            log(sv, `${n.name} 在车旁等待：${playerNear ? '' : '你还没到车边，'}${missing ? missing.name + '正在赶来，' : ''}全员到齐后才出发`, '#FFD700');
        }
        return;
    }
    // 启动驾驶（座位分配在 startDrive 内完成：司机主驾、主控副驾、其余后排）
    if (!WV.startDrive(sv, o.carKey, n.id)) { sv.driveOrder = null; return; }
    o.stage = 'riding';
    const leftOut = !allIn && missing ? `（${missing.name} 卡住了没赶上）` : '';
    log(sv, `${n.name} 开车出发，全员已上车！全队开往「${o.label}」...（F 取消接管）${leftOut}`, '#2EE6C0');
}

// ---------- 队伍命令 ----------
export function commandNpc(sv, n, cmd) {
    if (cmd === 'follow') { n.state = 'follow'; n.campTask = null; log(sv, `${n.name} 跟随你`, '#7DFF7D'); }
    else if (cmd === 'camp') {
        if (!sv.camp) { log(sv, '还没有营地！放置"领地旗帜"建立领地后队员才会回去', '#FFB347'); return; }
        n.state = 'camp'; n.campTask = null;
        const camp = sv.camp;
        log(sv, `${n.name} 返回营地`, '#AADDFF');
        n._campGo = { x: camp.x + (Math.random() - 0.5) * 2 * TS, y: camp.y + (Math.random() - 0.5) * 2 * TS };
    }
    else if (cmd === 'dismiss') {
        n.party = false; n.hired = false; n.state = 'wander';
        log(sv, `${n.name} 离开了队伍`, '#FFB347');
    }
}

// ---------- 雇佣（按天支付物品） ----------
export const HIRE_FEES = [
    { id: 'food', n: 2, label: '食物×2/天' },
    { id: 'water', n: 2, label: '水×2/天' },
    { id: 'part', n: 1, label: '零件×1/天' },
    { id: 'gem', n: 1, label: '宝石×1/天' },
];
export function hireNpc(sv, n) {
    const fee = HIRE_FEES[Math.floor(Math.random() * HIRE_FEES.length)];
    n.hired = true; n.party = true; n.hireFee = fee; n.state = 'follow';
    n._paidDay = sv.day;
    // 联机 guest：雇佣关系上报 host（host 权威世界状态 → 世界档持久化，M2）。
    // host 端 find 同 id 设置；无则按数据创建；此后随 wsync npcs 全量拍回认 guest 端
    if (sv.mp && sv.mp.role === 'guest') {
        // 本地雇佣先行生效；标记保护期（host 回认前不被快照清理误删）
        n._mpHoldUntil = (sv.now || 0) + 5;
        (sv.mpOutbox = sv.mpOutbox || []).push({
            type: 'hire',
            npc: {
                id: n.id, name: n.name, role: n.role, look: n.look,
                x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp, dmg: n.dmg,
                wpnKey: n.wpnKey, wpnName: n.wpnName, wpn: n.wpn, inv: n.inv,
                coins: n.coins || 0, sick: n.sick || null,
                attrs: n.attrs || null, talent: n.talent || null, congenital: n.congenital || null,
                hireFee: fee,
            },
        });
    }
    log(sv, `${n.name} 加入了队伍（雇佣：${fee.label}，每日结算）`, '#7DFF7D');
}
// 每日结算雇佣费
export function settleHires(sv) {
    if (!sv.npcs) return;
    for (const n of sv.npcs) {
        if (!n.alive || !n.hired || !n.party) continue;
        if (n._paidDay === sv.day) continue;
        n._paidDay = sv.day;
        const fee = n.hireFee || HIRE_FEES[0];
        const idx = sv.inv.findIndex(s => s && s.id === fee.id && s.n >= fee.n);
        if (idx >= 0) {
            sv.inv[idx].n -= fee.n;
            if (sv.inv[idx].n <= 0) sv.inv[idx] = null;
            log(sv, `支付雇佣费：${n.name} 获得 ${itemName(fee.id)}×${fee.n}`, '#FFD700');
        } else {
            n.party = false; n.hired = false;
            log(sv, `无法支付雇佣费，${n.name} 离开了队伍`, '#FF6644');
        }
    }
}

// 无武器角色接管控制时给空武器容器（避免 sv.wpn 为 null 崩溃）
function freshWpn() {
    return { mag: {}, reloading: 0, charging: false, chargeT: 0, cooldown: 0, fireMode: {} };
}

// ---------- 切换控制（24H 冷却；只换视角，角色留在世界继续行动） ----------
export function switchControl(sv, id, force) {
    const tgt = sv.npcs.find(n => n.id === id);
    // 2026-08-10 不能切换到濒死（downed）队友身上：濒死队友需被救治，不可操控
    if (!tgt || !tgt.alive || tgt.downed || !tgt.party) return false;
    if (!force && (sv._switchCd || 0) > 0) {
        const left = Math.ceil((sv._switchCd || 0) / 1000);   // 2026-08-10 冷却 240s，按秒提示
        log(sv, `切换冷却中：还需 ${left} 秒`, '#FFB347');
        return false;
    }
    const cur = controlledNpc(sv);
    // 当前主控状态写回记录（它留在世界里，继续由 AI 行动）
    if (cur) {
        cur.x = sv.px; cur.y = sv.py;
        // 2026-08-09 修复"切队友视角后另一角色死亡/无敌循环"：
        // 死亡切视角时 sv.hp 已是 0，若直接写回 cur.hp=0，会把倒地主角记录写成
        // alive=true 但 hp=0 → 出门后被室外 AI 判定死亡 → 触发各种循环切换。
        // 与载入侧一致保底 1（倒地血），让记录保持"活着但濒死"，等救治/切换接手。
        // 2026-08-10 修复"濒死切视角误触发重生"：若当前主控濒死（sv.hp <= 25% 或 <=0），
        // 切走后直接让它进入"倒地待救"（downed），而非以低血留在世界由 AI 战斗——
        // 否则它很快被打死 → killNpc → 软核重生（用户反馈：濒死切队友后随机重生、名字变幸存者）。
        // 注意：倒地记录 hp 应为 1（倒地血），不能写回濒死血量（否则室外 AI 判定 hp<=0 又死）。
        const nearDeath = sv.hp <= Math.max(1, Math.floor(sv.maxHp * 0.25));
        cur.hp = nearDeath ? 1 : Math.max(1, sv.hp);
        cur.downed = nearDeath ? true : !!cur.downed;
        cur.food = sv.food; cur.water = sv.water;
        cur.stamina = sv.stamina; cur.maxStamina = sv.maxStamina; cur.exhausted = sv.exhausted; cur.infection = sv.infection || 0;
        cur.inv = sv.inv; cur.look = sv.character || cur.look; cur.wpn = sv.wpn;
        cur.maxHp = sv.maxHp;
        if (nearDeath) {
            // 2026-08-11 v2.97 现实时间救援倒计时：濒死切视角入 _downedMembers 时记录倒地时刻
            if (cur._downedAtReal == null) cur._downedAtReal = (sv.now != null ? sv.now : 0);
            if (cur._penaltySec == null) cur._penaltySec = 0;
            // 2026-08-12 v2.101 用户定稿：**每个人救助时间单独算，按自己的濒死次数，非队伍累计**。
            // 若已由 survival.onDeath（当前主控濒死）计过数（cur.limitSec 已设）则不重复 +1；
            // 否则（本路径先触发）用 cur._downedCount 自己独立的次数：第 n 次 → 20分钟/2^(n-1)，最低 60 秒。
            if (cur.limitSec == null) {
                cur._downedCount = (cur._downedCount || 0) + 1;
                cur.limitSec = Math.max(60, Math.round((B.DOWNED_LIMIT_SECONDS || 1200) / Math.pow(2, Math.max(0, (cur._downedCount || 1) - 1))));
            }
            if (!Array.isArray(sv._downedMembers)) sv._downedMembers = [];
            if (!sv._downedMembers.some(m => m && m.id === cur.id)) sv._downedMembers.push(cur);
            log(sv, `${cur.name} 濒临死亡，倒地等待救治……`, '#FFB347');
        }
    }
    // 载入目标
    sv.px = tgt.x; sv.py = tgt.y;
    sv.hp = Math.max(1, tgt.hp); sv.food = tgt.food; sv.water = tgt.water;
    sv.stamina = tgt.stamina != null ? tgt.stamina : 100; sv.maxStamina = tgt.maxStamina || sv.maxStamina;
    sv.exhausted = !!tgt.exhausted; sv.infection = tgt.infection || 0;
    sv.inv = normBag(tgt.inv); sv.character = tgt.look;
    sv.wpn = tgt.wpn || freshWpn();
    // 2026-08-10 修复"主控死亡切队友视角后不能攻击（无音效/无伤害/判定异常）"：
    // tgt.wpn 是 NPC 作为 AI 战斗时共享的武器容器，可能残留 cooldown/reloading/charging——
    // 切主控后 wpn.cooldown>0 → meleeAttack/fireWeapon 第一行直接 return，攻击全被吞。
    // 新主控接手武器必须清空冷却/换弹/蓄力（含弓弩蓄力音），立即可用。
    sv.wpn.cooldown = 0;
    sv.wpn.reloading = 0;
    sv.wpn.charging = false;
    sv.wpn.chargeT = 0;
    sv.maxHp = tgt.maxHp || sv.maxHp;
    sv.controllerId = id;
    sv._switchCd = SWITCH_CD;
    // 2026-08-10 切视角后重置召唤冷却：原 _summonCd 可能残留（死亡/倒地前用过召唤），
    // 会跨过切换持续存在 → 切到陈月后点"召唤队员"永远提示冷却中。切到新主控应可立即召唤一次。
    sv._summonCd = 0;
    // 2026-08-10 修复"濒死切视角后只能闪现不能移动"：切到可行动的队友后必须解除
    // 原地等待（_waitDowned）限制——否则残留 true 会锁死 WASD 移动（室内外 update 的
    // `if (sv._waitDowned) animMoving=false` 分支），只剩闪现(Q)能位移。
    sv._waitDowned = false;
    // 2026-08-09 修复"切队友视角位置互换"：室内模式下 updateInteriorMode 开头会
    // `sv.px = it.px` 用房间记录坐标覆盖玩家位置。若 it.px/it.py 仍是旧主控的位置，
    // 切视角后玩家会被拉回旧位置 → 队友位置和玩家位置来回跳（位置互换）。
    // 载入目标后立即把房间记录坐标同步到目标位置，位置保持稳定。
    if (sv.interior) { sv.interior.px = sv.px; sv.interior.py = sv.py; }
    log(sv, `现在操控 ${tgt.isPlayer ? '幸存者' : tgt.name}`, '#2EE6C0');
    return true;
}

// 主控死亡：有队友自动切换视角；否则返回 false（走正常死亡流程）
export function onControlledDeath(sv) {
    const cur = controlledNpc(sv);
    if (cur) { cur.alive = false; cur.hp = 0; }
    // 2026-08-10 只切给可行动的队友（排除濒死 downed）
    const alive = sv.npcs.filter(n => n.alive && !n.downed && n.party);
    if (alive.length >= 1) {
        // 2026-08-10 修复"室内死亡切视角弹到室外"：与 killNpc/倒地救治同款——
        // 自动切换优先选同位置（同室内/同室外）队友，否则 alive[0] 若在室外会瞬间弹出建筑。
        const sorted = alive.slice().sort((a, b) => {
            const aSame = !!a.inInterior === !!sv.interior;
            const bSame = !!b.inInterior === !!sv.interior;
            if (aSame !== bSame) return aSame ? -1 : 1;
            return Math.hypot(a.x - sv.px, a.y - sv.py) - Math.hypot(b.x - sv.px, b.y - sv.py);
        });
        switchControl(sv, sorted[0].id, true);
        log(sv, `${sorted[0].isPlayer ? '幸存者' : sorted[0].name} 接过了控制权`, '#2EE6C0');
        return true;
    }
    return false;
}

// ---------- 序列化（存档精简，临时字段不落盘） ----------
export function serializeNpcs(sv) {
    return {
        // 存活 + 尸体（_corpse）落盘：
        // 2026-08-10 尸体必须随档保存——主角遗物/成员尸体需重进世界仍可见可搜索（用户需求）。
        // 2026-08-10 性能：已搜索尸体（遗物已取走）且超过 CORPSE_KEEP_DAYS 天的不再落盘
        //（室内模式不走 updateNpcs 帧清理，序列化时兜底剔除，防存档无限膨胀）。
        // 2026-08-10 与帧清理同规则：已搜索尸体从"搜索完成当天"起算超期。
        people: (sv.npcs || []).filter(n => n.alive || (n._corpse && !(n._corpseSearched && (sv.day - corpseSearchedDay(n)) >= CORPSE_KEEP_DAYS))).map(n => ({
            id: n.id, isPlayer: !!n.isPlayer, name: n.name, role: n.role, look: n.look,
            x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp, food: n.food, water: n.water,
            stamina: n.stamina, maxStamina: n.maxStamina, exhausted: !!n.exhausted, infection: n.infection || 0,
            dmg: n.dmg, wpnKey: n.wpnKey, wpnName: n.wpnName, inv: n.inv, wpn: n.wpn,
            coins: n.coins || 0, sick: n.sick || null,
            attrs: n.attrs || null, talent: n.talent || null, congenital: n.congenital || null,
            act: n.act || null,
            bornDay: n.bornDay, alive: n.alive,
            party: n.party, hired: n.hired, hireFee: n.hireFee, state: n.state,
            campId: n.campId || null,
            riding: !!n.riding,   // 骑乘状态（乘车中读档须还原，否则下车）
            // 2026-08-09 室内外统一：在室内状态（读档还原，退出室内时带回室外）
            inInterior: !!n.inInterior, interiorKey: n.interiorKey || null, interiorFloor: n.interiorFloor || null,
            workLog: n.workLog, _paidDay: n._paidDay, age: n.age, _grown: n._grown,
            // 2026-08-10 尸体字段（主角遗物/成员尸体重进世界恢复）：标记/内容/是否已搜索
            _corpse: !!n._corpse,
            _corpseContents: n._corpseContents || null,
            _corpseSearched: !!n._corpseSearched,
            _corpseDay: n._corpseDay || null,   // 尸体死亡天数（超期腐烂清理用）
            _corpseSearchedDay: n._corpseSearchedDay || null,   // 尸体搜索完成天数（超期清理起算）
            // 2026-08-11 v2.98 尸体尸变系统：记录尸体生成现实时刻（读档保持，防"读档瞬间立即尸变"）
            _corpseAtReal: n._corpseAtReal != null ? n._corpseAtReal : null,
            // 2026-08-11 v2.98 尸变标记：_revived=已尸变（防读档后重复尸变）、_revivedCorpse=尸变尸体（不二次尸变）
            _revived: !!n._revived,
            _revivedCorpse: !!n._revivedCorpse,
            // 2026-08-11 v2.97 现实时间救援倒计时：倒地标记 + 倒地时刻 + 累计被攻击扣时（存档跨会话保持）
            downed: !!n.downed,
            _downedAtReal: n._downedAtReal != null ? n._downedAtReal : null,
            _penaltySec: n._penaltySec || 0,
            // 2026-08-12 v2.101 每人独立濒死次数 + 本次救援限时（存档跨会话保持，避免读档后 limitSec 丢失回退 20 分钟）
            _downedCount: n._downedCount || 0,
            limitSec: n.limitSec != null ? n.limitSec : null,
        })),
        controllerId: sv.controllerId || null,
        camp: sv.camp || null,
    };
}
export function restoreNpcs(sv, data) {
    if (!data) { sv.npcs = []; sv.camp = null; return; }
    // 2026-08-10 生命体征字段旧档兜底（老档无 stamina/infection 字段时补默认）
    sv.npcs = (data.people || []).map(p => ({
        ...p,
        stamina: p.stamina != null ? p.stamina : 100,
        maxStamina: p.maxStamina != null ? p.maxStamina : 100,
        exhausted: !!p.exhausted,
        infection: p.infection != null ? p.infection : 0,
        _stamDelay: 0,
        atkCd: 0, hurtT: 0, idleT: 0, workT: 0, campTask: null, _nextNeed: 2,
    }));
    // 2026-08-10 尸体恢复兜底：读档后补全尸体字段（旧档无 _corpse 字段时保持原状；新档已含）
    for (const n of sv.npcs) {
        if (n._corpse) {
            if (!Array.isArray(n._corpseContents)) n._corpseContents = [];
            if (!n._corpseSearched) n._corpseSearched = false;
            if (n._corpseDay == null) n._corpseDay = sv.day;   // 旧档无天数：按当天（不立即清理）
            // 已搜索尸体无"搜索完成天数"：老档兜底用死亡当天（不因此立即清理）
            if (n._corpseSearched && n._corpseSearchedDay == null) n._corpseSearchedDay = n._corpseDay || sv.day;
        }
    }
    sv.controllerId = data.controllerId || null;
    sv.camp = data.camp || null;   // 营地由领地旗帜确立，开局没有
    initRoster(sv);   // 旧档无 isPlayer 记录：自动补原主角记录
    // 2026-08-11 v2.97 重建 _downedMembers（运行时数组不落盘）：从 downed=true 的 party 成员恢复，
    // 确保读档后倒地成员仍被 updateDownedMembersTimeout 管理（现实时间救援倒计时继续推进）。
    if (Array.isArray(sv.npcs)) {
        sv._downedMembers = sv.npcs.filter(n => n && n.alive && n.downed && n.party);
        for (const m of sv._downedMembers) {
            if (m._downedAtReal == null) m._downedAtReal = (sv.now != null ? sv.now : 0);
            if (m._penaltySec == null) m._penaltySec = 0;
            // 2026-08-12 v2.101 旧档无 limitSec：按该角色自己的濒死次数补算（_downedCount=0 → 20 分钟）
            if (m.limitSec == null) m.limitSec = Math.max(60, Math.round((B.DOWNED_LIMIT_SECONDS || 1200) / Math.pow(2, Math.max(0, (m._downedCount || 1) - 1))));
        }
    }
}

// 读档后把主控记录的状态载入 sv.*（位置/血量/背包/武器/外观）
export function applyControlled(sv) {
    const cur = sv.npcs.find(n => n.id === sv.controllerId);
    if (!cur) { sv.controllerId = 'player'; initRoster(sv); }
    const c = sv.npcs.find(n => n.id === sv.controllerId);
    if (!c) return;
    sv.px = c.x; sv.py = c.y;
    sv.hp = Math.max(1, c.hp); sv.food = c.food; sv.water = c.water;
    sv.stamina = c.stamina != null ? c.stamina : 100; sv.maxStamina = c.maxStamina || sv.maxStamina;
    sv.exhausted = !!c.exhausted; sv.infection = c.infection || 0;
    sv.inv = normBag(c.inv); sv.character = c.look; sv.wpn = c.wpn || freshWpn();
    // 2026-08-10 同 switchControl：清空残留冷却/换弹/蓄力，接手即可攻击
    sv.wpn.cooldown = 0;
    sv.wpn.reloading = 0;
    sv.wpn.charging = false;
    sv.wpn.chargeT = 0;
    sv.maxHp = c.maxHp || sv.maxHp;
    sv._sick = c.sick || null;
}
