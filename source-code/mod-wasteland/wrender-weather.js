// ============================================================
// 【无尽植僵荒原】天气渲染层（覆盖层 + 粒子 + 雷阵雨闪电）
// 从 render.js 拆出（v4.26）：纯渲染，无逻辑/存档依赖。
// 依赖：wbalance（wxInfo/wxLevelCur/wxIntensity/WX_PART_SPEED/wxSpeedMul/windDirAtHour）、
//       world（hash2）。
// ============================================================

import { wxInfo, wxLevelCur, wxIntensity, WX_PART_SPEED, wxSpeedMul, windDirAtHour } from './wbalance.js';
import { hash2 } from './world.js';

// 本地模糊缓存 canvas（原 render.js 的 _wakeOC 由 drawWakeOverlay 共享；此处独立避免跨模块共享状态）
let _wxWakeOC = null;

export function drawWeatherOverlay(ctx, sv, W, H) {
    const wx = wxInfo(sv._weather);
    if (wx.particles === 0) return;   // 晴朗无覆盖
    const level = wxLevelCur(sv);
    const inten = wxIntensity(sv._weather, level);
    const mul = inten.mul;
    const breathe = 0.5 + 0.5 * Math.sin(sv.now * 1.6);
    if (sv._weather === 'sandstorm') {
        // 沙色呼吸暗角 × 强度
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
        g.addColorStop(0, 'rgba(150,110,40,0)');
        g.addColorStop(1, `rgba(150,110,40,${((0.18 + 0.10 * breathe) * mul).toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    } else if (sv._weather === 'fog') {
        // 2026-08-09 用户要求：大雾复用"荒野中醒来"的模糊+灰雾效果（渐变的看不清，无圆环）。
        // 原径向渐变以屏幕中心为圆心，边缘有明显圆形边界；改为全屏轻微 blur（越浓越糊）
        // + 均匀灰雾蒙层（呼吸微动），画面整体"渐变的看不清"，无任何可见圆圈。
        const blurPx = 0.8 + 1.8 * mul;   // 雾越浓越模糊（薄雾 ~1.2px / 浓雾 ~2.6px）
        const veilA = Math.min(0.8, (0.20 + 0.07 * breathe) * Math.max(0.6, mul) * 1.5);
        if (blurPx > 0.3) {
            if (!_wxWakeOC) _wxWakeOC = document.createElement('canvas');
            _wxWakeOC.width = W; _wxWakeOC.height = H;
            _wxWakeOC.getContext('2d').drawImage(ctx.canvas, 0, 0, W, H);
            ctx.save();
            ctx.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
            ctx.drawImage(_wxWakeOC, 0, 0, W, H, 0, 0, W, H);
            ctx.filter = 'none';
            ctx.restore();
        }
        // 均匀灰雾：整屏蒙层让视野"雾蒙蒙看不清"，渐变感由 blur 提供，无硬边圆圈
        ctx.save();
        ctx.globalAlpha = Math.max(0.03, Math.min(0.8, veilA));
        ctx.fillStyle = '#c8d2da';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    } else if (sv._weather === 'rain' || sv._weather === 'snow') {
        // 雨雪天色偏冷：冷调 × 强度（暴雨更冷、小雪更淡）
        ctx.fillStyle = sv._weather === 'rain'
            ? `rgba(90,120,160,${((0.06 + 0.03 * breathe) * mul).toFixed(3)})`
            : `rgba(205,222,240,${((0.05 + 0.03 * breathe) * mul).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
    }
}

// ---------- 天气粒子层（雨丝 / 雪花 / 飞沙）：屏幕锚定固定池，跟随相机平移 ----------
// 2026-08-12 用户反馈"冲刺/奔跑时天气在前方出现一片空缺"——原世界坐标固定池只有顶部越界补充，
// 相机快速前移时新暴露区域来不及被粒子填满 → 冲刺方向空白。
// 现改为【屏幕锚定】：粒子每帧跟随相机平移（x+=camDx, y+=camDy），屏幕上始终均匀，
// 不管怎么跑天气都跟得上；同时保留垂直下落（y+=spd）→ 雨雪仍动态下落，风向漂移保留。
// 注：原"世界坐标→相对地面垂直下落"在玩家移动时感知速度不变（往下走雨不变快），
// 用户明确优先"天气在屏幕上不出现空缺"，故采用屏幕锚定。
// 强度只影响粒子密度（× inten.density），【速度分布不随强度变】——用户明确要求。
// 粒子是运行时表现类（§13.2 允许 Math.random：不影响世界/存档/结算），不序列化。
const WX_PART_MAX = 300;   // 含暴雨密度 2.3 上限（140×2.3=322 → cap 300）
let wxParticles = null;
function ensureWxParticles() {
    if (!wxParticles) {
        wxParticles = [];
        for (let i = 0; i < WX_PART_MAX; i++) wxParticles.push({ x: 0, y: 0, spd: 0, len: 3, seed: 0, kind: 0 });
        // spd=0 & kind=0 → 首帧 move 循环触发重置（§7 正确性兜底）
    }
    return wxParticles;
}
// 重置天气粒子（重生时调用）：
// 粒子是【屏幕锚定】固定池：重生相机瞬移时粒子随相机平移（camDx 巨大）→ 全屏依然均匀，
// 无需"先稀后密"过渡。此函数仍把 kind 清零触发下一帧全屏撒点，兜底覆盖未知的相机跳变。
export function resetWeatherParticles() {
    if (!wxParticles) return;
    for (let i = 0; i < wxParticles.length; i++) wxParticles[i].kind = 0;
    // spd 也清零，强制下一帧重新初始化速度（避免旧速度残留在新坐标产生奇怪轨迹）
    for (let i = 0; i < wxParticles.length; i++) wxParticles[i].spd = 0;
}
export function drawWeatherParticles(ctx, sv, W, H, camX, camY) {
    const wx = wxInfo(sv._weather);
    if (wx.particles === 0 || wx.particles === 3) return;   // 雾用覆盖层，无粒子
    if (sv._devGfx === 0) return;   // 低画质：跳过粒子（§7 性能降级）
    const parts = ensureWxParticles();
    const level = wxLevelCur(sv);
    const inten = wxIntensity(sv._weather, level);
    // v3.65 用户要求：天气切换淡入淡出 + 重生后粒子平滑过渡。
    // _weatherFadeT：天气类型（晴→雨/雨→雪 等）淡入进度（0~1，0=全透明→1=完全显示）；
    // _wxDensityMul：当前强度过渡（小雨→雷阵雨 / 小雪→暴雪 等），0=无粒子 → 1=正常密度。
    const fdt2 = Math.min(0.05, (performance.now() - (sv._wxPartT || performance.now())) / 1000);
    const fadeT = Math.min(1, (sv._weatherFadeT || 0) + fdt2 / 1.5);   // 类型淡入 1.5s
    sv._weatherFadeT = fadeT;
    const targetDen = inten.density;
    const curDen = sv._wxDensityMul != null ? sv._wxDensityMul : targetDen;
    // 密度向目标值平滑过渡（每帧靠近 ~1/TRANSITION 比例）
    const TRANSITION = 1.4;   // 强度过渡 1.4s：从小雨慢慢变大到雷阵雨
    const newDen = curDen + (targetDen - curDen) * Math.min(1, fdt2 / TRANSITION);
    sv._wxDensityMul = newDen;
    const densityMul = newDen;   // 强度 → 疏密（不改变速度，平滑过渡）
    const partKind = wx.particles * 10 + level;   // 类型+强度组合 → 切换强度也重置粒子（否则旧速度残留，用户反馈"强度切换视觉无差异"）
    const n = Math.min(WX_PART_MAX, Math.floor(WX_PART_MAX * (sv._devGfx === 2 ? 1 : 0.6) * densityMul));
    // 帧间隔（封顶防跳帧）：粒子用现实秒驱动，暂停时静止
    const nowMs = performance.now();
    const fdt = Math.min(0.05, (nowMs - (sv._wxPartT || nowMs)) / 1000);
    sv._wxPartT = nowMs;

    // ---------- 风向系统（2026-08-09）----------
    // 风向 = 世界每天确定性的 windDirAt(seed, day)（§13.2：world 态禁随机）。
    // 风向只影响粒子【视觉】（倾斜角 + 水平漂移），不影响逻辑/存档/结算。
    // 水平分量 windH = cos(wd)：
    //   东风（wd≈0°）→ windH≈+1 → 雨向右倾斜；西风（wd≈180°）→ windH≈-1 → 雨向左倾斜；
    //   南风（wd≈90°）/北风（wd≈270°）→ windH≈0 → 垂直下落，无水平偏移（符合"南风正常、北风没效果"）。
    // 垂直分量 windV = sin(wd) 只影响玩家被风吹（已在 updateWind 处理），不影响粒子水平倾斜。
    // 风向（2026-08-09 开发者模式可覆盖）：sv._devWind（弧度）为开发者测试风向；
    // 否则用随游戏小时变化的 windDirAtHour（风向不是一成不变，§13.2 确定性双端一致）
    const wd = sv._devWind != null ? sv._devWind : windDirAtHour(sv.world.seed, sv.day, (sv.t / sv.dayLen) * 24);
    const windH = Math.cos(wd);
    // 相机位移（屏幕锚定）：记录上帧相机，本帧位移叠加到所有粒子坐标 → 粒子相对屏幕静止，
    // 玩家冲刺/奔跑时前方不再空缺（2026-08-12）。重生瞬移时粒子随相机平移，全屏依然均匀。
    const prevCamX = sv._wxPrevCamX != null ? sv._wxPrevCamX : camX;
    const prevCamY = sv._wxPrevCamY != null ? sv._wxPrevCamY : camY;
    const camDx = camX - prevCamX;
    const camDy = camY - prevCamY;
    sv._wxPrevCamX = camX;
    sv._wxPrevCamY = camY;
    ctx.save();
    // 重生策略（双轨）：
    // ① 切换天气/初始化（kind 变）→ 撒全屏：切换瞬间立即全屏均匀（无"只有顶部"）；
    // ② 越界（稳态）→ 顶部边界进入：持续从顶部补充 → 稳态各高度密度 = 流量/速度恒定，
    //    顶部永远有雨（修复"全屏随机重生"稳态密度 ∝ y 线性递增 → 顶部空/底部密）。
    // 2026-08-09 修复"右侧无雨"：原固定向左漂移 0.28 → 右侧列粒子下落时左移出列，
    //    又未越界（x 仍在屏内）→ 右端底部长期空白（CDP 实测最右列密度仅最左列的 1/9）。
    //    现生成带按风向加宽 [camX-|windShift|, camX+W+|windShift|]，漂移后仍覆盖全屏；
    //    且风向为 0（南北风）时无水平漂移，全屏自然均匀。
    const colsOf = (i, n, W2, H2) => {
        const cols = Math.max(6, Math.ceil(Math.sqrt(n * W2 / Math.max(1, H2))));
        return { gx: i % cols, cols };
    };
    // 生成 x 覆盖全屏 + 向漂移【反方向】延伸（保证漂移后仍全屏均匀，无"右侧无雨"）：
    // 东风（windH>0，粒子向右漂）→ 左端粒子漂走 → 需向【左】延伸生成（genXMin 左移）；
    // 西风（windH<0，粒子向左漂）→ 右端粒子漂走 → 需向【右】延伸生成（genXSpan 加宽向右）。
    // 统一：x 落在 [camX - max(0, windH)*shiftW, camX - max(0, windH)*shiftW + W + shiftW]
    //       = [camX - max(0,windH)*shiftW, camX + W + max(0,-windH)*shiftW]
    const shiftW = Math.abs(windH) * 0.28 * H;   // 全屏单方向漂移量
    const genXMin = camX - Math.max(0, windH) * shiftW;
    const genXSpan = W + shiftW;   // 覆盖全屏 + 漂移方向的余量
    const genTop = (p, c, W, H, camX) => {
        p.x = genXMin + (c.gx + 0.5) * (genXSpan / c.cols) + (Math.random() - 0.5) * 20;
        p.y = camY - 30 - Math.random() * 50;   // 顶部边界上方进入
    };
    const genFull = (p, c, W, H, camX, camY) => {
        p.x = genXMin + (c.gx + 0.5) * (genXSpan / c.cols) + (Math.random() - 0.5) * 20;
        p.y = camY + Math.random() * H;
    };
    if (wx.particles === 1) {   // 雨：斜线下落，倾斜角由风向决定；屏幕锚定；速度/长度/粗细随强度
        // v3.65 天气类型淡入（fadeT=0→1 在 1.5s 内完成，淡入雪/雨切换）
        ctx.globalAlpha = Math.max(0, Math.min(1, fadeT));
        ctx.strokeStyle = 'rgba(140,180,220,0.55)';
        ctx.lineWidth = 0.8 + level * 0.16;   // 雨丝粗细随强度（小雨 0.8 / 雷阵雨 1.6）
        const hspd = windH * WX_PART_SPEED.rain * 0.28;   // 水平漂移速度（风向×基准侧风系数）
        for (let i = 0; i < n; i++) {
            const p = parts[i];
            if (p.kind !== partKind || !p.spd) {
                const c = colsOf(i, n, genXSpan, H);
                genFull(p, c, W, H, camX, camY);
                p.spd = WX_PART_SPEED.rain * wxSpeedMul(sv._weather, level) * (0.94 + Math.random() * 0.12);
                const sm = wxSpeedMul(sv._weather, level); p.len = (6 + Math.random() * 9) * sm;
                p.kind = partKind;
            } else if (p.y > camY + H + 30 || p.y < camY - 90 || p.x < camX - 60 || p.x > camX + W + 60) {
                const c = colsOf(i, n, genXSpan, H);
                genTop(p, c, W, H, camX);
            }
            p.x += camDx;   // 屏幕锚定：跟随相机平移（冲刺方向无空缺）
            p.y += camDy + p.spd * fdt;   // 相机垂直平移 + 垂直下落
            p.x += hspd * fdt;   // 风向水平漂移（东风向右、西风向左、南北风≈0）
            const sx = p.x - camX, sy = p.y - camY;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - windH * p.len * 0.28, sy - p.len);
            ctx.stroke();
        }
    } else if (wx.particles === 2) {   // 雪：慢速飘落小点 + 左右摇摆 + 风向偏移；速度/大小随强度
        // v3.65 天气类型淡入（fadeT=0→1 在 1.5s 内完成，淡入雪/雨切换）
        ctx.globalAlpha = Math.max(0, Math.min(1, fadeT));
        ctx.fillStyle = 'rgba(238,246,255,0.85)';
        const pSize = 1.5 + level * 0.5;
        const hspd = windH * WX_PART_SPEED.snow * 0.6;   // 雪更缓 → 风向水平占比略大
        for (let i = 0; i < n; i++) {
            const p = parts[i];
            if (p.kind !== partKind || !p.spd) {
                const c = colsOf(i, n, genXSpan, H);
                genFull(p, c, W, H, camX, camY);
                p.spd = WX_PART_SPEED.snow * wxSpeedMul(sv._weather, level) * (0.94 + Math.random() * 0.12);
                p.seed = Math.random() * 6.28;
                p.kind = partKind;
            } else if (p.y > camY + H + 30 || p.y < camY - 90 || p.x < camX - 40 || p.x > camX + W + 40) {
                const c = colsOf(i, n, genXSpan, H);
                genTop(p, c, W, H, camX);
            }
            p.x += camDx;   // 屏幕锚定：跟随相机平移（冲刺方向无空缺）
            p.y += camDy + p.spd * fdt;   // 相机垂直平移 + 垂直下落
            p.x += hspd * fdt + Math.sin(sv.now * 1.2 + p.seed) * 16 * fdt;   // 风向偏移 + 原有左右摇摆
            ctx.fillRect(p.x - camX, p.y - camY, pSize, pSize);
        }
    } else if (wx.particles === 4) {   // 沙尘：横向飞沙，风向主导方向（原随机左右 → 单一风向）；速度/长度/粗细随强度
        ctx.globalAlpha = Math.max(0, Math.min(1, fadeT));
        ctx.strokeStyle = 'rgba(205,175,115,0.5)';
        ctx.lineWidth = 0.8 + level * 0.2;
        // 沙尘主要受风向水平分量驱动：风向越偏横向越强；南北风时沙尘缓慢飘落
        const sandH = windH * WX_PART_SPEED.sand;
        const sandV = Math.abs(windH) < 0.3 ? -30 : 0;   // 南北风（近垂直）→ 沙尘缓慢下沉
        for (let i = 0; i < n; i++) {
            const p = parts[i];
            if (p.kind !== partKind || !p.spd) {
                const c = colsOf(i, n, genXSpan, H);
                p.x = camX + (windH >= 0 ? -40 : W + 40) + (Math.random() - 0.5) * 40;   // 从风向逆侧进入
                p.y = camY + Math.random() * H;
                p.spd = WX_PART_SPEED.sand * wxSpeedMul(sv._weather, level) * (0.94 + Math.random() * 0.12);
                p.len = (4 + Math.random() * 7) * wxSpeedMul(sv._weather, level);
                p.kind = partKind;
            } else if (p.x < camX - 60 || p.x > camX + W + 60 || p.y < camY - 80 || p.y > camY + H + 80) {
                const c = colsOf(i, n, genXSpan, H);
                p.x = camX + (windH >= 0 ? -40 : W + 40) + (Math.random() - 0.5) * 40;
                p.y = camY + (c.gx + 0.5) * (H / c.cols) + (Math.random() - 0.5) * 16;
            }
            p.x += camDx + sandH * fdt;   // 相机平移 + 风向水平驱动（东风右、西风左）
            p.y += camDy + sandV * fdt + (Math.random() - 0.5) * 20 * fdt;   // 相机平移 + 轻微下沉/抖动
            const sx = p.x - camX, sy = p.y - camY;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - (windH >= 0 ? 1 : -1) * p.len, sy);
            ctx.stroke();
        }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
}

// ---------- 雷阵雨：闪电+全屏闪光（§13.2 确定性触发：sv.t 由 wsync 快照同步 → 双端同刻） ----------
export function drawThunder(ctx, sv, W, H) {
    if (!sv || sv._weather !== 'rain') return;
    if (sv._devGfx === 0) return;   // 低画质跳过（§7）
    const inten = wxIntensity(sv._weather, wxLevelCur(sv));
    if (!inten.flash) return;
    const seed = sv.world.seed;
    const PER = 5;   // 判定周期（秒）：每 5s 窗口最多一道闪电
    const win = Math.floor(sv.t / PER);
    const ph = sv.t - win * PER;
    if (hash2(seed, win | 0, 0x51E1) < 0.7) {   // 70% 窗口有闪电（确定性）
        const at = 0.15 + hash2(seed, win | 0, 0x31A9) * 1.45;   // 窗口内闪电时刻
        const dt2 = ph - at;
        if (dt2 >= 0 && dt2 < 0.2) {
            const a = (1 - dt2 / 0.2) * 0.8;
            ctx.fillStyle = `rgba(232,240,255,${a.toFixed(3)})`;   // 全屏闪白
            ctx.fillRect(0, 0, W, H);
            // 闪电枝（确定性随机位置竖折线）
            const lx = hash2(seed, win | 0, 0x71C3) * W;
            const bend = (hash2(seed, win | 0, 0x91E7) - 0.5) * 90;
            ctx.strokeStyle = `rgba(210,232,255,${Math.min(1, a * 1.3).toFixed(3)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(lx, 0);
            ctx.lineTo(lx + bend * 0.3, H * 0.3);
            ctx.lineTo(lx + bend, H * 0.55);
            ctx.lineTo(lx + bend * 0.7, H * 0.8);
            ctx.stroke();
        }
    }
}
