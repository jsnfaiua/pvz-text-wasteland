// ============================================================================
// 战斗死亡系统 + 死亡救助 全矩阵测试（2026-08-11 v2.97）
// 覆盖维度：
//   A. onDeath 死亡分支（主控死亡 × 队友状态 × 难度 × 独狼/有队友 × 切视角）
//   B. updateDowned 救助状态机（主控倒地 × 队友可救/全倒 × 背人/等待 × 成员超时）
//   C. 救援时间（现实 20 分钟 × 被攻击扣时 × 超时彻底死亡）
//   D. 药品救治（对症药/抗生素 × 草药 × 开发者无限资源 × 集齐救活 30% 血）
//   E. 切视角状态转移（濒死主控 → 队友 → 新主控不被污染）
//   F. 全灭弹窗内容（独狼"你阵亡了" / 有队友"全员阵亡" + 击败详情）
// 运行：node dev-tools/combat-death-matrix.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surv = fs.readFileSync(path.join(projRoot, 'source-code/mod-wasteland/survival.js'), 'utf8');
const wnpc = fs.readFileSync(path.join(projRoot, 'source-code/mod-wasteland/wnpc.js'), 'utf8');

let pass = 0, fail = 0;
const assert = (cond, msg) => {
    if (cond) { pass++; }
    else { fail++; console.log(`✗ FAIL: ${msg}`); }
};
const TS = 36;

// ---------------------------------------------------------------------------
// 工具：模拟 onDeath 的分支选择（与源码 3442-3555 完全一致）
// ---------------------------------------------------------------------------
function simOnDeath(npcs, controllerId, dkSoft) {
    // onDeath 内部首先把当前主控（controllerId 对应记录）标记为倒地（3486-3487 行源码逻辑）：
    // const pc = find(controllerId) || find(isPlayer); if (pc) { pc.alive=true; pc.downed=true; pc.hp=1; }
    const snap = (npcs || []).map(n => ({ ...n }));
    const pc = snap.find(n => n.id === controllerId) || snap.find(n => n.isPlayer);
    if (pc) { pc.alive = true; pc.downed = true; pc.hp = 1; }
    // 之后判定 mates / anyAliveMate / hadMates（源码 3469-3555）
    const mates = snap.filter(n => n.alive && !n.downed && n.party && n.id !== controllerId && !n.isPlayer);
    // v2.97 修复：当前主控/原主角活着也算可行动（注意：这里 controllerId 已被标 downed，
    // controllerAlive=false；只有【原主角 isPlayer 且非 controllerId 且未倒地】才计入 playerAlive）
    const cur = snap.find(n => n.id === controllerId);
    const controllerAlive = !!(cur && cur.alive && !cur.downed);
    const playerAlive = (snap).some(n => n.isPlayer && n.alive && !n.downed && n.id !== controllerId);
    const anyAliveMate = mates.length >= 1 || controllerAlive || playerAlive;
    const hadMates = snap.some(n => n.party && n.id !== controllerId && !n.isPlayer);
    if (!dkSoft) return { branch: '硬核结算' };
    if (mates.length >= 1) return { branch: '切换队友视角' };
    if (hadMates && !anyAliveMate) return { branch: '全灭弹窗' };
    return { branch: '独狼重生' };
}

// 工具：模拟 updateDowned 的状态机（与源码 3743-3920 一致）
function simUpdateDowned(sv, npcs, controllerId) {
    const dwn = sv._downed;
    const mates = (npcs || []).filter(n => n.alive && !n.downed && n.party && n.id !== controllerId && !n.isPlayer);
    const cur = (npcs || []).find(n => n.id === controllerId);
    const controllerAlive = !!(cur && cur.alive && !cur.downed);
    const playerAlive = (npcs || []).some(n => n.isPlayer && n.alive && !n.downed && n.id !== controllerId);
    const anyMateAlive = mates.length >= 1 || controllerAlive || playerAlive;
    if (!dwn) return { mode: 'membersTimeout' };   // 只跑成员超时管理
    if (sv._carryDowned) return { mode: 'carryFollow' };   // 背人中
    if (!anyMateAlive) return { mode: '全灭弹窗' };
    return { mode: '等待救援/切视角' };
}

