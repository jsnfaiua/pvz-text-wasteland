// ============================================================
// 【无尽植僵荒原】模组 · 建造系统（放置/拆除/合法性判定）
// 从 survival.js 拆出，数值引用 wbalance.js
// ============================================================

import AudioSystem from '../systems/audio.js';
import { T, getTile, setTile, isWalk } from './world.js';
import { TS } from './wconst.js';
import { BUILD_ITEMS, BUILD_HP } from './render.js';
import * as Panel from './panel.js';
import * as WA from './waction.js';
import * as MSG from './wmsg.js';
import * as B from './wbalance.js';

function log(sv, msg, color) { MSG.pushMsg(sv, msg, color); }

export function buildOkAt(sv, gx, gy) {
    const ptx = sv.px / TS, pty = sv.py / TS;
    if (Math.hypot(gx + 0.5 - ptx, gy + 0.5 - pty) > B.BUILD_RANGE) return false;
    const t = getTile(sv, gx, gy);
    if (!isWalk(t)) return false;
    const bcx = Math.max(gx * TS, Math.min(sv.px, (gx + 1) * TS));
    const bcy = Math.max(gy * TS, Math.min(sv.py, (gy + 1) * TS));
    if (Math.hypot(sv.px - bcx, sv.py - bcy) < B.BUILD_COLLIDE_R) return false;
    for (const z of sv.zombies) {
        if (Math.abs(z.x - (gx + 0.5) * TS) < TS * 0.7 && Math.abs(z.y - (gy + 0.5) * TS) < TS * 0.7) return false;
    }
    // NPC 占位：不能在 NPC 身上建造（否则把 NPC 卡进建筑）
    if (sv.npcs) {
        for (const n of sv.npcs) {
            if (!n.alive) continue;
            if (Math.abs(n.x - (gx + 0.5) * TS) < TS * 0.7 && Math.abs(n.y - (gy + 0.5) * TS) < TS * 0.7) return false;
        }
    }
    // 停放车辆延伸格：锚点格已由 isWalk 拦截（T.CAR 不可走）；
    // 完好车横跨 2 格，第二格沿停放朝向延伸（m.dir 弧度），此处补查避免建造与车体重叠
    if (sv.mods && sv.mods.tiles) {
        for (const key in sv.mods.tiles) {
            const m = sv.mods.tiles[key];
            if (!m || m.t !== T.CAR || !m.repaired) continue;   // 报废车单格由 isWalk 拦，无需查延伸
            const [ax, ay] = key.split(',').map(Number);
            const fx = Math.round(Math.cos(m.dir || 0)), fy = Math.round(Math.sin(m.dir || 0));
            if (ax + fx === gx && ay + fy === gy) return false;
        }
    }
    return true;
}

export function placeBuild(sv, gx, gy, countItem, takeItem) {
    const bitem = BUILD_ITEMS[sv.buildSel];
    if (!bitem) return;
    const key = gx + ',' + gy;
    const existing = sv.mods.tiles[key];
    // 墙升级链（B1）：选中「木墙」对准已有 built 墙再放 → 石墙(lv2) → 金属墙(lv3)
    if (bitem.t === T.WALL && existing && existing.built && existing.t === T.WALL && (existing.lv || 1) < 3) {
        const lv = existing.lv || 1;
        const upg = bitem.upg && bitem.upg.find(u => u.lv === lv + 1);
        if (!upg) return;
        for (const [mat, n] of Object.entries(upg.cost)) {
            if (countItem(mat) < n) { log(sv, `材料不足：升级${upg.name}需要 ${Panel.getItemInfo(mat).name}×${n}`); return; }
        }
        for (const [mat, n] of Object.entries(upg.cost)) takeItem(mat, n);
        existing.lv = lv + 1;
        existing.hp = Math.round((BUILD_HP[T.WALL] || 300) * upg.hpMul);
        existing.maxHp = existing.hp;
        log(sv, `升级完成：${upg.name}（耐久 ${existing.hp}）`, '#7DFF7D');
        Panel.refresh(sv);
        return;
    }
    if (!buildOkAt(sv, gx, gy)) { log(sv, '这里不能建造（需 3 格内空地，且不能压住自己或僵尸）'); return; }
    if (sv.woodCount < bitem.cost) { log(sv, `木材不足：${bitem.name} 需要 木材×${bitem.cost}`); return; }
    takeItem('wood', bitem.cost);
    const prev = getTile(sv, gx, gy);
    sv.mods.tiles[gx + ',' + gy] = { t: bitem.t, built: 1, prev, hp: BUILD_HP[bitem.t] || 200 };
    log(sv, `建造完成：${bitem.name}（剩余 木材×${countItem('wood')}）`);
    Panel.refresh(sv);
}

