# 线上资源保全清单

保全日期：2026-07-22（UTC 响应时间约 03:29–03:39）  
目标页面：`https://cq-zys.cn/hero-lineup`

本目录只用于逆向、行为对照和审计，不得由最终离线应用加载。最终运行资源仅位于 `content/`。

## 已归档内容

### 页面和编译产物

- `reference/online-snapshots/2026-07-22/hero-lineup.html`：入口 HTML。
- `reference/online-snapshots/2026-07-22/assets/index-Dd1Wm_Jg.js`：当前站点入口 bundle。
- `HeroLineup-DP_2OddU.js`：当前英雄体系路由 bundle。
- 23 个该路由实际预加载或静态导入的 JS 依赖，包括数据加载、配装计算、任务计算、地图选择、结果详情、React/UI/router/vendor 模块。
- `index-pbhplzNs.css`、`logo.svg`。
- 每个入口、bundle、CSS、JSON 的原始 HTTP 响应头保存在 `online-snapshots/2026-07-22/http/`。

未下载入口 bundle 中列出的其他站点路由（文章、聊天室、隐私页等），因为它们不是 `/hero-lineup` 正常运行依赖。入口文件仍保留这些动态 import 名称，因此该参考快照不是整个网站的镜像。

### 游戏数据

`content/TextAsset/` 中有 12 个经过 JSON 解析验证的数据文件：

| 文件 | 记录数 | 字节数 | 线上原路径 |
|---|---:|---:|---|
| classes.json | 42 | 51,471 | `/assets/TextAsset/classes.json` |
| heroes.json | 15 | 25,036 | `/assets/TextAsset/heroes.json` |
| quests.json | 391 | 852,831 | `/assets/TextAsset/quests.json` |
| items.json | 1,660 | 4,760,086 | `/assets/TextAsset/items.json` |
| skills.json | 544 | 802,476 | `/assets/TextAsset/skills.json` |
| levels.json | 50 | 4,764 | `/assets/TextAsset/levels.json` |
| qmodifiers.json | 141 | 164,332 | `/assets/TextAsset/qmodifiers.json` |
| texts_zh.json | 22,778 | 1,611,737 | `/assets/TextAsset/texts_zh.json` |
| chestodds.json | 21 | 34,105 | `/assets/TextAsset/chestodds.json` |
| skillTreeNodes.json | 878 | 818,929 | `/assets/TextAsset/skillTreeNodes.json` |
| skillTreePoints.json | 50 | 6,904 | `/assets/TextAsset/skillTreePoints.json` |
| items_type_dict.json | 43 | 1,348 | `/assets/items/items_type_dict.json` |

注意：`items_type_dict.json` 的线上路径不在 `TextAsset` 下；离线内容包已将它统一放入 `TextAsset`。线上 CDN 错误地把除少数文件以外的 JSON 声明为 `Content-Type: image/png`，但文件体均为有效 JSON。

### Sprite

- 候选数：2,315。
- 成功下载并纳入当前内容包：2,276 张 PNG。
- Sprite 总字节：15,041,872。
- 完整候选：`sprite-candidates.txt`。
- 每个请求的结果、状态、Content-Type、字节数和最终 CDN 地址：`sprite-downloads.tsv`。
- 失败及证据分类：`sprite-missing.tsv`。

候选集合是有限推导，不是目录枚举：

1. 核心 bundle 中出现的 PNG 字面量；
2. `items.json` 的 1,660 个 UID（bundle 的装备图 helper 为 `{uid}.png`）；
3. 职业 UID 的 128 图和 fallback 图；
4. 勇士 UID、勇士技能；
5. 任务 family 的地图小图和 boss 图；
6. 技能 family、装备技能；
7. 元素、装备类型、品质和泰坦塔词条图标。

63 个失败候选分类如下：

| 分类 | 数量 | 说明 |
|---|---:|---|
| 字符串模板误报 | 4 | `_128.png`、`_big.png`、`_boss.png`、`_small.png`，不是实际路径 |
| bundle 明确引用或数据可寻址 | 22 | 包括线上本身缺失的随机屏障图标、若干技能族；头像字面量实际属于 `/assets/avatars/`，不是 Sprite |
| 由任务 family 等有限推断、但未证明运行时会访问 | 37 | 多数是非地图事件 family 被统一规则扩展出的 `*_boss`/questarea 候选 |

因此，成功数并不表示线上存在 2,315 张目标资源；缺失项也不应通过无限命名猜测补齐。实际重建时应结合 UI 流程测试决定是否提供本地占位图。完整逐项结论见 `sprite-missing.tsv`。

### API 样本

`reference/api-samples/` 包含：

- 热门体系第 1 页的 AES-GCM envelope 原始响应；
- 使用当前公开 bundle 中客户端解密逻辑得到的同页 JSON，仅用于结构研究；
- 一个热门体系的公开 preview 完整响应；
- `/systems` 未登录 401 响应；
- hero template 缺参数响应；
- `heroClass=knight` 的空模板成功响应；
- 对应 HTTP 响应头。

公开 preview 样本证明体系当前包含 `groups`、`heroes`、`champions`、`adventureTasks`、`heroEquipment`、`championEquipment`，同时也会泄露 Mongo `_id` 等服务端字段。不要把 reference 样本直接作为最终内置示例或用户初始数据。

## 视觉基准状态

要求的 1440×900 PNG 截图仍未能在本次执行环境中取得。第一次保全时没有可用浏览器；
第二次（2026-07-22）已由内置浏览器成功打开页面、设为 1440×900、关闭协议遮罩并读取完整
可见 DOM，确认主体顺序为体系管理、15 位勇士、英雄阵容、冒险任务，但两次
`Page.captureScreenshot` 均在浏览器后端超时。按照浏览器控制约束，没有改用不受支持的后端。

替代证据已保全：

- 当前入口 HTML；
- 完整站点 CSS；
- hero-lineup 路由 bundle 与 UI 依赖；
- 所有成功解析到的本地图片资源。

后续在有浏览器会话的环境中应补拍至少 `1440×900`、`1280×800`、`1024×768` 三档主体截图，并记录登录状态、页面滚动位置和数据时间戳。

## 完整性

- `content/manifest.json` 对最终内容包中的每个数据、Sprite、默认数据和 schema 记录路径、字节数和 SHA-256。
- `reference/SHA256SUMS` 覆盖 reference 下除自身以外的所有归档文件。
- 所有 JSON 均通过 `jq empty`。
- `content/` 不含任何用于加载资源的远程 URL，最终应用不需要 reference 目录。上游 `texts_zh.json` 原文内有两条中国区用户协议/隐私政策的展示文本 URL；它们是保真的游戏文本字段，不是图片、数据或代码加载依赖，离线 UI 不应把它们实现为自动网络请求。

## 已知限制

- 线上没有 source map，因此只能保存压缩 bundle 和行为证据，不能还原原始组件边界或 TypeScript 类型。
- Sprite 服务没有公开索引；清单来自可解释的有限推导，不能证明 CDN 上所有游戏资源都已镜像。
- 当前 bundle 会变化，哈希文件名和规则只能代表 2026-07-22 快照。
- `gameDataVersion` 没有由线上数据公开提供，因此内容包使用 `web-snapshot-2026-07-22`，不是官方游戏版本号。
