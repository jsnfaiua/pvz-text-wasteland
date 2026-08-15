// 文字具现纯规则：不依赖 DOM、音频或浏览器全局，供系统与测试共用。

import * as B9 from './wbalance.js';   // 错乱字效果表（wbalance 不依赖本模块，无循环）
import { JUNK_GLYPHS } from './wglyphs.js';   // 2026-08-12 v3.16 混淆字基数（通用规范汉字 1~7画 942 字）

export const WORDCRAFT_CONFIG = {
    // v1.1后由具名来源表结算；保留字段仅用于旧存档/外部代码兼容。
    textLootChance: 0,
    wedgeLootChance: 0,
};

export const WEDGE_INFO = {
    'wedge:rough': { name: '粗制字楔', short: '粗制', color: '#c0794a' },
    'wedge:stable': { name: '稳定字楔', short: '稳定', color: '#d3a45f' },
    'wedge:clean': { name: '洁净字楔', short: '洁净', color: '#8eb6ad' },
};

const weighted = entries => entries.map(([id, weight]) => ({ id, weight }));

// 单个字符在来源池中的实际权重；每个池总和为1。
export const GLYPH_SOURCE_POOLS = {
    // 权重总和必须为 1.0（测试断言），新增字时同步压缩原有权重。
    // 2026-08-12 v3.9 加入错乱特殊字（巨大力暴速快硬菌火冰雷爆影暗王尸机机械骨），可搜刮获得。
    supply: weighted([
        // 基础生存字（.04）：水/食/木/石/草/药
        ['水', .04], ['食', .04], ['木', .04], ['石', .04], ['草', .04], ['药', .04],
        // 常用物资字（.02）
        ['物', .02], ['材', .02], ['块', .02], ['土', .02], ['米', .02], ['玉', .02], ['豆', .02],
        ['胡', .02], ['萝', .02], ['卜', .02], ['肥', .02], ['料', .02], ['阳', .02], ['光', .02],
        ['子', .02], ['面', .02], ['包', .02], ['苹', .01], ['果', .01], ['西', .01], ['瓜', .01],
        ['绷', .02], ['带', .02], ['强', .02], ['心', .02], ['针', .02], ['急', .02], ['救', .02],
        // 稀有字（.01）：宝 + 错乱特殊字（v3.9 用户需求：特殊字有特殊效果）
        ['宝', .01],
        ['巨', .01], ['大', .01], ['力', .01], ['暴', .01], ['速', .01], ['快', .01], ['硬', .01], ['菌', .01],
        ['火', .01], ['冰', .01], ['雷', .01], ['爆', .01], ['影', .01], ['暗', .01], ['王', .01], ['尸', .01],
        ['机', .01], ['械', .01], ['骨', .01],
        // 2026-08-12 v3.10 文字手术刀配方字（文/字/术/刀）：字从文字系获取、刀从武器系，
        // 这里补文/术/字/刀（稀有级）。权重和保持 1.0（苹/果/西/瓜 降至 .01 抵消）。
        ['文', .01], ['术', .01], ['字', .01], ['刀', .01],
    ]),
    weapon: weighted([
        ['枪', .14], ['弹', .12], ['手', .06], ['散', .05], ['冲', .05], ['锋', .04], ['步', .05],
        ['狙', .03], ['击', .04], ['霰', .03], ['短', .03], ['剑', .05], ['长', .04], ['矛', .03],
        ['战', .04], ['斧', .03], ['飞', .03], ['刀', .04], ['弓', .03], ['箭', .04], ['矢', .02], ['组', .01],
    ]),
    medical: weighted([
        ['药', .20], ['草', .14], ['水', .14], ['食', .08], ['物', .06], ['阳', .08], ['光', .08],
        ['肥', .04], ['料', .04], ['胡', .03], ['萝', .03], ['卜', .03], ['土', .02], ['豆', .02], ['米', .01],
    ]),
    material: weighted([
        ['木', .13], ['材', .10], ['石', .11], ['块', .08], ['料', .07], ['修', .05], ['车', .03],
        ['零', .07], ['件', .07], ['伐', .04], ['斧', .04], ['镐', .04], ['锄', .02], ['头', .02],
        ['扳', .04], ['手', .04], ['铲', .03], ['子', .02],
    ]),
    car: weighted([
        ['车', .16], ['修', .12], ['零', .14], ['件', .14], ['扳', .08], ['手', .06], ['枪', .04],
        ['弹', .06], ['食', .04], ['水', .06], ['木', .03], ['材', .03], ['石', .02], ['块', .02],
    ]),
};

export const GLYPH_COUNT_TABLES = {
    container: [[1, .70], [2, .25], [3, .05], [4, 0]],
    zombieCommon: [[1, .75], [2, .22], [3, .03], [4, 0]],
    zombieRare: [[1, .35], [2, .40], [3, .20], [4, .05]],
    zombieEpic: [[1, 0], [2, .30], [3, .40], [4, .30]],
};

