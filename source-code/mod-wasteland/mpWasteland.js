// ============================================================
// 【无尽植僵荒原】模组 · 联机层（握手升级：双方各自捏脸后同步进入）
// ------------------------------------------------------------
// 复用本体联机传输层 `window.Net.mp`（PeerJS 房间层，net.js:291-455）。
// 设计约束（docs/荒原联机-复用评估与实施设计.md）：
//   - 只 import survival.js 导出 + world.js/wlook.js（叶子），不拖入循环依赖区（R5）
//   - 显式依赖 window.Net（§8-4）；自建 #wmp-* DOM，不触碰 #mp-modal/#game/panel.js（§6-5）
//   - 消息 topic 全部 w 前缀，与本体隔离（§6-4）；退出清理走 setMpCleanupHook（§6-3）
//
// 握手协议（双方各自捏脸）：
//   wstart  host→guest ×1  { seed, difficulty, character:hostLook }  host 捏完脸，下发世界种子
//   wready  guest→host ×1  { character:guestLook }                   guest 捏完脸
//   wgo     host→guest ×1  {}                                        host 确认，双端同时进入
//   wpos    双向  200ms    { x,y,faceX,faceY,moving,frame,run,hp,character,name } 位置同步
//   wsync   host→guest 100ms  { t,day,hordePhase,zombies,npcs,hostPlayer,guestHp } 世界权威快照
//   wevt    双向  即时      { type:'kill'|'day'|'horde'|'loot'|'fx'|'atk', ... } 事件/特效
//   wrejoin guest→host ×1  {}                                        客人断线重连后请求状态重同步
// ============================================================

import { enterWasteland, exitWasteland, setMpCleanupHook, getLocalPlayerState, setRemotePlayerState, clearRemotePlayer, applyMpSnapshot, playMpEvent, getMpSnapshot, takeMpOutbox, removeZombieById, hostApplyGuestAttack, applyWorldDiff, applyWorldMods, getWorldMods, removeDrop, addDrop, applyChestSync, applyBoxLootSync, applyPlantSync, applyFxEvent, applyDevFlags, applyHireEvent, applyNpcCtl, applyNpcInvSync, getMpControlledNpc, showCreateCharacter, loadCharacterData, saveCharacterData, currentCharacterName } from './survival.js';
import AudioSystem from '../systems/audio.js';
import * as WDEV from './wdev.js';
import { newSeed } from './world.js';

// ---------- 状态 ----------
let ui = null;              // 弹窗根元素
let statusEl = null;        // 状态栏
let started = false;        // 是否已进入荒原（联机中）
let destroying = false;     // 防重入清理
let sessionOpts = {};       // 会话选项（difficulty 等）
let role = null;            // 'host' | 'guest' | null
let hostSeed = null;        // host 生成的世界种子
let hostLook = null;        // host 捏脸结果
let guestLook = null;       // guest 捏脸结果
let wstartData = null;      // guest 侧暂存 {seed, difficulty, hostName}
let posTimer = null;        // 位置同步定时器
let syncTimer = null;       // wsync 快照定时器（host 100ms）
let outboxTimer = null;     // wevt 出站中继（双方 50ms）
let hostName = null;        // host 角色名
let guestName = null;       // guest 角色名
let myGuestId = null;       // guest 自身身份（3+ 人：host 按此区分多个队友）
const guestPeers = {};      // host 侧：connPeer → guestId（wready 握手时登记）
let readyCount = 0;         // host 侧：已就绪 guest 数（等全部就绪才开局）

// ---------- 工具 ----------
function mp() { return window.Net && window.Net.mp ? window.Net.mp : null; }
// 连接失败提示增强：根据访问方式给出可操作建议（局域网联机最常见失败原因：防火墙/未起 server）
function connErrHint() {
    const h = location.hostname || '';
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(h);
    const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || isIp;
    if (isLocal) {
        return '（已用本地 PeerServer：请确认房主电脑已运行 node server.js，且防火墙已放行 8000/9000 端口）';
    }
    return '（域名访问走公共云：局域网联机请直接用 http://房主IP:8000 访问）';
}
function setStatus(text, color) {
    if (statusEl) {
        statusEl.textContent = text;
        if (color) statusEl.style.color = color;
    }
    // 游戏进行中（弹窗已关闭）：用局内悬浮 toast 提示联机状态（重连中等）
    if (started && typeof document !== 'undefined') showGameToast(text, color);
}

