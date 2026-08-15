// ============================================================
// 【无尽植僵荒原】文字具现：字块 + 字楔 + 四阶段具现
// 纯配方/校验函数可在 Node 冒烟测试；DOM 仅在打开面板时访问。
// ============================================================

import * as Panel from './panel.js';
import {
    WORDCRAFT_CONFIG, RECIPES, WEDGE_INFO, glyphId, recipeAvailability, stageAt,
    parseFragmentId, repairAvailability, repairDuration, isFreeGlyph,
    surgeryEligible, glyphPollutionOf, surgeryOn, isConfusingGlyph,
    confusingGlyphList, usableGlyphList, countInventory, allGlyphChars, glyphCharOf,
    matchFreeWord, computeCorruptStats,
} from './wwordcraft-rules.js';
import * as WW_BAL from './wbalance.js';   // 2026-08-12 v3.9 琢磨模式：错乱字效果表
import AudioSystem from '../systems/audio.js';   // 2026-08-12 v3.10 拆字台音效
import { drawManifestation } from './wpixelmanifest.js';

export {
    WORDCRAFT_CONFIG, RECIPES, GLYPH_SOURCE_POOLS, GLYPH_COUNT_TABLES, WEDGE_SOURCE_TABLES,
    WORD_LOOT_COMPATIBILITY, ZOMBIE_GLYPH_POOLS, ZOMBIE_POLLUTION_TABLES,
    glyphId, countInventory, recipeAvailability, stageAt, rollTextLoot, rollWordLootOutcome,
    applyProbabilityModifiers, recipeItemId, recipeIdFromItem, recipeByItemId, rollRecipeItem,
    matchFreeWord, computeCorruptStats, isFreeGlyph,
    glyphCharOf, glyphPollutionOf, surgeryEligible, surgeryOn, nameCharsOf,
    isConfusingGlyph, confusingGlyphList, usableGlyphList, allGlyphChars,
    rollGlobalLoot, globalLootQty, GLYPH_UNIVERSAL, GLYPH_UNIVERSAL_MAP,
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
let ponderChars = [];   // 2026-08-12 v3.9 琢磨模式：玩家自由排出的字序列
let surgeryEl = null;   // 2026-08-12 v3.10 拆字台 UI（文字手术刀左键使用打开）
let surgerySv = null;

const CATEGORY_NAME = {
    all: '全部', food: '食物', supply: '补给', material: '材料', energy: '能量',
    tool: '工具', weapon: '冷兵器', firearm: '枪械', ammo: '弹药', mechanical: '机械',
};
// 2026-08-12 v3.8 初始解锁的基础配方（玩家开局即会的基础生存知识；其余配方需搜索获得）
const INITIAL_RECIPES = ['water', 'wood', 'stone', 'food', 'herb'];

export function isOpen() { return !!ui; }

export function open(sv, options = {}) {
    // 2026-08-12 v3.8 拼字台已打开：仅切换选中配方（配方使用/快捷查看）
    if (ui) {
        if (options.select && RECIPES.some(r => r.id === options.select)) selectedId = options.select;
        render();
        return;
    }
    currentSv = sv;
    host = options;
    if (options.select && RECIPES.some(r => r.id === options.select)) selectedId = options.select;
    buildUI();
    render();
}

export function close() {
    if (job && currentSv) refundJob(currentSv);
    job = null;
    preview = null;
    selectedFrag = null;
    ponderChars = [];
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
    // 2026-08-12 v3.10 具象词条：武器/工具/弹药具现时按组成字赋予词条强化（火=灼烧/冰=减速等）
    const manifestAffixes = collectManifestAffixes(recipe);
    const outputItem = { id: recipe.output.id, n: recipe.output.n };
    if (manifestAffixes.length) {
        outputItem._manifested = true;
        outputItem.manifestAffixes = manifestAffixes;
        // 具象武器韧性更高（可拆回字块）
        if (String(recipe.output.id).startsWith('wpn:')) {
            outputItem._toughnessLeft = WW_BAL.surgeryToughness(recipe.output.id) + WW_BAL.MANIFEST_TOUGHNESS_BONUS;
        }
    }
    // 2026-08-12 v3.10 用 addItemObj 保留完整对象属性（词条/韧性），普通物品走 addItem
    const left = outputItem._manifested
        ? Panel.addItemObj(currentSv, outputItem)
        : Panel.addItem(currentSv, outputItem.id, outputItem.n);
    if (left > 0) {
        refundJob(currentSv);
        job = null;
        if (host && host.onMessage) host.onMessage('具现失败：背包没有空位');
        render();
        return;
    }
    job = null;
    if (host && host.onMessage) {
        host.onMessage(`${recipe.name}完成落实，已经成为像素实体${manifestAffixes.length ? '（具象词条：' + manifestAffixes.map(a => a.label).join('、') + '）' : ''}`);
    }
    render();
}
// 2026-08-12 v3.10 收集配方组成字的具象词条（字→词条映射，复用 TEXT_GLYPH_EFFECTS 的词义）
function collectManifestAffixes(recipe) {
    const out = [];
    for (const ch of recipe.glyphs) {
        // 词条仅取"有明确战斗效果"的字（ability 或属性强化），避免纯装饰字
        const affix = WW_BAL.MANIFEST_AFFIXES[ch];
        if (affix && !out.some(a => a.id === affix.id)) out.push({ id: affix.id, label: affix.label, desc: affix.desc, char: ch });
    }
    return out.slice(0, 2);   // 最多 2 个词条
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
        '  <div class="wsl-wordcraft-head"><div><b>拼 字 台</b><span>文字不是物品，直到现实承认它</span></div><button class="wsl-close-btn" title="关闭 (K)">×</button></div>' +
        '  <div class="wsl-wordcraft-modes"></div>' +
        '  <div class="wsl-wordcraft-filters"></div>' +
        '  <div class="wsl-wordcraft-body"><div class="wsl-wordcraft-recipes"></div><div class="wsl-wordcraft-stage"></div></div>' +
        '  <div class="wsl-wordcraft-foot">K 关闭 · 中途关闭会返还材料</div>' +
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
            const rid = recipeButton.dataset.wordRecipe;
            const recipe = RECIPES.find(item => item.id === rid);
            selectedId = rid;
            if (recipe) {
                // 2026-08-12 v3.22 用户定稿：点击配方 = 快捷组装——背包材料充足直接开始拼装，缺材料则提示缺什么
                const state = recipeAvailability(currentSv.inv, recipe);
                if (state.ok) {
                    beginCraft(recipe);
                    if (host && host.onMessage) host.onMessage(`开始拼字「${recipe.name}」…`, '#7DFF7D');
                } else {
                    render();
                    if (host && host.onMessage) host.onMessage(`拼字「${recipe.name}」缺：${state.missing.join('、')}`, '#FFB347');
                }
            }
        }
        const fragButton = event.target.closest('[data-word-frag]');
        if (fragButton && !job) {
            selectedFrag = fragButton.dataset.wordFrag;
            render();
        }
        const filterButton = event.target.closest('[data-word-category]');
        if (filterButton && !job) {
            category = filterButton.dataset.wordCategory;
            const unlocked = unlockedRecipes();
            const first = RECIPES.find(item => (category === 'all' || item.category === category) && unlocked.has(item.id));
            selectedId = first ? first.id : (unlocked.has(selectedId) ? selectedId : '');
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
        // ===== 2026-08-12 v3.9 琢磨模式（自由拼字） =====
        const pickGlyph = event.target.closest('[data-word-pick]');
        if (pickGlyph && !job) {
            const ch = pickGlyph.dataset.wordPick;
            if (ch && ponderChars.length < 6 && countInventory(currentSv.inv, glyphId(ch)) > 0) {
                ponderChars.push(ch);
                renderPonder();
            }
        }
        const removeGlyph = event.target.closest('[data-word-remove]');
        if (removeGlyph && !job) {
            const idx = parseInt(removeGlyph.dataset.wordRemove);
            if (!isNaN(idx) && idx >= 0 && idx < ponderChars.length) {
                ponderChars.splice(idx, 1);
                renderPonder();
            }
        }
        const clearPonder = event.target.closest('[data-word-clear]');
        if (clearPonder && !job) { ponderChars = []; renderPonder(); }
        const ponderBtn = event.target.closest('[data-word-ponder]');
        if (ponderBtn && !job && ponderChars.length) {
            resolvePonder();
        }
    });
}

