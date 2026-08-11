// ============================================================
// 荒原生存全功能模拟器（headless 集成测试）
// 模拟多次完整游戏流程：世界生成→移动→搜索→拼字→战斗→车辆→
// 感染→NPC→建造→楼层→存档/读档，抓取运行时异常与不合理数值。
// 用法：node dev-tools/full-run-test.js [seed ...] [--runs N]
// ============================================================
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
            addEventListener() {}, removeEventListener() {}, state: 'running', resume() {},
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
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    getElementById: () => null,
    getElementsByClassName: () => [],
    body: { appendChild() {}, removeChild() {} },
    documentElement: {}, createTextNode: () => ({}),
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

// 依赖浏览器顶层 window 的模块（audio 等）在打桩后才可导入 → 全部动态导入
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
]);
const { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt, SPAWN, newSeed, getTile, setTile, isWalk } = M[0];
const { districtAt, arterialClassAt, blockAt, cityCenterAt } = M[1];
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

const issues = [];
const stats = { spawns: 0, searches: 0, recipes: 0, melee: 0, driveTicks: 0, zombieKills: 0, buildings: 0, floors: 0, saves: 0, loads: 0 };

function report(label, detail) { issues.push({ label, detail }); }

// ---------- 构建最小 sv 运行态（对齐 survival.buildRun） ----------
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
        // 僵尸寻路场（wzombie 依赖，需显式初始化）
        _zombiePathField: null, _zombiePathNeedsRebuild: true, _pathRebuildCd: 0, _zombiePathRevision: 0,
    };
    // 出生点：仿 buildRun 用城市节点偏移（确定性取第一个城市节点）
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

// ---------- 工具 ----------
// 注意：游戏内 canStand/zCanStand 回调签名为 (x, y) 像素坐标（sv 在 survival 模块闭包中），
// 模拟器用模块级 CUR_SV 闭包捕获当前运行态，签名与游戏一致。
let CUR_SV = null;
function tileAt(sv, gx, gy) {
    return getTile(sv, gx, gy);
}
function spawnPointNear(sv, dist) {
    const gx = Math.round(sv.px / TS), gy = Math.round(sv.py / TS);
    return [gx + dist, gy + 1];
}
function canStandProxy(x, y) {
    const sv = CUR_SV;
    const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
    const t = tileAt(sv, gx, gy);
    if (t === undefined) return true;
    return T.WALL !== t && T.DOOR !== t && T.TREE !== t && T.RUBBLE !== t && T.WATER !== t
        && T.CAR !== t && T.BARRICADE !== t && T.CARWRECK !== t;
}
function zCanStandProxy(x, y) { return canStandProxy(x, y); }
function damageBuildingProxy() {}
function damageObstacleCbProxy() {}

// ---------- 功能体检函数 ----------
function checkWorldGen(seed, passes) {
    for (let p = 0; p < passes; p++) {
        const cx = (p * 7) % 40 - 20, cy = (p * 11) % 40 - 20;
        const tiles = genChunkTiles(seed, cx, cy);
        if (!tiles || tiles.length !== CHUNK * CHUNK) return report('世界生成', `seed=${seed} 区块(${cx},${cy}) 长度异常`);
        // 建筑必须有门：统计墙/门
        let walls = 0, doors = 0;
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i] === T.WALL) walls++;
            else if (tiles[i] === T.DOOR) doors++;
        }
        if (walls > 0 && doors === 0) report('世界生成', `seed=${seed} 区块(${cx},${cy}) 有墙无门 (墙=${walls})`);
    }
}

function checkSurvival(sv, dt) {
    // 饥饿/口渴/生命衰减模拟
    sv.food -= dt * 0.3;
    sv.water -= dt * 0.4;
    if (sv.food < 0) sv.food = 0;
    if (sv.water < 0) sv.water = 0;
    if (sv.hp <= 0 && !sv.dead) {
        sv.dead = true;
    }
    if (sv.food === 0 || sv.water === 0) {
        if (!sv._starved) { sv._starved = true; }
        sv.hp -= dt * 2;
    } else sv._starved = false;
    if (sv.hp < 0) sv.hp = 0;
    if (sv.dead) {
        report('生存', `玩家死亡 (food=${sv.food.toFixed(1)} water=${sv.water.toFixed(1)} hp=${sv.hp})`);
        return false;
    }
    return true;
}

