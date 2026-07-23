# 线上实现规则证据

本文件记录从 2026-07-22 编译产物中可直接确认的实现事实。所有路径均指向 `reference/online-snapshots/2026-07-22/assets/`；这些文件只作研究证据，不进入离线应用运行路径。

| 事实 | 证据文件 | 置信度 |
|---|---|---|
| 页面是 React/Vite 动态路由，hero-lineup 独立分包 | `index-Dd1Wm_Jg.js`、`HeroLineup-DP_2OddU.js` | 已确认 |
| JSON loader 使用 `/assets/TextAsset`，Sprite 使用 `/assets/Sprite` | `DataLoaders-BrjKz_PL.js` | 已确认 |
| `items_type_dict.json` 位于 `/assets/items/` | `HeroLineup-DP_2OddU.js` | 已确认 |
| 图片 URL helper 会把相对资源改写到 CDN | `config-__ypmKxa.js` | 已确认 |
| 职业图命名为 `icon_global_class_{uid}_128.png`，失败后尝试无 `_128` 版本 | `HeroLineup-DP_2OddU.js` | 已确认 |
| 勇士图命名为 `icon_global_{uid}.png` | `config-__ypmKxa.js` | 已确认 |
| 装备主图命名为 `{itemUid}.png` | `equipmentUtils-De9hjtPc.js`、`HeroLineup-DP_2OddU.js` | 已确认 |
| 技能图主要按 `icon_global_skill_{family}.png` 寻址 | `equipmentUtils-De9hjtPc.js`、`HeroLineup-DP_2OddU.js` | 已确认 |
| 英雄排序默认按职业目录；元素排序固定为 `light,dark,fire,water,earth,air,all`，再按职业目录和英雄名 | `HeroLineup-DP_2OddU.js` 中 `Hs` / `qm`；`online-element-sort-2026-07-23.png` 黑盒样本 | 已确认 |
| 勇士和英雄主阵容图标左上角均叠加独立元素图片徽章，卡片下方只显示名称 | `HeroLineup-DP_2OddU.js`；`online-element-sort-2026-07-23.png` | 已确认 |
| 配装剪贴板格式为 JSON → encodeURIComponent → Base64 | `equipmentUtils-De9hjtPc.js` | 已确认 |
| 热门体系通过 `/api/hero-lineup/systems/hot` 获取，并在浏览器端解密 envelope | `HeroLineup-DP_2OddU.js`、`index-Dd1Wm_Jg.js` | 已确认 |
| 热门体系预览使用 `/systems/preview/{shortCode}` | `gameProfileHeroParser-CHtOPCtb.js` | 已确认 |
| 任务模拟默认循环 10,000 次，并约每 5% 报进度 | `HeroLineup-DP_2OddU.js` | 已确认 |
| 每个任务最多允许一名勇士；已有勇士时成员目录不再渲染任何其他勇士，但英雄仍可加入 | `HeroLineup-DP_2OddU.js` 中 `e.champions.length===0`；2026-07-23 在线黑盒双成员样本 | 已确认 |
| 成员目录默认仅排除同一分组其他任务已上阵的成员；“全部成员”开关写入 `heroLineup_taskMemberPickerAllMembers`，跨弹窗保留 | `HeroLineup-DP_2OddU.js` 中 `QB` / `BB` / `pB` | 已确认 |
| 成员目录宽度上限 672px；列数为 `<1024:4`、`1024–1279:5`、`≥1280:6`；头像元素角标是左上角独立图片，分别为 16/20/24px | `HeroLineup-DP_2OddU.js` 中 `QB`；`online-member-picker-1280x720-2026-07-23.png` | 已确认 |
| 我的体系卡片列数为 `<768:2`、`768–1023:3`、`≥1024:4`；仅体系数大于 1 时显示卡片右上角删除按钮 | `HeroLineup-DP_2OddU.js` 中体系管理组件 | 已确认 |
| 保存按钮始终显示“保存当前体系”；删除确认文案为“删除这个阵容体系吗？此操作不可恢复。” | `HeroLineup-DP_2OddU.js` 中体系管理组件；2026-07-23 黑盒操作 | 已确认 |
| 装备需求按主装备、元素附魔、精萃附魔分组，分组键为 `category_itemId_quality`；附魔继承所在槽品质 | `HeroLineup-DP_2OddU.js` 中 `GB` / `U` 聚合函数 | 已确认 |
| 装备需求排序为类别、品质降序、阶数降序、中文名；桌面四列、移动端两列，空状态为“暂无装备需求” | `HeroLineup-DP_2OddU.js` 中 `GB` 的排序比较器与响应式分支 | 已确认 |
| “已有”库存键只包含 `itemId_quality`；允许暂时清空，非空值向下取整并限制为非负；修改仅在关闭弹窗时回写体系 | `HeroLineup-DP_2OddU.js` 中 `m` / `F` / `C` / `H` | 已确认 |
| 任务地图选择固定四页签；普通冒险、黄金城、快闪先选地图再选难度，泰坦塔先选楼层再选六种变体 | `MapSelectionModal-BM74KMOZ.js`；2026-07-23 在线黑盒操作 | 已确认 |
| 普通非 Boss 冒险可显示精英怪，普通任务存在候选屏障时显示元素屏障；黄金城、泰坦塔、快闪基础状态不显示精英怪/屏障，也没有额外“泰坦塔”复选框；泰坦任务按 `miniboss` 显示词条入口，经验转攻击神器会额外激活经验强化与三项经验开关 | `HeroLineup-DP_2OddU.js` 的 `Un`、`Kn`、`jn`、`gt` 与任务选项组件；2026-07-23 逐类黑盒操作 | 已确认 |
| 泰坦词条来自 `qmodifiers` 中 `isTower=true` 且 provider 为 miniboss 的记录；上限来自任务 `miniboss`，同 family 互斥；泰坦之墓额外支持 1–100 层与三档祝福灯笼 | `utils-B4Bv7ofN.js` 的 `ut/kn/yn/go/Sn`；`HeroLineup-DP_2OddU.js` 的词条与 Booster 模态 | 已确认 |
| 切换地图保留已选强化道具，但重置精英怪为“无”、清空屏障选择和旧模拟结果 | `HeroLineup-DP_2OddU.js` 的任务选择回调；2026-07-23 普通→黄金城→普通黑盒操作 | 已确认 |
| 模拟详情打开后自动以 2× 像素比准备图片；准备失败提示“图片准备失败，请关闭后重试”，复制失败提示“复制失败，请使用下载功能”，移动端不显示复制按钮 | `QuestSimulationDetailModal-CBZ7rik_.js` | 已确认 |
| 旧模拟器使用浏览器随机数，未提供固定随机种子 | `HeroLineup-DP_2OddU.js` | 已确认 |
| 排行结果会 POST 到 hero/titan leaderboard API | `HeroLineup-DP_2OddU.js` | 已确认 |
| 页面进入时调用工具访问统计 hook，入口包含 Socket.IO | `useToolVisit-D4381d2l.js`、`socket-BLRFddlS.js` | 已确认 |

## 重建约束

- 新应用不得调用 CDN helper、排行榜、访问统计或 Socket.IO。
- 旧 bundle 只能用于提取行为和黄金样本，不得作为最终运行代码。
- 模拟器重建应把 10,000 次循环移到 Rust 后台任务，并增加可复现随机种子。
- 所有从 bundle 逆向的规则应在 Rust 源码中用业务名称重写并由测试证明，不能直接复制混淆变量结构。
