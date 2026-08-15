// ============================================================
// 【无尽植僵荒原】模组 · 尸潮系统（M7）
// 预警 → 准备窗口 → 分批刷怪 → 全灭判定 → 奖励
// ============================================================

import { AMMO_INFO } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import { TS } from './wconst.js';
import { isWalk, getTile } from './world.js';
import { spawnZombie } from './wzombie.js';
import * as MSG from './wmsg.js';
import * as B from './wbalance.js';

function log(sv, msg, color) { MSG.pushMsg(sv, msg, color); }

export function startHordePrep(sv) {
    startHordeWave(sv);
}

export function updateHorde(sv, dt, canStand) {
    const h = sv.horde;
    if (h.pending > 0) {
        h.batchT -= dt;
        if (h.batchT <= 0) {
            h.batchT = B.HORDE_BATCH_INTERVAL_MIN + Math.random() * B.HORDE_BATCH_INTERVAL_RAND;
            const n = Math.min(h.pending, B.HORDE_BATCH_MIN + Math.floor(Math.random() * B.HORDE_BATCH_RAND));
            // 同时在场上限（高天数尸潮 total 无上限）：到场达上限即暂缓，本批剩余保留
            // pending（下批 batchT 再放）——防 100+ 僵尸常驻卡顿（审查 M3）
            const cap = B.HORDE_MAX_ONFIELD || 45;
            let spawned = 0;
            for (let i = 0; i < n; i++) {
                if (sv.zombies.length >= cap) break;
                if (spawnHordeZombie(sv, canStand)) spawned++;
            }
            h.pending -= spawned;
        }
    }
}

function startHordeWave(sv) {
    const mul = (B.DIFF_TABLE[sv.diffKey] || B.DIFF_TABLE.normal).mul;
    const total = Math.max(3, Math.round((B.HORDE_COUNT_BASE + B.HORDE_COUNT_PER_DAY * sv.day) * mul));
    sv.horde = { phase: 'wave', pending: total, total, batchT: 0 };
    sv.announce = { text: '尸潮来了！', t: 2.5, color: '#FF3333' };
    AudioSystem.playWaveWarning();
    // 旗帜领头：尸潮开始时生成一只旗帜僵尸（加速光环）
    for (let tries = 0; tries < 12; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (B.HORDE_SPAWN_DIST_MIN + Math.random() * B.HORDE_SPAWN_DIST_RAND) * TS;
        const x = sv.px + Math.cos(ang) * d, y = sv.py + Math.sin(ang) * d;
        const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
        if (isWalk(getTile(sv, gx, gy))) { spawnZombie(sv, 'flag', x, y, true); break; }
    }
    // 尸潮首领（D）：第 3 天起每次尸潮 25% 概率额外刷一只巨字尸（高血高伤，掉传送宝石）
    if (sv.day >= B.Z_GIANT_UNLOCK_DAY && Math.random() < B.Z_GIANT_HORDE_CHANCE) {
        for (let tries = 0; tries < 12; tries++) {
            const ang = Math.random() * Math.PI * 2;
            const d = (B.HORDE_SPAWN_DIST_MIN + Math.random() * B.HORDE_SPAWN_DIST_RAND) * TS;
            const x = sv.px + Math.cos(ang) * d, y = sv.py + Math.sin(ang) * d;
            const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
            if (isWalk(getTile(sv, gx, gy))) {
                spawnZombie(sv, 'giant', x, y, true);
                sv.announce = { text: '⚠ 巨字尸出现了！', t: 3, color: '#FF33AA' };
                AudioSystem.playWaveWarning();
                break;
            }
        }
    }
}

