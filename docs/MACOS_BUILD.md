# macOS 开发与构建

## 环境与检查

需要 Xcode Command Line Tools、Rust stable、Node.js 20+。

```bash
make bootstrap
npm test
npm run check
npm run verify:offline
make build-macos
```

开发启动使用 `npm run dev`。Tauri 产物默认位于
`target/release/bundle/macos/` 与 `target/release/bundle/dmg/`；实际路径以构建日志为准。

测试包使用 ad-hoc 签名；若 Tauri 的 Finder 美化 DMG 脚本在无交互会话失败，可在 `.app`
通过 `codesign --verify --deep --strict` 后使用以下无 Finder 依赖的方式生成测试 DMG：

```bash
codesign --force --deep --sign - "target/release/bundle/macos/英雄体系搭配.app"
hdiutil create -volname "英雄体系搭配" \
  -srcfolder "/path/to/staging-directory-containing-app-and-Applications-link" \
  -ov -format UDZO "target/release/bundle/dmg/英雄体系搭配_0.1.0_aarch64.dmg"
hdiutil verify "target/release/bundle/dmg/英雄体系搭配_0.1.0_aarch64.dmg"
```

正式分发需要 Apple Developer ID Application 证书，在 CI 密钥链中
配置签名身份，构建后使用 `xcrun notarytool submit --wait` 公证，再用 `xcrun stapler staple`
装订票据。证书、Apple ID 和 app-specific password 不得写入仓库。

注意：`hdiutil -srcfolder` 必须指向一个包含 `.app` 的暂存目录，不能直接指向 `.app`，否则镜像根目录会变成应用的 `Contents`。本次交付 DMG 含 `.app` 与指向 `/Applications` 的符号链接，SHA-256 和校验结果记录在 `RELEASE_EVIDENCE.md`。
