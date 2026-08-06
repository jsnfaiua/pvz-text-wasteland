// ============================================================
// 音频系统 - 真实音效 + 合成回退
// 优先级: BGM(0) < UI(1) < 单位(2) < 播报(3) < 爆炸(4) < BOSS(5)
// ============================================================

const PRIORITY = { BGM: 0, UI: 1, UNIT: 2, WAVE: 3, EXPLOSION: 4, BOSS: 5 };

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let ctx = null, masterGain = null, bgmGain = null, sfxGain = null;
let bgmSource = null, bgmBuffer = null;
let bgmRetryTimer = null;
// 初始音量（由设置面板在音频上下文创建前注入，0~1）
let initialBgmVolume = 0.2, initialSfxVolume = 1;
export function setInitialVolumes(bgm, sfx) {
    if (typeof bgm === 'number') initialBgmVolume = Math.max(0, Math.min(1, bgm));
    if (typeof sfx === 'number') initialSfxVolume = Math.max(0, Math.min(1, sfx));
    // 上下文已存在时立即生效
    if (bgmGain) setBGMVolume(initialBgmVolume);
    if (sfxGain) setSFXVolume(initialSfxVolume);
}
const buffers = {};
// BGM 首尾静音裁剪点（消除 mp3 编码间隙导致的循环断档）
const loopTrim = {};
const priorityLock = { level: -1, timer: 0 };

const SOUND_MAP = {
    bgmDay: 'bgmDay', bgmNight: 'bgmNight', bgmPool: 'bgmPool', bgmFog: 'bgmFog', bgmMenu: 'bgmMenu',
    bgmPicker: 'bgmPicker', bgmConveyor: 'bgmConveyor',
    plantSeed: 'plantSeed', peaShoot: 'peaShoot', snowpeaHit: 'snowpeaHit',
    chomper: 'chomper', explode: 'explode', potatoMineBoom: 'potatoMineBoom',
    zombieDie: 'zombieDie', zombieBite: 'zombieBite', zombieHurt: 'zombieHurt',
    armoredHurt: 'armoredHurt', bucketHurt: 'bucketHurt',
    zombieSpawn: 'zombieSpawn', zombieSpawn2: 'zombieSpawn2', zombieSpawn3: 'zombieSpawn3', zombieSpawn4: 'zombieSpawn4',
    poleVault: 'poleVault', lawnmower: 'lawnmower',
    pickupSun: 'pickupSun', pickupCoin: 'pickupCoin', pickupGem: 'pickupGem',
    uiClick: 'uiClick', gameStart: 'gameStart', preLaunch: 'preLaunch',
    victory: 'victory', defeat: 'defeat', waveWarning: 'waveWarning', unlockPlant: 'unlockPlant',
    plantDig: 'plantDig', gachaSpin: 'gachaSpin', bonk: 'bonk',
    squashSense: 'squashSense', squashSlam: 'squashSlam',
    bungee: 'bungee', scream: 'bungee', dancer: 'zombieDancer',
    jalapenoBoom: 'jalapenoBoom', doomShroom: 'doomShroom',
    butter: 'butter', garlic: 'garlic', cornShoot: 'armoredHurt', pause: 'pause',
    // 生存/交互扩展音效（对照表扩展项）
    playerHurt: 'playerHurt', chopTree: 'chopTree', digStone: 'digStone',
    treeFall: 'treeFall', stoneBreak: 'stoneBreak',
    openBox: 'openBox', closeBox: 'closeBox', walkGrass: 'walkGrass',
    walkL: 'walkL', walkR: 'walkR', runL: 'runL', runR: 'runR',
    // 武器音效（素材文件放入 assets/audio/ 即自动启用；缺失时回退到默认音）
    shotPistol: 'shotPistol', shotSmg: 'shotSmg', shotRifle: 'shotRifle',
    shotSniper: 'shotSniper', shotShotgun: 'shotShotgun', shotBow: 'shotBow',
    swingSword: 'swingSword',
    swingAxe: 'swingAxe', swingFist: 'swingFist',
    reloadGun: 'reloadGun', reloadShotgun: 'reloadShotgun',
};

