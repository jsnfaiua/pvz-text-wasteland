// ============================================================
// 创意工坊：模组订阅 / 管理界面
// 模组状态独立存储（saveData 之外），符合模组沙盒隔离原则
// ============================================================

import { getStorage, setStorage, getSession } from '../persistence/storage.js';

const WS_KEY = 'workshop';

// 模组注册表（后续新模组在此追加即可）
const MODS = [
    {
        id: 'wasteland',
        name: '无尽植僵荒原',
        icon: '荒',
        version: 'v1.14',
        author: '官方模组',
        desc: '文字PVZ开放生存模组：圈层程序化城市（市中心→内环→外环→工业→郊区→荒野），文字侵蚀与具现系统——搜索字块/字楔在拼字台具现物资，残缺物补字修复；感染由外向内剥离具象裸露文字结构；文字僵尸（散字/删字/污字）；多层建筑探索（地上3层+地下2层）；尸潮防守。',
        tags: ['生存探索', '无限大世界', '文字侵蚀', '具现合成', '建造', '尸潮防守'],
        dependency: '需要【文字版植物大战僵尸】本体',
        notes: [
            '模组存档独立，与原版塔防存档互不覆盖',
            '关闭 / 取消订阅不会损坏原版存档，游戏恢复纯净原版状态',
            '不修改本体植物、僵尸原生逻辑，新增内容全部封装在模组命名空间',
            '越靠近市中心感染越深、僵尸越强、稀有字块越多',
        ],
        // 模组设置：2026-08-09 移出 UI（用户要求）
        settings: [],
    },
];

function loadState() {
    return getStorage(WS_KEY, {});
}

function saveState(s) {
    setStorage(WS_KEY, s);
}

// 读取模组状态（默认：已订阅并启用，功能开关全开）
export function getModState(modId) {
    const all = loadState();
    const m = all[modId] || {};
    return {
        enabled: m.enabled !== false,
        // 显示设置已移出 UI（2026-08-09 用户要求）：帧率默认开、画质默认最高，不受旧存档值影响
        opts: { ...(m.opts || {}), invasion: true, wildSpawn: true, showFps: true, gfx: 2 },
    };
}

function setModState(modId, patch) {
    const all = loadState();
    const cur = all[modId] || {};
    all[modId] = { ...cur, ...patch, opts: { ...(cur.opts || {}), ...(patch.opts || {}) } };
    saveState(all);
}

let selectedMod = MODS[0].id;

function renderList() {
    const list = document.getElementById('ws-list');
    if (!list) return;
    list.innerHTML = '';
    MODS.forEach(mod => {
        const st = getModState(mod.id);
        const card = document.createElement('div');
        card.className = 'ws-mod-card' + (mod.id === selectedMod ? ' active' : '') + (st.enabled ? '' : ' disabled-mod');
        card.innerHTML = `
            <div class="ws-mod-icon">${mod.icon}</div>
            <div class="ws-mod-brief">
                <div class="ws-mod-name">${mod.name}</div>
                <div class="ws-mod-sub">${mod.version} · ${mod.author}</div>
            </div>
            <div class="ws-mod-badge ${st.enabled ? 'on' : 'off'}">${st.enabled ? '已启用' : '已关闭'}</div>
        `;
        card.addEventListener('click', () => {
            selectedMod = mod.id;
            renderList();
            renderDetail();
        });
        list.appendChild(card);
    });
    const count = document.getElementById('ws-count');
    if (count) count.textContent = `已订阅 ${MODS.length} 个模组`;
}

