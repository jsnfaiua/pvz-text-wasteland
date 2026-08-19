// ============================================================
// wtut.js — 荒原新手引导（首次进入提示卡 + F1 随时打开）
// ------------------------------------------------------------
// 用途：首次进入荒原时显示「生存指南」覆盖卡；按 F1 可随时重新打开。
// 覆盖：核心操作键位 + 生存目标 + 新功能（队伍管理/救治/季节天气/室内）。
// ------------------------------------------------------------
// 红线合规：
//   · 零依赖模块（不 import 任何游戏模块）——不扩大循环依赖区；
//   · 纯 DOM 覆盖层，不触碰 canvas 渲染路径，不改任何游戏状态；
//   · 标记存 localStorage（本地），不进 wstate / 不随 wsync 同步；
//   · 显示期间游戏正常运行（仅覆盖层，随时可点掉）。
// ============================================================

const KEY = 'wasteland_tutorial_seen';
let el = null;

// ================= v4.8 教程"已读"改按【世界+角色】粒度记录（修复"新存档不弹教程"） =================
// 此前 KEY 全局唯一：只要任何一个存档点过「开始生存！」，之后所有新存档（新世界/新角色）
// 都因全局标记不再弹教程 —— 用户反馈"新存档睁眼结束没有新手教程"。
// 现在每个世界+角色组合单独记录：新存档首次进局必弹；同一存档看过后不再弹。
// 旧全局 KEY 保留作迁移：老档（playT>0 / day>1）若历史上看过教程，迁移为当前世界已读，
// 老玩家继续游戏不会重复弹（v4.7 行为保持）。
function tutKey(sv) {
    const seed = sv ? (sv.world && sv.world.seed != null ? sv.world.seed : sv.seed) : null;
    const name = sv ? (sv.characterName || '') : '';
    return 'wasteland_tutorial_seen_' + (seed != null ? String(seed) : 'g') + '_' + (name || 'g');
}
function seenTut(sv) {
    try {
        if (sv && localStorage.getItem(tutKey(sv))) return true;
    } catch {}
    // 老档兼容迁移：历史上全局看过教程（旧 KEY）→ 视为当前世界已读（老玩家继续游戏不重复弹）
    if (sv && (sv.playT > 0 || (sv.day || 1) > 1)) {
        try {
            if (localStorage.getItem(KEY)) { localStorage.setItem(tutKey(sv), '1'); return true; }
        } catch {}
    }
    return false;
}
function markTut(sv) {
    try { if (sv) localStorage.setItem(tutKey(sv), '1'); } catch {}
}

