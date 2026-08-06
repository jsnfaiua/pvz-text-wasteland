// ============================================================
// HUD 显示更新
// ============================================================

import { CARD_ORDER, PLANTS, WEAPONS } from '../core/constants.js';
import { state, dave, saveData } from '../core/state.js';
import { META } from '../persistence/storage.js';

let uiRefs = {};
// 上次写入的 DOM 值缓存：值没变就不写，避免每帧无效的 textContent/style 写入
let _last = {};

export function initHUD() {
    uiRefs = {
        sunValue: document.getElementById('sun-value'),
        waveValue: document.getElementById('wave-value'),
        waveMax: document.getElementById('wave-max'),
        hpValue: document.getElementById('hp-value'),
        heroName: document.getElementById('hero-name'),
        logText: document.getElementById('log-text'),
        weaponName: document.getElementById('weapon-name'),
        weaponDur: document.getElementById('weapon-dur'),
        cardSlots: document.getElementById('card-slots'),
        coinSilver: document.getElementById('coin-silver'),
        coinGold: document.getElementById('coin-gold'),
        coinGem: document.getElementById('coin-gem'),
        waveDisplay: document.getElementById('wave-display'),
        hpFill: document.getElementById('hp-mini-fill'),
        stFill: document.getElementById('st-mini-fill'),
        stValue: document.getElementById('st-value'),
        cardRefs: [],
    };
    _last = {};
    renderCardSlots();
}

export function renderCardSlots() {
    if (!uiRefs.cardSlots) return;
    uiRefs.cardSlots.innerHTML = '';
    uiRefs.cardRefs = [];
    // 按解锁顺序排列
    const ordered = [];
    for (const key of (saveData.unlockedPlants || [])) {
        if (state._allowedCards && state._allowedCards.length > 0 && state._allowedCards.includes(key)) {
            ordered.push(key);
        }
    }
    for (const key of CARD_ORDER) {
        if (!ordered.includes(key) && state._allowedCards && state._allowedCards.includes(key)) {
            ordered.push(key);
        }
    }
    ordered.forEach((key) => {
        const def = PLANTS[key];
        if (!def) return;
        const level = META.levels[key] || 1;
        const i = CARD_ORDER.indexOf(key);
        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.index = i;
        el.innerHTML = `
            ${level >= 2 ? `<span class="lv">${level >= 5 ? '★' : 'Lv' + level}</span>` : ''}
            <span class="name">${def.name}</span>
            <span class="cost">${def.cost}阳</span>
            <span class="cd-text"></span>
        `;
        el.addEventListener('click', () => selectCard(i));
        uiRefs.cardSlots.appendChild(el);
        // 预缓存卡片元素与冷却文本，避免每帧 querySelectorAll
        uiRefs.cardRefs.push({
            el,
            cdText: el.querySelector('.cd-text'),
            idx: i,
            _state: '',
            _cdShown: -1,
        });
    });
}

export function updateHUD() {
    if (uiRefs.sunValue) {
        const v = Math.floor(state.sun);
        if (v !== _last.sun) { _last.sun = v; uiRefs.sunValue.textContent = v; }
    }
    if (uiRefs.waveValue) {
        if (state.wave !== _last.wave) { _last.wave = state.wave; uiRefs.waveValue.textContent = state.wave; }
    }
    if (uiRefs.waveMax) {
        if (state.maxWave !== _last.waveMax) { _last.waveMax = state.maxWave; uiRefs.waveMax.textContent = state.maxWave; }
    }
    if (uiRefs.waveDisplay) {
        const disp = state._trActive ? 'none' : '';
        if (disp !== _last.waveDisp) { _last.waveDisp = disp; uiRefs.waveDisplay.style.display = disp; }
    }
    if (uiRefs.hpValue) {
        const v = Math.round(dave.hp);
        if (v !== _last.hp) { _last.hp = v; uiRefs.hpValue.textContent = v; }
    }
    if (uiRefs.hpFill) {
        const w = Math.max(0, dave.hp / (dave.maxHp || 200)) * 100 + '%';
        if (w !== _last.hpW) { _last.hpW = w; uiRefs.hpFill.style.width = w; }
    }
    // 体力常驻显示（力竭变红）
    if (uiRefs.stFill) {
        const w = Math.max(0, (dave.stamina || 0) / (dave.maxStamina || 100)) * 100 + '%';
        if (w !== _last.stW) { _last.stW = w; uiRefs.stFill.style.width = w; }
        const bg = dave.exhausted ? '#AA2222' : '#CCDD44';
        if (bg !== _last.stBg) { _last.stBg = bg; uiRefs.stFill.style.background = bg; }
    }
    if (uiRefs.stValue) {
        const txt = dave.exhausted ? '力竭' : String(Math.round(dave.stamina || 0));
        if (txt !== _last.stTxt) { _last.stTxt = txt; uiRefs.stValue.textContent = txt; }
        const col = dave.exhausted ? '#FF6666' : '';
        if (col !== _last.stCol) { _last.stCol = col; uiRefs.stValue.style.color = col; }
    }
    // 局内货币（本局拾取）
    const rr = state.roundRewards;
    if (rr) {
        if (uiRefs.coinSilver) {
            const v = rr.silver || 0;
            if (v !== _last.cs) { _last.cs = v; uiRefs.coinSilver.textContent = v; }
        }
        if (uiRefs.coinGold) {
            const v = rr.gold || 0;
            if (v !== _last.cg) { _last.cg = v; uiRefs.coinGold.textContent = v; }
        }
        if (uiRefs.coinGem) {
            const v = rr.gem || 0;
            if (v !== _last.cm) { _last.cm = v; uiRefs.coinGem.textContent = v; }
        }
    }
    updateWeaponDisplay();
    updateCardSlots();
}

