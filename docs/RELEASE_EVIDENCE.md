# 0.1.0 发布验收证据

验收平台：Apple Silicon macOS；最新回归日期：2026-07-23；应用标识：`cn.cq-zys.hero-lineup`。

## 发布物

| 交付物 | 大小 | SHA-256 / 校验 |
| --- | ---: | --- |
| `target/release/bundle/macos/英雄体系搭配.app` | 39 MB | ad-hoc 签名；`codesign --verify --deep --strict` 通过 |
| `target/release/bundle/dmg/英雄体系搭配_0.1.0_aarch64.dmg` | 25,590,050 字节 | `e9fc5a84046fad04a763d22afad58bc032e1c86ffeec59525c4f1bb16eafbe1f`；泰坦 AOE、职业定向词条、限时回避/暴击与禁用元素阵容联动修正后重建，`hdiutil verify` 通过 |
| `dist/hero-data.zysdata` | 16 MB | `f0cb92dcaa528e56026c11d2d08267f69f4452676acf0492dd1953cbe39f4753`；`hero-data verify` 通过 |
| `content/manifest.json` | 2,292 条目 | `3538fdd4eaebbca76c1238fb0871027f9b26eca42ccd7d216f19c1a1ad52e8b0` |

`.app/Contents/Resources/content/manifest.json` 的 SHA-256 与源码 manifest 完全相同，当前均为 `3538fdd4eaebbca76c1238fb0871027f9b26eca42ccd7d216f19c1a1ad52e8b0`。原始数据含 15 条勇士记录；目标页公开阵容为 13 名（11 条正式记录，加以“塔马什/莱茵霍尔德”公开的 `leather/king` 两条记录，排除联动临时记录）。其余统计为 42 职业、391 任务、1,660 装备、544 技能、22,778 中文文本、2,276 Sprite，共 24,313,465 字节（manifest 自身除外）。

## 自动质量门禁

最终命令：

```bash
npm run check
npm test
npm run test:e2e
npm run verify:content
npm run verify:offline
```

结果：TypeScript strict/typecheck、ESLint、`cargo fmt --check`、workspace all-target `cargo clippy -D warnings` 均通过；前端 61/61、Rust 55/55、Playwright 25/25 通过。内容清单与离线静态审计通过。E2E 覆盖体系双页签创建/口令导入、本地收藏复制、CRUD/重载、英雄与勇士配装、技能、冒险强化/精英/屏障、成员与任务拖放、10,000 次模拟、IPC 合同、1440/1280/1024/窄窗口/Retina，以及请求层零远程连接。

## 原生冒烟

最终 `.app` 通过 `open -n` 启动，进程保持运行；首次启动建立 `~/Library/Application Support/cn.cq-zys.hero-lineup/user.db`，表和 migration 完整，`PRAGMA integrity_check` 返回 `ok`。运行时针对应用 PID 的 `lsof -nP -a -p PID -i` 为空。本次启动进程保留，便于直接查看应用。

由于执行环境当时处于 macOS 锁屏/Screen Recording 受限状态，系统全屏抓图是纯黑，已删除且不作为证据。原生启动、资源装载、数据库和网络状态由上述独立检查证明；界面视觉由正式 React 产物的五组 Playwright 截图证明。

## 数据更新实装

最终 `.zysdata` 校验了 2,269 个 ZIP 文件（含包内 manifest）、17 个 JSON 文档，无警告。包已安装到全新临时目标并再次核对版本、统计和文件数量。损坏包、哈希错误、应用级预检失败、最低应用版本不符、符号链接/路径逃逸和切换回滚均有 Rust 测试。

## 签名边界

当前应用为 ad-hoc 本地测试签名，`TeamIdentifier` 为空，因此适合本机测试或受控分发，不是已公证的公众发行包。正式外部分发需要 Developer ID Application 证书、公证和 stapling；步骤见 `MACOS_BUILD.md`。
