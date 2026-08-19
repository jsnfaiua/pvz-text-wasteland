// ============================================================
// 【无尽植僵荒原】Toast 通知系统（右上滑入 → 停留 → 上浮淡出）
// 从 render.js 拆出（v4.26）：纯 DOM 操作，与画布渲染零耦合。
// ============================================================

const _toastMax = 8;
const _toastGap = 12;          // 条目间距 px
const _toastTop = 72;           // 顶部起始 Y px
const _toastLife = 1600;        // 停留 ms
const _toastFadeOut = 1200;     // 向上淡出动画 ms
const _toastSlideIn = 550;      // 滑入动画 ms
let _toastList = [];            // [{ text, color, el, height, removed }]
let _toastRunning = false;      // 串行闸门：顶部条目的 停留→淡出 流程是否进行中
function _toastKey(t, c) { return (t || '') + '|' + (c || '#39d98a'); }
function _toastMeasure(el) {
    const rect = el.getBoundingClientRect();
    return Math.max(40, Math.ceil(rect.height || 50));
}
function _toastReorder(animate) {
    // 按队列顺序从上到下堆叠（top = _toastTop + index*(height+gap)）。
    // animate=true 时平滑过渡；false（首帧）时瞬移到目标位置。
    let idx = 0;
    for (const t of _toastList) {
        if (t.removed) continue;
        const top = _toastTop + idx * (t.height + _toastGap);
        if (animate) {
            t.el.style.transition = 'top 0.55s cubic-bezier(0.25,0.85,0.3,1), transform 0.55s cubic-bezier(0.25,0.85,0.3,1), opacity 0.55s ease';
        } else {
            t.el.style.transition = 'none';
        }
        t.el.style.top = top + 'px';
        idx++;
    }
}
function _toastMaybeRun() {
    // 串行闸门：没有正在进行的流程，且队列非空 → 启动顶部第一条的"停留→淡出"
    if (_toastRunning) return;
    const first = _toastList.find(t => !t.removed);
    if (!first) return;
    _toastRunning = true;
    // 停留（滑入已由 spawn 完成后延迟触发，此处确保已滑入）
    setTimeout(() => {
        if (first.removed) { _toastRunning = false; _toastMaybeRun(); return; }
        // 原地向上淡出：保持 translateX(0)（左贴边、水平位置不变），只轻微上浮 + opacity 淡出
        const el = first.el;
        el.style.transition = 'transform 1.2s ease, opacity 1.2s ease, top 0.55s ease';
        el.style.transform = 'translateX(0) translateY(-18px)';
        el.style.opacity = '0';
        // v3.97 关键：第一条开始淡出时，【立即】让后续条目缓慢上移补位（不是等淡出结束才补），
        // 顶部补上来的那一条立即开始它自己的停留→淡出 → 动画衔接更自然不生硬。
        _toastReorder(true);
        setTimeout(() => {
            // 完全淡出 → 移除
            if (!first.removed) {
                first.removed = true;
                if (el.parentNode) el.parentNode.removeChild(el);
            }
            _toastList = _toastList.filter(x => x !== first);
            _toastReorder(true);   // 二次补位（淡出已完成的条目已移除）
            _toastRunning = false;
            _toastMaybeRun();      // 下一条立即开始
        }, _toastFadeOut);
    }, _toastLife);
}
function _toastSpawn(text, color) {
    if (typeof document === 'undefined') return;
    const c = color || '#39d98a';
    const el = document.createElement('div');
    // v3.98 弹窗停在【屏幕右侧 1/4 处】（以"世界创建成功"为标准）：left:75% 使弹窗左边缘
    // 位于视窗 75% 处（右侧 1/4 区域），从右外滑入 translateX(100%)→0 停在此处。
    el.style.cssText = 'position:fixed;top:' + _toastTop + 'px;left:75%;z-index:9999;background:rgba(10,18,14,0.92);border:1px solid ' + c + ';color:' + c + ';padding:12px 28px;border-radius:8px;font-family:"Microsoft YaHei",monospace;font-size:15px;letter-spacing:2px;box-shadow:0 0 24px rgba(0,0,0,0.5);pointer-events:none;text-align:left;white-space:nowrap;opacity:0;transform:translateX(100%) translateY(0);transition:transform 0.55s cubic-bezier(0.25,0.85,0.3,1),opacity 0.55s ease,top 0.55s cubic-bezier(0.25,0.85,0.3,1);max-width:min(540px,20vw);';
    el.textContent = text;
    document.body.appendChild(el);
    const height = _toastMeasure(el);
    const item = { text, color: c, el, height, removed: false };
    _toastList.push(item);
    _toastReorder(false);
    // 滑入：translateX 100% → 0（从右外滑入到右 1/4 处，保持水平位置）
    requestAnimationFrame(() => {
        if (item.removed) return;
        el.style.opacity = '1';
        el.style.transform = 'translateX(0) translateY(0)';
    });
    // 等滑入动画完成后，若队列空闲则启动顶部条目的停留流程
    setTimeout(() => _toastMaybeRun(), _toastSlideIn + 60);
}
export function showToast(text, color) {
    if (typeof document === 'undefined') return;
    const c = color || '#39d98a';
    const key = _toastKey(text, c);
    // 频繁点击防抖：相同 text+color 已在队列中（未淡出 或 正在淡出）→ 忽略本次调用
    const dup = _toastList.find(t => !t.removed && _toastKey(t.text, t.color) === key);
    if (dup) return;
    // 超出上限 8 条：拒绝 + 强制显示"请勿频繁点击"
    if (_toastList.filter(t => !t.removed).length >= _toastMax) {
        const warnKey = _toastKey('请勿频繁点击', '#FFB347');
        const hasWarn = _toastList.find(t => !t.removed && _toastKey(t.text, t.color) === warnKey);
        if (!hasWarn) _toastSpawn('请勿频繁点击', '#FFB347');
        return;
    }
    _toastSpawn(text, c);
}
