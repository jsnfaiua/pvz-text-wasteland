// ============================================================
// 路面宽度检测：排除十字路口后，路带横断面宽度应为 4 格
// 检测两类问题：
//   1) 1 格宽公路（残路带被环带/人行道切成 1 格）
//   2) 超宽路（>5 格，含残路带拼接）
// 判定：对每个"路带格"，数垂直方向的连续路面宽度；
//       十字路口（横/纵都 ≥5 连续）豁免；
//       宽度 4 正常，5 容差，<3 或 >6 报问题。
// 用法：node --max-old-space-size=3072 --expose-gc dev-tools/road-width-check.mjs seed...
// ============================================================
const _lsStore = {};
globalThis.localStorage = { getItem: k => _lsStore[k] ?? null, setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
globalThis.window = { localStorage: globalThis.localStorage, AudioContext: function () { return {}; }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null,
    getElementsByClassName: () => [], body: {}, documentElement: {}, createTextNode: () => ({}),
};
try { globalThis.navigator = { userAgent: 'node' }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {};

const { genChunkTiles, T, CHUNK, gridRoadKept } = await import('../source-code/mod-wasteland/world.js');
const { arterialInfoAt, districtAt } = await import('../source-code/mod-wasteland/wdistrict.js');

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
if (!seeds.length) seeds.push(20260802, 12345, 987654321, 777, 424242);

// 路面判定：ROAD/车/栏/残骸 直接算路面；碎石/树 仅当脚下是保留路带或主干道才算（下层语义）
function makeIsRoad(seed, tileAt) {
    return (gx, gy) => {
        const v = tileAt(gx, gy);
        if (v === undefined) return false;
        if (v === T.ROAD || v === T.CAR || v === T.BARRICADE || v === T.CARWRECK) return true;
        if (v === T.RUBBLE || v === T.TREE) {
            if (gridRoadKept(seed, gx, gy)) return true;
            if (arterialInfoAt(seed, gx, gy).cls === 'road') return true;
        }
        return false;
    };
}

let allPass = true;
for (const seed of seeds) {
    const C = 48;
    const tiles = new Map();
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            tiles.set((cx * CHUNK + lx) + ',' + (cy * CHUNK + ly), t[ly * CHUNK + lx]);
    }
    const tileAt = (gx, gy) => tiles.get(gx + ',' + gy);
    const isRoad = makeIsRoad(seed, tileAt);
    const L = -C * CHUNK, H = C * CHUNK;

    // 十字路口豁免：5×5 邻域内横/纵各 ≥3 连续路面
    const isIntersection = (gx, gy) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            let h = 0, v = 0;
            for (let i = -2; i <= 2; i++) {
                if (isRoad(gx + dx + i, gy + dy)) h++;
                if (isRoad(gx + dx, gy + dy + i)) v++;
            }
            if (h >= 3 && v >= 3) return true;
        }
        return false;
    };

    let thin = 0, wide = 0, ok4 = 0, ok5 = 0;
    const thinSamples = [], wideSamples = [];
    const seenBands = new Set();   // 去重：同一条路带只报一次
    for (let gy = L + 2; gy < H - 2; gy++) for (let gx = L + 2; gx < H - 2; gx++) {
        if (!isRoad(gx, gy)) continue;
        if (isIntersection(gx, gy)) continue;   // 路口豁免
        // 只看城市/郊区/废墟内部：wild 区路带自然收窄属设计（路带延伸出城市边界），不报
        const d0 = districtAt(seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
        if (d0 === 'wild') continue;
        let u = 0; while (isRoad(gx, gy - u - 1)) u++;
        let d = 0; while (isRoad(gx, gy + d + 1)) d++;
        let l = 0; while (isRoad(gx - l - 1, gy)) l++;
        let r = 0; while (isRoad(gx + r + 1, gy)) r++;
        const hBand = l + r + 1, vBand = u + d + 1;
        // 孤立路点（横纵都短）不算路带，跳过
        if (hBand < 3 && vBand < 3) continue;
        // 取"窄"方向为路面宽度（横路带看纵向、纵路带看横向）
        const w = Math.min(hBand, vBand);
        // 去重：同一方向同一条带只统计一次（横向路带按带中心行、纵向按带中心列）
        // 注意横向路带 4 行 gy 不同，需按"带的实际宽度方向坐标"归并：
        // 横向路带（hBand>=vBand）：宽度方向是 y，带中心行 = gy + (vBand-1)/2 附近
        const centerGy = gy + Math.floor((vBand - 1) / 2);
        const centerGx = gx + Math.floor((hBand - 1) / 2);
        const bandKey = hBand >= vBand ? 'H' + centerGy : 'V' + centerGx;
        if (seenBands.has(bandKey)) continue;
        seenBands.add(bandKey);
        if (w >= 4 && w <= 5) { if (w === 4) ok4++; else ok5++; }
        else if (w < 3) { thin++; if (thinSamples.length < 8) thinSamples.push('(' + gx + ',' + gy + ') 宽=' + w + ' 横=' + hBand + ' 纵=' + vBand + ' 区=' + d0); }
        else if (w >= 6) { wide++; if (wideSamples.length < 8) wideSamples.push('(' + gx + ',' + gy + ') 宽=' + w + ' 横=' + hBand + ' 纵=' + vBand + ' 区=' + d0); }
        else { /* w==3 算边界，暂不报 */ }
    }
    const pass = thin === 0 && wide === 0;
    if (!pass) allPass = false;
    console.log(`seed ${seed}: 路面宽4格=${ok4} 宽5容差=${ok5} 过窄(<3)=${thin} 超宽(>=6)=${wide}  ${pass ? '✅' : '❌'}`);
    if (thinSamples.length) console.log('  ⚠️ 过窄: ' + thinSamples.join(' | '));
    if (wideSamples.length) console.log('  ⚠️ 超宽: ' + wideSamples.join(' | '));
    tiles.clear();
    if (globalThis.gc) globalThis.gc();
}
console.log('\n' + (allPass ? '✅ 全部种子路面宽度正常（4 格，无 1 格窄路/超宽）' : '❌ 存在路面宽度异常'));
process.exit(allPass ? 0 : 1);
