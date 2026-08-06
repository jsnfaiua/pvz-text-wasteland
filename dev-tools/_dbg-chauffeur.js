// 临时调试：追踪 seed=20537967 ruins→营地 驾驶模拟为何 900s 不停（卡顿修复回归排查）
import { T, getTile } from '../source-code/mod-wasteland/world.js';
import { TS } from '../source-code/mod-wasteland/wconst.js';
import * as B from '../source-code/mod-wasteland/wbalance.js';
import * as WV from '../source-code/mod-wasteland/wvehicle.js';
import * as WNPC from '../source-code/mod-wasteland/wnpc.js';

// 最小 sv 桩（与 car-pathfinding-test makeSV 同构的简化版，需要 carCanStand 依赖字段）
const _ls = {};
globalThis.localStorage = { getItem: k => _ls[k] ?? null, setItem: (k, v) => { _ls[k] = String(v); }, removeItem: k => { delete _ls[k]; } };
globalThis.window = {
    localStorage: globalThis.localStorage,
    AudioContext: function () { return { createGain: () => ({ gain: { value: 0 }, connect() {} }), destination: {}, currentTime: 0, createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }), decodeAudioData: (b, ok) => ok && ok({ duration: 1 }), createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }), createMediaElementSource: () => ({ connect() {} }) },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: cb => { cb(performance.now()); return 1; }, cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
};
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null,
};
const { makeSV, findDistrictSpot, clearBodyCache } = await import('./car-pathfinding-test-lib.js').catch(() => ({ makeSV: null }));
console.log('lib not available, using minimal sv');

const seed = 20537967;
const sv = makeSV(seed);
const spot = findDistrictSpot(sv, seed, 'ruins', 6);
const s = { gx: spot.gx, gy: spot.gy, tx: (spot.gx + 0.5) * TS, ty: (spot.gy + 0.5) * TS };
const driver = { id: 'npc1', name: '阿远', x: s.tx, y: s.ty };
sv.npcs = [driver];
const cgx = s.gx + 3, cgy = s.gy + 3;
sv.mods.tiles[cgx + ',' + cgy] = { t: T.CAR, cond: 'intact', repaired: true, owner: '阿远', dir: 0 };
sv.camp = { x: (s.gx + 8) * TS, y: (s.gy + 8) * TS };
WNPC.startDriveOrder(sv, driver, 'camp');
const o = sv.driveOrder;
o.stage = 'riding';
console.log('目标点 (tile):', Math.floor(o.tx / TS), Math.floor(o.ty / TS), 'px:', o.tx.toFixed(1), o.ty.toFixed(1));

const d = sv.driving = {
    key: cgx + ',' + cgy, gx: cgx, gy: cgy, driver: null, owner: 'tester',
    x: (cgx + 1) * TS, y: (cgy + 0.5) * TS, dir: 0, speed: 0,
    hp: WV.CAR_MAX_HP, maxHp: WV.CAR_MAX_HP, fuel: B.FUEL_MAX,
};
sv.px = d.x; sv.py = d.y;
const dt = 1 / 60;
let lastLog = 0;
for (let f = 0; f < 900 * 60; f++) {
    sv.now += dt;
    clearBodyCache();
    if (Math.hypot(o.tx - d.x, o.ty - d.y) < TS * 2) { console.log('ARRIVED at', f / 60, 's'); break; }
    WV.updateChauffeurDrive(sv, dt, (x, y, dir) => carCanStandSafe(sv, x, y, dir));
    if (!sv.driving) { console.log('STOPPED at', f / 60, 's'); break; }
    if (f % (5 * 60) === 0) {
        const r = d._route;
        console.log(`t=${(f / 60).toFixed(0)}s pos=(${(d.x / TS).toFixed(1)},${(d.y / TS).toFixed(1)}) dir=${(d.dir * 180 / Math.PI).toFixed(0)}° spd=${d.speed.toFixed(0)} route=${r ? `goal=${r.goal} pathLen=${r.path.length} wp=${r.path[0] ? r.path[0].x + ',' + r.path[0].y : '-'} stale=${r._stale} t=${(sv.now - r.t).toFixed(1)}` : 'null'} bfs=${d._bfs ? 'pending' : 'none'} noWpT=${(d._noWpT || 0).toFixed(1)} stallN=${d._stallN || 0} gstall=${(d._gstall || 0).toFixed(0)} minD=${(Math.hypot(o.tx - d.x, o.ty - d.y) / TS).toFixed(1)}格`);
    }
    if (f > 900 * 60 - 2) console.log('hit maxSim');
}
console.log('DONE. driving=', !!sv.driving, 'fuel=', d.fuel);

// carCanStand 需要 sv 上的一堆函数；直接从测试里拿 —— 这里做个 fallback：直接看测试怎么调用
function carCanStandSafe(sv, x, y, dir) {
    // 简化：从 car-pathfinding-test 复制 carCanStand 是不可能的（未导出）——这里用 getTile 判定
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
            if (t === T.WALL || t === T.TREE || t === T.WATER || t === T.BARRICADE || t === T.DOOR) return false;
        }
    }
    return true;
}
