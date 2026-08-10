// ============================================================
// 【无尽植僵荒原】模组 · 武器系统（完整移植本体 systems/combat.js 攻击逻辑）
// 半自动点射 / 全自动按住 / R 换弹 / 弓箭蓄力 / 近战挥砍弧·长矛突刺 /
// 枪口特效 / 射程衰减 / 穿透 / 狙击开镜——数值全部引用本体 WEAPONS 表。
// 大世界僵尸防具血量已并入总血量，穿甲系数无需分层结算。
// ============================================================

import { WEAPONS } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import { saveData } from '../core/state.js';
import { spendStamina } from './waction.js';
import { getTile, setTile, isWalk, T } from './world.js';
import { TS } from './wconst.js';
import { hurtPlant } from './wplants.js';
import { damageObstacle } from './wbuild.js';
import * as Panel from './panel.js';
import * as B from './wbalance.js';
import * as MSG from './wmsg.js';
import { killNpc, maybeWound, controlledNpc, addAct } from './wnpc.js';

// 攻击/射击原点在角色高度上的偏移（px）。
// 角色 sprite 渲染高度 = 48（TARGET_H），脚底对齐 sv.py，身体中部约 24、持武器的手部约 30。
// 子弹/枪口/瞄准角度都以此"手部高度"为原点，避免从人物脚底下方打出、位置不居中。
export const SHOT_ORIGIN_Y = 26;

function devDmg(sv, base) {
    if (!saveData.devMode) return base;
    if (sv._devOneShot) return 9999999;
    return Math.round(base * (sv._devDmgMul || 1));
}

// 铁门正面减伤：仅"站定蓄力举盾"时减伤；移动追击时正常受伤（可放风筝攻击）
function doorFront(z, srcAng) {
    if (z.type !== 'door') return 1;
    if (z.atkState !== 'windup') return 1;
    let d = srcAng - (z.faceDir || 0);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) < B.Z_DOOR_FRONT_ANGLE ? B.Z_DOOR_FRONT_MUL : 1;
}

// 开发者无限弹药：弹匣始终满，不消耗
function devInfAmmo(sv) { return saveData.devMode && !!sv._devInfAmmo; }

// 联机动作音效上报：本端已播，outbox 带 snd 名让对端也播（双端体验一致）
function mpSfx(sv, snd, extra) {
    if (sv && sv.mp && (sv.mp.role === 'host' || sv.mp.role === 'guest')) {
        (sv.mpOutbox = sv.mpOutbox || []).push(Object.assign({ type: 'sfx', snd }, extra || null));
    }
}

// 僵尸受击音：按类型选（铁桶/路障→护甲受击音，普通→受击音），与本体一致，不用啃咬音
export function zombieHitSound(sv, z) {
    if (z.type === 'bucket') AudioSystem.playBucketHurt();
    else if (z.type === 'cone') AudioSystem.playArmoredHurt();
    else AudioSystem.playHit();
    mpSfx(sv, 'zhit', { z: z.type });   // 联机：对端也听到受击音
}

// ---------- 装备槽（装备标记 eq 存在背包物品上，随物品移动/入档） ----------
export function equipped(sv, slot) {
    for (const s of sv.inv) if (s && s.eq === slot) return s.id.slice(4);
    return null;
}

export function wpnDef(sv, slot) {
    const k = equipped(sv, slot);
    return k ? WEAPONS[k] : null;
}

// ---------- 激活槽位（对齐本体 currentWeapon：近战/远程二选一，X 切换） ----------
export function activeSlot(sv) {
    const want = sv.curSlot;
    if (want === 'ranged' && equipped(sv, 'ranged')) return 'ranged';
    if (want === 'melee') return 'melee';           // 近战恒有效（空手=拳头）
    if (equipped(sv, 'ranged')) return 'ranged';
    return 'melee';
}