function render() {
    if (!ui || !currentSv) return;
    const modeBox = ui.querySelector('.wsl-wordcraft-modes');
    modeBox.innerHTML =
        `<button data-word-mode="craft" class="${mode === 'craft' ? 'active' : ''}" ${job ? 'disabled' : ''}>具现</button>` +
        `<button data-word-mode="ponder" class="${mode === 'ponder' ? 'active' : ''}" ${job ? 'disabled' : ''}>琢磨</button>` +
        `<button data-word-mode="repair" class="${mode === 'repair' ? 'active' : ''}" ${job ? 'disabled' : ''}>修复残缺物</button>` +
        // 2026-08-12 v3.15 词条图鉴：查看字→具象词条映射 + 混淆字清单
        `<button data-word-mode="codex" class="${mode === 'codex' ? 'active' : ''}" ${job ? 'disabled' : ''}>图鉴</button>`;
    const filterBox = ui.querySelector('.wsl-wordcraft-filters');
    if (mode === 'ponder') {
        filterBox.innerHTML = '';
        renderPonder();
        return;
    }
    if (mode === 'repair') {
        filterBox.innerHTML = '';
        renderRepairList();
        renderRepairProgress();
        return;
    }
    if (mode === 'codex') {
        filterBox.innerHTML = '';
        renderCodex();
        return;
    }
    const categories = ['all', ...new Set(RECIPES.map(recipe => recipe.category))];
    filterBox.innerHTML = categories.map(key =>
        `<button data-word-category="${key}" class="${category === key ? 'active' : ''}" ${job ? 'disabled' : ''}>${CATEGORY_NAME[key] || key}</button>`
    ).join('');
    const recipeBox = ui.querySelector('.wsl-wordcraft-recipes');
    // 2026-08-12 v3.8 只显示已解锁配方（sv.mods.recipes）；未解锁需搜索获得配方物品后使用
    const unlocked = unlockedRecipes();
    const visibleRecipes = RECIPES.filter(recipe =>
        unlocked.has(recipe.id) && (category === 'all' || recipe.category === category));
    if (visibleRecipes.length === 0) {
        recipeBox.innerHTML = '<div class="wsl-word-empty">拼字台上还没有任何配方。<br>搜索容器 / 击败僵尸可获得配方物品，<br>背包「使用」即可解锁（消耗 1 张），<br>点击配方即可快捷拼字。</div>';
    } else {
        recipeBox.innerHTML = visibleRecipes.map(recipe => {
            const state = recipeAvailability(currentSv.inv, recipe);
            // 2026-08-12 v3.8 字符颜色：背包有=白，缺=红
            const glyphHtml = recipe.glyphs.map(ch =>
                `<span class="wsl-recipe-glyph" style="color:${countInventory(currentSv.inv, glyphId(ch)) > 0 ? '#ffffff' : '#ff4444'}">${ch}</span>`
            ).join('');
            return `<button class="wsl-word-recipe${recipe.id === selectedId ? ' active' : ''}" data-word-recipe="${recipe.id}" ${job ? 'disabled' : ''}>` +
                `<span>${recipe.name}</span><small>${glyphHtml}</small></button>`;
        }).join('');
    }
    renderProgress();
}
// 2026-08-12 v3.8 已解锁配方集合（sv.mods.recipes + 初始基础配方）
function unlockedRecipes() {
    const set = new Set();
    for (const r of INITIAL_RECIPES) set.add(r);
    if (currentSv && currentSv.mods && Array.isArray(currentSv.mods.recipes)) {
        for (const id of currentSv.mods.recipes) set.add(id);
    }
    return set;
}

