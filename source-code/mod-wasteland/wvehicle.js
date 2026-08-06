// ============================================================
// 【无尽植僵荒原】模组 · 载具系统（修理 / 后备箱 / 驾驶）
// 车 tile 存 sv.mods.tiles["gx,gy"] = { t:T.CAR, hp, repaired, dir }
// 后备箱 sv.mods.chests["car:gx,gy"]；驾驶态 sv.driving
// ============================================================

import AudioSystem from '../systems/audio.js';
import { T, CHUNK, getTile, setTile, isWalk, hash2, plannedSidewalkAt, plannedArterialAt, gridRoadKept, findCarParkSpot } from './world.js';
import { districtAt, arterialClassAt, blockAt } from './wdistrict.js';

// 废墟残路带判定：ruins 区 rx<4||ry<4（残路带相位）→ 该格的碎石是"破损路面"可压过；
// 建筑区/人行道带的碎石堆是障碍。与 world.js 废墟 roadBand 生成一致。
function ruinsRoadBandAt(seed, gx, gy) {
    const cx = Math.floor(gx / CHUNK), cy = Math.floor(gy / CHUNK);
    if (districtAt(seed, cx, cy) !== 'ruins') return false;
    const BL = blockAt(seed, cx, cy);
    const rx = ((gx % BL) + BL) % BL, ry = ((gy % BL) + BL) % BL;
    return rx < 4 || ry < 4;
}
import { TS } from './wconst.js';
import * as B from './wbalance.js';
import * as Panel from './panel.js';
import * as MSG from './wmsg.js';
import * as WDEV from './wdev.js';

function log(sv, m, c) { MSG.pushMsg(sv, m, c); }

// 归属标记：修复/驾驶过 → m.owner（主控名或司机名），NPC 驾驶命令只认有归属的车
function ownerName(sv, driverId) {
    if (driverId && sv.npcs) {
        const d = sv.npcs.find(n => n.id === driverId);
        if (d) return d.name;
    }
    if (sv.npcs) {
        const c = sv.npcs.find(n => n.id === (sv.controllerId || 'player'));
        if (c) return c.name;
    }
    return '你';
}

// 修理消耗
export const REPAIR_PARTS = 3;         // 零件数
export const CAR_MAX_HP = 400;         // 车辆耐久（驾驶用）
export const CAR_DRIVE_SPEED = 260;    // 驾驶移动速度（px/s）
export const CAR_TURN = 6;             // 转向速率
export const CAR_CRUSH_DMG = 60;       // 碾压僵尸伤害
export const CAR_CRASH_DMG = 8;        // 撞障碍车辆掉耐久

// 统计背包零件数
function countParts(sv) {
    let n = 0;
    for (const s of sv.inv) if (s && s.id === 'part') n += s.n;
    return n;
}
function takeParts(sv, need) {
    for (const s of sv.inv) {
        if (need <= 0) break;
        if (s && s.id === 'part') { const t = Math.min(s.n, need); s.n -= t; need -= t; }
    }
    for (let i = 0; i < sv.inv.length; i++) if (sv.inv[i] && sv.inv[i].id === 'part' && sv.inv[i].n <= 0) sv.inv[i] = null;
    return need <= 0;
}
function hasWrench(sv) {
    for (const s of sv.inv) if (s && s.id === 'tool:wrench') return true;
    return false;
}

// 车辆品相（确定性，随种子+坐标）：大多数损坏(wreck)、少部分可修(repairable)、极少完好可直接开(intact)
export function carCondition(seed, gx, gy) {
    const r = hash2(seed ^ 0xCA2, gx, gy);
    if (r < 0.05) return 'intact';       // 极少数：完好，可直接点火
    if (r < 0.22) return 'repairable';   // 少数：可用扳手+零件修复
    return 'wreck';                      // 大多数：彻底损坏，无法修复
}

// 停车朝向（确定性，随种子+坐标）：完全随机任意角度（0~2π 连续），
// 野外车辆像真实世界一样随意停靠，不会清一色整整齐齐。
// 车体占位按最近 8 方向格推算（round(cos/sin)），渲染 rotate 支持任意角度。
export function carDirAt(seed, gx, gy) {
    return hash2(seed ^ 0xCA2 ^ 0x77, gx, gy) * Math.PI * 2;
}

// 车数据（惰性初始化 hp 与品相；自然生成的车首次交互时物化进 mods，状态才能持久化）
export function carData(sv, key) {
    const [gx, gy] = key.split(',').map(Number);
    let m = sv.mods.tiles[key];
    const tt = (m && !m.built) ? m.t : getTile(sv, gx, gy);
    if (tt === T.CARWRECK) return { t: T.CARWRECK, cond: 'wreck', wreck: true };   // 报废车：仅可拆解
    if (tt !== T.CAR) return null;
    if (!m) {
        // 自然生成的车：品相按种子确定性，修复/驾驶/后备箱状态从此刻起持久化
        m = sv.mods.tiles[key] = { t: T.CAR, cond: carCondition(sv.world.seed, gx, gy) };
    }
    if (m.cond == null) m.cond = carCondition(sv.world.seed, gx, gy);
    // 完好车（自然生成或开发者刷出）：只初始化一次，修复/驾驶后不回满
    if (m.cond === 'intact' && m.repaired == null) { m.repaired = true; m.hp = CAR_MAX_HP; }
    if (m.hp == null) m.hp = B.CAR_HP;
    // 车辆自带油量随机（20%~75%），首次接触确定后随车持久
    if (m.fuel == null) {
        m.fuel = (B.FUEL_RANDOM_MIN + Math.random() * (B.FUEL_RANDOM_MAX - B.FUEL_RANDOM_MIN)) / 100 * B.FUEL_MAX;
    }
    return m;
}

// ---------- 加油（停车状态，消耗 1 桶汽油） ----------
export function refuelCar(sv, key) {
    const m = carData(sv, key);
    if (!m || m.wreck) return false;
    if (m.fuel >= B.FUEL_MAX) { log(sv, '油箱已经是满的', '#FFB347'); return false; }
    const idx = sv.inv.findIndex(s => s && s.id === 'fuel' && s.n > 0);
    if (idx < 0) { log(sv, '需要汽油才能加油（搜刮/后备箱可得）', '#FFB347'); return false; }
    sv.inv[idx].n--;
    if (sv.inv[idx].n <= 0) sv.inv[idx] = null;
    m.fuel = Math.min(B.FUEL_MAX, m.fuel + B.FUEL_REFILL);
    log(sv, `加油成功：油量 ${Math.round(m.fuel)}/${B.FUEL_MAX}`, '#FFD700');
    return true;
}

// 车脚下的实际地面（与渲染同一规则）：保留公路/主干道→公路；规划人行道→人行道；其余→草地
function groundUnderCar(sv, gx, gy) {
    const seed = sv.world.seed;
    if (plannedSidewalkAt(seed, gx, gy)) return T.SIDEWALK;
    if (plannedArterialAt(seed, gx, gy) === 'road' || gridRoadKept(seed, gx, gy)) return T.ROAD;
    return T.GROUND;
}

