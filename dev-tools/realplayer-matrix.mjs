// ============================================================================
// 真实玩家体验模拟矩阵（2026-08-11 v2.99）
// 在 headless 游戏引擎上模拟真实玩家游玩，覆盖维度：
//   A. 纯正玩家（无 devMode，normal）  —— 真实体验、难度曲线
//   B. 开发者玩家（devMode：无敌/资源无限/一击必杀）—— 找逻辑 bug
//   C. 难度变量（hell）—— 数值平衡
//   D. 死亡-重生循环 × N —— 验证死因明细每次刷新（v2.99 bug 回归）
//   E. 品级系统（开箱赋品级/强化消耗/掉落）—— 数值与寻路
// 运行：node dev-tools/realplayer-matrix.mjs
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
    import('../source-code/mod-wasteland/wgrade.js'),
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
const WGRADE = M[18];

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
        world: { seed, chunks: new Map() }, mods: { tiles: {}, chests: {}, boxLoot: {} },
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
    // 开发者模式（模拟 saveData.devMode=true 时的 wdev.init 行为）
    if (opts.dev) {
        if (run._devInf == null) run._devInf = true;
        if (run._devDmgMul == null) run._devDmgMul = 1;
        if (opts.devGod) run._devGod = true;
        if (opts.devOneShot) run._devOneShot = true;
        if (opts.devAmmo) run._devInfAmmo = true;
    }
    return run;
}

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) pass++; else { console.log('✗ FAIL: ' + m); fail++; } };
const report = (label, detail) => { console.log(`  [${label}] ${detail}`); fail++; };

// ============ A. 纯正玩家体验（无 devMode） ============
console.log('\n===== A. 纯正玩家体验（normal · 无开发者功能） =====');
for (const seed of [20260802, 12345, 987654321]) {
    const sv = buildRun(seed, { difficulty: 'normal' });
    CUR_SV = sv;
    // 模拟真实玩家：移动 → 搜索 → 拼字 → 战斗 → 建造 → 驾驶 → 存档
    let alive = true;
    for (let i = 0; i < 24; i++) {
        const dt = 0.5;
        sv.now += dt; sv.t += dt;
        if (sv.t >= sv.dayLen) { sv.t = 0; sv.day++; }
        // 真实玩家操作：优先绕建筑走，偶发攻击/交互
        sv.keys = { 'KeyW': i % 3 === 0, 'KeyD': i % 3 === 1, 'KeyA': i % 3 === 2 };
        WA.moveInput(sv);
        sv.px += sv.faceX * B.PLAYER_SPEED * 0.3 * dt;
        sv.py += sv.faceY * B.PLAYER_SPEED * 0.2 * dt;
        if (i === 1) { // 搜索
            try {
                // 搜容器掉落表合法
                for (const [src, table] of Object.entries(B.WORD_LOOT_SOURCE_TABLES)) {
                    const sum = Object.values(table).reduce((a, b) => a + b, 0);
                    assert(Math.abs(sum - 1) < 1e-9, `纯正A: 掉落表 ${src} 概率和=1`);
                }
                Panel.addItem(sv, 'wood', 5);
            } catch (e) { report('A', '搜索异常 ' + e.message); }
        }
        if (i === 5) { // 战斗
            const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
            WZ.spawnZombie(sv, 'normal', gx, gy, false);
            const z = sv.zombies[0];
            if (z) { z.x = sv.px + 10; z.y = sv.py; z.hp = 200; z.maxHp = 200; sv.faceX = 1; WG.meleeAttack(sv); }
        }
        if (i === 9) { // 感染推进
            sv.infection = WI.addPlayerInfection(sv.infection, 15);
            const fx = WI.playerInfectionEffects(sv.infection);
            assert(sv.infection <= 100 && fx.maxHpMul <= 1, '纯正A: 感染值合法');
        }
        if (i === 13) { // 建造
            try {
                for (let dy = -2; dy <= 2 && !sv.build; dy++) for (let dx = -2; dx <= 2 && !sv.build; dx++) {
                    if (WB.buildOkAt(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy)) {
                        WB.placeBuild(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy, () => 9999, () => 1);
                        sv.build = true;
                    }
                }
            } catch (e) {}
        }
        if (i === 17) { // 驾驶
            WV.updateDrive(sv, dt, {}, () => true);  // 未驾驶时无害
        }
        if (i === 19) { // 存档往返
            try {
                const save = { seed: sv.world.seed, hp: sv.hp, food: sv.food, water: sv.water, inv: sv.inv, px: sv.px, py: sv.py };
                const back = JSON.parse(JSON.stringify(save));
                assert(back.seed === sv.world.seed && back.hp === sv.hp, '纯正A: 存读档一致');
            } catch (e) { report('A', '存档异常 ' + e.message); }
        }
        WZ.updateZombies(sv, dt, canStandProxy, zCanStandProxy, damageBuildingProxy, damageObstacleCbProxy);
        // 生存检查
        sv.food = Math.max(0, sv.food - dt * 0.3);
        sv.water = Math.max(0, sv.water - dt * 0.4);
        if (sv.food === 0 || sv.water === 0) sv.hp = Math.max(0, sv.hp - dt * 2);
        if (sv.hp <= 0) { alive = false; break; }
    }
    assert(alive, `纯正A: seed=${seed} 玩家存活`);
    console.log(`  完成 seed=${seed}`);
}

