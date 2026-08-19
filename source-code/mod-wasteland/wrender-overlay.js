// ============================================================
// 【无尽植僵荒原】屏幕覆盖层渲染（睁眼苏醒 / 昼夜 / 事件氛围 / 蹲伏 / 感染侵蚀 / 危急光晕）
// 从 render.js 拆出（v4.26）：全屏覆盖类渲染，纯 canvas 无逻辑依赖。
// 依赖：wbalance（无）/ winfection（playerInfectionEffects / infVis）。
// clamp 为本地小工具（render.js 同名函数，避免循环依赖）。
// ============================================================

import { playerInfectionEffects, INFECTION_VISUAL } from './winfection.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 昏迷苏醒：从"模模糊糊昏暗"逐渐"明亮清晰"（单调变亮，不再中途变暗），
// 配合开场视线模糊（blur）与灰雾，睁眼般越来越清楚；配合移动锁定更代入感。
// 2026-08-12 v3.56 修复"效果太短太快看不到"：原 easeOutCubic 让暗度在前段急剧下降
//（prog=0.5 时已基本全亮），用户感觉不到灰黑渐变。改缓出平方曲线，暗度更缓慢下降，
// 灰黑蒙层持续更久；配合时长延长（新档 2.4s→4s、重生 3s→4s）让睁眼效果明显可见。
function easeOutCubic(x) { const t = clamp(x, 0, 1) - 1; return 1 + t * t * t; }
let _wakeOC = null;   // 离屏画布（用于模糊重绘当前画面）
export function drawWakeOverlay(ctx, sv, W, H) {
    const wk = sv._wake;
    if (!wk || wk.t >= wk.dur) return;
    const t = wk.t, dur = wk.dur;
    const prog = clamp(t / dur, 0, 1);
    const a = (1 - prog) * (1 - prog);     // 暗度：1→0 缓慢变亮（缓出平方，前段保持明显灰黑）
    const blurPx = 5 * (1 - prog);         // 开场模糊 → 越来越清晰
    const veil = 0.5 * (1 - prog);         // 灰雾（昏暗看不清）→ 清明
    if (a <= 0.01 && blurPx <= 0.3 && veil <= 0.01) return;
    // 1) 视线模糊：把当前画面拷到离屏再模糊重绘（保持背景活动，只做视觉模糊）
    if (blurPx > 0.3) {
        if (!_wakeOC) _wakeOC = document.createElement('canvas');
        _wakeOC.width = W; _wakeOC.height = H;
        _wakeOC.getContext('2d').drawImage(ctx.canvas, 0, 0, W, H);
        ctx.save();
        ctx.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
        ctx.drawImage(_wakeOC, 0, 0, W, H, 0, 0, W, H);
        ctx.filter = 'none';
        ctx.restore();
    }
    // 2) 暗度蒙层（单调变亮）
    if (a > 0.01) {
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }
    // 3) 灰雾（模糊昏暗的"看不清"感），逐渐清明
    if (veil > 0.01) {
        ctx.save();
        ctx.globalAlpha = clamp(veil, 0, 1);
        ctx.fillStyle = '#262b36';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }
    // 4) 苏醒文字：睁眼前半段浮现、持续、结尾淡出
    // 2026-08-11 v2.99 重生（_wake.reborn）与开场表现完全一致：画内随睁眼浮现/持续/淡出，
    // 仅文字内容不同（开场"你在荒野中醒来…" / 重生"你 醒 了 过 来"）。
    const wakeTxt = wk.reborn ? '你 醒 了 过 来' : '你在荒野中醒来…';
    const ta = prog < 0.4 ? prog / 0.4 : (prog < 0.82 ? 1 : clamp((1 - prog) / 0.18, 0, 1));
    if (ta > 0.02) {
        const wob = Math.round(Math.sin(sv.now * 1.5) * 1);
        ctx.save();
        ctx.globalAlpha = ta;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 20px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#B8C6D6';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 8;
        ctx.fillText(wakeTxt, W / 2 + wob, H * 0.42);
        ctx.restore();
    }
}