// ============ 2026-08-12 v3.9 琢磨模式：自由拼字（无配方时自己琢磨，拼错生成错乱僵尸） ============
function renderPonder() {
    if (!ui || !currentSv) return;
    const recipeBox = ui.querySelector('.wsl-wordcraft-recipes');
    const stageBox = ui.querySelector('.wsl-wordcraft-stage');
    // 左侧：背包中可拼字块（clean glyph）列表
    const glyphs = [];
    const seen = new Set();
    for (const s of currentSv.inv) {
        if (!s || !isFreeGlyph(s.id)) continue;
        const ch = s.id.slice(6);
        if (seen.has(ch)) continue;
        seen.add(ch);
        glyphs.push(ch);
    }
    recipeBox.innerHTML =
        '<div class="wsl-word-empty" style="text-align:left;">' +
        '拼字台没有配方时，可以在这里自由琢磨：<br>' +
        '把背包里的字块排成你认为正确的词。<br>' +
        (glyphs.length === 0 ? '<br><span style="color:#ff4444">背包里没有任何字块——先去搜刮容器或击败僵尸收集字块。</span>' : '') +
        '</div>' +
        (glyphs.length ? glyphs.map(ch => {
            const eff = WW_BAL.TEXT_GLYPH_EFFECTS && WW_BAL.TEXT_GLYPH_EFFECTS[ch];
            const effTip = eff ? ` · ${eff.desc}` : '';
            // 2026-08-12 v3.15 混淆字：灰色显示 + 标注"无用字"（拼不出物品，干扰判断）
            const confusing = isConfusingGlyph(ch);
            return `<button class="wsl-word-recipe" data-word-pick="${ch}" ${job ? 'disabled' : ''}>` +
                `<span style="font-size:20px;color:${confusing ? '#8a8a8a' : '#d8d2bd'};${confusing ? 'text-decoration:line-through;' : ''}">${ch}</span>` +
                `<small>${confusing ? '无用字·暂无功能' : '字块'}${effTip}</small></button>`;
        }).join('') : '');
    // 右侧：拼字区 + 预览
    const word = ponderChars.join('');
    const preview = ponderChars.length ? (matchFreeWord(ponderChars).matched
        ? { matched: true, name: matchFreeWord(ponderChars).recipe.name }
        : computeCorruptStats(ponderChars)) : null;
    stageBox.innerHTML =
        `<div class="wsl-word-name">${ponderChars.length ? ponderChars.map((ch, i) =>
            `<span class="wsl-word-glyph">${ch}</span>${i < ponderChars.length - 1 ? '<i>楔</i>' : ''}`).join('') : '＿ ＿ ＿'}</div>` +
        `<div class="wsl-word-desc">琢磨拼字：把字块按词序排列。拼出的词若与配方一致则正常具现；否则文字错乱，生成对应文字僵尸。</div>` +
        (ponderChars.length ? (
            preview && preview.matched
                ? `<div class="wsl-word-cost" style="color:#7DFF7D">✓ 与配方「${preview.name}」一致，可正常具现</div>`
                : `<div class="wsl-word-cost">⚠ 无法识别的词「${word}」——文字将错乱为 <b style="color:#ff8888">${preview ? preview.name : '错乱尸'}</b></div>` +
                  (ponderChars.some(isConfusingGlyph)
                      ? `<div style="font-size:11px;color:#8a8a8a;margin:4px 0;">含无用字（混淆字）：${ponderChars.filter(isConfusingGlyph).join('、')} —— 这些字当前没有装载任何实际功能，拼不出物品，只会导致文字错乱。</div>`
                      : '') +
                  (preview && preview.descs && preview.descs.length
                      ? `<div style="font-size:11px;color:#c8a2c8;margin:4px 0;">${preview.descs.join('；')}</div>`
                      : '') +
                  (preview && preview.abilityChar
                      ? `<div style="font-size:11px;color:#ffaa66;">特殊字「${preview.abilityChar}」赋予特殊能力</div>`
                      : '')
        ) : '') +
        `<div class="wsl-word-actions">` +
        `<button class="menu-btn" data-word-clear ${ponderChars.length ? '' : 'disabled'}>清空</button>` +
        `<button class="menu-btn wsl-word-ponder" data-word-ponder ${ponderChars.length ? '' : 'disabled'}>${preview && preview.matched ? '开始具现' : '冒险拼字'}</button>` +
        `</div>` +
        `<div style="font-size:10px;color:#667;margin-top:6px;">注意：拼出错误文字会生成错乱僵尸，请量力而行。</div>`;
}