// ---------- 修理 ----------
export function repairCar(sv, key) {
    const m = carData(sv, key);
    if (!m) return;
    if (m.repaired) { log(sv, '这辆车已经修好了'); return; }
    if (m.cond === 'wreck') { log(sv, '这辆车已经彻底报废，无法修理', '#FF5544'); return; }
    // 开发者资源无限：免扳手、免零件、不消耗
    const devInf = !!(sv._devInf && WDEV.isDev());
    if (!devInf) {
        if (!hasWrench(sv)) { log(sv, '需要扳手才能修车', '#FFB347'); return; }
        if (countParts(sv) < REPAIR_PARTS) { log(sv, `需要修车零件 ×${REPAIR_PARTS}`, '#FFB347'); return; }
        takeParts(sv, REPAIR_PARTS);
    }
    m.repaired = true;
    m.hp = CAR_MAX_HP;
    m.owner = ownerName(sv);   // 归属标记：所属：主控名
    AudioSystem.playCollect();
    log(sv, devInf ? '汽车修理完成！（开发者资源无限，未消耗材料）' : '汽车修理完成！可以驾驶了', '#2EE6C0');
}

// ---------- 报废车拆解 ----------
export const DISMANTLE_TOOL = 'tool:wrench';
export function dismantleWreck(sv, key) {
    const m = carData(sv, key);
    if (!m) return;
    // 报废车包含两种形态：真 CARWRECK 残骸，以及品相为 wreck 的整车型报废车（自然生成 78%）
    if (!(m.wreck || m.cond === 'wreck')) { log(sv, '这辆车还没报废，无法拆解', '#FFB347'); return; }
    const devInf = !!(sv._devInf && WDEV.isDev());
    if (!devInf && !hasWrench(sv)) { log(sv, '需要扳手才能拆解报废车', '#FFB347'); return; }
    const [gx, gy] = key.split(',').map(Number);
    // 确定性产出（同一种子+坐标拆解结果固定）：零件 2~4 + 木材 1~2 + 40% 概率石块
    const r1 = hash2(sv.world.seed ^ 0xD1A2, gx, gy);
    const r2 = hash2(sv.world.seed ^ 0xD1A3, gx, gy);
    const parts = 2 + Math.floor(r1 * 3);
    const wood = 1 + Math.floor(r2 * 2);
    const stone = r2 > 0.6 ? 1 : 0;
    Panel.addItem(sv, 'part', parts);
    Panel.addItem(sv, 'wood', wood);
    if (stone) Panel.addItem(sv, 'stone', stone);
    // 拆完还原为实际地面（公路/人行道/草地），不留石头堆
    setTile(sv, gx, gy, groundUnderCar(sv, gx, gy));
    if (sv.mods.chests) delete sv.mods.chests['car:' + key];
    AudioSystem.playCollect();
    log(sv, `拆解报废车 → 零件×${parts} 木材×${wood}${stone ? ` 石块×${stone}` : ''}`, '#B8A060');
}

// ---------- 驾驶 ----------
export function startDrive(sv, key, driverId) {
    const m = carData(sv, key);
    if (!m || !m.repaired) { log(sv, '车辆未修复，无法驾驶', '#FFB347'); return false; }
    const [gx, gy] = key.split(',').map(Number);
    // 归属标记：修复/驾驶过 → 所属：主控名（NPC 驾驶则记司机名）
    m.owner = ownerName(sv, driverId);
    sv.driving = {
        key, gx, gy, driver: driverId || null, owner: m.owner,
        x: (gx + 1) * TS, y: (gy + 0.5) * TS,   // 车中心（横跨 2 格）
        dir: m.dir || carDirAt(sv.world.seed, gx, gy),
        speed: 0,
        hp: m.hp != null ? m.hp : CAR_MAX_HP,
        maxHp: CAR_MAX_HP,
        fuel: m.fuel != null ? m.fuel : B.FUEL_MAX,   // 车辆自带油量（随机，随车持久）
    };
    // 成员上车：NPC 驾驶（driverId）→ 司机上车但不占座（主驾），其余成员全部上车
    // （副驾=主控、后排=其余，渲染按座位显示）；玩家驾驶 → 成员不立即上车，
    // 慢慢走向上车集合点（上车动画），走到 2 格内自动上车
    if (sv.npcs) {
        if (driverId) {
            for (const n of sv.npcs) {
                if (!n.alive || n.riding || n.id === sv.controllerId) continue;
                if (n.id === driverId) {
                    n.riding = true;
                    n.x = sv.driving.x; n.y = sv.driving.y;   // 骑乘坐标同步到车（僵尸咬扫用 n.x/n.y，避免隔空咬车外旧坐标）
                    continue;   // 司机上车（主驾，不占座）
                }
                if (n.party) {
                    n.riding = true;
                    n.x = sv.driving.x; n.y = sv.driving.y;   // 同上：队员坐标跟随车
                }
            }
        } else {
            // 玩家驾驶：成员走向上车集合点（上车瞬间的车位置），走到 2 格内自动上车
            const board = { x: (gx + 1) * TS, y: (gy + 0.5) * TS };
            for (const n of sv.npcs) {
                if (!n.alive || n.riding || n.id === sv.controllerId) continue;
                if (n.party) n._boarding = { x: board.x, y: board.y };
            }
        }
    }
    // 主控无条件随车出发（无论是否已走到车边，绝不抛人；位置跟随车渲染）
    sv._chauffeured = true;
    // 车从世界暂时移除（驾驶实体化）；脚下还原为实际地面（公路/人行道/草地），不破坏地形
    setTile(sv, gx, gy, groundUnderCar(sv, gx, gy));
    AudioSystem.playGameStart && AudioSystem.playGameStart();
    log(sv, driverId ? '上车！' : '上车！WASD 驾驶 · F 下车', '#2EE6C0');
    return true;
}

// 下车：主驾驶在车的左上角格（锚点格 gx 为左格，车横跨 gx..gx+1），
// 下车点优先 = 左格上方外侧（(gx+0.5, gy-0.5)）；上方被障碍挡住时依次尝试
// 下方/左侧/右侧，任一方向可站即下车——否则"车到了目的地却全员下不了车"，
// 订单会卡在驾驶态，后续命令全部被拒。
export function stopDrive(sv, canStand) {
    const d = sv.driving;
    if (!d) return false;
    // 车体左格 = 锚点格（车横跨 gx..gx+1，中心在 gx+1 格）：停车原位，不向前漂移
    const gx = Math.floor((d.x - TS) / TS), gy = Math.floor(d.y / TS);
    // 四个下车方向（优先车头上方=人行道侧）；tile 判定时门点落在两格交界处
    const sides = [
        { dx: 0, dy: -1, cells: [[0, -1], [1, -1]] },
        { dx: 0, dy: 1, cells: [[0, 1], [1, 1]] },
        { dx: -1, dy: 0, cells: [[-1, 0], [-1, 1]] },
        { dx: 1, dy: 0, cells: [[1, 0], [2, 0]] },
    ];
    let door = null;
    for (const s of sides) {
        const doorX = (gx + s.dx + 0.5) * TS, doorY = (gy + s.dy + 0.5) * TS;
        if (canStand) {
            if (canStand(doorX, doorY)) { door = { x: doorX, y: doorY }; break; }
        } else if (s.cells.every(([ox, oy]) => isWalk(getTile(sv, gx + ox, gy + oy)))) {
            door = { x: doorX, y: doorY };
            break;
        }
    }
    if (!door) {
        log(sv, '当前位置车门打不开（车门被障碍物挡住），挪动车辆后再按 F 下车', '#FFB347');
        return false;
    }
    // 车停在原位（不再搜索挪位；车/残骸 tile 不受城市规划还原，路面也能正常停）
    setTile(sv, gx, gy, T.CAR);
    const m = sv.mods.tiles[gx + ',' + gy] = sv.mods.tiles[gx + ',' + gy] || { t: T.CAR };
    m.t = T.CAR; m.repaired = true; m.hp = d.hp;
    // 停车保留下车时的朝向（车可自由摆放、车头任意朝向；BFS 按实际朝向推算
    // 第二格占位，斜向停放的车也能正确绕行）
    m.dir = d.dir;
    m.fuel = d.fuel;
    m.owner = d.owner || m.owner;   // 归属标记随车保留（原位停车不丢）
    // 后备箱键迁移（旧 key → 新 key）
    if (d.key !== gx + ',' + gy && sv.mods.chests && sv.mods.chests['car:' + d.key]) {
        sv.mods.chests['car:' + gx + ',' + gy] = sv.mods.chests['car:' + d.key];
        delete sv.mods.chests['car:' + d.key];
    }
    // 主控从车门下车（门点已验证可站，无需再兜底找格）
    sv.px = door.x;
    sv.py = door.y;
    // 乘客下车：放出到车旁可站处（NPC 驾驶订单与玩家停车统一处理）
    // 落点 = 以已验证可站的车门为中心环绕散开，每个候选点 canStand 二次验证；
    // 环上全部不可站（水/墙/建筑）时退回车门格（已验可站）——绝不落到未验证格卡死
    if (sv.npcs) {
        let k = 0;
        for (const n of sv.npcs) {
            if (!n.alive || !n.riding) continue;
            n.riding = false;
            let px = door.x, py = door.y;
            for (let ring = 1; ring <= 3 && (px === door.x && py === door.y); ring++) {
                for (let s = 0; s < 6; s++) {
                    const ang = (k * 0.9 + s * 1.05) + ring * 0.5;
                    const cx = door.x + Math.cos(ang) * ring * TS * 0.8;
                    const cy = door.y + Math.sin(ang) * ring * TS * 0.8;
                    if (canStand(cx, cy)) { px = cx; py = cy; break; }
                }
            }
            n.x = px; n.y = py;
            k++;
        }
    }
    sv._chauffeured = false;
    sv.driving = null;
    log(sv, '已下车');
    return true;
}

