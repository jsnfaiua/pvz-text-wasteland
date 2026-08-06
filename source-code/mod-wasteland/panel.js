// ============================================================
// 【无尽植僵荒原】模组 · HTML 覆盖层（背包 / 储物柜 / 死亡界面）
// 覆盖层挂在 #game-screen 内，切屏后随界面隐藏，不影响本体
// 武器/弹药是背包物品：id 形如 'wpn:sword' / 'ammo:rifleAmmo'，
// 数值统一引用本体 WEAPONS / AMMO_INFO 表，不复制数据
// ============================================================

import { WEAPONS, AMMO_INFO } from '../core/constants.js';
import AudioSystem from '../systems/audio.js';
import { saveData } from '../core/state.js';
import * as MSG from './wmsg.js';
import { WEDGE_INFO, parseFragmentId } from './wwordcraft-rules.js';

export const ITEMS = {
    herb:  { name: '草药',     char: '草', color: '#46C846', heal: 15, satiate: 12, desc: '使用恢复 15 生命 / 12 饱食' },
    wood:  { name: '木材',     char: '木', color: '#C89060', heal: 0,  desc: '基础建材：建造木墙/木门/储物柜/木床/种植盆' },
    food:  { name: '食物',     char: '食', color: '#FFB347', heal: 30, satiate: 30, desc: '使用恢复 30 生命 / 30 饱食' },
    part:  { name: '修车零件', char: '件', color: '#66CCFF', heal: 0,  desc: '载具修复材料（后续阶段用途）' },
    stone: { name: '石块',     char: '石', color: '#999999', heal: 0,  desc: '基础建材（后续阶段用途）' },
    gem:   { name: '宝石',     char: '钻', color: '#7DF9FF', heal: 0,  desc: '尸潮战利品：稀有的高价值物（后续阶段用途）' },
    tpgem: { name: '传送宝石', char: '◇', color: '#C88AFF', heal: 0,  desc: '暂停面板「传送回营地」消耗 1 颗（有冷却）；尸潮首领与稀有容器掉落' },

    water: { name: '水',       char: '水', color: '#5599FF', heal: 0, drink: 35, desc: '使用恢复 35 水分（解渴）；培养植物必需品；在积水旁按 F 采集' },
    coin:  { name: '金币',     char: '金', color: '#FFD700', heal: 0, desc: '通用货币：与 NPC 交易按物品价值买卖' },
    fert:  { name: '肥料',     char: '肥', color: '#AA7733', heal: 0,  desc: '培养植物必需品；搜刮箱子获得' },
    sun:   { name: '阳光',     char: '光', color: '#FFD700', heal: 0,  desc: '培养植物的战略资源；采集野生向日葵获得' },

    'tool:chopper': { name: '伐木斧', char: '斧', color: '#D2691E', heal: 0, desc: '砍树 1 下完成，木材产出 +50%；工具不叠加' },
    'tool:pick':    { name: '石镐',   char: '镐', color: '#999999', heal: 0, desc: '对碎石按 F 开采石块；工具不叠加' },
    'tool:hoe':     { name: '锄头',   char: '锄', color: '#AA8844', heal: 0, desc: '对荒地按 F 开垦种植盆（不耗木材）；工具不叠加' },
    'tool:wrench':  { name: '扳手',   char: '扳', color: '#66CCFF', heal: 0, desc: '修理建筑耐久（载具修理 · 后续阶段）；工具不叠加' },

    'med:cold':     { name: '感冒药',   char: '药', color: '#FFB08A', heal: 0, desc: '治疗感冒' },
    'med:wound':    { name: '消炎药',   char: '消', color: '#E8836A', heal: 0, desc: '治疗伤口感染' },
    'med:poison':   { name: '解毒剂',   char: '解', color: '#9AE88A', heal: 0, desc: '治疗食物中毒' },
    'med:dysentery':{ name: '止泻药',   char: '止', color: '#8AC8E8', heal: 0, desc: '治疗痢疾' },
    'med:pan':      { name: '抗生素',   char: '抗', color: '#C8A2E8', heal: 0, desc: '治疗任意疾病' },
    'med:heat':     { name: '藿香正气水', char: '藿', color: '#E8B33A', heal: 0, desc: '治疗中暑' },
    fuel:       { name: '汽油',     char: '油', color: '#E8A33D', heal: 0, desc: '车辆燃料：停车时对车加油补充 35 油量' },
    flag:       { name: '领地旗帜', char: '旗', color: '#FFD700', heal: 0, desc: '背包中点击（左键）使用：在脚下插旗建立营地。营地是 NPC 居住地（会吸引新居民），领地内回血/体力加速/移速提升，敌对生物减少生成；在旗帜处按 F 可收起' },
};
export const BAG_SIZE = 24;
export const CHEST_SIZE = 12;

