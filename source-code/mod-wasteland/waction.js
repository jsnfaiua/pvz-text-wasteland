// ============================================================
// 【无尽植僵荒原】模组 · 动作系统（移植自本体 entities/player.js）
// 闪现(Q) / 格挡(E 按住) / 奔跑(Shift) / 跳跃(空格) + 体力规则
// 数值引用本体 ACTION / GRAVITY / JUMP_* 常量，手感与单机一致
// ============================================================

import { ACTION, GRAVITY, JUMP_VELOCITY, JUMP_CD } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import * as B from './wbalance.js';
import { TS } from './wconst.js';
import { rollZombieInfection, addPlayerInfection, playerInfectionStage, PLAYER_INFECTION } from './winfection.js';
import { log } from './survival.js';

const STAM_DELAY = 0.5;     // 消耗后回复延迟
const REGEN_NORMAL = 14;    // 正常回复速率 /s
const REGEN_EXHAUST = 10;   // 力竭期回复速率 /s（比正常略慢，不再久拖不动）
const GUARD_DRAIN = 8;      // 架盾持续耗体力 /s
const SPRINT_DRAIN = 6;     // 奔跑持续耗体力 /s
const DASH_COST = 8;        // 闪避消耗（2026-08-08 由闪现 12 改：短距离闪避更便宜）
const GUARD_COST = 6;       // 格挡起手消耗

// ═══ 闪避（2026-08-08 用户需求：删远距离闪现 → 短距离任意方向闪避 + 完美闪避子弹时间）═══
// 距离 = DODGE_SPEED × DODGE_DURATION；无敌帧 DODGE_INVULN；完美窗口 = 闪避开始后 _dodgePerfectWindow 内被攻击
const DODGE_SPEED = 320;    // 闪避速度(px/s) —— 原闪现 900，缩短为短距离翻滚
const DODGE_DURATION = 0.20;   // 闪避时长 —— 原 0.16 略长
const DODGE_INVULN = 0.30;     // 闪避无敌帧 —— 原 0.22 加长（更有安全感）
const DODGE_CD = 0.50;         // 闪避冷却 —— 原 0.8 更频繁
const DODGE_PERFECT_WINDOW = 0.25;  // 完美闪避窗口：闪避开始后 0.25s 内被攻击触发子弹时间
export const BULLET_TIME_DURATION = 1.2;   // 完美闪避子弹时间时长(s)
export const BULLET_TIME_SCALE = 0.2;      // 子弹时间倍速（0.2 = 5 倍慢放）

// 移动输入（WASD + 方向键，与单机一致）
export function moveInput(sv) {
    // 2026-08-09 昏迷苏醒状态：刚进入荒野时不能移动（黑灰眨眼过渡，等待醒来的感觉）
    if (sv._wake && sv._wake.t < sv._wake.dur) return { mx: 0, my: 0 };
    let mx = 0, my = 0;
    if (sv.keys['a'] || sv.keys['arrowleft'])  mx -= 1;
    if (sv.keys['d'] || sv.keys['arrowright']) mx += 1;
    if (sv.keys['w'] || sv.keys['arrowup'])    my -= 1;
    if (sv.keys['s'] || sv.keys['arrowdown'])  my += 1;
    return { mx, my };
}

function currentMoveDir(sv) {
    let { mx, my } = moveInput(sv);
    if (mx === 0 && my === 0) { mx = sv.faceX; my = sv.faceY; }
    const m = Math.hypot(mx, my) || 1;
    return { x: mx / m, y: my / m };
}

// 体力消耗（不足或力竭时返回 false）；武器出手/动作共用
export function spendStamina(sv, cost) {
    if (sv._devInfStamina) return true;   // 开发者无限体力
    if (!cost || cost <= 0) return true;
    if (sv.exhausted || (sv.stamina || 0) < cost) return false;
    sv.stamina = Math.max(0, sv.stamina - cost);
    sv._stamDelay = STAM_DELAY;
    return true;
}

