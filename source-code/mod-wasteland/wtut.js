// ============================================================
// wtut.js — 荒原新手引导（首次进入提示卡）
// ------------------------------------------------------------
// 用途：首次进入荒原时显示「生存指南」覆盖卡：核心操作键位 +
// 生存目标要点。点击「开始生存」后关闭并写入 localStorage 标记，
// 之后不再弹出（不打断老玩家）。
// ------------------------------------------------------------
// 红线合规：
//   · 零依赖模块（不 import 任何游戏模块）——不扩大循环依赖区；
//   · 纯 DOM 覆盖层，不触碰 canvas 渲染路径，不改任何游戏状态；
//   · 标记存 localStorage（本地），不进 wstate / 不随 wsync 同步；
//   · 显示期间游戏正常运行（仅覆盖层，随时可点掉）。
// ============================================================

const KEY = 'wasteland_tutorial_seen';
let el = null;

function buildHtml() {
    return `
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:950;
                width:440px;max-width:92vw;background:rgba(12,22,16,0.96);border:1px solid #3a8a4a;
                border-radius:10px;padding:20px 22px;color:#dce6e2;font:14px/1.6 'Microsoft YaHei',sans-serif;
                box-shadow:0 0 40px rgba(57,217,138,0.25);">
        <div style="font-size:18px;color:#7ee08a;text-align:center;margin-bottom:4px;">◈ 无尽植僵荒原 · 生存指南</div>
        <div style="font-size:12px;color:#7a8a92;text-align:center;margin-bottom:14px;">文字生存探索 · 城市越深处越危险，稀有物资越多</div>
        <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">▸ 操作</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 14px;font-size:13px;margin-bottom:12px;">
            <span><b style="color:#7ee08a;">WASD</b> 移动</span>
            <span><b style="color:#7ee08a;">F</b> 交互（搜刮/捡拾/上车下车/开箱）</span>
            <span><b style="color:#7ee08a;">J</b> 近战 · <b style="color:#7ee08a;">E</b> 格挡</span>
            <span><b style="color:#7ee08a;">R</b> 换弹 · <b style="color:#7ee08a;">V</b> 开火模式 · <b style="color:#7ee08a;">X</b> 切武器</span>
            <span><b style="color:#7ee08a;">Q</b> 冲刺</span>
            <span><b style="color:#7ee08a;">B</b> 背包 · <b style="color:#7ee08a;">C</b> 角色 · <b style="color:#7ee08a;">G</b> 建造</span>
            <span><b style="color:#7ee08a;">1-6</b> 快捷栏使用</span>
            <span><b style="color:#7ee08a;">F9</b> 开发者面板（需开发者模式）</span>
        </div>
        <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">▸ 生存目标</div>
        <div style="font-size:13px;color:#c8d6ce;margin-bottom:14px;line-height:1.8;">
            · 搜索字块/物资箱积累资源，用 <b style="color:#7ee08a;">拼字台</b> 把字块具现成工具武器<br>
            · 在空地插 <b style="color:#7ee08a;">领地旗帜</b> 建营地（可招 NPC、回血加速）<br>
            · 夜里 <b style="color:#ffcc66;">20:00 起尸潮来袭</b>，用 <b style="color:#7ee08a;">G</b> 建造墙/门/种植盆提前布防<br>
            · 找到 <b style="color:#7ee08a;">载具</b> 可快速探索（F 上车，靠近 NPC 可让队友代驾）<br>
            · 角色物品跨世界保留；世界跟种子生成，可随时换新世界重开
        </div>
        <button id="wsl-tut-ok" style="width:100%;background:#123d2c;border:1px solid #39d98a;color:#39d98a;
                border-radius:6px;padding:9px;font-size:15px;cursor:pointer;">开始生存！</button>
    </div>`;
}

// 首次进入时调用（startRun 里）。已看过则零开销返回。
export function showIfFirst(sv) {
    if (el && el.isConnected) return;
    let seen = false;
    try { seen = !!localStorage.getItem(KEY); } catch {}
    if (seen) return;
    const host = (typeof document !== 'undefined') ? (document.getElementById('game-container') || document.body) : null;
    if (!host) return;
    el = document.createElement('div');
    el.id = 'wsl-tut';
    el.innerHTML = buildHtml();
    host.appendChild(el);
    const btn = el.querySelector('#wsl-tut-ok');
    if (btn) btn.addEventListener('click', () => {
        try { localStorage.setItem(KEY, '1'); } catch {}
        el.remove(); el = null;
    });
}

export function destroy() {
    if (el) { el.remove(); el = null; }
}
