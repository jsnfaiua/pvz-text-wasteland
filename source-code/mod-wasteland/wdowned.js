// ============================================================
// 【无尽植僵荒原】战斗倒地 / 救援系统
// 从 survival.js 拆出（v4.26）：主控倒地状态机 + 救援 UI + 队友救助 + 待尸变尸体互动。
// 依赖注入（避免循环依赖）：
//   setSv —— 模块级 sv 引用（生存层 enterWasteland 时注入）
//   setLogger —— log 提示（含 mp 广播）
//   setSaveNow —— 存档触发
//   setAllDeadFallback —— 全灭降级兜底（生存层 _softRespawnAllDeadFallback）
//   setShowAllDeadChoices —— 全员阵亡弹窗（生存层 showAllDeadChoices）
// 直接 import：B / WZ / WNPC / WDEV / Panel / AudioSystem / TS。
// ============================================================

import * as B from './wbalance.js';
import * as WZ from './wzombie.js';
import * as WNPC from './wnpc.js';
import * as WDEV from './wdev.js';
import * as Panel from './panel.js';
import AudioSystem from '../systems/audio.js';
import { TS } from './wconst.js';

// ================= 生存层依赖注入 =================
let sv = null;
export function setSv(s) { sv = s; }
let _logger = () => {};
export function setLogger(fn) { _logger = (typeof fn === 'function') ? fn : () => {}; }
function log(msg, color) { _logger(msg, color); }
let _saveNow = () => {};
export function setSaveNow(fn) { _saveNow = (typeof fn === 'function') ? fn : () => {}; }
let _allDeadFallback = null;
export function setAllDeadFallback(fn) { _allDeadFallback = (typeof fn === 'function') ? fn : null; }
let _showAllDeadChoices = null;
export function setShowAllDeadChoices(fn) { _showAllDeadChoices = (typeof fn === 'function') ? fn : null; }

// ================= 软核倒地救治：提交药品（单机 doInteract / 联机 downedMed 事件共用） =================
// 返回 true=已提交，false=无药；集齐自动救活。
export function downedMedSubmit(sv2, med, herb) {
    if (!sv2 || !sv2._downed) return false;
    if (med) sv2._downed.med = (sv2._downed.med || 0) + med;
    if (herb) sv2._downed.herb = (sv2._downed.herb || 0) + herb;
    if ((sv2._downed.med || 0) >= B.DOWNED_NEED_MED || (sv2._downed.herb || 0) >= B.DOWNED_HERB_EQUIV) {
        // 救活"真正倒下的记录"（可能是队友，而非固定 isPlayer）：
        // 否则二次倒地救活时清的是 isPlayer，真正倒下的队友记录 downed 残留 → 二次救治异常。
        const pc = sv2.npcs.find(n => n.downed) || sv2.npcs.find(n => n.id === 'player' || n.isPlayer);
        // 用户要求"救起来 30% 血量，其他状态保持原样（濒临死亡之前是什么样就是什么样）"：
        // 不再清感染/疾病（此前 pc.infection = 0; pc.sick = null 重置状态）。
        if (pc) {
            pc.downed = false; pc.alive = true; pc.hp = Math.max(1, Math.round(pc.maxHp * 0.3));
            // v4.29 同步主控侧感染/疾病到记录（救活后侵蚀粒子/属性削弱保留，与"debuff 不清"一致）
            sv2.infection = pc.infection || 0;
            sv2._sick = pc.sick || null;
        }
        // 救活的角色记录死因同样清空（防 onDeath 残留旧值被下次复用）
        if (pc) pc._deathReason = null;
        const name = sv2._downed.name || '幸存者';
        sv2._downed = null;
        // 用户要求"救活后死亡地点标志消失"：人被救活了，死亡地点指引不再需要。
        sv2._legacyDrop = null;
        sv2._waitDowned = false;   // 救活解除原地等待限制
        // 救活后清死因残留：防"被救活后再次死亡，弹窗仍显示上次死因"。
        sv2._deathReason = null;
        sv2._lastHitBy = null;
        // 状态保留：不重置感染/疾病（用户要求"其他状态保持原样"）
        log(`${name} 被救活了！`, '#7DFF7D');
        _saveNow();
    }
    return true;
}

