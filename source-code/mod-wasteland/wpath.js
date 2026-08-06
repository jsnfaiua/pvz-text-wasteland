// ============================================================
// 【无尽植僵荒原】模组 · 通用 A* 寻路工具（8 方向 + octile 启发式）
// 设计原则：
//  1. 只注入 canStand(x,y)（像素坐标）判定可走性，不直接读 tile —— 僵尸/NPC/玩家各传各的判定
//  2. astarField：以起点反向展开到目标集合，返回共享 parent 表（多实体追同一目标时一次搜索服务全员）
//  3. astarPath：单点寻路，返回格路径（新功能直接用）
//  4. 标准 A*：gScore 更新 + 懒删除（lazy deletion），保证路径最优，与 Dijkstra 结果一致
//  5. 启发式 octile 为 8 方向代价（正交10/对角14）的一致下界 → 可采纳 → 保证最短
// ============================================================

export const A_DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function gridKey(gx, gy) { return gx + ',' + gy; }

// octile 启发式：|dx|=|dy| 时走对角（14/步），否则直行（10/步），是真实代价的下界
export function octile(gx, gy, tx, ty) {
    const dx = Math.abs(gx - tx), dy = Math.abs(gy - ty);
    const m = Math.min(dx, dy);
    return 10 * (dx + dy) - 6 * m;   // 14*m + 10*(max-m) = 10*(dx+dy) - 6*m
}

// 多目标包围盒启发式下界：到"所有目标的外接盒"的 octile 距离。
// 任意目标都在盒内，盒外距离 ≤ 到最近目标的真实距离 → 可采纳且 O(1)/次
function boxHeuristic(gx, gy, box) {
    if (!box) return 0;
    const dx = gx < box.minX ? box.minX - gx : (gx > box.maxX ? gx - box.maxX : 0);
    const dy = gy < box.minY ? box.minY - gy : (gy > box.maxY ? gy - box.maxY : 0);
    const m = Math.min(dx, dy);
    return 10 * (dx + dy) - 6 * m;
}

// 二叉堆（最小堆），条目 [f, g, x, y]
class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(e) {
        const a = this.a; a.push(e);
        let i = a.length - 1;
        for (; i > 0;) {
            const p = (i - 1) >> 1;
            if (a[p][0] <= e[0]) break;
            a[i] = a[p]; i = p;
        }
        a[i] = e;
    }
    pop() {
        const a = this.a, top = a[0], last = a.pop();
        if (a.length) {
            let i = 0;
            while (i * 2 + 1 < a.length) {
                let c = i * 2 + 1;
                if (c + 1 < a.length && a[c + 1][0] < a[c][0]) c++;
                if (a[c][0] >= last[0]) break;
                a[i] = a[c]; i = c;
            }
            a[i] = last;
        }
        return top;
    }
}

/**
 * 反向流场 A*：从起点 (sx,sy) 展开，直到覆盖目标集合 targets（Set of "x,y" 字符串）。
 * 返回 { parent: Map<key,{gx,gy}>, reachable: Set<key> } —— parent 指向"朝起点走一步"的格，
 * 实体在任意 reachable 格时查 parent 即得下一步（与旧 Dijkstra 流场同构）。
 * @param {number} sx 起点格 x
 * @param {number} sy 起点格 y
 * @param {Set<string>} targets 目标格 key 集合
 * @param {object} opts
 * @param {(x:number,y:number)=>boolean} opts.canStand 像素坐标可站判定（必填）
 * @param {number} [opts.ts=36] 每格像素
 * @param {number} [opts.maxNodes=12000] 扩展节点上限（同时是"不可达"的隐性边界，与旧 PATH_MAX_NODES 一致）
 * @param {string} [opts.heuristic='box'] 'box'=多目标包围盒启发式（默认）；'none'=纯 Dijkstra
 */
