// ========================================
// 游戏集成入口 - 所有模块的粘合剂
// ========================================

import { FIELD, DIFFICULTY, DIFFICULTY_PRESETS, LEVELS, PLANTS, CARD_ORDER,
    WEAPONS, WEAPON_LEVEL_MUL, WEAPON_META, DROP_TABLE, MIN_PLANT_DIST,
    ZOMBIE_FRAG_WEIGHTS, WEAPON_FRAG_WEIGHTS, LEVEL_REWARDS, LEVEL_TABLE,
    CANVAS_WIDTH, CANVAS_HEIGHT, currentDifficulty } from './source-code/core/constants.js';

import { state, dave, resetLevelState, resetPlayerState,
    keys, mouse, setGameRunning, gameRunning, rafId, setRafId,
    setLastTime, lastTime, inputFocused, setInputFocused, saveData, setSaveData } from './source-code/core/state.js';

import { rowY, isShovelUnlocked, displayName } from './source-code/core/utils.js';
import { initCanvas, render } from './source-code/core/render.js';
import { toggleFullscreen } from './source-code/core/canvasFit.js';

import { updatePlayer, tryJump, startDash, startGuard, endGuard,
    checkPlayerDamage } from './source-code/entities/player.js';

import { updatePlants, updateBullets, updateZombies, tryUseWeapon, startReload, updateReload } from './source-code/systems/combat.js';

import { updateSunsAndPickups, spawnZombie, rollBagLoot } from './source-code/systems/spawner.js';
import { buildLevelSpawnList, nextWaveTimeout } from './source-code/systems/waves.js';
import { startCoinFly, updateCoinFly } from './source-code/systems/coinFly.js';

import { META, loadSave, writeSave, saveFragments,
    saveWeaponFrags, addCurrency, loadConsumables, consumeConsumable, loadArmors, removeArmor,
    saveAmmo } from './source-code/persistence/storage.js';

import { initHUD, updateHUD, log, updateLogTimer, selectCard, renderCardSlots } from './source-code/ui/hud.js';
import MissionSystem from './source-code/ui/missionPanel.js';
import Almanac from './source-code/systems/almanac.js';
import AlmanacUI from './source-code/ui/almanacUI.js';
import Shop from './source-code/ui/shop.js';
import Settings from './source-code/ui/settings.js';
import MultiplayerUI from './source-code/multiplayer/multiplayerUI.js';
import AudioSystem from './source-code/systems/audio.js';
import { openCardSelect } from './source-code/ui/cardSelect.js';
import { stopTraining } from './source-code/ui/training.js';
import { initMissions, reportMissionProgress, MISSION_TYPES } from './source-code/systems/missions.js';

import { initScreenButtons, showScreen,
    initModalButtons } from './source-code/ui/screens.js?v=4.13';   // v4.13 cache-busting：screens.js 内动态 import workshop.js 带版本号，需强制刷新自身

// saveData 从 state.js 全局导入，不重复声明！
// inputFocused 从 state.js 导入，不重复声明！

// ========================================
// 主游戏循环
// ========================================
function gameLoop(now) {
    if (!gameRunning) return;

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    setLastTime(now);

    // 暂停中：冻结一切更新，只保留画面渲染（设置弹窗盖在上面）
    if (state.paused) {
        render(DIFFICULTY);
        updateHUD();
        setRafId(requestAnimationFrame(gameLoop));
        return;
    }

    // 准备种植倒计时
    if (state._preLaunch) {
        state._preLaunchTimer -= dt;
        state._preLaunchT = (state._preLaunchT || 0) + dt;
        if (state._preLaunchTimer <= 0) {
            state._preLaunch = false;
            // 开局后短暂展示"准备种植植物！"并淡出，不阻塞操作
            state._postLaunch = 0.8;
            AudioSystem.startBGM();
            log('开始！');
        }
        render(DIFFICULTY);
        updateHUD();
    } else if (!state.gameOver) {
        updateGame(dt);
    } else if (state.victory && (state._rewardCard || state._rewardBag || state._coinFly || (state._summaryTimer != null && !state._showReward))) {
        updateVictoryCollect(dt);
    } else if (state._showReward) {
        updateRewardAnim(dt);
    }

    // 开局提示淡出计时（独立于游戏进行状态）
    if (state._postLaunch > 0) state._postLaunch -= dt;

    if (!state._preLaunch) {
        render(DIFFICULTY);
        updateHUD();
    }
    // 结算界面打开时隐藏 DOM HUD（顶栏阳光/货币/波次/卡槽）；元素引用与状态缓存，避免每帧 DOM 查找
    if (_topBarEl === null) _topBarEl = document.getElementById('top-bar');
    if (_topBarEl) {
        const hide = !!state._showReward;
        if (hide !== _topBarHidden) {
            _topBarHidden = hide;
            _topBarEl.classList.toggle('hidden', hide);
        }
    }
    setRafId(requestAnimationFrame(gameLoop));
}

let _topBarEl = null;
let _topBarHidden = false;

function updateGame(dt) {
    state.time += dt;
    AudioSystem.updateAudio(dt);

    // 清理过期特效
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }

    // 更新玩家
    updatePlayer(dave, dt, FIELD);

    // 换弹推进
    updateReload(dave, dt);

    // 弓箭蓄力计时
    if (dave.charging) {
        const wd = currentWeaponDef();
        dave.chargeT = Math.min(wd?.maxCharge || 1, (dave.chargeT || 0) + dt);
    }

    // 全自动武器：按住左键持续开火（射速由武器冷却限制）
    if (state.mouseDown && !dave.charging && !dave.reloading) {
        const wd = currentWeaponDef();
        if (wd && wd.kind === 'ranged' && wd.modes?.includes('auto') && dave.fireMode === 'auto') {
            const result = tryUseWeapon(dave, (lv) => WEAPON_LEVEL_MUL[Math.max(1, Math.min(lv, 5))], isShovelUnlocked(saveData));
            // 音效时长与实际射速对齐（如冲锋枪全自动 0.1s/发）
            const iv = (wd.autoInterval && dave.fireMode === 'auto') ? wd.autoInterval : wd.fireInterval;
            if (result.ok) AudioSystem.playShoot(dave.currentWeapon, iv);
        }
    }

    // 更新植物
    updatePlants(dt, DIFFICULTY, (lv) => WEAPON_LEVEL_MUL[Math.max(1, Math.min(lv, 5))]);

    // 更新子弹
    updateBullets(dt);

    // 更新僵尸
    const zResult = updateZombies(dt, DIFFICULTY, DROP_TABLE,
        ZOMBIE_FRAG_WEIGHTS, WEAPON_FRAG_WEIGHTS, META, saveFragments, saveWeaponFrags);

    if (zResult.gameOver) {
        endGame(false);
        return;
    }

    // 更新阳光和拾取（货币不再直接入账：逐枚飞向货币显示位置，落袋才计入账户）
    updateSunsAndPickups(dt, dave, FIELD, state, (type, amount, picker, x, y) => {
        startCoinFly(x, y, [{ kind: type, amount }]);
    });

    // 钱币飞行推进（战斗中僵尸掉落的货币也会逐枚飞入账户）
    if (state._coinFly) updateCoinFly(dt, true);

    // 冷却
    updateCooldowns(dt);

    // 波次计时器
    if (state.waveTimer > 0) state.waveTimer -= dt;
    if (state.spawnTimer > 0) state.spawnTimer -= dt;
    updateWaves(dt);

    // 胜利检测（波次系统触发）
    if (state.gameOver && state.victory) {
        endGame(true);
        return;
    }

    // 玩家受伤检测
    if (checkPlayerDamage(dave, dt)) {
        endGame(false);
        return;
    }

    // 日志计时器
    updateLogTimer(dt, () => {
        log('WASD 移动 · Space 跳跃 · 1-8 选卡 · F 种植 · T 召唤大波 · 点击攻击 · X 切武器 · V 射击模式 · R 换弹');
    });
}

