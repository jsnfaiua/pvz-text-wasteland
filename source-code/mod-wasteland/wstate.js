// ============================================================
// 【无尽植僵荒原】模组 · 状态序列化（白名单 / 纯函数）
// ------------------------------------------------------------
// 本文件是「存档」与「联机快照」共用的唯一真相来源（single source of truth）。
//
// 设计约束（来自 docs/荒原联机-复用评估与实施设计.md §8 编码规范）：
//   ⚠️ 禁止 JSON.stringify(sv) —— sv 含 DOM/canvas/函数引用，必须白名单字段。
//   ✅ serializeSV / applySnapshot / createRunDefaults 均为纯函数，无副作用、
//      不 import 任何环内模块（render/windoor/wzombie/wnpc/...），依赖通过 deps 注入，
//      以便在 dev-tools/smoke-test.js 中直接单测（node 环境）。
//
// 注入依赖清单（deps 对象，由 survival.js 在调用时装配）：
//   deps.BAG_SIZE          背包格数（panel.js，环内 → 注入）
//   deps.HOTBAR_SIZE       快捷栏格数（wbalance.js 常量）
//   deps.B                  wbalance.js 数值常量集合（MAX_HP/DAY_LEN/HUNGER_MAX/WATER_MAX/...）
//   deps.WNPC              { serializeNpcs, restoreNpcs, spawnInitialNpcs }
//   deps.normalizeLook     外观归一化函数（wlook.js）
//   deps.PLAYER_INFECTION  { max }
//   deps.saveData          { devMode }（core/state.js）
// ============================================================

// ============================================================
// 存档字段版本迁移表（P2-2 · 新增存档字段时在此登记默认值，勿散落）
//   字段名                    默认值                      引入版本/说明
//   horde.{phase,pending,...} null(无尸潮)                L7 尸潮进度恢复
//   zombies[].id              'w'+seed+'_'+i(applyWorld补) 联机按 id 合并
//   _devInfBag                false                       开发者无限背包扩容
//   _savedMag                 null                        startRun 恢复弹匣
//   interior/interiors        sv.mods.interiors 缺省 {}   室内楼层进度
//   boxSearched / guarded     {}                          容器已搜/守卫标记
//   zombies[].isPlayerZombie  false                       尸化玩家精英（hardcore 死亡后留世）
//   zombies[].playerName/skin null/null                   尸化僵尸名字/肤色
//   zombies[].inv/hotbar/wpnKey null                      尸化僵尸继承的装备背包
//   legacyDrop                null                        正常模式死亡遗物包裹{位置,内容}
//   _deathCount               0                           死亡次数（遗物永久消失代价递增）
//   新增字段规则：①白名单序列化函数同步补字段；②apply 端给默认值；
//   ③旧档无该字段时必须安全缺省（不得抛错）；④联机快照字段双端同改。
// ============================================================

