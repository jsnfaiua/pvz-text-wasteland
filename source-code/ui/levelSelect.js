// ============================================================
// 关卡选择界面
// ============================================================

import { LEVELS, DIFFICULTY_PRESETS, LEVEL_REWARDS, ZOMBIES, PLANTS,
    setDifficulty, currentDifficulty } from '../core/constants.js';
import { saveData } from '../core/state.js';
import AudioSystem from '../systems/audio.js';

let selectedLevel = null;
let onPlayFn = null;
let btnPlayBound = false;

export function renderLevelSelect(onPlay) {
    onPlayFn = onPlay;
    const grid = document.getElementById('level-grid');
    if (!grid) return;
    grid.innerHTML = '';

    LEVELS.forEach((lv, idx) => {
        const cleared = saveData.cleared.includes(lv.id);
        const prevCleared = idx === 0 || saveData.cleared.includes(LEVELS[idx - 1].id);
        const locked = !prevCleared;

        const card = document.createElement('div');
        card.className = `level-card ${cleared ? 'cleared' : ''} ${locked ? 'locked' : ''}`;
        card.innerHTML = `
            <div class="lv-code">${lv.id}</div>
            <div class="lv-name">${lv.name}</div>
        `;

        if (!locked) {
            card.addEventListener('click', () => {
                document.querySelectorAll('.level-card').forEach(c =>
                    c.classList.remove('active'));
                card.classList.add('active');
                selectedLevel = lv;
                updateLevelDetail(lv);
                AudioSystem.playClick();
            });
        }

        grid.appendChild(card);
    });

    const firstUnlocked = LEVELS.find((l, i) =>
        i === 0 || saveData.cleared.includes(LEVELS[i - 1].id));
    if (firstUnlocked) {
        const firstCard = grid.querySelector('.level-card:not(.locked)');
        if (firstCard) firstCard.click();
    }

    if (!btnPlayBound) {
        btnPlayBound = true;
        const bp = document.getElementById('btn-play');
        if (bp) bp.addEventListener('click', () => {
            if (!selectedLevel || !onPlayFn) return;
            AudioSystem.playClick();
            onPlayFn(selectedLevel);
        });
    }

    initDifficultyButtons();
}

export function startGameFlow(level, startFn) {
    import('./cardSelect.js').then(cs => {
        cs.openCardSelect(level, (lv, deck) => startFn(lv, deck));
    });
}

function updateLevelDetail(lv) {
    const zombieNames = [...new Set(lv.zombiePool)]
        .map(k => (ZOMBIES[k] || {}).name || k).join(' · ');
    const cardNames = lv.allowedCards
        .map(k => (PLANTS[k] || {}).name || k).join(' · ');

    const title = document.getElementById('detail-title');
    if (title) {
        title.innerHTML = `<span class="g">${lv.id}</span> · ${lv.name} · 波次 ${lv.waves}`;
    }

    const body = document.getElementById('detail-body');
    if (body) {
        const reward = LEVEL_REWARDS[lv.id];
        const rewardHtml = reward ? `
            通关奖励: <span class="k">${reward.label || ''} ${reward.name}</span> · ${reward.desc || ''}<br>` : '';

        body.innerHTML = `
            ${lv.desc}<br>
            初始阳光: <span class="k">${lv.firstSun}</span><br>
            ${rewardHtml}
            敌人: ${zombieNames}<br>
            可用: ${cardNames}
        `;
    }
}

let diffBound = false;

function initDifficultyButtons() {
    if (diffBound) { syncDifficultyButtons(); return; }
    diffBound = true;
    const row = document.querySelector('.difficulty-row');
    if (row) {
        row.addEventListener('click', (e) => {
            const btn = e.target.closest('.diff-btn');
            if (!btn) return;
            applyDifficulty(btn.dataset.diff);
        });
    }
    syncDifficultyButtons();
}

// 统一走 constants.setDifficulty（会同步全局 currentDifficulty 并重置换算基础）
function applyDifficulty(name) {
    if (DIFFICULTY_PRESETS[name]) {
        setDifficulty(name);
    }
    syncDifficultyButtons();
    const tip = document.getElementById('diff-tip');
    if (tip) {
        const tips = {
            easy: '简单模式：敌人弱化，奖励减半',
            normal: '普通模式：标准难度',
            hard: '困难模式：敌人强化，奖励 1.5×',
            hell: '地狱模式：敌人凶残，奖励 2.5×',
        };
        tip.textContent = tips[name] || '';
    }
}

function syncDifficultyButtons() {
    document.querySelectorAll('.diff-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.diff === currentDifficulty);
    });
}
