// ============================================================
// 【无尽植僵荒原】文字具现：字块 + 字楔 + 四阶段具现
// 纯配方/校验函数可在 Node 冒烟测试；DOM 仅在打开面板时访问。
// ============================================================

import * as Panel from './panel.js';
import {
    WORDCRAFT_CONFIG, RECIPES, WEDGE_INFO, glyphId, recipeAvailability, stageAt,
    parseFragmentId, repairAvailability, repairDuration,
} from './wwordcraft-rules.js';
import { drawManifestation } from './wpixelmanifest.js';

export {
    WORDCRAFT_CONFIG, RECIPES, GLYPH_SOURCE_POOLS, GLYPH_COUNT_TABLES, WEDGE_SOURCE_TABLES,
    WORD_LOOT_COMPATIBILITY, ZOMBIE_GLYPH_POOLS, ZOMBIE_POLLUTION_TABLES,
    glyphId, countInventory, recipeAvailability, stageAt, rollTextLoot, rollWordLootOutcome,
    applyProbabilityModifiers,
} from './wwordcraft-rules.js';

let ui = null;
let currentSv = null;
let selectedId = RECIPES[0].id;
let job = null;
let host = null;
let preview = null;
let category = 'all';
let mode = 'craft';
let selectedFrag = null;

const CATEGORY_NAME = {
    all: '全部', food: '食物', supply: '补给', material: '材料', energy: '能量',
    tool: '工具', weapon: '冷兵器', firearm: '枪械', ammo: '弹药', mechanical: '机械',
};

export function isOpen() { return !!ui; }

export function open(sv, options = {}) {
    if (ui) { close(); return; }
    currentSv = sv;
    host = options;
    buildUI();
    render();
}

export function close() {
    if (job && currentSv) refundJob(currentSv);
    job = null;
    preview = null;
    selectedFrag = null;
    mode = 'craft';
    if (ui) ui.remove();
    ui = null;
    currentSv = null;
    host = null;
}

export function update(dt) {
    if (!currentSv) return;
    if (job) {
        job.elapsed = Math.min(job.duration, job.elapsed + dt);
        if (job.elapsed >= job.duration) finishJob();
        renderProgress();
    } else if (preview) {
        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) preview.elapsed = preview.duration * 0.9;
        else {
            preview.elapsed += dt;
            if (preview.elapsed >= preview.duration) preview.elapsed = 0;
        }
        renderProgress();
    }
}

function take(inv, id, amount) {
    let left = amount;
    for (let i = 0; i < inv.length && left > 0; i++) {
        const slot = inv[i];
        if (!slot || slot.id !== id) continue;
        const used = Math.min(slot.n, left);
        slot.n -= used;
        left -= used;
        if (slot.n <= 0) inv[i] = null;
    }
    return amount - left;
}

function beginCraft(recipe) {
    if (!currentSv || job) return;
    const state = recipeAvailability(currentSv.inv, recipe);
    if (!state.ok) return;
    const spent = [];
    for (const char of recipe.glyphs) {
        take(currentSv.inv, glyphId(char), 1);
        spent.push({ id: glyphId(char), n: 1 });
    }
    const wedgeId = recipe.wedgeId || 'wedge:rough';
    take(currentSv.inv, wedgeId, recipe.wedges);
    spent.push({ id: wedgeId, n: recipe.wedges });
    job = { recipe, duration: recipe.duration, elapsed: 0, spent };
    preview = null;
    render();
}

function refundJob(sv) {
    if (!job) return;
    for (const item of job.spent) Panel.addItem(sv, item.id, item.n);
    if (host && host.onMessage) host.onMessage('具现中断：字块与字楔已退回');
}

