// ============================================================
// 训练营
// ============================================================

import { FIELD, PLANTS, ZOMBIES, DIFFICULTY, DIFFICULTY_PRESETS,
    WEAPONS, WEAPON_ORDER, DROP_TABLE, ZOMBIE_FRAG_WEIGHTS, WEAPON_FRAG_WEIGHTS,
    LEVEL_TABLE } from '../core/constants.js';
import { state, dave, resetLevelState, resetPlayerState,
    setGameRunning, gameRunning, rafId, setRafId,
    setLastTime, lastTime, saveData } from '../core/state.js';
import { rowY } from '../core/utils.js';
import { initCanvas, render } from '../core/render.js';
import { updatePlayer, checkPlayerDamage } from '../entities/player.js';
import { updatePlants, updateBullets, updateZombies, tryUseWeapon, updateReload } from '../systems/combat.js';
import { updateSunsAndPickups } from '../systems/spawner.js';
import { META, saveFragments, saveWeaponFrags, addCurrency } from '../persistence/storage.js';
import { initHUD, updateHUD, log } from './hud.js';
import { showScreen } from './screens.js';
import AudioSystem from '../systems/audio.js';

let tab = 'plants';
let sidebarData = [];

function getUnlockedPlants() {
    return Object.keys(PLANTS);
}

function getKnownZombies() {
    return Object.keys(ZOMBIES);
}