// ---------- 在线人数显示（3+ 人房间） ----------
let onlineEl = null;
function updateOnline() {
    if (!onlineEl) return;
    const net = mp();
    if (!net) return;
    const cap = (net.MAX_PLAYERS || 4);
    if (role === 'host') {
        const n = net.conns ? net.conns.size + 1 : 1;   // host + 已连接客人
        onlineEl.textContent = `在线 ${n}/${cap}`;
    } else {
        onlineEl.textContent = `在线 2/${cap}`;   // 房主 + 自己（其他客人数量未广播，保持保守显示）
    }
}

// ---------- 局内 toast（弹窗关闭后重连状态的唯一可见通道；非重连类提示短暂自动消失） ----------
let toastEl = null, toastTimer = null;
function showGameToast(text, color, sticky) {
    if (typeof document === 'undefined') return;
    if (!toastEl || !toastEl.parentNode) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1150;background:rgba(10,14,18,0.92);border:1px solid #e8c46a;border-radius:6px;padding:6px 16px;color:#e8c46a;font-size:13px;font-family:"Microsoft YaHei",monospace;pointer-events:none;';
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.color = color || '#e8c46a';
    toastEl.style.borderColor = color || '#e8c46a';
    toastEl.style.display = 'block';
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    // 重连中/等待重连类提示常驻（sticky），其余 3s 自动消失
    if (!sticky && !/重连|中断/.test(text)) {
        toastTimer = setTimeout(() => { if (toastEl) toastEl.style.display = 'none'; }, 3000);
    }
}
function hideGameToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastEl) toastEl.style.display = 'none';
}

// ---------- UI（z-index 1100 < 捏脸 1200，保证捏脸盖在联机弹窗之上） ----------
function buildUI(roleArg) {
    const root = document.createElement('div');
    root.id = 'wmp-overlay';
    root.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(5,8,12,0.85);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei",monospace;';
    const isHost = roleArg === 'host';   // 注意：形参名不可叫 role，会遮蔽模块级 role
    const RECENT_KEY = 'wasteland_recent_room';
    const recentRoom = (() => {
        try { const v = localStorage.getItem(RECENT_KEY); return v && /^[A-Za-z0-9]{6}$/.test(v) ? v : null; } catch { return null; }
    })();
    const title = isHost ? '◈ 荒原联机 · 房 主' : '◈ 荒原联机 · 加入者';
    const sub = isHost
        ? '创建房间 · 把房间码或邀请链接发给好友 · 好友加入后双方各自捏脸'
        : '输入房主的 6 位房间码加入 · 加入后等待房主发起，再捏脸确认外观';
    root.innerHTML = `
        <div style="background:#141a22;border:2px solid ${isHost ? '#39d98a' : '#e8c46a'};border-radius:10px;padding:22px 26px;width:460px;box-shadow:0 0 40px rgba(57,217,138,0.2);color:#dce6e2;">
            <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:4px;">
                <span style="color:${isHost ? '#39d98a' : '#e8c46a'};font-size:20px;letter-spacing:4px;">${title}</span>
                <span style="background:${isHost ? '#123d2c' : '#3d3520'};color:${isHost ? '#39d98a' : '#e8c46a'};border:1px solid ${isHost ? '#39d98a' : '#e8c46a'};border-radius:4px;padding:1px 8px;font-size:11px;">${isHost ? 'HOST' : 'GUEST'}</span>
            </div>
            <div style="text-align:center;color:#7a8a92;font-size:12px;margin-bottom:16px;">${sub}</div>
            ${isHost ? `
            <div style="margin-bottom:12px;">
                <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">房间码（发给好友）：</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <span id="wmp-code" style="flex:1;text-align:center;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;font-size:20px;letter-spacing:4px;color:#39d98a;">------</span>
                    <button id="wmp-copy" style="background:#1d2a24;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:8px 12px;cursor:pointer;">复制</button>
                </div>
            </div>
            <div style="margin-bottom:12px;">
                <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">邀请链接（好友打开即自动加入）：</div>
                <div id="wmp-url" style="background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;font-size:12px;color:#7fb39a;word-break:break-all;">生成中...</div>
            </div>` : `
            <div style="margin-bottom:12px;">
                <div style="color:#9fb3ab;font-size:13px;margin-bottom:6px;">输入房主的 6 位房间码：</div>
                <input id="wmp-code-input" maxlength="6" placeholder="例如 A3F7Q9" style="width:100%;box-sizing:border-box;background:#0e1318;border:1px solid #2a3a33;border-radius:6px;padding:8px;color:#dce6e2;font-size:16px;letter-spacing:3px;text-transform:uppercase;">
                ${recentRoom ? `<button id="wmp-recent" style="margin-top:6px;width:100%;background:#1d2a24;border:1px dashed #e8c46a;color:#e8c46a;border-radius:6px;padding:7px;cursor:pointer;font-size:12px;">最近房间：${recentRoom} · 快速加入 ⚡</button>` : ''}
            </div>`}
            <div style="text-align:center;color:#7fb39a;font-size:12px;margin-bottom:4px;" id="wmp-online">在线 --/4</div>
            <div style="text-align:center;color:#e8c46a;font-size:13px;min-height:20px;margin-bottom:12px;" id="wmp-status">未连接</div>
            <div style="display:flex;gap:8px;justify-content:center;">
                <button id="wmp-cancel" style="flex:1;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:9px;cursor:pointer;">关闭</button>
                <button id="wmp-action" style="flex:2;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:9px;cursor:pointer;">${isHost ? '等待好友加入...' : '加入房间'}</button>
            </div>
        </div>`;
    document.body.appendChild(root);
    ui = root;
    statusEl = root.querySelector('#wmp-status');
    onlineEl = root.querySelector('#wmp-online');
    updateOnline();   // 初始人数（host 1/4；guest join 后 onStatus 更新）
    return root;
}