function finishJob() {
    if (!job || !currentSv) return;
    if (job.repair) {
        const fragId = job.repair;
        const info = parseFragmentId(fragId);
        const recipe = info ? info.recipe : job.recipe;
        for (let i = 0; i < currentSv.inv.length; i++) {
            if (currentSv.inv[i] && currentSv.inv[i].id === fragId) {
                currentSv.inv[i] = null;
                break;
            }
        }
        const left = Panel.addItem(currentSv, recipe.output.id, recipe.output.n);
        if (left > 0) {
            refundJob(currentSv);
            Panel.addItem(currentSv, fragId, 1);
            job = null;
            if (host && host.onMessage) host.onMessage('修复失败：背包没有空位');
            render();
            return;
        }
        job = null;
        selectedFrag = null;
        if (host && host.onMessage) host.onMessage(`「${recipe.name}」修复完成，名称重新被现实承认`);
        render();
        return;
    }
    const recipe = job.recipe;
    const left = Panel.addItem(currentSv, recipe.output.id, recipe.output.n);
    if (left > 0) {
        refundJob(currentSv);
        job = null;
        if (host && host.onMessage) host.onMessage('具现失败：背包没有空位');
        render();
        return;
    }
    job = null;
    if (host && host.onMessage) host.onMessage(`${recipe.name}完成落实，已经成为像素实体`);
    render();
}

function beginRepair(fragId) {
    if (!currentSv || job) return;
    const state = repairAvailability(currentSv.inv, fragId);
    if (!state.ok) return;
    const info = state.info;
    const spent = [];
    for (const char of info.missing) {
        take(currentSv.inv, glyphId(char), 1);
        spent.push({ id: glyphId(char), n: 1 });
    }
    const wedgeId = info.recipe.wedgeId || 'wedge:rough';
    take(currentSv.inv, wedgeId, state.wedgeNeed);
    spent.push({ id: wedgeId, n: state.wedgeNeed });
    job = { recipe: info.recipe, duration: repairDuration(fragId), elapsed: 0, spent, repair: fragId };
    preview = null;
    render();
}

function buildUI() {
    ui = document.createElement('div');
    ui.id = 'wsl-wordcraft';
    ui.className = 'wsl-wordcraft';
    ui.innerHTML =
        '<div class="wsl-wordcraft-box">' +
        '  <div class="wsl-wordcraft-head"><div><b>拼 字 台</b><span>文字不是物品，直到现实承认它</span></div><button class="wsl-close-btn" title="关闭 (K/ESC)">×</button></div>' +
        '  <div class="wsl-wordcraft-modes"></div>' +
        '  <div class="wsl-wordcraft-filters"></div>' +
        '  <div class="wsl-wordcraft-body"><div class="wsl-wordcraft-recipes"></div><div class="wsl-wordcraft-stage"></div></div>' +
        '  <div class="wsl-wordcraft-foot">K / ESC 关闭 · 中途关闭会返还材料</div>' +
        '</div>';
    document.getElementById('game-container').appendChild(ui);
    ui.querySelector('.wsl-close-btn').addEventListener('click', close);
    ui.addEventListener('click', event => {
        const modeButton = event.target.closest('[data-word-mode]');
        if (modeButton && !job) {
            mode = modeButton.dataset.wordMode;
            selectedFrag = null;
            render();
        }
        const recipeButton = event.target.closest('[data-word-recipe]');
        if (recipeButton && !job) {
            selectedId = recipeButton.dataset.wordRecipe;
            render();
        }
        const fragButton = event.target.closest('[data-word-frag]');
        if (fragButton && !job) {
            selectedFrag = fragButton.dataset.wordFrag;
            render();
        }
        const filterButton = event.target.closest('[data-word-category]');
        if (filterButton && !job) {
            category = filterButton.dataset.wordCategory;
            const first = RECIPES.find(item => category === 'all' || item.category === category);
            if (first) selectedId = first.id;
            render();
        }
        if (event.target.closest('[data-word-start]') && !job) {
            const recipe = RECIPES.find(item => item.id === selectedId);
            if (recipe) beginCraft(recipe);
        }
        if (event.target.closest('[data-word-repair]') && !job) {
            if (selectedFrag) beginRepair(selectedFrag);
        }
        if (event.target.closest('[data-word-preview]') && !job) {
            preview = { duration: 4, elapsed: 0 };
            renderProgress();
        }
    });
}

