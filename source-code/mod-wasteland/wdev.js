// ============================================================
// 【无尽植僵荒原】模组 · 开发者调试面板（局内 F9 开关）
// 需本体设置激活开发者模式（saveData.devMode）。
// 开关状态挂在 sv 上，供 survival/wgear/wzombie 等模块直接读取：
//   sv._devGod      无敌（不受伤）
//   sv._devInf      资源无限（建造/培养/使用不消耗）
//   sv._devInfAmmo  无限弹药（弹匣不消耗、无需换弹）
//   sv._devOneShot  一击必杀
//   sv._devDmgMul   武器伤害倍率
// ============================================================

import { saveData } from '../core/state.js';
import { getStorage, setStorage } from '../persistence/storage.js';
import { TS } from './wconst.js';
import { T, CHUNK, getTile, isWalk, setTile } from './world.js';
import { spawnZombie } from './wzombie.js';
import * as Panel from './panel.js';
import * as MSG from './wmsg.js';
import * as B from './wbalance.js';
import { startHordePrep } from './whorde.js';
import * as WNPC from './wnpc.js';
import * as HUD from './whud.js';
import * as WD from './windoor.js';
import { showLookCreator, normalizeLook } from './wlook.js';
import * as WMAP from './wmap.js';
import * as WGRADE from './wgrade.js';   // 2026-08-11 v2.98 品级系统：开发者测试入口
import AudioSystem from '../systems/audio.js';

const SAVE_KEY = 'wasteland_save';
// profile 键（与 survival.js 同值；wdev 独立定义——此前未定义导致 persistDev 一执行就
// ReferenceError：dev 标志不持久化 + reportDevFlags 后续中断，本次修复）
const PROFILE_KEY = 'wasteland_profile';

let devEl = null;
let devOpen = false;
let curSv = null;

const DMG_PRESETS = [1, 2, 5, 10, 50, 100];

// 状态测试：饥饿/饱食/血量/水分/感染快捷设置
// 2026-08-11 v2.98 用户反馈：「濒死倒地」「补刀致死」开发者按钮有 bug，全部删除——
// 局内玩法的倒地/尸体/尸变/搜索/救助等逻辑**完整保留**（onDeath / updateDowned / deathDropLegacy /
// updateCorpseRevive / reviveZombieToCorpse / doInteract 等均不动），只移除这两个开发者入口。
const STATE_ACTIONS = [
    { s: 'starve', name: '饥饿(food0)' },
    { s: 'lowfood', name: '低饱食30' },
    { s: 'fullfood', name: '吃饱100' },
    { s: 'thirst', name: '缺水(water0)' },
    { s: 'fullwater', name: '满水100' },
    { s: 'hp1', name: '一滴血' },
    { s: 'hpfull', name: '回满血' },
    { s: 'inf50', name: '感染50' },
    { s: 'inf0', name: '清除感染' },
    { s: 'full', name: '☆ 一键状态回满', all: true },   // 血量/饱食/水分/体力全满 + 清除全部负面状态
];
// 2026-08-11 v2.98 品级系统测试入口：给当前装备武器随机赋品级 + 灵石测试（独立子块「武器与品级」）
const GRADE_ACTIONS = [
    { s: 'grade', name: '装备随机品级' },
    { s: 'ling', name: '灵石×20' },
];

// 搜索测试：附近刷出可搜刮容器（覆盖城市规划保护层：优先放在非路/非人行道空地）
const DEV_BOXES = [
    { t: 'BOX', name: '物资箱' }, { t: 'WBOX', name: '武器箱' },
    { t: 'MEDBOX', name: '医疗箱' }, { t: 'MATBOX', name: '建材箱' },
    { t: 'TRASHBIN', name: '垃圾桶' }, { t: 'CARDBOX', name: '纸箱' },
    { t: 'NEWSSTAND', name: '报刊亭' }, { t: 'HYDRANT', name: '消防栓' },
    { t: 'TIRES', name: '废弃轮胎' },
];

const CATEGORIES = [
    {
        name: '武器', color: '#C0C0C0',
        items: [
            { id: 'wpn:dagger', name: '短剑', char: '剑', n: 1 },
            { id: 'wpn:sword', name: '长剑', char: '剑', n: 1 },
            { id: 'wpn:spear', name: '长矛', char: '矛', n: 1 },
            { id: 'wpn:axe', name: '战斧', char: '斧', n: 1 },
            { id: 'wpn:shovel', name: '铁锹', char: '铲', n: 1 },
            { id: 'wpn:pistol', name: '手枪', char: '枪', n: 1 },
            { id: 'wpn:smg', name: '冲锋枪', char: '冲', n: 1 },
            { id: 'wpn:rifle', name: '步枪', char: '步', n: 1 },
            { id: 'wpn:sniper', name: '狙击', char: '狙', n: 1 },
            { id: 'wpn:shotgun', name: '散弹', char: '霰', n: 1 },
            { id: 'wpn:bow', name: '弓箭', char: '弓', n: 1 },
            { id: 'wpn:knife', name: '飞刀', char: '刀', n: 1 },
        ],
    },
    {
        name: '弹药', color: '#FFD700',
        items: [
            { id: 'ammo:pistolAmmo', name: '9mm手枪弹', char: '弹', n: 30 },
            { id: 'ammo:smgAmmo', name: '9mm冲锋枪弹', char: '弹', n: 60 },
            { id: 'ammo:rifleAmmo', name: '7.62mm步枪弹', char: '弹', n: 30 },
            { id: 'ammo:sniperAmmo', name: '狙击弹', char: '弹', n: 10 },
            { id: 'ammo:shellAmmo', name: '12号霰弹', char: '弹', n: 12 },
            { id: 'ammo:arrowAmmo', name: '箭矢', char: '箭', n: 25 },
            { id: 'ammo:knifeAmmo', name: '飞刀', char: '刀', n: 15 },
        ],
    },
    {
        name: '工具', color: '#D2691E',
        items: [
            { id: 'tool:chopper', name: '伐木斧', char: '斧', n: 1 },
            { id: 'tool:pick', name: '石镐', char: '镐', n: 1 },
            { id: 'tool:hoe', name: '锄头', char: '锄', n: 1 },
            { id: 'tool:wrench', name: '扳手', char: '扳', n: 1 },
            { id: 'flag', name: '领地旗帜', char: '旗', n: 1 },
        ],
    },
    {
        name: '材料', color: '#8FBC8F',
        items: [
            { id: 'food', name: '食物', char: '食', n: 5 },
            { id: 'water', name: '水', char: '水', n: 5 },
            { id: 'wood', name: '木材', char: '木', n: 10 },
            { id: 'stone', name: '石块', char: '石', n: 10 },
            { id: 'part', name: '修车零件', char: '件', n: 5 },
            { id: 'gem', name: '宝石', char: '钻', n: 1 },
            { id: 'fert', name: '肥料', char: '肥', n: 5 },
            { id: 'sun', name: '阳光', char: '光', n: 5 },
            { id: 'fuel', name: '汽油', char: '油', n: 3 },
            { id: 'coin', name: '金币', char: '金', n: 50 },
        ],
    },
    {
        name: '药品', color: '#FFB08A',
        items: [
            { id: 'med:cold', name: '感冒药', char: '药', n: 1 },
            { id: 'med:wound', name: '消炎药', char: '消', n: 1 },
            { id: 'med:poison', name: '解毒剂', char: '解', n: 1 },
            { id: 'med:dysentery', name: '止泻药', char: '止', n: 1 },
            { id: 'med:heat', name: '藿香正气水', char: '藿', n: 1 },
            { id: 'med:pan', name: '抗生素', char: '抗', n: 1 },
            { id: 'herb', name: '草药', char: '草', n: 3 },
        ],
    },
    {
        name: '种子', color: '#88DD44',
        items: [
            { id: 'seed:peashooter', name: '豌豆种子', char: '豌', n: 1 },
            { id: 'seed:sunflower', name: '向日葵种子', char: '葵', n: 1 },
            { id: 'seed:snowpea', name: '寒冰种子', char: '冰', n: 1 },
            { id: 'seed:repeater', name: '双发种子', char: '双', n: 1 },
            { id: 'seed:chomper', name: '大嘴种子', char: '嘴', n: 1 },
        ],
    },
    {
        name: '战利品袋', color: '#4da3ff',
        items: [
            { id: 'loot:common', name: '普通战利品袋', char: '袋', n: 1 },
            { id: 'loot:rare', name: '稀有战利品袋', char: '袋', n: 1 },
            { id: 'loot:epic', name: '史诗战利品袋', char: '袋', n: 1 },
            { id: 'looted:rare', name: '稀有战利品(余)', char: '余', n: 1 },
        ],
    },
    {
        name: '僵尸（附近刷出）', color: '#B0B0B0',
        items: [
            { id: 'zombie:normal', name: '普通', char: '僵', n: 1 },
            { id: 'zombie:cone', name: '路障', char: '障', n: 1 },
            { id: 'zombie:bucket', name: '铁桶', char: '桶', n: 1 },
            { id: 'zombie:pole', name: '撑杆', char: '杆', n: 1 },
            { id: 'zombie:flag', name: '旗帜', char: '旗', n: 1 },
            { id: 'zombie:door', name: '铁门', char: '门', n: 1 },
        ],
    },
];

export function isOpen() { return devOpen; }

export function isDev() { return !!saveData.devMode; }

