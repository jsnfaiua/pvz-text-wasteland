// ============================================================
// 图鉴主界面 - 植物/僵尸/武器/护甲 四分类
// ============================================================

import { PLANTS, ZOMBIES, WEAPONS, LEVEL_TABLE, WEAPON_META } from '../core/constants.js';
import { META, refreshMeta, saveFragments, saveLevels, saveWeapons, saveWeaponFrags } from '../persistence/storage.js';
import { dave, saveData } from '../core/state.js';
import { ZOMBIE_DATA } from '../systems/almanac.js';

let currentTab = 'plants';
let selectedItem = null;

// 护甲图鉴（与局内僵尸掉落头盔一致，信息性条目）
const ARMORS = {
    cone: {
        id: 'cone',
        name: '路障头盔',
        desc: '路障僵尸掉落的头盔，拾取后戴在头上，为戴夫抵挡伤害。',
        color: '#FF8800',
        rarity: 'common',
        unlocked: true,
    },
    bucket: {
        id: 'bucket',
        name: '铁桶头盔',
        desc: '铁桶僵尸掉落的铁桶，防护力更强，能吸收大量伤害。',
        color: '#AAAAAA',
        rarity: 'rare',
        unlocked: true,
    },
};

const PLANT_FRAG_NAMES = {
    sunflower:   '葵片',
    peashooter:  '豌片',
    wallnut:     '果片',
    cherry:      '桃片',
    potatomine:  '雷片',
    snowpea:     '冰片',
    chomper:     '嘴片',
    repeater:    '双片',
};

export function initAlmanacUI() {
    // Tab切换
    document.querySelectorAll('.almanac-tab-main').forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });

    // 返回按钮
    document.getElementById('btn-back-menu-almanac')?.addEventListener('click', () => {
        document.getElementById('almanac-screen').classList.add('hidden');
        document.getElementById('menu-screen').classList.remove('hidden');
    });

    // 详情操作按钮：事件委托只绑定一次（此前每次点开详情都叠加新监听，导致升级/装备重复触发）
    document.getElementById('detail-actions')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.classList.contains('disabled')) return;
        const id = btn.dataset.id;
        switch (btn.dataset.action) {
            case 'upgrade-plant': upgradePlant(id); break;
            case 'unlock-weapon': handleWeaponAction(id, 'unlock'); break;
            case 'equip': equipWeapon(id); break;
            case 'unequip': {
                // 按槽位卸下（近战槽/远程槽各自独立）
                if (META.weapons.equippedMelee === id) META.weapons.equippedMelee = null;
                if (META.weapons.equippedRanged === id) META.weapons.equippedRanged = null;
                META.weapons.equipped = null;
                saveWeapons(META.weapons);
                refreshMeta();
                if (dave.equippedMelee === id) dave.equippedMelee = null;
                if (dave.equippedRanged === id) dave.equippedRanged = null;
                dave.currentWeapon = null;
                dave.equippedWeapon = null;
                renderGrid();
                showDetail(id, currentTab);
                break;
            }
        }
    });

    renderGrid();
}

function switchTab(tab) {
    if (currentTab === tab) return;
    currentTab = tab;
    selectedItem = null;
    
    document.querySelectorAll('.almanac-tab-main').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    
    renderGrid();
    clearDetail();
}

function renderGrid() {
    const grid = document.getElementById('almanac-grid-main');
    if (!grid) return;
    grid.innerHTML = '';

    const seen = saveData.seenZombies || [];
    let items = [];
    switch(currentTab) {
        case 'plants':
            // 与关卡解锁进度一致：通关获得的新植物才显示详情，未解锁显示 ???
            items = Object.entries(PLANTS).map(([id, data]) => ({
                id, ...data,
                unlocked: (saveData.unlockedPlants || []).includes(id)
            }));
            break;
        case 'zombies':
            // 击杀过才解锁图鉴（击杀时记录 seenZombies 入档）
            items = Object.entries(ZOMBIES).map(([id, data]) => ({
                id, ...data,
                rarity: ZOMBIE_DATA[id]?.rarity || 'common',
                unlocked: seen.includes(id)
            }));
            break;
        case 'weapons':
            items = Object.entries(WEAPONS).map(([id, data]) => ({
                id, ...data,
                unlocked: id === 'shovel' ? true : META.weapons.unlocked[id]
            }));
            break;
        case 'armors':
            items = Object.values(ARMORS);
            break;
    }

    // 头部收集度计数
    const unlockedCount = items.filter(i => i.unlocked).length;
    const progressEl = document.getElementById('almanac-progress');
    if (progressEl) progressEl.textContent = `收集 ${unlockedCount} / ${items.length}`;

    // 武器页签：按 远程 / 近战 / 工具 分组渲染（未解锁武器也显示名称，可点开查看解锁进度）
    if (currentTab === 'weapons') {
        const groups = [
            { title: '远程武器', list: items.filter(i => i.kind === 'ranged') },
            { title: '近战武器', list: items.filter(i => i.kind === 'melee' && i.id !== 'shovel') },
            { title: '工具', list: items.filter(i => i.id === 'shovel') },
        ];
        groups.forEach(g => {
            if (!g.list.length) return;
            const header = document.createElement('div');
            header.className = 'almanac-group-header';
            header.textContent = `── ${g.title} ──`;
            grid.appendChild(header);
            g.list.forEach(item => grid.appendChild(renderCard(item)));
        });
        return;
    }

    items.forEach(item => grid.appendChild(renderCard(item)));
}

