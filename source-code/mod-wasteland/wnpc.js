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
import { PLAYER_INFECTION, addPlayerInfection, playerInfectionEffects, infectionAutoGrowAmount } from './winfection.js';

const NAMES = ['阿远', '老周', '小满', '铁柱', '阿珍', '老顾', '二丫', '栓子', '大牛', '秀兰',
    '阿彪', '老陈', '翠花', '石头', '阿花', '建国', '玉兰', '老李', '春妮', '大强'];
const CAMP_R = 6;                 // 营地活动半径（格）
const NPC_VIEW = 7;               // 恶意 NPC 索敌半径（格）
const NPC_FRIENDLY_FIGHT = 5;     // 友善 NPC 反击半径（格）
const GROWTH_INTERVAL = 10;       // 成长间隔（天）：血量/伤害随年龄成长
const MAX_AGE = 70;               // 超过此年龄每天有自然死亡概率
const SWITCH_CD = 24 * 3600;      // 切换控制冷却（秒）= 24H
const AI_FAR_DIST = 14 * TS;      // 距离玩家超过此距离的 NPC：AI 0.3s 一跳（性能）
const NPC_CAP = 60;               // 世界 NPC 软上限（自然繁衍受限于此，玩家/开发面板不受限）
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
export function randomNpcWeapon(role) {
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

export function makeNpc(sv, x, y, role, extra) {
    const seed = sv.world.seed;
    // 生成点安全化：不可走（建筑/障碍内）时就近找可走格，防 NPC 卡墙
    const p = findWalkableNear(sv, x, y, 8);
    x = p.x; y = p.y;
    const name = (extra && extra.name) || NAMES[Math.floor(hash2(seed ^ 0x9E7, Math.floor(x / TS), Math.floor(y / TS)) * NAMES.length) % NAMES.length];
    const look = randomLook();
    const wp = randomNpcWeapon(role);
    const base = role === 'hostile' ? 110 : 100;
    // 随机背包物品（2~4 件：食物/水/零件/草药/药/汽油/金币等）
    // v4.21 背包格子统一：NPC 背包一律补齐到 BAG_SIZE(24) 格，保证"切到任意 NPC 当主控时背包格子数一致"
    const inv = normBag([...rollNpcBag(), ...(extra && extra.inv ? extra.inv : []), ...wp.items]);
    const born = rollPersonBase();
    // v4.22 血上限按 con 天赋加成（参考玩家公式）：base + (con-10)*4（con 3→base-28 / 10→base / 18→base+32）。
    // 此前 NPC 血上限只用 base（80）—— con 天赋对 NPC 血量无效果（用户反馈"NPC 都是 80 血，感觉有些天赋没有问题就是只有 80"）。
    // v4.28 用户反馈"NPC 成员血量为什么不是 100"：基准提到 100（与玩家 B.MAX_HP 一致），
    // con 加成保留（con=10 时 friendly 正好 100；高 con 略超、低 con 略低——天赋仍有意义）。
    const _conMaxHp = base + (born.attrs.con - 10) * 4;
    return {
        id: 'npc' + Math.floor(x) + '_' + Math.floor(y) + '_' + Math.floor(Math.random() * 1e6),
        name, role: role || 'friendly', look,
        x, y, tx: x, ty: y,
        hp: _conMaxHp, maxHp: _conMaxHp, food: 80, water: 80,
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
        // v4.22 NPC 感染系统：队员感染字段（与 sv.infection 平行）。队员感染满→直接尸化（用户定稿"感染致死不能救助"），不走倒地分支。
        infection: 0,
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

// 背包归一化：补齐到 BAG_SIZE（测试/跨模块调用）
export function normBag(arr) {
    if (!Array.isArray(arr)) arr = [];
    const BAG_SIZE = 24; // 与 panel.js BAG_SIZE 保持一致
    const cap = Math.max(BAG_SIZE, arr.length);
    const out = arr.slice(0, cap);
    while (out.length < BAG_SIZE) out.push(null);
    return out;
}

// NPC 体力消耗（与玩家共用 stamina/maxStamina/exhausted 字段）
export function npcSpendStamina(n, cost) {
    if (!cost || cost <= 0) return true;
    if ((n.stamina || 0) < cost) return false;
    n.stamina = Math.max(0, (n.stamina || 0) - cost);
    n._stamDelay = 2; // STAM_DELAY 常量
    return true;
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

// 初始 NPC：出生点附近 2 名友善（营地），城区建筑旁散布恶意
export function spawnInitialNpcs(sv) {
    if (!sv.npcs) sv.npcs = [];
    const sx = (SPAWN.x + 0.5) * TS, sy = (SPAWN.y + 0.5) * TS;
    for (let i = 0; i < 2; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (2 + Math.random() * 3) * TS;
        sv.npcs.push(makeNpc(sv, sx + Math.cos(ang) * d, sy + Math.sin(ang) * d, 'friendly'));
    }
    for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (12 + Math.random() * 10) * TS;
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
    // 防 npcs 数组与存档无界增长——长期游玩死尸堆积会让每帧遍历/敌意扫描/存档体积持续退化
    // 2026-08-17 修复"队友死亡直接消失"：保留 _corpse 标记的尸体 NPC（可搜索遗物/可尸变），
    // 只移除真正需要清理的死亡 NPC（非尸体）。
    if (sv.npcs.length) {
        let hasDead = false;
        for (let i = 0; i < sv.npcs.length; i++) {
            if (!sv.npcs[i].alive && !sv.npcs[i]._corpse) { hasDead = true; break; }
        }
        if (hasDead) sv.npcs = sv.npcs.filter(n => n.alive || n._corpse);
    }
    if (sv._switchCd > 0) sv._switchCd -= dt;   // 切换冷却
    if (sv._combatT > 0) sv._combatT -= dt;     // 交战状态衰减（玩家打/被打时刷新）
    const camp = sv.camp;   // 营地由领地旗帜确立，可能为 null
    const inCamp = camp && Math.hypot(sv.px - camp.x, sv.py - camp.y) < B.CAMP_RADIUS * TS;
    const controller = controlledNpc(sv);
    // v4.46 性能优化：NPC 相互排斥从"每 NPC 遍历全部 npcs 的 O(N²)"改为空间哈希网格
    // （每帧构建一次 O(N)，moveToward 只查本格 + 邻格 O(1)）。60 个 NPC 时每帧减少
    // 约 60×60=3600 次距离计算 → 约 3400 次。网格 cell = TS（36px），排斥半径 12px
    // 只可能命中本格与 8 邻格，不会漏判。
    buildNpcRepelGrid(sv);
    // 主控把状态写回记录（切换/存档时以记录为准）
    if (controller) syncControlledToRecord(sv, controller);

    for (const n of sv.npcs) {
        if (!n.alive) continue;
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

export function syncControlledToRecord(sv, n) {
    n.x = sv.px; n.y = sv.py;
    n.hp = sv.hp; n.food = sv.food; n.water = sv.water;
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

export function updateNpc(sv, n, dt, canStand, camp, controller) {
    // 每次 AI tick 先复位移动标记；本次若实际调用了 moveToward（移动）会置回 true。
    // 停在原地/休息/打工时保持 false → 渲染层显示待机动画。
    n._moving = false;
    // v4.22 NPC 感染移速削弱：与主控一致（speedMul 由 playerInfectionEffects 给出，每感染 1%→移速 -0.5% 削到 50% 封顶）
    // 把感染乘子乘到 moveToward 调用的 speedMul 上（下方所有 moveToward 调用前 n._infSpdMul 会被引用）
    n._infSpdMul = (n.infection > 0) ? playerInfectionEffects(n.infection).speedMul : 1;
    // 2026-08-17 v4.20 倒地 NPC 不能移动/攻击/工作（用户反馈"倒地之后能移动"）
    // _moving=false 渲染层显示倒地姿态，_downedMembers 受统一超时管理，救援时间用尽走 killNpc → 3 分钟尸变
    // 2026-08-18 v4.33 用户定稿："感染不会在倒地的时候停下"——倒地期间感染继续增长，
    // 感染满在救援时间结束前直接死亡尸化（updateNpcInfection 内部 killNpc → 尸体 → 3 分钟后尸变）。
    if (n.downed) {
        updateNpcInfection(sv, n, dt);
        return;
    }
    // v4.22 NPC 感染系统：队员感染自动增长；感染满→直接尸化（与"无救援时间"用户定稿一致）
    // v4.11 从 `n.party` 扩展到【所有活 NPC】（含敌对/中立）：用户反馈"僵尸攻击对所有NPC都生效，
    // 敌对NPC被咬也要有感染/侵蚀/属性降低"。被咬（maybeInfectNpc）累积 n.infection 后，这里
    // 统一自动增长 + 削血上限/移速（playerInfectionEffects）+ 满→尸化（killNpc→尸体→尸变）。
    if (n.infection > 0) {
        updateNpcInfection(sv, n, dt);   // v4.31 抽公共函数：远离玩家（updateNeeds 路径）也执行感染增长/满值死亡
        if (!n.alive) return;            // 感染满已 killNpc → 直接返回（不再执行下方 AI）
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
    // v4.51 队伍成员自动拾取脚下掉落（室内外共用；室外的 sv.drops 由 updateNpcs 每帧传，室内的 it.drops 由 updateInteriorMode 传）
    npcPickupDrops(sv, n, sv.drops);
    if (n.role === 'hostile') hostileAI(sv, n, dt, canStand);
    else if (n.party && n.state === 'follow') followAI(sv, n, dt, canStand);
    else campOrWanderAI(sv, n, dt, canStand, camp);
}
function isUiFrozen(sv, n) {
    return (sv.npcMenu && sv.npcMenu.id === n.id)
        || (sv.npcTrade && sv.npcTrade.id === n.id)
        || (sv.charPanel && sv.charPanel.id === n.id);
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

// v4.51 NPC 自动拾取掉落（室内外共用，drops 参数 = sv.drops 室外 / it.drops 室内）：
// 队伍成员走过掉落物（< 0.9*TS）时自动捡起进自己背包（n.inv），并弹幕提示"谁捡了什么"。
// 只捡"可以装下"的（addItem 剩余量判断），背包满则放弃不吞（掉落留地）。
// 节流：每 NPC 每 0.4s 扫一次（防每帧全量遍历 drops 造成性能开销，符合性能护栏第②条降频分层）。
export function npcPickupDrops(sv, n, drops) {
    if (!n || !n.alive || !n.party) return;   // 只有队伍成员自动拾取（不捡中立/敌对/躲藏者的东西）
    if (!Array.isArray(drops) || !drops.length) return;
    const now = sv.now || 0;
    if (n._pickupCdT > 0) { n._pickupCdT -= sv.dt || 0; return; }
    n._pickupCdT = 0.4;
    for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        if (!d || d.id == null) continue;
        if (Math.hypot(d.x - n.x, d.y - n.y) > 0.9 * TS) continue;   // 走到脚下才捡
        // 战利品袋（loot:/looted:）需要逐件搜索，NPC 不自动拆袋（保留玩家手动搜）
        if (String(d.id).startsWith('loot')) continue;
        const info = Panel.getItemInfo(d.id);
        if (!info) continue;
        // 加入 NPC 自己背包（24 格，addToArr 可堆叠；金币直接累计 n.coins）
        const left = d.id === 'coin'
            ? ((n.coins = (n.coins || 0) + (d.n || 1)), 0)
            : Panel.addToArr(normBag(n.inv), d.id, d.n || 1);
        if (left < (d.n || 1)) {
            const got = (d.n || 1) - left;
            MSG.pushMsg(sv, `${n.name} 拾取了 ${info.name} ×${got}`, '#7fd6ff');
            // 联机 guest 端 NPC 由 host 权威：掉落移除在 host 端也发生（同一 sv.drops/it.drops），
            // 但 guest 的 _mpRemote NPC 不跑 updateNpc → 不会走到这里，天然只 host 执行。
            if (left <= 0) drops.splice(i, 1);
            else d.n = left;
        }
    }
}

// v4.31 抽公共"NPC 感染推进"函数：updateNpc（完整 AI）与 updateNeeds（远离玩家的低频路径）
// 都调用——确保【任何距离/室内外】的感染 NPC 都会自动增长、削血上限、满 100 直接死亡（用户定稿）。
// v4.49 从内部函数改为导出：室内 updateInteriorMode 的倒地分支需要调用它
// （室外由 updateNpc downed 分支推进感染，室内原本 continue 跳过 → 感染永不增长）
export function updateNpcInfection(sv, n, dt) {
    if (!(n.infection > 0)) return;
    n.infection = addPlayerInfection(n.infection, infectionAutoGrowAmount(B.INFECTION_AUTO_GROW_PER_SEC, n.infection, dt));   // v4.28 感染随感染值加速
    // v4.22 感染削减 NPC 血上限（与主控 survival.js:840 公式一致：effMaxHp = baseMaxHp * maxHpMul）
    const _ie = playerInfectionEffects(n.infection);
    if (n._baseMaxHp == null) n._baseMaxHp = n.maxHp;   // 记录无感染血上限（按 con 加成后的）
    const _effMaxHp = Math.round(n._baseMaxHp * _ie.maxHpMul);
    n.maxHp = _effMaxHp;
    if (n.hp > _effMaxHp) n.hp = _effMaxHp;
    if (n.infection >= PLAYER_INFECTION.max) {
        // v4.30 用户定稿："感染值满了，没有倒地，直接死亡，然后等待3分钟过后尸化"。
        // 回退 v4.29 的"队伍成员感染满→倒地待救"：感染恶化是【不可救治】的死因（v4.22 设计），
        // 所有 NPC（含队伍成员）感染满一律直接 killNpc → 生成尸体 → updateCorpseRevive
        // 3 分钟（CORPSE_REVIVE_SECONDS）后尸变（尸体外观=本人，普通僵尸逻辑）。
        // v4.33 用户定稿："感染不会在倒地的时候停下，会在救援时间结束之前直接尸化"——
        // 倒地期间感染继续推进（updateNpc/updateNeeds 的 downed 路径也调用本函数），
        // 感染满直接死亡；若正倒地待救（_downedMembers）则立即从倒地管理列表移除（尸体已生成）。
        log(sv, `${n.name} 感染彻底侵蚀了身体，彻底死亡（即将尸变）`, '#FF5544');
        if (n.downed && Array.isArray(sv._downedMembers)) {
            sv._downedMembers = sv._downedMembers.filter(x => x && x.id !== n.id);
        }
        n.downed = false;   // 倒地状态转死亡：尸体由 _corpse 表达（渲染优先 _corpse，清 downed 防状态悬空）
        killNpc(sv, n, '感染恶化致死');
    }
}

function updateNeeds(sv, n, dt, canStand) {
    const mods = personMods(n);
    // v4.31 远离玩家的 NPC 也推进感染（原 updateNeeds 无感染逻辑 → 远处感染满成员不死亡，切视角才死）
    updateNpcInfection(sv, n, dt);
    if (!n.alive) return;   // 感染满已 killNpc
    n.food = Math.max(0, n.food - 0.03 * mods.hungerMul * dt);
    n.water = Math.max(0, n.water - 0.025 * dt);
    // 病：生命持续流失；有药/草药自动服药（痢疾需同时有水）
    if (n.sick) {
        n.hp -= B.sickDrainPerSec(n.sick.type) * dt;
        if (!cureSick(sv, n, n.inv, n.water) && n.hp <= 0) { npcDowned(sv, n, '病死濒死'); return; }
    }
    if (n.hp <= 0) { npcDowned(sv, n, '饿死/渴死/病死'); return; }
    // 自动进食/喝水（用自己背包）
    if (n.food < 35) eatFromInv(n);
    if (n.water < 35) drinkFromInv(n);
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

// v4.46 空间哈希网格：NPC 相互排斥 O(N²)→O(N)。
// updateNpcs 开头构建一次（sv._npcRepelGrid），moveToward 只查本格+8邻格。
const _NPC_CELL = 40;   // 格边长 40px > 排斥半径 12px×2 + 余量，邻格必覆盖

function buildNpcRepelGrid(sv) {
    const arr = sv.npcs;
    const g = new Map();
    if (arr) for (const o of arr) {
        if (!o || !o.alive || o.riding) continue;
        const k = (Math.floor(o.x / _NPC_CELL) * 73856093) ^ (Math.floor(o.y / _NPC_CELL) * 19349663);
        let l = g.get(k);
        if (!l) { l = []; g.set(k, l); }
        l.push(o);
    }
    sv._npcRepelGrid = g;
}

// 返回 n 周围 12px 内的其他存活 NPC（网格查本格+8邻格，替代全遍历）
function repelNearNpcs(sv, n) {
    const g = sv._npcRepelGrid;
    if (!g) return null;   // 网格未构建（外部直接调用 moveToward）→ 回退 null，调用方走全遍历
    const cx = Math.floor(n.x / _NPC_CELL), cy = Math.floor(n.y / _NPC_CELL);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = g.get(((cx + dx) * 73856093) ^ ((cy + dy) * 19349663));
        if (!l) continue;
        for (const o of l) {
            if (o === n) continue;
            const dxo = n.x - o.x, dyo = n.y - o.y;
            if (dxo * dxo + dyo * dyo < 144) out.push(o);   // 12px 内
        }
    }
    return out;
}

// ---------- 移动（A* 寻路：目标格路径场缓存 0.4s，跨墙绕行；近距直线兜底） ----------
// v4.46 新增第 8 参数 noPath：近距离游荡等目标跳过 A*/流场查询（直线+绕障即可），性能优化
export function moveToward(sv, n, tx, ty, dt, canStand, speedMul, noPath) {
    const dist = Math.hypot(tx - n.x, ty - n.y);
    // v4.22 感染移速削弱：自动乘 n._infSpdMul（updateNpc 开头已按感染计算）
    const _infMul = (n && n._infSpdMul) || 1;
    const _totalMul = (speedMul || 1) * _infMul;
    let mvx = tx - n.x, mvy = ty - n.y;
    // v4.46 性能优化：noPath=true（游荡等近距离目标）跳过 A*/流场查询，直线+绕障移动即可。
    // 游荡目标仅 60px 远，A* 纯浪费（且会频繁重建流场缓存）。
    if (dist > TS * 1.2 && !noPath) {
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
    const d = Math.hypot(mvx, mvy) || 1;
    const spd = 95 * _totalMul;
    const nx = n.x + mvx / d * spd * dt, ny = n.y + mvy / d * spd * dt;
    const okX = canStand(nx, n.y), okY = canStand(n.x, ny);
    if (okX) n.x = nx;
    if (okY) n.y = ny;
    // NPC 相互轻微排斥（L3）：多名队员跟随/围攻时避免完全重叠（canStand 只查地形不查 NPC）
    // v4.46 性能：优先用空间哈希网格（O(1) 邻格查询），网格未构建（外部调用）时回退全遍历 O(N²)
    let _near = repelNearNpcs(sv, n);
    if (_near === null) {
        _near = [];
        if (sv.npcs) for (const o of sv.npcs) {
            if (o === n || !o.alive || o.riding) continue;
            const dxo = n.x - o.x, dyo = n.y - o.y;
            if (dxo * dxo + dyo * dyo < 144) _near.push(o);
        }
    }
    for (const o of _near) {
        const dxo = n.x - o.x, dyo = n.y - o.y;
        const d2 = dxo * dxo + dyo * dyo;
        if (d2 < 144 && d2 > 0.01) {   // 12px 内
            const dl = Math.sqrt(d2);
            const push = 40 * dt;
            n.x += dxo / dl * push;
            n.y += dyo / dl * push;
        }
    }
    // 完全被挡：多方向候选探测 + 记忆成功方向（v4.34 修复"集合信号聚拢遇障碍卡住"：
    // 原实现随机 ±0.9rad 偏转，长墙/建筑群/营地围栏前会来回撞墙原地罚站——
    // 改为遍历候选方向，选"可走且最接近目标方向"的那一个，并记忆成功方向持续绕障；
    // 结合 pathStepTo 的不可达降级（reachableNearGoal/slideTowardGoal）可绕过障碍靠拢）
    if (!okX && !okY) {
        n._wobT = (n._wobT || 0) - dt;
        if (n._wobT <= 0 || n._probeDir == null) {
            n._wobT = 0.28;
            const targetAng = Math.atan2(ty - n.y, tx - n.x);
            const base = (n._lastSlideDir != null) ? n._lastSlideDir : targetAng;
            let bestDir = null, bestScore = -Infinity;
            // 候选方向：上次成功方向（优先）+ 目标方向 ±40°~±160° 扇形扫掠
            for (let di = 0; di < 7; di++) {
                const off = di === 0 ? 0 : ((di % 2) ? (di + 1) / 2 : -(di) / 2) * 0.7;
                const cand = base + off;
                const cxp = n.x + Math.cos(cand) * spd * dt;
                const cyp = n.y + Math.sin(cand) * spd * dt;
                if (!canStand(cxp, n.y) || !canStand(n.x, cyp)) continue;
                const score = Math.cos(cand - targetAng);   // 越接近目标方向分越高
                if (score > bestScore) { bestScore = score; bestDir = cand; }
            }
            n._probeDir = bestDir != null ? bestDir : (Math.random() * Math.PI * 2);
        }
        const px2 = n.x + Math.cos(n._probeDir) * spd * dt;
        const py2 = n.y + Math.sin(n._probeDir) * spd * dt;
        const _okX2 = canStand(px2, n.y), _okY2 = canStand(n.x, py2);
        if (_okX2) n.x = px2;
        if (_okY2) n.y = py2;
        if (_okX2 || _okY2) { n._lastSlideDir = n._probeDir; n._wobT = 0.28; }
    } else {
        n._probeDir = null;
        n._lastSlideDir = null;   // 恢复直行时清绕障记忆
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
    if (f && f.pk === pk && sv.now - f.t < 0.5) return f;
    const targets = new Set();
    for (const n of sv.npcs || []) {
        if (n.alive && !n.riding) targets.add(gridKey(Math.floor(n.x / TS), Math.floor(n.y / TS)));
    }
    sv._npcFollowField = astarField(Math.floor(sv.px / TS), Math.floor(sv.py / TS), targets, {
        canStand: (x, y) => canStand(x, y),
        ts: TS,
        maxNodes: 12000,
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
            const path = astarPath(sx, sy, gx, gy, {
                canStand: (x, y) => canStand(x, y),
                ts: TS,
                maxNodes: 3000,   // 与旧 BFS 上限一致（近距寻路，不展开全局）
            });
            if (path.length) step = { x: path[0].x, y: path[0].y };
        }
        // v4.34 寻路兜底：A* 不可达（围墙/建筑/营地围栏阻隔）时——
        // ① 目标格周边环形扫描找最近可达格作子目标（绕到障碍另一侧/门口）；
        // ② 找不到 → 朝目标方向直线探测最近可达格（NPC 被带到障碍前，配合 moveToward
        //    绕障方向记忆持续绕行）。原实现不可达直接返回 null → moveToward 直线硬撞 →
        //    集合信号聚拢/追敌时在障碍物前卡死。
        if (!step) {
            step = reachableNearGoal(sx, sy, gx, gy, canStand) || slideTowardGoal(sx, sy, gx, gy, canStand);
        }
    }
    n._path = { key, step, t: sv.now };
    return n._path.step;
}

// v4.34 A* 不可达降级①：目标格周边环形扫描（半径 1~4）找"从起点可达"的最近格作子目标。
// 用于玩家/目标点被障碍环绕（墙角、围栏内）时，让 NPC 绕到最近的缺口/门口。
// v4.46 性能优化：原实现每个候选格各跑一次独立 astarPath（最坏 64 格 × 1500 节点 ≈ 9.6 万节点
// 的瞬时帧尖峰，僵尸群/NPC 同时不可达时叠加卡顿）。改为"一次反向流场覆盖全部候选格"——
// astarField 从起点展开到候选集合（box 启发式），每个候选查 parent 表即可知是否可达 + 第一步，
// 单次 ≤6000 节点，最多节省 ~94% 寻路开销。
function reachableNearGoal(sx, sy, gx, gy, canStand) {
    // ① 收集目标格周边半径 1~4 的候选可走格（按半径近→远记录）
    const cands = [];
    for (let r = 1; r <= 4; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const tx2 = gx + dx, ty2 = gy + dy;
            if (!canStand((tx2 + 0.5) * TS, (ty2 + 0.5) * TS)) continue;
            cands.push({ x: tx2, y: ty2, r });
        }
    }
    if (!cands.length) return null;
    // ② 一次反向流场覆盖所有候选（从起点展开，box 启发式）；不可达候选自然不在 field.reachable
    const targets = new Set(cands.map(c => c.x + ',' + c.y));
    const field = astarField(sx, sy, targets, {
        canStand: (x, y) => canStand(x, y),
        ts: TS,
        maxNodes: 6000,
    });
    // ③ 按半径近→远返回第一个可达候选的第一步（field.parent 指向"朝起点走一步"）
    for (const c of cands) {
        const p = field.parent.get(c.x + ',' + c.y);
        if (p) return { x: p.gx, y: p.gy };
    }
    return null;
}

// v4.34 A* 不可达降级②：朝目标方向直线探测（≤6 步）最近可达格，把 NPC 带到障碍前
// 配合 moveToward 绕障方向记忆滑墙绕行。斜向推进不穿墙角（与 astarField 规则一致）。
function slideTowardGoal(sx, sy, gx, gy, canStand) {
    const dx = Math.sign(gx - sx), dy = Math.sign(gy - sy);
    if (!dx && !dy) return null;
    const stand = (X, Y) => canStand((X + 0.5) * TS, (Y + 0.5) * TS);
    let cx = sx, cy = sy, last = null;
    for (let i = 0; i < 6; i++) {
        const nx = cx + dx, ny = cy + dy;
        if (dx && dy) {
            // 斜向推进：三格都可走才走斜（不穿墙角）
            if (stand(nx, ny) && stand(nx, cy) && stand(cx, ny)) { cx = nx; cy = ny; last = { x: cx, y: cy }; continue; }
            // 斜角被挡：退化尝试纯 X / 纯 Y
            let moved = false;
            if (dx !== 0 && stand(nx, cy)) { cx = nx; moved = true; }
            if (dy !== 0 && stand(cx, ny)) { cy = ny; moved = true; }
            if (moved) { last = { x: cx, y: cy }; continue; }
            break;
        } else if (dx !== 0) {
            if (stand(nx, cy)) { cx = nx; last = { x: cx, y: cy }; continue; }
            break;
        } else {
            if (stand(cx, ny)) { cy = ny; last = { x: cx, y: cy }; continue; }
            break;
        }
    }
    return last;
}

// ---------- 恶意 NPC：索敌追击 + 攻击（目标 = 玩家或任何非恶意角色；受击原则与主角一致） ----------
function hostileAI(sv, n, dt, canStand) {
    // 战斗与队员同一体系：武器随机生效（近战按样式挥击 / 远程射击耗弹药）、低血逃跑、
    // 被近身后退、围攻站位——不再用固定拳头直伤
    if (combatThreat(sv, n, dt, canStand, NPC_VIEW, 0, true)) {
        n.state = 'fight';
        return;
    }
    // 无目标：游荡
    n.state = 'wander';
    wanderMove(sv, n, dt, canStand);
}

// 恶意 NPC 的威胁收集：僵尸（恶意 NPC 攻击所有敌对生物，僵尸反之）+ 玩家 + 所有非恶意 NPC（主控走玩家受伤路径）
// v4.47 性能：曼哈顿粗筛（|dx|+|dy| < bestD 才算 sqrt）
function hostileThreat(sv, n, range) {
    let best = null, bestD = range * TS;
    const pdx = sv.px - n.x, pdy = sv.py - n.y;
    if (Math.abs(pdx) < bestD && Math.abs(pdy) < bestD && Math.hypot(pdx, pdy) < bestD) {
        bestD = Math.hypot(pdx, pdy);
        best = { x: sv.px, y: sv.py, hp: sv.hp, player: true, dmg: 0 };
    }
    if (sv.npcs) {
        for (const o of sv.npcs) {
            if (!o.alive || o.role === 'hostile') continue;
            if (sv.controllerId && o.id === sv.controllerId) continue;   // 主控走玩家受伤路径
            const dx = o.x - n.x, dy = o.y - n.y;
            if (Math.abs(dx) > bestD || Math.abs(dy) > bestD) continue;
            const d = Math.hypot(dx, dy);
            if (d < bestD) { bestD = d; best = { x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg }; }
        }
    }
    // 僵尸：恶意 NPC 与僵尸互打（谁近打谁）
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        const dx = z.x - n.x, dy = z.y - n.y;
        if (Math.abs(dx) > bestD || Math.abs(dy) > bestD) continue;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = { x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z }; }
    }
    return best;
}

// ---------- 队伍跟随（自主战斗：攻击靠近自己或玩家的敌对生物；威胁贴身会躲避） ----------
function followAI(sv, n, dt, canStand) {
    // v4.41 集合优先（T 键集合信号 = 最高命令，用户反馈"召集命令回不来"）：
    // 集合期间成员无视战斗威胁直奔主控，到达（≤1.8TS）后清除标记恢复正常跟随/战斗
    if (n._gathering) {
        const _gd = Math.hypot(sv.px - n.x, sv.py - n.y);
        if (_gd <= 1.8 * TS) n._gathering = false;
        else { moveToward(sv, n, sv.px, sv.py, dt, canStand, 1); return; }
    }
    // 玩家交战中：扩大支援范围（8 格），主动赶往玩家身边助战
    const inFight = (sv._combatT || 0) > 0;
    if (combatThreat(sv, n, dt, canStand, inFight ? 8 : 6, inFight ? 8 : 4.5)) return;
    const dist = Math.hypot(sv.px - n.x, sv.py - n.y);
    if (dist > 3.2 * TS) {
        moveToward(sv, n, sv.px, sv.py, dt, canStand, 1);
    } else {
        // 警戒游荡：在玩家周围小范围巡逻警戒，随时准备出手
        // （目标点只在切换时重算一次并缓存，避免每帧随机导致原地抽搐）
        n.idleT = (n.idleT || 0) - dt;
        if (n.idleT <= 0 || n._wpX == null) {
            n.idleT = 1.2 + Math.random() * 1.5;
            n.wanderDir = Math.random() * Math.PI * 2;
            const r = 1 + Math.random();
            n._wpX = sv.px + Math.cos(n.wanderDir) * r * TS;
            n._wpY = sv.py + Math.sin(n.wanderDir) * r * TS;
        }
        moveToward(sv, n, n._wpX, n._wpY, dt, canStand, 0.5);
    }
}

// 威胁收集：僵尸 + 恶意 NPC（范围内，优先靠近自己的；其次玩家身边的）
// v4.47 性能：加曼哈顿粗筛（|dx|+|dy| < bestD 才算 sqrt）——多 NPC × 多僵尸时省大量平方根
function nearestThreat(sv, n, selfRange, playerRange) {
    let best = null, bestD = selfRange * TS;
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        const dx = z.x - n.x, dy = z.y - n.y;
        if (Math.abs(dx) > bestD || Math.abs(dy) > bestD) continue;   // 曼哈顿粗筛
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = { x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z }; }
    }
    for (const o of sv.npcs) {
        if (!o.alive || o.role !== 'hostile') continue;
        const dx = o.x - n.x, dy = o.y - n.y;
        if (Math.abs(dx) > bestD || Math.abs(dy) > bestD) continue;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = { x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg }; }
    }
    if (!best && sv.npcs) {
        // 玩家身边 4.5 格内的威胁：支援玩家
        const pr = playerRange * TS;
        for (const z of sv.zombies) {
            if (z.hp <= 0) continue;
            const dx = z.x - sv.px, dy = z.y - sv.py;
            if (Math.abs(dx) < pr && Math.abs(dy) < pr && Math.hypot(dx, dy) < pr) { best = { x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z }; break; }
        }
        if (!best) for (const o of sv.npcs) {
            if (!o.alive || o.role !== 'hostile') continue;
            const dx = o.x - sv.px, dy = o.y - sv.py;
            if (Math.abs(dx) < pr && Math.abs(dy) < pr && Math.hypot(dx, dy) < pr) { best = { x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg }; break; }
        }
    }
    return best;
}

// 战斗/躲避：返回 true 表示正在交战（不执行跟随/游荡）
// hostileMode=true：恶意 NPC 模式，威胁 = 玩家 + 非恶意 NPC，并带玩家受击逻辑
// v4.26 判断"倒地的就是当前主控本人"：sv._downed 指向 controllerId 对应的 NPC 记录
// （或 _waitDowned 倒地主控等待视角）→ 恶意 NPC 才免扣血改扣救援时间；
// 倒地的若是队友（当前主控是别人）→ 返回 false，主控正常受击（v4.25 用户定稿）。
function _downedIsCurrentController(sv) {
    if (!sv || !sv._downed) return false;
    // 主控等待视角（切队友去搜药）明确标记
    if (sv._waitDowned) return true;
    // controllerId 对应的 NPC 记录与 _downed 是同一角色
    const ctlId = sv.controllerId;
    if (ctlId == null) return true;   // 无 controllerId 时默认视为主控本人倒地
    const ctl = (sv.npcs || []).find(m => m && m.id === ctlId);
    if (ctl) {
        if (ctl.downed) return true;                    // 主控记录本身倒地
        if (sv._downed.id != null && ctl.id === sv._downed.id) return true;   // 同一 id
        if (sv._downed.name && ctl.name === sv._downed.name) return true;     // 同一名字
    }
    return false;
}
export function combatThreat(sv, n, dt, canStand, selfRange, playerRange, hostileMode) {
    // 性能：威胁搜索结果缓存 0.12s（多 NPC × 多僵尸时避免每帧全量扫描）
    n._threatT = (n._threatT || 0) - dt;
    let threat;
    if (n._threatT <= 0) {
        threat = hostileMode ? hostileThreat(sv, n, selfRange) : nearestThreat(sv, n, selfRange, playerRange);
        n._threatT = 0.12;
        n._threat = threat;
    } else {
        threat = n._threat;
    }
    if (!threat) return false;
    const wpnItem = npcWpnItem(n);
    const w = (n.wpnKey && wpnItem) ? WEAPONS[n.wpnKey] : null;
    const d = Math.hypot(threat.x - n.x, threat.y - n.y);
    // 低血量：只逃不打（躲避保命）——仅恶意 NPC（v4.41 用户反馈"队伍成员血量过低会自己乱跑"：
    // 队伍成员低血不应逃跑，继续战斗/跟随由玩家决定如何救治；恶意 NPC 保留逃跑保命）
    if (n.hp < n.maxHp * 0.35 && n.role === 'hostile') {
        retreatFrom(sv, n, threat, dt, canStand, 1.2);
        return true;
    }
    // 恶意 NPC 的目标是无敌玩家：不可命中，继续追击（不进入攻击动画）
    if (threat.player && (sv._devGod || sv.invuln > 0)) {
        moveToward(sv, n, threat.x, threat.y, dt, canStand, 1.1);
        return true;
    }
    if (w && w.kind === 'ranged' && !wpnItem.broken && npcAmmoCount(n, w.ammoType) > 0) {
        // 远程武器：保持距离射击（消耗弹药与耐久）
        // v4.34 修复"远程 NPC 没弹药永远站桩"：原代码没弹药时 `n.atkCd = 3` 后 return true，
        // 3 秒后重进同一分支仍无弹药 → 死循环站桩，永不近身肉搏。现在没弹药直接落入
        // 下方近战分支（wDef=null → punch 肉搏）。
        if (d < (w.range || 300) && n.atkCd <= 0) {
            n.atkCd = 1.8;
            fireNpcBullet(sv, n, threat);
            return true;
        }
        if (d < 110) retreatFrom(sv, n, threat, dt, canStand, 1);   // 被近身 → 后退
        return true;
    }
    // 近战（或远程武器没弹药/损坏）：攻击方式与玩家一致（按武器 attackStyle/弧宽/reach 判定）
    const wDef = w && w.kind === 'melee' ? w : null;
    const style = wDef ? (wDef.attackStyle || 'slash') : 'punch';
    const arc = wDef ? (wDef.arc || Math.PI) : Math.PI * 0.55;
    const meleeReach = wDef ? (wDef.reach || 40) + 8 : 48;
    const tdx = threat.x - n.x, tdy = threat.y - n.y;
    const tdist = Math.hypot(tdx, tdy) || 1;
    const ang2 = Math.atan2(tdy, tdx);
    let canHit = false;
    if (style === 'thrust') {
        // 长矛突刺：沿攻击方向线，垂距窄条内可刺中（与玩家 wgear 判定一致）
        const along = tdx * Math.cos(ang2) + tdy * Math.sin(ang2);
        const perp = Math.abs(-tdx * Math.sin(ang2) + tdy * Math.cos(ang2));
        canHit = along >= 0 && along <= meleeReach && perp < 24;
    } else {
        // 挥砍/直刺/重劈：扇形距离判定（弧宽由武器 arc 决定，与玩家一致）
        canHit = tdist <= meleeReach;
    }
    if (canHit && n.atkCd <= 0) {
        // 与玩家一致：冷却用武器 fireInterval，伤害用武器实际伤害
        n.atkCd = wDef ? (wDef.fireInterval || 0.35) : 0.5;
        // v4.13 NPC 近战攻击音效（与玩家一致：传武器键名查 SWING_SOUND 映射）
        if (typeof AudioSystem !== 'undefined' && AudioSystem.playWeaponSwing) {
            try { AudioSystem.playWeaponSwing(wDef ? n.wpnKey : 'fist'); } catch (e) { /* ignore */ }
        }
        if (threat.isZombie) {
            threat.z.hp -= wDef ? wDef.damage : 8;
            threat.z.hurt = 0.12;          // 僵尸受击闪白（与玩家命中一致）
            zombieHitSound(sv, threat.z);      // 受击音（铁桶/路障护甲音，与玩家一致）
        } else if (threat.player) {
            // 2026-08-09 开局昏迷苏醒：睁眼动画期间玩家无敌，恶意 NPC 近战打不伤
            if (sv._wake && sv._wake.t < sv._wake.dur) { /* 苏醒中免伤 */ }
            // v4.26 修复"队伍有人倒地就不打当前主控"（用户反馈切换主控后恶意NPC不攻击）：
            // 仅当【倒地的就是当前主控本人】（sv._downed 指向 controllerId 对应的 NPC 记录，
            // 或 _waitDowned 倒地主控视角）时才免扣血改扣救援时间；倒地的若是队友，
            // 当前主控是别人 → 正常扣血（与 v4.25 定稿"未倒地的当前主控仍应被攻击"一致）。
            else if (sv._downed && _downedIsCurrentController(sv)) {
                // v4.11 恶意 NPC 近战打【倒地中的主控】（原地等待视角）：不扣血（防 onDeath 重入），
                // 直接扣救援时间（每 1 点伤害 -10 秒，与僵尸啃咬 waction.js / 恶意NPC打倒地成员一致）
                if (sv._downed._penaltySec == null) sv._downed._penaltySec = 0;
                sv._downed._penaltySec += n.dmg * B.DOWNED_HIT_PENALTY_SEC;
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
            }
        } else if (threat.npc) {
            // 恶意 NPC 打非恶意 NPC：真实扣血，可致死（含队员）
            // v4.24 修复"血量变负 + 敌对生物对倒地生物无伤害反馈"（用户反馈）：
            // 已倒地成员不扣血（血量保持 ≥0），直接扣救援时间（每 1 点伤害减 10 秒，与僵尸啃咬/主控补刀一致）
            if (threat.npc.downed) {
                if (threat.npc.role === 'friendly' && threat.npc.party) {
                    const _pd = wDef ? wDef.damage : 8;
                    threat.npc._penaltySec = (threat.npc._penaltySec || 0) + _pd * B.DOWNED_HIT_PENALTY_SEC;
                } else {
                    killNpc(sv, threat.npc, '被击杀');   // 恶意敌对方倒地无救援，直接杀死
                }
            } else {
                threat.npc.hp = Math.max(0, threat.npc.hp - (wDef ? wDef.damage : 8));
            }
        } else {
            threat.hp -= wDef ? wDef.damage : 8;
        }
        wearNpcWeapon(sv, n);
        if (threat.npc) {
            threat.npc.hurtT = 0.3;
            // 2026-08-17 修复"队友被恶意NPC击杀无倒地"：友方队员 hp<=0 先进入倒地状态
            // （与僵尸攻击逻辑一致），倒地超时或被补刀才真正死亡。此前直接 killNpc→无倒地→无救援。
            if (threat.npc.hp <= 0) {
                if (!threat.npc.downed && threat.npc.role === 'friendly' && threat.npc.party) {
                    threat.npc.downed = true;
                    threat.npc._downedAtReal = sv.now != null ? sv.now : 0;
                    threat.npc._penaltySec = 0;
                    threat.npc.limitSec = B.DOWNED_LIMIT_SECONDS;
                    sv._downedMembers = sv._downedMembers || [];
                    if (!sv._downedMembers.find(m => m.id === threat.npc.id)) sv._downedMembers.push(threat.npc);
                } else if (threat.npc.downed && threat.npc.role === 'friendly' && threat.npc.party) {
                    // 已倒地成员：扣救援时间已在扣血段处理（v4.24），这里只保留防御分支（不重复扣时）
                } else {
                    killNpc(sv, threat.npc, '被击杀');
                }
            }
        }
        // 与玩家一致的近战视觉：挥击轨迹（按武器 attackStyle 差异化绘制）+ 命中点火花
        n.swingT = 0.22;
        n.swingDir = ang2;
        n.swingWeapon = n.wpnKey || 'fist';
        sv.effects.push({ kind: 'hit', x: threat.x, y: threat.y, life: 0.15, maxLife: 0.15 });
        return true;
    }
    if (tdist < meleeReach) { retreatFrom(sv, n, threat, dt, canStand, 0.6); return true; }
    // 围攻站位：每个 NPC 沿自己的角度绕圈贴近（每人固定随机偏移），多个队友围住目标不重叠
    if (n._jitter == null) n._jitter = (Math.random() - 0.5) * 0.5;
    const ang = Math.atan2(n.y - threat.y, n.x - threat.x) + n._jitter;
    moveToward(sv, n, threat.x + Math.cos(ang) * 26, threat.y + Math.sin(ang) * 26, dt, canStand, 1);
    return true;
}
// 躲避：远离威胁方向移动
function retreatFrom(sv, n, threat, dt, canStand, mul) {
    const dx = n.x - threat.x, dy = n.y - threat.y;
    const d = Math.hypot(dx, dy) || 1;
    moveToward(sv, n, n.x + dx / d * 50, n.y + dy / d * 50, dt, canStand, mul);
}
// ---------- NPC 武器资源：耐久（挥击/射击 -1，损坏后只能用拳头）与弹药（背包消耗） ----------
function npcWpnItem(n) {
    return (n.inv || []).find(s => s && String(s.id).startsWith('wpn:'));
}
function npcWpnBroken(n) {
    const s = npcWpnItem(n);
    return !!(s && s.broken);
}
export function wearNpcWeapon(sv, n) {
    const s = npcWpnItem(n);
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
function npcTakeAmmo(n, type, need) {
    for (const s of n.inv || []) {
        if (need <= 0) break;
        if (s && s.id === 'ammo:' + type) { const t = Math.min(s.n, need); s.n -= t; need -= t; }
    }
    for (let i = (n.inv || []).length - 1; i >= 0; i--) if (n.inv[i] && n.inv[i].id === 'ammo:' + type && n.inv[i].n <= 0) n.inv.splice(i, 1);
}
// NPC 远程射击：与玩家完全一致（弹丸分布/伤害/射程/穿透），消耗弹药与耐久；
// 恶意 NPC 的子弹标记 hostile，可命中玩家
function fireNpcBullet(sv, n, threat) {
    const w = WEAPONS[n.wpnKey];
    if (!w) return;
    // NPC 同样以"手部高度"为原点（n.y 是脚底，角色高 48，手部约 26）
    const shootY = n.y - 26;
    const ang = Math.atan2(threat.y - shootY, threat.x - n.x);
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
            // v4.35 室内楼层标记：子弹只命中同楼层目标（玩家切楼层后旧楼层子弹直接消失，
            // 防止"1 楼队员的子弹隔层打到 2 楼僵尸"——不同楼层共享坐标空间）
            floor: sv.interior ? (sv.interior.floor || 1) : null,
        });
    }
    npcTakeAmmo(n, w.ammoType, 1);
    wearNpcWeapon(sv, n);
    // v4.13 NPC 远程攻击音效（与玩家一致：传武器键名 + 弓箭走 playBowFire）
    if (typeof AudioSystem !== 'undefined') {
        try {
            if (n.wpnKey === 'bow' && AudioSystem.playBowFire) AudioSystem.playBowFire();
            else if (AudioSystem.playWeaponShot) AudioSystem.playWeaponShot(n.wpnKey, w.fireInterval || 0.15);
        } catch (e) { /* ignore */ }
    }
    sv.effects.push({ kind: 'muzzle', x: n.x + Math.cos(ang) * 20, y: shootY + Math.sin(ang) * 20, angle: ang, color: w.color, label: '轰', ghosts: pellets > 1 ? 2 : 1, life: 0.1, maxLife: 0.1 });
}
// 更新 NPC 子弹（与玩家同规则：射程衰减 + 穿透；命中僵尸/恶意 NPC，恶意火力可打玩家）
export function updateNpcBullets(sv, dt) {
    if (!sv.npcBullets || !sv.npcBullets.length) return;
    for (let i = sv.npcBullets.length - 1; i >= 0; i--) {
        const b = sv.npcBullets[i];
        // v4.35 室内楼层隔离：玩家切楼层后，旧楼层子弹直接消失（不同楼层共享坐标空间，
        // 不隔离会"隔层命中"——楼上队员的子弹打到楼下僵尸）
        if (sv.interior && b.floor != null && b.floor !== (sv.interior.floor || 1)) { sv.npcBullets.splice(i, 1); continue; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.traveled += Math.hypot(b.vx, b.vy) * dt;
        b.life -= dt;
        let dead = b.life <= 0;
        if (!dead) {
            let hit = null, best = 14;
            // ① 僵尸判定：任何子弹都能打僵尸（恶意 NPC 子弹也能打僵尸/中立生物）
            for (const z of sv.zombies) {
                if (z.hp <= 0) continue;
                if (b.hitList && b.hitList.some(h => h === z)) continue;
                const d = Math.hypot(z.x - b.x, z.y - b.y);
                if (d < best) { best = d; hit = { npc: null, z, x: z.x, y: z.y }; }
            }
            // ② 恶意子弹优先命中玩家（v4.42 用户反馈"敌对NPC对主控造成不了伤害"：
            //    原逻辑玩家判定放在 NPC 循环之后，子弹被站在玩家前面的友好队友/中立 NPC 挡掉；
            //    现在移到 NPC 判定之前——恶意 NPC 以玩家为主要目标，队友不挡枪。
            //    命中半径 12→14px（玩家身体宽 26，确保子弹不会擦身漏判））
            if (!hit && b.hostile) {
                const pd = Math.hypot(sv.px - b.x, sv.py - b.y);
                // 2026-08-09 开局昏迷苏醒：睁眼动画期间玩家无敌（恶意弹丸打不中）
                if (pd < 14 && !sv._devGod && sv.invuln <= 0 && !(sv._wake && sv._wake.t < sv._wake.dur)) hit = { player: 1, x: sv.px, y: sv.py };
            }
            // ③ NPC 判定（v4.41 阵营匹配：友好子弹只打恶意 NPC；恶意子弹只打非恶意 NPC——
            //    中立/友善生物都吃伤害，同阵营不误伤；排除发射者自身防"打自己/自己人挡枪"）
            if (!hit && sv.npcs) for (const o of sv.npcs) {
                if (!o.alive) continue;
                if (b.hostile ? (o.role === 'hostile') : (o.role !== 'hostile')) continue;
                if (b.src && o.id === b.src) continue;
                if (b.hitList && b.hitList.some(h => h === o)) continue;
                const d = Math.hypot(o.x - b.x, o.y - b.y);
                if (d < best) { best = d; hit = { npc: o, z: null, x: o.x, y: o.y }; }
            }
            if (hit) {
                // 射程衰减：有效射程内满伤，超出后线性衰减至保底 40%（与玩家一致）
                const fo = b.traveled <= b.range ? 1 : Math.max(0.4, 1 - 0.6 * ((b.traveled - b.range) / b.range));
                const dmg = Math.max(1, Math.round(b.dmg * fo));
                if (hit.player) {
                    // v4.11 恶意 NPC 弹丸打【倒地中的主控】（原地等待视角）：不扣血（防 onDeath 重入），
                    // 直接扣救援时间（每 1 点伤害 -10 秒，与近战/僵尸啃咬一致）
                    if (sv._downed) {
                        if (sv._downed._penaltySec == null) sv._downed._penaltySec = 0;
                        sv._downed._penaltySec += dmg * B.DOWNED_HIT_PENALTY_SEC;
                        sv.hurtT = 0.25;
                        dead = true;
                    } else {
                        // 下限 0（与近战一致）：恶意 NPC 弹丸可真正击败玩家；原 Math.max(1,…) 打不死
                        sv.hp = Math.max(0, sv.hp - dmg);
                        sv.hurtT = 0.25;
                        sv._combatT = 4;
                        const c = controlledNpc(sv);
                        if (c) { maybeWound(sv, c); addAct(sv, c, 'hit'); }
                        if (sv._lastNpcHit !== (b.src || '?')) { log(sv, `${b.srcName || '恶意分子'} 向你射击！`, '#FF6644'); sv._lastNpcHit = b.src || '?'; }
                        dead = true;
                    }
                } else if (hit.npc) {
                    // v4.24 修复"血量变负 + 敌对生物对倒地生物无伤害反馈"（用户反馈）：与近战一致——
                    // 已倒地成员不扣血（血量保持 ≥0），直接扣救援时间（每 1 点伤害减 10 秒）
                    if (hit.npc.downed) {
                        if (hit.npc.role === 'friendly' && hit.npc.party) {
                            hit.npc._penaltySec = (hit.npc._penaltySec || 0) + dmg * B.DOWNED_HIT_PENALTY_SEC;
                        } else {
                            killNpc(sv, hit.npc, '被击杀');   // 恶意敌对方倒地无救援，直接杀死
                        }
                    } else {
                        hit.npc.hp = Math.max(0, hit.npc.hp - dmg);
                    }
                    hit.npc.hurtT = 0.15;
                    // 2026-08-17 修复"队友被恶意NPC射杀无倒地"：与近战一致，友方队员先进入倒地
                    if (hit.npc.hp <= 0) {
                        if (!hit.npc.downed && hit.npc.role === 'friendly' && hit.npc.party) {
                            hit.npc.downed = true;
                            hit.npc._downedAtReal = sv.now != null ? sv.now : 0;
                            hit.npc._penaltySec = 0;
                            hit.npc.limitSec = B.DOWNED_LIMIT_SECONDS;
                            sv._downedMembers = sv._downedMembers || [];
                            if (!sv._downedMembers.find(m => m.id === hit.npc.id)) sv._downedMembers.push(hit.npc);
                        } else if (hit.npc.downed && hit.npc.role === 'friendly' && hit.npc.party) {
                            // 已倒地成员：扣救援时间已在命中段处理（v4.24），这里只保留防御分支（不重复扣时）
                        } else {
                            killNpc(sv, hit.npc, '被击杀');
                        }
                    }
                }
                else hit.z.hp -= dmg;
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
    // v4.46 游荡目标仅 60px 远：跳过 A*（noPath=true），直线+绕障移动即可（性能优化）
    moveToward(sv, n, n.x + Math.cos(n.wanderDir) * 60, n.y + Math.sin(n.wanderDir) * 60, dt, canStand, 0.5, true);
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
                n.atkCd = 1.2;
                host.hp -= n.dmg;
                host.hurtT = 0.3;
                wearNpcWeapon(sv, n);
                if (host.hp <= 0) killNpc(sv, host, '被击杀');
            }
        } else {
            // 巡逻
            n.idleT = (n.idleT || 0) - dt;
            if (n.idleT <= 0) { n.idleT = 3; n.wanderDir = Math.random() * Math.PI * 2; }
            moveToward(sv, n, camp.x + Math.cos(n.wanderDir) * CAMP_R * TS * 0.5, camp.y + Math.sin(n.wanderDir) * CAMP_R * TS * 0.5, dt, canStand, 0.6, true);
        }
    } else {
        // 休息：缓慢回血
        n.hp = Math.min(n.maxHp, n.hp + 0.5 * dt);
        n.idleT = (n.idleT || 0) - dt;
        if (n.idleT <= 0) { n.idleT = 4; n.wanderDir = Math.random() * Math.PI * 2; }
        moveToward(sv, n, camp.x + Math.cos(n.wanderDir) * CAMP_R * TS * 0.4, camp.y + Math.sin(n.wanderDir) * CAMP_R * TS * 0.4, dt, canStand, 0.4, true);
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
    // v4.29 感染全属性削弱（用户需求"每 1% 侵蚀点全属性下降 0.5%"）：攻击力也乘 damageMul。
    // 移速/血上限已在 updateNpc 的感染块用 playerInfectionEffects 削弱；此处补攻击力——
    // 100% 感染 → 攻击 ×0.5（降 50%），与主控玩家感染削弱规则完全一致。
    const _infDmgMul = (n.infection > 0) ? playerInfectionEffects(n.infection).damageMul : 1;
    const wantDmg = n.isPlayer ? n.dmg : Math.max(4, Math.round(wpnDmg * stage.atkMul * mods.atkMul * _infDmgMul));
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
            // 出生点附近（约 14 格）不刷野外 NPC：主角初始地不凭空冒人
            const spawnDX = tx / TS - SPAWN.x, spawnDY = ty / TS - SPAWN.y;
            if (spawnDX * spawnDX + spawnDY * spawnDY < 14 * 14) return;
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
            killNpc(sv, n, '寿终正寝');
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

// v3.80 修复 wzombie.js 导入缺失：NPC 被僵尸咬后按抗性概率感染（与玩家一致：累积感染值）
// n._infect 字段累积感染量；n.sick 用于显示病情
export function maybeInfectNpc(sv, n) {
    if (!n || !n.alive) return;
    // v4.11 移除 n.role==='hostile' 排除（用户反馈"敌对NPC被僵尸攻击不会受到感染"）：
    // 僵尸的攻击对【所有】NPC（含敌对/中立）都生效——被咬即累积感染，与玩家/队友一致。
    const m = personMods(n);
    if (n._infect == null) n._infect = 0;
    n._infect += 1 * m.sickMul;     // 与玩家一致：被咬累积感染值（界面可查看/减除）
    // v4.24 修复"NPC成员侵蚀效果没表现出来"（用户反馈）：此前只累积 n._infect（v3.80 遗留字段），
    // 从不写 n.infection（v4.22 新增的持续感染百分比）→ updateNpc 的 n.infection 永远 0 →
    // 队员侵蚀粒子/自动增长/属性削弱/感染满尸化全部失效，只有切主控后 sv.infection 才显示。
    // 修复：被咬同时把感染量计入 n.infection（与玩家 sv.infection 同一 0~100 百分比体系，满→尸化）。
    if (n.infection == null) n.infection = 0;
    n.infection = Math.min(PLAYER_INFECTION.max, n.infection + 1 * m.sickMul);
    // 感染累积到一定程度 → 转化为伤病（与玩家感染阈值同逻辑，参考 winfection.js）
    const SICK_INFECT_THRESHOLD = PLAYER_INFECTION.sickThreshold;
    if (n._infect >= SICK_INFECT_THRESHOLD && !n.sick) {
        n.sick = { type: 'infect', day: sv.day };
        n._infect = 0;
    }
}

// v3.80 修复 wzombie.js 导入缺失：NPC 濒死倒地状态下被僵尸补刀——
// 加速救援倒计时，倒计时归零才彻底死亡；单次补刀不造成致命一击（保持"咬不立刻死"的设计意图）。
// v4.11 修复"僵尸补刀倒地成员不扣救援时间/永不致死"（用户反馈）：
// 原实现累加 n.downT（v3.80 遗留旧字段），且 PLAYER_INFECTION.downTimerMax 从未定义 →
// `n.downT >= undefined` 恒 false → 救援时间既不减少、补刀也永不致死（与主控/恶意NPC不一致）。
// 改为与主控（waction.js resolvePlayerBiteTick）和恶意NPC（wnpc.js 近战/远程）完全一致：
// 每 1 点伤害扣 DOWNED_HIT_PENALTY_SEC(10) 秒救援时间，写入 n._penaltySec（成员超时管理
// updateDownedMembersTimeout 读它），扣满后自然走"救治超时 → 死亡 → 尸体 → 尸变"链路。
export function npcApplyDownedHit(sv, n, dmg) {
    if (!n || !n.alive || !n.downed) return;
    n._penaltySec = (n._penaltySec || 0) + (dmg || 0) * B.DOWNED_HIT_PENALTY_SEC;
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

// 2026-08-17 v4.20 队员倒地：所有"hp 归零"路径走这里（非队友/恶意 NPC 仍走 killNpc）
// 用户定稿："要保证队伍里的成员，包括主控角色血量归零之后会倒地，倒地有20分钟的救助时间，
// 救助时间归零之后，就会进行3分钟的尸变"。
// 队员（n.party）走倒地分支：downed=true, hp=1, _downedAtReal, _penaltySec=0, limitSec=DOWNED_LIMIT_SECONDS，
// 推入 _downedMembers 受统一超时管理（与主控一致：救援时间用尽/被人补刀致死走 killNpc）。
// 非队员/恶意 NPC：保持原行为直接 killNpc（无救援机制）。
// v4.39 用户定稿："侵蚀致死的救援时间 = 感染侵蚀致死剩余时间的 50%（按比例缩短），
// 防止救援时间内还没救活就被感染致死；未被侵蚀走正常救援逻辑；
// 被侵蚀的倒地成员救活后仍带感染（按当前感染值），不会自动清零"。
export function npcDowned(sv, n, cause) {
    if (!n || !n.alive) return false;
    if (n.downed) return true;   // 已倒地不重复
    if (!n.party) { killNpc(sv, n, cause || '倒地'); return true; }   // 非队员无救援
    n.downed = true;
    n.hp = 1;                  // 保留 ≥1 血（防被补刀误判为已死直接 killNpc）
    n._downedAtReal = sv.now != null ? sv.now : 0;
    n._penaltySec = 0;
    // v4.39 侵蚀致死的救援时长按"侵蚀致死剩余时间"50% 计算：
    // 感染感染 100% 致死需要剩余时间（1 - infection/100）×DOWNED_LIMIT_SECONDS 秒，
    // 取一半。感染 0 → 走原 DOWNED_LIMIT_SECONDS 正常救援。
    const _inf = Math.max(0, Math.min(100, n.infection || 0));
    if (_inf > 0) {
        const remainToDeathSec = (1 - _inf / 100) * B.DOWNED_LIMIT_SECONDS;
        n.limitSec = Math.max(30, Math.round(remainToDeathSec * 0.5));   // 至少 30 秒（防极端感染导致倒计时极短无法操作）
        n._erodedDowned = true;
    } else {
        n.limitSec = B.DOWNED_LIMIT_SECONDS;
        n._erodedDowned = false;
    }
    n._cause = cause || '倒地';
    // v4.23 全灭弹窗需要"倒地之前是被什么击倒的"——把 cause 同步到 _killedByReason（killNpc 的击倒原因也存该字段）
    n._killedByReason = cause || '倒地';
    sv._downedMembers = sv._downedMembers || [];
    if (!sv._downedMembers.find(m => m.id === n.id)) sv._downedMembers.push(n);
    log(sv, `${n.name} 倒地待救（${cause || '濒死'}）—— 限 ${Math.round(n.limitSec / 60) || (n.limitSec + ' 秒')} 内救治${_inf > 0 ? `（被感染侵蚀，救援时间缩短至感染致死剩余时间的 50%）` : ''}`, '#FF8866');
    return true;
}

export function killNpc(sv, n, reason) {
    if (!n.alive) return;
    n.alive = false;
    n.hp = 0;
    // v4.23 全灭弹窗需要"倒地之前是被什么击倒的"——把击倒原因同步到 _killedByReason
    // （npcDowned 的 _killedByReason 同样字段；如果先倒地再超时/补刀致死，_killedByReason 保留击倒时的原因，不被超时覆盖）
    n._killedByReason = n._killedByReason || reason || '被击杀';
    // 死亡提示：队伍成员始终播报；陌生/敌对 NPC 也提示（v4.47 用户反馈"上方弹窗只显示
    // 队伍里的信息，其余NPC的任何信息不会显示"），但全局节流 3 秒防刷屏
    if (n.party) {
        log(sv, `${n.name} 死亡（${reason}）`, '#FF8866');
    } else {
        const _now = sv.now || 0;
        if ((sv._npcDeathLogAt || 0) + 3 <= _now) {
            sv._npcDeathLogAt = _now;
            log(sv, `${n.name} 死亡（${reason}）`, '#FF8866');
        }
    }
    sv.effects.push({ kind: 'dead', x: n.x, y: n.y, life: 0.6, maxLife: 0.6, label: n.name });
    AudioSystem.playZombieDie && AudioSystem.playZombieDie();
    // 2026-08-17 所有NPC死亡都生成尸体（可搜索遗物、可尸变）：
    // 此前只有队友（n.party）才生成尸体，敌对/中立NPC死亡直接消失无掉落。
    // 现在统一：任何NPC死亡 → 生成尸体（_corpse）→ 可搜索背包物品 → 倒计时后尸变。
    if (!n._corpse) {
        n._corpse = true;
        n._corpseDay = sv.day;
        n._corpseAtReal = sv.now != null ? sv.now : 0;
        n._corpseContents = [];
        for (const s of n.inv || []) {
            if (!s) continue;
            n._corpseContents.push({ ...s, n: s.n || 1 });
        }
        n._corpseSearched = false;
    }
    if (n.party) {
        // 2026-08-17 v4.23 用户定稿："倒地后死亡不会立刻移除队伍成员列表，而是该成员完全尸变后，才会移除成员列表"
        // —— 把 n.party=false 推迟到 _revived=true（尸变完成）时。drawTeamPanel 用 n.party + n._bodyLeft 过滤；
        // 队友处于"待尸变尸体"状态时仍显示在队伍面板（带「尸」徽标 + 灰色血条），并有屏幕外指引（v4.21 已覆盖 downed）。
        // 控制权：若主控死了，强制切到其他活着的 party 队友（不切到尸体）。
        const alive = sv.npcs.filter(m => m.alive && m.party && m.id !== n.id);
        if (sv.controllerId && sv.controllerId === n.id && alive.length >= 1) {
            switchControl(sv, alive[0].id, true);
        }
        // n.party 保持 true，由 updateCorpseRevive 真正尸变完成时再 n.party=false（避免尸体 UI 立即消失）
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
    if (!tgt || !tgt.alive || !tgt.party) return false;
    if (!force && (sv._switchCd || 0) > 0) {
        const left = Math.ceil((sv._switchCd || 0) / 3600);
        log(sv, `切换冷却中：还需 ${left} 小时`, '#FFB347');
        return false;
    }
    const cur = controlledNpc(sv);
    // 当前主控状态写回记录（它留在世界里，继续由 AI 行动）
    if (cur) {
        cur.x = sv.px; cur.y = sv.py;
        // 2026-08-17 v4.18 修复"切队友视角后原主控直接死亡"：
        // onDeath 将主控记录标 downed 且 hp=1，但 sv.hp 仍是触发 onDeath 时的 0；
        // 原 `cur.hp = sv.hp` 把记录血覆盖回 0 → 记录"活着但 hp=0"（脏状态）→ 恶意NPC/僵尸
        // 攻击判定 hp<=0 且已 downed → killNpc → 原主控"直接死亡+3分钟尸变"（用户反馈）。
        // 修复：濒死（downed）角色写回时不清血（保留 ≥1）；正常切换照旧写回。
        cur.hp = cur.downed ? Math.max(1, cur.hp || 1) : sv.hp;
        cur.food = sv.food; cur.water = sv.water;
        cur.inv = sv.inv; cur.look = sv.character || cur.look; cur.wpn = sv.wpn;
        cur.maxHp = sv.maxHp;
        // v4.28 修复"切视角后感染/疾病丢失"：主控侧 sv.infection/sv._sick 必须写回记录，
        // 否则切走再切回（或切到他人）时该角色的感染/疾病归零（用户反馈"救起来 debuff 被清"——
        // 实际是被咬的感染存 sv.infection，切视角没同步回 n.infection，队友记录一直是 0）。
        cur.infection = sv.infection || 0;
        cur.sick = sv._sick || null;
        cur.stamina = sv.stamina != null ? sv.stamina : cur.stamina;
        cur.exhausted = !!sv.exhausted;
    }
    // 载入目标
    sv.px = tgt.x; sv.py = tgt.y;
    sv.hp = Math.max(1, tgt.hp); sv.food = tgt.food; sv.water = tgt.water;
    // v4.21 背包格子统一：切主控时把目标 NPC 背包补齐到 BAG_SIZE(24) 格，
    // 否则 `sv.inv = tgt.inv` 引用的是 2~4 格的 NPC 背包 → 新主控背包格子数不统一（用户反馈）。
    sv.inv = tgt.inv = normBag(tgt.inv);
    sv.character = tgt.look;
    sv.wpn = tgt.wpn || freshWpn();
    sv.maxHp = tgt.maxHp || sv.maxHp;
    // v4.28 同步目标记录的感染/疾病/体力到主控侧（与写回对称）——切视角不丢 debuff
    sv.infection = tgt.infection || 0;
    sv._sick = tgt.sick || null;
    sv.stamina = tgt.stamina != null ? tgt.stamina : sv.stamina;
    sv.exhausted = !!tgt.exhausted;
    sv.controllerId = id;
    sv._switchCd = SWITCH_CD;
    // v4.52 室内/楼层继承：原主控在室内时，若新主控也在该房间（inInterior+interiorKey 匹配）→
    // 继承室内并切到新主控所在楼层（如旧主控在 3 楼、新主控在 1 楼 → 玩家到 1 楼，但仍在室内，
    // 不会"跳到室外"）；若新主控不在该房间 → 退出室内（玩家随新主控到室外其位置）。
    // 解决用户反馈"主控室内3楼死亡切队友，队友视角直接跑到1楼"——正确行为是切到队友所在楼层
    // （仍显示"1楼"室内画面），而不是跳到室外。
    if (sv.interior) {
        const _it = sv.interior;
        const _tgtIn = tgt.inInterior === true && tgt.interiorKey === _it.key;
        if (_tgtIn) {
            tgt.inInterior = true; tgt.interiorKey = _it.key;
            const _tgtFloor = tgt.interiorFloor == null ? 1 : tgt.interiorFloor;
            tgt.interiorFloor = _tgtFloor;
            _it.floor = _tgtFloor;   // 相机/交互目标切到新主控所在楼层
            sv.px = tgt.x; sv.py = tgt.y;
        } else {
            sv.interior = null;
        }
    }
    log(sv, `现在操控 ${tgt.isPlayer ? '幸存者' : tgt.name}`, '#2EE6C0');
    return true;
}

// 主控死亡：有队友自动切换视角；否则返回 false（走正常死亡流程）
export function onControlledDeath(sv) {
    const cur = controlledNpc(sv);
    if (cur) { cur.alive = false; cur.hp = 0; }
    const alive = sv.npcs.filter(n => n.alive && n.party);
    if (alive.length >= 1) {
        switchControl(sv, alive[0].id, true);
        log(sv, `${alive[0].isPlayer ? '幸存者' : alive[0].name} 接过了控制权`, '#2EE6C0');
        return true;
    }
    return false;
}

// ---------- 序列化（存档精简，临时字段不落盘） ----------
export function serializeNpcs(sv) {
    return {
        people: (sv.npcs || []).filter(n => n.alive).map(n => ({   // 死尸不落盘（帧边界已移除，双保险）
            id: n.id, isPlayer: !!n.isPlayer, name: n.name, role: n.role, look: n.look,
            x: n.x, y: n.y, hp: n.hp, maxHp: n.maxHp, food: n.food, water: n.water,
            dmg: n.dmg, wpnKey: n.wpnKey, wpnName: n.wpnName, inv: n.inv, wpn: n.wpn,
            coins: n.coins || 0, sick: n.sick || null,
            attrs: n.attrs || null, talent: n.talent || null, congenital: n.congenital || null,
            act: n.act || null,
            bornDay: n.bornDay, alive: n.alive,
            party: n.party, hired: n.hired, hireFee: n.hireFee, state: n.state,
            campId: n.campId || null,
            riding: !!n.riding,   // 骑乘状态（乘车中读档须还原，否则下车）
            workLog: n.workLog, _paidDay: n._paidDay, age: n.age, _grown: n._grown,
            // v4.28 感染/疾病必须落盘：否则读档后 NPC 的感染/疾病全丢（用户反馈"救起来 debuff 被清"——
            // 实际是存档没保存，读档后 n.infection 归 0）
            infection: n.infection || 0, sick: n.sick || null,
        })),
        controllerId: sv.controllerId || null,
        camp: sv.camp || null,
    };
}
export function restoreNpcs(sv, data) {
    if (!data) { sv.npcs = []; sv.camp = null; return; }
    sv.npcs = (data.people || []).map(p => ({ ...p, atkCd: 0, hurtT: 0, idleT: 0, workT: 0, campTask: null, _nextNeed: 2 }));
    sv.controllerId = data.controllerId || null;
    sv.camp = data.camp || null;   // 营地由领地旗帜确立，开局没有
    initRoster(sv);   // 旧档无 isPlayer 记录：自动补原主角记录
}

// 读档后把主控记录的状态载入 sv.*（位置/血量/背包/武器/外观）
export function applyControlled(sv) {
    const cur = sv.npcs.find(n => n.id === sv.controllerId);
    if (!cur) { sv.controllerId = 'player'; initRoster(sv); }
    const c = sv.npcs.find(n => n.id === sv.controllerId);
    if (!c) return;
    sv.px = c.x; sv.py = c.y;
    sv.hp = Math.max(1, c.hp); sv.food = c.food; sv.water = c.water;
    // v4.21 背包格子统一：读档载入主控时把其背包补齐到 BAG_SIZE(24) 格（与 makeNpc/switchControl 一致）
    sv.inv = c.inv = normBag(c.inv); sv.character = c.look; sv.wpn = c.wpn || freshWpn();
    sv.maxHp = c.maxHp || sv.maxHp;
    sv._sick = c.sick || null;
    sv.infection = c.infection || 0;   // v4.28 读档载入主控感染（此前漏同步 → 读档后主控感染归 0）
}
