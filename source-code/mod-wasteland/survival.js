// ============================================================
// 【无尽植僵荒原】模组 · 生存模式主控（调度层）
// 建造→wbuild.js / 僵尸→wzombie.js / 尸潮→whorde.js / 数值→wbalance.js
// ============================================================

import { ZOMBIES, AMMO_INFO, WEAPONS, ACTION } from '../core/constants.js';
import { getStorage, setStorage, writeSave } from '../persistence/storage.js';
import { saveData } from '../core/state.js';
import { showScreen } from '../ui/screens.js';
import AudioSystem from '../systems/audio.js';
import { T, CHUNK, SPAWN, isWalk, newSeed, hash2,
    getTile, setTile, builtAt, purgeChunks } from './world.js';
import { TS } from './wconst.js';
import { fitCanvasBacking, toggleFullscreen } from '../core/canvasFit.js';
import { draw, BUILD_ITEMS, BUILD_HP } from './render.js';
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
import { showLookCreator, normalizeLook } from './wlook.js';
import * as WNPC from './wnpc.js';
import * as HUD from './whud.js';
import * as TUT from './wtut.js';
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
    WNPC: WNPC,
    normalizeLook: normalizeLook,
    PLAYER_INFECTION: PLAYER_INFECTION,
    saveData: saveData,
};

let sv = null;
let inited = false;

function log(msg, color) {
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
    const r = 11;
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
    const dt = Math.min((now - sv.last) / 1000, 0.05);
    sv.last = now;
    carBodyCache = null;   // 帧级车体占位缓存：每帧失效（地形可能被改动）
    // 搜索界面打开时游戏不暂停：世界（僵尸/昼夜/饱食）继续运行；
    // 背包打开也不暂停世界（边整理边警戒）；储物柜/暂停/拼字台仍暂停世界。搜索进度由下方单独推进。
    if (!Panel.isChestOpen() && !pauseOpen && !WW.isOpen() && !sv.dead) update(dt);
    else if (!sv.dead) {
        sv.now += dt;
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
        const dt = Math.min((now - sv.last) / 1000, 0.05);
        sv.last = now;
        if (!Panel.isChestOpen() && !pauseOpen && !sv.dead) update(dt);
        else sv.now += dt;
    }, 1000 / 20);
}

function stopBgKeepAlive() {
    if (bgTimer) { clearInterval(bgTimer); bgTimer = null; }
}