function renderCard(item) {
    const card = document.createElement('div');
    card.className = `almanac-item-main ${!item.unlocked ? 'locked' : ''} ${selectedItem?.id === item.id ? 'active' : ''}`;
    card.style.borderLeftColor = item.color || '#888';

    const rarityColor = getRarityColor(item.rarity || 'common');
    // 武器页签不打问号：显示真实名称 + 未解锁标签，点击可查看属性与解锁进度
    const isWeapon = currentTab === 'weapons';
    const nameText = (item.unlocked || isWeapon) ? item.name : '???';
    const lockTag = (!item.unlocked && isWeapon) ? '<span class="item-lock-tag">未解锁</span>' : '';

    card.innerHTML = `
        <div class="item-name">${nameText}${lockTag}</div>
        ${item.rarity ? `<span class="item-rarity" style="color: ${rarityColor}">${getRarityName(item.rarity)}</span>` : ''}
    `;

    card.addEventListener('click', () => {
        if (!item.unlocked && !isWeapon) return;
        document.querySelectorAll('.almanac-item-main').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedItem = item;
        showDetail(item.id, currentTab);
    });

    return card;
}

function showDetail(id, category) {
    const previewEl = document.getElementById('detail-preview');
    const titleEl = document.getElementById('almanac-detail-title');
    const statsEl = document.getElementById('detail-stats');
    const descEl = document.getElementById('detail-desc');
    const progressEl = document.getElementById('detail-progress');
    const actionsEl = document.getElementById('detail-actions');

    let item;
    switch(category) {
        case 'plants': item = { id, ...PLANTS[id] }; break;
        case 'zombies': item = { id, ...ZOMBIES[id] }; break;
        case 'weapons': item = { id, ...WEAPONS[id], unlocked: id === 'shovel' ? true : META.weapons.unlocked[id] }; break;
        case 'armors': item = ARMORS[id]; break;
    }

    // 预览区域 - 简易局内表现动画
    previewEl.innerHTML = renderPreview(item, category);
    titleEl.textContent = item.name;
    titleEl.style.color = item.color || '#fff';
    
    // 默认描述
    let desc = item.desc || '';
    if (!desc && category === 'zombies') {
        desc = ZOMBIE_DATA[item.id]?.desc || '普通僵尸，数量众多但相对容易对付。';
    }
    if (!desc && category === 'plants') {
        if (item.id === 'potatomine') desc = '武装后触发。附近有僵尸时自动爆炸，造成高额伤害。';
        else if (item.produceInterval) desc = '稳定生产阳光，是经济来源的基础。';
        else if (item.fireInterval) desc = '向前发射豌豆，对僵尸造成稳定伤害。';
        else if (item.fuse) desc = '引爆后对周围大范围僵尸造成毁灭性伤害。';
        else desc = '超高生命值，能够阻挡僵尸前进很长时间。';
    } else if (!desc && category === 'zombies') {
        desc = '普通僵尸，数量众多但相对容易对付。';
    }
    descEl.textContent = desc;

    // 属性区域
    statsEl.innerHTML = renderStats(item, category);

    // 进度和操作区域
    if (category === 'plants' || category === 'weapons') {
        progressEl.innerHTML = renderProgress(item, category);
        progressEl.style.visibility = 'visible';
        actionsEl.innerHTML = renderActions(item, category);
        actionsEl.style.visibility = 'visible';
    } else {
        progressEl.innerHTML = '';
        progressEl.style.visibility = 'hidden';
        actionsEl.innerHTML = '';
        actionsEl.style.visibility = 'hidden';
    }
    // 按钮事件由 initAlmanacUI 的事件委托统一处理，无需重复绑定
}

