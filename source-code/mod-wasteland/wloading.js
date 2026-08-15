// ========================================
// wloading.js — 末世风加载动画层（多方案）
// v3.76 用户需求：点击开始游戏后插入 4 秒加载动画，结束后才进入游戏触发"荒野醒来"睁眼动画。
// v3.78 沙漠风沙（sandstorm）细化：摇晃幅度略小；结尾（prog>0.72）人快倒下（画面向一侧倾倒）；
//       风滚草贴沙（沙丘同公式索引换算）+ 淡入淡出 + 自旋 + 雾感；去掉太阳耀斑十字横线。
//
// 视觉：暗褐末世天空渐变 + 尘埃粒子 + 废墟剪影 + 中心加载环（随 variant 变化）。
// 底部显示"正在唤醒荒野…"与进度条。
// 独立模块：自持 RAF，可单独挂到任意容器（临时预览页 / 游戏 body）。
//
// variant（opts.variant）：
//   'comet'  (默认) 彗星：旋转金色箭头 + 2/3 圈渐变拖尾（流星尾）
//   'sundial'       日晷：指针扫过 12 个刻度，刻度依次点亮（时间流逝感）
//   'gears'         齿轮：双齿轮咬合反转，机械末世感
//   'radar'         雷达：扫描线旋转 + 信号点闪烁，求生电台感
//   'sandstorm'     沙漠风沙：顶风行走 + 沙丘起伏 + 风滚草贴沙滚动 + 结尾快倒下
// ========================================

let _el = null, _cv = null, _raf = 0, _onDone = null, _dur = 4000, _t0 = 0;
let _variant = 'comet';
let _scopeEl = null;                   // v3.78 贴合目标元素（游戏画布），保证尺寸一致
let _fadeOut = 0;                      // v3.78 结束时淡出秒数（衔接游戏画面）
let _blurCv = null, _blurCtx = null;   // 雷达/沙尘暴模糊白化过渡的离屏 canvas

// 显示加载层；durMs 结束后自动移除并回调 onDone（若传 durMs<=0 则无限持续，供预览页手动关闭）
// v3.78 opts.scope（可选）：传入游戏画布元素后，画布贴合该元素的显示区域（16:9 居中），
// 背景黑底与游戏画面一致——加载动画结束切入游戏画面时尺寸/区域不跳变。
// v3.78 opts.fadeIn（秒，可选）：加载层从透明淡入（底层 bg-fx 粒子透出做过渡），
// 消除"开始界面淡出 → 加载动画瞬间出现"的割裂感。
// v3.78 opts.fadeOut（秒，可选）：时长结束后先回调 onDone（游戏画面在加载层之下渲染），
// 加载层再从当前画面（结尾为白色）淡出露出游戏画面，消除"加载→游戏"的瞬间硬切。
export function showLoadingOverlay(opts) {
    const o = opts || {};
    _dur = o.durMs || 4000;
    _onDone = o.onDone || null;
    _variant = o.variant || 'comet';
    _fadeOut = o.fadeOut || 0;
    const host = o.host || document.body;
    _scopeEl = o.scope || null;
    hideLoadingOverlay();
    // v4.3 全局动画锁：加载/过渡动画期间锁定所有 UI 点击、快捷键、局内操作（只能等待）
    window.__wslAnimBlocked = true;
    _el = document.createElement('div');
    _el.id = 'wsl-loading';
    // v4.3 pointer-events 由 none 改为 auto：加载动画期间拦截所有点击（此前穿透到底下 UI/游戏）
    _el.style.cssText = 'position:fixed;inset:0;z-index:1300;background:#000;overflow:hidden;pointer-events:auto;opacity:' + (o.fadeIn ? '0' : '1') + ';';
    _cv = document.createElement('canvas');
    _cv.style.cssText = 'position:fixed;z-index:1301;';   // 位置/尺寸由 _positionToScope 计算
    _el.appendChild(_cv);
    host.appendChild(_el);
    if (o.fadeIn) {
        // 双 rAF 确保初始 opacity:0 已应用后再过渡到 1（CSS transition 生效）
        _el.style.transition = 'opacity ' + o.fadeIn + 's ease';
        requestAnimationFrame(() => requestAnimationFrame(() => { if (_el) _el.style.opacity = '1'; }));
    }
    _t0 = performance.now();
    _start();
    return _el;
}

// 若指定了 scope（游戏画布），把加载画布贴合到该元素当前显示矩形；
// 否则铺满全屏（预览页等场景）。
function _positionToScope() {
    if (!_cv || !_el) return;
    if (_scopeEl && _scopeEl.getBoundingClientRect) {
        const r = _scopeEl.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) {
            _cv.style.left = r.left + 'px';
            _cv.style.top = r.top + 'px';
            _cv.style.width = r.width + 'px';
            _cv.style.height = r.height + 'px';
            return;
        }
    }
    _cv.style.left = '0px';
    _cv.style.top = '0px';
    _cv.style.width = '100%';
    _cv.style.height = '100%';
}

export function hideLoadingOverlay() {
    if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null; _cv = null;
    _scopeEl = null;
    _blurCv = null; _blurCtx = null;   // v3.77 释放离屏模糊画布
    window.__wslAnimBlocked = false;   // v4.3 加载动画结束，解除全局锁
}

export function isLoadingOpen() { return !!( _el && _el.isConnected ); }