// ========================================
// 种植系统
// ========================================
function tryPlant() {
    if (state.selectedCard < 0) { log('先按 1-8 选择植物'); return; }
    if (dave.isJumping) { log('空中无法种植'); return; }

    const key = CARD_ORDER[state.selectedCard];
    const def = PLANTS[key];

    if ((state.cooldowns[key] || 0) > 0) { log(`${def.name} 冷却中`); return; }
    if (state.sun < def.cost) { log('阳光不足'); return; }

    // 间距检查
    for (const p of state.plants) {
        if (p.row === dave.row && Math.abs(p.x - dave.x) < MIN_PLANT_DIST) {
            log('这里太挤了'); return;
        }
    }
    if (dave.x < FIELD.left + 20 || dave.x > FIELD.right - 30) {
        log('此处不能种植'); return;
    }
    if (!FIELD.activeRows.includes(dave.row)) {
        log('此行不能种植'); return;
    }

    state.sun -= def.cost;
    state.cooldowns[key] = def.cooldown;
    // 种在玩家实际位置；Y 钳制在本行范围内，防止站到行边界/场底时种出行外
    const rowTop = FIELD.top + FIELD.rowHeight * dave.row;
    const rowBot = rowTop + FIELD.rowHeight;
    const py = Math.max(rowTop + 14, Math.min(rowBot - 14, dave.y));
    const plant = makePlant(key, dave.x, dave.row, py);

    // 自动装备护甲
    const armors = loadArmors();
    if (armors.length > 0) {
        const armor = armors.shift();
        plant.armorHp = armor.hp;
        plant.maxArmorHp = armor.maxHp;
        plant.armorName = armor.name;
        removeArmor(0);
        log(`${def.name} 装备了 ${armor.name}（${armor.hp} 护甲）`);
    } else {
        plant.armorHp = 0;
        plant.maxArmorHp = 0;
        plant.armorName = null;
    }

    state.plants.push(plant);
    log(`种下 ${def.name}`);
    AudioSystem.playPlant();
    reportMissionProgress(MISSION_TYPES.USE_PLANT, 1);
}

function makePlant(kind, x, row, y) {
    const def = PLANTS[kind];
    const lv = META.levels[kind] || 1;
    // 等级倍率按 LEVEL_TABLE 百分比加成（Lv2 +15% / Lv3 +30% / Lv4 +50% / Lv5 +100%）
    const mul = (LEVEL_TABLE.find(l => l.lv === lv) || {}).mul || 1;
    return {
        kind, x, row,
        y: y != null ? y : rowY(row),
        lv, mul,
        hp: def.hp * mul,
        maxHp: def.hp * mul,
        fireTimer: def.fireInterval ? Math.random() * 0.5 : 0,
        produceTimer: def.produceInterval ? 7 + Math.random() * 2 : 0,
        fuseTimer: def.fuse || 0,
        exploded: false,
        shake: 0,
    };
}

function updateCooldowns(dt) {
    CARD_ORDER.forEach(k => {
        if (state.cooldowns[k] > 0) state.cooldowns[k] -= dt;
    });
}

// ========================================
// 波次系统（按文档规则：整波同出 / 25~31s 随机超时 / 血量 0.5~0.65 提前推进 /
// 旗帜前置波锁波 45s / 旗帜音效与出怪同帧 / 旗帜大波清完立刻进下一波）
// ========================================
function updateWaves(dt) {
    // 旗帜波警告延迟中（7.2s 后出旗）
    if (state._flagWarnT > 0) {
        state._flagWarnT -= dt;
        if (state._flagWarnT <= 0) spawnCurrentWave();
        return;
    }

    // 全部波次出完 → 清场即胜利
    if (state.wave > state.maxWave) {
        if (state.zombies.length === 0 && !state.gameOver) {
            state.waveActive = false;
            state.gameOver = true;
            state.victory = true;
        }
        return;
    }

    const nextIsFlag = state.wave % 10 === 0;
    if (nextIsFlag) {
        // 旗帜前置波锁：必须清场或等满 45s（关闭血量提前推进）
        if (state.zombies.length > 0 && state._flagLockT < 45) {
            state._flagLockT += dt;
            return;
        }
        state._flagLockT = 0;
        log('一大波僵尸正在接近！');
        AudioSystem.playWaveWarning();
        // 大字公告：本关第一个旗帜波 = "一大波僵尸来袭"；最终波 = "最后一波"；音效/公告/出怪同帧触发
        if (state.wave === state.maxWave) {
            state._announce = { text: '最后一波', start: performance.now() };
        } else if (state.wave === 10) {
            state._announce = { text: '一大波僵尸来袭', start: performance.now() };
        }
        spawnCurrentWave(); // 旗帜音效与整波僵尸同时出现，不再延迟 7.2s
        return;
    }

    // 普通小波：保底超时推进
    if (state.waveTimer <= 0) {
        spawnCurrentWave();
        return;
    }

    // 无空档期：本波已出完且场上清空 → 0.8s 喘息后立刻进下一波（击杀越快节奏越快）
    if (state.wave > 1 && state.waveActive && state.zombies.length === 0 && state.waveTimer > 0.8) {
        state.waveTimer = 0.8;
    }

    // 血量提前推进：剩余 < 本波初始 × (0.5~0.65 随机)，且距上波 ≥4s → 1.2s 内跟进下一波
    if (state.zombies.length > 0 && state._waveHpTotal > 0
        && state.time - state._waveStartT >= 4) {
        let hp = 0;
        for (const z of state.zombies) hp += z.hp + (z.armorHp || 0);
        if (hp < state._waveHpTotal * state._waveEarlyRatio && state.waveTimer > 1.2) state.waveTimer = 1.2;
    }

    // 旗帜大波清完 → 无任何停顿，立刻进下一波
    if (state._lastWaveWasFlag && state.zombies.length === 0 && state.waveTimer > 0.5) {
        state.waveTimer = 0.5;
    }
}

function spawnCurrentWave() {
    startWave();
    const wasFlag = state.wave % 10 === 0;
    state.wave++;
    state._lastWaveWasFlag = wasFlag;
    state.waveTimer = nextWaveTimeout(DIFFICULTY.restMul);
}

