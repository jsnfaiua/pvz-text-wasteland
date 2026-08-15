// ============================================================
// 【无尽植僵荒原】模组 · 角色捏脸（像素风格）
// 新世界进入前选择肤色/发色/上衣/裤子/鞋子/瞳色六组色板，
// 每组另可自定义任意颜色；预览即游戏内像素小人。
// 外观存 sv.character（随存档持久化），渲染层用参考图 sprite（_mcSprites）；
// 确认后的外观会记忆为"上次外观"，新世界默认继承（随时可改）。
// ============================================================

import AudioSystem from '../systems/audio.js';
import { tintSprite, attachParticleBg, showToast } from './render.js';
import { getStorage, setStorage } from '../persistence/storage.js';

const LAST_LOOK_KEY = 'wasteland_last_look';
const HEX_RE = /^#[0-9a-f]{6}$/i;

function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// v3.76 合并命名+捏脸：随机角色名（2~3 个汉字 + 可选数字后缀），供捏脸界面名字输入框使用
const _RND_NAME = '荒岚孤舟苍漠凝霜曜岩流萤暮雪逐星烬夜苍梧青鸾玄甲赤焰凛风浮云残阳沙砾';
function randomNameText() {
    let s = '';
    const n = 2 + Math.floor(Math.random() * 2);   // 2~3 字
    for (let i = 0; i < n; i++) s += _RND_NAME[Math.floor(Math.random() * _RND_NAME.length)];
    if (Math.random() < 0.4) s += String(Math.floor(Math.random() * 90) + 10);   // 40% 概率带数字后缀
    return s;
}

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
// v3.81 导出供开始游戏弹窗提前预热（buildStartDialog 时加载 walk 帧 PNG），
// 首次打开捏脸时 sprite 已缓存 → 不卡顿、预览立即显示
export function loadThumbSprites() {
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
// v3.81 缓存构建结果：色板/发型选项是静态常量，每次打开捏脸重建大字符串（60+ 按钮）会卡顿
let _rowsHtmlCache = null;
function buildRowsHtml() {
    if (_rowsHtmlCache) return _rowsHtmlCache;
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
    _rowsHtmlCache = `<div class="wsl-look-row">
            <div class="wsl-look-label">发型</div>
            <div class="wsl-look-hairs">${hairBtns}</div>
        </div>${colorRows}`;
    return _rowsHtmlCache;
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

// ================= v3.83 捏脸 DOM 骨架模板 =================
// 根因：捏脸面板 70+ 元素（色板/发型行 + 渐变/多阴影）用 innerHTML 解析 + appendChild，
// 每次打开都产生一次明显的同步卡顿（主线程阻塞 → bg-fx 背景动画同步掉帧"顿一下"）。
// 修复：预构建一份【脱离文档】的骨架模板（detached，不触发 layout/渲染），
// showLookCreator 时直接 cloneNode(true) 挂载 —— clone 比 innerHTML 解析快一个量级，
// 点击瞬间只剩轻量操作，彻底消除卡顿。模板在 buildStartDialog 打开开始弹窗时预热。
let _lookSkeleton = null;
const LOOK_SKELETON_HTML = `
        <div class="wsl-look-panel">
            <div class="wsl-look-title">◈ 创建角色 ◈</div>
            <button class="wsl-look-btn wsl-look-close" id="wsl-look-close" title="返回 (ESC)">← 返回</button>
            <div class="wsl-look-sub">像素幸存者 · 外观只影响形象，不影响属性 · 彩虹块可自定义任意颜色</div>
            <div class="wsl-look-namerow">
                <div class="wsl-look-nameinp">
                    <span class="wsl-look-namelab">角色名</span>
                    <input id="wsl-look-name" maxlength="8" placeholder="输入名称或点 🎲" value="">
                </div>
                <button class="wsl-look-btn wsl-look-namernd" id="wsl-look-namernd" title="随机名字">🎲</button>
            </div>
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
                        <div class="wsl-look-info-row"><i style="background:#c49470;"></i><span>肤色</span></div>
                        <div class="wsl-look-info-row"><i style="background:#34302d;"></i><span>发色</span></div>
                        <div class="wsl-look-info-row"><i style="background:#39d98a;"></i><span>上衣</span></div>
                    </div>
                </div>
                <div class="wsl-look-rows">${buildRowsHtml()}</div>
            </div>
            <div class="wsl-look-actions">
                <button class="wsl-look-btn" id="wsl-look-random">🎲 随机</button>
                <button class="wsl-look-btn" id="wsl-look-last" style="display:none;">↩ 上次</button>
                <button class="wsl-look-btn wsl-look-ok" id="wsl-look-ok">创建角色 ✓</button>
            </div>
            <div class="wsl-look-keys">Enter 确认 · ESC 取消返回</div>
        </div>`;
// 预热：构建脱离文档的骨架模板（不渲染、不触发 layout；幂等）
export function preloadLookSkeleton() {
    if (_lookSkeleton) return _lookSkeleton;
    const tmp = document.createElement('div');
    tmp.className = 'wsl-look';
    tmp.style.animation = 'none';               // 去掉外层 CSS wslLookFade（与 JS 淡入叠加/移动时重置）
    tmp.style.visibility = 'hidden';            // detached + hidden：即使误挂载也不渲染
    tmp.innerHTML = LOOK_SKELETON_HTML;
    _lookSkeleton = tmp;
    return _lookSkeleton;
}

// ================= v3.86/3.87 预挂载实例复用 + 常驻事件绑定 =================
// 把"clone 骨架 + 挂载 + 粒子背景 + 首次样式计算 + 事件绑定"整体移到 buildStartDialog
// （打开开始弹窗时）完成：预构建一份 display:none 挂载在 bg-fx 的完整捏脸实例，事件只绑一次。
// 点击「创建绑定角色」时直接复用，点击路径只剩状态更新（动态字段 + syncRows + drawPreview +
// reveal，全部在 display:none 下零 reflow）→ 无任何 addEventListener/querySelector 遍历，
// 彻底消除"点击时同步阻塞 → 上弹动画掉帧 / 背景粒子顿"。
let _lookMounted = null;
export function preloadLookCreator() {
    // v3.90 单实例铁律：只要有挂载实例就复用，永不重建。
    // 之前 _avail 条件重建会制造多个 .wsl-look → reveal 用 querySelector 选错 / close 删错
    // → "二次进入界面直接消失"。永不重建后文档永远只有 0~1 个实例，复用前清理动画残留态。
    if (_lookMounted && _lookMounted.isConnected) {
        const inst = _lookMounted;
        inst.style.transition = 'none';   // 清上次关闭/显示残留动画，保证复用干净
        inst.style.opacity = '1';
        inst.style.transform = '';
        return inst;
    }
    const inst = preloadLookSkeleton().cloneNode(true);
    inst.style.visibility = 'visible';
    inst.style.display = 'none';   // 隐藏挂载：不渲染、不拦截点击
    document.body.appendChild(inst);
    attachParticleBg(inst);
    bindLookHandlers(inst);        // v3.87 常驻事件绑定（仅此一次）
    // v3.90 预热布局：display:flex → 强制首次全量 layout（此刻在打开开始弹窗时，用户在看
    // 黄沙过渡/开始弹窗，无感知）→ 再 display:none。点击 reveal 的 display:none → flex 变成
    // 二次布局（增量 ~1ms）→ 不再长帧卡顿（修"首次点击卡 + 背景粒子顿"）。
    inst.style.display = 'flex';
    void inst.offsetWidth;
    inst.style.display = 'none';
    inst._avail = true;            // 空闲待复用
    _lookMounted = inst;
    return inst;
}
// 常驻事件绑定：处理器从 lookEl._look / _nameOpts / _onConfirm 读取当前状态，
// 因此只需绑定一次，点击打开/关闭捏脸时无需清理或重绑。
function bindLookHandlers(lookEl) {
    const lookOf = () => lookEl._look || {};
    const sync = () => { syncRows(lookOf()); drawPreview(lookOf()); };
    const confirm = () => {
        const look = lookOf();
        const nameOpts = lookEl._nameOpts;
        if (nameOpts) {
            const raw = (lookEl.querySelector('#wsl-look-name').value || '').trim();
            if (!raw) {
                // v3.76 名字必填：留空弹提示（与创建世界/角色弹窗同规则）
                showToast('请输入角色名称', '#FFB347');
                const inp = lookEl.querySelector('#wsl-look-name');
                inp.style.borderColor = '#ff5544';
                inp.focus();
                return;
            }
            const finalLook = { ...look };
            saveLastLook(finalLook);
            closeLookCreator();
            setTimeout(() => { if (nameOpts.onDone) nameOpts.onDone(raw, finalLook); }, 260);   // v3.80 弹出后恢复上一界面
            return;
        }
        const finalLook = { ...look };
        saveLastLook(finalLook);
        closeLookCreator();
        setTimeout(() => { if (lookEl._onConfirm) lookEl._onConfirm(finalLook); }, 260);   // v3.80 弹出后回调
    };
    const applyColor = (key, color) => { lookOf()[key] = color; sync(); };
    const goBack = () => {
        clickSound();
        const nameOpts = lookEl._nameOpts;   // close 前捕获（closeLookCreator 会把模块 lookEl 置 null，此处捕获避免 260ms 后读 null）
        closeLookCreator();
        setTimeout(() => { if (nameOpts && nameOpts.onCancel) nameOpts.onCancel(); }, 260);
    };
    // 方向选择按钮：切换预览方向并重绘动画
    lookEl.querySelectorAll('.wsl-look-dir').forEach(btn => {
        btn.addEventListener('click', () => {
            previewDir = btn.dataset.dir;
            lookEl.querySelectorAll('.wsl-look-dir').forEach(b => b.classList.toggle('on', b === btn));
            drawPreview(lookOf());
            clickSound();
        });
    });
    const rows = lookEl.querySelector('.wsl-look-rows');
    if (rows) {
        rows.addEventListener('click', e => {
            const hair = e.target.closest('.wsl-look-hair');
            if (hair) {
                lookOf().hairStyle = Number(hair.dataset.hair);
                sync();
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
    }
    const rnd = lookEl.querySelector('#wsl-look-random');
    if (rnd) rnd.addEventListener('click', () => { Object.assign(lookOf(), randomLook()); sync(); clickSound(); });
    // v3.76 合并命名+捏脸：随机名字按钮（点击填入随机名并清红框）——常驻绑定，namerow 显示时才可点
    const nmBtn = lookEl.querySelector('#wsl-look-namernd');
    const nmInp = lookEl.querySelector('#wsl-look-name');
    if (nmBtn && nmInp) nmBtn.addEventListener('click', () => {
        nmInp.value = randomNameText();
        nmInp.style.borderColor = '';
        nmInp.focus();
        clickSound();
    });
    // Enter 在名字输入框内 → 触发确认（避免与全局 keydown 冲突用 onkeydown）
    if (nmInp) nmInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirm(); }
    });
    const lb = lookEl.querySelector('#wsl-look-last');
    if (lb) lb.addEventListener('click', () => { Object.assign(lookOf(), loadLastLook() || randomLook()); sync(); clickSound(); });
    const ok = lookEl.querySelector('#wsl-look-ok');
    if (ok) ok.addEventListener('click', confirm);
    // 2026-08-13 改为"返回"按钮（语义更明确：返回上一弹窗/创建角色界面），ESC 仍可用
    const lc = lookEl.querySelector('#wsl-look-close');
    if (lc) lc.addEventListener('click', goBack);
    const onKey = e => {
        if (e.target && e.target.tagName === 'INPUT') return;   // 取色器自己处理回车
        if (e.key === 'Escape') goBack();
        else if (e.key === 'Enter') confirm();
    };
    lookEl._key = onKey;
    window.addEventListener('keydown', onKey);
}

// 打开捏脸界面：确认后回调 onConfirm(look)；
// v3.62 每次进入自动随机配色（用户需求：每次进捏脸自动随机配色）；
// initialLook 有值（如 wdev 局内重捏脸传当前外观）则保留，否则每次随机（不再默认继承"上次"）。
// v3.76 合并命名+捏脸：可选 nameOpts={ name, onDone(name, look) }。
// 传入时面板顶部显示角色名输入框 + 🎲 随机名，确认按钮文案变「创建角色 ✓」，
// 确认时先校验名字再回调 onDone(name, look)（满足"世界创建完弹创建角色、一个界面完成命名+捏脸"）。
export function showLookCreator(onConfirm, initialLook, nameOpts, opts) {
    // v3.82 预构建模式 opts.deferReveal：构建捏脸 DOM 但先隐藏，
    // 由外部（animateDialogSwap 在旧弹窗上弹结束后）调用 lookEl._wslReveal() 触发淡入。
    const deferReveal = !!(opts && opts.deferReveal);
    // v3.90 单实例复用：永不重建 → 文档永远只有一个 .wsl-look。上次未正常关闭的残留实例
    // 由 preloadLookCreator 复用前清理（清动画态），此处不再删除任何实例。
    const look = normalizeLook(initialLook) || randomLook();
    const hasLast = !!loadLastLook();
    const withName = !!nameOpts;
    const nameVal = (nameOpts && nameOpts.name) || '';
    // v3.86 预挂载实例复用：DOM（clone/挂载/粒子背景）在 buildStartDialog 时已建好（display:none），
    // 点击路径只剩状态更新（syncRows/drawPreview 在 display:none 下零 reflow）→
    // 彻底消除"点创建绑定角色"时 clone 70+ 节点/挂载/样式计算造成的同步卡顿（背景动画顿）。
    lookEl = preloadLookCreator();
    lookEl._avail = false;
    lookEl.style.visibility = 'visible';
    lookEl.style.display = 'none';   // 隐藏挂载：不渲染、不拦截点击、零 layout（复用实例常驻）
    // v3.87 状态挂到实例上供常驻事件读取（事件已在 preloadLookCreator 时绑定一次）
    lookEl._look = look;
    lookEl._onConfirm = onConfirm;
    lookEl._nameOpts = nameOpts;
    // 动态部分：标题/确认文案/名字输入/返回上次按钮/信息色块（namerow 显隐而非移除，保证复用）
    const titleEl = lookEl.querySelector('.wsl-look-title');
    if (titleEl) titleEl.textContent = withName ? '◈ 创建角色 ◈' : '◈ 角色定制 ◈';
    const okEl = lookEl.querySelector('#wsl-look-ok');
    if (okEl) okEl.textContent = withName ? '创建角色 ✓' : '确定捏脸形象 ▶';
    const nmRow = lookEl.querySelector('.wsl-look-namerow');
    if (nmRow) nmRow.style.display = withName ? '' : 'none';
    if (withName) {
        const nmInp = lookEl.querySelector('#wsl-look-name');
        if (nmInp) nmInp.value = nameVal;
    }
    const lastBtn = lookEl.querySelector('#wsl-look-last');
    if (lastBtn) lastBtn.style.display = hasLast ? '' : 'none';
    const infoIcons = lookEl.querySelectorAll('.wsl-look-info-row i');
    if (infoIcons[0]) infoIcons[0].style.background = look.skin;
    if (infoIcons[1]) infoIcons[1].style.background = look.hair;
    if (infoIcons[2]) infoIcons[2].style.background = look.shirt;
    // 方向按钮选中态重置 + 默认朝南（复用实例时残留选中需清理）
    lookEl.querySelectorAll('.wsl-look-dir').forEach(b => b.classList.remove('on'));
    const defDir = lookEl.querySelector('.wsl-look-dir[data-dir="' + previewDir + '"]');
    if (defDir) defDir.classList.add('on');
    // v3.80 弹窗切换动画：内容面板(.wsl-look-panel)作卡片，屏幕中央缓缓淡入（opacity 0→1 + 上浮归位）
    const lookCard = lookEl.querySelector('.wsl-look-panel') || lookEl;
    lookEl.dataset.wslDialog = '1';
    lookCard.style.opacity = '0';
    lookCard.style.transition = 'opacity 0.32s ease, transform 0.32s ease';
    lookCard.style.transform = 'translateY(14px)';
    // v3.85/v3.90 淡入封装：display:none → display:flex（一次性 layout 在 opacity 0 帧）→
    // 帧1 完成 syncRows（选中态，透明帧内用户不可见）→ 帧2 启动 0.32s 淡入。
    // syncRows 从点击路径移出后，点击路径只剩轻量字段更新 + 启动 rAF（<3ms）。
    // v3.92 卡顿由加载遮罩掩盖（startBoundCharacter 的 reveal 闭包先 showWslLoading 再调本 reveal）。
    const reveal = () => {
        if (!lookEl) return;
        lookEl.style.display = 'flex';
        requestAnimationFrame(() => {
            if (!lookEl || !lookEl.isConnected) return;
            syncRows(lookEl._look || {});   // v3.87 选中态延迟一帧（透明帧完成，不阻塞点击）
            requestAnimationFrame(() => {
                if (!lookEl || !lookEl.isConnected) return;
                lookCard.style.opacity = '1';
                lookCard.style.transform = 'translateY(0)';
            });
        });
    };
    drawPreview(look);
    loadThumbSprites(); // 打开捏脸立即加载 sprite(首次打开即显示预览)
    if (deferReveal) {
        lookEl._wslReveal = reveal;
        return reveal;   // v3.90 返回闭包引用，供 animateDialogSwap 精确调用（不依赖 querySelector）
    }
    reveal();
}

function closeLookCreator() {
    if (!lookEl) return;
    cancelAnimationFrame(lookAnimRaf);
    window.removeEventListener('keydown', lookEl._key);
    // v3.80 弹窗切换动画：捏脸面板【向上弹出】（与开始游戏/创建世界一致）
    const card = lookEl.querySelector('.wsl-look-panel') || lookEl;
    card.style.transition = 'opacity 0.24s ease, transform 0.24s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateY(-26px)';
    const el = lookEl;
    lookEl = null;
    setTimeout(() => {
        // v3.86 预挂载实例复用：保留 DOM（display:none 待下次复用，不再重建 clone），否则移除
        if (el === _lookMounted) {
            el.style.display = 'none';
            el._avail = true;
        } else if (el.parentNode) el.parentNode.removeChild(el);
    }, 250);
}
