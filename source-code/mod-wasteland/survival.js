// ============================================================
// 【无尽植僵荒原】模组 · 生存模式主控（调度层）
// 建造→wbuild.js / 僵尸→wzombie.js / 尸潮→whorde.js / 数值→wbalance.js
// ============================================================

import { ZOMBIES, AMMO_INFO, WEAPONS, ACTION } from '../core/constants.js';
import { getStorage, setStorage, writeSave, getSession } from '../persistence/storage.js';
import { saveData } from '../core/state.js';
import { showScreen } from '../ui/screens.js';
import AudioSystem from '../systems/audio.js';
import { T, CHUNK, SPAWN, isWalk, newSeed, hash2,
    getTile, setTile, builtAt, purgeChunks } from './world.js';
import { TS } from './wconst.js';
import { fitCanvasBacking, toggleFullscreen } from '../core/canvasFit.js';
import { draw, BUILD_ITEMS, BUILD_HP, resetWeatherParticles, tintSprite, _mcSprites, _mcWalk } from './render.js';
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
import { showLookCreator, normalizeLook, randomLook } from './wlook.js';
import * as WNPC from './wnpc.js';
import * as HUD from './whud.js';
import * as TUT from './wtut.js';
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
import { playerInfectionEffects, addPlayerInfection, PLAYER_INFECTION } from './winfection.js';
import { serializeSV, createRunDefaults, applySnapshot, serializeCharacter, applyCharacter, serializeWorld, applyWorld, serializeMpSnapshot, mergeZombieList } from './wstate.js';

const SAVE_KEY = 'wasteland_save';           // 旧版混合档（v3 迁移源，迁移后仅作备份标记）
const LEGACY_KEY = 'wasteland_save_legacy';
const PROFILE_KEY = 'wasteland_profile';     // { characterName, worldSeed } 当前角色+世界组合
const CHAR_LIST_KEY = 'wasteland_characters';// { names: [] } 已创建角色索引
const CHAR_KEY_PREFIX = 'wasteland_character_'; // + 角色名 → 角色档（跨世界）
const WORLD_KEY_PREFIX = 'wasteland_world_';    // + seed → 世界档（跟种子走）
export const HOTBAR_SIZE = B.HOTBAR_SIZE;

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
function charKey(name) { return CHAR_KEY_PREFIX + (name || '幸存者'); }
function worldKey(seed) { return WORLD_KEY_PREFIX + seed; }
// 随机名生成（2026-08-09 用户要求：角色名/世界名可随机，完全随机——中/英/数字/字符混合）
const _RND_CN = '阿布苍漠凛岚孤舟浮云凝霜曜岩荒野流萤暮雪逐星烬夜苍梧白芷青鸾玄甲赤焰';
const _RND_EN = 'abcdfghjkmnpqrstvwxyz';
const _RND_CHAR = 'ΔλΞΨΩ$#@&%*';
function randomName(prefix) {
    // 2~4 段混搭：中文词 / 英文串 / 数字 / 字符，随机组合
    const parts = [];
    const n = 2 + Math.floor(Math.random() * 3);   // 2-4 段
    for (let i = 0; i < n; i++) {
        const t = Math.floor(Math.random() * 4);
        if (t === 0) {   // 中文词
            const c1 = _RND_CN[Math.floor(Math.random() * _RND_CN.length)];
            const c2 = _RND_CN[Math.floor(Math.random() * _RND_CN.length)];
            parts.push(c1 + c2);
        } else if (t === 1) {   // 英文串
            const len = 3 + Math.floor(Math.random() * 4);
            let s = '';
            for (let j = 0; j < len; j++) s += _RND_EN[Math.floor(Math.random() * _RND_EN.length)];
            parts.push(s);
        } else if (t === 2) {   // 数字
            parts.push(String(Math.floor(Math.random() * 90) + 10));
        } else {   // 字符
            parts.push(_RND_CHAR[Math.floor(Math.random() * _RND_CHAR.length)]);
        }
    }
    return (prefix || '') + parts.join('');
}
// 导出单个存档键为备份文件（2026-08-09 用户要求"保存=导出文件，可再导入"）：
// 复用工坊 workshop.js 的 __wslBackup 格式（entries 以 wasteland_ 前缀键组织），
// 导入时由 ws-save-file 校验 __wslBackup===1 后写回 localStorage（含账户命名空间），
// 因此硬核死亡"保存世界"导出的文件可在工坊「存档管理 → 导入存档」随时还原。
function downloadSaveBackup(entries, filename, tip) {
    try {
        const user = (getSession && getSession() && getSession().username) || '__guest__';
        const data = { __wslBackup: 1, exportedAt: Date.now(), username: user, entries };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
        if (tip) log(tip, '#7fd6ff');
    } catch (e) { /* 导出失败不阻塞保存流程 */ }
}
function updateCharList(name) {
    const list = getStorage(CHAR_LIST_KEY, { names: [] });
    if (!list.names.includes(name)) { list.names.push(name); setStorage(CHAR_LIST_KEY, list); }
}

// 旧版混合档迁移：wasteland_save（v3）→ 角色档 + 世界档 + profile（幂等，_migrated 标记）
function migrateLegacySave() {
    const legacy = getStorage(SAVE_KEY, null);
    if (!legacy || legacy._migrated) return null;
    const name = legacy.characterName || '幸存者';
    setStorage(charKey(name), {
        name, character: legacy.character || null,
        inv: legacy.inv || [], hotbar: legacy.hotbar || [], curSlot: legacy.curSlot || 'ranged',
        hp: legacy.hp, maxHp: legacy.maxHp,
        food: legacy.food, water: legacy.water, infection: legacy.infection || 0,
        stamina: legacy.stamina, maxStamina: legacy.maxStamina,
        wpnMag: legacy.wpnMag || {}, _devInfBag: !!legacy._devInfBag,
    });
    if (typeof legacy.seed === 'number') {
        setStorage(worldKey(legacy.seed), {
            seed: legacy.seed, t: legacy.t, day: legacy.day, playT: legacy.playT,
            mods: legacy.mods, homeBed: legacy.homeBed || null, lastRestDay: legacy.lastRestDay || 0,
            horde: legacy.horde ? 1 : 0, zombies: legacy.zombies || [],
            npcs: legacy.npcs || null, px: legacy.px, py: legacy.py,
            faceX: legacy.faceX || 1, faceY: legacy.faceY || 0,
        });
        setStorage(PROFILE_KEY, { characterName: name, worldSeed: legacy.seed });
    } else {
        // 旧档无 seed（极旧结构）：也写 profile，避免角色档孤立（L13）——
        // worldSeed=null 按"开新世界"处理，角色（名字/外观/背包）仍会被自动加载
        setStorage(PROFILE_KEY, { characterName: name, worldSeed: null });
    }
    updateCharList(name);
    setStorage(SAVE_KEY, { ...legacy, _migrated: true });
    return { characterName: name, worldSeed: typeof legacy.seed === 'number' ? legacy.seed : null };
}

// 保存：角色档（跨世界）+ 世界档（跟 seed，host 权威）+ 当前组合 profile（含开发者标记）
// 性能（卡顿排查 P0-1）：存档写入移出 RAF 帧循环——
// 原实现每 SAVE_INTERVAL(20s) 在 update() 帧内同步执行「serializeWorld 全量序列化 +
// JSON.stringify + localStorage.setItem」（含全部 mods 差分/NPC/僵尸，几百 KB），
// 单帧尖峰几十 ms → 周期性卡顿（单机/联机 host 每 20s 一次）。改为宏任务队列：
// saveNow 只标记待存（_saveQueued 幂等合并），实际落盘在 setTimeout(0) 帧间执行；
// 退出/切后台时 flushSave 同步兜底（防丢最后进度）。
let saveFlushTimer = null;
function saveNow() {
    if (!sv || !sv.world || sv.dead) return;
    if (sv._saveQueued) return;
    sv._saveQueued = true;
    if (saveFlushTimer == null) saveFlushTimer = setTimeout(flushSave, 0);
}
function flushSave() {
    if (saveFlushTimer != null) { clearTimeout(saveFlushTimer); saveFlushTimer = null; }
    if (!sv || !sv.world || sv.dead) { if (sv) sv._saveQueued = false; return; }
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

// 角色档读写（mpWasteland 握手阶段加载/创建用）
export function loadCharacterData(name) {
    return name ? getStorage(charKey(name), null) : null;
}
export function saveCharacterData(charData) {
    if (!charData || !charData.name) return;
    setStorage(charKey(charData.name), charData);
    updateCharList(charData.name);
}
export function currentCharacterName() {
    return (sv && sv.characterName) || (getStorage(PROFILE_KEY, null) || {}).characterName || null;
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
        // 随机选一个城市节点，在其附近出生（随机城市 ±3×3、随机角度、距中心 5~15 区块）：
        // 每次开局位置仍完全随机（不同城市/方向/远近），但保证出生点附近就有郊区和城市，
        // 避免完全随机落在荒野深处、走很久都见不到城市。
        const ccx = Math.round(Math.random() * 6) - 3;
        const ccy = Math.round(Math.random() * 6) - 3;
        const cc = cityCenterAt(run.world.seed, ccx, ccy);
        const ang = Math.random() * Math.PI * 2;
        const dist = (5 + Math.random() * 10) * CHUNK;
        run.px = (Math.round(cc.x * CHUNK + Math.cos(ang) * dist) + 0.5) * TS;
        run.py = (Math.round(cc.y * CHUNK + Math.sin(ang) * dist) + 0.5) * TS;
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
    if (!Panel.isChestOpen() && !pauseOpen && !WW.isOpen() && !sv.dead) update(dt);
    else if (!sv.dead) {
        sv.now += dt * (sv._devTimeScale || 1);
        if (WW.isOpen()) WW.update(dt);
    }
    if (WSearch.isOpen() && !sv.dead) WSearch.updateSearch(sv, dt);
    if (sv.ctx) fitCanvasBacking(sv.ctx, sv._devGfx === 0 ? 0.75 : 1);   // 低画质：内部分辨率 0.75x
    draw(sv.ctx, sv);
    HUD.update(sv, now);   // 调试 HUD（默认关闭；每帧轻量计数，DOM 500ms 节流）
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

// ---------- 随机事件（D）：停电夜 / 物资空投 ----------
// 沙尘暴已并入天气系统（sv._weather.sandstorm，每天确定性切换）。
// 每天 8:00 判定一次（天≥3，30% 触发）；事件进行中不触发下一个。
// sv._evt = { type, endT }（endT 按游戏时间 sv.now 秒）。运行时状态，联机经 wsync 快照同步。
const EVT_UNLOCK_DAY = 3;
const EVT_TRIGGER_CHANCE = 0.30;
function updateEvents(sv, dt) {
    if (sv._evt) {
        if (sv.now >= sv._evt.endT) sv._evt = null;
        return;
    }
    const hour = (sv.t / sv.dayLen) * 24;
    if (sv._lastEvtHour != null && sv._lastEvtHour < 8 && hour >= 8 && sv.day >= EVT_UNLOCK_DAY && Math.random() < EVT_TRIGGER_CHANCE) {
        const r = Math.random();
        if (r < 0.5) startEvent(sv, 'blackout');
        else startEvent(sv, 'airdrop');
    }
    sv._lastEvtHour = hour;
}

// ---------- 天气系统：每天 8:00 确定性切换（§13.2 weatherAt(seed,day) 纯函数） ----------
// host/单机在 guest 分流后更新（guest 不本地随机，从 wsync 快照读 sv._weather → 双端一致 §5.1）。
// 2026-08-10 季节系统：天气按季节限定类型（春/夏/秋/冬），sv._season 与草地渲染联动。
function updateWeather(sv) {
    const hour = (sv.t / sv.dayLen) * 24;
    // 同步季节（幂等：读档/跨天/换日都保持正确；0春 1夏 2秋 3冬，与 wgrass SEASONS 索引一致）
    const seasonNow = B.seasonAt(sv.day);
    if (sv._season !== seasonNow) { sv._season = seasonNow; }
    // dev 手动设了天气 + 强度后锁定（applyWxSet 设 _devWxLock=true），不被每天 8:00 自动覆盖
    if (sv._devWxLock) { sv._lastWxHour = hour; sv._lastHintHour = hour; return; }
    // 预兆暗示（每天 7:00，切换前 1 游戏小时）：角色隐约感知即将来袭的天气（hint 文案，双端 log）
    if ((sv._lastHintHour == null || (sv._lastHintHour < 7 && hour >= 7)) && hour < 8) {
        const hintWx = B.weatherAt(sv.world.seed, sv.day);
        if (hintWx !== sv._weather) log(B.wxInfo(hintWx).hint, '#B0B0C0');
    }
    sv._lastHintHour = hour;
    if (sv._lastWxHour != null && sv._lastWxHour < 8 && hour >= 8) {
        const wx = B.weatherAt(sv.world.seed, sv.day);
        if (wx !== sv._weather) {
            const info = B.wxInfo(wx);
            const level = B.wxLevelAt(sv.world.seed, sv.day);
            const inten = B.wxIntensity(wx, level);
            sv._weather = wx;
            // 大字公告（提示与天气改变同刻，host 端设 → wsync 快照 announce 双端显示）：
            // 「🌧 雷阵雨 ⚡ 即将来袭」
            sv.announce = { text: `${info.icon} ${inten.name}${inten.flash ? ' ⚡' : ''}即将来袭`, t: 2.8, color: info.color };
            log(`${inten.name}：${info.desc}`, info.color);   // 强度名（小雨/中雨…大雪/浓雾）+ 描述，host 广播 msg 双端可见
            if (wx === 'sandstorm' || inten.flash) AudioSystem.playWaveWarning();
        }
    }
    sv._lastWxHour = hour;
}

function startEvent(sv, type) {
    if (type === 'blackout') {
        sv._evt = { type, endT: sv.now + 30 };
        sv.announce = { text: '⚡ 停电夜！视野受限', t: 2.5, color: '#8899BB' };
        AudioSystem.playWaveWarning();
    } else if (type === 'airdrop') {
        const boxes = ['WBOX', 'MEDBOX', 'MATBOX'];
        let n = 0;
        for (let i = 0; i < 3; i++) {
            for (let tries = 0; tries < 10; tries++) {
                const ang = Math.random() * Math.PI * 2;
                const d = (10 + Math.random() * 4) * TS;
                const gx = Math.floor((sv.px + Math.cos(ang) * d) / TS);
                const gy = Math.floor((sv.py + Math.sin(ang) * d) / TS);
                const t = getTile(sv, gx, gy);
                if (isWalk(t) && t !== T.ROAD && t !== T.SIDEWALK) {
                    const bt = T[boxes[Math.floor(Math.random() * boxes.length)]];
                    setTile(sv, gx, gy, bt);
                    const items = WZ.rollLootContents(Math.random() < 0.5 ? 'rare' : 'common');
                    sv.mods.boxLoot[gx + ',' + gy] = items;
                    n++;
                    break;
                }
            }
        }
        if (n > 0) {
            sv._evt = { type, endT: sv.now + 5 };
            sv.announce = { text: `✈ 物资空投！附近 ${n} 个物资箱（发光处可搜索）`, t: 3, color: '#7DFF7D' };
            AudioSystem.playCollect();
        } else {
            sv._evt = null;
        }
    }
}

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
    // 昏迷苏醒过渡计时（不序列化；期满后清空，玩家恢复移动）
    if (sv._wake) { sv._wake.t += dt; if (sv._wake.t >= sv._wake.dur) sv._wake = null; }
    // 2026-08-10 脱离卡死倒计时（暂停菜单入口；移动键取消，期满自动传送）
    tickUnstuck(dt);

    // ---------- 联机客人端分流（Phase 2 主机权威）----------
    // guest 不模拟世界（昼夜/僵尸 AI/NPC/刷怪/尸潮/掉落生成都由 host 权威，
    // 经 wsync 100ms 快照下发）；本地只保留：自己移动/生存/武器视觉/特效/事件播放。
    if (sv.mp && sv.mp.role === 'guest') { updateGuest(dt); return; }
    updateEvents(sv, dt);   // 随机事件（D：停电夜/物资空投）——host 权威，guest 从快照同步
    updateWeather(sv);      // 天气切换（确定性 weatherAt）——host 权威，guest 从快照同步

    sv.t += dt * (sv._devTimeScale || 1);   // 开发工具：时间加速（测昼夜用），1 现实小时 = 1 游戏天
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
    while (sv.effects.length > maxEff) sv.effects.shift();
    // 地面掉落物上限（长时间战斗掉落堆积 → 快照/渲染卡顿）
    if (sv.drops.length > 150) sv.drops.splice(0, sv.drops.length - 150);
    if (sv.swingT > 0) sv.swingT -= dt;
    if (sv.hurtT > 0) sv.hurtT -= dt;
    if (sv._pathRebuildCd > 0) sv._pathRebuildCd -= dt;
    MSG.updateMsg(sv, dt);

    // ---------- 感染阶段效果 ----------
    if (sv.infection > 0) {
        const infEff = playerInfectionEffects(sv.infection);
        const effMaxHp = Math.round(B.MAX_HP * infEff.maxHpMul);
        if (sv.hp > effMaxHp) sv.hp = effMaxHp;
        // 2026-08-11 v2.98 用户需求：感染值>0（被僵尸咬沾染）且未用抑制药（抗生素/草药）时，
        // 感染值**缓慢自动增加**（无药约 2 分钟从 0 到满）；满 100 → 直接致死 → 走尸体/尸变逻辑。
        sv.infection = addPlayerInfection(sv.infection, B.INFECTION_AUTO_GROW_PER_SEC * dt);
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

    // ---------- 生命恢复：血量<100% 时缓慢自愈（有粮有水才回）；饱食充足可加快，代价是更快消耗饱食 ----------
    // 2026-08-09 修复"僵尸持续啃咬卡 1 血"：持续啃咬 DPS 与自然回血(0.5~3/s)互相抵消，
    // 低攻僵尸（旗手 4/1.2≈3.3/s）咬时血条几乎不动。战斗状态（_combatT>0，被咬/出手刷新）
    // 期间暂停自然回血——持续啃咬的掉血不再被回血追平，血条持续缓慢下降；脱离战斗 4s 后恢复自愈。
    // _biting 帧末重置（帧尾）：回血块在帧首用"上一帧啃咬"的 _biting=true 跳过回血，
    // 帧末重置保证未啃咬时下帧正常回血。
    // 2026-08-09 用户要求"脱战后低血量也回血要变慢"：hp<=20 完全禁自然回血（同营地回血）；
    // 20~maxHp 区间按血量线性 ramp（hp=20 时 rate=0，hp=maxHp 时 rate=1）——
    // 让玩家在危险血量（<20 不回血、20~50 极慢回血）感受到压力，不会"血看着危险但站着就满"。
    if (sv.hp > B.HP_REGEN_MIN_SAFE && sv.hp < sv.maxHp && (sv.food || 0) > 0 && (sv.water || 0) > 0 && !((sv._combatT || 0) > 0) && !sv._biting) {
        let regen = B.HP_REGEN_NATURAL;
        const fed = (sv.food || 0) >= B.HP_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, ((sv.food || 0) - B.HP_REGEN_FED_AT) / (B.HUNGER_MAX - B.HP_REGEN_FED_AT));
            regen += B.HP_REGEN_FED * ramp;
            sv.food = Math.max(0, sv.food - B.HP_REGEN_FUEL * dt);   // 进食回血：加快消耗饱食度
        }
        // 危险血量 ramp：hp=20 → rate=0（已由 >20 限定），hp=maxHp → rate=1
        const hpRate = Math.min(1, Math.max(0, (sv.hp - B.HP_REGEN_MIN_SAFE) / Math.max(1, sv.maxHp - B.HP_REGEN_MIN_SAFE)));
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
        sv.saveT -= dt;
        if (sv.saveT <= 0) { sv.saveT = B.SAVE_INTERVAL; saveNow(); }
        sv._biting = false;   // 被啃咬标记复位（室内同室外）
        // 2026-08-11 v2.97 统一：去掉 !sv._downed 守卫（见大世界帧尾注释）
        if (sv.hp <= 0 && !sv.dead) onDeath();
        return;
    }

    // ---------- 大世界模式 ----------
    const hour = (sv.t / sv.dayLen) * 24;
    if (sv.opts.invasion && !sv.horde && !sv._hordeDayStarted && hour >= B.HORDE_START_HOUR) {
        sv._hordeDayStarted = true;
        WH.startHordePrep(sv);
    }
    if (sv.horde) WH.updateHorde(sv, dt, canStand);

    // NPC 生态（大世界）
    WNPC.updateNpcs(sv, dt, canStand);
    // 2026-08-11 v2.98 尸体尸变检测（大世界）；v2.99 默认室外模式：只尸变室外尸体（室内尸体由室内循环负责）
    updateCorpseRevive(sv, dt);
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
                // side 走路（东/西向）步频更短、animFrame 只在 0/1 循环，与 front/back 视觉帧频一致（survival.js §P3 升级）
                const isSide = Math.abs(sv.faceX || 0) > 0.7;
                sv.stepT = (sv.stepT || 0) - dt;
                if (sv.stepT <= 0) {
                    sv.stepT = run ? 0.24 : (sv.faceY > 0 && Math.abs(sv.faceY) >= Math.abs(sv.faceX) ? 0.432 : (Math.abs(sv.faceX) > 0.7 ? 0.24 : 0.36));   // 朝南步频慢 20%(0.36×1.2);东西向(含向西)步频提高 50%(0.36→0.24,测试值,过快可回调 0.28/0.30);其余 0.36   // 走路周期统一 1.44s（0.36s×4 帧），跑步 0.96s（0.24s×4）——2026-08-08 用户要求 + 2026-08-09 用户测试
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % (isSide ? 4 : 4);   // 动画换帧与脚步同频；side 2 帧循环、front/back 4 帧
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
            if (d.id.startsWith('loot:')) {
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
    // HP_REGEN_MIN_SAFE：低血(<20)完全禁自然回血（同室外，2026-08-09 锁血修复）
    if (sv.hp > B.HP_REGEN_MIN_SAFE && sv.hp < sv.maxHp && (sv.food || 0) > 0 && (sv.water || 0) > 0 && !((sv._combatT || 0) > 0) && !sv._biting) {
        let regen = B.HP_REGEN_NATURAL;
        const fed = (sv.food || 0) >= B.HP_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, ((sv.food || 0) - B.HP_REGEN_FED_AT) / (B.HUNGER_MAX - B.HP_REGEN_FED_AT));
            regen += B.HP_REGEN_FED * ramp;
            sv.food = Math.max(0, sv.food - B.HP_REGEN_FUEL * dt);
        }
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
                const isSide = Math.abs(sv.faceX || 0) > 0.7;
                sv.stepT = (sv.stepT || 0) - dt;
                if (sv.stepT <= 0) {
                    sv.stepT = run ? 0.24 : (sv.faceY > 0 && Math.abs(sv.faceY) >= Math.abs(sv.faceX) ? 0.432 : (Math.abs(sv.faceX) > 0.7 ? 0.24 : 0.36));   // 朝南步频慢 20%(0.36×1.2);东西向(含向西)步频提高 50%(0.36→0.24,测试值,过快可回调 0.28/0.30);其余 0.36
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % (isSide ? 4 : 4);
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
            if (d.id.startsWith('loot:')) {
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
    if (z._reviveFromCorpse) reviveZombieToCorpse(sv, z);
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
    };
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

// 箱子/容器内容变更上报（联机时调用）
export function reportChestChange(key) {
    if (!sv || !sv.mp || !key) return;
    const chest = sv.mods.chests && sv.mods.chests[key];
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'chest', key, items: chest ? JSON.parse(JSON.stringify(chest)) : [] });
}
export function reportBoxLootChange(key) {
    if (!sv || !sv.mp || !key) return;
    const v = sv.mods.boxLoot && sv.mods.boxLoot[key];
    const searched = sv.mods.boxSearched && sv.mods.boxSearched[key];
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'boxloot', key, items: v !== undefined ? JSON.parse(JSON.stringify(v)) : [], searched: !!searched });
}

// host 移除 guest 已拾取的掉落（按坐标+id 匹配）
export function removeDrop(x, y, id) {
    if (!sv || !Array.isArray(sv.drops)) return false;
    const i = sv.drops.findIndex(d => d && d.id === id && Math.abs(d.x - x) < 12 && Math.abs(d.y - y) < 12);
    if (i >= 0) { sv.drops.splice(i, 1); return true; }
    return false;
}

// host 应用 guest 丢出的掉落（host 权威 drops → wsync 下发双端一致）
export function addDrop(x, y, id, n) {
    if (!sv) return;
    sv.drops.push({ x, y, id, n });
}