// ================= 救援时间随濒死次数递减 =================
// v2.98 用户需求：第一次 20 分钟，第二次 10 分钟，第三次 5 分钟……每次减半（-50%），
// 最低兜底 60 秒（防止次数过多减到 0）。次数=1 → 20 分钟（默认）。
export function downedLimitForCount(count) {
    const base = B.DOWNED_LIMIT_SECONDS || 1200;
    const n = Math.max(1, Math.floor(count || 1));
    const half = Math.pow(2, n - 1);
    return Math.max(60, Math.round(base / half));
}

// ================= 主控倒地救治状态机 =================
// 职责：① 超时检测（20 分钟现实时间）② NPC 背人 ③ 队友全灭检测 → 弹窗/降级重生
export function updateDowned(sv2, dt, canStand) {
    const dwn = sv2._downed;
    // 软核成员倒地：主控未倒地但存在倒地成员（_downedMembers）时，只跑成员超时管理。
    if (!dwn) { updateDownedMembersTimeout(sv2); return; }
    // 救援界面时间与游戏内头顶倒计时实时同步（节流 0.25s 仅更新文本）
    if (rescueOpen()) {
        sv2._rescueRefreshT = (sv2._rescueRefreshT || 0) - dt;
        if (sv2._rescueRefreshT <= 0) { sv2._rescueRefreshT = 0.25; if (rescueOpen()) updateRescueTimer(); }
    }
    // 玩家背人中：倒地主角跟随玩家移动（背到床旁/安全点），此时不触发队友自动背人
    if (sv2._carryDowned) {
        dwn.px = sv2.px; dwn.py = sv2.py;
        // 渲染走 NPC 记录的 x/y（drawNpcs 遍历 sv.npcs 画 n.downed 记录），同步记录坐标
        const pc = (sv2.npcs || []).find(n => n.downed) || (sv2.npcs || []).find(n => n.isPlayer);
        if (pc) {
            pc.x = sv2.px; pc.y = sv2.py;
            // 濒死角色跨场景：背人跨过场景边界时，倒地主控记录的 inInterior 与玩家当前场景一致
            if (sv2.interior) { pc.inInterior = true; pc.interiorKey = sv2.interior.key; pc.interiorFloor = sv2.interior.floor || 1; }
            else { pc.inInterior = false; pc.interiorKey = null; pc.interiorFloor = null; }
        }
    }
    // ① 队友全灭检测：倒地主角之外的所有可行动 party 队友都阵亡/濒死 → 无人能救 → 弹全灭窗
    const mates = (sv2.npcs || []).filter(n => n.alive && !n.downed && n.party && n.id !== sv2.controllerId && !n.isPlayer);
    const _udc = sv2.npcs && sv2.npcs.find(n => n.id === sv2.controllerId);
    const _udp = (sv2.npcs || []).some(n => n.isPlayer && n.alive && !n.downed);
    const _guestAlive = p => (p._hostHp != null ? p._hostHp : (p.hp || 0)) > 0;
    const anyMateAlive = mates.length >= 1 || !!(_udc && _udc.alive && !_udc.downed) || _udp
        || (sv2.p2 && _guestAlive(sv2.p2)) || (sv2.p2s && Object.values(sv2.p2s).some(_guestAlive));
    if (!anyMateAlive) {
        log(`${dwn.name} 的队友全部阵亡或濒死，无人能救……`, '#FF5544');
        if (typeof _showAllDeadChoices === 'function' && _showAllDeadChoices) {
            _showAllDeadChoices(sv2, dwn.name, dwn.deathReason || '战斗中被击败', '');
        } else if (_allDeadFallback) {
            _allDeadFallback(sv2, dwn.name, dwn.deathReason || '战斗中被击败');
        }
        return;
    }
    // ② 超时 → 彻底死亡 → 重生点刷"玩家名"僵尸（延迟 DOWNED_PZ_DELAY_DAYS 天）
    // v2.97 现实时间救援倒计时：濒死可救治总时长 = DOWNED_LIMIT_SECONDS(20 分钟现实时间)。
    // 被攻击（补刀）每 1 点伤害扣 DOWNED_HIT_PENALTY_SEC(10) 秒救援时间。
    if (dwn.downedAtReal == null) dwn.downedAtReal = (sv2.now != null ? sv2.now : 0);
    if (dwn._penaltySec == null) dwn._penaltySec = 0;
    const nowReal = sv2.now != null ? sv2.now : 0;
    const spent = Math.max(0, nowReal - dwn.downedAtReal) + (dwn._penaltySec || 0);
    const dwnLimitSec = dwn.limitSec || B.DOWNED_LIMIT_SECONDS;
    if (spent >= dwnLimitSec) {
        if (!dwn._pzScheduled) {
            // 救援时间到了 → 自动关闭救援界面（主角彻底死亡，界面无意义）
            if (rescueOpen()) closeRescue();
            dwn._pzScheduled = sv2.day + B.DOWNED_PZ_DELAY_DAYS;
            log(`${dwn.name} 救治超时，已彻底死亡……`, '#FF5544');
            // 倒下的名册记录清除（已死亡）；可能是队友记录而非固定 isPlayer
            const pc = sv2.npcs.find(n => n.downed) || sv2.npcs.find(n => n.id === 'player' || n.isPlayer);
            if (pc) {
                pc.alive = false; pc.downed = false; pc.hp = 0;
                // 仅非 isPlayer 的倒地主控（切视角后的队友）才补尸体；原主控遗物由 corpse: 承载。
                if (!pc.isPlayer && !pc._corpse) {
                    pc._corpse = true;
                    pc._corpseDay = sv2.day;
                    pc._corpseAtReal = sv2.now != null ? sv2.now : 0;
                    pc._corpseContents = [];
                    for (const s of pc.inv || []) { if (s) pc._corpseContents.push({ ...s, n: s.n || 1 }); }
                    pc._corpseSearched = false;
                    log(`${pc.name} 的尸体留在原地（靠近搜索 [F]）……`, '#9fd6ff');
                }
            }
        }
        // 延迟天数到 → 在重生点（床）刷尸
        if (sv2.day >= dwn._pzScheduled) {
            let rx, ry;
            if (sv2.homeBed) { rx = (sv2.homeBed.x + 0.5) * TS; ry = (sv2.homeBed.y + 0.5) * TS; }
            else { rx = dwn.px; ry = dwn.py; }
            WZ.spawnPlayerZombie(sv2, { x: rx, y: ry, name: dwn.name });
            log(`重生点出现了一只「${dwn.name}」的僵尸……`, '#FF5544');
            sv2._downed = null;
            _saveNow();
        }
        return;
    }
    // ③ NPC 背人：队友清完周围怪物后，才把倒地主角背回床旁（有床）/原地等待（无床）
    if (dwn._pzScheduled) return;   // 已排期尸变，不再背人
    if (sv2._carryDowned) return;    // 玩家正背着主角，NPC 不再重复背
    const threatNear = (sv2.zombies || []).some(z => z.hp > 0 && Math.hypot(z.x - dwn.px, z.y - dwn.py) < 8 * TS)
        || (sv2.npcs || []).some(o => o.alive && o.role === 'hostile' && Math.hypot(o.x - dwn.px, o.y - dwn.py) < 8 * TS);
    if (!threatNear && mates.length >= 1) {
        // 优先选择被命令背人的 NPC（_carryOrder）；否则取最近队友
        const mate = mates.find(m => m._carryOrder) || mates[0];
        // 玩家选「原地等待」(_waitDowned) 时，视角锚点在倒地主角；不背回床旁（原地不动）
        if (sv2.homeBed && !sv2._waitDowned) {
            const bx = (sv2.homeBed.x + 0.5) * TS, by = (sv2.homeBed.y + 0.5) * TS;
            const md = Math.hypot(mate.x - bx, mate.y - by);
            if (md > TS * 1.5) {
                WNPC.moveToward(sv2, mate, bx, by, dt, canStand);
            } else {
                dwn.px = bx; dwn.py = by;
                mate._carryOrder = false; mate.state = 'follow';   // 送达解除命令
                log(`${mate.name} 将 ${dwn.name} 送到了床旁`, '#7fd6ff');
            }
        } else {
            // 无床：原地救治——队友守候在倒地主角旁（等待玩家送药）
            const md = Math.hypot(mate.x - dwn.px, mate.y - dwn.py);
            if (md > TS * 2) WNPC.moveToward(sv2, mate, dwn.px, dwn.py, dt, canStand);
            else { mate._carryOrder = false; mate.state = 'follow'; }
        }
    }
    // ④ 软核成员倒地：倒地成员超时管理
    updateDownedMembersTimeout(sv2);
}

