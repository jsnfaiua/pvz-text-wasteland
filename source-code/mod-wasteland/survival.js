// ============================================================
// 【无尽植僵荒原】模组 · 生存模式主控（调度层）
// 建造→wbuild.js / 僵尸→wzombie.js / 尸潮→whorde.js / 数值→wbalance.js
// ============================================================

import { ZOMBIES, WEAPONS, ACTION } from '../core/constants.js';
import { getStorage, setStorage, removeStorage, writeSave } from '../persistence/storage.js';
import { saveData } from '../core/state.js';
import { showScreen } from '../ui/screens.js';
import AudioSystem from '../systems/audio.js';
import { T, CHUNK, SPAWN, isWalk, newSeed, hash2,
    getTile, setTile, builtAt, purgeChunks } from './world.js';
import { TS } from './wconst.js';
import { fitCanvasBacking, toggleFullscreen } from '../core/canvasFit.js';
import { draw, BUILD_ITEMS, BUILD_HP, resetWeatherParticles, tintSprite, _mcSprites, _mcWalk, attachParticleBg, showToast, destroyBgFx, destroyBgFxNow, clearBgFxPrevScreen, preloadBgFxParts } from './render.js';
import * as Panel from './panel.js';
import * as WG from './wgear.js';
import * as WA from './waction.js';
import * as WP from './wplants.js';
import * as MSG from './wmsg.js';
import * as B from './wbalance.js';
import * as WB from './wbuild.js';
import * as WZ from './wzombie.js';
import * as WH from './whorde.js';
import * as WD from './windoor.js';
import * as WDEV from './wdev.js';
import * as WSearch from './wsearch.js';
import * as WV from './wvehicle.js';
import * as WW from './wwordcraft.js';
import { showLookCreator, normalizeLook, randomLook, loadThumbSprites, preloadLookSkeleton, preloadLookCreator } from './wlook.js';
import * as WNPC from './wnpc.js';
import * as HUD from './whud.js';
import * as TUT from './wtut.js';
import { showLoadingOverlay } from './wloading.js';
import * as WMAP from './wmap.js';
import { districtAt, cityCenterAt, arterialClassAt, blockAt } from './wdistrict.js';

// 废墟残路带判定：ruins 区 rx<4||ry<4（残路带相位）→ 该格的碎石是"破损路面"可压过；
// 建筑区/人行道带的碎石堆是障碍。与 world.js 废墟 roadBand 生成一致。
function ruinsRoadBandAt(seed, gx, gy) {
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    if (districtAt(seed, cx, cy) !== 'ruins') return false;
    const BL = blockAt(seed, cx, cy);
    const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
    return rx < 4 || ry < 4;
}
import { playerInfectionEffects, addPlayerInfection, PLAYER_INFECTION, infectionAutoGrowAmount } from './winfection.js';
import { serializeSV, createRunDefaults, applySnapshot, serializeCharacter, applyCharacter, serializeWorld, applyWorld, serializeMpSnapshot, mergeZombieList } from './wstate.js';
import { SAVE_KEY, LEGACY_KEY, PROFILE_KEY, CHAR_LIST_KEY, charKey, worldKey, randomName, updateCharList, migrateLegacySave, loadCharacterData, saveCharacterData, profileCharacterName } from './wsave.js';
import * as KB from './wkeybind.js';
import { getBind } from './wkeybind.js';   // v4.26 修复：survival.js 键盘处理大量裸调 getBind，拆分 wkeybind 后需显式 import
import * as WE from './wevent.js';
import * as WWX from './wweather.js';
import * as WCorpse from './wcorpse.js';
import { updateDowned, downedLimitForCount, openRescue, closeRescue, rescueOpen, openMateRescue, openCorpseFinish, setSv as setDownedSv, setLogger as setDownedLogger, setSaveNow as setDownedSaveNow, setAllDeadFallback as setDownedAllDeadFallback, setShowAllDeadChoices as setDownedShowAllDeadChoices } from './wdowned.js';
import { addDrop, reportBoxLootChange, setSv as setLootSv } from './wloot.js';
import { openCarMenu, closeCarMenu, carMenuAct, openNpcMenu, closeNpcMenu, openNpcCommandMenu, closeNpcCommandMenu, closeDriveDestMenu, openCampPanel, closeCampPanel, openCharPanel, closeCharPanel, openNpcMgr, closeNpcMgr, closeTrade, carMenuOpen, npcMenuOpen, npcCmdOpen, driveDestOpen, campPanelOpen, tradeOpen, charPanelOpen, npcMgrOpen, carActByIndex, interruptMateWork, setSv as setMenuSv, setLogger as setMenuLogger, setHooks as setMenuHooks } from './wmenu.js';

export const HOTBAR_SIZE = B.HOTBAR_SIZE;
// 存档层 re-export（mpWasteland 仍从 survival.js 导入这些符号，保持接口不变）
export { loadCharacterData, saveCharacterData };
// 事件模块 re-export（wdev.js 仍从 survival.js 导入 startEvent，保持接口不变）
export { startEvent } from './wevent.js';
// 倒地模块 re-export（mpWasteland.js 仍从 survival.js 导入 downedMedSubmit，保持接口不变）
export { downedMedSubmit, mateMedSubmit } from './wdowned.js';
// 掉落模块 re-export（mpWasteland.js 仍从 survival.js 导入 removeDrop/addDrop/updateLootDrop，保持接口不变）
export { removeDrop, addDrop, updateLootDrop, reportChestChange, reportBoxLootChange } from './wloot.js';

// 2026-08-12 v3.57 把生存模块已导入的模块/工具挂载到 window，供 render.js（已加载完）通过 window 间接访问：
// render.js 之前裸写 `Panel.anyOpen()` 会抛 ReferenceError（Panel 未 import），每帧被 try/catch 吞掉 →
// draw 中断 → 苏醒/_wake 等所有 drawWakeOverlay 之后的内容不渲染。挂到 window 后用 typeof 守卫安全访问。
if (typeof window !== 'undefined') {
    window.Panel = Panel;
    window.WSearch = WSearch;
    window.scanPanelOpen = scanPanelOpen;
}

// wstate.js 依赖装配（环内模块在此集中注入，wstate.js 本体保持无环、可单测）
const STATE_DEPS = {
    BAG_SIZE: Panel.BAG_SIZE,
    HOTBAR_SIZE: HOTBAR_SIZE,
    B: B,
    TS: TS,   // 2026-08-10 格宽像素（applyWorld 尸体兜底判定死亡点附近尸体用）
    WNPC: WNPC,
    normalizeLook: normalizeLook,
    PLAYER_INFECTION: PLAYER_INFECTION,
    saveData: saveData,
};

let sv = null;
let inited = false;

export function log(msg, color) {
    if (!sv) return;   // 游戏未开始时（创建新角色/世界弹窗流程）允许无 sv 调用
    MSG.pushMsg(sv, msg, color);
    // 联机 host：世界级播报广播给 guest（节流 150ms 防刷屏）
    if (sv && sv.mp && sv.mp.role === 'host') {
        const now = performance.now();
        if (now - (sv._mpLogT || 0) > 150) {
            sv._mpLogT = now;
            (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'msg', text: msg, color: color || null });
        }
    }
}

// ================= 背包小工具 =================
function countItem(id) {
    if (WDEV.isDev() && sv._devInf) return 9999;   // 开发者资源无限
    let n = 0;
    for (const s of sv.inv) if (s && s.id === id) n += s.n;
    return n;
}
// 2026-08-12 v3.7 具体食物 id 列表（食物只加饱食，不回血）
const FOOD_ITEM_IDS = ['food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon'];
function isFoodId(id) { return FOOD_ITEM_IDS.includes(id); }
// 2026-08-12 v3.7 驯服植物等消耗"任意食物"：不限于泛称 food
function countAnyFood() {
    if (WDEV.isDev() && sv._devInf) return 9999;
    let n = 0;
    for (const s of sv.inv) if (s && isFoodId(s.id)) n += s.n;
    return n;
}
function takeAnyFood(need) {
    if (WDEV.isDev() && sv._devInf) return need;
    let left = need || 1;
    for (let i = 0; i < sv.inv.length && left > 0; i++) {
        const s = sv.inv[i];
        if (!s || !isFoodId(s.id)) continue;
        const t = Math.min(s.n, left);
        s.n -= t; left -= t;
        if (s.n <= 0) sv.inv[i] = null;
    }
    return need - left;
}
function hasTool(toolId) {
    return sv.inv.some(s => s && s.id === toolId);
}

function playPickupSound(id) {
    if (id === 'sun') AudioSystem.playCollect();
    else if (id === 'gem') AudioSystem.playGemPickup();
}
function takeItem(id, need) {
    if (WDEV.isDev() && sv._devInf) return need;   // 开发者资源无限：不实际扣除
    let left = need;
    for (let i = 0; i < sv.inv.length && left > 0; i++) {
        const s = sv.inv[i];
        if (!s || s.id !== id) continue;
        const take = Math.min(s.n, left);
        s.n -= take; left -= take;
        if (s.n <= 0) sv.inv[i] = null;
    }
    return need - left;
}

// ================= 存档（泰拉瑞亚式：角色 / 世界分离） =================
// v4.26 存档层拆到 wsave.js：charKey/worldKey/randomName/downloadSaveBackup/updateCharList/
// migrateLegacySave/loadCharacterData/saveCharacterData 已移出（本文件 import + re-export）。

// 保存：角色档（跨世界）+ 世界档（跟 seed，host 权威）+ 当前组合 profile（含开发者标记）
// 性能（卡顿排查 P0-1）：存档写入移出 RAF 帧循环——
// 原实现每 SAVE_INTERVAL(20s) 在 update() 帧内同步执行「serializeWorld 全量序列化 +
// JSON.stringify + localStorage.setItem」（含全部 mods 差分/NPC/僵尸，几百 KB），
// 单帧尖峰几十 ms → 周期性卡顿（单机/联机 host 每 20s 一次）。改为宏任务队列：
// saveNow 只标记待存（_saveQueued 幂等合并），实际落盘在 setTimeout(0) 帧间执行；
// 退出/切后台时 flushSave 同步兜底（防丢最后进度）。
let saveFlushTimer = null;
// 2026-08-12 修复"死亡节点不落盘"（#2）：原 `sv.dead` 直接 return 会丢弃濒死/倒地/救活/重生
// 关键节点的存档请求。软核倒地救治（_downed）、救活、重生都依赖持久化恢复；仅「硬核游戏结束
// 已删档」（dead 且无倒地记录）才真正无需落盘。故放宽：dead 时仍允许落盘，但硬核删档后
// 不再调用 saveNow（exitWasteland 已退出），此处仅兜底防重复写。
function saveNow() {
    if (!sv || !sv.world) return;
    if (sv._saveQueued) return;
    sv._saveQueued = true;
    if (saveFlushTimer == null) saveFlushTimer = setTimeout(flushSave, 0);
}
function flushSave() {
    if (saveFlushTimer != null) { clearTimeout(saveFlushTimer); saveFlushTimer = null; }
    if (!sv || !sv.world) { if (sv) sv._saveQueued = false; return; }
    sv._saveQueued = false;
    const name = sv.characterName || '幸存者';
    setStorage(charKey(name), serializeCharacter(sv, STATE_DEPS));
    updateCharList(name);
    // 世界档：host（单机=本机；联机=房主权威，含双方 wdiff 修改）保存；
    // guest 不落世界档（世界属房主，guest 只保留角色）
    if (!sv.mp || sv.mp.role === 'host') {
        const worldData = serializeWorld(sv, STATE_DEPS);
        // P1-1 配额监控：localStorage 上限 ~5MB，存档逼近阈值时提示一次（防"配额满 →
        // setStorage catch 静默跳过 → 长局玩家悄然失去存档保护"）。只提示不干预写档。
        if (!sv._saveWarned) {
            let size = 0;
            try { size = JSON.stringify(worldData).length; } catch { size = 0; }
            if (size > 3 * 1024 * 1024) {
                sv._saveWarned = true;
                MSG.pushMsg(sv, `⚠ 存档体积已达 ${(size / 1048576).toFixed(1)}MB，接近浏览器存储上限（5MB）！建议清理旧角色档或导出备份，否则后续存档可能失败`, '#FF6644');
            }
        }
        setStorage(worldKey(sv.world.seed), worldData);
        setStorage(PROFILE_KEY, {
            characterName: name,
            worldSeed: sv.world.seed,
            _devGod: !!sv._devGod, _devInfStamina: !!sv._devInfStamina,
            _devInf: sv._devInf !== false, _devInfAmmo: !!sv._devInfAmmo,
            _devOneShot: !!sv._devOneShot, _devInfBag: !!sv._devInfBag,
            _devDmgMul: sv._devDmgMul || 1, _devTimeScale: sv._devTimeScale || 1,
            _devHud: !!sv._devHud, _devGfx: sv._devGfx == null ? 2 : sv._devGfx,
        });
    }
}
// 切后台/关页面前兜底落盘（队列内未执行的保存不丢）
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && sv && sv.active && !sv.dead) flushSave();
    });
}

// 当前角色名：sv 存在时以 sv 为准；否则回退 profile（mpWasteland 握手阶段无 sv 时用）
// v4.26 loadCharacterData/saveCharacterData 已在 wsave.js 定义并 re-export
export function currentCharacterName() {
    return (sv && sv.characterName) || profileCharacterName();
}

// v3.62 随机出生/重生区域（城区/郊区/废墟三选一）：随机选目标区域后，
// 在对应区域随机采样可站立位置。sv 为空（buildRun 出生阶段地形未生成）跳过 canStand，
// 由开局 unstickPlayer 兜底；重生（softRespawn）时 sv 已存在 → 校验可站立。
function randomZoneSpawn(seed, sv) {
    const zones = ['urban', 'suburb', 'ruins'];   // 城区/郊区/废墟（不落在荒野深处）
    const zone = zones[Math.floor(Math.random() * zones.length)];
    for (let i = 0; i < 200; i++) {
        // 随机城市节点 ±6×6 + 随机角度 + 距中心 0~19 区块（覆盖 urban 内环~suburb 边界）
        const ccx = Math.round(Math.random() * 12) - 6;
        const ccy = Math.round(Math.random() * 12) - 6;
        const cc = cityCenterAt(seed, ccx, ccy);
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * 19 * CHUNK;
        const gx = Math.round(cc.x * CHUNK + Math.cos(ang) * dist);
        const gy = Math.round(cc.y * CHUNK + Math.sin(ang) * dist);
        const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
        if (districtAt(seed, cx, cy) !== zone) continue;
        const px = (gx + 0.5) * TS, py = (gy + 0.5) * TS;
        if (!sv || canStand(px, py)) return { x: px, y: py, zone };
    }
    return null;
}
function buildRun(worldSaved, charSaved, opts) {
    const run = createRunDefaults(opts, STATE_DEPS);
    const wl = applyWorld(run, worldSaved, STATE_DEPS);
    if (!run.world) {
        // 旧版（tiles 结构）世界存档：备份到 LEGACY_KEY 后开新世界
        if (wl.legacy) {
            setStorage(LEGACY_KEY, worldSaved);
            run._legacyNote = true;
        }
        run.world = { seed: opts.seed || newSeed(), chunks: new Map() };
        // v3.62 出生位置随机到「城区/郊区/废墟」三选一（用户需求：创建账号随机苏醒区域）。
        // 随机选城市节点 + 目标区域采样，保证开局位置在城市圈内（不落荒野深处），
        // 且每次开局的区域/城市/方向/远近都不同。
        const sp = randomZoneSpawn(run.world.seed, null);
        if (sp) {
            run.px = sp.x; run.py = sp.y; run._spawnZone = sp.zone;
        } else {
            // 兜底：随机城市节点附近（原 v3.35 逻辑）
            const ccx = Math.round(Math.random() * 8) - 4;
            const ccy = Math.round(Math.random() * 8) - 4;
            const cc = cityCenterAt(run.world.seed, ccx, ccy);
            const ang = Math.random() * Math.PI * 2;
            const dist = (8 + Math.random() * 12) * CHUNK;
            run.px = (Math.round(cc.x * CHUNK + Math.cos(ang) * dist) + 0.5) * TS;
            run.py = (Math.round(cc.y * CHUNK + Math.sin(ang) * dist) + 0.5) * TS;
        }
    }
    applyCharacter(run, charSaved, STATE_DEPS);
    // 历史档迁移：路带格（rx<4||ry<4）里的 mods 人行道是旧 bug 产物
    // （视觉"路中间人行道板块"），删除还原为生成的路面；非路带的人行道保留
    if (run.world && run.mods && run.mods.tiles) {
        const seed = run.world.seed;
        for (const key of Object.keys(run.mods.tiles)) {
            const m = run.mods.tiles[key];
            // m.built 的玩家自建人行道（未来铺地功能）不删，只清旧 bug 产物（L8）
            if (!m || m.t !== T.SIDEWALK || m.built) continue;
            const sp = key.split(',');
            const gx = +sp[0], gy = +sp[1];
            if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
            const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
            const BL = blockAt(seed, cx, cy);
            const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
            if (rx < 4 || ry < 4) delete run.mods.tiles[key];
        }
    }
    return run;
}

// ================= 碰撞 =================
// 停放车辆的朝向（与渲染完全一致）：已开过的车用持久化 dir；未开过的车用
// 种子确定性朝向 + 邻车退避（竖向且旁边有车 → 退回水平，防止碰撞体与渲染错位）
function carBodyDir(sv, gx, gy) {
    const m2 = sv.mods.tiles[gx + ',' + gy];
    if (m2 && m2.dir != null) return m2.dir;
    let dir = WV.carDirAt(sv.world.seed, gx, gy);
    if (Math.abs(Math.sin(dir)) > 0.92) {
        for (const [ox, oy] of [[0, -1], [1, -1], [1, 0], [0, 1], [1, 1]]) {
            const nt = getTile(sv, gx + ox, gy + oy);
            if (nt === T.CAR || nt === T.CARWRECK) { dir = 0; break; }
        }
    }
    return dir;
}

// 停放车辆/残骸占位检查：车锚点格 + 沿停放朝向延伸的第二格（与渲染一致，2 格碰撞体，
// 无论可修理车还是报废车）；驾驶中的车已从世界移除，不参与
function carBodyAt(sv, gx, gy) {
    const t0 = getTile(sv, gx, gy);
    if (t0 === T.CAR || t0 === T.CARWRECK) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = (gx + dx) + ',' + (gy + dy);
        const nt = getTile(sv, gx + dx, gy + dy);
        if (nt !== T.CAR && nt !== T.CARWRECK) continue;
        const ad = carBodyDir(sv, gx + dx, gy + dy);
        const fx = Math.round(Math.cos(ad)), fy = Math.round(Math.sin(ad));
        if (gx + dx + fx === gx && gy + dy + fy === gy) return true;
    }
    return false;
}

// 帧级车体占位缓存：walkableAt 被玩家/僵尸/NPC 寻路高频调用，同帧内同一格只查一次
let carBodyCache = null;
function carBodyAtFast(sv, gx, gy) {
    const key = gy * 100000 + gx;
    if (carBodyCache && carBodyCache.has(key)) return carBodyCache.get(key);
    if (!carBodyCache) carBodyCache = new Map();
    const r = carBodyAt(sv, gx, gy);
    carBodyCache.set(key, r);
    return r;
}

function walkableAt(gx, gy) {
    const t = getTile(sv, gx, gy);
    if (isWalk(t)) return !carBodyAtFast(sv, gx, gy);   // 可走，但车的第二格（渲染位）不可穿
    const m = builtAt(sv, gx, gy);
    return !!(m && m.t === T.DOOR);
}

function canStand(x, y) {
    const r = 10; // 玩家碰撞半径:贴合参考图 sprite 渲染宽度(~20px),2026-08-08 由 11 调整
    for (let i = 0; i < 4; i++) {
        const cx = x + (i % 2 ? r : -r), cy = y + (i < 2 ? r : -r);
        if (!walkableAt(Math.floor(cx / TS), Math.floor(cy / TS))) return false;
    }
    return true;
}

// 驾驶碰撞：车体长 2 格 × 宽 1 格，按车头朝向(dir)旋转检查（南北行驶时车身沿 Y 轴，
// 不再误判东西两侧）；不可碾过墙/树/水，可压草地/路/箱。
// 关键：必须检查"车体矩形覆盖的所有格"——此前只采样 4 个角点（中心 ±1 长轴、±0.5 短轴），
// 角点落格时恰好落在车体长轴两端外侧（0.5 格偏移），车体 2 格中的左/上格从不被检查，
// 车会"压着"墙/树/停放车辆站立甚至穿过（碰撞框与渲染错位）。矩形覆盖用半开区间：
// 最小值 ceil、最大值 floor-ε——车体边界恰好压线时不把边界外 0 厚度的格算障碍。
function carCanStand(x, y, dir) {
    const a = dir || 0, c = Math.cos(a), s = Math.sin(a);
    // 车体 4 角（长轴 ±1 格、短轴 ±0.5 格）
    const p0x = x + (c - s * 0.5) * TS, p0y = y + (s + c * 0.5) * TS;
    const p1x = x + (c + s * 0.5) * TS, p1y = y + (s - c * 0.5) * TS;
    const p2x = x - (c - s * 0.5) * TS, p2y = y - (s + c * 0.5) * TS;
    const p3x = x - (c + s * 0.5) * TS, p3y = y - (s - c * 0.5) * TS;
    const minX = Math.min(p0x, p1x, p2x, p3x), maxX = Math.max(p0x, p1x, p2x, p3x);
    const minY = Math.min(p0y, p1y, p2y, p3y), maxY = Math.max(p0y, p1y, p2y, p3y);
    for (let gy = Math.ceil(minY / TS); gy <= Math.floor((maxY - 0.001) / TS); gy++) {
        for (let gx = Math.ceil(minX / TS); gx <= Math.floor((maxX - 0.001) / TS); gx++) {
            const t = getTile(sv, gx, gy);
            // 车可通行：地面/地板/路/人行道/草类/作物；被墙/树/水/建筑挡住
            if (t === T.WALL || t === T.TREE || t === T.WATER ||
                t === T.BARRICADE || t === T.DOOR) return false;
            // 废墟碎石：仅"残路带上的碎石"（ruins 区 rx<4||ry<4 的破损路面）可压过，
            // 建筑废墟的碎石堆仍是障碍——与 NPC 寻路 carCellOk 语义一致，避免
            // 车直接穿过石头堆（穿石/绕石行为矛盾）。
            if (t === T.RUBBLE) {
                const seed = sv.world.seed;
                if (!ruinsRoadBandAt(seed, gx, gy)) return false;
            }
            // 停放的车辆/残骸占 2 格（锚点格 + 沿停放朝向延伸的第二格），与渲染一致；
            // 走帧级缓存（carBodyAtFast），驾驶碰撞每帧不再重复扫邻格（玩家/NPC 寻路已复用）
            if (carBodyAtFast(sv, gx, gy)) return false;
            const m = builtAt(sv, gx, gy);
            if (m) return false;
        }
    }
    return true;
}

function unstickPlayer() {
    if (canStand(sv.px, sv.py)) return;
    const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
    for (let ring = 1; ring <= 6; ring++) {
        for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const cx = (gx + dx + 0.5) * TS, cy = (gy + dy + 0.5) * TS;
            if (canStand(cx, cy)) { sv.px = cx; sv.py = cy; log('你被挤出了障碍物'); return; }
        }
    }
}

// ================= 脱离卡死（2026-08-10 用户要求：兜底功能） =================
// 暂停菜单点「脱离卡死」→ 10 秒倒计时（期间保持不动）→ 期满自动传送到最近可站位置。
// 室内（interiorCanStand）/ 室外（canStand）/ 驾驶（先停车）各自处理；联机 host/guest 各自本地执行。
const UNSTUCK_DUR = 10;   // 脱离引导倒计时（秒）
function startUnstick() {
    if (!sv) return;
    if (sv._unstuck) { log('脱离卡死已在倒计时中', '#FFCC66'); return; }
    sv._unstuck = { t: 0, dur: UNSTUCK_DUR };
    log(`脱离卡死启动：${UNSTUCK_DUR} 秒内保持不动即可脱身`, '#FFCC66');
}
function doUnstick() {
    if (!sv) return;
    // 驾驶中先停车（否则传送后仍在驾驶态）
    if (sv.driving && !sv.interior) {
        try { WV.stopDrive(sv, canStand); } catch (e) { sv.driving = null; sv.driveOrder = null; }
    }
    if (sv.interior) {
        // 室内：interiorCanStand 环形搜索最近可站格
        const it = sv.interior;
        const ok = (x, y) => WD.interiorCanStand(sv, x, y);
        if (!ok(sv.px, sv.py)) {
            const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
            const maxRing = Math.max(it.w, it.h);
            outer:
            for (let ring = 1; ring <= maxRing; ring++) {
                for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                    const cx = (gx + dx + 0.5) * TS, cy = (gy + dy + 0.5) * TS;
                    if (ok(cx, cy)) { sv.px = cx; sv.py = cy; break outer; }
                }
            }
        }
        sv.interior.px = sv.px; sv.interior.py = sv.py;
        log('已脱离卡死（室内）', '#7DFF7D');
    } else {
        unstickPlayer();
        log('已脱离卡死', '#7DFF7D');
    }
    sv.hurtT = 0;
    sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 0.5, maxLife: 0.5, label: '◈' });
}
// 每帧推进脱离倒计时：期间禁止移动（移动块单独拦截）；按移动/跳跃/闪现键取消
function tickUnstuck(dt) {
    if (!sv || !sv._unstuck) return;
    const uk = sv._unstuck;
    const mk = sv.keys || {};
    const moved = mk['w'] || mk['a'] || mk['s'] || mk['d']
        || mk['arrowup'] || mk['arrowdown'] || mk['arrowleft'] || mk['arrowright']
        || mk[' '] || mk['q'];
    if (moved) {
        sv._unstuck = null;
        log('脱离卡死已取消（检测到移动）', '#B8C4C8');
        return;
    }
    uk.t += dt;
    if (uk.t >= uk.dur) {
        sv._unstuck = null;
        doUnstick();
    } else {
        const left = Math.max(1, Math.ceil(uk.dur - uk.t));
        if (uk._lastLeft !== left) { uk._lastLeft = left; log(`脱离卡死倒计时 ${left} 秒…（保持不动）`, '#FFCC66'); }
    }
}

function zCanStand(x, y) {
    // 行驶中的车体排除（L2）：车驾驶时不在 tile 上（实体化），僵尸 AI/碰撞须绕过行驶车
    // ——近似以车中心为圆心 1 格半径，阻止僵尸穿行车体
    if (sv.driving && Math.hypot(x - sv.driving.x, y - sv.driving.y) < TS * 0.95) return false;
    const r = 11;
    for (let i = 0; i < 4; i++) {
        const cx = x + (i % 2 ? r : -r), cy = y + (i < 2 ? r : -r);
        const gx = Math.floor(cx / TS), gy = Math.floor(cy / TS);
        if (!walkableAt(gx, gy)) return false;
        const m = builtAt(sv, gx, gy);
        if (m && m.t === T.DOOR) return false;
    }
    return true;
}

// ================= 主循环（支持后台运行） =================
let bgTimer = null;

function loop(now) {
    if (!sv || !sv.active) return;
    let dt = Math.min((now - sv.last) / 1000, 0.05);
    if (sv._bulletT > 0) { sv._bulletT -= dt; dt *= WA.BULLET_TIME_SCALE; }   // 完美闪避子弹时间(0.2x 慢动作)
    sv.last = now;
    carBodyCache = null;   // 帧级车体占位缓存：每帧失效（地形可能被改动）
    // 搜索界面打开时游戏不暂停：世界（僵尸/昼夜/饱食）继续运行；
    // 背包打开也不暂停世界（边整理边警戒）；储物柜/暂停/拼字台仍暂停世界。搜索进度由下方单独推进。
    // 主循环防崩溃（AGENTS.md §7）：update/draw 内任何异常都必须捕获，保证下一帧仍注册，
    // 禁止未捕获异常让 requestAnimationFrame 停摆导致游戏永久冻结白屏。
    try {
        // 2026-08-12 v3.58 苏醒期间世界暂停：不调 update（僵尸/天气/NPC/饱食全不动），
        // 只推进世界时间 sv.now（角色呼吸动画/睁眼动画依赖 sv.now 播放）与苏醒计时 _wake.t。
        // 2.4s 苏醒结束（_wake 清空）后恢复正常 update。玩家已全锁（moveInput/startDash/tryJump）。
        if (window.__wslAnimBlocked && !sv._wake) {
            // v4.3 加载/过渡动画期间完全冻结：只推进世界时间，不 update
            //（僵尸/角色/天气/NPC 全停，配合遮罩拦截点击 + keydown 吞键 → 只能等待）
            sv.now += dt * (sv._devTimeScale || 1);
        }
        else if (sv._wake && !sv.dead) {
            sv.now += dt * (sv._devTimeScale || 1);
            sv._wake.t += dt;
            if (sv._wake.t >= sv._wake.dur) sv._wake = null;
        }
        else if (!Panel.isChestOpen() && !pauseOpen && !WW.isOpen() && !WW.isSurgeryOpen() && !sv.dead) update(dt);
        else if (!sv.dead) {
            sv.now += dt * (sv._devTimeScale || 1);
            if (WW.isOpen()) WW.update(dt);
        }
        if (WSearch.isOpen() && !sv.dead) WSearch.updateSearch(sv, dt);
        if (sv.ctx) fitCanvasBacking(sv.ctx, sv._devGfx === 0 ? 0.75 : 1);   // 低画质：内部分辨率 0.75x
        draw(sv.ctx, sv);
        HUD.update(sv, now);   // 调试 HUD（默认关闭；每帧轻量计数，DOM 500ms 节流）
    } catch (e) {
        console.error('[主循环] update/draw 异常被捕获（已跳过本帧）:', e);
    }
    sv.raf = requestAnimationFrame(loop);
}

function startBgKeepAlive() {
    if (bgTimer) return;
    bgTimer = setInterval(() => {
        if (!sv || !sv.active || !document.hidden) return;
        const now = performance.now();
        let dt = Math.min((now - sv.last) / 1000, 0.05);
    if (sv._bulletT > 0) { sv._bulletT -= dt; dt *= WA.BULLET_TIME_SCALE; }   // 完美闪避子弹时间(0.2x 慢动作)
        sv.last = now;
        if (!Panel.isChestOpen() && !pauseOpen && !sv.dead) update(dt);
        else sv.now += dt * (sv._devTimeScale || 1);
    }, 1000 / 20);
}

function stopBgKeepAlive() {
    if (bgTimer) { clearInterval(bgTimer); bgTimer = null; }
}

// ---------- 随机事件 / 天气系统 ----------
// v4.26 已拆到 wevent.js（updateEvents/startEvent）与 wweather.js（updateWeather）

// 2026-08-09 昏迷苏醒进行中：开局睁眼动画期间角色无敌、状态冻结（不受伤害、不消耗）
function wakeActive(sv) { return !!(sv && sv._wake && sv._wake.t < sv._wake.dur); }

// 2026-08-09 修复"切换队友视角跑到室外"：每次切视角后，主控角色的室内/室外状态
// （n.inInterior）必须与 sv.interior 同步。若不一致（如室内死亡切到室外队友，
// 或切到室内队友但 sv.interior 已被清），下一帧立即修正——重建对应房间/退出房间。
function syncControllerInterior() {
    if (!sv || !sv.npcs || !sv.controllerId) return;
    const cur = sv.npcs.find(n => n.id === sv.controllerId);
    if (!cur || !cur.alive) return;
    const wantIn = !!cur.inInterior;
    const haveIn = !!sv.interior;
    if (wantIn === haveIn) return;   // 一致
    if (wantIn && !haveIn) {
        // 主控在室内但 sv.interior 空：重新进入对应房间并跳到对应楼层
        if (!cur.interiorKey) return;
        WD.enterInterior(sv, cur.interiorKey, true);
        const targetFloor = cur.interiorFloor || 1;
        const curFloor = sv.interior ? (sv.interior.floor || 1) : 1;
        if (targetFloor > curFloor) for (let i = curFloor; i < targetFloor; i++) WD.changeFloor(sv, 1, true);
        else if (targetFloor < curFloor) for (let i = curFloor; i > targetFloor; i--) WD.changeFloor(sv, -1, true);
        if (sv.interior) {
            // 修正门口世界坐标：enterInterior 用当时的 sv.px 记录门口（此时是室内坐标），
            // 必须按门口格（doorLocalX/Y）+ 建筑原点（originX/Y）重算，否则出门位置错乱。
            // originX/Y 是【格子索引】，doorLocalX/Y 也是格子索引 → 世界像素 = (origin+local+0.5)*TS
            const dlx = sv.interior.doorLocalX, dly = sv.interior.doorLocalY;
            sv.interior.doorX = (sv.interior.originX + dlx + 0.5) * TS;
            sv.interior.doorY = (sv.interior.originY + dly + 0.5) * TS;
            // 定位到队友所在位置
            sv.interior.px = cur.x; sv.interior.py = cur.y;
        }
    } else if (!wantIn && haveIn) {
        // 主控在室外但 sv.interior 存在：退出房间
        WD.exitInterior(sv, true);
    }
}

function update(dt) {
    sv.now += dt * (sv._devTimeScale || 1);
    sv.playT += dt;
    // 2026-08-10 世界地图：探索记录（玩家所在区块 + 8 邻域；host 权威，guest 经 updateGuest 上报）
    WMAP.markExplore(sv);
    // 切视角后室内/室外状态同步（死亡切队友/手动切换/T 键切换等路径全覆盖）
    syncControllerInterior();
    // 2026-08-12 v3.45 长按扫描自动开门：进度环满（render 置 _scanDone）→ 立即打开扫描面板（无需松手）
    // 2026-08-12 v3.47 开门后置 0.5s 冷却：防止"按住不放 → 面板打开 → auto-repeat keydown 立刻关闭并重开"
    // 导致面板闪烁/反复触发（配合 keydown 首次按下才计时）。
    if (sv._scanDone) {
        sv._scanDone = false;
        sv._scanHeld = false;
        sv._scanCooldownUntil = performance.now() + 500;
        openScanPanel();
    }
    // 2026-08-12 v3.42 鼠标交互准心：8 方向朝向每帧计算（准心世界坐标 - 玩家 → facing8 索引）
    // 注意：不在此处覆盖 faceX/faceY（移动逻辑在后面会覆盖）；准心覆盖放在大世界/室内帧尾，
    // 仅无移动输入时生效（见 updateAimFacing 调用）。
    if (!sv || !sv.mouse || sv.mouse.x == null) { /* 无鼠标 */ }
    else {
        // 2026-08-12 v3.50 修复"室内待机朝向不跟准星"：室内/室外统一用 camX+camY 作鼠标世界坐标基准
        //（与 render.mouseWorld 一致）。此前室内误用 sv.interior.px + sv.mouse.x（玩家局部坐标当相机基准），
        // 导致室内准星世界坐标偏右上，facing8 朝向永远错 → 室内待机朝向不跟随准星。
        const wx = (sv.camX != null ? sv.camX : 0) + sv.mouse.x;
        const wy = (sv.camY != null ? sv.camY : 0) + sv.mouse.y;
        const dx = wx - sv.px, dy = wy - sv.py;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            const ang = Math.atan2(dy, dx);
            const deg = (ang * 180 / Math.PI + 360) % 360;
            // 2026-08-12 v3.44 用户修正：4 主方向各占 90° 扇区（非 8 方向 45°）——
            // 西北~东北（225°~315°）→ 北；东北~东南（315°~45°）→ 东；
            // 东南~西南（45°~135°）→ 南；西南~西北（135°~225°）→ 西。
            // floor((deg+45)/90)%4：东=0 南=1 西=2 北=3；映射回 8 方向索引(×2)：东0 南2 西4 北6。
            sv.facing8 = Math.floor((deg + 45) / 90) % 4 * 2;
        }
    }
    // 昏迷苏醒过渡计时（不序列化；期满后清空，玩家恢复移动）
    if (sv._wake) { sv._wake.t += dt; if (sv._wake.t >= sv._wake.dur) sv._wake = null; }
    // 2026-08-10 脱离卡死倒计时（暂停菜单入口；移动键取消，期满自动传送）
    tickUnstuck(dt);

    // ---------- 联机客人端分流（Phase 2 主机权威）----------
    // guest 不模拟世界（昼夜/僵尸 AI/NPC/刷怪/尸潮/掉落生成都由 host 权威，
    // 经 wsync 100ms 快照下发）；本地只保留：自己移动/生存/武器视觉/特效/事件播放。
    if (sv.mp && sv.mp.role === 'guest') { updateGuest(dt); return; }
    WE.updateEvents(sv, dt);   // 随机事件（D：停电夜/物资空投）——host 权威，guest 从快照同步
    WWX.updateWeather(sv);     // 天气切换（确定性 weatherAt）——host 权威，guest 从快照同步

    sv.t += dt * (sv._devTimeScale || 1);   // 开发工具：时间加速（测昼夜用），1 现实小时 = 1 游戏天
    // v3.63 天气独立时钟：默认按真实流逝（_devWxTimeScale=1）——开发者勾选"天气也加速"时才乘 _devTimeScale。
    // 这样时间加速仅影响上方时间/救助/尸变速度，不会导致天气切换频闪（粒子密度保持稳定）。
    if (sv.t >= sv.dayLen) {
        sv.t -= sv.dayLen;
        sv.day++;
        sv._hordeDayStarted = false;
        log(`第 ${sv.day} 天开始了`);
        WNPC.ageNpcs(sv);          // NPC 成长/年龄/自然死亡
        WNPC.settleHires(sv);      // 雇佣费每日结算
    }

    // 特效计时
    for (let i = sv.effects.length - 1; i >= 0; i--) {
        sv.effects[i].life -= dt;
        if (sv.effects[i].life <= 0) sv.effects.splice(i, 1);
    }
    // 特效数量上限（战斗特效堆积 → 序列化/渲染卡顿；防堆积；画质档 B：低20/中35/高50）
    const maxEff = sv._devGfx === 0 ? 20 : sv._devGfx === 1 ? 35 : 50;
    if (sv.effects.length > maxEff) sv.effects.splice(0, sv.effects.length - maxEff);
    // 地面掉落物上限（长时间战斗掉落堆积 → 快照/渲染卡顿）
    if (sv.drops.length > 150) sv.drops.splice(0, sv.drops.length - 150);
    if (sv.swingT > 0) sv.swingT -= dt;
    if (sv.hurtT > 0) sv.hurtT -= dt;
    if (sv._pathRebuildCd > 0) sv._pathRebuildCd -= dt;
    MSG.updateMsg(sv, dt);

    // ---------- 感染阶段效果 ----------
    // v4.29 主控倒地待救（sv._downed）期间感染【冻结】不增长：感染满的角色倒地后，
    // 队友还有机会救治（不会因倒地期间感染继续涨到满 → hp=0 → onDeath 重入 → 连环死亡）。
    if (sv.infection > 0 && !sv._downed) {
        const infEff = playerInfectionEffects(sv.infection);
        const effMaxHp = Math.round(B.MAX_HP * infEff.maxHpMul);
        if (sv.hp > effMaxHp) sv.hp = effMaxHp;
        // 2026-08-11 v2.98 用户需求：感染值>0（被僵尸咬沾染）且未用抑制药（抗生素/草药）时，
        // 感染值**缓慢自动增加**（无药约 2 分钟从 0 到满）；满 100 → 直接致死 → 走尸体/尸变逻辑。
        // v4.28 感染随感染值加速（用户需求"侵蚀随时间加速"）：infectionAutoGrowAmount 按当前值放大速率。
        sv.infection = addPlayerInfection(sv.infection, infectionAutoGrowAmount(B.INFECTION_AUTO_GROW_PER_SEC, sv.infection, dt));
        if (sv.infection >= PLAYER_INFECTION.max) {
            // 感染满 → 致死（hp=0 让帧尾 onDeath 走完整死亡流程：掉遗物/尸体/软核重生或全灭）
            log('感染彻底侵蚀了你的身体，你死了……', '#FF5544');
            sv._deathReason = '感染恶化致死';
            sv.hp = 0;
            sv.dead = false;
        }
        sv._infLogT = (sv._infLogT || 0) - dt;
    }

    // 2026-08-09 开局昏迷苏醒（眨眼动画）：状态不减少、不变化、不受伤害。
    // 整段饱食/水分/体力/回血全部跳过，角色处于"无敌且属性冻结"状态直到睁眼完成。
    if (!wakeActive(sv)) {
    // ---------- 饱食度：随时间消耗，奔跑额外消耗；饥饿减速，挨饿掉血 ----------
    if (sv.food != null) {
        const mi = WA.moveInput(sv);
        let drain = B.HUNGER_DRAIN * (sv._hungerMul || 1);   // 先天病（糖尿病）修正
        if (sv.sprinting && (mi.mx || mi.my)) drain += B.HUNGER_SPRINT_DRAIN;
        const prev = sv.food;
        // 2026-08-09 属性全满持久化：_devGod 时饱食/水分/体力每帧保持满值（开开关关也持续不变）
        if (sv._devGod) sv.food = B.HUNGER_MAX;
        else sv.food = Math.max(0, sv.food - drain * dt);
        if (prev > B.HUNGER_LOW && sv.food <= B.HUNGER_LOW) log('有些饿了（饱食<30），移动变慢', '#FFB347');
        if (sv.food <= 0) {
            if (!sv._starved) { sv._starved = true; sv._starveLogT = 0; log('你饿坏了！尽快进食，否则持续掉血', '#FF6644'); }
            // 饥饿掉血最低降到 1 血，不会饿死（晕眩光晕提示"快晕倒"）
            if (!sv._devGod) sv.hp = Math.max(1, sv.hp - B.HUNGER_STARVE_DMG * dt);
            sv._starveLogT -= dt;
            if (sv._starveLogT <= 0) { sv._starveLogT = 8; log('饥饿中…生命流失', '#FF6644'); }
        } else {
            sv._starved = false;
        }
    }

    // ---------- 水分：随时间消耗，奔跑额外消耗；口渴减速，缺水掉血 ----------
    if (sv.water != null) {
        const mi = WA.moveInput(sv);
        let drain = B.WATER_DRAIN;
        if (sv.sprinting && (mi.mx || mi.my)) drain += B.WATER_SPRINT_DRAIN;
        // 属性全满持久化（同上）
        if (sv._devGod) sv.water = B.WATER_MAX;
        else sv.water = Math.max(0, sv.water - drain * dt);
        if (sv.water <= 0) {
            if (!sv._dehydrated) { sv._dehydrated = true; sv._dehydrateLogT = 0; log('你严重缺水了！尽快喝水，否则持续掉血', '#66CCFF'); }
            // 缺水掉血最低降到 1 血（与饥饿一致，不会渴死）
            if (!sv._devGod) sv.hp = Math.max(1, sv.hp - B.WATER_DEHYDRATE_DMG * dt);
            sv._dehydrateLogT -= dt;
            if (sv._dehydrateLogT <= 0) { sv._dehydrateLogT = 8; log('缺水…生命流失', '#66CCFF'); }
        } else {
            sv._dehydrated = false;
        }
    }

    // ---------- 2026-08-12 v3.9 错乱僵尸持续状态：中毒/灼烧掉血（拼错词触发，4 秒） ----------
    if (sv._poisonT > 0) {
        sv._poisonT -= dt; sv._poisonTic = (sv._poisonTic || 0) + dt;
        if (sv._poisonTic >= 0.5) { sv._poisonTic = 0; if (!sv._devGod) sv.hp = Math.max(1, sv.hp - 2); }
        if (sv._poisonT <= 0) { sv._poisonT = 0; log('中毒状态消除', '#9AE88A'); }
    }
    if (sv._burnT > 0) {
        sv._burnT -= dt; sv._burnTic = (sv._burnTic || 0) + dt;
        if (sv._burnTic >= 0.5) { sv._burnTic = 0; if (!sv._devGod) sv.hp = Math.max(1, sv.hp - 3); }
        if (sv._burnT <= 0) { sv._burnT = 0; log('灼烧熄灭', '#9AE88A'); }
    }

    // ---------- 生命恢复：血量<100% 时缓慢自愈（有粮有水才回）；饱食充足可加快，代价是更快消耗饱食 ----------
    // v3.63 用户反馈"脱战不回血"：放宽阈值 hp > 10（v3.62 前 >20 太严，低血时一直不回）。
    // 仍保留 hp 10~maxHp 的 ramp（低血时回血慢），避免"1 血瞬间满"破坏紧张感。
    // 战斗状态（_combatT>0）+ 啃咬帧（_biting）期间暂停自然回血。
    // _biting 帧末重置（帧尾）：回血块在帧首用"上一帧啃咬"的 _biting=true 跳过回血。
    if (sv.hp > 10 && sv.hp < sv.maxHp && (sv.food || 0) > 0 && (sv.water || 0) > 0 && !((sv._combatT || 0) > 0) && !sv._biting) {
        let regen = B.HP_REGEN_NATURAL;
        const fed = (sv.food || 0) >= B.HP_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, ((sv.food || 0) - B.HP_REGEN_FED_AT) / (B.HUNGER_MAX - B.HP_REGEN_FED_AT));
            regen += B.HP_REGEN_FED * ramp;
            sv.food = Math.max(0, sv.food - B.HP_REGEN_FUEL * dt);   // 进食回血：加快消耗饱食度
        }
        // hp=10 → rate=0，hp=maxHp → rate=1
        const hpRate = Math.min(1, Math.max(0, (sv.hp - 10) / Math.max(1, sv.maxHp - 10)));
        regen *= hpRate;   // 低血时回血变慢，避免"危险血站着就满"
        sv.hp = Math.min(sv.maxHp, sv.hp + regen * dt);
    }

    // ---------- 属性全满持久化（2026-08-09）：_devGod 时每帧保持生命/体力满值 ----------
    // 饱食/水分已在上面消耗块保持满；生命与体力在此统一保持（室内外共用位置）。
    if (sv._devGod) {
        sv.hp = sv.maxHp || B.MAX_HP;
        sv.stamina = sv.maxStamina || 100;
        sv.exhausted = false;
        sv._starved = false;
        sv._dehydrated = false;
        // 2026-08-11 v2.97 修复"主控头上有濒死标志但其实健康，被攻击致死后又跳过切队友视角"：
        // _devGod 此前只拉满 hp/stamina，**不清 `sv._downed` / 当前主控记录的 `downed` 标志**——
        // 渲染层（drawPlayer 的 drawDownedTimeBar）在健康主控头顶残留救援倒计时（用户截图）；
        // 且残留 downed 让后续 onDeath 的 mates 过滤/攻击路径错乱（恶意 NPC 对 downed 走扣时，
        // 主控被"打死"记录但 sv.hp 仍满 → 状态悬空）。全属性满 = 立即恢复健康，同步清倒地状态。
        const curPc = (sv.npcs || []).find(n => n.id === sv.controllerId) || (sv.npcs || []).find(n => n.isPlayer);
        if (curPc) {
            curPc.downed = false;
            curPc.alive = true;
            curPc.hp = Math.max(curPc.hp || 0, sv.maxHp || B.MAX_HP);
            curPc._penaltySec = 0;
        }
        if (sv._downed) {
            sv._downed = null;
            sv._waitDowned = false;
            sv._carryDowned = false;
        }
        if (Array.isArray(sv._downedMembers)) {
            const cid = curPc && curPc.id;
            sv._downedMembers = sv._downedMembers.filter(x => x && x !== curPc && x.id !== cid);
        }
    }
    }

    // ---------- 搜索/地图中（游戏不暂停）被僵尸咬伤：自动关闭界面（室内外通用） ----------
    // 只由僵尸咬伤（sv._zombieHitF，resolvePlayerHit 设置）触发；饥饿掉血不打断
    if (WSearch.isOpen() || WMAP.isOpen()) {
        const hit = !!sv._zombieHitF;
        sv._zombieHitF = false;
        if (hit && (sv._searchHpBase ?? -1) >= 0 && sv.hp < sv._searchHpBase) {
            WSearch.closeSearch(sv, true);
            WMAP.close();
            log('被僵尸打断了！', '#FF6644');
            AudioSystem.playZombieEating();
        }
        sv._searchHpBase = sv.hp;
    } else {
        sv._searchHpBase = -1;
        sv._zombieHitF = false;
    }

    // ---------- 室内模式 ----------
    if (sv.interior) {
        updateInteriorMode(dt);
        // 2026-08-12 v3.42 静止时角色朝向跟随准心（8 方向）
        updateAimFacing(sv);
        sv.saveT -= dt;
        if (sv.saveT <= 0) { sv.saveT = B.SAVE_INTERVAL; saveNow(); }
        sv._biting = false;   // 被啃咬标记复位（室内同室外）
        // 2026-08-11 v2.97 统一：去掉 !sv._downed 守卫（见大世界帧尾注释）
        if (sv.hp <= 0 && !sv.dead) onDeath();
        return;
    }

    // ---------- 大世界模式 ----------
    const hour = (sv.t / sv.dayLen) * 24;
    // v3.65 用户要求：尸潮机制改为"每 7 天一波，时间在 20:00~23:00 随机"（不是每天固定 20:00 准时）。
    // 仅当今天是 7 天倍数（day >= 7 且 day % 7 === 0）时为尸潮日；每天 8:00 重新用确定性 LCG 计算一个
    // 20~23 之间的随机小时存到 sv._hordeTriggerHour；到达该小时才启动尸潮。
    if (sv.opts.invasion && !sv.horde && !sv._hordeDayStarted && sv.day >= 7 && sv.day % 7 === 0) {
        if (sv._hordeTriggerHour == null) {
            const r = hash2(sv.world.seed | 0, sv.day | 0, 0x9A3F);   // 确定性（双端一致）
            sv._hordeTriggerHour = 20 + r * 3;   // 20:00 ~ 23:00
        }
        if (hour >= sv._hordeTriggerHour) {
            sv._hordeDayStarted = true;
            // 5~10 分钟倒计时提示（玩家可以看到预告）
            sv.announce = { text: `⚠ 尸潮即将来袭（约 ${(sv._hordeTriggerHour - hour).toFixed(1)} 小时后）`, t: 3.5, color: '#FF8866' };
            WH.startHordePrep(sv);
        }
    }
    if (sv.horde) WH.updateHorde(sv, dt, canStand);

    // v4.41 出门错峰：到点的队员清除 _exitQueued 恢复跟随（必须在 updateNpcs 前，否则等待中的队员被跳过）
    try { WD.exitFollowersTick(sv); } catch (e) { /* 容错 */ }
    // NPC 生态（大世界）
    WNPC.updateNpcs(sv, dt, canStand);
    // 2026-08-11 v2.98 尸体尸变检测（大世界）；v2.99 默认室外模式：只尸变室外尸体（室内尸体由室内循环负责）
    WCorpse.updateCorpseRevive(sv, dt);
    // 软核倒地救治状态机（2026-08-09）：主角倒地后队友背回床旁、玩家送药救活、超时尸变
    // 2026-08-10 软核成员倒地：无主控倒地但有倒地成员（_downedMembers）时同样驱动状态机（超时死亡）
    if (sv._downed || (sv._downedMembers && sv._downedMembers.length)) updateDowned(sv, dt, canStand);
    // 延迟刷尸推进（软核重生/超时死亡后过 3 天/1 天刷"玩家名"僵尸）
    if (sv._pzRespawn) updatePzRespawn(sv);
    // 2026-08-11 尸体搜索已复用容器 WSearch 界面（WSearch.updateSearch 在搜索/地图判定处驱动），
    // 不再需要独立 _corpseSearch 读条推进。

    // 交谈/交易中的 NPC 遇袭（附近 4 格有僵尸/恶意 NPC）：中断 UI，NPC 进入战斗/躲避
    if ((sv.npcMenu || sv.npcTrade) && sv.npcs) {
        const id = sv.npcMenu ? sv.npcMenu.id : sv.npcTrade.id;
        const npc = sv.npcs.find(n => n.id === id);
        if (npc && WNPC.threatNear(sv, npc, 4)) {
            const name = npc.name;
            if (npcMenuOpen()) closeNpcMenu();
            if (tradeOpen()) closeTrade();
            log(`${name} 遭到袭击，交谈中断！`, '#FF6644');
        }
    }

    // 2026-08-09 武器损坏改为头顶浮动提示（wgear.wearWeapon 里已 push sv.effects），不再弹修复 UI

    // 队员背包写回：储物面板关闭后把结果写回 NPC
    if (sv._npcBagWriteback && !Panel.anyOpen()) {
        const n = sv.npcs.find(m => m.id === sv._npcBagWriteback.id);
        const chest = sv.mods.chests && sv.mods.chests[sv._npcBagWriteback.key];
        if (n && chest) n.inv = chest.filter(Boolean);
        if (sv.mods.chests) delete sv.mods.chests[sv._npcBagWriteback.key];
        sv._npcBagWriteback = null;
    }

    if (sv.announce) { sv.announce.t -= dt; if (sv.announce.t <= 0) sv.announce = null; }

    // ---------- 驾驶模式：接管移动，跳过步行/动作 ----------
    if (sv.driving) {
        if (sv.driveOrder) WV.updateChauffeurDrive(sv, dt, carCanStand);   // NPC 驾驶（命令）
        else WV.updateDrive(sv, dt, sv.keys, carCanStand);                  // 玩家驾驶
        updatePrompt();
        if (sv.opts.wildSpawn && !sv.horde) WZ.updateSpawns(sv, dt, canStand);
        WZ.updateZombies(sv, dt, canStand, zCanStand,
            (z, gx, gy, m, d) => WB.damageBuilding(sv, z, gx, gy, m, d),
            (gx, gy, dmg) => WB.damageObstacle(sv, gx, gy, dmg));
        WP.updatePlants(sv, dt);
        sv.saveT -= dt;
        if (sv.saveT <= 0) { sv.saveT = B.SAVE_INTERVAL; saveNow(); }
        // 2026-08-11 v2.97 统一：去掉 !sv._downed 守卫（见大世界帧尾注释）
        if (sv.hp <= 0 && !sv.dead) onDeath();
        return;
    }

    const dashing = WA.updateActions(sv, dt, canStand);
    // 后天培养：奔跑练敏捷（累计 1 秒记一次）
    if (sv.sprinting) {
        sv._runAcc = (sv._runAcc || 0) + dt;
        if (sv._runAcc >= 1) { sv._runAcc -= 1; WNPC.addAct(sv, WNPC.controlledNpc(sv), 'run'); }
    }
    if (!dashing) {
        // 原地等待救援 / 脱离卡死引导：玩家不能移动（等待队友/真人来救；脱离卡死保持不动）
        if (sv._waitDowned || sv._unstuck) { sv.animMoving = false; }
        else {
        let { mx, my } = WA.moveInput(sv);
        if (mx || my) {
            sv.animMoving = true;   // 逐帧动画：移动中
            const len = Math.hypot(mx, my);
            mx /= len; my /= len;
            sv.faceX = mx; sv.faceY = my;
            const infEff = playerInfectionEffects(sv.infection || 0);
            const spd = B.PLAYER_SPEED * WA.moveMul(sv) * infEff.speedMul * (getTile(sv, Math.floor(sv.px / TS), Math.floor(sv.py / TS)) === T.ROAD ? B.ROAD_SPEED : 1) * B.wxMoveMul(sv._weather, B.wxLevelCur(sv));   // 天气移速系数（沙尘暴按强度 moveMul，雪雾 speedMul）
            const nx = sv.px + mx * spd * dt;
            const ny = sv.py + my * spd * dt;
            if (canStand(nx, sv.py)) sv.px = nx;
            if (canStand(sv.px, ny)) sv.py = ny;
            const ft = getTile(sv, Math.floor(sv.px / TS), Math.floor(sv.py / TS));
            if (!sv.isJumping) {
                const onGrass = ft === T.WEED || ft === T.CROP || ft === T.HERB || ft === T.FLOWER;
                const run = sv.sprinting && (mx || my);
                // side 走路（东/西向）步频更短，与 front/back 视觉帧频一致（survival.js §P3 升级）
                sv.stepT = (sv.stepT || 0) - dt;
                if (sv.stepT <= 0) {
                    sv.stepT = run ? 0.24 : (sv.faceY > 0 && Math.abs(sv.faceY) >= Math.abs(sv.faceX) ? 0.432 : (Math.abs(sv.faceX) > 0.7 ? 0.24 : 0.36));   // 朝南步频慢 20%(0.36×1.2);东西向(含向西)步频提高 50%(0.36→0.24,测试值,过快可回调 0.28/0.30);其余 0.36   // 走路周期统一 1.44s（0.36s×4 帧），跑步 0.96s（0.24s×4）——2026-08-08 用户要求 + 2026-08-09 用户测试
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % 4;   // 动画换帧与脚步同频；统一 4 帧循环（原 `isSide ? 4 : 4` 恒等死代码，见#11）
                    if (onGrass) AudioSystem.playWalkGrass();
                    else if (run) AudioSystem.playRunStep(sv.stepSide);
                    else AudioSystem.playWalkStep(sv.stepSide);
                }
            }
        } else {
            sv.animMoving = false;  // 静止回站立帧
        }
        }
    }
    // 2026-08-12 v3.42 静止时角色朝向跟随准心（8 方向）；移动时移动方向优先（updateAimFacing 内部判断）
    updateAimFacing(sv);
    // 沙尘暴风力推挤（被风吹着走；强度越大推力越强，风向随游戏小时变化 —— 站着也会缓慢滑行）
    if (sv._weather === 'sandstorm' && !sv.driving) {
        const itnW = B.wxIntensity('sandstorm', B.wxLevelCur(sv));
        const push = B.WX_WIND_PUSH * (itnW.mul || 1) * dt;
        // 2026-08-09 风向随时间变化：与粒子渲染共用 windDirAtHour（确定性双端一致）
        const wd = sv._devWind != null ? sv._devWind : B.windDirAtHour(sv.world.seed, sv.day, (sv.t / sv.dayLen) * 24);
        const wxp = sv.px + Math.cos(wd) * push;
        const wyp = sv.py + Math.sin(wd) * push;
        if (canStand(wxp, sv.py)) sv.px = wxp;
        if (canStand(sv.px, wyp)) sv.py = wyp;
    }
    unstickPlayer();

    updatePrompt();

    if (sv.opts.wildSpawn && !sv.horde) WZ.updateSpawns(sv, dt, canStand);
    if (sv.opts.wildSpawn && !sv.horde) WZ.updatePackSpawns(sv, dt, canStand);
    if (!sv.horde) WZ.updateGuardSpawns(sv, dt, canStand);
    WZ.updateZombies(sv, dt, canStand, zCanStand,
        (z, gx, gy, m, d) => WB.damageBuilding(sv, z, gx, gy, m, d),
        (gx, gy, dmg) => WB.damageObstacle(sv, gx, gy, dmg));
    WP.updatePlants(sv, dt);
    updatePlantBullets();
    if (sv.horde && sv.horde.phase === 'wave') WH.checkHordeEnd(sv, saveNow);

    WG.syncMag(sv);
    WG.updateWeapon(sv, dt);
    WG.updateBullets(sv, dt);
    sv.wpnText = WG.hudText(sv);

    sv.woodCount = countItem('wood');
    if (sv.build && sv.mouse.inside) {
        const gx = Math.floor((sv.camX + sv.mouse.x) / TS), gy = Math.floor((sv.camY + sv.mouse.y) / TS);
        sv.buildOk = WB.buildOkAt(sv, gx, gy);
    } else sv.buildOk = false;

    // 僵尸掉落战利品：走到附近触发搜索界面（动画/进度渐亮与容器一致），不再自动瞬间拾取。
    // 搜索完成前玩家拿取已揭示物品；关闭时未拿取余量留在原地（重建 contents），掏空则移除掉落。
    function tryOpenLootSearch(sv, d) {
        const contents = d.contents || [];
        if (!contents.length || WSearch.isOpen() || sv.search) return false;
        const drop = d;
        WSearch.openSearch(sv, {
            items: contents.map(it => ({ id: it.id, n: it.n, done: false })),
            name: '僵尸战利品',
            gx: Math.floor(d.x / TS), gy: Math.floor(d.y / TS),
            immediate: false,
            cap: Math.max(6, contents.length),
            onClose: (remaining) => {
                const rest = (remaining || []).filter(it => it && it.n > 0);
                drop.contents = rest;
                if (sv.mp && sv.mp.role === 'guest') {
                    // guest 搜索战利品:contents 变更上报 host(host 权威 drops → wsync 下发),掏空 host 移除
                    (sv.mpOutbox = sv.mpOutbox || []).push({
                        type: 'lootupdate', x: drop.x, y: drop.y, id: drop.id,
                        contents: rest.map(it => ({ id: it.id, n: it.n })),
                    });
                } else if (!rest.length) {
                    // 单机:掏空移除掉落
                    const idx = sv.drops.indexOf(drop);
                    if (idx >= 0) sv.drops.splice(idx, 1);
                }
            },
        }, { onUseItem: (i) => useItem(i) });
        return true;
    }

    for (let i = sv.drops.length - 1; i >= 0; i--) {
        const d = sv.drops[i];
        if (Math.hypot(d.x - sv.px, d.y - sv.py) < B.PICKUP_RADIUS) {
            if (d && d.id && d.id.startsWith('loot:')) {
                // 战利品直接拾取进背包（2026-08-09 用户要求）：不再自动打开搜索界面，
                // 拾取后到背包点击战利品袋再搜索；搜索中途强关 → 物品直接入包。
                // 2026-08-10 修复"背包满拾取战利品袋消失"：装不进背包则掉落保留在地（不 splice）。
                if (Panel.addItemLoot(sv, { id: d.id, n: d.n || 1, contents: d.contents || [] })) {
                    sv.drops.splice(i, 1);
                    Panel.refresh(sv);   // 2026-08-10 背包已打开时立即刷新显示（防止"捡了看不到"）
                    log('拾取 战利品袋（背包中点击搜索）', '#39d98a');
                } else {
                    log('背包已满，无法拾取战利品袋', '#FFB347');
                }
            } else {
                const it = Panel.getItemInfo(d.id);
                const left = Panel.addItem(sv, d.id, d.n);
                if (left < d.n) { log(`拾取 ${it.name} ×${d.n - left}`); playPickupSound(d.id); }
                if (left >= d.n && left > 0) { log(`背包已满，无法拾取 ${it.name}（剩余 ${left}）`, '#FFB347'); }   // 2026-08-10 满包拾取提示
                if (left <= 0) { sv.drops.splice(i, 1); Panel.refresh(sv); }   // 2026-08-10 背包打开时刷新显示
                else d.n = left;
            }
        }
    }

    if (sv.now - (sv._purgeT || 0) > 5) { sv._purgeT = sv.now; purgeChunks(sv, TS); }

    sv.saveT -= dt;
    if (sv.saveT <= 0) { sv.saveT = B.SAVE_INTERVAL; saveNow(); }

    // 联机 host：权威判定僵尸咬远端队友（guest 不模拟世界）
    if (sv.mp && sv.mp.role === 'host' && sv.p2) hostGuestBiteCheck(dt);

    // 2026-08-11 v2.97 修复"主控血量归零没濒死还能移动攻击"：大世界帧尾此前残留 `!sv._downed`
    // 守卫——切到队友视角后 _downed 仍指向上一个倒地主控，新主控 hp=0 时 `!_downed` 为 false，
    // onDeath 永不触发 → 主控 0 血继续移动/攻击。与室内（1118/1128）和帧尾（1258）统一：去掉守卫。
    if (sv.hp <= 0 && !sv.dead) onDeath();
}

// ================= 联机客人端更新（Phase 2 主机权威分流） =================
// guest 只推进：自己生存/移动/武器/特效/本地事件；世界实体由 wsync 快照覆写。
function updateGuest(dt) {
    // 2026-08-10 世界地图：guest 本地记录探索并上报 host（host 权威合并进世界档）
    WMAP.markExplore(sv);
    // 特效计时（wevt 注入的本地特效/音效）
    for (let i = sv.effects.length - 1; i >= 0; i--) {
        sv.effects[i].life -= dt;
        if (sv.effects[i].life <= 0) sv.effects.splice(i, 1);
    }
    // 特效数量上限（host 快照合并 + 本地特效防堆积；画质档 B：低20/中35/高50）
    const maxEffG = sv._devGfx === 0 ? 20 : sv._devGfx === 1 ? 35 : 50;
    while (sv.effects.length > maxEffG) sv.effects.shift();
    if (sv.swingT > 0) sv.swingT -= dt;
    if (sv.hurtT > 0) sv.hurtT -= dt;
    // guest 定期存档（角色档；saveNow 已按 role 分流只写角色档）——防崩溃/断电丢整局进度
    sv.saveT -= dt;
    if (sv.saveT <= 0) { sv.saveT = B.SAVE_INTERVAL; saveNow(); }
    MSG.updateMsg(sv, dt);
    if (sv.announce) { sv.announce.t -= dt; if (sv.announce.t <= 0) sv.announce = null; }

    // 感染阶段效果（本地角色）
    if (sv.infection > 0) {
        const infEff = playerInfectionEffects(sv.infection);
        const effMaxHp = Math.round(B.MAX_HP * infEff.maxHpMul);
        if (sv.hp > effMaxHp) sv.hp = effMaxHp;
        sv._infLogT = (sv._infLogT || 0) - dt;
    }

    // 2026-08-09 开局昏迷苏醒：guest 端同 host，睁眼动画期间状态冻结（不消耗、不受伤害）
    if (!wakeActive(sv)) {
    // 饱食度（随时间消耗，奔跑额外消耗）
    if (sv.food != null) {
        const mi = WA.moveInput(sv);
        let drain = B.HUNGER_DRAIN * (sv._hungerMul || 1);
        if (sv.sprinting && (mi.mx || mi.my)) drain += B.HUNGER_SPRINT_DRAIN;
        const prev = sv.food;
        if (sv._devGod) sv.food = B.HUNGER_MAX;   // 2026-08-09 属性全满持久化
        else sv.food = Math.max(0, sv.food - drain * dt);
        if (prev > B.HUNGER_LOW && sv.food <= B.HUNGER_LOW) log('有些饿了（饱食<30），移动变慢', '#FFB347');
        if (sv.food <= 0) {
            if (!sv._starved) { sv._starved = true; sv._starveLogT = 0; log('你饿坏了！尽快进食，否则持续掉血', '#FF6644'); }
            if (!sv._devGod) sv.hp = Math.max(1, sv.hp - B.HUNGER_STARVE_DMG * dt);
            sv._starveLogT -= dt;
            if (sv._starveLogT <= 0) { sv._starveLogT = 8; log('饥饿中…生命流失', '#FF6644'); }
        } else sv._starved = false;
    }

    // 水分
    if (sv.water != null) {
        const mi = WA.moveInput(sv);
        let drain = B.WATER_DRAIN;
        if (sv.sprinting && (mi.mx || mi.my)) drain += B.WATER_SPRINT_DRAIN;
        if (sv._devGod) sv.water = B.WATER_MAX;   // 2026-08-09 属性全满持久化
        else sv.water = Math.max(0, sv.water - drain * dt);
        if (sv.water <= 0) {
            if (!sv._dehydrated) { sv._dehydrated = true; sv._dehydrateLogT = 0; log('你严重缺水了！尽快喝水，否则持续掉血', '#66CCFF'); }
            if (!sv._devGod) sv.hp = Math.max(1, sv.hp - B.WATER_DEHYDRATE_DMG * dt);
            sv._dehydrateLogT -= dt;
            if (sv._dehydrateLogT <= 0) { sv._dehydrateLogT = 8; log('缺水…生命流失', '#66CCFF'); }
        } else sv._dehydrated = false;
    }

    // 生命恢复（室内模式；战斗中被咬期间暂停自愈，与室外一致——持续啃咬卡 1 血修复）
    // v3.63 阈值放宽：hp > 10 才回血（v3.62 前 >20 太严），hp 10~maxHp 线性 ramp
    if (sv.hp > 10 && sv.hp < sv.maxHp && (sv.food || 0) > 0 && (sv.water || 0) > 0 && !((sv._combatT || 0) > 0) && !sv._biting) {
        let regen = B.HP_REGEN_NATURAL;
        const fed = (sv.food || 0) >= B.HP_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, ((sv.food || 0) - B.HP_REGEN_FED_AT) / (B.HUNGER_MAX - B.HP_REGEN_FED_AT));
            regen += B.HP_REGEN_FED * ramp;
            sv.food = Math.max(0, sv.food - B.HP_REGEN_FUEL * dt);
        }
        const hpRate = Math.min(1, Math.max(0, (sv.hp - 10) / Math.max(1, sv.maxHp - 10)));
        regen *= hpRate;
        sv.hp = Math.min(sv.maxHp, sv.hp + regen * dt);
    }
    }

    // 搜索中（游戏不暂停）被僵尸咬伤（host 判定经 guestHp 下降传导）：自动关闭搜索界面
    if (WSearch.isOpen()) {
        const hit = !!sv._zombieHitF;
        sv._zombieHitF = false;
        if (hit && (sv._searchHpBase ?? -1) >= 0 && sv.hp < sv._searchHpBase) {
            WSearch.closeSearch(sv, true);
            log('被僵尸打断了！', '#FF6644');
            AudioSystem.playZombieEating();
        }
        sv._searchHpBase = sv.hp;
    } else {
        sv._searchHpBase = -1;
        sv._zombieHitF = false;
    }

    // 室内模式（guest 端本地室内模拟：探索/搜刮/室内僵尸；boxLoot 已同步）
    if (sv.interior) {
        updateInteriorMode(dt);
        // 2026-08-11 与大世界一致：去掉 _downed 守卫，hp<=0 必有结算（详见 update 大世界注释）
        if (sv.hp <= 0 && !sv.dead) onDeath();
        return;
    }

    // 驾驶模式（guest 端本地驾驶；车位置经 wpos 上报 host 渲染）
    if (sv.driving) {
        if (sv.driveOrder) WV.updateChauffeurDrive(sv, dt, carCanStand);   // NPC 驾驶（命令）
        else WV.updateDrive(sv, dt, sv.keys, carCanStand);                  // 玩家驾驶
        updatePrompt();
        // 2026-08-11 与大世界一致：去掉 _downed 守卫，hp<=0 必有结算（详见 update 大世界注释）
        if (sv.hp <= 0 && !sv.dead) onDeath();
        return;
    }

    // 玩家移动（乐观本地，即时手感；权威位置由 host 的 wsync 带回纠偏）
    const dashing = WA.updateActions(sv, dt, canStand);
    if (!dashing) {
        // 脱离卡死引导：guest 端同样保持不动
        if (sv._unstuck) { sv.animMoving = false; }
        else {
        let { mx, my } = WA.moveInput(sv);
        if (mx || my) {
            sv.animMoving = true;
            const len = Math.hypot(mx, my);
            mx /= len; my /= len;
            sv.faceX = mx; sv.faceY = my;
            const infEff = playerInfectionEffects(sv.infection || 0);
            const spd = B.PLAYER_SPEED * WA.moveMul(sv) * infEff.speedMul * (getTile(sv, Math.floor(sv.px / TS), Math.floor(sv.py / TS)) === T.ROAD ? B.ROAD_SPEED : 1) * B.wxMoveMul(sv._weather, B.wxLevelCur(sv));   // 天气移速系数（沙尘暴按强度 moveMul，雪雾 speedMul）
            const nx = sv.px + mx * spd * dt;
            const ny = sv.py + my * spd * dt;
            if (canStand(nx, sv.py)) sv.px = nx;
            if (canStand(sv.px, ny)) sv.py = ny;
            const ft = getTile(sv, Math.floor(sv.px / TS), Math.floor(sv.py / TS));
            if (!sv.isJumping) {
                const onGrass = ft === T.WEED || ft === T.CROP || ft === T.HERB || ft === T.FLOWER;
                const run = sv.sprinting && (mx || my);
                sv.stepT = (sv.stepT || 0) - dt;
                if (sv.stepT <= 0) {
                    sv.stepT = run ? 0.24 : (sv.faceY > 0 && Math.abs(sv.faceY) >= Math.abs(sv.faceX) ? 0.432 : (Math.abs(sv.faceX) > 0.7 ? 0.24 : 0.36));   // 朝南步频慢 20%(0.36×1.2);东西向(含向西)步频提高 50%(0.36→0.24,测试值,过快可回调 0.28/0.30);其余 0.36
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % 4;   // 统一 4 帧（原恒等死代码，见#11）
                    if (onGrass) AudioSystem.playWalkGrass();
                    else if (run) AudioSystem.playRunStep(sv.stepSide);
                    else AudioSystem.playWalkStep(sv.stepSide);
                }
            }
        } else sv.animMoving = false;
        }   // 闭合 _unstuck 分支
    }
    unstickPlayer();

    // 武器/子弹（自己发射的视觉与命中本地复现）
    WG.syncMag(sv);
    WG.updateWeapon(sv, dt);
    WG.updateBullets(sv, dt);
    sv.wpnText = WG.hudText(sv);

    // 交互提示（F 键：搜索/开采/开箱/开门/上车）
    updatePrompt();

    // 敌对植物弹丸命中（本地判定）
    updatePlantBullets();

    // 2026-08-09 武器损坏改为头顶浮动提示（wgear.wearWeapon 里已 push sv.effects），不再弹修复 UI

    // 队员背包写回：储物面板关闭后把结果写回 NPC
    if (sv._npcBagWriteback && !Panel.anyOpen()) {
        const n = sv.npcs.find(m => m.id === sv._npcBagWriteback.id);
        const chest = sv.mods.chests && sv.mods.chests[sv._npcBagWriteback.key];
        if (n && chest) n.inv = chest.filter(Boolean);
        if (sv.mods.chests) delete sv.mods.chests[sv._npcBagWriteback.key];
        sv._npcBagWriteback = null;
    }

    // 自己的 NPC 队伍本地模拟（跟随/状态；wsync 不同步 npcs，各自管理避免主控混乱）
    WNPC.updateNpcs(sv, dt, canStand);

    // 建造：buildOk 更新（guest 也能建房）
    sv.woodCount = countItem('wood');
    if (sv.build && sv.mouse.inside) {
        const gx = Math.floor((sv.camX + sv.mouse.x) / TS), gy = Math.floor((sv.camY + sv.mouse.y) / TS);
        sv.buildOk = WB.buildOkAt(sv, gx, gy);
    } else sv.buildOk = false;

    // 拾取掉落（自己脚下的战利品；联机 guest 捡到上报 host 移除对应掉落）
    for (let i = sv.drops.length - 1; i >= 0; i--) {
        const d = sv.drops[i];
        if (Math.hypot(d.x - sv.px, d.y - sv.py) < B.PICKUP_RADIUS) {
            if (d && d.id && d.id.startsWith('loot:')) {
                // 战利品直接拾取进背包（2026-08-09 用户要求）：不再自动打开搜索界面，
                // 拾取后到背包点击战利品袋再搜索；搜索中途强关 → 物品直接入包。
                // 2026-08-10 修复"背包满拾取战利品袋消失"：装不进背包则掉落保留（不 splice、不上报移除）。
                if (Panel.addItemLoot(sv, { id: d.id, n: d.n || 1, contents: d.contents || [] })) {
                    if (sv.mp && sv.mp.role === 'guest') {
                        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'pickup', x: d.x, y: d.y, id: d.id });
                        (sv._mpPickedDrops = sv._mpPickedDrops || new Set()).add(d.id + '@' + Math.round(d.x) + ',' + Math.round(d.y));
                    }
                    sv.drops.splice(i, 1);
                    log('拾取 战利品袋（背包中点击搜索）', '#39d98a');
                } else {
                    log('背包已满，无法拾取战利品袋', '#FFB347');
                }
            } else {
                const it = Panel.getItemInfo(d.id);
                const left = Panel.addItem(sv, d.id, d.n);
                if (left < d.n) { log(`拾取 ${it.name} ×${d.n - left}`); playPickupSound(d.id); }
                if (left <= 0) {
                    if (sv.mp && sv.mp.role === 'guest') {
                        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'pickup', x: d.x, y: d.y, id: d.id });
                        (sv._mpPickedDrops = sv._mpPickedDrops || new Set()).add(d.id + '@' + Math.round(d.x) + ',' + Math.round(d.y));
                    }
                    sv.drops.splice(i, 1);
                }
                else d.n = left;
            }
        }
    }

    // 快照僵尸位置插值（wsync 目标 _tx/_ty → 平滑移动，消除 100ms 跳变）
    for (const z of sv.zombies) {
        if (z._tx != null) { z.x += (z._tx - z.x) * 0.25; z.y += (z._ty - z.y) * 0.25; }
    }

    // 清理快照中已死的僵尸（host 权威移除，wsync 会同步；本地只清残留表现）
    for (let i = sv.zombies.length - 1; i >= 0; i--) {
        if (sv.zombies[i].hp <= 0) sv.zombies.splice(i, 1);
    }

    // chunk 缓存清理（防无限地图内存增长 → 跑久卡顿）
    if (sv.now - (sv._purgeT || 0) > 5) { sv._purgeT = sv.now; purgeChunks(sv, TS); }

    sv._biting = false;   // 帧末复位：本帧被啃咬标记（resolvePlayerBiteTick 掉血时置 true，回血块检查上一帧值）
    // 2026-08-11 修复"HP 显示 0/80 但没有濒死过程、没有结算"（用户反复反馈）：
    // 主循环原本守卫 `!sv._downed` 避免重复触发——但 `_downed` 与 `hp<=0` 同时存在是脏状态
    // （`_downed` 只由 onDeath 设置，hp<=0 应立即结算），意味着此前 onDeath 走到了半路被中断
    // （如弹窗未出、Panel.showDeathChoices 失败、外部代码 sv.dead 被改等）。若守卫拦住，
    // hp 持续被伤害源扣到 0 但永远不会触发结算 → HP 显示 0/80、世界继续跑、永远卡濒死。
    // 修复：去掉 `!sv._downed` 守卫（hp<=0 + dead=false 必触发结算），onDeath 首行识别
    // 残留 `_downed` 并清掉后走正常流程，保证血量归零必有结算。
    if (sv.hp <= 0 && !sv.dead) onDeath();
}

// 测试/调试钩子：CDP 冒烟与性能实测经此取内部状态（不参与任何游戏逻辑，仅诊断用）
export function debugGetSv() { return sv; }

// 联机事件出站队列：mpWasteland 50ms 取空发送（kill/atk 上报）
// 联机动作音效上报：本端已本地播放，outbox 带 snd 名让对端也播（双端体验一致）
function mpSfx(snd, extra) {
    if (sv && sv.mp && (sv.mp.role === 'host' || sv.mp.role === 'guest')) {
        (sv.mpOutbox = sv.mpOutbox || []).push(Object.assign({ type: 'sfx', snd }, extra || null));
    }
}

export function takeMpOutbox() {
    if (!sv || !sv.mpOutbox || !sv.mpOutbox.length) return null;
    const arr = sv.mpOutbox;
    sv.mpOutbox = [];
    return arr;
}

// 按 id 移除僵尸（host 收到 guest 击杀上报时调用，保持双端僵尸集合同步）
export function removeZombieById(id) {
    if (!sv || !id) return false;
    const i = sv.zombies.findIndex(z => z.id === id);
    if (i < 0) return false;
    const z = sv.zombies[i];
    // guest 上报的击杀：host 侧按本地击杀完整结算（与 wzombie.js 死亡处理一致：
    // 战利品掉落 + 死亡特效 + 音效），掉落物经 wsync 下发双端可见可拾
    if (Math.random() < WZ.zombieBagDropChance(z.type)) {
        const quality = WZ.rollQualityLoot(z.type);
        const contents = WZ.rollLootContents(quality, z.type);
        if (contents.length) sv.drops.push({ x: z.x, y: z.y, id: 'loot:' + quality, n: 1, contents });
    }
    // 2026-08-11 v2.98 尸变丧尸被击杀（联机）→ 掉尸变尸体（物品守恒）
    if (z._reviveFromCorpse) WCorpse.reviveZombieToCorpse(sv, z);
    // 2026-08-12 v3.9 错乱僵尸死亡结算（爆裂能力）
    WZ.corruptDeathEffects(sv, z);
    sv.effects.push({ kind: 'dead', x: z.x, y: z.y, life: 0.6, maxLife: 0.6, label: z.name });
    AudioSystem.playZombieDie();
    sv.zombies.splice(i, 1);
    return true;
}

// 应用 guest 上报的世界修改（wdiff）：host 权威写入 mods.tiles，随后 saveNow 落世界档
export function applyWorldDiff(diff) {
    if (!sv || !diff || !diff.key) return;
    if (!sv.mods.tiles) sv.mods.tiles = {};
    sv.mods.tiles[diff.key] = diff.tile;
    sv._zombiePathRevision = (sv._zombiePathRevision || 0) + 1;
}

// 联机室内：各自独立进出（不再跨端广播；同 key 确定性生成，双方室内数据天然一致）
export function inInteriorNow() { return !!(sv && sv.interior); }

// 世界修改全量（winit：guest 进入时同步房主世界基线，之后走双向 wdiff 增量）
export function getWorldMods() { return sv && sv.mods ? sv.mods : null; }
export function applyWorldMods(mods) {
    if (!sv || !mods || !mods.tiles) return;
    // 全字段展开：只铺 tiles 会丢 boxSearched（容器已搜索标记）/interiors（室内楼层进度），
    // guest 重连后已搜容器复位、室内进度丢失（联机审查 M11）
    sv.mods = {
        tiles: { ...(mods.tiles || {}) },
        chests: { ...(mods.chests || {}) },
        boxLoot: { ...(mods.boxLoot || {}) },
        plants: { ...(mods.plants || {}) },
        boxSearched: { ...(mods.boxSearched || {}) },
        interiors: { ...(mods.interiors || {}) },
        guarded: { ...(mods.guarded || {}) },
        explored: { ...(mods.explored || {}) },   // 2026-08-10 世界地图探索记录
        recipes: Array.isArray(mods.recipes) ? [...mods.recipes] : [],   // 2026-08-12 v3.8 已解锁配方
    };
}
// 2026-08-12 v3.8 联机：应用某端解锁的配方（host/guest 任一使用配方物品 → 双端 sv.mods.recipes 同步）
export function applyRecipeUnlock(recipeId) {
    if (!sv || !recipeId) return;
    if (!sv.mods.recipes) sv.mods.recipes = [];
    if (!sv.mods.recipes.includes(recipeId)) {
        sv.mods.recipes.push(recipeId);
        saveNow();
    }
}

// 2026-08-10 世界地图：host 权威合并 guest 上报的探索区块（world 档随存）
export function applyExplore(cx, cy) {
    if (!sv || !sv.mods) return;
    if (!sv.mods.explored) sv.mods.explored = {};
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        sv.mods.explored[(cx + dx) + ',' + (cy + dy)] = 1;
    saveNow();
}

// 箱子/搜索容器内容同步（存取时 wevt 上报，host/guest 双向应用）
export function applyChestSync(key, items) {
    if (!sv || !key) return;
    if (!sv.mods.chests) sv.mods.chests = {};
    sv.mods.chests[key] = Array.isArray(items) ? items : [];
}
export function applyBoxLootSync(key, items, searched) {
    if (!sv || !key) return;
    if (!sv.mods.boxLoot) sv.mods.boxLoot = {};
    sv.mods.boxLoot[key] = items;
    if (searched !== undefined) {
        if (!sv.mods.boxSearched) sv.mods.boxSearched = {};
        sv.mods.boxSearched[key] = !!searched;
    }
}
// 植物变更应用（双向：guest 种/伤害/收割上报 host 权威，host 应用后 wsync 回传）
export function applyPlantSync(key, p) {
    if (!sv || !key) return;
    if (!sv.mods.plants) sv.mods.plants = {};
    if (p && typeof p.hp === 'number') {
        sv.mods.plants[key] = { hp: p.hp, maxHp: p.maxHp, species: p.species, growth: p.growth, type: p.type, atkT: 0, hostile: p.type === 'neutral', sunT: 0 };
    } else {
        delete sv.mods.plants[key];
    }
}

// v4.26 掉落系统已拆到 wloot.js（removeDrop / addDrop / updateLootDrop / reportChestChange / reportBoxLootChange）

// ---- DEV 测试辅助（联机验证脚本用，仅开发期调用） ----
export function debugSpawnZombies(n) {
    if (!sv || !sv.active) return 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (5 + Math.random() * 3) * TS;
        const x = sv.px + Math.cos(ang) * d, y = sv.py + Math.sin(ang) * d;
        if (canStand(x, y)) { WZ.spawnZombie(sv, 'normal', x, y, false); c++; }
    }
    return c;
}
export function debugGetZombies() {
    return sv ? sv.zombies.map(z => ({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), hp: Math.round(z.hp) })) : [];
}
export function debugKillZombie(idx) {
    if (!sv || !sv.zombies[idx]) return false;
    sv.zombies[idx].hp = 0;
    return true;
}
export function debugSetTile(gx, gy, t, built) {
    if (!sv) return false;
    setTile(sv, gx, gy, t, built);
    return true;
}
export function debugGetMods() {
    return sv ? Object.keys(sv.mods.tiles || {}) : [];
}
export function debugDrop(id, n, x, y) {
    if (!sv) return false;
    sv.drops.push({ x: x != null ? x : sv.px, y: y != null ? y : sv.py, id, n });
    return true;
}
export function debugLog(msg) {
    if (!sv) return false;
    log(msg, '#7DFF7D');
    return true;
}
export function debugGetDrops() {
    return sv ? sv.drops.map(d => ({ x: Math.round(d.x), y: Math.round(d.y), id: d.id, n: d.n })) : [];
}
export function debugGetMsgs() {
    return sv && Array.isArray(sv.msgs) ? sv.msgs.map(m => m.text).slice(-6) : [];
}
export function debugAddPlant(species) {
    if (!sv) return false;
    const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
    setTile(sv, gx, gy, T.PLOT, true);   // 铺种植盆（合法地块，避免 updatePlants 清理）
    sv.mods.plants = sv.mods.plants || {};
    sv.mods.plants[gx + ',' + gy] = { hp: 50, maxHp: 50, species: species || 'peashooter', growth: 50, type: 'player', atkT: 0, hostile: false, sunT: 0 };
    // 模拟 ensurePlant 的 guest 上报（真实种植走 wplants.ensurePlant → reportPlantChange）
    if (sv.mp && sv.mp.role === 'guest') {
        const p = sv.mods.plants[gx + ',' + gy];
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'plant', key: gx + ',' + gy, p: { hp: p.hp, maxHp: p.maxHp, species: p.species, growth: p.growth, type: p.type } });
    }
    return true;
}
export function debugGetPlants() {
    return sv && sv.mods.plants ? Object.keys(sv.mods.plants) : [];
}
export function debugSetChest(key, items) {
    if (!sv) return false;
    sv.mods.chests = sv.mods.chests || {};
    sv.mods.chests[key] = items;
    return true;
}
export function debugGetChest(key) {
    return sv && sv.mods.chests && sv.mods.chests[key] ? JSON.stringify(sv.mods.chests[key]) : null;
}
export function debugSetJump(off) {
    if (!sv) return false;
    sv.jumpOffset = (off != null ? off : 40);   // 模拟跳跃中（40px 高度）
    sv.isJumping = true;
    return true;
}
export function debugCamp(x, y) {
    if (!sv) return false;
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'camp', x, y });
    return true;
}
export function debugGetCamp() {
    return sv && sv.camp ? { x: sv.camp.x, y: sv.camp.y } : null;
}
export function debugBroadcastDead(who) {
    if (!sv) return false;
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'dead', who: who || 'host' });
    return true;
}
export function debugStartDrive() {
    if (!sv) return false;
    sv.driving = { key: '0,0', gx: 0, gy: 0, driver: null, owner: null, x: sv.px, y: sv.py, dir: 0, speed: 0, hp: 100, maxHp: 100, fuel: 100 };
    return true;
}
export function debugEndDrive() { if (!sv) return false; sv.driving = null; return true; }
export function debugEnterInterior() {
    if (!sv) return false;
    sv.interior = { key: 'test', floor: 1, w: 16, h: 16, tiles: new Uint8Array(256).fill(1), px: 72, py: 72, drops: [], zombies: [], originX: 0, originY: 0, t: sv.t, day: sv.day };
    return true;
}
export function debugExitInterior() { if (!sv) return false; sv.interior = null; return true; }
export function debugFx(kind, x, y, label) {
    if (!sv) return false;
    sv.effects.push({ kind: kind || 'hit', x: x != null ? x : sv.px, y: y != null ? y : sv.py, life: 0.5, maxLife: 0.5, label: label || null });
    return true;
}
export function debugGetEffects() {
    return sv ? sv.effects.map(e => e.kind).slice(-8) : [];
}
export function debugEnterInteriorReal(key) {
    if (!sv) return false;
    WD.enterInterior(sv, key || '0,0', false);   // 真实路径（含联机广播）
    return true;
}
export function debugBullet(x, y) {
    if (!sv) return false;
    sv.bullets.push({ id: 'b' + ((sv._bIdSeq = (sv._bIdSeq || 0) + 1)), x: x != null ? x : sv.px, y: y != null ? y : sv.py, vx: 100, vy: 0, damage: 5, color: '#FFD700', label: '·', life: 1.2, range: 9999, pierce: 0, pierced: 0, hitList: null, spin: false, traveled: 0 });
    return true;
}
export function debugGetBullets() {
    return sv ? sv.bullets.map(b => b.id).slice(-5) : [];
}
export function debugGetInterior() {
    return sv && sv.interior
        ? { key: sv.interior.key, floor: sv.interior.floor, w: sv.interior.w, h: sv.interior.h, zombies: sv.interior.zombies.length, px: Math.round(sv.interior.px), py: Math.round(sv.interior.py) }
        : null;
}
export function debugTeleport(x, y) {
    if (!sv) return false;
    if (typeof x === 'number') sv.px = x;
    if (typeof y === 'number') sv.py = y;
    return true;
}
export function debugGetZombieInterp() {
    return sv && sv.zombies[0] ? { hasTx: '_tx' in sv.zombies[0], x: Math.round(sv.zombies[0].x), tx: Math.round(sv.zombies[0]._tx || sv.zombies[0].x) } : null;
}
export function debugFindDoor() {
    // 找玩家附近 200 格内的建筑门（DOOR tile），返回 doorKey "gx,gy"
    if (!sv) return null;
    const cx = Math.floor(sv.px / TS), cy = Math.floor(sv.py / TS);
    for (let r = 1; r <= 200; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (getTile(sv, cx + dx, cy + dy) === T.DOOR) return (cx + dx) + ',' + (cy + dy);
        }
    }
    return null;
}
export function debugBuildHouse() {
    // 玩家附近造一栋 8x8 建筑（外墙+地板+门），返回门 key（供 enterInterior 用）
    if (!sv) return null;
    const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
    for (let y = -1; y <= 8; y++) for (let x = -1; x <= 8; x++) setTile(sv, gx + x, gy + y, T.WALL, true);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) setTile(sv, gx + x, gy + y, T.FLOOR, true);
    const doorKey = gx + ',' + gy;
    setTile(sv, gx, gy, T.DOOR, true);
    return doorKey;
}
export function debugGetInteriorInfo() {
    if (!sv || !sv.interior) return { in: false };
    const it = sv.interior;
    const pgx = Math.floor(it.px / TS), pgy = Math.floor(it.py / TS);
    // 找 EXIT 格与楼梯格
    let exits = [], stairs = [];
    for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
        const t = it.tiles[y * it.w + x];
        if (t === 3) exits.push(x + ',' + y);
        if (t === 6 || t === 7) stairs.push((t === 6 ? 'D' : 'U') + x + ',' + y);
    }
    return {
        in: true, px: Math.round(it.px), py: Math.round(it.py),
        pgx, pgy, tile: it.tiles[pgy * it.w + pgx], floor: it.floor,
        w: it.w, h: it.h, zombies: it.zombies.length,
        exits: exits.slice(0, 3), stairs: stairs.slice(0, 3),
        zNear: it.zombies.slice(0, 3).map(z => ({ x: Math.round(z.x), y: Math.round(z.y), hp: Math.round(z.hp) })),
    };
}
export function debugGetBoxLootKey(key) {
    return sv && sv.mods.boxLoot && sv.mods.boxLoot[key] !== undefined ? JSON.stringify(sv.mods.boxLoot[key]) : null;
}
export function debugSetBoxLoot(key, items) {
    if (!sv) return false;
    if (!sv.mods.boxLoot) sv.mods.boxLoot = {};
    sv.mods.boxLoot[key] = items;
    reportBoxLootChange(key);
    return true;
}
export function debugRollBox(boxType, gx, gy) {
    // 确定性箱内容验证：同一 (boxType,gx,gy) 双端应返回相同内容
    try {
        return JSON.stringify(rollBoxContents(boxType, gx, gy));
    } catch (e) {
        return 'THROW: ' + e.message;
    }
}

// ---- dev 同步调试 ----
export function debugGetDev() {
    if (!sv) return null;
    return {
        god: !!sv._devGod, stamina: !!sv._devInfStamina, inf: sv._devInf !== false,
        ammo: !!sv._devInfAmmo, oneshot: !!sv._devOneShot, bag: !!sv._devInfBag,
        dmgMul: sv._devDmgMul || 1, timeScale: sv._devTimeScale || 1,
    };
}
export function debugSetDevFlag(key, val) {
    if (!sv) return false;
    const map = { god: '_devGod', stamina: '_devInfStamina', inf: '_devInf', ammo: '_devInfAmmo', oneshot: '_devOneShot', bag: '_devInfBag', dmgMul: '_devDmgMul', timeScale: '_devTimeScale' };
    const k = map[key];
    if (!k) return false;
    sv[k] = val;
    // 模拟 wdev 点击路径：本地改 + 上报（guest 才上报；host 走 wsync）
    if (sv.mp && sv.mp.role === 'guest') {
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'devflags', flags: {
            god: !!sv._devGod, stamina: !!sv._devInfStamina, inf: sv._devInf !== false,
            ammo: !!sv._devInfAmmo, oneshot: !!sv._devOneShot, bag: !!sv._devInfBag,
            dmgMul: sv._devDmgMul || 1, timeScale: sv._devTimeScale || 1,
        }});
    }
    return true;
}
export function debugReportFx(kind, x, y) {
    if (!sv || !sv.mp) return false;
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'fx', kind: kind || 'muzzle', x: x || sv.px, y: y || sv.py, angle: 0, color: '#FFD700', label: '砰', ghosts: 1 });
    return true;
}
export function debugReportDevCmd(cmd, arg) {
    if (!sv || !sv.mp) return false;
    // npc 用 kind、time 用 op——都带（消费方按需读取）
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'devcmd', cmd, kind: arg, op: arg });
    return true;
}
export function debugCountNpcs() {
    return sv ? (sv.npcs ? sv.npcs.length : 0) : -1;
}
export function debugCountZombies() {
    if (!sv) return -1;
    return sv.interior ? sv.interior.zombies.length : sv.zombies.length;
}
// 3+ 人多队友槽诊断（联机测试用）
export function debugP2s() {
    if (!sv || !sv.p2s) return null;
    const out = {};
    for (const pid in sv.p2s) {
        const g = sv.p2s[pid];
        out[pid] = g && typeof g.tx === 'number' ? { x: Math.round(g.tx), y: Math.round(g.ty), name: g.name || null, hp: g.hp != null ? g.hp : null } : null;
    }
    return out;
}
export function debugCancelDrive() {
    if (!sv) return false;
    sv.driveOrder = null;
    if (sv.driving) sv.driving._route = null;
    return true;
}
export function debugGetSeed() {
    return sv && sv.world ? sv.world.seed : null;
}
export function debugGetModTile(gx, gy) {
    if (!sv || !sv.mods || !sv.mods.tiles) return null;
    const m = sv.mods.tiles[gx + ',' + gy];
    return m ? JSON.stringify(m) : null;
}
export function debugRoadBandDiag() {
    // 诊断：玩家附近 3×3 区块，路带格（rx<4||ry<4）的 tile 分布（查"路中间人行道"）
    if (!sv) return 'no-sv';
    const seed = sv.world.seed;
    const pgx = Math.floor(sv.px / TS), pgy = Math.floor(sv.py / TS);
    const cx0 = Math.floor(pgx / CHUNK) - 1, cy0 = Math.floor(pgy / CHUNK) - 1;
    const stats = {};
    const sideInRoad = [];
    let roadBand = 0;
    for (let cy = cy0; cy <= cy0 + 2; cy++) for (let cx = cx0; cx <= cx0 + 2; cx++) {
        const BL = blockAt(seed, cx, cy);
        const dk = districtAt(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
            const gx = cx * CHUNK + lx, gy = cy * CHUNK + ly;
            const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
            if (rx < 4 || ry < 4) {
                roadBand++;
                const t = getTile(sv, gx, gy);
                stats[t] = (stats[t] || 0) + 1;
                if (t === T.SIDEWALK) sideInRoad.push(gx + ',' + gy + '(' + dk + ')');
            }
        }
    }
    return JSON.stringify({ roadBand, stats, sideInRoad: sideInRoad.slice(0, 12), sideCount: sideInRoad.length });
}
export function debugBfsProbe(sx, sy, tgx, tgy) {
    // 直接跑车 BFS（起点格 sx,sy 中心右侧，终点 tgx,tgy），返回完整结果
    if (!sv) return 'no-sv';
    const chk = WV.buildChauffeurPath(sv, (sx + 1) * TS, (sy + 0.5) * TS, tgx, tgy, 12);
    return JSON.stringify({
        goal: chk.goal, bestX: chk.bestX, bestY: chk.bestY,
        expanded: chk.expanded, pathLen: chk.path ? chk.path.length : 0,
    });
}
export function debugRoadStats() {
    // 诊断废墟路网：车附近 60 格 ROAD/RUBBLE/可走/障碍统计 + 目标方向沿途 tile
    if (!sv) return 'no-sv';
    const seed = sv.world.seed;
    const pgx = Math.floor(sv.px / TS), pgy = Math.floor(sv.py / TS);
    let road = 0, rubble = 0, walk = 0, wall = 0, total = 0;
    for (let dy = -60; dy <= 60; dy += 3) for (let dx = -60; dx <= 60; dx += 3) {
        const t = getTile(sv, pgx + dx, pgy + dy);
        total++;
        if (t === T.ROAD) road++;
        else if (t === T.RUBBLE) rubble++;
        else if (isWalk(t)) walk++;
        else wall++;
    }
    const along = [];
    for (let s = 10; s <= 128; s += 10) {
        const tx = pgx + Math.round(s * 0.62), ty = pgy + Math.round(s * 0.98);
        along.push(s + ':' + getTile(sv, tx, ty));
    }
    return JSON.stringify({ pgx, pgy, seed, stats: { road, rubble, walk, wall, total }, along });
}
export function debugPickTarget(dest) {
    // 诊断：pickDriveTarget 的选点结果（目标距玩家格数 + 区域）
    if (!sv) return 'no-sv';
    return WNPC.debugPickTarget(sv, dest);
}
export function debugGetDriveOrder() {
    if (!sv || !sv.driveOrder) return null;
    const o = sv.driveOrder;
    const gx = Math.floor(o.tx / TS), gy = Math.floor(o.ty / TS);
    return {
        dest: o.dest, label: o.label,
        targetArea: districtAt(sv.world.seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK)),
        fromArea: districtAt(sv.world.seed, Math.floor(sv.px / TS / CHUNK), Math.floor(sv.py / TS / CHUNK)),
        tgx: gx, tgy: gy,
        chk: o._chkInfo || null,
    };
}
export function debugMakeOwnedCar() {
    // 玩家附近开阔地造一辆"已修复+有归属"的车（供 startDriveOrder 测试），返回 key
    // 车 2 格宽 + BFS 起点在车右格：要求车体 (gx..gx+1)×(gy..gy+1) 与前方 3 格
    // (gx+2..gx+4)×(gy..gy+1) 全部可走（车能开出 + BFS 能向东扩展）
    if (!sv) return null;
    // 造车前清掉存档残留的归属车（避免旧测试车/窄缝车干扰选车）
    for (const k in sv.mods.tiles) {
        const m = sv.mods.tiles[k];
        if (m && m.t === T.CAR && m.owner) delete sv.mods.tiles[k];
    }
    const pgx = Math.floor(sv.px / TS), pgy = Math.floor(sv.py / TS);
    for (let r = 1; r <= 16; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const gx = pgx + dx, gy = pgy + dy;
            let open = true;
            for (let oy = 0; oy <= 1 && open; oy++) for (let ox = 0; ox <= 4 && open; ox++) {
                if (!isWalk(getTile(sv, gx + ox, gy + oy))) open = false;
            }
            if (!open) continue;
            const key = gx + ',' + gy;
            setTile(sv, gx, gy, T.CAR, true);
            sv.mods.tiles[key] = { t: T.CAR, repaired: true, owner: 'debug-driver', dir: 0, hp: 100, fuel: 100 };
            return key;
        }
    }
    return null;
}
export function debugDriveOrder(dest) {
    // 用主控 NPC 当司机发驾驶命令；返回命令结果（目标点 + 区域判定）
    if (!sv) return 'no-sv';
    let driver = null;
    let driverInfo = 'none';
    if (sv.controllerId && sv.npcs) {
        driver = sv.npcs.find(n => n.id === sv.controllerId);
        if (driver) driverInfo = 'controllerId:' + Math.round(driver.x) + ',' + Math.round(driver.y);
    }
    if (!driver && sv.npcs && sv.npcs.length) {
        driver = sv.npcs.find(n => n.alive && !n.riding) || sv.npcs[0];
        if (driver) driverInfo = 'fallback[' + driver.id + ']:' + Math.round(driver.x) + ',' + Math.round(driver.y);
    }
    if (!driver) return 'no-driver';
    const ok = WNPC.startDriveOrder(sv, driver, dest);
    if (!ok || !sv.driveOrder) return 'order-failed driver=' + driverInfo;
    const o = sv.driveOrder;
    return JSON.stringify({
        ok: true, dest, label: o.label, driver: driverInfo, carKey: o.carKey,
        tx: Math.round(o.tx), ty: Math.round(o.ty),
        tgx: Math.floor(o.tx / TS), tgy: Math.floor(o.ty / TS),
    });
}

// ================= 联机快照应用（guest 端，wsync 到达时调用） =================
// 覆写世界实体（僵尸/NPC/昼夜/尸潮阶段）+ host 玩家到 sv.p2 + guest 权威 hp 纠偏。
// 室内各自独立进出后，host 与 guest 可能身处不同空间（一人在室内一人在室外）：
// 只有空间一致时才同步实体（僵尸/子弹/掉落/植物/特效），否则保留本地空间数据。
export function applyMpSnapshot(snap, guestId) {
    if (!sv || !snap) return;
    // 昼夜（host 权威，guest 不再本地推）
    if (typeof snap.t === 'number') { sv.t = snap.t; sv.day = snap.day || sv.day; }
    // 天气（host 权威确定性；guest 渲染同款）+ 强度覆盖（dev 手动，host 权威）+ 事件视觉
    if (typeof snap.weather === 'string') sv._weather = snap.weather;
    if (typeof snap.wxLevel === 'number') sv._wxLevel = snap.wxLevel;
    else if (snap.wxLevel === null) sv._wxLevel = null;
    // 2026-08-10 季节（host 权威 → guest 草地渲染同款；旧快照无 season 则保持本地）
    if (typeof snap.season === 'number') sv._season = snap.season;
    // 大字公告（天气切换提示等，host 权威 → guest 同显；t 由双端各自衰减）
    if (snap.announce) sv.announce = { text: snap.announce.text, t: snap.announce.t, color: snap.announce.color || null };
    sv._evt = snap.evt ? { type: snap.evt.type, endT: snap.evt.endT } : null;
    // 尸潮阶段
    sv.horde = snap.hordePhase ? { phase: snap.hordePhase } : null;
    const spaceMatch = (!!sv.interior) === (!!snap.inInterior);
    // NPC 是大世界实体（与室内空间无关）：空间不匹配时也应用（guest 在室内时跳过）
    if (Array.isArray(snap.npcs) && !sv.interior) applyNpcSnapshot(snap.npcs);
    else if (Array.isArray(snap.npcPos) && !sv.interior) applyNpcPosUpdate(snap.npcPos);
    if (!spaceMatch) {
        // 空间不匹配：只同步全局时钟/玩家/hp/dev，实体保持本地（各自空间的实体互不可见）
        // 例：host 在室内 → 快照带室内僵尸；guest 在室外 → 跳过，避免室内僵尸写进室外数组
        syncHostPlayerAndGuestHp(snap, guestId);
        applySnapDevFlags(snap.dev);
        return;
    }
    // 僵尸：按 id 合并（保留本地表现字段 + 位置插值 _tx/_ty），新 id 追加，缺失 id 移除。
    // 合并核心抽到 wstate.js mergeZombieList（纯函数），smoke-test 可单测（P0-3）
    if (Array.isArray(snap.zombies)) {
        const target = snap.inInterior && sv.interior ? sv.interior.zombies : sv.zombies;
        const merged = mergeZombieList(target, snap.zombies);
        if (snap.inInterior && sv.interior) sv.interior.zombies = merged;
        else sv.zombies = merged;
    }
    // 子弹弹道（host 的子弹同步：移除上次的 host 子弹 + 追加新快照；guest 自己子弹保留）
    if (Array.isArray(snap.bullets)) {
        for (let i = sv.bullets.length - 1; i >= 0; i--) if (sv.bullets[i]._mpHost) sv.bullets.splice(i, 1);
        for (const b of snap.bullets) sv.bullets.push({ ...b, _mpHost: true });
    }
    // 软核倒地救治状态（host 权威：倒地位置/药品累计/超时，双端一致 §5.1）
    if (snap.downed && typeof snap.downed === 'object') {
        sv._downed = {
            name: snap.downed.name || null,
            px: snap.downed.px || 0, py: snap.downed.py || 0,
            dayDead: snap.downed.dayDead || 0,
            med: snap.downed.med || 0, herb: snap.downed.herb || 0,
            _pzScheduled: snap.downed._pzScheduled || 0,
            // 2026-08-11 v2.97 现实时间救援倒计时（双端同步，guest 端同样按 sv.now 推进）
            downedAtReal: snap.downed.downedAtReal != null ? snap.downed.downedAtReal : (sv.now != null ? sv.now : 0),
            _penaltySec: snap.downed._penaltySec || 0,
        };
    } else if (snap.downed === null && sv._downed) {
        sv._downed = null;   // host 端已清除（救活/超时），guest 同步清除
    }
    // 掉落物（host 权威覆写：怪物掉落/背包丢出/wdev 生成全同步给 guest）
    if (Array.isArray(snap.drops)) {
        // 掉落覆写时过滤"已上报 pickup 但 host 尚未移除"的掉落（指纹 id@x,y 与 host
        // removeDrop 匹配一致）——防 guest 在 100ms 快照窗口内重复拾取同一掉落刷物品（M5）
        const picked = sv._mpPickedDrops;
        if (picked && picked.size) {
            const fps = new Set(snap.drops.map(d => d.id + '@' + Math.round(d.x) + ',' + Math.round(d.y)));
            for (const f of [...picked]) if (!fps.has(f)) picked.delete(f);   // host 已移除 → 清标记
            sv.drops = snap.drops.filter(d => !picked.has(d.id + '@' + Math.round(d.x) + ',' + Math.round(d.y))).map(d => ({ ...d }));
        } else {
            sv.drops = snap.drops.map(d => ({ ...d }));
        }
    }
    // 植物（host 权威覆写：品种/血量/生长度/类型；产阳光走 drops 已同步）
    if (Array.isArray(snap.plants)) {
        const np = {};
        for (const p of snap.plants) {
            np[p.key] = { hp: p.hp, maxHp: p.maxHp, species: p.species, growth: p.growth, type: p.type, atkT: 0, hostile: false, sunT: 0 };
        }
        sv.mods.plants = np;
    }
    // 特效（host 的 muzzle/hit/爆炸/防反等短命特效同步给 guest：
    // 按 kind+位置(12px 桶) 匹配已存在的只更新 life，否则追加；guest 本地特效保留、自然消亡）
    // 性能：原实现每快照特效线性 find（O(n²)，50 特效 ≈ 2500 次比较/100ms）→ 键控 Map O(1)
    if (Array.isArray(snap.effects)) {
        const fxOf = (e) => e.kind + '@' + Math.round((e.x || 0) / 12) + ',' + Math.round((e.y || 0) / 12);
        const exMap = new Map();
        for (const l of sv.effects) exMap.set(fxOf(l), l);
        for (const e of snap.effects) {
            const ex = exMap.get(fxOf(e));
            if (ex) { ex.life = e.life; ex.maxLife = e.maxLife; if (e.label) ex.label = e.label; }
            else sv.effects.push({ kind: e.kind, x: e.x, y: e.y, life: e.life, maxLife: e.maxLife, radius: e.radius, label: e.label, angle: e.angle, tx: e.tx, ty: e.ty, color: e.color, ghosts: e.ghosts });
        }
    }
    // NPC（host 权威：视野内 + 队伍/雇佣常驻；guest 本地 AI 对 _mpRemote 停摆，只渲染）——空间无关，已在前面应用
    syncHostPlayerAndGuestHp(snap, guestId);
    applySnapDevFlags(snap.dev);
    // 3+ 人：其他 guest 位置随快照下发 → 写入本端 p2s（渲染多队友；跳过自己的槽防双影）
    if (Array.isArray(snap.teammates)) {
        for (const t of snap.teammates) {
            if (guestId && t.guestId === guestId) continue;
            setRemotePlayerState(t, t.guestId);
        }
    }
}

// 快照中与空间无关的部分：host 玩家（→ sv.p2）与 guest 权威 hp / dev 标志
function syncHostPlayerAndGuestHp(snap, guestId) {
    // host 玩家 → sv.p2（复用位置同步入口，全字段：动画/跳跃/开车/格挡/室内标记）
    if (snap.hostPlayer && typeof snap.hostPlayer.x === 'number') {
        const h = snap.hostPlayer;
        setRemotePlayerState({ ...h, name: h.name || '房主' });
    }
    // 3+ 人：按 guestId 取自己的权威血量（host 按队友槽独立下发）；1v1 回退 guestHp
    let myHp = null;
    if (snap.guestsHp && guestId && typeof snap.guestsHp[guestId] === 'number') myHp = snap.guestsHp[guestId];
    else if (typeof snap.guestHp === 'number') myHp = snap.guestHp;
    // guest 权威 hp（host 判定僵尸咬伤后下发；host 在室内时 guest 各自本地，不覆写）
    // 原则：只处理"下降"（被咬）与死亡，回血/饥饿/口渴保留 guest 本地值（修复高危 #3）
    if (myHp != null && !sv.interior) {
        if (myHp <= 0) {
            sv.hp = 0;   // host 判定死亡：必须同步
            sv._mpLastGuestHp = 0;
        } else if (sv._mpLastGuestHp != null && myHp < sv._mpLastGuestHp) {
            // hp 比上次低 → 视为被僵尸咬伤：搜索界面打开时自动打断（与单机 resolvePlayerHit 一致）
            sv._zombieHitF = true;
            sv.hurtT = 0.3;
            sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 0.2, maxLife: 0.2, label: '击' });
            AudioSystem.playPlayerHurt();   // 与单机受击反馈一致（联机 guest 被咬同样播音效）
            sv.hp = myHp;
            sv._mpLastGuestHp = myHp;
        } else {
            // 未下降（含本地回血后 host 值反而更低）：保留本地 hp，仅更新记录值
            sv._mpLastGuestHp = Math.max(sv._mpLastGuestHp || 0, myHp);
        }
    }
}

// ---------- NPC 快照应用（guest 侧；host 权威） ----------
// 合并策略：同 id 覆写全字段（位置/血量/动作/雇佣态等）；新 id 创建；快照缺失的本地
// NPC 移除——但保留：自己（isPlayer）、自己正操控的 NPC、刚本地雇佣待 host 回认的（_mpHoldUntil）
function applyNpcSnapshot(list) {
    if (!sv || !sv.npcs) return;
    const seen = new Set();
    for (const d of list) {
        if (!d || !d.id) continue;
        seen.add(d.id);
        let n = sv.npcs.find(m => m.id === d.id);
        if (!n) { n = {}; sv.npcs.push(n); }
        Object.assign(n, d);
        n._mpRemote = true;            // guest 本地 AI 停摆标记（wnpc.updateNpcs 跳过）
        n._tx = d.x; n._ty = d.y;      // 位置插值目标（渲染帧 lerp，与僵尸同款平滑）
    }
    const keepCtl = (sv.controllerId && sv.controllerId !== 'player') ? sv.controllerId : null;
    for (let i = sv.npcs.length - 1; i >= 0; i--) {
        const n = sv.npcs[i];
        if (n.isPlayer) continue;                        // 自己的名册记录：本端权威
        if (keepCtl && n.id === keepCtl) continue;       // 自己正操控：本端权威（位置经 npcctl 上报）
        if (n._mpHoldUntil && n._mpHoldUntil > (sv.now || 0)) continue;   // 刚雇佣待 host 回认
        if (!seen.has(n.id)) sv.npcs.splice(i, 1);
    }
}

// NPC 轻量帧（每 100ms）：只更新已介绍 NPC 的位置/血量/动作，防移动卡顿
function applyNpcPosUpdate(list) {
    if (!sv || !sv.npcs) return;
    for (const d of list) {
        if (!d || !d.id) continue;
        const n = sv.npcs.find(m => m.id === d.id);
        if (!n || !n._mpRemote) continue;   // 未知 id 等全量拍介绍；非远程 NPC 不覆盖
        n._tx = d.x; n._ty = d.y;
        n.hp = d.hp;
        n.swingT = d.swingT || 0; n.swingDir = d.swingDir || 0; n.swingWeapon = d.swingWeapon || null;
        n.hurtT = d.hurtT || 0;
        if (d.state) n.state = d.state;
        if (d.act) n.act = d.act;
    }
}

// 开发者标志（host 权威共用）：直接应用（面板按钮由 mpWasteland 调 WDEV.applyDevSync 刷新）
function applySnapDevFlags(dev) {
    if (!dev) return;
    sv._devGod = !!dev.god;
    sv._devInfStamina = !!dev.stamina;
    sv._devInf = dev.inf !== false;
    sv._devInfAmmo = !!dev.ammo;
    sv._devOneShot = !!dev.oneshot;
    sv._devInfBag = !!dev.bag;
    sv._devDmgMul = dev.dmgMul || 1;
    sv._devTimeScale = dev.timeScale || 1;
    sv._devInfDura = !!dev.dura;   // 2026-08-09 无限耐久（联机同步）
    sv._devWind = dev.wind != null ? dev.wind : null;   // 2026-08-09 风向覆盖（联机同步）
}

// host 应用 guest 上报的弹幕特效（muzzle 枪口火光等）：host 端 effects → wsync 回传双端可见
export function applyFxEvent(evt) {
    if (!sv || !evt || !evt.kind) return;
    sv.effects.push({
        kind: evt.kind, x: evt.x, y: evt.y,
        angle: evt.angle || 0, color: evt.color || null, label: evt.label || null,
        ghosts: evt.ghosts || 1, life: 0.12, maxLife: 0.12,
    });
}

// host 应用 guest 上报的开发者标志（共用：无敌/无限弹药等）；同时镜像到 p2 供咬伤判定
export function applyDevFlags(flags) {
    if (!sv || !flags) return;
    sv._devGod = !!flags.god;
    sv._devInfStamina = !!flags.stamina;
    sv._devInf = flags.inf !== false;
    sv._devInfAmmo = !!flags.ammo;
    sv._devOneShot = !!flags.oneshot;
    sv._devInfBag = !!flags.bag;
    sv._devDmgMul = flags.dmgMul || 1;
    sv._devTimeScale = flags.timeScale || 1;
    sv._devInfDura = !!flags.dura;   // 2026-08-09 无限耐久（联机同步）
    sv._devWind = flags.wind != null ? flags.wind : null;   // 2026-08-09 风向覆盖（联机同步）
    // p2 镜像（host 判定僵尸咬远端队友时，无敌/一击必杀等共同生效）
    if (sv.p2) {
        sv.p2._devGod = !!flags.god;
        sv.p2._devInfAmmo = !!flags.ammo;
        sv.p2._devOneShot = !!flags.oneshot;
    }
}

// host 应用 guest 交易后的 NPC 背包/金币覆写（guest 端成交，host 覆写保持一致）
export function applyNpcInvSync(id, inv, coins) {
    if (!sv || !sv.npcs || !id) return;
    const n = sv.npcs.find(m => m.id === id);
    if (!n) return;
    if (Array.isArray(inv)) n.inv = inv;
    if (typeof coins === 'number') n.coins = coins;
}

// guest 操控 NPC（切换视角）：取状态供上报 host（host 对该 NPC 让渡 AI）
export function getMpControlledNpc() {
    if (!sv || !sv.npcs || !sv.controllerId || sv.controllerId === 'player') return null;
    const n = sv.npcs.find(m => m.id === sv.controllerId);
    if (!n || !n.alive) return null;
    return { id: n.id, x: n.x, y: n.y, hp: n.hp };
}

// host 应用 guest 操控 NPC 的位置上报（短暂让渡本地 AI，防位置拉扯）
export function applyNpcCtl(evt) {
    if (!sv || !sv.npcs || !evt || !evt.id) return;
    const n = sv.npcs.find(m => m.id === evt.id);
    if (!n || !n.alive) return;
    n.x = evt.x; n.y = evt.y; n.tx = evt.x; n.ty = evt.y;
    if (typeof evt.hp === 'number') n.hp = evt.hp;
    n._mpCtlT = 1.5;
}

// host 应用 guest 上报的雇佣（M2，NPC/营地跟世界档）：
// 同 id NPC 设置雇佣态；host 无该 NPC（各自本地生成）则按上报数据创建——
// host 权威世界状态 → host 世界档持久化（guest 重连/下次同种子世界，雇佣关系不再丢）
export function applyHireEvent(evt) {
    if (!sv || !evt || !evt.npc) return;
    const d = evt.npc;
    const n = (sv.npcs || []).find(x => x.id === d.id && x.alive);
    if (n) {
        n.hired = true; n.party = true;
        n.hireFee = d.hireFee; n.state = 'follow'; n._paidDay = sv.day;
    } else {
        sv.npcs.push({
            ...d,
            alive: true,   // 上报数据无 alive 字段：雇佣必为存活，显式补齐（防被 n.alive 检查过滤）
            hired: true, party: true, state: 'follow', _paidDay: sv.day,
            bornDay: sv.day, age: 1, _grown: false,
            atkCd: 0, hurtT: 0, idleT: 0, workT: 0, campTask: null, _nextNeed: 2,
        });
    }
}

// ================= 联机事件播放（wevt，guest 端即时复现） =================
export function playMpEvent(evt) {
    if (!sv || !evt) return;
    switch (evt.type) {
        case 'kill': {
            // 僵尸击杀：音效 + 特效（与本地击杀同款的 dead 特效，带僵尸名）
            // guest 室内本地击杀的转发回包去重（_mpLocalKills）：本地已播过音效/特效，不重复
            if (sv._mpLocalKills) {
                const ki = sv._mpLocalKills.indexOf(evt.id);
                if (ki >= 0) { sv._mpLocalKills.splice(ki, 1); break; }
            }
            const z = sv.zombies.find(z2 => z2.id === evt.id);
            const x = z ? z.x : (evt.x || sv.px), y = z ? z.y : (evt.y || sv.py);
            sv.effects.push({ kind: 'dead', x, y, life: 0.6, maxLife: 0.6, label: z ? z.name : '亡' });
            AudioSystem.playZombieDie();
            break;
        }
        case 'day':
            log(`第 ${evt.day} 天开始了`, '#FFD700');
            break;
        case 'msg':
            // 房主播报 → 客人显示（节流已在 host 侧做）
            if (evt.text) log(evt.text, evt.color || null);
            break;
        case 'pause':
            // 对方暂停/继续：静默应用（完整创建/隐藏暂停面板，不广播防回环）
            if (sv && typeof evt.paused === 'boolean' && pauseOpen !== evt.paused) togglePause(true);
            break;
        case 'dead':
            // 对方死亡 → 本端结算退出（R7：任一玩家死亡 → 双端结束）
            log(evt.who === 'host' ? '房主倒下了，游戏结束' : '队友倒下了，游戏结束', '#FF5544');
            setTimeout(() => exitWasteland(true), 1200);
            break;
        case 'camp':
            if (evt.x != null) sv.camp = { x: evt.x, y: evt.y, id: evt.id || ('camp_' + evt.x + '_' + evt.y) };
            break;
        case 'horde':
            log('尸潮来袭！准备防守！', '#FF6666');
            AudioSystem.playZombieSpawn();
            break;
        case 'loot':
            // 开箱掉落：播放提示 + 音效（掉落物本体由 host 端 sv.drops 判定，
            // guest 端提示即可；物品拾取在 guest 端本地走 Panel）
            if (evt.items && evt.items.length) {
                log(`搜刮到 ${evt.items.map(i => Panel.getItemInfo(i.id).name).join('、')}`, '#39d98a');
                AudioSystem.playCollect();
            }
            break;
        case 'fx':
            if (evt.label) sv.effects.push({ kind: evt.kind || 'fx', x: evt.x || sv.px, y: evt.y || sv.py, life: evt.life || 0.4, maxLife: evt.life || 0.4, label: evt.label });
            break;
    }
}

// ================= 室内模式更新 =================
function interiorCanStand(x, y) {
    return WD.interiorCanStand(sv, x, y);
}

function withInteriorZombies(fn) {
    if (!sv.interior) return fn();
    const wz = sv.zombies;
    sv.zombies = sv.interior.zombies;
    const r = fn();
    sv.zombies = wz;
    return r;
}

function updateInteriorMode(dt) {
    const it = sv.interior;
    if (!it) return;

    // v4.51 NPC 拾取室内生效：室内掉落存放在 it.drops，而 updateNpc 里的 npcPickupDrops
    // 统一读 sv.drops——这里临时把 sv.drops 指向 it.drops，函数末尾恢复（v3.39 sv.zombies 思路）。
    sv._outdoorDropsBackup = sv.drops;
    sv.drops = it.drops || (it.drops = []);

    // v4.37 队员【陆续跟随】穿入（每个 0.5/0.9/1.3s 间隔）：把已到期 queued 的队员
    // 从 _enterInteriorQueued 实际 push 到 inInterior，到出生点旁空位（不等瞬移）。
    try { WD.enterFollowersTick(sv, it, (it.spawnX + 0.5) * TS, (it.spawnY + 0.5) * TS); } catch (e) { /* 容错 */ }

    // 先同步到 sv 坐标：闪现/格挡/跳跃共用同一套动作系统，
    // 若在这之后再覆盖 sv.px=it.px，会把闪现(Q)的位移整个抹掉（室内闪避失效）
    sv.px = it.px;
    sv.py = it.py;

    const dashing = WA.updateActions(sv, dt, interiorCanStand);
    if (!dashing) {
        // 2026-08-09 室内外一致：原地等待救援（倒地主角视角）不能移动；脱离卡死引导保持不动
        if (sv._waitDowned || sv._unstuck) { sv.animMoving = false; }
        else {
        let { mx, my } = WA.moveInput(sv);
        if (mx || my) {
            const len = Math.hypot(mx, my) || 1;
            mx /= len; my /= len;
            sv.animMoving = true;              // 与室外一致：移动中标记（驱动走动动画）
            sv.faceX = mx; sv.faceY = my;       // 与室外一致：记录朝向（动画方向）
            const spd = B.PLAYER_SPEED * WA.moveMul(sv);
            const nx = sv.px + mx * spd * dt;
            const ny = sv.py + my * spd * dt;
            if (interiorCanStand(nx, sv.py)) sv.px = nx;
            if (interiorCanStand(sv.px, ny)) sv.py = ny;
            if (!sv.isJumping) {
                const run = sv.sprinting && (mx || my);
                // 与室外同款动画：室内也要推进 animFrame（否则走动时动画帧冻结，
                // 脚步音效在放但小人停在原地，室内外动画不同步）
                sv.stepT = (sv.stepT || 0) - dt;
                if (sv.stepT <= 0) {
                    sv.stepT = run ? 0.24 : (sv.faceY > 0 && Math.abs(sv.faceY) >= Math.abs(sv.faceX) ? 0.432 : (Math.abs(sv.faceX) > 0.7 ? 0.24 : 0.36));   // 朝南步频慢 20%(0.36×1.2);东西向(含向西)步频提高 50%(0.36→0.24,测试值,过快可回调 0.28/0.30);其余 0.36
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % 4;   // 统一 4 帧（原恒等死代码，见#11）
                    if (run) AudioSystem.playRunStep(sv.stepSide);
                    else AudioSystem.playWalkStep(sv.stepSide);
                }
            }
        } else {
            sv.animMoving = false;             // 静止回站立帧（与室外一致）
        }
        }   // 闭合 _waitDowned 分支
    }
    it.px = sv.px;
    it.py = sv.py;

    // v4.16 室内相机（与 drawInterior 同源 computeInteriorCam）：小房间居中、大房间玩家居中
    // 此前 ox = (960 - totalW) / 2 写死，大房间（>画布，玩家自建超大房）被裁剪（玩家走出屏幕）
    // 必须与 render.drawInterior 算出同一份 ox/oy，否则 sv.camX/camY（外部代码用）与 draw 内部偏移不一致
    const _cam = WD.computeInteriorCam(sv, 960, 540);
    sv.camX = -_cam.ox;
    sv.camY = -_cam.oy;

    WD.updateInterior(sv, dt);
    if (!sv.interior) return;
    // 2026-08-10 室内外 NPC 逻辑完全一致：直接复用室外同款 updateNpc 分发
    // （party+follow→followAI 自主战斗/跟随游荡；hostile→hostileAI；其余→campOrWanderAI），
    // 只是 canStand 换成 interiorCanStand、sv.zombies 换成室内僵尸。此前只驱动 follow 队员
    // 且行为简化，导致室内队员不攻击僵尸等差异。躲藏者（未招募，it.npcs）仍保持不动。
    const worldZombies = sv.zombies;
    sv._worldZombies = worldZombies;   // v3.30 供尸变检测把室外尸体生成的丧尸放进室外世界数组（防瞬移）
    sv.zombies = it.zombies;   // 提前替换为室内僵尸：让战斗 AI 打室内僵尸（室内外行为一致）
    // 2026-08-12 v3.39 修复"室内战斗掉落的物品队伍成员不捡"：
    // npcScavengeDrops 只扫 sv.drops，而室内击杀僵尸掉落的物品进 it.drops（windoor 882）。
    // 此前室内模式没像 sv.zombies 那样替换 sv.drops → 室内掉落成员完全无视、只有玩家手动捡。
    // 与 sv.zombies = it.zombies 同思路：室内把 sv.drops 临时指向 it.drops（恢复在下方）。
    const worldDrops = sv.drops;
    sv.drops = Array.isArray(it.drops) ? it.drops : (it.drops = []);
    const controller = WNPC.controlledNpc(sv);
    if (sv.npcs && sv.npcs.length) {
        for (const n of sv.npcs) {
            if (!n.alive || n.riding) continue;
            if (!n.inInterior) continue;   // 只在室内的 NPC 由室内驱动
            if (n.downed) {
                // v4.49 室内外一致（v4.33"感染不会在倒地时停下"定稿）：倒地期间感染继续增长，
                // 感染满在救援时间结束前直接死亡尸化。室外由 updateNpc downed 分支推进（wnpc.js:377）；
                // 室内原 `continue` 跳过 → 倒地队员感染永不推进（只在救援超时才死）——不对称缺陷修复。
                WNPC.updateNpcInfection(sv, n, dt);
                continue;
            }
            if (n._mpRemote) continue;     // 联机 guest：host 权威 NPC，本地 AI 停摆只渲染（与室外一致）
            if (controller && n.id === controller.id) continue;   // 主控由玩家操控
            // v4.35 楼层隔离：只驱动当前楼层的 NPC。不同楼层共享坐标空间，若不隔离，
            // 玩家上楼后旧楼层队员仍被本循环驱动 → 朝"2 楼玩家坐标"移动卡墙 + 锁定当前楼层僵尸
            // → "看不到人影却能对二楼及以上的僵尸造成伤害"。
            // 队员上下楼由 changeFloor 同步（interiorFloor 同步切到新楼层），这里总是同楼层。
            if ((n.interiorFloor == null ? 1 : n.interiorFloor) !== (it.floor || 1)) continue;
            // 与室外 updateNpcs 一致：战斗/跟随/游荡/营地 全走同一条 updateNpc 管线
            WNPC.updateNpc(sv, n, dt, interiorCanStand, sv.camp, controller);
        }
    }
    // 2026-08-11 v2.98 尸体尸变检测（室内：倒地尸体在室内同样 15 分钟尸变）
    // v2.99 传 'indoor'：只尸变当前房间的室内尸体（防室内坐标被当室外坐标生成、瞬移到主控身边）
    WCorpse.updateCorpseRevive(sv, dt, 'indoor');
    WG.syncMag(sv);
    WG.updateWeapon(sv, dt);
    WG.updateBullets(sv, dt);
    // 2026-08-10 修复"室内 NPC 子弹不动/不消失"：室内模式此前从不驱动 NPC 子弹，
    // 必须在 sv.zombies 恢复为世界僵尸之前调用（NPC 子弹要打室内僵尸）
    WNPC.updateNpcBullets(sv, dt);
    sv.zombies = worldZombies;
    sv.drops = worldDrops;   // v3.39 恢复室外掉落数组（室内驱动结束后）

    it.px = sv.px;
    it.py = sv.py;
    // 2026-08-12 v3.37 修复"室内外主控不同步"：室内模式此前从不写回主控记录
    //（大世界 updateNpcs 每帧 syncControlledToRecord，室内 updateInteriorMode 缺失）→
    // 主控在室内掉血/拾取/移动后，存档（serializeNpcs 用记录）读档回退到进屋时状态、
    // 切视角（switchControl 载入用记录）位置/背包丢失。帧尾与室外一致写回。
    const _ctrl = WNPC.controlledNpc(sv);
    if (_ctrl) WNPC.syncControlledToRecord(sv, _ctrl);
    sv.wpnText = WG.hudText(sv);
    // 2026-08-10 修复"室内死亡切视角后濒死不结束/反复切换"：
    // 室内模式此前从不调用 updateDowned → 倒地主角的全灭检测/超时尸变在室内完全不运行，
    // 导致：① 倒地主控永不超时（一直"濒死但活"）；② 队友在室内陆续死亡时无人判定全员死亡 →
    // 反复弹选择框切视角，感觉无敌。补上：室内也用同一套倒地状态机（全灭→全员死亡结算）。
    if (sv._downed || (sv._downedMembers && sv._downedMembers.length)) updateDowned(sv, dt, interiorCanStand);
    // 室内交互目标（黄色光圈提示：F 会和哪个箱子/幸存者交互，与室外一致）
    updateInteriorPrompt();
    // v4.51 恢复室外掉落引用（室内期间 sv.drops 临时指向 it.drops）
    sv.drops = sv._outdoorDropsBackup;
}

// 计算室内 F 交互目标（与 doInteriorInteract 的判定一致：先最近躲藏幸存者，再 3×3 内箱子）
// 结果存 it.promptTarget 供 render 画黄色光圈。
// v4.63.4 抽公共函数 syncInteriorPrompt：根据 it.promptTarget 类型生成 sv.prompt（室内文字提示）。
// 必须在 updateInteriorPrompt 每个 return 前调用（各分支提前 return，末尾追加同步逻辑会被跳过）。
function syncInteriorPrompt(sv, it) {
    if (sv._bodyAct && sv._bodyAct.opts && sv._bodyAct.opts.length) return;   // 选择框路径已单独设 sv.prompt
    if (!it.promptTarget) { sv.prompt = null; return; }
    const _pt = it.promptTarget;
    if (_pt.downed && sv._downed) {
        sv.prompt = sv._carryDowned ? `放下 ${sv._downed.name}` : `救治 ${sv._downed.name}`;
    } else if (_pt.stairs) {
        sv.prompt = _pt.dir > 0 ? '上楼' : '下楼';
    } else if (_pt.corpse != null) {
        const _m = sv.npcs && sv.npcs.find(x => x && x.id === _pt.corpse);
        sv.prompt = _m ? `搜索 ${_m.name} 的尸体` : '搜索尸体';
    } else if (_pt.bodyAct) {
        const _m = sv.npcs && sv.npcs.find(x => x && x.id === _pt.bodyAct);
        sv.prompt = _m ? `处理 ${_m.name}（${_m.downed ? '倒地' : '躺地'}）` : '处理躺地 NPC';
    } else if (_pt.mate || _pt.npc) {
        const _m = sv.npcs && sv.npcs.find(x => x && x.id === _pt.id);
        if (_m) sv.prompt = _m.party ? `命令 ${_m.name}` : `交谈 ${_m.name}`;
        else sv.prompt = '交谈';
    } else if (_pt.x != null && _pt.y != null) {
        // 箱子等 tile
        const _at = it.tiles && it.tiles[_pt.y * it.w + _pt.x];
        const _LABEL = {
            [WD.INTERIOR_TILES.BOX]: '搜索物资箱', [WD.INTERIOR_TILES.WBOX]: '搜索木箱',
            [WD.INTERIOR_TILES.MEDBOX]: '搜索医疗箱', [WD.INTERIOR_TILES.MATBOX]: '搜索弹药箱'
        };
        sv.prompt = _LABEL[_at] || '打开';
    } else {
        sv.prompt = null;
    }
}

function updateInteriorPrompt() {
    const it = sv.interior;
    if (!it) return;
    // v4.61 选择框自动关闭守卫（室内对称）：距离/状态/候选失效 → 关闭
    if (sv._bodyAct && sv._bodyAct.opts && sv._bodyAct.opts.length) {
        const _ba = sv._bodyAct;
        const _m = sv.npcs && sv.npcs.find(x => x && x.id === _ba.npcId);
        const _downed = !!(_m && _m.downed);
        const _corpse = !!(_m && _m._corpse);
        const _revived = !!(_m && (_m._revived || _m._revivedCorpse));
        if (!_m) { sv._bodyAct = null; }
        else {
            const _d = Math.hypot(_m.x - it.px, _m.y - it.py);
            if (_d >= 1.0 * TS) { sv._bodyAct = null; }
            else if (!(_m.inInterior && _m.interiorKey === it.key && (_m.interiorFloor == null ? 1 : _m.interiorFloor) === (it.floor || 1))) { sv._bodyAct = null; }
            else if (_ba.state === '倒地' && !_downed) { sv._bodyAct = null; }
            else if (_ba.state === '待尸变' && (!_corpse || _revived)) { sv._bodyAct = null; }
            else if (!_isBodyActCandidate(sv, _m)) { sv._bodyAct = null; }
            else {
                // v4.62.1 室内选择框打开期间【强制锁定 promptTarget = bodyAct 并立即返回】：
                // 与室外对称——不继续走每帧重算（会因指针移开导致 promptTarget 变成别的物体，
                // F 确认时 tg.bodyAct 不满足 → 执行别的交互）。锁定后 F 始终确认当前 sel。
                it.promptTarget = { bodyAct: _ba.npcId };
                sv.prompt = `选择 对 ${_ba.name} 的操作（${_ba.opts[_ba.sel] ? _ba.opts[_ba.sel].label : ''}）[按F确认]`;
                return;
            }
        }
    }
    it.promptTarget = null;
    // v4.41 统一"指针指向优先"模型；v4.43 用户定稿"所有物体交互优先级一致，包括NPC"：
    // 去掉类型优先级表，全部候选按"鼠标到目标距离"取最近（带滞回锁定防金框乱跳）；
    // 楼梯扫描从全房间 O(w*h) 改为玩家周围 5×5（性能优化），NPC 扫描合并为单遍。
    const _mousePos = (sv.mouse && sv.mouse.x != null && sv.camX != null)
        ? { x: sv.camX + sv.mouse.x, y: sv.camY + sv.mouse.y } : null;
    // 倒地主控在室内（供 ③ 无鼠标回退 + ① aim 命中使用）
    const _downedHere = !!(sv._downed && Math.hypot(sv._downed.px - it.px, sv._downed.py - it.py) < 1.0 * TS);

    // v4.43 性能优化：鼠标/玩家室内位置/楼层都未移动时，复用上一帧 hits（省每帧 npcs 遍历）。
    const _aimMX0 = sv.mouse && sv.mouse.x, _aimMY0 = sv.mouse && sv.mouse.y;
    const _aimMoved = _aimMX0 !== sv._lastAimX || _aimMY0 !== sv._lastAimY
        || it.px !== sv._lastAimPx || it.py !== sv._lastAimPy
        || it.floor !== sv._lastAimFloor;
    sv._lastAimX = _aimMX0; sv._lastAimY = _aimMY0;
    sv._lastAimPx = it.px; sv._lastAimPy = it.py;
    sv._lastAimFloor = it.floor;

    // ---------- ① 收集所有指针命中候选（单遍扫描 + 所有类型一视同仁） ----------
    let _aimHits = null;
    if (!_aimMoved && Array.isArray(sv._aimLastHits)) {
        _aimHits = sv._aimLastHits;
    } else {
        _aimHits = [];
    }
    if (_mousePos) {
        const _pgx = Math.floor(it.px / TS), _pgy = Math.floor(it.py / TS);
        // 倒地主控（指针指向倒地主角 → 救治提示）
        if (sv._downed && Math.hypot(sv._downed.px - it.px, sv._downed.py - it.py) < 1.0 * TS) {
            const dd = Math.hypot(_mousePos.x - sv._downed.px, _mousePos.y - sv._downed.py);
            if (dd <= 26) _aimHits.push({ key: 'downed', d: dd, target: { type: 'downed' } });
        }
        // 躲藏幸存者
        if (it.npcs) for (const n of it.npcs) {
            if (!n || n.hp <= 0) continue;
            if (Math.hypot(n.x - it.px, n.y - it.py) > 1.0 * TS) continue;
            const dd = Math.hypot(_mousePos.x - n.x, _mousePos.y - n.y);
            if (dd <= 26) _aimHits.push({ key: 'npc:' + n.id, d: dd, target: { type: 'hiddenNpc', id: n.id, x: n.x, y: n.y } });
        }
        // 楼梯（v4.43 只扫玩家周围 5×5，替代原全房间 O(w*h) 每帧扫描）
        // v4.64.4 用户定稿"以玩家为中心 3×3 九宫格，玩家必须站在九宫格内才能扫描到交互物"：
        // 5×5 → 3×3——超出九宫格（如 5×5 对角线 dx=2/dy=2）的楼梯不再被指针 aim 命中，
        // 玩家必须走进九宫格（含对角格）才能金框/F 交互。
        {
            let bestS = null, bdS = TS * 0.8;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const gx = _pgx + dx, gy = _pgy + dy;
                if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
                const tile = it.tiles[gy * it.w + gx];
                if (tile !== WD.INTERIOR_TILES.STAIRS_UP && tile !== WD.INTERIOR_TILES.STAIRS_DOWN) continue;
                const dcx = (gx + 0.5) * TS, dcy = (gy + 0.5) * TS;
                const dd = Math.hypot(_mousePos.x - dcx, _mousePos.y - dcy);
                if (dd < bdS) { bdS = dd; bestS = { gx, gy, dir: tile === WD.INTERIOR_TILES.STAIRS_UP ? 1 : -1 }; }
            }
            if (bestS) _aimHits.push({ key: 'stairs:' + bestS.gx + ',' + bestS.gy, d: bdS, target: { type: 'stairs', x: bestS.gx, y: bestS.gy, dir: bestS.dir } });
        }
        // 箱子格（指针指向格，3×3 内）
        {
            const agx = Math.floor(_mousePos.x / TS), agy = Math.floor(_mousePos.y / TS);
            if (Math.abs(agx - _pgx) <= 1 && Math.abs(agy - _pgy) <= 1 && agx >= 0 && agx < it.w && agy >= 0 && agy < it.h) {
                const at = it.tiles[agy * it.w + agx];
                if (at === WD.INTERIOR_TILES.BOX || at === WD.INTERIOR_TILES.WBOX
                    || at === WD.INTERIOR_TILES.MEDBOX || at === WD.INTERIOR_TILES.MATBOX) {
                    const dd = Math.hypot(_mousePos.x - (agx + 0.5) * TS, _mousePos.y - (agy + 0.5) * TS);
                    _aimHits.push({ key: 'box:' + agx + ',' + agy, d: dd, target: { type: 'box', x: agx, y: agy } });
                }
            }
        }
        // 队员 / 尸体（单遍遍历 sv.npcs）
        if (sv.npcs) for (const n of sv.npcs) {
            if (!n) continue;
            const dd = Math.hypot(_mousePos.x - n.x, _mousePos.y - n.y);
            if (dd > 26) continue;
            if (Math.hypot(n.x - it.px, n.y - it.py) > 1.0 * TS) continue;
            if (n._corpse && !n.downed
                && n.inInterior && n.interiorKey === it.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === (it.floor || 1)) {
                _aimHits.push({ key: 'corpse:' + n.id, d: dd, target: { type: 'corpse', id: n.id, x: n.x, y: n.y } });
            } else if (n.alive && !n.downed && n.inInterior && !(sv.controllerId && n.id === sv.controllerId)) {
                _aimHits.push({ key: 'mate:' + n.id, d: dd, target: { type: 'mate', id: n.id, x: n.x, y: n.y } });
            }
        }
        // 躺地 NPC 选择框：仅【指针指向】的才弹（未指向返回 null，把金框让给其他物体）
        const aimBody = computeBodyAct(sv, _mousePos);
        if (aimBody && aimBody.d != null) {
            _aimHits.push({ key: 'bodyAct:' + aimBody.npcId, d: aimBody.d, target: { type: 'bodyAct', v: aimBody } });
        }
    }
    if (_aimMoved) sv._aimLastHits = _aimHits;   // 缓存本次结果（仅重算时更新）

    // ---------- ② 统一"指针命中最近者优先"（所有类型优先级一致 + 滞回锁定防金框乱跳） ----------
    const _picked = _pickAim(sv, _aimHits);
    if (_picked) {
        const t = _picked.target;
        // v4.57 修复"指针指到躺地 NPC 自动弹 UI"：与室外一致，sv._bodyAct 只能由 openBodyActFor 显式设置，
        // 指针命中只画金框（promptTarget.bodyAct），让"必须按 F 才弹"语义贯穿室内外。
        // v4.59 修复"选择框只闪一帧"：与室外相同——sv._bodyAct 已开（用户正选中）且命中同一 npc 时不清空。
        if (!(sv._bodyAct && t.type === 'bodyAct' && t.v && t.v.npcId === sv._bodyAct.npcId)) {
            sv._bodyAct = null;
        }
        if (t.type === 'downed') { it.promptTarget = { downed: 1, x: Math.floor(sv._downed.px / TS), y: Math.floor(sv._downed.py / TS) }; syncInteriorPrompt(sv, it); return; }
        if (t.type === 'bodyAct') { it.promptTarget = { bodyAct: t.v.npcId, x: t.v.x, y: t.v.y, aim: 1 }; syncInteriorPrompt(sv, it); return; }
        if (t.type === 'corpse') { it.promptTarget = { corpse: t.id, x: t.x, y: t.y, aim: 1 }; syncInteriorPrompt(sv, it); return; }
        if (t.type === 'hiddenNpc') { it.promptTarget = { npc: 1, id: t.id, x: t.x, y: t.y, aim: 1 }; syncInteriorPrompt(sv, it); return; }
        if (t.type === 'stairs') { it.promptTarget = { stairs: 1, x: t.x, y: t.y, dir: t.dir, aim: 1 }; syncInteriorPrompt(sv, it); return; }
        if (t.type === 'box') { it.promptTarget = { x: t.x, y: t.y }; syncInteriorPrompt(sv, it); return; }
        if (t.type === 'mate') { it.promptTarget = { npc: 1, mate: 1, id: t.id, x: t.x, y: t.y, aim: 1 }; syncInteriorPrompt(sv, it); return; }
    }

    // ---------- ③ 无指针命中 → 距离回退（原优先级：倒地主控 > 躺地NPC > 躲藏幸存者 > 楼梯 > 箱子 > 队员 > 尸体） ----------
    if (_downedHere) {
        it.promptTarget = { downed: 1, x: Math.floor(sv._downed.px / TS), y: Math.floor(sv._downed.py / TS) };
        syncInteriorPrompt(sv, it);
        return;
    }
    // v4.58.1 室内倒地队友距离回退：与室外对称——靠近倒地队友（指针未命中）金框选中 + F 弹交互框
    if (sv.npcs && sv.npcs.length) {
        let best = null, bd = 1.0 * TS;
        for (const n of sv.npcs) {
            if (!n || !n.alive || !n.downed) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (!(n.inInterior && n.interiorKey === it.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === (it.floor || 1))) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { it.promptTarget = { bodyAct: best.id, x: best.x, y: best.y }; syncInteriorPrompt(sv, it); return; }
    }
    // v4.52 用户定稿："靠近倒下的队友不会自动弹出选择框，只有交互（F/扫描点击）才弹"——
    // 距离回退不再自动 computeBodyAct（不会靠近自动弹框），选择框只能由 F 交互或扫描面板点击打开。
    // v4.56 不再无条件清空 sv._bodyAct：F 交互打开的选择框保留到用户选择/关闭。
    if (it.npcs && it.npcs.length) {
        let best = null, bd = 1.0 * TS;
        for (const n of it.npcs) {
            if (!n || n.hp <= 0) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { it.promptTarget = { npc: 1, id: best.id, x: best.x, y: best.y }; syncInteriorPrompt(sv, it); return; }
    }
    {
        // v4.43 楼梯扫描限定玩家周围 5×5（替代原全房间 O(w*h) 每帧扫描）
        // v4.64.0 用户反馈"楼梯交互距离比其它交互物远"（箱子 3×3 ≈0.7*TS vs 楼梯 1.9*TS）：
        // 楼梯距离回退 1.9*TS → 1.4*TS（≈100px，仅楼梯，其余交互物不动）。
        // v4.64.1 用户进一步定稿"以交互对象为中心 + 周围 8 格 3×3 九宫格内"：1.4*TS 仍超出
        // 九宫格对角最大距离 √2*TS ≈ 1.0*TS。改为 1.0*TS，扫描范围 5×5 → 3×3。
        const _pgx = Math.floor(it.px / TS), _pgy = Math.floor(it.py / TS);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const gx = _pgx + dx, gy = _pgy + dy;
            if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
            const tile = it.tiles[gy * it.w + gx];
            if (tile !== WD.INTERIOR_TILES.STAIRS_UP && tile !== WD.INTERIOR_TILES.STAIRS_DOWN) continue;
            const dcx = (gx + 0.5) * TS, dcy = (gy + 0.5) * TS;
            if (Math.hypot(it.px - dcx, it.py - dcy) < 1.0 * TS) {
                it.promptTarget = { stairs: 1, x: gx, y: gy, dir: tile === WD.INTERIOR_TILES.STAIRS_UP ? 1 : -1 };
                syncInteriorPrompt(sv, it);
                return;
            }
        }
    }
    const pgx = Math.floor(it.px / TS), pgy = Math.floor(it.py / TS);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = pgx + dx, gy = pgy + dy;
        if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
        const at = it.tiles[gy * it.w + gx];
        if (at !== WD.INTERIOR_TILES.BOX && at !== WD.INTERIOR_TILES.WBOX
            && at !== WD.INTERIOR_TILES.MEDBOX && at !== WD.INTERIOR_TILES.MATBOX) continue;
        it.promptTarget = { x: gx, y: gy };
        syncInteriorPrompt(sv, it);
        return;
    }
    if (sv.npcs && sv.npcs.length) {
        let best = null, bd = 1.0 * TS;
        for (const n of sv.npcs) {
            if (!n.alive || !n.inInterior) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (n.downed) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { it.promptTarget = { npc: 1, mate: 1, id: best.id, x: best.x, y: best.y }; syncInteriorPrompt(sv, it); return; }
    }
    if (sv.npcs && sv.npcs.length) {
        let best = null, bd = 1.0 * TS;
        for (const n of sv.npcs) {
            if (!n || !n._corpse || n.downed) continue;
            if (!(n.inInterior && n.interiorKey === it.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === (it.floor || 1))) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { it.promptTarget = { corpse: best.id, x: best.x, y: best.y }; syncInteriorPrompt(sv, it); return; }
    }
    // v4.63.4 无命中 → 清空 sv.prompt（避免保留上一帧提示文字）
    sv.prompt = null;
}

// ================= F 统一交互 =================
const INTERACT_LABEL = {
    [T.BOX]: '搜索物资箱', [T.HERB]: '采集草药', [T.TREE]: '伐木',
    [T.DOOR]: '进入室内', [T.BED]: '休息（回血并存档）', [T.FLOWER]: '采集阳光',
    [T.CABINET]: '打开储物柜', [T.SPROUT]: '中立植物（攻击会反击！）',
    [T.WATER]: '采集水', [T.PLOT]: '培养植物（需种子+水+肥料+阳光）',
    [T.WBOX]: '搜索武器箱', [T.MEDBOX]: '搜索医疗箱', [T.MATBOX]: '搜索建材箱',
    [T.CROP]: '采集作物', [T.CAR]: '操作汽车', [T.CARWRECK]: '拆解报废车',
    [T.TRASHBIN]: '翻找垃圾桶', [T.CARDBOX]: '翻找纸箱',
    [T.HYDRANT]: '拧开消防栓', [T.NEWSSTAND]: '翻找报刊亭',
    // 轮胎（T.TIRES）为纯障碍物，不可交互，不进提示表
};

// 2026-08-12 v3.43 扫描面板只收集"交互会弹 UI 界面"的交互体（用户定稿：扫描的是弹出 UI 的那种交互）：
// 过滤纯采集类（草药/伐木/阳光/水/作物/中立植物 = 按 F 直接采集加物品，不弹 UI）。
const SCAN_UI_TILES = new Set([
    T.BOX, T.CABINET, T.DOOR, T.BED, T.WBOX, T.MEDBOX, T.MATBOX,
    T.CAR, T.CARWRECK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.PLOT,
]);

// 街道容器是否仍可交互：轮胎不可；消防栓搜过即空不再交互；纸箱/报刊亭/垃圾桶（小储物）始终可交互
function containerInteractable(t, tx, ty) {
    if (t === T.TIRES) return false;
    if (t === T.CARDBOX || t === T.NEWSSTAND || t === T.TRASHBIN) return true;   // 始终可交互（搜索→储物）
    if (t === T.HYDRANT) {   // 消防栓：未取过水才可交互
        return !(sv.mods.boxLoot && sv.mods.boxLoot[tx + ',' + ty]);
    }
    return true;
}

// 容器是否已搜索过（含已转为储物箱 / 已掏空）：之后按储物箱处理（可随时打开存取）
function isSearchedContainer(t, tx, ty) {
    if (!CONTAINER_LOOT_POOLS[t]) return false;
    const key = tx + ',' + ty;
    if (sv.mods.chests && sv.mods.chests['box:' + key]) return true;
    return !!(sv.mods.boxLoot && sv.mods.boxLoot[key]);
}

// ================= v4.33 躺地 NPC 交互选择框（搜索/补刀/救治） =================
// 用户定稿："NPC倒地状态下可以对Ta进行两种交互，靠近时弹出交互的小UI框，通过鼠标中键（滚轮）
// 上下选择——搜索还是补刀；NPC包括友善、中立、敌对的"。靠近倒地/躺尸 NPC 时：
//   · 倒地待救成员（alive && downed）→ 救治（仅 party）/ 搜索（搜刮身上物品）/ 补刀（击杀阻止尸变）
//   · 已死待尸变/普通尸体（!alive && _corpse && !_revived）→ 搜索（搜刮遗物）/ 补刀（阻止尸变）
//   · 主控本人倒地（sv._downed）不进入选择框（走 updatePrompt 上方的救治/背起流程）
// 结果存 sv._bodyAct = { npcId, name, state, opts:[{act,label}], sel }，由 render.drawBodyAct 绘制。
// v4.41 躺地 NPC 候选判定（倒地待救成员 / 已死待尸变/普通尸体，友善/中立/敌对全部覆盖；
// 排除主控本人倒地与 sv._downed 倒地主控——他们走救治/背起流程，不弹选择框）
function _isBodyActCandidate(sv, m) {
    if (!m) return false;
    const isDowned = m.alive && m.downed;
    const isCorpse = !m.alive && m._corpse && !m._revived && !m._revivedCorpse;
    if (!isDowned && !isCorpse) return false;
    if (sv.controllerId && m.id === sv.controllerId) return false;
    if (sv._downed && (sv._downed.id != null ? m.id === sv._downed.id : m.name === sv._downed.name)) return false;
    if (sv.interior && !(m.inInterior && m.interiorKey === sv.interior.key && (m.interiorFloor == null ? 1 : m.interiorFloor) === sv.interior.floor)) return false;
    return true;
}

function _buildBodyAct(sv, m) {
    const isDowned = m.alive && m.downed;
    const opts = [];
    // 选项顺序：救治 → 搜索 → 补刀（v4.33 用户定稿"选择搜索还是补刀"，可救的倒地队友另有救治）
    if (isDowned && m.party) opts.push({ act: 'rescue', label: '救治（送药救活）' });
    opts.push({ act: 'search', label: isDowned ? '搜索（搜刮身上物品）' : '搜索（搜刮遗物）' });
    opts.push({ act: 'finish', label: isDowned ? '补刀（击杀，阻止尸变）' : '补刀（阻止尸变）' });
    const prev = sv._bodyAct;
    const sel = (prev && prev.npcId === m.id && prev.opts && prev.opts.length === opts.length)
        ? Math.max(0, Math.min(opts.length - 1, prev.sel || 0)) : 0;
    return { npcId: m.id, name: m.name || '幸存者', state: isDowned ? '倒地' : '待尸变', opts, sel };
}

// v4.41 统一"指针指向优先"：aim = 鼠标世界坐标 {x,y}（有鼠标时）。
//  · aim 提供 → 只返回【指针指向】的躺地 NPC（半径 ≤26px 且 1.9TS 内），未指向返回 null（让位给其他物体）。
//  · aim 为 null（无鼠标/回退）→ v4.35 延续当前已选 NPC，否则返回最近躺地 NPC。
// v4.43 附带指针距离 d：统一"最近者优先"排序（所有类型优先级一致）需要。
function computeBodyAct(sv, aim) {
    if (!Array.isArray(sv.npcs) || !sv.npcs.length) return null;
    const bodyPos = (m) => {
        const px = sv.interior ? sv.interior.px : sv.px;
        const py = sv.interior ? sv.interior.py : sv.py;
        return { x: m.x, y: m.y, px, py };
    };
    // ① 指针指向的躺地 NPC（aim 命中优先，与尸体/队友 aim 半径一致 26px）
    if (aim && aim.x != null) {
        let best = null, bd = 26;
        for (const m of sv.npcs) {
            if (!_isBodyActCandidate(sv, m)) continue;
            const p = bodyPos(m);
            if (Math.hypot(m.x - p.px, m.y - p.py) > 1.0 * TS) continue;
            const d = Math.hypot(aim.x - m.x, aim.y - m.y);
            if (d <= bd) { bd = d; best = m; }
        }
        if (!best) return null;
        const act = _buildBodyAct(sv, best);
        act.d = bd;
        return act;
    }
    // ② v4.35 延续当前已选 NPC（openBodyActFor 设的 _bodyAct 在 1.9TS 范围内保持——让 F 弹的选择框不被下一帧清掉）。
    // ③ v4.57 移除"无鼠标回退到最近躺地 NPC"——用户定稿"必须按 F 才弹 UI"，无鼠标时直接返回 null。
    //    距离回退由 updatePrompt/updateInteriorPrompt 距离回退段自行处理（尸体走 openBodyActFor F 交互）。
    const _prev = sv._bodyAct;
    if (_prev && _prev.npcId != null) {
        const pm = sv.npcs.find(x => x && x.id === _prev.npcId);
        if (pm && _isBodyActCandidate(sv, pm)) {
            const p = bodyPos(pm);
            const _inRange = Math.hypot(pm.x - p.px, pm.y - p.py) < 1.0 * TS;
            if (_inRange) return _buildBodyAct(sv, pm);
        }
    }
    return null;
}

// v4.43 统一"指针命中选择"：所有类型候选（倒地主控/躺地NPC/尸体/躲藏幸存者/楼梯/箱子/队员）
// 一视同仁（用户定稿"所有物体交互优先级一致，包括NPC"），按"鼠标到目标距离"取最近；
// 并带滞回锁定——当前锁定目标仍在命中范围内、且新候选并未比它更近 ≥10px 时保持当前目标，
// 防止鼠标微移导致金框在相邻目标（如队友站在箱子旁）间来回跳动。
function _pickAim(sv, hits) {
    if (!Array.isArray(hits) || !hits.length) return null;
    let best = hits[0];
    for (let i = 1; i < hits.length; i++) if (hits[i].d < best.d) best = hits[i];
    const prev = sv._aimLock;
    if (prev && prev.key != null) {
        for (let i = 0; i < hits.length; i++) {
            if (hits[i].key !== prev.key) continue;
            // 当前锁定目标仍在命中范围内：新候选没比它近 ≥10px → 保持锁定（金框不跳）
            if (best.d >= hits[i].d - 10) return { key: hits[i].key, target: hits[i].target, d: hits[i].d };
            break;
        }
    }
    sv._aimLock = { key: best.key, d: best.d };
    return { key: best.key, target: best.target, d: best.d };
}

// 执行当前选中操作（室外 doInteract / 室内 doInteriorInteract / 鼠标交互共用）
function execBodyAct(sv) {
    const act = sv._bodyAct;
    if (!act || !act.npcId) return false;
    const m = (sv.npcs || []).find(x => x && x.id === act.npcId);
    if (!m) { sv._bodyAct = null; return false; }
    const px = sv.interior ? sv.interior.px : sv.px;
    const py = sv.interior ? sv.interior.py : sv.py;
    const d = Math.hypot(m.x - px, m.y - py);
    if (d >= 1.0 * TS) { sv._bodyAct = null; return false; }
    const opt = act.opts[act.sel] || act.opts[0];
    if (!opt) { sv._bodyAct = null; return false; }
    // v4.62.1 F 确认执行后关闭选择框（除 search 走 openBodySearch 内部已清）——避免执行后再按 F 重复触发
    if (opt.act === 'rescue') { openMateRescue(m.id); sv._bodyAct = null; return true; }
    if (opt.act === 'search') { openBodySearch(m); return true; }
    if (opt.act === 'finish') { doBodyFinish(m); return true; }
    return false;
}

// v4.35 强制打开指定躺地 NPC 的交互选择框（扫描面板点"与 XX 交互"后调用）：
// 先弹"和 XX 队友交互"小 UI（滚轮选救治/搜索/补刀），选择完才执行操作。
// 选择框由 drawBodyAct 绘制、computeBodyAct 每帧延续该 npcId（不会被子帧覆盖）。
function openBodyActFor(sv, m) {
    if (!m || !sv) return;
    const _downed = m.alive && m.downed;
    const _corpse = !m.alive && m._corpse && !m._revived && !m._revivedCorpse;
    if (!_downed && !_corpse) return;
    const opts = [];
    if (_downed && m.party) opts.push({ act: 'rescue', label: '救治（送药救活）' });
    opts.push({ act: 'search', label: _downed ? '搜索（搜刮身上物品）' : '搜索（搜刮遗物）' });
    opts.push({ act: 'finish', label: _downed ? '补刀（击杀，阻止尸变）' : '补刀（阻止尸变）' });
    if (!opts.length) return;
    sv._bodyAct = { npcId: m.id, name: m.name || '幸存者', state: _downed ? '倒地' : '待尸变', opts, sel: 0 };
}

// 躺地 NPC 搜索：尸体走原搜索界面；倒地成员走"搜刮身上物品"（取走同步从背包移除）
function openBodySearch(m) {
    if (!m || !sv) return;
    sv._bodyAct = null;
    if (WSearch.isOpen() || sv.search) return;
    if (!m.alive && m._corpse) { openCorpseSearchUI(m); return; }   // 尸体：原遗物搜索
    if (m.alive && m.downed) { searchDownedBody(m); return; }        // 倒地成员：搜刮背包
}

// 倒地成员搜刮：复用搜索界面，内容 = 该 NPC 背包物品；拿取物品从背包移除（物品守恒，可救活后仍成立）
function searchDownedBody(n) {
    if (!n || !sv || WSearch.isOpen() || sv.search) return;
    const contents = (n.inv || []).filter(Boolean).map(s => ({ ...s }));
    if (!contents.length) { log(`${n.name} 身上没有可搜刮的物品`, '#B8C4C8'); return; }
    const corpseFull = contents.map(o => ({ ...o, _rem: o.n || 1 }));
    const items = contents.map(o => ({ id: o.id, n: o.n || 1, done: !!o.r, slot: o.slot }));
    AudioSystem.playOpenBox && AudioSystem.playOpenBox();
    WSearch.openSearch(sv, {
        items,
        name: `搜刮 ${n.name}（倒地）`,
        gx: Math.floor(n.x / TS), gy: Math.floor(n.y / TS),
        cap: Math.max(6, contents.length),
        corpseFull,
        onClose: (remaining) => {
            const rest = (remaining || []).filter(o => o && o.n > 0).map(o => {
                const f = corpseFull.find(x => x && x.id === o.id);
                const base = f ? { ...f } : { id: o.id };
                delete base._rem;
                return { ...base, n: o.n, r: !!o.r, slot: o.slot };
            });
            n.inv = rest;   // 物品守恒：拿走的从倒地成员背包移除
            if (!rest.length) log(`搜刮了 ${n.name} 身上的物品（已拿空）`, '#9fd6ff');
            else log(`搜刮了 ${n.name}（已取走部分物品）`, '#9fd6ff');
        },
    }, { onUseItem: (idx) => useItem(idx) });
}

// 躺地 NPC 补刀：倒地成员 = 击杀 + 阻止尸变（尸体保留可搜索）；尸体 = 阻止尸变（保留可搜索）。
// v4.33 覆盖友善/中立/敌对所有 NPC（不再限 party）。
function doBodyFinish(m) {
    if (!m || !sv) return;
    const name = m.name || '幸存者';
    if (m.alive && m.downed) {
        // 倒地成员补刀：击杀并阻止尸变（用户定稿"感染快满了不得不补刀"——尸体保留可搜刮）
        m.downed = false;
        WNPC.killNpc(sv, m, '被玩家补刀击杀');
        m._revived = true;       // 阻止尸变（updateCorpseRevive 跳过 _revived 尸体）
        m.party = false;
        if (Array.isArray(sv._downedMembers)) sv._downedMembers = sv._downedMembers.filter(x => x && x.id !== m.id);
        log(`你对 ${name} 补刀，终止了生命（尸体保留可搜索）`, '#FF8877');
    } else if (!m.alive && m._corpse && !m._revived) {
        // 待尸变尸体补刀：阻止尸变（保留可搜索）
        m._revived = true;
        m.party = false;
        log(`你对 ${name} 补刀，阻止了尸变（尸体保留可搜索）`, '#FF8877');
    }
    AudioSystem.playClick && AudioSystem.playClick();
    sv._bodyAct = null;
    saveNow();
}

function updatePrompt() {
    // v4.63.5 室内模式由 updateInteriorPrompt 全权负责（它设置 it.promptTarget + sv.prompt + 选择框守卫）。
    // updatePrompt 是室外函数——若不加此守卫，室内模式下它仍会执行室外 aim 模型并在末尾 sv.prompt=null，
    // 把 updateInteriorPrompt 刚设的室内提示覆盖成 null → 室内永远无文字提示。
    if (sv.interior) return;
    // v4.61 选择框自动关闭守卫：① 距离过远（>1.9TS）→ 关闭；② 交互对象状态变化（倒地变死/_revived）→ 关闭；
    // ③ 不再是 _isBodyActCandidate（被移除/离开室内/跨楼层）→ 关闭。execBodyAct 仅在按 F/左键时检查距离，
    // 但选择框停留期间每帧都要验证——否则玩家走远/对象变化 UI 仍悬空。
    if (sv._bodyAct && sv._bodyAct.opts && sv._bodyAct.opts.length) {
        const _ba = sv._bodyAct;
        const _m = sv.npcs && sv.npcs.find(x => x && x.id === _ba.npcId);
        const _alive = !!(_m && _m.alive);
        const _corpse = !!(_m && _m._corpse);
        const _downed = !!(_m && _m.downed);
        const _revived = !!(_m && (_m._revived || _m._revivedCorpse));
        // ① 距离过远
        if (_m) {
            const _d = Math.hypot(_m.x - sv.px, _m.y - sv.py);
            if (_d >= 1.0 * TS) { sv._bodyAct = null; return; }
            // 室内对象：跨楼层/不在同房间
            if (sv.interior && !(_m.inInterior && _m.interiorKey === sv.interior.key && (_m.interiorFloor == null ? 1 : _m.interiorFloor) === sv.interior.floor)) { sv._bodyAct = null; return; }
        } else { sv._bodyAct = null; return; }
        // ② 状态变化：原状态判定与现状态不一致 → 关闭（尸体已变僵尸/被搜空等）
        if (_ba.state === '倒地' && !_downed) { sv._bodyAct = null; return; }
        if (_ba.state === '待尸变' && (!_corpse || _revived)) { sv._bodyAct = null; return; }
        // ③ 候选失效（不在候选集中）
        if (!_isBodyActCandidate(sv, _m)) { sv._bodyAct = null; return; }
        // v4.62.1 选择框打开期间【强制锁定 promptTarget = bodyAct 并立即返回】：
        // 若继续走下方每帧重算，指针移开/金框转移到其他物体时 promptTarget 会被改成别的（tile/npc/corpse），
        // 用户按 F → doInteract 的 tg.bodyAct 不满足 → 执行了别的交互（表现如"按 F 判定为上下切换/执行别的"）。
        // 锁定后：金框始终指向该 NPC、F 始终确认当前 sel，切换只靠滚轮/鼠标（符合用户定稿）。
        // v4.63.4 文字格式调整为用户定稿："选择 对 XX 的操作（XX）[按F确认]"——加"对"字、改为"按F确认"
        sv.promptTarget = { bodyAct: _ba.npcId };
        sv.prompt = `选择 对 ${_ba.name} 的操作（${_ba.opts[_ba.sel] ? _ba.opts[_ba.sel].label : ''}）[按F确认]`;
        return;
    }
    const ptx = sv.px / TS, pty = sv.py / TS;

    // 软核倒地救治：玩家（队友视角）靠近倒地主角 → 显示救治交互（F 打开救治 UI，展示药品进度与存活倒计时）
    let downedPrompt = null;   // 2026-08-10 先算好救治提示，不立即 return：若附近有可命令队友，优先队友命令
    if (sv._downed) {
        const d = Math.hypot(sv.px - sv._downed.px, sv.py - sv._downed.py);
        // 救治界面打开时玩家走远 → 自动关闭（界面不悬空）
        if (d >= 1.0 * TS && rescueOpen()) closeRescue();
        if (d < 1.0 * TS) {
            const needMed = B.DOWNED_NEED_MED - (sv._downed.med || 0);
            const needHerb = B.DOWNED_HERB_EQUIV - (sv._downed.herb || 0);
            const progress = needMed > 0
                ? `需伤口药/抗生素×${needMed}` : needHerb > 0
                    ? `需草药×${needHerb}` : '药品已集齐！';
            // 玩家可背起倒地主角（移动时 _downed 跟随玩家，移速减慢），背到床旁/安全点再放下
            // v4.58 倒地主控补格坐标（供 drawHUD downed 金框绘制，与室内 drawInteriorPromptGlow 一致）
            const _dwnGX = Math.floor(sv._downed.px / TS), _dwnGY = Math.floor(sv._downed.py / TS);
            if (sv._carryDowned) {
                downedPrompt = { target: { downed: 1, putDown: 1, x: _dwnGX, y: _dwnGY }, prompt: `放下 ${sv._downed.name} [F]（${progress}）` };
            } else {
                downedPrompt = { target: { downed: 1, x: _dwnGX, y: _dwnGY }, prompt: `救治 ${sv._downed.name} [F]（${progress}） · 或 背起 [V]` };
            }
        }
    }
    // v4.41 用户定稿："所有可交互的物体，指针指到哪里，就代表优先级的交互物体"——统一 aim 模型：
    // ① 收集【指针指向】的所有候选（倒地主控/躺地NPC/尸体/地块/队友）；
    // ② 按"鼠标到目标距离"最近者优先（v4.43 所有类型优先级一致，含 NPC），带滞回锁定；
    // ③ 无指针命中时才回退"距离最近"（原优先级不变）。选择框不再无条件抢占金框（v4.52）。
    const _mousePos = (sv.mouse && sv.mouse.x != null && sv.camX != null)
        ? { x: sv.camX + sv.mouse.x, y: sv.camY + sv.mouse.y } : null;

    // v4.43 性能优化：鼠标/玩家位置/相机都未移动时复用上一帧 aim 结果（省每帧 npcs 遍历）。
    const _aimMX0 = sv.mouse && sv.mouse.x, _aimMY0 = sv.mouse && sv.mouse.y;
    const _aimMoved = _aimMX0 !== sv._lastAimX || _aimMY0 !== sv._lastAimY
        || sv.px !== sv._lastAimPx || sv.py !== sv._lastAimPy
        || sv.camX !== sv._lastAimCamX || sv.camY !== sv._lastAimCamY;
    sv._lastAimX = _aimMX0; sv._lastAimY = _aimMY0;
    sv._lastAimPx = sv.px; sv._lastAimPy = sv.py;
    sv._lastAimCamX = sv.camX; sv._lastAimCamY = sv.camY;

    if (sv.build) {
        // v4.33 建造模式下不显示躺地 NPC 选择框（避免干扰拆除交互）
        sv._bodyAct = null;
        let best = null, bestD = 3.5;
        for (const key of Object.keys(sv.mods.tiles)) {
            const m = sv.mods.tiles[key];
            if (!m.built) continue;
            const [gx, gy] = key.split(',').map(Number);
            const d = Math.hypot(gx + 0.5 - ptx, gy + 0.5 - pty);
            if (d < bestD) { bestD = d; best = { x: gx, y: gy, t: m.t, demolish: true }; }
        }
        sv.promptTarget = best;
        sv.prompt = best ? `拆除 ${(BUILD_ITEMS.find(b => b.t === best.t) || {}).name || '建筑'}` : null;
        return;
    }

    // ---------- ① 收集候选：地块(tile) ----------
    let best = null, bestD = 1.9;
    let aimTile = null;
    if (_mousePos) {
        // 2026-08-12 v3.46 准星优先：准星指向格在 3×3 内且可交互 → 该格为地块目标
        const aimGx = Math.floor(_mousePos.x / TS), aimGy = Math.floor(_mousePos.y / TS);
        if (Math.abs(aimGx - Math.floor(ptx)) <= 1 && Math.abs(aimGy - Math.floor(pty)) <= 1) {
            const t = getTile(sv, aimGx, aimGy);
            if (INTERACT_LABEL[t] && containerInteractable(t, aimGx, aimGy) && !(t === T.DOOR && builtAt(sv, aimGx, aimGy))) {
                aimTile = { x: aimGx, y: aimGy, t };
            }
        }
    }
    if (aimTile) {
        best = aimTile;
        bestD = 0;
    } else {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const tx = Math.floor(ptx) + dx, ty = Math.floor(pty) + dy;
            const t = getTile(sv, tx, ty);
            if (!INTERACT_LABEL[t]) continue;
            if (!containerInteractable(t, tx, ty)) continue;
            if (t === T.DOOR && builtAt(sv, tx, ty)) continue;
            const d = Math.hypot(tx + 0.5 - ptx, ty + 0.5 - pty);
            if (d < bestD) { bestD = d; best = { x: tx, y: ty, t }; }
        }
    }

    // ---------- ① 收集候选：尸体 / 队友 + ② 统一"指针命中最近者优先"（v4.43） ----------
    // v4.43 缓存：鼠标/玩家/相机未移动时复用上一帧 hits（跳过 computeBodyAct + npcs 遍历）
    let _aimHits = null;
    if (!_aimMoved && Array.isArray(sv._aimLastHits)) {
        _aimHits = sv._aimLastHits;
    } else {
        _aimHits = [];
        // 躺地 NPC 选择框：仅【指针指向】的才弹（未指向返回 null，把金框让给其他物体）
        const aimBody = computeBodyAct(sv, _mousePos);
        // 倒地主控（指针指向倒地主角 → 救治提示）
        const aimDowned = !!(downedPrompt && _mousePos && sv._downed
            && Math.hypot(_mousePos.x - sv._downed.px, _mousePos.y - sv._downed.py) <= 26);
        if (aimDowned) {
            const dd = Math.hypot(_mousePos.x - sv._downed.px, _mousePos.y - sv._downed.py);
            _aimHits.push({ key: 'downed', d: dd, target: { type: 'downed' } });
        }
        if (aimBody && aimBody.d != null) {
            _aimHits.push({ key: 'bodyAct:' + aimBody.npcId, d: aimBody.d, target: { type: 'bodyAct', v: aimBody } });
        }
        if (aimTile) {
            const dd = Math.hypot(_mousePos.x - (aimTile.x + 0.5) * TS, _mousePos.y - (aimTile.y + 0.5) * TS);
            _aimHits.push({ key: 'tile:' + aimTile.x + ',' + aimTile.y, d: dd, target: { type: 'tile', v: aimTile } });
        }
        if (_mousePos && sv.npcs) for (const n of sv.npcs) {
            if (!n) continue;
            const dd = Math.hypot(_mousePos.x - n.x, _mousePos.y - n.y);
            if (dd > 26) continue;
            if (Math.hypot(n.x - sv.px, n.y - sv.py) > 1.0 * TS) continue;
            if (sv.interior && !(n.inInterior && n.interiorKey === sv.interior.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === sv.interior.floor)) continue;
            if (n._corpse && !n.downed) {
                _aimHits.push({ key: 'corpse:' + n.id, d: dd, target: { type: 'corpse', id: n.id, x: n.x, y: n.y, name: n.name } });
            } else if (n.alive && !n.downed && n.role !== 'hostile' && !(sv.controllerId && n.id === sv.controllerId)) {
                _aimHits.push({ key: 'mate:' + n.id, d: dd, target: { type: 'mate', id: n.id, x: n.x, y: n.y, name: n.name, party: n.party } });
            }
        }
        sv._aimLastHits = _aimHits;
    }
    const _picked = _pickAim(sv, _aimHits);
    if (_picked) {
        const t = _picked.target;
        // v4.57 修复"指针指到躺地 NPC 自动弹 UI"：原 `sv._bodyAct = (t.type === 'bodyAct') ? t.v : null`
        // 仍然把指针命中也视为"自动弹"——用户定稿"必须按 F 才弹"。指针命中只画金框（promptTarget.bodyAct），
        // 选择框（sv._bodyAct）只能由 openBodyActFor（F 交互/扫描点击）显式设置。
        // v4.59 修复"选择框只闪一帧"：当 sv._bodyAct 已由 openBodyActFor 设置（用户正选中倒地/尸体）
        // 且当前指针命中的正是该 npc 时，不能每帧无条件清空——否则下一帧 updatePrompt 就把 F 刚弹的框清掉。
        if (!(sv._bodyAct && t.type === 'bodyAct' && t.v && t.v.npcId === sv._bodyAct.npcId)) {
            sv._bodyAct = null;
        }
        if (t.type === 'downed') { sv.promptTarget = downedPrompt.target; sv.prompt = downedPrompt.prompt; return; }
        if (t.type === 'bodyAct') { sv.promptTarget = { bodyAct: t.v.npcId }; sv.prompt = `处理 ${t.v.name}（${t.v.state || '躺地'}）[F]`; return; }
        if (t.type === 'corpse') { sv.promptTarget = { corpse: t.id, x: t.x, y: t.y, aim: 1 }; sv.prompt = `搜索 ${t.name} 的尸体 [F]`; return; }
        if (t.type === 'tile') {
            sv.promptTarget = t.v;
            if (t.v.t === T.SPROUT) {
                const pv = WP.plantDisplay(sv, t.v.x, t.v.y);
                const sp = WP.speciesInfo(WP.plantSpeciesAt(sv, t.v.x, t.v.y) || 'peashooter');
                const pData = sv.mods.plants && sv.mods.plants[t.v.x + ',' + t.v.y];
                if (pData && pData.type !== 'neutral') sv.prompt = `${sp.name}·${pv ? pv.stageName : ''}（已驯服）`;
                else sv.prompt = `${sp.name}·${pv ? pv.stageName : ''}（F 驯服，需食物）`;
            } else {
                sv.prompt = isSearchedContainer(t.v.t, t.v.x, t.v.y) ? '打开 · 存取物品' : (INTERACT_LABEL[t.v.t] || null);
            }
            return;
        }
        if (t.type === 'mate') { sv.promptTarget = { npc: t.id, x: t.x, y: t.y, aim: 1 }; sv.prompt = t.party ? `命令 ${t.name} [F]` : `交谈 ${t.name} [F]`; return; }
    }

    // ---------- ③ 无指针命中 → 距离回退（原优先级：倒地主控 > 躺地NPC > 尸体 > 地块 > 队友） ----------
    // v4.52 用户定稿："靠近倒下的队友不会自动弹出选择框，只有交互（F/扫描点击）才弹"——
    // 距离回退不再自动 computeBodyAct（不会靠近自动弹框），选择框只能由 F 交互或扫描面板点击打开。
    // v4.56 修复"靠近不弹但 F 弹的框被下一帧清掉"：这里【不再无条件清空 sv._bodyAct】——
    // F 交互（openBodyActFor）设置的选择框要保留到用户滚轮选择+再次按 F 执行（或按 ESC 关闭）。
    // 靠近不自动弹由"本函数从不自动生成 _bodyAct"保证（computeBodyAct 仅指针 aim 命中才调用）。
    if (downedPrompt) {
        sv.promptTarget = downedPrompt.target;
        sv.prompt = downedPrompt.prompt;
        return;
    }
    // v4.58.1 倒地队友距离回退：之前 nbest 排除 n.downed、corpseBest 只查 _corpse——
    // 靠近倒地队友（指针未命中）时金框不选中、F 无法交互。补：倒地队友距离回退（F → openBodyActFor 弹救治/搜索/补刀框）
    let downedMateBest = null;
    if (sv.npcs) {
        let dbd = 1.0 * TS;
        for (const n of sv.npcs) {
            if (!n || !n.alive || !n.downed) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (sv.interior && !(n.inInterior && n.interiorKey === sv.interior.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === sv.interior.floor)) continue;
            const d = Math.hypot(n.x - sv.px, n.y - sv.py);
            if (d < dbd) { dbd = d; downedMateBest = n; }
        }
    }
    if (downedMateBest) {
        sv.promptTarget = { bodyAct: downedMateBest.id, x: downedMateBest.x, y: downedMateBest.y };
        sv.prompt = `处理 ${downedMateBest.name}（倒地）[F]`;
        return;
    }
    // 尸体距离回退
    let corpseBest = null;
    if (sv.npcs) {
        let cbd = 1.0 * TS;
        for (const n of sv.npcs) {
            if (!n || !n._corpse || n.downed) continue;
            if (sv.interior && !(n.inInterior && n.interiorKey === sv.interior.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === sv.interior.floor)) continue;
            const d = Math.hypot(n.x - sv.px, n.y - sv.py);
            if (d < cbd) { cbd = d; corpseBest = n; }
        }
    }
    // 队友距离回退（可命令/交谈；倒地者排除——走救治）
    let nbest = null, nbestD = 1.0 * TS;
    if (sv.npcs) {
        for (const n of sv.npcs) {
            if (!n.alive || n.role === 'hostile' || n.downed) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (sv.interior && !(n.inInterior && n.interiorKey === sv.interior.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === sv.interior.floor)) continue;
            const d = Math.hypot(n.x - sv.px, n.y - sv.py);
            if (d < nbestD) { nbestD = d; nbest = n; }
        }
    }
    const camp = sv.camp;
    const campDist = camp ? Math.hypot(sv.px - camp.x, sv.py - camp.y) : 1e9;
    // v3.24 用户定稿：尸体与容器重叠时先取遗物再开箱。
    // v4.58 距离回退尸体/队友补 x/y 像素坐标——之前 `{corpse: id}`/`{npc: id}` 无坐标，
    // 室外 drawHUD 金框分支要求 aim || 坐标，导致"靠近选中但金框不显示"（室内有 x/y 所以一致）。
    if (best) {
        if (corpseBest) { sv.promptTarget = { corpse: corpseBest.id, x: corpseBest.x, y: corpseBest.y }; sv.prompt = `搜索 ${corpseBest.name} 的尸体 [F]`; return; }
        sv.promptTarget = best;
    }
    else if (corpseBest) {
        sv.promptTarget = { corpse: corpseBest.id, x: corpseBest.x, y: corpseBest.y };
        sv.prompt = `搜索 ${corpseBest.name} 的尸体 [F]`;
        return;
    } else if (nbest) {
        sv.promptTarget = { npc: nbest.id, x: nbest.x, y: nbest.y };
        sv.prompt = nbest.party ? `命令 ${nbest.name} [F]` : `交谈 ${nbest.name} [F]`;
        return;
    } else { sv.promptTarget = null; }
    // 领地旗帜：站在旗帜附近 → 收起
    if (!best && sv.camp && Math.hypot(sv.px - sv.camp.x, sv.py - sv.camp.y) < 1.0 * TS) {
        sv.promptTarget = { flag: 1 };
        sv.prompt = '收起领地旗帜 [F]';
        return;
    }
    // 营地中心（无更近的地块目标时）
    if (!best && campDist < 6 * TS) {
        sv.promptTarget = { camp: 1 };
        sv.prompt = '营地 [F]（工作日志 · 物资箱）';
        return;
    }
    if (best && best.t === T.SPROUT) {
        const pv = WP.plantDisplay(sv, best.x, best.y);
        const sp = WP.speciesInfo(WP.plantSpeciesAt(sv, best.x, best.y) || 'peashooter');
        const pData = sv.mods.plants && sv.mods.plants[best.x + ',' + best.y];
        if (pData && pData.type !== 'neutral') sv.prompt = `${sp.name}·${pv ? pv.stageName : ''}（已驯服）`;
        else sv.prompt = `${sp.name}·${pv ? pv.stageName : ''}（F 驯服，需食物）`;
    } else if (best) {
        sv.prompt = isSearchedContainer(best.t, best.x, best.y) ? '打开 · 存取物品' : (INTERACT_LABEL[best.t] || null);
    } else {
        sv.prompt = null;
        if (!sv.build && hasTool('tool:pick')) {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const tx = Math.floor(ptx) + dx, ty = Math.floor(pty) + dy;
                if (getTile(sv, tx, ty) === T.RUBBLE) {
                    const d = Math.hypot(tx + 0.5 - ptx, ty + 0.5 - pty);
                    if (d < bestD) { best = { x: tx, y: ty, t: T.RUBBLE }; bestD = d; }
                }
            }
            if (best) { sv.promptTarget = best; return; }   // 石头保留 F 开采功能，但不显示宝箱式交互提示
        }
        if (!sv.build && hasTool('tool:hoe')) {
            const gx = Math.floor(ptx), gy = Math.floor(pty);
            if (getTile(sv, gx, gy) === T.GROUND && !builtAt(sv, gx, gy)) {
                sv.promptTarget = { x: gx, y: gy, t: T.GROUND };
                sv.prompt = '开垦种植盆（锄头）';
            }
        }
        if (!sv.promptTarget && hasTool('tool:wrench')) {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const tx = Math.floor(ptx) + dx, ty = Math.floor(pty) + dy;
                const m = builtAt(sv, tx, ty);
                if (m && m.hp != null && m.hp < (BUILD_HP[m.t] || 200)) {
                    const bi = BUILD_ITEMS.find(b => b.t === m.t);
                    sv.promptTarget = { x: tx, y: ty, t: m.t, repair: true };
                    sv.prompt = `修理${bi ? bi.name : '建筑'}（扳手）`;
                    break;
                }
            }
        }
    }
}

function doInteract() {
    const tg = sv.promptTarget;
    if (!tg) return;

    // v4.57 修复"F 键对躺地 NPC 无效"：v4.57 把"靠近自动弹 UI"彻底拆掉（sv._bodyAct 只能由 openBodyActFor 显式设置），
    // 但 doInteract 的 `if (tg.bodyAct)` 仍调 `execBodyAct(sv)`（读 sv._bodyAct）→ _bodyAct=null → execBodyAct 返回 false，
    // doInteract 走完所有分支落到 "附近没有可交互的东西"——用户看到金框但 F 无反应。
    // 正确语义：F 首次按下 = 弹选择框（openBodyActFor），用户滚轮选 + 第二次按 F = 执行（execBodyAct）。
    if (tg.bodyAct) {
        const m = (sv.npcs || []).find(x => x && x.id === tg.bodyAct);
        if (m) {
            // 如果 sv._bodyAct 已开（用户选了选项后第二次按 F）→ 执行
            if (sv._bodyAct && sv._bodyAct.npcId === tg.bodyAct && execBodyAct(sv)) return;
            // 否则第一次按 F → 弹选择框
            const d = Math.hypot(m.x - sv.px, m.y - sv.py);
            if (d < 1.0 * TS) {
                openBodyActFor(sv, m);
                return;
            }
        }
    }

    // 软核倒地救治：F = 弹出救治 UI（2026-08-10 用户要求），展示待提交药品与存活倒计时，关闭不致死
    if (tg.downed && sv._downed) {
        // 背人中：F = 放下倒地主角（当前位置放下，跟随解除）
        if (tg.putDown) {
            sv._carryDowned = false;
            sv._downed.px = sv.px; sv._downed.py = sv.py;
            log(`你放下了 ${sv._downed.name}`, '#B8C4C8');
            return;
        }
        const d = Math.hypot(sv.px - sv._downed.px, sv.py - sv._downed.py);
        if (d >= 1.0 * TS) return;
        openRescue();
        return;
    }
    // v4.52 用户定稿："和队友交互，会弹出 UI 界面，然后选择搜索或者是补刀"——
    // 倒地队友按 F 改为弹"交互选择框"（救治/搜索/补刀三选项，含救助队友选项），
    // 不再直接打开救助界面。
    if (tg.downedMate) {
        const m = Array.isArray(sv._downedMembers) ? sv._downedMembers.find(x => x && x.id === tg.downedMate) : null;
        if (!m || !m.alive || !m.downed) return;
        const d = Math.hypot(m.x - sv.px, m.y - sv.py);
        if (d >= 1.0 * TS) return;
        openBodyActFor(sv, m);   // 弹选择框（滚轮选救治/搜索/补刀），F 再执行选中项
        return;
    }
    // 2026-08-17 v4.23 用户定稿："新增一个互动，可以和待尸变的尸体交互"——补刀阻止尸变
    if (tg.corpseFinish) {
        const m = (sv.npcs || []).find(x => x && x.id === tg.corpseFinish);
        if (!m || m.alive || m._revived) return;
        const d = Math.hypot(m.x - sv.px, m.py - sv.py);
        if (d >= 1.0 * TS) return;
        openCorpseFinish(m.id);
        return;
    }

    // 2026-08-10 尸体搜索：F = 在尸体上搜索遗物（成员背包全部物品进背包，装不下的掉地）。
    // 2026-08-11 用户定稿：尸体搜索与【容器完全一致】——复用 WSearch 面板 + 逐件渐亮；
    //   ① 关闭界面不自动入包，未拿走物品保留在原地（写回 _corpseContents）；
    //   ② 已搜索完成的物品记 r=1，重开直接显示；未搜索的继续搜索动画；
    //   ③ 全部拿走（掏空）→ 尸体消失（清死亡指引）。
    if (tg.corpse) {
        // 2026-08-11 v2.97 防御：濒死角色（downed）即使被误标 _corpse 也不开搜索界面（只能救助）
        // 2026-08-11 v2.98 测试玩家发现（用户反馈）：尸变前搜完应能反复打开搜索界面——
        // 不再要求 `!_corpseSearched`（普通尸体搜完保留、可重开）；尸变尸体 _revivedCorpse 掏空
        // 后消失（onClose 处理），未掏空时也可重开续搜。
        // v4.52 用户定稿："扫描 UI 只需一个'与 XX 交互'按钮，点击后再弹选项框"——
        // F 交互尸体也改为弹选择框（搜索遗物/补刀阻止尸变），选择后再执行。
        const c = sv.npcs && sv.npcs.find(n => n && n._corpse && !n.downed && n.id === tg.corpse);
        if (!c) return;
        const d = Math.hypot(c.x - sv.px, c.y - sv.py);
        if (d >= 1.0 * TS) return;
        // 尸变尸体（_revived/_revivedCorpse）只可搜索（补刀无意义），直接开搜索界面
        if (c._revived || c._revivedCorpse) { openCorpseSearchUI(c); return; }
        // 待尸变尸体弹选择框（搜索/补刀阻止尸变）
        openBodyActFor(sv, c);
        return;
    }

    if (sv.build) { if (tg.demolish) WB.demolish(sv, tg.x, tg.y); return; }

    if (tg.repair) {
        if (!hasTool('tool:wrench')) return;
        const key = tg.x + ',' + tg.y;
        const m = sv.mods.tiles[key];
        if (m) {
            m.hp = BUILD_HP[m.t] || 200;
            m.lastHit = sv.now;
            const bi = BUILD_ITEMS.find(b => b.t === m.t);
            log(`修理完成：${bi ? bi.name : '建筑'}（扳手）`);
        }
        return;
    }

    if (CONTAINER_LOOT_POOLS[tg.t]) {   // v3.19 容器判定走 CONTAINER_LOOT_POOLS（标准四箱+街道杂物）
        openContainer(tg.t, tg.x, tg.y);
        return;
    } else if (tg.t === T.HERB) {
        Panel.addItem(sv, 'herb', 1);
        setTile(sv, tg.x, tg.y, T.GROUND);
        log('采集 草药×1');
    } else if (tg.t === T.FLOWER) {
        Panel.addItem(sv, 'sun', 1);
        setTile(sv, tg.x, tg.y, T.GROUND);
        log('采集 阳光×1（向日葵精华）');
        AudioSystem.playCollect();
    } else if (tg.t === T.TREE) {
        const chopDur = AudioSystem.getSoundDuration('chopTree') || 0.5;
        if (sv.now - (sv._lastChop || 0) < chopDur) return;
        const chopper = hasTool('tool:chopper');
        const melee = WG.equipped(sv, 'melee');
        const need = chopper ? 2 : (melee && WEAPONS[melee] && WEAPONS[melee].attackStyle === 'chop') ? B.CHOP_AXE : B.CHOP_DEFAULT;
        const key = tg.x + ',' + tg.y;
        sv.chop[key] = (sv.chop[key] || 0) + 1;
        AudioSystem.playChopTree();
        mpSfx('chopTree');   // 联机：对端也听到伐木声
        sv._lastChop = sv.now;
        if (sv.chop[key] >= need) {
            delete sv.chop[key];
            setTile(sv, tg.x, tg.y, T.GROUND);
            const base = B.CHOP_WOOD_MIN + Math.floor(Math.random() * B.CHOP_WOOD_RAND);
            const n = chopper ? Math.ceil(base * 1.5) : base;
            Panel.addItem(sv, 'wood', n);
            AudioSystem.playTreeFall();
            mpSfx('treeFall');   // 联机：对端也听到倒木声
            log(`伐木完成 木材×${n}${chopper ? '（伐木斧）' : ''}`);
        } else {
            log(`伐木中… ${sv.chop[key]}/${need}`);
        }
    } else if (tg.t === T.DOOR) {
        WD.enterInterior(sv, tg.x + ',' + tg.y);
    } else if (tg.t === T.BED) {
        if (sv.lastRestDay !== sv.day) {
            sv.lastRestDay = sv.day;
            sv.hp = Math.min(sv.maxHp, sv.hp + B.BED_HEAL);
            if (sv.infection > 0) {
                const prev = sv.infection;
                sv.infection = addPlayerInfection(sv.infection, -PLAYER_INFECTION.bedRestRecovery);
                const recovered = prev - sv.infection;
                log(`你休息了一会儿，生命恢复 ${B.BED_HEAL}，感染减轻 ${recovered}（进度已保存）`);
            } else {
                log(`你休息了一会儿，生命恢复 ${B.BED_HEAL}（进度已保存）`);
            }
        } else {
            sv.homeBed = { x: tg.x, y: tg.y };
            saveNow();
            log('今天已经休息过了（进度已保存）');
            return;
        }
        sv.homeBed = { x: tg.x, y: tg.y };
        saveNow();
    } else if (tg.t === T.CABINET) {
        Panel.showChest(sv, tg.x + ',' + tg.y);
    } else if (tg.t === T.WATER) {
        Panel.addItem(sv, 'water', 1);
        log('采集 水×1');
    } else if (tg.t === T.SPROUT) {
        // 2026-08-12 v3.7 驯服支持任意具体食物（food/carrot/corn/potato/bread/apple/melon）
        const r = WP.tryTame(sv, tg.x, tg.y, countAnyFood, takeAnyFood);
        if (r === 'ok') log('驯服成功！它加入了你的防线');
        else if (r === 'fail') log('驯服失败！它被激怒了');
        else if (r === 'need:food') log('驯服需要食物（用它最爱的食物诱捕）');
        else if (r === 'not-neutral') log('它已经是你的人了');
        Panel.refresh(sv);
    } else if (tg.t === T.PLOT) {
        const r = WP.tryCultivate(sv, tg.x, tg.y, countItem, takeItem);
        if (r === true) log('培养成功！防御植物已种下，它将自动攻击僵尸');
        else if (r === 'need:seed') log('缺少种子（击败中立植物获得）');
        else if (r === 'need:water') log('缺少水（在积水旁按 F 采集）');
        else if (r === 'need:fert') log('缺少肥料（搜刮箱子获得）');
        else if (r === 'need:sun') log('缺少阳光（采集野生向日葵获得）');
        else log('这里已经有植物了');
        Panel.refresh(sv);
    } else if (tg.t === T.RUBBLE) {
        if (!hasTool('tool:pick')) { log('需要石镐才能开采碎石'); return; }
        const digDur = AudioSystem.getSoundDuration('digStone') || 0.4;
        if (sv.now - (sv._lastDig || 0) < digDur) return;
        const key = tg.x + ',' + tg.y;
        sv.mine[key] = (sv.mine[key] || 0) + 1;
        AudioSystem.playDigStone();
        mpSfx('digStone');   // 联机：对端也听到开采声
        sv._lastDig = sv.now;
        const need = B.MINE_DEFAULT;
        if (sv.mine[key] >= need) {
            delete sv.mine[key];
            const n = 2 + Math.floor(Math.random() * 3);
            Panel.addItem(sv, 'stone', n);
            setTile(sv, tg.x, tg.y, T.GROUND);
            AudioSystem.playStoneBreak();
            mpSfx('stoneBreak');   // 联机：对端也听到碎石崩裂声
            log(`开采碎石获得 石块×${n}（石镐）`);
        } else {
            log(`开采中… ${sv.mine[key]}/${need}`);
        }
    } else if (tg.t === T.GROUND) {
        if (!hasTool('tool:hoe')) return;
        const key = tg.x + ',' + tg.y;
        sv.mods.tiles[key] = { t: T.PLOT, built: 1, prev: T.GROUND, hp: 100 };
        if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'diff', key, tile: sv.mods.tiles[key] });
        log('开垦了一块种植盆（锄头·不耗木材）');
        Panel.refresh(sv);
    } else if (tg.t === T.CROP) {
        const cr = hash2(sv.world.seed ^ 0xC90B, tg.x, tg.y);
        // 2026-08-12 v3.7 收获具体农作物（萝卜→胡萝卜 / 玉米 / 土豆），不再统一给泛称食物
        const crops = [
            { id: 'carrot', name: '萝卜' },
            { id: 'corn', name: '玉米' },
            { id: 'potato', name: '土豆' },
        ];
        const cp = crops[Math.floor(cr * 3) % 3];
        const n = 1 + Math.floor(Math.random() * 2);
        Panel.addItem(sv, cp.id, n);
        let extra = '';
        if (Math.random() < 0.30) {
            const seeds = ['seed:peashooter', 'seed:snowpea', 'seed:sunflower'];
            const sid = seeds[Math.floor(Math.random() * seeds.length)];
            Panel.addItem(sv, sid, 1);
            extra = ` + ${Panel.getItemInfo(sid).name}×1`;
        }
        setTile(sv, tg.x, tg.y, T.GROUND);
        log(`采集 ${cp.name} → ${Panel.getItemInfo(cp.id).name}×${n}${extra}`);
    } else if (tg.t === T.CAR || tg.t === T.CARWRECK) {
        openCarMenu(tg.x + ',' + tg.y);
    } else if (tg.npc) {
        // 队员直接打开独立命令面板；非队员进交谈/入队菜单
        const npc = sv.npcs.find(n => n.id === tg.npc);
        // 2026-08-10 防御：若该记录已倒地（倒下主控/队友），不打开命令面板，改为救助。
        // 正常情况下 updatePrompt 已把 n.downed 排除出交互对象，但 promptTarget 可能残留
        // （如前一刻还是命令提示、下一帧主控倒地），按 F 不应误开命令面板。
        if (npc && npc.downed) {
            if (sv._downed) openRescue();
            return;
        }
        if (npc && npc.party) openNpcCommandMenu(npc);
        else openNpcMenu(tg.npc);
    } else if (tg.camp) {
        openCampPanel();
    } else if (tg.flag) {
        // 旗帜处 F：收起领地旗帜（回收物品；回收后可再次使用→待放置→G 重放）
        sv.camp = null;
        sv._flagPlace = null;   // 2026-08-10 清待放置状态（防冲突）
        Panel.addItem(sv, 'flag', 1);
        log('领地旗帜已收起（背包里可再次放置）', '#FFD700');
    }
}

// ================= 2026-08-12 v3.42~v3.44 鼠标交互准心：角色朝向 =================
// 准心可交互判定在 render.js 内部实现（renderTileInteractable/renderPointInteractable，模块解耦）。
// v3.43 曾改为"完全由鼠标决定"，v3.44 用户回退局部：**走路时 WASD 移动方向优先，
// 站立不动时才用准星方向判断角色朝向**（正常走路手感 + 静止可瞄准方向）。
// 在 update 的大世界/室内帧尾调用（此时移动逻辑已处理完）。
function updateAimFacing(sv) {
    if (!sv || sv.facing8 == null || !sv.mouse || sv.mouse.x == null) return;
    // 2026-08-12 v3.44 移动中：移动方向优先（不覆盖 WASD 已设的 faceX/faceY）
    const moving = sv.keys && (sv.keys['w'] || sv.keys['a'] || sv.keys['s'] || sv.keys['d'] ||
        sv.keys['arrowup'] || sv.keys['arrowdown'] || sv.keys['arrowleft'] || sv.keys['arrowright']);
    if (moving) return;
    // 站立：准星方向 → 4 主方向（facing8 现为 0=东 2=南 4=西 6=北，×0.5 即 0=东 1=南 2=西 3=北）
    const faceMap = [
        { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
    ];
    const f = faceMap[Math.floor(sv.facing8 / 2) % 4];
    if (f) { sv.faceX = f.x; sv.faceY = f.y; }
}

// 2026-08-12 v3.40 提取公共尸体搜索函数：室外 tg.corpse 分支 / 室内 doInteriorInteract / 长按扫描面板共用。
// 完全对齐 v3.36 定稿语义：普通尸体（非 _revivedCorpse）掏空不消失、可反复打开空界面；
// 尸变尸体（_revivedCorpse）掏空才彻底消失（splice 移除），未掏空可续搜。
// 未拿走物品写回 _corpseContents（保留完整属性 + r 搜索完成标记 + slot）。
function openCorpseSearchUI(c) {
    if (!c || !sv) return;
    if (WSearch.isOpen() || sv.search) return;   // 已有搜索界面打开 → 忽略
    const contents = c._corpseContents || [];
    // 空内容也开界面（普通尸体搜完可反复打开空界面；尸变尸体掏空由 onClose 移除）
    const corpseFull = contents.map(o => ({ ...o, _rem: o.n || 1 }));
    // 与容器/室外一致：done = 已搜索完成（r=1 直接显示），slot = 固定槽位（重开位置不变）
    const items = contents.map(o => ({ id: o.id, n: o.n || 1, done: !!o.r, slot: o.slot }));
    AudioSystem.playOpenBox && AudioSystem.playOpenBox();
    WSearch.openSearch(sv, {
        items,
        name: `搜索 ${c.name} 的尸体`,
        gx: Math.floor(c.x / TS), gy: Math.floor(c.y / TS),
        cap: Math.max(6, contents.length),
        corpseFull,
        onClose: (remaining) => {
            const rest = (remaining || []).filter(o => o && o.n > 0).map(o => {
                const f = corpseFull.find(x => x && x.id === o.id);
                const base = f ? { ...f } : { id: o.id };
                delete base._rem;
                return { ...base, n: o.n, r: !!o.r, slot: o.slot };
            });
            // v4.37 用户定稿："补刀致死的尸体拿完物品就消失"——
            // 三类尸体在掏空时的处理：
            //   · _revivedCorpse（尸变丧尸击败产生的尸体）→ 掏空消失（已尸变完毕，不再二次尸变）
            //   · _revived && !_revivedCorpse（玩家主动补刀致死=阻止尸变）→ 掏空消失（防尸变尸体出现）
            //   · !_revived && !_revivedCorpse（未补刀的普通尸体）→ 掏空保留可反复打开（v3.40 设计）
            const isFinishedRevived = !!c._revived || !!c._revivedCorpse;
            if (isFinishedRevived) {
                c._corpseContents = rest;
                if (!rest.length) {
                    if (Array.isArray(sv.npcs)) {
                        const idx = sv.npcs.indexOf(c);
                        if (idx >= 0) sv.npcs.splice(idx, 1);
                    }
                    if (sv._legacyDrop && Math.abs(c.x - sv._legacyDrop.x) < TS && Math.abs(c.y - sv._legacyDrop.y) < TS) sv._legacyDrop = null;
                    log(`搜索了 ${c.name} 的尸体（物品已全部取走，尸体消失）`, '#9fd6ff');
                } else {
                    log(`搜索了 ${c.name} 的尸体（已取走部分物品，剩余 ${rest.length} 件留在原地可再搜）`, '#9fd6ff');
                }
                return;
            }
            // —— 普通尸体：掏空保留（像容器可反复打开），未尸变照样 15 分钟尸变 ——
            c._corpseContents = rest;
            if (!rest.length) {
                c._corpseSearched = true;
                c._corpseSearchedDay = sv.day;
                log(`搜索了 ${c.name} 的尸体（物品已取走，尸体保留可再次打开）`, '#9fd6ff');
            } else {
                log(`搜索了 ${c.name} 的尸体（已取走部分物品，剩余 ${rest.length} 件留在原地可再搜）`, '#9fd6ff');
            }
        },
    }, { onUseItem: (idx) => useItem(idx) });
}

// ================= 2026-08-12 v3.40/v3.42 长按 N 扫描周围可交互目标（用户需求） =================
// 长按 N（0.8s，进度环顺时针加载）→ 周围 3×3 格（含脚下）内有目标则弹出"周围可交互目标"
// 居中模态选择面板（滚轮滚动切换选中 + 左键点击确认 + 右上角✕关闭）；无目标则淡入淡出提示
// "周围没有可交互目标"（显示约 1.2s 后自动淡出）。
// 解决"有些交互的地方会有交互不到的问题"：F 键只判定最近单个目标，多目标堆叠/远处目标交互不到时，
// 长按 N 可精确选中任意范围内的目标。面板右上角叉号关闭，ESC 也可关闭。
let scanPanelEl = null;
let scanPanelItems = [];
let scanSel = -1;   // 滚轮选中索引（= 显示序 disp）
let scanDispToIdx = [];   // v4.60 显示序 → 原始 idx（aim 排序后键盘/点击确认用）
function scanPanelOpen() { return !!(scanPanelEl && scanPanelEl.style.display !== 'none'); }
function closeScanPanel() { if (scanPanelEl) scanPanelEl.style.display = 'none'; scanPanelItems = []; scanSel = -1; scanDispToIdx = []; }
function buildScanItem(label, fn, aim) {
    if (!fn) return;
    scanPanelItems.push({ label, fn, aim: !!aim });
}
// 空态淡入淡出 toast（"周围没有可交互目标"，显示 1.2s 后淡出）
let scanToastEl = null, scanToastTimer = null;
function showScanEmptyToast() {
    if (!document.body) return;
    if (!scanToastEl) {
        scanToastEl = document.createElement('div');
        scanToastEl.id = 'wsl-scan-toast';
        scanToastEl.style.cssText = 'position:fixed;top:16%;left:50%;transform:translateX(-50%);z-index:10000;background:rgba(26,31,39,.92);border:1px solid #3a4451;border-radius:10px;padding:12px 22px;color:#e8ecf1;font-size:14px;opacity:0;transition:opacity .3s ease;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.45);';
        document.body.appendChild(scanToastEl);
    }
    scanToastEl.textContent = '周围没有可交互目标';
    scanToastEl.style.opacity = '1';   // 淡入
    if (scanToastTimer) clearTimeout(scanToastTimer);
    scanToastTimer = setTimeout(() => { scanToastEl.style.opacity = '0'; }, 1200);   // 显示后淡出
}
function scanPanelRender() {
    if (!scanPanelEl) {
        scanPanelEl = document.createElement('div');
        scanPanelEl.id = 'wsl-scan-panel';
        scanPanelEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1300;background:#161b22;border:1px solid #3a4451;border-radius:12px;padding:0;min-width:340px;max-width:540px;max-height:70vh;display:none;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.65);color:#e8ecf1;font-family:inherit;overflow:hidden;';
        scanPanelEl.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#1d242e;border-bottom:1px solid #2e3540;">
                <div style="font-weight:bold;font-size:14px;color:#7fd6ff;">周围可交互目标</div>
                <div id="wsl-scan-close" style="cursor:pointer;width:26px;height:26px;line-height:24px;text-align:center;border-radius:50%;background:#2a313c;border:1px solid #3a4451;color:#ff9e9e;font-size:15px;">✕</div>
            </div>
            <div id="wsl-scan-list" style="overflow-y:auto;flex:1;padding:8px 12px;max-height:52vh;"></div>
            <div style="padding:8px 14px;border-top:1px solid #2e3540;color:#8b93a1;font-size:12px;text-align:center;">滚轮切换 · 点击确认 · 右键/Esc 取消</div>`;
        scanPanelEl.querySelector('#wsl-scan-close').addEventListener('click', closeScanPanel);
        document.body.appendChild(scanPanelEl);
        // 2026-08-12 v3.45 事件委托（修复"面板内除了叉号都不能交互"）：
        // 此前 mouseenter/wheel 每次调用 scanPanelRender() → 重建 innerHTML → 旧列表项 click 监听被销毁，
        // 鼠标移过某行再点击时节点已重建，监听丢失 → 点击无反应。改为在 list 容器上委托监听：
        //   · wheel（面板上滚动）→ 切换选中并重绘
        //   · mouseover（hover 行）→ 仅更新选中高亮（不重建整表，避免事件抖动）
        //   · click（点击行）→ 取 data-i 执行对应 fn（先存引用再关闭面板）
        const scanList = scanPanelEl.querySelector('#wsl-scan-list');
        // v4.60 修复"鼠标在扫描 UI 上滑动会抽搐"：根因是 wheel/mouseover 每次都调 scanPanelRender()
        // 重建整个列表 innerHTML——鼠标移动触发 mouseover → 重建 DOM → 鼠标位置下变成新节点 → 又触发
        // mouseover → 事件风暴，列表项来回跳动像"抽搐"。修复=拆分"构建 DOM"与"更新高亮"：
        //   · scanPanelRender() 仅在打开时（openScanPanel）构建列表 DOM（data-i 存原索引，data-disp 存显示序）
        //   · scanPanelHighlight() 只遍历已有行更新选中样式（不重建 DOM）——wheel/mouseover/keydown 都调它
        scanPanelEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!scanPanelItems.length) return;
            scanSel = (scanSel + (e.deltaY > 0 ? 1 : -1) + scanPanelItems.length) % scanPanelItems.length;
            scanPanelHighlight();
        }, { passive: false });
        scanList.addEventListener('mouseover', (e) => {
            const row = e.target.closest('.wsl-scan-item');
            if (!row) return;
            // v4.60 用 data-disp（显示序）作 scanSel——scanSel 是显示索引，与 highlight 比较一致；
            // 若用 data-i（原始索引）在 aim 排序后二者不一致，hover 会选错行
            const disp = Number(row.dataset.disp);
            if (disp >= 0 && disp !== scanSel) { scanSel = disp; scanPanelHighlight(); }
        });
        scanList.addEventListener('click', (e) => {
            const row = e.target.closest('.wsl-scan-item');
            if (!row) return;
            const i = Number(row.dataset.i);
            const it = scanPanelItems[i];
            closeScanPanel();
            if (it && it.fn) it.fn();
        });
    }
    // v4.37 准星指向的目标排顶部：buildScanItem 时 aim=true 的项提前到列表前（保留原相对顺序）
    const _sorted = scanPanelItems
        .map((it, i) => ({ it, i, aim: !!it.aim }))
        .sort((a, b) => (a.aim === b.aim) ? (a.i - b.i) : (a.aim ? -1 : 1));
    const _orderMap = _sorted.map((x, disp) => ({ idx: x.i, disp }));
    const _oriI = (disp) => _orderMap[disp].idx;   // 显示 idx → 原 idx
    scanDispToIdx = _orderMap.map(e => e.idx);   // v4.60 持久化映射（键盘/点击确认时 scanSel 是显示序）

    const list = scanPanelEl.querySelector('#wsl-scan-list');
    if (!scanPanelItems.length) {
        list.innerHTML = '<div style="color:#8b93a1;padding:8px 0;text-align:center;">附近（3×3 格内）没有可交互目标</div>';
    } else {
        if (scanSel < 0) scanSel = 0;
        // v4.60 构建 DOM 时所有行统一基础样式 + data-disp（显示序）；选中态由 scanPanelHighlight 动态更新
        const _rows = _orderMap.map((entry, disp) => {
            const it = scanPanelItems[entry.idx];
            const _on = disp === scanSel;
            return `<div class="wsl-scan-item" data-i="${entry.idx}" data-disp="${disp}" style="cursor:pointer;padding:9px 12px;border-radius:6px;border:1px solid ${_on ? '#39d98a' : (it.aim ? '#5d8a72' : '#2e3540')};background:${_on ? 'rgba(57,217,138,.14)' : (it.aim ? 'rgba(57,217,138,.06)' : '#212833')};margin:5px 0;display:flex;align-items:center;gap:8px;"><span class="wsl-scan-dot" style="color:${_on ? '#39d98a' : (it.aim ? '#5dd0a4' : '#7fd6ff')};font-size:13px;">${_on ? '●' : (it.aim ? '◎' : '○')}</span><span style="flex:1;font-size:13px;">${it.label}</span></div>`;
        }).join('');
        list.innerHTML = _rows;
        scanPanelHighlight();
        // 2026-08-12 v3.45 交互走事件委托（scanList 容器上监听 mouseover/click），此处不再逐行绑定
    }
    scanPanelEl.style.display = 'flex';
}
// v4.60 仅更新选中行高亮（不重建 DOM，避免鼠标滑动抽搐）——wheel/mouseover/keydown 共用
function scanPanelHighlight() {
    if (!scanPanelEl || scanPanelEl.style.display === 'none') return;
    const list = scanPanelEl.querySelector('#wsl-scan-list');
    if (!list) return;
    const rows = list.querySelectorAll('.wsl-scan-item');
    for (const row of rows) {
        const _disp = Number(row.dataset.disp);
        const _it = scanPanelItems[Number(row.dataset.i)];
        if (!_it) continue;
        const _on = _disp === scanSel;
        row.style.borderColor = _on ? '#39d98a' : (_it.aim ? '#5d8a72' : '#2e3540');
        row.style.background = _on ? 'rgba(57,217,138,.14)' : (_it.aim ? 'rgba(57,217,138,.06)' : '#212833');
        const dot = row.querySelector('.wsl-scan-dot');
        if (dot) {
            dot.style.color = _on ? '#39d98a' : (_it.aim ? '#5dd0a4' : '#7fd6ff');
            dot.textContent = _on ? '●' : (_it.aim ? '◎' : '○');
        }
    }
    // 高亮项滚入视野（滚轮翻页时跟随）
    const _selRow = list.querySelector(`.wsl-scan-item[data-disp="${scanSel}"]`);
    if (_selRow && _selRow.scrollIntoView) _selRow.scrollIntoView({ block: 'nearest' });
}
// 键盘 ↑↓ 切换选中（keydown 里调用）
function scanSelMove(d) {
    if (!scanPanelOpen() || !scanPanelItems.length) return;
    scanSel = (scanSel + d + scanPanelItems.length) % scanPanelItems.length;
    scanPanelHighlight();
}
function scanSelConfirm() {
    if (!scanPanelOpen() || !scanPanelItems.length) return;
    // v4.60 scanSel 是显示序，经 scanDispToIdx 转原始 idx（aim 排序后键盘确认不再选错）
    const _d = scanSel < 0 ? 0 : scanSel;
    const _idx = (scanDispToIdx[_d] != null ? scanDispToIdx[_d] : _d);
    const it = scanPanelItems[_idx];
    closeScanPanel();
    if (it && it.fn) it.fn();
}
// 收集 3×3（含脚下）范围内可交互目标并渲染面板
function openScanPanel() {
    if (!sv || sv.dead) return;
    scanPanelItems = [];
    const ptx = sv.interior ? Math.floor(sv.interior.px / TS) : Math.floor(sv.px / TS);
    const pty = sv.interior ? Math.floor(sv.interior.py / TS) : Math.floor(sv.py / TS);
    // v4.37 鼠标世界坐标（与 render.updateMouseWorld 一致）：室内 sv.camX+sv.mouse.x；室外 sv.camX+sv.mouse.x。
    // 鼠标指向格 agx/agy → 优先排它的候选在面板顶部，按指针交互"准星指向的可交互目标"。
    const _mw = (sv.camX != null ? sv.camX : 0) + (sv.mouse && sv.mouse.x != null ? sv.mouse.x : 0);
    const _mh = (sv.camY != null ? sv.camY : 0) + (sv.mouse && sv.mouse.y != null ? sv.mouse.y : 0);
    const agx = Math.floor(_mw / TS), agy = Math.floor(_mh / TS);
    // —— 室外 ——
    if (!sv.interior) {
        // 3×3 地块目标（v3.43 只收集"交互会弹 UI"的交互体：容器/储物柜/门/床/车/报废车/垃圾桶/纸箱/报刊亭/消防栓/培养植物；
        // 纯采集类【草药/伐木/阳光/水/作物/中立植物】不弹 UI → 不进扫描列表，仍可 F 直接采集）
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const tx = ptx + dx, ty = pty + dy;
            const t = getTile(sv, tx, ty);
            if (!SCAN_UI_TILES.has(t)) continue;
            if (!containerInteractable(t, tx, ty)) continue;
            if (t === T.DOOR && builtAt(sv, tx, ty)) continue;
            const label = INTERACT_LABEL[t] || '容器';
            const aim = (tx === agx && ty === agy);
            buildScanItem(label, () => { sv.promptTarget = { x: tx, y: ty, t }; doInteract(); }, aim);
        }
        // 尸体（含尸变尸体）：v4.52 合并为单个"与 XX 交互"按钮，点击后弹出选项框
        // （搜索遗物 / 补刀阻止尸变；友善/中立/敌对待尸变尸体都可补刀）。
        // 用户定稿："扫描出来的 UI 不用这么详细，只需一个按钮'与 XX 交互'，点击后再弹选项框"。
        if (sv.npcs) for (const n of sv.npcs) {
            if (!n || !n._corpse || n.downed) continue;
            if (n._revived || n._revivedCorpse) continue;   // 尸变尸体不弹补刀（只可搜索）
            if (Math.abs(n.x - sv.px) > 1.0 * TS || Math.abs(n.y - sv.py) > 1.0 * TS) continue;
            const aim = Math.hypot(_mw - n.x, _mh - n.y) <= 28;
            buildScanItem(`与 ${n.name} 的尸体交互`, () => { openBodyActFor(sv, n); }, aim);
        }
        // 倒地主角（救治）
        if (sv._downed && Math.abs(sv._downed.px - sv.px) <= 1.0 * TS && Math.abs(sv._downed.py - sv.py) <= 1.0 * TS) {
            const aim = Math.abs(_mw - sv._downed.px) < TS && Math.abs(_mh - sv._downed.py) < TS;
            buildScanItem(`救治 ${sv._downed.name}`, () => { sv.promptTarget = { downed: 1, x: Math.floor(sv._downed.px / TS), y: Math.floor(sv._downed.py / TS) }; doInteract(); }, aim);
        }
        // 倒地队友（v4.35 用户定稿："鼠标中键扫描倒地的队友，弹出的UI界面应该是和 XX 队友交互，
        // 选择完这个选项之后，才会弹出那个小UI界面，才能进行救助补刀以及搜索"）——
        // 扫描面板合并为一个"与 XX 交互"项，点击后先弹选择框（滚轮选救治/搜索/补刀）。
        if (Array.isArray(sv._downedMembers)) for (const m of sv._downedMembers) {
            if (!m || !m.alive || !m.downed) continue;
            if (Math.abs(m.x - sv.px) > 1.0 * TS || Math.abs(m.y - sv.py) > 1.0 * TS) continue;
            const aim = Math.hypot(_mw - m.x, _mh - m.y) <= 28;
            buildScanItem(`与 ${m.name} 交互`, () => { openBodyActFor(sv, m); }, aim);
        }
        // 可命令/交谈队友
        if (sv.npcs) for (const n of sv.npcs) {
            if (!n || !n.alive || n.role === 'hostile' || n.downed) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (Math.abs(n.x - sv.px) > 1.0 * TS || Math.abs(n.y - sv.py) > 1.0 * TS) continue;
            const aim = Math.hypot(_mw - n.x, _mh - n.y) <= 28;
            buildScanItem(n.party ? `命令 ${n.name}` : `交谈 ${n.name}`, () => {
                sv.promptTarget = { npc: n.id };
                doInteract();
            }, aim);
        }
        // 营地中心/旗帜
        if (sv.camp && Math.hypot(sv.px - sv.camp.x, sv.py - sv.camp.y) < 6 * TS) {
            const aim = Math.hypot(_mw - sv.camp.x, _mh - sv.camp.y) < 4 * TS;
            buildScanItem('营地（工作日志 · 物资箱）', () => openCampPanel(), aim);
        }
    } else {
        // —— 室内 ——
        const it = sv.interior;
        // 3×3 箱子
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const gx = ptx + dx, gy = pty + dy;
            if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
            const tile = it.tiles[gy * it.w + gx];
            if (tile === WD.INTERIOR_TILES.BOX || tile === WD.INTERIOR_TILES.WBOX
                || tile === WD.INTERIOR_TILES.MEDBOX || tile === WD.INTERIOR_TILES.MATBOX) {
                const aim = (gx === agx && gy === agy);
                buildScanItem('搜索箱子', () => openInteriorBox(gx, gy), aim);
            }
        }
        // 楼梯（v4.64.1 距离 1.4*TS → 1.0*TS，扫描 5×5 → 3×3 九宫格）
        for (let gy = 0; gy < it.h; gy++) for (let gx = 0; gx < it.w; gx++) {
            const tile = it.tiles[gy * it.w + gx];
            if (tile !== WD.INTERIOR_TILES.STAIRS_UP && tile !== WD.INTERIOR_TILES.STAIRS_DOWN) continue;
            const dcx = (gx + 0.5) * TS, dcy = (gy + 0.5) * TS;
            if (Math.hypot(it.px - dcx, it.py - dcy) < 1.0 * TS) {
                const dir = tile === WD.INTERIOR_TILES.STAIRS_UP ? 1 : -1;
                const aim = (gx === agx && gy === agy);
                buildScanItem(dir > 0 ? '上楼' : '下楼', () => WD.changeFloor(sv, dir), aim);
            }
        }
        // 尸体（当前房间/楼层）：v4.52 合并为单个"与 XX 交互"按钮，点击后弹出选项框
        // （搜索遗物 / 补刀阻止尸变）。
        if (sv.npcs) for (const n of sv.npcs) {
            if (!n || !n._corpse || n.downed) continue;
            if (n._revived || n._revivedCorpse) continue;   // 尸变尸体不弹补刀（只可搜索）
            if (!(n.inInterior && n.interiorKey === it.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === (it.floor || 1))) continue;
            if (Math.abs(n.x - it.px) > 1.0 * TS || Math.abs(n.y - it.py) > 1.0 * TS) continue;
            const aim = Math.hypot(_mw - n.x, _mh - n.y) <= 28;
            buildScanItem(`与 ${n.name} 的尸体交互`, () => { openBodyActFor(sv, n); }, aim);
        }
        // 倒地主角 / 倒地队友 / 躲藏幸存者 / 随行队员（同室外语义）
        if (sv._downed && Math.abs(sv._downed.px - it.px) <= 1.0 * TS && Math.abs(sv._downed.py - it.py) <= 1.0 * TS) {
            const aim = Math.abs(_mw - sv._downed.px) < TS && Math.abs(_mh - sv._downed.py) < TS;
            buildScanItem(`救治 ${sv._downed.name}`, () => openRescue(), aim);
        }
        // v4.35 室内同室外：先弹"与 XX 交互"选择框，滚轮选救治/搜索/补刀
        if (Array.isArray(sv._downedMembers)) for (const m of sv._downedMembers) {
            if (!m || !m.alive || !m.downed) continue;
            if (Math.abs(m.x - it.px) > 1.0 * TS || Math.abs(m.y - it.py) > 1.0 * TS) continue;
            const aim = Math.hypot(_mw - m.x, _mh - m.y) <= 28;
            buildScanItem(`与 ${m.name} 交互`, () => { openBodyActFor(sv, m); }, aim);
        }
        if (it.npcs) for (const n of it.npcs) {
            if (!n || n.hp <= 0) continue;
            if (Math.abs(n.x - it.px) > 1.0 * TS || Math.abs(n.y - it.py) > 1.0 * TS) continue;
            const aim = Math.hypot(_mw - n.x, _mh - n.y) <= 28;
            buildScanItem(`交谈 ${n.name}`, () => openNpcMenu(n.id), aim);
        }
        // 2026-08-12 v3.61 室内扫描补"随行队友/初始主控"交互（与室外 line 3197-3206 语义一致）：
        // 本房间本楼层的随行队员可命令/交谈；切视角成队友后，初始主控也在 sv.npcs 里 → 也能交互。
        if (sv.npcs) for (const n of sv.npcs) {
            if (!n || !n.alive || n.role === 'hostile' || n.downed) continue;
            if (!(n.inInterior && n.interiorKey === it.key && (n.interiorFloor == null ? 1 : n.interiorFloor) === (it.floor || 1))) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (Math.abs(n.x - it.px) > 1.0 * TS || Math.abs(n.y - it.py) > 1.0 * TS) continue;
            const aim = Math.hypot(_mw - n.x, _mh - n.y) <= 28;
            buildScanItem(n.party ? `命令 ${n.name}` : `交谈 ${n.name}`, () => {
                sv.promptTarget = { npc: n.id };
                doInteract();
            }, aim);
        }
    }
    // 2026-08-12 v3.42 空态淡入淡出 toast；有目标才渲染面板
    if (!scanPanelItems.length) { showScanEmptyToast(); return; }
    scanPanelRender();
}

// 街道杂物单件掉落（并入箱子持久化搜索流程；返回 [id,n] 或 null=空手）
// v3.19 街道杂物改容器分池 + 全局权重（CONTAINER_LOOT_POOLS）；原 rollTrashLoot 等按箱型硬编码表已移除

// ---------- 室内 F 交互（搜索箱子） ----------
function doInteriorInteract() {
    const it = sv.interior;
    if (!it) return;
    // v4.57 修复"F 键对室内躺地 NPC 无效"：与室外 doInteract 一致——
    // 首次按 F = 弹选择框（openBodyActFor），第二次按 F = 执行（execBodyAct）。
    // 之前只调 execBodyAct(sv) 读 sv._bodyAct，但 v4.57 拆掉自动弹后 sv._bodyAct=null → 永远返回 false。
    {
        const _bAt = it.promptTarget && it.promptTarget.bodyAct;
        if (_bAt) {
            const m = (sv.npcs || []).find(x => x && x.id === _bAt);
            if (m) {
                if (sv._bodyAct && sv._bodyAct.npcId === _bAt && execBodyAct(sv)) return;
                const d = Math.hypot(m.x - it.px, m.y - it.py);
                if (d < 1.0 * TS) {
                    openBodyActFor(sv, m);
                    return;
                }
            }
        } else if (sv._bodyAct) {
            // 没有 bodyAct 指针命中，但 sv._bodyAct 已开（用户正在选择中）→ 执行/关
            if (execBodyAct(sv)) return;
        }
    }
    // v4.41 统一"指针指向优先"：直接读 it.promptTarget（updateInteriorPrompt 每帧计算，
    // 金框指哪个就交互哪个——单一判定源，杜绝"金框与 F 执行不一致"）。
    const tg = it.promptTarget;
    if (!tg) { log('附近没有可交互的东西'); return; }
    // 倒地主控：F = 打开救治 UI / 放下
    if (tg.downed) {
        if (sv._carryDowned) {
            sv._carryDowned = false;
            sv._downed.px = it.px; sv._downed.py = it.py;
            log(`你放下了 ${sv._downed.name}`, '#B8C4C8');
        } else {
            openRescue();
        }
        return;
    }
    // 尸体：v4.52 改为弹选择框（搜索遗物/补刀阻止尸变；尸变尸体只搜索），与室外 doInteract 一致。
    if (tg.corpse) {
        const n = (sv.npcs || []).find(x => x && x.id === tg.corpse);
        if (!n) return;
        if (n._revived || n._revivedCorpse) { openCorpseSearchUI(n); return; }
        openBodyActFor(sv, n);
        return;
    }
    // 倒地队友：v4.52 改为弹选择框（救治/搜索/补刀），与室外 doInteract 一致
    if (tg.downedMate) {
        const m = (sv.npcs || []).find(x => x && x.id === tg.downedMate);
        if (!m || !m.alive || !m.downed) return;
        openBodyActFor(sv, m);
        return;
    }
    // 躲藏幸存者 / 队员：party → 命令面板；隐藏幸存者 → NPC 菜单
    if (tg.npc) {
        if (tg.mate) {
            const m = (sv.npcs || []).find(x => x && x.id === tg.id);
            if (!m || !m.alive || !m.inInterior) return;
            if (m.party) openNpcCommandMenu(m);
            else openNpcMenu(m.id);
        } else {
            openNpcMenu(tg.id);
        }
        return;
    }
    // 楼梯：换层
    if (tg.stairs) {
        WD.changeFloor(sv, tg.dir > 0 ? 1 : -1);
        return;
    }
    // 箱子（默认：含 x/y 的格目标）
    if (tg.x != null && tg.y != null) {
        openInteriorBox(tg.x, tg.y);
        return;
    }
    log('附近没有可交互的东西');
}

// 室内箱子：接入搜索界面 + 持久化（键含 doorKey，随存档）；与室外箱统一流程（室内 = 换场景）
function openInteriorBox(gx, gy) {
    const it = sv.interior;
    if (!it) return;
    const key = 'int:' + (it.key || '') + ':' + (it.floor || 1) + ':' + gx + ',' + gy;
    if (!sv.mods.boxLoot) sv.mods.boxLoot = {};
    const stored = sv.mods.boxLoot[key];
    const tile = it.tiles[gy * it.w + gx];
    const boxType = tile === WD.INTERIOR_TILES.WBOX ? T.WBOX
        : tile === WD.INTERIOR_TILES.MEDBOX ? T.MEDBOX
            : tile === WD.INTERIOR_TILES.MATBOX ? T.MATBOX : T.BOX;
    const worldGX = (it.originX || 0) + gx;
    const worldGY = (it.originY || 0) + gy;
    let items, reopened = false;
    if (stored && stored.length) {
        items = stored.map(o => ({ id: o.id, n: o.n, done: !!o.r, slot: o.slot }));
        // 逐件记忆进度：已完成的直接显示（不重搜）、未完成的继续渐亮；全部完成 → 整体直接显示
        reopened = stored.every(o => o.r);
    } else if (stored) {
        // 空箱子：保留，可再次打开，直接显示空位
        items = [];
        reopened = true;
    } else {
        items = rollBoxContents(boxType, worldGX, worldGY);
        sv.mods.boxLoot[key] = items.map(o => ({ id: o.id, n: o.n, r: false }));
        reportBoxLootChange(key);   // 联机：首次开箱内容确定 + 上报（双方一致）
    }
    AudioSystem.playOpenBox();
    WSearch.openSearch(sv, {
        items, name: BOX_NAME[boxType] || '箱子', immediate: reopened,
        gx: worldGX, gy: worldGY, cap: CONTAINER_STORE[boxType] || 12,
        onClose: (remaining, searched) => {
            // 关闭：剩余物写回箱子（不丢地上）；掏空留空箱（箱子不消失、可再打开）；
            // 每件物品记录 r = 是否已搜索完成、slot = 原散落槽位（重开位置不变）
            if (!sv.mods.boxSearched) sv.mods.boxSearched = {};
            sv.mods.boxLoot[key] = (remaining || []).filter(o => o && o.n > 0).map(o => ({ id: o.id, n: o.n, r: !!o.r, slot: o.slot }));
            sv.mods.boxSearched[key] = !!searched;
            reportBoxLootChange(key);   // 联机：室内箱内容同步
        },
    }, { onUseItem: (idx) => useItem(idx) });
}

// 街道杂物类型（并入箱子持久化搜索：可反复打开、复开跳过搜索进度、掏空不消失但不再提示）
const STREET_JUNK_SET = new Set([T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES]);

function rollBoxContents(boxType, gx, gy) {
    // 确定性随机（联机双方同 seed+位置 开出相同内容）：临时替换 Math.random
    // 种子 = 世界 seed ^ 格子坐标 ^ 箱子类型 —— 纯函数，双方生成一致
    const seedBase = (sv && sv.world ? sv.world.seed : 0);
    const kx = typeof gx === 'number' ? gx : 0, ky = typeof gy === 'number' ? gy : 0;
    // hash2 返回 0-1 浮点 → 放大为 32 位整数种子
    let s = Math.floor(hash2(seedBase ^ 0xB0F, kx, ky) * 4294967296) >>> 0;
    const rng = () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const _mr = Math.random;
    Math.random = rng;
    try {
        const items = [];
        const def = CONTAINER_LOOT_POOLS[boxType];
        const isStreet = STREET_JUNK_SET.has(boxType);
        // v3.19 用户定稿：物资全局权重 + 容器分池——从容器池按全局权重抽；街道 1~2 件可空手、不掺字块
        const rolls = isStreet ? (1 + Math.floor(Math.random() * 2)) : (2 + Math.floor(Math.random() * 2));
        for (let i = 0; i < rolls; i++) {
            if (def && def.empty && Math.random() < def.empty) continue;
            const id = def ? WW.rollGlobalLoot(def.items, Math.random) : null;
            if (!id) continue;
            items.push({ id, n: WW.globalLootQty(id, Math.random) });
        }
        if (isStreet) return items;
        const source = boxType === T.WBOX ? 'weapon' : boxType === T.MEDBOX ? 'medical' : boxType === T.MATBOX ? 'material' : 'supply';
        items.push(...rollWordAddon(source, gx, gy));
        // 2026-08-12 v3.8 箱子低概率掉落配方（优先未解锁；地图区域修正影响概率）
        if (Math.random() < B.RECIPE_DROP_CHANCE_BOX) {
            const recipe = WW.rollRecipeItem(recipeUnlockedSet(), Math.random);
            if (recipe) items.push(recipe);
        }
        // 2026-08-12 v3.18 文字手术刀（用户定稿）：仅医疗箱 2% 掉落（唯一获取途径；普通容器不再掉落）
        if (boxType === T.MEDBOX && Math.random() < B.SURGERY_MEDBOX_DROP_CHANCE) {
            items.push({ id: 'tool:surgery', n: 1, dur: B.SURGERY_DUR });
        }
        return items;
    } finally {
        Math.random = _mr;
    }
}

// 2026-08-12 v3.8 已解锁配方集合（初始基础配方 + 玩家已学习的配方）
function recipeUnlockedSet() {
    const set = new Set(['water', 'wood', 'stone', 'food', 'herb']);
    if (sv && Array.isArray(sv.mods.recipes)) for (const id of sv.mods.recipes) set.add(id);
    return set;
}

function wordRegionModifier(gx, gy) {
    if (!sv || !sv.world) return null;
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    const region = districtAt(sv.world.seed, cx, cy);
    return B.WORD_LOOT_REGION_MODIFIERS[region] || null;
}

function rollWordAddon(source, gx = 0, gy = 0) {
    const table = B.WORD_LOOT_SOURCE_TABLES[source];
    if (!table) return [];
    // v3.18 用户定稿：容器分主题字池（不同容器文字池不同）；池内每字概率按全局权重归一化（全局一致）。
    const options = { modifier: wordRegionModifier(gx, gy), glyphPool: WW.GLYPH_SOURCE_POOLS[source] || WW.GLYPH_SOURCE_POOLS.supply };
    const result = WW.rollWordLootOutcome(source, table, options);
    return result.items;
}

// v3.19 标准四箱/街道杂物统一走 CONTAINER_LOOT_POOLS 容器分池 + 全局权重（原 rollSupplyLoot 等按箱型硬编码表已移除）
// ---------- v3.19 容器分池（用户定稿：容器 = 可出物资集合；池内按全局权重抽 → 全局概率一致） ----------
// empty = 街道杂物每件空手概率（保持"可空手"特色）；汽车独立池 CAR_LOOT_POOL（不占 tile）
const CONTAINER_LOOT_POOLS = {
    [T.BOX]: { items: ['wood', 'stone', 'water', 'food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon', 'herb', 'heal:bandage', 'heal:tonic', 'heal:kit', 'fert', 'sun', 'part', 'coin', 'fuel', 'tool:hoe', 'flag', 'ammo:pistolAmmo', 'ammo:arrowAmmo'] },
    [T.WBOX]: { items: ['wpn:pistol', 'wpn:dagger', 'wpn:knife', 'wpn:shovel', 'wpn:sword', 'wpn:spear', 'wpn:bow', 'wpn:shotgun', 'wpn:axe', 'wpn:smg', 'wpn:rifle', 'wpn:sniper', 'ammo:pistolAmmo', 'ammo:smgAmmo', 'ammo:rifleAmmo', 'ammo:sniperAmmo', 'ammo:shellAmmo', 'ammo:arrowAmmo', 'ammo:knifeAmmo', 'part', 'stone', 'flag', 'coin'] },
    [T.MEDBOX]: { items: ['herb', 'heal:bandage', 'heal:tonic', 'heal:kit', 'med:cold', 'med:wound', 'med:poison', 'med:dysentery', 'med:heat', 'med:pan', 'food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon', 'water', 'fert', 'sun'] },
    [T.MATBOX]: { items: ['wood', 'stone', 'part', 'tool:chopper', 'tool:pick', 'tool:wrench', 'tool:hoe', 'ammo:pistolAmmo', 'ammo:shellAmmo', 'ammo:knifeAmmo'] },
    [T.TRASHBIN]: { items: ['food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon', 'water', 'part', 'herb', 'heal:bandage', 'coin', 'fuel'], empty: 0.14 },
    [T.CARDBOX]: { items: ['wood', 'food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon', 'part', 'coin', 'ammo:pistolAmmo', 'ammo:arrowAmmo'], empty: 0.26 },
    [T.HYDRANT]: { items: ['water', 'part'], empty: 0.15 },
    [T.NEWSSTAND]: { items: ['food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon', 'herb', 'heal:bandage', 'wood', 'part', 'coin'], empty: 0.30 },
    [T.TIRES]: { items: ['part', 'ammo:pistolAmmo', 'ammo:shellAmmo', 'ammo:knifeAmmo'], empty: 0.38 },
};
const CAR_LOOT_POOL = ['wpn:pistol', 'wpn:dagger', 'wpn:knife', 'wpn:shovel', 'wpn:sword', 'wpn:spear', 'wpn:bow', 'wpn:shotgun', 'wpn:axe', 'wpn:smg', 'wpn:rifle', 'wpn:sniper', 'ammo:pistolAmmo', 'ammo:smgAmmo', 'ammo:rifleAmmo', 'ammo:sniperAmmo', 'ammo:shellAmmo', 'ammo:arrowAmmo', 'ammo:knifeAmmo', 'fuel', 'part', 'food', 'carrot', 'corn', 'potato', 'bread', 'apple', 'melon', 'wood', 'coin'];
const BOX_NAME = {
    [T.BOX]: '物资箱', [T.WBOX]: '武器箱', [T.MEDBOX]: '医疗箱', [T.MATBOX]: '建材箱',
    [T.TRASHBIN]: '垃圾桶', [T.CARDBOX]: '纸箱', [T.HYDRANT]: '消防栓', [T.NEWSSTAND]: '报刊亭', [T.TIRES]: '废弃轮胎',
};

// v3.19 汽车后备箱统一走 CAR_LOOT_POOL 分池 + 全局权重（原 rollCarLoot 硬编码表已移除）

// 容器储物规格（差异化容量）：标准四类箱 12 格；路边小箱（纸箱/报刊亭）6 格；垃圾桶 4 格小储物；
// 消防栓只取水不储物、轮胎纯障碍
const CONTAINER_STORE = {
    [T.BOX]: 12, [T.WBOX]: 12, [T.MEDBOX]: 12, [T.MATBOX]: 12,
    [T.CARDBOX]: 6, [T.NEWSSTAND]: 6, [T.TRASHBIN]: 4,
};

// 容器统一入口：未搜过 → 搜索过程；可储物容器搜过转储物箱随时存取；
// 垃圾桶/消防栓搜过即空（不再交互）；轮胎不可交互。
function openContainer(boxType, gx, gy) {
    if (boxType === T.TIRES) return;   // 轮胎纯障碍，不可交互
    const key = gx + ',' + gy;
    if (!sv.mods.boxLoot) sv.mods.boxLoot = {};
    if (boxType === T.HYDRANT) {      // 消防栓：取一点水（一次性，不作为存储）
        if (sv.mods.boxLoot[key]) return;
        sv.mods.boxLoot[key] = [];
        Panel.addItem(sv, 'water', 1);
        AudioSystem.playCollect();
        log('从消防栓里取了一点水 → 水×1');
        return;
    }
    // 旧存档已转储物的箱子：仍可存取（新流程不再创建，箱子统一保留搜索界面形态）
    if (sv.mods.chests && sv.mods.chests['box:' + key]) { Panel.showChest(sv, 'box:' + key, BOX_NAME[boxType] || '储物柜'); return; }
    const stored = sv.mods.boxLoot[key];
    if (stored === undefined) {          // 未搜索：走搜索过程
        openBoxSearch(boxType, gx, gy);
        return;
    }
    // 其余一律走 openBoxSearch：未完成 → 重新搜索；已完成 → 直接显示（物品留在原位，不重排、不转储物）
    openBoxSearch(boxType, gx, gy);
}

// 开箱 → 进入搜索界面（逐件揭示，完成后可拿取/丢弃）
// 箱子持久化：搜过不消失，剩余物存 sv.mods.boxLoot["gx,gy"]，关闭不丢出、掏空留空箱（仍可再次打开）
function openBoxSearch(boxType, gx, gy) {
    const key = gx + ',' + gy;
    if (!sv.mods.boxLoot) sv.mods.boxLoot = {};
    const stored = sv.mods.boxLoot[key];
    let items, reopened = false;
    if (stored && stored.length) {
        items = stored.map(it => ({ id: it.id, n: it.n, done: !!it.r, slot: it.slot }));
        // 逐件记忆进度：已完成的直接显示（不重搜）、未完成的继续渐亮；
        // 全部已完成 → 整体直接显示（物品留在原散落槽位，不重排）
        reopened = stored.every(it => it.r);
    } else if (stored) {
        // 空箱子：保留，可再次打开，直接显示空位（不播放搜索过程）
        items = [];
        reopened = true;
    } else {
        items = rollBoxContents(boxType, gx, gy);
        sv.mods.boxLoot[key] = items.map(it => ({ id: it.id, n: it.n, r: false }));
    }
    AudioSystem.playOpenBox();
    WSearch.openSearch(sv, {
        items, name: BOX_NAME[boxType] || '箱子', gx, gy, immediate: reopened,
        cap: CONTAINER_STORE[boxType] || 12,
        onClose: (remaining, searched) => {
            // 关闭：剩余物写回箱子（不丢地上）；掏空则留空箱（[]，箱子不消失、可再打开）；
            // 每件物品记录 r = 是否已搜索完成、slot = 原散落槽位（重开位置不变）
            if (!sv.mods.boxSearched) sv.mods.boxSearched = {};
            sv.mods.boxLoot[key] = (remaining || []).filter(it => it && it.n > 0).map(it => ({ id: it.id, n: it.n, r: !!it.r, slot: it.slot }));
            sv.mods.boxSearched[key] = !!searched;
            reportBoxLootChange(key);
        },
    }, { onUseItem: (i) => useItem(i) });
}

// ================= 植物弹丸命中玩家 =================
function updatePlantBullets() {
    for (let i = sv.bullets.length - 1; i >= 0; i--) {
        const b = sv.bullets[i];
        if (!b.srcPlant || !b.hostile) continue;
        if (Math.hypot(b.x - sv.px, b.y - sv.py) < 18) {
            if (sv.isJumping || sv.invuln > 0 || wakeActive(sv)) { sv.bullets.splice(i, 1); continue; }   // 苏醒中无敌
            // 2026-08-11 v2.97 倒地玩家被植物弹丸命中 → 扣救援时间（不直接扣血，防负血）
            if (sv._downed && (!sv.controllerId || (sv.npcs || []).find(n => n.id === sv.controllerId && n.downed))) {
                if (sv._downed._penaltySec == null) sv._downed._penaltySec = 0;
                sv._downed._penaltySec += Math.round(b.damage) * B.DOWNED_HIT_PENALTY_SEC;
            } else if (!sv._devGod) {
                sv.hp = Math.max(0, sv.hp - b.damage);
                // 2026-08-11 v2.98 击杀明细：记录最后攻击者（植物弹丸），死亡弹窗显示"被植物弹丸击中致死"
                sv._lastHitBy = { name: '敌对植物', weapon: '弹丸', via: '植物' };
            }
            sv.hurtT = 0.3;
            sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 0.15, maxLife: 0.15, label: '刺' });
            AudioSystem.playPlayerHurt();
            sv.bullets.splice(i, 1);
        }
    }
}

// ================= 死亡 =================
// 死亡掉落惩罚（2026-08-09 用户定稿，软核/硬核通用）：
// 死亡时部分物品掉进原地遗物包裹 loot:legacy；死亡次数越多，掉落越丰富越稀有（有上限）。
// 返回 { kept, vanished }（掉进包裹的 kept / 永久消失的 vanished）。
// 确定性：hash2(seed, 死亡格, 槽位, 次数)（§13.2 世界状态禁 Math.random）。
// 稀有度偏好：按 itemValue 排序——价值高（稀有）的物品先被判定掉落，使包裹随死亡次数更丰富更稀有。
function deathDropLegacy(sv, deadName, skipCorpse) {
    sv._deathCount = (sv._deathCount || 0) + 1;
    const dropRate = B.deathDropRate(sv._deathCount);
    // 按价值降序处理（高价值=高稀有度优先掉落，包裹内容更稀有）
    const slots = [];
    for (let i = 0; i < sv.inv.length; i++) if (sv.inv[i]) slots.push({ i, s: sv.inv[i] });
    slots.sort((a, b) => B.itemValue(b.s.id) - B.itemValue(a.s.id));
    const total = slots.length;
    const kept = [], vanished = [];
    // 2026-08-10 修复"室内死亡重生点堆遗物"：室内死亡时 sv.px/py 是房间局部坐标，
    // 若直接当作世界坐标放遗物，重生后遗物会出现在世界错误的坐标（恰逢重生点附近 → 堆积）。
    // 遗物应掉在【门口世界坐标】（it.doorX/doorY 由 enterInterior 记录），重生后可在门口找回。
    let dropX = sv.px, dropY = sv.py;
    if (sv.interior && typeof sv.interior.doorX === 'number') {
        dropX = sv.interior.doorX;
        dropY = sv.interior.doorY;
    }
    // 2026-08-10 死亡位置指引：无论身上有没有物品，都记录死亡点（软核模式方便找回上次死亡位置）。
    // 统一为「死亡地点」指引（无 hasBag 区分；遗物以主角尸体形式留在死亡点，靠近 F 搜索）。
    // 2026-08-10 独立的"上次死亡位置"持久记录：指引 _legacyDrop 会因"走到死亡点 3 格内/尸体被
    // 搜索完"而清除，但 _lastDeathPos 不随之消失——开发者「传送死亡点」用它兜底（测试用），
    // 不依赖指引是否存在。
    sv._legacyDrop = { x: dropX, y: dropY };
    sv._lastDeathPos = { x: dropX, y: dropY };
    // 2026-08-11 v2.98 用户需求：**背包空的尸体也要可搜索**——生成空尸体（_corpseContents=[]），
    // 靠近 F 可打开空搜索界面（显示空），15 分钟照样尸变，尸变丧尸被击败掉尸变尸体，搜索完消失。
    // 此前 `total===0` 直接 return / `kept` 空不生成 → 空背包死亡后无尸体可搜（违背需求）。
    // 非空背包：按价值降序确定性掉落，kept = 保留在高价值物品（掉尸体里），vanish = 永久消失。
    if (total > 0) {
        // 2026-08-09 用户要求"按物品数量确定掉落几个物品，不是按格子数"：
        // 原"每个物品独立概率 roll"会让玩家感觉"10% 但偶尔全不掉/全掉，不符合 10% 比例"。
        // 改为【确定性数量】——按价值降序，掉后 N 件（低价值优先掉，保留高价值），N = ceil(total × dropRate)。
        // ceil 让 10 件物品掉 1 件（10%），1 件物品也至少掉 1 件（空背包或稀有物品仍会掉）。
        // 同时【关键修复】原代码保留下来的物品只 push 到 kept 但未清空 sv.inv[i]，
        // 导致 kept 与背包物品同时存在 → 截图显示"物品被复制"（背包里所有物品都进了遗物包裹，但身上没消失）。
        // 现在保留的也必须 sv.inv[i] = null，避免复制。
        const dropCount = Math.max(1, Math.ceil(total * dropRate));
        // 价值降序 → 前 (total - dropCount) 件保留为 kept（高价值），后 dropCount 件 vanished（低价值先掉）
        const keepN = total - dropCount;
        for (let i = 0; i < total; i++) {
            const { i: idx, s } = slots[i];
            if (i < keepN) {
                // 2026-08-10 用户要求"物品功能不会丧失"：保留完整物品对象（含 wpn: 武器耐久/附魔等
                // 自定义属性），不能只存 {id,n}——否则搜索尸体拿回的武器/消耗品丢属性导致失效。
                kept.push({ ...s, n: s.n });
            } else {
                vanished.push(s.id);
            }
            sv.inv[idx] = null;   // 关键修复：无论保留还是消失，背包槽位都清空（消除"复制" bug）
        }
    }
    // 2026-08-10 遗物以【主角尸体】形式留在死亡点（用户要求：遗物包裹 = 尸体，靠近 F 搜索）：
    // 不再生成 loot:legacy 掉落袋，而是复用成员尸体机制（_corpse + _corpseContents + drawCorpse +
    // F 交互搜索），尸体无碰撞、可穿过、形象常驻，搜索后标记 _corpseSearched（提示消失）。
    // 2026-08-11 v2.98 用户需求：**无论背包空不空都生成尸体**（空尸体也可搜索/尸变）。
    // v4.41 skipCorpse：主控感染死亡时主控记录本身转为尸体（_corpse=true），
    // 不再生成独立 corpse:N 尸体（避免同一死亡点两个尸体重叠 + 保证队伍面板保留到尸变）。
    if (!skipCorpse) {
        if (!Array.isArray(sv.npcs)) sv.npcs = [];
        const corpseSeq = (sv._corpseSeq = (sv._corpseSeq || 0) + 1);
        sv.npcs.push({
            id: 'corpse:' + corpseSeq, name: deadName || sv.characterName || '幸存者',
            role: 'friendly', look: sv.character || null,
            x: dropX, y: dropY, hp: 0, maxHp: 100,
            alive: false, _corpse: true, _corpseDay: sv.day,
            // 2026-08-11 v2.98 尸体尸变系统：记录尸体生成现实时刻
            _corpseAtReal: sv.now != null ? sv.now : 0,
            _corpseContents: kept, _corpseSearched: false,
            // 尸体放世界坐标（门口），无需室内标记（世界坐标室外渲染）
            inInterior: false, interiorKey: null, interiorFloor: null,
            atkCd: 0, hurtT: 0, idleT: 0, workT: 0, campTask: null, _nextNeed: 2,
        });
    }
    return { kept, vanished };
}
// 软核重生（2026-08-09）：无队友死亡 / 倒地救治队友全灭 共用。
// 复活点：有床（睡过）→ 床旁；无床 → 随机地点。重生点刷"玩家名"僵尸。
function softRespawn(sv, dropTxt, deadName) {
    let rx, ry;
    if (sv.homeBed) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const cx = (sv.homeBed.x + dx + 0.5) * TS, cy = (sv.homeBed.y + dy + 0.5) * TS;
            if (canStand(cx, cy)) { rx = cx; ry = cy; dy = 2; break; }
        }
        if (rx === undefined) { rx = (SPAWN.x + 0.5) * TS; ry = (SPAWN.y + 0.5) * TS; }
    } else {
        // v3.62 无床重生：随机到城区/郊区/废墟三选一（与创建账号苏醒区域规则一致）
        const sp = randomZoneSpawn(sv.world.seed, sv);
        if (sp) { rx = sp.x; ry = sp.y; }
        else {
            // 兜底：随机地点（原逻辑：随机角度，距中心 10~16 区块）
            const ang = Math.random() * Math.PI * 2;
            const dist = (10 + Math.random() * 6) * CHUNK;
            rx = Math.round(Math.cos(ang) * dist + 0.5) * TS;
            ry = Math.round(Math.sin(ang) * dist + 0.5) * TS;
        }
    }
    // 重生点刷"玩家名"僵尸（用户 2026-08-09：重生后能看到位置，但过 3 天才刷）
    // 2026-08-11 v2.98 改为现实时间：15 分钟后在重生点生成"玩家名"僵尸（由 updatePzRespawn 每帧推进）
    // 2026-08-11 v2.99 修复"玩家尸化僵尸瞬移到脚下"：用户反馈"脚下额外生成一只"——
    // 原重生点 rx/ry = 床旁 = 玩家当前脚下，15 分钟后 updatePzRespawn 在此处生成玩家尸化精英僵尸，
    // 视觉上"瞬移过来"。改为：刷尸位置 = 死亡地点（_lastDeathPos），玩家离开后僵尸留在原死亡点不追玩家。
    // 软核死亡：只标记 _pzRespawn 延迟刷尸；不主动设置 rx/ry = 重生点。
    const _pzX = (sv._lastDeathPos && sv._lastDeathPos.x != null) ? sv._lastDeathPos.x : rx;
    const _pzY = (sv._lastDeathPos && sv._lastDeathPos.y != null) ? sv._lastDeathPos.y : ry;
    sv._pzRespawn = { x: _pzX, y: _pzY, name: deadName, day: sv.day + B.DOWNED_RESPAWN_PZ_DELAY_DAYS, atReal: sv.now != null ? sv.now : 0 };
    // 重生恢复
    sv.hp = sv.maxHp; sv.hurtT = 0;
    sv.zombies = []; sv.horde = null;
    WA.resetActions(sv);
    sv.stamina = sv.maxStamina; sv.exhausted = false;
    sv.food = B.HUNGER_MAX; sv.water = B.WATER_MAX;
    sv.infection = 0; sv._sick = null;
    sv.px = rx; sv.py = ry;
    // v3.65 重生后清理顶部提示（避免尸潮/announce/log 残留导致 UI 文字重叠/错位）
    sv.announce = null; sv._lastHitBy = null;
    // v3.65 重生后清理死亡地点指引（避免在复活点立即出现"死..."标记）
    sv._lastDeathPos = null;
    // v3.65 重生后天气粒子平滑重置（避免下雨/下雪突然一阵一阵出现）：
    // _wxResetT 是天气系统专用淡入时长（秒），由 updateWeather 处理。
    sv._wxResetT = 0.6;
    sv._weatherFadeT = 0;   // 天气切换淡入淡出进度（0~1，0=全透明→1=完全显示）
    // 2026-08-10 修复"在车上死亡重生后角色仍被钉在车上/位置错乱"：
    // 车上死亡时 sv.driving 残留 → driveCommon 每帧把 sv.px 钉回车位置 → 重生点被覆盖。
    // 重生强制下车：清空 driving、所有 riding 成员下车（防止 driveCommon 继续钉坐标）。
    if (sv.driving) {
        sv.driving = null;
        sv._chauffeured = false;
        sv.driveOrder = null;
        if (sv.npcs) for (const n of sv.npcs) {
            if (n && n.riding) { n.riding = false; }
        }
    }
    sv._downed = null;
    sv._downedMembers = [];   // 2026-08-11 v2.98 重生清倒地成员列表（防残留尸体倒计时）
    // 2026-08-11 v2.98 修复"重生后第一次死亡显示旧的 _lastHitBy"：
    // 重生后若玩家在新死亡前没被新攻击，_lastHitBy 残留上次死因（"被大壮用狙击枪致死"）→ 下次死亡仍用旧值。
    // 重生时清空 → 下次死亡时若没新攻击，按状态推断死因（疾病/饥饿/缺水/战斗兜底）。
    sv._lastHitBy = null;
    // 2026-08-11 v2.99 修复"后续死亡明细不更新（一直显示第一次的死因）"：
    // 死因推断 `_deathReason = (curN._deathReason) || sv._deathReason` 复用持久化残留值——
    // 重生时只清 _lastHitBy 不清 _deathReason → 第二次死亡直接取上次死因，弹窗明细永不刷新。
    // 重生必须清空：下次死亡重新按状态/攻击来源推断。
    sv._deathReason = null;
    // 当前主控记录的 _deathReason 同样残留（onDeath 3628 会写入）——若主控记录被保留
    // （切视角队友场景不重建 initRoster），下次 `(curN._deathReason) || sv._deathReason`
    // 仍优先取旧值 → 一并清空，保证每次死亡明细重新推断。
    const _ctlN = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);
    if (_ctlN) _ctlN._deathReason = null;
    // 2026-08-11 v2.99 重生 = 旧队伍解散：清除已死成员的 party 标记。
    // 全灭弹窗收集"当前队伍每个角色死因"依赖 party 标记——若不清除，重生后再全灭会
    // 把上一世的历史队伍尸体也罗列进弹窗（用户反馈"一个人死不该显示历史队友明细"）。
    // 已死尸体不跑 AI，清 party 不影响行为。
    if (Array.isArray(sv.npcs)) {
        for (const n of sv.npcs) { if (n && !n.alive && n.party) n.party = false; }
    }
    sv._carryDowned = false;
    sv._carryMateId = null;
    sv._waitDowned = false;   // 重生解除原地等待限制
    // 2026-08-09 修复"重生后雷阵雨先稀疏再变密"：
    // 粒子是世界坐标固定池，玩家从死亡点瞬移到重生点 → 相机跳到新位置，旧粒子全部越界被丢弃，
    // 新粒子只能从屏幕顶部逐条补入，1~2 秒才能填满全屏 → 视觉"先稀后密"。
    // 重置粒子 kind/spd → 下一帧 drawWeatherParticles 走「撒全屏」分支，全屏立即均匀，无过渡。
    resetWeatherParticles();
    // 2026-08-09 修复"重生后天气异常（雷阵雨一阵一阵）"：
    // 重生后 sv.t 保持死亡时时间，但 _lastWxHour/_lastHintHour 残留 → updateWeather 的
    // 8:00 切换判定（_lastWxHour<8 && hour>=8）在重生帧重复触发 → 天气反复切换。
    // 重生对齐 _lastWxHour/_lastHintHour 到当前 hour，避免重复切换公告。
    // 【注意】不重置 _weather：天气跨死亡保持持续（死亡时的雨/雪/雾/沙尘不因重生消失），
    // 下一次 8:00 由 updateWeather 用 weatherAt(seed, day) 自动校正为当天应有天气。
    // announce 清空（不留死亡前的天气提示）。
    const curHour = (sv.t / sv.dayLen) * 24;
    sv._lastWxHour = curHour;
    sv._lastHintHour = curHour;
    sv.announce = null;
    sv.dead = false;
    // v3.65 重生天气粒子平滑：_weatherFadeT=0 → drawWeatherParticles 整体 alpha 0
    // 在 1.5s 内渐变到 1；_wxDensityMul=0 同步让强度密度从 0 渐变到目标密度（1.4s）。
    // 避免"刚重生时一阵一阵雨/雪突然出现 → 等一会才正常"的视觉错位（用户反馈）。
    sv._weatherFadeT = 0;
    sv._wxDensityMul = 0;
    // 2026-08-10 修复"软核全灭重生后还是原主控（满血却带濒死标记）"：
    // 当原主控记录（current controller / isPlayer）已死/倒地时，调用 initRoster 删除旧主控，
    // 重新创建一个"幸存者"作为新主控（全新能力/天赋/角色形象）。原主控的遗物尸体已在
    // deathDropLegacy 生成（contains全部背包物品，靠近 F 搜索），原主控记录可直接删除。
    // 硬核一条命不进 softRespawn，无此问题。
    // 2026-08-11 v2.97 修复"幸存者诈尸"（用户反馈：幸存者已死亡成尸体，主控老陈还活着，
    // 结果幸存者尸体复活成会动的活人，被恶意 NPC 击杀）：
    // 此分支本意 = "当前主控（controllerId）已死/倒地时，删旧主控 + initRoster 重建新主角"。
    // 但原条件还检查 oldIsPlayer（isPlayer 记录）——幸存者（isPlayer）即使只是尸体
    // （alive=false 带 _corpse，不是当前主控）也命中 → ① 幸存者尸体被 filter 删除
    // ② initRoster 新建满血幸存者 → 诈尸！正确逻辑：只按【当前主控 controllerId】判断。
    // 幸存者尸体若另有其主（主控是老陈），保持不变，不触发重建。
    const oldCtl = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);
    if (oldCtl && (oldCtl.alive === false || oldCtl.downed || oldCtl.hp <= 0)) {
        // 清掉旧主控记录（删掉 controllerId 记录 + isPlayer 尸体记录，让 initRoster 重建新主角）
        // 2026-08-11 v2.98 测试玩家发现：保留 isPlayer 尸体会让 initRoster 的
        // `!sv.npcs.some(n => n.isPlayer)` 为 false → 不新建主角 → controllerId=null 悬空、
        // 重生后角色异常（旧尸体残留）。死亡遗物已由 deathDropLegacy 生成独立 corpse: 尸体
        // 承载（可搜索），isPlayer 尸体记录可安全删除——initRoster 才能新建干净的新主角。
        if (Array.isArray(sv.npcs)) {
            sv.npcs = sv.npcs.filter(n => n.id !== sv.controllerId && !n.isPlayer);
        }
        sv.controllerId = null;
        WNPC.initRoster(sv);   // 补全新主控（makePlayerEntry：满血、幸存者名、随机天赋，无 downed 标记）
        sv.hp = sv.maxHp; sv.stamina = sv.maxStamina; sv.food = B.HUNGER_MAX; sv.water = B.WATER_MAX;
        sv.hurtT = 0; sv._carryDowned = false; sv._waitDowned = false;
        // 同步新主控记录坐标到重生点
        const newPlayer = sv.npcs.find(n => n.isPlayer);
        if (newPlayer) {
            newPlayer.x = sv.px; newPlayer.y = sv.py;
            newPlayer.hp = sv.hp; newPlayer.stamina = sv.stamina;
            newPlayer.alive = true; newPlayer.downed = false;
        }
        log('……你醒了过来。但你已经不再是原来那个人了。', '#7fd6ff');
    }
    log(`你在濒死边缘撑了过来……${dropTxt}`, '#7fd6ff');
    AudioSystem.playDefeat();
    saveNow();
    // 2026-08-11 v2.99 用户需求：重生睁眼与开场"荒野中醒来"表现完全一致——复用 sv._wake
    // （drawWakeOverlay 渲染模糊+灰雾+单调变亮 + 文字随睁眼浮现/持续/淡出），仅文字内容
    // 不同（画内 reborn 分支显示"你 醒 了 过 来"）。
    // 2026-08-12 v3.58 时长恢复 2.4s（用户定稿：创建角色苏醒/游戏结束重生统一 2.4 秒）。
    sv._wake = { t: 0, dur: 2.4, reborn: true };
}

// 延迟刷尸推进（2026-08-09）：软核重生/超时死亡后，过 DOWNED_PZ_DELAY_DAYS 天在重生点刷"玩家名"僵尸
// 2026-08-11 v2.98 改现实时间：重生点刷"玩家名"僵尸延迟 = DOWNED_RESPAWN_PZ_SECONDS(15 分钟现实秒)
function updatePzRespawn(sv) {
    if (!sv._pzRespawn) return;
    if (sv._pzRespawn.atReal != null) {
        // 新格式（现实秒）：sv.now 推进，到时刷尸
        if (sv.now - sv._pzRespawn.atReal >= B.DOWNED_RESPAWN_PZ_SECONDS) {
            WZ.spawnPlayerZombie(sv, { x: sv._pzRespawn.x, y: sv._pzRespawn.y, name: sv._pzRespawn.name });
            log(`重生点出现了一只「${sv._pzRespawn.name}」的僵尸……`, '#FF5544');
            sv._pzRespawn = null;
            saveNow();
        }
        return;
    }
    // 旧格式（游戏天数，兼容旧档）
    if (sv.day >= sv._pzRespawn.day) {
        WZ.spawnPlayerZombie(sv, { x: sv._pzRespawn.x, y: sv._pzRespawn.y, name: sv._pzRespawn.name });
        log(`重生点出现了一只「${sv._pzRespawn.name}」的僵尸……`, '#FF5544');
        sv._pzRespawn = null;
        saveNow();
    }
}

// ================= 2026-08-11 v2.98 尸体尸变系统（用户定稿） =================
// 规则：
//   ① 每个尸体（主角/成员）生成时记录 _corpseAtReal（现实时刻，尸变倒计时起点）；
//   ② 尸体头顶显示尸变倒计时（现实 15 分钟，drawCorpse 渲染"⚠ 尸变 m:ss"）；
//   ③ 15 分钟到 → 尸体尸变，原地生成「XX（尸变）」丧尸，背包 = 尸体未搜完物品（物品守恒）；
//   ④ 已搜完的尸体也会尸变（用户："搜完15分钟后照样尸变"），丧尸背包为空（物品已被拿走）；
//   ⑤ 尸变丧尸被击败 → 掉「XX（尸变）」尸体（标记 _revivedCorpse），搜索完彻底消失；
//   ⑥ 重生点刷"玩家名"僵尸：3 天 → 现实 15 分钟（见 updatePzRespawn 新格式）。
// 尸变丧尸生成（复用 WZ.spawnPlayerZombie，但背包用尸体未搜物品，物品守恒）
// v4.26 死亡尸变系统已拆到 wcorpse.js（corpseReviveZombie / reviveZombieToCorpse / updateCorpseRevive）
function onDeath() {
    // 防重入锁（2026-08-09 修复"硬核死亡音乐抽搐/卡死/按钮不能点"）：
    // 主循环每帧检查 hp<=0 && !sv.dead → onDeath()。若不在此立即设 dead=true，
    // 死亡弹窗/倒地救治期间 sv.dead 仍为 false 会每帧重复执行 onDeath（尸化僵尸越积越多、
    // 音效抽搐、HTML 重建按钮失效）。锁死后主循环 `!sv.dead` 停止 update，世界冻结。
    // 软核分支（重生/倒地/切视角）成功后在下方重置 sv.dead = false 恢复游戏。
    sv.dead = true;
    // 2026-08-11 残留 _downed 清理（配合主循环去掉 !sv._downed 守卫）：若 `_downed` 是脏状态残留
    // （hp<=0 + _downed 同时存在，说明上次 onDeath 未结算完），清掉让本次走正常流程，避免重复设置同名倒地。
    // 注意：`_downed` 与 hp<=0 共存 = 脏状态；正常路径 _downed 仅在 onDeath 内设置且同时设 hp=1。
    if (sv._downed) {
        // 2026-08-11 v2.97 修复"健康主控带濒死标志，被攻击致死后跳过切队友视角直接全灭"：
        // 残留 _downed 往往伴随当前主控记录 downed=true 悬空（如 _devGod 拉满血不清标志）——
        // 清 _downed 时**同步清当前主控记录的 downed**，否则该记录仍被当倒地：恶意 NPC 攻击走
        // npcApplyDownedHit（扣时而非致死，sv.hp 可能仍满 → onDeath 悬空），mates 过滤也受影响。
        const _cpc = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);
        if (_cpc) { _cpc.downed = false; _cpc._penaltySec = 0; }
        sv._downed = null;
        sv._waitDowned = false;
        log('……清理残留濒死状态，重新结算', '#FFB347');
    }
    const dk = B.DIFF_TABLE[sv.diffKey] || B.DIFF_TABLE.normal;
    // 2026-08-10 切换队友视角后倒下的是当前主控（controllerId）队友：倒下名字应记录该队友，
    // 而非原主角 sv.characterName（否则倒地显示/救治/尸化名字错乱成原主角）。
    const curN = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);
    const deadName = (curN && curN.name) || sv.characterName || '幸存者';
    // 2026-08-11 击败原因（濒死/全灭弹窗显示"XXX 被什么击败了"）：主控记录可能已有
    // _deathReason（killNpc 记录）；血量归零直接 onDeath 的（被咬/被打/饥饿/疾病）兜底按来源推断。
    // 2026-08-11 v2.98 用户需求"击杀明细详细"：按状态推断真正死因（饥饿/缺水/疾病/感染/战斗），
    // 让"被你阵亡了"弹窗显示"幸存者因饥饿致死"等真实原因，而非笼统的"战斗中被击败"。
    // 战斗死因优先用 _lastHitBy（击杀者 + 武器）→ "被大壮用狙击枪击杀了"（用户示例）。
    let deadReason = (curN && curN._deathReason) || sv._deathReason;
    if (!deadReason) {
        // 优先级：疾病 > 感染 > 饥饿/缺水 > 战斗
        if (sv._sick && B && B.SICKNESS && B.SICKNESS[sv._sick.type]) {
            deadReason = `疾病（${B.SICKNESS[sv._sick.type].name}）恶化致死`;
        } else if (sv.infection >= 100) {
            deadReason = '感染恶化致死';
        } else if (sv.food <= 0 && sv.water <= 0) {
            deadReason = '饥饿与缺水致死';
        } else if (sv.food <= 0) {
            deadReason = '饥饿致死';
        } else if (sv.water <= 0) {
            deadReason = '缺水致死';
        } else {
            // 战斗死因：优先用最后攻击来源（恶意 NPC 近战/远程、僵尸啃咬、敌对植物）
            const lhb = sv._lastHitBy;
            if (lhb && lhb.name) {
                if (lhb.weapon) {
                    deadReason = `被${lhb.name}用${lhb.weapon}击杀致死`;
                } else {
                    deadReason = `被${lhb.name}击杀致死`;
                }
            } else {
                deadReason = '战斗中被击败';
            }
        }
    }
    // 主控原因同步给当前主控记录（供全灭详情收集）
    if (curN) curN._deathReason = deadReason;
    sv._deathReason = deadReason;
    // 联机：任一玩家死亡 → 双端结算退出（R7 保持，host 权威判定）。
    // 死亡 v2 的「救回/包裹/尸化」是单机规则：联机 guest 背包在本地（wsync 不带 inv），
    // host 无法权威生成 guest 的遗物包裹/尸化僵尸 → 死亡一律走既有 R7 双端结束，
    // 与 §6 教训5「guest 死亡必须同步」一致，避免 guest 血量归零卡死/双端不一致。
    if (sv.mp) {
        if (!sv._mpDeadSent) {
            sv._mpDeadSent = true;
            (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'dead', who: sv.mp.role });
        }
        AudioSystem.playDefeat();
        setTimeout(() => exitWasteland(true), 1200);   // 本端也结算退出（与 playMpEvent 'dead' 一致）
        return;
    }
    if (WSearch.isOpen()) WSearch.closeSearch(sv, true);   // 搜索中被杀：关闭界面
    // 2026-08-09 修复"切队友视角位置互换/出门后死亡"：不再在此强制 sv.interior = null。
    // 软核有队友（倒地救治）时保留房间：队友就在室内，切视角后 syncControllerInterior 保持房间，
    // 位置不再被重建打乱；只有软核无队友重生 / 硬核结算才真正离开房间回室外（见下方分支）。
    // ================= 掉落惩罚（软核/硬核通用）=================
    // 死亡次数越多，遗物包裹掉落越丰富越稀有（有上限），玩家身上保留一部分。
    // 2026-08-10 传入倒下者名字：尸体显示该名字（切队友视角倒下的是队友，尸体就是该队友）。
    // 2026-08-11 v2.98 用户反馈"濒临死亡渲染上有尸体效果"：濒死（软核有队友 → 倒地救治）时
    // **不调用 deathDropLegacy**——死亡点不立即生成独立 corpse:N 遗物尸体，避免地上"濒死角色 +
    // 自己的尸体"两个渲染重叠看起来很奇怪。仅在【真正死亡】路径（软核无队友/队友全灭/硬核）才调
    // deathDropLegacy 生成可搜尸体。濒死期间只显示"濒死待救"渲染（红圈+救援倒计时），
    // 不再有躺倒尸体/尸变倒计时。超时死亡/全灭时由 updateDowned 超时分支或 killNpc 生成尸体。
    let drop = null;
    let dropTxt = '';
    const doDeathDrop = () => {
        if (drop) return;
        drop = deathDropLegacy(sv, deadName);
        dropTxt = (drop.vanished.length ? `（${drop.vanished.length} 件物品永久消失）` : '')
            + (drop.kept.length ? `，尸体留在死亡点（靠近搜索 [F]）` : '，死亡位置已标记（屏幕边缘指引）');
    };
    // 存活队友（NPC 队伍成员，含原主角记录以外的 party 成员；排除倒地主角本人记录 isPlayer）
    // 2026-08-09 修复"室内死亡切到室外队友"：优先选与主控同位置（同室内/同室外）的队友，
    // 切视角不会跑到另一个空间去。
    // 2026-08-10 排除濒死（downed）队友：濒死队友不可施救/不可操控，若其余队友全濒死则无法救治 → 全员死亡
    const mates = (sv.npcs || []).filter(n => n.alive && !n.downed && n.party && n.id !== sv.controllerId && !n.isPlayer)
        .sort((a, b) => {
            const aSame = !!a.inInterior === !!sv.interior;
            const bSame = !!b.inInterior === !!sv.interior;
            if (aSame !== bSame) return aSame ? -1 : 1;   // 同位置的优先
            // 同位置时按距离：aSame/bSame 已保证与主控同空间，a.x/a.y 即该空间坐标（与 sv.px/py 对应），
            // 无需再按 sv.interior 分支（此前 `sv.interior ? a.x : a.x` 为恒等死代码，见#10）。
            const ax = a.x, ay = a.y;
            const bx = b.x, by = b.y;
            const da = Math.hypot(ax - sv.px, ay - sv.py);
            const db = Math.hypot(bx - sv.px, by - sv.py);
            return da - db;
        });
    if (dk.soft) {
        // ================= 软核（正常）：倒地救治 =================
        // 有存活队友 → 队友把倒地主角带回重生点（床）→ 切队友视角 → 限时搜药救治；
        // 无存活队友 → 重生（有床用床/无床随机）+ 重生点刷"玩家名"僵尸。
        // v4.30 用户定稿："感染值满了，没有倒地，直接死亡，然后等待3分钟过后尸化"——
        // 感染恶化死因【不进入倒地救治】分支：感染者无法被救助（v4.22 设计"感染致死不能救助"回归），
        // 直接死亡 → 生成遗物尸体（可搜）→ 尸体 3 分钟后尸变（updateCorpseRevive 复用）。
        // 注意：不走 showAllDeadChoices（那是全员阵亡，会把存活队友也置死生尸体）——感染死只死主控一人。
        // v4.34 用户反馈："感染值满了尸变死亡，为什么没有弹出切换角色视角的 UI，直接重生了，
        // 而且重生之后，队伍里面为什么还有队友"——
        // 原实现直接 softRespawn：① 无切视角 UI；② softRespawn 只清已死成员的 party，
        // 存活队友 party 保留 → 重生后队伍还在（本应"独自重生"）。
        // 修复：有存活队友 → 弹「切换队友视角/重生」选择框（与其他软核死亡一致）；
        // 无存活队友 → 重生并显式解散旧队伍（清所有 party 标记）。
        if (deadReason === '感染恶化致死' || (curN && curN._deathReason === '感染恶化致死')) {
            // v4.41 用户定稿："不管是主控还是其他NPC成员，感染值满了死亡，都要尸变后才移出队伍列表"——
            // 与 NPC 成员 killNpc 完全一致的逻辑：主控记录本身转为"待尸变尸体"（_corpse=true + party 保留），
            // 队伍面板显示"尸"徽标；3 分钟（CORPSE_REVIVE_SECONDS）后 updateCorpseRevive 尸变
            // （_revived=true + party=false）才真正移出队伍。不再生成独立 corpse:N 尸体（避免同一死亡点两个尸体重叠）。
            drop = deathDropLegacy(sv, deadName, true);   // skipCorpse=true：掉落计算 + 死亡指引，主控记录即尸体
            dropTxt = (drop.vanished.length ? `（${drop.vanished.length} 件物品永久消失）` : '')
                + (drop.kept.length ? `，尸体留在死亡点（靠近搜索 [F]）` : '，死亡位置已标记（屏幕边缘指引）');
            const _infPcId = (sv.npcs.find(n => n.id === sv.controllerId) || sv.npcs.find(n => n.id === 'player' || n.isPlayer) || {}).id;
            const _markPcCorpse = () => {
                const _pcI = sv.npcs.find(n => n.id === _infPcId);
                if (!_pcI) return;
                _pcI.alive = false; _pcI.downed = false; _pcI.hp = 0; _pcI._revivedCorpse = false;
                // 转"待尸变尸体"（与 killNpc 一致）：_corpse 标记 + 掉落物品进 _corpseContents
                if (!_pcI._corpse) {
                    _pcI._corpse = true;
                    _pcI._corpseDay = sv.day;
                    _pcI._corpseAtReal = sv.now != null ? sv.now : 0;
                    _pcI._corpseContents = (drop.kept || []).map(s => ({ ...s, n: s.n || 1 }));
                    _pcI._corpseSearched = false;
                }
                _pcI.inv = [];   // 背包物品已转进 _corpseContents
                // v4.55 修复"室内感染死亡不可交互"（用户反馈）：
                // 必须保留 inInterior/interiorKey/interiorFloor 三个字段（尸体仍在室内），
                // 否则 _isBodyActCandidate 室内筛选会让尸体不可交互。同时坐标用 sv.px/sv.py
                // 而非 doorX/doorY（doorX 是出门坐标，与室内死亡点不符）。
                if (sv.interior) {
                    _pcI.inInterior = true;
                    _pcI.interiorKey = sv.interior.key;
                    _pcI.interiorFloor = sv.interior.floor || 1;
                    _pcI.x = sv.px; _pcI.y = sv.py;   // 死亡点像素坐标（室内坐标系）
                } else {
                    _pcI.inInterior = false;
                    _pcI.interiorKey = null;
                    _pcI.interiorFloor = null;
                    _pcI.x = sv.px; _pcI.y = sv.py;
                }
            };
            _markPcCorpse();
            if (mates.length >= 1) {
                sv.hp = 1;   // 防重入：主循环 hp<=0 && !dead 会再次 onDeath（下方分支解锁前先归 1）
                // 感染死不走 _downedMembers（无救援）；主控记录已是尸体（_corpse=true, party 保留）
                const infDeathSwitch = () => {
                    const mate = mates[0];
                    WNPC.switchControl(sv, mate.id, true);
                    sv.hurtT = 0;
                    sv.dead = false;   // 解锁主循环：世界继续，队友 AI 正常
                    sv._waitDowned = false;
                    sv._carryDowned = false;
                    sv.interior = null;   // 回室外（尸体在死亡点，3 分钟后尸变）
                    // switchControl 写回会把尸体坐标覆盖成死亡点坐标（可能为室内局部坐标），
                    // 同步回门口世界坐标 + 清室内标记（与 deathDropLegacy 独立尸体一致）
                    const _bp = sv.npcs.find(n => n.id === _infPcId);
                    if (_bp && _bp._corpseWX != null) {
                        _bp.x = _bp._corpseWX; _bp.y = _bp._corpseWY;
                        _bp.inInterior = false; _bp.interiorKey = null; _bp.interiorFloor = null;
                    }
                    log(`${deadName} 感染彻底侵蚀了身体，已死亡……尸体留在原地，3 分钟后将尸变`, '#FF5544');
                    log(`你现在操控 ${mate.name} 继续生存`, '#7fd6ff');
                    saveNow();
                };
                const infDeathRespawn = () => {
                    // 重生 = 旧队伍解散：存活队友也清 party（感染死重生是"独自重生"，
                    // 不像全灭路径队友已死——这里队友还活着，必须显式解散防"重生后还有队友"）
                    for (const n of sv.npcs || []) {
                        if (n && n.party && n.id !== sv.controllerId && !n.isPlayer) n.party = false;
                    }
                    sv._downed = null;
                    sv._downedMembers = [];
                    sv._carryDowned = false;
                    sv._waitDowned = false;
                    sv.interior = null;
                    softRespawn(sv, dropTxt, deadName);
                };
                Panel.showDeathChoices(
                    '<div class="wsl-death-title">你 已 感 染 死 亡</div>' +
                    `<div class="wsl-death-sub">${deadName} 感染彻底侵蚀了身体，无法救治（感染恶化无药可救）<br>${dropTxt}<br>（软核难度 · 队友仍存活）</div>` +
                    '<div class="wsl-death-hint">选择切换队友视角继续生存，或重生（重生将解散旧队伍）。</div>',
                    [
                        { label: '切换队友视角', cls: 'primary', onClick: () => { Panel.hideDeath(); infDeathSwitch(); } },
                        { label: '重生', cls: 'danger', onClick: () => { Panel.hideDeath(); infDeathRespawn(); } },
                    ]);
                return;
            }
            // 无存活队友 → v4.35 弹「重生/返回主菜单」选择框（用户定稿"没有队友就会弹出重生的UI"），
            // 不再直接 softRespawn（无 UI 显得"直接重生"）。重生 = 解散旧队伍（含倒地/尸体队友 party）。
            {
                sv.hp = 1;   // 防重入：主循环 hp<=0 && !dead 会再次 onDeath
                const infAloneRespawn = () => {
                    for (const n of sv.npcs || []) {
                        if (n && n.party && n.id !== sv.controllerId && !n.isPlayer) n.party = false;
                    }
                    sv._downed = null;
                    sv._downedMembers = [];
                    sv._carryDowned = false;
                    sv._waitDowned = false;
                    sv.dead = false;
                    sv.interior = null;   // 离开房间回到室外
                    softRespawn(sv, dropTxt, deadName);   // 软核重生：清感染、15 分钟后死亡点刷"玩家名"僵尸
                };
                Panel.showDeathChoices(
                    '<div class="wsl-death-title">你 已 感 染 死 亡</div>' +
                    `<div class="wsl-death-sub">${deadName} 感染彻底侵蚀了身体，无法救治（感染恶化无药可救）<br>${dropTxt}<br>（软核难度 · 独狼生存，无队友可切换）</div>` +
                    '<div class="wsl-death-hint">选择重生继续，或返回主菜单。</div>',
                    [
                        { label: '重生', cls: 'primary', onClick: () => { Panel.hideDeath(); infAloneRespawn(); } },
                        { label: '返回主菜单', cls: 'danger', onClick: () => { AudioSystem.playDefeat(); Panel.hideDeath(); sv.dead = true; exitWasteland(true); } },
                    ]);
                return;
            }
        }
        if (mates.length >= 1) {
            // ---- 有队友：倒地救治（2026-08-09 用户：倒地瞬间弹选择框）----
            // 主角先进入倒地状态（位置/名字/限时起始/已提交药品），然后弹选择框：
            //   「切换队友视角」→ 立即切到最近存活队友操控；「原地等待」→ 保持当前视角（倒地）
            // 2026-08-12 v2.101 用户定稿：**每个人的救助时间是单独计算的，按自己的濒死次数，不是队伍累计**。
            // 原实现用队伍累计 sv._downedCount——主控 A 倒下 3 次后切到队友 B，B 作为新主控首次倒下
            // 却复用累计次数(3) → 时间从 20 分钟变成 10 分钟（错误）。改为【当前主控角色对象 curN 自己
            // 独立的 _downedCount】：B 作为新主控首次濒死 = B._downedCount=1 → 20 分钟。
            // 每人次数规则不变：第 n 次濒死 → 20 分钟 / 2^(n-1)，最低 60 秒。
            const ctlOwner = (sv.npcs || []).find(n => n.id === sv.controllerId) || (sv.npcs || []).find(n => n.isPlayer);
            if (ctlOwner) {
                ctlOwner._downedCount = (ctlOwner._downedCount || 0) + 1;
                const ctlLimitSec = downedLimitForCount(ctlOwner._downedCount);
                ctlOwner.limitSec = ctlLimitSec;   // 同步记到角色对象（switchControl 2736 检测是否已计数，防双重 +1）
                var limitSec = ctlLimitSec;
            } else {
                // 找不到角色对象（异常兜底）：用主控专属计数（仍非队伍共享）
                sv._ctlDownedCount = (sv._ctlDownedCount || 0) + 1;
                var limitSec = downedLimitForCount(sv._ctlDownedCount);
            }
            sv._downed = {
                name: deadName, px: sv.px, py: sv.py,
                dayDead: sv.day, med: 0, herb: 0,
                deathReason: deadReason,   // 2026-08-11 击败详情（弹窗显示"被什么击败"）
                // 2026-08-11 v2.97 现实时间救援倒计时：sv.now 是现实秒（主循环 dt 累积），
                // 20 分钟内未被救活 → 彻底死亡；被攻击每次伤害额外扣 DOWNED_HIT_PENALTY_SEC 秒。
                downedAtReal: sv.now != null ? sv.now : 0,
                limitSec,   // 2026-08-11 v2.98 本次救援总时长（随濒死次数递减）
                _penaltySec: 0,   // 累计被攻击扣掉的时间（秒），超时判定 = (sv.now - downedAtReal) + _penaltySec >= limitSec
            };
            // 2026-08-11 v2.98 开发者「补刀致死」测试：角色濒死（非彻底死亡），救援时间设为"将尽"
            // （仅剩 3 秒）——切到队友视角后很快超时 → 彻底死亡 + 生尸体，完成"补刀→濒死→超时致死→尸体"链路。
            // 不清 _downedMembers 中主控记录的时间（补刀标记由成员超时管理同样生效），只调整主控倒计时。
            if (sv._devDownedKill) {
                sv._downed.downedAtReal = (sv.now != null ? sv.now : 0) - (B.DOWNED_LIMIT_SECONDS - 3);
                sv._devDownedKill = false;   // 一次性标志，用完即清
            }
            // 2026-08-10 标记"倒下的主控记录"为 downed（而非固定 isPlayer）：切换视角后倒下的
            // 是当前主控队友（controllerId），需标记该记录倒地——否则它仍被当存活队员：
            // 恶意 NPC 继续打它（反复鞭尸/掉遗物）、mates 永远非空（无限切视角不结束）、
            // 救活时找不到真正倒下的记录（被救治队友二次救治异常）。
            const pc = sv.npcs.find(n => n.id === sv.controllerId) || sv.npcs.find(n => n.id === 'player' || n.isPlayer);
            if (pc) { pc.alive = true; pc.downed = true; pc.hp = 1; }
            const enterDownedView = () => {
                const mate = mates[0];
                WNPC.switchControl(sv, mate.id, true);
                sv.hurtT = 0;
                sv.dead = false;   // 解锁主循环：倒地救治期间世界继续运转（队友 AI 背人、玩家操控队友找药）
                // 2026-08-17 v4.18 修复"切队友视角后原主控直接死亡/无法救援"：
                // 旧注释（下方 v2.97 段）声称 switchControl 已把旧主控并入 _downedMembers（2597 行），
                // 但 switchControl 实现从未 push → 旧主控 downed=true 却不在 _downedMembers：
                // ① 无超时管理（可永久"假死"）；② updatePrompt downedMate 分支找不到它 → 队友靠近
                // 无"救治"提示、无法送药救活；③ 恶意NPC补刀判定 hp<=0 && downed → killNpc（配合
                // wnpc.js v4.18 补刀扣时修复，不再瞬间死亡）。补上：切视角后把倒下的旧主控并入
                // _downedMembers（受统一超时管理 + 可被队友送药救活）。
                const _dpc = (sv.npcs || []).find(n => n.downed && n.alive) || (sv.npcs || []).find(n => n.isPlayer);
                if (_dpc) {
                    _dpc.downed = true;
                    _dpc._downedAtReal = sv.now != null ? sv.now : 0;
                    _dpc._penaltySec = 0;
                    _dpc.limitSec = limitSec;   // 按旧主控濒死次数算出的救援时长（onDeath 已算，闭包可取）
                    sv._downedMembers = sv._downedMembers || [];
                    if (!sv._downedMembers.find(m => m.id === _dpc.id)) sv._downedMembers.push(_dpc);
                }
                // 2026-08-11 v2.97 修复"切队友视角后主控濒死状态转移到队友身上"（用户反馈）：
                // switchControl 已把旧主控（濒死）标 downed 并入 _downedMembers（2597 行），由
                // updateDownedMembersTimeout 管理倒计时；但 sv._downed（onDeath 设置的倒地记录）
                // 残留不清理 → updateDowned 每帧仍走"主控倒地"分支 → ① 全灭检测把新主控(controllerId)
                // 和旧主控(isPlayer/downed)都排除 → 队友满血也被误判全灭；② 渲染层 drawPlayer 的
                // drawDownedTimeBar 在【新主控】头顶画救援倒计时（状态"转移"到队友身上）。
                // 清掉后 updateDowned 走 `!dwn → updateDownedMembersTimeout`（只管理成员倒计时）。
                sv._downed = null;
                sv._waitDowned = false;
                sv._carryDowned = false;
                log(`${mate.name} 将濒死的你带回重生点救治……${dropTxt}`, '#7fd6ff');
                log(`操控 ${mate.name} 搜集药品（伤口药/抗生素/草药×3）送到倒地主角旁 F 救治，限 ${Math.round(B.DOWNED_LIMIT_SECONDS / 60)} 分钟内集齐`, '#7fd6ff');
                saveNow();
            };
            const waitInPlace = () => {
                sv.hurtT = 0;
                sv.dead = false;   // 原地等待：视角留在倒地主角（世界运转，队友 AI 会来救助）
                // 2026-08-09 修复"等待救援反复播放死亡音效/字幕"：死亡时 sv.hp 已是 0，
                // 若不归 1，下一帧主循环 `hp<=0 && !dead` 再次触发 onDeath → 又弹选择框/播放音效，无限循环。
                sv.hp = 1;
                sv._waitDowned = true;   // 倒地主角视角：不能移动，等待救援
                log(`你倒在地上等待救援……${dropTxt}`, '#7fd6ff');
                log(`队友会来救助你（清怪后背回床旁/原地送药），限 ${Math.round(B.DOWNED_LIMIT_SECONDS / 60)} 分钟内集齐药品`, '#7fd6ff');
                saveNow();
            };
            // 2026-08-11 v2.98 用户需求：死亡音效只在点击"重生/返回主菜单"时播放——
            // 濒死倒地/切队友视角/原地等待/弹窗瞬间**不播放**死亡音效（角色只是濒死待救，未彻底死亡）。
            Panel.showDeathChoices(
                '<div class="wsl-death-title">你 倒 下 了</div>' +
                // 2026-08-11 v2.98 用户需求：此界面是"濒死倒地待救"（角色只是濒临死亡、未彻底死亡），
                // 不显示角色死亡明细（去掉"被 XX 击败了"），只提示倒地待救与救援剩余时间。
                `<div class="wsl-death-sub">${deadName} 濒临死亡，倒地待救<br>${dropTxt}<br>（软核难度 · 有队友可救助）</div>` +
                `<div class="wsl-death-hint">选择操控队友去搜集药品救你，或原地等待队友前来救助。限 ${Math.round(B.DOWNED_LIMIT_SECONDS / 60)} 分钟内集齐药品。</div>`,
                [
                    { label: '切换队友视角', cls: 'primary', onClick: () => { Panel.hideDeath(); enterDownedView(); } },
                    { label: '原地等待救援', cls: 'danger', onClick: () => { Panel.hideDeath(); waitInPlace(); } },
                ]);
            return;
        }
        // ---- 无可行动队友：分两种情况 ----
        // 2026-08-10 用户需求：若原本有 party 队友但已全部阵亡或濒死（无人能救）→ 全员死亡，游戏结束；
        // 若从一开始就无队友 → 软核重生（独自继续）。
        // 2026-08-10 软核成员倒地：倒地成员（downed）不能行动也不能救主控——主控死亡且无【可行动】队友
        // 时（成员全倒地或全阵亡），视为"全员濒死=无人可救"→ 直接全员彻底死亡 + 生尸体（防切到倒地成员卡死）。
        // 2026-08-11 v2.97 修复"只剩当前主控活着却弹全员阵亡"（用户截图：HP 66/80 活着却弹了全员阵亡）：
    // 队伍只剩 1 个活人（当前主控自己）时，`mates` 会被 controllerId/isPlayer 排除 → 空，
    // `anyAliveMate=false` → `hadMates=true` → 误判全员阵亡。这里把"当前主控自己活着"也视为可行动：
    // 只要 controllerId 对应角色（或者原主角 isPlayer 还有活人）**任意一个活着且没倒地**，
    // `anyAliveMate` 就为 true → 不触发全灭（走独狼重生的友军集合流程）。
    const cur = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);
    const playerAlive = (sv.npcs || []).some(n => n.isPlayer && n.alive && !n.downed);
    const controllerAlive = !!(cur && cur.alive && !cur.downed);
    // 2026-08-12 修复#12：联机 guest 队友存活用 host 权威 hp（_hostHp 优先，回退 hp）判定，
    // 而非「不在室内」——已死亡的 guest 若 inInterior=false 会被误判存活，导致不触发全灭。
    const guestAlive = p => (p._hostHp != null ? p._hostHp : (p.hp || 0)) > 0;
    const anyAliveMate = mates.length >= 1 || controllerAlive || playerAlive
        || (sv.p2 && guestAlive(sv.p2)) || (sv.p2s && Object.values(sv.p2s).some(guestAlive));
        // 2026-08-10 修复"正常模式独狼被杀直接退出"：先判断是否【从头就有过 party 队友】——
        // 软核（正常）模式下，即使原本有队友但已全部阵亡/倒地（无人能救），也应【软核重生】而非
        // 直接结束游戏——重生后成员列表清空（原主角/成员都已死亡，重生的是新主角，孤身继续）。
        // 硬核（一条命）才"全员死亡结算退出"。
        const hadMates = (sv.npcs || []).some(n => n.party && n.id !== sv.controllerId && !n.isPlayer);
        if (hadMates && !anyAliveMate) {
            log(`${deadName} 的队友全部阵亡或濒死，无人能救……`, '#FF5544');
            // 2026-08-11 v2.98 队友全灭 = 真正死亡 → 生成遗物尸体可搜
            doDeathDrop();
            // 2026-08-11 全员濒死/死亡弹窗（共享函数，onDeath 与 updateDowned 全灭检测共用）
            // 2026-08-11 v2.96 加 typeof 兜底：模块未完整加载/被裁剪时降级到软核重生（绝不抛 ReferenceError）。
            if (typeof showAllDeadChoices === 'function') {
                showAllDeadChoices(sv, deadName, deadReason, dropTxt);
            } else {
                _softRespawnAllDeadFallback(sv, deadName, deadReason);
            }
            return;
        }
        // ---- 从头就无队友：重生 + 重生点刷"玩家名"僵尸 ----
        // 2026-08-10 删除残留死代码分支：此前这里引用未定义的 anyDownedMate（ReferenceError，
        // 独狼死亡直接崩溃）。hadMates=false 时成员列表为空、anyDownedMate 恒为 false，
        // 该分支逻辑上不可达；有队友的情况已由上方 hadMates && !anyAliveMate → 软核重生覆盖。
        // 2026-08-11 v2.97 修复"无队友死亡没有重生/返回主菜单选项"（用户反馈）：独狼死亡此前
        // 直接 softRespawn 无弹窗。改为弹「重生/返回主菜单」选择框（复用 showAllDeadChoices）——
        // 点"重生"才 softRespawn 继续，点"返回主菜单"退出到菜单。
        doDeathDrop();   // 2026-08-11 v2.98 独狼/无队友死亡 → 生成遗物尸体可搜
        sv.interior = null;   // 无队友重生：离开房间回到室外
        if (typeof showAllDeadChoices === 'function') {
            showAllDeadChoices(sv, deadName, deadReason, dropTxt);
        } else {
            _softRespawnAllDeadFallback(sv, deadName, deadReason);
        }
    } else {
        // ================= 硬核（一条命）：无救治 =================
        // 掉落道具（上面已做）；尸化留世（保留尸化僵尸）。
        doDeathDrop();   // 2026-08-11 v2.98 硬核死亡 → 生成遗物尸体可搜
        sv.interior = null;   // 硬核结算：离开房间回到室外
        const pz = WZ.spawnPlayerZombie(sv);
        sv._pzId = pz.id;
        log(`☠ ${deadName} 已尸化……${dropTxt}`, '#FF5544');
        AudioSystem.playZombieSpawn && AudioSystem.playZombieSpawn();
        // 有存活队友 → 不自动切换（2026-08-09 用户要求：硬核倒地需手动切换队友视角）。
        // 玩家留在倒地主角视角（不能移动），按 T 键手动切换到最近存活队友，或队友靠近后 F 交互切换。
        if (mates.length >= 1) {
            sv._waitDowned = true;   // 倒地视角：不能移动（等待玩家手动切换）
            sv.dead = false;         // 解锁主循环：世界运转，队友 AI 正常行动
            // 主控名册记录标记倒地（渲染躺倒画面，硬核主角已尸化留世）；
            // 2026-08-10 与软核一致：标记"当前主控记录"（可能是队友），否则队友仍被当存活队员。
            const pc2 = sv.npcs.find(n => n.id === sv.controllerId) || sv.npcs.find(n => n.id === 'player' || n.isPlayer);
            if (pc2) { pc2.downed = true; pc2.hp = 1; }
            // 修复"硬核倒地后 hp=0 卡死/每帧重复 onDeath"：sv.hp 归 1（倒地血），
            // 防止主循环每帧 `hp<=0 && !dead` 重复触发 onDeath（防重入锁+分支解锁=无限循环）
            sv.hp = 1;
            log(`${deadName} 倒地了……按 [T] 切换到 ${mates[0].name} 视角，或队友靠近后 F 交互切换`, '#FF5544');
            log(`（硬核一条命 · 无救治，切换到队友后继续生存）`, '#FF5544');
            // 2026-08-11 v2.98 用户需求：死亡音效只在点击"重生/返回主菜单"时播放——切队友视角不播
            saveNow();
            return;
        }
        // 无存活队友 → 游戏结束（2026-08-09 用户要求：弹"游戏结束"UI + 返回主菜单按钮，
        // 不再直接退出/卡顿/原地生成）。主角尸化留世（spawnPlayerZombie 已做），删档（不可重进）。
        const seed = sv.world.seed;
        const charName = sv.characterName;
        // 2026-08-12 修复硬核删档硬编码（#13）：复用 charKey/worldKey/PROFILE_KEY 统一键名
        // + removeStorage 统一命名空间删除，不再硬编码 `u:<user>:` 前缀（与 storage 层解耦）。
        if (seed != null) removeStorage(worldKey(seed));
        if (charName) removeStorage(charKey(charName));
        removeStorage(PROFILE_KEY);
        // 弹"游戏结束"界面（复用死亡弹窗），点按钮才返回主菜单（避免直接退出的卡顿/原地重生感）
        Panel.showDeathChoices(
            '<div class="wsl-death-title">游 戏 结 束</div>' +
            `<div class="wsl-death-sub">${deadName} 倒下了……<br>一条命的旅程到此为止。<br>（${dk.name}难度 · 无存活队友）</div>` +
            '<div class="wsl-death-hint">角色与世界存档已清除，无法重新进入。</div>',
            [
                {
                    label: '返回主菜单',
                    cls: 'primary',
                    onClick: () => {
                        // 2026-08-11 v2.98 用户需求：死亡音效只在点击"重生/返回主菜单"时播放
                        AudioSystem.playDefeat();
                        Panel.hideDeath();
                        sv.dead = true;
                        exitWasteland(true);
                    },
                },
            ]);
    }
}

// v4.26 倒地救治/状态机已拆到 wdowned.js（downedMedSubmit / updateDowned / updateDownedMembersTimeout / rescue UI 全家）

// ============ 2026-08-11 尸体搜索（用户定稿：复用容器 WSearch 界面，无独立读条） ============
// 尸体搜索已改为 WSearch.openSearch 容器界面（逐件渐亮 + 面板 UI），onClose 更新尸体剩余并
// 标记搜索完成。此前的 _corpseSearch 读条机制（updateCorpseSearch）已移除，无独立进度条。

// 主控倒地救治状态机（2026-08-09）：
//   ① 超时 2 天彻底死亡（可被队友送药救活；床旁延长）
//   ② 倒地期间被僵尸/敌对 NPC 攻击 → 补刀彻底死亡（用户认可"濒死后被打一下彻底死亡"）
//   ③ 倒地主角跟随：切视角后玩家操控队友，倒地主角留在原地
// 药品提交在 doInteract（F 键）完成，集齐后清 _downed 救活。

// 2026-08-11 全员阵亡弹窗（用户需求）：收集每个人击败详情 + 「重生」/「返回主菜单」两个按钮。
// onDeath 的"有队友但全灭"分支与 updateDowned 的"倒地主控+队友全灭"检测共用。
// 点「重生」才真正清空成员并 softRespawn（软核重生继续，非最终结束界面）。
// 2026-08-11 修复（v2.96）：改为 const 箭头函数 + export，杜绝 ESM 中 function 声明在某些块作用域遮蔽下
// 抛出 `ReferenceError: showAllDeadChoices is not defined`（用户在全员濒死场景下浏览器报错，循环僵死）。
// 在 updateDowned / onDeath 调用点也加了 `typeof` 兜底（双保险）。
// 2026-08-11 v2.97 补丁（用户反馈"全灭时还能看到角色头顶 20:00 救援时间"）：
// 弹窗弹出前先**全员彻底死亡**——清倒计时+置 downed=false/alive=false+生尸体可搜遗物，
// 避免弹窗期间世界渲染仍把倒地角色画成"还能救 20 分钟"的悬空态（全灭 = 直接死，不该走救援倒计时）。
export const showAllDeadChoices = (sv, deadName, deadReason, dropTxt) => {
    // ① 全员彻底死亡（弹窗前先收尾：倒地成员和存活主控都置死，生尸体）
    for (const n of sv.npcs || []) {
        if (!n) continue;
        if (n.downed || (n.alive === false && n.downed)) {
            n.downed = false; n.alive = false; n.hp = 0;
            n._deathReason = n._deathReason || '救援超时（全员阵亡）';
            if (!n._corpse) {
                n._corpse = true;
                n._corpseDay = sv.day;
                // 2026-08-11 v2.98 尸体尸变系统：记录尸体生成现实时刻
                n._corpseAtReal = sv.now != null ? sv.now : 0;
                n._corpseContents = [];
                for (const s of n.inv || []) { if (s) n._corpseContents.push({ ...s, n: s.n || 1 }); }
                n._corpseSearched = false;
            }
        } else if (n.id === sv.controllerId || n.isPlayer) {
            // 最后一个倒下的主控（isPlayer 记录）：置死
            n.alive = false; n.hp = 0;
            n._deathReason = n._deathReason || deadReason || '战斗中被击败';
            if (!n._corpse) {
                n._corpse = true;
                n._corpseDay = sv.day;
                // 2026-08-11 v2.98 尸体尸变系统：记录尸体生成现实时刻
                n._corpseAtReal = sv.now != null ? sv.now : 0;
                n._corpseContents = [];
                for (const s of n.inv || []) { if (s) n._corpseContents.push({ ...s, n: s.n || 1 }); }
                n._corpseSearched = false;
            }
        }
    }
    // 清 _downed（倒地主控记录）、_downedMembers（倒地成员列表）
    sv._downed = null;
    sv._downedMembers = [];
    sv._carryDowned = false;
    sv._carryMateId = null;   // 2026-08-11 v2.97 界面一致：全灭/重生时清队友背起状态
    sv._waitDowned = false;
    // 收集击败详情（用户定稿 v2.99）：游戏结束/全员阵亡时，显示【队伍里每个角色】的死亡原因
    // ——"某某某 被什么什么击杀了"，主控 + 全部 party 成员各一条。
    // 实时更新保证：
    //   ① 主控死因直接用本次调用传入的 deadName/deadReason（onDeath 每帧按最新状态推断、
    //      updateDowned 用 _downed.deathReason），不读残留字段 → 每次死亡明细都是当前原因；
    //   ② 成员救活/重生时已清 _deathReason（mateMedSubmit/downedMedSubmit/softRespawn）→
    //      再死重新按攻击来源记录，不会复用旧死因（"被僵尸咬死"残留 bug 已修复）。
    // 历史尸体排除：softRespawn 重生时已把旧 party 尸体的 party 标记清除 → 本弹窗只收当前队伍。
    const thisReason = deadReason || '战斗中被击败';
    const deathDetails = [];
    const seenNames = new Set();
    const pushDeath = (nm, reason) => {
        nm = nm || '幸存者';
        if (seenNames.has(nm)) return;
        seenNames.add(nm);
        deathDetails.push({ name: nm, reason: reason || thisReason });
    };
    // ① 主控/当前主控（本次死亡主控）——用调用方传入的实时原因
    pushDeath(deadName || sv.characterName, thisReason);
    // ② 全部 party 成员（活着的/倒地的/已死的尸体都收——用户要求"队伍里有几个角色就写几条死因"）
    for (const m of sv.npcs || []) {
        if (!m || !m.party) continue;
        if (m._revivedCorpse) continue;          // 尸变尸体不是队伍角色
        if (m.alive && !m.downed) continue;       // 存活成员无死因（防御：全灭弹窗不应出现存活者）
        // 2026-08-17 v4.23 用户定稿："不应该写'救援超时'，应该计算的是倒地之前是被什么击倒的"——
        // m._deathReason 在 killNpc/npcDowned 时记录了"被什么击杀/击倒"（含僵尸名/武器/植物等）。
        // 救援超时（_deathReason='救援时间耗尽致死'）时，回退用 m._killedByReason（npcDowned 写入的击倒原因 _cause）
        const _mReason = m._deathReason;
        const _isTimeout = _mReason === '救援时间耗尽致死' || /救援超时/.test(_mReason || '');
        const _mFinal = _isTimeout ? (m._killedByReason || m._cause || _mReason || thisReason) : (_mReason || thisReason);
        pushDeath(m.name || m.id, _mFinal);
    }
    // ③ 倒地主控记录（sv._downed 可能尚未同步进 npcs，如主控倒地全灭分支）
    if (sv._downed && sv._downed.name) pushDeath(sv._downed.name, (sv._downed.deathReason || thisReason));
    const uniq = deathDetails;
    // 2026-08-11 v2.98 击杀明细更详细（用户要求："被 XXX 用 XXX 击杀"/"被僵尸啃咬致死"等完整描述）：
    // _deathReason 已是自然语言描述（含"被..."开头），直接渲染即可，不再拼接"被 X 击败"前缀防重复。
    const detailHtml = uniq.length
        ? uniq.map(d => `<div class="wsl-death-detail">☠ ${d.name} · ${d.reason}</div>`).join('')
        : `<div class="wsl-death-detail">☠ ${deadName || sv.characterName || '幸存者'} · ${thisReason}</div>`;
    // 原 party 成员全部阵亡（清空成员列表）：重生主角不是原来的主角，原成员不再入队。
    // 2026-08-10 死亡成员留尸体遗物（killNpc 标记 _corpse，含成员背包全部物品，靠近 F 搜索）；
    // 主控本人记录（isPlayer）的重生遗物已在 onDeath 的 deathDropLegacy 生成（主角尸体）。
    // 2026-08-10 修复：原循环只 killNpc 存活队友，未处理 isPlayer 记录—— 旧主控的
    // alive/downed/hp 状态残留到 softRespawn 之后，导致新主控角色信息继承旧主控
    // （满血却带"濒临死亡"红圈，原主控复活）。显式把旧主控记录设成已死，softRespawn
    // 末尾会检测并 create new survivor。
    const doRespawn = () => {
        for (const n of sv.npcs || []) {
            if (n && n.party && n.id !== sv.controllerId && n.alive) { WNPC.killNpc(sv, n, '战斗中被击败'); }
            else if (n && n.isPlayer) { n.alive = false; n.downed = false; n.hp = 0; }
        }
        sv._downed = null;
        sv._downedMembers = [];
        sv._carryDowned = false;
        sv._waitDowned = false;
        sv.dead = false;
        sv.interior = null;   // 重生：离开房间回到室外
        softRespawn(sv, dropTxt || '', deadName);
    };
    // 2026-08-11 v2.97 独狼死亡：标题改为"你阵亡了"（无队友可显示；有队友才说"全员阵亡"）
    // 弹窗标题判定只看【当前还活着的 party 队友】（排除历史尸体 alive=false）：hadAnyMate=true 仅当
    // 当前还有活着 party NPC 队友——独狼复活后再死（历史尸体仍在 sv.npcs 但都已 alive=false）→ false，
    // 显示"你阵亡了"独狼标题而非"全员阵亡"（用户反馈"一个人生不该显示全员阵亡"）。
    const hadAnyMate = (sv.npcs || []).some(n => n && n.alive && n.party && !n.isPlayer);
    // v3.64 用户规则：硬核模式 + 队伍全员阵亡 → 游戏结束（只有返回主菜单，无重生按钮）；
    // 硬核单人 / 软核任何情况 → 维持原"重生 + 返回主菜单"两按钮。
    const isHardcoreAllDead = (sv.diffKey === 'hardcore') && hadAnyMate;
    const titleText = hadAnyMate ? '全员阵亡' : '你 阵 亡 了';
    const subText = hadAnyMate ? '队伍已无人幸存……' : '你独自一人倒在了荒原上……';
    const hintText = isHardcoreAllDead
        ? `硬核模式：旅程结束，角色与世界存档已清除，无法重新进入。`
        : `软核模式：你可以重生继续，或返回主菜单。`;
    const buttons = isHardcoreAllDead
        ? [
            // v3.64 硬核全员阵亡：只显示"返回主菜单"按钮，无重生选项（与游戏结束硬核分支一致）
            { label: '返回主菜单', cls: 'danger', onClick: () => { AudioSystem.playDefeat(); Panel.hideDeath(); sv.dead = true; exitWasteland(true); } },
        ]
        : [
            // 2026-08-11 v2.98 用户需求：死亡音效只在点击"重生/返回主菜单"时播放——
            // 重生按钮走 doRespawn → softRespawn 结尾播放（3437 行）；返回主菜单此处补播。
            { label: '重生', cls: 'primary', onClick: () => { Panel.hideDeath(); doRespawn(); } },
            { label: '返回主菜单', cls: 'danger', onClick: () => { AudioSystem.playDefeat(); Panel.hideDeath(); sv.dead = true; exitWasteland(true); } },
        ];
    Panel.showDeathChoices(
        `<div class="wsl-death-title">${titleText}</div>` +
        `<div class="wsl-death-sub">${subText}</div>` +
        `<div class="wsl-death-details">${detailHtml}</div>` +
        `<div class="wsl-death-hint">${hintText}</div>`,
        buttons);
};
// 2026-08-11 兜底：当 showAllDeadChoices 不可用时（极端情况：模块未完整加载/被裁剪），
// 走降级方案：直接软核重生，避免 ReferenceError 把游戏卡死。
function _softRespawnAllDeadFallback(sv, deadName, reason) {
    if (sv && sv.npcs) {
        for (const n of sv.npcs) {
            if (n && n.party && n.id !== sv.controllerId && n.alive) { try { WNPC.killNpc(sv, n, '战斗中被击败'); } catch(_){} }
            else if (n && n.isPlayer) { n.alive = false; n.downed = false; n.hp = 0; }
        }
    }
    if (sv) {
        sv._downed = null;
        sv._downedMembers = [];
        sv._carryDowned = false;
        sv._waitDowned = false;
        sv.dead = false;
        sv.interior = null;
    }
    try { softRespawn(sv, '', deadName || '幸存者'); } catch(_) {}
    log(`（降级）${deadName || '幸存者'} 的队伍已无人幸存，直接重生继续……`, '#FF8800');
}
// v4.26 downedLimitForCount / updateDowned 已拆到 wdowned.js
function useHotbar(i) {
    if (!sv || sv.build) return;
    const id = sv.hotbar[i];
    if (!id) { log(`快捷栏 ${i + 1} 为空（背包中按 ${i + 1} 绑定物品）`); return; }
    if (id.startsWith('wpn:')) {
        const w = WEAPONS[id.slice(4)];
        if (!w) return;
        const slot = w.kind === 'melee' ? 'melee' : 'ranged';
        let found = null;
        for (const s of sv.inv) if (s && s.id === id) { found = s; break; }
        if (!found) { log(`${Panel.getItemInfo(id).name} 已不在背包中`); sv.hotbar[i] = null; return; }
        if (found.eq === slot) { delete found.eq; log(`卸下 ${w.name}`); }
        else {
            for (const o of sv.inv) if (o && o.eq === slot) delete o.eq;
            found.eq = slot;
            log(`装备 ${w.name}`);
        }
        AudioSystem.playClick();
        Panel.refresh(sv);
    } else {
        const it = Panel.getItemInfo(id);
        if (id.startsWith('loot:')) {
            let found = -1;
            for (let j = 0; j < sv.inv.length; j++) if (sv.inv[j] && sv.inv[j].id === id) { found = j; break; }
            if (found < 0) { log(`${it.name} 已不在背包中`); sv.hotbar[i] = null; return; }
            openLootFromBag(found);
        } else if (it.heal || it.satiate || it.drink) {
            let found = -1;
            for (let j = 0; j < sv.inv.length; j++) if (sv.inv[j] && sv.inv[j].id === id) { found = j; break; }
            if (found < 0) { log(`${it.name} 已不在背包中`); sv.hotbar[i] = null; return; }
            useItem(found);
        } else {
            log(`${it.name}：${it.desc || '无法快捷使用'}`);
        }
    }
}

// ================= 背包使用 =================
function useItem(i) {
    if (!sv) return;
    const s = sv.inv[i];
    if (!s) return;
    // 战利品袋：点击打开搜索出货（剩余回收回袋子）
    if (s.id.startsWith('loot:') || s.id.startsWith('looted:')) { openLootFromBag(i); return; }
    // 领地旗帜：使用后进入"待放置"状态（预览在脚下），按 G 放置建立领地；
    // 位置不理想可旗帜处 F 收起回背包再重放（2026-08-10 用户要求）
    if (s.id === 'flag') {
        if (sv.camp) { log('已有领地旗帜（旗帜处 F 可收起）', '#FFB347'); return; }
        if (sv._flagPlace) { log('已在待放置状态，按 G 放置 / ESC 取消', '#FFB347'); return; }
        sv._flagPlace = { active: true };
        log('领地旗帜待放置：移动到目标位置后按 G 插旗（ESC 取消）', '#FFD700');
        AudioSystem.playClick();
        Panel.refresh(sv);
        return;
    }
    // 损坏武器：扳手 + 零件×2 修复（背包里使用损坏武器）
    if (s.id.startsWith('wpn:') && s.broken) {
        if (!repairWeapon(sv, s)) log(`修复需要 扳手 + 零件×${B.WEAPON_REPAIR_PARTS}`, '#FFB347');
        return;
    }
    // 2026-08-12 v3.8 配方：使用解锁到拼字台（v3.22 消耗 1 张，不自动跳转）
    if (s.id.startsWith('recipe:')) {
        useRecipe(s);
        return;
    }
    // 2026-08-12 v3.10 文字手术刀：左键使用打开拆字台（净化/拆解）
    if (s.id === 'tool:surgery') {
        if (s.broken) {
            if (!repairWeapon(sv, s)) log(`手术刀损坏了，修复需要 扳手 + 零件×${B.SURGERY_REPAIR_PARTS}`, '#FFB347');
            return;
        }
        Panel.refresh(sv);
        WW.openSurgery(sv, { onMessage: log, onCorrupt: onSurgeryCorrupt, consumeSurgery });
        return;
    }
    // 药品：治疗主控的对应疾病（抗生素可治任意）
    if (s.id.startsWith('med:')) {
        const cur = WNPC.controlledNpc(sv);
        if (!cur || !cur.sick) { log(`${it.name}：当前没有疾病需要治疗`, '#FFB347'); return; }
        const cures = s.id === 'med:pan' || B.SICK_MED[cur.sick.type] === s.id;
        if (!cures) { log(`这药治不了${B.SICKNESS[cur.sick.type].name}`, '#FFB347'); return; }
        cur.sick = null;
        s.n--;
        if (s.n <= 0) sv.inv[i] = null;
        log(`服用 ${it.name}，${B.SICKNESS[cur.sick.type].name}痊愈了`, '#7DFF7D');
        AudioSystem.playCollect();
        Panel.refresh(sv);
        return;
    }
    const it = Panel.getItemInfo(s.id);
    const heal = it.heal || 0, sat = it.satiate || 0, drink = it.drink || 0;
    if (!heal && !sat && !drink) return;
    if (sv.hp >= sv.maxHp && (sv.food || 0) >= B.HUNGER_MAX && (sv.water || 0) >= B.WATER_MAX) { log('生命、饱食与水分均已满'); return; }
    const msgs = [];
    if (heal) {
        // 草药师天赋：草药效果翻倍
        const mul = (it.id === 'herb' && WNPC.controlledNpc(sv) && WNPC.controlledNpc(sv).talent === 'herbalist') ? 2 : 1;
        sv.hp = Math.min(sv.maxHp, sv.hp + heal * mul);
        msgs.push(`生命 +${heal * mul}`);
    }
    if (sat) { sv.food = Math.min(B.HUNGER_MAX, (sv.food || 0) + sat); msgs.push(`饱食 +${sat}`); }
    if (drink) { sv.water = Math.min(B.WATER_MAX, (sv.water || 0) + drink); msgs.push(`水分 +${drink}`); }
    s.n--;
    if (s.n <= 0) sv.inv[i] = null;
    if (sv.food > 0) sv._starved = false;
    log(`使用 ${it.name}，${msgs.join(' ')}`);
    AudioSystem.playCollect();
    Panel.refresh(sv);
}

// ================= 配方使用（2026-08-12 v3.8 解锁拼字台；v3.22 用户定稿：消耗 1 张 + 不跳转只提示） =================
// 配方 = 一次性知识卡：使用后【消耗 1 张】并解锁到 sv.mods.recipes（存档持久化）。
// 使用【不会】自动打开拼字台，只弹提示；按 K 打开拼字台查看已解锁配方，
// 在配方列表点击配方（材料充足）即可快捷组装。
// 解锁后拼字台显示该配方，字符颜色标出背包有无（有=白 / 缺=红）。
function useRecipe(s) {
    const r = WW.recipeByItemId(s.id);
    if (!r) { log('这是一张无法识别的配方', '#FFB347'); return; }
    if (!sv.mods.recipes) sv.mods.recipes = [];
    const learned = sv.mods.recipes.includes(r.id);
    if (!learned) {
        sv.mods.recipes.push(r.id);
        // 联机：配方解锁同步（host 权威 → outbox 事件）
        if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'recipe', id: r.id });
    }
    // 消耗配方物品 1 张（已学习再使用同样消耗）
    const idx = sv.inv.findIndex(x => x === s);
    if (idx >= 0) {
        s.n--;
        if (s.n <= 0) sv.inv[idx] = null;
    }
    log(learned
        ? `「${r.name}」配方已学习过，消耗 1 张（按 K 打开拼字台查看）`
        : `已学习配方「${r.name}」：${r.glyphs.join('')}。按 K 打开拼字台即可拼字`, learned ? '#8ad9ff' : '#C88AFF');
    AudioSystem.playCollect();
    Panel.refresh(sv);
}
// ============ 2026-08-12 v3.10 文字手术刀（拆字台） ============
// 消耗手术刀 1 点耐久；损坏后不可用（用扳手+零件修复）；不足返回 false 并提示
function consumeSurgery() {
    const i = sv.inv.findIndex(x => x && x.id === 'tool:surgery');
    if (i < 0) { log('需要背包里有文字手术刀（搜索容器掉落）', '#FFB347'); return false; }
    const s = sv.inv[i];
    if (s.broken) { log('手术刀已损坏，请用扳手 + 零件修复', '#FFB347'); return false; }
    s.dur = (s.dur == null ? B.SURGERY_DUR : s.dur) - 1;
    if (s.dur <= 0) {
        s.dur = 0; s.broken = true;
        log('手术刀损坏了！可用 扳手 + 零件 修复', '#FFB347');
        Panel.refresh(sv);
    }
    return true;
}
// 拆字拆坏 → 生成错乱尸（复用琢磨拼字的错乱尸生成，室内/室外通用）
function onSurgeryCorrupt(stats, word) {
    if (!sv || sv.dead) return;
    const ang = Math.random() * Math.PI * 2;
    const d = TS * (1.2 + Math.random() * 1.2);
    const x = sv.px + Math.cos(ang) * d;
    const y = sv.py + Math.sin(ang) * d;
    const z = WZ.spawnCorruptedZombie(sv, x, y, stats);
    if (!z) return;
    AudioSystem.playZombieSpawn();
    if (sv.mp && !sv.interior) (sv.mpOutbox = sv.mpOutbox || []).push({
        type: 'corruptz', id: z.id, x: z.x, y: z.y, name: z.name, chars: stats.chars,
        hp: z.maxHp, speed: z.speed, damage: z.damage, armor: z.armor || 0,
        ability: z.textAbility || null, abilityChar: z.corruptAbilityChar || null,
        descs: z.corruptDescs || [],
    });
}
// 2026-08-12 v3.9 琢磨拼字拼错 → 生成错乱僵尸（在拼字台旁 = 玩家附近；室内/室外通用；联机广播）
function onPonderCorrupt(stats, word) {
    if (!sv || sv.dead) return;
    // 生成位置：玩家周围 1~2 格（避开不可走格由 spawnCorruptedZombie 内部安全化）
    const ang = Math.random() * Math.PI * 2;
    const d = TS * (1.2 + Math.random() * 1.2);
    const x = sv.px + Math.cos(ang) * d;
    const y = sv.py + Math.sin(ang) * d;
    const z = WZ.spawnCorruptedZombie(sv, x, y, stats);
    if (!z) return;
    log(`「${word}」文字错乱！生成了 ${stats.name}`, '#ff8888');
    AudioSystem.playZombieSpawn();
    // 联机：广播错乱僵尸（guest 端 wsync 快照带僵尸数组自动同步；室内各自独立）
    if (sv.mp && !sv.interior) (sv.mpOutbox = sv.mpOutbox || []).push({
        type: 'corruptz', id: z.id, x: z.x, y: z.y, name: z.name, chars: stats.chars,
        hp: z.maxHp, speed: z.speed, damage: z.damage, armor: z.armor || 0,
        ability: z.textAbility || null, abilityChar: z.corruptAbilityChar || null,
        descs: z.corruptDescs || [],
    });
}
function repairWeapon(sv, s) {
    // 2026-08-12 v3.10 文字手术刀也可修复（扳手+零件，耐久回满；复用武器修复流程）
    if (!s || !s.broken) return false;
    const isTool = String(s.id).startsWith('tool:');
    if (!String(s.id).startsWith('wpn:') && !isTool) return false;
    if (!hasTool('tool:wrench')) return false;
    const needParts = isTool ? B.SURGERY_REPAIR_PARTS : B.WEAPON_REPAIR_PARTS;
    let partsN = 0;
    for (const x of sv.inv) if (x && x.id === 'part') partsN += x.n;
    if (partsN < needParts) return false;
    let left = needParts;
    for (let k = 0; k < sv.inv.length && left > 0; k++) {
        if (sv.inv[k] && sv.inv[k].id === 'part') {
            const t = Math.min(sv.inv[k].n, left);
            sv.inv[k].n -= t; left -= t;
            if (sv.inv[k].n <= 0) sv.inv[k] = null;
        }
    }
    s.broken = false;
    if (isTool) {
        s.dur = B.SURGERY_DUR;
    } else {
        s.dur = B.WEAPON_DUR[s.id.slice(4)] || 0;
    }
    log(`${Panel.getItemInfo(s.id).name} 修复完成（耐久回满）`, '#7DFF7D');
    AudioSystem.playCollect();
    Panel.refresh(sv);
    return true;
}

// 武器损坏弹窗：即时弹出"修复 / 稍后"
let wrepairEl = null;
function showWeaponRepairPopup() {
    const p = sv._brokenWpnPrompt;
    if (!p) return;
    const idx = sv.inv.findIndex(x => x && x.broken && x.id === p.id);
    if (idx < 0) { sv._brokenWpnPrompt = null; return; }
    const s = sv.inv[idx];
    if (!wrepairEl) {
        wrepairEl = document.createElement('div');
        wrepairEl.id = 'wsl-wrepair';
        wrepairEl.style.cssText = 'position:absolute;inset:0;z-index:910;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        document.getElementById('game-container').appendChild(wrepairEl);
    }
    let partsN = 0;
    for (const x of sv.inv) if (x && x.id === 'part') partsN += x.n;
    const ok = hasTool('tool:wrench') && partsN >= B.WEAPON_REPAIR_PARTS;
    const info = Panel.getItemInfo(s.id);
    wrepairEl.style.display = 'flex';
    wrepairEl.innerHTML = '<div style="background:#1a1014;border:2px solid #FF5544;border-radius:10px;padding:20px 28px;width:380px;text-align:center;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：所有弹窗都有叉号关闭按钮（右上角；点击关闭，不强制修复）
        '<button id="wsl-wrepair-close" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;padding:2px;" title="稍后修复">✕</button>' +
        `<div style="font-size:19px;color:#FF5544;letter-spacing:3px;margin-bottom:6px;">⚒ ${info.name} 损坏了！</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-bottom:14px;">耐久归零，无法使用；可用扳手 + 零件×${B.WEAPON_REPAIR_PARTS} 修复</div>` +
        `<div style="display:flex;gap:10px;justify-content:center;">` +
        `<button id="wsl-wrepair-ok" style="background:#1d5c3f;border:1px solid #39d98a;color:#bff5d8;padding:9px 22px;border-radius:6px;cursor:pointer;font-size:14px;${ok ? '' : 'opacity:0.5;'}" ${ok ? '' : 'disabled'}>修复（扳手+零件×${B.WEAPON_REPAIR_PARTS}）</button>` +
        `<button id="wsl-wrepair-later" style="background:#232c34;border:1px solid #4a5a66;color:#ccd;padding:9px 22px;border-radius:6px;cursor:pointer;font-size:14px;">稍后（B 打开背包可修）</button>` +
        '</div></div>';
    wrepairEl.querySelector('#wsl-wrepair-ok').addEventListener('click', () => {
        if (repairWeapon(sv, s)) {
            sv._brokenWpnPrompt = null;
            wrepairEl.style.display = 'none';
        } else {
            log(`修复需要 扳手 + 零件×${B.WEAPON_REPAIR_PARTS}`, '#FFB347');
            sv._brokenWpnPrompt = null;
            wrepairEl.style.display = 'none';
        }
    });
    wrepairEl.querySelector('#wsl-wrepair-later').addEventListener('click', () => {
        sv._brokenWpnPrompt = null;
        wrepairEl.style.display = 'none';
    });
    // 2026-08-11 v2.99 右上角叉号：同"稍后"，关闭弹窗不强制修复
    const wrc = wrepairEl.querySelector('#wsl-wrepair-close');
    if (wrc) wrc.addEventListener('click', () => {
        sv._brokenWpnPrompt = null;
        wrepairEl.style.display = 'none';
    });
}
function wrepairOpen() { return !!(wrepairEl && wrepairEl.style.display !== 'none' && sv._brokenWpnPrompt); }

// v4.26 战利品袋打开前的背包空格检查（拆 wloot 时定义意外丢失，导致 batchOpenLoot/openLootFromBag
// 调用 checkLootSpace 抛 ReferenceError——恢复定义）。返回背包是否至少有 need 个空位。
function checkLootSpace(need) {
    if (!sv || !Array.isArray(sv.inv)) return false;
    let empty = 0;
    for (const s of sv.inv) if (!s) empty++;
    return empty >= (need || 1);
}

// ================= 战利品袋批量打开（右键）—— 未开袋全部内容一次性打开搜索 =================
function batchOpenLoot(i) {
    const item = sv.inv[i];
    if (!item || !item.id.startsWith('loot:')) return;
    let contents = [];
    if (item.bags && item.bags.length) {
        contents = item.bags.flat().map(it => ({ id: it.id, n: it.n }));
    } else {
        contents = (item.contents || []).map(it => ({ id: it.id, n: it.n }));
    }
    if (!contents.length) return;
    // 2026-08-10 批量打开（右键）按实际物品格数预留空间：每袋 1-4 格，N 袋上限 = 袋数×4；
    // 但实际打开后是逐个搜索，关闭时剩余物会回收。按实际内容格数预留，不足则提示。
    if (!checkLootSpace(Math.min(contents.length, 4))) return;   // 至少预留 4 格（单袋上限）
    const quality = item.id.slice(5);
    const name = Panel.getItemInfo(item.id).name;
    const total = item.n;
    sv.inv[i] = null;
    Panel.refresh(sv);
    AudioSystem.playOpenBox();
    WSearch.openSearch(sv, {
        items: contents,
        name: name + ' (全部x' + total + ')',
        cap: contents.length,
        onClose: (remaining) => {
            // 2026-08-10 修复"战利品袋剩余物消失"：剩余物装不进背包（背包满）时掉到玩家脚下，
            // 不静默丢弃（此前 addItemLoot 返回值被忽略 → 装不下直接消失）。
            if (remaining && remaining.length) {
                const ok = Panel.addItemLoot(sv, { id: 'looted:' + quality, n: 1, contents: remaining.slice() });
                if (!ok) {
                    addDrop(sv.px, sv.py, 'looted:' + quality, 1);
                    // 掉落袋保存剩余内容（addDrop 只存 id/n；contents 需手动补回）
                    const d = sv.drops[sv.drops.length - 1];
                    if (d) d.contents = remaining.slice();
                    log('背包已满，战利品剩余物掉落在脚下', '#FFB347');
                }
            }
        },
    }, { onUseItem: (idx) => useItem(idx) });
}
// 背包丢弃（整堆丢地上）
function dropItem(i) {
    if (!sv) return;
    const s = sv.inv[i];
    if (!s) return;
    const info = Panel.getItemInfo(s.id);
    const a = Math.random() * Math.PI * 2, d = (0.5 + Math.random()) * TS;
    sv.drops.push({ x: sv.px + Math.cos(a) * d, y: sv.py + Math.sin(a) * d, id: s.id, n: s.n });
    // 联机 guest：丢包上报 host（host 权威 drops，wsync 下发后双端一致）
    if (sv.mp && sv.mp.role === 'guest') {
        const dd = sv.drops[sv.drops.length - 1];
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'drop', x: dd.x, y: dd.y, id: dd.id, n: dd.n });
    }
    delete s.eq;
    sv.inv[i] = null;
    log(`丢弃 ${info.name} ×${s.n}`);
    AudioSystem.playPlantDig();
    Panel.refresh(sv);
}

// 储物柜内物品丢弃（整堆丢地上）
function dropChestItem(i) {
    if (!sv || !sv.chestKey) return;
    const chest = sv.mods.chests[sv.chestKey];
    if (!chest) return;
    const s = chest[i];
    if (!s) return;
    const info = Panel.getItemInfo(s.id);
    const a = Math.random() * Math.PI * 2, d = (0.5 + Math.random()) * TS;
    sv.drops.push({ x: sv.px + Math.cos(a) * d, y: sv.py + Math.sin(a) * d, id: s.id, n: s.n });
    if (sv.mp && sv.mp.role === 'guest') {
        const dd = sv.drops[sv.drops.length - 1];
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'drop', x: dd.x, y: dd.y, id: dd.id, n: dd.n });
    }
    chest[i] = null;
    log(`丢弃 ${info.name} ×${s.n}`);
    AudioSystem.playPlantDig();
    Panel.refresh(sv);
}

// ================= 汽车交互菜单 =================
function openLootFromBag(i) {
    const item = sv.inv[i];
    if (!item) return;
    if (!checkLootSpace(4)) return;   // 预留 4 格：战利品单袋最多出 4 格物品
    const isLooted = item.id.startsWith('looted:');
    const quality = isLooted ? item.id.slice(7) : item.id.slice(5);

    let contents;
    if (isLooted) {
        // 已搜袋：取其剩余内容，移除该袋（关闭时若有剩余再存回）
        contents = (item.contents || []).map(it => ({ ...it, n: it.n }));   // 保留完整对象（含品级 grade）
        sv.inv[i] = null;
    } else {
        // 未开袋：只开一个（从 bags 取一袋，n--）
        if (item.bags && item.bags.length) {
            contents = (item.bags.shift() || []).map(it => ({ ...it, n: it.n }));   // 保留完整对象（含品级 grade）
        } else {
            contents = (item.contents || []).map(it => ({ ...it, n: it.n }));   // 保留完整对象（含品级 grade）
        }
        item.n -= 1;
        if (item.n <= 0) sv.inv[i] = null;
        else if (item.bags && item.bags.length) item.contents = item.bags[0];
    }
    Panel.refresh(sv);
    AudioSystem.playOpenBox();
    WSearch.openSearch(sv, {
        items: contents,
        name: Panel.getItemInfo(item.id).name,
        immediate: isLooted,   // 已搜袋(looted:)直接显示；未搜袋(loot:)保留搜索过程（2026-08-09 用户要求）
        cap: contents.length,
        onClose: (remaining) => {
            // 2026-08-09 用户要求：保持现有战利品剩余逻辑——
            // 搜索完成拿取的物品进背包；未搜完/未拿取的物品存回 looted: 袋（下次再点开继续）。
            // 2026-08-10 修复"剩余物消失"：装不进背包（背包满）时掉到玩家脚下，不静默丢弃。
            if (remaining && remaining.length) {
                const ok = Panel.addItemLoot(sv, { id: 'looted:' + quality, n: 1, contents: remaining.slice() });
                if (!ok) {
                    addDrop(sv.px, sv.py, 'looted:' + quality, 1);
                    const d = sv.drops[sv.drops.length - 1];
                    if (d) d.contents = remaining.slice();
                    log('背包已满，战利品剩余物掉落在脚下', '#FFB347');
                }
            }
        },
    }, { onUseItem: (idx) => useItem(idx) });
}

// ================= 输入 =================
function initInput() {
    if (inited) return;
    inited = true;

    // v4.3 加载/过渡动画期间：capture 阶段吞掉所有键盘事件（含各弹窗独立绑定的 keydown）
    window.addEventListener('keydown', (e) => {
        if (window.__wslAnimBlocked) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('keydown', (e) => {
        if (!sv || !sv.active) return;
        // v4.3 动画期间直接忽略（capture 已拦截，此处双保险）
        if (window.__wslAnimBlocked) { e.preventDefault(); return; }
        const k = e.key.toLowerCase();
        // 2026-08-12 v3.41 键位设置：自定义键位也 preventDefault（覆盖任意绑定键）
        const kbs = KB.KEYBIND_DEFS.map(d => KB.getBind(d.act));
        if (['w', 'a', 's', 'd', ' ', 'escape', 'p', 'f1', 'f9', 'f11', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
            .concat(kbs).includes(k)) e.preventDefault();
        sv.keys[k] = true;
        // 2026-08-12 v3.41 键位录制状态：拦截按键（回车=结束录制；任意其它键=绑定）
        if (KB.handleKeybindRecordKey(k)) return;
        // v4.26 键位逻辑已收进 wkeybind.js（handleKeybindRecordKey 内部处理取消/绑定）
        // 2026-08-10 Ctrl 蹲下：按住 Ctrl 潜伏（屏幕变暗、敌对感知范围减半、移速 -30%）
        if (k === getBind('squat')) sv.squatting = true;
        // 2026-08-10 搜索界面打开时屏蔽移动键：角色静止，仅可关闭界面（世界时间照常流逝）
        if (WSearch.isOpen() && (k === 'w' || k === 'a' || k === 's' || k === 'd'
            || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright')) sv.keys[k] = false;
        // 2026-08-10 全屏退出统一走 ALT+ESC（普通 ESC 留给游戏内面板返回，避免冲突）
        if (k === 'escape' && e.altKey) {
            e.preventDefault();
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            return;
        }
        // 2026-08-11 v2.99 用户要求：F1 打开的教程再按 F1 关闭（对应键位返回）
        if (k === 'f1') {
            e.preventDefault();
            if (TUT.isOpen()) TUT.close(); else TUT.show();
            return;
        }
        if (k === 'escape' && TUT.isOpen()) { e.preventDefault(); TUT.close(); return; }   // 2026-08-10 教程通用返回
        if (k === 'f9') { e.preventDefault(); WDEV.toggle(sv); return; }
        if (k === 'f11') { e.preventDefault(); toggleFullscreen(); return; }
        if (sv.dead) return;
        // 2026-08-12 v3.41 键位设置面板：ESC 关闭（模态，优先于其它面板）
        if (KB.keybindOpen()) {
            if (k === 'escape') { KB.closeKeybinds(); return; }
            return;
        }
        // 2026-08-12 v3.40 长按扫描面板：ESC 关闭（模态，优先于其它面板）。
        // v4.37：死亡弹窗期间 .wsl-death.show 时全键被吞（仅 Enter/Space 走 form submit 默认行为）——
        // 此前死亡弹窗期间没拦截键，按 T/F 等仍生效 → 玩家看不见弹窗期间被莫名切视角/重生。
        // 弹窗期间一律 return（让浏览器把 Enter 交给 button 自带 form/click 处理即可）。
        if (sv.dead && typeof Panel !== 'undefined' && Panel.deathShown && Panel.deathShown()) {
            return;
        }
        // v3.75 加 typeof 守卫（旧版 / hot reload 时 scanPanelOpen 可能未定义，避免 "is not a function" 报错）
        if (typeof scanPanelOpen === 'function' && scanPanelOpen()) {
            if (k === 'escape' || k === getBind('interact')) { closeScanPanel(); return; }
            if (k === 'arrowup') { scanSelMove(-1); return; }
            if (k === 'arrowdown') { scanSelMove(1); return; }
            if (k === 'enter') { scanSelConfirm(); return; }
            return;
        }
        // 汽车菜单打开：数字键选项 / ESC 关闭
        if (carMenuOpen()) {
            if (k === 'escape' || k === 'f') { closeCarMenu(); return; }
            if (k === '1') { carMenuAct(carActByIndex(0)); return; }
            if (k === '2') { carMenuAct(carActByIndex(1)); return; }
            if (k === '3') { carMenuAct(carActByIndex(2)); return; }
            return;
        }
        // NPC 菜单打开：ESC/F 关闭
        if (npcMenuOpen()) {
            if (k === 'escape' || k === 'f') { closeNpcMenu(); return; }
            return;
        }
        // 队员命令面板打开：ESC/F 关闭
        if (npcCmdOpen()) {
            if (k === 'escape' || k === 'f') { closeNpcCommandMenu(); return; }
            return;
        }
        // 驾驶目的地选择打开：ESC/F 关闭
        if (driveDestOpen()) {
            if (k === 'escape' || k === 'f') { closeDriveDestMenu(); return; }
            return;
        }
        // 营地面板打开：ESC/F 关闭
        if (campPanelOpen()) {
            if (k === 'escape' || k === 'f') { closeCampPanel(); return; }
            return;
        }
        // 交易面板打开：ESC/F 关闭
        if (tradeOpen()) {
            if (k === 'escape' || k === 'f') { closeTrade(); return; }
            return;
        }
        // 角色属性面板打开：ESC 关闭
        if (charPanelOpen()) {
            if (k === 'escape' || k === 'f') { closeCharPanel(); return; }
            return;
        }
        // 队伍管理面板打开：ESC/F 关闭
        if (npcMgrOpen()) {
            if (k === 'escape' || k === 'f') { closeNpcMgr(); return; }
            return;
        }
        // 救治界面打开：ESC/F 关闭（关闭不会导致濒死玩家死亡）
        if (rescueOpen()) {
            if (k === 'escape' || k === 'f') { closeRescue(); return; }
            return;
        }
        // 武器修复弹窗：ESC 稍后
        if (wrepairOpen()) {
            if (k === 'escape' || k === 'f') {
                sv._brokenWpnPrompt = null;
                if (wrepairEl) wrepairEl.style.display = 'none';
                return;
            }
            return;
        }
        // 驾驶中：F 下车（其他战斗/动作键屏蔽，WASD 由 updateDrive 读取）
        if (sv.driving) {
            if (k === 'f') {
                if (sv.driveOrder) {
                    // NPC 驾驶命令进行中：取消命令并接管车辆
                    WV.finishDriveOrder(sv, false);
                    sv._chauffeured = false;
                    log('已取消驾驶命令，车辆由你接管', '#7DFF7D');
                } else {
                    WV.stopDrive(sv, canStand);
                }
                return;
            }
            if (k === 'p') { tryExit(); return; }
            return;
        }
        // 2026-08-10 世界地图（室外）：M 开/关、ESC 关闭；地图打开时角色静止但世界时间照常流逝
        if (WMAP.isOpen()) {
            // 清移动键（与搜索界面一致：角色静止，只保留关闭键）
            if (k === 'w' || k === 'a' || k === 's' || k === 'd'
                || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') sv.keys[k] = false;
            if (k === 'escape' || k === 'm') WMAP.close();
            return;
        }
        if (WSearch.isOpen()) {
            // 2026-08-10 搜索界面打开：角色静止，禁止移动/跳跃/闪现/攻击，仅 ESC/F/B 关闭；
            // 世界时间照常流逝（用户定案：除 ESC 外界面不暂停世界）
            if (k === 'escape' || k === 'f' || k === 'b') WSearch.closeSearch(sv, true);
            return;
        }
        if (WW.isSurgeryOpen()) {
            if (k === 'escape' || k === 'k') WW.closeSurgery();
            return;
        }
        if (WW.isOpen()) {
            if (k === 'escape' || k === 'k') WW.close();
            return;
        }
        if (k === getBind('craft')) { WW.open(sv, { onMessage: log, onPonderCorrupt }); return; }
        // 2026-08-09 修复"打开 NPC 物品栏查看物品后 UI 关不掉"：B 键本应关闭储物柜
        // （界面提示 B/F/ESC 关闭），但此处无条件 toggleBag，储物柜(含 NPC 只读查看)打开时
        // 按 B 只会切换背包、储物柜永远关不掉。改为：储物柜打开时 B 先关闭储物柜。
        if (k === getBind('bag')) {
            if (Panel.isChestOpen()) { Panel.hideChest(); return; }
            Panel.toggleBag(sv); return;
        }
        if (k === 'escape') {
            // ESC 只关闭已打开的面板（避免与浏览器退出全屏冲突）；暂停菜单用 P
            if (WDEV.isOpen()) { WDEV.close(); return; }   // 2026-08-10 开发者面板通用返回
            if (sv._flagPlace && sv._flagPlace.active) { sv._flagPlace = null; log('已取消放置旗帜（旗帜未消耗）', '#8a9aa2'); return; }   // 2026-08-10 旗帜待放置取消
            // v4.56 躺地 NPC 选择框打开时 ESC 关闭（用户 F 交互弹出后可用 ESC 取消）
            if (sv._bodyAct) { sv._bodyAct = null; AudioSystem.playClick && AudioSystem.playClick(); return; }
            if (Panel.anyOpen()) { Panel.hideBag(); Panel.hideChest(); return; }
            if (pauseOpen) { togglePause(); return; }
            return;
        }
        if (k === 'p') { tryExit(); return; }
        if (Panel.anyOpen()) {
            if (k === 'f') Panel.hideChest();
            if (Panel.isBagOpen() && k >= '1' && k <= '6') {
                const idx = parseInt(k) - 1;
                const sel = Panel.getSelInfo();
                if (sel) {
                    sv.hotbar[idx] = sv.hotbar[idx] === sel ? null : sel;
                    log(sv.hotbar[idx] ? `快捷栏 ${idx + 1} 绑定：${Panel.getItemInfo(sel).name}` : `快捷栏 ${idx + 1} 已清空`);
                    AudioSystem.playClick();
                }
            }
            return;
        }
        if (k === getBind('map')) { if (!sv.interior) WMAP.toggle(sv); return; }   // 2026-08-10 世界地图（仅室外）
        if (k === getBind('build')) {
            // 2026-08-10 领地旗帜待放置：按 G 在当前脚下位置插旗建立营地（旗帜回收/重放见 F 收起）
            if (sv._flagPlace && sv._flagPlace.active) {
                const it = sv.inv.find(s => s && s.id === 'flag');
                if (!it) { sv._flagPlace = null; log('没有领地旗帜了', '#FFB347'); return; }
                sv.camp = { x: sv.px, y: sv.py, id: 'camp_' + sv.day + '_' + Math.floor(sv.px / TS) + '_' + Math.floor(sv.py / TS) };
                // 联机：营地设置广播（对方看到同一营地）
                if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'camp', x: sv.px, y: sv.py });
                it.n--;
                if (it.n <= 0) sv.inv[sv.inv.indexOf(it)] = null;
                sv._flagPlace = null;
                log('领地旗帜已插下！营地成为 NPC 居住地（会吸引新居民），领地内回血/体力加速/移速提升，敌对生物减少生成', '#FFD700');
                AudioSystem.playCollect();
                Panel.refresh(sv);
                return;
            }
            WB.toggleBuild(sv);
            return;
        }
        // 2026-08-11 v2.99 用户要求：任何用键盘键位打开的 UI，都能再次按对应键关闭
        if (k === getBind('char')) {
            if (charPanelOpen()) { closeCharPanel(); return; }   // 对应键再按关闭属性面板
            openCharPanel(sv.controllerId); return;
        }
        if (k === getBind('team')) {
            if (npcMgrOpen()) { closeNpcMgr(); return; }   // 对应键再按关闭队伍管理
            openNpcMgr(); return;
        }
        // 背起/放下倒地主角（2026-08-09）：靠近倒地主角时按对应键背起，背起后再按放下
        if (k === getBind('carry') && sv._downed) {
            if (sv._carryDowned) {
                // 背起状态：V = 放下（当前位置放下，室内用房间坐标）
                sv._carryDowned = false;
                if (sv.interior) { sv._downed.px = sv.interior.px; sv._downed.py = sv.interior.py; }
                else { sv._downed.px = sv.px; sv._downed.py = sv.py; }
                log(`你放下了 ${sv._downed.name}`, '#B8C4C8');
                return;
            }
            const d = Math.hypot(sv.px - sv._downed.px, sv.py - sv._downed.py);
            if (d < 1.0 * TS) {
                sv._carryDowned = true;
                log(`你背起了 ${sv._downed.name}，走到床旁/安全点按 V 或 F 放下`, '#B8C4C8');
                return;
            }
        }
        // 手动切换队友视角（2026-08-09 用户要求：硬核倒地不自动切，按 T 手动切到最近存活队友）
        if (k === 't' && sv._waitDowned) {
            // 2026-08-09 优先同位置（同室内/同室外）队友，避免切到另一空间
            const mm = (sv.npcs || []).filter(n => n.alive && n.party && n.id !== sv.controllerId && !n.isPlayer)
                .sort((a, b) => {
                    const aSame = !!a.inInterior === !!sv.interior;
                    const bSame = !!b.inInterior === !!sv.interior;
                    if (aSame !== bSame) return aSame ? -1 : 1;
                    return Math.hypot(a.x - sv.px, a.y - sv.py) - Math.hypot(b.x - sv.px, b.y - sv.py);
                });
            if (mm.length >= 1) {
                if (WNPC.switchControl(sv, mm[0].id, true)) {
                    sv._waitDowned = false;
                    sv.hurtT = 0;
                    if (!sv.wpn) WG.initWpn(sv, {});
                    log(`你现在操控 ${mm[0].name}……（原角色已倒地/阵亡）`, '#2EE6C0');
                    saveNow();
                    return;
                }
            } else {
                log('没有可切换的存活队友', '#FFB347');
                return;
            }
        }
        // 2026-08-11 集合信号（按 T，非倒地切视角时）：所有队伍成员转为跟随、缓慢向你走来。
        // 队友离得远时屏幕边缘已有指向箭头+名字+距离（render.drawMateGuide），发出信号后
        // 他们沿寻路（moveToward/followAI）过来；卡碰撞体由 npcUnstick/寻路兜底自动脱离。
        // 2026-08-12 v2.104 用户定稿："谁是主控谁就可以召集"——切视角后的新主控也要能召集
        // 原主控（isPlayer）。原过滤 `!n.isPlayer` 会排除原主控，导致新主控召集不了它。
        // 改为只排除当前主控（n.id === sv.controllerId），其余队伍成员（含 isPlayer 原主控）都可被召集。
        if (k === getBind('rally') && !sv._waitDowned) {
            const mates = (sv.npcs || []).filter(n => n.alive && n.party && !n.downed && n.id !== sv.controllerId && !n.riding);
            if (!mates.length) { log('队伍里没有其他队员', '#FFB347'); return; }
            let n2 = 0;
            const near = [], far = [];
            for (const m of mates) {
                interruptMateWork(m);   // v4.19 最高命令：打断搜刮/采药/营地/游荡/追敌，转为跟随
                const d = Math.hypot(m.x - sv.px, m.y - sv.py) / TS;
                if (d > 6) far.push(`${m.name}(${Math.round(d)}格)`);
                else near.push(m.name);
                n2++;
            }
            AudioSystem.playClick();
            log(`集合信号已发出：${n2} 名队员正向你靠拢${far.length ? '（远处 ' + far.join('、') + '，屏幕边缘有方向指引）' : ''}`, '#7DFF7D');
            return;
        }
        if (sv.build && k >= '1' && k <= '5') { sv.buildSel = parseInt(k) - 1; AudioSystem.playClick(); return; }
        if (!sv.build && k >= '1' && k <= '6') { useHotbar(parseInt(k) - 1); return; }
        if (k === getBind('interact')) {
            if (sv.interior) { doInteriorInteract(); return; }
            doInteract(); return;
        }
        if (k === getBind('dash')) { WA.startDash(sv); return; }
        // 2026-08-12 v3.40 长按扫描周围可交互目标：keydown 记录按下时刻，keyup 判断是否长按。
        // 已打开的扫描面板按对应键关闭（与其它键位 UI 同语义：对应键再按关闭）。
        if (k === getBind('scan')) {
            if (typeof scanPanelOpen === 'function' && scanPanelOpen()) { closeScanPanel(); return; }
            // 2026-08-12 v3.47 开门后 0.5s 冷却：按住不放 auto-repeat 时面板刚打开不立即被关闭重开
            if (sv._scanCooldownUntil && performance.now() < sv._scanCooldownUntil) return;
            // 2026-08-12 v3.42 长按扫描：按下记录时间，进度环（render 绘制）0.8s 满后开门
            // 2026-08-12 v3.47 修复"无视觉反馈 + 触发后隔很久"：浏览器长按键盘会 auto-repeat 重复触发
            // keydown（每 ~30ms 一次），若每次都重置 _scanHeldAt → 进度环计时被反复清零，prog 永远接近 0
            // 圆环不动、永不自动开门；松手时 held 也只计最后一次 auto-repeat 的 ~30ms → keyup 兜底也失配。
            // 修复：仅首次按下（!_scanHeld）才记录时刻，auto-repeat 重复 keydown 直接忽略。
            if (!sv._scanHeld) {
                sv._scanKeyDownT = performance.now();
                sv._scanHeldAt = sv._scanKeyDownT;
                sv._scanHeld = true;
            }
            return;
        }
        if (k === getBind('guard')) { WA.startGuard(sv); return; }
        if (k === getBind('jump')) { WA.tryJump(sv); return; }
        if (k === getBind('attack')) { const r = withInteriorZombies(() => WG.meleeAttack(sv)); if (r && r.msg) log(r.msg); return; }
        if (k === getBind('reload')) { const r = WG.startReload(sv); if (r && r.msg) log(r.msg); return; }
        if (k === getBind('swap')) { const r = WG.swapSlot(sv); if (r && r.msg) log(r.msg); return; }
        if (k === getBind('carry')) { const r = WG.toggleFireMode(sv); if (r && r.msg) log(r.msg); return; }
    });

    window.addEventListener('keyup', (e) => {
        if (!sv) return;
        const k = e.key.toLowerCase();
        sv.keys[k] = false;
        if (k === getBind('squat')) sv.squatting = false;   // 松开蹲下键 → 解除蹲下
        if (k === getBind('guard')) WA.endGuard(sv);
        // 2026-08-12 v3.45 长按扫描键：进度环满时帧循环已自动开门（_scanDone）；
        // 松手时若仍未开门（短按/未满）则补一次兜底；已自动开门则不重复开。
        if (k === getBind('scan') && sv._scanKeyDownT) {
            const held = performance.now() - sv._scanKeyDownT;
            sv._scanKeyDownT = 0;
            sv._scanHeld = false;
            const auto = sv._scanDone;
            sv._scanDone = false;
            // 2026-08-12 v3.50 长按最大时间 0.35s → 0.8s（与进度环填充时间一致）
            if (!auto && held >= 800 && !scanPanelOpen() && !(sv._scanCooldownUntil && performance.now() < sv._scanCooldownUntil)) {
                sv._scanCooldownUntil = performance.now() + 500;
                openScanPanel();
            }
        }
    });

    window.addEventListener('blur', () => { if (!sv) return; sv.aiming = false; sv.mouseDown = false; });

    const canvas = document.getElementById('game');
    canvas.addEventListener('mousemove', (e) => {
        if (!sv || !sv.active) return;
        const rect = canvas.getBoundingClientRect();
        sv.mouse.x = (e.clientX - rect.left) * (960 / rect.width);
        sv.mouse.y = (e.clientY - rect.top) * (540 / rect.height);
        sv.mouse.inside = true;
    });
    canvas.addEventListener('mouseleave', () => { if (sv) sv.mouse.inside = false; });

    // 2026-08-18 v4.33 躺地 NPC 交互选择框：鼠标滚轮（中键滚动）上下切换"搜索/补刀/救治"选项。
    // 仅当选择框激活时拦截滚轮；其它场景滚轮不干扰（扫描面板/地图等各自绑定在自身元素上）。
    canvas.addEventListener('wheel', (e) => {
        if (!sv || !sv._bodyAct || !sv._bodyAct.opts || !sv._bodyAct.opts.length) return;
        if (!sv.active || sv.dead || Panel.anyOpen() || WSearch.isOpen()) return;
        e.preventDefault();
        const n = sv._bodyAct.opts.length;
        sv._bodyAct.sel = (sv._bodyAct.sel + (e.deltaY > 0 ? 1 : -1) + n) % n;
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
        // 2026-08-12 v3.41 键位录制：鼠标按键（含侧键）也可绑定
        if (KB.handleKeybindRecordKey('mouse' + e.button)) {
            e.preventDefault();
            return;
        }
        if (!sv || !sv.active || sv.dead || Panel.anyOpen() || WSearch.isOpen()) return;   // 搜索界面打开：禁止攻击
        if (e.button === 2) {
            // 2026-08-12 v3.41 右键=瞄准（可自定义绑定；若改绑为其它功能则跳过）
            if (getBind('scope') !== 'mouse2') return;
            e.preventDefault();
            if (!sv.build) { const r = WG.toggleScope(sv); if (r && r.msg) log(r.msg); }
            return;
        }
        if (e.button !== 0) {
            // 2026-08-12 v3.41 鼠标侧键（button 1/3/4）：可作为"交互/攻击/扫描"等绑定触发
            const mb = 'mouse' + e.button;
            if (mb === getBind('interact')) { e.preventDefault(); if (sv.interior) doInteriorInteract(); else doInteract(); }
            else if (mb === getBind('attack')) { e.preventDefault(); const r = withInteriorZombies(() => WG.meleeAttack(sv)); if (r && r.msg) log(r.msg); }
            else if (mb === getBind('scan')) { e.preventDefault(); if (typeof scanPanelOpen === 'function' && scanPanelOpen()) closeScanPanel(); else openScanPanel(); }
            // 2026-08-12 v3.58 鼠标中键（button 1）长按扫描（与长按 N 同效果）：按住开始计时（圆环中心在鼠标处），
            // 按住 0.8s 松开 → 打开扫描面板；短按中键仍是开/关扫描面板。与 N 共用 _scanHeld/_scanHeldAt。
            else if (e.button === 1 && sv) {
                e.preventDefault();
                if (!sv._scanHeld) {
                    sv._scanHeld = true;
                    sv._scanHeldAt = performance.now();
                }
            }
            return;
        }
        e.preventDefault();
        // 2026-08-18 v4.33 左键点击躺地 NPC 选择框选项 → 直接确认（搜索/补刀/救治）。
        // v4.63.3 几何同步：以快捷栏第3-4中间线为基准（drawHotbar x=500），bx = 500 - boxW/2，
        // v4.63.9 回到快捷栏上方基准：by = 540 - 80 - boxH - 8，紧贴快捷栏上方，与 render.drawBodyAct 一致
        if (sv._bodyAct && sv._bodyAct.opts && sv._bodyAct.opts.length && sv.mouse.inside) {
            const _ba = sv._bodyAct;
            const _boxW = Math.min(350, 960 - 32), _lineH = 22, _pad = 10;
            const _rows = _ba.opts.length;
            const _boxH = 30 + _rows * _lineH + _pad * 2;
            const _bx = Math.max(8, 500 - _boxW / 2);
            const _by = Math.max(40, 540 - 80 - _boxH - 8);
            if (sv.mouse.x >= _bx && sv.mouse.x <= _bx + _boxW && sv.mouse.y >= _by + 30 && sv.mouse.y <= _by + _boxH - _pad + 6) {
                for (let i = 0; i < _rows; i++) {
                    const _y = _by + 42 + i * _lineH;
                    if (sv.mouse.y >= _y - _lineH / 2 && sv.mouse.y <= _y + _lineH / 2) {
                        _ba.sel = i;
                        if (execBodyAct(sv)) return;
                    }
                }
            }
        }
        if (sv.build) {
            const gx = Math.floor((sv.camX + sv.mouse.x) / TS), gy = Math.floor((sv.camY + sv.mouse.y) / TS);
            WB.placeBuild(sv, gx, gy, countItem, takeItem);
            return;
        }
        if (WG.activeSlot(sv) === 'melee') { const r = withInteriorZombies(() => WG.meleeAttack(sv)); if (r && r.msg) log(r.msg); return; }
        const rk = WG.equipped(sv, 'ranged');
        if (!rk) { const r = withInteriorZombies(() => WG.meleeAttack(sv)); if (r && r.msg) log(r.msg); return; }
        const w = WEAPONS[rk];
        if (!w) return;
        if (w.chargeable) { WG.startCharge(sv); return; }
        sv.mouseDown = true;
        if (w.modes && w.modes.includes('auto') && WG.modeOf(sv, rk) === 'auto') return;
        const r = withInteriorZombies(() => WG.tryFire(sv));
        if (r && r.msg) log(r.msg);
    });

    window.addEventListener('mouseup', (e) => {
        if (!sv) return;
        const isMain = e.button === 0;
        const isMid = e.button === 1;
        if (!isMain && !isMid) return;
        if (isMain) sv.mouseDown = false;
        // 2026-08-12 v3.58 鼠标长按扫描判定（左键或中键，与长按 N 同效果）：
        // 按住 ≥0.8s 松开 → 打开扫描面板；短按左键走攻击/射击、短按中键无攻击副作用。
        if (sv._scanHeld) {
            const heldMs = performance.now() - sv._scanHeldAt;
            sv._scanHeld = false;
            if (heldMs >= 800 && !sv.dead && !(typeof scanPanelOpen === 'function' && scanPanelOpen())
                && !(sv._scanCooldownUntil && performance.now() < sv._scanCooldownUntil)) {
                sv._scanCooldownUntil = performance.now() + 500;
                openScanPanel();
            }
        }
        if (!isMain) return;   // 中键仅用于长按扫描，不触发攻击/弓蓄力
        if (!sv.active || sv.dead) { if (sv.wpn) sv.wpn.charging = false; return; }
        if (Panel.anyOpen()) {
            if (sv.wpn && sv.wpn.charging) { sv.wpn.charging = false; sv.wpn.chargeT = 0; AudioSystem.stopBowCharge(); }
            return;
        }
        if (sv.wpn && sv.wpn.charging) { const r = withInteriorZombies(() => WG.releaseBow(sv)); if (r && r.msg) log(r.msg); }
    });

    canvas.addEventListener('contextmenu', (e) => { if (sv && sv.active) e.preventDefault(); });
    window.addEventListener('beforeunload', () => { if (sv && sv.active && !sv.dead) saveNow(); });
}

// ================= 进出入口 =================
// 联机模式（mpWasteland.js 调用）：opts.seed 指定双方共用世界种子、
// opts.character 跳过捏脸直接使用房主外观、opts.mp 写入 sv.mp 开关。
// 单机模式：泰拉瑞亚式角色/世界分离 —— opts.characterName 指定角色（无则创建）、
// opts.seed 指定世界种子（可修改后开新世界）、否则恢复 profile 组合。
export function enterWasteland(opts) {
    if (sv) exitWasteland(true);
    KB.setLogger(log);   // v4.26 键位模块提示走生存层 log（含 mp 广播）
    WE.setLogger(log);   // v4.26 事件模块提示走生存层 log（含 mp 广播）
    WWX.setLogger(log);  // v4.26 天气模块提示走生存层 log（含 mp 广播）
    WCorpse.setLogger(log);  // v4.26 尸变模块提示走生存层 log（含 mp 广播）
    // v4.26 倒地模块依赖注入（log/saveNow/全灭弹窗/降级兜底；sv 在 buildRun 后注入）
    setDownedLogger(log);
    setDownedSaveNow(() => { try { saveNow(); } catch (_) {} });
    setDownedShowAllDeadChoices(showAllDeadChoices);
    setDownedAllDeadFallback(_softRespawnAllDeadFallback);
    // v4.26 菜单模块依赖注入（log + 生存层内部函数；sv 在 buildRun 后注入）
    setMenuLogger(log);
    setMenuHooks({
        useItem, rollWordAddon, canStand, isFoodId, CAR_LOOT_POOL,
    });
    opts = { invasion: true, wildSpawn: true, difficulty: 'normal', ...(opts || {}) };
    if (opts.mp) { enterWastelandMP(opts); return; }
    enterWastelandSP(opts);
}

// 联机握手路径（mpWasteland.js 调用；角色已在握手阶段备好）：
//   host  加载世界档（opts.seed 对应存档，含双方修改）+ 房主角色档
//   guest 只加载角色档（世界状态由 wsync 快照覆写，不落本地世界档）
function enterWastelandMP(opts) {
    const isHost = opts.mp && opts.mp.role === 'host';
    const name = opts.characterName || currentCharacterName() || null;
    const charSaved = loadCharacterData(name);
    const seed = opts.seed != null ? opts.seed : null;
    const worldSaved = isHost && seed != null && !opts.forceNew ? getStorage(worldKey(seed), null) : null;
    const charData = charSaved || {
        name: name || '玩家',
        character: normalizeLook(opts.character),
        inv: Array(Panel.BAG_SIZE).fill(null),
        hotbar: Array(HOTBAR_SIZE).fill(null),
        curSlot: 'ranged',
        hp: B.MAX_HP, maxHp: B.MAX_HP,
        food: B.HUNGER_MAX, water: B.WATER_MAX, infection: 0,
        stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
    };
    sv = buildRun(worldSaved, charData, opts);
    setDownedSv(sv);   // v4.26 倒地模块 sv 引用（救援 UI 内部使用）
    setLootSv(sv);     // v4.26 掉落模块 sv 引用（host 权威 drops 同步）
    setMenuSv(sv);     // v4.26 菜单模块 sv 引用（面板 UI 内部使用）
    sv.characterName = charData.name;
    sv.character = normalizeLook(charData.character) || normalizeLook(opts.character);
    sv.mp = opts.mp || null;
    if (!worldSaved) {
        WNPC.initRoster(sv);           // 新世界：原主角入队（统一名册）
        WNPC.spawnInitialNpcs(sv);
    }
    WNPC.applyControlled(sv);
    startRun(opts);
}

// 单机角色系统：恢复/创建角色 + 恢复/新建世界
function enterWastelandSP(opts) {
    let prof = getStorage(PROFILE_KEY, null);
    if (!prof || !prof.characterName) prof = migrateLegacySave();
    const charName = opts.characterName || (prof && prof.characterName) || null;
    const charSaved = charName ? getStorage(charKey(charName), null) : null;

    const finish = (charData) => {
        const seed = opts.seed != null ? opts.seed
            : (!opts.forceNew && prof && prof.worldSeed != null ? prof.worldSeed : null);
        const worldSaved = (seed != null && !opts.forceNew) ? getStorage(worldKey(seed), null) : null;
        sv = buildRun(worldSaved, charData, opts);
        setDownedSv(sv);   // v4.26 倒地模块 sv 引用（救援 UI 内部使用）
        setLootSv(sv);     // v4.26 掉落模块 sv 引用（host 权威 drops 同步）
        setMenuSv(sv);     // v4.26 菜单模块 sv 引用（面板 UI 内部使用）
        sv.characterName = charData.name;
        // 新世界（无世界档）：补初始队伍；读档由 applyWorld restoreNpcs 还原
        if (!worldSaved) {
            WNPC.initRoster(sv);
            WNPC.spawnInitialNpcs(sv);
        }
        WNPC.applyControlled(sv);
        setStorage(PROFILE_KEY, { characterName: charData.name, worldSeed: sv.world.seed });
        startRun(opts);
    };

    if (!charSaved) {
        // 创建角色：命名 + 捏脸合并界面 → 落角色档
        // v3.76 返回：恢复创意工坊/主菜单 screen（bg-fx 隐藏的那层），否则全屏遮罩残留
        const backToMenu = () => {
            const vis = [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden'));
            if (vis && vis.id !== 'game-screen') vis.classList.remove('hidden');
        };
        showCreateCharacter((name, look) => {
            const cd = {
                name,
                character: look,
                inv: Array(Panel.BAG_SIZE).fill(null),
                hotbar: Array(HOTBAR_SIZE).fill(null),
                curSlot: 'ranged',
                hp: B.MAX_HP, maxHp: B.MAX_HP,
                food: B.HUNGER_MAX, water: B.WATER_MAX, infection: 0,
                stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
            };
            setStorage(charKey(name), cd);
            updateCharList(name);
            finish(cd);
        }, backToMenu);
        return;
    }
    finish(charSaved);
}

// ================= 开始游戏弹窗（2026-08-09 重构）=================
// 单层界面：选择角色 + 选择世界（已有/新建）+ 开始按钮（选全才可点）。
// 点「开始游戏」→ 再弹「单人/多人联机」选择。
// 创建新角色：命名/随机 → 捏脸 → 保存（不进游戏）→ 回弹窗
// 创建新世界：命名/随机 + 选难度 → 保存记录（不进游戏）→ 回弹窗（难度锁定不可改）
let _startDialogCb = null;   // { onLaunch, onLaunchMP }
export function showGameStartDialog(cb) {
    _startDialogCb = cb || _startDialogCb;
    if (!document.getElementById('wsl-start')) buildStartDialog();
    renderStartDialog();
}
function buildStartDialog() {
    // v3.67 提前预热粒子背景（避免进入捏脸/创建角色界面时第一帧卡顿）
    preloadBgFxParts();
    // v3.81 提前预热捏脸 sprite（walk 帧 PNG）：首次点「创建绑定角色」不再卡顿/预览空白
    loadThumbSprites();
    // v3.83 预热捏脸 DOM 骨架模板（脱离文档、不渲染）
    preloadLookSkeleton();
    // v3.86/v3.88 预挂载完整捏脸实例（visibility:hidden 挂载在 bg-fx，首次 layout 此刻完成）：
    // 点击「创建绑定角色」直接复用 DOM，点击路径只剩状态更新 → 彻底消除 clone/挂载/样式计算的同步卡顿（背景动画不再顿一下）
    preloadLookCreator();
    const el = document.createElement('div');
    el.id = 'wsl-start';
    // v3.75 弹窗外层遮罩改透明：让 bg-fx（末世废土粒子）透出（之前 rgba(5,8,12,0.94) 盖住粒子，
    // 只有过渡动画淡出时才看到背景 → 用户反馈"背景替换错了位置"）
    el.style.cssText = 'position:fixed;inset:0;z-index:1240;background:transparent;display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
    el.dataset.wslCard = '1';   // v3.80 内容卡片标记：弹窗切换动画作用于该元素（向上弹出/淡入）
    // 2026-08-09 重构：左右布局 —— 左侧角色捏脸预览动画（跟捏脸界面一样循环走步 + tintSprite），
    // 右侧选择器。世界 ↔ 角色【强绑定】：选世界 → 只读显示该世界绑定的角色（角色选择权限关闭，
    // 不可自由切换）；世界无绑定角色 → 显示「创建绑定角色」。创建新世界 → 紧接着创建角色绑定。
    el.innerHTML = `
        <div data-wsl-card="1" style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:20px;width:640px;box-shadow:0 0 40px rgba(57,217,138,0.25);display:flex;gap:16px;">
            <div style="display:flex;flex-direction:column;align-items:center;padding:10px;background:#0a0e12;border:1px solid #1d2d1d;border-radius:8px;min-width:120px;">
                <div style="color:#9fb3ab;font-size:11px;letter-spacing:2px;margin-bottom:6px;">角色预览</div>
                <div style="width:96px;height:192px;background:#05080c;border:1px solid #2a3a33;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                    <canvas id="wsl-start-preview" width="48" height="96" style="image-rendering:pixelated;width:96px;height:192px;"></canvas>
                </div>
                <div id="wsl-start-prevname" style="color:#6d8a6d;font-size:11px;margin-top:6px;letter-spacing:1px;">未绑定角色</div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:10px;">
                <div style="text-align:center;color:#39d98a;font-size:22px;letter-spacing:6px;margin-bottom:4px;">◈ 开 始 游 戏 ◈</div>
                <div style="color:#9fb3ab;font-size:13px;">① 选择世界（一个世界固定对应一个角色）</div>
                <div style="display:flex;gap:8px;">
                    <select id="wsl-start-world" style="flex:2;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;color:#dce6e2;font-size:14px;"></select>
                    <button id="wsl-start-worldnew" style="flex:1;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:8px;cursor:pointer;">创建新世界</button>
                </div>
                <div style="color:#9fb3ab;font-size:13px;">② 绑定角色（由世界自动对应 · 不可切换）</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <div id="wsl-start-char" style="flex:2;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;color:#dce6e2;font-size:14px;min-height:20px;display:flex;align-items:center;">—</div>
                    <button id="wsl-start-charnew" style="flex:1;background:#1a2a3a;border:1px solid #4da3ff;color:#4da3ff;border-radius:6px;padding:8px;cursor:pointer;">创建绑定角色</button>
                </div>
                <!-- v3.66 游玩模式：单/多合并到开始游戏界面（与软核/硬核同款按钮组，初始全未选，必选） -->
                <div style="color:#9fb3ab;font-size:13px;">③ 游玩模式（必选，可中途变更）：</div>
                <div style="display:flex;gap:8px;">
                    <button class="wsl-start-mode" data-mode="sp" style="flex:1;background:#141c22;border:2px solid #2a3a33;color:#7a8a92;border-radius:6px;padding:8px;cursor:pointer;font-size:13px;">单人模式</button>
                    <button class="wsl-start-mode" data-mode="mp" style="flex:1;background:#141c22;border:2px solid #2a3a33;color:#7a8a92;border-radius:6px;padding:8px;cursor:pointer;font-size:13px;">多人联机</button>
                </div>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:auto;">
                    <button id="wsl-start-cancel" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:10px;cursor:pointer;">取消</button>
                    <button id="wsl-start-ok" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:10px;cursor:pointer;">开始游戏 ▶</button>
                </div>
                <div id="wsl-start-hint" style="text-align:center;color:#5a6a62;font-size:11px;"></div>
            </div>
        </div>`;
    document.body.appendChild(el);
    // v3.62 开始游戏界面背景粒子 + 动画 + 渐变（同一风格抽象粒子层，弹窗关闭自动清理）
    attachParticleBg(el);
    el.querySelector('#wsl-start-cancel').addEventListener('click', () => { cancelStartPreview(); el.remove(); destroyBgFx(); });
    // v3.80 弹窗切换动画：当前弹窗向上淡出 → 创建世界/角色界面在屏幕中央缓缓显现
    // v3.80 创建绑定角色：开始弹窗向上弹出 → 捏脸淡入（捏脸淡入由 wlook.js 内部处理）
    el.querySelector('#wsl-start-charnew').addEventListener('click', () => {
        // v3.93 点击瞬间立即显示加载遮罩：盖住点击后的构建卡顿（不再"先卡一下再出遮罩"），
        // 上弹动画在遮罩下进行，遮罩淡出时直接露出已就绪的捏脸界面。
        showWslLoading();
        animateDialogSwap(null, startBoundCharacter);
    });
    el.querySelector('#wsl-start-worldnew').addEventListener('click', () => {
        animateDialogSwap(null, startNewWorld);
    });
    // v3.66 游玩模式按钮：与软核/硬核同款（初始全未选 + 选中变色 + 单选）
    el.dataset.startMode = '';
    const paintMode = () => {
        const cur = el.dataset.startMode || '';
        el.querySelectorAll('.wsl-start-mode').forEach(x => {
            const on = x.dataset.mode === cur;
            if (on) { x.style.background = '#123d2c'; x.style.borderColor = '#39d98a'; x.style.color = '#8dffc4'; x.style.boxShadow = '0 0 10px rgba(57,217,138,0.4)'; }
            else { x.style.background = '#141c22'; x.style.borderColor = '#2a3a33'; x.style.color = '#7a8a92'; x.style.boxShadow = 'none'; }
        });
    };
    // v3.80 游玩模式前置校验：未创建世界/角色时【不能选择模式】，提示"请先创建世界/角色"
    el.querySelectorAll('.wsl-start-mode').forEach(b => b.addEventListener('click', () => {
        const seed = Number(el.querySelector('#wsl-start-world')?.value || 0);
        const charName = boundCharName(seed);
        if (!seed || !charName) {
            showToast('请先创建世界/角色，再选择游玩模式', '#FFB347');
            el.querySelectorAll('.wsl-start-mode').forEach(x => { x.style.borderColor = '#ff5544'; });
            setTimeout(() => paintModeOn(el), 1200);
            return;
        }
        el.dataset.startMode = b.dataset.mode; paintMode();
    }));
    // 继续游戏 / 开始游戏共用同一按钮位置（2026-08-09 用户要求）：
    el.querySelector('#wsl-start-ok').addEventListener('click', () => {
        const ok = el.querySelector('#wsl-start-ok');
        if (ok.dataset.mode === 'continue') continueGameConfirm();
        else startGameConfirm(el.dataset.startMode || '');
    });
    // 世界选择 → 显示该世界绑定的角色（只读）→ 刷新预览
    // v4.8 切换世界实时刷新"开始游戏/继续游戏"按钮：按所选存档新旧自动切换
    //（renderStartDialog 内部已调用 updateStartPreview 刷新角色预览）
    el.querySelector('#wsl-start-world').addEventListener('change', () => renderStartDialog());
}
// 开始游戏弹窗的左侧角色预览动画：循环播放选中角色的捏脸动画（跟捏脸界面一样用 walk-front 帧 + tintSprite）
let _startPrevRaf = 0;
function cancelStartPreview() {
    if (_startPrevRaf) { cancelAnimationFrame(_startPrevRaf); _startPrevRaf = 0; }
}
function updateStartPreview() {
    cancelStartPreview();
    const el = document.getElementById('wsl-start');
    if (!el) return;
    const canvas = el.querySelector('#wsl-start-preview');
    const nameEl = el.querySelector('#wsl-start-prevname');
    const charBox = el.querySelector('#wsl-start-char');
    const charNewBtn = el.querySelector('#wsl-start-charnew');
    const ws = el.querySelector('#wsl-start-world');
    if (!canvas) return;
    // 角色由世界绑定唯一决定（2026-08-09：角色选择权限关闭）
    const seed = ws ? Number(ws.value) : 0;
    let name = null;
    if (seed) {
        const wd = getStorage(worldKey(seed), null);
        name = (wd && wd.characterName) ? wd.characterName : null;
    }
    if (charBox) {
        if (name) {
            // 最近游戏时间拼在角色名右侧，用 · 隔开
            const wd = getStorage(worldKey(seed), null);
            let timeText = '暂未登录';
            if (wd && wd.lastLoginTime) {
                const dt = new Date(wd.lastLoginTime);
                timeText = `${dt.getFullYear()}年${String(dt.getMonth()+1).padStart(2,'0')}月${String(dt.getDate()).padStart(2,'0')}日${String(dt.getHours()).padStart(2,'0')}时${String(dt.getMinutes()).padStart(2,'0')}分`;
            }
            charBox.innerHTML = `<span style="color:#cfe8cf">${escHtml(name)}</span><span style="color:#5a6a62;margin-left:6px;">· ${timeText}</span>`;
        } else {
            charBox.textContent = '—（未绑定角色）';
            charBox.style.color = '#8a5a5a';
        }
    }
    if (charNewBtn) {
        // 已选世界且未绑定角色 → 可创建；否则（未选世界或已绑定）禁用
        charNewBtn.disabled = !(seed && !name);
        charNewBtn.style.opacity = charNewBtn.disabled ? 0.4 : 1;
        charNewBtn.style.cursor = charNewBtn.disabled ? 'not-allowed' : 'pointer';
        charNewBtn.textContent = (seed && !name) ? '创建绑定角色' : '创建绑定角色';
    }
    const cd = name ? getStorage(charKey(name), null) : null;
    const look = cd && cd.character ? cd.character : null;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (!look) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (nameEl) { nameEl.textContent = name ? '已绑定 · 预览' : '未绑定角色'; nameEl.style.color = '#5a6a62'; }
        return;
    }
    if (nameEl) { nameEl.textContent = name; nameEl.style.color = '#cfe8cf'; }
    const start = performance.now();
    const tick = (t) => {
        if (!document.getElementById('wsl-start')) return;
        const frame = Math.floor((t - start) / 160) % 4;
        const img = (_mcWalk.front && _mcWalk.front[frame]) || _mcSprites.front;
        if (img) {
            const sp = tintSprite(img, look);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // 居中缩放填满 canvas
            const scale = Math.min(canvas.width / sp.width, canvas.height / sp.height);
            const dw = sp.width * scale, dh = sp.height * scale;
            const dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2;
            ctx.drawImage(sp, dx, dy, dw, dh);
        }
        _startPrevRaf = requestAnimationFrame(tick);
    };
    _startPrevRaf = requestAnimationFrame(tick);
}
// 角色列表选项（含存活天数）
// 2026-08-09 修复"删除所有存档后角色栏仍有缓存"：索引 wasteland_characters 可能残留
// 已删除角色的名字（旧版删除只删档没同步索引），此处过滤——角色档不存在就不显示。
function startCharOptionsHtml() {
    const chars = getStorage(CHAR_LIST_KEY, { names: [] });
    const out = [];
    for (const n of (chars.names || [])) {
        const cd = getStorage(charKey(n), null);
        if (!cd) continue;   // 索引残留但角色档已删 → 不显示
        const alive = typeof cd._deathCount === 'number' ? Math.max(0, (cd.day || 1) - (cd._deathCount || 0)) : 0;
        out.push(`<option value="${escHtml(n)}">${n} · 存活${alive}天</option>`);
    }
    return out.join('');
}
// 世界列表选项（名称/难度/天数）
// v3.66 修复"绑定成功返回后存档预览界面显示'暂无存档'"：原实现依赖 namespace 推断（u:<username>:wasteland_world_），
// 一旦 session 在创建/读取之间变化（登录态切换/__guest__ 与真实用户互转）就找不到刚才创建的世界。
// 改为用独立索引 `wasteland_worlds_index` 直接按 worldKey(seed) 读取，不再依赖 namespace 推断；
// 创建世界时调用 addWorldToIndex 同步追加。
function startWorldOptionsHtml() {
    const list = [];
    // ① 优先：读 wasteland_worlds_index（独立索引，可靠）
    const idx = getStorage('wasteland_worlds_index', null);
    const tried = new Set();
    if (idx && Array.isArray(idx.list)) {
        for (const seed of idx.list) {
            tried.add(seed);
            const wd = getStorage(worldKey(seed), null);
            if (wd && typeof wd.seed === 'number') {
                list.push({ seed: wd.seed, name: wd.name || ('世界 #' + wd.seed), diff: wd.difficulty || 'normal', day: wd.day || 1 });
            }
        }
    }
    // ② Fallback：遍历 localStorage 找任意 namespace 下的 wasteland_world_（兜底"老档" / 索引缺失）
    for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        if (!full || !full.includes('wasteland_world_')) continue;
        // 提取 seed（key 最后一段数字）
        const m = full.match(/wasteland_world_(\d+)$/);
        if (!m) continue;
        const seed = Number(m[1]);
        if (tried.has(seed) || !seed) continue;
        try {
            const d = JSON.parse(localStorage.getItem(full));
            if (!d || typeof d.seed !== 'number') continue;
            list.push({ seed: d.seed, name: d.name || ('世界 #' + d.seed), diff: d.difficulty || 'normal', day: d.day || 1 });
        } catch { /* 损坏键跳过 */ }
    }
    list.sort((a, b) => (b.seed - a.seed));
    const diffName = { normal: '软核', hardcore: '硬核' };   // v3.62 正常改名软核
    return list.map(w =>
        `<option value="${w.seed}">${escHtml(w.name)} · 第${w.day}天 · ${diffName[w.diff] || '软核'}</option>`).join('');
}
// v3.66 独立索引：创建世界时追加 seed 到 wasteland_worlds_index 索引（不依赖 namespace 推断）
function addWorldToIndex(seed) {
    const idx = getStorage('wasteland_worlds_index', { list: [] });
    if (!Array.isArray(idx.list)) idx.list = [];
    if (!idx.list.includes(seed)) {
        idx.list.push(seed);
        setStorage('wasteland_worlds_index', idx);
    }
}
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// 2026-08-09 修复"删除所有存档后开始游戏仍显示痕迹"：清理指向已不存在存档的残留缓存
// （选中缓存 ws_save_sel_char/world + profile 组合），让开始弹窗只反映真实存在的存档。
function cleanupStaleSaveCache() {
    // ① ws_save_sel_world 指向的世界档已不存在 → 清掉
    const selWorld = getStorage('ws_save_sel_world', null);
    if (selWorld != null) {
        const wd = getStorage(worldKey(selWorld), null);
        if (!wd) setStorage('ws_save_sel_world', null);
    }
    // ② ws_save_sel_char 指向的角色档已不存在 → 清掉
    const selChar = getStorage('ws_save_sel_char', null);
    if (selChar != null && !getStorage(charKey(selChar), null)) setStorage('ws_save_sel_char', null);
    // ③ profile 组合：worldSeed/characterName 指向已删除存档 → 置空，防开始游戏误读旧档
    const prof = getStorage(PROFILE_KEY, null);
    if (prof) {
        let dirty = false;
        if (prof.worldSeed != null && !getStorage(worldKey(prof.worldSeed), null)) { prof.worldSeed = null; dirty = true; }
        if (prof.characterName && !getStorage(charKey(prof.characterName), null)) { prof.characterName = null; dirty = true; }
        if (dirty) setStorage(PROFILE_KEY, prof);
    }
}

function renderStartDialog() {
    const el = document.getElementById('wsl-start');
    if (!el) return;
    // 2026-08-09 修复"删除所有存档后开始游戏仍显示痕迹"：每次打开弹窗都校验并清理
    // 指向【已不存在存档】的残留缓存（ws_save_sel_* 选中缓存 / profile 组合），
    // 避免删除存档后下拉框/预览区残留旧角色世界名。
    cleanupStaleSaveCache();
    const ws = el.querySelector('#wsl-start-world');
    // 兼容旧数据：读工坊曾记录的选中世界（2026-08-09 起角色选择权限关闭，只由世界绑定）
    const selWorld = getStorage('ws_save_sel_world', null);
    if (ws) {
        const keep = ws.value && [...ws.options].some(o => o.value === ws.value) ? ws.value : (selWorld != null ? String(selWorld) : null);
        ws.innerHTML = startWorldOptionsHtml();
        if (keep && [...ws.options].some(o => o.value === keep)) ws.value = keep;
        // v3.94 一个世界都没有时下拉框与创建绑定角色按钮禁用（仅创建新世界按钮可点 → 引导用户去创建）：
        const noWorld = ws.options.length === 0;
        ws.disabled = noWorld;
        ws.style.opacity = noWorld ? 0.45 : 1;
        ws.style.cursor = noWorld ? 'not-allowed' : '';
    }
    const ok = el.querySelector('#wsl-start-ok');
    const hint = el.querySelector('#wsl-start-hint');
    const seed = ws && ws.value ? Number(ws.value) : 0;
    const wd = seed ? getStorage(worldKey(seed), null) : null;
    const boundChar = wd && wd.characterName ? wd.characterName : null;
    const hasChar = boundChar && getStorage(charKey(boundChar), null) != null;
    const ready = !!(ws && ws.value) && !!hasChar;   // 世界 + 已绑定角色才可开始
    // 继续游戏 / 开始游戏共用一个按钮位置（2026-08-09 用户要求）：
    // 已选世界游玩过（旧存档）→ 显示「继续游戏」直接进入；新建/未游玩 → 显示「开始游戏」弹单机/联机选择。
    let mode = 'start';
    if (ready && ws && ws.value) {
        if (wd && (wd.playT > 0 || (wd.day || 1) > 1)) mode = 'continue';
    }
    if (ok) {
        ok.disabled = !ready;   // 世界 + 已绑定角色才可操作
        ok.dataset.mode = mode;
        ok.textContent = mode === 'continue' ? '继续游戏 ▶' : '开始游戏 ▶';
        ok.style.borderColor = mode === 'continue' ? '#4da3ff' : '#39d98a';
        ok.style.color = mode === 'continue' ? '#4da3ff' : '#39d98a';
        ok.style.background = mode === 'continue' ? '#1a2a3a' : '#123d2c';
    }
    if (hint) {
        if (!ws || !ws.value) hint.textContent = '请先选择世界';
        else if (!hasChar) hint.textContent = '此世界尚未绑定角色 —— 点击「创建绑定角色」完成绑定';
        else hint.textContent = mode === 'continue'
            ? '此世界已创建绑定角色 —— 点击继续游戏继续征程'
            : '此世界已创建绑定角色 —— 点击开始游戏开启征程';
    }
    // 2026-08-09：左侧角色预览随世界选择实时刷新（角色由世界绑定唯一决定）
    updateStartPreview();
}
// 继续游戏：用已选角色+世界直接进入（不再弹单机/联机选择，2026-08-09）
// 从世界绑定读取角色名（2026-08-09：角色选择权限关闭，角色由世界绑定唯一决定）
function boundCharName(seed) {
    const wd = seed ? getStorage(worldKey(seed), null) : null;
    return (wd && wd.characterName) ? wd.characterName : null;
}
function continueGameConfirm() {
    const el = document.getElementById('wsl-start');
    if (!el) return;
    const seed = Number(el.querySelector('#wsl-start-world').value);
    const charName = boundCharName(seed);
    if (!seed || !charName) { log('请先选择世界（须已绑定角色）', '#FFB347'); return; }
    cancelStartPreview();
    // v3.66 继续游戏也走淡出（保持视觉一致性）
    el.style.transition = 'opacity 0.6s ease';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    // v3.78 进入游戏默认全屏（点击手势内请求，与开始游戏一致）
    if (document.documentElement && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
    const worldData = getStorage(worldKey(seed), null);
    const diff = (worldData && worldData.difficulty) || 'normal';
    // 继续游戏复用上次模式（若 worldData 有 multiplayer 字段，否则默认单人）
    const baseOpts = { characterName: charName, seed, difficulty: diff, multiplayer: !!(worldData && worldData.multiplayer) };
    // v3.78 与开始游戏同一套平滑流程：bg-fx 淡出 + 显示 game-screen + 清除 _bgFxPrevScreen
    // （避免 bg-fx 淡出结束时恢复创意工坊 screen 弹出）+ 加载动画淡入/淡出衔接游戏画面。
    // v3.78 全面加固：点击瞬间就清空记录，杜绝任何时机恢复创意工坊 screen。
    clearBgFxPrevScreen();
    destroyBgFx(1.4);
    setTimeout(() => {
        el.remove();
        document.querySelectorAll('.screen').forEach(s => { if (s.id !== 'game-screen') s.classList.add('hidden'); });
        const gsEl = document.getElementById('game-screen');
        if (gsEl) gsEl.classList.remove('hidden');
        document.getElementById('top-bar')?.classList.add('hidden');
        document.getElementById('bot-bar')?.classList.add('hidden');
        document.getElementById('tr-sidebar')?.classList.add('hidden');
        // v3.78 关键：显示 game-screen 后立即强制销毁 bg-fx——守卫（inGame=true）保证
        // 不恢复被隐藏的创意工坊 screen；同时清除记录，杜绝"创意工坊 UI 弹出一下"。
        clearBgFxPrevScreen();
        destroyBgFxNow();
        // v3.100 提前进入局内：世界在加载动画【一开始】就构建并渲染（睁眼延迟 deferWake），
        // 加载层淡出时直接露出已渲染好的世界 + 睁眼动画衔接 → 草地不再"进去才变色"。
        // 单人路径提前启动；联机路径保持原时序（需要握手，不提前）。
        if (!baseOpts.multiplayer) {
            if (_startDialogCb && _startDialogCb.onLaunch) _startDialogCb.onLaunch({ ...baseOpts, deferWake: true });
            else enterWasteland({ ...baseOpts, deferWake: true });
        }
        // v4.2 加载层【立即黑屏不透明】（fadeIn:0）：v4.1 已把世界提前渲染在加载层底下，
        // 若 fadeIn 从透明淡入会在 0.5s 内透出游戏画面（用户看到"闪过游戏内画面"）。
        // 改为黑屏直接盖住 → 点击开始 → 全屏 → 黑屏 → 沙漠过渡动画（睁眼抬头看太阳）。
        showLoadingOverlay({
            durMs: 10000,
            variant: 'sandstorm',
            scope: document.getElementById('game'),
            fadeIn: 0,
            fadeOut: 0.6,
            onDone: () => {
                if (baseOpts.multiplayer) {
                    if (_startDialogCb && _startDialogCb.onLaunch) _startDialogCb.onLaunch(baseOpts);
                    else enterWasteland(baseOpts);
                } else {
                    startWakeAfterLoad();   // v3.100 加载层淡出前启动睁眼动画
                }
            },
        });
    }, 600);
}
function startGameConfirm(mode) {
    // v3.66 游玩模式合并到开始游戏界面：mode 来自 buildStartDialog 中按钮（'sp' / 'mp'）；
    // 未选必弹提示（不再弹 showPlayModeDialog）。
    const el = document.getElementById('wsl-start');
    if (!el) return;
    const seed = Number(el.querySelector('#wsl-start-world').value);
    const charName = boundCharName(seed);
    if (!seed || !charName) {
        log('请先创建世界/角色', '#FFB347');
        showToast('请先创建世界/角色，再选择游玩模式', '#FFB347');
        return;
    }
    if (!mode || (mode !== 'sp' && mode !== 'mp')) {
        showToast('请选择游玩模式（单人 / 多人联机）', '#FFB347');
        el.querySelectorAll('.wsl-start-mode').forEach(x => { x.style.borderColor = '#ff5544'; });
        setTimeout(() => paintModeOn(el), 1200);
        return;
    }
    cancelStartPreview();
    // v3.66 开始游戏界面缓慢淡出 → 过渡到睁眼效果（粒子背景在过渡完后销毁，避免遮挡游戏画面）
    el.style.transition = 'opacity 0.6s ease';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    // v3.78 用户要求"进入游戏默认全屏"：在点击手势同步栈内立即请求全屏（全屏 API 必须在
    // 用户手势中调用，10 秒加载动画后再调会被浏览器拒绝）——加载动画与游戏画面全程全屏一致。
    if (document.documentElement && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
    // 读世界档难度（锁定）
    const worldData = getStorage(worldKey(seed), null);
    const diff = (worldData && worldData.difficulty) || 'normal';
    // v4.13 更新最近登录时间
    if (worldData) {
        worldData.lastLoginTime = Date.now();
        setStorage(worldKey(seed), worldData);
    }
    const baseOpts = { characterName: charName, seed, difficulty: diff, multiplayer: mode === 'mp' };
    // v3.76 点开始游戏过渡：背景层立刻开始"散开变淡"（粒子加速 + 渐白蒙层 0.6s），
    // 600ms 后进入加载动画，动画结束进入游戏 → 睁眼动画衔接。
    // v3.78 平滑过渡：bg-fx 粒子淡出延长到 1.4s，与加载层 fadeIn(0.5s) 重叠——
    // "粒子背景渐隐 + 加载画面渐显"消除硬切；加载层结束 fadeOut(0.6s) 从白色渐隐露出游戏画面。
    // v3.78 全面加固：点击瞬间就清空 bg-fx 的"被隐藏 screen"记录——此后无论 bg-fx 在
    // 何时、以何种方式（淡出自然结束/强制销毁/异常）销毁，都【不会】恢复创意工坊 screen。
    clearBgFxPrevScreen();
    destroyBgFx(1.4);
    setTimeout(() => {
        el.remove();
        // v3.78 用户要求"登录界面和游戏界面画布一样大"：先显示游戏画面容器（黑底 16:9 画布），
        // 并隐藏上下栏使其与游戏画面最终布局一致，加载动画贴合 #game 画布显示区域 →
        // 动画结束时切入游戏画面尺寸/位置一致，无跳变。
        // 手动切 hidden 而不走 showScreen('game')，避免提前停掉菜单 BGM。
        document.querySelectorAll('.screen').forEach(s => { if (s.id !== 'game-screen') s.classList.add('hidden'); });
        const gsEl = document.getElementById('game-screen');
        if (gsEl) gsEl.classList.remove('hidden');
        document.getElementById('top-bar')?.classList.add('hidden');
        document.getElementById('bot-bar')?.classList.add('hidden');
        document.getElementById('tr-sidebar')?.classList.add('hidden');
        // v3.78 关键：显示 game-screen 后立即强制销毁 bg-fx——守卫（inGame=true）保证
        // 不恢复被隐藏的创意工坊 screen；同时清除记录，杜绝"创意工坊 UI 弹出一下"。
        clearBgFxPrevScreen();
        destroyBgFxNow();
        // v3.100 提前进入局内：世界在加载动画【一开始】就构建并渲染（睁眼延迟 deferWake），
        // 加载层淡出时直接露出已渲染好的世界 + 睁眼动画衔接 → 草地不再"进去才变色"。
        // 单人路径提前启动；联机路径保持原时序（需要握手，不提前）。
        if (!baseOpts.multiplayer) {
            if (_startDialogCb && _startDialogCb.onLaunch) _startDialogCb.onLaunch({ ...baseOpts, deferWake: true });
            else enterWasteland({ ...baseOpts, deferWake: true });
        }
        // v4.2 加载层【立即黑屏不透明】（fadeIn:0）：同上，防止 v4.1 提前渲染的世界透出。
        showLoadingOverlay({
            durMs: 10000,
            variant: 'sandstorm',
            scope: document.getElementById('game'),
            fadeIn: 0,    // v4.2 立即黑屏（v4.1 提前渲染世界后不可淡入透出）
            fadeOut: 0.6,   // 结束后加载层淡出露出已渲染好的游戏画面
            onDone: () => {
                if (baseOpts.multiplayer) {
                    if (_startDialogCb && _startDialogCb.onLaunch) _startDialogCb.onLaunch(baseOpts);
                    else enterWasteland(baseOpts);
                } else {
                    startWakeAfterLoad();   // v3.100 加载层淡出前启动睁眼动画
                }
            },
        });
    }, 600);
}
// 重新绘制模式按钮样式（用于必选校验后清除红框提示）
function paintModeOn(el) {
    const cur = el.dataset.startMode || '';
    el.querySelectorAll('.wsl-start-mode').forEach(x => {
        const isOn = (x.dataset.mode === cur);
        if (isOn) { x.style.background = '#123d2c'; x.style.borderColor = '#39d98a'; x.style.color = '#8dffc4'; x.style.boxShadow = '0 0 10px rgba(57,217,138,0.4)'; }
        else { x.style.background = '#141c22'; x.style.borderColor = '#2a3a33'; x.style.color = '#7a8a92'; x.style.boxShadow = 'none'; }
    });
}
// ================= v3.92 加载遮罩（掩盖创建绑定角色切换卡顿） =================
// 每次点击「创建绑定角色」：reveal 前先显示全屏加载遮罩（盖住开始弹窗与 bg-fx 背景 → 卡顿
// 过程用户只看到"加载中"而看不到背景掉帧），捏脸在遮罩下完成显示（layout/paint），
// 加载动画展示后再淡出遮罩 → 露出已就绪的角色创建界面。
let _wslLoadingMask = null;
let _wslLoadingTimer = null;
function ensureWslLoadingStyles() {
    if (document.getElementById('wsl-loading-style')) return;
    const st = document.createElement('style');
    st.id = 'wsl-loading-style';
    st.textContent = `
        @keyframes wslLoadSpin { to { transform: rotate(360deg); } }
        @keyframes wslLoadDots { 0%,20% { opacity:.2; } 50% { opacity:1; } 100% { opacity:.2; } }
        .wsl-load-ring { width:54px;height:54px;border:3px solid rgba(216,168,106,.22);border-top-color:#d8a86a;border-radius:50%;animation:wslLoadSpin .9s linear infinite;box-shadow:0 0 14px rgba(216,168,106,.25); }
        .wsl-load-dots span { animation:wslLoadDots 1.2s infinite; }
        .wsl-load-dots span:nth-child(2){ animation-delay:.2s; }
        .wsl-load-dots span:nth-child(3){ animation-delay:.4s; }
        .wsl-load-dots span:nth-child(4){ animation-delay:.6s; }`;
    document.head.appendChild(st);
}
function showWslLoading() {
    ensureWslLoadingStyles();
    window.__wslAnimBlocked = true;   // v4.3 加载遮罩期间锁定所有操作
    if (_wslLoadingMask && _wslLoadingMask.isConnected) { _wslLoadingMask.style.opacity = '1'; return; }
    const m = document.createElement('div');
    m.id = 'wsl-loading-mask';
    m.style.cssText = 'position:fixed;inset:0;z-index:1300;background:rgba(9,7,5,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;';
    m.innerHTML = `
        <div class="wsl-load-ring"></div>
        <div style="color:#e8c48a;font-size:22px;letter-spacing:8px;font-weight:600;text-shadow:0 0 10px rgba(216,168,106,.45);">正在唤醒捏脸台</div>
        <div class="wsl-load-dots" style="color:#c89454;font-size:16px;letter-spacing:6px;"><span>·</span><span>·</span><span>·</span><span>·</span></div>
        <div style="color:#8a6a42;font-size:13px;letter-spacing:3px;margin-top:6px;">尘沙翻涌 · 雕刻你的轮廓</div>`;
    document.body.appendChild(m);
    _wslLoadingMask = m;
}
function hideWslLoading(delay, onFadeStart) {
    clearTimeout(_wslLoadingTimer);
    _wslLoadingTimer = setTimeout(() => {
        const m = _wslLoadingMask;
        if (!m || !m.isConnected) {
            window.__wslAnimBlocked = false;
            if (typeof onFadeStart === 'function') onFadeStart();
            return;
        }
        _wslLoadingMask = null;
        // v4.4 遮罩【开始淡出】时立即回调 onFadeStart（新界面同时淡入，无缝重叠过渡）：
        // 不再等遮罩完全移除才触发（否则"遮罩消失→空屏→捏脸啪地弹出"很生硬）。
        if (typeof onFadeStart === 'function') onFadeStart();
        m.style.transition = 'opacity .35s ease';
        m.style.opacity = '0';
        setTimeout(() => {
            if (m.parentNode) m.parentNode.removeChild(m);
            window.__wslAnimBlocked = false;   // 遮罩完全移除后才解除锁
        }, 360);
    }, delay || 0);
}
// 创建绑定角色：为当前选中的世界创建角色并绑定（世界↔角色强绑定）
// v3.76 合并命名+捏脸为一个界面：直接打开捏脸（顶部带角色名输入框），
// 确认时校验名字 → 保存角色 → 绑定世界 → 回开始弹窗（可直接点"开始游戏"）
function startBoundCharacter() {
    const el = document.getElementById('wsl-start');
    const ws = el && el.querySelector('#wsl-start-world');
    const seed = ws ? Number(ws.value) : 0;
    if (!seed) { log('请先选择世界', '#FFB347'); return null; }
    cancelStartPreview();   // v3.81 停掉隐藏开始弹窗的预览 RAF，避免捏脸界面卡顿
    // v3.82 预构建模式：构建捏脸 DOM（隐藏）并返回 reveal 函数，由 animateDialogSwap
    // 在旧弹窗上弹结束后调用 → 同步构建卡顿被藏进上弹动画时段（此处不再隐藏开始弹窗）。
    // v3.90 showLookCreator 返回本次 reveal 闭包（精确引用实例，不依赖 querySelector 选实例）
    const revealLook = showLookCreator(null, randomLook(), {
        name: '',
        onCancel: () => { const s = document.getElementById('wsl-start'); if (s) { s.style.display = 'flex'; revealDialog(s); } },   // 返回 → 恢复开始弹窗（缓缓显现）
        onDone: (name, look) => {
            // 重名检查：重名则加后缀
            let finalName = name;
            const list = getStorage(CHAR_LIST_KEY, { names: [] });
            let k = 2;
            while (list.names.includes(finalName)) finalName = name + '_' + (k++);
            showToast('角色定制成功');   // v3.62 反馈 UI：捏脸完成后
            const cd = {
                name: finalName, character: look,
                inv: Array(Panel.BAG_SIZE).fill(null), hotbar: Array(HOTBAR_SIZE).fill(null),
                curSlot: 'ranged', hp: B.MAX_HP, maxHp: B.MAX_HP,
                food: B.HUNGER_MAX, water: B.WATER_MAX, infection: 0,
                stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
                day: 1, _deathCount: 0,
            };
            setStorage(charKey(finalName), cd);
            updateCharList(finalName);
            // 绑定到当前世界
            const wd = getStorage(worldKey(seed), null);
            if (wd) {
                wd.characterName = finalName;
                setStorage(worldKey(seed), wd);
                log(`角色「${finalName}」已创建并绑定到该世界`, '#7DFF7D');
            } else {
                log(`角色「${finalName}」已创建`, '#7DFF7D');
            }
            // v4.13 绑定世界后再刷新创意工坊存档管理列表（确保显示已绑定状态）
            if (typeof window.__wslWorkshopRefresh === 'function') window.__wslWorkshopRefresh();
            showToast('角色创建并绑定成功');   // v3.62 反馈 UI：绑定完成（存档已落盘）
            // v3.64 反馈 UI：再次提示存档已自动保存（点取消时可在开始界面看到该存档）
            // showToast 内部排队显示，两个反馈依次淡入淡出
            showToast('存档已自动保存');
            const s = document.getElementById('wsl-start');
            if (s) { s.style.display = 'flex'; revealDialog(s); renderStartDialog(); }
        },
    }, { deferReveal: true });
    // v3.82/v3.90 返回 reveal：旧弹窗上弹结束后隐藏开始弹窗 + 触发本次捏脸淡入
    //（用 showLookCreator 返回的闭包引用，杜绝 querySelector 多实例/时序选错 → 界面消失）
    // v3.92/v3.93 遮罩已由点击瞬间 showWslLoading() 显示（t=0），此处 ensure 幂等。
    // v4.3 加载动画期间全锁；v4.4 遮罩【开始淡出】的瞬间就 reveal 捏脸（onFadeStart）——
    // 捏脸 0.32s 淡入与遮罩 0.35s 淡出【重叠过渡】，无缝衔接不再"啪地弹出"。
    // 锁仍在遮罩完全移除后才解除（v4.3）。
    return () => {
        const s = document.getElementById('wsl-start');
        if (s) s.style.display = 'none';
        showWslLoading();                        // 幂等：遮罩已存在则保持不透明（并锁定）
        hideWslLoading(400, () => {              // 遮罩开始淡出的瞬间：
            if (typeof revealLook === 'function') revealLook();   // 捏脸同时淡入
        });
    };
}
// 创建新角色：命名+捏脸合并为一个界面 → 保存（不进游戏）→ 回弹窗
// v3.76 与 startBoundCharacter 同款合并：直接打开带名字输入框的捏脸界面
function startNewCharacter() {
    cancelStartPreview();   // v3.81 停掉隐藏开始弹窗的预览 RAF
    const el = document.getElementById('wsl-start');
    if (el) el.style.display = 'none';
    showLookCreator(null, randomLook(), {
        name: '',
        onCancel: () => { const s = document.getElementById('wsl-start'); if (s) s.style.display = 'flex'; },   // 返回 → 恢复开始弹窗
        onDone: (name, look) => {
            // 重名检查：重名则加后缀
            let finalName = name;
            const list = getStorage(CHAR_LIST_KEY, { names: [] });
            let k = 2;
            while (list.names.includes(finalName)) finalName = name + '_' + (k++);
            const cd = {
                name: finalName, character: look,
                inv: Array(Panel.BAG_SIZE).fill(null), hotbar: Array(HOTBAR_SIZE).fill(null),
                curSlot: 'ranged', hp: B.MAX_HP, maxHp: B.MAX_HP,
                food: B.HUNGER_MAX, water: B.WATER_MAX, infection: 0,
                stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
                day: 1, _deathCount: 0,
            };
            showToast('角色定制成功');   // v3.62 反馈 UI：捏脸完成后
            setStorage(charKey(finalName), cd);
            updateCharList(finalName);
            log(`角色「${finalName}」已创建（物品与属性随角色保留）`, '#7DFF7D');
            const s = document.getElementById('wsl-start');
            if (s) { s.style.display = 'flex'; renderStartDialog(); }
        },
    });
}
// ================= v3.80 弹窗切换动画 =================
// 点按钮弹出下一个 UI：当前弹窗【向上弹出】（opacity 淡出 + 卡片上移）→
// 下一个弹窗在屏幕中央【缓缓淡入】。
// 动画施加在【内容卡片】上（而非全屏遮罩外层）——避免 transform 让外层成为 containing block、
// 破坏弹窗内 position:fixed 子元素定位。
// 约定：弹窗元素用 [data-wsl-card] 标记内容卡片（可被 transform 动画），外层遮罩不带 transform。
function animateDialogSwap(hideFn, showFn) {
    // v3.81 修复：原实现固定优先 #wsl-start（它即使 display:none 仍在 DOM），
    // 导致"创建世界→返回开始界面"时对【隐藏的】开始弹窗播动画，而当前【可见的】
    // 创建世界弹窗没有任何上弹动画、直接消失 → 表现为"没有界面过渡动画"。
    // 改为优先当前【可见】弹窗（跳过 display:none 节点）。
    const visible = el => !!(el && el.isConnected && el.style.display !== 'none');
    const wc = document.getElementById('wsl-world-create');
    const look = document.querySelector('[data-wsl-dialog]');
    const start = document.getElementById('wsl-start');
    const cur = (visible(wc) && wc) || (visible(look) && look) || (visible(start) && start) || null;
    const box = cur;
    // v3.82 预构建状态：showFn 是否已在动画期间执行 + 是否返回 reveal 函数
    let showCalled = false;
    let prebuilt = null;
    if (box) {
        // 找内容卡片（若弹窗结构有卡片标记则动画卡片；否则整体 opacity 淡出）
        const card = box.querySelector('[data-wsl-card]') || box;
        card.style.transition = 'opacity 0.24s ease, transform 0.24s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateY(-26px)';   // 向上弹出
        // v3.82 上弹动画期间【预构建】新界面（隐藏）：把同步 DOM 构建卡顿藏进动画时段，
        // 动画结束后直接 reveal（淡入）→ 根治"开始游戏→捏脸界面卡卡的"。
        // showFn 若返回函数（如 startBoundCharacter 返回 reveal）则用其淡入；
        // 不返回（如 startNewWorld 自带 revealDialog）则已构建完毕，doShow 不再重复执行。
        if (typeof showFn === 'function') {
            setTimeout(() => {
                const r = showFn();
                showCalled = true;
                if (typeof r === 'function') prebuilt = r;
            }, 30);
        }
        setTimeout(() => {
            if (box.id === 'wsl-start') box.style.display = 'none';   // 开始弹窗保留节点
            else if (box.parentNode) box.parentNode.removeChild(box); // 其它弹窗移除
            doShow();
        }, 260);
    } else {
        doShow();
    }
    function doShow() {
        if (typeof hideFn === 'function') hideFn();
        if (showCalled) {
            // 已预构建：返回了 reveal 则调用（隐藏旧弹窗 + 新界面淡入）
            if (typeof prebuilt === 'function') prebuilt();
        } else if (typeof showFn === 'function') {
            // 无旧弹窗分支（直接切换）：让出主线程一帧再构建
            setTimeout(() => showFn(), 30);
        }
    }
}
// 让刚创建的弹窗内容卡片在屏幕中央缓缓淡入（opacity 0→1 + 轻微上浮归位）
function revealDialog(el) {
    if (!el) return;
    el.style.display = 'flex';
    el.style.opacity = '1';   // v3.84 防御：确保外层遮罩可见（曾有路径残留外层 opacity:0 → 弹窗透明无界面）
    const card = el.querySelector('[data-wsl-card]') || el;
    card.style.opacity = '0';
    card.style.transition = 'opacity 0.32s ease, transform 0.32s ease';
    card.style.transform = 'translateY(14px)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!el || !el.isConnected) return;
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
    }));
}
// 创建新世界：命名/随机 + 选难度 → 保存记录（不进游戏）→ 回弹窗（难度锁定）
function startNewWorld() {
    const wInput = document.createElement('div');
    wInput.dataset.wslDialog = '1';   // 标记弹窗，便于切换动画定位
    wInput.id = 'wsl-world-create';
    wInput.innerHTML = `
        <div data-wsl-card="1" style="position:fixed;inset:0;z-index:1260;background:transparent;display:flex;align-items:center;justify-content:center;font-family:'Microsoft YaHei',monospace;">
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 32px;width:640px;box-shadow:0 0 40px rgba(57,217,138,0.25);max-width:94vw;">
            <div style="text-align:center;color:#39d98a;font-size:22px;letter-spacing:6px;margin-bottom:18px;">◈ 创建新世界 ◈</div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:8px;">世界名称（必填，可点 🎲 随机）：</div>
            <div style="display:flex;gap:10px;margin-bottom:16px;">
                <input id="wsl-nw-name" maxlength="16" placeholder="输入名称或点 🎲 随机" style="flex:2;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:10px;color:#dce6e2;font-size:15px;">
                <button id="wsl-nw-rnd" style="flex:1;background:#1a2a3a;border:1px solid #4da3ff;color:#4da3ff;border-radius:6px;cursor:pointer;font-size:14px;padding:10px;">🎲 随机</button>
            </div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:8px;">世界种子（必填，可点 🎲 随机）：</div>
            <div style="display:flex;gap:10px;margin-bottom:16px;">
                <input id="wsl-nw-seed" type="number" placeholder="请输入种子数字（如 20260813）" style="flex:2;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:10px;color:#dce6e2;font-size:15px;">
                <button id="wsl-nw-seed-rnd" style="flex:1;background:#1a2a3a;border:1px solid #4da3ff;color:#4da3ff;border-radius:6px;cursor:pointer;font-size:14px;padding:10px;">🎲 随机种子</button>
            </div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:8px;">世界难度（创建后锁定，不可修改）：</div>
            <div style="display:flex;gap:10px;margin-bottom:22px;">
                <button class="wsl-nw-diff" data-diff="normal" style="flex:1;background:#141c22;border:2px solid #2a3a33;color:#7a8a92;border-radius:6px;padding:12px;cursor:pointer;font-size:15px;">软核</button>
                <button class="wsl-nw-diff" data-diff="hardcore" style="flex:1;background:#141c22;border:2px solid #2a3a33;color:#7a8a92;border-radius:6px;padding:12px;cursor:pointer;font-size:15px;">硬核</button>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="wsl-nw-back" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:10px;cursor:pointer;font-size:14px;">返回</button>
                <button id="wsl-nw-ok" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:10px;cursor:pointer;font-size:14px;">创建世界 ✓</button>
            </div>
        </div></div>`;
    document.body.appendChild(wInput);
    attachParticleBg(wInput);   // v3.62 创建世界弹窗同风格粒子背景
    revealDialog(wInput);       // v3.80 屏幕中央缓缓显现
    let diff = '';
    // v3.62 难度按钮：初始全未选（中性样式）；点击软核变绿、硬核变红（单选高亮+变色）
    // v3.67 难度必选：未选时点"创建世界"弹「请选择游戏难度」
    const paintDiff = () => {
        wInput.querySelectorAll('.wsl-nw-diff').forEach(x => {
            const on = x.dataset.diff === diff;
            if (x.dataset.diff === 'hardcore') {
                x.style.background = on ? '#2a1414' : '#141c22';
                x.style.borderColor = on ? '#ff5544' : '#2a3a33';
                x.style.color = on ? '#ff8a7a' : '#7a8a92';
                x.style.boxShadow = on ? '0 0 12px rgba(255,85,68,0.45)' : 'none';
            } else {
                x.style.background = on ? '#123d2c' : '#141c22';
                x.style.borderColor = on ? '#39d98a' : '#2a3a33';
                x.style.color = on ? '#8dffc4' : '#7a8a92';
                x.style.boxShadow = on ? '0 0 12px rgba(57,217,138,0.45)' : 'none';
            }
        });
    };
    wInput.querySelector('#wsl-nw-rnd').addEventListener('click', () => {
        wInput.querySelector('#wsl-nw-name').value = randomName('');
        wInput.querySelector('#wsl-nw-name').style.borderColor = '#2a3a33';
    });
    // v3.80 世界种子：随机种子按钮 → 填入随机种子数字
    wInput.querySelector('#wsl-nw-seed-rnd').addEventListener('click', () => {
        wInput.querySelector('#wsl-nw-seed').value = String(Math.floor(Math.random() * 0x7fffffff));
    });
    wInput.querySelectorAll('.wsl-nw-diff').forEach(b => b.addEventListener('click', () => {
        diff = b.dataset.diff;
        paintDiff();
    }));
    const back = () => {
        // v3.80 返回也走动画：创建世界弹窗向上淡出 → 开始游戏弹窗缓缓显现
        // v3.84 修复"返回后没有任何界面弹出"：去掉 s.style.opacity='0'（外层 opacity 一旦为 0
        // 整个 #wsl-start 透明，而 revealDialog 只恢复内层卡片的 opacity，外层永远不会复原 →
        // 返回后开始游戏 UI 完全不可见）。淡入由 revealDialog 内部完成，外层无需也不应设 0。
        animateDialogSwap(() => {
            wInput.remove();
            const s = document.getElementById('wsl-start');
            if (s) { s.style.display = 'flex'; revealDialog(s); }
        }, null);
    };
    wInput.querySelector('#wsl-nw-back').addEventListener('click', back);
    wInput.querySelector('#wsl-nw-ok').addEventListener('click', () => {
        const raw = (wInput.querySelector('#wsl-nw-name').value || '').trim();
        if (!raw) {
            // v3.62 世界名称必填或随机：留空弹提示，不自动随机
            showToast('请输入世界名称', '#FFB347');
            const inp = wInput.querySelector('#wsl-nw-name');
            inp.style.borderColor = '#ff5544';
            inp.focus();
            return;
        }
        // v3.80/v3.96 世界种子校验【优先于难度】：
        // 用户要求：名称已填但种子与难度都缺时，优先弹出「请输入世界种子」（然后才是难度）。
        const seedRaw = (wInput.querySelector('#wsl-nw-seed')?.value || '').trim();
        if (!seedRaw) {
            showToast('请输入世界种子', '#FFB347');
            const seedInp = wInput.querySelector('#wsl-nw-seed');
            if (seedInp) { seedInp.style.borderColor = '#ff5544'; seedInp.focus(); }
            return;
        }
        // v3.67 难度必选：未选软核/硬核时弹「请选择游戏难度」+ 按钮红框提示
        if (!diff || (diff !== 'normal' && diff !== 'hardcore')) {
            showToast('请选择游戏难度', '#FFB347');
            wInput.querySelectorAll('.wsl-nw-diff').forEach(x => { x.style.borderColor = '#ff5544'; });
            setTimeout(() => paintDiff(), 1200);
            return;
        }
        const seed = (Number(seedRaw) >>> 0) || Math.floor(Math.random() * 0x7fffffff);
        const name = raw;
        setStorage(worldKey(seed), {
            seed, name, difficulty: diff,
            t: B.DAY_LEN * 0.35, day: 1, playT: 0,
            mods: { tiles: {}, chests: {}, boxLoot: {} },
            npcs: null, px: 0, py: 0, characterName: null,   // 创建世界后立即创建角色绑定（2026-08-09）
        });
        addWorldToIndex(seed);   // v3.66 同步独立索引（存档预览界面不依赖 namespace 推断）
        // v3.80 创建世界后立刻刷新创意工坊存档管理列表（无需刷新页面即可看见新世界）
        if (typeof window.__wslWorkshopRefresh === 'function') window.__wslWorkshopRefresh();
        log(`世界「${name}」已创建（${diff === 'normal' ? '软核' : '硬核'}难度 · 锁定不可改）`, '#7DFF7D');
        showToast('世界创建成功');   // v3.62 反馈 UI 淡入淡出
        // v3.80 创建世界成功 → 回到开始游戏 UI（不自动弹创建角色）：
        // 创建世界弹窗【向上弹出】→ 开始游戏弹窗【缓缓淡入】（世界下拉已选中新世界）。
        // 用户手动点「创建绑定角色」再进捏脸。
        const s = document.getElementById('wsl-start');
        if (s) {
            renderStartDialog();
            const ws2 = document.getElementById('wsl-start') && document.getElementById('wsl-start').querySelector('#wsl-start-world');
            if (ws2 && [...ws2.options].some(o => o.value === String(seed))) ws2.value = String(seed);
            updateStartPreview();
            s.style.display = 'flex';
        }
        // 创建世界弹窗向上弹出
        const wCard = wInput.querySelector('[data-wsl-card]') || wInput;
        wCard.style.transition = 'opacity 0.24s ease, transform 0.24s ease';
        wCard.style.opacity = '0';
        wCard.style.transform = 'translateY(-26px)';
        setTimeout(() => {
            if (wInput.parentNode) wInput.parentNode.removeChild(wInput);
            // 开始游戏弹窗缓缓淡入
            if (s) revealDialog(s);
        }, 250);
    });
}
// 游玩模式选择（点「开始游戏」后）：单人 / 多人联机
function showPlayModeDialog(baseOpts) {
    const el = document.createElement('div');
    el.id = 'wsl-playmode';
    el.style.cssText = 'position:fixed;inset:0;z-index:1270;background:transparent;display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
    el.innerHTML = `
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 30px;width:400px;box-shadow:0 0 40px rgba(57,217,138,0.25);">
            <div style="text-align:center;color:#39d98a;font-size:20px;letter-spacing:4px;margin-bottom:16px;">◈ 选择游玩模式 ◈</div>
            <div style="display:flex;gap:10px;">
                <button id="wsl-pm-solo" style="flex:1;background:#123d2c;border:2px solid #39d98a;color:#39d98a;border-radius:8px;padding:14px;cursor:pointer;font-size:15px;">单人游玩</button>
                <button id="wsl-pm-mp" style="flex:1;background:#1a2a3a;border:2px solid #4da3ff;color:#4da3ff;border-radius:8px;padding:14px;cursor:pointer;font-size:15px;">多人联机</button>
            </div>
            <div style="text-align:center;color:#7a8a92;font-size:12px;margin-top:12px;">选择角色：${escHtml(baseOpts.characterName)} · 世界难度：${baseOpts.difficulty === 'hardcore' ? '硬核' : '软核'}</div>
        </div>`;
    document.body.appendChild(el);
    attachParticleBg(el);   // v3.62 游玩模式弹窗同风格粒子背景
    el.querySelector('#wsl-pm-solo').addEventListener('click', () => {
        el.remove();
        if (_startDialogCb && _startDialogCb.onLaunch) _startDialogCb.onLaunch(baseOpts);
        else enterWasteland(baseOpts);
    });
    el.querySelector('#wsl-pm-mp').addEventListener('click', () => {
        el.remove();
        if (_startDialogCb && _startDialogCb.onLaunchMP) _startDialogCb.onLaunchMP('host', baseOpts);
        else import('./mpWasteland.js').then(m => m.startWastelandMP('host', baseOpts));
    });
}

// 角色创建弹窗：命名 + 捏脸合并为一个界面（v3.76），确认后回调 onDone(name, look)
// onCancel（可选）：返回时恢复上一个界面（缺省仅关闭，调用方自行处理）
export function showCreateCharacter(onDone, onCancel) {
    showLookCreator(null, randomLook(), {
        name: '',
        onCancel: onCancel || (() => {}),
        onDone: (name, look) => {
            showToast('角色定制成功');   // v3.62 反馈 UI：捏脸完成后
            onDone(name, look);
        },
    });
}

function startRun(opts) {
    // 普通玩家设置（workshop 荒原面板，无需开发者模式）：帧率显示 + 画质档
    if (opts.gfx != null) sv._devGfx = opts.gfx;
    sv._showFps = !!opts.showFps;
    // 难度两档归一：旧档（easy/hard/hell 四档时代）读档自动映射——
    // easy→normal（软）、hard/hell→hardcore（硬核一条命）
    const DIFF_LEGACY = { easy: 'normal', normal: 'normal', hard: 'hardcore', hell: 'hardcore' };
    sv.diffKey = B.DIFF_TABLE[opts.difficulty] ? opts.difficulty : (DIFF_LEGACY[opts.difficulty] || 'normal');
    // v4.5 进入局内立即按 day 同步季节：sv._season 默认 1（夏），若沿用默认会在第一次
    // updateWeather 时变更为 seasonAt(sv.day) 的真实季节 → 地面缓存 key(g.season) 变化 →
    // 草地重建颜色跳变（用户反馈"睁开眼才渲染完成、颜色跳变突兀"）。提前同步后首次渲染即正确。
    const seasonNow = B.seasonAt(sv.day);
    if (sv._season !== seasonNow) sv._season = seasonNow;
    WG.initWpn(sv, sv._savedMag);

    // 2026-08-12 v3.8 配方右键"使用"：解锁到拼字台（与左键 useItem 同一逻辑）
    Panel.initPanel({ onUse: useItem, onDrop: dropItem, onChestDrop: dropChestItem, onBatchOpen: batchOpenLoot,
        onRecipeUse: (i) => {
            const s = sv.inv[i];
            if (s && s.id.startsWith('recipe:')) useRecipe(s);
        } });
    showScreen('game');
    document.getElementById('top-bar')?.classList.add('hidden');
    document.getElementById('bot-bar')?.classList.add('hidden');
    document.getElementById('tr-sidebar')?.classList.add('hidden');

    sv.ctx = document.getElementById('game').getContext('2d');
    AudioSystem.startBGM('bgmDay');
    initInput();

    // 开发者标记生效（无敌/资源无限/一击必杀/伤害倍率）——存 profile；旧 SAVE_KEY 兜底
    const prof = getStorage(PROFILE_KEY, null);
    const saved = prof || getStorage(SAVE_KEY, null);
    if (saved) {
        sv._devGod = !!saved._devGod;
        sv._devInfStamina = !!saved._devInfStamina;
        sv._devInf = saved._devInf !== false;
        sv._devInfAmmo = !!saved._devInfAmmo;
        sv._devOneShot = !!saved._devOneShot;
        sv._devInfBag = !!saved._devInfBag;
        sv._devDmgMul = saved._devDmgMul || 1;
        sv._devTimeScale = saved._devTimeScale || 1;
        sv._devInfDura = !!saved._devInfDura;   // 2026-08-09 无限耐久（读档恢复）
        sv._devWind = saved._devWind != null ? saved._devWind : null;   // 2026-08-09 风向覆盖（读档恢复）
        if (WDEV.isDev() && sv._devGod) log('开发者：无敌模式已开启', '#FF6666');
        if (saved._devKillAll) {
            sv.zombies = [];
            const s2 = getStorage(SAVE_KEY, null);
            if (s2) { delete s2._devKillAll; setStorage(SAVE_KEY, s2); }
            log('开发者：僵尸已清屏', '#FF6666');
        }
    }
    WDEV.init(sv);
    // 2026-08-11 v2.99 新存档开场流程：先在荒野中醒来（睁眼动画），文字消失后再弹新手教程。
    // v4.7 统一开场：老存档（playT>0 / day>1）与旧版迁移档（_legacyNote）同样播睁眼动画，
    // 教程一律等"你在荒野中醒来…"文字消失后再弹出（时机与首次进档完全一致）。
    // v4.8 老档/迁移档的顶部欢迎提示（"欢迎回到荒原…"/"检测到旧版荒原存档…"）不再立即显示，
    // 改为存 _welcomeMsg，等睁眼动画（文字消失约 2.4s）结束后再显示——先睁眼、后欢迎提示。
    // 注：showIfFirstAfterWake 内部对已看过教程的存档零开销返回（v4.8 起按世界+角色粒度），
    // 因此老玩家继续游戏只播睁眼仪式、不会重复弹教程；新存档首次进局必弹教程（修复"新档不弹"）。
    if (sv._legacyNote) {
        sv._welcomeMsg = '检测到旧版荒原存档（已备份），已为你开启全新无限荒原！';
    } else if (sv.playT > 0 || sv.day > 1) {
        sv._welcomeMsg = `欢迎回到荒原 · 第 ${sv.day} 天`;
    } else {
        log('你醒来时，发现自己躺在一片荒原上……'); AudioSystem.playGameStart();
    }
    // 2026-08-09 昏迷苏醒过渡：刚醒来黑灰眨眼几次，期间不能移动，像素氛围更有代入感
    // 2026-08-12 v3.58 时长恢复 2.4s（用户定稿：创建角色苏醒/游戏结束重生统一 2.4 秒）
    // v3.100 提前加载：进入局内时世界已在加载动画期间构建渲染，睁眼动画延迟到
    // 加载层淡出前由 startWakeAfterLoad 启动（加载动画期间不播睁眼）。
    if (opts.deferWake) {
        sv._deferWake = true;
    } else {
        sv._wake = { t: 0, dur: 2.4 };
        // 2026-08-11 v2.99 教程等睁眼动画（文字消失，约 2.4s）结束后再弹出
        TUT.showIfFirstAfterWake(sv, 2500);
        showWelcomeAfterWake();
    }

    // v3.100 进局出生点周边无敌对生物：清掉出生点安全区内已有的僵尸（读档还原/初始残留），
    // 配合 nearSpawnScreen 安全区扩大（约 1.5 屏宽），保证玩家进局后周边安全。
    if (sv.zombies && sv.zombies.length) {
        sv.zombies = sv.zombies.filter(z => z && !B.nearSpawnScreen(SPAWN, z.x, z.y));
    }

    sv.last = performance.now();
    sv.raf = requestAnimationFrame(loop);
    startBgKeepAlive();
    // 全屏说明：v3.61 曾移除自动全屏（用户当时要求）；v3.78 用户改回"进入游戏默认全屏"——
    // 全屏请求放在 startGameConfirm 的点击手势内执行（浏览器要求手势触发），
    // 加载动画与游戏画面全程全屏一致；此处仍可用 F11 或暂停菜单"切换全屏"手动控制。
}

// v3.100 加载动画结束（加载层开始淡出）时启动睁眼动画：世界已在加载期间构建渲染，
// 睁眼从此刻开始（2.4s 苏醒过渡），教程在睁眼结束后再弹出。
function startWakeAfterLoad() {
    if (!sv) return;
    sv._deferWake = false;
    sv._wake = { t: 0, dur: 2.4 };
    TUT.showIfFirstAfterWake(sv, 2500);
    showWelcomeAfterWake();   // v4.8 老档/迁移档欢迎提示等睁眼结束后再显示
}

// v4.8 老档/迁移档的顶部欢迎提示延迟到睁眼文字消失后（约 2.5s）再显示：
// 先播"你在荒野中醒来…"睁眼动画，文字结束后才出现"欢迎回到荒原 · 第 X 天"。
// 若延迟期间已退出游戏（sv.active=false）则不再显示，避免主菜单弹出残留提示。
function showWelcomeAfterWake() {
    if (!sv || !sv._welcomeMsg) return;
    const m = sv._welcomeMsg;
    sv._welcomeMsg = null;
    setTimeout(() => { if (sv && sv.active) log(m); }, 2500);
}

export function exitWasteland(skipSave) {
    if (!sv) return;
    if (mpCleanupHook) { try { mpCleanupHook(); } catch (e) { console.error('[wasteland-mp] cleanup:', e); } }
    if (!skipSave && !sv.dead) flushSave();   // 退出：同步落盘（不经队列，防丢最后进度）
    sv.active = false;
    if (sv.raf) cancelAnimationFrame(sv.raf);
    stopBgKeepAlive();
    WDEV.destroy();
    WW.destroy();
    Panel.destroyPanel();
    // v3.65 用户要求"游戏结束后会关闭游戏中打开的所有UI界面"：
    // 关闭 WSearch 搜索框、扫描面板、拾取提示、死亡提示、死亡地点指引、announce、状态提示、拼字台、建造模式等。
    if (typeof WSearch !== 'undefined' && WSearch.closeSearch) { try { WSearch.closeSearch(sv, true); } catch(_){} }
    if (typeof Panel !== 'undefined' && Panel.hideDeath) { try { Panel.hideDeath(); } catch(_){} }
    if (typeof scanPanelOpen !== 'undefined') { try { scanPanelOpen = false; } catch(_){} }
    const _scanPanelEl = document.getElementById('wsl-scan-panel');
    if (_scanPanelEl) _scanPanelEl.remove();
    const _wsrchEl = document.getElementById('wsl-wsearch');
    if (_wsrchEl) _wsrchEl.remove();
    const _pickupEl = document.getElementById('wsl-pickup');
    if (_pickupEl) _pickupEl.remove();
    const _dwEl = document.getElementById('wsl-death-window');
    if (_dwEl) _dwEl.remove();
    // 清理 sv 上的 UI 临时态（避免下次开局残留）
    if (sv) {
        sv.announce = null;
        sv._lastDeathPos = null;
        sv.prompt = null;
        sv._wake = null;
        sv._scanHeld = false; sv._scanHeldAt = 0; sv._scanDone = false; sv._scanCooldownUntil = 0;
        sv.build = false;
    }
    if (pauseEl) { pauseEl.remove(); pauseEl = null; pauseOpen = false; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.getElementById('top-bar')?.classList.remove('hidden');
    document.getElementById('bot-bar')?.classList.remove('hidden');
    sv = null;
    showScreen('menu');
}

function tryExit() {
    if (Panel.anyOpen()) { Panel.hideBag(); Panel.hideChest(); return; }
    if (sv.build) { sv.build = false; return; }
    togglePause();
}

// 联机清理钩子：mpWasteland.js 注册自己的清理函数（注销监听/关 UI/Net.mp.close()），
// 使 exitWasteland 成为联机会话的完整生命周期出口（设计文档 §6-3 生命周期闭环）。
let mpCleanupHook = null;
export function setMpCleanupHook(fn) { mpCleanupHook = typeof fn === 'function' ? fn : null; }

// ================= 联机远端队友（sv.p2）=================
// mpWasteland.js 通过这三个导出与主循环交互（只依赖 survival 导出，符合 R5）：
//   getLocalPlayerState  —— 上报本机玩家状态（位置/朝向/动画/外观）
//   setRemotePlayerState —— 写入远端队友目标位置（渲染层插值平滑）
//   clearRemotePlayer    —— 断线清理
export function getLocalPlayerState() {
    if (!sv || !sv.active) return null;
    return {
        x: sv.px, y: sv.py,
        faceX: sv.faceX, faceY: sv.faceY,
        moving: !!sv.animMoving, frame: sv.animFrame || 0, run: !!sv.sprinting,
        hp: sv.hp, maxHp: sv.maxHp,
        character: sv.character || null,
        name: '玩家',
        swingT: sv.swingT || 0, swingDir: sv.swingDir || 0, swingWeapon: sv.swingWeapon || null,
        hurtT: sv.hurtT || 0, jump: !!sv.isJumping, jumpOffset: sv.jumpOffset || 0, dash: !!sv.dashing,
        driving: sv.driving ? { x: sv.driving.x, y: sv.driving.y, dir: sv.driving.dir, hp: sv.driving.hp, maxHp: sv.driving.maxHp } : null,
        guarding: !!sv.guarding, guardTimer: sv.guardTimer || 0, guardFacing: sv.guardFacing || 0,
        perfectFlash: sv.perfectFlash || 0, infection: sv.infection || 0,
        charging: !!(sv.wpn && sv.wpn.charging), chargeT: (sv.wpn && sv.wpn.chargeT) || 0,
        reloading: (sv.wpn && sv.wpn.reloading) || 0,
        inInterior: !!sv.interior,   // 室内：对方端显示"在楼内"标记（室内坐标不可跨端渲染）
        food: sv.food || 0, water: sv.water || 0,   // 队友饥渴状态（对方端血条旁显示）
    };
}
export function setRemotePlayerState(data, guestId) {
    if (!sv || !data || typeof data.x !== 'number') return;
    // 3+ 人：按 guestId 写多队友表（sv.p2s）；sv.p2 保持"最近活动队友"别名，
    // 让既有的单队友渲染/战斗代码（drawRemotePlayer/hostGuestBiteCheck 旧路径）继续工作
    const pid = guestId || 'guest1';
    if (!sv.p2s) sv.p2s = {};
    let slot = sv.p2s[pid];
    if (!slot) {
        slot = sv.p2s[pid] = {
            x: data.x, y: data.y, tx: data.x, ty: data.y,
            faceX: 1, faceY: 0, moving: false, frame: 0, run: false,
            hp: data.hp || 100, maxHp: data.maxHp || 100,
            character: data.character || null,
            name: data.name || '队友',
            lastSeen: performance.now(),
            _hostHp: 100,   // host 权威维护的 guest 血量（僵尸咬伤判定用）
            swingT: 0, swingDir: 0, swingWeapon: null, hurtT: 0, jump: false, dash: false,
        };
    }
    sv.p2 = slot;   // 最近活动 → 单队友别名
    slot.tx = data.x; slot.ty = data.y;
    // 空间切换（进出室内/楼层）：坐标体系突变，立即对齐禁止插值（否则会"飞越"整个地图）
    const newIn = !!data.inInterior;
    const nowMs = performance.now();
    if (slot._inInt !== newIn) {
        slot._inInt = newIn;
        slot.x = data.x; slot.y = data.y;
        // 插值快照缓冲也重置到当前点（否则会在两个坐标系间拉出大位移）
        slot._snapPrev = { x: data.x, y: data.y, t: nowMs };
        slot._snapCur = { x: data.x, y: data.y, t: nowMs };
    } else {
        // wpos 位置快照缓冲（保留最近两拍）：渲染层据此按固定延迟做匀速线性插值，
        // 消除旧版指数衰减"冲刺-停顿"卡顿（200ms 包间隔内约 150ms 就收敛静止）
        slot._snapPrev = slot._snapCur || { x: data.x, y: data.y, t: nowMs };
        slot._snapCur = { x: data.x, y: data.y, t: nowMs };
    }
    slot.faceX = data.faceX || 0; slot.faceY = data.faceY || 0;
    slot.moving = !!data.moving; slot.frame = data.frame || 0; slot.run = !!data.run;
    slot.hp = data.hp; slot.maxHp = data.maxHp;
    // host 侧：guest 回血/恢复时同步 _hostHp（只升不降；咬伤下降仍由 hostGuestBiteCheck 权威扣减）
    if (sv.mp && sv.mp.role === 'host' && typeof data.hp === 'number' && data.hp > (slot._hostHp || 0)) {
        slot._hostHp = data.hp;
    }
    if (data.character) slot.character = data.character;
    if (data.name) slot.name = data.name;
    // 动画状态（挥砍/被击/跳跃/冲刺）
    if (typeof data.swingT === 'number') { slot.swingT = data.swingT; slot.swingDir = data.swingDir || 0; slot.swingWeapon = data.swingWeapon || null; }
    if (typeof data.hurtT === 'number') slot.hurtT = data.hurtT;
    slot.jump = !!data.jump; slot.jumpOffset = data.jumpOffset || 0; slot.dash = !!data.dash;
    slot.driving = data.driving || null;   // 开车状态（渲染画车）
    slot.guarding = !!data.guarding; slot.guardTimer = data.guardTimer || 0; slot.guardFacing = data.guardFacing || 0;
    slot.perfectFlash = data.perfectFlash || 0;
    slot.infection = data.infection || 0;
    slot.charging = !!data.charging; slot.chargeT = data.chargeT || 0;
    slot.reloading = data.reloading || 0;
    slot.inInterior = !!data.inInterior;
    slot.food = data.food; slot.water = data.water;
    slot.lastSeen = performance.now();
}
export function clearRemotePlayer() {
    if (sv) sv.p2 = null;
}
// 3+ 人：按 guestId 移除指定队友槽（队友退出/超时清理；联机层 leave 事件调用）
export function clearRemotePlayerById(pid) {
    if (!sv || !pid || !sv.p2s) return;
    const slot = sv.p2s[pid];
    if (!slot) return;
    delete sv.p2s[pid];
    if (sv.p2 === slot) sv.p2 = null;   // 单队友别名若指向该槽一并清掉
}
export function getRemotePlayerState() {
    if (!sv || !sv.p2) return null;
    const p = sv.p2;
    return { x: p.x, y: p.y, tx: p.tx, ty: p.ty, faceX: p.faceX, faceY: p.faceY, name: p.name, hp: p.hp,
        swingT: p.swingT || 0, hurtT: p.hurtT || 0, jump: !!p.jump, jumpOffset: p.jumpOffset || 0, dash: !!p.dash, moving: !!p.moving, run: !!p.run,
        guarding: !!p.guarding, perfectFlash: p.perfectFlash || 0, infection: p.infection || 0,
        charging: !!p.charging, reloading: p.reloading || 0, driving: p.driving || null,
        inInterior: !!p.inInterior, food: p.food, water: p.water };
}

// ================= 联机主机权威（host 侧，mpWasteland 调用） =================
// host 是世界唯一模拟者；这些导出让 mpWasteland 只依赖 survival 接口（R5）。
// 性能：wsync 100ms 全量序列化是联机卡顿主源（尸潮上百只僵尸 × 每包全量字段 + 双端 GC）。
// 此处做空间裁剪：只序列化 host/guest 附近 34 格内的僵尸（含双方视野冗余），
// 且不再二次 map 僵尸（serializeMpSnapshot 直接产出最终字段，消除重复序列化）。
export function getMpSnapshot(withNpcs) {
    if (!sv || !sv.active) return null;
    const inInterior = !!sv.interior;
    const R = 34 * TS;
    const cx = sv.px, cy = sv.py;
    // 3+ 人：裁剪覆盖所有队友视野（每个 guest 位置都算进 near）
    const guests = sv.p2s && Object.keys(sv.p2s).length ? Object.values(sv.p2s) : (sv.p2 ? [sv.p2] : []);
    const near = (x, y) => {
        const d1x = x - cx, d1y = y - cy;
        if (d1x >= -R && d1x <= R && d1y >= -R && d1y <= R) return true;
        for (const g of guests) {
            if (typeof g.tx !== 'number') continue;
            const d2x = x - g.tx, d2y = y - g.ty;
            if (d2x >= -R && d2x <= R && d2y >= -R && d2y <= R) return true;
        }
        return false;
    };
    const src = inInterior && sv.interior ? sv.interior.zombies : sv.zombies;
    const zombies = src.filter(z => z && z.hp > 0 && near(z.x, z.y));
    // 性能（P0-3）：掉落/特效/子弹/植物同样按双方视野裁剪——同屏协同时 wsync 载荷从
    // 「全地图 plants + 150 掉落 + 50 特效」降到「视野内实体」，双端 JSON/GC 压力大减。
    // 半径与僵尸一致（34 格 ≈ 1.2 屏宽），视野外实体无可见差异，走进后 100ms 内自然出现。
    const cull = {
        drops: (sv.drops || []).filter(d => d && near(d.x, d.y)),
        effects: (sv.effects || []).filter(e => e && near(e.x, e.y)),
        bullets: (sv.bullets || []).filter(b => b._mpSyncable !== false && near(b.x, b.y)),
    };
    if (sv.mods && sv.mods.plants) {
        const pl = sv.mods.plants;
        const arr = [];
        for (const key in pl) {
            const p = pl[key];
            if (!p) continue;
            const c = key.indexOf(',');
            if (c < 0) continue;
            const gx = +key.slice(0, c), gy = +key.slice(c + 1);
            if (!near((gx + 0.5) * TS, (gy + 0.5) * TS)) continue;
            arr.push([key, p]);
        }
        cull.plants = arr;
    }
    const snap = serializeMpSnapshot(sv, STATE_DEPS, zombies, cull);
    snap.inInterior = inInterior;
    // host 玩家状态 + guest 权威 HP（僵尸咬伤由 host 判定）
    // 复用 getLocalPlayerState：动画/跳跃/开车/格挡/室内标记等全字段随快照下发（guest 端 p2 完整渲染）
    snap.hostPlayer = getLocalPlayerState();
    snap.guestHp = sv.p2 && typeof sv.p2._hostHp === 'number' ? sv.p2._hostHp : null;
    // 3+ 人：每个队友独立权威血量（guest 端按自己 guestId 取）
    snap.guestsHp = null;
    if (sv.p2s) {
        snap.guestsHp = {};
        for (const pid in sv.p2s) {
            const g = sv.p2s[pid];
            if (g && typeof g._hostHp === 'number') snap.guestsHp[pid] = g._hostHp;
        }
    }
    // NPC（host 权威下发：视野内 + 队伍/雇佣常驻；排除玩家自己的名册记录）
    const npcVisible = (n) => n && !n.isPlayer && (n.alive || n._corpse) && (n.party || n.hired || near(n.x, n.y));
    if (withNpcs && Array.isArray(sv.npcs)) {
        const npcList = [];
        for (const n of sv.npcs) {
            if (!npcVisible(n)) continue;
            npcList.push({
                id: n.id, name: n.name, role: n.role, look: n.look,
                alive: n.alive !== false,   // 必需：guest 重建 NPC 无此字段会被所有 n.alive 检查过滤
                x: n.x, y: n.y, tx: n.tx, ty: n.ty,
                hp: n.hp, maxHp: n.maxHp, food: n.food, water: n.water,
                dmg: n.dmg, wpnKey: n.wpnKey, wpnName: n.wpnName,
                inv: n.inv, coins: n.coins || 0,
                attrs: n.attrs, talent: n.talent, congenital: n.congenital,
                bornDay: n.bornDay, age: n.age,
                party: !!n.party, hired: !!n.hired, hireFee: n.hireFee || null,
                campId: n.campId || null, sick: n.sick || null,
                state: n.state || 'wander', campTask: n.campTask || null,
                act: n.act || null, riding: !!n.riding,
                swingT: n.swingT || 0, swingDir: n.swingDir || 0, swingWeapon: n.swingWeapon || null,
                hurtT: n.hurtT || 0, followTarget: n.followTarget || null,
                workLog: Array.isArray(n.workLog) ? n.workLog.slice(-5) : [],
                // v4.49 尸体/倒地/感染字段同步：guest 端重建尸体可搜索、倒地成员可见、
                // 感染值显示一致（渲染/面板依赖）
                downed: !!n.downed, _penaltySec: n._penaltySec || 0,
                _downedAtReal: n._downedAtReal || null, limitSec: n.limitSec || null,
                infection: n.infection || 0,
                _corpse: !!n._corpse, _corpseDay: n._corpseDay || 0,
                _corpseAtReal: n._corpseAtReal || 0,
                _corpseContents: n._corpseContents || [],
                _corpseSearched: !!n._corpseSearched,
                _revived: !!n._revived, _revivedCorpse: !!n._revivedCorpse,
                _deathReason: n._deathReason || null,
            });
        }
        snap.npcs = npcList;
    } else if (Array.isArray(sv.npcs)) {
        // 非全量拍：只带位置/动作轻量帧（100ms 一拍，NPC 移动不卡；新 NPC 等全量拍介绍）
        snap.npcPos = sv.npcs.filter(npcVisible).map(n => ({
            id: n.id, x: n.x, y: n.y, hp: n.hp,
            swingT: n.swingT || 0, swingDir: n.swingDir || 0, swingWeapon: n.swingWeapon || null,
            hurtT: n.hurtT || 0, state: n.state || 'wander', act: n.act || null,
        }));
    }
    // 3+ 人互见位置已改由 wpos 经 host 转发（200ms 二进制压缩包）：
    // 旧版随 wsync 全量广播 teammates（每人 ~30 字段 × 每 100ms）冗余且包体大，不再下发。
    // guest 端 applyMpSnapshot 对 snap.teammates 缺失已容错（Array.isArray 守卫）。
    return snap;
}

// guest 攻击上报：host 权威判定命中（近战按各武器真实判定范围 / 远程 260px），击杀返回信息供广播
export function hostApplyGuestAttack(evt, gx, gy) {
    if (!sv || !evt) return null;
    // 2026-08-09 近战范围按武器实际判定（reach+8，与单机一致）；无武器 key 时回退 40px（拳头级）
    let reach;
    if (evt.melee) {
        const wkey = evt.wkey;
        const wdef = (wkey && WEAPONS[wkey]) ? WEAPONS[wkey] : null;
        reach = wdef && wdef.kind === 'melee' ? ((wdef.reach || 40) + 8) : 40;
    } else reach = 260;
    let best = null, bestD = Infinity;
    for (const z of sv.zombies) {
        if (!z || z.hp <= 0) continue;
        const d = Math.hypot(z.x - gx, z.y - gy);
        if (d < reach && d < bestD) { best = z; bestD = d; }
    }
    if (!best) {
        // 无僵尸命中：再扫恶意 NPC（guest 近战/远程同样能打到敌对 NPC，host 权威结算）
        const npcReach = evt.melee ? reach : 26;   // 远程按弹着点判，半径与弹丸命中一致
        let bn = null, bnd = Infinity;
        if (sv.npcs) {
            for (const n of sv.npcs) {
                if (!n || !n.alive || n.role !== 'hostile' || n.isPlayer) continue;
                const d = Math.hypot(n.x - gx, n.y - gy);
                if (d < npcReach && d < bnd) { bn = n; bnd = d; }
            }
        }
        if (bn) {
            bn.hp -= evt.dmg || 10;
            bn.hurtT = 0.15;
            if (!evt.melee) sv.effects.push({ kind: 'hit', x: bn.x, y: bn.y, life: 0.15, maxLife: 0.15 });
            if (bn.hp <= 0) WNPC.killNpc(sv, bn, '被队友误伤致死');
        }
        return null;
    }
    best.hp -= evt.dmg || 10;
    best.hurt = 0.15;
    // guest 命中特效（host 端生成 → wsync 回传双端可见；近战命中由 guest 本地挥砍特效覆盖，不重复）
    if (!evt.melee) {
        sv.effects.push({ kind: 'hit', x: best.x, y: best.y, life: 0.15, maxLife: 0.15 });
    }
    if (best.hp <= 0) {
        // 完整结算（战利品掉落 + 死亡特效 + 音效，与本地击杀一致）
        removeZombieById(best.id);
        return { killed: best.id, x: best.x, y: best.y };
    }
    return null;
}

// host 每帧判定僵尸咬远端队友（sv.p2）：guest 端不模拟世界，被咬判定归 host 权威
// 性能：0.1s 一跳 + 8 格粗筛（避免尸潮时全量遍历）；guest 在室内时跳过（不同空间，guest 本地权威）
export function hostGuestBiteCheck(dt) {
    // 3+ 人：对所有队友（p2s 多槽）循环咬伤判定；无 p2s 时回退单队友（1v1 兼容）
    if (!sv) return;
    const guests = sv.p2s && Object.keys(sv.p2s).length ? Object.values(sv.p2s) : (sv.p2 ? [sv.p2] : []);
    let guestDied = false;
    for (const p of guests) {
        if (!p || p.tx == null) continue;
        if (p.inInterior) continue;
        if (p._hostHp == null) p._hostHp = 100;
        if (p._biteCd == null) p._biteCd = 0;
        p._biteCd -= dt;
        p._biteScanT = (p._biteScanT || 0) - dt;
        if (p._biteScanT > 0) continue;
        p._biteScanT = 0.1;
        const biteD = B.Z_BITE_RANGE;   // 联机 guest 持续啃咬距离（同室外修复 2026-08-09：覆盖相邻格）
        const r2 = 8 * TS;   // 粗筛半径（格 → px）：只查 guest 附近僵尸
        for (const z of sv.zombies) {
            if (!z || z.hp <= 0) continue;
            const dzx = z.x - p.tx, dzy = z.y - p.ty;
            if (dzx > r2 || dzx < -r2 || dzy > r2 || dzy < -r2) continue;
            if (Math.hypot(dzx, dzy) < biteD) {
                // 2026-08-09 用户要求：guest 与单机一致——持续啃咬（血条缓慢减少），
                // DPS = z.damage/biteCd（平均 DPS 与原咬击节奏一致，联机零差异 §5.1）；
                // 音效/受击反馈按 Z_BITE_INTERVAL(0.3s) 节拍。间隔收口 wbalance.js（§13.1）。
                const zc = B.Z_CONTACT[z.type] || B.Z_CONTACT.normal;
                const gdps = z.damage / (zc.biteCd || 1);
                // 开发者共用：队友无敌时不被咬伤（host 权威判定，双端血一致）
                if (p._devGod) break;
                p._hostHp = Math.max(0, p._hostHp - gdps * 0.1);   // _biteScanT 0.1s 一跳，按扫描间隔累计
                p._biteSfxT = (p._biteSfxT || 0) - 0.1;
                if (p._biteSfxT <= 0) {
                    // 2026-08-09 用户要求：啃咬音效 0.5s/次（与单机一致），掉血节拍仍 0.3s
                    p._biteSfxT = B.Z_BITE_SFX_INTERVAL;
                    p.hurt = 0.3;
                    // 啃咬音效双端（§5.1 检查项4）：host 本地播 + outbox sfx 通知 guest 播
                    AudioSystem.playZombieEating();
                    mpSfx('zbite');
                }
                // guest 死亡（host 权威判定）：R7 双端结束。
                // 修复：guest 血量归零后若无判定，guest 端 sv.hp=0 且回血无法恢复
                // （applyMpSnapshot 只处理下降不恢复）→ 永久卡死，违反 §5.1 零差异。
                if (p._hostHp <= 0) {
                    if (!sv._mpDeadSent) {
                        sv._mpDeadSent = true;
                        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'dead', who: 'guest' });
                    }
                    guestDied = true;
                    break;
                }
                break;
            }
        }
        if (guestDied) break;
    }
    if (guestDied) {
        AudioSystem.playDefeat();
        setTimeout(() => exitWasteland(true), 1200);   // 与 playMpEvent 'dead' 处理一致：本端也结算退出
    }
}

// ================= 键位设置 =================
// v4.26 已拆到 wkeybind.js（KEYBIND_DEFS/getBind/setBind/openKeybinds 等）

let pauseEl = null;
let pauseOpen = false;

function syncPauseVolumes() {
    if (!pauseEl) return;
    if (!saveData.volumes) saveData.volumes = { bgm: 20, sfx: 100 };
    const bEl = pauseEl.querySelector('#wsl-vol-bgm');
    const sEl = pauseEl.querySelector('#wsl-vol-sfx');
    if (bEl) {
        bEl.value = saveData.volumes.bgm;
        pauseEl.querySelector('#wsl-vol-bgm-v').textContent = saveData.volumes.bgm + '%';
    }
    if (sEl) {
        sEl.value = saveData.volumes.sfx;
        pauseEl.querySelector('#wsl-vol-sfx-v').textContent = saveData.volumes.sfx + '%';
    }
}

// 传送回营地（E2）：暂停面板入口；消耗 1 颗传送宝石 + 冷却（现实时间，防暂停刷冷却）；
// 营地旗帜位置附近找可行走格落脚，下车/取消代驾；联机由 wpos 200ms 上报新位置
const TP_COOLDOWN_MS = 120000;   // 传送冷却：120 秒现实时间
function tpToCamp() {
    if (!sv || !sv.camp) { log('还没有营地：背包中点击「领地旗帜」在脚下插旗建立', '#FFB347'); return; }
    // 冷却检查（现实时间，暂停不生效→无法刷冷却）
    const cdLeft = Math.ceil(((sv._tpCdReal || 0) - performance.now()) / 1000);
    if (cdLeft > 0) { log(`传送冷却中：${cdLeft} 秒后可用`, '#FFB347'); return; }
    // 宝石消耗
    const gem = sv.inv.find(s => s && s.id === 'tpgem');
    if (!gem || gem.n < 1) { log('需要「传送宝石」才能传送（尸潮首领·巨字尸 / 稀有容器掉落）', '#FFB347'); return; }
    gem.n--;
    if (gem.n <= 0) sv.inv[sv.inv.indexOf(gem)] = null;
    sv._tpCdReal = performance.now() + TP_COOLDOWN_MS;
    const gx = Math.floor(sv.camp.x / TS), gy = Math.floor(sv.camp.y / TS);
    let px = sv.camp.x, py = sv.camp.y;
    outer: for (let r = 0; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (isWalk(getTile(sv, gx + dx, gy + dy))) {
                px = (gx + dx + 0.5) * TS; py = (gy + dy + 0.5) * TS;
                break outer;
            }
        }
    }
    sv.px = px; sv.py = py;
    sv.driving = null; sv.driveOrder = null; sv._chauffeured = false;
    if (sv.aiming) { sv.aiming = false; sv.mouseDown = false; }
    sv.effects.push({ kind: 'hit', x: px, y: py, life: 0.5, maxLife: 0.5, label: '◈' });
    log('已传送回营地（消耗传送宝石 ×1，冷却 120s）', '#7DFF7D');
}

// 暂停面板传送按钮状态刷新（无宝石/冷却中提示；togglePause 打开时调用）
function updateTpBtn() {
    if (!pauseEl || !sv) return;
    const btn = pauseEl.querySelector('#wsl-p-tpcamp');
    if (!btn) return;
    const cdLeft = Math.ceil(((sv._tpCdReal || 0) - performance.now()) / 1000);
    const hasGem = sv.inv && sv.inv.some(s => s && s.id === 'tpgem');
    if (cdLeft > 0) btn.textContent = `传送回营地（冷却 ${cdLeft}s）`;
    else if (!hasGem) btn.textContent = '传送回营地（需传送宝石）';
    else btn.textContent = '传送回营地 ◈';
}

function togglePause(silent) {
    pauseOpen = !pauseOpen;
    // 联机：暂停状态广播（对方同步暂停/继续；silent=远端应用不广播，防回环）
    if (sv && sv.mp && !silent) {
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'pause', paused: pauseOpen });
    }
    if (pauseOpen) {
        if (!pauseEl) {
            if (!saveData.volumes) saveData.volumes = { bgm: 20, sfx: 100 };
            pauseEl = document.createElement('div');
            pauseEl.id = 'wsl-pause';
            pauseEl.style.cssText = 'position:absolute;inset:0;z-index:900;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;';
            pauseEl.innerHTML =
                '<div class="wsl-scaler" style="position:relative;">' +
                // 2026-08-11 v2.99 用户要求：所有弹窗都有叉号关闭按钮（右上角；关闭=继续游戏）
                // v2.99 修正：top:-4px;right:-8px 负偏移会被容器裁剪（暂停界面被 wsl-scaler overflow-y:auto 截掉一半）
                // 改为正偏移 + 与面板边界一致的内边距，确保完整显示
                '<button id="wsl-p-close" style="position:absolute;top:6px;right:10px;background:none;border:none;color:#8a9aa2;font-size:20px;cursor:pointer;line-height:1;padding:2px;z-index:2;" title="继续游戏 (P)">✕</button>' +
                '<div style="font-size:22px;color:#FFD700;margin-bottom:10px;letter-spacing:4px;">暂  停</div>' +
                '<div style="color:#7fb39a;font-size:13px;margin-bottom:12px;letter-spacing:1px;">世界种子 <span id="wsl-seed-val" style="color:#39d98a;font-weight:bold;">' + (sv && sv.world ? sv.world.seed : '?') + '</span> · 角色 ' + (sv ? (sv.characterName || '幸存者') : '?') + '</div>' +
                '<div class="wsl-vol">' +
                '<label>背景音乐<input type="range" id="wsl-vol-bgm" min="0" max="100" step="5"><span id="wsl-vol-bgm-v">0%</span></label>' +
                '<label>游戏音效<input type="range" id="wsl-vol-sfx" min="0" max="100" step="5"><span id="wsl-vol-sfx-v">0%</span></label>' +
                '</div>' +
                '<button class="menu-btn" id="wsl-p-resume" style="min-width:200px;">继续游戏 (P)</button>' +
                '<button class="menu-btn" id="wsl-p-full" style="min-width:200px;">切换全屏 (F11 / 全屏时 ALT+ESC 退出)</button>' +
                (sv && sv.camp ? '<button class="menu-btn" id="wsl-p-tpcamp" style="min-width:200px;border-color:#39d98a;color:#7ee08a;">传送回营地 ◈</button>' : '') +
                '<button class="menu-btn" id="wsl-p-unstuck" style="min-width:200px;border-color:#FFB347;color:#FFD080;">脱离卡死（10 秒）</button>' +
                '<button class="menu-btn" id="wsl-p-keybinds" style="min-width:200px;border-color:#7fd6ff;color:#a8dcff;">键位设置</button>' +
                '<button class="menu-btn" id="wsl-p-exit" style="min-width:200px;border-color:#FF5555;color:#FF8888;">退出荒原（进度已保存）</button>' +
                '</div>';
            document.getElementById('game-container').appendChild(pauseEl);
            pauseEl.querySelector('#wsl-p-resume').addEventListener('click', () => togglePause());
            // 2026-08-11 v2.99 右上角叉号：关闭暂停 = 继续游戏
            const pcBtn = pauseEl.querySelector('#wsl-p-close');
            if (pcBtn) pcBtn.addEventListener('click', () => togglePause());
            pauseEl.querySelector('#wsl-p-full').addEventListener('click', () => toggleFullscreen());
            const tpBtn = pauseEl.querySelector('#wsl-p-tpcamp');
            if (tpBtn) tpBtn.addEventListener('click', () => { togglePause(); tpToCamp(); });
            // 2026-08-10 脱离卡死（兜底）：关闭暂停，进入 10 秒倒计时，期满自动传送到最近可站位置
            pauseEl.querySelector('#wsl-p-unstuck').addEventListener('click', () => { togglePause(); startUnstick(); });
            pauseEl.querySelector('#wsl-p-exit').addEventListener('click', () => { togglePause(); exitWasteland(); });
            // 2026-08-12 v3.41 键位设置入口：暂停面板内打开（关闭暂停不退出游戏）
            const kbBtn = pauseEl.querySelector('#wsl-p-keybinds');
            if (kbBtn) kbBtn.addEventListener('click', () => { KB.openKeybinds(); });
            const bEl = pauseEl.querySelector('#wsl-vol-bgm'), bV = pauseEl.querySelector('#wsl-vol-bgm-v');
            const sEl = pauseEl.querySelector('#wsl-vol-sfx'), sV = pauseEl.querySelector('#wsl-vol-sfx-v');
            bEl.addEventListener('input', () => {
                const v = parseFloat(bEl.value);
                bV.textContent = v + '%';
                AudioSystem.setBGMVolume(v / 100);
                saveData.volumes.bgm = v; writeSave(saveData);
            });
            sEl.addEventListener('input', () => {
                const v = parseFloat(sEl.value);
                sV.textContent = v + '%';
                AudioSystem.setSFXVolume(v / 100);
                saveData.volumes.sfx = v; writeSave(saveData);
            });
        }
        syncPauseVolumes();
        updateTpBtn();   // 刷新传送按钮状态（宝石/冷却）
        pauseEl.style.display = 'flex';
        AudioSystem.playPause();
    } else {
        if (pauseEl) pauseEl.style.display = 'none';
        AudioSystem.playPause();
    }
}

export default { enterWasteland, exitWasteland };
