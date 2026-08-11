// ============================================================
// 【无尽植僵荒原】模组 · 角色捏脸（像素风格）
// 新世界进入前选择肤色/发色/上衣/裤子/鞋子/瞳色六组色板，
// 每组另可自定义任意颜色；预览即游戏内像素小人。
// 外观存 sv.character（随存档持久化），渲染层用参考图 sprite（_mcSprites）；
// 确认后的外观会记忆为"上次外观"，新世界默认继承（随时可改）。
// ============================================================

import AudioSystem from '../systems/audio.js';
import { tintSprite } from './render.js';
import { getStorage, setStorage } from '../persistence/storage.js';

const LAST_LOOK_KEY = 'wasteland_last_look';
const HEX_RE = /^#[0-9a-f]{6}$/i;

export const LOOK_DEFAULTS = {
    skin: '#c49470', hair: '#34302d', shirt: '#39d98a',
    pants: '#314c58', shoes: '#20282b', eyes: '#232323',
    hairStyle: 0, // 0 短发 / 1 齐刘海长发 / 2 双马尾
};

// 发型选项：暂时只有短发(2026-08-08 用户要求,等 sprite 多发型变体再做)
export const HAIR_STYLES = [
    { id: 0, label: '短发' },
];

export const LOOK_PALETTES = {
    skin:  { label: '肤色', colors: ['#c49470', '#e8b98a', '#8d5a3a', '#f0d0b0', '#5e3d28', '#ffd8b0', '#7a4a2a', '#d9a066'] },
    hair:  { label: '发色', colors: ['#34302d', '#1f1f1f', '#5a4632', '#7a4a2a', '#c8b090', '#d94f4f', '#8a4ad9', '#4a90d9', '#2a8a6a', '#d9d9d9', '#ffd700', '#e8885a'] },
    shirt: { label: '上衣', colors: ['#39d98a', '#4a90d9', '#d94f4f', '#c8a24a', '#8a4ad9', '#3a3a3a', '#e8e8e8', '#e8885a', '#4ad9d9', '#d94fd9', '#9acd32', '#ff8a5a'] },
    pants: { label: '裤子', colors: ['#314c58', '#2a3a3a', '#4a3a28', '#5a5a5a', '#2a2a4a', '#3a5a3a', '#5a2a2a', '#4a4a8a'] },
    shoes: { label: '鞋子', colors: ['#20282b', '#3a2a1a', '#5a5a5a', '#7a2a2a', '#2a4a7a', '#c8b090', '#2a5a3a', '#8a5a2a'] },
    eyes:  { label: '瞳色', colors: ['#232323', '#3a5a8a', '#4a7a3a', '#7a4a2a', '#8a4ad9', '#3a8a8a', '#8a3a3a', '#c8a24a'] },
};

