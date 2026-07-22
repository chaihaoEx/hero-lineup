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
| 配装剪贴板格式为 JSON → encodeURIComponent → Base64 | `equipmentUtils-De9hjtPc.js` | 已确认 |
| 热门体系通过 `/api/hero-lineup/systems/hot` 获取，并在浏览器端解密 envelope | `HeroLineup-DP_2OddU.js`、`index-Dd1Wm_Jg.js` | 已确认 |
| 热门体系预览使用 `/systems/preview/{shortCode}` | `gameProfileHeroParser-CHtOPCtb.js` | 已确认 |
| 任务模拟默认循环 10,000 次，并约每 5% 报进度 | `HeroLineup-DP_2OddU.js` | 已确认 |
| 旧模拟器使用浏览器随机数，未提供固定随机种子 | `HeroLineup-DP_2OddU.js` | 已确认 |
| 排行结果会 POST 到 hero/titan leaderboard API | `HeroLineup-DP_2OddU.js` | 已确认 |
| 页面进入时调用工具访问统计 hook，入口包含 Socket.IO | `useToolVisit-D4381d2l.js`、`socket-BLRFddlS.js` | 已确认 |

## 重建约束

- 新应用不得调用 CDN helper、排行榜、访问统计或 Socket.IO。
- 旧 bundle 只能用于提取行为和黄金样本，不得作为最终运行代码。
- 模拟器重建应把 10,000 次循环移到 Rust 后台任务，并增加可复现随机种子。
- 所有从 bundle 逆向的规则应在 Rust 源码中用业务名称重写并由测试证明，不能直接复制混淆变量结构。

