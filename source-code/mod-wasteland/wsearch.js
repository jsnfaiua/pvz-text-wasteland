// ============================================================
// 【无尽植僵荒原】模组 · 搜刮界面（开箱过程 + 拖拽背包）
// 开箱音效后进入搜索：进度条按物品数/稀有度推进、逐件揭示；
// 完成后可点击拿取、拖拽丢弃/入包/绑定快捷栏。
// ============================================================

import { WEAPONS } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import { TS } from './wconst.js';
import * as Panel from './panel.js';

let ui = null;
let drag = null;
let ghost = null;
let opts = null;   // { onUseItem }
let curSv = null;

const RARITY_NAME = { common: '普通', rare: '稀有', epic: '史诗' };
const RARITY_TIME = { common: 1.0, rare: 1.8, epic: 2.8 };   // 每件物品的独立揭示时长（稀有越长，渐变越明显）
const RARITY_BORDER = { common: '#55606b', rare: '#4da3ff', epic: '#ffb347' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 揭示渐变强度按稀有度：稀有/史诗淡入段更长、渐亮过程带光晕
const RARITY_FADE = {
    common: { fade: 0.7 },
    rare:   { fade: 0.5, glow: 8, glowColor: 'rgba(77,163,255,0.55)' },
    epic:   { fade: 0.35, glow: 14, glowColor: 'rgba(255,179,71,0.7)' },
};

function itemRarity(id) {
    if (id.startsWith('wpn:')) {
        const w = WEAPONS[id.slice(4)];
        return (w && w.rarity) || 'common';
    }
    if (id === 'gem') return 'epic';
    if (id.startsWith('ammo:') || id === 'part' || id.startsWith('seed:')) return 'rare';
    return 'common';
}

export function isOpen() { return !!ui; }

// ---------- 打开搜索 ----------
// sv.search = { items:[{id,n,revealT,dur,done}], progress, time, done, name, gx, gy }
// 每件物品有独立的揭示开始时间（revealT）与揭示时长（dur，按稀有度）：
// 揭示顺序 = 格子从左到右、从上到下（未完成物品按槽位升序排列）。
// meta.immediate: 跳过搜索进度，直接揭示所有物品（已开过的箱子/战利品袋）
// meta.items[].done: 逐件完成状态（上次搜索已完成的物品直接显示，不重新搜索）
export function openSearch(sv, meta, options) {
    if (ui) closeSearch(sv, true);
    opts = options || {};
    curSv = sv;
    // 2026-08-10 搜索界面打开时角色静止：清空移动键（防止打开前按住的方向键继续走位）
    if (sv && sv.keys) for (const k of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) sv.keys[k] = false;
    const immediate = meta.immediate;
    // 容器容量：左侧格子数 = 容器可存物品数（默认=本次物品数）
    const cap = Math.max(meta.cap || 0, meta.items.length);
    // 物品槽位：确定性散落（基于箱子坐标 + 物品 id）——
    // 首次打开算出后回写 it.slot，关闭时由 onClose 持久化；重开沿用存储槽位，
    // 部分拿取/部分搜索后重开，每件物品位置绝对不变（不自动整理重排）
    const used = new Set();
    const slotOf = meta.items.map((it) => {
        let s = (typeof it.slot === 'number' && it.slot >= 0 && it.slot < cap) ? it.slot : null;
        if (s === null) {
            let h = ((meta.gx || 0) * 131 + (meta.gy || 0) * 17) >>> 0;
            for (const ch of it.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
            s = h % cap;
        }
        while (used.has(s)) s = (s + 1) % cap;
        used.add(s);
        it.slot = s;
        return s;
    });
    // 未完成物品按槽位升序（从左到右、从上到下）分配揭示时刻；
    // 已完成物品不占揭示时间，直接显示
    const pending = [];
    meta.items.forEach((it, i) => {
        if (!(immediate || it.done)) pending.push({ i, slot: slotOf[i] });
    });
    pending.sort((a, b) => a.slot - b.slot);
    let acc = 0.5;   // 初始延迟：第一个物品也有完整渐亮过程
    pending.forEach(p => {
        p.revealT = acc;
        acc += RARITY_TIME[itemRarity(meta.items[p.i].id)] || 1.0;
    });
    const items = meta.items.map((it, i) => {
        const dur = RARITY_TIME[itemRarity(it.id)] || 1.0;
        const done = immediate || !!it.done;
        const p = done ? null : pending.find(x => x.i === i);
        // 已完成直接揭示：played 预设为 true，不再播放弹出动画
        return { id: it.id, n: it.n, revealT: p ? p.revealT : 0, dur, slot: slotOf[i], done, played: done };
    });
    const allDone = pending.length === 0;
    sv.search = {
        items,
        cap,
        progress: allDone ? acc : 0,
        time: acc,
        done: allDone,
        name: meta.name,
        lootBag: meta.lootBag || null,
        onClose: meta.onClose || null,
        gx: meta.gx, gy: meta.gy,
        corpseFull: meta.corpseFull || null,   // 2026-08-11 尸体搜索：完整物品对象映射（拿取保留耐久/附魔等属性）
    };
    if (allDone) AudioSystem.playCollect();
    buildUI(sv);
    render(sv);
}

// ---------- 每帧推进（暂停世界时仍在进行；附近队友帮忙搜索会加速） ----------
export function updateSearch(sv, dt) {
    const s = sv.search;
    if (!s || s.done) return;
    // 队友协助：玩家周围 4 格内每名存活队员，搜索速度 +50%
    let assist = 1;
    if (sv.npcs) {
        const helpers = sv.npcs.filter(n => n.alive && n.party && n.state === 'follow'
            && Math.hypot(n.x - sv.px, n.y - sv.py) < 4 * TS).length;
        assist = 1 + 0.5 * helpers;
    }
    s.progress += dt * assist;
    // 每件物品按各自的揭示区间（revealT ~ revealT+dur）独立完成；
    // revealT/dur 固定，拾取已完成的物品不影响后方物品进度
    let changed = false;
    for (const it of s.items) {
        if (!it.done && it.revealT + it.dur <= s.progress) { it.done = true; changed = true; }
    }
    if (s.progress >= s.time) {
        s.done = true;
        for (const it of s.items) if (!it.done) { it.done = true; changed = true; }
        AudioSystem.playCollect();
    }
    // 每帧重绘：格子按各自进度由暗渐亮，完成时显示物品并高亮稀有
    updateProgressUI(s);
    renderFindings(sv);
}

// ---------- 关闭（战利品：余量留在原地不丢出，掏空则移除；普通搜刮可丢出） ----------
export function closeSearch(sv, dropRemaining) {
    const s = sv.search;
    if (s) {
        if (s.lootBag) {
            if (!s.lootBag.items.length) {
                if (sv.lootBags) {
                    const idx = sv.lootBags.indexOf(s.lootBag);
                    if (idx >= 0) sv.lootBags.splice(idx, 1);
                }
                if (sv.interior && sv.interior.lootBags) {
                    const idx = sv.interior.lootBags.indexOf(s.lootBag);
                    if (idx >= 0) sv.interior.lootBags.splice(idx, 1);
                }
            }
        } else if (s.onClose) {
            // 关闭：过滤已取走（taken）的物品，剩余写回（n 已随部分拿取更新）；
            // 每件物品带 r = 是否已搜索完成、slot = 原散落槽位（重开位置绝对不变）
            s.onClose(s.items.filter(it => !it.taken).map(it => ({ id: it.id, n: it.n, r: it.done, slot: it.slot })), s.done);
        } else if (dropRemaining && s.items) {
            for (const it of s.items) dropOnGround(sv, it.id, it.n);
        }
    }
    sv.search = null;
    teardownUI();
    curSv = null;
}

function dropOnGround(sv, id, n) {
    const a = Math.random() * Math.PI * 2, d = (0.5 + Math.random()) * TS;
    sv.drops.push({ x: sv.px + Math.cos(a) * d, y: sv.py + Math.sin(a) * d, id, n });
}

// 拿取/丢弃后：物品留在原位标记"已取"（格子显示 ✓，位置保持，UI 不重排）；关闭时统一过滤
function removeSearchItem(s, idx) {
    if (s && s.items[idx]) s.items[idx].taken = true;
}

// ============================================================
// UI
// ============================================================
function buildUI(sv) {
    ui = document.createElement('div');
    ui.id = 'wsl-search';
    ui.className = 'wsl-search';
    ui.innerHTML =
        '<div class="wsl-search-wrap">' +
        '  <div class="wsl-bag-head"><span id="wsl-s-title"></span>' +
        '    <span class="wsl-search-status" id="wsl-s-status"></span>' +
        '    <button class="wsl-close-btn wsl-s-close" title="关闭 (ESC/F/B)">×</button></div>' +
        Panel.legendHtml() +
        '  <div class="wsl-chest-cols">' +
        '    <div><div class="wsl-chest-title">容器</div><div class="wsl-findings" id="wsl-s-findings"></div></div>' +
        '    <div><div class="wsl-chest-title">背包</div><div class="wsl-bag-grid wsl-s-bag" id="wsl-s-bag"></div></div>' +
        '  </div>' +
        '  <div class="wsl-search-head sub">快捷栏 · 可拖入绑定</div>' +
        '  <div class="wsl-search-hot" id="wsl-s-hot"></div>' +
        '  <div class="wsl-discard" id="wsl-discard" data-drag-drop="discard">拖到此处丢弃</div>' +
        '</div>';
    document.getElementById('game-container').appendChild(ui);
    ui.querySelector('.wsl-s-close').addEventListener('click', () => closeSearch(curSv, false));
    ui.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}

function teardownUI() {
    if (!ui) return;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    ui.remove();
    ui = null;
    clearDrag();
}

function cellHtml(item, srcTag, dropTag) {
    if (!item) return `<div class="wsl-cell wsl-empty" data-drag-drop="${dropTag}"></div>`;
    const info = Panel.getItemInfo(item.id);
    const rar = itemRarity(item.id);
    const catColor = Panel.CAT_INFO[Panel.itemCategory(item.id)].color;
    const name = info.name;
    const len = name.length;
    const fs = len <= 2 ? 24 : (len === 3 ? 16 : (len === 4 ? 12 : 10));
    return `<div class="wsl-cell wsl-drag r-${rar}" data-drag-src="${srcTag}" data-drag-drop="${dropTag}" data-item="${item.id}" style="border-color:${catColor}" title="${name} · ${Panel.itemDesc(item.id)}">` +
        `<span class="wsl-cell-char" style="color:${info.color};font-size:${fs}px">${name}</span>` +
        (item.n > 1 ? `<span class="wsl-cell-n">${item.n}</span>` : '') +
        `</div>`;
}

function render(sv) {
    renderTitle(sv);
    renderFindings(sv);
    renderBag(sv);
    renderHotbar(sv);
    updateProgressUI(sv.search);
    bindDetailEvents();
}

function renderTitle(sv) {
    const t = ui.querySelector('#wsl-s-title');
    if (t) t.textContent = `搜 索 · ${sv.search.name}`;
    const lt = ui.querySelector('#wsl-s-ltitle');
    if (lt) lt.textContent = sv.search.name;
}

function updateProgressUI(s) {
    if (!ui) return;
    const st = ui.querySelector('#wsl-s-status');
    if (st) {
        const done = s.items.filter(it => it.done).length;
        st.textContent = s.done
            ? '搜索完成 · 点击物品拿取，拖出即丢弃'
            : `搜索中… ${done}/${s.items.length}`;
    }
}

function renderFindings(sv) {
    const box = ui.querySelector('#wsl-s-findings');
    if (!box) return;
    const s = sv.search;
    // 槽位 → 物品（含 items 索引）：左侧格子数 = 容器容量 cap，物品散落于随机槽位
    const slotToItem = new Map();
    s.items.forEach((it, idx) => slotToItem.set(it.slot, { it, idx }));
    // DOM 复用：未完成格每帧更新样式（渐亮/淡入），完成格一次性插入（带 pop 动画），
    // 已取格显示 ✓ 位置保持——保证"物品搜索出来瞬间"的高亮动画能完整播放不被中断。
    for (let i = 0; i < s.cap; i++) {
        const entry = slotToItem.get(i);
        const it = entry ? entry.it : null;
        let el = box.children[i];
        if (!el) { el = document.createElement('div'); box.appendChild(el); }
        if (!it) {
            // 空槽位：暗格（无内容），位置保持；可拖入物品（背包/快捷栏/容器物品）
            if (el._doneItem !== null || !el._emptyShown) {
                el._doneItem = null;
                el._emptyShown = true;
                el.className = 'wsl-cell wsl-unfound';
                el.style.cssText = '';
                delete el.dataset.item;
                delete el.dataset.dragSrc;
                el.dataset.dragDrop = 'searchempty:' + i;
                el.title = '';
                el.innerHTML = '';
            }
        } else if (it.taken) {
            // 已取走：空位（与空槽位同色，无勾号），位置保持；可拖入物品
            if (el._doneItem !== it || !el._takenShown) {
                el._doneItem = it;
                el._takenShown = true;
                el.className = 'wsl-cell wsl-unfound';
                el.style.cssText = '';
                el.title = '';
                delete el.dataset.item;
                delete el.dataset.dragSrc;
                el.dataset.dragDrop = 'searchempty:' + i;
                el.innerHTML = '';
            }
        } else if (it.done) {
            if (el._doneItem !== it || el._doneN !== it.n) {
                el._doneItem = it;
                el._doneN = it.n;
                const rar = itemRarity(it.id);
                const first = !it.played;
                if (first) it.played = true;
                const pop = first && rar !== 'common' ? ` wsl-pop-${rar}` : '';
                const info = Panel.getItemInfo(it.id);
                const len = info.name.length;
                const fs = len <= 2 ? 24 : (len === 3 ? 16 : (len === 4 ? 12 : 10));
                const catColor = Panel.CAT_INFO[Panel.itemCategory(it.id)].color;
                // 背景从白色平滑转回暗色物品格（transition 过渡，避免白→暗跳变）
                el.style.cssText = 'transition:background 0.3s ease, border-color 0.15s';
                el.className = 'wsl-cell wsl-drag r-' + rar + pop;
                el.style.borderColor = catColor;
                el.title = `${info.name} · ${Panel.itemDesc(it.id)}`;
                el.dataset.dragSrc = `search:${entry.idx}`;
                el.dataset.dragDrop = `search:${entry.idx}`;
                el.dataset.item = it.id;
                el.innerHTML = `<span class="wsl-cell-char" style="color:${info.color};font-size:${fs}px">${info.name}</span>` +
                    (it.n > 1 ? `<span class="wsl-cell-n">${it.n}</span>` : '');
            }
        } else {
            el._doneItem = null;
            el._doneN = null;
            delete el.dataset.item;
            delete el.dataset.dragSrc;
            delete el.dataset.dragDrop;
            const p = clamp((s.progress - it.revealT) / it.dur, 0, 1);
            const rar = itemRarity(it.id);
            const cfg = RARITY_FADE[rar] || RARITY_FADE.common;
            if (p < cfg.fade) {
                // 阶段1 · 亮起：背景从纯黑渐变到亮灰白，? 取反保持对比；
                // 稀有/史诗渐变到纯白并带彩色光晕（蓝/金随进度增强）——黑白渐变中透出稀有颜色的光。
                const t = p / cfg.fade;
                const v = Math.round(t * (cfg.glow ? 255 : 220));
                const glow = cfg.glow ? `;box-shadow:0 0 ${Math.round(cfg.glow * t * 1.5)}px ${cfg.glowColor}` : '';
                el.className = 'wsl-cell wsl-unfound';
                el.style.cssText = `background:rgb(${v},${v},${v});color:rgb(${255 - v},${255 - v},${255 - v});transition:background 0.06s linear;opacity:${(0.5 + 0.5 * t).toFixed(2)}${glow}`;
                el.innerHTML = '?';
            } else {
                // 阶段2 · 浮现：格子 opacity 保持 1（不跳变），物品名 span 透明度淡入；
                // 背景从亮灰平滑转回暗绿物品格，终点 = 完成格背景（rgb 11,20,11），衔接零跳变。
                const info = Panel.getItemInfo(it.id);
                const len = info.name.length;
                const fs = len <= 2 ? 24 : (len === 3 ? 16 : (len === 4 ? 12 : 10));
                const t2 = (p - cfg.fade) / (1 - cfg.fade);
                const alpha = t2.toFixed(2);
                const r = Math.round(220 + (11 - 220) * t2);
                const g = Math.round(220 + (20 - 220) * t2);
                const b = Math.round(220 + (11 - 220) * t2);
                const glow = cfg.glow ? `;box-shadow:0 0 ${Math.round(cfg.glow * (0.4 + 0.6 * t2))}px ${cfg.glowColor}` : '';
                el.className = 'wsl-cell wsl-reveal-item';
                el.style.cssText = `background:rgb(${r},${g},${b});opacity:1;transition:background 0.06s linear${glow}`;
                el.innerHTML = `<span class="wsl-cell-char" style="color:${info.color};font-size:${fs}px;opacity:${alpha}">${info.name}</span>`;
            }
        }
    }
    while (box.children.length > s.cap) box.removeChild(box.lastChild);
    bindDetailEvents();
}

function renderBag(sv) {
    const box = ui.querySelector('#wsl-s-bag');
    if (!box) return;
    // DOM 复用：只更新内容变化的背包格，避免拿取/整理时整格重建闪烁
    for (let i = 0; i < sv.inv.length; i++) {
        let el = box.children[i];
        if (!el) { el = document.createElement('div'); box.appendChild(el); }
        const s = sv.inv[i];
        const key = s ? s.id + ':' + s.n + ':' + (s.eq ? 'e' : '') : '';
        if (el._bagKey !== key) {
            const tmp = document.createElement('div');
            tmp.innerHTML = cellHtml(s, 'bag:' + i, 'bag:' + i);
            const newEl = tmp.firstChild;
            newEl._bagKey = key;
            el.replaceWith(newEl);
        }
    }
    while (box.children.length > sv.inv.length) box.lastChild.remove();
}

function renderHotbar(sv) {
    const box = ui.querySelector('#wsl-s-hot');
    if (!box) return;
    let html = '';
    for (let i = 0; i < sv.hotbar.length; i++) {
        const id = sv.hotbar[i];
        if (id) {
            const info = Panel.getItemInfo(id);
            // data-drag-src：快捷栏物品可拖出（拖到背包=取消绑定、拖到丢弃/容器=取消绑定、拖到另一格=移动绑定）
            html += `<div class="wsl-hot-cell" data-drag-src="hotbar:${i}" data-drag-drop="hotbar:${i}" title="${info.name} · 右键取消绑定" data-hot="${i}" data-item="${id}">` +
                `<span class="wsl-hot-key">${i + 1}</span>` +
                `<span class="wsl-cell-char" style="color:${info.color}">${info.char}</span></div>`;
        } else {
            html += `<div class="wsl-hot-cell wsl-empty" data-drag-drop="hotbar:${i}"><span class="wsl-hot-key">${i + 1}</span></div>`;
        }
    }
    box.innerHTML = html;
    // 右键快捷栏格 = 取消绑定
    box.querySelectorAll('[data-hot]').forEach(el => {
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            const i = parseInt(el.dataset.hot);
            if (!sv.hotbar[i]) return;
            sv.hotbar[i] = null;
            AudioSystem.playClick();
            renderHotbar(sv);
        });
    });
}

