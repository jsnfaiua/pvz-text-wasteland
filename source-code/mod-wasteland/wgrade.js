// ============================================================
// 【无尽植僵荒原】物品品级系统（Gear Grade · 独立系统）
// 2026-08-11 v2.98 用户需求：物品品级 = 英文字母，
//   越靠前越厉害（A 最强），默认品质最差 = Z。
//   用户定稿：采用 A 到 Z 全部 26 个字母。
// ============================================================
// 设计要点：
//   ① 品级字母 = A ~ Z 全部 26 个，排序：A(最强) → B → C → ... → Y → Z(最弱/默认)。
//   ② 品级只作为"额外属性乘数"叠加在物品原有属性上——
//      不改变物品类型/基础数值，Z 品级 = 原版属性（0% 加成）。
//   ③ 品级加成按【武器属性】分类加权：伤害为主，射程/弹匣/攻速等次之，
//      防具/工具按对应属性加成；非武器物品（药品/材料）品级无效（保持 Z）。
//   ④ 品级提升是"每级固定百分比递增"，A 品级总加成封顶，避免数值爆炸。
// ============================================================

// 品级字母（A 最强 → Z 最弱）
// 2026-08-11 v2.98 用户定稿：**采用 A 到 Z 全部 26 个字母**——A 最强、Z 最弱/默认。
export const GRADES = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];

// 品级 → 索引（0 = A 最强，23 = Z 最弱）
export function gradeIndex(g) {
    const idx = GRADES.indexOf(g);
    return idx === -1 ? GRADES.length - 1 : idx;   // 未知/空 → Z（最弱）
}

// 默认品级 = Z（最弱）
export const DEFAULT_GRADE = 'Z';

// 品级加成配置（每级递增百分比）
// 伤害/单发伤害：每级 +2.5%，A 品级总加成 = 25级 × 2.5% ≈ +62.5%
// 射程/弹匣/攻速/耐久等次级属性：每级 +1.5%，A 总加成 ≈ +37.5%
export const GRADE_MULT = {
    damagePerLevel: 0.025,     // 每级伤害 +2.5%
    secondaryPerLevel: 0.015,  // 每级次级属性（射程/弹匣/攻速/耐久）+1.5%
    // 按"距离 Z 的级数"计算加成：Z 在索引 25（最后），A 在索引 0
};

// 计算某品级的加成倍率（相对 Z/原版）
// return { damageMul, secondaryMul } —— Z 品级 = 1.0（原版），A 品级最大
export function gradeMul(grade) {
    const idx = gradeIndex(grade);
    const zIdx = GRADES.length - 1;              // 23（Z）
    const steps = zIdx - idx;                    // 距 Z 的级数（A=23 级，Z=0 级）
    return {
        damageMul: 1 + steps * GRADE_MULT.damagePerLevel,
        secondaryMul: 1 + steps * GRADE_MULT.secondaryPerLevel,
    };
}

// 品级显示名（含颜色，用于背包/装备栏显示）
// 颜色按品级强弱：A 金 → 中间青/绿 → Z 灰
export function gradeColor(grade) {
    const idx = gradeIndex(grade);
    // 分段：0-5 金/橙（S级强），6-11 紫/青，12-17 蓝/绿，18-23 灰/暗
    if (idx <= 5) return '#FFD700';      // A~H：金色（强）
    if (idx <= 11) return '#B77BFF';     // J~N：紫色
    if (idx <= 17) return '#66CCFF';     // P~V：蓝色
    return '#9aa0a6';                    // W~Z：灰色（弱）
}

// 品级标签（HUD/背包显示）：品级字母 + 加成概要
export function gradeLabel(grade) {
    const g = grade || DEFAULT_GRADE;
    const { damageMul, secondaryMul } = gradeMul(g);
    const dmgPct = Math.round((damageMul - 1) * 100);
    const secPct = Math.round((secondaryMul - 1) * 100);
    if (dmgPct <= 0 && secPct <= 0) return `${g}`;                 // Z：无加成
    if (secPct <= 0) return `${g} +${dmgPct}%伤`;
    return `${g} +${dmgPct}%伤 +${secPct}%射/匣`;
}