export function init(sv) {
    curSv = sv;
    if (!isDev()) return;
    // 开发者模式默认开启资源无限
    if (sv._devInf == null) sv._devInf = true;
    if (sv._devDmgMul == null) sv._devDmgMul = 1;
    // 恢复上次的调试 HUD 开关（本地 profile，不进联机同步）
    const p = getStorage(PROFILE_KEY, null);
    if (p && p._devHud) {
        sv._devHud = true;
        HUD.update(sv, performance.now());
    }
    // profile 画质恢复：仅当面板设置（startRun opts.gfx）未指定时生效——面板设置优先
    if (p && p._devGfx != null && sv._devGfx == null) sv._devGfx = p._devGfx;
    const screen = document.getElementById('game-container');
    if (!screen || devEl) return;
    devEl = document.createElement('div');
    devEl.id = 'wsl-dev';
    devEl.className = 'wsl-dev hidden';
    devEl.innerHTML = buildHtml();
    screen.appendChild(devEl);
    bindEvents();
}

export function toggle(sv) {
    if (!isDev() || !devEl) {
        MSG.pushMsg(sv, '开发者模式未激活（主菜单设置 → 输入开发者码 KFZMS）', '#FF6666');
        return;
    }
    curSv = sv;
    devOpen = !devOpen;
    devEl.classList.toggle('hidden', !devOpen);
    if (devOpen) { syncState(); AudioSystem.playClick(); }
}
// 2026-08-10 通用返回：ESC 关闭开发者面板（isOpen/close 供 survival 调用）
export function close() {
    if (devOpen) {
        devOpen = false;
        if (devEl) devEl.classList.add('hidden');
    }
}

export function destroy() {
    devOpen = false;
    curSv = null;
    if (devEl) { devEl.remove(); devEl = null; }
}

// 2026-08-11 v2.99 开发者面板分区：主控角色（局部，只作用于当前控制角色） / 全局世界（时间/环境/实体/危险操作）
function buildHtml() {
    // ============ 主控角色面板（局部） ============
    let localHtml = `
        <div class="wsl-dev-sub">▸ 能力开关（只作用于主控角色）</div>
        <div class="wsl-dev-toggles">
            <button data-t="god" id="wdev-god" title="无敌：生命/体力/饱食/水分全满且不消耗，不受伤">属性全满</button>
            <button data-t="stamina" id="wdev-stamina">无限体力</button>
            <button data-t="inf" id="wdev-inf">资源无限</button>
            <button data-t="ammo" id="wdev-ammo" title="无限弹药 + 无限武器耐久（耐久不消耗）">无限弹药</button>
            <button data-t="dura" id="wdev-dura">无限耐久</button>
            <button data-t="bag" id="wdev-bag">无限背包</button>
            <button data-t="oneshot" id="wdev-oneshot">一击必杀</button>
            <button data-t="hud" id="wdev-hud">调试HUD</button>
        </div>
        <div class="wsl-dev-dmg">
            <span class="wsl-dev-dmg-label">武器伤害倍率（主控攻击）</span>
            <div class="wsl-dev-dmg-presets">
                ${DMG_PRESETS.map(v => `<button data-mul="${v}">×${v}</button>`).join('')}
            </div>
        </div>
        <div class="wsl-dev-sub">▸ 武器与品级（主控装备）</div>
        <div class="wsl-dev-quick">
            ${GRADE_ACTIONS.map(a => `<button data-s="${a.s}">${a.name}</button>`).join('')}
        </div>
        <div class="wsl-dev-sub">▸ 身体状态（主控生命体征）</div>
        <div class="wsl-dev-quick">
            ${STATE_ACTIONS.map(a => `<button data-s="${a.s}">${a.name}</button>`).join('')}
        </div>
        <div class="wsl-dev-quick wsl-dev-infbar" title="自定义感染值（0~100%，拖动滑块即时生效，方便感染阶段调试）">
            <span class="wsl-dev-inf-label">感染值</span>
            <input type="range" id="wdev-inf-range" min="0" max="100" step="1" value="0" style="flex:1;accent-color:#7a4a2a;">
            <span id="wdev-inf-val" style="color:#FFB347;font-size:12px;min-width:34px;text-align:right;">0</span>
        </div>
        <div class="wsl-dev-sub">▸ 疾病测试（染病 → 看 HUD/小人特效 → 吃药或草药治疗）</div>
        <div class="wsl-dev-boxes">
            <button class="wsl-dev-item" data-sick="cold"><span class="wsl-dev-item-name">感冒</span></button>
            <button class="wsl-dev-item" data-sick="wound"><span class="wsl-dev-item-name">伤口感染</span></button>
            <button class="wsl-dev-item" data-sick="poison"><span class="wsl-dev-item-name">食物中毒</span></button>
            <button class="wsl-dev-item" data-sick="dysentery"><span class="wsl-dev-item-name">痢疾</span></button>
            <button class="wsl-dev-item" data-sick="heatstroke"><span class="wsl-dev-item-name">中暑</span></button>
            <button class="wsl-dev-item" data-sick="cure"><span class="wsl-dev-item-name">痊愈</span></button>
            <button class="wsl-dev-item" data-sick="aging"><span class="wsl-dev-item-name">老化+10岁</span></button>
        </div>
        <div class="wsl-dev-sub">▸ 定位（主控移动）</div>
        <div class="wsl-dev-quick">
            <button data-q="randrespawn">随机重生</button>
            <button data-q="tpdeath" title="传送到上次死亡位置（有死亡记录即可用，不依赖指引）">传送死亡点</button>
            <button data-q="tp" class="wsl-dev-mp">传送队友(TP)</button>
            <button data-q="look">外观定制(捏脸)</button>
        </div>
        <div class="wsl-dev-sub">▸ 物资（掉入主控背包）</div>`;
    for (const cat of CATEGORIES) {
        if (cat.name.startsWith('僵尸')) continue;   // 僵尸刷出归全局区「实体刷出」
        localHtml += `<div class="wsl-dev-cat">
            <div class="wsl-dev-cat-name" style="color:${cat.color}">▸ ${cat.name}</div>
            <div class="wsl-dev-items">`;
        for (const it of cat.items) {
            localHtml += `<button class="wsl-dev-item" data-id="${it.id}" data-n="${it.n}" title="掉落 ${it.name}×${it.n}">
                <span class="wsl-dev-char" style="color:${cat.color}">${it.char}</span>
                <span class="wsl-dev-item-name">${it.name}</span>
            </button>`;
        }
        localHtml += `</div></div>`;
    }
    localHtml += `<div class="wsl-dev-quick">
            <button data-q="allitems">全部物资×1</button>
            <button data-q="clearbag">清空背包</button>
            <button data-sick="coins" title="给主控加 50 金币">金币×50</button>
        </div>`;

    // ============ 全局 / 世界面板 ============
    let globalHtml = `
        <div class="wsl-dev-sub">▸ 时间（世界时间轴）</div>
        <div class="wsl-dev-quick">
            <button data-q="day">跳一天</button>
            <button data-q="spd10" id="wdev-spd10">时间×10</button>
            <button data-q="spd60" id="wdev-spd60">时间×60</button>
            <button data-q="t1h">快进1小时</button>
            <button data-q="tnight">到夜晚20点</button>
            <button data-q="tday">到白天6点</button>
        </div>
        <div class="wsl-dev-dmg">
            <span class="wsl-dev-dmg-label">画质（纯本地显示，不参与联机同步）</span>
            <div class="wsl-dev-dmg-presets" id="wdev-gfx">
                <button data-gfx="2">高</button>
                <button data-gfx="1">中</button>
                <button data-gfx="0">低</button>
            </div>
        </div>
        <div class="wsl-dev-quick">
            <select id="wdev-wx-sel" class="wsl-dev-select" title="天气与强度（含雷阵雨闪电）"></select>
            <button data-q="wxset" id="wdev-wxset">设置天气</button>
        </div>
        <div class="wsl-dev-quick">
            <select id="wdev-wind-sel" class="wsl-dev-select" title="风向（仅视觉：雨/雪倾斜角、沙尘方向；auto=按当天种子确定性）"></select>
            <button data-q="windset" id="wdev-windset">设置风向</button>
        </div>
        <div class="wsl-dev-sub">▸ 地图（世界探索）</div>
        <div class="wsl-dev-quick">
            <button data-q="map">开地图</button>
            <button data-q="reveal">揭示全图</button>
        </div>
        <div class="wsl-dev-sub">▸ 实体刷出（影响世界）</div>
        <div class="wsl-dev-quick">
            <button data-q="spawn">刷僵尸</button>
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#ccc;">
                数量 <input data-q="zn" type="range" min="1" max="30" value="6" style="width:70px;vertical-align:middle;">
                <span data-q="znv">6</span>
            </label>
            <button data-q="horde">立即尸潮</button>
            <button data-q="killall">清屏僵尸</button>
        </div>`;
    const zCat = CATEGORIES.find(c => c.name.startsWith('僵尸'));
    if (zCat) {
        globalHtml += `<div class="wsl-dev-cat">
            <div class="wsl-dev-cat-name" style="color:${zCat.color}">▸ ${zCat.name}</div>
            <div class="wsl-dev-items">`;
        for (const it of zCat.items) {
            globalHtml += `<button class="wsl-dev-item" data-id="${it.id}" data-n="${it.n}" title="附近刷出 ${it.name}">
                <span class="wsl-dev-char" style="color:${zCat.color}">${it.char}</span>
                <span class="wsl-dev-item-name">${it.name}</span>
            </button>`;
        }
        globalHtml += `</div></div>`;
    }
    globalHtml += `
        <div class="wsl-dev-sub">▸ 搜索测试（附近刷出容器，可 F 搜索）</div>
        <div class="wsl-dev-boxes">
            ${DEV_BOXES.map(b => `<button class="wsl-dev-item" data-c="${b.t}"><span class="wsl-dev-item-name">${b.name}</span></button>`).join('')}
        </div>
        <div class="wsl-dev-sub">▸ 载具测试（附近刷出汽车：完好可直接开 / 可修 / 报废可拆解）</div>
        <div class="wsl-dev-boxes">
            <button class="wsl-dev-item" data-v="intact"><span class="wsl-dev-item-name">完好车</span></button>
            <button class="wsl-dev-item" data-v="repairable"><span class="wsl-dev-item-name">可修车</span></button>
            <button class="wsl-dev-item" data-v="wreck"><span class="wsl-dev-item-name">报废车</span></button>
        </div>
        <div class="wsl-dev-sub">▸ NPC 测试（附近刷出：友善可交易入队 / 中立 / 恶意主动攻击）</div>
        <div class="wsl-dev-boxes">
            <button class="wsl-dev-item" data-n="friendly"><span class="wsl-dev-item-name">友善NPC</span></button>
            <button class="wsl-dev-item" data-n="neutral"><span class="wsl-dev-item-name">中立NPC</span></button>
            <button class="wsl-dev-item" data-n="hostile"><span class="wsl-dev-item-name">恶意NPC</span></button>
            <button class="wsl-dev-item" data-n="clear"><span class="wsl-dev-item-name">清除NPC</span></button>
        </div>
        <div class="wsl-dev-sub">▸ 队伍与营地</div>
        <div class="wsl-dev-quick">
            <button data-q="summonmate" title="召唤 NPC 队友瞬移到身边（调试用）">召唤队友</button>
            <button data-sick="setcamp" title="营地设为当前位置（命令队员返回营地测试）">设营地(脚下)</button>
        </div>
        <div class="wsl-dev-sub">▸ 危险操作</div>
        <div class="wsl-dev-quick">
            <button data-q="wipe" class="wsl-dev-danger">清空存档</button>
        </div>`;

    return `
        <div class="wsl-dev-head">
            <span class="wsl-dev-title">◈ 荒原调试台</span>
            <span class="wsl-dev-tag">DEV</span>
            <button class="wsl-dev-close" id="wdev-close">✕</button>
        </div>
        <div class="wsl-dev-tabs">
            <button class="wsl-dev-tab on" data-tab="local">◉ 主控角色</button>
            <button class="wsl-dev-tab" data-tab="global">◉ 全局 / 世界</button>
        </div>
        <div class="wsl-dev-body">
            <div class="wsl-dev-pane" data-pane="local">${localHtml}</div>
            <div class="wsl-dev-pane hidden" data-pane="global">${globalHtml}</div>
        </div>
        <div class="wsl-dev-foot">F9 开关 · 主控区只作用于当前控制角色 · 全局区影响整个世界</div>`;
}