// 手动召唤下一波（T 键 / 联机房主广播共用）
// 只有大波次（旗帜波）才能手动召唤：跳过锁波等待 / 缩短预警
function callNextWave() {
    if (state.gameOver || state.wave > state.maxWave) return false;
    if (state.wave % 10 !== 0) { log('只有大波次（旗帜波）才能按 T 召唤'); return false; }
    if (state._flagWarnT > 0) {
        state._flagWarnT = Math.min(state._flagWarnT, 0.8);
        log('大波提前到来！');
        return true;
    }
    state._flagLockT = 45; // 跳过清场/等待，立即进入大波预警
    log('召唤大波！');
    return true;
}

function startWave() {
    // 按预生成列表整波同出（原版机制）
    const comp = (state._levelSpawnList && state._levelSpawnList[state.wave - 1]) || ['normal'];
    const isFlag = (state.wave % 10 === 0);
    const isFinal = (state.wave === state.maxWave);
    state.waveActive = true;
    state.zombiesInWave = comp.length;
    state.zombiesSpawned = 0;

    let sfx = 3; // 整波同出时最多播 3 声出场音，防爆音
    for (const kind of comp) {
        spawnZombie(state, DIFFICULTY, LEVELS, kind, sfx-- > 0);
    }

    // 记录本波总血量与出怪时刻（提前刷新判定）
    let hp = 0;
    for (const z of state.zombies) hp += z.hp + (z.armorHp || 0);
    state._waveHpTotal = hp;
    state._waveEarlyRatio = 0.5 + Math.random() * 0.15;
    state._waveStartT = state.time;

    if (state.wave > 1) reportMissionProgress(MISSION_TYPES.SURVIVE_WAVES, 1);

    if (isFlag) {
        log(`旗帜大波！共 ${comp.length} 只`);
    } else if (isFinal) {
        log(`最后一波！共 ${comp.length} 只`);
    } else {
        log(`第 ${state.wave} 波来袭！共 ${comp.length} 只`);
    }
    // 波次警示音：旗帜波已在 7.2s 预警时播放过（"一大波僵尸正在接近！"），此处不重复；
    // 仅非旗帜的最终波在出怪时播放，并弹出"最后一波"大字公告
    if (!isFlag && isFinal) {
        AudioSystem.playWaveWarning();
        state._announce = { text: '最后一波', start: performance.now() };
    }
}

// ========================================
// 游戏流程控制
// ========================================
export function startGame(level, deck) {
    // 重置状态
    resetLevelState(level);
    state._bagFlow = false;
    state._coinFly = null;
    victoryLootSwept = false;   // 胜利扫荡守卫：每局只扫一次
    const middleRow = level.rows[Math.floor(level.rows.length / 2)];
    const middleRowY = rowY(middleRow);
    resetPlayerState(dave, middleRowY);
    dave.label = displayName(saveData);

    // 应用关卡难度修正（先从当前难度预设重置，避免重复进关时 diffMod 复利叠加）
    Object.assign(DIFFICULTY, DIFFICULTY_PRESETS[currentDifficulty] || DIFFICULTY_PRESETS.normal);
    if (level.diffMod) {
        Object.keys(level.diffMod).forEach(k => {
            if (DIFFICULTY[k] != null) DIFFICULTY[k] *= level.diffMod[k];
        });
    }

    // 原版机制：开局即预生成整关出怪列表（选卡时全部波次已确定）
    state._levelSpawnList = buildLevelSpawnList(level.waves, level.zombiePool, DIFFICULTY.countMul);

    // 使用选卡结果（如果提供），否则用关卡默认卡牌
    const maxSlots = saveData.maxSlots || 6;
    const requestedCards = (deck && deck.length > 0) ? deck : level.allowedCards;
    const cards = [...new Set(requestedCards)]
        .filter(k => level.allowedCards.includes(k) && saveData.unlockedPlants.includes(k))
        .slice(0, maxSlots);
    state._allowedCards = cards;
    renderCardSlots();
    state.sun = level.firstSun;
    state._zombiePool = level.zombiePool;
    state.doubleSun = false;
    state.shieldTimer = 0;

    // 小推车：每行配一辆
    for (const r of level.rows) state.mowers[r] = true;

    // 应用商店消耗品
    const consumables = loadConsumables();
    if ((consumables.heal || 0) > 0) {
        dave.maxHp = (dave.maxHp || 200) + 50;
        dave.hp = dave.maxHp;
        consumeConsumable('heal');
        log(`使用急救包，本局最大生命提升至 ${Math.round(dave.maxHp)}`);
    }
    if ((consumables.double || 0) > 0) {
        state.doubleSun = true;
        consumeConsumable('double');
        log('双倍阳光已激活！');
    }
    if ((consumables.shield || 0) > 0) {
        state.shieldTimer = 3;
        dave.invuln = Math.max(dave.invuln, state.shieldTimer);
        consumeConsumable('shield');
        log('临时护盾已激活！3秒无敌');
    }

    // 装备武器：近战槽 + 远程槽可同时携带，X 切换；远程弹药从弹药库带入
    const eqM = META.weapons?.equippedMelee;
    const eqR = META.weapons?.equippedRanged;
    dave.equippedMelee = (eqM && eqM !== 'shovel' && META.weapons.unlocked[eqM]) ? eqM : null;
    dave.equippedRanged = (eqR && eqR !== 'shovel' && META.weapons.unlocked[eqR]) ? eqR : null;
    dave.equippedWeapon = dave.equippedRanged || dave.equippedMelee;
    dave.equippedLevel = 1;
    dave._preShovelWeapon = null; // 铲子工具切换暂存
    dave.fireMode = null;
    dave.reloading = false;
    dave.charging = false;
    dave.chargeT = 0;
    dave.magAmmo = null;
    state.reserveAmmo = {};
    const rw = dave.equippedRanged ? WEAPONS[dave.equippedRanged] : null;
    if (rw && rw.magSize) {
        dave.magAmmo = rw.magSize;
        dave.fireMode = rw.defaultMode || (rw.modes ? rw.modes[0] : 'semi');
        // 备弹 = 弹药库中该弹种的全部库存，带入局内并从库存扣除（消耗品）
        const carried = META.ammo?.[rw.ammoType] || 0;
        state.reserveAmmo[rw.ammoType] = carried;
        if (carried > 0) {
            META.ammo[rw.ammoType] = 0;
            saveAmmo(META.ammo);
        }
    }
    if (dave.equippedWeapon) {
        dave.currentWeapon = dave.equippedWeapon;
    } else {
        dave.currentWeapon = isShovelUnlocked(saveData) ? 'shovel' : null;
        dave.equippedWeapon = null;
    }

    // 存档进度
    saveData.lastLevel = level.id;
    writeSave(saveData);

    showScreen('game');
    document.getElementById('level-tag') && (document.getElementById('level-tag').textContent = `${level.id} · ${level.name}`);
    initCanvas(document.getElementById('game'));
    const rootEl = document.documentElement;
    if (rootEl && rootEl.requestFullscreen) rootEl.requestFullscreen().catch(() => {});

    // 准备种植阶段（三拍节奏：0s 准备 → 0.18s 种植 → 1.06s 植物！开局）
    state._preLaunch = true;
    state._preLaunchTimer = 1.06;
    state._preLaunchT = 0;
    state._postLaunch = 0;
    AudioSystem.playPreLaunch();
    log('准备种植植物！');

    AudioSystem.stopBGM();

    setGameRunning(true);
    setLastTime(performance.now());
    setRafId(requestAnimationFrame(gameLoop));
}

