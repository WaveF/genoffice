# 第 7 阶段：内置 AI 下线执行清单

> 动态清单。每项必须同时满足代码证据、类型检查和相应 MCP 回归；新发现直接补入本文件，避免将“入口已隐藏”误判为“功能已下线”。

## 完成定义

第 7 阶段完成时，GenOffice 不再包含可达的内置模型调用、内置聊天 UI、`ai:*` IPC/preload 暴露、AI 专属直接依赖或误导性的用户文档。外部 Agent 仅通过本地 MCP bridge 控制文档。

## 当前状态（2026-08-28）

| ID | 工作项 | 状态 | 当前证据 / 剩余范围 |
| --- | --- | --- | --- |
| SUN7-01 | Slides 下线验收 | 已完成 | 本机完成新建、插入文本、自动保存与撤销；Slides typecheck 通过。 |
| SUN7-02 | Docs/Markdown UI 与 renderer 收尾 | 已完成 | Docs 已删除聊天/流式/搜索/生成 IPC 与 provider 依赖；本轮又物理删除隐藏 Ribbon、专用翻译与样式。普通网页图片粘贴保留为 `docs:fetch-pasted-image`。Markdown 已无内置 AI renderer。 |
| SUN7-03 | Sheets 运行时与 IPC 收尾 | 已完成 | 内置 Agent、transport、IPC、聊天状态、规则解析器与 provider 依赖已删除；MCP 惰性读取已迁至 `mcp-workbook-readers.ts`，原 `renderer/ai/` 目录已删除。Sheets typecheck 与 35 项 MCP 回归通过。 |
| SUN7-04 | PDF renderer 与 IPC 收尾 | 已完成 | `_aiApi`、AI 面板/stream/image bridge、隐藏控件及关联样式均已删除；PDF typecheck 已通过。 |
| SUN7-05 | Shell 全局设置与 provider 表面 | 已完成 | AI 设置导航、preload、HomeApi、provider 品牌资源及不可达 `AiModelPane` 均已物理删除；Shell typecheck 仅保留既有的 `tab-manager.ts` 无关基线错误。 |
| SUN7-06 | 全局 IPC 删除 | 已完成 | Docs、Sheets 的 `ai:*` handlers/preload 已删除；Docs 安全图片粘贴改为独立 `docs:*` IPC。 |
| SUN7-07 | 包与聊天存储删除 | 已完成 | 已删除 `packages/ai-provider`、`packages/agent-core`、各应用依赖与根脚本/lockfile workspace 条目。 |
| SUN7-08 | i18n、资源、测试、文档 | 已完成 | 已删除 Docs/Sheets 专用 AI 翻译、无调用菜单徽章、Slides 无调用图标/样式；源码中无可达 AI 翻译调用。 |
| SUN7-09 | 质量门禁 | 已完成 | Docs/Sheets/PDF/Slides typecheck 通过，5 个 MCP 测试文件共 37 项通过；本机完成四类编辑器冒烟，provider/IPC/运行时标识静态搜索为零。Shell 仅保留既有 `tab-manager.ts(281)` 基线错误。 |

## 执行顺序与退出条件

1. 完成 `SUN7-02`～`SUN7-04`：每个应用不得有可达 AI UI、AgentLoop/transport 或 `ai:*` API。
2. 完成 `SUN7-05`、`SUN7-06`：删除 Shell 设置和所有全局 AI IPC，静态搜索不应再命中生产代码中的 provider/chat/stream 暴露。
3. 完成 `SUN7-07`：移除 workspace 包、package manifest/lockfile、聊天专用 project-store 代码与测试。
4. 完成 `SUN7-08`、`SUN7-09`：清理面向用户内容并完成全量验证。

## 新发现与决策记录

- `MED-01`：外部 Agent 生成图片的安全导入不应复用旧内置 AI URL 下载。后续采用受控 media handle、MIME/大小校验、SSRF 防护和审计；不阻塞第 7 阶段下线。
- 进度不能依据已移除面板估算；必须按“UI、运行时、IPC、依赖、验证”五层均关闭才可标记完成。
- `SUN7-03`：Sheets 的惰性 MCP 读取复用了原 `ai/workbook-readers.ts`。清理时应把该模块迁至 MCP/通用读取域，不能因目录名直接删除，避免回退已交付的 `sheets.read_range` 能力。
- `SUN7-03` 更新：读取模块已迁移至 `mcp-workbook-readers.ts`，并通过 Sheets typecheck 与 35 项 MCP 回归；下一轮只处理无调用的旧聊天状态，不触及 MCP 读取路径。
- `SUN7-08`：Slides 有部分普通格式面板沿用 `ai-*` CSS 类名。对于仍有调用的样式必须先改为中性名称；仅凭类名前缀不得删除。
- `SUN7-09` 自动验证（2026-08-28）：Docs、Sheets、PDF、Slides typecheck 均通过；`mcp-adapter`、`mcp-lazy-reader`、`mcp-revision`、Shell MCP gateway 共 37 项测试通过；`@genoffice/(ai-provider|agent-core)`、`ai:*` IPC、旧内部运行时标识及可达 AI 翻译调用均为零命中。Shell typecheck 仍命中既有 `src/main/tab-manager.ts(281,35)` 参数类型错误，未由本阶段变更引入。
- `SUN7-09` 本机回归（2026-08-28）：启动 Electron 开发应用后，Slides、Docs、Sheets 均完成“新建 → 修改 → 撤销”（自动保存可用），PDF 完成新建与缩放。回归发现并修复 Docs 新建状态提示仍引导用户使用左侧 AI 面板，以及 Sheets 在内置 dock 删除后仍保留 360px 空列的布局残留。
