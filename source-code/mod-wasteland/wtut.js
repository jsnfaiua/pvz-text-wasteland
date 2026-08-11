// ============================================================
// wtut.js — 荒原新手引导（首次进入提示卡 + F1 随时打开）
// ------------------------------------------------------------
// 用途：首次进入荒原时显示「生存指南」覆盖卡；按 F1 可随时重新打开。
// 覆盖：核心操作键位 + 生存目标 + 新功能（队伍管理/救治/季节天气/室内）。
// ------------------------------------------------------------
// 红线合规：
//   · 零依赖模块（不 import 任何游戏模块）——不扩大循环依赖区；
//   · 纯 DOM 覆盖层，不触碰 canvas 渲染路径，不改任何游戏状态；
//   · 标记存 localStorage（本地），不进 wstate / 不随 wsync 同步；
//   · 显示期间游戏正常运行（仅覆盖层，随时可点掉）。
// ============================================================

const KEY = 'wasteland_tutorial_seen';
let el = null;

// 2026-08-10 教程内容全面完善：覆盖全部已开发功能
function buildHtml() {
    return `
    <div style="position:relative;top:50%;left:50%;transform:translate(-50%,-50%);z-index:950;
                width:620px;max-width:94vw;max-height:86vh;overflow-y:auto;background:rgba(12,22,16,0.97);
                border:1px solid #3a8a4a;border-radius:10px;padding:20px 24px;color:#dce6e2;
                font:14px/1.6 'Microsoft YaHei',sans-serif;box-shadow:0 0 40px rgba(57,217,138,0.25);">
        <button id="wsl-tut-close-x" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#8a9aa2;font-size:20px;cursor:pointer;line-height:1;padding:2px;" title="关闭 (F1)">✕</button>
        <div style="font-size:19px;color:#7ee08a;text-align:center;margin-bottom:4px;">◈ 无尽植僵荒原 · 生存指南</div>
        <div style="font-size:12px;color:#7a8a92;text-align:center;margin-bottom:14px;">文字生存探索 · 城市越深处越危险，稀有物资越多 · 按 F1 可随时打开本指南 · 再按 F1 关闭</div>

        <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">▸ 操作键位</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 14px;font-size:13px;margin-bottom:12px;">
            <span><b style="color:#7ee08a;">WASD</b> 移动 · <b style="color:#7ee08a;">Shift</b> 奔跑</span>
            <span><b style="color:#7ee08a;">Q</b> 闪避（无敌帧）</span>
            <span><b style="color:#7ee08a;">J</b> 近战攻击 · <b style="color:#7ee08a;">E</b> 格挡</span>
            <span><b style="color:#7ee08a;">F</b> 交互（搜刮/拾取/进门/救治/赠送）</span>
            <span><b style="color:#7ee08a;">R</b> 换弹 · <b style="color:#7ee08a;">X</b> 切武器 · <b style="color:#7ee08a;">V</b> 背起/放下</span>
            <span><b style="color:#7ee08a;">B</b> 背包 · <b style="color:#7ee08a;">C</b> 角色属性 · <b style="color:#7ee08a;">G</b> 建造</span>
            <span><b style="color:#7ee08a;">H</b> 队伍管理（属性/背包/补给）</span>
            <span><b style="color:#7ee08a;">1-6</b> 快捷栏使用 · <b style="color:#7ee08a;">P</b> 暂停</span>
            <span><b style="color:#7ee08a;">F1</b> 打开本指南 · <b style="color:#7ee08a;">F11</b> 全屏 · <b style="color:#7ee08a;">ALT+ESC</b> 退出全屏</span>
        </div>

        <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">▸ 生存目标</div>
        <div style="font-size:13px;color:#c8d6ce;margin-bottom:12px;line-height:1.8;">
            · 搜索字块/物资箱积累资源，用 <b style="color:#7ee08a;">拼字台</b> 把字块具现成工具武器<br>
            · 在空地插 <b style="color:#7ee08a;">领地旗帜</b> 建营地（可招 NPC、回血加速）<br>
            · 夜里 <b style="color:#ffcc66;">20:00 起尸潮来袭</b>，用 <b style="color:#7ee08a;">G</b> 建造墙/门/种植盆提前布防<br>
            · 找到 <b style="color:#7ee08a;">载具</b> 可快速探索（F 上车，靠近 NPC 可让队友代驾）<br>
            · 角色物品跨世界保留；世界跟种子生成，可随时换新世界重开
        </div>

        <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">▸ 队伍与伙伴</div>
        <div style="font-size:13px;color:#c8d6ce;margin-bottom:12px;line-height:1.8;">
            · 招募/雇佣 NPC 入队（最多 4 人）：F 交互 → 邀请/雇佣<br>
            · 按 <b style="color:#7ee08a;">H</b> 打开队伍管理：查看队员属性/背包，喂食/喝水/治病/减感染<br>
            · 队伍命令面板（靠近队员 F）：跟随/返回营地/驾车/召唤/切换主控/解散<br>
            · <b style="color:#7ee08a;">切换主控</b>（冷却 240s）：换到另一名队员操控<br>
            · <b style="color:#7ee08a;">召唤队员</b>（冷却 240s）：把卡住/掉队的队员拉回身边
        </div>

        <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">▸ 受伤与救治</div>
        <div style="font-size:13px;color:#c8d6ce;margin-bottom:12px;line-height:1.8;">
            · 主控濒死后：切队友视角搜集药品（伤口药/抗生素/草药×3）送到身边 F 救治<br>
            · 按 <b style="color:#7ee08a;">V</b> 或救助界面<b style="color:#7ee08a;">背起</b>濒死队友，背到床旁放下可延长存活 25%<br>
            · 队友也全员濒死/阵亡 → 无人能救，游戏结束<br>
            · 室内外规则一致：靠近楼梯按 F 上楼下楼，出口自动出门
        </div>

        <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">▸ 环境与季节</div>
        <div style="font-size:13px;color:#c8d6ce;margin-bottom:14px;line-height:1.8;">
            · 天气按<b style="color:#7ee08a;">季节</b>变化（春晴雨雾 / 夏晴雨沙尘 / 秋晴雨雾沙尘 / 冬晴雪雾）<br>
            · 顶部实时显示：天数/时间/区域/季节/天气<br>
            · 恶劣天气影响移速/视野，雷阵雨有闪电，沙尘暴有风力推挤<br>
            · 击杀恶意 NPC 掉落战利品包裹（含其全部物品）
        </div>

        <div style="display:flex;gap:10px;">
            <button id="wsl-tut-ok" style="flex:1;background:#123d2c;border:1px solid #39d98a;color:#39d98a;
                    border-radius:6px;padding:9px;font-size:15px;cursor:pointer;">开始生存！</button>
            <button id="wsl-tut-close" style="flex:1;background:#232c34;border:1px solid #4a5a66;color:#ccd;
                    border-radius:6px;padding:9px;font-size:15px;cursor:pointer;">关闭 (F1)</button>
        </div>
    </div>`;
}

