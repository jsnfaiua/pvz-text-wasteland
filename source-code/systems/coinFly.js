// ============================================================
// 钱袋钱币飞行系统：拾取钱袋后，钱币一枚枚从袋里飞出，
// 平滑飞向局内货币显示位置，逐枚入账并播放拾取音效
// 单机 / 联机（各自账户各自入账）共用
// ============================================================

import { state } from '../core/state.js';
import { META, addCurrency } from '../persistence/storage.js';
import AudioSystem from './audio.js';

const COIN_STYLE = {
    silver: { label: '银', color: '#C0C0FF' },
    gold:   { label: '金', color: '#FFD700' },
    gem:    { label: '钻', color: '#66FFFF' },
};

// 局内货币显示位置（canvas 坐标）
export function currencyHudTarget() {
    const canvas = document.getElementById('game');
    if (!canvas) return { tx: 480, ty: 30 };
    const el = document.getElementById('coin-display');
    const cr = canvas.getBoundingClientRect();
    const sr = el ? el.getBoundingClientRect() : { left: 200, top: 20, width: 0, height: 0 };
    return {
        tx: (sr.left + sr.width / 2 - cr.left) * (canvas.width / cr.width),
        ty: (sr.top + sr.height / 2 - cr.top) * (canvas.height / cr.height),
    };
}

// 从 (x, y) 开始逐枚飞出 loot 中的钱币；已有钱币在飞时合并到同一批队列
export function startCoinFly(x, y, loot) {
    const { tx, ty } = currencyHudTarget();
    if (state._coinFly) {
        state._coinFly.queue.push(...loot);
        state._coinFly.x = x;
        state._coinFly.y = y;
        state._coinFly.tx = tx;
        state._coinFly.ty = ty;
    } else {
        state._coinFly = { queue: [...loot], active: [], x, y, tx, ty, timer: 0 };
    }
    AudioSystem.playCoinPickup();
}

// 每帧推进；creditToSelf=true 时钱币落袋即计入本机账户
// 返回 true 表示本帧全部飞完（调用方据此弹出结算/结束游戏）
// 注意：特效 life 由各处统一的全局衰减循环递减，这里只检测到站
export function updateCoinFly(dt, creditToSelf) {
    const cf = state._coinFly;
    if (!cf) return false;

    cf.timer -= dt;
    if (cf.queue.length && cf.timer <= 0) {
        cf.timer = 0.14; // 每 0.14s 飞出一枚
        const c = cf.queue.shift();
        const st = COIN_STYLE[c.kind] || COIN_STYLE.silver;
        const fx = {
            kind: 'coinfly', x: cf.x, y: cf.y, tx: cf.tx, ty: cf.ty,
            life: 0.55, maxLife: 0.55, label: st.label, color: st.color,
            _cfKind: c.kind, _cfAmount: c.amount, _local: true,
        };
        state.effects.push(fx);
        cf.active.push(fx);
    }

    for (let i = cf.active.length - 1; i >= 0; i--) {
        const fx = cf.active[i];
        if (fx.life > 0) continue; // 仍在飞行
        cf.active.splice(i, 1);
        if (creditToSelf) {
            addCurrency(META.currency, fx._cfKind, fx._cfAmount);
            if (state.roundRewards) state.roundRewards[fx._cfKind] += fx._cfAmount;
        }
        if (fx._cfKind === 'gem') AudioSystem.playGemPickup();
        else AudioSystem.playCoinPickup();
    }

    if (!cf.queue.length && !cf.active.length) {
        state._coinFly = null;
        return true;
    }
    return false;
}
