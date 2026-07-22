# 英雄体系搭配 · 完全离线桌面版

这是 `cq-zys.cn/hero-lineup` 的可维护源码重建工程。桌面端采用 Tauri 2、React、
TypeScript 与 Vite；SQLite、数据包、导入导出、属性计算及后台模拟由 Rust 封装。
当前开发与发布验证平台为 Apple Silicon macOS，工程保留 Windows MSVC 配置与平台无关格式。

## 快速开始

```bash
make bootstrap
npm test
npm run check
npm run verify:offline
npm run dev
```

构建 macOS 测试包：

```bash
make build-macos
```

## Windows 自动构建

仓库内置 `.github/workflows/windows-build.yml`。推送到 `main`、提交 Pull Request，或在 GitHub Actions 中手动运行后，会在 `windows-latest` 上完成前端类型检查、前后端测试和离线资源校验，并产出 x64 NSIS `setup.exe` 与 MSI 安装包。

当前自动构建产物未进行 Windows 代码签名，首次安装时可能显示 SmartScreen 提示；正式分发前需另行配置代码签名证书。

## 工程边界

- `apps/desktop/`：React UI 与 Tauri 命令适配层。
- `crates/hero-domain/`：领域类型和版本化交换格式。
- `crates/hero-storage/`：SQLite migration、体系、模板、设置与历史。
- `crates/hero-simulator/`：属性、装备校验及可取消固定种子模拟。
- `crates/hero-catalog/`：真实 TextAsset 驱动的英雄/勇士属性和装备限制计算。
- `crates/hero-data/`：离线内容包维护 CLI。
- `content/`：随安装包发布的 JSON、Sprite、默认体系与 schema。
- `reference/`：现网逆向证据，仅供研究，不进入正式应用。

## 数据维护

```bash
cargo run -p hero-data -- validate content
cargo run -p hero-data -- build content \
  --output dist/hero-data.zysdata \
  --game-data-version web-snapshot-2026-07-22 \
  --simulator-version hero-simulator-0.1.0 \
  --asset-version sha256:5c46fdf3e1b5c6b3dac29cf26c1bc7353b9770baf0069ffced39f1dbc3c689d4
cargo run -p hero-data -- inspect dist/hero-data.zysdata
cargo run -p hero-data -- verify dist/hero-data.zysdata
```

`hero-data` 还提供 `diff` 与原子 `install`。正式应用不包含网络客户端；数据升级只能由
用户选择本地数据包触发。

## 文档

- [架构](docs/ARCHITECTURE.md)
- [验收矩阵](docs/ACCEPTANCE_MATRIX.md)
- [离线验证](docs/OFFLINE_VERIFICATION.md)
- [macOS 构建](docs/MACOS_BUILD.md)
- [Windows 构建](docs/WINDOWS_BUILD.md)
- [数据来源](docs/DATA_SOURCE_PROVENANCE.md)
- [资源盘点](reference/behavior-notes/RESOURCE_INVENTORY.md)

归档内容来自用户授权迁移的公开线上工具。任何无法明确授权的素材都通过资源映射隔离，
可替换而不影响领域数据和业务代码。

## 当前交付物

- macOS 应用：`target/release/bundle/macos/英雄体系搭配.app`
- macOS 测试 DMG：`target/release/bundle/dmg/英雄体系搭配_0.1.0_aarch64.dmg`
- 离线数据包：`dist/hero-data.zysdata`
- 在线/本地界面基准：`reference/screenshots/`

2026-07-23 提交前验收通过 31 个前端单元/组件测试、46 个 Rust 测试和 16 个 Playwright E2E；完整证据见 [发布证据](docs/RELEASE_EVIDENCE.md) 与 [验收矩阵](docs/ACCEPTANCE_MATRIX.md)。