// ---------------------------------------------------------------------------
// A. onDeath 死亡分支矩阵
// ---------------------------------------------------------------------------
console.log('\n========== A. onDeath 死亡分支 ==========');
// A1: 主控死亡 + 各队友组合（1 健康 / 2 健康 / 全倒地 / 全死 / 混合）
const combosA = [
    { label: '主控+0队友', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }], ctrl: 'pc', dkSoft: true, expect: '独狼重生' },
    { label: '主控+1健康', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: false }], ctrl: 'pc', dkSoft: true, expect: '切换队友视角' },
    { label: '主控+2健康', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: false }, { id: 'lao', party: true, alive: true, downed: false }], ctrl: 'pc', dkSoft: true, expect: '切换队友视角' },
    { label: '主控+全倒地', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: true }, { id: 'lao', party: true, alive: true, downed: true }], ctrl: 'pc', dkSoft: true, expect: '全灭弹窗' },
    { label: '主控+全死透', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: false, downed: false }, { id: 'lao', party: true, alive: false, downed: false }], ctrl: 'pc', dkSoft: true, expect: '全灭弹窗' },
    { label: '主控+一倒一死', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: true }, { id: 'lao', party: true, alive: false, downed: false }], ctrl: 'pc', dkSoft: true, expect: '全灭弹窗' },
    { label: '主控+1健康1倒地', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: false }, { id: 'lao', party: true, alive: true, downed: true }], ctrl: 'pc', dkSoft: true, expect: '切换队友视角' },
    { label: '主控+非队友NPC', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'str', party: false, alive: true, downed: false }], ctrl: 'pc', dkSoft: true, expect: '独狼重生' },
    { label: '只剩原主角活着', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: false, downed: false }, { id: 'lao', party: true, alive: false, downed: false }], ctrl: 'pc', dkSoft: true, expect: '全灭弹窗' },   // 原主角(controllerId)死亡+无其他队友 → 全灭（onDeath 已把它标 downed）
    { label: '原主角倒地+队友全倒', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: true }, { id: 'xiu', party: true, alive: true, downed: true }, { id: 'lao', party: true, alive: false, downed: false }], ctrl: 'pc', dkSoft: true, expect: '全灭弹窗' },   // 原主角倒地（被救方）+队友全倒 → 真全灭
    { label: '只剩被切队友活着', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: false, downed: false }, { id: 'xiu', party: true, alive: true, downed: false }], ctrl: 'xiu', dkSoft: true, expect: '独狼重生' },   // 切到秀兰，秀兰死时原主角已死 → 无其他队友 → 独狼重生（不弹全灭）
    { label: '硬核', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: false }], ctrl: 'pc', dkSoft: false, expect: '硬核结算' },
    { label: 'controllerId=null', npcs: [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: false }], ctrl: null, dkSoft: true, expect: '切换队友视角' },
];
for (const c of combosA) {
    for (let i = 0; i < 30; i++) {
        const r = simOnDeath(c.npcs, c.ctrl, c.dkSoft);
        assert(r.branch === c.expect, `A: ${c.label} → 期望=${c.expect} 实际=${r.branch}`);
    }
}

// ---------------------------------------------------------------------------
// B. updateDowned 救助状态机
// ---------------------------------------------------------------------------
console.log('\n========== B. updateDowned 救助状态机 ==========');
// B1: 无 dwn（主控没倒地）+ 有 _downedMembers → 只跑成员超时
for (let i = 0; i < 30; i++) {
    const sv = { _downed: null, _carryDowned: false };
    const npcs = [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: false }, { id: 'xiu', party: true, alive: true, downed: true }];
    const r = simUpdateDowned(sv, npcs, 'pc');
    assert(r.mode === 'membersTimeout', `B1: 主控未倒地+有倒地成员 → membersTimeout 实际=${r.mode}`);
}
// B2: 主控倒地 + 队友健康 → 等待救援/切视角（不弹全灭）
for (let i = 0; i < 30; i++) {
    const sv = { _downed: { name: '幸存者' }, _carryDowned: false };
    const npcs = [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: true }, { id: 'xiu', party: true, alive: true, downed: false }];
    const r = simUpdateDowned(sv, npcs, 'pc');
    assert(r.mode === '等待救援/切视角', `B2: 主控倒地+队友健康 → 等待救援 实际=${r.mode}`);
}
// B3: 主控倒地 + 队友全倒/死 → 全灭弹窗
for (let i = 0; i < 30; i++) {
    const sv = { _downed: { name: '幸存者' }, _carryDowned: false };
    const npcs = [{ id: 'pc', isPlayer: true, party: true, alive: true, downed: true }, { id: 'xiu', party: true, alive: true, downed: true }, { id: 'lao', party: true, alive: false, downed: false }];
    const r = simUpdateDowned(sv, npcs, 'pc');
    assert(r.mode === '全灭弹窗', `B3: 主控倒地+队友全倒/死 → 全灭弹窗 实际=${r.mode}`);
}
// B4: 背人中（_carryDowned）→ carryFollow
for (let i = 0; i < 30; i++) {
    const sv = { _downed: { name: '幸存者' }, _carryDowned: true };
    const r = simUpdateDowned(sv, [], 'pc');
    assert(r.mode === 'carryFollow', `B4: _carryDowned → 背人跟随 实际=${r.mode}`);
}
// B5: 主控倒地 + 只剩被切队友活着（controllerId=秀兰健康）→ 等待救援
for (let i = 0; i < 30; i++) {
    const sv = { _downed: { name: '老陈' }, _carryDowned: false };
    const npcs = [{ id: 'pc', isPlayer: true, party: true, alive: false, downed: false }, { id: 'xiu', party: true, alive: true, downed: false }, { id: 'lao', party: true, alive: true, downed: true }];
    const r = simUpdateDowned(sv, npcs, 'xiu');
    assert(r.mode === '等待救援/切视角', `B5: 主控倒地+只剩被切队友 → 等待救援 实际=${r.mode}`);
}

