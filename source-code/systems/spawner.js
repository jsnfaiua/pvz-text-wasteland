// ============================================================
// 生成系统：僵尸生成、阳光掉落、拾取物管理
// ============================================================

import { FIELD, DIFFICULTY, ZOMBIES, PLANTS, WEAPONS, PICKUP_DEFS, DROP_TABLE,
    ZOMBIE_FRAG_WEIGHTS, WEAPON_FRAG_WEIGHTS } from '../core/constants.js';
import { state, dave } from '../core/state.js';
import { randInt, pickWeighted } from '../core/utils.js';
import { META, saveFragments, saveWeaponFrags } from '../persistence/storage.js';
import { reportMissionProgress, MISSION_TYPES } from './missions.js';
import AudioSystem from './audio.js';

// 生成僵尸（forceKind：波次系统按预生成列表指定种类；withSound：整波同出时限量播音防爆音）
export function spawnZombie(state, DIFFICULTY, LEVELS, forceKind = null, withSound = true) {
    let kind = forceKind;

    if (!kind) {
        // 使用关卡的僵尸池（如果有）
        if (state._zombiePool && state._zombiePool.length > 0) {
            kind = state._zombiePool[Math.floor(Math.random() * state._zombiePool.length)];
        } else {
            // 默认逻辑
            kind = 'normal';
            const r = Math.random();
            if (state.wave >= 5 && r < 0.20) kind = 'bucket';
            else if (state.wave >= 3 && r < 0.50) kind = 'cone';
        }
    }

    const def = ZOMBIES[kind];
    const row = FIELD.activeRows[Math.floor(Math.random() * FIELD.activeRows.length)];
    const hp = def.hp * DIFFICULTY.hpMul;
    const armorHp = (def.armorHp || 0) * DIFFICULTY.hpMul;
    const speed = def.speed * (0.9 + Math.random() * 0.2) * DIFFICULTY.speedMul; // 原版 ±10% 移速浮动

    state.zombies.push({
        kind,
        x: FIELD.right + 20,
        row,
        // 行内随机纵向位置（±28% 行高），不再全部从行中心出现
        y: FIELD.top + FIELD.rowHeight * (row + 0.5) + (Math.random() - 0.5) * FIELD.rowHeight * 0.56,
        hp,
        maxHp: hp,
        armorHp,
        maxArmorHp: armorHp,
        armorBroken: false,
        speed,
        eating: null,
        hurtFlash: 0,
    });

    state.zombiesSpawned++;
    if (withSound) AudioSystem.playZombieSpawn();
}

// 生成自然阳光
export function spawnNaturalSun(state) {
    const x = FIELD.left + 40 + Math.random() * (FIELD.right - FIELD.left - 80);
    const value = state.doubleSun ? 50 : 25;
    state.suns.push({
        x, y: FIELD.top - 10,
        targetY: FIELD.top + 40 + Math.random() * (FIELD.bottom - FIELD.top - 80),
        vy: 40, value, life: 13, // 原版：阳光留存 13 秒
    });
}

// 在指定位置生成阳光
export function spawnSunAt(state, x, y, value = 25) {
    state.suns.push({
        x, y, targetY: y + 30, vy: 60, value, life: 13,
    });
}

// 生成拾取物
export function spawnPickup(state, x, y, kind, amount, extra = null) {
    const dx = (Math.random() - 0.5) * 20;
    const dy = (Math.random() - 0.5) * 20;
    state.pickups.push({
        kind, x: x + dx, y: y + dy,
        amount: amount || 1,
        extra,
        vy: -80,
        life: 12,
        hopPhase: 0,
    });
}

