// ============================================================
// 【无尽植僵荒原】模组 · 无限程序化荒原地图（城区/郊区/荒野/废墟）
// 世界由种子驱动：同一 seed + 同一区块坐标永远生成同样内容，
// 地形不进存档；存档只存 seed + 玩家修改记录（差分）。
// M-α：低频值噪声形成连片"区域"（城/郊/野/墟），资源/建筑密度按区画像。
// ============================================================

import { DISTRICTS, DISTRICT_KEYS, REGION_CELL } from './wbalance.js';
import { districtAt, arterialClassAt, arterialInfoAt, blockAt } from './wdistrict.js';

export const T = {
    GROUND: '.',   // 荒地（可通行）
    FLOOR: '·',    // 屋内地板（可通行）
    TREE: '木',    // 树（不可通行，F 伐木）
    WALL: '墙',    // 墙（不可通行）
    DOOR: '门',    // 门（不可通行，F 进出房屋）
    RUBBLE: '石',  // 碎石（不可通行）
    WATER: '水',   // 积水（不可通行，F 采集水）
    BOX: '箱',     // 箱子（不可通行，F 搜索）
    HERB: '草',    // 草药（可通行，F 采集）
    BED: '床',     // 床（不可通行，F 休息回血/存档点）
    FLOWER: '葵',  // 野生向日葵（可通行，F 采集阳光）
    CABINET: '柜', // 储物柜（不可通行，F 打开；仅玩家建造）
    SPROUT: '芽',  // 中立植物（不可通行，自动打僵尸；被攻击会反击）
    PLOT: '盆',    // 种植盆（不可通行，玩家建造，用于培养植物）
    CROP: '禾',    // 野外作物（可通行，F 采集食物）
    WEED: '艹',    // 野草（可通行，走过自动打碎，概率掉种子）
    WBOX: '武',    // 武器箱（不可通行，F 搜索：武器/弹药为主）
    MEDBOX: '医',  // 医疗箱（不可通行，F 搜索：草药/食物为主）
    MATBOX: '材',  // 建材箱（不可通行，F 搜索：木材/石块/零件为主）
    ROAD: '路',    // 公路（可通行，移动加速）
    SIDEWALK: '·', // 人行道（可通行，城区沿路两侧）
    CAR: '车',     // 汽车（不可通行，F 操作：大多损坏/少部分可修/极少完好可开）
    CARWRECK: '骸',// 汽车残骸（不可通行，掩护体）
    BARRICADE: '栏', // 路障（不可通行，可被攻击摧毁；撑杆僵尸可跳过）
    TRASHBIN: '桶', // 垃圾桶（不可通行，F 搜刮：少量杂物）
    CARDBOX: '盒',  // 纸箱（不可通行，F 搜刮：少量杂物）
    HYDRANT: '栓',  // 消防栓（不可通行，F 搜刮：少量水/零件）
    NEWSSTAND: '亭',// 报刊亭（不可通行，F 搜刮：少量杂物）
    TIRES: '胎',    // 废弃轮胎（不可通行，F 搜刮：零件；掩护体）
};

export const CHUNK = 16;   // 区块边长（格）

// 出生点：世界原点所在区块的中心（格坐标）
export const SPAWN = { x: 8, y: 8 };

// 主干道人行道保护环可以让行的"软地形"：只有荒野/植被等自然地物会被接管成人行道；
// 城市网格路、网格人行道、建筑墙体与容器一律保留，使主干道与街区形成自然路口而非把建筑切碎。
// 主干道主体（road）仍然切断一切，保证跨城公路连续。
const ARTERIAL_WALK_OVER = new Set([T.GROUND, T.TREE, T.HERB, T.FLOWER, T.SPROUT, T.CROP, T.WEED, T.WATER, T.RUBBLE]);

export function isWalk(t) {
    return t === T.GROUND || t === T.FLOOR || t === T.HERB || t === T.FLOWER || t === T.CROP || t === T.WEED || t === T.ROAD || t === T.SIDEWALK;
}

