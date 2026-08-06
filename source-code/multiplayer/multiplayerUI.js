// ============================================================
// 多人联机 UI 绑定
// ============================================================

import { showScreen, showModal, hideModal } from '../ui/screens.js';
import { startMultiplayerGame } from './mpGame.js';
import { openCardSelect } from '../ui/cardSelect.js';
import { LEVELS } from '../core/constants.js';
import { saveData } from '../core/state.js';

// 房主可选关卡：已通关的 + 下一关（与单机解锁规则一致）
function unlockedLevels() {
    return LEVELS.filter((lv, i) =>
        i === 0 || saveData.cleared.includes(lv.id) || saveData.cleared.includes(LEVELS[i - 1].id));
}

// 在"开始游戏"按钮上方动态插入关卡下拉框（避免改动 HTML 结构）
function refreshLevelSelect() {
    const startBtn = document.getElementById('mp-start');
    if (!startBtn) return;
    let sel = document.getElementById('mp-level-select');
    if (!sel) {
        sel = document.createElement('select');
        sel.id = 'mp-level-select';
        sel.style.cssText = 'display:block;width:100%;margin:6px 0;padding:6px 8px;background:#1a1a2e;color:#eee;border:1px solid #444;border-radius:6px;';
        startBtn.parentNode.insertBefore(sel, startBtn);
    }
    const prev = sel.value;
    sel.innerHTML = '';
    for (const lv of unlockedLevels()) {
        const opt = document.createElement('option');
        opt.value = lv.id;
        opt.textContent = `${lv.id} ${lv.name}`;
        sel.appendChild(opt);
    }
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// 房间准备状态：客人点「准备」→ mpready 上报；房主需等客人准备后才能开局（与荒原 wready 握手对齐）
let guestReady = false;        // 客人本机：自己是否已准备（重连后重发）
let hostSeesReady = false;     // 房主本机：客人是否已准备

// 客人侧：动态插入/移除「准备」按钮（接在状态栏上方，不改 HTML 结构）
function showReadyButton(show) {
    const statusEl = document.getElementById('mp-status');
    let btn = document.getElementById('mp-ready-btn');
    if (!show) { if (btn) btn.remove(); return; }
    if (!statusEl) return;
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'mp-ready-btn';
        btn.style.cssText = 'display:block;width:100%;margin:6px 0;padding:8px;background:#1a2e1a;color:#8ce99a;border:1px solid #4a7;border-radius:6px;cursor:pointer;font-size:14px;';
        btn.addEventListener('click', () => {
            guestReady = !guestReady;
            Net.mp.send('mpready', { ready: guestReady });
            btn.textContent = guestReady ? '✓ 已准备（点击取消）' : '准备就绪 ▶';
            setMPStatus(guestReady ? '已准备，等待房主开始游戏' : '已取消准备');
        });
        statusEl.parentNode.insertBefore(btn, statusEl);
    }
    btn.textContent = guestReady ? '✓ 已准备（点击取消）' : '准备就绪 ▶';
}

// 房主侧：根据客人准备状态刷新开局按钮可用性
function refreshHostStartGate() {
    const startBtn = document.getElementById('mp-start');
    if (!startBtn) return;
    startBtn.disabled = !hostSeesReady;
    startBtn.title = hostSeesReady ? '' : '等待好友准备后才能开始';
}

