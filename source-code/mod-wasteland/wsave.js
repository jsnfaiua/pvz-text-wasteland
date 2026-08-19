// ============================================================
// 【无尽植僵荒原】存档层（角色档 / 世界档 / profile 分离）
// 从 survival.js 拆出（v4.26）：纯存储操作，不依赖生存主控的 sv 模块变量。
// 依赖：storage.js（命名空间读写）/ 常量键定义。
// 说明：saveNow / flushSave（依赖 sv + STATE_DEPS 序列化）仍留在 survival.js 调度层。
// ============================================================

import { getStorage, setStorage, getSession } from '../persistence/storage.js';

export const SAVE_KEY = 'wasteland_save';           // 旧版混合档（v3 迁移源，迁移后仅作备份标记）
export const LEGACY_KEY = 'wasteland_save_legacy';
export const PROFILE_KEY = 'wasteland_profile';     // { characterName, worldSeed } 当前角色+世界组合
export const CHAR_LIST_KEY = 'wasteland_characters';// { names: [] } 已创建角色索引
export const CHAR_KEY_PREFIX = 'wasteland_character_'; // + 角色名 → 角色档（跨世界）
export const WORLD_KEY_PREFIX = 'wasteland_world_';    // + seed → 世界档（跟种子走）

// ================= 键生成 =================
export function charKey(name) { return CHAR_KEY_PREFIX + (name || '幸存者'); }
export function worldKey(seed) { return WORLD_KEY_PREFIX + seed; }

// 随机名生成（2026-08-09 用户要求：角色名/世界名可随机，完全随机——中/英/数字/字符混合）
const _RND_CN = '阿布苍漠凛岚孤舟浮云凝霜曜岩荒野流萤暮雪逐星烬夜苍梧白芷青鸾玄甲赤焰';
const _RND_EN = 'abcdfghjkmnpqrstvwxyz';
const _RND_CHAR = 'ΔλΞΨΩ$#@&%*';
export function randomName(prefix) {
    // 2~4 段混搭：中文词 / 英文串 / 数字 / 字符，随机组合
    const parts = [];
    const n = 2 + Math.floor(Math.random() * 3);   // 2-4 段
    for (let i = 0; i < n; i++) {
        const t = Math.floor(Math.random() * 4);
        if (t === 0) {   // 中文词
            const c1 = _RND_CN[Math.floor(Math.random() * _RND_CN.length)];
            const c2 = _RND_CN[Math.floor(Math.random() * _RND_CN.length)];
            parts.push(c1 + c2);
        } else if (t === 1) {   // 英文串
            const len = 3 + Math.floor(Math.random() * 4);
            let s = '';
            for (let j = 0; j < len; j++) s += _RND_EN[Math.floor(Math.random() * _RND_EN.length)];
            parts.push(s);
        } else if (t === 2) {   // 数字
            parts.push(String(Math.floor(Math.random() * 90) + 10));
        } else {   // 字符
            parts.push(_RND_CHAR[Math.floor(Math.random() * _RND_CHAR.length)]);
        }
    }
    return (prefix || '') + parts.join('');
}

// 导出单个存档键为备份文件（2026-08-09 用户要求"保存=导出文件，可再导入"）：
// 复用工坊 workshop.js 的 __wslBackup 格式（entries 以 wasteland_ 前缀键组织），
// 导入时由 ws-save-file 校验 __wslBackup===1 后写回 localStorage（含账户命名空间），
// 因此硬核死亡"保存世界"导出的文件可在工坊「存档管理 → 导入存档」随时还原。
// logger 可选（默认忽略），由生存层传入 log 以输出提示。
export function downloadSaveBackup(entries, filename, tip, logger) {
    try {
        const user = (getSession && getSession() && getSession().username) || '__guest__';
        const data = { __wslBackup: 1, exportedAt: Date.now(), username: user, entries };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
        if (tip && typeof logger === 'function') logger(tip, '#7fd6ff');
    } catch (e) { /* 导出失败不阻塞保存流程 */ }
}

// 角色索引：已创建角色列表（重名合并，幂等）
export function updateCharList(name) {
    const list = getStorage(CHAR_LIST_KEY, { names: [] });
    if (!list.names.includes(name)) { list.names.push(name); setStorage(CHAR_LIST_KEY, list); }
}

// 旧版混合档迁移：wasteland_save（v3）→ 角色档 + 世界档 + profile（幂等，_migrated 标记）
export function migrateLegacySave() {
    const legacy = getStorage(SAVE_KEY, null);
    if (!legacy || legacy._migrated) return null;
    const name = legacy.characterName || '幸存者';
    setStorage(charKey(name), {
        name, character: legacy.character || null,
        inv: legacy.inv || [], hotbar: legacy.hotbar || [], curSlot: legacy.curSlot || 'ranged',
        hp: legacy.hp, maxHp: legacy.maxHp,
        food: legacy.food, water: legacy.water, infection: legacy.infection || 0,
        stamina: legacy.stamina, maxStamina: legacy.maxStamina,
        wpnMag: legacy.wpnMag || {}, _devInfBag: !!legacy._devInfBag,
    });
    if (typeof legacy.seed === 'number') {
        setStorage(worldKey(legacy.seed), {
            seed: legacy.seed, t: legacy.t, day: legacy.day, playT: legacy.playT,
            mods: legacy.mods, homeBed: legacy.homeBed || null, lastRestDay: legacy.lastRestDay || 0,
            horde: legacy.horde ? 1 : 0, zombies: legacy.zombies || [],
            npcs: legacy.npcs || null, px: legacy.px, py: legacy.py,
            faceX: legacy.faceX || 1, faceY: legacy.faceY || 0,
        });
        setStorage(PROFILE_KEY, { characterName: name, worldSeed: legacy.seed });
    } else {
        // 旧档无 seed（极旧结构）：也写 profile，避免角色档孤立（L13）——
        // worldSeed=null 按"开新世界"处理，角色（名字/外观/背包）仍会被自动加载
        setStorage(PROFILE_KEY, { characterName: name, worldSeed: null });
    }
    updateCharList(name);
    setStorage(SAVE_KEY, { ...legacy, _migrated: true });
    return { characterName: name, worldSeed: typeof legacy.seed === 'number' ? legacy.seed : null };
}

// ================= 角色档读写（mpWasteland 握手阶段加载/创建用） =================
export function loadCharacterData(name) {
    return name ? getStorage(charKey(name), null) : null;
}
export function saveCharacterData(charData) {
    if (!charData || !charData.name) return;
    setStorage(charKey(charData.name), charData);
    updateCharList(charData.name);
}
// 只读 profile 中的角色名（survival.js 的 currentCharacterName 用它做 sv 缺失时的兜底）
export function profileCharacterName() {
    return (getStorage(PROFILE_KEY, null) || {}).characterName || null;
}