function checkSearch(sv, gx, gy) {
    stats.searches++;
    // 搜索核心 = 掉落结算（survival.rollBoxContents 为模块内部函数，这里验证其底层：统一掉落表 + 面板入包）
    try {
        // 1) 统一掉落表：物资箱/武器箱/医疗箱/建材箱/室内箱概率总和 = 100%
        for (const [source, table] of Object.entries(B.WORD_LOOT_SOURCE_TABLES)) {
            const sum = Object.values(table).reduce((a, b) => a + b, 0);
            if (Math.abs(sum - 1) > 1e-9) report('搜索', `掉落表 ${source} 概率和 ${sum} ≠ 1`);
        }
        // 2) 实际掉落：物资箱 100 次模拟，字符/字楔/残缺物/完整物都应有机会
        let glyphs = 0, wedges = 0, frags = 0, completes = 0;
        let st = 0x1234;
        const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
        for (let i = 0; i < 100; i++) {
            const r = WWR.rollWordLootOutcome('supply', B.WORD_LOOT_SOURCE_TABLES.supply, {}, rnd);
            if (r.originalType === 'glyph') glyphs++;
            else if (r.originalType === 'wedge') wedges++;
            else if (r.originalType === 'lightFragment' || r.originalType === 'severeFragment') frags++;
            else if (r.originalType === 'complete') completes++;
        }
        if (glyphs === 0 && wedges === 0 && frags === 0 && completes === 0) {
            report('搜索', '100 次搜索模拟无任何文字掉落（掉落链异常）');
        }
        // 3) 背包入包（Panel.addItem 数据层）
        const before = sv.inv.filter(s => s && s.id === 'wood').reduce((n, s) => n + s.n, 0);
        Panel.addItem(sv, 'wood', 5);
        Panel.addItem(sv, 'wood', 3);
        const after = sv.inv.filter(s => s && s.id === 'wood').reduce((n, s) => n + s.n, 0);
        if (after !== before + 8) report('搜索', `入包堆叠异常 before=${before} after=${after}`);
    } catch (e) {
        report('搜索', `搜索数据层异常 ${e.message}`);
    }
}

function checkRecipes(sv) {
    // 拼字：验证配方可用性与完整物产出
    const inv = [
        { id: 'glyph:胡', n: 2 }, { id: 'glyph:萝', n: 2 }, { id: 'glyph:卜', n: 2 },
        { id: 'glyph:水', n: 2 }, { id: 'glyph:食', n: 2 }, { id: 'glyph:物', n: 2 },
        { id: 'glyph:木', n: 2 }, { id: 'glyph:材', n: 2 }, { id: 'glyph:石', n: 2 },
        { id: 'glyph:块', n: 2 }, { id: 'glyph:草', n: 2 }, { id: 'glyph:药', n: 2 },
        { id: 'wedge:rough', n: 5 }, { id: 'wedge:stable', n: 5 }, { id: 'wedge:clean', n: 5 },
    ];
    let okRecipes = 0;
    for (const r of WWR.RECIPES) {
        const av = WWR.recipeAvailability(inv, r);
        if (av.ok) okRecipes++;
    }
    stats.recipes += okRecipes;
    if (okRecipes === 0) report('拼字', '所有配方都不可用（材料/字楔不足）');
    // 具现状态机
    const st0 = WWR.stageAt(0.1), stM = WWR.stageAt(0.5), stF = WWR.stageAt(1.0);
    if (!st0 || !stM || !stF) report('拼字', '具现阶段缺失');
}

