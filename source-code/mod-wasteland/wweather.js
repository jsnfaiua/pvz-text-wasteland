// ============================================================
// 【无尽植僵荒原】天气系统模块（每天 8:00 确定性切换 + 季节同步）
// 从 survival.js 拆出（v4.26）。host/单机在 guest 分流后更新（guest 从 wsync 快照读）。
// 依赖：wbalance.js（weatherAt/wxInfo/wxLevelAt/wxIntensity/seasonAt）。
// log 通过 setLogger 注入（survival.js 的 log 含 mp 广播，避免循环依赖）。
// ============================================================

import * as B from './wbalance.js';
import AudioSystem from '../systems/audio.js';

let _logger = () => {};
export function setLogger(fn) { _logger = (typeof fn === 'function') ? fn : () => {}; }
function log(msg, color) { _logger(msg, color); }

// ---------- 天气系统：每天 8:00 确定性切换（§13.2 weatherAt(seed,day) 纯函数） ----------
// host/单机在 guest 分流后更新（guest 不本地随机，从 wsync 快照读 sv._weather → 双端一致 §5.1）。
// 2026-08-10 季节系统：天气按季节限定类型（春/夏/秋/冬），sv._season 与草地渲染联动。
export function updateWeather(sv) {
    // v3.65 用户要求还原 v3.62 行为：天气跟随 sv.t（与时间加速一致，不再用独立时钟 _wxClock）。
    // 之前 v3.63 引入的 sv._wxClock / sv._devWxTimeScale 完全移除（代码里仍可能在 wdev 读到 sv._wxClock 残留值，但不再使用）。
    const hour = (sv.t / sv.dayLen) * 24;
    // 同步季节（幂等：读档/跨天/换日都保持正确；0春 1夏 2秋 3冬，与 wgrass SEASONS 索引一致）
    const seasonNow = B.seasonAt(sv.day);
    if (sv._season !== seasonNow) { sv._season = seasonNow; }
    // dev 手动设了天气 + 强度后锁定（applyWxSet 设 _devWxLock=true），不被每天 8:00 自动覆盖
    if (sv._devWxLock) { sv._lastWxHour = hour; sv._lastHintHour = hour; return; }
    // 预兆暗示（每天 7:00，切换前 1 游戏小时）：角色隐约感知即将来袭的天气（hint 文案，双端 log）
    if ((sv._lastHintHour == null || (sv._lastHintHour < 7 && hour >= 7)) && hour < 8) {
        const hintWx = B.weatherAt(sv.world.seed, sv.day);
        if (hintWx !== sv._weather) log(B.wxInfo(hintWx).hint, '#B0B0C0');
    }
    sv._lastHintHour = hour;
    if (sv._lastWxHour != null && sv._lastWxHour < 8 && hour >= 8) {
        const wx = B.weatherAt(sv.world.seed, sv.day);
        if (wx !== sv._weather) {
            const info = B.wxInfo(wx);
            const level = B.wxLevelAt(sv.world.seed, sv.day);
            const inten = B.wxIntensity(wx, level);
            // v3.65 天气切换触发淡入：粒子 alpha 从 0 在 1.5s 内升至 1，避免"突然出现"。
            sv._weather = wx;
            sv._weatherFadeT = 0;
            sv._wxDensityMul = 0;
            // 大字公告（提示与天气改变同刻，host 端设 → wsync 快照 announce 双端显示）：
            // v3.63 排布得当：「🌧 中雨 即将来袭 · 雨幕连绵，视野模糊」（图标+名字+状态+描述紧凑串成一句，避免多行重叠）
            const flashTag = inten.flash ? ' ⚡' : '';
            sv.announce = { text: `${info.icon} ${inten.name}${flashTag} 即将来袭 · ${info.desc}`, t: 3.2, color: info.color };
            log(`${inten.name}：${info.desc}`, info.color);   // 强度名（小雨/中雨…大雪/浓雾）+ 描述，host 广播 msg 双端可见
            if (wx === 'sandstorm' || inten.flash) AudioSystem.playWaveWarning();
        }
    }
    sv._lastWxHour = hour;
}