// X：近战/远程槽切换（对齐本体 mpSwapWeaponSlots/单机切枪）
export function swapSlot(sv) {
    const cur = activeSlot(sv);
    // 切近战恒可用（没装备近战 = 空手拳头），避免远程打空后无法切回近战
    const next = cur === 'melee'
        ? (equipped(sv, 'ranged') ? 'ranged' : null)
        : 'melee';
    if (!next) return { msg: '另一槽位没有武器' };
    sv.curSlot = next;
    sv.wpn.reloading = 0;
    if (sv.wpn.charging) { sv.wpn.charging = false; sv.wpn.chargeT = 0; AudioSystem.stopBowCharge(); }
    sv.aiming = false;
    sv.mouseDown = false;
    if (next === 'ranged') syncMag(sv);
    const w = WEAPONS[equipped(sv, next)];
    AudioSystem.playClick();
    return { ok: true, msg: `切换到 ${w ? w.name : '拳头'}` };
}

// 射击模式：未设置过时读武器表 defaultMode（与单机一致，冲锋枪/步枪默认全自动）
export function modeOf(sv, k) {
    if (!sv.wpn.fireMode[k]) {
        const w = WEAPONS[k];
        sv.wpn.fireMode[k] = (w && w.defaultMode) || 'semi';
    }
    return sv.wpn.fireMode[k];
}

// 背包里某弹种总量
function ammoCount(sv, ammoType) {
    let n = 0;
    for (const s of sv.inv) if (s && s.id === 'ammo:' + ammoType) n += s.n;
    return n;
}

// 从背包扣弹药，返回实际扣到的数量
function takeAmmo(sv, ammoType, need) {
    let left = need;
    for (let i = 0; i < sv.inv.length && left > 0; i++) {
        const s = sv.inv[i];
        if (!s || s.id !== 'ammo:' + ammoType) continue;
        const take = Math.min(s.n, left);
        s.n -= take; left -= take;
        if (s.n <= 0) sv.inv[i] = null;
    }
    return need - left;
}

// 攻击角度：朝鼠标世界坐标；鼠标在画布外用面向（移植单机 getAttackAngle）
// 以手部高度（sv.py - SHOT_ORIGIN_Y）为原点，保证弹道/特效从人物身体中部发出而非脚底
function attackAngle(sv) {
    if (sv.mouse && sv.mouse.inside) {
        return Math.atan2(sv.camY + sv.mouse.y - (sv.py - SHOT_ORIGIN_Y), sv.camX + sv.mouse.x - sv.px);
    }
    return Math.atan2(sv.faceY, sv.faceX);
}

// ---------- 每帧推进：冷却/换弹/蓄力/开镜校验/全自动连发 ----------
export function updateWeapon(sv, dt) {
    const wpn = sv.wpn;
    if (wpn.cooldown > 0) wpn.cooldown -= dt;
    if (wpn.reloading > 0) {
        wpn.reloading -= dt;
        if (wpn.reloading <= 0) finishReload(sv);
    }
    if (wpn.charging) {
        const w = WEAPONS[equipped(sv, 'ranged')];
        wpn.chargeT = Math.min(w ? w.maxCharge || 1 : 1, wpn.chargeT + dt);
    }
    // 开镜状态校验：未装备带镜武器时自动关镜（移植单机切武器关镜规则）
    if (sv.aiming) {
        const k = equipped(sv, 'ranged');
        const w = k ? WEAPONS[k] : null;
        if (!w || !w.scope) sv.aiming = false;
    }
    // 全自动：按住左键连发（与单机一致，射速用武器 autoInterval）
    if (sv.mouseDown && !wpn.charging && wpn.reloading <= 0 && wpn.cooldown <= 0) {
        const k = equipped(sv, 'ranged');
        const w = k ? WEAPONS[k] : null;
        if (w && !w.chargeable && w.modes && w.modes.includes('auto') && modeOf(sv, k) === 'auto') {
            tryFire(sv);
        }
    }
}