export const WEDGE_SOURCE_TABLES = {
    supply:  { rough: .82, stable: .16, clean: .02, infected: 0 },
    weapon:  { rough: .35, stable: .58, clean: .05, infected: .02 },
    medical: { rough: .25, stable: .20, clean: .53, infected: .02 },
    material:{ rough: .55, stable: .42, clean: .03, infected: 0 },
    interior:{ rough: .60, stable: .30, clean: .08, infected: .02 },
    car:     { rough: .40, stable: .53, clean: .05, infected: .02 },
    zombieCommon: { rough: .70, stable: .20, clean: .02, infected: .08 },
    zombieRare:   { rough: .35, stable: .40, clean: .10, infected: .15 },
    zombieEpic:   { rough: .10, stable: .35, clean: .25, infected: .30 },
};

// 未实装结果的显式兼容迁移：感染字楔→稳定字楔。
// v1.11：残缺物已实装为真实物品，不再迁移为字块。
export const WORD_LOOT_COMPATIBILITY = {
    infectedWedge: 'stable',
};

export const ZOMBIE_GLYPH_POOLS = {
    resident: weighted([['人', .14], ['名', .12], ['手', .12], ['头', .10], ['衣', .10], ['鞋', .08], ['食', .08], ['水', .07], ['家', .07], ['门', .06], ['生', .06]]),
    worker: weighted([['工', .14], ['厂', .10], ['铁', .12], ['零', .12], ['件', .12], ['扳', .10], ['手', .08], ['车', .08], ['修', .08], ['具', .06]]),
    guard: weighted([['枪', .16], ['弹', .16], ['战', .10], ['击', .10], ['步', .08], ['刀', .08], ['甲', .08], ['盾', .08], ['兵', .08], ['令', .08]]),
    medical: weighted([['医', .15], ['药', .15], ['血', .12], ['针', .10], ['布', .10], ['净', .10], ['病', .10], ['毒', .08], ['手', .05], ['护', .05]]),
    // 2026-08-12 v3.9 文字僵尸字池：文字系字 + 错乱特殊字（可掉落巨/王/尸/火/冰/雷等）
    text: weighted([
        ['字', .06], ['名', .06], ['删', .06], ['换', .06], ['污', .06],
        ['缺', .04], ['裂', .04], ['楔', .04], ['固', .04], ['散', .04], ['侵', .04],
        ['巨', .03], ['王', .03], ['尸', .03], ['爆', .03], ['雷', .03], ['冰', .03], ['影', .03], ['暗', .03],
        ['大', .02], ['力', .02], ['暴', .02], ['速', .02], ['快', .02], ['硬', .02], ['菌', .02], ['火', .02], ['机', .02], ['械', .02], ['骨', .02],
    ]),
};

export const ZOMBIE_POLLUTION_TABLES = {
    common: { clean: .10, unstable: .45, infected: .45 },
    rare: { clean: .20, unstable: .40, infected: .40 },
    epic: { clean: .25, unstable: .30, infected: .45 },
};

function makeRecipe(id, name, outputId, category, duration, options = {}) {
    return {
        id, name, output: { id: outputId, n: options.outputN || 1 }, category, duration,
        glyphs: options.glyphs || Array.from(name),
        wedges: options.wedges == null ? Math.max(1, Array.from(name).length - 1) : options.wedges,
        wedgeId: options.wedgeId || 'wedge:rough',
        visual: options.visual || category,
        desc: options.desc || `${name}的字符结构落实为可用像素实体。`,
    };
}