// 仅关闭弹窗 UI（游戏运行期间保留监听与退出 hook）
function closeUI() {
    if (ui && ui.parentNode) ui.parentNode.removeChild(ui);
    ui = null; statusEl = null;
}

// 完整清理联机会话（幂等）：关 UI + 注销监听 + 关闭传输 + 清 hook + 复位会话状态
export function cleanupWastelandMP() {
    if (destroying) return;
    destroying = true;
    stopPosSync();
    stopWsync();
    stopOutboxRelay();
    clearRemotePlayer();
    const net = mp();
    if (net) {
        net.off('status', onStatus);
        net.off('wstart', onWstart);
        net.off('wready', onWready);
        net.off('wgo', onWgo);
        net.off('wpos', onWpos);
        net.off('wsync', onWsync);
        net.off('wevt', onWevt);
        net.off('winit', onWinit);
        net.off('wrejoin', onWrejoin);
        net.close(true);            // 静默关闭：主动退出不广播
    }
    closeUI();
    hideGameToast();
    started = false;
    role = null; hostSeed = null; hostLook = null; guestLook = null; wstartData = null;
    hostName = null; guestName = null;
    readyCount = 0;   // 3+ 人就绪计数重置
    setMpCleanupHook(null);
    destroying = false;
}

// 进入游戏：关弹窗但保留监听/hook，标记联机进行中，启动同步
function beginGame(opts) {
    started = true;
    closeUI();
    enterWasteland(opts);
    startPosSync();
    startOutboxRelay();
    if (role === 'host') {
        startWsync();
        // 进入后立即下发世界基线（mods 全量），guest 应用后双方世界一致
        setTimeout(sendWorldInit, 300);
    }
}

// ---------- 位置同步（wpos 双向 200ms 一拍） ----------
function startPosSync() {
    stopPosSync();
    posTimer = setInterval(() => {
        if (!started) return;
        const net = mp();
        const st = getLocalPlayerState();
        if (net && st) {
            if (myGuestId) st.guestId = myGuestId;   // 3+ 人：host 按此写独立队友槽
            net.send('wpos', st);
            // guest 正操控 NPC（切换视角）：同步上报位置，host 让渡该 NPC 的 AI
            if (role === 'guest') {
                const ctl = getMpControlledNpc();
                if (ctl) net.send('wevt', { type: 'npcctl', ...ctl, from: role, guestId: myGuestId });
            }
        }
    }, 200);
}
function stopPosSync() {
    if (posTimer) { clearInterval(posTimer); posTimer = null; }
}
function onWpos(data) {
    if (!started || !data || typeof data.x !== 'number') return;
    // 3+ 人：按 guestId 写入独立队友槽（无 guestId 回退单队友，1v1 兼容）
    setRemotePlayerState(data, data.guestId);
    if (role === 'host') guestPos = { x: data.x, y: data.y, guestId: data.guestId };   // host 记住 guest 位置（咬伤/攻击判定用）
}
let guestPos = null;   // host 侧记住 guest 最近位置（wpos 更新）