// 更新阳光和拾取物（player2 可选：联机时同时处理第二名玩家的接触拾取；
// onEvent 可选：拾取事件回调，联机房主用来广播给客人播放音效/特效）
export function updateSunsAndPickups(dt, player, FIELD, state, addCurrencyFn, player2 = null, onEvent = null) {
    const playerY = player.y - player.jumpOffset;
    const player2Y = player2 ? player2.y - player2.jumpOffset : 0;
    const PICK_R = 30;
    const nearPicker = (x, y) =>
        Math.hypot(x - player.x, y - playerY) < PICK_R ? player
        : (player2 && Math.hypot(x - player2.x, y - player2Y) < PICK_R ? player2 : null);

    // 阳光
    for (let i = state.suns.length - 1; i >= 0; i--) {
        const s = state.suns[i];
        if (s.y < s.targetY) {
            s.y += s.vy * dt;
            if (s.y > s.targetY) s.y = s.targetY;
        }
        // 拾取（任一玩家走近均可拾取，阳光共享）
        if (nearPicker(s.x, s.y)) {
            state.sun += s.value;
            if (onEvent) onEvent({ type: 'sun', x: s.x, y: s.y, value: s.value });
            reportMissionProgress(MISSION_TYPES.COLLECT_SUN, s.value);
            const sunEl = document.getElementById('sun-display');
            const canvas = document.getElementById('game');
            const cr = canvas.getBoundingClientRect();
            const sr = sunEl ? sunEl.getBoundingClientRect() : { left: 120, top: 35 };
            const tx = (sr.left + sr.width / 2 - cr.left) * (canvas.width / cr.width);
            const ty = (sr.top + sr.height / 2 - cr.top) * (canvas.height / cr.height);
            state.effects.push({
                kind: 'sunfly', x: s.x, y: s.y,
                tx, ty,
                life: 0.4, maxLife: 0.4, label: `+${s.value}`,
            });
            state.effects.push({
                kind: 'sunpop', x: tx + 16, y: ty - 8,
                life: 0.6, maxLife: 0.6, label: `+${s.value}`,
            });
            AudioSystem.playCollect();
            state.suns.splice(i, 1);
            continue;
        }
        s.life -= dt;
        if (s.life <= 0) state.suns.splice(i, 1);
    }

    // 自然阳光生成（提速：每 16~20 秒随机掉落 1 颗，配合难度控制）
    state.naturalSunTimer = (state.naturalSunTimer || 8) - dt;
    if (state.naturalSunTimer <= 0) {
        state.naturalSunTimer = 16 + Math.random() * 4;
        spawnNaturalSun(state);
    }

    // 拾取物
    for (let i = state.pickups.length - 1; i >= 0; i--) {
        const p = state.pickups[i];
        p.y += p.vy * dt;
        p.vy += 240 * dt;
        if (p.vy > 0 && p.y > FIELD.bottom - 20) {
            p.y = FIELD.bottom - 20;
            p.vy = 0;
        }
        p.hopPhase = (p.hopPhase || 0) + dt * 3;
        p.life -= dt;
        if (p.life <= 0) { state.pickups.splice(i, 1); continue; }

        // 接触拾取（任一玩家走近均可拾取）
        const picker = nearPicker(p.x, p.y);
        if (picker) {
            collectPickup(p, addCurrencyFn, picker);
            if (onEvent) onEvent({
                type: 'pickup', kind: p.kind, x: p.x, y: p.y,
                extra: p.extra, amount: p.amount,
                p2: (player2 && picker === player2) || undefined,
            });
            state.pickups.splice(i, 1);
        }
    }
}

// 钱袋内容：重打/联机胜利奖励（随机 3~5 份，银为主、金次之、低概率钻）
export function rollBagLoot(rewardMul = 1) {
    const rolls = 3 + Math.floor(Math.random() * 3);
    const loot = [];
    for (let i = 0; i < rolls; i++) {
        const r = Math.random();
        if (r < 0.55) {
            loot.push({ kind: 'silver', amount: Math.max(1, Math.round((3 + Math.random() * 10) * rewardMul)) });
        } else if (r < 0.9) {
            loot.push({ kind: 'gold', amount: Math.max(1, Math.round((1 + Math.random() * 4) * rewardMul)) });
        } else {
            loot.push({ kind: 'gem', amount: 1 });
        }
    }
    return loot;
}

