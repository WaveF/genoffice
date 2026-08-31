# MCP 外部 AI 改造：已确认决策

这些决策用于解除 `mcp-external-ai-todo.md` 的 P0 前置阻塞；后续变更需通过新的 ADR 或更新本文件记录。

## DEC-01：MCP 控制已打开文档，并可创建受控空白文档

MVP 不提供任意本机路径的 `open_document`、`read_file` 或 `write_file`。外部 AI 可创建指定类型的空白文档，或枚举并操作已打开文档；不接受路径、文件名、内容或模板来源。需要文件落盘的类型只写入 NexOffice 配置的默认保存目录。这样避免让 MCP bridge 成为通用文件系统入口。

## DEC-02：Slides-first

首个正式支持的编辑器为 Slides。其 PPTX session、事务、撤销/重做和 canonical operation registry 已主要位于 Electron main process，可在不依赖 renderer 私有状态的情况下实现安全的端到端 MVP。

## DEC-03：写入授权

本机 bridge 的随机 token 是外部 AI 调用 MCP 的唯一授权凭据。每次应用启动都会生成新 token，discovery 文件仅允许当前 OS 用户读取；bridge 在请求进入 gateway 前必须完成 token 校验。通过认证的请求可执行所有已公开工具，不显示应用内逐次或逐文档确认对话框。风险等级仍用于工具注册、参数约束和审计，但不再触发原生授权 UI。

## DEC-04：内置云 AI 一并下线

内置对话、模型 provider、Genspark 登录、云搜索和云图像生成均属于待移除范围。外部 AI 负责搜索和生成；NexOffice 只保留经过权限和 schema 校验的文档、媒体插入及保存能力。

## DEC-05：adapter 双分发

MCP adapter 同时以独立 npm 包 `@nexoffice/mcp` 和 NexOffice 安装包内置资源发布。安装包 discovery 文件可公布内置 adapter 的绝对路径；外部客户端也可按自身环境使用 npm 安装的 `nexoffice-mcp` 命令。两种方式连接同一个受认证的本地 bridge。