// ---------- 确定性哈希（同一种子同一坐标永远同值） ----------
export function hash2(seed, x, y) {
    let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export function newSeed() {
    return (Math.random() * 0x7fffffff) | 0;
}

// 区域查询：返回 0~3（城区/郊区/荒野/废墟），供渲染背景色等使用
export function chunkBiome(seed, cx, cy) {
    return DISTRICT_KEYS.indexOf(districtAt(seed, cx, cy));
}

// 某区块在某列/某行是否为网格公路带（南北向纵路 gx%BLOCK<4 / 东西向横路 gy%BLOCK<4）的纯函数。
// 城区 BLOCK=14、郊区 BLOCK=28。路带完整保留（不抽线），保证两侧人行道不缺。
function rawVerticalRoad(seed, gx, cx, cy) {
    const d = districtAt(seed, cx, cy);
    if (d !== 'urban' && d !== 'suburb' && d !== 'ruins') {
        // wild 区：纵向路带沿 y 方向延伸，跨区块时检查四邻（上下为主）是否有城市区块
        // 的路带（用邻区城市 BLOCK 判相位）——只要邻接城市，路带就延续完整宽度，
        // 避免城市路带跨区块边界时从 4 列被切成 1~2 列。
        const up = districtAt(seed, cx, cy - 1);
        const down = districtAt(seed, cx, cy + 1);
        const left = districtAt(seed, cx - 1, cy);
        const right = districtAt(seed, cx + 1, cy);
        const nearCity = (up === 'urban' || up === 'suburb' || up === 'ruins') ||
            (down === 'urban' || down === 'suburb' || down === 'ruins') ||
            (left === 'urban' || left === 'suburb' || left === 'ruins') ||
            (right === 'urban' || right === 'suburb' || right === 'ruins');
        if (!nearCity) return false;
        const BL = (up === 'urban' || up === 'suburb' || up === 'ruins') ? blockAt(seed, cx, cy - 1) :
            (down === 'urban' || down === 'suburb' || down === 'ruins') ? blockAt(seed, cx, cy + 1) :
            (left === 'urban' || left === 'suburb' || left === 'ruins') ? blockAt(seed, cx - 1, cy) : blockAt(seed, cx + 1, cy);
        return ((gx % BL) + BL) % BL < 4;
    }
    const BL = blockAt(seed, cx, cy);
    return ((gx % BL) + BL) % BL < 4;
}
function rawHorizontalRoad(seed, gy, cx, cy) {
    const d = districtAt(seed, cx, cy);
    if (d !== 'urban' && d !== 'suburb' && d !== 'ruins') {
        // wild 区：横向路带沿 x 方向延伸，跨区块时检查四邻是否有城市区块的路带
        // （用邻区城市 BLOCK 判相位）——横向路带从城市延伸进荒野保持 4 行完整宽度。
        const up = districtAt(seed, cx, cy - 1);
        const down = districtAt(seed, cx, cy + 1);
        const left = districtAt(seed, cx - 1, cy);
        const right = districtAt(seed, cx + 1, cy);
        const nearCity = (up === 'urban' || up === 'suburb' || up === 'ruins') ||
            (down === 'urban' || down === 'suburb' || down === 'ruins') ||
            (left === 'urban' || left === 'suburb' || left === 'ruins') ||
            (right === 'urban' || right === 'suburb' || right === 'ruins');
        if (!nearCity) return false;
        const BL = (up === 'urban' || up === 'suburb' || up === 'ruins') ? blockAt(seed, cx, cy - 1) :
            (down === 'urban' || down === 'suburb' || down === 'ruins') ? blockAt(seed, cx, cy + 1) :
            (left === 'urban' || left === 'suburb' || left === 'ruins') ? blockAt(seed, cx - 1, cy) : blockAt(seed, cx + 1, cy);
        return ((gy % BL) + BL) % BL < 4;
    }
    const BL = blockAt(seed, cx, cy);
    return ((gy % BL) + BL) % BL < 4;
}

// 网格路是否在 (gx,gy) 真正铺设——按"走廊"粒度判定，而非逐区块：
// 先找出包含该格的最长连续原始路段（走廊），只保留"第一个路口与最后一个路口之间"，
// 两端不收死腿（DEAD_LEG_EXT=0）：道路只存在于路口之间，尽头即路口，城市内不产生死路。
// 判定为纯函数，可跨区块使用。
const DEAD_LEG_EXT = 0;
const vSpanCache = new Map(); // seed:gx:cy -> [i1,ik]（保留的走廊行范围）或 null（整条走廊无路口）
const hSpanCache = new Map(); // seed:gy:cx -> [i1,ik]（保留的走廊列范围）或 null
function vCorridorSpan(seed, gx, cy) {
    const ck = seed + ':V:' + gx + ':' + cy;
    const hit = vSpanCache.get(ck);
    if (hit !== undefined) return hit;
    const cx = Math.floor(gx / CHUNK);
    let cTop = cy, cBot = cy;
    while (rawVerticalRoad(seed, gx, cx, cTop - 1)) cTop--;
    while (rawVerticalRoad(seed, gx, cx, cBot + 1)) cBot++;
    const u = cTop * CHUNK, l = cBot * CHUNK + CHUNK - 1;
    let i1 = null, ik = null;
    // 抽掉部分干线后路口间隔可能拉大（连续多条缺席），bounded 扫描放宽到 112 行
    for (let yy = u; yy <= l && yy < u + 112; yy++)
        if (rawHorizontalRoad(seed, yy, cx, Math.floor(yy / CHUNK))) { i1 = yy; break; }
    if (i1 !== null)
        for (let yy = l; yy >= i1 && yy > l - 112; yy--)
            if (rawHorizontalRoad(seed, yy, cx, Math.floor(yy / CHUNK))) { ik = yy; break; }
    const span = ik !== null ? [Math.max(u, i1 - DEAD_LEG_EXT), Math.min(l, ik + DEAD_LEG_EXT)] : null;
    // 只缓存查询块自身的走廊：走廊跨度取决于"从该块向两端扩展"的城市边界弧，
    // 若写成走廊内所有块，后查的块会命中先查块的错误跨度，导致世界地形依赖生成/探索顺序。
    if (vSpanCache.size > 60000) vSpanCache.clear();
    vSpanCache.set(ck, span);
    return span;
}
function hCorridorSpan(seed, gy, cx) {
    const ck = seed + ':H:' + gy + ':' + cx;
    const hit = hSpanCache.get(ck);
    if (hit !== undefined) return hit;
    const cy = Math.floor(gy / CHUNK);
    let cLft = cx, cRgt = cx;
    while (rawHorizontalRoad(seed, gy, cLft - 1, cy)) cLft--;
    while (rawHorizontalRoad(seed, gy, cRgt + 1, cy)) cRgt++;
    const u = cLft * CHUNK, l = cRgt * CHUNK + CHUNK - 1;
    let i1 = null, ik = null;
    for (let xx = u; xx <= l && xx < u + 112; xx++)
        if (rawVerticalRoad(seed, xx, Math.floor(xx / CHUNK), cy)) { i1 = xx; break; }
    if (i1 !== null)
        for (let xx = l; xx >= i1 && xx > l - 112; xx--)
            if (rawVerticalRoad(seed, xx, Math.floor(xx / CHUNK), cy)) { ik = xx; break; }
    const span = ik !== null ? [Math.max(u, i1 - DEAD_LEG_EXT), Math.min(l, ik + DEAD_LEG_EXT)] : null;
    if (hSpanCache.size > 60000) hSpanCache.clear();
    hSpanCache.set(ck, span);
    return span;
}
export function gridRoadKept(seed, gx, gy) {
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    if (rawVerticalRoad(seed, gx, cx, cy)) {
        const s = vCorridorSpan(seed, gx, cy);
        if (s && gy >= s[0] && gy <= s[1]) return true;
    }
    if (rawHorizontalRoad(seed, gy, cx, cy)) {
        const s = hCorridorSpan(seed, gy, cx);
        if (s && gx >= s[0] && gx <= s[1]) return true;
    }
    // 路带配对列（rx0↔rx3 同一条路带 4 列）：任一列在保留走廊内，其余列也保留。
    // 避免路带列跨区块边界时（如 rx0 在区块 A、rx3 在区块 B），两侧走廊判定
    // 不同导致路带只剩部分宽度、人行道带错位。
    const BL = blockAt(seed, cx, cy);
    const rx = ((gx % BL) + BL) % BL;
    if (rx < 4) {
        for (let k = 0; k < 4; k++) {
            if (k === rx) continue;
            const s2 = vCorridorSpan(seed, gx - rx + k, cy);
            if (s2 && gy >= s2[0] && gy <= s2[1]) return true;
        }
    }
    return false;
}

// 人行道带跟随"实际铺设的保留路走廊"（gridRoadKept）或主干道：
// 城市网格内部的路带保留 → 人行道带整条连续成带；路带被走廊裁掉的死腿处，
// 人行道一并收尾，不会在没有公路的绿地里单独生成人行道。
function hasAdjacentRoad(seed, gx, gy) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = gx + dx, ny = gy + dy;
        if (gridRoadKept(seed, nx, ny)) return true;
        if (arterialClassAt(seed, nx, ny) === 'road') return true;
    }
    return false;
}

// 主干道是否与保留网格路带"贴邻"：同轴路带（mod(r,BL)==0 起的连续 4 行/列）与本格路面带
// （[line-2, line+1]）重叠或只隔 1 行（路带起始行 ∈ [line-7, line+3]）→ 让行，避免拼出宽路。
// 隔 2 行以上（中间隔着人行道/草地）算两条独立马路，主干道照常铺设。
// 该判定按单格做，路带走廊裁掉的死腿段自然放行（主干道仍在那里正常铺设）。
// 废墟残路带相位判定：ruins 区 rx<4||ry<4 的格属于残路带（路面），主干道环带不接管。
export function ruinsRoadBand(seed, gx, gy) {
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    if (districtAt(seed, cx, cy) !== 'ruins') return false;
    const BL = blockAt(seed, cx, cy);
    const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
    return rx < 4 || ry < 4;
}

function arterialMergesGrid(seed, gx, gy, info) {
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    // 主干道穿荒野必须无条件铺设——否则 gridRoadKept 的"路带配对列"跨区块扩展
    // 会把 wild 格误判为保留路带，导致让行后主干道带空洞断连。
    if (districtAt(seed, cx, cy) === 'wild') return false;
    const BL = blockAt(seed, cx, cy);
    // 只对"本格自身落在保留网格路带内"的格让行：网格路带实际只铺 rx/ry<4 的相位，
    // 主干道带伸出网格路带的部分（off=-2 边缘）必须照铺，否则产生空洞断连。
    if (info.axis === 'h') {
        const ry = ((gy % BL) + BL) % BL;
        return ry < 4 && gridRoadKept(seed, gx, gy);
    } else {
        const rx = ((gx % BL) + BL) % BL;
        return rx < 4 && gridRoadKept(seed, gx, gy);
    }
}

// 城市规划保护层：兼容旧存档/旧区块。道路两侧的人行道不会被原生建筑、树木或旧地形差分覆盖。
// 废墟（工业区残城）同样纳入：人行道带地面始终保留，碎石等障碍物只作为上层叠加。
export function plannedSidewalkAt(seed, gx, gy) {
    if (arterialClassAt(seed, gx, gy) === 'sidewalk') {
        // 人行道环只在荒野/植被等软地形上接管；保留网格路带让行（与生成一致），
        // 环压住真实公路时不得误报为规划人行道（否则车/渲染会把路面当步道）。
        if (gridRoadKept(seed, gx, gy)) return false;
        return true;
    }
    if (arterialClassAt(seed, gx, gy) === 'road') return false;   // 主干道优先：其路面不属于人行道带
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    const dKey = districtAt(seed, cx, cy);
    if (dKey !== 'urban' && dKey !== 'suburb' && dKey !== 'ruins') return false;
    const block = blockAt(seed, cx, cy);
    const rx = ((gx % block) + block) % block;
    const ry = ((gy % block) + block) % block;
    const walkX = rx === 4 || rx === block - 1;
    const walkY = ry === 4 || ry === block - 1;
    const roadX = rx < 4, roadY = ry < 4;
    if (roadX || roadY || !(walkX || walkY)) return false;
    return hasAdjacentRoad(seed, gx, gy);
}

export function plannedArterialAt(seed, gx, gy) {
    return arterialClassAt(seed, gx, gy);
}