// ---------- 随机事件（D）：沙尘暴 / 停电夜 / 物资空投 ----------
// 每天 8:00 判定一次（天≥3，30% 触发）；事件进行中不触发下一个。
// sv._evt = { type, endT }（endT 按游戏时间 sv.now 秒）。运行时状态，不序列化（重进重新随机）。
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
        if (r < 0.34) startEvent(sv, 'sandstorm');
        else if (r < 0.67) startEvent(sv, 'blackout');
        else startEvent(sv, 'airdrop');
    }
    sv._lastEvtHour = hour;
}
function startEvent(sv, type) {
    if (type === 'sandstorm') {
        sv._evt = { type, endT: sv.now + 30 };
        sv.announce = { text: '🌪 沙尘暴来袭！移动速度降低', t: 2.5, color: '#E8C46A' };
        AudioSystem.playWaveWarning();
    } else if (type === 'blackout') {
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

function update(dt) {
    sv.now += dt;
    sv.playT += dt;
    updateEvents(sv, dt);   // 随机事件（D：沙尘暴/停电夜/物资空投）

    // ---------- 联机客人端分流（Phase 2 主机权威）----------
    // guest 不模拟世界（昼夜/僵尸 AI/NPC/刷怪/尸潮/掉落生成都由 host 权威，
    // 经 wsync 100ms 快照下发）；本地只保留：自己移动/生存/武器视觉/特效/事件播放。
    if (sv.mp && sv.mp.role === 'guest') { updateGuest(dt); return; }

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
        sv._infLogT = (sv._infLogT || 0) - dt;
    }

    // ---------- 饱食度：随时间消耗，奔跑额外消耗；饥饿减速，挨饿掉血 ----------
    if (sv.food != null) {
        const mi = WA.moveInput(sv);
        let drain = B.HUNGER_DRAIN * (sv._hungerMul || 1);   // 先天病（糖尿病）修正
        if (sv.sprinting && (mi.mx || mi.my)) drain += B.HUNGER_SPRINT_DRAIN;
        const prev = sv.food;
        sv.food = Math.max(0, sv.food - drain * dt);
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
        sv.water = Math.max(0, sv.water - drain * dt);
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
    if (sv.hp < sv.maxHp && (sv.food || 0) > 0 && (sv.water || 0) > 0) {
        let regen = B.HP_REGEN_NATURAL;
        const fed = (sv.food || 0) >= B.HP_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, ((sv.food || 0) - B.HP_REGEN_FED_AT) / (B.HUNGER_MAX - B.HP_REGEN_FED_AT));
            regen += B.HP_REGEN_FED * ramp;
            sv.food = Math.max(0, sv.food - B.HP_REGEN_FUEL * dt);   // 进食回血：加快消耗饱食度
        }
        sv.hp = Math.min(sv.maxHp, sv.hp + regen * dt);
    }

    // ---------- 搜索中（游戏不暂停）被僵尸咬伤：自动关闭搜索界面（室内外通用） ----------
    // 只由僵尸咬伤（sv._zombieHitF，resolvePlayerHit 设置）触发；饥饿掉血不打断搜索
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

    // ---------- 室内模式 ----------
    if (sv.interior) {
        updateInteriorMode(dt);
        sv.saveT -= dt;
        if (sv.saveT <= 0) { sv.saveT = B.SAVE_INTERVAL; saveNow(); }
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

    // 武器损坏弹窗：无其它面板时弹出修复 UI
    if (sv._brokenWpnPrompt && !Panel.anyOpen() && !wrepairOpen() && !tradeOpen() && !npcMenuOpen() && !carMenuOpen() && !campPanelOpen() && !charPanelOpen()) {
        showWeaponRepairPopup();
    }

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
        let { mx, my } = WA.moveInput(sv);
        if (mx || my) {
            sv.animMoving = true;   // 逐帧动画：移动中
            const len = Math.hypot(mx, my);
            mx /= len; my /= len;
            sv.faceX = mx; sv.faceY = my;
            const infEff = playerInfectionEffects(sv.infection || 0);
            const spd = B.PLAYER_SPEED * WA.moveMul(sv) * infEff.speedMul * (getTile(sv, Math.floor(sv.px / TS), Math.floor(sv.py / TS)) === T.ROAD ? B.ROAD_SPEED : 1) * (sv._evt && sv._evt.type === 'sandstorm' ? 0.7 : 1);   // 沙尘暴减速（D）
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
                    sv.stepT = run ? 0.24 : 0.36;
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % 3;   // 动画换帧与脚步同频
                    if (onGrass) AudioSystem.playWalkGrass();
                    else if (run) AudioSystem.playRunStep(sv.stepSide);
                    else AudioSystem.playWalkStep(sv.stepSide);
                }
            }
        } else {
            sv.animMoving = false;  // 静止回站立帧
        }
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

    for (let i = sv.drops.length - 1; i >= 0; i--) {
        const d = sv.drops[i];
        if (Math.hypot(d.x - sv.px, d.y - sv.py) < B.PICKUP_RADIUS) {
            if (d.id.startsWith('loot:')) {
                if (Panel.addItemLoot(sv, { id: d.id, n: 1, contents: d.contents || [] })) {
                    log(`拾取 ${Panel.getItemInfo(d.id).name}`);
                    playPickupSound(d.id);
                    sv.drops.splice(i, 1);
                }
            } else {
                const it = Panel.getItemInfo(d.id);
                const left = Panel.addItem(sv, d.id, d.n);
                if (left < d.n) { log(`拾取 ${it.name} ×${d.n - left}`); playPickupSound(d.id); }
                if (left <= 0) sv.drops.splice(i, 1);
                else d.n = left;
            }
        }
    }

    if (sv.now - (sv._purgeT || 0) > 5) { sv._purgeT = sv.now; purgeChunks(sv, TS); }

    sv.saveT -= dt;
    if (sv.saveT <= 0) { sv.saveT = B.SAVE_INTERVAL; saveNow(); }

    // 联机 host：权威判定僵尸咬远端队友（guest 不模拟世界）
    if (sv.mp && sv.mp.role === 'host' && sv.p2) hostGuestBiteCheck(dt);

    if (sv.hp <= 0 && !sv.dead) onDeath();
}