function rerender(sv) { renderFindings(sv); renderBag(sv); renderHotbar(sv); bindDetailEvents(); }

function bindDetailEvents() {
    if (!ui) return;
    ui.querySelectorAll('.wsl-cell[data-item]').forEach(el => {
        if (el._detailBound) return;
        el._detailBound = true;
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            const src = el.dataset.dragSrc;
            if (!src) { Panel.showItemDetail(el.dataset.item); return; }
            const [kind, idxStr] = src.split(':');
            const idx = parseInt(idxStr);
            if (kind === 'search') {
                Panel.showItemDetail(el.dataset.item, () => {
                    const sv = curSv;
                    if (!sv || !sv.search) return;
                    const it = sv.search.items[idx];
                    if (!it || !it.done) return;
                    dropOnGround(sv, it.id, it.n);
                    removeSearchItem(sv.search, idx);
                    rerender(sv);
                });
            } else if (kind === 'bag') {
                Panel.showItemDetail(el.dataset.item, () => {
                    const sv = curSv;
                    if (!sv) return;
                    const it = sv.inv[idx];
                    if (!it) return;
                    dropOnGround(sv, it.id, it.n);
                    sv.inv[idx] = null;
                    rerender(sv);
                });
            } else {
                Panel.showItemDetail(el.dataset.item);
            }
        });
    });
}