// ---------- 区块生成（纯函数：seed + 区块坐标 → 16×16 地块） ----------
function buildHouse(tiles, H, seed, cx, cy, idx) {
    const gx0 = cx * CHUNK, gy0 = cy * CHUNK;
    const dKey = districtAt(seed, cx, cy);
    // 所有建筑（城区/郊区/废墟）统一遵循建筑规则：避开公路带(r<2)与人行道带(r==2/r==BLOCK-1)。
    // 废墟保留大型废弃建筑尺寸，但同样只在街区内部带落位，不再直接出现在残路上。
    const isGrid = dKey === 'urban' || dKey === 'suburb' || dKey === 'ruins';
    const BLOCK = blockAt(seed, cx, cy);
    // 街区内部带：避开公路(r<4)与人行道(r==4 / r==BLOCK-1)，建筑不得压路、压人行道。
    const bandBuildable = v => { const r = ((v % BLOCK) + BLOCK) % BLOCK; return r >= 5 && r <= BLOCK - 2; };
    let w, h, x0, y0;
    if (isGrid) {
        const big = dKey === 'ruins';
        w = big ? 9 + Math.floor(H(30 + idx, cx, cy) * 3) : 5 + Math.floor(H(30 + idx, cx, cy) * 4);   // 废墟9~11 / 城区5~8
        h = big ? 7 + Math.floor(H(40 + idx, cx, cy) * 2) : 5 + Math.floor(H(40 + idx, cx, cy) * 3);   // 废墟7~8 / 城区5~7
        const candX = [], candY = [];
        for (let x = 0; x + w <= CHUNK; x++) {
            let ok = true;
            for (let xx = x; xx < x + w; xx++) if (!bandBuildable(gx0 + xx)) { ok = false; break; }
            if (ok) candX.push(x);
        }
        for (let y = 0; y + h <= CHUNK; y++) {
            let ok = true;
            for (let yy = y; yy < y + h; yy++) if (!bandBuildable(gy0 + yy)) { ok = false; break; }
            if (ok) candY.push(y);
        }
        if (!candX.length || !candY.length) return;   // 本区块放不下不压路的建筑则跳过
        // 组合避让主干道人行道环：建筑矩形整体不得压到规划人行道（主干道环让行建筑 → 改为建筑避让环）
        const arterialSafe = (x, y) => {
            for (let yy = y; yy < y + h; yy++)
                for (let xx = x; xx < x + w; xx++)
                    if (plannedArterialAt(seed, gx0 + xx, gy0 + yy) === 'sidewalk') return false;
            return true;
        };
        // 楼间距约束：新建筑与已有墙体的间距只能是 0（贴合合并成 L/连体）或 ≥2，
        // 禁止恰好 1 格的楼缝——1 格缝渲染成幽闭暗巷，视觉上突兀且难以通行。
        // 注：仅约束本区块内（跨区块 1 格缝为小概率残留，生成时看不到邻区块）。
        const gapSafe = (x, y) => {
            for (let yy = Math.max(0, y - 1); yy < Math.min(CHUNK, y + h + 1); yy++)
                for (let xx = Math.max(0, x - 1); xx < Math.min(CHUNK, x + w + 1); xx++) {
                    if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue;   // 矩形内部（允许贴合/相交）
                    const tv = tiles[yy * CHUNK + xx];
                    if (tv === T.WALL || tv === T.DOOR) return false;
                }
            return true;
        };
        // 贴合判定：新矩形四邻存在既有墙体（降级时优先贴合，合并成连体建筑群而非造 1 格缝）
        const touchesWall = (x, y) => {
            for (let xx = x; xx < x + w; xx++) {
                if (y > 0 && (tiles[(y - 1) * CHUNK + xx] === T.WALL)) return true;
                if (y + h < CHUNK && (tiles[(y + h) * CHUNK + xx] === T.WALL)) return true;
            }
            for (let yy = y; yy < y + h; yy++) {
                if (x > 0 && (tiles[yy * CHUNK + x - 1] === T.WALL)) return true;
                if (x + w < CHUNK && (tiles[yy * CHUNK + x + w] === T.WALL)) return true;
            }
            return false;
        };
        // 落位得分：候选顺序按哈希旋转后逐个试，三级降级——
        // ① 避主干道环 + 无 1 格缝；② 避环 + 贴合既有建筑；③ 仅避环（兜底，罕见）
        const candList = [];
        for (let a = 0; a < candX.length; a++) {
            const cx2 = candX[(Math.floor(H(50 + idx, cx, cy) * candX.length) + a) % candX.length];
            for (let b = 0; b < candY.length; b++) {
                const cy2 = candY[(Math.floor(H(60 + idx, cx, cy) * candY.length) + b) % candY.length];
                if (arterialSafe(cx2, cy2)) candList.push([cx2, cy2]);
            }
        }
        let placed = null;
        for (const [px, py] of candList) if (gapSafe(px, py)) { placed = { x: px, y: py }; break; }
        if (!placed) for (const [px, py] of candList) if (touchesWall(px, py)) { placed = { x: px, y: py }; break; }
        if (!placed && candList.length) placed = { x: candList[0][0], y: candList[0][1] };
        if (!placed) return;   // 全部候选都压主干道环则跳过
        x0 = placed.x;
        y0 = placed.y;
    } else {
        w = 9 + Math.floor(H(30 + idx, cx, cy) * 3);        // 9~11（荒野无网格，buildDensity=0 实际不调用）
        h = 7 + Math.floor(H(40 + idx, cx, cy) * 2);        // 7~8
        x0 = 1 + Math.floor(H(50 + idx, cx, cy) * Math.max(1, CHUNK - w - 2));
        y0 = 1 + Math.floor(H(60 + idx, cx, cy) * Math.max(1, CHUNK - h - 2));
    }
    // 允许多个矩形相交形成L形、十字形和连接式建筑；渲染层按最终连通轮廓计算屋脊。
    for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) {
            tiles[y * CHUNK + x] = T.WALL;
        }
    // 检测各边是否紧邻道路/人行道（靠路边门概率更高）
    const isRoad = (x, y) => {
        if (x < 0 || x >= CHUNK || y < 0 || y >= CHUNK) return false;
        const t = tiles[y * CHUNK + x];
        return t === T.ROAD || t === T.SIDEWALK;
    };
    const roadS = isRoad(x0 + Math.floor(w / 2), y0 + h);
    const roadN = isRoad(x0 + Math.floor(w / 2), y0 - 1);
    const roadW = isRoad(x0 - 1, y0 + Math.floor(h / 2));
    const roadE = isRoad(x0 + w, y0 + Math.floor(h / 2));
    let hasDoor = false;
    // 南门：靠马路80%，非靠路45%
    const southRoll = H(70 + idx, cx, cy);
    const southChance = roadS ? 0.80 : 0.45;
    if (southRoll < southChance) {
        const dx = x0 + 2 + Math.floor(H(71 + idx, cx, cy) * (w - 4));
        tiles[(y0 + h - 1) * CHUNK + dx] = T.DOOR;
        hasDoor = true;
    }
    // 侧门：靠马路侧概率75%，非靠路侧35%
    const sideDoorRoll = H(80 + idx, cx, cy);
    if (roadW && sideDoorRoll < 0.75) {
        const sy = y0 + 2 + Math.floor(H(81 + idx, cx, cy) * (h - 4));
        tiles[sy * CHUNK + x0] = T.DOOR;
        hasDoor = true;
    } else if (roadE && sideDoorRoll < 0.75) {
        const sy = y0 + 2 + Math.floor(H(81 + idx, cx, cy) * (h - 4));
        tiles[sy * CHUNK + x0 + w - 1] = T.DOOR;
        hasDoor = true;
    } else if (!roadW && !roadE && sideDoorRoll < 0.35) {
        const sy = y0 + 2 + Math.floor(H(81 + idx, cx, cy) * (h - 4));
        if (sideDoorRoll < 0.17) tiles[sy * CHUNK + x0] = T.DOOR;
        else tiles[sy * CHUNK + x0 + w - 1] = T.DOOR;
        hasDoor = true;
    }
    // 北门：靠马路侧概率60%，非靠路侧25%
    const backDoorRoll = H(82 + idx, cx, cy);
    const backChance = roadN ? 0.60 : 0.25;
    if (backDoorRoll < backChance) {
        const bx = x0 + 2 + Math.floor(H(83 + idx, cx, cy) * (w - 4));
        tiles[y0 * CHUNK + bx] = T.DOOR;
        hasDoor = true;
    }
    // 保底：至少一个门（如果随机全没中，强制开南门）
    if (!hasDoor) {
        const dx = x0 + 2 + Math.floor(H(84 + idx, cx, cy) * (w - 4));
        tiles[(y0 + h - 1) * CHUNK + dx] = T.DOOR;
    }
}