// ================= 联机客人端更新（Phase 2 主机权威分流） =================
// guest 只推进：自己生存/移动/武器/特效/本地事件；世界实体由 wsync 快照覆写。
function updateGuest(dt) {
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

    // 饱食度（随时间消耗，奔跑额外消耗）
    if (sv.food != null) {
        const mi = WA.moveInput(sv);
        let drain = B.HUNGER_DRAIN * (sv._hungerMul || 1);
        if (sv.sprinting && (mi.mx || mi.my)) drain += B.HUNGER_SPRINT_DRAIN;
        const prev = sv.food;
        sv.food = Math.max(0, sv.food - drain * dt);
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
        sv.water = Math.max(0, sv.water - drain * dt);
        if (sv.water <= 0) {
            if (!sv._dehydrated) { sv._dehydrated = true; sv._dehydrateLogT = 0; log('你严重缺水了！尽快喝水，否则持续掉血', '#66CCFF'); }
            if (!sv._devGod) sv.hp = Math.max(1, sv.hp - B.WATER_DEHYDRATE_DMG * dt);
            sv._dehydrateLogT -= dt;
            if (sv._dehydrateLogT <= 0) { sv._dehydrateLogT = 8; log('缺水…生命流失', '#66CCFF'); }
        } else sv._dehydrated = false;
    }

    // 生命恢复
    if (sv.hp < sv.maxHp && (sv.food || 0) > 0 && (sv.water || 0) > 0) {
        let regen = B.HP_REGEN_NATURAL;
        const fed = (sv.food || 0) >= B.HP_REGEN_FED_AT;
        if (fed) {
            const ramp = Math.min(1, ((sv.food || 0) - B.HP_REGEN_FED_AT) / (B.HUNGER_MAX - B.HP_REGEN_FED_AT));
            regen += B.HP_REGEN_FED * ramp;
            sv.food = Math.max(0, sv.food - B.HP_REGEN_FUEL * dt);
        }
        sv.hp = Math.min(sv.maxHp, sv.hp + regen * dt);
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
        if (sv.hp <= 0 && !sv.dead) onDeath();
        return;
    }

    // 驾驶模式（guest 端本地驾驶；车位置经 wpos 上报 host 渲染）
    if (sv.driving) {
        if (sv.driveOrder) WV.updateChauffeurDrive(sv, dt, carCanStand);   // NPC 驾驶（命令）
        else WV.updateDrive(sv, dt, sv.keys, carCanStand);                  // 玩家驾驶
        updatePrompt();
        if (sv.hp <= 0 && !sv.dead) onDeath();
        return;
    }

    // 玩家移动（乐观本地，即时手感；权威位置由 host 的 wsync 带回纠偏）
    const dashing = WA.updateActions(sv, dt, canStand);
    if (!dashing) {
        let { mx, my } = WA.moveInput(sv);
        if (mx || my) {
            sv.animMoving = true;
            const len = Math.hypot(mx, my);
            mx /= len; my /= len;
            sv.faceX = mx; sv.faceY = my;
            const infEff = playerInfectionEffects(sv.infection || 0);
            const spd = B.PLAYER_SPEED * WA.moveMul(sv) * infEff.speedMul * (getTile(sv, Math.floor(sv.px / TS), Math.floor(sv.py / TS)) === T.ROAD ? B.ROAD_SPEED : 1) * (sv._evt && sv._evt.type === 'sandstorm' ? 0.7 : 1);   // 沙尘暴减速（D）
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
                    sv.stepT = run ? 0.24 : 0.36;
                    sv.stepSide = !sv.stepSide;
                    sv.animFrame = ((sv.animFrame || 0) + 1) % 3;
                    if (onGrass) AudioSystem.playWalkGrass();
                    else if (run) AudioSystem.playRunStep(sv.stepSide);
                    else AudioSystem.playWalkStep(sv.stepSide);
                }
            }
        } else sv.animMoving = false;
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

    // 武器损坏弹窗：无其它面板时弹出修复 UI
    if (sv._brokenWpnPrompt && !Panel.anyOpen() && !wrepairOpen() && !tradeOpen() && !npcMenuOpen() && !carMenuOpen() && !campPanelOpen() && !charPanelOpen()) {
        showWeaponRepairPopup();
    }

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
                if (Panel.addItemLoot(sv, { id: d.id, n: 1, contents: d.contents || [] })) {
                    log(`拾取 ${Panel.getItemInfo(d.id).name}`);
                    playPickupSound(d.id);
                    if (sv.mp && sv.mp.role === 'guest') {
                        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'pickup', x: d.x, y: d.y, id: d.id });
                        // 竞态防护：wsync 覆写时按指纹过滤已上报的掉落，防 100ms 窗口重复拾取刷物品
                        (sv._mpPickedDrops = sv._mpPickedDrops || new Set()).add(d.id + '@' + Math.round(d.x) + ',' + Math.round(d.y));
                    }
                    sv.drops.splice(i, 1);
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
    };
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
        let { mx, my } = WA.moveInput(sv);
        if (mx || my) {
            const len = Math.hypot(mx, my) || 1;
            mx /= len; my /= len;
            const spd = B.PLAYER_SPEED * WA.moveMul(sv);
            const nx = sv.px + mx * spd * dt;
            const ny = sv.py + my * spd * dt;
            if (interiorCanStand(nx, sv.py)) sv.px = nx;
            if (interiorCanStand(sv.px, ny)) sv.py = ny;
            if (!sv.isJumping) {
                const run = sv.sprinting && (mx || my);
                sv.stepT = (sv.stepT || 0) - dt;
                if (sv.stepT <= 0) {
                    sv.stepT = run ? 0.24 : 0.36;
                    sv.stepSide = !sv.stepSide;
                    if (run) AudioSystem.playRunStep(sv.stepSide);
                    else AudioSystem.playWalkStep(sv.stepSide);
                }
            }
        }
    }
    it.px = sv.px;
    it.py = sv.py;

    const ox = (960 - it.w * TS) / 2, oy = (540 - it.h * TS) / 2;
    sv.camX = -ox;
    sv.camY = -oy;

    WD.updateInterior(sv, dt);
    if (!sv.interior) return;

    const worldZombies = sv.zombies;
    sv.zombies = it.zombies;
    WG.syncMag(sv);
    WG.updateWeapon(sv, dt);
    WG.updateBullets(sv, dt);
    sv.zombies = worldZombies;

    it.px = sv.px;
    it.py = sv.py;
    sv.wpnText = WG.hudText(sv);
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
    let nbest = null, nbestD = 1.9 * TS;
    if (sv.npcs) {
        for (const n of sv.npcs) {
            if (!n.alive || n.role === 'hostile') continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;   // 主控角色不显示交互
            const d = Math.hypot(n.x - sv.px, n.y - sv.py);
            if (d < nbestD) { nbestD = d; nbest = n; }
        }
    }
    const camp = sv.camp;
    const campDist = camp ? Math.hypot(sv.px - camp.x, sv.py - camp.y) : 1e9;
    if (nbest && nbestD < (best ? bestD * TS : 1e9)) {
        sv.promptTarget = { npc: nbest.id };
        sv.prompt = nbest.party ? `命令 ${nbest.name} [F]` : `交谈 ${nbest.name} [F]`;
        return;
    }
    sv.promptTarget = best;
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
        if (npc && npc.party) openNpcCommandMenu(npc);
        else openNpcMenu(tg.npc);
    } else if (tg.camp) {
        openCampPanel();
    } else if (tg.flag) {
        // 旗帜处 F：收起领地旗帜（回收物品）
        sv.camp = null;
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
            if (sv.isJumping || sv.invuln > 0) { sv.bullets.splice(i, 1); continue; }
            if (!sv._devGod) sv.hp -= b.damage;
            sv.hurtT = 0.3;
            sv.effects.push({ kind: 'hit', x: sv.px, y: sv.py, life: 0.15, maxLife: 0.15, label: '刺' });
            AudioSystem.playPlayerHurt();
            sv.bullets.splice(i, 1);
        }
    }
}

