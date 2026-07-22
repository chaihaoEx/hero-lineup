# 离线内容来源与维护基线

当前 `content/` 是 2026-07-22 对公开线上 hero-lineup 工具的保全快照，目的是为无源码重建提供离线输入基线。

## 版本定义

- `appVersion`: 首个离线应用兼容基线 `0.1.0`。
- `schemaVersion`: 内容清单和导出格式的结构版本，当前为 `1`。
- `gameDataVersion`: `web-snapshot-2026-07-22`。线上未公开官方游戏数据版本，因此不得把它解释为官方版本号。
- `simulatorVersion`: `legacy-web-2026-07-22-reference`，表示旧网页算法证据的快照版本。
- `assetVersion`: 对 manifest 内全部文件路径与 SHA-256 的稳定聚合哈希。

## 目录职责

- `content/TextAsset`: 离线运行所需的结构化游戏数据。
- `content/Sprite`: 由有限、可解释路径集合下载成功的图片。
- `content/defaults`: 不含线上用户信息的空白默认体系。
- `content/schemas`: 内容清单和 `.zyslineup` 文件的离线 schema。
- `content/manifest.json`: 最终内容包的逐文件完整性清单。
- `reference`: 编译 bundle、接口样本、HTTP 元数据和调查记录；禁止被最终应用引用或打包。

## 授权注意

JSON、中文文本和 Sprite 中可识别出第三方游戏内容。技术归档成功不等于获得再分发授权。对外发布安装包前，项目所有者必须完成素材和数据许可审查；若授权不足，应以可替换资源映射或用户本地导入方式交付。

## 下一次数据更新

不得直接覆盖现有内容。维护工具应先构建新版本目录，验证 JSON、跨文件引用、图片存在性和 SHA-256，再进行原子切换。安装失败时保留旧内容；用户体系和数据库不得随基础数据更新被覆盖。旧模拟结果应按 `gameDataVersion` 和 `simulatorVersion` 标记过期。

