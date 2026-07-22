# 离线验证

## 自动检查

```bash
npm run build:web
npm run verify:offline
npm run verify:content
```

检查会递归扫描桌面端源码、Tauri 源码及 Vite 产物，遇到 HTTP(S)、WebSocket、
`cq-zys.cn`、Google Fonts 或 Socket.IO 字样即失败。`reference/` 与测试夹具明确排除，
因为它们仅用于逆向证据且不会进入正式构建。

## macOS 人工验收

1. 首次联网启动一次应用，创建体系并退出。
2. 关闭 Wi-Fi，或在防火墙中阻止应用所有出站连接。
3. 再次启动，确认体系、英雄、勇士、任务、装备与模拟历史均恢复。
4. 新建体系，完成配装、拖拽、1,000 次与 10,000 次模拟、导入导出和图片导出。
5. 退出并重启，确认第二次离线写入完整恢复。
6. 使用 `lsof -i -n -P | grep hero-lineup`（应用运行期间）确认没有网络套接字。

应用的 CSP 只允许自身资源，Rust 命令不包含网络客户端依赖。任何数据更新都必须由用户
选择本地数据包文件触发；本版本没有在线更新器。

## 2026-07-22 实测

- Playwright 的 16 个 E2E 在请求层 fail-closed，所有测试结束时远程请求账本均为空。
- 最终 `.app` 实际启动后，针对其 PID 运行 `lsof -nP -a -p <PID> -i` 无输出。
- 同一次启动创建了 `app_data_dir()/user.db`，`PRAGMA integrity_check` 返回 `ok`。
- 自动全屏截图受当前 macOS 锁屏/Screen Recording 权限限制，因此原生黑屏截图未保留；尺寸和 Retina 证据由同一正式前端的 Playwright 截图提供，应用启动由进程、数据库和套接字检查独立证明。