// ================= 死亡 =================
function onDeath() {
    // 主控是 NPC 且队伍有其它存活成员 → 自动切换视角继续（不算死亡）
    if (WNPC.onControlledDeath(sv)) {
        sv.hp = Math.max(1, sv.hp);
        sv.hurtT = 0;
        if (WSearch.isOpen()) WSearch.closeSearch(sv, true);
        return;
    }
    const dk = B.DIFF_TABLE[sv.diffKey] || B.DIFF_TABLE.normal;
    if (dk.soft) {
        if (WSearch.isOpen()) WSearch.closeSearch(sv, true);   // 搜索中被杀：关闭界面
        sv.interior = null;   // 室内死亡：离开房间，回到室外重生点
        let lost = 0;
        for (let i = 0; i < sv.inv.length; i++) {
            if (sv.inv[i] && Math.random() < B.SOFT_DEATH_LOSS) { sv.inv[i] = null; lost++; }
        }
        sv.hp = sv.maxHp;
        sv.hurtT = 0;
        sv.zombies = [];
        sv.horde = null;
        WA.resetActions(sv);
        sv.stamina = sv.maxStamina;
        sv.exhausted = false;
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
        sv.px = rx; sv.py = ry;
        if (lost > 0) log(`你醒了过来…… ${lost} 格随身物品遗失了`);
        else log(sv.homeBed ? '你在床边醒来……' : '你在荒原某处醒来……');
        AudioSystem.playDefeat();
        saveNow();
    } else {
        sv.dead = true;
        setStorage(SAVE_KEY, null);
        // 联机：广播死亡 → 对方结算退出（R7：任一玩家死亡 → 双端结束）
        if (sv.mp && !sv._mpDeadSent) {
            sv._mpDeadSent = true;
            (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'dead', who: sv.mp.role });
        }
        AudioSystem.playDefeat();
        Panel.showDeath(
            '<div class="wsl-death-title">你 倒 下 了</div>' +
            `<div class="wsl-death-sub">荒原吞噬了这位幸存者……（${dk.name}难度：荒原存档已清空）</div>`,
            () => { Panel.hideDeath(); exitWasteland(true); });
    }
}

// ================= 快捷栏 =================
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
    // 领地旗帜：使用后在脚下放置旗帜建立领地（可移动：旗帜处 F 收起）
    if (s.id === 'flag') {
        if (sv.camp) { log('已有领地旗帜（旗帜处 F 可收起）', '#FFB347'); return; }
        sv.camp = { x: sv.px, y: sv.py, id: 'camp_' + sv.day + '_' + Math.floor(sv.px / TS) + '_' + Math.floor(sv.py / TS) };
        // 联机：营地设置广播（对方看到同一营地）
        if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'camp', x: sv.px, y: sv.py });
        s.n--;
        if (s.n <= 0) sv.inv[i] = null;
        log('领地旗帜已插下！营地成为 NPC 居住地（会吸引新居民），领地内回血/体力加速/移速提升，敌对生物减少生成', '#FFD700');
        AudioSystem.playCollect();
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
    wrepairEl.innerHTML = '<div style="background:#1a1014;border:2px solid #FF5544;border-radius:10px;padding:20px 28px;width:380px;text-align:center;">' +
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
            if (remaining && remaining.length) Panel.addItemLoot(sv, { id: 'looted:' + quality, n: 1, contents: remaining.slice() });
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
    opts += `<button class="menu-btn wsl-car-opt" data-act="close" style="min-width:220px;">关闭 (ESC)</button>`;
    const stateTxt = m.repaired ? (cond === 'intact' ? '· 完好可驾驶' : '· 已修复') : (isWreck ? '· 已报废' : '· 待修理');
    const fuelTxt = isWreck ? '' : ` · 油量 ${Math.round(m.fuel != null ? m.fuel : 0)}/${B.FUEL_MAX} · 耐久 ${Math.ceil(m.hp != null ? m.hp : 0)}/${WV.CAR_MAX_HP}`;
    carMenuEl.innerHTML =
        '<div class="wsl-scaler" style="gap:12px;">' +
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
function carMenuOpen() { return !!(sv && sv.carMenu); }

