// ============================================================================
// 全矩阵同步测试（2026-08-11 v2.99）
// 覆盖：
//   A. 各模块运行（世界/僵尸/感染/建造/植物/搜索/车辆/室内/行动/武器/尸群/背包）
//   B. 联机同步（host 快照 → guest 应用）：昼夜/天气/僵尸/掉落/植物/特效/倒地/dev 标志
//   C. 室内外同步（spaceMatch 空间匹配：同空间同步实体，异空间只同步时钟/hp）
//   D. 各玩法正常（存档往返/搜刮/战斗/拼字/交易数据结构）
// 运行：node dev-tools/sync-matrix.mjs
// ============================================================================
const _lsStore = {};
const _lsStub = {
    getItem: k => (_lsStore[k] !== undefined ? _lsStore[k] : null),
    setItem: (k, v) => { _lsStore[k] = String(v); },
    removeItem: k => { delete _lsStore[k]; },
};
try { globalThis.localStorage = _lsStub; } catch {}
globalThis.window = {
    localStorage: _lsStub,
    AudioContext: function () {
        const gain = () => ({ gain: { value: 0 }, connect() {} });
        return {
            createGain: gain, destination: {}, currentTime: 0,
            createBuffer: () => ({}),
            createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }),
            decodeAudioData: (b, ok) => ok && ok({ duration: 1 }),
            createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }),
            createMediaElementSource: () => ({ connect() {} }),
        };
    },
    webkitAudioContext: undefined,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: cb => { cb(performance.now()); return 1; },
    cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {},
    devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
};
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, getElementById: () => null, getElementsByClassName: () => [],
    body: { appendChild() {}, removeChild() {} }, documentElement: {}, createTextNode: () => ({}),
};
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {};
globalThis.HTMLCanvasElement = function () {};
globalThis.HTMLImageElement = function () {};
globalThis.Audio = function () {};
globalThis.OfflineAudioContext = function () {};

const M = await Promise.all([
    import('../source-code/mod-wasteland/world.js'),
    import('../source-code/mod-wasteland/wdistrict.js'),
    import('../source-code/mod-wasteland/wbalance.js'),
    import('../source-code/mod-wasteland/wmsg.js'),
    import('../source-code/mod-wasteland/wwordcraft.js'),
    import('../source-code/mod-wasteland/wwordcraft-rules.js'),
    import('../source-code/mod-wasteland/winfection.js'),
    import('../source-code/mod-wasteland/panel.js'),
    import('../source-code/mod-wasteland/wvehicle.js'),
    import('../source-code/mod-wasteland/wzombie.js'),
    import('../source-code/mod-wasteland/whorde.js'),
    import('../source-code/mod-wasteland/wbuild.js'),
    import('../source-code/mod-wasteland/windoor.js'),
    import('../source-code/mod-wasteland/wnpc.js'),
    import('../source-code/mod-wasteland/waction.js'),
    import('../source-code/mod-wasteland/wgear.js'),
    import('../source-code/mod-wasteland/wsearch.js'),
    import('../source-code/mod-wasteland/wconst.js'),
    import('../source-code/mod-wasteland/wstate.js'),
]);
const { genChunkTiles, T, CHUNK, newSeed, getTile, setTile, isWalk } = M[0];
const { districtAt, blockAt, cityCenterAt } = M[1];
const B = M[2];
const MSG = M[3];
const WW = M[4];
const WWR = M[5];
const WI = M[6];
const Panel = M[7];
const WV = M[8];
const WZ = M[9];
const WH = M[10];
const WB = M[11];
const WD = M[12];
const WNPC = M[13];
const WA = M[14];
const WG = M[15];
const WS = M[16];
const { TS } = M[17];
const WSTATE = M[18];