// ================= v4.6 教程内容数据化（内容与布局解耦） =================
// 以后修改/新增教程条目只改这里，不影响布局（布局由 buildLayout 固定骨架 + 循环渲染）。
// 每项：{ t: 标题, rows: 正文（可含 <b> 等行内标签） }；rows 为数组则每行一条。
const TUTORIAL_CONTENT = [
    { t: '操作键位', rows: [
        '<b style="color:#7ee08a;">WASD</b> 移动 · <b style="color:#7ee08a;">Shift</b> 奔跑',
        '<b style="color:#7ee08a;">Q</b> 闪避（无敌帧）',
        '<b style="color:#7ee08a;">J</b> 近战攻击 · <b style="color:#7ee08a;">E</b> 格挡',
        '<b style="color:#7ee08a;">F</b> 交互（搜刮/拾取/进门/救治/赠送；鼠标准星指哪交互哪，室内外一致）',
        '<b style="color:#7ee08a;">长按 N 0.8秒</b> 扫描周围可交互目标（灰色环+绿色360°填充，满自动弹出，滚轮/鼠标点选，✕ 关闭）',
        '<b style="color:#7ee08a;">R</b> 换弹 · <b style="color:#7ee08a;">X</b> 切武器 · <b style="color:#7ee08a;">V</b> 背起/放下',
        '<b style="color:#7ee08a;">B</b> 背包 · <b style="color:#7ee08a;">C</b> 角色属性 · <b style="color:#7ee08a;">G</b> 建造',
        '<b style="color:#7ee08a;">H</b> 队伍管理（属性/背包/补给）',
        '<b style="color:#7ee08a;">K</b> 拼字台（拼字/琢磨/修复）· <b style="color:#7ee08a;">1-6</b> 快捷栏 · <b style="color:#7ee08a;">P</b> 暂停',
        '<b style="color:#7ee08a;">F1</b> 打开本指南 · <b style="color:#7ee08a;">F11</b> 全屏 · <b style="color:#7ee08a;">ALT+ESC</b> 退出全屏',
    ]},
    { t: '生存目标', rows: [
        '· 搜索字块/物资箱积累资源，用 <b style="color:#7ee08a;">拼字台</b> 把字块具现成工具武器',
        '· 在空地插 <b style="color:#7ee08a;">领地旗帜</b> 建营地（可招 NPC、回血加速）',
        '· 夜里 <b style="color:#ffcc66;">20:00 起尸潮来袭</b>，用 <b style="color:#7ee08a;">G</b> 建造墙/门/种植盆提前布防',
        '· 找到 <b style="color:#7ee08a;">载具</b> 可快速探索（F 上车，靠近 NPC 可让队友代驾）',
        '· 角色物品跨世界保留；世界跟种子生成，可随时换新世界重开',
    ]},
    { t: '文字具象与拆字（v3.8~v3.10）', rows: [
        '· 按 <b style="color:#7ee08a;">K</b> 打开拼字台：<b>配方拼字</b>（已解锁配方直接拼）/ <b>琢磨自由拼字</b>（无配方自己排字）/ <b>修复残缺物</b> / <b>图鉴</b>（查看字→词条映射与无用字清单）',
        '· 配方需搜索获得：搜刮容器/击败僵尸掉 <b style="color:#7ee08a;">配方卡</b>，背包右键「使用」解锁到拼字台',
        '· 拼字须消耗 <b style="color:#7ee08a;">字楔</b> 粘合文字；拼出的词与配方一致=正常具现，不一致=文字错乱生成错乱僵尸（属性由组成字决定）',
        '· <b style="color:#7ee08a;">文字手术刀</b>（仅医疗箱 2% 掉落）：背包左键打开<b>拆字台</b>——净化污染字块/字楔、把物品拆成组成字（必定成功，猜错无惩罚）',
        '· 具现出的武器带 <b style="color:#7ee08a;">词条</b>（火=灼烧/冰=冰封/力=蛮力等），比搜刮的更强；<b style="color:#7ee08a;">弹量词条</b>的具象弹药使武器弹匣 +25%',
        '· <b style="color:#8a8a8a;">无用字（混淆字）</b>：通用规范汉字表 3500 常用字中，未装载实际功能的字即混淆字（灰色字块，占掉落约 1/6），拼不出物品（强行拼字只会错乱），等待新功能将其"转正"',
    ]},
    { t: '队伍与伙伴', rows: [
        '· 招募/雇佣 NPC 入队（最多 4 人）：F 交互 → 邀请/雇佣',
        '· 按 <b style="color:#7ee08a;">H</b> 打开队伍管理：查看队员属性/背包，喂食/喝水/治病/减感染',
        '· 队伍命令面板（靠近队员 F）：跟随/返回营地/驾车/召唤/切换主控/解散',
        '· <b style="color:#7ee08a;">切换主控</b>（冷却 240s）：换到另一名队员操控',
        '· <b style="color:#7ee08a;">召唤队员</b>（冷却 240s）：把卡住/掉队的队员拉回身边',
    ]},
    { t: '受伤与救治', rows: [
        '· 主控濒死后：切队友视角搜集药品（伤口药/抗生素/草药×3）送到身边 F 救治',
        '· 按 <b style="color:#7ee08a;">V</b> 或救助界面<b style="color:#7ee08a;">背起</b>濒死队友，背到床旁放下可延长存活 25%',
        '· 队友也全员濒死/阵亡 → 无人能救，游戏结束',
        '· 室内外规则一致：靠近楼梯按 F 上楼下楼，出口自动出门',
        '· <b style="color:#7ee08a;">脱战自然回血</b>（v3.63）：饱食/水分充足 + 血量 >10 + 不在战斗 → 缓慢自愈，低血回得更慢',
    ]},
    { t: '倒地NPC交互（v4.33）', rows: [
        '· 靠近<b style="color:#7ee08a;">倒地/躺尸</b>NPC（友善/中立/敌对都可）→ 屏幕底部弹出小UI框，列出可执行操作',
        '· <b style="color:#7ee08a;">鼠标滚轮（中键滚动）</b>上下切换选项，<b style="color:#7ee08a;">F</b> 或 <b style="color:#7ee08a;">左键点击选项</b>确认',
        '· <b style="color:#7ee08a;">搜索</b> = 搜刮身上物品/遗物；<b style="color:#7ee08a;">补刀</b> = 击杀并阻止尸变（尸体保留可搜索）；倒地队友另有<b style="color:#7ee08a;">救治</b>',
        '· 感染倒地不停：倒地期间感染继续增长，感染满会在救援时间结束前直接尸化——感染快满的队友请趁早补刀/救治',
    ]},
    { t: 'v4.34 优化', rows: [
        '· <b style="color:#7ee08a;">集合信号（T）聚拢自动绕障</b>：队员遇墙/建筑/围栏不再卡死，自动寻最近可达点 + 沿墙绕行靠拢',
        '· <b style="color:#7ee08a;">感染满死亡可切队友视角</b>：感染恶化直接死亡（不可救），但有存活队友时弹「切换队友视角/重生」选择框；重生会解散旧队伍',
        '· <b style="color:#7ee08a;">远程 NPC 没弹药降级肉搏</b>：不再站桩发呆，自动近身搏斗',
        '· 首次点「开始游戏」过渡动画更流畅（页面加载时已后台预热模块）',
    ]},
    { t: 'v4.35 优化', rows: [
        '· <b style="color:#7ee08a;">室内队友跟着上下楼</b>：主控走楼梯上/下楼时，同房间同层的队伍成员自动切到新楼层（站在楼梯口）',
        '· <b style="color:#7ee08a;">室内外战斗楼层隔离</b>：不同楼层的 NPC 与僵尸互不攻击/啃咬（不会再"看不见人影却被咬/被打"）',
        '· <b style="color:#7ee08a;">室内也能救助/补刀/搜索</b>：靠近倒地/躺尸 NPC 弹出小 UI 选择框（滚轮切换，F/左键确认），与室外一致',
        '· <b style="color:#7ee08a;">扫描倒地队友先弹交互框</b>：N 扫描点「与 XX 交互」→ 弹出小 UI → 滚轮选救治/搜索/补刀',
        '· <b style="color:#7ee08a;">感染死无队友弹重生</b>：没有存活队友时弹「重生/返回主菜单」选择框（不再直接重生）',
    ]},
    { t: 'v4.36 优化', rows: [
        '· <b style="color:#7ee08a;">首次点「开始游戏」动画不卡</b>：页面加载后立即后台预热（不等空闲）+ 预计算黄沙格子 + 预建画布，首次过渡动画全程流畅',
    ]},
    { t: 'v4.37 优化', rows: [
        '· <b style="color:#7ee08a;">进房间队员陆续跟随</b>：主控先进、队员 0.5/0.9/1.3s 错峰延迟进入（不再提前在房间准备好）',
        '· <b style="color:#7ee08a;">死亡弹窗不再被遮挡</b>：死亡弹窗改挂 document.body + position:fixed + z-index 1300，不会被 bg-fx 黑沙盖住，玩家看得见',
        '· <b style="color:#7ee08a;">室内鼠标指针扫目标</b>：N 扫描面板中鼠标指针指向的目标排顶部（带 ◎ 准星高亮），轻松选中尸体/箱子/队友',
        '· <b style="color:#7ee08a;">补刀致死的尸体搜空就消失</b>：玩家主动补刀致死的尸体（与尸变丧尸尸体相同）搜空不再保留，避免占位',
        '· 待尸变尸体不占队伍名额：邀请 NPC 面板提示"活人 X/4，待尸变 X 人不占名额"',
        '· 室内击杀尸变丧尸 → 生成同房间尸体：之前被丢到室外看不到，现在可在室内搜',
    ]},
    { t: 'v4.40 优化', rows: [
        '· <b style="color:#7ee08a;">室内金色框跟随鼠标指针</b>：鼠标指到箱子/楼梯/队员/尸体/躲藏幸存者，金色交互框立即移到指针指向的物体（F 交互的就是它）',
        '· <b style="color:#7ee08a;">队员跟着出房间</b>：主控走出房间，同房间队伍成员自动跟着出现在门口',
        '· <b style="color:#7ee08a;">侵蚀倒地救援时间减半</b>：被感染侵蚀倒地的队员，救援时间 = 感染致死剩余时间的 50%（感染越深救援越急）',
        '· <b style="color:#7ee08a;">队伍面板濒死/尸变倒计时</b>：左侧队伍列表显示"濒 分秒"（救援剩余）与"变 分秒"（尸变倒计时）',
        '· 室内击杀尸变丧尸 → 生成同房间尸体可搜',
    ]},
    { t: 'v4.41-4.43 交互优化', rows: [
        '· <b style="color:#7ee08a;">指针指哪交互哪</b>：室内外所有可交互物体（箱子/楼梯/队员/尸体/躲藏幸存者/躺地NPC/倒地主控）鼠标指到即显示金框，F 作用的就是指针指向的物体（躺地 NPC 选择框不再抢占金框）',
        '· <b style="color:#7ee08a;">指针交互稳定</b>：所有物体优先级一致（最近者优先）+ 滞回锁定防金框乱跳',
        '· <b style="color:#7ee08a;">感染死亡保留尸体、3 分钟尸变</b>：主控感染满死亡与 NPC 成员一致——本人尸体留在原地（可搜索遗物）、队伍列表保留"尸"徽标，3 分钟后尸变才移出队伍',
        '· <b style="color:#7ee08a;">出门错峰不卡墙</b>：走出房间队员陆续从门口出来（不再一次性瞬移卡进建筑），且自动落在门口最近可走格',
        '· <b style="color:#7ee08a;">敌方 NPC 子弹不误伤自己人</b>：恶意 NPC 的子弹优先打主控、也能正常打僵尸/中立 NPC/友善 NPC；同阵营不再误伤',
        '· <b style="color:#7ee08a;">队伍成员不低血乱跑</b>：低血逃跑只对恶意 NPC 生效；按 T 集合信号成员无视战斗直奔主控（最高命令），到达后恢复',
    ]},
    { t: 'v4.46-4.50 性能与治理', rows: [
        '· <b style="color:#7ee08a;">AI 生物寻路全面优化</b>：NPC 排斥 O(N²)→空间网格、A* 不可达 64 次独立搜索→1 次流场、游荡免 A*——跟随/战斗/追击更顺滑',
        '· <b style="color:#7ee08a;">性能护栏规则（9 条）+ 性能基准回跑</b>：每次开发完成必跑 perf-bench.mjs（退化>30% 自动拦截），游玩不会越改越卡',
    ]},
    { t: 'v4.49 联机/室内外同步', rows: [
        '· <b style="color:#7ee08a;">联机开发标志全同步</b>：host 开启无限耐久/风向覆盖也会同步给 guest',
        '· <b style="color:#7ee08a;">联机尸变尸体可见可搜</b>：host 击杀尸变丧尸生成的尸体，guest 端也能看到并搜索遗物',
        '· <b style="color:#7ee08a;">室内倒地队员感染推进</b>：室内倒地队员感染值继续增长、感染满在救援结束前直接尸化——与室外行为一致',
    ]},
    { t: 'v4.51-4.53 拾取与交互', rows: [
        '· <b style="color:#7ee08a;">NPC 自动拾取掉落</b>：室内外一致的队伍成员会自动捡起脚边的掉落物（怪物掉落/丢弃物品），捡起时顶栏弹幕提示"XXX 拾取了 XX ×N"',
        '· <b style="color:#7ee08a;">H 队伍面板</b>：v4.54 移除 v4.51 的背包摘要行（顶部弹幕已告知拾取内容，H 面板保持纯净只显示名字/血条/状态徽标）',
        '· <b style="color:#7ee08a;">倒地/尸体交互统一为"选项框"</b>：不再靠近自动弹出——按 F（或 N 扫描面板点击"与 XX 交互"）才弹出选择框，内含【救治（送药救活）】【搜索（搜刮物品）】【补刀（击杀/阻止尸变）】三选项，滚轮选择后按 F 执行',
        '· <b style="color:#7ee08a;">尸体/倒地不随切场景</b>：从室内走出/上楼时，尸体和倒地队员留在原房间原楼层（不会跟着瞬移出场景）',
        '· <b style="color:#7ee08a;">侵蚀效果统一灰绿色</b>：树木和僵尸不再浮现"树"字/"尸"字——所有生物感染侵蚀统一为与玩家/NPC 一致的灰绿色',
    ]},
    { t: 'v4.38 优化', rows: [
        '· <b style="color:#7ee08a;">队友指引覆盖任意状态/任意楼层</b>：不管队员是正常存活、倒地待救、即将尸变还是已死尸体，室内外、任意楼层都有屏幕边缘指引箭头',
        '· 状态标签区分：正常（专属彩色）、倒地（红色"（倒地）"）、待尸变（橙色"（待尸变）"）、尸体（灰色"（尸）"）',
        '· 跨楼层指引：队员在楼上/楼下时显示"↑2楼/↓1楼"箭头指引（指向楼梯方向）',
    ]},
    { t: '感染机制（v3.63 重写）', rows: [
        '· 被僵尸咬 → 感染值 +2~6（受概率触发），感染时间约 <b style="color:#ffcc66;">4 分钟</b>从 0 到 100%（v3.62 前 2 分钟，已 +100% 延长）',
        '· 每 <b style="color:#ff8866;">1% 感染 → 角色所有属性降低 0.5%</b>（速度/血上限/伤害统一按总乘子削弱；100% 感染时属性 = 50%）',
        '· 感染 100% → 触发死亡（遗物/尸体/软核重生或全灭）',
        '· 治疗：抗生素 / 草药 ×3（F 交互主角/管理界面操作队友）',
        '· <b style="color:#7ee08a;">NPC 队友/中立/恶意也会感染</b>，同样受属性削弱（脱战 + 治疗恢复），不治必死',
        '· UI 显示：左上 <b>感染X%</b>（连续平滑填充，阶段名仅在升阶瞬间浮字）；屏幕覆盖层（灰绿侵蚀 + 噪点）按阶段升级',
    ]},
    { t: '环境与季节', rows: [
        '· 天气按<b style="color:#7ee08a;">季节</b>变化（春晴雨雾 / 夏晴雨沙尘 / 秋晴雨雾沙尘 / 冬晴雪雾）',
        '· 顶部实时显示（v3.63 合并到一排）：<b>第 N 天 HH:MM [区域] [季节] · 天气</b> + 背包占用 + 金币 + 开发者 ∞ 标记',
        '· 恶劣天气影响移速/视野，雷阵雨有闪电，沙尘暴有风力推挤',
        '· 击杀恶意 NPC 掉落战利品包裹（含其全部物品）',
    ]},
    { t: '死亡与找回（v3.63 简化指引）', rows: [
        '· 死亡后软核会重生：有床回床旁，无床在城区/郊区/废墟随机一处苏醒（v3.62 起）',
        '· 屏幕边缘出现 <b style="color:#ff5544;">红色箭头</b>（v3.63 简化）指向死亡地点 + 「死亡地点 · N 格」距离标签',
        '· 搜索完遗物尸体后指引自动消失；重生后走到死亡点附近不会再误清',
    ]},
    { t: '开发者模式（F9 · v3.63 调整）', rows: [
        '· 主控 Tab：<b>属性全满</b>（无敌 + 一次回满；不再联动<b>无限体力</b>，体力 ∞ 需单独点）/<b>资源无限</b>（v3.63 默认<b>关闭</b>，按需开）/<b>无限弹药/耐久/背包</b>/<b>一击必杀</b>',
        '· 全局 Tab：<b>时间加速</b>×10/×60 快捷 + <b>自定义数字</b>（1~200）+ 勾选「天气也加速」决定是否影响天气流逝',
        '· 时间加速默认只影响上方时间/救助/尸变速度（不影响天气粒子频闪，需手动勾选才同步天气）',
        '· <b>随机重生</b>（v3.63 真正随机）：±200 区块 [X,Y] 完全随机跨区块，不再限制在某区块内',
        '· <b>重置存档</b>（v3.63 改名）：一键重置地图种子/世界名/角色名/外貌全部随机（保留 devflags 方便连测）',
        '· <b>状态回满</b> 一键清感染/疾病/体力全满（<b>不</b>会清空主控以外的队友濒死记录）',
    ]},
];

