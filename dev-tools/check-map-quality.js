// ============================================================
// 地图质量体检：检查三类问题
// 1) 人行道缺失：plannedSidewalkAt 为真但实际格不是人行道（或街道容器/车/残骸/资源箱等合法叠加物）
// 2) 马路过宽：非路口格的路面横断面宽度 > 4 格（路口 = 5×5 邻域内存在十字结构即豁免）
// 3) 建筑间"地板感"方块：两栋建筑只隔一格的地面格（渲染成硬质后巷，像人行道但无碰撞体）
// 用法：node dev-tools/check-map-quality.js [seed ...]
// ============================================================

import { genChunkTiles, T, CHUNK, gridRoadKept, plannedSidewalkAt } from '../source-code/mod-wasteland/world.js';
import { arterialClassAt, arterialInfoAt, districtAt } from '../source-code/mod-wasteland/wdistrict.js';

// 真实路面：公路/车/路障/残骸。废墟碎石与倒树是叠在路面或步道上的障碍物。
// 可合法立于人行道/规划环上的叠加物：街道容器、车/残骸、废墟碎石、资源箱
const ROAD_LIKE = new Set([T.ROAD, T.CAR, T.BARRICADE, T.CARWRECK]);
const SIDEWALK_OK = new Set([T.SIDEWALK, T.TRASHBIN, T.CARDBOX, T.HYDRANT, T.NEWSSTAND, T.TIRES, T.CAR, T.CARWRECK, T.RUBBLE, T.BOX, T.WBOX, T.MEDBOX, T.MATBOX]);
const BUILDING = new Set([T.WALL, T.DOOR]);

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(20260802, 12345, 987654321);

let tiles = null;

function loadTiles(seed, c0, c1) {
    tiles = new Map();
    for (let cy = c0; cy <= c1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
            const t = genChunkTiles(seed, cx, cy);
            for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
                tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
        }
}

function tileAt(gx, gy) {
    return tiles.get(gx + ',' + gy);
}

// 某格是否属于"下层真实路面"：废墟碎石/倒树若脚下是保留路带或主干道，也算路面
// （障碍是上层叠加，不切断路带连续性与宽度）。
function isRoadSurface(seed, gx, gy) {
    const v = tileAt(gx, gy);
    if (ROAD_LIKE.has(v)) return true;
    if (v === T.RUBBLE || v === T.TREE) {
        if (gridRoadKept(seed, gx, gy)) return true;
        if (arterialClassAt(seed, gx, gy) === 'road') return true;
    }
    return false;
}

