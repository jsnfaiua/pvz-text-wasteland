// ============================================================
// 画布全屏适配：保持 960×540 逻辑坐标，按显示尺寸放大内部分辨率
// —— 字体渲染保持清晰，鼠标映射（/rect.width）依旧准确。
// 同时把缩放比写入 --wsl-scale，供荒原模组 HTML 面板等比缩放。
// 布局测量只在尺寸变化时进行（resize/DPR 变化/ResizeObserver），
// 避免每帧强制布局读取。
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

export function fitCanvasBacking(ctx) {
    const canvas = ctx && ctx.canvas;
    if (!canvas) return 1;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== _dpr) {
        _dpr = dpr;
        _cssW = -1;
    }
    if (_cssW < 0) {
        _cssW = canvas.clientWidth || LOGICAL_W;
    }
    const cssW = _cssW;
    const scale = Math.max(0.5, Math.min(4, (cssW / LOGICAL_W) * dpr));
    const bw = Math.round(LOGICAL_W * scale);
    const bh = Math.round(LOGICAL_H * scale);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const scaleCss = (cssW / LOGICAL_W).toFixed(3);
    if (scaleCss !== _lastScaleCss) {
        _lastScaleCss = scaleCss;
        const cont = document.getElementById('game-container');
        if (cont) cont.style.setProperty('--wsl-scale', scaleCss);
    }
    return scale;
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
