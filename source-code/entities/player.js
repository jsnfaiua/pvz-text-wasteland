// ============================================================
// 玩家实体（戴夫）逻辑：移动、跳跃、闪避、格挡、武器攻击
// ============================================================

import { GRAVITY, JUMP_VELOCITY, JUMP_CD, ACTION, WEAPONS, MIN_PLANT_DIST, PLANTS, ZOMBIES } from '../core/constants.js';
import { state, keys, mouse } from '../core/state.js';
import { yToRow } from '../core/utils.js';
import { reportMissionProgress, MISSION_TYPES } from '../systems/missions.js';
import AudioSystem from '../systems/audio.js';

// 移动方向
export function currentMoveDir(player) {
    let vx = 0, vy = 0;
    if (keys['a'] || keys['arrowleft'])  vx -= 1;
    if (keys['d'] || keys['arrowright']) vx += 1;
    if (keys['w'] || keys['arrowup'])    vy -= 1;
    if (keys['s'] || keys['arrowdown'])  vy += 1;
    if (vx === 0 && vy === 0) { vx = player.facing; vy = 0; }
    const m = Math.hypot(vx, vy) || 1;
    return { x: vx / m, y: vy / m };
}

// 开始闪避
export function startDash(player) {
    if (player.dashCooldown > 0 || player.dashing) return;
    if (player.exhausted || (player.stamina || 0) < 12) return; // 闪避消耗 12 体力
    player.stamina -= 12;
    player._stamDelay = 0.8;
    player.dashing = true;
    player.dashTimer = ACTION.dashDuration;
    player.dashDir = currentMoveDir(player);
    player.dashCooldown = ACTION.dashCooldown;
    player.invuln = Math.max(player.invuln, ACTION.dashInvuln);
    player.dashGhosts = [];
    AudioSystem.playDash();
}

// 开始格挡
export function startGuard(player, angle = null) {
    if (player.guardCooldown > 0 || player.guarding) return;
    if (player.exhausted || (player.stamina || 0) < 6) return; // 格挡起手消耗 6 体力（持续架盾另计）
    player.stamina -= 6;
    player._stamDelay = 0.8;
    player.guarding = true;
    player.guardTimer = 0;
    AudioSystem.playGuard();
    if (angle !== null) {
        player.guardFacing = angle;
    } else if (mouse.inside) {
        const playerY = player.y - player.jumpOffset;
        player.guardFacing = Math.atan2(mouse.y - playerY, mouse.x - player.x);
    } else {
        player.guardFacing = player.facing > 0 ? 0 : Math.PI;
    }
}

export function endGuard(player) {
    if (!player.guarding) return;
    player.guarding = false;
    player.guardCooldown = ACTION.guardCooldown;
}

export function inPerfectGuard(player) {
    return player.guarding && player.guardTimer <= ACTION.guardPerfectMs;
}

// 找附近可铲的植物
export function findPlantNear(x, y, r) {
    let best = null, bestDist = Infinity;
    for (const p of state.plants) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= r && d < bestDist) { best = p; bestDist = d; }
    }
    return best;
}

// 铲除植物
export function digPlant(plant) {
    const def = PLANTS[plant.kind];
    const refund = Math.round(def.cost * 0.5);
    state.sun += refund;
    state.effects.push({
        kind: 'pickup', x: plant.x, y: plant.y,
        life: 0.6, maxLife: 0.6, label: `+${refund}`,
    });
    plant.hp = 0;
    AudioSystem.playPlantDig();
}

// 检查间距
export function canPlantAt(row, x) {
    for (const p of state.plants) {
        if (p.row === row && Math.abs(p.x - x) < MIN_PLANT_DIST) return false;
    }
    return true;
}