// host 应用 guest 搜索战利品后的 contents 变更（host 权威 drops → wsync 下发双端一致）
export function updateLootDrop(x, y, id, contents) {
    if (!sv || !Array.isArray(sv.drops)) return false;
    const d = sv.drops.find(d => d && d.id === id && Math.abs(d.x - x) < 12 && Math.abs(d.y - y) < 12);
    if (!d) return false;
    if (contents && contents.length) d.contents = contents;
    else { const i = sv.drops.indexOf(d); if (i >= 0) sv.drops.splice(i, 1); }
    return true;
}

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
                const isSide = Math.abs(sv.faceX || 0) > 0.7;
                sv.stepT = (sv.stepT || 0) - dt;
                if (sv.stepT <= 0) {
                    sv.stepT = run ? 0.24 : (sv.faceY > 0 && Math.abs(sv.faceY) >= Math.abs(sv.faceX) ? 0.432 : (Math.abs(sv.faceX) > 0.7 ? 0.24 : 0.36));   // 朝南步频慢 20%(0.36×1.2);东西向(含向西)步频提高 50%(0.36→0.24,测试值,过快可回调 0.28/0.30);其余 0.36
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % (isSide ? 4 : 4);
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

    const ox = (960 - it.w * TS) / 2, oy = (540 - it.h * TS) / 2;
    sv.camX = -ox;
    sv.camY = -oy;

    WD.updateInterior(sv, dt);
    if (!sv.interior) return;
    // 2026-08-10 室内外 NPC 逻辑完全一致：直接复用室外同款 updateNpc 分发
    // （party+follow→followAI 自主战斗/跟随游荡；hostile→hostileAI；其余→campOrWanderAI），
    // 只是 canStand 换成 interiorCanStand、sv.zombies 换成室内僵尸。此前只驱动 follow 队员
    // 且行为简化，导致室内队员不攻击僵尸等差异。躲藏者（未招募，it.npcs）仍保持不动。
    const worldZombies = sv.zombies;
    sv.zombies = it.zombies;   // 提前替换为室内僵尸：让战斗 AI 打室内僵尸（室内外行为一致）
    const controller = WNPC.controlledNpc(sv);
    if (sv.npcs && sv.npcs.length) {
        for (const n of sv.npcs) {
            if (!n.alive || n.riding) continue;
            if (!n.inInterior) continue;   // 只在室内的 NPC 由室内驱动
            if (n.downed) continue;        // 倒地主角由 updateDowned 专门管理（背人/救援）
            if (n._mpRemote) continue;     // 联机 guest：host 权威 NPC，本地 AI 停摆只渲染（与室外一致）
            if (controller && n.id === controller.id) continue;   // 主控由玩家操控
            // 与室外 updateNpcs 一致：战斗/跟随/游荡/营地 全走同一条 updateNpc 管线
            WNPC.updateNpc(sv, n, dt, interiorCanStand, sv.camp, controller);
        }
    }
    // 2026-08-11 v2.98 尸体尸变检测（室内：倒地尸体在室内同样 15 分钟尸变）
    // v2.99 传 'indoor'：只尸变当前房间的室内尸体（防室内坐标被当室外坐标生成、瞬移到主控身边）
    updateCorpseRevive(sv, dt, 'indoor');
    WG.syncMag(sv);
    WG.updateWeapon(sv, dt);
    WG.updateBullets(sv, dt);
    // 2026-08-10 修复"室内 NPC 子弹不动/不消失"：室内模式此前从不驱动 NPC 子弹，
    // 必须在 sv.zombies 恢复为世界僵尸之前调用（NPC 子弹要打室内僵尸）
    WNPC.updateNpcBullets(sv, dt);
    sv.zombies = worldZombies;

    it.px = sv.px;
    it.py = sv.py;
    sv.wpnText = WG.hudText(sv);
    // 2026-08-10 修复"室内死亡切视角后濒死不结束/反复切换"：
    // 室内模式此前从不调用 updateDowned → 倒地主角的全灭检测/超时尸变在室内完全不运行，
    // 导致：① 倒地主控永不超时（一直"濒死但活"）；② 队友在室内陆续死亡时无人判定全员死亡 →
    // 反复弹选择框切视角，感觉无敌。补上：室内也用同一套倒地状态机（全灭→全员死亡结算）。
    if (sv._downed || (sv._downedMembers && sv._downedMembers.length)) updateDowned(sv, dt, interiorCanStand);
    // 室内交互目标（黄色光圈提示：F 会和哪个箱子/幸存者交互，与室外一致）
    updateInteriorPrompt();
}

