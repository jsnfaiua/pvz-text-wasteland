// ============================================================
// 【无尽植僵荒原】模组 · 未实装物品模子表（设计稿）
// ------------------------------------------------------------
// 什么是"模子"：尚未实装的物品骨架——物品 id / 名称 / 图标字符 / 颜色 / 分类 / 描述 / 开发计划。
// 模子只做【定义与展示】，不做任何实际功能（无攻击、无特效、无数值、不投放掉落/配方/商店/交易）。
//
// 状态约定：
//   unreleased: true = 未实装（模子已立）。
//   游戏内获得此类物品的唯一途径是开发者模式刷取（wdev）；背包格子带"未"角标，
//   左键点击仅提示"尚未实装"，右键详情显示【模子·未实装】说明，不产生任何效果。
//
// 转正流程（后续逐条开发，均须遵守"局部开发必覆盖全局"五面核对）：
//   1. 实现实际功能（武器→攻击逻辑/特效/数值；工具→交互机制；资源→采集/用途；食物/药品→使用效果）
//   2. 把条目从本表迁移到正式定义：
//        - 武器 → core/constants.js WEAPONS（id 改 wpn:xxx）+ WEAPON_META + wbalance.js WEAPON_DUR
//        - 工具 → panel.js ITEMS（id 改 tool:xxx）
//        - 资源/食物/药品 → panel.js ITEMS
//        - 配方 → wwordcraft-rules.js RECIPES（配方字自动"转正"，脱离混淆库）
//        - 掉落 → wbalance.js LOOT_CONTENTS / 各来源池（新物品需"直接搜刮 或 拆字拼字"两条获取途径）
//   3. id 从 proto: 前缀改为正式前缀，删除 unreleased 标记，同步 itemValue / 交易定价
//   4. 同步教程（wtut.js F1）/ 横幅键位提示（render.js drawScrollBanner 室内外）
// ============================================================

