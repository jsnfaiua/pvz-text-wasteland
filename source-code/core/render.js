// ============================================================
// Canvas渲染系统
// ============================================================

import { FIELD, PICKUP_DEFS, PLANTS, ZOMBIES, WEAPONS, CANVAS_WIDTH, CANVAS_HEIGHT, CARD_ORDER } from './constants.js';
import { state, dave, dave2, mouse, saveData } from './state.js';
import { computeTotalKills, isShovelUnlocked } from './utils.js';
import { fitCanvasBacking, observeCanvasFit } from './canvasFit.js';

let ctx = null;

export function initCanvas(canvasEl) {
    ctx = canvasEl.getContext('2d');
    observeCanvasFit(canvasEl);
    return ctx;
}

// 主渲染入口
export function render(DIFFICULTY) {
    if (!ctx) return;

    fitCanvasBacking(ctx);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (state._preLaunch) {
        // 三拍均匀节奏：0s"准备" → 0.53s"种植" → 1.06s 开局（"植物！"同位置展示）
        const t = state._preLaunchT || 0;
        const text = t < 0.53 ? '准备' : '种植';
        const beatStart = t < 0.53 ? 0 : 0.53;
        const local = t - beatStart;
        // 弹入动效：文字从 1.6 倍速缩至 1 倍，红色发光脉动，轻微抖动营造紧张感
        const scale = local < 0.15 ? 1.6 - (local / 0.15) * 0.6 : 1;
        const glow = 12 + Math.sin(t * 12) * 8;
        const jx = local < 0.1 ? (Math.random() - 0.5) * 3 : 0;
        const jy = local < 0.1 ? (Math.random() - 0.5) * 3 : 0;
        ctx.save();
        ctx.translate(CANVAS_WIDTH / 2 + jx, CANVAS_HEIGHT / 2 + jy);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#FF3333';
        ctx.shadowColor = '#FF0000';
        ctx.shadowBlur = glow;
        ctx.font = 'bold 44px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0);
        ctx.restore();
        return;
    }

    // 右键瞄准：以玩家为中心轻微放大视角（缩放中心在玩家，射击方向不受影响）
    const curWDef = WEAPONS[dave.currentWeapon];
    const aimingNow = state.aiming && curWDef && curWDef.kind === 'ranged';
    ctx.save();
    if (aimingNow) {
        const s = curWDef.zoom || 1.12;
        ctx.translate(dave.x, dave.y);
        ctx.scale(s, s);
        ctx.translate(-dave.x, -dave.y);
    }

    drawField();
    drawPlantPreview();
    drawPlants();
    drawZombies();
    drawBullets();
    drawSuns();
    drawEffects();
    drawPickups();
    drawRewardCard();
    drawRewardBag();

    if (state.mp.active) drawPlayer(dave2, true);
    drawPlayer(dave, false);
    ctx.restore();
    drawOverlays(DIFFICULTY);
    drawRewardScreen();
    drawCrosshair(curWDef);

    // 联机击杀播报（右上角堆叠，渐隐）
    if (state.mp.active) {
        const feed = state.effects.filter(e => e.kind === 'killfeed').slice(-4);
        feed.forEach((e, i) => {
            const [who, what] = (e.label || '|').split('|');
            ctx.save();
            ctx.globalAlpha = Math.min(1, e.life / 0.8);
            ctx.fillStyle = '#FFD700';
            ctx.shadowColor = '#000';
            ctx.shadowBlur = 4;
            ctx.font = 'bold 13px "Microsoft YaHei", monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${who} 击杀了 ${what}`, CANVAS_WIDTH - 16, 60 + i * 20);
            ctx.restore();
        });
    }

    // 开局"植物！"提示（0.8s 淡出，不阻塞操作；红色发光+弹入+抖动，与"准备/种植"同一位置）
    if (state._postLaunch > 0) {
        const elapsed = 0.8 - state._postLaunch;
        const a = Math.min(1, state._postLaunch / 0.4);
        const scale = elapsed < 0.15 ? 1.7 - (elapsed / 0.15) * 0.7 : 1;
        const glow = 16 + Math.sin(elapsed * 14) * 10;
        const jx = elapsed < 0.25 ? (Math.random() - 0.5) * 4 : 0;
        const jy = elapsed < 0.25 ? (Math.random() - 0.5) * 4 : 0;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(CANVAS_WIDTH / 2 + jx, CANVAS_HEIGHT / 2 + jy);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#FF3333';
        ctx.shadowColor = '#FF0000';
        ctx.shadowBlur = glow;
        ctx.font = 'bold 44px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('植物！', 0, 0);
        ctx.restore();
    }

    // 大波次公告（"一大波僵尸来袭"/"最后一波"）：与"准备/种植/植物"同款红色发光弹入样式
    if (state._announce) {
        const elapsed = (performance.now() - state._announce.start) / 1000;
        const dur = 2.4;
        if (elapsed >= dur) {
            state._announce = null;
        } else {
            const a = elapsed > dur - 0.6 ? (dur - elapsed) / 0.6 : 1;
            const scale = elapsed < 0.15 ? 1.7 - (elapsed / 0.15) * 0.7 : 1;
            const glow = 16 + Math.sin(elapsed * 14) * 10;
            const jx = elapsed < 0.25 ? (Math.random() - 0.5) * 4 : 0;
            const jy = elapsed < 0.25 ? (Math.random() - 0.5) * 4 : 0;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(CANVAS_WIDTH / 2 + jx, CANVAS_HEIGHT / 2 + jy);
            ctx.scale(scale, scale);
            ctx.fillStyle = '#FF3333';
            ctx.shadowColor = '#FF0000';
            ctx.shadowBlur = glow;
            ctx.font = 'bold 44px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(state._announce.text, 0, 0);
            ctx.restore();
        }
    }
}

