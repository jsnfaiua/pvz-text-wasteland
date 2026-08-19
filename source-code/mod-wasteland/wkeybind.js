// ============================================================
// 【无尽植僵荒原】键位设置模块
// 从 survival.js 拆出（v4.26）：自定义键位映射 + 键位设置面板。
// 依赖：saveData（core/state.js）/ writeSave（persistence/storage.js）。
// log 提示通过 setLogger 注入（survival.js 的 log 含 mp 广播，避免循环依赖）。
// ============================================================

import { saveData } from '../core/state.js';
import { writeSave } from '../persistence/storage.js';

// log 注入（由 survival.js 在初始化时设置）
let _logger = () => {};
export function setLogger(fn) { _logger = (typeof fn === 'function') ? fn : () => {}; }
function log(msg, color) { _logger(msg, color); }

// 可自定义功能键映射表（不含移动 WASD/方向键/数字快捷栏/系统键 F1/F9/F11/P 暂停等固定键）。
// 每个功能绑定单一键位；mouse0=左键 mouse1=中键 mouse2=右键 mouse3/mouse4=侧键。
export const KEYBIND_DEFS = [
    { act: 'interact', name: '交互 / 搜索 / 救治', def: 'f' },
    { act: 'attack', name: '攻击', def: 'j' },
    { act: 'dash', name: '闪现', def: 'q' },
    { act: 'guard', name: '格挡', def: 'e' },
    { act: 'jump', name: '跳跃', def: ' ' },
    { act: 'reload', name: '换弹', def: 'r' },
    { act: 'swap', name: '切换武器', def: 'x' },
    { act: 'bag', name: '背包', def: 'b' },
    { act: 'char', name: '角色属性', def: 'c' },
    { act: 'build', name: '建造 / 旗帜', def: 'g' },
    { act: 'craft', name: '拼字台', def: 'k' },
    { act: 'map', name: '世界地图', def: 'm' },
    { act: 'team', name: '队伍管理', def: 'h' },
    { act: 'rally', name: '集合信号 / 倒地切主控', def: 't' },
    { act: 'carry', name: '背起 / 射击模式', def: 'v' },
    { act: 'squat', name: '蹲下', def: 'control' },
    { act: 'run', name: '奔跑', def: 'shift' },
    { act: 'scope', name: '瞄准', def: 'mouse2' },
    { act: 'scan', name: '长按扫描周围', def: 'n' },
];
const KEYBIND_NAMES = {
    ' ': '空格', control: 'Ctrl', shift: 'Shift', escape: 'ESC', mouse0: '鼠标左键',
    mouse1: '鼠标中键', mouse2: '鼠标右键', mouse3: '鼠标侧键', mouse4: '鼠标侧键2',
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
    enter: '回车', backspace: '退格', tab: 'Tab', capslock: 'CapsLock',
};
function bindLabel(key) {
    if (KEYBIND_NAMES[key]) return KEYBIND_NAMES[key];
    if (/^f\d+$/.test(key)) return key.toUpperCase();
    if (key.length === 1) return key.toUpperCase();
    return key;
}

export function getBind(act) {
    const d = KEYBIND_DEFS.find(x => x.act === act);
    if (!d) return null;
    const kb = saveData.keybinds && saveData.keybinds[act];
    return (kb && kb !== '') ? kb : d.def;
}
export function setBind(act, key) {
    if (!saveData.keybinds) saveData.keybinds = {};
    saveData.keybinds[act] = key;
    writeSave(saveData);
    return getBind(act);
}
export function resetKeybinds() {
    if (saveData.keybinds) delete saveData.keybinds;
    writeSave(saveData);
}

