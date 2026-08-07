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
import { BARRICADE_HP, CAR_HP, Z_ATK_STYLES, Z_FLAG_AURA_RANGE, Z_BODY, PLANT_BODY, PLAYER_BODY, WATER_MAX, COIN_ID, SICKNESS, sickColor, FUEL_MAX, CAMP_RADIUS } from './wbalance.js';
import { infectionBand, worldInfectionLevel, playerInfectionEffects } from './winfection.js';
export { TS };

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

function zombieBodyColorAt(px, py, type, coat, skin) {
    let color = null;
    if (px >= 7 && px < 12 && py >= 31 && py < 36) color = '#222628';
    if (px >= 16 && px < 21 && py >= 31 && py < 36) color = '#222628';
    if (px >= 8 && px < 13 && py >= 24 && py < 33) color = '#41484a';
    if (px >= 15 && px < 20 && py >= 24 && py < 33) color = '#41484a';
    if (px >= 6 && px < 21 && py >= 14 && py < 26) color = coat;
    if (px >= 2 && px < 7 && py >= 16 && py < 27) color = skin;
    if (px >= 21 && px < 25 && py >= 14 && py < 26) color = skin;
    if (px >= 8 && px < 21 && py >= 4 && py < 15) color = '#5c7657';
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
    return null;
}

