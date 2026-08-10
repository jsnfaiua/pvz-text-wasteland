// ============================================================
// 【无尽植僵荒原】模组 · 世界地图（室外总览）
// 按 M 打开：显示已探索区块的地形总览（区域底色 + 主干道 + 建筑主体），
// 未探索区块显示未知底色；鼠标中键滚轮缩放（围绕屏幕中心）；
// 只显示主体部分（道路 / 建筑 / 区域分界），小于 2×2 格的物品
// （树 / 箱 / 车 / 草 / 花等）不显示。
// 打开时一次性绘制到离屏 canvas，缩放时重新绘制；不逐帧重算。
// 世界时间照常流逝（用户定案：除 ESC 外界面不暂停世界）。
// 探索记录：sv.mods.explored = { 'cx,cy': 1 }，区块级位掩码（随世界档保存）。
// ============================================================

import { TS } from './wconst.js';
import { CHUNK, chunkBiome, gridRoadKept, hash2 } from './world.js';
import { districtAt, nearestCityAt, buildingTypeAt, arterialClassAt } from './wdistrict.js';
import AudioSystem from '../systems/audio.js';

let ui = null;           // 地图 DOM 根
let mapCv = null;        // 主 canvas
let bgCv = null;         // 离屏背景 canvas（一次性绘制）
let curSv = null;
let zoom = 2;            // 每格像素（缩放围绕玩家位置）
let viewCx = 0, viewCy = 0;   // 视野中心世界格坐标
let panX = 0, panY = 0;  // 平移偏移（像素）
const MIN_ZOOM = 0.5, MAX_ZOOM = 8;

// 区域配色（与 render.js BIOME_BG 呼应但更亮，保证地图可读）：城区/郊区/荒野/废墟
const REGION_COLOR = ['#3a3355', '#39434f', '#3c4a33', '#4a3a2c'];
const REGION_EDGE = ['#6a5f99', '#6a7d99', '#6a9955', '#996a4c'];
// 主体要素配色
const ROAD_COLOR = '#8b8f9e';
const ROAD_EDGE = '#c9cedc';
const BUILD_COLOR = '#7c7a88';
const BUILD_EDGE = '#b8b6c4';
const UNKNOWN_COLOR = '#1a1a14';   // 未探索底色（暗墨绿）
const WATER_COLOR = '#2e4a6e';
const CAMP_COLOR = '#ffd24a';
const PLAYER_COLOR = '#ffffff';
const CITY_COLOR = '#e8b84a';

export function isOpen() { return !!ui; }

export function open(sv) {
    if (ui) return;
    curSv = sv;
    // 视野中心 = 玩家精确位置（格坐标）
    viewCx = sv.px / TS;
    viewCy = sv.py / TS;
    zoom = 2;
    panX = 0; panY = 0;
    buildUI(sv);
    render(sv);
    AudioSystem.playClick();
}

export function close() {
    if (!ui) return;
    ui.remove();
    ui = null; mapCv = null; bgCv = null; curSv = null;
}

export function toggle(sv) {
    if (ui) { close(); return; }
    open(sv);
}

// ---------- 探索标记（host/单机每帧调用；guest 本地只读显示） ----------
// 玩家所在区块 + 8 邻域标记为已探索（区块级，走过即记）。
// 联机：探索记录属世界档（host 权威），guest 走过 → 上报 host 合并。
let lastExploreCx = -9999, lastExploreCy = -9999;
export function markExplore(sv) {
    if (!sv || !sv.world || sv.dead || sv.interior) return;
    const cx = Math.floor(sv.px / TS / CHUNK), cy = Math.floor(sv.py / TS / CHUNK);
    if (cx === lastExploreCx && cy === lastExploreCy) return;
    lastExploreCx = cx; lastExploreCy = cy;
    if (!sv.mods.explored) sv.mods.explored = {};
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        sv.mods.explored[(cx + dx) + ',' + (cy + dy)] = 1;
    // 联机：guest 上报 host（host 权威合并进世界档；host 自身直接记录）
    if (sv.mp && sv.mp.role === 'guest') {
        (sv.mpOutbox = sv.mpOutbox || []).push({ type: 'explore', cx, cy });
    }
}