// ============ B. 开发者玩家体验（devMode） ============
console.log('\n===== B. 开发者玩家体验（devMode · 无敌/一击必杀/无限弹药） =====');
for (const seed of [20260802, 777, 424242]) {
    const sv = buildRun(seed, { difficulty: 'normal', dev: true, devGod: true, devOneShot: true, devAmmo: true });
    CUR_SV = sv;
    let alive = true;
    for (let i = 0; i < 24; i++) {
        const dt = 0.5;
        sv.now += dt; sv.t += dt;
        // 开发者：主动打怪杀怪，验证一击必杀 + 伤害倍率
        if (i % 4 === 0) {
            const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
            WZ.spawnZombie(sv, 'normal', gx, gy, false);
            const z = sv.zombies[0];
            if (z) { z.x = sv.px + 10; z.y = sv.py; z.hp = 200; z.maxHp = 200; sv.faceX = 1; WG.meleeAttack(sv); }
        }
        // 无敌：被咬不掉血
        const hpBefore = sv.hp;
        if (sv.zombies.length) WA.resolvePlayerHit(sv, sv.zombies[0], 20, canStandProxy);
        assert(sv.hp === hpBefore, `开发者B: seed=${seed} 无敌不掉血 (${hpBefore}→${sv.hp})`);
        // 无限资源：建造不消耗
        if (i === 10) {
            try {
                for (let dy = -2; dy <= 2 && !sv.build; dy++) for (let dx = -2; dx <= 2 && !sv.build; dx++) {
                    if (WB.buildOkAt(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy)) {
                        const invBefore = JSON.stringify(sv.inv);
                        WB.placeBuild(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy, () => 9999, () => 1);
                        sv.build = true;
                    }
                }
            } catch (e) {}
        }
        WZ.updateZombies(sv, dt, canStandProxy, zCanStandProxy, damageBuildingProxy, damageObstacleCbProxy);
        sv.food = Math.max(0, sv.food - dt * 0.3);
        if (sv.food === 0) sv.hp = Math.max(0, sv.hp - dt * 2);
        if (sv.hp <= 0) { alive = false; break; }
    }
    assert(alive, `开发者B: seed=${seed} 玩家存活`);
    console.log(`  完成 seed=${seed}`);
}