// 驾驶公共逻辑（玩家驾驶与 NPC 驾驶共用）：油耗、滑行减速、碾压僵尸、耐久归零报废
function driveCommon(sv, dt) {
    const d = sv.driving;
    if (!d) return;
    if (d.speed > 0) {
        // 没油：发动机熄火，只能滑行减速
        if (d.fuel > 0) {
            d.fuel = Math.max(0, d.fuel - B.FUEL_USE_RATE * dt);
            if (d.fuel <= 0) log(sv, '车辆没油了！搜刮汽油后回到车旁加油', '#FFB347');
        } else {
            d.speed *= Math.max(0, 1 - 3 * dt);
        }
    } else if (d.speed < 0) {
        // 倒车滑行减速（往 0 回，约 1.7 秒停稳，松开 S 不会长时间溜车）
        d.speed = Math.min(0, d.speed + 90 * dt);
    } else {
        d.speed = 0;
    }
    // 碾压僵尸
    for (const z of sv.zombies) {
        if (z.hp <= 0) continue;
        z._crushCd = (z._crushCd || 0) - dt;
        // 碾压冷却（L1）：防数秒秒杀高血僵尸（无冷却时 60 伤/帧 ≈ 每秒 3600 伤）
        if (Math.hypot(z.x - d.x, z.y - d.y) < TS * 1.1 && z._crushCd <= 0) {
            z._crushCd = 0.5;   // 每秒最多 2 次碾压
            z.hp -= CAR_CRUSH_DMG;
            z.hurt = 0.2;
            const a = Math.atan2(z.y - d.y, z.x - d.x);
            z.x += Math.cos(a) * 10; z.y += Math.sin(a) * 10;
            sv.effects.push({ kind: 'hit', x: z.x, y: z.y, life: 0.2, maxLife: 0.2 });
        }
    }
    // 耐久归零 → 变残骸，弹出车内人员（残骸停到可停格，不覆盖破坏地形）
    if (d.hp <= 0) {
        const gx = Math.floor(d.x / TS), gy = Math.floor(d.y / TS);
        const sp = findCarParkSpot(sv, gx, gy, carDirAt);   // L12：注入朝向，验证残骸第二格可走
        setTile(sv, sp.x, sp.y, T.CARWRECK);
        sv.mods.tiles[sp.x + ',' + sp.y] = { t: T.CARWRECK, wreck: true, hp: 0 };
        // 人员弹出到残骸旁可站格
        const px = (sp.x + 0.5) * TS, py = (sp.y + 1.5) * TS;
        sv.px = isWalk(getTile(sv, sp.x, sp.y + 1)) ? px : (sp.x + 0.5) * TS;
        sv.py = isWalk(getTile(sv, sp.x, sp.y + 1)) ? py : (sp.y - 0.5) * TS;
        if (sv.npcs) for (const n of sv.npcs) {
            if (!n.alive || !n.riding) continue;
            n.riding = false;
            n.x = sv.px + (Math.random() - 0.5) * TS * 2;
            n.y = sv.py + (Math.random() - 0.5) * TS * 2;
        }
        sv._chauffeured = false;
        sv.driveOrder = null;
        sv.driving = null;
        sv.hurtT = 0.4; sv.hp -= 10;
        log(sv, '汽车报废了！', '#FF5544');
        AudioSystem.playZombieDie && AudioSystem.playZombieDie();
    }
}

// 玩家驾驶每帧：W 油门加速 / A D 只转向（不改变速度）/ S 刹车（速度归零后继续按 S 倒车），
// 松手自动减速滑行；碾压僵尸，撞障碍掉耐久
export function updateDrive(sv, dt, keys, canStandCar) {
    const d = sv.driving;
    if (!d) return;
    const throttle = keys['w'] || keys['arrowup'];
    const brake = keys['s'] || keys['arrowdown'];
    const steerL = keys['a'] || keys['arrowleft'];
    const steerR = keys['d'] || keys['arrowright'];
    const steer = (steerR ? 1 : 0) + (steerL ? -1 : 0);
    if (throttle) {
        // W：油门，速度逐渐加速（约 1 秒到满速），不会瞬间冲出去
        if (d.fuel > 0) {
            if (d.speed < 0) {
                // 倒车中按 W：先快速刹停倒车（600/s），接近 0 后立即转为正向加速，不"失灵"
                d.speed = Math.min(0, d.speed + 600 * dt);
                if (d.speed > -5) d.speed = 0;
            }
            if (d.speed >= 0) d.speed = Math.min(CAR_DRIVE_SPEED, d.speed + 280 * dt);
        } else {
            d.speed *= Math.max(0, 1 - 3 * dt);   // 没油只能滑行
        }
    } else if (brake) {
        if (d.speed > 5) {
            // S：刹车，把剩余速度减掉
            d.speed = Math.max(0, d.speed - 340 * dt);
        } else if (d.fuel > 0) {
            // 速度归零后继续按 S：倒车才生效（限速 = 前进的 0.6，不慢）
            d.speed = Math.max(-CAR_DRIVE_SPEED * 0.6, d.speed - 400 * dt);
        }
    } else {
        // 松手：自动减速（滑行）
        d.speed *= Math.max(0, 1 - 3 * dt);
    }
    // 转向（A/D）：只改变车头方向，不改变速度（行驶中/原地/倒车都可用）
    if (steer !== 0) d.dir += steer * CAR_TURN * dt;
    // 移动
    const vx = Math.cos(d.dir) * d.speed, vy = Math.sin(d.dir) * d.speed;
    const nx = d.x + vx * dt, ny = d.y + vy * dt;
    // 碰撞：车体通过才移动，否则撞击掉耐久（按车体实际朝向检查；倒车撞障碍同样处理）
    if (canStandCar(nx, d.y, d.dir)) d.x = nx; else if (Math.abs(d.speed) > 40) crash(sv, d);
    if (canStandCar(d.x, ny, d.dir)) d.y = ny; else if (Math.abs(d.speed) > 40) crash(sv, d);

    // 玩家跟随车
    sv.px = d.x; sv.py = d.y;
    sv.faceX = Math.cos(d.dir); sv.faceY = Math.sin(d.dir);

    driveCommon(sv, dt);
}

