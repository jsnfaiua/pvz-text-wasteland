// ============================================================
// 战斗 & 武器系统
// ============================================================

import { WEAPONS, ZOMBIES, PLANTS, FIELD } from '../core/constants.js';
import { state, mouse, saveData } from '../core/state.js';
import { findPlantNear, digPlant } from '../entities/player.js';
import { addPickupReward } from './spawner.js';
import { reportMissionProgress, MISSION_TYPES } from './missions.js';
import { writeSave } from '../persistence/storage.js';
import AudioSystem from './audio.js';

// 击杀即解锁图鉴：记录见过的僵尸种类入档
function markZombieSeen(kind) {
    if (!saveData.seenZombies) saveData.seenZombies = [];
    if (!saveData.seenZombies.includes(kind)) {
        saveData.seenZombies.push(kind);
        writeSave(saveData);
    }
}

// 受击音效：按僵尸当前护甲状态选择（有甲播防具音，破甲后播普通音）
function playZombieHitSound(z, normalFn) {
    if ((z.armorHp || 0) > 0) {
        if (z.kind === 'bucket' || z.kind === 'door') AudioSystem.playBucketHurt();
        else AudioSystem.playArmoredHurt();
    } else {
        normalFn();
    }
}

export function applyDamageToZombie(z, damage, penMul = 1) {
    if (state._trZombieInv) return;
    if ((z.armorHp || 0) > 0) {
        // 穿甲系数：全威力步枪弹/狙击弹对铁质防具造成成倍伤害
        const eff = damage * penMul;
        const armorDmg = Math.min(z.armorHp, eff);
        z.armorHp -= armorDmg;
        if (z.armorHp <= 0 && !z.armorBroken) {
            z.armorBroken = true;
            state.effects.push({ kind: 'armorBreak', x: z.x, y: z.y, life: 1.0, maxLife: 1.0 });
            if (z.kind === 'bucket' || z.kind === 'door') AudioSystem.playBucketHurt();
            else if (z.kind === 'cone') AudioSystem.playArmoredHurt();
        }
        const leftover = (eff - armorDmg) / penMul; // 破甲后剩余伤害折算回肉体
        if (leftover > 0) {
            z.hp -= leftover;
        }
    } else {
        z.hp -= damage;
    }
}

function applyDamageToPlant(p, damage) {
    if (state._trPlantInv) return;
    if ((p.armorHp || 0) > 0) {
        const armorDmg = Math.min(p.armorHp, damage);
        p.armorHp -= armorDmg;
        if (p.armorHp <= 0) {
            state.effects.push({ kind: 'hit', x: p.x, y: p.y, life: 0.25, maxLife: 0.25, label: '破甲' });
        }
        const leftover = damage - armorDmg;
        if (leftover > 0) {
            p.hp -= leftover;
        }
    } else {
        p.hp -= damage;
    }
}

function triggerExplosion(p, def, isPotato) {
    p.exploded = true;
    if (isPotato) {
        AudioSystem.playPotatoMineBoom();
    } else {
        AudioSystem.playCherryBomb();
    }
    const mul = p.mul || 1;
    const radius = def.blastRadius * mul;
    const dmg = Math.round(def.blastDamage * mul);
    const radiusSq = radius * radius;
    for (const z of state.zombies) {
        const dx = z.x - p.x, dy = z.y - p.y;
        if (dx * dx + dy * dy < radiusSq) {
            applyDamageToZombie(z, dmg);
            z.hurtFlash = 0.15;
        }
    }
    state.effects.push({
        kind: 'boom', x: p.x, y: p.y,
        radius, life: 0.5, maxLife: 0.5,
    });
    p.hp = 0;
}

// 计算攻击角度
function getAttackAngle(player) {
    const playerY = player.y - player.jumpOffset;
    if (mouse.inside) {
        return Math.atan2(mouse.y - playerY, mouse.x - player.x);
    }
    return player.facing > 0 ? 0 : Math.PI;
}

// 挥砍动画
export function startSwing(player, angle, wkey) {
    player.swingTimer = 0.22;
    player.swingDir = angle;
    player.swingWeapon = wkey;
}