// 键位设置面板
let keybindEl = null;
let keybindRecording = null;   // 当前录制中的 { act }
export function keybindOpen() { return !!(keybindEl && keybindEl.style.display !== 'none'); }
export function closeKeybinds() { if (keybindEl) keybindEl.style.display = 'none'; keybindRecording = null; }
function renderKeybinds() {
    if (!keybindEl) return;
    const list = keybindEl.querySelector('#wsl-kb-list');
    list.innerHTML = KEYBIND_DEFS.map((d, i) => {
        const cur = getBind(d.act);
        const rec = keybindRecording && keybindRecording.act === d.act;
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid #252d36;">
            <div style="flex:1;font-size:13px;color:#c9d2db;">${d.name}</div>
            <div class="wsl-kb-key" data-act="${d.act}" style="min-width:96px;text-align:center;padding:5px 10px;border-radius:6px;border:1px solid ${rec ? '#FFD700' : '#3a4451'};background:${rec ? 'rgba(255,215,0,.12)' : '#212833'};color:${rec ? '#FFD700' : '#e8ecf1'};font-size:13px;cursor:pointer;">${rec ? '请按键…' : bindLabel(cur)}</div>
        </div>`;
    }).join('');
    list.querySelectorAll('.wsl-kb-key').forEach(el => el.addEventListener('click', () => startKeybindRecord(el.dataset.act)));
}
function startKeybindRecord(act) {
    keybindRecording = { act };
    renderKeybinds();
    log(`键位录制：为「${KEYBIND_DEFS.find(d => d.act === act).name}」按下新键（回车取消，任意键/鼠标侧键绑定）`, '#FFD700');
}
export function finishKeybindRecord(key) {
    if (!keybindRecording) return;
    const act = keybindRecording.act;
    keybindRecording = null;
    setBind(act, key);
    renderKeybinds();
    log(`键位已设置：「${KEYBIND_DEFS.find(d => d.act === act).name}」→ ${bindLabel(key)}`, '#7DFF7D');
}
// 键盘事件接入点：返回 true 表示处于"键位录制"状态且已消费该键（回车=取消/其它=绑定）
export function handleKeybindRecordKey(k) {
    if (!keybindRecording) return false;
    if (k === 'enter' || k === 'escape') { keybindRecording = null; renderKeybinds(); log('键位录制已取消', '#8a9aa2'); }
    else { finishKeybindRecord(k); }
    return true;
}
export function openKeybinds() {
    if (!keybindEl) {
        keybindEl = document.createElement('div');
        keybindEl.id = 'wsl-keybinds';
        keybindEl.style.cssText = 'position:fixed;inset:0;z-index:950;background:rgba(0,0,0,.78);display:none;align-items:center;justify-content:center;';
        keybindEl.innerHTML =
            '<div class="wsl-scaler" style="position:relative;width:420px;max-width:92vw;">' +
            // 2026-08-11 v2.99 用户要求：所有弹窗都有叉号关闭按钮（右上角）
            '<button id="wsl-kb-close" style="position:absolute;top:6px;right:10px;background:none;border:none;color:#8a9aa2;font-size:20px;cursor:pointer;line-height:1;padding:2px;z-index:2;" title="关闭">✕</button>' +
            '<div style="font-size:20px;color:#FFD700;margin-bottom:8px;letter-spacing:3px;text-align:center;">键 位 设 置</div>' +
            '<div style="color:#8a9aa2;font-size:12px;margin-bottom:10px;text-align:center;">点击右侧键位框 → 按下新键（含鼠标侧键）→ 回车结束录制</div>' +
            '<div id="wsl-kb-list" style="max-height:52vh;overflow-y:auto;"></div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">' +
            '<button id="wsl-kb-reset" style="background:#2a313c;border:1px solid #4a5a66;color:#ccd;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:13px;">恢复默认</button>' +
            '<button id="wsl-kb-save" style="background:#1d5c3f;border:1px solid #39d98a;color:#bff5d8;padding:7px 24px;border-radius:6px;cursor:pointer;font-size:13px;">保 存</button>' +
            '</div></div>';
        document.body.appendChild(keybindEl);
        keybindEl.querySelector('#wsl-kb-close').addEventListener('click', closeKeybinds);
        keybindEl.querySelector('#wsl-kb-save').addEventListener('click', () => { closeKeybinds(); log('键位设置已保存', '#7DFF7D'); });
        keybindEl.querySelector('#wsl-kb-reset').addEventListener('click', () => {
            resetKeybinds();
            renderKeybinds();
            log('键位已恢复默认', '#7DFF7D');
        });
    }
    renderKeybinds();
    keybindEl.style.display = 'flex';
}
