// ============================================================
// 【无尽植僵荒原】模组 · 荒原画布渲染（黑底文字风 + HUD）
// 无限地图：镜头跟随玩家，地块按需向 world.js 查询（坐标可正可负）
// ============================================================

import { T, CHUNK, chunkBiome, getTile, hash2, plannedSidewalkAt, plannedArterialAt, gridRoadKept, ruinsRoadBand } from './world.js';
import { WEAPONS } from '../core/constants.js';
import { getItemInfo } from './panel.js';
import { carCondition, carDirAt } from './wvehicle.js';
import { speciesInfo, speciesAt, plantDisplay } from './wplants.js';
import * as WGRASS from './wgrass.js';   // 草地独立模块（地面/草束/季节/风摆）
import { drawMsg } from './wmsg.js';
import { TS } from './wconst.js';
import { INTERIOR_TILES as IT, INTERIOR_W, INTERIOR_H } from './windoor.js';
import { districtAt, districtProfile, infectionAt } from './wdistrict.js';
import { BARRICADE_HP, CAR_HP, Z_ATK_STYLES, Z_FLAG_AURA_RANGE, Z_BODY, PLANT_BODY, PLAYER_BODY, WATER_MAX, COIN_ID, SICKNESS, sickColor, FUEL_MAX, CAMP_RADIUS, wxInfo, infVis, wxIntensity, wxLevelCur, WX_PART_SPEED, wxSpeedMul, fogRadius, windDirAt, windDirAtHour, SEASON_NAMES, seasonAt, DOWNED_LIMIT_SECONDS } from './wbalance.js';
import { infectionBand, worldInfectionLevel, playerInfectionEffects } from './winfection.js';
export { TS };

// 角色 sprite 渲染高度（与 drawPixelPlayerBody 的 TARGET_H=48 对应）。
// 攻击/挥砍特效以脚底（sv.py / sy）为圆心会偏低、位置不居中，
// 统一上移到"身体中部"作为特效圆心（角色占 [y-48, y]，中部约 y-24）。
const PLAYER_BODY_MID = 24;

// ============================================================
// 角色 sprite:用户参考图 1:1 提取(south/west/north 三个方向)。
// 走路动画:精确像素平移规范(躯干/发/脸锁定,仅 4 部件 ±1px 平移),
// 预生成 walk-{front,side,back}-f{0,1,2,3}.png,走路按 anim.frame 选帧。
// 朝右行走用 side 水平镜像。
// ============================================================
const _mcSprites = { front: null, side: null, back: null };
const _mcWalk = { front: [null, null, null, null], side: [null, null, null, null], back: [null, null, null, null] };
export { _mcSprites, _mcWalk }; // 导出给捏脸界面 wlook.js 用(显示 4 方向 sprite 缩略图)
(() => {
    if (typeof Image === 'undefined') return; // Node 测试环境无 Image,跳过预加载
    const base = new URL('.', import.meta.url);
    for (const n of ['front', 'side', 'back']) {
        const img = new Image();
        img.onload = () => { _mcSprites[n] = img; };
        img.src = new URL('sprites/sprite-' + n + '.png', base).href;
    }
    // walk 帧加载:正面 = 用户逐帧图 f2(迈左脚)/f3(迈右脚)两帧交替;
    // 待机仍是 sprite-front.png(初始站立)。side 走路 = 用户给的朝东 4 帧动画（f0=1.png、f1=2.png、f2=3.png、f3=4.png）按 1→2→3→4 循环；
    // back 仍走原 4 帧。步频：side 0.18s/帧（survival.js 单独维护 stepT），4 帧循环周期 0.72s。
    const WALK_FRAME_FILES = {
        front: ['walk-front-f2.png', 'walk-front-f3.png', 'walk-front-f2.png', 'walk-front-f3.png'],
        side: ['walk-side-f0.png', 'walk-side-f1.png', 'walk-side-f2.png', 'walk-side-f3.png'],   // 朝东 4 帧（用户图 1/2/3/4.png），
                                                                                    // 加载时每帧镜像成"反方向"，朝东=整体镜像→原图、朝西=不镜像→镜像图
        back: ['walk-back-f0.png', 'walk-back-f1.png', 'walk-back-f2.png', 'walk-back-f3.png'],
    };
    for (const n of ['front', 'side', 'back']) {
        const files = WALK_FRAME_FILES[n];
        for (let f = 0; f < files.length; f++) {
            const img = new Image();
            const idx = f;
            img.onload = () => {
                _mcWalk[n][idx] = img;
                // side 方向（2026-08-08 16:54 修复）：用户给的 4 帧是"朝东行走"参考图。
                // 存储**原图**，不镜像。渲染层 dir==='right'(朝东) 整体水平镜像 → 显示镜像图（朝东迈步 view），
                // 朝西不镜像 → 显示原图。与待机 sprite-side 方向一致（朝东=镜像、朝西=原图）。
                // 之前 onload 对 side 帧做了镜像存储，叠加渲染层镜像导致朝东/朝西装反，已修正。
            };
            img.src = new URL('sprites/' + files[f], base).href;
        }
    }
})();

// 建造件定义（survival.js 建造逻辑与建造栏渲染共用）
export const BUILD_ITEMS = [
    // 墙升级链（B1）：选「木墙」对准已有墙再放 → 升级 石墙(lv2)→金属墙(lv3)
    { t: T.WALL,    name: '木墙',   cost: 2, upg: [
        { lv: 2, name: '石墙',   cost: { stone: 3 },    hpMul: 1.8 },
        { lv: 3, name: '金属墙', cost: { part: 2, stone: 3 }, hpMul: 3.0 },
    ] },
    { t: T.DOOR,    name: '木门',   cost: 3 },
    { t: T.CABINET, name: '储物柜', cost: 4 },
    { t: T.BED,     name: '木床',   cost: 6 },
    { t: T.PLOT,    name: '种植盆', cost: 2 },
];

// 防御工事耐久（尸潮僵尸啃咬扣血，归零被摧毁）
export const BUILD_HP = {
    [T.WALL]: 300, [T.DOOR]: 200, [T.CABINET]: 250, [T.BED]: 150, [T.PLOT]: 100,
};

const TILE_COLOR = {
    [T.TREE]: '#2D8A2D', [T.WALL]: '#8A8A8A', [T.DOOR]: '#D29A5B',
    [T.RUBBLE]: '#7D7D7D', [T.WATER]: '#2B6FD6', [T.BOX]: '#D8A528',
    [T.HERB]: '#46C846', [T.BED]: '#C86A6A', [T.FLOWER]: '#FFD700',
    [T.CABINET]: '#C8A2E8', [T.SPROUT]: '#66DD44', [T.PLOT]: '#8B6914',
    [T.WBOX]: '#FF6644', [T.MEDBOX]: '#44DD66', [T.MATBOX]: '#AAAAAA',
    [T.CROP]: '#DDBB44',
    [T.ROAD]: '#484852', [T.CAR]: '#C0392B', [T.CARWRECK]: '#5A5A5A', [T.BARRICADE]: '#DDAA33',
};
const BIOME_BG = ['#0C0818', '#080810', '#04140A', '#100C04'];   // 城区 / 郊区 / 荒野 / 废墟
const COLLECT_INFO = {
    [T.HERB]: { text: '草药', color: '#46C846' },
    [T.FLOWER]: { text: '向日葵', color: '#FFD700' },
    [T.WATER]: { text: '水源', color: '#5599FF' },
    [T.TREE]: { text: '树木', color: '#2D8A2D' },
    [T.BOX]: { text: '物资箱', color: '#D8A528' },
    [T.WBOX]: { text: '武器箱', color: '#FF6644' },
    [T.MEDBOX]: { text: '医疗箱', color: '#44DD66' },
    [T.MATBOX]: { text: '建材箱', color: '#AAAAAA' },
    [T.BED]: { text: '木床', color: '#C86A6A' },
    [T.CABINET]: { text: '储物柜', color: '#C8A2E8' },
    [T.DOOR]: { text: '入口', color: '#D29A5B' },
    [T.RUBBLE]: { text: '碎石', color: '#7D7D7D' },
    [T.TRASHBIN]: { text: '垃圾桶', color: '#5E8A5A' },
    [T.CARDBOX]: { text: '纸箱', color: '#B08848' },
    [T.HYDRANT]: { text: '消防栓', color: '#C04434' },
    [T.NEWSSTAND]: { text: '报刊亭', color: '#8A7A50' },
    [T.TIRES]: { text: '废弃轮胎', color: '#4A4A50' },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let _worldSeed = 0;   // 每帧 draw() 更新，供无 sv 参数的绘制函数用（如 drawCollectible 碎石残路带判定）

// ---------- 离屏缓存系统：确定性渲染只算一次 ----------
const _tileInfectionCache = new Map();
const _treeCache = new Map();
const _brickCache = new Map();

function drawContinuousRoofTiles(ctx, tx, ty, roofH, style = 'tile') {
    if (style === 'urban') {
        const worldX = tx * TS, worldY = ty * TS;
        ctx.fillStyle = 'rgba(15,22,29,0.16)';
        for (let py = 0; py < roofH; py++) {
            const gy = worldY + py;
            if (((gy % 24) + 24) % 24 === 0) ctx.fillRect(0, py, TS + 1, 1);
        }
        for (let px = 0; px <= TS; px++) {
            const gx = worldX + px;
            if (((gx % 32) + 32) % 32 === 0) ctx.fillRect(px, 0, 1, roofH);
        }
        for (let py = 3; py < roofH; py += 7) for (let px = 4; px < TS; px += 9) {
            const grain = hash2(0x55A7, worldX + px, worldY + py);
            if (grain > 0.78) {
                ctx.fillStyle = grain > 0.92 ? 'rgba(205,215,220,0.10)' : 'rgba(20,27,31,0.10)';
                ctx.fillRect(px, py, grain > 0.92 ? 2 : 1, 1);
            }
        }
        return;
    }
    const courseH = style === 'urban' ? 12 : 6;
    const tileW = style === 'urban' ? 18 : 10;
    const worldX = tx * TS, worldY = ty * TS;
    for (let py = 0; py < roofH; py++) {
        const gy = worldY + py;
        if (((gy % courseH) + courseH) % courseH !== 0) continue;
        ctx.fillStyle = style === 'ruins' ? 'rgba(18,14,11,0.18)' : 'rgba(34,20,13,0.14)';
        ctx.fillRect(0, py, TS + 1, 1);
        if (style !== 'ruins' && py > 0) {
            ctx.fillStyle = 'rgba(255,220,175,0.06)';
            ctx.fillRect(0, py - 1, TS + 1, 1);
        }
        const course = Math.floor(gy / courseH);
        const stagger = (course & 1) ? Math.floor(tileW / 2) : 0;
        ctx.fillStyle = style === 'ruins' ? 'rgba(20,16,12,0.16)' : 'rgba(34,20,13,0.12)';
        for (let px = 0; px <= TS; px++) {
            const gx = worldX + px - stagger;
            if (((gx % tileW) + tileW) % tileW === 0) {
                ctx.fillRect(px, py + 1, 1, Math.min(courseH - 1, roofH - py - 1));
            }
        }
    }
}

function drawSuburbanRoofSurface(ctx, seed, tx, ty, roofH, geometry, color) {
    const { rowsAbove, rowsBelow, colsLeft, colsRight, horizontalWing } = geometry;
    const { roofR, roofG, roofB } = color;
    for (let py = 0; py < roofH; py++) for (let px = 0; px <= TS; px++) {
        const dn = rowsAbove * TS + py, ds = rowsBelow * TS + (TS - 1 - py);
        const dw = colsLeft * TS + px, de = colsRight * TS + (TS - 1 - px);
        const slopeNear = horizontalWing ? Math.min(dn, ds) : Math.min(dw, de);
        let v = horizontalWing ? (dn <= ds ? -10 : 6) : (dw <= de ? -7 : 3);
        v += Math.min(5, Math.floor(slopeNear / 14));
        const grain = hash2(seed ^ 0xA731, tx * TS + px, ty * TS + py);
        v += grain > .82 ? 2 : (grain < .12 ? -2 : 0);
        if (horizontalWing ? Math.abs(dn - ds) <= 1 : Math.abs(dw - de) <= 1) v += 18;
        ctx.fillStyle = `rgb(${roofR + v},${roofG + v},${roofB + v})`;
        ctx.fillRect(px, py, 1, 1);
    }
    drawContinuousRoofTiles(ctx, tx, ty, roofH, 'tile');
}
const _zombieCache = new Map();
const CACHE_MAX = 400;
function cacheGet(map, key) { return map.get(key); }
function cacheSet(map, key, canvas) {
    if (map.size > CACHE_MAX) { const first = map.keys().next().value; map.delete(first); }
    map.set(key, canvas);
}
function makeOffscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

function visualInfectionAt(sv, tx, ty, salt = 0) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    const base = infectionAt(sv.world.seed, cx, cy);
    const local = hash2(sv.world.seed ^ (0x71F3 + salt), tx, ty) * 0.15;
    return Math.max(0, Math.min(1, base + local - 0.05));
}

const pixelWordCache = new Map();
const _mixColorCache = new Map();

function mixHexColor(a, b, t) {
    const key = a + '|' + b + '|' + (Math.round(clamp(t, 0, 1) * 20) / 20);
    const cached = _mixColorCache.get(key);
    if (cached) return cached;
    const parse = value => {
        const hex = String(value || '#888888').replace('#', '');
        const full = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex.padEnd(6, '8').slice(0, 6);
        return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
    };
    const from = parse(a), to = parse(b), p = clamp(t, 0, 1);
    const rgb = from.map((value, index) => Math.round(value + (to[index] - value) * p));
    const result = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    if (_mixColorCache.size < 4000) _mixColorCache.set(key, result);
    return result;
}

function pixelWordMask(text, width, height, block, gapPixels = block) {
    const key = `${text}:${width}:${height}:${block}:${gapPixels}`;
    if (pixelWordCache.has(key)) return pixelWordCache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width / block));
    canvas.height = Math.max(1, Math.ceil(height / block));
    const maskCtx = canvas.getContext('2d', { willReadFrequently: true });
    maskCtx.imageSmoothingEnabled = false;
    maskCtx.clearRect(0, 0, canvas.width, canvas.height);
    maskCtx.fillStyle = '#fff';
    maskCtx.textAlign = 'center';
    maskCtx.textBaseline = 'middle';
    const chars = Array.from(text);
    const gapCols = Math.max(1, Math.ceil(gapPixels / block));
    const contentWidth = canvas.width - gapCols * Math.max(0, chars.length - 1);
    const cellWidth = contentWidth / Math.max(1, chars.length);
    const fontSize = Math.max(6, Math.floor(Math.min(canvas.height * .9, cellWidth * 1.14)));
    maskCtx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;
    chars.forEach((char, index) => {
        const cx = cellWidth * (index + .5) + gapCols * index;
        maskCtx.fillText(char, cx, canvas.height / 2);
    });
    const data = maskCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    const points = [];
    for (let py = 0; py < canvas.height; py++) for (let px = 0; px < canvas.width; px++) {
        if (data[(py * canvas.width + px) * 4 + 3] > 80) points.push([px, py]);
    }
    const result = { points, cols: canvas.width, rows: canvas.height };
    pixelWordCache.set(key, result);
    return result;
}

const _treeTextSetCache = new Map();

function drawPixelTree(ctx, sx, sy, level, seed, eraseColor) {
    const scale = 2;
    const width = 28, height = 29;
    const totalW = width * scale, totalH = height * scale;
    const gridX = Math.round(sx - totalW / 2), gridY = Math.round(sy + TS / 2 - totalH);
    const lvQ = Math.round(level * 10);
    const cacheKey = (seed ^ (lvQ * 6271)) >>> 0;
    let cached = cacheGet(_treeCache, cacheKey);
    if (!cached) {
        cached = makeOffscreen(totalW, totalH);
        const octx = cached.getContext('2d');
        octx.imageSmoothingEnabled = false;
        const word = pixelWordMask('树', width, height, 1, 0);
        let textPixels = _treeTextSetCache.get('树');
        if (!textPixels) {
            textPixels = new Set(word.points.map(([px, py]) => px * 100 + py));
            _treeTextSetCache.set('树', textPixels);
        }
        const transitionColor = '#5a5040', textColor = '#a89a82';
        for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
            let entityColor = null;
            if (px >= 11 && px < 18 && py >= 15) entityColor = '#493323';
            if (px >= 13 && px < 17 && py >= 13 && py < 27) entityColor = '#704a2d';
            if (px >= 3 && px < 26 && py >= 3 && py < 19) entityColor = '#253e27';
            if (py >= 7 && py < 16) entityColor = '#315b32';
            if (px >= 6 && px < 22 && py < 7) entityColor = '#487444';
            if (px >= 8 && px < 15 && py >= 2 && py < 7) entityColor = '#5f8a4e';
            const isTextPixel = textPixels.has(px * 100 + py);
            if (!entityColor && !isTextPixel) continue;
            const edge = Math.min(px / (width - 1), (width - 1 - px) / (width - 1),
                py / (height - 1), (height - 1 - py) / (height - 1));
            const noise = hash2(seed ^ 0x51A9, px, py);
            const peelAt = .04 + edge * 1.24 + noise * .36;
            const frontier = .06;
            let color = null;
            if (level < peelAt - frontier) {
                if (entityColor) color = entityColor;
            } else if (level < peelAt) {
                const t = (level - (peelAt - frontier)) / frontier;
                if (entityColor) color = mixHexColor(entityColor, transitionColor, t);
            } else {
                if (isTextPixel && entityColor) color = textColor;
            }
            if (color) {
                octx.fillStyle = color;
                octx.fillRect(px * scale, py * scale, scale, scale);
            }
        }
        cacheSet(_treeCache, cacheKey, cached);
    }
    ctx.drawImage(cached, gridX, gridY);
}

const _textSetCache = new Map();

function getTextSet(text, width, height, block, gap) {
    const key = `${text}:${width}:${height}:${block}:${gap}`;
    let set = _textSetCache.get(key);
    if (!set) {
        const mask = pixelWordMask(text, width, height, block, gap);
        set = new Set(mask.points.map(([px, py]) => px * 100 + py));
        if (_textSetCache.size < 200) _textSetCache.set(key, set);
    }
    return set;
}

function getTileTextSet(word, tileW, tileH, wordW, wordH, gap) {
    const key = `tile:${word}:${tileW}:${tileH}:${wordW}:${wordH}:${gap}`;
    let set = _textSetCache.get(key);
    if (!set) {
        const mask = pixelWordMask(word, wordW, wordH, 1, gap);
        const ox = Math.floor((tileW - mask.cols) / 2);
        const oy = Math.floor((tileH - mask.rows) / 2);
        set = new Set(mask.points.map(([px, py]) => (px + ox) * 100 + (py + oy)));
        if (_textSetCache.size < 200) _textSetCache.set(key, set);
    }
    return set;
}

function drawTileInfection(ctx, x, y, level, word, seed, options) {
    if (level <= 0.03) return;
    const w = options.w || TS, h = options.h || TS;
    const lvQ = Math.round(level * 20);
    const cacheKey = (seed ^ (lvQ * 7919)) >>> 0;
    let cached = cacheGet(_tileInfectionCache, cacheKey);
    if (!cached) {
        cached = makeOffscreen(w, h);
        const octx = cached.getContext('2d');
        octx.imageSmoothingEnabled = false;
        const entityColor = options.entityColor || '#888888';
        const transitionColor = options.transitionColor || '#5a5040';
        const textColor = options.textColor || '#a89a82';
        const eraseColor = options.eraseColor || '#080810';
        const wordW = options.wordW || (w - 6);
        const wordH = options.wordH || (h - 6);
        const textPixels = getTileTextSet(word, w, h, wordW, wordH, options.gapPixels || 2);
        const maxEdge = Math.min(0.49, (level + 0.42) / 1.24);
        const innerX0 = Math.floor(maxEdge * (w - 1));
        const innerX1 = w - 1 - innerX0;
        const innerY0 = Math.floor(maxEdge * (h - 1));
        const innerY1 = h - 1 - innerY0;
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                if (px > innerX0 && px < innerX1 && py > innerY0 && py < innerY1) continue;
                const isTextPixel = textPixels.has(px * 100 + py);
                const edge = Math.min(px / (w - 1), (w - 1 - px) / (w - 1),
                    py / (h - 1), (h - 1 - py) / (h - 1));
                const noise = hash2(seed ^ 0x51A9, px, py);
                const peelAt = .04 + edge * 1.24 + noise * .36;
                if (level < peelAt - .06) continue;
                let color;
                if (level < peelAt) {
                    color = mixHexColor(entityColor, transitionColor, (level - (peelAt - .06)) / .06);
                } else {
                    color = isTextPixel ? textColor : eraseColor;
                }
                if (color) { octx.fillStyle = color; octx.fillRect(px, py, 1, 1); }
            }
        }
        cacheSet(_tileInfectionCache, cacheKey, cached);
    }
    ctx.drawImage(cached, x, y);
}

function zombieBodyColorAt(px, py, type, coat, skin, hair) {
    let color = null;
    if (px >= 7 && px < 12 && py >= 31 && py < 36) color = '#222628';
    if (px >= 16 && px < 21 && py >= 31 && py < 36) color = '#222628';
    if (px >= 8 && px < 13 && py >= 24 && py < 33) color = '#41484a';
    if (px >= 15 && px < 20 && py >= 24 && py < 33) color = '#41484a';
    if (px >= 6 && px < 21 && py >= 14 && py < 26) color = coat;
    if (px >= 2 && px < 7 && py >= 16 && py < 27) color = skin;
    if (px >= 21 && px < 25 && py >= 14 && py < 26) color = skin;
    if (px >= 8 && px < 21 && py >= 4 && py < 15) color = hair || '#5c7657';
    if (px >= 7 && px < 9 && py >= 6 && py < 13) color = '#31432f';
    if (px >= 16 && px < 18 && py >= 8 && py < 10) color = '#d5c37b';
    return color;
}

function zombieGearColorAt(px, py, type) {
    if (type === 'cone') {
        if (px >= 9 && px < 20 && py >= 1 && py < 4) return '#b66a2f';
        if (px >= 11 && px < 18 && py >= 0 && py < 1) return '#b66a2f';
    }
    if (type === 'bucket') {
        if (px >= 7 && px < 22 && py >= 0 && py < 5) return '#7e898c';
        if (px >= 9 && px < 19 && py >= 1 && py < 3) return '#aeb7b8';
    }
    if (type === 'door') {
        if (px >= 0 && px < 4 && py >= 9 && py < 31) return '#62696b';
    }
    if (type === 'flag') {
        if (px >= 24 && px < 26 && py >= 0 && py < 30) return '#79534a';
        if (px >= 26 && px < 28 && py >= 0 && py < 7) return '#8d3e3e';
    }
    if (type === 'pole') {
        if (px >= 0 && px < 2 && py >= 12 && py < 30) return '#7a6a4a';
    }
    return null;
}

// 2026-08-09 僵尸按类型差异化配色（"很多种类的僵尸，颜色还挺好看"）：
// 每种类型一套专属皮肤/头发/外衣色板，多类型一眼可辨且整体协调。
// 皮肤/头发：按类型取色；外衣用各类型既有 def.color（传入 color 参数）。
// 尸化玩家精英（playerzombie）保留继承的 z.skin。
const ZOMBIE_PALETTE = {
    normal:   { skin: '#78936b', hair: '#5c7657' },
    cone:     { skin: '#8a9a5e', hair: '#6a7a44' },
    bucket:   { skin: '#9aa8a0', hair: '#6a7a76' },
    door:     { skin: '#a08464', hair: '#6e5a44' },
    flag:     { skin: '#b8906a', hair: '#806a44' },
    pole:     { skin: '#7aa2a4', hair: '#5a7a7e' },
    remnant:  { skin: '#9486ae', hair: '#74649a' },
    deleter:  { skin: '#a87264', hair: '#80604a' },
    swapper:  { skin: '#6a9e72', hair: '#4a7452' },
    giant:    { skin: '#a06a7a', hair: '#7a4a5a' },
    playerzombie: { skin: null, hair: '#3a4a42' },
};
function zombiePalette(type) { return ZOMBIE_PALETTE[type] || ZOMBIE_PALETTE.normal; }

function drawPixelZombie(ctx, z, sx, sy, color) {
    const level = z.infection || 0;
    const gridX = Math.round(sx - 12), gridY = Math.round(sy - 16) - 2;
    const width = 28, height = 36;
    const skinState = z.stunT > 0 ? 2 : (z.hurt > 0 ? 1 : 0);
    const lvQ = Math.round(level * 8);
    // 尸化玩家精英：肤色混入缓存 key（否则不同肤色共用缓存 → 颜色串用）
    const pal = zombiePalette(z.type);
    const skinHash = z.skin ? ((parseInt(z.skin.slice(1), 16) || 0) & 0x3FF) : 0;
    const cacheKey = (z.type.charCodeAt(0) * 1000 + lvQ * 10 + skinState + skinHash * 64) | 0;
    let cached = cacheGet(_zombieCache, cacheKey);
    if (!cached) {
        cached = makeOffscreen(width, height);
        const octx = cached.getContext('2d');
        octx.imageSmoothingEnabled = false;
        const textPixels = getTextSet('尸', width, height, 1, 0);
        const transitionColor = '#5a4a48', textColor = '#a87980';
        const skin = skinState === 2 ? '#858585' : (skinState === 1 ? '#b65454' : (z.skin || pal.skin || '#78936b'));
        const hair = pal.hair || '#5c7657';
        const coat = color || '#58656d';
        const seed = z.type.charCodeAt(0) * 7919;
        for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
            const gearColor = zombieGearColorAt(px, py, z.type);
            if (gearColor) {
                const noise = hash2(seed ^ 0x3B21, px, py);
                const scratch = level * .3 * noise;
                octx.fillStyle = scratch > .12 ? mixHexColor(gearColor, '#333', scratch) : gearColor;
                octx.fillRect(px, py, 1, 1);
                continue;
            }
            const entityColor = zombieBodyColorAt(px, py, z.type, coat, skin, hair);
            const isTextPixel = textPixels.has(px * 100 + py);
            if (!entityColor && !isTextPixel) continue;
            const edge = Math.min(px / (width - 1), (width - 1 - px) / (width - 1),
                py / (height - 1), (height - 1 - py) / (height - 1));
            const noise = hash2(seed ^ 0x51A9, px, py);
            const peelAt = .04 + edge * 1.24 + noise * .36;
            const frontier = .06;
            let finalColor = null;
            if (level < peelAt - frontier) {
                if (entityColor) finalColor = entityColor;
            } else if (level < peelAt) {
                const t = (level - (peelAt - frontier)) / frontier;
                if (entityColor) finalColor = mixHexColor(entityColor, transitionColor, t);
            } else {
                if (isTextPixel && entityColor) finalColor = textColor;
            }
            if (finalColor) {
                octx.fillStyle = finalColor;
                octx.fillRect(px, py, 1, 1);
            }
        }
        cacheSet(_zombieCache, cacheKey, cached);
    }
    ctx.drawImage(cached, gridX, gridY);
}

// ---- 捏脸外观的派生明暗色板（程序化生成，带缓存）----
// 仅用捏脸的 6 个基础色，派生 明暗/高光/腮红/描边 层次，不新增捏脸参数。
const _shadeCache = new Map();
function lookShades(bodyColor, L) {
    const key = [bodyColor, L.skin, L.hair, L.pants, L.shoes, L.eyes].join('|');
    const hit = _shadeCache.get(key);
    if (hit) return hit;
    const skin = L.skin || '#c49470';
    const s = {
        skin,
        skinShade: mixHexColor(skin, '#3d2a1c', 0.38),   // 耳/颈阴影
        cheek: mixHexColor(skin, '#e0705a', 0.55),        // 腮红
        mouth: '#7a4434',                                  // 嘴
        hair: L.hair || '#34302d',
        hairLight: mixHexColor(L.hair || '#34302d', '#ffffff', 0.24), // 发丝高光
        hairDark: mixHexColor(L.hair || '#34302d', '#000000', 0.3),  // 发阴影（眉毛/马尾暗部）
        shirt: bodyColor,
        shirtLight: mixHexColor(bodyColor, '#ffffff', 0.22),          // 肩/胸高光
        shirtDark: mixHexColor(bodyColor, '#0a0c0a', 0.32),           // 腰带/下摆/侧影
        pants: L.pants || '#314c58',
        pantsDark: mixHexColor(L.pants || '#314c58', '#000000', 0.28), // 裤脚暗部
        shoes: L.shoes || '#20282b',
        shoesDark: mixHexColor(L.shoes || '#20282b', '#000000', 0.35), // 鞋底
        eyeHighlight: mixHexColor(L.eyes || '#232323', '#ffffff', 0.62), // 眼睛高光点
    };
    if (_shadeCache.size < 800) _shadeCache.set(key, s);
    return s;
}

// MC 标准 20×32 像素网格(严格对照 A 组三视图参考图:A 组正面/侧视/背面)
// 字符 → lookShades: '.' bg / 'h' hairLight / 'H' hair / 's' skin / 'S' skinShade
//   'N' hairDark (深棕脖/领) / 'G' shirt / 'g' shirtDark / 'B' pants / 'b' pantsDark
//   'k' shoes / 'K' shoesDark / 'E' eyes (需查 L.eyes)
const FRONT_GRID = [
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........sssssssssssEEEsssssEEEssssssssss........',
  '........sssssssssssEEEsssssEEEssssssssss........',
  '........ssssssssssssssssssssssssssssssss........',
  '........ssssssssssssssssssssssssssssssss........',
  '........ssssssssssssssssssssssssssssssss........',
  '........ssssssssssssssssssssssssssssssss........',
  '........ssssssssssssssssssssssssssssssss........',
  '........ssssssssssssssssssssssssssssssss........',
  '........ssssssssssssssssssssssssssssssss........',
  '........ssssssssssssssMMMMssssssssssssss........',
  '........ssssssssssssssMMMMssssssssssssss........',
  '..............NNNNNNNNNNNNNNNNNNNN..............',
  '..............NNNNNNNNNNNNNNNNNNNN..............',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
];
const BACK_GRID = [
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '..............NNNNNNNNNNNNNNNNNNNN..............',
  '..............NNNNNNNNNNNNNNNNNNNN..............',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '........GGGGGggggggggggggggggggggggGGGGG........',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '......ssssssssggggggggggggggggggggssssssss......',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............bbbbbbbbbBBBbbbbbbbbb.............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............kkkkkkkkkkkkkkkkkkkk..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
  '..............KKKKKKKKKKKKKKKKKKKK..............',
];
const SIDE_GRID = [
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH........',
  '........HHHHHHHHHHHHHHHHHsssssEEEsssssss........',
  '........HHHHHHHHHHHHHHHHHsssssEEEsssssss........',
  '........HHHHHHHHHHHHHHHHHsssssssssssssss........',
  '........HHHHHHHHHHHHHHHHHsssssssssssssss........',
  '........HHHHHHHHHHHHHHHHHsssssssssssssss........',
  '........HHHHHHHHHHHHHHHHHsssssssssssssss........',
  '........HHHHHHHHHHHHHHHHHsssssssssssssss........',
  '........HHHHHHHHHHHHHHHHHsssssssssssssss........',
  '........HHHHHHHHHHHHHHHHHsssssssssssssss........',
  '........HHHHHHHHHHHHHHHHHsssssMMMMssssss........',
  '........HHHHHHHHHHHHHHHHHsssssMMMMssssss........',
  '.........................NNNNNNNNNNNNNNN........',
  '.........................NNNNNNNNNNNNNNN........',
  '........ggggggggggggggGGGGGGGGGGGGGGGGGG........',
  '........ggggggggggggggGGGGGGGGGGGGGGGGGG........',
  '........ggggggggggggggGGGGGGGGGGGGGGGGGG........',
  '........ggggggggggggggGGGGGGGGGGGGGGGGGG........',
  '........ggggggggggggggGGGGGGGGGGGGGGGGGG........',
  '........ggggggggggggggGGGGGGGGGGGGGGGGGG........',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '..............gggggggggggggggggggggggssssssss...',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................bbbbbbbbbbb.................',
  '....................kkkkkkkkkkkk................',
  '....................kkkkkkkkkkkk................',
  '....................kkkkkkkkkkkk................',
  '....................kkkkkkkkkkkk................',
  '....................kkkkkkkkkkkk................',
  '....................kkkkkkkkkkkk................',
  '....................KKKKKKKKKKKK................',
  '....................KKKKKKKKKKKK................',
  '....................KKKKKKKKKKKK................',
  '....................KKKKKKKKKKKK................',
];
function mcColor(ch, S, L) {
  switch (ch) {
    case 'h': return S.hairLight;
    case 'H': return S.hair;
    case 's': return S.skin;
    case 'S': return S.skinShade;
    case 'N': return S.hairDark;     // 脖=V领=深棕
    case 'G': return S.shirt;
    case 'g': return S.shirtDark;
    case 'B': return S.pants;
    case 'b': return S.pantsDark;
    case 'k': return S.shoes;
    case 'K': return S.shoesDark;
    case 'E': return L.eyes;
    case 'M': return S.mouth;
    default: return null;
  }
}

// 像素小人取色：外观参数化 + 可选逐帧动画。
// 画布改为 20×32(MC 标准比例,对照 A 组三视图参考图);
// 站立/走路/奔跑/挥击 仅做腿/手/衣摆 ±1 像素偏移,保留 MC 方块风。
export function playerBodyColorAt(px, py, bodyColor, look, anim) {
    const L = look || {};
    const S = lookShades(bodyColor || L.shirt || '#39d98a', L);
    const a = anim || null;
    const moving = !!(a && a.moving);
    const isUp = !!(a && a.dir === 'up');
    const isSide = !!(a && (a.dir === 'left' || a.dir === 'right'));
    const sign = a && a.dir === 'right' ? 1 : -1;
    const f = moving ? (a.frame === 0 ? 1 : a.frame === 2 ? -1 : 0) : 0; // ±1
    const amp = a && a.run ? 2 : 1;
    const GRID_W = 48, GRID_H = 96;

    let grid;
    if (isUp) grid = BACK_GRID;
    else if (isSide) grid = SIDE_GRID;
    else grid = FRONT_GRID;

    // 朝左镜像(整列 x 翻转)
    let lx = isSide && sign < 0 ? (GRID_W - 1 - px) : px;
    let ly = py;

    // 走路动画(重新设计):身体 bob 起伏 + 前后腿交替 + 手臂反相位摆动(4 拍循环)
    // 48x96 网格分区:y0-23 头 / y24-31 肩颈 / y32-53 衣+臂 / y54-83 腿 / y84-95 鞋
    if (moving) {
        const st = amp * f;             // 迈步幅度(跑 ±2 / 走 ±1)
        const bobLift = f !== 0 ? -amp : 0; // 迈步帧身体上浮(走路-1/跑-2),落地帧回 0 = 走路起伏
        if (isSide) {
            // 侧视:前腿(行进侧 lx>=24)迈步抬 +st,后腿(背侧)落地 -st;臂反相位;头/身 bob
            if (ly >= 54) {
                if (lx >= 24) ly += st; else ly -= st;  // 前后腿交替
            } else if (ly >= 32 && ly <= 53) {
                ly += -st;                              // 手臂反相位
            } else {
                ly += bobLift;                          // 头/肩/衣身起伏
            }
        } else {
            // 正面/背面:左腿(lx<24)迈步 +st、右腿落地 -st;左右臂反相位;头/身 bob
            if (ly >= 54) {
                if (lx < 24) ly += st; else ly -= st;  // 左右腿交替
            } else if (ly >= 32 && ly <= 53) {
                if (lx < 24) ly += -st; else ly += st; // 左右臂反相位
            } else {
                ly += bobLift;                          // 头/肩/衣身起伏
            }
        }
    }

    if (ly < 0 || ly >= GRID_H) return null;
    const row = grid[ly];
    if (lx < 0 || lx >= row.length) return null;
    return mcColor(row[lx], S, L);
}

// ============================================================
// sprite 调色(tint):参考图 sprite 是固定色板,捏脸选色后按部位替换颜色。
// 部位主色来自参考图提取(skin/hair/shirt/pants/shoes),eyes 不替换(保持深色眼)。
// 替换时按"原像素亮度 / 部位主色亮度"缩放,保留 sprite 明暗层次。
// ============================================================
// 每个部位多色(主色+亮/暗变体)覆盖 sprite 中各层次像素
// 颜色值来自 2026-08-09 用户素材实测（sprite-front/back/side + walk 帧）：
//   skin  [247,205,155] 浅肤  | hair [55,36,21]/[74,46,22]/[100,66,31] 深棕 + [126,82,43] 亮棕发丝
//   shirt [18,43,26] 深绿     | pants [28,48,66] 深蓝
//   shoes [109,66,32]/[39,25,15] 棕 + 深色鞋底
// 注意：hair 加入 [126,82,43]（侧视 sprite 头顶 90% 的亮棕发丝/高光）——
// 若不加，该色距 shoes[0]=[109,66,32] 更近（d²=666 < 距 hair[2] d²=1076），
// 会被判给 shoes 染成鞋色 → 侧面头顶出现"染发"色块（用户反馈）
// hair 注意：移除 [126,82,43]/[120,81,42] 两个亮棕变体——
// 当初为"侧视头顶亮棕发丝"加入，但这两个色与脸颊阴影 [117,75,50] 距离仅 10-13，
// 导致整个脸部（脸颊/眼窝）被判给 hair → 眼睛/脸被染成发色（用户多次反馈）。
// 侧视头顶亮棕发丝已由 nearestPart 的"头发区域色相约束"（ny<0.30 + R>G>B 暖棕范围）解决，
// 无需 MC_PAL 变体。
const MC_PAL = {
    // skin 加暗色变体 [117,75,50]/[120,78,53]/[110,70,45]（脸颊/眼窝阴影）——
    // 这些阴影色距 hair 变体仅 10-13，会被判给 hair → 眼睛/脸颊被染成发色（用户反馈）。
    // 加进 skin 使阴影判给肤色 → 染成玩家肤色的暗部（符合"脸部阴影"语义）
    skin:  [[247, 205, 155], [200, 160, 120], [216, 176, 136], [117, 75, 50], [120, 78, 53]],
    hair:  [[55, 36, 21], [74, 46, 22], [100, 66, 31], [56, 40, 24]],
    shirt: [[18, 43, 26], [20, 45, 24], [24, 56, 24], [40, 80, 40]],
    pants: [[28, 48, 66], [41, 62, 81], [48, 64, 88], [16, 32, 48]],
    shoes: [[109, 66, 32], [39, 25, 15], [120, 67, 25], [136, 88, 48], [72, 43, 22]],
    // eyes 加暗棕变体覆盖眼窝/眉骨深色阴影，使其保留深色而非染成发色
    eyes:  [[28, 24, 20], [50, 35, 25], [45, 30, 22]],
};
const MC_KEYS = Object.keys(MC_PAL);
const _tintCache = new Map();