// ---------- 近战（J；左键在未装备远程时等同 J；无装备用拳头） ----------
// 判定完整移植 combat.js：突刺(thrust)走直线窄条，其余走扇形弧
export function meleeAttack(sv) {
    const wpn = sv.wpn;
    if (wpn.cooldown > 0 || wpn.reloading > 0) return {};
    const k = equipped(sv, 'melee') || 'fist';
    const w = WEAPONS[k] || WEAPONS.fist;
    // 武器耐久：损坏的近战不能使用
    const mdur = weaponDurInfo(sv, 'melee');
    if (mdur && mdur.broken) return { msg: '武器已损坏，需要修理（扳手+零件）' };
    if (!spendStamina(sv, w.stamina || 0)) return { msg: '体力不足，稍作休息' };

    const angle = attackAngle(sv);
    wpn.cooldown = w.fireInterval || 0.35;
    sv.swingT = 0.22;
    sv.swingDir = angle;
    sv.swingWeapon = k;
    AudioSystem.playWeaponSwing(k);
    mpSfx(sv, 'swing', { w: k });   // 联机：对端也听到挥砍声

    const style = w.attackStyle || 'slash';
    const reach = (w.reach || 40) + 8;
    const atkMul = sv._atkMul || 1;   // 力量/年龄阶段加成
    // 2026-08-09 修复"僵尸贴太近打不到"：目标中心越过玩家中心时 atan2 方向反转（delta≈180°），
    // 扇形判定永远不中。极近距离（目标与玩家中心重叠/紧贴，dist ≤ 15px）时忽略角度限制直接命中——
    // 视觉上已贴在一起，挥拳/挥剑理应打到。
    const CLOSE_HIT = 15;
    // 2026-08-10 用户定稿：只有墙阻挡近战攻击（其余物体不阻挡）。
    // 命中前做视线检查：玩家与目标连线经过墙格（室内 IT.WALL=1 / 室外 T.WALL）则打不到。
    const wallBlocked = (x0, y0, x1, y1) => {
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
    };
    let hitAny = false;
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        const dx = z.x - sv.px, dy = z.y - sv.py;
        let hit = false;
        if (style === 'thrust') {
            // 长矛突刺：僵尸到攻击方向线的垂直距离足够近，且沿线距离不超 reach
            const along = dx * Math.cos(angle) + dy * Math.sin(angle);
            const perp = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
            if (along >= 0 && along <= reach && perp < 24) hit = true;
        } else {
            // 挥砍/直刺/重劈：扇形判定（弧宽由武器 arc 决定）
            const dist = Math.hypot(dx, dy);
            if (dist > reach) continue;
            // 极近距离：中心重叠/紧贴 → 直接命中（不因角度反转而打空）
            if (dist <= CLOSE_HIT) { hit = true; }
            else {
                let delta = Math.atan2(dy, dx) - angle;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                if (Math.abs(delta) <= (w.arc || Math.PI) / 2) hit = true;
            }
        }
        if (hit) {
            // 只有墙阻挡近战：玩家与目标之间隔墙则打不到
            if (wallBlocked(sv.px, sv.py, z.x, z.y)) continue;
            // 联机 guest 室外：不本地扣血（host 权威），命中上报 atk 由 host 判定；
            // 联机 guest 室内：室内各自独立（host 不在同一空间无法权威判定）→ 走本地扣血
            if (sv.mp && sv.mp.role === 'guest' && !sv.interior) {
                // 带上武器 key：host 按各武器真实判定范围（reach+8）裁决命中
                (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'atk', x: sv.px, y: sv.py, melee: true, wkey: k, dmg: devDmg(sv, w.damage) * atkMul });
                hitAny = true;
                zombieHitSound(sv, z);
                continue;
            }
            const df = doorFront(z, Math.atan2(sv.py - z.y, sv.px - z.x));
            z.hp -= devDmg(sv, w.damage) * df * atkMul;
            z.hurt = 0.12;
            hitAny = true;
            zombieHitSound(sv, z);
            if (df < 1) sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.2, maxLife: 0.2, label: '挡' });
        }
    }
    // 近战命中恶意 NPC（同一扇形判定；联机 guest 室外不本地扣血，由 host 按 atk 裁决）
    if (sv.npcs && !(sv.mp && sv.mp.role === 'guest' && !sv.interior)) {
        for (const n of sv.npcs) {
            if (!n.alive || n.role !== 'hostile') continue;
            const dx = n.x - sv.px, dy = n.y - sv.py;
            const dist = Math.hypot(dx, dy);
            if (dist > reach) continue;
            // 极近距离直接命中（同僵尸判定：目标中心重叠/紧贴时不因角度反转而打空）
            const npcHit = dist <= CLOSE_HIT || (() => {
                let delta = Math.atan2(dy, dx) - angle;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                return Math.abs(delta) <= (w.arc || Math.PI) / 2;
            })();
            if (npcHit) {
                if (wallBlocked(sv.px, sv.py, n.x, n.y)) continue;   // 只有墙阻挡近战
                n.hp -= devDmg(sv, w.damage) * atkMul;
                n.hurtT = 0.12;
                hitAny = true;
                maybeWound(sv, n);
                if (n.hp <= 0) killNpc(sv, n, '被击杀');
            }
        }
    }
    if (hitAny) addAct(sv, controlledNpc(sv), 'melee');   // 后天培养：近战练力量
    if (hitAny) sv._combatT = 4;   // 玩家出手 → 队友支援
    // 2026-08-09 用户要求：近战对空气砍不消耗耐久（修复挥空也 -1 的 bug）
    // 只在命中目标（僵尸/敌对 NPC/植物）时才扣武器耐久——挥空属无效操作不该损耗武器。
    if (hitAny) wearWeapon(sv, 'melee');
    // 近战命中植物（中立/培养）
    const pgx = Math.floor((sv.px + Math.cos(angle) * reach * 0.7) / TS);
    const pgy = Math.floor((sv.py + Math.sin(angle) * reach * 0.7) / TS);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = pgx + dx, ty = pgy + dy;
        const tile = getTile(sv, tx, ty);
        if (tile === T.SPROUT || tile === T.PLOT) {
            hurtPlant(sv, tx, ty, devDmg(sv, w.damage));
            hitAny = true;
        } else if (tile === T.WEED) {
            setTile(sv, tx, ty, T.GROUND);
            sv.effects.push({ kind: 'hit', x: (tx + 0.5) * TS, y: (ty + 0.5) * TS, life: 0.2, maxLife: 0.2, label: '艹' });
            const wr = Math.random();
            if (wr < 0.08) {
                const common = ['seed:peashooter', 'seed:sunflower'];
                Panel.addItem(sv, common[Math.floor(Math.random() * common.length)], 1);
            } else if (wr < 0.12) {
                const rare = ['seed:snowpea', 'seed:repeater'];
                Panel.addItem(sv, rare[Math.floor(Math.random() * rare.length)], 1);
            } else if (wr < 0.13) {
                Panel.addItem(sv, 'seed:chomper', 1);
            }
        } else if (tile === T.BARRICADE || tile === T.CAR || tile === T.CARWRECK) {
            if (damageObstacle(sv, tx, ty, devDmg(sv, w.damage))) hitAny = true;
        }
    }
    return { ok: true, hit: hitAny };
}

