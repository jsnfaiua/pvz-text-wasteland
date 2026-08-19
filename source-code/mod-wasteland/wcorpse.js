// ============================================================
// 【无尽植僵荒原】死亡尸变系统
// 从 survival.js 拆出（v4.26）：尸体 → 尸变丧尸（普通僵尸逻辑，继承尸体外观/背包）。
// 依赖：wbalance.js（CORPSE_REVIVE_TAG/SECONDS）/ wzombie.js（spawnZombie）/ audio.js。
// log 通过 setLogger 注入（survival.js 的 log 含 mp 广播，避免循环依赖）。
// ============================================================

import * as B from './wbalance.js';
import * as WZ from './wzombie.js';
import AudioSystem from '../systems/audio.js';

let _logger = () => {};
export function setLogger(fn) { _logger = (typeof fn === 'function') ? fn : () => {}; }
function log(msg, color) { _logger(msg, color); }

// 尸体 → 尸变僵尸（v2.98 起与正常僵尸攻击逻辑完全一致，普通僵尸生成，非精英玩家僵尸）：
//   · 攻击逻辑 = 普通僵尸（近战啃咬、无远程射击、普通伤害/速度/血量随天数成长）；
//   · 室内室外：spawnZombie 已支持 sv.interior（生成进室内僵尸数组，室外进 sv.zombies）；
//   · 单机联机：id 用 sv._zIdSeq（联机快照差分同步），与普通僵尸一致。
//   · 只继承尸体本人的名字与外观（角色/肤色/上衣），不继承远程武器（无远程射击）。
export function corpseReviveZombie(sv, n, roomKey) {
    const contents = (n._corpseContents || []).filter(s => s && s.n > 0);
    const name = (n.name || '幸存者') + B.CORPSE_REVIVE_TAG;
    const z = WZ.spawnZombie(sv, 'normal', n.x, n.y, false);
    z.name = name;                       // 尸变僵尸名（保持"XX（尸变）"）
    // v2.99 用户定稿：尸变丧尸攻击逻辑与正常僵尸一样（主动追玩家/正常寻路，不"留家不追"）
    z.inv = contents.map(s => ({ ...s }));   // 背包守恒：尸体未搜物品给尸变丧尸（被击败掉回尸变尸体）
    // v2.98 外观继承尸体本人（n.look），而非当前主控 sv.character
    if (n.look) {
        z.char = (n.look.skin) ? '亡' : '尸';
        z.skin = n.look.skin || '#78936b';
        z.color = n.look.shirt || '#58656d';
        z.look = n.look;
    }
    z._reviveFromCorpse = true;          // 标记：尸变丧尸（被击败掉尸变尸体）
    z._reviveCorpseName = name;          // 尸变尸体名
    // v3.31 室外模式下室内尸体尸变（roomKey 传入）：把活丧尸从世界数组移除，
    // 序列化转存该房间存档 zombies——玩家进房时 windoor 反序列化，室内坐标正确、不瞬移。
    if (roomKey) {
        const zi = sv.zombies.indexOf(z);
        if (zi >= 0) sv.zombies.splice(zi, 1);
        if (!sv.mods.interiors) sv.mods.interiors = {};
        const room = sv.mods.interiors[roomKey];
        // v3.33 修复"出房后室外尸变，进房丧尸消失"：若房间曾标记 cleared（僵尸全灭才出房），
        // 现在又有尸变丧尸转存进来——必须重置 cleared=0，否则 enterInterior `if(!cleared)` 不恢复 zombies。
        if (room == null || room === 1) sv.mods.interiors[roomKey] = { v: 2, cleared: 0, zombies: [] };
        else if (room.cleared) room.cleared = 0;
        sv.mods.interiors[roomKey].zombies.push({
            id: z.id, type: z.type, char: z.char, color: z.color, name: z.name,
            x: z.x, y: z.y, tx: z.tx, ty: z.ty,
            hp: z.hp, maxHp: z.maxHp, speed: z.speed, damage: z.damage,
            wt: z.wt || 0, biteT: 0, hurt: 0, stunT: 0, horde: false,
            infection: z.infection, textAbility: z.textAbility || null,
            atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false,
            _reviveFromCorpse: true, _reviveCorpseName: name,
            inv: z.inv ? z.inv.map(s => ({ ...s })) : [],
        });
    }
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
    // v4.37 修复"室内尸变丧尸被击败未生成尸变尸体"（用户反馈）：
    // 室内击杀时尸体需放当前房间/楼层（坐标仍在室内），否则在室内看不到且不能交互。
    const _inInt = !!(sv.interior);
    if (!Array.isArray(sv.npcs)) sv.npcs = [];
    sv.npcs.push({
        id: 'rev' + ((sv._revSeq = (sv._revSeq || 0) + 1)),
        isPlayer: false, name: corpseName, role: 'friendly', look: null,
        x: z.x, y: z.y, hp: 0, maxHp: 100, alive: false,
        _corpse: true, _corpseDay: sv.day,
        _corpseAtReal: sv.now != null ? sv.now : 0,   // 记录时刻（尸变尸体不二次尸变）
        _corpseContents: contents, _corpseSearched: false,
        _revivedCorpse: true,   // 标记：尸变尸体（不二次尸变，搜索完彻底消失）
        inInterior: _inInt,
        interiorKey: _inInt && sv.interior.key ? sv.interior.key : null,
        interiorFloor: _inInt && sv.interior.floor != null ? sv.interior.floor : null,
        atkCd: 0, hurtT: 0, idleT: 0, workT: 0, campTask: null, _nextNeed: 2,
    });
    log(`${corpseName} 被击败，留下尸变的尸体（可搜索）……`, '#9fd6ff');
}