// ============================================================
// 1. 白名单序列化（sv → 可 JSON 的数据对象）
//    对应原 survival.js saveNow() 的 setStorage 载荷。
// ============================================================
export function serializeSV(sv, deps) {
    if (!sv || !sv.world || sv.dead) return null;
    return {
        v: 3,
        seed: sv.world.seed,
        hp: sv.hp,
        food: sv.food,
        water: sv.water,
        infection: sv.infection || 0,
        day: sv.day,
        t: sv.t,
        playT: sv.playT,
        character: sv.character || null,
        npcs: deps.WNPC.serializeNpcs(sv),
        inv: sv.inv,
        px: sv.px,
        py: sv.py,
        wpnMag: sv.wpn ? sv.wpn.mag : {},
        _devInfBag: !!sv._devInfBag,
        // 死亡次数（正常模式遗物包裹永久消失代价：死亡越多丢越多；角色跨世界保留）
        _deathCount: sv._deathCount || 0,
        mods: sv.mods,
        homeBed: sv.homeBed || null,
        lastRestDay: sv.lastRestDay,
        horde: sv.horde ? { phase: sv.horde.phase, pending: sv.horde.pending || 0, total: sv.horde.total || 0, batchT: sv.horde.batchT || 0 } : null,
        hotbar: sv.hotbar,
        curSlot: sv.curSlot,
        zombies: sv.zombies.map(z => ({
            id: z.id,   // 运行时 id（'zNNN'）：联机 wsync 按 id 合并；无 id 的旧档僵尸由 apply 端补
            type: z.type, char: z.char, color: z.color, name: z.name,
            x: z.x, y: z.y, tx: z.tx, ty: z.ty,
            hp: z.hp, maxHp: z.maxHp, speed: z.speed, damage: z.damage,
            horde: !!z.horde, vaulted: !!z.vaulted, _nightStrengthActive: !!z._nightStrengthActive,
            // 尸化玩家精英僵尸（死亡后留在世界）：继承名字/外观/装备/背包，重进世界可见可寻回
            isPlayerZombie: !!z.isPlayerZombie,
            playerName: z.playerName || null, skin: z.skin || null,
            inv: z.inv || null, hotbar: z.hotbar || null, wpnKey: z.wpnKey || null,
        })),
    };
}

// ============================================================
// 2. 默认 run 对象构造（纯字面量，无外部副作用）
//    对应原 survival.js buildRun() 的默认字段块。
// ============================================================
export function createRunDefaults(opts, deps) {
    const B = deps.B;
    const HOTBAR_SIZE = deps.HOTBAR_SIZE;
    const BAG_SIZE = deps.BAG_SIZE;
    return {
        active: true, dead: false, opts,
        keys: {}, drops: [], zombies: [], bullets: [],
        hp: B.MAX_HP, maxHp: B.MAX_HP, day: 1, t: B.DAY_LEN * 0.35, dayLen: B.DAY_LEN,
        inv: Array(BAG_SIZE).fill(null),
        px: 0, py: 0, faceX: 1, faceY: 0, camX: 0, camY: 0,
        swingT: 0, swingDir: 0, hurtT: 0,
        spawnT: 5,
        horde: null, announce: null,
        chop: {}, mine: {}, lastRestDay: 0,
        stepT: 0, stepSide: false,
        saveT: B.SAVE_INTERVAL, now: 0, last: 0, raf: 0, playT: 0,
        prompt: null, promptTarget: null, ctx: null,
        mouse: { x: 0, y: 0, inside: false }, mouseDown: false,
        world: null, mods: { tiles: {}, chests: {}, boxLoot: {} },
        homeBed: null, wpn: null, curSlot: 'ranged', stamina: 100, maxStamina: 100,
        build: false, buildSel: 0, buildOk: false, woodCount: 0,
        wpnText: '', chestKey: null, hotbar: Array(HOTBAR_SIZE).fill(null), hotbarSel: -1,
        sprinting: false, dashing: false, dashTimer: 0, dashDir: { x: 1, y: 0 },
        dashCooldown: 0, dashGhosts: [], invuln: 0,
        guarding: false, guardTimer: 0, guardCooldown: 0, guardFacing: 0, perfectFlash: 0,
        isJumping: false, jumpOffset: 0, vy: 0, jumpCooldown: 0,
        exhausted: false, _stamDelay: 0, aiming: false, _atkSlowT: 0, _atkSlowImmune: 0,
        food: B.HUNGER_MAX, water: B.WATER_MAX, _starved: false, _starveLogT: 0,
        character: null, npcs: [], camp: null, controllerId: 'player',
        characterName: '幸存者',
        infection: 0, _infLogT: 0,
        effects: [],
        mp: null,            // 联机标记 {role:'host'|'guest'}；null=单机（sv.mp 开关，Phase 1+）
        p2: null,            // 远端队友（sv.p2 渲染对象）；null=单机（Phase 1+ 位置同步）
    };
}

