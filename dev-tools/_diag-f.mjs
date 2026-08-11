import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const _lsStore = {};
const _lsStub = { getItem: k => (_lsStore[k] !== undefined ? _lsStore[k] : null), setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
try { globalThis.localStorage = _lsStub; } catch {}
globalThis.window = { localStorage: _lsStub, AudioContext: function () { const gain = () => ({ gain: { value: 0 }, connect() {} }); return { createGain: gain, destination: {}, currentTime: 0, createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }), decodeAudioData: (b, ok) => ok && ok({ duration: 1 }), createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }), createMediaElementSource: () => ({ connect() {} }), addEventListener() {}, removeEventListener() {}, state: 'running', resume() {} }; }, webkitAudioContext: undefined, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, requestAnimationFrame: cb => { cb(performance.now()); return 1; }, cancelAnimationFrame: () => {}, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540 };
globalThis.document = { createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }), addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, getElementsByClassName: () => [], body: { appendChild() {}, removeChild() {} }, documentElement: {}, createTextNode: () => ({}) };
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {}; globalThis.HTMLImageElement = function () {}; globalThis.Audio = function () {}; globalThis.OfflineAudioContext = function () {};

const M = await Promise.all([
    import('../source-code/mod-wasteland/world.js'),
    import('../source-code/mod-wasteland/wdistrict.js'),
    import('../source-code/mod-wasteland/wbalance.js'),
    import('../source-code/mod-wasteland/wmsg.js'),
    import('../source-code/mod-wasteland/wnpc.js'),
    import('../source-code/mod-wasteland/wzombie.js'),
    import('../source-code/mod-wasteland/wconst.js'),
]);
const { T, CHUNK, getTile, genChunkTiles } = M[0];
const { cityCenterAt } = M[1];
const B = M[2];
const MSG = M[3];
const WNPC = M[4];
const WZ = M[5];
const { TS } = M[6];

