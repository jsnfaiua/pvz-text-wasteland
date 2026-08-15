// ============================================================================
// 荒原模组 · 统一测试入口（v3.28）
// 一个命令跑全部测试：node dev-tools/test-all.mjs
//
// 内联模块（静态源码检查，合并自 v3.21~v3.27 分散脚本）：
//   [1] unbound 扫描  - 转发导出漏 import / import*as 成员不存在（ReferenceError/TypeError 风险）
//   [2] 已删常量残留  - v3.19 移除的常量/函数无残留引用 + wwordcraft.js 重导出可达性
//   [3] 跨场景/交互   - 濒死/尸体跨场景不跟随 + 渲染/尸变/交互按房间楼层过滤 + 交互优先级
//   [4] 开发者全满    - setAllStatsFull 不误救濒死队友
//   [5] 救助界面 UI   - 防闪烁/防点击丢失（节流不重建 DOM）
//
// 子进程调度（运行时测试，独立文件保留便于单独排查）：
//   [6] smoke-test.js        基础冒烟 629 项
//   [7] global-drop-test.mjs 掉落全局权重 30 项
//   [8] recipe-flow-test.mjs 配方流程 17 项
//   [9] loot-rp-matrix.mjs   真实玩家×开发者×全矩阵 1971 项
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASTELAND = path.join(projRoot, 'source-code/mod-wasteland');
const read = f => fs.readFileSync(path.join(WASTELAND, f), 'utf8');
const readAbs = p => fs.readFileSync(p, 'utf8');
const stripComments = s => s.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n').replace(/\/\/.*$/gm, '');
const resolveTarget = (fromFile, target) => target.startsWith('.') ? path.resolve(path.dirname(fromFile), target) : null;

// ---------------- 统一 runner ----------------
const MODULES = [];
let cur = null;
function module(name) { cur = { name, pass: 0, fail: 0 }; MODULES.push(cur); }
function assert(c, m) { if (c) cur.pass++; else { cur.fail++; console.error(`  X [${cur.name}] ${m}`); } }
function sub(name, relFile) {
    const abs = path.join(projRoot, 'dev-tools', relFile);
    const r = spawnSync(process.execPath, [abs], { stdio: 'inherit', encoding: 'utf8' });
    module(name);
    assert(r.status === 0, `${name} 退出码 ${r.status}（预期 0）`);
    if (r.signal) assert(false, `${name} 被信号终止 ${r.signal}`);
}