// ================= 软核成员倒地管理：超时 → 真正死亡 =================
// 移除自动救助（用户需求变更：改为按 F 打开救助界面手动用药），只保留超时管理。
export function updateDownedMembersTimeout(sv2) {
    // 队友救援界面时间与游戏内头顶倒计时实时同步（节流 0.25s，用 sv2.now）
    if (mateRescueId != null && typeof renderMateRescue === 'function') {
        const _now = sv2.now != null ? sv2.now : performance.now();
        if (_now - (sv2._mateRescueRefreshAt || 0) >= 0.25) { sv2._mateRescueRefreshAt = _now; updateMateRescueTimer(); }
    }
    // 队友背起：背起的倒地队友坐标跟随玩家（与主控背起 _carryDowned 一致，含室内跨场景坐标同步）
    if (sv2._carryMateId) {
        const cm = Array.isArray(sv2._downedMembers) ? sv2._downedMembers.find(x => x && x.id === sv2._carryMateId) : null;
        if (!cm || !cm.alive || !cm.downed) { sv2._carryMateId = null; }
        else {
            cm.x = sv2.px; cm.y = sv2.py;
            if (sv2.interior) { cm.inInterior = true; cm.interiorKey = sv2.interior.key; cm.interiorFloor = sv2.interior.floor || 1; }
            else { cm.inInterior = false; cm.interiorKey = null; cm.interiorFloor = null; }
        }
    }
    if (!sv2._downedMembers || !sv2._downedMembers.length) return;
    for (let i = sv2._downedMembers.length - 1; i >= 0; i--) {
        const m = sv2._downedMembers[i];
        if (!m || !m.alive || !m.downed) {
            // 被移除的是正在背起的队友 → 清 _carryMateId（防悬空）
            if (sv2._carryMateId === m.id) sv2._carryMateId = null;
            // 若成员【活着但非 downed】（异常状态被移除）且无 _corpse → 防御：保留为尸体（可搜索遗物）
            if (m && m.party && !m._corpse) {
                m.downed = false; m.alive = false; m.hp = 0;
                m._deathReason = m._deathReason || '战斗中倒地（状态异常）致死';
                m._corpse = true;
                m._corpseDay = sv2.day;
                m._corpseAtReal = sv2.now != null ? sv2.now : 0;
                m._corpseContents = [];
                for (const s of m.inv || []) { if (s) m._corpseContents.push({ ...s, n: s.n || 1 }); }
                m._corpseSearched = false;
                log(`${m.name} 倒下了（状态异常，保留尸体可搜索）……`, '#FFB347');
            }
            sv2._downedMembers.splice(i, 1);
            continue;
        }
        // v2.97 现实时间救援倒计时（与主控 _downed 一致）：成员倒地也是现实 20 分钟
        if (m._downedAtReal == null) m._downedAtReal = (sv2.now != null ? sv2.now : 0);
        if (m._penaltySec == null) m._penaltySec = 0;
        const spentM = Math.max(0, (sv2.now != null ? sv2.now : 0) - m._downedAtReal) + (m._penaltySec || 0);
        const mLimit = m.limitSec || B.DOWNED_LIMIT_SECONDS;
        // 超时 → 真正死亡
        if (spentM >= mLimit) {
            log(`${m.name} 救治超时，已死亡……`, '#FF5544');
            m.downed = false; m.alive = false; m.hp = 0;
            m._deathReason = m._deathReason || '救援时间耗尽致死';
            m._corpse = true;
            m._corpseDay = sv2.day;
            m._corpseAtReal = sv2.now != null ? sv2.now : 0;
            m._corpseContents = [];
            for (const s of m.inv || []) {
                if (!s) continue;
                // 保留完整物品对象（武器耐久/附魔等属性，用户要求"物品功能不会丧失"）
                m._corpseContents.push({ ...s, n: s.n || 1 });
            }
            m._corpseSearched = false;
            if (sv2._carryMateId === m.id) sv2._carryMateId = null;
            sv2._downedMembers.splice(i, 1);
            continue;
        }
        // 用户需求变更：移除自动救助（改为按 F 打开救助界面手动选择药品救活）
    }
}