function ensureCtx() {
    if (!ctx) {
        ctx = new AudioCtx();
        masterGain = ctx.createGain(); masterGain.gain.value = 0.8; masterGain.connect(ctx.destination);
        bgmGain = ctx.createGain(); bgmGain.gain.value = initialBgmVolume; bgmGain.connect(masterGain);
        sfxGain = ctx.createGain(); sfxGain.gain.value = initialSfxVolume; sfxGain.connect(masterGain);
        ctx.addEventListener('statechange', () => {
            if (ctx.state === 'running' && !bgmSource) retryBGM();
        });
    }
    if (ctx.state === 'suspended') ctx.resume();
}

function retryBGM() {
    const ov = document.getElementById('loading-overlay');
    if (ov && ov.style.display !== 'none') return;
    const game = document.getElementById('game-screen');
    if (!game || !game.classList.contains('hidden')) return;
    const cs = document.getElementById('card-select-screen');
    if (cs && !cs.classList.contains('hidden')) { startBGM('bgmPicker'); return; }
    startBGM('bgmMenu');
}

// 每次用户交互时激活音频
// 每次用户交互时激活音频并尝试BGM
document.addEventListener('click', () => { ensureCtx(); setTimeout(() => retryBGM(), 200); });
document.addEventListener('keydown', () => { ensureCtx(); setTimeout(() => retryBGM(), 200); });

// 扫描音频首尾静音段，返回裁剪点（秒），用于 BGM 无缝循环
function detectLoopTrim(buf) {
    const ch = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const thresh = 0.002;
    let s = 0, e = ch.length - 1;
    while (s < ch.length && Math.abs(ch[s]) < thresh) s++;
    while (e > s && Math.abs(ch[e]) < thresh) e--;
    // 10ms 余量，避免削到音频本体
    return { start: Math.max(0, s / sr - 0.01), end: Math.min(buf.duration, e / sr + 0.01) };
}

export async function loadAudioAssets() {
    ensureCtx();
    const dir = 'assets/audio/';
    const files = Object.values(SOUND_MAP).filter(Boolean);
    const unique = [...new Set(files)];
    const promises = unique.map(async (name) => {
        try {
            const resp = await fetch(dir + name + '.mp3');
            if (!resp.ok) return;
            const arrayBuf = await resp.arrayBuffer();
            const audioBuf = await ctx.decodeAudioData(arrayBuf);
            buffers[name] = audioBuf;
            if (name.startsWith('bgm') || name === 'unlockPlant') loopTrim[name] = detectLoopTrim(audioBuf);
        } catch (e) { /* file missing, use synthesis */ }
    });
    await Promise.all(promises);
    setTimeout(() => retryBGM(), 500);
}

function playBuffer(name, gainVal, loop) {
    ensureCtx();
    const buf = buffers[name];
    if (!buf) return false;
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = !!loop;
    const g = ctx.createGain();
    g.gain.value = gainVal || 0.5;
    g.connect(sfxGain);
    source.connect(g);
    source.start();
    return source;
}

function play(name, gainVal) {
    if (buffers[name]) return playBuffer(name, gainVal);
    const base = name.replace(/[1-4]$/, '');
    if (buffers[base]) return playBuffer(base, gainVal);
}

function lockPriority(level, duration) {
    if (level > priorityLock.level) {
        priorityLock.level = level;
        priorityLock.timer = duration;
        if (bgmGain) bgmGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.1);
    }
}
function releasePriority() {
    priorityLock.level = -1; priorityLock.timer = 0;
    if (bgmGain && bgmSource) bgmGain.gain.setTargetAtTime(0.25, ctx.currentTime, 0.5);
}