export const RECIPES = [
    // 食物与基础资源（2026-08-12 v3.7 具体食物：只加饱食，带水分补水，不回血）
    makeRecipe('carrot', '胡萝卜', 'carrot', 'supply', 6, { visual: 'carrot', desc: '完整具现后成为可食用的像素胡萝卜（饱食+20、水分+10）。' }),
    makeRecipe('corn', '玉米', 'corn', 'supply', 5, { visual: 'corn', desc: '完整具现后成为像素玉米（饱食+25）。' }),
    makeRecipe('potato', '土豆', 'potato', 'supply', 5, { visual: 'potato', desc: '完整具现后成为像素土豆（饱食+30）。' }),
    makeRecipe('bread', '面包', 'bread', 'supply', 6, { desc: '具现后成为像素面包（饱食+25）。' }),
    makeRecipe('apple', '苹果', 'apple', 'supply', 5, { desc: '具现后成为像素苹果（饱食+18、水分+8）。' }),
    makeRecipe('melon', '西瓜', 'melon', 'supply', 6, { desc: '具现后成为像素西瓜（饱食+15、水分+20）。' }),
    // 回血药（2026-08-12 v3.7 只回血，不加饱食/水分）
    makeRecipe('herb', '草药', 'herb', 'supply', 5, { visual: 'herb', desc: '两枚自然来源字块被固定为可用草药（恢复15生命）。' }),
    makeRecipe('bandage', '绷带', 'heal:bandage', 'supply', 6, { desc: '具现出急救绷带（恢复20生命）。' }),
    makeRecipe('tonic', '强心针', 'heal:tonic', 'supply', 8, { wedgeId: 'wedge:clean', desc: '具现出强心针（恢复40生命）。' }),
    makeRecipe('kit', '急救包', 'heal:kit', 'supply', 10, { wedgeId: 'wedge:clean', desc: '具现出急救包（恢复60生命）。' }),
    makeRecipe('food', '食物', 'food', 'supply', 5, { desc: '泛称具现的应急食物（饱食+30、水分+5），稳定性低于具体食物。' }),
    makeRecipe('wood', '木材', 'wood', 'material', 4, { outputN: 2, visual: 'wood', desc: '形成两份稳定的像素木材。' }),
    makeRecipe('stone', '石块', 'stone', 'material', 4, { outputN: 2, visual: 'stone' }),
    makeRecipe('water', '水', 'water', 'supply', 3, { glyphs: ['水'], wedges: 1, visual: 'water' }),
    makeRecipe('fert', '肥料', 'fert', 'material', 6, { visual: 'fert' }),
    makeRecipe('sun', '阳光', 'sun', 'energy', 8, { wedgeId: 'wedge:clean', visual: 'sun' }),
    makeRecipe('gem', '宝石', 'gem', 'material', 12, { wedgeId: 'wedge:stable', visual: 'gem' }),
    makeRecipe('part', '修车零件', 'part', 'mechanical', 24, { wedgeId: 'wedge:stable', visual: 'part' }),

    // 工具
    makeRecipe('tool-chopper', '伐木斧', 'tool:chopper', 'tool', 18, { wedgeId: 'wedge:stable', visual: 'axe' }),
    makeRecipe('tool-pick', '石镐', 'tool:pick', 'tool', 16, { wedgeId: 'wedge:stable', visual: 'pick' }),
    makeRecipe('tool-hoe', '锄头', 'tool:hoe', 'tool', 14, { wedgeId: 'wedge:stable', visual: 'hoe' }),
    makeRecipe('tool-wrench', '扳手', 'tool:wrench', 'tool', 16, { wedgeId: 'wedge:stable', visual: 'wrench' }),
    // 2026-08-12 v3.10 文字手术刀：拆字工具（净化/拆解），字楔粘合"文 字 手 术 刀"
    makeRecipe('tool-surgery', '文字手术刀', 'tool:surgery', 'tool', 24, { wedgeId: 'wedge:clean', desc: '具现出文字手术刀——可拆解物品成字、净化污染字块/字楔。' }),
    makeRecipe('shovel', '铲子', 'wpn:shovel', 'tool', 14, { wedgeId: 'wedge:stable', visual: 'shovel' }),

    // 近战与投掷武器
    makeRecipe('dagger', '短剑', 'wpn:dagger', 'weapon', 18, { wedgeId: 'wedge:stable', visual: 'blade' }),
    makeRecipe('sword', '长剑', 'wpn:sword', 'weapon', 24, { wedgeId: 'wedge:stable', visual: 'blade-long' }),
    makeRecipe('spear', '长矛', 'wpn:spear', 'weapon', 22, { wedgeId: 'wedge:stable', visual: 'spear' }),
    makeRecipe('axe', '战斧', 'wpn:axe', 'weapon', 28, { wedgeId: 'wedge:stable', visual: 'axe-heavy' }),
    makeRecipe('knife', '飞刀', 'wpn:knife', 'weapon', 20, { wedgeId: 'wedge:stable', visual: 'knife' }),
    makeRecipe('bow', '弓箭', 'wpn:bow', 'weapon', 24, { wedgeId: 'wedge:stable', visual: 'bow' }),

    // 枪械
    makeRecipe('pistol', '手枪', 'wpn:pistol', 'firearm', 30, { wedgeId: 'wedge:stable', visual: 'pistol' }),
    makeRecipe('shotgun', '散弹枪', 'wpn:shotgun', 'firearm', 42, { wedgeId: 'wedge:stable', visual: 'longgun' }),
    makeRecipe('smg', '冲锋枪', 'wpn:smg', 'firearm', 45, { wedgeId: 'wedge:stable', visual: 'smg' }),
    makeRecipe('rifle', '步枪', 'wpn:rifle', 'firearm', 40, { wedgeId: 'wedge:stable', visual: 'longgun' }),
    makeRecipe('sniper', '狙击枪', 'wpn:sniper', 'firearm', 60, { wedgeId: 'wedge:clean', visual: 'sniper' }),

    // 弹药（一次具现一组）
    makeRecipe('ammo-pistol', '手枪弹', 'ammo:pistolAmmo', 'ammo', 18, { outputN: 12, wedgeId: 'wedge:stable', visual: 'ammo' }),
    makeRecipe('ammo-smg', '冲锋枪弹', 'ammo:smgAmmo', 'ammo', 22, { outputN: 20, wedgeId: 'wedge:stable', visual: 'ammo' }),
    makeRecipe('ammo-rifle', '步枪弹', 'ammo:rifleAmmo', 'ammo', 24, { outputN: 12, wedgeId: 'wedge:stable', visual: 'ammo' }),
    makeRecipe('ammo-sniper', '狙击弹', 'ammo:sniperAmmo', 'ammo', 28, { outputN: 5, wedgeId: 'wedge:clean', visual: 'ammo-long' }),
    makeRecipe('ammo-shell', '霰弹', 'ammo:shellAmmo', 'ammo', 24, { outputN: 6, wedgeId: 'wedge:stable', visual: 'shell' }),
    makeRecipe('ammo-arrow', '箭矢', 'ammo:arrowAmmo', 'ammo', 12, { outputN: 10, wedgeId: 'wedge:rough', visual: 'arrow' }),
    makeRecipe('ammo-knife', '飞刀组', 'ammo:knifeAmmo', 'ammo', 18, { outputN: 6, wedgeId: 'wedge:stable', visual: 'knife' }),
];