for (const seed of seeds) {
    console.log(`\n========== seed ${seed} ==========`);
    const C = 64;   // 扫描 128×128 区块 ≈ 2048×2048 格，覆盖 9 城 + 全部主干道
    loadTiles(seed, -C, C - 1);
    const L = -C * CHUNK, H = C * CHUNK;

    // ---- 1) 人行道缺失 ----
    let sidewalkPlan = 0, sidewalkGap = 0, gapSamples = [];
    for (let gy = L; gy < H; gy++) {
        for (let gx = L; gx < H; gx++) {
            if (!plannedSidewalkAt(seed, gx, gy)) continue;
            sidewalkPlan++;
            const t = tileAt(gx, gy);
            if (BUILDING.has(t)) continue;   // 建筑可合法立于规划环内
            if (!SIDEWALK_OK.has(t)) {
                sidewalkGap++;
                if (gapSamples.length < 12) gapSamples.push(`(${gx},${gy}) 实际=${t === T.GROUND ? '草地' : String(t)} 邻路=${neighborRoad(gx, gy) ? '是' : '否'} arterial=${arterialClassAt(seed, gx, gy)}`);
            }
        }
    }
    console.log(`[人行道] 规划 ${sidewalkPlan} 格，缺失 ${sidewalkGap} 格${gapSamples.length ? '\n  ' + gapSamples.join('\n  ') : ''}`);

    // ---- 2) 马路过宽：非路口格的路面横断面宽度 >4。
    // 宽度只数纯 ROAD 格（车/路障/残骸/碎石/倒树是叠在路上的物体，不延伸路面、不切断测量）。
    // 路口豁免：5×5 邻域内存在十字结构（任一中心偏移处横/纵各 ≥3 连续路）即视为路口——
    // 路口中央的路障/车会截断单点测量，旧判定 hBand≥8 && vBand≥8 把这种路口误报成超宽。
    // 废墟（工业区残城）路面允许破损/缺角，不参与本项。 ----
    const roadOnly = (gx, gy) => tileAt(gx, gy) === T.ROAD;
    const run = (gx, gy, dx, dy, cap) => {
        let n = 0;
        while (n < cap && roadOnly(gx - dx * (n + 1), gy - dy * (n + 1))) n++;
        return n;
    };
    // 十字路口检测：5×5 邻域内任一中心，横/纵各 ≥3 连续纯路（可含被截断的路口核心）
    const isIntersection = (gx, gy) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            let h = 0, v = 0;
            for (let i = -2; i <= 2; i++) {
                if (roadOnly(gx + dx + i, gy + dy)) h++;
                if (roadOnly(gx + dx, gy + dy + i)) v++;
            }
            if (h >= 3 && v >= 3) return true;
        }
        return false;
    };
    let roadCount = 0, overWide = 0, wideSamples = [];
    for (let gy = L; gy < H; gy++) {
        for (let gx = L; gx < H; gx++) {
            if (!roadOnly(gx, gy)) continue;
            roadCount++;
            const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
            if (districtAt(seed, cx, cy) === 'ruins') continue;   // 废墟破损容差
            const dL = run(gx, gy, 1, 0, 64), dR = run(gx, gy, -1, 0, 64);
            const dU = run(gx, gy, 0, 1, 64), dD = run(gx, gy, 0, -1, 64);
            const hBand = dL + dR + 1, vBand = dU + dD + 1;
            if (hBand >= 8 && vBand >= 8) continue;   // 快速路径：明显十字/丁字路口
            const width = Math.min(hBand, vBand);
            if (width > 4 && !isIntersection(gx, gy)) {
                overWide++;
                if (wideSamples.length < 12) wideSamples.push(`(${gx},${gy}) 方向=${hBand >= vBand ? '横' : '纵'} 宽=${width} 邻路格=${sampleNeighbors(gx, gy)}`);
            }
        }
    }
    console.log(`[路宽] 路面格 ${roadCount}，超宽格 ${overWide}${wideSamples.length ? '\n  ' + wideSamples.join('\n  ') : ''}`);

    // ---- 3) 建筑间地板感方块 ----
    let alley = 0, alleySamples = [];
    for (let gy = L + 1; gy < H - 1; gy++) {
        for (let gx = L + 1; gx < H - 1; gx++) {
            const t = tileAt(gx, gy);
            if (t !== T.GROUND && t !== T.WEED) continue;
            const U = tileAt(gx, gy - 1), D = tileAt(gx, gy + 1);
            const Lft = tileAt(gx - 1, gy), Rgt = tileAt(gx + 1, gy);
            if ((BUILDING.has(U) && BUILDING.has(D)) || (BUILDING.has(Lft) && BUILDING.has(Rgt))) {
                alley++;
                if (alleySamples.length < 12) alleySamples.push(`(${gx},${gy}) 上下建筑=${BUILDING.has(U) && BUILDING.has(D) ? '是' : '否'} 左右建筑=${BUILDING.has(Lft) && BUILDING.has(Rgt) ? '是' : '否'} 邻路=${neighborRoad(gx, gy) ? '是' : '否'}`);
            }
        }
    }
    console.log(`[建筑间] 地板感地面格 ${alley}${alleySamples.length ? '\n  ' + alleySamples.join('\n  ') : ''}`);

    // ---- 主干道断面校验：路面恒 4 格 + 两侧各 1 格人行道环 ----
    // 期望：off ∈ {-2,-1,0,1} → road；off ∈ {-3,2} → sidewalk；off ∈ {-4,3} → null
    const probeAxis = (axis) => {
        let probes = 0, bad = 0;
        for (let i = 0; i < 2000 && probes < 8; i++) {
            const gx = L + ((i * 977) % (H - L)), gy = L + ((i * 1399) % (H - L));
            const info = arterialInfoAt(seed, gx, gy);
            if (info.cls !== 'road' || info.axis !== axis) continue;
            const line = info.line;
            const coords = [];
            for (let o = -4; o <= 3; o++) coords.push(axis === 'h' ? [gx, line + o] : [line + o, gy]);
            // 断面内所有点必须属于同一条主干道（同轴同线，远离折点/其它干道）
            if (!coords.every(([x, y]) => {
                const c = arterialInfoAt(seed, x, y);
                return c.axis === axis && c.line === line;
            })) continue;
            const expect = o => (o >= -2 && o <= 1) ? 'road' : ((o >= -3 && o <= 2) ? 'sidewalk' : null);
            let ok = true;
            for (let o = -4; o <= 3; o++) {
                const [x, y] = coords[o + 4];
                if (arterialClassAt(seed, x, y) !== expect(o)) { ok = false; break; }
            }
            if (ok) probes++;
            else bad++;
        }
        return { probes, bad };
    };
    const hProbe = probeAxis('h'), vProbe = probeAxis('v');
    const arteryBad = hProbe.bad + vProbe.bad;
    console.log(`[主干道] 水平断面取样 ${hProbe.probes} 处 / 垂直断面取样 ${vProbe.probes} 处，断面异常 ${arteryBad} 处（路面应恒 4 格 + 两侧环各 1 格）`);

    // 汇总
    console.log(`汇总: 人行道缺失=${sidewalkGap}  超宽路格=${overWide}  建筑间地面格=${alley}  主干道断面异常=${arteryBad}`);
}

function neighborRoad(gx, gy) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = tileAt(gx + dx, gy + dy);
        if (t === T.ROAD || t === T.CAR || t === T.BARRICADE) return true;
    }
    return false;
}

function sampleNeighbors(gx, gy) {
    const names = [];
    for (let dy = -2; dy <= 2; dy++) {
        let row = '';
        for (let dx = -2; dx <= 2; dx++) {
            const t = tileAt(gx + dx, gy + dy);
            row += t === T.ROAD ? '路' : t === T.CAR ? '车' : t === T.BARRICADE ? '栏' : t === T.SIDEWALK ? '人' : t === T.WALL || t === T.DOOR ? '墙' : t === T.TREE ? '树' : t === T.RUBBLE ? '石' : '·';
        }
        names.push(row);
    }
    return names.join('/');
}
