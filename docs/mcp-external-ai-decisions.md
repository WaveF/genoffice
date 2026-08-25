# MCP 外部 AI 改造：已确认决策

这些决策用于解除 `mcp-external-ai-todo.md` 的 P0 前置阻塞；后续变更需通过新的 ADR 或更新本文件记录。

## DEC-01：MCP 仅控制已打开文档

MVP 不提供任意本机路径的 `open_document`、`read_file` 或 `write_file`。外部 AI 只能枚举并操作用户已在 GenOffice 中打开的文档。这样避免让 MCP bridge 成为通用文件系统入口。

## DEC-02：Slides-first

首个正式支持的编辑器为 Slides。其 PPTX session、事务、撤销/重做和 canonical operation registry 已主要位于 Electron main process，可在不依赖 renderer 私有状态的情况下实现安全的端到端 MVP。

## DEC-03：写入授权

MCP client 首次调用 `write` 或 `file` 风险等级的工具时，GenOffice 显示应用内授权提示；许可只在本次应用会话内对该 client 生效。`destructive` 操作始终再次确认。读取工具不弹窗，但仍要求已完成本机 bridge 认证。

## DEC-04：内置云 AI 一并下线

内置对话、模型 provider、Genspark 登录、云搜索和云图像生成均属于待移除范围。外部 AI 负责搜索和生成；GenOffice 只保留经过权限和 schema 校验的文档、媒体插入及保存能力。
