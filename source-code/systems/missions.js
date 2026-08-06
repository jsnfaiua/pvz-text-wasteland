// ============================================================
// 任务/成就系统
// ============================================================

import { state, dave, saveData, setSaveData } from '../core/state.js';
import { PLANTS, WEAPONS } from '../core/constants.js';
import { log } from '../ui/hud.js';
import { addCurrency, META, writeSave } from '../persistence/storage.js';

// 任务定义
export const MISSION_TYPES = {
    KILL_ZOMBIES: 'kill_zombies',
    COLLECT_SUN: 'collect_sun',
    USE_PLANT: 'use_plant',
    SURVIVE_WAVES: 'survive_waves',
    PERFECT_BLOCK: 'perfect_block',
    USE_WEAPON: 'use_weapon',
};

// 任务列表
export const MISSIONS = [
    {
        id: 'm1',
        name: '僵尸猎手',
        desc: '击杀 10 只僵尸',
        type: MISSION_TYPES.KILL_ZOMBIES,
        target: 10,
        reward: { type: 'silver', amount: 100 },
        label: '杀'
    },
    {
        id: 'm2',
        name: '阳光收集者',
        desc: '累计收集 100 阳光',
        type: MISSION_TYPES.COLLECT_SUN,
        target: 100,
        reward: { type: 'gold', amount: 10 },
        label: '阳'
    },
    {
        id: 'm3',
        name: '园艺大师',
        desc: '种植 20 株植物',
        type: MISSION_TYPES.USE_PLANT,
        target: 20,
        reward: { type: 'gem', amount: 2 },
        label: '种'
    },
    {
        id: 'm4',
        name: '坚守阵地',
        desc: '通关关卡 5 波',
        type: MISSION_TYPES.SURVIVE_WAVES,
        target: 5,
        reward: { type: 'silver', amount: 200 },
        label: '守'
    },
    {
        id: 'm5',
        name: '格挡大师',
        desc: '成功完美格挡 10 次',
        type: MISSION_TYPES.PERFECT_BLOCK,
        target: 10,
        reward: { type: 'gold', amount: 20 },
        label: '防'
    },
];

// 任务状态
let missionState = {
    progress: {},      // { missionId: currentValue }
    completed: [],     // [missionId]
    claimed: [],       // [missionId]
};

// 初始化任务系统
export function initMissions() {
    // 从存档加载
    if (saveData.missions) {
        missionState = { ...saveData.missions };
    }
    
    // 初始化进度
    MISSIONS.forEach(m => {
        if (!missionState.progress[m.id]) {
            missionState.progress[m.id] = 0;
        }
    });
    
    saveMissions();
    log('任务系统已加载');
}

// 保存任务进度
function saveMissions() {
    const newSaveData = { ...saveData, missions: missionState };
    setSaveData(newSaveData);
}

// 汇报任务进度
export function reportMissionProgress(type, amount = 1) {
    // 训练营中的行为不计入任务进度
    if (state._trActive) return;
    MISSIONS.forEach(mission => {
        if (mission.type === type && !missionState.completed.includes(mission.id)) {
            missionState.progress[mission.id] = 
                (missionState.progress[mission.id] || 0) + amount;
            
            // 检查是否完成
            if (missionState.progress[mission.id] >= mission.target && 
                !missionState.completed.includes(mission.id)) {
                completeMission(mission);
            }
        }
    });
    saveMissions();
}

// 任务完成
function completeMission(mission) {
    missionState.completed.push(mission.id);
    log(`任务完成: ${mission.name}!`);
    
    // 弹出通知
    showMissionNotification(mission);
}

// 领取奖励
export function claimReward(missionId) {
    const mission = MISSIONS.find(m => m.id === missionId);
    if (!mission) return false;
    if (!missionState.completed.includes(missionId)) return false;
    if (missionState.claimed.includes(missionId)) return false;
    
    // 发放奖励（addCurrency 签名: (currency, type, amount)）
    addCurrency(META.currency, mission.reward.type, mission.reward.amount);
    missionState.claimed.push(missionId);
    saveMissions();
    
    log(`✅ 领取奖励: ${mission.reward.amount} ${getCurrencyName(mission.reward.type)}`);
    return true;
}

// 获取货币中文名
function getCurrencyName(type) {
    const names = { silver: '银币', gold: '金币', gem: '钻石' };
    return names[type] || type;
}

// 任务通知弹窗
function showMissionNotification(mission) {
    // 这里可以集成到游戏UI中
    // 现在先用简单的console展示
    console.log(`%c任务完成: ${mission.name}`, 'color: #00ff88; font-size: 14px; font-weight: bold;');
    console.log(`%c奖励: ${mission.reward.amount} ${getCurrencyName(mission.reward.type)}`, 'color: #ffd700;');
}

// 获取任务列表（用于UI展示）
export function getMissionList() {
    return MISSIONS.map(m => ({
        ...m,
        progress: missionState.progress[m.id] || 0,
        completed: missionState.completed.includes(m.id),
        claimed: missionState.claimed.includes(m.id),
        canClaim: missionState.completed.includes(m.id) && 
                  !missionState.claimed.includes(m.id),
        percentage: Math.min(100, Math.floor(
            ((missionState.progress[m.id] || 0) / m.target) * 100
        ))
    }));
}

// 获取任务统计
export function getMissionStats() {
    const total = MISSIONS.length;
    const completed = missionState.completed.length;
    const claimed = missionState.claimed.length;
    
    return {
        total,
        completed,
        claimed,
        percentage: Math.floor((completed / total) * 100)
    };
}

// 重置任务进度（调试用）
export function resetMissions() {
    missionState = {
        progress: {},
        completed: [],
        claimed: [],
    };
    MISSIONS.forEach(m => {
        missionState.progress[m.id] = 0;
    });
    saveMissions();
    log('任务进度已重置');
}

export default {
    init: initMissions,
    report: reportMissionProgress,
    claim: claimReward,
    getList: getMissionList,
    getStats: getMissionStats,
    reset: resetMissions,
    MISSION_TYPES,
    MISSIONS,
};
