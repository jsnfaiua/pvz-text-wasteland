// ============================================================
// 屏幕切换管理
// ============================================================

import { saveData } from '../core/state.js';
import AlmanacUI from './almanacUI.js';
import Shop from './shop.js';
import AudioSystem from '../systems/audio.js';

const SCREENS = {
    login: 'login-screen',
    menu: 'menu-screen',
    level: 'level-screen',
    cardSelect: 'card-select-screen',
    game: 'game-screen',
    almanac: 'almanac-screen',
    armory: 'armory-screen',
    shop: 'shop-screen',
    workshop: 'workshop-screen',
};

const BGM_MAP = { menu:1, login:1, almanac:1, shop:1, level:2, cardSelect:2, game:3 };
let lastBgmGroup = 0;

export function showScreen(name) {
    Object.entries(SCREENS).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', key !== name);
    });
    if (name === 'menu') refreshContinueBtn();

    if (name === 'menu') {
        AudioSystem.startBGM('bgmMenu');
    } else if (name === 'cardSelect') {
        AudioSystem.startBGM('bgmPicker');
    } else if (name === 'game') {
        AudioSystem.stopBGM();
    }
}

export function refreshContinueBtn() {
    const btn = document.getElementById('btn-continue');
    if (!btn) return;
    btn.disabled = !saveData.lastLevel;
    btn.textContent = saveData.lastLevel ? `继续 (${saveData.lastLevel})` : '继续';
}

export function initScreenButtons(callbacks) {
    // 主菜单
    document.getElementById('btn-new-game')?.addEventListener('click', () => {
        AudioSystem.playGameStart();
        const flash = document.getElementById('white-flash');
        let count = 0, max = 3;
        const pulse = () => {
            if (count >= max) {
                if (flash) { flash.style.transition = 'opacity 0.4s'; flash.style.opacity = '0'; }
                setTimeout(() => {
                    callbacks.onShowLevelSelect?.();
                    showScreen('level');
                }, 400);
                return;
            }
            if (flash) { flash.style.transition = 'opacity 0.15s'; flash.style.opacity = '0.5'; }
            setTimeout(() => {
                if (flash) { flash.style.transition = 'opacity 0.15s'; flash.style.opacity = '0.15'; }
                count++;
                setTimeout(pulse, 150);
            }, 150);
        };
        pulse();
    });

    document.getElementById('btn-continue')?.addEventListener('click', () => {
        callbacks.onContinue?.();
    });

    document.getElementById('btn-about')?.addEventListener('click', () => {
        showModal('about-modal');
    });

    // 返回菜单
    ['btn-back-menu', 'btn-back-menu-almanac', 'btn-back-menu-armory', 'btn-back-menu-shop', 'btn-back-menu-workshop'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => showScreen('menu'));
    });

    // 退出关卡
    document.getElementById('btn-quit-level')?.addEventListener('click', () => {
        if (confirm('确认退出当前关卡？')) {
            callbacks.onQuitLevel?.();
            showScreen('menu');
        }
    });

    // 图鉴按钮 - 打开图鉴界面
    document.getElementById('btn-almanac')?.addEventListener('click', () => {
        showScreen('almanac');
        AlmanacUI.refresh?.();
    });

    // 商店按钮
    document.getElementById('btn-shop')?.addEventListener('click', () => {
        showScreen('shop');
        Shop.refresh?.();
    });

    // 创意工坊按钮
    document.getElementById('btn-workshop')?.addEventListener('click', () => {
        showScreen('workshop');
        // v3.80 加 ?v= cache-busting：workshop.js 内 _WSL_VER 升级必须强制浏览器重取，
        // 否则缓存旧 workshop.js（_WSL_VER=3.75）→ import survival.js?v=3.75 → 旧代码生效。
        import('./workshop.js?v=4.64.4').then(m => {
            m.refresh?.();
        });
    });

    // 任务按钮
    document.getElementById('btn-mission')?.addEventListener('click', () => {
        import('./missionPanel.js').then(m => {
            m.showMissionPanel?.();
        });
    });

    // 设置按钮
    document.getElementById('btn-settings')?.addEventListener('click', () => {
        import('./settings.js').then(m => {
            m.openSettings?.();
        });
    });
    // 训练营按钮
    document.getElementById('btn-training')?.addEventListener('click', () => {
        import('./training.js').then(m => {
            m.initTraining?.();
            m.startTraining?.();
        });
    });
}

// 弹窗通用
export function showModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

export function hideModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

export function initModalButtons() {
    // 关于弹窗
    document.getElementById('about-close')?.addEventListener('click', () => {
        hideModal('about-modal');
    });
    document.getElementById('about-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'about-modal') hideModal('about-modal');
    });

    // 全局按钮点击音效（菜单、弹窗按钮）
    document.addEventListener('click', (e) => {
        const tag = e.target.tagName;
        if (tag === 'BUTTON' || (tag === 'INPUT' && e.target.type === 'button')) {
            AudioSystem.playClick();
        }
    });
}