export function isOpen() { return !!(el && el.isConnected); }

export function close() {
    if (el) { el.remove(); el = null; }
}

function attach(host) {
    el = document.createElement('div');
    el.id = 'wsl-tut';
    el.innerHTML = buildHtml();
    host.appendChild(el);
    const btn = el.querySelector('#wsl-tut-ok');
    if (btn) btn.addEventListener('click', () => {
        try { localStorage.setItem(KEY, '1'); } catch {}
        el.remove(); el = null;
    });
    // 2026-08-10 通用返回：关闭按钮（ESC）直接关闭，不标记已读（F1 随时可再开）
    const closeBtn = el.querySelector('#wsl-tut-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    // 2026-08-11 v2.99 右上角叉号：同关闭
    const closeX = el.querySelector('#wsl-tut-close-x');
    if (closeX) closeX.addEventListener('click', close);
}

// 首次进入时调用（startRun 里）。已看过则零开销返回。
export function showIfFirst(sv) {
    if (el && el.isConnected) return;
    let seen = false;
    try { seen = !!localStorage.getItem(KEY); } catch {}
    if (seen) return;
    const host = (typeof document !== 'undefined') ? (document.getElementById('game-container') || document.body) : null;
    if (!host) return;
    attach(host);
}

// 2026-08-11 v2.99 新存档开场流程：等"荒野醒来"睁眼动画（_wake）结束后再弹新手教程。
// 文字在 _wake 的 prog>=0.82 时开始淡出、prog=1 完全消失 → delayMs 取唤醒总时长即可。
// 老存档（已看过教程）或调用时已打开 → 零开销返回。
export function showIfFirstAfterWake(sv, delayMs) {
    if (el && el.isConnected) return;
    let seen = false;
    try { seen = !!localStorage.getItem(KEY); } catch {}
    if (seen) return;
    setTimeout(() => {
        // 延迟期间用户可能已手动关掉/打开过：避免重复
        if (el && el.isConnected) return;
        const host = (typeof document !== 'undefined') ? (document.getElementById('game-container') || document.body) : null;
        if (!host) return;
        attach(host);
    }, delayMs || 2500);
}

// 2026-08-10 随时打开教程（F1 键）：无论是否已看过都弹出
export function show() {
    if (el && el.isConnected) return;
    const host = (typeof document !== 'undefined') ? (document.getElementById('game-container') || document.body) : null;
    if (!host) return;
    attach(host);
}

export function destroy() {
    if (el) { el.remove(); el = null; }
}