// ---------- 闪避（Q 键 / 任意方向）：短距离快速位移 + 无敌帧，完美闪避触发子弹时间 ----------
// 2026-08-08 用户需求：删掉远距离闪现 → 闪避结合方向键（currentMoveDir 读 WASD/方向键，任意方向），
// 完美闪避（闪避开始后 0.25s 内被攻击）→ 1.2s 子弹时间（全局 0.2 倍慢动作）
export function startDash(sv) {
    if (sv.dashCooldown > 0 || sv.dashing) return false;
    if (!spendStamina(sv, DASH_COST)) return false;
    sv.dashing = true;
    sv.dashTimer = DODGE_DURATION;
    sv.dashDir = currentMoveDir(sv);   // 任意方向：WASD/方向键 → 闪避方向；无输入用面向
    sv.dashCooldown = DODGE_CD;
    sv.invuln = Math.max(sv.invuln, DODGE_INVULN);
    sv.dashGhosts = [];
    sv._dodgePerfectWindow = DODGE_PERFECT_WINDOW;   // 完美闪避窗口开启
    return true;
}

// ---------- 格挡（E 按住）：起手 6 体力，持续 8/s；完美窗口 0.3s ----------
export function startGuard(sv) {
    if (sv.guardCooldown > 0 || sv.guarding) return false;
    if (!spendStamina(sv, GUARD_COST)) return false;
    sv.guarding = true;
    sv.guardTimer = 0;
    // 盾朝向鼠标（世界坐标），鼠标在画布外则朝面向
    if (sv.mouse && sv.mouse.inside) {
        sv.guardFacing = Math.atan2(sv.camY + sv.mouse.y - sv.py, sv.camX + sv.mouse.x - sv.px);
    } else {
        sv.guardFacing = Math.atan2(sv.faceY, sv.faceX);
    }
    return true;
}

export function endGuard(sv) {
    if (!sv.guarding) return;
    sv.guarding = false;
    sv.guardCooldown = ACTION.guardCooldown;
}

export function inPerfectGuard(sv) {
    return sv.guarding && sv.guardTimer <= ACTION.guardPerfectMs;
}

// ---------- 跳跃（空格）：滞空期间免疫啃咬，移植单机 tryJump ----------
export function tryJump(sv) {
    if (sv.isJumping || sv.jumpCooldown > 0) return false;
    sv.vy = JUMP_VELOCITY;
    sv.isJumping = true;
    sv.jumpCooldown = JUMP_CD;
    return true;
}