// ============ 全局字权重表（2026-08-12 v3.18 用户定稿） ============
// 每个字有**全局统一权重**（稀有度全局一致，不因容器改变）。
// 击杀僵尸出所有字：直接用本表抽（每字有自己的概率）。
// 容器分主题字池：容器只决定"出哪些字"（字集合），池内每字概率仍按本表权重归一化。
// 权重 = 该字在所有来源池中权重之和（僵尸池 ×0.5 平衡），再归一化保证总和 = 1.0（测试断言）；
// 不在任何池的配方字给最小权重兜底（保证任何配方字至少能搜到/掉落）。
export const GLYPH_UNIVERSAL = (() => {
    const w = {};
    const bump = (ch, v) => { w[ch] = (w[ch] || 0) + v; };
    for (const k of Object.keys(GLYPH_SOURCE_POOLS)) for (const g of GLYPH_SOURCE_POOLS[k]) bump(g.id, g.weight);
    for (const k of Object.keys(ZOMBIE_GLYPH_POOLS)) for (const g of ZOMBIE_GLYPH_POOLS[k]) bump(g.id, g.weight * 0.5);
    for (const r of RECIPES) for (const ch of r.glyphs) if (w[ch] == null) w[ch] = 0.002;   // 兜底：配方字必有概率
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    return Object.entries(w)
        .map(([id, weight]) => ({ id, weight: weight / total }))
        .sort((a, b) => b.weight - a.weight);
})();
// 查表：字 → 全局权重（容器分池归一化用）
export const GLYPH_UNIVERSAL_MAP = (() => {
    const m = {};
    for (const g of GLYPH_UNIVERSAL) m[g.id] = g.weight;
    return m;
})();

const STAGES = [
    { max: 0.20, name: '定词', detail: '字楔正在固定字符之间的意义' },
    { max: 0.55, name: '生形', detail: '像素从笔画边缘逐格生长' },
    { max: 0.85, name: '赋质', detail: '颜色、重量和材质正在出现' },
    { max: 1.01, name: '落实', detail: '文字收缩为字核，现实功能恢复' },
];

export function glyphId(char, pollution = 'clean') {
    if (pollution === 'unstable') return `glyph-unstable:${char}`;
    if (pollution === 'infected') return `glyph-infected:${char}`;
    return `glyph:${char}`;
}

// ============ 配方物品（2026-08-12 v3.8 用户需求：配方需搜索获得，背包右键使用解锁） ============
// 每个配方对应一个背包物品 `recipe:<recipeId>`。使用后解锁到 sv.mods.recipes，
// 拼字台只显示已解锁配方（字符有无：背包有=白，缺=红）。
export function recipeItemId(recipeId) {
    return 'recipe:' + recipeId;
}
export function recipeIdFromItem(id) {
    if (typeof id !== 'string' || !id.startsWith('recipe:')) return null;
    return id.slice(7);
}
// 按配方物品 id 找配方
export function recipeByItemId(id) {
    const rid = recipeIdFromItem(id);
    if (!rid) return null;
    return RECIPES.find(r => r.id === rid) || null;
}
// 随机取一个未解锁配方 id（掉落用）；exclude = 已解锁集合
export function rollRecipeItem(unlockedSet, random = Math.random) {
    const pool = RECIPES.filter(r => !unlockedSet || !unlockedSet.has(r.id));
    if (!pool.length) return null;
    const r = pool[Math.floor(random() * pool.length)];
    return { id: recipeItemId(r.id), n: 1 };
}

// ============ 自由拼字 / 错乱僵尸（2026-08-12 v3.9 用户需求） ============
// 拼字台"琢磨"模式：玩家自由组合字块（glyph）拼词。若组合的词与某个配方完全一致 → 正常具现；
// 否则文字错乱 → 生成错乱僵尸（属性按组成字的 TEXT_GLYPH_EFFECTS 叠加）。

// ============ 混淆字机制（2026-08-12 v3.15 用户定稿） ============
// 定义：**没有实际装载进游戏功能的文字 = 无用字 = 混淆字**。
// 判定标准：某字不在任何已实装配方（RECIPES）的组成字中 → 拼不出任何实际物品 → 混淆字。
// 混淆字会干扰玩家判断（拿到"火"以为能拼火枪，但当前无火枪配方）；随新功能/新物品加入，
// 新配方会把这些混淆字"转正"为可用字（isConfusingGlyph 动态判定，自动转正）。
export function isConfusingGlyph(ch) {
    if (!ch) return false;
    return !RECIPES.some(r => r.glyphs.includes(ch));
}
// 混淆字清单（供面板/图鉴/文档展示；动态计算）
// 2026-08-12 v3.16 纳入通用规范汉字一级字表（JUNK_GLYPHS）——未装载功能的字均为混淆字
export function confusingGlyphList() {
    const set = new Set();
    for (const pool of Object.values(GLYPH_SOURCE_POOLS)) for (const g of pool) set.add(g.id);
    for (const pool of Object.values(ZOMBIE_GLYPH_POOLS)) for (const g of pool) set.add(g.id);
    for (const ch of JUNK_GLYPHS) set.add(ch);
    return [...set].filter(ch => isConfusingGlyph(ch)).sort();
}
// 可用字清单（能拼出实际物品的字）
export function usableGlyphList() {
    const set = new Set();
    for (const pool of Object.values(GLYPH_SOURCE_POOLS)) for (const g of pool) set.add(g.id);
    for (const pool of Object.values(ZOMBIE_GLYPH_POOLS)) for (const g of pool) set.add(g.id);
    for (const ch of JUNK_GLYPHS) set.add(ch);
    return [...set].filter(ch => !isConfusingGlyph(ch)).sort();
}
// 全部字符源（现有池 + 一级汉字表），供统计总基数
export function allGlyphChars() {
    const set = new Set();
    for (const pool of Object.values(GLYPH_SOURCE_POOLS)) for (const g of pool) set.add(g.id);
    for (const pool of Object.values(ZOMBIE_GLYPH_POOLS)) for (const g of pool) set.add(g.id);
    for (const ch of JUNK_GLYPHS) set.add(ch);
    return set;
}