export function initMultiplayerUI() {
    const mpBtn = document.getElementById('btn-multiplayer');
    if (mpBtn) {
        mpBtn.addEventListener('click', () => {
            showModal('mp-modal');
            resetMPUI();
        });
    }

    const closeBtn = document.getElementById('mp-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            Net.mp.close();
            hideModal('mp-modal');
        });
    }

    const hostBtn = document.getElementById('mp-host-btn');
    if (hostBtn) {
        hostBtn.addEventListener('click', async () => {
            setMPStatus('正在创建房间...');
            // 本体联机仅支持 1v1（客人共用 dave2 单槽）：建房容量置 2，第三人会收到满员拒连
            Net.mp.MAX_PLAYERS = 2;
            const result = await Net.mp.host();
            if (result.ok) {
                document.getElementById('mp-room-info').classList.remove('hidden');
                document.getElementById('mp-room-code').textContent = result.code;
                // 生成邀请链接：好友打开后登录即自动加入（localhost 自动替换为局域网 IP）
                const url = await buildShareURL(result.code);
                const urlRow = document.getElementById('mp-room-url-row');
                const urlEl = document.getElementById('mp-room-url');
                if (urlRow && urlEl) {
                    urlEl.textContent = url;
                    urlEl.title = url;
                    urlRow.classList.remove('hidden');
                }
                document.getElementById('mp-url-hint')?.classList.remove('hidden');
                if (/^https?:\/\/(localhost|127\.)/.test(url)) {
                    // 服务器未提供局域网 IP：链接仅本机可用，明确告知房主
                    setMPStatus('房间已创建，但获取局域网 IP 失败，当前链接仅本机可用。请确认用 ps-server.ps1 启动（建议管理员运行一次以放行防火墙）');
                } else {
                    setMPStatus('等待玩家加入...');
                }
            } else {
                setMPStatus(`创建失败: ${result.error}`);
            }
        });
    }

    const copyUrlBtn = document.getElementById('mp-copy-url');
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => {
            const url = document.getElementById('mp-room-url').textContent;
            navigator.clipboard.writeText(url).then(() => {
                copyUrlBtn.textContent = '已复制!';
                setTimeout(() => copyUrlBtn.textContent = '复制链接', 1500);
            });
        });
    }

    const copyBtn = document.getElementById('mp-copy');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const code = document.getElementById('mp-room-code').textContent;
            navigator.clipboard.writeText(code).then(() => {
                copyBtn.textContent = '已复制!';
                setTimeout(() => copyBtn.textContent = '复制', 1500);
            });
        });
    }

    const joinBtn = document.getElementById('mp-join-btn');
    if (joinBtn) {
        joinBtn.addEventListener('click', async () => {
            const input = document.getElementById('mp-code-input');
            const code = input.value.trim();
            if (!code) {
                setMPStatus('请输入房间码');
                return;
            }
            setMPStatus('正在连接...');
            const result = await Net.mp.join(code);
            if (result.ok) {
                setMPStatus('连接成功！等待房主开始游戏');
                // 已连接：锁定加入按钮，避免重复点击销毁现有连接
                joinBtn.disabled = true;
                input.disabled = true;
            } else {
                setMPStatus(`连接失败: ${result.error}`);
            }
        });
    }

    const startBtn = document.getElementById('mp-start');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (!Net.mp.isHost() || !Net.mp.isConnected()) return;
            if (!hostSeesReady) { setMPStatus('好友尚未准备，请等待'); return; }
            // 房主选定关卡 → 先选卡再开战：关卡与卡组随 start 消息同步给客人
            const levelId = document.getElementById('mp-level-select')?.value || '1-1';
            const level = LEVELS.find(l => l.id === levelId) || LEVELS[0];
            hideModal('mp-modal');
            openCardSelect(level, (lv, deck) => {
                Net.mp.send('start', { level: lv.id, deck });
                startMultiplayerGame('host', deck, lv.id);
            });
        });
    }

    document.querySelectorAll('.mp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.mp-panel').forEach(p => p.classList.add('hidden'));
            document.querySelector(`.mp-panel[data-panel="${tab.dataset.tab}"]`).classList.remove('hidden');
        });
    });

    Net.mp.on('status', (data) => {
        if (data.status === 'connected') {
            setMPStatus(data.reconnected ? '重连成功！' : '已连接！');
            const joinBtn = document.getElementById('mp-join-btn');
            const input = document.getElementById('mp-code-input');
            if (joinBtn) joinBtn.disabled = true;
            if (input) input.disabled = true;
            if (Net.mp.isHost()) {
                refreshLevelSelect();
                document.getElementById('mp-start').classList.remove('hidden');
                refreshHostStartGate();
            } else {
                showReadyButton(true);
                // 重连后保留准备状态：立即重发，房主无需重新等待
                if (data.reconnected && guestReady) Net.mp.send('mpready', { ready: true });
            }
        } else if (data.status === 'reconnecting') {
            setMPStatus(`连接中断，正在重连(${data.attempt || 1}/8)...`);
        } else if (data.status === 'guest-disconnected') {
            setMPStatus('好友连接中断，等待其重连...');
            if (Net.mp.isHost()) { hostSeesReady = false; refreshHostStartGate(); }
        } else if (data.status === 'full') {
            setMPStatus('房间已满员，新玩家被拒绝加入');
        } else if (data.status === 'closed') {
            setMPStatus('连接已断开');
            document.getElementById('mp-start').classList.add('hidden');
            const joinBtn = document.getElementById('mp-join-btn');
            const input = document.getElementById('mp-code-input');
            if (joinBtn) joinBtn.disabled = false;
            if (input) input.disabled = false;
            showReadyButton(false);
            guestReady = false; hostSeesReady = false;
        } else if (data.status === 'error') {
            setMPStatus(`错误: ${data.error}`);
        }
    });

    // 房主收到客人准备状态（mpready）：刷新开局门槛与提示
    Net.mp.on('mpready', (data) => {
        if (!Net.mp.isHost()) return;
        hostSeesReady = !!(data && data.ready);
        setMPStatus(hostSeesReady ? '好友已准备 ✓ 可以开始游戏' : '好友取消了准备');
        refreshHostStartGate();
    });

    Net.mp.on('start', (data) => {
        if (Net.mp.isGuest()) {
            hideModal('mp-modal');
            // 客人跟随房主进入同一关卡：同样的转场 + 准备/种植/植物三拍
            startMultiplayerGame('guest', data && data.deck, data && data.level);
        }
    });
}