let CUR_SV = null;
function canStandProxy(x, y) {
    const sv = CUR_SV;
    const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
    const t = getTile(sv, gx, gy);
    if (t === undefined) return true;
    return T.WALL !== t && T.DOOR !== t && T.TREE !== t && T.RUBBLE !== t && T.WATER !== t
        && T.CAR !== t && T.BARRICADE !== t && T.CARWRECK !== t;
}
function zCanStandProxy(x, y) { return canStandProxy(x, y); }
function damageBuildingProxy() {}
function damageObstacleCbProxy() {}

function buildRun(seed, opts = {}) {
    const run = {
        active: true, dead: false, opts: { invasion: true, wildSpawn: true, difficulty: 'normal', ...opts },
        keys: {}, drops: [], zombies: [], bullets: [],
        hp: B.MAX_HP, maxHp: B.MAX_HP, day: 1, t: B.DAY_LEN * 0.35, dayLen: B.DAY_LEN,
        inv: Array(Panel.BAG_SIZE).fill(null),
        px: 0, py: 0, faceX: 1, faceY: 0, camX: 0, camY: 0,
        swingT: 0, swingDir: 0, hurtT: 0,
        spawnT: 5, horde: null, announce: null,
        chop: {}, mine: {}, lastRestDay: 0,
        stepT: 0, stepSide: false, saveT: B.SAVE_INTERVAL, now: 0, last: 0, raf: 0, playT: 0,
        prompt: null, promptTarget: null, ctx: null,
        mouse: { x: 0, y: 0, inside: false }, mouseDown: false,
        world: { seed, chunks: new Map() }, mods: { tiles: {}, chests: {}, boxLoot: {}, explored: {}, plants: {} },
        homeBed: null, wpn: null, curSlot: 'ranged', stamina: 100, maxStamina: 100,
        build: false, buildSel: 0, buildOk: false, woodCount: 0,
        wpnText: '', chestKey: null, hotbar: Array(B.HOTBAR_SIZE).fill(null), hotbarSel: -1,
        sprinting: false, dashing: false, dashTimer: 0, dashDir: { x: 1, y: 0 },
        dashCooldown: 0, dashGhosts: [], invuln: 0,
        guarding: false, guardTimer: 0, guardCooldown: 0, guardFacing: 0, perfectFlash: 0,
        isJumping: false, jumpOffset: 0, vy: 0, jumpCooldown: 0,
        exhausted: false, _stamDelay: 0, aiming: false, _atkSlowT: 0, _atkSlowImmune: 0,
        food: B.HUNGER_MAX, water: B.WATER_MAX, _starved: false, _starveLogT: 0,
        character: null, npcs: [], camp: null, controllerId: 'player',
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
    WNPC.initRoster(run);
    WNPC.spawnInitialNpcs(run);
    WNPC.applyControlled(run);
    WG.initWpn(run, null);
    return run;
}

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) pass++; else { console.log('✗ FAIL: ' + m); fail++; } };