// 尝试使用武器（玩家）；空手时回退为拳头。charge 仅弓箭蓄力用（0~1.5）
export function tryUseWeapon(player, weaponMultiplier, isShovelUnlocked, charge = 1) {
    const wkey = player.currentWeapon || 'fist';

    if (player.weaponCooldown > 0) return { ok: false };

    const w = WEAPONS[wkey];
    if (!w) return { ok: false };

    // 换弹中无法射击
    if (player.reloading) return { ok: false, msg: '换弹中...' };

    // 体力检查：使用武器消耗体力，不足则无法出手
    const stamCost = w.stamina || 0;
    if (stamCost > 0 && (player.stamina || 0) < stamCost) {
        return { ok: false, msg: '体力不足，稍作休息' };
    }

    const isEquipped = wkey === player.equippedMelee || wkey === player.equippedRanged || wkey === player.equippedWeapon;

    // 弹匣规则（单机/训练营启用：magAmmo 有值时生效；联机保持旧手感）
    if (w.kind === 'ranged' && player.magAmmo != null) {
        if (player.magAmmo <= 0) {
            return { ok: false, msg: '弹匣已空，按 R 换弹' };
        }
    }

    const angle = getAttackAngle(player);
    player.facingAngle = angle;

    const mul = isEquipped ? weaponMultiplier(player.equippedLevel || 1) : 1;

    if (w.kind === 'ranged') {
        // 远程武器（弓箭蓄力：伤害与弹速随 charge 提升；右键瞄准显著降低散射）
        const pellets = w.pellets || 1;
        const spread = (w.spread || 0) * (state.aiming ? (w.aimFactor ?? 0.35) : 1);
        const dmgMul = mul * charge;
        const spdMul = w.chargeable ? (0.7 + 0.5 * charge) : 1;
        for (let i = 0; i < pellets; i++) {
            const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5);
            const a = angle + t * spread;
            state.bullets.push({
                x: player.x + Math.cos(a) * 22,
                y: (player.y - player.jumpOffset) + Math.sin(a) * 22,
                vx: Math.cos(a) * w.bulletSpeed * spdMul,
                vy: Math.sin(a) * w.bulletSpeed * spdMul,
                row: null,
                friendly: true,
                damage: Math.round(w.damage * dmgMul),
                color: w.color,
                label: w.bulletLabel || '·',
                life: 1.2,
                range: w.range || 9999,
                penArmor: w.penArmor || 1,
                pierce: w.pierce || 0,
                pierced: 0,
                spin: !!w.spin,
                traveled: 0,
                speed: w.bulletSpeed * spdMul,
            });
        }
        // 全自动模式用专属射速（如步枪 autoInterval 0.12s，贴近现实射速）
        const interval = (player.fireMode === 'auto' && w.autoInterval) ? w.autoInterval : w.fireInterval;
        player.weaponCooldown = interval / mul;
        if (player.magAmmo != null) player.magAmmo = Math.max(0, player.magAmmo - 1);
        // 枪口火光（短促锥形闪光 + 拟声字残影，方向与子弹一致；不再用近战挥砍动画）
        state.effects.push({
            kind: 'muzzle',
            x: player.x + Math.cos(angle) * 26,
            y: (player.y - player.jumpOffset) + Math.sin(angle) * 26,
            angle, color: w.color,
            label: { pistol: '砰', smg: '砰', rifle: '砰', shotgun: '轰', sniper: '轰', bow: '嗖', knife: '嗖' }[wkey] || '砰',
            ghosts: (wkey === 'shotgun' || wkey === 'sniper') ? 2 : 1,
            life: 0.12, maxLife: 0.12,
        });
    } else {
        // 近战武器
        const cx = player.x + Math.cos(angle) * (w.reach || 40) * 0.5;
        const cy = (player.y - player.jumpOffset) + Math.sin(angle) * (w.reach || 40) * 0.5;

        // 铲子优先挖植物
        if (w.canDigPlant) {
            const zombieNear = state.zombies.find(z =>
                Math.hypot(z.x - cx, z.y - cy) < (w.reach || 40)
            );
            if (!zombieNear) {
                const plant = findPlantNear(cx, cy, w.reach || 40);
                if (plant) {
                    digPlant(plant);
                    player.weaponCooldown = w.fireInterval;
                    player.stamina = Math.max(0, (player.stamina || 0) - stamCost);
                    player._stamDelay = 0.8;
                    startSwing(player, angle, wkey);
                    return { ok: true };
                }
            }
        }

        // 近战攻击（按攻击方式差异化判定）
        const dmg = Math.round(w.damage * mul);
        const style = w.attackStyle || 'slash';
        const py = player.y - player.jumpOffset;
        const reach = w.reach || 40;
        const reachSq = reach * reach;
        for (const z of state.zombies) {
            const dx = z.x - player.x;
            const dy = z.y - py;
            let hit = false;
            if (style === 'thrust') {
                // 突刺：直线窄条判定——僵尸到攻击方向线的垂直距离足够近，且沿线距离不超 reach
                const along = dx * Math.cos(angle) + dy * Math.sin(angle);
                const perp = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
                if (along >= 0 && along <= reach && perp < 24) hit = true;
            } else {
                // 挥砍/直刺/重劈：扇形判定（弧宽由武器 arc 决定）；先平方距离粗筛，命中候选才做角度计算
                const distSq = dx * dx + dy * dy;
                if (distSq > reachSq) continue;
                const zAngle = Math.atan2(dy, dx);
                let delta = zAngle - angle;
                while (delta >  Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                if (Math.abs(delta) <= (w.arc || Math.PI) / 2) hit = true;
            }
            if (hit) {
                applyDamageToZombie(z, dmg, w.penArmor || 1);
                z.hurtFlash = 0.12;
                state.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.15, maxLife: 0.15 });
                playZombieHitSound(z, () => AudioSystem.playMeleeHit());
            }
        }
        player.weaponCooldown = w.fireInterval / mul;
        startSwing(player, angle, wkey);
    }

    // 出手成功：扣除体力并重置回复延迟
    if (stamCost > 0) {
        player.stamina = Math.max(0, (player.stamina || 0) - stamCost);
        player._stamDelay = 0.8;
    }

    return { ok: true };
}