// 队员背包：镜像到储物界面查看/存取，关闭时写回 NPC
function openNpcBag(npc) {
    if (!sv.mods.chests) sv.mods.chests = {};
    const key = 'npcbag:' + npc.id;
    const slots = Array(Panel.CHEST_SIZE).fill(null);
    for (let i = 0; i < npc.inv.length && i < slots.length; i++) if (npc.inv[i]) slots[i] = { ...npc.inv[i] };
    sv.mods.chests[key] = slots;
    sv._npcBagWriteback = { id: npc.id, key };
    Panel.showChest(sv, key, `${npc.name} 的背包（存取物品）`);
}

// ================= NPC 交互菜单（交谈/交易/入队/雇佣/命令/切换控制） =================
let npcMenuEl = null;
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
    const npc = sv.npcs.find(m => m.id === sv.npcMenu.id);
    if (!npc || !npc.alive) { closeNpcMenu(); return; }
    const opts = [];
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
    opts.push({ act: 'close', label: '关闭 (ESC)' });
    const roleTxt = npc.role === 'hostile' ? '恶意' : (npc.role === 'friendly' ? '友善' : '中立');
    // 阵营归属：营地居民（campId 匹配当前营地）/ 他乡营地 / 流浪者 / 敌对势力
    let campTxt = '';
    if (npc.role === 'hostile') campTxt = '敌对势力';
    else if (npc.campId && sv.camp && npc.campId === sv.camp.id) campTxt = '本营地居民';
    else if (npc.campId) campTxt = '他乡营地';
    else campTxt = '流浪者';
    const age = npc.age ?? (sv.day - npc.bornDay);
    const sickTxt = npc.sick && B.SICKNESS[npc.sick.type] ? ` · 染病：${B.SICKNESS[npc.sick.type].name}` : '';
    npcMenuEl.innerHTML = '<div class="wsl-scaler" style="gap:12px;">' +
        `<div style="font-size:20px;color:#FFD700;letter-spacing:2px;margin-bottom:4px;">${npc.name} · ${roleTxt}${campTxt ? ` · ${campTxt}` : ''}${npc.party ? ' · 队伍' : ''}${npc.hired ? ` · 雇佣(${npc.hireFee ? npc.hireFee.label : ''})` : ''}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-bottom:10px;">HP ${Math.ceil(npc.hp)}/${npc.maxHp} · 饱食 ${Math.round(npc.food)} · 水分 ${Math.round(npc.water)} · ${B.ageStage(age).name}（${age}天） · 武器 ${npc.wpnName || '拳头'}${sickTxt}</div>` +
        opts.map(o => `<button class="menu-btn wsl-npc-opt" data-act="${o.act}" style="min-width:240px;">${o.label}</button>`).join('') +
        '</div>';
    npcMenuEl.querySelectorAll('.wsl-npc-opt').forEach(el => el.addEventListener('click', () => npcMenuAct(el.dataset.act)));
}
function npcMenuAct(act) {
    const id = sv.npcMenu && sv.npcMenu.id;
    const npc = sv.npcs.find(m => m.id === id);
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
        npc.party = true; npc.state = 'follow'; npc.campTask = null; closeNpcMenu(); log(`${npc.name} 加入了队伍！`, '#7DFF7D'); return;
    }
    if (act === 'hire') {
        const partyCount = (sv.npcs || []).filter(m => m.alive && m.party).length;
        if (partyCount >= 4) { log('队伍已满（最多 4 人）', '#FFB347'); return; }
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
function npcMenuOpen() { return !!(sv && sv.npcMenu); }

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
        { c: 'follow', label: '跟随我（并肩行动）' },
        { c: 'camp', label: '返回营地干活', disabled: !sv.camp },
        { c: 'drive', label: '驾驶汽车出行…（选择目的地）' },
        { c: 'dismiss', label: '解散离队' },
        { c: 'close', label: '取消 (ESC)' },
    ];
    npcCmdEl.innerHTML = '<div class="wsl-scaler" style="gap:12px;">' +
        `<div style="font-size:20px;color:#FFD700;letter-spacing:2px;margin-bottom:4px;">${npc.name} · 命令</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-bottom:10px;">${npc.party ? '队伍成员' : '非队员'}${sv.camp ? '' : ' · 暂无营地，返回营地需先插旗'}</div>` +
        opts.map(o => `<button class="menu-btn wsl-npc-cmd${o.disabled ? ' dis' : ''}" data-c="${o.c}" style="min-width:240px;">${o.label}</button>`).join('') +
        '</div>';
    npcCmdEl.querySelectorAll('.wsl-npc-cmd').forEach(el => el.addEventListener('click', () => {
        const c = el.dataset.c;
        const npc2 = sv.npcs.find(m => m.id === sv.npcCmd.id);
        closeNpcCommandMenu();
        if (!npc2 || c === 'close') return;
        if (c === 'drive') { openDriveDestMenu(npc2); return; }
        if (c === 'camp' && !sv.camp) { log('还没有营地！放置"领地旗帜"建立领地后才能返回', '#FFB347'); return; }
        WNPC.commandNpc(sv, npc2, c);
    }));
}
function closeNpcCommandMenu() {
    sv.npcCmd = null;
    if (npcCmdEl) npcCmdEl.style.display = 'none';
}
function npcCmdOpen() { return !!(sv && sv.npcCmd); }

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
    driveDestEl.innerHTML = '<div class="wsl-scaler" style="gap:12px;">' +
        `<div style="font-size:20px;color:#FFD700;letter-spacing:2px;margin-bottom:4px;">${npc.name} · 驾驶目的地</div>` +
        '<div style="font-size:12px;color:#8a9aa2;margin-bottom:10px;">需附近 24 格内有归属汽车（修复/驾驶过才有"所属"标记）；出发后全员自动乘车，F 取消</div>' +
        opts.map(o => `<button class="menu-btn wsl-drive-opt" data-d="${o.d}" style="min-width:240px;">${o.label}</button>`).join('') +
        '<button class="menu-btn wsl-drive-opt" data-d="close" style="min-width:240px;">取消 (ESC)</button>' +
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
function driveDestOpen() { return !!(sv && sv.driveDest); }
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
    campPanelEl.innerHTML = '<div class="wsl-scaler" style="gap:10px;max-width:480px;">' +
        '<div style="font-size:20px;color:#FFD700;letter-spacing:4px;margin-bottom:6px;text-align:center;">◇ 营 地 ◇</div>' +
        `<div style="font-size:13px;color:#8a9aa2;margin-bottom:6px;">营地同伴 ${(sv.npcs || []).filter(n => n.alive && n.state === 'camp').length} 人</div>` +
        '<div style="font-size:13px;color:#ccd;margin-bottom:8px;">工作日志：</div>' +
        (logs.length ? logs.map(l => `<div style="font-size:12px;color:#ffe9a8;text-align:left;">第${l.day}天 · ${l.text}</div>`).join('')
            : '<div style="font-size:12px;color:#778;">营地暂无人干活</div>') +
        '<button class="menu-btn wsl-camp-opt" data-act="chest" style="min-width:240px;margin-top:8px;">打开营地物资箱</button>' +
        '<button class="menu-btn wsl-camp-opt" data-act="close" style="min-width:240px;">关闭 (ESC)</button>' +
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
    charPanelEl.innerHTML = '<div style="background:#141a22;border:2px solid #39d98a;border-radius:10px;padding:20px 26px;width:460px;">' +
        `<div style="font-size:20px;color:#39d98a;letter-spacing:3px;margin-bottom:4px;text-align:center;">◇ 角色属性 ◇</div>` +
        `<div style="font-size:13px;color:#8a9aa2;text-align:center;margin-bottom:12px;">${p.name} · ${B.ageStage(age).name}（${age}天） · 武器 ${p.wpnName || '拳头'}</div>` +
        `<div style="border-top:1px solid #2a3540;padding-top:10px;">${B.ATTRIB_KEYS.map(attrRow).join('')}</div>` +
        `<div style="font-size:13px;color:#ffe9a8;margin-top:10px;">${talent ? `天赋：${talent.name}（${talent.desc}）` : '天赋：无'}</div>` +
        `<div style="font-size:13px;color:#ffb08a;margin-top:4px;">${cg ? `先天疾病：${cg.name}（${cg.desc}）` : '先天：健康'}</div>` +
        `<div style="font-size:13px;color:#ff8866;margin-top:4px;">${sickTxt}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-top:8px;border-top:1px solid #2a3540;padding-top:6px;">后天成长：近战 ${act.melee || 0}/60 · 受击 ${act.hit || 0}/40 · 奔跑 ${Math.round(act.run || 0)}/300</div>` +
        '<button data-act="close" style="width:100%;margin-top:14px;padding:8px;background:#232c34;border:1px solid #4a5a66;color:#ccd;border-radius:6px;cursor:pointer;">关闭 (ESC)</button>' +
        '</div>';
    charPanelEl.querySelector('[data-act="close"]').addEventListener('click', closeCharPanel);
}
function closeCharPanel() {
    sv.charPanel = null;
    if (charPanelEl) charPanelEl.style.display = 'none';
    AudioSystem.playClick();
}
function charPanelOpen() { return !!(sv && sv.charPanel && charPanelEl && charPanelEl.style.display !== 'none'); }