// ---------- 远程开火（半自动点射 / 全自动按住；弓箭由 releaseBow 放箭） ----------
export function tryFire(sv, charge = 1) {
    const wpn = sv.wpn;
    const k = equipped(sv, 'ranged');
    if (!k) return { msg: '没有装备远程武器（背包里点击武器装备）' };
    const w = WEAPONS[k];
    if (!w) return { msg: '武器数据缺失' };
    // 武器耐久：损坏的远程武器无法射击
    const rdur = weaponDurInfo(sv, 'ranged');
    if (rdur && rdur.broken) return { msg: '武器已损坏，需要修理（扳手+零件）' };
    if (wpn.cooldown > 0) return {};
    if (wpn.reloading > 0) return { msg: '换弹中...' };
    const infAmmo = devInfAmmo(sv);
    if (!infAmmo && (wpn.mag[k] || 0) <= 0) return { msg: '弹匣已空，按 R 换弹' };
    if (!spendStamina(sv, w.stamina || 0)) return { msg: '体力不足，稍作休息' };

    const angle = attackAngle(sv);
    // 移植 combat.js：开镜大幅降低散射（aimFactor）；蓄力提升伤害与弹速
    const pellets = w.pellets || 1;
    const spread = (w.spread || 0) * (sv.aiming ? (w.aimFactor ?? 0.35) : 1);
    const spdMul = w.chargeable ? (0.7 + 0.5 * charge) : 1;
    for (let i = 0; i < pellets; i++) {
        const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5);
        const a = angle + t * spread;
        sv.bullets.push({
            id: 'b' + ((sv._bIdSeq = (sv._bIdSeq || 0) + 1)),   // 运行时 id：联机子弹同步去重用
            // 从手部高度发射（原 sv.py 为脚底，导致子弹从人物下方打出）
            x: sv.px + Math.cos(a) * 22, y: (sv.py - SHOT_ORIGIN_Y) + Math.sin(a) * 22,
            vx: Math.cos(a) * w.bulletSpeed * spdMul, vy: Math.sin(a) * w.bulletSpeed * spdMul,
            damage: devDmg(sv, Math.round(w.damage * charge)),
            color: w.color, label: w.bulletLabel || '·',
            life: 1.2, range: w.range || 9999,
            pierce: w.pierce || 0, pierced: 0, hitList: null,
            spin: !!w.spin, traveled: 0,
        });
    }
    if (!infAmmo) wpn.mag[k]--;
    // 全自动模式用专属射速（如步枪 autoInterval 0.12s，与单机一致）
    const iv = (modeOf(sv, k) === 'auto' && w.autoInterval) ? w.autoInterval : (w.fireInterval || 0.4);
    wpn.cooldown = iv;
    // 枪口特效（移植单机：短促拟声字残影，方向与子弹一致）
    sv.effects.push({
        kind: 'muzzle',
        x: sv.px + Math.cos(angle) * 26, y: (sv.py - SHOT_ORIGIN_Y) + Math.sin(angle) * 26,
        angle, color: w.color,
        label: { pistol: '砰', smg: '砰', rifle: '砰', shotgun: '轰', sniper: '轰', bow: '嗖', knife: '嗖' }[k] || '砰',
        ghosts: (k === 'shotgun' || k === 'sniper') ? 2 : 1,
        life: 0.12, maxLife: 0.12,
    });
    // 联机：guest 的弹幕特效上报 host（host 的 effects 已进 wsync，guest 的没发）
    if (sv.mp && sv.mp.role === 'guest') {
        (sv.mpOutbox = sv.mpOutbox || []).push({
            type: 'fx', kind: 'muzzle',
            x: sv.px + Math.cos(angle) * 26, y: (sv.py - SHOT_ORIGIN_Y) + Math.sin(angle) * 26,
            angle, color: w.color, label: { pistol: '砰', smg: '砰', rifle: '砰', shotgun: '轰', sniper: '轰', bow: '嗖', knife: '嗖' }[k] || '砰',
            ghosts: (k === 'shotgun' || k === 'sniper') ? 2 : 1,
        });
    }
    if (k === 'bow') AudioSystem.playBowFire();
    else AudioSystem.playWeaponShot(k, iv);
    mpSfx(sv, 'shot', { w: k, iv, bow: k === 'bow' });   // 联机：对端也听到枪声/弓声
    sv._combatT = 4;   // 玩家射击 → 队友支援
    wearWeapon(sv, 'ranged');   // 武器耐久：每次射击 -1
    return { ok: true };
}

