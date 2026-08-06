// ============================================================
// 多人联机游戏同步模块
// ============================================================

import { FIELD, DIFFICULTY, DIFFICULTY_PRESETS, LEVELS, PLANTS, CARD_ORDER,
    WEAPONS, WEAPON_LEVEL_MUL, DROP_TABLE, ZOMBIE_FRAG_WEIGHTS, WEAPON_FRAG_WEIGHTS,
    ACTION, ZOMBIES, MIN_PLANT_DIST, LEVEL_REWARDS, LEVEL_TABLE } from '../core/constants.js';

import { state, dave, dave2, resetLevelState, resetPlayerState,
    keys, mouse, setGameRunning, gameRunning, rafId, setRafId,
    setLastTime, lastTime, saveData } from '../core/state.js';

import { rowY, isShovelUnlocked, computeTotalKills, displayName } from '../core/utils.js';
import { buildLevelSpawnList, nextWaveTimeout } from '../systems/waves.js';
import { startCoinFly, updateCoinFly } from '../systems/coinFly.js';
import { initCanvas, render } from '../core/render.js';
import { updatePlayer, tryJump, startDash, startGuard, endGuard,
    checkPlayerDamage, currentMoveDir, finishPlayerTimers,
    findPlantNear, digPlant } from '../entities/player.js';
import { updatePlants, updateBullets, updateZombies, tryUseWeapon,
    startSwing, applyDamageToZombie, startReload, updateReload } from '../systems/combat.js';
import { updateSunsAndPickups, spawnZombie, rollBagLoot } from '../systems/spawner.js';
import { META, loadSave, writeSave, saveFragments,
    saveWeaponFrags, addCurrency, saveAmmo } from '../persistence/storage.js';
import { initHUD, updateHUD, log, selectCard, updateLogTimer, renderCardSlots } from '../ui/hud.js';
import { showScreen, hideModal } from '../ui/screens.js';
import AudioSystem from '../systems/audio.js';

let mpRole = null;
let syncInterval = null;
let lastSyncTime = 0;
const SYNC_RATE = 100; // ms between host syncs
const INPUT_RATE = 50; // ms between guest input sends

export function startMultiplayerGame(role, deck, levelId, onEnd) {
    mpRole = role;

    const level = LEVELS.find(l => l.id === levelId) || LEVELS[0];
    const canvas = document.getElementById('game');
    initCanvas(canvas);

    resetLevelState(level);
    // 小推车：每行配一辆（此前联机漏配，与单机一致）
    for (const r of level.rows) state.mowers[r] = true;
    // 清理上一局的奖励/结算状态（联机重开下一关时尤其重要）
    state._bagFlow = false;
    state._coinFly = null;
    state._showReward = false;
    state._rewardCard = null;
    state._rewardBag = null;
    state._rewardPlant = null;
    state._lootSwept = false;   // 胜利扫荡守卫：每局只扫一次
    // 与单机一致：应用难度预设 + 关卡难度修正，两端强度相同
    Object.assign(DIFFICULTY, DIFFICULTY_PRESETS.normal);
    if (level.diffMod) {
        Object.keys(level.diffMod).forEach(k => {
            if (DIFFICULTY[k] != null) DIFFICULTY[k] *= level.diffMod[k];
        });
    }
    const midRow = level.rows[Math.floor(level.rows.length / 2)];
    const midY = rowY(midRow);
    resetPlayerState(dave, midY);
    resetPlayerState(dave2, midY);

    state.sun = level.firstSun;
    state._zombiePool = level.zombiePool;
    // 原版机制：开局即预生成整关出怪列表（与单机一致，进度条两端对齐）
    state._levelSpawnList = buildLevelSpawnList(level.waves, level.zombiePool, DIFFICULTY.countMul);
    state.mp.active = true;
    state.mp.role = role;
    // 联机卡组：双方共用同一套卡槽（植物、阳光、冷却均为共享）
    state._allowedCards = (deck && deck.length) ? deck : (level.allowedCards || []).slice(0, saveData.maxSlots || 6);

    // 联机武器：房主取远程槽（无则近战槽），保持点击单发手感（不启用弹匣规则）
    const eqM = META.weapons?.equippedMelee, eqR = META.weapons?.equippedRanged;
    dave.equippedMelee = (eqM && META.weapons.unlocked?.[eqM]) ? eqM : null;
    dave.equippedRanged = (eqR && META.weapons.unlocked?.[eqR]) ? eqR : null;
    dave.equippedWeapon = dave.equippedRanged || dave.equippedMelee;
    dave.currentWeapon = dave.equippedWeapon || (isShovelUnlocked(saveData) ? 'shovel' : null);
    // 弹匣/备弹/换弹/蓄力（与单机一致：双方各自使用自己账户的弹药库存）
    dave.fireMode = null;
    dave.reloading = false;
    dave.charging = false;
    dave.chargeT = 0;
    dave.magAmmo = null;
    dave._preShovelWeapon = null;
    state.reserveAmmo = {};
    const rwDef = dave.equippedRanged ? WEAPONS[dave.equippedRanged] : null;
    if (rwDef && rwDef.magSize) {
        dave.magAmmo = rwDef.magSize;
        dave.fireMode = rwDef.defaultMode || (rwDef.modes ? rwDef.modes[0] : 'semi');
        // 备弹 = 本人弹药库中该弹种的全部库存，带入局内并从库存扣除（消耗品）
        const carried = META.ammo?.[rwDef.ammoType] || 0;
        state.reserveAmmo[rwDef.ammoType] = carried;
        if (carried > 0) {
            META.ammo[rwDef.ammoType] = 0;
            saveAmmo(META.ammo);
        }
    }
    dave2.currentWeapon = 'dagger';
    dave2._allowedWeapons = null;
    dave2.magAmmo = null;
    dave2.reloading = false;
    dave2.charging = false;
    dave2.fireMode = null;

    saveData.lastLevel = level.id;
    writeSave(saveData);

    showScreen('game');
    document.getElementById('level-tag') && (document.getElementById('level-tag').textContent = `${level.id} · ${level.name}`);
    setGameRunning(true);
    setLastTime(performance.now());
    initHUD();
    document.getElementById('top-bar')?.classList.remove('hidden');
    renderCardSlots();

    // 准备种植阶段（与单机一致的三拍：0s 准备 → 0.53s 种植 → 1.06s 开局，放完才起 BGM）
    state._preLaunch = true;
    state._preLaunchTimer = 1.06;
    state._preLaunchT = 0;
    state._postLaunch = 0;
    AudioSystem.stopBGM();
    AudioSystem.playPreLaunch();
    log(`${level.name} · 多人模式 (${role === 'host' ? '房主' : '客人'})`);

    // 双方昵称：本机名称立即设置（自改昵称 > 账户名），对方名称通过 输入包/快照 同步
    const myName = displayName(saveData);
    dave.label = myName;
    if (role === 'host') {
        state.mp.hostName = myName;
        state.mp.guestName = '好友';
        syncInterval = setInterval(() => sendSync(), SYNC_RATE);
        Net.mp.on('input', handleGuestInput);
        bindHostInputEvents(level);
    } else {
        state.mp.guestName = myName;
        state.mp.hostName = '房主';
        syncInterval = setInterval(() => sendInput(), INPUT_RATE);
        Net.mp.on('sync', handleHostSync);
        Net.mp.on('evt', handleMpEvent);
        bindGuestInputEvents();
    }

    Net.mp.on('gameEnd', handleMpGameEnd);
    Net.mp.on('status', handleMpStatus);

    setRafId(requestAnimationFrame((t) => mpGameLoop(t, level, onEnd)));
}

// 命名处理器：配合 off() 避免每次开局重复注册
function handleMpGameEnd(data) {
    if (mpRole !== 'guest') return;
    if (state._coinFly) {
        // 等本地钱币飞行音效播完再结束（兜底 3s）
        const t0 = performance.now();
        const timer = setInterval(() => {
            if (!state._coinFly || performance.now() - t0 > 3000) {
                clearInterval(timer);
                endMultiplayerGame(data.win);
            }
        }, 100);
        return;
    }
    endMultiplayerGame(data.win);
}

function handleMpStatus(data) {
    if (data.status === 'reconnecting' && gameRunning) {
        // 客人重连中：对局保持运行，不散场（host 权威模拟继续，快照恢复后自动追平）
        log(`连接中断，正在重连(${data.attempt || 1}/8)...`);
    } else if (data.status === 'connected' && data.reconnected && gameRunning) {
        // 重连成功：host 下一拍 sync 即恢复权威下发；guest 输入包恢复上报，无需额外处理
        log('重连成功！');
    } else if (data.status === 'guest-disconnected' && gameRunning) {
        // 房主侧：客人掉线等待重连（sendSync 在未连接时自动跳过）
        log('好友连接中断，等待其重连...');
    } else if (data.status === 'closed' && gameRunning) {
        log('对手已断开连接');
        // 直接散场回菜单（无论战斗中还是结算页）
        stopMultiplayer();
    }
}

function unregisterMpEvents() {
    Net.mp.off('gameEnd', handleMpGameEnd);
    Net.mp.off('status', handleMpStatus);
    Net.mp.off('input', handleGuestInput);
    Net.mp.off('sync', handleHostSync);
    Net.mp.off('evt', handleMpEvent);
}