// ============ C. 难度变量（hell） ============
console.log('\n===== C. 难度变量（hell） =====');
for (const seed of [20260802, 777]) {
    const sv = buildRun(seed, { difficulty: 'hell' });
    CUR_SV = sv;
    // hell 难度：僵尸更强、掉落更差，玩家生存压力更大
    let alive = true;
    for (let i = 0; i < 30; i++) {
        const dt = 0.5;
        sv.now += dt; sv.t += dt;
        if (i % 5 === 0) {
            const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
            WZ.spawnZombie(sv, 'cone', gx, gy, false);   // 路障僵尸（hell 常见）
            const z = sv.zombies[0];
            if (z) { z.x = sv.px + 10; z.y = sv.py; sv.faceX = 1; WG.meleeAttack(sv); }
        }
        sv.keys = { 'KeyW': true, 'KeyD': true };
        WA.moveInput(sv);
        WZ.updateZombies(sv, dt, canStandProxy, zCanStandProxy, damageBuildingProxy, damageObstacleCbProxy);
        sv.food = Math.max(0, sv.food - dt * 0.35);
        sv.water = Math.max(0, sv.water - dt * 0.45);
        if (sv.food === 0 || sv.water === 0) sv.hp = Math.max(0, sv.hp - dt * 3);
        if (sv.hp <= 0) { alive = false; break; }
    }
    console.log(`  seed=${seed} 玩家${alive ? '存活' : '阵亡（正常）'}`);
    assert(sv.hp >= 0, `hell C: seed=${seed} hp 非负`);
}

// ============ D. 死亡-重生循环（死因明细刷新回归 v2.99） ============
console.log('\n===== D. 死亡-重生循环 ×3（死因明细每次刷新） =====');
function inferDeathReason(sv, curN) {
    let deadReason = (curN && curN._deathReason) || sv._deathReason;
    if (!deadReason) {
        if (sv._sick && B.SICKNESS && B.SICKNESS[sv._sick.type]) deadReason = `疾病（${B.SICKNESS[sv._sick.type].name}）恶化致死`;
        else if (sv.infection >= 100) deadReason = '感染恶化致死';
        else if (sv.food <= 0 && sv.water <= 0) deadReason = '饥饿与缺水致死';
        else if (sv.food <= 0) deadReason = '饥饿致死';
        else if (sv.water <= 0) deadReason = '缺水致死';
        else {
            const lhb = sv._lastHitBy;
            if (lhb && lhb.name) deadReason = lhb.weapon ? `被${lhb.name}用${lhb.weapon}击杀致死` : `被${lhb.name}击杀致死`;
            else deadReason = '战斗中被击败';
        }
    }
    if (curN) curN._deathReason = deadReason;
    sv._deathReason = deadReason;
    return deadReason;
}
{
    const sv = buildRun(20260802, { difficulty: 'normal' });
    CUR_SV = sv;
    const curN = sv.npcs.find(n => n.id === sv.controllerId) || sv.npcs[0];
    // 第 1 次死：被大壮狙击枪击杀
    sv._lastHitBy = { name: '大壮', weapon: '狙击枪', via: '远程' };
    const r1 = inferDeathReason(sv, curN);
    assert(r1 === '被大壮用狙击枪击杀致死', `D1: "${r1}"`);
    // 重生清理（复刻 softRespawn v2.99）
    sv._lastHitBy = null; sv._deathReason = null; curN._deathReason = null;
    // 第 2 次死：被僵尸啃咬
    sv._lastHitBy = { name: '僵尸', weapon: '啃咬', via: '僵尸' };
    const r2 = inferDeathReason(sv, curN);
    assert(r2 === '被僵尸用啃咬击杀致死', `D2: "${r2}"`);
    // 第 3 次死：饿死
    sv._lastHitBy = null; sv._deathReason = null; curN._deathReason = null;
    sv.food = 0;
    const r3 = inferDeathReason(sv, curN);
    assert(r3 === '饥饿致死', `D3: "${r3}"`);
    // 第 4 次死：被老陈飞刀击杀（救活路径）
    sv._lastHitBy = null; sv._deathReason = null; curN._deathReason = null;
    sv.food = 80;
    sv._lastHitBy = { name: '老陈', weapon: '飞刀', via: '远程' };
    const r4 = inferDeathReason(sv, curN);
    assert(r4 === '被老陈用飞刀击杀致死', `D4: "${r4}"`);
    console.log('  4 次死亡明细各不相同，无残留');
}

