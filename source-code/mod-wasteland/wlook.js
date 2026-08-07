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
    hairStyle: 0, // 0 短发 / 1 齐刘海长发 / 2 双马尾
};

// 发型选项：渲染层 playerBodyColorAt 按 hairStyle 切换像素布局
export const HAIR_STYLES = [
    { id: 0, label: '短发' },
    { id: 1, label: '长发' },
    { id: 2, label: '双马尾' },
];

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
    out.hairStyle = Math.floor(Math.random() * HAIR_STYLES.length);
    return out;
}

export function mergeLook(a, b) {
    return { ...LOOK_DEFAULTS, ...(a || {}), ...(b || {}) };
}

// 规范化存档外观：缺项补默认、剔除非法值；
// 旧档只有 肤色/发色/上衣/裤子 四项时自动补齐鞋子/瞳色/发型。
export function normalizeLook(look) {
    if (!look || typeof look !== 'object') return null;
    const out = {};
    for (const key of Object.keys(LOOK_DEFAULTS)) {
        if (key === 'hairStyle') {
            const v = Number(look[key]);
            out[key] = (v === 1 || v === 2) ? v : 0; // 发型只认 0/1/2，非法回短发
        } else {
            out[key] = HEX_RE.test(look[key]) ? look[key].toLowerCase() : LOOK_DEFAULTS[key];
        }
    }
    return out;
}

// 上次外观记忆：新开的捏脸默认继承，避免每次新世界从头配色
export function loadLastLook() { return normalizeLook(getStorage(LAST_LOOK_KEY, null)); }
function saveLastLook(look) { setStorage(LAST_LOOK_KEY, look); }

let lookEl = null;
let lookAnimRaf = 0;
// 预览离屏缓存：每个外观只生成 2 帧位图（站立/呼吸），RAF 循环仅 drawImage，不再逐像素重绘。
const _previewCache = new Map();
function previewCacheKey(look) {
    return [look.skin, look.hair, look.shirt, look.pants, look.shoes, look.eyes, look.hairStyle].join('|');
}
function buildPreviewFrames(look) {
    return [0, 1].map(frame => {
        const cv = document.createElement('canvas');
        cv.width = 28; cv.height = 33;
        const octx = cv.getContext('2d');
        const anim = { dir: 'down', frame, moving: false };
        for (let py = 0; py < 33; py++) for (let px = 0; px < 28; px++) {
            const c = playerBodyColorAt(px, py, look.shirt, look, anim);
            if (c) { octx.fillStyle = c; octx.fillRect(px, py, 1, 1); }
        }
        return cv;
    });
}

// 预览画布：直接用与游戏一致的像素取色绘制 28×33 小人；
// 带轻微呼吸动画（站立帧 0↔1 交替上浮，约 0.3s 一拍），捏脸所见即游戏所现。
function drawPreview(look) {
    const canvas = lookEl && lookEl.querySelector('.wsl-look-preview');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const key = previewCacheKey(look);
    let frames = _previewCache.get(key);
    if (!frames) {
        frames = buildPreviewFrames(look);
        if (_previewCache.size < 60) _previewCache.set(key, frames);
    }
    cancelAnimationFrame(lookAnimRaf);
    let t = 0, acc = 0;
    const loop = () => {
        acc++;
        if (acc >= 10) { acc = 0; t = (t + 1) % 2; } // 约 0.33s 一拍呼吸
        ctx.clearRect(0, 0, 28, 33);
        ctx.drawImage(frames[t], 0, 0);
        lookAnimRaf = requestAnimationFrame(loop);
    };
    lookAnimRaf = requestAnimationFrame(loop);
}

// 一次性构建所有色板行（色块按钮 + 自定义取色入口 + 发型选择行），之后只切换选中态
function buildRowsHtml() {
    const hairBtns = HAIR_STYLES.map(h =>
        `<button class="wsl-look-hair" data-hair="${h.id}" title="${h.label}">${h.label}</button>`).join('');
    const colorRows = Object.keys(LOOK_PALETTES).map(key => {
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
    return `<div class="wsl-look-row">
            <div class="wsl-look-label">发型</div>
            <div class="wsl-look-hairs">${hairBtns}</div>
        </div>${colorRows}`;
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
    lookEl.querySelectorAll('.wsl-look-hair').forEach(el => {
        el.classList.toggle('on', Number(el.dataset.hair) === (look.hairStyle || 0));
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
    lookEl.innerHTML = `
        <div class="wsl-look-panel">
            <div class="wsl-look-title">◈ 角色定制 ◈</div>
            <div class="wsl-look-sub">像素幸存者 · 外观只影响形象，不影响属性 · 彩虹块可自定义任意颜色</div>
            <div class="wsl-look-body">
                <div class="wsl-look-stage">
                    <canvas class="wsl-look-preview" width="28" height="33"></canvas>
                    <div class="wsl-look-info">
                        <div class="wsl-look-info-row"><i style="background:${look.skin};"></i><span>肤色</span></div>
                        <div class="wsl-look-info-row"><i style="background:${look.hair};"></i><span>发色</span></div>
                        <div class="wsl-look-info-row"><i style="background:${look.shirt};"></i><span>上衣</span></div>
                    </div>
                </div>
                <div class="wsl-look-rows">${buildRowsHtml()}</div>
            </div>
            <div class="wsl-look-actions">
                <button class="wsl-look-btn" id="wsl-look-random">🎲 随机</button>
                <button class="wsl-look-btn" id="wsl-look-last" style="${hasLast ? '' : 'display:none;'}">↩ 上次</button>
                <button class="wsl-look-btn wsl-look-ok" id="wsl-look-ok">确认，进入荒原 ▶</button>
            </div>
            <div class="wsl-look-keys">Enter 确认 · ESC 取消返回</div>
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
        const hair = e.target.closest('.wsl-look-hair');
        if (hair) {
            look.hairStyle = Number(hair.dataset.hair);
            syncRows(look);
            drawPreview(look);
            clickSound();
            return;
        }
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