// 计算室内 F 交互目标（与 doInteriorInteract 的判定一致：先最近躲藏幸存者，再 3×3 内箱子）
// 结果存 it.promptTarget 供 render 画黄色光圈。
function updateInteriorPrompt() {
    const it = sv.interior;
    if (!it) return;
    it.promptTarget = null;
    // 2026-08-10 室内濒死提示（与室外同步）：靠近倒地主角 → 黄色光圈提示（F 打开救助界面/放下）
    if (sv._downed) {
        const d = Math.hypot(sv._downed.px - it.px, sv._downed.py - it.py);
        if (d < 1.9 * TS) {
            it.promptTarget = { downed: 1, x: Math.floor(sv._downed.px / TS), y: Math.floor(sv._downed.py / TS) };
            return;
        }
    }
    // 2026-08-10 室内队友倒地提示（与室外同步）：靠近倒地队友 → F 打开队友救助界面
    if (Array.isArray(sv._downedMembers) && sv._downedMembers.length) {
        let best = null, bd = 1.9 * TS;
        for (const m of sv._downedMembers) {
            if (!m || !m.alive || !m.downed) continue;
            const d = Math.hypot(m.x - it.px, m.y - it.py);
            if (d < bd) { bd = d; best = m; }
        }
        if (best) { it.promptTarget = { downedMate: best.id, x: Math.floor(best.x / TS), y: Math.floor(best.y / TS) }; return; }
    }
    // ① 最近躲藏幸存者（1.9×TS 内可交谈/交易）
    if (it.npcs && it.npcs.length) {
        let best = null, bd = 1.9 * TS;
        for (const n of it.npcs) {
            if (!n || n.hp <= 0) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { it.promptTarget = { npc: 1, x: best.x, y: best.y }; return; }
    }
    // ② 楼梯（2026-08-10 交互式上下楼：站在楼梯旁按 F 触发，优先于箱子）
    // 2026-08-10 交互距离与其他交互物（队员）一致：改为"玩家与楼梯格中心距离 ≤ 1.9*TS"，
    // 替代原"3×3 含斜对角"网格判定——原判定在斜对角（√2·TS≈1.41格）也能触发，用户觉得"远了"。
    for (let gy = 0; gy < it.h; gy++) for (let gx = 0; gx < it.w; gx++) {
        const tile = it.tiles[gy * it.w + gx];
        if (tile !== WD.INTERIOR_TILES.STAIRS_UP && tile !== WD.INTERIOR_TILES.STAIRS_DOWN) continue;
        const dcx = (gx + 0.5) * TS, dcy = (gy + 0.5) * TS;
        if (Math.hypot(it.px - dcx, it.py - dcy) < 1.9 * TS) {
            it.promptTarget = { stairs: 1, x: gx, y: gy, dir: tile === WD.INTERIOR_TILES.STAIRS_UP ? 1 : -1 };
            return;
        }
    }
    // ③ 3×3 内的箱子（2026-08-10 移到队员之前：跟随队员贴玩家游荡会抢占箱子交互，
    //    导致"围着箱子一圈都交互不了"——箱子优先，队员仅在无箱子时作为交互对象）
    const pgx = Math.floor(it.px / TS), pgy = Math.floor(it.py / TS);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = pgx + dx, gy = pgy + dy;
        if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
        const tile = it.tiles[gy * it.w + gx];
        if (tile === WD.INTERIOR_TILES.BOX || tile === WD.INTERIOR_TILES.WBOX
            || tile === WD.INTERIOR_TILES.MEDBOX || tile === WD.INTERIOR_TILES.MATBOX) {
            it.promptTarget = { x: gx, y: gy };
            return;
        }
    }
    // ③ 随玩家进室内的队员（无箱子时才交互）
    if (sv.npcs && sv.npcs.length) {
        let best = null, bd = 1.9 * TS;
        for (const n of sv.npcs) {
            if (!n.alive || !n.inInterior) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (n.downed) continue;   // 2026-08-10 倒地者不属于可命令/交谈队友（应显示救治）
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { it.promptTarget = { npc: 1, x: best.x, y: best.y }; return; }
    }
    // 2026-08-10 室内尸体搜索提示（成员死亡后留在房间的尸体）
    if (sv.npcs && sv.npcs.length) {
        let best = null, bd = 1.9 * TS;
        for (const n of sv.npcs) {
            if (!n || !n._corpse || n._corpseSearched) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { it.promptTarget = { corpse: best.id, x: best.x, y: best.y }; return; }
    }
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
    if (!BOX_ROLL[t]) return false;
    const key = tx + ',' + ty;
    if (sv.mods.chests && sv.mods.chests['box:' + key]) return true;
    return !!(sv.mods.boxLoot && sv.mods.boxLoot[key]);
}

function updatePrompt() {
    const ptx = sv.px / TS, pty = sv.py / TS;

    // 软核倒地救治：玩家（队友视角）靠近倒地主角 → 显示救治交互（F 打开救治 UI，展示药品进度与存活倒计时）
    let downedPrompt = null;   // 2026-08-10 先算好救治提示，不立即 return：若附近有可命令队友，优先队友命令
    if (sv._downed) {
        const d = Math.hypot(sv.px - sv._downed.px, sv.py - sv._downed.py);
        // 救治界面打开时玩家走远 → 自动关闭（界面不悬空）
        if (d >= 1.9 * TS && rescueOpen()) closeRescue();
        if (d < 1.9 * TS) {
            const needMed = B.DOWNED_NEED_MED - (sv._downed.med || 0);
            const needHerb = B.DOWNED_HERB_EQUIV - (sv._downed.herb || 0);
            const progress = needMed > 0
                ? `需伤口药/抗生素×${needMed}` : needHerb > 0
                    ? `需草药×${needHerb}` : '药品已集齐！';
            // 玩家可背起倒地主角（移动时 _downed 跟随玩家，移速减慢），背到床旁/安全点再放下
            if (sv._carryDowned) {
                downedPrompt = { target: { downed: 1, putDown: 1 }, prompt: `放下 ${sv._downed.name} [F]（${progress}）` };
            } else {
                downedPrompt = { target: { downed: 1 }, prompt: `救治 ${sv._downed.name} [F]（${progress}） · 或 背起 [V]` };
            }
        }
    }
    // 2026-08-10 用户需求：队友濒临死亡（_downedMembers）也可按 F 弹出救治界面（无药也能进入看需要什么药）。
    // 优先级：地块 > 尸体 > 队员（命令）> 救治倒地队友 > 救治倒地主控（已有）。
    let downedMatePrompt = null;
    if (Array.isArray(sv._downedMembers) && sv._downedMembers.length) {
        let best = null, bd = 1.9 * TS;
        for (const m of sv._downedMembers) {
            if (!m || !m.alive || !m.downed) continue;
            const d = Math.hypot(m.x - sv.px, m.y - sv.py);
            if (d < bd) { bd = d; best = m; }
        }
        if (best) {
            const needMed = B.DOWNED_NEED_MED - (best.med || 0);
            const needHerb = B.DOWNED_HERB_EQUIV - (best.herb || 0);
            const progress = needMed > 0 ? `需伤口药/抗生素×${needMed}` : needHerb > 0 ? `需草药×${needHerb}` : '药品已集齐！';
            downedMatePrompt = { target: { downedMate: best.id }, prompt: `救治 ${best.name} [F]（${progress}）` };
        }
    }

    if (sv.build) {
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

    let best = null, bestD = 1.9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.floor(ptx) + dx, ty = Math.floor(pty) + dy;
        const t = getTile(sv, tx, ty);
        if (!INTERACT_LABEL[t]) continue;
        if (!containerInteractable(t, tx, ty)) continue;
        if (t === T.DOOR && builtAt(sv, tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - ptx, ty + 0.5 - pty);
        if (d < bestD) { bestD = d; best = { x: tx, y: ty, t }; }
    }
    // NPC：与地块目标比较距离，更近者优先（NPC 站在箱子/车等可交互物体旁也能交谈/命令）
    // 2026-08-10 用户要求"相邻格朝对方向即可交互箱子"：跟随队员（party+follow）总是
    // 贴玩家游荡，会频繁比箱子更近 → 抢占箱子/容器交互，导致"围着箱子一圈都交互不了"。
    // 修复：只要有可交互地块目标（箱子/容器/车/消防栓等），优先地块目标；队员只在
    // 无地块目标时才作为 F 交互对象。
    let nbest = null, nbestD = 1.9 * TS;
    if (sv.npcs) {
        for (const n of sv.npcs) {
            if (!n.alive || n.role === 'hostile') continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;   // 主控角色不显示交互
            // 2026-08-10 倒地者（n.downed，如倒下的主控/队友）不属于"可命令/交谈队友"：
            // 靠近倒地主角应显示"救治 [F]"而非"命令 [F]"（此前倒地记录 alive=true 被当作队员，
            // 命令交互优先级高于救治提示，导致倒地主控旁边按 F 打开命令面板而不是救助）。
            if (n.downed) continue;
            const d = Math.hypot(n.x - sv.px, n.y - sv.py);
            if (d < nbestD) { nbestD = d; nbest = n; }
        }
    }
    const camp = sv.camp;
    const campDist = camp ? Math.hypot(sv.px - camp.x, sv.py - camp.y) : 1e9;
    // 有可交互地块目标时优先地块（否则队员会抢走箱子/容器的 F 交互）
    // 2026-08-10 濒死救治交互优先顺序：可交互地块 > 可命令/交谈队友 > 救治倒地主角。
    // 此前 _downed 分支无条件抢占 F，只要站在倒地点 1.9 格内就永远显示"救治"，
    // 导致切到陈月视角后无法对陈月或其他队友下达命令（召唤/跟随/驾车等全失效）。
    // 2026-08-10 尸体搜索提示：附近有未搜索的尸体（成员死亡遗留）→ 提示"搜索 XX 的尸体 [F]"。
    // 2026-08-11 优先级修正：濒死队友【救治】优先于【命令】。4 人队伍里跟随队友常贴玩家，
    // 若"命令活队友"排在"救治倒地队友"前，靠近倒地队友时提示会被旁边的活队友抢占成"命令"——
    // 用户反馈"救助界面关闭后再开变成了命令面板"。濒死角色不应出现命令面板。
    // 2026-08-11 v2.98 最终优先级修正（用户反馈"濒死队友旁有遗物尸体，交互变成搜索尸体"）：
    // 濒死角色（downed）优先【救治】，尸体（彻底死亡）其次。此前"尸体 > 救治倒地队友"——
    // 濒死倒地时 deathDropLegacy 生成独立遗物尸体（corpse:N，非 downed）就在倒地队友旁边，
    // 尸体搜索抢占救助 → 无救治按钮、按 F 打开搜索。人还活着应先救人。
    // 最终优先级：地块 > 救治倒地队友 > 救治倒地主控 > 尸体 > 队员（命令）。
    let corpseBest = null;
    if (!best && sv.npcs) {
        let cbd = 1.9 * TS;
        for (const n of sv.npcs) {
            // 2026-08-11 v2.97 修复"濒死队友被尸体搜索抢占"（用户反馈：濒死队友还不等于尸体）：
            // 排除 downed 角色（濒死待救 ≠ 尸体）——否则濒死队友若被误标 _corpse（或旁边有旧尸体
            // 更近），交互优先弹"搜索尸体"而非"救助界面"，必须先搜完才救（玩家反馈）。
            // 尸体 = 彻底死亡（alive=false + _corpse）；濒死（downed=true, alive=true）只走救助。
            // 2026-08-11 v2.98 尸变前/后尸体都像容器一样可反复打开搜索界面（用户需求定稿）：
            // 所有尸体（普通/尸变，已搜完掏空与否）都提示搜索；仅排除倒地（downed）角色（走救助）。
            if (!n || !n._corpse || n.downed) continue;
            const d = Math.hypot(n.x - sv.px, n.y - sv.py);
            if (d < cbd) { cbd = d; corpseBest = n; }
        }
    }
    if (best) { sv.promptTarget = best; }
    else if (downedMatePrompt) {
        // 2026-08-10 队友濒死救治：提示链漏用 downedMatePrompt 的 bug 修复——
        // 计算了但从未写入 promptTarget，导致靠近倒地队友按 F 无反应（不弹救助界面）。
        // 2026-08-11 优先级提前到"队员（命令）"之前：濒死队友必须优先显示救治，不显示命令面板。
        // 2026-08-11 v2.98 再提前到"尸体搜索"之前：濒死队友旁常有自身遗物尸体（deathDropLegacy
        // 生成 corpse:N），若尸体优先会弹"搜索尸体"抢占"救治"（用户反馈）。人还活着先救人。
        sv.promptTarget = downedMatePrompt.target;
        sv.prompt = downedMatePrompt.prompt;
        return;
    } else if (downedPrompt) {
        // 2026-08-11 v2.98 倒地主控同样优先于尸体：主控濒死时旁有遗物尸体也应显示"救治/背起"。
        sv.promptTarget = downedPrompt.target;
        sv.prompt = downedPrompt.prompt;
        return;
    } else if (corpseBest) {
        sv.promptTarget = { corpse: corpseBest.id };
        sv.prompt = `搜索 ${corpseBest.name} 的尸体 [F]`;
        return;
    } else if (nbest) {
        sv.promptTarget = { npc: nbest.id };
        sv.prompt = nbest.party ? `命令 ${nbest.name} [F]` : `交谈 ${nbest.name} [F]`;
        return;
    } else { sv.promptTarget = null; }
    // 领地旗帜：站在旗帜附近 → 收起
    if (!best && sv.camp && Math.hypot(sv.px - sv.camp.x, sv.py - sv.camp.y) < 1.2 * TS) {
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
        if (d >= 1.9 * TS) return;
        openRescue();
        return;
    }
    // 2026-08-10 用户需求：队友濒临死亡按 F 弹出救助界面（手动选药救活；无药也能进入看需要什么药）。
    if (tg.downedMate) {
        const m = Array.isArray(sv._downedMembers) ? sv._downedMembers.find(x => x && x.id === tg.downedMate) : null;
        if (!m || !m.alive || !m.downed) return;
        const d = Math.hypot(m.x - sv.px, m.y - sv.py);
        if (d >= 1.9 * TS) return;
        openMateRescue(m.id);
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
        const c = sv.npcs && sv.npcs.find(n => n && n._corpse && !n.downed && n.id === tg.corpse);
        if (!c) return;
        const d = Math.hypot(c.x - sv.px, c.y - sv.py);
        if (d >= 1.9 * TS) return;
        if (WSearch.isOpen() || sv.search) return;   // 已有搜索界面打开 → 忽略
        const contents = c._corpseContents || [];
        // 普通尸体搜完但未尸变：仍可打开空界面（用户需求：尸变前反复打开搜索界面）；内容为空的
        // 尸变尸体（掏空会消失，不应再开）由 onClose 的 splice 处理——此处空内容也开界面（显示空）。
        // if (!contents.length) { c._corpseSearched = true; c._corpseSearchedDay = sv.day; return; }
        // 完整对象映射：给每个完整对象加 _rem（剩余可拿数量），供 takeFromSearch 保留属性入包
        const corpseFull = contents.map(o => ({ ...o, _rem: o.n || 1 }));
        // 与容器一致：done = 已搜索完成（r=1 直接显示），slot = 固定槽位（重开位置不变）
        const items = contents.map(o => ({ id: o.id, n: o.n || 1, done: !!o.r, slot: o.slot }));
        AudioSystem.playOpenBox && AudioSystem.playOpenBox();
        WSearch.openSearch(sv, {
            items,
            name: `搜索 ${c.name} 的尸体`,
            gx: Math.floor(c.x / TS), gy: Math.floor(c.y / TS),
            cap: Math.max(6, contents.length),
            corpseFull,
            onClose: (remaining) => {
                // 2026-08-11 v2.98 尸体搜索定稿（用户确认）：
                //   · 普通尸体（未尸变，非 _revivedCorpse）：掏空后【不消失】，像容器一样可反复打开搜索界面
                //     （空界面），未尸变照样 15 分钟尸变——物品守恒：拿走的数量不再出现，没拿走的保留。
                //   · 尸变尸体（_revivedCorpse，丧尸被击败掉落）：【搜索完彻底消失】（与普通尸体不同）。
                //     掏空（rest 为空）即从 sv.npcs 移除；未掏空时保留、可续搜。
                // 未拿走物品写回尸体（保留完整属性 + r 搜索完成标记 + slot），掏空处理下方分两种。
                const rest = (remaining || []).filter(o => o && o.n > 0).map(o => {
                    const f = corpseFull.find(x => x && x.id === o.id);
                    const base = f ? { ...f } : { id: o.id };
                    delete base._rem;
                    return { ...base, n: o.n, r: !!o.r, slot: o.slot };
                });
                if (c._revivedCorpse) {
                    // —— 尸变尸体：掏空彻底消失，未掏空保留续搜 ——
                    c._corpseContents = rest;
                    if (!rest.length) {
                        // 搜索完 → 从世界移除（尸体消失）
                        if (Array.isArray(sv.npcs)) {
                            const idx = sv.npcs.indexOf(c);
                            if (idx >= 0) sv.npcs.splice(idx, 1);
                        }
                        log(`搜索了 ${c.name} 的尸体（物品已全部取走，尸变尸体消失）`, '#9fd6ff');
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

    if (BOX_ROLL[tg.t]) {
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
        const r = WP.tryTame(sv, tg.x, tg.y, countItem, takeItem);
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
        const names = ['萝卜', '玉米', '土豆'];
        const cn = names[Math.floor(cr * 3) % 3];
        const n = 1 + Math.floor(Math.random() * 2);
        Panel.addItem(sv, 'food', n);
        let extra = '';
        if (Math.random() < 0.30) {
            const seeds = ['seed:peashooter', 'seed:snowpea', 'seed:sunflower'];
            const sid = seeds[Math.floor(Math.random() * seeds.length)];
            Panel.addItem(sv, sid, 1);
            extra = ` + ${Panel.getItemInfo(sid).name}×1`;
        }
        setTile(sv, tg.x, tg.y, T.GROUND);
        log(`采集 ${cn} → 食物×${n}${extra}`);
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

// 街道杂物单件掉落（并入箱子持久化搜索流程；返回 [id,n] 或 null=空手）
function _junkAmmo() {
    const at = B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)];
    const pack = (AMMO_INFO[at] || {}).pack || 20;
    return ['ammo:' + at, Math.max(2, Math.round(pack * (0.2 + Math.random() * 0.3)))];
}
function rollTrashLoot() {
    const r = Math.random();
    if (r < 0.26) return ['food', 1];
    if (r < 0.46) return ['water', 1];
    if (r < 0.58) return ['part', 1];
    if (r < 0.70) return ['herb', 1];
    if (r < 0.78) return ['coin', 2 + Math.floor(Math.random() * 4)];
    if (r < 0.86) return ['fuel', 1];
    return null;
}
function rollCardLoot() {
    const r = Math.random();
    if (r < 0.28) return ['wood', 1 + Math.floor(Math.random() * 2)];
    if (r < 0.46) return ['food', 1];
    if (r < 0.56) return ['part', 1];
    if (r < 0.64) return _junkAmmo();
    if (r < 0.74) return ['coin', 3 + Math.floor(Math.random() * 5)];
    return null;
}
function rollHydrantLoot() {
    const r = Math.random();
    if (r < 0.55) return ['water', 1];
    if (r < 0.70) return ['water', 2];
    if (r < 0.80) return ['part', 1];
    return null;   // 栓里早干了
}
function rollNewsLoot() {
    const r = Math.random();
    if (r < 0.28) return ['food', 1];
    if (r < 0.46) return ['herb', 1];
    if (r < 0.60) return ['wood', 1];
    if (r < 0.70) return ['part', 1];
    return null;   // 只剩烂报纸
}
function rollTiresLoot() {
    const r = Math.random();
    if (r < 0.42) return ['part', 1];
    if (r < 0.54) return ['part', 2];
    if (r < 0.62) return _junkAmmo();
    return null;   // 一堆烂轮胎
}

// ---------- 室内 F 交互（搜索箱子） ----------
function doInteriorInteract() {
    const it = sv.interior;
    if (!it) return;
    // 2026-08-10 室内濒死交互（与室外同步）：靠近倒地主角按 F → 打开救助界面。
    // 室内 _downed.px/py 是室内坐标（与 it.px/it.py 同坐标系），直接判距即可。
    if (sv._downed) {
        const d = Math.hypot(sv._downed.px - it.px, sv._downed.py - it.py);
        if (d < 1.9 * TS) {
            // 背人中：F = 放下倒地主角
            if (sv._carryDowned) {
                sv._carryDowned = false;
                sv._downed.px = it.px; sv._downed.py = it.py;
                log(`你放下了 ${sv._downed.name}`, '#B8C4C8');
                return;
            }
            openRescue();
            return;
        }
    }
    // 2026-08-10 室内队友倒地交互（与室外同步）：靠近倒地队友按 F → 打开队友救助界面
    if (Array.isArray(sv._downedMembers) && sv._downedMembers.length) {
        let best = null, bd = 1.9 * TS;
        for (const m of sv._downedMembers) {
            if (!m || !m.alive || !m.downed) continue;
            const d = Math.hypot(m.x - it.px, m.y - it.py);
            if (d < bd) { bd = d; best = m; }
        }
        if (best) { openMateRescue(best.id); return; }
    }
    // 2026-08-09 室内躲藏幸存者交互：优先最近 NPC（F 打开 NPC 菜单：交谈/交易/邀请）
    if (it.npcs && it.npcs.length) {
        let best = null, bd = 1.9 * TS;
        for (const n of it.npcs) {
            if (!n || n.hp <= 0) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) { openNpcMenu(best.id); return; }
    }
    // 楼梯（2026-08-10 交互式上下楼：站在楼梯旁按 F 触发换层）
    // 2026-08-10 交互距离与其他交互物（队员）一致：≤1.9*TS，替代原"3×3 含斜对角"判定（用户觉得远了）
    for (let gy = 0; gy < it.h; gy++) for (let gx = 0; gx < it.w; gx++) {
        const tile = it.tiles[gy * it.w + gx];
        if (tile !== WD.INTERIOR_TILES.STAIRS_UP && tile !== WD.INTERIOR_TILES.STAIRS_DOWN) continue;
        const dcx = (gx + 0.5) * TS, dcy = (gy + 0.5) * TS;
        if (Math.hypot(it.px - dcx, it.py - dcy) < 1.9 * TS) {
            const dir = tile === WD.INTERIOR_TILES.STAIRS_UP ? 1 : -1;
            WD.changeFloor(sv, dir);
            return;
        }
    }
    // 3×3 内的箱子（2026-08-10 移到队员之前：跟随队员会抢占箱子交互，导致"围着箱子一圈都交互不了"）
    const pgx = Math.floor(it.px / TS), pgy = Math.floor(it.py / TS);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const gx = pgx + dx, gy = pgy + dy;
        if (gx < 0 || gx >= it.w || gy < 0 || gy >= it.h) continue;
        const tile = it.tiles[gy * it.w + gx];
        if (tile === WD.INTERIOR_TILES.BOX || tile === WD.INTERIOR_TILES.WBOX || tile === WD.INTERIOR_TILES.MEDBOX || tile === WD.INTERIOR_TILES.MATBOX) {
            openInteriorBox(gx, gy);
            return;
        }
    }
    // 随玩家进室内的队员（无箱子时才交互：party → 命令面板，同室外）
    if (sv.npcs && sv.npcs.length) {
        let best = null, bd = 1.9 * TS;
        for (const n of sv.npcs) {
            if (!n.alive || !n.inInterior) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;
            if (n.downed) continue;   // 2026-08-10 倒地者不属于可命令/交谈队友（应显示救治）
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) {
            if (best.party) openNpcCommandMenu(best);
            else openNpcMenu(best.id);
            return;
        }
    }
    // 2026-08-10 室内尸体搜索（成员死亡留在房间的尸体，靠近 F 搜索遗物）
    // 2026-08-11 与室外统一：复用【容器搜索界面】（WSearch 面板逐件渐亮，用户定稿"与容器一样即可"）。
    // 室内坐标直接用 it.px/py（房间局部坐标，与 n.x/n.y 同坐标系）。
    if (sv.npcs && sv.npcs.length) {
        let best = null, bd = 1.9 * TS;
        for (const n of sv.npcs) {
            if (!n || !n._corpse || n._corpseSearched) continue;
            const d = Math.hypot(n.x - it.px, n.y - it.py);
            if (d < bd) { bd = d; best = n; }
        }
        if (best) {
            if (WSearch.isOpen() || sv.search) return;   // 已有搜索界面打开 → 忽略
            const contents = best._corpseContents || [];
            if (!contents.length) { best._corpseSearched = true; best._corpseSearchedDay = sv.day; return; }
            const corpseFull = contents.map(o => ({ ...o, _rem: o.n || 1 }));
            AudioSystem.playOpenBox && AudioSystem.playOpenBox();
            WSearch.openSearch(sv, {
                items: contents.map(o => ({ id: o.id, n: o.n || 1, done: false })),
                name: `搜索 ${best.name} 的尸体`,
                gx: Math.floor(best.x / TS), gy: Math.floor(best.y / TS),
                cap: Math.max(6, contents.length),
                corpseFull,
                onClose: (remaining) => {
                    // 2026-08-11 与室外一致：搜完尸体立即移除（详见室外尸体搜索 onClose 注释）
                    const rest = (remaining || []).filter(o => o && o.n > 0).map(o => {
                        const f = corpseFull.find(x => x && x.id === o.id);
                        return f ? { ...f, n: o.n } : { id: o.id, n: o.n };
                    });
                    let taken = 0, dropped = 0;
                    for (const s of rest) {
                        const left = Panel.addItemObj(sv.inv, s);
                        if (left < (s.n || 1)) taken++;
                        else if (left > 0) { sv.drops.push({ ...s, x: best.x, y: best.y, n: left }); dropped++; }
                    }
                    const idx = sv.npcs.indexOf(best);
                    if (idx >= 0) sv.npcs.splice(idx, 1);
                    if (sv._legacyDrop && Math.abs(best.x - sv._legacyDrop.x) < TS && Math.abs(best.y - sv._legacyDrop.y) < TS) sv._legacyDrop = null;
                    log(`搜索了 ${best.name} 的尸体${taken ? `（获得 ${taken} 件）` : ''}${dropped ? `，背包满掉了 ${dropped} 件在地上` : ''}`, '#9fd6ff');
                },
            }, { onUseItem: (idx) => useItem(idx) });
            return;
        }
    }
    log('附近没有可搜索的东西');
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
        if (STREET_JUNK_SET.has(boxType)) {   // 街道杂物：给 1~2 件、可空手、不掺字块
            const rolls = 1 + Math.floor(Math.random() * 2);
            const rollFn = BOX_ROLL[boxType];
            for (let i = 0; i < rolls; i++) {
                const r = rollFn && rollFn();
                if (r) { const [id, n] = r; items.push({ id, n }); }
            }
            return items;
        }
        const rolls = 2 + Math.floor(Math.random() * 2);
        const rollFn = BOX_ROLL[boxType] || rollSupplyLoot;
        for (let i = 0; i < rolls; i++) {
            const [id, n] = rollFn();
            items.push({ id, n });
        }
        const source = boxType === T.WBOX ? 'weapon' : boxType === T.MEDBOX ? 'medical' : boxType === T.MATBOX ? 'material' : 'supply';
        items.push(...rollWordAddon(source, gx, gy));
        return items;
    } finally {
        Math.random = _mr;
    }
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
    const options = { modifier: wordRegionModifier(gx, gy) };
    const result = WW.rollWordLootOutcome(source, table, options);
    return result.items;
}

// ---------- 搜刮掉落表（按箱型分表，不是所有资源都能从同一种箱子里开出来） ----------
function rollSupplyLoot() {
    const r = Math.random();
    if (r < 0.36) return ['wood', 1 + Math.floor(Math.random() * 3)];
    if (r < 0.44) return ['food', 1 + Math.floor(Math.random() * 2)];
    if (r < 0.60) return ['herb', 1 + Math.floor(Math.random() * 2)];
    if (r < 0.74) return ['stone', 1 + Math.floor(Math.random() * 2)];
    if (r < 0.79) return ['part', 1];
    if (r < 0.82) return ['tool:hoe', 1];
    if (r < 0.87) return ['coin', 5 + Math.floor(Math.random() * 8)];
    if (r < 0.90) return ['flag', 1];
    const at = B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)];
    return ['ammo:' + at, 3 + Math.floor(Math.random() * 6)];
}
function rollWeaponLoot() {
    const r = Math.random();
    if (r < 0.35) {
        const rr = Math.random();
        const tier = rr < 0.60 ? 'common' : (rr < 0.90 ? 'rare' : 'epic');
        const pool = B.LOOT_WEAPONS[tier];
        return ['wpn:' + pool[Math.floor(Math.random() * pool.length)], 1];
    }
    if (r < 0.75) {
        const at = B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)];
        const pack = (AMMO_INFO[at] || {}).pack || 20;
        return ['ammo:' + at, Math.max(4, Math.round(pack * (0.5 + Math.random() * 0.5)))];
    }
    if (r < 0.90) return ['part', 1];
    if (r < 0.95) return ['stone', 1 + Math.floor(Math.random() * 2)];
    return ['flag', 1];   // 武器箱 5%：战利品里翻出一面领地旗帜
}
function rollMedicalLoot() {
    const r = Math.random();
    if (r < 0.22) return ['herb', 1 + Math.floor(Math.random() * 3)];
    if (r < 0.36) return ['med:cold', 1];
    if (r < 0.50) return ['med:wound', 1];
    if (r < 0.60) return ['med:poison', 1];
    if (r < 0.70) return ['med:dysentery', 1];
    if (r < 0.78) return ['med:heat', 1];
    if (r < 0.88) return ['med:pan', 1];
    if (r < 0.93) return ['food', 1 + Math.floor(Math.random() * 2)];
    if (r < 0.97) return ['water', 1];
    return ['fert', 1];
}
function rollMaterialLoot() {
    const r = Math.random();
    if (r < 0.35) return ['wood', 2 + Math.floor(Math.random() * 3)];
    if (r < 0.60) return ['stone', 1 + Math.floor(Math.random() * 3)];
    if (r < 0.75) return ['part', 1];
    if (r < 0.82) return ['tool:chopper', 1];
    if (r < 0.89) return ['tool:pick', 1];
    if (r < 0.93) return ['tool:wrench', 1];
    const at = B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)];
    return ['ammo:' + at, 3 + Math.floor(Math.random() * 6)];
}
const BOX_ROLL = {
    [T.BOX]: rollSupplyLoot, [T.WBOX]: rollWeaponLoot,
    [T.MEDBOX]: rollMedicalLoot, [T.MATBOX]: rollMaterialLoot,
    [T.TRASHBIN]: rollTrashLoot, [T.CARDBOX]: rollCardLoot,
    [T.HYDRANT]: rollHydrantLoot, [T.NEWSSTAND]: rollNewsLoot, [T.TIRES]: rollTiresLoot,
};
const BOX_NAME = {
    [T.BOX]: '物资箱', [T.WBOX]: '武器箱', [T.MEDBOX]: '医疗箱', [T.MATBOX]: '建材箱',
    [T.TRASHBIN]: '垃圾桶', [T.CARDBOX]: '纸箱', [T.HYDRANT]: '消防栓', [T.NEWSSTAND]: '报刊亭', [T.TIRES]: '废弃轮胎',
};

// 汽车搜刮：武器/弹药/零件为主
function rollCarLoot() {
    const r = Math.random();
    if (r < 0.25) {
        const rr = Math.random();
        const tier = rr < 0.6 ? 'common' : (rr < 0.92 ? 'rare' : 'epic');
        const pool = B.LOOT_WEAPONS[tier];
        return ['wpn:' + pool[Math.floor(Math.random() * pool.length)], 1];
    }
    if (r < 0.70) {
        const at = B.LOOT_AMMO[Math.floor(Math.random() * B.LOOT_AMMO.length)];
        const pack = (AMMO_INFO[at] || {}).pack || 20;
        return ['ammo:' + at, Math.max(6, Math.round(pack * (0.6 + Math.random() * 0.5)))];
    }
    if (r < 0.78) return ['fuel', 1];
    if (r < 0.88) return ['part', 1];
    if (r < 0.95) return ['food', 1 + Math.floor(Math.random() * 2)];
    return ['wood', 1 + Math.floor(Math.random() * 2)];
}

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
        log('从消防栓里放了一点水 → 水×1');
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
function deathDropLegacy(sv, deadName) {
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
        // 未设置床：随机地点复活（与初始出生一致：随机角度，距中心 10~16 区块）
        const ang = Math.random() * Math.PI * 2;
        const dist = (10 + Math.random() * 6) * CHUNK;
        rx = Math.round(Math.cos(ang) * dist + 0.5) * TS;
        ry = Math.round(Math.sin(ang) * dist + 0.5) * TS;
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
    // 不同（画内 reborn 分支显示"你 醒 了 过 来"）。时长比开场 2.4s 略长（3s）。
    sv._wake = { t: 0, dur: 3, reborn: true };
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
function corpseReviveZombie(sv, n) {
    const contents = (n._corpseContents || []).filter(s => s && s.n > 0);
    const name = (n.name || '幸存者') + B.CORPSE_REVIVE_TAG;
    // 2026-08-11 v2.98 用户要求：**尸变僵尸攻击逻辑与正常僵尸完全一致**（室内室外、单机联机同步）。
    // 之前复用 spawnPlayerZombie（精英玩家僵尸 isPlayerZombie:true）——会用背包继承的远程武器射击玩家、
    // 近战伤害/速度/血量按精英系数强化，与普通僵尸行为不同。现改为用普通僵尸生成 spawnZombie(sv, 'normal', ...)：
    //   · 攻击逻辑 = 普通僵尸（近战啃咬、无远程射击、普通伤害/速度/血量随天数成长）；
    //   · 室内室外：spawnZombie 已支持 sv.interior（生成进室内僵尸数组，室外进 sv.zombies）；
    //   · 单机联机：id 用 sv._zIdSeq（联机快照差分同步），与普通僵尸一致。
    // 只继承尸体本人的名字与外观（角色/肤色/上衣），不继承远程武器（无远程射击）。
    const z = WZ.spawnZombie(sv, 'normal', n.x, n.y, false);
    z.name = name;                       // 尸变僵尸名（保持"XX（尸变）"）
    // 2026-08-12 v2.99 用户定稿：尸变丧尸攻击逻辑与正常僵尸一样。
    // 移除 v2.99"留家不追玩家"的 _deathHomeX/Y 记录——尸变丧尸与普通僵尸一致（主动追玩家/正常寻路）。
    z.inv = contents.map(s => ({ ...s }));   // 背包守恒：尸体未搜物品给尸变丧尸（被击败掉回尸变尸体）
    // 2026-08-11 v2.98 测试玩家发现：尸变丧尸外观继承尸体本人（n.look），而非当前主控 sv.character——
    // 否则队友（老陈）尸体尸变后外观是"幸存者"（当前操控者），名字对但形象错。
    if (n.look) {
        z.char = (n.look.skin) ? '亡' : '尸';
        z.skin = n.look.skin || '#78936b';
        z.color = n.look.shirt || '#58656d';
        z.look = n.look;
    }
    z._reviveFromCorpse = true;          // 标记：尸变丧尸（被击败掉尸变尸体）
    z._reviveCorpseName = name;          // 尸变尸体名
    // 移除尸体记录（已尸变）
    const idx = sv.npcs.indexOf(n);
    if (idx >= 0) sv.npcs.splice(idx, 1);
    log(`${n.name} 的尸体尸变了！变成了「${name}」……`, '#FF5544');
    AudioSystem.playZombieSpawn && AudioSystem.playZombieSpawn();
    return z;
}
// 尸变丧尸被击败 → 掉「XX（尸变）」尸体（物品 = 丧尸背包，守恒；搜索完彻底消失）
// 由僵尸死亡清理处（wzombie.updateZombies / windoor / survival 清理）调用
export function reviveZombieToCorpse(sv, z) {
    if (!z || !z._reviveFromCorpse) return;
    const contents = (z.inv || []).filter(s => s && s.n > 0).map(s => ({ ...s }));
    const corpseName = z._reviveCorpseName || (z.playerName || '幸存者') + B.CORPSE_REVIVE_TAG;
    if (!Array.isArray(sv.npcs)) sv.npcs = [];
    sv.npcs.push({
        id: 'rev' + ((sv._revSeq = (sv._revSeq || 0) + 1)),
        isPlayer: false, name: corpseName, role: 'friendly', look: null,
        x: z.x, y: z.y, hp: 0, maxHp: 100, alive: false,
        _corpse: true, _corpseDay: sv.day,
        _corpseAtReal: sv.now != null ? sv.now : 0,   // 记录时刻（尸变尸体不二次尸变）
        _corpseContents: contents, _corpseSearched: false,
        _revivedCorpse: true,   // 标记：尸变尸体（不二次尸变，搜索完彻底消失）
        inInterior: false, interiorKey: null, interiorFloor: null,
        atkCd: 0, hurtT: 0, idleT: 0, workT: 0, campTask: null, _nextNeed: 2,
    });
    log(`${corpseName} 被击败，留下尸变的尸体（可搜索）……`, '#9fd6ff');
}
// 每帧尸变检测：未尸变的尸体倒计时到 → 尸变（节流 0.25s，防多尸体同时处理开销）
// 2026-08-11 v2.99 修复"队友尸变的僵尸瞬移到主控身边"：
// 尸变检测在【大世界循环】和【室内循环】各调一次，此前两处都遍历全部尸体——室内尸体
// （inInterior=true）在大世界循环被尸变时，spawnZombie 以 sv.interior 判定场景，主控在室外
// 则僵尸被生成进室外数组、却带着室内坐标 → 坐标错乱，看起来"瞬移到主控身边"。
// 修复：按当前场景过滤——室外模式只尸变室外尸体，室内模式只尸变当前房间的室内尸体。
function updateCorpseRevive(sv, dt, mode) {
    if (!sv || !Array.isArray(sv.npcs) || !sv.npcs.length) return;
    if (sv._corpseReviveT != null && sv.now - sv._corpseReviveT < 0.25) return;
    sv._corpseReviveT = sv.now;
    const indoor = mode === 'indoor';
    for (let i = sv.npcs.length - 1; i >= 0; i--) {
        const n = sv.npcs[i];
        if (!n._corpse || n._revived) continue;   // 非尸体 / 已尸变跳过
        if (n._revivedCorpse) continue;           // 尸变尸体不二次尸变
        if (indoor) {
            // 室内模式：只尸变当前房间内的尸体（interiorKey 匹配，避免 A 房间尸体在 B 房间尸变坐标错位）
            if (!n.inInterior) continue;
            if (n.interiorKey && sv.interior && sv.interior.key && n.interiorKey !== sv.interior.key) continue;
        } else {
            if (n.inInterior) continue;           // 室外模式：室内尸体由室内循环负责
        }
        const at = n._corpseAtReal != null ? n._corpseAtReal : (sv.now || 0);
        if (sv.now - at >= B.CORPSE_REVIVE_SECONDS) {
            n._revived = true;   // 防重入
            try { corpseReviveZombie(sv, n); } catch (e) { /* 生成失败不阻塞 */ }
        }
    }
}
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
            // 同位置时按距离（主控在室内用室内坐标，室外用世界坐标）
            const ax = sv.interior ? a.x : a.x, ay = sv.interior ? a.y : a.y;
            const bx = sv.interior ? b.x : b.x, by = sv.interior ? b.y : b.y;
            const da = Math.hypot(ax - sv.px, ay - sv.py);
            const db = Math.hypot(bx - sv.px, by - sv.py);
            return da - db;
        });
    if (dk.soft) {
        // ================= 软核（正常）：倒地救治 =================
        // 有存活队友 → 队友把倒地主角带回重生点（床）→ 切队友视角 → 限时搜药救治；
        // 无存活队友 → 重生（有床用床/无床随机）+ 重生点刷"玩家名"僵尸。
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
    const anyAliveMate = mates.length >= 1 || controllerAlive || playerAlive
        || (sv.p2 && !sv.p2.inInterior) || (sv.p2s && Object.values(sv.p2s).some(p => !p.inInterior));
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
        if (typeof localStorage !== 'undefined') {
            try {
                if (seed != null) localStorage.removeItem('u:' + ((getSession && getSession() && getSession().username) || '__guest__') + ':wasteland_world_' + seed);
                if (charName) localStorage.removeItem('u:' + ((getSession && getSession() && getSession().username) || '__guest__') + ':wasteland_character_' + charName);
                localStorage.removeItem('u:' + ((getSession && getSession() && getSession().username) || '__guest__') + ':wasteland_profile');
            } catch (e) { /* 清理失败不阻塞退出 */ }
        }
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

// 软核倒地救治：提交药品（单机 doInteract / 联机 downedMed 事件共用）
// 返回 true=已提交，false=无药；集齐自动救活。
export function downedMedSubmit(sv, med, herb) {
    if (!sv || !sv._downed) return false;
    if (med) sv._downed.med = (sv._downed.med || 0) + med;
    if (herb) sv._downed.herb = (sv._downed.herb || 0) + herb;
    if ((sv._downed.med || 0) >= B.DOWNED_NEED_MED || (sv._downed.herb || 0) >= B.DOWNED_HERB_EQUIV) {
        // 2026-08-10 救活"真正倒下的记录"（可能是队友，而非固定 isPlayer）：
        // 否则二次倒地救活时清的是 isPlayer，真正倒下的队友记录 downed 残留 → 二次救治异常。
        const pc = sv.npcs.find(n => n.downed) || sv.npcs.find(n => n.id === 'player' || n.isPlayer);
        // 2026-08-10 用户要求"救起来 30% 血量，其他状态保持原样（濒临死亡之前是什么样就是什么样）"：
        // 不再清感染/疾病（此前 pc.infection = 0; pc.sick = null 重置状态）。
        if (pc) { pc.downed = false; pc.alive = true; pc.hp = Math.max(1, Math.round(pc.maxHp * 0.3)); }
        // 2026-08-11 v2.99 救活的角色记录死因同样清空（防 onDeath 3628 残留旧值被下次复用）
        if (pc) pc._deathReason = null;
        const name = sv._downed.name || '幸存者';
        sv._downed = null;
        // 2026-08-10 用户要求"救活后死亡地点标志消失"：人被救活了，死亡地点指引不再需要。
        // （此前保留指引是为了找回死亡位置，但救活后该位置已无意义——尸体仍在原地可搜索，
        // 且 _lastDeathPos 持久记录仍保留，不影响开发者传送死亡点功能。）
        sv._legacyDrop = null;
        sv._waitDowned = false;   // 救活解除原地等待限制
        // 2026-08-11 v2.99 救活后清死因残留：防"被救活后再次死亡，弹窗仍显示上次死因"。
        // 救活 = 角色恢复健康，下次死亡按新的状态/攻击来源重新推断。
        sv._deathReason = null;
        sv._lastHitBy = null;
        // 2026-08-10 状态保留：不重置感染/疾病（用户要求"其他状态保持原样"）
        log(`${name} 被救活了！`, '#7DFF7D');
        saveNow();
    }
    return true;
}
// 软核倒地救治状态机（2026-08-09）：每帧推进，职责：
//   ① 超时检测：倒地超过 DOWNED_LIMIT_DAYS → 主角彻底死亡 → 重生点刷"玩家名"僵尸（延迟 1 天）
//   ② NPC 背人：指派最近存活队友把倒地主角背回床旁（moveToward 寻路；无床则原地不动等待救援）
//   ③ 倒地主角跟随：切视角后玩家操控队友，倒地主角留在原地
// 药品提交在 doInteract（F 键）完成，集齐后清 _downed 救活。

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
        pushDeath(m.name || m.id, m._deathReason);
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
    Panel.showDeathChoices(
        `<div class="wsl-death-title">${hadAnyMate ? '全员阵亡' : '你 阵 亡 了'}</div>` +
        `<div class="wsl-death-sub">${hadAnyMate ? '队伍已无人幸存……' : '你独自一人倒在了荒原上……'}</div>` +
        `<div class="wsl-death-details">${detailHtml}</div>` +
        `<div class="wsl-death-hint">软核模式：你可以重生继续，或返回主菜单。</div>`,
        [
            // 2026-08-11 v2.98 用户需求：死亡音效只在点击"重生/返回主菜单"时播放——
            // 重生按钮走 doRespawn → softRespawn 结尾播放（3437 行）；返回主菜单此处补播。
            { label: '重生', cls: 'primary', onClick: () => { Panel.hideDeath(); doRespawn(); } },
            { label: '返回主菜单', cls: 'danger', onClick: () => { AudioSystem.playDefeat(); Panel.hideDeath(); sv.dead = true; exitWasteland(true); } },
        ]);
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
// 2026-08-11 v2.98 用户需求：救援时间随濒死次数递减——第一次 20 分钟，第二次 10 分钟，
// 第三次 5 分钟……每次减半（-50%），最低兜底 60 秒（防止次数过多减到 0）。
// 次数=1 → 20 分钟（默认）；次数=n → 20 分钟 / 2^(n-1)，下限 60 秒。
function downedLimitForCount(count) {
    const base = B.DOWNED_LIMIT_SECONDS || 1200;
    const n = Math.max(1, Math.floor(count || 1));
    const half = Math.pow(2, n - 1);
    return Math.max(60, Math.round(base / half));
}
function updateDowned(sv, dt, canStand) {
    const dwn = sv._downed;
    // 2026-08-10 软核成员倒地：主控未倒地但存在倒地成员（_downedMembers）时，只跑成员超时管理，
    // 不执行主控的背人/救治（dwn 为 null 时跳过下方主控专属逻辑）。
    if (!dwn) { updateDownedMembersTimeout(sv); return; }
    // 2026-08-11 v2.98 用户需求：救援界面时间与游戏内头顶倒计时实时同步——救援界面打开时刷新。
    // 2026-08-11 节流（0.25s）：避免每帧重建 DOM 导致"关闭按钮"点击丢失/卡顿（用户反馈关不掉）。
    if (rescueOpen()) {
        sv._rescueRefreshT = (sv._rescueRefreshT || 0) - dt;
        if (sv._rescueRefreshT <= 0) { sv._rescueRefreshT = 0.25; renderRescue(); }
    }
    // 玩家背人中：倒地主角跟随玩家移动（背到床旁/安全点），此时不触发队友自动背人
    if (sv._carryDowned) {
        dwn.px = sv.px; dwn.py = sv.py;
        // 2026-08-10 修复"背起濒死玩家后图片留在原地"：渲染走 NPC 记录的 x/y（drawNpcs/室内 drawNpcs
        // 遍历 sv.npcs 画 n.downed 记录），此前只更新 _downed.px/py 不同步记录坐标 → 图片原地。
        // 同步"倒下的记录"的 x/y（含室内坐标）→ 背起后图片跟随玩家。
        const pc = (sv.npcs || []).find(n => n.downed) || (sv.npcs || []).find(n => n.isPlayer);
        if (pc) {
            pc.x = sv.px; pc.y = sv.py;
            // 2026-08-10 濒死角色跨场景：背人跨过场景边界（进门/出门）时，倒地主控记录的
            // inInterior 必须与玩家当前场景一致，否则室内/室外渲染都不画它（用户在另一侧看不到）。
            if (sv.interior) { pc.inInterior = true; pc.interiorKey = sv.interior.key; pc.interiorFloor = sv.interior.floor || 1; }
            else { pc.inInterior = false; pc.interiorKey = null; pc.interiorFloor = null; }
        }
    }
    // ① 队友全灭检测（2026-08-10 修订）：倒地主角之外的所有**可行动** party 队友（含真人队友）
    //    都阵亡 **或濒死** → 无人能救 → 主角直接死亡 → 软核重生（掉落惩罚已发生过，重生方式同普通死亡）
    //    排除：倒地主角本人记录（isPlayer）与当前操控者（controllerId）——他们是"被救方"不是"施救方"。
    //    濒死（downed）队友不算可行动：他们同样躺倒等人救，无法施救（用户需求：队友全濒死 → 全员死亡）。
    const mates = (sv.npcs || []).filter(n => n.alive && !n.downed && n.party && n.id !== sv.controllerId && !n.isPlayer);
    // 2026-08-10 软核成员倒地机制：倒地成员（_downedMembers）不能行动也不能救主控——
    // 只有【可行动】队友才算"能救的人"。主控倒地 + 全部成员倒地（无人能行动）时，
    // 视为"全员濒死 = 无人可救"→ 直接全员彻底死亡 + 生尸体（防卡死等待）。
    // 此前 anyDownedMember 计入可救 → 主控+成员全倒地时 anyMateAlive=true → 永不结算，游戏卡死。
    // 2026-08-11 v2.97 "当前主控自己活着"也算可行动者：避免只剩 1 个活人（当前主控）时
    // `mates` 因 controllerId/isPlayer 排除变空 → 误判"全员阵亡"弹窗。同 onDeath 一致逻辑：
    // controllerId 角色活着 / isPlayer 角色活着 / 联机队友存活 任一即 anyMateAlive=true。
    const _udc = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);
    const _udp = (sv.npcs || []).some(n => n.isPlayer && n.alive && !n.downed);
    const anyMateAlive = mates.length >= 1 || !!(_udc && _udc.alive && !_udc.downed) || _udp
        || (sv.p2 && !sv.p2.inInterior) || (sv.p2s && Object.values(sv.p2s).some(p => !p.inInterior));
    if (!anyMateAlive) {
        // 2026-08-11 全灭弹窗（用户需求）：倒地主控 + 全部队友阵亡/倒地（无人能救）→
        // 弹「重生」+「返回主菜单」UI（含每人击败详情），点"重生"才 softRespawn。
        // 此前直接 softRespawn 无弹窗（用户反馈"队员阵亡没弹重生/返回主菜单"）。
        log(`${dwn.name} 的队友全部阵亡或濒死，无人能救……`, '#FF5544');
        // 2026-08-11 v2.96 加 typeof 兜底：双保险，杜绝 ReferenceError 把 updateDowned 卡死
        if (typeof showAllDeadChoices === 'function') {
            showAllDeadChoices(sv, dwn.name, dwn.deathReason || '战斗中被击败', '');
        } else {
            _softRespawnAllDeadFallback(sv, dwn.name, dwn.deathReason || '战斗中被击败');
        }
        return;
    }
    // ② 超时 → 彻底死亡 → 重生点刷"玩家名"僵尸（延迟 DOWNED_PZ_DELAY_DAYS 天）
    // 2026-08-11 v2.97 现实时间救援倒计时（用户定稿）：
    //   濒死可救治总时长 = DOWNED_LIMIT_SECONDS(20 分钟现实时间)；sv.now 是现实秒。
    //   被攻击（补刀）不立即死亡，而是每 1 点伤害扣 DOWNED_HIT_PENALTY_SEC(10) 秒救援时间；
    //   累计消耗（自然流逝 + 被攻击惩罚）≥ 20 分钟 → 彻底死亡（可被队友搜药救活的时间窗口结束）。
    if (dwn.downedAtReal == null) dwn.downedAtReal = (sv.now != null ? sv.now : 0);   // 旧档兼容：缺失则从当前时刻起算
    if (dwn._penaltySec == null) dwn._penaltySec = 0;
    const nowReal = sv.now != null ? sv.now : 0;
    const spent = Math.max(0, nowReal - dwn.downedAtReal) + (dwn._penaltySec || 0);
    // 2026-08-11 v2.98 救援时间随濒死次数递减：优先用 _downed.limitSec（创建时按次数算出），
    // 旧档/无该字段时回退默认 DOWNED_LIMIT_SECONDS（向后兼容，不破坏既有档）。
    const dwnLimitSec = dwn.limitSec || B.DOWNED_LIMIT_SECONDS;
    if (spent >= dwnLimitSec) {
        if (!dwn._pzScheduled) {
            // 2026-08-11 v2.98 用户需求：救援时间到了 → 自动关闭救援界面（主角彻底死亡，界面无意义）
            if (rescueOpen()) closeRescue();
            // 2026-08-11 v2.97 现实时间耗尽 → 彻底死亡；再经 DOWNED_PZ_DELAY_DAYS(1天) 尸变
            // （尸变仍用游戏天数调度，保持跨会话一致）。
            dwn._pzScheduled = sv.day + B.DOWNED_PZ_DELAY_DAYS;
            log(`${dwn.name} 救治超时，已彻底死亡……`, '#FF5544');
            // 倒下的名册记录清除（已死亡）；2026-08-10 可能是队友记录而非固定 isPlayer
            const pc = sv.npcs.find(n => n.downed) || sv.npcs.find(n => n.id === 'player' || n.isPlayer);
            if (pc) {
                pc.alive = false; pc.downed = false; pc.hp = 0;
                // 2026-08-11 v2.98 测试玩家发现①：主控补刀/超时彻底死亡后没有 _corpse 标记 →
                // 尸体不生成 → 不能搜索遗物。补设尸体（可搜索 + 尸变倒计时，与成员一致）。
                // 2026-08-11 v2.98 测试玩家发现②（本轮）：isPlayer 主角的遗物已由 deathDropLegacy
                // 生成独立 corpse: 尸体（含全部背包），**不应再给 player 记录生成第二具尸体** →
                // 重生后脚下"双尸体"（corpse:1 遗物 + player 重复）。仅非 isPlayer 的倒地主控
                //（切视角后的队友）才补尸体。原主控（isPlayer）只置死，遗物由 corpse: 承载。
                if (!pc.isPlayer && !pc._corpse) {
                    pc._corpse = true;
                    pc._corpseDay = sv.day;
                    pc._corpseAtReal = sv.now != null ? sv.now : 0;
                    pc._corpseContents = [];
                    for (const s of pc.inv || []) { if (s) pc._corpseContents.push({ ...s, n: s.n || 1 }); }
                    pc._corpseSearched = false;
                    log(`${pc.name} 的尸体留在原地（靠近搜索 [F]）……`, '#9fd6ff');
                }
            }
        }
        // 延迟天数到 → 在重生点（床）刷尸
        if (sv.day >= dwn._pzScheduled) {
            let rx, ry;
            if (sv.homeBed) { rx = (sv.homeBed.x + 0.5) * TS; ry = (sv.homeBed.y + 0.5) * TS; }
            else { rx = dwn.px; ry = dwn.py; }
            WZ.spawnPlayerZombie(sv, { x: rx, y: ry, name: dwn.name });
            log(`重生点出现了一只「${dwn.name}」的僵尸……`, '#FF5544');
            sv._downed = null;
            saveNow();
        }
        return;
    }
    // ③ NPC 背人：队友清完周围怪物后，才把倒地主角背回床旁（有床）/原地等待（无床）
    //    战斗优先：附近有僵尸/恶意NPC 未清除 → 队友先战斗（NPC 跟随 AI 的 combatThreat 已自动清怪，
    //    此处仅在安全时驱动背人，避免队友带着怪跑去背人）
    if (dwn._pzScheduled) return;   // 已排期尸变，不再背人
    if (sv._carryDowned) return;    // 玩家正背着主角，NPC 不再重复背
    const threatNear = (sv.zombies || []).some(z => z.hp > 0 && Math.hypot(z.x - dwn.px, z.y - dwn.py) < 8 * TS)
        || (sv.npcs || []).some(o => o.alive && o.role === 'hostile' && Math.hypot(o.x - dwn.px, o.y - dwn.py) < 8 * TS);
    if (!threatNear && mates.length >= 1) {
        // 优先选择被命令背人的 NPC（_carryOrder）；否则取最近队友
        const mate = mates.find(m => m._carryOrder) || mates[0];
        // 2026-08-09 修复"原地等待时视角被带走（随机传送）"：
        // 玩家选「原地等待」(_waitDowned) 时，视角锚点在倒地主角；若这里把 dwn.px/dwn.py 移到床旁，
        // 倒地主角（当前视角）瞬间跳变到床位置 → 视觉上"随机传送"。
        // 修复：原地等待时不背回床旁（倒地主角原地不动），队友守候身边送药；仅切队友视角时才有床背回。
        // 注意不能清 sv.homeBed（那会永久丢床存档），仅本次逻辑上不走背回分支。
        if (sv.homeBed && !sv._waitDowned) {
            // 有床：背回床旁（复用 moveToward 寻路）
            const bx = (sv.homeBed.x + 0.5) * TS, by = (sv.homeBed.y + 0.5) * TS;
            const md = Math.hypot(mate.x - bx, mate.y - by);
            if (md > TS * 1.5) {
                WNPC.moveToward(sv, mate, bx, by, dt, canStand);
            } else {
                // 已到床旁：倒地主角也随队友到位（视觉上"被背回床旁"）
                dwn.px = bx; dwn.py = by;
                mate._carryOrder = false; mate.state = 'follow';   // 送达解除命令
                log(`${mate.name} 将 ${dwn.name} 送到了床旁`, '#7fd6ff');
            }
        } else {
            // 无床：原地救治——队友守候在倒地主角旁（等待玩家送药）
            const md = Math.hypot(mate.x - dwn.px, mate.y - dwn.py);
            if (md > TS * 2) WNPC.moveToward(sv, mate, dwn.px, dwn.py, dt, canStand);
            else { mate._carryOrder = false; mate.state = 'follow'; }
        }
    }
    // ④ 软核成员倒地（2026-08-10）：倒地成员超时管理（与主控倒地超时同规则 DOWNED_LIMIT_DAYS）。
    updateDownedMembersTimeout(sv);
}

