// ============================================================
// 潘妮的小店
// ============================================================

import { META, saveCurrency, saveWeaponFrags, saveAmmo, addConsumable, refreshMeta, loadShopState, saveShopState, writeSave } from '../persistence/storage.js';
import { saveData } from '../core/state.js';
import { AMMO_INFO } from '../core/constants.js';

const SHOP_ITEMS = {
    items: [
        { id: 'heal', name: '急救包', desc: '下一局最大生命+50', price: { silver: 50 } },
        { id: 'double', name: '双倍阳光', desc: '本局阳光产出×2', price: { gold: 10 } },
        { id: 'shield', name: '临时护盾', desc: '开局获得3秒无敌', price: { gold: 15 } },
        { id: 'slot7', name: '卡槽 +1', desc: '永久扩展第7个卡槽', price: { gem: 5 } },
        { id: 'slot8', name: '卡槽 +1', desc: '永久扩展第8个卡槽', price: { gem: 10 } },
    ],
    weapons: [
        { id: 'pistol', name: '手枪碎片', desc: '10个手枪碎片', price: { silver: 80 }, amount: 10 },
        { id: 'shotgun', name: '散弹碎片', desc: '10个散弹碎片', price: { silver: 120 }, amount: 10 },
        { id: 'dagger', name: '匕首碎片', desc: '10个匕首碎片', price: { silver: 60 }, amount: 10 },
        { id: 'sword', name: '长剑碎片', desc: '10个长剑碎片', price: { silver: 100 }, amount: 10 },
    ],
    // 弹药：购入弹药库，开局带入局内作为备弹
    ammo: Object.entries(AMMO_INFO).map(([ammoType, info]) => ({
        id: 'ammo-' + ammoType, name: `${info.label} ×${info.pack}`,
        desc: `${info.label} ${info.pack} 发，开局带入局内`,
        price: info.price, ammoType, amount: info.pack,
    })),
    gacha: [
        { id: 'gacha1', name: '普通转盘', desc: '转动转盘赢碎片/货币，概率公示无保底', price: { silver: 100 }, wheel: 'normal' },
        { id: 'gacha2', name: '高级转盘', desc: '稀有碎片概率提升，概率公示无保底', price: { gem: 1 }, wheel: 'premium' },
    ],
};

let currentTab = 'items';
let shopState = null;
let lotteryBusy = false; // 转盘打开期间禁止连点重复扣款

const DAY_MS = 24 * 60 * 60 * 1000;

function getShopState() {
    shopState = loadShopState();
    // 超24h自动刷新
    if (Date.now() - shopState.lastRefresh > DAY_MS) {
        shopState.lastRefresh = Date.now();
        shopState.manualCount = 0;
        shopState.discounts = rollDiscounts();
        saveShopState(shopState);
        META.currency = { ...META.currency };
        refreshMeta();
    }
    return shopState;
}

function rollDiscounts() {
    const d = {};
    if (Math.random() < 0.2) {
        const all = [...SHOP_ITEMS.items, ...SHOP_ITEMS.weapons];
        const count = Math.random() < 0.5 ? 1 : 2;
        for (let i = 0; i < count && all.length > 0; i++) {
            const idx = Math.floor(Math.random() * all.length);
            const item = all.splice(idx, 1)[0];
            d[item.id] = { rate: 0.2 + Math.floor(Math.random() * 4) * 0.1, bought: false };
        }
    }
    return d;
}

export function initShop() {
    getShopState();

    document.querySelectorAll('.shop-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (currentTab === tab.dataset.tab) return;
            document.querySelectorAll('.shop-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            document.getElementById('shop-grid').innerHTML = '';
            renderShopItems();
        });
    });

    const refreshBtn = document.getElementById('shop-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            const st = getShopState();
            if (st.manualCount >= 3) {
                showSpeech('今日刷新次数已用完');
                return;
            }
            if ((META.currency.gem || 0) < 1) {
                showSpeech('钻石不足');
                return;
            }
            META.currency.gem = (META.currency.gem || 0) - 1;
            saveCurrency(META.currency);
            st.manualCount++;
            st.discounts = rollDiscounts();
            saveShopState(st);
            document.getElementById('shop-grid').innerHTML = '';
            renderShopItems();
            updateCurrencyDisplay();
			updateRefreshBtn();
            showSpeech('已刷新商品');
        });
    }

    renderShopItems();
    updateCurrencyDisplay();
	updateRefreshBtn();
}