// ---------- 地图 UI ----------
function buildUI(sv) {
    ui = document.createElement('div');
    ui.id = 'wsl-map';
    ui.style.cssText = 'position:absolute;inset:0;z-index:895;background:rgba(6,8,10,0.88);display:flex;align-items:center;justify-content:center;cursor:crosshair;';
    ui.innerHTML =
        '<div style="position:relative;width:88%;height:86%;display:flex;flex-direction:column;">' +
        '  <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px 6px;">' +
        '    <span style="color:#cfd8dd;font-size:15px;letter-spacing:2px;">◈ 世界地图 <span id="wsl-map-region" style="color:#ffd24a;"></span></span>' +
        '    <span style="color:#8a9aa2;font-size:12px;">滚轮缩放 · M/ESC 关闭</span>' +
        '  </div>' +
        '  <canvas id="wsl-map-cv" style="flex:1;width:100%;height:100%;border:1px solid #3a4a55;"></canvas>' +
        '</div>';
    document.getElementById('game-container').appendChild(ui);
    mapCv = ui.querySelector('#wsl-map-cv');
    mapCv.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY > 0 ? 1 / 1.25 : 1.25;
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
        render(curSv);
    });
}

// ---------- 渲染（打开 / 缩放 / 平移时调用） ----------
function render(sv) {
    if (!mapCv || !sv || !sv.world) return;
    const W = mapCv.clientWidth || 800, H = mapCv.clientHeight || 500;
    const dpr = window.devicePixelRatio || 1;
    mapCv.width = W * dpr; mapCv.height = H * dpr;
    if (!bgCv) bgCv = document.createElement('canvas');
    bgCv.width = mapCv.width; bgCv.height = mapCv.height;
    const g = bgCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const seed = sv.world.seed;

    // 视野中心世界格（玩家位置 + 平移偏移）
    const centerGx = viewCx + panX, centerGy = viewCy + panY;
    const gx0 = Math.floor(centerGx - W / 2 / zoom), gy0 = Math.floor(centerGy - H / 2 / zoom);
    const gx1 = Math.ceil(centerGx + W / 2 / zoom), gy1 = Math.ceil(centerGy + H / 2 / zoom);

    g.fillStyle = UNKNOWN_COLOR;
    g.fillRect(0, 0, W, H);

    const explored = sv.mods.explored || {};
    const c0 = Math.floor(gx0 / CHUNK), c1 = Math.floor(gx1 / CHUNK);
    const d0 = Math.floor(gy0 / CHUNK), d1 = Math.floor(gy1 / CHUNK);
    // 2026-08-11 性能：全图揭示后 explored 含 ±400 区块（64 万 key），低 zoom 全图视野下
    // 区块循环可达 16 万次 fillRect/strokeRect → 打开/缩放地图卡顿。
    // ① 合并"区域底色 + 建筑色块"为单次区块循环（省一半循环）；② 区块 <2px 时不画边框
    // （细边看不清，纯浪费）；③ 全图视野（区块 <3px）时隔区采样 + 放大填充，视觉无损。
    const cellPx = CHUNK * zoom;                       // 每区块像素
    const cStep = cellPx < 3 ? 2 : 1;                  // 区块 <3px 时隔区块采样（fill 放大 2 格覆盖）
    const drawEdge = cellPx >= 3;                      // 区块 <3px 免画边框
    for (let cx = c0; cx <= c1; cx += cStep) for (let cy = d0; cy <= d1; cy += cStep) {
        if (!explored[cx + ',' + cy]) continue;
        const b = chunkBiome(seed, cx, cy);
        const bx = (cx * CHUNK - gx0) * zoom, by = (cy * CHUNK - gy0) * zoom;
        const fw = Math.min((c1 - cx + 1) * CHUNK * zoom, CHUNK * zoom * cStep);
        const sz = CHUNK * zoom;
        // 区域底色
        g.fillStyle = REGION_COLOR[b] || REGION_COLOR[0];
        g.fillRect(bx, by, fw, fw);
        if (drawEdge) {
            g.strokeStyle = REGION_EDGE[b] || REGION_EDGE[0];
            g.lineWidth = 1;
            g.strokeRect(bx + 0.5, by + 0.5, fw - 1, fw - 1);
        }
        // 建筑主体（与底色同循环；该区块有建筑 → 叠加色块，>2×2 的主体感）
        if (buildingTypeAt(seed, cx, cy)) {
            g.fillStyle = BUILD_COLOR;
            g.fillRect(bx + 1, by + 1, Math.max(2, fw - 2), Math.max(2, fw - 2));
            if (drawEdge) {
                g.strokeStyle = BUILD_EDGE;
                g.lineWidth = 1;
                g.strokeRect(bx + 1.5, by + 1.5, Math.max(2, fw - 3), Math.max(2, fw - 3));
            }
        }
    }
    // 格级采样的步长：zoom≥4 逐格；否则 step≥3 降采样（道路/水体带宽 ≥4 格，降采样不丢主体）。
    // 2026-08-11 由原 `max(1, round(4/zoom))`（zoom=2 时 step=2 → 16 万次/层采样）改为
    // 下限 3，配合道路+水体单循环，全图/默认视野采样量降 ~60%。
    const step = zoom >= 4 ? 1 : Math.max(3, Math.round(4 / zoom));
    // 2+3) 道路 + 水体（已探索区块内）单循环：每采样点先判道路（主干道/网格保留路），
    //      非路再判水体（荒野区，与 world.js 同盐：格为 GROUND(H11≥0.15) 且 H(12,gx/3,gy/3)<0.06）
    for (let gx = gx0; gx <= gx1; gx += step) {
        const cx = Math.floor(gx / CHUNK);
        for (let gy = gy0; gy <= gy1; gy += step) {
            const cy = Math.floor(gy / CHUNK);
            if (!explored[cx + ',' + cy]) continue;   // 未探索区块跳过（保持未知底色）
            if (arterialClassAt(seed, gx, gy) === 'road' || gridRoadKept(seed, gx, gy)) {
                g.fillStyle = ROAD_COLOR;
                g.fillRect((gx - gx0) * zoom, (gy - gy0) * zoom, Math.ceil(step * zoom), Math.ceil(step * zoom));
            } else if (chunkBiome(seed, cx, cy) === 2
                && hash2(seed ^ 11, gx, gy) >= 0.15
                && hash2(seed ^ 12, Math.floor(gx / 3), Math.floor(gy / 3)) < 0.06) {
                g.fillStyle = WATER_COLOR;
                g.fillRect((gx - gx0) * zoom, (gy - gy0) * zoom, Math.ceil(step * zoom), Math.ceil(step * zoom));
            }
        }
    }
    // 5) 城市中心（已探索区块内，星标）：nearestCityAt 接收区块坐标，返回区块坐标
    const nearCity = nearestCityAt(seed, Math.floor(viewCx / CHUNK), Math.floor(viewCy / CHUNK));
    if (nearCity && explored[nearCity.cellX + ',' + nearCity.cellY]) {
        const x = (nearCity.x * CHUNK - gx0) * zoom, y = (nearCity.y * CHUNK - gy0) * zoom;
        g.fillStyle = CITY_COLOR;
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
        g.strokeStyle = CITY_COLOR;
        g.lineWidth = 1;
        g.strokeRect(x - 3.5, y - 3.5, 7, 7);
    }
    // 6) 营地
    if (sv.camp) {
        const x = (sv.camp.x / TS - gx0) * zoom, y = (sv.camp.y / TS - gy0) * zoom;
        drawFlag(g, x, y, CAMP_COLOR);
    }
    // 7) 玩家位置
    const px = (sv.px / TS - gx0) * zoom, py = (sv.py / TS - gy0) * zoom;
    g.fillStyle = PLAYER_COLOR;
    g.beginPath();
    g.arc(px, py, Math.max(2, zoom * 0.7), 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px, py, Math.max(3.5, zoom + 1.5), 0, Math.PI * 2);
    g.stroke();

    const ctx = mapCv.getContext('2d');
    ctx.clearRect(0, 0, mapCv.width, mapCv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bgCv, 0, 0, W, H);

    // 区域名
    const rg = document.getElementById('wsl-map-region');
    if (rg) {
        const d = districtAt(seed, Math.floor(sv.px / TS / CHUNK), Math.floor(sv.py / TS / CHUNK));
        rg.textContent = '· ' + (d || '');
    }
}

// 小旗帜（营地标记）
function drawFlag(g, x, y, color) {
    g.strokeStyle = '#666';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y + 3);
    g.lineTo(x, y - 4);
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y - 4);
    g.lineTo(x + 4, y - 2.5);
    g.lineTo(x, y - 1);
    g.fill();
}