// 2026-08-10 软核成员倒地管理：超时 → 真正死亡；玩家/队友靠近倒地成员且持有药品 → 自动救助。
function updateDownedMembersTimeout(sv) {
    // 2026-08-11 v2.98 用户需求：队友救援界面时间与游戏内头顶倒计时实时同步——界面打开时刷新。
    // mateRescueOpen 状态 = mateRescueId 非空（renderMateRescue 内部用 rescueEl/mateRescueId）。
    // 节流（0.25s，用 sv.now）：避免每帧重建 DOM 导致按钮点击丢失（与主控救援界面一致）。
    if (mateRescueId != null && typeof renderMateRescue === 'function') {
        const _now = sv.now != null ? sv.now : performance.now();
        if (_now - (sv._mateRescueRefreshAt || 0) >= 0.25) { sv._mateRescueRefreshAt = _now; renderMateRescue(); }
    }
    // 2026-08-11 v2.97 队友背起（界面一致需求）：背起的倒地队友坐标跟随玩家，
    // 与主控背起 _carryDowned 完全一致（含室内跨场景坐标同步）。
    if (sv._carryMateId) {
        const cm = Array.isArray(sv._downedMembers) ? sv._downedMembers.find(x => x && x.id === sv._carryMateId) : null;
        if (!cm || !cm.alive || !cm.downed) { sv._carryMateId = null; }
        else {
            cm.x = sv.px; cm.y = sv.py;
            if (sv.interior) { cm.inInterior = true; cm.interiorKey = sv.interior.key; cm.interiorFloor = sv.interior.floor || 1; }
            else { cm.inInterior = false; cm.interiorKey = null; cm.interiorFloor = null; }
        }
    }
    if (!sv._downedMembers || !sv._downedMembers.length) return;
    for (let i = sv._downedMembers.length - 1; i >= 0; i--) {
        const m = sv._downedMembers[i];
        if (!m || !m.alive || !m.downed) {
            // 2026-08-11 v2.97 被移除的是正在背起的队友 → 清 _carryMateId（防悬空）
            if (sv._carryMateId === m.id) sv._carryMateId = null;
            // 2026-08-11 v2.98 测试玩家发现（用户反馈"濒死队友不能救援，没有提示"）：
            // 若成员【活着但非 downed】（异常状态被移除，如某路径误清 downed）且无 _corpse →
            // 直接 splice 会让它凭空消失（既不能救治也不能搜索）。防御：保留为尸体（可搜索遗物），
            // 避免"人凭空蒸发"。
            if (m && m.party && !m._corpse) {
                m.downed = false; m.alive = false; m.hp = 0;
                m._deathReason = m._deathReason || '战斗中倒地（状态异常）致死';
                m._corpse = true;
                m._corpseDay = sv.day;
                m._corpseAtReal = sv.now != null ? sv.now : 0;
                m._corpseContents = [];
                for (const s of m.inv || []) { if (s) m._corpseContents.push({ ...s, n: s.n || 1 }); }
                m._corpseSearched = false;
                log(`${m.name} 倒下了（状态异常，保留尸体可搜索）……`, '#FFB347');
            }
            sv._downedMembers.splice(i, 1);
            continue;
        }
        // 2026-08-11 v2.97 现实时间救援倒计时（与主控 _downed 一致）：成员倒地也是现实 20 分钟
        if (m._downedAtReal == null) m._downedAtReal = (sv.now != null ? sv.now : 0);
        if (m._penaltySec == null) m._penaltySec = 0;
        const spentM = Math.max(0, (sv.now != null ? sv.now : 0) - m._downedAtReal) + (m._penaltySec || 0);
        // 2026-08-11 v2.98 成员救援时间随濒死次数递减：用 m.limitSec（killNpc/切视角入队时按次数算出），旧档回退默认
        const mLimit = m.limitSec || B.DOWNED_LIMIT_SECONDS;
        // 超时 → 真正死亡
        if (spentM >= mLimit) {
            log(`${m.name} 救治超时，已死亡……`, '#FF5544');
            m.downed = false; m.alive = false; m.hp = 0;
            m._deathReason = m._deathReason || '救援时间耗尽致死';   // 2026-08-11 v2.98 击败详情（全灭弹窗）
            // 2026-08-10 疏漏修复：超时死亡的成员同样生成尸体遗物（与 killNpc 的 party 死亡一致）——
            // 此前只置 alive=false 不留 _corpse，导致该队友尸体消失、遗物全丢（用户要求成员尸体留原地搜索）。
            m._corpse = true;
            m._corpseDay = sv.day;   // 记录死亡天数（超期腐烂清理用）
            // 2026-08-11 v2.98 尸体尸变系统：记录尸体生成现实时刻
            m._corpseAtReal = sv.now != null ? sv.now : 0;
            m._corpseContents = [];
            for (const s of m.inv || []) {
                if (!s) continue;
                // 保留完整物品对象（武器耐久/附魔等属性，用户要求"物品功能不会丧失"）
                m._corpseContents.push({ ...s, n: s.n || 1 });
            }
            m._corpseSearched = false;
            // 2026-08-11 v2.97 超时死亡的若是正在背起的队友 → 清 _carryMateId
            if (sv._carryMateId === m.id) sv._carryMateId = null;
            sv._downedMembers.splice(i, 1);
            continue;
        }
        // 2026-08-10 用户需求变更：移除自动救助——倒地成员不再被玩家/队友靠近就自动消耗药品救活。
        // 改为按 F 打开救助界面（updatePrompt 提示"救治 XX [F]"→ doInteract 的 downedMate 分支）
        // 手动选择药品救活（无药也能进入查看需要什么药）。
        // 此函数只保留超时管理（真正死亡）。
    }
}
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

// ================= 武器修复（背包使用 / 损坏弹窗共用） =================
function repairWeapon(sv, s) {
    if (!s || !String(s.id).startsWith('wpn:') || !s.broken) return false;
    if (!hasTool('tool:wrench')) return false;
    let partsN = 0;
    for (const x of sv.inv) if (x && x.id === 'part') partsN += x.n;
    if (partsN < B.WEAPON_REPAIR_PARTS) return false;
    let left = B.WEAPON_REPAIR_PARTS;
    for (let k = 0; k < sv.inv.length && left > 0; k++) {
        if (sv.inv[k] && sv.inv[k].id === 'part') {
            const t = Math.min(sv.inv[k].n, left);
            sv.inv[k].n -= t; left -= t;
            if (sv.inv[k].n <= 0) sv.inv[k] = null;
        }
    }
    s.broken = false;
    s.dur = B.WEAPON_DUR[s.id.slice(4)] || 0;
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
let carMenuEl = null;
function openCarMenu(key) {
    const m = WV.carData(sv, key);
    if (!m) return;
    sv.carMenu = { key };
    if (!carMenuEl) {
        carMenuEl = document.createElement('div');
        carMenuEl.id = 'wsl-carmenu';
        carMenuEl.style.cssText = 'position:absolute;inset:0;z-index:905;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        document.getElementById('game-container').appendChild(carMenuEl);
    }
    renderCarMenu();
    carMenuEl.classList.remove('hidden');
    carMenuEl.style.display = 'flex';
    AudioSystem.playClick();
}
function renderCarMenu() {
    if (!carMenuEl || !sv.carMenu) return;
    const m = WV.carData(sv, sv.carMenu.key);
    if (!m) { closeCarMenu(); return; }
    const cond = m.cond || 'wreck';
    const isWreck = cond === 'wreck' && !m.repaired;
    const canRepair = !m.repaired && !isWreck;
    const parts = (function () { let n = 0; for (const s of sv.inv) if (s && s.id === 'part') n += s.n; return n; })();
    const hasW = (function () { for (const s of sv.inv) if (s && s.id === 'tool:wrench') return true; return false; })();
    let opts = '';
    if (canRepair) {
        const ok = hasW && parts >= WV.REPAIR_PARTS;
        opts += `<button class="menu-btn wsl-car-opt${ok ? '' : ' dis'}" data-act="repair" style="min-width:220px;">修理汽车（扳手+零件×${WV.REPAIR_PARTS}）${ok ? '' : ' ✗'}</button>`;
    } else if (isWreck) {
        // 报废车：扳手拆解出零件/木材/石块（确定性产出）
        opts += `<button class="menu-btn wsl-car-opt${hasW ? '' : ' dis'}" data-act="dismantle" style="min-width:220px;">拆解报废车（扳手）→ 零件/木材${hasW ? '' : ' ✗'}</button>`;
    }
    if (!isWreck) {
        opts += `<button class="menu-btn wsl-car-opt" data-act="trunk" style="min-width:220px;">打开后备箱</button>`;
        const hasFuel = sv.inv.some(s => s && s.id === 'fuel' && s.n > 0);
        const fuelPct = Math.round((m.fuel != null ? m.fuel : 0) / B.FUEL_MAX * 100);
        opts += `<button class="menu-btn wsl-car-opt${hasFuel && fuelPct < 100 ? '' : ' dis'}" data-act="refuel" style="min-width:220px;">加油（汽油×1 → +${B.FUEL_REFILL} 油量）${hasFuel ? '' : ' ✗ 无汽油'}</button>`;
    }
    const driveDis = m.repaired ? '' : ' dis';
    const driveLabel = m.repaired ? '驾驶' : (isWreck ? '无法驾驶（已报废）' : '驾驶（需先修理）');
    opts += `<button class="menu-btn wsl-car-opt${driveDis}" data-act="drive" style="min-width:220px;">${driveLabel}</button>`;
    const stateTxt = m.repaired ? (cond === 'intact' ? '· 完好可驾驶' : '· 已修复') : (isWreck ? '· 已报废' : '· 待修理');
    const fuelTxt = isWreck ? '' : ` · 油量 ${Math.round(m.fuel != null ? m.fuel : 0)}/${B.FUEL_MAX} · 耐久 ${Math.ceil(m.hp != null ? m.hp : 0)}/${WV.CAR_MAX_HP}`;
    carMenuEl.innerHTML =
        '<div class="wsl-scaler" style="gap:12px;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button class="wsl-car-opt" data-act="close" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;min-width:0;padding:2px;" title="关闭 (F)">✕</button>' +
        `<div style="font-size:20px;color:#FFD700;letter-spacing:3px;margin-bottom:6px;">汽 车 ${stateTxt}${fuelTxt}</div>` +
        opts + '</div>';
    carMenuEl.querySelectorAll('.wsl-car-opt').forEach(el => {
        el.addEventListener('click', () => carMenuAct(el.dataset.act));
    });
}
function carMenuAct(act) {
    const key = sv.carMenu && sv.carMenu.key;
    if (!key) return;
    if (act === 'repair') { WV.repairCar(sv, key); renderCarMenu(); return; }
    if (act === 'dismantle') { WV.dismantleWreck(sv, key); renderCarMenu(); return; }
    if (act === 'refuel') { WV.refuelCar(sv, key); renderCarMenu(); return; }
    if (act === 'trunk') { closeCarMenu(); openCarTrunk(key); return; }
    if (act === 'drive') {
        if (WV.startDrive(sv, key)) closeCarMenu();
        return;
    }
    if (act === 'close') { closeCarMenu(); return; }
}

// 后备箱：首次打开进入搜索界面（逐件揭示，与箱子一致）；搜索完成/关闭后剩余物存入后备箱储物，
// 之后再开直接存取。旧档（carLootSeeded 已生成且后备箱已有货）视为已搜索，直接开箱。
function openCarTrunk(key) {
    if (!sv.mods.carSearched) sv.mods.carSearched = {};
    const oldSeeded = sv.mods.carLootSeeded && sv.mods.carLootSeeded[key] && sv.mods.chests && sv.mods.chests['car:' + key];
    if (sv.mods.carSearched[key] || oldSeeded) {
        if (oldSeeded) sv.mods.carSearched[key] = 1;
        Panel.showChest(sv, 'car:' + key, '汽车后备箱');
        return;
    }
    const [gx, gy] = key.split(',').map(Number);
    const generated = [];
    const rolls = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < rolls; i++) {
        const [id, n] = rollCarLoot();
        generated.push({ id, n });
    }
    generated.push(...rollWordAddon('car', gx, gy));
    AudioSystem.playOpenBox();
    WSearch.openSearch(sv, {
        items: generated.map(it => ({ id: it.id, n: it.n, done: false })),
        name: '汽车后备箱', gx, gy, immediate: false,
        cap: Panel.CHEST_SIZE,
        onClose: (remaining, searched) => {
            if (!sv.mods.carSearched) sv.mods.carSearched = {};
            sv.mods.carSearched[key] = 1;
            if (!sv.mods.chests) sv.mods.chests = {};
            const chest = sv.mods.chests['car:' + key] || (sv.mods.chests['car:' + key] = Array(Panel.CHEST_SIZE).fill(null));
            for (const it of (remaining || [])) {
                if (!it || !it.n || it.n <= 0) continue;
                const same = chest.find(slot => slot && slot.id === it.id);
                if (same) same.n += it.n;
                else {
                    const empty = chest.findIndex(slot => !slot);
                    if (empty >= 0) chest[empty] = { id: it.id, n: it.n };
                }
            }
            if (searched) Panel.showChest(sv, 'car:' + key, '汽车后备箱');
        },
    }, { onUseItem: (i) => useItem(i) });
}
function closeCarMenu() {
    sv.carMenu = null;
    if (carMenuEl) carMenuEl.style.display = 'none';
    AudioSystem.playClick();
}
function carMenuOpen() { return !!(sv && sv.carMenu && carMenuEl && carMenuEl.style.display !== 'none'); }   // 2026-08-09 加 display 检查防残留拦截

// 队员背包：镜像到储物界面查看/存取，关闭时写回 NPC
// 2026-08-10 用户要求"NPC 背包容量与主控玩家一致"：容量从储物柜规格（CHEST_SIZE=12）
// 改为玩家背包规格（BAG_SIZE=24）——主控 NPC 时背包体验与主控玩家完全相同。
function openNpcBag(npc) {
    if (!sv.mods.chests) sv.mods.chests = {};
    const key = 'npcbag:' + npc.id;
    const slots = Array(Panel.BAG_SIZE).fill(null);
    for (let i = 0; i < npc.inv.length && i < slots.length; i++) if (npc.inv[i]) slots[i] = { ...npc.inv[i] };
    sv.mods.chests[key] = slots;
    sv._npcBagWriteback = { id: npc.id, key };
    Panel.showChest(sv, key, `${npc.name} 的背包（存取物品）`);
}