// 自由拼词：chars = 玩家排出的字序列（如 ['火','枪']）。返回 { matched, recipe }
export function matchFreeWord(chars) {
    const word = (chars || []).join('');
    if (!word) return { matched: false, recipe: null };
    const recipe = RECIPES.find(r => r.glyphs.join('') === word);
    return recipe ? { matched: true, recipe } : { matched: false, recipe: null };
}
// 按组成字计算错乱僵尸属性：基础 CORRUPT_BASE × 各字效果叠加（乘算/加算），能力取第一个特殊字
export function computeCorruptStats(chars) {
    const base = B9.CORRUPT_BASE;
    let hpMul = 1, dmgMul = 1, spdMul = 1, armor = 0;
    let ability = null, abilityChar = null;
    const names = [];
    const descs = [];
    for (const ch of (chars || [])) {
        const eff = B9.TEXT_GLYPH_EFFECTS[ch];
        if (!eff) continue;
        if (eff.hpMul) hpMul *= eff.hpMul;
        if (eff.dmgMul) dmgMul *= eff.dmgMul;
        if (eff.spdMul) spdMul *= eff.spdMul;
        if (eff.armor) armor = Math.min(0.8, armor + eff.armor);
        if (eff.ability && !ability) { ability = eff.ability; abilityChar = ch; }
        if (eff.extraName) names.push(eff.extraName);
        if (eff.desc) descs.push(eff.desc);
    }
    const name = (names.length ? names.join('') : '错乱') + '尸';
    return {
        name, chars: (chars || []).join(''),
        hp: Math.round(base.hp * hpMul),
        speed: Math.round(base.speed * spdMul),
        damage: Math.round(base.damage * dmgMul),
        armor, ability, abilityChar,
        descs: descs.slice(0, 3),
    };
}
// 是否为可自由拼字的字块（clean 字块）
export function isFreeGlyph(id) {
    return typeof id === 'string' && id.startsWith('glyph:') && !id.startsWith('glyph-unstable:') && !id.startsWith('glyph-infected:');
}

// ============ 文字手术刀 · 拆字系统（2026-08-12 v3.10 用户定稿；v3.18 修正：拆字无概率无惩罚） ============
// 规则：①净化——污染/不稳字块与字楔，拆掉"形容词"变普通（必定成功）；
//      ②自由拆解——物品/字块/字楔都可拆，必定成功按名称拆成组成字（猜错没有惩罚：不失败、不损坏、不错乱尸）。
// 所有纯逻辑在此（不依赖 DOM），survival/面板调用。

