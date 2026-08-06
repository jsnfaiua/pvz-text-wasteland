// ============================================================
// 图鉴系统 - 植物/僵尸/武器
// ============================================================

import { PLANTS, CARD_ORDER, WEAPONS, WEAPON_ORDER } from '../core/constants.js';
import { state, saveData, setSaveData } from '../core/state.js';

// 僵尸数据补充
export const ZOMBIE_DATA = {
    normal: {
        name: '普通僵尸', hp: 200, speed: '普通', damage: 100,
        desc: '最基础的僵尸，没有任何特殊能力。', rarity: 'common',
    },
    cone: {
        name: '路障僵尸', hp: 350, speed: '普通', damage: 100,
        desc: '头戴路障，生命值是普通僵尸的近两倍。', rarity: 'common',
    },
    bucket: {
        name: '铁桶僵尸', hp: 1000, speed: '普通', damage: 100,
        desc: '头戴铁桶，生命值极高，非常耐打。', rarity: 'rare',
    },
    flag: {
        name: '旗帜僵尸', hp: 270, speed: '普通', damage: 100,
        desc: '手持旗帜指引尸群，每波的领头者。', rarity: 'common',
    },
    pole: {
        name: '撑杆僵尸', hp: 250, speed: '极快', damage: 100,
        desc: '用撑杆跳过遇到的第一棵植物，突破防线。', rarity: 'common',
    },
    door: {
        name: '铁门僵尸', hp: 700, speed: '较慢', damage: 100,
        desc: '手持铁门护盾，正面防御力极强。', rarity: 'rare',
    },
};

// 图鉴解锁状态
let almanacState = {
    unlocked: {
        plants: [],
        zombies: [],
        weapons: [],
    },
    viewed: {
        plants: [],
        zombies: [],
        weapons: [],
    },
};

// 初始化图鉴
export function initAlmanac() {
    // 从存档加载
    if (saveData.almanac) {
        almanacState = { ...saveData.almanac };
    }
    
    // 默认解锁一些基础的
    if (!almanacState.unlocked.plants.includes('sunflower')) {
        almanacState.unlocked.plants.push('sunflower');
    }
    if (!almanacState.unlocked.plants.includes('peashooter')) {
        almanacState.unlocked.plants.push('peashooter');
    }
    if (!almanacState.unlocked.zombies.includes('normal')) {
        almanacState.unlocked.zombies.push('normal');
    }
    if (!almanacState.unlocked.weapons.includes('shovel')) {
        almanacState.unlocked.weapons.push('shovel');
    }
    
    saveAlmanac();
}

// 保存图鉴状态
function saveAlmanac() {
    const newSaveData = { ...saveData, almanac: almanacState };
    setSaveData(newSaveData);
}

// 解锁物品
export function unlockItem(category, id) {
    if (!['plants', 'zombies', 'weapons'].includes(category)) return;
    
    if (!almanacState.unlocked[category].includes(id)) {
        almanacState.unlocked[category].push(id);
        saveAlmanac();
        return true;
    }
    return false;
}

// 标记为已查看
export function markAsViewed(category, id) {
    if (!almanacState.viewed[category].includes(id)) {
        almanacState.viewed[category].push(id);
        saveAlmanac();
    }
}

// 检查是否已解锁
export function isUnlocked(category, id) {
    return almanacState.unlocked[category]?.includes(id) || false;
}

// 获取植物列表
export function getPlantList() {
    return CARD_ORDER.map(key => ({
        id: key,
        ...PLANTS[key],
        unlocked: isUnlocked('plants', key),
        viewed: almanacState.viewed.plants?.includes(key) || false,
    }));
}

// 获取僵尸列表
export function getZombieList() {
    return Object.entries(ZOMBIE_DATA).map(([key, data]) => ({
        id: key,
        ...data,
        unlocked: isUnlocked('zombies', key),
        viewed: almanacState.viewed.zombies?.includes(key) || false,
    }));
}

// 获取武器列表
export function getWeaponList() {
    const weaponKeys = [...WEAPON_ORDER, 'shovel'];
    return weaponKeys.map(key => ({
        id: key,
        ...WEAPONS[key],
        unlocked: isUnlocked('weapons', key),
        viewed: almanacState.viewed.weapons?.includes(key) || false,
    }));
}

// 获取图鉴统计
export function getAlmanacStats() {
    const plantTotal = CARD_ORDER.length;
    const zombieTotal = Object.keys(ZOMBIE_DATA).length;
    const weaponTotal = WEAPON_ORDER.length + 1; // + shovel
    
    const plantUnlocked = almanacState.unlocked.plants.length;
    const zombieUnlocked = almanacState.unlocked.zombies.length;
    const weaponUnlocked = almanacState.unlocked.weapons.length;
    
    const total = plantTotal + zombieTotal + weaponTotal;
    const unlocked = plantUnlocked + zombieUnlocked + weaponUnlocked;
    
    return {
        total,
        unlocked,
        percentage: Math.floor((unlocked / total) * 100),
        plants: { total: plantTotal, unlocked: plantUnlocked },
        zombies: { total: zombieTotal, unlocked: zombieUnlocked },
        weapons: { total: weaponTotal, unlocked: weaponUnlocked },
    };
}

// 获取稀有度颜色
export function getRarityColor(rarity) {
    const colors = {
        common: '#888888',
        rare: '#4488ff',
        epic: '#aa44ff',
        legendary: '#ffaa00',
    };
    return colors[rarity] || colors.common;
}

// 获取稀有度中文名
export function getRarityName(rarity) {
    const names = {
        common: '普通',
        rare: '稀有',
        epic: '史诗',
        legendary: '传说',
    };
    return names[rarity] || '普通';
}

// 快捷方式：击杀僵尸时自动解锁对应图鉴
export function onZombieKilled(zombieType) {
    if (unlockItem('zombies', zombieType)) {
        // 可以加个解锁提示
        console.log(`%c解锁新僵尸: ${ZOMBIE_DATA[zombieType].name}`, 'color: #4488ff; font-weight: bold;');
    }
}

// 快捷方式：种植植物时自动解锁对应图鉴
export function onPlantPlanted(plantType) {
    unlockItem('plants', plantType);
}

// 快捷方式：获得武器时自动解锁
export function onWeaponObtained(weaponType) {
    unlockItem('weapons', weaponType);
}

export default {
    init: initAlmanac,
    unlock: unlockItem,
    markViewed: markAsViewed,
    isUnlocked,
    getPlants: getPlantList,
    getZombies: getZombieList,
    getWeapons: getWeaponList,
    getStats: getAlmanacStats,
    getRarityColor,
    getRarityName,
    onZombieKilled,
    onPlantPlanted,
    onWeaponObtained,
};