// 时间快进后的跨天滚转（与 survival.update 规则一致：整天数进位，重置尸潮标记）
function rollDay(sv) {
    while (sv.t >= sv.dayLen) {
        sv.t -= sv.dayLen;
        sv.day++;
        sv._hordeDayStarted = false;
    }
}
function hourText(sv) {
    const dayT = (sv.t / sv.dayLen) * 24;
    return `${String(Math.floor(dayT)).padStart(2, '0')}:${String(Math.floor((dayT % 1) * 60)).padStart(2, '0')}`;
}

function syncState() {
    const sv = curSv;
    if (!sv || !devEl) return;
    devEl.querySelector('#wdev-god').classList.toggle('on', !!sv._devGod);
    devEl.querySelector('#wdev-stamina').classList.toggle('on', !!sv._devInfStamina);
    devEl.querySelector('#wdev-inf').classList.toggle('on', sv._devInf !== false);
    devEl.querySelector('#wdev-ammo').classList.toggle('on', !!sv._devInfAmmo);
    devEl.querySelector('#wdev-dura').classList.toggle('on', !!sv._devInfDura);
    devEl.querySelector('#wdev-oneshot').classList.toggle('on', !!sv._devOneShot);
    devEl.querySelector('#wdev-bag').classList.toggle('on', !!sv._devInfBag);
    devEl.querySelector('#wdev-hud').classList.toggle('on', !!sv._devHud);
    devEl.querySelector('#wdev-spd10').classList.toggle('on', sv._devTimeScale === 10);
    devEl.querySelector('#wdev-spd60').classList.toggle('on', sv._devTimeScale === 60);
    devEl.querySelectorAll('.wsl-dev-dmg-presets [data-mul]').forEach(b => {
        b.classList.toggle('on', Number(b.dataset.mul) === (sv._devDmgMul || 1));
    });
    devEl.querySelectorAll('#wdev-gfx button').forEach(b => {
        b.classList.toggle('on', Number(b.dataset.gfx) === (sv._devGfx == null ? 2 : sv._devGfx));
    });
}

function persistDev() {
    const sv = curSv;
    if (!sv) return;
    // 开发者标记写入 profile（角色+世界组合档）；旧 SAVE_KEY 兜底兼容
    const p = getStorage(PROFILE_KEY, {});
    p._devGod = !!sv._devGod;
    p._devInfStamina = !!sv._devInfStamina;
    p._devInf = sv._devInf !== false;
    p._devInfAmmo = !!sv._devInfAmmo;
    p._devInfDura = !!sv._devInfDura;
    p._devOneShot = !!sv._devOneShot;
    p._devInfBag = !!sv._devInfBag;
    p._devDmgMul = sv._devDmgMul || 1;
    p._devTimeScale = sv._devTimeScale || 1;
    p._devHud = !!sv._devHud;
    p._devGfx = sv._devGfx == null ? 2 : sv._devGfx;
    p._devWind = sv._devWind != null ? sv._devWind : null;
    p.characterName = sv.characterName || p.characterName || '幸存者';
    p.worldSeed = sv.world ? sv.world.seed : (p.worldSeed != null ? p.worldSeed : null);
    if (p.worldSeed != null) setStorage(PROFILE_KEY, p);
}

function spawnAt(sv, id, n) {
    const info = Panel.getItemInfo(id);
    const left = Panel.addItem(sv, id, n);
    if (left > 0) MSG.pushMsg(sv, `[DEV] 背包已满，${info.name} 有 ${left} 个未放入`, '#FF8866');
    else MSG.pushMsg(sv, `[DEV] 已获得 ${info.name} ×${n}`, '#7DFF7D');
    AudioSystem.playCollect();
}

// 战利品袋入包（loot:/looted: 走独立入袋路径，保持可开袋）
function spawnLootAt(sv, id, n) {
    const info = Panel.getItemInfo(id);
    let ok = true;
    for (let i = 0; i < n; i++) {
        if (!Panel.addItemLoot(sv, { id, n: 1, contents: [], searched: false })) { ok = false; break; }
    }
    MSG.pushMsg(sv, ok ? `[DEV] 已获得 ${info.name} ×${n}（打开使用/开袋）` : `[DEV] 背包已满，${info.name} 放不下了`, ok ? '#7DFF7D' : '#FF8866');
    AudioSystem.playCollect();
}

function spawnZombieNear(sv, type) {
    for (let tries = 0; tries < 12; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (3 + Math.random() * 2) * TS;
        const x = sv.px + Math.cos(ang) * d, y = sv.py + Math.sin(ang) * d;
        const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
        if (isWalk(getTile(sv, gx, gy))) {
            spawnZombie(sv, type, x, y);
            MSG.pushMsg(sv, `[DEV] 已在附近刷出 ${B.Z_CHAR[type] || type} 僵尸`, '#FFCC66');
            return;
        }
    }
    MSG.pushMsg(sv, '[DEV] 附近没有可刷新空地', '#FF8866');
}

// 附近刷出容器：选非路/非人行道/非建筑的可行走格（避开城市规划保护层），
// 并清掉旧搜索状态确保可重新搜刮
function spawnContainerNear(sv, t) {
    for (let tries = 0; tries < 20; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (2 + Math.random() * 3) * TS;
        const gx = Math.floor((sv.px + Math.cos(ang) * d) / TS);
        const gy = Math.floor((sv.py + Math.sin(ang) * d) / TS);
        const cur = getTile(sv, gx, gy);
        if (!isWalk(cur)) continue;
        if (cur === T.ROAD || cur === T.SIDEWALK) continue;
        if (cur === T.WALL || cur === T.DOOR) continue;
        setTile(sv, gx, gy, t);
        const key = gx + ',' + gy;
        if (sv.mods.boxLoot) delete sv.mods.boxLoot[key];
        if (sv.mods.boxSearched) delete sv.mods.boxSearched[key];
        MSG.pushMsg(sv, `[DEV] 已在附近放置容器（${gx},${gy}）`, '#FFCC66');
        return;
    }
    MSG.pushMsg(sv, '[DEV] 附近没有可放置空地', '#FF8866');
}

// 附近刷出测试汽车：强制品相（完好可直接开 / 可修 / 报废可拆解），落任意可行走空地
function spawnCarNear(sv, cond) {
    for (let tries = 0; tries < 20; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (2 + Math.random() * 3) * TS;
        const gx = Math.floor((sv.px + Math.cos(ang) * d) / TS);
        const gy = Math.floor((sv.py + Math.sin(ang) * d) / TS);
        const cur = getTile(sv, gx, gy);
        if (!isWalk(cur)) continue;
        if (cur === T.WALL || cur === T.DOOR) continue;
        const key = gx + ',' + gy;
        if (cond === 'wreck') {
            setTile(sv, gx, gy, T.CARWRECK);
        } else {
            setTile(sv, gx, gy, T.CAR);
            // 与野外自然车一致：随机任意朝向（车可自由摆放、车头任意角度）
            sv.mods.tiles[key] = { t: T.CAR, cond, dir: Math.random() * Math.PI * 2 };
            if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'diff', key, tile: sv.mods.tiles[key] });
        }
        MSG.pushMsg(sv, `[DEV] 已在附近放置${cond === 'intact' ? '完好' : cond === 'repairable' ? '可修理' : '报废'}车（${gx},${gy}）`, '#FFCC66');
        return;
    }
    MSG.pushMsg(sv, '[DEV] 附近没有可放置空地', '#FF8866');
}