function updateRefreshBtn() {
    const st = getShopState();
    const el = document.getElementById('shop-refresh');
    if (!el) return;
    const remain = 3 - st.manualCount;
    el.textContent = `刷新 (1钻) ${remain}/3`;
    el.disabled = remain <= 0;
}

function renderShopItems() {
    const grid = document.getElementById('shop-grid');
    if (!grid) return;
    const st = getShopState();
    const items = SHOP_ITEMS[currentTab] || [];

    if (grid.children.length === items.length) {
        updateButtons();
        return;
    }

    grid.innerHTML = '';
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'shop-item';

        const disc = st.discounts[item.id];
        const priceText = !disc ? priceStr(item.price) : '';
        const origText = disc ? priceStr(item.price) : '';
        const discPrice = disc ? discountPrice(item.price, disc.rate) : null;

        const alreadyOwned = (item.id === 'slot7' && (saveData.maxSlots || 6) >= 7)
            || (item.id === 'slot8' && (saveData.maxSlots || 6) >= 8);
        const owned = currentTab === 'items' && META.consumables && META.consumables[item.id]
            ? `已拥有: ${META.consumables[item.id]}`
            : (item.ammoType ? `库存: ${META.ammo[item.ammoType] || 0} 发` : '');
        const bought = disc && disc.bought;

        card.innerHTML = `
            <div class="shop-name">${item.name}</div>
            <div class="shop-desc">${item.desc}</div>
            ${owned ? `<div class="shop-owned">${owned}</div>` : ''}
            ${disc ? `<div class="shop-price"><span class="orig-price">${origText}</span> <span class="disc-price">${priceStr(discPrice)}</span><span class="disc-badge">-${Math.round(disc.rate * 100)}%</span>${bought ? '<span class="sold-out">已售罄</span>' : ''}</div>` : `<div class="shop-price">${alreadyOwned ? '已解锁' : priceText}</div>`}
            <button class="menu-btn buy-btn" ${alreadyOwned || bought ? 'disabled' : ''}>${alreadyOwned ? '已解锁' : bought ? '已售罄' : '购买'}</button>
        `;

        const buyBtn = card.querySelector('.buy-btn');
        if (!alreadyOwned && !bought) {
            buyBtn.addEventListener('click', () => buyItem(item, card, disc));
        }

        grid.appendChild(card);
    });
}

function updateButtons() {
    const st = getShopState();
    const items = SHOP_ITEMS[currentTab] || [];
    document.querySelectorAll('#shop-grid .shop-item').forEach((card, index) => {
        const item = items[index];
        if (!item) return;
        const buyBtn = card.querySelector('.buy-btn');
        const alreadyOwned = (item.id === 'slot7' && (saveData.maxSlots || 6) >= 7)
            || (item.id === 'slot8' && (saveData.maxSlots || 6) >= 8);
        const disc = st.discounts[item.id];
        const bought = disc && disc.bought;
        const discPrice = disc ? discountPrice(item.price, disc.rate) : null;
        const canAfford = checkCanAfford(discPrice || item.price);
        if (alreadyOwned) { buyBtn.textContent = '已解锁'; buyBtn.disabled = true; }
        else if (bought) { buyBtn.textContent = '已售罄'; buyBtn.disabled = true; }
        else { buyBtn.disabled = !canAfford; }
    });
}

function priceStr(price) {
    return Object.entries(price).map(([k, v]) => `${k === 'silver' ? '银' : k === 'gold' ? '金' : '钻'} ${v}`).join(' ');
}