export function setMasterVolume(v) { if (masterGain) masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.05); }
export function setBGMVolume(v) {
    initialBgmVolume = Math.max(0, Math.min(1, v));   // 记住最新值，上下文重建也不重置
    if (bgmGain) bgmGain.gain.setTargetAtTime(initialBgmVolume, ctx.currentTime, 0.05);
}
export function setSFXVolume(v) {
    initialSfxVolume = Math.max(0, Math.min(1, v));
    if (sfxGain) sfxGain.gain.setTargetAtTime(initialSfxVolume, ctx.currentTime, 0.05);
}

export function startBGM(bgmId) {
    ensureCtx();
    const id = bgmId || 'bgmDay';
    if (bgmBuffer === id && bgmSource) return;

    const oldSource = bgmSource;
    if (oldSource) {
        const oldGain = oldSource._gainNode;
        if (oldGain) oldGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
        setTimeout(() => { try { oldSource.stop(); } catch {} }, 900);
        bgmSource = null;
    }
    bgmBuffer = id;

    if (buffers[id]) {
        const s = ctx.createBufferSource();
        s.buffer = buffers[id];
        s.loop = true;
        // 裁掉首尾静音段，循环区域内无缝衔接
        const trim = loopTrim[id];
        if (trim && trim.end > trim.start + 1) {
            s.loopStart = trim.start;
            s.loopEnd = trim.end;
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.8);
        g.connect(bgmGain);
        s.connect(g);
        s._gainNode = g;
        s.start(0, trim ? trim.start : 0);
        bgmSource = s;
    } else {
        clearTimeout(bgmRetryTimer);
        bgmRetryTimer = setTimeout(() => startBGM(id), 500);
    }
}
export function stopBGM() {
    clearTimeout(bgmRetryTimer);
    bgmRetryTimer = null;
    if (bgmSource) {
        try { bgmSource.stop(); } catch {}
        bgmSource = null;
    }
    bgmBuffer = null;
}

// 胜利等场景：当前 BGM 平滑淡出后停止（不启动新 BGM）
export function fadeOutBGM(duration = 0.8) {
    clearTimeout(bgmRetryTimer);
    bgmRetryTimer = null;
    if (bgmSource && ctx) {
        const s = bgmSource;
        const g = s._gainNode;
        if (g) g.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
        setTimeout(() => { try { s.stop(); } catch {} }, duration * 1000 + 100);
        bgmSource = null;
    }
    bgmBuffer = null;
}

// ============================================================
// 武器音效（文件驱动：assets/audio/ 中放对应 mp3 即自动启用；缺失时回退默认音）
// ============================================================

const SHOT_SOUND = {
    pistol: 'shotPistol', smg: 'shotSmg', rifle: 'shotRifle', sniper: 'shotSniper',
    shotgun: 'shotShotgun', bow: 'shotBow', knife: 'swingSword',
};
const SWING_SOUND = {
    dagger: 'swingSword', sword: 'swingSword', spear: 'swingSword',
    axe: 'swingAxe', fist: 'bonk', shovel: 'bonk',
};

// 远程武器开火音（冲锋枪音画同步：音效截断到实际射速时长，shotInterval 由调用方传入）
export function playWeaponShot(wkey, shotInterval) {
    if (wkey === 'smg') {
        const dur = Math.min(0.15, shotInterval || 0.15);
        if (playSegment('shotSmg', 0, dur, 0.4)) return;
    }
    const name = SHOT_SOUND[wkey];
    if (name && play(name, 0.4)) return;
    play('peaShoot', 0.15); // 素材缺失回退
}

// 近战武器挥击音
export function playWeaponSwing(wkey) {
    const name = SWING_SOUND[wkey];
    if (name && play(name, 0.4)) return;
    play('uiClick', 0.1); // 素材缺失回退
}