// ================= NPC 交互菜单（交谈/交易/入队/雇佣/命令/切换控制） =================
let npcMenuEl = null;
// 2026-08-09 统一查找 NPC：室外在 sv.npcs、室内躲藏幸存者在 sv.interior.npcs
function findNpc(id) {
    const n = (sv.npcs || []).find(m => m.id === id);
    if (n) return n;
    if (sv.interior && sv.interior.npcs) return sv.interior.npcs.find(m => m.id === id) || null;
    return null;
}
function openNpcMenu(id) {
    if (!npcMenuEl) {
        npcMenuEl = document.createElement('div');
        npcMenuEl.id = 'wsl-npcmenu';
        npcMenuEl.style.cssText = 'position:absolute;inset:0;z-index:906;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        document.getElementById('game-container').appendChild(npcMenuEl);
    }
    sv.npcMenu = { id };
    npcMenuEl.classList.remove('hidden');
    npcMenuEl.style.display = 'flex';
    renderNpcMenu();
}
function renderNpcMenu() {
    if (!npcMenuEl || !sv.npcMenu) return;
    const npc = findNpc(sv.npcMenu.id);
    if (!npc || !npc.alive) { closeNpcMenu(); return; }
    const opts = [];
    // 2026-08-09 室内外 NPC 统一：躲藏幸存者与室外 NPC 同一套菜单（可招募/雇佣/跟随）
    if (npc.role === 'friendly' && !npc.party) {
        const partyCount = (sv.npcs || []).filter(m => m.alive && m.party).length;
        opts.push({ act: 'trade', label: '交易（金币按物品价值买卖）' });
        opts.push({ act: 'invite', label: partyCount >= 4 ? '邀请加入队伍（队伍已满 4 人）' : '邀请加入队伍（并肩战斗）' });
        opts.push({ act: 'hire', label: partyCount >= 4 ? '雇佣（队伍已满 4 人）' : '雇佣（每日支付物品）' });
    }
    if (npc.party) {
        opts.push({ act: 'bag', label: '打开背包（查看/存取物品）' });
        opts.push({ act: 'cmd', label: '命令…（跟随 / 营地 / 驾车 / 解散）' });
        opts.push({ act: 'switch', label: npc.isPlayer ? '切换操控（回到幸存者）' : '切换操控此角色（24H 冷却）' });
    }
    // 患病 NPC：玩家有对症药/草药时可给药治疗
    if (npc.sick && B.SICKNESS[npc.sick.type]) {
        const s = B.SICKNESS[npc.sick.type];
        const ok = canCureNpc(npc);
        opts.push({ act: 'cure', label: `治疗 ${s.name}（对症药 或 草药×${s.cure}）${ok ? '' : ' ✗ 无药'}` });
    }
    opts.push({ act: 'attrs', label: '查看属性（天赋/先天/成长）' });
    const roleTxt = npc.role === 'hostile' ? '恶意' : (npc.role === 'friendly' ? '友善' : '中立');
    // 阵营归属：营地居民（campId 匹配当前营地）/ 他乡营地 / 流浪者 / 敌对势力
    let campTxt = '';
    if (npc.role === 'hostile') campTxt = '敌对势力';
    else if (npc.campId && sv.camp && npc.campId === sv.camp.id) campTxt = '本营地居民';
    else if (npc.campId) campTxt = '他乡营地';
    else campTxt = '流浪者';
    const age = npc.age ?? (sv.day - npc.bornDay);
    const sickTxt = npc.sick && B.SICKNESS[npc.sick.type] ? ` · 染病：${B.SICKNESS[npc.sick.type].name}` : '';
    npcMenuEl.innerHTML = '<div class="wsl-scaler" style="gap:12px;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button class="wsl-npc-opt" data-act="close" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;min-width:0;padding:2px;" title="关闭 (F)">✕</button>' +
        `<div style="font-size:20px;color:#FFD700;letter-spacing:2px;margin-bottom:4px;">${npc.name} · ${roleTxt}${campTxt ? ` · ${campTxt}` : ''}${npc.party ? ' · 队伍' : ''}${npc.hired ? ` · 雇佣(${npc.hireFee ? npc.hireFee.label : ''})` : ''}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-bottom:10px;">HP ${Math.ceil(npc.hp)}/${npc.maxHp} · 饱食 ${Math.round(npc.food)} · 水分 ${Math.round(npc.water)} · ${B.ageStage(age).name}（${age}天） · 武器 ${npc.wpnName || '拳头'}${sickTxt}</div>` +
        opts.map(o => `<button class="menu-btn wsl-npc-opt" data-act="${o.act}" style="min-width:240px;">${o.label}</button>`).join('') +
        '</div>';
    npcMenuEl.querySelectorAll('.wsl-npc-opt').forEach(el => el.addEventListener('click', () => npcMenuAct(el.dataset.act)));
}
// 2026-08-09 室内外 NPC 统一：招募/雇佣室内躲藏幸存者时，把它从 it.npcs 并入 sv.npcs
// （完整 NPC 列表），标记 inInterior 使其在室内渲染/跟随；离开室内时由 exitInterior 带出。
function adoptInteriorNpc(npc) {
    if (!sv.interior || !sv.interior.npcs) return false;
    const i = sv.interior.npcs.findIndex(m => m.id === npc.id);
    if (i < 0) return false;
    sv.interior.npcs.splice(i, 1);
    npc.inInterior = true;
    npc.interiorKey = sv.interior.key || null;
    npc.interiorFloor = sv.interior.floor || 1;
    if (!sv.npcs) sv.npcs = [];
    sv.npcs.push(npc);
    return true;
}

function npcMenuAct(act) {
    const id = sv.npcMenu && sv.npcMenu.id;
    const npc = findNpc(id);
    if (!npc) { closeNpcMenu(); return; }
    if (act === 'close') { closeNpcMenu(); return; }
    if (act === 'bag') { closeNpcMenu(); openNpcBag(npc); return; }
    if (act === 'attrs') { closeNpcMenu(); openCharPanel(npc.id); return; }
    if (act === 'cure') {
        const sickName = npc.sick && B.SICKNESS[npc.sick.type] ? B.SICKNESS[npc.sick.type].name : '疾病';
        closeNpcMenu();
        if (cureNpcFromBag(npc)) log(`${npc.name} 服用了你的药，${sickName}痊愈了`, '#7DFF7D');
        return;
    }
    if (act === 'trade') { closeNpcMenu(); openNpcTrade(npc); return; }
    if (act === 'invite') {
        const partyCount = (sv.npcs || []).filter(m => m.alive && m.party).length;
        if (partyCount >= 4) { log('队伍已满（最多 4 人）', '#FFB347'); return; }
        adoptInteriorNpc(npc);   // 室内躲藏者并入 sv.npcs（同一套队伍逻辑）
        npc.party = true; npc.state = 'follow'; npc.campTask = null; closeNpcMenu(); log(`${npc.name} 加入了队伍！`, '#7DFF7D'); return;
    }
    if (act === 'hire') {
        const partyCount = (sv.npcs || []).filter(m => m.alive && m.party).length;
        if (partyCount >= 4) { log('队伍已满（最多 4 人）', '#FFB347'); return; }
        adoptInteriorNpc(npc);   // 同上：雇佣也并入 sv.npcs
        WNPC.hireNpc(sv, npc); closeNpcMenu(); return;
    }
    if (act === 'follow') { WNPC.commandNpc(sv, npc, 'follow'); closeNpcMenu(); return; }
    if (act === 'cmd') { closeNpcMenu(); openNpcCommandMenu(npc); return; }
    if (act === 'camp') { WNPC.commandNpc(sv, npc, 'camp'); closeNpcMenu(); return; }
    if (act === 'drive') { closeNpcMenu(); openDriveDestMenu(npc); return; }
    if (act === 'dismiss') { WNPC.commandNpc(sv, npc, 'dismiss'); closeNpcMenu(); return; }
    if (act === 'switch') {
        if (WNPC.switchControl(sv, npc.id)) {
            if (!sv.wpn) WG.initWpn(sv, {});   // 无武器 NPC 接管控制后给初始武器，避免空武器崩溃
            closeNpcMenu();
        }
        return;
    }
}
function closeNpcMenu() {
    sv.npcMenu = null;
    if (npcMenuEl) npcMenuEl.style.display = 'none';
    AudioSystem.playClick();
}
// 2026-08-09 修复"NPC 背包 UI 关不掉"：npcMenuOpen 只查状态变量 sv.npcMenu，
// 一旦残留（如切视角/成员操控时 NPC 菜单状态未清），keydown 就被其【无条件 return】拦截，
// 导致储物面板的 B/F/ESC 关闭全部失效。改为同时检查 display，残留但隐藏时不再拦截。
function npcMenuOpen() { return !!(sv && sv.npcMenu && npcMenuEl && npcMenuEl.style.display !== 'none'); }

// ================= 队员命令面板（跟随 / 营地 / 驾车 / 解散 独立 UI） =================
let npcCmdEl = null;
function openNpcCommandMenu(npc) {
    if (!npcCmdEl) {
        npcCmdEl = document.createElement('div');
        npcCmdEl.id = 'wsl-npccmd';
        npcCmdEl.style.cssText = 'position:absolute;inset:0;z-index:906;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        document.getElementById('game-container').appendChild(npcCmdEl);
    }
    sv.npcCmd = { id: npc.id };
    npcCmdEl.classList.remove('hidden');
    npcCmdEl.style.display = 'flex';
    const opts = [
        // 2026-08-09 室内外 UI 统一：队员命令面板"打开背包"（查看/存取物品）
        { c: 'bag', label: '打开背包（查看/存取物品）' },
        { c: 'follow', label: '跟随我（并肩行动）' },
        // 2026-08-10 切换主控角色：切到该队员操控（240s 共用冷却，所有成员一致）
        ...(npc.id !== sv.controllerId && !npc.downed ? [{ c: 'switch', label: '切换为主控角色（冷却 240s）' }] : []),
        // 2026-08-10 召唤队友：把卡在建筑里 / 离玩家较远的成员拉到身边（240s 冷却）
        { c: 'summon', label: '召唤队员到身边（冷却 240s）' },
        // 倒地救治期间：命令该 NPC 把倒地主角背回床旁/原地救治（2026-08-09）
        ...(sv._downed ? [{ c: 'carry', label: `背回 ${sv._downed.name}（带到床旁/安全点）`, disabled: !sv.homeBed }] : []),
        { c: 'camp', label: '返回营地干活', disabled: !sv.camp },
        { c: 'drive', label: '驾驶汽车出行…（选择目的地）' },
        { c: 'dismiss', label: '解散离队' },
    ];
    npcCmdEl.innerHTML = '<div class="wsl-scaler" style="gap:12px;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button class="wsl-npc-cmd" data-c="close" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;min-width:0;padding:2px;" title="取消 (F)">✕</button>' +
        `<div style="font-size:20px;color:#FFD700;letter-spacing:2px;margin-bottom:4px;">${npc.name} · 命令</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-bottom:10px;">${npc.party ? '队伍成员' : '非队员'}${sv.camp ? '' : ' · 暂无营地，返回营地需先插旗'}</div>` +
        opts.map(o => `<button class="menu-btn wsl-npc-cmd${o.disabled ? ' dis' : ''}" data-c="${o.c}" style="min-width:240px;">${o.label}</button>`).join('') +
        '</div>';
    npcCmdEl.querySelectorAll('.wsl-npc-cmd').forEach(el => el.addEventListener('click', () => {
        const c = el.dataset.c;
        const npc2 = sv.npcs.find(m => m.id === sv.npcCmd.id);
        closeNpcCommandMenu();
        if (!npc2 || c === 'close') return;
        if (c === 'bag') { openNpcBag(npc2); return; }            // 打开背包（可存取）
        if (c === 'drive') { openDriveDestMenu(npc2); return; }
        if (c === 'summon') { summonTeammates(); return; }   // 2026-08-10 召唤全体队员到身边
        if (c === 'switch') {
            // 2026-08-10 切换为主控角色（240s 共用冷却；不能切到濒死队友——switchControl 已拦截）
            if (WNPC.switchControl(sv, npc2.id)) {
                if (!sv.wpn) WG.initWpn(sv, {});
                log(`现在操控 ${npc2.name}（切换冷却 240s 全员共用）`, '#2EE6C0');
            }
            return;
        }
        if (c === 'camp' && !sv.camp) { log('还没有营地！放置"领地旗帜"建立领地后才能返回', '#FFB347'); return; }
        if (c === 'carry') {
            // 命令该 NPC 把倒地主角背回床旁（标记 _carryOrder；updateDowned 驱动其寻路）
            if (!sv._downed) { log('没有人需要救助', '#FFB347'); return; }
            npc2._carryOrder = true;
            npc2.state = 'carry';
            log(`${npc2.name} 将把 ${sv._downed.name} 背回床旁……`, '#7fd6ff');
            return;
        }
        WNPC.commandNpc(sv, npc2, c);
    }));
}
function closeNpcCommandMenu() {
    sv.npcCmd = null;
    if (npcCmdEl) npcCmdEl.style.display = 'none';
}
// ================= 召唤队友（2026-08-10） =================
// 把卡在建筑里 / 离玩家较远的成员召唤到身边；冷却 240 秒。
// 室内外统一：玩家在哪，成员就被召到哪（室内成员带进室内 / 室外成员带出室外）。
const SUMMON_CD = 240;   // 召唤冷却（秒）
// 2026-08-11 导出给开发者面板调用（dev 召唤队友按钮）
export function summonTeammates() {
    if (!sv.npcs) return;
    // 冷却检查
    const left = (sv._summonCd || 0) - (sv.now || 0);
    if (left > 0) {
        log(`召唤冷却中：还需 ${Math.ceil(left)} 秒`, '#FFB347');
        return;
    }
    const mates = sv.npcs.filter(n => n.alive && n.party && n.id !== sv.controllerId && !n.isPlayer && !n.riding);
    if (!mates.length) { log('队伍里没有其他队员', '#FFB347'); return; }
    // 在玩家周围找可站立落点（8 方向扇形展开，逐圈找）
    const findSpot = () => {
        const px = sv.px, py = sv.py;
        for (let r = 1; r <= 3; r++) {
            for (let i = 0; i < 8 * r; i++) {
                const ang = (i / (8 * r)) * Math.PI * 2;
                const x = px + Math.cos(ang) * r * TS * 0.9;
                const y = py + Math.sin(ang) * r * TS * 0.9;
                if (sv.interior) {
                    const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
                    if (WD.interiorWalkable(sv, gx, gy)) return { x, y };
                } else if (canStand(x, y)) {
                    return { x, y };
                }
            }
        }
        // 兜底：玩家脚下
        return { x: px, y: py };
    };
    let n = 0;
    for (const m of mates) {
        // 濒死队友不召唤（躺在地上等人救）
        if (m.downed) continue;
        const spot = findSpot();
        // 室内外对齐：召唤到玩家所在空间
        if (sv.interior) {
            if (!m.inInterior) {
                m.inInterior = true;
                m.interiorKey = sv.interior.key || null;
                m.interiorFloor = sv.interior.floor || 1;
            }
            m.x = spot.x; m.y = spot.y;
        } else {
            if (m.inInterior) { m.inInterior = false; m.interiorKey = null; m.interiorFloor = null; }
            m.x = spot.x; m.y = spot.y;
        }
        m.state = 'follow';
        m.campTask = null;
        m._path = null;   // 清寻路缓存，重新跟随
        n++;
    }
    if (n > 0) {
        sv._summonCd = (sv.now || 0) + SUMMON_CD;
        log(`已召唤 ${n} 名队员到身边（冷却 ${SUMMON_CD} 秒）`, '#7DFF7D');
        AudioSystem.playClick();
    } else {
        log('没有可召唤的队员（濒死/乘车中的成员除外）', '#FFB347');
    }
}
function npcCmdOpen() { return !!(sv && sv.npcCmd && npcCmdEl && npcCmdEl.style.display !== 'none'); }   // 2026-08-09 加 display 检查防残留拦截

// ================= 驾驶目的地选择（命令队员开车：营地/城市/郊区/废墟/自由探索） =================
let driveDestEl = null;
function openDriveDestMenu(npc) {
    if (!driveDestEl) {
        driveDestEl = document.createElement('div');
        driveDestEl.id = 'wsl-drivedest';
        driveDestEl.style.cssText = 'position:absolute;inset:0;z-index:907;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        document.getElementById('game-container').appendChild(driveDestEl);
    }
    sv.driveDest = { id: npc.id };
    driveDestEl.classList.remove('hidden');
    driveDestEl.style.display = 'flex';
    const opts = [];
    if (sv.camp) opts.push({ d: 'camp', label: '去营地（全员下车待命）' });
    opts.push({ d: 'city', label: '探索城市（开往城市方向）' });
    opts.push({ d: 'suburb', label: '探索郊区' });
    opts.push({ d: 'ruins', label: '探索废墟' });
    opts.push({ d: 'free', label: '自由探索（随机远方）' });
    driveDestEl.innerHTML = '<div class="wsl-scaler" style="gap:12px;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button class="wsl-drive-opt" data-d="close" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;min-width:0;padding:2px;" title="取消 (F)">✕</button>' +
        `<div style="font-size:20px;color:#FFD700;letter-spacing:2px;margin-bottom:4px;">${npc.name} · 驾驶目的地</div>` +
        '<div style="font-size:12px;color:#8a9aa2;margin-bottom:10px;">需附近 24 格内有归属汽车（修复/驾驶过才有"所属"标记）；出发后全员自动乘车，F 取消</div>' +
        opts.map(o => `<button class="menu-btn wsl-drive-opt" data-d="${o.d}" style="min-width:240px;">${o.label}</button>`).join('') +
        '</div>';
    driveDestEl.querySelectorAll('.wsl-drive-opt').forEach(el => el.addEventListener('click', () => {
        const d = el.dataset.d;
        const npc2 = sv.npcs.find(m => m.id === sv.driveDest.id);
        closeDriveDestMenu();
        if (d === 'close' || !npc2) return;
        WNPC.startDriveOrder(sv, npc2, d);
    }));
}
function closeDriveDestMenu() {
    sv.driveDest = null;
    if (driveDestEl) driveDestEl.style.display = 'none';
}
function driveDestOpen() { return !!(sv && sv.driveDest && driveDestEl && driveDestEl.style.display !== 'none'); }   // 2026-08-09 加 display 检查防残留拦截
// 玩家背包是否有能治 npc 的药（对症药/抗生素/足量草药）
function canCureNpc(npc) {
    if (!npc.sick || !B.SICKNESS[npc.sick.type]) return false;
    const med = B.SICK_MED[npc.sick.type];
    if (sv.inv.some(x => x && (x.id === med || x.id === 'med:pan'))) return true;
    let herbs = 0;
    for (const x of sv.inv) if (x && x.id === 'herb') herbs += x.n;
    return herbs >= (B.SICKNESS[npc.sick.type].cure || 1);
}
// 用玩家背包的药治疗 npc（对症药 1 瓶 / 抗生素 1 瓶 / 草药按 cure 数量）
function cureNpcFromBag(npc) {
    if (!npc.sick || !B.SICKNESS[npc.sick.type]) return false;
    const med = B.SICK_MED[npc.sick.type];
    let i = med ? sv.inv.findIndex(x => x && x.id === med) : -1;
    if (i < 0) i = sv.inv.findIndex(x => x && x.id === 'med:pan');
    if (i >= 0) {
        sv.inv[i].n--;
        if (sv.inv[i].n <= 0) sv.inv[i] = null;
        npc.sick = null;
        return true;
    }
    let left = B.SICKNESS[npc.sick.type].cure || 1;
    for (let k = 0; k < sv.inv.length && left > 0; k++) {
        if (sv.inv[k] && sv.inv[k].id === 'herb') {
            const t = Math.min(sv.inv[k].n, left);
            sv.inv[k].n -= t; left -= t;
            if (sv.inv[k].n <= 0) sv.inv[k] = null;
        }
    }
    if (left > 0) return false;
    npc.sick = null;
    return true;
}

// ================= 营地面板（工作日志 + 营地物资箱） =================
let campPanelEl = null;
function openCampPanel() {
    if (!campPanelEl) {
        campPanelEl = document.createElement('div');
        campPanelEl.id = 'wsl-camppanel';
        campPanelEl.style.cssText = 'position:absolute;inset:0;z-index:906;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
        document.getElementById('game-container').appendChild(campPanelEl);
    }
    campPanelEl.classList.remove('hidden');
    campPanelEl.style.display = 'flex';
    renderCampPanel();
}
function renderCampPanel() {
    if (!campPanelEl) return;
    const logs = (sv.npcs || []).filter(n => n.alive && n.state === 'camp')
        .flatMap(n => n.workLog.map(e => ({ name: n.name, text: e.text, day: e.day })))
        .slice(0, 8);
    campPanelEl.innerHTML = '<div class="wsl-scaler" style="gap:10px;max-width:480px;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button class="wsl-camp-opt" data-act="close" style="position:absolute;top:6px;right:8px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;min-width:0;padding:2px;" title="关闭 (F)">✕</button>' +
        '<div style="font-size:20px;color:#FFD700;letter-spacing:4px;margin-bottom:6px;text-align:center;">◇ 营 地 ◇</div>' +
        `<div style="font-size:13px;color:#8a9aa2;margin-bottom:6px;">营地同伴 ${(sv.npcs || []).filter(n => n.alive && n.state === 'camp').length} 人</div>` +
        '<div style="font-size:13px;color:#ccd;margin-bottom:8px;">工作日志：</div>' +
        (logs.length ? logs.map(l => `<div style="font-size:12px;color:#ffe9a8;text-align:left;">第${l.day}天 · ${l.text}</div>`).join('')
            : '<div style="font-size:12px;color:#778;">营地暂无人干活</div>') +
        '<button class="menu-btn wsl-camp-opt" data-act="chest" style="min-width:240px;margin-top:8px;">打开营地物资箱</button>' +
        '</div>';
    campPanelEl.querySelectorAll('.wsl-camp-opt').forEach(el => el.addEventListener('click', () => {
        if (el.dataset.act === 'close') { campPanelEl.style.display = 'none'; AudioSystem.playClick(); return; }
        if (el.dataset.act === 'chest') {
            campPanelEl.style.display = 'none';
            Panel.showChest(sv, 'camp', '营地物资箱');
        }
    }));
}
function campPanelOpen() { return !!(campPanelEl && campPanelEl.style.display !== 'none'); }

// ================= 角色属性面板（C 键 / NPC 菜单"查看属性"） =================
let charPanelEl = null;
function openCharPanel(id) {
    if (!charPanelEl) {
        charPanelEl = document.createElement('div');
        charPanelEl.id = 'wsl-charpanel';
        charPanelEl.style.cssText = 'position:absolute;inset:0;z-index:908;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        document.getElementById('game-container').appendChild(charPanelEl);
    }
    sv.charPanel = { id };
    charPanelEl.style.display = 'flex';
    renderCharPanel();
}
function renderCharPanel() {
    const p = sv.npcs.find(n => n.id === sv.charPanel.id);
    if (!p || !p.alive) { closeCharPanel(); return; }
    const a = p.attrs || { str: 10, con: 10, agi: 10, int: 10 };
    const age = p.age ?? (sv.day - p.bornDay);
    const talent = p.talent ? B.TALENTS[p.talent] : null;
    const cg = p.congenital ? B.CONGENITAL[p.congenital] : null;
    const sick = p.sick && B.SICKNESS[p.sick.type] ? B.SICKNESS[p.sick.type] : null;
    const act = p.act || {};
    const sickTxt = sick
        ? `当前染病：<span style="color:${B.sickColor(p.sick.type)};">${sick.name}</span>（${sick.desc}）<br><span style="color:#8a9aa2;font-size:12px;">治疗：${(B.SICK_MED[p.sick.type] ? Panel.getItemInfo(B.SICK_MED[p.sick.type]).name + ' 或 ' : '')}草药×${sick.cure}${p.sick.type === 'dysentery' ? '（需有水）' : ''}</span>`
        : '当前：无疾病';
    const attrRow = k => {
        const v = a[k];
        const bar = '■'.repeat(Math.max(0, Math.round(v / 18 * 10))) + '□'.repeat(Math.max(0, 10 - Math.round(v / 18 * 10)));
        const bonus = v > 10 ? ` +${Math.round((v - 10) * 2)}%` : (v < 10 ? ` ${Math.round((v - 10) * 2)}%` : '');
        return `<div style="font-size:13px;color:#e8e8e8;margin:2px 0;">${B.ATTRIB_NAMES[k]} <span style="color:#FFD700;">${v}</span> ${bar}${bonus}</div>`;
    };
    charPanelEl.innerHTML = '<div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:20px 26px;width:460px;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button data-act="close" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;" title="关闭 (C)">✕</button>' +
        `<div style="font-size:20px;color:#39d98a;letter-spacing:3px;margin-bottom:4px;text-align:center;">◇ 角色属性 ◇</div>` +
        `<div style="font-size:13px;color:#8a9aa2;text-align:center;margin-bottom:12px;">${p.name} · ${B.ageStage(age).name}（${age}天） · 武器 ${p.wpnName || '拳头'}</div>` +
        `<div style="border-top:1px solid #2a3540;padding-top:10px;">${B.ATTRIB_KEYS.map(attrRow).join('')}</div>` +
        `<div style="font-size:13px;color:#ffe9a8;margin-top:10px;">${talent ? `天赋：${talent.name}（${talent.desc}）` : '天赋：无'}</div>` +
        `<div style="font-size:13px;color:#ffb08a;margin-top:4px;">${cg ? `先天疾病：${cg.name}（${cg.desc}）` : '先天：健康'}</div>` +
        `<div style="font-size:13px;color:#ff8866;margin-top:4px;">${sickTxt}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-top:8px;border-top:1px solid #2a3540;padding-top:6px;">后天成长：近战 ${act.melee || 0}/60 · 受击 ${act.hit || 0}/40 · 奔跑 ${Math.round(act.run || 0)}/300</div>` +
        '</div>';
    charPanelEl.querySelector('[data-act="close"]').addEventListener('click', closeCharPanel);
}
function closeCharPanel() {
    sv.charPanel = null;
    if (charPanelEl) charPanelEl.style.display = 'none';
    AudioSystem.playClick();
}
function charPanelOpen() { return !!(sv && sv.charPanel && charPanelEl && charPanelEl.style.display !== 'none'); }