// ================= 交易（按物品价值定价，金币结算） =================
let tradeEl = null;
function countCoins(sv) {
    let n = 0;
    for (const s of sv.inv) if (s && s.id === B.COIN_ID) n += s.n;
    return n;
}
function takeCoins(sv, need) {
    for (const s of sv.inv) {
        if (need <= 0) break;
        if (s && s.id === B.COIN_ID) { const t = Math.min(s.n, need); s.n -= t; need -= t; }
    }
    for (let i = 0; i < sv.inv.length; i++) if (sv.inv[i] && sv.inv[i].id === B.COIN_ID && sv.inv[i].n <= 0) sv.inv[i] = null;
    return need <= 0;
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
    const npc = sv.npcs.find(n => n.id === sv.npcTrade.id);
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
            return `<button class="wsl-trade-btn" data-act="buy" data-i="${npc.inv.indexOf(s)}" style="display:flex;justify-content:space-between;width:100%;margin:2px 0;padding:4px 8px;background:#1c242c;border:1px solid #3a4a56;color:#ffe9a8;border-radius:4px;cursor:pointer;">
                <span>${info.name} ×${s.n}</span><span style="color:#FFD700;">${devInf ? '免费' : price + ' 金币'}</span></button>`;
        }).join('')
        : '<div style="color:#778;font-size:12px;padding:6px;">NPC 暂无商品</div>';
    const sellHtml = sells.length
        ? sells.map(s => {
            const price = Math.max(1, Math.floor(B.itemValue(s.id) * B.TRADE_DISCOUNT / intMul));
            const info = Panel.getItemInfo(s.id);
            return `<button class="wsl-trade-btn" data-act="sell" data-i="${sv.inv.indexOf(s)}" style="display:flex;justify-content:space-between;width:100%;margin:2px 0;padding:4px 8px;background:#1c242c;border:1px solid #3a4a56;color:#bfe4ff;border-radius:4px;cursor:pointer;">
                <span>${info.name} ×${s.n}</span><span style="color:#FFD700;">${price} 金币</span></button>`;
        }).join('')
        : '<div style="color:#778;font-size:12px;padding:6px;">背包没有可卖物品</div>';
    tradeEl.innerHTML = '<div style="background:#141a22;border:2px solid #FFD700;border-radius:10px;padding:18px 22px;width:520px;max-height:80vh;overflow:auto;">' +
        `<div style="font-size:19px;color:#FFD700;letter-spacing:3px;margin-bottom:4px;text-align:center;">◇ 与 ${npc.name} 交易 ◇</div>` +
        `<div style="font-size:12px;color:#8a9aa2;text-align:center;margin-bottom:10px;">你的金币 <span style="color:#FFD700;">${countCoins(sv)}</span> · ${npc.name} 金币 <span style="color:#FFD700;">${npc.coins || 0}</span>（买入 ${Math.round(B.TRADE_MARKUP * 100)}% 价 · 卖出 ${Math.round(B.TRADE_DISCOUNT * 100)}% 价）</div>` +
        '<div style="font-size:13px;color:#ffe9a8;margin:6px 0 2px;">— 购买（NPC 的商品）—</div>' + buyHtml +
        '<div style="font-size:13px;color:#bfe4ff;margin:10px 0 2px;">— 出售（卖给 NPC）—</div>' + sellHtml +
        '<button class="wsl-trade-btn" data-act="close" style="width:100%;margin-top:12px;padding:8px;background:#232c34;border:1px solid #4a5a66;color:#ccd;border-radius:6px;cursor:pointer;">关闭 (ESC)</button>' +
        '</div>';
    tradeEl.querySelectorAll('.wsl-trade-btn').forEach(el => el.addEventListener('click', () => tradeAct(el.dataset.act, parseInt(el.dataset.i))));
}
function tradeAct(act, i) {
    const npc = sv.npcs.find(n => n.id === sv.npcTrade.id);
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
        Panel.addItem(sv, B.COIN_ID, price);
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
function openLootFromBag(i) {
    const item = sv.inv[i];
    if (!item) return;
    const isLooted = item.id.startsWith('looted:');
    const quality = isLooted ? item.id.slice(7) : item.id.slice(5);

    let contents;
    if (isLooted) {
        // 已搜袋：取其剩余内容，移除该袋（关闭时若有剩余再存回）
        contents = (item.contents || []).map(it => ({ id: it.id, n: it.n }));
        sv.inv[i] = null;
    } else {
        // 未开袋：只开一个（从 bags 取一袋，n--）
        if (item.bags && item.bags.length) {
            contents = (item.bags.shift() || []).map(it => ({ id: it.id, n: it.n }));
        } else {
            contents = (item.contents || []).map(it => ({ id: it.id, n: it.n }));
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
        immediate: true,   // 已开过的袋：直接显示，不重新搜索
        cap: contents.length,
        onClose: (remaining) => {
            if (remaining && remaining.length) Panel.addItemLoot(sv, { id: 'looted:' + quality, n: 1, contents: remaining.slice() });
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
        if (['w', 'a', 's', 'd', ' ', 'f', 'b', 'j', 'escape', 'p', 'r', 'v', 'g', 'q', 'e', 'x', 'f9', 'f11',
            'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
        sv.keys[k] = true;
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
        if (WSearch.isOpen()) {
            // 搜索界面打开时角色可自由移动/跳跃/闪现（逃生走位），世界不暂停；
            // WASD/方向键已记录进 sv.keys 由 update 读取，空格/Q 在此直接执行
            if (k === 'escape' || k === 'f' || k === 'b') WSearch.closeSearch(sv, true);
            else if (k === ' ') WA.tryJump(sv);
            else if (k === 'q') WA.startDash(sv);
            return;
        }
        if (WW.isOpen()) {
            if (k === 'escape' || k === 'k') WW.close();
            return;
        }
        if (k === 'k') { WW.open(sv, { onMessage: log }); return; }
        if (k === 'b') { Panel.toggleBag(sv); return; }
        if (k === 'escape') {
            // ESC 只关闭已打开的面板（避免与浏览器退出全屏冲突）；暂停菜单用 P
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
        if (k === 'g') { WB.toggleBuild(sv); return; }
        if (k === 'c') { openCharPanel(sv.controllerId); return; }   // 角色属性面板
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
        if (!sv || !sv.active || sv.dead || Panel.anyOpen()) return;
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
        showLookCreator((look) => onDone(name, look));
    };
    el.querySelector('#wsl-char-ok').addEventListener('click', ok);
    el.querySelector('#wsl-char-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    setTimeout(() => el.querySelector('#wsl-char-name').focus(), 50);
}

function startRun(opts) {
    // 普通玩家设置（workshop 荒原面板，无需开发者模式）：帧率显示 + 画质档
    if (opts.gfx != null) sv._devGfx = opts.gfx;
    sv._showFps = !!opts.showFps;
    sv.diffKey = B.DIFF_TABLE[opts.difficulty] ? opts.difficulty : 'normal';
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
        if (WDEV.isDev() && sv._devGod) log('开发者：无敌模式已开启', '#FF6666');
        if (saved._devKillAll) {
            sv.zombies = [];
            const s2 = getStorage(SAVE_KEY, null);
            if (s2) { delete s2._devKillAll; setStorage(SAVE_KEY, s2); }
            log('开发者：僵尸已清屏', '#FF6666');
        }
    }
    WDEV.init(sv);
    TUT.showIfFirst(sv);   // 首次进入：生存指南提示卡（本地标记，不打断老玩家）

    if (sv._legacyNote) log('检测到旧版荒原存档（已备份），已为你开启全新无限荒原！');
    else if (sv.playT > 0 || sv.day > 1) log(`欢迎回到荒原 · 第 ${sv.day} 天`);
    else { log('你醒来时，发现自己躺在一片荒原上……'); AudioSystem.playGameStart(); }

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

// guest 攻击上报：host 权威判定命中（近战 reach 44px / 远程 260px），击杀返回信息供广播
export function hostApplyGuestAttack(evt, gx, gy) {
    if (!sv || !evt) return null;
    const reach = evt.melee ? 44 : 260;
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
            if (bn.hp <= 0) WNPC.killNpc(sv, bn, '被队友击杀');
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
    for (const p of guests) {
        if (!p || p.tx == null) continue;
        if (p.inInterior) continue;
        if (p._hostHp == null) p._hostHp = 100;
        if (p._biteCd == null) p._biteCd = 0;
        p._biteCd -= dt;
        p._biteScanT = (p._biteScanT || 0) - dt;
        if (p._biteScanT > 0) continue;
        p._biteScanT = 0.1;
        const biteD = B.Z_CONTACT_DIST || 30;
        const r2 = 8 * TS;   // 粗筛半径（格 → px）：只查 guest 附近僵尸
        for (const z of sv.zombies) {
            if (!z || z.hp <= 0) continue;
            const dzx = z.x - p.tx, dzy = z.y - p.ty;
            if (dzx > r2 || dzx < -r2 || dzy > r2 || dzy < -r2) continue;
            if (Math.hypot(dzx, dzy) < biteD) {
                if (p._biteCd <= 0) {
                    p._biteCd = 0.6;
                    // 开发者共用：队友无敌时不被咬伤（host 权威判定，双端血一致；仍吃咬击冷却）
                    if (p._devGod) break;
                    p._hostHp = Math.max(0, p._hostHp - z.damage);
                    p.hurt = 0.3;
                }
                break;
            }
        }
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
                '<div class="wsl-scaler">' +
                '<div style="font-size:22px;color:#FFD700;margin-bottom:10px;letter-spacing:4px;">暂  停</div>' +
                '<div style="color:#7fb39a;font-size:13px;margin-bottom:12px;letter-spacing:1px;">世界种子 <span id="wsl-seed-val" style="color:#39d98a;font-weight:bold;">' + (sv && sv.world ? sv.world.seed : '?') + '</span> · 角色 ' + (sv ? (sv.characterName || '幸存者') : '?') + '</div>' +
                '<div class="wsl-vol">' +
                '<label>背景音乐<input type="range" id="wsl-vol-bgm" min="0" max="100" step="5"><span id="wsl-vol-bgm-v">0%</span></label>' +
                '<label>游戏音效<input type="range" id="wsl-vol-sfx" min="0" max="100" step="5"><span id="wsl-vol-sfx-v">0%</span></label>' +
                '</div>' +
                '<button class="menu-btn" id="wsl-p-resume" style="min-width:200px;">继续游戏 (P)</button>' +
                '<button class="menu-btn" id="wsl-p-full" style="min-width:200px;">切换全屏 (F11)</button>' +
                (sv && sv.camp ? '<button class="menu-btn" id="wsl-p-tpcamp" style="min-width:200px;border-color:#39d98a;color:#7ee08a;">传送回营地 ◈</button>' : '') +
                '<button class="menu-btn" id="wsl-p-exit" style="min-width:200px;border-color:#FF5555;color:#FF8888;">退出荒原（进度已保存）</button>' +
                '</div>';
            document.getElementById('game-container').appendChild(pauseEl);
            pauseEl.querySelector('#wsl-p-resume').addEventListener('click', () => togglePause());
            pauseEl.querySelector('#wsl-p-full').addEventListener('click', () => toggleFullscreen());
            const tpBtn = pauseEl.querySelector('#wsl-p-tpcamp');
            if (tpBtn) tpBtn.addEventListener('click', () => { togglePause(); tpToCamp(); });
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