// ================= 救援 UI（主控 + 队友 + 待尸变尸体共用 rescueEl 遮罩） =================
let rescueEl = null;
export function openRescue() {
    if (!rescueEl) {
        rescueEl = document.createElement('div');
        rescueEl.id = 'wsl-rescue';
        rescueEl.style.cssText = 'position:absolute;inset:0;z-index:908;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        document.getElementById('game-container').appendChild(rescueEl);
        // 点击遮罩空白处关闭救助界面（内容区域点击不关闭）
        rescueEl.addEventListener('click', (e) => {
            if (e.target === rescueEl) closeRescue();
        });
    }
    rescueEl.classList.remove('hidden');
    rescueEl.style.display = 'flex';
    renderRescue();
}
export function closeRescue() {
    if (rescueEl) rescueEl.style.display = 'none';
    AudioSystem.playClick();
}
export function rescueOpen() { return !!(sv && sv._downed && rescueEl && rescueEl.style.display !== 'none'); }

// 存活倒计时文案（v2.97 现实时间：20 分钟救援窗口，被攻击每 1 点伤害减 10 秒）
export function downedRemainTxt(sv2) {
    const dwn = sv2._downed;
    if (!dwn) return '';
    const onBed = false;   // v2.97 现实时间窗口：不再按床延长
    if (dwn.downedAtReal == null) dwn.downedAtReal = (sv2.now != null ? sv2.now : 0);
    if (dwn._penaltySec == null) dwn._penaltySec = 0;
    const spent = Math.max(0, (sv2.now != null ? sv2.now : 0) - dwn.downedAtReal) + (dwn._penaltySec || 0);
    const limit = dwn.limitSec || B.DOWNED_LIMIT_SECONDS;
    const remainSec = Math.max(0, limit - spent);
    const m = Math.floor(remainSec / 60), s = Math.floor(remainSec % 60);
    const txt = `${m} 分 ${String(s).padStart(2, '0')} 秒`;
    return { txt, onBed, limit, remainSec };
}

