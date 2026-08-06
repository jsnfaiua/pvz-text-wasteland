// ============================================================
// 设置面板 - 难度调整
// ============================================================

import { DIFFICULTY_PRESETS, DIFFICULTY, setDifficulty, CARD_ORDER, LEVELS, WEAPON_ORDER } from '../core/constants.js';
import { saveData } from '../core/state.js';
import { META, refreshMeta, saveFragments, saveCurrency, saveWeapons, saveWeaponFrags,
    writeSave } from '../persistence/storage.js';
import { setBGMVolume, setSFXVolume, setInitialVolumes } from '../systems/audio.js';

export function initSettings() {
    const closeBtn = document.getElementById('settings-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('hidden');
        });
    }

    const resetBtn = document.getElementById('settings-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            setDifficulty('normal');
            updateSlidersFromDifficulty();
            document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
            document.querySelector('.preset[data-preset="normal"]').classList.add('active');
        });
    }

    document.querySelectorAll('.preset').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setDifficulty(btn.dataset.preset);
            updateSlidersFromDifficulty();
        });
    });

    const sliders = [
        { id: 's-hp', field: 'hpMul', valId: 'v-hp', fmt: v => `${v}×` },
        { id: 's-speed', field: 'speedMul', valId: 'v-speed', fmt: v => `${v}×` },
        { id: 's-count', field: 'countMul', valId: 'v-count', fmt: v => `${v}×` },
        { id: 's-interval', field: 'intervalMul', valId: 'v-interval', fmt: v => `${v}×` },
        { id: 's-rest', field: 'restMul', valId: 'v-rest', fmt: v => `${v}×` },
        { id: 's-sun', field: 'initialSun', valId: 'v-sun', fmt: v => v },
    ];

    sliders.forEach(({ id, field, valId, fmt }) => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(valId);
        if (el && valEl) {
            el.addEventListener('input', () => {
                const val = parseFloat(el.value);
                valEl.textContent = fmt(val);
                DIFFICULTY[field] = val;
                document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
            });
        }
    });

    // 音量滑块（不受 devMode 限制，改动持久化到存档）
    if (!saveData.volumes) saveData.volumes = { bgm: 20, sfx: 100 };
    // 在音频上下文创建前注入存档音量，创建后也会立即生效
    setInitialVolumes(saveData.volumes.bgm / 100, saveData.volumes.sfx / 100);
    const volumeSliders = [
        { id: 's-bgm', valId: 'v-bgm', key: 'bgm', apply: setBGMVolume },
        { id: 's-sfx', valId: 'v-sfx', key: 'sfx', apply: setSFXVolume },
    ];
    volumeSliders.forEach(({ id, valId, key, apply }) => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(valId);
        if (!el || !valEl) return;
        const saved = saveData.volumes[key];
        if (typeof saved === 'number') {
            el.value = saved;
            valEl.textContent = `${saved}%`;
        }
        apply(parseFloat(el.value) / 100);
        el.addEventListener('input', () => {
            const val = parseFloat(el.value);
            valEl.textContent = `${val}%`;
            apply(val / 100);
            saveData.volumes[key] = val;
            writeSave(saveData);
        });
    });

    // 开发者码：输入后默认全开（全部解锁 + 资源拉满）
    const devInput = document.getElementById('dev-code');
    const devPanel = document.getElementById('dev-panel');

    // 解锁全部：植物、关卡、全部武器（含新武器）
    const unlockAll = () => {
        saveData.unlockedPlants = [...CARD_ORDER];
        saveData.cleared = LEVELS.map(l => l.id);
        WEAPON_ORDER.forEach(k => {
            META.weapons.unlocked[k] = true;
            META.weapons.levels[k] = 1;
            if (!META.weaponFrags[k]) META.weaponFrags[k] = 0;
        });
        saveWeapons(META.weapons);
        writeSave(saveData);
    };
    const maxCurrency = () => {
        META.currency.silver = 99999; META.currency.gold = 99999; META.currency.gem = 99999;
        saveCurrency(META.currency);
    };
    const maxFrags = () => {
        CARD_ORDER.forEach(k => META.fragments[k] = 9999);
        saveFragments(META.fragments);
        WEAPON_ORDER.forEach(k => META.weaponFrags[k] = 9999);
        saveWeaponFrags(META.weaponFrags);
    };

    if (devInput) {
        devInput.addEventListener('input', () => {
            if (devInput.value.toUpperCase() === 'KFZMS') {
                saveData.devMode = true;
                document.getElementById('dev-row').style.display = 'none';
                if (devPanel) devPanel.style.display = 'block';
                devInput.value = '';
                // 默认全开：所有未解锁内容自动解锁 + 所有资源拉满
                unlockAll();
                maxCurrency();
                maxFrags();
                refreshMeta();
                writeSave(saveData);
            }
        });
    }
    if (devPanel) {
        let devConfirm = null;
        let devTimer = null;
        const confirmMap = {
            'dev-unlock-all': { label: '确认解锁全部？', done: '已解锁全部' },
            'dev-max-currency': { label: '确认货币无限？', done: '货币已无限' },
            'dev-frags-all': { label: '确认碎片无限？', done: '碎片已无限' },
            'dev-restore': { label: '确认清空？', done: '已清空' },
        };
        const origLabels = {};
        document.querySelectorAll('.dev-btn').forEach(btn => { origLabels[btn.id] = btn.textContent; });
        // 重置所有按钮到初始状态（其他按钮的确认态一并清除）
        const resetDevButtons = () => {
            devConfirm = null;
            clearTimeout(devTimer);
            document.querySelectorAll('.dev-btn').forEach(b => {
                b.textContent = origLabels[b.id];
                b.disabled = false;
            });
        };
        devPanel._reset = resetDevButtons;
        const actions = {
            'dev-unlock-all': unlockAll,
            'dev-max-currency': maxCurrency,
            'dev-frags-all': maxFrags,
            'dev-restore': () => {
                if (!confirm('将清空所有存档数据，恢复为刚注册的状态。确定？')) return;
                const session = JSON.parse(localStorage.getItem('pvz_txt_session_v1') || 'null');
                const user = session ? session.username : '__guest__';
                const prefix = `u:${user}:`;
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith(prefix)) localStorage.removeItem(k);
                });
                location.reload();
            },
        };
        document.querySelectorAll('.dev-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.id;
                if (btn.disabled) return;
                if (devConfirm !== id) {
                    // 第一次点击：进入确认态（同时清除其他按钮的确认态，1.5s 不确认自动还原）
                    resetDevButtons();
                    devConfirm = id;
                    btn.textContent = confirmMap[id].label;
                    devTimer = setTimeout(() => resetDevButtons(), 1500);
                } else {
                    // 第二次点击：执行（执行期间禁用，防止快速连点重复执行）
                    clearTimeout(devTimer);
                    btn.disabled = true;
                    actions[id]();
                    refreshMeta();
                    btn.textContent = confirmMap[id].done;
                    devConfirm = null;
                    // 其他按钮还原，本按钮 1s 后恢复可用
                    document.querySelectorAll('.dev-btn').forEach(b => {
                        if (b.id !== id) { b.textContent = origLabels[b.id]; b.disabled = false; }
                    });
                    devTimer = setTimeout(() => resetDevButtons(), 1000);
                }
            });
        });
    }

    updateSlidersFromDifficulty();
}