// 从字块 id 提取字（glyph:X / glyph-unstable:X / glyph-infected:X）
export function glyphCharOf(id) {
    if (typeof id !== 'string') return null;
    if (id.startsWith('glyph-unstable:')) return id.slice(15);
    if (id.startsWith('glyph-infected:')) return id.slice(15);
    if (id.startsWith('glyph:')) return id.slice(6);
    return null;
}
// 字块污染类型：clean / unstable / infected
export function glyphPollutionOf(id) {
    if (typeof id !== 'string') return 'none';
    if (id.startsWith('glyph-unstable:')) return 'unstable';
    if (id.startsWith('glyph-infected:')) return 'infected';
    if (id.startsWith('glyph:')) return 'clean';
    return 'none';
}
// 物品是否可拆解（字块/字楔/配方/普通物品/武器/弹药等——除货币、战利品袋、旗帜）
export function surgeryEligible(id) {
    if (typeof id !== 'string') return false;
    if (id === 'coin' || id === 'flag') return false;
    if (id.startsWith('loot:') || id.startsWith('looted:')) return false;
    if (id === 'gem:ling' || id === 'tpgem' || id === 'gem') return false;   // 宝石/灵石不可拆
    return true;
}
// 拆解结果：{ ok, kind, label, item?: {id,n}, items?: [{id,n}] }
// kind: 'purifyGlyph' 净化字块 / 'purifyWedge' 净化字楔 / 'breakdown' 拆解成功（必定成功，无失败/错乱尸/污染）
// random 可注入（确定性测试）；toughness 参数保留兼容（v3.18 起不再参与判定）
export function surgeryOn(id, random = Math.random, toughness = null) {
    const poll = glyphPollutionOf(id);
    // ---- ① 净化污染字块：拆掉形容词 → 普通字块（稳定，不消耗韧性） ----
    if (poll === 'unstable' || poll === 'infected') {
        const ch = glyphCharOf(id);
        return { ok: true, kind: 'purifyGlyph', label: `净化「${ch}」`, item: { id: glyphId(ch), n: 1 } };
    }
    // ---- 净化污染字楔：感染/不稳字楔 → 普通字楔 ----
    if (typeof id === 'string' && id.startsWith('wedge:')) {
        const wedge = id.slice(6);
        // 现在字楔没有"不稳/感染"态（感染被迁移为 stable），此处保留扩展位：
        // 若未来有 wedge:infected / wedge:unstable → 拆形容词变普通（rough/stable 按其层级）
        if (wedge === 'infected') return { ok: true, kind: 'purifyWedge', label: '净化字楔', item: { id: 'wedge:stable', n: 1 } };
        if (wedge === 'unstable') return { ok: true, kind: 'purifyWedge', label: '净化字楔', item: { id: 'wedge:rough', n: 1 } };
        // 普通字楔：自由拆解——拆成"楔"字 + 有风险（消耗韧性）
        return surgeryBreakdown('楔', id, random, toughness);
    }
    // ---- ② 自由拆解字块：干净字块拆解 = 冒险（无提示），可能出别的字 / 失败 ----
    if (isFreeGlyph(id)) {
        const ch = glyphCharOf(id);
        return surgeryBreakdown(ch, id, random, toughness);
    }
    // ---- 配方卡：拆回一张配方相关字 ----
    if (typeof id === 'string' && id.startsWith('recipe:')) {
        const rid = id.slice(7);
        const r = RECIPES.find(x => x.id === rid);
        const ch = r ? r.glyphs[0] : '配';
        return surgeryBreakdown(ch, id, random, toughness);
    }
    // ---- ③ 普通物品/武器/工具/材料：按名称字面拆成组成字 ----
    return surgeryBreakdown(nameCharsOf(id), id, random, toughness);
}
// 从物品 id 推断其"名称字面"（拆解产出字）：wpn:pistol → 手/枪；food → 食/物；water → 水 等
// 优先查配方（配方的 glyphs 就是该物品的组成字），无配方回退常见映射。
export function nameCharsOf(id) {
    if (typeof id !== 'string') return [];
    if (id.startsWith('wpn:') || id.startsWith('tool:') || id.startsWith('heal:') || id.startsWith('med:')) {
        // 武器/工具/药品：查配方表得组成字
        const recipe = RECIPES.find(r => r.output.id === id);
        if (recipe) return recipe.glyphs;
    }
    const map = {
        food: ['食', '物'], water: ['水'], wood: ['木', '材'], stone: ['石', '块'],
        part: ['零', '件'], fert: ['肥', '料'], sun: ['阳', '光'],
        carrot: ['胡', '萝', '卜'], corn: ['玉', '米'], potato: ['土', '豆'],
        bread: ['面', '包'], apple: ['苹', '果'], melon: ['西', '瓜'],
        herb: ['草', '药'], fuel: ['汽', '油'], flag: ['旗'],
    };
    if (map[id]) return map[id];
    // 通用：查配方（配方的 glyphs 即该物品组成字）
    const recipe = RECIPES.find(r => r.output.id === id);
    if (recipe) return recipe.glyphs;
    // 兜底：从 id 中提取已知字块字符（跳过前缀如 'wpn:'/'ammo:'/'seed:'）
    const known = new Set();
    for (const pool of Object.values(GLYPH_SOURCE_POOLS)) for (const g of pool) known.add(g.id);
    for (const ch of String(id)) if (known.has(ch)) return [ch];
    return ['字'];
}
// 拆解执行（2026-08-12 v3.18 用户定稿：拆字不是概率，猜错没有惩罚）：
// 必定成功 → 产出组成字字块；无失败、无物品消失、无错乱尸、无污染、无韧性损坏。
// 唯一代价：外层消耗手术刀耐久 1 + 被拆物品数量 1（见 wwordcraft.js doSurgery）。
// toughness 参数保留兼容（不再参与判定）；random 保留用于武器/工具小概率多产 1 个组成字。
function surgeryBreakdown(chars, id, random, toughness) {
    const chs = Array.isArray(chars) && chars.length ? chars : [glyphCharOf(id) || '字'];
    const items = [];
    for (const ch of chs) {
        const n = (id.startsWith('wpn:') || id.startsWith('tool:')) && random() < 0.3 ? 2 : 1;
        items.push({ id: glyphId(ch), n });
    }
    return { ok: true, kind: 'breakdown', label: `拆解出 ${chs.join('、')}`, items };
}

export function countInventory(inv, id) {
    return inv.reduce((sum, slot) => sum + (slot && slot.id === id ? slot.n : 0), 0);
}

export function recipeAvailability(inv, recipe) {
    const missing = [];
    for (const char of recipe.glyphs) {
        if (countInventory(inv, glyphId(char)) < 1) missing.push(char);
    }
    const wedgeId = recipe.wedgeId || 'wedge:rough';
    const haveWedges = countInventory(inv, wedgeId);
    if (haveWedges < recipe.wedges) {
        const wedge = WEDGE_INFO[wedgeId] || WEDGE_INFO['wedge:rough'];
        missing.push(`${wedge.short}字楔×${recipe.wedges - haveWedges}`);
    }
    return { ok: missing.length === 0, missing };
}