// ---------- NPC 驾驶（命令：载全员前往目的地） ----------
// 汽车 BFS 寻路（公路优先）：从车中心格扩展，公路/人行道格优先入队（近似 0-1 BFS，
// 路径尽量沿路走）；只走十字方向（车体 2 格宽，对角斜插易撞路边导致一卡一卡）。
// 一次性算出完整格子路径，车沿 waypoint 逐格走（只在起始/走完/被挡时重建，避免周期性卡顿）。
// 路障/残骸可撞开（视为可走，压上去后清障）。
// 性能：一次 build 内所有查询走局部缓存（tile / 车体朝向 / 第二格 / 体格检查四层），
// 并按"起点↔终点包围盒"剪枝——远离直线走廊的死角不再扩展，重建耗时降一个数量级，
// 被挡重规划时不再整帧卡顿。
const CAR_PATH_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// 车体覆盖格检查（半格单位，dirIdx 0东/1西/2南/3北）：与 carCanStand 矩形覆盖一致——
// 检查车体格（长轴 2 格 × 短轴 1 格）+ 短轴两侧各 1 格（转弯旋转/漂移容差）。
// 注意不含长轴两端外扩：3×3 全检查会把城区路两侧行道树算进净空，导致大量
// 可走道路被拒（到达率骤降）；转弯旋转扫到长轴端对角时由驾驶恢复逻辑兜底。
// BFS 内循环只查表，不再逐格算三角函数
// 车体格查表（半格单位，dirIdx 0东/1西/2南/3北）：2×2 格，与实际驾驶 canStandCar 的车体
// 4 角一致（长轴 ±1 格、短轴 ±0.5 格）。此前 2×3 格（6 角点）比实际驾驶严格——废墟残路
// 带（4 格宽）里车体格 3 行贴边判不可走 → BFS expanded 极小 → 手动能开的路导航判不可达
// （"送废墟"根因）。转弯扫对角由 turnOk 3×3 净空单独把关。
const CAR_CORNERS = [
    [[0, 0], [2, 0], [0, 2], [2, 2]],   // 东/西（水平）：车体格格 gx,gx+1 × gy,gy+1
    [[0, 0], [2, 0], [0, 2], [2, 2]],
    [[0, 0], [0, 2], [2, 0], [2, 2]],   // 南/北（垂直）：车体格格 gx,gx+1 × gy,gy+1
    [[0, 0], [0, 2], [2, 0], [2, 2]],
];
function carDirIdx(dx, dy) {
    if (dx > 0) return 0;
    if (dx < 0) return 1;
    if (dy > 0) return 2;
    return 3;
}
// 车体朝向（与渲染/碰撞一致：持久化 dir 优先 + 种子朝向 + 邻车退避），tileAt 为局部缓存查询
function carBodyDirCached(sv, gx, gy, tileAt, dirCache) {
    const k = gy * 100000 + gx;
    const hit = dirCache && dirCache.get(k);
    if (hit !== undefined) return hit;
    let dir = null;
    const m2 = sv.mods.tiles[gx + ',' + gy];
    if (m2 && m2.dir != null) dir = m2.dir;
    if (dir == null) {
        dir = carDirAt(sv.world.seed, gx, gy);
        if (Math.abs(Math.sin(dir)) > 0.92) {
            for (const [ox, oy] of [[0, -1], [1, -1], [1, 0], [0, 1], [1, 1]]) {
                const nt = tileAt(gx + ox, gy + oy);
                if (nt === T.CAR || nt === T.CARWRECK) { dir = 0; break; }
            }
        }
    }
    if (dirCache) dirCache.set(k, dir);
    return dir;
}
// 检查 (ax,ay) 是否为"车锚点沿朝向延伸的第二格"（与 carBodyAt 一致；CACHE 缓存键 gy*1e5+gx）
function carSecondCell(sv, ax, ay, tileAt, dirCache, secondCache) {
    const k = ay * 100000 + ax;
    const hit = secondCache && secondCache.get(k);
    if (hit !== undefined) return hit;
    let isSecond = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = tileAt(ax + dx, ay + dy);
        if (nt !== T.CAR && nt !== T.CARWRECK) continue;
        const ad = carBodyDirCached(sv, ax + dx, ay + dy, tileAt, dirCache);
        const fx = Math.round(Math.cos(ad)), fy = Math.round(Math.sin(ad));
        if (ax + dx + fx === ax && ay + dy + fy === ay) { isSecond = true; break; }
    }
    if (secondCache) secondCache.set(k, isSecond);
    return isSecond;
}
// 车体格检查（BFS 用）：所有障碍（墙/树/水/瓦砾/路障/残骸/停放车辆/门）一律绕行；
// 绕不过时由行驶中的 crushBarrierAhead 撞开兜底，保证不卡住。
// 废墟路面碎石（叠在保留路带/主干道上的碎石坑）视为可压过——下层仍是路面，
// 否则 NPC 在废墟内寻路会把碎石当死墙，绕不到目的地/起步即卡死。
// cellOkCache：同一格（含方向）只完整检查一次，其余命中缓存；dirIdx 为整数方向查表
function carCellOk(sv, gx, gy, dirIdx, tileAt, dirCache, secondCache, cellOkCache) {
    const ck = (gy * 100000 + gx) * 4 + dirIdx;
    const hit = cellOkCache && cellOkCache.get(ck);
    if (hit !== undefined) return hit;
    const corners = CAR_CORNERS[dirIdx];
    let ok = true;
    for (let i = 0; i < corners.length && ok; i++) {
        const ax = Math.floor((gx * 2 + corners[i][0]) / 2);
        const ay = Math.floor((gy * 2 + corners[i][1]) / 2);
        const t = tileAt(ax, ay);
        // 所有障碍一律绕行
        if (t === T.WALL || t === T.TREE || t === T.WATER ||
            t === T.DOOR || t === T.CAR || t === T.CARWRECK || t === T.BARRICADE) { ok = false; break; }
        // 废墟碎石：仅"残路带上的碎石"（ruins 区 rx<4||ry<4 的破损路面）可压过，
        // 建筑废墟的碎石堆（rx>=4 且 ry>=4）仍是障碍——车穿石/绕石行为才能一致
        if (t === T.RUBBLE) {
            if (!ruinsRoadBandAt(sv.world.seed, ax, ay)) { ok = false; break; }
        }
        // 障碍物的延伸格（完好车/残骸沿朝向的第二格）也绕行
        if (carSecondCell(sv, ax, ay, tileAt, dirCache, secondCache)) { ok = false; break; }
    }
    if (cellOkCache) cellOkCache.set(ck, ok);
    return ok;
}
// 分帧 BFS 预算（卡顿排查 P0-4 / 坐车卡顿第二主源）：chauffeurBuildPath 同步展开最多
// 6 万格（30-60ms 单帧尖峰）在 updateChauffeurDrive 帧内执行。改为按「每帧扩展格数」
// 跨帧推进（确定性：与 CPU 速度无关，慢机器/测试环境帧数一致）：d._bfs 持有中间状态，
// 每帧跑一小块，全部完成才产出 route。首建（车在等待）预算放宽。
// 代价估算：每格 ~0.8µs（带缓存），6000 格 ≈ 5ms/帧；最坏 6 万格 ≈ 10 帧 ≈ 0.17s。
const CHAUFFEUR_BFS_FIRST_CELLS = 6000;    // 首建/换目标：车等待中，可多跑（典型路径 1~3 帧完成）
const CHAUFFEUR_BFS_REBUILD_CELLS = 3000;  // 被挡重建：旧路径继续行驶，重建不阻塞行车
function chauffeurBfsInit(sv, d, gx, gy) {
    const sx = Math.floor(d.x / TS), sy = Math.floor(d.y / TS);
    const MARGIN = 36 + Math.min(144, (d._marginN || 0) * 18);
    const minX = Math.min(sx, gx) - MARGIN, maxX = Math.max(sx, gx) + MARGIN;
    const minY = Math.min(sy, gy) - MARGIN, maxY = Math.max(sy, gy) + MARGIN;
    const boxCap = (maxX - minX + 1) * (maxY - minY + 1);
    const EXPAND_CAP = Math.min(60000, Math.max(30000, boxCap));
    const seen = new Map();
    // 局部 tile 缓存：一次 build 内同一格只查一次 getTile（BFS 大量重复查询是卡顿主因）
    const tileCache = new Map();
    const tileAt = (x, y) => {
        const k = y * 100000 + x;
        let v = tileCache.get(k);
        if (v === undefined) { v = getTile(sv, x, y); tileCache.set(k, v); }
        return v;
    };
    const dirCache = new Map();       // 车体朝向缓存
    const secondCache = new Map();    // 车/残骸第二格缓存
    const cellOkCache = new Map();    // 体格检查缓存（按格+方向）
    const qRoad = [], qOther = [];   // 公路格优先扩展，无路可走才走野地
    const push = (x, y, px, py) => {
        const k = y * 100000 + x;
        if (seen.has(k)) return;
        seen.set(k, [px, py]);
        (tileAt(x, y) === T.ROAD ? qRoad : qOther).push([x, y]);
    };
    push(sx, sy, -1, -1);
    return {
        sx, sy, gx, gy, minX, maxX, minY, maxY, EXPAND_CAP,
        seen, tileAt, dirCache, secondCache, cellOkCache, qRoad, qOther,
        push, qiR: 0, qiO: 0, found: null, best: null, bestD: Infinity,
        expanded: 0, done: false, result: null,
    };
}
// 推进一帧（每帧最多扩展 maxCells 格；完成返回 true，state.result 已生成）
function chauffeurBfsStep(sv, state, maxCells) {
    let processed = 0;
    while (state.expanded < state.EXPAND_CAP && processed < maxCells) {
        let cur = null;
        if (state.qiR < state.qRoad.length) cur = state.qRoad[state.qiR++];
        else if (state.qiO < state.qOther.length) cur = state.qOther[state.qiO++];
        else { state.done = true; break; }   // 队列空：包围盒内全部探索完
        state.expanded++;
        const cx = cur[0], cy = cur[1];
        if (cx === state.gx && cy === state.gy) { state.found = [cx, cy]; state.done = true; break; }
        const bdx = cx - state.gx, bdy = cy - state.gy;
        const bd = bdx * bdx + bdy * bdy;   // 平方距离即可比较，省掉每格一次开方
        if (bd < state.bestD) { state.bestD = bd; state.best = [cx, cy]; }
        for (const [dx, dy] of CAR_PATH_DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < state.minX || nx > state.maxX || ny < state.minY || ny > state.maxY) continue;
            // 车体长轴沿移动方向检查（南北行驶的车身沿 Y 轴，不再误判东西侧）
            if (!carCellOk(sv, nx, ny, carDirIdx(dx, dy), state.tileAt, state.dirCache, state.secondCache, state.cellOkCache)) continue;
            state.push(nx, ny, cx, cy);
        }
        processed++;
    }
    state.done = true;
    if (!state.result) state.result = chauffeurBacktrack(state);
    return true;
}
// BFS 完成：从终点（目标格或最近可行格）反查完整路径 + 压缩共线
function chauffeurBacktrack(state) {
    const path = [];
    let cur = state.found || state.best;
    while (cur) {
        const prev = state.seen.get(cur[1] * 100000 + cur[0]);
        if (!prev || (prev[0] === -1 && prev[1] === -1)) break;   // 到达起点（哨兵精确匹配 [-1,-1]）
        path.push({ x: cur[0], y: cur[1] });
        cur = prev;
    }
    path.reverse();
    // 压缩共线格：直行段只保留两端格，车沿直线段行驶
    const flat = [];
    for (const p of path) {
        const last = flat[flat.length - 1];
        const prev = flat[flat.length - 2];
        if (last && prev && (last.x - prev.x === p.x - last.x) && (last.y - prev.y === p.y - last.y)) {
            flat[flat.length - 1] = p;   // 共线：端点推进到当前格
        } else {
            flat.push(p);
        }
    }
    return { path: flat, goal: !!state.found, bestX: state.best ? state.best[0] : null, bestY: state.best ? state.best[1] : null, expanded: state.seen.size };
}
function chauffeurBuildPath(sv, d, gx, gy) {
    const state = chauffeurBfsInit(sv, d, gx, gy);
    while (!chauffeurBfsStep(sv, state, Infinity)) { /* 预算无穷：一次跑完（同步调用/测试） */ }
    return state.result;
}

