// ============================================================
// 【无尽植僵荒原】背景粒子特效层（开始游戏/创建世界/捏脸等弹窗统一背景）
// 从 render.js 拆出（v4.26）：全局 bg-fx 背景层 + 本地粒子 fallback。
// 纯 DOM/canvas 操作，与画布渲染零耦合（ensureBgFx 的 _infSpriteCache 由 render.js 保留）。
// ============================================================

let _bgFxEl = null, _bgFxCv = null, _bgFxRaf = 0, _bgFxParts = null;
let _bgFxPrevScreen = null;
let _bgFxFade = null;

function blobRoundRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x - w / 2 + r, y - h / 2);
    ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
    ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
    ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
    ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
    ctx.closePath();
}
// v3.66 提前预热粒子（不挂 DOM），下次 ensureBgFx 直接复用已生成的粒子数据，避免新弹窗打开瞬间未生成。
export function preloadBgFxParts() {
    if (_bgFxParts) return;
    _bgFxParts = {};
    // v3.74 用户选定方案 I「末世废土」：黄橙暮色天空 + 尘埃飞扬 + 灰烬飘落 + 余烬红光 + 废墟剪影。
    // 数据分三组：
    //   dust  ：120 个尘埃（黄橙/土色，横向飘动 + 呼吸闪烁）
    //   ash   ：30 个灰烬（深灰，缓慢下飘）
    //   ember ：10 个余烬（红点，闪烁）
    // 渐变背景/阳光带/废墟剪影在 _startBgFxAnim 中每帧绘制（废墟剪影为静态轮廓数组）。
    _bgFxParts.dust = [];
    for (let i = 0; i < 120; i++) {
        _bgFxParts.dust.push({
            x: Math.random(), y: Math.random(),
            r: 0.5 + Math.random() * 2.5,
            vx: -(Math.random() * 0.001 + 0.0005),          // 向左飘（风）
            vy: (Math.random() - 0.5) * 0.0005,
            phase: Math.random() * Math.PI * 2,
            speed: 0.3 + Math.random() * 1.5,
            color: Math.random() < 0.5 ? '#d8a86a' : '#8a7a5a',
        });
    }
    _bgFxParts.ash = [];
    for (let i = 0; i < 30; i++) {
        _bgFxParts.ash.push({
            x: Math.random(), y: Math.random(),
            r: 0.8 + Math.random() * 2,
            vy: 0.0003 + Math.random() * 0.0008,            // 缓慢下飘
            vx: (Math.random() - 0.5) * 0.0008,
        });
    }
    _bgFxParts.ember = [];
    for (let i = 0; i < 10; i++) {
        _bgFxParts.ember.push({
            x: Math.random(), y: 0.3 + Math.random() * 0.6,
            r: 1 + Math.random() * 2.5,
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 2,
        });
    }
    // 废墟剪影轮廓（底部 30% 高度，锯齿状破损天际线）
    _bgFxParts.ruins = [0.05, 0.12, 0.08, 0.18, 0.10, 0.15, 0.06, 0.13, 0.09, 0.16, 0.07, 0.11, 0.05, 0.12];
}
// v3.66 全局背景层：z-index 1095（高于创意工坊，避免创意工坊 UI 透出），fixed inset:0 全屏
// 透明容器内挂粒子 canvas（z-index 1）。所有弹窗（创建世界/创建角色/捏脸等）都附加到此容器内。
// 注意：弹窗本身必须用 position:absolute;inset:0（不是 fixed），这样它们相对 bg-fx 全屏；
// bg-fx 全屏 → 弹窗 absolute inset:0 也全屏。
// v3.76 修复"背景后透出创意工坊 UI"：bg-fx 末世废土渐变是半透明（alpha 0.90~0.97），
// 若底层 #workshop-screen 仍显示会透出工坊界面。建立背景层时记录并隐藏当前可见 .screen
//（创意工坊），destroyBgFx 时恢复（取消返回工坊）；进入游戏由 startRun 的 showScreen('game') 接管。
// v3.78 清除 bg-fx 记录的被隐藏 screen（进入游戏流程时调用）：
// 消除"开始游戏 → 创意工坊 UI 弹出来一下"的割裂——bg-fx 淡出结束时不再恢复被隐藏的创意工坊。
export function clearBgFxPrevScreen() { _bgFxPrevScreen = null; }
export function ensureBgFx() {
    if (_bgFxEl && _bgFxEl.isConnected) return _bgFxEl;
    // 隐藏底层 screen（创意工坊），记录以便恢复
    const vis = [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden'));
    if (vis && vis.id && vis.id !== 'game-screen') {
        _bgFxPrevScreen = vis.id;
        vis.classList.add('hidden');
    }
    _bgFxEl = document.createElement('div');
    _bgFxEl.id = 'wsl-bg-fx';
    _bgFxEl.style.cssText = 'position:fixed;inset:0;z-index:1095;background:transparent;pointer-events:none;';   // v3.79 背景层不拦截点击
    _bgFxCv = document.createElement('canvas');
    _bgFxCv.id = 'wsl-bg-fx-cv';
    _bgFxCv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    _bgFxEl.appendChild(_bgFxCv);
    document.body.appendChild(_bgFxEl);
    _startBgFxAnim(_bgFxCv);
    return _bgFxEl;
}
function _startBgFxAnim(cv) {
    preloadBgFxParts();   // 确保粒子数据已就绪
    if (_bgFxRaf) { cancelAnimationFrame(_bgFxRaf); _bgFxRaf = 0; }
    const ctx = cv.getContext('2d');
    const dpr = Math.max(1, (window.devicePixelRatio || 1));
    let W = 0, H = 0;
    const resize = () => {
        W = cv.clientWidth || window.innerWidth;
        H = cv.clientHeight || window.innerHeight;
        cv.width = Math.max(1, Math.round(W * dpr));
        cv.height = Math.max(1, Math.round(H * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const start = performance.now();
    const tick = (now) => {
        if (!_bgFxEl || !cv.isConnected) { _bgFxRaf = 0; return; }
        if (cv.clientWidth !== W || cv.clientHeight !== H) resize();
        const t = (now - start) / 1000;
        ctx.clearRect(0, 0, W, H);
        // v3.76 点开始游戏后的过渡：背景"慢慢散开变淡"。
        // _bgFxFade = { t0, dur } 存在时，粒子加速飞散（散开），末尾叠加渐白蒙层（变淡），
        // 到 dur 后真正销毁。蒙层放在整帧绘制之后（见 tick 末尾），才不会被天空渐变覆盖。
        if (_bgFxFade) {
            const fp = Math.min(1, (now - _bgFxFade.t0) / _bgFxFade.dur);
            const spdMul = 1 + 1.5 * fp;   // 粒子速度放大（缓慢散开，0.6s 内至多 ×2.5）
            for (const d of _bgFxParts.dust) { d.vx *= spdMul; d.vy *= spdMul; }
            for (const a of _bgFxParts.ash) { a.vy *= spdMul; a.vx *= spdMul; }
            if (fp >= 1) { destroyBgFxNow(); return; }
            _bgFxFade._fp = fp;
        }
        // v3.74 方案 I「末世废土」：黄橙暮色天空 + 尘埃飞扬 + 灰烬飘落 + 余烬红光 + 废墟剪影
        // 1) 暮色天空渐变（上亮下暗的黄橙→深褐）
        const grad = ctx.createLinearGradient(0, 0, W, H * 0.8);
        grad.addColorStop(0, 'rgba(90,50,20,0.90)');
        grad.addColorStop(0.5, 'rgba(70,40,18,0.94)');
        grad.addColorStop(1, 'rgba(40,26,14,0.97)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        // 2) 暮色阳光带（右上角径向橙光）
        ctx.globalCompositeOperation = 'lighter';
        const sun = ctx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, W * 0.35);
        sun.addColorStop(0, 'rgba(255,180,80,0.35)');
        sun.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, W, H);
        // 3) 尘埃（横向飘动 + 呼吸闪烁）
        for (const d of _bgFxParts.dust) {
            d.x += d.vx; d.y += d.vy;
            if (d.x < -0.1) d.x = 1.1;
            if (d.y < -0.1) d.y = 1.1; if (d.y > 1.1) d.y = -0.1;
            ctx.globalAlpha = 0.1 + 0.3 * Math.abs(Math.sin(t * d.speed + d.phase));
            ctx.fillStyle = d.color;
            ctx.beginPath();
            ctx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 4) 灰烬（缓慢下飘）
        for (const a of _bgFxParts.ash) {
            a.y += a.vy; a.x += a.vx;
            if (a.y > 1.1) { a.y = -0.1; a.x = Math.random(); }
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = a.color || '#3a3a3a';
            ctx.beginPath();
            ctx.arc(a.x * W, a.y * H, a.r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 5) 余烬红光（闪烁）
        for (const e of _bgFxParts.ember) {
            ctx.globalAlpha = 0.2 + 0.5 * Math.abs(Math.sin(t * e.speed + e.phase));
            ctx.fillStyle = '#ff5544';
            ctx.beginPath();
            ctx.arc(e.x * W, e.y * H, e.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        // 6) 废墟剪影（底部 30% 锯齿状天际线）
        const ruins = _bgFxParts.ruins || [];
        const mh = H * 0.30;
        ctx.fillStyle = 'rgba(20,14,10,0.9)';
        ctx.beginPath();
        ctx.moveTo(0, H);
        const seg = W / Math.max(1, (ruins.length - 1) * 2);
        for (let x = 0; x <= W; x += seg) {
            const idx = Math.floor(x / seg) % ruins.length;
            ctx.lineTo(x, H - mh * (ruins[idx] || 0.1));
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
        // 7) 地面尘土
        ctx.fillStyle = 'rgba(60,40,20,0.6)';
        ctx.fillRect(0, H - 10, W, 10);
        // v3.76 渐白蒙层（背景整体变淡）：在整帧绘制之后叠加，随 _bgFxFade 进度由透明→微白，
        // 配合睁眼动画的灰雾模糊，营造"背景散开、颜色变淡、睁眼慢慢显现"的过渡。
        if (_bgFxFade && _bgFxFade._fp != null) {
            const fp = _bgFxFade._fp;
            ctx.save();
            ctx.fillStyle = 'rgba(190,180,160,' + (0.30 * fp).toFixed(3) + ')';
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
            // 干净的一帧已画完，清掉临时进度标记
            delete _bgFxFade._fp;
        }
        _bgFxRaf = requestAnimationFrame(tick);
    };
    _bgFxRaf = requestAnimationFrame(tick);
}
// v3.66 销毁背景层（进入游戏前调用，粒子不再消耗 RAF；再次弹窗时 ensureBgFx 会重建）
// v3.76 销毁时恢复 ensureBgFx 隐藏的底层 screen（取消返回创意工坊场景）。
// 进入游戏路径：destroyBgFx 之后 startRun 的 showScreen('game') 会覆盖显示 game，无残留。
// v3.76 点开始游戏过渡：destroyBgFx(fadeDur>0) → 背景粒子散开 + 渐白变淡 fadeDur 秒后才真正销毁，
// 与进入游戏后的睁眼动画（drawWakeOverlay 灰雾模糊）衔接成"背景散开 → 睁眼显现"连贯过渡。
export function destroyBgFx(fadeDur) {
    if (_bgFxFade) { _bgFxFade.t0 = performance.now(); _bgFxFade.dur = Math.max(0.1, fadeDur || 0); return; }
    if (fadeDur > 0 && _bgFxEl && _bgFxEl.isConnected) {
        _bgFxFade = { t0: performance.now(), dur: fadeDur };
        return;
    }
    destroyBgFxNow();
}
// 真正移除背景层（渐出结束 / 无渐出直接调用）
// v3.78 守卫（全面加固）：只要满足以下任一条件，就【不】恢复被隐藏的底层 screen：
//   ① #game-screen 已显示（进入游戏流程）；
//   ② #wsl-loading 加载层存在（加载动画进行中，底层恢复无意义且会闪出创意工坊）；
// 否则（正常取消返回弹窗场景）恢复被 bg-fx 隐藏的 screen（如创意工坊）。
export function destroyBgFxNow() {
    _bgFxFade = null;
    if (_bgFxRaf) { cancelAnimationFrame(_bgFxRaf); _bgFxRaf = 0; }
    if (_bgFxEl && _bgFxEl.parentNode) _bgFxEl.parentNode.removeChild(_bgFxEl);
    _bgFxEl = null; _bgFxCv = null;
    if (_bgFxPrevScreen) {
        const gameEl = document.getElementById('game-screen');
        const inGame = gameEl && !gameEl.classList.contains('hidden');
        const loadingEl = document.getElementById('wsl-loading');
        const inLoading = loadingEl && loadingEl.isConnected;
        if (!inGame && !inLoading) {
            const back = document.getElementById(_bgFxPrevScreen);
            if (back) back.classList.remove('hidden');
        }
        _bgFxPrevScreen = null;
    }
    // 注意：保留 _bgFxParts 避免下次重建时再预热
}

// ================= v3.62 界面背景粒子（开始游戏/创建世界/捏脸等弹窗统一风格） =================
// 抽象色块缓慢飘动/融合/变形：canvas 全屏层 + RAF，挂在弹窗容器内（背景层）。
// 画布自带深色渐变背景（覆盖宿主原背景，避免"看到后面创意工坊"），内容层自动提升到粒子之上。
// 返回 cleanup；弹窗关闭时（元素脱离 DOM）自动停止并清理。
// v3.66 此函数已被 ensureBgFx 全局背景层替代（保留是为了向后兼容 + 散弹窗 fallback）：
// 当 ensureBgFx 尚未建立时（如旧的 showCreateCharacter 走单路径），仍可调此函数在弹窗内挂粒子。
export function attachParticleBg(host, opts) {
    if (typeof document === 'undefined' || !host) return () => {};
    // v3.66 优先用全局 bg-fx（连续背景），仅当 bg-fx 不存在时挂本地粒子
    if (typeof ensureBgFx === 'function') {
        try {
            const bg = ensureBgFx();
            bg.appendChild(host);
            // bg 容器已经 fixed inset:0 全屏覆盖 → host 用 absolute inset:0 全屏
            host.style.position = 'absolute';
            host.style.inset = '0';
            // v3.80 关键：bg-fx 外层是 pointer-events:none（不拦截点击），会继承给子元素 →
            // 挂载的弹窗必须显式恢复 pointer-events:auto，否则弹窗按钮全部点不了。
            host.style.pointerEvents = 'auto';
            return () => { /* 关闭时仅移除 host；bg-fx 不动 */ };
        } catch (e) { /* 走 fallback */ }
    }
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    host.insertBefore(cv, host.firstChild);
    const hostPos = getComputedStyle(host).position;
    if (hostPos === 'static' || hostPos === '') host.style.position = 'relative';
    for (const ch of host.children) {
        if (ch !== cv) { ch.style.position = 'relative'; ch.style.zIndex = '2'; }
    }
    const ctx = cv.getContext('2d');
    const dpr = Math.max(1, (window.devicePixelRatio || 1));
    let W = 0, H = 0, raf = 0;
    const resize = () => {
        W = host.clientWidth || window.innerWidth;
        H = host.clientHeight || window.innerHeight;
        cv.width = Math.max(1, Math.round(W * dpr));
        cv.height = Math.max(1, Math.round(H * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    // 色板：荒原主题（v3.73 + 6 色辅助色让色彩更丰富）
    // v3.74 方案 I「末世废土」fallback：与 bg-fx 视觉一致（dust/ash/ember + 废墟剪影）
    const parts = { dust: [], ash: [], ember: [] };
    for (let i = 0; i < 120; i++) {
        parts.dust.push({
            x: Math.random(), y: Math.random(),
            r: 0.5 + Math.random() * 2.5,
            vx: -(Math.random() * 0.001 + 0.0005),
            vy: (Math.random() - 0.5) * 0.0005,
            phase: Math.random() * Math.PI * 2,
            speed: 0.3 + Math.random() * 1.5,
            color: Math.random() < 0.5 ? '#d8a86a' : '#8a7a5a',
        });
    }
    for (let i = 0; i < 30; i++) {
        parts.ash.push({
            x: Math.random(), y: Math.random(),
            r: 0.8 + Math.random() * 2,
            vy: 0.0003 + Math.random() * 0.0008,
            vx: (Math.random() - 0.5) * 0.0008,
            color: '#3a3a3a',
        });
    }
    for (let i = 0; i < 10; i++) {
        parts.ember.push({
            x: Math.random(), y: 0.3 + Math.random() * 0.6,
            r: 1 + Math.random() * 2.5,
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 2,
        });
    }
    const ruins = [0.05, 0.12, 0.08, 0.18, 0.10, 0.15, 0.06, 0.13, 0.09, 0.16, 0.07, 0.11, 0.05, 0.12];
    const start = performance.now();
    let dead = false;
    const cleanup = () => {
        if (dead) return;
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        window.removeEventListener('resize', resize);
        if (cv.parentNode) cv.parentNode.removeChild(cv);
    };
    const tick = (now) => {
        if (!cv.isConnected) { cleanup(); return; }  // 弹窗已关闭，自动停止并清理
        const t = (now - start) / 1000;
        // 1) 暮色天空渐变
        const grad = ctx.createLinearGradient(0, 0, W, H * 0.8);
        grad.addColorStop(0, 'rgba(90,50,20,0.90)');
        grad.addColorStop(0.5, 'rgba(70,40,18,0.94)');
        grad.addColorStop(1, 'rgba(40,26,14,0.97)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        // 2) 暮色阳光带
        ctx.globalCompositeOperation = 'lighter';
        const sun = ctx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, W * 0.35);
        sun.addColorStop(0, 'rgba(255,180,80,0.35)');
        sun.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, W, H);
        // 3) 尘埃
        for (const d of parts.dust) {
            d.x += d.vx; d.y += d.vy;
            if (d.x < -0.1) d.x = 1.1;
            if (d.y < -0.1) d.y = 1.1; if (d.y > 1.1) d.y = -0.1;
            ctx.globalAlpha = 0.1 + 0.3 * Math.abs(Math.sin(t * d.speed + d.phase));
            ctx.fillStyle = d.color;
            ctx.beginPath();
            ctx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 4) 灰烬
        for (const a of parts.ash) {
            a.y += a.vy; a.x += a.vx;
            if (a.y > 1.1) { a.y = -0.1; a.x = Math.random(); }
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = a.color;
            ctx.beginPath();
            ctx.arc(a.x * W, a.y * H, a.r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 5) 余烬红光
        for (const e of parts.ember) {
            ctx.globalAlpha = 0.2 + 0.5 * Math.abs(Math.sin(t * e.speed + e.phase));
            ctx.fillStyle = '#ff5544';
            ctx.beginPath();
            ctx.arc(e.x * W, e.y * H, e.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        // 6) 废墟剪影
        const mh = H * 0.30;
        ctx.fillStyle = 'rgba(20,14,10,0.9)';
        ctx.beginPath();
        ctx.moveTo(0, H);
        const seg = W / Math.max(1, (ruins.length - 1) * 2);
        for (let x = 0; x <= W; x += seg) {
            const idx = Math.floor(x / seg) % ruins.length;
            ctx.lineTo(x, H - mh * (ruins[idx] || 0.1));
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
        // 7) 地面尘土
        ctx.fillStyle = 'rgba(60,40,20,0.6)';
        ctx.fillRect(0, H - 10, W, 10);
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return cleanup;
}