function _start() {
    const ctx = _cv.getContext('2d');
    const dpr = Math.max(1, (window.devicePixelRatio || 1));
    let W = 0, H = 0;
    const resize = () => {
        _positionToScope();                       // 贴合游戏画布显示区域（若指定 scope）
        const w = _cv.clientWidth || window.innerWidth;
        const h = _cv.clientHeight || window.innerHeight;
        W = w; H = h;
        _cv.width = Math.round(w * dpr); _cv.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // 确定性粒子（末世尘埃）
    const dust = [];
    for (let i = 0; i < 60; i++) dust.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.02, vy: -(0.004 + Math.random() * 0.012),
        r: 0.5 + Math.random() * 1.6, a: 0.08 + Math.random() * 0.2,
    });
    // 雷达方案：固定信号点（确定性伪随机，避免每帧闪烁重排）
    const blips = [];
    for (let i = 0; i < 14; i++) blips.push({
        a: Math.random() * Math.PI * 2,
        r: 0.25 + Math.random() * 0.7,        // 0.25R~0.95R
        ph: Math.random() * Math.PI * 2,
        spd: 0.5 + Math.random() * 1.2,
    });

    const tick = (now) => {
        if (!_el || !_el.isConnected || !_cv) { _raf = 0; return; }
        const t = (now - _t0) / 1000;
        const prog = Math.min(1, t / (_dur / 1000));   // 0→1
        const w = W, h = H;
        ctx.clearRect(0, 0, w, h);

        // 1) 末世天空：暗褐→铅灰 垂直渐变（太阳即将落尽的暮色）
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#2a1f16');
        sky.addColorStop(0.45, '#3a2b1c');
        sky.addColorStop(0.75, '#241c15');
        sky.addColorStop(1, '#0f0c0a');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        // 2) 地平线微光（昏黄）
        const glow = ctx.createRadialGradient(w / 2, h * 0.62, 10, w / 2, h * 0.62, h * 0.5);
        glow.addColorStop(0, 'rgba(212,138,64,0.16)');
        glow.addColorStop(1, 'rgba(212,138,64,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        // 3) 尘埃粒子（缓慢飘散，末世氛围）
        ctx.fillStyle = '#cbb79a';
        for (const d of dust) {
            d.x += d.vx; d.y += d.vy;
            if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
            if (d.x > 1.02) d.x = -0.02;
            if (d.x < -0.02) d.x = 1.02;
            ctx.globalAlpha = d.a;
            ctx.beginPath();
            ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // 4) 废墟剪影（底部锯齿天际线）
        ctx.fillStyle = '#15100d';
        const base = h * 0.82;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, base);
        const segs = 26;
        for (let i = 0; i <= segs; i++) {
            const x = (i / segs) * w;
            const jitter = Math.sin(i * 1.7 + 1.3) * 0.5 + 0.5;
            const bld = 6 + Math.floor(jitter * 16);
            ctx.lineTo(x, base - bld);
        }
        ctx.lineTo(w, base);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();

        // 5) 中心加载环（按方案分发）
        const cx = w / 2, cy = h * 0.45;
        const R = Math.min(w, h) * 0.16;
        const spin = prog * Math.PI * 2;      // 箭头/指针角度：0→2π 恰好转满一周

        // 雷达/沙尘暴方案：返回"模糊白化系数" reveal（0=正常，1=全白），末尾统一模糊+白蒙层过渡
        let reveal = 0;
        switch (_variant) {
            case 'sundial': drawSundial(ctx, cx, cy, R, spin, t, prog); break;
            case 'gears':   drawGears(ctx, cx, cy, R, spin, t, prog); break;
            case 'radar':   reveal = drawRadar(ctx, cx, cy, R, spin, t, prog, blips); break;
            case 'sandstorm': reveal = drawSandstorm(ctx, cx, cy, R, spin, t, prog); break;
            default:        drawComet(ctx, cx, cy, R, spin, t, prog); break;
        }

        // v3.77 雷达结束过渡：视角逐渐模糊 + 画面变白（相机失焦白化，衔接睁眼动画）。
        // 离屏 canvas 整帧模糊重绘。关键：全程用**像素坐标**（_cv.width/_cv.height），
        // 不与 CSS 坐标(w,h)混用，避免 dpr 下画面突然缩小/错位。
        if (reveal > 0.01) {
            try {
                if (!_blurCv) {
                    _blurCv = document.createElement('canvas');
                    _blurCtx = _blurCv.getContext('2d');
                }
                const pw = _cv.width, ph = _cv.height;      // 像素尺寸（含 dpr）
                _blurCv.width = pw; _blurCv.height = ph;
                _blurCtx.setTransform(1, 0, 0, 1, 0, 0);
                _blurCtx.clearRect(0, 0, pw, ph);
                _blurCtx.drawImage(_cv, 0, 0);              // 1) 像素级拷贝当前画面
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);         // 2) 主画布切到像素坐标
                ctx.clearRect(0, 0, pw, ph);
                _blurCtx.filter = 'blur(' + (reveal * 9).toFixed(1) + 'px)';
                _blurCtx.drawImage(_blurCv, 0, 0);          // 3) 离屏上对拷贝做模糊
                _blurCtx.filter = 'none';
                ctx.drawImage(_blurCv, 0, 0, pw, ph);       // 4) 像素级画回主画布
                ctx.fillStyle = 'rgba(242,240,235,' + reveal.toFixed(3) + ')';
                ctx.fillRect(0, 0, pw, ph);                 // 5) 白蒙层（像素坐标）
                ctx.restore();
            } catch (e) { /* 低端环境无 blur 支持则跳过模糊，白蒙层仍生效 */ }
        }

        // v3.78 文字层：在模糊白蒙层【之后】绘制，不参与模糊/白化——
        // 中央"正在唤醒荒野"、底部进度条、右下角"加载中…"箭头指示器始终清晰。
        // v3.78 用户定制：UI 整体放大 50%（字号/进度条/指示器全部 ×1.5）；
        // 配色改暖橙金（沙金/昏橙），避免偏白，在渐白背景下也清晰醒目。
        // 8) 中心文字："正在唤醒荒野…"
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,178,84,0.98)';
        ctx.font = '24px "Microsoft YaHei", monospace';
        ctx.fillText('正 在 唤 醒 荒 野', cx, cy + R * 2.1);
        ctx.fillStyle = 'rgba(222,158,84,0.8)';
        ctx.font = '17px "Microsoft YaHei", monospace';
        ctx.fillText('WASTELAND · AWAKENING', cx, cy + R * 2.1 + 33);
        // 底部进度条（细线，沙金描边 + 橙金填充）
        const bw = R * 2.55, bh = 3.75;
        const bx = cx - bw / 2, by = h * 0.86;
        ctx.strokeStyle = 'rgba(255,180,96,0.55)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(255,170,74,0.95)';
        ctx.fillRect(bx, by, bw * prog, bh);
        ctx.restore();

        // 9) 右下角"加载中"指示器：彗星拖尾箭头（360° 转一圈 + 平滑渐变彗尾 + "加载中…"）
        {
            const ax = w * 0.78, ay = h * 0.78;
            const ar = Math.min(w, h) * 0.075;
            const ang = -Math.PI / 2 + prog * Math.PI * 2;   // 箭头角度（顺时针转一圈）
            const tailFrac = 0.24;                            // 彗尾弧长（固定不延长）
            // 彗尾：多层环带叠加，conicGradient 起点=末端(透明)→箭头处(最亮)→快速消失，
            // 箭头处 3 层最宽最亮、向后渐变收窄消失，形成平滑彗星拖尾。
            if (typeof ctx.createConicGradient === 'function') {
                const layers = [
                    { r0: 0.82, r1: 1.18, a: 0.8 },
                    { r0: 0.72, r1: 1.28, a: 0.45 },
                    { r0: 0.62, r1: 1.38, a: 0.24 },
                ];
                for (const L of layers) {
                    const cg = ctx.createConicGradient(ang - tailFrac * Math.PI * 2, ax, ay);
                    cg.addColorStop(0, 'rgba(224,150,70,0)');
                    cg.addColorStop(tailFrac, `rgba(255,168,70,${L.a})`);
                    cg.addColorStop(tailFrac + 0.07, 'rgba(255,168,70,0)');
                    cg.addColorStop(1, 'rgba(224,150,70,0)');
                    ctx.fillStyle = cg;
                    ctx.beginPath();
                    ctx.arc(ax, ay, ar * L.r1, 0, Math.PI * 2);
                    ctx.arc(ax, ay, ar * L.r0, 0, Math.PI * 2, true);
                    ctx.closePath();
                    ctx.fill();
                }
            } else {
                // 不支持 conic 的降级：渐变弧线（round cap 平滑）
                ctx.strokeStyle = 'rgba(255,168,70,0.55)';
                ctx.lineWidth = ar * 0.5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.arc(ax, ay, ar, ang, ang - tailFrac * Math.PI * 2, true);
                ctx.stroke();
            }
            // 轨道（细圈，弱化）
            ctx.strokeStyle = 'rgba(255,176,92,0.32)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(ax, ay, ar, 0, Math.PI * 2);
            ctx.stroke();
            // 箭头（尖朝运动方向，嵌在彗尾最亮处，与拖尾无缝衔接）
            const tpx = ax + Math.cos(ang) * ar;
            const tpy = ay + Math.sin(ang) * ar;
            ctx.save();
            ctx.translate(tpx, tpy);
            ctx.rotate(ang + Math.PI / 2);
            ctx.fillStyle = '#ffb84d';
            ctx.shadowColor = 'rgba(255,160,60,0.75)';
            ctx.shadowBlur = 12;
            const as = ar * 0.14;
            ctx.beginPath();
            ctx.moveTo(as * 2.6, 0);
            ctx.lineTo(-as * 1.2, as * 1.5);
            ctx.lineTo(-as * 0.35, 0);
            ctx.lineTo(-as * 1.2, -as * 1.5);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
            // 右侧"加载中" + 动态省略号（1→2→3 循环）
            ctx.fillStyle = 'rgba(255,178,84,0.98)';
            ctx.font = '20px "Microsoft YaHei", monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const dots = '.'.repeat(1 + Math.floor(t * 2) % 3);
            ctx.fillText('加载中' + dots, ax + ar * 1.9, ay);
        }

        if (_dur > 0 && t >= _dur / 1000) {
            const done = _onDone; _onDone = null;
            window.removeEventListener('resize', resize);
            if (_fadeOut > 0 && _el) {
                // v3.78 淡出衔接：先回调 onDone（游戏画面在加载层之下渲染，睁眼动画进行中），
                // 再让加载层淡出（结尾画面为白色），白色渐隐露出游戏画面，无瞬间硬切。
                if (done) done();
                _el.style.transition = 'opacity ' + _fadeOut + 's ease';
                _el.style.opacity = '0';
                setTimeout(() => { hideLoadingOverlay(); }, _fadeOut * 1000 + 100);
                return;   // 停止 RAF（不再绘制，纯 CSS 过渡）
            }
            hideLoadingOverlay();
            if (done) done();
            return;
        }
        _raf = requestAnimationFrame(tick);
    };
    _raf = requestAnimationFrame(tick);
}