// 换弹音（部分武器有专属换弹音；弓箭/飞刀非枪械，不用枪械换弹音）
const RELOAD_SOUND = { shotgun: 'reloadShotgun', knife: 'swingSword' };
export function playWeaponReload(wkey) {
    if (wkey === 'bow') { // 搭箭：取 shotBow 拉弓段前 1s
        if (playSegment('shotBow', 0, 1.0, 0.4)) return;
    }
    const spec = RELOAD_SOUND[wkey];
    if (spec && play(spec, 0.4)) return;
    if (play('reloadGun', 0.35)) return;
    play('uiClick', 0.15);
}

// 弓箭音效分段：shotBow.mp3 前 2.1s 为拉弓蓄力段，其后为发射段
let bowChargeSrc = null;
function playSegment(name, offset, dur, gainVal) {
    ensureCtx();
    const buf = buffers[name];
    if (!buf) return null;
    const source = ctx.createBufferSource();
    source.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gainVal || 0.4;
    g.connect(sfxGain);
    source.connect(g);
    if (dur != null) source.start(0, offset, dur);
    else source.start(0, offset);
    return source;
}
export function playBowCharge() {
    stopBowCharge();
    bowChargeSrc = playSegment('shotBow', 0, 2.1, 0.45);
}
export function stopBowCharge() {
    if (bowChargeSrc) {
        try { bowChargeSrc.stop(); } catch {}
        bowChargeSrc = null;
    }
}
export function playBowFire() {
    stopBowCharge();
    if (!playSegment('shotBow', 2.1, null, 0.45)) play('peaShoot', 0.15);
}

// Public API
export function playPlant() { play('plantSeed', 0.4); }
export function playPeaShoot() { play('peaShoot', 0.2); }
export function playSunProduce() { play('pickupSun', 0.15); }
export function playCherryBomb() { lockPriority(PRIORITY.EXPLOSION, 0.6); play('explode', 0.5); setTimeout(releasePriority, 600); }
export function playPotatoMineBoom() { lockPriority(PRIORITY.EXPLOSION, 0.5); play('potatoMineBoom', 0.5); setTimeout(releasePriority, 500); }
export function playChomper() { play('chomper', 0.4); }
export function playSnowpeaHit() { play('snowpeaHit', 0.2); }
export function playShoot(wkind, shotInterval) { playWeaponShot(wkind, shotInterval); }
export function playMeleeSwing(wkind) { playWeaponSwing(wkind); }
export function playMeleeHit() { play('zombieBite', 0.1); }
export function playBulletHit() { play('zombieHurt', 0.08); }
export function playHit() { play('zombieHurt', 0.08); }
export function playZombieDie() { play('zombieDie', 0.25); }
export function playZombieSpawn() {
    play(pickRandom(['zombieSpawn', 'zombieSpawn2', 'zombieSpawn3', 'zombieSpawn4']), 0.22);
}
export function playZombieEating() { play('zombieBite', 0.1); }
export function playPlayerHurt() {
    if (!playSegment('playerHurt', 0.24, null, 0.4)) play('zombieBite', 0.15);
}
export function playDash() { play('uiClick', 0.08); }
export function playGuard() { play('uiClick', 0.06); }
export function playPerfectGuard() { lockPriority(PRIORITY.WAVE, 0.4); play('uiClick', 0.15); setTimeout(() => play('uiClick', 0.2), 60); setTimeout(releasePriority, 400); }
export function playArmoredHurt() { play('armoredHurt', 0.2); }
export function playBucketHurt() { play('bucketHurt', 0.2); }
export function playPoleVault() { play('poleVault', 0.3); }