// 武器字符/介绍（数值一律看本体 WEAPONS 表）
const W_CHAR = { pistol: '枪', smg: '冲', rifle: '步', sniper: '狙', shotgun: '霰', bow: '弓', knife: '刀',
    dagger: '剑', spear: '矛', axe: '斧', sword: '剑', fist: '拳', shovel: '铲' };
const W_DESC = {
    dagger: '常见的短剑，轻便实用的近战武器。',
    sword: '锋利的长剑，伤害可观的稀有近战。',
    spear: '长矛突刺，攻击距离最远的近战。',
    axe: '沉重的战斧，单发伤害最高的近战。',
    pistol: '可靠的半自动手枪，搜刮常见。',
    bow: '安静的弓箭，按住左键蓄力、松开发射。',
    shotgun: '近战爆发的散弹枪，一次喷出三颗弹丸。',
    smg: '射速极快的冲锋枪，可切换全自动。',
    rifle: '高伤害步枪，可切换全自动，稀有装备。',
    sniper: '单发重创的狙击枪，右键点按开镜（散射大幅降低），极为稀有。',
    knife: '可投掷的飞刀，消耗弹药但射速快。',
};
const RARITY_NAME = { common: '常见', rare: '稀有', epic: '史诗' };

// 战利品袋品质（强僵尸掉好袋）
export const LOOT_TIERS = {
    common: { name: '普通战利品', color: '#b8c0c8' },
    rare:   { name: '稀有战利品', color: '#4da3ff' },
    epic:   { name: '史诗战利品', color: '#ff9800' },
};

// 统一物品信息查询（材料 / 武器 / 弹药 / 种子）
export function getItemInfo(id) {
    if (ITEMS[id]) return ITEMS[id];
    if (id.startsWith('frag:')) {
        const info = parseFragmentId(id);
        if (info) {
            const slot = info.missing.length + 1;
            return {
                name: `残缺「${info.name}」`, char: info.name[0], color: '#a08050',
                fragment: true, severity: info.severity,
            };
        }
        return { name: '残缺物', char: '残', color: '#a08050', fragment: true };
    }
    if (id.startsWith('glyph-infected:')) {
        const char = id.slice(15);
        return { name: `感染字块「${char}」`, char, color: '#8b3b43', glyph: true, infected: true };
    }
    if (id.startsWith('glyph-unstable:')) {
        const char = id.slice(15);
        return { name: `不稳字块「${char}」`, char, color: '#b89a62', glyph: true, unstable: true };
    }
    if (id.startsWith('glyph:')) {
        const char = id.slice(6);
        return { name: `字块「${char}」`, char, color: '#d8d2bd', glyph: true };
    }
    if (id.startsWith('wedge:')) {
        const wedge = WEDGE_INFO[id] || WEDGE_INFO['wedge:rough'];
        return { name: wedge.name, char: '楔', color: wedge.color, wedge: true };
    }
    if (id.startsWith('loot:')) {
        const t = LOOT_TIERS[id.slice(5)] || LOOT_TIERS.common;
        return { name: t.name, char: '袋', color: t.color, loot: id.slice(5) };
    }
    if (id.startsWith('looted:')) {
        const t = LOOT_TIERS[id.slice(7)] || LOOT_TIERS.common;
        return { name: t.name + '(余)', char: '余', color: t.color, loot: id.slice(7), looted: true };
    }
    if (id.startsWith('seed:')) {
        const sp = id.slice(5);
        const names = { peashooter: '豌豆种子', snowpea: '寒冰种子', repeater: '双发种子', chomper: '大嘴种子', sunflower: '向日葵种子' };
        const chars = { peashooter: '豌', snowpea: '冰', repeater: '双', chomper: '嘴', sunflower: '葵' };
        const colors = { peashooter: '#00FF00', snowpea: '#00CCFF', repeater: '#00DD00', chomper: '#CC44FF', sunflower: '#FFD700' };
        return { name: names[sp] || '种子', char: chars[sp] || '种', color: colors[sp] || '#88DD44' };
    }
    if (id.startsWith('wpn:')) {
        const w = WEAPONS[id.slice(4)];
        if (w) return { name: w.name, char: W_CHAR[id.slice(4)] || '武', color: w.color || '#fff', weapon: w, wkey: id.slice(4) };
    }
    if (id.startsWith('ammo:')) {
        const a = AMMO_INFO[id.slice(5)];
        if (a) return { name: a.label, char: '弹', color: '#FFD700', ammo: a };
    }
    return { name: id, char: '?', color: '#fff' };
}