function renderPreview(item, category) {
    const color = item.color || '#888';
    if (category === 'plants') {
        const actionText = item.fireInterval ? '[ → 发射豌豆 ]' : 
                          item.produceInterval ? '[ ☼ 产出阳光 ]' : '[ ■ 防御姿态 ]';
        return `
            <div class="preview-plant" style="color: ${color}">
                <div class="preview-plant-head">[ ${item.name} ]</div>
                <div class="preview-plant-body">
                    ${actionText}
                </div>
                <div class="preview-ground">─── 草坪 ───</div>
            </div>
        `;
    } else if (category === 'zombies') {
        return `
            <div class="preview-zombie" style="color: ${color}">
                <div class="zombie-body">[ ${item.name} ]</div>
                <div class="zombie-attack">→ 正在逼近...</div>
            </div>
        `;
    } else if (category === 'weapons') {
        const weaponType = item.id === 'shovel' ? '工具' : (item.kind === 'melee' ? '近战武器' : '远程武器');
        return `
            <div class="preview-weapon" style="color: ${color}">
                <div class="weapon-display">[ ${item.name} ]</div>
                <div class="weapon-attack">
                    ${weaponType} · ${item.kind === 'melee' ? '攻击范围 ' + item.reach : '子弹速度 ' + item.bulletSpeed}
                </div>
            </div>
        `;
    } else if (category === 'armors') {
        return `
            <div class="preview-armor" style="color: ${color}">
                <div class="armor-display">[ ${item.name} ]</div>
                <div class="armor-effect">拾取后自动装备到戴夫头上</div>
            </div>
        `;
    }
    return '';
}

function renderStats(item, category) {
    let stats = [];
    
    if (category === 'plants') {
        const level = META.levels[item.id] || 1;
        const mul = (LEVEL_TABLE.find(l => l.lv === level) || {}).mul || 1;
        stats = [
            { label: '阳光成本', value: item.cost },
            { label: '冷却时间', value: item.cooldown + '秒' },
            { label: '生命值', value: Math.round(item.hp * mul) },
        ];
        if (item.fireInterval) stats.push({ label: '攻击间隔', value: item.fireInterval + '秒' });
        if (item.bulletDamage) stats.push({ label: '子弹伤害', value: Math.round(item.bulletDamage * mul) });
        if (item.killRange) stats.push({ label: '吞噬范围', value: Math.round(item.killRange * mul) });
        if (item.produceInterval) stats.push({ label: '生产间隔', value: item.produceInterval + '秒' });
        if (item.fuse) stats.push({ label: '引爆时间', value: item.fuse + '秒' });
        if (item.blastDamage) stats.push({ label: '爆炸伤害', value: Math.round(item.blastDamage * mul) });
        if (item.blastRadius) stats.push({ label: '爆炸半径', value: Math.round(item.blastRadius * mul) });
        stats.push({ label: '当前等级', value: 'Lv.' + level });
        // 下一级属性预览：按 LEVEL_TABLE 相对基础的百分比加成
        if (level < 5) {
            const nextMul = (LEVEL_TABLE.find(l => l.lv === level + 1) || {}).mul;
            if (nextMul) {
                const pct = Math.round((nextMul - 1) * 100);
                const parts = [];
                if (item.bulletDamage) parts.push(`子弹伤害 +${pct}%`);
                if (item.killRange) parts.push(`吞噬范围 +${pct}%`);
                if (item.produceInterval) parts.push(`产阳光速度 +${pct}%`);
                if (item.blastDamage) parts.push(`爆炸伤害 +${pct}%`);
                parts.push(`生命 +${pct}%`);
                stats.push({ label: `Lv${level + 1} 预览`, value: parts.join(' · '), preview: true });
            }
        }
    } else if (category === 'zombies') {
        stats = [
            { label: '生命值', value: item.hp },
            { label: '移动速度', value: ZOMBIE_DATA[item.id]?.speed || item.speed },
            { label: '伤害', value: item.damage + '/秒' },
        ];
        if (item.armorHp) stats.splice(1, 0, { label: '护甲值', value: item.armorHp });
    } else if (category === 'weapons') {
        // 武器暂不开放升级：只展示固定基础属性
        stats = [
            { label: '类型', value: item.id === 'shovel' ? '工具' : (item.kind === 'melee' ? '近战' : '远程') },
            { label: '伤害', value: item.damage },
            { label: '攻击间隔', value: item.autoInterval ? `${item.fireInterval}秒（全自动 ${item.autoInterval}秒）` : item.fireInterval + '秒' },
        ];
        if (item.kind === 'melee') stats.push({ label: '攻击范围', value: item.reach });
        if (item.kind === 'ranged') stats.push({ label: '子弹速度', value: item.bulletSpeed });
        if (item.range) stats.push({ label: '有效射程', value: item.range >= 1000 ? '全图（无衰减）' : item.range + 'px（超出衰减至40%）' });
        if (item.penArmor && item.penArmor !== 1) stats.push({ label: '穿甲系数', value: '×' + item.penArmor });
        if (item.pierce) stats.push({ label: '穿透', value: `可穿透 ${item.pierce} 个目标` });
        if (item.pellets) stats.push({ label: '弹丸数', value: item.pellets });
        if (item.magSize) stats.push({ label: '弹匣容量', value: item.magSize + '发' });
        if (item.stamina) stats.push({ label: '体力消耗', value: item.stamina + '点/次' });
        if (item.reloadTime) stats.push({ label: '换弹时间', value: item.reloadTime + '秒' });
        if (item.chargeable) stats.push({ label: '蓄力', value: '按住左键蓄力，伤害最高×1.5' });
        if (item.modes && item.modes.length > 1) stats.push({ label: '射击模式', value: '半自动/全自动（局内按 V 切换）' });
    } else if (category === 'armors') {
        stats = [
            { label: '类型', value: '头部护甲' },
            { label: '来源', value: '击杀对应僵尸掉落' },
            { label: '稀有度', value: getRarityName(item.rarity) },
        ];
    }

    return stats.map(s => `
        <div class="stat-row-main ${s.preview ? 'next-preview' : ''}">
            <span class="stat-label">${s.label}</span>
            <span class="stat-value">${s.value}</span>
        </div>
    `).join('');
}