// ---------- 方案 A：彗星（金色箭头 + 渐变拖尾） ----------
function drawComet(ctx, cx, cy, R, spin, t, prog) {
    const ringR = R * 0.16;
    // 渐变拖尾弧带（约 2/3 圈）
    const tailLen = Math.PI * 2 * 0.66;
    if (typeof ctx.createConicGradient === 'function') {
        const cg = ctx.createConicGradient(spin - 0.01, cx, cy);
        cg.addColorStop(0, 'rgba(255,222,150,0.95)');
        cg.addColorStop(0.05, 'rgba(255,214,140,0.55)');
        cg.addColorStop(0.20, 'rgba(255,194,120,0.25)');
        cg.addColorStop(tailLen / (Math.PI * 2), 'rgba(120,80,40,0)');
        cg.addColorStop(1, 'rgba(120,80,40,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2);
        ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.strokeStyle = 'rgba(255,214,140,0.55)';
        ctx.lineWidth = R * 0.36;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, R, spin, spin - tailLen, true);
        ctx.stroke();
    }
    // 金色箭头（尖朝运动方向）
    const tipX = cx + Math.cos(spin) * R, tipY = cy + Math.sin(spin) * R;
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(spin + Math.PI / 2);
    ctx.fillStyle = '#f7e6c4';
    ctx.shadowColor = 'rgba(255,214,140,0.55)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(ringR * 3.2, 0);
    ctx.lineTo(-ringR * 1.6, ringR * 1.9);
    ctx.lineTo(-ringR * 0.6, 0);
    ctx.lineTo(-ringR * 1.6, -ringR * 1.9);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
}