// 换弹：弹匣从备弹补充（训练营 _trInfAmmo 时直接满弹不耗备弹）
export function startReload(player) {
    const wkey = player.currentWeapon;
    const w = WEAPONS[wkey];
    if (!w || w.kind !== 'ranged' || !w.magSize) return { ok: false };
    if (player.magAmmo == null || player.reloading) return { ok: false };
    if (player.magAmmo >= w.magSize) return { ok: false, msg: '弹匣已满' };
    const reserve = state.reserveAmmo?.[w.ammoType] || 0;
    if (!state._trInfAmmo && reserve <= 0) return { ok: false, msg: '备弹不足，去商店购买弹药' };

    player.reloading = true;
    player.reloadTimer = w.reloadTime || 1.5;
    return { ok: true };
}

// 换弹计时推进（每帧调用，完成时补弹）
export function updateReload(player, dt) {
    if (!player.reloading) return;
    player.reloadTimer -= dt;
    if (player.reloadTimer > 0) return;
    player.reloading = false;
    const w = WEAPONS[player.currentWeapon];
    if (!w || !w.magSize) return;
    const need = w.magSize - (player.magAmmo || 0);
    if (state._trInfAmmo) {
        player.magAmmo = w.magSize;
    } else {
        const take = Math.min(need, state.reserveAmmo?.[w.ammoType] || 0);
        player.magAmmo = (player.magAmmo || 0) + take;
        if (state.reserveAmmo) {
            state.reserveAmmo[w.ammoType] = Math.max(0, (state.reserveAmmo[w.ammoType] || 0) - take);
        }
    }
}

// 发射一颗豌豆/冰豆：实时瞄准本行最前（x最小）僵尸的碰撞位置，允许斜射
function firePea(p, def, mul) {
    const slow = p.kind === 'snowpea' ? { amount: def.slowAmount || 0.4, duration: def.slowDuration || 5 } : null;
    const muzzleX = p.x + 20, muzzleY = p.y;
    let vx = 380, vy = 0;
    let target = null;
    for (const z of state.zombies) {
        if (z.row === p.row && z.hp > 0 && z.x > p.x && z.x < p.x + (def.range || 9999)) {
            if (!target || z.x < target.x) target = z;
        }
    }
    if (target) {
        const dx = target.x - muzzleX, dy = target.y - muzzleY;
        const dist = Math.hypot(dx, dy) || 1;
        vx = 380 * dx / dist;
        vy = 380 * dy / dist;
    }
    state.bullets.push({
        x: muzzleX, y: muzzleY, row: p.row,
        vx, vy, damage: def.bulletDamage * mul,
        color: def.color, label: p.kind === 'snowpea' ? '冰' : '豌',
        slow: slow,
        owner: p.owner,
        speed: 380,
    });
}

