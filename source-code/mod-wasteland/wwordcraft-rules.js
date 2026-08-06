// 文字具现纯规则：不依赖 DOM、音频或浏览器全局，供系统与测试共用。

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
    supply: weighted([
        ['水', .09], ['食', .07], ['物', .06], ['木', .07], ['材', .05], ['石', .06], ['块', .05],
        ['草', .07], ['药', .05], ['土', .05], ['米', .04], ['玉', .04], ['豆', .04], ['胡', .03],
        ['萝', .03], ['卜', .03], ['肥', .04], ['料', .04], ['阳', .03], ['光', .03], ['宝', .01], ['子', .02],
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
    text: weighted([['字', .14], ['名', .12], ['删', .10], ['换', .10], ['污', .10], ['缺', .10], ['裂', .08], ['楔', .08], ['固', .07], ['散', .06], ['侵', .05]]),
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
    // 食物与基础资源
    makeRecipe('carrot', '胡萝卜', 'food', 'food', 6, { visual: 'carrot', desc: '完整具现后成为可食用的像素胡萝卜。' }),
    makeRecipe('corn', '玉米', 'food', 'food', 5, { visual: 'corn' }),
    makeRecipe('potato', '土豆', 'food', 'food', 5, { visual: 'potato' }),
    makeRecipe('herb', '草药', 'herb', 'supply', 5, { visual: 'herb', desc: '两枚自然来源字块被固定为可用草药。' }),
    makeRecipe('food', '食物', 'food', 'supply', 5, { desc: '泛称具现的应急食物，稳定性低于具体食物。' }),
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
        supply: ['carrot', 'corn', 'potato', 'herb', 'food', 'wood', 'stone', 'water', 'fert', 'ammo-arrow', 'tool-hoe'],
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
        const tableKey = options.wedgeSource || source;
        let wedge = rollKey(WEDGE_SOURCE_TABLES[tableKey] || WEDGE_SOURCE_TABLES.supply, random);
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
    const pool = options.glyphPool || GLYPH_SOURCE_POOLS[source] || GLYPH_SOURCE_POOLS.supply;
    const items = [];
    const counts = {};
    for (let i = 0; i < count; i++) {
        let char = pickWeighted(pool, random);
        for (let retry = 0; retry < 8 && (counts[char] || 0) >= 2; retry++) char = pickWeighted(pool, random);
        counts[char] = (counts[char] || 0) + 1;
        const pollution = options.pollutionTable ? rollKey(options.pollutionTable, random) : 'clean';
        items.push({ id: glyphId(char, pollution), n: 1 });
    }
    return items;
}

// 旧API兼容：默认从物资字池产生一个文字结果。
export function rollTextLoot(random = Math.random) {
    const result = rollWordLootOutcome('supply', { glyph: .84, wedge: .16 }, {}, random);
    return result.items[0];
}