// 战场绘制
function drawField() {
    // 禁用行遮罩
    ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
    for (let i = 0; i < FIELD.rows; i++) {
        if (!FIELD.activeRows.includes(i)) {
            ctx.fillRect(FIELD.left, FIELD.top + FIELD.rowHeight * i, FIELD.right - FIELD.left, FIELD.rowHeight);
        }
    }

    // 分隔线
    ctx.strokeStyle = '#0a2a10';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    for (let i = 1; i < FIELD.rows; i++) {
        const y = FIELD.top + FIELD.rowHeight * i;
        ctx.beginPath();
        ctx.moveTo(FIELD.left, y);
        ctx.lineTo(FIELD.right, y);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // 小推车
    for (const r of FIELD.activeRows) {
        if (state.mowers[r]) {
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 14px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('[推]', FIELD.left - 18, FIELD.top + FIELD.rowHeight * (r + 0.5));
        }
    }

    // 左右边界
    ctx.strokeStyle = '#331111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(FIELD.left, FIELD.top);
    ctx.lineTo(FIELD.left, FIELD.bottom);
    ctx.stroke();

    ctx.strokeStyle = '#330000';
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.moveTo(FIELD.right, FIELD.top);
    ctx.lineTo(FIELD.right, FIELD.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // 行号
    ctx.fillStyle = '#222';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < FIELD.rows; i++) {
        ctx.fillText(`行${i + 1}`, 6, FIELD.top + FIELD.rowHeight * (i + 0.5));
    }
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// 种植预览
function drawPlantPreview() {
    if (state.selectedCard < 0 || dave.isJumping) return;
    const key = CARD_ORDER[state.selectedCard];
    const def = PLANTS[key];
    if (!def) return;

    let ok = state.sun >= def.cost && (state.cooldowns[key] || 0) <= 0;
    let reason = '';
    if (state.sun < def.cost) { ok = false; reason = '阳光不足'; }
    else if ((state.cooldowns[key] || 0) > 0) { ok = false; reason = '冷却中'; }
    for (const p of state.plants) {
        if (p.row === dave.row && Math.abs(p.x - dave.x) < 40) { ok = false; reason = '太挤'; }
    }
    if (dave.x < FIELD.left + 20 || dave.x > FIELD.right - 30) { ok = false; reason = '禁种区'; }

    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = ok ? def.color : '#FF4444';
    ctx.font = 'bold 18px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = FIELD.top + FIELD.rowHeight * (dave.row + 0.5);
    ctx.fillText(def.name, dave.x, y);
    if (!ok) {
        ctx.globalAlpha = 0.85;
        ctx.font = '10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#FF6666';
        ctx.fillText(reason, dave.x, y + 18);
    }
    ctx.restore();
}

// 植物
function drawPlants() {
    for (const p of state.plants) {
        const def = PLANTS[p.kind];
        ctx.save();
        const shakeX = p.shake > 0 ? (Math.random() - 0.5) * 3 : 0;
        ctx.fillStyle = def.color;
        ctx.font = 'bold 18px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(def.name, p.x + shakeX, p.y);

        // 联机：植物下方标注种植者昵称
        if (state.mp.active && p.owner) {
            const ownerName = p.owner === 'host' ? (state.mp.hostName || '房主') : (state.mp.guestName || '好友');
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.font = '9px "Microsoft YaHei", monospace';
            ctx.fillText(ownerName, p.x, p.y + 24);
        }

        // 等级角标
        if (p.lv && p.lv >= 2) {
            ctx.fillStyle = p.lv >= 5 ? '#FF88DD' : '#FFD700';
            ctx.font = 'bold 9px Consolas, monospace';
            ctx.shadowColor = ctx.fillStyle;
            ctx.shadowBlur = 6;
            ctx.fillText(p.lv >= 5 ? '★' : `L${p.lv}`, p.x + 18, p.y - 12);
            ctx.shadowBlur = 0;
        }

        if (p.hp < p.maxHp && p.kind !== 'cherry') {
            const w = 30;
            // 护甲条
            if ((p.armorHp || 0) > 0 && (p.maxArmorHp || 0) > 0) {
                const armorRatio = Math.max(0, p.armorHp / p.maxArmorHp);
                ctx.fillStyle = '#222';
                ctx.fillRect(p.x - w / 2, p.y + 12, w, 2);
                ctx.fillStyle = '#FFA500';
                ctx.fillRect(p.x - w / 2, p.y + 12, w * armorRatio, 2);
            }
            // 血量条
            const ratio = Math.max(0, p.hp / p.maxHp);
            const barY = (p.armorHp || 0) > 0 ? p.y + 16 : p.y + 14;
            ctx.fillStyle = '#222';
            ctx.fillRect(p.x - w / 2, barY, w, 3);
            ctx.fillStyle = ratio > 0.4 ? '#00FF00' : '#FF4444';
            ctx.fillRect(p.x - w / 2, barY, w * ratio, 3);
        }
        if (p.kind === 'cherry') {
            ctx.fillStyle = '#FF9999';
            ctx.font = '10px "Microsoft YaHei", monospace';
            ctx.fillText(p.fuseTimer.toFixed(1), p.x, p.y - 14);
        }
        if (p.kind === 'potatomine') {
            if (p.fuseTimer > 0) {
                ctx.fillStyle = '#FF9999';
                ctx.font = '10px "Microsoft YaHei", monospace';
                ctx.fillText(p.fuseTimer.toFixed(0) + 's', p.x, p.y - 14);
            } else if (p.armed && !p.exploded) {
                const flash = Math.floor(state.time * 3) % 2 === 0;
                ctx.fillStyle = flash ? '#FF4444' : '#FFD700';
                ctx.font = 'bold 14px "Microsoft YaHei", monospace';
                ctx.shadowColor = '#FF4444';
                ctx.shadowBlur = 8;
                ctx.fillText('!', p.x, p.y - 14);
                ctx.shadowBlur = 0;
            }
        }
        if (p._digesting) {
            ctx.fillStyle = '#FF88CC';
            ctx.font = '10px "Microsoft YaHei", monospace';
            ctx.fillText('消化中', p.x, p.y - 14);
        }
        ctx.restore();
    }
}

// 僵尸
function drawZombies() {
    for (const z of state.zombies) {
        const def = ZOMBIES[z.kind];
        const displayName = z.armorBroken ? ZOMBIES.normal.name : def.name;
        ctx.save();
        ctx.fillStyle = z.hurtFlash > 0 ? '#FFFFFF' : (z._slowed ? '#88CCFF' : def.color);
        ctx.font = 'bold 18px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (z.hp / z.maxHp < 0.3) ctx.globalAlpha = 0.7;
        ctx.fillText(displayName, z.x, z.y);

        const w = 34;
        // 护甲条（橙色）
        if ((z.armorHp || 0) > 0 && (z.maxArmorHp || 0) > 0) {
            const armorRatio = Math.max(0, z.armorHp / z.maxArmorHp);
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#222';
            ctx.fillRect(z.x - w / 2, z.y + 12, w, 2);
            ctx.fillStyle = '#FFA500';
            ctx.fillRect(z.x - w / 2, z.y + 12, w * armorRatio, 2);
        }
        // 血量条（红色）
        const ratio = Math.max(0, z.hp / z.maxHp);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#222';
        ctx.fillRect(z.x - w / 2, z.y + 16, w, 3);
        ctx.fillStyle = '#FF4444';
        ctx.fillRect(z.x - w / 2, z.y + 16, w * ratio, 3);
        ctx.restore();
    }
}

// 子弹（超出有效射程的子弹变淡变小，提示伤害已衰减）
const BULLET_FONTS = {
    14: 'bold 14px "Microsoft YaHei", monospace',
    12: 'bold 12px "Microsoft YaHei", monospace',
    10: 'bold 10px "Microsoft YaHei", monospace',
    8: 'bold 8px "Microsoft YaHei", monospace',
};
function drawBullets() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of state.bullets) {
        const rg = b.range || 9999;
        const over = (b.traveled || 0) > rg;
        ctx.save();
        if (over) {
            const ratio = Math.min(1, ((b.traveled - rg) / rg));
            ctx.globalAlpha = Math.max(0.35, 1 - 0.6 * ratio);
        }
        const size = over ? 12 : 14;
        ctx.fillStyle = b.color;
        ctx.font = BULLET_FONTS[size];
        // 弹体随飞行方向旋转（狙击"—"、箭矢"→"等长条弹体不再恒水平）
        const ang = Math.atan2(b.vy || 0, b.vx || 1);
        // 穿透弹弹迹残影：弹尾拖 2 个渐隐副本（间距 18px，透明度 40%/15%）
        if ((b.pierce || 0) > 0) {
            const sp = Math.hypot(b.vx, b.vy || 0) || 1;
            const nx = b.vx / sp, ny = (b.vy || 0) / sp;
            for (let gi = 1; gi <= 2; gi++) {
                ctx.save();
                ctx.globalAlpha = gi === 1 ? 0.4 : 0.15;
                ctx.fillStyle = b.color;
                ctx.font = BULLET_FONTS[size - gi * 2];
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.translate(b.x - nx * 18 * gi, b.y - ny * 18 * gi);
                ctx.rotate(ang);
                ctx.fillText(b.label, 0, 0);
                ctx.restore();
            }
        }
        ctx.translate(b.x, b.y);
        // 飞刀：绘制刀形（刀刃+刀柄），顺飞行方向不旋转
        if (b.spin) {
            ctx.rotate(ang);
            ctx.lineCap = 'round';
            // 刀柄
            ctx.strokeStyle = '#6B4F2A';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-9, 0);
            ctx.lineTo(1, 0);
            ctx.stroke();
            // 护手
            ctx.strokeStyle = '#888';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(1, -3);
            ctx.lineTo(1, 3);
            ctx.stroke();
            // 刀刃
            ctx.strokeStyle = b.color || '#C0C0C0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(1, 0);
            ctx.lineTo(10, 0);
            ctx.stroke();
            ctx.restore();
            continue;
        }
        ctx.rotate(ang);
        ctx.fillText(b.label, 0, 0);
        ctx.restore();
    }
}