function discountPrice(price, rate) {
    const p = {};
    for (const k in price) p[k] = Math.max(1, Math.round(price[k] * (1 - rate)));
    return p;
}

function checkCanAfford(price) {
    return Object.entries(price).every(([type, amount]) => (META.currency[type] || 0) >= amount);
}

// 购买/抽奖后强制全量重渲染（renderShopItems 的数量相同走快捷路径只更新按钮，
// 不会刷新"库存/已拥有"文本，所以这里先清空网格）
function rerenderShop() {
    const grid = document.getElementById('shop-grid');
    if (grid) grid.innerHTML = '';
    renderShopItems();
    updateCurrencyDisplay();
}

function buyItem(item, card, disc) {
    // 转盘打开期间禁止连点（扣款前拦截）
    if (currentTab === 'gacha' && lotteryBusy) return;

    const st = getShopState();
    const actualPrice = disc ? discountPrice(item.price, disc.rate) : item.price;
    if (!checkCanAfford(actualPrice)) return;

    Object.entries(actualPrice).forEach(([type, amount]) => {
        META.currency[type] = (META.currency[type] || 0) - amount;
    });
    saveCurrency(META.currency);

    if (currentTab === 'weapons' && item.amount) {
        META.weaponFrags[item.id] = (META.weaponFrags[item.id] || 0) + item.amount;
        saveWeaponFrags(META.weaponFrags);
        showSpeech(`获得 ${item.amount} 个${item.name}！`);
    } else if (item.ammoType) {
        // 弹药入弹药库，开局带入局内
        META.ammo[item.ammoType] = (META.ammo[item.ammoType] || 0) + item.amount;
        saveAmmo(META.ammo);
        showSpeech(`${item.name} 已入库（现有 ${META.ammo[item.ammoType]} 发）`);
    } else if (currentTab === 'gacha') {
        // 打开大转盘：动画结束后奖励自动入碎片背包，关闭时刷新商店并播报抽中结果
        lotteryBusy = true;
        import('./lotteryUI.js').then(m => {
            m.openLottery(item.wheel, (resultText) => {
                lotteryBusy = false;
                if (resultText) showSpeech(`抽中 ${resultText}！`);
                refreshMeta();
                rerenderShop();
            });
        }).catch(() => { lotteryBusy = false; });
    } else if (item.id === 'heal') {
        const consumables = addConsumable('heal', 1);
        showSpeech(`急救包×${consumables.heal}，下次关卡最大生命+50。`);
    } else if (item.id === 'double') {
        const consumables = addConsumable('double', 1);
        showSpeech(`双倍阳光×${consumables.double}，下次关卡阳光翻倍。`);
    } else if (item.id === 'shield') {
        const consumables = addConsumable('shield', 1);
        showSpeech(`临时护盾×${consumables.shield}，下次关卡开局无敌。`);
    } else if (item.id === 'slot7') {
        saveData.maxSlots = 7;
        writeSave(saveData);
        showSpeech('已解锁第7个卡槽！');
    } else if (item.id === 'slot8') {
        saveData.maxSlots = 8;
        writeSave(saveData);
        showSpeech('已解锁第8个卡槽！');
    }

    if (disc) {
        st.discounts[item.id].bought = true;
        saveShopState(st);
    }

    refreshMeta();
    rerenderShop();
}

function updateCurrencyDisplay() {
    ['silver', 'gold', 'gem'].forEach(type => {
        const el = document.getElementById(`cur-${type}-shop`);
        if (el) el.textContent = META.currency[type] || 0;
    });
}

let speechTimer = 0;
function showSpeech(text) {
    const el = document.getElementById('shop-speech');
    if (el) el.textContent = text;
    clearTimeout(speechTimer);
    if (text) speechTimer = setTimeout(() => { if (el) el.textContent = ''; }, 2500);
}

export default { init: initShop, refresh: () => { renderShopItems(); updateCurrencyDisplay(); } };
