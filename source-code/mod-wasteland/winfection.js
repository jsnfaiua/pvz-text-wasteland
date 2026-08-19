// 视觉感染纯规则：不依赖DOM。健康实体保持像素形态，只有感染后才显露文字结构。
// v1.12新增：玩家功能性感染阶段（0-5）与游戏效果。

export const INFECTION_VISUAL = {
    healthyMax: 0.46,
    partialMax: 0.82,
    partialMinLevel: 0.28,
    partialMaxLevel: 0.68,
    fullMinLevel: 0.86,
};

export function infectionLevelFromRoll(roll) {
    const r = Math.max(0, Math.min(0.999999, roll));
    if (r < INFECTION_VISUAL.healthyMax) return 0;
    if (r < INFECTION_VISUAL.partialMax) {
        const t = (r - INFECTION_VISUAL.healthyMax) / (INFECTION_VISUAL.partialMax - INFECTION_VISUAL.healthyMax);
        return INFECTION_VISUAL.partialMinLevel + t * (INFECTION_VISUAL.partialMaxLevel - INFECTION_VISUAL.partialMinLevel);
    }
    const t = (r - INFECTION_VISUAL.partialMax) / (1 - INFECTION_VISUAL.partialMax);
    return INFECTION_VISUAL.fullMinLevel + t * (1 - INFECTION_VISUAL.fullMinLevel);
}

export function worldInfectionLevel(hashValue, region = 'suburb') {
    const shift = region === 'ruins' ? 0.18 : region === 'urban' ? 0.06 : region === 'wild' ? -0.08 : 0;
    return infectionLevelFromRoll(Math.max(0, Math.min(0.999999, hashValue + shift)));
}

export function infectionBand(level) {
    if (level <= 0) return 'healthy';
    if (level < INFECTION_VISUAL.fullMinLevel) return 'partial';
    return 'text';
}

// v3.63 感染机制重写：每 1% 感染 → 角色所有属性降低约 0.5%（速度/血量/伤害/拾取/治疗……统一按总乘子削弱）。
// 即 100% 感染时属性 ≤ 50%（≤ 0.5 乘子），stage 5（≥ 90% 感染）maxHpMul < 0.5。感染到 100% 仍触发致死。
// 阶段名（用于 UI 浮字）：连续值用以下阈值划分（保留视觉分段）。
const INF_STAGE_THRESHOLDS = [
    { stage: 0, name: '完整', min: 0,   desc: '身体完好，无文字侵蚀痕迹' },
    { stage: 1, name: '浮字', min: 10,  desc: '皮肤表面偶发字符闪烁，可被检测' },
    { stage: 2, name: '缺口', min: 25,  desc: '局部像素缺失被字块填充，对应部位能力下降' },
    { stage: 3, name: '字骨', min: 45,  desc: '笔画替代肌肉与骨骼，动作僵硬' },
    { stage: 4, name: '失名', min: 70,  desc: '身份词残缺，记忆与认知开始异常' },
    { stage: 5, name: '文尸', min: 90,  desc: '像素身份即将被文字结构完全取代' },
];
// v3.63 每 1% 感染 → 角色所有属性降低 0.5%（用户规则）。
// 计算公式：totalMul = 1 - (v / 100) * 0.5 → 感染 100% 时属性 = 50%（0.5 乘子），感染 50% 时属性 = 75%。
// 本常量作为 metadata 暴露（保持代码与公式严格匹配）。
const INF_ATTR_DECAY_PER_PCT = 0.005;   // 0.5% / 1%感染（每 1% 削弱率）
export const PLAYER_INFECTION = {
    max: 100,
    stages: INF_STAGE_THRESHOLDS,
    zombieHitChance: 0.18,
    zombieHitAmount: [2, 6],
    infectedGlyphUseAmount: 8,
    bedRestRecovery: 5,
    naturalDecayPerDay: 0,
    // v3.63 单点属性削弱系数（每 1% 感染 = 0.5%）：0%→1.0×，50%→0.75×，100%→0.5×
    attrDecayPerPct: INF_ATTR_DECAY_PER_PCT,
};

export function playerInfectionStage(value) {
    const v = Math.max(0, Math.min(PLAYER_INFECTION.max, value));
    let result = INF_STAGE_THRESHOLDS[0];
    for (const entry of INF_STAGE_THRESHOLDS) {
        if (v >= entry.min) result = entry;
    }
    return result;
}

// v3.63 感染属性总乘子：1 - (infection/100) * 0.5 = 0.5~1.0 连续值。
// 所有依赖此函数的位置（玩家/NPC 的速度、血上限、伤害、治疗量……）都自动按此削弱。
export function playerInfectionEffects(value) {
    const stage = playerInfectionStage(value);
    const v = Math.max(0, Math.min(PLAYER_INFECTION.max, value));
    const totalMul = Math.max(0.5, 1 - (v / PLAYER_INFECTION.max) * 0.5);
    return {
        stage: stage.stage,
        name: stage.name,
        speedMul: totalMul,
        maxHpMul: totalMul,
        damageMul: totalMul,
        attrDecayPerPct: INF_ATTR_DECAY_PER_PCT,
        totalMul,
        desc: stage.desc,
    };
}

export function addPlayerInfection(current, amount) {
    return Math.max(0, Math.min(PLAYER_INFECTION.max, current + amount));
}

// v4.28 感染随感染值升高而加速（用户需求："侵蚀效果随随时间加速而加速侵蚀"）：
// 感染值越高，自动侵蚀速率越快——低感染时缓慢（有缓冲期），高感染时急速恶化（不治必死的压迫感）。
// 基础速率由调用方传入（wbalance.INFECTION_AUTO_GROW_PER_SEC），加速系数按感染值：
//   growthRate = 基础速率 × (1 + 感染值/50)
//   0%  → ×1.0（0.4/s，约 4 分钟到满）
//   25% → ×1.5（0.6/s）
//   50% → ×2.0（0.8/s）
//   75% → ×2.5（1.0/s）
//   90% → ×2.8（1.12/s，最后 10% 极快）
export function infectionAutoGrowAmount(basePerSec, currentInfection, dt) {
    const rate = basePerSec * (1 + Math.max(0, Math.min(100, currentInfection || 0)) / 50);
    return rate * dt;
}

export function rollZombieInfection(random = Math.random) {
    if (random() > PLAYER_INFECTION.zombieHitChance) return 0;
    const [lo, hi] = PLAYER_INFECTION.zombieHitAmount;
    return lo + Math.floor(random() * (hi - lo + 1));
}