export function genChunkTiles(seed, cx, cy) {
    const tiles = new Array(CHUNK * CHUNK).fill(T.GROUND);
    const dKey = districtAt(seed, cx, cy);
    const prof = DISTRICTS[dKey];
    const gx0 = cx * CHUNK, gy0 = cy * CHUNK;
    const H = (salt, x, y) => hash2(seed ^ salt, x, y);

    // ── 建筑（城区/郊区/废墟按 buildDensity 生成；荒野不生成） ──
    if (prof.buildDensity > 0 && (cx !== 0 || cy !== 0)) {
        const maxH = dKey === 'urban' ? 3 : (dKey === 'ruins' ? 1 : 2);
        let nh = 0;
        for (let i = 0; i < maxH; i++) {
            if (H(21 + i, cx, cy) < prof.buildDensity * (i === 0 ? 1 : 0.5)) nh++;
        }
        for (let i = 0; i < nh; i++) buildHouse(tiles, H, seed, cx, cy, i);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
            if (tiles[ly * CHUNK + lx] !== T.DOOR) continue;
            const hasOpen = (
                (ly > 0 && tiles[(ly - 1) * CHUNK + lx] !== T.WALL && tiles[(ly - 1) * CHUNK + lx] !== T.DOOR) ||
                (ly < CHUNK - 1 && tiles[(ly + 1) * CHUNK + lx] !== T.WALL && tiles[(ly + 1) * CHUNK + lx] !== T.DOOR) ||
                (lx > 0 && tiles[ly * CHUNK + lx - 1] !== T.WALL && tiles[ly * CHUNK + lx - 1] !== T.DOOR) ||
                (lx < CHUNK - 1 && tiles[ly * CHUNK + lx + 1] !== T.WALL && tiles[ly * CHUNK + lx + 1] !== T.DOOR)
            );
            if (!hasOpen) tiles[ly * CHUNK + lx] = T.WALL;
        }
        // 多栋矩形后生成时可能覆盖先生成建筑的门。最终按连通建筑复核，
        // 每个独立屋体至少保留一个真正位于外墙、外侧可通行的入口。
        const visited = new Set();
        const isBuilding = (x, y) => x >= 0 && x < CHUNK && y >= 0 && y < CHUNK &&
            (tiles[y * CHUNK + x] === T.WALL || tiles[y * CHUNK + x] === T.DOOR);
        const outsideScore = (x, y) => {
            if (x < 0 || x >= CHUNK || y < 0 || y >= CHUNK) return 0;
            const t = tiles[y * CHUNK + x];
            if (t === T.ROAD) return 4;
            if (t === T.SIDEWALK) return 3;
            return isBuilding(x, y) ? 0 : 1;
        };
        for (let sy = 0; sy < CHUNK; sy++) for (let sx = 0; sx < CHUNK; sx++) {
            const startKey = sx + ',' + sy;
            if (visited.has(startKey) || !isBuilding(sx, sy)) continue;
            const queue = [[sx, sy]], component = [];
            visited.add(startKey);
            for (let qi = 0; qi < queue.length; qi++) {
                const [x, y] = queue[qi];
                component.push([x, y]);
                for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                    const key = nx + ',' + ny;
                    if (!visited.has(key) && isBuilding(nx, ny)) {
                        visited.add(key);
                        queue.push([nx, ny]);
                    }
                }
            }
            if (component.some(([x, y]) => tiles[y * CHUNK + x] === T.DOOR)) continue;
            const candidates = [];
            for (const [x, y] of component) {
                for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
                    const score = outsideScore(x + dx, y + dy);
                    if (score > 0) candidates.push({ x, y, score, tie: H(0xD007, cx * CHUNK + x, cy * CHUNK + y) });
                }
            }
            candidates.sort((a, b) => b.score - a.score || a.tie - b.tie);
            if (candidates.length) tiles[candidates[0].y * CHUNK + candidates[0].x] = T.DOOR;
        }
        // 清理无入口的孤立小墙组（<4 格，多为门被覆盖/建筑交叠残片）：恢复为草地。
        // 否则这些残片会被渲染成"棕色瓦砾块"突兀在街区中间（像室内地板碎片）。
        const cleared = new Set();
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
            if (tiles[ly * CHUNK + lx] !== T.WALL) continue;
            const startKey = lx + ',' + ly;
            if (cleared.has(startKey)) continue;
            const comp = [], queue = [[lx, ly]], seen = new Set([startKey]);
            for (let qi = 0; qi < queue.length; qi++) {
                const [x, y] = queue[qi];
                comp.push([x, y]);
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= CHUNK || ny < 0 || ny >= CHUNK) continue;
                    const k = nx + ',' + ny;
                    if (!seen.has(k) && tiles[ny * CHUNK + nx] === T.WALL) { seen.add(k); queue.push([nx, ny]); }
                }
            }
            if (comp.length < 4) {
                for (const [x, y] of comp) { cleared.add(x + ',' + y); tiles[y * CHUNK + x] = T.GROUND; }
            }
        }
    }

    // ── 荒野林中小屋：稀疏偶发（约 2.5% 荒野区块），5×5 木屋，像沙漠绿洲般罕见 ──
    // 避让主干道带（road 路面 + 两侧人行道环）：跨城公路穿荒野时不能被小屋截断/压环。
    // 注意：位置不合法只跳过小屋本身，绝不能 return 整个区块（会跳过主干道铺设）。
    if (dKey === 'wild' && (cx !== 0 || cy !== 0) && H(0x5C31, cx, cy) < 0.025) {
        const hx = 5 + Math.floor(H(0x5C33, cx, cy) * 3);   // 5..7，保证 5×5 落在区块内
        const hy = 5 + Math.floor(H(0x5C34, cx, cy) * 3);
        let ok = true;
        for (let yy = hy; yy < hy + 5 && ok; yy++) for (let xx = hx; xx < hx + 5; xx++) {
            if (tiles[yy * CHUNK + xx] !== T.GROUND) { ok = false; break; }
            const gxx = gx0 + xx, gyy = gy0 + yy;
            const ai = plannedArterialAt(seed, gxx, gyy);
            if (ai === 'road' || ai === 'sidewalk') { ok = false; break; }   // 压主干道带 → 不放小屋
        }
        if (ok) {
            for (let yy = hy; yy < hy + 5; yy++) for (let xx = hx; xx < hx + 5; xx++)
                tiles[yy * CHUNK + xx] = T.WALL;
            tiles[(hy + 4) * CHUNK + hx + 2] = T.DOOR;   // 南墙中间开门
        }
    }

    // ── 空地散布：按区域画像缩放资源密度（resMul）；箱子按区域分型且密度大幅降低 ──
    const rm = prof.resMul;
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        if (tiles[ly * CHUNK + lx] !== T.GROUND) continue;
        const gx = gx0 + lx, gy = gy0 + ly;
        let t = T.GROUND;

        if (dKey === 'wild') {
            // 邻接城市/郊区/废墟的路带延续：wild 区保持完整 4 格宽路面
            // （避免城市路带跨区块被切成 1~2 列窄路）。
            const ai = arterialInfoAt(seed, gx, gy);
            if (ai.cls === 'road') {
                t = T.ROAD;   // 主干道带：主干道统一铺设
            } else if (ai.cls === 'sidewalk') {
                t = T.SIDEWALK;   // 主干道环带：规划为人行道，不能铺路
            } else if (rawVerticalRoad(seed, gx, cx, cy) || rawHorizontalRoad(seed, gy, cx, cy)) {
                t = T.ROAD;
            } else {
                const r = H(11, gx, gy);
                if (r < 0.15) t = T.TREE;
                else if (r < 0.15 + 0.0025 * rm) t = T.HERB;
                else if (r < 0.15 + 0.0060 * rm) t = T.FLOWER;
                else if (r < 0.15 + 0.0070 * rm) t = T.SPROUT;
                else if (r < 0.15 + 0.0080 * rm) t = T.BOX;
                if (t === T.GROUND && H(12, Math.floor(gx / 3), Math.floor(gy / 3)) < 0.06) t = T.WATER;
                if (t === T.GROUND && prof.crops && H(16, gx, gy) < 0.007) t = T.CROP;
            }
        } else if (dKey === 'ruins') {
            // 废墟继承城市网格路带（残路）：路带格铺设 ROAD（带破损碎石），人行道带残缺破损
            const BLOCK = blockAt(seed, cx, cy);
            const rx = ((gx % BLOCK) + BLOCK) % BLOCK, ry = ((gy % BLOCK) + BLOCK) % BLOCK;
            const roadBand = rx < 4 || ry < 4;
            const walkBand = rx === 4 || rx === BLOCK - 1 || ry === 4 || ry === BLOCK - 1;
            if (roadBand) {
                // 废墟公路：路面始终保留为公路（叠加态），破损由碎石坑承担；
                // 残路（gridRoadKept=false）同样保持路面色调，不插人行道、不长树，
                // 避免"树长在公路中间 / 公路中间冒出一道人行道"的突兀视觉。
                // 主干道带避让：跨城公路（arterial road）由主干道统一铺设，残路带
                // 不再叠加——否则城市↔废墟交界处主干道 4 格 + 残路带整行拼接成
                // 8~13 格宽的巨宽马路。主干道环带（sidewalk）同理由后面统一接管。
                const ai = arterialInfoAt(seed, gx, gy);
                if (ai.cls === 'road') {
                    // 主干道带：残路带让行，交主干道统一铺设（避免 8 格宽拼接）
                    t = T.ROAD;
                } else {
                    // 其余（含主干道环带压到残路带）：残路带本身是路面（rx<4||ry<4），
                    // 环带不接管——否则路口被铺成人行道封死、路面被切成 1 格宽。
                    const br = H(0xE1A1, gx, gy);
                    if (gridRoadKept(seed, gx, gy)) {
                        if (br < 0.12) t = T.RUBBLE;
                        else t = T.ROAD;
                    } else {
                        if (br < 0.20) t = T.RUBBLE;
                        else t = T.ROAD;
                    }
                }
            } else if (walkBand && hasAdjacentRoad(seed, gx, gy)) {
                // 废墟人行道：地面始终保留为人行道（叠加态，下层路面不缺失），
                // 残破感由上层碎石堆承担，不再把路面挖成草地。
                const bw = H(0xE2A2, gx, gy);
                if (bw < 0.16) t = T.RUBBLE;
                else t = T.SIDEWALK;
            } else {
                const r = H(13, gx, gy);
                const bt = H(15, gx, gy);
                // 紧邻人行道带的内侧一圈（r==5/r==BL-2）不生成树，避免树冠盖住人行道边缘；
                // 建筑区内部不再散生树（避免建筑中间出现突兀的树/棕色块），只留碎石/箱子/草药
                const nearWalk = (rx === 5 || rx === BLOCK - 2) || (ry === 5 || ry === BLOCK - 2);
                if (r < 0.09) t = T.RUBBLE;
                else if (r < 0.11) t = T.WALL;
                else if (r < 0.11 + 0.010 * rm) t = bt < 0.55 ? T.WBOX : (bt < 0.85 ? T.MATBOX : T.BOX);
                else if (r < 0.11 + 0.011 * rm) t = T.HERB;
                else if (r < 0.11 + 0.013 * rm) t = T.SPROUT;
            }
        } else {
            // 城区/郊区：街道网格（路 4 格宽 + 人行道 + 行道树 + 建筑区）；BLOCK 按所在城市变化
            const BLOCK = blockAt(seed, cx, cy);
            const rx = ((gx % BLOCK) + BLOCK) % BLOCK, ry = ((gy % BLOCK) + BLOCK) % BLOCK;
            // 双车道两侧都必须有人行道；人行道和树线之间留一格缓冲，避免树冠遮住整条步道。
            const bandX = rx < 4 ? 'road' : ((rx === 4 || rx === BLOCK - 1) ? 'walk' : ((rx === 6 || rx === BLOCK - 3) ? 'tree' : 'in'));
            const bandY = ry < 4 ? 'road' : ((ry === 4 || ry === BLOCK - 1) ? 'walk' : ((ry === 6 || ry === BLOCK - 3) ? 'tree' : 'in'));
            const onRoad = bandX === 'road' || bandY === 'road';
            const onSidewalk = bandX === 'walk' || bandY === 'walk';
            const onTreeLine = bandX === 'tree' || bandY === 'tree';

            if (onRoad) {
                // 路带格总是铺路（无论 gridRoadKept）：路带宽度恒定 4 格，走廊外
                // 也保持完整路面——否则路带在走廊外只剩 1~2 列（rx0-1），其余列
                // 变成树/草，出现"1 格宽公路 + 两侧人行道"的误判。
                // 走廊外不延伸死腿由 gridRoadKept 的走廊范围控制（见 vCorridorSpan）。
                t = T.ROAD;
                const rr = H(18, gx, gy);
                if (rr < 0.006 && dKey === 'urban') t = T.CAR;
                else if (rr < 0.012) t = T.BARRICADE;
            } else if (onSidewalk && hasAdjacentRoad(seed, gx, gy)) {
                t = T.SIDEWALK;
        } else if (onTreeLine) {
            const streetTreeChance = dKey === 'urban' ? 0.12 : 0.28;
            // 树冠会溢出到相邻格：树线带靠近纵/横人行道带的端部格（r==5/r==BL-2）
            // 不生成树，避免树冠盖住人行道带边缘。
            const nearWalk = (rx === 5 || rx === BLOCK - 2) || (ry === 5 || ry === BLOCK - 2);
            if (!nearWalk && H(17, gx, gy) < streetTreeChance) t = T.TREE;
        } else {
            // 建筑区内部：箱子/草药/空地（不再散生树，避免建筑中间出现突兀的树/棕色块；
            // 行道树只保留在路边的树线带 onTreeLine）
            // 紧邻人行道带的内侧一圈（r==5/r==BL-2）保持空地，
            // 避免箱子/草药贴着路边。
            const nearWalk = (rx === 5 || rx === BLOCK - 2) || (ry === 5 || ry === BLOCK - 2);
            const r = H(14, gx, gy);
            if (!nearWalk) {
                const bt = H(15, gx, gy);
                const boxC = 0.007 * rm + 0.003;
                if (r < boxC) {
                    if (dKey === 'urban') t = bt < 0.45 ? T.BOX : (bt < 0.80 ? T.WBOX : T.MEDBOX);
                    else t = bt < 0.50 ? T.BOX : (bt < 0.80 ? T.MATBOX : T.MEDBOX);
                }
                else if (r < boxC + 0.0015 * rm) t = T.HERB;
            }
        }
        }

        tiles[ly * CHUNK + lx] = t;
    }

    // 道路是城市规划的硬约束，生成顺序不能让房屋覆盖道路或十字路口。
    // 在所有建筑和资源之后重铺道路保护带，将被矩形建筑穿过的部分裁回道路/人行道。
    if (dKey === 'urban' || dKey === 'suburb') {
        const BLOCK = blockAt(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
            const gx = gx0 + lx, gy = gy0 + ly;
            const rx = ((gx % BLOCK) + BLOCK) % BLOCK, ry = ((gy % BLOCK) + BLOCK) % BLOCK;
            const roadX = rx < 4, roadY = ry < 4;
            const walkX = rx === 4 || rx === BLOCK - 1;
            const walkY = ry === 4 || ry === BLOCK - 1;
            if ((roadX || roadY) && gridRoadKept(seed, gx, gy)) {
                let roadTile = T.ROAD;
                const rr = H(18, gx, gy);
                if (rr < 0.006 && dKey === 'urban') roadTile = T.CAR;
                else if (rr < 0.012) roadTile = T.BARRICADE;
                tiles[ly * CHUNK + lx] = roadTile;
            } else if ((walkX || walkY) && hasAdjacentRoad(seed, gx, gy)) {
                tiles[ly * CHUNK + lx] = T.SIDEWALK;
            }
        }

        // 道路裁切可能把原本相连的复合房屋分成两栋，再做一次最终入口保底。
        const finalVisited = new Set();
        const finalIsBuilding = (x, y) => x >= 0 && x < CHUNK && y >= 0 && y < CHUNK &&
            (tiles[y * CHUNK + x] === T.WALL || tiles[y * CHUNK + x] === T.DOOR);
        for (let sy = 0; sy < CHUNK; sy++) for (let sx = 0; sx < CHUNK; sx++) {
            const startKey = sx + ',' + sy;
            if (finalVisited.has(startKey) || !finalIsBuilding(sx, sy)) continue;
            const queue = [[sx, sy]], component = [], candidates = [];
            finalVisited.add(startKey);
            for (let qi = 0; qi < queue.length; qi++) {
                const [x, y] = queue[qi];
                component.push([x, y]);
                for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                    const key = nx + ',' + ny;
                    if (!finalVisited.has(key) && finalIsBuilding(nx, ny)) {
                        finalVisited.add(key);
                        queue.push([nx, ny]);
                    }
                }
            }
            let minX = CHUNK, maxX = -1, minY = CHUNK, maxY = -1;
            for (const [x, y] of component) {
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }
            const width = maxX - minX + 1, height = maxY - minY + 1;
            // 建筑最小规格 5×5：被道路切割后占地不足 5×5 的房屋整体移除。
            if (width < 5 || height < 5) {
                for (const [x, y] of component) tiles[y * CHUNK + x] = T.GROUND;
                continue;
            }

            const streetCandidates = [], fallbackCandidates = [];
            let hasDoor = false, hasStreetDoor = false;
            for (const [x, y] of component) {
                if (tiles[y * CHUNK + x] === T.DOOR) hasDoor = true;
                for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
                    const ox = x + dx, oy = y + dy;
                    if (ox < 0 || ox >= CHUNK || oy < 0 || oy >= CHUNK || finalIsBuilding(ox, oy)) continue;
                    const outside = tiles[oy * CHUNK + ox];
                    const street = outside === T.ROAD || outside === T.SIDEWALK || outside === T.CAR || outside === T.BARRICADE;
                    if (tiles[y * CHUNK + x] === T.DOOR && street) hasStreetDoor = true;
                    const score = outside === T.ROAD ? 5 : (outside === T.SIDEWALK ? 4 : ((outside === T.CAR || outside === T.BARRICADE) ? 2 : 1));
                    const candidate = { x, y, score, tie: H(0xD117, gx0 + x, gy0 + y) };
                    fallbackCandidates.push(candidate);
                    if (street) streetCandidates.push(candidate);
                }
            }

            // 临街建筑大多数（86%）至少有一个朝向公路/人行道的入口，可保留已有后门或侧门。
            if (!hasStreetDoor && streetCandidates.length && H(0xD086, gx0 + minX, gy0 + minY) < 0.86) {
                streetCandidates.sort((a, b) => b.score - a.score || a.tie - b.tie);
                const chosen = streetCandidates[0];
                tiles[chosen.y * CHUNK + chosen.x] = T.DOOR;
                hasDoor = true;
            }
            if (hasDoor) continue;
            for (const [x, y] of component) for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
                const ox = x + dx, oy = y + dy;
                if (ox < 0 || ox >= CHUNK || oy < 0 || oy >= CHUNK || finalIsBuilding(ox, oy)) continue;
                const outside = tiles[oy * CHUNK + ox];
                const score = outside === T.ROAD ? 4 : (outside === T.SIDEWALK ? 3 : 1);
                candidates.push({ x, y, score, tie: H(0xD117, gx0 + x, gy0 + y) });
            }
            candidates.sort((a, b) => b.score - a.score || a.tie - b.tie);
            if (candidates.length) tiles[candidates[0].y * CHUNK + candidates[0].x] = T.DOOR;
        }
    }

    // 主干道最后覆盖本地支路与区域边界，避免城区人行道或废墟地形截断跨城公路。
    // 公路主体（road）无条件连通；人行道环只在荒野/植被等软地形上铺设，
    // 遇到城市网格路、网格人行道和建筑时让行，避免把街区切成错乱的碎片。
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        const gx = gx0 + lx, gy = gy0 + ly;
        const info = arterialInfoAt(seed, gx, gy);
        if (info.cls === 'road') {
            // 与平行保留网格路带重叠/贴邻（1 格间隙内）时让行：该区以网格路带为准，
            // 主干道不再叠加铺设，避免与本地支路拼出 >4 格宽的马路（路口交叉不受影响）。
            if (!arterialMergesGrid(seed, gx, gy, info)) tiles[ly * CHUNK + lx] = T.ROAD;
        } else if (info.cls === 'sidewalk' && !gridRoadKept(seed, gx, gy) && !ruinsRoadBand(seed, gx, gy) && ARTERIAL_WALK_OVER.has(tiles[ly * CHUNK + lx])) {
            // 人行道环：只在荒野/植被等软地形上接管；保留网格路带与废墟残路带
            // （rx<4||ry<4 的路带格）一律不覆盖——否则残路带被切成 1 格宽、
            // 十字路口被铺成人行道封死。
            tiles[ly * CHUNK + lx] = T.SIDEWALK;
        }
    }

    // 公路裁开房屋后清除狭长屋顶残条；孤立废墟墙块保留，只处理至少3格的建筑残片。
    // 该逻辑只为城市/废墟的公路裁切服务，荒野没有网格公路，村落农舍等小型建筑不受影响。
    if (dKey !== 'wild') {
    const fragmentVisited = new Set();
    const fragmentBuilding = (x, y) => x >= 0 && x < CHUNK && y >= 0 && y < CHUNK &&
        (tiles[y * CHUNK + x] === T.WALL || tiles[y * CHUNK + x] === T.DOOR);
    for (let sy = 0; sy < CHUNK; sy++) for (let sx = 0; sx < CHUNK; sx++) {
        const key = sx + ',' + sy;
        if (fragmentVisited.has(key) || !fragmentBuilding(sx, sy)) continue;
        const queue = [[sx, sy]], cells = [];
        fragmentVisited.add(key);
        for (let qi = 0; qi < queue.length; qi++) {
            const [x, y] = queue[qi]; cells.push([x, y]);
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                const nk = nx + ',' + ny;
                if (!fragmentVisited.has(nk) && fragmentBuilding(nx, ny)) {
                    fragmentVisited.add(nk); queue.push([nx, ny]);
                }
            }
        }
        if (cells.length < 3) continue;
        const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
        const width = Math.max(...xs) - Math.min(...xs) + 1;
        const height = Math.max(...ys) - Math.min(...ys) + 1;
        if (width < 5 || height < 5) {
            for (const [x, y] of cells) tiles[y * CHUNK + x] = T.GROUND;
        }
    }

    // 修剪建筑边缘的1格宽突出条带：公路裁切复合建筑残留的细长手指、恰好贴墙的废墟散墙、
    // 以及凸出一格的门廊，都会被渲染层连通识别并进屋顶，看起来像矩形建筑多出一块。2格宽
    // 以上的实心建筑每格都有≥2个建筑邻居，绝不误删；只有1格宽条带才有"末端仅一个建筑邻居"
    // 的墙格。悬挂的门也会撑住一段凸起，因此：建筑还有别的门就直接删掉这个凸出门，若是唯一
    // 门则先转回墙让修剪把它吃掉。反复迭代直到稳定（上限CHUNK轮足以削完任何区内长条），把
    // 残指一路缩回主体。独立废墟残骸（连通<4）不受影响。
    for (let pass = 0; pass < CHUNK; pass++) {
        const tipVisited = new Set();
        const deletes = [], toWall = [];
        for (let sy = 0; sy < CHUNK; sy++) for (let sx = 0; sx < CHUNK; sx++) {
            const key = sx + ',' + sy;
            if (tipVisited.has(key) || !fragmentBuilding(sx, sy)) continue;
            const queue = [[sx, sy]], cells = [];
            tipVisited.add(key);
            for (let qi = 0; qi < queue.length; qi++) {
                const [x, y] = queue[qi]; cells.push([x, y]);
                for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                    const nk = nx + ',' + ny;
                    if (!tipVisited.has(nk) && fragmentBuilding(nx, ny)) {
                        tipVisited.add(nk); queue.push([nx, ny]);
                    }
                }
            }
            if (cells.length < 4) continue;
            let doorCount = 0;
            for (const [x, y] of cells) if (tiles[y * CHUNK + x] === T.DOOR) doorCount++;
            for (const [x, y] of cells) {
                let wallN = 0;
                for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                    if (fragmentBuilding(nx, ny)) wallN++;
                }
                if (wallN > 1) continue;
                if (tiles[y * CHUNK + x] === T.WALL) deletes.push([x, y]);
                else if (doorCount >= 2) deletes.push([x, y]);
                else toWall.push([x, y]);   // 唯一门先转墙，下一轮会被当作悬挂墙削掉
            }
        }
        if (!deletes.length && !toWall.length) break;
        for (const [x, y] of deletes) tiles[y * CHUNK + x] = T.GROUND;
        for (const [x, y] of toWall) tiles[y * CHUNK + x] = T.WALL;
    }

    // 修剪可能连带删掉某栋建筑唯一的门，给最终仍无入口的建筑补一个位置正常的门（朝向路侧优先）。
    const restoreVisited = new Set();
    for (let sy = 0; sy < CHUNK; sy++) for (let sx = 0; sx < CHUNK; sx++) {
        const key = sx + ',' + sy;
        if (restoreVisited.has(key) || !fragmentBuilding(sx, sy)) continue;
        const queue = [[sx, sy]], cells = [];
        restoreVisited.add(key);
        for (let qi = 0; qi < queue.length; qi++) {
            const [x, y] = queue[qi]; cells.push([x, y]);
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                const nk = nx + ',' + ny;
                if (!restoreVisited.has(nk) && fragmentBuilding(nx, ny)) {
                    restoreVisited.add(nk); queue.push([nx, ny]);
                }
            }
        }
        if (cells.length < 4) continue;
        if (cells.some(([x, y]) => tiles[y * CHUNK + x] === T.DOOR)) continue;
        const choices = [];
        for (const [x, y] of cells) {
            if (tiles[y * CHUNK + x] !== T.WALL) continue;
            for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
                const ox = x + dx, oy = y + dy;
                if (ox < 0 || ox >= CHUNK || oy < 0 || oy >= CHUNK || fragmentBuilding(ox, oy)) continue;
                const outside = tiles[oy * CHUNK + ox];
                const score = outside === T.ROAD ? 5 : (outside === T.SIDEWALK ? 4 : ((outside === T.CAR || outside === T.BARRICADE) ? 2 : 1));
                choices.push({ x, y, score, tie: H(0xD009, gx0 + x, gy0 + y) });
            }
        }
        choices.sort((a, b) => b.score - a.score || a.tie - b.tie);
        if (choices.length) tiles[choices[0].y * CHUNK + choices[0].x] = T.DOOR;
    }
    }

    const weedC = { urban: 0.012, suburb: 0.055, wild: 0.14, ruins: 0.075 }[dKey] || 0.08;
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        if (tiles[ly * CHUNK + lx] !== T.GROUND) continue;
        const gx = gx0 + lx, gy = gy0 + ly;
        if (H(17, gx, gy) < weedC) tiles[ly * CHUNK + lx] = T.WEED;
    }

    // 街道杂物：按现实逻辑排布（确定性放置）——报刊亭在路口转角、消防栓沿路边、
    // 垃圾桶在路边/建筑旁、纸箱/废弃轮胎散落；块边缘格不放置（避免跨块邻格判断）
    if (dKey === 'urban' || dKey === 'suburb') {
        const junkRate = dKey === 'urban' ? 0.06 : 0.04;
        const roadLike = v => v === T.ROAD || v === T.CAR || v === T.BARRICADE;
        const bldLike = v => v === T.WALL || v === T.DOOR;
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
            if (tiles[ly * CHUNK + lx] !== T.SIDEWALK) continue;
            if (lx === 0 || lx === CHUNK - 1 || ly === 0 || ly === CHUNK - 1) continue;
            const gx = gx0 + lx, gy = gy0 + ly;
            if (H(0x177E7, gx, gy) >= junkRate) continue;
            const tL = tiles[ly * CHUNK + (lx - 1)], tR = tiles[ly * CHUNK + (lx + 1)];
            const tU = tiles[(ly - 1) * CHUNK + lx], tD = tiles[(ly + 1) * CHUNK + lx];
            // 门前一格不放置街道杂物：避免垃圾桶/纸箱等挡在建筑门口
            if (tL === T.DOOR || tR === T.DOOR || tU === T.DOOR || tD === T.DOOR) continue;
            const hzRoad = roadLike(tL) || roadLike(tR), vtRoad = roadLike(tU) || roadLike(tD);
            const nearRoad = hzRoad || vtRoad;
            const nearBld = bldLike(tL) || bldLike(tR) || bldLike(tU) || bldLike(tD);
            const rj = H(0x2C4D, gx, gy);
            let type;
            if (hzRoad && vtRoad) {                 // 路口转角：报刊亭/消防栓优先
                type = rj < 0.35 ? T.NEWSSTAND :
                    rj < 0.55 ? T.HYDRANT :
                        rj < 0.75 ? T.TRASHBIN :
                            rj < 0.88 ? T.CARDBOX : T.TIRES;
            } else if (nearRoad) {                  // 沿路边：消防栓靠路缘、垃圾桶/报刊亭、纸箱/轮胎
                type = rj < 0.20 ? T.HYDRANT :
                    rj < 0.45 ? T.TRASHBIN :
                        rj < 0.60 ? T.NEWSSTAND :
                            rj < 0.80 ? T.CARDBOX : T.TIRES;
            } else if (nearBld) {                   // 建筑旁：垃圾桶/纸箱为主
                type = rj < 0.40 ? T.TRASHBIN :
                    rj < 0.72 ? T.CARDBOX :
                        rj < 0.86 ? T.TIRES :
                            rj < 0.94 ? T.HYDRANT : T.NEWSSTAND;
            } else {                                // 人行道内部：纸箱/轮胎散落
                type = rj < 0.45 ? T.CARDBOX :
                    rj < 0.70 ? T.TIRES :
                        rj < 0.88 ? T.TRASHBIN :
                            rj < 0.95 ? T.HYDRANT : T.NEWSSTAND;
            }
            tiles[ly * CHUNK + lx] = type;
        }
    }

    // 物品去密集化：同类物品（树/草药/花/幼苗/资源箱/街道杂物）不得 4 邻相邻，
    // 密集处保留先放置的，其余还原为草地（街道杂物还原为人行道）。
    const DENSE_ITEMS = new Set([
        T.TREE, T.HERB, T.FLOWER, T.SPROUT, T.CROP,
        T.BOX, T.WBOX, T.MEDBOX, T.MATBOX,
        T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES,
    ]);
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        const t = tiles[ly * CHUNK + lx];
        if (!DENSE_ITEMS.has(t)) continue;
        let dup = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = lx + dx, ny = ly + dy;
            if (nx < 0 || nx >= CHUNK || ny < 0 || ny >= CHUNK) continue;
            if (tiles[ny * CHUNK + nx] === t) { dup = true; break; }
        }
        if (dup) {
            tiles[ly * CHUNK + lx] =
                (t === T.TRASHBIN || t === T.CARDBOX || t === T.HYDRANT || t === T.NEWSSTAND || t === T.TIRES)
                    ? T.SIDEWALK : T.GROUND;
        }
    }

    // 去密集化可能把主干道人行道环上的格还原成草地，补铺环（只接管软地形，与主铺设一致）。
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        const gx = gx0 + lx, gy = gy0 + ly;
        if (arterialClassAt(seed, gx, gy) === 'sidewalk' && ARTERIAL_WALK_OVER.has(tiles[ly * CHUNK + lx]))
            tiles[ly * CHUNK + lx] = T.SIDEWALK;
    }

    // 人行道带连续性补铺（城区/郊区/废墟）：带内格只要与保留路贴邻、或与已铺步道相邻，
    // 就补成人行道并迭代扩散——消除"郊区人行道断带/缺失"（路稀疏区人行道带不再变成草地，
    // 建筑间、路带死腿旁的人行道缺口都收口成连续步道）。
    // 注意：只补"规划层承认"的格（plannedSidewalkAt：walk 带内且 8 邻含保留路/主干道），
    // 防止补铺从路缘一路蔓延进绿地生成"无邻路的孤儿人行道"（实测旧逻辑 5 轮扩散可跑进
    // 绿地 5 格，产生断头人行道）。
    if (dKey === 'urban' || dKey === 'suburb' || dKey === 'ruins') {
        const BL = blockAt(seed, cx, cy);
        const inWalkBand = (gx, gy) => {
            const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
            if (rx < 4 || ry < 4) return false;   // 路带不补
            return rx === 4 || rx === BL - 1 || ry === 4 || ry === BL - 1;
        };
        for (let pass = 0; pass < 5; pass++) {
            let changed = false;
            for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
                if (tiles[ly * CHUNK + lx] !== T.GROUND) continue;
                const gx = gx0 + lx, gy = gy0 + ly;
                if (!inWalkBand(gx, gy)) continue;
                if (!plannedSidewalkAt(seed, gx, gy)) continue;   // 规划层不承认 → 不蔓延
                let near = false;
                for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = gx + dx, ny = gy + dy;
                    const nlx = nx - gx0, nly = ny - gy0;
                    if (nlx < 0 || nlx >= CHUNK || nly < 0 || nly >= CHUNK) continue;
                    const nt = tiles[nly * CHUNK + nlx];
                    if (nt === T.SIDEWALK) { near = true; break; }
                    if (nt === T.ROAD || gridRoadKept(seed, nx, ny) || arterialClassAt(seed, nx, ny) === 'road') { near = true; break; }
                }
                if (near) { tiles[ly * CHUNK + lx] = T.SIDEWALK; changed = true; }
            }
            if (!changed) break;
        }
    }

    // 出生点：区块 (0,0) 中心 7×7 清理为空地（保留路/人行道/建筑，只清软地形与资源），
    // 清理同样尊重城市规划层：网格路带与规划人行道（含主干道环）不被挖成草地。
    if (cx === 0 && cy === 0) {
        for (let y = SPAWN.y - 3; y <= SPAWN.y + 3; y++)
            for (let x = SPAWN.x - 3; x <= SPAWN.x + 3; x++) {
                const t = tiles[y * CHUNK + x];
                if (t === T.ROAD || t === T.SIDEWALK || t === T.WALL || t === T.DOOR) continue;
                const gx = gx0 + x, gy = gy0 + y;
                if (gridRoadKept(seed, gx, gy)) { tiles[y * CHUNK + x] = T.ROAD; continue; }
                if (plannedSidewalkAt(seed, gx, gy)) { tiles[y * CHUNK + x] = T.SIDEWALK; continue; }
                tiles[y * CHUNK + x] = T.GROUND;
            }
    }
    return tiles;
}

