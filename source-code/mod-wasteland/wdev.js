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
import { showLookCreator, normalizeLook } from './wlook.js';
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

export function destroy() {
    devOpen = false;
    curSv = null;
    if (devEl) { devEl.remove(); devEl = null; }
}

function buildHtml() {
    let html = `
        <div class="wsl-dev-head">
            <span class="wsl-dev-title">◈ 荒原调试台</span>
            <span class="wsl-dev-tag">DEV</span>
            <button class="wsl-dev-close" id="wdev-close">✕</button>
        </div>
        <div class="wsl-dev-body">
        <div class="wsl-dev-toggles">
            <button data-t="god" id="wdev-god">无敌</button>
            <button data-t="stamina" id="wdev-stamina">无限体力</button>
            <button data-t="inf" id="wdev-inf">资源无限</button>
            <button data-t="ammo" id="wdev-ammo">无限弹药</button>
            <button data-t="bag" id="wdev-bag">无限背包</button>
            <button data-t="oneshot" id="wdev-oneshot">一击必杀</button>
            <button data-t="hud" id="wdev-hud">调试HUD</button>
        </div>
        <div class="wsl-dev-dmg">
            <span class="wsl-dev-dmg-label">武器伤害倍率</span>
            <div class="wsl-dev-dmg-presets">
                ${DMG_PRESETS.map(v => `<button data-mul="${v}">×${v}</button>`).join('')}
            </div>
        </div>
        <div class="wsl-dev-quick">
            <button data-q="day">跳一天</button>
            <button data-q="spd10" id="wdev-spd10">时间×10</button>
            <button data-q="spd60" id="wdev-spd60">时间×60</button>
            <button data-q="t1h">快进1小时</button>
            <button data-q="tnight">到夜晚20点</button>
            <button data-q="tday">到白天6点</button>
            <button data-q="randrespawn">随机重生</button>
            <button data-q="look">外观定制(捏脸)</button>
        </div>
        <div class="wsl-dev-quick">
            <button data-q="tp" class="wsl-dev-mp">传送队友(TP)</button>
            <button data-q="spawn">刷僵尸 ×6</button>
            <button data-q="horde">立即尸潮</button>
            <button data-q="killall">清屏僵尸</button>
            <button data-q="allitems">全部物资×1</button>
            <button data-q="clearbag">清空背包</button>
            <button data-q="wipe" class="wsl-dev-danger">清空存档</button>
        </div>
        <div class="wsl-dev-sub">▸ 状态测试（饥饿 / 血量 / 感染）</div>
        <div class="wsl-dev-quick">
            ${STATE_ACTIONS.map(a => `<button data-s="${a.s}">${a.name}</button>`).join('')}
        </div>
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
        <div class="wsl-dev-sub">▸ 疾病测试（染病 → 看 HUD/小人特效 → 吃药或草药治疗）</div>
        <div class="wsl-dev-boxes">
            <button class="wsl-dev-item" data-sick="cold"><span class="wsl-dev-item-name">感冒</span></button>
            <button class="wsl-dev-item" data-sick="wound"><span class="wsl-dev-item-name">伤口感染</span></button>
            <button class="wsl-dev-item" data-sick="poison"><span class="wsl-dev-item-name">食物中毒</span></button>
            <button class="wsl-dev-item" data-sick="dysentery"><span class="wsl-dev-item-name">痢疾</span></button>
            <button class="wsl-dev-item" data-sick="heatstroke"><span class="wsl-dev-item-name">中暑</span></button>
            <button class="wsl-dev-item" data-sick="cure"><span class="wsl-dev-item-name">痊愈</span></button>
            <button class="wsl-dev-item" data-sick="aging"><span class="wsl-dev-item-name">老化+10岁</span></button>
            <button class="wsl-dev-item" data-sick="setcamp"><span class="wsl-dev-item-name">设营地(脚下)</span></button>
            <button class="wsl-dev-item" data-sick="coins"><span class="wsl-dev-item-name">金币×50</span></button>
        </div>`;
    for (const cat of CATEGORIES) {
        html += `<div class="wsl-dev-cat">
            <div class="wsl-dev-cat-name" style="color:${cat.color}">▸ ${cat.name}</div>
            <div class="wsl-dev-items">`;
        for (const it of cat.items) {
            html += `<button class="wsl-dev-item" data-id="${it.id}" data-n="${it.n}" title="掉落 ${it.name}×${it.n}">
                <span class="wsl-dev-char" style="color:${cat.color}">${it.char}</span>
                <span class="wsl-dev-item-name">${it.name}</span>
            </button>`;
        }
        html += `</div></div>`;
    }
    html += `</div><div class="wsl-dev-foot">F9 开关 · 点击物品掉落到脚下 · 状态随存档保存</div>`;
    return html;
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
    devEl.querySelector('#wdev-oneshot').classList.toggle('on', !!sv._devOneShot);
    devEl.querySelector('#wdev-bag').classList.toggle('on', !!sv._devInfBag);
    devEl.querySelector('#wdev-hud').classList.toggle('on', !!sv._devHud);
    devEl.querySelector('#wdev-spd10').classList.toggle('on', sv._devTimeScale === 10);
    devEl.querySelector('#wdev-spd60').classList.toggle('on', sv._devTimeScale === 60);
    devEl.querySelectorAll('.wsl-dev-dmg-presets button').forEach(b => {
        b.classList.toggle('on', Number(b.dataset.mul) === (sv._devDmgMul || 1));
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
    p._devOneShot = !!sv._devOneShot;
    p._devInfBag = !!sv._devInfBag;
    p._devDmgMul = sv._devDmgMul || 1;
    p._devTimeScale = sv._devTimeScale || 1;
    p._devHud = !!sv._devHud;
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
    for (let tries = 0; tries < 20; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = (2 + Math.random() * 3) * TS;
        const x = sv.px + Math.cos(ang) * d, y = sv.py + Math.sin(ang) * d;
        const gx = Math.floor(x / TS), gy = Math.floor(y / TS);
        if (!isWalk(getTile(sv, gx, gy))) continue;
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

    // 开关：无敌 / 资源无限 / 无限弹药 / 一击必杀
    devEl.querySelectorAll('.wsl-dev-toggles button').forEach(btn => {
        btn.addEventListener('click', () => {
            const sv = curSv;
            if (!sv || !sv.active) return;
            const t = btn.dataset.t;
            if (t === 'god') {
                sv._devGod = !sv._devGod;
                MSG.pushMsg(sv, sv._devGod ? '[DEV] 无敌开启' : '[DEV] 无敌关闭', '#FFB347');
            } else if (t === 'stamina') {
                sv._devInfStamina = !sv._devInfStamina;
                if (sv._devInfStamina) { sv.stamina = sv.maxStamina; sv.exhausted = false; }
                MSG.pushMsg(sv, sv._devInfStamina ? '[DEV] 无限体力开启' : '[DEV] 无限体力关闭', '#FFB347');
            } else if (t === 'inf') {
                sv._devInf = !(sv._devInf !== false);
                MSG.pushMsg(sv, sv._devInf ? '[DEV] 资源无限开启' : '[DEV] 资源无限关闭', '#FFB347');
            } else if (t === 'ammo') {
                sv._devInfAmmo = !sv._devInfAmmo;
                MSG.pushMsg(sv, sv._devInfAmmo ? '[DEV] 无限弹药开启' : '[DEV] 无限弹药关闭', '#FFB347');
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

    // 伤害倍率
    devEl.querySelectorAll('.wsl-dev-dmg-presets button').forEach(btn => {
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
            AudioSystem.playClick();
        });
    });

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

    // 疾病测试：染病种 / 痊愈 / 老化 / 设营地 / 刷金币
    devEl.querySelectorAll('.wsl-dev-boxes [data-sick]').forEach(btn => {
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
                const left = Panel.addItem(sv, 'coin', 50);
                MSG.pushMsg(sv, left > 0 ? '[DEV] 背包满，金币未全部放入' : '[DEV] 金币 +50', '#7DFF7D');
            } else {
                cur.sick = { type: kind, day: sv.day };
                const s = B.SICKNESS[kind];
                MSG.pushMsg(sv, `[DEV] 主控染上${s ? s.name : kind}（看 HUD/小人特效，用药或草药治疗）`, '#FFB347');
            }
            btn.classList.add('flash');
            setTimeout(() => btn.classList.remove('flash'), 180);
        });
    });

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
                case 'randrespawn': {
                    if (sv.driving) { MSG.pushMsg(sv, '[DEV] 请先下车再随机重生', '#FF8866'); break; }
                    for (let tries = 0; tries < 80; tries++) {
                        const ang = Math.random() * Math.PI * 2;
                        const dist = (10 + Math.random() * 6) * CHUNK;
                        const gx = Math.round(Math.cos(ang) * dist), gy = Math.round(Math.sin(ang) * dist);
                        if (!isWalk(getTile(sv, gx, gy))) continue;
                        sv.px = (gx + 0.5) * TS; sv.py = (gy + 0.5) * TS;
                        sv.faceX = 1; sv.faceY = 0;
                        MSG.pushMsg(sv, `[DEV] 随机重生 → 区块(${Math.floor(gx / CHUNK)},${Math.floor(gy / CHUNK)})`, '#7DFF7D');
                        break;
                    }
                    break;
                }
                case 'tp': {
                    // 联机：传送到真人队友身旁（sv.p2 由 wpos 同步维护）
                    const p = sv.p2;
                    if (!p || p.tx == null) {
                        MSG.pushMsg(sv, '[DEV] 队友不在线（需先进入联机游戏）', '#FF8866');
                        break;
                    }
                    if (sv.driving) { MSG.pushMsg(sv, '[DEV] 请先下车再传送', '#FF8866'); break; }
                    let placed = false;
                    for (let tries = 0; tries < 24 && !placed; tries++) {
                        const ang = Math.random() * Math.PI * 2;
                        const d = (1 + Math.random()) * TS;
                        const gx = Math.floor((p.tx + Math.cos(ang) * d) / TS);
                        const gy = Math.floor((p.ty + Math.sin(ang) * d) / TS);
                        if (!isWalk(getTile(sv, gx, gy))) continue;
                        sv.px = (gx + 0.5) * TS; sv.py = (gy + 0.5) * TS;
                        sv.faceX = 1; sv.faceY = 0;
                        placed = true;
                        const dist = Math.round(Math.hypot(sv.px - p.tx, sv.py - p.ty) / TS);
                        MSG.pushMsg(sv, `[DEV] 已传送到队友身旁（${dist} 格）`, '#7DFF7D');
                        break;
                    }
                    if (!placed) MSG.pushMsg(sv, '[DEV] 队友附近没有可站立格', '#FF8866');
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
                    if (sv.mp && sv.mp.role === 'guest') {
                        reportDevCmd(sv, { cmd: 'spawn', n: 6 });
                        MSG.pushMsg(sv, '[DEV] 已请求召唤僵尸 ×6（同步中）', '#FF8866');
                        break;
                    }
                    devSpawnZombies(sv, 6);
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
        case 'time':
            // 时间操作（host 权威，t/day 进 wsync 回传双端）
            if (p.op === 'day') { sv.day++; sv.t = B.DAY_LEN * 0.35; MSG.pushMsg(sv, `[DEV] 对方跳到第 ${sv.day} 天`, '#FFB347'); }
            else if (p.op === 't1h') { sv.t += B.DAY_LEN / 24; rollDay(sv); MSG.pushMsg(sv, `[DEV] 对方快进 1 小时 → 第 ${sv.day} 天 ${hourText(sv)}`, '#FFB347'); }
            else if (p.op === 'tnight') { sv.t = B.DAY_LEN * 20 / 24; MSG.pushMsg(sv, '[DEV] 对方跳到夜晚 20:00', '#FFB347'); }
            else if (p.op === 'tday') { sv.t = B.DAY_LEN * 6 / 24; MSG.pushMsg(sv, '[DEV] 对方跳到白天 6:00', '#FFB347'); }
            break;
    }
}

// quick 面板的"刷僵尸 ×6"逻辑（bindEvents 与 applyDevCmd 共用）
function devSpawnZombies(sv, n) {
    let made = 0;
    for (let i = 0; i < 24 && made < n; i++) {
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