export function stopGame() {
    setGameRunning(false);
    state.paused = false;
    state._pauseMenu = false;
    state.aiming = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    AudioSystem.stopBGM();
    AudioSystem.stopRewardMusic();
    // 训练营退出时清理训练状态，避免 _trActive 残留导致后续关卡不掉落
    if (state._trActive) stopTraining();
    document.getElementById('tr-sidebar')?.classList.add('hidden');
}

function endGame(win) {
    state.gameOver = true;
    state.victory = win;

    if (win) {
        // BGM 继续播放，进入拾取阶段（结算页弹出时才淡出）
        const levelId = saveData.lastLevel;
        const isNewClear = levelId && !saveData.cleared.includes(levelId);
        const reward = isNewClear ? LEVEL_REWARDS[levelId] : null;
        const dropPos = state._lastKillPos || { x: (FIELD.left + FIELD.right) / 2, y: (FIELD.top + FIELD.bottom) / 2, row: 2 };
        // 末杀可能发生在场外右侧（僵尸出生区），钳制到玩家可行走范围内，否则永远拾取不到
        dropPos.x = Math.min(Math.max(dropPos.x, FIELD.left + 40), FIELD.right - 40);
        dropPos.y = Math.min(Math.max(dropPos.y, FIELD.top + 40), FIELD.bottom - 40);

        if (reward) {
            // 首通有奖励：在末杀位置生成实体卡片，戴夫走过去拾取后才进入结算
            saveData.cleared.push(levelId);
            state._rewardCard = { x: dropPos.x, y: dropPos.y, plant: reward, t: 0 };
            state._showReward = false;
            writeSave(saveData);
        } else {
            // 重打/无植物奖励：末杀位置掉落钱袋（发光实体），戴夫走过去拾取后
            // 钱币逐枚飞入账户，全部落袋才弹出结算并播放胜利音效
            if (isNewClear) { saveData.cleared.push(levelId); writeSave(saveData); }
            state._rewardBag = { x: dropPos.x, y: dropPos.y, t: 0, loot: rollBagLoot(DIFFICULTY.rewardMul || 1) };
            state._summaryTimer = null;
            state._showReward = false;
        }
        // 下一关
        const curIdx = LEVELS.findIndex(l => l.id === saveData.lastLevel);
        state._rewardNextLevel = (curIdx >= 0 && curIdx < LEVELS.length - 1) ? LEVELS[curIdx + 1] : null;
    } else {
        AudioSystem.playDefeat();
        state._showReward = false;
    }
}

// 弹出重打结算（钱袋钱币全部落袋后调用）
function showSummaryScreen() {
    AudioSystem.fadeOutBGM(0.8);
    AudioSystem.playVictory();
    AudioSystem.startRewardMusic();
    state._showReward = true;
    state._rewardPhase = 'wipe';
    state._rewardAlpha = 0;
    state._rewardT = 0;
    state._rewardSceneT = 0;
    state._rewardParticles = Array.from({ length: 24 }, () => ({
        x: Math.random() * CANVAS_WIDTH, y: Math.random() * CANVAS_HEIGHT,
        r: 1 + Math.random() * 2, v: 8 + Math.random() * 18, o: 0.15 + Math.random() * 0.4,
    }));
}

// 戴夫拾取奖励卡片：解锁奖励并进入过曝转场
function collectRewardCard() {
    const card = state._rewardCard;
    if (!card) return;
    const reward = card.plant;
    if (reward.type === 'plant' && !saveData.unlockedPlants.includes(reward.id)) {
        saveData.unlockedPlants.push(reward.id);
    } else if (reward.type === 'tool') {
        if (!saveData.unlockedTools) saveData.unlockedTools = [];
        if (!saveData.unlockedTools.includes(reward.id)) saveData.unlockedTools.push(reward.id);
    }
    writeSave(saveData);
    state._rewardCard = null;
    sweepVictoryLoot();   // 捡卡片同一时刻扫荡场上残留账户绑定物资
    AudioSystem.fadeOutBGM(0.8);
    AudioSystem.playVictory();
    AudioSystem.startRewardMusic();
    state._showReward = true;
    state._rewardPhase = 'wipe';
    state._rewardAlpha = 0;
    state._rewardT = 0;
    state._rewardSceneT = 0;
    state._rewardPlant = reward;
    // 结算界面背景微粒
    state._rewardParticles = Array.from({ length: 24 }, () => ({
        x: Math.random() * CANVAS_WIDTH, y: Math.random() * CANVAS_HEIGHT,
        r: 1 + Math.random() * 2, v: 8 + Math.random() * 18, o: 0.15 + Math.random() * 0.4,
    }));
}

// ============================================================
// 胜利扫荡：戴夫捡钱袋/卡片同一时刻，把场上残留的账户绑定掉落物全部自动拾取
//（与联机 'sweep' 同款：货币爆光+逐枚飞行、碎片直接入档+浮字；药/护甲/即用卡/阳光排除）
// ============================================================
const SWEEP_KINDS = { silver: 1, gold: 1, gem: 1, fragment: 1, wfrag: 1 };
let victoryLootSwept = false;   // 每局只扫一次（startGame 时重置）

// 拾取瞬间的爆光粒子（与 spawner.collectPickup 一致，对应货币颜色）
function spawnSweepBurst(x, y, kind) {
    const color = kind === 'gold' ? '#FFD700' : kind === 'gem' ? '#66FFFF' : '#C0C0FF';
    const seeds = [];
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
        seeds.push({ dx: Math.cos(a), dy: Math.sin(a) });
    }
    state.effects.push({ kind: 'coinburst', x, y, color, seeds, life: 0.4, maxLife: 0.4, _local: true });
}