// ---------- 弓箭：按住蓄力（最短 0.25s，力度影响伤害弹速；移植单机） ----------
export function startCharge(sv) {
    const k = equipped(sv, 'ranged');
    const w = k ? WEAPONS[k] : null;
    if (!w || !w.chargeable) return false;
    if (sv.wpn.reloading > 0) return false;
    if (!devInfAmmo(sv) && (sv.wpn.mag[k] || 0) <= 0) return false;
    sv.wpn.charging = true;
    sv.wpn.chargeT = 0;
    if (k === 'bow') AudioSystem.playBowCharge();
    return true;
}

export function releaseBow(sv) {
    const wpn = sv.wpn;
    if (!wpn.charging) return {};
    const k = equipped(sv, 'ranged');
    const w = k ? WEAPONS[k] : null;
    const chargeT = wpn.chargeT;
    wpn.charging = false;
    wpn.chargeT = 0;
    AudioSystem.stopBowCharge();
    if (chargeT < 0.25) return { msg: '蓄力不足，按住左键拉弓' };
    const charge = 0.4 + Math.min(1, chargeT / (w ? w.maxCharge || 1 : 1)) * 1.1;
    return tryFire(sv, charge);
}

// ---------- 换弹（R；时长读武器表 reloadTime，从背包弹种补充，与单机一致） ----------
export function startReload(sv) {
    const wpn = sv.wpn;
    const k = equipped(sv, 'ranged');
    if (!k) return { msg: '没有装备远程武器' };
    const w = WEAPONS[k];
    if (!w || !w.magSize) return { msg: '该武器无需换弹' };
    if (wpn.reloading > 0) return {};
    const cur = wpn.mag[k] || 0;
    if (cur >= w.magSize) return { msg: '弹匣已满' };
    if (devInfAmmo(sv)) { wpn.mag[k] = w.magSize; return { ok: true, msg: '无限弹药：弹匣已满' }; }
    if (ammoCount(sv, w.ammoType) <= 0) return { msg: `没有弹药（${w.ammoLabel || w.ammoType}）` };
    wpn.reloading = w.reloadTime || 1.5;
    AudioSystem.playWeaponReload(k);
    mpSfx(sv, 'reload', { w: k });   // 联机：对端也听到换弹声
    return { ok: true, msg: '换弹中...' };
}