// 测试出口：裸跑路径规划（不依赖 driving 状态），供 dev-tools 寻路回归测试使用
export function buildChauffeurPath(sv, x, y, tgx, tgy, stallN) {
    const d = { x, y, _stallN: stallN || 0 };
    return chauffeurBuildPath(sv, d, tgx, tgy);
}

// 停放车辆/残骸占位（锚点格 + 沿停放朝向的第二格）——前瞻探测用，与 BFS carSecondCell 同逻辑
function carBodyOccupied(sv, gx, gy) {
    const t0 = getTile(sv, gx, gy);
    if (t0 === T.CAR || t0 === T.CARWRECK) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = getTile(sv, gx + dx, gy + dy);
        if (nt !== T.CAR && nt !== T.CARWRECK) continue;
        const ad = carBodyDirCached(sv, gx + dx, gy + dy, (x, y) => getTile(sv, x, y), null);
        const fx = Math.round(Math.cos(ad)), fy = Math.round(Math.sin(ad));
        if (gx + dx + fx === gx && gy + dy + fy === gy) return true;
    }
    return false;
}

// 撞开正前方的路障/推开残骸（NPC 驾驶专用）：只处理车头朝向 1.1 格内的障碍，侧边/后边的不碰
function crushBarrierAhead(sv, d) {
    let crushed = false;
    const a = d.dir, c = Math.cos(a), s = Math.sin(a);
    for (const side of [-1, 1]) {
        // 车头前方 1.1 格、宽 ±0.45 格的两个角
        const px = d.x + c * TS * 1.1 + (-s) * TS * 0.45 * side;
        const py = d.y + s * TS * 1.1 + c * TS * 0.45 * side;
        const gx = Math.floor(px / TS), gy = Math.floor(py / TS);
        const t = getTile(sv, gx, gy);
        if (t === T.BARRICADE) {
            setTile(sv, gx, gy, groundUnderCar(sv, gx, gy));
            sv.effects.push({ kind: 'hit', x: px, y: py, life: 0.3, maxLife: 0.3 });
            crushed = true;
        } else if (t === T.CARWRECK) {
            // 残骸推到旁边可放格
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = gx + dx, ny = gy + dy;
                if (isWalk(getTile(sv, nx, ny)) && getTile(sv, nx, ny) !== T.CAR &&
                    getTile(sv, nx, ny) !== T.CARWRECK && getTile(sv, nx, ny) !== T.BARRICADE) {
                    const old = sv.mods.tiles[gx + ',' + gy];
                    if (old) { sv.mods.tiles[nx + ',' + ny] = old; delete sv.mods.tiles[gx + ',' + gy]; }
                    setTile(sv, nx, ny, T.CARWRECK);
                    setTile(sv, gx, gy, groundUnderCar(sv, gx, gy));
                    crushed = true;
                    break;
                }
            }
        }
    }
    if (crushed) {
        d.hp = Math.max(1, d.hp - 8);
        AudioSystem.playHit && AudioSystem.playHit();
        log(sv, '撞开了路上的障碍物', '#FFB347');
    }
    return crushed;
}