// 更新植物
export function updatePlants(dt, DIFFICULTY, levelMultipliers) {
    for (let i = state.plants.length - 1; i >= 0; i--) {
        const p = state.plants[i];
        const def = PLANTS[p.kind];
        const mul = p.mul || 1;
        if (p.shake > 0) p.shake -= dt;

        if (def.produceInterval) {
            p.produceTimer -= dt;
            if (p.produceTimer <= 0) {
                p.produceTimer = def.produceInterval / mul;
                state.suns.push({
                    x: p.x, y: p.y,
                    targetY: p.y + 30, vy: 60, value: state.doubleSun ? 50 : 25, life: 10,
                });
            }
        }

        if (def.fireInterval) {
            p.fireTimer -= dt;
            // 扫描只发生在冷却到零的时刻，避免每帧对每个射手做全量僵尸扫描
            if (p.fireTimer <= 0) {
                const hasTarget = state.zombies.some(z =>
                    z.row === p.row && z.x > p.x && z.x < p.x + def.range
                );
                if (hasTarget) {
                    p.fireTimer = def.fireInterval / (DIFFICULTY.attackSpeedMul || 1);
                    firePea(p, def, mul);
                    AudioSystem.playPeaShoot();
                    // 双发射手：第二发延迟 0.15s，与音效逐发对齐
                    if (p.kind === 'repeater') {
                        p._burstShots = 1;
                        p._burstTimer = 0.15;
                    }
                }
            }
        }

        // 双发第二发：时间间隔拉开，视觉上两颗"豌"分离
        if (p._burstShots > 0) {
            p._burstTimer -= dt;
            if (p._burstTimer <= 0) {
                p._burstShots--;
                firePea(p, def, mul);
                AudioSystem.playPeaShoot();
            }
        }

        // 大嘴花：吞噬前方最近僵尸（吞噬范围随等级倍率提升）
        if (p.kind === 'chomper' && !p._digesting) {
            let target = null, bestDist = (def.killRange || 160) * mul;
            for (const z of state.zombies) {
                if (z.row === p.row && z.x > p.x && z.x - p.x < bestDist) {
                    target = z; bestDist = z.x - p.x;
                }
            }
            if (target) {
                target.hp = 0;
                p._digesting = true;
                p._digestTimer = PLANTS.chomper.digestTime || 45;
                state.effects.push({ kind: 'hit', x: target.x, y: target.y, life: 0.3, maxLife: 0.3, label: '吞' });
                AudioSystem.playChomper();
            }
        }
        if (p._digesting) {
            p._digestTimer -= dt;
            if (p._digestTimer <= 0) p._digesting = false;
        }

        if (def.fuse) {
            p.fuseTimer -= dt;

            // 土豆地雷：武装后等待僵尸触发（僵尸进入地雷周围 50px 即引爆）
            if (p.kind === 'potatomine' && p.fuseTimer <= 0 && !p.exploded) {
                p.armed = true;
                for (const z of state.zombies) {
                    const dx = z.x - p.x, dy = z.y - p.y;
                    if (z.row === p.row && dx * dx + dy * dy < 2500) {
                        triggerExplosion(p, def, true);
                        break;
                    }
                }
            } else if (p.kind !== 'potatomine' && p.fuseTimer <= 0 && !p.exploded) {
                triggerExplosion(p, def, false);
            }
        }

        if (p.hp <= 0) state.plants.splice(i, 1);
    }
}