// 附近刷出 NPC：友善/中立/恶意（clear=清空全部 NPC）
function spawnNpcNear(sv, kind) {
    if (kind === 'clear') {
        sv.npcs = (sv.npcs || []).filter(n => n.isPlayer || n.id === sv.controllerId);   // 保留原主角与主控角色
        MSG.pushMsg(sv, '[DEV] 已清除全部非主控 NPC', '#FFB347');
        return;
    }
    if (!sv.npcs) sv.npcs = [];
    // 2026-08-09 防止"生成后被物体/容器卡住"：不仅要本格可走，还要 4 邻域至少有一个可走格
    // （否则 NPC 落在角落/被碰撞体包围处，寻路拉不动）
    const walk4 = (gx, gy) => isWalk(getTile(sv, gx, gy));
    for (let tries = 0; tries < 30; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (2 + Math.random() * 3) * TS;
        const x = sv.px + Math.cos(ang) * d, y = sv.py + Math.sin(ang) * d;
        const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
        if (!walk4(gx, gy)) continue;
        const hasOpen = walk4(gx - 1, gy) || walk4(gx + 1, gy) || walk4(gx, gy - 1) || walk4(gx, gy + 1);
        if (!hasOpen) continue;
        const n = WNPC.makeNpc(sv, x, y, kind);
        sv.npcs.push(n);
        const label = kind === 'friendly' ? '友善' : kind === 'neutral' ? '中立' : '恶意';
        MSG.pushMsg(sv, `[DEV] 已在附近放置${label} NPC：${n.name}`, '#FFCC66');
        return;
    }
    MSG.pushMsg(sv, '[DEV] 附近没有可放置空地', '#FF8866');
}