// 品级校验：只对可强化的物品生效（武器 wpn: 前缀；未来可扩展防具）
export function isGradeable(itemId) {
    return !!itemId && String(itemId).startsWith('wpn:');
}

// 读取物品品级（未设置 → Z 默认）
export function itemGrade(item) {
    if (!item) return DEFAULT_GRADE;
    if (item.grade && GRADES.includes(item.grade)) return item.grade;
    return DEFAULT_GRADE;
}

// 对物品基础属性应用品级加成（返回乘数，供 wgear/wzombie 计算实际伤害/射程时使用）
export function gradeApply(item, baseDamage, baseSecondary) {
    const { damageMul, secondaryMul } = gradeMul(itemGrade(item));
    return {
        damage: Math.round(baseDamage * damageMul),
        secondary: Math.round(baseSecondary * secondaryMul),
        damageMul, secondaryMul,
    };
}

// 生成一个带品级的物品对象（克隆原物品 + 追加 grade 字段）
// grade 缺省 = Z（最弱/默认）
export function withGrade(item, grade) {
    if (!item) return item;
    const g = grade || DEFAULT_GRADE;
    return { ...item, grade: g };
}

// 品级说明（背包/详情弹窗展示）
export const GRADE_DESC = `物品品级（A 最强 → Z 最弱，共 26 级）：
· 品级按每级加成：伤害 +2.5%/级，射程·弹匣·攻速 +1.5%/级；
· A 品级伤害约 +62%、次级属性约 +37%；Z 品级 = 原版属性；
· 品级越高颜色越亮（A 金色 → Z 灰色）。

强化（灵石）：
· 击杀僵尸掉落灵石；消耗灵石可把品级升向更高（更接近 A）；
· 灵石消耗：不管当前什么品级，第 1 次强化 1 颗，之后每次翻倍（1/2/4/8…）；
  每次强化（无论成败）都等于升过一级，消耗继续翻倍；B→A 若为第 1 次强化只消耗 1 颗；
· 升级概率：每个品阶概率固定，品阶越高概率越低——
  B→A ≈0.02%（极难），C→B ≈0.04%，往 Z 方向每降一档概率翻倍（低品阶近乎必成）；
· 失败补偿：强化失败品级不变，但下次概率提高当前概率的 50%（×1.5），100% 封顶；
· 开箱/掉落品级：A ≈0.02%（最低）→ B ≈0.04% → … → Z = 100%（默认品级最常见）；
· A 品级为最高，无法再强化。`;

// ============ 品级随机获取（开箱/掉落） ============
// 用户定稿概率模型（A→Z 逐级翻倍，Z 累计 = 100%）：
//   P(摸出 ≥ 品级 i) = 2^i / 2^25（i = 索引，A=0 ... Z=25）
//     Z(25): 2^25/2^25 = 100% ✓（必定是 Z 或更好）
//     Y(24): 50%、X(23): 25%、W(22): 12.5% …… 逐级 ×2（往 Z 翻倍）
//     A(0): 1/2^25 ≈ 0.000003%（最低）
//   P(摸出 = 品级 i) = P(≥i) − P(≥i−1)（差值，总和 = 100%）：
//     Z: 50%、Y: 25%、X: 12.5%、W: 6.25%、V: 3.125% ……
//     C: 2/2^25 ≈ 0.000006%、B: 1/2^25 ≈ 0.000003%、A: 1/2^25 ≈ 0.000003%
//   （B 与 A 同为最低档，C 起逐级翻倍；Z 最常见 50%，A 极稀有。）
// 实现：权重 w(A)=1, w(B)=1, w(C)=2, w(D)=4, ..., w(Z)=2^24，
//   总权重 = 1 + 1 + 2 + 4 + ... + 2^24 = 2^25 → P(=i) = w(i)/2^25 精确符合上表。
export const LOOT_GRADE_X = Math.pow(2, -25);   // A 品级开箱概率 = 1/2^25 ≈ 0.000003%
export function randomGrade() {
    const weights = GRADES.map((_, i) => (i === 0 || i === 1) ? 1 : Math.pow(2, i - 1));
    const total = weights.reduce((a, b) => a + b, 0);       // = 2^25
    let r = Math.random() * total;
    for (let i = 0; i < GRADES.length; i++) {
        r -= weights[i];
        if (r <= 0) return GRADES[i];
    }
    return GRADES[GRADES.length - 1];                       // 兜底 Z
}

