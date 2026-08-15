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
    // 2026-08-11 v2.97 加 ?v= 版本号强制 cache-busting：用户浏览器 ESM 缓存会复用旧版 survival.js，
    // 导致 showAllDeadChoices 找不到 → ReferenceError 循环僵死。版本号变更必须同步。
    // v4.10 升级缓存号（v4.9 后进位 v4.10：V一键切武器全自动/半自动 + 横幅键位凝练 + 横幅版本号同步 + 缓存链强制刷新）
    const _WSL_VER = '4.12';
    const launchWasteland = (opts) => {
        import('../mod-wasteland/survival.js?v=' + _WSL_VER).then(m => {
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
    // v3.78 黄沙粉碎过渡：点开始游戏 → 创意工坊页面慢慢变黄沙 → 粉碎飘散 → 露出开始游戏 UI。
    // onReveal 在沙面盖满时调用：动态加载荒原模块并在下层显示开始界面，黄沙散掉后即见。
    document.getElementById('ws-enter')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        if (mod.id !== 'wasteland') { launchWasteland(cur.opts); return; }
        // 清理可能残留的黄沙过渡遮罩（动画中途刷新/异常时），否则 playSandTransition 会直接 return
        const oldOv = document.getElementById('wsl-sand-trans');
        if (oldOv) oldOv.remove();
        // v3.80 时序方案（用户："我要创意工坊界面被黄沙慢慢覆盖，再吹散过渡"）：
        // ① 点击瞬间【只后台预热】import survival.js（不显示开始 UI）——创意工坊界面保持显示，
        //    黄沙颗粒从上面慢慢覆盖它；
        // ② 沙面盖满时 playSandTransition 调 onCovered → showGameStartDialog（此刻黄沙全盖，
        //    创意工坊被遮住，创建开始 UI 用户看不到）；
        // ③ 开始 UI 建好返回 Promise → uiReady=true → 黄沙吹散 → 露出开始 UI。
        const preload = import('../mod-wasteland/survival.js?v=' + _WSL_VER)
            .catch(err => {
                console.error('[wasteland] 开始游戏失败', err);
                const hint = document.getElementById('ws-hint');
                if (hint) { hint.textContent = '荒原模组启动失败：' + (err && err.message ? err.message : err); hint.classList.add('show'); }
            });
        playSandTransition({
            onCovered: () => preload.then(m => {
                m.showGameStartDialog({ onLaunch: launchWasteland, onLaunchMP });
                const s = document.getElementById('wsl-start');
                if (s) {
                    // 盖满后创建 → 仅保证可见；【不设 opacity】——开始 UI 挂在 bg-fx 内，
                    // 随父级 bg-fx 的 opacity 渐显（父 opacity × 子 opacity 1 = 渐变）。
                    // v3.80 交互锁定：沙幕完全吹散前禁止点击开始 UI（用户要求）。
                    s.style.visibility = 'visible';
                    s.style.pointerEvents = 'none';
                }
            }),
        });
    });

    // 联机启动：动态加载联机层（供开始界面「多人联机」调用）
    const onLaunchMP = (role, opts) => {
        // v3.80 加 ?v= cache-busting（与 _WSL_VER 同步，防止加载缓存的旧 mpWasteland.js → 旧 survival.js）
        import('../mod-wasteland/mpWasteland.js?v=4.12').then(m => {
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
    let totalWorlds = 0;   // v4.9 全部世界数（含已绑定角色，用于空态文案区分）
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
                // 世界绑定角色（世界档主导）。v4.91 修复"已开始游戏绑定了角色，
                // 创意工坊存档管理仍显示未绑定"：与导出/删除逻辑同源，直接读 raw 角色档（不再走
                // getStorage 抽象层，规避 session/命名空间/时序等可能的细微差异）——
                // 该写法与下方"批量导出"和"删除世界"两处对角色档的查询完全一致。
                const charName = data.characterName || null;
                const charFullKey = charName ? (prefix + 'character_' + charName) : null;
                const charRaw = charFullKey ? localStorage.getItem(charFullKey) : null;
                const hasChar = !!charRaw;
                // v4.91 一次性诊断：hasChar=false 但世界档又有 characterName 时，把对照信息打 console
                // 方便用户/开发者一眼看出"角色档实际键是什么 / 在哪个命名空间"。
                if (charName && !hasChar) {
                    try { console.warn('[wasteland-save] renderSaveList: 世界档声明绑定角色', charName,
                        '，但角色档缺失。期望键 =', charFullKey,
                        '；当前 session =', (getSession() && getSession().username) || '__guest__',
                        '；同名键扫描 =', Object.keys(localStorage).filter(k => k.endsWith('character_' + charName))); } catch {}
                }
                totalWorlds++;
                // v4.10 账号管理：显示【全部】世界（含已绑定角色的世界）——
                // 用户反馈"账号管理的地方却没有显示，之前还会显示"：v4.9 只显示未绑定世界，
                // 导致绑定角色后存档管理列表空白，用户看不到自己账号下的存档。
                // 改为全部显示：已绑定世界展示绑定角色名（操作引导去「开始游戏」弹窗），
                // 未绑定世界保留删除/导出；勾选批量操作仅对未绑定世界生效。
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
    // v4.10 世界列表：已绑定世界 → 展示绑定角色名，操作引导到「开始游戏」弹窗（无删除）；
    // 未绑定世界 → 保留 checkbox + 删除按钮。
    const worldHtml = worlds.map(w => `
        <div class="wsl-save-item${w.isCur ? ' cur' : ''}">
            <input type="checkbox" class="wsl-save-check" data-kind="world" data-seed="${esc(w.seed)}" title="选择删除"${w.hasChar ? ' data-bound="1"' : ''}>
            ${w.hasChar ? '<span class="wsl-save-lock" title="已绑定角色">🔒</span>' : ''}
            <div class="wsl-save-meta">
                <span class="wsl-save-name">世界 #${esc(w.seed)}${w.isCur ? ' · 当前' : ''}</span>
                <span class="wsl-save-sub">第 ${w.day} 天 · 存活 ${w.mins} 分钟${w.zN ? ` · 尸化的自己 ×${w.zN}` : ''}</span>
                <span class="wsl-save-sub">绑定角色：${w.hasChar ? esc(w.charName) : '<span style="color:#8a5a5a">（未绑定）</span>'}</span>
            </div>
            <div class="wsl-save-btns">
                ${w.hasChar
                    ? '<button class="menu-btn wsl-save-btn" data-act="goto">开始游戏</button>'
                    : '<button class="menu-btn wsl-save-btn danger" data-act="del" data-kind="world" data-seed="' + esc(w.seed) + '">删除</button>'}
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
        const boundCount = sel.filter(cb => cb.dataset.bound === '1').length;
        const warnMsg = boundCount > 0
            ? `⚠ 删除选中的 ${sel.length} 个世界存档？此操作不可恢复。\n\n其中 ${boundCount} 个已绑定角色，将连带删除角色档。\n\n（世界档：该世界全部地形/箱子/尸化自己；连带删除其绑定角色档）`
            : `⚠ 删除选中的 ${sel.length} 个世界存档？此操作不可恢复。\n\n（世界档：该世界全部地形/箱子/尸化自己）`;
        if (!confirm(warnMsg)) return;
        sel.forEach(cb => removeWorld(cb.dataset.seed));
        hintMsg(`已删除选中 ${sel.length} 个世界存档${boundCount > 0 ? '（连带绑定角色）' : ''}`);
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

    // v4.10 已绑定世界 →「开始游戏」按钮：复用顶部"开始游戏"的沙尘过渡 + 开始 UI 弹窗
    el.querySelectorAll('.wsl-save-btn[data-act="goto"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const enter = document.getElementById('ws-enter');
            if (enter) enter.click();
        });
    });
}
// 角色档键名（与 survival.js 保持一致，避免复制魔法串）
function charKey(name) { return 'wasteland_character_' + (name || '幸存者'); }

function hintMsg(text) {
    const hint = document.getElementById('ws-hint');
    if (hint) { hint.textContent = text; hint.classList.add('show'); }
}

// ================= v3.80 黄沙侵蚀覆盖过渡 =================
// 点击创意工坊「开始游戏」后：创意工坊界面像角色被侵蚀那样——
// 沙色像素从【边缘向中心】逐像素侵蚀覆盖（边缘优先 + 确定性噪声，仿 render.js 感染算法），
// 缓慢布满成全屏黄沙像素点；然后这些像素点被【风从一侧吹散】，像素随风飘走；
// 吹散过程中下层开始游戏 UI 界面（bg-fx + #wsl-start）同步渐显。
// 分阶段：
//   A 0→0.42  侵蚀覆盖（level 0→1 缓慢；像素阈值 = 边缘系数 + 噪声 → 边缘先被沙覆盖）
//   B 盖满后调用 onCovered（创建开始 UI，返回其 Promise 作为 ready）——UI 就绪前沙面保持全盖
//   C 吹散（风从左向右扫过，像素被吹走 + 受重力 + bg-fx 渐显）→ 露出开始 UI
// opts.onCovered：沙面盖满时调用，返回 Promise（开始 UI 建立完成）——UI 就绪才吹散。
// 关键时序：点击时只后台预热 import；【盖满后】才创建开始 UI（此前创意工坊界面一直显示、
// 被黄沙像素侵蚀覆盖），避免"创意工坊瞬间消失直接跳过渡"。
export function playSandTransition(opts) {
    const readyPromise = (opts && opts.readyPromise) || null;
    const onCovered = (opts && opts.onCovered) || null;
    if (document.getElementById('wsl-sand-trans')) return;
    const ov = document.createElement('div');
    ov.id = 'wsl-sand-trans';
    // v3.80 播放过渡期间【拦截所有点击】：pointer-events:auto 挡住下层一切 UI 按钮，
    // 动画结束 ov.remove() 时自动恢复。之前 pointer-events:none 会漏点到创意工坊按钮。
    ov.style.cssText = 'position:fixed;inset:0;z-index:1250;pointer-events:auto;overflow:hidden;cursor:default;';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    ov.appendChild(cv);
    document.body.appendChild(ov);
    // v3.80 开始 UI 显隐同步：侵蚀阶段（未盖满）隐藏 #wsl-start；
    // 盖满后可见（opacity 由 bg-fx 渐显驱动，见 tick）。
    const syncStartUI = () => {
        const s = document.getElementById('wsl-start');
        if (!s) return;
        const covered = ov.dataset.covered === '1';
        s.style.visibility = covered ? 'visible' : 'hidden';
    };
    syncStartUI();
    const dpr = Math.max(1, (window.devicePixelRatio || 1));
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // —— 像素格点：仿"角色被侵蚀"（render.js drawPixelPlayerBody 的 peelAt 算法）——
    // 每格一个侵蚀阈值 peelAt（边缘系数 + 确定性噪声 → 边缘先被沙覆盖、颗粒感）；
    // 每格一个吹散延迟 delay（左→右 + 噪声 → 风扫过时从左到右被吹走）。
    const CELL = 6;                                    // 每格 6px（性能与颗粒感平衡）
    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
    const nPx = cols * rows;
    const peel = new Float32Array(nPx);                // 侵蚀阈值 0~1（越小越先被覆盖）
    const delay = new Float32Array(nPx);               // 消失延迟 0~1（越小越先消失）
    const shade = new Float32Array(nPx);               // v3.80 每格色差系数（-0.16~0.2，颗粒质感）
    const sandTone = new Uint8Array(nPx);              // v3.80 沙色变体 0-3（亮沙/沙/橙沙/深褐，颜色更丰富）
    const hash2 = (a, b) => {
        let h = (a ^ (b << 5)) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
        h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        const fx = cx / (cols - 1), fy = cy / (rows - 1);
        // 边缘系数：越靠边越小 → 越先被侵蚀（仿角色边缘先被吞）
        const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
        const noise = hash2(cx * 31 + cy * 17, cx ^ (cy << 4));
        peel[i] = Math.min(0.98, 0.05 + edge * 1.15 + noise * 0.42);
        // v3.80 消失顺序：纯随机（0.05~0.70）→ 像素随机地点消失。
        // 关键：delay 上界必须 ≤ 1 - FADE_WIN（FADE_WIN=0.30）→ 0.70，
        // 保证 wind 到 1 时【所有格子都已淡出完毕】，动画结束瞬间没有残留像素被整片清除。
        delay[i] = 0.05 + noise * 0.65;
        // v3.80 色差：每格深浅不一（±），黄沙有颗粒质感
        shade[i] = hash2(cx * 7 + cy * 13, (cx << 3) ^ cy) * 0.36 - 0.16;
        // v3.80 沙色变体：4 种色调加权随机（亮沙/沙/橙沙/深褐），颜色更丰富自然
        const tn = hash2(cx * 3 + cy * 29, (cx << 5) ^ (cy * 11));
        sandTone[i] = tn < 0.34 ? 0 : tn < 0.62 ? 1 : tn < 0.85 ? 2 : 3;
    }
    // ImageData 直绘像素（比几千次 fillRect 快；沙色像素直接写 buffer）
    // v3.80 修复 dpr bug：putImageData 忽略变换矩阵按设备像素放置，imgData 必须用
    // canvas 实际像素尺寸（W*dpr × H*dpr），否则高 DPI 屏只显示左上 1/dpr 区域。
    const imgData = ctx.createImageData(cv.width, cv.height);
    const pxBuf = imgData.data;
    // v3.80 沙色 4 变体调色板 → 与末世废土背景（暮色黄橙 rgb(90,50,20)→深褐 rgb(40,26,14)）契合
    const SAND_TONES = [
        [178, 132, 84],    // 暮橙沙
        [162, 118, 74],    // 黄褐沙（基准）
        [148, 104, 66],    // 橙褐沙
        [128, 88, 54],     // 深褐沙
    ];
    const SR = 162, SG = 118, SB = 74;   // 基准沙色（drawSandPx 默认，与末世废土契合）

    const t0 = performance.now();
    const DUR = 3750;          // 总时长 ms（侵蚀 0→0.4 = 1500ms 不变，消失 0.4→1 = 2250ms 延长 50%）
    let uiReady = true;
    if (readyPromise) {
        uiReady = false;
        Promise.resolve(readyPromise).then(() => { uiReady = true; }).catch(() => { uiReady = true; });
    }
    let covered = false;       // 沙面是否已盖满
    let resumeAt = 0;          // UI 就绪时刻（开始吹散）
    let bgFaded = false;       // 是否已开始渐显 bg-fx（每帧插值，不用 CSS transition）
    let coveringCbDone = false;   // onCovered 是否已调用（返回 Promise 则接管 uiReady）
    const markCovered = () => {
        if (ov.dataset.covered !== '1') { ov.dataset.covered = '1'; syncStartUI(); }
        // 盖满瞬间调用 onCovered（创建开始 UI），其返回 Promise 控制何时吹散
        if (!coveringCbDone && onCovered) {
            coveringCbDone = true;
            let p = null;
            try { p = onCovered(); } catch (e) { console.error('[sand-transition] onCovered:', e); }
            if (p && typeof p.then === 'function') {
                uiReady = false;
                Promise.resolve(p).then(() => { uiReady = true; }).catch(() => { uiReady = true; });
            }
        }
    };
    const tick = (now) => {
        const raw = (now - t0) / DUR;
        let t;
        if (!covered) {
            if (raw < 0.4) { t = raw; }               // 侵蚀覆盖阶段（1500ms 不变）
            else { covered = true; markCovered(); t = 0.4; }  // 盖满 → 同步显示开始 UI
        } else if (!uiReady) {
            t = 0.4;                                   // 等待 UI 就绪（沙面保持全盖）
        } else {
            if (!resumeAt) resumeAt = now;
            t = 0.4 + (now - resumeAt) / (DUR * 0.6); // 消失阶段（2250ms，延长 50%）
        }
        t = Math.min(1, t);
        // —— 阶段换算：侵蚀 level（0→1）、消失 wind（0→1）——
        const level = covered ? 1 : Math.min(1, t / 0.4);
        const wind = covered ? Math.min(1, (t - 0.4) / 0.6) : 0;
        // —— 逐格构建画面：沙色像素格被侵蚀覆盖 / 随机消失（透明格露出下层）——
        pxBuf.fill(0);
        for (let cy = 0; cy < rows; cy++) {
            const py = cy * CELL;
            for (let cx = 0; cx < cols; cx++) {
                const i = cy * cols + cx;
                // —— 侵蚀阶段：像素【渐变显现】（达到阈值后 alpha 随 level 继续渐增，
                //     而不是突然完全出现）——
                let alpha = 255;
                if (!covered) {
                    if (level < peel[i]) continue;                    // 未达阈值 → 透明
                    // 已超过阈值：level 继续上升时 alpha 从 0 渐增到 255（渐变显现）
                    const over = Math.min(1, (level - peel[i]) / 0.18);
                    alpha = Math.max(0, Math.round(255 * over));
                    if (alpha <= 4) continue;
                }
                // —— 消失阶段：随机像素点【原地渐变淡出】——
                // v3.80 修复"一瞬间消失"：①每格淡出窗口固定 FADE_WIN=0.30（所有格子速度一致）；
                // ②delay 上界 0.70 = 1 - FADE_WIN → wind 到 1 时所有格子必已淡完，无残留被整片清除；
                // ③fade 用【线性】prog（全程匀速变淡，alpha 每帧等量下降，无"最后加速消失"感）。
                if (wind > 0 && delay[i] <= wind) {
                    const prog = Math.min(1, (wind - delay[i]) / 0.30);     // 0→1 淡出进度
                    alpha = Math.min(alpha, Math.max(0, Math.round(255 * (1 - prog))));  // 线性
                    if (alpha <= 4) continue;
                }
                drawSandPx(cx * CELL, py, alpha, shade[i], sandTone[i]);
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // —— bg-fx（末世废土背景 + 内含开始 UI）随吹散渐显 0→1 ——
        // 黄沙颗粒被吹走的同时开始 UI 从透明慢慢露出（用户："吹散过程中已能看到背后的开始UI"）
        const bgFxEl = document.getElementById('wsl-bg-fx');
        if (!bgFaded && wind > 0.02) { bgFaded = true; if (bgFxEl) bgFxEl.style.opacity = '0'; }
        if (bgFxEl) {
            if (bgFaded) {
                const k = Math.min(1, Math.max(0, (wind - 0.02) / 0.85));
                bgFxEl.style.opacity = String(Math.min(1, Math.max(0, k * 1.2)));
            } else {
                bgFxEl.style.opacity = '0';
            }
        }
        if (t >= 1) {
            ov.dataset.covered = '1';
            syncStartUI();
            if (bgFxEl) bgFxEl.style.opacity = '1';
            // v3.80 沙幕完全吹散 → 恢复开始 UI 交互（用户要求：完全消失后才能点按钮）
            const sEnd = document.getElementById('wsl-start');
            if (sEnd) sEnd.style.pointerEvents = 'auto';
            ov.remove();
            return;
        }
        requestAnimationFrame(tick);
    };
    function drawSandPx(x, y, alpha, sh, tone) {
        // x,y 为 CSS 像素 → 乘 dpr 得到设备像素（putImageData 按设备像素放置）
        const x0 = Math.max(0, Math.floor(x * dpr));
        const y0 = Math.max(0, Math.floor(y * dpr));
        const dw = Math.round(CELL * dpr);
        // v3.80 沙粒渲染：①格子内部径向明暗（中心亮、边缘暗 → 颗粒立体感）；
        // ②每格按 sandTone 选色（暮橙/黄褐/橙褐/深褐，与末世废土背景契合）。
        const T = SAND_TONES[tone & 3];
        const tr = T[0], tg = T[1], tb = T[2];
        const half = dw / 2;
        for (let yy = y0; yy < y0 + dw && yy < cv.height; yy++) {
            const rowBase = yy * cv.width;
            const dyN = ((yy - y0) - half) / half;      // -1~1
            for (let xx = x0; xx < x0 + dw && xx < cv.width; xx++) {
                const dxN = ((xx - x0) - half) / half;  // -1~1
                const rad = Math.sqrt(dxN * dxN + dyN * dyN);   // 0~1.4（中心0边缘~1）
                const fall = Math.max(0.45, 1 - rad * 0.75);    // 中心1 → 边缘0.45
                const br = 1 + sh + (fall - 0.7) * 0.5;         // 色差 + 径向明暗
                const j = (rowBase + xx) * 4;
                pxBuf[j]     = Math.min(255, Math.max(0, Math.round(tr * br)));
                pxBuf[j + 1] = Math.min(255, Math.max(0, Math.round(tg * br)));
                pxBuf[j + 2] = Math.min(255, Math.max(0, Math.round(tb * br)));
                pxBuf[j + 3] = alpha;
            }
        }
    }
    requestAnimationFrame(tick);
}

export function refresh() {
    renderList();
    renderDetail();
}

// v3.80 全局钩子：开始游戏 UI 内创建世界/角色后调用，让创意工坊存档管理列表立即刷新
// （无需刷新页面）。这样返回创意工坊时新存档立刻可见。
if (typeof window !== 'undefined') window.__wslWorkshopRefresh = refresh;

export default { refresh, getModState };
