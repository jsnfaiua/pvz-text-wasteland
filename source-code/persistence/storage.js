// ============================================================
// 本地存储管理（账户/存档/升级/货币）
// ============================================================

import { CARD_ORDER, LEVEL_TABLE, PLANTS, WEAPONS } from '../core/constants.js';

// 存储键前缀
export const STORAGE_PREFIXES = {
    fragments:    'pvz_txt_fragments_v1',
    levels:       'pvz_txt_levels_v1',
    currency:     'pvz_txt_currency_v1',
    weapons:      'pvz_txt_weapons_v1',
    wfrags:       'pvz_txt_wfrags_v1',
    save:         'pvz_txt_save_v1',
    users:        'pvz_txt_users_v1',
    session:      'pvz_txt_session_v1',
    consumables:  'pvz_txt_consumables_v1',
    armors:       'pvz_txt_armors_v1',
    shopState:    'pvz_txt_shop_state_v1',
    ammo:         'pvz_txt_ammo_v1',
};

// 获取命名空间后的键
function getNamespacedKey(baseKey) {
    const session = getSession();
    const username = session ? session.username : '__guest__';
    return `u:${username}:${baseKey}`;
}

// 原始存取
export function safeParse(raw, def) {
    try { return JSON.parse(raw) || def; } catch { return def; }
}

export function setStorage(key, value, useNamespace = true) {
    const fullKey = useNamespace ? getNamespacedKey(key) : key;
    try {
        localStorage.setItem(fullKey, JSON.stringify(value));
    } catch (e) {
        // 存档配额满（mods 随探索体积增长可能超 localStorage 5MB）：不抛错打断保存流程
        // （saveNow/migrateLegacySave 等调用方不受影响；玩家清理旧档/浏览器数据后恢复）
        console.warn('[storage] 保存失败（localStorage 配额满？）:', key, e && e.name);
        return false;
    }
    // 已登录时防抖同步到服务器存档（跨电脑进度一致）
    if (useNamespace && typeof window !== 'undefined' && window.Net && window.Net.cloud) {
        window.Net.cloud.pushAllDebounced();
    }
    return true;
}

export function getStorage(key, def = null, useNamespace = true) {
    const fullKey = useNamespace ? getNamespacedKey(key) : key;
    return safeParse(localStorage.getItem(fullKey), def);
}

// 删除命名空间后的键（#13：删除存档统一走此接口，避免各调用方硬编码 `u:<user>:` 前缀）
export function removeStorage(key, useNamespace = true) {
    const fullKey = useNamespace ? getNamespacedKey(key) : key;
    try {
        localStorage.removeItem(fullKey);
        return true;
    } catch (e) {
        console.warn('[storage] 删除失败:', key, e && e.name);
        return false;
    }
}

// ============================================================
// 碎片 & 升级
// ============================================================
export function loadFragments() {
    return getStorage(STORAGE_PREFIXES.fragments, {});
}

export function saveFragments(obj) {
    setStorage(STORAGE_PREFIXES.fragments, obj);
}

export function loadLevels() {
    const raw = getStorage(STORAGE_PREFIXES.levels, {});
    CARD_ORDER.forEach(k => { if (raw[k] == null) raw[k] = 1; });
    return raw;
}

export function saveLevels(obj) {
    setStorage(STORAGE_PREFIXES.levels, obj);
}

export function getPlantStat(kind, levels) {
    const lv = levels[kind] || 1;
    const info = LEVEL_TABLE.find(x => x.lv === lv) || LEVEL_TABLE[0];
    const spec = {
        sunflower:   { field: 'produceRate', label: '产阳光速度', base: 24, invert: true },
        peashooter:  { field: 'damage',      label: '豌豆伤害',    base: 20 },
        wallnut:     { field: 'hp',          label: '血量',        base: 4000 },
        cherry:      { field: 'radius',      label: '爆炸半径',    base: 130 },
        potatomine:  { field: 'blastDamage', label: '爆炸伤害',    base: 1800 },
        snowpea:     { field: 'damage',      label: '豌豆伤害',    base: 20 },
        chomper:     { field: 'killRange',   label: '吞噬范围',    base: 80 },
        repeater:    { field: 'damage',      label: '豌豆伤害',    base: 20 },
    }[kind];

    if (!spec) return { lv, mul: info.mul, value: 0 };
    const value = spec.invert ? spec.base / info.mul : spec.base * info.mul;
    return { lv, mul: info.mul, value };
}

// ============================================================
// 货币
// ============================================================
export function loadCurrency() {
    const raw = getStorage(STORAGE_PREFIXES.currency, {});
    return {
        silver: raw.silver || 0,
        gold:   raw.gold   || 0,
        gem:    raw.gem    || 0,
    };
}

export function saveCurrency(currency) {
    setStorage(STORAGE_PREFIXES.currency, currency);
}

export function addCurrency(currency, type, amount) {
    if (!currency[type]) currency[type] = 0;
    currency[type] += amount;
    saveCurrency(currency);
}