function bindEvents() {
    devEl.querySelector('#wdev-close').addEventListener('click', () => {
        devOpen = false;
        devEl.classList.add('hidden');
    });

    // 2026-08-11 v2.99 分区 Tab 切换：主控角色 / 全局世界
    devEl.querySelectorAll('.wsl-dev-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            devEl.querySelectorAll('.wsl-dev-tab').forEach(t => t.classList.toggle('on', t === tab));
            devEl.querySelectorAll('.wsl-dev-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== target));
            AudioSystem.playClick();
        });
    });

    // 开关：无敌 / 资源无限 / 无限弹药 / 一击必杀
    devEl.querySelectorAll('.wsl-dev-toggles button').forEach(btn => {
        btn.addEventListener('click', () => {
            const sv = curSv;
            if (!sv || !sv.active) return;
            const t = btn.dataset.t;
            if (t === 'god') {
                // 2026-08-09 用户要求：无敌 = 所有属性全满（生命/体力/饱食/水分无限，不受伤）
                // 开启时联动无限体力（一个键全满）；关闭时保留独立"无限体力"开关状态
                sv._devGod = !sv._devGod;
                if (sv._devGod) {
                    sv._devInfStamina = true;
                    setAllStatsFull(sv);
                }
                MSG.pushMsg(sv, sv._devGod ? '[DEV] 属性全满开启（生命/体力/饱食/水分无限 + 不受伤）' : '[DEV] 属性全满关闭', '#FFB347');
            } else if (t === 'stamina') {
                sv._devInfStamina = !sv._devInfStamina;
                if (sv._devInfStamina) { sv.stamina = sv.maxStamina; sv.exhausted = false; }
                MSG.pushMsg(sv, sv._devInfStamina ? '[DEV] 无限体力开启' : '[DEV] 无限体力关闭', '#FFB347');
            } else if (t === 'inf') {
                // 2026-08-11 v2.98 测试玩家核对：`_devInf` 在 dev 模式下 init() 默认 true（169行），
                // 原 `!(sv._devInf !== false)` = !(true) = false —— 第一次点击即正确"关闭"（无 bug）。
                // 保留原语义（默认开，点一下关），避免行为变化。
                sv._devInf = !(sv._devInf !== false);
                MSG.pushMsg(sv, sv._devInf ? '[DEV] 资源无限开启' : '[DEV] 资源无限关闭', '#FFB347');
            } else if (t === 'ammo') {
                sv._devInfAmmo = !sv._devInfAmmo;
                MSG.pushMsg(sv, sv._devInfAmmo ? '[DEV] 无限弹药开启（弹匣不消耗 + 无需换弹）' : '[DEV] 无限弹药关闭', '#FFB347');
            } else if (t === 'dura') {
                // 2026-08-09 用户要求：无限弹药里加"耐久无限"——武器/工具耐久不消耗
                sv._devInfDura = !sv._devInfDura;
                MSG.pushMsg(sv, sv._devInfDura ? '[DEV] 无限耐久开启（武器/工具永不损坏）' : '[DEV] 无限耐久关闭', '#FFB347');
            } else if (t === 'oneshot') {
                sv._devOneShot = !sv._devOneShot;
                MSG.pushMsg(sv, sv._devOneShot ? '[DEV] 一击必杀开启' : '[DEV] 一击必杀关闭', '#FFB347');
            } else if (t === 'bag') {
                sv._devInfBag = !sv._devInfBag;
                MSG.pushMsg(sv, sv._devInfBag ? '[DEV] 无限背包开启：同类无限堆叠，格位自动扩容' : '[DEV] 无限背包关闭', '#FFB347');
            } else if (t === 'hud') {
                // 调试 HUD：纯本地诊断覆盖层，不进联机同步（各端独立）
                sv._devHud = !sv._devHud;
                if (sv._devHud) HUD.update(sv, performance.now());
                else HUD.destroy();
                MSG.pushMsg(sv, sv._devHud ? '[DEV] 调试HUD开启（右上角 FPS/实体数/状态）' : '[DEV] 调试HUD关闭', '#FFB347');
            }
            syncState();
            persistDev();
            reportDevFlags(sv);   // 联机 guest：dev 标志共用上报（host 权威应用 + wsync 回传）
            AudioSystem.playClick();
        });
    });

    // 伤害倍率（用 [data-mul] 限定，避免误绑画质按钮——两者现在共用 .wsl-dev-dmg-presets 样式）
    devEl.querySelectorAll('.wsl-dev-dmg-presets [data-mul]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sv = curSv;
            if (!sv) return;
            sv._devDmgMul = Number(btn.dataset.mul);
            MSG.pushMsg(sv, `[DEV] 武器伤害倍率 ×${sv._devDmgMul}`, '#FFB347');
            syncState();
            persistDev();
            reportDevFlags(sv);
            AudioSystem.playClick();
        });
    });

    // 画质档（B：低/中/高；纯本地显示降级——渲染分辨率/昼夜氛围/特效上限，
    // 不参与联机同步、不影响任何玩法数值）
    devEl.querySelectorAll('#wdev-gfx button').forEach(btn => {
        btn.addEventListener('click', () => {
            const sv = curSv;
            if (!sv) return;
            sv._devGfx = Number(btn.dataset.gfx);
            const label = sv._devGfx === 0 ? '低（内部分辨率0.75x·关昼夜暗色·特效上限20）'
                : sv._devGfx === 1 ? '中（特效上限35）' : '高（完整效果）';
            MSG.pushMsg(sv, `[DEV] 画质已切换：${label}`, '#FFB347');
            syncState();
            persistDev();
            AudioSystem.playClick();
        });
    });

    // 刷物品
    devEl.querySelectorAll('.wsl-dev-item').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!curSv || !curSv.active) return;
            const id = btn.dataset.id;
            if (!id) return;   // 容器/载具/NPC/疾病按钮不带 data-id，各自有专用处理器
            if (id.startsWith('zombie:')) spawnZombieNear(curSv, id.slice(7));
            else if (id.startsWith('loot')) spawnLootAt(curSv, id, parseInt(btn.dataset.n) || 1);
            else spawnAt(curSv, id, parseInt(btn.dataset.n) || 1);
            btn.classList.add('flash');
            setTimeout(() => btn.classList.remove('flash'), 180);
        });
    });

    // 天气与强度下拉（每种天气×每个强度可分别查看，含雷阵雨闪电）
    const wxSel = devEl.querySelector('#wdev-wx-sel');
    if (wxSel) {
        const opts = [['auto', '自动（当前种子当天）'], ['clear', '晴朗']];
        for (const t of ['rain', 'snow', 'fog', 'sandstorm']) {
            const arr = B.WX_INTENSITY[t];
            for (let lv = 0; lv < arr.length; lv++) opts.push([`${t}:${lv}`, arr[lv].name + (arr[lv].flash ? ' ⚡' : '')]);
        }
        wxSel.innerHTML = opts.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
    }

    // 2026-08-09 风向下拉（开发者测试风向：只影响粒子视觉倾斜角/沙尘方向，不影响逻辑）
    // auto = 按当天种子确定性风向（windDirAt）；其余 8 方向按角度
    const windSel = devEl.querySelector('#wdev-wind-sel');
    if (windSel) {
        const windOpts = [
            ['auto', '自动（当天种子）'],
            ['0', '东风 →（右倾）'],
            ['pi', '西风 ←（左倾）'],
            ['half', '南风 ↓（无水平偏移）'],
            ['nhalf', '北风 ↑（无水平偏移）'],
            ['e45', '东北 ↘'],
            ['e135', '东南 ↙'],
            ['w45', '西北 ↗'],
            ['w135', '西南 ↖'],
        ];
        windSel.innerHTML = windOpts.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
        // 同步当前 dev 覆盖值（若有）
        if (curSv && curSv._devWind != null) {
            const cur = curSv._devWind;
            const deg = Math.round(cur * 180 / Math.PI) % 360;
            const norm = ((deg % 360) + 360) % 360;
            const near = (v) => Math.abs(Math.round(v) - norm) < 5;
            const pick = near(0) ? '0' : near(180) ? 'pi' : near(90) ? 'half' : near(270) ? 'nhalf'
                : near(45) ? 'e45' : near(135) ? 'e135' : near(315) ? 'w45' : near(225) ? 'w135' : 'auto';
            windSel.value = pick;
        }
    }

    // 状态测试：饥饿 / 饱食 / 血量 / 感染
    devEl.querySelectorAll('.wsl-dev-quick [data-s]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sv = curSv;
            if (!sv || !sv.active) return;
            const s = btn.dataset.s;
            if (s === 'starve') { sv.food = 0; MSG.pushMsg(sv, '[DEV] 饥饿状态：晕眩光晕 + 掉血（最低 1 血不死亡、不打断搜索）', '#FFB347'); }
            else if (s === 'lowfood') { sv.food = 30; MSG.pushMsg(sv, '[DEV] 低饱食（30）：移动变慢', '#FFB347'); }
            else if (s === 'fullfood') { sv.food = 100; MSG.pushMsg(sv, '[DEV] 饱食度回满', '#7DFF7D'); }
            else if (s === 'thirst') { sv.water = 0; MSG.pushMsg(sv, '[DEV] 缺水状态：晕眩光晕 + 掉血', '#66CCFF'); }
            else if (s === 'fullwater') { sv.water = 100; MSG.pushMsg(sv, '[DEV] 水分回满', '#7DFF7D'); }
            else if (s === 'hp1') { sv.hp = 1; MSG.pushMsg(sv, '[DEV] 血量设为 1（低血晕眩光晕 + 饿不死）', '#FFB347'); }
            else if (s === 'hpfull') { sv.hp = sv.maxHp || B.MAX_HP; sv.food = 100; MSG.pushMsg(sv, '[DEV] 血量和饱食度回满', '#7DFF7D'); }
            else if (s === 'inf50') { sv.infection = 50; MSG.pushMsg(sv, '[DEV] 感染值设为 50', '#FFB347'); }
            else if (s === 'inf0') { sv.infection = 0; MSG.pushMsg(sv, '[DEV] 感染已清除', '#7DFF7D'); }
            else if (s === 'full') {
                // 2026-08-09 用户要求：一键状态回满——血量/饱食/水分/体力全满 + 清除全部负面状态
                setAllStatsFull(sv);
                MSG.pushMsg(sv, '[DEV] 状态已一键回满：生命/饱食/水分/体力全满，感染与疾病已清除', '#7DFF7D');
            }
            else if (s === 'grade') {
                // 2026-08-11 v2.98 品级系统测试：给当前装备武器随机赋品级（A 极稀有 → Z 最常见）
                const g = WGRADE.randomGrade();
                let applied = false;
                for (const it of sv.inv || []) {
                    if (it && it.eq && String(it.id).startsWith('wpn:')) { it.grade = g; applied = true; }
                }
                MSG.pushMsg(sv, applied
                    ? `[DEV] 装备武器已随机赋品级：${g}（伤害×${WGRADE.gradeMul(g).damageMul.toFixed(2)}）`
                    : '[DEV] 未找到装备的武器（背包里点武器"装"后再试）', applied ? '#7DFF7D' : '#FFB347');
            }
            else if (s === 'ling') {
                // 2026-08-11 v2.98 品级系统测试：直接加 20 灵石（强化材料）
                Panel.addItem(sv, WGRADE.LING_STONE_ID, 20);
                MSG.pushMsg(sv, '[DEV] 已添加 灵石 ×20（品级强化材料）', '#7DFF7D');
            }
            // 2026-08-11 v2.98 用户反馈：「濒死倒地」「补刀致死」开发者按钮有 bug，已删除。
            // 局内玩法的倒地/尸体/尸变/搜索/救助等逻辑完整保留（onDeath / updateDowned / deathDropLegacy
            // / updateCorpseRevive / reviveZombieToCorpse / doInteract 等均不动），只移除这两个开发者入口。
            AudioSystem.playClick();
        });
    });

    // 2026-08-09 自定义感染值滑块（拖动即时生效，方便感染阶段开发调试）
    const infRange = devEl.querySelector('#wdev-inf-range');
    const infVal = devEl.querySelector('#wdev-inf-val');
    if (infRange) {
        const setInf = () => {
            const sv = curSv;
            if (!sv || !sv.active) return;
            const v = Number(infRange.value);
            sv.infection = v;
            if (infVal) infVal.textContent = String(Math.round(v));
            // 同步主控角色记录（NPC 列表里的主角），保证 HUD/身体剥落一致
            const pc = (sv.npcs || []).find(n => n.isPlayer || n.id === 'player');
            if (pc) pc.infection = v;
            sv._infLogT = (sv._infLogT || 0) + 1;   // 触发感染提示刷新
        };
        infRange.addEventListener('input', setInf);
        infRange.addEventListener('change', setInf);
        // 面板打开时同步当前感染值
        if (curSv && curSv.infection != null) {
            infRange.value = Math.max(0, Math.min(100, curSv.infection));
            if (infVal) infVal.textContent = String(Math.round(curSv.infection));
        }
    }

    // 搜索测试：附近刷容器
    devEl.querySelectorAll('.wsl-dev-boxes [data-c]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!curSv || !curSv.active) return;
            spawnContainerNear(curSv, T[btn.dataset.c]);
            btn.classList.add('flash');
            setTimeout(() => btn.classList.remove('flash'), 180);
        });
    });

    // 载具测试：附近刷汽车（完好/可修/报废，强制品相）
    devEl.querySelectorAll('.wsl-dev-boxes [data-v]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!curSv || !curSv.active) return;
            spawnCarNear(curSv, btn.dataset.v);
            btn.classList.add('flash');
            setTimeout(() => btn.classList.remove('flash'), 180);
        });
    });

    // NPC 测试：附近刷 NPC（友善/中立/恶意）或清空
    devEl.querySelectorAll('.wsl-dev-boxes [data-n]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!curSv || !curSv.active) return;
            const sv = curSv;
            // 联机 guest：NPC 召唤上报 host 权威执行（双方屏幕都出现，且双方都可互动）
            if (sv.mp && sv.mp.role === 'guest') {
                reportDevCmd(sv, { cmd: 'npc', kind: btn.dataset.n });
                MSG.pushMsg(sv, '[DEV] 已请求放置NPC（同步中）', '#FFCC66');
            } else {
                spawnNpcNear(sv, btn.dataset.n);
            }
            btn.classList.add('flash');
            setTimeout(() => btn.classList.remove('flash'), 180);
        });
    });

    // 疾病测试：染病种 / 痊愈 / 老化（主控区）+ 设营地（全局）/ 刷金币（主控区）
    // 2026-08-11 v2.99 按钮分散在两个 Tab 面板，选择器改为全局 [data-sick]
    devEl.querySelectorAll('[data-sick]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sv = curSv;
            if (!sv || !sv.active) return;
            const kind = btn.dataset.sick;
            const cur = WNPC.controlledNpc(sv);
            if (!cur) { MSG.pushMsg(sv, '[DEV] 未找到主控角色记录', '#FF8866'); return; }
            if (kind === 'cure') {
                cur.sick = null;
                MSG.pushMsg(sv, '[DEV] 主控角色已痊愈', '#7DFF7D');
            } else if (kind === 'aging') {
                cur.bornDay -= 10;
                cur.age = sv.day - cur.bornDay;
                WNPC.applyPersonStats(cur);
                MSG.pushMsg(sv, `[DEV] 主控年龄 +10 → ${cur.age} 天（${B.ageStage(cur.age).name}）`, '#FFB347');
            } else if (kind === 'setcamp') {
                sv.camp = { x: sv.px, y: sv.py, id: 'camp_dev_' + sv.day };
                if (sv.mp) (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'camp', x: sv.px, y: sv.py });
                MSG.pushMsg(sv, '[DEV] 营地已设为当前位置（命令队员返回营地测试）', '#7DFF7D');
            } else if (kind === 'coins') {
                sv.coins = (sv.coins || 0) + 50;
                MSG.pushMsg(sv, '[DEV] 金币 +50', '#7DFF7D');
            } else {
                cur.sick = { type: kind, day: sv.day };
                const s = B.SICKNESS[kind];
                MSG.pushMsg(sv, `[DEV] 主控染上${s ? s.name : kind}（看 HUD/小人特效，用药或草药治疗）`, '#FFB347');
            }
            btn.classList.add('flash');
            setTimeout(() => btn.classList.remove('flash'), 180);
        });
    });

    // 2026-08-10 刷僵尸数量滑块：拖动即时显示数值
    const znEl = devEl.querySelector('[data-q="zn"]');
    const znvEl = devEl.querySelector('[data-q="znv"]');
    if (znEl && znvEl) {
        znEl.addEventListener('input', () => { znvEl.textContent = znEl.value; });
    }

    // 快捷功能
    devEl.querySelectorAll('.wsl-dev-quick button[data-q]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sv = curSv;
            if (!sv || !sv.active) return;
            switch (btn.dataset.q) {
                case 'day': {
                    // 时间操作是 host 权威（t/day 进 wsync）：guest 上报 host 执行，回传同步
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'time', op: 'day' }); break; }
                    sv.day++; sv.t = B.DAY_LEN * 0.35;   // 跳到新一天的清晨（8:24），避免落入深夜
                    MSG.pushMsg(sv, `[DEV] 跳到第 ${sv.day} 天`, '#FFB347');
                    break;
                }
                case 'spd10':
                    sv._devTimeScale = sv._devTimeScale === 10 ? 1 : 10;
                    syncState();
                    reportDevFlags(sv);   // 时间倍率共用
                    MSG.pushMsg(sv, sv._devTimeScale === 10 ? '[DEV] 时间加速 ×10（观察昼夜）' : '[DEV] 时间恢复 ×1', '#FFB347');
                    break;
                case 'spd60':
                    sv._devTimeScale = sv._devTimeScale === 60 ? 1 : 60;
                    syncState();
                    reportDevFlags(sv);
                    MSG.pushMsg(sv, sv._devTimeScale === 60 ? '[DEV] 时间加速 ×60（快速昼夜）' : '[DEV] 时间恢复 ×1', '#FFB347');
                    break;
                case 't1h': {
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'time', op: 't1h' }); break; }
                    sv.t += B.DAY_LEN / 24;
                    rollDay(sv);
                    MSG.pushMsg(sv, `[DEV] 快进 1 小时 → 第 ${sv.day} 天 ${hourText(sv)}`, '#FFB347');
                    break;
                }
                case 'tnight': {
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'time', op: 'tnight' }); break; }
                    sv.t = B.DAY_LEN * 20 / 24;
                    MSG.pushMsg(sv, `[DEV] 跳到夜晚 20:00 → 第 ${sv.day} 天`, '#FFB347');
                    break;
                }
                case 'tday': {
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'time', op: 'tday' }); break; }
                    sv.t = B.DAY_LEN * 6 / 24;
                    MSG.pushMsg(sv, `[DEV] 跳到白天 6:00 → 第 ${sv.day} 天`, '#FFB347');
                    break;
                }
                case 'wxset': {
                    // 天气与强度选择（host 权威，weather/wxLevel 进 wsync 快照回传双端）
                    const sel = document.getElementById('wdev-wx-sel');
                    const val = sel ? sel.value : 'auto';
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'wxset', wx: val }); break; }
                    applyWxSet(sv, val);
                    break;
                }
                case 'windset': {
                    // 2026-08-09 风向选择（开发者测试：仅粒子视觉倾斜，不改逻辑）
                    // host 权威：guest 上报 host 执行，host 的 _devWind 经 devflags 回传双端
                    const sel2 = document.getElementById('wdev-wind-sel');
                    const v = sel2 ? sel2.value : 'auto';
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'windset', wind: v }); break; }
                    applyWindSet(sv, v);
                    break;
                }
                case 'randrespawn': {
                    if (sv.driving) { MSG.pushMsg(sv, '[DEV] 请先下车再随机重生', '#FF8866'); break; }
                    // 2026-08-09 防止传送后卡在碰撞体里（"控制失灵"）：目标格可走 + 4 邻域有可走格
                    const ok = (gx, gy) => isWalk(getTile(sv, gx, gy)) &&
                        (isWalk(getTile(sv, gx - 1, gy)) || isWalk(getTile(sv, gx + 1, gy)) ||
                         isWalk(getTile(sv, gx, gy - 1)) || isWalk(getTile(sv, gx, gy + 1)));
                    for (let tries = 0; tries < 80; tries++) {
                        const ang = Math.random() * Math.PI * 2;
                        const dist = (10 + Math.random() * 6) * CHUNK;
                        const gx = Math.round(Math.cos(ang) * dist), gy = Math.round(Math.sin(ang) * dist);
                        if (!ok(gx, gy)) continue;
                        // 若在室内：随机重生应退出室内回到室外（否则 sv 坐标与室内模式错乱 → 卡死）
                        if (sv.interior) WD.exitInterior(sv, true);
                        sv.px = (gx + 0.5) * TS; sv.py = (gy + 0.5) * TS;
                        sv.faceX = 1; sv.faceY = 0;
                        MSG.pushMsg(sv, `[DEV] 随机重生 → 区块(${Math.floor(gx / CHUNK)},${Math.floor(gy / CHUNK)})`, '#7DFF7D');
                        break;
                    }
                    break;
                }
                case 'map':
                    // 2026-08-10 世界地图：开/关（仅室外；直接调用模块，无需 host 权威——探索记录世界档随存）
                    if (sv.interior) { MSG.pushMsg(sv, '[DEV] 地图仅室外可用', '#FF8866'); break; }
                    WMAP.toggle(sv);
                    break;
                case 'reveal': {
                    // 2026-08-10 世界地图：揭示全图（已探索区块 = 全局；host 权威进世界档）
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'reveal' }); break; }
                    if (!sv.mods.explored) sv.mods.explored = {};
                    const R = 400;   // 以原点为中心 ±400 区块（约 ±64 万格）
                    for (let cx = -R; cx <= R; cx++) for (let cy = -R; cy <= R; cy++)
                        sv.mods.explored[cx + ',' + cy] = 1;
                    MSG.pushMsg(sv, '[DEV] 已揭示全图（±400 区块）', '#7DFF7D');
                    break;
                }
                case 'summonmate': {
                    // 2026-08-11 开发者召唤 NPC 队友瞬移到身边（调试用，不受冷却限制）。
                    // 内联实现避免 wdev↔survival 循环依赖；联机 guest 上报 host 权威执行。
                    if (sv.mp && sv.mp.role === 'guest') { reportDevCmd(sv, { cmd: 'summonmate' }); MSG.pushMsg(sv, '[DEV] 已请求召唤队友（同步中）', '#FFCC66'); break; }
                    const mates = (sv.npcs || []).filter(n => n.alive && n.party && n.id !== sv.controllerId && !n.isPlayer && !n.downed && !n.riding);
                    if (!mates.length) { MSG.pushMsg(sv, '[DEV] 队伍里没有可召唤的 NPC 队员', '#FF8866'); break; }
                    let cnt = 0;
                    for (const m of mates) {
                        // 在玩家周围找可站立落点
                        let spot = null;
                        for (let r = 1; r <= 3 && !spot; r++) {
                            for (let i = 0; i < 8 * r; i++) {
                                const ang = (i / (8 * r)) * Math.PI * 2;
                                const x = sv.px + Math.cos(ang) * r * TS * 0.9;
                                const y = sv.py + Math.sin(ang) * r * TS * 0.9;
                                if (sv.interior) {
                                    const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
                                    const it = sv.interior;
                                    if (it && gx >= 0 && gx < it.w && gy >= 0 && gy < it.h && it.tiles[gy * it.w + gx] !== 1) { spot = { x, y }; break; }
                                } else if (isWalk(getTile(sv, Math.floor(x / TS), Math.floor(y / TS)))) { spot = { x, y }; break; }
                            }
                        }
                        if (!spot) { spot = { x: sv.px, y: sv.py }; }
                        if (sv.interior) {
                            if (!m.inInterior) { m.inInterior = true; m.interiorKey = sv.interior.key || null; m.interiorFloor = sv.interior.floor || 1; }
                        } else if (m.inInterior) { m.inInterior = false; m.interiorKey = null; m.interiorFloor = null; }
                        m.x = spot.x; m.y = spot.y;
                        m.state = 'follow'; m.campTask = null; m._path = null;
                        cnt++;
                    }
                    MSG.pushMsg(sv, `[DEV] 已召唤 ${cnt} 名队友到身边`, '#7DFF7D');
                    break;
                }
                case 'tp': {
                    // 联机：传送到真人队友身旁（sv.p2s 由 wpos 同步维护）
                    // 多队友：弹选择器指定某个玩家（旧版只能随机/唯一队友）
                    const slots = [];
                    if (sv.p2s) {
                        for (const pid in sv.p2s) {
                            const g = sv.p2s[pid];
                            if (g && g.tx != null) slots.push(g);
                        }
                    } else if (sv.p2 && sv.p2.tx != null) {
                        slots.push(sv.p2);
                    }
                    if (!slots.length) {
                        MSG.pushMsg(sv, '[DEV] 队友不在线（需先进入联机游戏）', '#FF8866');
                        break;
                    }
                    if (slots.length === 1) { devTpTo(sv, slots[0]); break; }
                    devTpPicker(sv, slots);   // 多个队友：弹出选择器指定玩家
                    break;
                }
                case 'tpdeath': {
                    // 2026-08-10 传送上次死亡位置：优先用持久记录 sv._lastDeathPos（不随指引消失，
                    // 兜底测试用）；无该记录时回退 sv._legacyDrop（死亡地点指引）。两者都没有才提示。
                    // 2026-08-10 修复：用户反馈"操控 NPC 死亡重生后没有死亡指引，传送死亡点也用不了"——
                    // 指引会因"走到点/尸体搜索完"被清除，传送功能不应依赖指引。
                    if (sv.driving) { MSG.pushMsg(sv, '[DEV] 请先下车再传送', '#FF8866'); break; }
                    const ld = sv._lastDeathPos || sv._legacyDrop;
                    if (!ld || (ld.x == null && ld.px == null)) {
                        MSG.pushMsg(sv, '[DEV] 尚无死亡位置记录（从未死亡）', '#FF8866');
                        break;
                    }
                    const dtx = ld.x, dty = ld.y;
                    // 若在室内：传送需退出室内回到室外（死亡点坐标是世界坐标）
                    if (sv.interior) WD.exitInterior(sv, true);
                    for (let tries = 0; tries < 24; tries++) {
                        const ang = Math.random() * Math.PI * 2;
                        const d = (1 + Math.random()) * TS;
                        const gx = Math.floor((dtx + Math.cos(ang) * d) / TS);
                        const gy = Math.floor((dty + Math.sin(ang) * d) / TS);
                        if (!isWalk(getTile(sv, gx, gy))) continue;
                        sv.px = (gx + 0.5) * TS; sv.py = (gy + 0.5) * TS;
                        sv.faceX = 1; sv.faceY = 0;
                        const dist = Math.round(Math.hypot(sv.px - dtx, sv.py - dty) / TS);
                        MSG.pushMsg(sv, `[DEV] 已传送到上次死亡位置（${dist} 格）`, '#7DFF7D');
                        break;
                    }
                    break;
                }
                case 'horde':
                    // 联机 guest：召唤类上报 host 权威执行（双方屏幕都出现）
                    if (sv.mp && sv.mp.role === 'guest') {
                        reportDevCmd(sv, { cmd: 'horde' });
                        MSG.pushMsg(sv, '[DEV] 已请求触发尸潮（同步中）', '#FF6666');
                        break;
                    }
                    if (!sv.horde) startHordePrep(sv);
                    MSG.pushMsg(sv, '[DEV] 尸潮即将来袭', '#FF6666');
                    break;
                case 'killall':
                    if (sv.mp && sv.mp.role === 'guest') {
                        reportDevCmd(sv, { cmd: 'killall' });
                        MSG.pushMsg(sv, '[DEV] 已请求清屏僵尸（同步中）', '#FFB347');
                        break;
                    }
                    sv.zombies.length = 0;
                    if (sv.interior) sv.interior.zombies.length = 0;
                    MSG.pushMsg(sv, '[DEV] 僵尸已清屏', '#FFB347');
                    break;
                case 'spawn': {
                    // 2026-08-10 数量自定义（进度滚轮）：读滑块值（默认 6，范围 1~30）
                    const znEl = document.querySelector('[data-q="zn"]');
                    const n = znEl ? Math.max(1, Math.min(30, parseInt(znEl.value) || 6)) : 6;
                    if (sv.mp && sv.mp.role === 'guest') {
                        reportDevCmd(sv, { cmd: 'spawn', n });
                        MSG.pushMsg(sv, `[DEV] 已请求召唤僵尸 ×${n}（同步中）`, '#FF8866');
                        break;
                    }
                    devSpawnZombies(sv, n);
                    break;
                }
                case 'allitems': {
                    // 全部物资各 ×1（覆盖武器/弹药/工具/材料/药品/种子/战利品袋）
                    let got = 0, miss = 0;
                    for (const cat of CATEGORIES) {
                        if (cat.name.startsWith('僵尸')) continue;
                        for (const it of cat.items) {
                            const ok = it.id.startsWith('loot')
                                ? Panel.addItemLoot(sv, { id: it.id, n: 1, contents: [], searched: false })
                                : Panel.addItem(sv, it.id, 1) === 0;
                            if (ok) got++; else miss++;
                        }
                    }
                    MSG.pushMsg(sv, `[DEV] 全部物资生成完成（${got} 种，背包满漏掉 ${miss} 种）`, miss ? '#FFB347' : '#7DFF7D');
                    break;
                }
                case 'clearbag':
                    for (let i = 0; i < sv.inv.length; i++) sv.inv[i] = null;
                    if (sv.wpn) sv.wpn.mag = {};
                    MSG.pushMsg(sv, '[DEV] 背包已清空', '#FFB347');
                    break;
                case 'wipe':
                    if (!confirm('确定清空荒原存档？此操作不可撤销！')) return;
                    setStorage(SAVE_KEY, null);
                    MSG.pushMsg(sv, '[DEV] 荒原存档已清空', '#FF6666');
                    break;
                case 'look':
                    // 局内重新捏脸：以当前外观为初始，确认后写回角色并落存档
                    showLookCreator((newLook) => {
                        sv.character = newLook;
                        const s = getStorage(SAVE_KEY, null);
                        if (s) { s.character = newLook; setStorage(SAVE_KEY, s); }
                        MSG.pushMsg(sv, '[DEV] 外观已更新并保存', '#7DFF7D');
                    }, normalizeLook(sv.character) || undefined);
                    break;
            }
            AudioSystem.playClick();
        });
    });
}