export function playClick() { play('uiClick', 0.12); }
export function playCollect() { play('pickupSun', 0.3); }
export function playCoinPickup() { play('pickupCoin', 0.3); }
export function playGemPickup() { play('pickupGem', 0.3); }
export function playWaveWarning() { lockPriority(PRIORITY.WAVE, 1.5); play('waveWarning', 0.4); setTimeout(releasePriority, 1500); }
export function playVictory() { play('victory', 0.4); }
export function playDefeat() { play('defeat', 0.4); }
export function playUnlock() { play('victory', 0.4); }
export function playLawnmower() { lockPriority(PRIORITY.EXPLOSION, 0.8); play('lawnmower', 0.5); setTimeout(releasePriority, 800); }
export function playGameStart() { play('gameStart', 0.4); }
export function playPreLaunch() { play('preLaunch', 0.5); }
export function playPlantDig() { play('plantDig', 0.3); }
export function playGachaSpin() { play('gachaSpin', 0.4); }
export function playPause() { play('pause', 0.4); }

// 生存/交互扩展音效
export function playChopTree() { if (!play('chopTree', 0.4)) play('plantDig', 0.25); }
export function playTreeFall() { play('treeFall', 0.45); }
export function playDigStone() { if (!play('digStone', 0.4)) play('plantDig', 0.2); }
export function playStoneBreak() { play('stoneBreak', 0.4); }
export function playOpenBox() { play('openBox', 0.4); }
export function playCloseBox() { play('closeBox', 0.35); }
export function playWalkGrass() { play('walkGrass', 0.16); }
export function playWalkStep(right) { play(right ? 'walkR' : 'walkL', 0.2); }
export function playRunStep(right) { play(right ? 'runR' : 'runL', 0.26); }

// 查询已加载音效的实际时长（秒），用于动画与音效精准同步；未加载返回 null
export function getSoundDuration(name) {
    const buf = buffers[name];
    return buf ? buf.duration : null;
}

// ============================================================
// 结算界面音乐：unlockPlant 无缝循环（裁剪首尾静音段）
// ============================================================
let rewardSource = null;

export function startRewardMusic() {
    ensureCtx();
    if (rewardSource) return;
    const buf = buffers['unlockPlant'];
    if (!buf) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const trim = loopTrim['unlockPlant'];
    if (trim && trim.end > trim.start + 1) {
        s.loopStart = trim.start;
        s.loopEnd = trim.end;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.6);
    g.connect(bgmGain);
    s.connect(g);
    s._gainNode = g;
    s.start(0, trim ? trim.start : 0);
    rewardSource = s;
}

export function stopRewardMusic() {
    if (!rewardSource) return;
    const s = rewardSource;
    rewardSource = null;
    const g = s._gainNode;
    if (g) g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    setTimeout(() => { try { s.stop(); } catch {} }, 500);
}

export function isAudioReady() { return ctx && ctx.state === 'running'; }
export function updateAudio(dt) {
    if (priorityLock.timer > 0) { priorityLock.timer -= dt; if (priorityLock.timer <= 0) releasePriority(); }
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const AudioSystem = {
    PRIORITY, loadAudioAssets, isReady: isAudioReady,
    setMasterVolume, setBGMVolume, setSFXVolume,
    startBGM, stopBGM, fadeOutBGM,
    playPlant, playPeaShoot, playSunProduce, playCherryBomb, playPotatoMineBoom,
    playChomper, playSnowpeaHit, playShoot, playMeleeSwing, playMeleeHit,
    playWeaponShot, playWeaponSwing, playWeaponReload,
    playBowCharge, stopBowCharge, playBowFire,
    playBulletHit, playHit, playZombieDie, playZombieSpawn, playZombieEating,
    playPlayerHurt, playDash, playGuard, playPerfectGuard,
    playArmoredHurt, playBucketHurt, playPoleVault,
    playClick, playCollect, playCoinPickup, playGemPickup,
    playWaveWarning, playVictory, playDefeat, playUnlock,
    playLawnmower, playGameStart, playPreLaunch, playPlantDig, playGachaSpin, playPause,
    playChopTree, playTreeFall, playDigStone, playStoneBreak,
    playOpenBox, playCloseBox, playWalkGrass,
    playWalkStep, playRunStep,
    getSoundDuration, startRewardMusic, stopRewardMusic,
    updateAudio,
};
export default AudioSystem;