// HSV → '#rrggbb'
function hsvToHex(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}
// 色域约束：肤色/瞳色/鞋色取贴近现实的窄域，发色/上衣/裤子全色域，保证"多姿多彩"
const RAND_RANGES = {
    skin:  { h: [0.04, 0.12], s: [0.28, 0.62], v: [0.55, 0.95] },
    hair:  { h: [0.0, 1.0],    s: [0.15, 0.85], v: [0.18, 0.8] },
    shirt: { h: [0.0, 1.0],    s: [0.5, 0.95],  v: [0.4, 0.95] },
    pants: { h: [0.0, 1.0],    s: [0.35, 0.8],  v: [0.3, 0.75] },
    shoes: { h: [0.0, 1.0],    s: [0.1, 0.7],   v: [0.2, 0.55] },
    eyes:  { h: [0.0, 1.0],    s: [0.3, 0.9],   v: [0.2, 0.6] },
};
function randColor(key) {
    const r = RAND_RANGES[key] || RAND_RANGES.shirt;
    const h = r.h[0] + Math.random() * (r.h[1] - r.h[0]);
    const s = r.s[0] + Math.random() * (r.s[1] - r.s[0]);
    const v = r.v[0] + Math.random() * (r.v[1] - r.v[0]);
    return hsvToHex(h, s, v);
}
// 随机外观：每个部位在全色域内随机生成，因此每次都不一样（不再局限于几套固定色板）
export function randomLook() {
    const out = {};
    for (const key of Object.keys(LOOK_PALETTES)) out[key] = randColor(key);
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
let lastPreviewLook = null; // sprite 异步加载完成后重绘静态预览用的最近外观

// 预览画布：循环播放**选中方向**的行走动画（默认朝南，可点方向按钮切换）
// 2026-08-09 用户要求：可选择预览观看播放的动画，而不是自动四方向循环播放
let previewDir = 'front';  // 当前预览方向：front(朝南) / sideEast(朝东) / back(朝北) / sideWest(朝西)
function drawPreview(look) {
    lastPreviewLook = look || lastPreviewLook || {};
    const canvas = lookEl && lookEl.querySelector('.wsl-look-preview');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    cancelAnimationFrame(lookAnimRaf);
    ctx.imageSmoothingEnabled = false;
    // 至少需要一帧可渲染才开始动画
    const firstFrame = _thumbSprites.front[0] || _thumbSprites.side[0] || _thumbSprites.back[0];
    if (!firstFrame) return;
    const FRAME_MS = 160;  // ~6fps 走步节奏
    const start = performance.now();
    const tick = (t) => {
        if (!lookEl) return;  // 界面已关闭
        // 每 FRAME_MS 推进一帧；只循环选中方向的 4 帧
        const n = Math.floor((t - start) / FRAME_MS);
        const frame = n % 4;
        // 解析当前方向 → (sprites数组, 是否镜像)
        let dir, mirrored = false;
        if (previewDir === 'front') dir = 'front';
        else if (previewDir === 'back') dir = 'back';
        else if (previewDir === 'sideEast') { dir = 'side'; mirrored = true; }  // 朝东 = side 镜像
        else { dir = 'side'; mirrored = false; }  // 朝西 = side 原图
        const sprites = _thumbSprites[dir];
        const raw = sprites[frame] || sprites[0] || _thumbSprites.front[0];
        if (raw) {
            const sp = tintSprite(raw, look); // 按当前捏脸选色调色
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const scale = canvas.height / sp.height;
            const dw = sp.width * scale;
            const dx = (canvas.width - dw) / 2;
            ctx.save();
            // 朝东：side 帧本身是朝西视角，水平镜像显示朝东（与局内 dir==='right' 一致）
            if (mirrored) {
                ctx.translate(canvas.width / 2, 0);
                ctx.scale(-1, 1);
                ctx.translate(-canvas.width / 2, 0);
            }
            ctx.drawImage(sp, dx, 0, dw, canvas.height);
            ctx.restore();
        }
        lookAnimRaf = requestAnimationFrame(tick);
    };
    lookAnimRaf = requestAnimationFrame(tick);
}

// ====== 主预览 sprite：front/side/back 各方向 walk 帧（4 帧循环）======
const _thumbSprites = { front: [null, null, null, null], side: [null, null, null, null], back: [null, null, null, null] };
function loadThumbSprites() {
    if (_thumbSprites._loaded) return;
    _thumbSprites._loaded = true;
    // 用 new URL 解析为当前页面 origin + 相对路径,避免子目录页面下相对路径失效
    const base = new URL('source-code/mod-wasteland/sprites/', window.location.href).href;
    const WALK_FILES = {
        front: ['walk-front-f2.png', 'walk-front-f3.png', 'walk-front-f2.png', 'walk-front-f3.png'],
        side: ['walk-side-f0.png', 'walk-side-f1.png', 'walk-side-f2.png', 'walk-side-f3.png'],
        back: ['walk-back-f0.png', 'walk-back-f1.png', 'walk-back-f2.png', 'walk-back-f3.png'],
    };
    let pending = 0;
    for (const dir of Object.keys(WALK_FILES)) {
        const files = WALK_FILES[dir];
        for (let i = 0; i < files.length; i++) {
            const url = base + files[i];
            pending++;
            const img = new Image();
            const idx = i;
            img.onload = () => {
                _thumbSprites[dir][idx] = img;
                pending--;
                if (pending === 0 && lastPreviewLook) drawPreview(lastPreviewLook);
            };
            img.onerror = (e) => {
                pending--;
                if (typeof console !== 'undefined') console.warn('[wlook] walk sprite 加载失败,URL=', url, e);
            };
            img.src = url;
        }
    }
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
            <button class="wsl-look-btn wsl-look-close" id="wsl-look-close" style="position:absolute;top:10px;right:12px;background:none;border:none;color:#8a9aa2;font-size:20px;cursor:pointer;line-height:1;padding:2px;min-width:0;width:auto;" title="取消 (ESC)">✕</button>
            <div class="wsl-look-sub">像素幸存者 · 外观只影响形象，不影响属性 · 彩虹块可自定义任意颜色</div>
            <div class="wsl-look-body">
<div class="wsl-look-stage">
                <canvas class="wsl-look-preview" width="48" height="96"></canvas>
                <div class="wsl-look-dirs">
                    <button class="wsl-look-dir" data-dir="front" title="朝南行走">南</button>
                    <button class="wsl-look-dir" data-dir="sideEast" title="朝东行走">东</button>
                    <button class="wsl-look-dir" data-dir="back" title="朝北行走">北</button>
                    <button class="wsl-look-dir" data-dir="sideWest" title="朝西行走">西</button>
                </div>
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
                <button class="wsl-look-btn wsl-look-ok" id="wsl-look-ok">确定捏脸形象 ▶</button>
            </div>
            <div class="wsl-look-keys">Enter 确认 · ESC 取消返回</div>
        </div>`;
    document.body.appendChild(lookEl);
    syncRows(look);
    drawPreview(look);
    loadThumbSprites(); // 打开捏脸立即加载 sprite(首次打开即显示预览)

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

    // 方向选择按钮：切换预览方向并重绘动画
    lookEl.querySelectorAll('.wsl-look-dir').forEach(btn => {
        btn.addEventListener('click', () => {
            previewDir = btn.dataset.dir;
            lookEl.querySelectorAll('.wsl-look-dir').forEach(b => b.classList.toggle('on', b === btn));
            drawPreview(look);
            clickSound();
        });
    });
    // 默认选中朝南
    const defDir = lookEl.querySelector('.wsl-look-dir[data-dir="' + previewDir + '"]');
    if (defDir) defDir.classList.add('on');

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
    // 2026-08-11 v2.99 用户要求：所有弹窗都有叉号关闭按钮（右上角取消）
    const lcBtn = lookEl.querySelector('#wsl-look-close');
    if (lcBtn) lcBtn.addEventListener('click', () => { clickSound(); closeLookCreator(); });
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