// 从区块地块推导门数据（屋内侧 = 相邻地板格，屋外侧 = 对侧；返回全局格坐标）
export function deriveChunkDoors(tiles, cx, cy) {
    const doors = [];
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (let ly = 1; ly < CHUNK - 1; ly++) for (let lx = 1; lx < CHUNK - 1; lx++) {
        if (tiles[ly * CHUNK + lx] !== T.DOOR) continue;
        for (const [dx, dy] of dirs) {
            if (tiles[(ly + dy) * CHUNK + (lx + dx)] === T.FLOOR) {
                doors.push({
                    x: cx * CHUNK + lx, y: cy * CHUNK + ly,
                    inn: { x: cx * CHUNK + lx + dx, y: cy * CHUNK + ly + dy },
                    out: { x: cx * CHUNK + lx - dx, y: cy * CHUNK + ly - dy },
                });
                break;
            }
        }
    }
    return doors;
}

// ============================================================
// 世界访问层（挂在 sv 上：sv.world = { seed, chunks:Map }，sv.mods = { tiles, chests }）
// 修改记录：tiles { "gx,gy": { t, built? } }——built 标记玩家自造建筑（可拆除）；
// chests { "gx,gy": [12 格物品] }——储物柜内容
// ============================================================
export function chunkOf(sv, cx, cy) {
    const key = cx + ',' + cy;
    let ch = sv.world.chunks.get(key);
    if (!ch) {
        ch = { tiles: genChunkTiles(sv.world.seed, cx, cy) };
        sv.world.chunks.set(key, ch);
    }
    return ch;
}