function render() {
    if (!ui || !currentSv) return;
    const modeBox = ui.querySelector('.wsl-wordcraft-modes');
    modeBox.innerHTML =
        `<button data-word-mode="craft" class="${mode === 'craft' ? 'active' : ''}" ${job ? 'disabled' : ''}>具现</button>` +
        `<button data-word-mode="repair" class="${mode === 'repair' ? 'active' : ''}" ${job ? 'disabled' : ''}>修复残缺物</button>`;
    const filterBox = ui.querySelector('.wsl-wordcraft-filters');
    if (mode === 'repair') {
        filterBox.innerHTML = '';
        renderRepairList();
        renderRepairProgress();
        return;
    }
    const categories = ['all', ...new Set(RECIPES.map(recipe => recipe.category))];
    filterBox.innerHTML = categories.map(key =>
        `<button data-word-category="${key}" class="${category === key ? 'active' : ''}" ${job ? 'disabled' : ''}>${CATEGORY_NAME[key] || key}</button>`
    ).join('');
    const recipeBox = ui.querySelector('.wsl-wordcraft-recipes');
    const visibleRecipes = RECIPES.filter(recipe => category === 'all' || recipe.category === category);
    recipeBox.innerHTML = visibleRecipes.map(recipe => {
        const state = recipeAvailability(currentSv.inv, recipe);
        return `<button class="wsl-word-recipe${recipe.id === selectedId ? ' active' : ''}" data-word-recipe="${recipe.id}" ${job ? 'disabled' : ''}>` +
            `<span>${recipe.name}</span><small>${state.ok ? '材料齐全' : `缺：${state.missing.join('、')}`}</small></button>`;
    }).join('');
    renderProgress();
}

function renderRepairList() {
    if (!ui || !currentSv) return;
    const recipeBox = ui.querySelector('.wsl-wordcraft-recipes');
    const fragments = currentSv.inv.filter(s => s && s.id.startsWith('frag:'));
    if (fragments.length === 0) {
        recipeBox.innerHTML = '<div class="wsl-word-empty">背包中没有残缺物。<br>搜索容器时有概率发现名称残缺的物体。</div>';
        const box = ui.querySelector('.wsl-wordcraft-stage');
        box.innerHTML = '<div class="wsl-word-desc">残缺物是名称结构损坏的物体。补齐缺少的字块并消耗少量字楔，即可修复为完整物品。</div>';
        return;
    }
    if (!selectedFrag || !fragments.find(s => s.id === selectedFrag)) {
        selectedFrag = fragments[0].id;
    }
    recipeBox.innerHTML = fragments.map(slot => {
        const info = parseFragmentId(slot.id);
        if (!info) return '';
        const display = info.recipe.glyphs.map(ch => info.missing.includes(ch) ? '＿' : ch).join('');
        const state = repairAvailability(currentSv.inv, slot.id);
        return `<button class="wsl-word-recipe${slot.id === selectedFrag ? ' active' : ''}" data-word-frag="${slot.id}" ${job ? 'disabled' : ''}>` +
            `<span>${display}</span><small>${state.ok ? '可修复' : `缺：${state.missing.join('、')}`}</small></button>`;
    }).join('');
    renderRepairProgress();
}

