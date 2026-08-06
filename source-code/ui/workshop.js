// ============================================================
// 创意工坊：模组订阅 / 管理界面
// 模组状态独立存储（saveData 之外），符合模组沙盒隔离原则
// ============================================================

import { getStorage, setStorage } from '../persistence/storage.js';

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
            <div class="ws-section-title">世界种子（可修改后开新世界）</div>
            <div class="wsl-seed-row">
                <input id="ws-seed-input" class="wsl-seed-input" placeholder="${worldSeed != null ? '当前 ' + worldSeed + ' · 留空开随机世界' : '留空 = 随机种子'}" maxlength="10" value="${st.opts.seed != null ? st.opts.seed : ''}">
                <button class="menu-btn ws-enter-btn" id="ws-seed-apply">用此种子开新世界</button>
            </div>
            <div class="ws-section-title">联机（需先登录账户）</div>
            <div class="wsl-mp-row">
                <button class="menu-btn ws-enter-btn" id="ws-mp-host">创建联机房 ▶</button>
                <button class="menu-btn ws-enter-btn" id="ws-mp-join">加入联机房</button>
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
        launchWasteland({ ...cur.opts, forceNew: true });
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

    // 世界种子：查看/修改（输入新种子 → 开新世界）
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

    // 难度选择（荒原模组）
    box.querySelectorAll('.wsl-diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setModState(mod.id, { opts: { difficulty: btn.dataset.diff } });
            renderDetail();
        });
    });
}

export function refresh() {
    renderList();
    renderDetail();
}

export default { refresh, getModState };