export function astarField(sx, sy, targets, opts) {
    const ts = opts.ts || 36;
    const canStand = opts.canStand;
    const maxNodes = opts.maxNodes || 12000;
    // 启发式模式：'min'=到最近目标的精确 octile（默认，目标 ≤64 时最快最准）；'box'=包围盒下界（目标很多时省 O(targets)）；'none'=纯 Dijkstra
    const heuristicMode = opts.heuristic || (targets && targets.size > 64 ? 'box' : 'min');
    const startKey = gridKey(sx, sy);
    const field = { parent: new Map(), reachable: new Set([startKey]) };
    if (!targets || !targets.size) return field;

    // 预解析目标坐标（min 模式）或包围盒（box 模式）
    let targetPts = null, box = null;
    if (heuristicMode === 'min') {
        targetPts = [...targets].map(k => {
            const i = k.indexOf(',');
            return [+k.slice(0, i), +k.slice(i + 1)];
        });
    } else if (heuristicMode === 'box') {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const k of targets) {
            const i = k.indexOf(',');
            const x = +k.slice(0, i), y = +k.slice(i + 1);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        box = { minX, maxX, minY, maxY };
    }
    const hOf = (x, y) => {
        if (heuristicMode === 'none') return 0;
        if (heuristicMode === 'box') return boxHeuristic(x, y, box);
        let best = Infinity;
        for (const [tx, ty] of targetPts) {
            const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
            const m = Math.min(dx, dy);
            const d = 10 * (dx + dy) - 6 * m;
            if (d < best) best = d;
        }
        return best;
    };

    const gScore = new Map([[startKey, 0]]);
    const heap = new MinHeap();
    heap.push([hOf(sx, sy), 0, sx, sy]);
    let found = targets.has(startKey) ? 1 : 0;

    // L11：canStand 结果缓存（同格只算一次）——canStand 内部走 getTile 字符串拼接等热路径，
    // 格中心像素坐标 (gx+0.5)*ts 确定性，探索邻格时斜走检查会重复命中已算格，缓存省 ~1/3 调用
    const csCache = new Map();
    const cs = (gx, gy) => {
        const k = gx * 100000 + gy;
        let v = csCache.get(k);
        if (v === undefined) { v = canStand((gx + 0.5) * ts, (gy + 0.5) * ts); csCache.set(k, v); }
        return v;
    };

    while (heap.size && found < targets.size && field.reachable.size < maxNodes) {
        const [f, g, gx, gy] = heap.pop();
        const key = gridKey(gx, gy);
        if (g !== gScore.get(key)) continue;   // 懒删除：已有更优路径的过期条目
        if (targets.has(key)) { found++; if (found >= targets.size) break; }   // 弹出时 g 已最优
        for (const [dx, dy] of A_DIRS) {
            const nx = gx + dx, ny = gy + dy, nk = gridKey(nx, ny);
            if (!cs(nx, ny)) continue;
            // 斜走不能穿过两个相邻障碍角（与旧实现一致）
            if (dx && dy && (!cs(gx + dx, gy) || !cs(gx, gy + dy))) continue;
            const ng = g + (dx && dy ? 14 : 10);
            const old = gScore.get(nk);
            if (old !== undefined && ng >= old) continue;
            gScore.set(nk, ng);
            field.parent.set(nk, { gx, gy });
            field.reachable.add(nk);
            heap.push([ng + hOf(nx, ny), ng, nx, ny]);
        }
    }
    return field;
}

/**
 * 单点寻路：起点 (sx,sy) → 终点 (tx,ty) 的格路径。
 * 实现：反向流场（终点 → 起点）再反查 parent，天然复用 astarField 的最优性。
 * @returns {Array<{x:number,y:number}>} 路径（不含起点、含终点；不可达时为空数组）
 */
export function astarPath(sx, sy, tx, ty, opts) {
    const startKey = gridKey(sx, sy), goalKey = gridKey(tx, ty);
    if (startKey === goalKey) return [];
    const field = astarField(tx, ty, new Set([startKey]), opts);   // 从终点反向展开
    const path = [];
    let cur = startKey;
    for (let guard = 0; guard < (opts && opts.maxPathLen || 4096) && cur !== goalKey; guard++) {
        const p = field.parent.get(cur);
        if (!p) break;   // 不可达
        path.push({ x: p.gx, y: p.gy });
        cur = gridKey(p.gx, p.gy);
    }
    return path;
}