// ============ 2026-08-12 v3.15 词条图鉴：字→具象词条映射 + 混淆字清单 ============
function renderCodex() {
    if (!ui || !currentSv) return;
    const recipeBox = ui.querySelector('.wsl-wordcraft-recipes');
    const stageBox = ui.querySelector('.wsl-wordcraft-stage');
    // 左侧：所有字→词条映射（词条表按字排列）
    const affixes = WW_BAL.MANIFEST_AFFIXES || {};
    const affixKeys = Object.keys(affixes).sort();
    recipeBox.innerHTML =
        '<div class="wsl-word-empty" style="text-align:left;color:#8a9aa2;">' +
        '▸ 字→词条图鉴（文字具现时按组成字获得强化）：<br><br>' +
        (affixKeys.length ? affixKeys.map(ch =>
            `<div style="margin:2px 0;font-size:12px;"><span style="color:#d8d2bd;font-weight:bold;">${ch}</span> → <span style="color:#C88AFF;">${affixes[ch].label}</span> <span style="color:#8a9aa2;">· ${affixes[ch].desc}</span></div>`
        ).join('') : '暂无词条') +
        '</div>';
    // 右侧：混淆字清单 + 可用字统计
    const confusing = confusingGlyphList();
    const usable = usableGlyphList();
    const total = allGlyphChars().size;
    stageBox.innerHTML =
        `<div class="wsl-word-name" style="font-size:15px;color:#7ee08a;">字 典 图 鉴</div>` +
        `<div class="wsl-word-desc">每个字都有它的价值——但只有装载了实际功能的字才能拼出物品。<br>` +
        `汉字基数 <b style="color:#d8d2bd;">${total}</b> · 可用字 <b style="color:#7ee08a;">${usable.length}</b> · 无用字（混淆字）<b style="color:#8a8a8a;">${confusing.length}</b>。</div>` +
        `<div style="margin-top:8px;font-size:12px;color:#8a9aa2;">▸ 无用字（混淆字）：当前拼不出任何物品，只会干扰判断——强行拼字只会文字错乱生成错乱尸。随新功能/新物品加入将逐步"转正"为可用字。</div>` +
        `<div style="margin-top:6px;padding:8px;background:rgba(0,0,0,0.25);border-radius:6px;font-size:13px;line-height:1.7;color:#8a8a8a;max-height:180px;overflow-y:auto;">${confusing.length ? confusing.join(' ') : '（暂无混淆字，全部字均已装载功能）'}</div>` +
        `<div style="margin-top:10px;font-size:12px;color:#8a9aa2;">▸ 可用字（能拼出物品）：</div>` +
        `<div style="margin-top:6px;padding:8px;background:rgba(0,0,0,0.25);border-radius:6px;font-size:13px;line-height:1.7;color:#d8d2bd;max-height:180px;overflow-y:auto;">${usable.join(' ')}</div>`;
}