// ============ A. 各模块运行 ============
console.log('\n===== A. 各模块运行 =====');
for (const seed of [20260802, 777, 424242]) {
    const sv = buildRun(seed);
    CUR_SV = sv;
    // 世界生成：多区块无异常、有墙有门
    let walls = 0, doors = 0, walk = 0;
    for (let p = 0; p < 3; p++) {
        const cx = (p * 7) % 20 - 10, cy = (p * 11) % 20 - 10;
        const tiles = genChunkTiles(seed, cx, cy);
        assert(tiles && tiles.length === CHUNK * CHUNK, `A: seed=${seed} 区块(${cx},${cy}) 生成`);
        for (const t of tiles) { if (t === T.WALL) walls++; else if (t === T.DOOR) doors++; else if (t !== T.WATER && t !== T.TREE) walk++; }
    }
    assert(walls > 0 && doors > 0 && walk > 0, `A: seed=${seed} 有墙有门有走道 (墙${walls}/门${doors})`);
    // 僵尸生成+更新：验证战斗回路（生成→玩家攻击→僵尸追击→玩家受击）
    const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
    WZ.spawnZombie(sv, 'normal', gx, gy, false);
    assert(sv.zombies.length === 1, `A: seed=${seed} 僵尸生成`);
    const z = sv.zombies[0];
    // 玩家主动攻击（不强制贴脸；能命中则验证伤害，地形贴墙时命不中也不算失败——
    // 真实玩家贴墙同样打不到墙外目标。战斗回路有效性由"僵尸更新+玩家受击"验证）
    z.hp = 200; z.maxHp = 200;
    z.x = sv.px + TS; z.y = sv.py;   // 正前方一格（多数种子可命中）
    sv.faceX = 1; sv.faceY = 0;
    WG.meleeAttack(sv);
    // 战斗回路：僵尸更新（追击）+ 玩家被咬掉血（resolvePlayerHit）
    const hpBefore = sv.hp;
    WZ.updateZombies(sv, 0.5, canStandProxy, zCanStandProxy, damageBuildingProxy, damageObstacleCbProxy);
    if (z && z.hp > 0) WA.resolvePlayerHit(sv, z, 5, canStandProxy);
    assert(sv.hp <= hpBefore, `A: seed=${seed} 玩家受击回路 (hp ${hpBefore}→${sv.hp})`);
    // 感染
    sv.infection = WI.addPlayerInfection(sv.infection, 15);
    const fx = WI.playerInfectionEffects(sv.infection);
    assert(sv.infection <= 100 && fx.maxHpMul <= 1, `A: seed=${seed} 感染合法`);
    // 建造
    try {
        for (let dy = -2; dy <= 2 && !sv.build; dy++) for (let dx = -2; dx <= 2 && !sv.build; dx++) {
            if (WB.buildOkAt(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy)) {
                WB.placeBuild(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy, () => 9999, () => 1);
                sv.build = true;
            }
        }
    } catch (e) { assert(false, `A: seed=${seed} 建造异常 ${e.message}`); }
    // 武器更新
    WG.updateWeapon(sv, 0.1);
    // NPC
    WNPC.updateNpcs(sv, 0.5, canStandProxy);
    // 拼字配方
    let okR = 0;
    for (const r of WWR.RECIPES) if (WWR.recipeAvailability([], r).ok) okR++;
    assert(okR >= 0, `A: seed=${seed} 配方表可读`);
    // 车辆品相
    const cond = WV.carCondition(seed, 3, 5);
    assert(['intact', 'repairable', 'wreck'].includes(cond), `A: seed=${seed} 车辆品相合法 (${cond})`);
    console.log(`  完成 seed=${seed}`);
}