function updateCardSlots() {
    const refs = uiRefs.cardRefs;
    if (!refs) return;
    for (const card of refs) {
        const key = CARD_ORDER[card.idx];
        if (!key) continue;
        const def = PLANTS[key];
        if (!def) continue;
        const cd = state.cooldowns[key] || 0;
        const canAfford = state.sun >= def.cost && cd <= 0;
        const sel = state.selectedCard === card.idx;
        // 状态字符串（选中/禁选/冷却）没变就不碰 classList
        const st = (sel ? 'a' : '') + (!canAfford && cd <= 0 ? 'd' : '') + (cd > 0 ? 'c' : '');
        if (st !== card._state) {
            card._state = st;
            card.el.classList.toggle('active', sel);
            card.el.classList.toggle('disabled', !canAfford && cd <= 0);
            card.el.classList.toggle('cooling', cd > 0);
        }
        if (cd > 0 && card.cdText) {
            const secs = Math.ceil(cd);
            if (secs !== card._cdShown) {
                card._cdShown = secs;
                card.cdText.textContent = secs + 's';
            }
        }
    }
}

function updateWeaponDisplay() {
    if (!uiRefs.weaponName) return;
    const wKey = dave.currentWeapon;
    if (!wKey) {
        if (_last.wname !== '空手') { _last.wname = '空手'; uiRefs.weaponName.textContent = '空手'; }
        if (_last.wdur !== '') { _last.wdur = ''; uiRefs.weaponDur.textContent = ''; }
        return;
    }
    const w = WEAPONS[wKey];
    if (!w) return;
    if (_last.wname !== w.name) { _last.wname = w.name; uiRefs.weaponName.textContent = w.name; }
    // 远程：弹匣/备弹 + 射击模式；换弹中提示；近战与铲子不显示
    let durText = '';
    if (w.kind === 'ranged' && dave.magAmmo != null) {
        durText = dave.reloading
            ? ' 换弹中...'
            : ` ${dave.magAmmo}/${state._trInfAmmo ? '∞' : (state.reserveAmmo?.[w.ammoType] || 0)}${w.modes?.length > 1 ? (dave.fireMode === 'auto' ? ' 全自动' : ' 半自动') : ''}`;
    }
    if (_last.wdur !== durText) { _last.wdur = durText; uiRefs.weaponDur.textContent = durText; }
}

export function selectCard(idx) {
    if (idx < 0 || idx >= CARD_ORDER.length) return;
    const key = CARD_ORDER[idx];
    if (state._allowedCards && state._allowedCards.length > 0 && !state._allowedCards.includes(key)) return;
    state.selectedCard = state.selectedCard === idx ? -1 : idx;
}

let logTimer = 0;
export function log(msg, duration = 3) {
    if (uiRefs.logText) uiRefs.logText.textContent = msg;
    logTimer = duration;
}

export function updateLogTimer(dt, onExpire) {
    if (logTimer > 0) {
        logTimer -= dt;
        if (logTimer <= 0) { onExpire?.(); }
    }
}
