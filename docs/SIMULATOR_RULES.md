# 离线模拟器规则与证据

本文描述 `hero-simulator` 当前可执行规则。这里的“已确认”只表示归档的线上编译产物或静态数据能直接证明公式，并不表示离线模拟器已经覆盖线上所有职业、技能和神器分支。

## 证据等级

| 等级 | 含义 |
|---|---|
| A（直接代码证据） | 2026-07-22 归档 bundle 中存在可读公式或明确分支，并有对应 Rust 精确断言 |
| B（代码 + 数据证据） | bundle 证明解释方式，归档 JSON 提供具体数值，并有对应 Rust 精确断言 |
| C（离线重建约定） | 为可复现、线程安全或兼容旧原型而引入；不能声称与线上逐次结果相同 |

## 规则表

| 规则 | Rust 实现 | 线上证据 | 置信度 | 测试 |
|---|---|---|---|---|
| 默认模拟 10,000 次 | 调用端默认值；核心接受显式 `iterations` | `HeroLineup-DP_2OddU.js` 的 `sp` 固定 `w=1e4` | A | 既有进度/确定性测试；fixture 显式 4096 以缩短 CI |
| 固定元素屏障 | 同元素值全额、`all` 元素半值；总值低于屏障 HP 时伤害 ×0.2 | bundle `zB`：匹配元素累加、`all * .5`、`MA>fA?.2:1` | A | `fixed_and_random_element_barriers_match_bundle_rules` |
| 随机元素屏障 | 分别汇总六元素，取最高值与 `barrierPower` 比较；未破盾伤害 ×0.2 | bundle `zB` 的 `HA==="rand"` 分支 | A | 同上 |
| 强制破盾 | `force` 直接视为已破，伤害倍率 1 | bundle `selectedElement==="force"` 分支 | A | 由 `resolve_element_barrier` 的无条件分支覆盖 |
| Rudo 屏障加成 | 元素汇总乘 `rudo_multiplier` 后向下取整 | bundle `Math.floor(... * rudoBarrierBonus)` | A | 固定/随机屏障函数采用同一顺序 |
| Booster | 攻击、防御为加法比例；暴击率与暴击倍率为加法 | `utils-B4Bv7ofN.js` 的 `Po` 从 `si_atk{level}` 读取；`zB` 将 `S.atk/S.def/S.crit/S.critMult` 加到队伍 | A（运算）/ C（调用方提供数值） | 黄金 fixture 精确覆盖；数值应由本地 qmodifiers 解析后传入 |
| 多环境修正合并 | `mHp/mDmg/mCrit/...` 围绕 1 做加法合并；回避直接相加 | `utils-B4Bv7ofN.js` 的 `Hn`、`Ln`、`xo` | A | `EnvironmentModifier::combine` 与黄金 fixture |
| 精英 Agile | 怪物回避 +0.4 | `qmodifiers.json.agile.mEva`，bundle `Hn` | B | `elite_presets_are_data_exact_for_supported_combat_fields` |
| 精英 Huge | 怪物 HP +100%，任务原始 AOE 几率 ×3 | `qmodifiers.json.huge.mHp=1, mAoeOdds=2`；bundle 将 `aoeChance × (1+mAoeOdds)` | B | 同上；桌面命令层 `elite_and_tower_area_modifiers_match_online_merge_formula` |
| 精英 Dire | 怪物 HP +50%，基础暴击率 ×4 | `dire.mHp=.5, mCrit=3`；bundle 计算 `critChanceMod=1+mCrit` | B | 同上 |
| 精英 Wealthy | 无战斗属性修正（仅奖励变化） | `wealthy` 战斗字段均为 0，loot/key/item level 改变 | B | 同上，断言空环境修正 |
| 精英 Epic | HP ×1.5、攻击 ×1.25、基础暴击率 ×1.5、回避 +0.1、任务原始 AOE 伤害 ×1.25 | `epic.mHp=.5, mDmg=.25, mCrit=.5, mEva=.1, mAoe=.25` | B | 同上；桌面命令层 AOE 合并精确断言 |
| 泰坦楼层 1–30 | 分段线性 HP/攻击/防御百分比 | `QuestSimulationUtils-CP7NK-IP.js` 的 `R` | A | `titan_floor_curve_has_exact_boundary_values` |
| 泰坦楼层 31–500 | HP `200+(层-31)*10`，攻击 `100+(层-31)*10`，防御 `40+(层-31)*2` | 同上；楼层由 `w` 限制 1..500 | A | 31 层精确断言 |
| 泰坦诅咒减免 | 三项楼层百分比乘 `1-clamp(reduction,0,1)` | 同文件 `J` 在应用怪物属性前缩减曲线 | A | 31 层 25% 减免精确断言 |
| 固定随机种子 | ChaCha8，以 `seed` 复现完整结果 | 线上使用 `Math.random`，没有 seed | C（刻意改进） | 既有确定性测试与 JSON 黄金 fixture |

