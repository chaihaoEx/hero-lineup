# 在线页面与离线桌面 UI 对照

基准日期：2026-07-23。在线截图在关闭用户协议和公告弹窗后，通过 1440×900 Chromium 视口取得；本地截图由正式 React 源码在完全阻断远程请求的 Playwright 流程中生成。

| 基准 | 文件 |
| --- | --- |
| 在线页面 1440×900 | `reference/screenshots/online-1440x900-2026-07-22.png` |
| 离线桌面 1440×900 | `reference/screenshots/local-1440x900.png` |
| 离线桌面 1280×800 | `reference/screenshots/local-1280x800.png` |
| 离线桌面 1024×768 | `reference/screenshots/local-1024x768.png` |
| 离线窄布局（请求 390，应用最小内容宽 760） | `reference/screenshots/local-narrow-390x844.png` |
| 离线 Retina 1440×900 @2× | `reference/screenshots/local-retina-1440x900@2x.png` |
| 离线新增体系弹窗 1440×900 | `reference/screenshots/local-system-create-1440x900.png` |
| 离线本地收藏 1440×900 | `reference/screenshots/local-collection-1440x900.png` |
| 离线冒险任务卡 1440×900 | `reference/screenshots/local-adventure-card-1440x900.png` |
| 离线强化道具弹窗 1440×900 | `reference/screenshots/local-booster-picker-1440x900.png` |

保留的视觉语言包括线上字体栈 `Inter, PingFang SC, Helvetica Neue, Arial, sans-serif`、蓝紫主色、浅灰蓝画布、白色圆角卡片、柔和阴影、彩色主按钮、分组标题、装备弹窗层级，以及体系管理→勇士→英雄→冒险任务的纵向功能顺序。离线版现已沿用线上纵向长页和顶部锚点导航；本地体系管理、导入口令、导出口令作为桌面能力集中放在页首。线上“热门体系”在离线端对应可搜索的“本地收藏”，新增与使用流程保持一致，但不访问网络。

装备编辑继续采用线上同类的大尺寸遮罩弹窗：顶部为星能铸造、超越、品质和搜索，中部为装备、元素附魔、精萃附魔三栏，底部固定名称与完成按钮。技能选择则按职业过滤并以稀有度顺序展示技能卡，卡片同时给出当前效果、满级效果、元素条件和选中状态。

在线页面当前包含站点停服公告且布局高度超过首屏；截图只用于工具主体的结构与样式证据，不进入应用资源。现网图片和 bundle 的归档、哈希和授权边界见 `reference/behavior-notes/RESOURCE_INVENTORY.md`。