// 阳光
function drawSuns() {
    for (const s of state.suns) {
        const flash = s.life < 3 && Math.floor(s.life * 6) % 2 === 0;
        ctx.save();
        ctx.fillStyle = flash ? '#FFF' : '#FFD700';
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 10;
        ctx.font = 'bold 20px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('阳', s.x, s.y);
        ctx.restore();
    }
}

// 特效
function drawEffects() {
    for (const e of state.effects) {
        const t = e.life / e.maxLife;
        ctx.save();
        if (e.kind === 'boom') {
            ctx.globalAlpha = t;
            ctx.strokeStyle = '#FF4400';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(e.x, e.y, e.radius * (1 - t) * 1.1, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#FF6633';
            ctx.font = 'bold 22px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('轰！', e.x, e.y);
        } else if (e.kind === 'hit') {
            ctx.globalAlpha = t;
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 14px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.label || '×', e.x, e.y);
        } else if (e.kind === 'muzzle') {
            // 枪口火光：沿射击方向的锥形短闪光
            ctx.globalAlpha = t;
            ctx.strokeStyle = e.color || '#FFDD66';
            ctx.fillStyle = e.color || '#FFDD66';
            ctx.shadowColor = e.color || '#FFDD66';
            ctx.shadowBlur = 10;
            ctx.lineWidth = 2;
            const ang = e.angle || 0;
            for (const off of [-0.35, 0, 0.35]) {
                const a = ang + off;
                ctx.beginPath();
                ctx.moveTo(e.x, e.y);
                ctx.lineTo(e.x + Math.cos(a) * (8 + 6 * t), e.y + Math.sin(a) * (8 + 6 * t));
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(e.x, e.y, 2.5 + 2 * t, 0, Math.PI * 2);
            ctx.fill();
            // 拟声字 + 沿弹道拖残影
            if (e.label) {
                ctx.font = 'bold 15px "Microsoft YaHei", monospace';
                ctx.textAlign = 'center';
                ctx.globalAlpha = t;
                const lx = e.x + Math.cos(ang) * 14, ly = e.y + Math.sin(ang) * 14 - 6;
                ctx.fillText(e.label, lx, ly);
                for (let gi = 1; gi <= (e.ghosts || 0); gi++) {
                    ctx.globalAlpha = t * (gi === 1 ? 0.5 : 0.25);
                    ctx.fillText(e.label, lx + Math.cos(ang) * 16 * gi, ly + Math.sin(ang) * 16 * gi);
                }
            }
        } else if (e.kind === 'mower') {
            // 不渐变：全程满透明度，行驶时长 1.57s 与 lawnmower.mp3 对齐
            ctx.globalAlpha = 1;
            const prog = 1 - t;
            const mx = FIELD.left + (FIELD.right - FIELD.left) * prog;
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 18px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('[推]', mx, e.y);
        } else if (e.kind === 'armorBreak') {
            ctx.globalAlpha = t;
            ctx.fillStyle = '#FFD700';
            ctx.shadowColor = '#FF8800';
            ctx.shadowBlur = 8;
            ctx.font = 'bold 16px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('破甲', e.x, e.y - (1 - t) * 30);
        } else if (e.kind === 'sunfly') {
            ctx.globalAlpha = t;
            const prog = Math.min(1, 1 - t + 0.1);
            const fx = e.x + (e.tx - e.x) * prog;
            const fy = e.y + (e.ty - e.y) * prog;
            ctx.fillStyle = '#FFD700';
            ctx.shadowColor = '#FFA500';
            ctx.shadowBlur = 6;
            ctx.font = 'bold 16px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('阳', fx, fy);
            ctx.shadowBlur = 0;
        } else if (e.kind === 'coinfly') {
            // 钱币从钱袋飞向货币显示位置（与 sunfly 同款插值）
            ctx.globalAlpha = t;
            const prog = Math.min(1, 1 - t + 0.1);
            const fx = e.x + (e.tx - e.x) * prog;
            const fy = e.y + (e.ty - e.y) * prog;
            ctx.fillStyle = e.color || '#FFD700';
            ctx.shadowColor = e.color || '#FFD700';
            ctx.shadowBlur = 8;
            ctx.font = 'bold 15px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.label || '银', fx, fy);
            ctx.shadowBlur = 0;
        } else if (e.kind === 'coinburst') {
            // 拾取瞬间：对应货币颜色的粒子向四周散开
            const prog = 1 - t;
            ctx.globalAlpha = Math.min(1, t * 1.6);
            ctx.fillStyle = e.color || '#FFD700';
            ctx.shadowColor = e.color || '#FFD700';
            ctx.shadowBlur = 6;
            ctx.font = 'bold 11px Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const s of (e.seeds || [])) {
                ctx.fillText('·', e.x + s.dx * prog * 18, e.y + s.dy * prog * 18);
            }
            ctx.shadowBlur = 0;
        } else if (e.kind === 'sunpop') {
            ctx.globalAlpha = t;
            const offY = (1 - t) * 16;
            ctx.fillStyle = '#FFD700';
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 6;
            ctx.font = 'bold 12px Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.label, e.x, e.y - offY);
        } else if (e.kind === 'dead') {
            ctx.globalAlpha = t;
            ctx.fillStyle = '#666';
            ctx.font = '16px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.label || '碎', e.x, e.y - (1 - t) * 20);
        } else if (e.kind === 'pickup') {
            ctx.globalAlpha = t;
            ctx.fillStyle = '#FFD700';
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 8;
            ctx.font = 'bold 14px "Microsoft YaHei", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.label, e.x, e.y - (1 - t) * 30);
        }
        ctx.restore();
    }
}