function sweepVictoryLoot() {
    if (victoryLootSwept) return;   // 钱袋/卡片两个分支共用守卫
    victoryLootSwept = true;
    const items = [];
    state.pickups = state.pickups.filter(p => {
        if (!SWEEP_KINDS[p.kind]) return true;   // 局内道具留在场上，随本局结束消失
        items.push(p);
        return false;
    });
    if (!items.length) return;   // 无残留：无额外表现
    for (const p of items) {
        if (p.kind === 'silver' || p.kind === 'gold' || p.kind === 'gem') {
            // 货币：与走近拾取一致的爆光粒子 + 逐枚飞行落袋入账
            spawnSweepBurst(p.x, p.y, p.kind);
            startCoinFly(p.x, p.y, [{ kind: p.kind, amount: p.amount }]);
        } else if (p.kind === 'fragment' && p.extra) {
            // 植物碎片：入碎片背包 + 本局收获统计 + 浮字提示（与 collectPickup 一致）
            META.fragments[p.extra] = (META.fragments[p.extra] || 0) + (p.amount || 1);
            saveFragments(META.fragments);
            if (state.roundRewards) {
                state.roundRewards.fragments = state.roundRewards.fragments || {};
                state.roundRewards.fragments[p.extra] = (state.roundRewards.fragments[p.extra] || 0) + (p.amount || 1);
            }
            const pname = PLANTS[p.extra] ? PLANTS[p.extra].name : '植物';
            state.effects.push({ kind: 'pickup', x: p.x, y: p.y, life: 0.8, maxLife: 0.8, label: `${pname}碎片×${p.amount || 1}`, _local: true });
            AudioSystem.playClick();
        } else if (p.kind === 'wfrag' && p.extra) {
            // 武器碎片：入武器碎片背包（与 collectPickup 一致）
            META.weaponFrags[p.extra] = (META.weaponFrags[p.extra] || 0) + (p.amount || 1);
            saveWeaponFrags(META.weaponFrags);
            if (state.roundRewards) {
                state.roundRewards.wfrags = state.roundRewards.wfrags || {};
                state.roundRewards.wfrags[p.extra] = (state.roundRewards.wfrags[p.extra] || 0) + (p.amount || 1);
            }
            const wname = WEAPONS[p.extra] ? WEAPONS[p.extra].name : '武器';
            state.effects.push({ kind: 'pickup', x: p.x, y: p.y, life: 0.8, maxLife: 0.8, label: `${wname}碎片×${p.amount || 1}`, _local: true });
            AudioSystem.playClick();
        }
    }
    log(`扫荡战场残留物资 ×${items.length}`);
}

// 胜利后拾取阶段：游戏正常运转（植物继续攻击、子弹继续飞、阳光继续落），僵尸已清空
function updateVictoryCollect(dt) {
    AudioSystem.updateAudio(dt);
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }
    updatePlayer(dave, dt, FIELD);
    updatePlants(dt, DIFFICULTY, (lv) => WEAPON_LEVEL_MUL[Math.max(1, Math.min(lv, 5))]);
    updateBullets(dt);
    // 货币拾取：逐枚飞入账户（与战斗中一致）
    updateSunsAndPickups(dt, dave, FIELD, state, (type, amount, picker, x, y) => {
        startCoinFly(x, y, [{ kind: type, amount }]);
    });

    // 奖励卡片：戴夫走近即拾取
    if (state._rewardCard) {
        state._rewardCard.t += dt;
        const c = state._rewardCard;
        if (Math.hypot(dave.x - c.x, (dave.y - dave.jumpOffset) - c.y) < 42) {
            collectRewardCard();
        }
    }

    // 钱袋：戴夫走近即拾取 → 钱币逐枚飞入账户
    if (state._rewardBag) {
        state._rewardBag.t += dt;
        const b = state._rewardBag;
        if (Math.hypot(dave.x - b.x, (dave.y - dave.jumpOffset) - b.y) < 42) {
            state._rewardBag = null;
            state._bagFlow = true; // 标记钱袋流程：飞完才弹结算
            sweepVictoryLoot();   // 捡钱袋同一时刻扫荡场上残留账户绑定物资
            startCoinFly(b.x, b.y, b.loot);
        }
    }

    // 钱币飞行中：钱袋流程全部落袋后才弹出结算并播放胜利音效
    if (state._coinFly) {
        if (updateCoinFly(dt, true) && state._bagFlow) showSummaryScreen();
    }
}

// 结算转场：wipe(屏幕0.8s渐亮至纯白) → reveal(0.35s过曝) → detail/summary(面板渐显)
const REWARD_TIMING = { wipe: 0.8, reveal: 0.35, detailIn: 0.5 };

function updateRewardAnim(dt) {
    state._rewardT = (state._rewardT || 0) + dt;
    state._rewardSceneT = (state._rewardSceneT || 0) + dt;
    // 结算页期间继续衰减特效并推进钱币飞行（否则飞行中的钱币会冻在半空）
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }
    if (state._coinFly) updateCoinFly(dt, true);
    if (state._rewardPhase === 'wipe') {
        state._rewardAlpha = Math.min(1, state._rewardT / REWARD_TIMING.wipe);
        if (state._rewardAlpha >= 1) {
            // 重打结算没有卡片，直接进结算页
            state._rewardPhase = state._rewardPlant ? 'reveal' : 'summary';
            state._rewardT = 0;
        }
    } else if (state._rewardPhase === 'reveal') {
        state._rewardAlpha = 1;
        if (state._rewardT >= REWARD_TIMING.reveal) {
            state._rewardPhase = 'detail';
            state._rewardT = 0;
            state._rewardAlpha = 0;
        }
    } else if (state._rewardPhase === 'detail' || state._rewardPhase === 'summary') {
        state._rewardAlpha = Math.min(1, (state._rewardAlpha || 0) + dt / REWARD_TIMING.detailIn);
    }
}

function getWeaponDurability(key, level) {
    const base = WEAPON_META[key]?.baseDurability || 20;
    return Math.round(base * (1 + (level - 1) * 0.2));
}

// ========================================
// 局内暂停菜单（ESC）：冻结画面 + 打开设置面板，播放 pause.mp3
// 联机模式无法暂停共享对局，仅打开设置面板供调音量等
// ========================================
function togglePauseMenu() {
    if (state._pauseMenu) {
        closePauseMenu();
        return;
    }
    state._pauseMenu = true;
    // 单机才冻结游戏逻辑；联机对局由服务器推进，不能暂停
    if (!(state.mp && state.mp.active)) state.paused = true;
    AudioSystem.playPause?.();

    const modal = document.getElementById('settings-modal');
    const title = modal?.querySelector('.modal-title');
    if (title && !title.dataset.orig) {
        title.dataset.orig = title.textContent;
        title.textContent = '⏸ 已暂停';
    }
    // 只有单机显示"返回主菜单"（联机退房逻辑独立）
    if (!(state.mp && state.mp.active)) {
        document.getElementById('btn-pause-quit')?.classList.remove('hidden');
    }
    Settings.open();
}

function closePauseMenu() {
    state._pauseMenu = false;
    state.paused = false;
    AudioSystem.playPause?.();

    const modal = document.getElementById('settings-modal');
    modal?.classList.add('hidden');
    const title = modal?.querySelector('.modal-title');
    if (title && title.dataset.orig) {
        title.textContent = title.dataset.orig;
        delete title.dataset.orig;
    }
    document.getElementById('btn-pause-quit')?.classList.add('hidden');
}

// ========================================
// 武器槽位/射击模式/换弹（单机与训练营；联机保持点击单发手感）
// ========================================
function currentWeaponDef() {
    return WEAPONS[dave.currentWeapon] || null;
}

// X：近战槽 ↔ 远程槽 切换（空槽则回拳头/铲子）
function swapWeaponSlots() {
    const cur = dave.currentWeapon;
    const melee = dave.equippedMelee;
    const ranged = dave.equippedRanged;
    let next = null;
    if (cur === melee) next = ranged || melee;
    else next = melee || ranged;
    if (!next || next === cur) { log('另一槽位没有武器'); return; }
    dave.currentWeapon = next;
    dave.reloading = false;
    dave.charging = false;
    state.aiming = false;
    AudioSystem.stopBowCharge();
    // 切换时按新武器重置弹匣状态（弹匣弹药跟随武器保存）
    log(`切换到 ${WEAPONS[next].name}`);
    AudioSystem.playClick();
}