// ---------- 每帧推进（canStand 由主控注入，闪现也走轴分离碰撞） ----------
// 返回 true 表示闪现中（主控应跳过正常 WASD 移动）
export function updateActions(sv, dt, canStand) {
    if (sv.dashCooldown > 0) sv.dashCooldown -= dt;
    if (sv.guardCooldown > 0) sv.guardCooldown -= dt;
    if (sv.invuln > 0) sv.invuln -= dt;
    if (sv.perfectFlash > 0) sv.perfectFlash -= dt;
    if (sv.jumpCooldown > 0) sv.jumpCooldown -= dt;
    if (sv._atkSlowT > 0) sv._atkSlowT -= dt;
    if (sv._atkSlowImmune > 0) sv._atkSlowImmune -= dt;

    // 奔跑（Shift）：力竭或体力空时无法奔跑
    sv.sprinting = !!sv.keys['shift'] && !sv.exhausted && (sv.stamina || 0) > 0;

    // 闪避中：短距离快速位移 + 残影
    if (sv.dashing) {
        sv.dashTimer -= dt;
        if (sv._dodgePerfectWindow > 0) sv._dodgePerfectWindow -= dt;
        sv.dashGhosts.push({ x: sv.px, y: sv.py - sv.jumpOffset, alpha: 0.55 });
        if (sv.dashGhosts.length > 6) sv.dashGhosts.shift();
        const nx = sv.px + sv.dashDir.x * DODGE_SPEED * dt;
        const ny = sv.py + sv.dashDir.y * DODGE_SPEED * dt;
        if (canStand(nx, sv.py)) sv.px = nx;
        if (canStand(sv.px, ny)) sv.py = ny;
        if (sv.dashTimer <= 0) sv.dashing = false;
        updateJump(sv, dt);
        return true;
    }

    // 残影淡出
    if (sv.dashGhosts.length) {
        for (const g of sv.dashGhosts) g.alpha -= dt * 3;
        sv.dashGhosts = sv.dashGhosts.filter(g => g.alpha > 0);
    }

    // 架盾计时 + 持续耗体力（耗尽自动收盾）；盾朝向跟随鼠标
    if (sv.guarding) {
        sv.guardTimer += dt;
        sv.stamina = Math.max(0, (sv.stamina || 0) - GUARD_DRAIN * dt);
        sv._stamDelay = STAM_DELAY;
        if (sv.stamina <= 0) endGuard(sv);
        if (sv.mouse && sv.mouse.inside) {
            sv.guardFacing = Math.atan2(sv.camY + sv.mouse.y - sv.py, sv.camX + sv.mouse.x - sv.px);
        }
    }

    // 奔跑持续耗体力（仅在按方向键移动时）
    const { mx, my } = moveInput(sv);
    if (sv.sprinting && (mx || my)) {
        sv.stamina = Math.max(0, (sv.stamina || 0) - SPRINT_DRAIN * dt);
        sv._stamDelay = STAM_DELAY;
    }

    // 力竭判定与体力回复（与单机一致：归零力竭、力竭回复减半、回满解除）；
    // 进食/饮水加速：饱食与水分都充足（≥60）时，以更快消耗二者为代价加速回体
    if ((sv.stamina || 0) <= 0) sv.exhausted = true;
    sv._stamDelay = Math.max(0, (sv._stamDelay || 0) - dt);
    if (sv._stamDelay <= 0 && sv.stamina < sv.maxStamina) {
        let rate = (sv.exhausted ? REGEN_EXHAUST : REGEN_NORMAL) * (sv._stamMul || 1);   // 先天病（关节炎等）修正
        const fed = (sv.food || 0) >= B.STAM_REGEN_FED_AT && (sv.water || 0) >= B.STAM_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, (Math.min(sv.food, sv.water) - B.STAM_REGEN_FED_AT) / (B.HUNGER_MAX - B.STAM_REGEN_FED_AT));
            rate += B.STAM_REGEN_FED * ramp;
            sv.food = Math.max(0, sv.food - B.STAM_REGEN_FUEL * dt);
            sv.water = Math.max(0, sv.water - B.STAM_REGEN_FUEL * dt);
        }
        sv.stamina = Math.min(sv.maxStamina, sv.stamina + rate * dt);
        if (sv.stamina >= sv.maxStamina) sv.exhausted = false;
    }

    updateJump(sv, dt);
    return false;
}

function updateJump(sv, dt) {
    if (!sv.isJumping) return;
    sv.jumpOffset += sv.vy * dt;
    sv.vy -= GRAVITY * dt;
    if (sv.jumpOffset <= 0) {
        sv.jumpOffset = 0;
        sv.vy = 0;
        sv.isJumping = false;
    }
}

// 移速倍率（奔跑 1.65 / 架盾 0.55 / 开镜 0.6 / 力竭 0.6，与单机一致）
export function moveMul(sv) {
    let mul = 1;
    if (sv.sprinting) mul *= 1.65;
    if (sv.guarding) mul *= 0.55;
    if (sv.aiming) mul *= 0.6;
    if (sv.squatting) mul *= 0.7;   // 2026-08-10 Ctrl 蹲下：移速 -30%（潜伏）
    if (sv.exhausted) mul *= 0.6;
    if (sv._atkSlowT > 0) mul *= 0.5;   // 扑咬控制/铁桶溅射减速
    if (sv._carryDowned) mul *= B.DOWNED_CARRY_SPEED;   // 2026-08-10 背起濒死玩家：移速减慢（负重）
    if (sv.food != null) {
        if (sv.food <= 0) mul *= B.HUNGER_STARVE_SPEED;
        else if (sv.food < B.HUNGER_LOW) mul *= B.HUNGER_LOW_SPEED;
    }
    // 口渴惩罚：低水分减速，缺水（归零）更慢
    if (sv.water != null) {
        if (sv.water <= 0) mul *= B.WATER_DEHYDRATE_SPEED;
        else if (sv.water < B.WATER_LOW) mul *= B.WATER_LOW_SPEED;
    }
    // 速度下限：任何减速叠加都不会让玩家完全定住
    if (sv._bodyMul) mul *= sv._bodyMul;   // 年龄阶段与疾病（updateNpcs 按主控计算）
    return Math.max(0.35, mul);
}