// ================= NPC 队伍管理界面（H 键） =================
// 2026-08-10 用户需求：队员与玩家一致拥有体力/饱食/水分/感染值，可一键调出界面
// 查看详细属性与背包物品，并消耗玩家背包物资给队员治病/加饱食/加水/减感染。
let npcMgrEl = null;
function openNpcMgr() {
    if (!npcMgrEl) {
        npcMgrEl = document.createElement('div');
        npcMgrEl.id = 'wsl-npcmgr';
        npcMgrEl.style.cssText = 'position:absolute;inset:0;z-index:909;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        document.getElementById('game-container').appendChild(npcMgrEl);
    }
    if (!sv.npcMgr) {
        const first = (sv.npcs || []).find(n => n.alive && n.party);
        sv.npcMgr = { selId: first ? first.id : null };
    } else {
        // 刷新：选中成员若已死亡/离队，自动重选第一个存活队员
        const sel = (sv.npcs || []).find(n => n.id === sv.npcMgr.selId && n.alive && n.party);
        if (!sel) {
            const first = (sv.npcs || []).find(n => n.alive && n.party);
            sv.npcMgr.selId = first ? first.id : null;
        }
    }
    npcMgrEl.classList.remove('hidden');
    npcMgrEl.style.display = 'flex';
    renderNpcMgr();
}
function closeNpcMgr() {
    sv.npcMgr = null;
    if (npcMgrEl) npcMgrEl.style.display = 'none';
    AudioSystem.playClick();
}
function npcMgrOpen() { return !!(sv && sv.npcMgr && npcMgrEl && npcMgrEl.style.display !== 'none'); }
function renderNpcMgr() {
    if (!npcMgrEl || !sv.npcMgr) return;
    const members = (sv.npcs || []).filter(n => n.alive && n.party);
    const sel = members.find(n => n.id === sv.npcMgr.selId) || members[0];
    if (!sel) {
        npcMgrEl.innerHTML = '<div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:20px 26px;width:440px;position:relative;">' +
            // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
            '<button class="wsl-npcmgr-opt" data-act="close" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;" title="关闭 (H)">✕</button>' +
            '<div style="font-size:15px;color:#8a9aa2;text-align:center;margin:8px 0;">队伍里暂时没有人（最多 4 人，招募/雇佣 NPC 后按 H 打开）</div>' +
            '</div>';
        bindNpcMgrOpts();
        return;
    }
    const bar = (v, max, c) => {
        const r = Math.max(0, Math.min(1, v / Math.max(1, max)));
        return `<div style="width:110px;height:7px;background:rgba(0,0,0,0.55);border-radius:3px;display:inline-block;vertical-align:middle;margin-left:6px;"><div style="width:${Math.round(110 * r)}px;height:7px;background:${c};border-radius:3px;"></div></div>`;
    };
    const st = sel.stamina != null ? sel.stamina : 100;
    const mxSt = sel.maxStamina || 100;
    const infEff = sel.infection > 0 ? playerInfectionEffects(sel.infection) : null;
    const sick = sel.sick && B.SICKNESS[sel.sick.type] ? B.SICKNESS[sel.sick.type] : null;
    const stateTxt = { follow: '跟随', camp: '营地干活', fight: '战斗', wander: '游荡', carry: '救助', rest: '休息' }[sel.state] || (sel.state || '未知');
    const isCtrl = sv.controllerId && sel.id === sv.controllerId;
    const roleTxt = sel.isPlayer ? '幸存者' : (sel.role === 'hostile' ? '敌对' : sel.role === 'neutral' ? '中立' : '友善');
    // 物品格子（复用背包格样式：边框=物品类别色，右下角数量）
    // 注意覆盖 .wsl-cell 全局 min-width/min-height(56px)，否则格子会被撑大破坏固定布局
    const cell = (s, key, tag, extraStyle) => {
        const base = 'width:38px;height:38px;min-width:38px;min-height:38px;';
        if (!s) return `<div class="wsl-cell" data-${tag}="${key}" style="${base}${extraStyle || ''}"></div>`;
        const it = Panel.getItemInfo(s.id);
        const catColor = (it && it.color) || '#888';
        const nm = (it && it.name) || s.id;
        const fs = nm.length <= 2 ? 13 : (nm.length === 3 ? 10 : 8);
        return `<div class="wsl-cell" data-${tag}="${key}" data-item="${s.id}" title="${nm}" style="${base}border-color:${catColor};${extraStyle || ''}">` +
            `<span class="wsl-cell-char" style="color:${catColor};font-size:${fs}px">${nm}</span>` +
            `<span class="wsl-cell-n">${s.n || 1}</span></div>`;
    };
    // 成员背包格子（只读查看；点击可使用——食物/水让成员自行吃掉，药品治病）
    const memberInv = (Array.isArray(sel.inv) && sel.inv.length)
        ? sel.inv.map((s, i) => cell(s, i, 'mi')).join('')
        : '<div style="font-size:11px;color:#778;padding:6px;">（空背包）</div>';
    // 玩家背包格子（点击 = 赠送给选中成员；右下角提示）
    const playerInv = sv.inv.map((s, i) => cell(s, i, 'pi')).join('');
    // 固定整体尺寸（点击成员不变化）：宽 920 高 540，内部分栏固定宽
    npcMgrEl.innerHTML = '<div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:14px 18px;width:920px;height:560px;display:flex;flex-direction:column;box-sizing:border-box;position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button class="wsl-npcmgr-opt" data-act="close" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;z-index:2;" title="关闭 (H)">✕</button>' +
        `<div style="font-size:17px;color:#39d98a;letter-spacing:3px;margin-bottom:8px;text-align:center;flex-shrink:0;">◇ 队伍管理 ◇</div>` +
        '<div style="display:flex;gap:12px;flex:1;min-height:0;">' +
        // 左：成员列表（固定宽）
        '<div style="width:150px;border-right:1px solid #2a3540;padding-right:8px;flex-shrink:0;overflow-y:auto;">' +
        `<div style="font-size:11px;color:#8a9aa2;margin-bottom:4px;">成员（${members.length}/4）</div>` +
        members.map(n => {
            const hi = n.id === sel.id;
            const nm = (sv.controllerId && n.id === sv.controllerId) ? n.name + ' ◈' : n.name;
            const flag = n.downed ? '濒' : (n.sick ? '病' : (n.exhausted ? '累' : (n.infection > 0 ? '染' : '')));
            return `<button data-sel="${n.id}" style="display:block;width:100%;text-align:left;padding:5px 7px;margin:2px 0;background:${hi ? 'rgba(57,217,138,0.18)' : '#1c242e'};border:1px solid ${hi ? '#39d98a' : '#2a3540'};color:${hi ? '#39d98a' : '#ccd'};border-radius:5px;cursor:pointer;font-size:12px;">${nm}${flag ? ' <span style="color:#FF5544;">' + flag + '</span>' : ''}</button>`;
        }).join('') +
        '</div>' +
        // 中：属性详情（固定宽）
        '<div style="width:250px;border-right:1px solid #2a3540;padding-right:10px;flex-shrink:0;overflow-y:auto;">' +
        `<div style="font-size:14px;color:#FFD700;margin-bottom:3px;">${sel.name} · ${sel.wpnName || '拳头'}${isCtrl ? ' <span style="color:#39d98a;font-size:11px;">· 当前操控</span>' : ''}</div>` +
        `<div style="font-size:11px;color:#8a9aa2;margin-bottom:6px;">${roleTxt} · 状态：${stateTxt}</div>` +
        `<div style="font-size:12px;color:#e8e8e8;margin:2px 0;">生命 <span style="color:#3DDC84;">${Math.ceil(sel.hp)}/${sel.maxHp}</span>${bar(sel.hp, sel.maxHp, '#3DDC84')}</div>` +
        `<div style="font-size:12px;color:#e8e8e8;margin:2px 0;">体力 <span style="color:#FFD700;">${Math.round(st)}/${mxSt}</span>${bar(st, mxSt, '#FFD700')}${sel.exhausted ? ' <span style="color:#FF8866;font-size:11px;">力竭</span>' : ''}</div>` +
        `<div style="font-size:12px;color:#e8e8e8;margin:2px 0;">饱食 <span style="color:#E8A33D;">${Math.round(sel.food)}/100</span>${bar(sel.food || 0, 100, '#E8A33D')}</div>` +
        `<div style="font-size:12px;color:#e8e8e8;margin:2px 0;">水分 <span style="color:#5599FF;">${Math.round(sel.water)}/100</span>${bar(sel.water || 0, 100, '#5599FF')}</div>` +
        `<div style="font-size:12px;color:#e8e8e8;margin:2px 0;">感染 <span style="color:#E8836A;">${Math.round(sel.infection || 0)}/100</span>${bar(sel.infection || 0, 100, '#8b3b43')}${infEff ? ` <span style="color:#FF8866;font-size:11px;">${infEff.name}</span>` : ''}</div>` +
        `<div style="font-size:11px;color:#ffe9a8;margin-top:5px;border-top:1px solid #2a3540;padding-top:4px;">${sick ? `染病：<span style="color:${B.sickColor(sel.sick.type)};">${sick.name}</span>` : '健康：无疾病'}</div>` +
        `<div style="font-size:11px;color:#ffe9a8;margin-top:3px;">${sel.talent && B.TALENTS[sel.talent] ? `天赋：${B.TALENTS[sel.talent].name}` : '天赋：无'}${sel.congenital && B.CONGENITAL[sel.congenital] ? ` · 先天：${B.CONGENITAL[sel.congenital].name}` : ''}</div>` +
        // 操作按钮（固定网格：2 列均分，整齐不参差）
        `<div style="font-size:11px;color:#8a9aa2;margin-top:7px;border-top:1px solid #2a3540;padding-top:5px;">补给（消耗你的物品）：</div>` +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:4px;">' +
        '<button class="menu-btn wsl-npcmgr-opt" data-act="feed" style="min-width:0;padding:6px 0;font-size:12px;">喂食</button>' +
        '<button class="menu-btn wsl-npcmgr-opt" data-act="drink" style="min-width:0;padding:6px 0;font-size:12px;">喝水</button>' +
        `<button class="menu-btn wsl-npcmgr-opt" data-act="cure" style="min-width:0;padding:6px 0;font-size:12px;${sick ? '' : 'opacity:0.45;'}">治病${sick ? '' : ''}</button>` +
        `<button class="menu-btn wsl-npcmgr-opt" data-act="inf" style="min-width:0;padding:6px 0;font-size:12px;${sel.infection > 0 ? '' : 'opacity:0.45;'}">减感染</button>` +
        '</div>' +
        '</div>' +
        // 右：背包面板（成员背包 + 玩家背包，固定宽）
        // 2026-08-10 选中当前操纵者时只显示其背包（成员背包=我的背包），隐藏重复的"我的背包"区块
        '<div style="flex:1;min-width:0;overflow-y:auto;">' +
        `<div style="font-size:12px;color:#8a9aa2;margin-bottom:4px;">${sel.name} 的背包（点击物品 = 使用/食用）</div>` +
        '<div class="wsl-bag-grid" style="display:grid;grid-template-columns:repeat(6,38px);gap:4px;margin-bottom:12px;">' + memberInv + '</div>' +
        (isCtrl ? '' :
            `<div style="font-size:12px;color:#8a9aa2;margin-bottom:4px;">我的背包（点击物品 = 赠送给 ${sel.name}）</div>` +
            '<div class="wsl-bag-grid" style="display:grid;grid-template-columns:repeat(6,38px);gap:4px;">' + playerInv + '</div>') +
        '</div>' +
        '</div></div>';
    bindNpcMgrOpts();
    npcMgrEl.querySelectorAll('[data-sel]').forEach(el => el.addEventListener('click', () => {
        sv.npcMgr.selId = el.dataset.sel;
        renderNpcMgr();
    }));
    // 成员背包物品点击：使用（食物/水/草药/药品类）
    npcMgrEl.querySelectorAll('[data-mi]').forEach(el => {
        el.addEventListener('click', () => {
            const idx = +el.dataset.mi;
            const s = (sel.inv || [])[idx];
            if (!s) return;
            useNpcInvItem(sel, idx, s);
        });
    });
    // 玩家背包物品点击：选中主控时 = 使用（复用 useItem）；选中其他成员时 = 赠送
    npcMgrEl.querySelectorAll('[data-pi]').forEach(el => {
        el.addEventListener('click', () => {
            const idx = +el.dataset.pi;
            const s = sv.inv[idx];
            if (!s) return;
            if (isCtrl) {
                useItem(idx);   // 主控：与背包左键使用同款（食物/水/药/战利品袋等）
                renderNpcMgr();
            } else {
                npcMgrGift(idx, s);
            }
        });
    });
}
function bindNpcMgrOpts() {
    npcMgrEl.querySelectorAll('.wsl-npcmgr-opt').forEach(el => el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'close') { closeNpcMgr(); return; }
        const sel = (sv.npcs || []).find(n => n.id === sv.npcMgr.selId && n.alive && n.party);
        if (!sel) return;
        if (act === 'feed') npcMgrFeed(sel);
        else if (act === 'drink') npcMgrDrink(sel);
        else if (act === 'cure') npcMgrCure(sel);
        else if (act === 'inf') npcMgrReduceInf(sel);
    }));
}
// 消耗玩家背包物品（需满足数量；不足返回 false）
function npcMgrTakeItem(id, need) {
    const i = sv.inv.findIndex(x => x && x.id === id && x.n >= need);
    if (i < 0) return false;
    sv.inv[i].n -= need;
    if (sv.inv[i].n <= 0) sv.inv[i] = null;
    return true;
}
// 成员背包物品使用：食物/草药/水/药品等直接对成员生效（与玩家 useItem 同款效果）
function useNpcInvItem(n, idx, s) {
    if (!Array.isArray(n.inv) || !n.inv[idx]) return;
    const it = Panel.getItemInfo(s.id);
    const heal = it.heal || 0, sat = it.satiate || 0, drink = it.drink || 0;
    // 药品：治对应疾病（抗生素治任意）
    if (String(s.id).startsWith('med:')) {
        if (!n.sick) { log(`${n.name} 当前没有疾病，暂不需要用药`, '#FFB347'); return; }
        const cures = s.id === 'med:pan' || B.SICK_MED[n.sick.type] === s.id;
        if (!cures) { log(`这药治不了${B.SICKNESS[n.sick.type].name}`, '#FFB347'); return; }
        n.sick = null;
        consumeNpcInv(n, idx);
        npcMgrSyncCtrl(n);
        log(`${n.name} 服用了 ${it.name}，疾病痊愈了`, '#7DFF7D');
        renderNpcMgr();
        return;
    }
    // 食物/水/草药：恢复生命/饱食/水分
    if (heal || sat || drink) {
        if (n.hp >= n.maxHp && (n.food || 0) >= B.HUNGER_MAX && (n.water || 0) >= B.WATER_MAX) { log(`${n.name} 生命、饱食与水分均已满`, '#FFB347'); return; }
        const msgs = [];
        if (heal) { n.hp = Math.min(n.maxHp, n.hp + heal); msgs.push(`生命+${heal}`); }
        if (sat) { n.food = Math.min(B.HUNGER_MAX, (n.food || 0) + sat); msgs.push(`饱食+${sat}`); }
        if (drink) { n.water = Math.min(B.WATER_MAX, (n.water || 0) + drink); msgs.push(`水分+${drink}`); }
        consumeNpcInv(n, idx);
        npcMgrSyncCtrl(n);
        log(`${n.name} 使用了 ${it.name}（${msgs.join(' ')}）`, '#7DFF7D');
        renderNpcMgr();
        return;
    }
    log(`${it.name}：无法对成员直接使用`, '#FFB347');
}
// 从成员背包移除一个物品（数量-1，归零删除）
function consumeNpcInv(n, idx) {
    if (!Array.isArray(n.inv) || !n.inv[idx]) return;
    n.inv[idx].n = (n.inv[idx].n || 1) - 1;
    if (n.inv[idx].n <= 0) n.inv.splice(idx, 1);
}
// 赠送物品：玩家背包物品赠送给选中成员（1 个/次；武器/弹药/材料/食物等均可赠）
function npcMgrGift(idx, s) {
    const sel = (sv.npcs || []).find(n => n.id === sv.npcMgr.selId && n.alive && n.party);
    if (!sel) return;
    const it = Panel.getItemInfo(s.id);
    if (!it) { log('该物品无法赠送', '#FFB347'); return; }
    // 从玩家背包扣 1 个
    s.n = (s.n || 1) - 1;
    if (s.n <= 0) sv.inv[idx] = null;
    // 加入成员背包（同 id 合并，否则 push）
    if (!Array.isArray(sel.inv)) sel.inv = [];
    const same = sel.inv.find(x => x && x.id === s.id);
    if (same) same.n = (same.n || 1) + 1;
    else sel.inv.push({ id: s.id, n: 1, ...(s.eq ? { eq: s.eq } : {}) });
    // 武器赠送：成员武器键更新（若赠的是武器）
    if (String(s.id).startsWith('wpn:')) {
        const wkey = s.id.slice(4);
        sel.wpnKey = wkey;
        sel.wpnName = (WEAPONS[wkey] && WEAPONS[wkey].name) || sel.wpnName;
    }
    npcMgrSyncCtrl(sel);
    log(`赠送 ${it.name}×1 给 ${sel.name}`, '#7DFF7D');
    renderNpcMgr();
}
// 目标若为主控：直接把补给同步到 sv 侧（室外每帧 syncControlledToRecord 会用 sv 覆盖记录，不写回会丢失）
function npcMgrSyncCtrl(n) {
    if (sv.controllerId && n.id === sv.controllerId) {
        sv.food = n.food; sv.water = n.water;
        sv.stamina = n.stamina; sv.exhausted = n.exhausted;
        sv.infection = n.infection || 0;
        sv._sick = n.sick || null;   // 治病后同步（室内模式无每帧回写，需手动）
    }
}
function npcMgrFeed(n) {
    const it = Panel.getItemInfo('food');
    const gain = it && it.satiate ? it.satiate : 30;
    if (!npcMgrTakeItem('food', 1)) { log('背包里没有食物', '#FFB347'); return; }
    n.food = Math.min(B.HUNGER_MAX, (n.food || 0) + gain);
    npcMgrSyncCtrl(n);
    log(`${n.name} 吃了食物，饱食 +${gain}`, '#FFD700');
    renderNpcMgr();
}
function npcMgrDrink(n) {
    const it = Panel.getItemInfo('water');
    const gain = it && it.drink ? it.drink : 35;
    if (!npcMgrTakeItem('water', 1)) { log('背包里没有水', '#FFB347'); return; }
    n.water = Math.min(B.WATER_MAX, (n.water || 0) + gain);
    npcMgrSyncCtrl(n);
    log(`${n.name} 喝了水，水分 +${gain}`, '#66CCFF');
    renderNpcMgr();
}
function npcMgrCure(n) {
    const sickName = n.sick && B.SICKNESS[n.sick.type] ? B.SICKNESS[n.sick.type].name : '疾病';
    if (cureNpcFromBag(n)) {
        npcMgrSyncCtrl(n);
        log(`${n.name} 服用了你的药，${sickName}痊愈了`, '#7DFF7D');
    } else log('背包里没有对症药（对症药 1 瓶 / 抗生素 1 瓶 / 足量草药）', '#FFB347');
    renderNpcMgr();
}
function npcMgrReduceInf(n) {
    if (!(n.infection > 0)) { log(`${n.name} 没有感染`, '#FFB347'); return; }
    if (npcMgrTakeItem('med:pan', 1)) {
        n.infection = addPlayerInfection(n.infection || 0, -WNPC.NPC_INFECTION_CURE_PAN);
        log(`${n.name} 服用了抗生素，感染 -${WNPC.NPC_INFECTION_CURE_PAN}`, '#7DFF7D');
    } else if (npcMgrTakeItem('herb', 3)) {
        n.infection = addPlayerInfection(n.infection || 0, -WNPC.NPC_INFECTION_CURE_HERB);
        log(`${n.name} 服用了草药×3，感染 -${WNPC.NPC_INFECTION_CURE_HERB}`, '#7DFF7D');
    } else { log('背包里没有抗生素或草药×3', '#FFB347'); return; }
    npcMgrSyncCtrl(n);
    renderNpcMgr();
}

// ================= 救治界面（濒临死亡，2026-08-10） =================
// 用户需求：靠近倒地主角按 F → 弹出救治 UI（非直接提交），显示
//  ① 待提交药品进度  ② 濒临死亡角色还能存活多久（倒计时）  ③ 药品集齐即可救治
// 关闭界面不会导致濒死玩家死亡；床旁躺下可延长 25% 存活时间。
let rescueEl = null;
function openRescue() {
    if (!rescueEl) {
        rescueEl = document.createElement('div');
        rescueEl.id = 'wsl-rescue';
        rescueEl.style.cssText = 'position:absolute;inset:0;z-index:908;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        document.getElementById('game-container').appendChild(rescueEl);
        // 2026-08-11 v2.98 锦上添花：点击遮罩空白处关闭救助界面（内容区域点击不关闭）
        rescueEl.addEventListener('click', (e) => {
            if (e.target === rescueEl) closeRescue();
        });
    }
    rescueEl.classList.remove('hidden');
    rescueEl.style.display = 'flex';
    renderRescue();
}
function closeRescue() {
    if (rescueEl) rescueEl.style.display = 'none';
    AudioSystem.playClick();
}
function rescueOpen() { return !!(sv && sv._downed && rescueEl && rescueEl.style.display !== 'none'); }
// 存活倒计时文案：2026-08-11 v2.97 改为【现实时间】——20 分钟救援窗口（被攻击每 1 点伤害减 10 秒）
function downedRemainTxt(sv) {
    const dwn = sv._downed;
    if (!dwn) return '';
    const onBed = false;   // v2.97 现实时间窗口：不再按床延长（用户新规则：固定 20 分钟）
    if (dwn.downedAtReal == null) dwn.downedAtReal = (sv.now != null ? sv.now : 0);
    if (dwn._penaltySec == null) dwn._penaltySec = 0;
    const spent = Math.max(0, (sv.now != null ? sv.now : 0) - dwn.downedAtReal) + (dwn._penaltySec || 0);
    // 2026-08-11 v2.98 救援时间随濒死次数递减：limit = dwn.limitSec（创建时按次数算出），
    // 与游戏内头顶倒计时（updateDowned 超时判定）同源，保证界面/头顶一致。
    const limit = dwn.limitSec || B.DOWNED_LIMIT_SECONDS;
    const remainSec = Math.max(0, limit - spent);
    const m = Math.floor(remainSec / 60), s = Math.floor(remainSec % 60);
    const txt = `${m} 分 ${String(s).padStart(2, '0')} 秒`;
    return { txt, onBed, limit, remainSec };
}
function renderRescue() {
    if (!rescueEl || !sv._downed) return;
    const dwn = sv._downed;
    const name = dwn.name || '幸存者';
    const needMed = B.DOWNED_NEED_MED - (dwn.med || 0);
    const needHerb = B.DOWNED_HERB_EQUIV - (dwn.herb || 0);
    const done = needMed <= 0 || needHerb <= 0;   // 药品集齐（对症药/抗生素集齐 或 草药集齐）
    const { txt, onBed, limit } = downedRemainTxt(sv);
    const devInf = WDEV.isDev() && sv._devInf;   // 开发者无限资源：视为药品无限，可直接提交
    const hasMed = devInf || sv.inv.some(s => s && (s.id === B.DOWNED_RESCUE_MED || s.id === 'med:pan'));
    let herbs = 0; for (const s of sv.inv) if (s && s.id === 'herb') herbs += s.n;
    rescueEl.innerHTML = '<div style="background:#141a22;border:2px solid #E8836A;border-radius:10px;padding:20px 26px;width:460px;position:relative;">' +
        // 2026-08-11 v2.98 锦上添花：右上角 × 关闭按钮（点击关闭，不中止救治）
        '<button data-act="close" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;">✕</button>' +
        `<div style="font-size:18px;color:#E8836A;letter-spacing:2px;margin-bottom:6px;text-align:center;">♨ 救治 ${name}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;text-align:center;margin-bottom:14px;">${name} 正处于<b style="color:#FF5544;">濒临死亡</b>状态，需要及时救治</div>` +
        // 存活倒计时（v2.97 现实时间：20 分钟窗口，被攻击加速减少）
        `<div style="font-size:14px;color:#FFD700;margin-bottom:4px;border:1px solid #3a3a24;background:#1a1a20;padding:8px 10px;border-radius:6px;">` +
        `⏳ 还能存活：<b>${txt}</b> <span style="color:#8a9aa2;font-size:11px;">（现实 ${Math.round(B.DOWNED_LIMIT_SECONDS / 60)} 分钟，被攻击每次伤害 -10 秒）${devInf ? ' · <b style="color:#39d98a;">开发者无限资源</b>' : ''}</span></div>` +
        // 待提交药品
        `<div style="font-size:14px;color:#e8e8e8;margin:12px 0 4px;">待提交药品：</div>` +
        `<div style="font-size:12px;color:#ccd;margin-bottom:2px;">伤口药/抗生素 ${needMed > 0 ? '<b style="color:#7DFF7D;">' + needMed + '</b>' : '<span style="color:#39d98a;">已集齐 ✔</span>'}${needMed > 0 ? ' 瓶，或 草药 ' + needHerb + ' 株' : ''}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;">已提交：对症药/抗生素 <span style="color:#FFD700;">${dwn.med || 0}</span>/${B.DOWNED_NEED_MED} · 草药 <span style="color:#FFD700;">${dwn.herb || 0}</span>/${B.DOWNED_HERB_EQUIV}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-top:6px;">药品集齐后即可救治${name}。对症药/抗生素各计 1 瓶，草药每 3 株计 1 进度。</div>` +
        // 操作
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">' +
        // 2026-08-11 v2.97 修复"药品已集齐但点不动按钮"（主控版）：done 时按钮 enabled + 绿字"集齐·完成救治"，点击提交救活。
        `<button class="menu-btn" data-act="submit" style="min-width:0;${done ? 'color:#39d98a;font-weight:bold;' : ''}">${done ? '集齐·完成救治' : (hasMed || herbs > 0 ? '提交药品' : '无药品')}</button>` +
        // 2026-08-10 用户需求：救助界面加"背起"按钮（背起濒死玩家，移速减慢）
        (sv._carryDowned
            ? '<button class="menu-btn" data-act="putdown" style="min-width:0;">放下</button>'
            : '<button class="menu-btn" data-act="carry" style="min-width:0;">背起</button>') +
        '<button class="menu-btn" data-act="close" style="min-width:0;grid-column:1/3;">关闭（不中止救治）</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#778;text-align:center;margin-top:10px;">提示：关闭界面不会导致濒死玩家死亡 · 背到床旁躺下可延长存活时间</div></div>';
    rescueEl.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'close') { closeRescue(); return; }
        if (act === 'carry') {
            // 背起濒死玩家（移动时 _downed 跟随玩家，移速减慢）
            sv._carryDowned = true;
            closeRescue();
            log(`你背起了 ${name}，走到床旁/安全点放下（移速减慢）`, '#B8C4C8');
            return;
        }
        if (act === 'putdown') {
            sv._carryDowned = false;
            if (sv.interior) { sv._downed.px = sv.interior.px; sv._downed.py = sv.interior.py; }
            else { sv._downed.px = sv.px; sv._downed.py = sv.py; }
            closeRescue();
            log(`你放下了 ${name}`, '#B8C4C8');
            return;
        }
        submitRescueMed();   // 提交药品（集齐救活）
    }));
}
// 提交救治药品：逐份提交累计；集齐触发 downedMedSubmit 救活
function submitRescueMed() {
    if (!sv._downed) { closeRescue(); return; }
    const needMed = B.DOWNED_NEED_MED - (sv._downed.med || 0);
    const needHerb = B.DOWNED_HERB_EQUIV - (sv._downed.herb || 0);
    if (needMed <= 0 || needHerb <= 0) { downedMedSubmit(sv, 0, 0); closeRescue(); return; }   // 已集齐
    const take = (id) => {
        if (WDEV.isDev() && sv._devInf) return true;   // 开发者无限资源：视为有药（不实际扣除）
        for (let i = 0; i < sv.inv.length; i++) {
            const s = sv.inv[i];
            if (s && s.id === id) { sv.inv[i] = null; return true; }
        }
        return false;
    };
    const medOk = take(B.DOWNED_RESCUE_MED) || take('med:pan');
    if (medOk) {
        sv._downed.med = (sv._downed.med || 0) + 1;
        log(`用药救治 ${sv._downed.name}（还需对症药 ${B.DOWNED_NEED_MED - sv._downed.med} 瓶 或 草药 ${B.DOWNED_HERB_EQUIV - (sv._downed.herb || 0)} 株）`, '#7DFF7D');
    } else {
        // 草药累计（3 株=1 进度）
        let herbs = 0; for (const s of sv.inv) if (s && s.id === 'herb') herbs += s.n;
        if (herbs > 0 || (WDEV.isDev() && sv._devInf)) {
            // 2026-08-11 v2.97 开发者无限资源：无草药时视为已满足所需（不实际扣除）
            const devInfHerb = WDEV.isDev() && sv._devInf;
            const takeH = devInfHerb ? Math.max(herbs, needHerb) : Math.min(herbs, needHerb);
            let left = takeH;
            for (let i = 0; i < sv.inv.length && left > 0; i++) {
                const s = sv.inv[i];
                if (s && s.id === 'herb') { const d2 = Math.min(s.n, left); s.n -= d2; left -= d2; if (s.n <= 0) sv.inv[i] = null; }
            }
            sv._downed.herb = (sv._downed.herb || 0) + takeH;
            log(`用草药救治 ${sv._downed.name}（还需草药 ${B.DOWNED_HERB_EQUIV - sv._downed.herb} 株）`, '#7DFF7D');
        } else {
            log('没有药品！需要 伤口药/抗生素 或 草药（搜刮箱子/采集草药获取）', '#FFB347');
            return;
        }
    }
    downedMedSubmit(sv, 0, 0);   // 集齐判定 + 救活
    if (sv._downed) renderRescue();   // 未救活：刷新进度
    else closeRescue();
}

