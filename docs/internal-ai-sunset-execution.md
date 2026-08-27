# 第 7 阶段：内置 AI 下线执行清单

> 动态清单。每项必须同时满足代码证据、类型检查和相应 MCP 回归；新发现直接补入本文件，避免将“入口已隐藏”误判为“功能已下线”。

## 完成定义

第 7 阶段完成时，GenOffice 不再包含可达的内置模型调用、内置聊天 UI、`ai:*` IPC/preload 暴露、AI 专属直接依赖或误导性的用户文档。外部 Agent 仅通过本地 MCP bridge 控制文档。

## 当前状态（2026-08-27）

| ID | 工作项 | 状态 | 当前证据 / 剩余范围 |
| --- | --- | --- | --- |
| SUN7-01 | Slides 下线验收 | 待手工回归 | renderer/runtime 已删除；需手工验证编辑、保存、undo。 |
| SUN7-02 | Docs/Markdown UI 与 renderer 收尾 | 已完成 | Docs 已删除聊天/流式/搜索/生成 IPC 与 provider 依赖；普通网页图片粘贴保留为 `docs:fetch-pasted-image`。Markdown 已无内置 AI renderer。 |
| SUN7-03 | Sheets 运行时与 IPC 收尾 | 进行中 | 内置 Agent、transport、IPC 与 provider 依赖已删除；MCP 惰性读取仍可用。遗留 `renderer/ai/` 目录仅承载待迁移的通用/MCP 读取辅助模块。 |
| SUN7-04 | PDF renderer 与 IPC 收尾 | 进行中 | AI 面板/stream/image bridge 已删；`_aiApi` 死能力对象仍须整体删除。 |
| SUN7-05 | Shell 全局设置与 provider 表面 | 进行中 | AI 设置导航、preload、HomeApi 与 provider 品牌资源已删除；SettingsModal 中不可达旧 pane 仍待物理删除。 |
| SUN7-06 | 全局 IPC 删除 | 已完成 | Docs、Sheets 的 `ai:*` handlers/preload 已删除；Docs 安全图片粘贴改为独立 `docs:*` IPC。 |
| SUN7-07 | 包与聊天存储删除 | 已完成 | 已删除 `packages/ai-provider`、`packages/agent-core`、各应用依赖与根脚本/lockfile workspace 条目。 |
| SUN7-08 | i18n、资源、测试、文档 | 进行中 | 已删除 provider 图标与部分旧引用；仍需清理 AI 样式/i18n 以及原始规划文档中的过时状态。 |
| SUN7-09 | 质量门禁 | 进行中 | Docs/Sheets typecheck 与 23 项 MCP 回归已通过；仍需 PDF/Shell/Slides 验证及手工 Office 编辑回归。 |

## 执行顺序与退出条件

1. 完成 `SUN7-02`～`SUN7-04`：每个应用不得有可达 AI UI、AgentLoop/transport 或 `ai:*` API。
2. 完成 `SUN7-05`、`SUN7-06`：删除 Shell 设置和所有全局 AI IPC，静态搜索不应再命中生产代码中的 provider/chat/stream 暴露。
3. 完成 `SUN7-07`：移除 workspace 包、package manifest/lockfile、聊天专用 project-store 代码与测试。
4. 完成 `SUN7-08`、`SUN7-09`：清理面向用户内容并完成全量验证。

## 新发现与决策记录

- `MED-01`：外部 Agent 生成图片的安全导入不应复用旧内置 AI URL 下载。后续采用受控 media handle、MIME/大小校验、SSRF 防护和审计；不阻塞第 7 阶段下线。
- 进度不能依据已移除面板估算；必须按“UI、运行时、IPC、依赖、验证”五层均关闭才可标记完成。
- `SUN7-03`：Sheets 的惰性 MCP 读取复用了原 `ai/workbook-readers.ts`。清理时应把该模块迁至 MCP/通用读取域，不能因目录名直接删除，避免回退已交付的 `sheets.read_range` 能力。