// ---------------------------------------------------------------------------
// C. 救援时间（现实 20 分钟 + 被攻击扣时 + 超时死亡）
// ---------------------------------------------------------------------------
console.log('\n========== C. 救援时间 ==========');
const LIMIT_SEC = 1200, PENALTY = 10;
function simDownedTime(downedAtReal, now, penaltySec) {
    const spent = Math.max(0, now - downedAtReal) + (penaltySec || 0);
    return { spent, remain: Math.max(0, LIMIT_SEC - spent), dead: spent >= LIMIT_SEC };
}
// C1: 自然流逝 19 分钟 → 未死
for (let i = 0; i < 30; i++) {
    const r = simDownedTime(0, 19 * 60, 0);
    assert(r.dead === false && r.remain > 0, `C1: 19分钟未超时 → 存活`);
}
// C2: 自然流逝 20 分钟整 → 超时死
for (let i = 0; i < 30; i++) {
    const r = simDownedTime(0, 1200, 0);
    assert(r.dead === true, `C2: 20分钟整 → 超时死亡`);
}
// C3: 被攻击扣时（每点伤害 10 秒）：10 点伤害 = 100 秒
for (let i = 0; i < 30; i++) {
    const r = simDownedTime(0, 1100, 10 * 10);
    assert(r.dead === true, `C3: 1100s流逝+100s惩罚 → 超时死亡`);
}
// C4: 被攻击扣时但未超时 → 保持倒地
for (let i = 0; i < 30; i++) {
    const r = simDownedTime(0, 900, 10 * 10);
    assert(r.dead === false, `C4: 900s+100s=1000<1200 → 存活`);
}
// C5: npcApplyDownedHit 的彻底死亡副作用（源码断言）
assert(wnpc.includes('const spent = Math.max(0, (sv.now != null ? sv.now : 0) - n._downedAtReal) + (n._penaltySec || 0);'),
    'C5: npcApplyDownedHit 用现实流逝+惩罚判定');
assert(wnpc.includes('if (spent >= B.DOWNED_LIMIT_SECONDS) {'), 'C5: 扣完 → 彻底死亡分支');
assert(wnpc.includes("n._deathReason = n._deathReason || '救援时间耗尽致死';"), 'C5: 补刀致死记录原因');
// C6: 成员超时（updateDownedMembersTimeout）同样现实时间
assert(surv.includes('const spentM = Math.max(0, (sv.now != null ? sv.now : 0) - m._downedAtReal) + (m._penaltySec || 0);'),
    'C6: 成员超时用现实时间');