function drawPixelZombie(ctx, z, sx, sy, color) {
    const level = z.infection || 0;
    const gridX = Math.round(sx - 12), gridY = Math.round(sy - 16) - 2;
    const width = 28, height = 36;
    const skinState = z.stunT > 0 ? 2 : (z.hurt > 0 ? 1 : 0);
    const lvQ = Math.round(level * 8);
    // 尸化玩家精英：肤色混入缓存 key（否则不同肤色共用缓存 → 颜色串用）
    const skinHash = z.skin ? ((parseInt(z.skin.slice(1), 16) || 0) & 0x3FF) : 0;
    const cacheKey = (z.type.charCodeAt(0) * 1000 + lvQ * 10 + skinState + skinHash * 64) | 0;
    let cached = cacheGet(_zombieCache, cacheKey);
    if (!cached) {
        cached = makeOffscreen(width, height);
        const octx = cached.getContext('2d');
        octx.imageSmoothingEnabled = false;
        const textPixels = getTextSet('尸', width, height, 1, 0);
        const transitionColor = '#5a4a48', textColor = '#a87980';
        const skin = skinState === 2 ? '#858585' : (skinState === 1 ? '#b65454' : (z.skin || '#78936b'));
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
            const entityColor = zombieBodyColorAt(px, py, z.type, coat, skin);
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

// 像素小人取色：外观参数化（肤色/发色/上衣/裤子/鞋子/瞳色/发型）+ 可选逐帧动画。
// 动画参数 anim = { dir:'up'|'down'|'left'|'right', frame:0|1|2, moving, run, atk }，
// 不传 anim 或 moving=false 时为静态站立。28×33 网格，供世界渲染与捏脸预览共用。
// 形象增强（技术美术版）：hairStyle 0=短发 1=齐刘海长发 2=双马尾；
// 表情（眉毛/眼睛高光/眨眼/嘴型随状态）；姿态（奔跑发丝后飘+弹跳、挥击手臂前伸/上举）。
export function playerBodyColorAt(px, py, bodyColor, look, anim) {
    const L = look || {};
    const S = lookShades(bodyColor || L.shirt || '#39d98a', L);
    const a = anim || null;
    const moving = !!(a && a.moving);
    const f = moving ? (a.frame === 0 ? 1 : a.frame === 2 ? -1 : 0) : 0; // 迈步相位
    const amp = a && a.run ? 2 : 1;                                  // 奔跑摆幅
    const isSide = !!(moving && (a.dir === 'left' || a.dir === 'right'));
    const isUp = !!(a && a.dir === 'up');                            // 直行=背面
    const sign = a && a.dir === 'right' ? 1 : -1;                    // 右向镜像
    const bob = !moving && a && a.frame === 1 ? 1 : (moving && a.frame !== 1 ? -(a && a.run ? 2 : 1) : 0); // 迈步上浮(跑更弹) / 站立呼吸
    const hs = L.hairStyle === 1 || L.hairStyle === 2 ? L.hairStyle : 0; // 发型 0短发/1长发/2双马尾
    const atk = !!(a && a.atk);                                      // 挥击姿态
    // 腿：正面/背面垂直交错，侧面水平交错
    const ldx = isSide ? f * amp * sign : 0, ldy = isSide ? 0 : f * amp;
    const rdx = isSide ? -f * amp * sign : 0, rdy = isSide ? 0 : -f * amp;
    const adx = isSide ? f * amp * sign : 0, ady = isSide ? 0 : f * amp; // 臂
    // 奔跑时发丝后飘（左右跑朝身后偏 1px）；马尾随步伐摆动
    const hairSweep = moving && a.run && isSide ? -sign : 0;
    const tailSway = isSide ? 0 : f * amp;
    // 挥击手臂：侧面朝前伸出，正/背面双手上举
    const armFwd = atk && isSide ? sign : 0;
    const armY0 = atk ? (isSide ? 14 : 10) : 13;
    const armY1 = atk ? (isSide ? 18 : 16) : 20;
    const R = (x0, y0, x1, y1, dx = 0, dy = 0) =>
        px - dx >= x0 && px - dx < x1 && py - dy >= y0 && py - dy < y1;

    let c = null;
    // 鞋（含鞋底暗部）
    if (R(6, 28, 12, 33, ldx, ldy + bob)) c = S.shoes;
    if (R(16, 28, 22, 33, rdx, rdy + bob)) c = S.shoes;
    if (R(6, 30, 12, 33, ldx, ldy + bob)) c = S.shoesDark;
    if (R(16, 30, 22, 33, rdx, rdy + bob)) c = S.shoesDark;
    // 裤（裤脚暗部）
    if (R(7, 20, 13, 28, ldx, ldy + bob)) c = S.pants;
    if (R(15, 20, 21, 28, rdx, rdy + bob)) c = S.pants;
    if (R(7, 25, 13, 28, ldx, ldy + bob)) c = S.pantsDark;
    if (R(15, 25, 21, 28, rdx, rdy + bob)) c = S.pantsDark;
    // 上衣（肩/胸高光 + 腰带/下摆/侧影）
    if (R(6, 12, 22, 20, 0, bob)) c = S.shirt;
    if (R(6, 12, 22, 13, 0, bob)) c = S.shirtLight;
    if (R(9, 14, 19, 16, 0, bob)) c = S.shirtLight;
    if (R(7, 17, 21, 19, 0, bob)) c = S.shirtDark;
    if (R(6, 19, 22, 20, 0, bob)) c = S.shirtDark;
    if ((R(6, 13, 8, 19, 0, bob) || R(20, 13, 22, 19, 0, bob))) c = S.shirtDark;
    // 手臂（袖口 + 手；侧面只画朝向侧的单臂；挥击时前伸/上举）
    if (isSide) {
        if (sign < 0) {
            if (R(2 + armFwd, armY0, 5 + armFwd, armY1, adx, bob)) c = S.skin;
            if (R(2 + armFwd, armY0, 5 + armFwd, armY0 + 2, adx, bob)) c = S.shirtDark;
        } else {
            if (R(23 + armFwd, armY0, 26 + armFwd, armY1, adx, bob)) c = S.skin;
            if (R(23 + armFwd, armY0, 26 + armFwd, armY0 + 2, adx, bob)) c = S.shirtDark;
        }
    } else {
        if (R(2, armY0, 5, armY1, adx, bob)) c = S.skin;
        if (R(23, armY0, 26, armY1, -adx, bob)) c = S.skin;
        if (R(2, armY0, 5, armY0 + 2, adx, bob)) c = S.shirtDark;
        if (R(23, armY0, 26, armY0 + 2, -adx, bob)) c = S.shirtDark;
    }
    // 脖子阴影
    if (R(12, 10, 16, 12, 0, bob)) c = S.skinShade;
    // 头 + 耳朵
    if (R(8, 1, 20, 11, 0, bob)) c = S.skin;
    if (R(7, 6, 9, 10, 0, bob)) c = S.skinShade;
    if (R(19, 6, 21, 10, 0, bob)) c = S.skinShade;
    // 头发（顶 + 鬓角；直行背面整个后脑；奔跑发丝后飘）
    if (R(8, 0, 20, 4, hairSweep, bob)) c = S.hair;
    if (R(8, 1, 20, 2, hairSweep, bob)) c = S.hairLight;
    if (R(8, 4, 10, 8, hairSweep, bob)) c = S.hair;
    if (R(18, 4, 20, 8, hairSweep, bob)) c = S.hair;
    // 发型 1 齐刘海：盖额头的刘海层（止于眉毛上方）+ 两侧披肩长发
    if (hs === 1) {
        if (R(9, 3, 19, 5, hairSweep, bob)) c = S.hair;
        if (R(10, 3, 18, 4, hairSweep, bob)) c = S.hairLight;
        if (!isUp && R(7, 11, 9, 17, 0, bob)) c = S.hair;
        if (!isUp && R(19, 11, 21, 17, 0, bob)) c = S.hair;
        if (!isUp && R(7, 14, 9, 17, 0, bob)) c = S.hairDark;
        if (!isUp && R(19, 14, 21, 17, 0, bob)) c = S.hairDark;
    }
    // 发型 2 双马尾：两侧马尾随步伐摆动（侧面只画朝向侧）
    if (hs === 2) {
        if (!isSide) {
            if (R(3, 3, 7, 12, 0, tailSway + bob)) c = S.hair;
            if (R(21, 3, 25, 12, 0, -tailSway + bob)) c = S.hair;
            if (R(3, 10, 7, 12, 0, tailSway + bob)) c = S.hairDark;
            if (R(21, 10, 25, 12, 0, -tailSway + bob)) c = S.hairDark;
        } else if (sign < 0) {
            if (R(3, 3, 7, 12, 0, tailSway + bob)) c = S.hair;
            if (R(3, 10, 7, 12, 0, tailSway + bob)) c = S.hairDark;
        } else {
            if (R(21, 3, 25, 12, 0, -tailSway + bob)) c = S.hair;
            if (R(21, 10, 25, 12, 0, -tailSway + bob)) c = S.hairDark;
        }
    }
    if (isUp) {
        if (R(8, 4, 20, 10, 0, bob)) c = S.hair;
        if (R(8, 4, 20, 5, 0, bob)) c = S.hairLight;
        // 长发直行：后脑发梢延长至颈
        if (hs === 1 && R(8, 10, 20, 12, 0, bob)) c = S.hair;
        if (hs === 1 && R(8, 11, 20, 12, 0, bob)) c = S.hairDark;
    } else {
        // 眉毛（深发色，刘海 1 型时露在刘海下沿）
        if (R(9, 5, 11, 6, 0, bob)) c = S.hairDark;
        if (R(17, 5, 19, 6, 0, bob)) c = S.hairDark;
        if (isSide) {
            // 侧脸：单眼 + 眼睛高光 + 偏侧嘴；发型 1 后脑侧覆盖
            if (hs === 1) {
                if (sign < 0 ? R(8, 4, 13, 10, 0, bob) : R(15, 4, 20, 10, 0, bob)) c = S.hair;
                if (sign < 0 ? R(8, 4, 13, 5, 0, bob) : R(15, 4, 20, 5, 0, bob)) c = S.hairLight;
            }
            const ex = sign < 0 ? 10 : 17;
            const blink = !moving && a && a.frame === 1; // 站立呼吸帧眯眼
            if (R(ex, blink ? 7 : 6, ex + 2, 8, 0, bob)) c = L.eyes;
            if (R(ex, blink ? 7 : 6, ex + 1, blink ? 8 : 7, 0, bob)) c = S.eyeHighlight;
            const mx = sign < 0 ? 11 : 14;
            const mw = moving ? (a.run ? 4 : 3) : 3; // 跑咧嘴 / 走微张
            const mh = moving && a.run ? 2 : 1;
            if (R(mx, 8, mx + mw, 8 + mh, 0, bob)) c = S.mouth;
        } else {
            // 正脸：双眼(眨眼) + 高光 + 腮红 + 嘴(随状态)；发型 1 刘海遮额
            if (hs === 1 && R(9, 5, 19, 6, 0, bob)) c = S.hair;
            const blink = !moving && a && a.frame === 1; // 站立呼吸帧眯眼
            if (R(10, blink ? 7 : 6, 12, 8, 0, bob)) c = L.eyes;
            if (R(16, blink ? 7 : 6, 18, 8, 0, bob)) c = L.eyes;
            if (R(10, blink ? 7 : 6, 11, blink ? 8 : 7, 0, bob)) c = S.eyeHighlight;
            if (R(16, blink ? 7 : 6, 17, blink ? 8 : 7, 0, bob)) c = S.eyeHighlight;
            if (R(9, 7, 10, 8, 0, bob)) c = S.cheek;
            if (R(18, 7, 19, 8, 0, bob)) c = S.cheek;
            if (atk) { // 挥击喊声：嘴张大
                if (R(11, 8, 17, 10, 0, bob)) c = S.mouth;
            } else if (moving) {
                if (R(11, 8, 17, 8 + (a.run ? 2 : 1), 0, bob)) c = S.mouth;
            } else {
                if (R(12, 8, 16, 9, 0, bob)) c = S.mouth;
            }
        }
    }
    return c;
}

// 像素小人离屏缓存：每个（外观+动画帧）组合只生成一次位图，之后 drawImage 整帧贴出。
const _bodySpriteCache = new Map();
export function drawPixelPlayerBody(ctx, sx, sy, color = '#39d98a', infection, look, anim) {
    const level = (infection || 0) / 100;
    const x = Math.round(sx - 12), y = Math.round(sy - 17);
    const width = 28, height = 33;
    if (level <= 0.01) {
        const L = look || {};
        const key = [color, L.skin, L.hair, L.pants, L.shoes, L.eyes, L.hairStyle,
            anim && anim.dir, anim && (anim.moving ? 'm' : 's'), anim && anim.frame,
            anim && anim.run ? 'r' : 'w', anim && anim.atk ? 'a' : 'n'].join('|');
        let cv = _bodySpriteCache.get(key);
        if (!cv) {
            cv = makeOffscreen(width, height);
            const octx = cv.getContext('2d');
            octx.imageSmoothingEnabled = false;
            for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
                const c = playerBodyColorAt(px, py, color, look, anim);
                if (c) { octx.fillStyle = c; octx.fillRect(px, py, 1, 1); }
            }
            if (_bodySpriteCache.size < 1600) _bodySpriteCache.set(key, cv);
        }
        ctx.drawImage(cv, x, y);
        return;
    }
    const textPixels = getTextSet('人', width, height, 1, 0);
    const transitionColor = '#4a5a50', textColor = '#a0b8a8';
    const seed = 0x91D7;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const entityColor = playerBodyColorAt(px, py, color, look, anim);
        const isTextPixel = textPixels.has(px * 100 + py);
        if (!entityColor && !isTextPixel) continue;
        const edge = Math.min(px / (width - 1), (width - 1 - px) / (width - 1),
            py / (height - 1), (height - 1 - py) / (height - 1));
        const noise = hash2(seed ^ 0x51A9, px, py);
        const peelAt = .04 + edge * 1.24 + noise * .36;
        const frontier = .06;
        let c = null;
        if (level < peelAt - frontier) {
            if (entityColor) c = entityColor;
        } else if (level < peelAt) {
            const t = (level - (peelAt - frontier)) / frontier;
            if (entityColor) c = mixHexColor(entityColor, transitionColor, t);
            else if (isTextPixel) c = mixHexColor(transitionColor, textColor, t);
        } else {
            if (isTextPixel) c = textColor;
        }
        if (c) { ctx.fillStyle = c; ctx.fillRect(x + px, y + py, 1, 1); }
    }
    ctx.restore();
}

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

        drawWorld(ctx, sv, camX, camY, W, H);
        WGRASS.grassRenderLayer(ctx, sv, camX, camY, W, H);   // 动态草层（风摆 + 玩家踩动）
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
        drawEventOverlay(ctx, sv, W, H);   // 随机事件暗角（沙尘暴沙色/停电夜深蓝，D）
        drawSickVignette(ctx, sv, W, H);
        drawHUD(ctx, sv, W, H);
        drawDriveHUD(ctx, sv, W);
        drawTeamPanel(ctx, sv, W, H);
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
    // 饥饿光晕（室内外通用，盖在最上层）：昏黄呼吸光 + 边缘暗角，模拟快晕倒的眩晕感
    drawStarveVignette(ctx, sv, W, H);
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