// 部位判定：用"最近匹配"找像素所属部位，再用位置软约束裁决歧义。
// 核心目标（用户 2026-08-09 明确）：
//   ① 不改 sprite 原图（只换色，不篡改形状/明暗）
//   ② 所有捏脸配色下都不出现杂色
// 设计：
//   - 主判定：最近 MC_PAL 参考色（素材实测色板，见 MC_PAL）
//   - 阈值：bestD < 12000（RGB 距离 < 109.5），远处杂色不染色（保留原像素）
//   - 位置软约束仅处理"明显错位"的歧义：
//       * 头顶（ny<0.55）被判为 shoes → 改判最近的非 shoes 部位（防"头顶鞋色"）
//       * 底部（ny>0.80）被判为 hair → 改判 shoes（防"鞋底变发色"）
//     hair 色 [55,36,21] 与鞋底暗棕 [39,25,15] 接近，无位置约束时随机配色会互相污染
function nearestPart(r, g, b, ny = 0.5, nx = 0.5, face = 'front') {
    let best = null, bestD = 1e9;
    for (const k of MC_KEYS) {
        for (const p of MC_PAL[k]) {
            const d = (p[0] - r) * (p[0] - r) + (p[1] - g) * (p[1] - g) + (p[2] - b) * (p[2] - b);
            if (d < bestD) { bestD = d; best = k; }
        }
    }
    // 眼睛保护（2026-08-09 用户反馈"眼睛像有头发的像素"）：
    // 眼睛/眼窝/眉骨阴影是暖棕深色（R 55-170 暖棕），会命中下方色相约束被强制染成发色，
    // 导致眼睛周围一圈发色（换亮发色时尤其明显）。
    // 在眼睛位置（正面 nx 0.32-0.68 / 侧视 nx>0.68，脸部高度带）内、
    // 距 eyes 色板较近(eyeD<1500≈距离39)的像素改判 eyes——保留深色阴影原色，不染发色。
    // 阈值选 1500：真实刘海/发丝如 [100,66,31] eyeD≈3497 不命中（仍染发色）；
    // 眼窝阴影 [60,40,30] eyeD≈150 命中（保留深色）。
    if (face !== 'back' && ny < 0.30) {
        // 区域收窄到眼睛实际位置（诊断：front 眼睛候选 ny 0.13-0.22 / side nx 0.70-0.92, ny 0.14-0.27）。
        // 太宽会把刘海（ny 0.10-0.16）和后脑头发保护住 → 亮发色下保留深棕块（用户 2026-08-09 反馈）。
        const inZone = face === 'side'
            ? (nx > 0.70 && nx < 0.92 && ny >= 0.14 && ny <= 0.27)
            : (nx >= 0.36 && nx <= 0.64 && ny >= 0.13 && ny <= 0.22);
        if (inZone) {
            let eyeD = 1e9;
            for (const p of MC_PAL.eyes) {
                const d = (p[0] - r) * (p[0] - r) + (p[1] - g) * (p[1] - g) + (p[2] - b) * (p[2] - b);
                if (d < eyeD) eyeD = d;
            }
            // eyeD<500(距离<22)：眼窝阴影 [60,40,30] eyeD≈150 命中；
            // 头发 [74,46,22]（=hair[1]）eyeD≈706 不命中（保留发色染色，避免侧视头发留深棕块）；
            // 刘海 [100,66,31] eyeD≈3497 不命中。
            if (eyeD < 500) return 'eyes';
        }
    }
    // 头发区域色相硬约束（用户 2026-08-09 反馈"侧面头发色差大"）：
    // 头部区域（ny<0.30）内，任何"暖棕发色系"像素（R>G>B，R 55-170，G 38-115，B 8-70）
    // 强制判给 hair。b 下限放宽到 8：深棕发丝 [70,41,14]/[72,43,13]（b=14/13）也能命中，
    // 否则它们被判给 shoes 后被"ny<0.78→null"挡住 → 保留原棕 → "头发上有棕色散块"（用户反馈）。
    // 侧视 sprite 头发高光/发丝颜色范围广（[126,82,43]/[135,89,47]/[70,41,14] 等），
    // 用色相+位置双重约束一网打尽。
    // 诊断数据（2026-08-09）：发色像素集中 0-30%（头发真实区），
    // 30-50% 的"发色像素"是眼睛/脸/袖子被误判——若 ny 放宽到 0.42 会让
    // 眼睛变发色、袖子横截一半被头发影响（用户反馈）。收紧到 0.30。
    // 收紧到 ny<0.22（2026-08-09 修复"待机脖子有头发杂色"）：
    // 诊断数据 front/side 待机帧 ny 0.26-0.30 的脖子/脸颊阴影（#a26843=[162,104,67] 等暖棕）
    // 命中色相约束被染成发色 → 脖子上头发杂色。真正头发集中在头部 0-22%，收紧后脖子区不再强制 hair。
    if (ny < 0.22 && r > g && g > b && r >= 55 && r <= 170 && g >= 38 && g <= 115 && b >= 8 && b <= 70) {
        return 'hair';
    }
    // 头部区域 shoes→hair：仅真正头发带（ny<0.25）才把误判为 shoes 的像素改判 hair。
    // 收紧到 0.25：脖子/衣领区（0.25-0.30）可能有被判给 shoes 的像素，
    // 但那是肩部/衣领过渡区，不该改判头发（用户反馈"脖子到肩膀受头发影响"）。
    if (best === 'shoes' && ny < 0.25) return 'hair';
    // 注：曾加 shirt→hair（ny<0.30）把"头发区绿色像素"改判头发，但误伤脖子衣领
    // （[43,84,40] 等绿色衣服像素，ny 0.25-0.30 的衣领被判给 hair → 脖子到肩膀变发色）。
    // 已删除：头发区真正的杂色已由色相约束（暖棕发色系）覆盖，无需 shirt→hair。
    // 鞋区暖棕硬约束（2026-08-09 用户反馈"东西走鞋子杂色"）：
    // 侧视走路帧鞋面棕调/鞋底深棕被 eyes 暗棕变体([45,30,22]/[50,35,25])
    // 和 skin 暗色变体([117,75,50])吸走 → 眼睛不染色(保留原棕=杂色)、皮肤染成肤色(鞋上肤色斑)。
    // 鞋区(ny>=0.78)任何暖棕(R>G>B)像素强制判给 shoes，染成玩家鞋色。
    // 裤脚是蓝灰(R<B)天然免疫；脚踝亮肤色 R~200+ 不在范围内。
    // 诊断数据：walk-side-f0~f3 鞋区被判给 eyes/skin 的暖棕像素 1028-1977px，98% 在范围内。
    // 下限放宽到 r>=8/g>=4/b>=1：鞋底/鞋缘极暗阴影(#0c0800/#170f03 等 R<20，位于 ny>=0.85 底部)
    // 也要纳入 shoes 染成玩家鞋色暗部，否则换亮鞋色时鞋底保留原黑=杂色。
    // 极暗像素全部 R>G>B 暖棕、位于鞋区底部/边缘，判给 shoes 合理；纯黑描边(r=g=b)天然免疫。
    if (ny >= 0.78 && r > g && g > b && r >= 8 && r <= 180 && g >= 4 && g <= 120 && b >= 1 && b <= 80) {
        return 'shoes';
    }
    // 鞋区中性灰硬约束（2026-08-09 用户反馈"东西走鞋子杂色"补充）：
    // 待机侧视帧 sprite-side.png 鞋后跟/鞋底边缘有中性灰像素(#797e80 等, R≈G≈B 低饱和)，
    // 被判给 skin 暗色变体([120,78,53]) → 染成肤色 = 鞋边缘肤色杂色。
    // 鞋区(ny>=0.78)真正中性灰(三通道两两差<=25, 中高亮度 r>=60)强制判给 shoes。
    // 裤子蓝灰(B 明显高于 R, 如 #6b7d8f 的 B-R=36)因两两差超标而免疫。
    // 诊断数据：sprite-side.png 鞋区 324px 中性灰被 skin 吸走，全部满足该条件。
    if (ny >= 0.78 && r >= 60 && r <= 230 && g >= 55 && g <= 235 && b >= 50 && b <= 230) {
        if (Math.abs(r - g) <= 25 && Math.abs(g - b) <= 25 && Math.abs(r - b) <= 25) return 'shoes';
    }
    if (bestD >= 12000) return null; // 远处杂色不染色
    // shoes 位置硬约束（用户 2026-08-09 明确）：棕色像素只在鞋区（ny>=0.78）才判为 shoes，
    // 其他位置的棕色像素是 sprite 设计层的"杂色"——不染色（保留原色），
    // 避免"裤子上闪棕色杂色"（用户反馈）。这也防止"头顶冒出鞋色"。
    if (best === 'shoes' && ny < 0.78) return null;
    // hair 在底部（ny>0.80）：鞋底暗棕 [39,25,15] 距 hair[0]=[55,36,21] 极近（d²≈540），
    // 随机黑发时鞋底全黑。底部只能是鞋，改判 shoes 保持鞋底可见为玩家色。
    if (best === 'hair' && ny > 0.80) return 'shoes';
    // 脖子/手臂/衣服边缘发色修复（2026-08-09 用户反馈"脖子上有头发、和手相夹的缝隙有头发"）：
    // 诊断数据：走路帧 ny 0.30-0.60 仍有大量像素距离匹配判给 hair——
    //   walk-front-f2 1765px / f3 1529px（样本 #283009/#3c3625 是手臂轮廓/衣服边缘的深绿棕描边），
    //   walk-side-f0~f3 69-245px、walk-back-f0 55px。
    // 这些是脖子阴影、手臂与身体夹缝、衣服边缘的描边色，染成发色=刺眼杂色。
    // 改为保留原色（null）——原图描边色在角色上是自然阴影，不产生"发色块"。
    // 真实垂发如果延伸到 ny 0.30+ 会保留原棕，但相比脖子/手臂染成亮发色的杂色，可接受。
    if (best === 'hair' && ny >= 0.30 && ny <= 0.80) return null;
    // pants 出现在上衣区（ny 0.28-0.55）：衣服阴影 [30,50,69] 与裤子 [28,48,66] 色系相近，
    // 会被误判为 pants → 绿色上衣出现蓝色斑块（用户反馈"袖口贴着的位置有杂色"）。
    // 上衣区必为 shirt（袖口边缘/衣服阴影），改判 shirt。
    if (best === 'pants' && ny >= 0.28 && ny < 0.55) return 'shirt';
    // 2026-08-09 修复"待机头发后面黑黑的一块 + 脖子杂色"：
    // sprite-front.png 中央 x≈0.32 处有一条深蓝色 (R≈0,G≈15,B≈27) 垂直暗线，
    // 实际从肩膀 (ny≈0.55) 延伸到腰/腿 (ny≈0.86)，跨整个身体中部。
    // 这些像素最近色是 eyes (d²≈914)，但不在眼睛保护 inZone 内（nx=0.32<0.36），
    // tintSprite 的 `part==='eyes' continue` 把它们当成眼睛阴影保留原色 → 显示为深蓝黑色。
    // 用户看到的"头发后面黑黑的东西"和"脖子杂色"就是这条线（玩家本体 28 像素高，
    // 头部 ny≈0.0-0.22、脖子 ny≈0.30-0.40 视觉上都能看到深蓝暗线的延续）。
    // 修复：inZone 外的 eyes 最佳匹配不应返回 eyes，按位置改判（头部→hair、脸颈肩→skin、
    // 身体→shirt、腿→pants），让它们被染成玩家对应部位色，消除深蓝黑线。
    // inZone 内真正的眼睛已被眼睛保护提前 return 'eyes'，不受影响。
    // 注意：不能排除 back 方向——back 无眼睛，其后脑勺/脖子深色阴影（最近色 eyes）同样
    // 会保留原色成为杂色（2026-08-09 用户反馈"朝北待机头发后面有杂色"），也要改判对应部位。
    if (best === 'eyes') {
        if (ny < 0.30) return 'hair';
        if (ny >= 0.30 && ny < 0.55) return 'skin';
        if (ny >= 0.55 && ny < 0.78) return 'shirt';
        if (ny >= 0.78 && ny <= 0.95) return 'pants';
        return null;
    }
    return best;
}
function hexRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    const h = hex.replace('#', '');
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// 返回与像素 RGB 距离最近的 MC_PAL 参考色（用于亮度缩放基准）
function nearestPalRef(r, g, b) {
    let best = MC_PAL.skin[0], bestD = 1e9;
    for (const k of MC_KEYS) {
        for (const p of MC_PAL[k]) {
            const d = (p[0] - r) * (p[0] - r) + (p[1] - g) * (p[1] - g) + (p[2] - b) * (p[2] - b);
            if (d < bestD) { bestD = d; best = p; }
        }
    }
    return best;
}
// 返回调色后的 canvas(per img+look 缓存);look 缺失或 img 不可用时返回原 img
// 性能优化:先缩放到 0.25x(原图 749×1846 → 187×461 ≈ 8 万像素),再 tint,几 ms 完成
// (原图逐像素 tint 138 万像素需 500ms+);缩放后细节通过 nearest drawImage 还原
export function tintSprite(img, look) {
    if (!img || !look || typeof Image === 'undefined') return img;
    const L = look;
    const lookKey = [L.skin, L.hair, L.shirt, L.pants, L.shoes].join('|');
    const key = (img._tintBase || img.src || String(img.width)) + '|' + lookKey;
    const hit = _tintCache.get(key);
    if (hit) return hit;
    const TINT_SCALE = 1; // 2026-08-08 23:25 原图逐像素 tint（之前 0.25 让像素混合失真，nearestPart 误判产生粒子）；
                          // 性能靠 _tintCache 缓存（每 img+look 组合只跑一次），之后命中 0ms
    const sw = Math.max(2, Math.round(img.width * TINT_SCALE));
    const sh = Math.max(2, Math.round(img.height * TINT_SCALE));
    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, sw, sh);
    const id = ctx.getImageData(0, 0, sw, sh);
    const d = id.data;
    // 注：曾用 maskIsolatedPixels 把"飞起来的孤立小块"mask 透明，但会误伤头发细发丝
    // （<4px 连通块被透明化）→ 渲染露出"头皮/肉色像素"（用户 2026-08-09 反馈"头发走着走着头皮露出来"）。
    // 头顶杂色已由 nearestPart 的"头发区域色相硬约束"解决（棕块被染成发色），
    // 不再需要 mask 孤立块——保留全部不透明像素，保证完整头发。
    // 像素纵向位置（相对 bbox，0=顶 1=底）：供 nearestPart 位置软约束使用
    const bb = getSpriteBBox(img);
    const bbH = Math.max(1, bb.h);
    const bbW = Math.max(1, bb.w);
    // 方向（用于眼睛保护：正面眼睛在中央、侧视眼睛在脸侧/后脑无眼睛）
    const src = img.src || img._tintBase || '';
    const face = /(^|[/_])side([/_.]|$)/.test(src) ? 'side' : (/(^|[/_])back([/_.]|$)/.test(src) ? 'back' : 'front');
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const idx = i / 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const ny = ((idx / sw | 0) - bb.y) / bbH;
        const nx = ((idx % sw | 0) - bb.x) / bbW;
        const part = nearestPart(r, g, b, ny, nx, face);
        if (!part || part === 'eyes') continue; // 眼睛/深阴影保持原色
        const t = hexRgb(L[part]);
        if (!t) continue;
        // 用"该像素最近匹配的参考色"做亮度基准，保留原图明暗层次：
        // f = 原像素亮度 / 匹配参考色亮度 → 染成玩家色后明暗层次与素材一致
        const base = nearestPalRef(r, g, b);
        const baseLum = (base[0] * 0.299 + base[1] * 0.587 + base[2] * 0.114);
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        const f = baseLum > 1 ? lum / baseLum : 1;
        d[i] = Math.max(0, Math.min(255, Math.round(t[0] * f)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(t[1] * f)));
        d[i + 2] = Math.max(0, Math.min(255, Math.round(t[2] * f)));
    }
    ctx.putImageData(id, 0, 0);
    if (_tintCache.size < 200) _tintCache.set(key, cv);
    return cv;
}

// 角色渲染:参考图 1:1 sprite(走路 4 帧平移动画;染病态逐像素侵蚀)
// 尺寸:与普通僵尸体量相当(僵尸 28×36 = 1008px²;玩家统一高 48px,宽度按 sprite 比例,
//       front≈20px 宽 → 面积≈960px² ≈ 僵尸体量,视觉上"一样大"且不细弱)
// 待机动画（2026-08-08）：角色不透明像素 bbox，用于上下身分割
const _bboxCache = new Map();
function getSpriteBBox(img) {
    if (!img) return { x: 0, y: 0, w: 1, h: 1 };
    const key = img;
    if (_bboxCache.has(key)) return _bboxCache.get(key);
    let mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1;
    try {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] > 40) {
                if (x < mnx) mnx = x; if (x > mxx) mxx = x;
                if (y < mny) mny = y; if (y > mxy) mxy = y;
            }
        }
    } catch (e) { /* 拿不到像素回退全图 */ }
    const b = (mnx === 1e9) ? { x: 0, y: 0, w: img.width, h: img.height } : { x: mnx, y: mny, w: mxx - mnx + 1, h: mxy - mny + 1 };
    if (_bboxCache.size < 500) _bboxCache.set(key, b);
    return b;
}

// NPC 名牌 Y 坐标（相对脚底 sy 的偏移）：用角色精灵"内容 bbox 顶边"定位，确保名牌
// 悬浮在渲染小人上方，而不压到小人身上（sprite 含大片透明留白，按整图算会错位）。
function npcNameplateY(n) {
    const dir = n._animDir || 'down';
    const sprKey = dir === 'up' ? 'back' : (dir === 'left' || dir === 'right') ? 'side' : 'front';
    const img = _mcSprites[sprKey] || _mcSprites['front'];
    const H = 48;   // 与 drawPixelPlayerBody 的 TARGET_H 一致
    if (!img || !img.height) return -(H / 2 + 20);   // 兜底：sy - 44
    const scale = H / img.height;
    const bb = getSpriteBBox(img);
    const topInRender = (bb.y || 0) * scale;   // 内容顶边在渲染框内距顶部的像素
    return -(H - topInRender + 8);             // 内容顶边再上移 8px 作为名牌中心
}

export function drawPixelPlayerBody(ctx, sx, sy, color = '#39d98a', infection, look, anim) {
    const level = (infection || 0) / 100;
    const a = anim || {};
    const moving = !!(a.moving);
    const dir = a.dir;
    const sprKey = dir === 'up' ? 'back' : (dir === 'left' || dir === 'right') ? 'side' : 'front';
    // 走路时按 anim.frame 选 walk 帧（精确像素平移动画）
    // side 走路 = 用户给的朝东 4 帧动画按 1→2→3→4 循环（f0/f1/f2/f3 加载时各自镜像）：
    //   frame % 4 → 0/1/2/3 = _mcWalk.side[0/1/2/3]
    // 朝东=渲染层整体镜像（显示原图）、朝西=不镜像（显示镜像图）——镜像顺序一致
    let img = _mcSprites[sprKey];
    let idleAnim = false;   // 待机动画标记（渲染层动态：上半身浮动 ±1px，腿固定）
    if (moving && a.frame != null) {
        if (sprKey === 'side') {
            const fi = a.frame % 4;
            if (_mcWalk.side[fi]) img = _mcWalk.side[fi];
        } else if (sprKey === 'back') {
            // 2026-08-09 用户确认：没有为向北（back）行走做走路帧动画。
            // 原逻辑切 walk-back-f0~f3 多帧（各帧形状/尺寸不同）→ 行走时"一大一小"跳变、
            // 左手缩放不对称。向北行走/待机统一用 sprite-back 单图 + 呼吸浮动
            // （行走时呼吸略快、待机略慢），不再切换走路帧。
            idleAnim = true;   // 呼吸浮动标记（下方按 moving 区分频率）
        } else if (_mcWalk[sprKey][a.frame]) {
            img = _mcWalk[sprKey][a.frame];
        }
    } else if (!moving && !a.frame) {
        // 待机动画（2026-08-08 20:43 用户确认）：10fps 上半身像素浮动 ±1px、腿固定、
        // 画框不动。用渲染层动态实现（浮动在渲染像素级，肉眼可见）。
        idleAnim = true;
    }
    if (!img) return; // sprite 未加载完,跳过本帧
    // 捏脸调色：仅当玩家在捏脸界面设置了 shirt（明确换衣色）才 tint；
    // 否则（默认外观/用户自定义 sprite）直接用原图，避免 tint 缩小 4x 造成细节丢失（2026-08-08 用户反馈"像素点缺失"）
    if (look && look.shirt) img = tintSprite(img, look);
    const w = img.width, h = img.height;
    const TARGET_H = 48; // 玩家渲染高度(面积≈僵尸体量)
    const scale = TARGET_H / h;
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    const dx = Math.round(sx - dw / 2), dy = Math.round(sy - dh);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (dir === 'right') { // 用户 sprite-side 全是朝西视角图（脸朝左），朝西=不镜像显示原图，朝东=水平镜像显示反向
        ctx.translate(sx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-sx, 0);
    }
    if (level <= 0.01) {
        if (idleAnim) {
            // 待机/单图呼吸动画：上半身（bbox 上部 72%）平滑浮动 ±1px，腿（底部 28%）固定
            // 2026-08-08 21:05 用户反馈修正：
            //   ① 呼吸频率调慢：sin 平滑 0.6Hz（周期 ~1.6s），不再 10fps 急促
            //   ② 上下身 1px 重叠（源多取 1px），消除浮动时双腿之间像素断裂
            // 2026-08-09 用户要求（向北无走路帧）：行走时呼吸略快（0.9Hz）、待机略慢（0.6Hz）
            const bb = getSpriteBBox(img);
            if (bb.w > 0 && bb.h > 0) {
                const bob = Math.round(Math.sin(performance.now() / 1000 * Math.PI * (moving ? 1.8 : 1.2)));   // 走 0.9Hz / 待机 0.6Hz
                const upperFrac = 0.78;   // 上半身 78%（含整个裤子+裆部），分割线远离裆部避免 bob 经过深色裤缝
                const upperSrcH = Math.round(bb.h * upperFrac);
                const legSrcH = bb.h - upperSrcH;
                const upperDh = Math.round(dh * upperFrac);
                const legDh = dh - upperDh;
                // 腿（固定；源从分割线 -1 多取 1px，与上半身重叠 1px 防断裂）
                ctx.drawImage(img, 0, bb.y + upperSrcH - 1, w, legSrcH + 1, dx, dy + upperDh - 1, dw, legDh + 1);
                // 上半身（y 浮动 bob，重叠覆盖腿顶部）
                ctx.drawImage(img, 0, bb.y, w, upperSrcH, dx, dy + bob, dw, upperDh);
            } else {
                ctx.drawImage(img, dx, dy, dw, dh);
            }
        } else {
            ctx.drawImage(img, dx, dy, dw, dh);
        }
        ctx.restore();
        return;
    }
    // 染病:读 sprite 像素逐像素侵蚀(边缘 peel + 人字浮现)
    const cv = makeOffscreen(w, h);
    const octx = cv.getContext('2d');
    octx.drawImage(img, 0, 0);
    const imgData = octx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const textPixels = getTextSet('人', w, h, 1, 0);
    const transitionColor = '#4a5a50', textColor = '#a0b8a8';
    const seed = 0x91D7;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        if (d[i + 3] === 0) continue;
        const edge = Math.min(px / (w - 1), (w - 1 - px) / (w - 1),
            py / (h - 1), (h - 1 - py) / (h - 1));
        const noise = hash2(seed ^ 0x51A9, px, py);
        const peelAt = .04 + edge * 1.24 + noise * .36;
        const frontier = .06;
        if (level >= peelAt - frontier) {
            const isText = textPixels.has(px * 100 + py);
            if (level < peelAt) {
                const t = (level - (peelAt - frontier)) / frontier;
                const rgb = mixHexColor('#' + hex2(d[i]) + hex2(d[i + 1]) + hex2(d[i + 2]), transitionColor, t);
                d[i] = parseInt(rgb.slice(1, 3), 16); d[i + 1] = parseInt(rgb.slice(3, 5), 16); d[i + 2] = parseInt(rgb.slice(5, 7), 16);
            } else if (isText) {
                d[i] = 0xa0; d[i + 1] = 0xb8; d[i + 2] = 0xa8;
            } else {
                d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
            }
        }
    }
    octx.putImageData(imgData, 0, 0);
    ctx.drawImage(cv, dx, dy, dw, dh);
    ctx.restore();
}

function hex2(v) { return (v < 16 ? '0' : '') + v.toString(16); }

function plantBodyColorAt(px, py, color, sunflower) {
    let c = null;
    if (px >= 12 && px < 16 && py >= 17 && py < 30) c = '#395f35';
    if (px >= 5 && px < 13 && py >= 21 && py < 26) c = '#4f7d43';
    if (px >= 16 && px < 24 && py >= 18 && py < 23) c = '#4f7d43';
    if (sunflower) {
        if (px >= 8 && px < 20 && py >= 3 && py < 7) c = '#c89f39';
        if (px >= 5 && px < 23 && py >= 7 && py < 16) c = '#c89f39';
        if (px >= 8 && px < 20 && py >= 16 && py < 19) c = '#c89f39';
        if (px >= 9 && px < 19 && py >= 7 && py < 16) c = '#65462c';
    } else {
        if (px >= 7 && px < 22 && py >= 3 && py < 17) c = color || '#55a54d';
        if (px >= 18 && px < 26 && py >= 7 && py < 13) c = color || '#55a54d';
        if (px >= 10 && px < 13 && py >= 7 && py < 10) c = '#2c452b';
    }
    return c;
}

function drawPixelPlantBody(ctx, sx, sy, color, name) {
    const x = Math.round(sx - 14), y = Math.round(sy - 16);
    const sunflower = name && name.includes('向日葵');
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const width = 28, height = 30;
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const c = plantBodyColorAt(px, py, color, sunflower);
        if (c) { ctx.fillStyle = c; ctx.fillRect(x + px, y + py, 1, 1); }
    }
    ctx.restore();
}

export function draw(ctx, sv) {
    if (!ctx) return;
    _worldSeed = sv.world ? sv.world.seed : _worldSeed;
    const W = 960, H = 540;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (sv.interior) {
        drawInterior(ctx, sv, W, H);
    } else {
        // 饥饿晕眩：镜头轻微摇摆（眩晕感），只作用于世界层
        const shake = hungerShake(sv);
        // 镜头跟随玩家（无限地图无边界钳制），存档供鼠标→世界坐标换算
        sv.camX = sv.px - W / 2 + shake.x;
        sv.camY = sv.py - H / 2 + shake.y;
        const camX = sv.camX, camY = sv.camY;

        // 2026-08-09 用户要求"草在地面之上、物体之下、不长到人行道"：
        // 草层插入 drawWorld 内部——先画地面层（静态草底），再画动态草，最后画物体层
        // （树/箱/车/建筑等盖过草）。草只长在 GROUND/WEED（grassRenderLayer 内部已过滤）。
        drawWorld(ctx, sv, camX, camY, W, H);
        drawCampFlag(ctx, sv, camX, camY);
        drawDrops(ctx, sv, camX, camY);
        drawZombies(ctx, sv, camX, camY);
        drawNpcs(ctx, sv, camX, camY, W, H);
        drawBullets(ctx, sv, camX, camY);
        if (sv.driving) {
            // 驾驶中：渲染汽车本体（车中心即玩家位置），不再画玩家小人；车顶按座位画人
            const d = sv.driving;
            const npcList = sv.npcs || [];
            const driverNpc = d.driver ? npcList.find(n => n.id === d.driver) : null;
            const frontNpc = sv.controllerId ? npcList.find(n => n.id === sv.controllerId) : null;
            drawCar(ctx, d.x - TS - camX, d.y - TS / 2 - camY, d.dir, {
                wreck: false, repaired: true, cond: 'intact',
                near: false, now: sv.now, seed: 0, infection: 0,
                driverNpc, frontNpc,
                passengers: npcList.filter(n => n.alive && n.riding),
            });
            if (sv.p2s && Object.keys(sv.p2s).length) { for (const pp of Object.values(sv.p2s)) drawRemotePlayer(ctx, sv, camX, camY, pp); }   // 3+ 人：全部队友
            else if (sv.p2) drawRemotePlayer(ctx, sv, camX, camY);   // 联机：开车时也渲染远端队友
        } else {
            drawPlayer(ctx, sv, camX, camY);
            if (sv.p2s && Object.keys(sv.p2s).length) { for (const pp of Object.values(sv.p2s)) drawRemotePlayer(ctx, sv, camX, camY, pp); }   // 3+ 人：全部队友
            else if (sv.p2) drawRemotePlayer(ctx, sv, camX, camY);   // 联机：远端队友
        }
        drawEffects(ctx, sv, camX, camY);
        drawBuildTarget(ctx, sv, camX, camY);
        drawDayNight(ctx, sv, W, H, false);
        drawWeatherOverlay(ctx, sv, W, H, camX, camY);      // 天气氛围（沙色/雾/冷调，呼吸动态）
        drawWeatherParticles(ctx, sv, W, H, camX, camY);    // 天气粒子（雨丝/雪花/飞沙，世界坐标随相机）
        drawThunder(ctx, sv, W, H);                         // 雷阵雨闪电+闪光（确定性触发，双端同刻）
        drawEventOverlay(ctx, sv, W, H);        // 随机事件暗角（停电夜深蓝）
        drawSquatOverlay(ctx, sv, W, H);        // 2026-08-10 Ctrl 蹲下：暗色遮罩（潜伏感）
        drawInfectionOverlay(ctx, sv, W, H);    // 感染侵蚀覆盖层（阶段越高越明显）
        drawSickVignette(ctx, sv, W, H);
        drawHUD(ctx, sv, W, H);
        drawDriveHUD(ctx, sv, W);
        drawTeamPanel(ctx, sv, W, H);
        // 2026-08-11 v2.97 修复"本地 NPC 队友无远处指引"：此前整个指引块被包在
        // `sv.p2 || sv.zombies.some(isPlayerZombie) || _legacyDrop` 条件里——若玩家只有本地
        // NPC 队友（无联机队友/尸化自己/遗物），drawMateGuide 永不执行（室内却是无条件调用，
        // 导致室内外不一致）。改为：本地队友指引独立于该条件，只要有存活 party 队友就画。
        {
            const guideDrawn = [];
            drawMateGuide(ctx, sv, W, H, guideDrawn);           // 本地 NPC 队友：屏幕外显示指向箭头+名字+距离（2026-08-11）
        }
        if (sv.p2 || (sv.p2s && Object.keys(sv.p2s).length) || sv.zombies.some(z => z.isPlayerZombie) || (sv._legacyDrop)) {
            // 指引指示器共享错位数组：队友 + 尸化的自己 + 遗物包裹 同边缘自动错开不重叠
            const guideDrawn = [];
            if (sv.p2 || (sv.p2s && Object.keys(sv.p2s).length)) drawP2Guide(ctx, sv, W, H, guideDrawn);
            drawPlayerZombieGuide(ctx, sv, W, H, guideDrawn);   // 尸化的自己：寻回装备/曾经的你
            drawLegacyDropGuide(ctx, sv, W, H, guideDrawn);     // 遗物包裹：正常模式队友救回后留下的行李
        }
        if (sv.build) drawBuildBar(ctx, sv, W, H);
        else drawHotbar(ctx, sv, W, H);
    }
    // 2026-08-11 尸体搜索已复用容器 WSearch 界面（面板逐件渐亮），无独立读条进度条
    // 饥饿光晕（室内外通用，盖在最上层）：昏黄呼吸光 + 边缘暗角，模拟快晕倒的眩晕感
    drawStarveVignette(ctx, sv, W, H);
    // 2026-08-09 昏迷苏醒过渡：黑灰眨眼几次（像素氛围），期间叠加"荒野中醒来"字样
    drawWakeOverlay(ctx, sv, W, H);
}

// 昏迷苏醒：从"模模糊糊昏暗"逐渐"明亮清晰"（单调变亮，不再中途变暗），
// 配合开场视线模糊（blur）与灰雾，睁眼般越来越清楚；配合移动锁定更代入感。
// easeOutCubic 后半段更快的"睁眼"感。
function easeOutCubic(x) { const t = clamp(x, 0, 1) - 1; return 1 + t * t * t; }
let _wakeOC = null;   // 离屏画布（用于模糊重绘当前画面）
function drawWakeOverlay(ctx, sv, W, H) {
    const wk = sv._wake;
    if (!wk || wk.t >= wk.dur) return;
    const t = wk.t, dur = wk.dur;
    const prog = clamp(t / dur, 0, 1);
    const a = 1 - easeOutCubic(prog);      // 暗度：1→0 单调变亮（无中间变暗）
    const blurPx = 5 * (1 - prog);         // 开场模糊 → 越来越清晰
    const veil = 0.5 * (1 - prog);         // 灰雾（昏暗看不清）→ 清明
    if (a <= 0.01 && blurPx <= 0.3 && veil <= 0.01) return;
    // 1) 视线模糊：把当前画面拷到离屏再模糊重绘（保持背景活动，只做视觉模糊）
    if (blurPx > 0.3) {
        if (!_wakeOC) _wakeOC = document.createElement('canvas');
        _wakeOC.width = W; _wakeOC.height = H;
        _wakeOC.getContext('2d').drawImage(ctx.canvas, 0, 0, W, H);
        ctx.save();
        ctx.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
        ctx.drawImage(_wakeOC, 0, 0, W, H, 0, 0, W, H);
        ctx.filter = 'none';
        ctx.restore();
    }
    // 2) 暗度蒙层（单调变亮）
    if (a > 0.01) {
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }
    // 3) 灰雾（模糊昏暗的"看不清"感），逐渐清明
    if (veil > 0.01) {
        ctx.save();
        ctx.globalAlpha = clamp(veil, 0, 1);
        ctx.fillStyle = '#262b36';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }
    // 4) 苏醒文字：睁眼前半段浮现、持续、结尾淡出
    const ta = prog < 0.4 ? prog / 0.4 : (prog < 0.82 ? 1 : clamp((1 - prog) / 0.18, 0, 1));
    if (ta > 0.02) {
        const wob = Math.round(Math.sin(sv.now * 1.5) * 1);
        ctx.save();
        ctx.globalAlpha = ta;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 20px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#B8C6D6';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 8;
        ctx.fillText('你在荒野中醒来…', W / 2 + wob, H * 0.42);
        ctx.restore();
    }
}