// 客人端事件音效：与单人一致的听觉反馈（阳光/货币/种植/豌豆/出怪/波次）
function handleMpEvent(e) {
    if (!e || mpRole !== 'guest') return;
    if (e.type === 'sun') {
        AudioSystem.playCollect();
        spawnLocalSunEffects(e.x, e.y, e.value);
    } else if (e.type === 'sunspawn') {
        AudioSystem.playSunProduce();
    } else if (e.type === 'pea') {
        const n = Math.min(2, e.n || 1);
        for (let i = 0; i < n; i++) {
            setTimeout(() => AudioSystem.playPeaShoot(), i * 60);
        }
    } else if (e.type === 'wave') {
        // 波次警示音只在大量僵尸出现（旗帜波/最终波/大波预警）时播放
        if (e.big) AudioSystem.playWaveWarning();
        if (e.msg) log(e.msg);
        // 大字公告与房主同步（"一大波僵尸来袭"/"最后一波"）
        if (e.announce) state._announce = { text: e.announce, start: performance.now() };
    } else if (e.type === 'credit') {
        // 资源共享：任何一方捡到的货币双方都有份——爆光粒子 + 本地逐枚飞行，落袋计入本机账户
        spawnCoinBurst(e.x, e.y, e.kind);
        startCoinFly(e.x != null ? e.x : dave.x, e.y != null ? e.y : dave.y, [{ kind: e.kind, amount: e.amount }]);
    } else if (e.type === 'bagpick') {
        // 钱袋被拾取（谁拾都行）：本地也播放钱币飞行，逐枚计入本机账户（奖励共享）
        state._bagFlow = true;
        spawnCoinBurst(e.x, e.y, 'gold');
        startCoinFly(e.x, e.y, e.loot || []);
    } else if (e.type === 'cardpick') {
        // 新植物卡片被任一玩家拾取：本机也解锁入档，进入卡片详情结算页
        state._rewardCard = null;
        mpUnlockReward(e.plant);
        mpShowRewardScreen(e.plant);
    } else if (e.type === 'nextlevel') {
        // 房主选择了下一关：跟随重开（保留房间连接）
        AudioSystem.stopRewardMusic();
        restartMpGame(e.levelId, e.deck);
    } else if (e.type === 'nextwave') {
        if (e.msg) log(e.msg);
    } else if (e.type === 'pickup') {
        // 资源共享：碎片类不管谁捡，客人端统一入本机账户并弹浮字（与单机一致）；
        // 货币类拾取音效已由钱币飞行逐枚播放，此处不再重复
        if ((e.kind === 'fragment' || e.kind === 'wfrag') && e.extra) {
            creditFragment(e.kind, e.extra, e.amount || 1, e.x, e.y);
        }
    } else if (e.type === 'plant') {
        AudioSystem.playPlant();
    } else if (e.type === 'atk') {
        // 房主出手即时复现：近战挥击弧光+挥击音；远程枪口火光+开火音（快照 100ms 才到，特效等不起）
        const w = WEAPONS[e.w] || {};
        if (e.kind === 'melee') {
            dave2.swingTimer = 0.22;
            dave2.swingDir = e.angle;
            dave2.swingWeapon = e.w;
            AudioSystem.playWeaponSwing(e.w);
        } else {
            if (e.w === 'bow') AudioSystem.playBowFire();
            else AudioSystem.playWeaponShot(e.w);
            state.effects.push({
                kind: 'muzzle',
                x: e.x + Math.cos(e.angle) * 26,
                y: e.y + Math.sin(e.angle) * 26,
                angle: e.angle, color: w.color,
                label: { pistol: '砰', smg: '砰', rifle: '砰', shotgun: '轰', sniper: '轰', bow: '嗖', knife: '嗖' }[e.w] || '砰',
                ghosts: (e.w === 'shotgun' || e.w === 'sniper') ? 2 : 1,
                life: 0.12, maxLife: 0.12, _local: true,
            });
        }
    } else if (e.type === 'fx') {
        // 房主端瞬时音效事件（画面特效已由快照同步，这里只补单机同款音效）
        if (e.kind === 'boom') {
            // 樱桃半径 130 / 土豆雷 100（乘等级倍率），按阈值粗分音色
            if ((e.radius || 0) >= 115) AudioSystem.playCherryBomb(); else AudioSystem.playPotatoMineBoom();
        } else if (e.kind === 'mower') {
            AudioSystem.playLawnmower();
        } else if (e.kind === 'armorBreak') {
            AudioSystem.playBucketHurt();
        } else if (e.kind === 'chomp') {
            AudioSystem.playChomper();
        } else if (e.kind === 'dig') {
            AudioSystem.playPlantDig();
        }
    } else if (e.type === 'pguard') {
        // 客人自己防反成功（判定在房主端）：本机复现光环与音效，与单机一致
        dave.perfectFlash = 0.35;
        AudioSystem.playPerfectGuard();
    } else if (e.type === 'sweep') {
        // 房主扫荡战场残留物资：同一清单也入客人自己账户（双方各自入账，谁也不缺资源）；
        // 本地立即清掉对应 pickups（不等 100ms 快照，避免重复显示；最终以房主快照为准）
        state.pickups = state.pickups.filter(p => !SWEEP_KINDS[p.kind]);
        for (const it of (e.items || [])) {
            if (it.kind === 'silver' || it.kind === 'gold' || it.kind === 'gem') {
                // 货币：爆光粒子 + 逐枚飞行落袋（与 'credit'/'bagpick' 同款本地表现）
                spawnCoinBurst(it.x, it.y, it.kind);
                startCoinFly(it.x, it.y, [{ kind: it.kind, amount: it.amount }]);
            } else if ((it.kind === 'fragment' || it.kind === 'wfrag') && it.extra) {
                // 碎片：入客人本机碎片账户 + 本局收获统计 + 浮字（与 'pickup' evt 同一路径）
                creditFragment(it.kind, it.extra, it.amount || 1, it.x, it.y);
            }
        }
    }
}

// 拾取瞬间的爆光粒子（与单机 collectPickup 一致，对应货币颜色）
function spawnCoinBurst(x, y, kind) {
    if (x == null || y == null) return;
    const color = kind === 'gold' ? '#FFD700' : kind === 'gem' ? '#66FFFF' : '#C0C0FF';
    const seeds = [];
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
        seeds.push({ dx: Math.cos(a), dy: Math.sin(a) });
    }
    state.effects.push({ kind: 'coinburst', x, y, color, seeds, life: 0.4, maxLife: 0.4, _local: true });
}

// 客人端本地阳光拾取特效（房主端 sunfly 目标是其本机 HUD 坐标，不同步；
// 由 evt 在客人本地即时生成，避免等 100ms 同步导致"阳光直接消失"）
function spawnLocalSunEffects(x, y, value) {
    if (x == null || y == null) return;
    const canvas = document.getElementById('game');
    if (!canvas) return;
    const sunEl = document.getElementById('sun-display');
    const cr = canvas.getBoundingClientRect();
    const sr = sunEl ? sunEl.getBoundingClientRect() : { left: 120, top: 35, width: 0, height: 0 };
    const tx = (sr.left + sr.width / 2 - cr.left) * (canvas.width / cr.width);
    const ty = (sr.top + sr.height / 2 - cr.top) * (canvas.height / cr.height);
    const label = `+${value || 25}`;
    state.effects.push({ kind: 'sunfly', x, y, tx, ty, life: 0.4, maxLife: 0.4, label, _local: true });
    state.effects.push({ kind: 'sunpop', x: tx + 16, y: ty - 8, life: 0.6, maxLife: 0.6, label, _local: true });
}

function mpGameLoop(now, level, onEnd) {
    if (!gameRunning) return;

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    setLastTime(now);

    // 准备种植阶段：两端各自播放三拍（由同一条 start 消息触发，天然同步），期间不推进游戏
    if (state._preLaunch) {
        state._preLaunchTimer -= dt;
        state._preLaunchT = (state._preLaunchT || 0) + dt;
        if (state._preLaunchTimer <= 0) {
            state._preLaunch = false;
            state._postLaunch = 0.8;
            AudioSystem.startBGM();
            log('开始！');
        }
    } else {
        // 胜利/失败后仍要推进：拾取阶段（钱袋/卡片）、结算转场、失败定格
        // 由 update 函数内部按 gameOver/victory 分流，不能在这里整体跳过
        if (mpRole === 'host') {
            updateMpHostGame(dt, level);
        } else {
            updateMpGuestGame(dt);
        }
    }

    // 开局提示淡出计时（与单机一致）
    if (state._postLaunch > 0) state._postLaunch -= dt;

    // 结算页打开时隐藏局内顶栏（与单机一致）
    document.getElementById('top-bar')?.classList.toggle('hidden', !!state._showReward);

    render(DIFFICULTY);
    updateHUD();
    setRafId(requestAnimationFrame((t) => mpGameLoop(t, level, onEnd)));
}

// ============================================================
// 房主游戏更新（权威模拟）
// ============================================================
function updateMpHostGame(dt, level) {
    if (state.gameOver) {
        if (!state.victory) return;
        // 胜利：先拾取（卡片/钱袋），全部落袋后进结算页；全程游戏继续运转
        if (state._showReward) {
            AudioSystem.updateAudio(dt);
            updateMpRewardAnim(dt);
        } else {
            updateMpCollectPhase(dt);
        }
        return;
    }

    AudioSystem.updateAudio(dt);
    state.time += dt;

    // 特效寿命衰减（与单机一致；否则击杀铭牌等特效永久残留并同步给客人）
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }

    // 更新房主玩家
    updatePlayer(dave, dt, FIELD);

    // 换弹推进 / 弓箭蓄力计时（与单机一致）
    updateReload(dave, dt);
    if (dave.charging) {
        const wd = WEAPONS[dave.currentWeapon];
        dave.chargeT = Math.min(wd?.maxCharge || 1, (dave.chargeT || 0) + dt);
    }

    // 全自动武器：按住左键持续开火（与单机一致）
    if (state.mouseDown && !dave.charging && !dave.reloading) {
        const wkey = dave.equippedWeapon || dave.currentWeapon || 'fist';
        const w = WEAPONS[wkey];
        if (w && w.kind === 'ranged' && w.modes?.includes('auto') && dave.fireMode === 'auto'
            && dave.weaponCooldown <= 0) {
            hostFire();
        }
    }

    // 远端玩家（客人）：只更新计时器，位置插值到上报坐标——不再跑本地键盘物理，消除拉扯抽搐
    finishPlayerTimers(dave2, dt);
    if (dave2._tx != null) {
        const k = Math.min(1, dt * 12);
        dave2.x += (dave2._tx - dave2.x) * k;
        dave2.y += (dave2._ty - dave2.y) * k;
        dave2.jumpOffset += ((dave2._tj || 0) - dave2.jumpOffset) * Math.min(1, dt * 16);
    }
    updateRemoteDashFx(dave2, dt);

    // 更新植物（统计本帧豌豆发射/向日葵产光，广播给客人播音效，与单人一致）
    const _peasBefore = state.bullets.length;
    const _sunsBefore = state.suns.length;
    updatePlants(dt, DIFFICULTY, (lv) => WEAPON_LEVEL_MUL[Math.max(1, Math.min(lv, 5))]);
    const _peasFired = state.bullets.length - _peasBefore;
    if (_peasFired > 0) Net.mp.send('evt', { type: 'pea', n: _peasFired });
    if (state.suns.length > _sunsBefore) Net.mp.send('evt', { type: 'sunspawn' });

    // 更新子弹
    updateBullets(dt);

    // 更新僵尸
    const zResult = updateZombies(dt, DIFFICULTY, DROP_TABLE,
        ZOMBIE_FRAG_WEIGHTS, WEAPON_FRAG_WEIGHTS, META, saveFragments, saveWeaponFrags);
    if (zResult.gameOver) {
        endMultiplayerGame(false);
        return;
    }
    if (zResult.victory) {
        mpBeginVictory(level);
        return;
    }

    // 更新阳光和拾取（两名玩家均可走近拾取，阳光全局共享；
    // 资源共享：账户绑定掉落不管谁捡双方账户都入账——房主端逐枚飞行入账 + 发 'credit' 让客人也入账）
    updateSunsAndPickups(dt, dave, FIELD, state, (type, amount, picker, x, y) => {
        startCoinFly(x, y, [{ kind: type, amount }]);
        Net.mp.send('evt', { type: 'credit', kind: type, amount, x, y });
    }, dave2, (e) => {
        // 资源共享：客人捡到的碎片，collectPickup 在房主端按"归客人"跳过入账，
        // 这里补房主端入档（客人端收到 evt 后自己入账，见 handleMpEvent 'pickup'）
        if (e && e.type === 'pickup' && e.p2 && (e.kind === 'fragment' || e.kind === 'wfrag') && e.extra) {
            creditFragment(e.kind, e.extra, e.amount || 1, e.x, e.y);
        }
        Net.mp.send('evt', e);
    });

    // 战斗中僵尸掉落钱币的飞行推进（落袋入账）
    if (state._coinFly) updateCoinFly(dt, true);

    updateMpCooldowns(dt);

    // 波次计时器
    if (state.waveTimer > 0) state.waveTimer -= dt;
    if (state.spawnTimer > 0) state.spawnTimer -= dt;

    updateMpWaves(dt, level);

    if (checkPlayerDamage(dave, dt)) {
        endMultiplayerGame(false);
        return;
    }
    // 客人同样正常受伤（房主权威判定），任一玩家倒下即失败
    // 防反判定只在本端权威执行：检测 perfectFlash 上升沿，通知客人端复现光环与音效
    const _pfBefore = dave2.perfectFlash || 0;
    if (checkPlayerDamage(dave2, dt)) {
        endMultiplayerGame(false);
        return;
    }
    if ((dave2.perfectFlash || 0) > _pfBefore) Net.mp.send('evt', { type: 'pguard' });

    // 瞬时音效事件 diff：画面特效随快照同步，音效走事件即时到达（与单机同款）
    // _mpSent 仅作本帧去重标记，不进快照白名单，不会泄露给客人
    for (const fx of state.effects) {
        if (fx._mpSent || fx._local) continue;
        let fevt = null;
        if (fx.kind === 'boom') fevt = { type: 'fx', kind: 'boom', radius: fx.radius }; // 樱桃/土豆雷爆炸
        else if (fx.kind === 'mower') fevt = { type: 'fx', kind: 'mower' }; // 小推车启动
        else if (fx.kind === 'armorBreak') fevt = { type: 'fx', kind: 'armorBreak' }; // 僵尸/玩家防具破碎
        else if (fx.kind === 'hit' && fx.label === '吞') fevt = { type: 'fx', kind: 'chomp' }; // 大嘴花吞噬
        else if (fx.kind === 'pickup' && typeof fx.label === 'string' && fx.label[0] === '+') fevt = { type: 'fx', kind: 'dig' }; // 铲植物返还阳光
        if (fevt) { fx._mpSent = true; Net.mp.send('evt', fevt); }
    }
}