// C：铲子工具（不占武器槽，解锁后随时切出/收回）
function toggleShovelTool() {
    if (!isShovelUnlocked(saveData)) { log('尚未解锁铲子'); return; }
    if (dave.currentWeapon === 'shovel') {
        // 收回铲子，恢复之前的武器
        const back = dave._preShovelWeapon && dave._preShovelWeapon !== 'shovel'
            ? dave._preShovelWeapon : (dave.equippedWeapon || null);
        dave.currentWeapon = back;
        dave._preShovelWeapon = null;
        log(back ? `收回铲子，切回 ${WEAPONS[back].name}` : '收回铲子（空手）');
    } else {
        dave._preShovelWeapon = dave.currentWeapon;
        dave.currentWeapon = 'shovel';
        dave.reloading = false;
        dave.charging = false;
        state.aiming = false;
        AudioSystem.stopBowCharge();
        log('切出铲子（可铲除植物返还50%阳光）');
    }
    AudioSystem.playClick();
}

// V：半自动 ↔ 全自动（仅支持双模式的武器：步枪/冲锋枪）
function toggleFireMode() {
    const w = currentWeaponDef();
    if (!w || !w.modes || w.modes.length < 2) { log('该武器不支持切换射击模式'); return; }
    dave.fireMode = dave.fireMode === 'auto' ? 'semi' : 'auto';
    log(`射击模式：${dave.fireMode === 'auto' ? '全自动' : '半自动'}`);
    AudioSystem.playClick();
}

// R：换弹
function tryReloadWeapon() {
    const r = startReload(dave);
    if (r.ok) {
        log('换弹中...');
        AudioSystem.playWeaponReload(dave.currentWeapon);
    } else if (r.msg) {
        log(r.msg);
    }
}

// ========================================
// 输入绑定
// ========================================
function bindInputEvents() {
    const canvas = document.getElementById('game');

    // 键盘
    window.addEventListener('keydown', (e) => {
        if (inputFocused) return;
        const k = e.key.toLowerCase();
        keys[k] = true;

        if (k === 'f11') { e.preventDefault(); toggleFullscreen(); return; }

        if (!gameRunning || state.gameOver || state._preLaunch) return;

        // ESC：局内打开/关闭暂停菜单（暂停画面 + 设置面板），优先于联机守卫
        if (k === 'escape') {
            e.preventDefault();
            togglePauseMenu();
            return;
        }
        // 暂停中屏蔽所有游戏操作
        if (state.paused || state._pauseMenu) return;
        // 联机模式：种植/攻击/跳跃等输入由 mpGame 的 hostKeyDown/guestKeyDown 独立处理，
        // 此处若放行会把 F 键送进单机 tryPlant，吃掉阳光和冷却，导致客人种植事件永远发不出去
        if (state.mp && state.mp.active) return;

        if (k === ' ') {
            e.preventDefault();
            tryJump(dave);
        }
        if (k >= '1' && k <= '8') selectCard(parseInt(k) - 1);
        if (k === 'f') tryPlant();
        if (k === 't') callNextWave();
        if (k === 'q') { e.preventDefault(); startDash(dave); }
        if (k === 'e') { e.preventDefault(); startGuard(dave); }
        if (k === 'x') { e.preventDefault(); swapWeaponSlots(); }
        if (k === 'c') { e.preventDefault(); toggleShovelTool(); }
        if (k === 'v') { e.preventDefault(); toggleFireMode(); }
        if (k === 'r') { e.preventDefault(); tryReloadWeapon(); }
    });

    window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        keys[k] = false;
        if (k === 'e') endGuard(dave);
    });

    // 鼠标
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = (e.clientX - rect.left) * (960 / rect.width);
        mouse.y = (e.clientY - rect.top) * (540 / rect.height);
        mouse.inside = true;
    });
    canvas.addEventListener('mouseleave', () => { mouse.inside = false; });

    // 屏蔽局内右键菜单；窗口失焦时取消瞄准
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', (e) => { if (gameRunning) e.preventDefault(); });
    window.addEventListener('blur', () => { state.aiming = false; });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            // 阻止浏览器右键手势/长按默认行为
            e.preventDefault();
            // 右键点击切换瞄准（仅狙击枪有瞄准镜；联机也可用，纯本地视角效果）
            const wd = currentWeaponDef();
            if (wd && wd.scope) {
                state.aiming = !state.aiming;
                AudioSystem.playClick();
            }
            return;
        }
        if (e.button !== 0) return;
        state.mouseDown = true;
        // 联机模式：攻击由 mpGame 的 hostMouseDown/客人 mousedown 处理
        if (state.mp && state.mp.active) return;

        // 结算界面点击（植物详情 detail / 重打结算 summary）
        if (state._showReward && (state._rewardAlpha || 0) >= 0.6) {
            if (state._rewardPhase === 'detail' || state._rewardPhase === 'summary') {
                if (mouse.y > CANVAS_HEIGHT - 80) {
                    // 下方按钮区域
                    if (mouse.x < CANVAS_WIDTH / 2) {
                        AudioSystem.stopRewardMusic();
                        stopGame();
                        state._showReward = false;
                        showScreen('menu');
                    } else if (state._rewardNextLevel) {
                        AudioSystem.stopRewardMusic();
                        stopGame();
                        state._showReward = false;
                        const maxSlots = saveData.maxSlots || 6;
                        const available = state._rewardNextLevel.allowedCards.filter(k => saveData.unlockedPlants.includes(k));
                        if (available.length <= maxSlots) {
                            startGame(state._rewardNextLevel, available);
                        } else {
                            import('./source-code/ui/cardSelect.js').then(cs => {
                                cs.openCardSelect(state._rewardNextLevel, (lv, deck) => startGame(lv, deck));
                            });
                        }
                    }
                }
                return;
            }
            return;
        }

        if (!gameRunning || state.gameOver || state._preLaunch) return;

        // 弓箭：按住蓄力，松开才射出
        const wd = currentWeaponDef();
        if (wd && wd.chargeable) {
            if (dave.reloading) { log('换弹中...'); return; }
            dave.charging = true;
            dave.chargeT = 0;
            if (dave.currentWeapon === 'bow') AudioSystem.playBowCharge(); // 播放拉弓段（前 2.1s）
            return;
        }

        const result = tryUseWeapon(dave, (lv) => WEAPON_LEVEL_MUL[Math.max(1, Math.min(lv, 5))], isShovelUnlocked(saveData));
        if (result.ok) {
            const w = WEAPONS[dave.currentWeapon] || WEAPONS.dagger;
            if (w && w.kind === 'ranged') {
                AudioSystem.playShoot(dave.currentWeapon);
            } else {
                AudioSystem.playMeleeSwing(dave.currentWeapon || 'dagger');
            }
        } else if (result.msg) {
            log(result.msg);
        }
    });

    // 松开左键：弓箭放箭 / 结束全自动连发
    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) return; // 瞄准为点击切换，不由松开右键取消
        if (e.button !== 0) return;
        state.mouseDown = false;
        if (state.mp && state.mp.active) return;
        if (!gameRunning || state.gameOver || state._preLaunch) return;
        if (dave.charging) {
            const wd = currentWeaponDef();
            // 弓箭必须蓄力：低于最短蓄力时间直接收弓，不放箭
            if ((dave.chargeT || 0) < 0.25) {
                dave.charging = false;
                dave.chargeT = 0;
                AudioSystem.stopBowCharge();
                log('蓄力不足，按住左键拉弓');
                return;
            }
            const charge = 0.4 + Math.min(1, (dave.chargeT || 0) / (wd?.maxCharge || 1)) * 1.1;
            dave.charging = false;
            dave.chargeT = 0;
            const result = tryUseWeapon(dave, (lv) => WEAPON_LEVEL_MUL[Math.max(1, Math.min(lv, 5))], isShovelUnlocked(saveData), charge);
            if (result.ok) {
                // 弓箭放发射段（2.1s 之后），其他武器走通用开火音
                if (dave.currentWeapon === 'bow') AudioSystem.playBowFire();
                else AudioSystem.playShoot(dave.currentWeapon);
            }
            else if (result.msg) log(result.msg);
        }
    });

    // 局内昵称框：只读展示（改名在主界面"改名"按钮进行，每次 10 银币）
    const heroName = document.getElementById('hero-name');
    if (heroName) {
        heroName.readOnly = true;
        heroName.title = '昵称在主界面修改（每次消耗 10 银币）';
        heroName.value = displayName(saveData);
    }

    // 暂停菜单：点设置弹窗的"关闭"时同步恢复游戏
    document.getElementById('settings-close')?.addEventListener('click', () => {
        if (state._pauseMenu) closePauseMenu();
    });
    // 暂停菜单里的"返回主菜单"（仅单机显示）
    document.getElementById('btn-pause-quit')?.addEventListener('click', () => {
        state._pauseMenu = false;
        state.paused = false;
        const modal = document.getElementById('settings-modal');
        modal?.classList.add('hidden');
        const title = modal?.querySelector('.modal-title');
        if (title && title.dataset.orig) {
            title.textContent = title.dataset.orig;
            delete title.dataset.orig;
        }
        document.getElementById('btn-pause-quit')?.classList.add('hidden');
        document.getElementById('tr-sidebar')?.classList.add('hidden');
        stopGame();
        showScreen('menu');
    });
}