// ============================================================
// 3. 快照应用（数据对象 → 合并进 run）
//    对应原 survival.js buildRun() 的 canLoad 分支 + 联机 wsync 白名单还原。
//    纯函数：只读写传入的 run / saved，不触碰模块级状态。
//    返回 { run, loaded: boolean, legacy: boolean }
//      - loaded=false 表示 saved 不可加载（应走新世界生成分支）
//      - legacy=true  表示命中旧版存档（tiles 结构，需备份到 LEGACY_KEY）
// ============================================================
export function applySnapshot(run, saved, deps) {
    const B = deps.B;
    const HOTBAR_SIZE = deps.HOTBAR_SIZE;
    const BAG_SIZE = deps.BAG_SIZE;
    const PLAYER_INFECTION = deps.PLAYER_INFECTION;
    const out = { run, loaded: false, legacy: false };

    const canLoad = saved && saved.v === 3 && typeof saved.seed === 'number' && !run.opts.forceNew;
    if (!canLoad) {
        // 旧版（tiles 结构）存档不强制新开：标记 legacy 由调用方处理
        if (saved && saved.tiles && !run.opts.forceNew) out.legacy = true;
        return out;
    }

    try {
        run.world = { seed: saved.seed, chunks: new Map() };
        run.mods = saved.mods && saved.mods.tiles ? saved.mods : { tiles: {}, chests: {}, boxLoot: {} };
        if (!run.mods.chests) run.mods.chests = {};
        if (!run.mods.boxLoot) run.mods.boxLoot = {};
        run.hp = Math.max(1, Math.min(B.MAX_HP, saved.hp || B.MAX_HP));
        run.food = typeof saved.food === 'number' ? Math.max(0, Math.min(B.HUNGER_MAX, saved.food)) : B.HUNGER_MAX;
        run.water = typeof saved.water === 'number' ? Math.max(0, Math.min(B.WATER_MAX, saved.water)) : B.WATER_MAX;
        run.character = deps.normalizeLook(saved.character);
        deps.WNPC.restoreNpcs(run, saved.npcs || null);
        if (!saved.npcs) deps.WNPC.spawnInitialNpcs(run);   // 旧档无 NPC 数据：补初始 NPC
        run.infection = typeof saved.infection === 'number'
            ? Math.max(0, Math.min(PLAYER_INFECTION.max, saved.infection)) : 0;
        run.day = saved.day || 1;
        if (typeof saved.t === 'number') run.t = saved.t;
        if (typeof saved.playT === 'number') run.playT = saved.playT;
        if (Array.isArray(saved.inv)) {
            // 开发者无限背包：保留扩容后的全部格子；普通存档固定 24 格
            const cap = (deps.saveData.devMode && saved._devInfBag) ? saved.inv.length : BAG_SIZE;
            run.inv = saved.inv.slice(0, Math.max(cap, BAG_SIZE));
            while (run.inv.length < BAG_SIZE) run.inv.push(null);
        }
        if (typeof saved.px === 'number') run.px = saved.px;
        if (typeof saved.py === 'number') run.py = saved.py;
        run.lastRestDay = saved.lastRestDay || 0;
        run.homeBed = saved.homeBed || null;
        run._savedMag = saved.wpnMag || null;
        run.curSlot = saved.curSlot || 'ranged';
        run._deathCount = typeof saved._deathCount === 'number' ? Math.max(0, Math.floor(saved._deathCount)) : 0;
        if (Array.isArray(saved.hotbar)) {
            run.hotbar = saved.hotbar.slice(0, HOTBAR_SIZE);
            while (run.hotbar.length < HOTBAR_SIZE) run.hotbar.push(null);
        }
        if (saved.horde) {
            // L7：进行中的尸潮进度（wave 批次数/剩余数/计时）恢复，而非重置
            run.horde = typeof saved.horde === 'object'
                ? { phase: saved.horde.phase || 'wave', pending: saved.horde.pending || 0, total: saved.horde.total || 0, batchT: saved.horde.batchT || 0 }
                : { phase: 'wave', pending: 0, total: 0, batchT: 0 };   // 旧布尔档兼容
        }
        // 还原室外僵尸血量/位置
        if (Array.isArray(saved.zombies)) {
            run.zombies = saved.zombies.map(z => ({
                ...z,
                wt: 0, biteT: 0, hurt: 0, stunT: 0,
                atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false, auraT: 0, comboLeft: 0,
            }));
        }
        out.loaded = true;
    } catch {
        run.world = null;
        out.loaded = false;
    }
    return out;
}