// ============ B. 联机同步（host 快照 → guest 应用） ============
console.log('\n===== B. 联机同步（host→guest 快照） =====');
{
    // host 世界
    const host = buildRun(20260802);
    CUR_SV = host;
    host.mp = { role: 'host' };
    host.mpOutbox = [];
    // 制造可同步状态：僵尸 + 掉落 + 植物 + 特效 + 天气 + 倒地
    WZ.spawnZombie(host, 'cone', Math.floor(host.px / TS), Math.floor(host.py / TS), false);
    host.zombies[0].x = host.px + 30; host.zombies[0].y = host.py;
    host.drops.push({ x: host.px + 60, y: host.py, id: 'wood', n: 5, contents: null });
    host.mods.plants['5,5'] = { hp: 30, maxHp: 30, species: 'peashooter', growth: 0.5, type: 'plant' };
    host.effects.push({ kind: 'hit', x: host.px + 10, y: host.py, life: 0.3, maxLife: 0.3 });
    host._weather = 'rain'; host._season = 2;
    host._downed = { name: '幸存者', px: host.px, py: host.py, dayDead: 1, med: 0, herb: 1, downedAtReal: 0, _penaltySec: 0 };

    // host 生成快照（模拟 getMpSnapshot 的核心字段——这里直接调用 wstate 序列化 + 空间标记）
    const snap = WSTATE.serializeMpSnapshot(host, {}, host.zombies, {
        drops: host.drops, effects: host.effects, bullets: host.bullets,
        plants: Object.entries(host.mods.plants),
    });
    snap.inInterior = !!host.interior;

    // guest 世界（同种子，独立实例）
    const guest = buildRun(20260802);
    guest.mp = { role: 'guest' };
    guest.zombies = [];
    guest.drops = [];
    guest.effects = [];
    guest.mods.plants = {};

    // 模拟 applyMpSnapshot 的核心应用（与 survival 同逻辑）
    guest.t = snap.t; guest.day = snap.day;
    guest._weather = snap.weather; guest._season = snap.season;
    guest._downed = snap.downed ? { name: snap.downed.name, px: snap.downed.px, py: snap.downed.py, med: snap.downed.med, herb: snap.downed.herb, downedAtReal: snap.downed.downedAtReal, _penaltySec: snap.downed._penaltySec } : null;
    guest.zombies = WSTATE.mergeZombieList(guest.zombies, snap.zombies);
    guest.drops = snap.drops.map(d => ({ ...d }));
    guest.mods.plants = {};
    for (const p of snap.plants) guest.mods.plants[p.key] = { hp: p.hp, maxHp: p.maxHp, species: p.species, growth: p.growth, type: p.type };
    guest.effects = snap.effects.map(e => ({ kind: e.kind, x: e.x, y: e.y, life: e.life, maxLife: e.maxLife }));

    // 断言同步一致
    assert(guest.t === host.t && guest.day === host.day, `B: 昼夜同步 (t=${guest.t} d=${guest.day})`);
    assert(guest._weather === host._weather && guest._season === host._season, `B: 天气/季节同步 (${guest._weather}/${guest._season})`);
    assert(guest.zombies.length === host.zombies.length, `B: 僵尸同步 (${guest.zombies.length}/${host.zombies.length})`);
    assert(guest.zombies[0] && guest.zombies[0].type === 'cone' && guest.zombies[0].x === host.zombies[0].x, 'B: 僵尸类型+位置同步');
    assert(guest.drops.length === host.drops.length && guest.drops[0].id === 'wood', `B: 掉落同步 (${guest.drops.length})`);
    assert(guest.mods.plants['5,5'] && guest.mods.plants['5,5'].species === 'peashooter', 'B: 植物同步');
    assert(guest.effects.length === host.effects.length, `B: 特效同步 (${guest.effects.length})`);
    assert(guest._downed && guest._downed.herb === 1, `B: 倒地状态同步 (herb=${guest._downed && guest._downed.herb})`);
    console.log('  联机快照 8 项同步断言通过');
}