// 更新子弹
export function updateBullets(dt) {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
        const b = state.bullets[i];
        b.x += b.vx * dt;
        if (b.vy) b.y += b.vy * dt;
        b.traveled = (b.traveled || 0) + (b.speed || Math.hypot(b.vx, b.vy || 0)) * dt; // 累计飞行距离（伤害衰减用）

        // 出界
        if (b.x < -20 || b.x > 980 || b.y < -20 || b.y > 560) {
            state.bullets.splice(i, 1);
            continue;
        }

        // 生命到期
        if (b.life != null) {
            b.life -= dt;
            if (b.life <= 0) { state.bullets.splice(i, 1); continue; }
        }

        // 友方子弹打僵尸
        if (b.friendly) {
            let hit = null, bestDistSq = 484; // 碰撞半径 22px 的平方
            for (const z of state.zombies) {
                if (z.hp <= 0) continue;
                if (b.hitList && b.hitList.includes(z)) continue; // 穿透弹不打同一只两次
                const dx = z.x - b.x, dy = z.y - b.y;
                const dSq = dx * dx + dy * dy;
                if (dSq < bestDistSq) { bestDistSq = dSq; hit = z; }
            }
            if (hit) {
                // 射程衰减：有效射程内满伤害，超出后线性衰减至保底 40%
                const rg = b.range || 9999;
                const fo = (b.traveled || 0) <= rg ? 1 : Math.max(0.4, 1 - 0.6 * ((b.traveled - rg) / rg));
                applyDamageToZombie(hit, Math.max(1, Math.round(b.damage * fo)), b.penArmor || 1);
                hit.hurtFlash = 0.12;
                if (b.owner) hit._lastHitBy = b.owner;
                if (b.slow) AudioSystem.playSnowpeaHit();
                else playZombieHitSound(hit, () => AudioSystem.playBulletHit());
                if (b.slow) {
                    hit._slowed = true;
                    hit._slowTimer = b.slow.duration;
                    hit._slowAmount = b.slow.amount;
                }
                state.effects.push({ kind: 'hit', x: b.x, y: b.y, life: 0.15, maxLife: 0.15 });
                // 穿透：未达穿透上限则穿过该僵尸继续飞行
                if ((b.pierced || 0) < (b.pierce || 0)) {
                    b.pierced = (b.pierced || 0) + 1;
                    (b.hitList = b.hitList || []).push(hit);
                } else {
                    state.bullets.splice(i, 1);
                }
                continue;
            }
        }

        // 传统行命中（植物发射的非自由子弹）：按僵尸碰撞体积（圆形 22px）判定，兼容斜射弹道
        if (!b.enemy && !b.friendly && b.row != null) {
            // 多个目标重叠时命中最前（x 最小）的僵尸
            let hit = null;
            for (const z of state.zombies) {
                const dx = z.x - b.x, dy = z.y - b.y;
                if (z.row === b.row && z.hp > 0 && dx * dx + dy * dy < 484) {
                    if (!hit || z.x < hit.x) hit = z;
                }
            }
            if (hit) {
                const z = hit;
                applyDamageToZombie(z, b.damage);
                z.hurtFlash = 0.12;
                if (b.owner) z._lastHitBy = b.owner;
                if (b.slow) AudioSystem.playSnowpeaHit();
                else playZombieHitSound(z, () => AudioSystem.playBulletHit());
                if (b.slow) {
                    z._slowed = true;
                    z._slowTimer = b.slow.duration;
                    z._slowAmount = b.slow.amount;
                }
                state.effects.push({ kind: 'hit', x: b.x, y: b.y, life: 0.15, maxLife: 0.15 });
                state.bullets.splice(i, 1);
            }
        }
    }
}

// 联机击杀公告：归属玩家的击杀生成播报特效（label 格式 "玩家名|僵尸名"）
function pushKillFeed(z, def) {
    if (!state.mp.active || !z._lastHitBy) return;
    const name = z._lastHitBy === 'host'
        ? (state.mp.hostName || '房主')
        : (state.mp.guestName || '好友');
    state.effects.push({
        kind: 'killfeed', x: 0, y: 0, life: 4, maxLife: 4,
        label: `${name}|${def.name}`,
    });
}