// ---------- wsync 世界权威快照（host → guest 100ms；NPC 全量每 500ms 随包下发控包体） ----------
let syncTick = 0;
function startWsync() {
    stopWsync();
    syncTick = 0;
    syncTimer = setInterval(() => {
        if (!started || role !== 'host') return;
        const net = mp();
        if (!net || !net.isConnected()) return;
        syncTick++;
        const snap = getMpSnapshot(syncTick % 5 === 0);
        if (snap) net.send('wsync', snap);
    }, 100);
}
function stopWsync() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}
function onWsync(data) {
    if (started && role === 'guest' && data) {
        applyMpSnapshot(data, myGuestId);   // guestId：3+ 人按身份取自己的权威血量
        if (data.dev) WDEV.applyDevSync();   // dev 标志（host 权威）→ 刷新面板按钮图标
    }
}

// ---------- 联机动作音效（sfx wevt）：对端的伐木/开采/枪声/挥砍/受击音，与单机体验一致 ----------
function playRemoteSfx(evt) {
    switch (evt.snd) {
        case 'chopTree': AudioSystem.playChopTree(); break;
        case 'treeFall': AudioSystem.playTreeFall(); break;
        case 'digStone': AudioSystem.playDigStone(); break;
        case 'stoneBreak': AudioSystem.playStoneBreak(); break;
        case 'swing': AudioSystem.playWeaponSwing(evt.w); break;
        case 'shot': if (evt.bow) AudioSystem.playBowFire(); else AudioSystem.playWeaponShot(evt.w, evt.iv); break;
        case 'reload': AudioSystem.playWeaponReload(evt.w); break;
        case 'zhit':
            if (evt.z === 'bucket') AudioSystem.playBucketHurt();
            else if (evt.z === 'cone') AudioSystem.playArmoredHurt();
            else AudioSystem.playHit();
            break;
    }
}

