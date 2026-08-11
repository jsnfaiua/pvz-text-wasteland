// 临时调试：复现"清除NPC把自己清除掉"场景
const _lsStore = {};
const _lsStub = { getItem: k => (_lsStore[k] !== undefined ? _lsStore[k] : null), setItem: (k, v) => { _lsStore[k] = String(v); }, removeItem: k => { delete _lsStore[k]; } };
try { globalThis.localStorage = _lsStub; } catch {}
globalThis.window = {
    localStorage: _lsStub,
    AudioContext: function () {
        const gain = () => ({ gain: { value: 0 }, connect() {}, addEventListener() {}, removeEventListener() {} });
        return { createGain: gain, destination: {}, currentTime: 0, state: 'running', addEventListener() {}, removeEventListener() {}, resume: () => Promise.resolve(), createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }), decodeAudioData: (b, ok) => ok && ok({ duration: 1 }), createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }), createMediaElementSource: () => ({ connect() {} }) };
    },
    webkitAudioContext: undefined, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: cb => { cb(performance.now()); return 1; }, cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
};
globalThis.document = {
    createElement: () => ({ getContext: () => null, style: {}, addEventListener() {}, width: 0, height: 0, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, remove() {}, innerHTML: '', textContent: '', value: '' }),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null,
    getElementsByClassName: () => [], body: { appendChild() {}, removeChild() {} }, documentElement: {}, createTextNode: () => ({}),
};
try { globalThis.navigator = { userAgent: 'node', onLine: true }; } catch {}
globalThis.requestAnimationFrame = cb => { cb(performance.now()); return 1; };
globalThis.cancelAnimationFrame = () => {};
try { globalThis.performance = globalThis.performance || { now: () => Date.now() }; } catch {}
globalThis.Image = function () {}; globalThis.HTMLCanvasElement = function () {}; globalThis.HTMLImageElement = function () {};
globalThis.Audio = function () {}; globalThis.OfflineAudioContext = function () {};

const WNPC = await import('../source-code/mod-wasteland/wnpc.js');
const B = await import('../source-code/mod-wasteland/wbalance.js');
const TS = 36;

// 构造 sv：重生后的新幸存者 + 新招募队员
const sv = {
    world: { seed: 12345, chunks: new Map() },
    mods: { tiles: {}, chests: {}, boxLoot: {} },
    npcs: [], controllerId: 'player', hp: 100, maxHp: 100,
    inv: [{ id: 'wood', n: 5 }], wpn: { melee: { dagger: 1 }, ranged: null, cooldown: 0, reloading: 0, charging: false, chargeT: 0, mag: {} },
    px: 100, py: 100, food: 80, water: 80, stamina: 100, maxStamina: 100, exhausted: false, infection: 0,
    character: { shirt: '#555', skin: '#d8c9a8' }, _devGod: false,
};
// 新幸存者（initRoster 创建）
WNPC.initRoster(sv);
console.log('初始 controllerId:', sv.controllerId, 'npcs:', sv.npcs.map(n => `${n.id}(isPlayer=${n.isPlayer},party=${n.party})`).join(', '));

// 招募两个队友
for (let i = 0; i < 2; i++) {
    const n = WNPC.makeNpc(sv, 120 + i * 10, 100, 'friendly');
    n.party = true; n.state = 'follow';
    sv.npcs.push(n);
}
console.log('招募后 npcs:', sv.npcs.map(n => n.id).join(', '));

// 模拟"清除NPC"：当前主控是 player
const clearFilter = (list, ctrlId) => list.filter(n => n.isPlayer || n.id === ctrlId);
sv.npcs = clearFilter(sv.npcs, sv.controllerId);
console.log('清除后（主控=player）:', sv.npcs.map(n => `${n.id}(isPlayer=${n.isPlayer})`).join(', '));
console.log('清除后主控还在:', sv.npcs.some(n => n.id === sv.controllerId));

// 场景2：切视角到队友 A
const a = sv.npcs[sv.npcs.length - 1];  // 重新招募一个
const a2 = WNPC.makeNpc(sv, 150, 100, 'friendly');
a2.party = true; a2.state = 'follow';
sv.npcs.push(a2);
WNPC.switchControl(sv, a2.id, true);
console.log('切换后 controllerId:', sv.controllerId, '=', a2.id);
sv.npcs = clearFilter(sv.npcs, sv.controllerId);
console.log('清除后（主控=队友）:', sv.npcs.map(n => `${n.id}(isPlayer=${n.isPlayer})`).join(', '));
console.log('清除后主控还在:', sv.npcs.some(n => n.id === sv.controllerId));

// 场景3：主控记录被帧边界清掉（alive=false 且非 corpse）后再清除
const b = WNPC.makeNpc(sv, 160, 100, 'friendly');
b.party = true; sv.npcs.push(b);
WNPC.switchControl(sv, b.id, true);
b.alive = false;   // 模拟当前主控被击杀
sv.npcs = sv.npcs.filter(n => n.alive || n._corpse);   // 帧边界
console.log('帧边界后 npcs:', sv.npcs.map(n => `${n.id}(alive=${n.alive})`).join(', '));
console.log('帧边界后 controllerId:', sv.controllerId);