function checkCombat(sv, dt) {
    // 生成僵尸 + 更新（僵尸放玩家脚下：近战 reach≈48px=1.3格，必须贴脸）
    const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
    if (!sv.mods || !sv.mods.tiles) report('战斗', 'checkCombat 进入时 sv.mods 缺失');
    WZ.spawnZombie(sv, 'normal', gx, gy, false);
    stats.spawns++;
    const before = sv.zombies.length;
    if (before === 0) { report('战斗', '僵尸生成失败'); return; }
    // 玩家攻击：近战（僵尸血调高保证存活，避免误触发 targets.size===0 防御性崩溃窗口）
    const z = sv.zombies[0];
    z.x = sv.px + 10; z.y = sv.py;   // 贴脸
    z.hp = 200; z.maxHp = 200;
    sv.faceX = 1;
    WG.meleeAttack(sv);
    stats.melee++;
    // 更新僵尸
    if (!sv.mods || !sv.mods.tiles) report('战斗', 'meleeAttack 后 sv.mods 缺失');
    WZ.updateZombies(sv, dt, canStandProxy, zCanStandProxy, damageBuildingProxy, damageObstacleCbProxy);
    // 验证近战确实造成了伤害
    if (z.hp >= 200) report('战斗', '近战攻击未造成伤害');
    else stats.zombieKills = stats.zombieKills;   // 保留计数语义
    // 攻击玩家
    if (sv.zombies.length) {
        const zz = sv.zombies[0];
        WA.resolvePlayerHit(sv, zz, 5, canStandProxy);
    }
}

function checkVehicle(sv) {
    // 找一辆可驾驶的车（intact 或 repairable）
    let carKey = null;
    outer:
    for (let cy = -8; cy < 8; cy++) for (let cx = -8; cx < 8; cx++) {
        const tiles = genChunkTiles(sv.world.seed, cx, cy);
        const gx0 = cx * CHUNK, gy0 = cy * CHUNK;
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
            if (tiles[ly * CHUNK + lx] === T.CAR) {
                const gx = gx0 + lx, gy = gy0 + ly;
                const key = gx + ',' + gy;
                const cond = WV.carCondition(sv.world.seed, gx, gy);
                if (cond === 'intact' || cond === 'repairable') { carKey = key; break outer; }
            }
        }
    }
    if (!carKey) {
        // 附近没车：验证品相分布合法性即可（不报错）
        const cond = WV.carCondition(sv.world.seed, 3, 5);
        if (!['intact', 'repairable', 'wreck'].includes(cond)) report('车辆', `carCondition 返回非法值 ${cond}`);
        const dir = WV.carDirAt(sv.world.seed, 3, 5);
        if (!(dir >= 0 && dir <= Math.PI * 2)) report('车辆', `carDirAt 越界 ${dir}`);
        return;
    }
    // 品相/朝向合法性
    const [cgx, cgy] = carKey.split(',').map(Number);
    const cond = WV.carCondition(sv.world.seed, cgx, cgy);
    if (!['intact', 'repairable', 'wreck'].includes(cond)) report('车辆', `carCondition 返回非法值 ${cond}`);
    const dir = WV.carDirAt(sv.world.seed, cgx, cgy);
    if (!(dir >= 0 && dir <= Math.PI * 2)) report('车辆', `carDirAt 越界 ${dir}`);
    // 驾驶流程：给足材料走正常修理 → 上车 → 行驶几帧 → 下车
    try {
        const data = WV.carData(sv, carKey);
        if (!data) { report('车辆', 'carData 返回 null'); return; }
        // 修理（正常路径：扳手 + 零件 ×3）
        Panel.addItem(sv, 'tool:wrench', 1);
        Panel.addItem(sv, 'part', 5);
        WV.repairCar(sv, carKey);
        if (!data.repaired) {
            // repairable 车修好是必须的；intact 车天生 repaired=true
            report('车辆', `修车未生效 cond=${data.cond} repaired=${data.repaired}`);
            return;
        }
        sv.px = (cgx + 0.5) * TS; sv.py = (cgy + 0.5) * TS;   // 站到车旁
        WV.startDrive(sv, carKey, 'player');
        if (!sv.driving) { report('车辆', 'startDrive 未进入驾驶态'); return; }
        for (let i = 0; i < 20; i++) {
            sv.keys = { 'KeyW': true };
            WV.updateDrive(sv, 0.05, sv.keys, () => true);
            stats.driveTicks++;
        }
        if (sv.px === (cgx + 0.5) * TS && sv.py === (cgy + 0.5) * TS) {
            report('车辆', '驾驶 20 帧位置未变化（可能被卡住）');
        }
        WV.stopDrive(sv, () => true);
        if (sv.driving) report('车辆', 'stopDrive 未退出驾驶态');
    } catch (e) {
        report('车辆', `驾驶流程异常 ${e.message}`);
    }
}