export function stageAt(progress) {
    const p = Math.max(0, Math.min(1, progress));
    return STAGES.find(stage => p < stage.max) || STAGES[STAGES.length - 1];
}

export function fragmentId(recipeId, missingChars) {
    return `frag:${recipeId}:${missingChars.join(',')}`;
}

export function parseFragmentId(id) {
    if (!id.startsWith('frag:')) return null;
    const parts = id.slice(5).split(':');
    const recipeId = parts[0];
    const missing = parts[1] ? parts[1].split(',') : [];
    const recipe = RECIPES.find(r => r.id === recipeId);
    if (!recipe) return null;
    return {
        recipeId,
        recipe,
        missing,
        severity: missing.length <= 1 ? 'light' : 'severe',
        name: recipe.name,
        present: recipe.glyphs.filter(ch => !missing.includes(ch)),
    };
}

export function rollFragment(source, severity, options = {}, random = Math.random) {
    const pool = completePool(options.completeSource || source);
    const candidates = pool.filter(r => {
        const glyphs = r.glyphs;
        return severity === 'light' ? glyphs.length >= 2 : glyphs.length >= 3;
    });
    const list = candidates.length > 0 ? candidates : pool;
    const recipe = list[Math.floor(random() * list.length)];
    if (!recipe) return null;
    const glyphs = [...recipe.glyphs];
    const removeCount = severity === 'light' ? 1 : Math.min(2 + Math.floor(random() * 2), glyphs.length - 1);
    const missing = [];
    const available = [...glyphs];
    for (let i = 0; i < removeCount && available.length > 0; i++) {
        const idx = Math.floor(random() * available.length);
        missing.push(available[idx]);
        available.splice(idx, 1);
    }
    return { id: fragmentId(recipe.id, missing), n: 1 };
}

export function repairAvailability(inv, fragId) {
    const info = parseFragmentId(fragId);
    if (!info) return { ok: false, missing: ['未知残缺物'] };
    const missing = [];
    for (const char of info.missing) {
        if (countInventory(inv, glyphId(char)) < 1) missing.push(char);
    }
    const wedgeId = info.recipe.wedgeId || 'wedge:rough';
    const wedgeNeed = Math.max(1, Math.ceil(info.missing.length * 0.5));
    const haveWedges = countInventory(inv, wedgeId);
    if (haveWedges < wedgeNeed) {
        const wedge = WEDGE_INFO[wedgeId] || WEDGE_INFO['wedge:rough'];
        missing.push(`${wedge.short}字楔×${wedgeNeed - haveWedges}`);
    }
    return { ok: missing.length === 0, missing, wedgeNeed, info };
}

export function repairDuration(fragId) {
    const info = parseFragmentId(fragId);
    if (!info) return 5;
    const ratio = info.missing.length / info.recipe.glyphs.length;
    return Math.max(3, Math.round(info.recipe.duration * ratio * 0.6));
}

function pickWeighted(entries, random = Math.random) {
    const total = entries.reduce((sum, entry) => sum + (Array.isArray(entry) ? entry[1] : entry.weight), 0);
    let r = random() * total;
    for (const entry of entries) {
        const value = Array.isArray(entry) ? entry[0] : entry.id;
        const weight = Array.isArray(entry) ? entry[1] : entry.weight;
        if (r < weight) return value;
        r -= weight;
    }
    const last = entries[entries.length - 1];
    return Array.isArray(last) ? last[0] : last.id;
}

function rollKey(table, random = Math.random) {
    return pickWeighted(Object.entries(table), random);
}

function completePool(source) {
    const ids = {
        supply: ['carrot', 'corn', 'potato', 'bread', 'apple', 'melon', 'herb', 'bandage', 'tonic', 'kit', 'food', 'wood', 'stone', 'water', 'fert', 'ammo-arrow', 'tool-hoe'],
        weapon: ['dagger', 'sword', 'spear', 'axe', 'knife', 'bow', 'pistol', 'ammo-pistol', 'ammo-rifle', 'ammo-shell', 'ammo-arrow'],
        medical: ['herb', 'water', 'food', 'carrot', 'sun'],
        material: ['wood', 'stone', 'part', 'tool-chopper', 'tool-pick', 'tool-wrench'],
        car: ['part', 'tool-wrench', 'food', 'water', 'ammo-pistol', 'ammo-rifle', 'pistol'],
        interior: ['food', 'water', 'wood', 'stone', 'herb', 'tool-hoe', 'dagger'],
        zombie: ['part', 'tool-wrench', 'dagger', 'knife', 'pistol', 'ammo-pistol'],
    };
    return (ids[source] || ids.supply).map(id => RECIPES.find(recipe => recipe.id === id)).filter(Boolean);
}

export function applyProbabilityModifiers(base, modifier = null) {
    const result = { ...base };
    if (modifier) for (const [key, delta] of Object.entries(modifier)) result[key] = (result[key] || 0) + delta;
    return result;
}