// 收集拾取物（picker：实际拾取的玩家，治疗类效果作用于拾取者）
function collectPickup(p, addCurrencyFn, picker = null) {
    // 货币：拾取瞬间对应颜色的爆光粒子；入账与音效由回调（钱币逐枚飞行落袋）完成
    if (p.kind === 'silver' || p.kind === 'gold' || p.kind === 'gem') {
        const color = p.kind === 'gold' ? '#FFD700' : p.kind === 'gem' ? '#66FFFF' : '#C0C0FF';
        const seeds = [];
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
            seeds.push({ dx: Math.cos(a), dy: Math.sin(a) });
        }
        state.effects.push({ kind: 'coinburst', x: p.x, y: p.y, color, seeds, life: 0.4, maxLife: 0.4, _local: true });
        addCurrencyFn(p.kind, p.amount, picker, p.x, p.y);
    } else if (p.kind === 'heal') {
        const target = picker || dave;
        target.hp = Math.min(target.maxHp || 200, target.hp + 20);
    } else if (p.kind === 'armor') {
        // 头盔直接戴到拾取者头上：护甲值 = 掉落量，受击时先吸收伤害
        const target = picker || dave;
        const aType = p.extra ? p.extra.armorType : 'cone';
        target.armor = {
            type: aType,
            name: aType === 'bucket' ? '铁桶头盔' : '路障头盔',
            hp: p.amount,
            maxHp: p.amount,
        };
    }
    // 其他类型（碎片、即用卡）简化处理
    if (p.kind === 'fragment' && p.extra) {
        // 植物碎片：入碎片背包 + 本局收获统计 + 浮字提示
        // 联机下客人拾取的碎片：此处（房主端 collectPickup）跳过，
        // 由 mpGame 的拾取回调统一补双方入账（资源共享，谁捡双方都有份）
        if (state.mp && state.mp.active && picker && picker !== dave) return;
        META.fragments[p.extra] = (META.fragments[p.extra] || 0) + p.amount;
        saveFragments(META.fragments);
        if (state.roundRewards) {
            state.roundRewards.fragments = state.roundRewards.fragments || {};
            state.roundRewards.fragments[p.extra] = (state.roundRewards.fragments[p.extra] || 0) + p.amount;
        }
        const pname = PLANTS[p.extra] ? PLANTS[p.extra].name : '植物';
        state.effects.push({ kind: 'pickup', x: p.x, y: p.y, life: 0.8, maxLife: 0.8, label: `${pname}碎片×${p.amount}`, _local: true });
        AudioSystem.playClick();
    } else if (p.kind === 'wfrag' && p.extra) {
        // 武器碎片：入武器碎片背包（图鉴解锁/升级武器用）
        // 联机下客人拾取时此处跳过，由 mpGame 回调统一补双方入账（同上）
        if (state.mp && state.mp.active && picker && picker !== dave) return;
        META.weaponFrags[p.extra] = (META.weaponFrags[p.extra] || 0) + p.amount;
        saveWeaponFrags(META.weaponFrags);
        if (state.roundRewards) {
            state.roundRewards.wfrags = state.roundRewards.wfrags || {};
            state.roundRewards.wfrags[p.extra] = (state.roundRewards.wfrags[p.extra] || 0) + p.amount;
        }
        const wname = WEAPONS[p.extra] ? WEAPONS[p.extra].name : '武器';
        state.effects.push({ kind: 'pickup', x: p.x, y: p.y, life: 0.8, maxLife: 0.8, label: `${wname}碎片×${p.amount}`, _local: true });
        AudioSystem.playClick();
    }
}

// 掉落奖励（僵尸死亡）
export function addPickupReward(z, dropTable, fragWeights, weaponFragWeights, META, saveFragsFn, saveWeaponFragsFn) {
    if (state._trActive) return;
    const table = dropTable[z.kind] || dropTable.normal;
    const rate = DIFFICULTY.dropRateMul || 1;
    const rew = DIFFICULTY.rewardMul || 1;

    // 护甲掉落（有甲僵尸死亡必定掉落）
    if ((z.maxArmorHp || 0) > 0) {
        const dropArmor = Math.max(1, Math.round(z.maxArmorHp * 0.2));
        spawnPickup(state, z.x, z.y, 'armor', dropArmor, { armorType: z.kind, armorValue: dropArmor });
    }

    // 银币
    if (Math.random() < table.silver.chance * rate) {
        const n = Math.max(1, Math.round(randInt(table.silver.min, table.silver.max) * rew));
        spawnPickup(state, z.x, z.y, 'silver', n);
    }
    // 金币
    if (Math.random() < table.gold.chance * rate) {
        const n = Math.max(1, Math.round(randInt(table.gold.min, table.gold.max) * rew));
        spawnPickup(state, z.x, z.y, 'gold', n);
    }
    // 钻石
    if (table.gem.chance > 0 && Math.random() < table.gem.chance * rate) {
        const n = Math.max(1, randInt(table.gem.min, table.gem.max));
        spawnPickup(state, z.x, z.y, 'gem', n);
    }
    // 血包
    if (Math.random() < table.heal.chance * rate) {
        spawnPickup(state, z.x, z.y, 'heal', 1);
    }
    // 植物碎片（掉落实体，走近拾取后入背包）
    if (Math.random() < table.fragment.chance * rate) {
        const n = Math.max(1, Math.round(randInt(table.fragment.min, table.fragment.max) * rew));
        const plant = pickWeighted(fragWeights[z.kind] || fragWeights.normal);
        spawnPickup(state, z.x, z.y, 'fragment', n, plant);
    }
    // 武器碎片（掉落实体，走近拾取后入背包，图鉴解锁/升级武器用）
    if (table.wfrag && Math.random() < table.wfrag.chance * rate) {
        const n = Math.max(1, Math.round(randInt(table.wfrag.min, table.wfrag.max) * rew));
        const wKey = pickWeighted(weaponFragWeights[z.kind] || weaponFragWeights.normal);
        spawnPickup(state, z.x, z.y, 'wfrag', n, wKey);
    }
}
