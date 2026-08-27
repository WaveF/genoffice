# 第 7 阶段：内置 AI 下线执行清单

> 动态清单。每项必须同时满足代码证据、类型检查和相应 MCP 回归；新发现直接补入本文件，避免将“入口已隐藏”误判为“功能已下线”。

## 完成定义

第 7 阶段完成时，GenOffice 不再包含可达的内置模型调用、内置聊天 UI、`ai:*` IPC/preload 暴露、AI 专属直接依赖或误导性的用户文档。外部 Agent 仅通过本地 MCP bridge 控制文档。

## 当前状态（2026-08-27）

| ID | 工作项 | 状态 | 当前证据 / 剩余范围 |
| --- | --- | --- | --- |
| SUN7-01 | Slides 下线验收 | 待手工回归 | renderer/runtime 已删除；需手工验证编辑、保存、undo。 |
| SUN7-02 | Docs/Markdown UI 与 renderer 收尾 | 进行中 | renderer 面板已删；Docs Ribbon 残留、Docs main/shared IPC 仍须物理删除。 |
| SUN7-03 | Sheets 运行时与 IPC 收尾 | 进行中 | 已删除 AgentLoop、transport、`registerSheetsAiIpc`、请求 schema、图片/网页搜索 IPC、预加载 API 与选区工作流；MCP 惰性读取仍可用。剩余 `ai/tools.ts` 及其仅供 Agent 使用的辅助模块须在保留 MCP 读取依赖后迁移/删除。 |
| SUN7-04 | PDF renderer 与 IPC 收尾 | 进行中 | AI 面板/stream/image bridge 已删；`_aiApi` 死能力对象仍须整体删除。 |
| SUN7-05 | Shell 全局设置与 provider 表面 | 未开始 | SettingsModal、preload、home-api 仍引用 `ai-provider`。 |
| SUN7-06 | 全局 IPC 删除 | 未开始 | Docs `registerAiIpc`、Sheets 未注册 handler、相关 shared/preload 必须物理删除。 |
| SUN7-07 | 包与聊天存储删除 | 未开始 | `packages/ai-provider`、`packages/agent-core` 仍存在；删除前须清完所有直接引用。 |
| SUN7-08 | i18n、资源、测试、文档 | 未开始 | 各应用 AI 文案/样式/测试与 README、隐私、安全说明需更新。 |
| SUN7-09 | 质量门禁 | 未开始 | 全 workspace typecheck、MCP adapter/gateway 回归、Shell/Slides MCP smoke、手工 Office 编辑回归。 |

## 执行顺序与退出条件

1. 完成 `SUN7-02`～`SUN7-04`：每个应用不得有可达 AI UI、AgentLoop/transport 或 `ai:*` API。
2. 完成 `SUN7-05`、`SUN7-06`：删除 Shell 设置和所有全局 AI IPC，静态搜索不应再命中生产代码中的 provider/chat/stream 暴露。
3. 完成 `SUN7-07`：移除 workspace 包、package manifest/lockfile、聊天专用 project-store 代码与测试。
4. 完成 `SUN7-08`、`SUN7-09`：清理面向用户内容并完成全量验证。

## 新发现与决策记录

- `MED-01`：外部 Agent 生成图片的安全导入不应复用旧内置 AI URL 下载。后续采用受控 media handle、MIME/大小校验、SSRF 防护和审计；不阻塞第 7 阶段下线。
- 进度不能依据已移除面板估算；必须按“UI、运行时、IPC、依赖、验证”五层均关闭才可标记完成。
- `SUN7-03`：Sheets 的惰性 MCP 读取复用了原 `ai/workbook-readers.ts`。清理时应把该模块迁至 MCP/通用读取域，不能因目录名直接删除，避免回退已交付的 `sheets.read_range` 能力。
