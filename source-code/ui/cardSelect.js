// ============================================================
// 选卡界面
// ============================================================

import { PLANTS } from '../core/constants.js';
import { saveData } from '../core/state.js';
import { writeSave } from '../persistence/storage.js';
import { showScreen } from './screens.js';
import AudioSystem from '../systems/audio.js';

let currentLevel = null;
let onConfirmFn = null;
let selectedCards = [];

export function openCardSelect(level, onConfirm) {
    currentLevel = level;
    onConfirmFn = onConfirm;
    selectedCards = [];
    const maxSlots = saveData.maxSlots || 6;

    if (saveData.decks && saveData.decks[level.id]) {
        selectedCards = saveData.decks[level.id].filter(k =>
            saveData.unlockedPlants.includes(k) && level.allowedCards.includes(k)
        ).slice(0, maxSlots);
    }
    if (selectedCards.length === 0) {
        selectedCards = level.allowedCards
            .filter(k => saveData.unlockedPlants.includes(k))
            .slice(0, maxSlots);
    }

    const ov = document.getElementById('loading-overlay');
    ov.style.display = 'flex';
    ov.style.opacity = '1';
    AudioSystem.stopBGM();
    const titleEl = document.getElementById('load-title');
    const barEl = document.getElementById('load-bar');
    titleEl.textContent = '加载中...';
    titleEl.style.opacity = '1';
    titleEl.style.color = '#111';
    document.getElementById('load-press').style.display = 'none';
    barEl.style.width = '0%';

    let p = 0;
    const fill = () => {
        p += 1.5 + Math.random() * 2;
        if (p > 100) p = 100;
        barEl.style.width = p + '%';
        const g = Math.floor(p * 2.0);
        titleEl.style.color = `rgb(${Math.min(g,180)},${Math.floor(Math.min(g*0.85,160))},${Math.floor(Math.min(g*0.3,50))})`;
        if (p < 100) setTimeout(fill, 50 + Math.random() * 30);
        else {
            setTimeout(() => {
                render();
                showScreen('cardSelect');
                AudioSystem.startBGM('bgmPicker');
                ov.style.display = 'none';
                document.getElementById('load-press').style.display = '';
            }, 300);
        }
    };
    fill();
}

function render() {
    const title = document.getElementById('cs-title');
    if (title) title.textContent = `选择植物 · ${currentLevel.id}  ${currentLevel.name}`;

    const hint = document.getElementById('cs-hint');
    const maxSlots = saveData.maxSlots || 6;
    if (hint) hint.textContent = `卡槽: ${selectedCards.length} / ${maxSlots}`;

    const deck = document.getElementById('cs-deck');
    if (deck) {
        deck.innerHTML = '';
        for (let i = 0; i < maxSlots; i++) {
            const key = selectedCards[i];
            const def = key ? PLANTS[key] : null;
            const el = document.createElement('div');
            el.className = `cs-slot ${key ? 'filled' : ''}`;
            if (key) {
                el.innerHTML = `
                    <span class="cs-cost">${def.cost}阳</span>
                    <span class="cs-name">${def.name}</span>
                `;
                el.addEventListener('click', () => {
                    selectedCards.splice(i, 1);
                    AudioSystem.playClick();
                    render();
                });
            } else {
                el.innerHTML = `<span style="color:#444;font-size:18px;">+</span>`;
            }
            deck.appendChild(el);
        }
    }

    const pool = document.getElementById('cs-pool');
    if (pool) {
        pool.innerHTML = '';
        const allowed = currentLevel.allowedCards.filter(k => saveData.unlockedPlants.includes(k));
        allowed.forEach(key => {
            const def = PLANTS[key];
            if (!def) return;
            const used = selectedCards.includes(key);
            const el = document.createElement('div');
            el.className = `cs-pool-card ${used ? 'used' : ''}`;
            el.innerHTML = `<span class="cs-cost">${def.cost}阳</span><span class="cs-name">${def.name}</span>`;
            if (!used && selectedCards.length < maxSlots) {
                el.addEventListener('click', () => {
                    selectedCards.push(key);
                    AudioSystem.playClick();
                    render();
                });
            }
            pool.appendChild(el);
        });
    }
}

export function initCardSelect() {
    const btn = document.getElementById('btn-cs-confirm');
    if (btn) btn.addEventListener('click', () => {
        if (selectedCards.length === 0) return;
        AudioSystem.playClick();
        if (!saveData.decks) saveData.decks = {};
        saveData.decks[currentLevel.id] = [...selectedCards];
        writeSave(saveData);
        const ov2 = document.getElementById('loading-overlay');
        ov2.style.display = 'flex';
        ov2.style.opacity = '1';
        AudioSystem.stopBGM();
        const t2 = document.getElementById('load-title');
        const b2 = document.getElementById('load-bar');
        t2.textContent = '加载中...';
        t2.style.opacity = '1';
        t2.style.color = '#111';
        document.getElementById('load-press').style.display = 'none';
        b2.style.width = '0%';
        let q = 0;
        const fill2 = () => {
            q += 2 + Math.random() * 3;
            if (q > 100) q = 100;
            b2.style.width = q + '%';
            const g = Math.floor(q * 2.55);
            t2.style.color = `rgb(${g},${Math.floor(g*0.85)},0)`;
            if (q < 100) setTimeout(fill2, 40 + Math.random() * 25);
            else {
                setTimeout(() => {
                    ov2.style.display = 'none';
                    document.getElementById('load-press').style.display = '';
                    if (onConfirmFn) onConfirmFn(currentLevel, selectedCards);
                }, 250);
            }
        };
        fill2();
    });

    const back = document.getElementById('btn-back-select');
    if (back) back.addEventListener('click', () => {
        showScreen('level');
    });
}

export { openCardSelect as open };
export default { open: openCardSelect, init: initCardSelect };