// 物品介绍（名称 + 描述 + 属性行），背包/柜子选中时展示
export function itemDesc(id) {
    if (ITEMS[id]) return ITEMS[id].desc || '';
    if (id.startsWith('frag:')) {
        const info = parseFragmentId(id);
        if (info) {
            const display = info.recipe.glyphs.map(ch => info.missing.includes(ch) ? '＿' : ch).join('');
            const sev = info.severity === 'light' ? '轻度残缺' : '严重残缺';
            return `${sev}物：「${display}」缺少 ${info.missing.join('、')}；在拼字台补字后可恢复为${info.name}。`;
        }
        return '来源不明的残缺物，名称结构已损坏。';
    }
    if (id.startsWith('glyph-infected:')) return '来自感染体的危险字块；当前不会自动填入日常具现配方，等待净化系统处理。';
    if (id.startsWith('glyph-unstable:')) return '现实结构不稳定的字块；当前不会自动填入日常具现配方，等待鉴定或净化。';
    if (id.startsWith('glyph:')) return '携带现实信息的残缺字块；必须与相容字块及字楔一起放入拼字台。';
    if (id.startsWith('wedge:')) {
        if (id === 'wedge:clean') return '隔离污染并固定精密概念；用于阳光、狙击枪和高精度弹药。';
        if (id === 'wedge:stable') return '稳定复杂字符连接；用于工具、武器、枪械和机械部件。';
        return '固定相邻字符意义的消耗品；适合具现食物、草药和基础材料。';
    }
    if (id.startsWith('loot:')) return '点击打开搜索出货；品质越高内容越好，僵尸越强掉的袋子品质越高。';
    if (id.startsWith('looted:')) return '已搜刮过的战利品袋，剩余物可直接取走。';
    if (id.startsWith('seed:')) {
        const sp = id.slice(5);
        const descs = {
            peashooter: '豌豆射手的种子，培养后自动射击僵尸（中距离单体）',
            snowpea: '寒冰射手的种子，培养后射击并减速僵尸',
            repeater: '双发射手的种子，培养后一次发射两颗豌豆',
            chomper: '大嘴花的种子，培养后近战吞噬僵尸（高伤害短射程）',
            sunflower: '向日葵的种子，培养后持续产出阳光（战略资源点）',
        };
        return `${descs[sp] || '未知种子'}；需要 水+肥料+阳光 在种植盆培养`;
    }
    if (id.startsWith('wpn:')) {
        const wkey = id.slice(4), w = WEAPONS[wkey];
        if (!w) return '';
        const stats = [`伤害 ${w.damage}`];
        if (w.kind === 'melee') stats.push(`范围 ${w.reach || 40}`);
        else stats.push(`射程 ${w.range || 300}`, `弹匣 ${w.magSize || 1}（${w.ammoLabel || '弹药'}）`);
        stats.push(`攻速 ${(1 / (w.fireInterval || 0.5)).toFixed(1)}/s`, `体力 ${w.stamina || 0}`);
        return `${W_DESC[wkey] || ''}【${RARITY_NAME[w.rarity] || '普通'}·${w.kind === 'melee' ? '近战' : '远程'}】` + stats.join(' · ');
    }
    if (id.startsWith('ammo:')) return '武器弹药：按 R 换弹时消耗，装入对应弹种武器';
    return '';
}