function renderProgress(item, category) {
    let current, need, frags, label;
    
    if (category === 'plants') {
        const level = META.levels[item.id] || 1;
        const maxLevel = 5;
        if (level >= maxLevel) {
            return `<div class="progress-full">已满级</div>`;
        }
        const table = LEVEL_TABLE.find(l => l.lv === level);
        const nextTable = LEVEL_TABLE.find(l => l.lv === level + 1);
        need = nextTable ? nextTable.cumulative - table.cumulative : 999;
        frags = META.fragments[item.id] || 0;
        label = `${PLANT_FRAG_NAMES[item.id] || '碎片'}`;
        current = level;
    } else if (category === 'weapons' && item.id !== 'shovel') {
        // 武器暂不开放升级：未解锁显示解锁进度，已解锁不再显示进度条
        const meta = WEAPON_META[item.id];
        const unlocked = META.weapons.unlocked[item.id];
        if (unlocked) return '';
        need = meta?.unlockCost || 15;
        frags = META.weaponFrags[item.id] || 0;
        label = meta?.fragLabel || '碎片';
        current = 0;
    } else {
        return '';
    }
    
    const pct = Math.min(100, (frags / need) * 100);
    
    return `
        <div class="progress-bar-main">
            <div class="progress-bar-inner" style="width: ${pct}%"></div>
            <span class="progress-bar-text">${frags} / ${need} ${label}</span>
        </div>
    `;
}