// ---------- 方案 B：日晷（指针扫过刻度依次点亮） ----------
function drawSundial(ctx, cx, cy, R, spin, t, prog) {
    const ticks = 12;
    const tickR = R * 0.20;               // 刻度点半径（放大版）
    // 外圈刻度环
    for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2;
        const dx = cx + Math.cos(a) * (R * 1.28), dy = cy + Math.sin(a) * (R * 1.28);
        // 指针扫过的角度范围（指针当前位置 → 已扫过部分）
        const diff = ((a - spin + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
        const lit = diff <= prog + 0.02;   // 已扫过（按整体进度）
        const pulse = 0.7 + 0.3 * Math.sin(t * 4 + i);
        ctx.beginPath();
        ctx.arc(dx, dy, tickR * (lit ? 1 : 0.75), 0, Math.PI * 2);
        if (lit) {
            const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, tickR * 2.2);
            g.addColorStop(0, `rgba(255,214,140,${(0.55 + 0.35 * pulse).toFixed(2)})`);
            g.addColorStop(1, 'rgba(255,214,140,0)');
            ctx.fillStyle = g;
            ctx.fill();
        }
        ctx.fillStyle = lit ? 'rgba(255,214,140,0.95)' : 'rgba(190,170,140,0.16)';
        ctx.beginPath();
        ctx.arc(dx, dy, tickR * (lit ? 1 : 0.7), 0, Math.PI * 2);
        ctx.fill();
    }
    // 中央指针（长针从中心伸出到外圈）
    const tipX = cx + Math.cos(spin) * (R * 1.18), tipY = cy + Math.sin(spin) * (R * 1.18);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    // 指针杆（灰金）
    ctx.strokeStyle = 'rgba(230,200,150,0.9)';
    ctx.lineWidth = Math.max(2, R * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-R * 0.18, 0);
    ctx.lineTo(R * 1.18, 0);
    ctx.stroke();
    // 指针末端箭头
    ctx.fillStyle = '#f7e6c4';
    ctx.shadowColor = 'rgba(255,214,140,0.55)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(R * 1.42, 0);
    ctx.lineTo(R * 1.02, -R * 0.10);
    ctx.lineTo(R * 1.02, R * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    // 中心轴点
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(230,200,150,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.045, 0, Math.PI * 2);
    ctx.fill();
}

// ---------- 方案 C：齿轮（双齿轮咬合反转，机械末世） ----------
function drawGears(ctx, cx, cy, R, spin, t, prog) {
    const drawGear = (gx, gy, gr, teeth, ang, color) => {
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(ang);
        // 齿
        ctx.fillStyle = color;
        const toothLen = gr * 0.22;
        const step = (Math.PI * 2) / teeth;
        for (let i = 0; i < teeth; i++) {
            ctx.beginPath();
            ctx.arc(gr + toothLen / 2, 0, toothLen * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.rotate(step);
        }
        // 主体
        ctx.beginPath();
        ctx.arc(0, 0, gr, 0, Math.PI * 2);
        ctx.fill();
        // 辐条孔
        ctx.fillStyle = '#2a2018';
        ctx.beginPath();
        ctx.arc(0, 0, gr * 0.42, 0, Math.PI * 2);
        ctx.fill();
        // 中心轴
        ctx.fillStyle = '#5a4a34';
        ctx.beginPath();
        ctx.arc(0, 0, gr * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };
    // 大齿轮（顺时针）
    const r1 = R * 0.72, t1 = 12;
    const a1 = spin;
    // 小齿轮（逆时针，咬合在右上方）
    const r2 = R * 0.40, t2 = 7;
    // 小齿轮中心 = 大齿轮外圈 + 两半径之和
    const d2 = r1 + r2;
    const g2x = cx + Math.cos(-0.9) * (d2 + r1 * 0.05);
    const g2y = cy + Math.sin(-0.9) * (d2 + r1 * 0.05);
    const a2 = -spin * (t1 / t2);           // 齿比反转
    // 锈橙大齿轮 + 昏黄小齿轮
    drawGear(cx, cy, r1, t1, a1, 'rgba(180,120,70,0.92)');
    drawGear(g2x, g2y, r2, t2, a2, 'rgba(220,170,110,0.92)');
    // 咬合点火花（随时间闪烁）
    const spk = 0.5 + 0.5 * Math.sin(t * 12);
    if (spk > 0.55) {
        const bx = cx + Math.cos(-0.9) * d2, by = cy + Math.sin(-0.9) * d2;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.28);
        g.addColorStop(0, `rgba(255,220,140,${(0.7 * (spk - 0.5) * 2).toFixed(2)})`);
        g.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, R * 0.28, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---------- 方案 D：雷达（扫描线 + 信号点，求生电台感） ----------
// v3.77 用户定制：10 秒转 2 圈（从快到慢渐变）；全程匀速放大（基础 1.2x）；
// 10 秒全程慢慢渐变成白色（reveal = prog，0→1 覆盖整个 10 秒，模糊+白蒙层同步渐进）；
// 最后 3.5 秒扫描到目标红点反复闪烁 → 睁眼进入游戏。
function drawRadar(ctx, cx, cy, R, spin, t, prog, blips) {
    // 10 秒转 2 圈，速度从快到慢渐变：θ=4π·(1-(1-prog)³)，第一圈≈2.1s 完成，第二圈逐渐放慢
    const spin2 = Math.PI * 2 * 2 * (1 - Math.pow(1 - prog, 3));
    // 最后 3.5 秒（prog >= 0.65，即 10 秒中的 6.5s~10s）扫描到目标红点（仅控制红点出现/闪烁）
    const found = prog >= 0.65;
    const f = found ? Math.min(1, (prog - 0.65) / 0.35) : 0;   // 红点阶段进度（0→1）
    // v3.77 用户定制：全程匀速放大（去掉加速）—— 基础 1.2x + 线性匀速 0.5x（10 秒内 1.2 → 1.7）
    const zoom = 1.2 + 0.5 * prog;
    // 目标红点位置（雷达图相对坐标：偏右上 0.55R 处）
    const tx = cx + Math.cos(-0.6) * R * 0.55, ty = cy + Math.sin(-0.6) * R * 0.55;

    ctx.save();
    // 整体放大（以雷达中心为锚点）；不再提前透明（模糊白化由外层统一处理）
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);

    // 外圈（暗淡）
    ctx.strokeStyle = 'rgba(120,140,125,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.33, 0, Math.PI * 2);
    ctx.stroke();
    // 十字准线
    ctx.strokeStyle = 'rgba(120,140,125,0.18)';
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    // 扫描拖尾（绿色渐变扇形，倒转）
    const sweep = 0.6;                       // 扫尾张角（弧度）
    const grad = ctx.createConicGradient ? ctx.createConicGradient(spin2 - sweep, cx, cy) : null;
    if (grad) {
        grad.addColorStop(0, 'rgba(140,220,160,0.5)');
        grad.addColorStop(sweep / (Math.PI * 2), 'rgba(140,220,160,0)');
        grad.addColorStop(1, 'rgba(140,220,160,0)');
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = 'rgba(140,220,160,0.25)';
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, spin2, spin2 - sweep, true);
    ctx.closePath();
    ctx.fill();
    // 扫描线（亮绿）
    ctx.strokeStyle = 'rgba(170,240,180,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(spin2) * R, cy + Math.sin(spin2) * R);
    ctx.stroke();
    // 背景信号点：扫描线经过时点亮，随后渐隐（发现目标后逐渐退场）
    for (const b of blips) {
        const diff = ((b.a - spin2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        const passed = diff < 0.15;           // 扫描线刚扫过（小窗口）
        const blink = 0.5 + 0.5 * Math.sin(t * b.spd * 3 + b.ph);
        const bx = cx + Math.cos(b.a) * b.r * R, by = cy + Math.sin(b.a) * b.r * R;
        if (passed) {
            const a = Math.min(1, 1.2 - diff / 0.15) * 0.9;
            ctx.fillStyle = `rgba(160,240,175,${(a * (0.5 + 0.5 * blink)).toFixed(2)})`;
        } else {
            ctx.fillStyle = `rgba(160,240,175,${(0.12 * blink).toFixed(2)})`;
        }
        ctx.beginPath();
        ctx.arc(bx, by, R * 0.035 + R * 0.02 * blink, 0, Math.PI * 2);
        ctx.fill();
    }
    // 中心点
    ctx.fillStyle = 'rgba(170,240,180,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.04, 0, Math.PI * 2);
    ctx.fill();

    // 目标红点：最后一秒出现，反复闪烁（呼吸式扩张 + 明暗交替）
    if (found) {
        const blink = 0.5 + 0.5 * Math.sin(t * 10);
        const rp = R * (0.03 + 0.025 * blink);
        // 扩散波纹（每次闪烁一圈）
        const ringP = (t * 1.4) % 1;
        ctx.strokeStyle = `rgba(255,90,70,${(0.5 * (1 - ringP)).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tx, ty, R * 0.08 + ringP * R * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        // 红点本体（带辉光）
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, rp * 3);
        g.addColorStop(0, `rgba(255,110,80,${(0.75 + 0.25 * blink).toFixed(2)})`);
        g.addColorStop(0.35, `rgba(255,70,50,${(0.6 * (0.5 + 0.5 * blink)).toFixed(2)})`);
        g.addColorStop(1, 'rgba(255,70,50,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(tx, ty, rp * 3, 0, Math.PI * 2);
        ctx.fill();
        // 目标文字（短促提示）
        if (f < 0.6) {
            ctx.fillStyle = `rgba(255,140,110,${(0.9 * (1 - f / 0.6)).toFixed(2)})`;
            ctx.font = '11px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('已锁定目标', tx, ty - R * 0.1);
        }
    }

    ctx.restore();
    // v3.77 返回模糊白化系数 reveal = prog（0→1 覆盖整个 10 秒，全程慢慢渐变成白色），
    // 由外层统一模糊+白蒙层过渡；红点阶段画面已较白但红点高亮闪烁仍可见。
    return prog;
}

// ---------- 方案 E：沙漠风沙（沙漠行走风格） ----------
// v3.77 用户定制（重制）：不做漩涡，而是"顶风行走在沙漠"的第一人称画面——
//  ① 画面左摇右摆（踉跄视角，像被风沙推得走不稳）
//  ② 沙丘地平线在下方起伏（热浪滚动的沙海）
//  ③ 沙尘带横吹（模糊的横向沙幕，自左向右被风卷过）
//  ④ 大沙石时不时横掠过画面（近景被卷起的碎石）
//  ⑤ 太阳亮光在上方不规则闪烁（灼光刺眼）
//  同样全程匀速放大 + 全程渐变白（reveal = prog）。
function drawSandstorm(ctx, cx, cy, R, spin, t, prog) {
    // 画面整体摆角：左右摇晃（低频踉跄 + 高频微颤叠加，像顶着风走不稳）。
    // v3.77 用户定制：太阳固定不动、是"人的视角在动"——摆幅随进度收敛（人逐渐站稳），
    // 最终视角对准太阳（画面不再晃，太阳在正上方中央）。
    const swayDamp = 1 - prog;                                   // 1→0，逐渐站稳
    // v3.78 用户定制：摇晃幅度略减小；步幅越走越慢（慢化时间轴，频率 1.0×→0.4×）；
    // 结尾（后 45%）人开始力竭快倒下——画面朝一侧逐渐倾倒（tilt）+ 轻微颤抖。
    const slowT = t * (1 - 0.6 * prog);                         // 步伐节奏放缓时间轴
    const swayBase = Math.sin(slowT * 1.6) * 0.10 + Math.sin(slowT * 3.9) * 0.035;
    const tiltF = Math.max(0, (prog - 0.55) / 0.45);             // 0→1（最后 45%）
    const tilt = Math.pow(tiltF, 1.4) * (0.26 + 0.05 * Math.sin(t * 4.5));
    const sway = swayBase * swayDamp + tilt;
    // 全程匀速放大（与雷达一致：基础 1.2x → 1.7x）
    const zoom = 1.2 + 0.5 * prog;
    const screenHalf = R * 6;      // R≈min(w,h)*0.16 → R*6≈0.96w

    // ② 沙丘地平线：底部起伏的沙海（随摇摆轻微左右推）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sway);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    const duneBase = cy + R * 1.35;
    ctx.beginPath();
    ctx.moveTo(cx - screenHalf, duneBase);
    for (let i = 0; i <= 40; i++) {
        const x = cx - screenHalf + (i / 40) * screenHalf * 2;
        const y = duneBase - Math.sin(i * 0.55 + t * 0.6) * R * 0.18
                        - Math.sin(i * 0.22 + t * 0.3) * R * 0.3;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(cx + screenHalf, cy + screenHalf * 2);
    ctx.lineTo(cx - screenHalf, cy + screenHalf * 2);
    ctx.closePath();
    const dune = ctx.createLinearGradient(0, duneBase - R * 0.5, 0, cy + screenHalf * 2);
    dune.addColorStop(0, 'rgba(190,150,95,0.85)');
    dune.addColorStop(1, 'rgba(120,88,52,0.95)');
    ctx.fillStyle = dune;
    ctx.fill();
    // 沙丘顶高光（热浪反光）
    ctx.strokeStyle = 'rgba(240,205,140,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
        const x = cx - screenHalf + (i / 40) * screenHalf * 2;
        const y = duneBase - Math.sin(i * 0.55 + t * 0.6) * R * 0.18
                        - Math.sin(i * 0.22 + t * 0.3) * R * 0.3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // ②' 远处依稀可见的绿洲（海市蜃楼）：去掉城市，只保留绿洲，并在左右两侧各放一个
    // （"边上多放一点但不要太多"）。低对比 + 沙黄雾霭 + 底部融入沙丘，不显生硬。
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sway);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    const mrgX = Math.sin(t * 0.7) * R * 0.3;      // 热浪整体横向漂移
    const mrgY = duneBase - R * 0.22 + Math.sin(t * 0.5) * R * 0.05;
    const mrgScale = 0.9 + 0.08 * Math.sin(t * 0.4);  // 轻微呼吸
    ctx.globalAlpha = 0.32;
    // 两个绿洲（左侧稍大、右侧稍小，避免过于对称整齐）
    const oasisSpots = [
        { gx: cx - R * 1.9 + mrgX * 0.6, size: 1.0 },
        { gx: cx + R * 1.95 + mrgX * 0.6, size: 0.8 },
    ];
    for (const os of oasisSpots) {
        const gx = os.gx;
        const gs = os.size;
        ctx.save();
        ctx.translate(gx, mrgY);
        ctx.scale(mrgScale * gs, mrgScale * gs);
        // 绿洲基底：椭圆渐变绿块（像透过雾看到的绿意，边缘柔化）
        const oasis = ctx.createRadialGradient(0, -R * 0.1, 0, 0, -R * 0.1, R * 0.75);
        oasis.addColorStop(0, 'rgba(120,140,90,0.4)');
        oasis.addColorStop(0.55, 'rgba(110,130,80,0.25)');
        oasis.addColorStop(1, 'rgba(110,130,80,0)');
        ctx.fillStyle = oasis;
        ctx.beginPath();
        ctx.ellipse(0, -R * 0.1, R * 0.75, R * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 零星树影（2~3 个模糊的棕榈虚影：细杆 + 模糊叶团，低对比）
        const treeN = gs > 0.9 ? 3 : 2;
        for (let i = 0; i < treeN; i++) {
            const px2 = -R * 0.3 + i * R * 0.32;
            const ph2 = R * (0.5 + (i % 2) * 0.18);
            ctx.strokeStyle = 'rgba(96,88,60,0.5)';
            ctx.lineWidth = Math.max(1, R * 0.012);
            ctx.beginPath();
            ctx.moveTo(px2, R * 0.05);
            ctx.quadraticCurveTo(px2 + R * 0.02, -ph2 * 0.5, px2 + Math.sin(i) * R * 0.03, -ph2);
            ctx.stroke();
            const leaf = ctx.createRadialGradient(px2, -ph2, 0, px2, -ph2, R * 0.16);
            leaf.addColorStop(0, 'rgba(100,120,72,0.5)');
            leaf.addColorStop(1, 'rgba(100,120,72,0)');
            ctx.fillStyle = leaf;
            ctx.beginPath();
            ctx.arc(px2 + Math.sin(i) * R * 0.03, -ph2, R * 0.16, 0, Math.PI * 2);
            ctx.fill();
        }
        // 底部柔化带（融入沙丘）
        const gFog = ctx.createLinearGradient(0, -R * 0.3, 0, R * 0.2);
        gFog.addColorStop(0, 'rgba(150,130,90,0)');
        gFog.addColorStop(1, 'rgba(150,130,90,0.25)');
        ctx.fillStyle = gFog;
        ctx.beginPath();
        ctx.ellipse(0, 0, R * 1.1, R * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();

    // ③ 沙尘带：多层横向沙幕自左向右被风卷过（模糊横条）；
    // v3.78 套入世界变换（sway/tilt/zoom），快倒下时沙幕跟随倾斜。
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sway);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    for (let i = 0; i < 6; i++) {
        const bandY = cy - R * 1.2 + i * R * 0.45;
        const off = ((t * (1.4 + i * 0.3) + i * 1.7) % 2) * screenHalf * 1.4 - screenHalf * 0.7;
        const bw = R * (0.7 + 0.3 * Math.sin(i * 2.3));
        const bh = R * 0.05;
        const grad = ctx.createLinearGradient(off - bw, 0, off + bw, 0);
        const a = 0.10 + 0.06 * Math.sin(t * 3 + i);
        grad.addColorStop(0, `rgba(214,178,120,0)`);
        grad.addColorStop(0.5, `rgba(214,178,120,${a.toFixed(2)})`);
        grad.addColorStop(1, `rgba(214,178,120,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(off - bw, bandY, bw * 2, bh);
    }
    ctx.restore();

    // ④ 沙粒：漫天的细小沙尘（缓慢横向漂移，上下起伏）
    for (let i = 0; i < 40; i++) {
        const ph = (i / 40) * Math.PI * 2;
        const yy = cy - R * 1.2 + ((i * 37) % 100) / 100 * R * 2.4;
        const xx = cx + ((i * 53) % 100) / 100 * screenHalf * 1.6 - screenHalf * 0.8
                 + ((t * (0.8 + i * 0.07) + ph) % 2) * screenHalf * 0.5;
        const r = R * (0.008 + ((i * 11) % 5) / 5 * 0.014);
        const bright = 0.5 + 0.5 * Math.sin(t * 5 + ph * 2);
        ctx.fillStyle = `rgba(235,196,128,${(0.35 + 0.3 * bright).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(xx, yy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ⑤ 大沙石：时不时从一侧横掠过画面（近景，被风卷起）
    const STONE_N = 5;
    for (let i = 0; i < STONE_N; i++) {
        const period = 2.6 + i * 0.9;                    // 错开出现
        const cycle = (t + i * 1.9) % period / period;
        if (cycle < 0.8) continue;
        const fly = (cycle - 0.8) / 0.2;                 // 0→1 快速掠过
        const dir = (i % 2 === 0) ? 1 : -1;
        const stx = cx + dir * screenHalf * (1 - fly) - dir * screenHalf * 0.25 * fly;
        const sty = cy - R * 0.5 + Math.sin(t * 2.2 + i) * R * 0.7;
        const sz = R * (0.05 + 0.05 * Math.sin(i * 3.1));
        const rotA = t * (3 + i * 0.8);
        // v3.78 套入世界变换：快倒下时近景石头跟随倾斜
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(sway);
        ctx.scale(zoom, zoom);
        ctx.translate(-cx, -cy);
        ctx.translate(stx, sty);
        ctx.rotate(rotA);
        ctx.fillStyle = `rgba(150,116,74,${(0.8 - 0.35 * fly).toFixed(2)})`;
        ctx.beginPath();
        const corners = 5;
        for (let k = 0; k < corners; k++) {
            const a = (k / corners) * Math.PI * 2;
            const rr = sz * (0.7 + 0.4 * Math.sin(i * 2.1 + k * 1.9));
            const px2 = Math.cos(a) * rr, py2 = Math.sin(a) * rr;
            if (k === 0) ctx.moveTo(px2, py2);
            else ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // ⑤' 风滚草：贴沙丘面滚过的干草团（在世界变换内绘制，与沙丘同步起伏/倾斜/缩放）
    // v3.78 用户定制：①用沙丘同公式的索引换算，保证贴沙不飘天；②淡入淡出避免突然消失；
    // ③自旋滚起来；④低透明度+细草刺，雾感模糊不清晰。
    {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(sway);
        ctx.scale(zoom, zoom);
        ctx.translate(-cx, -cy);
        const period = 4.0;
        const fly = (t * 1.3) % period / period;             // 0→1 全程滚动
        const twx = cx - screenHalf * 0.75 + fly * screenHalf * 1.5;
        // 与沙丘完全相同的索引换算，保证紧贴沙面
        const i0 = ((twx - (cx - screenHalf)) / (2 * screenHalf)) * 40;
        const duneH = Math.sin(i0 * 0.55 + t * 0.6) * R * 0.18
                    + Math.sin(i0 * 0.22 + t * 0.3) * R * 0.3;
        const tws = R * 0.1;
        const twy = duneBase - duneH - tws;                  // 底部压在沙面上
        const twR = fly * Math.PI * 6;                       // 自旋（滚起来）
        // 淡入淡出：首尾各 10% 渐显渐隐，不突然出现/消失
        const fade = Math.min(1, fly / 0.1, (1 - fly) / 0.1);
        ctx.save();
        ctx.translate(twx, twy);
        ctx.rotate(twR);
        // 草团主体（棕褐，半透明雾感）
        ctx.fillStyle = `rgba(150,120,74,${(0.5 * fade).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(0, 0, tws, 0, Math.PI * 2);
        ctx.fill();
        // 张开的干草刺（细、低透明度，形成毛球虚影）
        ctx.strokeStyle = `rgba(170,136,86,${(0.35 * fade).toFixed(2)})`;
        ctx.lineWidth = Math.max(0.8, R * 0.006);
        for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2 + twR * 0.3;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * tws * 0.9, Math.sin(a) * tws * 0.9);
            ctx.lineTo(Math.cos(a) * tws * 1.7, Math.sin(a) * tws * 1.7);
            ctx.stroke();
        }
        ctx.restore();
        ctx.restore();
    }

    // ⑥ 太阳：天上固定天体（不随 zoom 放大），仅随画面 sway 旋转偏移——
    // 人左摇右摆/快倒下时，太阳相对视野偏移到一侧（"太阳不动，是人的视角在动"）；
    // v3.78 去掉十字光芒横线，仅保留圆形光晕；快倒下阶段光晕随 prog 增强。
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sway);
    ctx.translate(-cx, -cy);
    {
        const fx = cx;
        const fy = cy - R * 1.3;
        // 抬头程度 = 摆幅收敛程度（swayDamp=1-prog → 0 时人站稳对准太阳）
        const lookUp = Math.min(1, prog * 1.35);             // 后段逐渐增强
        // 耀斑强度：带轻微呼吸脉冲，越接近结尾越强（仅增强光晕，不再画横线）
        const flare = lookUp * (0.55 + 0.45 * Math.sin(t * 5));
        // 外层光晕（恒亮 + 耀斑时增强）
        const haloA = 0.75 + 0.45 * flare;
        const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, R * (1.4 + 0.5 * flare));
        fg.addColorStop(0, `rgba(255,246,210,${haloA.toFixed(3)})`);
        fg.addColorStop(0.35, `rgba(255,222,150,${(0.35 + 0.35 * flare).toFixed(3)})`);
        fg.addColorStop(1, 'rgba(255,214,140,0)');
        ctx.save();
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(fx, fy, R * (1.4 + 0.5 * flare), 0, Math.PI * 2);
        ctx.fill();
        // 太阳本体（稳定圆盘）
        ctx.fillStyle = 'rgba(255,242,205,0.9)';
        ctx.beginPath();
        ctx.arc(fx, fy, R * 0.28, 0, Math.PI * 2);
        ctx.fill();
        // 中心高亮（耀斑时更亮更刺眼）
        ctx.fillStyle = `rgba(255,252,238,${(0.9 + 0.1 * flare).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(fx, fy, R * (0.17 + 0.05 * flare), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();

    return prog;
}