// ---------- 昼夜系统（1 现实小时 = 1 游戏天，DAY_LEN=3600s） ----------
// 6:00-18:00 白天；18:00-20:00 黄昏渐暗；20:00-4:00 深夜全暗；4:00-6:00 黎明渐亮。
// 与既有玩法一致：20:00 起尸潮开场、夜间僵尸变强（wbalance HORDE_START_HOUR / Z_NIGHT_STRENGTH_MUL）。
function dayNightAlpha(sv) {
    const hour = (sv.t / sv.dayLen) * 24;
    const smooth = x => x * x * (3 - 2 * x);
    if (hour >= 6 && hour < 18) return 0;
    if (hour >= 4 && hour < 6) return 1 - smooth((hour - 4) / 2);
    if (hour >= 18 && hour < 20) return smooth((hour - 18) / 2);
    return 1;
}
function drawDayNight(ctx, sv, W, H, interior) {
    if (sv._devGfx === 0) return;   // 低画质：跳过夜晚暗色覆盖层（氛围降级，省一次全屏 fillRect）
    const a = dayNightAlpha(sv);
    if (a <= 0) return;
    // 停电夜事件（D）：暗色加强 1.5x（视野受限感）
    const blackout = sv._evt && sv._evt.type === 'blackout' ? 1.5 : 1;
    const alpha = 0.58 * a * (interior ? 0.5 : 1) * blackout;
    ctx.fillStyle = `rgba(8,12,30,${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
}

// ---------- 随机事件氛围覆盖层（D）：停电夜暗角（沙尘暴已并入天气系统） ----------
function drawEventOverlay(ctx, sv, W, H) {
    if (!sv._evt) return;
    if (sv._evt.type === 'blackout') {
        // 停电：四周更暗的窄视（加深边缘）
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.9);
        g.addColorStop(0, 'rgba(0,0,20,0)');
        g.addColorStop(1, 'rgba(0,0,20,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }
}

// ---------- Ctrl 蹲下覆盖层（2026-08-10）：暗色遮罩 + 底部"蹲伏中"提示（潜伏感） ----------
function drawSquatOverlay(ctx, sv, W, H) {
    if (!sv.squatting) return;
    ctx.save();
    // 半透明暗色遮罩：压低画面亮度制造潜伏氛围（不阻断操作）
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // 底部提示
    ctx.save();
    ctx.font = '12px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('蹲伏中（潜伏）', W / 2, H - 10);
    ctx.restore();
}

// ---------- 天气氛围覆盖层：沙尘暴沙色 / 大雾弥漫 / 雨雪冷调（呼吸动态 × 强度 mul） ----------
// 覆盖层是全屏均匀层（雾/色调不随世界滚动——无移动感知差异，符合"天气不随玩家移动变化"）
function drawWeatherOverlay(ctx, sv, W, H) {
    const wx = wxInfo(sv._weather);
    if (wx.particles === 0) return;   // 晴朗无覆盖
    const level = wxLevelCur(sv);
    const inten = wxIntensity(sv._weather, level);
    const mul = inten.mul;
    const breathe = 0.5 + 0.5 * Math.sin(sv.now * 1.6);
    if (sv._weather === 'sandstorm') {
        // 沙色呼吸暗角 × 强度
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
        g.addColorStop(0, 'rgba(150,110,40,0)');
        g.addColorStop(1, `rgba(150,110,40,${((0.18 + 0.10 * breathe) * mul).toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    } else if (sv._weather === 'fog') {
        // 2026-08-09 用户要求：大雾复用"荒野中醒来"的模糊+灰雾效果（渐变的看不清，无圆环）。
        // 原径向渐变以屏幕中心为圆心，边缘有明显圆形边界；改为全屏轻微 blur（越浓越糊）
        // + 均匀灰雾蒙层（呼吸微动），画面整体"渐变的看不清"，无任何可见圆圈。
        const blurPx = 0.8 + 1.8 * mul;   // 雾越浓越模糊（薄雾 ~1.2px / 浓雾 ~2.6px）
        const veilA = Math.min(0.8, (0.20 + 0.07 * breathe) * Math.max(0.6, mul) * 1.5);
        if (blurPx > 0.3) {
            if (!_wakeOC) _wakeOC = document.createElement('canvas');
            _wakeOC.width = W; _wakeOC.height = H;
            _wakeOC.getContext('2d').drawImage(ctx.canvas, 0, 0, W, H);
            ctx.save();
            ctx.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
            ctx.drawImage(_wakeOC, 0, 0, W, H, 0, 0, W, H);
            ctx.filter = 'none';
            ctx.restore();
        }
        // 均匀灰雾：整屏蒙层让视野"雾蒙蒙看不清"，渐变感由 blur 提供，无硬边圆圈
        ctx.save();
        ctx.globalAlpha = Math.max(0.03, Math.min(0.8, veilA));
        ctx.fillStyle = '#c8d2da';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    } else if (sv._weather === 'rain' || sv._weather === 'snow') {
        // 雨雪天色偏冷：冷调 × 强度（暴雨更冷、小雪更淡）
        ctx.fillStyle = sv._weather === 'rain'
            ? `rgba(90,120,160,${((0.06 + 0.03 * breathe) * mul).toFixed(3)})`
            : `rgba(205,222,240,${((0.05 + 0.03 * breathe) * mul).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
    }
}

// ---------- 天气粒子层（雨丝 / 雪花 / 飞沙）：世界坐标固定池，随相机滚动 ----------
// 粒子存【世界坐标】→ 渲染时减相机：玩家移动时粒子相对地面垂直下落，感知速度不变
// （修复：原屏幕空间粒子在玩家移动时相对世界反向飘，造成"往下走雨变快"的错觉）。
// 强度只影响粒子密度（× inten.density），【速度分布不随强度变】——用户明确要求。
// 粒子是运行时表现类（§13.2 允许 Math.random：不影响世界/存档/结算），不序列化。
const WX_PART_MAX = 300;   // 含暴雨密度 2.3 上限（140×2.3=322 → cap 300）
let wxParticles = null;
function ensureWxParticles() {
    if (!wxParticles) {
        wxParticles = [];
        for (let i = 0; i < WX_PART_MAX; i++) wxParticles.push({ x: 0, y: 0, spd: 0, len: 3, seed: 0, kind: 0 });
        // spd=0 & kind=0 → 首帧 move 循环触发重置（§7 正确性兜底）
    }
    return wxParticles;
}
// 重置天气粒子（重生时调用）：
// 粒子是【世界坐标】固定池，玩家位置从死亡点瞬移到重生点 → 旧粒子留在远端全部越界被丢弃，
// 顶部边界补充需要 1~2 秒才能填满全屏，视觉上"先稀疏后变密"。
// 这里把所有粒子的 kind 清零 → 下一帧 drawWeatherParticles 触发「全屏均匀撒点」分支，
// 重生瞬间全屏均匀，无"先稀后密"的过渡。
export function resetWeatherParticles() {
    if (!wxParticles) return;
    for (let i = 0; i < wxParticles.length; i++) wxParticles[i].kind = 0;
    // spd 也清零，强制下一帧重新初始化速度（避免旧速度残留在新坐标产生奇怪轨迹）
    for (let i = 0; i < wxParticles.length; i++) wxParticles[i].spd = 0;
}
function drawWeatherParticles(ctx, sv, W, H, camX, camY) {
    const wx = wxInfo(sv._weather);
    if (wx.particles === 0 || wx.particles === 3) return;   // 雾用覆盖层，无粒子
    if (sv._devGfx === 0) return;   // 低画质：跳过粒子（§7 性能降级）
    const parts = ensureWxParticles();
    const level = wxLevelCur(sv);
    const inten = wxIntensity(sv._weather, level);
    const densityMul = inten.density;   // 强度 → 疏密（不改变速度）
    const partKind = wx.particles * 10 + level;   // 类型+强度组合 → 切换强度也重置粒子（否则旧速度残留，用户反馈"强度切换视觉无差异"）
    const n = Math.min(WX_PART_MAX, Math.floor(WX_PART_MAX * (sv._devGfx === 2 ? 1 : 0.6) * densityMul));
    // 帧间隔（封顶防跳帧）：粒子用现实秒驱动，暂停时静止
    const nowMs = performance.now();
    const fdt = Math.min(0.05, (nowMs - (sv._wxPartT || nowMs)) / 1000);
    sv._wxPartT = nowMs;

    // ---------- 风向系统（2026-08-09）----------
    // 风向 = 世界每天确定性的 windDirAt(seed, day)（§13.2：world 态禁随机）。
    // 风向只影响粒子【视觉】（倾斜角 + 水平漂移），不影响逻辑/存档/结算。
    // 水平分量 windH = cos(wd)：
    //   东风（wd≈0°）→ windH≈+1 → 雨向右倾斜；西风（wd≈180°）→ windH≈-1 → 雨向左倾斜；
    //   南风（wd≈90°）/北风（wd≈270°）→ windH≈0 → 垂直下落，无水平偏移（符合"南风正常、北风没效果"）。
    // 垂直分量 windV = sin(wd) 只影响玩家被风吹（已在 updateWind 处理），不影响粒子水平倾斜。
    // 风向（2026-08-09 开发者模式可覆盖）：sv._devWind（弧度）为开发者测试风向；
    // 否则用随游戏小时变化的 windDirAtHour（风向不是一成不变，§13.2 确定性双端一致）
    const wd = sv._devWind != null ? sv._devWind : windDirAtHour(sv.world.seed, sv.day, (sv.t / sv.dayLen) * 24);
    const windH = Math.cos(wd);
    ctx.save();
    // 重生策略（双轨）：
    // ① 切换天气/初始化（kind 变）→ 撒全屏：切换瞬间立即全屏均匀（无"只有顶部"）；
    // ② 越界（稳态）→ 顶部边界进入：持续从顶部补充 → 稳态各高度密度 = 流量/速度恒定，
    //    顶部永远有雨（修复"全屏随机重生"稳态密度 ∝ y 线性递增 → 顶部空/底部密）。
    // 2026-08-09 修复"右侧无雨"：原固定向左漂移 0.28 → 右侧列粒子下落时左移出列，
    //    又未越界（x 仍在屏内）→ 右端底部长期空白（CDP 实测最右列密度仅最左列的 1/9）。
    //    现生成带按风向加宽 [camX-|windShift|, camX+W+|windShift|]，漂移后仍覆盖全屏；
    //    且风向为 0（南北风）时无水平漂移，全屏自然均匀。
    const colsOf = (i, n, W2, H2) => {
        const cols = Math.max(6, Math.ceil(Math.sqrt(n * W2 / Math.max(1, H2))));
        return { gx: i % cols, cols };
    };
    // 生成 x 覆盖全屏 + 向漂移【反方向】延伸（保证漂移后仍全屏均匀，无"右侧无雨"）：
    // 东风（windH>0，粒子向右漂）→ 左端粒子漂走 → 需向【左】延伸生成（genXMin 左移）；
    // 西风（windH<0，粒子向左漂）→ 右端粒子漂走 → 需向【右】延伸生成（genXSpan 加宽向右）。
    // 统一：x 落在 [camX - max(0, windH)*shiftW, camX - max(0, windH)*shiftW + W + shiftW]
    //       = [camX - max(0,windH)*shiftW, camX + W + max(0,-windH)*shiftW]
    const shiftW = Math.abs(windH) * 0.28 * H;   // 全屏单方向漂移量
    const genXMin = camX - Math.max(0, windH) * shiftW;
    const genXSpan = W + shiftW;   // 覆盖全屏 + 漂移方向的余量
    const genTop = (p, c, W, H, camX) => {
        p.x = genXMin + (c.gx + 0.5) * (genXSpan / c.cols) + (Math.random() - 0.5) * 20;
        p.y = camY - 30 - Math.random() * 50;   // 顶部边界上方进入
    };
    const genFull = (p, c, W, H, camX, camY) => {
        p.x = genXMin + (c.gx + 0.5) * (genXSpan / c.cols) + (Math.random() - 0.5) * 20;
        p.y = camY + Math.random() * H;
    };
    if (wx.particles === 1) {   // 雨：斜线下落，倾斜角由风向决定；世界坐标；速度/长度/粗细随强度
        ctx.strokeStyle = 'rgba(140,180,220,0.55)';
        ctx.lineWidth = 0.8 + level * 0.16;   // 雨丝粗细随强度（小雨 0.8 / 雷阵雨 1.6）
        const hspd = windH * WX_PART_SPEED.rain * 0.28;   // 水平漂移速度（风向×基准侧风系数）
        for (let i = 0; i < n; i++) {
            const p = parts[i];
            if (p.kind !== partKind || !p.spd) {
                const c = colsOf(i, n, genXSpan, H);
                genFull(p, c, W, H, camX, camY);
                p.spd = WX_PART_SPEED.rain * wxSpeedMul(sv._weather, level) * (0.94 + Math.random() * 0.12);
                const sm = wxSpeedMul(sv._weather, level); p.len = (6 + Math.random() * 9) * sm;
                p.kind = partKind;
            } else if (p.y > camY + H + 30 || p.y < camY - 90 || p.x < camX - 60 || p.x > camX + W + 60) {
                const c = colsOf(i, n, genXSpan, H);
                genTop(p, c, W, H, camX);
            }
            p.y += p.spd * fdt;
            p.x += hspd * fdt;   // 风向水平漂移（东风向右、西风向左、南北风≈0）
            const sx = p.x - camX, sy = p.y - camY;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - windH * p.len * 0.28, sy - p.len);
            ctx.stroke();
        }
    } else if (wx.particles === 2) {   // 雪：慢速飘落小点 + 左右摇摆 + 风向偏移；速度/大小随强度
        ctx.fillStyle = 'rgba(238,246,255,0.85)';
        const pSize = 1.5 + level * 0.5;
        const hspd = windH * WX_PART_SPEED.snow * 0.6;   // 雪更缓 → 风向水平占比略大
        for (let i = 0; i < n; i++) {
            const p = parts[i];
            if (p.kind !== partKind || !p.spd) {
                const c = colsOf(i, n, genXSpan, H);
                genFull(p, c, W, H, camX, camY);
                p.spd = WX_PART_SPEED.snow * wxSpeedMul(sv._weather, level) * (0.94 + Math.random() * 0.12);
                p.seed = Math.random() * 6.28;
                p.kind = partKind;
            } else if (p.y > camY + H + 30 || p.y < camY - 90 || p.x < camX - 40 || p.x > camX + W + 40) {
                const c = colsOf(i, n, genXSpan, H);
                genTop(p, c, W, H, camX);
            }
            p.y += p.spd * fdt;
            p.x += hspd * fdt + Math.sin(sv.now * 1.2 + p.seed) * 16 * fdt;   // 风向偏移 + 原有左右摇摆
            ctx.fillRect(p.x - camX, p.y - camY, pSize, pSize);
        }
    } else if (wx.particles === 4) {   // 沙尘：横向飞沙，风向主导方向（原随机左右 → 单一风向）；速度/长度/粗细随强度
        ctx.strokeStyle = 'rgba(205,175,115,0.5)';
        ctx.lineWidth = 0.8 + level * 0.2;
        // 沙尘主要受风向水平分量驱动：风向越偏横向越强；南北风时沙尘缓慢飘落
        const sandH = windH * WX_PART_SPEED.sand;
        const sandV = Math.abs(windH) < 0.3 ? -30 : 0;   // 南北风（近垂直）→ 沙尘缓慢下沉
        for (let i = 0; i < n; i++) {
            const p = parts[i];
            if (p.kind !== partKind || !p.spd) {
                const c = colsOf(i, n, genXSpan, H);
                p.x = camX + (windH >= 0 ? -40 : W + 40) + (Math.random() - 0.5) * 40;   // 从风向逆侧进入
                p.y = camY + Math.random() * H;
                p.spd = WX_PART_SPEED.sand * wxSpeedMul(sv._weather, level) * (0.94 + Math.random() * 0.12);
                p.len = (4 + Math.random() * 7) * wxSpeedMul(sv._weather, level);
                p.kind = partKind;
            } else if (p.x < camX - 60 || p.x > camX + W + 60 || p.y < camY - 80 || p.y > camY + H + 80) {
                const c = colsOf(i, n, genXSpan, H);
                p.x = camX + (windH >= 0 ? -40 : W + 40) + (Math.random() - 0.5) * 40;
                p.y = camY + (c.gx + 0.5) * (H / c.cols) + (Math.random() - 0.5) * 16;
            }
            p.x += sandH * fdt;   // 风向水平驱动（东风右、西风左）
            p.y += sandV * fdt + (Math.random() - 0.5) * 20 * fdt;   // 轻微下沉/抖动
            const sx = p.x - camX, sy = p.y - camY;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - (windH >= 0 ? 1 : -1) * p.len, sy);
            ctx.stroke();
        }
    }
    ctx.restore();
}

// ---------- 雷阵雨：闪电+全屏闪光（§13.2 确定性触发：sv.t 由 wsync 快照同步 → 双端同刻） ----------
function drawThunder(ctx, sv, W, H) {
    if (!sv || sv._weather !== 'rain') return;
    if (sv._devGfx === 0) return;   // 低画质跳过（§7）
    const inten = wxIntensity(sv._weather, wxLevelCur(sv));
    if (!inten.flash) return;
    const seed = sv.world.seed;
    const PER = 5;   // 判定周期（秒）：每 5s 窗口最多一道闪电
    const win = Math.floor(sv.t / PER);
    const ph = sv.t - win * PER;
    if (hash2(seed, win | 0, 0x51E1) < 0.7) {   // 70% 窗口有闪电（确定性）
        const at = 0.15 + hash2(seed, win | 0, 0x31A9) * 1.45;   // 窗口内闪电时刻
        const dt2 = ph - at;
        if (dt2 >= 0 && dt2 < 0.2) {
            const a = (1 - dt2 / 0.2) * 0.8;
            ctx.fillStyle = `rgba(232,240,255,${a.toFixed(3)})`;   // 全屏闪白
            ctx.fillRect(0, 0, W, H);
            // 闪电枝（确定性随机位置竖折线）
            const lx = hash2(seed, win | 0, 0x71C3) * W;
            const bend = (hash2(seed, win | 0, 0x91E7) - 0.5) * 90;
            ctx.strokeStyle = `rgba(210,232,255,${Math.min(1, a * 1.3).toFixed(3)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(lx, 0);
            ctx.lineTo(lx + bend * 0.3, H * 0.3);
            ctx.lineTo(lx + bend, H * 0.55);
            ctx.lineTo(lx + bend * 0.7, H * 0.8);
            ctx.stroke();
        }
    }
}

// ---------- 感染屏幕覆盖层：阶段越高绿灰侵蚀越明显（呼吸 + 噪点，§13.1 INF_VIS 收口） ----------
function drawInfectionOverlay(ctx, sv, W, H) {
    if (!sv || sv.infection <= 0) return;
    if (sv._devGfx === 0) return;   // 低画质跳过（§7）
    const stage = playerInfectionEffects(sv.infection).stage;
    const vis = infVis(stage);
    if (vis.alpha <= 0) return;
    const breathe = 0.5 + 0.5 * Math.sin(sv.now * (stage >= 4 ? 3.2 : 1.8));
    const a = vis.alpha * (0.75 + 0.25 * breathe);
    // 边缘侵蚀暗角（文字剥落感：灰绿调）
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(40,55,48,0)');
    g.addColorStop(1, `rgba(30,48,40,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 噪点：文字侵蚀闪烁（stage 4+ 失名/文尸），稀疏灰绿小像素（表现类随机）
    if (vis.noise) {
        const n = Math.floor(W * H / 9000) * (sv._devGfx === 2 ? 1 : 0.6);
        ctx.fillStyle = `rgba(150,178,162,${(0.28 + 0.22 * breathe).toFixed(3)})`;
        for (let i = 0; i < n; i++) {
            ctx.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
        }
    }
}

// ---------- 危急状态晕眩：镜头轻微摇摆（饥饿/缺水 or 低血量 ≤20%） ----------
function hungerShake(sv) {
    if (!sv || sv.food == null) return { x: 0, y: 0 };
    if (sv.food > 0 && (sv.water == null || sv.water > 0) && sv.hp > (sv.maxHp || 100) * 0.2) return { x: 0, y: 0 };
    const t = sv.now;
    return {
        x: Math.sin(t * 7.3) * 1.2,
        y: Math.cos(t * 6.1) * 1.0,
    };
}

// ---------- 危急状态光晕：昏黄呼吸光 + 边缘暗角（饥饿/缺水或低血量，快晕倒的眩晕感） ----------
function drawStarveVignette(ctx, sv, W, H) {
    if (!sv || sv.food == null) return;
    if (sv.food > 0 && (sv.water == null || sv.water > 0) && sv.hp > (sv.maxHp || 100) * 0.2) return;
    const breathe = 0.5 + 0.5 * Math.sin(sv.now * 1.8);
    // 室内背景已被 drawDayNight 压暗一层 + 暗角叠加会把棕色光晕完全掩盖成纯黑
    // → 室内减弱暗角、提亮棕色光晕，让低状态警示在室内也清晰可见（与室外"同步"）
    const isIn = !!sv.interior;
    const ringA = isIn ? 0.50 + 0.30 * breathe : 0.30 + 0.22 * breathe;
    const darkA = isIn ? 0.12 + 0.10 * breathe : 0.32 + 0.20 * breathe;
    // 昏黄光晕（低血糖/失血发晕感）：中心稍透，向四周变浓，随呼吸脉动
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(130,66,22,0)');
    g.addColorStop(1, `rgba(70,32,10,${ringA.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 边缘暗角（视野收窄）：呼吸脉动
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.30, W / 2, H / 2, H * 0.82);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${darkA.toFixed(3)})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
}

// ---------- 可采集资源（像素风格图标） ----------
function drawCollectible(ctx, sx, sy, text, color, now, tx, ty, highlight) {
    const x0 = sx - TS / 2, y0 = sy - TS / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (text === '物资箱' || text === '武器箱' || text === '医疗箱' || text === '建材箱') {
        const bx = x0 + 6, by = y0 + 8, bw = 24, bh = 20;
        const lid = text === '武器箱' ? '#34383D' : text === '医疗箱' ? '#8B3333' : text === '建材箱' ? '#666666' : '#8B6B33';
        const body = text === '武器箱' ? '#171A1E' : text === '医疗箱' ? '#6B2222' : text === '建材箱' ? '#555555' : '#6B4E22';
        ctx.fillStyle = body;
        ctx.fillRect(bx, by + 4, bw, bh - 4);
        ctx.fillStyle = lid;
        ctx.fillRect(bx, by, bw, 6);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(bx, by + 6, bw, 1);
        ctx.fillStyle = '#333';
        ctx.fillRect(bx + bw / 2 - 2, by + 5, 4, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(bx + 2, by + 1, 3, 4);
        if (text === '医疗箱') {
            ctx.fillStyle = '#DDFFDD';
            ctx.fillRect(bx + 9, by + 10, 6, 2);
            ctx.fillRect(bx + 11, by + 8, 2, 6);
        } else if (text === '武器箱') {
            ctx.fillStyle = '#555B62';
            ctx.fillRect(bx + 3, by + 9, bw - 6, 1);
            ctx.fillRect(bx + 3, by + 14, bw - 6, 1);
        } else if (text === '建材箱') {
            ctx.fillStyle = '#999';
            ctx.fillRect(bx + 4, by + 9, 7, 5);
            ctx.fillRect(bx + 13, by + 11, 7, 5);
        } else {
            ctx.fillStyle = '#A08050';
            ctx.fillRect(bx + 3, by + 9, bw - 6, 1);
            ctx.fillRect(bx + 3, by + 14, bw - 6, 1);
        }
        if (highlight !== false) {
            const pulse = 0.4 + Math.sin(now * 2.5 + tx * 1.7 + ty * 2.3) * 0.3;
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);
            ctx.globalAlpha = 1;
        }
    } else if (text === '草药') {
        const px = x0 + 12, py = y0 + 10;
        ctx.fillStyle = '#2a5e2a'; ctx.fillRect(px + 4, py + 8, 2, 8);
        ctx.fillStyle = '#3a8a3a'; ctx.fillRect(px + 1, py + 4, 4, 5); ctx.fillRect(px + 6, py + 2, 4, 5);
        ctx.fillStyle = '#46C846'; ctx.fillRect(px + 3, py, 4, 4); ctx.fillRect(px + 7, py + 5, 3, 3);
        ctx.fillStyle = '#88EE88'; ctx.fillRect(px + 4, py + 1, 2, 2);
    } else if (text === '向日葵') {
        const px = x0 + 14, py = y0 + 8;
        ctx.fillStyle = '#395f35'; ctx.fillRect(px + 3, py + 10, 2, 10);
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(px, py + 2, 8, 2); ctx.fillRect(px - 1, py + 4, 10, 4); ctx.fillRect(px, py + 8, 8, 2);
        ctx.fillStyle = '#8B5A00'; ctx.fillRect(px + 2, py + 4, 4, 4);
    } else if (text === '水源') {
        const px = x0 + 8, py = y0 + 14;
        ctx.fillStyle = 'rgba(40,100,200,0.4)'; ctx.fillRect(px, py + 4, 20, 8);
        ctx.fillStyle = 'rgba(80,150,240,0.5)'; ctx.fillRect(px + 2, py + 2, 16, 8);
        ctx.fillStyle = 'rgba(120,180,255,0.6)'; ctx.fillRect(px + 5, py, 10, 6);
        ctx.fillStyle = 'rgba(200,230,255,0.4)'; ctx.fillRect(px + 7, py + 2, 4, 2);
    } else if (text === '碎石') {
        // 废墟残路带上的碎石坑 = 破损路面（车可压过，视觉扁平如路面）——
        // 与建筑废墟的碎石堆（障碍，立体大石）区分，避免"石头像贴图没有碰撞体"的误导
        if (ruinsRoadBand(_worldSeed, tx, ty)) {
            const px = x0 + 8, py = y0 + 12;
            // 破损路面坑：暗灰底色 + 小碎石 + 裂纹，扁平路面感（可压）
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fillRect(px, py + 4, 16, 8);
            ctx.fillStyle = '#5a5a5a'; ctx.fillRect(px + 2, py + 5, 5, 3); ctx.fillRect(px + 9, py + 4, 4, 3);
            ctx.fillStyle = '#707070'; ctx.fillRect(px + 4, py + 6, 2, 1); ctx.fillRect(px + 12, py + 5, 2, 1);
            ctx.strokeStyle = 'rgba(30,28,26,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px + 2, py + 11); ctx.lineTo(px + 8, py + 7); ctx.lineTo(px + 15, py + 10);
            ctx.stroke();
        } else {
            const px = x0 + 8, py = y0 + 12;
            ctx.fillStyle = '#5a5a5a'; ctx.fillRect(px, py + 6, 8, 6); ctx.fillRect(px + 10, py + 4, 7, 7);
            ctx.fillStyle = '#7a7a7a'; ctx.fillRect(px + 3, py + 2, 6, 5); ctx.fillRect(px + 12, py + 6, 4, 4);
            ctx.fillStyle = '#9a9a9a'; ctx.fillRect(px + 4, py + 3, 3, 2);
        }
    } else {
        ctx.fillStyle = color;
        ctx.font = `bold 11px "Microsoft YaHei", monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, sx, sy);
    }
    ctx.restore();
}

// ---------- 街道容器（垃圾桶/纸箱/消防栓/报刊亭/废弃轮胎）像素渲染 ----------
// 可交互容器带边缘高亮（与资源箱同款）；地面底由统一叠加规则绘制（见 drawWorld：groundTypeAt）。
const STREET_CONTAINER = { '垃圾桶': 1, '纸箱': 1, '消防栓': 1, '报刊亭': 1, '废弃轮胎': 1 };
// 容器高亮：未搜 或 仍有可取物品 才显示；已掏空的储物容器不再高亮（但仍可点开存取）。
// 2026-08-10 用户要求：消防栓/纸箱不做光圈交互提示（远处反复闪的呼吸描边干扰视线），
// F 交互仍可用，仅去掉发光脉冲。
function containerHighlight(sv, t, tx, ty) {
    if (t === T.TIRES) return false;
    if (t === T.HYDRANT) return false;   // 消防栓：不显示光圈
    if (t === T.CARDBOX) return false;   // 纸箱：不显示光圈
    const key = tx + ',' + ty;
    const chest = sv.mods.chests && sv.mods.chests['box:' + key];
    const boxL = sv.mods.boxLoot && sv.mods.boxLoot[key];
    if (chest) return chest.some(s => s && s.n > 0);
    if (boxL) return boxL.length > 0;
    return true;
}
function drawStreetContainer(ctx, sx, sy, text, now, tx, ty, highlight) {
    const x0 = sx - TS / 2, y0 = sy - TS / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // 接触投影：柔和小椭圆只压在容器底部，不遮住格下缘砖缝、不把地面压暗成"凹陷"。
    ctx.fillStyle = 'rgba(25,23,20,0.16)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 11, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (text === '垃圾桶') {
        ctx.fillStyle = '#3f6b46'; ctx.fillRect(x0 + 11, y0 + 12, 14, 16);       // 桶身
        ctx.fillStyle = '#4c7f54'; ctx.fillRect(x0 + 13, y0 + 13, 4, 14);        // 受光面
        ctx.fillStyle = '#2f5236'; ctx.fillRect(x0 + 22, y0 + 13, 3, 14);        // 暗面
        ctx.fillStyle = '#57935f'; ctx.fillRect(x0 + 10, y0 + 8, 16, 4);         // 盖
        ctx.fillRect(x0 + 15, y0 + 5, 6, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + 11, y0 + 12, 14, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0 + 10, y0 + 28, 16, 3);
    } else if (text === '纸箱') {
        ctx.fillStyle = '#a97e4a'; ctx.fillRect(x0 + 7, y0 + 13, 22, 15);        // 箱身
        ctx.fillStyle = '#c29a63'; ctx.fillRect(x0 + 7, y0 + 10, 22, 4);         // 顶盖
        ctx.fillStyle = '#8a6238'; ctx.fillRect(x0 + 16, y0 + 10, 4, 18);         // 胶带
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x0 + 7, y0 + 14, 22, 1);
        ctx.fillStyle = '#7a552e'; ctx.fillRect(x0 + 7, y0 + 26, 22, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0 + 6, y0 + 28, 24, 3);
    } else if (text === '消防栓') {
        ctx.fillStyle = '#8c2f26'; ctx.fillRect(x0 + 12, y0 + 24, 12, 5);        // 底座
        ctx.fillStyle = '#b33a2e'; ctx.fillRect(x0 + 14, y0 + 10, 8, 15);        // 栓体
        ctx.fillStyle = '#c9473a'; ctx.fillRect(x0 + 14, y0 + 10, 3, 15);        // 受光面
        ctx.fillStyle = '#b33a2e'; ctx.fillRect(x0 + 13, y0 + 6, 10, 4);         // 顶帽
        ctx.fillRect(x0 + 16, y0 + 3, 4, 3);
        ctx.fillStyle = '#7f2a22'; ctx.fillRect(x0 + 11, y0 + 14, 3, 4);         // 侧接口
        ctx.fillRect(x0 + 22, y0 + 14, 3, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0 + 11, y0 + 29, 14, 2);
    } else if (text === '报刊亭') {
        ctx.fillStyle = '#5b6b52'; ctx.fillRect(x0 + 6, y0 + 12, 24, 16);        // 亭身
        ctx.fillStyle = '#71846a'; ctx.fillRect(x0 + 9, y0 + 15, 18, 10);        // 前面板
        ctx.fillStyle = '#2e3a2a'; ctx.fillRect(x0 + 11, y0 + 17, 14, 6);        // 橱窗
        ctx.fillStyle = '#8a6238'; ctx.fillRect(x0 + 4, y0 + 6, 28, 3);          // 顶棚
        ctx.fillRect(x0 + 6, y0 + 9, 24, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x0 + 6, y0 + 12, 24, 1);
        ctx.fillStyle = 'rgba(220,220,190,0.5)'; ctx.fillRect(x0 + 12, y0 + 18, 5, 4);  // 报纸
        ctx.fillRect(x0 + 19, y0 + 18, 5, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0 + 5, y0 + 28, 26, 3);
    } else {
        const tire = (cxx, cyy, r) => {                                          // 废弃轮胎堆
            ctx.fillStyle = '#26262a';
            ctx.beginPath(); ctx.ellipse(cxx, cyy, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#41414a';
            ctx.beginPath(); ctx.ellipse(cxx, cyy - 1, r * 0.55, r * 0.36, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1a1a1e';
            ctx.beginPath(); ctx.ellipse(cxx, cyy - 1, r * 0.25, r * 0.15, 0, 0, Math.PI * 2); ctx.fill();
        };
        tire(sx - 7, sy + 7, 8); tire(sx + 7, sy + 8, 8); tire(sx, sy + 1, 9);
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0 + 6, y0 + 29, 24, 2);
    }
    if (highlight) {                                                             // 可交互高亮圈
        const pulse = 0.4 + Math.sin(now * 2.5 + tx * 1.7 + ty * 2.3) * 0.3;
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#E8C46A';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 4.5, y0 + 3.5, TS - 8, TS - 8);
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

function drawWildForage(ctx, sx, sy, type, seed, tx, ty) {
    const n = hash2(seed ^ 0xB07A, tx, ty);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (type === T.HERB) {
        ctx.fillStyle = '#355A35'; ctx.fillRect(sx - 1, sy - 2, 2, 10);
        ctx.fillStyle = '#4F7947'; ctx.fillRect(sx - 7, sy - 4, 6, 3); ctx.fillRect(sx + 1, sy - 7, 7, 3);
        ctx.fillStyle = '#72945E'; ctx.fillRect(sx - 4, sy - 9, 5, 4);
    } else if (type === T.FLOWER) {
        ctx.fillStyle = '#46643B'; ctx.fillRect(sx - 1, sy - 1, 2, 10);
        ctx.fillStyle = '#B79A3A';
        ctx.fillRect(sx - 5, sy - 8, 4, 4); ctx.fillRect(sx + 1, sy - 8, 4, 4);
        ctx.fillRect(sx - 2, sy - 11, 4, 4); ctx.fillRect(sx - 2, sy - 5, 4, 3);
        ctx.fillStyle = '#5B4127'; ctx.fillRect(sx - 1, sy - 7, 2, 2);
    } else {
        const crop = Math.floor(n * 3) % 3;
        ctx.fillStyle = '#65743B';
        for (let i = -1; i <= 1; i++) ctx.fillRect(sx + i * 5 - 1, sy - 7 + Math.abs(i) * 2, 2, 12);
        ctx.fillStyle = crop === 0 ? '#9B5542' : crop === 1 ? '#B99B3D' : '#8A704D';
        ctx.fillRect(sx - 3, sy + 2, 6, 5);
    }
    ctx.restore();
}

// ---------- 玩家自造建筑（像素风格） ----------
function drawBuilt(ctx, sx, sy, text, now, tx, ty) {
    const x0 = sx - TS / 2, y0 = sy - TS / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (text === '木墙') {
        ctx.fillStyle = '#6B4E2A'; ctx.fillRect(x0 + 2, y0 + 2, TS - 4, TS - 4);
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i % 2 ? '#5A3F20' : '#7A5C34';
            ctx.fillRect(x0 + 3, y0 + 3 + i * 8, TS - 6, 7);
            ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x0 + 3, y0 + 9 + i * 8, TS - 6, 1);
        }
        ctx.fillStyle = '#4A3518'; ctx.fillRect(x0 + TS / 2 - 1, y0 + 2, 2, TS - 4);
    } else if (text === '木门') {
        ctx.fillStyle = '#7A5C34'; ctx.fillRect(x0 + 6, y0 + 2, TS - 12, TS - 4);
        ctx.fillStyle = '#5A3F20'; ctx.fillRect(x0 + 8, y0 + 4, TS - 16, TS - 8);
        ctx.fillStyle = '#8B6B3A'; ctx.fillRect(x0 + 9, y0 + 5, TS - 18, 6); ctx.fillRect(x0 + 9, y0 + 14, TS - 18, 6); ctx.fillRect(x0 + 9, y0 + 23, TS - 18, 6);
        ctx.fillStyle = '#D4AA55'; ctx.fillRect(x0 + TS - 12, y0 + TS / 2 - 1, 3, 3);
    } else if (text === '储物柜') {
        ctx.fillStyle = '#5A4A3A'; ctx.fillRect(x0 + 4, y0 + 3, TS - 8, TS - 6);
        ctx.fillStyle = '#4A3A2A'; ctx.fillRect(x0 + 6, y0 + 5, TS - 12, TS - 10);
        ctx.fillStyle = '#6A5A4A'; ctx.fillRect(x0 + 6, y0 + TS / 2 - 1, TS - 12, 2);
        ctx.fillStyle = '#C8A2E8'; ctx.fillRect(x0 + TS / 2 - 1, y0 + 8, 2, 4); ctx.fillRect(x0 + TS / 2 - 1, y0 + TS / 2 + 4, 2, 4);
    } else if (text === '木床') {
        ctx.fillStyle = '#5A3F20'; ctx.fillRect(x0 + 3, y0 + 6, TS - 6, TS - 10);
        ctx.fillStyle = '#8B6B3A'; ctx.fillRect(x0 + 4, y0 + 7, TS - 8, 6);
        ctx.fillStyle = '#C86A6A'; ctx.fillRect(x0 + 4, y0 + 13, TS - 8, TS - 20);
        ctx.fillStyle = '#E8E8DD'; ctx.fillRect(x0 + 5, y0 + 8, 8, 4);
    } else if (text === '种植盆') {
        ctx.fillStyle = '#6B4E2A'; ctx.fillRect(x0 + 6, y0 + 16, TS - 12, 12);
        ctx.fillStyle = '#8B6B3A'; ctx.fillRect(x0 + 5, y0 + 14, TS - 10, 4);
        ctx.fillStyle = '#3A2A15'; ctx.fillRect(x0 + 8, y0 + 18, TS - 16, 8);
        ctx.fillStyle = '#395f35'; ctx.fillRect(x0 + 12, y0 + 10, 2, 6); ctx.fillRect(x0 + 18, y0 + 8, 2, 8);
        ctx.fillStyle = '#55a54d'; ctx.fillRect(x0 + 10, y0 + 7, 5, 4); ctx.fillRect(x0 + 16, y0 + 5, 5, 4);
    } else {
        ctx.fillStyle = 'rgba(15,25,40,0.6)'; ctx.fillRect(x0 + 2, y0 + 2, TS - 4, TS - 4);
        ctx.strokeStyle = '#7799BB'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
        ctx.strokeRect(x0 + 2, y0 + 2, TS - 4, TS - 4); ctx.setLineDash([]);
        ctx.fillStyle = '#AACCEE'; ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, sx, sy);
    }
    ctx.restore();
}

// ---------- 汽车（俯视修长车身，横跨 2 格；opt: {wreck, repaired, near, now}） ----------
function drawCar(ctx, tileX, tileY, dir, opt) {
    const o = opt || {};
    const L = TS * 2, W = TS - 4;           // 车长 2 格、车宽略小于 1 格
    // 车身中心：以锚点格为车尾、向右延伸 2 格 → 中心在锚点右侧 1 格
    const cx = tileX + L / 2, cy = tileY + TS / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(dir || 0);

    // 配色（按品相区分：残骸灰 / 完好青 / 损坏暗灰褐 / 可修复锈红）
    let body, roof, glass, wheel = '#141414';
    if (o.wreck) { body = '#4A4A4A'; roof = '#565656'; glass = '#2A2A2A'; }
    else if (o.repaired) { body = '#2EA88C'; roof = '#38C4A4'; glass = '#173f3a'; }
    else if (o.cond === 'wreck') { body = '#57493E'; roof = '#665847'; glass = '#232326'; }
    else { body = '#8B3A2F'; roof = '#A2483C'; glass = '#2A2A30'; }

    const hl = L / 2, hw = W / 2;   // 半长、半宽

    // 车轮（车身下，四角外侧露出一点）
    ctx.fillStyle = wheel;
    for (const wx of [-hl * 0.55, hl * 0.55]) for (const wy of [-hw - 1, hw + 1]) {
        roundRectPath(ctx, wx - 5, wy - 3.5, 10, 7, 3);
        ctx.fill();
    }

    // 车身（贝塞尔平滑：车头大圆弧、车尾略钝，两侧微外凸腰线）
    ctx.beginPath();
    ctx.moveTo(-hl + 4, -hw);                                  // 车尾左
    ctx.bezierCurveTo(-hl - 3, -hw * 0.5, -hl - 3, hw * 0.5, -hl + 4, hw);  // 车尾圆弧
    ctx.bezierCurveTo(-hl * 0.3, hw + 2, hl * 0.3, hw + 2, hl - 6, hw);     // 下侧腰线
    ctx.bezierCurveTo(hl + 2, hw * 0.5, hl + 2, -hw * 0.5, hl - 6, -hw);    // 车头大圆弧
    ctx.bezierCurveTo(hl * 0.3, -hw - 2, -hl * 0.3, -hw - 2, -hl + 4, -hw); // 上侧腰线
    ctx.closePath();
    ctx.fillStyle = body;
    // 2026-08-11 性能：shadowBlur 是 Canvas 重操作，驾驶中每帧画车 + 高亮车多次触发会导致卡顿。
    // 把阴影半径大幅调小（12/6 → 4/2）保留微光描边观感，显著降低每帧开销（开车不卡）。
    if (o.repaired && !o.wreck) { ctx.shadowColor = '#2EE6C0'; ctx.shadowBlur = o.near ? 4 : 2; }
    ctx.fill();
    ctx.shadowBlur = 0;
    // 车身描边
    ctx.strokeStyle = o.wreck ? '#333' : (o.repaired ? '#1d7a66' : '#5f2820');
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (!o.wreck) {
        // 车顶（修长圆角矩形，中段）
        ctx.fillStyle = roof;
        roundRectPath(ctx, -hl * 0.42, -hw * 0.7, hl * 0.84, hw * 1.4, 5);
        ctx.fill();
        // 前后挡风（车顶两端的梯形玻璃）
        ctx.fillStyle = glass;
        // 前挡风（车头侧）
        ctx.beginPath();
        ctx.moveTo(hl * 0.42, -hw * 0.62); ctx.lineTo(hl * 0.66, -hw * 0.42);
        ctx.lineTo(hl * 0.66, hw * 0.42); ctx.lineTo(hl * 0.42, hw * 0.62);
        ctx.closePath(); ctx.fill();
        // 后挡风（车尾侧）
        ctx.beginPath();
        ctx.moveTo(-hl * 0.42, -hw * 0.62); ctx.lineTo(-hl * 0.6, -hw * 0.42);
        ctx.lineTo(-hl * 0.6, hw * 0.42); ctx.lineTo(-hl * 0.42, hw * 0.62);
        ctx.closePath(); ctx.fill();
        // 天窗
        ctx.fillStyle = glass;
        roundRectPath(ctx, -hl * 0.1, -hw * 0.4, hl * 0.2, hw * 0.8, 3);
        ctx.fill();
        // 车门缝（车顶两侧各 2 条竖线 = 4 门分隔）
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        for (const dx of [-hl * 0.05, hl * 0.28]) {
            ctx.beginPath();
            ctx.moveTo(dx, -hw); ctx.lineTo(dx, -hw * 0.7);
            ctx.moveTo(dx, hw * 0.7); ctx.lineTo(dx, hw);
            ctx.stroke();
        }
        // 车顶不再画乘客小人（乘员状态由队伍面板标识）
        // 后视镜（前段两侧小凸起）
        ctx.fillStyle = body;
        roundRectPath(ctx, hl * 0.34, -hw - 4, 6, 4, 2); ctx.fill();
        roundRectPath(ctx, hl * 0.34, hw, 6, 4, 2); ctx.fill();
        // 车头灯（2 个亮块）
        ctx.fillStyle = o.repaired ? '#Eafffb' : '#e8d98a';
        roundRectPath(ctx, hl - 7, -hw * 0.6, 4, 5, 1.5); ctx.fill();
        roundRectPath(ctx, hl - 7, hw * 0.6 - 5, 4, 5, 1.5); ctx.fill();
        // 车尾灯（2 个红块）
        ctx.fillStyle = '#c0392b';
        roundRectPath(ctx, -hl + 3, -hw * 0.6, 3, 5, 1.5); ctx.fill();
        roundRectPath(ctx, -hl + 3, hw * 0.6 - 5, 3, 5, 1.5); ctx.fill();
    } else {
        // 残骸：破裂纹 + 歪斜车顶
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-hl * 0.3, -hw * 0.5); ctx.lineTo(hl * 0.2, hw * 0.3);
        ctx.moveTo(hl * 0.1, -hw * 0.4); ctx.lineTo(-hl * 0.2, hw * 0.5);
        ctx.stroke();
    }
    ctx.restore();

    // 归属标记（玩家修复/驾驶过的车）：车下金色小字"所属：XXX"
    if (o.owner && o.repaired && !o.wreck) {
        ctx.save();
        ctx.font = '9px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const ow = ctx.measureText(`所属：${o.owner}`).width + 10;
        ctx.fillRect(cx - ow / 2, cy + TS / 2 + 8, ow, 13);
        ctx.fillStyle = '#FFD700';
        ctx.fillText(`所属：${o.owner}`, cx, cy + TS / 2 + 15);
        ctx.restore();
    }

    // 靠近可交互高亮浮标（车/报废车：驾驶/修理/拆解提示）
    if (o.near) {
        const pulse = 0.55 + Math.sin((o.now || 0) * 4) * 0.45;
        ctx.save();
        ctx.globalAlpha = pulse;
        const label = o.repaired ? '驾驶 [F]' : (o.cond === 'wreck' ? '拆解 [F]' : '修理 [F]');
        const col = o.repaired ? '#2EE6C0' : '#FFC060';
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(cx - tw / 2, cy - TS / 2 - 18, tw, 15);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.strokeRect(cx - tw / 2, cy - TS / 2 - 18, tw, 15);
        ctx.fillStyle = col;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, cy - TS / 2 - 10);
        ctx.restore();
    }
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ---------- 地块 ----------
const GROUND_COLORS = {
    [T.GROUND]: [38, 52, 38],
    [T.FLOOR]: [62, 50, 34],
    [T.ROAD]: [58, 58, 64],
    [T.SIDEWALK]: [82, 80, 74],
    [T.WEED]: [42, 68, 42],
    [T.CROP]: [56, 52, 30],
};
const GROUND_EDGE_BLEND = 4;

// 平滑值噪声（双线性 + smoothstep）：草地颜色按 8/3 格双层贴片空间连续变化，
// 相邻格颜色相关，替代逐格独立白噪声（白噪声是草地盐粒感/突兀的主因）。
function grassNoise(seedSalt, tx, ty, cell) {
    const cx = Math.floor(tx / cell), cy = Math.floor(ty / cell);
    const fx = tx / cell - cx, fy = ty / cell - cy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v00 = hash2(seedSalt, cx, cy), v10 = hash2(seedSalt, cx + 1, cy);
    const v01 = hash2(seedSalt, cx, cy + 1), v11 = hash2(seedSalt, cx + 1, cy + 1);
    return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
// 草地底色按 biome 分色：与各区背景色/建筑色调统一，避免同一块草在不同生态区里显得突兀。
// 色调目标：柔和自然绿——G 明显高于 R/B，避免偏黄；废墟保留枯草但不过度黄。
const BIOME_GRASS = [
    [42, 56, 42],   // 城区：沉稳暖灰绿
    [46, 62, 42],   // 郊区：柔和草绿
    [38, 64, 40],   // 荒野：明亮自然绿
    [50, 54, 40],   // 废墟：枯草（偏枯但保持绿感）
];

// biome 草地色平滑过渡（消除分块接缝）：草地按 16 格 chunk 取 biome 色会离散跳变，
// 在 chunk 边界产生明显的颜色分界线。此函数取当前格所在 chunk 四角的 biome 色，
// 按格在 chunk 内的归一化位置做双线性 smoothstep 插值 —— biome 交界处颜色连续渐变，
// 不再有"一条线切开两块不同绿色"的视觉接缝。
function grassBiomeColor(seed, tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    const fx = (tx - cx * CHUNK) / CHUNK, fy = (ty - cy * CHUNK) / CHUNK;
    const s = x => x * x * (3 - 2 * x);   // smoothstep
    const sx = s(fx), sy = s(fy);
    const a = BIOME_GRASS[chunkBiome(seed, cx, cy)] || BIOME_GRASS[0];
    const b = BIOME_GRASS[chunkBiome(seed, cx + 1, cy)] || BIOME_GRASS[0];
    const c = BIOME_GRASS[chunkBiome(seed, cx, cy + 1)] || BIOME_GRASS[0];
    const d = BIOME_GRASS[chunkBiome(seed, cx + 1, cy + 1)] || BIOME_GRASS[0];
    const m = (p, q, t) => p + (q - p) * t;
    return [
        m(m(a[0], b[0], sx), m(c[0], d[0], sx), sy),
        m(m(a[1], b[1], sx), m(c[1], d[1], sx), sy),
        m(m(a[2], b[2], sx), m(c[2], d[2], sx), sy),
    ];
}

function isGroundTile(t) {
    return t === T.GROUND || t === T.FLOOR || t === T.ROAD || t === T.SIDEWALK || t === T.WEED || t === T.CROP;
}
// 物体脚下的地面类型（统一叠加规则）：物体永远画在"所在位置的地面"之上，不改变下方地面。
// 规划步道（街道容器/玩家建筑/旧存档残留）→ 人行道；保留公路/主干道（车/路障）→ 公路；其余 → 草地。
function groundTypeAt(sv, gx, gy) {
    const v = getTile(sv, gx, gy);
    if (GROUND_COLORS[v]) return v;
    const seed = sv.world.seed;
    if (plannedSidewalkAt(seed, gx, gy)) return T.SIDEWALK;
    if (plannedArterialAt(seed, gx, gy) === 'road' || gridRoadKept(seed, gx, gy)) return T.ROAD;
    return T.GROUND;
}
// 相邻格的"表面颜色"（供地面格向邻居做渐变）：邻居是人行道/路面表面即按该表面色渐变。
function tileSurfaceColor(sv, gx, gy) {
    const v = getTile(sv, gx, gy);
    const c = GROUND_COLORS[v];
    if (c) return c;
    if (plannedSidewalkAt(sv.world.seed, gx, gy)) return GROUND_COLORS[T.SIDEWALK];
    if (plannedArterialAt(sv.world.seed, gx, gy) === 'road' || gridRoadKept(sv.world.seed, gx, gy)) return GROUND_COLORS[T.ROAD];
    return null;
}
// 边缘渐变混合带（仅地面格使用）：向相邻表面做 4px 线性插值（80%→20%），
// 邻居表面为人行道/路面即参与；物体格不绘制任何背景带，只叠加在地面上。
function drawSurfaceEdgeBlend(ctx, sv, tx, ty, x0, y0, r, g, b, t) {
    if (t === T.SIDEWALK) return;
    // 涉及草地的边界【全部不画渐变】：无论渐变画在哪一侧（草地侧或路面/人行道侧），
    // 4px 色带都会形成"分割线"（草地块被路面网格框成格子状）。
    // 草地↔路面/人行道/建筑直接硬切（两种表面本身颜色分明，无需过渡带）。
    const isGrassLike = v => v === T.GROUND || v === T.WEED;
    if (isGrassLike(t)) return;
    if (isGrassLike(getTile(sv, tx, ty - 1)) || isGrassLike(getTile(sv, tx, ty + 1))
        || isGrassLike(getTile(sv, tx - 1, ty)) || isGrassLike(getTile(sv, tx + 1, ty))) return;
    const same = v => v === t;
    if (!same(getTile(sv, tx, ty - 1))) {
        const nc = tileSurfaceColor(sv, tx, ty - 1);
        if (nc) for (let i = 0; i < GROUND_EDGE_BLEND; i++) {
            const mix = i / (GROUND_EDGE_BLEND - 1);
            ctx.fillStyle = `rgb(${Math.round(r + (nc[0] - r) * mix)},${Math.round(g + (nc[1] - g) * mix)},${Math.round(b + (nc[2] - b) * mix)})`;
            ctx.fillRect(x0, y0 + i, TS + 1, 1);
        }
    }
    if (!same(getTile(sv, tx, ty + 1))) {
        const nc = tileSurfaceColor(sv, tx, ty + 1);
        if (nc) for (let i = 0; i < GROUND_EDGE_BLEND; i++) {
            const mix = i / (GROUND_EDGE_BLEND - 1);
            ctx.fillStyle = `rgb(${Math.round(r + (nc[0] - r) * mix)},${Math.round(g + (nc[1] - g) * mix)},${Math.round(b + (nc[2] - b) * mix)})`;
            ctx.fillRect(x0, y0 + TS - i, TS + 1, 1);
        }
    }
    if (!same(getTile(sv, tx - 1, ty))) {
        const nc = tileSurfaceColor(sv, tx - 1, ty);
        if (nc) for (let i = 0; i < GROUND_EDGE_BLEND; i++) {
            const mix = i / (GROUND_EDGE_BLEND - 1);
            ctx.fillStyle = `rgb(${Math.round(r + (nc[0] - r) * mix)},${Math.round(g + (nc[1] - g) * mix)},${Math.round(b + (nc[2] - b) * mix)})`;
            ctx.fillRect(x0 + i, y0, 1, TS + 1);
        }
    }
    if (!same(getTile(sv, tx + 1, ty))) {
        const nc = tileSurfaceColor(sv, tx + 1, ty);
        if (nc) for (let i = 0; i < GROUND_EDGE_BLEND; i++) {
            const mix = i / (GROUND_EDGE_BLEND - 1);
            ctx.fillStyle = `rgb(${Math.round(r + (nc[0] - r) * mix)},${Math.round(g + (nc[1] - g) * mix)},${Math.round(b + (nc[2] - b) * mix)})`;
            ctx.fillRect(x0 + TS - i, y0, 1, TS + 1);
        }
    }
}

function drawGroundTile(ctx, sv, tx, ty, camX, camY, forcedType) {
    const t = forcedType || getTile(sv, tx, ty);
    const base = GROUND_COLORS[t];
    if (!base) return;
    const biome = chunkBiome(sv.world.seed, Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    const x0 = tx * TS - camX, y0 = ty * TS - camY;
    const n = hash2(sv.world.seed ^ 0x6B2D, tx, ty);
    const n2 = hash2(sv.world.seed ^ 0x3F7A, tx, ty);
    const L0 = getTile(sv, tx - 1, ty), R0 = getTile(sv, tx + 1, ty);
    const U0 = getTile(sv, tx, ty - 1), D0 = getTile(sv, tx, ty + 1);
    const isBuildingTile = value => value === T.WALL || value === T.DOOR;
    const alleyNS = isBuildingTile(U0) && isBuildingTile(D0);
    const alleyEW = isBuildingTile(L0) && isBuildingTile(R0);
    // 两栋建筑只隔一格时，绘制成"楼间阴影草地"，避免两种误读：
    // 1) 亮绿色草地 → 像屋顶内部的绿色结构带；
    // 2) 深土褐硬质 → 像人行道/路面（无碰撞体会误导寻路）。
    // 阴影草地 = 比普通草地更暗的绿色 + 草叶斑点 + 靠墙檐影，明确表达"可通行的楼缝"而非路面。
    // 后巷只做纯视觉，不修改地图碰撞/寻路。
    if ((t === T.GROUND || t === T.WEED) && (alleyNS || alleyEW)) {
        // 楼间阴影草地：比普通草地略暗即可（柔和），草叶弱化避免生硬
        const vary = Math.floor(n * 4) - 2;
        ctx.fillStyle = `rgb(${35 + vary},${48 + vary},${36 + vary})`;
        ctx.fillRect(x0, y0, TS + 1, TS + 1);
        ctx.imageSmoothingEnabled = false;
        // 稀疏草叶（短线簇，透明度降低）
        const s = (n * 4294967296) | 0;
        for (let i = 0; i < 3; i++) {
            const v = ((s >> (i * 7)) & 0x7F);
            const dx = (v % (TS - 4)) + 2, dy = ((v >> 3) % (TS - 4)) + 2;
            ctx.strokeStyle = i % 2 ? 'rgba(56,76,52,0.35)' : 'rgba(20,32,20,0.28)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x0 + dx, y0 + dy);
            ctx.lineTo(x0 + dx + (i % 2 ? 2 : -2), y0 + dy - 2);
            ctx.stroke();
        }
        // 【去掉靠墙檐影黑带】——原设计是"明确表达楼缝"，但 4px 黑带在每块楼间草地四周形成
        // 明显框线（用户多次反馈"草地格子状被分开"的真凶之一）。楼间草地整体偏暗底色
        // （rgb 35,48,36）+ 稀疏草叶已足够与普通草地/路面区分。
        return;
    }
    let r, g, b;
    if (t === T.GROUND || t === T.WEED) {
        // 草地（独立模块 wgrass.js）：biome 平滑 + 季节背景 + 颗粒 + 低对比噪声
        WGRASS.grassRenderGround(ctx, sv, tx, ty, x0, y0);
        // 草地格【不画】边缘渐变：渐变带画在草地格上 = 草地块四周一圈色带（横竖分割线）。
        // 草地↔路面过渡由路面/人行道格自己的边缘渐变承担（路面侧 4px 向草地色过渡）→ 草地保持完整无框线。
        return;
    } else {
        const vary = Math.floor(n * 6) - 3;
        r = base[0] + vary; g = base[1] + vary; b = base[2] + vary;
    }
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x0, y0, TS + 1, TS + 1);
    ctx.imageSmoothingEnabled = false;
    if (t === T.GROUND || t === T.WEED || t === T.CROP) {
        if (t === T.CROP) {
            ctx.fillStyle = 'rgba(90,70,40,0.4)';
            for (let i = 0; i < 5; i++) ctx.fillRect(x0 + 2, y0 + 4 + i * 6, TS - 4, 1);
            ctx.fillStyle = 'rgba(50,40,22,0.3)';
            for (let i = 0; i < 5; i++) ctx.fillRect(x0 + 2, y0 + 5 + i * 6, TS - 4, 1);
        } else {
            const s = (n * 4294967296) | 0;
            if (t === T.WEED) {
                // 杂草细节弱化：3 根短线（旧 4），色偏更贴底、透明度降低，避免"生硬竖条"
                for (let i = 0; i < 3; i++) {
                    const v = ((s >> (i * 7)) & 0x7F);
                    const dx = (v % (TS - 6)) + 3, dy = ((v >> 3) % (TS - 6)) + 3;
                    const gv = (v & 0x1F) - 12;
                    ctx.fillStyle = `rgb(${40 + gv},${64 + gv},${36 + gv})`;
                    ctx.fillRect(x0 + dx, y0 + dy, 1, 2 + (v & 3));
                }
                if (n2 > 0.85) {
                    // 花点进一步降频降饱和：只在少数格出现，色近草绿/暗枯黄，不再刺眼
                    ctx.fillStyle = n2 > 0.93 ? '#8a7a42' : '#5e7a44';
                    ctx.fillRect(x0 + ((s >> 4) % 20) + 6, y0 + ((s >> 12) % 20) + 6, 2, 2);
                }
            } else {
                // 普通草地细节弱化：2 点（旧 3）、偏移 +5/+3/+1（旧 +8/+5/+2）——更贴底色不突兀
                for (let i = 0; i < 2; i++) {
                    const v = ((s >> (i * 9)) & 0xFF);
                    const dx = (v % (TS - 4)) + 2, dy = ((v >> 4) % (TS - 4)) + 2;
                    const pv = (v & 0x0F) - 8;
                    ctx.fillStyle = `rgb(${r + pv + 5},${g + pv + 3},${b + pv + 1})`;
                    ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
                }
            }
        }
    } else if (t === T.ROAD) {
        const s = (n * 4294967296) | 0;
        if (biome === 3) {
            // 废墟残路：更暗的破碎路面 + 裂纹 + 坑洞
            for (let i = 0; i < 6; i++) {
                const v = ((s >> (i * 6)) & 0x3F);
                const dx = (v % (TS - 2)) + 1, dy = ((v >> 2) % (TS - 2)) + 1;
                const gv = (v & 0x0F) - 7;
                ctx.fillStyle = `rgb(${46 + gv},${46 + gv},${52 + gv})`;
                ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
            }
            if (n2 > 0.4) {
                ctx.strokeStyle = 'rgba(20,18,16,0.5)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                const cx0 = x0 + Math.floor(n * 20), cy0 = y0 + Math.floor(n2 * 16);
                ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 + 6, cy0 + 8); ctx.lineTo(cx0 + 2, cy0 + 14);
                ctx.stroke();
            }
            if (n2 > 0.75) {
                ctx.fillStyle = 'rgba(12,10,8,0.65)';
                ctx.fillRect(x0 + 4 + Math.floor(n * 20), y0 + 4 + Math.floor(n2 * 16), 5, 4);
                ctx.fillStyle = 'rgba(35,32,28,0.4)';
                ctx.fillRect(x0 + 4 + Math.floor(n * 20) - 1, y0 + 4 + Math.floor(n2 * 16) - 1, 7, 6);
            }
        } else {
            for (let i = 0; i < 5; i++) {
                const v = ((s >> (i * 6)) & 0x3F);
                const dx = (v % (TS - 2)) + 1, dy = ((v >> 2) % (TS - 2)) + 1;
                const gv = (v & 0x0F) - 7;
                ctx.fillStyle = `rgb(${58 + gv},${58 + gv},${64 + gv})`;
                ctx.fillRect(x0 + dx, y0 + dy, 1, 1);
            }
            if (n2 > 0.6) {
                ctx.fillStyle = 'rgba(20,20,24,0.5)';
                ctx.fillRect(x0 + ((s >> 5) % 24) + 4, y0 + ((s >> 13) % 24) + 4, (s & 7) + 3, 1);
            }
        }
    } else if (t === T.SIDEWALK) {
        // 混凝土砖铺设感：格内 2×2 砖块（18px）各自微调亮暗（斑驳旧砖），少量污渍；
        // 砖缝统一移到函数末尾（路缘石/砌边之后绘制，见下方 SIDEWALK 段）。
        const s = (n * 4294967296) | 0;
        const qv = [n, n2, (n + 0.37) % 1, (n2 + 0.51) % 1];
        for (let q = 0; q < 4; q++) {
            const qx = (q % 2) * (TS / 2), qy = Math.floor(q / 2) * (TS / 2);
            const dv = Math.floor(qv[q] * 7) - 3;
            ctx.fillStyle = `rgba(${dv > 0 ? 14 : -8},${dv > 0 ? 14 : -8},${dv > 0 ? 16 : -10},0.4)`;
            ctx.fillRect(x0 + qx, y0 + qy, TS / 2 + 1, TS / 2 + 1);
        }
        if (n2 > 0.55) {
            ctx.fillStyle = 'rgba(46,42,36,0.30)';
            ctx.fillRect(x0 + 4 + Math.floor(n * 24), y0 + 5 + Math.floor(n2 * 24), 6, 4);
            if (n > 0.75) {
                ctx.fillStyle = 'rgba(52,48,42,0.26)';
                ctx.fillRect(x0 + 3 + Math.floor(n2 * 26), y0 + 8 + Math.floor(n * 26), 3, 2);
            }
        }
    } else if (t === T.FLOOR) {
        ctx.fillStyle = 'rgba(80,64,42,0.3)';
        ctx.fillRect(x0 + 2, y0 + 6, TS - 4, 1);
        ctx.fillRect(x0 + 2, y0 + 16, TS - 4, 1);
        ctx.fillRect(x0 + 2, y0 + 26, TS - 4, 1);
    }
    // 人行道不做渐变混合带（边缘清晰、无"边缘消失"）：与路交界画路缘石、与软地面交界画砌边线（见下方 SIDEWALK 段）。
    // 边缘渐变混合带由本格向相邻表面绘制（地面格与非地面物体格共用）。
    drawSurfaceEdgeBlend(ctx, sv, tx, ty, x0, y0, r, g, b, t);
    if (t === T.ROAD) {
        // 残骸/碎石坑/倒树也算路面（车停在路上、废墟残路的上层障碍）：路带计数不因障碍物而断，
        // 分道中线保持连续（障碍脚下是公路，属于叠加态下层路面）。
        const roadLike = value => value === T.ROAD || value === T.CAR || value === T.BARRICADE || value === T.CARWRECK || value === T.RUBBLE || value === T.TREE;
        let junctionNear = false;
        // 两格缓冲内只要同时存在横向与纵向连续路面，就视为路口；路口内不绘制分道虚线。
        for (let oy = -2; oy <= 2 && !junctionNear; oy++) for (let ox = -2; ox <= 2; ox++) {
            const gx = tx + ox, gy = ty + oy;
            const horizontal = roadLike(getTile(sv, gx - 1, gy)) && roadLike(getTile(sv, gx + 1, gy));
            const vertical = roadLike(getTile(sv, gx, gy - 1)) && roadLike(getTile(sv, gx, gy + 1));
            const verticalBranch =
                (roadLike(getTile(sv, gx, gy - 1)) && roadLike(getTile(sv, gx, gy - 2))) ||
                (roadLike(getTile(sv, gx, gy + 1)) && roadLike(getTile(sv, gx, gy + 2)));
            const horizontalBranch =
                (roadLike(getTile(sv, gx - 1, gy)) && roadLike(getTile(sv, gx - 2, gy))) ||
                (roadLike(getTile(sv, gx + 1, gy)) && roadLike(getTile(sv, gx + 2, gy)));
            if ((horizontal && verticalBranch) || (vertical && horizontalBranch)) { junctionNear = true; break; }
        }
        if (!junctionNear) {
            ctx.strokeStyle = 'rgba(200,180,80,0.38)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([8, 7]);
            // 分道中线按"连续路带"的实际宽度取中线行/列：兼容双格网格路、主干道叠加的宽路带
            // 与路上停放的残骸。方向约束：横线要求行带 ≥3 格（本格在横路上）、竖线要求列带 ≥3 格
            // （本格在纵路上），横/竖二选一，杜绝在横路中间误画竖线、竖路中间误画横线。
            let bandTop = ty, bandBot = ty;
            while (roadLike(getTile(sv, tx, bandTop - 1))) bandTop--;
            while (roadLike(getTile(sv, tx, bandBot + 1))) bandBot++;
            let bandL = tx, bandR = tx;
            while (roadLike(getTile(sv, bandL - 1, ty))) bandL--;
            while (roadLike(getTile(sv, bandR + 1, ty))) bandR++;
            const vBand = bandBot - bandTop + 1, hBand = bandR - bandL + 1;
            // 方向判定：行带 ≥ 列带 → 本格属于横路（画横中线）；列带 > 行带 → 属于纵路（画纵中线）。
            // 二选一，杜绝在横路中间误画竖线、竖路中间误画横线、宽路带重复画线。
            if (hBand >= vBand && vBand >= 2 && ty === bandTop + Math.floor(vBand / 2)) {
                ctx.beginPath();
                ctx.moveTo(x0, y0); ctx.lineTo(x0 + TS, y0);
                ctx.stroke();
            } else if (vBand > hBand && hBand >= 2 && tx === bandL + Math.floor(hBand / 2)) {
                ctx.beginPath();
                ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + TS);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
    }
    if (t === T.WEED) {
        const cx = x0 + TS / 2, base = y0 + TS - 6;
        ctx.fillStyle = `rgba(70,112,62,${0.42 + n * 0.18})`;
        ctx.fillRect(cx - 7, base - 5, 2, 6);
        ctx.fillRect(cx - 1, base - 9, 2, 10);
        ctx.fillRect(cx + 5, base - 6, 2, 7);
        ctx.fillStyle = 'rgba(104,126,76,0.45)';
        ctx.fillRect(cx - 4, base - 3, 2, 4);
        ctx.fillRect(cx + 2, base - 4, 2, 5);
    }
    if (t === T.GROUND) {
        ctx.fillStyle = 'rgba(90,130,85,0.2)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('·', x0 + TS / 2, y0 + TS / 2);
    }
    // 人行道砖缝：混凝土方砖 18px 工字错缝（第二行偏移 9px）。
    // 右缘+下缘无条件（内部网格缝由本格承担）；左缘+上缘仅当左/上邻不是"人行道外观"
    // （SIDEWALK 或街道容器底）时补绘，相邻人行道格之间不画成双缝。
    // 注意错缝：第二行（y 18~36）的砖缝只在 x=9/27 格内，格边界 x=0/36 处是砖中，
    // 所以左/右缘缝只画第一行段（y 0~18）；上/下缘缝全段（砖行边界）。
    if (t === T.SIDEWALK) {
        // 车/残骸停人行道上也算"人行道外观"：相邻人行道不补画左/上缘缝线，避免白线穿过车身。
        // 叠加态障碍（碎石堆等）脚下是规划人行道时同样算人行道外观——砖缝不绕障碍画一圈，
        // 人行道带在障碍物下方保持连续（障碍=上层，人行道=下层）。
        const isWalkLook = v => v === T.SIDEWALK || v === T.TRASHBIN || v === T.CARDBOX || v === T.HYDRANT || v === T.NEWSSTAND || v === T.TIRES || v === T.CAR || v === T.CARWRECK;
        const walkUnderAt = (gx, gy) => isWalkLook(getTile(sv, gx, gy)) || groundTypeAt(sv, gx, gy) === T.SIDEWALK;
        ctx.strokeStyle = 'rgba(42,40,34,0.5)';
        ctx.lineWidth = 1;   // 地块边线固定 1px（sed 误伤修复：drawGroundTile 无 level 变量）
        ctx.beginPath();
        ctx.moveTo(x0 + TS, y0); ctx.lineTo(x0 + TS, y0 + 18);          // 右缘（第一行段）
        ctx.moveTo(x0, y0 + TS); ctx.lineTo(x0 + TS, y0 + TS);          // 下缘（全段）
        if (!walkUnderAt(tx - 1, ty)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + 18); }
        if (!walkUnderAt(tx, ty - 1)) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + TS, y0); }
        // 格内砖缝：第一行中缝 x=18；第二行错缝 x=9、x=27；横向中缝 y=18
        ctx.moveTo(x0 + 18, y0); ctx.lineTo(x0 + 18, y0 + 18);
        ctx.moveTo(x0 + 9, y0 + 18); ctx.lineTo(x0 + 9, y0 + TS);
        ctx.moveTo(x0 + 27, y0 + 18); ctx.lineTo(x0 + 27, y0 + TS);
        ctx.moveTo(x0, y0 + 18); ctx.lineTo(x0 + TS, y0 + 18);
        ctx.stroke();
        // 废墟人行道：破损裂纹 + 缺角，与城区完整人行道区分
        if (biome === 3) {
            ctx.strokeStyle = 'rgba(30,26,22,0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            const cx0 = x0 + 4 + Math.floor(n * 20), cy0 = y0 + 4 + Math.floor(n2 * 18);
            ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 + 5, cy0 + 6);
            ctx.moveTo(cx0 + 2, cy0 + 3); ctx.lineTo(cx0 + 8, cy0 + 2);
            ctx.stroke();
            if (n2 > 0.7) {
                ctx.fillStyle = 'rgba(24,22,18,0.35)';
                ctx.fillRect(x0 + 5 + Math.floor(n * 22), y0 + 5 + Math.floor(n2 * 20), 3, 3);
            }
        }
        // 边缘（在砖缝之后画，保证清晰）：只保留与路交界的白色路缘石条；
        // 去掉路缘石旁的暗影线与草地侧砌边线（内侧外侧的淡灰边缘）。
        // 路缘石按邻居格的"脚下真实地面"判定（而非邻居格上的物体类型）：
        // 停在路沿边的车、路面上的碎石堆/倒树（废墟残路）脚下是路面 → 仍补画路缘石；
        // 停在人行道内的车/杂物脚下是人行道 → 不算路面，避免在车头车尾两侧补出
        // 两条垂直于人行道的白线。
        const roadSurfaceAt = (gx, gy) => groundTypeAt(sv, gx, gy) === T.ROAD;
        ctx.fillStyle = 'rgba(158,156,150,0.85)';
        if (roadSurfaceAt(tx + 1, ty)) ctx.fillRect(x0 + TS - 3, y0, 2, TS + 1);
        if (roadSurfaceAt(tx, ty + 1)) ctx.fillRect(x0, y0 + TS - 3, TS + 1, 2);
        if (roadSurfaceAt(tx - 1, ty)) ctx.fillRect(x0, y0, 2, TS + 1);
        if (roadSurfaceAt(tx, ty - 1)) ctx.fillRect(x0, y0, TS + 1, 2);
    }
}

// ============================================================
// 世界渲染：静态背景离屏缓存 + 动态覆盖层
// 静态层（地块/建筑/树木/停放车辆/容器底座）只在"地块修改"或"镜头切格"时重绘一次，
// 静止/步行/驾驶期间每帧只贴两张离屏图（地面层 + 物体层）+ 中间插一层动态草 + 少量动态覆盖，
// 消除逐帧重绘地块的 CPU 峰值。层级：地面(静态草底) → 动态草 → 物体(树/箱/车/建筑) → 动态覆盖。
// 交互脉冲（车辆高亮、容器发光、植物本体与血条）等动画留在动态层按帧绘制。
// ============================================================
let _worldGroundCache = null;   // 地面层（BIOME_BG + 地面格，不透明）
let _worldObjectCache = null;   // 物体层（树/建筑/箱/车等，背景透明——画在草之上）

function drawWorld(ctx, sv, camX, camY, W, H) {
    const t0x = Math.floor(camX / TS) - 1, t0y = Math.floor(camY / TS) - 1;
    const t1x = Math.ceil((camX + W) / TS) + 1, t1y = Math.ceil((camY + H) / TS) + 1;
    const rev = sv._zombiePathRevision || 0;   // setTile 时递增：地块变化 → 静态层失效重建
    const cw = (t1x - t0x + 1) * TS, chh = (t1y - t0y + 1) * TS;
    // 2026-08-09 修复"垂直移动地图物体重影/复制粘贴"：
    // 拆层前只有一张缓存 blit 一次；拆成地面/物体两层后若各自 Math.round 取整，
    // camY 为小数时两层取整误差不同 → 物体相对地面每帧 ±1px 抖动 → 重影。
    // 修复：两层共用同一个取整坐标（bdx/bdy），相对位置恒定。
    const bdx = Math.round(t0x * TS - camX);
    const bdy = Math.round(t0y * TS - camY);
    // ① 地面层（不透明背景：BIOME_BG + 所有格地面）
    let g = _worldGroundCache;
    if (!g || g.rev !== rev || g.seed !== sv.world.seed ||
        g.t0x !== t0x || g.t0y !== t0y || g.t1x !== t1x || g.t1y !== t1y) {
        if (!g) { g = _worldGroundCache = {}; }
        if (!g.canvas || g.canvas.width !== cw || g.canvas.height !== chh) {
            g.canvas = makeOffscreen(cw, chh);
            g.bctx = g.canvas.getContext('2d');
        }
        g.rev = rev; g.seed = sv.world.seed;
        g.t0x = t0x; g.t0y = t0y; g.t1x = t1x; g.t1y = t1y;
        drawWorldGroundStatic(g.bctx, sv, t0x * TS, t0y * TS, cw, chh);
    }
    ctx.drawImage(g.canvas, bdx, bdy);
    // ② 动态草层（在地面之上、物体之下；只长在 GROUND/WEED，grassRenderLayer 内部已过滤）
    WGRASS.grassRenderLayer(ctx, sv, camX, camY, W, H);
    // ③ 物体层（树/建筑/箱/车/路障等，背景透明 → 物体盖过草）
    let o = _worldObjectCache;
    if (!o || o.rev !== rev || o.seed !== sv.world.seed ||
        o.t0x !== t0x || o.t0y !== t0y || o.t1x !== t1x || o.t1y !== t1y) {
        if (!o) { o = _worldObjectCache = {}; }
        if (!o.canvas || o.canvas.width !== cw || o.canvas.height !== chh) {
            o.canvas = makeOffscreen(cw, chh);
            o.bctx = o.canvas.getContext('2d');
        }
        o.rev = rev; o.seed = sv.world.seed;
        o.t0x = t0x; o.t0y = t0y; o.t1x = t1x; o.t1y = t1y;
        o.dyn = { cars: [], pulses: [], plants: [] };
        drawWorldObjectStatic(o.bctx, sv, t0x * TS, t0y * TS, cw, chh, o.dyn);
    }
    ctx.drawImage(o.canvas, bdx, bdy);
    drawWorldDynamic(ctx, sv, camX, camY, W, H, o.dyn);
}

function drawWorldDynamic(ctx, sv, camX, camY, W, H, dyn) {
    if (!dyn) return;
    // 靠近可交互的车辆：整辆重绘（脉冲高亮 + 操作提示呼吸动画；静态层已画底座）
    for (const car of dyn.cars) {
        // 接近判定逐帧复核（缓存只保证候选，玩家走动后按当前距离决定是否继续高亮）
        if (Math.hypot((car.tx + 0.5) - (sv.px / TS), (car.ty + 0.5) - (sv.py / TS)) >= 3.2) continue;
        drawCar(ctx, car.tx * TS - camX, car.ty * TS - camY, car.dir, {
            wreck: car.wreck, repaired: car.repaired, cond: car.cond,
            near: true, now: sv.now,
            owner: car.owner, infection: car.infection, seed: car.seed,
        });
    }
    // 可交互容器：发光描边脉冲（与静态底座同坐标，动画层按帧呼吸；
    // 高亮状态逐帧复核——掏空/被清空后脉冲立即消失，与旧版一致）
    for (const p of dyn.pulses) {
        if (!containerHighlight(sv, p.t, p.tx, p.ty)) continue;
        const sx = p.tx * TS - camX + TS / 2, sy = p.ty * TS - camY + TS / 2;
        const pulse = 0.4 + Math.sin(sv.now * 2.5 + p.tx * 1.7 + p.ty * 2.3) * 0.3;
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = p.kind === 'box' ? p.color : '#E8C46A';
        ctx.lineWidth = 1;
        if (p.kind === 'box') ctx.strokeRect(sx - TS / 2 + 5, sy - TS / 2 + 7, 26, 22);
        else ctx.strokeRect(sx - TS / 2 + 4.5, sy - TS / 2 + 3.5, TS - 8, TS - 8);
        ctx.globalAlpha = 1;
    }
    // 植物（野生芽/培育/感染）：本体 + 血条逐帧绘制（可能被激活/成长/受击）
    for (const pl of dyn.plants) {
        const pv = plantDisplay(sv, pl.tx, pl.ty);
        const sx = pl.tx * TS - camX + TS / 2, sy = pl.ty * TS - camY + TS / 2;
        if (!pv) {
            ctx.fillStyle = TILE_COLOR[pl.t] || '#FFFFFF';
            ctx.fillText(pl.t, sx, sy);
            continue;
        }
        const pData = sv.mods.plants && sv.mods.plants[pl.tx + ',' + pl.ty];
        let col = pv.color;
        if (pv.type === 'tamed' || pv.type === 'player') col = '#7CFF9E';
        if (pData && pData.hostile) col = '#FF7755';
        if (pv.hurt > 0) col = '#FFFFFF';   // 被僵尸啃咬受击闪白（与玩家/NPC 受击一致）
        drawPixelPlantBody(ctx, sx, sy, col, pv.name);
        if (pData && pData.hp < pData.maxHp) {
            const ratio = Math.max(0, pData.hp / pData.maxHp);
            ctx.fillStyle = 'rgba(20,0,0,0.8)';
            ctx.fillRect(sx - TS / 2 + 3, sy + TS / 2 - 2, TS - 6, 3);
            ctx.fillStyle = pData.type === 'player' ? '#44FF88' : '#66DD44';
            ctx.fillRect(sx - TS / 2 + 3, sy + TS / 2 - 2, (TS - 6) * ratio, 3);
        }
        if (pData && pData.hostile) {
            ctx.font = 'bold 12px "Microsoft YaHei", monospace';
            ctx.fillStyle = '#FF6644';
            ctx.textAlign = 'center';
            ctx.fillText('怒', sx + TS / 2, sy - 14);
        }
    }
    // 交互目标金色描边（碎石不是容器：可 F 开采但无宝箱式交互框，避免误导；
    // 2026-08-10 汽车也不画金色十字框——靠近汽车只保留 F 提示（操作汽车），去掉描边框）
    if (sv.promptTarget && sv.promptTarget.t !== T.RUBBLE
        && sv.promptTarget.t !== T.CAR && sv.promptTarget.t !== T.CARWRECK) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;
        ctx.strokeRect(sv.promptTarget.x * TS - camX + 2, sv.promptTarget.y * TS - camY + 2, TS - 4, TS - 4);
    }
    // 受损建筑/路障/汽车血条
    if (sv._damagedKeys && sv._damagedKeys.size > 0) {
        for (const key of sv._damagedKeys) {
            const m = sv.mods.tiles[key];
            if (!m || m.hp == null) { sv._damagedKeys.delete(key); continue; }
            const [gx, gy] = key.split(',');
            const sx = (+gx) * TS - camX, sy = (+gy) * TS - camY;
            if (sx < -TS || sx > W + TS || sy < -TS || sy > H + TS) continue;
            let max, barColor;
            if (m.built) {
                max = BUILD_HP[m.t] || 200;
                if (m.hp >= max) { sv._damagedKeys.delete(key); continue; }
                if (sv.now - (m.lastHit || 0) > 4) continue;
                barColor = '#FFB347';
            } else {
                if (m.t !== T.BARRICADE && m.t !== T.CAR && m.t !== T.CARWRECK) { sv._damagedKeys.delete(key); continue; }
                max = m.t === T.BARRICADE ? BARRICADE_HP : CAR_HP;
                if (m.hp >= max) { sv._damagedKeys.delete(key); continue; }
                barColor = '#DDAA33';
            }
            ctx.fillStyle = 'rgba(60,20,0,0.85)';
            ctx.fillRect(sx + 3, sy - 7, TS - 6, 3);
            ctx.fillStyle = barColor;
            ctx.fillRect(sx + 3, sy - 7, (TS - 6) * clamp(m.hp / max, 0, 1), 3);
        }
    }
}

// 静态层：确定性地块渲染（地块/建筑/树木/停放车辆/容器底座），只在地块变化或切格时调用
// 静态地面层：BIOME_BG 背景 + 每格实际地面（含静态草底/人行道/公路/楼缝阴影草地）。
// 与物体层分开缓存 → 动态草层可插入"地面之上、物体之下"。
function drawWorldGroundStatic(ctx, sv, camX, camY, W, H) {
    const cs = CHUNK * TS;
    const c0x = Math.floor(camX / cs), c0y = Math.floor(camY / cs);
    for (let cy = c0y; cy <= c0y + Math.ceil(H / cs); cy++)
        for (let cx = c0x; cx <= c0x + Math.ceil(W / cs); cx++) {
            ctx.fillStyle = BIOME_BG[chunkBiome(sv.world.seed, cx, cy)] || '#000';
            ctx.fillRect(cx * cs - camX, cy * cs - camY, cs, cs);
        }

    const t0x = Math.floor(camX / TS), t0y = Math.floor(camY / TS);
    const t1x = Math.ceil((camX + W) / TS), t1y = Math.ceil((camY + H) / TS);
    for (let ty = t0y; ty <= t1y; ty++) {
        for (let tx = t0x; tx <= t1x; tx++) {
            const t = getTile(sv, tx, ty);
            if (isGroundTile(t)) drawGroundTile(ctx, sv, tx, ty, camX, camY);
            else drawGroundTile(ctx, sv, tx, ty, camX, camY, groundTypeAt(sv, tx, ty));
        }
    }
}

// 静态物体层：树/建筑/箱/车/路障/野生草材等（背景透明 → 物体盖过动态草层）。
function drawWorldObjectStatic(ctx, sv, camX, camY, W, H, dyn) {
    // 2026-08-09 修复"垂直移动地图物体复制粘贴/重影"：物体层画布是透明背景，
    // 若复用同尺寸 canvas 时不先清空，旧位置的物体残留在画布上（叠加绘制），
    // 每次切格重建后同一个消防栓/容器被画多次 → 垂直移动出现"复制粘贴"。
    ctx.clearRect(0, 0, W, H);
    const t0x = Math.floor(camX / TS), t0y = Math.floor(camY / TS);
    const t1x = Math.ceil((camX + W) / TS), t1y = Math.ceil((camY + H) / TS);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${TS - 10}px "Microsoft YaHei", monospace`;
    let carDraws = null;
    const treeDraws = [];
    const buildingEdgeDraws = [];
    // 同一连通建筑只允许一个全局屋脊方向。L形/十字形只是从整体屋面裁掉缺口，
    // 不能在每一行、每一列重新选择坡向，否则会产生互相冲突的矩形亮暗块。
    if (!sv._buildingShapeCache || sv._buildingShapeCache.seed !== sv.world.seed) {
        sv._buildingShapeCache = { seed: sv.world.seed, tiles: new Map() };
    }
    const buildingShapeByTile = sv._buildingShapeCache.tiles;
    const isGeneratedBuildingTile = (ax, ay) => {
        const m = sv.mods.tiles[ax + ',' + ay];
        const tt = (m && !m.built) ? m.t : getTile(sv, ax, ay);
        return !(m && m.built) && (tt === T.WALL || tt === T.DOOR);
    };
    const getBuildingShape = (startX, startY) => {
        const startKey = startX + ',' + startY;
        const cached = buildingShapeByTile.get(startKey);
        if (cached) return cached;
        const queue = [[startX, startY]], cells = [], seen = new Set([startKey]);
        let minX = startX, maxX = startX, minY = startY, maxY = startY;
        for (let qi = 0; qi < queue.length && qi < 4096; qi++) {
            const [cx, cy] = queue[qi];
            cells.push([cx, cy]);
            minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
            minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
            for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
                const key = nx + ',' + ny;
                if (!seen.has(key) && isGeneratedBuildingTile(nx, ny)) {
                    seen.add(key);
                    queue.push([nx, ny]);
                }
            }
        }
        const cellKeys = new Set(cells.map(([x, y]) => x + ',' + y));
        const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
        let rooftopFeatureRect = null, cabinScore = Infinity;
        for (const [x, y] of cells) {
            if (!cellKeys.has((x + 1) + ',' + y) || !cellKeys.has(x + ',' + (y + 1)) || !cellKeys.has((x + 1) + ',' + (y + 1))) continue;
            const edgePenalty = (x <= minX || y <= minY || x + 1 >= maxX || y + 1 >= maxY) ? 12 : 0;
            const score = Math.abs(x + 0.5 - centerX) + Math.abs(y + 0.5 - centerY) + edgePenalty;
            if (score < cabinScore) { cabinScore = score; rooftopFeatureRect = { x, y, w: 2, h: 2 }; }
        }
        const featureRoll = hash2(sv.world.seed ^ 0x70F7, minX, minY);
        const rooftopStyle = featureRoll < 0.32 ? 'clean' : (featureRoll < 0.62 ? 'cabin' : (featureRoll < 0.84 ? 'utility' : 'skylight'));
        const rooftopCabin = rooftopStyle === 'cabin' ? rooftopFeatureRect : null;
        const shape = {
            minX, maxX, minY, maxY, size: cells.length,
            horizontal: (maxX - minX) >= (maxY - minY),
            rooftopStyle, rooftopFeatureRect, rooftopCabin,
        };
        for (const [cx, cy] of cells) buildingShapeByTile.set(cx + ',' + cy, shape);
        return shape;
    };
    for (let ty = t0y; ty <= t1y; ty++) {
        for (let tx = t0x; tx <= t1x; tx++) {
            const t = getTile(sv, tx, ty);
            const sx = tx * TS - camX + TS / 2, sy = ty * TS - camY + TS / 2;
            // 地面格：纯地面由 drawWorldGroundStatic 画在底层（静态草底），物体层跳过
            if (isGroundTile(t)) {
                continue;
            } else {
                // 物体作为上层叠加：物体脚下地面（人行道/公路/草地）已由地面层画好，
                // 物体层只画物体本身，背景透明 → 动态草夹在地面层与物体层之间。
                if (t === T.SPROUT || t === T.PLOT) {
                    // 植物统一走动态层：野生芽也可能被激活物化进 mods.plants（成长/受击），
                    // 静态层缓存会残留旧外观 → 全部按帧绘制（此类地块数量极少，开销可忽略）
                    dyn.plants.push({ tx, ty, t });
                } else if (t === T.CROP) {
                    drawWildForage(ctx, sx, sy, T.CROP, sv.world.seed, tx, ty);
                } else if (t === T.HERB || t === T.FLOWER) {
                    drawWildForage(ctx, sx, sy, t, sv.world.seed, tx, ty);
                } else if (t === T.TREE) {
                    const infection = visualInfectionAt(sv, tx, ty, 0x310);
                    const eraseColor = BIOME_BG[chunkBiome(sv.world.seed, Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))] || '#080810';
                    treeDraws.push({ sx, sy, infection, seed: sv.world.seed ^ tx ^ (ty << 8), eraseColor });
                } else if (t === T.WALL && !(sv.mods.tiles[tx + ',' + ty] && sv.mods.tiles[tx + ',' + ty].built)) {
                    const rx0 = tx * TS - camX, ry0 = ty * TS - camY;
                    const isWallN = (ax, ay) => { const m = sv.mods.tiles[ax + ',' + ay]; const tt = (m && !m.built) ? m.t : getTile(sv, ax, ay); return tt === T.WALL || tt === T.DOOR; };
                    const wallN = isWallN(tx, ty - 1), wallS = isWallN(tx, ty + 1);
                    const wallW = isWallN(tx - 1, ty), wallE = isWallN(tx + 1, ty);
                    const neighbors = (wallN ? 1 : 0) + (wallS ? 1 : 0) + (wallW ? 1 : 0) + (wallE ? 1 : 0);
                    const biome = chunkBiome(sv.world.seed, Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
                    const buildingShape = getBuildingShape(tx, ty);
                    // 只有真正很小的孤立墙组才按瓦砾处理；复合建筑被道路裁切出的端点仍属于完整房檐。
                    if (buildingShape.size < 4) {
                        const n2 = hash2(sv.world.seed ^ 0x8007, tx, ty);
                        const n3 = hash2(sv.world.seed ^ 0xB21C, tx, ty);
                        ctx.imageSmoothingEnabled = false;
                        const br = 55 + Math.floor(n2 * 16), bg = 48 + Math.floor(n2 * 12), bb = 40 + Math.floor(n2 * 8);
                        // 2-3块不规则碎块，不同位置和高度
                        const chunks = 2 + Math.floor(n2 * 2);
                        for (let ci = 0; ci < chunks; ci++) {
                            const cn = hash2(sv.world.seed ^ 0xD3B2 + ci, tx + ci, ty);
                            const cx0 = rx0 + 3 + Math.floor(cn * 14);
                            const cw = 5 + Math.floor(cn * 9);
                            const ch = 5 + Math.floor(cn * 12);
                            const cy0 = ry0 + TS - ch - Math.floor(cn * 4);
                            const v = Math.floor(cn * 10) - 5;
                            ctx.fillStyle = `rgb(${br + v},${bg + v},${bb + v})`;
                            // 不规则形状：顶部锯齿
                            ctx.fillRect(cx0, cy0 + 2, cw, ch - 2);
                            ctx.fillRect(cx0 + 1, cy0, cw - 2, 3);
                            // 裂缝
                            ctx.fillStyle = 'rgba(15,12,8,0.4)';
                            ctx.fillRect(cx0 + Math.floor(cn * (cw - 2)) + 1, cy0 + 2, 1, ch - 4);
                        }
                        // 散落碎石屑
                        ctx.fillStyle = `rgb(${br - 8},${bg - 6},${bb - 4})`;
                        for (let di = 0; di < 3; di++) {
                            const dn = hash2(sv.world.seed ^ 0xAE55 + di, tx, ty + di);
                            ctx.fillRect(rx0 + 4 + Math.floor(dn * 22), ry0 + TS - 3 - Math.floor(dn * 3), 2, 2);
                        }
                        // 底部碎片投影
                        ctx.fillStyle = 'rgba(0,0,0,0.15)';
                        ctx.fillRect(rx0 + 3, ry0 + TS - 1, TS - 6, 2);
                    } else {
                    const edgeMask = (wallN ? 8 : 0) | (wallS ? 4 : 0) | (wallW ? 2 : 0) | (wallE ? 1 : 0);
                    const n2 = hash2(sv.world.seed ^ 0x8007, tx, ty);
                    const rowsAbove = ty - buildingShape.minY;
                    const rowsBelow = buildingShape.maxY - ty;
                    const colsLeft = tx - buildingShape.minX;
                    const colsRight = buildingShape.maxX - tx;
                    const horizontalWing = buildingShape.horizontal;
                    const roofTopology = rowsAbove | (rowsBelow << 5) | (colsLeft << 10) | (colsRight << 15) | (horizontalWing ? (1 << 20) : 0);
                    const bKey = ((sv.world.seed ^ (tx * 73856093) ^ (ty * 19349663) ^ (edgeMask * 97) ^ (biome * 7919) ^ (roofTopology * 31)) >>> 0);
                    let bCanvas = cacheGet(_brickCache, bKey);
                    if (!bCanvas) {
                        bCanvas = makeOffscreen(TS + 2, TS + 8);
                        const b = bCanvas.getContext('2d');
                        b.imageSmoothingEnabled = false;
                        const isRuins = biome === 3;
                        const isUrban = biome === 0;
                        const isWild = biome === 2;
                        // 建筑主体颜色按生态区固定，细微风化仍由像素噪点承担。
                        // 禁止每个单元格独立改变底色，否则连续屋面会出现方块状假屋脊。
                        // 荒野林中小屋使用原木墙/深棕坡顶配色，与城市建筑区分。
                        const roofR = isRuins ? 47 : isUrban ? 78 : isWild ? 86 : 128;
                        const roofG = isRuins ? 42 : isUrban ? 84 : isWild ? 60 : 70;
                        const roofB = isRuins ? 39 : isUrban ? 94 : isWild ? 38 : 47;
                        const wallR = isRuins ? 60 : isUrban ? 95 : isWild ? 140 : 156;
                        const wallG = isRuins ? 52 : isUrban ? 96 : isWild ? 100 : 126;
                        const wallB = isRuins ? 43 : isUrban ? 101 : isWild ? 60 : 83;
                        // 内部单元的屋面铺满整格；只有真正的南侧外缘才预留8px墙体立面。
                        const roofH = wallS ? TS : TS - 8;
                        // 建筑格必须先完全封底。任何坡面、立面或缓存分支漏画时都不能透出绿色地面。
                        b.fillStyle = `rgb(${roofR - 8},${roofG - 8},${roofB - 6})`;
                        b.fillRect(0, 0, TS + 1, TS + 1);
                        if (!isUrban && !isRuins) {
                            drawSuburbanRoofSurface(b, sv.world.seed, tx, ty, roofH,
                                { rowsAbove, rowsBelow, colsLeft, colsRight, horizontalWing },
                                { roofR, roofG, roofB });
                            // 北、南檐口只出现在建筑外缘，替代内部重复条带。
                            if (!wallN) {
                                b.fillStyle = `rgb(${roofR + 8},${roofG + 5},${roofB + 2})`;
                                b.fillRect(0, 0, TS + 1, 2);
                                b.fillStyle = 'rgba(0,0,0,0.18)';
                                b.fillRect(0, 2, TS + 1, 1);
                            }
                            if (!wallS) {
                                b.fillStyle = 'rgba(0,0,0,0.24)';
                                b.fillRect(0, Math.max(0, roofH - 2), TS + 1, 2);
                            }
                        } else if (isUrban) {
                            // 城区天台：轻微纵深渐变的防水层，外轮廓女儿墙负责表达屋顶高度。
                            for (let py = 0; py < roofH; py++) {
                                const depth = Math.floor((py / Math.max(1, roofH - 1)) * 8) - 4;
                                b.fillStyle = `rgb(${roofR + depth},${roofG + depth},${roofB + depth})`;
                                b.fillRect(0, py, TS + 1, 1);
                            }
                            // 防水板块缝同样按世界坐标连续，不在单元边界重新起算。
                            drawContinuousRoofTiles(b, tx, ty, roofH, 'urban');
                            const roofStyle = buildingShape.rooftopStyle || 'clean';
                            const featureRect = buildingShape.rooftopFeatureRect;
                            const cabin = buildingShape.rooftopCabin;
                            const onCabin = !!cabin && tx >= cabin.x && tx < cabin.x + cabin.w && ty >= cabin.y && ty < cabin.y + cabin.h;
                            const belowCabin = !!cabin && tx >= cabin.x && tx < cabin.x + cabin.w && ty === cabin.y + cabin.h;
                            const rightOfCabin = !!cabin && tx === cabin.x + cabin.w && ty >= cabin.y && ty < cabin.y + cabin.h;
                            // 楼梯间/机房投在天台面上的阴影，方向固定向南与向东，统一场景光源。
                            if (belowCabin) {
                                b.fillStyle = 'rgba(8,12,17,0.34)';
                                b.fillRect(3, 0, TS - 5, 7);
                            }
                            if (rightOfCabin) {
                                b.fillStyle = 'rgba(8,12,17,0.28)';
                                b.fillRect(0, 3, 7, Math.max(0, roofH - 5));
                            }
                            // 女儿墙只沿真实外边界绘制：亮墙帽、暗立面和落在天台上的投影形成2.5D高差。
                            if (!wallN) {
                                b.fillStyle = `rgb(${wallR + 16},${wallG + 17},${wallB + 18})`;
                                b.fillRect(0, 0, TS + 1, 2);
                                b.fillStyle = `rgb(${wallR - 12},${wallG - 12},${wallB - 10})`;
                                b.fillRect(0, 2, TS + 1, 2);
                                b.fillStyle = 'rgba(8,12,16,0.28)';
                                b.fillRect(0, 4, TS + 1, 3);
                            }
                            if (!wallW) {
                                b.fillStyle = `rgb(${wallR + 8},${wallG + 9},${wallB + 10})`;
                                b.fillRect(0, 0, 2, roofH);
                                b.fillStyle = `rgb(${wallR - 18},${wallG - 18},${wallB - 16})`;
                                b.fillRect(2, 0, 2, roofH);
                                b.fillStyle = 'rgba(8,12,16,0.22)';
                                b.fillRect(4, 0, 2, roofH);
                            }
                            if (!wallE) {
                                b.fillStyle = `rgb(${wallR + 12},${wallG + 13},${wallB + 14})`;
                                b.fillRect(TS - 2, 0, 3, roofH);
                                b.fillStyle = 'rgba(8,12,16,0.3)';
                                b.fillRect(TS - 4, 0, 2, roofH);
                            }
                            if (!wallS) {
                                const parapetY = Math.max(0, roofH - 4);
                                b.fillStyle = 'rgba(8,12,16,0.24)';
                                b.fillRect(0, parapetY - 2, TS + 1, 2);
                                b.fillStyle = `rgb(${wallR + 10},${wallG + 11},${wallB + 12})`;
                                b.fillRect(0, parapetY, TS + 1, 2);
                                b.fillStyle = `rgb(${wallR - 16},${wallG - 16},${wallB - 14})`;
                                b.fillRect(0, parapetY + 2, TS + 1, 2);
                            }
                            // 空调外机（确定性位置）
                            if (roofStyle === 'utility' && !onCabin && !belowCabin && !rightOfCabin && n2 > 0.28 && n2 < 0.86 && roofH > 14 && ((tx + ty * 3) & 3) === 0) {
                                const ux = Math.floor(n2 * 14) + 5, uy = Math.floor((n2 * 7) % (roofH - 12)) + 4;
                                b.fillStyle = '#5a5e62';
                                b.fillRect(ux, uy, 8, 6);
                                b.fillStyle = '#4a4e50';
                                b.fillRect(ux + 1, uy + 1, 6, 4);
                                b.fillStyle = '#3a3e40';
                                b.fillRect(ux + 2, uy + 2, 4, 1);
                                b.fillRect(ux + 2, uy + 4, 4, 1);
                                b.fillStyle = 'rgba(140,150,160,0.3)';
                                b.fillRect(ux, uy, 8, 1);
                            }
                            // 通风管
                            if ((roofStyle === 'utility' || roofStyle === 'cabin') && !onCabin && n2 > 0.6 && roofH > 10 && ((tx * 3 + ty) % 5) === 0) {
                                const vx = Math.floor(n2 * 20) + 8, vy = Math.floor(n2 * 5) + 3;
                                b.fillStyle = '#6a6e72';
                                b.fillRect(vx, vy, 4, 4);
                                b.fillStyle = '#4a4e52';
                                b.fillRect(vx + 1, vy, 2, 1);
                            }
                            // 水渍
                            if (n2 < 0.4) {
                                b.fillStyle = 'rgba(50,60,50,0.12)';
                                b.fillRect(Math.floor(n2 * 18) + 3, Math.floor(n2 * 8) + 5, 6, 4);
                            }
                            // 低矮采光顶：与楼梯间不同，它嵌在屋面中，不产生高墙立面。
                            if (roofStyle === 'skylight' && featureRect && tx >= featureRect.x && tx < featureRect.x + featureRect.w && ty >= featureRect.y && ty < featureRect.y + featureRect.h) {
                                const fx0 = tx === featureRect.x ? 7 : 0;
                                const fy0 = ty === featureRect.y ? 8 : 0;
                                const fx1 = tx === featureRect.x + featureRect.w - 1 ? TS - 7 : TS + 1;
                                const fy1 = ty === featureRect.y + featureRect.h - 1 ? Math.min(roofH - 7, TS - 7) : roofH;
                                b.fillStyle = '#303b43';
                                b.fillRect(fx0, fy0, Math.max(0, fx1 - fx0), Math.max(0, fy1 - fy0));
                                b.fillStyle = '#647f8d';
                                b.fillRect(fx0 + 2, fy0 + 2, Math.max(0, fx1 - fx0 - 4), Math.max(0, fy1 - fy0 - 4));
                                b.fillStyle = 'rgba(190,220,228,0.28)';
                                b.fillRect(fx0 + 3, fy0 + 3, Math.max(0, fx1 - fx0 - 7), 2);
                                b.fillStyle = 'rgba(20,28,34,0.55)';
                                if (tx === featureRect.x + 1) b.fillRect(0, fy0, 2, Math.max(0, fy1 - fy0));
                                if (ty === featureRect.y + 1) b.fillRect(fx0, 0, Math.max(0, fx1 - fx0), 2);
                            }
                            // 现实天台主体：2×2连续楼梯间/机房。顶面、立面和投影分层，不是平面装饰图标。
                            if (onCabin) {
                                const northEdge = ty === cabin.y, southEdge = ty === cabin.y + cabin.h - 1;
                                const westEdge = tx === cabin.x, eastEdge = tx === cabin.x + cabin.w - 1;
                                const x0 = westEdge ? 4 : 0, x1 = eastEdge ? TS - 5 : TS + 1;
                                const y0 = northEdge ? 4 : 0, y1 = southEdge ? Math.min(roofH - 6, TS - 6) : roofH;
                                b.fillStyle = '#69747d';
                                b.fillRect(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
                                // 连续金属/混凝土顶板接缝。
                                b.fillStyle = 'rgba(35,42,48,0.18)';
                                for (let py = y0; py < y1; py++) {
                                    if ((((ty * TS + py) % 18) + 18) % 18 === 0) b.fillRect(x0, py, Math.max(0, x1 - x0), 1);
                                }
                                for (let px = x0; px < x1; px++) {
                                    if ((((tx * TS + px) % 24) + 24) % 24 === 0) b.fillRect(px, y0, 1, Math.max(0, y1 - y0));
                                }
                                if (northEdge) {
                                    b.fillStyle = '#9aa4aa';
                                    b.fillRect(x0, y0, Math.max(0, x1 - x0), 2);
                                    b.fillStyle = '#505a62';
                                    b.fillRect(x0, y0 + 2, Math.max(0, x1 - x0), 2);
                                }
                                if (westEdge) {
                                    b.fillStyle = '#89949b';
                                    b.fillRect(x0, y0, 2, Math.max(0, y1 - y0));
                                }
                                if (eastEdge) {
                                    b.fillStyle = '#414a52';
                                    b.fillRect(x1, y0 + 2, 5, Math.max(0, y1 - y0 + 4));
                                    b.fillStyle = 'rgba(8,12,16,0.25)';
                                    b.fillRect(x1 - 2, y0 + 2, 2, Math.max(0, y1 - y0));
                                }
                                if (southEdge) {
                                    b.fillStyle = '#465058';
                                    b.fillRect(x0 + 2, y1, Math.max(0, x1 - x0 + (eastEdge ? 5 : 0)), 6);
                                    b.fillStyle = '#30383e';
                                    b.fillRect(x0 + 2, y1 + 4, Math.max(0, x1 - x0 + (eastEdge ? 5 : 0)), 2);
                                    // 楼梯间检修门位于南立面。
                                    if (westEdge) {
                                        b.fillStyle = '#252d32';
                                        b.fillRect(x0 + 10, y1 + 1, 12, 5);
                                        b.fillStyle = '#a2a96c';
                                        b.fillRect(x0 + 19, y1 + 3, 1, 1);
                                    }
                                }
                                // 顶部天窗只画一次，跨单元连续主体仍保持克制。
                                if (northEdge && westEdge) {
                                    b.fillStyle = '#343f47';
                                    b.fillRect(13, 12, 15, 10);
                                    b.fillStyle = '#718b98';
                                    b.fillRect(15, 14, 11, 6);
                                    b.fillStyle = 'rgba(190,220,228,0.35)';
                                    b.fillRect(16, 14, 8, 2);
                                    b.fillStyle = 'rgba(8,12,16,0.28)';
                                    b.fillRect(15, 20, 13, 3);
                                }
                            }
                            // 女儿墙转角加高，避免L形凹角看成单纯贴图切口。
                            b.fillStyle = 'rgba(185,192,198,0.55)';
                            if (!wallN && !wallW) b.fillRect(0, 0, 4, 3);
                            if (!wallN && !wallE) b.fillRect(TS - 3, 0, 4, 3);
                            if (!wallS && !wallW) b.fillRect(0, Math.max(0, roofH - 4), 4, 3);
                            if (!wallS && !wallE) b.fillRect(TS - 3, Math.max(0, roofH - 4), 4, 3);
                        } else {
                            // 废墟：残破屋顶（破洞+横梁+碎屑+塌陷）
                            for (let py = 0; py < roofH; py++) {
                                const grad = Math.floor((py / roofH) * 10) - 5;
                                const dmg = (hash2(sv.world.seed ^ 0xD3CA, tx * TS, ty * TS + py) > 0.85) ? -12 : 0;
                                b.fillStyle = `rgb(${roofR + grad + dmg},${roofG + grad + dmg},${roofB + grad + dmg})`;
                                b.fillRect(0, py, TS + 1, 1);
                            }
                            drawContinuousRoofTiles(b, tx, ty, roofH, 'ruins');
                            // 不规则破洞（露出内部黑暗）
                            const holeCount = 1 + Math.floor(n2 * 2);
                            for (let hi = 0; hi < holeCount; hi++) {
                                const hxn = hash2(sv.world.seed ^ 0x40E1 + hi, tx, ty);
                                const hx = Math.floor(hxn * (TS - 10)) + 3;
                                const hy = Math.floor((hxn * 13) % (roofH - 8)) + 2;
                                const hw = 4 + Math.floor(hxn * 4);
                                const hh = 3 + Math.floor(hxn * 3);
                                b.fillStyle = '#0e0c0a';
                                b.fillRect(hx, hy, hw, hh);
                                // 破洞边缘碎裂
                                b.fillStyle = 'rgba(30,25,20,0.6)';
                                b.fillRect(hx - 1, hy, 1, hh);
                                b.fillRect(hx + hw, hy, 1, hh);
                            }
                            // 露出的横梁
                            b.fillStyle = '#4a3828';
                            const beamY = Math.floor(n2 * (roofH - 6)) + 3;
                            b.fillRect(2, beamY, TS - 4, 2);
                            b.fillStyle = 'rgba(60,45,30,0.4)';
                            b.fillRect(2, beamY + 2, TS - 4, 1);
                            // 碎屑散布
                            b.fillStyle = 'rgba(50,44,38,0.5)';
                            for (let di = 0; di < 4; di++) {
                                const dn = hash2(sv.world.seed ^ 0xD3B2 + di, tx + di, ty);
                                b.fillRect(Math.floor(dn * (TS - 4)) + 2, Math.floor(dn * 13) % roofH, 2, 1);
                            }
                        }
                        // 南墙立面（正面，屋檐下方露出的墙面）
                        if (!wallS) {
                            const wy = TS - 8;
                            for (let py = 0; py < 7; py++) {
                                const bv = (py % 3 === 2) ? -8 : Math.floor(n2 * 6) - 3;
                                b.fillStyle = `rgb(${wallR + bv},${wallG + bv},${wallB + bv})`;
                                b.fillRect(0, wy + py, TS + 1, 1);
                            }
                            // 窗户按连续南立面的真实开间排列：统一高度、隔一格一窗、端部留墙垛。
                            let facadeLeft = 0, facadeRight = 0;
                            for (let d = 1; d <= 24 && isWallN(tx - d, ty) && !isWallN(tx - d, ty + 1); d++) facadeLeft++;
                            for (let d = 1; d <= 24 && isWallN(tx + d, ty) && !isWallN(tx + d, ty + 1); d++) facadeRight++;
                            const facadeLen = facadeLeft + 1 + facadeRight;
                            const facadeIdx = facadeLeft;
                            const windowPhase = Math.floor(hash2(sv.world.seed ^ 0x91A7, tx - facadeLeft, ty) * 2);
                            const hasWindow = facadeLen >= 3 && facadeIdx > 0 && facadeIdx < facadeLen - 1
                                && ((facadeIdx + windowPhase) % 2 === 0);
                            if (hasWindow) {
                                const winW = isUrban ? 12 : 10, winH = 5;
                                const wx = Math.floor((TS - winW) / 2), winY = wy + 1;
                                b.fillStyle = isRuins ? '#3a3230' : isUrban ? '#555b60' : '#66513d';
                                b.fillRect(wx - 1, winY - 1, winW + 2, winH + 2);
                                b.fillStyle = isRuins && n2 > .55 ? '#171412' : (isUrban ? '#294858' : '#253746');
                                b.fillRect(wx, winY, winW, winH);
                                // 中梃和上下窗格形成真实双扇窗比例。
                                b.fillStyle = isUrban ? '#78868c' : '#80694f';
                                b.fillRect(wx + Math.floor(winW / 2), winY, 1, winH);
                                b.fillRect(wx, winY + 2, winW, 1);
                                b.fillStyle = 'rgba(155,190,205,0.28)';
                                b.fillRect(wx + 1, winY + 1, Math.floor(winW / 2) - 2, 1);
                                b.fillStyle = isRuins ? '#4a4038' : isUrban ? '#697177' : '#756047';
                                b.fillRect(wx - 1, winY + winH, winW + 2, 1);
                            }
                            if (isRuins && n2 > 0.5) {
                                b.strokeStyle = 'rgba(10,8,6,0.6)';
                                b.lineWidth = 1;
                                b.beginPath();
                                b.moveTo(Math.floor(n2 * 20) + 4, wy);
                                b.lineTo(Math.floor(n2 * 20) + 7, wy + 7);
                                b.stroke();
                            }
                            // 屋檐线 + 建筑底部落地阴影（画在建筑格内，不溢出任一侧人行道带）
                            b.fillStyle = 'rgba(0,0,0,0.35)';
                            b.fillRect(0, wy - 1, TS + 1, 1);
                            b.fillStyle = 'rgba(0,0,0,0.28)';
                            b.fillRect(0, TS - 2, TS + 1, 2);
                            b.fillStyle = 'rgba(0,0,0,0.14)';
                            b.fillRect(0, TS - 1, TS + 1, 1);
                        }
                        // 西墙：瓦片左边缘的窄条（墙体厚度，暗色）
                        if (!wallW) {
                            b.fillStyle = `rgb(${wallR - 20},${wallG - 18},${wallB - 14})`;
                            b.fillRect(0, 0, 3, roofH);
                            b.fillStyle = 'rgba(0,0,0,0.3)';
                            b.fillRect(3, 0, 1, roofH);
                            if ((((ty + rowsAbove) & 1) === 0) && roofH > 15) {
                                b.fillStyle = '#26343b';
                                b.fillRect(0, 10, 2, 7);
                                b.fillStyle = 'rgba(140,175,190,0.28)';
                                b.fillRect(0, 11, 1, 2);
                            }
                        }
                        // 东墙：瓦片右边缘的窄条
                        if (!wallE) {
                            b.fillStyle = `rgb(${wallR - 16},${wallG - 14},${wallB - 10})`;
                            b.fillRect(TS - 2, 0, 3, roofH);
                            b.fillStyle = 'rgba(0,0,0,0.3)';
                            b.fillRect(TS - 3, 0, 1, roofH);
                            if ((((ty + rowsAbove) & 1) === 0) && roofH > 15) {
                                b.fillStyle = '#2d3d45';
                                b.fillRect(TS - 1, 10, 2, 7);
                                b.fillStyle = 'rgba(145,180,195,0.28)';
                                b.fillRect(TS, 11, 1, 2);
                            }
                        }
                        // 北墙：顶部女儿墙边缘（1-2px暗条）
                        if (!wallN) {
                            b.fillStyle = `rgb(${wallR - 12},${wallG - 10},${wallB - 8})`;
                            b.fillRect(0, 0, TS + 1, 2);
                            b.fillStyle = 'rgba(0,0,0,0.2)';
                            b.fillRect(0, 2, TS + 1, 1);
                        }
                        // 天台细节（屋顶面上的护栏点/设备）
                        if (isUrban && n2 > 0.2 && n2 < 0.6 && roofH > 16) {
                            // 护栏点（天台边缘的小柱）
                            b.fillStyle = 'rgba(80,85,90,0.4)';
                            for (let px = 4; px < TS - 3; px += 7) {
                                b.fillRect(px, 3, 2, 2);
                                b.fillRect(px, roofH - 5, 2, 2);
                            }
                        }
                        // 时间风化（锈迹/苔藓/水渍/漆面脱落）
                        const age = hash2(sv.world.seed ^ 0xAE6E, tx, ty);
                        if (age > 0.3) {
                            // 水渍/苔藓（底部和角落偏多）
                            const mossCount = Math.floor((age - 0.3) * 6);
                            for (let mi = 0; mi < mossCount; mi++) {
                                const mn = hash2(sv.world.seed ^ 0xAE55 + mi, tx + mi, ty);
                                const mx = Math.floor(mn * (TS - 4)) + 1;
                                const my = Math.floor(mn * 13) % roofH;
                                b.fillStyle = isUrban ? 'rgba(40,55,45,0.2)' : 'rgba(50,70,40,0.18)';
                                b.fillRect(mx, my, 2 + Math.floor(mn * 3), 1 + Math.floor(mn * 2));
                            }
                        }
                        if (age > 0.5 && isUrban) {
                            // 城区：锈迹/金属氧化（空调/通风口附近）
                            b.fillStyle = 'rgba(120,70,30,0.2)';
                            const rx = Math.floor(age * 18) + 4, ry = Math.floor(age * 7) % (roofH - 4) + 2;
                            b.fillRect(rx, ry, 3, 2);
                            b.fillStyle = 'rgba(100,55,20,0.15)';
                            b.fillRect(rx + 1, ry + 2, 2, 2);
                        }
                        if (age > 0.6 && !isUrban && !isRuins) {
                            // 郊区：瓦片破损/缺失（露出底层暗色）
                            const chipCount = Math.floor((age - 0.6) * 5);
                            for (let ci = 0; ci < chipCount; ci++) {
                                const cn = hash2(sv.world.seed ^ 0xC419 + ci, tx, ty + ci);
                                b.fillStyle = 'rgba(30,22,16,0.4)';
                                b.fillRect(Math.floor(cn * (TS - 3)) + 1, Math.floor(cn * 11) % roofH, 2, 2);
                            }
                        }
                        if (!wallS && age > 0.4) {
                            // 南墙风化：漆面脱落/墙面污渍
                            const wy2 = TS - 8;
                            const stainCount = Math.floor((age - 0.4) * 4);
                            for (let si = 0; si < stainCount; si++) {
                                const sn = hash2(sv.world.seed ^ 0x57A1 + si, tx + si, ty);
                                b.fillStyle = 'rgba(30,25,18,0.2)';
                                b.fillRect(Math.floor(sn * (TS - 6)) + 2, wy2 + 1 + Math.floor(sn * 4), 2 + Math.floor(sn * 3), 1);
                            }
                        }
                        cacheSet(_brickCache, bKey, bCanvas);
                    }
                    ctx.drawImage(bCanvas, rx0, ry0);
                    buildingEdgeDraws.push({ x: rx0, y: ry0, n: !wallN, s: !wallS, w: !wallW, e: !wallE, biome });
                    } // end neighbors >= 2
                } else if (t === T.DOOR && !(sv.mods.tiles[tx + ',' + ty] && sv.mods.tiles[tx + ',' + ty].built)) {
                    const rx0 = tx * TS - camX, ry0 = ty * TS - camY;
                    const n2 = hash2(sv.world.seed ^ 0x8007, tx, ty);
                    const isWallAdj = (ax, ay) => { const m = sv.mods.tiles[ax + ',' + ay]; const tt = (m && !m.built) ? m.t : getTile(sv, ax, ay); return tt === T.WALL || tt === T.DOOR; };
                    const dN = !isWallAdj(tx, ty - 1), dS = !isWallAdj(tx, ty + 1);
                    const dW = !isWallAdj(tx - 1, ty), dE = !isWallAdj(tx + 1, ty);
                    // 门可能刚好落在区块边界。材质类型必须取门内侧相邻屋面，不能按门格自身区块另选一套纹理。
                    const materialTx = dW ? tx + 1 : (dE ? tx - 1 : tx);
                    const materialTy = dN ? ty + 1 : (dS ? ty - 1 : ty);
                    const biome = chunkBiome(sv.world.seed, Math.floor(materialTx / CHUNK), Math.floor(materialTy / CHUNK));
                    const isRuins = biome === 3;
                    const isUrban = biome === 0;
                    const isWild = biome === 2;
                    const roofR = isRuins ? 47 : isUrban ? 78 : isWild ? 86 : 128;
                    const roofG = isRuins ? 42 : isUrban ? 84 : isWild ? 60 : 70;
                    const roofB = isRuins ? 39 : isUrban ? 94 : isWild ? 38 : 47;
                    const wallR = isRuins ? 60 : isUrban ? 95 : isWild ? 140 : 156;
                    const wallG = isRuins ? 52 : isUrban ? 96 : isWild ? 100 : 126;
                    const wallB = isRuins ? 43 : isUrban ? 101 : isWild ? 60 : 83;
                    ctx.imageSmoothingEnabled = false;
                    // 门格直接使用整栋连通建筑的唯一边界和屋脊方向。
                    const buildingShape = getBuildingShape(tx, ty);
                    const rowsAbove = ty - buildingShape.minY;
                    const rowsBelow = buildingShape.maxY - ty;
                    const colsLeft = tx - buildingShape.minX;
                    const colsRight = buildingShape.maxX - tx;
                    const horizontalWing = buildingShape.horizontal;
                    const doorRoofCanvas = makeOffscreen(TS + 2, TS + 1);
                    const doorRoof = doorRoofCanvas.getContext('2d');
                    doorRoof.imageSmoothingEnabled = false;
                    if (!isUrban && !isRuins) {
                        drawSuburbanRoofSurface(doorRoof, sv.world.seed, tx, ty, TS,
                            { rowsAbove, rowsBelow, colsLeft, colsRight, horizontalWing },
                            { roofR, roofG, roofB });
                    } else {
                        for (let py = 0; py < TS; py++) {
                            const grad = Math.floor((py / TS) * (isUrban ? 8 : 10)) - 4;
                            doorRoof.fillStyle = `rgb(${roofR + grad},${roofG + grad},${roofB + grad})`;
                            doorRoof.fillRect(0, py, TS + 1, 1);
                        }
                    }
                    // 门所在屋顶格沿用相邻建筑的全局纹理坐标，四个方向均可无缝衔接。
                    if (isUrban || isRuins) {
                        drawContinuousRoofTiles(doorRoof, tx, ty, TS, isRuins ? 'ruins' : 'urban');
                    }
                    // 和普通墙格一样：先在整数像素离屏画布完成纹理，再整体贴入镜头。
                    // 避免相机小数偏移让逐像素填充发生插值，形成门格独有的密集暗网。
                    ctx.drawImage(doorRoofCanvas, rx0, ry0);
                    // 门格复用普通屋面的风化密度，避免入口周围出现过分干净的方形补丁。
                    const doorAge = hash2(sv.world.seed ^ 0xAE6E, tx, ty);
                    if (doorAge > 0.3) {
                        const mossCount = Math.floor((doorAge - 0.3) * 6);
                        for (let mi = 0; mi < mossCount; mi++) {
                            const mn = hash2(sv.world.seed ^ 0xAE55 + mi, tx + mi, ty);
                            const mx = Math.floor(mn * (TS - 4)) + 1;
                            const my = Math.floor(mn * 13) % TS;
                            ctx.fillStyle = isUrban ? 'rgba(40,55,45,0.2)' : 'rgba(50,70,40,0.18)';
                            ctx.fillRect(rx0 + mx, ry0 + my, 2 + Math.floor(mn * 3), 1 + Math.floor(mn * 2));
                        }
                    }
                    if (doorAge > 0.6 && !isUrban && !isRuins) {
                        const chipCount = Math.floor((doorAge - 0.6) * 5);
                        for (let ci = 0; ci < chipCount; ci++) {
                            const cn = hash2(sv.world.seed ^ 0xC419 + ci, tx, ty + ci);
                            ctx.fillStyle = 'rgba(30,22,16,0.4)';
                            ctx.fillRect(rx0 + Math.floor(cn * (TS - 3)) + 1, ry0 + Math.floor(cn * 11) % TS, 2, 2);
                        }
                    }
                    if (dS) {
                        // 南门：屋檐线 + 南墙立面 + 门洞
                        const wy = ry0 + TS - 8;
                        ctx.fillStyle = 'rgba(0,0,0,0.35)';
                        ctx.fillRect(rx0, wy - 1, TS + 1, 1);
                        for (let py = 0; py < 7; py++) {
                            const bv = (py % 3 === 2) ? -8 : Math.floor(n2 * 6) - 3;
                            ctx.fillStyle = `rgb(${wallR + bv},${wallG + bv},${wallB + bv})`;
                            ctx.fillRect(rx0, wy + py, TS + 1, 1);
                        }
                        const doorX = rx0 + 10, doorY = wy - 2;
                        ctx.fillStyle = isRuins ? '#1a1512' : '#2a2018';
                        ctx.fillRect(doorX, doorY, 16, 10);
                        ctx.strokeStyle = isRuins ? '#4a3a2a' : '#8a6a42';
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(doorX - 0.5, doorY - 0.5, 17, 11);
                        ctx.fillStyle = '#c8a860';
                        ctx.fillRect(doorX + 12, doorY + 4, 2, 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.28)';
                        ctx.fillRect(rx0, ry0 + TS - 2, TS + 1, 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.14)';
                        ctx.fillRect(rx0, ry0 + TS - 1, TS + 1, 1);
                    } else if (dW) {
                        // 西门：左侧墙立面 + 门洞
                        const wx = rx0;
                        ctx.fillStyle = 'rgba(0,0,0,0.3)';
                        ctx.fillRect(wx, ry0, 1, TS + 1);
                        for (let px = 1; px < 7; px++) {
                            const bv = (px % 3 === 0) ? -8 : Math.floor(n2 * 6) - 3;
                            ctx.fillStyle = `rgb(${wallR + bv - 6},${wallG + bv - 6},${wallB + bv - 4})`;
                            ctx.fillRect(wx + px, ry0 + 2, 1, TS - 4);
                        }
                        const doorY = ry0 + 8, doorX = wx + 1;
                        ctx.fillStyle = isRuins ? '#1a1512' : '#2a2018';
                        ctx.fillRect(doorX, doorY, 6, 16);
                        ctx.strokeStyle = isRuins ? '#4a3a2a' : '#8a6a42';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(doorX - 0.5, doorY - 0.5, 7, 17);
                        ctx.fillStyle = '#c8a860';
                        ctx.fillRect(doorX + 4, doorY + 7, 2, 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.2)';
                        ctx.fillRect(rx0, ry0 + TS - 1, TS + 1, 1);
                    } else if (dE) {
                        // 东门：右侧墙立面 + 门洞
                        const wx = rx0 + TS - 7;
                        ctx.fillStyle = 'rgba(0,0,0,0.3)';
                        ctx.fillRect(rx0 + TS, ry0, 1, TS + 1);
                        for (let px = 0; px < 7; px++) {
                            const bv = (px % 3 === 0) ? -8 : Math.floor(n2 * 6) - 3;
                            ctx.fillStyle = `rgb(${wallR + bv - 4},${wallG + bv - 4},${wallB + bv - 2})`;
                            ctx.fillRect(wx + px, ry0 + 2, 1, TS - 4);
                        }
                        const doorY = ry0 + 8, doorX = wx + 1;
                        ctx.fillStyle = isRuins ? '#1a1512' : '#2a2018';
                        ctx.fillRect(doorX, doorY, 6, 16);
                        ctx.strokeStyle = isRuins ? '#4a3a2a' : '#8a6a42';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(doorX - 0.5, doorY - 0.5, 7, 17);
                        ctx.fillStyle = '#c8a860';
                        ctx.fillRect(doorX + 1, doorY + 7, 2, 2);
                        ctx.fillStyle = 'rgba(0,0,0,0.2)';
                        ctx.fillRect(rx0, ry0 + TS - 1, TS + 1, 1);
                    } else if (dN) {
                        // 北门：屋顶上方开一个门洞（从俯视看是屋顶上的开口）
                        ctx.fillStyle = isRuins ? '#1a1512' : '#2a2018';
                        ctx.fillRect(rx0 + 10, ry0 + 1, 16, 8);
                        ctx.strokeStyle = isRuins ? '#4a3a2a' : '#8a6a42';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(rx0 + 9.5, ry0 + 0.5, 17, 9);
                        ctx.fillStyle = 'rgba(0,0,0,0.15)';
                        ctx.fillRect(rx0, ry0 + 9, TS + 1, 2);
                    } else {
                        // 四周都是墙（不应该出现，保底画个门标记）
                        ctx.fillStyle = isRuins ? '#1a1512' : '#2a2018';
                        ctx.fillRect(rx0 + 10, ry0 + TS - 10, 16, 9);
                    }
                    buildingEdgeDraws.push({ x: rx0, y: ry0, n: dN, s: dS, w: dW, e: dE, biome, sideDoor: dW || dE, southDoor: dS });
                } else if (t === T.CAR || t === T.CARWRECK) {
                    // 车横跨 2 格，若在地形循环里画会被后续格覆盖右半 → 收集起来循环后统一绘制
                    (carDraws || (carDraws = [])).push({ tx, ty, t });
                } else if (t === T.BARRICADE) {
                    // 路障：黄色警示墩占满整格（与 1 格碰撞体一致）
                    const bx = tx * TS - camX, by = ty * TS - camY;   // 格左上角
                    ctx.fillStyle = '#c9a227';
                    ctx.fillRect(bx + 2, by + 4, TS - 4, TS - 8);     // 墩体
                    ctx.fillStyle = '#2e2a1c';
                    for (let px = 0; px <= TS; px += 12) {            // 斜警示条纹
                        ctx.beginPath();
                        ctx.moveTo(bx + px, by + TS - 4);
                        ctx.lineTo(bx + px + 6, by + TS - 4);
                        ctx.lineTo(bx + px - 2, by + 4);
                        ctx.lineTo(bx + px - 8, by + 4);
                        ctx.closePath();
                        ctx.fill();
                    }
                    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(bx + 1.5, by + 3.5, TS - 3, TS - 7);
                } else if (COLLECT_INFO[t]) {
                    const ci = COLLECT_INFO[t];
                    const key = tx + ',' + ty;
                    const m = sv.mods.tiles[key];
                    const boxL = sv.mods.boxLoot && sv.mods.boxLoot[key];
                    const chest = sv.mods.chests && sv.mods.chests['box:' + key];
                    if (m && m.built) {
                        drawBuilt(ctx, sx, sy, ci.text, 0, tx, ty);
                    } else if (STREET_CONTAINER[ci.text]) {
                        // 底座进静态层；发光脉冲由动态层按帧呼吸
                        drawStreetContainer(ctx, sx, sy, ci.text, 0, tx, ty, false);
                        if (containerHighlight(sv, t, tx, ty)) dyn.pulses.push({ kind: 'street', tx, ty, t });
                    } else {
                        // 容器不消失：掏空后转为储物箱（可随时打开存取），始终正常绘制；高亮随可取物状态消失
                        const isEmptyChest = chest ? chest.every(s => !s) : !!(boxL && boxL.length === 0);
                        const col = isEmptyChest ? '#7A7F74' : ci.color;
                        drawCollectible(ctx, sx, sy, ci.text, col, 0, tx, ty, false);
                        // 碎石不是容器：可开采（石镐），但不加发光脉冲、不做宝箱式高亮圈，
                        // 避免"石头周围一闪一闪的光圈"误导玩家以为要开箱搜索。
                        if (t !== T.RUBBLE && !isEmptyChest) dyn.pulses.push({ kind: 'box', tx, ty, t, color: col });
                    }
                } else {
                    let col = TILE_COLOR[t] || '#FFFFFF';
                    if (t === T.WALL) {
                        // 墙升级链（B1）：lv1 木 / lv2 石 / lv3 金属 —— 按等级上色
                        const m = sv.mods.tiles[tx + ',' + ty];
                        col = m && m.lv === 3 ? '#4A6A8A' : m && m.lv === 2 ? '#9AA0A8' : TILE_COLOR[t];
                    }
                    ctx.fillStyle = col;
                    ctx.fillText(t, sx, sy);
                }
            }
        }
    }

    // 汽车：地形绘制完后统一绘制（避免横跨的右半被相邻地块覆盖）；底座进静态层，
    // 靠近玩家（可交互脉冲）的车由动态层整辆重绘呼吸
    if (carDraws) {
        // 邻车锚点集合：竖向停放的车辆会占用上下相邻格，发现邻车时退回水平
        const anchors = new Set(carDraws.map(c => c.tx + ',' + c.ty));
        for (const c of carDraws) {
            const m = sv.mods.tiles[c.tx + ',' + c.ty];
            const near = Math.hypot((c.tx + 0.5) - (sv.px / TS), (c.ty + 0.5) - (sv.py / TS)) < 3.2;
            // 品相：优先读已持久化的 m.cond，否则按种子确定性计算（完好车视为可驾驶）
            const cond = (m && m.cond) || (c.t === T.CAR ? carCondition(sv.world.seed, c.tx, c.ty) : null);
            const repaired = !!((m && m.repaired) || cond === 'intact');
            let dir = (m && m.dir);
            if (dir == null) {
                // 未开过的停泊车辆：按种子+坐标差异化朝向（水平/头尾对调/竖向/斜向 45°），
                // 野外停车随意自然；只有接近纯竖向（sin>0.92）才做邻车退避
                dir = carDirAt(sv.world.seed, c.tx, c.ty);
                if (Math.abs(Math.sin(dir)) > 0.92 && (
                    anchors.has(c.tx + ',' + (c.ty - 1)) || anchors.has((c.tx + 1) + ',' + (c.ty - 1)) ||
                    anchors.has((c.tx + 1) + ',' + c.ty) ||
                    anchors.has(c.tx + ',' + (c.ty + 1)) || anchors.has((c.tx + 1) + ',' + (c.ty + 1)))) {
                    dir = 0;
                }
            }
            // 报废车（自然报废整车与残骸）统一渲染为"暗灰褐整车"外观（与旧版一致）
            const isWreck = c.t === T.CARWRECK || (cond === 'wreck' && !repaired);
            const carOpt = { wreck: false, repaired, cond: isWreck ? 'wreck' : cond,
                owner: (m && m.owner) || null,
                infection: visualInfectionAt(sv, c.tx, c.ty, 0xCA2), seed: sv.world.seed ^ c.tx ^ c.ty };
            drawCar(ctx, c.tx * TS - camX, c.ty * TS - camY, dir, { ...carOpt, near: false, now: 0 });
            if (near) dyn.cars.push({ tx: c.tx, ty: c.ty, dir, near: true, ...carOpt });
        }
    }

    // 最后补绘建筑外轮廓墙帽。跨格障碍物可以遮住屋面，但不能把连续檐口切断。
    for (const edge of buildingEdgeDraws) {
        const cap = edge.biome === 0 ? '#788087' : (edge.biome === 2 ? '#6d5b43' : '#a78b55');
        const shade = edge.biome === 0 ? '#474e54' : (edge.biome === 2 ? '#3e3428' : '#68512f');
        ctx.fillStyle = cap;
        if (edge.n) ctx.fillRect(edge.x, edge.y, TS + 1, 2);
        if (edge.w) {
            if (edge.sideDoor) { ctx.fillRect(edge.x, edge.y, 2, 8); ctx.fillRect(edge.x, edge.y + 25, 2, TS - 24); }
            else ctx.fillRect(edge.x, edge.y, 2, TS + 1);
        }
        if (edge.e) {
            if (edge.sideDoor) { ctx.fillRect(edge.x + TS - 1, edge.y, 2, 8); ctx.fillRect(edge.x + TS - 1, edge.y + 25, 2, TS - 24); }
            else ctx.fillRect(edge.x + TS - 1, edge.y, 2, TS + 1);
        }
        if (edge.s) {
            const sy = edge.y + TS - 8;
            if (edge.southDoor) { ctx.fillRect(edge.x, sy, 10, 2); ctx.fillRect(edge.x + 27, sy, TS - 26, 2); }
            else ctx.fillRect(edge.x, sy, TS + 1, 2);
        }
        ctx.fillStyle = shade;
        if (edge.n) ctx.fillRect(edge.x, edge.y + 2, TS + 1, 1);
        if (edge.w) {
            if (edge.sideDoor) { ctx.fillRect(edge.x + 2, edge.y, 1, 8); ctx.fillRect(edge.x + 2, edge.y + 25, 1, TS - 24); }
            else ctx.fillRect(edge.x + 2, edge.y, 1, TS + 1);
        }
        if (edge.e) {
            if (edge.sideDoor) { ctx.fillRect(edge.x + TS - 2, edge.y, 1, 8); ctx.fillRect(edge.x + TS - 2, edge.y + 25, 1, TS - 24); }
            else ctx.fillRect(edge.x + TS - 2, edge.y, 1, TS + 1);
        }
        if (edge.s) {
            const sy = edge.y + TS - 10;
            if (edge.southDoor) { ctx.fillRect(edge.x, sy, 10, 2); ctx.fillRect(edge.x + 27, sy, TS - 26, 2); }
            else ctx.fillRect(edge.x, sy, TS + 1, 2);
        }
    }

    // 树冠位于建筑檐口之后：树叶可以自然遮住整段墙帽，不会被黄色线切成前后两层。
    for (const tree of treeDraws) {
        drawPixelTree(ctx, tree.sx, tree.sy, tree.infection, tree.seed, tree.eraseColor);
    }
}

// ---------- 掉落物（含战利品袋：袋字 + 品质铭牌） ----------
function drawDrops(ctx, sv, camX, camY) {
    ctx.font = `${TS - 12}px "Microsoft YaHei", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const W = ctx.canvas.width, H = ctx.canvas.height;
    for (const d of sv.drops) {
        const sx = d.x - camX, sy = d.y - camY;
        if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
        const it = getItemInfo(d.id);
        const bob = Math.sin(sv.now * 3 + d.x) * 3;
        if (d.id.startsWith('loot:')) {
            // 热路径微优化（D）：无 transform 的 save/restore → 手动存/恢复 shadow（fillStyle/font 循环内本就每次设置）
            const _pc = ctx.shadowColor, _pb = ctx.shadowBlur;
            ctx.shadowColor = it.color;
            ctx.shadowBlur = 8 + Math.sin(sv.now * 3) * 3;
            ctx.fillStyle = it.color;
            ctx.font = `${TS - 12}px "Microsoft YaHei", monospace`;
            ctx.fillText(it.char, sx, sy + bob);
            ctx.shadowColor = _pc;
            ctx.shadowBlur = _pb;
            drawNameplate(ctx, sx, sy - TS / 2 - 6, it.name, it.color, 11);
        } else {
            ctx.fillStyle = it.color;
            ctx.fillText(it.char, sx, sy + bob);
        }
    }
}

// ---------- 僵尸（血条；眩晕置灰 + 晕字标记；减速蓝色标记） ----------
function drawZombieTelegraph(ctx, z, sx, sy) {
    if (z.atkState !== 'windup') return;
    const style = Z_ATK_STYLES[z.type] || { windup: 0.65, strikeDist: 48, lunge: 16 };
    const prog = 1 - Math.max(0, z.atkT) / (z.atkWindup || style.windup);
    ctx.save();
    const a = z.atkAngle || 0;
    const effect = style.effect || 'headbutt';

    if (effect === 'charge') {
        // 路障冲撞：前冲箭头 + 蓄力逼近拖尾
        ctx.strokeStyle = `rgba(200,60,60,${0.3 + prog * 0.5})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(sx, sy, (style.strikeDist || 44) + (style.lunge || 14), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 1; i <= 3; i++) {
            const t = prog * i / 3;
            ctx.fillStyle = `rgba(255,100,60,${0.2 + t * 0.3})`;
            ctx.font = `bold ${12 + t * 4}px "Microsoft YaHei", monospace`;
            ctx.fillText('>', sx + Math.cos(a) * (style.creep || 22) * t, sy + Math.sin(a) * (style.creep || 22) * t);
        }
    } else if (effect === 'slam') {
        // 铁桶重砸：粗重下砸圈 + 外圈震波
        ctx.strokeStyle = `rgba(160,60,30,${0.3 + prog * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, (style.strikeDist || 60), 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(120,40,20,${0.15 + prog * 0.25})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(sx, sy, (style.strikeDist || 60) + 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,80,40,${0.3 + prog * 0.5})`;
        ctx.font = `bold ${16 + prog * 8}px "Microsoft YaHei", monospace`;
        ctx.fillText('↓', sx, sy - 10);
    } else if (effect === 'thrust') {
        // 撑杆跃刺：细长突刺线
        ctx.strokeStyle = `rgba(200,200,100,${0.3 + prog * 0.5})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        const reach = (style.strikeDist || 52) + (style.lunge || 30);
        const halfW = 10;
        ctx.beginPath();
        ctx.ellipse(sx, sy, reach, halfW, a, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(220,220,80,${0.4 + prog * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * 10, sy + Math.sin(a) * 10);
        ctx.lineTo(sx + Math.cos(a) * (reach - 4), sy + Math.sin(a) * (reach - 4));
        ctx.stroke();
    } else if (effect === 'rally') {
        // 旗帜号令：光环脉冲
        ctx.strokeStyle = `rgba(200,60,60,${0.2 + prog * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        const reach = (style.strikeDist || 38) + (style.lunge || 8);
        ctx.beginPath();
        ctx.arc(sx, sy, reach, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(200,60,60,${0.15 + prog * 0.2})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, Z_FLAG_AURA_RANGE * (TS / 12), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,100,80,${0.3 + prog * 0.5})`;
        ctx.font = `bold 16px "Microsoft YaHei", monospace`;
        ctx.fillText('旗', sx, sy - 18);
    } else if (effect === 'bash') {
        // 铁门盾撞：盾牌弧
        ctx.strokeStyle = `rgba(100,80,60,${0.3 + prog * 0.5})`;
        ctx.lineWidth = 3;
        const reach = (style.strikeDist || 48) + (style.lunge || 14);
        ctx.beginPath();
        ctx.arc(sx, sy, reach, -Math.PI / 3, Math.PI / 3);
        ctx.stroke();
        ctx.fillStyle = `rgba(180,150,100,${0.2 + prog * 0.3})`;
        ctx.font = `bold 14px "Microsoft YaHei", monospace`;
        ctx.fillText('■', sx + Math.cos(a) * reach * 0.5, sy + Math.sin(a) * reach * 0.5);
    } else {
        // 普通头槌：标准圈 + 箭头（现有）
        const reach = (style.strikeDist || 48) + (style.lunge || 18);
        ctx.strokeStyle = `rgba(255,80,80,${0.22 + prog * 0.28})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(sx, sy, reach, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(255,150,60,${0.5 + prog * 0.4})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * 15, sy + Math.sin(a) * 15);
        ctx.lineTo(sx + Math.cos(a) * (20 + prog * 22), sy + Math.sin(a) * (20 + prog * 22));
        ctx.stroke();
    }
    // 蓄力环（通用）
    ctx.strokeStyle = `rgba(255,70,70,${0.4 + prog * 0.55})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 13 + prog * 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
    ctx.stroke();
    ctx.font = `bold 18px "Microsoft YaHei", monospace`;
    ctx.fillStyle = '#FF5544';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', sx, sy - 24);
    ctx.restore();
}

// 全称铭牌（彩框）：让僵尸/植物可辨识，避免与门等地形字混淆
function drawNameplate(ctx, x, y, text, color, size) {
    ctx.save();
    const fs = size || 11;
    ctx.font = `${fs}px "Microsoft YaHei", monospace`;
    const w = ctx.measureText(text).width + 8, h = fs + 5;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
}

function drawZombies(ctx, sv, camX, camY) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${TS - 8}px "Microsoft YaHei", monospace`;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    for (const z of sv.zombies) {
        const sx = z.x - camX, sy = z.y - camY;
        if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;
        // 健康僵尸是完整像素角色；只有感染后才逐步显露文字结构。
        let zColor;
        if (z.atkState === 'windup') zColor = '#FFAA55';
        else if (z.slowT > 0 && z.stunT <= 0 && z.hurt <= 0) zColor = '#66BBEE';
        else zColor = z.stunT > 0 ? '#999999' : (z.hurt > 0 ? '#FF5555' : z.color);
        drawPixelZombie(ctx, z, sx, sy, zColor);
        // 尸化玩家精英：头顶显示原玩家名字牌（继承的名字，一眼认出"曾经的我"）
        if (z.isPlayerZombie && z.playerName) {
            drawNameplate(ctx, sx, sy - TS / 2 - 10, z.playerName, '#FF8855');
        }
        // 血条（名字上方）
        const bw = TS + 4;
        ctx.fillStyle = 'rgba(60,0,0,0.85)';
        ctx.fillRect(sx - bw / 2, sy - 20, bw, 3);
        ctx.fillStyle = '#33DD33';
        ctx.fillRect(sx - bw / 2, sy - 20, bw * clamp(z.hp / z.maxHp, 0, 1), 3);
        if (z.stunT > 0) {
            ctx.font = `bold 12px "Microsoft YaHei", monospace`;
            ctx.fillStyle = '#FFD700';
            ctx.fillText('晕', sx, sy + 22);
            ctx.font = `${TS - 8}px "Microsoft YaHei", monospace`;
        } else if (z.slowT > 0) {
            ctx.font = `bold 10px "Microsoft YaHei", monospace`;
            ctx.fillStyle = '#66CCFF';
            ctx.fillText('❄', sx + TS / 3, sy + 20);
            ctx.font = `${TS - 8}px "Microsoft YaHei", monospace`;
        }
        drawZombieTelegraph(ctx, z, sx, sy);
    }
}

// ---------- 特效（枪口拟声字 / 命中× / 防反 / 死亡名签，移植单机 effects） ----------
function drawEffects(ctx, sv, camX, camY) {
    if (!sv.effects || !sv.effects.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of sv.effects) {
        const a = clamp(e.life / e.maxLife, 0, 1);
        if (e.kind === 'muzzle') {
            ctx.save();
            ctx.translate(e.x - camX, e.y - camY);
            ctx.rotate(e.angle || 0);
            ctx.globalAlpha = a;
            ctx.font = `bold 16px "Microsoft YaHei", monospace`;
            ctx.fillStyle = e.color || '#FFD700';
            ctx.shadowColor = e.color || '#FFD700';
            ctx.shadowBlur = 6;
            ctx.fillText(e.label || '砰', 0, 0);
            if ((e.ghosts || 1) > 1) { ctx.globalAlpha = a * 0.45; ctx.fillText(e.label || '砰', -9, 0); }
            ctx.restore();
        } else if (e.kind === 'zswing') {
            ctx.save();
            ctx.translate(e.x - camX, e.y - camY);
            ctx.rotate(e.angle || 0);
            ctx.globalAlpha = a;
            const es = e.style;
            if (es === 'charge') {
                ctx.strokeStyle = '#FF6644';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(4, 0); ctx.lineTo(22, 0);
                ctx.stroke();
                ctx.fillStyle = '#FF6644';
                ctx.font = 'bold 14px "Microsoft YaHei", monospace';
                ctx.fillText('>', 24, 0);
            } else if (es === 'slam') {
                ctx.strokeStyle = '#CC5533';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(0, 0, 20, -0.6, 0.6);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(200,80,40,0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, 28, -0.8, 0.8);
                ctx.stroke();
            } else if (es === 'thrust') {
                ctx.strokeStyle = '#DDDD44';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(-2, 0); ctx.lineTo(30, 0);
                ctx.stroke();
                ctx.fillStyle = '#DDDD44';
                ctx.font = 'bold 12px "Microsoft YaHei", monospace';
                ctx.fillText('—', 32, 0);
            } else if (es === 'bash') {
                ctx.strokeStyle = '#C8A060';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, 8, -0.8, 0.8);
                ctx.stroke();
                ctx.fillStyle = 'rgba(200,160,80,0.6)';
                ctx.font = 'bold 12px "Microsoft YaHei", monospace';
                ctx.fillText('■', 14, 0);
            } else {
                // headbutt / rally / default: 弧线挥击
                ctx.strokeStyle = '#FF8855';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, 16, -0.7, 0.7);
                ctx.stroke();
            }
            ctx.restore();
        } else if (e.kind === 'quake') {
            ctx.save();
            ctx.translate(e.x - camX, e.y - camY);
            const r = 10 + (1 - a) * 30;
            ctx.globalAlpha = a * 0.6;
            ctx.strokeStyle = '#CC6633';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(200,80,40,0.2)';
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (e.kind === 'rally') {
            ctx.save();
            ctx.translate(e.x - camX, e.y - camY);
            ctx.globalAlpha = a * 0.5;
            ctx.strokeStyle = '#CC4444';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            const r = e.r || 60;
            ctx.beginPath();
            ctx.arc(0, 0, r * (1 - a * 0.3), 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(200,60,60,0.3)';
            ctx.font = 'bold 14px "Microsoft YaHei", monospace';
            ctx.fillText('号令', 0, -r * (1 - a * 0.3) - 10);
            ctx.restore();
        } else if (e.kind === 'hit') {
            ctx.globalAlpha = a;
            if (e.label) {
                ctx.fillStyle = '#7DF9FF';
                ctx.font = 'bold 15px "Microsoft YaHei", monospace';
                ctx.fillText(e.label, e.x - camX, e.y - camY);
            } else {
                // 命中火花：小十字闪光（不画 × 字符）
                const cx = e.x - camX, cy = e.y - camY;
                const r = 3 + 4 * (1 - a);
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
                ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        } else if (e.kind === 'dead') {
            ctx.globalAlpha = a;
            ctx.font = `13px "Microsoft YaHei", monospace`;
            ctx.fillStyle = '#9BE89B';
            ctx.fillText(e.label || '', e.x - camX, e.y - camY - (1 - a) * 22);
            ctx.globalAlpha = 1;
        } else if (e.kind === 'infect') {
            // 感染升阶：阶段名浮字 + 「人」字文字粒子从身体向四周飘散（侵蚀感）
            // 粒子布局用确定性 i/n 均匀分布（表现类，不依赖 Math.random 抖动）
            const prog = 1 - a;   // a 为剩余生命比例
            ctx.globalAlpha = Math.max(0, Math.min(1, a * 2.2));
            ctx.font = 'bold 15px "Microsoft YaHei", monospace';
            ctx.fillStyle = '#C8D8C8';
            ctx.fillText(e.label || '侵蚀', e.x - camX, e.y - camY - 28 - prog * 20);
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = 'rgba(160,190,170,0.9)';
            for (let i = 0; i < 10; i++) {
                const ang = (i / 10) * Math.PI * 2 + prog * 0.7;
                const r = 6 + prog * 16;
                ctx.fillText('人', e.x - camX + Math.cos(ang) * r, e.y - camY + Math.sin(ang) * r + prog * 10);
            }
            ctx.globalAlpha = 1;
        }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
}

// ---------- 子弹 ----------
function drawBullets(ctx, sv, camX, camY) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const W = ctx.canvas.width, H = ctx.canvas.height;
    for (const b of sv.bullets) {
        const bx = b.x - camX, by = b.y - camY;
        if (bx < -40 || bx > W + 40 || by < -40 || by > H + 40) continue;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(b.spin ? sv.now * 12 : Math.atan2(b.vy || 0, b.vx || 1));
        ctx.font = `bold 14px "Microsoft YaHei", monospace`;
        ctx.fillStyle = b.color || '#FFF';
        ctx.fillText(b.label || '·', 0, 0);
        ctx.restore();
    }
}

// ---------- 玩家（闪现残影 / 跳跃滞空 / 格挡盾 / 完美防反光环 / 无敌帧闪烁） ----------
// ---------- 尸体（2026-08-10 成员死亡后形象留在原地，可搜索遗物） ----------
// 躺倒尸体：暗色上衣横躺（水平条 + 头部圆点），带"尸体"名牌；无碰撞、不参与 AI。
function drawCorpse(ctx, sx, sy, n) {
    const shirt = (n.look && n.look.shirt) || '#6b7480';
    const skin = (n.look && n.look.skin) || '#d8c9a8';
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 2, TS * 0.52, TS * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // 横躺身体（水平长条，模拟倒地）
    ctx.fillStyle = shirt;
    ctx.fillRect(sx - TS * 0.46, sy - 5, TS * 0.92, 6);
    // 头（卧侧）
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(sx + TS * 0.48, sy - 2, 4, 0, Math.PI * 2);
    ctx.fill();
    // 名条（尸体姓名）
    ctx.save();
    ctx.font = 'bold 10px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(210,225,235,0.55)';
    ctx.fillText((n.name || '幸存者') + ' 的尸体', sx, sy - 14);
    ctx.restore();
}

// 2026-08-11 v2.97 濒死救援时间血条：角色头顶显示剩余可救治时间（现实时间 20 分钟），
// 随时间流逝/被攻击（扣 10 秒/点伤害）减少；红色 → 橙色 → 黄色的渐变，见底时闪红。
// 返回剩余秒数（0 = 已耗尽）。同时兼容主控 _downed（dwn._penaltySec）与成员 downed（n._penaltySec）。
function drawDownedTimeBar(ctx, sx, sy, sv, sec) {
    const total = DOWNED_LIMIT_SECONDS || 1200;
    const ratio = Math.max(0, Math.min(1, sec / total));
    const bw = 40, bh = 5;
    const bx = sx - bw / 2, by = sy - TS / 2 - 30;
    // 背景
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    // 剩余部分（红色渐变：满=橙，见底=红）
    const col = ratio > 0.5 ? '#FFB347' : (ratio > 0.25 ? '#FF8844' : '#FF4433');
    ctx.fillStyle = col;
    ctx.fillRect(bx, by, Math.max(1, Math.round(bw * ratio)), bh);
    // 时间文字（mm:ss）
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 9px "Microsoft YaHei", monospace';
    ctx.fillText(`救援 ${m}:${String(s).padStart(2, '0')}`, sx, by - 3);
    ctx.textAlign = 'center';
}

// 计算倒地角色的剩余救援秒数（兼容主控 _downed 与成员 downed，跨文件用）
function downedRemainSec(sv, dwn) {
    if (!sv || !dwn) return 0;
    const start = dwn.downedAtReal != null ? dwn.downedAtReal : (dwn._downedAtReal != null ? dwn._downedAtReal : (sv.now || 0));
    const penalty = dwn._penaltySec || 0;
    const spent = Math.max(0, (sv.now || 0) - start) + penalty;
    return Math.max(0, DOWNED_LIMIT_SECONDS - spent);
}

// ---------- NPC（像素小人 + 名条 + 阵营色 + 血条） ----------
function drawNpcs(ctx, sv, camX, camY, W, H) {
    if (!sv.npcs) return;
    const controllerId = sv.controllerId;
    for (const n of sv.npcs) {
        // 2026-08-10 尸体渲染（成员死亡后形象留在原地，可搜索遗物）：_corpse 标记已死亡角色，
        // 画躺倒尸体（暗色、面朝上倒地），不参与 AI/交互/名牌/血条，无碰撞。
        if (n._corpse) {
            const cxs = n.x - camX, cys = n.y - camY;
            if (cxs < -80 || cxs > W + 80 || cys < -80 || cys > H + 80) continue;
            drawCorpse(ctx, cxs, cys, n);
            continue;
        }
        if (!n.alive) continue;
        if (n.riding) continue;   // 乘车中：由车辆渲染
        if (n.inInterior) continue;   // 在室内：由室内渲染绘制（2026-08-09 室内外统一）
        if (controllerId && n.id === controllerId) continue;   // 主控角色画成玩家
        const sx = n.x - camX, sy = n.y - camY;
        // 性能：屏幕外 NPC 不绘制（含名条/血条/特效）
        if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;
        // 阵营不再用特殊颜色标识（友善/中立/敌对远近看不出区别）；统一用捏脸上衣色，
        // 只有走近到可交互距离才显示名字（§用户需求：走近才能认清谁是谁/哪个阵营）。
        const nameColor = '#D6DDE6';   // 中性浅色名牌，无阵营色彩
        // 玩家与 NPC 距离（判定名字显示：可交互距离 ~2 格内才露出名牌）
        const nameDist = Math.hypot(n.x - sv.px, n.y - sv.py);
        const showName = nameDist < 2.2 * TS;
        // 2026-08-11 性能：远处（>6 格）NPC 视为"远处"，待机用静态帧 + 不画挥击特效——
        // 营地/人群聚集场景（屏幕内几十个 NPC）每帧大幅减少 drawImage 与特效路径开销。
        const farNpc = nameDist > 6 * TS;
        // 逐帧动画：复用玩家待机/行走精灵。用 AI 侧的 sticky 移动标记 n._moving（由 wnpc.moveToward 置真、
        // updateNpc 每 tick 复位）判断是否在走——避免"远离玩家每 0.3s 才跳一格"导致的平移假象。
        const nMoving = !!n._moving;
        // 朝向：AI 移动向量 n._faceX/_faceY → 上/下/左/右
        const fX = n._faceX || 0, fY = n._faceY || 0;
        let nDir = n._animDir || 'down';
        // 2026-08-09 攻击抽搐修复：挥击期间（swingT>0）朝向锁定为攻击方向 swingDir，
        // 避免"围攻走位朝威胁绕圈 + 攻击时 swingDir 朝威胁"两个方向互相覆盖 → 左右抽插。
        // 攻击时 NPC 面向目标（僵尸在右 → 朝右），走位方向不再干扰攻击动画朝向。
        if (n.swingT > 0 && n.swingDir != null) {
            const a2 = n.swingDir;
            if (Math.abs(Math.cos(a2)) > Math.abs(Math.sin(a2))) nDir = Math.cos(a2) > 0 ? 'right' : 'left';
            else nDir = Math.sin(a2) > 0 ? 'down' : 'up';
            n._animDir = nDir;
        } else if (nMoving) {
            if (Math.abs(fY) > Math.abs(fX)) nDir = fY < 0 ? 'up' : 'down';
            else if (fX !== 0) nDir = fX > 0 ? 'right' : 'left';
            n._animDir = nDir;
            // 步频与玩家一致（survival.js 玩家同款公式）：朝南 0.432s、东西向 0.24s、朝北 0.36s
            // 每换一帧才前进一帧、4 帧一循环——不再用固定 10fps，避免 NPC 走路"迈腿频率"和玩家不一致。
            const nowMs = performance.now();
            const wdt = n._lastWT != null ? Math.min(0.1, (nowMs - n._lastWT) / 1000) : 0;
            n._lastWT = nowMs;
            n._stepT = (n._stepT || 0) - wdt;
            if (n._stepT <= 0) {
                const stepInt = (fY > 0 && Math.abs(fY) >= Math.abs(fX)) ? 0.432 : (Math.abs(fX) > 0.7 ? 0.24 : 0.36);
                n._stepT = stepInt;
                n._walkT = ((n._walkT || 0) + 1) % 4;
            }
        }
        // 2026-08-10 奔跑动画与玩家一致：n._running 由 moveToward 在 speedMul>=1.5 时置真，
        // run→动作振幅 ×2（render 的 amp = a.run ? 2 : 1），离玩家远时队员奔跑赶路。
        const nAnim = { dir: nDir, moving: nMoving, frame: nMoving ? (n._walkT || 0) : 0, run: !!n._running };
        // 名牌显示在渲染图片上方（用精灵实际内容 bbox 顶边，避免压到小人身上）
        const nameY = npcNameplateY(n);
        // 倒地主角（软核救治中，2026-08-10）：保持主控形象朝南站立待机的"定格帧"（不播动画），
        // 叠加红色濒死画面效果（头顶倒悬红标 + 名牌"濒临死亡"），队友可见前来救治
        if (n.downed) {
            // 站姿定格：dir='down' 取正面朝南单图，frame=1 强制不播放待机呼吸动画（静态一帧）
            const shirt = (n.look && n.look.shirt) || '#8f9baa';
            drawPixelPlayerBody(ctx, sx, sy, shirt, 0, n.look, { dir: 'down', moving: false, frame: 1 });
            // 濒死画面效果：红圈呼吸光圈 + 头顶倒悬红标
            const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 1000 * 3);
            ctx.strokeStyle = 'rgba(255,60,50,' + (0.5 + 0.4 * pulse) + ')';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(sx, sy - 18, 14 + 2 * pulse, 0, 7); ctx.stroke();
            ctx.fillStyle = '#FF5544';
            ctx.font = 'bold 12px "Microsoft YaHei", monospace';
            ctx.fillText('↓', sx, sy - TS / 2 - 16);
            if (showName) drawNameplate(ctx, sx, sy - TS / 2 - 26, `${n.name}（濒临死亡）`, '#FF5544');
            // 2026-08-11 v2.97 救援时间血条（角色上方：现实时间 20 分钟倒计时 + 被攻击扣减）
            const sec = downedRemainSec(sv, n);
            if (sec > 0) drawDownedTimeBar(ctx, sx, sy, sv, sec);
            else drawDownedTimeBar(ctx, sx, sy, sv, 0);
            continue;
        }

        // 患病 NPC：头顶病色十字，一眼可辨谁生病
        if (n.sick && SICKNESS[n.sick.type]) {
            const col = sickColor(n.sick.type);
            const bob = Math.sin(sv.now * 3 + n.x) * 2;
            ctx.fillStyle = col;
            ctx.font = 'bold 12px "Microsoft YaHei", monospace';
            ctx.fillText('×', sx, sy - TS / 2 - 16 + bob);
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.18;
            ctx.fillRect(sx - 12, sy - 17, 28, 33);
            ctx.globalAlpha = 1;
        }
        if (showName) drawNameplate(ctx, sx, nameY, n.name, nameColor);
        // 上衣取 NPC 的捏脸外观；无外观时用中性灰（不再按阵营发光/染色）
        // 2026-08-11 性能：远处待机 NPC 用静态帧（跳过呼吸动画 bbox 拆分，省 1 次 drawImage）
        const nAnimR = (farNpc && !nMoving) ? { dir: nDir, moving: false, frame: 1 } : nAnim;
        drawPixelPlayerBody(ctx, sx, sy, (n.look && n.look.shirt) || '#8f9baa', 0, n.look, nAnimR);
        // 近战挥击特效（与玩家同一套：按武器样式差异化绘制）
        // 圆心取角色身体中部（sy 是脚底）；远处看不清不画，省特效路径
        if (!farNpc) drawSwingEffect(ctx, sx, sy - PLAYER_BODY_MID, n.swingT, n.swingDir, n.swingWeapon);
        if (showName && (n.hp < n.maxHp)) {
            const bw = TS + 4;
            ctx.fillStyle = 'rgba(30,10,10,0.85)';
            ctx.fillRect(sx - bw / 2, sy - TS / 2 - 8, bw, 3);
            ctx.fillStyle = n.hp / n.maxHp > 0.5 ? '#44DD66' : (n.hp / n.maxHp > 0.25 ? '#FFB347' : '#FF5544');
            ctx.fillRect(sx - bw / 2, sy - TS / 2 - 8, bw * clamp(n.hp / n.maxHp, 0, 1), 3);
        }
    }
    // NPC 子弹（友善火力）
    if (sv.npcBullets) {
        ctx.font = 'bold 10px "Microsoft YaHei", monospace';
        for (const b of sv.npcBullets) {
            // 2026-08-10 修复"弩箭横着飞"：NPC 子弹此前直接 fillText 不旋转，`→` 永远朝右。
            // 与玩家子弹一致：沿弹道方向 rotate，弓弩的 `→`（弓→/弩→）直戳目标，而非横着飞。
            ctx.save();
            ctx.translate(b.x - camX, b.y - camY);
            ctx.rotate(Math.atan2(b.vy || 0, b.vx || 1));
            ctx.fillStyle = b.color || '#FFF';
            ctx.fillText(b.label || '·', 0, 0);
            ctx.restore();
        }
    }
}

// ---------- 患病视觉效果（主控）：按病种差异化 ----------
// 共通：病色晕染 + 头顶呼吸"×"病标；专属：感冒发抖+喷嚏 / 伤口感染滴血 /
// 中毒恶心摇摆+干呕 / 痢疾虚脱冒星 / 中暑热浪+汗珠
function drawSickPlayerFX(ctx, sv, px, py) {
    const st = SICKNESS[sv._sick.type];
    const col = sickColor(sv._sick.type);
    const t = sv.now;
    const x0 = px - 12, y0 = py - 17;
    // 热路径微优化（D）：无 transform 的 save/restore → 仅手动恢复 imageSmoothingEnabled
    const _prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    // 身体晕染（含病种抖动/摇摆的位移）
    const shakeX = sv._sick.type === 'cold' ? Math.round(Math.sin(t * 11) * 1.5) : 0;
    const wobble = sv._sick.type === 'poison' ? Math.sin(t * 2.2) * 1 : 0;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = col;
    ctx.fillRect(x0 + shakeX + wobble, y0, 28, 33);
    ctx.globalAlpha = 1;

    // 头顶呼吸病标
    const bob = Math.sin(t * 3) * 2;
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Microsoft YaHei", monospace';
    ctx.fillStyle = col;
    ctx.fillText('×', px, py - TS / 2 - 8 + bob);

    // 病种专属表现
    const type = sv._sick.type;
    if (type === 'cold') {
        // 喷嚏：每 3 秒一次，蓝白小点向前喷出
        const p = (t % 3) / 3;
        if (p < 0.4) {
            const dir = sv.faceX >= 0 ? 1 : -1;
            ctx.globalAlpha = 0.85 * (1 - p / 0.4);
            ctx.fillStyle = '#cfe8ff';
            for (let i = 0; i < 3; i++) {
                const off = (p * 26 + i * 6) % 26;
                ctx.fillRect(px + dir * (10 + off), py - 8 + Math.sin(t * 9 + i * 2) * 3, 2, 2);
            }
            ctx.globalAlpha = 1;
        }
    } else if (type === 'wound') {
        // 滴血：每 2.5 秒一滴红像素从身体上滑落
        const p = (t % 2.5) / 2.5;
        ctx.fillStyle = '#c22';
        ctx.fillRect(px + 6 + Math.sin(t * 5) * 3, py - 12 + p * 20, 2, 2);
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6);
        ctx.fillStyle = col;
        ctx.fillRect(x0, y0 + 24, 28, 3);
        ctx.globalAlpha = 1;
    } else if (type === 'poison') {
        // 恶心摇摆 + 干呕字
        if ((t % 4) < 0.8) {
            ctx.font = 'bold 14px "Microsoft YaHei", monospace';
            ctx.fillStyle = '#8ae08a';
            ctx.globalAlpha = 0.9 * (1 - ((t % 4) / 0.8));
            ctx.fillText('呕', px + 12, py - 20 - Math.sin(t * 8) * 2);
            ctx.globalAlpha = 1;
        }
    } else if (type === 'dysentery') {
        // 虚脱冒星：头顶旋转的点点
        ctx.font = 'bold 12px "Microsoft YaHei", monospace';
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.7;
        for (let i = 0; i < 3; i++) {
            const a = t * 1.5 + i * Math.PI * 2 / 3;
            ctx.fillText('·', px + Math.cos(a) * 6, py - TS / 2 - 14 + Math.sin(a) * 2);
        }
        ctx.globalAlpha = 1;
    } else if (type === 'heatstroke') {
        // 热浪：头顶正弦波纹 + 汗珠
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
            const wy = py - TS / 2 - 18 - i * 4;
            ctx.beginPath();
            for (let x = -8; x <= 8; x += 2) {
                const yy = wy + Math.sin(t * 6 + x * 0.5 + i * 1.7) * 2;
                if (x === -8) ctx.moveTo(px + x, yy);
                else ctx.lineTo(px + x, yy);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // 汗珠
        ctx.fillStyle = '#bfe4ff';
        const sw = (t % 1.6) / 1.6;
        ctx.globalAlpha = 0.8 * (1 - sw);
        ctx.fillRect(px - 6 + Math.sin(t * 4) * 2, py - 6 + sw * 8, 2, 2);
        ctx.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = _prevSmooth;
}

// 患病屏幕暗角（疾病色边缘渐暗，室内外通用）
function drawSickVignette(ctx, sv, W, H) {
    if (!sv._sick || !SICKNESS[sv._sick.type]) return;
    const col = sickColor(sv._sick.type);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, col + '2b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

// ---------- 驾驶 HUD（油量 + 耐久条，右上角） ----------
function drawDriveHUD(ctx, sv, W) {
    const d = sv.driving;
    if (!d) return;
    const x = W - 168, y = 42;
    ctx.font = '11px "Microsoft YaHei", monospace';
    const bar = (by, ratio, color, label) => {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x, by, 118, 14);
        ctx.fillStyle = '#16222E';
        ctx.fillRect(x + 2, by + 2, 88, 10);
        ctx.fillStyle = color;
        ctx.fillRect(x + 2, by + 2, 88 * clamp(ratio, 0, 1), 10);
        ctx.strokeStyle = '#334455';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 2, by + 2, 88, 10);
        ctx.fillStyle = '#DDDDDD';
        ctx.fillText(label, x + 94, by + 7);
    };
    bar(y, d.hp / d.maxHp, d.hp / d.maxHp > 0.5 ? '#44DD66' : (d.hp / d.maxHp > 0.25 ? '#FFB347' : '#FF5544'), `耐久 ${Math.ceil(d.hp)}`);
    bar(y + 17, d.fuel / FUEL_MAX, d.fuel / FUEL_MAX > 0.3 ? '#E8A33D' : '#FF5544', `油量 ${Math.round(d.fuel)}`);
    // NPC 驾驶命令指示
    if (sv.driveOrder) {
        const driver = sv.npcs && sv.npcs.find(n => n.id === sv.driveOrder.driverId);
        ctx.font = 'bold 12px "Microsoft YaHei", monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#39d98a';
        ctx.fillText(`驾驶员：${driver ? driver.name : '...'} → ${sv.driveOrder.label || '营地'}`, W - 16, y + 34);
        ctx.textAlign = 'left';
    }
}

// ---------- 领地旗帜（旗帜 + 领地范围圈） ----------
function drawCampFlag(ctx, sv, camX, camY) {
    const camp = sv.camp;
    if (!camp) return;
    const fx = camp.x - camX, fy = camp.y - camY;
    // 领地范围圈（淡金色，常驻低透明度）
    ctx.strokeStyle = 'rgba(255,215,0,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(fx, fy, CAMP_RADIUS * TS, 0, Math.PI * 2);
    ctx.stroke();
    // 旗帜：旗杆 + 金色旗面（飘动）
    const sway = Math.sin(sv.now * 2.2) * 2;
    ctx.fillStyle = '#8a8a92';
    ctx.fillRect(fx - 1, fy - TS / 2, 2, TS);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(fx + 1, fy - TS / 2);
    ctx.lineTo(fx + 15 + sway, fy - TS / 2 + 4);
    ctx.lineTo(fx + 1, fy - TS / 2 + 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 11px "Microsoft YaHei", monospace';
    ctx.fillText('旗', fx + 6 + sway * 0.5, fy - TS / 2 + 6);
    drawNameplate(ctx, fx, fy - TS / 2 - 14, '领地', '#FFD700');
}

// ---------- 左侧队伍成员 UI（最多 4 人）：圆角卡片 + 渐变血条 + 状态徽标 ----------
function drawTeamPanel(ctx, sv, W, H) {
    if (!sv.npcs) return;
    const members = sv.npcs.filter(n => n.alive && n.party).slice(0, 4);
    if (!members.length) return;
    const x = 8, pw = 178, rowH = 32, padT = 26, startY = 118;
    const boxH = padT + members.length * rowH + 6;
    ctx.save();
    ctx.textAlign = 'left';   // 固定左对齐：防继承 center/right 导致名字向左溢出框
    ctx.textBaseline = 'middle';
    // 圆角底框 + 金色描边 + 投影
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    roundRectPath(ctx, x, startY, pw, boxH, 8);
    ctx.fillStyle = 'rgba(10,18,28,0.78)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,215,0,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 标题
    ctx.font = 'bold 12px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('▍队伍', x + 10, startY + 13);
    members.forEach((n, i) => {
        const y = startY + padT + i * rowH;
        const isCtrl = sv.controllerId && n.id === sv.controllerId;
        // 主控行高亮描边
        if (isCtrl) {
            roundRectPath(ctx, x + 5, y, pw - 10, rowH - 4, 5);
            ctx.fillStyle = 'rgba(57,217,138,0.10)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(57,217,138,0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        // 第一行：名字 + 武器（名字右边）+ 状态徽标
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.fillStyle = isCtrl ? '#39d98a' : '#E8E8E8';
        // 2026-08-10 用户要求：幸存者操控的 NPC 名字右边加「（幸存者）」标记——
        // 一眼识别当前操控的队友；"清除NPC"按 controllerId 保护此 NPC 不被误删。
        // 注意：isPlayer 记录（幸存者自己）不加标记，否则会显示"幸存者（幸存者）"。
        const isSurvivorNpc = isCtrl && !n.isPlayer;
        const nameText = isSurvivorNpc ? n.name + '（幸存者）' : n.name;
        const nameW = Math.min(ctx.measureText(nameText).width, pw - 56);
        ctx.fillText(nameText, x + 10, y + 9, pw - 56);
        ctx.font = '9px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#7a8b95';
        ctx.fillText(n.wpnName || '拳头', x + 14 + nameW, y + 10, Math.max(18, pw - 56 - nameW));
        // 状态徽标（濒/病/累/营/随/战）
        let st = '', sc = '#8a9aa2';
        if (n.downed) { st = '濒'; sc = '#FF5544'; }   // 2026-08-10 用户要求：倒地主角 UI 标注"濒临死亡"
        else if (n.sick) { st = '病'; sc = '#FF8866'; }
        else if (n.exhausted) { st = '累'; sc = '#9FB4C0'; }   // 2026-08-10 与玩家一致：体力耗尽力竭
        else if (n.state === 'camp') { st = '营'; sc = '#FFD700'; }
        else if (n.state === 'follow') { st = '随'; sc = '#39d98a'; }
        else if (n.state === 'fight') { st = '战'; sc = '#FF5544'; }
        ctx.fillStyle = sc;
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.fillText(st, x + pw - 16, y + 9, 14);
        // 第二行：HP 渐变条 + 血量数值
        const bx = x + 10, bw2 = 116, by = y + 18;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, by, bw2, 6);
        const ratio = clamp(n.hp / n.maxHp, 0, 1);
        const c0 = ratio > 0.5 ? '#3DDC84' : (ratio > 0.25 ? '#FFB347' : '#FF5544');
        const c1 = ratio > 0.5 ? '#7CFC9C' : (ratio > 0.25 ? '#FFD08A' : '#FF8877');
        const grad = ctx.createLinearGradient(bx, 0, bx + bw2, 0);
        grad.addColorStop(0, c0);
        grad.addColorStop(1, c1);
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, bw2 * ratio, 6);
        ctx.font = '9px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#9FB4C0';
        ctx.fillText(`${Math.ceil(n.hp)}/${n.maxHp}`, bx + bw2 + 5, by + 3, pw - bw2 - 30);
    });
    ctx.restore();
}

// 挥击特效（移植本体：按武器 attackStyle 差异化绘制；玩家与 NPC 共用同一套）
function drawSwingEffect(ctx, px, py, swingT, swingDir, swingWeapon) {
    if (swingT <= 0 || !swingWeapon || WEAPONS[swingWeapon]?.kind !== 'melee') return;
    const w = WEAPONS[swingWeapon] || { color: '#00FF88', name: '攻', arc: Math.PI * 0.6, reach: 40 };
    const t = swingT / 0.22;          // 1 → 0
    const prog = 1 - t;               // 0 → 1 挥砍进度
    const reach = (w.reach || 40) * (1 - t * 0.3);
    const arc = w.arc || Math.PI * 0.6;
    const dir = swingDir || 0;
    const style = w.attackStyle || 'slash';
    const color = w.color || '#AAA';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.textAlign = 'center';

    if (style === 'thrust') {
        // 长矛两段式：前半刺出，后半横扫短弧
        if (prog < 0.5) {
            const p2 = prog / 0.5;
            const len = reach * (0.35 + 0.65 * p2);
            const tipX = px + Math.cos(dir) * len;
            const tipY = py + Math.sin(dir) * len;
            ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(px + Math.cos(dir) * 14, py + Math.sin(dir) * 14);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(tipX, tipY, 3 + p2 * 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            const p2 = (prog - 0.5) / 0.5;
            const arcW = Math.PI * 0.5;
            const a0 = dir - arcW / 2;
            const sweep = a0 + arcW * p2;
            ctx.globalAlpha = (1 - p2) * 0.9; ctx.lineWidth = 3; ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(px, py, reach * 0.85, a0, sweep);
            ctx.stroke();
            const tipX = px + Math.cos(sweep) * reach * 0.85;
            const tipY = py + Math.sin(sweep) * reach * 0.85;
            ctx.globalAlpha = 1 - p2;
            ctx.beginPath();
            ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (style === 'stab') {
        // 直刺：短剑——短促直线突进 + 小芒点
        const ex = px + Math.cos(dir) * reach * 0.8;
        const ey = py + Math.sin(dir) * reach * 0.8;
        ctx.globalAlpha = t * 0.95; ctx.lineWidth = 3; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(dir) * reach * 0.3, py + Math.sin(dir) * reach * 0.3);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, 2 + prog * 2.5, 0, Math.PI * 2);
        ctx.fill();
    } else if (style === 'chop') {
        // 重劈：战斧——纵向重弧 + 落点冲击闪光
        const a0 = dir - arc * 0.7;
        const a1 = dir + arc * 0.3;
        const sweep = a0 + (a1 - a0) * prog;
        ctx.globalAlpha = t * 0.9; ctx.lineWidth = 4; ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(px, py, reach * 0.85, a0, sweep);
        ctx.stroke();
        const impX = px + Math.cos(sweep) * reach * 0.85;
        const impY = py + Math.sin(sweep) * reach * 0.85;
        ctx.globalAlpha = t;
        ctx.beginPath();
        ctx.arc(impX, impY, 4 + prog * 6, 0, Math.PI * 2);
        ctx.fill();
    } else if (style === 'punch') {
        // 直拳：拳头——拳影 + 落点气浪环
        const ex = px + Math.cos(dir) * reach * 0.75;
        const ey = py + Math.sin(dir) * reach * 0.75;
        ctx.globalAlpha = t * 0.9; ctx.lineWidth = 2; ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(ex, ey, 4 + prog * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = t * 0.5;
        ctx.beginPath();
        ctx.arc(ex - Math.cos(dir) * 8, ey - Math.sin(dir) * 8, 3 + prog * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = t * 0.7;
        ctx.beginPath();
        ctx.arc(ex, ey, 6 + prog * 8, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        // 横扫（默认/长剑）：圆弧挥过，长剑弧更大更亮
        const sweep = dir - arc / 2 + arc * prog;
        const isSword = style === 'slash' && swingWeapon === 'sword';
        ctx.globalAlpha = t * 0.9;
        ctx.lineWidth = isSword ? 3 : 2;
        ctx.shadowBlur = isSword ? 14 : 8;
        ctx.beginPath();
        ctx.arc(px, py, reach, dir - arc / 2, sweep);
        ctx.stroke();
        const tipX = px + Math.cos(sweep) * reach;
        const tipY = py + Math.sin(sweep) * reach;
        ctx.globalAlpha = t;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawPlayer(ctx, sv, camX, camY) {
    const groundX = sv.px - camX, groundY = sv.py - camY;
    const px = groundX, py = groundY - (sv.jumpOffset || 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 逐帧动画状态：由朝向决定方向（直行=背面/左转/右转/往后走=正面），
    // frame 由 survival.js 的脚步节拍推进，静止时 moving=false 回到站立帧。
    let animDir = 'down';
    if (Math.abs(sv.faceY) > Math.abs(sv.faceX)) animDir = sv.faceY < 0 ? 'up' : 'down';
    else animDir = sv.faceX >= 0 ? 'right' : 'left';
    const anim = {
        dir: animDir,
        frame: sv.animMoving ? (sv.animFrame || 0) : 0,
        moving: !!sv.animMoving,
        run: !!sv.sprinting,
        atk: sv.swingT > 0,
    };

    // 闪现残影（与单机 dashGhosts 一致）
    if (sv.dashGhosts && sv.dashGhosts.length) {
        for (const g of sv.dashGhosts) {
            ctx.globalAlpha = g.alpha;
            drawPixelPlayerBody(ctx, g.x - camX, g.y - camY, '#2f8b68', 0, sv.character, anim);
        }
        ctx.globalAlpha = 1;
    }

    // 跳跃落点影
    if (sv.isJumping) {
        ctx.globalAlpha = 0.35;
        ctx.font = `${TS - 12}px "Microsoft YaHei", monospace`;
        ctx.fillStyle = '#00AA55';
        ctx.fillText('·', groundX, groundY + TS * 0.32);
        ctx.globalAlpha = 1;
    }

    // 挥击特效（移植本体：按武器 attackStyle 差异化绘制）
    // 圆心取角色身体中部（py 是脚底，直接当圆心会偏低、位置不居中）
    drawSwingEffect(ctx, px, py - PLAYER_BODY_MID, sv.swingT, sv.swingDir, sv.swingWeapon);

    // 本体（受击变红 / 无敌帧闪烁）；上衣颜色取捏脸外观，不再写死绿色
    const blink = sv.invuln > 0 && Math.floor(sv.now * 20) % 2 === 0;
    ctx.globalAlpha = blink ? 0.35 : 1;
    const lookShirt = (sv.character && sv.character.shirt) || '#39d98a';
    const playerColor = (sv.hurtT > 0 && Math.floor(sv.now * 10) % 2 === 0) ? '#FF4444' : lookShirt;
    // 光晕跟衣服色走且减弱，避免绿色光盖住捏脸外观
    // 玩家本体：无光晕（2026-08-08 用户反馈"衣服什么颜色发什么光"——去掉 shadowBlur 渐变光，保留原图色彩）
    drawPixelPlayerBody(ctx, px, py, playerColor, sv.infection, sv.character, anim);
    ctx.globalAlpha = 1;

    // 患病表现：按病种差异化视觉（病色晕染 + 发抖/滴血/干呕/冒星/热浪 + 呼吸病标）
    if (sv._sick && SICKNESS[sv._sick.type]) drawSickPlayerFX(ctx, sv, px, py);

    // 格挡盾（完美窗口内白盾，之后蓝盾；朝鼠标方向）
    if (sv.guarding) {
        const gx = px + Math.cos(sv.guardFacing || 0) * TS * 0.72;
        const gy = py + Math.sin(sv.guardFacing || 0) * TS * 0.72;
        ctx.font = `bold ${TS - 12}px "Microsoft YaHei", monospace`;
        ctx.fillStyle = sv.guardTimer <= 0.3 ? '#FFFFFF' : '#66CCFF';
        ctx.shadowColor = '#66CCFF';
        ctx.shadowBlur = 10;
        ctx.fillText('盾', gx, gy);
        ctx.shadowBlur = 0;
    }

    // 完美防反光环（扩散圆环）
    if (sv.perfectFlash > 0) {
        const t = 1 - sv.perfectFlash / 0.35;
        ctx.globalAlpha = sv.perfectFlash / 0.35;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, TS * (0.4 + t * 1.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // 弓箭蓄力 / 换弹指示
    ctx.font = '12px "Microsoft YaHei", monospace';
    if (sv.wpn && sv.wpn.charging) {
        ctx.fillStyle = '#DEB887';
        ctx.fillText(`蓄力 ${Math.min(100, Math.round(sv.wpn.chargeT * 100))}%`, px, py - TS / 2 - 12);
    } else if (sv.wpn && sv.wpn.reloading > 0) {
        ctx.fillStyle = '#FFCC66';
        ctx.fillText('换弹中…', px, py - TS / 2 - 12);
    }
    // 2026-08-11 v2.97 主控本人倒地：头顶显示救援时间血条（玩家视角也能看到 20 分钟倒计时 + 被攻击扣减）
    if (sv._downed && sv._downed.downedAtReal != null) {
        drawDownedTimeBar(ctx, px, py, sv, downedRemainSec(sv, sv._downed));
    }
}

// ---------- 联机远端队友（sv.p2 / sv.p2s 多队友）：像素小人 + 头顶名字 + HP 条，位置插值平滑 ----------
function drawRemotePlayer(ctx, sv, camX, camY, p) {
    p = p || sv.p2;
    if (!p || p.x == null) return;
    // 队友在室内而自己不在：显示"在楼内"标记（室内坐标不能跨端渲染）
    if (p.inInterior && !sv.interior) {
        const sx2 = p.x - camX, sy2 = p.y - camY;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 12px "Microsoft YaHei", monospace';
        ctx.fillStyle = 'rgba(8,20,32,0.82)';
        const label = (p.name || '队友') + ' 在楼内';
        const w = ctx.measureText(label).width + 12;
        roundRectPath(ctx, sx2 - w / 2, sy2 - 10, w, 20, 5);
        ctx.fill();
        ctx.fillStyle = '#7fd6ff';
        ctx.fillText(label, sx2, sy2);
        ctx.restore();
        return;
    }
    // 队友在室外而自己在室内：左上角显示"在楼外"标记（世界坐标不能画进室内画布）
    if (!p.inInterior && sv.interior) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 12px "Microsoft YaHei", monospace';
        const label = (p.name || '队友') + ' 在楼外';
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(8,20,32,0.82)';
        roundRectPath(ctx, 8, 34, w, 20, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(77,163,255,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#7fd6ff';
        ctx.fillText(label, 14, 44);
        ctx.restore();
        return;
    }
    // 匀速插值：基于最近两拍 wpos 快照，渲染 250ms 前的位置（200ms 包间隔 + 50ms 抖动缓冲），
    // 两快照间按恒定速度移动，彻底消除旧版逐帧指数衰减的"冲刺-停顿"跳变感。
    // 丢包时允许同速外推最多 0.4 段（短暂平滑续走），再多则停住，防止失控漂移。
    const a = p._snapPrev, bsnap = p._snapCur;
    if (a && bsnap && bsnap.t > a.t) {
        const f = (performance.now() - 250 - a.t) / (bsnap.t - a.t);
        if (f >= 0) {
            const fc = Math.min(f, 1.4);
            p.x = a.x + (bsnap.x - a.x) * fc;
            p.y = a.y + (bsnap.y - a.y) * fc;
        }
    } else {
        p.x = p.tx; p.y = p.ty;
    }
    // 跳跃高度用队友自己的 jumpOffset（避免"一方跳对方跟着跳"的错误视觉）
    const sx = p.x - camX, sy = p.y - camY - (p.jumpOffset || 0);
    // 开车状态：画车（队友在驾驶中）
    if (p.driving) {
        drawCar(ctx, sx - TS, sy - TS / 2, p.driving.dir || 0, {
            wreck: false, repaired: true, cond: 'intact',
            near: false, now: sv.now, seed: 0, infection: 0,
        });
        // 车顶名字
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        const name = p.name || '队友';
        const nw = ctx.measureText(name).width + 10;
        roundRectPath(ctx, sx - nw / 2, sy - 44, nw, 16, 4);
        ctx.fillStyle = 'rgba(8,20,32,0.82)';
        ctx.fill();
        ctx.fillStyle = '#7fd6ff';
        ctx.fillText(name, sx, sy - 36);
        ctx.restore();
        return;
    }
    const anim = {
        dir: Math.abs(p.faceY) > Math.abs(p.faceX) ? (p.faceY < 0 ? 'up' : 'down') : (p.faceX >= 0 ? 'right' : 'left'),
        frame: p.moving ? (p.frame || 0) : 0,
        moving: !!p.moving,
        run: !!p.run,
        atk: (p.swingT || 0) > 0,
    };
    // 队友用蓝色调（与房主绿色区分），光晕跟衣服色走
    const lookShirt = (p.character && p.character.shirt) || '#4da3ff';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 被击红闪（host/guest 动画状态经 wpos 同步）
    if (p.hurtT > 0 && Math.floor(sv.now * 10) % 2 === 0) ctx.globalAlpha = 0.4;
    ctx.shadowColor = '#4da3ff';
    ctx.shadowBlur = 4;
    drawPixelPlayerBody(ctx, sx, sy, lookShirt, p.infection || 0, p.character, anim);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    // 闪现残影（队友冲刺中：后方拖 2 个半透明残影）
    if (p.dash) {
        const bx = -Math.sign(p.faceX || 0) || (Math.abs(p.faceY) > 0 ? 0 : -1);
        const by = -Math.sign(p.faceY || 0);
        for (let g = 1; g <= 2; g++) {
            ctx.globalAlpha = 0.28 / g;
            drawPixelPlayerBody(ctx, sx + bx * g * 8, sy + by * g * 8, lookShirt, p.infection || 0, p.character, anim);
        }
        ctx.globalAlpha = 1;
    }
    // 挥砍特效（同步挥砍状态）；圆心取身体中部（sy 是脚底）
    if (p.swingT > 0) drawSwingEffect(ctx, sx, sy - PLAYER_BODY_MID, p.swingT, p.swingDir || 0, p.swingWeapon);
    // 完美防反光环（扩散圆环）
    if (p.perfectFlash > 0) {
        const t = 1 - p.perfectFlash / 0.35;
        ctx.globalAlpha = p.perfectFlash / 0.35;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, TS * (0.4 + t * 1.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    // 格挡盾（完美窗口白盾，之后蓝盾；朝队友面向）
    if (p.guarding) {
        const gx2 = sx + Math.cos(p.guardFacing || 0) * TS * 0.72;
        const gy2 = sy + Math.sin(p.guardFacing || 0) * TS * 0.72;
        ctx.font = `bold ${TS - 12}px "Microsoft YaHei", monospace`;
        ctx.fillStyle = p.guardTimer <= 0.3 ? '#FFFFFF' : '#66CCFF';
        ctx.shadowColor = '#66CCFF';
        ctx.shadowBlur = 10;
        ctx.fillText('盾', gx2, gy2);
        ctx.shadowBlur = 0;
    }
    // 蓄力/换弹指示（头顶）
    if (p.charging) {
        ctx.font = '12px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#DEB887';
        ctx.fillText(`蓄力 ${Math.min(100, Math.round((p.chargeT || 0) * 100))}%`, sx, sy - TS / 2 - 12);
    } else if (p.reloading > 0) {
        ctx.font = '12px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#FFCC66';
        ctx.fillText('换弹中…', sx, sy - TS / 2 - 12);
    }
    // 头顶名字（圆角底）
    const name = p.name || '队友';
    ctx.font = 'bold 11px "Microsoft YaHei", monospace';
    const nw = ctx.measureText(name).width + 10;
    roundRectPath(ctx, sx - nw / 2, sy - 40, nw, 16, 4);
    ctx.fillStyle = 'rgba(8,20,32,0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(77,163,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#7fd6ff';
    ctx.fillText(name, sx, sy - 32);
    // 脚下 HP 小条
    const ratio = clamp((p.hp || 0) / (p.maxHp || 100), 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(sx - 13, sy + 20, 26, 4);
    ctx.fillStyle = ratio > 0.5 ? '#3DDC84' : ratio > 0.25 ? '#FFB347' : '#FF5544';
    ctx.fillRect(sx - 13, sy + 20, 26 * ratio, 4);
    // 饥饿/水分小徽标（队友快饿死/渴死时可见）
    if (p.food != null && p.food < 30) {
        ctx.font = 'bold 10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#FFB347';
        ctx.fillText('饿', sx - 20, sy + 24);
    }
    if (p.water != null && p.water < 30) {
        ctx.font = 'bold 10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#66CCFF';
        ctx.fillText('渴', sx + 20, sy + 24);
    }
    ctx.restore();
}

// ---------- 联机队友方向距离指引：每个队友独立一个箭头 + 距离格数（固定槽序不闪） ----------
// 旧版只画 sv.p2（"最近活动队友"别名，随 wpos 到达顺序在玩家间切换）→ 多人时指示器乱闪；
// 现遍历 sv.p2s 全队友槽，每人固定配色 + 边缘重叠自动错位。
const P2_GUIDE_COLORS = ['#7fd6ff', '#ffd166', '#8dff9e', '#ff9ecb'];
function drawP2Guide(ctx, sv, W, H, sharedDrawn) {
    const list = [];
    if (sv.p2s) { for (const pid in sv.p2s) { const g = sv.p2s[pid]; if (g && g.tx != null) list.push(g); } }
    if (!list.length && sv.p2 && sv.p2.tx != null) list.push(sv.p2);
    if (!list.length) return;
    const drawn = sharedDrawn || [];   // 共享错位数组（队友 + 尸化自己 同边缘不重叠）
    for (let i = 0; i < list.length; i++) {
        drawOneP2Guide(ctx, sv, W, H, list[i], P2_GUIDE_COLORS[i % P2_GUIDE_COLORS.length], drawn);
    }
}
// ---------- 本地 NPC 队友 · 边缘指向指引（2026-08-11 用户需求） ----------
// 队友（party 成员）离玩家太远（屏幕外）时，屏幕边缘显示指向箭头 + 名字 + 距离格数，
// 与联机队友指引同款样式（复用 drawOneP2Guide）；室内外通用（室内 sv.camX=-ox 兼容）。
// 排除：倒地的（躺地上等人救）、当前主控、原主角 isPlayer、乘车中（riding）。
const MATE_GUIDE_COLORS = ['#FFD24A', '#7EE0A2', '#7EC8FF', '#FF9BD6', '#B8A0FF', '#FFB347'];
function drawMateGuide(ctx, sv, W, H, sharedDrawn) {
    if (!sv.npcs) return;
    const mates = sv.npcs.filter(n => n.alive && n.party && !n.downed && !n.isPlayer
        && n.id !== sv.controllerId && !n.riding);
    if (!mates.length) return;
    const drawn = sharedDrawn || [];
    let i = 0;
    for (const m of mates) {
        drawOneP2Guide(ctx, sv, W, H, { tx: m.x, ty: m.y, name: m.name }, MATE_GUIDE_COLORS[i % MATE_GUIDE_COLORS.length], drawn);
        i++;
    }
}
function drawOneP2Guide(ctx, sv, W, H, p, color, drawn) {
    const dx = p.tx - sv.px, dy = p.ty - sv.py;
    const dist = Math.hypot(dx, dy);
    const sx = p.tx - sv.camX, sy = p.ty - sv.camY;
    const margin = 52;
    // 同屏：双方都能看到对方小人，不再显示距离（用户要求）
    if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin) return;
    // 屏幕外：屏幕边缘画箭头（指向队友方向）+ 距离格数
    const ang = Math.atan2(dy, dx);
    const px2 = clamp(W / 2 + Math.cos(ang) * (W / 2 - 40), margin, W - margin);
    let py2 = clamp(H / 2 + Math.sin(ang) * (H / 2 - 40), margin, H - margin);
    // 多个队友落在同一边缘位置：逐个下移 48px 防重叠（超出下边界改向上叠）
    for (const d of drawn) {
        if (Math.abs(d.x - px2) < 40 && Math.abs(d.y - py2) < 44) {
            py2 = d.y + 48 > H - margin ? d.y - 48 : d.y + 48;
        }
    }
    drawn.push({ x: px2, y: py2 });
    ctx.save();
    ctx.translate(px2, py2);
    // 圆底 + 该队友专属色描边
    ctx.fillStyle = 'rgba(10,30,52,0.85)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // 指向队友的箭头
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-4, -6); ctx.lineTo(-1, 0); ctx.lineTo(-4, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 下方标签：队友名 + 距离（格）
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px "Microsoft YaHei", monospace';
    ctx.fillStyle = 'rgba(8,20,32,0.82)';
    const label = (p.name || '队友') + ' · ' + Math.round(dist / TS) + ' 格';
    const lw = ctx.measureText(label).width + 10;
    roundRectPath(ctx, px2 - lw / 2, py2 + 22, lw, 18, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, px2, py2 + 31);
    ctx.restore();
}

// ---------- 尸化的自己 · 距离指引（与队友指引明显不同：暗紫菱形 + 专属标签） ----------
// 一条命存档延续后，死去的自己（isPlayerZombie 精英僵尸）留在旧世界并继承你的装备——
// 用专属指引定位它（寻回装备/面对曾经的自己）。样式与队友（圆底彩箭头）区分：
// 紫黑菱形底 + 白色倒三角箭头 + 标签「尸化的自己 · 名字 · N格」。
const PZ_GUIDE_COLOR = '#9B6DFF';   // 暗紫（区别于队友的蓝/黄/绿/粉）
function drawPlayerZombieGuide(ctx, sv, W, H, sharedDrawn) {
    const list = sv.zombies.filter(z => z.isPlayerZombie && z.hp > 0);
    if (!list.length) return;
    const drawn = sharedDrawn || [];
    for (const z of list) {
        const dx = z.x - sv.px, dy = z.y - sv.py;
        const dist = Math.hypot(dx, dy);
        const sx = z.x - sv.camX, sy = z.y - sv.camY;
        const margin = 52;
        // 同屏：能看到尸化的自己（名字牌已画），不再显示指引
        if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin) continue;
        // 屏幕外：边缘菱形指引
        const ang = Math.atan2(dy, dx);
        const px2 = clamp(W / 2 + Math.cos(ang) * (W / 2 - 40), margin, W - margin);
        let py2 = clamp(H / 2 + Math.sin(ang) * (H / 2 - 40), margin, H - margin);
        // 与队友/其他尸化自己共享错位（同边缘 48px 下移，超出反向叠）
        for (const d of drawn) {
            if (Math.abs(d.x - px2) < 40 && Math.abs(d.y - py2) < 44) {
                py2 = d.y + 48 > H - margin ? d.y - 48 : d.y + 48;
            }
        }
        drawn.push({ x: px2, y: py2 });
        ctx.save();
        ctx.translate(px2, py2);
        // 紫黑菱形底（旋转 45° 正方形）+ 暗紫描边 —— 与队友圆底明确区分
        ctx.fillStyle = 'rgba(24,12,40,0.88)';
        ctx.strokeStyle = PZ_GUIDE_COLOR;
        ctx.lineWidth = 2;
        ctx.save();
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-12, -12, 24, 24);
        ctx.fill(); ctx.stroke();
        ctx.restore();
        // 指向尸化自己的箭头（白色，粗倒三角）
        ctx.rotate(ang);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(10, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2, 0); ctx.lineTo(-5, 7);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        // 下方标签：尸化的自己 + 名字 + 距离
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.fillStyle = 'rgba(20,8,36,0.85)';
        const label = '尸化的自己 · ' + (z.playerName || z.name || '？') + ' · ' + Math.round(dist / TS) + ' 格';
        const lw = ctx.measureText(label).width + 10;
        roundRectPath(ctx, px2 - lw / 2, py2 + 24, lw, 18, 4);
        ctx.fill();
        ctx.strokeStyle = PZ_GUIDE_COLOR;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#C9A6FF';
        ctx.fillText(label, px2, py2 + 33);
        ctx.restore();
    }
}

// ---------- 死亡位置 · 距离指引（软核正常模式统一「死亡地点」，红色十字样式） ----------
// 玩家死亡（正常难度）→ 遗物以主角尸体形式留在死亡点（靠近 F 搜索）；无物品则死亡位置被标记。
// 屏幕边缘统一显示红色「死亡地点 · N格」指引，方便找回上次死亡位置（用户需求：只保留死亡地点指引）。
// 消失条件：主角尸体已被搜索完（_corpseSearched）→ 指引消失。
// 2026-08-10 修复"重生后没有死亡指引"：此前"走到死亡点 3 格内"也清除指引——但重生点/床常
// 离死亡点很近（室内死亡重生在门口等），一重生指引就被清 → 用户反馈找不到死亡点。改为：
// 玩家在死亡点附近时只显示地面红叉标记（同屏分支），不显示边缘箭头，但记录不删除；只有
// 尸体被搜索完（遗物拿走）才真正清除指引。样式与队友（圆点）和尸化自己（紫菱形）区分。
const DEATH_GUIDE_COLOR = '#FF5544';    // 红色：死亡地点
function drawLegacyDropGuide(ctx, sv, W, H, sharedDrawn) {
    if (!sv._legacyDrop) return;
    const tx = sv._legacyDrop.x, ty = sv._legacyDrop.y;
    const margin = 52;
    // 死亡点遗物尸体状态：未搜索（引导玩家回来搜）/ 已搜索（遗物已拿走）
    const corpseUnsearched = (sv.npcs || []).some(n => n._corpse && !n._corpseSearched &&
        Math.abs(n.x - tx) < TS && Math.abs(n.y - ty) < TS);
    const corpseSearched = (sv.npcs || []).some(n => n._corpse && n._corpseSearched &&
        Math.abs(n.x - tx) < TS && Math.abs(n.y - ty) < TS);
    // 主角尸体已被搜索完（遗物拿走）→ 指引消失（人已回收遗物）
    if (corpseSearched) { sv._legacyDrop = null; return; }
    // 2026-08-10 修复"死亡地点标志永久残留"：死亡点没有任何尸体（无物品死亡标记 /
    // 尸体已被超期清理）时，玩家已到达死亡点附近（同屏）即清除指引——否则尸体被清后
    // 上方 corpseSearched 判定永远找不到 → 标志永不消失（用户反馈：到达死亡点标志没消失）。
    if (!corpseUnsearched) {
        const sx0 = tx - sv.camX, sy0 = ty - sv.camY;
        if (sx0 >= margin && sx0 <= W - margin && sy0 >= margin && sy0 <= H - margin) { sv._legacyDrop = null; return; }
    }
    const dx = tx - sv.px, dy = ty - sv.py;
    const dist = Math.hypot(dx, dy);
    const sx = tx - sv.camX, sy = ty - sv.camY;
    // 同屏：能看到死亡点（尸体由 drawNpcs 画躺倒尸体 + 名牌；无物品死亡点画红叉标记），不显示边缘指引
    if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.strokeStyle = 'rgba(255,85,68,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-7, -7); ctx.lineTo(7, 7);
        ctx.moveTo(7, -7); ctx.lineTo(-7, 7);
        ctx.stroke();
        ctx.fillStyle = 'rgba(60,10,8,0.85)';
        ctx.fillRect(-10, -16, 20, 14);
        ctx.strokeStyle = DEATH_GUIDE_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(-10, -16, 20, 14);
        ctx.fillStyle = '#FFE9E9';
        ctx.font = 'bold 9px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('死', 0, -9);
        ctx.restore();
        return;
    }
    const ang = Math.atan2(dy, dx);
    const px2 = clamp(W / 2 + Math.cos(ang) * (W / 2 - 40), margin, W - margin);
    let py2 = clamp(H / 2 + Math.sin(ang) * (H / 2 - 40), margin, H - margin);
    // 与队友/尸化自己共享错位
    const drawn = sharedDrawn || [];
    for (const d of drawn) {
        if (Math.abs(d.x - px2) < 40 && Math.abs(d.y - py2) < 44) {
            py2 = d.y + 48 > H - margin ? d.y - 48 : d.y + 48;
        }
    }
    drawn.push({ x: px2, y: py2 });
    ctx.save();
    ctx.translate(px2, py2);
    // 红色十字底（死亡地点样式，与队友圆点、尸化菱形区分）
    ctx.fillStyle = 'rgba(60,10,8,0.9)';
    ctx.strokeStyle = DEATH_GUIDE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-12, -12, 24, 24);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = DEATH_GUIDE_COLOR;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-7, -7); ctx.lineTo(7, 7);
    ctx.moveTo(7, -7); ctx.lineTo(-7, 7);
    ctx.stroke();
    // 指向死亡点的红色箭头
    ctx.rotate(ang);
    ctx.fillStyle = DEATH_GUIDE_COLOR;
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2, 0); ctx.lineTo(-5, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 下方标签
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px "Microsoft YaHei", monospace';
    ctx.fillStyle = 'rgba(40,28,4,0.88)';
    const label = '死亡地点 · ' + Math.round(dist / TS) + ' 格';
    const lw = ctx.measureText(label).width + 10;
    roundRectPath(ctx, px2 - lw / 2, py2 + 24, lw, 18, 4);
    ctx.fill();
    ctx.strokeStyle = DEATH_GUIDE_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#FFE9E9';
    ctx.fillText(label, px2, py2 + 33);
    ctx.restore();
}

// ---------- 建造模式：鼠标目标格高亮 ----------
function drawBuildTarget(ctx, sv, camX, camY) {
    if (!sv.build || !sv.mouse.inside) return;
    const gx = Math.floor((camX + sv.mouse.x) / TS), gy = Math.floor((camY + sv.mouse.y) / TS);
    ctx.strokeStyle = sv.buildOk ? '#FFD700' : '#FF5555';
    ctx.lineWidth = 2;
    ctx.strokeRect(gx * TS - camX + 2, gy * TS - camY + 2, TS - 4, TS - 4);
}

// ---------- 建造栏（底部，建造模式时显示） ----------
function drawBuildBar(ctx, sv, W, H) {
    const n = BUILD_ITEMS.length;
    const size = 64, gap = 8;
    const totalW = n * size + (n - 1) * gap;
    const x0 = (W - totalW) / 2, y = H - 26 - 64;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
        const b = BUILD_ITEMS[i];
        const x = x0 + i * (size + gap);
        const selected = sv.buildSel === i;
        const afford = sv.woodCount >= b.cost;
        ctx.fillStyle = selected ? 'rgba(40,50,20,0.92)' : 'rgba(10,14,10,0.88)';
        ctx.fillRect(x, y, size, 58);
        ctx.strokeStyle = selected ? '#FFD700' : (afford ? '#3a5a3a' : '#5a2a2a');
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeRect(x, y, size, 58);
        ctx.textAlign = 'left';
        ctx.font = '9px Consolas, monospace';
        ctx.fillStyle = '#888';
        ctx.fillText(String(i + 1), x + 3, y + 7);
        ctx.textAlign = 'center';
        ctx.font = `bold 18px "Microsoft YaHei", monospace`;
        ctx.fillStyle = afford ? '#C8A2E8' : '#777';
        ctx.fillText(b.t, x + size / 2, y + 20);
        ctx.font = '11px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#DDD';
        ctx.fillText(b.name, x + size / 2, y + 36);
        ctx.fillStyle = afford ? '#FFD700' : '#FF6666';
        ctx.fillText(`木×${b.cost}`, x + size / 2, y + 50);
    }
}

// ---------- 快捷栏（M5：非建造模式底部 6 格） ----------
function drawHotbar(ctx, sv, W, H) {
    if (!sv.hotbar) return;
    const n = sv.hotbar.length;
    const size = 40, gap = 4;
    const totalW = n * size + (n - 1) * gap;
    const x0 = (W - totalW) / 2, y = H - 26 - size - 6;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
        const x = x0 + i * (size + gap);
        const id = sv.hotbar[i];
        ctx.fillStyle = 'rgba(10,14,10,0.82)';
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = id ? '#3a5a3a' : '#222';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, size, size);
        ctx.textAlign = 'left';
        ctx.font = '9px Consolas, monospace';
        ctx.fillStyle = '#666';
        ctx.fillText(String(i + 1), x + 2, y + 8);
        if (id) {
            const it = getItemInfo(id);
            ctx.textAlign = 'center';
            ctx.font = `bold 16px "Microsoft YaHei", monospace`;
            ctx.fillStyle = it.color || '#fff';
            ctx.fillText(it.char, x + size / 2, y + size / 2);
        }
    }
}

// ---------- 生存状态 HUD（室内外共用） ----------
// 顶部 HP/天数/区域/背包 + 体力/饱食/水分/感染条 + 右上武器状态；
// 区域名可覆盖（室内按建筑所在区块显示，避免用室内坐标算出错误区域）。
function drawStatusHUD(ctx, sv, W, districtNameOverride) {
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, 34);
    ctx.textAlign = 'left';
    ctx.font = '14px "Microsoft YaHei", monospace';

    // HP 方块条
    const blocks = 10;
    const filled = Math.ceil(sv.hp / sv.maxHp * blocks);
    const ratio = sv.hp / sv.maxHp;
    ctx.fillStyle = ratio > 0.5 ? '#33DD33' : (ratio > 0.25 ? '#FFB347' : '#FF4444');
    ctx.fillText('HP ' + '■'.repeat(Math.max(0, filled)) + '□'.repeat(Math.max(0, blocks - filled)) +
        ` ${Math.ceil(sv.hp)}/${sv.maxHp}`, 10, 17);

    // 天数 / 时刻 / 区域 / 天气（天气指示与粒子同源 sv._weather + wxLevelCur → UI/视觉同步）
    const dayT = (sv.t / sv.dayLen) * 24;
    const hh = String(Math.floor(dayT)).padStart(2, '0');
    const mm = String(Math.floor((dayT % 1) * 60)).padStart(2, '0');
    const pcx = Math.floor(sv.px / TS / CHUNK), pcy = Math.floor(sv.py / TS / CHUNK);
    const dName = districtNameOverride || districtProfile(sv.world.seed, pcx, pcy).name;
    ctx.fillStyle = '#DDDDDD';
    ctx.fillText(`第 ${sv.day} 天  ${hh}:${mm}  [${dName}]`, 232, 17);
    // 2026-08-10 季节 + 天气实时（时间城区右边）：[季节名] · 天气强度名（天气色）
    const wxBase = `第 ${sv.day} 天  ${hh}:${mm}  [${dName}]`;
    const seasonName = SEASON_NAMES[seasonAt(sv.day)] || '夏';
    ctx.fillStyle = '#A8C8A8';
    ctx.fillText(`  [${seasonName}]`, 232 + ctx.measureText(wxBase).width + 6, 17);
    if (sv._weather && wxInfo(sv._weather).particles !== 0) {
        const wxT = wxIntensity(sv._weather, wxLevelCur(sv));
        ctx.fillStyle = wxInfo(sv._weather).color;
        ctx.fillText(` · ${wxT.name}`, 232 + ctx.measureText(wxBase + `  [${seasonName}]`).width + 6, 17);
    } else {
        ctx.fillStyle = '#A8C8A8';
        ctx.fillText(' · 晴朗', 232 + ctx.measureText(wxBase + `  [${seasonName}]`).width + 6, 17);
    }

    // 背包占用 + 金币（2026-08-10 金币=货币：独立字段 sv.coins，不占背包格）
    ctx.fillStyle = '#AABBCC';
    ctx.textAlign = 'right';
    ctx.fillText(`背包 ${sv.inv.filter(Boolean).length}/24 · 金币 ${sv.coins || 0}`, W - 12, 17);

    // 体力条（常态黄绿 #CCDD44，力竭变红 #AA2222）
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 40, 130, 14);
    ctx.font = '11px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#16222E';
    ctx.fillRect(10, 42, 76, 10);
    ctx.fillStyle = sv.exhausted ? '#AA2222' : '#CCDD44';
    ctx.fillRect(10, 42, 76 * clamp((sv.stamina || 0) / (sv.maxStamina || 100), 0, 1), 10);
    ctx.strokeStyle = '#334455';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 42, 76, 10);
    ctx.textAlign = 'left';
    ctx.fillStyle = sv.exhausted ? '#FF6666' : '#AADDFF';
    ctx.fillText(sv.exhausted ? '力竭' : `体力 ${Math.round(sv.stamina || 0)}`, 90, 47);

    // 饱食条（常态橙；饥饿<30 变暗；挨饿归零闪红）
    if (sv.food != null) {
        const fy = 58;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(8, fy - 2, 130, 14);
        ctx.fillStyle = '#16222E';
        ctx.fillRect(10, fy, 76, 10);
        const fr = clamp(sv.food / 100, 0, 1);
        const flash = sv.food <= 0 && Math.floor(sv.now * 3) % 2 === 0;
        ctx.fillStyle = flash ? '#FF3333' : (sv.food < 30 ? '#C46A2A' : '#E8A33D');
        ctx.fillRect(10, fy, 76 * fr, 10);
        ctx.strokeStyle = '#334455';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, fy, 76, 10);
        ctx.fillStyle = sv.food <= 0 ? '#FF8866' : (sv.food < 30 ? '#FFB37A' : '#FFE4B0');
        ctx.fillText(sv.food <= 0 ? '饥饿' : `饱食 ${Math.round(sv.food)}`, 90, fy + 5);
    }

    // 水分条（常态蓝；口渴<30 变暗；缺水归零闪红）
    if (sv.water != null) {
        const wy = 74;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(8, wy - 2, 130, 14);
        ctx.fillStyle = '#16222E';
        ctx.fillRect(10, wy, 76, 10);
        const wr = clamp(sv.water / WATER_MAX, 0, 1);
        const flash = sv.water <= 0 && Math.floor(sv.now * 3) % 2 === 0;
        ctx.fillStyle = flash ? '#FF3333' : (sv.water < 30 ? '#3A6A9A' : '#4E9AE8');
        ctx.fillRect(10, wy, 76 * wr, 10);
        ctx.strokeStyle = '#334455';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, wy, 76, 10);
        ctx.fillStyle = sv.water <= 0 ? '#66CCFF' : (sv.water < 30 ? '#7AB6E8' : '#BFE4FF');
        ctx.fillText(sv.water <= 0 ? '缺水' : `水分 ${Math.round(sv.water)}`, 90, wy + 5);
    }

    // 感染条
    if (sv.infection > 0) {
        const iy = 92;
        const infEff = playerInfectionEffects(sv.infection);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(8, iy - 2, 130, 14);
        ctx.fillStyle = '#16222E';
        ctx.fillRect(10, iy, 76, 10);
        const ir = clamp(sv.infection / 100, 0, 1);
        const pulse = infEff.stage >= 3 && Math.floor(sv.now * 2) % 2 === 0;
        ctx.fillStyle = pulse ? '#9b2d3a' : (infEff.stage >= 4 ? '#6b1d2a' : infEff.stage >= 2 ? '#5a3040' : '#4a3548');
        ctx.fillRect(10, iy, 76 * ir, 10);
        ctx.strokeStyle = '#334455';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, iy, 76, 10);
        ctx.fillStyle = infEff.stage >= 4 ? '#FF6688' : infEff.stage >= 2 ? '#CC8899' : '#AA99AA';
        ctx.fillText(`感染 ${infEff.name}`, 90, iy + 5);
    }

    // 染病提示（感冒/伤口感染/食物中毒/痢疾/中暑）：按疾病配色 + 对症药提示
    if (sv._sick && SICKNESS[sv._sick.type]) {
        const s = SICKNESS[sv._sick.type];
        const col = sickColor(sv._sick.type);
        const sy = sv.infection > 0 ? 110 : 92;   // 与感染条错位（原同 y=92 重叠）
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(8, sy - 2, 130, 14);
        ctx.fillStyle = '#16222E';
        ctx.fillRect(10, sy, 76, 10);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(10, sy, 76, 10);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#334455';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, sy, 76, 10);
        ctx.fillStyle = col;
        ctx.fillText(`染病：${s.name}`, 90, sy + 5);
    }

    // 武器损坏提示（背包有损坏武器时常驻）
    let brokenWpn = null;
    if (sv.inv) for (const x of sv.inv) if (x && x.broken && String(x.id).startsWith('wpn:')) { brokenWpn = x; break; }
    if (brokenWpn) {
        const rowUsed = (sv.infection > 0 ? 1 : 0) + (sv._sick && SICKNESS[sv._sick.type] ? 1 : 0);
        const by = 92 + rowUsed * 18;   // 感染/疾病占满时 128，单项 110，都无 92
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(8, by - 2, 130, 14);
        ctx.fillStyle = '#16222E';
        ctx.fillRect(10, by, 76, 10);
        ctx.fillStyle = '#6b1d1d';
        ctx.fillRect(10, by, 76, 10);
        ctx.strokeStyle = '#334455';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, by, 76, 10);
        ctx.fillStyle = '#FF8866';
        ctx.fillText('武器损坏', 90, by + 5);
    }

    // 装备状态（右上）
    if (sv.wpnText) {
        ctx.textAlign = 'right';
        ctx.font = '13px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#FFD700';
        ctx.fillText(sv.wpnText, W - 16, 49);
    }
}

// ---------- 顶部 / 底部 HUD ----------
// 2026-08-10 底部操作提示循环横幅：文本从右向左滚动，循环往复。
// 每帧按 performance.now 推进偏移，offset 取模 (textWidth + W + gap) → 无缝循环。
let _bannerCache = null;   // { text, width, color, font } → 复用 measureText 结果
function drawScrollBanner(ctx, sv, W, H, text, color) {
    ctx.save();
    ctx.textBaseline = 'middle';
    const font = '12px "Microsoft YaHei", monospace';
    const key = text;
    if (!_bannerCache || _bannerCache.key !== key) {
        ctx.font = font;
        _bannerCache = { key, width: ctx.measureText(text).width };
    }
    const speed = 40;                    // 滚动速度 px/s（恒定，从右向左）
    const gap = 120;                     // 相邻两段文本之间的间隔
    const w = _bannerCache.width;
    const total = w + gap;               // 一段的完整周期 = 文本宽 + 间隔
    const t = (performance.now() / 1000) * speed;
    // 从右向左恒定速度滚动：phase 在 [0, total) 内线性增长 → off 从 W 单调减到 W-total，
    // 取模回绕 → 循环往复。速度恒定（off 对时间的导数恒为 -speed）。
    const phase = t % total;
    const off = W - phase;               // 当前段左缘 x
    // 绘制黑色半透明底条
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, H - 26, W, 26);
    ctx.font = font;
    ctx.fillStyle = color || '#888888';
    ctx.textAlign = 'left';
    // 画三段（当前段 + 前后邻段），其中与屏幕 [−w, W] 相交的都会显示：
    // 任意时刻至少一段覆盖屏幕 → 从右飘入、向左移出、再从右缓缓出现，永不中断。
    ctx.fillText(text, off - total, H - 13);
    ctx.fillText(text, off, H - 13);
    ctx.fillText(text, off + total, H - 13);
    ctx.restore();
}

function drawHUD(ctx, sv, W, H) {
    ctx.textBaseline = 'middle';
    drawStatusHUD(ctx, sv, W);

    // 尸潮状态：每天 20:00 自动开始，不显示预告倒计时。
    if (sv.opts.invasion) {
        if (sv.horde && sv.horde.phase === 'wave') {
            const left = sv.horde.pending + sv.zombies.filter(z => z.horde).length;
            ctx.fillStyle = '#FF4444';
            ctx.textAlign = 'left';
            ctx.font = '14px "Microsoft YaHei", monospace';
            ctx.fillText(`第 ${sv.day} 天尸潮 · 剩余 ${left} 只`, 400, 17);
        }
    }

    // 底部操作提示（2026-08-10 循环滚动横幅：从右飘到左，往复循环；不含开发者模式）
    drawScrollBanner(ctx, sv, W, H, sv.build
        ? '建造模式：1-5 选择 · 左键放置 · F 拆除 · G/ESC 退出'
        : 'WASD 移动 · Shift 奔跑 · Q 闪现 · E 格挡 · 空格 跳跃 · 左键/J 攻击 · F 交互 · V 背起/放下 · G 建造 · B 背包 · C 角色属性 · H 队伍管理 · F1 新手教程 · P 暂停 · F11 全屏 · ALT+ESC 退出全屏');

    // 交互提示
    ctx.font = 'bold 16px "Microsoft YaHei", monospace';
    if (sv.prompt) {
        ctx.fillStyle = '#FFD700';
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 8;
        ctx.fillText(`[F] ${sv.prompt}`, W / 2, H - 92);
        ctx.shadowBlur = 0;
    }

    // 滚动消息队列（3~5 条，淡出）
    drawMsg(ctx, sv, W);

    // 大字公告（尸潮预警/击退，红色发光+动态，贴合本体大字风格）
    if (sv.announce) {
        const col = sv.announce.color || '#FF3333';
        ctx.font = 'bold 44px "Microsoft YaHei", monospace';
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 16 + Math.sin(sv.now * 10) * 6;
        ctx.fillText(sv.announce.text, W / 2, H / 2 - 24);
        ctx.shadowBlur = 0;
    }
}

// ---------- 室内空间渲染 ----------
const INT_COLOR = {
    [IT.WALL]: '#8A8A8A', [IT.BOX]: '#D8A528', [IT.EXIT]: '#55CC55',
    [IT.SHELF]: '#A0784A', [IT.DEBRIS]: '#666666', [IT.STAIRS_DOWN]: '#8295a4', [IT.STAIRS_UP]: '#a79275',
};
const INT_CHAR = {
    [IT.WALL]: '墙', [IT.BOX]: '箱', [IT.EXIT]: '出',
    [IT.SHELF]: '架', [IT.DEBRIS]: '石', [IT.STAIRS_DOWN]: '下', [IT.STAIRS_UP]: '上',
};

function drawInteriorWeathering(ctx, px, py, kind, age, seed) {
    if (age < 0.24) return;
    const damp = kind === 'wall' || kind === 'floor';
    const marks = 1 + Math.floor(age * 4);
    for (let i = 0; i < marks; i++) {
        const rx = 3 + Math.floor(hash2(seed + i * 17, i, 1) * (TS - 7));
        const ry = 3 + Math.floor(hash2(seed + i * 29, i, 2) * (TS - 7));
        ctx.fillStyle = damp && hash2(seed, i, 3) > 0.48 ? 'rgba(54,92,54,0.34)' : 'rgba(35,27,22,0.28)';
        ctx.fillRect(px + rx, py + ry, age > 0.65 ? 3 : 2, age > 0.72 ? 2 : 1);
        if (kind === 'wall' && age > 0.52) ctx.fillRect(px + rx, py + ry, 1, 3 + Math.floor(age * 5));
    }
}
const INT_BOX_META = {
    [IT.BOX]: { name: '物资箱', color: '#D8A528' },
    [IT.WBOX]: { name: '武器箱', color: '#79818A' },
    [IT.MEDBOX]: { name: '医疗箱', color: '#E06A62' },
    [IT.MATBOX]: { name: '建材箱', color: '#AAAAAA' },
};

function drawInterior(ctx, sv, W, H) {
    const it = sv.interior;
    if (!it) return;
    const iw = it.w, ih = it.h;
    const totalW = iw * TS, totalH = ih * TS;
    const ox = (W - totalW) / 2, oy = (H - totalH) / 2;

    ctx.fillStyle = '#0A0A12';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1A1A24';
    ctx.fillRect(ox, oy, totalW, totalH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${TS - 10}px "Microsoft YaHei", monospace`;
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
        const t = it.tiles[y * iw + x];
        const px0 = ox + x * TS, py0 = oy + y * TS;
        const sx = px0 + TS / 2, sy = py0 + TS / 2;
        const districtKey = it.districtKey || 'urban';
        const worldX = (it.originX || 0) + x, worldY = (it.originY || 0) + y;
        const regionAge = districtKey === 'ruins' ? 0.22 : districtKey === 'wild' ? 0.16 : districtKey === 'suburb' ? 0.10 : 0.06;
        const age = clamp(hash2(sv.world.seed ^ 0x71AE, worldX, worldY) * 0.72 + regionAge + Math.min((sv.day || 1) * 0.008, 0.16), 0, 1);
        if (t === IT.VOID) continue;
        if (t === IT.FLOOR) {
            // 地板：木纹色块 + 轻微格纹（不逐格画字）
            const n = ((x * 7 + y * 13) % 5);
            ctx.fillStyle = `rgb(${44 + n},${36 + n},${28 + n})`;
            ctx.fillRect(px0, py0, TS + 1, TS + 1);
            ctx.strokeStyle = 'rgba(90,70,50,0.15)';
            ctx.lineWidth = 1;
            ctx.strokeRect(px0 + 0.5, py0 + 0.5, TS, TS);
            drawInteriorWeathering(ctx, px0, py0, 'floor', age, sv.world.seed ^ worldX ^ (worldY << 8));
        } else if (t === IT.WALL) {
            if (x === it.exitX && y === it.exitY && (it.floor || 1) !== 1) {
                // 楼上/地下室出入口位：封死的木窗（1 层的"出"字门在楼上不存在，走楼梯才能回 1 层）
                ctx.fillStyle = '#3a3a42';
                ctx.fillRect(px0, py0, TS + 1, TS + 1);
                drawInteriorWeathering(ctx, px0, py0, 'wall', age, sv.world.seed ^ worldX ^ (worldY << 8));
                ctx.fillStyle = '#5d4a33';
                ctx.fillRect(px0 + 4, py0 + 4, TS - 8, TS - 8);
                ctx.fillStyle = '#23232b';
                ctx.fillRect(px0 + 7, py0 + 7, TS - 14, TS - 14);
                ctx.fillStyle = '#8a6b4a';
                ctx.fillRect(px0 + 15, py0 + 7, 5, TS - 14);
                ctx.fillRect(px0 + 7, py0 + 15, TS - 14, 5);
                ctx.fillStyle = '#6e5536';
                ctx.fillRect(px0 + 12, py0 + 12, 3, 3);
                ctx.fillRect(px0 + 21, py0 + 12, 3, 3);
                ctx.fillRect(px0 + 12, py0 + 21, 3, 3);
                ctx.fillRect(px0 + 21, py0 + 21, 3, 3);
            } else {
                // 墙：深灰石块色块 + 描边
                ctx.fillStyle = '#3a3a42';
                ctx.fillRect(px0, py0, TS + 1, TS + 1);
                ctx.strokeStyle = 'rgba(20,20,26,0.9)';
                ctx.lineWidth = 1;
                ctx.strokeRect(px0 + 0.5, py0 + 0.5, TS, TS);
                drawInteriorWeathering(ctx, px0, py0, 'wall', age, sv.world.seed ^ worldX ^ (worldY << 8));
            }
        } else if (t === IT.EXIT) {
            // 出口：地板底 + 发光绿框 + 字
            ctx.fillStyle = 'rgb(46,38,30)';
            ctx.fillRect(px0, py0, TS + 1, TS + 1);
            const pulse = 0.7 + Math.sin(sv.now * 3) * 0.3;
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = '#55CC55';
            ctx.lineWidth = 2;
            ctx.strokeRect(px0 + 3, py0 + 3, TS - 6, TS - 6);
            ctx.fillStyle = '#55CC55';
            ctx.fillText('出', sx, sy);
            ctx.globalAlpha = 1;
        } else if (INT_BOX_META[t]) {
            // 室内外容器共用同一品类名称、颜色和像素文字外观；掏空后与室外一致：
            // 保留原名（灰色显示），不显示"空箱"字样
            ctx.fillStyle = 'rgb(46,38,30)';
            ctx.fillRect(px0, py0, TS + 1, TS + 1);
            const bl = sv.mods.boxLoot && sv.mods.boxLoot['int:' + (it.key || '') + ':' + (it.floor || 1) + ':' + x + ',' + y];
            const empty = !!(bl && bl.length === 0);
            const meta = INT_BOX_META[t];
            // 空箱不再给高亮框（与室外容器一致），未搜过的箱子才有呼吸高亮
            drawCollectible(ctx, sx, sy, meta.name, empty ? '#6B6B6B' : meta.color, sv.now, worldX, worldY, !empty);
        } else if (t === IT.PLANT) {
            ctx.fillStyle = 'rgb(46,38,30)';
            ctx.fillRect(px0, py0, TS + 1, TS + 1);
            drawInteriorWeathering(ctx, px0, py0, 'floor', age, sv.world.seed ^ worldX ^ (worldY << 8));
            ctx.fillStyle = '#496B3A';
            ctx.fillRect(sx - 1, sy - 2, 2, 9);
            ctx.fillStyle = '#638B4E';
            ctx.fillRect(sx - 7, sy - 4, 6, 4);
            ctx.fillRect(sx + 1, sy - 8, 7, 5);
            ctx.fillStyle = '#799D60';
            ctx.fillRect(sx - 4, sy - 10, 5, 5);
        } else if (t === IT.STAIRS_UP || t === IT.STAIRS_DOWN) {
            // 楼梯：上楼/下楼用方向相反的像素台阶 + 箭头标识，二楼起一眼可分
            const isUp = t === IT.STAIRS_UP;
            ctx.fillStyle = 'rgb(46,38,30)';
            ctx.fillRect(px0, py0, TS + 1, TS + 1);
            drawInteriorWeathering(ctx, px0, py0, 'floor', age, sv.world.seed ^ t ^ worldX ^ (worldY << 8));
            // 四级台阶逐级错落：上楼向左上逐级升高，下楼向右下逐级降低
            for (let i = 0; i < 4; i++) {
                const tlx = px0 + 4 + i * 7;
                const top = isUp ? py0 + 26 - i * 7 : py0 + 5 + i * 7;
                ctx.fillStyle = isUp ? '#7a5a36' : '#5d4530';
                ctx.fillRect(tlx, top, 7, 7);
                ctx.fillStyle = isUp ? '#a8814f' : '#8a6b4a';
                ctx.fillRect(tlx + 2, top + 1, 5, 5);
                ctx.fillStyle = isUp ? '#d9b273' : '#c29a63';
                ctx.fillRect(tlx + 2, top + 1, 5, 1);
            }
            // 扶手：沿最低台阶的水平栏杆 + 两根立柱
            const railY = isUp ? py0 + 25 : py0 + 31;
            ctx.fillStyle = '#a0805a';
            ctx.fillRect(px0 + 6, railY, TS - 10, 2);
            ctx.fillRect(px0 + 6, railY - 6, 2, 6);
            ctx.fillRect(px0 + 26, railY - 6, 2, 6);
            // 方向箭头：上楼 ↑ 暖黄（左上空位），下楼 ↓ 冷蓝（左下沉位）
            const prevFont = ctx.font;
            ctx.font = 'bold 14px "Microsoft YaHei", monospace';
            ctx.fillStyle = isUp ? '#FFD75E' : '#5EB8FF';
            ctx.fillText(isUp ? '↑' : '↓', px0 + 12, isUp ? py0 + 10 : py0 + 30);
            ctx.font = prevFont;
        } else if (t === IT.DEBRIS) {
            // 室内碎石：碎砖 + 灰泥渣 + 断木，与室外青石堆（碎石）区分开
            ctx.fillStyle = 'rgb(46,38,30)';
            ctx.fillRect(px0, py0, TS + 1, TS + 1);
            drawInteriorWeathering(ctx, px0, py0, 'floor', age, sv.world.seed ^ t ^ worldX ^ (worldY << 8));
            const j1 = hash2(sv.world.seed, worldX, worldY);
            const j2 = hash2(sv.world.seed, worldX * 3 + 1, worldY * 5 + 2);
            const bx = px0 + 4 + Math.floor(j1 * 5), by = py0 + 16 + Math.floor(j2 * 5);
            ctx.fillStyle = '#8a4a3a';
            ctx.fillRect(bx, by, 11, 6);
            ctx.fillStyle = '#a05a45';
            ctx.fillRect(bx + 1, by + 1, 4, 3);
            ctx.fillStyle = '#7a3d2f';
            ctx.fillRect(bx, by + 4, 11, 2);
            ctx.fillStyle = '#9b9b93';
            ctx.fillRect(px0 + 20 - Math.floor(j1 * 3), py0 + 20 - Math.floor(j2 * 3), 9, 5);
            ctx.fillStyle = '#b5b5ad';
            ctx.fillRect(px0 + 21 - Math.floor(j1 * 3), py0 + 21 - Math.floor(j2 * 3), 3, 2);
            ctx.fillStyle = '#6e5536';
            ctx.fillRect(px0 + 7 + Math.floor(j1 * 4), py0 + 9 + Math.floor(j2 * 2), 14, 3);
            ctx.fillStyle = '#8a6b4a';
            ctx.fillRect(px0 + 8 + Math.floor(j1 * 4), py0 + 9 + Math.floor(j2 * 2), 5, 2);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(px0 + 4, py0 + 29, TS - 8, 2);
        } else {
            // 箱/架/杂物：地板底 + 物件色块
            ctx.fillStyle = 'rgb(46,38,30)';
            ctx.fillRect(px0, py0, TS + 1, TS + 1);
            let col = INT_COLOR[t] || '#FFFFFF';
            let ch = INT_CHAR[t] || '?';
            ctx.fillStyle = col;
            ctx.fillText(ch, sx, sy);
            drawInteriorWeathering(ctx, px0, py0, t === IT.SHELF ? 'metal' : 'floor', age,
                sv.world.seed ^ t ^ worldX ^ (worldY << 8));
        }
    }

    // 室内掉落物
    ctx.font = `${TS - 12}px "Microsoft YaHei", monospace`;
    for (const d of it.drops) {
        const info = getItemInfo(d.id);
        const bob = Math.sin(sv.now * 3 + d.x) * 3;
        ctx.fillStyle = info.color;
        ctx.fillText(info.char, ox + d.x, oy + d.y + bob);
    }

    // 室内战利品
    if (it.lootBags) for (const lb of it.lootBags) {
        const sx = ox + lb.x, sy = oy + lb.y;
        const bob = Math.sin(sv.now * 2.4 + lb.x) * 2;
        ctx.save();
        ctx.shadowColor = '#FFB347';
        ctx.shadowBlur = 8 + Math.sin(sv.now * 3) * 3;
        ctx.font = `${TS - 10}px "Microsoft YaHei", monospace`;
        ctx.fillStyle = '#FFCC55';
        ctx.fillText('战', sx, sy + bob);
        ctx.restore();
        drawNameplate(ctx, sx, sy - TS / 2 - 8, '战利品', '#FFB347');
    }

    // 室内僵尸
    ctx.font = `${TS - 8}px "Microsoft YaHei", monospace`;
    for (const z of it.zombies) {
        const sx = ox + z.x, sy = oy + z.y;
        const zColor = (z.atkState === 'windup') ? '#FFAA55' : (z.hurt > 0 ? '#FF5555' : z.color);
        drawPixelZombie(ctx, z, sx, sy, zColor);
        const bw = TS + 4;
        ctx.fillStyle = 'rgba(60,0,0,0.85)';
        ctx.fillRect(sx - bw / 2, sy - 20, bw, 3);
        ctx.fillStyle = '#33DD33';
        ctx.fillRect(sx - bw / 2, sy - 20, bw * clamp(z.hp / z.maxHp, 0, 1), 3);
        drawZombieTelegraph(ctx, z, sx, sy);
    }

    // 子弹
    ctx.font = 'bold 14px "Microsoft YaHei", monospace';
    for (const b of sv.bullets) {
        ctx.save();
        ctx.translate(ox + b.x, oy + b.y);
        ctx.rotate(b.spin ? sv.now * 12 : Math.atan2(b.vy || 0, b.vx || 1));
        ctx.fillStyle = b.color || '#FFF';
        ctx.fillText(b.label || '·', 0, 0);
        ctx.restore();
    }

    // 2026-08-09 室内高楼层躲藏幸存者（静态像素小人 + 走近才显示名字，中性无阵营色）
    if (it.npcs) {
        for (const n of it.npcs) {
            if (!n || n.hp <= 0) continue;
            const sx = ox + n.x, sy = oy + n.y;
            drawPixelPlayerBody(ctx, sx, sy, (n.look && n.look.shirt) || '#8f9baa', 0, n.look || sv.character || null, {});
            if (Math.hypot(n.x - sv.px, n.y - sv.py) < 2.2 * TS) {
                drawNameplate(ctx, sx, sy + npcNameplateY(n), n.name || '幸存者', '#D6DDE6');
            }
        }
    }
    // 2026-08-09 室内外 NPC 统一：随玩家进室内的队员 / 室内招募的队员（sv.npcs 中 inInterior）也绘制
    if (sv.npcs) {
        for (const n of sv.npcs) {
            // 2026-08-10 室内尸体渲染（成员死亡后形象留在房间，可搜索遗物）
            if (n._corpse && n.inInterior) {
                drawCorpse(ctx, ox + n.x, oy + n.y, n);
                continue;
            }
            if (!n.alive || !n.inInterior) continue;
            if (sv.controllerId && n.id === sv.controllerId) continue;   // 主控画成玩家
            const sx = ox + n.x, sy = oy + n.y;
            // 2026-08-10 室内倒地主角：与室外同款站姿定格（朝南待机帧）+ 红色濒死效果，
            // 队友在室内也能看到倒地主角前来救助（此前室内无 downed 处理 → 主角站姿无标记）
            if (n.downed) {
                const shirt = (n.look && n.look.shirt) || '#8f9baa';
                drawPixelPlayerBody(ctx, sx, sy, shirt, 0, n.look, { dir: 'down', moving: false, frame: 1 });
                const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 1000 * 3);
                ctx.strokeStyle = 'rgba(255,60,50,' + (0.5 + 0.4 * pulse) + ')';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(sx, sy - 18, 14 + 2 * pulse, 0, 7); ctx.stroke();
                ctx.fillStyle = '#FF5544';
                ctx.font = 'bold 12px "Microsoft YaHei", monospace';
                ctx.fillText('↓', sx, sy - TS / 2 - 16);
                drawNameplate(ctx, sx, sy - TS / 2 - 26, `${n.name || '幸存者'}（濒临死亡）`, '#FF5544');
                // 2026-08-11 v2.97 救援时间血条（室内倒地角色同款）
                const sec = downedRemainSec(sv, n);
                drawDownedTimeBar(ctx, sx, sy, sv, sec);
                continue;
            }
            // 复用室外同款逐帧动画：按本帧位移判断走动/朝向
            const dx2 = n.x - (n._lastAX != null ? n._lastAX : n.x);
            const dy2 = n.y - (n._lastAY != null ? n._lastAY : n.y);
            n._lastAX = n.x; n._lastAY = n.y;
            let nDir = n._animDir || 'down';
            let nMv = (dx2 * dx2 + dy2 * dy2) > 0.5 || !!n._moving;
            // 朝向/步频基准统一取 AI 移动向量（与室外一致），避免用逐帧位移小量误判方向
            const fX2 = n._faceX || 0, fY2 = n._faceY || 0;
            // 2026-08-10 与室外一致：挥击期间（swingT>0）朝向锁定为攻击方向 swingDir
            if (n.swingT > 0 && n.swingDir != null) {
                const a3 = n.swingDir;
                if (Math.abs(Math.cos(a3)) > Math.abs(Math.sin(a3))) nDir = Math.cos(a3) > 0 ? 'right' : 'left';
                else nDir = Math.sin(a3) > 0 ? 'down' : 'up';
                n._animDir = nDir;
            } else if (nMv) {
                if (Math.abs(fY2) > Math.abs(fX2)) nDir = fY2 < 0 ? 'up' : 'down';
                else if (fX2 !== 0) nDir = fX2 > 0 ? 'right' : 'left';
                n._animDir = nDir;
                // 与室外 NPC / 玩家同款步频：朝南 0.432s、东西向 0.24s、朝北 0.36s，每帧换一帧、4 帧循环
                const nowMs2 = performance.now();
                const wdt2 = n._lastWT != null ? Math.min(0.1, (nowMs2 - n._lastWT) / 1000) : 0;
                n._lastWT = nowMs2;
                n._stepT = (n._stepT || 0) - wdt2;
                if (n._stepT <= 0) {
                    const stepInt = (fY2 > 0 && Math.abs(fY2) >= Math.abs(fX2)) ? 0.432 : (Math.abs(fX2) > 0.7 ? 0.24 : 0.36);
                    n._stepT = stepInt;
                    n._walkT = ((n._walkT || 0) + 1) % 4;
                }
            }
            // 2026-08-10 室内奔跑动画与室外一致：run→动作振幅 ×2
            const nAnim2 = { dir: nDir, moving: nMv, frame: nMv ? (n._walkT || 0) : 0, run: !!n._running };
            drawPixelPlayerBody(ctx, sx, sy, (n.look && n.look.shirt) || '#8f9baa', 0, n.look || sv.character || null, nAnim2);
            // 2026-08-10 与室外一致：近战挥击特效（按武器样式差异化绘制；圆心取身体中部）
            if (n.swingT > 0) drawSwingEffect(ctx, sx, sy - PLAYER_BODY_MID, n.swingT, n.swingDir, n.swingWeapon);
            if (Math.hypot(n.x - sv.px, n.y - sv.py) < 2.2 * TS) {
                drawNameplate(ctx, sx, sy + npcNameplateY(n), n.name || '幸存者', '#D6DDE6');
            }
        }
    }

    // 室内交互目标黄色光圈（与室外一致：确定 F 会和哪个箱子/幸存者交互）
    drawInteriorPromptGlow(ctx, sv, it, ox, oy);

    // 玩家（复用大世界渲染：挥砍弧 / 残影 / 格挡盾 / 跳跃影 / 蓄力换弹指示）
    drawPlayer(ctx, sv, -ox, -oy);

    // 联机：室内也渲染远端队友（camX=-ox / camY=-oy 已就绪，室内坐标直接可用；
    // 队友在室外时由 drawRemotePlayer 内部走"在楼外"标记）
    if (sv.p2) drawRemotePlayer(ctx, sv, -ox, -oy);

    // 2026-08-10 修复"室内 NPC 子弹不显示"：与室外 drawNpcs 同款子弹绘制
    // （NPC 坐标是室内坐标，室内渲染统一加 ox/oy 偏移到屏幕坐标）
    if (sv.npcBullets) {
        ctx.font = 'bold 10px "Microsoft YaHei", monospace';
        for (const b of sv.npcBullets) {
            // 2026-08-10 室内同样沿弹道方向旋转 NPC 子弹（弓弩箭直戳目标）
            ctx.save();
            ctx.translate(b.x + ox, b.y + oy);
            ctx.rotate(Math.atan2(b.vy || 0, b.vx || 1));
            ctx.fillStyle = b.color || '#FFF';
            ctx.fillText(b.label || '·', 0, 0);
            ctx.restore();
        }
    }
    // 特效
    drawEffects(ctx, sv, -ox, -oy);
    // 昼夜压暗（室内减半，保持可玩性）
    drawDayNight(ctx, sv, W, H, true);
    drawInfectionOverlay(ctx, sv, W, H);   // 感染侵蚀覆盖层（室内同为身体状态，可见）
    drawSickVignette(ctx, sv, W, H);

    // 室内 HUD：状态条与室外完全一致（HP/天数/区域/背包/体力/饱食/水分/感染/武器）；
    // 区域按建筑所在区块计算（避免室内坐标算出错误区域）。
    const itDName = districtProfile(sv.world.seed,
        Math.floor((it.originX || 0) / CHUNK), Math.floor((it.originY || 0) / CHUNK)).name;
    drawStatusHUD(ctx, sv, W, itDName);
    // 2026-08-10 修复"室内切队友视角后左侧队伍UI消失"：室内也绘制队伍面板
    // （含倒地主角，标注濒死状态），与室外一致。
    drawTeamPanel(ctx, sv, W, H);
    // 室内专属：室 内 · 楼层 · 僵尸数量
    const curFloor = it.floor || 1;
    const floorTag = curFloor > 1 ? `${curFloor}层` : (curFloor < 0 ? `地下${Math.abs(curFloor)}层` : '1层');
    const left = it.zombies.length;
    ctx.textAlign = 'left';
    ctx.font = '14px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#D29A5B';
    ctx.fillText(`室 内 · ${floorTag} · ${left > 0 ? `僵尸 ×${left}` : '已清剿'}`, 400, 17);
    // 2026-08-11 室内队友边缘指引：同室外（sv.camX=-ox 兼容，队友屏幕外显示指向箭头+名字+距离）
    const guideDrawn = [];
    drawMateGuide(ctx, sv, W, H, guideDrawn);
    drawLegacyDropGuide(ctx, sv, W, H, guideDrawn);

    // 底部提示（2026-08-10 循环滚动横幅：从右飘到左，往复循环）
    drawScrollBanner(ctx, sv, W, H, curFloor === 1
        ? 'WASD 移动 · 左键/J 攻击 · F 交互/搜索/救治 · V 背起/放下 · H 队伍管理 · 走到绿色[出]字离开室内'
        : 'WASD 移动 · 左键/J 攻击 · F 交互/搜索/救治 · V 背起/放下 · H 队伍管理 · 靠近楼梯按 F 上楼下楼');

    drawMsg(ctx, sv, W);
}

// 室内 F 交互目标黄色光圈（与室外交互目标金色描边同款）：
// 箱子 → 金色呼吸描边矩形；躲藏幸存者 → 金色呼吸圆圈。确定 F 会作用于哪个对象。
function drawInteriorPromptGlow(ctx, sv, it, ox, oy) {
    const pt = it.promptTarget;
    if (!pt) return;
    const pulse = 0.5 + Math.sin(sv.now * 2.5) * 0.3;
    ctx.save();
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.globalAlpha = clamp(pulse, 0, 1);
    if (pt.npc) {
        // 2026-08-09 用户要求：NPC 身上不再画金色圈（干扰视线）。
        // NPC 交互通过名牌/走近可交互判定体现，移除头顶光圈；箱子光圈提示保留。
    } else if (pt.downed) {
        // 2026-08-10 室内濒死交互：红色描边 + 文字"救治/放下 [F]"（与室外救助提示同步）
        const px0 = ox + pt.x * TS, py0 = oy + pt.y * TS;
        ctx.strokeStyle = '#E8836A';
        ctx.strokeRect(px0 + 2, py0 + 2, TS - 4, TS - 4);
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#E8836A';
        ctx.globalAlpha = 1;
        ctx.fillText(sv._carryDowned ? '放下 [F]' : '救治 [F]', px0 + TS / 2, py0 - 6);
    } else if (pt.stairs) {
        // 2026-08-10 楼梯：金色描边 + 文字"上楼/下楼 [F]"（交互式上下楼提示）
        const px0 = ox + pt.x * TS, py0 = oy + pt.y * TS;
        ctx.strokeRect(px0 + 2, py0 + 2, TS - 4, TS - 4);
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFD700';
        ctx.globalAlpha = 1;
        ctx.fillText(pt.dir > 0 ? '上楼 [F]' : '下楼 [F]', px0 + TS / 2, py0 - 6);
    } else {
        // 箱子：金色描边矩形（内缩 2px，与室外交互框一致）
        const px0 = ox + pt.x * TS, py0 = oy + pt.y * TS;
        ctx.strokeRect(px0 + 2, py0 + 2, TS - 4, TS - 4);
    }
    ctx.restore();
}
