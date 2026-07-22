# 数据模型与交换格式

## 唯一正式格式

应用内部以 `hero-domain` 的 `LineupSystem` 为领域模型。对外只定义两种 v1 JSON 信封；字段名统一为 camelCase，UTF-8 编码，不依赖操作系统路径或字节序。

- `.zyslineup`：**恰好一个体系**，`format = "zyslineup"`，`payload` 是 `LineupSystem`。
- `.zysbackup`：完整用户备份，`format = "zysbackup"`，`payload` 包含 `systems`、`templates`、`settings`。

两种信封都必须包含：

- `schemaVersion`：交换结构版本，当前只能为 `1`；高版本拒绝导入。
- `exportedAt`：RFC 3339 UTC 时间。
- `versions.appVersion`：写出文件的应用版本。
- `versions.gameDataVersion`：计算所用基础游戏数据版本。
- `versions.simulatorVersion`：计算规则版本。
- `versions.assetVersion`：图片/资源版本。
- `checksumSha256`：对 `payload` 按 Rust 领域类型序列化得到的紧凑 JSON 字节计算 SHA-256，使用 64 位小写十六进制。校验在任何数据库修改前完成。

完整 JSON Schema 位于 `content/schemas/zyslineup.schema.json` 和 `content/schemas/zysbackup.schema.json`。JSON Schema 负责结构约束；`hero_domain::validate_lineup` 进一步检查 UUID 唯一性、任务到分组/英雄/冠军的引用、装备槽重复、空名称和非法等级。

## 兼容迁移

`hero_domain::decode_lineup_bundle` 是唯一旧格式入口。它兼容：

1. 早期 TypeScript 外壳的 `systems: []` 信封；
2. 初版 schema 草案的 `system: {}` 信封；
3. 当前正式 `payload` 信封。

旧 `taskGroups[].tasks[]` 会迁移成 `groups` 与扁平 `adventureTasks`；`memberIds` 按 UUID 英雄 ID 和字符串冠军 ID 拆分；中文难度映射为 1/2/3；旧 `championIds` 与 `championLoadouts` 合成为冠军配置。旧信封可以一次包含多个体系，因此该函数返回列表；`decode_lineup` 要求列表中恰好一个。所有新导出必须走 `encode_lineup`，不得继续写 `systems`、`system`、顶层 `gameDataVersion` 等旧字段。

旧文件没有的版本字段标记为 `legacy-unknown`，不伪造可追溯版本。导入完成后再次导出，即得到唯一正式格式。

## SQLite 边界

SQLite 只保存领域 JSON，不作为前端可直接访问的接口。完整备份恢复先验证所有体系引用，再进入单事务清空/写入；验证失败或事务失败时保留原数据库。基础内容包更新与用户数据库完全分离。

## 桌面层接入 API

桌面命令层已直接调用以下 API，不再维护 `ui_systems` 或手写信封：

- 单体系导出：`hero_domain::encode_lineup(&system, &versions)`；
- 单体系导入：`hero_domain::decode_lineup(bytes)`；
- 兼容旧多体系导入：`hero_domain::decode_lineup_bundle(bytes)`；
- 完整备份：`Storage::export_backup()` 后调用 `hero_domain::encode_backup(&backup, &versions)`；
- 完整恢复：`decode_backup(bytes)` 后调用 `Storage::restore_backup(&backup)`。

React 工作区保留便于界面编辑的分组形状，并通过有往返测试的 `toCanonicalSystem` / `fromCanonicalSystem` 无损映射到唯一领域模型。英雄的等级、种子、卡片、泰坦之塔/墓预览、技能与六槽装备，勇士的等级、1–71 阶数、种子、卡片、勇士之魂及使魔/光环之歌完整装备状态，任务名称/地图/人数/屏障/配置/结果和 `localTag` 都有正式字段。领域仍保留数字 `transcendence` 以兼容旧文件，在线式界面只写入 0/1。`loadoutPresent` 区分“选择但未自定义”与“明确保存默认勇士配装”。旧勇士配装缺少 `seed`/`titan` 时分别迁移为 `0`/`false`。

英雄和勇士配装模板使用 `Template { id, name, classId, build, updatedAt }`，由 Rust 命令层校验带类型的 `hero` / `champion-loadout` payload 后写入 SQLite `templates` 表。模板列表、保存、删除均不经过浏览器存储；模板随 `.zysbackup` 一并导出和事务恢复。浏览器预览仅提供等价 localStorage 适配器用于 UI 自动化测试。

打开数据库时会检测早期版本的 `ui_systems`：全部行先转换并验证，再在单个事务中写入 `systems` 并删除旧表；任意转换失败都不会修改数据库。旧格式重复 ID 导入时生成新 UUID，成功返回前已经持久化。

桌面文件选择与保存使用 Tauri 原生对话框，路径只在 Rust 中读取或写入，并强制检查 `.zyslineup` / `.zysbackup` 扩展名。备份恢复由界面二次确认，checksum、数据版本和领域引用验证均发生在替换事务之前。
