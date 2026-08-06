// ============================================================
// 游戏状态管理
// ============================================================

import { DIFFICULTY, CARD_ORDER, FIELD } from './constants.js';

// 游戏核心状态
export const state = {
    sun: 50,
    wave: 1,
    maxWave: 10,
    selectedCard: -1,
    plants: [],
    zombies: [],
    bullets: [],
    suns: [],
    effects: [],
    pickups: [],
    tempCards: [],
    cooldowns: {},
    mouseDown: false,       // 左键按住状态（全自动连发/弓箭蓄力）
    aiming: false,          // 右键按住瞄准（视角微放大 + 散射降低）
    reserveAmmo: {},        // 局内备弹（弹药库带入）
    waveTimer: 26,
    waveActive: false,
    zombiesInWave: 0,
    zombiesSpawned: 0,
    spawnInterval: 3,
    spawnTimer: 1,
    naturalSunTimer: 8,
    gameOver: false,
    victory: false,
    time: 0,
    killedTotal: 0,
    roundRewards: null,
    _zombiePool: null,
    _levelSpawnList: null,   // 预生成的整关出怪列表（原版机制：选卡时全部波次已确定）
    _waveHpTotal: 0,         // 本波僵尸总血量（提前刷新判定用）
    _waveEarlyRatio: 0.5,    // 本波提前刷新阈值（0.5~0.65 随机，文档规则）
    _waveStartT: 0,          // 本波出怪时刻（提前刷新需距上波 ≥4s）
    _flagWarnT: 0,           // 旗帜波警告延迟（7.2s）
    _flagLockT: 0,           // 旗帜前置波锁波计时（清场或 45s）
    _lastWaveWasFlag: false, // 上一波是否旗帜大波（清完后立刻进下一波）
    _cachedTotalKills: 0,    // 联机客人端缓存的总击杀数（来自房主同步）
    _rewardBag: null,        // 重打/联机胜利掉落的钱袋
    _coinFly: null,          // 钱袋钱币飞行状态
    doubleSun: false,
    shieldTimer: 0,
    _allowedCards: [],
    mowers: {},
    _showReward: false,
    _rewardPhase: null,
    _rewardAlpha: 0,
    _rewardPlant: null,
    _rewardNextLevel: null,
    _trPlantInv: false,
    _trDaveInv: false,
    _trZombieInv: false,
    _trInfSun: false,
    _trActive: false,
    _preLaunch: false,
    _preLaunchTimer: 0,
    mp: {
        active: false,
        role: null,
        remoteInput: null,
        snapshotAcc: 0,
        hostName: '',
        guestName: '',
    },
};

// 初始化冷却
CARD_ORDER.forEach(k => state.cooldowns[k] = 0);

// 玩家状态
export function createPlayerState() {
    return {
        x: FIELD.left + 40,
        y: FIELD.top + FIELD.rowHeight * 2 + FIELD.rowHeight / 2,
        jumpOffset: 0,
        vy: 0,
        isJumping: false,
        jumpCooldown: 0,
        speed: 220,
        speedY: 180,
        hp: 200,
        maxHp: 200,
        stamina: 100,       // 体力：使用武器消耗，停止攻击后自动回复
        maxStamina: 100,
        _stamDelay: 0,
        hurtFlash: 0,
        color: '#00FF88',
        label: '戴夫',
        facing: 1,
        facingAngle: 0,
        ghost: null,
        _damageAcc: 0,
        currentWeapon: null,
        weaponCooldown: 0,
        swingTimer: 0,
        swingDir: 0,
        swingWeapon: null,
        recoil: 0,
        victoryBounce: 0,
        deathRot: 0,
        sprinting: false,
        dashing: false,
        dashTimer: 0,
        dashDir: { x: 0, y: 0 },
        dashCooldown: 0,
        dashGhosts: [],
        invuln: 0,
        guarding: false,
        guardTimer: 0,
        guardCooldown: 0,
        perfectFlash: 0,
        guardFacing: 0,
        equippedWeapon: null,
        equippedLevel: 1,
        equippedDurability: 0,
        get row() {
            return Math.floor((this.y - FIELD.top) / FIELD.rowHeight);
        },
    };
}