// ================= [1] unbound 扫描 =================
// Check1: export { X } from './Y' 转发的名字被裸调用但漏 import → ReferenceError
// Check2: import * as X from './Y' 的 X.<name> 必须真实存在于 Y 导出
function exportsOf(absFile) {
    const set = new Set();
    if (!fs.existsSync(absFile)) return set;
    const code = stripComments(readAbs(absFile));
    let m;
    const re1 = /\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g;
    while ((m = re1.exec(code)) !== null) set.add(m[1]);
    const re2 = /\bexport\s*\{([^}]+)\}\s*(?:from\s*['"][^'"]+['"])?/g;
    while ((m = re2.exec(code)) !== null) {
        for (const item of m[1].split(',').map(s => s.trim()).filter(Boolean)) set.add(item.split(/\s+as\s+/)[0].trim());
    }
    return set;
}
module('unbound 扫描');
{
    const files = fs.readdirSync(WASTELAND).filter(f => f.endsWith('.js'));
    for (const f of files) {
        const absFile = path.join(WASTELAND, f);
        const src = readAbs(absFile);
        const body = stripComments(src);
        // 收集命名 import
        const importMap = new Map();
        let m;
        const namedRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
        while ((m = namedRe.exec(src)) !== null) {
            const tAbs = resolveTarget(absFile, m[2]);
            if (!tAbs) continue;
            if (!importMap.has(tAbs)) importMap.set(tAbs, new Set());
            for (const item of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
                const parts = item.split(/\s+as\s+/).map(s => s.trim());
                importMap.get(tAbs).add(parts[0]);
                if (parts.length > 1) importMap.get(tAbs).add(parts[1]);
            }
        }
        // Check1 转发导出漏 import
        const reRe = /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
        while ((m = reRe.exec(src)) !== null) {
            const tAbs = resolveTarget(absFile, m[2]);
            if (!tAbs) continue;
            const imported = importMap.get(tAbs) || new Set();
            for (const item of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
                const n = item.split(/\s+as\s+/)[0].trim();
                const bareRe = new RegExp(`(^|[^\\w.])(${n})\\s*\\(`, 'g');
                if (bareRe.test(body)) {
                    const isLocalDef = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:function\\s+${n}\\b|(?:const|let|var)\\s+${n}\\b|async\\s+function\\s+${n}\\b)`).test(src);
                    if (!isLocalDef && !imported.has(n)) {
                        assert(false, `${f}: 转发导出 '${n}' 被裸调用但未 import（ReferenceError 风险）`);
                    }
                }
            }
        }
        // Check2 import*as 成员存在
        const aliasRe = /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
        while ((m = aliasRe.exec(src)) !== null) {
            const alias = m[1];
            const tAbs = resolveTarget(absFile, m[2]);
            if (!tAbs) continue;
            const exported = exportsOf(tAbs);
            const memRe = new RegExp(`\\b${alias}\\.([A-Za-z_]\\w*)`, 'g');
            let um;
            while ((um = memRe.exec(body)) !== null) {
                const member = um[1];
                if (member === 'default') continue;
                if (!exported.has(member)) {
                    assert(false, `${f}: ${alias}.${member} 不是 ${path.basename(tAbs)} 的导出（TypeError 风险）`);
                }
            }
        }
    }
    assert(true, '扫描完成：转发导出漏 import / import*as 成员不存在 均无违规');
}

// ================= [2] 已删常量残留 + 重导出可达性 =================
module('已删常量残留');
{
    const wcMain = read('wwordcraft.js');
    const requiredNames = ['rollGlobalLoot', 'globalLootQty', 'GLYPH_UNIVERSAL', 'GLYPH_UNIVERSAL_MAP'];
    const reExported = requiredNames.every(n => wcMain.includes(n));
    const surv = read('survival.js');
    const usesWWImport = /import\s*\*\s*as\s+WW\s+from\s*['"]\.\/wwordcraft(\.js)?['"]/.test(surv);
    const needs = requiredNames.filter(n => new RegExp(`\\bWW\\.${n}\\b`).test(surv));
    if (usesWWImport && needs.length) {
        const missing = needs.filter(n => !reExported);
        assert(missing.length === 0, `survival.js 经 wwordcraft.js 可访问 ${needs.join('/')}（缺: ${missing.join(',') || '无'}）`);
    }
    // v3.19 已删常量/函数无残留
    const removed = ['LOOT_CONTENTS', 'resolveLootItem', 'BOX_ROLL', 'rollSupplyLoot', 'rollWeaponLoot', 'rollMedicalLoot', 'rollMaterialLoot', 'rollCarLoot', 'rollTrashLoot', 'rollCardLoot', 'rollHydrantLoot', 'rollNewsLoot', 'rollTiresLoot', 'SURGERY_BOX_DROP_CHANCE'];
    const files = fs.readdirSync(WASTELAND).filter(f => f.endsWith('.js'));
    let residue = 0;
    for (const f of files) {
        const codeOnly = read(f).split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
        for (const name of removed) {
            const isDefinition = new RegExp(`(function\\s+${name}\\b|${name}\\s*=\\s*function|const\\s+${name}\\s*=|\\b${name}\\s*[:=]\\s*\\{)`).test(codeOnly);
            const isUsed = new RegExp(`\\b${name}\\b`).test(codeOnly) && !isDefinition;
            if (isUsed) { residue++; assert(false, `${f} 仍引用已删除的 ${name}`); }
        }
    }
    if (residue === 0) assert(true, 'v3.19 已删除常量/函数无残留引用');
}

// ================= [3] 跨场景 / 交互 / 渲染 / 尸变 =================
module('跨场景/交互');
{
    const ww = stripComments(read('windoor.js'));
    const svc = stripComments(read('survival.js'));
    const rr = stripComments(read('render.js'));
    // S1 跨场景不跟随（windoor.js）
    assert(ww.includes('n.interiorKey !== key'), 'S1.1 出房间按 interiorKey 过滤');
    assert(ww.includes('isMateDownedExit || (n._corpse && !n.downed)'), 'S1.2 出房间时队友濒死/尸体留在原房间');
    assert(ww.includes('const isMateDownedEnter = Array.isArray(sv._downedMembers) && sv._downedMembers.some(x => x === n);'), 'S1.3 进房间时队友濒死不跟进');
    assert(ww.includes('const isMateDownedFloor = Array.isArray(sv._downedMembers) && sv._downedMembers.some(x => x === n);'), 'S1.4 换层时队友濒死留在原楼层');
    assert(ww.includes('if (!n.alive || n.riding) continue;'), 'S1.5 尸体本就跳过进房逻辑');
    // S2 交互优先级 救治队友>倒地主控>尸体>容器
    const mateFirst = svc.indexOf('if (downedMatePrompt) { sv.promptTarget = downedMatePrompt.target;');
    const downedFirst = svc.indexOf('if (downedPrompt) { sv.promptTarget = downedPrompt.target;');
    const corpseFirst = svc.indexOf('if (corpseBest) { sv.promptTarget = { corpse: corpseBest.id };');
    const bestLast = svc.indexOf('sv.promptTarget = best;', corpseFirst);
    assert(mateFirst >= 0 && downedFirst > mateFirst && corpseFirst > downedFirst && bestLast > corpseFirst, 'S2 交互优先级 救治队友>倒地主控>尸体>容器');
    // S3 消防栓取水
    assert(svc.includes('从消防栓里取了一点水'), 'S3 消防栓文案：取了一点水');
    // S4 救援/超时链路完整
    assert(svc.includes('updateDownedMembersTimeout') && svc.includes('spentM >= mLimit'), 'S4.1 队友超时判定存在');
    assert(svc.includes('mateMedSubmit') && svc.includes('_downedMembers.filter(x => x !== m)'), 'S4.2 救活后移除记录');
    assert(svc.includes('downedMedSubmit') && svc.includes('sv._downed = null'), 'S4.3 主控救活后清 _downed');
    // S5 渲染按房间/楼层过滤
    assert(rr.includes('if (n._corpse && !n.inInterior)'), 'S5.1 室外渲染跳过室内尸体');
    assert(rr.includes('n.interiorKey === curRoom') && rr.includes('interiorFloor == null ? 1 : n.interiorFloor) === curFloor'), 'S5.2 室内渲染只画当前房间+楼层');
    assert(rr.includes('if (n.inInterior) continue;'), 'S5.3 室外存活 NPC 由室内渲染绘制');
    // S6 尸变按房间/楼层过滤
    assert(svc.includes('n.interiorKey !== sv.interior.key'), 'S6.1 尸变只处理当前房间');
    assert(svc.includes('nf !== sv.interior.floor'), 'S6.2 尸变只处理当前楼层');
    // S7 交互限房间/楼层
    const mateRoom = (svc.match(/m\.interiorKey === sv\.interior\.key/g) || []).length;
    const nRoom = (svc.match(/n\.interiorKey === sv\.interior\.key/g) || []).length;
    assert(mateRoom === 1, `S7.1 救治队友检测限当前房间/楼层（命中 ${mateRoom}）`);
    assert(nRoom === 2, `S7.2 命令/尸体搜索检测限当前房间/楼层（命中 ${nRoom}）`);
    assert(svc.includes('n.interiorFloor == null ? 1 : n.interiorFloor) === sv.interior.floor'), 'S7.3 交互限当前楼层');
    // S8 室内也处理室外尸变（v3.30：时间加速时室外尸变不卡住，生成室外丧尸 + 提示）
    assert(svc.includes('sv._worldZombies = worldZombies;'), 'S8.1 室内模式向尸变检测传递室外世界僵尸数组引用');
    assert(svc.includes('indoor && !n.inInterior'), 'S8.2 室内模式放行室外尸体尸变');
    assert(svc.includes('sv._worldZombies || savedZ'), 'S8.3 室外尸体尸变切室外数组生成（防瞬移）');
    assert(svc.includes('sv.interior = savedI'), 'S8.4 尸变后恢复室内上下文');
    // S9 室外也处理室内尸变（v3.31：室外时间加速时室内尸变不卡住，转存房间存档 + 提示）
    assert(svc.includes('const fkey = (n.interiorKey || \'room\') + \':\' + (n.interiorFloor == null ? 1 : n.interiorFloor);'), 'S9.1 室外模式对室内尸体构造房间存档 key');
    assert(svc.includes('corpseReviveZombie(sv, n, fkey)'), 'S9.2 室外模式室内尸体尸变传 roomKey');
    assert(svc.includes('function corpseReviveZombie(sv, n, roomKey)'), 'S9.3 corpseReviveZombie 支持 roomKey');
    assert(svc.includes('sv.mods.interiors[roomKey].zombies.push'), 'S9.4 尸变丧尸转存房间存档 zombies');
    assert(svc.includes('_reviveFromCorpse: true, _reviveCorpseName: name'), 'S9.5 房间存档丧尸保留尸变标记');
    // S9.6 已清剿房间重置 cleared（v3.33：出房后室外尸变转存丧尸，进房若不重置 cleared 丧尸不恢复）
    assert(svc.includes('else if (room.cleared) room.cleared = 0;'), 'S9.6 转存时重置已清剿房间 cleared=0（防丧尸消失）');

    // S10 HUD 不重叠 + 天气影响所有生物（v3.32 起两行；v3.63 用户要求"时间/地区/季节/天气合并到一排"）
    const renderSrc2 = read('render.js');
    const rr2 = stripComments(renderSrc2);
    // v3.63 季节+天气与天数/时间/区域合并到 y=17 一排（用户反馈"分两行太分开"），同时仍包含天气色分段
    assert(rr2.includes("ctx.fillText(`第 ${sv.day} 天  ${hh}:${mm}  [${dName}]  [${seasonName}] · ${wxName}`, 232, 17);"),
        'S10.1 季节+天气与天数/时间/区域合并到 y=17 一排（v3.63 用户需求）');
    assert(!rr2.includes("`[${seasonName}]${wxLabel}`, 232, 32"), 'S10.2 旧版 y=32 第二行已移除（v3.63 合并到一排）');
    // 天气影响所有生物：wzombie 室外主移速/window 室内僵尸/wnpc NPC 三处都用 wxMoveMul
    const wz = stripComments(read('wzombie.js'));
    const wn = stripComments(read('wnpc.js'));
    const wd = stripComments(read('windoor.js'));
    assert(wz.includes('const wxMoveSpd = B.wxMoveMul(sv._weather, B.wxLevelCur(sv));') && wz.includes('B.PACK_FOLLOW_SPEED_MUL * wxSpd'), 'S10.3 wzombie 室外 pack 跟随 + 主移速应用 wxMoveMul');
    assert(wz.includes('mvx * spd * slowFactor * wxMoveSpd * dt'), 'S10.4 wzombie 室外主移动应用 wxMoveSpd');
    assert(wn.includes('const wxMoveSpd = B.wxMoveMul(sv._weather, B.wxLevelCur(sv));') && wn.includes('(n.exhausted ? 0.6 : 1) * wxMoveSpd'), 'S10.5 wnpc NPC 移速应用 wxMoveMul');
    assert(wd.includes('const wxMoveSpd = B.wxMoveMul(sv._weather, B.wxLevelCur(sv));') && wd.includes('mvx * spd * slowFactor * wxMoveSpd * dt'), 'S10.6 windoor 室内僵尸移速应用 wxMoveMul');
}

// ================= [3b] 室内尸体搜索与室外一致（v3.36） =================
module('室内尸体搜索');
{
    const svc = stripComments(read('survival.js'));
    // S11 室内尸体搜索（doInteriorInteract）与室外 tg.corpse 分支同一套逻辑：
    //   ① 不再要求 !_corpseSearched（普通尸体搜完保留、可反复打开空界面续搜）；
    //   ② 过滤条件用 n.downed（排除濒死待救）而非 n._corpseSearched；
    //   ③ 限当前房间/楼层（n.interiorKey === it.key）；
    //   ④ onClose 区分普通尸体（掏空保留）与尸变尸体（掏空才消失）。
    // 室外 updatePrompt（1 处）+ 室内 prompt（1 处）+ 室内交互（1 处）都用同款过滤 → 3 处
    assert((svc.match(/if \(!n \|\| !n\._corpse \|\| n\.downed\) continue;/g) || []).length >= 3, 'S11.1 室内外尸体搜索统一过滤（n.downed，不再用 n._corpseSearched）');
    // v3.40 扫描面板也复用同款房间/楼层过滤（室内 prompt + 交互 + 扫描面板 = 3 处），一致性更好
    assert((svc.match(/n\.interiorKey === it\.key/g) || []).length >= 2, `S11.2 室内 prompt + 交互 + 扫描面板尸体搜索均限当前房间（命中 ${(svc.match(/n\.interiorKey === it\.key/g) || []).length}）`);
    assert((svc.match(/n\.interiorFloor == null \? 1 : n\.interiorFloor\) === \(it\.floor \|\| 1\)/g) || []).length >= 2, 'S11.3 室内 prompt + 交互 + 扫描面板尸体搜索均限当前楼层');
    // 室内 doInteriorInteract onClose：尸变尸体掏空 splice 移除（拿完才消失）
    // 2026-08-12 v3.40 抽取公共函数 openCorpseSearchUI（室外 tg.corpse / 室内 / 长按扫描面板共用）
    assert(svc.includes('function openCorpseSearchUI(c) {'), 'S11.4 公共尸体搜索函数 openCorpseSearchUI 存在（室内外/扫描面板共用）');
    assert(svc.includes('if (c._revivedCorpse) {'), 'S11.5 onClose 区分尸变尸体（掏空才消失）');
    assert(svc.includes('c._corpseContents = rest;') && svc.includes('c._corpseSearched = true;'), 'S11.6 公共 onClose 未拿走物品写回 + 普通尸体掏空标记保留（可反复打开）');
    assert((svc.match(/delete base\._rem;/g) || []).length >= 1, 'S11.7 公共 onClose 保留完整物品属性（写回 _corpseContents）');
}

// ================= [3c] 室内外主控/成员同步（v3.37） =================
module('室内外主控同步');
{
    const svc = stripComments(read('survival.js'));
    const wnp = stripComments(read('wnpc.js'));
    const wdo = stripComments(read('windoor.js'));
    // S12 主控状态在室内模式写回记录：大世界 updateNpcs 每帧 syncControlledToRecord，
    // 室内 updateInteriorMode 帧尾也要调用（否则主控室内掉血/拾取/移动不落盘，读档/切视角回退）
    assert(wnp.includes('export function syncControlledToRecord(sv, n)'), 'S12.1 syncControlledToRecord 已导出（室内模式可调用）');
    assert(svc.includes('const _ctrl = WNPC.controlledNpc(sv);') && svc.includes('if (_ctrl) WNPC.syncControlledToRecord(sv, _ctrl);'), 'S12.2 室内 updateInteriorMode 帧尾写回主控记录（掉血/拾取/移动落盘）');
    // S12.3 非 follow 状态主控进屋不被弹出：enterFollowers 对 controllerId/isPlayer 无条件带入
    assert(wdo.includes('const isCtrl = ((sv.controllerId && n.id === sv.controllerId) || n.isPlayer) && !n.inInterior;'), 'S12.3 enterFollowers 对主控记录无条件带入（guard/camp 状态主控进屋不被 syncControllerInterior 弹出）');
    // S12.4 室内切到室外队友不污染房间坐标：switchControl 仅目标在室内才写回 it.px/it.py
    assert(wnp.includes('if (sv.interior && tgt.inInterior) { sv.interior.px = sv.px; sv.interior.py = sv.py; }'), 'S12.4 切视角仅目标在室内才同步房间坐标（室外队友不污染 it.px）');
    // S12.5 室内模式帧尾写回须在 it.px/it.py 同步之后（房间坐标与记录一致）
    // stripComments 会剔除 // 注释行，故用代码锚点（const _ctrl 行）而非注释定位
    const imIdx = svc.indexOf('const _ctrl = WNPC.controlledNpc(sv);');
    const wbIdx = svc.indexOf('if (_ctrl) WNPC.syncControlledToRecord(sv, _ctrl);');
    assert(imIdx >= 0 && wbIdx > imIdx, 'S12.5 主控写回位于室内坐标同步之后（房间/记录坐标一致）');
}

// ================= [3d] 室内初始主控倒地→超时死亡→尸体→尸变→尸变丧尸→尸变尸体→搜索消失（v3.38） =================
module('室内主控倒地尸变链路');
{
    const svc = stripComments(read('survival.js'));
    const wnp = stripComments(read('wnpc.js'));
    const wdo = stripComments(read('windoor.js'));
    // S13.1 初始主控（isPlayer）切视角后在 _downedMembers 中，超时死亡【无条件】生成 _corpse 尸体
    //（updateDownedMembersTimeout 4371-4391 分支不带 isPlayer 排除——与原地等待路径 4258 的
    //"isPlayer 不补尸体"不同，切视角路径必须有尸体，否则初始主控濒死后无尸可搜/无尸可尸变）
    assert(svc.includes('m._corpse = true;') && svc.includes('m._corpseSearched = false;'), 'S13.1 成员超时死亡生成 _corpse 尸体（含初始主控 isPlayer，切视角路径无条件）');
    // S13.2 补刀致死路径也生成 _corpse：npcApplyDownedHit 救援时间扣完 → 生尸体可搜索
    assert(wnp.includes('n._corpse = true;') && wnp.includes('n._corpseSearched = false;'), 'S13.2 补刀扣完救援时间 → 生成 _corpse 尸体（濒临死亡→尸体）');
    // S13.3 室内模式驱动尸体尸变：updateCorpseRevive(sv, dt, 'indoor') 只尸变当前房间+楼层
    assert(svc.includes("updateCorpseRevive(sv, dt, 'indoor')"), 'S13.3 室内循环驱动尸变检测（indoor 模式）');
    assert(svc.includes('n.interiorKey !== sv.interior.key') && svc.includes('nf !== sv.interior.floor'), 'S13.4 室内尸变限当前房间+楼层（初始主控尸体同房同层才尸变）');
    // S13.5 室内尸变丧尸被击败 → 生成「XX（尸变）」尸体（inInterior: true + interiorKey = 当前房间）
    assert(wdo.includes('_revivedCorpse: true') && wdo.includes('inInterior: true, interiorKey: it.key, interiorFloor: it.floor || 1'), 'S13.5 室内尸变丧尸被击败生成室内尸变尸体（可搜索、掏空消失）');
    // S13.6 室内搜索尸变尸体：onClose 区分 _revivedCorpse 掏空 splice 移除（搜索完消失）
    // v3.40 起尸体搜索走公共函数 openCorpseSearchUI（室内外一致，onClose 用 c._revivedCorpse）
    const searchSeg = svc.indexOf('if (c._revivedCorpse) {');
    assert(searchSeg >= 0 && svc.indexOf('sv.npcs.splice(idx, 1)', searchSeg) > searchSeg && svc.indexOf('c._corpseContents = rest;', searchSeg) > searchSeg, 'S13.6 室内尸变尸体掏空才 splice 移除、未掏空写回续搜');
}

// ================= [3e] 队伍成员捡物品数量守恒 + 室内掉落可拾（v3.39） =================
module('成员拾取数量守恒');
{
    const wnp = stripComments(read('wnpc.js'));
    const svc = stripComments(read('survival.js'));
    // S14.1 成员拾取部分装下不再 splice 整个掉落：addItemObj 返回剩余数量，left<=0 才移除，
    // left>0 时剩余数量写回掉落（best.n = left）留在原地可再捡（与玩家拾取 left<=0 移除一致）
    assert(wnp.includes('if (left <= 0) {') && wnp.includes('best.n = left;') && wnp.includes('best._claimId = null; best._claimT = 0;'), 'S14.1 成员拾取部分装下剩余数量写回掉落（不再 splice 消失）');
    // S14.2 玩家拾取对比锚点：sv.drops 拾取用 left<=0 才移除（一致基准）
    const playerPick = svc.indexOf('const left = Panel.addItem(sv, d.id, d.n);');
    assert(playerPick >= 0 && svc.indexOf('if (left <= 0) { sv.drops.splice(i, 1); Panel.refresh(sv); }', playerPick) > playerPick, 'S14.2 玩家拾取 left<=0 才移除掉落（成员侧已对齐）');
    // S14.3 室内模式 sv.drops 临时指向 it.drops（成员室内可捡普通掉落；与 sv.zombies = it.zombies 同思路）
    assert(svc.includes('const worldDrops = sv.drops;') && svc.includes('sv.drops = Array.isArray(it.drops) ? it.drops : (it.drops = []);') && svc.includes('sv.drops = worldDrops;'), 'S14.3 室内模式 sv.drops 临时替换为 it.drops 并恢复（成员室内可拾取）');
    // S14.4 主控记录（isPlayer/初始主控）在室外拾取不被跳过：updateNpcs 只跳过当前 controller，旧主控走 followAI
    assert(wnp.includes('if (controller && n.id === controller.id) continue;'), 'S14.4 只跳过当前主控，旧主控/新招募成员均走拾取 AI');
}

// ================= [3f] 室内切室外队友带入房间 + 长按扫描面板（v3.40） =================
module('切视角保室内 + 长按扫描');
{
    const svc = stripComments(read('survival.js'));
    const wnp = stripComments(read('wnpc.js'));
    // S15.1 室内切视角到室外队友：switchControl 把目标带入当前房间（inInterior=true + 坐标映射出生点旁）
    // 否则下一帧 syncControllerInterior 检测 wantIn=false haveIn=true → exitInterior 弹室外 → 室内倒地队友没人救
    assert(wnp.includes('if (sv.interior && !tgt.inInterior) {') && wnp.includes('tgt.inInterior = true;') && wnp.includes('tgt.interiorKey = sv.interior.key || null;'), 'S15.1 切视角室外目标被带入当前房间（不再弹室外）');
    // S15.2 带入后目标坐标映射到房间出生点旁（与 summonTeammates 同款）
    assert(wnp.includes('const scx = (sv.interior.spawnX + 0.5) * TS, scy = (sv.interior.spawnY + 0.5) * TS;'), 'S15.2 带入目标坐标映射到房间出生点旁');
    // S15.3 长按 N 扫描面板：keydown 首次按下才计时（防 auto-repeat）+ 进度环满自动开门（_scanDone）+ keyup 兜底
    assert(svc.includes('if (!sv._scanHeld) {') && svc.includes('sv._scanKeyDownT = performance.now();') && svc.includes('if (sv._scanDone) {') && svc.includes('if (!auto && held >= 800 && !scanPanelOpen()'), 'S15.3 长按 N（v3.50 改 0.8s）首次计时 + 进度环满自动开门 + 松手兜底');
    // S15.4 扫描面板右上角叉号关闭 + ESC 关闭
    assert(svc.includes('id="wsl-scan-close"') && svc.includes("querySelector('#wsl-scan-close').addEventListener('click', closeScanPanel)"), 'S15.4 扫描面板右上角叉号可关闭');
    assert(svc.includes("if (k === 'escape' || k === getBind('interact')) { closeScanPanel(); return; }"), 'S15.5 扫描面板 ESC / 交互键可关闭');
    // S15.6 扫描面板收集室外/室内目标（容器/尸体/队友/楼梯）并点击执行交互
    assert(svc.includes('function openScanPanel()') && svc.includes('sv.promptTarget = { x: tx, y: ty, t }; doInteract();'), 'S15.6 扫描面板点击容器/地块目标 → 复用 doInteract 交互');
    assert(svc.includes('openCorpseSearchUI') && svc.includes('openInteriorBox(gx, gy)') && svc.includes("buildScanItem(dir > 0 ? '上楼' : '下楼'"), 'S15.7 扫描面板覆盖尸体搜索/室内箱子/楼梯目标');
}

// ================= [3g] 键位设置（v3.41）：映射表/持久化/录制/保存/恢复默认 =================
module('键位设置');
{
    const svc = stripComments(read('survival.js'));
    // S16.1 键位映射表：KEYBIND_DEFS 含主要功能（交互/攻击/换弹/切武器/背包/角色/建造/拼字台等）
    assert(svc.includes('const KEYBIND_DEFS = [') && svc.includes("{ act: 'interact', name: '交互 / 搜索 / 救治', def: 'f' }") && svc.includes("{ act: 'attack', name: '攻击', def: 'j' }"), 'S16.1 键位映射表定义（含交互/攻击默认键）');
    assert(svc.includes("{ act: 'scope', name: '瞄准', def: 'mouse2' }") && svc.includes("{ act: 'scan', name: '长按扫描周围', def: 'n' }"), 'S16.2 键位表含鼠标右键瞄准/长按扫描');
    // S16.3 持久化：getBind 读 saveData.keybinds、setBind 写 saveData.keybinds + writeSave
    assert(svc.includes('const kb = saveData.keybinds && saveData.keybinds[act];') && svc.includes('saveData.keybinds[act] = key;') && svc.includes('writeSave(saveData);'), 'S16.3 键位持久化（saveData.keybinds + writeSave）');
    // S16.4 keydown 查表驱动：各功能键用 getBind(...) 而非硬编码
    assert((svc.match(/k === getBind\('interact'\)/g) || []).length >= 1 && (svc.match(/k === getBind\('attack'\)/g) || []).length >= 1 && (svc.match(/k === getBind\('bag'\)/g) || []).length >= 1, 'S16.4 keydown 交互/攻击/背包查表驱动');
    // S16.5 录制：点击键位框 → keybindRecording 非空 → 按键绑定 / 回车取消
    assert(svc.includes('keybindRecording = { act };') && svc.includes('if (keybindRecording) {') && svc.includes("if (k === 'enter' || k === 'escape') { keybindRecording = null;"), 'S16.5 录制状态机（点击录制/按键绑定/回车取消）');
    // S16.6 鼠标侧键录制 + 触发：mousedown 录制分支 mouse+button、非左键绑定交互/攻击/扫描触发
    assert(svc.includes("const mb = 'mouse' + e.button;") && svc.includes('finishKeybindRecord(mb);') && svc.includes('mb === getBind(\'interact\')'), 'S16.6 鼠标侧键可录制并触发功能');
    // S16.7 UI：右上角叉号关闭 + 保存 + 恢复默认
    assert(svc.includes('id="wsl-kb-close"') && svc.includes("querySelector('#wsl-kb-close').addEventListener('click', closeKeybinds)"), 'S16.7 键位面板右上角叉号关闭');
    assert(svc.includes('id="wsl-kb-save"') && svc.includes('id="wsl-kb-reset"') && svc.includes('resetKeybinds();'), 'S16.8 键位面板保存 + 恢复默认按钮');
    // S16.9 暂停面板入口
    assert(svc.includes('id="wsl-p-keybinds"'), 'S16.9 暂停面板含键位设置入口');
    // S16.10 ESC 关闭键位面板（模态优先）
    assert(svc.includes('if (keybindOpen()) {') && svc.includes("if (k === 'escape') { closeKeybinds(); return; }"), 'S16.10 键位面板 ESC 可关闭');
}

// ================= [3h] 鼠标交互准心 + 8 方向朝向 + 长按扫描进度环/滚轮选择（v3.42） =================
module('鼠标准心与扫描升级');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    // S17.1 准心：v3.58 用户定稿移除红点准心/红箭头提示（保留空函数不破坏 draw），准星交互功能由 survival 承担
    assert(rnd.includes('function drawAimCrosshair(ctx, sv, W, H)') && !rnd.includes("ctx.fillStyle = '#FF3333';"), 'S17.1 准心提示已移除（drawAimCrosshair 空壳，无红点绘制）');
    // S17.2 render 内部准心可交互判定（模块解耦，不依赖 survival）
    assert(rnd.includes('function renderTileInteractable(sv, gx, gy)') && rnd.includes('function renderPointInteractable(sv, x, y)'), 'S17.2 render 内部准心可交互判定函数');
    // S17.3 8 方向朝向：facing8 由准心世界坐标-玩家位置 → 8 方向扇区；静止时驱动 faceX/faceY
    assert(svc.includes('sv.facing8 = Math.floor((deg + 45) / 90) % 4 * 2;') && svc.includes('function updateAimFacing(sv)'), 'S17.3 4 主方向 90° 扇区 facing8 计算 + updateAimFacing');
    assert(svc.includes('sv.faceX = f.x; sv.faceY = f.y;') && svc.includes('if (moving) return;'), 'S17.4 走路 WASD 移动方向优先、站立准星定朝向');
    assert(svc.includes('updateAimFacing(sv);'), 'S17.5 大世界帧尾 + 室内帧尾均调用 updateAimFacing');
    // S17.6 长按扫描进度环：keydown 设 _scanHeld，render 画顺时针绿色圆环，0.35s 满
    assert(svc.includes('sv._scanHeld = true;') && svc.includes('sv._scanHeldAt = sv._scanKeyDownT;'), 'S17.6 长按按下设置进度环状态');
    assert(rnd.includes('function drawScanProgressRing(ctx, sv, W, H)') && rnd.includes("(performance.now() - sv._scanHeldAt) / 800") && rnd.includes("strokeStyle = prog >= 1 ? '#39d98a' : '#4ade80'"), 'S17.7 进度圆环顺时针绿色加载（v3.50 改 0.8s 满）');
    // S17.8 空态淡入淡出 toast：showScanEmptyToast（无目标时淡入显示后淡出）
    assert(svc.includes('function showScanEmptyToast()') && svc.includes("scanToastEl.style.opacity = '1'") && svc.includes('scanToastEl.style.opacity = \'0\''), 'S17.8 空态淡入淡出提示（淡入 + 淡出）');
    // S17.9 滚轮选择：scanPanel wheel 事件切换选中 + 点击确认 + 叉号/ESC/交互键关闭
    assert(svc.includes("scanPanelEl.addEventListener('wheel'") && svc.includes('scanSel = (scanSel + (e.deltaY > 0 ? 1 : -1)') && svc.includes('id="wsl-scan-close"'), 'S17.9 滚轮切换选中 + 叉号关闭');
    assert(svc.includes('if (k === \'arrowup\') { scanSelMove(-1); return; }') && svc.includes('if (k === \'enter\') { scanSelConfirm(); return; }'), 'S17.10 扫描面板 ↑↓ 切换 + 回车确认');
    assert(svc.includes('if (!scanPanelItems.length) { showScanEmptyToast(); return; }'), 'S17.11 无目标时弹 toast 不弹面板');
}

// ================= [3i] 扫描只收"弹 UI"交互体 + 角色朝向纯鼠标驱动（v3.43） =================
module('扫描过滤与朝向');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    // S18.1 扫描面板 SCAN_UI_TILES：只收集"交互会弹 UI"的交互体（容器/门/床/车/消防栓/培养植物等）
    assert(svc.includes('const SCAN_UI_TILES = new Set([') && svc.includes('T.BOX, T.CABINET, T.DOOR, T.BED'), 'S18.1 SCAN_UI_TILES 定义（弹 UI 交互体集合）');
    // S18.2 纯采集类（草药/树/阳光/水/作物）不在 SCAN_UI_TILES（不弹 UI → 不进扫描列表）
    assert(svc.includes('const SCAN_UI_TILES = new Set([') && !svc.includes('T.HERB,') && !svc.includes('T.FLOWER,') && !svc.includes('T.WATER,'), 'S18.2 纯采集类不进扫描列表（草药/阳光/水）');
    // S18.3 室外扫描用 SCAN_UI_TILES 过滤（替代 INTERACT_LABEL 全量）
    assert(svc.includes('if (!SCAN_UI_TILES.has(t)) continue;'), 'S18.3 室外扫描按 SCAN_UI_TILES 过滤');
    // S18.4 render 准心高亮与扫描一致：AIM_INTERACT_TILES 含弹 UI 类型、不含纯采集
    assert(rnd.includes('AIM_INTERACT_TILES') && rnd.includes("'CABINET', 'DOOR', 'BED'") && !rnd.includes("'HERB', 'TREE'"), 'S18.4 render 准心高亮类型与扫描一致（弹 UI 交互体）');
    // S18.5 走路移动方向优先、站立准星定朝向（v3.44 回退局部）
    assert(svc.includes('function updateAimFacing(sv)') && svc.includes('if (moving) return;'), 'S18.5 移动中 WASD 优先、站立准星定朝向');
    // S18.6 大世界 + 室内帧尾都调用 updateAimFacing（移动后仍覆盖 → 鼠标主导）
    const uafCount = (svc.match(/updateAimFacing\(sv\);/g) || []).length;
    assert(uafCount >= 2, `S18.6 大世界+室内帧尾均调用 updateAimFacing（命中 ${uafCount}）`);
}

// ================= [3j] 准星优先交互（v3.46）：F 键优先交互准星指向格，N 扫描兜底 =================
module('准星优先交互');
{
    const svc = stripComments(read('survival.js'));
    // S19.1 室外 updatePrompt：准星指向格（3×3 内）可交互则优先，否则回退最近格
    assert(svc.includes('aimGx = Math.floor(mwx / TS); aimGy = Math.floor(mwy / TS);') && svc.includes('if (INTERACT_LABEL[t] && containerInteractable(t, aimGx, aimGy) && !(t === T.DOOR && builtAt(sv, aimGx, aimGy)))'), 'S19.1 室外 F 交互准星指向格优先');
    // S19.2 准星格超 3×3 则回退（准星只作用周围一格）
    assert(svc.includes('if (Math.abs(aimGx - Math.floor(ptx)) > 1 || Math.abs(aimGy - Math.floor(pty)) > 1) { aimGx = null; aimGy = null; }'), 'S19.2 准星格超 3×3 回退最近格');
    // S19.3 室内 prompt + doInteriorInteract 箱子选择准星优先（各 1 处 isBoxTile 判定 + aimPicked）
    assert((svc.match(/let aimPicked = false;/g) || []).length >= 2, 'S19.3 室内 prompt+执行均准星优先（aimPicked）');
    assert(svc.includes('const isBoxTile = (gx, gy) => {'), 'S19.4 室内 isBoxTile 复用判定');
    // S19.5 N 扫描仍是兜底（openScanPanel 存在、长按满自动开门）
    assert(svc.includes('function openScanPanel()') && svc.includes('if (sv._scanDone) {'), 'S19.5 N 扫描兜底仍在（进度环满自动开门）');
}

// ================= [3k] 长按扫描 auto-repeat 防抖 + 开门冷却（v3.47） =================
module('长按扫描防抖');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    // S20.1 keydown 仅首次按下才记录时刻（auto-repeat 重复 keydown 不再重置 _scanHeldAt → 进度环计时不被清零）
    assert(svc.includes('if (!sv._scanHeld) {') && svc.includes('sv._scanHeldAt = sv._scanKeyDownT;'), 'S20.1 长按首次按下才计时（auto-repeat 不重置进度环）');
    // S20.2 开门后 0.5s 冷却（防止按住不放 → 面板开关闪烁）
    assert(svc.includes('sv._scanCooldownUntil = performance.now() + 500;') && svc.includes('if (sv._scanCooldownUntil && performance.now() < sv._scanCooldownUntil) return;'), 'S20.2 开门后 0.5s 冷却防闪烁');
    // S20.3 圆环增强视觉反馈："扫描中…" 呼吸文字（v3.58 圆环缩小 50%，偏移 62→32）
    assert(rnd.includes("ctx.fillText('扫描中…', cx, cy + 32);") && rnd.includes('const pulse = 0.7 + 0.3 * Math.sin(sv.now * 6);'), 'S20.3 圆环增强反馈（扫描中… 呼吸文字）');
}

// ================= [3l] NPC 拾取认领保留 + 室内准星 camX 基准（v3.48） =================
module('拾取认领与室内准星');
{
    const wnp = stripComments(read('wnpc.js'));
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    // S21.1 部分装下保留认领（不再释放 → 防多 NPC 抢同一剩余抽搐）
    assert(wnp.includes('} else if (left >= (best.n || 1)) {') && wnp.includes('best._claimId = null; best._claimT = 0;') && wnp.includes('best.n = left;') && wnp.includes('best._claimT = now;'), 'S21.1 部分装下保留认领刷新 _claimT（完全装不下才释放）');
    // S21.2 室内准星基准 = sv.camX + m.x（render mouseWorld 不再用 it.px）
    assert(rnd.includes('const camX = sv.camX != null ? sv.camX : 0, camY = sv.camY != null ? sv.camY : 0;') && !rnd.includes('sv.interior.px + m.x'), 'S21.2 render mouseWorld 室内外统一 sv.camX+m.x（不用 it.px）');
    // S21.3 室内 prompt + 执行准星格计算均用 sv.camX+sv.mouse.x（v3.58 起两处都提取为 mwx 局部变量）
    const agxCount = (svc.match(/const mwx = \(sv\.camX != null \? sv\.camX : 0\) \+ sv\.mouse\.x;/g) || []).length;
    assert(agxCount >= 2, `S21.3 室内两处准星格计算均用 sv.camX+m.x（提取 mwx 命中 ${agxCount}）`);
}

// ================= [3m] 尸变尸体全场景一致性（v3.49）：普通尸体搜索不消失 / 尸变尸体拿完才消失 =================
module('尸变尸体全场景一致性');
{
    const svc = stripComments(read('survival.js'));
    const wdo = stripComments(read('windoor.js'));
    const wzb = stripComments(read('wzombie.js'));
    // S22.1 普通尸体（非 _revivedCorpse）掏空【不消失】：onClose 置 _corpseSearched 保留可反复打开
    //（用户：尸变前不管拿不拿/拿多少，尸体不消失，等 3 分钟尸变）
    assert(svc.includes('if (c._revivedCorpse) {') && svc.includes('c._corpseSearched = true;') && svc.includes('c._corpseSearchedDay = sv.day;'), 'S22.1 普通尸体掏空保留（_corpseSearched 标记可反复打开，等尸变）');
    // S22.2 尸变尸体背包空 → 关闭界面 → splice 消失；有物 → 拿了才消失
    const rcSeg = svc.indexOf('if (c._revivedCorpse) {');
    assert(rcSeg >= 0 && svc.indexOf('sv.npcs.splice(idx, 1)', rcSeg) > rcSeg && svc.indexOf('c._corpseContents = rest;', rcSeg) > rcSeg, 'S22.2 尸变尸体 onClose 掏空（rest 空）才 splice 消失、未掏空写回续搜');
    // S22.3 尸变尸体不二次尸变：updateCorpseRevive 跳过 _revivedCorpse
    assert(svc.includes('if (n._revivedCorpse) continue;'), 'S22.3 尸变尸体不二次尸变（updateCorpseRevive 跳过）');
    // S22.4 尸变丧尸被击败生成尸变尸体：室外（wzombie 内联）+ 室内（windoor 内联）+ 联机（reviveZombieToCorpse）
    assert(wzb.includes('_revivedCorpse: true') && wdo.includes('_revivedCorpse: true') && svc.includes('export function reviveZombieToCorpse(sv, z)'), 'S22.4 室内外+联机三处尸变丧尸死亡均生成尸变尸体');
    // S22.5 室内尸变尸体 inInterior:true + interiorKey:it.key（室内外场景字段一致）
    assert(wdo.includes('inInterior: true, interiorKey: it.key, interiorFloor: it.floor || 1'), 'S22.5 室内尸变尸体带房间标记（可室内搜索）');
    // S22.6 普通尸体 15 分钟尸变（未搜索/已搜索都尸变）——尸体 _corpseContents 物品守恒传给尸变丧尸
    assert(svc.includes('const contents = (n._corpseContents || []).filter(s => s && s.n > 0);') && svc.includes('z.inv = contents.map(s => ({ ...s }));'), 'S22.6 尸变丧尸背包 = 尸体未搜物品（守恒，被击败掉回尸变尸体）');
}

// ================= [3n] 室内外准星/朝向/扫描一致性 + 0.8s 扫描（v3.50） =================
module('室内外准星朝向扫描与0.8s时长');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    // S23.1 室内 facing8 准星朝向基准 = sv.camX+sv.mouse.x（不再用 it.px → 室内待机朝向跟随准星）
    // update() 中 facing8 计算的 wx/wy 统一 camX 基准（室内 sv.camX=-ox），不再有 sv.interior.px + sv.mouse.x 分支
    const facingSeg = svc.indexOf('const wx = (sv.camX != null ? sv.camX : 0) + sv.mouse.x;');
    assert(facingSeg >= 0 && svc.indexOf('sv.facing8 = Math.floor((deg + 45) / 90) % 4 * 2;') > facingSeg, 'S23.1 室内/室外 facing8 统一用 sv.camX+m.x 基准（待机朝向跟随准星）');
    assert(!svc.includes('sv.interior.px + sv.mouse.x'), 'S23.2 不再有 it.px+m.x 旧室内基准（全局清理）');
    // S23.3 v3.58 朝向指示红箭头已移除（用户定稿"不需要提示"），facing8 计算保留（角色朝向功能仍生效）
    assert(!rnd.includes("ctx.fillText('▲', ax, ay);"), 'S23.3 朝向红箭头提示已移除（facing8 功能保留）');
    // S23.4 长按扫描 0.8s：render 进度环 + keyup 兜底均 800ms（填充时间与长按时间一致）
    assert(rnd.includes('(performance.now() - sv._scanHeldAt) / 800') && svc.includes('if (!auto && held >= 800 && !scanPanelOpen()'), 'S23.4 长按扫描 0.8s（render 进度环 800ms + keyup 兜底 800ms 一致）');
    // S23.5 室内扫描面板仍收集箱子/楼梯（openScanPanel 室内分支存在）
    assert(svc.includes("buildScanItem('搜索箱子', () => openInteriorBox(gx, gy));") && svc.includes("buildScanItem(dir > 0 ? '上楼' : '下楼', () => WD.changeFloor(sv, dir));"), 'S23.5 室内扫描面板收集箱子与楼梯');
}

// ================= [3o] 苏醒锁定一致性 + 灰雾对齐（v3.51）：苏醒期间走路/闪避/跳跃全锁 + 90% 解锁 =================
module('苏醒锁定一致性与灰雾对齐');
{
    const wac = stripComments(read('waction.js'));
    const svc = stripComments(read('survival.js'));
    // S24.1 移动锁定满时长（dur）解锁：moveInput 用 dur 而非 dur*0.9（v3.53 回退 90% 解锁）
    assert(wac.includes('if (sv._wake && sv._wake.t < sv._wake.dur) return { mx: 0, my: 0 };'), 'S24.1 走路苏醒锁满时长解锁（v3.53 回退 90% 解锁）');
    // S24.2 苏醒期间闪避也锁（v3.58 用户定稿"彻底静止"：走路/闪避/跳跃全锁）
    const dashSeg = wac.indexOf('export function startDash(sv)');
    assert(dashSeg >= 0 && wac.slice(dashSeg, dashSeg + 250).includes('sv._wake'), 'S24.2 苏醒期间闪避锁定（startDash 有 _wake 检查）');
    // S24.3 苏醒期间跳跃也锁（v3.58 用户定稿）
    const jumpSeg = wac.indexOf('export function tryJump(sv)');
    assert(jumpSeg >= 0 && wac.slice(jumpSeg, jumpSeg + 200).includes('sv._wake'), 'S24.3 苏醒期间跳跃锁定（tryJump 有 _wake 检查）');
    // S24.4 沙尘暴风力推挤苏醒期间照常生效（不再特殊豁免）
    assert(svc.includes("if (sv._weather === 'sandstorm' && !sv.driving) {"), 'S24.4 苏醒期间沙尘暴风力推挤照常生效（v3.53 回退豁免）');
    // S24.5 苏醒期间仍无敌/状态冻结（wakeActive 保持 dur 全时段保护）
    assert(svc.includes('function wakeActive(sv) { return !!(sv && sv._wake && sv._wake.t < sv._wake.dur); }'), 'S24.5 无敌/状态冻结仍全时段（wakeActive 保持 dur）');
    // S24.6 主控被救活（downedMedSubmit）不额外触发苏醒过渡（v3.55 还原 v3.50：救活不播苏醒，保持原行为）
    const rescueSeg = svc.indexOf('log(`${name} 被救活了！`');
    assert(rescueSeg >= 0 && !svc.slice(rescueSeg, rescueSeg + 200).includes('sv._wake'), 'S24.6 主控被救活不播苏醒（还原 v3.50）');
    // S24.7 软核全灭重生已有苏醒过渡（reborn 2.4s，v3.58 用户定稿统一 2.4 秒）
    assert(svc.includes('sv._wake = { t: 0, dur: 2.4, reborn: true };'), 'S24.7 软核全灭重生已有苏醒过渡（reborn 2.4s）');
    // S24.8 开场苏醒过渡（reborn 无标志，2.4s，v3.58 用户定稿统一 2.4 秒）
    assert(svc.includes('sv._wake = { t: 0, dur: 2.4 };'), 'S24.8 开场苏醒过渡（2.4s）');
}

// ================= [3q] 主循环 ReferenceError 修复（v3.57）：render.js 不再有裸 Panel/WSearch 引用 =================
module('主循环ReferenceError修复');
{
    const rnd = stripComments(read('render.js'));
    const svc = stripComments(read('survival.js'));
    // S26.1 render.js drawAimCrosshair 不再裸引用 Panel.anyOpen / WSearch.isOpen（裸引用每帧 ReferenceError）
    // 用正则排除带 `window.` 前缀的合法引用，只检查裸 `Panel.anyOpen(`（无 window 前缀）
    const barePanel = /[^.\w]Panel\.anyOpen\s*\(/.test(rnd);
    const bareWSearch = /[^.\w]WSearch\.isOpen\s*\(/.test(rnd);
    assert(!barePanel && !bareWSearch,
        'S26.1 drawAimCrosshair 不再有裸 Panel/WSearch 引用（消除 ReferenceError）');
    // S26.2 v3.58 drawAimCrosshair 已移除红点准心/红箭头绘制（用户定稿"不需要提示"），保留空函数不破坏 draw()
    const acStart = rnd.indexOf('function drawAimCrosshair(ctx, sv, W, H) {');
    const acBody = rnd.slice(acStart, acStart + 120);
    assert(acStart >= 0 && !acBody.includes("'#FF3333'") && !acBody.includes("'▲'"), 'S26.2 drawAimCrosshair 空壳（红点/红箭头已移除，功能由 survival 承担）');
    // S26.3 survival.js 在 import 后挂载 window.Panel / window.WSearch / window.scanPanelOpen（供 render.js 间接访问）
    assert(svc.includes('window.Panel = Panel;') && svc.includes('window.WSearch = WSearch;') && svc.includes('window.scanPanelOpen = scanPanelOpen;'),
        'S26.3 survival.js 挂载 window.Panel/WSearch/scanPanelOpen');
    // S26.4 render.js 渐变曲线改缓出平方（v3.56）：让前段暗度更慢下降，灰黑蒙层明显可见
    assert(rnd.includes('const a = (1 - prog) * (1 - prog);'),
        'S26.4 drawWakeOverlay 暗度用缓出平方曲线（前段灰黑蒙层明显）');
}

// ================= [3r] v3.58 苏醒全锁/世界暂停/中键扫描/室内准星 =================
module('v3.58苏醒全锁与扫描增强');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    const wac = stripComments(read('waction.js'));
    // S27.1 苏醒期间全锁：走路/闪避/跳跃都锁（用户定稿"彻底静止"）
    assert(wac.includes('if (sv._wake && sv._wake.t < sv._wake.dur) return { mx: 0, my: 0 };')
        && wac.includes('if (sv._wake && sv._wake.t < sv._wake.dur) return false;'),
        'S27.1 苏醒期间走路/闪避/跳跃全锁（moveInput/startDash/tryJump）');
    // S27.2 苏醒期间世界暂停：loop 苏醒分支只推进 sv.now + _wake.t，不调 update
    assert(svc.includes('if (sv._wake && !sv.dead) {') && svc.includes('sv._wake.t += dt;'),
        'S27.2 苏醒期间世界暂停（loop 分支只推时间与苏醒计时）');
    // S27.3 鼠标中键长按扫描：mousedown button 1 启动 _scanHeld 计时 + mouseup 判定 0.8s 开门
    assert(svc.includes('else if (e.button === 1 && sv) {') && svc.includes('sv._scanHeld = true;'),
        'S27.3 鼠标中键长按启动扫描计时');
    // S27.4 扫描进度圆环中心移到鼠标位置
    assert(rnd.includes('const cx = (sv.mouse && sv.mouse.x != null) ? sv.mouse.x : W / 2;'),
        'S27.4 扫描进度圆环中心移到鼠标位置');
    // S27.5 室内准星优先扩展到 NPC（碰撞体积）与楼梯（格子）
    assert(svc.includes('it.promptTarget = { npc: 1, x: n.x, y: n.y, aim: 1 };')
        && svc.includes('it.promptTarget = { stairs: 1'),
        'S27.5 室内准星优先 NPC 碰撞体积 + 楼梯格');
    // S27.6 室内 doInteriorInteract 准星优先（NPC/楼梯/箱子）
    assert(svc.includes('openNpcMenu(n.id);') && svc.includes('WD.changeFloor(sv, dir);') && svc.includes('openInteriorBox(agx, agy);'),
        'S27.6 室内 F 交互准星优先（NPC/楼梯/箱子）');
    // S27.7 室内 NPC 准星指向画金色长方体边框
    assert(rnd.includes("ctx.strokeStyle = '#FFD700';") && rnd.includes('pt.aim'),
        'S27.7 室内 NPC 准星指向金色长方体边框');
}

// ================= [3s] v3.58 室内跨楼层尸变 + 感染噪点性能优化 =================
module('室内跨楼层尸变与感染性能');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    // S28.1 室内非当前楼层尸体到时间也尸变（转存对应楼层存档 fkey），不再被 continue 跳过 → 与室外计时一致
    const seg = svc.indexOf('if (nf !== sv.interior.floor) {');
    assert(seg >= 0 && svc.slice(seg, seg + 500).includes('sv.now - atI >= B.CORPSE_REVIVE_SECONDS')
        && svc.slice(seg, seg + 500).includes("corpseReviveZombie(sv, n, fkey);")
        && svc.slice(seg, seg + 500).includes('continue;'),
        'S28.1 室内非当前楼层尸体到时间转存该楼层存档尸变（与室外计时一致）');
    // S28.2 转存楼层 key 包含 interiorFloor（楼:层）
    assert(svc.includes("const fkey = (n.interiorKey || 'room') + ':' + nf;"), 'S28.2 转存楼层 fkey = 房间:楼层');
    // S28.3 感染噪点改用确定性 LCG 伪随机 + 批量 rect 一次 fill（性能优化，不再每帧 Math.random）
    assert(rnd.includes('const seed = (sv._infNoiseSeed = ((sv._infNoiseSeed || 0) + 1) & 0x7fffffff) || 1;')
        && rnd.includes('r = (r * 1664525 + 1013904223) >>> 0;')
        && rnd.includes('ctx.rect(x, y, 1, 1);') && rnd.includes('ctx.fill();'),
        'S28.3 感染噪点确定性 LCG + 批量 rect 一次 fill（性能优化）');
    // S28.4 噪点密度减半（W*H/18000，原 /9000）
    assert(rnd.includes('Math.floor(W * H / 18000)'), 'S28.4 感染噪点密度减半（/18000）');
}

// ================= [3t] v3.60 睁眼预渲染 + 室内草风格 + 门角落限制 =================
module('v3.60睁眼预渲染与室内草风格与门角落');
{
    const rnd = stripComments(read('render.js'));
    const wld = stripComments(read('world.js'));
    // S29.1 苏醒期间场地缓存外扩预生成（睁眼后不闪场地资源）
    assert(rnd.includes('const padW = (sv._wake && sv._wake.t < sv._wake.dur) ? (W / TS) : 0;')
        && rnd.includes('const padH = (sv._wake && sv._wake.t < sv._wake.dur) ? (H / TS) : 0;'),
        'S29.1 苏醒期间场地缓存外扩一个屏幕预生成（睁眼后不闪）');
    // S29.2 室内草多种渲染风格可切换（_devPlantStyle 1 盆栽 / 2 杂草丛 / 3 旧风格）
    assert(rnd.includes('const pstyle = (sv._devPlantStyle || 2) | 0;')
        && rnd.includes('pstyle === 1') && rnd.includes('pstyle === 2'),
        'S29.2 室内草 3 种渲染风格（默认杂草丛，区别于室外草药）');
    // S29.3 门候选排除建筑包围盒角落格（三处补门）
    const cornerChecks = (wld.match(/\((y === cMinY \|\| y === cMaxY)\)|cornerCell|rMaxY/g) || []).length;
    assert(cornerChecks >= 3, `S29.3 门候选排除角落格（命中 ${cornerChecks} 处）`);
    assert(wld.includes('cornerCell') && wld.includes('cMinX') && wld.includes('rMaxY'), 'S29.4 角落排除覆盖第一次补门/临街补门/片段修复补门');
}

// ================= [3u] v3.61 室内扫描队友 + 下楼落点 + 障碍物不破坏地形 + 不自动全屏 =================
module('v3.61室内扫描队友与下楼与障碍与全屏');
{
    const svc = stripComments(read('survival.js'));
    const wdr = stripComments(read('windoor.js'));
    const wbd = stripComments(read('wbuild.js'));
    // S30.1 室内扫描补"随行队友/初始主控"交互（与室外命令/交谈语义一致，切视角后初始主控也可交互）
    assert(svc.includes('sv.promptTarget = { npc: n.id };') && svc.includes('n.party ? `命令 ${n.name}`'),
        'S30.1 室内扫描补随行队友/初始主控交互按钮');
    // S30.2 室内楼下落点避开 EXIT 出口格（防"2楼下楼直接到室外"）
    assert(wdr.includes('const isExitCell = (gx, gy) =>') && wdr.includes('if (isExitCell(gx, gy)) continue;'),
        'S30.2 室内换层落点避开 EXIT 出口格');
    // S30.3 换层后出门冷却 0.8s（防落点紧邻 EXIT 瞬间自动出门）
    assert(wdr.includes('sv._floorCd = 0.8;'), 'S30.3 换层后设出门冷却 _floorCd=0.8');
    // S30.4 路障打坏恢复为马路（ROAD）而非 GROUND（不再破坏马路地形）
    assert(wbd.includes('sv.mods.tiles[key] = { t: T.ROAD };') && wbd.includes('setTile(sv, gx, gy, T.ROAD);'),
        'S30.4 路障打坏恢复马路地形（不破坏马路）');
    // S30.5 进入世界不再自动全屏（移除 startRun 的 requestFullscreen）
    assert(!svc.includes('rootEl.requestFullscreen().catch'), 'S30.5 进入世界不再自动全屏（手动 F11）');
}

// ================= [3v] v3.62 重生位置随机 + 捏脸优化 + 界面粒子 + 名称校验 + 难度改名 + 反馈 toast =================
module('v3.62重生随机捏脸粒子名称难度反馈');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    const wlk = stripComments(read('wlook.js'));
    const wbl = stripComments(read('wbalance.js'));
    // S31.1 出生/重生随机到城区/郊区/废墟（randomZoneSpawn 目标区域三选一）
    assert(svc.includes("const zones = ['urban', 'suburb', 'ruins'];")
        && svc.includes("const zone = zones[Math.floor(Math.random() * zones.length)];")
        && svc.includes("if (districtAt(seed, cx, cy) !== zone) continue;")
        && svc.includes('randomZoneSpawn(run.world.seed, null)')
        && svc.includes('randomZoneSpawn(sv.world.seed, sv)'),
        'S31.1 出生+无床重生随机到城区/郊区/废墟三选一');
    // S31.2 捏脸每次进入自动随机配色（不再默认继承"上次"，initialLook 有值才保留）
    assert(wlk.includes('const look = normalizeLook(initialLook) || randomLook();')
        && !wlk.includes('normalizeLook(initialLook) || loadLastLook() || randomLook()'),
        'S31.2 捏脸每次进入自动随机配色（不再默认继承上次外观）');
    // S31.3 v3.74 attachParticleBg fallback 末世废土（rgba(90,50,20,0.90) 暮色）
    assert(rnd.includes('export function attachParticleBg(host, opts)')
        && rnd.includes("grad.addColorStop(0, 'rgba(90,50,20,0.90)'")
        && rnd.includes('return cleanup;'),
        'S31.3 v3.74 render.js attachParticleBg fallback 末世废土暮色渐变');
    const partCount = (svc.match(/attachParticleBg\(/g) || []).length;
    assert(partCount >= 5 && wlk.includes('attachParticleBg(lookEl)'),
        `S31.4 粒子背景接入全部弹窗（开始/创建世界/绑定角色/新角色/幸存者/游玩模式/捏脸，实际 ${partCount} 处+捏脸）`);
    // S31.5 世界名称必填或随机：留空弹"请输入世界名称"（不再自动随机）
    assert(svc.includes("showToast('请输入世界名称', '#FFB347')") && svc.includes("if (!raw) {"),
        'S31.5 创建世界名称必填：留空弹「请输入世界名称」');
    // S31.6 角色名称必填或随机：留空弹"请输入角色名称"（绑定角色/新角色/幸存者三处）
    const roleCheck = (svc.match(/showToast\('请输入角色名称'/g) || []).length;
    assert(roleCheck >= 3, `S31.6 角色名称必填：绑定/新角色/幸存者三处弹「请输入角色名称」（实际 ${roleCheck} 处）`);
    // S31.7 难度按钮：软核选中变绿、硬核选中变红（初始全未选中性色）
    assert(svc.includes('x.dataset.diff === \'hardcore\'')
        && svc.includes("x.style.borderColor = on ? '#ff5544' : '#2a3a33'")
        && svc.includes("x.style.borderColor = on ? '#39d98a' : '#2a3a33'"),
        'S31.7 难度按钮软核绿/硬核红 + 未选中性');
    // S31.8 难度"正常"改名"软核"（wbalance DIFF_TABLE + survival 显示 + 按钮文案）
    assert(wbl.includes("name: '软核'")
        && svc.includes("diffName = { normal: '软核', hardcore: '硬核' }")
        && svc.includes('>软核</button>'),
        'S31.8 难度名「正常」→「软核」（wbalance/survival/按钮三处）');
    // S31.9 反馈 toast 淡入淡出排队：世界创建成功→角色定制成功→角色创建并绑定成功
    assert(rnd.includes('let _toastQueue = []') && rnd.includes('export function showToast(text, color)')
        && svc.includes("showToast('世界创建成功')")
        && svc.includes("showToast('角色定制成功')")
        && svc.includes("showToast('角色创建并绑定成功')"),
        'S31.9 反馈 toast 排队淡入淡出（世界→角色定制→角色绑定三步）');
    // S31.10 创建世界成功即落盘存档（返回主菜单可见）+ 粒子接入创建世界弹窗
    assert(svc.includes('showToast(\'世界创建成功\')') && svc.includes('attachParticleBg(wInput)'),
        'S31.10 创建世界反馈+粒子背景已接入');
}

// ================= [3w] v3.63 顶栏合并+死亡指引简化+开发者模式+感染重写+脱战回血+随机重生+教程横幅 =================
module('v3.63顶栏合并死亡指引开发者感染脱战重生教程');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    const wlk = stripComments(read('winfection.js'));
    const wdv = stripComments(read('wdev.js'));
    const wnpc = stripComments(read('wnpc.js'));
    const wbal = stripComments(read('wbalance.js'));
    const wtut = stripComments(read('wtut.js'));
    // S32.1 顶部时间/地区/季节/天气合并到一排（去掉旧 y=32 第二行）
    assert(rnd.includes("ctx.fillText(`第 ${sv.day} 天  ${hh}:${mm}  [${dName}]  [${seasonName}] · ${wxName}`, 232, 17);"),
        'S32.1 顶部时间/地区/季节/天气合并到一排 y=17');
    assert(!rnd.includes("`[${seasonName}]${wxLabel}`, 232, 32"), 'S32.2 旧版 y=32 第二行已移除');
    // S32.3 死亡指引简化为单一红色箭头（去掉红边框 + 红叉 + "死"字名条，仅保留距离标签）。
    // 注意：PZ_GUIDE 函数（尸化玩家菱形指引）仍使用 ctx.rect + 旋转，必须在死亡指引函数范围内检测。
    const deathStart = rnd.indexOf('function drawLegacyDropGuide');
    const deathEnd = rnd.indexOf('\nfunction ', deathStart + 1);
    const deathBlock = deathStart >= 0 && deathEnd > deathStart ? rnd.slice(deathStart, deathEnd) : '';
    assert(rnd.includes("DEATH_GUIDE_COLOR = '#FF5544'")
        && deathBlock.length > 0
        && !deathBlock.includes("ctx.rect(-12, -12, 24, 24)")
        && !deathBlock.includes("ctx.fillText('死'"),
        'S32.3 死亡指引简化为单一红色箭头（去边框/叉/"死"字）');
    // S32.4 背包 24 → ∞（_devInfBag 开启时）+ 顶部状态栏∞标记（_devInfStamina / _devInfAmmo / _devInfDura / _devOneShot / _devInf）
    assert(rnd.includes("const bagCap = sv._devInfBag ? '∞' : '24';")
        && rnd.includes("if (sv._devInfStamina) infTags.push('体力 ∞');")
        && rnd.includes("if (sv._devInfAmmo) infTags.push('弹药 ∞');"),
        'S32.4 背包 24→∞ + 顶栏开发者∞标记（体力/弹药/耐久/一击必杀/资源）');
    // S32.5 开发者模式：资源无限默认关闭（_devInf = false）
    assert(wdv.includes("if (sv._devInf == null) sv._devInf = false;"),
        'S32.5 资源无限默认关闭（v3.63 用户要求：默认关）');
    // S32.6 属性全满不再联动无限体力（_devInfStamina 单独按钮控制）
    assert(wdv.includes("if (sv._devGod) setAllStatsFull(sv);")
        && !wdv.includes("sv._devInfStamina = true"),
        'S32.6 属性全满不再联动无限体力（用户要求：分别单独点）');
    // S32.7 v3.68 用户要求：去掉危险操作分区（重置存档）——按钮 + 整块危险操作区全移除
    assert(!wdv.includes("重置存档") && !wdv.includes("▸ 危险操作")
        && !wdv.includes("data-q=\"wipe\""),
        'S32.7 v3.68 去掉危险操作分区（重置存档按钮 + 整块已完全移除）');
    // S32.8 v3.68 用户要求：去掉时间加速自定义（输入框 + 应用按钮）
    assert(!wdv.includes("'spdApply'")
        && !wdv.includes('#wdev-spd-custom')
        && !wdv.includes('#wdev-spd-apply'),
        'S32.8 v3.68 去掉时间加速自定义输入框 + 应用按钮（保留 spd10/spd60 快捷倍率）');
    // S32.9 时间加速不影响天气：v3.65 还原 v3.62 行为——天气跟随 sv.t，不再用 _wxClock 独立时钟
    assert(!svc.includes("sv._wxClock = (sv._wxClock == null ? (sv.t || 0) : sv._wxClock) + dt * (sv._devWxTimeScale || 1);")
        && svc.includes("const hour = (sv.t / sv.dayLen) * 24;"),
        'S32.9 v3.65 还原 v3.62：天气跟随 sv.t（无 _wxClock 独立时钟）');
    // S32.10 随机重生 [X,Y] 完全随机跨区块（±200 区块）
    assert(wdv.includes("const RANGE = 200;") && wdv.includes("Math.floor(Math.random() * (RANGE * 2 + 1)) - RANGE"),
        'S32.10 随机重生 [X,Y] 完全随机跨区块（±200 区块）');
    // S32.11 主控脱战自然回血：阈值放宽 hp > 10（v3.62 前 >20 太严）
    assert(svc.includes("if (sv.hp > 10 && sv.hp < sv.maxHp"),
        'S32.11 主控脱战回血阈值放宽至 hp > 10（v3.62 前 >20 太严）');
    // S32.12 NPC 脱战自然回血（中立/友善/恶意都回）+ 8 格内无僵尸/恶意NPC 判定。
    // 实际代码：`const _x = n.x, _y = n.y, _R = 8 * TS;`（多变量同行声明）
    assert(wnpc.includes("_R = 8 * TS") && wnpc.includes("role === 'hostile'"),
        'S32.12 NPC 脱战自然回血（中立/友善/恶意）+ 8 格威胁判定');
    // S32.13 感染机制重写：每 1% 感染 → 0.5% 属性削弱（连续值；100%感染时属性=50%）
    assert(wlk.includes("attrDecayPerPct: INF_ATTR_DECAY_PER_PCT")
        && wlk.includes("const totalMul = Math.max(0.5, 1 - (v / PLAYER_INFECTION.max) * 0.5);"),
        'S32.13 感染机制重写：每1%→属性-0.5%（连续乘子；100%感染时属性=50%）');
    // S32.14 感染时间 +100%（INFECTION_AUTO_GROW_PER_SEC = 0.4）。stripComments 会删除 // 注释，
    // 故检查代码常量本身 + 注释（若 stripComments 后注释会被删除，不依赖注释匹配）
    assert(wbal.includes("INFECTION_AUTO_GROW_PER_SEC = 0.4"),
        'S32.14 感染时间 +100%（v3.63 用户要求：感染速率 0.8→0.4/秒，约 4 分钟从 0 到满）');
    // S32.15 感染条 UI：平滑连续（无脉动）+ 显示"感染X%"（不要后缀）
    assert(rnd.includes("ctx.fillStyle = ir < 0.5 ? '#5a3040'")
        && !rnd.includes("const pulse = infEff.stage >= 3")
        && rnd.includes("ctx.fillText(`感染 ${Math.round(sv.infection)}%`, 90, iy + 5);"),
        'S32.15 感染条平滑连续 + 显示"感染X%"（无脉动/无后缀）');
    // S32.16 去掉"人"字文字粒子（v3.63 用户要求：保留像素消色化即可）。
    // 注意：只检查 fillText('人'（末世废土 ash/ember 循环用了 i<30 / i<10，不能再用 i<10 否定）
    assert(!rnd.includes("ctx.fillText('人'"),
        'S32.16 去掉感染升阶"人"字文字粒子（仅保留阶段名浮字 + 像素消色）');
    // S32.17 战斗脱战冷却 4→2 秒（更快进入自然回血）。扫描所有用到 _combatT 的模块
    const allCombatSrc = svc
        + '\n' + stripComments(read('wzombie.js'))
        + '\n' + wnpc
        + '\n' + stripComments(read('windoor.js'))
        + '\n' + stripComments(read('wgear.js'))
        + '\n' + stripComments(read('waction.js'));
    const combatT4 = (allCombatSrc.match(/_combatT\s*=\s*4/g) || []).length;
    const combatT2 = (allCombatSrc.match(/_combatT\s*=\s*2/g) || []).length;
    assert(combatT4 === 0 && combatT2 >= 5,
        `S32.17 战斗脱战冷却 4→2 秒（_combatT=4 应为 0，_combatT=2 应 ≥5，实际 =4:${combatT4} =2:${combatT2}）`);
    // S32.18 教程和横幅同步：感染/脱战回血/死亡指引 + 开发者模式说明
    assert(wtut.includes("感染机制（v3.63 重写）")
        && wtut.includes("死亡与找回（v3.63 简化指引）")
        && wtut.includes("开发者模式（F9 · v3.63 调整）")
        && rnd.includes("感染每1%→属性-0.5%(不治必死)"),
        'S32.18 教程+横幅同步：感染/脱战/死亡指引 + 开发者模式说明');
    // S32.19 湿潮来袭（announce）排布得当：图标+名字+状态+描述紧凑串成一句
    assert(svc.includes("即将来袭 · ${info.desc}"),
        'S32.19 湿潮来袭 announce 排布得当（图标+名字+状态+描述紧凑串成一句）');
}

// ================= [3x] v3.64 弹窗宽度统一+存档自动保存反馈+硬核全员阵亡无重生 =================
module('v3.64弹窗宽度统一存档保存反馈硬核全员阵亡');
{
    const svc = stripComments(read('survival.js'));
    // S33.1 创建新世界/绑定角色/创建新角色/创建幸存者 弹窗宽度统一为 640px（与开始游戏绿框一致）
    const wInputStart = svc.indexOf('function startNewWorld');
    const wInputEnd = svc.indexOf('\nfunction ', wInputStart + 1);
    const wInputBlock = wInputStart >= 0 && wInputEnd > wInputStart ? svc.slice(wInputStart, wInputEnd) : '';
    const bcStart = svc.indexOf('function startBoundCharacter');
    const bcEnd = svc.indexOf('\nfunction ', bcStart + 1);
    const bcBlock = bcStart >= 0 && bcEnd > bcStart ? svc.slice(bcStart, bcEnd) : '';
    const ncStart = svc.indexOf('function startNewCharacter');
    const ncEnd = svc.indexOf('\nfunction ', ncStart + 1);
    const ncBlock = ncStart >= 0 && ncEnd > ncStart ? svc.slice(ncStart, ncEnd) : '';
    const ccStart = svc.indexOf('function showCreateCharacter');
    const ccEnd = svc.indexOf('\nfunction ', ccStart + 1);
    const ccBlock = ccStart >= 0 && ccEnd > ccStart ? svc.slice(ccStart, ccEnd) : '';
    assert(wInputBlock.includes('width:640px') && bcBlock.includes('width:640px')
        && ncBlock.includes('width:640px') && ccBlock.includes('width:640px'),
        'S33.1 创建世界/绑定角色/创建新角色/创建幸存者 弹窗宽度统一 640px（与开始游戏绿框一致）');
    // S33.2 内部 UI 用 flex/自适应（无固定 px width 在 input/button）
    assert(wInputBlock.includes('flex:2') && wInputBlock.includes('flex:1') && wInputBlock.includes('max-width:94vw'),
        'S33.2 内部 UI flex 自适应 + max-width:94vw（小屏兜底）');
    // S33.3 背景粒子 attachParticleBg 已挂载到创建世界 + 绑定角色 弹窗
    assert(svc.includes('attachParticleBg(wInput)') && svc.includes('attachParticleBg(nameInput)'),
        'S33.3 创建世界 + 绑定角色 弹窗挂载 attachParticleBg 粒子背景');
    // S33.4 绑定成功后再 showToast('存档已自动保存')（反馈队列依次显示）
    assert(svc.includes("showToast('角色创建并绑定成功')")
        && svc.includes("showToast('存档已自动保存')")
        && svc.indexOf("showToast('存档已自动保存')") > svc.indexOf("showToast('角色创建并绑定成功')"),
        'S33.4 绑定成功反馈后追加 showToast「存档已自动保存」（点取消可在开始界面看到该存档）');
    // S33.5 硬核 + 有队友 全员阵亡：只显示"返回主菜单"按钮（无重生）。
    // 注：stripComments 会删除 // 行尾注释，故只在代码字符串里匹配
    assert(svc.includes("const isHardcoreAllDead = (sv.diffKey === 'hardcore') && hadAnyMate;"),
        'S33.5 硬核 + 有队友 全员阵亡只显示"返回主菜单"（无重生按钮）');
    // S33.6 硬核单人 + 软核任意 + 普通弹窗（两按钮：重生 + 返回主菜单）
    assert(svc.includes("label: '重生'") && svc.includes("label: '返回主菜单'"),
        'S33.6 硬核单人 + 软核任意 弹窗保留"重生 + 返回主菜单"两按钮');
    // S33.7 isHardcoreAllDead 提示文字（硬核旅程结束 + 软核重生继续）。
    // 注：stripComments 会删除 // 行尾注释，故匹配模板字符串里的代码字面量
    const sdStart = svc.indexOf('export const showAllDeadChoices');
    const sdEnd = svc.indexOf('\nfunction ', sdStart + 1);
    const sdBlock = sdStart >= 0 && sdEnd > sdStart ? svc.slice(sdStart, sdEnd) : '';
    assert(sdBlock.includes('硬核模式：旅程结束') && sdBlock.includes('软核模式：你可以重生继续'),
        'S33.7 硬核/软核弹窗提示文字明确区分（硬核旅程结束 / 软核重生继续）');
}

// [4] 开发者全满（v3.27 起独立模块：setAllStatsFull 不误救濒死队友）
module('开发者全满 setAllStatsFull 不误救濒死队友');
{
    const wdev = stripComments(read('wdev.js'));
    const funcStart = wdev.indexOf('function setAllStatsFull');
    const funcBody = wdev.slice(funcStart, funcStart + 700);
    assert(funcStart >= 0, '找到 setAllStatsFull');
    assert(!funcBody.includes('_downedMembers = []'), '属性全满不再清空队友濒死记录');
    assert(funcBody.includes('sv._downed = null'), '仍清主控自身倒地状态');
    assert(funcBody.includes('sv.hp = sv.maxHp') && funcBody.includes('sv.food = B.HUNGER_MAX') && funcBody.includes('sv.water = B.WATER_MAX'), '主控状态回满逻辑保留');
    assert(wdev.includes('pc.downed = false') && wdev.includes('pc.alive = true'), '主控角色记录同步重置保留');
    assert(wdev.includes("(n.isPlayer || n.id === 'player' || (sv.controllerId && n.id === sv.controllerId))"), '循环仅清理主控 downed 标记');
}

// ================= [5b] 救助界面统一（v3.29 主控/队友共用 buildRescuePanel） =================
module('救助界面统一');
{
    const svc = stripComments(read('survival.js'));
    // 共享 builder 存在
    assert(svc.includes('function buildRescuePanel(p)'), 'U7 存在共享 buildRescuePanel 模板');
    // renderRescue + renderMateRescue 都调用 buildRescuePanel（断言至少 2 次调用）
    const builderCallCount = (svc.match(/buildRescuePanel\(\{/g) || []).length;
    assert(builderCallCount >= 2, `U8 主控+队友界面都通过 buildRescuePanel 渲染（实际 ${builderCallCount} 次调用）`);
    // 按钮不再加粗：在 buildRescuePanel 函数体内不含 font-weight:bold（v3.29 统一字号）
    const buildIdx = svc.indexOf('function buildRescuePanel(p)');
    const nextFunc = svc.indexOf('function ', buildIdx + 50);
    const builderBody = svc.slice(buildIdx, nextFunc);
    assert(!builderBody.includes('font-weight:bold'), 'U9 buildRescuePanel 内按钮不再加粗（仅靠颜色区分已集齐）');
    // timer id 统一为 wsl-rescue-timer
    const updateTimer = svc.indexOf('function updateMateRescueTimer');
    const updateTimerBlock = svc.slice(updateTimer, updateTimer + 500);
    assert(updateTimerBlock.includes("'#wsl-rescue-timer'"), 'U10 updateMateRescueTimer 引用统一 timer id');
}

// ================= [5] 救助界面防闪烁/防点击丢失 =================
module('救助界面 UI');
{
    const svc = stripComments(read('survival.js'));
    assert(svc.includes('if (rescueOpen()) updateRescueTimer();'), 'U1 主控节流改调用 updateRescueTimer');
    assert(!svc.includes('if (sv._rescueRefreshT <= 0) { sv._rescueRefreshT = 0.25; renderRescue(); }'), 'U2 主控节流不再直接 renderRescue');
    assert(svc.includes('updateMateRescueTimer();'), 'U3 队友节流改调用 updateMateRescueTimer');
    assert(!svc.includes('>= 0.25) { sv._mateRescueRefreshAt = _now; renderMateRescue(); }'), 'U4 队友节流不再直接 renderMateRescue');
    assert(svc.includes('id="wsl-rescue-timer"'), 'U5 倒计时 span 有稳定 id（主控与队友共用）');
    assert(!svc.includes('id="wsl-rescue-timer-m"'), 'U6 不再有 v3.26 临时 id（已统一）');
    const u1 = svc.indexOf('function updateRescueTimer');
    const u2 = svc.indexOf('function updateMateRescueTimer');
    assert(u1 >= 0 && svc.slice(u1, u1 + 250).includes('t.textContent'), 'U7 updateRescueTimer 只更新 textContent');
    assert(u2 >= 0 && svc.slice(u2, u2 + 800).includes('t.textContent'), 'U8 updateMateRescueTimer 只更新 textContent');
    assert(svc.includes("rescueEl.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click'"), 'U9 事件绑定保留');
    assert(!svc.slice(u1, u1 + 250).includes('innerHTML'), 'U10 updateRescueTimer 不含 innerHTML');
    assert(!svc.slice(u2, u2 + 800).includes('innerHTML'), 'U11 updateMateRescueTimer 不含 innerHTML');
}

// ================= [3y] v3.65 还原 wxClock+天气淡入淡出+空投指引+尸潮7天一波+背包HUD修复+UI清理 =================
module('v3.65还原wxClock天气淡入淡出空投指引尸潮7天背包HUD');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    const pan = stripComments(read('panel.js'));
    const wdv = stripComments(read('wdev.js'));
    // S34.1 v3.65 还原 v3.62：天气跟随 sv.t，不再用 _wxClock 独立时钟 + _devWxTimeScale
    assert(!svc.includes('sv._wxClock = (sv._wxClock == null')
        && !wdv.includes('sv._devWxTimeScale')
        && !wdv.includes('wdev-wx-scale')
        && svc.includes('const hour = (sv.t / sv.dayLen) * 24;'),
        'S34.1 还原 v3.62 行为：天气跟随 sv.t（移除 _wxClock / _devWxTimeScale / "天气也加速"复选框）');
    // S34.2 v3.70 尸潮提示移到 W-160（金币 W-12 之前 148px 空隙），避免与"背包+金币"右对齐撞车
    assert(rnd.includes("ctx.fillText(`⚠ 尸潮·${left} 只`, W - 160, 17)"),
        'S34.2 v3.70 尸潮提示移到 W-160（金币前 148px 空隙，不重叠不并列）');
    // S34.3 重生后清理 UI 状态（_lastDeathPos/announce/prompt）
    assert(svc.includes('sv._lastDeathPos = null;')
        && svc.includes('sv.announce = null;')
        && svc.includes('sv.prompt = null;'),
        'S34.3 重生后清理 _lastDeathPos/announce/prompt');
    // S34.4 重生天气粒子平滑过渡：_weatherFadeT = 0 + _wxDensityMul = 0（1.5s 渐变）
    assert(svc.includes('sv._weatherFadeT = 0;') && svc.includes('sv._wxDensityMul = 0;')
        && rnd.includes('const fadeT = Math.min(1, (sv._weatherFadeT || 0) + fdt2 / 1.5)'),
        'S34.4 重生天气粒子平滑过渡（_weatherFadeT/_wxDensityMul 在 1.5s 渐变）');
    // S34.5 天气切换淡入淡出：updateWeather 检测 weather 变化时重置 fadeT
    assert(svc.includes('sv._weather = wx;')
        && svc.includes('sv._weatherFadeT = 0;')
        && svc.includes('sv._wxDensityMul = 0;'),
        'S34.5 天气切换触发淡入淡出（alpha + 密度双渐变）');
    // S34.6 退出游戏清理所有 UI（WSearch/scanPanel/deathWindow/announce 等）
    assert(svc.includes('WSearch.closeSearch(sv, true)')
        && svc.includes('Panel.hideDeath')
        && svc.includes('sv._scanHeld = false; sv._scanHeldAt = 0; sv._scanDone = false;'),
        'S34.6 退出清理 WSearch/scanPanel/deathWindow/prompt/scan 状态');
    // S34.7 无限背包 HUD cap 直接显示 ∞
    assert(pan.includes("const cap = infBag ? '∞' : BAG_SIZE;") && pan.includes("infBag ? ' · 无限' : ''"),
        'S34.7 无限背包 HUD cap 直接显示 ∞（新开无限背包时立即显示 ∞ 而非 24）');
    // S34.8 空投外观统一 WBOX + 物资 3~5 件 rare + 50% 传送宝石
    assert(svc.includes('setTile(sv, gx, gy, T.WBOX)')
        && svc.includes("const itemN = 3 + Math.floor(Math.random() * 3)")
        && svc.includes("items.push({ id: 'tpgem', n: 1 })"),
        'S34.8 空投外观统一 WBOX + 物资 3~5 件 rare + 50% 传送宝石');
    // S34.9 空投指引 drawAirdropGuide（屏外黄色箭头 + 距离标签）
    assert(rnd.includes('function drawAirdropGuide(ctx, sv, W, H, sharedDrawn)')
        && rnd.includes("ctx.fillStyle = '#FFD266';")
        && rnd.includes("'空投 · ' + Math.round(dist / TS) + ' 格'"),
        'S34.9 空投指引 drawAirdropGuide（屏外黄色箭头 + 距离标签）');
    // S34.10 尸潮每 7 天一波，20:00~23:00 随机时间（确定性）
    assert(svc.includes('sv.day >= 7 && sv.day % 7 === 0')
        && svc.includes('sv._hordeTriggerHour = 20 + r * 3')
        && svc.includes("const r = hash2(sv.world.seed | 0, sv.day | 0, 0x9A3F);"),
        'S34.10 尸潮每 7 天一波（day>=7 且 day%7===0）+ 20:00~23:00 随机时间（hash2 确定性）');
}

// ================= [3z] v3.66 全局粒子背景 + 游玩模式内联 + toast 滑入 + 存档索引 + 开始淡出 =================
module('v3.66全局粒子游玩内联toast滑入存档索引开始淡出');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    // S35.1 全局粒子背景 #wsl-bg-fx：ensureBgFx/destroyBgFx/preloadBgFxParts 三函数 + z-index 1095
    assert(rnd.includes('export function ensureBgFx()')
        && rnd.includes('export function destroyBgFx()')
        && rnd.includes('export function preloadBgFxParts()')
        && rnd.includes("position:fixed;inset:0;z-index:1095"),
        'S35.1 render.js 全局粒子背景 #wsl-bg-fx（z-index 1095 覆盖创意工坊）');
    // S35.2 存档预览显示新建存档：独立索引 wasteland_worlds_index + addWorldToIndex + 兜底遍历
    assert(svc.includes("getStorage('wasteland_worlds_index', null)")
        && svc.includes('function addWorldToIndex(seed)')
        && svc.includes('addWorldToIndex(seed)'),
        'S35.2 存档预览显示新建存档（独立索引 + addWorldToIndex + 兜底遍历，修复 namespace 推断失效）');
    // S35.3 游玩模式合并到开始游戏界面（与软核/硬核同款按钮组）
    assert(svc.includes("class=\"wsl-start-mode\"")
        && svc.includes('el.dataset.startMode')
        && svc.includes('function startGameConfirm(mode)'),
        'S35.3 游玩模式合并到开始游戏界面（sp/mp 按钮组 + startMode 数据绑定）');
    // S35.4 游玩模式必选（未选时弹 toast 提示）
    assert(svc.includes("showToast('请选择游玩模式（单人 / 多人联机）', '#FFB347')"),
        'S35.4 游玩模式必选：未选时弹「请选择游玩模式」toast');
    // S35.5 开始游戏/继续游戏 淡出（0.6s）→ 过渡到睁眼效果
    assert(svc.includes("el.style.transition = 'opacity 0.6s ease';")
        && svc.includes('el.style.opacity = \'0\';')
        && svc.includes('destroyBgFx();')
        && svc.includes('else enterWasteland(baseOpts);'),
        'S35.5 开始游戏/继续游戏 0.6s 淡出 + destroyBgFx → enterWasteland 睁眼效果');
    // S35.6 v3.69 toast 改为右滑入 translateX(100%) → translateX(-100%) + 向上淡出（向右移动 100% 视窗宽）
    assert(rnd.includes("position:fixed;top:72px;right:0;")
        && rnd.includes("transform:translateX(100%) translateY(24px) scale(1)")
        && rnd.includes("translateX(-100%) translateY(0) scale(1)")
        && rnd.includes("translateX(-100%) translateY(-26px) scale(1)"),
        'S35.6 v3.69 toast 右滑入（translateX 100% → -100%）+ 向上淡出（-100% -26px）');
    // S35.7 取消按钮销毁 bg-fx（防止泄漏）
    assert(svc.includes("cancelStartPreview(); el.remove(); destroyBgFx();")
        || svc.includes("el.querySelector('#wsl-start-cancel').addEventListener('click', () => { cancelStartPreview(); el.remove(); destroyBgFx(); }"),
        'S35.7 取消按钮销毁 bg-fx（防止粒子背景泄漏）');
    // S36.1 v3.74 bg-fx 末世废土暮色渐变
    assert(rnd.includes("grad.addColorStop(0, 'rgba(90,50,20,0.90)');")
        && rnd.includes("grad.addColorStop(0.5, 'rgba(70,40,18,0.94)');")
        && rnd.includes("grad.addColorStop(1, 'rgba(40,26,14,0.97)');"),
        'S36.1 v3.74 bg-fx 末世废土暮色渐变（黄橙→深褐）');
    // S36.2 v3.74 末世废土粒子参数（dust 120 + ash 30 + ember 10）
    assert(rnd.includes("r: 0.5 + Math.random() * 2.5")
        && rnd.includes("r: 0.8 + Math.random() * 2")
        && rnd.includes("r: 1 + Math.random() * 2.5"),
        'S36.2 v3.74 末世废土粒子参数（dust/ash/ember 三种尺寸）');
    // S36.3 v3.67 难度必选：diff 初始 '' + 未选弹「请选择游戏难度」
    assert(svc.includes("let diff = '';")
        && svc.includes("showToast('请选择游戏难度', '#FFB347')"),
        'S36.3 创建世界难度必选：初始未选，未选时弹「请选择游戏难度」+ 按钮红框提示');
}

// ================= [3a] v3.68 去掉重置存档/画质/自定义时间 + 尸潮移到天气右侧 + 开发者不生成空投 + 无限背包扩容 =================
module('v3.68去重置画质自定义时间尸潮右侧开发者不空投无限扩容');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    const pan = stripComments(read('panel.js'));
    const wdv = stripComments(read('wdev.js'));
    // S37.1 v3.68 去掉开发者"危险操作"分区（重置存档按钮 + 整个分区）
    assert(!wdv.includes("▸ 危险操作")
        && !wdv.includes("data-q=\"wipe\"")
        && !wdv.includes("wsl-dev-danger"),
        'S37.1 v3.68 去掉危险操作分区（重置存档按钮 + 整个分区移除）');
    // S37.2 v3.68 去掉时间加速自定义（1~200 数字 + 应用按钮）
    assert(!wdv.includes("'spdApply'")
        && !wdv.includes('#wdev-spd-custom')
        && !wdv.includes('#wdev-spd-apply'),
        'S37.2 v3.68 去掉时间加速自定义输入框 + 应用按钮（保留 ×10/×60 快捷）');
    // S37.3 v3.68 去掉画质调整（高/中/低）
    assert(!wdv.includes("data-gfx=\"2\"")
        && !wdv.includes("data-gfx=\"1\"")
        && !wdv.includes("data-gfx=\"0\"")
        && !wdv.includes('#wdev-gfx'),
        'S37.3 v3.68 去掉画质调整（高/中/低三档按钮 + 整块移除）');
    // S37.4 v3.70 尸潮提示移到 W-160（金币 W-12 之前 148px 空隙，不重叠不并列）
    assert(rnd.includes("ctx.fillText(`⚠ 尸潮·${left} 只`, W - 160, 17)"),
        'S37.4 v3.70 尸潮提示移到 W-160（金币前 148px 空隙，不重叠不并列）');
    // S37.5 开发者模式（_devGod）下不生成空投（airdrop）
    assert(svc.includes("if (sv._devGod) return;")
        && svc.includes("startEvent(sv, 'blackout')")
        && svc.includes("startEvent(sv, 'airdrop')"),
        'S37.5 开发者模式（_devGod）下不生成空投（airdrop），仅 blackout 仍可触发');
    // S37.6 无限背包：B 键打开背包面板也显示 ∞ + 超 24 自动扩容 + 垂直滚动
    assert(pan.includes("const cellN = infBag ? sv.inv.length : BAG_SIZE;")
        && pan.includes("wsl-bag-infinite")
        && pan.includes("infBag && cellN > 24 ? ' wsl-bag-infinite' : ''"),
        'S37.6 无限背包：B 键打开背包面板 cellN = sv.inv.length（超 24 扩容 + 垂直滚动 + wsl-bag-infinite 类）');
}

// ================= [3b] v3.69 背景提亮+toast 右滑 100%+感染 sprite 缓存修复朝南卡顿 =================
module('v3.69背景提亮toast右滑100%感染sprite缓存朝南');
{
    const rnd = stripComments(read('render.js'));
    // S38.1 v3.74 bg-fx + attachParticleBg 末世废土暮色渐变（rgba(90,50,20,0.90)）
    assert(rnd.includes("grad.addColorStop(0, 'rgba(90,50,20,0.90)');")
        && rnd.includes("grad.addColorStop(0.5, 'rgba(70,40,18,0.94)');")
        && rnd.includes("grad.addColorStop(1, 'rgba(40,26,14,0.97)');"),
        'S38.1 v3.74 bg-fx + attachParticleBg 末世废土暮色渐变（黄橙→深褐）');
    // S38.2 toast 改为右滑入 translateX(100%) → translateX(-100%)（向右移动 100% 视窗宽度）
    assert(rnd.includes("transform:translateX(100%) translateY(24px) scale(1)")
        && rnd.includes("translateX(-100%) translateY(0) scale(1)")
        && rnd.includes("translateX(-100%) translateY(-26px) scale(1)"),
        'S38.2 v3.69 toast 右滑入 100%→-100%（向右移动 100% 视窗宽度对齐右 1/3 处）+ 向上淡出');
    // S38.3 感染 sprite 桶缓存（每 5% 一个桶，共 20 桶），修复朝南移动帧率 6 / 139.4ms
    assert(rnd.includes('_infSpriteCache = new Map();')
        && rnd.includes("const bucket = Math.floor(level * 20);")
        && rnd.includes("const cacheKey = `${sprKey}|${a.frame || 0}|${moving ? 1 : 0}|${tintKey}|${bucket}`;")
        && rnd.includes('if (_infSpriteCache.size > 256) {'),
        'S38.3 v3.69 感染 sprite 桶缓存（每 5% 一个桶）+ 256 张上限清理（修复朝南 FPS 6/139ms）');
}

// ================= [3c] v3.70 恢复空投按钮+尸潮移到 W-160+还原 v3.62 背景渐变 =================
module('v3.70恢复空投按钮尸潮移到W-160还原v3.62背景');
{
    const rnd = stripComments(read('render.js'));
    const wdv = stripComments(read('wdev.js'));
    // S39.1 v3.70 恢复 wdev "生成空投"按钮（之前 v3.68 被误删，data-q="airdrop" 按钮 + case handler）
    assert(wdv.includes('data-q="airdrop"')
        && wdv.includes("case 'airdrop':")
        && wdv.includes("startEvent(sv, 'airdrop')"),
        'S39.1 v3.70 恢复 wdev "生成空投"按钮（data-q=airdrop + case handler + startEvent 调用）');
    // S39.2 尸潮提示移到 W-160（避免与"背包+金币"右对齐 W-12 撞车）
    assert(rnd.includes("ctx.fillText(`⚠ 尸潮·${left} 只`, W - 160, 17);"),
        'S39.2 尸潮提示移到 W-160（金币 W-12 之前 148px 空隙，不重叠不并列）');
    // S39.3 v3.74 末世废土暮色渐变（bg-fx + attachParticleBg 各一处）
    const bgFxCount = (rnd.match(/grad\.addColorStop\(0, 'rgba\(90,50,20,0\.90\)'\);/g) || []).length;
    assert(bgFxCount >= 2,
        `S39.3 v3.74 末世废土暮色渐变（bg-fx + attachParticleBg 各一处，实际 ${bgFxCount} 处）`);
}

// ================= [3d] v3.71 修复 _infSpriteCache ReferenceError + 还原 v3.62 渐变 =================
module('v3.71修复_infSpriteCache ReferenceError还原v3.62');
{
    const rnd = stripComments(read('render.js'));
    // S40.1 _infSpriteCache 提升模块顶层（v3.69 函数内裸赋值 → ESM ReferenceError → 修复）
    assert(rnd.includes("let _infSpriteCache = new Map();")
        && !rnd.includes("if (!_infSpriteCache) _infSpriteCache = new Map();"),
        'S40.1 _infSpriteCache 提升到模块顶层并立即初始化 new Map()（修复 v3.69 ESM ReferenceError）');
    // S40.2 _infSpriteCache 在 drawPixelPlayerBody 内直接用（不再 lazy init）
    assert(rnd.includes('let cv = _infSpriteCache.get(cacheKey);')
        && rnd.includes('_infSpriteCache.set(cacheKey, cv);'),
        'S40.2 _infSpriteCache 在 drawPixelPlayerBody 内直接 get/set（共享模块级缓存，跨函数调用复用）');
}

// ================= [3e] v3.72 修复 wdev 空投 startEvent 未导入 + F1 外层 fixed 定位 =================
module('v3.72修复wdev空投startEventF1外层fixed');
{
    const wdev = stripComments(read('wdev.js'));
    const tut = stripComments(read('wtut.js'));
    const sv = stripComments(read('survival.js'));
    // S41.1 wdev.js 导入 startEvent（之前 typeof startEvent === 'function' 永远 false → case 'airdrop' 不触发）
    assert(wdev.includes("import { startEvent } from './survival.js';")
        && wdev.includes("case 'airdrop':")
        && wdev.includes("startEvent(sv, 'airdrop')"),
        'S41.1 wdev.js 导入 startEvent（修复"生成空投"按钮点击无反应）');
    // S41.2 F1 新手教程外层容器加 position:fixed + inset:0 + z-index:950（之前没定位 → 教程被挤到下方）
    assert(tut.includes("position:fixed;inset:0;z-index:950")
        && tut.includes('wsl-tut'),
        'S41.2 F1 新手教程外层 fixed + inset:0 + z-index:950（之前没定位导致教程被挤到下方）');
}

// ================= [3f] v3.74 末世废土背景（方案 I）：尘埃+灰烬+余烬+废墟剪影 =================
module('v3.74末世废土背景粒子');
{
    const rnd = stripComments(read('render.js'));
    // S42.1 v3.74 方案 I「末世废土」：dust 尘埃 120 个
    assert(rnd.includes("_bgFxParts.dust = [];")
        && rnd.includes('for (let i = 0; i < 120; i++) {')
        && rnd.includes("color: Math.random() < 0.5 ? '#d8a86a' : '#8a7a5a'"),
        'S42.1 v3.74 末世废土：dust 尘埃 120 个（黄橙/土色）');
    // S42.2 ash 灰烬 30 个 + ember 余烬 10 个
    assert(rnd.includes("_bgFxParts.ash = [];")
        && rnd.includes('for (let i = 0; i < 30; i++) {')
        && rnd.includes("_bgFxParts.ember = [];")
        && rnd.includes('for (let i = 0; i < 10; i++) {'),
        'S42.2 v3.74 末世废土：ash 灰烬 30 + ember 余烬 10');
    // S42.3 废墟剪影轮廓数组
    assert(rnd.includes("_bgFxParts.ruins = [0.05, 0.12, 0.08, 0.18"),
        'S42.3 v3.74 末世废土：废墟剪影轮廓数组');
    // S42.4 黄橙暮色渐变背景（rgba(90,50,20,0.90)）
    assert(rnd.includes("'rgba(90,50,20,0.90)'")
        && rnd.includes("'rgba(70,40,18,0.94)'")
        && rnd.includes("'rgba(40,26,14,0.97)'"),
        'S42.4 v3.74 末世废土：黄橙暮色渐变背景');
    // S42.5 暮色阳光带 + 余烬红光
    assert(rnd.includes("ctx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, W * 0.35)")
        && rnd.includes("ctx.fillStyle = '#ff5544';"),
        'S42.5 v3.74 末世废土：暮色阳光带 + 余烬红光');
    // S42.6 废墟剪影绘制（底部锯齿状天际线）
    assert(rnd.includes("ctx.fillStyle = 'rgba(20,14,10,0.9)';")
        && rnd.includes("const mh = H * 0.30;")
        && rnd.includes("ctx.lineTo(x, H - mh * (ruins[idx] || 0.1));"),
        'S42.6 v3.74 末世废土：废墟剪影绘制（底部锯齿状天际线）');
}

// ================= [3g] v3.75 弹窗外层遮罩透明 + scanPanelOpen typeof 守卫 =================
module('v3.75弹窗遮罩透明scanPanelOpen守卫');
{
    const svc = stripComments(read('survival.js'));
    const rnd = stripComments(read('render.js'));
    const css = stripComments(read('../../style.css'));
    // S43.1 弹窗外层全屏遮罩改透明（开始游戏/创建世界/创建角色/游玩模式）
    assert(!svc.includes('background:rgba(5,8,12,0.94)')
        && svc.includes("background:transparent"),
        'S43.1 v3.75 弹窗外层全屏遮罩改透明（rgba(5,8,12,0.94) 已移除，bg-fx 末世废土透出）');
    // S43.2 捏脸 .wsl-look 外层背景改透明（stripComments 删注释，只检查 CSS 代码）
    assert(!css.includes('radial-gradient(ellipse at center, rgba(10,16,24,0.88)')
        && css.includes('.wsl-look {'),
        'S43.2 v3.75 捏脸 .wsl-look 外层径向渐变背景改透明');
    // S43.3 scanPanelOpen 加 typeof 守卫（修复 v3.74 报 "is not a function"）
    const guardCount = (svc.match(/typeof scanPanelOpen === 'function' && scanPanelOpen\(\)/g) || []).length;
    assert(guardCount >= 4,
        `S43.3 v3.75 scanPanelOpen 加 typeof 守卫（≥4 处，实际 ${guardCount} 处）`);
}

// ================= [6]~[9] 子进程调度运行时测试 =================
sub('smoke-test', 'smoke-test.js');
sub('global-drop', 'global-drop-test.mjs');
sub('recipe-flow', 'recipe-flow-test.mjs');
sub('loot-rp-matrix', 'loot-rp-matrix.mjs');

// ---------------- 汇总 ----------------
console.log('\n========================================');
console.log('统一测试汇总（荒原模组 v3.28）');
console.log('========================================');
let totalPass = 0, totalFail = 0;
for (const m of MODULES) {
    totalPass += m.pass; totalFail += m.fail;
    console.log(`  ${m.name.padEnd(12)} ${String(m.pass).padStart(5)} 通过  ${String(m.fail).padStart(3)} 失败`);
}
console.log(`----------------------------------------`);
console.log(`  总计 ${totalPass} 通过, ${totalFail} 失败`);
if (totalFail > 0) process.exit(1);