function updateSlidersFromDifficulty() {
    const map = {
        's-hp': 'hpMul', 's-speed': 'speedMul', 's-count': 'countMul',
        's-interval': 'intervalMul', 's-rest': 'restMul', 's-sun': 'initialSun'
    };
    const valMap = {
        'v-hp': 'hpMul', 'v-speed': 'speedMul', 'v-count': 'countMul',
        'v-interval': 'intervalMul', 'v-rest': 'restMul', 'v-sun': 'initialSun'
    };

    Object.entries(map).forEach(([id, field]) => {
        const el = document.getElementById(id);
        if (el) el.value = DIFFICULTY[field];
    });

    Object.entries(valMap).forEach(([id, field]) => {
        const el = document.getElementById(id);
        if (el) {
            const val = DIFFICULTY[field];
            el.textContent = field === 'initialSun' ? val : `${val}×`;
        }
    });
}

export function openSettings() {
    document.getElementById('settings-modal').classList.remove('hidden');
    const devRow = document.getElementById('dev-row');
    const devPanel = document.getElementById('dev-panel');
    const locked = !saveData.devMode;
    if (saveData.devMode) {
        if (devRow) devRow.style.display = 'none';
        if (devPanel) devPanel.style.display = 'block';
    } else {
        if (devRow) devRow.style.display = 'block';
        if (devPanel) devPanel.style.display = 'none';
    }
    if (devPanel && devPanel._reset) devPanel._reset(); // 每次打开重置按钮状态
    // 每次打开重读并反映当前存档音量（防止荒原等处改动后不同步/看似被重置）
    if (saveData.volumes) {
        const b = document.getElementById('s-bgm'), bv = document.getElementById('v-bgm');
        if (b && bv) { b.value = saveData.volumes.bgm; bv.textContent = `${saveData.volumes.bgm}%`; }
        const s = document.getElementById('s-sfx'), svv = document.getElementById('v-sfx');
        if (s && svv) { s.value = saveData.volumes.sfx; svv.textContent = `${saveData.volumes.sfx}%`; }
    }
    // 难度滑块/预设按钮需devMode；音量滑块（data-always-on）不受限
    document.querySelectorAll('#settings-modal input[type=range]').forEach(el => {
        if (!el.dataset.alwaysOn) el.disabled = locked;
    });
    document.querySelectorAll('#settings-modal .preset').forEach(el => el.disabled = locked);
    updateSlidersFromDifficulty();
}

export default { init: initSettings, open: openSettings };
