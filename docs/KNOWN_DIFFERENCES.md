# 与线上模拟器的已知差异

基准证据为 `reference/online-snapshots/2026-07-22/`，不是游戏服务端源码。以下差异必须保留在发布说明中，直到有对照样本或新证据关闭。

属性面板的完整证据、API 与边界见 `CATALOG_CALCULATION.md`。线上星能铸造和超越均为布尔开关；勇士 `seed` 与勇士之魂、英雄泰坦之塔/墓预览均已成为正式持久化字段并进入计算。仍有两项明确边界：特殊神器/职业硬编码尚未全部移植；未来数据包的非空 `items.restrict` 暂按本地允许列表约定解释。

| 差异 | 当前离线行为 | 线上证据/行为 | 影响 |
|---|---|---|---|
| 随机数 | ChaCha8 + 用户可记录的固定 seed | `Math.random`，无固定 seed | 离线结果可复现，但逐次序列不可能与线上相同 |
| 战斗模型覆盖 | 高级 API 已覆盖 tdef、timed/per-round、AOE、威胁、普通回复、Lord、Ninja/Sensei 专注和 Berserker 阶段；桌面入口已按 questId 装配任务基础属性、tdef 和 AOE | bundle 还包含存活概率、Timekeeper、Chronomancer、Hemma、Rudo 攻击时效、连续暴击、首回合职业、神器等组合分支 | 已不再使用固定演示怪物，但仍不得标注“与线上完全一致” |
| 元素屏障生命周期 | 开战前解析为整场固定伤害倍率 | 线上同样先解析屏障倍率，但完整回合代码可能与更多技能状态交互 | 局部公式已证实，组合效果尚未完全覆盖 |
| Booster 数值解析 | 已实现无、威力、超级威力、特级威力四档；精确映射攻防 +20/40/80%、暴击 +10/15/30%，特级额外暴伤 +50% | 线上按 `si_atk1..3` 从 qmodifiers 取值；Timekeeper 重试还可能补足一级 Booster | 单次任务等级与数值已一致；Timekeeper 第二次尝试仍有差异 |
| 精英 Huge/Epic AOE | 任务自身 AOE 已由桌面层装配；精英枚举自动映射 HP/攻击/暴击/回避字段 | Huge 还有 `mAoeOdds=2`，Epic 还有 `mAoe=.25` | 精英附加 AOE 尚未与任务 AOE合并 |
| Wealthy 奖励 | 战斗无修正，不计算奖励 | 线上数据调整 loot、key 和物品等级 | 战斗判断不受影响，奖励估算缺失 |
| 环境持续时间 | 高级 API 支持 `TimedMonsterModifier` 与 `MonsterDamagePerRound`；基础 API 仍把环境作为永久修正 | bundle 从 qmodifier 自动解析 duration、`mDmgPerRound` | 桌面装配层尚未自动生成高级规则时仍有偏差 |
| 泰坦塔词条 | 已支持楼层曲线与统一 reduction | 线上还逐条处理英雄职业修正、屏障额外值、怪物 AOE、回复、禁元素等 qmodifier 字段 | 仅楼层基础修正可认为公式一致 |
| 敌人防御公式 | 桌面按任务 `tdef` 传入 `DefenseThreshold`，高级 API 使用已确认的普通/暴击多段公式 | 线上使用 `tdef` 阈值及多段函数 | 本地任务目录覆盖该路径；外部直接调用旧 API 时仍是通用公式 |
| AOE 伤害输入 | 桌面把任务 `aoe/dmg` 归一化为 `damageRatio`，并传入 `aoeOdds` | 线上还会把环境/精英 `aoeModifier` 合并后再除以修正后的怪物伤害 | 没有额外 AOE 修正时路径一致；组合修正仍可能偏差 |
| 暴击 timed 基准 | 高级规则以环境处理后的暴击率乘 `(1+timedDelta)` | 线上使用原始基础暴击率乘 timed delta，再加永久修正后的基础值 | 同时存在永久暴击修正和 timed 暴击时可能有差异；需扩展敌人输入以携带原始暴击率后才能关闭 |
| Lord 的幸存概率交互 | 已实现每场一次同额挡刀；未实现 protector 挡刀后再次触发幸存概率 | 线上 Lord 自身被挡刀伤害击杀后仍执行一次幸存概率判定 | 没有幸存词条时等价；有幸存词条时偏差 |
| Ninja/Sensei 数值装配 | 通用 `OpeningFocus` 由调用方提供数值及恢复回合 | 线上按职业 innate + `min(skillLevel,4)` 从 skills JSON 读取 | 状态机已证实，桌面层尚需完成数据映射 |
| Berserker/Jarl 数值装配 | 通用 `BerserkerStages` 由调用方提供阈值与每阶段加成 | 线上从 `dmgBuf/atkBuf/evaBuf` 解析 | 状态和边界已覆盖，桌面层尚需完成数据映射 |
| Timekeeper/Chronomancer | 未实现失败后的第二次任务 | `sp` 检测队伍职业；失败时 Chronomancer 原配置重试，Timekeeper 以 `addMinBooster` 重试 | 这是跨单次战斗的重试/聚合语义，需先确认第二次结果如何计入所有统计字段 |
| Hemma | 未实现吸血、固定回血与累计攻击增益 | bundle 选择 HP 百分比最高且超过阈值的其他英雄，扣最大 HP 比例、Hemma 固定回血并累加攻击；盗贼帽使扣血为 0 | 与英雄/勇士范围、神器免疫、Sensei 失效联动复杂，现阶段不猜测缺失边界 |
| Rudo | 已有屏障倍率；未实现限时全队暴击加成 | bundle 按 `rudoleader{level}` 提供 `critical/barrierPowerMult/duration`，到期清零暴击加成 | 数值可提取，但需要调用方可靠区分勇士数据和技能等级后再接入 |
| 数值舍入 | 属性乘数后 `round`；屏障 Rudo 后 `floor` | 线上不同路径混用 `round/floor` | 已证实路径保持一致，未覆盖路径不保证一致 |
| 黄金样本性质 | 固定输入/seed 锁定离线回归 | 公开预览只保存线上聚合结果，且线上无 seed | fixture 是离线黄金测试，不是线上同值校验 |

## 关闭差异的证据要求

关闭一项差异至少需要以下一种证据：

1. 从归档 bundle 提取到完整、可读的公式，并为边界值建立精确断言；或
2. 获得可重复的线上输入/输出对照样本，记录数据版本和所有配置；或
3. 获得原开发团队的规则说明或源码，并确认授权可用于重建。

仅凭 UI 文案、单次成功率接近或经验判断，不足以宣称等价。