// 被控减速统一入口：受控期间 2 秒免疫再次控制，避免被连续扑咬锁死
export function applyAtkSlow(sv, duration) {
    if (sv._atkSlowImmune > 0) return;
    sv._atkSlowT = Math.max(sv._atkSlowT || 0, duration);
    sv._atkSlowImmune = 2;
}

// 动作状态复位（死亡重生 / 进入塔防战斗前调用）
export function resetActions(sv) {
    sv.dashing = false; sv.dashTimer = 0; sv.dashGhosts = [];
    sv.guarding = false; sv.guardTimer = 0;
    sv.sprinting = false; sv.aiming = false;
    sv.mouseDown = false;
    if (sv.wpn && sv.wpn.charging) {
        sv.wpn.charging = false;
        sv.wpn.chargeT = 0;
        AudioSystem.stopBowCharge();
    }
}

// ============================================================
// 僵尸攻击状态机（蓄力预警 → 单次挥击）+ 命中玩家结算
// 放在 waction（无 render/windoor 依赖），供 wzombie / windoor 复用，避免循环引用
// ============================================================

// 命中玩家：跳跃/无敌帧闪避、格挡、完美防反
export function resolvePlayerHit(sv, z, dmg, canStand) {
    if (sv.isJumping) return;
    if (sv.invuln > 0) {
        // 完美闪避（2026-08-08）：闪避无敌帧内（闪避开始后 0.25s 内）被僵尸攻击 → 触发子弹时间（时停）
        if (sv.dashing && sv._dodgePerfectWindow > 0 && !sv._bulletT) {
            sv._bulletT = BULLET_TIME_DURATION;
            sv.perfectFlash = 0.35;
            sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.35, maxLife: 0.35, label: '完美闪避' });
        }
        return;
    }
    if (sv.guarding) {
        if (inPerfectGuard(sv)) {
            z.stunT = ACTION.perfectStunTime;
            z.hurt = 0.2;
            sv.perfectFlash = 0.35;
            const a = Math.atan2(z.y - sv.py, z.x - sv.px);
            const nx = z.x + Math.cos(a) * 34, ny = z.y + Math.sin(a) * 34;
            if (canStand(nx, z.y)) z.x = nx;
            if (canStand(z.x, ny)) z.y = ny;
            sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.35, maxLife: 0.35, label: '防反' });
        }
        return;
    }
    if (sv._devGod) return;
    sv.hp = Math.max(0, sv.hp - dmg);   // 下限 0：HUD 不闪负值（死亡判定在 update 末尾统一处理）
    sv._zombieHitF = true;   // 本帧被僵尸咬伤标记：搜索界面打开时据此自动关闭（饥饿掉血不打断）
    sv.hurtT = 0.3;
    sv._combatT = 4;   // 玩家被咬 → 进入交战状态，队友支援
    // 后天培养：挨打练体质
    if (sv.npcs) {
        const c = sv.npcs.find(n => n.id === sv.controllerId);
        if (c) {
            if (!sv._actCounters) sv._actCounters = { melee: 0, hit: 0, run: 0 };
            sv._actCounters.hit = (sv._actCounters.hit || 0) + 1;
        }
    }
    sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 0.2, maxLife: 0.2, label: '击' });
    AudioSystem.playZombieEating();
    // 联机啃咬音效双端（§5.1 检查项4）：本端已播，outbox sfx 让对端也听到（mpWasteland playRemoteSfx 'zbite'）
    if (sv.mp && (sv.mp.role === 'host' || sv.mp.role === 'guest')) {
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'sfx', snd: 'zbite' });
    }
    const infGain = rollZombieInfection();
    if (infGain > 0) {
        const prevStage = playerInfectionStage(sv.infection || 0);
        sv.infection = addPlayerInfection(sv.infection || 0, infGain);
        const newStage = playerInfectionStage(sv.infection);
        if (newStage.stage > prevStage.stage) {
            sv.effects.push({ kind: 'infect', x: sv.px, y: sv.py, life: 1.2, maxLife: 1.2, label: newStage.name });
        }
    }
    // 铁桶重砸：命中溅射，短暂减速玩家
    if (z.type === 'bucket') {
        applyAtkSlow(sv, B.Z_SPLASH_SLOW_TIME);
        sv.effects.push({ kind: 'quake', x: z.x, y: z.y, life: 0.4, maxLife: 0.4 });
    }
    // 铁门盾击：把玩家击退一段距离
    if (z.type === 'door') {
        const a = Math.atan2(sv.py - z.y, sv.px - z.x);
        const kb = 36;
        const nx = sv.px + Math.cos(a) * kb, ny = sv.py + Math.sin(a) * kb;
        if (canStand(nx, sv.py)) sv.px = nx;
        if (canStand(sv.px, ny)) sv.py = ny;
    }
    if (z.textAbility && Math.random() < B.Z_TEXT_ABILITY_CHANCE) {
        resolveTextAbility(sv, z.textAbility);
    }
}