// v4.6 布局骨架：固定结构（标题/副标题/滚动内容区/按钮），内容由 TUTORIAL_CONTENT 数据驱动，
// 循环渲染各章节——以后增删/修改教程条目只动 TUTORIAL_CONTENT，布局完全不变。
function buildLayout() {
    const sections = TUTORIAL_CONTENT.map(s => {
        const rows = (Array.isArray(s.rows) ? s.rows : [s.rows]).map(r =>
            `<div style="font-size:13px;color:#c8d6ce;line-height:1.8;">${r}</div>`).join('');
        return `<div style="color:#9fb3ab;font-size:13px;margin:0 0 4px;">▸ ${s.t}</div>
                <div style="margin:0 0 12px;">${rows}</div>`;
    }).join('');
    return `
    <div style="position:relative;width:640px;max-width:94vw;max-height:86vh;overflow-y:auto;background:rgba(12,22,16,0.97);
                border:1px solid #3a8a4a;border-radius:10px;padding:20px 24px;color:#dce6e2;
                font:14px/1.6 'Microsoft YaHei',sans-serif;box-shadow:0 0 40px rgba(57,217,138,0.25);">
        <button id="wsl-tut-close-x" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#8a9aa2;font-size:20px;cursor:pointer;line-height:1;padding:2px;" title="关闭 (F1)">✕</button>
        <div style="font-size:19px;color:#7ee08a;text-align:center;margin-bottom:4px;">◈ 无尽植僵荒原 · 生存指南</div>
        <div style="font-size:12px;color:#7a8a92;text-align:center;margin-bottom:14px;">文字生存探索 · 城市越深处越危险，稀有物资越多 · 按 F1 可随时打开本指南 · 再按 F1 关闭</div>
        ${sections}
        <div style="display:flex;gap:10px;">
            <button id="wsl-tut-ok" style="flex:1;background:#123d2c;border:1px solid #39d98a;color:#39d98a;
                    border-radius:6px;padding:9px;font-size:15px;cursor:pointer;">开始生存！</button>
            <button id="wsl-tut-close" style="flex:1;background:#232c34;border:1px solid #4a5a66;color:#ccd;
                    border-radius:6px;padding:9px;font-size:15px;cursor:pointer;">关闭 (F1)</button>
        </div>
    </div>`;
}