// ============================================================
// 3.5 泰拉瑞亚式「角色 / 世界」分离存档（2026-08-05）
//    角色（名字/外观/物品/属性）跨世界保留；世界（seed/时间/差分/NPC）跟种子走。
//    serializeCharacter / serializeWorld  → 各自白名单
//    applyCharacter / applyWorld           → 合并进 run（纯函数）
// ============================================================

// 角色白名单（跨世界保留：进任何种子世界都带着）
export function serializeCharacter(sv, deps) {
    return {
        name: sv.characterName || '幸存者',
        character: sv.character || null,
        inv: sv.inv,
        hotbar: sv.hotbar,
        curSlot: sv.curSlot,
        hp: sv.hp,
        maxHp: sv.maxHp,
        food: sv.food,
        water: sv.water,
        infection: sv.infection || 0,
        stamina: sv.stamina,
        maxStamina: sv.maxStamina,
        wpnMag: sv.wpn ? sv.wpn.mag : {},
        _devInfBag: !!sv._devInfBag,
    };
}

// 角色快照应用：物品/属性/外观/名字合并进 run（缺省保持默认值）
export function applyCharacter(run, data, deps) {
    if (!data || typeof data !== 'object') return;
    const B = deps.B;
    const BAG_SIZE = deps.BAG_SIZE;
    const HOTBAR_SIZE = deps.HOTBAR_SIZE;
    const PLAYER_INFECTION = deps.PLAYER_INFECTION;
    run.characterName = typeof data.name === 'string' && data.name ? data.name : '幸存者';
    run.character = deps.normalizeLook(data.character);
    if (Array.isArray(data.inv)) {
        const cap = (deps.saveData.devMode && data._devInfBag) ? data.inv.length : BAG_SIZE;
        run.inv = data.inv.slice(0, Math.max(cap, BAG_SIZE));
        while (run.inv.length < BAG_SIZE) run.inv.push(null);
    }
    if (Array.isArray(data.hotbar)) {
        run.hotbar = data.hotbar.slice(0, HOTBAR_SIZE);
        while (run.hotbar.length < HOTBAR_SIZE) run.hotbar.push(null);
    }
    run.curSlot = data.curSlot || 'ranged';
    if (typeof data.maxHp === 'number' && data.maxHp > 0) run.maxHp = data.maxHp;
    if (typeof data.maxStamina === 'number' && data.maxStamina > 0) run.maxStamina = data.maxStamina;
    // hp/stamina 上界用存档上限（主控 NPC 疾病/特质可能降低 maxHp/maxStamina，读档须还原）
    if (typeof data.hp === 'number') run.hp = Math.max(1, Math.min(data.maxHp || B.MAX_HP, data.hp));
    if (typeof data.food === 'number') run.food = Math.max(0, Math.min(B.HUNGER_MAX, data.food));
    if (typeof data.water === 'number') run.water = Math.max(0, Math.min(B.WATER_MAX, data.water));
    if (typeof data.infection === 'number') run.infection = Math.max(0, Math.min(PLAYER_INFECTION.max, data.infection));
    if (typeof data.stamina === 'number') run.stamina = Math.max(0, Math.min(data.maxStamina || run.maxStamina || B.MAX_HP, data.stamina));
    run._savedMag = data.wpnMag || null;
    run._devInfBag = !!data._devInfBag;
    // 死亡次数（遗物包裹永久消失代价：角色跨世界保留）
    run._deathCount = typeof data._deathCount === 'number' ? Math.max(0, Math.floor(data._deathCount)) : 0;
}