// ============ 2026-08-10 队友濒死救助（用户需求：按 F 弹出救助界面手动用药） ============
// 与主控 openRescue 复用同一个 rescueEl 遮罩，但渲染"倒地队友"信息并操作 _downedMembers 里的成员。
let mateRescueId = null;
function openMateRescue(id) {
    mateRescueId = id;
    if (!rescueEl) {
        rescueEl = document.createElement('div');
        rescueEl.id = 'wsl-rescue';
        rescueEl.style.cssText = 'position:absolute;inset:0;z-index:908;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        const gc = document.getElementById('game-container');
        if (gc) gc.appendChild(rescueEl);
    }
    rescueEl.classList.remove('hidden');
    rescueEl.style.display = 'flex';
    renderMateRescue();
}
function mateRescueTarget(sv, id) {
    if (!Array.isArray(sv._downedMembers)) return null;
    return sv._downedMembers.find(x => x && x.id === id) || null;
}
function renderMateRescue() {
    if (!rescueEl || !mateRescueId) return;
    const m = mateRescueTarget(sv, mateRescueId);
    if (!m || !m.alive || !m.downed) { closeMateRescue(); return; }
    const name = m.name || '队员';
    const needMed = B.DOWNED_NEED_MED - (m.med || 0);
    const needHerb = B.DOWNED_HERB_EQUIV - (m.herb || 0);
    const done = needMed <= 0 || needHerb <= 0;
    // 存活倒计时（v2.97 现实时间：与主控同规则，20 分钟窗口 + 被攻击减时）
    // 2026-08-11 v2.98 成员救援时间随濒死次数递减：用 m.limitSec（与超时判定/头顶倒计时同源），旧档回退默认
    const onBed = false;   // v2.97 不再按床延长（用户新规则：固定 20 分钟现实时间）
    if (m._downedAtReal == null) m._downedAtReal = (sv.now != null ? sv.now : 0);
    if (m._penaltySec == null) m._penaltySec = 0;
    const spentM = Math.max(0, (sv.now != null ? sv.now : 0) - m._downedAtReal) + (m._penaltySec || 0);
    const mLimit = m.limitSec || B.DOWNED_LIMIT_SECONDS;
    const remainSecM = Math.max(0, mLimit - spentM);
    const mm = Math.floor(remainSecM / 60), ss = Math.floor(remainSecM % 60);
    const txt = `${mm} 分 ${String(ss).padStart(2, '0')} 秒`;
    const devInfM = WDEV.isDev() && sv._devInf;   // 开发者无限资源：视为药品无限，可直接提交
    const hasMed = devInfM || sv.inv.some(s => s && (s.id === B.DOWNED_RESCUE_MED || s.id === 'med:pan'));
    let herbs = 0; for (const s of sv.inv) if (s && s.id === 'herb') herbs += s.n;
    rescueEl.innerHTML = '<div style="background:#141a22;border:2px solid #E8836A;border-radius:10px;padding:20px 26px;width:460px;position:relative;">' +
        // 2026-08-11 v2.98 锦上添花：右上角 × 关闭按钮（点击关闭，不中止救治）
        '<button data-act="close" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;">✕</button>' +
        `<div style="font-size:18px;color:#E8836A;letter-spacing:2px;margin-bottom:6px;text-align:center;">♨ 救治 ${name}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;text-align:center;margin-bottom:14px;">${name} 正处于<b style="color:#FF5544;">濒临死亡</b>状态，需要及时救治</div>` +
        `<div style="font-size:14px;color:#FFD700;margin-bottom:4px;border:1px solid #3a3a24;background:#1a1a20;padding:8px 10px;border-radius:6px;">⏳ 还能存活：<b>${txt}</b> <span style="color:#8a9aa2;font-size:11px;">（现实 ${Math.round(B.DOWNED_LIMIT_SECONDS / 60)} 分钟，被攻击每次伤害 -10 秒）${devInfM ? ' · <b style="color:#39d98a;">开发者无限资源</b>' : ''}</span></div>` +
        `<div style="font-size:14px;color:#e8e8e8;margin:12px 0 4px;">待提交药品：</div>` +
        `<div style="font-size:12px;color:#ccd;margin-bottom:2px;">伤口药/抗生素 ${needMed > 0 ? '<b style="color:#7DFF7D;">' + needMed + '</b>' : '<span style="color:#39d98a;">已集齐 ✔</span>'}${needMed > 0 ? ' 瓶，或 草药 ' + needHerb + ' 株' : ''}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;">已提交：对症药/抗生素 <span style="color:#FFD700;">${m.med || 0}</span>/${B.DOWNED_NEED_MED} · 草药 <span style="color:#FFD700;">${m.herb || 0}</span>/${B.DOWNED_HERB_EQUIV}</div>` +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">' +
        // 2026-08-11 v2.97 修复"药品已集齐但点不动按钮，救不了队友"：之前 `done` 时按钮 disabled，
        // 玩家看到"药品已集齐"灰按钮不知道已自动救活——改为"集齐·完成救治"enabled 按钮，
        // 点击调 mateSubmitRescueMed（内部走 mateMedSubmit 救活+关闭），交互明确。
        `<button class="menu-btn" data-act="submit" style="min-width:0;${done ? 'color:#39d98a;font-weight:bold;' : ''}">${done ? '集齐·完成救治' : (hasMed || herbs > 0 ? '提交药品' : '无药品')}</button>` +
        // 2026-08-11 v2.97 界面一致（用户要求：两次救助界面统一）：队友救助补上与主控 renderRescue
        // 相同的"背起/放下"按钮（背起倒地队友跟随玩家，updateDownedMembersTimeout 同步坐标）。
        (sv._carryMateId === m.id
            ? '<button class="menu-btn" data-act="putdown" style="min-width:0;">放下</button>'
            : '<button class="menu-btn" data-act="carrymate" style="min-width:0;">背起</button>') +
        '<button class="menu-btn" data-act="close" style="min-width:0;grid-column:1/3;">关闭（不中止救治）</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#778;text-align:center;margin-top:10px;">提示：关闭界面不会导致濒死玩家死亡 · 背到床旁躺下可延长存活时间</div></div>';
    rescueEl.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'close') { closeMateRescue(); return; }
        if (act === 'carrymate') {
            // 背起倒地队友（移动时队友坐标跟随玩家，与主控背起 _carryDowned 一致）
            sv._carryMateId = m.id;
            closeMateRescue();
            log(`你背起了 ${m.name}，走到安全点放下（移速减慢）`, '#B8C4C8');
            return;
        }
        if (act === 'putdown') {
            sv._carryMateId = null;
            closeMateRescue();
            log(`你放下了 ${m.name}`, '#B8C4C8');
            return;
        }
        mateSubmitRescueMed();
    }));
}
function closeMateRescue() {
    mateRescueId = null;
    if (rescueEl) rescueEl.style.display = 'none';
    AudioSystem.playClick();
}
// 提交药品救活队友（手动用药：伤口药/抗生素 1 瓶 或 草药 3 株 = 1 进度；集齐救活 30% 血，状态保留）
function mateSubmitRescueMed() {
    if (!mateRescueId) return;
    const m = mateRescueTarget(sv, mateRescueId);
    if (!m || !m.alive || !m.downed) { closeMateRescue(); return; }
    const needMed = B.DOWNED_NEED_MED - (m.med || 0);
    const needHerb = B.DOWNED_HERB_EQUIV - (m.herb || 0);
    if (needMed <= 0 || needHerb <= 0) { mateMedSubmit(sv, mateRescueId, 0, 0); closeMateRescue(); return; }
    const take = (id) => {
        if (WDEV.isDev() && sv._devInf) return true;   // 开发者无限资源：视为有药（不实际扣除）
        for (let i = 0; i < sv.inv.length; i++) {
            const s = sv.inv[i];
            if (s && s.id === id) { sv.inv[i] = null; return true; }
        }
        return false;
    };
    const medOk = take(B.DOWNED_RESCUE_MED) || take('med:pan');
    if (medOk) {
        m.med = (m.med || 0) + 1;
        log(`用药救治 ${m.name}（还需对症药 ${B.DOWNED_NEED_MED - m.med} 瓶 或 草药 ${B.DOWNED_HERB_EQUIV - (m.herb || 0)} 株）`, '#7DFF7D');
    } else {
        let herbs = 0; for (const s of sv.inv) if (s && s.id === 'herb') herbs += s.n;
        if (herbs > 0 || (WDEV.isDev() && sv._devInf)) {
            // 2026-08-11 v2.97 开发者无限资源：无草药时视为已满足所需（不实际扣除）
            const devInfHerb = WDEV.isDev() && sv._devInf;
            const takeH = devInfHerb ? Math.max(herbs, needHerb) : Math.min(herbs, needHerb);
            let left = takeH;
            for (let i = 0; i < sv.inv.length && left > 0; i++) {
                const s = sv.inv[i];
                if (s && s.id === 'herb') { const d2 = Math.min(s.n, left); s.n -= d2; left -= d2; if (s.n <= 0) sv.inv[i] = null; }
            }
            m.herb = (m.herb || 0) + takeH;
            log(`用草药救治 ${m.name}（还需草药 ${B.DOWNED_HERB_EQUIV - m.herb} 株）`, '#7DFF7D');
        } else {
            log('没有药品！需要 伤口药/抗生素 或 草药（搜刮箱子/采集草药获取）', '#FFB347');
            return;
        }
    }
    mateMedSubmit(sv, mateRescueId, 0, 0);   // 集齐判定 + 救活
    if (mateRescueTarget(sv, mateRescueId)) renderMateRescue();
    else closeMateRescue();
}
// 救活倒地队友（集齐药品调用）：30% 血，其他状态（感染/疾病/属性）保持原样（用户要求）
export function mateMedSubmit(sv, id, med, herb) {
    const m = mateRescueTarget(sv, id);
    if (!m) return false;
    if (med) m.med = (m.med || 0) + med;
    if (herb) m.herb = (m.herb || 0) + herb;
    if ((m.med || 0) >= B.DOWNED_NEED_MED || (m.herb || 0) >= B.DOWNED_HERB_EQUIV) {
        m.downed = false;
        m.alive = true;
        m.hp = Math.max(1, Math.round(m.maxHp * 0.3));   // 30% 血
        // 状态保留：不清 infection/sick/attrs
        // 2026-08-11 v2.99 修复"队友被救活后再次被击杀，全灭弹窗仍显示上次死因（被僵尸咬死）"：
        // 救活 = 恢复健康，死因必须清空（与 downedMedSubmit 主控救活一致），下次死亡按新的
        // 攻击来源重新记录——否则救活后 _deathReason 残留旧值，再死弹窗复用旧死因。
        m._deathReason = null;
        if (Array.isArray(sv._downedMembers)) {
            sv._downedMembers = sv._downedMembers.filter(x => x !== m);
        }
        // 2026-08-11 v2.97 修复"切队友视角救活幸存者后，当前主控头上残留濒死标志/倒计时"：
        // 幸存者作为 sv._downed（主控倒地）被队友 F 救活走的是 mateMedSubmit——此前只清
        // _downedMembers，**不清 sv._downed** → 残留的 _downed 让渲染层（drawPlayer 的
        // drawDownedTimeBar）在【当前主控】头顶画救援倒计时，但人已救活、还能操控。
        // 若救活的目标就是 sv._downed 对应角色 → 同步清 sv._downed（含相关状态）。
        if (sv._downed) {
            const dId = sv._downed.id;
            const dName = sv._downed.name;
            if ((dId != null && m.id === dId) || (dName && m.name === dName)) {
                sv._downed = null;
                sv._waitDowned = false;
                sv._carryDowned = false;
            }
        }
        // 2026-08-11 v2.97 界面一致：救活的若是正在被背起的队友 → 清 _carryMateId
        if (sv._carryMateId === m.id) sv._carryMateId = null;
        if (sv.controllerId === m.id) {   // 若救活的是当前操控的成员 → 恢复主控血量
            sv.hp = m.hp; sv.maxHp = m.maxHp;
        }
        log(`${m.name} 被救活了！`, '#7DFF7D');
        saveNow();
    }
    return true;
}

// ================= 交易（按物品价值定价，金币结算） =================
let tradeEl = null;
function countCoins(sv) { return sv.coins || 0; }
function takeCoins(sv, need) {
    const have = sv.coins || 0;
    if (have < need) return false;
    sv.coins = have - need;
    return true;
}
function openNpcTrade(npc) {
    if (!tradeEl) {
        tradeEl = document.createElement('div');
        tradeEl.id = 'wsl-trade';
        tradeEl.style.cssText = 'position:absolute;inset:0;z-index:907;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        document.getElementById('game-container').appendChild(tradeEl);
    }
    sv.npcTrade = { id: npc.id };
    tradeEl.style.display = 'flex';
    renderTrade();
}
function renderTrade() {
    const npc = findNpc(sv.npcTrade.id);
    if (!npc || !npc.alive) { closeTrade(); return; }
    const devInf = !!sv._devInf;
    // 智力修正：聪明的主控买卖更划算（±20% 封顶）
    const intMul = 1 - Math.max(-0.2, Math.min(0.2, (WNPC.controlledAttrs(sv).int - 10) * 0.01));
    const buys = npc.inv.filter(s => s && s.n > 0 && !String(s.id).startsWith('wpn:'));   // 武器不出售
    const sells = sv.inv.filter(s => s && s.n > 0 && s.id !== B.COIN_ID);
    const buyHtml = buys.length
        ? buys.map(s => {
            const price = Math.max(1, Math.ceil(B.itemValue(s.id) * B.TRADE_MARKUP * intMul));
            const info = Panel.getItemInfo(s.id);
            const char = (info && info.char) ? info.char : '·';
            const canAfford = devInf || countCoins(sv) >= price;
            return `<button class="wsl-trade-row${canAfford ? '' : ' unafford'}" data-act="buy" data-i="${npc.inv.indexOf(s)}">
                <span class="wsl-trade-char" style="color:${info.color || '#ffe9a8'}">${char}</span>
                <span class="wsl-trade-name">${info.name}</span>
                <span class="wsl-trade-n">×${s.n}</span>
                <span class="wsl-trade-price">${devInf ? '免费' : price + ' 金币'}</span></button>`;
        }).join('')
        : '<div class="wsl-trade-empty">NPC 暂无商品</div>';
    const sellHtml = sells.length
        ? sells.map(s => {
            const price = Math.max(1, Math.floor(B.itemValue(s.id) * B.TRADE_DISCOUNT / intMul));
            const info = Panel.getItemInfo(s.id);
            const char = (info && info.char) ? info.char : '·';
            const npcCanAfford = (npc.coins || 0) >= price;
            return `<button class="wsl-trade-row${npcCanAfford ? '' : ' unafford'}" data-act="sell" data-i="${sv.inv.indexOf(s)}">
                <span class="wsl-trade-char" style="color:${info.color || '#bfe4ff'}">${char}</span>
                <span class="wsl-trade-name">${info.name}</span>
                <span class="wsl-trade-n">×${s.n}</span>
                <span class="wsl-trade-price">${price} 金币</span></button>`;
        }).join('')
        : '<div class="wsl-trade-empty">背包没有可卖物品</div>';
    tradeEl.innerHTML = '<div class="wsl-trade-panel" style="position:relative;">' +
        // 2026-08-11 v2.99 用户要求：关闭用叉号（右上角），不显示 ESC 文字按钮
        '<button class="wsl-trade-btn" data-act="close" style="position:absolute;top:8px;right:12px;width:auto;margin:0;background:none;border:none;color:#8a9aa2;font-size:18px;line-height:1;padding:2px;" title="关闭 (F)">✕</button>' +
        `<div class="wsl-trade-head">◇ 与 ${npc.name} 交易 ◇</div>` +
        `<div class="wsl-trade-balance">你的金币 <b style="color:#FFD700;">${countCoins(sv)}</b> · ${npc.name} 金币 <b style="color:#FFD700;">${npc.coins || 0}</b>　·　买入价 ×${Math.round(B.TRADE_MARKUP * 100)}% · 卖出价 ×${Math.round(B.TRADE_DISCOUNT * 100)}%${devInf ? ' · 开发者免费' : ''}</div>` +
        '<div class="wsl-trade-cols">' +
        '<div class="wsl-trade-col"><div class="wsl-trade-coltitle buy">— 购买（NPC 的商品）—</div>' + buyHtml + '</div>' +
        '<div class="wsl-trade-col"><div class="wsl-trade-coltitle sell">— 出售（卖给 NPC）—</div>' + sellHtml + '</div>' +
        '</div>' +
        '</div>';
    tradeEl.querySelectorAll('.wsl-trade-btn, .wsl-trade-row').forEach(el => el.addEventListener('click', () => tradeAct(el.dataset.act, parseInt(el.dataset.i))));
}
function tradeAct(act, i) {
    const npc = findNpc(sv.npcTrade.id);
    if (!npc || !npc.alive) { closeTrade(); return; }
    if (act === 'close') { closeTrade(); return; }
    const devInf = !!sv._devInf;
    let traded = false;   // 成交标记：guest 上报 NPC 背包/金币变更给 host
    if (act === 'buy') {
        const s = npc.inv[i];
        if (!s || s.n <= 0) return;
        const price = devInf ? 0 : Math.max(1, Math.ceil(B.itemValue(s.id) * B.TRADE_MARKUP));
        if (!devInf && countCoins(sv) < price) { log('金币不足，无法购买', '#FFB347'); return; }
        const left = Panel.addItem(sv, s.id, 1);
        if (left > 0) { log('背包已满', '#FF8866'); return; }
        if (!devInf) takeCoins(sv, price);
        s.n--;
        if (s.n <= 0) npc.inv.splice(i, 1);
        log(`购买 ${Panel.getItemInfo(s.id).name}（${devInf ? '开发者免费' : price + ' 金币'}）`, '#7DFF7D');
        traded = true;
    } else if (act === 'sell') {
        const s = sv.inv[i];
        if (!s || s.n <= 0) return;
        const price = Math.max(1, Math.floor(B.itemValue(s.id) * B.TRADE_DISCOUNT));
        if ((npc.coins || 0) < price) { log(`${npc.name} 的金币不够了`, '#FFB347'); return; }
        s.n--;
        if (s.n <= 0) sv.inv[i] = null;
        sv.coins = (sv.coins || 0) + price;
        npc.coins = (npc.coins || 0) - price;
        npc.inv.push({ id: s.id, n: 1 });
        log(`卖出 ${Panel.getItemInfo(s.id).name}（${price} 金币）`, '#FFD700');
        traded = true;
    }
    // 联机 guest：成交后把 NPC 背包/金币变更上报 host（host 覆写 → 双端一致且入世界档）
    if (traded && sv.mp && sv.mp.role === 'guest') {
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'npcinv', id: npc.id, inv: JSON.parse(JSON.stringify(npc.inv)), coins: npc.coins || 0 });
    }
    renderTrade();
}
function closeTrade() {
    sv.npcTrade = null;
    if (tradeEl) tradeEl.style.display = 'none';
    AudioSystem.playClick();
}
function tradeOpen() { return !!(sv && sv.npcTrade && tradeEl && tradeEl.style.display !== 'none'); }
// 当前菜单可见选项顺序（数字键映射）
function carActByIndex(i) {
    const m = WV.carData(sv, sv.carMenu && sv.carMenu.key);
    if (!m) return 'close';
    const isWreck = m.cond === 'wreck' && !m.repaired;
    const acts = [];
    if (!m.repaired && !isWreck) acts.push('repair');
    if (isWreck) acts.push('dismantle');
    if (!isWreck) acts.push('trunk');
    acts.push('drive');
    acts.push('close');
    return acts[i] || 'close';
}

