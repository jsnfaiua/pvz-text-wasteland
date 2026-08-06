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

export const PLAYER_INFECTION = {
    max: 100,
    stages: [
        { stage: 0, name: '完整', min: 0,   speedMul: 1.0,  hpMul: 1.0,  desc: '身体完好，无文字侵蚀痕迹' },
        { stage: 1, name: '浮字', min: 10,  speedMul: 0.95, hpMul: 1.0,  desc: '皮肤表面偶发字符闪烁，可被检测' },
        { stage: 2, name: '缺口', min: 25,  speedMul: 0.88, hpMul: 0.9,  desc: '局部像素缺失被字块填充，对应部位能力下降' },
        { stage: 3, name: '字骨', min: 45,  speedMul: 0.78, hpMul: 0.8,  desc: '笔画替代肌肉与骨骼，动作僵硬' },
        { stage: 4, name: '失名', min: 70,  speedMul: 0.65, hpMul: 0.65, desc: '身份词残缺，记忆与认知开始异常' },
        { stage: 5, name: '文尸', min: 90,  speedMul: 0.5,  hpMul: 0.4,  desc: '像素身份即将被文字结构完全取代' },
    ],
    zombieHitChance: 0.18,
    zombieHitAmount: [2, 6],
    infectedGlyphUseAmount: 8,
    bedRestRecovery: 5,
    naturalDecayPerDay: 0,
};

export function playerInfectionStage(value) {
    const v = Math.max(0, Math.min(PLAYER_INFECTION.max, value));
    let result = PLAYER_INFECTION.stages[0];
    for (const entry of PLAYER_INFECTION.stages) {
        if (v >= entry.min) result = entry;
    }
    return result;
}

export function playerInfectionEffects(value) {
    const stage = playerInfectionStage(value);
    return {
        stage: stage.stage,
        name: stage.name,
        speedMul: stage.speedMul,
        maxHpMul: stage.hpMul,
        desc: stage.desc,
    };
}

export function addPlayerInfection(current, amount) {
    return Math.max(0, Math.min(PLAYER_INFECTION.max, current + amount));
}

export function rollZombieInfection(random = Math.random) {
    if (random() > PLAYER_INFECTION.zombieHitChance) return 0;
    const [lo, hi] = PLAYER_INFECTION.zombieHitAmount;
    return lo + Math.floor(random() * (hi - lo + 1));
}
