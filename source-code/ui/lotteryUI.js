// ============================================================
// 转盘抽奖界面（总框架 6.4 lotteryUI）
// - 圆形转盘画布 + 顶部固定红色指针
// - 概率扇形布局（角度 ∝ 权重）+ 概率公示面板
// - 转盘动画时长与 gachaSpin 音效精准同步，中奖扇区高亮
// ============================================================

import { LOTTERY_WHEELS, rollLottery, applyLotteryResult, getSectorProbabilities } from '../systems/lottery.js';
import AudioSystem from '../systems/audio.js';

const W = 960, H = 560;
const CX = 300, CY = 290, R = 205;
const DEFAULT_SPIN = 7.76; // gachaSpin.mp3 实测时长（秒），加载失败时的回退值

let overlay = null;

function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'lottery-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0, 0, 0, 0.82);
        display: flex; align-items: center; justify-content: center;
        font-family: "Microsoft YaHei", monospace;
    `;
    overlay.innerHTML = `
        <div style="position:relative;">
            <canvas id="lottery-canvas" width="${W}" height="${H}"
                style="max-width:96vw;max-height:92vh;background:#1a1a2e;border:3px solid #444;border-radius:12px;"></canvas>
            <div id="lottery-result" style="
                position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);
                font-size:26px;font-weight:bold;color:#FFD700;text-shadow:0 0 12px #FFD700;
                display:none;white-space:nowrap;"></div>
            <button id="lottery-ok" class="menu-btn" style="
                position:absolute;left:50%;bottom:6%;transform:translateX(-50%);
                padding:10px 44px;font-size:18px;display:none;">确 定</button>
            <div id="lottery-flash" style="
                position:absolute;inset:0;pointer-events:none;opacity:0;border-radius:12px;
                background:radial-gradient(circle at 30% 50%, rgba(255,235,150,0.95) 0%, rgba(255,180,60,0.55) 40%, rgba(255,140,0,0) 75%);"></div>
        </div>
    `;
    // 中奖文字弹入动画（只注入一次）
    if (!document.getElementById('lottery-fx-style')) {
        const style = document.createElement('style');
        style.id = 'lottery-fx-style';
        style.textContent = `
            @keyframes lotteryPop {
                0%   { transform: translate(-50%,-50%) scale(0.3); opacity: 0; }
                60%  { transform: translate(-50%,-50%) scale(1.25); opacity: 1; }
                100% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
            }`;
        document.head.appendChild(style);
    }
    document.body.appendChild(overlay);
    return overlay;
}

// 计算每个扇区的起止角度（弧度），从正上方开始顺时针排布
function computeAngles(sectors) {
    const total = sectors.reduce((s, x) => s + x.weight, 0);
    let a = -Math.PI / 2;
    return sectors.map(s => {
        const span = (s.weight / total) * Math.PI * 2;
        const entry = { start: a, span, end: a + span };
        a += span;
        return entry;
    });
}

function drawWheel(ctx, wheel, angles, rotation, winIndex = -1) {
    ctx.clearRect(0, 0, W, H);

    // 标题
    ctx.fillStyle = '#EEE';
    ctx.font = 'bold 22px "Microsoft YaHei", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(wheel.name, 24, 20);

    // 转盘本体
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(rotation);

    wheel.sectors.forEach((s, i) => {
        const { start, end } = angles[i];
        const isWin = i === winIndex;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, start, end);
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.globalAlpha = isWin ? 1 : (winIndex >= 0 ? 0.35 : 0.85);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.lineWidth = isWin ? 5 : 2;
        ctx.strokeStyle = isWin ? '#FFD700' : '#111';
        if (isWin) { ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 18; }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 扇区文字（沿半径方向）
        const mid = start + (end - start) / 2;
        ctx.save();
        ctx.rotate(mid);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#111';
        ctx.font = 'bold 14px "Microsoft YaHei", monospace';
        ctx.globalAlpha = winIndex >= 0 && !isWin ? 0.35 : 1;
        ctx.fillText(s.label, R - 14, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
    });

    // 中心圆
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#666';
    ctx.stroke();
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 16px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('抽', 0, 0);
    ctx.restore();

    // 顶部固定红色指针（不随转盘旋转）
    ctx.save();
    ctx.translate(CX, CY - R - 6);
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.lineTo(-13, 0);
    ctx.lineTo(13, 0);
    ctx.closePath();
    ctx.fillStyle = '#FF2222';
    ctx.shadowColor = '#FF0000';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();

    // 概率公示面板
    const probs = getSectorProbabilities(wheel.id);
    const px = 560, py = 74;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#AAA';
    ctx.font = 'bold 16px "Microsoft YaHei", monospace';
    ctx.fillText('概率公示（无保底）', px, py - 28);
    ctx.font = '14px "Microsoft YaHei", monospace';
    probs.forEach((p, i) => {
        const y = py + i * 40;
        ctx.fillStyle = p.color;
        ctx.fillRect(px, y - 7, 14, 14);
        ctx.fillStyle = '#DDD';
        ctx.fillText(`${p.label} ${p.range}`, px + 24, y);
        ctx.fillStyle = '#FFD700';
        ctx.textAlign = 'right';
        ctx.fillText(`${p.pct.toFixed(0)}%`, px + 330, y);
        ctx.textAlign = 'left';
    });
}

// 打开转盘：付款成功后由商店调用，onClose 在关闭时回调（刷新商店）
export function openLottery(wheelId, onClose) {
    const wheel = LOTTERY_WHEELS[wheelId];
    if (!wheel) return;
    if (!overlay) buildOverlay();
    overlay.style.display = 'flex';

    const canvas = overlay.querySelector('#lottery-canvas');
    const ctx = canvas.getContext('2d');
    const resultEl = overlay.querySelector('#lottery-result');
    const okBtn = overlay.querySelector('#lottery-ok');
    resultEl.style.display = 'none';
    okBtn.style.display = 'none';

    // 先按权重定结果，再反推指针停驻角度
    const result = rollLottery(wheelId);
    const angles = computeAngles(wheel.sectors);
    const win = angles[result.sectorIndex];
    const jitter = (Math.random() - 0.5) * win.span * 0.6;
    const stopOffset = -Math.PI / 2 - (win.start + win.span / 2) + jitter;
    const norm = ((stopOffset % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const finalRot = 5 * Math.PI * 2 + norm; // 5 整圈 + 停驻角

    // 动画时长 = 音效实际时长（音画同步）
    const D = AudioSystem.getSoundDuration('gachaSpin') || DEFAULT_SPIN;

    drawWheel(ctx, wheel, angles, 0);
    AudioSystem.playGachaSpin();

    const t0 = performance.now();
    let done = false;
    function frame(now) {
        const t = Math.min(1, (now - t0) / (D * 1000));
        const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic：快转慢停
        const rot = finalRot * ease;
        if (t < 1) {
            drawWheel(ctx, wheel, angles, rot);
            requestAnimationFrame(frame);
        } else if (!done) {
            done = true;
            drawWheel(ctx, wheel, angles, finalRot, result.sectorIndex);
            // 中奖：高亮 + 揭示音 + 存入背包
            AudioSystem.playUnlock();
            applyLotteryResult(result);

            // 整把武器：金色爆闪 + 大号发光弹入文字；重复转化时弱化一档
            const isWeapon = result.sector.type === 'weapon';
            resultEl.textContent = `获得 ${result.text}`;
            resultEl.style.fontSize = isWeapon ? '32px' : '26px';
            resultEl.style.color = isWeapon ? '#FFE97A' : '#FFD700';
            resultEl.style.textShadow = isWeapon
                ? '0 0 18px #FFD700, 0 0 44px #FFA500'
                : '0 0 12px #FFD700';
            resultEl.style.display = 'block';
            if (isWeapon) {
                resultEl.style.animation = 'none';
                void resultEl.offsetWidth; // 重启动画
                resultEl.style.animation = 'lotteryPop 0.6s ease-out';
                const flash = overlay.querySelector('#lottery-flash');
                flash.style.transition = 'none';
                flash.style.opacity = result.converted ? '0.45' : '0.9';
                void flash.offsetWidth;
                flash.style.transition = 'opacity 1.2s ease-out';
                flash.style.opacity = '0';
            }
            okBtn.style.display = 'block';
        }
    }
    requestAnimationFrame(frame);

    function close() {
        if (!done) return; // 转动中不可关闭
        overlay.style.display = 'none';
        okBtn.removeEventListener('click', close);
        if (onClose) onClose(result.text); // 回传抽中结果，商店播报
    }
    okBtn.addEventListener('click', close);
}

export default { open: openLottery };
