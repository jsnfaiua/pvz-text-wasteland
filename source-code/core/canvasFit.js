// ============================================================
// 画布全屏适配：960×540 逻辑坐标 = 物理像素（1:1 绘制）。
// —— 修复：旧版 setTransform(非整数 scale) 把缩放放进 canvas 内部 →
//    逐格 fillRect 在物理上亚像素错位（每格 28.4px 累积误差）= "格子状线条"。
//    现改为内部 1:1 绘制 + CSS 整图缩放（#game 已加 image-rendering: pixelated
//    最近邻 → 整图缩放相对位置不变，无格边界错位线）。
//    --wsl-scale 仍写入，供荒原模组 HTML 面板等比缩放。
// ============================================================

export const LOGICAL_W = 960;
export const LOGICAL_H = 540;

let _cssW = -1;   // 缓存的 CSS 宽度，-1 表示需要重新测量
let _dpr = -1;
let _lastScaleCss = '';

export function invalidateCanvasFit() {
    _cssW = -1;
}

// 窗口尺寸变化 → 失效缓存（下一帧 render 会重测）
if (typeof window !== 'undefined') {
    window.addEventListener('resize', invalidateCanvasFit);
}
// 设备像素比变化 → 失效缓存
if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    if (mq.addEventListener) mq.addEventListener('change', invalidateCanvasFit);
}

// canvas 元素自身尺寸变化（布局/全屏等不触发 window resize 的情况）→ 失效缓存
export function observeCanvasFit(canvas) {
    if (typeof ResizeObserver === 'undefined' || !canvas) return;
    const ro = new ResizeObserver(() => invalidateCanvasFit());
    ro.observe(canvas);
}

// 画质档渲染缩放因子：保留签名（低画质 0.75 未来可改为内部分辨率降级，默认 1 = 现状）
let _factor = -1;

export function fitCanvasBacking(ctx, factor = 1) {
    const canvas = ctx && ctx.canvas;
    if (!canvas) return 1;
    if (factor !== _factor) {
        _factor = factor;
        _cssW = -1;
    }
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== _dpr) {
        _dpr = dpr;
        _cssW = -1;
    }
    if (_cssW < 0) {
        _cssW = canvas.clientWidth || LOGICAL_W;
    }
    const cssW = _cssW;
    // 内部 1:1（物理 = 960×540）：不再 setTransform 缩放（非整数 scale → 逐格 fillRect 亚像素错位 = 格子线）
    if (canvas.width !== LOGICAL_W) canvas.width = LOGICAL_W;
    if (canvas.height !== LOGICAL_H) canvas.height = LOGICAL_H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scaleCss = (cssW / LOGICAL_W).toFixed(3);
    if (scaleCss !== _lastScaleCss) {
        _lastScaleCss = scaleCss;
        const cont = document.getElementById('game-container');
        if (cont) cont.style.setProperty('--wsl-scale', scaleCss);
    }
    return 1;
}

export function toggleFullscreen() {
    invalidateCanvasFit(); // 全屏切换常伴随尺寸变化，主动失效缓存
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    } else {
        const el = document.documentElement;
        if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    }
}
