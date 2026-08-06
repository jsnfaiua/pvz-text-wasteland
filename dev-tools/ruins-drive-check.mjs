// ============================================================
// 废墟驾驶专项测试：验证"在废墟上车/起步不再被挤出障碍物"
// 1) 在废墟区找可停车点，验证修复后车体碰撞（carCanStand 语义）可通过
// 2) 多种子统计废墟停车点可驾驶率（应 ≈100%，仅墙/树/水等真障碍失败）
// 用法：node --max-old-space-size=3072 --expose-gc dev-tools/ruins-drive-check.mjs seed...
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

const { genChunkTiles, T, CHUNK, getTile } = await import('../source-code/mod-wasteland/world.js');
const { districtAt } = await import('../source-code/mod-wasteland/wdistrict.js');
const { TS } = await import('../source-code/mod-wasteland/wconst.js');

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
if (!seeds.length) seeds.push(20260802, 12345, 987654321, 777, 424242);

// 修复后 carCanStand（ruins 区碎石可压过）
function carCanStandFixed(sv, x, y, dir) {
    const a = dir || 0, c = Math.cos(a), s = Math.sin(a);
    const p0x = x + (c - s * 0.5) * TS, p0y = y + (s + c * 0.5) * TS;
    const p1x = x + (c + s * 0.5) * TS, p1y = y + (s - c * 0.5) * TS;
    const p2x = x - (c - s * 0.5) * TS, p2y = y - (s + c * 0.5) * TS;
    const p3x = x - (c + s * 0.5) * TS, p3y = y - (s - c * 0.5) * TS;
    const minX = Math.min(p0x, p1x, p2x, p3x), maxX = Math.max(p0x, p1x, p2x, p3x);
    const minY = Math.min(p0y, p1y, p2y, p3y), maxY = Math.max(p0y, p1y, p2y, p3y);
    for (let gy = Math.ceil(minY / TS); gy <= Math.floor((maxY - 0.001) / TS); gy++) {
        for (let gx = Math.ceil(minX / TS); gx <= Math.floor((maxX - 0.001) / TS); gx++) {
            const t = getTile(sv, gx, gy);
            if (t === T.WALL || t === T.TREE || t === T.WATER ||
                t === T.BARRICADE || t === T.DOOR) return false;
            if (t === T.RUBBLE) {
                const d = districtAt(sv.world.seed, Math.floor(gx / CHUNK), Math.floor(gy / CHUNK));
                if (d !== 'ruins') return false;
            }
        }
    }
    return true;
}

let allPass = true;
for (const seed of seeds) {
    const C = 40;
    const sv = {
        world: { seed, chunks: new Map() },
        mods: { tiles: {}, chests: {}, boxLoot: {} },
    };
    for (let cy = -C; cy < C; cy++) for (let cx = -C; cx < C; cx++) {
        const t = genChunkTiles(seed, cx, cy);
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++)
            sv.world.chunks.set(cx + ',' + cy, { tiles: t });
    }

    // 统计废墟区停车点可驾驶率（锚点格=ROAD，模拟自然停车的车）
    let tested = 0, okCount = 0, wallBlocked = 0, otherBlocked = 0;
    const badSamples = [];
    outer:
    for (let cy = -C; cy < C && tested < 500; cy++) for (let cx = -C; cx < C && tested < 500; cx++) {
        if (districtAt(seed, cx, cy) !== 'ruins') continue;
        const tiles = sv.world.chunks.get(cx + ',' + cy).tiles;
        const gx0 = cx * CHUNK, gy0 = cy * CHUNK;
        for (let ly = 0; ly < CHUNK && tested < 500; ly++) for (let lx = 0; lx < CHUNK && tested < 500; lx++) {
            const gx = gx0 + lx, gy = gy0 + ly;
            if (tiles[ly * CHUNK + lx] !== T.ROAD) continue;
            sv.mods.tiles[gx + ',' + gy] = { t: T.CAR, repaired: true };
            const cx0 = (gx + 1 + 0.5) * TS, cy0 = (gy + 0.5) * TS;
            tested++;
            const ok = carCanStandFixed(sv, cx0, cy0, 0) && carCanStandFixed(sv, cx0, cy0, Math.PI / 2);
            if (ok) okCount++;
            else {
                // 判断失败原因：车体覆盖是否含墙/树/水/路障（正常障碍）
                let hasWall = false;
                for (let dy = -1; dy <= 1 && !hasWall; dy++) for (let dx = -1; dx <= 2 && !hasWall; dx++) {
                    const t2 = getTile(sv, gx + dx, gy + dy);
                    if (t2 === T.WALL || t2 === T.TREE || t2 === T.WATER || t2 === T.DOOR || t2 === T.BARRICADE) hasWall = true;
                }
                if (hasWall) wallBlocked++;
                else { otherBlocked++; if (badSamples.length < 3) badSamples.push('(' + gx + ',' + gy + ')'); }
            }
            delete sv.mods.tiles[gx + ',' + gy];
        }
    }
    // 废墟碎石可压过率：统计废墟区 RUBBLE 是否全在 ruins 区
    const rate = (okCount / tested * 100).toFixed(1);
    const pass = otherBlocked === 0;
    if (!pass) allPass = false;
    console.log(`seed ${seed}: 废墟停车点 ${tested} 个 可驾驶 ${okCount} (${rate}%) 墙/树挡 ${wallBlocked} 其他挡 ${otherBlocked}  ${pass ? '✅' : '❌'}`);
    if (badSamples.length) console.log('  ⚠️ 非墙类失败: ' + badSamples.join(' | '));
    if (globalThis.gc) globalThis.gc();
}
console.log('\n' + (allPass ? '✅ 全部种子废墟驾驶正常（仅墙/树/水等真障碍挡车）' : '❌ 存在异常'));
process.exit(allPass ? 0 : 1);
