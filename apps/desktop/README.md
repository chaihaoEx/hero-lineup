# 英雄体系搭配桌面端

Tauri 2 + React + TypeScript 的完全离线桌面界面。运行时只读取打包进应用的 `content/` 和应用数据目录中的 `user.db`，CSP 禁止外部网络连接。

## 本地开发

```bash
npm install
npm run typecheck
npm test
npm run build
npm run tauri dev
```

普通 `npm run dev` 会启用浏览器 fallback：体系存入 `localStorage`，模拟在异步计时器中运行，因此不启动 Rust 也能进行 UI 测试。Tauri 环境通过 `src/platform/bridge.ts` 的同一接口调用 Rust。

## Tauri 命令契约

- `list_systems() -> LineupSystem[]`
- `save_system({ system }) -> LineupSystem`
- `delete_system({ id })`
- `export_system({ system }) -> string`（单体系、canonical checksum）
- `import_systems({ payload, expectedGameDataVersion }) -> LineupSystem[]`（返回前已持久化）
- `export_backup_file` / `restore_backup_file`（完整事务备份）
- `pick_read_interchange` / `pick_write_interchange`（原生对话框 + Rust 文件 I/O）
- `start_simulation({ request: { task, units, systemId } }) -> SimulationResult`
- `cancel_simulation({ taskId })`
- 进度事件：`simulation-progress:{taskId}`，payload 为 `SimulationProgress`

Rust 接口只持久化 `hero-domain` 的 canonical schema。React 的嵌套 `taskGroups/championIds` 通过有往返测试的显式 adapter 转换，旧版 `ui_systems` 在打开数据库时一次性事务迁移。

## 平台兼容

通用配置在 `src-tauri/tauri.conf.json`。macOS 与 Windows 的安装目标分别在平台配置文件中；Windows 预置离线 WebView2 安装模式。资源路径使用 Tauri `$RESOURCE` 和 `app_data_dir()`，没有硬编码用户目录或平台分隔符。