// ---------- 物品分类（彩色边框线条表示类别） ----------
export const CAT_INFO = {
    glyph:  { name: '字块', color: '#d8d2bd' },
    wedge:  { name: '字楔', color: '#c8794a' },
    fragment: { name: '残缺物', color: '#a08050' },
    weapon: { name: '武器', color: '#d9534f' },
    ammo:   { name: '弹药', color: '#e0a800' },
    supply: { name: '补给', color: '#5cb85c' },
    cult:   { name: '种植', color: '#5bc0de' },
    mat:    { name: '材料', color: '#a1887f' },
    seed:   { name: '种子', color: '#9ccc65' },
    tool:   { name: '工具', color: '#ff9800' },
    loot:   { name: '战利品', color: '#e0c860' },
    gem:    { name: '稀有', color: '#ab47bc' },
    misc:   { name: '其他', color: '#888888' },
};
export function itemCategory(id) {
    if (id.startsWith('frag:')) return 'fragment';
    if (id.startsWith('glyph:') || id.startsWith('glyph-unstable:') || id.startsWith('glyph-infected:')) return 'glyph';
    if (id.startsWith('wedge:')) return 'wedge';
    if (id.startsWith('loot:')) return 'loot';
    if (id.startsWith('looted:')) return 'loot';
    if (id.startsWith('wpn:')) return 'weapon';
    if (id.startsWith('ammo:')) return 'ammo';
    if (id.startsWith('seed:')) return 'seed';
    if (id.startsWith('tool:')) return 'tool';
    if (id === 'food' || id === 'herb') return 'supply';
    if (id === 'water' || id === 'fert' || id === 'sun') return 'cult';
    if (id === 'wood' || id === 'stone' || id === 'part') return 'mat';
    if (id === 'gem') return 'gem';
    return 'misc';
}
export function legendHtml() {
    return '<div class="wsl-legend">' + Object.values(CAT_INFO).map(c =>
        `<span class="wsl-legend-item"><i class="wsl-legend-swatch" style="border-color:${c.color}"></i>${c.name}</span>`
    ).join('') + '</div>';
}

const maxStack = (id) => id.startsWith('ammo:') ? 999 : (id.startsWith('wpn:') || id.startsWith('tool:') || id.startsWith('looted:') || id.startsWith('frag:') ? 1 : 99);

// 通用入包（数组 + 同类堆叠），返回未能放入的数量
export function addToArr(arr, id, n) {
    const max = maxStack(id);
    let left = n;
    if (max > 1) {
        for (const s of arr) {
            if (left <= 0) break;
            if (s && s.id === id && s.n < max) {
                const add = Math.min(max - s.n, left);
                s.n += add; left -= add;
            }
        }
    }
    for (let i = 0; i < arr.length && left > 0; i++) {
        if (!arr[i]) {
            const add = Math.min(max, left);
            arr[i] = { id, n: add };
            left -= add;
        }
    }
    return left;
}

// 开发者无限背包：同类无限堆叠（无视上限），空位不足自动扩容（背包 UI 按实际格数显示）
function addToArrInf(arr, id, n) {
    let left = n;
    for (const s of arr) {
        if (left <= 0) break;
        if (s && s.id === id) { s.n += left; left = 0; }
    }
    while (left > 0) {
        let i = arr.indexOf(null);
        if (i < 0) { i = arr.length; arr.push(null); }
        arr[i] = { id, n: left };
        left = 0;
    }
    return 0;
}

// 物品入背包，返回未能放入的数量
export function addItem(sv, id, n) {
    const left = (saveData.devMode && sv._devInfBag)
        ? addToArrInf(sv.inv, id, n)
        : addToArr(sv.inv, id, n);
    if (bagOpen || chestOpen) refresh(sv);
    return left;
}

// 战利品袋入包（loot: 同 id 堆叠，每袋独立保存在 bags；looted: 不堆叠）
export function addItemLoot(sv, item) {
    const id = item.id;
    const infBag = saveData.devMode && sv._devInfBag;
    if (id.startsWith('looted:')) {
        for (let i = 0; i < sv.inv.length; i++) {
            if (!sv.inv[i]) {
                sv.inv[i] = { id, n: 1, contents: item.contents || [], searched: item.searched };
                if (bagOpen || chestOpen) refresh(sv);
                return true;
            }
        }
        // 开发者无限背包：自动扩容
        if (infBag) {
            sv.inv.push({ id, n: 1, contents: item.contents || [], searched: item.searched });
            if (bagOpen || chestOpen) refresh(sv);
            return true;
        }
        return false;
    }
    // loot: 堆叠，bags 保存每袋独立内容
    for (let i = 0; i < sv.inv.length; i++) {
        const s = sv.inv[i];
        if (s && s.id === id) {
            s.n += item.n || 1;
            if (!s.bags) s.bags = [s.contents || []];
            s.bags.push(item.contents || []);
            if (bagOpen || chestOpen) refresh(sv);
            return true;
        }
    }
    for (let i = 0; i < sv.inv.length; i++) {
        if (!sv.inv[i]) {
            sv.inv[i] = { id, n: item.n || 1, contents: item.contents || [] };
            if (bagOpen || chestOpen) refresh(sv);
            return true;
        }
    }
    // 开发者无限背包：自动扩容
    if (infBag) {
        sv.inv.push({ id, n: item.n || 1, contents: item.contents || [] });
        if (bagOpen || chestOpen) refresh(sv);
        return true;
    }
    return false;
}