export const DESIGN_ITEMS = {
    // ===================== 武器（8）=====================
    'proto:flamethrower': {
        name: '火焰枪', char: '焰', color: '#FF7733', kind: 'weapon', role: 'ranged', glyphs: '火枪', unreleased: true,
        plan: '远程持续喷射火焰，命中点燃僵尸持续灼烧；联动具象词条"火=灼烧"。弹种/数值/喷射特效待设计。',
    },
    'proto:frostbow': {
        name: '冰霜弓', char: '霜', color: '#7FD4FF', kind: 'weapon', role: 'ranged', glyphs: '冰弓', unreleased: true,
        plan: '远程蓄力弓，箭矢命中冰冻/减速；联动具象词条"冰=冰封"。冻结时间/数值待设计。',
    },
    'proto:lightningGun': {
        name: '雷击枪', char: '雷', color: '#8A6BFF', kind: 'weapon', role: 'ranged', glyphs: '雷枪', unreleased: true,
        plan: '远程电击，命中触发连锁闪电（弹射多个目标）；联动"雷=电击"。弹种/连锁机制/数值待设计。',
    },
    'proto:poisonSprayer': {
        name: '毒雾喷射器', char: '毒', color: '#6BBF4A', kind: 'weapon', role: 'ranged', glyphs: '毒器', unreleased: true,
        plan: '远程喷射毒雾，命中的僵尸持续中毒掉血；联动"毒=中毒"。毒伤/持续时长/特效待设计。',
    },
    'proto:meteorFlail': {
        name: '流星锤', char: '锤', color: '#B89A6A', kind: 'weapon', role: 'melee', glyphs: '星锤', unreleased: true,
        plan: '近战大范围横扫（弧大/距离中），命中击退；联动"力=蛮力"等词条。范围/击退力度/数值待设计。',
    },
    'proto:javelin': {
        name: '标枪', char: '标', color: '#D2B48C', kind: 'weapon', role: 'melee', glyphs: '标枪', unreleased: true,
        plan: '近战突刺（距离远）且可投掷；联动"力=蛮力"。突刺/投掷双形态与数值待设计。',
    },
    'proto:crossbow': {
        name: '十字弩', char: '弩', color: '#A06A3A', kind: 'weapon', role: 'ranged', glyphs: '弩箭', unreleased: true,
        plan: '远程高伤害单发，装填慢、射程远；消耗弩箭弹药（新增弹种）。伤害/装填/精度数值待设计。',
    },
    'proto:chainsaw': {
        name: '电锯', char: '锯', color: '#C85050', kind: 'weapon', role: 'melee', glyphs: '电锯', unreleased: true,
        plan: '近战持续切割：按住连续攻击，单次低伤但攻速极高；消耗燃料或电池。攻速/油耗/数值待设计。',
    },

    // ===================== 工具（5）=====================
    'proto:saw': {
        name: '锯子', char: '锯', color: '#D2691E', kind: 'tool', glyphs: '锯子', unreleased: true,
        plan: '伐木工具：砍树速度提升（与伐木斧定位区分：快而少 vs 慢而多）。数值与机制待设计。',
    },
    'proto:hammer': {
        name: '锤子', char: '锤', color: '#B0B0B0', kind: 'tool', glyphs: '锤子', unreleased: true,
        plan: '建造/修理工具：建造消耗减免、建筑/设施修理加速。机制与数值待设计。',
    },
    'proto:fishingRod': {
        name: '鱼竿', char: '竿', color: '#4A8A5A', kind: 'tool', glyphs: '鱼竿', unreleased: true,
        plan: '水域交互：在积水旁按 F 垂钓，产出鱼/水生物食物（需配套新食物）。垂钓机制与产出表待设计。',
    },
    'proto:pliers': {
        name: '钳子', char: '钳', color: '#77AACC', kind: 'tool', glyphs: '钳子', unreleased: true,
        plan: '拆解工具：拆卸建筑/载具/物品返还材料（区别于手术刀拆字、扳手修车）。返还率与机制待设计。',
    },
    'proto:torch': {
        name: '火把', char: '火', color: '#FFB347', kind: 'tool', glyphs: '火把', unreleased: true,
        plan: '照明工具：夜间扩大视野/驱散暗区，或点燃作用；消耗耐久或燃料。照明范围/时长待设计。',
    },

    // ===================== 资源（5）=====================
    'proto:iron': {
        name: '铁矿石', char: '矿', color: '#8A8A9A', kind: 'resource', glyphs: '铁矿', unreleased: true,
        plan: '采矿产出（石镐开采矿脉）：锻造铁锭→强化武器/造高级工具。矿脉生成与锻造链待设计。',
    },
    'proto:clay': {
        name: '黏土', char: '泥', color: '#A07850', kind: 'resource', glyphs: '黏土', unreleased: true,
        plan: '采集产出：烧制砖块→高级建造材料（石墙/砖墙）。采集点与烧制链待设计。',
    },
    'proto:gunpowder': {
        name: '火药', char: '爆', color: '#555555', kind: 'resource', glyphs: '火药', unreleased: true,
        plan: '制造弹药的核心材料（工作台合成各类弹种）；或制作陷阱/爆炸物。合成配方待设计。',
    },
    'proto:battery': {
        name: '电池', char: '电', color: '#3AD63A', kind: 'resource', glyphs: '电池', unreleased: true,
        plan: '供能部件：为电锯/雷击枪等用电武器与设备提供能量。能耗机制待设计。',
    },
    'proto:fabric': {
        name: '布料', char: '布', color: '#D8D2BD', kind: 'resource', glyphs: '布料', unreleased: true,
        plan: '搜刮/拆解衣物产出：制作绷带、背包扩容、衣物护甲。用途与配方待设计。',
    },

    // ===================== 食物（3）=====================
    'proto:jerky': {
        name: '肉干', char: '肉', color: '#A0522D', kind: 'food', glyphs: '肉干', unreleased: true,
        plan: '饱食 + 耐储存（长期不腐坏）：击杀动物得生肉，再烤制/风干。数值与获取链待设计。',
    },
    'proto:mushroom': {
        name: '蘑菇', char: '菇', color: '#C89060', kind: 'food', glyphs: '蘑菇', unreleased: true,
        plan: '野外采集食物：饱食收益，但部分有毒品种可能引发食物中毒（风险收益）。数值与毒蘑菇机制待设计。',
    },
    'proto:honey': {
        name: '蜂蜜', char: '蜜', color: '#FFB347', kind: 'food', glyphs: '蜂蜜', unreleased: true,
        plan: '甜食：高饱食 + 少量水分，可长期保存；也可作药材/兴奋剂原料。数值与来源（蜂巢）待设计。',
    },

    // ===================== 药品（3）=====================
    'proto:painkiller': {
        name: '止痛药', char: '止', color: '#9AE88A', kind: 'med', glyphs: '止痛', unreleased: true,
        plan: '缓解疼痛：短暂恢复/镇痛效果（临时减伤或抑制疾病），与现有回血药差异化。数值与机制待设计。',
    },
    'proto:stimulant': {
        name: '兴奋剂', char: '奋', color: '#FFD24A', kind: 'med', glyphs: '兴奋', unreleased: true,
        plan: '临时增益：短时间内提升移速/攻速/体力恢复，有副作用（结束后虚弱）。数值与副作用待设计。',
    },
    'proto:antiserum': {
        name: '解毒血清', char: '血', color: '#7DF9FF', kind: 'med', glyphs: '血清', unreleased: true,
        plan: '解除中毒/特殊异常状态（超越现有"解毒剂"的通用解毒），也可对抗文字污染早期。机制待设计。',
    },
};

// 分组（转正/开发排期用）
export const DESIGN_GROUPS = {
    weapon:   { name: '武器',   list: ['proto:flamethrower', 'proto:frostbow', 'proto:lightningGun', 'proto:poisonSprayer', 'proto:meteorFlail', 'proto:javelin', 'proto:crossbow', 'proto:chainsaw'] },
    tool:     { name: '工具',   list: ['proto:saw', 'proto:hammer', 'proto:fishingRod', 'proto:pliers', 'proto:torch'] },
    resource: { name: '资源',   list: ['proto:iron', 'proto:clay', 'proto:gunpowder', 'proto:battery', 'proto:fabric'] },
    food:     { name: '食物',   list: ['proto:jerky', 'proto:mushroom', 'proto:honey'] },
    med:      { name: '药品',   list: ['proto:painkiller', 'proto:stimulant', 'proto:antiserum'] },
};

// 是否未实装模子物品
export function isUnreleased(id) {
    return !!(typeof id === 'string' && DESIGN_ITEMS[id]);
}

// 取模子信息（统一带【模子·未实装】说明，供 getItemInfo 挂接）
export function designItemInfo(id) {
    const d = DESIGN_ITEMS[id];
    if (!d) return null;
    return {
        ...d,
        desc: d.desc || `【模子·未实装】${d.name}：${d.plan || '功能待开发'}（暂不投放，仅作设计骨架）`,
    };
}

// 全部模子扁平列表（含分组名，供文档/调试）
export function listUnreleased() {
    const out = [];
    for (const g of Object.keys(DESIGN_GROUPS)) {
        for (const id of DESIGN_GROUPS[g].list) {
            const d = DESIGN_ITEMS[id];
            if (d) out.push({ id, group: g, groupName: DESIGN_GROUPS[g].name, ...d });
        }
    }
    return out;
}