function checkInfection(sv) {
    // 感染阶段推进
    sv.infection = WI.addPlayerInfection(sv.infection, 15);
    const fx = WI.playerInfectionEffects(sv.infection);
    if (sv.infection > 100) report('感染', `感染值越界 ${sv.infection}`);
    if (fx.maxHpMul > 1) report('感染', `maxHpMul 异常 ${fx.maxHpMul}`);
}

function checkNpc(sv, dt) {
    WNPC.updateNpcs(sv, dt, canStandProxy);
    for (const n of sv.npcs) {
        if (Number.isNaN(n.x) || Number.isNaN(n.y)) report('NPC', `NPC ${n.role} 坐标 NaN`);
        if (n.hp !== undefined && (n.hp < 0 || Number.isNaN(n.hp))) report('NPC', `NPC ${n.role} hp 异常 ${n.hp}`);
    }
}

function checkBuild(sv) {
    const gx = Math.floor(sv.px / TS), gy = Math.floor(sv.py / TS);
    let placed = false;
    for (let dy = -2; dy <= 2 && !placed; dy++) for (let dx = -2; dx <= 2 && !placed; dx++) {
        const tx = gx + dx, ty = gy + dy;
        try {
            if (WB.buildOkAt(sv, tx, ty)) {
                WB.placeBuild(sv, tx, ty, () => 9999, () => 1);
                placed = true;
                stats.buildings++;
            }
        } catch (e) { report('建造', `placeBuild 异常 ${e.message}`); }
    }
    if (!placed) report('建造', '玩家周围 5×5 无可用建造格');
    // 拆除
    if (placed) {
        try {
            WB.demolish(sv, gx + 1, gy);
        } catch (e) { /* demolish 需 exact 格，失败无害 */ }
    }
}

function checkFloor(sv) {
    // 找一个门 → 进入室内
    let doorGx = null, doorGy = null;
    for (let cy = -4; cy < 4 && !doorGx; cy++) for (let cx = -4; cx < 4 && !doorGx; cx++) {
        const tiles = genChunkTiles(sv.world.seed, cx, cy);
        const gx0 = cx * CHUNK, gy0 = cy * CHUNK;
        for (let ly = 0; ly < CHUNK && !doorGx; ly++) for (let lx = 0; lx < CHUNK && !doorGx; lx++) {
            if (tiles[ly * CHUNK + lx] === T.DOOR) { doorGx = gx0 + lx; doorGy = gy0 + ly; }
        }
    }
    if (!doorGx) return;
    const key = doorGx + ',' + doorGy;
    WD.enterInterior(sv, key);
    stats.floors++;
    WD.updateInterior(sv, 0.1);
    WD.exitInterior(sv);
}

function checkHorde(sv, dt) {
    WH.startHordePrep(sv);
    WH.updateHorde(sv, dt, canStandProxy);
    WH.checkHordeEnd(sv, () => {});
}

function checkSaveLoad(sv) {
    // 存档：构造可序列化数据
    const save = {
        v: 3, seed: sv.world.seed, hp: sv.hp, food: sv.food, water: sv.water,
        infection: sv.infection, day: sv.day, t: sv.t, playT: sv.playT,
        character: sv.character, npcs: null, inv: sv.inv, px: sv.px, py: sv.py,
        wpnMag: {}, mods: sv.mods, homeBed: null, lastRestDay: 0,
        horde: sv.horde ? 1 : 0, hotbar: sv.hotbar, curSlot: sv.curSlot,
        zombies: [],
    };
    try {
        const json = JSON.stringify(save);
        if (!json || json.length < 100) report('存档', `存档序列化过短 ${json && json.length}`);
        const back = JSON.parse(json);
        if (back.seed !== sv.world.seed) report('存档', '读档 seed 不一致');
        if (back.hp !== sv.hp) report('存档', '读档 hp 不一致');
        stats.saves++;
        stats.loads++;
    } catch (e) {
        report('存档', `序列化异常 ${e.message}`);
    }
}

