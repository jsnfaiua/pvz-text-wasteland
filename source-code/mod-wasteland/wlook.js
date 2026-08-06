// ============================================================
// 【无尽植僵荒原】模组 · 角色捏脸（像素风格）
// 新世界进入前选择肤色/发色/上衣/裤子/鞋子/瞳色六组色板，
// 每组另可自定义任意颜色；预览即游戏内像素小人。
// 外观存 sv.character（随存档持久化），渲染层 playerBodyColorAt 按外观取色；
// 确认后的外观会记忆为"上次外观"，新世界默认继承（随时可改）。
// ============================================================

import { playerBodyColorAt } from './render.js';
import AudioSystem from '../systems/audio.js';
import { getStorage, setStorage } from '../persistence/storage.js';

const LAST_LOOK_KEY = 'wasteland_last_look';
const HEX_RE = /^#[0-9a-f]{6}$/i;

export const LOOK_DEFAULTS = {
    skin: '#c49470', hair: '#34302d', shirt: '#39d98a',
    pants: '#314c58', shoes: '#20282b', eyes: '#232323',
};

export const LOOK_PALETTES = {
    skin:  { label: '肤色', colors: ['#c49470', '#e8b98a', '#8d5a3a', '#f0d0b0', '#5e3d28'] },
    hair:  { label: '发色', colors: ['#34302d', '#1f1f1f', '#5a4632', '#7a4a2a', '#c8b090', '#d94f4f', '#8a4ad9'] },
    shirt: { label: '上衣', colors: ['#39d98a', '#4a90d9', '#d94f4f', '#c8a24a', '#8a4ad9', '#3a3a3a', '#e8e8e8', '#e8885a'] },
    pants: { label: '裤子', colors: ['#314c58', '#2a3a3a', '#4a3a28', '#5a5a5a', '#2a2a4a'] },
    shoes: { label: '鞋子', colors: ['#20282b', '#3a2a1a', '#5a5a5a', '#7a2a2a', '#2a4a7a', '#c8b090'] },
    eyes:  { label: '瞳色', colors: ['#232323', '#3a5a8a', '#4a7a3a', '#7a4a2a', '#8a4ad9'] },
};

export function randomLook() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const out = {};
    for (const key of Object.keys(LOOK_PALETTES)) out[key] = pick(LOOK_PALETTES[key].colors);
    return out;
}

export function mergeLook(a, b) {
    return { ...LOOK_DEFAULTS, ...(a || {}), ...(b || {}) };
}

// 规范化存档外观：缺项补默认、剔除非法值；
// 旧档只有 肤色/发色/上衣/裤子 四项时自动补齐鞋子/瞳色。
export function normalizeLook(look) {
    if (!look || typeof look !== 'object') return null;
    const out = {};
    for (const key of Object.keys(LOOK_DEFAULTS)) {
        out[key] = HEX_RE.test(look[key]) ? look[key].toLowerCase() : LOOK_DEFAULTS[key];
    }
    return out;
}

// 上次外观记忆：新开的捏脸默认继承，避免每次新世界从头配色
export function loadLastLook() { return normalizeLook(getStorage(LAST_LOOK_KEY, null)); }
function saveLastLook(look) { setStorage(LAST_LOOK_KEY, look); }

let lookEl = null;
let lookAnimRaf = 0;

// 预览画布：直接用与游戏一致的像素取色循环绘制 28×33 小人；
// 带轻微呼吸动画（站立帧 0↔1 交替上浮），捏脸所见即游戏所现。
function drawPreview(look) {
    const canvas = lookEl && lookEl.querySelector('.wsl-look-preview');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const paint = frame => {
        ctx.clearRect(0, 0, 28, 33);
        const anim = { dir: 'down', frame, moving: false };
        for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
            const c = playerBodyColorAt(px, py, look.shirt, look, anim);
            if (c) { ctx.fillStyle = c; ctx.fillRect(px, py, 1, 1); }
        }
    };
    cancelAnimationFrame(lookAnimRaf);
    let t = 0;
    const loop = () => {
        t = (t + 1) % 4;
        paint(t < 2 ? 0 : 1);
        lookAnimRaf = requestAnimationFrame(loop);
    };
    lookAnimRaf = requestAnimationFrame(loop);
}

// 一次性构建所有色板行（色块按钮 + 自定义取色入口），之后只切换选中态
function buildRowsHtml() {
    return Object.keys(LOOK_PALETTES).map(key => {
        const p = LOOK_PALETTES[key];
        const swatches = p.colors.map(c =>
            `<button class="wsl-look-swatch" data-key="${key}" data-color="${c}" style="background:${c};" title="${c}"></button>`).join('');
        return `<div class="wsl-look-row">
            <div class="wsl-look-label">${p.label}</div>
            <div class="wsl-look-swatches">
                ${swatches}
                <label class="wsl-look-swatch wsl-look-custom" data-key="${key}" title="自定义颜色">
                    <input type="color" data-key="${key}">
                </label>
            </div>
        </div>`;
    }).join('');
}