// 给物品随机赋品级（返回新对象，不修改原物品）
export function withRandomGrade(item) {
    if (!item) return item;
    return { ...item, grade: randomGrade() };
}

// ============ 灵石强化 ============
// 灵石：僵尸死亡掉落的新材料，用于品级强化。
export const LING_STONE_ID = 'gem:ling';                   // 灵石物品 id
export const LING_STONE_NAME = '灵石';                     // 显示名

// 强化灵石消耗（用户定稿）：**不管当前什么品级，升级的第 1 次就消耗 1 颗，之后每次翻倍**——
//   第 1 次强化消耗 2^0=1 颗，第 2 次 2^1=2 颗，第 3 次 2^2=4 颗……
//   消耗按"该物品已强化次数 count"计算（item.upgradeCount），与当前品级无关：
//   · B→A 若为第 1 次强化 → 只消耗 1 颗；
//   · Z→A 全程 25 次强化 → 总消耗 2^25-1 ≈ 3300 万（天文数字，实际因概率卡住几乎不可能）。
// count = 已强化次数（0 起）；返回本次强化所需灵石数。
export function upgradeCost(count) {
    const n = Math.max(0, Math.floor(count || 0));
    return Math.pow(2, n);
}

// 能否强化（品级不是 A）
export function canUpgrade(grade) {
    return gradeIndex(grade) > 0;
}

// 强化成功率（用户定稿）：**每个品阶之间的升级概率固定**，且品阶越高（越接近 A）概率越低——
//   B→A ≈ 0.02%（最低，极难），C→B ≈ 0.04%（翻倍），D→C ≈ 0.08%……
//   往 Z 方向每降一档概率翻倍，封顶 100%（低品阶强化近乎必成，高品阶极难）。
// 概率公式：rate(idx) = min(1, 0.0002 * 2^(idx-1))  —— idx=品级索引(0=A,25=Z)
//   B(1)→A: 0.0002*2^0 = 0.02%  ✓   C(2)→B: 0.0002*2^1 = 0.04%  ✓   D(3)→C: 0.0002*2^2 = 0.08%  ✓
//   Z(25)→Y: 0.0002*2^24 = 3355% → 封顶 100%（低品阶近乎必成）
export const UPGRADE_RATE_A_TO_B = 0.0002;   // B→A 概率 0.02%（基准，最难）
export function upgradeSuccessRate(grade) {
    const idx = gradeIndex(grade);
    if (idx <= 0) return 0;                                 // A 无法强化（0%）
    return Math.min(1, UPGRADE_RATE_A_TO_B * Math.pow(2, idx - 1));
}