let bagEl = null;
let chestEl = null;
let deathEl = null;
let bagOpen = false;
let chestOpen = false;
let host = null;   // { onUse(slotIndex), onDrop(slotIndex), onChestClose() }
let selInfo = null;   // 当前选中展示的物品 id

export function initPanel(h) {
    host = h;
    const screen = document.getElementById('game-container');
    if (!screen) return;
    if (!bagEl) {
        bagEl = document.createElement('div');
        bagEl.id = 'wsl-bag';
        bagEl.className = 'wsl-bag hidden';
        screen.appendChild(bagEl);
    }
    if (!chestEl) {
        chestEl = document.createElement('div');
        chestEl.id = 'wsl-chest';
        chestEl.className = 'wsl-bag hidden';
        screen.appendChild(chestEl);
    }
    if (!deathEl) {
        deathEl = document.createElement('div');
        deathEl.id = 'wsl-death';
        deathEl.className = 'wsl-death hidden';
        screen.appendChild(deathEl);
    }
}

export function isBagOpen() { return bagOpen; }
export function isChestOpen() { return chestOpen; }
export function anyOpen() { return bagOpen || chestOpen; }
export function getSelInfo() { return selInfo; }
export function toggleBag(sv) {
    if (chestOpen) { hideChest(); return; }
    bagOpen ? hideBag() : showBag(sv);
}

function cellHtml(s, i, tag) {
    if (!s) return `<div class="wsl-cell" data-${tag}="${i}"></div>`;
    const it = getItemInfo(s.id);
    const eq = s.eq ? '<span class="wsl-cell-eq">装</span>' : '';
    const broken = !!s.broken;   // 损坏武器：灰色 + 损标
    const catColor = CAT_INFO[itemCategory(s.id)].color;
    const dragAttr = tag === 'i' ? ` data-drag-i="${i}"` : '';
    const name = it.name;
    const len = name.length;
    const fs = len <= 2 ? 24 : (len === 3 ? 16 : (len === 4 ? 12 : 10));
    const tip = broken ? `${name} · 已损坏（扳手+零件×2 修复）` : `${name} · ${itemDesc(s.id)}`;
    return `<div class="wsl-cell" data-${tag}="${i}" data-item="${s.id}"${dragAttr} style="border-color:${catColor}" title="${tip}">` +
        `<span class="wsl-cell-char" style="color:${broken ? '#666666' : it.color};font-size:${fs}px">${name}</span>` +
        `<span class="wsl-cell-n">${s.n}</span>${eq}${broken ? '<span class="wsl-cell-broken">损</span>' : ''}</div>`;
}

function infoHtml() {
    if (!selInfo) return '<div class="wsl-item-info dim">点击物品查看介绍；武器点击装备/卸下，草药食物点击使用</div>';
    const it = getItemInfo(selInfo);
    return `<div class="wsl-item-info"><b style="color:${it.color}">${it.name}</b>　${itemDesc(selInfo)}</div>`;
}

// ---------- 背包 ----------
// 整理背包：同类合并（同 id 累加 n）+ 非空格前移 + 排序（普通物品按 id，loot 袋排最后）。
// 快捷栏存的是物品 id（非格索引），整理后按 id 自动寻新格，绑定零错位。
export function sortBag(sv) {
    const out = [];
    const byId = new Map();
    for (const s of sv.inv) {
        if (!s) continue;
        if (String(s.id).startsWith('loot:')) { out.push(s); continue; }   // 战利品袋各带独立 contents，不合并
        const t = byId.get(s.id);
        if (t) t.n += s.n;
        else { const c = { ...s }; byId.set(s.id, c); out.push(c); }
    }
    out.sort((a, b) => {
        const al = String(a.id).startsWith('loot:') ? 1 : 0;
        const bl = String(b.id).startsWith('loot:') ? 1 : 0;
        if (al !== bl) return al - bl;
        return String(a.id).localeCompare(String(b.id));
    });
    const len = Math.max(BAG_SIZE, sv.inv.length);   // 保持现有容量（含 dev 无限背包扩容格）
    sv.inv = out.concat(Array(Math.max(0, len - out.length)).fill(null));
    return out.length;
}

export function showBag(sv) {
    if (!bagEl) return;
    hideChest();
    bagOpen = true;
    renderBag(sv);
    bagEl.classList.remove('hidden');
    AudioSystem.playOpenBox();
}