// 世界白名单（跟 seed 走：同一种子恢复同一世界状态）
export function serializeWorld(sv, deps) {
    return {
        seed: sv.world.seed,
        t: sv.t,
        day: sv.day,
        playT: sv.playT,
        mods: sv.mods,
        homeBed: sv.homeBed || null,
        lastRestDay: sv.lastRestDay,
        horde: sv.horde ? { phase: sv.horde.phase, pending: sv.horde.pending || 0, total: sv.horde.total || 0, batchT: sv.horde.batchT || 0 } : null,
        zombies: sv.zombies.map(z => ({
            id: z.id,   // 运行时 id（'zNNN'）：联机 wsync 按 id 合并；无 id 的旧档僵尸由 apply 端补
            type: z.type, char: z.char, color: z.color, name: z.name,
            x: z.x, y: z.y, tx: z.tx, ty: z.ty,
            hp: z.hp, maxHp: z.maxHp, speed: z.speed, damage: z.damage,
            horde: !!z.horde, vaulted: !!z.vaulted, _nightStrengthActive: !!z._nightStrengthActive,
            // 尸化玩家精英僵尸（死亡后留在世界）：继承名字/外观/装备/背包，重进世界可见可寻回
            isPlayerZombie: !!z.isPlayerZombie,
            playerName: z.playerName || null, skin: z.skin || null,
            inv: z.inv || null, hotbar: z.hotbar || null, wpnKey: z.wpnKey || null,
        })),
        npcs: deps.WNPC.serializeNpcs(sv),
        px: sv.px, py: sv.py, faceX: sv.faceX, faceY: sv.faceY,
        // 遗物包裹（正常模式死亡后原地包裹：位置 + 内容；重进世界恢复，拾取后清除）
        legacyDrop: sv._legacyDrop ? {
            x: sv._legacyDrop.x, y: sv._legacyDrop.y,
            contents: (sv.drops.find(d => d.id === 'loot:legacy') || {}).contents || null,
        } : null,
    };
}

// 世界快照应用：返回 { loaded, legacy }；loaded=false 时应开新世界
export function applyWorld(run, data, deps) {
    const B = deps.B;
    const out = { loaded: false, legacy: false };
    const canLoad = data && typeof data.seed === 'number' && !run.opts.forceNew;
    if (!canLoad) {
        if (data && data.tiles && !run.opts.forceNew) out.legacy = true;   // 极旧 tiles 结构
        return out;
    }
    try {
        run.world = { seed: data.seed, chunks: new Map() };
        run.mods = data.mods && data.mods.tiles ? data.mods : { tiles: {}, chests: {}, boxLoot: {} };
        if (!run.mods.chests) run.mods.chests = {};
        if (!run.mods.boxLoot) run.mods.boxLoot = {};
        if (typeof data.t === 'number') run.t = data.t;
        run.day = data.day || 1;
        if (typeof data.playT === 'number') run.playT = data.playT;
        run.lastRestDay = data.lastRestDay || 0;
        run.homeBed = data.homeBed || null;
        if (data.horde) {
            // L7：进行中的尸潮进度恢复（pending/total/batchT），旧布尔档兼容
            run.horde = typeof data.horde === 'object'
                ? { phase: data.horde.phase || 'wave', pending: data.horde.pending || 0, total: data.horde.total || 0, batchT: data.horde.batchT || 0 }
                : { phase: 'wave', pending: 0, total: 0, batchT: 0 };
        }
        if (Array.isArray(data.zombies)) {
            // 恢复时对缺失 id 的僵尸（旧档/室内未分配）补确定性 id：'w'+seed+'_'+下标，
            // 纯函数无副作用；前缀 'w' 与运行时自增 'zNNN'（sv._zIdSeq）不冲突，联机合并安全
            const wseed = data.seed;
            run.zombies = data.zombies.map((z, i) => ({
                ...z,
                id: z.id || ('w' + wseed + '_' + i),
                wt: 0, biteT: 0, hurt: 0, stunT: 0,
                atkState: null, atkT: 0, atkCd: 0, atkAngle: 0, atkWindup: 0, hasHit: false, auraT: 0, comboLeft: 0,
            }));
        }
        deps.WNPC.restoreNpcs(run, data.npcs || null);
        if (!data.npcs) deps.WNPC.spawnInitialNpcs(run);   // 无 NPC 数据：补初始 NPC
        if (typeof data.px === 'number') run.px = data.px;
        if (typeof data.py === 'number') run.py = data.py;
        if (typeof data.faceX === 'number') run.faceX = data.faceX;
        if (typeof data.faceY === 'number') run.faceY = data.faceY;
        if (data.legacyDrop && typeof data.legacyDrop.x === 'number') {
            run._legacyDrop = { x: data.legacyDrop.x, y: data.legacyDrop.y };
            // 恢复遗物包裹（drops 不随世界档保存，这里重建）
            if (Array.isArray(data.legacyDrop.contents) && data.legacyDrop.contents.length) {
                run.drops.push({ x: data.legacyDrop.x, y: data.legacyDrop.y, id: 'loot:legacy', n: 1, contents: data.legacyDrop.contents });
            }
        }
        out.loaded = true;
    } catch {
        run.world = null;
        out.loaded = false;
    }
    return out;
}