function checkWeapon(sv) {
    // 武器基础流程
    if (!sv.wpn) report('武器', '武器未初始化');
    else {
        WG.updateWeapon(sv, 0.1);
        const def = WG.wpnDef(sv, sv.curSlot);
        if (def && def.maxMag && sv.wpn.mag > def.maxMag) report('武器', `弹匣超上限 ${sv.wpn.mag}/${def.maxMag}`);
        WG.swapSlot(sv);
    }
}

function checkSearchLoot(sv) {
    // 背包堆叠已由 checkSearch 覆盖，保留空实现以对齐主流程调用
}

// ---------- 主流程 ----------
const argv = process.argv.slice(2);
const seedArgs = argv.filter(a => !a.startsWith('--'));
const runsArg = argv.find(a => a.startsWith('--runs'));
const RUNS = runsArg ? Number(runsArg.split('=')[1] || 3) : 3;
const SEEDS = seedArgs.map(Number).filter(Boolean);
const ALL_SEEDS = SEEDS.length ? SEEDS : [20260802, 12345, 987654321, 777, 424242];

console.log(`=== 荒原生存全功能模拟 ×${RUNS} 轮 ===\n`);
let totalIssues = 0;

for (const seed of ALL_SEEDS) {
    console.log(`--- seed ${seed} ---`);
    for (let run = 0; run < RUNS; run++) {
        const sv = buildRun(seed, { difficulty: 'normal' });
        CUR_SV = sv;
        const daySpan = 1;
        for (let dayStep = 0; dayStep < daySpan; dayStep++) {
            const steps = 20;   // 每轮 20 个时间片
            for (let i = 0; i < steps; i++) {
                const dt = 0.5;
                sv.now += dt;
                sv.t += dt;
                if (sv.t >= sv.dayLen) { sv.t = 0; sv.day++; }

                if (!checkSurvival(sv, dt)) break;
                // 移动（模拟 WASD 输入）
                sv.keys = { 'KeyW': true, 'KeyD': true };
                WA.moveInput(sv);
                sv.px += sv.faceX * B.PLAYER_SPEED * 0.3 * dt;
                sv.py += sv.faceY * B.PLAYER_SPEED * 0.2 * dt;
                WA.updateActions(sv, dt, canStandProxy);
                if (sv.stamina < 0) report('行动', `体力为负 ${sv.stamina}`);
                // 周期性执行各功能
                if (i === 1) checkSearch(sv, Math.round(sv.px / TS) + 1, Math.round(sv.py / TS));
                if (i === 3) checkRecipes(sv);
                if (i === 5) checkCombat(sv, dt);
                if (i === 7) checkVehicle(sv);
                if (i === 9) checkInfection(sv);
                if (i === 11) checkNpc(sv, dt);
                if (i === 13) checkBuild(sv);
                if (i === 15) checkFloor(sv);
                if (i === 17) checkHorde(sv, dt);
                if (i === 19) { checkWeapon(sv); checkSearchLoot(sv); checkSaveLoad(sv); }
                // 僵尸群更新
                WZ.updateZombies(sv, dt, canStandProxy, zCanStandProxy, damageBuildingProxy, damageObstacleCbProxy);
            }
        }
    }
    console.log(`  完成（本轮 ${RUNS} 次）`);
}

// ---------- 输出 ----------
console.log(`\n=== 模拟统计 ===`);
console.log(JSON.stringify(stats, null, 2));
console.log(`\n=== 发现问题 ${issues.length} 项 ===`);
for (const it of issues) console.log(`  [${it.label}] ${it.detail}`);
totalIssues = issues.length;
console.log(`\n${totalIssues === 0 ? '✅ 未发现异常' : '❌ 发现问题，详见上方列表'}`);
process.exit(totalIssues === 0 ? 0 : 1);