// 拾取物
function drawPickups() {
    for (const p of state.pickups) {
        const def = PICKUP_DEFS[p.kind];
        if (!def) continue;
        const hop = Math.sin((p.hopPhase || 0)) * 3;
        const flashing = p.life < 3 && Math.floor(p.life * 6) % 2 === 0;
        ctx.save();
        ctx.fillStyle = flashing ? '#FFFFFF' : def.color;
        ctx.shadowColor = def.shadow;
        ctx.shadowBlur = 10;
        ctx.font = 'bold 16px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(def.label, p.x, p.y + hop);
        if (p.amount > 1) {
            ctx.shadowBlur = 0;
            ctx.font = 'bold 10px Consolas, monospace';
            ctx.fillStyle = '#FFF';
            ctx.fillText(`×${p.amount}`, p.x + 12, p.y + hop + 8);
        }
        if (p.kind === 'fragment' && p.extra) {
            const plantDef = PLANTS[p.extra];
            if (plantDef) {
                ctx.shadowBlur = 0;
                ctx.font = '9px "Microsoft YaHei", monospace';
                ctx.fillStyle = plantDef.color;
                ctx.fillText(plantDef.name.charAt(0), p.x, p.y + hop - 12);
            }
        }
        ctx.restore();
    }
}

// 玩家绘制
function drawPlayer(player, isP2) {
    // 闪避残影
    if (player.dashGhosts && player.dashGhosts.length) {
        ctx.save();
        ctx.font = 'bold 20px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const g of player.dashGhosts) {
            ctx.globalAlpha = g.alpha;
            ctx.fillStyle = isP2 ? '#66FFCC' : '#88FFAA';
            ctx.fillText(player.label, g.x, g.y);
        }
        ctx.restore();
    }

    // 奔跑拖尾
    if (player.sprinting && !state.gameOver) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = player.color;
        ctx.font = 'bold 20px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(player.label, player.x - player.facing * 12, player.y - player.jumpOffset);
        ctx.restore();
    }

    // 跳跃残影
    if (player.ghost) {
        ctx.save();
        ctx.globalAlpha = player.ghost.alpha;
        ctx.fillStyle = '#004422';
        ctx.font = 'bold 20px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(player.label, player.ghost.x, player.ghost.y);
        ctx.restore();
    }

    const y = player.y - player.jumpOffset;
    const drawX = player.x + player.recoil;

    ctx.save();

    // 阵亡旋转
    if (state.gameOver && !state.victory) {
        ctx.translate(drawX, y);
        ctx.rotate(player.deathRot);
        ctx.translate(-drawX, -y);
        ctx.fillStyle = '#888';
    } else {
        ctx.fillStyle = player.hurtFlash > 0 ? '#FF4444' : player.color;
    }

    ctx.font = 'bold 20px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (player.isJumping) {
        ctx.shadowColor = player.color;
        ctx.shadowBlur = 12;
    }
    if (state.gameOver && state.victory) {
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 16;
    }
    ctx.fillText(player.label, drawX, y);
    ctx.restore();

    // 头顶血条
    const hpPct = Math.max(0, player.hp / (player.maxHp || 200));
    const barW = 36;
    const barX = drawX - barW / 2;
    const barY = y - 20;
    ctx.fillStyle = '#222';
    ctx.fillRect(barX, barY, barW, 3);
    ctx.fillStyle = hpPct > 0.5 ? '#44FF44' : hpPct > 0.25 ? '#FFAA00' : '#FF4444';
    ctx.fillRect(barX, barY, barW * hpPct, 3);

    // 头盔护甲条（血条上方：路障橙/铁桶灰）
    if (player.armor && player.armor.hp > 0) {
        const aPct = Math.max(0, player.armor.hp / (player.armor.maxHp || 1));
        ctx.fillStyle = '#222';
        ctx.fillRect(barX, barY - 5, barW, 3);
        ctx.fillStyle = player.armor.type === 'bucket' ? '#AAAAAA' : '#FF8800';
        ctx.fillRect(barX, barY - 5, barW * aPct, 3);
    }

    // 跳跃提示
    if (player.isJumping && player.jumpOffset > 40) {
        ctx.fillStyle = '#88FFAA';
        ctx.font = '12px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('跃！', drawX + 24, y - 14);
    }

    // 胜利星
    if (state.gameOver && state.victory) {
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 14px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('★', drawX, y - 22);
    }

    // 力竭汗滴：头顶 3 颗汗珠循环浮落
    if (player.exhausted) {
        const tt = performance.now() / 1000;
        ctx.save();
        ctx.textAlign = 'center';
        for (let i = 0; i < 3; i++) {
            const phase = (tt * 0.9 + i / 3) % 1;
            const hx = drawX - 10 + i * 10 + Math.sin(tt * 2 + i) * 2;
            const hy = y - 26 - phase * 14;
            ctx.globalAlpha = 1 - phase;
            ctx.fillStyle = '#66BBFF';
            ctx.beginPath();
            ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
            ctx.fill();
            // 汗珠尖尾
            ctx.beginPath();
            ctx.moveTo(hx, hy - 4.5);
            ctx.lineTo(hx - 1.8, hy - 1);
            ctx.lineTo(hx + 1.8, hy - 1);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    // 挥砍（仅近战武器；按武器攻击方式绘制差异化特效）
    if (player.swingTimer > 0 && player.swingWeapon && WEAPONS[player.swingWeapon]?.kind === 'melee') {
        const w = WEAPONS[player.swingWeapon] || { color: player.color, name: '攻', arc: Math.PI * 0.6, reach: 40 };
        const t = player.swingTimer / 0.22; // 1 → 0
        const prog = 1 - t; // 0 → 1 挥砍进度
        const reach = (w.reach || 40) * (1 - t * 0.3);
        const arc = w.arc || Math.PI * 0.6;
        const dir = player.swingDir;
        const style = w.attackStyle || 'slash';
        const color = w.color || '#AAA';

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.textAlign = 'center';

        if (style === 'thrust') {
            // 长矛两段式：前半程刺出（枪尖快速延伸到底），后半程顺势挥击（短弧横扫）
            if (prog < 0.5) {
                const p2 = prog / 0.5;
                const len = reach * (0.35 + 0.65 * p2); // 刺出：枪线快速伸长
                const tipX = drawX + Math.cos(dir) * len;
                const tipY = y + Math.sin(dir) * len;
                ctx.globalAlpha = 0.9;
                ctx.lineWidth = 2;
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.moveTo(drawX + Math.cos(dir) * 14, y + Math.sin(dir) * 14);
                ctx.lineTo(tipX, tipY);
                ctx.stroke();
                // 枪尖芒刺
                ctx.globalAlpha = 1;
                ctx.beginPath();
                ctx.arc(tipX, tipY, 3 + p2 * 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const p2 = (prog - 0.5) / 0.5;
                const arcW = Math.PI * 0.5;
                const a0 = dir - arcW / 2;
                const sweep = a0 + arcW * p2; // 挥击：横扫短弧
                ctx.globalAlpha = (1 - p2) * 0.9;
                ctx.lineWidth = 3;
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(drawX, y, reach * 0.85, a0, sweep);
                ctx.stroke();
                const tipX = drawX + Math.cos(sweep) * reach * 0.85;
                const tipY = y + Math.sin(sweep) * reach * 0.85;
                // 挥击端点芒点
                ctx.globalAlpha = 1 - p2;
                ctx.beginPath();
                ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (style === 'stab') {
            // 直刺：短剑——短促的直线突进 + 小芒点
            const ex = drawX + Math.cos(dir) * reach * 0.8;
            const ey = y + Math.sin(dir) * reach * 0.8;
            ctx.globalAlpha = t * 0.95;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(drawX + Math.cos(dir) * reach * 0.3, y + Math.sin(dir) * reach * 0.3);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(ex, ey, 2 + prog * 2.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (style === 'chop') {
            // 重劈：战斧——纵向重弧，落点砸出冲击闪光
            const a0 = dir - arc * 0.7;
            const a1 = dir + arc * 0.3;
            const sweep = a0 + (a1 - a0) * prog; // 单向劈落
            ctx.globalAlpha = t * 0.9;
            ctx.lineWidth = 4;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(drawX, y, reach * 0.85, a0, sweep);
            ctx.stroke();
            // 落点冲击闪光
            const impX = drawX + Math.cos(sweep) * reach * 0.85;
            const impY = y + Math.sin(sweep) * reach * 0.85;
            ctx.globalAlpha = t;
            ctx.beginPath();
            ctx.arc(impX, impY, 4 + prog * 6, 0, Math.PI * 2);
            ctx.fill();
        } else if (style === 'punch') {
            // 直拳：拳头——短促拳影 + 落点环形气浪（无刃光，与武器明显区分）
            const ex = drawX + Math.cos(dir) * reach * 0.75;
            const ey = y + Math.sin(dir) * reach * 0.75;
            ctx.globalAlpha = t * 0.9;
            ctx.lineWidth = 2;
            ctx.shadowBlur = 4;
            // 拳影（两个递进的圆）
            ctx.beginPath();
            ctx.arc(ex, ey, 4 + prog * 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = t * 0.5;
            ctx.beginPath();
            ctx.arc(ex - Math.cos(dir) * 8, ey - Math.sin(dir) * 8, 3 + prog * 2, 0, Math.PI * 2);
            ctx.stroke();
            // 落点气浪环
            ctx.globalAlpha = t * 0.7;
            ctx.beginPath();
            ctx.arc(ex, ey, 6 + prog * 8, 0, Math.PI * 2);
            ctx.stroke();
        } else if (style === 'dig') {
            // 铲挖：铲子——小弧刨土 + 飞溅土点（工具感，不是武器挥砍）
            const a0 = dir - arc * 0.5;
            const sweep = a0 + arc * prog;
            ctx.globalAlpha = t * 0.85;
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(drawX, y, reach * 0.7, a0, sweep);
            ctx.stroke();
            // 刨出的土点（3 颗棕色小点向外飞）
            const sx = drawX + Math.cos(sweep) * reach * 0.7;
            const sy = y + Math.sin(sweep) * reach * 0.7;
            ctx.fillStyle = '#8B5A2B';
            for (let i = 0; i < 3; i++) {
                const sa = dir + (i - 1) * 0.45;
                const sd = 4 + prog * 12;
                ctx.beginPath();
                ctx.arc(sx + Math.cos(sa) * sd, sy + Math.sin(sa) * sd, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            // 横扫（默认/长剑）：圆弧挥过，长剑弧更大更亮
            const sweep = dir - arc / 2 + arc * prog;
            const isSword = style === 'slash' && player.swingWeapon === 'sword';
            ctx.globalAlpha = t * 0.9;
            ctx.lineWidth = isSword ? 3 : 2;
            ctx.shadowBlur = isSword ? 14 : 8;
            ctx.beginPath();
            ctx.arc(drawX, y, reach, dir - arc / 2, sweep);
            ctx.stroke();
            const tipX = drawX + Math.cos(sweep) * reach;
            const tipY = y + Math.sin(sweep) * reach;
            // 挥砍端点芒点（不出字）
            ctx.globalAlpha = t;
            ctx.beginPath();
            ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // 格挡盾
    if (player.guarding) {
        const isPerfect = player.guardTimer <= 0.3;
        const face = player.guardFacing || 0;
        ctx.save();
        ctx.translate(drawX, y);
        ctx.rotate(face);
        ctx.strokeStyle = isPerfect ? '#FFEE66' : '#88CCFF';
        ctx.lineWidth = isPerfect ? 4 : 3;
        ctx.shadowColor = isPerfect ? '#FFEE66' : '#88CCFF';
        ctx.shadowBlur = isPerfect ? 16 : 8;
        ctx.beginPath();
        ctx.arc(24, 0, 12, -Math.PI * 0.55, Math.PI * 0.55);
        ctx.stroke();
        ctx.restore();
    }

    // 完美格挡闪光
    if (player.perfectFlash > 0) {
        ctx.save();
        ctx.globalAlpha = player.perfectFlash / 0.4;
        ctx.strokeStyle = '#FFEE66';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#FFEE66';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(drawX, y, 26 + (1 - player.perfectFlash / 0.4) * 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

// 屏幕覆盖
function drawOverlays(DIFFICULTY) {
    if (!state._trActive) drawProgressBar(DIFFICULTY); // 训练营无波次概念，隐藏进度条

    if (!state._trActive && !state.waveActive && !state.gameOver && state.wave <= state.maxWave) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '14px "Microsoft YaHei", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`下一波: ${Math.ceil(state.waveTimer)}s`, FIELD.right - 8, FIELD.top - 22);
        ctx.restore();
    }

    if (state.gameOver && !state.victory) {
        // 失败结算（胜利由卡片拾取/结算页流程覆盖）
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = '#FF3333';
        ctx.font = 'bold 48px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('失  败', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
        ctx.fillStyle = '#AAA';
        ctx.font = '16px "Microsoft YaHei", monospace';
        ctx.fillText('按 ESC 返回菜单', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30);
    }

    drawWeaponStatus();
}

// 准星（仅当前持远程武器且鼠标在画布内时显示；散布圈大小随散射率/瞄准状态变化）
let _lastCursor = null;
function drawCrosshair(wDef) {
    const canvas = ctx.canvas;
    const show = wDef && wDef.kind === 'ranged' && mouse.inside && !state.gameOver && !state.paused;
    const cursor = show ? 'none' : '';
    if (cursor !== _lastCursor) {
        _lastCursor = cursor;
        canvas.style.cursor = cursor;
    }
    if (!show) return;

    const x = mouse.x, y = mouse.y;

    // 狙击镜：大圆镜框 + 十字长线 + 镜外暗角
    if (state.aiming && wDef.scope) {
        const R = 170;
        ctx.save();
        // 镜外暗角
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.arc(x, y, R, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        // 镜框
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.stroke();
        // 十字线
        ctx.strokeStyle = dave.reloading ? '#FF6666' : 'rgba(240,240,240,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - R, y); ctx.lineTo(x - 6, y);
        ctx.moveTo(x + 6, y); ctx.lineTo(x + R, y);
        ctx.moveTo(x, y - R); ctx.lineTo(x, y - 6);
        ctx.moveTo(x, y + 6); ctx.lineTo(x, y + R);
        ctx.stroke();
        // 中心点
        ctx.fillStyle = '#FF4444';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    const spread = (wDef.spread || 0) * (state.aiming ? (wDef.aimFactor ?? 0.35) : 1);
    const gap = 6 + spread * 70;           // 散布圈开口
    const len = 7;                          // 准星刻度长度
    const color = dave.reloading ? '#FF6666' : (wDef.color || '#FFFFFF');

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    // 四向刻度
    ctx.beginPath();
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.stroke();
    // 中心点
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// 武器状态面板（底部草坪外安全条 y500~540）：双槽 + 当前武器 + 弹匣/备弹 + 射击模式 + 换弹/蓄力提示
// 全部内容压缩在草坪下边界（FIELD.bottom）以下的两行内，不遮挡第五行
function drawWeaponStatus() {
    const melee = dave.equippedMelee, ranged = dave.equippedRanged;
    const hasShovel = isShovelUnlocked(saveData);
    const cur = dave.currentWeapon;
    const w = WEAPONS[cur];

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '12px "Microsoft YaHei", monospace';

    const line1 = [], line2 = [];
    if (melee || ranged || hasShovel) {
        // 第一行：槽位概览（当前槽高亮）
        if (melee) line1.push({ text: `${cur === melee ? '▶' : ' '}近战 ${WEAPONS[melee].name}   `, color: cur === melee ? '#FFD700' : '#777' });
        if (ranged) {
            let t = `${cur === ranged ? '▶' : ' '}远程 ${WEAPONS[ranged].name}`;
            if (cur === ranged && dave.magAmmo != null) {
                const reserve = state._trInfAmmo ? '∞' : (state.reserveAmmo?.[WEAPONS[ranged].ammoType] || 0);
                t += `  ${dave.magAmmo}/${reserve}`;
            }
            line1.push({ text: t + '   ', color: cur === ranged ? '#FFD700' : '#777' });
        }
        if (hasShovel) line1.push({ text: `${cur === 'shovel' ? '▶' : ' '}工具 铲子（C）`, color: cur === 'shovel' ? '#B87333' : '#777' });
        // 第二行：模式/换弹/蓄力/切枪提示
        if (w && cur === ranged) {
            if (dave.reloading) line2.push({ text: '换弹中...   ', color: '#FF6666' });
            else if (w.scope) line2.push({ text: state.aiming ? '已开镜（右键关镜）   ' : '右键 开镜   ', color: '#C58AFF' });
            else if (w.modes?.length > 1) line2.push({ text: `${dave.fireMode === 'auto' ? '全自动' : '半自动'}（V 切换）   `, color: '#88CCFF' });
            else if (w.chargeable) line2.push({ text: '按住左键蓄力   ', color: '#88CCFF' });
        }
        if (melee && ranged) line2.push({ text: 'X 切换武器', color: '#555' });
    }

    const drawSegs = (segs, y) => {
        let x = FIELD.left + 4;
        for (const s of segs) {
            ctx.fillStyle = s.color;
            ctx.fillText(s.text, x, y);
            x += ctx.measureText(s.text).width;
        }
    };
    drawSegs(line1, FIELD.bottom + 16);
    drawSegs(line2, FIELD.bottom + 34);
    // 体力条由底部 HTML 栏常驻显示，Canvas 不再重复绘制
    ctx.restore();

    // 弓箭蓄力条（自己/队友头顶，联机队友蓄力镜像也能看到）
    for (const p of [dave, dave2]) {
        const pw = WEAPONS[p.currentWeapon];
        if (!p.charging || !pw?.chargeable) continue;
        const ratio = Math.min(1, (p.chargeT || 0) / (pw.maxCharge || 1));
        const bx = p.x - 20, by = p.y - (p.jumpOffset || 0) - 34;
        ctx.save();
        ctx.fillStyle = '#222';
        ctx.fillRect(bx, by, 40, 5);
        ctx.fillStyle = ratio >= 1 ? '#FFD700' : '#FFAA33';
        ctx.fillRect(bx, by, 40 * ratio, 5);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, 40, 5);
        ctx.restore();
    }
}

// 重打/联机胜利掉落的钱袋（与植物卡片同款发光实体，走近拾取）
function drawRewardBag() {
    const bag = state._rewardBag;
    if (!bag) return;
    const t = bag.t || 0;
    const floatY = Math.sin(t * 2.2) * 4;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const w = 64, h = 64;
    const x = bag.x - w / 2, y = bag.y - h / 2 + floatY;

    ctx.save();
    // 金色光晕脉动
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 10 + pulse * 14;
    ctx.fillStyle = '#FFF8DC';
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
    // 黑边框
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    // 钱袋字符
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#DAA520';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 30px "Microsoft YaHei", monospace';
    ctx.fillText('袋', bag.x, y + h / 2);
    ctx.shadowBlur = 0;
    // 拾取提示（闪烁）
    ctx.globalAlpha = 0.35 + 0.65 * pulse;
    ctx.fillStyle = '#FFD700';
    ctx.font = '13px "Microsoft YaHei", monospace';
    ctx.fillText('走过去拾取钱袋', bag.x, y - 14);
    ctx.restore();
}

// 末杀位置掉落的新植物卡片（黑边框实体卡，戴夫走过去拾取）
function drawRewardCard() {
    const card = state._rewardCard;
    if (!card) return;
    const plant = card.plant;
    const t = card.t || 0;
    const floatY = Math.sin(t * 2.2) * 4;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const w = 70, h = 90;
    const x = card.x - w / 2, y = card.y - h / 2 + floatY;

    ctx.save();
    // 金色光晕脉动
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 10 + pulse * 14;
    ctx.fillStyle = '#FFF';
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
    // 黑边框
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    // 植物字符 + 名称
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = plant.color || '#FFD700';
    ctx.font = 'bold 26px "Microsoft YaHei", monospace';
    ctx.fillText(plant.label || '?', card.x, y + 32);
    ctx.fillStyle = '#333';
    ctx.font = '12px "Microsoft YaHei", monospace';
    ctx.fillText(plant.name || '', card.x, y + 66);
    // 拾取提示（闪烁）
    ctx.globalAlpha = 0.35 + 0.65 * pulse;
    ctx.fillStyle = '#FFD700';
    ctx.font = '13px "Microsoft YaHei", monospace';
    ctx.fillText('走过去拾取', card.x, y - 14);
    ctx.restore();
}

// 进度条
// 平滑显示进度：实际进度按击杀瞬时跳动，显示值每帧向其缓动，视觉上更缓和
let _smoothProgress = 0, _smoothT = 0;

function drawProgressBar(DIFFICULTY) {
    const barLeft = FIELD.left + 40;
    const barRight = FIELD.right - 40;
    const barY = 20;
    const totalKills = computeTotalKills(state, DIFFICULTY);
    const actual = totalKills > 0 ? Math.min(1, state.killedTotal / totalKills) : 0;

    // 缓动推进显示进度（开局/重开时直接归零对齐）
    const now = performance.now();
    const dt = Math.min(0.05, (now - _smoothT) / 1000) || 0;
    _smoothT = now;
    if ((state.time || 0) < 0.5) _smoothProgress = actual;
    _smoothProgress += (actual - _smoothProgress) * Math.min(1, dt * 2.5);
    const progress = _smoothProgress;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = '13px "Microsoft YaHei", monospace';

    // 轨道底线
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(barLeft, barY);
    ctx.lineTo(barRight, barY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 已完成部分
    const headX = barLeft + (barRight - barLeft) * progress;
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barLeft, barY);
    ctx.lineTo(headX, barY);
    ctx.stroke();

    // 起点
    ctx.fillStyle = '#00FF88';
    ctx.textAlign = 'center';
    ctx.fillText('家', barLeft - 12, barY);

    // 波次节点：只在大波次（每 10 波）和最终波画旗帜，普通波不画
    for (let w = 1; w <= state.maxWave; w++) {
        const isBig = w % 10 === 0;
        const isLast = w === state.maxWave;
        if (!isBig && !isLast) continue;

        const px = barLeft + (barRight - barLeft) * (w / state.maxWave);
        const passed = w < state.wave || (w === state.wave && !state.waveActive && state.zombies.length === 0);
        const isCurrent = w === state.wave;

        ctx.strokeStyle = passed ? '#00AA55' : (isLast ? '#661111' : '#333');
        ctx.lineWidth = isBig || isLast ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(px, barY - 5);
        ctx.lineTo(px, barY + 5);
        ctx.stroke();

        let flagColor, flagText;
        if (isLast) {
            flagColor = passed ? '#00FF88' : '#FF3333';
            flagText = '旗！';
        } else {
            flagColor = passed ? '#00AA55' : (isCurrent ? '#FFD700' : '#555');
            flagText = '旗';
        }
        ctx.fillStyle = flagColor;
        ctx.font = (isCurrent || isLast) ? 'bold 12px "Microsoft YaHei", monospace' : '11px "Microsoft YaHei", monospace';
        ctx.fillText(flagText, px, barY - 12);
    }

    // 进度头
    if (!state.gameOver || state.victory) {
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = '#00FF88';
        ctx.shadowBlur = 8;
        ctx.font = 'bold 14px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('僵', headX, barY);
        ctx.shadowBlur = 0;
    }

    ctx.fillStyle = '#666';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${state.killedTotal} / ${totalKills}`, barRight + 8, barY + 10);
    ctx.restore();
}

// 圆角矩形路径（兼容无 roundRect 的环境）
function rrPath(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawRewardScreen() {
    if (!state._showReward) return;
    const phase = state._rewardPhase;
    const plant = state._rewardPlant;
    const t = state._rewardT || 0;         // 当前阶段经过秒数
    const sceneT = state._rewardSceneT || 0; // 结算场景累计秒数（驱动微粒/呼吸）
    const W = CANVAS_WIDTH, H = CANVAS_HEIGHT;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ---- wipe：屏幕渐亮至纯白（0→1），完全遮盖局内 ----
    if (phase === 'wipe') {
        ctx.globalAlpha = Math.min(1, state._rewardAlpha || 0);
        ctx.fillStyle = '#FFF';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        return;
    }

    // ---- reveal：纯白过曝（渐变白过程保持干净，中间无任何元素，文字留到详情阶段渐显） ----
    if (phase === 'reveal') {
        ctx.fillStyle = '#FFF';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        return;
    }

    // ---- detail / summary：不透明深色结算场景 ----
    const lineA = (i) => Math.max(0, Math.min(1, (t - 0.2 - i * 0.09) / 0.25));
    const rise = (i) => (1 - lineA(i)) * 8; // 浮现时 8px 上飘

    // 背景：深藏青 + 中心径向金光晕
    ctx.fillStyle = '#0B1020';
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, 420);
    grad.addColorStop(0, 'rgba(255, 215, 0, 0.10)');
    grad.addColorStop(1, 'rgba(255, 215, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 上浮微粒
    if (state._rewardParticles) {
        for (const pt of state._rewardParticles) {
            const y = ((pt.y - sceneT * pt.v) % H + H) % H;
            ctx.globalAlpha = pt.o * (0.6 + 0.4 * Math.sin(sceneT * 2 + pt.x));
            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(pt.x, y, pt.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // 金边面板
    const px = 180, py = 64, pw = 600, ph = 388;
    ctx.save();
    ctx.shadowColor = 'rgba(255, 215, 0, 0.45)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#141B2E';
    rrPath(px, py, pw, ph, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFD700';
    rrPath(px, py, pw, ph, 16);
    ctx.stroke();
    ctx.restore();

    if (phase === 'detail' && plant) {
        const def = PLANTS[plant.id];

        // 主标题（呼吸金光）
        ctx.globalAlpha = lineA(0);
        ctx.fillStyle = '#FFD700';
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 12 + 6 * Math.sin(sceneT * 2.5);
        ctx.font = 'bold 30px "Microsoft YaHei", monospace';
        ctx.fillText('战斗胜利', W / 2, 108 + rise(0));
        ctx.shadowBlur = 0;

        ctx.globalAlpha = lineA(1);
        ctx.fillStyle = '#8A93AD';
        ctx.font = '14px "Microsoft YaHei", monospace';
        ctx.fillText('获 得 新 植 物', W / 2, 140 + rise(1));

        // 植物字符大图（本色发光 + 浮动）
        ctx.globalAlpha = lineA(2);
        ctx.fillStyle = plant.color || '#FFD700';
        ctx.shadowColor = plant.color || '#FFD700';
        ctx.shadowBlur = 18;
        ctx.font = 'bold 34px "Microsoft YaHei", monospace';
        ctx.fillText(plant.label + ' ' + plant.name, W / 2, 190 + Math.sin(sceneT * 2) * 3 + rise(2));
        ctx.shadowBlur = 0;

        // 属性 2×2 卡片
        const stats = [];
        if (def) {
            stats.push(['阳', `${def.cost}`, '#FFD700']);
            stats.push(['冷', `${def.cooldown}s`, '#66CCFF']);
            stats.push(['命', `${def.hp}`, '#7CFC00']);
            if (def.fireInterval) stats.push(['攻', `${def.fireInterval}s`, '#FF8888']);
            else if (def.produceInterval) stats.push(['产', `${def.produceInterval}s`, '#FFAA33']);
            else if (def.fuse) stats.push(['爆', `${def.fuse}s`, '#FF6666']);
        }
        stats.forEach(([icon, val, color], i) => {
            const col = i % 2, rowi = Math.floor(i / 2);
            const cx = W / 2 - 130 + col * 260 - 65, cy = 224 + rowi * 52;
            ctx.globalAlpha = lineA(3 + i);
            ctx.fillStyle = '#1B2440';
            rrPath(cx, cy, 130, 42, 8);
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#2E3A5E';
            rrPath(cx, cy, 130, 42, 8);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = 'bold 16px "Microsoft YaHei", monospace';
            ctx.fillText(icon, cx + 24, cy + 21);
            ctx.fillStyle = '#E6EAF5';
            ctx.fillText(val, cx + 78, cy + 21);
        });

        // 描述
        ctx.globalAlpha = lineA(7);
        ctx.fillStyle = '#9AA3BC';
        ctx.font = 'italic 13px "Microsoft YaHei", monospace';
        ctx.fillText(plant.desc || '', W / 2, 348 + rise(7));

        // 本局收获（各自配色）
        const rr = state.roundRewards;
        if (rr && (rr.silver || rr.gold || rr.gem)) {
            ctx.globalAlpha = lineA(8);
            ctx.font = 'bold 14px "Microsoft YaHei", monospace';
            const seg = [['本局收获 ', '#8A93AD'], [`银 ${rr.silver}`, '#C0C0FF'], [' · ', '#555'], [`金 ${rr.gold}`, '#FFD700'], [' · ', '#555'], [`钻 ${rr.gem}`, '#66FFFF']];
            let tw = 0;
            for (const [s] of seg) tw += ctx.measureText(s).width;
            let sx = W / 2 - tw / 2;
            ctx.textAlign = 'left';
            for (const [s, c] of seg) {
                ctx.fillStyle = c;
                ctx.fillText(s, sx, 384 + rise(8));
                sx += ctx.measureText(s).width;
            }
            ctx.textAlign = 'center';
        }
    } else if (phase === 'summary') {
        // 重打结算：标题 + 货币逐行 + 按钮
        ctx.globalAlpha = lineA(0);
        ctx.fillStyle = '#FFD700';
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 12 + 6 * Math.sin(sceneT * 2.5);
        ctx.font = 'bold 32px "Microsoft YaHei", monospace';
        ctx.fillText('战斗胜利', W / 2, 130 + rise(0));
        ctx.shadowBlur = 0;

        ctx.globalAlpha = lineA(1);
        ctx.fillStyle = '#8A93AD';
        ctx.font = '14px "Microsoft YaHei", monospace';
        ctx.fillText('本 局 收 获', W / 2, 170 + rise(1));

        const rr = state.roundRewards || { silver: 0, gold: 0, gem: 0 };
        const loot = [
            ['银', `× ${rr.silver}`, '#C0C0FF'],
            ['金', `× ${rr.gold}`, '#FFD700'],
            ['钻', `× ${rr.gem}`, '#66FFFF'],
        ];
        loot.forEach(([label, val, color], i) => {
            const cy = 218 + i * 52;
            ctx.globalAlpha = lineA(2 + i);
            ctx.fillStyle = '#1B2440';
            rrPath(W / 2 - 110, cy - 21, 220, 42, 8);
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#2E3A5E';
            rrPath(W / 2 - 110, cy - 21, 220, 42, 8);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;
            ctx.font = 'bold 18px "Microsoft YaHei", monospace';
            ctx.fillText(`${label}  ${val}`, W / 2, cy + rise(2 + i));
            ctx.shadowBlur = 0;
        });
    }

    // 底部按钮（两种结算页共用；点击区保持底部条）
    const btnA = phase === 'detail' ? lineA(9) : lineA(5);
    // 鼠标悬停交互：发光 + 放大
    const hovL = mouse.inside && mouse.x >= 190 && mouse.x <= 470 && mouse.y >= 466 && mouse.y <= 516;
    const hovR = state._rewardNextLevel && mouse.inside && mouse.x >= 490 && mouse.x <= 770 && mouse.y >= 466 && mouse.y <= 516;

    // 左：返回主菜单（暗色描边）
    ctx.save();
    ctx.globalAlpha = btnA;
    ctx.translate(330, 491);
    if (hovL) ctx.scale(1.07, 1.07);
    ctx.translate(-330, -491);
    ctx.fillStyle = hovL ? '#28335A' : '#1B2440';
    rrPath(190, 466, 280, 50, 10);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = hovL ? '#8FA0E8' : '#4A5578';
    if (hovL) { ctx.shadowColor = '#8FA0E8'; ctx.shadowBlur = 14; }
    rrPath(190, 466, 280, 50, 10);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = hovL ? '#FFFFFF' : '#C7D0E8';
    ctx.font = 'bold 18px "Microsoft YaHei", monospace';
    ctx.fillText(state.mp && state.mp.active ? '退出房间' : '返回主菜单', 330, 491);
    ctx.restore();

    // 右：下一关（绿色发光）
    if (state._rewardNextLevel) {
        ctx.save();
        ctx.globalAlpha = btnA;
        ctx.translate(630, 491);
        if (hovR) ctx.scale(1.07, 1.07);
        ctx.translate(-630, -491);
        ctx.fillStyle = hovR ? '#14593A' : '#0E3D24';
        rrPath(490, 466, 280, 50, 10);
        ctx.fill();
        ctx.strokeStyle = '#00FF88';
        ctx.shadowColor = '#00FF88';
        ctx.shadowBlur = hovR ? 20 : 10;
        rrPath(490, 466, 280, 50, 10);
        ctx.stroke();
        ctx.fillStyle = hovR ? '#AAFFD0' : '#00FF88';
        ctx.font = 'bold 18px "Microsoft YaHei", monospace';
        ctx.fillText('下一关', 630, 491);
        ctx.restore();
    }

    // 结算场景淡入时从纯白交叉淡化（前 0.35s）
    if (t < 0.35) {
        ctx.globalAlpha = 1 - t / 0.35;
        ctx.fillStyle = '#FFF';
        ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
}
const REVEAL_DUR = 0.35;