// ========================================
// 初始化
// ========================================
export function initGame() {
    // 加载存档
    setSaveData(loadSave());
    
    // 加载动画
    const overlay = document.getElementById('loading-overlay');
    const bar = document.getElementById('load-bar');
    const title = document.getElementById('load-title');
    const press = document.getElementById('load-press');
    let loadDone = false;
    let titleAnimTimer = null, pressBlinkTimer = null;

    const animate = () => {
        let w = 0;
        const step = () => {
            w += 1 + Math.random() * 3;
            if (w > 100) w = 100;
            bar.style.width = w + '%';
            if (w < 100) setTimeout(step, 60 + Math.random() * 40);
            else {
                title.style.opacity = '0';
                title.style.transform = 'scale(0.8)';
                setTimeout(() => {
                    title.innerHTML = '<span id="t-plant" style="color:#00FF88;display:inline-block;">植物</span> <span id="t-vs" style="color:#FFD700;display:inline-block;">大战</span> <span id="t-zombie" style="color:#FF4444;display:inline-block;">僵尸</span>';
                    title.style.fontSize = '5vw';
                    title.style.letterSpacing = '1vw';
                    title.style.opacity = '1';
                    title.style.transform = 'scale(1)';
                    title.style.transition = 'opacity 0.6s, transform 0.8s';
                    // 标题动画
                    let t = 0;
                    titleAnimTimer = setInterval(() => {
                        const plant = document.getElementById('t-plant');
                        const vs = document.getElementById('t-vs');
                        const zombie = document.getElementById('t-zombie');
                        if (!loadDone) return;
                        t += 0.1;
                        if (plant) { const s = 1 + Math.sin(t * 1.5) * 0.05; plant.style.transform = `scale(${s})`; plant.style.textShadow = `0 0 ${8 + Math.sin(t * 2) * 6}px #00FF88`; }
                        if (vs) { vs.style.opacity = 0.7 + Math.abs(Math.sin(t * 3)) * 0.3; }
                        if (zombie) { const dx = Math.sin(t * 12) * 2; zombie.style.transform = `translateX(${dx}px)`; zombie.style.textShadow = `0 0 ${4 + Math.abs(Math.sin(t * 8)) * 8}px #FF4444`; }
                    }, 50);
                }, 500);
                setTimeout(() => { loadDone = true;
                    press.style.opacity = '1';
                    let visible = true;
                    pressBlinkTimer = setInterval(() => {
                        if (!loadDone) return;
                        press.style.opacity = visible ? '0.2' : '1';
                        press.style.transition = 'opacity 1.5s';
                        visible = !visible;
                    }, 1500);
                }, 1000);
            }
        };
        step();
    };
    animate();

    const finish = () => {
        if (!loadDone) return;
        AudioSystem.playClick();
        clearInterval(titleAnimTimer);
        clearInterval(pressBlinkTimer);
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; }, 800);
        document.removeEventListener('click', finish);
        document.removeEventListener('keydown', finish);
    };
    document.addEventListener('click', finish);
    document.addEventListener('keydown', finish);

    // 初始化任务系统 & 图鉴系统
    initMissions();
    Almanac.init();
    MissionSystem.addStyles();
    
    // 初始化新图鉴界面、商店、设置、联机
    AlmanacUI.init();
    Shop.init();
    Settings.init();
    MultiplayerUI.init();
    
    // Canvas
    const canvas = document.getElementById('game');
    initCanvas(canvas);

    // UI
    initHUD();
    initModalButtons();
    initScreenButtons({
        onShowLevelSelect: () => {
            import('./source-code/ui/levelSelect.js').then(m => {
                m.renderLevelSelect((level) => {
                    openCardSelect(level, (lv, deck) => startGame(lv, deck));
                });
            });
        },
        onContinue: () => {
            if (saveData.lastLevel) {
                const lv = LEVELS.find(l => l.id === saveData.lastLevel);
                if (lv) startGame(lv, saveData.decks?.[lv.id]);
            }
        },
        onQuitLevel: stopGame,
    });

    // 选卡界面初始化
    import('./source-code/ui/cardSelect.js').then(cs => cs.initCardSelect());

    // 输入绑定
    bindInputEvents();

    // 初始难度
    Object.assign(DIFFICULTY, DIFFICULTY_PRESETS.normal);

    // 装备默认武器
    const eq = META.weapons?.equipped;
    if (eq && META.weapons.unlocked[eq]) {
        dave.currentWeapon = eq;
    } else if (isShovelUnlocked(saveData)) {
        dave.currentWeapon = 'shovel';
    }

    // 初始化登录账户系统
    initAuthSystem();

    // 好友邀请链接：已登录则自动打开联机弹窗并加入房间
    MultiplayerUI.tryAutoJoinFromURL();

    // 荒原邀请链接：?wroom= 自动加入（与本体塔防 ?room= 隔离；游客也可加入，与本体建房/入房一致）
    const wroomCode = new URLSearchParams(location.search).get('wroom');
    if (wroomCode && /^[A-Za-z0-9]{6}$/.test(wroomCode)) {
        import('./source-code/mod-wasteland/mpWasteland.js?v=4.13')
            .then(m => m.tryAutoJoinWastelandFromURL())
            .catch(err => console.error('[wasteland-mp] 自动加入失败', err));
    }

    AudioSystem.loadAudioAssets();
    log('Ready! Click "Start Game"');
}