export function hideBag() {
    if (!bagOpen) return;
    bagOpen = false;
    selInfo = null;
    if (bagGhost) { bagGhost.remove(); bagGhost = null; }
    bagDrag = null;
    if (bagEl) bagEl.classList.add('hidden');
    AudioSystem.playCloseBox();
}

export function renderBag(sv) {
    if (!bagEl) return;
    const used = sv.inv.filter(Boolean).length;
    const cap = (saveData.devMode && sv._devInfBag) ? sv.inv.length : BAG_SIZE;
    const cells = sv.inv.map((s, i) => cellHtml(s, i, 'i')).join('');
    bagEl.innerHTML =
        `<div class="wsl-bag-head"><span>背 包 ${used}/${cap}${cap > BAG_SIZE ? ' · 无限' : ''}</span>` +
        `<span class="wsl-bag-tip">左键使用/装备 · 右键查看详情/丢弃 · 拖到下方丢弃区 · 选中后按 1-6 绑定快捷栏</span>` +
        `<button class="wsl-sort-btn" id="wsl-bag-sort" title="同类合并 + 排序（战利品袋独立保留）">整 理</button>` +
        `<button class="wsl-close-btn" id="wsl-bag-close" title="关闭 (B/ESC)">×</button></div>` +
        legendHtml() +
        `<div class="wsl-bag-grid">${cells}</div>` +
        `<div class="wsl-discard" id="wsl-bag-discard">拖到此处丢弃</div>` +
        infoHtml();
    const bagClose = bagEl.querySelector('#wsl-bag-close');
    if (bagClose) bagClose.addEventListener('click', () => hideBag());
    const bagSort = bagEl.querySelector('#wsl-bag-sort');
    if (bagSort) bagSort.addEventListener('click', () => {
        const merged = sortBag(sv);
        MSG.pushMsg(sv, merged > 0 ? `背包已整理：${merged} 组物品排序完成` : '背包是空的', merged > 0 ? '#7DFF7D' : '#FFB347');
        renderBag(sv);
    });
    bagEl.querySelectorAll('.wsl-cell[data-i]').forEach(el => {
        el.addEventListener('click', () => onBagClick(sv, +el.dataset.i));
    });
    bagEl.querySelectorAll('.wsl-cell[data-item]').forEach(el => {
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            const slot = el.dataset.i != null ? +el.dataset.i : null;
            const id = el.dataset.item;
            let batchFn = null;
            if (id && id.startsWith('loot:') && slot != null) {
                const s = sv.inv[slot];
                if (s && s.n > 1 && host && host.onBatchOpen) batchFn = () => host.onBatchOpen(slot);
            }
            showItemDetail(id, (slot != null && host && host.onDrop) ? () => host.onDrop(slot) : null, batchFn);
        });
    });
    bindBagDrag(sv);
}

// 背包拖拽丢弃：按住物品拖到丢弃区松手 → host.onDrop
let bagDrag = null, bagGhost = null;
function bindBagDrag(sv) {
    if (!bagEl) return;
    bagEl.querySelectorAll('.wsl-cell[data-drag-i]').forEach(el => {
        el.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            const s = sv.inv[+el.dataset.dragI];
            bagDrag = { slot: +el.dataset.dragI, startX: e.clientX, startY: e.clientY, moved: false, char: s ? getItemInfo(s.id).char : '' };
        });
    });
    if (!bagEl._dragBound) {
        bagEl._dragBound = true;
        document.addEventListener('pointermove', e => {
            if (!bagDrag) return;
            if (!bagDrag.moved && Math.hypot(e.clientX - bagDrag.startX, e.clientY - bagDrag.startY) > 6) {
                bagDrag.moved = true;
                bagGhost = document.createElement('div');
                bagGhost.className = 'wsl-drag-ghost';
                bagGhost.textContent = bagDrag.char;
                document.body.appendChild(bagGhost);
            }
            if (bagDrag.moved && bagGhost) {
                bagGhost.style.left = (e.clientX + 10) + 'px';
                bagGhost.style.top = (e.clientY + 10) + 'px';
                const over = document.elementFromPoint(e.clientX, e.clientY);
                const dz = bagEl.querySelector('#wsl-bag-discard');
                if (dz) dz.classList.toggle('wsl-drop-hl', !!(over && over.closest('#wsl-bag-discard')));
            }
        });
        document.addEventListener('pointerup', e => {
            if (!bagDrag) return;
            if (bagDrag.moved) {
                const over = document.elementFromPoint(e.clientX, e.clientY);
                if (over && over.closest('#wsl-bag-discard') && host && host.onDrop) host.onDrop(bagDrag.slot);
            }
            if (bagGhost) { bagGhost.remove(); bagGhost = null; }
            bagDrag = null;
        });
    }
}