// ============================================================
// 点击 / 拖拽
// ============================================================
function parseTag(tag) {
    if (!tag) return null;
    const [kind, idx] = tag.split(':');
    return { kind, idx: idx == null ? -1 : parseInt(idx) };
}

function itemAt(sv, kind, idx) {
    if (kind === 'search') return sv.search && sv.search.items[idx];
    if (kind === 'bag') return sv.inv[idx];
    if (kind === 'hotbar') {
        const id = sv.hotbar[idx];
        return id ? { id, n: 1 } : null;   // 快捷栏是引用（虚拟物品），拖出=取消绑定
    }
    return null;
}

function onPointerDown(e) {
    if (e.button !== 0) return;
    const src = e.target.closest('[data-drag-src]');
    if (!src) return;
    const { kind, idx } = parseTag(src.dataset.dragSrc);
    const sv = currentSv();
    if (!sv) return;
    const item = itemAt(sv, kind, idx);
    if (!item) return;
    drag = { kind, idx, item, srcEl: src, startX: e.clientX, startY: e.clientY, moved: false };
    e.preventDefault();
}

function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
        drag.moved = true;
        // 拖拽跟随：ghost 与源格同款外观（物品名+数量+分类色边框），拖动时源格保持原样
        ghost = document.createElement('div');
        ghost.className = 'wsl-drag-ghost';
        const info = Panel.getItemInfo(drag.item.id);
        const len = info.name.length;
        const fs = len <= 2 ? 24 : (len === 3 ? 16 : (len === 4 ? 12 : 10));
        const catColor = Panel.CAT_INFO[Panel.itemCategory(drag.item.id)].color;
        ghost.style.borderColor = catColor;
        ghost.innerHTML = `<span class="wsl-cell-char" style="color:${info.color};font-size:${fs}px">${info.name}</span>` +
            (drag.item.n > 1 ? `<span class="wsl-cell-n">${drag.item.n}</span>` : '');
        document.body.appendChild(ghost);
    }
    if (drag.moved && ghost) {
        ghost.style.left = (e.clientX + 10) + 'px';
        ghost.style.top = (e.clientY + 10) + 'px';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const over = el && el.closest('[data-drag-drop]');
        ui.querySelectorAll('.wsl-drop-hl').forEach(x => x.classList.remove('wsl-drop-hl'));
        if (over) over.classList.add('wsl-drop-hl');
    }
}

