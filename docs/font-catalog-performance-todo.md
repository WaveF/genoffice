# 字体目录加载性能：动态执行清单

> 状态：执行中（FCP-00～02 已完成）。目标是在不改变 Docs 的字体保存语义、字体回退或跨平台行为的前提下，让系统字体列表在首次和后续打开时都不阻塞字体菜单。

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
| FCP-03 | 实现 Shell 字体目录服务与持久缓存。           | P0     | FCP-01..02    | 未开始 | apps/shell/src/main、userData                     | 后台单飞枚举、UTF-8/大小受限缓存、原子写入、schema 迁移、TTL/显式刷新和失败回退均实现。                      |
| FCP-04 | 定义受控 IPC/preload 字体目录接口。           | P0     | FCP-03        | 未开始 | Shell IPC、Docs/Slides/Sheets preload/shared      | renderer 可读缓存快照、订阅加载完成和请求刷新；参数/结果校验，不接受路径或任意系统查询。                     |
| FCP-05 | 抽取共享 renderer 字体目录 hook，迁移三应用。 | P0     | FCP-04        | 未开始 | Docs/Slides/Sheets system-fonts、UI components    | 三应用去除直接 queryLocalFonts 主路径；固定字体即时显示，系统结果统一接入。                                  |
| FCP-06 | 改造字体菜单的加载与大列表渲染体验。          | P0     | FCP-01,FCP-05 | 未开始 | Docs Ribbon/ContextMenu、Slides/Sheets pickers    | 菜单立即打开；显示非阻塞 loading/stale 状态；采用搜索、分段或虚拟化以限制首次 DOM 工作量；当前字体始终可见。 |
| FCP-07 | 实现别名、去重和缓存失效策略。                | P1     | FCP-03..06    | 未开始 | Shell catalog service、renderer selection helpers | 中文/英文别名可映射到稳定 family；重复 family 不显示；缓存过期、系统字体变化和异常刷新均不损坏当前选择。     |
| FCP-08 | 完成测试、性能回归、打包与人工验收。          | P0     | FCP-03..07    | 未开始 | Shell/Docs/Slides/Sheets tests、CI                | 覆盖缓存命中/未命中、并发单飞、失败降级、IPC 边界、菜单即时可用、长列表渲染、三端构建；保留基线对比记录。    |

## 建议执行顺序

FCP-00 → FCP-01 → FCP-02 → FCP-03 → FCP-04 → FCP-05 → FCP-06 → FCP-07 → FCP-08。

## 已知风险

- Meoyan 的 Rust fontdb 可在后台线程扫描，但 Node/Electron 的候选实现需要单独验证打包体积、原生 ABI、代码签名与许可证。
- 单纯把当前 queryLocalFonts 提前到 idle 时段只能改善首次点击体验，不能解决重启后重新扫描、三个 renderer 重复扫描与长列表 DOM 渲染问题。
- 字体目录与文档字体解析是不同职责；不能因为列表优化改变 OOXML 的 font、fontAscii 或 East Asian font slot 规则。