export function renderRescue() {
    if (!rescueEl || !sv._downed) return;
    const dwn = sv._downed;
    const name = dwn.name || '幸存者';
    const needMed = B.DOWNED_NEED_MED - (dwn.med || 0);
    const needHerb = B.DOWNED_HERB_EQUIV - (dwn.herb || 0);
    const done = needMed <= 0 || needHerb <= 0;   // 药品集齐
    const { txt } = downedRemainTxt(sv);
    const devInf = WDEV.isDev() && sv._devInf;   // 开发者无限资源
    const hasMed = devInf || sv.inv.some(s => s && (s.id === B.DOWNED_RESCUE_MED || s.id === 'med:pan'));
    let herbs = 0; for (const s of sv.inv) if (s && s.id === 'herb') herbs += s.n;
    rescueEl.innerHTML = buildRescuePanel({
        name, txt, devInf, needMed, needHerb, done,
        dwnMed: dwn.med || 0, dwnHerb: dwn.herb || 0,
        hasMed, herbs,
        carryAct: sv._carryDowned ? 'putdown' : 'carry',
        carryLabel: sv._carryDowned ? '放下' : '背起',
    });
    rescueEl.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'close') { closeRescue(); return; }
        if (act === 'carry') {
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
        submitRescueMed();
    }));
}

// 共享救治面板模板（主控 + 队友统一）：保证两个界面的 HTML 字符级一致
function buildRescuePanel(p) {
    return '<div style="background:#141a22;border:2px solid #E8836A;border-radius:10px;padding:20px 26px;width:460px;position:relative;">' +
        '<button data-act="close" style="position:absolute;top:8px;right:10px;background:none;border:none;color:#8a9aa2;font-size:18px;cursor:pointer;line-height:1;">✕</button>' +
        `<div style="font-size:18px;color:#E8836A;letter-spacing:2px;margin-bottom:6px;text-align:center;">♨ 救治 ${p.name}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;text-align:center;margin-bottom:14px;">${p.name} 正处于<b style="color:#FF5544;">濒临死亡</b>状态，需要及时救治</div>` +
        `<div style="font-size:14px;color:#FFD700;margin-bottom:4px;border:1px solid #3a3a24;background:#1a1a20;padding:8px 10px;border-radius:6px;">` +
        `⏳ 还能存活：<b id="wsl-rescue-timer">${p.txt}</b> <span style="color:#8a9aa2;font-size:11px;">（现实 ${Math.round(B.DOWNED_LIMIT_SECONDS / 60)} 分钟，被攻击每次伤害 -10 秒）${p.devInf ? ' · <b style="color:#39d98a;">开发者无限资源</b>' : ''}</span></div>` +
        `<div style="font-size:14px;color:#e8e8e8;margin:12px 0 4px;">待提交药品：</div>` +
        `<div style="font-size:12px;color:#ccd;margin-bottom:2px;">伤口药/抗生素 ${p.needMed > 0 ? '<b style="color:#7DFF7D;">' + p.needMed + '</b>' : '<span style="color:#39d98a;">已集齐 ✔</span>'}${p.needMed > 0 ? ' 瓶，或 草药 ' + p.needHerb + ' 株' : ''}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;">已提交：对症药/抗生素 <span style="color:#FFD700;">${p.dwnMed}</span>/${B.DOWNED_NEED_MED} · 草药 <span style="color:#FFD700;">${p.dwnHerb}</span>/${B.DOWNED_HERB_EQUIV}</div>` +
        `<div style="font-size:12px;color:#8a9aa2;margin-top:6px;">药品集齐后即可救治${p.name}。对症药/抗生素各计 1 瓶，草药每 3 株计 1 进度。</div>` +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">' +
        `<button class="menu-btn" data-act="submit" style="min-width:0;${p.done ? 'color:#39d98a;' : ''}">${p.done ? '集齐·完成救治' : (p.hasMed || p.herbs > 0 ? '提交药品' : '无药品')}</button>` +
        `<button class="menu-btn" data-act="${p.carryAct}" style="min-width:0;">${p.carryLabel}</button>` +
        '<button class="menu-btn" data-act="close" style="min-width:0;grid-column:1/3;">关闭（不中止救治）</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#778;text-align:center;margin-top:10px;">提示：关闭界面不会导致濒死玩家死亡 · 背到床旁躺下可延长存活时间</div></div>';
}