function onPointerUp(e) {
    if (!drag) return;
    const sv = currentSv();
    if (!drag.moved) {
        handleClick(sv, drag);
    } else {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const over = el && el.closest('[data-drag-drop]');
        if (over) handleDrop(sv, drag, parseTag(over.dataset.dragDrop));
    }
    clearDrag();
    if (sv) rerender(sv);
}

function clearDrag() {
    if (ghost) { ghost.remove(); ghost = null; }
    if (ui) ui.querySelectorAll('.wsl-drop-hl').forEach(el => el.classList.remove('wsl-drop-hl'));
    drag = null;
}

// 未拖动 → 视为点击：搜索格=拿取入包；背包格=使用物品
function handleClick(sv, d) {
    if (d.kind === 'search') {
        takeFromSearch(sv, d.idx, null);
    } else if (d.kind === 'bag') {
        if (opts && opts.onUseItem) opts.onUseItem(d.idx);
    }
}

function handleDrop(sv, d, target) {
    if (!target) return;
    const searchDone = (idx) => { const it = sv.search && sv.search.items[idx]; return !!(it && it.done); };
    const unbindHotbar = (idx) => { if (sv.hotbar[idx] != null) sv.hotbar[idx] = null; };
    if (target.kind === 'discard') {
        if (d.kind === 'search') {
            if (!searchDone(d.idx)) return;
            const it = sv.search.items[d.idx];
            dropOnGround(sv, it.id, it.n);
            removeSearchItem(sv.search, d.idx);
        } else if (d.kind === 'bag') {
            const it = sv.inv[d.idx];
            dropOnGround(sv, it.id, it.n);
            sv.inv[d.idx] = null;
        } else if (d.kind === 'hotbar') {
            unbindHotbar(d.idx);   // 拖到丢弃区 = 取消快捷栏绑定
        }
        AudioSystem.playPlantDig();
    } else if (target.kind === 'bag') {
        if (d.kind === 'hotbar') {
            unbindHotbar(d.idx);   // 拖到背包 = 取消绑定（物品本就在背包）
            AudioSystem.playClick();
        } else {
            dropToBag(sv, d, target.idx);
        }
    } else if (target.kind === 'hotbar') {
        if (d.kind === 'hotbar') {
            // 快捷栏 → 快捷栏：移动绑定（源槽清空）
            if (d.idx === target.idx) return;
            sv.hotbar[target.idx] = d.item.id;
            sv.hotbar[d.idx] = null;
            AudioSystem.playClick();
        } else {
            if (d.kind === 'search' && searchDone(d.idx)) {
                const it = sv.search.items[d.idx];
                const left = Panel.addItem(sv, it.id, it.n);
                if (left < it.n) { it.n = left; if (left <= 0) removeSearchItem(sv.search, d.idx); }
            } else if (d.kind === 'bag') {
                // 背包 → 快捷栏：直接绑定（物品保留在背包）
                const it = sv.inv[d.idx];
                if (!it) return;
            }
            sv.hotbar[target.idx] = d.item.id;
            AudioSystem.playClick();
        }
    } else if (target.kind === 'search') {
        // 容器已完成格：search↔search 交换位置 / bag/hotbar 放入或合并
        const targetIt = sv.search.items[target.idx];
        if (d.kind === 'search') {
            if (!searchDone(d.idx) || !targetIt || !targetIt.done) return;
            if (d.idx === target.idx) return;
            const a = sv.search.items[d.idx], b = targetIt;
            const t = a.slot; a.slot = b.slot; b.slot = t;   // 交换槽位
            AudioSystem.playClick();
        } else if (d.kind === 'bag') {
            const it = sv.inv[d.idx];
            if (!it) return;
            if (targetIt.id === it.id) {
                const add = Math.min(99 - targetIt.n, it.n);   // 同类堆叠
                targetIt.n += add; it.n -= add;
                if (it.n <= 0) sv.inv[d.idx] = null;
                AudioSystem.playCollect();
            } else {
                // 异类：交换（容器物品放回背包源格）
                const tmp = { id: it.id, n: it.n };
                sv.inv[d.idx] = { id: targetIt.id, n: targetIt.n };
                targetIt.id = tmp.id; targetIt.n = tmp.n;
                AudioSystem.playClick();
            }
        } else if (d.kind === 'hotbar') {
            unbindHotbar(d.idx);   // 快捷栏 → 容器：取消绑定
            const bi = sv.inv.findIndex(x => x && x.id === d.item.id);
            if (bi >= 0) {
                const it = sv.inv[bi];
                if (targetIt.id === it.id) {
                    const add = Math.min(99 - targetIt.n, it.n);
                    targetIt.n += add; it.n -= add;
                    if (it.n <= 0) sv.inv[bi] = null;
                } else {
                    const tmp = { id: it.id, n: it.n };
                    sv.inv[bi] = { id: targetIt.id, n: targetIt.n };
                    targetIt.id = tmp.id; targetIt.n = tmp.n;
                }
                AudioSystem.playCollect();
            } else {
                AudioSystem.playClick();
            }
        }
    } else if (target.kind === 'searchempty') {
        // 容器空槽位（含已取格）：任意来源放入
        const slot = target.idx;
        if (d.kind === 'search') {
            if (!searchDone(d.idx)) return;
            sv.search.items[d.idx].slot = slot;   // 移动物品到该槽位
            AudioSystem.playClick();
        } else if (d.kind === 'bag') {
            const it = sv.inv[d.idx];
            if (!it) return;
            const same = sv.search.items.find(x => x.slot === slot && x.id === it.id && !x.taken);
            if (same) {
                const add = Math.min(99 - same.n, it.n);
                same.n += add; it.n -= add;
                if (it.n <= 0) sv.inv[d.idx] = null;
            } else {
                sv.search.items.push({ id: it.id, n: it.n, slot, done: true, played: true });
                sv.inv[d.idx] = null;
            }
            AudioSystem.playCollect();
        } else if (d.kind === 'hotbar') {
            unbindHotbar(d.idx);   // 快捷栏 → 空槽：取消绑定 + 背包对应物品放入容器
            const bi = sv.inv.findIndex(x => x && x.id === d.item.id);
            if (bi >= 0) {
                const it = sv.inv[bi];
                const same = sv.search.items.find(x => x.slot === slot && x.id === it.id && !x.taken);
                if (same) {
                    const add = Math.min(99 - same.n, it.n);
                    same.n += add; it.n -= add;
                    if (it.n <= 0) sv.inv[bi] = null;
                } else {
                    sv.search.items.push({ id: it.id, n: it.n, slot, done: true, played: true });
                    sv.inv[bi] = null;
                }
                AudioSystem.playCollect();
            } else {
                AudioSystem.playClick();
            }
        }
    }
}

