# 字体目录加载性能：动态执行清单

> 状态：已完成（FCP-00～08）。目标是在不改变 Docs 的字体保存语义、字体回退或跨平台行为的前提下，让系统字体列表在首次和后续打开时都不阻塞字体菜单。

## 背景与参考边界

Meoyan 的实现具有三项可借鉴策略：原生后台线程枚举字体、持久化字体目录缓存、空闲时预加载。它使用 Rust fontdb，不能直接复制到 Electron；MiniOffice 应保留同等的产品行为，但以 Shell 主进程服务和受控 IPC 实现。

当前 Docs、Slides、Sheets 分别在 renderer 通过 Local Font Access API 的 queryLocalFonts 枚举，结果仅在页面生命周期缓存。Docs 还会在首次打开字体下拉菜单时启动查询，因此用户会同时等待枚举和大量菜单项渲染。

## 产品与技术边界

- 固定推荐字体列表继续同步显示，不依赖系统枚举。
- 系统字体枚举、缓存与刷新由 Shell 统一拥有；renderer 不直接扫描系统字体目录。
- IPC 只返回去重后的 family、可选 alias 和状态，不返回字体文件路径、原始 metadata 或字体 bytes。
- 缓存只是性能优化：失败、过期或权限异常必须降级为固定字体列表，不能阻塞编辑、保存或应用启动。
- 不在本轮改变文档中已有字体的渲染或保存模型；字体目录仅服务于选择器候选项。
- 不引入 Rust/Tauri 运行时；是否增加 Node 原生依赖必须经跨平台打包和许可证审计确认。

## 完成边界

- Docs、Slides、Sheets 通过同一个 Shell 字体目录服务获取系统候选项，页面级 queryLocalFonts 不再处于主菜单路径。
- 已有缓存时，字体菜单打开无需等待枚举；无缓存时菜单立即可用并显示受控加载状态。
- 首次扫描只在主进程后台运行且同一应用会话内去重；结果持久化并带 schema/version/过期策略。
- 系统字体条目量较大时，菜单不会因一次创建全部带字体样式的 DOM 节点而显著卡顿。
- 单元、IPC、renderer 组件、三应用集成和 macOS/Windows/Linux 打包验证通过；不泄露字体文件路径。

## 任务清单

| ID     | 任务                                          | 优先级 | 依赖          | 状态   | 代码落点                                          | 验收标准                                                                                                     |
| ------ | --------------------------------------------- | ------ | ------------- | ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| FCP-00 | 固化字体目录服务的数据契约与缓存策略。        | P0     | -             | 已完成 | 本文档、Shell font-catalog                         | 定义无路径的 `families/source/state/stale/refreshedAt` 快照；缓存版本 1、512 KiB、7 天 TTL、失败降级。         |
| FCP-01 | 建立当前基线与性能剖析。                      | P0     | FCP-00        | 已完成 | Docs/Slides/Sheets font hooks、测试辅助           | 已定位：三 renderer 各自 `queryLocalFonts`，Docs 首次展开还叠加完整 DOM 渲染；后续 FCP-08 保存新旧路径对比。 |
| FCP-02 | 审计 Electron 可用的跨平台字体枚举方案。      | P0     | FCP-00        | 已完成 | Shell main、现有 font-metrics、build config       | 选定现有纯 Node `font-metrics` + Worker Thread；无 Rust/原生 ABI 依赖、无路径 IPC、可经现有 Electron 打包。   |
| FCP-03 | 实现 Shell 字体目录服务与持久缓存。           | P0     | FCP-01..02    | 已完成 | apps/shell/src/main、userData                     | Worker 单飞枚举、512 KiB UTF-8 缓存、原子写入、schema 版本、7 天 TTL 和失败回退已实现。                      |
| FCP-04 | 定义受控 IPC/preload 字体目录接口。           | P0     | FCP-03        | 已完成 | Shell IPC、Docs/Slides/Sheets preload/shared      | renderer 只读 path-free 快照并订阅更新；不接收路径、原始 metadata 或任意系统查询参数。                       |
| FCP-05 | 抽取共享 renderer 字体目录 hook，迁移三应用。 | P0     | FCP-04        | 已完成 | Docs/Slides/Sheets system-fonts、UI components    | 三应用已去除直接 `queryLocalFonts` 主路径；固定字体即时显示，系统结果统一接入。                               |
| FCP-06 | 改造字体菜单的加载与大列表渲染体验。          | P0     | FCP-01,FCP-05 | 已完成 | Docs Ribbon/ContextMenu、Slides/Sheets pickers    | 菜单可立即显示固定字体；系统预览项首批限制 150 条，避免一次创建大量带字体样式的 DOM；当前字体保留。          |
| FCP-07 | 实现别名、去重和缓存失效策略。                | P1     | FCP-03..06    | 已完成 | Shell catalog service、renderer selection helpers | 从 SFNT name table返回规范 family 与别名；运行期间每日后台刷新，缓存过期、异常刷新均保留当前选择。            |
| FCP-08 | 完成测试、性能回归、打包与人工验收。          | P0     | FCP-03..07    | 已完成 | Shell/Docs/Slides/Sheets tests、CI                | 覆盖缓存命中/未命中、并发单飞、失败降级、别名、长列表；三应用构建、macOS/Windows/Linux 打包均已验证。       |

## 建议执行顺序

FCP-00 → FCP-01 → FCP-02 → FCP-03 → FCP-04 → FCP-05 → FCP-06 → FCP-07 → FCP-08。

## 已知风险

- Meoyan 的 Rust fontdb 可在后台线程扫描，但 Node/Electron 的候选实现需要单独验证打包体积、原生 ABI、代码签名与许可证。
- 单纯把当前 queryLocalFonts 提前到 idle 时段只能改善首次点击体验，不能解决重启后重新扫描、三个 renderer 重复扫描与长列表 DOM 渲染问题。
- 字体目录与文档字体解析是不同职责；不能因为列表优化改变 OOXML 的 font、fontAscii 或 East Asian font slot 规则。

## 验收记录（2026-08-29）

- 本机打包 Worker 实测：两次冷扫描分别为 128 ms / 119 ms，均返回 1026 个 path-free 条目；扫描位于 Node Worker Thread，不占用 Electron UI 主线程。
- `@genoffice/font-metrics`：13 项测试通过；Shell font catalog：5 项测试通过；Docs：97 文件 / 1066 项通过；Slides：44 文件 / 372 项通过；Sheets：139 文件通过、1 文件跳过，1541 项通过、1 项跳过，另有 108 项 Rust 原生测试通过。
- Shell 全量测试仍有 4 项既有基线失败：已移除匿名统计功能后遗留的 `preload-analytics` 与 `privacy-doc` 断言；字体目录专项测试通过，且本轮未改动该功能域。
- `dist:mac`、`dist:win`、`dist:linux` 均成功生成包；分别检查 macOS `.app`、Windows `win-unpacked`、Linux `linux-unpacked` 的 `app.asar`，均含 `/out/main/font-catalog-worker.js`。
- 后续清理：字体候选列表过滤 macOS `.` 前缀内部/回退字体；对 `_` 前缀的第三方异常主名称优先显示同一字体的公开别名。缓存 schema 升级至 v2。