// ============================================================
// 客人游戏更新（纯渲染，依靠主机同步）
// ============================================================
function updateMpGuestGame(dt) {
    if (state.gameOver) {
        if (!state.victory) return;
        // 胜利：拾取阶段本地可移动看动画；结算页推进转场，钱币各自入账
        if (state._showReward) {
            AudioSystem.updateAudio(dt);
            updateMpRewardAnim(dt);
        } else {
            updateMpGuestCollectPhase(dt);
        }
        return;
    }

    AudioSystem.updateAudio(dt);
    state.time += dt;

    // 本地钱币飞行推进（自己拾取的货币逐枚落袋入账）
    if (state._coinFly) updateCoinFly(dt, true);

    // 本地玩家输入处理
    updatePlayer(dave, dt, FIELD);

    // 换弹推进 / 弓箭蓄力计时（与单机一致）
    updateReload(dave, dt);
    if (dave.charging) {
        const wd = WEAPONS[dave.currentWeapon];
        dave.chargeT = Math.min(wd?.maxCharge || 1, (dave.chargeT || 0) + dt);
    }

    // 全自动武器：按住左键持续开火（与单机一致；本地乐观开火 + 事件上报房主）
    if (state.mouseDown && !dave.charging && !dave.reloading) {
        const wkey = dave.equippedWeapon || dave.currentWeapon || 'fist';
        const w = WEAPONS[wkey];
        if (w && w.kind === 'ranged' && w.modes?.includes('auto') && dave.fireMode === 'auto'
            && dave.weaponCooldown <= 0) {
            guestFire();
        }
    }

    // 远端玩家（房主）：位置插值到同步坐标
    finishPlayerTimers(dave2, dt);
    if (dave2._tx != null) {
        const k = Math.min(1, dt * 12);
        dave2.x += (dave2._tx - dave2.x) * k;
        dave2.y += (dave2._ty - dave2.y) * k;
        dave2.jumpOffset += ((dave2._tj || 0) - dave2.jumpOffset) * Math.min(1, dt * 16);
    }
    updateRemoteDashFx(dave2, dt);

    // 减少冷却（会被房主同步的共享冷却覆盖校正）
    CARD_ORDER.forEach(k => {
        if (state.cooldowns[k] > 0) state.cooldowns[k] -= dt;
    });

    // 子弹本地外推（快照只做纠偏，视觉上与单人一致）
    for (const b of state.bullets) {
        b.x += (b.vx || 0) * dt;
        b.y += (b.vy || 0) * dt;
    }

    // 僵尸本地外推（非啃咬/非眩晕状态向左移动）
    for (const z of state.zombies) {
        if (!z.eating && !z._stunned) z.x -= (z.speed || 0) * dt;
    }

    // 阳光下落/拾取物弹跳补间（不含拾取判定，判定在房主端）
    for (const s of state.suns) {
        if (s.y < s.targetY) {
            s.y += s.vy * dt;
            if (s.y > s.targetY) s.y = s.targetY;
        }
    }
    for (const p of state.pickups) {
        p.y += (p.vy || 0) * dt;
        p.vy = (p.vy || 0) + 240 * dt;
        if (p.vy > 0 && p.y > FIELD.bottom - 20) { p.y = FIELD.bottom - 20; p.vy = 0; }
        p.hopPhase = (p.hopPhase || 0) + dt * 3;
    }

    // 本地特效衰减（_local：阳光拾取飞行字等本端即时特效，不依赖房主同步）
    for (let i = state.effects.length - 1; i >= 0; i--) {
        const fx = state.effects[i];
        if (!fx._local) continue;
        fx.life -= dt;
        if (fx.life <= 0) state.effects.splice(i, 1);
    }

    // 渲染由 render() 处理，数据来自 host sync
}

// ============================================================
// 胜利拾取阶段（钱袋 → 钱币飞行 → 全部落袋后才结束并播放胜利音效）
// ============================================================
// 碎片入档（资源共享通用：与 spawner.collectPickup 的碎片路径一致——
// 本机账户 + 本局收获统计 + 浮字音效；房主/客人端都调用，各自入各自账户）
function creditFragment(kind, extra, amount, x, y) {
    const isW = kind === 'wfrag';
    const pool = isW ? META.weaponFrags : META.fragments;
    pool[extra] = (pool[extra] || 0) + amount;
    if (isW) saveWeaponFrags(META.weaponFrags); else saveFragments(META.fragments);
    if (state.roundRewards) {
        const key = isW ? 'wfrags' : 'fragments';
        state.roundRewards[key] = state.roundRewards[key] || {};
        state.roundRewards[key][extra] = (state.roundRewards[key][extra] || 0) + amount;
    }
    const nm = isW ? (WEAPONS[extra] ? WEAPONS[extra].name : '武器')
                   : (PLANTS[extra] ? PLANTS[extra].name : '植物');
    state.effects.push({ kind: 'pickup', x, y, life: 0.8, maxLife: 0.8, label: `${nm}碎片×${amount}`, _local: true });
    AudioSystem.playClick();
}

// 扫荡白名单：账户绑定（能带出局）的掉落物；药/护甲/即用卡是局内道具，不扫；
// 阳光是局内资源且本就不在 pickups 里，无需处理
const SWEEP_KINDS = { silver: 1, gold: 1, gem: 1, fragment: 1, wfrag: 1 };

// 胜利扫荡：捡钱袋/卡片同一时刻，把场上残留的账户绑定掉落物全部自动拾取。
// 房主权威：按"如同房主亲自拾取"的路径逐项入账（货币逐枚飞行、碎片直接入档），
// 并发 'sweep' evt 让客人把同一清单也入客人自己账户（双方各自入账，谁也不缺资源）
function sweepRemainingLoot() {
    if (state._lootSwept) return;   // 钱袋/卡片两个分支共用守卫：每局只扫一次
    state._lootSwept = true;
    const items = [];
    state.pickups = state.pickups.filter(p => {
        if (!SWEEP_KINDS[p.kind]) return true;   // 局内道具留在场上，随本局结束消失
        items.push({ kind: p.kind, amount: p.amount, extra: p.extra, x: p.x, y: p.y });
        return false;
    });
    if (!items.length) return;   // 无残留：不发 evt、无额外表现
    for (const it of items) {
        if (it.kind === 'silver' || it.kind === 'gold' || it.kind === 'gem') {
            // 货币：与走近拾取一致的爆光粒子 + 逐枚飞行落袋入账
            spawnCoinBurst(it.x, it.y, it.kind);
            startCoinFly(it.x, it.y, [{ kind: it.kind, amount: it.amount }]);
        } else if ((it.kind === 'fragment' || it.kind === 'wfrag') && it.extra) {
            creditFragment(it.kind, it.extra, it.amount || 1, it.x, it.y);
        }
    }
    log(`扫荡战场残留物资 ×${items.length}`);
    Net.mp.send('evt', { type: 'sweep', items });
}

function updateMpCollectPhase(dt) {
    AudioSystem.updateAudio(dt);
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }
    updatePlayer(dave, dt, FIELD);
    finishPlayerTimers(dave2, dt);
    if (dave2._tx != null) {
        const k = Math.min(1, dt * 12);
        dave2.x += (dave2._tx - dave2.x) * k;
        dave2.y += (dave2._ty - dave2.y) * k;
        dave2.jumpOffset += ((dave2._tj || 0) - dave2.jumpOffset) * Math.min(1, dt * 16);
    }
    updateRemoteDashFx(dave2, dt);

    // 新植物卡片（首通奖励）：任一玩家走近即拾取，双方各自解锁入档
    if (state._rewardCard) {
        state._rewardCard.t += dt;
        const c = state._rewardCard;
        const nearC = (p) => Math.hypot(p.x - c.x, (p.y - p.jumpOffset) - c.y) < 42;
        if (nearC(dave) || nearC(dave2)) {
            const plant = c.plant;
            state._rewardCard = null;
            sweepRemainingLoot();   // 捡卡片同一时刻扫荡场上残留账户绑定物资
            mpUnlockReward(plant);
            Net.mp.send('evt', { type: 'cardpick', plant });
            mpShowRewardScreen(plant);
        }
    }

    // 钱袋：任一玩家走近即拾取，奖励双方共享（各自账户各自入账）
    if (state._rewardBag) {
        state._rewardBag.t += dt;
        const b = state._rewardBag;
        const near = (p) => Math.hypot(p.x - b.x, (p.y - p.jumpOffset) - b.y) < 42;
        if (near(dave) || near(dave2)) {
            const loot = state._rewardBag.loot;
            state._rewardBag = null;
            state._bagFlow = true; // 钱袋流程：飞完才弹结算
            sweepRemainingLoot();   // 捡钱袋同一时刻扫荡场上残留账户绑定物资
            spawnCoinBurst(b.x, b.y, 'gold');
            startCoinFly(b.x, b.y, loot);
            Net.mp.send('evt', { type: 'bagpick', x: b.x, y: b.y, loot });
        }
    }

    // 钱币全部落袋 → 弹出结算页（此时才播放胜利音效）
    if (state._coinFly && updateCoinFly(dt, true) && state._bagFlow) {
        mpShowRewardScreen(null);
    }
}

function updateMpGuestCollectPhase(dt) {
    AudioSystem.updateAudio(dt);
    updatePlayer(dave, dt, FIELD);
    finishPlayerTimers(dave2, dt);
    if (dave2._tx != null) {
        const k = Math.min(1, dt * 12);
        dave2.x += (dave2._tx - dave2.x) * k;
        dave2.y += (dave2._ty - dave2.y) * k;
        dave2.jumpOffset += ((dave2._tj || 0) - dave2.jumpOffset) * Math.min(1, dt * 16);
    }
    updateRemoteDashFx(dave2, dt);
    // 本地特效衰减（含钱币飞行）
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }
    if (state._rewardBag) state._rewardBag.t += dt;
    if (state._rewardCard) state._rewardCard.t += dt;
    // 钱袋流程：本地钱币全部落袋后弹出结算页（各自账户各自入账）
    if (state._coinFly && updateCoinFly(dt, true) && state._bagFlow) {
        mpShowRewardScreen(null);
    }
}

