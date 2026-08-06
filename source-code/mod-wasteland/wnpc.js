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
    if (sv.npcs.length) {
        let hasDead = false;
        for (let i = 0; i < sv.npcs.length; i++) {
            if (!sv.npcs[i].alive) { hasDead = true; break; }
        }
        if (hasDead) sv.npcs = sv.npcs.filter(n => n.alive);
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
        if (controller.sick) {
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
    if (inCamp) {
        spd *= B.CAMP_SPEED_MUL;
        if (sv.hp < sv.maxHp) sv.hp = Math.min(sv.maxHp, sv.hp + B.CAMP_HP_REGEN * dt);
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
            if (seen < n.workLog.length) {
                for (let i = n.workLog.length - 1; i >= seen; i--) log(sv, `营地工作日志：${n.workLog[i].text}`, '#FFD700');
                n._logSeen = n.workLog.length;
            }
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
    n.inv = sv.inv; n.look = sv.character || n.look;
    n.maxHp = sv.maxHp;
    n.act = sv._actCounters || n.act;
}
function syncRecordToControlled(sv, n) {
    sv.px = n.x; sv.py = n.y;
    sv.hp = Math.max(1, n.hp); sv.food = n.food; sv.water = n.water;
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

function updateNpc(sv, n, dt, canStand, camp, controller) {
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

function updateNeeds(sv, n, dt, canStand) {
    const mods = personMods(n);
    n.food = Math.max(0, n.food - 0.03 * mods.hungerMul * dt);
    n.water = Math.max(0, n.water - 0.025 * dt);
    // 病：生命持续流失；有药/草药自动服药（痢疾需同时有水）
    if (n.sick) {
        n.hp -= B.sickDrainPerSec(n.sick.type) * dt;
        if (!cureSick(sv, n, n.inv, n.water) && n.hp <= 0) { killNpc(sv, n, '病死'); return; }
    }
    if (n.hp <= 0) { killNpc(sv, n, '饿死/渴死/病死'); return; }
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
    const i = n.inv.findIndex(s => s && (s.id === 'food' || s.id === 'herb' || s.id === 'carrot' || s.id === 'corn' || s.id === 'potato'));
    if (i >= 0) { n.food = Math.min(100, n.food + 30); n.inv[i].n--; if (n.inv[i].n <= 0) n.inv.splice(i, 1); }
}
function drinkFromInv(n) {
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

// ---------- 移动（A* 寻路：目标格路径场缓存 0.4s，跨墙绕行；近距直线兜底） ----------
function moveToward(sv, n, tx, ty, dt, canStand, speedMul) {
    const dist = Math.hypot(tx - n.x, ty - n.y);
    let mvx = tx - n.x, mvy = ty - n.y;
    if (dist > TS * 1.2) {
        // 走 BFS 路径场（寻路机制与怪物一致）
        const step = pathStepTo(sv, n, Math.floor(tx / TS), Math.floor(ty / TS), canStand);
        if (step) {
            mvx = (step.x + 0.5) * TS - n.x;
            mvy = (step.y + 0.5) * TS - n.y;
        }
    }
    const d = Math.hypot(mvx, mvy) || 1;
    const spd = 95 * (speedMul || 1);
    const nx = n.x + mvx / d * spd * dt, ny = n.y + mvy / d * spd * dt;
    const okX = canStand(nx, n.y), okY = canStand(n.x, ny);
    if (okX) n.x = nx;
    if (okY) n.y = ny;
    // NPC 相互轻微排斥（L3）：多名队员跟随/围攻时避免完全重叠（canStand 只查地形不查 NPC）
    if (sv.npcs) {
        for (const o of sv.npcs) {
            if (o === n || !o.alive || o.riding) continue;
            const dxo = n.x - o.x, dyo = n.y - o.y;
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
    }
    n._path = { key, step, t: sv.now };
    return n._path.step;
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
function hostileThreat(sv, n, range) {
    let best = null, bestD = range * TS;
    const pd = Math.hypot(sv.px - n.x, sv.py - n.y);
    if (pd < bestD) { bestD = pd; best = { x: sv.px, y: sv.py, hp: sv.hp, player: true, dmg: 0 }; }
    if (sv.npcs) {
        for (const o of sv.npcs) {
            if (!o.alive || o.role === 'hostile') continue;
            if (sv.controllerId && o.id === sv.controllerId) continue;   // 主控走玩家受伤路径
            const d = Math.hypot(o.x - n.x, o.y - n.y);
            if (d < bestD) { bestD = d; best = { x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg }; }
        }
    }
    // 僵尸：恶意 NPC 与僵尸互打（谁近打谁）
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        const d = Math.hypot(z.x - n.x, z.y - n.y);
        if (d < bestD) { bestD = d; best = { x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z }; }
    }
    return best;
}

// ---------- 队伍跟随（自主战斗：攻击靠近自己或玩家的敌对生物；威胁贴身会躲避） ----------
function followAI(sv, n, dt, canStand) {
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
function nearestThreat(sv, n, selfRange, playerRange) {
    let best = null, bestD = selfRange * TS;
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        const d = Math.hypot(z.x - n.x, z.y - n.y);
        if (d < bestD) { bestD = d; best = { x: z.x, y: z.y, hp: z.hp, isZombie: true, dmg: 12, z }; }
    }
    for (const o of sv.npcs) {
        if (!o.alive || o.role !== 'hostile') continue;
        const d = Math.hypot(o.x - n.x, o.y - n.y);
        if (d < bestD) { bestD = d; best = { x: o.x, y: o.y, hp: o.hp, npc: o, dmg: o.dmg }; }
    }
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

// 战斗/躲避：返回 true 表示正在交战（不执行跟随/游荡）
// hostileMode=true：恶意 NPC 模式，威胁 = 玩家 + 非恶意 NPC，并带玩家受击逻辑
function combatThreat(sv, n, dt, canStand, selfRange, playerRange, hostileMode) {
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
    // 低血量：只逃不打（躲避保命）
    if (n.hp < n.maxHp * 0.35) {
        retreatFrom(sv, n, threat, dt, canStand, 1.2);
        return true;
    }
    // 恶意 NPC 的目标是无敌玩家：不可命中，继续追击（不进入攻击动画）
    if (threat.player && (sv._devGod || sv.invuln > 0)) {
        moveToward(sv, n, threat.x, threat.y, dt, canStand, 1.1);
        return true;
    }
    if (w && w.kind === 'ranged' && !wpnItem.broken) {
        // 远程武器：保持距离射击（消耗弹药与耐久）
        if (d < (w.range || 300) && n.atkCd <= 0) {
            if (npcAmmoCount(n, w.ammoType) > 0) {
                n.atkCd = 1.8;
                fireNpcBullet(sv, n, threat);
            } else {
                n.atkCd = 3;   // 没弹药：短暂蓄势后近身搏斗
            }
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
        if (threat.isZombie) {
            threat.z.hp -= wDef ? wDef.damage : 8;
            threat.z.hurt = 0.12;          // 僵尸受击闪白（与玩家命中一致）
            zombieHitSound(sv, threat.z);      // 受击音（铁桶/路障护甲音，与玩家一致）
        } else if (threat.player) {
            // 恶意 NPC 命中玩家：正常受击伤害 + 感染风险 + 提示（无敌/无敌帧由上方豁免）
            sv.hp = Math.max(1, sv.hp - n.dmg);
            sv.hurtT = 0.3;
            sv._combatT = 4;   // 进入交战状态，队友支援
            const c = controlledNpc(sv);
            if (c) { maybeWound(sv, c); addAct(sv, c, 'hit'); }
            addAct(sv, n, 'melee');
            if (sv._lastNpcHit !== n.id) { log(sv, `${n.name} 攻击了你！`, '#FF6644'); sv._lastNpcHit = n.id; }
        } else if (threat.npc) {
            // 恶意 NPC 打非恶意 NPC：真实扣血，可致死（含队员）
            threat.npc.hp -= wDef ? wDef.damage : 8;
        } else {
            threat.hp -= wDef ? wDef.damage : 8;
        }
        wearNpcWeapon(sv, n);
        if (threat.npc) {
            threat.npc.hurtT = 0.3;
            if (threat.npc.hp <= 0) killNpc(sv, threat.npc, '被击杀');
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
function wearNpcWeapon(sv, n) {
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
    const ang = Math.atan2(threat.y - n.y, threat.x - n.x);
    if (!sv.npcBullets) sv.npcBullets = [];
    // 与玩家 tryFire 相同的弹丸分布：pellets 多弹丸 + spread 散射
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
        const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5);
        const a = ang + t * (w.spread || 0);
        sv.npcBullets.push({
            x: n.x, y: n.y - 8,
            vx: Math.cos(a) * (w.bulletSpeed || 460), vy: Math.sin(a) * (w.bulletSpeed || 460),
            dmg: Math.max(4, w.damage),   // 与玩家同伤害
            color: w.color, label: w.bulletLabel || '·', life: 0.9, traveled: 0,
            range: w.range || 9999, pierce: w.pierce || 0, pierced: 0, hitList: null,
            hostile: n.role === 'hostile', src: n.id, srcName: n.name,
        });
    }
    npcTakeAmmo(n, w.ammoType, 1);
    wearNpcWeapon(sv, n);
    sv.effects.push({ kind: 'muzzle', x: n.x + Math.cos(ang) * 20, y: n.y + Math.sin(ang) * 20 - 8, angle: ang, color: w.color, label: '轰', ghosts: pellets > 1 ? 2 : 1, life: 0.1, maxLife: 0.1 });
}
// 更新 NPC 子弹（与玩家同规则：射程衰减 + 穿透；命中僵尸/恶意 NPC，恶意火力可打玩家）
function updateNpcBullets(sv, dt) {
    if (!sv.npcBullets || !sv.npcBullets.length) return;
    for (let i = sv.npcBullets.length - 1; i >= 0; i--) {
        const b = sv.npcBullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.traveled += Math.hypot(b.vx, b.vy) * dt;
        b.life -= dt;
        let dead = b.life <= 0;
        if (!dead) {
            let hit = null, best = 14;
            for (const z of sv.zombies) {
                if (z.hp <= 0) continue;
                if (b.hitList && b.hitList.some(h => h === z)) continue;
                const d = Math.hypot(z.x - b.x, z.y - b.y);
                if (d < best) { best = d; hit = { npc: null, z, x: z.x, y: z.y }; }
            }
            if (!hit && sv.npcs) for (const o of sv.npcs) {
                if (!o.alive || o.role !== 'hostile') continue;
                if (b.hitList && b.hitList.some(h => h === o)) continue;
                const d = Math.hypot(o.x - b.x, o.y - b.y);
                if (d < best) { best = d; hit = { npc: o, z: null, x: o.x, y: o.y }; }
            }
            // 恶意 NPC 火力命中玩家（无敌/无敌帧豁免）
            if (!hit && b.hostile) {
                const pd = Math.hypot(sv.px - b.x, sv.py - b.y);
                if (pd < 12 && !sv._devGod && sv.invuln <= 0) hit = { player: 1, x: sv.px, y: sv.py };
            }
            if (hit) {
                // 射程衰减：有效射程内满伤，超出后线性衰减至保底 40%（与玩家一致）
                const fo = b.traveled <= b.range ? 1 : Math.max(0.4, 1 - 0.6 * ((b.traveled - b.range) / b.range));
                const dmg = Math.max(1, Math.round(b.dmg * fo));
                if (hit.player) {
                    sv.hp = Math.max(1, sv.hp - dmg);
                    sv.hurtT = 0.25;
                    sv._combatT = 4;
                    const c = controlledNpc(sv);
                    if (c) { maybeWound(sv, c); addAct(sv, c, 'hit'); }
                    if (sv._lastNpcHit !== (b.src || '?')) { log(sv, `${b.srcName || '恶意分子'} 向你射击！`, '#FF6644'); sv._lastNpcHit = b.src || '?'; }
                    dead = true;
                } else if (hit.npc) {
                    hit.npc.hp -= dmg;
                    hit.npc.hurtT = 0.15;
                    if (hit.npc.hp <= 0) killNpc(sv, hit.npc, '被击杀');
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
    moveToward(sv, n, n.x + Math.cos(n.wanderDir) * 60, n.y + Math.sin(n.wanderDir) * 60, dt, canStand, 0.5);
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
    const wantDmg = n.isPlayer ? n.dmg : Math.max(4, Math.round((n.role === 'hostile' ? 14 : 10) * stage.atkMul * mods.atkMul));
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
    // 营地刷新：营地是 NPC 居住地，每日有概率来新的成年居民（有阵营归属 campId）
    if (sv.camp && sv.npcs.filter(m => m.alive).length < NPC_CAP) {
        if (Math.random() < B.CAMP_NEWCOMER_DAILY_CHANCE) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * B.CAMP_NEWCOMER_RADIUS * TS;
            const p = findWalkableNear(sv, sv.camp.x + Math.cos(a) * r, sv.camp.y + Math.sin(a) * r, 10);
            const newcomer = makeNpc(sv, p.x, p.y, Math.random() < 0.7 ? 'friendly' : 'neutral');
            newcomer.bornDay = sv.day - (20 + Math.floor(Math.random() * 15));   // 成年居民
            newcomer.state = 'camp';
            newcomer.campId = sv.camp.id || null;   // 阵营归属：投靠本营地
            sv.npcs.push(newcomer);
            log(sv, `${newcomer.name} 来到了营地，成为这里的居民`, '#FFD700');
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

export function killNpc(sv, n, reason) {
    if (!n.alive) return;
    n.alive = false;
    n.hp = 0;
    // 死亡提示只播报队员（陌生 NPC 的生老病死与我们无关，不刷屏）
    if (n.party) log(sv, `${n.name} 死亡（${reason}）`, '#FF8866');
    sv.effects.push({ kind: 'dead', x: n.x, y: n.y, life: 0.6, maxLife: 0.6, label: n.name });
    AudioSystem.playZombieDie && AudioSystem.playZombieDie();
    if (n.party) {
        n.party = false;
        // 仅剩 2 名成员且主控阵亡 → 自动切换
        const alive = sv.npcs.filter(m => m.alive && m.party);
        if (sv.controllerId && sv.controllerId === n.id && alive.length >= 1) {
            switchControl(sv, alive[0].id, true);
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
        cur.hp = sv.hp; cur.food = sv.food; cur.water = sv.water;
        cur.inv = sv.inv; cur.look = sv.character || cur.look; cur.wpn = sv.wpn;
        cur.maxHp = sv.maxHp;
    }
    // 载入目标
    sv.px = tgt.x; sv.py = tgt.y;
    sv.hp = Math.max(1, tgt.hp); sv.food = tgt.food; sv.water = tgt.water;
    sv.inv = tgt.inv; sv.character = tgt.look;
    sv.wpn = tgt.wpn || freshWpn();
    sv.maxHp = tgt.maxHp || sv.maxHp;
    sv.controllerId = id;
    sv._switchCd = SWITCH_CD;
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
    sv.inv = c.inv; sv.character = c.look; sv.wpn = c.wpn || freshWpn();
    sv.maxHp = c.maxHp || sv.maxHp;
    sv._sick = c.sick || null;
}