// ============================================================
// 4. 默认 deps 装配（浏览器侧使用）
//    环内模块在此处集中 import，wstate.js 本体保持无环依赖。
// ============================================================
export function defaultDeps() {
    // 注意：此处 import 的模块均为 survival.js 既已依赖者，不会引入新环。
    // 但为保持 wstate.js 在 node 单测下的纯净，defaultDeps() 仅在浏览器调用。
    throw new Error('defaultDeps() 仅供浏览器装配；node 单测请自行传入 deps 对象');
}

// ============================================================
// 3.6 联机轻量快照（wsync 100ms 白名单；不含 mods/tiles 大对象）
//    存档走 serializeWorld/serializeCharacter（含 tiles 差分），
//    联机实时快照只带实体与全局时钟，避免每包几 KB 的 tiles 传输。
// ------------------------------------------------------------
// 性能（卡顿排查 P0-3 / 同屏协同卡顿主因）：
//   cull 可选参数（由 survival.getMpSnapshot 按 host/guest 视野半径 34 格预裁剪）：
//     { drops?, effects?, bullets?, plants? } —— 已裁剪数组，缺省回退全量。
//   未裁剪前每次 wsync 全量带 ALL plants（Object.entries(sv.mods.plants)）+ 全部掉落
//   （≤150）+ 特效（≤50）+ 子弹（≤80），同屏协同时载荷达峰值，双端 JSON + GC 压力大。
// ============================================================
export function serializeMpSnapshot(sv, deps, zombieList, cull) {
    const zombies = zombieList || sv.zombies;   // 可选：host 端传入空间裁剪后的僵尸列表，减小 wsync 包体
    const drops = cull && cull.drops ? cull.drops : (sv.drops || []);
    const effects = cull && cull.effects ? cull.effects : (sv.effects || []);
    const bullets = cull && cull.bullets ? cull.bullets
        : (sv.bullets || []).filter(b => b._mpSyncable !== false);
    const plants = cull && cull.plants ? cull.plants
        : Object.entries(sv.mods.plants || {});
    return {
        t: sv.t,
        day: sv.day,
        hordePhase: sv.horde ? sv.horde.phase : null,
        weather: sv._weather || null,   // 天气（host 权威确定性；guest 端渲染同款）
        wxLevel: sv._wxLevel != null ? sv._wxLevel : null,   // dev 手动强度覆盖（host 权威 → 双端同档）
        announce: sv.announce ? { text: sv.announce.text, t: sv.announce.t, color: sv.announce.color || null } : null,   // 大字公告（天气切换提示等，host → guest）
        evt: sv._evt ? { type: sv._evt.type, endT: sv._evt.endT } : null,   // 随机事件（blackout 视觉同步）
        zombies: zombies.map(z => ({
            id: z.id, type: z.type, char: z.char, color: z.color, name: z.name,
            x: z.x, y: z.y,
            hp: z.hp, maxHp: z.maxHp, speed: z.speed, damage: z.damage,
            horde: !!z.horde, stunT: z.stunT || 0, hurt: z.hurt || 0, biteT: z.biteT || 0,
            textAbility: z.textAbility || null,
            slowT: z.slowT || 0, slowMul: z.slowMul || 0,   // 冰冻（视觉蓝 + 减速）
            packKingId: z.packKingId || null,   // 尸群跟随王（存 id，guest 端按 id 查回恢复跟随）
            isPlayerZombie: !!z.isPlayerZombie, playerName: z.playerName || null, skin: z.skin || null,
        })),
        effects: effects.map(e => ({
            kind: e.kind, x: e.x, y: e.y, life: e.life, maxLife: e.maxLife,
            radius: e.radius || 0, label: e.label || null, angle: e.angle || 0,
            tx: e.tx, ty: e.ty, color: e.color || null, ghosts: e.ghosts || null,
        })),
        bullets: bullets.map(b => ({
            id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
            range: b.range || 9999, damage: b.damage, color: b.color || null, label: b.label || null,
            life: b.life != null ? b.life : null, srcPlant: !!b.srcPlant, hostile: !!b.hostile,
            slow: b.slow || 0, slowDur: b.slowDur || 0, pierce: b.pierce || 0,
        })),
        drops: drops.map(d => ({
            x: d.x, y: d.y, id: d.id, n: d.n,
            contents: d.contents || null,      // loot: 袋内容（host 裁决随机）
        })),
        plants: plants.map(([key, p]) => ({
            key, hp: p.hp, maxHp: p.maxHp, species: p.species, growth: p.growth, type: p.type,
        })),
        // 开发者标志（双方共用：host 权威，任何一方 toggle → wsync 回传双端图标/效果一致）
        dev: {
            god: !!sv._devGod, stamina: !!sv._devInfStamina, inf: sv._devInf !== false,
            ammo: !!sv._devInfAmmo, oneshot: !!sv._devOneShot, bag: !!sv._devInfBag,
            dmgMul: sv._devDmgMul || 1, timeScale: sv._devTimeScale || 1,
        },
        // NPC 队伍各自本地管理（wsync 不同步 npcs，避免 host controllerId 覆盖 guest 主控）
    };
}

// ============================================================
// 3.7 联机僵尸合并（纯函数，Node 可单测）
//     applyMpSnapshot 的快照合并核心：同 id 保留本地对象（位置由 _tx/_ty 插值，
//     字段以快照为准），新 id 追加（补齐运行时字段），缺失 id 移除（host 权威删除）。
//     从 survival.js 抽出以便 smoke-test 直接断言合并语义（P0-3 联机协议层单测）。
// ============================================================
export function mergeZombieList(target, snapZombies) {
    if (!Array.isArray(target) || !Array.isArray(snapZombies)) return target;
    const prev = new Map(target.map(z => [z.id, z]));
    const merged = snapZombies.map(nz => {
        const old = prev.get(nz.id);
        if (old) {
            old._tx = nz.x; old._ty = nz.y;   // 插值目标（渲染帧 lerp）
            const ox = old.x, oy = old.y;
            Object.assign(old, nz);
            old.x = ox; old.y = oy;           // 保持旧位置，由 updateGuest lerp 平滑
            return old;
        }
        return { ...nz, wt: 0, tx: nz.x, ty: nz.y, atkState: null, atkT: 0, hurt: nz.hurt || 0, _tx: nz.x, _ty: nz.y };
    });
    return merged;
}
