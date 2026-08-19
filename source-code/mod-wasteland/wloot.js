// ============================================================
// 【无尽植僵荒原】掉落系统（host 权威 drops 同步 + 容器内容上报）
// 从 survival.js 拆出（v4.26）：世界掉落物增删改 + 箱子/搜索内容变更上报。
// 依赖注入（避免循环依赖）：setSv —— 模块级 sv 引用（生存层 enterWasteland 时注入）。
// ============================================================

let sv = null;
export function setSv(s) { sv = s; }

// host 移除 guest 已拾取的掉落（按坐标+id 匹配）
export function removeDrop(x, y, id) {
    if (!sv || !Array.isArray(sv.drops)) return false;
    const i = sv.drops.findIndex(d => d && d.id === id && Math.abs(d.x - x) < 12 && Math.abs(d.y - y) < 12);
    if (i >= 0) { sv.drops.splice(i, 1); return true; }
    return false;
}

// host 应用 guest 丢出的掉落（host 权威 drops → wsync 下发双端一致）
export function addDrop(x, y, id, n) {
    if (!sv) return;
    sv.drops.push({ x, y, id, n });
}

// host 应用 guest 搜索战利品后的 contents 变更（host 权威 drops → wsync 下发双端一致）
export function updateLootDrop(x, y, id, contents) {
    if (!sv || !Array.isArray(sv.drops)) return false;
    const d = sv.drops.find(d => d && d.id === id && Math.abs(d.x - x) < 12 && Math.abs(d.y - y) < 12);
    if (!d) return false;
    if (contents && contents.length) d.contents = contents;
    else { const i = sv.drops.indexOf(d); if (i >= 0) sv.drops.splice(i, 1); }
    return true;
}

// 箱子/容器内容变更上报（联机时调用）
export function reportChestChange(key) {
    if (!sv || !sv.mp || !key) return;
    const chest = sv.mods.chests && sv.mods.chests[key];
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'chest', key, items: chest ? JSON.parse(JSON.stringify(chest)) : [] });
}
export function reportBoxLootChange(key) {
    if (!sv || !sv.mp || !key) return;
    const v = sv.mods.boxLoot && sv.mods.boxLoot[key];
    const searched = sv.mods.boxSearched && sv.mods.boxSearched[key];
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'boxloot', key, items: v !== undefined ? JSON.parse(JSON.stringify(v)) : [], searched: !!searched });
}