// 每帧尸变检测：未尸变的尸体倒计时到 → 尸变（节流 0.25s，防多尸体同时处理开销）
// v2.99 修复"队友尸变的僵尸瞬移到主控身边"：
// 尸变检测在【大世界循环】和【室内循环】各调一次，此前两处都遍历全部尸体——室内尸体
// （inInterior=true）在大世界循环被尸变时，spawnZombie 以 sv.interior 判定场景，主控在室外
// 则僵尸被生成进室外数组、却带着室内坐标 → 坐标错乱，看起来"瞬移到主控身边"。
// 修复：按当前场景过滤——室外模式只尸变室外尸体，室内模式只尸变当前房间的室内尸体。
export function updateCorpseRevive(sv, dt, mode) {
    if (!sv || !Array.isArray(sv.npcs) || !sv.npcs.length) return;
    if (sv._corpseReviveT != null && sv.now - sv._corpseReviveT < 0.25) return;
    sv._corpseReviveT = sv.now;
    const indoor = mode === 'indoor';
    for (let i = sv.npcs.length - 1; i >= 0; i--) {
        const n = sv.npcs[i];
        if (!n._corpse || n._revived) continue;   // 非尸体 / 已尸变跳过
        if (n._revivedCorpse) continue;           // 尸变尸体不二次尸变
        if (indoor) {
            // 室内模式：当前房间+楼层的室内尸体按原逻辑处理；v3.30 室外尸体也放行（见下方生成时切室外数组）
            if (n.inInterior) {
                // v2.99 只尸变当前房间内的尸体（interiorKey 匹配，避免 A 房间尸体在 B 房间尸变坐标错位）
                if (n.interiorKey && sv.interior && sv.interior.key && n.interiorKey !== sv.interior.key) continue;
                // v3.58 尸变计时全局推进（与室外一致），非当前楼层尸体到时间用 roomKey 转存到对应楼层存档
                if (sv.interior && sv.interior.floor != null) {
                    const nf = n.interiorFloor == null ? 1 : n.interiorFloor;
                    if (nf !== sv.interior.floor) {
                        const atI = n._corpseAtReal != null ? n._corpseAtReal : (sv.now || 0);
                        if (sv.now - atI >= B.CORPSE_REVIVE_SECONDS) {
                            n._revived = true;   // 防重入
                            n.party = false;   // v4.23 尸变完成才移除队伍（与 killNpc 推迟 n.party=false 配对）
                            const fkey = (n.interiorKey || 'room') + ':' + nf;
                            try { corpseReviveZombie(sv, n, fkey); } catch (e) { /* 生成失败不阻塞 */ }
                        }
                        continue;
                    }
                }
            }
        } else {
            if (n.inInterior) {
                // v3.31 用户定稿：室外时间加速时，室内等待尸变的尸体也照常尸变——
                // 尸变丧尸转存该房间存档（玩家进房时反序列化，坐标=室内局部坐标不瞬移），log 提示（室外看得到）。
                const atI = n._corpseAtReal != null ? n._corpseAtReal : (sv.now || 0);
                if (sv.now - atI >= B.CORPSE_REVIVE_SECONDS) {
                    n._revived = true;   // 防重入
                    n.party = false;   // v4.23 尸变完成才移除队伍（与 killNpc 推迟 n.party=false 配对）
                    const fkey = (n.interiorKey || 'room') + ':' + (n.interiorFloor == null ? 1 : n.interiorFloor);
                    try { corpseReviveZombie(sv, n, fkey); } catch (e) { /* 生成失败不阻塞 */ }
                }
                continue;
            }
        }
        const at = n._corpseAtReal != null ? n._corpseAtReal : (sv.now || 0);
        if (sv.now - at >= B.CORPSE_REVIVE_SECONDS) {
            n._revived = true;   // 防重入
            if (indoor && !n.inInterior) {
                // v3.30 用户反馈"室内时间加速时室外尸变卡住无提示，出去才一次性尸变"：
                // 室外尸体在室内也照常尸变——临时切到室外世界数组生成（sv._worldZombies）并临时清 sv.interior，
                // 让 spawnZombie 把尸变丧尸放进室外 sv.zombies、用尸体室外坐标 → 不瞬移、不污染当前房间，并照常 log 提示。
                const savedZ = sv.zombies, savedI = sv.interior;
                sv.zombies = sv._worldZombies || savedZ;
                sv.interior = null;
                try { corpseReviveZombie(sv, n); } catch (e) { /* 生成失败不阻塞 */ }
                sv.zombies = savedZ;
                sv.interior = savedI;
            } else {
                try { corpseReviveZombie(sv, n); } catch (e) { /* 生成失败不阻塞 */ }
            }
        }
    }
}
