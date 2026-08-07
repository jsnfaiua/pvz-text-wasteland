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
        settings: [
            { key: 'invasion', label: '尸潮', desc: '定时触发尸潮：僵尸从四面八方围攻，提前建造防御抵御' },
            { key: 'wildSpawn', label: '野外生物刷新', desc: '野外游荡僵尸 / 野生植物刷新（关闭可适配低配）' },
        ],
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
        opts: { invasion: true, wildSpawn: true, ...(m.opts || {}) },
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

    const settingsHtml = mod.settings.map(s => `
        <div class="ws-setting-row">
            <div class="ws-setting-text">
                <div class="ws-setting-label">${s.label}</div>
                <div class="ws-setting-desc">${s.desc}</div>
            </div>
            <button class="ws-toggle ${st.opts[s.key] ? 'on' : ''}" data-opt="${s.key}">
                <span class="ws-toggle-dot"></span>
            </button>
        </div>
    `).join('');

    // —— 荒原模组特判：难度选择 + 角色/世界（泰拉瑞亚式） + 存档显性化 ——
    let wastelandExtra = '';
    let enterBtnsHtml = '';
    if (mod.id === 'wasteland') {
        const diff = st.opts.difficulty || 'normal';
        const curOpts = st.opts || {};   // 显示设置（帧率/画质）读取
        const DIFFS = [
            { key: 'easy', name: '简单', desc: '敌人强度 ×0.8，死亡仅丢失部分背包' },
            { key: 'normal', name: '普通', desc: '敌人强度 ×1.0，死亡仅丢失部分背包' },
            { key: 'hard', name: '困难', desc: '敌人强度 ×1.25，死亡删除存档' },
            { key: 'hell', name: '地狱', desc: '敌人强度 ×1.5，死亡删除存档' },
        ];
        // 角色列表 + 当前组合（泰拉瑞亚式：角色跨世界保留物品/属性）
        const chars = getStorage('wasteland_characters', { names: [] });
        const prof = getStorage('wasteland_profile', null);
        const curChar = st.opts.characterName || (prof && prof.characterName) || (chars.names[0] || null);
        const charOptions = (chars.names || []).map(n =>
            `<option value="${n}"${n === curChar ? ' selected' : ''}>${n}</option>`).join('');
        const worldSeed = st.opts.seed != null ? st.opts.seed : (prof ? prof.worldSeed : null);
        // 枚举已有世界档（下拉选择：同角色选择方式——拉下选存档 / 选随机）
        const user = (getSession() && getSession().username) || '__guest__';
        const wPrefix = `u:${user}:wasteland_world_`;
        const worldList = [];
        for (let i = 0; i < localStorage.length; i++) {
            const full = localStorage.key(i);
            if (!full || !full.startsWith(wPrefix)) continue;
            const seedStr = full.slice(wPrefix.length);
            try {
                const raw = localStorage.getItem(full);
                if (raw == null) continue;
                const data = JSON.parse(raw);
                if (!data || typeof data.seed !== 'number') continue;
                worldList.push({ seed: data.seed, day: data.day || 1, mins: Math.floor((data.playT || 0) / 60) });
            } catch { /* 损坏键跳过 */ }
        }
        worldList.sort((a, b) => (b.seed - a.seed));
        const worldOptionsHtml = worldList.map(w =>
            `<option value="${w.seed}"${String(w.seed) === String(worldSeed) ? ' selected' : ''}>世界 #${w.seed} · 第${w.day}天 · 存活${w.mins}分</option>`).join('');
        wastelandExtra = `
            <div class="ws-section-title">难度（决定死亡惩罚）</div>
            <div class="wsl-diff-row">
                ${DIFFS.map(d => `<button class="wsl-diff-btn${diff === d.key ? ' on' : ''}" data-diff="${d.key}" title="${d.desc}">${d.name}</button>`).join('')}
            </div>
            <div class="ws-section-title">角色（物品与属性随角色带入任何世界）</div>
            <div class="wsl-char-row">
                <select id="ws-char-select" class="wsl-seed-input">
                    ${charOptions || '<option value="">（无角色）</option>'}
                </select>
                <button class="menu-btn ws-enter-btn" id="ws-char-new">新建角色</button>
            </div>
            <div class="ws-section-title">世界种子（下拉选择已有存档 / 随机 / 手动输入）</div>
            <div class="wsl-seed-row">
                <select id="ws-seed-select" class="wsl-seed-input">
                    <option value="">（随机种子 · 开新世界）</option>
                    ${worldOptionsHtml}
                    <option value="__manual__">✏ 手动输入种子…</option>
                </select>
                <input id="ws-seed-input" class="wsl-seed-input" placeholder="输入种子数字" maxlength="10" value="${st.opts.seed != null ? st.opts.seed : ''}" style="display:none;flex:1;">
                <button class="menu-btn ws-enter-btn" id="ws-seed-apply" style="display:none;">用此种子开新世界</button>
            </div>
            <div class="ws-section-title">联机（需先登录账户）</div>
            <div class="wsl-mp-row">
                <button class="menu-btn ws-enter-btn" id="ws-mp-host">创建联机房 ▶</button>
                <button class="menu-btn ws-enter-btn" id="ws-mp-join">加入联机房</button>
            </div>
            <div class="ws-section-title">显示设置（无需开发者模式）</div>
            <div class="wsl-mp-row" style="flex-wrap:wrap;gap:8px;">
                <button class="menu-btn ws-enter-btn${curOpts.showFps ? ' on' : ''}" id="ws-opt-fps" style="flex:1;min-width:120px;">帧率显示：${curOpts.showFps ? '开 ✓' : '关'}</button>
                <select id="ws-opt-gfx" class="wsl-seed-input" style="flex:1;min-width:120px;" title="画质档：低=分辨率0.75x+省特效，适合低配">
                    <option value="2"${curOpts.gfx === 2 || curOpts.gfx == null ? ' selected' : ''}>画质：高（完整效果）</option>
                    <option value="1"${curOpts.gfx === 1 ? ' selected' : ''}>画质：中（省特效）</option>
                    <option value="0"${curOpts.gfx === 0 ? ' selected' : ''}>画质：低（最流畅）</option>
                </select>
            </div>
            <div class="ws-section-title">存档管理（角色 / 世界 · 导出 / 删除）</div>
            <div class="wsl-save-mgr">
                <div class="wsl-save-ops">
                    <button class="menu-btn ws-enter-btn" id="ws-save-export">导出全部存档 ↓</button>
                    <button class="menu-btn ws-enter-btn" id="ws-save-import">导入存档 ↑</button>
                    <input type="file" id="ws-save-file" accept=".json,application/json" style="display:none">
                </div>
                <div id="ws-save-list" class="wsl-save-list"></div>
            </div>`;
        const saved = getStorage('wasteland_world_' + (worldSeed != null ? worldSeed : 'none'), null);
        const hasSave = !!saved;
        if (hasSave) {
            const bagN = (saved.inv || []).filter(Boolean).length;
            const mins = Math.floor((saved.playT || 0) / 60);
            wastelandExtra += `
            <div class="ws-section-title">当前存档</div>
            <div class="wsl-save-info">第 ${saved.day || 1} 天 · 存活 ${mins} 分钟${saved.homeBed ? ' · 已绑定床' : ''}</div>`;
        }
        enterBtnsHtml = `
            <button class="menu-btn ws-enter-btn" id="ws-enter" ${st.enabled ? '' : 'disabled'}>${hasSave ? '继续荒原 ▶' : '开始荒原 ▶'}</button>
            <button class="menu-btn ws-enter-btn ws-new-btn" id="ws-enter-new" ${st.enabled ? '' : 'disabled'}>新的荒原 ⟳</button>`;
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
            <div class="ws-section-title">模组设置</div>
            ${settingsHtml}
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
    document.getElementById('ws-enter')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        if (mod.id === 'wasteland') launchWasteland(cur.opts);
    });
    document.getElementById('ws-enter-new')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        if (mod.id !== 'wasteland') return;
        if (!confirm('将放弃当前世界存档，开启一个全新的随机世界（角色物品与属性保留）。确定吗？')) return;
        // 剔除残留 opts.seed：用户设过一次种子后 seed 会持久化，若残留则"新世界"仍用旧种子开档
        // （= 世界和旧种子一样，用户以为"读旧档"）。新世界默认随机种子，除非用「用此种子」显式指定。
        const { seed: _ignored, ...restOpts } = cur.opts;
        launchWasteland({ ...restOpts, forceNew: true });
    });

    // 角色：选择已有角色 / 新建角色（命名+捏脸，进入后自动落档）
    document.getElementById('ws-char-select')?.addEventListener('change', (e) => {
        setModState(mod.id, { opts: { characterName: e.target.value || undefined } });
        renderDetail();
    });
    document.getElementById('ws-char-new')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        if (mod.id !== 'wasteland') return;
        // 用随机名字触发创建流程（enterWasteland 检测到该角色无档 → 命名+捏脸）
        launchWasteland({ ...cur.opts, characterName: '__new__' + Date.now() });
    });

    // 世界种子下拉：选已有存档 → 继续该世界；选随机 → 开随机世界；选手动 → 显示输入框
    const seedSel = document.getElementById('ws-seed-select');
    const seedInput = document.getElementById('ws-seed-input');
    const seedApply = document.getElementById('ws-seed-apply');
    if (seedSel) seedSel.addEventListener('change', () => {
        const v = seedSel.value;
        if (v === '__manual__') {
            if (seedInput) seedInput.style.display = 'flex';
            if (seedApply) seedApply.style.display = '';
            return;
        }
        if (seedInput) seedInput.style.display = 'none';
        if (seedApply) seedApply.style.display = 'none';
        // 选已有世界：更新 opts.seed（进入时继续该世界档）；选空（随机）：清空 seed
        const newSeed = v ? Number(v) : undefined;
        setModState(mod.id, { opts: { seed: newSeed } });
        renderDetail();
    });
    // 手动输入种子 → 用此种子开新世界（强制新世界，与"继续"区分）
    document.getElementById('ws-seed-apply')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        const raw = (document.getElementById('ws-seed-input')?.value || '').trim();
        if (raw && !/^\d+$/.test(raw)) {
            const hint = document.getElementById('ws-hint');
            if (hint) { hint.textContent = '种子只能是数字（或留空随机）'; hint.classList.add('show'); }
            return;
        }
        const seed = raw ? parseInt(raw, 10) : undefined;
        if (!confirm(raw
            ? `用种子 #${seed} 开启一个新世界？当前世界存档将被覆盖（角色物品与属性保留）。`
            : '将放弃当前世界存档，开启一个随机种子世界（角色物品与属性保留）。')) return;
        setModState(mod.id, { opts: { seed } });
        launchWasteland({ ...getModState(mod.id).opts, forceNew: true, seed });
    });

    // 荒原联机入口：动态加载联机层，复用本体 Net.mp 房间层（见 mod-wasteland/mpWasteland.js）
    const launchMP = (role) => {
        import('../mod-wasteland/mpWasteland.js').then(m => {
            m.startWastelandMP(role, getModState(mod.id).opts);
        }).catch(err => {
            console.error('[wasteland-mp] 启动失败', err);
            const hint = document.getElementById('ws-hint');
            if (hint) {
                hint.textContent = '荒原联机启动失败：' + (err && err.message ? err.message : err);
                hint.classList.add('show');
            }
        });
    };
    document.getElementById('ws-mp-host')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        launchMP('host');
    });
    document.getElementById('ws-mp-join')?.addEventListener('click', () => {
        const cur = getModState(mod.id);
        if (!cur.enabled) return;
        launchMP('guest');
    });

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

    // —— 存档管理列表：枚举角色档/世界档，每项「导出」「删除」 ——
    if (mod.id === 'wasteland') renderSaveList(mod);

    // 显示设置：帧率开关 / 画质档（普通玩家可用，无需开发者模式；存 mod state）
    document.getElementById('ws-opt-fps')?.addEventListener('click', () => {
        if (mod.id !== 'wasteland') return;
        const cur = getModState(mod.id);
        setModState(mod.id, { opts: { showFps: !cur.opts.showFps } });
        renderDetail();
    });
    document.getElementById('ws-opt-gfx')?.addEventListener('change', (e) => {
        if (mod.id !== 'wasteland') return;
        setModState(mod.id, { opts: { gfx: Number(e.target.value) } });
    });

    // 难度选择（荒原模组）
    box.querySelectorAll('.wsl-diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setModState(mod.id, { opts: { difficulty: btn.dataset.diff } });
            renderDetail();
        });
    });
}