// ============================================================
// 远端玩家闪现残影（与单人一致：位置由插值驱动，本地补 dash 计时/残影/音效）
// ============================================================
function updateRemoteDashFx(p, dt) {
    if (!p.dashGhosts) p.dashGhosts = [];
    // 远端玩家的冷却计时（finishPlayerTimers 不含这几项，不补会导致远端只能闪现一次）
    if (p.dashCooldown > 0) p.dashCooldown -= dt;
    if (p.guardCooldown > 0) p.guardCooldown -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    // 完美格挡光环衰减（两端远端玩家都靠这里；否则防反触发的光环永驻不消）
    if (p.perfectFlash > 0) p.perfectFlash -= dt;
    if (p.dashing) {
        if (!p._dashFxOn) { p._dashFxOn = true; AudioSystem.playDash(); }
        p.dashTimer -= dt;
        if (p.dashTimer <= 0) p.dashing = false;
        p.dashGhosts.push({ x: p.x, y: p.y - p.jumpOffset, alpha: 0.55 });
        if (p.dashGhosts.length > 6) p.dashGhosts.shift();
    } else {
        p._dashFxOn = false;
    }
    if (p.dashGhosts.length) {
        for (const g of p.dashGhosts) g.alpha -= dt * 3;
        p.dashGhosts = p.dashGhosts.filter(g => g.alpha > 0);
    }
}

// ============================================================
// 同步函数
// ============================================================
function sendSync() {
    if (!Net.mp.isConnected()) return;

    const zombies = state.zombies.map(z => ({
        id: z._id, kind: z.kind, x: z.x, y: z.y, row: z.row,
        hp: z.hp, maxHp: z.maxHp, speed: z.speed, eating: !!z.eating,
        hurtFlash: z.hurtFlash, stunned: !!z._stunned,
        armorHp: z.armorHp || 0, maxArmorHp: z.maxArmorHp || 0,
        armorBroken: !!z.armorBroken, slowed: !!z._slowed,
    }));

    const plants = state.plants.map(p => ({
        kind: p.kind, x: p.x, y: p.y, row: p.row,
        hp: p.hp, maxHp: p.maxHp, lv: p.lv, shake: p.shake,
        armorHp: p.armorHp || 0, maxArmorHp: p.maxArmorHp || 0,
        owner: p.owner,
    }));

    const bullets = state.bullets.map(b => ({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, row: b.row,
        friendly: b.friendly, enemy: b.enemy, damage: b.damage,
        color: b.color, label: b.label, life: b.life,
    }));

    const suns = state.suns.map(s => ({
        x: s.x, y: s.y, vy: s.vy, targetY: s.targetY, value: s.value, life: s.life,
    }));

    const pickups = state.pickups.map(p => ({
        kind: p.kind, x: p.x, y: p.y, amount: p.amount, extra: p.extra,
        vy: p.vy, life: p.life, hopPhase: p.hopPhase || 0,
    }));

    // sunfly/sunpop 目标是本机 HUD 坐标，不同步；_local 特效（钱币飞行/爆光）各自本地生成，不同步；
    // muzzle 走 'atk' 事件即时复现（0.12s 寿命等不起 100ms 快照），快照不再携带
    const effects = state.effects.filter(e => !e._local && e.kind !== 'sunfly' && e.kind !== 'sunpop' && e.kind !== 'muzzle').map(e => ({
        kind: e.kind, x: e.x, y: e.y, life: e.life, maxLife: e.maxLife,
        radius: e.radius, label: e.label, tx: e.tx, ty: e.ty,
        angle: e.angle, color: e.color, ghosts: e.ghosts,
    }));

    Net.mp.send('sync', {
        hostPlayer: {
            x: dave.x, y: dave.y, jumpOffset: dave.jumpOffset,
            hp: dave.hp, facing: dave.facing, facingAngle: dave.facingAngle,
            guarding: dave.guarding, dashing: dave.dashing,
            guardTimer: dave.guardTimer || 0, guardFacing: dave.guardFacing || 0,
            swingTimer: dave.swingTimer, swingDir: dave.swingDir, swingWeapon: dave.swingWeapon,
            stamina: dave.stamina, exhausted: !!dave.exhausted,
            currentWeapon: dave.currentWeapon, recoil: dave.recoil,
            charging: !!dave.charging, chargeT: dave.chargeT || 0,
            hurtFlash: dave.hurtFlash || 0, perfectFlash: dave.perfectFlash || 0,
            armor: dave.armor ? { type: dave.armor.type, name: dave.armor.name, hp: dave.armor.hp, maxHp: dave.armor.maxHp } : null,
        },
        guestPlayer: {
            x: dave2.x, y: dave2.y, jumpOffset: dave2.jumpOffset,
            hp: dave2.hp, facing: dave2.facing,
            stamina: dave2.stamina, exhausted: !!dave2.exhausted,
            guarding: dave2.guarding, dashing: dave2.dashing,
            currentWeapon: dave2.currentWeapon,
            hurtFlash: dave2.hurtFlash || 0,
            armor: dave2.armor ? { type: dave2.armor.type, name: dave2.armor.name, hp: dave2.armor.hp, maxHp: dave2.armor.maxHp } : null,
        },
        zombies, plants, bullets, suns, pickups, effects,
        sun: state.sun, wave: state.wave, maxWave: state.maxWave,
        cooldowns: { ...state.cooldowns },
        mowers: state.mowers,
        killedTotal: state.killedTotal, waveActive: state.waveActive,
        waveTimer: state.waveTimer,
        totalKills: computeTotalKills(state, DIFFICULTY),
        rewardBag: state._rewardBag ? { x: state._rewardBag.x, y: state._rewardBag.y } : null,
        rewardCard: state._rewardCard ? { x: state._rewardCard.x, y: state._rewardCard.y, plant: state._rewardCard.plant } : null,
        nextLevelId: state._rewardNextLevel ? state._rewardNextLevel.id : null,
        gameOver: state.gameOver, victory: state.victory,
        hostName: state.mp.hostName, guestName: state.mp.guestName,
        time: state.time,
    });
}

function sendInput() {
    if (!Net.mp.isConnected()) return;

    const input = {
        keys: { ...keys },
        mouse: { x: mouse.x, y: mouse.y, inside: mouse.inside },
        x: dave.x, y: dave.y, jumpOffset: dave.jumpOffset,
        hp: dave.hp,
        stamina: dave.stamina, exhausted: !!dave.exhausted,
        name: state.mp.guestName,
        currentWeapon: dave.currentWeapon, // X 切枪后镜像给房主端展示
        loadout: [dave.equippedMelee, dave.equippedRanged, dave.currentWeapon, 'fist']
            .filter((key, i, arr) => key && WEAPONS[key] && arr.indexOf(key) === i),
        charging: !!dave.charging, chargeT: dave.chargeT || 0, // 弓箭蓄力镜像（远端头顶蓄力条）
        // 格挡盾弧镜像：guarding/guardTimer/guardFacing 以客人本机为准（远端盾弧方向与完美窗口颜色）
        guarding: !!dave.guarding, guardTimer: dave.guardTimer || 0, guardFacing: dave.guardFacing || 0,
    };

    // 发送输入，让主机处理
    const events = [];
    if (state._mpPlantEvent) {
        events.push({ type: 'plant', kind: state._mpPlantEvent.kind, x: state._mpPlantEvent.x, row: state._mpPlantEvent.row, y: state._mpPlantEvent.y });
        state._mpPlantEvent = null;
    }
    if (state._mpAttackEvent) {
        events.push({ type: 'attack', angle: state._mpAttackEvent.angle, wkey: state._mpAttackEvent.wkey,
            mode: state._mpAttackEvent.mode, charge: state._mpAttackEvent.charge, aim: state._mpAttackEvent.aim });
        state._mpAttackEvent = null;
    }
    if (state._mpNextWaveEvent) {
        events.push({ type: 'nextwave' });
        state._mpNextWaveEvent = null;
    }

    input.events = events;
    Net.mp.send('input', input);
}