## 高级回合规则（显式启用）

`AdvancedSimulationRequest` 在不改动旧 `SimulationRequest`、`RuleSimulationRequest`、`simulate` 和 `simulate_with_rules` 的前提下增加 `combatRules`。规则使用带 `kind` 的枚举，并通过 `fighterId` 绑定单位；战斗循环中没有散落的职业或勇士 ID 判断。

| 规则 | Rust 规则 | 线上证据 | 置信度 | 边界/回归测试 |
|---|---|---|---|---|
| `tdef` 普通伤害 | `DefenseThreshold`；防御 0→1×tdef 时 1.5→1，1→2 倍时 1→0.5，2→4 倍时 0.5→0.3，4→12 倍时 0.3→0.25，之后恒 0.25；最终 `round` | `utils-B4Bv7ofN.js` 的导出 `a1`（`Ro`），`HeroLineup-DP_2OddU.js` 以单位最终防御、怪物伤害、`t.tdef` 调用 | A | `tdef_formula_has_exact_segment_boundaries` 覆盖 0、1、2、4、12 倍和越界 |
| `tdef` 暴击伤害 | 防御 0→tdef 额外 1.5→1；其余为 1；怪物伤害 × 暴击倍率 × `(1+bonus)` 后 `round` | `utils-B4Bv7ofN.js` 导出 `a2`（`Vo`）及 bundle 调用点 | A | 同上覆盖 0、阈值和阈值+1 |
| 限时怪物攻击/暴击 | `TimedMonsterModifier` 仅在 `round <= duration` 生效；暴击为“永久修正后的暴击率 + 原始基础暴击率 × timedDelta” | `xo` 把带 `duration` 的 `mDmg/mCrit` 组为 timed bonuses；`Lo` 用 `round <= duration` 汇总；回合逻辑以原始 `eA` 作为 timed 基数 | A | `timed_damage_and_threat_boundaries_match_bundle_helpers` 精确断言 10% 基础、20% 永久、+50% timed = 25%；高级黄金 fixture |
| 每回合怪物增伤 | `MonsterDamagePerRound`：`(1 + delta × max(0, round-1)) × (1 + timedDelta)`，仅单体 | `Ho` 公式及回合日志“AOE 不受影响” | A | 同上精确断言第 1、3 回合 |
| AOE | `AreaAttack`：存活单位大于 1 时按概率触发；所有存活单位独立闪避；几率为任务值 × 合并后的 `aoeChanceMod`；伤害比例为任务 AOE 基数 × `aoeDmgMod` ÷ 永久修正并取整后的怪物攻击；最终普通预计算伤害 × 比例后 `ceil`，不暴击、不吃单体回合增伤 | `xo/Hn/Ln` 合并 `mAoeOdds/mAoe`；`zB` 计算 `PA=t.aoeChance*V.aoeChanceMod`、`$A=t.aoeDmgBase*V.aoeDmgMod/nA`；`Ap` 执行 AOE | A | 高级黄金 fixture；桌面命令层 Huge/Epic 精确公式断言 |
| 威胁目标 | `Threat`；仅汇总存活单位权重，生成与 bundle 逆向扫描一致的累计边界 | `zB` 的 `calculateTargetChances` 与 `Ap` 的反向目标扫描 | A | 权重 `[1,2,3]`、含死亡单位的精确边界断言 |
| 回合回复 | `Regeneration`；怪物存活时，单位存活才回复，封顶最大 HP | `Ap` 治疗阶段 `min(current+regen,maxHp)` | A | 高级黄金 fixture |
| Lord 挡刀 | `LordIntercept`；每场一次，非保护者受到致命伤时恢复本次伤害，保护者承受同额伤害 | `Ap` 的 AOE 与单体 `Lord拯救` 两个分支 | A | 高级确定性/黄金 fixture |
| Ninja 专注 | `OpeningFocus(recoverAfterRounds=null)`；暴击/闪避加成在首次实际受伤后永久失效 | 初始化 `fighterNinjaBonus/Evasion` 与 `Ninja技能失效` 分支 | A（状态）/ B（数值由本地技能数据传入） | 高级黄金 fixture |
| Sensei 专注 | `OpeningFocus(recoverAfterRounds=2)`；受伤失效，两回合后恢复 | 回合开头 `lostRound === round-2` 恢复及受伤失效分支 | A（状态）/ B（数值由本地技能数据传入） | 高级黄金 fixture |
| Berserker/Jarl 阶段 | `BerserkerStages`；三个 HP 阈值映射 0/1/2/3 阶段，攻防分别按阶段倍增 | `dmgBuf` 三阈值解析、`fighterBerserkerStage` 更新及攻击/闪避加成 | A（状态/运算）/ B（数值由技能 JSON 传入） | `berserker_stage_thresholds_are_inclusive_like_the_bundle` 覆盖每个阈值两侧 |