// ---------- wevt 事件（双向即时） ----------
// meta.conn：host 侧据此定位消息来源客人（3+ 人转发排除发送者，防回听）
function onWevt(evt, meta) {
    if (!started || !evt) return;
    // P1-3 健壮性：单条畸形/未知结构消息（协议演进期、旧版本客户端）不得中断
    // 该批次其余消息处理；记录 warn 便于诊断
    try {
        dispatchWevt(evt, meta);
    } catch (e) {
        console.warn('[wasteland-mp] wevt 处理失败（已跳过单条）:', (e && e.message) || e, '| type=', evt && evt.type);
    }
}
function dispatchWevt(evt, meta) {
    // 双方都需处理的全局事件（camp 营地 / pause 暂停 / plant 植物变更——直接本地应用，不广播防回环）
    // 注：interior 室内进出已改为各自独立（不再广播），故此处不处理 interior 事件
    if (evt.type === 'camp' || evt.type === 'pause') { playMpEvent(evt); return; }
    if (evt.type === 'plant') { applyPlantSync(evt.key, evt.p); return; }
    if (evt.type === 'sfx') {
        playRemoteSfx(evt);   // 动作音效：双端互听
        // 3+ 人：guest 上报的音效 → host 转发给其他客人（排除发送者；host 自己的音效走 outbox 直达全员）
        if (role === 'host' && evt.from === 'guest') {
            const net = mp();
            if (net) net.send('wevt', evt, meta && meta.conn ? { exclude: meta.conn.peer } : null);
        }
        return;
    }
    if (role === 'guest') {
        if (evt.type === 'diff') applyWorldDiff(evt);   // 房主世界修改 → 客人应用
        else if (evt.type === 'chest') applyChestSync(evt.key, evt.items);       // 箱子内容（双向）
        else if (evt.type === 'boxloot') applyBoxLootSync(evt.key, evt.items, evt.searched);   // 搜索容器（双向）
        else if (evt.type === 'devcmd') WDEV.applyDevCmd(evt);   // host 广播的召唤（NPC 等）→ 客人端也生成
        else playMpEvent(evt);                          // host 广播的击杀/昼夜/尸潮/播报/特效/死亡
    } else if (role === 'host') {
        if (evt.type === 'kill' && evt.from === 'guest') {
            // guest 上报的击杀（室外 atk 裁决 / 室内本地击杀）：host 移除本地僵尸 + 广播给其他客人
            // 3+ 人：排除发送者（其本地已结算，且 _mpLocalKills 只防转发回包、不防旁听）
            if (evt.id != null) removeZombieById(evt.id);
            const net = mp();
            if (net) net.send('wevt', { type: 'kill', id: evt.id, x: evt.x, y: evt.y, from: 'host' }, meta && meta.conn ? { exclude: meta.conn.peer } : null);
        } else if (evt.type === 'atk' && (guestPos || evt.px != null || evt.melee)) {
            // guest 攻击上报：host 权威判定僵尸受击（近战/远程）
            // 攻击者位置：优先 evt.px/py（3+ 人多 guest 防 guestPos 串位）；近战 evt.x/y 即攻击者；回退 guestPos
            const ax = evt.px != null ? evt.px : (evt.melee ? evt.x : (guestPos ? guestPos.x : 0));
            const ay = evt.py != null ? evt.py : (evt.melee ? evt.y : (guestPos ? guestPos.y : 0));
            const killed = hostApplyGuestAttack(evt, ax, ay);
            if (killed) {
                const net = mp();
                if (net) net.send('wevt', { type: 'kill', id: killed.killed, x: killed.x, y: killed.y, from: 'host' });
            }
        } else if (evt.type === 'diff') {
            // guest 世界修改上报（wdiff）：host 权威应用 → saveNow 落世界档
            applyWorldDiff(evt);
        } else if (evt.type === 'pickup') {
            // guest 拾取了掉落：host 移除对应掉落（下次 wsync 双端一致）
            removeDrop(evt.x, evt.y, evt.id);
        } else if (evt.type === 'drop') {
            // guest 丢出的掉落：host 权威入库（wsync 下发双端一致）
            addDrop(evt.x, evt.y, evt.id, evt.n);
        } else if (evt.type === 'chest') {
            // guest 箱子内容变更 → host 应用
            applyChestSync(evt.key, evt.items);
        } else if (evt.type === 'boxloot') {
            // guest 搜索容器内容变更 → host 应用
            applyBoxLootSync(evt.key, evt.items, evt.searched);
        } else if (evt.type === 'fx') {
            // guest 弹幕特效上报（muzzle 枪口火光等）→ host 应用（wsync 回传双端可见）
            applyFxEvent(evt);
        } else if (evt.type === 'devcmd') {
            // guest 开发者召唤（僵尸/尸潮/清屏/NPC）→ host 权威执行；NPC 需转发 guest（npcs 不进 wsync）
            WDEV.applyDevCmd(evt);
            if (evt.cmd === 'npc') {
                const net = mp();
                if (net) net.send('wevt', { type: 'devcmd', cmd: 'npc', kind: evt.kind });
            }
        } else if (evt.type === 'devflags') {
            // guest 开发者标志（无敌/无限弹药等共用）→ host 权威应用（wsync 回传双端图标一致）
            applyDevFlags(evt.flags);
            WDEV.applyDevSync();
        } else if (evt.type === 'npcctl') {
            // guest 操控 NPC（切换视角）：host 让渡该 NPC 的 AI，位置按上报写入
            applyNpcCtl(evt);
        } else if (evt.type === 'npcinv') {
            // guest 与 NPC 交易成交：host 覆写 NPC 背包/金币（双端一致 + 入世界档）
            applyNpcInvSync(evt.id, evt.inv, evt.coins);
        } else if (evt.type === 'hire') {
            // guest 雇佣 NPC → host 权威应用（同 id 设置 / 无则创建）→ host 世界档持久化（M2）
            applyHireEvent(evt);
        }
    }
}