// ============================================================
// 消息处理
// ============================================================
function handleGuestInput(data) {
    if (!data) return;

    // 首包锁定本局客人负载；P2P 无法证明解锁状态，但可防止中途任意切换武器。
    if (!dave2._allowedWeapons && Array.isArray(data.loadout)) {
        dave2._allowedWeapons = [...new Set(data.loadout.filter(key => typeof key === 'string' && WEAPONS[key]))].slice(0, 4);
        if (!dave2._allowedWeapons.includes('fist')) dave2._allowedWeapons.push('fist');
    }
    const allowedWeapons = dave2._allowedWeapons || ['fist'];

    // 只接受有限、场内且单包位移合理的位置，避免客人直接瞬移或注入 NaN。
    const rawX = Number(data.x), rawY = Number(data.y);
    if (Number.isFinite(rawX) && Number.isFinite(rawY)) {
        let tx = Math.max(FIELD.left, Math.min(FIELD.right, rawX));
        let ty = Math.max(FIELD.top, Math.min(FIELD.bottom, rawY));
        const dx = tx - dave2.x, dy = ty - dave2.y;
        const dist = Math.hypot(dx, dy);
        const maxStep = dave2.dashing ? 55 : 28;
        if (dave2._tx != null && dist > maxStep) {
            tx = dave2.x + dx / dist * maxStep;
            ty = dave2.y + dy / dist * maxStep;
        }
        if (dave2._tx == null) {
            dave2.x = tx;
            dave2.y = ty;
        }
        dave2._tx = tx;
        dave2._ty = ty;
    }
    const jumpOffset = Number(data.jumpOffset);
    dave2._tj = Number.isFinite(jumpOffset) ? Math.max(0, Math.min(80, jumpOffset)) : 0;
    // 注意：客人 HP 由房主权威判定（checkPlayerDamage），不接受客人上报
    if (typeof data.name === 'string') {
        state.mp.guestName = data.name.slice(0, 12);
        dave2.label = state.mp.guestName;
    }
    if (allowedWeapons.includes(data.currentWeapon)) dave2.currentWeapon = data.currentWeapon;
    dave2.charging = !!data.charging && dave2.currentWeapon === 'bow';
    const chargeT = Number(data.chargeT);
    dave2.chargeT = Number.isFinite(chargeT) ? Math.max(0, Math.min(1, chargeT)) : 0;
    // 体力、力竭、格挡计时均由房主按按键推进，不接受客人直接覆盖。
    const mouseX = Number(data.mouse?.x), mouseY = Number(data.mouse?.y);
    if (Number.isFinite(mouseX) && Number.isFinite(mouseY)) {
        dave2.guardFacing = Math.atan2(mouseY - (dave2.y - dave2.jumpOffset), mouseX - dave2.x);
    }

    // 处理事件
    if (Array.isArray(data.events)) {
        for (const evt of data.events.slice(0, 8)) {
            if (evt.type === 'nextwave') {
                // 客人申请手动召唤下一波（房主权威执行并广播）
                callMpNextWave(true);
            } else if (evt.type === 'attack') {
                const wkey = allowedWeapons.includes(evt.wkey) ? evt.wkey : dave2.currentWeapon;
                if (!wkey || !WEAPONS[wkey] || wkey !== dave2.currentWeapon) continue;
                const angle = Number(evt.angle);
                if (!Number.isFinite(angle)) continue;
                const stCost = (WEAPONS[wkey] || {}).stamina || 0;
                if (dave2.weaponCooldown <= 0 && (dave2.stamina || 0) >= stCost) {
                    dave2.stamina = Math.max(0, (dave2.stamina || 0) - stCost);
                    dave2._stamDelay = 0.8;
                    const w = WEAPONS[wkey] || WEAPONS.dagger;
                    const requestedCharge = Number(evt.charge);
                    const gCharge = w.chargeable && Number.isFinite(requestedCharge)
                        ? Math.max(0.4, Math.min(1.5, requestedCharge)) : 1;
                    if (w.kind === 'ranged') {
                        // 弓箭蓄力与狙击开镜随事件回放（与单机一致的伤害/弹速/散射）
                        const gSpdMul = w.chargeable ? (0.7 + 0.5 * gCharge) : 1;
                        const pellets = w.pellets || 1;
                        for (let i = 0; i < pellets; i++) {
                            const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5);
                            const a = angle + t * (w.spread || 0) * (evt.aim ? (w.aimFactor ?? 0.35) : 1);
                            state.bullets.push({
                                x: dave2.x + Math.cos(a) * 22,
                                y: dave2.y + Math.sin(a) * 22,
                                vx: Math.cos(a) * w.bulletSpeed * gSpdMul,
                                vy: Math.sin(a) * w.bulletSpeed * gSpdMul,
                                friendly: true, damage: Math.round(w.damage * gCharge),
                                color: w.color, label: w.bulletLabel || '·', life: 1.2,
                                range: w.range || 9999, penArmor: w.penArmor || 1, pierce: w.pierce || 0, pierced: 0, spin: !!w.spin, traveled: 0,
                                speed: w.bulletSpeed * gSpdMul,
                                owner: 'guest',
                            });
                        }
                    } else {
                        // 铲子优先挖植物（与单机一致：附近无僵尸时铲除植物返还阳光）
                        if (w.canDigPlant) {
                            const cx = dave2.x + Math.cos(angle) * (w.reach || 40) * 0.5;
                            const cy = dave2.y + Math.sin(angle) * (w.reach || 40) * 0.5;
                            const zombieNear = state.zombies.find(z => Math.hypot(z.x - cx, z.y - cy) < (w.reach || 40));
                            if (!zombieNear) {
                                const plant = findPlantNear(cx, cy, w.reach || 40);
                                if (plant) {
                                    digPlant(plant);
                                    dave2.weaponCooldown = w.fireInterval;
                                    dave2.swingTimer = 0.22;
                                    dave2.swingDir = angle;
                                    dave2.swingWeapon = wkey;
                                    AudioSystem.playWeaponSwing(wkey);
                                    continue;
                                }
                            }
                        }
                        const dmg = w.damage;
                        for (const z of state.zombies) {
                            const dx = z.x - dave2.x;
                            const dy = z.y - dave2.y;
                            const dist = Math.hypot(dx, dy);
                            if (dist > (w.reach || 40)) continue;
                            const zAngle = Math.atan2(dy, dx);
                            let delta = zAngle - angle;
                            while (delta > Math.PI) delta -= Math.PI * 2;
                            while (delta < -Math.PI) delta += Math.PI * 2;
                            if (Math.abs(delta) <= (w.arc || Math.PI) / 2) {
                                applyDamageToZombie(z, dmg, w.penArmor || 1);
                                z.hurtFlash = 0.12;
                                z._lastHitBy = 'guest';
                                state.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.15, maxLife: 0.15 });
                            }
                        }
                    }
                    // 按客人上报的射击模式限速（全自动用专属射速，与单机一致）
                    const mode = w.modes?.includes(evt.mode) ? evt.mode : (w.defaultMode || w.modes?.[0]);
                    const giv = (mode === 'auto' && w.autoInterval) ? w.autoInterval : w.fireInterval;
                    dave2.weaponCooldown = giv;
                    if (w.kind === 'melee') {
                        dave2.swingTimer = 0.22;
                        dave2.swingDir = angle;
                        dave2.swingWeapon = wkey;
                        AudioSystem.playWeaponSwing(wkey);
                    } else {
                        if (wkey === 'bow') AudioSystem.playBowFire();
                        else AudioSystem.playWeaponShot(wkey, giv);
                        state.effects.push({
                            kind: 'muzzle',
                            x: dave2.x + Math.cos(angle) * 26,
                            y: (dave2.y - dave2.jumpOffset) + Math.sin(angle) * 26,
                            angle, color: w.color,
                            label: { pistol: '砰', smg: '砰', rifle: '砰', shotgun: '轰', sniper: '轰', bow: '嗖', knife: '嗖' }[wkey] || '砰',
                            ghosts: (wkey === 'shotgun' || wkey === 'sniper') ? 2 : 1,
                            life: 0.12, maxLife: 0.12,
                        });
                    }
                }
            } else if (evt.type === 'plant') {
                const def = PLANTS[evt.kind];
                if (!def) continue;
                // 与单机一致的种植校验：共享冷却、共享阳光、间距、行限制
                if (!state._allowedCards.includes(evt.kind)) continue;
                if ((state.cooldowns[evt.kind] || 0) > 0) continue;
                if (state.sun < def.cost) continue;
                if (!FIELD.activeRows.includes(evt.row)) continue;
                const plantX = Number(evt.x), plantY = Number(evt.y);
                if (!Number.isFinite(plantX) || !Number.isFinite(plantY)) continue;
                if (plantX < FIELD.left + 20 || plantX > FIELD.right - 30) continue;
                let crowded = false;
                for (const p of state.plants) {
                    if (p.row === evt.row && Math.abs(p.x - plantX) < MIN_PLANT_DIST) { crowded = true; break; }
                }
                if (crowded) continue;

                state.sun -= def.cost;
                state.cooldowns[evt.kind] = def.cooldown;
                // Y 取客人实际站位，钳制在行范围内（与单机一致）
                const rowTop = FIELD.top + FIELD.rowHeight * evt.row;
                const rowBot = rowTop + FIELD.rowHeight;
                const py = Math.max(rowTop + 14, Math.min(rowBot - 14, plantY));
                // 植物等级倍率（与单机一致：LEVEL_TABLE 百分比加成）
                const glv = META.levels[evt.kind] || 1;
                const gmul = (LEVEL_TABLE.find(l => l.lv === glv) || {}).mul || 1;
                state.plants.push({
                    kind: evt.kind, x: plantX, row: evt.row, y: py,
                    lv: glv, mul: gmul,
                    hp: def.hp * gmul, maxHp: def.hp * gmul,
                    fireTimer: def.fireInterval ? Math.random() * 0.5 : 0,
                    produceTimer: def.produceInterval ? 7 + Math.random() * 2 : 0,
                    fuseTimer: def.fuse || 0, exploded: false, shake: 0,
                    owner: 'guest',
                });
                AudioSystem.playPlant();
                Net.mp.send('evt', { type: 'plant' });
            }
        }
    }

    // 映射按键到 dave2 状态
    if (data.keys) {
        if (data.keys['q']) startDash(dave2);
        if (data.keys['e']) startGuard(dave2);
        if (!data.keys['e']) endGuard(dave2);
    }
}

let _hostZombieIds = {};
function handleHostSync(data) {
    if (!data) return;

    state.sun = data.sun;
    state.wave = data.wave;
    state.maxWave = data.maxWave;
    state.gameOver = data.gameOver;
    state.victory = data.victory;
    state.time = data.time;
    if (data.hostName) { state.mp.hostName = data.hostName; dave2.label = data.hostName; } // 房主昵称上头顶
    if (data.guestName) state.mp.guestName = data.guestName;
    // 共享冷却 / 击杀进度 / 波次状态 / 小推车
    if (data.cooldowns) Object.assign(state.cooldowns, data.cooldowns);
    if (data.killedTotal != null) state.killedTotal = data.killedTotal;
    if (data.waveActive != null) state.waveActive = data.waveActive;
    if (data.waveTimer != null) state.waveTimer = data.waveTimer;
    if (data.mowers) state.mowers = data.mowers;
    if (data.totalKills) state._cachedTotalKills = data.totalKills;
    // 胜利钱袋同步
    state._rewardBag = data.rewardBag
        ? { x: data.rewardBag.x, y: data.rewardBag.y, t: (state._rewardBag ? state._rewardBag.t : 0) }
        : null;
    // 首通新植物卡片同步（黑边发光实体，本地只负责浮动动画与渲染）
    state._rewardCard = data.rewardCard
        ? { x: data.rewardCard.x, y: data.rewardCard.y, plant: data.rewardCard.plant, t: (state._rewardCard ? state._rewardCard.t : 0) }
        : null;
    // 结算页"下一关"按钮状态同步
    if (data.nextLevelId) state._rewardNextLevel = LEVELS.find(l => l.id === data.nextLevelId) || null;

    // 更新房主玩家（远端，改为插值目标）
    if (data.hostPlayer) {
        const hp = data.hostPlayer;
        if (dave2._tx == null) {
            dave2.x = hp.x; dave2.y = hp.y; dave2.jumpOffset = hp.jumpOffset || 0;
        }
        dave2._tx = hp.x;
        dave2._ty = hp.y;
        dave2._tj = hp.jumpOffset || 0;
        dave2.hp = hp.hp;
        dave2.facing = hp.facing;
        dave2.facingAngle = hp.facingAngle;
        dave2.guarding = hp.guarding;
        dave2.dashing = hp.dashing;
        // 格挡盾弧镜像：方向/完美窗口颜色以快照为准（远端无人递增 guardTimer）
        dave2.guardTimer = hp.guardTimer || 0;
        dave2.guardFacing = hp.guardFacing || 0;
        dave2.swingTimer = hp.swingTimer;
        dave2.swingDir = hp.swingDir;
        dave2.swingWeapon = hp.swingWeapon; // 挥击弧光渲染必需（单机 render 按 swingTimer+swingWeapon 画弧光）
        // 完美格挡光环（房主端 startGuard 判定）；上升沿补格挡音效
        const prevPerfect = dave2.perfectFlash || 0;
        dave2.perfectFlash = hp.perfectFlash || 0;
        if (dave2.perfectFlash > 0 && prevPerfect <= 0) AudioSystem.playPerfectGuard();
        if (typeof hp.stamina === 'number') dave2.stamina = hp.stamina;
        dave2.exhausted = !!hp.exhausted;
        dave2.currentWeapon = hp.currentWeapon;
        dave2.recoil = hp.recoil;
        dave2.charging = !!hp.charging; dave2.chargeT = hp.chargeT || 0; // 弓箭蓄力镜像
        dave2.hurtFlash = hp.hurtFlash || 0;
        dave2.armor = hp.armor || null;
    }

    // 客人自身 HP 与受击反馈以房主判定为准
    if (data.guestPlayer) {
        if (data.guestPlayer.hp != null) dave.hp = data.guestPlayer.hp;
        if (data.guestPlayer.hurtFlash) dave.hurtFlash = data.guestPlayer.hurtFlash;
        if ('armor' in data.guestPlayer) dave.armor = data.guestPlayer.armor || null;
    }

    // 更新僵尸
    const hostIds = {};
    let spawned = 0;
    for (const z of (data.zombies || [])) {
        hostIds[z.id] = true;
        const existing = state.zombies.find(lz => lz._id === z.id);
        if (existing) {
            existing.x = z.x; existing.y = z.y; existing.row = z.row;
            existing.hp = z.hp; existing.maxHp = z.maxHp;
            existing.hurtFlash = z.hurtFlash;
            existing._stunned = z.stunned;
            existing.speed = z.speed;
            existing.eating = z.eating ? true : null;
            existing.armorHp = z.armorHp || 0; existing.maxArmorHp = z.maxArmorHp || 0;
            existing.armorBroken = !!z.armorBroken; existing._slowed = !!z.slowed;
        } else {
            state.zombies.push({
                _id: z.id, kind: z.kind, x: z.x, y: z.y, row: z.row,
                hp: z.hp, maxHp: z.maxHp, speed: z.speed, eating: null,
                hurtFlash: z.hurtFlash || 0, _stunned: z.stunned,
                _stunTimer: z.stunned ? 1 : 0,
                armorHp: z.armorHp || 0, maxArmorHp: z.maxArmorHp || 0,
                armorBroken: !!z.armorBroken, _slowed: !!z.slowed,
            });
            // 新僵尸出现：播放出场音效（与单人一致，每次同步最多3只防爆音）
            if (spawned < 3) { spawned++; AudioSystem.playZombieSpawn(); }
        }
    }
    // 移除主机已不存在的僵尸（被击杀：播放死亡音效，与单人一致）
    let died = 0;
    state.zombies = state.zombies.filter(z => {
        if (hostIds[z._id]) return true;
        if (died < 3 && z.x > FIELD.left + 40) { died++; AudioSystem.playZombieDie(); }
        return false;
    });
    _hostZombieIds = hostIds;

    // 更新植物
    state.plants = (data.plants || []).map(p => ({
        kind: p.kind, x: p.x, y: p.y, row: p.row,
        hp: p.hp, maxHp: p.maxHp, lv: p.lv, mul: 1, shake: p.shake,
        armorHp: p.armorHp || 0, maxArmorHp: p.maxArmorHp || 0,
        owner: p.owner,
        fireTimer: 0, produceTimer: 0, fuseTimer: 0, exploded: false,
    }));

    // 更新子弹
    state.bullets = (data.bullets || []).map(b => ({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, row: b.row,
        friendly: b.friendly, enemy: b.enemy, damage: b.damage,
        color: b.color, label: b.label, life: b.life,
    }));

    // 更新阳光（本地只做下落补间，拾取由房主判定）
    const prevSuns = state.suns;
    state.suns = (data.suns || []).map(s => {
        const prev = prevSuns.find(ps => Math.abs(ps.x - s.x) < 1 && Math.abs(ps.targetY - s.targetY) < 1);
        return {
            x: s.x, y: prev && Math.abs(prev.y - s.y) < 40 ? prev.y : s.y,
            vy: s.vy, targetY: s.targetY, value: s.value, life: s.life,
        };
    });

    // 更新拾取物（货币/道具/碎片）
    state.pickups = (data.pickups || []).map(p => ({
        kind: p.kind, x: p.x, y: p.y, amount: p.amount, extra: p.extra,
        vy: p.vy, life: p.life, hopPhase: p.hopPhase || 0,
    }));

    // 更新特效（保留本端即时特效 _local，避免被 100ms 同步整体冲掉）
    const localFx = state.effects.filter(e => e._local);
    state.effects = (data.effects || []).map(e => ({
        kind: e.kind, x: e.x, y: e.y, life: e.life, maxLife: e.maxLife,
        radius: e.radius, label: e.label, tx: e.tx, ty: e.ty,
        angle: e.angle, color: e.color, ghosts: e.ghosts,
    }));
    for (const fx of localFx) state.effects.push(fx);

    // 注意：gameOver 不再由同步包直接触发结算——胜利需走完钱袋拾取流程，
    // 统一由房主的 gameEnd 消息收尾（失败时房主也会立即发 gameEnd）
}

