// ============================================================
// whud.js — 调试 HUD（Debug Overlay）
// ------------------------------------------------------------
// 用途：开发者诊断面板（wdev 的「调试HUD」开关）。显示：
//   FPS / 帧耗时 / 玩家位置与昼夜时间 / 实体计数（僵尸·NPC·子弹·
//   掉落·特效·植物）/ 生存状态（血·饱·水·感染）/ 驾驶状态 / 联机角色。
// ------------------------------------------------------------
// 红线合规：
//   · 零依赖模块（不 import 任何游戏模块）——不扩大循环依赖区；
//   · 默认关闭（sv._devHud 为空即 return，主循环零开销）；
//   · 纯 DOM 覆盖层，不触碰 canvas 渲染路径，不改任何游戏状态；
//   · _devHud 仅存本地 profile（不进 wstate 白名单 / 不随 wsync 同步），
//     联机各端本地独立，不影响 host 权威与零差异目标。
//   · DOM 每 500ms 节流刷新一次（不每帧写文本）。
// ============================================================

const TS = 36;            // 与 world.js TS 一致的格边长（避免 import 引入依赖）
const REFRESH_MS = 500;   // DOM 刷新节流

let el = null;            // HUD 根元素
let body = null;          // 文本容器
let fpsAcc = 0, fpsT = 0, fps = 0, frameMs = 0, lastNow = 0;

// 创建 HUD DOM（首次调用注入样式与结构）
function ensureDom() {
    if (el && el.isConnected) return;
    el = document.createElement('div');
    el.id = 'wsl-hud';
    el.style.cssText = [
        'position:absolute', 'top:8px', 'right:8px', 'z-index:900',
        'pointer-events:none', 'font:12px/1.45 Consolas,Menlo,monospace',
        'color:#d8f8d8', 'background:rgba(8,20,10,0.72)',
        'border:1px solid rgba(120,255,150,0.35)', 'border-radius:6px',
        'padding:6px 10px', 'min-width:200px', 'text-align:left',
        'white-space:pre', 'text-shadow:0 1px 2px rgba(0,0,0,0.8)',
    ].join(';');
    body = document.createElement('div');
    el.appendChild(body);
    const style = document.createElement('style');
    style.textContent = '#wsl-hud .hud-dim{color:#7fa87f}#wsl-hud .hud-ok{color:#7dff7d}#wsl-hud .hud-warn{color:#ffcc66}#wsl-hud .hud-bad{color:#ff8866}';
    el.appendChild(style);
    (document.getElementById('game-container') || document.body).appendChild(el);
}

// 销毁 HUD（wdev 开关关闭时）
export function destroy() {
    if (el) { el.remove(); el = null; body = null; }
    fpsAcc = 0; fpsT = 0; fps = 0; frameMs = 0; lastNow = 0;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 每帧由 survival.loop 调用（HUD 关闭时零开销）
export function update(sv, now) {
    if (!sv || !sv._devHud) { if (el) destroy(); return; }
    // FPS / 帧耗时统计（500ms 窗口 EMA）
    fpsAcc++;
    const dtMs = now - lastNow;
    lastNow = now;
    if (dtMs > 0 && dtMs < 200) frameMs = frameMs * 0.9 + dtMs * 0.1;
    fpsT += dtMs;
    if (fpsT >= REFRESH_MS) {
        fps = Math.round((fpsAcc * 1000) / fpsT);
        fpsAcc = 0; fpsT = 0;
        refresh(sv);
    }
}

// 刷新 HUD 文本（500ms 一次）
function refresh(sv) {
    if (!el) ensureDom();
    const dayT = (sv.t / (sv.dayLen || 86400)) * 24;
    const clock = `${pad(Math.floor(dayT) % 24)}:${pad(Math.floor((dayT % 1) * 60))}`;
    const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
    const hp = Math.round(sv.hp || 0), maxHp = Math.round(sv.maxHp || 100);
    const z = sv.zombies ? sv.zombies.length : 0;
    const npc = sv.npcs ? sv.npcs.length : 0;
    const bul = sv.bullets ? sv.bullets.length : 0;
    const drp = sv.drops ? sv.drops.length : 0;
    const eff = sv.effects ? sv.effects.length : 0;
    const plt = sv.mods && sv.mods.plants ? Object.keys(sv.mods.plants).length : 0;

    // 驾驶状态
    let drive = '';
    if (sv.driving) drive = sv._chauffeured ? ' · NPC代驾中' : ' · 驾驶中';
    // 联机角色
    let mp = '';
    if (sv.mp) {
        const n = sv.mp.teammates ? Object.keys(sv.mp.teammates).length : 0;
        mp = ` · ${sv.mp.role === 'host' ? '房主' : '玩家'}${n > 0 ? ` +${n}队友` : ''}`;
    }
    // 帧耗时颜色
    const msColor = frameMs < 20 ? 'hud-ok' : frameMs < 33 ? 'hud-warn' : 'hud-bad';
    const hpColor = hp > 40 ? 'hud-ok' : hp > 15 ? 'hud-warn' : 'hud-bad';

    body.innerHTML =
        `<span class="hud-ok">FPS ${fps}</span> · <span class="${msColor}">${frameMs.toFixed(1)}ms</span>` +
        `  · 天${sv.day || 1} ${clock}${mp}\n` +
        `位置 (${gx},${gy}) · 血 <span class="${hpColor}">${hp}/${maxHp}</span> 饱${Math.round(sv.food || 0)} 水${Math.round(sv.water || 0)}` +
        (sv.infection ? ` 感染${Math.round(sv.infection)}%` : '') + drive + '\n' +
        `<span class="hud-dim">僵尸 ${z} · NPC ${npc} · 子弹 ${bul} · 掉落 ${drp} · 特效 ${eff} · 植物 ${plt}</span>`;
}