export function demolish(sv, gx, gy) {
    const key = gx + ',' + gy;
    const m = sv.mods.tiles[key];
    if (!m || !m.built) return;
    const bitem = BUILD_ITEMS.find(bi => bi.t === m.t);
    if (m.t === T.CABINET) {
        const chest = sv.mods.chests[key];
        if (chest && chest.some(Boolean)) { log(sv, '柜子里还有物品，先取出来再拆'); return; }
        delete sv.mods.chests[key];
    }
    if (m.t === T.PLOT && sv.mods.plants && sv.mods.plants[key]) {
        delete sv.mods.plants[key];
        Panel.addItem(sv, 'seed', 1);
    }
    const back = bitem ? Math.floor(bitem.cost * B.DEMOLISH_REFUND) : 0;
    if (back > 0) Panel.addItem(sv, 'wood', back);
    // 墙升级链（B1）：按等级返还部分升级材料（lv2 石墙还 石×1；lv3 金属墙还 件×1+石×1）
    if (m.t === T.WALL && m.lv && m.lv > 1) {
        const extra = m.lv === 2 ? { stone: 1 } : { part: 1, stone: 1 };
        for (const [mat, n] of Object.entries(extra)) Panel.addItem(sv, mat, n);
        log(sv, `已拆除 等级${m.lv === 2 ? '石' : '金属'}墙，返还材料`, '#FFB347');
    }
    setTile(sv, gx, gy, m.prev || T.GROUND);
    sv.mods.tiles[key] = { t: m.prev || T.GROUND };
    log(sv, `已拆除 ${bitem ? bitem.name : '建筑'}，返还 木材×${back}`);
}

export function toggleBuild(sv) {
    sv.build = !sv.build;
    if (sv.build) WA.resetActions(sv);
    if (sv.build) log(sv, '建造模式：数字键 1-5 选择，左键放置，F 拆除，G 退出');
    AudioSystem.playClick();
}

export function damageBuilding(sv, z, gx, gy, m, dt) {
    if (m.hp == null) m.hp = BUILD_HP[m.t] || 200;
    m.hp -= z.damage * dt;
    m.lastHit = sv.now;
    z.biteT -= dt;
    if (z.biteT <= 0) {
        z.biteT = 0.6;
        AudioSystem.playDigStone();
    }
    if (!sv._damagedKeys) sv._damagedKeys = new Set();
    sv._damagedKeys.add(gx + ',' + gy);
    if (m.hp <= 0) {
        const key = gx + ',' + gy;
        const bitem = BUILD_ITEMS.find(bi => bi.t === m.t);
        if (m.t === T.CABINET) delete sv.mods.chests[key];
        if (m.t === T.PLOT && sv.mods.plants) delete sv.mods.plants[key];
        sv.mods.tiles[key] = { t: m.prev || T.GROUND };
        sv._damagedKeys.delete(key);
        sv.effects.push({ kind: 'hit', x: (gx + 0.5) * TS, y: (gy + 0.5) * TS, life: 0.5, maxLife: 0.5, label: '塌' });
        AudioSystem.playStoneBreak();
        log(sv, `${bitem ? bitem.name : '建筑'}被摧毁了！`);
        Panel.refresh(sv);
    }
}

// ---------- 可破坏障碍：路障 / 汽车（hp 惰性初始化） ----------
export function damageObstacle(sv, gx, gy, dmg) {
    const key = gx + ',' + gy;
    const t = getTile(sv, gx, gy);
    if (t !== T.BARRICADE && t !== T.CAR) return false;   // 残骸只能拆解，打不碎
    if (!sv.mods.tiles[key] || sv.mods.tiles[key].hp == null) {
        sv.mods.tiles[key] = { t, hp: t === T.BARRICADE ? B.BARRICADE_HP : B.CAR_HP };
    }
    const m = sv.mods.tiles[key];
    m.hp -= dmg;
    m.lastHit = sv.now;
    if (!sv._damagedKeys) sv._damagedKeys = new Set();
    sv._damagedKeys.add(key);
    if (m.hp <= 0) {
        sv._damagedKeys.delete(key);
        sv.effects.push({ kind: 'hit', x: (gx + 0.5) * TS, y: (gy + 0.5) * TS, life: 0.5, maxLife: 0.5, label: '破' });
        AudioSystem.playStoneBreak();
        if (t === T.BARRICADE) {
            // 2026-08-12 v3.61 修复"打坏路障破坏马路地形"：路障只生成在马路格（world.js 在 T.ROAD
            // 基础上按 rr<0.012 替换为 BARRICADE），原地形一定是马路。打坏后恢复为 ROAD 而非 GROUND，
            // 马路/人行道地形不再被破坏（废弃车打爆已变残骸不破坏地形）。
            sv.mods.tiles[key] = { t: T.ROAD };
            setTile(sv, gx, gy, T.ROAD);
            log(sv, '路障被摧毁了！');
        } else {
            // 汽车被打爆：就地变残骸（可拆解还原地面），不覆盖破坏地形；
            // 相邻车体格（车横跨 2 格）一并清理，地面保持原样
            sv.mods.tiles[key] = { t: T.CARWRECK, wreck: true, hp: 0 };
            if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'diff', key, tile: sv.mods.tiles[key] });
            for (const ok of [(gx + 1) + ',' + gy, (gx - 1) + ',' + gy]) {
                const om = sv.mods.tiles[ok];
                if (om && om.t === T.CAR) { delete sv.mods.tiles[ok]; if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'diff', key: ok, tile: { t: T.GROUND } }); }
            }
            log(sv, '汽车被砸烂了！（残骸可用扳手拆解）');
        }
    }
    return true;
}