// ---------- 昼夜系统（1 现实小时 = 1 游戏天，DAY_LEN=3600s） ----------
// 6:00-18:00 白天；18:00-20:00 黄昏渐暗；20:00-4:00 深夜全暗；4:00-6:00 黎明渐亮。
// 与既有玩法一致：20:00 起尸潮开场、夜间僵尸变强（wbalance HORDE_START_HOUR / Z_NIGHT_STRENGTH_MUL）。
function dayNightAlpha(sv) {
    const hour = (sv.t / sv.dayLen) * 24;
    const smooth = x => x * x * (3 - 2 * x);
    if (hour >= 6 && hour < 18) return 0;
    if (hour >= 4 && hour < 6) return 1 - smooth((hour - 4) / 2);
    if (hour >= 18 && hour < 20) return smooth((hour - 18) / 2);
    return 1;
}
export function drawDayNight(ctx, sv, W, H, interior) {
    if (sv._devGfx === 0) return;   // 低画质：跳过夜晚暗色覆盖层（氛围降级，省一次全屏 fillRect）
    const a = dayNightAlpha(sv);
    if (a <= 0) return;
    // 停电夜事件（D）：暗色加强 1.5x（视野受限感）
    const blackout = sv._evt && sv._evt.type === 'blackout' ? 1.5 : 1;
    const alpha = 0.58 * a * (interior ? 0.5 : 1) * blackout;
    ctx.fillStyle = `rgba(8,12,30,${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
}

// ---------- 随机事件氛围覆盖层（D）：停电夜暗角（沙尘暴已并入天气系统） ----------
export function drawEventOverlay(ctx, sv, W, H) {
    if (!sv._evt) return;
    if (sv._evt.type === 'blackout') {
        // 停电：四周更暗的窄视（加深边缘）
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.9);
        g.addColorStop(0, 'rgba(0,0,20,0)');
        g.addColorStop(1, 'rgba(0,0,20,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }
}

// ---------- Ctrl 蹲下覆盖层（2026-08-10）：暗色遮罩 + 底部"蹲伏中"提示（潜伏感） ----------
export function drawSquatOverlay(ctx, sv, W, H) {
    if (!sv.squatting) return;
    ctx.save();
    // 半透明暗色遮罩：压低画面亮度制造潜伏氛围（不阻断操作）
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // 底部提示
    ctx.save();
    ctx.font = '12px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('蹲伏中（潜伏）', W / 2, H - 10);
    ctx.restore();
}

// ---------- 感染屏幕覆盖层：阶段越高绿灰侵蚀越明显（呼吸 + 噪点，§13.1 INF_VIS 收口） ----------
export function drawInfectionOverlay(ctx, sv, W, H) {
    if (!sv || sv.infection <= 0) return;
    if (sv._devGfx === 0) return;   // 低画质跳过（§7）
    const stage = playerInfectionEffects(sv.infection).stage;
    const vis = INFECTION_VISUAL[stage];
    if (!vis || vis.alpha <= 0) return;
    const breathe = 0.5 + 0.5 * Math.sin(sv.now * (stage >= 4 ? 3.2 : 1.8));
    const a = vis.alpha * (0.75 + 0.25 * breathe);
    // 边缘侵蚀暗角（文字剥落感：灰绿调）
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(40,55,48,0)');
    g.addColorStop(1, `rgba(30,48,40,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 噪点：文字侵蚀闪烁（stage 4+ 失名/文尸），稀疏灰绿小像素（表现类随机）
    // 2026-08-12 v3.58 性能优化（用户反馈"感染后慢慢变卡"）：原每帧 Math.random()*n 次 fillRect，
    // 1920×1080 下约 230 次/帧，感染全程累积明显卡顿。改为①确定性伪随机（按帧序号播种的 LCG，
    // 位置稳定不闪烁），②噪点密度减半，③用 fillStyle 批量矩形路径一次 fill（GPU 单次调用）。
    if (vis.noise) {
        const n = Math.floor(W * H / 18000) * (sv._devGfx === 2 ? 1 : 0.6);
        if (n > 0) {
            const seed = (sv._infNoiseSeed = ((sv._infNoiseSeed || 0) + 1) & 0x7fffffff) || 1;
            const alpha = 0.28 + 0.22 * breathe;
            ctx.fillStyle = `rgba(150,178,162,${alpha.toFixed(3)})`;
            ctx.beginPath();
            let r = seed >>> 0;
            for (let i = 0; i < n; i++) {
                r = (r * 1664525 + 1013904223) >>> 0;   // LCG 确定性伪随机
                const x = r % W;
                r = (r * 1664525 + 1013904223) >>> 0;
                const y = r % H;
                ctx.rect(x, y, 1, 1);
            }
            ctx.fill();
        }
    }
}

// ---------- 危急状态晕眩：镜头轻微摇摆（饥饿/缺水 or 低血量 ≤20%） ----------
export function hungerShake(sv) {
    if (!sv || sv.food == null) return { x: 0, y: 0 };
    if (sv.food > 0 && (sv.water == null || sv.water > 0) && sv.hp > (sv.maxHp || 100) * 0.2) return { x: 0, y: 0 };
    const t = sv.now;
    return {
        x: Math.sin(t * 7.3) * 1.2,
        y: Math.cos(t * 6.1) * 1.0,
    };
}

// ---------- 危急状态光晕：昏黄呼吸光 + 边缘暗角（饥饿/缺水或低血量，快晕倒的眩晕感） ----------
export function drawStarveVignette(ctx, sv, W, H) {
    if (!sv || sv.food == null) return;
    if (sv.food > 0 && (sv.water == null || sv.water > 0) && sv.hp > (sv.maxHp || 100) * 0.2) return;
    const breathe = 0.5 + 0.5 * Math.sin(sv.now * 1.8);
    // 室内背景已被 drawDayNight 压暗一层 + 暗角叠加会把棕色光晕完全掩盖成纯黑
    // → 室内减弱暗角、提亮棕色光晕，让低状态警示在室内也清晰可见（与室外"同步"）
    const isIn = !!sv.interior;
    const ringA = isIn ? 0.50 + 0.30 * breathe : 0.30 + 0.22 * breathe;
    const darkA = isIn ? 0.12 + 0.10 * breathe : 0.32 + 0.20 * breathe;
    // 昏黄光晕（低血糖/失血发晕感）：中心稍透，向四周变浓，随呼吸脉动
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(130,66,22,0)');
    g.addColorStop(1, `rgba(70,32,10,${ringA.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 边缘暗角（视野收窄）：呼吸脉动
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.30, W / 2, H / 2, H * 0.82);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${darkA.toFixed(3)})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
}
