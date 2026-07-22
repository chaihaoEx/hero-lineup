# 离线数据维护

`hero-data` 是内容包的唯一构建、检查、比较与安装工具。正式包扩展名建议使用 `.zysdata`。

## 目录要求

输入目录必须包含 `TextAsset/classes.json`、`heroes.json`、`quests.json`、`items.json`、`skills.json`、`levels.json`、`qmodifiers.json`、`texts_zh.json` 和 `Sprite/`。包内文件只能位于 `TextAsset/`、`Sprite/`、`defaults/`、`schemas/`；禁止绝对路径、`..`、反斜杠路径和符号链接。

验证包括：

- 所有 JSON 可解析，核心字典是对象、key 与 `uid` 一致，`levels.json` 含 `levels` 数组；
- 英雄职业、英雄技能、职业固有技能/初始装备、物品技能均能跨文件解析；
- 职业、冠军、物品和技能能按本项目 Sprite 命名规则解析到本地图片；
- 清单文件列表与 ZIP 实际内容完全一致，每个文件的大小及 SHA-256 一致。

## 常用命令

```bash
cargo run -p hero-data -- validate content

# 原子刷新目录清单；manifest.json 自身不会列入 files
cargo run -p hero-data -- manifest content \
  --game-data-version web-snapshot-2026-07-22 \
  --simulator-version hero-simulator-0.1.0 \
  --asset-version sha256:<资源集合哈希> \
  --app-version 0.1.0 \
  --minimum-app-version 0.1.0

cargo run -p hero-data -- build content \
  --output release/content-2026-07.zysdata \
  --game-data-version web-snapshot-2026-07-22 \
  --simulator-version hero-simulator-0.1.0 \
  --asset-version sha256:<资源集合哈希> \
  --app-version 0.1.0 \
  --minimum-app-version 0.1.0

cargo run -p hero-data -- verify release/content-2026-07.zysdata
cargo run -p hero-data -- inspect release/content-2026-07.zysdata
cargo run -p hero-data -- diff old.zysdata new.zysdata
cargo run -p hero-data -- install release/content-2026-07.zysdata ./installed-content
```

## 发布流程

1. 在新目录采集数据与图片，不覆盖正在使用的版本。
2. 运行 `validate`，修复所有结构、引用和 Sprite 错误。
3. 使用不可变 `gameDataVersion`、`simulatorVersion`、`assetVersion` 构建包。
4. 对成品再次运行 `verify`，保留 `inspect` 输出作为发布记录。
5. 使用 `diff` 审核增删改文件；异常的大规模删除应终止发布。
6. 应用安装时先完整验包和解压到同卷临时目录，再原子改名。旧目录先改名为备份；新目录切换失败则恢复旧目录。验包失败时不会触碰现有安装。
7. 安装成功后按新 `gameDataVersion` / `simulatorVersion` 将旧模拟结果标记为过期，不删除用户体系。

桌面端通过 `desktopBridge.installDataPackage()` 打开原生文件选择器。安装结果返回活动内容版本、
统计、验证报告和被标记过期的模拟记录数量；取消选择返回 `null`。用户 SQLite 固定为
`app_data_dir()/user.db`，内容更新只替换同级 `content/` 目录。

自动测试覆盖 ZIP 截断、内容被篡改导致哈希失败、应用级预检失败保留旧目录、最低应用版本、
用户数据库隔离、资源路径越界/符号链接逃逸、活动目录优先级，以及正常构建/验证/差异/安装往返。