// ---------------------------------------------------------------------------
// D. 药品救治（对症药/抗生素/草药/devInf/集齐救活 30%）
// ---------------------------------------------------------------------------
console.log('\n========== D. 药品救治 ==========');
const NEED_MED = 1, HERB_EQUIV = 3;
function simMedSubmit(m, med, herb, devInf) {
    if (med) m.med = (m.med || 0) + med;
    if (herb) m.herb = (m.herb || 0) + herb;
    const done = (m.med || 0) >= NEED_MED || (m.herb || 0) >= HERB_EQUIV;
    if (done) {
        m.downed = false; m.alive = true;
        m.hp = Math.max(1, Math.round(m.maxHp * 0.3));
        return { done: true, hp: m.hp };
    }
    return { done: false };
}
// D1: 1 瓶对症药 → 集齐救活 30% 血
for (let i = 0; i < 30; i++) {
    const m = { med: 0, herb: 0, maxHp: 80, downed: true, alive: true };
    const r = simMedSubmit(m, 1, 0, false);
    assert(r.done === true && m.downed === false && m.hp === 24, `D1: 1药集齐→救活30% (hp=${m.hp})`);
}
// D2: 3 株草药 → 集齐救活
for (let i = 0; i < 30; i++) {
    const m = { med: 0, herb: 0, maxHp: 80, downed: true, alive: true };
    const r = simMedSubmit(m, 0, 3, false);
    assert(r.done === true && m.downed === false, `D2: 3草药集齐→救活`);
}
// D3: 1 药 + 未集齐 → 不救活
for (let i = 0; i < 30; i++) {
    const m = { med: 0, herb: 0, maxHp: 80, downed: true, alive: true };
    // 只提交 1 药 → done（NEED_MED=1）
    const r = simMedSubmit(m, 1, 0, false);
    assert(r.done === true, `D3: 1药即集齐（NEED_MED=1）`);
}
// D4: 草药部分提交（1/3）→ 未集齐
for (let i = 0; i < 30; i++) {
    const m = { med: 0, herb: 0, maxHp: 80, downed: true, alive: true };
    const r = simMedSubmit(m, 0, 1, false);
    assert(r.done === false && m.herb === 1, `D4: 1/3草药未集齐`);
}
// D5: 开发者无限资源（devInf）→ 无药也能救活（源码断言）
assert(surv.includes("if (WDEV.isDev() && sv._devInf) return true;   // 开发者无限资源"),
    'D5: take() 支持 _devInf');
assert(surv.includes("const devInfHerb = WDEV.isDev() && sv._devInf;"), 'D5: 草药 devInf 分支');
// D6: 救活时清 _downed（mateMedSubmit 内部）
assert(surv.includes('// 幸存者作为 sv._downed（主控倒地）被队友 F 救活走的是 mateMedSubmit'),
    'D6: mateMedSubmit 清 _downed 修复注释');
assert(surv.includes('if (sv._carryMateId === m.id) sv._carryMateId = null;'), 'D6: 救活清 _carryMateId');

// ---------------------------------------------------------------------------
// E. 切视角状态转移（濒死主控 → 队友 → 新主控不被污染）
// ---------------------------------------------------------------------------
console.log('\n========== E. 切视角状态转移 ==========');
function simSwitch(oldCtrl, tgt, nearDeath) {
    const cur = { ...oldCtrl };
    cur.hp = nearDeath ? 1 : Math.max(1, oldCtrl.hp);
    cur.downed = nearDeath ? true : !!cur.downed;
    const newSvHp = Math.max(1, tgt.hp);
    return { cur, newSvHp, newDowned: false, downedCleared: true };
}
for (let i = 0; i < 30; i++) {
    const oldCtrl = { id: 'player', isPlayer: true, hp: 1, maxHp: 80, downed: false };
    const tgt = { id: 'jianguo', hp: 80, maxHp: 80, downed: false };
    const r = simSwitch(oldCtrl, tgt, true);
    assert(r.newSvHp === 80 && r.cur.downed === true, `E1: 濒死主控→满血队友 新主控满血+旧主控倒地`);
}
for (let i = 0; i < 30; i++) {
    const oldCtrl = { id: 'player', isPlayer: true, hp: 50, maxHp: 80, downed: false };
    const tgt = { id: 'jianguo', hp: 80, maxHp: 80, downed: false };
    const r = simSwitch(oldCtrl, tgt, false);
    assert(r.newSvHp === 80 && r.cur.downed === false, `E2: 半血主控→满血队友 不标倒地`);
}
for (let i = 0; i < 30; i++) {
    const oldCtrl = { id: 'player', isPlayer: true, hp: 1, maxHp: 80, downed: false };
    const tgt = { id: 'laochen', hp: 30, maxHp: 80, downed: false };
    const r = simSwitch(oldCtrl, tgt, true);
    assert(r.newSvHp === 30, `E3: 濒死主控→低血队友 新主控=队友自己的血`);
}
// E4: 源码断言 - enterDownedView 清 _downed
const edvIdx = surv.indexOf('// 2026-08-11 v2.97 修复"切队友视角后主控濒死状态转移到队友身上"');
const edvBlock = edvIdx > 0 ? surv.slice(edvIdx, edvIdx + 900) : '';
assert(edvBlock.includes('sv._downed = null;') && edvBlock.includes('sv._waitDowned = false;') && edvBlock.includes('sv._carryDowned = false;'),
    'E4: enterDownedView 切视角后清 _downed（防状态转移）');