// ================= 联机开发者同步 =================
// 召唤类（僵尸/尸潮/清屏/NPC）：guest 端上报 devcmd → host 权威执行 → wsync 回传（双方屏幕都出现）
// 属性类（无敌/无限弹药/伤害倍率等）：双方共用（guest 上报 devflags → host 权威 → wsync 回传；host 直接改，wsync 自动带）

export function devFlagsOf(sv) {
    return {
        god: !!sv._devGod, stamina: !!sv._devInfStamina, inf: sv._devInf !== false,
        ammo: !!sv._devInfAmmo, oneshot: !!sv._devOneShot, bag: !!sv._devInfBag,
        dmgMul: sv._devDmgMul || 1, timeScale: sv._devTimeScale || 1,
        dura: !!sv._devInfDura,   // 2026-08-09 无限耐久（联机同步）
        wind: sv._devWind != null ? sv._devWind : null,   // 2026-08-09 风向覆盖（联机同步）
    };
}

export function reportDevFlags(sv) {
    if (!sv || !sv.mp || sv.mp.role !== 'guest') return;
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'devflags', flags: devFlagsOf(sv) });
}

export function reportDevCmd(sv, payload) {
    if (!sv || !sv.mp || sv.mp.role !== 'guest') return;
    (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'devcmd', ...payload });
}