// 持续啃咬（2026-08-09 用户要求）：僵尸贴近玩家期间每帧调用——
// 血条如进度条缓慢减少（DPS = 原 dmg/biteCd，平均 DPS 与原咬击节奏完全一致）；
// 啃咬音效/受击反馈/感染/特殊效果按 Z_BITE_INTERVAL(0.3s) 节拍触发一次（与掉血解耦）。
export function resolvePlayerBiteTick(sv, z, dps, dt, canStand) {
    // 2026-08-11 v2.97 濒死角色被咬：不再"免咬跳过"，而是扣救援时间（每 1 点伤害减 10 秒）。
    // 用户反馈"濒临死亡被补刀后完全不能救"——此前濒死主角被咬直接 return，救援倒计时永不消耗、
    // 也不会死透，卡在"既救不活也不死"的悬空态。现在：
    //   · 当前主控本人倒地 → 不扣 hp（避免反复触发 onDeath/掉遗物），但扣 sv._downed 救援时间；
    //   · 切到健康队友（记录未 downed）→ 照常被咬掉血，倒地主角本人仍走救援时间扣减。
    if (sv._downed) {
        const cur = sv.controllerId ? (sv.npcs || []).find(n => n.id === sv.controllerId) : null;
        if (!cur || cur.downed) {
            // 倒地角色被咬：扣救援时间（等效 1 点伤害/0.2s 扫描节拍的累计伤害）
            if (sv._downed._penaltySec == null) sv._downed._penaltySec = 0;
            const dmg = dps * B.Z_BITE_INTERVAL;
            sv._downed._penaltySec += dmg * B.DOWNED_HIT_PENALTY_SEC;
            // 提示（防刷屏：3 秒一次）
            if (!sv._downed._hitLogT || (sv.now != null ? sv.now : 0) - sv._downed._hitLogT > 3) {
                sv._downed._hitLogT = sv.now;
                const spent = Math.max(0, (sv.now != null ? sv.now : 0) - (sv._downed.downedAtReal || 0)) + (sv._downed._penaltySec || 0);
                const remainSec = Math.max(0, B.DOWNED_LIMIT_SECONDS - spent);
                log(sv, `你被攻击！救援时间减少 ${Math.round(dmg * B.DOWNED_HIT_PENALTY_SEC)} 秒（剩余 ${Math.ceil(remainSec / 60)} 分钟）`, '#FF8866');
            }
            return;
        }
    }
    // 2026-08-09 开局昏迷苏醒：睁眼动画期间角色无敌（僵尸咬不伤），状态不变
    if (sv._wake && sv._wake.t < sv._wake.dur) return;
    if (sv.isJumping) return;
    if (sv.invuln > 0) {
        // 完美闪避（子弹时间）：无敌帧内被咬触发一次（与原 resolvePlayerHit 逻辑一致）
        if (sv.dashing && sv._dodgePerfectWindow > 0 && !sv._bulletT) {
            sv._bulletT = BULLET_TIME_DURATION;
            sv.perfectFlash = 0.35;
            sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.35, maxLife: 0.35, label: '完美闪避' });
        }
        return;
    }
    // 僵尸攻击时面向玩家（与咬 NPC/啃植物一致：攻击动作朝向目标）
    z.faceDir = Math.atan2(sv.py - z.y, sv.px - z.x);
    // 0.3s 节拍计时（音效/受击反馈/感染/特效按此节拍，与平滑掉血解耦）
    z._biteSfxT = (z._biteSfxT || 0) - dt;
    const tick = z._biteSfxT <= 0;
    if (tick) z._biteSfxT = B.Z_BITE_INTERVAL;
    // 格挡：全程无伤；完美格挡在节拍触发防反（防反不随每帧重复推僵尸）
    if (sv.guarding) {
        if (tick && inPerfectGuard(sv)) {
            z.stunT = ACTION.perfectStunTime;
            z.hurt = 0.2;
            sv.perfectFlash = 0.35;
            const a = Math.atan2(z.y - sv.py, z.x - sv.px);
            const nx = z.x + Math.cos(a) * 34, ny = z.y + Math.sin(a) * 34;
            if (canStand(nx, z.y)) z.x = nx;
            if (canStand(z.x, ny)) z.y = ny;
            sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.35, maxLife: 0.35, label: '防反' });
        }
        return;
    }
    // 2026-08-09 修复"属性全满（_devGod）时僵尸咬人无音效"：
    // 原 `if (sv._devGod) return;` 在音效/受击反馈之前直接返回 → 开了属性全满后
    // 僵尸咬人完全无声（玩家不知道被咬）。改为：_devGod 只跳过【掉血/感染】，
    // 音效/受击/节拍反馈照常播放（无敌是"不受伤"，不是"僵尸咬不到你"）。
    const godNoDmg = !!sv._devGod;
    // 2026-08-10 修复"啃咬音效 0.5s 一次不准确"：原音效块放在 `if(!tick) return` 之后，
    // 导致 _biteAudioT 只在 0.3s 掉血节拍时才递减（每次仅减一个 dt）→ 实际间隔约 0.6s 且
    // 依赖帧率。改为：音效节拍独立于此，每帧都递减、精确 0.5s 播放一次，与掉血节拍解耦。
    z._biteAudioT = (z._biteAudioT || 0) - dt;
    if (z._biteAudioT <= 0) {
        z._biteAudioT = B.Z_BITE_SFX_INTERVAL;
        AudioSystem.playZombieEating();
        // 联机啃咬音效双端（§5.1 检查项4）：本端已播，outbox sfx 让对端也听到
        if (sv.mp && (sv.mp.role === 'host' || sv.mp.role === 'guest')) {
            (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'sfx', snd: 'zbite' });
        }
    }
    // 持续掉血：血条缓慢减少（DPS 与原平均一致，由调用方传 dmgTo/biteCd）
    // 2026-08-09 锁血修复（决定性 v4）：掉血改为"按 0.3s 节拍扣整段 dmg"——
    // CDP 实测复现"hp 到 ~0.9 后卡死"：微小累计掉血（dps*dt）在低血时被浮点/时序问题
    // 吞掉（drop 恒为 0），单只僵尸要半分钟才死。改为每 tick（Z_BITE_INTERVAL=0.3s）扣
    // 一整段 dps*Z_BITE_INTERVAL（8*0.3=2.4 点），彻底绕开微小累加——1 血到死最多 1 个 tick。
    // 平均 DPS 不变（8/s），只是从"每帧微小掉"变为"每 0.3s 掉 2.4"，血条仍平滑可见下降。
    if (tick && dps > 0 && isFinite(dps) && !godNoDmg) {
        sv.hp = Math.max(0, sv.hp - dps * B.Z_BITE_INTERVAL);
        // 2026-08-11 v2.98 击杀明细：记录最后攻击者（僵尸名），死亡弹窗显示"被僵尸啃咬致死"
        sv._lastHitBy = { name: z.name || '僵尸', weapon: '啃咬', via: '僵尸' };
    }
    // 2026-08-09 修复"血量卡在 1 血站着不死"：
    // ① _combatT 每帧刷新（战斗暂停回血），② _biting 每帧标记（回血块硬性跳过）。
    // 双保险确保被啃咬期间自然回血/营地回血完全失效，hp 稳定持续下降直到归零。
    sv._combatT = 4;
    sv._biting = true;   // 本帧正被啃咬 → 回血块禁用（survival.js 检查）
    if (!tick) return;
    // ---- 节拍反馈（0.3s/次）----
    sv._zombieHitF = true;   // 搜索界面打开时据此自动关闭（饥饿掉血不打断）
    sv.hurtT = 0.3;
    if (sv.npcs) {
        const c = sv.npcs.find(n => n.id === sv.controllerId);
        if (c) {
            if (!sv._actCounters) sv._actCounters = { melee: 0, hit: 0, run: 0 };
            sv._actCounters.hit = (sv._actCounters.hit || 0) + 1;
        }
    }
    sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 0.2, maxLife: 0.2, label: '击' });
    // 感染：原每次咬 roll 一次。节拍化后概率等比缩放，期望感染速率与原一致
    // （原期望/秒 = chance×avgAmt/biteCd；现 = (chance×interval/biteCd)×avgAmt/interval，相等）
    const bcd = (B.Z_CONTACT[z.type] || B.Z_CONTACT.normal).biteCd || 1;
    if (!godNoDmg && Math.random() < PLAYER_INFECTION.zombieHitChance * (B.Z_BITE_INTERVAL / bcd)) {
        const [lo, hi] = PLAYER_INFECTION.zombieHitAmount;
        const infGain = lo + Math.floor(Math.random() * (hi - lo + 1));
        const prevStage = playerInfectionStage(sv.infection || 0);
        sv.infection = addPlayerInfection(sv.infection || 0, infGain);
        const newStage = playerInfectionStage(sv.infection);
        if (newStage.stage > prevStage.stage) {
            sv.effects.push({ kind: 'infect', x: sv.px, y: sv.py, life: 1.2, maxLife: 1.2, label: newStage.name });
        }
    }
    // 铁桶重砸：命中溅射，短暂减速玩家（节拍触发，防每帧重复）
    if (z.type === 'bucket') {
        applyAtkSlow(sv, B.Z_SPLASH_SLOW_TIME);
        sv.effects.push({ kind: 'quake', x: z.x, y: z.y, life: 0.4, maxLife: 0.4 });
    }
    // 铁门盾击：把玩家击退一段距离（节拍触发）
    if (z.type === 'door') {
        const a = Math.atan2(sv.py - z.y, sv.px - z.x);
        const kb = 36;
        const nx = sv.px + Math.cos(a) * kb, ny = sv.py + Math.sin(a) * kb;
        if (canStand(nx, sv.py)) sv.px = nx;
        if (canStand(sv.px, ny)) sv.py = ny;
    }
    if (z.textAbility && Math.random() < B.Z_TEXT_ABILITY_CHANCE) {
        resolveTextAbility(sv, z.textAbility);
    }
}