export const dave = createPlayerState();
export const dave2 = createPlayerState();
dave2.label = 'P2';
dave2.color = '#66FFCC';

// 输入状态
export const keys = {};
export const mouse = { x: 0, y: 0, inside: false };

// UI引用缓存
export const uiRefs = {
    canvas: null,
    ctx: null,
    sunValueEl: null,
    waveValueEl: null,
    hpValueEl: null,
    heroNameEl: null,
    logEl: null,
    cardEls: [],
};

// 游戏运行状态
export let gameRunning = false;
export let rafId = 0;
export let lastTime = 0;
export let inputFocused = false;

// 游戏存档数据（放在这里全局共享，所有模块都能导入）
export let saveData = {
    cleared: [],
    lastLevel: null,
    unlockedPlants: ['peashooter'],
    decks: {},
    maxSlots: 6,
    devMode: false,
};
export function setSaveData(newData) {
    saveData = newData;
}

export function setGameRunning(val) { gameRunning = val; }
export function setRafId(val) { rafId = val; }
export function setLastTime(val) { lastTime = val; }
export function setInputFocused(val) { inputFocused = val; }

// 重置关卡状态
export function resetLevelState(level) {
    state.sun = level.firstSun;
    state.wave = 1;
    state.maxWave = level.waves;
    state.selectedCard = -1;
    state.plants.length = 0;
    state.zombies.length = 0;
    state.bullets.length = 0;
    state.suns.length = 0;
    state.effects.length = 0;
    state.pickups.length = 0;
    state.tempCards.length = 0;
    state.roundRewards = { silver: 0, gold: 0, gem: 0, fragments: {}, wfrags: {} };
    // 首波延迟 26s（对齐原版：开局有充足发育时间，种下 2~3 株向日葵后第一只僵尸才到场）
    state.waveTimer = 26;
    state.waveActive = false;
    state.zombiesInWave = 0;
    state.zombiesSpawned = 0;
    state.naturalSunTimer = 8;
    state._levelSpawnList = null;
    state._waveHpTotal = 0;
    state._waveEarlyRatio = 0.5;
    state._waveStartT = 0;
    state._flagWarnT = 0;
    state._flagLockT = 0;
    state._lastWaveWasFlag = false;
    state._cachedTotalKills = 0;
    state._rewardBag = null;
    state._coinFly = null;
    state.gameOver = false;
    state.victory = false;
    state.time = 0;
    state.killedTotal = 0;
    state.doubleSun = false;
    state.shieldTimer = 0;
    state._allowedCards = [];
    state.mowers = {};
    CARD_ORDER.forEach(k => state.cooldowns[k] = 0);
    FIELD.activeRows = (level.rows && level.rows.length > 0) ? [...level.rows] : [0, 1, 2, 3, 4];
    state._zombiePool = level.zombiePool;
    // 胜利结算流程字段
    state._rewardCard = null;
    state._summaryTimer = null;
    state._showReward = false;
    state._rewardPhase = null;
    state._rewardAlpha = 0;
    state._rewardT = 0;
    state._rewardPlant = null;
    state._rewardNextLevel = null;
    state._lastKillPos = null;
    state._rewardSceneT = 0;
    state._rewardParticles = null;
}

// 重置玩家状态
export function resetPlayerState(player, middleRowY) {
    player.x = FIELD.left + 40;
    player.y = middleRowY;
    player.jumpOffset = 0;
    player.vy = 0;
    player.isJumping = false;
    player.jumpCooldown = 0;
    if (player._baseMaxHp == null) player._baseMaxHp = player.maxHp || 200;
    player.maxHp = player._baseMaxHp;
    player.hp = player.maxHp;
    player.hurtFlash = 0;
    player.ghost = null;
    player._damageAcc = 0;
    player.weaponCooldown = 0;
    player.swingTimer = 0;
    player.recoil = 0;
    player.victoryBounce = 0;
    player.deathRot = 0;
    player.facingAngle = 0;
    player.sprinting = false;
    player.dashing = false;
    player.dashTimer = 0;
    player.dashCooldown = 0;
    player.dashGhosts = [];
    player.guarding = false;
    player.guardTimer = 0;
    player.guardCooldown = 0;
    player.perfectFlash = 0;
    player.invuln = 0;
    player.armor = null; // 开局清空头盔护甲
}