function renderSidebar() {
    const el = document.getElementById('tr-sidebar');
    if (!el) return;
    el.innerHTML = '';

    // Tab buttons
    const tabsHtml = `
        <div class="tr-tabs">
            <button class="tr-tab ${tab === 'plants' ? 'active' : ''}" data-t="plants">植物</button>
            <button class="tr-tab ${tab === 'zombies' ? 'active' : ''}" data-t="zombies">僵尸</button>
            <button class="tr-tab ${tab === 'weapons' ? 'active' : ''}" data-t="weapons">武器</button>
            <button class="tr-tab ${tab === 'settings' ? 'active' : ''}" data-t="settings">设置</button>
        </div>
        <div class="tr-content" id="tr-content"></div>
    `;
    el.innerHTML = tabsHtml;
    el.querySelectorAll('.tr-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            tab = btn.dataset.t;
            renderSidebar();
        });
    });

    const content = document.getElementById('tr-content');
    if (tab === 'plants') {
        getUnlockedPlants().forEach(key => {
            const def = PLANTS[key];
            if (!def) return;
            const btn = document.createElement('div');
            btn.className = 'tr-item';
            btn.innerHTML = `<span>${def.name} <small style="color:#ffd700">Lv${META.levels[key] || 1}</small></span><span style="color:#FFD700;font-size:10px">${def.cost}阳</span>`;
            btn.addEventListener('click', () => {
                if (!gameRunning) return;
                const x = dave.x + 30;
                const r = dave.row;
                // 与图鉴升级同步：按存档等级应用 LEVEL_TABLE 倍率
                const lv = META.levels[key] || 1;
                const mul = (LEVEL_TABLE.find(l => l.lv === lv) || {}).mul || 1;
                state.plants.push({
                    kind: key, x, row: r, y: rowY(r), lv, mul,
                    hp: Math.round(def.hp * mul), maxHp: Math.round(def.hp * mul),
                    fireTimer: def.fireInterval ? 0.5 : 0,
                    produceTimer: def.produceInterval ? 7 : 0,
                    fuseTimer: def.fuse || 0, exploded: false, shake: 0,
                    armorHp: 0, maxArmorHp: 0, armorName: null,
                });
            });
            content.appendChild(btn);
        });
    } else if (tab === 'zombies') {
        getKnownZombies().forEach(key => {
            const def = ZOMBIES[key];
            if (!def) return;
            const btn = document.createElement('div');
            btn.className = 'tr-item';
            btn.innerHTML = `<span>${def.name}</span>`;
            btn.addEventListener('click', () => {
                if (!gameRunning) return;
                const row = dave.row;
                state.zombies.push({
                    kind: key, x: FIELD.right - 40, row,
                    y: FIELD.top + FIELD.rowHeight * (row + 0.5),
                    hp: def.hp, maxHp: def.hp,
                    armorHp: def.armorHp || 0, maxArmorHp: def.armorHp || 0,
                    armorBroken: false, speed: def.speed,
                    eating: null, hurtFlash: 0, _stunned: false, _stunTimer: 0,
                    _jumped: false, _slowed: false, _slowTimer: 0, _slowAmount: 0,
                });
            });
            content.appendChild(btn);
        });
    } else if (tab === 'weapons') {
        // 全部武器随意切换测试（训练营不限制解锁状态，按类型装入近战/远程槽）
        [...WEAPON_ORDER, 'shovel'].forEach(key => {
            const def = WEAPONS[key];
            if (!def) return;
            const btn = document.createElement('div');
            btn.className = 'tr-item';
            const kindText = def.kind === 'melee' ? '近战' : '远程';
            const equipped = dave.equippedMelee === key || dave.equippedRanged === key;
            btn.innerHTML = `<span>${def.name}${equipped ? ' ✓' : ''}</span><span style="color:#FFD700;font-size:10px">${kindText} ${def.damage}伤</span>`;
            btn.addEventListener('click', () => {
                if (!gameRunning) return;
                if (def.kind === 'melee') dave.equippedMelee = key;
                else dave.equippedRanged = key;
                dave.currentWeapon = key;
                dave.equippedWeapon = key;
                dave.equippedLevel = 1;
                dave.reloading = false;
                dave.charging = false;
                if (def.kind === 'ranged' && def.magSize) {
                    dave.magAmmo = def.magSize;
                    dave.fireMode = def.defaultMode || (def.modes ? def.modes[0] : 'semi');
                }
                renderSidebar();
            });
            content.appendChild(btn);
        });
        // 空手（卸下武器）
        const fistBtn = document.createElement('div');
        fistBtn.className = 'tr-item';
        const fistOn = !dave.equippedMelee && !dave.equippedRanged;
        fistBtn.innerHTML = `<span>拳头${fistOn ? ' ✓' : ''}</span><span style="color:#FFD700;font-size:10px">近战 15伤</span>`;
        fistBtn.addEventListener('click', () => {
            if (!gameRunning) return;
            dave.currentWeapon = null;
            dave.equippedWeapon = null;
            dave.equippedMelee = null;
            dave.equippedRanged = null;
            renderSidebar();
        });
        content.appendChild(fistBtn);
    } else if (tab === 'settings') {
        const opts = [
            { label: '植物无敌', key: '_trPlantInv' },
            { label: '戴夫无敌', key: '_trDaveInv' },
            { label: '僵尸无敌', key: '_trZombieInv' },
            { label: '无限阳光', key: '_trInfSun' },
        ];
        opts.forEach(opt => {
            const row = document.createElement('div');
            row.className = 'tr-setting-row';
            const on = !!state[opt.key];
            row.innerHTML = `<span>${opt.label}</span><span class="tr-toggle ${on ? 'on' : ''}">${on ? 'ON' : 'OFF'}</span>`;
            row.addEventListener('click', () => {
                state[opt.key] = !state[opt.key];
                renderSidebar();
            });
            content.appendChild(row);
        });
        const clearBtn = document.createElement('div');
        clearBtn.className = 'tr-item';
        clearBtn.innerHTML = '<span style="color:#FF4444">清场</span>';
        clearBtn.addEventListener('click', () => {
            state.zombies.length = 0;
            state.plants.length = 0;
            state.bullets.length = 0;
        });
        content.appendChild(clearBtn);

        const mowerBtn = document.createElement('div');
        mowerBtn.className = 'tr-item';
        mowerBtn.innerHTML = '<span style="color:#FFD700">重置推车</span>';
        mowerBtn.addEventListener('click', () => {
            for (const r of [0,1,2,3,4]) state.mowers[r] = true;
        });
        content.appendChild(mowerBtn);
    }
}