// 存档管理列表：枚举当前账户所有角色档/世界档，每项支持单档导出 / 删除
function renderSaveList(mod) {
    const user = (getSession() && getSession().username) || '__guest__';
    const prefix = `u:${user}:wasteland_`;
    const chars = getStorage('wasteland_characters', { names: [] });
    const charNames = new Set(chars.names || []);
    const roles = [], worlds = [];
    for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        if (!full || !full.startsWith(prefix)) continue;
        const base = full.slice(prefix.length);   // 如 character_阿远 / world_123
        try {
            const raw = localStorage.getItem(full);
            if (raw == null) continue;
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') continue;
            if (base.startsWith('character_')) {
                const name = base.slice('character_'.length);
                const invN = (data.inv || []).filter(Boolean).length;
                const hp = data.hp != null ? data.hp : (data.maxHp != null ? data.maxHp : '?');
                const isCur = name === (getStorage('wasteland_profile', null) || {}).characterName;
                roles.push({ name, invN, hp, isCur });
            } else if (base.startsWith('world_')) {
                const seed = base.slice('world_'.length);
                const day = data.day || 1;
                const mins = Math.floor((data.playT || 0) / 60);
                const zN = (data.zombies || []).filter(z => z && z.isPlayerZombie).length;
                const isCur = String(seed) === String((getStorage('wasteland_profile', null) || {}).worldSeed);
                worlds.push({ seed, day, mins, zN, isCur });
            }
        } catch { /* 单键损坏跳过 */ }
    }
    // 角色排序：当前角色优先，其余按名字
    roles.sort((a, b) => (b.isCur ? 1 : 0) - (a.isCur ? 1 : 0) || a.name.localeCompare(b.name));
    worlds.sort((a, b) => (b.isCur ? 1 : 0) - (a.isCur ? 1 : 0) || (Number(b.seed) - Number(a.seed)));
    const el = document.getElementById('ws-save-list');
    if (!el) return;
    if (!roles.length && !worlds.length) {
        el.innerHTML = '<div class="wsl-save-empty">暂无存档 —— 创建角色并游玩后自动生成（角色档 + 世界档）</div>';
        return;
    }
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const roleHtml = roles.map(r => `
        <div class="wsl-save-item${r.isCur ? ' cur' : ''}">
            <div class="wsl-save-meta">
                <span class="wsl-save-name">${esc(r.name)}${r.isCur ? ' · 当前' : ''}</span>
                <span class="wsl-save-sub">背包 ${r.invN} 件 · HP ${r.hp}</span>
            </div>
            <div class="wsl-save-btns">
                <button class="menu-btn wsl-save-btn" data-act="export" data-kind="character" data-name="${esc(r.name)}">导出</button>
                <button class="menu-btn wsl-save-btn danger" data-act="del" data-kind="character" data-name="${esc(r.name)}">删除</button>
            </div>
        </div>`).join('');
    const worldHtml = worlds.map(w => `
        <div class="wsl-save-item${w.isCur ? ' cur' : ''}">
            <div class="wsl-save-meta">
                <span class="wsl-save-name">世界 #${esc(w.seed)}${w.isCur ? ' · 当前' : ''}</span>
                <span class="wsl-save-sub">第 ${w.day} 天 · 存活 ${w.mins} 分钟${w.zN ? ` · 尸化的自己 ×${w.zN}` : ''}</span>
            </div>
            <div class="wsl-save-btns">
                <button class="menu-btn wsl-save-btn" data-act="export" data-kind="world" data-seed="${esc(w.seed)}">导出</button>
                <button class="menu-btn wsl-save-btn danger" data-act="del" data-kind="world" data-seed="${esc(w.seed)}">删除</button>
            </div>
        </div>`).join('');
    el.innerHTML = (roles.length ? `<div class="wsl-save-group">角色（${roles.length}）</div>${roleHtml}` : '') +
        (worlds.length ? `<div class="wsl-save-group">世界（${worlds.length}）</div>${worldHtml}` : '');

    // 绑定：导出单档（与全量备份同格式 __wslBackup，仅含该键） / 删除单档
    el.querySelectorAll('.wsl-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const act = btn.dataset.act;
            const kind = btn.dataset.kind;
            const fullKey = kind === 'character'
                ? `${prefix}character_${btn.dataset.name}`
                : `${prefix}world_${btn.dataset.seed}`;
            const base = fullKey.slice(prefix.length);
            if (act === 'export') {
                let raw = null;
                try { raw = JSON.parse(localStorage.getItem(fullKey)); } catch { raw = null; }
                if (!raw) { hintMsg('该存档已损坏或不存在'); return; }
                const data = { __wslBackup: 1, exportedAt: Date.now(), username: user, entries: { [base]: raw } };
                const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `wasteland-${kind === 'character' ? 'char-' + btn.dataset.name : 'world-' + btn.dataset.seed}.json`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
                hintMsg(`已导出 ${kind === 'character' ? '角色「' + btn.dataset.name + '」' : '世界 #' + btn.dataset.seed}（可导入回任意浏览器）`);
                return;
            }
            // 删除
            const label = kind === 'character' ? `角色「${btn.dataset.name}」` : `世界 #${btn.dataset.seed}`;
            if (!confirm(`⚠ 删除${label}存档？此操作不可恢复。\n\n（角色档：背包/属性；世界档：该世界全部地形/箱子/尸化自己）`)) return;
            localStorage.removeItem(fullKey);
            // 清理角色索引（character 时）
            if (kind === 'character') {
                const cl = getStorage('wasteland_characters', { names: [] });
                cl.names = (cl.names || []).filter(n => n !== btn.dataset.name);
                setStorage('wasteland_characters', cl);
            }
            // 若删除的是当前 profile 指向的档 → 重置 profile 防读到已删档
            const prof = getStorage('wasteland_profile', null);
            if (prof && kind === 'character' && prof.characterName === btn.dataset.name) {
                setStorage('wasteland_profile', { ...prof, characterName: null });
            } else if (prof && kind === 'world' && String(prof.worldSeed) === btn.dataset.seed) {
                setStorage('wasteland_profile', { ...prof, worldSeed: null });
            }
            hintMsg(`已删除${label}`);
            renderDetail();   // 重渲染列表
        });
    });
}

function hintMsg(text) {
    const hint = document.getElementById('ws-hint');
    if (hint) { hint.textContent = text; hint.classList.add('show'); }
}

export function refresh() {
    renderList();
    renderDetail();
}

export default { refresh, getModState };