function spawnHordeZombie(sv, canStand) {
    for (let tries = 0; tries < 14; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = (B.HORDE_SPAWN_DIST_MIN + Math.random() * B.HORDE_SPAWN_DIST_RAND) * TS;
        const x = sv.px + Math.cos(ang) * dist;
        const y = sv.py + Math.sin(ang) * dist;
        if (!canStand(x, y)) continue;
        const day = sv.day;
        const coneC = day >= B.HORDE_CONE_DAY ? Math.min(0.15 + day * 0.03, 0.4) : 0;
        const bucketC = day >= B.HORDE_BUCKET_DAY ? Math.min(0.05 + (day - B.HORDE_BUCKET_DAY) * 0.03, 0.25) : 0;
        const poleC = day >= B.Z_POLE_UNLOCK_DAY ? Math.min(0.06 + day * 0.01, 0.18) : 0;
        const doorC = day >= B.Z_DOOR_UNLOCK_DAY ? Math.min(0.04 + (day - B.Z_DOOR_UNLOCK_DAY) * 0.01, 0.14) : 0;
        const r = Math.random();
        let type;
        if (r < doorC) type = 'door';
        else if (r < doorC + poleC) type = 'pole';
        else if (r < doorC + poleC + bucketC) type = 'bucket';
        else if (r < doorC + poleC + bucketC + coneC) type = 'cone';
        else type = 'normal';
        spawnZombie(sv, type, x, y, true);
        return true;   // 生成成功（供调用方按实际生成数扣 pending）
    }
    return false;   // 14 次都找不到可站位（周围全障碍）——不算生成
}

export function checkHordeEnd(sv, saveNow) {
    if (sv.horde.pending > 0) return false;
    if (sv.zombies.some(z => z.horde)) return false;
    sv.horde = null;
    sv.announce = { text: '尸潮已击退！', t: 3, color: '#7DFF7D' };
    AudioSystem.playVictory();
    dropHordeRewards(sv);
    saveNow();
    return true;
}

function dropHordeRewards(sv) {
    const rewards = [];
    rewards.push(['wood', 2 + Math.floor(Math.random() * 3)]);
    // 2026-08-12 v3.7 尸潮奖励给具体食物（与搜刮掉落一致）
    const _fd = ['food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon'][Math.floor(Math.random() * 7)];
    rewards.push([_fd, 1 + Math.floor(Math.random() * 2)]);
    const at = B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)];
    rewards.push(['ammo:' + at, Math.max(4, Math.round(((AMMO_INFO[at] || {}).pack || 20) * 0.5))]);
    if (sv.day >= B.REWARD_WEAPON_DAY && Math.random() < B.REWARD_WEAPON_CHANCE) {
        const pool = [...B.LOOT_WEAPONS.common, ...B.LOOT_WEAPONS.rare];
        rewards.push(['wpn:' + pool[Math.floor(Math.random() * pool.length)], 1]);
    }
    if (sv.day >= B.REWARD_EPIC_DAY && Math.random() < B.REWARD_EPIC_CHANCE) {
        if (Math.random() < 0.5) {
            rewards.push(['wpn:' + B.LOOT_WEAPONS.epic[Math.floor(Math.random() * B.LOOT_WEAPONS.epic.length)], 1]);
        } else {
            rewards.push(['gem', 1 + Math.floor(Math.random() * 2)]);
        }
    }
    // 守城奖励：30% 概率掉领地旗帜（扩大建营途径）
    if (Math.random() < 0.30) rewards.push(['flag', 1]);
    for (const [id, n] of rewards.slice(0, 4)) {
        let x = sv.px, y = sv.py;
        for (let tries = 0; tries < 8; tries++) {
            const ang = Math.random() * Math.PI * 2;
            const d = (1 + Math.random()) * TS;
            const cx = sv.px + Math.cos(ang) * d, cy = sv.py + Math.sin(ang) * d;
            const gx = Math.floor(cx / TS), gy = Math.floor(cy / TS);
            x = cx; y = cy; break;
        }
        sv.drops.push({ x, y, id, n });
    }
    log(sv, '守住了！尸潮奖励掉落在你身边');
}