function renderProgress() {
    if (!ui || !currentSv) return;
    const box = ui.querySelector('.wsl-wordcraft-stage');
    const recipe = job ? job.recipe : RECIPES.find(item => item.id === selectedId);
    if (!recipe) return;
    const state = recipeAvailability(currentSv.inv, recipe);
    const wedge = WEDGE_INFO[recipe.wedgeId || 'wedge:rough'] || WEDGE_INFO['wedge:rough'];
    const progress = job ? job.elapsed / job.duration : (preview ? preview.elapsed / preview.duration : 0);
    const stage = stageAt(progress);
    const glyphs = recipe.glyphs.map((char, index) =>
        `<span class="wsl-word-glyph">${char}</span>${index < recipe.glyphs.length - 1 ? '<i>楔</i>' : ''}`
    ).join('');
    box.innerHTML =
        `<div class="wsl-word-name">${glyphs}</div>` +
        `<div class="wsl-word-desc">${recipe.desc}</div>` +
        (job || preview
            ? `<div class="wsl-word-phase"><b>${stage.name}</b><span>${stage.detail}</span></div>` +
              `<div class="wsl-word-progress"><span style="width:${(progress * 100).toFixed(1)}%"></span></div>` +
              `<canvas class="wsl-word-canvas" width="72" height="36" aria-label="${recipe.name}具现像素预览"></canvas>` +
              (preview ? '<div class="wsl-word-preview-note">效果预览 · 不消耗材料</div>' : '')
            : `<div class="wsl-word-cost">需要 ${recipe.glyphs.join(' + ')} · ${wedge.name}×${recipe.wedges} · ${recipe.duration}秒</div>` +
              `<div class="wsl-word-actions"><button class="menu-btn wsl-word-preview" data-word-preview>预览效果</button>` +
              `<button class="menu-btn wsl-word-start" data-word-start ${state.ok ? '' : 'disabled'}>开始具现</button></div>`);
    const canvas = box.querySelector('.wsl-word-canvas');
    if (canvas) drawManifestation(canvas, recipe, progress);
}

function renderRepairProgress() {
    if (!ui || !currentSv) return;
    const box = ui.querySelector('.wsl-wordcraft-stage');
    if (job && job.repair) {
        const recipe = job.recipe;
        const progress = job.elapsed / job.duration;
        const stage = stageAt(progress);
        box.innerHTML =
            `<div class="wsl-word-name">${recipe.glyphs.map((ch, i) => `<span class="wsl-word-glyph">${ch}</span>${i < recipe.glyphs.length - 1 ? '<i>楔</i>' : ''}`).join('')}</div>` +
            `<div class="wsl-word-phase"><b>${stage.name}</b><span>${stage.detail}</span></div>` +
            `<div class="wsl-word-progress"><span style="width:${(progress * 100).toFixed(1)}%"></span></div>` +
            `<canvas class="wsl-word-canvas" width="72" height="36" aria-label="${recipe.name}修复预览"></canvas>`;
        const canvas = box.querySelector('.wsl-word-canvas');
        if (canvas) drawManifestation(canvas, recipe, progress);
        return;
    }
    if (!selectedFrag) { box.innerHTML = ''; return; }
    const info = parseFragmentId(selectedFrag);
    if (!info) { box.innerHTML = ''; return; }
    const state = repairAvailability(currentSv.inv, selectedFrag);
    const wedge = WEDGE_INFO[info.recipe.wedgeId || 'wedge:rough'] || WEDGE_INFO['wedge:rough'];
    const dur = repairDuration(selectedFrag);
    const display = info.recipe.glyphs.map(ch =>
        `<span class="wsl-word-glyph${info.missing.includes(ch) ? ' missing' : ''}">${info.missing.includes(ch) ? '＿' : ch}</span>`
    ).join('<i>楔</i>');
    const sevLabel = info.severity === 'light' ? '轻度残缺' : '严重残缺';
    box.innerHTML =
        `<div class="wsl-word-name">${display}</div>` +
        `<div class="wsl-word-desc">${sevLabel}：「${info.name}」缺少 ${info.missing.join('、')}，补齐后恢复完整功能。</div>` +
        `<div class="wsl-word-cost">需要 ${info.missing.map(ch => `字块「${ch}」`).join(' + ')} · ${wedge.name}×${state.wedgeNeed || 1} · ${dur}秒</div>` +
        `<div class="wsl-word-actions"><button class="menu-btn wsl-word-repair" data-word-repair ${state.ok ? '' : 'disabled'}>开始修复</button></div>`;
}

export function destroy() { close(); }
