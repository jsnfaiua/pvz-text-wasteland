// ============================================================
// 【无尽植僵荒原】菜单面板系统（汽车/NPC交互/队员命令/驾驶目的地/营地/角色属性/队伍管理/交易）
// 从 survival.js 拆出（v4.26）：全部"局内弹窗面板"聚合在此文件。
// 依赖注入（避免循环依赖）：
//   setSv —— 模块级 sv 引用（生存层 enterWasteland 时注入）
//   setLogger —— log 提示（含 mp 广播）
//   setHooks —— { useItem, rollWordAddon }（生存层内部函数）
// 直接 import：B / Panel / WV / WNPC / WG / WW / WSearch / AudioSystem / WEAPONS / winfection。
// ============================================================

import * as B from './wbalance.js';
import * as Panel from './panel.js';
import * as WV from './wvehicle.js';
import * as WNPC from './wnpc.js';
import * as WG from './wgear.js';
import * as WW from './world.js';
import { rollGlobalLoot, globalLootQty } from './wwordcraft-rules.js';
import * as WSearch from './wsearch.js';
import * as WD from './windoor.js';
import AudioSystem from '../systems/audio.js';
import { WEAPONS } from '../core/constants.js';
import { TS } from './wconst.js';
import { playerInfectionEffects, addPlayerInfection } from './winfection.js';

// ================= 生存层依赖注入 =================
let sv = null;
export function setSv(s) { sv = s; }
let _logger = () => {};
export function setLogger(fn) { _logger = (typeof fn === 'function') ? fn : () => {}; }
function log(msg, color) { _logger(msg, color); }
let _hooks = {
    useItem: () => {}, rollWordAddon: () => [], canStand: () => true,
    isFoodId: () => false, CAR_LOOT_POOL: [], summonTeammates: null,
};
export function setHooks(h) { _hooks = { ..._hooks, ...h }; }