高级模型采用线上可证实的“怪物阶段 → 单位攻击阶段 → 治疗阶段”顺序。未传 `DefenseThreshold` 时，为兼容旧调用仍使用原型的通用防御公式；未传任一高级规则时也不会根据字符串 ID 猜测职业。

## 运算顺序

`simulate_with_rules` 使用如下顺序，顺序本身属于离线实现契约：

1. 对队员应用 Booster。
2. 将任务环境与精英环境相加后应用到怪物。
3. 对环境修正后的怪物应用泰坦楼层曲线。
4. 解析一次元素屏障，得到整场队伍伤害倍率。
5. 使用固定种子的 Rust Monte Carlo 核心执行模拟。

线上 bundle 同样在进入回合循环前构造这些值，但其完整构造过程还包含职业、勇士、技能、神器和泰坦词条分支；因此第 1–4 步的局部公式可对照，整个战斗结果不可宣称线上等价。

## 黄金 fixture

`tests/golden/public-preview-jurassic04.json` 使用归档公开预览中的 `jurassic04`、领主和术士 ID，固定了离线输入与精确输出。来源字段明确区分了：

- ID 与场景形状来自 `reference/api-samples/public-preview.json`；
- 数值输入是重建测试数据；
- 期望值只锁定当前 Rust 可复现实现，不是线上历史结果的翻录。

`tests/golden/advanced-combat-rules.json` 另行锁定 tdef、timed/per-round、AOE、威胁、回血、Lord、Focus 和 Berserker 的组合行为。其 `source` 指向归档 bundle/helper，固定结果仍然只证明 Rust 重建的确定性；辅助程序 `cargo run -p hero-simulator --example print_advanced_golden` 可打印待人工审阅的新输出。

如果有意修改 PRNG、舍入、修正顺序或战斗公式，必须人工审阅 fixture 差异，并同步更新本文和 `KNOWN_DIFFERENCES.md`。
