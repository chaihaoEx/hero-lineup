# 离线迁移验收矩阵

验收日期：2026-07-22，平台：Apple Silicon macOS。`通过` 表示实现、自动测试或发布产物检查中至少有一项可重复证据；算法仍无法由公开证据确认的边界单独记录在 `KNOWN_DIFFERENCES.md`，不以宽松断言伪装成线上等价。

| 编号 | 要求 | 验收证据 | 状态 |
| --- | --- | --- | --- |
| A01 | macOS 可安装或直接运行 | 最终 `.app` 实际启动为 PID，初始化 SQLite；ad-hoc `codesign --verify --deep --strict` 和 DMG `hdiutil verify` 均通过 | 通过 |
| A02 | 断网可用 | 16 个 Playwright 流程逐页拦截远程请求并断言为空；最终原生进程运行时 `lsof -a -p PID -i` 无输出 | 通过 |
| A03 | 无 CDN、Socket.IO、统计及远程字体 | CSP 仅允许自身/IPC，`npm run verify:offline` 扫描源码和产物，运行时套接字审计为空 | 通过 |
| A04 | 数据、图片随包提供 | 2,268 个 manifest 文件、24,185,991 字节、2,252 张 Sprite 全哈希通过；`.app` 内 manifest 与源码 SHA-256 相同 | 通过 |
| A05 | 体系完整 CRUD | 浏览器 E2E 覆盖新建、编辑、保存、重载、复制、删除、多体系；Tauri 命令只通过 Rust Storage 写 SQLite | 通过 |
| A06 | 重启后体系保留 | `hero-storage` 使用临时 SQLite 保存后关闭、重开并精确恢复的测试；最终应用数据库 `PRAGMA integrity_check = ok` | 通过 |
| A07 | 英雄、勇士配装 | 42 职业、线上同款 13 勇士、1,660 装备、544 技能；六槽、技能、种子、阶数、卡片、塔/墓、使魔/光环之歌、模板与 Rust 计算/限制校验 | 通过 |
| A08 | 拖入冒险任务 | E2E 使用真实 `DataTransfer` 协议加入成员；代码和测试覆盖最大人数、重复成员、无效成员与任务跨组拖放 | 通过 |
| A09 | 10,000 次后台模拟 | Tauri `spawn_blocking` + 进度事件 +取消令牌；UI E2E 覆盖 1,000/10,000；固定 seed Rust 回归覆盖结果与高级规则 | 通过 |
| A10 | 模拟详情和图片导出 | UI 显示全部要求统计；Canvas PNG 阵容/结果导出由 Vitest 校验有效 `image/png` 生成与下载 | 通过 |
| A11 | 体系和完整备份导入导出 | `.zyslineup` / `.zysbackup` checksum、schema、迁移、文件对话框和 SQLite 事务恢复；Rust 往返及前端 IPC 合同测试通过 | 通过 |
| A12 | 本地数据包更新 | UI 原生选择 `.zysdata`；CLI 与桌面内容管理器验证后安装，最终包再次 `verify` 并在新目录实装成功 | 通过 |
| A13 | 更新失败回滚 | 截断/篡改/预检失败/最低版本不符测试均证明旧目录与 `user.db` 不变；切换失败路径恢复备份目录 | 通过 |
| A14 | UI 接近线上 | 在线与本地 1440 基准，以及 1280、1024、窄窗口、Retina 2× 截图；蓝紫色、白卡、阴影、分组、弹窗和四功能顺序均保留 | 通过 |
| A15 | 正式运行代码可维护 | React/Rust 全部源码存在；构建资源不含 `reference/`，线上 bundle 只作为证据归档 | 通过 |
| A16 | 质量门禁通过 | TypeScript strict、ESLint、fmt、clippy `-D warnings`、21 前端测试、45 Rust 测试、16 E2E、内容/离线校验全部通过 | 通过 |
| A17 | macOS/Windows 文档与配置 | 两平台 Tauri 配置、跨平台路径/交换格式、macOS 发布步骤与 Windows MSI/NSIS 文档齐全 | 通过 |
| A18 | 完整实现而非脚手架 | A01–A17 均有交付物和可重复证据；剩余仅为公开证据不足的数值等价差异，并有明确影响范围 | 通过 |

## 发布不变量

- 每个交换文件携带 schema、应用、游戏数据、模拟器和资源版本以及 payload checksum。
- 每个模拟快照携带数据/模拟器版本；安装新数据后旧结果标记过期。
- 内容安装先完整校验和应用预检，再原子切换；失败不修改当前有效版本或用户库。
- Windows 与 macOS 共用领域模型、SQLite migration、Rust 算法、React UI 和 UTF-8 JSON 格式。
- 正式应用从不读取或执行 `reference/` 中的线上 bundle。