function buildRun(seed) {
    const run = {
        active: true, dead: false, opts: { difficulty: 'normal' }, keys: {}, drops: [], zombies: [], bullets: [],
        hp: B.MAX_HP, maxHp: B.MAX_HP, day: 1, t: B.DAY_LEN * 0.35, dayLen: B.DAY_LEN,
        inv: Array(24).fill(null), px: 0, py: 0, faceX: 1, faceY: 0, camX: 0, camY: 0,
        swingT: 0, swingDir: 0, hurtT: 0, spawnT: 5, horde: null, announce: null,
        chop: {}, mine: {}, lastRestDay: 0, stepT: 0, stepSide: false, saveT: B.SAVE_INTERVAL,
        now: 0, last: 0, raf: 0, playT: 0, prompt: null, promptTarget: null, ctx: null,
        mouse: { x: 0, y: 0, inside: false }, mouseDown: false,
        world: { seed, chunks: new Map() }, mods: { tiles: {}, chests: {}, boxLoot: {}, explored: {}, plants: {} },
        homeBed: null, wpn: null, curSlot: 'ranged', stamina: 100, maxStamina: 100,
        build: false, buildSel: 0, buildOk: false, woodCount: 0, wpnText: '', chestKey: null,
        hotbar: Array(6).fill(null), hotbarSel: -1, sprinting: false, dashing: false,
        dashTimer: 0, dashDir: { x: 1, y: 0 }, dashCooldown: 0, dashGhosts: [], invuln: 0,
        guarding: false, guardTimer: 0, guardCooldown: 0, guardFacing: 0, perfectFlash: 0,
        isJumping: false, jumpOffset: 0, vy: 0, jumpCooldown: 0, exhausted: false, _stamDelay: 0,
        aiming: false, _atkSlowT: 0, _atkSlowImmune: 0, food: B.HUNGER_MAX, water: B.WATER_MAX,
        _starved: false, _starveLogT: 0, character: null, npcs: [], camp: null, controllerId: 'player',
        infection: 0, _infLogT: 0, effects: [],
        _zombiePathField: null, _zombiePathNeedsRebuild: true, _pathRebuildCd: 0, _zombiePathRevision: 0,
    };
    const cc = cityCenterAt(seed, 0, 0);
    const ang = (seed % 360) / 180 * Math.PI;
    const dist = 8 * CHUNK;
    run.px = (Math.round(cc.x * CHUNK + Math.cos(ang) * dist) + 0.5) * TS;
    run.py = (Math.round(cc.y * CHUNK + Math.sin(ang) * dist) + 0.5) * TS;
    run.world.seed = seed;
    run.msgs = [];
    MSG.initMsg(run);
    run.character = { body: '#39d98a', head: '#2b7a52', hat: null, face: null };
    return run;
}
let sv = buildRun(20260802);
function canStandProxy(x, y) {
    const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
    const t = getTile(sv, gx, gy);
    if (t === undefined) return true;
    return T.WALL !== t && T.DOOR !== t && T.TREE !== t && T.RUBBLE !== t && T.WATER !== t && T.CAR !== t && T.BARRICADE !== t && T.CARWRECK !== t;
}
WNPC.initRoster(sv);
WNPC.spawnInitialNpcs(sv);
for (let i = 0; i < 60; i++) WZ.spawnZombie(sv, i % 5 === 0 ? 'cone' : 'normal', Math.floor(sv.px / TS) + (i % 10), Math.floor(sv.py / TS) + Math.floor(i / 10), false);
for (let i = 0; i < 4; i++) { const n = WNPC.makeNpc(sv, sv.px + (i - 1) * TS, sv.py + TS * (i % 2 === 0 ? 1 : -1), 'friendly'); n.party = true; n.state = 'follow'; sv.npcs.push(n); }
for (let i = 0; i < 40; i++) { const n = WNPC.makeNpc(sv, sv.px + ((i % 10) - 5) * TS * 1.5, sv.py + (Math.floor(i / 10) - 2) * TS * 1.5, 'friendly'); n.state = 'wander'; sv.npcs.push(n); }
for (let i = 0; i < 150; i++) sv.drops.push({ x: sv.px + (i % 20) * 30, y: sv.py + Math.floor(i / 20) * 30, id: 'wood', n: 1, contents: null });
for (let i = 0; i < 50; i++) sv.effects.push({ kind: 'hit', x: sv.px + i * 5, y: sv.py, life: 0.3, maxLife: 0.3 });
const pcx = Math.floor(sv.px / TS / CHUNK), pcy = Math.floor(sv.py / TS / CHUNK);
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    sv.world.chunks.set((pcx + dx) + ',' + (pcy + dy), { tiles: genChunkTiles(sv.world.seed, pcx + dx, pcy + dy) });
}

console.log('--- 逐帧（细分 NPC/僵尸） ---');
const npcT = [], zT = [];
for (let f = 0; f < 23; f++) {
    sv.now += 0.5; sv.t += 0.5;
    let a = performance.now();
    WNPC.updateNpcs(sv, 0.5, canStandProxy);
    let b = performance.now();
    WZ.updateZombies(sv, 0.5, canStandProxy, canStandProxy, () => {}, () => {});
    let c = performance.now();
    if (f >= 3) { npcT.push(b - a); zT.push(c - b); }
    if (f >= 3 && ((b - a) > 8 || (c - b) > 8)) console.log(`帧${f}: NPC ${(b - a).toFixed(1)}ms · 僵尸 ${(c - b).toFixed(1)}ms`);
}
const q = (arr) => arr.slice().sort((x, y) => x - y)[Math.floor(arr.length * 0.95)];
console.log(`NPC: 平均 ${(npcT.reduce((a, b) => a + b, 0) / npcT.length).toFixed(1)}ms · P95 ${q(npcT).toFixed(1)}ms · 峰 ${Math.max(...npcT).toFixed(1)}ms`);
console.log(`僵尸: 平均 ${(zT.reduce((a, b) => a + b, 0) / zT.length).toFixed(1)}ms · P95 ${q(zT).toFixed(1)}ms · 峰 ${Math.max(...zT).toFixed(1)}ms`);
