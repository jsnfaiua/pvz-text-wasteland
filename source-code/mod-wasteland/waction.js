// ============================================================
// 【无尽植僵荒原】模组 · 动作系统（移植自本体 entities/player.js）
// 闪现(Q) / 格挡(E 按住) / 奔跑(Shift) / 跳跃(空格) + 体力规则
// 数值引用本体 ACTION / GRAVITY / JUMP_* 常量，手感与单机一致
// ============================================================

import { ACTION, GRAVITY, JUMP_VELOCITY, JUMP_CD } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import * as B from './wbalance.js';
import { TS } from './wconst.js';
import { rollZombieInfection, addPlayerInfection, playerInfectionStage } from './winfection.js';

const STAM_DELAY = 0.5;     // 消耗后回复延迟
const REGEN_NORMAL = 14;    // 正常回复速率 /s
const REGEN_EXHAUST = 10;   // 力竭期回复速率 /s（比正常略慢，不再久拖不动）
const GUARD_DRAIN = 8;      // 架盾持续耗体力 /s
const SPRINT_DRAIN = 6;     // 奔跑持续耗体力 /s
const DASH_COST = 12;       // 闪现消耗
const GUARD_COST = 6;       // 格挡起手消耗

// 移动输入（WASD + 方向键，与单机一致）
export function moveInput(sv) {
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

// ---------- 闪现（Q）：残影 + 无敌帧，移植单机 startDash ----------
export function startDash(sv) {
    if (sv.dashCooldown > 0 || sv.dashing) return false;
    if (!spendStamina(sv, DASH_COST)) return false;
    sv.dashing = true;
    sv.dashTimer = ACTION.dashDuration;
    sv.dashDir = currentMoveDir(sv);
    sv.dashCooldown = ACTION.dashCooldown;
    sv.invuln = Math.max(sv.invuln, ACTION.dashInvuln);
    sv.dashGhosts = [];
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

    // 闪现中：高速冲刺 + 残影
    if (sv.dashing) {
        sv.dashTimer -= dt;
        sv.dashGhosts.push({ x: sv.px, y: sv.py - sv.jumpOffset, alpha: 0.55 });
        if (sv.dashGhosts.length > 6) sv.dashGhosts.shift();
        const nx = sv.px + sv.dashDir.x * ACTION.dashSpeed * dt;
        const ny = sv.py + sv.dashDir.y * ACTION.dashSpeed * dt;
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
    if (sv.exhausted) mul *= 0.6;
    if (sv._atkSlowT > 0) mul *= 0.5;   // 扑咬控制/铁桶溅射减速
    // 饥饿惩罚：低饱食减速，挨饿（归零）更慢
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
    if (sv.isJumping || sv.invuln > 0) return;
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