// 执行一次强化：当前品级 → 更高一级（更接近 A）。
// 用户定稿补充：
//   ① **每次强化（无论成败）都等于"升过一级"**——upgradeCount +1，灵石消耗继续翻倍；
//   ② **失败补偿**：强化失败品级不变，但下一次强化的概率提高**当前概率的 50%（×1.5）**，100% 封顶。
// 返回 { ok, nextGrade, cost, success, rate, nextRate, newCount }；
//   cost 按"该物品已强化次数 upgradeCount"计算（第 count+1 次强化消耗 2^count 颗）；
//   success=true 品级+1；success=false 品级不变但 newCount 已 +1、下次概率=rate×1.5（封顶100%）。
export function upgradeOnce(item) {
    const grade = itemGrade(item);
    const idx = gradeIndex(grade);
    if (idx <= 0) return { ok: false, nextGrade: grade, cost: 0, success: false, rate: 0, newCount: item ? item.upgradeCount || 0 : 0 };   // A 最高
    const count = item && item.upgradeCount ? item.upgradeCount : 0;
    const cost = upgradeCost(count);
    const baseRate = upgradeSuccessRate(grade);
    // 失败补偿：此前已失败过 n 次 → 概率 ×1.5^n（封顶 100%）
    const prevFails = item && item.failCount ? item.failCount : 0;
    const rate = Math.min(1, baseRate * Math.pow(1.5, prevFails));
    const success = Math.random() < rate;
    const nextGrade = success ? GRADES[idx - 1] : grade;
    // 无论成败：upgradeCount +1（消耗继续翻倍）；失败时 failCount +1（下次概率 ×1.5），成功清零
    const newCount = count + 1;
    const newFailCount = success ? 0 : prevFails + 1;
    const nextRate = success ? upgradeSuccessRate(nextGrade) : Math.min(1, baseRate * Math.pow(1.5, newFailCount));
    return { ok: true, nextGrade, cost, success, rate, nextRate, newCount, newFailCount };
}

// 从 Z 强化到目标品级所需的总灵石数（每次消耗 2^count 翻倍，共 steps 次强化：
// 2^0+2^1+...+2^(steps-1) = 2^steps - 1）。
//   Z→Y: 1 颗；Z→X: 3 颗；Z→A(25 次): 2^25-1 ≈ 3355 万（天文数字，实际因概率卡住不现实）。
export function totalCostTo(grade) {
    const idx = gradeIndex(grade);
    const steps = GRADES.length - 1 - idx;                  // 从 Z 到目标品级的强化次数
    return Math.pow(2, steps) - 1;                          // 2^steps - 1
}

// ============ 灵石掉落（僵尸死亡） ============
// 用户定稿：僵尸掉落灵石基础概率 = 3.33%（暂定）；**越稀有的僵尸掉率越高、数量越多**。
// 稀有度判定（按僵尸类型/精英标记）：
//   · 普通僵尸（normal/cone/bucket 等基础类型）：基础掉率 3.33%，掉 1 颗；
//   · 防具精英（bucket/cone 高护甲）：掉率 ×2，数量 +1；
//   · 文字精英（textAbility，如残名尸/删字尸/换字尸）：掉率 ×3，数量 +1~2；
//   · 尸化玩家（isPlayerZombie / type='playerzombie'）：掉率 ×4，数量 +2~3。
// 掉落结果：{ drop, count } —— drop 是否掉，count 掉几颗（0 = 不掉）。
export const LING_DROP_BASE_CHANCE = 0.0333;   // 基础掉率 3.33%（普通僵尸）
export const LING_DROP_BASE_COUNT = 1;         // 基础掉落数量 1 颗
export function lingDropRarity(z) {
    // z = 僵尸对象（含 type / textAbility / isPlayerZombie 等标记）
    if (!z) return { mul: 1, add: 0 };
    if (z.isPlayerZombie || z.type === 'playerzombie') return { mul: 4, add: 2 };      // 尸化玩家：×4 掉率，+2 数量
    if (z.textAbility) return { mul: 3, add: 1 };                                     // 文字精英：×3 掉率，+1 数量
    if (z.type === 'bucket' || z.type === 'cone') return { mul: 2, add: 1 };          // 防具精英：×2 掉率，+1 数量
    return { mul: 1, add: 0 };                                                        // 普通：基础
}
// 判定本次僵尸死亡是否掉灵石及数量（随机）
export function lingDrop(z) {
    const r = lingDropRarity(z);
    const chance = Math.min(1, LING_DROP_BASE_CHANCE * r.mul);
    if (Math.random() >= chance) return { drop: false, count: 0 };
    // 数量：基础 1 + 稀有加成 + 少量随机（稀有多掉 0~2）
    const count = LING_DROP_BASE_COUNT + r.add + (Math.random() < 0.5 ? 1 : 0);
    return { drop: true, count };
}