// ---------- winit 世界基线（host 进入后下发 mods 全量；guest 应用后走双向 wdiff 增量） ----------
function sendWorldInit() {
    const net = mp();
    const mods = getWorldMods();
    if (net && mods) net.send('winit', { mods });
}
function onWinit(data) {
    if (role === 'guest' && data && data.mods) applyWorldMods(data.mods);
}

// ---------- wrejoin 断线重连重同步（guest 重连成功 → host 重发世界基线 + 立即补快照） ----------
function onWrejoin() {
    if (role !== 'host' || !started) return;
    sendWorldInit();
    const net = mp();
    const snap = getMpSnapshot();
    if (net && snap) net.send('wsync', snap);
}

// ---------- 事件出站中继（双方 50ms 取 outbox 发送；atk 节流防刷屏） ----------
let lastAtkSent = 0;
function startOutboxRelay() {
    stopOutboxRelay();
    outboxTimer = setInterval(() => {
        if (!started) return;
        const net = mp();
        if (!net || !net.isConnected()) return;
        const arr = takeMpOutbox();
        if (!arr || !arr.length) return;
        // atk 节流：50ms 窗口内最多 1 条攻击上报（防连射刷屏）
        const now = performance.now();
        for (const evt of arr) {
            if (evt.type === 'atk' && now - lastAtkSent < 60) continue;
            if (evt.type === 'atk') lastAtkSent = now;
            net.send('wevt', { ...evt, from: role, guestId: myGuestId });   // guestId：host 端定位来源队友（3+ 人）
        }
    }, 50);
}
function stopOutboxRelay() {
    if (outboxTimer) { clearInterval(outboxTimer); outboxTimer = null; }
}

// ---------- 握手 ----------
function onStatus(data) {
    if (data.status === 'connected') {
        if (data.reconnected) {
            // 断线重连成功：游戏进行中→请求状态重同步；未开局→恢复 UI 状态
            setStatus('重连成功！', '#39d98a');
            hideGameToast();
            if (started && role === 'guest') {
                const net = mp();
                if (net) net.send('wrejoin', {});
            }
            return;
        }
        setStatus('已连接！', '#39d98a');
        updateOnline();   // guest 加入成功：在线人数更新
        if (role === 'host') {
            const btn = document.getElementById('wmp-action');
            if (btn) { btn.textContent = '开始荒原联机 ▶'; btn.disabled = false; }
        }
    } else if (data.status === 'reconnecting') {
        // 重连中：游戏保持运行（本地世界继续），不退出；超过重试上限才散场
        setStatus(`连接中断，正在重连(${data.attempt || 1}/8)...`, '#e8c46a');
    } else if (data.status === 'guest-disconnected') {
        // 房主侧：客人掉线等待重连（游戏继续，wsync 在 isConnected 为 false 时自动跳过）
        setStatus('好友连接中断，等待其重连...', '#e8c46a');
        updateOnline();   // 在线人数 -1
    } else if (data.status === 'full') {
        // 房主侧：房间满员（4 人），新玩家被拒连（net 层已告知对方原因）
        setStatus(`房间已满员（${(mp() && mp().maxPlayers) || 4} 人上限），新玩家无法加入`, '#e0a0a0');
    } else if (data.status === 'closed') {
        if (started) {
            const wasStarted = started;
            cleanupWastelandMP();
            if (wasStarted) exitWasteland(true);
        } else {
            setStatus('连接已断开', '#e0a0a0');
        }
    } else if (data.status === 'error') {
        setStatus('连接错误: ' + (data.error || '未知') + connErrHint(), '#e0a0a0');
    }
}

// 确保角色就绪：有角色档（sessionOpts.characterName / profile）直接用；无则创建（命名+捏脸）
function ensureCharacter(which, cb) {
    const name = (which === 'host' && sessionOpts.characterName) || currentCharacterName() || null;
    const saved = loadCharacterData(name);
    if (saved) { cb(saved); return; }
    setStatus('请先创建你的角色（物品/属性随角色跨世界保留）...', '#e8c46a');
    showCreateCharacter((n, look) => {
        const cd = {
            name: n,
            character: look,
            inv: [], hotbar: [], curSlot: 'ranged',
            hp: 100, maxHp: 100, food: 100, water: 100, infection: 0,
            stamina: 100, maxStamina: 100, wpnMag: {}, _devInfBag: false,
        };
        saveCharacterData(cd);
        cb(cd);
    });
}

