// ============================================================
// 【无尽植僵荒原】模组 · 滚动消息队列（3~5 条）
// 重要战斗/采集/建造信息不会被冲掉，按时间淡出
// ============================================================

const MAX_MSG = 5;
const MSG_LIFE = 4.0;
const MSG_FADE = 1.0;

export function initMsg(sv) {
    if (!sv.msgs) sv.msgs = [];
}

export function pushMsg(sv, text, color) {
    initMsg(sv);
    sv.msgs.push({ text, color: color || '#9BE89B', t: MSG_LIFE });
    if (sv.msgs.length > MAX_MSG) sv.msgs.shift();
}

export function updateMsg(sv, dt) {
    if (!sv.msgs) return;
    for (let i = sv.msgs.length - 1; i >= 0; i--) {
        sv.msgs[i].t -= dt;
        if (sv.msgs[i].t <= 0) sv.msgs.splice(i, 1);
    }
}

export function drawMsg(ctx, sv, W) {
    if (!sv.msgs || !sv.msgs.length) return;
    ctx.textAlign = 'center';
    ctx.font = '13px "Microsoft YaHei", monospace';
    const y0 = 62;
    for (let i = 0; i < sv.msgs.length; i++) {
        const m = sv.msgs[i];
        const alpha = m.t < MSG_FADE ? m.t / MSG_FADE : 1;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = m.color;
        ctx.fillText(m.text, W / 2, y0 + i * 18);
    }
    ctx.globalAlpha = 1;
}