// 选中态同步：只切换 .on 与自定义色块底色，不重建行
function syncRows(look) {
    if (!lookEl) return;
    lookEl.querySelectorAll('.wsl-look-swatch').forEach(el => {
        const key = el.dataset.key;
        if (!key) return;
        if (el.classList.contains('wsl-look-custom')) {
            const inPalette = LOOK_PALETTES[key].colors.includes(look[key]);
            el.classList.toggle('on', !inPalette);
            el.style.background = inPalette ? '' : look[key];
        } else {
            el.classList.toggle('on', look[key] === el.dataset.color);
        }
    });
}

function clickSound() {
    AudioSystem && AudioSystem.playClick && AudioSystem.playClick();
}

// 打开捏脸界面：确认后回调 onConfirm(look)；
// initialLook 为初始外观（缺省继承"上次外观"，否则随机）。
export function showLookCreator(onConfirm, initialLook) {
    if (lookEl) { lookEl.remove(); lookEl = null; }
    const look = normalizeLook(initialLook) || loadLastLook() || randomLook();
    const hasLast = !!loadLastLook();
    lookEl = document.createElement('div');
    lookEl.className = 'wsl-look';
    lookEl.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(5,8,12,0.92);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
    lookEl.innerHTML = `
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 28px;width:560px;box-shadow:0 0 40px rgba(57,217,138,0.25);">
            <div style="text-align:center;color:#39d98a;font-size:22px;letter-spacing:6px;margin-bottom:4px;">◈ 角色定制 ◈</div>
            <div style="text-align:center;color:#7a8a92;font-size:12px;margin-bottom:16px;">像素幸存者 · 外观只影响形象，不影响属性 · 彩虹块可自定义任意颜色</div>
            <div style="display:flex;gap:26px;align-items:center;">
                <canvas class="wsl-look-preview" width="28" height="33"
                    style="width:196px;height:231px;image-rendering:pixelated;background:#0a0f14;border:2px solid #2a3540;border-radius:6px;flex:none;"></canvas>
                <div class="wsl-look-rows" style="flex:1;">${buildRowsHtml()}</div>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;">
                <button id="wsl-look-random" style="background:#232c34;border:1px solid #4a5a66;color:#ccd;padding:9px 22px;border-radius:6px;cursor:pointer;font-size:14px;">🎲 随机</button>
                <button id="wsl-look-last" style="background:#232c34;border:1px solid #4a5a66;color:#ccd;padding:9px 22px;border-radius:6px;cursor:pointer;font-size:14px;${hasLast ? '' : 'display:none;'}">↩ 上次</button>
                <button id="wsl-look-ok" style="background:#1d5c3f;border:1px solid #39d98a;color:#bff5d8;padding:9px 26px;border-radius:6px;cursor:pointer;font-size:15px;font-weight:bold;">确认，进入荒原 ▶</button>
            </div>
            <div style="text-align:center;color:#5a6a72;font-size:11px;margin-top:10px;">Enter 确认 · ESC 取消返回</div>
        </div>`;
    document.body.appendChild(lookEl);
    syncRows(look);
    drawPreview(look);

    const confirm = () => {
        const finalLook = { ...look };
        saveLastLook(finalLook);
        closeLookCreator();
        onConfirm && onConfirm(finalLook);
    };
    const applyColor = (key, color) => {
        look[key] = color;
        syncRows(look);
        drawPreview(look);
    };

    const rows = lookEl.querySelector('.wsl-look-rows');
    rows.addEventListener('click', e => {
        const btn = e.target.closest('.wsl-look-swatch');
        if (!btn || btn.classList.contains('wsl-look-custom')) return;
        applyColor(btn.dataset.key, btn.dataset.color);
        clickSound();
    });
    rows.addEventListener('input', e => {
        if (e.target.type !== 'color') return;
        applyColor(e.target.dataset.key, e.target.value.toLowerCase());
    });
    rows.addEventListener('change', e => {
        if (e.target.type !== 'color') return;
        clickSound();
    });

    lookEl.querySelector('#wsl-look-random').addEventListener('click', () => {
        Object.assign(look, randomLook());
        syncRows(look);
        drawPreview(look);
        clickSound();
    });
    if (hasLast) {
        lookEl.querySelector('#wsl-look-last').addEventListener('click', () => {
            Object.assign(look, loadLastLook() || randomLook());
            syncRows(look);
            drawPreview(look);
            clickSound();
        });
    }
    lookEl.querySelector('#wsl-look-ok').addEventListener('click', confirm);
    const onKey = e => {
        if (e.target && e.target.tagName === 'INPUT') return;   // 取色器自己处理回车
        if (e.key === 'Escape') closeLookCreator();
        else if (e.key === 'Enter') confirm();
    };
    lookEl._key = onKey;
    window.addEventListener('keydown', onKey);
}

function closeLookCreator() {
    if (!lookEl) return;
    cancelAnimationFrame(lookAnimRaf);
    window.removeEventListener('keydown', lookEl._key);
    lookEl.remove();
    lookEl = null;
}