// 执行琢磨拼字：匹配配方 → 正常具现；不匹配 → 生成错乱僵尸（消耗字块，不消耗字楔）
function resolvePonder() {
    if (!currentSv || job || !ponderChars.length) return;
    // 检查字块是否足够（含已排的字）
    for (const ch of ponderChars) {
        if (countInventory(currentSv.inv, glyphId(ch)) < 1) {
            if (host && host.onMessage) host.onMessage(`字块「${ch}」已不在背包中`);
            ponderChars = [];
            renderPonder();
            return;
        }
    }
    const word = ponderChars.join('');
    const m = matchFreeWord(ponderChars);
    if (m.matched) {
        // 正常具现：消耗字块 + 字楔，进入具现流程（复用 beginCraft 的配方）
        beginCraft(m.recipe);
        return;
    }
    // 错乱：消耗字块 + 字楔（粘合错误的字）→ 生成错乱僵尸
    // 2026-08-12 v3.10 用户定稿：所有拼字（含琢磨拼错）必耗字楔
    if (countInventory(currentSv.inv, 'wedge:rough') < 1) {
        if (host && host.onMessage) host.onMessage('琢磨拼字需要 1 个粗制字楔（粘合文字）', '#FFB347');
        return;
    }
    const stats = computeCorruptStats(ponderChars);
    for (const ch of ponderChars) take(currentSv.inv, glyphId(ch), 1);
    take(currentSv.inv, 'wedge:rough', 1);
    ponderChars = [];
    // 在拼字台旁生成错乱僵尸（world 坐标 = 玩家位置附近）
    if (host && host.onPonderCorrupt) {
        host.onPonderCorrupt(stats, word);
    } else {
        // 兜底：直接提示（正常情况下 survival 注册 onPonderCorrupt）
        if (host && host.onMessage) host.onMessage(`「${word}」文字错乱！生成了 ${stats.name}`, '#ff8888');
    }
    render();
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
    const recipe = job ? job.recipe : RECIPES.find(item => item.id === selectedId && unlockedRecipes().has(item.id));
    if (!recipe) {
        box.innerHTML = '<div class="wsl-word-desc">选择左侧一个已解锁配方开始拼字；<br>点击配方（材料充足）即可快捷组装，<br>没有配方时请先搜索容器 / 击败僵尸获得配方物品。</div>';
        return;
    }
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

// ============ 2026-08-12 v3.10 拆字台（文字手术刀左键使用打开） ============
export function isSurgeryOpen() { return !!surgeryEl; }
export function openSurgery(sv, options = {}) {
    if (surgeryEl) { closeSurgery(); return; }
    surgerySv = sv;
    surgeryHost = options;
    if (!surgeryEl) {
        surgeryEl = document.createElement('div');
        surgeryEl.id = 'wsl-surgery';
        surgeryEl.className = 'wsl-wordcraft';
        surgeryEl.innerHTML =
            '<div class="wsl-wordcraft-box">' +
            '  <div class="wsl-wordcraft-head"><div><b>拆 字 台</b><span>文字手术刀 · 拆解与净化</span></div><button class="wsl-close-btn" title="关闭 (K)">×</button></div>' +
            '  <div class="wsl-surgery-body" style="display:flex;gap:12px;padding:10px 14px;min-height:280px;">' +
            '    <div class="wsl-surgery-list" style="flex:1;overflow-y:auto;max-height:320px;"></div>' +
            '    <div class="wsl-surgery-info" style="width:300px;border-left:1px solid #2a2f3a;padding-left:12px;"></div>' +
            '  </div>' +
            '  <div class="wsl-wordcraft-foot" id="wsl-surgery-foot">K 关闭 · 拆字必定成功：净化变普通，自由拆解按名称拆成组成字（猜错无惩罚）</div>' +
            '</div>';
        document.getElementById('game-container').appendChild(surgeryEl);
        surgeryEl.querySelector('.wsl-close-btn').addEventListener('click', closeSurgery);
        surgeryEl.addEventListener('click', e => {
            const btn = e.target.closest('[data-surgery]');
            if (btn) doSurgery(parseInt(btn.dataset.surgery));
        });
    }
    renderSurgery();
}
let surgeryHost = null;
export function closeSurgery() {
    if (surgeryEl) { surgeryEl.remove(); surgeryEl = null; }
    surgerySv = null; surgeryHost = null;
}
function renderSurgery() {
    if (!surgeryEl || !surgerySv) return;
    const list = surgeryEl.querySelector('.wsl-surgery-list');
    const info = surgeryEl.querySelector('.wsl-surgery-info');
    // 手术刀状态（耐久/损坏）显示在底部
    const foot = surgeryEl.querySelector('#wsl-surgery-foot');
    if (foot) {
        const kn = surgerySv.inv.find(x => x && x.id === 'tool:surgery');
        if (kn) {
            const dur = kn.broken ? 0 : (kn.dur != null ? kn.dur : WW_BAL.SURGERY_DUR);
            foot.innerHTML = `K 关闭 · 手术刀耐久 <b style="color:${kn.broken ? '#ff5555' : '#C88AFF'}">${dur}/${WW_BAL.SURGERY_DUR}</b>${kn.broken ? '（已损坏，需扳手+零件修复）' : ' · 每次拆解耗 1'} · 拆字必定成功（猜错无惩罚）`;
        } else {
            foot.innerHTML = 'K 关闭 · 需要背包里有文字手术刀（搜索容器掉落，医疗箱掉率更高）';
        }
    }
    // 列出背包所有可拆物品（自由无提示：不标注"可拆/不可拆"，全部列出，但不可拆的点击会提示"无法拆解"）
    const slots = [];
    for (let i = 0; i < surgerySv.inv.length; i++) {
        const s = surgerySv.inv[i];
        if (!s) continue;
        slots.push({ i, s });
    }
    if (!slots.length) {
        list.innerHTML = '<div class="wsl-word-empty">背包是空的。<br>把要拆解或净化的物品放进背包。</div>';
        info.innerHTML = '<div class="wsl-word-desc">拆字台说明：<br>· 净化：污染/不稳字块、字楔 → 拆掉形容词变普通（稳定）<br>· 拆解：武器/食物/材料/字块 → 拆成组成字（有风险）</div>';
        return;
    }
    list.innerHTML = slots.map(({ i, s }) => {
        const it = Panel.getItemInfo(s.id);
        return `<button class="wsl-word-recipe" data-surgery="${i}">` +
            `<span style="color:${it.color}">${it.name}</span><small>×${s.n}</small></button>`;
    }).join('');
    // 默认显示第一个的拆解预览
    const first = slots[0];
    if (first) renderSurgeryInfo(first.i, first.s, info);
    else info.innerHTML = '';
}
function renderSurgeryInfo(idx, s, info) {
    if (!info) info = surgeryEl.querySelector('.wsl-surgery-info');
    const it = Panel.getItemInfo(s.id);
    const eligible = surgeryEligible(s.id);
    const poll = glyphPollutionOf(s.id);
    // 韧性条（自由拆解才显示）：每次拆解 -1，归零物品损坏
    let toughHtml = '';
    if (eligible && poll !== 'unstable' && poll !== 'infected') {
        const tMax = WW_BAL.surgeryToughness(s.id) + (s._manifested ? WW_BAL.MANIFEST_TOUGHNESS_BONUS : 0);
        const tLeft = s._toughnessLeft != null ? s._toughnessLeft : tMax;
        const segs = Array.from({ length: tMax }, (_, i) =>
            `<span style="display:inline-block;width:10px;height:10px;margin-right:3px;border-radius:2px;background:${i < tLeft ? '#C88AFF' : '#3a3a4a'};"></span>`).join('');
        toughHtml = `<div style="margin-top:8px;font-size:11px;color:#c8a2c8;">韧性 <b>${tLeft}/${tMax}</b>${s._manifested ? ' · 具象+' : ''}<br>${segs}</div>`;
    }
    let hint = '';
    if (!eligible) hint = '<div style="color:#ff8866;margin-top:8px;">此物无法拆解（货币/战利品袋/旗帜/宝石）</div>';
    else if (poll === 'unstable' || poll === 'infected') hint = '<div style="color:#7DFF7D;margin-top:8px;">净化：稳定拆掉污染形容词，得到普通字块（不耗韧性）</div>';
    else if (String(s.id).startsWith('wedge:')) hint = '<div style="color:#7DFF7D;margin-top:8px;">拆字楔：必定成功，拆出「楔」字块（猜错无惩罚）</div>';
    else if (isFreeGlyph(s.id)) hint = '<div style="color:#7DFF7D;margin-top:8px;">自由拆字块：必定成功，拆出该字块（猜错无惩罚）</div>';
    else hint = '<div style="color:#7DFF7D;margin-top:8px;">自由拆解物品：必定按名称拆成组成字（猜错无惩罚）</div>';
    info.innerHTML =
        `<div class="wsl-word-name" style="font-size:16px;color:${it.color}">${it.name}</div>` +
        `<div class="wsl-word-desc">${it.desc || ''}</div>` +
        `<div style="font-size:11px;color:#8a9aa2;margin-top:6px;">背包格 #${idx + 1} · ×${s.n}</div>` +
        toughHtml +
        hint +
        `<div class="wsl-word-actions" style="margin-top:10px;"><button class="menu-btn" data-surgery="${idx}" ${eligible ? '' : 'disabled'} style="color:#C88AFF;">${poll === 'unstable' || poll === 'infected' ? '净 化' : '拆 解'}</button></div>`;
}
// 执行拆解：调用 wwordcraft-rules.surgeryOn，应用结果（消耗手术刀耐久 1 + 目标韧性 1）
function doSurgery(idx) {
    if (!surgerySv) return;
    const s = surgerySv.inv[idx];
    if (!s) return;
    const eligible = surgeryEligible(s.id);
    if (!eligible) { if (surgeryHost && surgeryHost.onMessage) surgeryHost.onMessage('此物无法拆解', '#FFB347'); return; }
    // 净化（污染字块/字楔）不消耗韧性；自由拆解消耗韧性
    const poll = glyphPollutionOf(s.id);
    const isPurify = poll === 'unstable' || poll === 'infected'
        || (String(s.id).startsWith('wedge:') && (String(s.id) === 'wedge:infected' || String(s.id) === 'wedge:unstable'));
    // 消耗手术刀耐久（若没有手术刀则不能拆）
    if (!surgeryHost || !surgeryHost.consumeSurgery) {
        if (surgeryHost && surgeryHost.onMessage) surgeryHost.onMessage('需要背包里有文字手术刀', '#FFB347');
        return;
    }
    if (!surgeryHost.consumeSurgery()) return;   // 手术刀不足/损坏则返回 false 并提示
    // 韧性：自由拆解时消耗 1 韧性格；净化不消耗。物品韧性初始化并持久化在 _toughnessLeft
    let tMax = null, tLeft = null;
    if (!isPurify) {
        tMax = WW_BAL.surgeryToughness(s.id);
        if (s._manifested) tMax += WW_BAL.MANIFEST_TOUGHNESS_BONUS;   // 具象词条武器韧性 +1
        tLeft = (s._toughnessLeft != null ? s._toughnessLeft : tMax) - 1;
        if (tLeft < 0) tLeft = 0;
    }
    const result = surgeryOn(s.id, Math.random, isPurify ? null : tMax);
    // 消耗目标物品 1 个（韧性归零 = 物品拆完消失；v3.18 恒成功：本次照常产出组成字，无惩罚）
    const toughnessDepleted = !isPurify && tLeft <= 0;
    if (toughnessDepleted) {
        surgerySv.inv[idx] = null;   // 韧性耗尽：物品拆完消失
    } else {
        s.n--;
        if (s.n <= 0) surgerySv.inv[idx] = null;
    }
    // 应用结果（必定成功：净化或拆解都正常产出）
    if (result.item) Panel.addItem(surgerySv, result.item.id, result.item.n);
    if (result.items) for (const it of result.items) Panel.addItem(surgerySv, it.id, it.n);
    if (surgeryHost && surgeryHost.onMessage) surgeryHost.onMessage(result.label, '#7DFF7D');
    // 净化/拆解音效
    AudioSystem.playCollect();
    renderSurgery();
}

export function destroy() { close(); closeSurgery(); }