// 外部应用 dev 标志后刷新面板按钮（wsync 应用 / host 应用 guest 上报时调用）
export function applyDevSync() {
    syncState();
}

// host 权威执行对方上报的召唤命令（guest 本地不执行，等 wsync 回传；host 执行后自然下发）
export function applyDevCmd(p) {
    const sv = curSv;
    if (!sv || !sv.active || !p) return;
    switch (p.cmd) {
        case 'spawn': {
            devSpawnZombies(sv, p.n || 6);
            MSG.pushMsg(sv, '[DEV] 对方召唤了僵尸', '#FF8866');
            break;
        }
        case 'horde':
            if (!sv.horde) startHordePrep(sv);
            MSG.pushMsg(sv, '[DEV] 对方触发了尸潮', '#FF6666');
            break;
        case 'killall':
            sv.zombies.length = 0;
            if (sv.interior) sv.interior.zombies.length = 0;
            MSG.pushMsg(sv, '[DEV] 对方清屏了僵尸', '#FFB347');
            break;
        case 'npc':
            spawnNpcNear(sv, p.kind);
            break;
        case 'summonmate': {
            // 2026-08-11 host 权威执行 guest 的"召唤队友"请求（与本地 dev 按钮同逻辑）
            const mates = (sv.npcs || []).filter(n => n.alive && n.party && n.id !== sv.controllerId && !n.isPlayer && !n.downed && !n.riding);
            let cnt = 0;
            for (const m of mates) {
                let spot = null;
                for (let r = 1; r <= 3 && !spot; r++) {
                    for (let i = 0; i < 8 * r; i++) {
                        const ang = (i / (8 * r)) * Math.PI * 2;
                        const x = sv.px + Math.cos(ang) * r * TS * 0.9;
                        const y = sv.py + Math.sin(ang) * r * TS * 0.9;
                        if (sv.interior) {
                            const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
                            const it = sv.interior;
                            if (it && gx >= 0 && gx < it.w && gy >= 0 && gy < it.h && it.tiles[gy * it.w + gx] !== 1) { spot = { x, y }; break; }
                        } else if (isWalk(getTile(sv, Math.floor(x / TS), Math.floor(y / TS)))) { spot = { x, y }; break; }
                    }
                }
                if (!spot) { spot = { x: sv.px, y: sv.py }; }
                if (sv.interior) {
                    if (!m.inInterior) { m.inInterior = true; m.interiorKey = sv.interior.key || null; m.interiorFloor = sv.interior.floor || 1; }
                } else if (m.inInterior) { m.inInterior = false; m.interiorKey = null; m.interiorFloor = null; }
                m.x = spot.x; m.y = spot.y;
                m.state = 'follow'; m.campTask = null; m._path = null;
                cnt++;
            }
            MSG.pushMsg(sv, `[DEV] 对方召唤了 ${cnt} 名队友到身边`, '#FFB347');
            break;
        }
        case 'time':
            // 时间操作（host 权威，t/day 进 wsync 回传双端）
            if (p.op === 'day') { sv.day++; sv.t = B.DAY_LEN * 0.35; MSG.pushMsg(sv, `[DEV] 对方跳到第 ${sv.day} 天`, '#FFB347'); }
            else if (p.op === 't1h') { sv.t += B.DAY_LEN / 24; rollDay(sv); MSG.pushMsg(sv, `[DEV] 对方快进 1 小时 → 第 ${sv.day} 天 ${hourText(sv)}`, '#FFB347'); }
            else if (p.op === 'tnight') { sv.t = B.DAY_LEN * 20 / 24; MSG.pushMsg(sv, '[DEV] 对方跳到夜晚 20:00', '#FFB347'); }
            else if (p.op === 'tday') { sv.t = B.DAY_LEN * 6 / 24; MSG.pushMsg(sv, '[DEV] 对方跳到白天 6:00', '#FFB347'); }
            break;
        case 'wxset': {
            // 天气与强度（host 权威，weather/wxLevel 进 wsync 快照回传双端）
            applyWxSet(sv, p.wx || 'auto');
            MSG.pushMsg(sv, '[DEV] 对方设置了天气', '#FFB347');
            break;
        }
        case 'windset': {
            // 2026-08-09 风向（host 权威；_devWind 经 devflags 回传双端）
            applyWindSet(sv, p.wind || 'auto');
            MSG.pushMsg(sv, '[DEV] 对方设置了风向', '#FFB347');
            break;
        }
        case 'reveal': {
            // 2026-08-10 世界地图：guest 请求揭示全图 → host 权威执行（探索记录世界档随存）
            if (!sv.mods.explored) sv.mods.explored = {};
            const R = 400;
            for (let cx = -R; cx <= R; cx++) for (let cy = -R; cy <= R; cy++)
                sv.mods.explored[cx + ',' + cy] = 1;
            MSG.pushMsg(sv, '[DEV] 对方揭示了全图（±400 区块）', '#FFB347');
            break;
        }
    }
}

// 天气与强度设置（auto=恢复当天确定性派生；clear=晴；rain:2=大雨 等）
// sv._wxLevel 为非 null 时渲染用它（dev 覆盖），null 用 wxLevelAt(seed,day) 确定性派生
// 非 auto 时设 _devWxLock=true → updateWeather 跳过自动覆盖（dev 锁定直到选自动）
function applyWxSet(sv, val) {
    if (val === 'auto') {
        const wx = B.weatherAt(sv.world.seed, sv.day);
        sv._weather = wx;
        sv._wxLevel = null;
        sv._devWxLock = false;
        MSG.pushMsg(sv, `[DEV] 天气恢复自动：${B.wxIntensity(wx, B.wxLevelAt(sv.world.seed, sv.day)).name}`, '#FFB347');
    } else if (val === 'clear') {
        sv._weather = 'clear';
        sv._wxLevel = null;
        sv._devWxLock = true;
        MSG.pushMsg(sv, '[DEV] 天气：晴朗（锁定，8:00 不自动切换）', '#FFB347');
    } else {
        const [type, lvS] = val.split(':');
        const lv = parseInt(lvS, 10);
        sv._weather = type;
        sv._wxLevel = lv;
        sv._devWxLock = true;
        MSG.pushMsg(sv, `[DEV] 天气：${B.wxIntensity(type, lv).name}（${B.wxInfo(type).desc}）${B.wxIntensity(type, lv).flash ? ' ⚡' : ''}（锁定）`, '#FFB347');
    }
}