function resetMPUI() {
    document.getElementById('mp-room-info').classList.add('hidden');
    document.getElementById('mp-room-url-row')?.classList.add('hidden');
    document.getElementById('mp-url-hint')?.classList.add('hidden');
    document.getElementById('mp-start').classList.add('hidden');
    const joinBtn = document.getElementById('mp-join-btn');
    const input = document.getElementById('mp-code-input');
    if (joinBtn) joinBtn.disabled = false;
    if (input) { input.disabled = false; input.value = ''; }
    showReadyButton(false);
    guestReady = false; hostSeesReady = false;
    setMPStatus('未连接');
}

function buildRoomURL(code) {
    return `${location.origin}${location.pathname}?room=${code}`;
}

// 通过 WebRTC ICE 候选探测局域网 IP（用于把 localhost 换成好友可访问的地址）
function detectLocalIP(timeoutMs = 1500) {
    return new Promise((resolve) => {
        if (typeof RTCPeerConnection !== 'function') return resolve(null);
        let done = false;
        const finish = (ip) => { if (!done) { done = true; try { pc.close(); } catch {} resolve(ip); } };
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('x');
        pc.onicecandidate = (e) => {
            if (!e.candidate) return finish(null);
            const m = /([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/.exec(e.candidate.candidate);
            if (m && !m[1].startsWith('127.')) finish(m[1]);
        };
        pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => finish(null));
        setTimeout(() => finish(null), timeoutMs);
    });
}

// 生成好友可直接访问的邀请链接：localhost 时替换为局域网 IP
async function buildShareURL(code) {
    if (/^(localhost|127\.)/.test(location.hostname)) {
        // 首选：问本地服务器要局域网 IP（最可靠）
        try {
            const r = await fetch('/__localip', { cache: 'no-store' });
            if (r.ok) {
                const ip = (await r.text()).trim();
                if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
                    return `http://${ip}${location.port ? ':' + location.port : ''}${location.pathname}?room=${code}`;
                }
            }
        } catch {}
        // 备选：WebRTC 探测
        const ip = await detectLocalIP();
        if (ip) return `http://${ip}${location.port ? ':' + location.port : ''}${location.pathname}?room=${code}`;
    }
    return buildRoomURL(code);
}

// 从 URL 读取 ?room=XXXXXX，未登录返回 code 由调用方引导登录
export function getRoomCodeFromURL() {
    const code = new URLSearchParams(location.search).get('room');
    return code && /^[A-Za-z0-9]{6}$/.test(code) ? code.toUpperCase() : null;
}

function clearRoomURLParam() {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// 已登录时自动打开联机弹窗并加入 URL 指定的房间
export async function tryAutoJoinFromURL() {
    const code = getRoomCodeFromURL();
    if (!code) return false;
    if (!Net.auth.isLoggedIn()) return false;
    clearRoomURLParam();
    showModal('mp-modal');
    resetMPUI();
    // 切到"加入房间"页签并预填房间码
    document.querySelectorAll('.mp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'join'));
    document.querySelectorAll('.mp-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== 'join'));
    const input = document.getElementById('mp-code-input');
    if (input) input.value = code;
    setMPStatus('正在通过邀请链接加入房间...');
    const result = await Net.mp.join(code);
    setMPStatus(result.ok ? '连接成功！等待房主开始游戏' : `连接失败: ${result.error}`);
    return true;
}

function setMPStatus(text) {
    const el = document.getElementById('mp-status');
    if (el) el.textContent = text;
}

export default { init: initMultiplayerUI, tryAutoJoinFromURL, getRoomCodeFromURL };