export function rollWordLootOutcome(source, table, options = {}, random = Math.random) {
    const effective = applyProbabilityModifiers(table, options.modifier);
    const originalType = rollKey(effective, random);
    if (originalType === 'none' || originalType === 'base') return { type: originalType, originalType, items: [] };
    const type = WORD_LOOT_COMPATIBILITY[originalType] || originalType;
    if (type === 'lightFragment' || type === 'severeFragment') {
        const severity = type === 'lightFragment' ? 'light' : 'severe';
        const frag = rollFragment(source, severity, options, random);
        if (frag) return { type, originalType, items: [frag] };
        return { type: 'glyph', originalType, items: rollGlyphItems(source, options, random) };
    }
    if (type === 'glyph') {
        return { type, originalType, items: rollGlyphItems(source, options, random) };
    }
    if (type === 'wedge') {
        // v3.19 用户定稿：字楔稀有度全局一致（rough/stable/clean 全局权重，不按容器差异）
        let wedge = rollKey(B9.WEDGE_GLOBAL_WEIGHTS, random);
        if (wedge === 'infected') wedge = WORD_LOOT_COMPATIBILITY.infectedWedge;
        return { type, originalType, items: [{ id: `wedge:${wedge}`, n: 1 }] };
    }
    if (type === 'complete') {
        const pool = completePool(options.completeSource || source);
        const recipe = pool[Math.floor(random() * pool.length)];
        return { type, originalType, items: recipe ? [{ ...recipe.output }] : [] };
    }
    return { type, originalType, items: [] };
}

function rollGlyphItems(source, options, random) {
    const countTable = options.countTable || GLYPH_COUNT_TABLES.container;
    const count = pickWeighted(countTable, random);
    // v3.18 用户定稿：击杀僵尸默认全字池（出所有字）；容器由调用方传各自主题字池（glyphPool）。
    // 容器池 = 字集合，池内概率按**全局权重**（GLYPH_UNIVERSAL_MAP）归一化 → 全局概率一致；
    // 全字池 / 旧API(globalWeights=false) 直接用池内权重。
    const pool = options.glyphPool || GLYPH_UNIVERSAL;
    const useGlobal = options.globalWeights !== false;
    const drawPool = (pool === GLYPH_UNIVERSAL || !useGlobal)
        ? pool
        : pool.map(g => ({ id: g.id, weight: GLYPH_UNIVERSAL_MAP[g.id] || (g.weight || 0.01) }));
    const items = [];
    const counts = {};
    // 2026-08-12 v3.16 用户定稿：非混淆字与混淆字掉落占比 **5:1**（混淆字占 1/6 ≈ 16.67%）。
    // rollTextLoot 旧API 不混入（junkChance 可传 0 覆盖）。
    // 混淆字只从"真正未装载功能的字"中抽取（过滤掉已转正的可用字），避免抽到火/水等可用字。
    const junkChance = options.junkChance != null ? options.junkChance : (1 / 6);
    let junkPool = null;   // 惰性计算：当前真正混淆字集合
    for (let i = 0; i < count; i++) {
        let char = pickWeighted(drawPool, random);
        // 混淆字混入：约 1/6 概率用一级汉字表中"未装载功能的字"替换当前字位，干扰玩家判断
        if (junkChance > 0 && random() < junkChance) {
            if (!junkPool) junkPool = confusingGlyphList();   // 只含真正混淆字
            if (junkPool.length) char = junkPool[Math.floor(random() * junkPool.length)];
        }
        for (let retry = 0; retry < 8 && (counts[char] || 0) >= 2; retry++) char = pickWeighted(pool, random);
        counts[char] = (counts[char] || 0) + 1;
        const pollution = options.pollutionTable ? rollKey(options.pollutionTable, random) : 'clean';
        items.push({ id: glyphId(char, pollution), n: 1 });
    }
    return items;
}

// 旧API兼容：默认从物资字池产生一个文字结果（不混入混淆字，保持确定性）
// ============ 物资全局抽取（v3.19 用户定稿：物资稀有度全局一致） ============
// 从"物品 id 集合"（容器分池）按全局权重表（B9.LOOT_ITEM_WEIGHTS）抽 1 件，缺省权重 0.01。
export function rollGlobalLoot(pool, random = Math.random) {
    if (!pool || !pool.length) return null;
    const total = pool.reduce((s, id) => s + (B9.LOOT_ITEM_WEIGHTS[id] || 0.01), 0);
    let r = random() * total;
    for (const id of pool) {
        const w = B9.LOOT_ITEM_WEIGHTS[id] || 0.01;
        if (r < w) return id;
        r -= w;
    }
    return pool[pool.length - 1];
}
// 物品掉落数量（全局一致）：数量表 → 前缀弹药规则 → 默认 1
export function globalLootQty(id, random = Math.random) {
    const q = B9.LOOT_ITEM_QTY[id];
    if (q) return q[0] + Math.floor(random() * (q[1] - q[0] + 1));
    if (typeof id === 'string' && id.startsWith('ammo:')) {
        const [a, b] = id === 'ammo:sniperAmmo' ? [2, 5] : [4, 10];
        return a + Math.floor(random() * (b - a + 1));
    }
    return 1;
}

export function rollTextLoot(random = Math.random) {
    // 旧API兼容：仍走物资字池原始权重（不混入混淆字、不套全局权重归一化），保持历史确定性
    const result = rollWordLootOutcome('supply', { glyph: .84, wedge: .16 }, { junkChance: 0, glyphPool: GLYPH_SOURCE_POOLS.supply, globalWeights: false }, random);
    return result.items[0];
}