function finishReload(sv) {
    const wpn = sv.wpn;
    const k = equipped(sv, 'ranged');
    const w = k ? WEAPONS[k] : null;
    if (!w) return;
    const need = w.magSize - (wpn.mag[k] || 0);
    wpn.mag[k] = (wpn.mag[k] || 0) + takeAmmo(sv, w.ammoType, need);
}

// 首次装备远程武器自动装填（消耗背包弹药）
export function syncMag(sv) {
    const k = equipped(sv, 'ranged');
    if (!k) return;
    const w = WEAPONS[k];
    if (!w || !w.magSize) return;
    if (devInfAmmo(sv)) { sv.wpn.mag[k] = w.magSize; return; }
    if (sv.wpn.mag[k] == null) {
        sv.wpn.mag[k] = takeAmmo(sv, w.ammoType, w.magSize);
    }
}

// ---------- 射击模式（V：作用于当前激活武器，对齐本体） ----------
export function toggleFireMode(sv) {
    const k = equipped(sv, activeSlot(sv));
    const w = k ? WEAPONS[k] : null;
    if (!w || w.kind !== 'ranged' || !w.modes || w.modes.length < 2) return { msg: '该武器不支持切换射击模式' };
    sv.wpn.fireMode[k] = modeOf(sv, k) === 'auto' ? 'semi' : 'auto';
    AudioSystem.playClick();
    return { ok: true, msg: `射击模式：${sv.wpn.fireMode[k] === 'auto' ? '全自动' : '半自动'}` };
}

// ---------- 狙击开镜（右键：作用于当前激活武器，对齐本体） ----------
export function toggleScope(sv) {
    const k = equipped(sv, activeSlot(sv));
    const w = k ? WEAPONS[k] : null;
    if (!w || !w.scope) return { msg: '当前武器没有瞄准镜（仅狙击枪）' };
    sv.aiming = !sv.aiming;
    AudioSystem.playClick();
    return { ok: true, msg: sv.aiming ? '开镜瞄准：散射大幅降低，移动减慢' : '关闭瞄准镜' };
}

