// ============================================================
// 任务面板 UI
// ============================================================

import { getMissionList, getMissionStats, claimReward } from '../systems/missions.js';

let panelElement = null;
let isOpen = false;

// 创建任务面板HTML
export function createMissionPanel() {
    const html = `
    <div id="mission-panel" class="modal-overlay hidden">
        <div class="modal-box mission-box">
            <div class="modal-title">
                任务系统
                <span class="mission-stats" id="mission-stats"></span>
            </div>
            <div class="modal-body mission-body" id="mission-list">
                <!-- 任务列表由JS动态生成 -->
            </div>
            <div class="modal-footer">
                <button id="mission-close">关闭</button>
            </div>
        </div>
    </div>
    `;
    
    // 插入到body
    document.body.insertAdjacentHTML('beforeend', html);
    
    // 绑定事件
    document.getElementById('mission-close')?.addEventListener('click', hideMissionPanel);
    
    // 点击遮罩关闭
    document.getElementById('mission-panel')?.addEventListener('click', (e) => {
        if (e.target.id === 'mission-panel') hideMissionPanel();
    });
    
    // 保存元素引用
    panelElement = document.getElementById('mission-panel');
}

// 渲染任务列表
export function renderMissionList() {
    const listEl = document.getElementById('mission-list');
    const statsEl = document.getElementById('mission-stats');
    
    if (!listEl) return;
    
    const missions = getMissionList();
    const stats = getMissionStats();
    
    // 更新统计
    if (statsEl) {
        statsEl.textContent = `${stats.completed}/${stats.total}`;
    }
    
    // 渲染列表
    listEl.innerHTML = missions.map(m => `
        <div class="mission-item ${m.completed ? 'completed' : ''} ${m.canClaim ? 'can-claim' : ''}">
            <div class="mission-icon">${m.label}</div>
            <div class="mission-info">
                <div class="mission-name">${m.name}</div>
                <div class="mission-desc">${m.desc}</div>
                <div class="mission-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${m.percentage}%"></div>
                    </div>
                    <span class="progress-text">${Math.min(m.progress, m.target)}/${m.target}</span>
                </div>
                <div class="mission-reward">
                    奖励: ${getRewardIcon(m.reward.type)} ${m.reward.amount}
                </div>
            </div>
            <div class="mission-action">
                ${m.canClaim ? 
                    `<button class="claim-btn" data-mission="${m.id}">领取</button>` :
                    (m.claimed ? '<span class="claimed">✅已领取</span>' : '')
                }
            </div>
        </div>
    `).join('');
    
    // 绑定领取按钮事件
    listEl.querySelectorAll('.claim-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const missionId = e.target.dataset.mission;
            if (claimReward(missionId)) {
                renderMissionList(); // 重新渲染
            }
        });
    });
}

// 获取奖励图标
function getRewardIcon(type) {
    const icons = { silver: '银', gold: '金', gem: '钻' };
    return icons[type] || '';
}

// 显示任务面板
export function showMissionPanel() {
    if (!panelElement) createMissionPanel();
    renderMissionList();
    panelElement.classList.remove('hidden');
    isOpen = true;
}

// 隐藏任务面板
export function hideMissionPanel() {
    if (panelElement) {
        panelElement.classList.add('hidden');
    }
    isOpen = false;
}

// 切换面板显示
export function toggleMissionPanel() {
    if (isOpen) {
        hideMissionPanel();
    } else {
        showMissionPanel();
    }
}

// 在游戏HUD中添加任务按钮
export function addMissionButton() {
    const buttonHtml = `
    <button id="btn-mission" class="mission-btn" title="任务">
        任
    </button>
    `;
    
    // 插入到顶部栏
    const topBar = document.getElementById('top-bar');
    if (topBar) {
        topBar.insertAdjacentHTML('beforeend', buttonHtml);
        document.getElementById('btn-mission')?.addEventListener('click', toggleMissionPanel);
    }
}

// 添加CSS样式
export function addMissionStyles() {
    const css = `
    .mission-box { width: 520px; }
    .mission-stats {
        float: right;
        font-size: 14px;
        color: #ffd700;
    }
    .mission-body {
        max-height: 480px;
        overflow-y: auto;
        padding: 10px;
    }
    .mission-item {
        display: flex;
        gap: 12px;
        padding: 12px;
        margin-bottom: 8px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid #333;
        border-radius: 6px;
        transition: all 0.2s;
    }
    .mission-item:hover {
        border-color: #555;
    }
    .mission-item.completed {
        border-color: #00aa55;
        background: rgba(0, 170, 85, 0.1);
    }
    .mission-item.can-claim {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.1);
        animation: pulse 2s infinite;
    }
    @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.4); }
        50% { box-shadow: 0 0 8px 2px rgba(255, 215, 0, 0.2); }
    }
    .mission-icon {
        font-size: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
    }
    .mission-info {
        flex: 1;
    }
    .mission-name {
        font-size: 14px;
        font-weight: bold;
        color: #eee;
        margin-bottom: 4px;
    }
    .mission-desc {
        font-size: 12px;
        color: #888;
        margin-bottom: 6px;
    }
    .mission-progress {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
    }
    .progress-bar {
        flex: 1;
        height: 8px;
        background: #222;
        border-radius: 4px;
        overflow: hidden;
    }
    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #00ff88, #00ffcc);
        transition: width 0.3s ease;
    }
    .mission-item.completed .progress-fill {
        background: linear-gradient(90deg, #ffd700, #ffaa00);
    }
    .progress-text {
        font-size: 11px;
        color: #888;
        min-width: 40px;
        text-align: right;
    }
    .mission-reward {
        font-size: 11px;
        color: #ffd700;
    }
    .mission-action {
        display: flex;
        align-items: center;
    }
    .claim-btn {
        background: linear-gradient(180deg, #ffd700, #ffaa00);
        border: none;
        color: #000;
        padding: 6px 16px;
        font-weight: bold;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .claim-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
    }
    .claimed {
        font-size: 12px;
        color: #00ff88;
    }
    .mission-btn {
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid #444;
        color: #fff;
        width: 32px;
        height: 32px;
        font-size: 18px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .mission-btn:hover {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.1);
    }
    `;
    
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}

// 快捷键绑定 M 键打开任务面板
export function bindMissionHotkey() {
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key.toLowerCase() === 'm') {
            toggleMissionPanel();
        }
    });
}

export default {
    create: createMissionPanel,
    show: showMissionPanel,
    hide: hideMissionPanel,
    toggle: toggleMissionPanel,
    addButton: addMissionButton,
    addStyles: addMissionStyles,
    bindHotkey: bindMissionHotkey,
    render: renderMissionList,
};