// 放入/交换到背包指定格
function dropToBag(sv, d, slot) {
    const cur = sv.inv[slot];
    const maxStack = (id) => id.startsWith('ammo:') ? 999 : (id.startsWith('wpn:') || id.startsWith('tool:') ? 1 : 99);
    if (d.kind === 'search') {
        const it = sv.search.items[d.idx];
        if (!it || !it.done) return;   // 未完成揭示不能拿
        if (!cur) {
            sv.inv[slot] = { id: it.id, n: it.n };
            removeSearchItem(sv.search, d.idx);
        } else if (cur.id === it.id && cur.n < maxStack(it.id)) {
            const add = Math.min(maxStack(it.id) - cur.n, it.n);
            cur.n += add; it.n -= add;
            if (it.n <= 0) removeSearchItem(sv.search, d.idx);
        }
        AudioSystem.playCollect();
    } else if (d.kind === 'bag') {
        if (d.idx === slot) return;
        const tmp = sv.inv[slot];
        sv.inv[slot] = sv.inv[d.idx];
        sv.inv[d.idx] = tmp;
        AudioSystem.playClick();
    }
}

// 拿取（自动放入背包，满则部分留下）
function takeFromSearch(sv, idx, slot) {
    const s = sv.search;
    const it = s && s.items[idx];
    if (!it) return;
    if (!it.done) return;   // 未完成揭示不能拿
    if (slot != null) { dropToBag(sv, { kind: 'search', idx, item: it }, slot); rerender(sv); return; }
    // 2026-08-11 尸体搜索（容器界面）：拿取优先用完整对象入包（addItemObj 保留武器耐久/附魔等属性），
    // 防止只按 id 重入包导致物品功能丢失（用户要求"物品功能不会丧失"）。
    let left = it.n;
    const full = (s.corpseFull || []).find(o => o && o.id === it.id && o._rem !== 0);
    if (full) {
        const takeN = Math.min(it.n, full._rem || it.n);
        const obj = { ...full, n: takeN };
        left = Panel.addItemObj(sv.inv, obj);
        full._rem = (full._rem || it.n) - (takeN - left);
    } else {
        left = Panel.addItem(sv, it.id, it.n);
    }
    if (left < it.n) {
        it.n = left;
        if (left <= 0) removeSearchItem(s, idx);
        AudioSystem.playCollect();
    }
    rerender(sv);
}

function currentSv() { return curSv; }