// 更新玩家
export function updatePlayer(player, dt, FIELD) {
    // 阵亡旋转
    if (state.gameOver && !state.victory) {
        if (player.deathRot < Math.PI / 2) player.deathRot += dt * 3;
        return;
    }
    // 胜利后保持正常移动（拾取奖励卡片/货币阶段）

    // CD递减
    if (player.dashCooldown  > 0) player.dashCooldown  -= dt;
    if (player.guardCooldown > 0) player.guardCooldown -= dt;
    if (player.invuln        > 0) player.invuln        -= dt;
    if (player.perfectFlash  > 0) player.perfectFlash  -= dt;

    // 加速（Shift）：持续消耗体力 6/s，力竭或体力空时无法加速
    player.sprinting = !!keys['shift'] && !player.exhausted && (player.stamina || 0) > 0;

    // 闪避中
    if (player.dashing) {
        player.dashTimer -= dt;
        player.dashGhosts.push({ x: player.x, y: player.y - player.jumpOffset, alpha: 0.55 });
        if (player.dashGhosts.length > 6) player.dashGhosts.shift();
        player.x += player.dashDir.x * ACTION.dashSpeed * dt;
        player.y += player.dashDir.y * ACTION.dashSpeed * dt;
        player.x = Math.max(FIELD.left, Math.min(FIELD.right, player.x));
        player.y = Math.max(FIELD.top, Math.min(FIELD.bottom, player.y));
        if (player.dashTimer <= 0) player.dashing = false;
        finishPlayerTimers(player, dt);
        return;
    }

    // 残影淡出
    if (player.dashGhosts.length) {
        for (const g of player.dashGhosts) g.alpha -= dt * 3;
        player.dashGhosts = player.dashGhosts.filter(g => g.alpha > 0);
    }

    // 格挡计时 + 持续耗体力（8/s），耗尽自动收盾
    if (player.guarding) {
        player.guardTimer += dt;
        player.stamina = Math.max(0, (player.stamina || 0) - 8 * dt);
        player._stamDelay = 0.8;
        if (player.stamina <= 0) endGuard(player);
    }

    // 加速移动中持续耗体力（6/s）
    if (player.sprinting && (keys['a'] || keys['d'] || keys['w'] || keys['s'] ||
        keys['arrowleft'] || keys['arrowright'] || keys['arrowup'] || keys['arrowdown'])) {
        player.stamina = Math.max(0, (player.stamina || 0) - 6 * dt);
        player._stamDelay = 0.8;
    }

    // 力竭判定：体力归零进入力竭期（移速降低、回复减半），回满后解除
    if (player.maxStamina) {
        if ((player.stamina || 0) <= 0) player.exhausted = true;
        player._stamDelay = Math.max(0, (player._stamDelay || 0) - dt);
        if (player._stamDelay <= 0 && player.stamina < player.maxStamina) {
            const rate = player.exhausted ? 6 : 14; // 力竭期回复更慢
            player.stamina = Math.min(player.maxStamina, player.stamina + rate * dt);
            if (player.stamina >= player.maxStamina) player.exhausted = false;
        }
    }

    // 移动
    let vx = 0, vy = 0;
    if (keys['a'] || keys['arrowleft'])  vx -= 1;
    if (keys['d'] || keys['arrowright']) vx += 1;
    if (keys['w'] || keys['arrowup'])    vy -= 1;
    if (keys['s'] || keys['arrowdown'])  vy += 1;

    // 对角归一化
    if (vx !== 0 && vy !== 0) {
        const inv = 1 / Math.SQRT2;
        vx *= inv; vy *= inv;
    }

    let mul = 1;
    if (player.sprinting) mul *= 1.65;
    if (player.guarding)  mul *= 0.55;
    if (state.aiming)     mul *= 0.6;  // 开镜瞄准移速降低
    if (player.exhausted) mul *= 0.6;  // 力竭期移速降低

    if (vx !== 0) {
        player.x += vx * player.speed * mul * dt;
        player.facing = vx > 0 ? 1 : -1;
        player.facingAngle = Math.atan2(vy, vx);
        player.x = Math.max(FIELD.left, Math.min(FIELD.right, player.x));
    } else if (vy !== 0) {
        player.facingAngle = vy > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    if (vy !== 0) {
        player.y += vy * player.speedY * mul * dt;
        player.y = Math.max(FIELD.top, Math.min(FIELD.bottom, player.y));
    }

    finishPlayerTimers(player, dt);
}

export function finishPlayerTimers(player, dt) {
    if (player.isJumping) {
        player.jumpOffset += player.vy * dt;
        player.vy -= GRAVITY * dt;
        if (player.jumpOffset <= 0) {
            player.jumpOffset = 0;
            player.vy = 0;
            player.isJumping = false;
        }
    }
    if (player.jumpCooldown > 0) player.jumpCooldown -= dt;
    if (player.ghost) {
        player.ghost.alpha -= dt * 2;
        if (player.ghost.alpha <= 0) player.ghost = null;
    }
    if (player.hurtFlash > 0) player.hurtFlash -= dt;
    if (player.weaponCooldown > 0) player.weaponCooldown -= dt;
    if (player.swingTimer > 0) player.swingTimer -= dt;
    if (Math.abs(player.recoil) > 0.1) {
        player.recoil *= Math.max(0, 1 - dt * 8);
    } else {
        player.recoil = 0;
    }
}

// 跳跃
export function tryJump(player) {
    if (!player.isJumping && player.jumpCooldown <= 0) {
        player.vy = JUMP_VELOCITY;
        player.isJumping = true;
        player.jumpCooldown = JUMP_CD;
        player.ghost = { x: player.x, y: player.y, alpha: 0.6 };
    }
}

// 受击判定
export function checkPlayerDamage(player, dt) {
    if (state._trDaveInv) return;
    if (player.isJumping) return;
    if (player.invuln > 0) return;

    for (const z of state.zombies) {
        if (z.row === player.row && Math.abs(z.x - player.x) < 40) {
            if (player.guarding) {
                if (inPerfectGuard(player) && !z._stunned) {
                    z._stunTimer = ACTION.perfectStunTime;
                    z._stunned = true;
                    z.hurtFlash = 0.2;
                    player.perfectFlash = 0.35;
                    z.x += 30;
                    AudioSystem.playPerfectGuard();
                    reportMissionProgress(MISSION_TYPES.PERFECT_BLOCK, 1);
                }
                return;
            }

            player.hurtFlash = 0.15;
            const def = ZOMBIES[z.kind] || ZOMBIES.normal;
            let dmg = def.damage * dt;
            // 头盔护甲先吸收伤害（僵尸掉落的甲拾取后戴在头上生效）
            if (player.armor && player.armor.hp > 0) {
                const absorbed = Math.min(player.armor.hp, dmg);
                player.armor.hp -= absorbed;
                dmg -= absorbed;
                if (player.armor.hp <= 0) {
                    state.effects.push({ kind: 'armorBreak', x: player.x, y: player.y - player.jumpOffset, life: 1.0, maxLife: 1.0 });
                    AudioSystem.playBucketHurt();
                    player.armor = null;
                }
            }
            if (dmg > 0) player.hp -= dmg;
            player.recoil = (player.x < z.x ? -1 : 1) * 4;
            player._biteTimer = (player._biteTimer || 0) - dt;
            if (player._biteTimer <= 0) {
                player._biteTimer = 0.6;
                // 全被护甲吸收播防具受击音，否则播普通受击音
                if (dmg <= 0) AudioSystem.playArmoredHurt();
                else AudioSystem.playPlayerHurt();
            }
            if (player.hp <= 0) return true;
            return;
        }
    }
    return false;
}