// ============================================================
// 波次和冷却（复用单机逻辑）
// ============================================================
function updateMpCooldowns(dt) {
    CARD_ORDER.forEach(k => {
        if (state.cooldowns[k] > 0) state.cooldowns[k] -= dt;
    });
}

function updateMpWaves(dt, level) {
    // 旗帜波警告延迟中（7.2s 后出旗）
    if (state._flagWarnT > 0) {
        state._flagWarnT -= dt;
        if (state._flagWarnT <= 0) spawnMpCurrentWave(level);
        return;
    }

    // 全部波次出完 → 清场后进入联机胜利流程（首通掉卡片/重打掉钱袋）
    if (state.wave > state.maxWave) {
        if (state.zombies.length === 0 && !state.gameOver) {
            mpBeginVictory(level);
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
        // 大字公告（与单机一致）：本关第一个旗帜波 = "一大波僵尸来袭"；最终波 = "最后一波"
        let announce = null;
        if (state.wave === state.maxWave) announce = '最后一波';
        else if (state.wave === 10) announce = '一大波僵尸来袭';
        if (announce) state._announce = { text: announce, start: performance.now() };
        Net.mp.send('evt', { type: 'wave', msg: '一大波僵尸正在接近！', big: true, announce });
        spawnMpCurrentWave(level); // 旗帜音效与整波僵尸同时出现，不再延迟 7.2s
        return;
    }

    // 普通小波：保底超时推进
    if (state.waveTimer <= 0) {
        spawnMpCurrentWave(level);
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

function spawnMpCurrentWave(level) {
    startMpWave(level);
    const wasFlag = state.wave % 10 === 0;
    state.wave++;
    state._lastWaveWasFlag = wasFlag;
    state.waveTimer = nextWaveTimeout(DIFFICULTY.restMul);
}

// 手动召唤下一波（房主 T 键；客人通过 input 事件申请）
// 只有大波次（旗帜波）才能手动召唤：跳过锁波等待 / 缩短预警
function callMpNextWave(byGuest = false) {
    if (state.gameOver || state.wave > state.maxWave) return false;
    if (state.wave % 10 !== 0) { if (!byGuest) log('只有大波次（旗帜波）才能按 T 召唤'); return false; }
    if (state._flagWarnT > 0) {
        state._flagWarnT = Math.min(state._flagWarnT, 0.8);
        log('大波提前到来！');
        Net.mp.send('evt', { type: 'nextwave', msg: '大波提前到来！' });
        return true;
    }
    state._flagLockT = 45; // 跳过清场/等待，立即进入大波预警
    log(byGuest ? '好友召唤了大波！' : '召唤大波！');
    Net.mp.send('evt', { type: 'nextwave', msg: byGuest ? '好友召唤了大波！' : '房主召唤了大波！' });
    return true;
}

function startMpWave(level) {
    // 按预生成列表整波同出（与单机/原版一致）
    const comp = (state._levelSpawnList && state._levelSpawnList[state.wave - 1]) || ['normal'];
    const isFlag = (state.wave % 10 === 0);
    const isFinal = (state.wave === state.maxWave);
    state.waveActive = true;
    state.zombiesInWave = comp.length;
    state.zombiesSpawned = 0;

    let sfx = 3; // 整波同出最多播 3 声出场音
    for (const kind of comp) {
        spawnMpZombie(kind, sfx-- > 0);
    }

    let hp = 0;
    for (const z of state.zombies) hp += z.hp + (z.armorHp || 0);
    state._waveHpTotal = hp;
    state._waveEarlyRatio = 0.5 + Math.random() * 0.15;
    state._waveStartT = state.time;

    let msg;
    if (isFlag) {
        msg = `旗帜大波！共 ${comp.length} 只`;
    } else if (isFinal) {
        msg = `最后一波！共 ${comp.length} 只`;
    } else {
        msg = `第 ${state.wave} 波来袭！共 ${comp.length} 只`;
    }
    log(msg);
    // 波次警示音：旗帜波已在 7.2s 预警时播放过并同步给客人，此处不重复；
    // 仅非旗帜的最终波在出怪时播放并广播，同时弹出"最后一波"大字公告
    if (!isFlag && isFinal) {
        AudioSystem.playWaveWarning();
        state._announce = { text: '最后一波', start: performance.now() };
    }
    Net.mp.send('evt', { type: 'wave', msg, big: (!isFlag && isFinal), announce: (!isFlag && isFinal) ? '最后一波' : null });
}

let _mpZombieId = 0;
function spawnMpZombie(forceKind = null, withSound = true) {
    const kind = forceKind
        || (state._zombiePool && state._zombiePool.length
            ? state._zombiePool[Math.floor(Math.random() * state._zombiePool.length)]
            : 'normal');
    const def = ZOMBIES[kind] || ZOMBIES.normal;

    const row = FIELD.activeRows[Math.floor(Math.random() * FIELD.activeRows.length)];
    const hp = def.hp * DIFFICULTY.hpMul;
    const armorHp = (def.armorHp || 0) * DIFFICULTY.hpMul;
    const speed = def.speed * (0.9 + Math.random() * 0.2) * DIFFICULTY.speedMul; // 原版 ±10% 移速浮动
    const id = `mp_z_${_mpZombieId++}_${Date.now()}`;

    state.zombies.push({
        _id: id, kind, x: FIELD.right + 20, row,
        // 行内随机纵向位置（与单机一致，不再全部从行中心出现）
        y: FIELD.top + FIELD.rowHeight * (row + 0.5) + (Math.random() - 0.5) * FIELD.rowHeight * 0.56,
        hp, maxHp: hp,
        armorHp, maxArmorHp: armorHp, armorBroken: false,
        speed, eating: null, hurtFlash: 0,
        _stunned: false, _stunTimer: 0,
    });
    state.zombiesSpawned++;
    if (withSound) AudioSystem.playZombieSpawn();
    return { kind, id };
}

// ============================================================
// 联机胜利流程（与单机一致：掉落卡片/钱袋 → 走近拾取 → 渐白 → 结算页 → 退出房间/下一关）
// ============================================================
function mpBeginVictory(level) {
    if (state.gameOver) return;
    state.waveActive = false;
    state.gameOver = true;
    state.victory = true;
    const levelId = saveData.lastLevel;
    const isNewClear = levelId && !saveData.cleared.includes(levelId);
    const reward = isNewClear ? LEVEL_REWARDS[levelId] : null;
    const dropPos = state._lastKillPos || { x: (FIELD.left + FIELD.right) / 2, y: (FIELD.top + FIELD.bottom) / 2 };
    // 末杀可能发生在场外右侧（僵尸出生区），钳制到玩家可行走范围内，否则永远拾取不到
    dropPos.x = Math.min(Math.max(dropPos.x, FIELD.left + 40), FIELD.right - 40);
    dropPos.y = Math.min(Math.max(dropPos.y, FIELD.top + 40), FIELD.bottom - 40);
    if (reward) {
        // 首通：末杀位置掉落新植物卡片（黑边发光实体，任一玩家可拾取）
        saveData.cleared.push(levelId);
        writeSave(saveData);
        state._rewardCard = { x: dropPos.x, y: dropPos.y, plant: reward, t: 0 };
        log('战斗胜利！走过去拾取植物卡片');
    } else {
        // 重打：末杀位置掉落钱袋
        if (isNewClear) { saveData.cleared.push(levelId); writeSave(saveData); }
        state._rewardBag = { x: dropPos.x, y: dropPos.y, t: 0, loot: rollBagLoot(DIFFICULTY.rewardMul || 1) };
        log('战斗胜利！走过去拾取钱袋');
    }
    const curIdx = LEVELS.findIndex(l => l.id === levelId);
    state._rewardNextLevel = (curIdx >= 0 && curIdx < LEVELS.length - 1) ? LEVELS[curIdx + 1] : null;
}

// 解锁奖励植物/工具并入档（双方各自账户各自解锁）
function mpUnlockReward(reward) {
    if (!reward) return;
    if (reward.type === 'plant' && !saveData.unlockedPlants.includes(reward.id)) {
        saveData.unlockedPlants.push(reward.id);
    } else if (reward.type === 'tool') {
        if (!saveData.unlockedTools) saveData.unlockedTools = [];
        if (!saveData.unlockedTools.includes(reward.id)) saveData.unlockedTools.push(reward.id);
    }
    const levelId = saveData.lastLevel;
    if (levelId && !saveData.cleared.includes(levelId)) saveData.cleared.push(levelId);
    writeSave(saveData);
}

// 弹出联机结算页（plant=null 为钱袋重打结算；此时才播放胜利音效）
function mpShowRewardScreen(plant) {
    AudioSystem.fadeOutBGM(0.8);
    AudioSystem.playVictory();
    AudioSystem.startRewardMusic();
    state._showReward = true;
    state._rewardPhase = 'wipe';
    state._rewardAlpha = 0;
    state._rewardT = 0;
    state._rewardSceneT = 0;
    state._rewardPlant = plant || null;
    state._rewardParticles = Array.from({ length: 24 }, () => ({
        x: Math.random() * 960, y: Math.random() * 540,
        r: 1 + Math.random() * 2, v: 8 + Math.random() * 18, o: 0.15 + Math.random() * 0.4,
    }));
}

// 结算转场推进（与单机 updateRewardAnim 一致；本地副本避免循环依赖）
// 同时衰减特效并推进钱币飞行，防止结算页期间钱币冻在半空
const MP_REWARD_TIMING = { wipe: 0.8, reveal: 0.35, detailIn: 0.5 };
function updateMpRewardAnim(dt) {
    state._rewardT = (state._rewardT || 0) + dt;
    state._rewardSceneT = (state._rewardSceneT || 0) + dt;
    for (let i = state.effects.length - 1; i >= 0; i--) {
        state.effects[i].life -= dt;
        if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }
    if (state._coinFly) updateCoinFly(dt, true);
    if (state._rewardPhase === 'wipe') {
        state._rewardAlpha = Math.min(1, state._rewardT / MP_REWARD_TIMING.wipe);
        if (state._rewardAlpha >= 1) {
            state._rewardPhase = state._rewardPlant ? 'reveal' : 'summary';
            state._rewardT = 0;
        }
    } else if (state._rewardPhase === 'reveal') {
        state._rewardAlpha = 1;
        if (state._rewardT >= MP_REWARD_TIMING.reveal) {
            state._rewardPhase = 'detail';
            state._rewardT = 0;
            state._rewardAlpha = 0;
        }
    } else if (state._rewardPhase === 'detail' || state._rewardPhase === 'summary') {
        state._rewardAlpha = Math.min(1, (state._rewardAlpha || 0) + dt / MP_REWARD_TIMING.detailIn);
    }
}

// 结算页按钮点击（联机：左=退出房间，右=下一关仅房主可操作）
// 返回 true 表示已消费该次点击
function mpRewardClick() {
    if (!state._showReward || (state._rewardAlpha || 0) < 0.6) return false;
    if (state._rewardPhase !== 'detail' && state._rewardPhase !== 'summary') return false;
    if (mouse.y < 466 || mouse.y > 516) return false;
    if (mouse.x >= 190 && mouse.x <= 470) {
        AudioSystem.stopRewardMusic();
        stopMultiplayer();
        return true;
    }
    if (mouse.x >= 490 && mouse.x <= 770 && state._rewardNextLevel) {
        if (mpRole === 'host') {
            AudioSystem.stopRewardMusic();
            const lv = state._rewardNextLevel;
            const deck = state._allowedCards;
            Net.mp.send('evt', { type: 'nextlevel', levelId: lv.id, deck });
            restartMpGame(lv.id, deck);
        } else {
            log('等待房主选择下一关');
        }
        return true;
    }
    return false;
}

// 保留房间连接，重开新关卡（房主点"下一关"时两端各自调用）
function restartMpGame(levelId, deck) {
    if (syncInterval) clearInterval(syncInterval);
    unregisterMpEvents();
    unbindMpInputEvents();
    state._showReward = false;
    state._rewardPlant = null;
    state._bagFlow = false;
    state._coinFly = null;
    state._rewardCard = null;
    state._rewardBag = null;
    startMultiplayerGame(mpRole, deck, levelId, null);
}

// ============================================================
// 游戏结束（仅失败走这里；胜利由拾取/结算流程收尾）
// ============================================================
function endMultiplayerGame(win) {
    state.gameOver = true;
    state.victory = win;
    if (win) return; // 胜利：不踢出房间，进入拾取阶段（mpBeginVictory 已布置掉落）

    setGameRunning(false);
    if (syncInterval) clearInterval(syncInterval);
    if (mpRole === 'host') {
        Net.mp.send('gameEnd', { win });
    }
    unregisterMpEvents();
    AudioSystem.playDefeat();
    setTimeout(() => {
        stopMultiplayer();
    }, 2000);
}

export function stopMultiplayer() {
    setGameRunning(false);
    if (rafId) cancelAnimationFrame(rafId);
    if (syncInterval) clearInterval(syncInterval);
    AudioSystem.stopBGM();
    AudioSystem.stopRewardMusic();
    state._showReward = false;
    document.getElementById('top-bar')?.classList.remove('hidden');
    state.mp.active = false;
    unregisterMpEvents();
    unbindMpInputEvents();
    Net.mp.close();
    showScreen('menu');
}

// 解绑联机输入监听（重开下一关/散场时调用，避免重复绑定）
function unbindMpInputEvents() {
    window.removeEventListener('keydown', hostKeyDown);
    window.removeEventListener('keyup', hostKeyUp);
    window.removeEventListener('mouseup', hostMouseUp);
    window.removeEventListener('keydown', guestKeyDown);
    window.removeEventListener('keyup', guestKeyUp);
    window.removeEventListener('mouseup', guestMouseUp);
    state.mouseDown = false;
    const canvas = document.getElementById('game');
    if (canvas) {
        canvas.removeEventListener('mousedown', hostMouseDown);
        canvas.removeEventListener('mousemove', guestMouseMove);
        canvas.removeEventListener('mouseleave', guestMouseLeave);
        canvas.removeEventListener('mousedown', guestMouseDown);
    }
}

// ============================================================
// 输入绑定
// ============================================================
function bindHostInputEvents(level) {
    const canvas = document.getElementById('game');
    if (!canvas) return;

    window.addEventListener('keydown', hostKeyDown);
    window.addEventListener('keyup', hostKeyUp);
    window.addEventListener('mouseup', hostMouseUp);
    canvas.addEventListener('mousedown', hostMouseDown);
}

function hostKeyDown(e) {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (state._preLaunch || state.gameOver) return;
    if (k === 'q') startDash(dave);
    if (k === 'e') startGuard(dave);
    if (k === ' ') { e.preventDefault(); tryJump(dave); }
    if (k >= '1' && k <= '8') selectCard(parseInt(k) - 1);
    if (k === 't') callMpNextWave(false);
    if (k === 'v') mpToggleFireMode();
    if (k === 'x') mpSwapWeaponSlots();
    if (k === 'c') mpToggleShovelTool();
    if (k === 'r') mpTryReload();
    if (k === 'f' && state.selectedCard >= 0) {
        const key = CARD_ORDER[state.selectedCard];
        const def = PLANTS[key];
        if ((state.cooldowns[key] || 0) > 0 || state.sun < def.cost) return;
        if (dave.x < FIELD.left + 20 || dave.x > FIELD.right - 30 || dave.isJumping) return;
        if (!FIELD.activeRows.includes(dave.row)) return;
        for (const p of state.plants) {
            if (p.row === dave.row && Math.abs(p.x - dave.x) < MIN_PLANT_DIST) return;
        }
        state.sun -= def.cost;
        state.cooldowns[key] = def.cooldown;
        const rowTop = FIELD.top + FIELD.rowHeight * dave.row;
        const rowBot = rowTop + FIELD.rowHeight;
        const py = Math.max(rowTop + 14, Math.min(rowBot - 14, dave.y));
        // 植物等级倍率（与单机一致：LEVEL_TABLE 百分比加成）
        const hlv = META.levels[key] || 1;
        const hmul = (LEVEL_TABLE.find(l => l.lv === hlv) || {}).mul || 1;
        state.plants.push({
            kind: key, x: dave.x, row: dave.row, y: py,
            lv: hlv, mul: hmul, hp: def.hp * hmul, maxHp: def.hp * hmul,
            fireTimer: def.fireInterval ? Math.random() * 0.5 : 0,
            produceTimer: def.produceInterval ? 7 + Math.random() * 2 : 0,
            fuseTimer: def.fuse || 0, exploded: false, shake: 0,
            owner: 'host',
        });
        AudioSystem.playPlant();
        Net.mp.send('evt', { type: 'plant' });
    }
}

function hostKeyUp(e) {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === 'e') endGuard(dave);
}

// V：射击模式切换（与单机一致，房主/客人各自生效）
function mpToggleFireMode() {
    const w = WEAPONS[dave.currentWeapon];
    if (!w || !w.modes || w.modes.length < 2) { log('该武器不支持切换射击模式'); return; }
    dave.fireMode = dave.fireMode === 'auto' ? 'semi' : 'auto';
    log(`射击模式：${dave.fireMode === 'auto' ? '全自动' : '半自动'}`);
    AudioSystem.playClick();
}

// X：近战/远程槽切换（与单机一致，房主/客人各自生效）
function mpSwapWeaponSlots() {
    const cur = dave.currentWeapon;
    const melee = dave.equippedMelee;
    const ranged = dave.equippedRanged;
    let next = null;
    if (cur === melee) next = ranged || melee;
    else next = melee || ranged;
    if (!next || next === cur) { log('另一槽位没有武器'); return; }
    dave.currentWeapon = next;
    dave.equippedWeapon = next;
    dave.reloading = false;
    dave.charging = false;
    state.aiming = false;
    AudioSystem.stopBowCharge();
    // 切到远程武器时按其默认值重置射击模式（步枪/冲锋枪默认全自动），弹匣首次装入
    const wd = WEAPONS[next];
    if (wd?.kind === 'ranged') {
        dave.fireMode = wd.defaultMode || (wd.modes ? wd.modes[0] : 'semi');
        if (wd.magSize && dave.magAmmo == null) dave.magAmmo = wd.magSize;
    }
    log(`切换到 ${wd?.name || next}`);
    AudioSystem.playClick();
}

// C：铲子工具（与单机一致：不占武器槽，随时切出/收回）
function mpToggleShovelTool() {
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

// R：换弹（与单机一致：弹匣从备弹补充，备弹来自本人弹药库存）
function mpTryReload() {
    const r = startReload(dave);
    if (r.ok) {
        log('换弹中...');
        AudioSystem.playWeaponReload(dave.currentWeapon);
    } else if (r.msg) {
        log(r.msg);
    }
}

function hostMouseDown(e) {
    if (e.button !== 0) return;
    state.mouseDown = true; // 按住状态：全自动武器持续开火（与单机一致）
    if (mpRewardClick()) return; // 结算页按钮优先
    if (state._preLaunch || state.gameOver) return;
    // 弓箭：按住蓄力，松开才射出（与单机一致）
    const wkey = dave.equippedWeapon || dave.currentWeapon;
    const wd = WEAPONS[wkey];
    if (wd && wd.chargeable) {
        if (dave.reloading) { log('换弹中...'); return; }
        dave.charging = true;
        dave.chargeT = 0;
        if (wkey === 'bow') AudioSystem.playBowCharge(); // 播放拉弓段（前 2.1s）
        return;
    }
    hostFire();
}

function hostMouseUp(e) {
    if (e.button !== 0) return;
    state.mouseDown = false;
    if (state._preLaunch || state.gameOver) return;
    mpReleaseCharge(hostFire);
}

// 弓箭松手放箭（与单机一致：蓄力不足直接收弓，不放箭）
function mpReleaseCharge(fireFn) {
    if (!dave.charging) return;
    const wkey = dave.equippedWeapon || dave.currentWeapon;
    const wd = WEAPONS[wkey];
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
    fireFn(charge);
}

// 房主开火（点击与按住连发共用）；charge 仅弓箭蓄力用（0~1.5）
function hostFire(charge = 1) {
    if (state._preLaunch || state.gameOver) return;
    const wkey = dave.equippedWeapon || dave.currentWeapon || 'fist';
    if (dave.weaponCooldown > 0) return;
    if (dave.reloading) { log('换弹中...'); return; }

    const angle = Math.atan2(mouse.y - (dave.y - dave.jumpOffset), mouse.x - dave.x);
    const w = WEAPONS[wkey] || WEAPONS.dagger;
    // 弹匣规则（与单机一致：弹匣打空必须按 R 换弹）
    if (w.kind === 'ranged' && dave.magAmmo != null && dave.magAmmo <= 0) {
        log('弹匣已空，按 R 换弹');
        return;
    }
    const mul = wkey === dave.equippedWeapon ? (WEAPON_LEVEL_MUL[Math.max(1, Math.min(dave.equippedLevel || 1, 5))] || 1) : 1;
    const stCost = w.stamina || 0;
    if ((dave.stamina || 0) < stCost) return; // 体力不足无法出手
    dave.stamina = Math.max(0, (dave.stamina || 0) - stCost);
    dave._stamDelay = 0.8;

    if (w.kind === 'ranged') {
        // 弓箭蓄力：伤害与弹速随 charge 提升（与单机一致）
        const dmgMul = mul * charge;
        const spdMul = w.chargeable ? (0.7 + 0.5 * charge) : 1;
        const pellets = w.pellets || 1;
        for (let i = 0; i < pellets; i++) {
            const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5);
            const a = angle + t * (w.spread || 0) * (state.aiming ? (w.aimFactor ?? 0.35) : 1);
            state.bullets.push({
                x: dave.x + Math.cos(a) * 22, y: (dave.y - dave.jumpOffset) + Math.sin(a) * 22,
                vx: Math.cos(a) * w.bulletSpeed * spdMul, vy: Math.sin(a) * w.bulletSpeed * spdMul,
                friendly: true, damage: Math.round(w.damage * dmgMul),
                color: w.color, label: w.bulletLabel || '·', life: 1.2,
                range: w.range || 9999, penArmor: w.penArmor || 1, pierce: w.pierce || 0, pierced: 0, spin: !!w.spin, traveled: 0,
                speed: w.bulletSpeed * spdMul,
                owner: 'host',
            });
        }
        if (dave.magAmmo != null) dave.magAmmo = Math.max(0, dave.magAmmo - 1);
    } else {
        // 铲子优先挖植物（与单机一致：附近无僵尸时铲除植物返还阳光）
        if (w.canDigPlant) {
            const cx = dave.x + Math.cos(angle) * (w.reach || 40) * 0.5;
            const cy = (dave.y - dave.jumpOffset) + Math.sin(angle) * (w.reach || 40) * 0.5;
            const zombieNear = state.zombies.find(z => Math.hypot(z.x - cx, z.y - cy) < (w.reach || 40));
            if (!zombieNear) {
                const plant = findPlantNear(cx, cy, w.reach || 40);
                if (plant) {
                    digPlant(plant);
                    dave.weaponCooldown = w.fireInterval;
                    dave.swingTimer = 0.22;
                    dave.swingDir = angle;
                    dave.swingWeapon = wkey;
                    AudioSystem.playWeaponSwing(wkey);
                    // 广播出手瞬间：客人端即时复现挥击弧光与音效（快照只能兜底）
                    Net.mp.send('evt', { type: 'atk', w: wkey, kind: w.kind, angle, x: dave.x, y: dave.y - dave.jumpOffset });
                    return;
                }
            }
        }
        const dmg = Math.round(w.damage * mul);
        for (const z of state.zombies) {
            const dx = z.x - dave.x;
            const dy = z.y - (dave.y - dave.jumpOffset);
            const dist = Math.hypot(dx, dy);
            if (dist > (w.reach || 40)) continue;
            const zAngle = Math.atan2(dy, dx);
            let delta = zAngle - angle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            if (Math.abs(delta) <= (w.arc || Math.PI) / 2) {
                applyDamageToZombie(z, dmg, w.penArmor || 1);
                z.hurtFlash = 0.12;
                z._lastHitBy = 'host';
                state.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.15, maxLife: 0.15 });
            }
        }
    }
    // 全自动模式用专属射速（与单机一致：冲锋枪 0.1s/步枪 0.12s）
    const iv = (dave.fireMode === 'auto' && w.autoInterval) ? w.autoInterval : w.fireInterval;
    dave.weaponCooldown = iv / mul;
    if (w.kind === 'melee') {
        dave.swingTimer = 0.22;
        dave.swingDir = angle;
        dave.swingWeapon = wkey;
        AudioSystem.playWeaponSwing(wkey);
    } else {
        // 弓箭放发射段音效，其他武器走通用开火音（与单机一致）
        if (wkey === 'bow') AudioSystem.playBowFire();
        else AudioSystem.playWeaponShot(wkey, iv);
        state.effects.push({
            kind: 'muzzle',
            x: dave.x + Math.cos(angle) * 26,
            y: (dave.y - dave.jumpOffset) + Math.sin(angle) * 26,
            angle, color: w.color,
            label: { pistol: '砰', smg: '砰', rifle: '砰', shotgun: '轰', sniper: '轰', bow: '嗖', knife: '嗖' }[wkey] || '砰',
            ghosts: (wkey === 'shotgun' || wkey === 'sniper') ? 2 : 1,
            life: 0.12, maxLife: 0.12,
        });
    }
    // 广播出手瞬间：客人端即时复现挥击弧光/枪口火光与开火音效（快照只能兜底）
    Net.mp.send('evt', { type: 'atk', w: wkey, kind: w.kind, angle, x: dave.x, y: dave.y - dave.jumpOffset });
}

