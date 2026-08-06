// ============================================================
// 波次合成系统（对齐原版植物大战僵尸1）
// 单机和联机房主共用，保证两端出怪完全一致
//
// 原版机制要点：
// - 每面旗帜 = 10 波，第 10 波为旗帜波（"一大波僵尸正在接近！"）
// - 每波点数预算 = floor(floor(波数 * 0.8) / 2) + 1，旗帜波 * 2.5 取整
// - 僵尸点数：普僵/旗帜 1，路障/撑杆 2，铁桶/铁门 4
// - 阶数限制：一阶（普/路障/铁桶）第 1 波起，二阶（撑杆/铁门）第 5 波起
// - 旗帜波固定有且仅有 1 只旗帜僵尸
// - 整波僵尸同时出现，不是逐个刷出
// - 下一波触发：固定间隔（约 28s）到点即出，不强制清场；
//   场上僵尸总血量低于本波 50% 时提前加速下一波
// ============================================================

import { ZOMBIES } from '../core/constants.js';

// 僵尸点数（原版 spawn points）
export const ZOMBIE_POINTS = {
    normal: 1, flag: 1, cone: 2, pole: 2, bucket: 4, door: 4,
};

// 阶数限制：僵尸最早可出现的波数
const TIER_MIN_WAVE = {
    normal: 1, flag: 1, cone: 1, bucket: 1, pole: 5, door: 5,
};

// 每波点数预算（原版公式）
export function wavePointBudget(wave, isFlag) {
    let p = Math.floor(Math.floor(wave * 0.8) / 2) + 1;
    if (isFlag) p = Math.floor(p * 2.5);
    return p;
}

// 普通小波保底超时：25~31 秒随机（文档规则），乘以难度 restMul
export function nextWaveTimeout(restMul = 1) {
    return (25 + Math.random() * 6) * (restMul || 1);
}

// 预生成整关出怪列表（原版在选卡界面就已确定全部波次的出怪）
// 返回 [[kind, ...], ...]，下标 = 波数 - 1
export function buildLevelSpawnList(maxWave, zombiePool, countMul = 1) {
    // 僵尸池去 flag（旗帜僵尸单独固定添加）；池内重复条目即出现权重
    const pool = (zombiePool && zombiePool.length ? zombiePool : ['normal'])
        .filter(k => k !== 'flag' && ZOMBIES[k]);
    const list = [];
    for (let w = 1; w <= maxWave; w++) {
        // 旗帜僵尸仅在第 10/20/30... 整十波出现；最终波非整十则不生成（文档规则）
        const isFlag = (w % 10 === 0);
        let avail = pool.filter(k => w >= (TIER_MIN_WAVE[k] || 1));
        if (isFlag) {
            // 旗帜大波：铁桶/铁门等重甲（点数≥4）刷新概率提升 3 倍
            const heavy = avail.filter(k => (ZOMBIE_POINTS[k] || 1) >= 4);
            avail = avail.concat(heavy, heavy);
        }
        // 强度系数 0.85：控制关卡难度，让玩家有七至八成把握过关
        let budget = Math.max(1, Math.round(wavePointBudget(w, isFlag) * countMul * 0.85));
        const comp = [];
        let guard = 60; // 防爆保护
        while (budget > 0 && guard-- > 0) {
            const affordable = avail.filter(k => (ZOMBIE_POINTS[k] || 1) <= budget);
            if (!affordable.length) break;
            const kind = affordable[Math.floor(Math.random() * affordable.length)];
            comp.push(kind);
            budget -= ZOMBIE_POINTS[kind] || 1;
        }
        if (comp.length === 0) comp.push('normal');
        // 非旗帜小波：不再永远单只——45% 概率成群，随机补到 2~3 只
        if (!isFlag && comp.length < 3 && Math.random() < 0.45 && avail.length) {
            const extra = Math.random() < 0.5 ? 1 : 2;
            for (let i = 0; i < extra && comp.length < 3; i++) {
                comp.push(avail[Math.floor(Math.random() * avail.length)]);
            }
        }
        if (isFlag) comp.unshift('flag'); // 旗帜波固定 1 只旗帜僵尸，带队出现
        list.push(comp);
    }
    return list;
}

// 出怪列表总击杀数（进度条用）
export function totalKillsOfSpawnList(list) {
    if (!list || !list.length) return 0;
    return list.reduce((a, c) => a + c.length, 0);
}