// ========================================
// 账户 / 登录系统（从 game.js.old 完整移植）
// ========================================
function initAuthSystem() {
    if (!window.Net) return;

    const loginScreen  = document.getElementById('login-screen');
    const menuScreen   = document.getElementById('menu-screen');
    const tabs         = document.querySelectorAll('.login-tab');
    const submitBtn    = document.getElementById('login-submit');
    const guestBtn     = document.getElementById('login-guest');
    const usernameEl   = document.getElementById('login-username');
    const passwordEl   = document.getElementById('login-password');
    const msgEl        = document.getElementById('login-msg');
    const accountsEl   = document.getElementById('login-accounts');
    const userNameSpan = document.getElementById('user-name');
    const btnLogout    = document.getElementById('btn-logout');
    const heroNameEl   = document.getElementById('hero-name');

    let mode = 'login'; // 'login' | 'register'

    function setMsg(text, ok) {
        msgEl.textContent = text || '\u00a0';
        msgEl.classList.toggle('ok', !!ok);
    }

    function setMode(next) {
        mode = next;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
        submitBtn.textContent = (mode === 'login') ? '登  录' : '注册并登录';
        setMsg('');
    }

    async function renderAccounts() {
        // 本地 + 服务器账户合并显示（服务器账户跨电脑通用）
        const local = Net.auth.listAccounts();
        const remote = Net.auth.fetchServerAccounts ? await Net.auth.fetchServerAccounts() : [];
        const list = [...new Set([...local, ...remote])];
        if (!list.length) {
            accountsEl.innerHTML = '<div class="acc-title">尚无账户，请先注册</div>';
            return;
        }
        accountsEl.innerHTML =
            '<div class="acc-title">已有账户 (点击填入):</div>' +
            list.map(u => `<span class="acc-item" data-u="${u}">${u}</span>`).join('');
        accountsEl.querySelectorAll('.acc-item').forEach(el => {
            el.addEventListener('click', () => {
                usernameEl.value = el.dataset.u;
                passwordEl.focus();
            });
        });
    }

    tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.tab)));

    async function submit() {
        const u = usernameEl.value.trim();
        const p = passwordEl.value;
        setMsg('处理中...');
        submitBtn.disabled = true;
        try {
            let res;
            if (mode === 'register') {
                res = await Net.auth.register(u, p);
                if (!res.ok) { setMsg(res.error); return; }
                res = await Net.auth.login(u, p);
            } else {
                res = await Net.auth.login(u, p);
            }
            if (!res.ok) { setMsg(res.error); return; }
            setMsg('登录成功，正在同步存档...', true);
            // 拉取服务器存档覆盖本地（跨电脑进度一致），然后刷新进入游戏
            try {
                const r = await Net.cloud.pull();
                if (r.ok && r.data && !r.local) {
                    const prefix = `u:${u}:`;
                    Object.entries(r.data).forEach(([k, v]) => localStorage.setItem(prefix + k, v));
                }
            } catch {}
            setMsg('登录成功，正在进入...', true);
            setTimeout(() => location.reload(), 250);
        } catch (err) {
            setMsg('操作失败: ' + (err && err.message ? err.message : err));
        } finally {
            submitBtn.disabled = false;
        }
    }

    submitBtn.addEventListener('click', submit);
    [usernameEl, passwordEl].forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
        });
    });

    guestBtn.addEventListener('click', () => {
        showScreen('menu');
        refreshUserBar();
    });

    btnLogout.addEventListener('click', () => {
        if (!Net.auth.isLoggedIn()) {
            showScreen('login');
            renderAccounts();
            return;
        }
        if (!confirm('确认登出当前账户？')) return;
        Net.auth.logout();
        location.reload();
    });

    function refreshUserBar() {
        const u = Net.currentUser();
        userNameSpan.textContent = displayName(saveData);
        if (heroNameEl) heroNameEl.value = displayName(saveData);
        btnLogout.textContent = u ? '登出' : '切换账户';
    }

    // 主界面改名：每次消耗 10 银币，无次数限制；昵称存档，与账户名独立（登录仍用账户名）
    const btnRename = document.getElementById('btn-rename');
    if (btnRename) {
        btnRename.addEventListener('click', () => {
            if (document.getElementById('rename-input')) return;
            const current = displayName(saveData);
            const bar = document.getElementById('user-bar');
            const input = document.createElement('input');
            input.id = 'rename-input';
            input.value = current;
            input.maxLength = 6;
            input.style.cssText = 'width:84px;padding:2px 6px;border:1px solid #666;border-radius:4px;background:#1a1a2e;color:#eee;';
            const ok = document.createElement('button');
            ok.className = 'user-btn';
            ok.textContent = '确定(-10银)';
            const cancel = document.createElement('button');
            cancel.className = 'user-btn';
            cancel.textContent = '取消';
            btnRename.classList.add('hidden');
            bar.insertBefore(cancel, btnRename.nextSibling);
            bar.insertBefore(ok, cancel);
            bar.insertBefore(input, ok);
            input.focus();
            input.select();
            const cleanup = () => {
                input.remove(); ok.remove(); cancel.remove();
                btnRename.classList.remove('hidden');
            };
            cancel.addEventListener('click', cleanup);
            const submit = () => {
                const name = input.value.trim().slice(0, 6);
                if (!name || name === current) { cleanup(); return; }
                if ((META.currency.silver || 0) < 10) {
                    input.style.borderColor = '#FF5555';
                    input.title = `银币不足（当前 ${META.currency.silver || 0}，需要 10）`;
                    return;
                }
                addCurrency(META.currency, 'silver', -10);
                saveData.playerName = name;
                writeSave(saveData);
                dave.label = name;
                cleanup();
                refreshUserBar();
            };
            ok.addEventListener('click', submit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') cleanup();
            });
        });
    }

    // 启动路由
    const inviteCode = MultiplayerUI.getRoomCodeFromURL();
    if (Net.auth.isLoggedIn()) {
        showScreen('menu');
    } else {
        showScreen('login');
        if (inviteCode) {
            // 好友邀请链接：要求登录/注册后再进房间（登录成功后页面刷新，URL 参数保留，届时自动加入）
            setMsg(`好友邀请你加入房间 ${inviteCode}，请先登录或注册`, true);
            guestBtn.style.display = 'none';
        }
    }
    renderAccounts();
    refreshUserBar();
}

// 全局导出
window.Game = {
    init: initGame,
    start: startGame,
    stop: stopGame,
    showScreen,
    saveData,
    LEVELS,
    PLANTS,
    WEAPONS,
    META,
};