function bindGuestInputEvents() {
    window.addEventListener('keydown', guestKeyDown);
    window.addEventListener('keyup', guestKeyUp);
    window.addEventListener('mouseup', guestMouseUp);

    const canvas = document.getElementById('game');
    if (canvas) {
        canvas.addEventListener('mousemove', guestMouseMove);
        canvas.addEventListener('mouseleave', guestMouseLeave);
        canvas.addEventListener('mousedown', guestMouseDown);
    }
}

function guestMouseMove(e) {
    const canvas = document.getElementById('game');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (960 / rect.width);
    mouse.y = (e.clientY - rect.top) * (540 / rect.height);
    mouse.inside = true;
}

function guestMouseLeave() {
    mouse.inside = false;
}

function guestMouseDown(e) {
    if (e.button !== 0) return;
    state.mouseDown = true; // 按住状态：全自动武器持续开火（与单机一致）
    if (mpRewardClick()) return; // 结算页按钮优先
    if (state._preLaunch || state.gameOver) return;
    // 弓箭：按住蓄力，松开才射出（与单机一致）
    const wkey = dave.equippedWeapon || dave.currentWeapon;
    const wd = WEAPONS[wkey];
    if (wd && wd.chargeable) {
        if (dave.reloading) { log('换弹中...'); return; }
        dave.charging = true;
        dave.chargeT = 0;
        if (wkey === 'bow') AudioSystem.playBowCharge(); // 播放拉弓段（前 2.1s）
        return;
    }
    guestFire();
}