export function startTraining() {
    const level = { rows: [0,1,2,3,4], firstSun: 50, allowedCards: [], zombiePool: [], waves: 999, diffMod: {} };
    resetLevelState(level);
    resetPlayerState(dave, rowY(2));
    Object.assign(DIFFICULTY, DIFFICULTY_PRESETS.normal);

    state.sun = 50;
    state._allowedCards = [];
    state.mowers = {};
    for (const r of level.rows) state.mowers[r] = true;
    state._trPlantInv = false;
    state._trDaveInv = false;
    state._trZombieInv = false;
    state._trInfSun = true;
    state._trInfAmmo = true;   // 训练营备弹无限，换弹直接满弹
    state.reserveAmmo = {};
    state.doubleSun = false;
    state.shieldTimer = 0;
    state._trActive = true;

    dave.currentWeapon = 'shovel';
    dave.equippedWeapon = null;
    dave.equippedMelee = null;
    dave.equippedRanged = null;
    dave.magAmmo = null;
    dave.reloading = false;
    dave.charging = false;
    dave.chargeT = 0;

    const canvas = document.getElementById('game');
    initCanvas(canvas);
    initHUD();
    renderSidebar();
    document.getElementById('tr-sidebar').classList.remove('hidden');
    showScreen('game');

    setGameRunning(true);
    setLastTime(performance.now());
    setRafId(requestAnimationFrame(trainingLoop));
    AudioSystem.startBGM();
    log('训练营 · 自由测试');
}

function trainingLoop(now) {
    if (!gameRunning) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    setLastTime(now);
    AudioSystem.updateAudio(dt);
    if (state._trInfSun) state.sun = 99999;
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }

    updatePlayer(dave, dt, FIELD);

    // 换弹推进 / 弓箭蓄力计时 / 全自动连发（与单机一致）
    updateReload(dave, dt);
    if (dave.charging) {
        const wd = WEAPONS[dave.currentWeapon];
        dave.chargeT = Math.min(wd?.maxCharge || 1, (dave.chargeT || 0) + dt);
    }
    if (state.mouseDown && !dave.charging && !dave.reloading) {
        const wd = WEAPONS[dave.currentWeapon];
        if (wd && wd.kind === 'ranged' && wd.modes?.includes('auto') && dave.fireMode === 'auto') {
            const r = tryUseWeapon(dave, () => 1, true);
            // 音效时长与实际射速对齐（如冲锋枪全自动 0.1s/发）
            const iv = (wd.autoInterval && dave.fireMode === 'auto') ? wd.autoInterval : wd.fireInterval;
            if (r.ok) AudioSystem.playShoot(dave.currentWeapon, iv);
        }
    }

    updatePlants(dt, DIFFICULTY, (lv) => 1);
    updateBullets(dt);
    updateZombies(dt, DIFFICULTY, DROP_TABLE, ZOMBIE_FRAG_WEIGHTS, WEAPON_FRAG_WEIGHTS, META, saveFragments, saveWeaponFrags);
    // 阳光/拾取物：训练营里向日葵产出的阳光也要能拾取
    updateSunsAndPickups(dt, dave, FIELD, state, (t, a) => addCurrency(META.currency, t, a));
    if (checkPlayerDamage(dave, dt)) { dave.hp = dave.maxHp; }

    render(DIFFICULTY);
    updateHUD();
    setRafId(requestAnimationFrame(trainingLoop));
}

export function stopTraining() {
    setGameRunning(false);
    state._trInfAmmo = false;
    if (rafId) cancelAnimationFrame(rafId);
    AudioSystem.stopBGM();
    document.getElementById('tr-sidebar').classList.add('hidden');
    state._trActive = false;
    state._trPlantInv = false;
    state._trDaveInv = false;
    state._trZombieInv = false;
    state._trInfSun = false;
}

export function initTraining() {
    // 输入与退出按钮均复用 game-init.js 的全局绑定，避免同一次操作被处理两次。
}

export default { start: startTraining, init: initTraining, stop: stopTraining };