function renderActions(item, category) {
    if (category === 'plants') {
        const level = META.levels[item.id] || 1;
        if (level >= 5) return '';
        
        const table = LEVEL_TABLE.find(l => l.lv === level);
        const nextTable = LEVEL_TABLE.find(l => l.lv === level + 1);
        const need = nextTable ? nextTable.cumulative - table.cumulative : 999;
        const frags = META.fragments[item.id] || 0;
        const canUpgrade = frags >= need;
        
        return `
            <button class="action-btn-main ${canUpgrade ? '' : 'disabled'}" data-id="${item.id}" data-action="upgrade-plant">
                升级
            </button>
        `;
    }
    
    if (category === 'weapons' && item.id !== 'shovel') {
        // 武器暂不开放升级：解锁 / 按槽位装备（近战槽/远程槽可各带一把）/ 卸下
        const meta = WEAPON_META[item.id];
        const unlocked = META.weapons.unlocked[item.id];
        const need = meta?.unlockCost || 15;
        const frags = META.weaponFrags[item.id] || 0;
        const slot = item.kind === 'melee' ? 'equippedMelee' : 'equippedRanged';
        const equipped = META.weapons[slot] === item.id;
        const slotName = item.kind === 'melee' ? '近战槽' : '远程槽';

        let buttons = '';
        if (!unlocked) {
            const canAct = frags >= need;
            buttons += `<button class="action-btn-main ${canAct ? '' : 'disabled'}" data-id="${item.id}" data-action="unlock-weapon">
                解锁
            </button>`;
        }
        if (unlocked) {
            buttons += `<button class="equip-btn-main" data-id="${item.id}" data-action="equip" data-equipped="${equipped}">
                ${equipped ? `已装备（${slotName}）` : `装备到${slotName}`}
            </button>`;
        }
        if (equipped) {
            buttons += `<button class="unequip-btn-main" data-id="${item.id}" data-action="unequip">卸下</button>`;
        }
        return buttons;
    }
    
    if (category === 'weapons' && item.id === 'shovel') {
        // 铲子是局内工具，不占武器槽，解锁后局内按 C 随时切出/收回
        return `<span class="tool-hint-label" style="color:#B87333;font-weight:bold;">局内按 C 使用（不占武器槽）</span>`;
    }
    
    return '';
}

function clearDetail() {
    document.getElementById('detail-preview').innerHTML = '<div class="preview-placeholder">选择物品查看预览</div>';
    document.getElementById('almanac-detail-title').textContent = '选择一个物品';
    document.getElementById('detail-stats').innerHTML = '';
    document.getElementById('detail-desc').textContent = '';
    document.getElementById('detail-progress').innerHTML = '';
    document.getElementById('detail-actions').innerHTML = '';
}

function upgradePlant(id) {
    const level = META.levels[id] || 1;
    if (level >= 5) return;
    
    const table = LEVEL_TABLE.find(l => l.lv === level);
    const nextTable = LEVEL_TABLE.find(l => l.lv === level + 1);
    const need = nextTable ? nextTable.cumulative - table.cumulative : 999;
    
    if ((META.fragments[id] || 0) < need) return;
    
    META.fragments[id] -= need;
    META.levels[id] = level + 1;
    saveFragments(META.fragments);
    saveLevels(META.levels);
    refreshMeta();
    
    renderGrid();
    showDetail(id, currentTab);
}

function handleWeaponAction(id, action) {
    const meta = WEAPON_META[id];
    if (!meta) return;
    if (action !== 'unlock') return; // 武器暂不开放升级

    const need = meta.unlockCost || 15;
    if ((META.weaponFrags[id] || 0) < need) return;

    META.weaponFrags[id] = (META.weaponFrags[id] || 0) - need;
    META.weapons.unlocked[id] = true;
    META.weapons.levels[id] = 1;

    saveWeaponFrags(META.weaponFrags);
    saveWeapons(META.weapons);
    refreshMeta();

    renderGrid();
    showDetail(id, currentTab);
}

function equipWeapon(id) {
    if (id !== 'shovel' && !META.weapons.unlocked[id]) return;

    // 按武器类型装入对应槽位（近战/远程可各带一把，局内 X 切换）
    const kind = id === 'shovel' ? 'melee' : WEAPONS[id]?.kind;
    if (kind === 'melee') META.weapons.equippedMelee = id;
    else META.weapons.equippedRanged = id;
    META.weapons.equipped = null;
    saveWeapons(META.weapons);
    refreshMeta();

    dave.equippedMelee = META.weapons.equippedMelee;
    dave.equippedRanged = META.weapons.equippedRanged;
    dave.currentWeapon = id;
    dave.equippedWeapon = id;
    dave.equippedLevel = 1; // 武器暂不开放升级，恒为 1 级

    renderGrid();
    showDetail(id, currentTab);
}

function getRarityColor(rarity) {
    const colors = { common: '#888888', rare: '#4488ff', epic: '#aa44ff', legendary: '#ffaa00' };
    return colors[rarity] || colors.common;
}

function getRarityName(rarity) {
    const names = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
    return names[rarity] || '普通';
}

export default {
    init: initAlmanacUI,
    refresh: () => { renderGrid(); if (selectedItem) showDetail(selectedItem.id, currentTab); }
};