// host 点「开始荒原联机」：确保角色 → 用指定种子（workshop 选择/旧世界种子）或随机 → 发 wstart
function hostStart() {
    const net = mp();
    if (!net || !net.isConnected()) { setStatus('尚未连接，请等待好友加入', '#e0a0a0'); return; }
    const btn = document.getElementById('wmp-action');
    if (btn) btn.disabled = true;
    ensureCharacter('host', (charData) => {
        if (!mp() || !mp().isConnected()) { setStatus('连接已断开，无法开始', '#e0a0a0'); return; }
        hostLook = charData.character;
        hostName = charData.name;
        // 世界种子：房主在 workshop 选的种子（有存档则恢复世界，双方修改也存这里）
        hostSeed = sessionOpts.seed != null ? sessionOpts.seed : newSeed();
        mp().send('wstart', {
            seed: hostSeed,
            difficulty: sessionOpts.difficulty || 'normal',
            character: hostLook,
            hostName,
        });
        setStatus(`已发送世界种子 #${hostSeed}，等待好友准备角色...`, '#39d98a');
    });
}

// guest 收到 wstart：确保自己的角色（有档直接用/无档创建）→ 发 wready
function onWstart(data) {
    if (role !== 'guest' || !data || typeof data.seed !== 'number') return;
    wstartData = { seed: data.seed, difficulty: data.difficulty || 'normal', hostName: data.hostName };
    setStatus(`房主（${data.hostName || '房主'}）已就绪，准备你的角色...`, '#e8c46a');
    // 3+ 人：guest 生成唯一身份（host 端按此写入独立队友槽 p2s[guestId]）
    if (!myGuestId) myGuestId = 'g' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    ensureCharacter('guest', (charData) => {
        if (!mp() || !mp().isConnected()) { setStatus('连接已断开', '#e0a0a0'); return; }
        guestLook = charData.character;
        guestName = charData.name;
        setStatus('角色就绪，等待房主开始...', '#39d98a');
        mp().send('wready', { character: guestLook, guestName, guestId: myGuestId });
    });
}

// host 收到 wready：全部好友角色就绪 → 单次开局（3+ 人：等所有已连接 guest 都就绪，
// 避免每个 wready 都触发 beginGame/wgo 造成重复开局）
function onWready(data, meta) {
    if (role !== 'host' || hostSeed === null) return;
    // 3+ 人：登记 connPeer → guestId（wpos/wevt 按 meta.conn 定位队友槽）
    if (meta && meta.conn && data && data.guestId) guestPeers[meta.conn.peer] = data.guestId;
    updateOnline();   // 在线人数 +1
    readyCount++;
    const net = mp();
    const total = net && net.conns ? net.conns.size : 1;
    if (readyCount < total) {
        setStatus(`好友已就绪（${readyCount}/${total}），等待其他好友准备角色...`, '#39d98a');
        return;
    }
    setStatus('好友已就绪，进入荒原...', '#39d98a');
    mp().send('wgo', {});
    beginGame({
        seed: hostSeed,                       // 指定种子：有存档则恢复世界（含双方修改）
        difficulty: sessionOpts.difficulty || 'normal',
        character: hostLook,
        characterName: hostName,
        mp: { role: 'host' },
    });
}

// guest 收到 wgo：host 确认 → 进入（加载自己角色档；世界状态由 wsync 覆写，不落本地世界档）
function onWgo() {
    if (role !== 'guest' || !wstartData || !guestLook) return;
    beginGame({
        seed: wstartData.seed,
        difficulty: wstartData.difficulty,
        character: guestLook,
        characterName: guestName,
        mp: { role: 'guest' },
    });
}