function guestMouseUp(e) {
    if (e.button !== 0) return;
    state.mouseDown = false;
    if (state._preLaunch || state.gameOver) return;
    mpReleaseCharge(guestFire);
}

// 客人开火（点击与按住连发共用）：本地乐观表现 + 事件上报房主权威判定；charge 仅弓箭蓄力用
function guestFire(charge = 1) {
    if (state._preLaunch || state.gameOver) return;
    if (dave.weaponCooldown > 0) return;
    if (dave.reloading) { log('换弹中...'); return; }
    const angle = Math.atan2(mouse.y - (dave.y - dave.jumpOffset), mouse.x - dave.x);
    const wkey = dave.equippedWeapon || dave.currentWeapon || 'fist';
    const w = WEAPONS[wkey] || WEAPONS.dagger;
    // 弹匣规则（与单机一致：弹匣打空必须按 R 换弹）
    if (w.kind === 'ranged' && dave.magAmmo != null && dave.magAmmo <= 0) {
        log('弹匣已空，按 R 换弹');
        return;
    }
    state._mpAttackEvent = { angle, wkey, mode: dave.fireMode, charge, aim: !!state.aiming };
    const stCost = w.stamina || 0;
    if ((dave.stamina || 0) < stCost) return; // 体力不足无法出手
    dave.stamina = Math.max(0, (dave.stamina || 0) - stCost);
    dave._stamDelay = 0.8;
    if (w.kind === 'ranged' && dave.magAmmo != null) dave.magAmmo = Math.max(0, dave.magAmmo - 1);
    if (w.kind === 'melee') {
        dave.swingTimer = 0.22;
        dave.swingDir = angle;
        dave.swingWeapon = wkey;
        AudioSystem.playWeaponSwing(wkey);
    } else {
        // 弓箭放发射段音效，其他武器音效时长与实际射速对齐
        const iv = (dave.fireMode === 'auto' && w.autoInterval) ? w.autoInterval : w.fireInterval;
        if (wkey === 'bow') AudioSystem.playBowFire();
        else AudioSystem.playWeaponShot(wkey, iv);
        state.effects.push({
            kind: 'muzzle',
            x: dave.x + Math.cos(angle) * 26,
            y: (dave.y - dave.jumpOffset) + Math.sin(angle) * 26,
            angle, color: w.color,
            label: { pistol: '砰', smg: '砰', rifle: '砰', shotgun: '轰', sniper: '轰', bow: '嗖', knife: '嗖' }[wkey] || '砰',
            ghosts: (wkey === 'shotgun' || wkey === 'sniper') ? 2 : 1,
            life: 0.12, maxLife: 0.12,
        });
    }
    // 全自动模式用专属射速（与单机一致）
    if (w.fireInterval) {
        dave.weaponCooldown = (dave.fireMode === 'auto' && w.autoInterval) ? w.autoInterval : w.fireInterval;
    }
}

function guestKeyDown(e) {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (state._preLaunch || state.gameOver) return;
    if (k === 'q') { e.preventDefault(); startDash(dave); }
    if (k === 'e') { e.preventDefault(); startGuard(dave); }
    if (k === ' ') { e.preventDefault(); tryJump(dave); }
    if (k >= '1' && k <= '8') selectCard(parseInt(k) - 1);
    if (k === 't') state._mpNextWaveEvent = true; // 申请下一波，房主权威执行
    if (k === 'v') mpToggleFireMode();
    if (k === 'x') mpSwapWeaponSlots();
    if (k === 'c') mpToggleShovelTool();
    if (k === 'r') mpTryReload();
    if (k === 'f' && state.selectedCard >= 0) {
        const key = CARD_ORDER[state.selectedCard];
        const def = PLANTS[key];
        // 本地预检（最终以房主校验为准），成功则乐观置冷却等待同步校正
        if ((state.cooldowns[key] || 0) <= 0 && state.sun >= def.cost
            && dave.x >= FIELD.left + 20 && dave.x <= FIELD.right - 30 && !dave.isJumping) {
            state._mpPlantEvent = { kind: key, x: dave.x, row: dave.row, y: dave.y };
            state.cooldowns[key] = def.cooldown;
        }
    }
}

function guestKeyUp(e) {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === 'e') endGuard(dave);
}

export default { startMultiplayerGame, stopMultiplayer };