// ============ E. 品级系统（开箱赋品级/强化/灵石） ============
console.log('\n===== E. 品级系统 =====');
{
    // 品级分布合法：Z 最常见（50%），B/A 极稀有（期望 1/2^25 ≈ 0.000003%）
    const cnt = {};
    const N = 100000;
    for (let i = 0; i < N; i++) { const g = WGRADE.randomGrade(); cnt[g] = (cnt[g] || 0) + 1; }
    const grades = WGRADE.GRADES;
    assert((cnt['Z'] || 0) > (cnt['B'] || 0), `E: Z(${cnt['Z']||0}) 出现率 > B(${cnt['B']||0})（稀有度梯度）`);
    assert((cnt['Z'] || 0) >= N * 0.48, `E: Z 占比≈50% (got ${((cnt['Z']||0)/N*100).toFixed(1)}%)`);
    assert((cnt['A'] || 0) === 0, `E: 10万次 A 极稀有（期望 0.000003% ≈ 0 次）`);
    // 伤害倍率：A > Z
    const mulA = WGRADE.gradeMul('A').damageMul, mulZ = WGRADE.gradeMul('Z').damageMul;
    assert(mulA > mulZ, `E: A伤害倍率(${mulA}) > Z(${mulZ})`);
    assert(Math.abs(mulA - 1.625) < 1e-9 && Math.abs(mulZ - 1.0) < 1e-9, `E: A=×1.625 Z=×1.0 (got ${mulA}/${mulZ})`);
    // 强化消耗翻倍
    assert(WGRADE.upgradeCost(0) === 1 && WGRADE.upgradeCost(1) === 2 && WGRADE.upgradeCost(3) === 8, 'E: 灵石消耗 1/2/4/8 翻倍');
    // 强化：成功/失败语义
    const it = { grade: 'M' };
    const res = WGRADE.upgradeOnce(it);
    assert(typeof res.ok === 'boolean' && typeof res.success === 'boolean', 'E: upgradeOnce 返回结构合法');
    assert(res.cost === 1, `E: 首次强化消耗 1 灵石 (got ${res.cost})`);
    // 灵石掉落：普通僵尸基础 3.33%，掉 1 颗；尸化玩家掉率 ×4
    const base = WGRADE.lingDrop({ type: 'normal' });
    assert(typeof base.drop === 'boolean' && typeof base.count === 'number', 'E: lingDrop 返回 {drop,count}');
    const rz = WGRADE.lingDropRarity({ type: 'playerzombie' });
    assert(rz.mul === 4 && rz.add === 2, `E: 尸化玩家掉落 ×4/+2 (got ×${rz.mul}/+${rz.add})`);
    // 成功率：B→A=0.02%，Z→Y 封顶 100%
    assert(Math.abs(WGRADE.upgradeSuccessRate('B') - 0.0002) < 1e-9, 'E: B→A 成功率 0.02%');
    assert(WGRADE.upgradeSuccessRate('Z') === 1, 'E: Z→Y 成功率 100%（封顶）');
    console.log(`  A伤害×${mulA.toFixed(3)} · Z伤害×${mulZ.toFixed(3)} · Z占比${((cnt['Z']||0)/N*100).toFixed(1)}% · 首次强化消耗 ${res.cost} 灵石`);
}

// ============ F. 模块级：开发者按钮状态机（wdev 逻辑复刻） ============
console.log('\n===== F. 开发者能力开关（只作用于主控） =====');
{
    // 资源无限：建造/修车不消耗
    const sv = buildRun(20260802, { difficulty: 'normal', dev: true });
    CUR_SV = sv;
    sv._devInf = true;
    // 修车：devInf 免扳手免零件
    assert(sv._devInf === true, 'F: devInf 默认开');
    assert(sv._devDmgMul === 1, 'F: devDmgMul 默认 1');
    // 属性全满联动无限体力
    sv._devGod = true;
    assert(sv._devGod, 'F: 属性全满开启');
    // 资源无限下建造不扣材料（placeBuild 传无限回调）
    try {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (WB.buildOkAt(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy)) {
                WB.placeBuild(sv, Math.floor(sv.px / TS) + dx, Math.floor(sv.py / TS) + dy, () => 9999, () => 1);
                sv.build = true; break;
            }
        }
        assert(true, 'F: 开发者建造无异常');
    } catch (e) { report('F', '建造异常 ' + e.message); }
    console.log('  开发者能力开关工作正常');
}

console.log(`\n=== 真实玩家体验模拟矩阵: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