export function getTile(sv, gx, gy) {
    const m = sv.mods.tiles[gx + ',' + gy];
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    const ch = chunkOf(sv, cx, cy);
    if (!m) {
        // 未被玩家改动的格：区块生成时已完成所有网格路/人行道/主干道的铺设、保护层与让行逻辑，
        // 直接读取即可，无需每帧重跑 plannedArterialAt/plannedSidewalkAt（后者需遍历8邻格走廊判定）。
        return ch.tiles[(gy - cy * CHUNK) * CHUNK + (gx - cx * CHUNK)];
    }
    if (m.built) return m.t;   // 玩家自造建筑优先
    // 车/残骸 tile 同样优先返回：车可停在主干道/人行道（渲染/存档不再消失），停车点才能保持原位
    if (m.t === T.CAR || m.t === T.CARWRECK) return m.t;
    // 玩家改动（非建造）的格：城市规划保护层恢复道路/人行道，不允许挖断或覆盖。
    const seed = sv.world.seed;
    const arterial = plannedArterialAt(seed, gx, gy);
    if (arterial === 'road') return T.ROAD;
    if (arterial === 'sidewalk') {
        // 人行道环只接管荒野/植被等软地形；遇到网格路、建筑时让行，
        // 保持"公路→人行道→建筑"的层次，不把城市街区切成错乱碎片。
        const base = ch.tiles[(gy - cy * CHUNK) * CHUNK + (gx - cx * CHUNK)];
        return (base === T.SIDEWALK || ARTERIAL_WALK_OVER.has(base)) ? T.SIDEWALK : base;
    }
    if (plannedSidewalkAt(seed, gx, gy)) return T.SIDEWALK;
    return m.t;
}

