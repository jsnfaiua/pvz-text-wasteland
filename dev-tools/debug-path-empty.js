// 调试2：目标 = 失败案例中的 (-4,-116)，验证 BFS 结果
const _lsStore = {};
const _lsStub = {
    getItem: k => (_lsStore[k] !== undefined ? _lsStore[k] : null),
    setItem: (k, v) => { _lsStore[k] = String(v); },
    removeItem: k => { delete _lsStore[k]; },
};
try { globalThis.localStorage = _lsStub; } catch { }
globalThis.window = {
    localStorage: _lsStub,
    AudioContext: function () {},
    addEventListener() {},
};
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0 }),
    addEventListener() {},
    querySelector: () => null,
    getElementById: () => null,
    body: {},
    documentElement: {},
};
try { globalThis.navigator = { userAgent: 'node' }; } catch { }
try {
    globalThis.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 16);
    globalThis.cancelAnimationFrame = () => {};
} catch { }

import { TS } from '../source-code/mod-wasteland/wconst.js';
import * as MSG from '../source-code/mod-wasteland/wmsg.js';
import {
    T, getTile, isWalk,
} from '../source-code/mod-wasteland/world.js';

const WV = await import('../source-code/mod-wasteland/wvehicle.js');

function makeSV(seed) {
    const sv = {
        world: { seed, chunks: new Map() },
        mods: { tiles: {}, chests: {} },
        npcs: [],
        zombies: [],
        effects: [],
        inv: [],
        msgs: [],
        now: 0,
        px: 0, py: 0, faceX: 1, faceY: 0,
        camp: null,
        driving: null,
        driveOrder: null,
    };
    MSG.initMsg(sv);
    return sv;
}

const seed = 20466696;
const sv = makeSV(seed);

function check(sx, sy, tgx, tgy) {
    const r = WV.buildChauffeurPath(sv, (sx + 0.5) * TS, (sy + 0.5) * TS, tgx, tgy, 0);
    console.log(`from (${sx},${sy}) → (${tgx},${tgy}) tile=${getTile(sv, tgx, tgy)}: goal=${r.goal} best=${r.bestX},${r.bestY} pl=${r.path.length} pathHead=${r.path[0] ? r.path[0].x + ',' + r.path[0].y : '-'}`);
}

// 失败案例：车最终停在 (-2,-108)，route goal=true best=(-4,-116) pl=0
check(-2, -108, -4, -116);
// 车启动位置 (9,8) 到同目标
check(9, 8, -4, -116);
// 目标近旁可走格
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const t = getTile(sv, -4 + dx, -116 + dy);
    if (!isWalk(t)) continue;
    if (dx === 0 && dy === 0) continue;
    check(-2, -108, -4 + dx, -116 + dy);
}