// ---------- 子弹飞行与命中（移植 combat.js：射程衰减至 40% 保底 + 穿透名单） ----------
export function updateBullets(sv, dt) {
    // 子弹硬上限（L10）：收敛逻辑（寿命/射程/命中）正常时有界，但自动武器+散弹多弹丸
    // 瞬时量可能很大——超限丢最旧，防极端场景每帧数组膨胀
    if (sv.bullets.length > 80) sv.bullets.splice(0, sv.bullets.length - 80);
    for (let i = sv.bullets.length - 1; i >= 0; i--) {
        const b = sv.bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.traveled += Math.hypot(b.vx, b.vy) * dt;
        let dead = false;

        // 生命到期 / 超出衰减飞行上限（2 倍有效射程后消亡）
        if (b.life != null) { b.life -= dt; if (b.life <= 0) dead = true; }
        if (!dead && b.traveled >= (b.range || 9999) * 2) dead = true;

        // 墙体/树木/水面阻挡；命中植物则造成伤害。
        // 2026-08-10 用户定稿：室内【只有墙阻挡子弹】——容器/碎石/绿植等不阻挡（可穿透），
        // 子弹坐标为室内局部坐标，直接用 sv.interior.tiles 判定，不走世界 getTile。
        if (!dead && !b.srcPlant) {
            if (sv.interior) {
                const it = sv.interior;
                const gx = Math.floor(b.x / TS), gy = Math.floor(b.y / TS);
                if (gx >= 0 && gx < it.w && gy >= 0 && gy < it.h) {
                    const t = it.tiles[gy * it.w + gx];
                    if (t === 1) dead = true;   // IT.WALL = 1：仅墙阻挡，其余穿透
                }
            } else {
                const gx = Math.floor(b.x / TS), gy = Math.floor(b.y / TS);
                const tile = getTile(sv, gx, gy);
                if ((tile === T.SPROUT || tile === T.PLOT)) {
                    hurtPlant(sv, gx, gy, b.damage);
                    sv.effects.push({ kind: 'hit', x: b.x, y: b.y, life: 0.15, maxLife: 0.15 });
                    dead = true;
                } else if (!isWalk(tile)) {
                    dead = true;
                }
            }
        } else if (!dead && b.srcPlant) {
            const gx = Math.floor(b.x / TS), gy = Math.floor(b.y / TS);
            if (!isWalk(getTile(sv, gx, gy)) && getTile(sv, gx, gy) !== T.SPROUT && getTile(sv, gx, gy) !== T.PLOT) dead = true;
        }

        // 命中僵尸（取最近；穿透名单不重复打同一只）
        if (!dead) {
            let hit = null, bestDist = 18;
            for (const z of sv.zombies) {
                if (z.hp <= 0) continue;
                if (b.hitList && b.hitList.includes(z)) continue;
                const d = Math.hypot(z.x - b.x, z.y - b.y);
                if (d < bestDist) { bestDist = d; hit = z; }
            }
            if (hit) {
                // 联机 guest 室外：不本地扣血（host 权威），上报 atk 由 host 判定；
                // 联机 guest 室内：各自独立 → 走本地扣血（与单机一致）
                // b._mpHost 的子弹是 host 同步来的（host 已在其本地判定命中扣血）——guest 端
                // 只播特效不上报，否则 host 对同一发子弹双倍扣血（高危 #4）
                if (sv.mp && sv.mp.role === 'guest' && !sv.interior && !b._mpHost) {
                    // px/py = 攻击者位置（3+ 人多 guest 时 host 按此定位，避免 guestPos 串位）
                    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'atk', x: b.x, y: b.y, px: sv.px, py: sv.py, melee: false, dmg: Math.max(1, Math.round(b.damage)) });
                    sv.effects.push({ kind: 'hit', x: b.x, y: b.y, life: 0.15, maxLife: 0.15 });
                    if ((b.pierced || 0) < (b.pierce || 0)) { b.pierced++; (b.hitList = b.hitList || []).push(hit); }
                    else dead = true;
                    continue;
                }
                // 射程衰减：有效射程内满伤，超出后线性衰减至保底 40%（与单机一致）
                const rg = b.range || 9999;
                const fo = b.traveled <= rg ? 1 : Math.max(0.4, 1 - 0.6 * ((b.traveled - rg) / rg));
                // 铁门正面减伤（子弹来源方向 = 速度反向）
                const df = doorFront(hit, Math.atan2(-b.vy, -b.vx));
                hit.hp -= Math.max(1, Math.round(b.damage * fo * df * (sv._rngMul || 1)));
                hit.hurt = 0.12;
                // 寒冰射手减速（引用本体 snowpea 机制）
                if (b.slow) { hit.slowMul = b.slow; hit.slowT = b.slowDur || 3; }
                sv.effects.push({ kind: 'hit', x: b.x, y: b.y, life: 0.15, maxLife: 0.15 });
                if (df < 1) sv.effects.push({ kind: 'hit', x: hit.x, y: hit.y, life: 0.2, maxLife: 0.2, label: '挡' });
                zombieHitSound(sv, hit);
                // 穿透：未达穿透上限则穿过该僵尸继续飞行
                if ((b.pierced || 0) < (b.pierce || 0)) {
                    b.pierced++;
                    (b.hitList = b.hitList || []).push(hit);
                } else {
                    dead = true;
                }
            }
        }
        // 命中恶意 NPC（联机 guest 室外不本地扣血，由 host 按 atk 裁决；host 同步来的弹幕不再判）
        if (!dead && sv.npcs && !(sv.mp && sv.mp.role === 'guest' && !sv.interior && !b._mpHost)) {
            let nhit = null, nbest = 18;
            for (const n of sv.npcs) {
                if (!n.alive || n.role !== 'hostile') continue;
                const d = Math.hypot(n.x - b.x, n.y - b.y);
                if (d < nbest) { nbest = d; nhit = n; }
            }
            if (nhit) {
                const rg = b.range || 9999;
                const fo = b.traveled <= rg ? 1 : Math.max(0.4, 1 - 0.6 * ((b.traveled - rg) / rg));
                nhit.hp -= Math.max(1, Math.round(b.damage * fo * (sv._rngMul || 1)));
                nhit.hurtT = 0.15;
                sv.effects.push({ kind: 'hit', x: b.x, y: b.y, life: 0.15, maxLife: 0.15 });
                if (nhit.hp <= 0) killNpc(sv, nhit, '被击杀');
                dead = true;
            }
        }
        if (dead) sv.bullets.splice(i, 1);
    }
}