// 玩家改动地形（built=1 表示自造建筑，可拆除返还材料）
export function setTile(sv, gx, gy, t, built) {
    const key = gx + ',' + gy;
    sv.mods.tiles[key] = built ? { t, built: 1 } : { t };
    // 联机：任何一端的世界修改都上报（host 广播给 guest、guest 上报 host，双向 wdiff）
    if (sv.mp) {
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'diff', key, tile: sv.mods.tiles[key] });
    }
    // 地形变化会改变僵尸的共享寻路场；延迟到下一帧统一重算。
    sv._zombiePathRevision = (sv._zombiePathRevision || 0) + 1;
}

// 停车/残骸落点搜索（车辆与报废残骸共用）：候选格 + 右邻格都须可走、
// 无车/残骸/路障；车/残骸 tile 已不受城市规划还原（getTile 直接返回），
// 停在主干道/人行道上也能正常渲染与存档，故不再排除保护层；6 格环形搜索，找不到则原地。
export function findCarParkSpot(sv, gx, gy, carDirFn) {
    // 第二格朝向由 carDirFn 注入（wvehicle.carDirAt 按种子+坐标确定性推算；world 是叶子层
    // 不能反向 import wvehicle，用依赖注入避免成环——L12）。缺省按水平右方（旧行为）
    const spotFree = (x, y) => {
        const t = getTile(sv, x, y);
        if (t === T.CAR || t === T.CARWRECK || t === T.BARRICADE) return false;
        const ad = carDirFn ? carDirFn(sv.world.seed, x, y) : 0;
        const fx = Math.round(Math.cos(ad)), fy = Math.round(Math.sin(ad));
        const t2 = getTile(sv, x + fx, y + fy);
        if (t2 === T.CAR || t2 === T.CARWRECK || t2 === T.BARRICADE) return false;
        return isWalk(t) && isWalk(t2);
    };
    if (spotFree(gx, gy)) return { x: gx, y: gy };
    for (let r = 1; r <= 6; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (spotFree(gx + dx, gy + dy)) return { x: gx + dx, y: gy + dy };
        }
    }
    return { x: gx, y: gy };
}

// 自造建筑记录（可拆除）；原生建筑返回 null
export function builtAt(sv, gx, gy) {
    const m = sv.mods.tiles[gx + ',' + gy];
    return m && m.built ? m : null;
}

// 找门：对门所在区块（应用修改记录后）现推 deriveChunkDoors
export function findDoor(sv, gx, gy) {
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    const base = chunkOf(sv, cx, cy).tiles.slice();
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
        const m = sv.mods.tiles[(cx * CHUNK + lx) + ',' + (cy * CHUNK + ly)];
        if (m) base[ly * CHUNK + lx] = m.t;
    }
    return deriveChunkDoors(base, cx, cy).find(d => d.x === gx && d.y === gy) || null;
}

// 区块卸载：远离玩家的区块从内存移除（修改已在 mods 里，重生成时恢复）
export function purgeChunks(sv, TS) {
    const pcx = Math.floor(sv.px / TS / CHUNK), pcy = Math.floor(sv.py / TS / CHUNK);
    for (const key of sv.world.chunks.keys()) {
        const [cx, cy] = key.split(',').map(Number);
        if (Math.abs(cx - pcx) > 8 || Math.abs(cy - pcy) > 8) sv.world.chunks.delete(key);
    }
}