function resolveTextAbility(sv, ability) {
    const glyphs = [];
    for (let i = 0; i < sv.inv.length; i++) {
        const s = sv.inv[i];
        if (s && s.id.startsWith('glyph:')) glyphs.push(i);
    }
    if (glyphs.length === 0) return;
    const idx = glyphs[Math.floor(Math.random() * glyphs.length)];
    const slot = sv.inv[idx];
    if (ability === 'scatter') {
        const char = slot.id.slice(6);
        sv.inv[idx] = null;
        sv.drops.push({ x: sv.px + (Math.random() - 0.5) * 60, y: sv.py + (Math.random() - 0.5) * 60, id: slot.id, n: 1 });
        sv.effects.push({ kind: 'text', x: sv.px, y: sv.py, life: 1.0, maxLife: 1.0, label: `散「${char}」` });
    } else if (ability === 'delete') {
        const char = slot.id.slice(6);
        sv.inv[idx] = null;
        sv.effects.push({ kind: 'text', x: sv.px, y: sv.py, life: 1.0, maxLife: 1.0, label: `删「${char}」` });
    } else if (ability === 'corrupt') {
        const char = slot.id.slice(6);
        sv.inv[idx] = { id: `glyph-unstable:${char}`, n: slot.n };
        sv.effects.push({ kind: 'text', x: sv.px, y: sv.py, life: 1.0, maxLife: 1.0, label: `污「${char}」` });
    } else if (ability === 'stomp') {
        // 巨字尸：踏地震晕减速 + 震散一枚字块
        applyAtkSlow(sv, 1.6);
        sv.effects.push({ kind: 'quake', x: sv.px, y: sv.py, life: 0.5, maxLife: 0.5 });
        sv.effects.push({ kind: 'text', x: sv.px, y: sv.py - 20, life: 1.2, maxLife: 1.2, label: '震！' });
        const char = slot.id.slice(6);
        sv.inv[idx] = null;
        sv.drops.push({ x: sv.px + (Math.random() - 0.5) * 60, y: sv.py + (Math.random() - 0.5) * 60, id: slot.id, n: 1 });
    }
}