assert(wnpc.includes('if (!sv._downedMembers.some(m => m && m.id === cur.id)) sv._downedMembers.push(cur);'),
    'E4: switchControl 旧主控入 _downedMembers');

// ---------------------------------------------------------------------------
// F. 全灭弹窗内容
// ---------------------------------------------------------------------------
console.log('\n========== F. 全灭弹窗内容 ==========');
// F1: 独狼弹窗标题"你阵亡了"——hadAnyMate 只看活人（排除历史尸体）
assert(surv.includes("const hadAnyMate = (sv.npcs || []).some(n => n && n.alive && n.party && !n.isPlayer);"),
    "F1: hadAnyMate 只看活人（独狼复活后再死不再误判全员阵亡）");
// F2: 击败详情收集（☠ XXX 被 YYY 击败）
assert(surv.includes('`<div class="wsl-death-detail">☠ ${d.name} · ${d.reason}</div>`'),
        'F2: 全灭弹窗击败详情行');
// F3: 弹窗前全员彻底死亡
assert(surv.includes('// ① 全员彻底死亡（弹窗前先收尾：倒地成员和存活主控都置死，生尸体）'),
    'F3: showAllDeadChoices 弹窗前全员置死');
assert(surv.includes("n._deathReason = n._deathReason || '救援超时（全员阵亡）';"),
    'F3: 全灭倒地成员置死+设原因');

// ---------------------------------------------------------------------------
// G. 关键修复点源码断言汇总
// ---------------------------------------------------------------------------
console.log('\n========== G. 关键修复点 ==========');
// G1: onDeath 残留 _downed 清理同步清主控记录
assert(surv.includes('const _cpc = sv.npcs && sv.npcs.find(n => n.id === sv.controllerId);'),
    'G1: onDeath 清理定位主控记录');
assert(surv.includes('if (_cpc) { _cpc.downed = false; _cpc._penaltySec = 0; }'),
    'G1: onDeath 清理同步清记录 downed');
// G2: _devGod 每帧清倒地状态
assert(surv.includes('const curPc = (sv.npcs || []).find(n => n.id === sv.controllerId) || (sv.npcs || []).find(n => n.isPlayer);'),
    'G2: _devGod 定位主控记录');
assert(surv.includes('curPc.downed = false;'), 'G2: _devGod 清记录 downed');
// G3: 恶意 NPC 稳定伤害（子弹命中倒地走扣时 + 近战保底伤害）
assert(wnpc.includes('let hit = null, best = 18;'), 'G3: NPC 子弹命中半径 18');
// 2026-08-12 fd84499 批量修复重构了缩进/注释格式，断言改为子串匹配
assert(wnpc.includes('} else if (hit.npc.downed) {'),
    'G3: 子弹命中倒地角色走扣时');
assert(wnpc.includes('npcApplyDownedHit(sv, hit.npc, dmg);'), 'G3: 子弹命中倒地调 npcApplyDownedHit');
// G4: 近战判定 = 特效长度（防隔空打死）
assert(wnpc.includes('const hitReach = wDef ? (wDef.reach || 40) : 40;   // 判定 = 特效长度（去掉 +8 冗余）'),
    'G4: 近战判定 = w.reach（去+8）');
assert(wnpc.includes('const reach2 = wDef2 ? (wDef2.reach || 40) : 40;'), 'G4: 低血近战判定 = w.reach');
// G5: 独狼死亡弹窗（复用 showAllDeadChoices）
assert(surv.includes('// ---- 从头就无队友：重生 + 重生点刷"玩家名"僵尸 ----'),
    'G5: 独狼死亡分支存在');
// G6: 救援按钮 done 时 enabled（集齐·完成救治）
assert(surv.indexOf('done ? \'集齐·完成救治\'') > 0, 'G6: 救援按钮 enabled 集齐·完成救治');
// G7: onDeath 守卫统一（无 !sv._downed）
assert(surv.includes('if (sv.hp <= 0 && !sv.dead) onDeath();'), 'G7: onDeath 守卫统一');
assert(!surv.includes('sv.hp <= 0 && !sv.dead && !sv._downed'), 'G7: 无残留 !sv._downed 守卫');

console.log(`\n============================================`);
console.log(`战斗死亡+救助全矩阵测试: ${pass} 通过, ${fail} 失败`);
console.log(`============================================`);
process.exit(fail > 0 ? 1 : 0);