// 2026-08-09 风向设置（开发者测试）：sv._devWind（弧度）覆盖确定性 windDirAt。
// 只影响粒子视觉（雨/雪倾斜角、沙尘方向），不影响玩法逻辑/存档/结算。
// auto=null → 恢复按当天种子确定性风向。
const WIND_MAP = {
    '0': 0,                 // 东风 → cos=1 右倾
    'pi': Math.PI,          // 西风 ← cos=-1 左倾
    'half': Math.PI / 2,    // 南风 ↓ cos≈0 无水平偏移
    'nhalf': -Math.PI / 2,  // 北风 ↑ cos≈0 无水平偏移
    'e45': Math.PI / 4,        // 东北 ↘
    'e135': Math.PI * 3 / 4,   // 东南 ↙
    'w45': -Math.PI / 4,       // 西北 ↗
    'w135': -Math.PI * 3 / 4,  // 西南 ↖
};
function applyWindSet(sv, val) {
    const rad = WIND_MAP[val];
    if (val === 'auto' || rad == null) {
        sv._devWind = null;
        const auto = B.windDirAt(sv.world.seed, sv.day);
        const deg = Math.round(auto * 180 / Math.PI) % 360;
        MSG.pushMsg(sv, `[DEV] 风向恢复自动：角度 ${((deg % 360) + 360) % 360}°`, '#FFB347');
    } else {
        sv._devWind = rad;
        const deg = Math.round(rad * 180 / Math.PI);
        MSG.pushMsg(sv, `[DEV] 风向已设置：角度 ${deg}°（雨/雪倾斜、沙尘方向随之变化）`, '#7DFF7D');
    }
    persistDev();
    reportDevFlags(sv);   // 联机：devflags 同步（host 权威回传双端）
    AudioSystem.playClick();
}

// 2026-08-09 一键状态回满：生命/饱食/水分/体力全满 + 清除感染与全部疾病（主控 + 主控角色记录同步）
function setAllStatsFull(sv) {
    sv.hp = sv.maxHp || B.MAX_HP;
    sv.food = B.HUNGER_MAX;
    sv.water = B.WATER_MAX;
    sv.stamina = sv.maxStamina;
    sv.exhausted = false;
    sv.infection = 0;
    sv._sick = null;
    // 2026-08-11 v2.99 一键回满 = 恢复健康：清死因残留（防"回满后再死"弹窗仍显示旧死因）
    sv._deathReason = null;
    sv._lastHitBy = null;
    // 2026-08-11 v2.98 测试玩家发现：一键回满/属性全满未清倒地状态——若玩家濒死倒地中点
    // "一键回满"，sv.hp 拉满但 _downed 残留 → updateDowned 仍走倒地逻辑（救援倒计时/濒死标志
    // 不消失）。与主循环 _devGod 块一致：全满 = 立即恢复健康，同步清倒地状态。
    sv._downed = null;
    sv._downedMembers = [];
    sv._carryDowned = false;
    sv._carryMateId = null;
    sv._waitDowned = false;
    // 主控角色记录（NPC 列表里的主角）同步重置，保证 HUD/小队面板一致
    const pc = (sv.npcs || []).find(n => n.isPlayer || n.id === 'player');
    if (pc) {
        pc.hp = pc.maxHp || sv.maxHp || B.MAX_HP;
        pc.food = B.HUNGER_MAX;
        pc.water = B.WATER_MAX;
        pc.stamina = pc.maxStamina || sv.maxStamina;
        pc.exhausted = false;
        pc.infection = 0;
        pc.sick = null;
        pc.downed = false;
        pc.alive = true;
        pc._deathReason = null;   // 2026-08-11 v2.99 一键回满清死因残留
    }
    // 2026-08-11 v2.98 兼容旧 devGod 块：_downedMembers 里的记录同时清 downed 标记（防队伍面板残留"濒"）
    if (Array.isArray(sv.npcs)) {
        for (const n of sv.npcs) {
            if (n && n.downed && (n.isPlayer || n.id === 'player' || (sv.controllerId && n.id === sv.controllerId))) {
                n.downed = false; n._penaltySec = 0; n._downedAtReal = null;
            }
        }
    }
}

// quick 面板的"刷僵尸"逻辑（bindEvents 与 applyDevCmd 共用）
// 2026-08-10 数量自定义（滑块值 n）+ 室内生成支持（室内时在房间可走格生成室内僵尸）。
function devSpawnZombies(sv, n) {
    let made = 0;
    const limit = Math.max(1, Math.min(30, n || 6));
    // 室内：在房间 tiles 里找 FLOOR 可走格生成（spawnZombie 已支持室内 → sv.interior.zombies）
    if (sv.interior) {
        const it = sv.interior;
        for (let i = 0; i < 120 && made < limit; i++) {
            const gx = 1 + Math.floor(Math.random() * Math.max(1, it.w - 2));
            const gy = 1 + Math.floor(Math.random() * Math.max(1, it.h - 3));
            if (it.tiles[gy * it.w + gx] !== 0) continue;   // 0 = IT.FLOOR 可走
            const r = Math.random();
            const type = r < 0.5 ? 'normal' : (r < 0.82 ? 'cone' : 'bucket');
            spawnZombie(sv, type, (gx + 0.5) * TS, (gy + 0.5) * TS, false);
            made++;
        }
        MSG.pushMsg(sv, `[DEV] 室内生成僵尸 ×${made}`, '#FF8866');
        return made;
    }
    // 室外：玩家附近刷
    for (let i = 0; i < 24 && made < limit; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = (5 + Math.random() * 4) * TS;
        const x = sv.px + Math.cos(ang) * dist;
        const y = sv.py + Math.sin(ang) * dist;
        const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
        if (!isWalk(getTile(sv, gx, gy))) continue;
        const r = Math.random();
        const type = r < 0.5 ? 'normal' : (r < 0.82 ? 'cone' : 'bucket');
        spawnZombie(sv, type, x, y, false);
        made++;
    }
    MSG.pushMsg(sv, `[DEV] 生成僵尸 ×${made}`, '#FF8866');
    return made;
}

// ---------- 开发者 TP：传送到指定队友身旁（多队友时由 devTpPicker 选择目标） ----------
function devTpTo(sv, p) {
    if (!p || p.tx == null) { MSG.pushMsg(sv, '[DEV] 目标队友不在线', '#FF8866'); return; }
    if (sv.driving) { MSG.pushMsg(sv, '[DEV] 请先下车再传送', '#FF8866'); return; }
    for (let tries = 0; tries < 24; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (1 + Math.random()) * TS;
        const gx = Math.floor((p.tx + Math.cos(ang) * d) / TS);
        const gy = Math.floor((p.ty + Math.sin(ang) * d) / TS);
        if (!isWalk(getTile(sv, gx, gy))) continue;
        sv.px = (gx + 0.5) * TS; sv.py = (gy + 0.5) * TS;
        sv.faceX = 1; sv.faceY = 0;
        const dist = Math.round(Math.hypot(sv.px - p.tx, sv.py - p.ty) / TS);
        MSG.pushMsg(sv, `[DEV] 已传送到 ${p.name || '队友'} 身旁（${dist} 格）`, '#7DFF7D');
        return;
    }
    MSG.pushMsg(sv, '[DEV] 目标队友附近没有可站立格', '#FF8866');
}
// 多队友选择器：列出每个队友（名字 + 当前距离格数），点击即传送；6s 无操作自动关闭
let devTpPickerEl = null;
function devTpPicker(sv, slots) {
    if (devTpPickerEl && devTpPickerEl.parentNode) devTpPickerEl.parentNode.removeChild(devTpPickerEl);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);z-index:1250;background:#141a22;border:2px solid #39d98a;border-radius:8px;padding:12px 16px;font-family:"Microsoft YaHei",monospace;color:#dce6e2;box-shadow:0 0 30px rgba(57,217,138,0.25);';
    const rows = slots.map((g, i) => {
        const dist = Math.round(Math.hypot((g.tx || 0) - sv.px, (g.ty || 0) - sv.py) / TS);
        return `<button data-tpi="${i}" style="display:block;width:100%;margin:4px 0;background:#123d2c;border:1px solid #39d98a;color:#39d98a;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:13px;text-align:left;">→ ${g.name || '队友'}（约 ${dist} 格）</button>`;
    }).join('');
    el.innerHTML = `<div style="font-size:13px;color:#e8c46a;margin-bottom:6px;text-align:center;">[DEV] 传送到哪个玩家？</div>${rows}
        <button data-tpi="cancel" style="display:block;width:100%;margin-top:6px;background:#241c1c;border:1px solid #8a5a5a;color:#e0a0a0;border-radius:6px;padding:5px;cursor:pointer;font-size:12px;">取消</button>`;
    document.body.appendChild(el);
    devTpPickerEl = el;
    const close = () => { if (el.parentNode) el.parentNode.removeChild(el); if (devTpPickerEl === el) devTpPickerEl = null; };
    el.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-tpi]') : null;
        if (!btn) return;
        const v = btn.getAttribute('data-tpi');
        if (v !== 'cancel') devTpTo(sv, slots[+v]);
        close();
    });
    setTimeout(close, 6000);
}
