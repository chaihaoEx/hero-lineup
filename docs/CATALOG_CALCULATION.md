# 本地属性计算与装备校验

`crates/hero-catalog` 是桌面端可直接调用的、无网络依赖的本地数据层。入口为：

- `Catalog::load(content_root)`：读取 `TextAsset/classes.json`、`heroes.json`、`items.json`、`skills.json`、`levels.json`；
- `calculate_hero(&HeroBuild)` / `calculate_champion(&ChampionBuild)`：返回可序列化的 `CalculatedSheet { stats, issues, applied }`；
- `validate_hero_equipment` / `validate_champion_loadout`：只运行合法性校验。

## 已按归档网页实现

规则证据来自 `reference/online-snapshots/2026-07-22/assets/utils-B4Bv7ofN.js` 与 `equipmentUtils-De9hjtPc.js`：

1. 英雄与勇士 1–40 级四段加权成长，以及 41–50 级线性插值；
2. 勇士 `upg01..upg11` 阶级成长和元素值阶梯；
3. 品质倍率：普通 1、精良 1.25、无瑕 1.5、史诗 2、传说 3；
4. 装备 `atk/def/hp/eva/crit`、元素/精魂核心封顶、亲和 1.5 倍；
5. `upgradeShiny*` 与 `supgrade4..6` 中可证实的 `baseStats*`、`atk+`、`def+`、`hp+`、`eva+`、`crit+` 表达式；
6. 英雄与勇士种子（HP +1，攻击/防御 +4）、收藏卡 0/5%/10%/25%；网页单一“种子数量”会同时写入 HP/攻击/防御，领域 `seed` 因此按相同方式处理，英雄非空 `seed_points` 对对应属性进行覆盖；
7. 职业 innate 与已选择技能的通用核心属性、装备类型加成；
8. 六槽固定映射：武器、身体、手、头、脚、饰品；勇士使用随从与光环两槽。
9. 墓生灵精萃的本装备全属性倍率，以及“泰坦之塔/墓”场景下倍率翻倍。

校验覆盖：重复槽、非六槽装备、缺失装备/元素/精魂 ID、职业槽位代码、装备等级、`levels.json` 的可用阶数、`restrict`、勇士槽位与 `xf`/`xx` 类型。

黄金测试 `crates/hero-catalog/tests/fixtures/sheets.json` 使用真实本地数据，固定了 40 级骑士六件套和阿尔贡随从/光环配装结果。

## 明确约定和边界

- 当前 `items.json` 的 `restrict` 均为空。为支持后续数据包，非空值按逗号分隔的职业 ID、职业大类或 `*` 允许列表解释；这是本地数据维护约定，不宣称已由线上样本证明。
- 在线编辑器只暴露星能铸造布尔开关，不存在独立 `shinyLevel` 输入；领域 `shiny` 与在线交互一致。内部五阶段数据只用于求得开关开启后的完整倍率。
- 装备内置 `lTag2` / `lTag3` 无需写入英雄配置即自动作为元素/精萃附魔生效，并视为 1.5 倍亲和；批量附魔不得覆盖它们。真实数据金样本：传奇 `forestdagger` 为 `+114` 攻击，开启超越为 `+135` 攻击与 `+2%` 回避。
- T16 星能/超越线上金样本：普通 `t16sword` 为 `+1420` 攻击；星能为 `+1775`；星能与超越同时开启为 `+2109` 攻击、`+154` 防御，证明两种基础属性倍率按增量相加后统一取整。
- 英雄晋升由具体职业 ID（例如 `lord`）表达；领域中的历史字段 `HeroBuild.titan` 现在对应编辑器“泰坦之塔/墓”属性预览，不代表职业晋升。
- `ChampionBuild.seed` 与历史字段 `titan` 均持久化；其中 `titan` 对应在线“勇士之魂”。阶级、等级、卡片及两个完整装备槽可计算。
- 已实现技能 JSON 中通用的核心属性和物品类型加成；神器互斥、个别职业硬编码、XP 转攻击、怪物家族和任务环境效果属于战斗/特殊规则层，未伪装为普通面板属性。
- `card_levels` 的逐技能语义在现有离线领域模型与网页单一 `cardLevel` 之间没有可靠映射；面板采用 `card_level`。

所有不合法主装备都会从属性汇总中排除，并在 `issues` 中给出稳定代码；调用端无需解析中文消息。