// ---------- HUD 显示数据 ----------
export function hudText(sv) {
    const mk = equipped(sv, 'melee');
    const rk = equipped(sv, 'ranged');
    const durTxt = slot => {
        const info = weaponDurInfo(sv, slot);
        if (!info || !info.max) return '';
        return info.broken ? '·损坏' : `·耐久 ${info.cur}/${info.max}`;
    };
    let txt = `${mk ? WEAPONS[mk].name : '拳头'}${durTxt('melee')}`;
    if (rk) {
        const w = WEAPONS[rk];
        if (devInfAmmo(sv)) txt += ` · ${w.name} ∞/∞${durTxt('ranged')}`;
        else txt += ` · ${w.name} ${sv.wpn.mag[rk] || 0}/${w.magSize} 备${ammoCount(sv, w.ammoType)}${durTxt('ranged')}`;
        if (w.modes && w.modes.length > 1) txt += modeOf(sv, rk) === 'auto' ? '·自动' : '·半自动';
        if (sv.aiming) txt += '·开镜';
    }
    return txt;
}

// ---------- 武器耐久（近战挥击/远程射击消耗；归零损坏，背包用损坏武器+扳手+零件修复） ----------
function weaponItem(sv, slot) {
    for (const s of sv.inv) if (s && s.eq === slot && String(s.id).startsWith('wpn:')) return s;
    return null;
}
export function weaponDurInfo(sv, slot) {
    const s = weaponItem(sv, slot);
    if (!s) return null;
    const max = B.WEAPON_DUR[s.id.slice(4)] || 0;
    return { cur: s.dur != null ? s.dur : max, max, broken: !!s.broken };
}
function wearWeapon(sv, slot) {
    const s = weaponItem(sv, slot);
    if (!s) return;
    const max = B.WEAPON_DUR[s.id.slice(4)] || 0;
    if (!max) return;   // 拳头/铲子等无耐久
    if (sv._devInfDura) return;   // 2026-08-09 开发者：无限耐久（武器/工具永不损坏）
    s.dur = (s.dur == null ? max : s.dur) - 1;
    if (s.dur <= 0) {
        s.dur = 0;
        s.broken = true;
        // 2026-08-09 用户要求：武器损坏【不弹修复 UI】，改为玩家头顶浮动提示
        // "XX武器损坏，去背包查看修理"。打开背包（TAB/B）可看到 broken 武器并修理。
        const name = Panel.getItemInfo(s.id).name;
        (sv.effects = sv.effects || []).push({
            kind: 'hit', x: sv.px, y: sv.py - 10,
            life: 1.4, maxLife: 1.4, label: `${name} 损坏！`,
        });
        MSG.pushMsg(sv, `${name} 损坏了，请打开背包用扳手+零件×${B.WEAPON_REPAIR_PARTS} 修理`, '#FF5544');
        AudioSystem.playHit && AudioSystem.playHit();
    }
}

export function initWpn(sv, savedMag) {
    sv.wpn = { mag: savedMag || {}, reloading: 0, charging: false, chargeT: 0, cooldown: 0, fireMode: {} };
    if (sv.stamina == null) sv.stamina = sv.maxStamina || 100;
    if (sv.maxStamina == null) sv.maxStamina = 100;
    syncMag(sv);
}