// ================= 汽车菜单（F 交互：修理/拆解/后备箱/加油/驾驶） =================
let carMenuEl = null;
export function openCarMenu(key) {
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
export function carMenuAct(act) {
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
    // v3.19 物资全局权重 + 汽车分池（与容器统一）
    const rolls = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < rolls; i++) {
        const id = rollGlobalLoot(_hooks.CAR_LOOT_POOL, Math.random);
        if (!id) continue;
        generated.push({ id, n: globalLootQty(id, Math.random) });
    }
    generated.push(..._hooks.rollWordAddon('car', gx, gy));
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
    }, { onUseItem: (i) => _hooks.useItem(i) });
}
export function closeCarMenu() {
    sv.carMenu = null;
    if (carMenuEl) carMenuEl.style.display = 'none';
    AudioSystem.playClick();
}
export function carMenuOpen() { return !!(sv && sv.carMenu && carMenuEl && carMenuEl.style.display !== 'none'); }   // 2026-08-09 加 display 检查防残留拦截

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
export function openNpcMenu(id) {
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
        // v4.37 用户定稿："待尸变尸体不占队伍名额"——邀请名额只看活人，
        // 待尸变（!alive && party && !_revived）走"补刀致不尸变"流程，不占名额。
        const partyCount = (sv.npcs || []).filter(m => m.alive && m.party).length;
        const pendingReviveCount = (sv.npcs || []).filter(m => !m.alive && m.party && m._revived !== true).length;
        const limitTxt = partyCount >= 4
            ? `队伍已满（活人 ${partyCount}/4${pendingReviveCount ? `，待尸变 ${pendingReviveCount} 人不占名额` : ''}）`
            : (pendingReviveCount ? `（活人 ${partyCount}/4，待尸变 ${pendingReviveCount} 人不占名额）` : '（并肩战斗）');
        opts.push({ act: 'trade', label: '交易（金币按物品价值买卖）' });
        opts.push({ act: 'invite', label: partyCount >= 4 ? `邀请加入队伍${limitTxt}` : `邀请加入队伍${limitTxt}` });
        opts.push({ act: 'hire', label: partyCount >= 4 ? `雇佣${limitTxt}` : `雇佣（每日支付物品）${pendingReviveCount ? `（活人 ${partyCount}/4，待尸变 ${pendingReviveCount} 人不占名额）` : ''}` });
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
export function closeNpcMenu() {
    sv.npcMenu = null;
    if (npcMenuEl) npcMenuEl.style.display = 'none';
    AudioSystem.playClick();
}
// 2026-08-09 修复"NPC 背包 UI 关不掉"：npcMenuOpen 只查状态变量 sv.npcMenu，
// 一旦残留（如切视角/成员操控时 NPC 菜单状态未清），keydown 就被其【无条件 return】拦截，
// 导致储物面板的 B/F/ESC 关闭全部失效。改为同时检查 display，残留但隐藏时不再拦截。
export function npcMenuOpen() { return !!(sv && sv.npcMenu && npcMenuEl && npcMenuEl.style.display !== 'none'); }

// ================= 队员命令面板（跟随 / 营地 / 驾车 / 解散 独立 UI） =================
let npcCmdEl = null;
export function openNpcCommandMenu(npc) {
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
export function closeNpcCommandMenu() {
    sv.npcCmd = null;
    if (npcCmdEl) npcCmdEl.style.display = 'none';
}
// ================= 集合信号/召唤：打断成员所有工作（2026-08-17 v4.19 用户定稿） =================
// "集合信号是最高的命令，我作为主控角色，能快速把队伍成员召集到身边，不管我主控的是什么角色，
// 这个命令最高，会让成员停下手中的所有工作。"
// 打断项：搜刮箱子(scavTarget)、采草药(_herbTarget)、营地任务(campTask)、警戒游荡点(_wpX/_wpY)、
// 战斗威胁缓存(_threat/_threatT)、寻路缓存(_path)。全部转回跟随，下一帧 followAI 立即沿寻路靠拢主控。
// 注意：不打断"开车"(riding)——驾驶中的成员不响应集合（安全考虑，停车逻辑由驾驶系统负责）。
export function interruptMateWork(m) {
    m.state = 'follow';
    m.campTask = null;
    m._path = null;          // 清寻路缓存，重新跟随
    m.scavTarget = null;     // 打断搜刮箱子
    m._herbTarget = null;    // 打断采草药
    m._wpX = null; m._wpY = null;   // 清警戒游荡点（立即转向主控）
    m._threatT = 0; m._threat = null;   // 清战斗威胁缓存（不再追敌，立即转向主控）
    // v4.41 集合优先标记：此前只清缓存，下一帧 followAI 的 combatThreat 又搜索到威胁继续战斗/逃跑，
    // 导致"按 T 集合信号队员回不来"。_gathering=true 后 followAI 先直奔主控，到达后自动清除。
    m._gathering = true;
}

// ================= 召唤队友（2026-08-10） =================
// 把卡在建筑里 / 离玩家较远的成员召唤到身边；冷却 240 秒。
// 室内外统一：玩家在哪，成员就被召到哪（室内成员带进室内 / 室外成员带出室外）。
const SUMMON_CD = 240;   // 召唤冷却（秒）
export function summonTeammates() {
    if (!sv.npcs) return;
    // 冷却检查
    const left = (sv._summonCd || 0) - (sv.now || 0);
    if (left > 0) {
        log(`召唤冷却中：还需 ${Math.ceil(left)} 秒`, '#FFB347');
        return;
    }
    // 2026-08-12 v2.104 用户定稿："谁是主控谁就可以召集"——只排除当前主控，其余队伍成员
    //（含 isPlayer 原主控）都可被召唤。原 `!n.isPlayer` 会把原主控排除。
    const mates = sv.npcs.filter(n => n.alive && n.party && n.id !== sv.controllerId && !n.riding);
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
                } else if (_hooks.canStand(x, y)) {
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
        interruptMateWork(m);   // v4.19 最高命令：打断搜刮/采药/营地/游荡/追敌，转为跟随
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
export function npcCmdOpen() { return !!(sv && sv.npcCmd && npcCmdEl && npcCmdEl.style.display !== 'none'); }   // 2026-08-09 加 display 检查防残留拦截

// ================= 驾驶目的地选择（命令队员开车：营地/城市/郊区/废墟/自由探索） =================
let driveDestEl = null;
export function openDriveDestMenu(npc) {
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
export function closeDriveDestMenu() {
    sv.driveDest = null;
    if (driveDestEl) driveDestEl.style.display = 'none';
}
export function driveDestOpen() { return !!(sv && sv.driveDest && driveDestEl && driveDestEl.style.display !== 'none'); }   // 2026-08-09 加 display 检查防残留拦截
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
export function openCampPanel() {
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
export function campPanelOpen() { return !!(campPanelEl && campPanelEl.style.display !== 'none'); }
export function closeCampPanel() {
    if (campPanelEl) campPanelEl.style.display = 'none';
    AudioSystem.playClick();
}

// ================= 角色属性面板（C 键 / NPC 菜单"查看属性"） =================
let charPanelEl = null;
export function openCharPanel(id) {
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
export function closeCharPanel() {
    sv.charPanel = null;
    if (charPanelEl) charPanelEl.style.display = 'none';
    AudioSystem.playClick();
}
export function charPanelOpen() { return !!(sv && sv.charPanel && charPanelEl && charPanelEl.style.display !== 'none'); }

// ================= NPC 队伍管理界面（H 键） =================
// 2026-08-10 用户需求：队员与玩家一致拥有体力/饱食/水分/感染值，可一键调出界面
// 查看详细属性与背包物品，并消耗玩家背包物资给队员治病/加饱食/加水/减感染。
let npcMgrEl = null;
export function openNpcMgr() {
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
export function closeNpcMgr() {
    sv.npcMgr = null;
    if (npcMgrEl) npcMgrEl.style.display = 'none';
    AudioSystem.playClick();
}
export function npcMgrOpen() { return !!(sv && sv.npcMgr && npcMgrEl && npcMgrEl.style.display !== 'none'); }
function renderNpcMgr() {
    if (!npcMgrEl || !sv.npcMgr) return;
    const members = (sv.npcs || []).filter(n => n.alive && n.party);
    const sel = members.find(n => n.id === sv.npcMgr.selId) || members[0];
    // v4.56 修复"查看 NPC 背包时物品消失"：sel.inv 可能含 null（外部 consumeNpcInv 等遗留），
    // 渲染前主动过滤压缩+normBag 24 格（与 v4.55 npcMgrGift 的玩家背包处理对称），避免 null 格子被点击时
    // 索引错位（实际有效物品被跳过，玩家看不到"格子"里的物品）。
    if (sel && Array.isArray(sel.inv)) {
        const _BAG = 24;
        const _f = sel.inv.filter(Boolean);
        while (_f.length < _BAG) _f.push(null);
        if (_f.length !== sel.inv.length || _f.some((x, i) => x !== sel.inv[i])) sel.inv = _f;
    }
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
                _hooks.useItem(idx);   // 主控：与背包左键使用同款（食物/水/药/战利品袋等）
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
    // v4.55 修复"再打开物品栏东西消失"：赠与后 sv.inv 可能产生 null 洞，后续 syncRecordToControlled
    // 把 n.inv（已含 null）再写回 sv.inv → 玩家看到的背包永远带洞看着像物品消失。
    // 此处主动过滤 null+normBag（WNPC.normBag），保证两个背包都是 24 格无洞
    if (Array.isArray(sv.inv)) {
        const _filtered = sv.inv.filter(Boolean);
        const _BAG = 24;
        while (_filtered.length < _BAG) _filtered.push(null);
        sv.inv = _filtered;
    }
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
    // v4.55 赠与完成后立即 syncControlledToRecord（主控当前是切到 NPC 视角的角色）
    // ——否则主控记录的 inv 仍是赠与前快照，下一帧 syncRecordToControlled 把 n.inv 覆盖回 sv.inv 会丢失赠与修改
    const _ctrl = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);
    if (_ctrl) {
        _ctrl.inv = sv.inv;
        _ctrl.food = sv.food; _ctrl.water = sv.water; _ctrl.stamina = sv.stamina;
        _ctrl.exhausted = sv.exhausted; _ctrl.infection = sv.infection || 0;
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
    // 2026-08-12 v3.7 喂食支持任意具体食物（不限于泛称 food）；带水分的食物额外补水
    const idx = sv.inv.findIndex(x => x && _hooks.isFoodId(x.id));
    if (idx < 0) { log('背包里没有食物', '#FFB347'); return; }
    const it = Panel.getItemInfo(sv.inv[idx].id) || {};
    const gain = it.satiate || 20;
    sv.inv[idx].n--;
    if (sv.inv[idx].n <= 0) sv.inv[idx] = null;
    n.food = Math.min(B.HUNGER_MAX, (n.food || 0) + gain);
    if (it.drink) n.water = Math.min(B.WATER_MAX, (n.water || 0) + it.drink);
    npcMgrSyncCtrl(n);
    log(`${n.name} 吃了${it.name || '食物'}，饱食 +${gain}${it.drink ? '、水分 +' + it.drink : ''}`, '#FFD700');
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

// ================= 交易（按物品价值定价，金币结算） =================
let tradeEl = null;
function countCoins(sv) { return sv.coins || 0; }
function takeCoins(sv, need) {
    const have = sv.coins || 0;
    if (have < need) return false;
    sv.coins = have - need;
    return true;
}
export function openNpcTrade(npc) {
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
export function closeTrade() {
    sv.npcTrade = null;
    if (tradeEl) tradeEl.style.display = 'none';
    AudioSystem.playClick();
}
export function tradeOpen() { return !!(sv && sv.npcTrade && tradeEl && tradeEl.style.display !== 'none'); }
// 当前菜单可见选项顺序（数字键映射）
export function carActByIndex(i) {
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