// ---------- 随机事件氛围覆盖层（D）：沙尘暴沙色 / 停电夜暗角 ----------
function drawEventOverlay(ctx, sv, W, H) {
    if (!sv._evt) return;
    if (sv._evt.type === 'sandstorm') {
        // 沙色呼吸暗角
        const breathe = 0.5 + 0.5 * Math.sin(sv.now * 2.2);
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
        g.addColorStop(0, 'rgba(150,110,40,0)');
        g.addColorStop(1, `rgba(150,110,40,${(0.18 + 0.10 * breathe).toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    } else if (sv._evt.type === 'blackout') {
        // 停电：四周更暗的窄视（加深边缘）
        const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.9);
        g.addColorStop(0, 'rgba(0,0,20,0)');
        g.addColorStop(1, 'rgba(0,0,20,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
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
function containerHighlight(sv, t, tx, ty) {
    if (t === T.TIRES) return false;
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
    if (o.repaired && !o.wreck) { ctx.shadowColor = '#2EE6C0'; ctx.shadowBlur = o.near ? 12 : 6; }
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
        ctx.lineWidth = 1;
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
// 静止/步行/驾驶期间每帧只贴一张离屏图 + 少量动态覆盖，消除逐帧重绘地块的 CPU 峰值；
// 交互脉冲（车辆高亮、容器发光、植物本体与血条）等动画留在动态层按帧绘制。
// ============================================================
let _worldLayerCache = null;

function drawWorld(ctx, sv, camX, camY, W, H) {
    const t0x = Math.floor(camX / TS) - 1, t0y = Math.floor(camY / TS) - 1;
    const t1x = Math.ceil((camX + W) / TS) + 1, t1y = Math.ceil((camY + H) / TS) + 1;
    const rev = sv._zombiePathRevision || 0;   // setTile 时递增：地块变化 → 静态层失效重建
    let c = _worldLayerCache;
    if (!c || c.rev !== rev || c.seed !== sv.world.seed ||
        c.t0x !== t0x || c.t0y !== t0y || c.t1x !== t1x || c.t1y !== t1y) {
        const cw = (t1x - t0x + 1) * TS, chh = (t1y - t0y + 1) * TS;
        if (!c) { c = _worldLayerCache = {}; }
        if (!c.canvas || c.canvas.width !== cw || c.canvas.height !== chh) {
            c.canvas = makeOffscreen(cw, chh);
            c.bctx = c.canvas.getContext('2d');
        }
        c.rev = rev; c.seed = sv.world.seed;
        c.t0x = t0x; c.t0y = t0y; c.t1x = t1x; c.t1y = t1y;
        c.dyn = { cars: [], pulses: [], plants: [] };
        drawWorldStatic(c.bctx, sv, t0x * TS, t0y * TS, cw, chh, c.dyn);
    }
    // blit 坐标取整：camX/camY 是小数（玩家移动任意）→ 亚像素 blit 会双线性插值，
    // 每 36px 格边缘产生半像素色带 = "格子状分割线"（预览页无相机滚动所以看不到）
    ctx.drawImage(c.canvas, Math.round(t0x * TS - camX), Math.round(t0y * TS - camY));
    drawWorldDynamic(ctx, sv, camX, camY, W, H, c.dyn);
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
    // 交互目标金色描边（碎石不是容器：可 F 开采但无宝箱式交互框，避免误导）
    if (sv.promptTarget && sv.promptTarget.t !== T.RUBBLE) {
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
function drawWorldStatic(ctx, sv, camX, camY, W, H, dyn) {
    const cs = CHUNK * TS;
    const c0x = Math.floor(camX / cs), c0y = Math.floor(camY / cs);
    for (let cy = c0y; cy <= c0y + Math.ceil(H / cs); cy++)
        for (let cx = c0x; cx <= c0x + Math.ceil(W / cs); cx++) {
            ctx.fillStyle = BIOME_BG[chunkBiome(sv.world.seed, cx, cy)] || '#000';
            ctx.fillRect(cx * cs - camX, cy * cs - camY, cs, cs);
        }

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
            if (isGroundTile(t)) {
                drawGroundTile(ctx, sv, tx, ty, camX, camY);
            } else {
                // 统一叠加规则：先完整绘制该位置的实际地面（人行道/公路/草地——不区分物体类型），
                // 物体作为上层叠加在地面之上，不携带任何背景、不改变下方地面。
                drawGroundTile(ctx, sv, tx, ty, camX, camY, groundTypeAt(sv, tx, ty));
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
// ---------- NPC（像素小人 + 名条 + 阵营色 + 血条） ----------
function drawNpcs(ctx, sv, camX, camY, W, H) {
    if (!sv.npcs) return;
    const controllerId = sv.controllerId;
    for (const n of sv.npcs) {
        if (!n.alive) continue;
        if (n.riding) continue;   // 乘车中：由车辆渲染
        if (controllerId && n.id === controllerId) continue;   // 主控角色画成玩家
        const sx = n.x - camX, sy = n.y - camY;
        // 性能：屏幕外 NPC 不绘制（含名条/血条/特效）
        if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;
        const tint = n.party ? '#66CCFF'
            : (n.role === 'hostile' ? '#FF5544'
                : (n.role === 'friendly' ? '#39d98a' : '#FFD700'));
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
        drawNameplate(ctx, sx, sy - TS / 2 - 14, n.name, tint);
        ctx.save();
        ctx.shadowColor = tint;
        ctx.shadowBlur = n.hurtT > 0 ? 14 : 5;
        // 上衣取 NPC 的捏脸外观（阵营由名条+光晕辨识）
        drawPixelPlayerBody(ctx, sx, sy, (n.look && n.look.shirt) || tint, 0, n.look);
        ctx.restore();
        // 近战挥击特效（与玩家同一套：按武器样式差异化绘制）
        drawSwingEffect(ctx, sx, sy, n.swingT, n.swingDir, n.swingWeapon);
        if (n.hp < n.maxHp || n.role === 'hostile' || n.party) {
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
            ctx.fillStyle = b.color || '#FFF';
            ctx.fillText(b.label || '·', b.x - camX, b.y - camY);
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
        const nameText = isCtrl ? n.name + ' ◈' : n.name;
        const nameW = Math.min(ctx.measureText(nameText).width, pw - 56);
        ctx.fillText(nameText, x + 10, y + 9, pw - 56);
        ctx.font = '9px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#7a8b95';
        ctx.fillText(n.wpnName || '拳头', x + 14 + nameW, y + 10, Math.max(18, pw - 56 - nameW));
        // 状态徽标（病/营/随/战）
        let st = '', sc = '#8a9aa2';
        if (n.sick) { st = '病'; sc = '#FF8866'; }
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
    drawSwingEffect(ctx, px, py, sv.swingT, sv.swingDir, sv.swingWeapon);

    // 本体（受击变红 / 无敌帧闪烁）；上衣颜色取捏脸外观，不再写死绿色
    const blink = sv.invuln > 0 && Math.floor(sv.now * 20) % 2 === 0;
    ctx.globalAlpha = blink ? 0.35 : 1;
    const lookShirt = (sv.character && sv.character.shirt) || '#39d98a';
    const playerColor = (sv.hurtT > 0 && Math.floor(sv.now * 10) % 2 === 0) ? '#FF4444' : lookShirt;
    // 光晕跟衣服色走且减弱，避免绿色光盖住捏脸外观
    ctx.shadowColor = lookShirt;
    ctx.shadowBlur = 4;
    drawPixelPlayerBody(ctx, px, py, playerColor, sv.infection, sv.character, anim);
    ctx.shadowBlur = 0;
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
    // 挥砍特效（同步挥砍状态）
    if (p.swingT > 0) drawSwingEffect(ctx, sx, sy, p.swingT, p.swingDir || 0, p.swingWeapon);
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

// ---------- 遗物包裹 · 距离指引（正常模式队友救回后原地留下的行李，金色方箱样式） ----------
// 玩家死亡（正常难度）→ 掉落全部物品成「遗物包裹」留在原地，有指引可前往拾取。
// 样式与队友（圆点）和尸化自己（紫菱形）区分：金色方箱底 + 金色箭头 + 标签「遗物包裹 · N格」。
const LEGACY_GUIDE_COLOR = '#FFD700';   // 金色
function drawLegacyDropGuide(ctx, sv, W, H, sharedDrawn) {
    if (!sv._legacyDrop || !sv.drops) return;
    // 指引的是"死亡点"（包裹位置）——若包裹已被拾取（drops 中无 loot:legacy）则指引消失
    const bagStillThere = sv.drops.some(d => d.id === 'loot:legacy' && d.contents && d.contents.length);
    if (!bagStillThere) { sv._legacyDrop = null; return; }
    const tx = sv._legacyDrop.x, ty = sv._legacyDrop.y;
    const dx = tx - sv.px, dy = ty - sv.py;
    const dist = Math.hypot(dx, dy);
    const sx = tx - sv.camX, sy = ty - sv.camY;
    const margin = 52;
    // 同屏：能看到包裹（drawDrops 已画金色袋 + 名字牌），不显示指引
    if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin) return;
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
    // 金色方箱底 + 描边（与队友圆底、尸化菱形三方区分）
    ctx.fillStyle = 'rgba(40,28,4,0.9)';
    ctx.strokeStyle = LEGACY_GUIDE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-12, -12, 24, 24);
    ctx.fill(); ctx.stroke();
    // 箱盖线（金色横条）
    ctx.strokeStyle = LEGACY_GUIDE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-10, -4); ctx.lineTo(10, -4);
    ctx.stroke();
    // 指向包裹的金色箭头
    ctx.rotate(ang);
    ctx.fillStyle = LEGACY_GUIDE_COLOR;
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
    const label = '遗物包裹 · ' + Math.round(dist / TS) + ' 格';
    const lw = ctx.measureText(label).width + 10;
    roundRectPath(ctx, px2 - lw / 2, py2 + 24, lw, 18, 4);
    ctx.fill();
    ctx.strokeStyle = LEGACY_GUIDE_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#FFE98A';
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

    // 天数 / 时刻 / 区域
    const dayT = (sv.t / sv.dayLen) * 24;
    const hh = String(Math.floor(dayT)).padStart(2, '0');
    const mm = String(Math.floor((dayT % 1) * 60)).padStart(2, '0');
    const pcx = Math.floor(sv.px / TS / CHUNK), pcy = Math.floor(sv.py / TS / CHUNK);
    const dName = districtNameOverride || districtProfile(sv.world.seed, pcx, pcy).name;
    ctx.fillStyle = '#DDDDDD';
    ctx.fillText(`第 ${sv.day} 天  ${hh}:${mm}  [${dName}]`, 232, 17);

    // 背包占用 + 金币
    let coins = 0;
    if (sv.inv) for (const s of sv.inv) if (s && s.id === COIN_ID) coins += s.n;
    ctx.fillStyle = '#AABBCC';
    ctx.textAlign = 'right';
    ctx.fillText(`背包 ${sv.inv.filter(Boolean).length}/24 · 金币 ${coins}`, W - 12, 17);

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
        const sy = 92;
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
        const by = sv._sick && SICKNESS[sv._sick.type] ? 110 : 92;
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

    // 底部操作提示
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, H - 26, W, 26);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888888';
    ctx.font = '12px "Microsoft YaHei", monospace';
    ctx.fillText(sv.build
        ? '建造模式：1-5 选择 · 左键放置 · F 拆除 · G/ESC 退出'
        : 'WASD 移动 · Shift 奔跑 · Q 闪现 · E 格挡 · 空格 跳跃 · 左键/J 攻击 · F 交互 · G 建造 · B 背包 · P 暂停 · F11 全屏', W / 2, H - 13);

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

    // 玩家（复用大世界渲染：挥砍弧 / 残影 / 格挡盾 / 跳跃影 / 蓄力换弹指示）
    drawPlayer(ctx, sv, -ox, -oy);

    // 联机：室内也渲染远端队友（camX=-ox / camY=-oy 已就绪，室内坐标直接可用；
    // 队友在室外时由 drawRemotePlayer 内部走"在楼外"标记）
    if (sv.p2) drawRemotePlayer(ctx, sv, -ox, -oy);

    // 特效
    drawEffects(ctx, sv, -ox, -oy);
    // 昼夜压暗（室内减半，保持可玩性）
    drawDayNight(ctx, sv, W, H, true);
    drawSickVignette(ctx, sv, W, H);

    // 室内 HUD：状态条与室外完全一致（HP/天数/区域/背包/体力/饱食/水分/感染/武器）；
    // 区域按建筑所在区块计算（避免室内坐标算出错误区域）。
    const itDName = districtProfile(sv.world.seed,
        Math.floor((it.originX || 0) / CHUNK), Math.floor((it.originY || 0) / CHUNK)).name;
    drawStatusHUD(ctx, sv, W, itDName);
    // 室内专属：室 内 · 楼层 · 僵尸数量
    const curFloor = it.floor || 1;
    const floorTag = curFloor > 1 ? `${curFloor}层` : (curFloor < 0 ? `地下${Math.abs(curFloor)}层` : '1层');
    const left = it.zombies.length;
    ctx.textAlign = 'left';
    ctx.font = '14px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#D29A5B';
    ctx.fillText(`室 内 · ${floorTag} · ${left > 0 ? `僵尸 ×${left}` : '已清剿'}`, 400, 17);

    // 底部提示
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, H - 26, W, 26);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888888';
    ctx.font = '12px "Microsoft YaHei", monospace';
    ctx.fillText(curFloor === 1
        ? 'WASD 移动 · 左键/J 攻击 · F 搜索箱子 · 走到绿色[出]字离开室内'
        : 'WASD 移动 · 左键/J 攻击 · F 搜索箱子 · 上楼走↑楼梯，下楼走↓楼梯', W / 2, H - 13);

    drawMsg(ctx, sv, W);
}