// 打开战利品袋：未开袋(loot:)左键开一个(有搜索过程)；已搜袋(looted:)点击进界面直接拿(无进度)
// 2026-08-10 前置检查：战利品单袋最多 4 格物品（zombieCommon 1-3 / rare 1-4 / epic 2-4），
// 背包空位不足 4 格时先提示，避免"装不下→关闭→剩余物掉地"的挫败感。
function lootFreeSlots() {
    return (sv.inv || []).filter(s => !s).length;
}
function checkLootSpace(need) {
    const free = lootFreeSlots();
    if (free < (need || 4)) {
        log(`背包空间不足：打开战利品需预留 ${need || 4} 格（当前空 ${free} 格），请先整理背包`, '#FFB347');
        return false;
    }
    return true;
}
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

    window.addEventListener('keydown', (e) => {
        if (!sv || !sv.active) return;
        const k = e.key.toLowerCase();
        if (['w', 'a', 's', 'd', ' ', 'f', 'b', 'j', 'escape', 'p', 'r', 'v', 'g', 'q', 'e', 'x', 'h', 'm', 'control', 'f1', 'f9', 'f11',
            'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
        sv.keys[k] = true;
        // 2026-08-10 Ctrl 蹲下：按住 Ctrl 潜伏（屏幕变暗、敌对感知范围减半、移速 -30%）
        if (k === 'control') sv.squatting = true;
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
            if (k === 'escape' || k === 'f') { campPanelEl.style.display = 'none'; return; }
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
        if (WW.isOpen()) {
            if (k === 'escape' || k === 'k') WW.close();
            return;
        }
        if (k === 'k') { WW.open(sv, { onMessage: log }); return; }
        // 2026-08-09 修复"打开 NPC 物品栏查看物品后 UI 关不掉"：B 键本应关闭储物柜
        // （界面提示 B/F/ESC 关闭），但此处无条件 toggleBag，储物柜(含 NPC 只读查看)打开时
        // 按 B 只会切换背包、储物柜永远关不掉。改为：储物柜打开时 B 先关闭储物柜。
        if (k === 'b') {
            if (Panel.isChestOpen()) { Panel.hideChest(); return; }
            Panel.toggleBag(sv); return;
        }
        if (k === 'escape') {
            // ESC 只关闭已打开的面板（避免与浏览器退出全屏冲突）；暂停菜单用 P
            if (WDEV.isOpen()) { WDEV.close(); return; }   // 2026-08-10 开发者面板通用返回
            if (sv._flagPlace && sv._flagPlace.active) { sv._flagPlace = null; log('已取消放置旗帜（旗帜未消耗）', '#8a9aa2'); return; }   // 2026-08-10 旗帜待放置取消
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
        if (k === 'm') { if (!sv.interior) WMAP.toggle(sv); return; }   // 2026-08-10 世界地图（仅室外）
        if (k === 'g') {
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
        if (k === 'c') {
            if (charPanelOpen()) { closeCharPanel(); return; }   // C 再按关闭属性面板
            openCharPanel(sv.controllerId); return;
        }
        if (k === 'h') {
            if (npcMgrOpen()) { closeNpcMgr(); return; }   // H 再按关闭队伍管理
            openNpcMgr(); return;
        }
        // 背起/放下倒地主角（2026-08-09）：靠近倒地主角时按 V 背起，背起后再按 V 放下
        if (k === 'v' && sv._downed) {
            if (sv._carryDowned) {
                // 背起状态：V = 放下（当前位置放下，室内用房间坐标）
                sv._carryDowned = false;
                if (sv.interior) { sv._downed.px = sv.interior.px; sv._downed.py = sv.interior.py; }
                else { sv._downed.px = sv.px; sv._downed.py = sv.py; }
                log(`你放下了 ${sv._downed.name}`, '#B8C4C8');
                return;
            }
            const d = Math.hypot(sv.px - sv._downed.px, sv.py - sv._downed.py);
            if (d < 1.9 * TS) {
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
        // 2026-08-11 集合信号（按 T，非倒地切视角时）：所有 NPC 队友转为跟随、缓慢向你走来。
        // 队友离得远时屏幕边缘已有指向箭头+名字+距离（render.drawMateGuide），发出信号后
        // 他们沿寻路（moveToward/followAI）过来；卡碰撞体由 npcUnstick/寻路兜底自动脱离。
        if (k === 't' && !sv._waitDowned) {
            const mates = (sv.npcs || []).filter(n => n.alive && n.party && !n.downed && !n.isPlayer && n.id !== sv.controllerId && !n.riding);
            if (!mates.length) { log('队伍里没有其他队员', '#FFB347'); return; }
            let n2 = 0;
            const near = [], far = [];
            for (const m of mates) {
                m.state = 'follow';
                m.campTask = null;
                m._path = null;   // 清寻路缓存，重新跟随
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
        if (k === 'f') {
            if (sv.interior) { doInteriorInteract(); return; }
            doInteract(); return;
        }
        if (k === 'q') { WA.startDash(sv); return; }
        if (k === 'e') { WA.startGuard(sv); return; }
        if (k === ' ') { WA.tryJump(sv); return; }
        if (k === 'j') { const r = withInteriorZombies(() => WG.meleeAttack(sv)); if (r && r.msg) log(r.msg); return; }
        if (k === 'r') { const r = WG.startReload(sv); if (r && r.msg) log(r.msg); return; }
        if (k === 'x') { const r = WG.swapSlot(sv); if (r && r.msg) log(r.msg); return; }
        if (k === 'v') { const r = WG.toggleFireMode(sv); if (r && r.msg) log(r.msg); return; }
    });

    window.addEventListener('keyup', (e) => {
        if (!sv) return;
        const k = e.key.toLowerCase();
        sv.keys[k] = false;
        if (k === 'control') sv.squatting = false;   // 松开 Ctrl → 解除蹲下
        if (k === 'e') WA.endGuard(sv);
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

    canvas.addEventListener('mousedown', (e) => {
        if (!sv || !sv.active || sv.dead || Panel.anyOpen() || WSearch.isOpen()) return;   // 搜索界面打开：禁止攻击
        if (e.button === 2) {
            e.preventDefault();
            if (!sv.build) { const r = WG.toggleScope(sv); if (r && r.msg) log(r.msg); }
            return;
        }
        if (e.button !== 0) return;
        e.preventDefault();
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
        if (e.button !== 0 || !sv) return;
        sv.mouseDown = false;
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
        // 创建角色：命名 → 捏脸 → 落角色档
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
        });
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
    const el = document.createElement('div');
    el.id = 'wsl-start';
    el.style.cssText = 'position:fixed;inset:0;z-index:1240;background:rgba(5,8,12,0.94);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
    // 2026-08-09 重构：左右布局 —— 左侧角色捏脸预览动画（跟捏脸界面一样循环走步 + tintSprite），
    // 右侧选择器。世界 ↔ 角色【强绑定】：选世界 → 只读显示该世界绑定的角色（角色选择权限关闭，
    // 不可自由切换）；世界无绑定角色 → 显示「创建绑定角色」。创建新世界 → 紧接着创建角色绑定。
    el.innerHTML = `
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:20px;width:640px;box-shadow:0 0 40px rgba(57,217,138,0.25);display:flex;gap:16px;">
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
                <div style="display:flex;gap:8px;justify-content:center;margin-top:auto;">
                    <button id="wsl-start-cancel" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:10px;cursor:pointer;">取消</button>
                    <button id="wsl-start-ok" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:10px;cursor:pointer;">开始游戏 ▶</button>
                </div>
                <div id="wsl-start-hint" style="text-align:center;color:#5a6a62;font-size:11px;"></div>
            </div>
        </div>`;
    document.body.appendChild(el);
    el.querySelector('#wsl-start-cancel').addEventListener('click', () => { cancelStartPreview(); el.remove(); });
    el.querySelector('#wsl-start-charnew').addEventListener('click', () => startBoundCharacter());
    el.querySelector('#wsl-start-worldnew').addEventListener('click', () => startNewWorld());
    // 继续游戏 / 开始游戏共用同一按钮位置（2026-08-09 用户要求）：
    // 旧存档（该世界游玩过）显示「继续游戏」直接进入；新创建（未游玩）显示「开始游戏」弹单机/联机选择
    el.querySelector('#wsl-start-ok').addEventListener('click', () => {
        const ok = el.querySelector('#wsl-start-ok');
        if (ok.dataset.mode === 'continue') continueGameConfirm();
        else startGameConfirm();
    });
    // 世界选择 → 显示该世界绑定的角色（只读）→ 刷新预览
    el.querySelector('#wsl-start-world').addEventListener('change', () => updateStartPreview());
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
        if (name) { charBox.textContent = name; charBox.style.color = '#cfe8cf'; }
        else { charBox.textContent = '—（未绑定角色）'; charBox.style.color = '#8a5a5a'; }
    }
    if (charNewBtn) {
        // 已选世界且未绑定角色 → 可创建；否则（未选世界或已绑定）禁用
        charNewBtn.disabled = !(seed && !name);
        charNewBtn.style.opacity = charNewBtn.disabled ? 0.4 : 1;
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
function startWorldOptionsHtml() {
    const user = (getSession && getSession() && getSession().username) || '__guest__';
    const prefix = 'u:' + user + ':wasteland_world_';
    const list = [];
    for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        if (!full || !full.startsWith(prefix)) continue;
        const seedStr = full.slice(prefix.length);
        try {
            const d = JSON.parse(localStorage.getItem(full));
            if (!d || typeof d.seed !== 'number') continue;
            list.push({ seed: d.seed, name: d.name || ('世界 #' + d.seed), diff: d.difficulty || 'normal', day: d.day || 1 });
        } catch { /* 损坏键跳过 */ }
    }
    list.sort((a, b) => (b.seed - a.seed));
    const diffName = { normal: '正常', hardcore: '硬核' };
    return list.map(w =>
        `<option value="${w.seed}">${escHtml(w.name)} · 第${w.day}天 · ${diffName[w.diff] || '正常'}</option>`).join('');
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
            ? '继续游戏 = 直接进入该角色与该世界的现有进度（不再弹单机/联机选择）'
            : '开始游戏 = 选择单人 / 多人联机后进入（新世界 / 新角色从第一天开始）';
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
    el.remove();
    const worldData = getStorage(worldKey(seed), null);
    const diff = (worldData && worldData.difficulty) || 'normal';
    const baseOpts = { characterName: charName, seed, difficulty: diff };
    if (_startDialogCb && _startDialogCb.onLaunch) _startDialogCb.onLaunch(baseOpts);
    else enterWasteland(baseOpts);
}
function startGameConfirm() {
    const el = document.getElementById('wsl-start');
    if (!el) return;
    const seed = Number(el.querySelector('#wsl-start-world').value);
    const charName = boundCharName(seed);
    if (!seed || !charName) { log('请先选择世界（须已绑定角色）', '#FFB347'); return; }
    cancelStartPreview();
    el.remove();
    // 读世界档难度（锁定）
    const worldData = getStorage(worldKey(seed), null);
    const diff = (worldData && worldData.difficulty) || 'normal';
    const baseOpts = { characterName: charName, seed, difficulty: diff };
    // 弹出「单人 / 多人联机」选择
    showPlayModeDialog(baseOpts);
}
// 创建绑定角色：为当前选中的世界创建角色并绑定（世界↔角色强绑定）
// 世界无绑定角色 → 点「创建绑定角色」；创建成功后写 world.characterName 并回弹窗选中该世界
function startBoundCharacter() {
    const el = document.getElementById('wsl-start');
    const ws = el && el.querySelector('#wsl-start-world');
    const seed = ws ? Number(ws.value) : 0;
    if (!seed) { log('请先选择世界', '#FFB347'); return; }
    if (el) el.style.display = 'none';
    const nameInput = document.createElement('div');
    nameInput.innerHTML = `
        <div style="position:fixed;inset:0;z-index:1260;background:rgba(5,8,12,0.94);display:flex;align-items:center;justify-content:center;font-family:'Microsoft YaHei',monospace;">
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 28px;width:420px;box-shadow:0 0 40px rgba(57,217,138,0.25);">
            <div style="text-align:center;color:#39d98a;font-size:20px;letter-spacing:4px;margin-bottom:6px;">◈ 创建绑定角色 ◈</div>
            <div style="text-align:center;color:#7a8a92;font-size:12px;margin-bottom:12px;">创建后自动绑定到当前世界（一个世界对应一个角色）</div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">角色名字（可留空随机）：</div>
            <div style="display:flex;gap:8px;margin-bottom:14px;">
                <input id="wsl-bc-name" maxlength="12" placeholder="点击 🎲 随机生成" style="flex:2;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;color:#dce6e2;font-size:15px;">
                <button id="wsl-bc-rnd" style="flex:1;background:#1a2a3a;border:1px solid #4da3ff;color:#4da3ff;border-radius:6px;cursor:pointer;">🎲 随机</button>
            </div>
            <div style="display:flex;gap:8px;justify-content:center;">
                <button id="wsl-bc-back" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:9px;cursor:pointer;">返回</button>
                <button id="wsl-bc-next" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:9px;cursor:pointer;">下一步：捏脸 ▶</button>
            </div>
        </div></div>`;
    document.body.appendChild(nameInput);
    nameInput.querySelector('#wsl-bc-rnd').addEventListener('click', () => { nameInput.querySelector('#wsl-bc-name').value = randomName(''); });
    const back = () => { nameInput.remove(); const s = document.getElementById('wsl-start'); if (s) s.style.display = 'flex'; };
    nameInput.querySelector('#wsl-bc-back').addEventListener('click', back);
    nameInput.querySelector('#wsl-bc-next').addEventListener('click', () => {
        const raw = (nameInput.querySelector('#wsl-bc-name').value || '').trim();
        const name = raw || randomName('');
        let finalName = name;
        const list = getStorage(CHAR_LIST_KEY, { names: [] });
        let k = 2;
        while (list.names.includes(finalName)) finalName = name + '_' + (k++);
        nameInput.remove();
        // 捏脸 → 保存角色 → 绑定到当前世界
        showLookCreator((look) => {
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
            const s = document.getElementById('wsl-start');
            if (s) { s.style.display = 'flex'; renderStartDialog(); }
        }, randomLook());
    });
}
// 创建新角色：命名/随机 → 捏脸 → 保存（不进游戏）→ 回弹窗
function startNewCharacter() {
    const el = document.getElementById('wsl-start');
    if (el) el.style.display = 'none';
    const nameInput = document.createElement('div');
    nameInput.innerHTML = `
        <div style="position:fixed;inset:0;z-index:1260;background:rgba(5,8,12,0.94);display:flex;align-items:center;justify-content:center;font-family:'Microsoft YaHei',monospace;">
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 28px;width:420px;box-shadow:0 0 40px rgba(57,217,138,0.25);">
            <div style="text-align:center;color:#39d98a;font-size:20px;letter-spacing:4px;margin-bottom:14px;">◈ 创建新角色 ◈</div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">角色名字（可留空随机）：</div>
            <div style="display:flex;gap:8px;margin-bottom:14px;">
                <input id="wsl-nc-name" maxlength="12" placeholder="点击 🎲 随机生成" style="flex:2;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;color:#dce6e2;font-size:15px;">
                <button id="wsl-nc-rnd" style="flex:1;background:#1a2a3a;border:1px solid #4da3ff;color:#4da3ff;border-radius:6px;cursor:pointer;">🎲 随机</button>
            </div>
            <div style="display:flex;gap:8px;justify-content:center;">
                <button id="wsl-nc-back" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:9px;cursor:pointer;">返回</button>
                <button id="wsl-nc-next" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:9px;cursor:pointer;">下一步：捏脸 ▶</button>
            </div>
        </div></div>`;
    document.body.appendChild(nameInput);
    nameInput.querySelector('#wsl-nc-rnd').addEventListener('click', () => { nameInput.querySelector('#wsl-nc-name').value = randomName(''); });
    const back = () => { nameInput.remove(); const s = document.getElementById('wsl-start'); if (s) s.style.display = 'flex'; };
    nameInput.querySelector('#wsl-nc-back').addEventListener('click', back);
    nameInput.querySelector('#wsl-nc-next').addEventListener('click', () => {
        const raw = (nameInput.querySelector('#wsl-nc-name').value || '').trim();
        const name = raw || randomName('');
        // 重名检查：重名则加后缀
        let finalName = name;
        const list = getStorage(CHAR_LIST_KEY, { names: [] });
        let k = 2;
        while (list.names.includes(finalName)) finalName = name + '_' + (k++);
        nameInput.remove();
        // 捏脸 → 保存（不进游戏）→ 回弹窗
        showLookCreator((look) => {
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
            log(`角色「${finalName}」已创建（物品与属性随角色保留）`, '#7DFF7D');
            const s = document.getElementById('wsl-start');
            if (s) { s.style.display = 'flex'; renderStartDialog(); }
        }, randomLook());
    });
}
// 创建新世界：命名/随机 + 选难度 → 保存记录（不进游戏）→ 回弹窗（难度锁定）
function startNewWorld() {
    const el = document.getElementById('wsl-start');
    if (el) el.style.display = 'none';
    const wInput = document.createElement('div');
    wInput.innerHTML = `
        <div style="position:fixed;inset:0;z-index:1260;background:rgba(5,8,12,0.94);display:flex;align-items:center;justify-content:center;font-family:'Microsoft YaHei',monospace;">
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 28px;width:440px;box-shadow:0 0 40px rgba(57,217,138,0.25);">
            <div style="text-align:center;color:#39d98a;font-size:20px;letter-spacing:4px;margin-bottom:14px;">◈ 创建新世界 ◈</div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">世界名称（可留空随机）：</div>
            <div style="display:flex;gap:8px;margin-bottom:14px;">
                <input id="wsl-nw-name" maxlength="16" placeholder="点击 🎲 随机生成" style="flex:2;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;color:#dce6e2;font-size:15px;">
                <button id="wsl-nw-rnd" style="flex:1;background:#1a2a3a;border:1px solid #4da3ff;color:#4da3ff;border-radius:6px;cursor:pointer;">🎲 随机</button>
            </div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">世界难度（创建后锁定，不可修改）：</div>
            <div style="display:flex;gap:8px;margin-bottom:20px;">
                <button class="wsl-nw-diff" data-diff="normal" style="flex:1;background:#123d2c;border:2px solid #39d98a;color:#39d98a;border-radius:6px;padding:9px;cursor:pointer;">正常</button>
                <button class="wsl-nw-diff" data-diff="hardcore" style="flex:1;background:#241c1c;border:2px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:9px;cursor:pointer;">硬核</button>
            </div>
            <div style="display:flex;gap:8px;justify-content:center;">
                <button id="wsl-nw-back" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:9px;cursor:pointer;">返回</button>
                <button id="wsl-nw-ok" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:9px;cursor:pointer;">创建世界 ✓</button>
            </div>
        </div></div>`;
    document.body.appendChild(wInput);
    let diff = 'normal';
    wInput.querySelector('#wsl-nw-rnd').addEventListener('click', () => { wInput.querySelector('#wsl-nw-name').value = randomName(''); });
    wInput.querySelectorAll('.wsl-nw-diff').forEach(b => b.addEventListener('click', () => {
        diff = b.dataset.diff;
        wInput.querySelectorAll('.wsl-nw-diff').forEach(x => { x.style.borderColor = x === b ? '#39d98a' : '#2a3a33'; x.style.color = x === b ? '#39d98a' : '#7a8a92'; });
    }));
    const back = () => { wInput.remove(); const s = document.getElementById('wsl-start'); if (s) s.style.display = 'flex'; };
    wInput.querySelector('#wsl-nw-back').addEventListener('click', back);
    wInput.querySelector('#wsl-nw-ok').addEventListener('click', () => {
        const raw = (wInput.querySelector('#wsl-nw-name').value || '').trim();
        const name = raw || randomName('');
        // 随机种子 + 建空世界档（记录名称/难度，未游玩）
        const seed = Math.floor(Math.random() * 0x7fffffff);
        setStorage(worldKey(seed), {
            seed, name, difficulty: diff,
            t: B.DAY_LEN * 0.35, day: 1, playT: 0,
            mods: { tiles: {}, chests: {}, boxLoot: {} },
            npcs: null, px: 0, py: 0, characterName: null,   // 创建世界后立即创建角色绑定（2026-08-09）
        });
        log(`世界「${name}」已创建（${diff === 'normal' ? '正常' : '硬核'}难度 · 锁定不可改）`, '#7DFF7D');
        wInput.remove();
        // 2026-08-09 用户要求：创建世界后必须接着创建角色绑定 → 直接弹「创建绑定角色」
        const s = document.getElementById('wsl-start');
        if (s) {
            // 把刚建的世界设为目标，弹绑定角色创建
            const ws = s.querySelector('#wsl-start-world');
            // 先刷新世界下拉并选中新世界
            renderStartDialog();
            const ws2 = document.getElementById('wsl-start') && document.getElementById('wsl-start').querySelector('#wsl-start-world');
            if (ws2 && [...ws2.options].some(o => o.value === String(seed))) ws2.value = String(seed);
            updateStartPreview();
            startBoundCharacter();
        }
    });
}
// 游玩模式选择（点「开始游戏」后）：单人 / 多人联机
function showPlayModeDialog(baseOpts) {
    const el = document.createElement('div');
    el.id = 'wsl-playmode';
    el.style.cssText = 'position:fixed;inset:0;z-index:1270;background:rgba(5,8,12,0.94);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
    el.innerHTML = `
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 30px;width:400px;box-shadow:0 0 40px rgba(57,217,138,0.25);">
            <div style="text-align:center;color:#39d98a;font-size:20px;letter-spacing:4px;margin-bottom:16px;">◈ 选择游玩模式 ◈</div>
            <div style="display:flex;gap:10px;">
                <button id="wsl-pm-solo" style="flex:1;background:#123d2c;border:2px solid #39d98a;color:#39d98a;border-radius:8px;padding:14px;cursor:pointer;font-size:15px;">单人游玩</button>
                <button id="wsl-pm-mp" style="flex:1;background:#1a2a3a;border:2px solid #4da3ff;color:#4da3ff;border-radius:8px;padding:14px;cursor:pointer;font-size:15px;">多人联机</button>
            </div>
            <div style="text-align:center;color:#7a8a92;font-size:12px;margin-top:12px;">选择角色：${escHtml(baseOpts.characterName)} · 世界难度：${baseOpts.difficulty === 'hardcore' ? '硬核' : '正常'}</div>
        </div>`;
    document.body.appendChild(el);
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

// 角色创建弹窗：命名 → 确认后进捏脸
export function showCreateCharacter(onDone) {
    const el = document.createElement('div');
    el.id = 'wsl-char-create';
    el.style.cssText = 'position:fixed;inset:0;z-index:1250;background:rgba(5,8,12,0.92);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
    el.innerHTML = `
        <div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:24px 28px;width:420px;box-shadow:0 0 40px rgba(57,217,138,0.25);">
            <div style="text-align:center;color:#39d98a;font-size:22px;letter-spacing:6px;margin-bottom:6px;">◈ 创建幸存者 ◈</div>
            <div style="text-align:center;color:#7a8a92;font-size:12px;margin-bottom:16px;">物品与属性将随角色带入任何世界（泰拉瑞亚式）</div>
            <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">角色名字：</div>
            <input id="wsl-char-name" maxlength="8" placeholder="例如：阿远" style="width:100%;box-sizing:border-box;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;color:#dce6e2;font-size:16px;">
            <div style="display:flex;gap:8px;margin-top:14px;justify-content:center;">
                <button id="wsl-char-cancel" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:9px;cursor:pointer;">取消</button>
                <button id="wsl-char-ok" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:9px;cursor:pointer;">下一步：捏脸 ▶</button>
            </div>
        </div>`;
    document.body.appendChild(el);
    el.querySelector('#wsl-char-cancel').addEventListener('click', () => { el.remove(); });
    const ok = () => {
        const name = (el.querySelector('#wsl-char-name').value || '').trim() || ('幸存者' + Math.floor(Math.random() * 900 + 100));
        el.remove();
        // 新建角色：以"全新随机多彩配色"为捏脸起点（而非继承上次外观），
        // 避免每次新建都看到同一套配色，也呼应"色板应有多姿多彩"。
        showLookCreator((look) => onDone(name, look), randomLook());
    };
    el.querySelector('#wsl-char-ok').addEventListener('click', ok);
    el.querySelector('#wsl-char-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    setTimeout(() => el.querySelector('#wsl-char-name').focus(), 50);
}

function startRun(opts) {
    // 普通玩家设置（workshop 荒原面板，无需开发者模式）：帧率显示 + 画质档
    if (opts.gfx != null) sv._devGfx = opts.gfx;
    sv._showFps = !!opts.showFps;
    // 难度两档归一：旧档（easy/hard/hell 四档时代）读档自动映射——
    // easy→normal（软）、hard/hell→hardcore（硬核一条命）
    const DIFF_LEGACY = { easy: 'normal', normal: 'normal', hard: 'hardcore', hell: 'hardcore' };
    sv.diffKey = B.DIFF_TABLE[opts.difficulty] ? opts.difficulty : (DIFF_LEGACY[opts.difficulty] || 'normal');
    WG.initWpn(sv, sv._savedMag);

    Panel.initPanel({ onUse: useItem, onDrop: dropItem, onChestDrop: dropChestItem, onBatchOpen: batchOpenLoot });
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
    // 老存档（playT>0 或已看过教程）仍直接按原逻辑显示教程。
    if (sv._legacyNote) log('检测到旧版荒原存档（已备份），已为你开启全新无限荒原！');
    else if (sv.playT > 0 || sv.day > 1) {
        log(`欢迎回到荒原 · 第 ${sv.day} 天`);
        TUT.showIfFirst(sv);   // 老存档：直接显示（首次看教程场景）
    } else {
        log('你醒来时，发现自己躺在一片荒原上……'); AudioSystem.playGameStart();
        // 2026-08-09 昏迷苏醒过渡：刚醒来黑灰眨眼几次，期间不能移动，像素氛围更有代入感
        sv._wake = { t: 0, dur: 2.4 };
        // 2026-08-11 v2.99 新存档：教程等睁眼动画（文字消失，约 2.4s）结束后再弹出
        TUT.showIfFirstAfterWake(sv, 2500);
    }

    sv.last = performance.now();
    sv.raf = requestAnimationFrame(loop);
    startBgKeepAlive();
    const rootEl = document.documentElement;
    if (rootEl && rootEl.requestFullscreen) rootEl.requestFullscreen().catch(() => {});
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
    const npcVisible = (n) => n && !n.isPlayer && n.alive && (n.party || n.hired || near(n.x, n.y));
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
