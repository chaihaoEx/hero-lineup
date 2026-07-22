# 离线桌面架构

## 决策

应用采用 Tauri 2、React/TypeScript 和 Rust workspace。React 负责交互与呈现；Rust 是持久化、导入导出、内容校验、属性计算和模拟器的可信边界。游戏基础数据和图片以版本化只读内容包分发，用户数据写入 SQLite。

## 边界

```text
React UI
  │ typed Tauri commands/events
  ▼
Tauri command layer
  ├── hero-domain      领域模型和跨平台交换格式
  ├── hero-storage     SQLite migrations 与用户数据
  ├── hero-catalog     TextAsset 属性计算与装备/技能限制
  ├── hero-simulator   任务规则、固定随机模拟和取消
  └── hero-data        内容包构建、验证、安装和回滚

Bundled content                 Writable app data
  content/manifest.json           user.db
  content/TextAsset/*.json        content/ (verified local update)
  content/Sprite/**               backups/
```

## 平台策略

- 共用 React、Rust、内容格式和数据库 schema。
- 通过 Tauri path API 或 Rust `Path`/`PathBuf` 获取目录。
- 平台配置分别放在 `tauri.macos.conf.json` 和 `tauri.windows.conf.json`。
- 只有签名、安装器和必要系统集成允许使用 `cfg(target_os)`。
- 当前只在 macOS 执行发布验收，Windows 配置和文档必须保持可构建。

## 离线策略

- CSP 的 `connect-src` 仅允许 Tauri IPC。
- 不加载远程脚本、图片、字体和 API。
- `reference/` 仅保存研究证据，不加入正式构建。
- 数据更新通过用户在原生文件选择器中选择 `.zysdata` 完成；Rust 在切换目录前校验
  schema、最低应用版本、文件清单、SHA-256、跨文件引用与桌面目录解析。运行时优先使用
  `app_data_dir()/content`，缺失或不可解析时回退到只读的 bundled content。

## 迁移策略

线上压缩产物用于提取行为、数据结构和黄金样本，不作为新应用的长期运行依赖。先重建领域模型和核心工作流，再用截图与黄金数据逐步缩小差异。

桌面模拟入口按任务 `questId` 从活动内容目录读取 `monsterHp`、`dmg`、`dmgRed`、`crit`、`critMult`、`tdef`、`aoe` 与 `aoeOdds`，组装为高级模拟请求；Booster、精英和泰坦塔配置在同一 Rust 边界施加。React 不保存另一套公式。
