// ============================================================
// 【无尽植僵荒原】随机事件模块（停电夜 / 物资空投）
// 从 survival.js 拆出（v4.26）。宿主 update 主循环在 guest 分流后调用。
// 依赖：world.js（格子）/ wconst.js（TS）/ wzombie.js（稀有掉落）/ audio.js。
// log 通过 setLogger 注入（survival.js 的 log 含 mp 广播，避免循环依赖）。
// ============================================================

import { T, getTile, setTile, isWalk } from './world.js';
import { TS } from './wconst.js';
import * as WZ from './wzombie.js';
import AudioSystem from '../systems/audio.js';

let _logger = () => {};
export function setLogger(fn) { _logger = (typeof fn === 'function') ? fn : () => {}; }
function log(msg, color) { _logger(msg, color); }

// ---------- 随机事件（D）：停电夜 / 物资空投 ----------
// 沙尘暴已并入天气系统（sv._weather.sandstorm，每天确定性切换）。
// 每天 8:00 判定一次（天≥3，30% 触发）；事件进行中不触发下一个。
// sv._evt = { type, endT }（endT 按游戏时间 sv.now 秒）。运行时状态，联机经 wsync 快照同步。
const EVT_UNLOCK_DAY = 3;
const EVT_TRIGGER_CHANCE = 0.30;

export function updateEvents(sv, dt) {
    if (sv._evt) {
        if (sv.now >= sv._evt.endT) sv._evt = null;
        return;
    }
    const hour = (sv.t / sv.dayLen) * 24;
    if (sv._lastEvtHour != null && sv._lastEvtHour < 8 && hour >= 8 && sv.day >= EVT_UNLOCK_DAY && Math.random() < EVT_TRIGGER_CHANCE) {
        // v3.68 用户要求：开发者模式（sv._devGod）下不生成空投（airdrop）——避免作弊绕过正常事件频率。
        // 区域停电（blackout）仍可触发（仅空投屏蔽）。
        if (sv._devGod) return;
        const r = Math.random();
        if (r < 0.5) startEvent(sv, 'blackout');
        else startEvent(sv, 'airdrop');
    }
    sv._lastEvtHour = hour;
}

// export startEvent：让 wdev.js 可导入（手动触发空投/停电事件）
export function startEvent(sv, type) {
    if (type === 'blackout') {
        sv._evt = { type, endT: sv.now + 30 };
        sv.announce = { text: '⚡ 停电夜！视野受限', t: 2.5, color: '#8899BB' };
        AudioSystem.playWaveWarning();
    } else if (type === 'airdrop') {
        // v3.65 用户要求：空投物资包含地图上所有物资，稀有概率高。
        // 全部使用 WBOX（武器箱）外观统一（之后会替换）；每个箱 3~5 件稀有物资 + 50% 概率给传送宝石。
        const dropSites = [];
        for (let i = 0; i < 3; i++) {
            for (let tries = 0; tries < 10; tries++) {
                const ang = Math.random() * Math.PI * 2;
                const d = (10 + Math.random() * 4) * TS;
                const gx = Math.floor((sv.px + Math.cos(ang) * d) / TS);
                const gy = Math.floor((sv.py + Math.sin(ang) * d) / TS);
                const t = getTile(sv, gx, gy);
                if (isWalk(t) && t !== T.ROAD && t !== T.SIDEWALK) {
                    setTile(sv, gx, gy, T.WBOX);   // v3.65 统一外观：武器箱（之后会替换为专属空投箱 sprite）
                    // v3.65 物品更丰富：3~5 件，全部走 rare 路径（共享 B.ZOMBIE_LOOT_ALL 全字池，含地图所有物资）
                    const itemN = 3 + Math.floor(Math.random() * 3);   // 3~5
                    const items = [];
                    for (let j = 0; j < itemN; j++) {
                        const it = WZ.rollLootContents('rare');
                        if (it && it.length) items.push(...it);
                    }
                    if (Math.random() < 0.5) items.push({ id: 'tpgem', n: 1 });   // 50% 给传送宝石
                    sv.mods.boxLoot[gx + ',' + gy] = items;
                    dropSites.push({ gx, gy, kind: 'WBOX' });
                    break;
                }
            }
        }
        if (dropSites.length > 0) {
            sv._evt = { type, endT: sv.now + 5, dropSites };
            sv.announce = { text: `✈ 物资空投！附近 ${dropSites.length} 个武器箱（带光柱）`, t: 3, color: '#7DFF7D' };
            AudioSystem.playCollect();
        } else {
            sv._evt = null;
        }
    }
}