// 仅更新主控存活倒计时文本（不重建 DOM，避免 hover 闪烁/点击丢失）
export function updateRescueTimer() {
    if (!rescueEl || !sv._downed) return;
    const t = rescueEl.querySelector('#wsl-rescue-timer');
    if (!t) return;
    t.textContent = downedRemainTxt(sv).txt;
}

// 提交救治药品：逐份提交累计；集齐触发 downedMedSubmit 救活
function submitRescueMed() {
    if (!sv._downed) { closeRescue(); return; }
    const needMed = B.DOWNED_NEED_MED - (sv._downed.med || 0);
    const needHerb = B.DOWNED_HERB_EQUIV - (sv._downed.herb || 0);
    if (needMed <= 0 || needHerb <= 0) { downedMedSubmit(sv, 0, 0); closeRescue(); return; }   // 已集齐
    const take = (id) => {
        if (WDEV.isDev() && sv._devInf) return true;   // 开发者无限资源
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
        let herbs = 0; for (const s of sv.inv) if (s && s.id === 'herb') herbs += s.n;
        if (herbs > 0 || (WDEV.isDev() && sv._devInf)) {
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

// ================= 队友濒死救助（按 F 弹出救助界面手动用药） =================
let mateRescueId = null;
export function openMateRescue(id) {
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
export function mateRescueTarget(sv2, id) {
    if (!Array.isArray(sv2._downedMembers)) return null;
    return sv2._downedMembers.find(x => x && x.id === id) || null;
}
function renderMateRescue() {
    if (!rescueEl || !mateRescueId) return;
    const m = mateRescueTarget(sv, mateRescueId);
    if (!m || !m.alive || !m.downed) { closeMateRescue(); return; }
    const name = m.name || '队员';
    const needMed = B.DOWNED_NEED_MED - (m.med || 0);
    const needHerb = B.DOWNED_HERB_EQUIV - (m.herb || 0);
    const done = needMed <= 0 || needHerb <= 0;
    if (m._downedAtReal == null) m._downedAtReal = (sv.now != null ? sv.now : 0);
    if (m._penaltySec == null) m._penaltySec = 0;
    const spentM = Math.max(0, (sv.now != null ? sv.now : 0) - m._downedAtReal) + (m._penaltySec || 0);
    const mLimit = m.limitSec || B.DOWNED_LIMIT_SECONDS;
    const remainSecM = Math.max(0, mLimit - spentM);
    const mm = Math.floor(remainSecM / 60), ss = Math.floor(remainSecM % 60);
    const txt = `${mm} 分 ${String(ss).padStart(2, '0')} 秒`;
    const devInfM = WDEV.isDev() && sv._devInf;
    const hasMed = devInfM || sv.inv.some(s => s && (s.id === B.DOWNED_RESCUE_MED || s.id === 'med:pan'));
    let herbs = 0; for (const s of sv.inv) if (s && s.id === 'herb') herbs += s.n;
    rescueEl.innerHTML = buildRescuePanel({
        name, txt, devInf: devInfM, needMed, needHerb, done,
        dwnMed: m.med || 0, dwnHerb: m.herb || 0,
        hasMed, herbs,
        carryAct: sv._carryMateId === m.id ? 'putdown' : 'carrymate',
        carryLabel: sv._carryMateId === m.id ? '放下' : '背起',
    });
    rescueEl.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
        const act = el.dataset.act;
        if (act === 'close') { closeMateRescue(); return; }
        if (act === 'carry') {
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
// 仅更新队友存活倒计时文本（不重建 DOM，避免 hover 闪烁/点击丢失）
function updateMateRescueTimer() {
    if (!rescueEl || !mateRescueId) return;
    const m = mateRescueTarget(sv, mateRescueId);
    if (!m || !m.alive || !m.downed) return;
    const t = rescueEl.querySelector('#wsl-rescue-timer');
    if (!t) return;
    if (m._downedAtReal == null) m._downedAtReal = (sv.now != null ? sv.now : 0);
    if (m._penaltySec == null) m._penaltySec = 0;
    const spentM = Math.max(0, (sv.now != null ? sv.now : 0) - m._downedAtReal) + (m._penaltySec || 0);
    const mLimit = m.limitSec || B.DOWNED_LIMIT_SECONDS;
    const remainSecM = Math.max(0, mLimit - spentM);
    const mm = Math.floor(remainSecM / 60), ss = Math.floor(remainSecM % 60);
    t.textContent = `${mm} 分 ${String(ss).padStart(2, '0')} 秒`;
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
        if (WDEV.isDev() && sv._devInf) return true;
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
export function mateMedSubmit(sv2, id, med, herb) {
    const m = mateRescueTarget(sv2, id);
    if (!m) return false;
    if (med) m.med = (m.med || 0) + med;
    if (herb) m.herb = (m.herb || 0) + herb;
    if ((m.med || 0) >= B.DOWNED_NEED_MED || (m.herb || 0) >= B.DOWNED_HERB_EQUIV) {
        m.downed = false;
        m.alive = true;
        m.hp = Math.max(1, Math.round(m.maxHp * 0.3));   // 30% 血
        // 状态保留：不清 infection/sick/attrs
        m._deathReason = null;   // 救活 = 恢复健康，死因必须清空
        if (Array.isArray(sv2._downedMembers)) {
            sv2._downedMembers = sv2._downedMembers.filter(x => x !== m);
        }
        // 若救活的目标就是 sv._downed 对应角色 → 同步清 sv._downed（含相关状态）
        if (sv2._downed) {
            const dId = sv2._downed.id;
            const dName = sv2._downed.name;
            if ((dId != null && m.id === dId) || (dName && m.name === dName)) {
                sv2._downed = null;
                sv2._waitDowned = false;
                sv2._carryDowned = false;
            }
        }
        // 救活的若是正在被背起的队友 → 清 _carryMateId
        if (sv2._carryMateId === m.id) sv2._carryMateId = null;
        if (sv2.controllerId === m.id) {   // 若救活的是当前操控的成员 → 恢复主控血量
            sv2.hp = m.hp; sv2.maxHp = m.maxHp;
            // v4.29 修复"救活后侵蚀粒子消失"：主控侧 sv.infection/_sick 必须同步自记录
            // （mateMedSubmit 只同步 hp/maxHp → sv.infection 仍旧值/0 → 渲染粒子消失）。
            sv2.infection = m.infection || 0;
            sv2._sick = m.sick || null;
        }
        log(`${m.name} 被救活了！`, '#7DFF7D');
        _saveNow();
    }
    return true;
}

// ================= 待尸变尸体互动 UI（用户定稿"和待尸变尸体交互"） =================
// 按 F → 弹"补刀"按钮 + 尸变倒计时。补刀：直接 _revived=true（跳过尸变倒计时）→
// 走 updateCorpseRevive 分支生成尸变僵尸 + 立即 n.party=false 移除队伍。
let _corpseFinishId = null;
export function openCorpseFinish(npcId) {
    const m = (sv.npcs || []).find(x => x && x.id === npcId);
    // v4.33 用户定稿：补刀覆盖友善/中立/敌对所有 NPC（不再限 party）；尸变尸体（_revivedCorpse）不二次尸变不可补刀
    if (!m || m.alive || m._revived || m._revivedCorpse) return;
    _corpseFinishId = npcId;
    if (!rescueEl) {
        rescueEl = document.createElement('div');
        rescueEl.id = 'wsl-rescue';
        rescueEl.style.cssText = 'position:absolute;inset:0;z-index:908;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
        const gc = document.getElementById('game-container');
        if (gc) gc.appendChild(rescueEl);
    }
    rescueEl.classList.remove('hidden');
    rescueEl.style.display = 'flex';
    renderCorpseFinish();
    AudioSystem.playClick && AudioSystem.playClick();
}
function closeCorpseFinish() {
    _corpseFinishId = null;
    if (rescueEl) rescueEl.style.display = 'none';
    AudioSystem.playClick && AudioSystem.playClick();
}
function updateCorpseFinishTimer() {
    if (!rescueEl || !_corpseFinishId) return;
    const t = document.getElementById('wsl-corpse-timer');
    if (!t) return;
    const m = (sv.npcs || []).find(x => x && x.id === _corpseFinishId);
    if (!m || m.alive || m._revived) { closeCorpseFinish(); return; }
    const at = m._corpseAtReal != null ? m._corpseAtReal : (sv.now || 0);
    const remain = Math.max(0, B.CORPSE_REVIVE_SECONDS - ((sv.now || 0) - at));
    const mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
    t.textContent = `${mm} 分 ${String(ss).padStart(2, '0')} 秒`;
}
function renderCorpseFinish() {
    if (!rescueEl || !_corpseFinishId) return;
    const m = (sv.npcs || []).find(x => x && x.id === _corpseFinishId);
    if (!m || m.alive || m._revived) { closeCorpseFinish(); return; }
    const name = m.name || '队员';
    const at = m._corpseAtReal != null ? m._corpseAtReal : (sv.now || 0);
    const remain = Math.max(0, B.CORPSE_REVIVE_SECONDS - ((sv.now || 0) - at));
    const mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
    rescueEl.innerHTML = `
        <div style="background:#0a121cdd;border:2px solid #FFB347;border-radius:12px;padding:18px 24px;width:340px;color:#e0e8ef;box-shadow:0 0 24px #FFB34766;">
            <div style="font-size:14px;color:#FFD700;letter-spacing:1px;margin-bottom:8px;">▍ 待尸变尸体</div>
            <div style="font-size:13px;color:#bbb;margin-bottom:6px;">名字：<span style="color:#FF8877;font-weight:bold;">${name}</span></div>
            <div style="font-size:12px;color:#aaa;margin-bottom:6px;">倒下原因：<span style="color:#bbb;">${m._killedByReason || m._cause || '战斗中阵亡'}</span></div>
            <div style="font-size:12px;color:#aaa;margin-bottom:10px;">尸变倒计时：<span id="wsl-corpse-timer" style="color:#FF5544;font-weight:bold;">${mm} 分 ${String(ss).padStart(2, '0')} 秒</span></div>
            <div style="font-size:11px;color:#888;margin-bottom:12px;line-height:1.5;">${mm} 分 ${String(ss).padStart(2, '0')} 秒后尸变，可提前补刀阻止尸变。补刀后尸体保留在原地可搜刮。</div>
            <div style="display:flex;gap:8px;">
                <button id="wsl-corpse-finish" style="flex:1;background:#7a2020;border:1px solid #FF5544;color:#fff;padding:8px 0;cursor:pointer;border-radius:6px;font-family:inherit;font-size:13px;">补刀（阻止尸变）</button>
                <button id="wsl-corpse-cancel" style="flex:1;background:#1f2a35;border:1px solid #5C636A;color:#bbb;padding:8px 0;cursor:pointer;border-radius:6px;font-family:inherit;font-size:13px;">关闭</button>
            </div>
        </div>`;
    const btnFinish = document.getElementById('wsl-corpse-finish');
    const btnCancel = document.getElementById('wsl-corpse-cancel');
    if (btnFinish) btnFinish.onclick = () => {
        m._revived = true;
        m.party = false;   // 立即移除队伍（v4.23 用户定稿）
        log(`对 ${name} 补刀，阻止了尸变（已生成可搜尸体）`, '#FF8877');
        AudioSystem.playClick && AudioSystem.playClick();
        closeCorpseFinish();
    };
    if (btnCancel) btnCancel.onclick = closeCorpseFinish;
    rescueEl.onclick = (e) => { if (e.target === rescueEl) closeCorpseFinish(); };
}