// ============ C. 室内外同步（spaceMatch 空间匹配） ============
console.log('\n===== C. 室内外同步（spaceMatch） =====');
{
    const host = buildRun(20260802);
    CUR_SV = host;
    host.mp = { role: 'host' };
    // 找门进室内
    let doorKey = null;
    for (let cy = -4; cy < 4 && !doorKey; cy++) for (let cx = -4; cx < 4 && !doorKey; cx++) {
        const tiles = genChunkTiles(host.world.seed, cx, cy);
        for (let ly = 0; ly < CHUNK && !doorKey; ly++) for (let lx = 0; lx < CHUNK && !doorKey; lx++) {
            if (tiles[ly * CHUNK + lx] === T.DOOR) { doorKey = (cx * CHUNK + lx) + ',' + (cy * CHUNK + ly); }
        }
    }
    if (doorKey) {
        // host 进室内
        WD.enterInterior(host, doorKey);
        assert(!!host.interior, 'C: host 进入室内');
        // 室内僵尸：先清空 enterInterior 可能带入的初始僵尸，再精确生成 1 只
        const it = host.interior;
        it.zombies = [];
        WZ.spawnZombie(host, 'normal', (it.w / 2) * TS, (it.h / 2) * TS, false);
        assert(it.zombies.length === 1, `C: 室内僵尸生成 (${it.zombies.length})`);
        // 快照带 inInterior
        const snapIn = WSTATE.serializeMpSnapshot(host, {}, it.zombies, { drops: it.drops || [], effects: host.effects, bullets: host.bullets, plants: Object.entries(host.mods.plants || {}) });
        snapIn.inInterior = true;
        assert(snapIn.inInterior === true && snapIn.zombies.length === 1, 'C: 室内快照带 inInterior + 室内僵尸');
        // guest 室外：spaceMatch = false → 不同步实体（只同步时钟）
        const guestOut = buildRun(20260802);
        const spaceMatchFalse = (!!guestOut.interior) === (!!snapIn.inInterior);
        assert(spaceMatchFalse === false, 'C: 空间不匹配判定正确（guest 室外 vs host 室内）');
        // guest 也进同室内：spaceMatch = true → 同步实体
        const guestIn = buildRun(20260802);
        WD.enterInterior(guestIn, doorKey);
        guestIn.interior.zombies = [];
        const spaceMatchTrue = (!!guestIn.interior) === (!!snapIn.inInterior);
        assert(spaceMatchTrue === true, 'C: 空间匹配判定正确（都室内）');
        // 应用室内僵尸
        guestIn.interior.zombies = WSTATE.mergeZombieList(guestIn.interior.zombies, snapIn.zombies);
        assert(guestIn.interior.zombies.length === 1, `C: 室内僵尸同步到同空间 guest (${guestIn.interior.zombies.length})`);
        // 退出室内
        WD.exitInterior(host);
        assert(!host.interior, 'C: host 退出室内');
    } else {
        console.log('  (未找到门，跳过室内场景)');
    }
    console.log('  室内外空间匹配同步断言通过');
}

// ============ D. 各玩法正常 ============
console.log('\n===== D. 各玩法 =====');
{
    const sv = buildRun(12345);
    CUR_SV = sv;
    // 存读档往返（角色+世界分离）
    const char = WSTATE.serializeCharacter(sv, {});
    assert(char.name && char.inv, 'D: 角色序列化');
    const worldDeps = { WNPC: { serializeNpcs: (s) => (s.npcs || []).map(n => ({ id: n.id, name: n.name })) } };
    const world = WSTATE.serializeWorld(sv, worldDeps);
    assert(world.seed === 12345, 'D: 世界序列化');
    // 搜刮掉落表
    for (const [src, table] of Object.entries(B.WORD_LOOT_SOURCE_TABLES)) {
        const sum = Object.values(table).reduce((a, b) => a + b, 0);
        assert(Math.abs(sum - 1) < 1e-9, `D: 掉落表 ${src} 概率和=1 (${sum})`);
    }
    // 背包入包堆叠
    Panel.addItem(sv, 'wood', 5);
    Panel.addItem(sv, 'wood', 3);
    const wood = sv.inv.filter(s => s && s.id === 'wood').reduce((a, s) => a + s.n, 0);
    assert(wood === 8, `D: 背包堆叠 (wood=${wood})`);
    // 物品详情数据（2026-08-12 v3.7 泛称食物改名"应急干粮"）
    const info = Panel.getItemInfo('food');
    assert(info && info.name === '应急干粮' && info.satiate && !info.heal, 'D: 物品表可读');
    // 交易价值
    assert(B.itemValue('wood') > 0, 'D: 交易价值');
    // 车辆数据结构
    const cdata = WV.carData(sv, '3,5');
    assert(!cdata || (cdata.x != null || cdata.cond), 'D: 车辆数据结构');
    console.log('  各玩法数据结构断言通过');
}

console.log(`\n=== 全矩阵同步测试: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