function onBagClick(sv, i) {
    const s = sv.inv[i];
    if (!s) return;
    selInfo = s.id;
    if (s.id.startsWith('wpn:')) {
        // 武器：装备到对应槽 / 再点卸下（槽位由武器 kind 决定）
        const w = WEAPONS[s.id.slice(4)];
        const slot = w && w.kind === 'melee' ? 'melee' : 'ranged';
        if (s.eq === slot) delete s.eq;
        else {
            for (const o of sv.inv) if (o && o.eq === slot) delete o.eq;
            s.eq = slot;
        }
    } else if (s.id.startsWith('loot:') || s.id.startsWith('looted:')) {
        if (host && host.onUse) host.onUse(i);   // 战利品袋：打开搜索
    } else if ((ITEMS[s.id] || {}).heal) {
        if (host && host.onUse) host.onUse(i);   // 回血类交给主控（改 HP）
    }
    renderBag(sv);
}

// ---------- 储物柜 ----------
export function showChest(sv, key, name) {
    if (!chestEl) return;
    hideBag();
    if (!sv.mods.chests[key]) sv.mods.chests[key] = Array(CHEST_SIZE).fill(null);
    sv.chestKey = key;
    sv.chestName = name || '储 物 柜';
    chestOpen = true;
    renderChest(sv);
    chestEl.classList.remove('hidden');
    AudioSystem.playOpenBox();
}

export function hideChest() {
    if (!chestOpen) return;
    chestOpen = false;
    selInfo = null;
    if (chestEl) chestEl.classList.add('hidden');
    AudioSystem.playCloseBox();
}

export function renderChest(sv) {
    if (!chestEl || !sv.chestKey) return;
    const chest = sv.mods.chests[sv.chestKey];
    const bagCells = sv.inv.map((s, i) => cellHtml(s, i, 'b')).join('');
    const chestCells = chest.map((s, i) => cellHtml(s, i, 'c')).join('');
    chestEl.innerHTML =
        `<div class="wsl-bag-head"><span>${sv.chestName || '储 物 柜'}</span>` +
        `<span class="wsl-bag-tip">B/F/ESC 关闭 · 点击物品转移 · 右键查看详情/丢弃</span>` +
        `<button class="wsl-close-btn" id="wsl-chest-close" title="关闭 (B/ESC)">×</button></div>` +
        legendHtml() +
        `<div class="wsl-chest-cols">` +
        `<div><div class="wsl-chest-title">${sv.chestName || '容器'} ${chest.filter(Boolean).length}/${chest.length}</div><div class="wsl-bag-grid wsl-chest-grid">${chestCells}</div></div>` +
        `<div><div class="wsl-chest-title">背包 ${sv.inv.filter(Boolean).length}/${(saveData.devMode && sv._devInfBag) ? sv.inv.length : BAG_SIZE}</div><div class="wsl-bag-grid">${bagCells}</div></div>` +
        `</div>` + infoHtml();
    const chestClose = chestEl.querySelector('#wsl-chest-close');
    if (chestClose) chestClose.addEventListener('click', () => hideChest());
    chestEl.querySelectorAll('.wsl-cell[data-b]').forEach(el => {
        el.addEventListener('click', () => { transfer(sv, sv.inv, +el.dataset.b, sv.mods.chests[sv.chestKey]); });
    });
    chestEl.querySelectorAll('.wsl-cell[data-c]').forEach(el => {
        el.addEventListener('click', () => { transfer(sv, sv.mods.chests[sv.chestKey], +el.dataset.c, sv.inv); });
    });
    chestEl.querySelectorAll('.wsl-cell[data-item]').forEach(el => {
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (el.dataset.b != null) {
                showItemDetail(el.dataset.item, host && host.onDrop ? () => host.onDrop(+el.dataset.b) : null);
            } else if (el.dataset.c != null) {
                showItemDetail(el.dataset.item, host && host.onChestDrop ? () => host.onChestDrop(+el.dataset.c) : null);
            } else {
                showItemDetail(el.dataset.item);
            }
        });
    });
}

