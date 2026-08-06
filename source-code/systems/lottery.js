// ============================================================
// 大转盘抽奖系统（总框架 3.3 / 5.4）
// - 扇形面积严格对应中奖概率（角度 = 权重占比 × 360°）
// - 无保底机制，概率完全公开公示
// - 转盘动画时长与 gachaSpin 音效精准同步
// - 奖励自动存入碎片背包 / 货币
// ============================================================

import { PLANTS, WEAPONS } from '../core/constants.js';
import { META, saveFragments, saveWeaponFrags, saveWeapons, saveCurrency } from '../persistence/storage.js';

const W_FRAG_POOL = ['pistol', 'smg', 'rifle', 'sniper', 'shotgun', 'bow', 'knife', 'dagger', 'spear', 'axe', 'sword'];

// 扇区类型：frag=植物碎片 / wfrag=随机武器碎片 / currency=货币
export const LOTTERY_WHEELS = {
    normal: {
        id: 'normal', name: '普通转盘', price: { silver: 100 },
        sectors: [
            { key: 'frag-sunflower',  label: '向日葵碎片',   type: 'frag',     plant: 'sunflower',  min: 3, max: 8,   weight: 16, color: '#FFD700' },
            { key: 'frag-peashooter', label: '豌豆射手碎片', type: 'frag',     plant: 'peashooter', min: 3, max: 8,   weight: 16, color: '#7CFC00' },
            { key: 'frag-wallnut',    label: '坚果碎片',     type: 'frag',     plant: 'wallnut',    min: 3, max: 8,   weight: 14, color: '#D2691E' },
            { key: 'frag-potatomine', label: '土豆地雷碎片', type: 'frag',     plant: 'potatomine', min: 3, max: 8,   weight: 12, color: '#CD853F' },
            { key: 'wfrag',           label: '武器碎片',     type: 'wfrag',                         min: 3, max: 8,   weight: 14, color: '#9370DB' },
            { key: 'weapon',          label: '随机武器',     type: 'weapon',  pool: ['knife', 'dagger', 'pistol', 'spear', 'bow', 'shotgun'], dupGems: 1, min: 1, max: 1, weight: 10, color: '#FF69B4' },
            { key: 'silver',          label: '银币',         type: 'currency', currency: 'silver',  min: 30, max: 80, weight: 12, color: '#C0C0C0' },
            { key: 'gold',            label: '金币',         type: 'currency', currency: 'gold',    min: 3, max: 8,   weight: 8,  color: '#FFA500' },
            { key: 'gem',             label: '钻石',         type: 'currency', currency: 'gem',     min: 1, max: 1,   weight: 4,  color: '#1E90FF' },
        ],
    },
    premium: {
        id: 'premium', name: '高级转盘', price: { gem: 1 },
        sectors: [
            { key: 'frag-cherry',   label: '樱桃炸弹碎片', type: 'frag',     plant: 'cherry',   min: 10, max: 20,  weight: 14, color: '#FF4500' },
            { key: 'frag-snowpea',  label: '寒冰射手碎片', type: 'frag',     plant: 'snowpea',  min: 10, max: 20,  weight: 14, color: '#00BFFF' },
            { key: 'frag-chomper',  label: '大嘴花碎片',   type: 'frag',     plant: 'chomper',  min: 10, max: 20,  weight: 14, color: '#9932CC' },
            { key: 'frag-repeater', label: '双发射手碎片', type: 'frag',     plant: 'repeater', min: 10, max: 20,  weight: 14, color: '#32CD32' },
            { key: 'wfrag',         label: '武器碎片',     type: 'wfrag',                       min: 10, max: 20,  weight: 14, color: '#9370DB' },
            { key: 'weapon',        label: '整把武器',     type: 'weapon',  pool: ['sword', 'axe', 'rifle', 'smg', 'sniper', 'bow', 'shotgun'], dupGems: 1, min: 1, max: 1, weight: 10, color: '#FF1493' },
            { key: 'gold',          label: '金币',         type: 'currency', currency: 'gold',  min: 10, max: 25,  weight: 12, color: '#FFA500' },
            { key: 'gem',           label: '钻石',         type: 'currency', currency: 'gem',   min: 2, max: 3,    weight: 8,  color: '#1E90FF' },
            { key: 'silver',        label: '银币',         type: 'currency', currency: 'silver', min: 100, max: 200, weight: 6, color: '#C0C0C0' },
        ],
    },
};

function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

// 加权随机：先定中奖扇区与数量，UI 据此反推停驻角度
export function rollLottery(wheelId) {
    const wheel = LOTTERY_WHEELS[wheelId];
    if (!wheel) return null;
    const total = wheel.sectors.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < wheel.sectors.length; i++) {
        r -= wheel.sectors[i].weight;
        if (r <= 0) { idx = i; break; }
    }
    const sector = wheel.sectors[idx];
    const result = { wheelId, sectorIndex: idx, sector, count: randInt(sector.min, sector.max) };

    if (sector.type === 'wfrag') {
        result.weapon = W_FRAG_POOL[Math.floor(Math.random() * W_FRAG_POOL.length)];
        result.text = `${WEAPONS[result.weapon]?.name || '武器'}碎片 ×${result.count}`;
    } else if (sector.type === 'weapon') {
        result.weapon = sector.pool[Math.floor(Math.random() * sector.pool.length)];
        result.count = 1;
        result.text = `${WEAPONS[result.weapon]?.name || '武器'}（整把）`;
    } else if (sector.type === 'frag') {
        result.text = `${PLANTS[sector.plant]?.name || sector.label}碎片 ×${result.count}`;
    } else {
        const cn = { silver: '银币', gold: '金币', gem: '钻石' }[sector.currency];
        result.text = `${cn} ×${result.count}`;
    }
    return result;
}

// 中奖后写入存档（碎片背包 / 货币）
export function applyLotteryResult(result) {
    const { sector, count } = result;
    if (sector.type === 'frag') {
        META.fragments[sector.plant] = (META.fragments[sector.plant] || 0) + count;
        saveFragments(META.fragments);
    } else if (sector.type === 'wfrag') {
        META.weaponFrags[result.weapon] = (META.weaponFrags[result.weapon] || 0) + count;
        saveWeaponFrags(META.weaponFrags);
    } else if (sector.type === 'weapon') {
        const wname = WEAPONS[result.weapon]?.name || '武器';
        if (META.weapons.unlocked[result.weapon]) {
            // 重复武器转化为钻石
            const gems = sector.dupGems || 1;
            META.currency.gem = (META.currency.gem || 0) + gems;
            saveCurrency(META.currency);
            result.converted = true;
            result.text = `${wname} 已拥有 → 钻石 ×${gems}`;
        } else {
            META.weapons.unlocked[result.weapon] = true;
            META.weapons.levels[result.weapon] = 1;
            saveWeapons(META.weapons);
            result.text = `${wname}（整把）已解锁！`;
        }
    } else if (sector.type === 'currency') {
        META.currency[sector.currency] = (META.currency[sector.currency] || 0) + count;
        saveCurrency(META.currency);
    }
}

// 概率公示面板数据
export function getSectorProbabilities(wheelId) {
    const wheel = LOTTERY_WHEELS[wheelId];
    if (!wheel) return [];
    const total = wheel.sectors.reduce((s, x) => s + x.weight, 0);
    return wheel.sectors.map(s => ({
        label: s.label,
        range: s.min === s.max ? `×${s.min}` : `×${s.min}~${s.max}`,
        pct: (s.weight / total) * 100,
        color: s.color,
    }));
}