// ---------- 入口 ----------
// role: 'host' | 'guest'；opts: workshop 传入的模组选项；autoCode: 邀请链接自动加入的房间码
export async function startWastelandMP(roleArg, opts, autoCode) {
    cleanupWastelandMP();           // 幂等清理残留会话
    sessionOpts = opts || {};
    role = roleArg;
    if (typeof window === 'undefined') { console.error('[wasteland-mp] 仅浏览器可用'); return; }
    if (!window.Net || !window.Net.mp) {
        console.error('[wasteland-mp] 联机层未加载（window.Net 缺失，请先刷新页面）');
        return;
    }

    const net = window.Net.mp;
    const isHost = role === 'host';
    const root = buildUI(role);     // 传字符串 role（不是 boolean）

    net.on('status', onStatus);
    net.on('wstart', onWstart);
    net.on('wready', onWready);
    net.on('wgo', onWgo);
    net.on('wpos', onWpos);
    net.on('wsync', onWsync);
    net.on('wevt', onWevt);
    net.on('winit', onWinit);
    net.on('wrejoin', onWrejoin);
    setMpCleanupHook(cleanupWastelandMP);

    root.querySelector('#wmp-cancel').addEventListener('click', () => {
        cleanupWastelandMP();
        if (started) exitWasteland(true);
    });

    if (isHost) {
        root.querySelector('#wmp-copy').addEventListener('click', () => {
            const code = document.getElementById('wmp-code').textContent;
            navigator.clipboard.writeText(code).then(() => setStatus('房间码已复制！', '#39d98a'));
        });
        root.querySelector('#wmp-action').addEventListener('click', hostStart);
        const r = await net.host();
        if (r.ok) {
            document.getElementById('wmp-code').textContent = r.code;
            setStatus('房间已创建，等待好友加入...', '#e8c46a');
            const url = await buildShareURL(r.code);
            const urlEl = document.getElementById('wmp-url');
            if (urlEl) { urlEl.textContent = url; urlEl.title = url; }
        } else {
            setStatus('创建失败: ' + r.error, '#e0a0a0');
        }
    } else {
        const input = root.querySelector('#wmp-code-input');
        const doJoin = async () => {
            const code = input.value.trim();
            if (!code) { setStatus('请输入房间码', '#e0a0a0'); return; }
            setStatus('正在连接...', '#e8c46a');
            const r = await net.join(code);
            if (r.ok) {
                setStatus('连接成功！等待房主开始', '#39d98a');
                input.disabled = true;
                // 记录最近房间（下次打开加入面板可一键重进）
                try { localStorage.setItem(RECENT_KEY, code); } catch {}
            } else {
                setStatus('连接失败: ' + r.error + connErrHint(), '#e0a0a0');
            }
        };
        root.querySelector('#wmp-action').addEventListener('click', doJoin);
        const recentBtn = root.querySelector('#wmp-recent');
        if (recentBtn) {
            recentBtn.addEventListener('click', () => {
                // handler 与 buildUI 不同作用域：直接读 localStorage（键与 buildUI 内 RECENT_KEY 同值）
                let code = '';
                try { code = localStorage.getItem('wasteland_recent_room') || ''; } catch {}
                if (/^[A-Za-z0-9]{6}$/.test(code)) { input.value = code; doJoin(); }
                else setStatus('最近房间已失效，请手动输入', '#e0a0a0');
            });
        }
        if (autoCode) {
            input.value = autoCode;
            input.disabled = true;
            doJoin();
        }
    }
}

// ---------- 邀请链接（IP + 房间码，?wroom= 与本体 ?room= 隔离） ----------
async function buildShareURL(code) {
    const path = () => `${location.pathname}?wroom=${code}`;
    const base = () => location.origin + path();
    if (!/^(localhost|127\.)/.test(location.hostname)) return base();
    try {
        const r = await fetch('/__localip', { cache: 'no-store' });
        if (r.ok) {
            const ip = (await r.text()).trim();
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
                return `http://${ip}${location.port ? ':' + location.port : ''}${path()}`;
            }
        }
    } catch {}
    return base();
}

// 页面加载时检测 ?wroom= 邀请链接 → 自动进入荒原加入流程（game-init.js 调用）
export function tryAutoJoinWastelandFromURL() {
    const code = new URLSearchParams(location.search).get('wroom');
    if (!code || !/^[A-Za-z0-9]{6}$/.test(code)) return false;
    const url = new URL(location.href);
    url.searchParams.delete('wroom');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    startWastelandMP('guest', {}, code.toUpperCase());
    return true;
}

export default { startWastelandMP, cleanupWastelandMP, tryAutoJoinWastelandFromURL };