// ============================================================
// 武器
// ============================================================
export function loadWeapons() {
    const raw = getStorage(STORAGE_PREFIXES.weapons, {});
    const w = {
        unlocked: raw.unlocked || {},
        levels:   raw.levels   || {},
        equipped: raw.equipped || null,
        equippedMelee:  raw.equippedMelee  || null,
        equippedRanged: raw.equippedRanged || null,
    };
    // 旧档迁移：单槽 equipped 按武器类型归入近战/远程槽
    if (!w.equippedMelee && !w.equippedRanged && w.equipped) {
        const kind = WEAPONS[w.equipped]?.kind;
        if (kind === 'melee') w.equippedMelee = w.equipped;
        else if (kind === 'ranged') w.equippedRanged = w.equipped;
    }
    return w;
}

// 弹药库（商店购买，开局带入）
export function loadAmmo() {
    return getStorage(STORAGE_PREFIXES.ammo, {});
}

export function saveAmmo(obj) {
    setStorage(STORAGE_PREFIXES.ammo, obj);
}

export function saveWeapons(weapons) {
    setStorage(STORAGE_PREFIXES.weapons, weapons);
}

export function loadWeaponFrags() {
    return getStorage(STORAGE_PREFIXES.wfrags, {});
}

export function saveWeaponFrags(frags) {
    setStorage(STORAGE_PREFIXES.wfrags, frags);
}

// ============================================================
// 关卡存档
// ============================================================
export function loadSave() {
    const raw = getStorage(STORAGE_PREFIXES.save, { cleared: [], lastLevel: null });
    if (!raw.unlockedPlants) raw.unlockedPlants = ['peashooter'];
    if (!raw.decks) raw.decks = {};
    if (!raw.maxSlots) raw.maxSlots = 6;
    if (!raw.volumes) raw.volumes = { bgm: 20, sfx: 100 };
    return raw;
}

export function writeSave(s) {
    setStorage(STORAGE_PREFIXES.save, s);
}

// ============================================================
// 账户系统
// ============================================================
export function loadUsers() {
    return getStorage(STORAGE_PREFIXES.users, {}, false);
}

export function writeUsers(o) {
    setStorage(STORAGE_PREFIXES.users, o, false);
}

export function getSession() {
    return safeParse(localStorage.getItem(STORAGE_PREFIXES.session), null);
}

export function setSession(s) {
    if (s) {
        localStorage.setItem(STORAGE_PREFIXES.session, JSON.stringify(s));
    } else {
        localStorage.removeItem(STORAGE_PREFIXES.session);
    }
}

export function currentUser() {
    const s = getSession();
    return s ? s.username : null;
}

// ============================================================
// 消耗品（商店道具）
// ============================================================
export function loadConsumables() {
    return getStorage(STORAGE_PREFIXES.consumables, { heal: 0, double: 0, shield: 0 });
}

export function saveConsumables(obj) {
    setStorage(STORAGE_PREFIXES.consumables, obj);
}

export function addConsumable(id, amount) {
    const c = loadConsumables();
    c[id] = (c[id] || 0) + (amount || 1);
    saveConsumables(c);
    return c;
}

export function consumeConsumable(id) {
    const c = loadConsumables();
    if ((c[id] || 0) > 0) {
        c[id]--;
        saveConsumables(c);
    }
}

// ============================================================
// 护甲存储
// ============================================================
export function loadArmors() {
    return getStorage(STORAGE_PREFIXES.armors, []);
}

export function saveArmors(arr) {
    setStorage(STORAGE_PREFIXES.armors, arr);
}

export function addArmor(armor) {
    const arr = loadArmors();
    arr.push(armor);
    saveArmors(arr);
    return arr;
}

export function removeArmor(index) {
    const arr = loadArmors();
    if (index >= 0 && index < arr.length) {
        arr.splice(index, 1);
        saveArmors(arr);
    }
}

// ============================================================
// 商店状态
// ============================================================
export function loadShopState() {
    return getStorage(STORAGE_PREFIXES.shopState, {
        lastRefresh: 0,
        manualCount: 0,
        discounts: {},
    });
}

export function saveShopState(s) {
    setStorage(STORAGE_PREFIXES.shopState, s);
}

// ============================================================
// 全局元数据缓存
// ============================================================
export const META = {
    fragments: loadFragments(),
    levels: loadLevels(),
    currency: loadCurrency(),
    weapons: loadWeapons(),
    weaponFrags: loadWeaponFrags(),
    consumables: loadConsumables(),
    armorStorage: loadArmors(),
    ammo: loadAmmo(),
};

// 刷新UI缓存
export function refreshMeta() {
    META.fragments = loadFragments();
    META.levels = loadLevels();
    META.currency = loadCurrency();
    META.weapons = loadWeapons();
    META.weaponFrags = loadWeaponFrags();
    META.consumables = loadConsumables();
    META.armorStorage = loadArmors();
    META.ammo = loadAmmo();
}
