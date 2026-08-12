# NPC 生态 · Agent 记忆

> 所属记忆库：`docs/记忆库/`｜主索引：[`../../AGENTS.md §14`](../../AGENTS.md)
> 相关模块：`mod-wasteland/wnpc.js`（全项目最大模块，173KB）

---

## 一、领域概述

NPC 生态是荒原模组的社会层：AI 状态机、队伍/雇佣/交易、属性成长、营地生育、动画复用玩家、室内外统一、招募跟随。玩家/队伍主控 = `sv.controllerId`，原主角记录 id='player' 也在 `sv.npcs` 中，`controlledNpc()` 查询。

---

## 二、核心技术

| 技术 | 说明 |
|---|---|
| **统一名册** | 玩家/队伍主控 = `sv.controllerId`，`controlledNpc()` 查询 |
| **AI 状态机** | `updateNpc` → `campOrWanderAI`（阵营/游荡）、`followAI`（跟随自主战斗）、`hostileAI`（恶意攻击）、`combatThreat`（复杂战斗索敌/走位/射击） |
| **生命体征** | 体力（`NPC_STAM_*`）、感染值（与玩家一致）、疾病（`cureSick`）、饥饿/缺水掉血（最低 1 血）、属性成长（`applyPersonStats` / `ageNpcs`） |
| **物品共享** | `npcShareWithMates`（食物/药品/弹药互通，含保留底线 `DOWNED_SHARE_AMMO_KEEP`） |
| **动画复用玩家** | AI 侧 sticky 标记 `_moving` + 朝向，渲染复用玩家走动精灵 |
| **刷新规则** | 出生点/营地不刷 NPC；野外 `Math.random() < B.WILD_NPC_DAILY_CHANCE`（0.002，12~30 格外）；营地生育保留；室内躲藏者按楼层概率 |

---

## 三、关键代码改动

| 位置 | 改动内容 |
|---|---|
| `wnpc.js:makeNpc` / `makePlayerEntry` / `initRoster` | NPC 生成与主控角色结构（attrs/congenital/talent/look） |
| `wnpc.js:updateNpcs` | 主循环 + **controllerId 悬空回退**（主控被击杀帧边界移除后，回退到 isPlayer 存活记录，否则清空） |
| `wnpc.js:syncRecordToControlled` | 恶意 NPC 可击败玩家修复（不覆盖 sv.hp，见 [战斗领域](战斗、僵尸与感染.md)） |
| `wnpc.js:updateNeeds` / `eatFromInv` / `drinkFromInv` | 饱食/水分/耐力/感染（缺字段防御 P1-6） |
| `wnpc.js:hireNpc` / `settleHires` / `HIRE_FEES` / `switchControl` / `onControlledDeath` | 雇佣/招募/切换操控 |
| `wnpc.js:startDriveOrder` / `driveDriverAI` / `pickDriveTarget` | **NPC 驾驶订单**（NPC 当司机送玩家去目标区域） |
| `wnpc.js:leadControllerToCar` | 主控归队上车 |
| `wnpc.js:ageNpcs` | 营地生育（camp 内 adult 夫妇按概率生 baby，`baby.maxHp=80*stage.hpMul`，无武器）+ 野外刷新 |
| `wnpc.js:killNpc` / `npcApplyDownedHit` / `maybeWound` / `maybeInfectNpc` | NPC 死亡/濒死/受伤/感染 |
| `wnpc.js:updateNpcBullets` | NPC 子弹（恶意火力可打玩家） |
| `survival.js` / `windoor.js` | 室内外 NPC 统一（招募/雇佣室内躲藏者，跟随进出室内外，见 [室内系统](室内系统.md)） |

---

## 四、涉及模块与依赖

```
wnpc → wpath(NPC流场) · wgrade · wbalance · panel(背包) · survival(主控) · windoor(室内)
wnpc ↔ wgear（环依赖区，勿新增环边）
survival.js → makePlayerEntry 主控组装
```

---

## 五、验证方式

| 场景 | 命令/做法 |
|---|---|
| 改任意系统模块 | `node dev-tools/module-matrix-test.mjs`（380 断言） |
| 改游玩流程（交易/队员/战斗） | `node dev-tools/playtest-matrix.mjs`（408 断言） |
| 改 NPC 数值 | `smoke-test.js` 数值断言 + 受影响系统回归 |
| 改 wstate（NPC 序列化字段） | smoke + full-run（AGENTS.md §4） |

---

## 六、历史教训

1. **动画复用玩家的 sticky 标记**：远离玩家 NPC 每 0.3s 才 moveToward 一跳，用位移判移动会导致「平移/只在出生闪一下」；8/9 改用 `_moving` sticky 标记 + 现实时间推进帧（10fps）。
2. **controllerId 悬空回退链**：主控被击杀后必须回退到存活 isPlayer 记录，否则队伍空转；改 `updateNpcs` 的切换逻辑要保护这条回退链。
3. **营地生育 ≠ 野外刷新**：8/9 移除「营地每日来新居民」，保留营地生育；野外刷新避开出生点屏幕（`nearSpawnScreen`）。
4. **NPC 队伍本地管理**：联机 wsync 不带 npcs 防主控覆盖；guest 操控 NPC 用 `npcctl` 事件（AGENTS.md §6 教训 4）。
5. **缺字段防御**：NPC 生命体征/物品共享相关逻辑缺字段会崩溃，已加防御（P1-6），改动勿移除。