export function updateChauffeurDrive(sv, dt, canStandCar) {
    const d = sv.driving;
    if (!d || !sv.driveOrder) return;
    const o = sv.driveOrder;
    const tx = o.tx, ty = o.ty;
    const tgx = Math.floor(tx / TS), tgy = Math.floor(ty / TS);
    // 真正到达：营地必须精确到旗子（TS*1.5）；区域/自由探索的目标点已吸附到可步行格，
    // 贴近 2 格内即视为到达——此前放宽到 12 格，车常停在野地就报"已抵达"，被误认为没到目的地
    const arriveD = o.dest === 'camp' ? TS * 1.5 : TS * 2;
    if (Math.hypot(tx - d.x, ty - d.y) < arriveD) { finishDriveOrder(sv, true); return; }
    // 全局无进展保护（兜底）：无论卡在哪个状态（倒车/原地旋转/被挡/异常挂机），
    // 120 秒内到目标距离无 0.5 格改善就强制优雅停车——绝不无限挂机。
    // 放在所有早退分支之前，倒车等分支早退时检测仍每帧运行
    {
        const dNow = Math.hypot(tx - d.x, ty - d.y);
        if (dNow < (d._gmin != null ? d._gmin : Infinity) - TS * 0.5) {
            d._gmin = dNow;
            d._gstall = 0;
        } else {
            d._gstall = (d._gstall || 0) + dt;
            if (d._gstall > 120) {
                d._gstall = 0;
                d._gmin = null;
                log(sv, '长时间无法抵达目的地，车队停在当前位置', '#FFB347');
                finishDriveOrder(sv, false);
                return;
            }
        }
    }
    // 没油抛锚：油尽立即结束订单（车自然滑行停稳，原地停车；搜刮汽油后回来加油；
    // 不会油尽还龟速爬向目的地，也不会被"绕不过去"保险抢先报错）
    if (d.fuel <= 0 && !(d._reversing > 0)) {
        log(sv, '车辆没油抛锚：车队停车，搜刮汽油后回到车旁加油', '#FFB347');
        finishDriveOrder(sv, false);
        return;
    }
    // 倒车脱离中（被硬障碍卡死触发）：先把车头摆回最近主轴方向（多数卡死发生在
    // 转弯半途的斜向车身——斜向倒车会一直蹭墙角倒不出来），再沿主轴倒车，
    // 倒完重建路径（怪物式重新寻路）
    if (d._reversing > 0) {
        d._reversing -= dt;
        if (d._reversing < 0) d._reversing = 0;   // 浮点清零：避免负残差导致后续无法再次触发
        const axis = Math.round(d.dir / (Math.PI / 2)) * (Math.PI / 2);
        let rot = axis - d.dir;
        while (rot > Math.PI) rot -= Math.PI * 2;
        while (rot < -Math.PI) rot += Math.PI * 2;
        if (Math.abs(rot) > 0.08) {
            // 原地转正：车头贴回主轴再动，避免斜向车身在窄道里越卡越死。
            // 45° 浮点边界处 axis=round(dir/90°)*90° 会在相邻轴间跳变，rot 永不收敛
            // → 车永远原地旋转（speed=0、不耗油、不触发恢复）挂机到油尽——
            // 旋转超 0.3s 仍未对齐则强制 snap 到当前轴
            d.dir += rot * Math.min(1, CAR_TURN * 4 * dt);
            d.speed = 0;
            d._rotT = (d._rotT || 0) + dt;
            if (d._rotT > 0.3) { d.dir = axis; d._rotT = 0; }
        } else {
            d._rotT = 0;
            d.dir = axis;
            d.speed = -CAR_DRIVE_SPEED * 0.5;
            const rx = d.x + Math.cos(d.dir) * d.speed * dt;
            const ry = d.y + Math.sin(d.dir) * d.speed * dt;
            let moved = false;
            if (canStandCar(rx, d.y, d.dir)) { d.x = rx; moved = true; }
            if (canStandCar(d.x, ry, d.dir)) { d.y = ry; moved = true; }
            if (!moved) {
                // 正后方被挡：沿垂直主轴的左右侧平移试探。平移后的位置必须用"当前车头
                // 朝向"验证——此前用垂直朝向验证、移动后再转回车头，车体会与障碍重叠
                // （压进停放车辆/墙角的死位），导致后续彻底卡死
                for (const side of [-1, 1]) {
                    const px = d.x + Math.cos(axis + side * (Math.PI / 2)) * d.speed * dt;
                    const py = d.y + Math.sin(axis + side * (Math.PI / 2)) * d.speed * dt;
                    if (canStandCar(px, py, d.dir)) { d.x = px; d.y = py; moved = true; break; }
                }
            }
        }
        if (d._reversing <= 0) {
            d._route = null;   // 重新寻路
            d._probeT = 0;
            d._stuckT = 0;
            log(sv, '前方被障碍挡住，倒车后重新规划路线', '#FFD700');
        }
        sv.px = d.x; sv.py = d.y;
        sv.faceX = Math.cos(d.dir); sv.faceY = Math.sin(d.dir);
        driveCommon(sv, dt);
        if (!sv.driving) { sv.driveOrder = null; sv._chauffeured = false; }
        return;
    }
    // 整条路径缓存：只在首次、换目标、走完、被挡 1s 时重建。重建用分帧 BFS
    // （CHAUFFEUR_BFS_BUDGET_* 时间预算跨帧推进）——全量同步 BFS（最多 6 万格）整帧卡顿，
    // 是"坐车卡顿"第二主源。被挡重建期间保留旧路径继续行驶，不中断行车。
    let route = d._route;
    const needBuild = !route || route.key !== tgx + ',' + tgy ||
        (route._stale && sv.now - route.t > 2.0) ||   // 被挡后 2 秒才重规划（1s→2s：减少重建频率）
        (route.path.length === 0 && sv.now - route.t > 1.5);   // 空路径定期重建（不可达/起点即最近）
    if (needBuild) {
        // 目标变更：丢弃进行中的旧 BFS（状态里 gx/gy 与当前目标不一致）
        if (d._bfs && (d._bfs.gx !== tgx || d._bfs.gy !== tgy)) d._bfs = null;
        if (!d._bfs) d._bfs = chauffeurBfsInit(sv, d, tgx, tgy);
        const cells = route ? CHAUFFEUR_BFS_REBUILD_CELLS : CHAUFFEUR_BFS_FIRST_CELLS;
        if (chauffeurBfsStep(sv, d._bfs, cells)) {
            // BFS 完成：正式落 route + best 停滞检测（必须跨重建记录：倒车脱离会置
            // _route=null，旧 route 引用丢失，若从旧 route 取 bdOld 会被当成 Infinity →
            // stallN 每次清零 → 防死循环保险永不触发。故 bdOld 从 d._prevBestDist 取）
            const res = d._bfs.result;
            d._bfs = null;
            const bdOld = (d._prevBestDist != null ? d._prevBestDist : Infinity);
            route = d._route = { key: tgx + ',' + tgy, ...res, _blockedT: 0, t: sv.now };
            d._homing = true;   // 重建后先把车拉回格心再沿路径走（见下方行驶目标选择）
            // 注意：重建不算进展，不清零 _noWpT——"path 为空定期重建"与"25s 无路点检测"
            // 若互相清零，车会在死角反复重建到油尽；只有真正消耗路点才算有进展
            // margin 等级单调递增（best 改善会清零 stallN，但 margin 不回落，
            // 废墟大弯绕行需要逐级放大搜索盒）
            d._marginN = Math.max(d._marginN || 0, d._stallN || 0);
            // best 停滞检测：最近可行格到目标的距离连续无改善 → 车已到最接近点
            if (!route.goal) {
                const bdNew = route.bestX != null ? Math.hypot(route.bestX - tgx, route.bestY - tgy) : Infinity;
                if (bdNew >= bdOld - 0.6) d._stallN = (d._stallN || 0) + 1;
                else d._stallN = 0;
                d._prevBestDist = bdNew;
            } else {
                d._stallN = 0;
                d._prevBestDist = 0;
            }
        } else if (!route) {
            // BFS 分帧推进中且无旧路径（首建/换目标）：本帧停车等待（典型 1~3 帧 ≈ 0.05s）
            sv.px = d.x; sv.py = d.y;
            sv.faceX = Math.cos(d.dir); sv.faceY = Math.sin(d.dir);
            driveCommon(sv, dt);
            if (!sv.driving) { sv.driveOrder = null; sv._chauffeured = false; }
            return;
        }
        // BFS 未完成但有旧路径：继续沿旧路径行驶（下方正常走），下一帧继续推进 BFS
        route = d._route;
    }
    // 目标不可达且最近点连续多次 build 无改善 → 已到最接近处才停车。
    // 注意：margin 单调递增（36→180），build 时用"上一轮"的 margin 等级，
    // 必须等 margin 180 也试过（stallN 累计 9 次）才允许停车，
    // 否则废墟大弯（100+ 格绕行）还没展开就放弃了
    if (!route.goal && d._stallN >= 9) {
        d._stallN = 0;
        const bd = route.bestX != null ? Math.hypot(route.bestX - tgx, route.bestY - tgy) : 0;
        if (bd <= 6) log(sv, '已抵达目的地附近（目标点被障碍挡住，车队停在最近可停处）', '#7DFF7D');
        else log(sv, `目标点无法直接到达（距目标约 ${Math.ceil(bd)} 格被挡），车队停在最近可停处`, '#FFB347');
        finishDriveOrder(sv, true);
        return;
    }
    // 物理性卡死检测：BFS 判定可达（goal=true，stallN 保险不触发）但车被地形/停放车辆
    // 物理卡住时，会反复倒车-重建直到油尽。25 秒没贴近任何一个路点（原地折腾）
    // → 判定开不过去，停在最近可停处（绕行会不断消耗路点，不会误判）
    d._noWpT = (d._noWpT || 0) + dt;
    if (d._noWpT > 25) {
        d._noWpT = 0;
        log(sv, '目标点被障碍挡住无法通过，车队停在最近可停处', '#FFB347');
        finishDriveOrder(sv, false);
        return;
    }
    // 沿路径逐格走：目标 = 下一格中心；贴近（0.2 格）后立即循环切到下一格（本帧生效）。
    // 转弯格特殊处理：车头未转到 wp2 方向时不消耗 wp——车在转弯格中心完成旋转
    // （移动目标保持 wp 格心、车头目标为 wp2 方向，见下方 targetDir 覆盖；中心贴近
    // 格心旋转，斜向车身不脱离转弯格 3×3 净空）；转好后切到 wp2 才正式驶出。
    // path 为空时朝最近可行格（best）走，绝不朝目标直线穿障碍
    let mvx = tx - d.x, mvy = ty - d.y;
    let wp = route.path[0];
    while (wp && Math.hypot((wp.x + 0.5) * TS - d.x, (wp.y + 0.5) * TS - d.y) < TS * 0.2) {
        const wp2 = route.path[1];
        if (wp2 && (wp2.x !== wp.x || wp2.y !== wp.y)) {
            const turnDir = Math.atan2(wp2.y - wp.y, wp2.x - wp.x);
            let dTurn = turnDir - d.dir;
            while (dTurn > Math.PI) dTurn -= Math.PI * 2;
            while (dTurn < -Math.PI) dTurn += Math.PI * 2;
            if (Math.abs(dTurn) > 0.6) break;   // 车头没转好：留在 wp 格心附近原地旋转
        }
        route.path.shift();
        d._noWpT = 0;   // 贴近并消耗路点 = 有进展
        wp = route.path[0];
    }
    if (wp) {
        mvx = (wp.x + 0.5) * TS - d.x;
        mvy = (wp.y + 0.5) * TS - d.y;
    } else if (route.bestX != null) {
        mvx = (route.bestX + 0.5) * TS - d.x;
        mvy = (route.bestY + 0.5) * TS - d.y;
    }
    // 转弯格原地旋转：车已贴近转弯格但车头未转到 wp2 方向——
    // 移动目标保持 wp 格心（中心停在转弯格中心，旋转期间不斜向驶出 3×3 净空），
    // 车头目标改为 wp2 方向；转好后下一帧消耗循环放行
    let turnDirOverride = null;
    if (wp && route.path[1] && (route.path[1].x !== wp.x || route.path[1].y !== wp.y)) {
        const wp2 = route.path[1];
        const wpDist = Math.hypot((wp.x + 0.5) * TS - d.x, (wp.y + 0.5) * TS - d.y);
        if (wpDist < TS * 0.4) {
            const turnDir = Math.atan2(wp2.y - wp.y, wp2.x - wp.x);
            let dTurn = turnDir - d.dir;
            while (dTurn > Math.PI) dTurn -= Math.PI * 2;
            while (dTurn < -Math.PI) dTurn += Math.PI * 2;
            if (Math.abs(dTurn) > 0.4) {
                turnDirOverride = turnDir;
                mvx = (wp.x + 0.5) * TS - d.x;
                mvy = (wp.y + 0.5) * TS - d.y;
            }
        }
    }
    // 起点归位：倒车/侧移/跳变后车会偏离格心（可达 0.5+ 格），从偏离位置斜向驶向
    // 路点，车体角点会扫出 BFS 验证的 3×3 之外撞上障碍。重建后先沿路径把车拉回
    // 格心（贴近 0.25 格即视为归位），再正式沿路点走
    if (d._homing && route.path.length > 0) {
        const hx = (Math.floor(d.x / TS) + 0.5) * TS;
        const hy = (Math.floor(d.y / TS) + 0.5) * TS;
        if (Math.hypot(hx - d.x, hy - d.y) > TS * 0.25) {
            mvx = hx - d.x;
            mvy = hy - d.y;
        } else {
            d._homing = false;
        }
    }
    const mdist = Math.hypot(mvx, mvy) || 1;
    // 朝向寻路下一步转向 + 匀速前进（转弯格原地旋转时车头目标为 wp2 方向）
    const targetDir = turnDirOverride != null ? turnDirOverride : Math.atan2(mvy, mvx);
    let diff = targetDir - d.dir;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    d.dir += diff * Math.min(1, CAR_TURN * 1.2 * dt);
    if (d.fuel > 0) {
        d.speed = Math.min(CAR_DRIVE_SPEED * 0.7, d.speed + 220 * dt);
        // 仅弯道降速：车头与目标方向夹角大时压速过弯（出弯自然恢复）；直行匀速不抽搐
        const slowNeed = Math.min(1, Math.abs(diff) / 0.9);
        if (slowNeed > 0) d.speed = Math.min(d.speed, 45 + (1 - slowNeed) * (CAR_DRIVE_SPEED * 0.7 - 45));
    } else {
        // 没油：发动机熄火，只滑行不再自行加速（否则加速与衰减平衡后油尽车仍龟速爬行）
        d.speed *= Math.max(0, 1 - 3 * dt);
    }
    const vx = mvx / mdist * d.speed, vy = mvy / mdist * d.speed;
    const nx = d.x + vx * dt, ny = d.y + vy * dt;
    let blocked = 0;
    if (canStandCar(nx, d.y, d.dir)) d.x = nx; else blocked++;
    if (canStandCar(d.x, ny, d.dir)) d.y = ny; else blocked++;
    if (blocked > 0) {
        // 先尝试撞开覆盖车体的路障/残骸；撞开后可继续按路径走
        if (crushBarrierAhead(sv, d)) {
            blocked = 0;
            d._probeT = 0;
            d._stuckT = 0;
        } else {
            d.speed = Math.max(30, d.speed * 0.55);
            // 转弯半途被挡（车头与上一帧朝向夹角大）：先把车头退回上一帧朝向。
            // 旋转本身不查碰撞，斜向车身会被推进墙角死位（前后角分别撞上障碍的两格），
            // 从这种位置斜向探测/倒车都出不来——回正后再沿主轴处理。
            // 回正期间同样累计 stuckT：否则"朝路点转→动一帧→被挡→回正"振荡，
            // 永远不触发倒车/重规划，车原地挂机
            const lastDir = d._lastDir != null ? d._lastDir : d.dir;
            let backRot = lastDir - d.dir;
            while (backRot > Math.PI) backRot -= Math.PI * 2;
            while (backRot < -Math.PI) backRot += Math.PI * 2;
            d._stuckT = (d._stuckT || 0) + dt;
            if (Math.abs(backRot) > 0.12) {
                d.dir += backRot * Math.min(1, CAR_TURN * 3 * dt);
                d.speed = 0;
            } else {
                route._blockedT += dt;
                if (route._blockedT > 0.6) { route._stale = true; route._blockedT = 0; }   // 标记待重规划（延迟 1s 执行）
            }
            // 回正/被挡累计 0.5s 仍出不去 → 倒车脱离，随后重新寻路；
            // 连续倒车无进展（到目标距离没缩短 1.5 格）累计 6 次 → 判定绕不过去，
            // 停在最近可停处，绝不无限循环
            if (d._stuckT > 0.5 && !(d._reversing > 0)) {
                // 边界缝隙脱离：先试整格跳变（按当前朝向验证整格位移）——车被顶进
                // "1 格宽缝隙"（前后角分别撞上停车的两格）时，任何精细位移都被挡，
                // 只有整格位移能脱身；跳成功则继续行驶，失败再进入倒车流程
                let jumped = false;
                for (const [jx, jy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const px = d.x + jx * TS, py = d.y + jy * TS;
                    if (canStandCar(px, py, d.dir)) {
                        d.x = px; d.y = py;
                        jumped = true;
                        break;
                    }
                }
                if (jumped) {
                    d._reversing = 0;
                    d._stuckT = 0.3;   // 保留一点缓冲，避免立即再次触发
                } else {
                    d._reversing = 1.4;   // 倒车约 5 格，保证脱出障碍区
                    d._probeT = 0;
                    d._stuckT = 0;
                    const distT = Math.hypot(tx - d.x, ty - d.y);
                    if (d._revMin == null || distT < d._revMin - TS * 1.5) {
                        d._revMin = distT;   // 有实质进展：重置连续倒车计数
                        d._revN = 0;
                    }
                    d._revN = (d._revN || 0) + 1;
                    if (d._revN >= 6) {
                        d._revN = 0;
                        log(sv, '前方障碍无法绕开，车队停在最近可停处', '#FFB347');
                        finishDriveOrder(sv, false);
                        return;
                    }
                }
            }
        }
    } else {
        d._probeT = 0;
        d._lastDir = d.dir;
        route._blockedT = 0;
        // 只有车实际移动（>2px）才清零卡死计时——回正分支会把速度置 0，
        // 下一帧"没动=没被挡"走 else 分支，若直接清零，回正-再转的原地振荡
        // 永远触发不了倒车/重建，车会挂机到油尽
        if (Math.hypot(d.x - (d._lastX != null ? d._lastX : d.x),
            d.y - (d._lastY != null ? d._lastY : d.y)) > 2) d._stuckT = 0;
        d._lastX = d.x;
        d._lastY = d.y;
    }
    // 主控/乘客跟随车
    sv.px = d.x; sv.py = d.y;
    sv.faceX = Math.cos(d.dir); sv.faceY = Math.sin(d.dir);
    driveCommon(sv, dt);
    if (!sv.driving) { sv.driveOrder = null; sv._chauffeured = false; }   // 途中报废 → 订单作废
}

// 完成驾驶订单：停车放人；到达 → 有营地则回营地待命，否则恢复跟随；取消 → 恢复跟随
export function finishDriveOrder(sv, reached) {
    sv.driveOrder = null;
    if (sv.driving && !stopDrive(sv, null)) {
        // 车门被障碍挡住下不了车：车留在原地，订单作废；玩家可 WASD 接管挪车后再 F 下车
        sv._chauffeured = false;
        log(sv, '到达位置车门打不开：车辆停在原地，按 WASD 挪动车辆后再按 F 下车', '#FFB347');
        return;
    }
    if (sv.npcs) for (const n of sv.npcs) {
        if (!n.alive || !n.party) continue;
        n.state = (reached && sv.camp) ? 'camp' : 'follow';
        n.campTask = null;
    }
    if (reached) log(sv, '车队已抵达目的地！全员下车', '#7DFF7D');
}

function crash(sv, d) {
    if (sv.now - (d._crashT || 0) < 0.4) { d.speed = 0; return; }
    d._crashT = sv.now;
    // 撞击受损随速度放大：低速小伤、高速重创（好好设计：撞得越狠坏得越多）
    const impact = 1 + (d.speed / CAR_DRIVE_SPEED) * 2.5;
    d.hp -= Math.round(CAR_CRASH_DMG * impact);
    d.speed = 0;
    sv.effects.push({ kind: 'quake', x: d.x, y: d.y, life: 0.35, maxLife: 0.35 });
    AudioSystem.playHit && AudioSystem.playHit();
}