function renderDetail() {
    const box = document.getElementById('ws-detail');
    if (!box) return;
    const mod = MODS.find(m => m.id === selectedMod);
    if (!mod) { box.innerHTML = '<div class="ws-placeholder">选择左侧模组查看详情</div>'; return; }
    const st = getModState(mod.id);

    // —— 荒原模组特判（2026-08-09 重构：模组界面只留开始按钮 + 存档管理，角色/世界/难度/联机全部内嵌到开始弹窗）——
    let wastelandExtra = '';
    let enterBtnsHtml = '';
    if (mod.id === 'wasteland') {
        // 2026-08-09 用户要求：工坊界面只保留存档管理（导入/导出/删除/勾选）；
        // 显示设置（帧率/画质）移出 UI（帧率默认开、画质默认最高）；
        // 选择角色/世界用于开始游戏，只在「开始游戏」弹窗内完成。
        // 角色与世界绑定（世界为主导），不单独管理角色档；删世界连带删绑定角色。
        wastelandExtra = `
            <div class="ws-section-title">存档管理（世界 · 导入 / 导出 / 删除）</div>
            <div class="wsl-save-mgr">
                <div class="wsl-save-ops">
                    <button class="menu-btn ws-enter-btn" id="ws-save-import">导入存档 ↑</button>
                    <input type="file" id="ws-save-file" accept=".json,application/json" style="display:none">
                </div>
                <div id="ws-save-list" class="wsl-save-list"></div>
            </div>`;
        enterBtnsHtml = `
            <button class="menu-btn ws-enter-btn" id="ws-enter" ${st.enabled ? '' : 'disabled'}>开始游戏 ▶</button>`;
    } else {
        enterBtnsHtml = `
            <button class="menu-btn ws-enter-btn" id="ws-enter" ${st.enabled ? '' : 'disabled'}>
                进入荒原生存模式 ▶
            </button>`;
    }

    box.innerHTML = `
        <div class="ws-detail-head">
            <div class="ws-mod-icon big">${mod.icon}</div>
            <div class="ws-detail-titlebox">
                <div class="ws-detail-title">${mod.name}</div>
                <div class="ws-detail-sub">${mod.version} · ${mod.author}</div>
                <div class="ws-tags">${mod.tags.map(t => `<span class="ws-tag">${t}</span>`).join('')}</div>
            </div>
        </div>
        <div class="ws-detail-scroll">
            <div class="ws-section-title">模组简介</div>
            <div class="ws-desc">${mod.desc}</div>
            <div class="ws-section-title">依赖声明</div>
            <div class="ws-dep">⚙ ${mod.dependency}</div>
            <div class="ws-section-title">注意事项</div>
            <div class="ws-notes">${mod.notes.map(n => `<div class="ws-note">· ${n}</div>`).join('')}</div>
            ${wastelandExtra}
            <div class="ws-hint" id="ws-hint"></div>
        </div>
        <div class="ws-actions">
            <button class="menu-btn ws-enable-btn ${st.enabled ? 'is-on' : ''}" id="ws-enable">
                ${st.enabled ? '取消订阅' : '订阅并启用'}
            </button>
            ${enterBtnsHtml}
        </div>
    `;

    // 功能开关
    box.querySelectorAll('.ws-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.opt;
            const cur = getModState(mod.id);
            setModState(mod.id, { opts: { [key]: !cur.opts[key] } });
            renderDetail();
        });
    });

    // 订阅 / 取消订阅
    document.getElementById('ws-enable')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        setModState(mod.id, { enabled: !cur.enabled });
        renderList();
        renderDetail();
    });

    // 进入模组（动态加载荒原，launch 供继续 / 新世界两个按钮复用）
    const launchWasteland = (opts) => {
        import('../mod-wasteland/survival.js').then(m => {
            m.enterWasteland(opts);
        }).catch(err => {
            console.error('[wasteland] 启动失败', err);
            const hint = document.getElementById('ws-hint');
            if (hint) {
                hint.textContent = '荒原模组启动失败：' + (err && err.message ? err.message : err);
                hint.classList.add('show');
            }
        });
    };
    // 开始游戏（2026-08-09 重构）：点「开始游戏」弹出完整选择界面（角色/世界/难度 + 单机/联机）
    document.getElementById('ws-enter')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        if (mod.id !== 'wasteland') { launchWasteland(cur.opts); return; }
        // 动态加载荒原模块后弹出开始界面（开始界面在 survival.js 实现）
        import('../mod-wasteland/survival.js').then(m => {
            m.showGameStartDialog({ onLaunch: launchWasteland, onLaunchMP });
        }).catch(err => {
            console.error('[wasteland] 开始游戏失败', err);
            const hint = document.getElementById('ws-hint');
            if (hint) { hint.textContent = '荒原模组启动失败：' + (err && err.message ? err.message : err); hint.classList.add('show'); }
        });
    });

    // 联机启动：动态加载联机层（供开始界面「多人联机」调用）
    const onLaunchMP = (role, opts) => {
        import('../mod-wasteland/mpWasteland.js').then(m => {
            m.startWastelandMP(role, opts || getModState(mod.id).opts);
        }).catch(err => {
            console.error('[wasteland-mp] 启动失败', err);
            const hint = document.getElementById('ws-hint');
            if (hint) {
                hint.textContent = '荒原联机启动失败：' + (err && err.message ? err.message : err);
                hint.classList.add('show');
            }
        });
    };

    // —— 存档备份：导出 / 导入（A：防 localStorage 满/清缓存丢档，可跨浏览器迁移）——
    // 导出：收集当前账户所有 wasteland_* 键（角色档/世界档/profile/角色列表/旧混合档），
    //       打包为 JSON 文件下载。复用原序列化数据（wstate 白名单产物），不触碰联机协议。
    document.getElementById('ws-save-export')?.addEventListener('click', () => {
        if (mod.id !== 'wasteland') return;
        const user = (getSession() && getSession().username) || '__guest__';
        const prefix = `u:${user}:wasteland_`;
        const entries = {};
        let n = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const full = localStorage.key(i);
            if (!full || !full.startsWith(prefix)) continue;
            const base = full.slice(prefix.length);
            try {
                const raw = localStorage.getItem(full);
                if (raw == null) continue;
                entries[base] = JSON.parse(raw);
                n++;
            } catch (e) { /* 单键损坏跳过，不阻塞导出 */ }
        }
        if (n === 0) {
            const hint = document.getElementById('ws-hint');
            if (hint) { hint.textContent = '没有可导出的荒原存档（先玩一会儿或创建角色）'; hint.classList.add('show'); }
            return;
        }
        const data = { __wslBackup: 1, exportedAt: Date.now(), username: user, entries };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        a.download = `wasteland-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
        const hint = document.getElementById('ws-hint');
        if (hint) { hint.textContent = `已导出 ${n} 个存档键（含角色/世界/profile），请妥善保管该文件`; hint.classList.add('show'); }
    });

    // 导入：选择备份文件 → 校验版本标记 → 写回 localStorage → 重渲染面板
    document.getElementById('ws-save-import')?.addEventListener('click', () => {
        if (mod.id !== 'wasteland') return;
        document.getElementById('ws-save-file')?.click();
    });
    document.getElementById('ws-save-file')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';   // 允许重复选同一文件
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result));
                if (!data || data.__wslBackup !== 1 || !data.entries || typeof data.entries !== 'object') {
                    throw new Error('不是有效的荒原备份文件');
                }
                const srcUser = data.username || '__guest__';
                const keys = Object.keys(data.entries);
                let ok = 0;
                for (const k of keys) {
                    // 导出时剥离了 'wasteland_' 前缀（base=full.slice(prefix.length)），
                    // 导入必须加回；setStorage 再加账户命名空间 → 还原完整键
                    const baseKey = k.startsWith('wasteland_') ? k : 'wasteland_' + k;
                    // 写回原账户命名空间（跨账户/跨浏览器迁移友好）
                    if (setStorage(baseKey, data.entries[k], true) !== false && data.entries[k] != null) ok++;
                    else if (data.entries[k] == null) ok++;
                }
                // 备份里的用户若与当前不同，把 profile 指到备份用户对应的存档组合
                const hint = document.getElementById('ws-hint');
                if (hint) {
                    hint.textContent = `已导入 ${keys.length} 个存档键（${srcUser}），正在刷新面板…`;
                    hint.classList.add('show');
                }
                setTimeout(() => renderDetail(), 600);
            } catch (err) {
                const hint = document.getElementById('ws-hint');
                if (hint) { hint.textContent = '导入失败：' + (err && err.message ? err.message : err); hint.classList.add('show'); }
            }
        };
        reader.readAsText(file);
    });

    // —— 存档管理列表：枚举角色档/世界档，每项勾选删除，批量导出/删除 ——
    if (mod.id === 'wasteland') renderSaveList(mod);

    // 难度选择（荒原模组）
    box.querySelectorAll('.wsl-diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setModState(mod.id, { opts: { difficulty: btn.dataset.diff } });
            renderDetail();
        });
    });
}

// 存档管理列表：以「世界」为主导（2026-08-09 用户要求）
// 角色与世界强绑定（世界档内 characterName 指向唯一角色），不再单独管理角色档：
// 删除世界时连带删除其绑定角色档，避免出现"世界还在但没角色"的残缺状态。
// 这里只是存档管理预览，实际选择在「开始游戏」弹窗内完成。
function renderSaveList(mod) {
    const user = (getSession() && getSession().username) || '__guest__';
    const prefix = `u:${user}:wasteland_`;
    const worlds = [];
    for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        if (!full || !full.startsWith(prefix)) continue;
        const base = full.slice(prefix.length);   // 如 world_123
        try {
            const raw = localStorage.getItem(full);
            if (raw == null) continue;
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') continue;
            if (base.startsWith('world_')) {
                const seed = base.slice('world_'.length);
                const day = data.day || 1;
                const mins = Math.floor((data.playT || 0) / 60);
                const zN = (data.zombies || []).filter(z => z && z.isPlayerZombie).length;
                const isCur = String(seed) === String((getStorage('wasteland_profile', null) || {}).worldSeed);
                // 世界绑定角色（世界档主导）；角色档若仍存在则显示名字
                const charName = data.characterName || null;
                const hasChar = !!(charName && getStorage(charKey(charName), null));
                worlds.push({ seed, day, mins, zN, isCur, charName, hasChar });
            }
        } catch { /* 单键损坏跳过 */ }
    }
    worlds.sort((a, b) => (b.isCur ? 1 : 0) - (a.isCur ? 1 : 0) || (Number(b.seed) - Number(a.seed)));
    const el = document.getElementById('ws-save-list');
    if (!el) return;
    if (!worlds.length) {
        el.innerHTML = '<div class="wsl-save-empty">暂无存档 —— 创建世界并游玩后自动生成（世界档内绑定唯一角色）</div>';
        return;
    }
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 世界列表 HTML（每项：checkbox + 删除；副标题显示绑定角色）
    const worldHtml = worlds.map(w => `
        <div class="wsl-save-item${w.isCur ? ' cur' : ''}">
            <input type="checkbox" class="wsl-save-check" data-kind="world" data-seed="${esc(w.seed)}" title="选择删除">
            <div class="wsl-save-meta">
                <span class="wsl-save-name">世界 #${esc(w.seed)}${w.isCur ? ' · 当前' : ''}</span>
                <span class="wsl-save-sub">第 ${w.day} 天 · 存活 ${w.mins} 分钟${w.zN ? ` · 尸化的自己 ×${w.zN}` : ''}</span>
                <span class="wsl-save-sub">绑定角色：${w.hasChar ? esc(w.charName) : '<span style="color:#8a5a5a">（未绑定）</span>'}</span>
            </div>
            <div class="wsl-save-btns">
                <button class="menu-btn wsl-save-btn danger" data-act="del" data-kind="world" data-seed="${esc(w.seed)}">删除</button>
            </div>
        </div>`).join('');
    const selbar = `
        <div class="wsl-save-selbar">
            <button class="menu-btn wsl-save-btn" id="ws-save-sel-all">全选</button>
            <button class="menu-btn wsl-save-btn" id="ws-save-sel-export">导出存档(0)</button>
            <button class="menu-btn wsl-save-btn danger" id="ws-save-sel-del">删除选中(0)</button>
        </div>`;
    el.innerHTML = selbar + `<div class="wsl-save-group">世界（${worlds.length}）</div>` + worldHtml;

    // 批量选择：计数 / 全选 / 导出存档 / 删除选中（仅世界）
    const updateSelCount = () => {
        const n = el.querySelectorAll('.wsl-save-check:checked').length;
        const exp = el.querySelector('#ws-save-sel-export');
        const del = el.querySelector('#ws-save-sel-del');
        if (exp) exp.textContent = `导出存档(${n})`;
        if (del) del.textContent = `删除选中(${n})`;
    };
    el.querySelectorAll('.wsl-save-check').forEach(cb => cb.addEventListener('change', updateSelCount));
    el.querySelector('#ws-save-sel-all')?.addEventListener('click', () => {
        const checks = [...el.querySelectorAll('.wsl-save-check')];
        const allOn = checks.length > 0 && checks.every(c => c.checked);
        checks.forEach(c => { c.checked = !allOn; });
        updateSelCount();
    });
    // 批量导出选中世界（连带导出其绑定角色档，保证备份可完整还原）
    el.querySelector('#ws-save-sel-export')?.addEventListener('click', () => {
        const sel = [...el.querySelectorAll('.wsl-save-check:checked')];
        if (!sel.length) { hintMsg('未勾选任何存档'); return; }
        const entries = {};
        let n = 0;
        for (const cb of sel) {
            const fullKey = `${prefix}world_${cb.dataset.seed}`;
            try {
                const raw = localStorage.getItem(fullKey);
                if (raw == null) continue;
                const wd = JSON.parse(raw);
                if (!wd || typeof wd !== 'object') continue;
                entries[fullKey.slice(prefix.length)] = wd;
                n++;
                // 连带绑定角色档
                if (wd.characterName) {
                    const cKey = `${prefix}character_${wd.characterName}`;
                    const cRaw = localStorage.getItem(cKey);
                    if (cRaw != null) { entries[cKey.slice(prefix.length)] = JSON.parse(cRaw); n++; }
                }
            } catch (e) { /* 单键损坏跳过 */ }
        }
        if (n === 0) { hintMsg('所选存档已损坏或不存在'); return; }
        const data = { __wslBackup: 1, exportedAt: Date.now(), username: user, entries };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        a.download = `wasteland-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
        hintMsg(`已导出选中 ${n} 个存档键（含绑定角色档），请妥善保管该文件`);
    });
    // 删除世界（连带其绑定角色档）：世界为主导，角色跟着世界走
    const removeWorld = (seed) => {
        const fullKey = `${prefix}world_${seed}`;
        let charName = null;
        try {
            const wd = JSON.parse(localStorage.getItem(fullKey));
            if (wd && wd.characterName) charName = wd.characterName;
        } catch { /* 读取失败则只删世界 */ }
        localStorage.removeItem(fullKey);
        // 连带删除该世界绑定的角色档（世界主导：角色不独立存在）
        if (charName) {
            localStorage.removeItem(`${prefix}character_${charName}`);
            const cl = getStorage('wasteland_characters', { names: [] });
            cl.names = (cl.names || []).filter(n => n !== charName);
            setStorage('wasteland_characters', cl);
            const prof = getStorage('wasteland_profile', null);
            if (prof && prof.characterName === charName) {
                setStorage('wasteland_profile', { ...prof, characterName: null });
            }
            if (getStorage('ws_save_sel_char', null) === charName) setStorage('ws_save_sel_char', null);
        }
        // 世界相关的 profile / 选中缓存
        const prof2 = getStorage('wasteland_profile', null);
        if (prof2 && String(prof2.worldSeed) === String(seed)) {
            setStorage('wasteland_profile', { ...prof2, worldSeed: null });
        }
        if (String(getStorage('ws_save_sel_world', null)) === String(seed)) setStorage('ws_save_sel_world', null);
    };
    // 批量删除选中世界（连带绑定角色）
    el.querySelector('#ws-save-sel-del')?.addEventListener('click', () => {
        const sel = [...el.querySelectorAll('.wsl-save-check:checked')];
        if (!sel.length) { hintMsg('未勾选任何存档'); return; }
        if (!confirm(`⚠ 删除选中的 ${sel.length} 个世界存档？此操作不可恢复。\n\n（世界档：该世界全部地形/箱子/尸化自己；连带删除其绑定角色档）`)) return;
        sel.forEach(cb => removeWorld(cb.dataset.seed));
        hintMsg(`已删除选中 ${sel.length} 个世界存档（连带绑定角色）`);
        renderDetail();   // 重渲染列表
    });

    // 单项删除（连带绑定角色）
    el.querySelectorAll('.wsl-save-btn[data-act="del"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const seed = btn.dataset.seed;
            const label = `世界 #${seed}`;
            if (!confirm(`⚠ 删除${label}存档？此操作不可恢复。\n\n（世界档：该世界全部地形/箱子/尸化自己；连带删除其绑定角色档）`)) return;
            removeWorld(seed);
            hintMsg(`已删除${label}`);
            renderDetail();   // 重渲染列表
        });
    });
}
// 角色档键名（与 survival.js 保持一致，避免复制魔法串）
function charKey(name) { return 'wasteland_character_' + (name || '幸存者'); }

function hintMsg(text) {
    const hint = document.getElementById('ws-hint');
    if (hint) { hint.textContent = text; hint.classList.add('show'); }
}

export function refresh() {
    renderList();
    renderDetail();
}

export default { refresh, getModState };