export function isOpen() { return !!(el && el.isConnected); }

export function close() {
    if (el) { el.remove(); el = null; }
}

// v4.8 sv 传入首次流程：点「开始生存！」/「关闭」都标记当前世界已读（世界粒度），
// 保证"每个新世界只弹一次教程"；F1 手动打开（sv=null）不标记，不影响后续首次弹出。
function attach(host, sv) {
    el = document.createElement('div');
    el.id = 'wsl-tut';
    // v4.6 修复"F1 教程不居中"：此前挂到 #game-container（max-width:960px 非全屏）→ 教程受限偏移。
    // 改为挂到 document.body（真全屏视口），外层 fixed inset:0 + flex 居中 → 教程卡片始终屏幕中央。
    // 内层卡片用 width 固定（不再用 top50%+translate 偏移，直接 flex 居中更稳）。
    el.style.cssText = 'position:fixed;inset:0;z-index:950;background:rgba(5,10,8,0.85);display:flex;align-items:center;justify-content:center;padding:20px;';
    el.innerHTML = buildLayout();
    host.appendChild(el);
    const btn = el.querySelector('#wsl-tut-ok');
    if (btn) btn.addEventListener('click', () => {
        markTut(sv);   // v4.8 世界粒度标记（旧全局 KEY 不再写入）
        el.remove(); el = null;
    });
    // 2026-08-10 通用返回：关闭按钮（ESC）直接关闭。
    // v4.8 关闭也标记当前世界已读（用户主动关掉=已看过；F1 仍可随时再开，show() 不看标记）
    const closeBtn = el.querySelector('#wsl-tut-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { markTut(sv); close(); });
    // 2026-08-11 v2.99 右上角叉号：同关闭
    const closeX = el.querySelector('#wsl-tut-close-x');
    if (closeX) closeX.addEventListener('click', () => { markTut(sv); close(); });
}

// 首次进入时调用（startRun 里）。已看过则零开销返回。
export function showIfFirst(sv) {
    if (el && el.isConnected) return;
    if (seenTut(sv)) return;
    const host = (typeof document !== 'undefined') ? document.body : null;   // v4.6 挂 body 全屏居中
    if (!host) return;
    attach(host, sv);
}

// 2026-08-11 v2.99 新存档开场流程：等"荒野醒来"睁眼动画（_wake）结束后再弹新手教程。
// 文字在 _wake 的 prog>=0.82 时开始淡出、prog=1 完全消失 → delayMs 取唤醒总时长即可。
// 已看过（世界粒度）或调用时已打开 → 零开销返回。
export function showIfFirstAfterWake(sv, delayMs) {
    if (el && el.isConnected) return;
    if (seenTut(sv)) return;
    setTimeout(() => {
        // 延迟期间用户可能已手动关掉/打开过：避免重复
        if (el && el.isConnected) return;
        const host = (typeof document !== 'undefined') ? document.body : null;   // v4.6 挂 body 全屏居中
        if (!host) return;
        attach(host, sv);
    }, delayMs || 2500);
}

// 2026-08-10 随时打开教程（F1 键）：无论是否已看过都弹出
export function show() {
    if (el && el.isConnected) return;
    const host = (typeof document !== 'undefined') ? document.body : null;   // v4.6 挂 body 全屏居中
    if (!host) return;
    attach(host, null);   // F1 手动打开不标记已读
}

export function destroy() {
    if (el) { el.remove(); el = null; }
}
