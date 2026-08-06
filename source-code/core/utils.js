// ============================================================
// 工具函数
// ============================================================

import { FIELD } from './constants.js';

// 行号 ↔ Y坐标
export function rowY(i) {
    return FIELD.top + FIELD.rowHeight * (i + 0.5);
}

export function yToRow(y) {
    const r = Math.floor((y - FIELD.top) / FIELD.rowHeight);
    return Math.max(0, Math.min(FIELD.rows - 1, r));
}

// 随机数
export function randInt(a, b) {
    return Math.floor(a + Math.random() * (b - a + 1));
}

export function pickWeighted(weights, rand = Math.random()) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = rand * total;
    for (const k in weights) {
        r -= weights[k];
        if (r <= 0) return k;
    }
    return Object.keys(weights)[0];
}

// 升级相关
export function levelInfo(lv, table) {
    return table.find(x => x.lv === lv) || table[0];
}

export function nextLevelInfo(lv, table) {
    return table.find(x => x.lv === lv + 1);
}

export function weaponMul(lv, multiplierTable) {
    return multiplierTable[Math.max(1, Math.min(lv, multiplierTable.length - 1))];
}

export function weaponDurCap(wMeta, lv) {
    return Math.round(wMeta.baseDurability * (1 + (lv - 1) * 0.2));
}

// 判定函数
export function isRowActive(r) {
    return FIELD.activeRows.includes(r);
}

export function randomActiveRow() {
    const arr = FIELD.activeRows;
    return arr[Math.floor(Math.random() * arr.length)];
}

// 简单日志防抖
let logTimer = 0;
export function setLogTimer(val) { logTimer = val; }
export function getLogTimer() { return logTimer; }

// 关卡进度计算
export function computeTotalKills(state, DIFFICULTY) {
    // 原版机制：整关出怪列表在开局时已预生成，总数直接查表
    if (state._levelSpawnList && state._levelSpawnList.length) {
        return state._levelSpawnList.reduce((a, c) => a + c.length, 0);
    }
    // 联机客人端：使用房主同步的总数
    if (state._cachedTotalKills) return state._cachedTotalKills;
    let total = 0;
    for (let w = 1; w <= state.maxWave; w++) {
        total += Math.max(1, Math.round((3 + w * 2) * DIFFICULTY.countMul));
    }
    return total;
}

// 显示昵称：玩家自改昵称（存档） > 账户名 > 默认；登录始终用账户名
export function displayName(saveData) {
    if (saveData && saveData.playerName) return saveData.playerName;
    if (typeof window !== 'undefined' && window.Net && window.Net.currentUser) {
        const u = window.Net.currentUser();
        if (u) return u;
    }
    return '戴夫';
}

// 铲子解锁判定（通关 1-4 奖励铲子，兼容 unlockedTools 显式解锁）
export function isShovelUnlocked(saveData) {
    if (!saveData) return false;
    if (saveData.cleared && saveData.cleared.includes('1-4')) return true;
    return !!(saveData.unlockedTools && saveData.unlockedTools.includes('shovel'));
}

// DOM工具
export function $(selector) {
    return document.querySelector(selector);
}

export function $$(selector) {
    return Array.from(document.querySelectorAll(selector));
}