// 攻击状态机：tx/ty=目标，o.style=分型招式，o.onStrike(z)=命中结算。返回 true=攻击中
export function runZombieAttack(sv, z, dt, tx, ty, dist, o) {
    const style = o.style || { windup: 0.65, lunge: 16, strikeDist: 48 };
    if (z.atkState === 'windup') {
        z.atkT -= dt;
        z.atkAngle = Math.atan2(ty - z.y, tx - z.x);
        // 路障冲撞：蓄力时缓慢向目标逼近（creep）
        if (style.creep) {
            const a = z.atkAngle;
            const step = style.creep * dt;
            const cx = z.x + Math.cos(a) * step, cy = z.y + Math.sin(a) * step;
            if (o.canStand(cx, z.y)) z.x = cx;
            if (o.canStand(z.x, cy)) z.y = cy;
        }
        if (z.atkT <= 0) {
            z.atkState = 'strike'; z.atkT = 0.18; z.hasHit = false;
            const a = z.atkAngle;
            const lx = z.x + Math.cos(a) * style.lunge, ly = z.y + Math.sin(a) * style.lunge;
            if (o.canStand(lx, z.y)) z.x = lx;
            if (o.canStand(z.x, ly)) z.y = ly;
            sv.effects.push({ kind: 'zswing', x: z.x, y: z.y, angle: a, life: 0.22, maxLife: 0.22, style: style.effect });
            // 旗帜号令：范围内友方僵尸临时提速
            if (style.rally) {
                let rallied = 0;
                for (const oth of sv.zombies) {
                    if (oth !== z && oth.hp > 0 && Math.hypot(oth.x - z.x, oth.y - z.y) < B.Z_FLAG_AURA_RANGE * TS) { oth.auraT = 3; rallied++; }
                }
                if (rallied) sv.effects.push({ kind: 'rally', x: z.x, y: z.y, life: 0.5, maxLife: 0.5, r: B.Z_FLAG_AURA_RANGE * TS });
            }
        }
        return true;
    }
    if (z.atkState === 'strike') {
        z.atkT -= dt;
        const d2 = Math.hypot(tx - z.x, ty - z.y);
        if (!z.hasHit && d2 < style.strikeDist) { z.hasHit = true; o.onStrike(z); }
        if (z.atkT <= 0) {
            // 撑杆跃刺：二连击（第一击后极短间隔再刺一次）
            if (style.combo && (z.comboLeft || 0) > 0) {
                z.comboLeft -= 1;
                z.atkState = 'windup';
                z.atkWindup = B.Z_COMBO_GAP;
                z.atkT = z.atkWindup;
                return true;
            }
            z.atkState = null;
            z.comboLeft = 0;
            z.atkCd = o.atkCd + (z.hasHit ? 0 : 0.3);   // 挥空硬直
        }
        return true;
    }
    if (z.atkCd > 0) z.atkCd -= dt;
    if ((z.atkCd || 0) <= 0 && dist < o.range) {
        z.atkState = 'windup';
        z.atkWindup = style.windup * (o.windupMul || 1) + Math.random() * 0.3;   // 错峰
        z.atkT = z.atkWindup;
        z.atkAngle = Math.atan2(ty - z.y, tx - z.x);
        if (style.combo) z.comboLeft = style.combo - 1;   // 预置连击次数
        return true;
    }
    return false;
}