// 整堆转移（转入方放不下的部分留在原处；武器转出背包自动卸下）
function transfer(sv, fromArr, i, toArr) {
    const s = fromArr[i];
    if (!s) return;
    selInfo = s.id;
    const left = addToArr(toArr, s.id, s.n);
    if (left < s.n) delete s.eq;
    if (left <= 0) fromArr[i] = null;
    else s.n = left;
    renderChest(sv);
    // 联机：箱子内容变更上报（host/guest 双向同步；车箱/储物柜同一入口）
    if (sv && sv.mp && sv.chestKey) {
        (sv.mpOutbox = sv.mpOutbox || []).push({
            type: 'chest',
            key: sv.chestKey,
            items: JSON.parse(JSON.stringify(sv.mods.chests[sv.chestKey] || [])),
        });
    }
}

export function refresh(sv) {
    if (bagOpen) renderBag(sv);
    if (chestOpen) renderChest(sv);
}

// ---------- 死亡界面 ----------
export function showDeath(html, onExit) {
    if (!deathEl) return;
    deathEl.innerHTML = '<div class="wsl-scaler">' + html + '<button class="menu-btn" id="wsl-death-exit">返回主菜单</button></div>';
    deathEl.classList.remove('hidden');
    deathEl.querySelector('#wsl-death-exit').addEventListener('click', onExit);
}
export function hideDeath() { if (deathEl) deathEl.classList.add('hidden'); }

// ---------- 物品详情弹窗（右键查看：名称/类别/稀有度/介绍/属性；背包/储物柜/搜索界面可丢弃） ----------
let detailEl = null;
export function showItemDetail(id, discardFn, batchFn) {
    const it = getItemInfo(id);
    const cat = CAT_INFO[itemCategory(id)];
    if (!detailEl) {
        detailEl = document.createElement('div');
        detailEl.className = 'wsl-detail hidden';
        (document.getElementById('game-container') || document.body).appendChild(detailEl);
        detailEl.addEventListener('click', e => { if (e.target === detailEl) hideItemDetail(); });
    }
    let stats = '';
    if (id.startsWith('wpn:')) {
        const w = WEAPONS[id.slice(4)];
        if (w) {
            const rows = [`伤害 <b>${w.damage}</b>`];
            if (w.kind === 'melee') rows.push(`范围 <b>${w.reach || 40}</b>`);
            else rows.push(`射程 <b>${w.range || 300}</b>`, `弹匣 <b>${w.magSize || 1}</b>`);
            rows.push(`攻速 <b>${(1 / (w.fireInterval || 0.5)).toFixed(1)}/s</b>`, `体力 <b>${w.stamina || 0}</b>`);
            stats = `<div class="wsl-detail-stats">${rows.map(r => `<span>${r}</span>`).join('')}</div>`;
        }
    }
    detailEl.innerHTML =
        `<div class="wsl-detail-box">` +
        `<div class="wsl-detail-head"><span class="wsl-detail-char" style="color:${it.color}">${it.char}</span>` +
        `<b>${it.name}</b>` +
        `<span class="wsl-detail-cat" style="border-color:${cat.color};color:${cat.color}">${cat.name}</span></div>` +
        `<div class="wsl-detail-desc">${itemDesc(id) || '—'}</div>` +
        stats +
        (batchFn ? `<button class="menu-btn wsl-detail-batch">全部打开</button>` : '') +
        (discardFn ? `<button class="menu-btn wsl-detail-drop">丢 弃</button>` : '') +
        `<button class="menu-btn wsl-detail-close">关 闭</button>` +
        `</div>`;
    detailEl.classList.remove('hidden');
    detailEl.querySelector('.wsl-detail-close').addEventListener('click', hideItemDetail);
    if (batchFn) detailEl.querySelector('.wsl-detail-batch').addEventListener('click', () => { hideItemDetail(); batchFn(); });
    if (discardFn) detailEl.querySelector('.wsl-detail-drop').addEventListener('click', () => { discardFn(); hideItemDetail(); });
    AudioSystem.playClick();
}
export function hideItemDetail() { if (detailEl) detailEl.classList.add('hidden'); }

export function destroyPanel() {
    bagOpen = false;
    chestOpen = false;
    selInfo = null;
    if (bagEl) { bagEl.remove(); bagEl = null; }
    if (chestEl) { chestEl.remove(); chestEl = null; }
    if (detailEl) { detailEl.remove(); detailEl = null; }
    if (deathEl) { deathEl.remove(); deathEl = null; }
    if (bagGhost) { bagGhost.remove(); bagGhost = null; }
    bagDrag = null;
}