// 更新僵尸
export function updateZombies(dt, DIFFICULTY, dropTable, fragWeights, weaponFragWeights, META, saveFragsFn, saveWeaponFragsFn) {
    let anyKilled = false;

    for (let i = state.zombies.length - 1; i >= 0; i--) {
        const z = state.zombies[i];
        const def = ZOMBIES[z.kind];

        // 眩晕状态
        if (z._stunTimer && z._stunTimer > 0) {
            z._stunTimer -= dt;
            if (z._stunTimer <= 0) z._stunned = false;
            if (z.hurtFlash > 0) z.hurtFlash -= dt;
            // 小推车也能碾压眩晕僵尸
            if (state.mowers[z.row] && z.x < FIELD.left + 40) {
                state.mowers[z.row] = false;
                state.effects.push({ kind: 'mower', x: FIELD.left + 40, y: z.y, row: z.row, life: 1.57, maxLife: 1.57 });
                AudioSystem.playLawnmower();
                for (let j = state.zombies.length - 1; j >= 0; j--) {
                    if (state.zombies[j].row === z.row) state.zombies[j].hp = 0;
                }
                continue;
            }
            if (z.hp <= 0) {
                state.effects.push({ kind: 'dead', x: z.x, y: z.y, life: 0.6, maxLife: 0.6, label: def.name });
                pushKillFeed(z, def);
                markZombieSeen(z.kind);
                state._lastKillPos = { x: z.x, y: z.y, row: z.row };
                addPickupReward(z, dropTable, fragWeights, weaponFragWeights, META, saveFragsFn, saveWeaponFragsFn);
                state.zombies.splice(i, 1);
                state.killedTotal++;
                anyKilled = true;
                reportMissionProgress(MISSION_TYPES.KILL_ZOMBIES, 1);
                AudioSystem.playZombieDie();
            }
            continue;
        }

        // 减速处理
        if (z._slowed) {
            z._slowTimer -= dt;
            if (z._slowTimer <= 0) z._slowed = false;
        }

        // 吃植物
        let blocker = null;
        for (const p of state.plants) {
            if (p.row === z.row && p.x < z.x && p.x > z.x - 30 && Math.abs(p.y - z.y) < 40) {
                if (!blocker || p.x > blocker.x) blocker = p;
            }
        }

        // 撑杆僵尸：先跳，跳过吃
        if (def.jumper && !z._jumped) {
            let jumpBlocker = null;
            for (const p of state.plants) {
                if (p.row === z.row && p.x < z.x && p.x > z.x - 60 && Math.abs(p.y - z.y) < 40 && (!jumpBlocker || p.x > jumpBlocker.x)) {
                    jumpBlocker = p;
                }
            }
            if (jumpBlocker) {
                // 跳到该行所有前方植物的右侧
                let maxX = jumpBlocker.x;
                for (const p of state.plants) {
                    if (p.row === z.row && p.x < z.x && p.x > maxX) maxX = p.x;
                }
                z.x = maxX - 80;
                z._jumped = true;
                z.speed = 20; // 跳跃后恢复普僵速度（原版一致）
                state.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.3, maxLife: 0.3, label: '跳' });
                AudioSystem.playPoleVault();
            } else {
                z.x -= z.speed * dt * (z._slowed ? (1 - z._slowAmount) : 1);
            }
        } else if (blocker) {
            z.eating = blocker;
            applyDamageToPlant(blocker, def.damage * dt);
            blocker.shake = 0.1;
            z._biteTimer = (z._biteTimer || 0) - dt;
            if (z._biteTimer <= 0) {
                z._biteTimer = 0.6;
                // 啃带防具的植物时播放防具受击音
                if ((blocker.armorHp || 0) > 0) AudioSystem.playArmoredHurt();
                else AudioSystem.playZombieEating();
            }
        } else {
            z.eating = null;
            z.x -= z.speed * dt * (z._slowed ? (1 - z._slowAmount) : 1);
        }

        if (z.hurtFlash > 0) z.hurtFlash -= dt;

        // 小推车拦截
        if (state.mowers[z.row] && z.x < FIELD.left + 40) {
            state.mowers[z.row] = false;
            state.effects.push({ kind: 'mower', x: FIELD.left + 40, y: z.y, row: z.row, life: 1.57, maxLife: 1.57 });
            AudioSystem.playLawnmower();
            for (let j = state.zombies.length - 1; j >= 0; j--) {
                if (state.zombies[j].row === z.row) {
                    state.zombies[j].hp = 0;
                }
            }
            continue;
        }
        // 到家 = 失败
        if (z.x < FIELD.left - 10) {
            if (state._trDaveInv || state._trPlantInv) {
                z.x = FIELD.left - 10;
                if (!state.mowers[z.row]) state.mowers[z.row] = true;
            } else {
                return { gameOver: true };
            }
        }

        // 死亡检查
        if (z.hp <= 0) {
            state.effects.push({ kind: 'dead', x: z.x, y: z.y, life: 0.6, maxLife: 0.6, label: def.name });
            pushKillFeed(z, def);
            markZombieSeen(z.kind);
            state._lastKillPos = { x: z.x, y: z.y, row: z.row };
            addPickupReward(z, dropTable, fragWeights, weaponFragWeights, META, saveFragsFn, saveWeaponFragsFn);
            state.zombies.splice(i, 1);
            state.killedTotal++;
            anyKilled = true;
            reportMissionProgress(MISSION_TYPES.KILL_ZOMBIES, 1);
            AudioSystem.playZombieDie();
        }
    }

    return { anyKilled };
}
