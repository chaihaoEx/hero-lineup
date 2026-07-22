# Windows 构建准备

## 环境

- Windows 10/11 x64
- Microsoft Visual Studio Build Tools（Desktop development with C++）
- WebView2 Runtime
- Rust stable 的 `x86_64-pc-windows-msvc` 工具链
- Node.js 20 或更新的 LTS

```powershell
npm --prefix apps/desktop install
npm test
npm run check
npm run build
```

产物位于 workspace 的 `target/release/bundle/`。工程通过 Tauri path API 获取
资源、应用数据和下载目录；导入导出格式使用 UTF-8、正斜杠逻辑路径和平台无关 JSON，
不会保存 macOS 绝对路径。Windows 差异集中在 `tauri.windows.conf.json` 和打包图标，
不得进入领域、存储或模拟器 crate。

正式发布前需要在 Windows CI 或实体机补齐 MSI/NSIS 安装、WebView2 引导、中文路径、
长路径、高 DPI、签名证书和 Defender SmartScreen 验收。

`tauri.windows.conf.json` 已配置 NSIS/MSI、x64 图标和离线 WebView2 引导策略。Windows 构建不是本次 macOS 验收的一部分；迁移时不得 fork 领域 crate 或另建 Windows 数据格式，只允许补充签名、安装器和平台集成配置。
