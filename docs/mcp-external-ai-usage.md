# GenOffice MCP adapter 使用说明

GenOffice 运行后会在用户数据目录下创建 `mcp/bridge.json`。该文件为当前应用会话提供受限权限的本机 bridge 信息；应用退出后文件和 socket 会失效。

## npm adapter

将 `@genoffice/mcp` 配置为 MCP 客户端的 stdio command：

```json
{
  "command": "genoffice-mcp",
  "args": ["--discovery", "/absolute/path/to/GenOffice/mcp/bridge.json"]
}
```

也可通过环境变量传入 discovery 路径：

```sh
GENOFFICE_MCP_DISCOVERY_PATH=/absolute/path/to/GenOffice/mcp/bridge.json genoffice-mcp
```

## 安装包内置 adapter

安装包创建的 discovery 可能包含 `adapterPath`。MCP 客户端可使用本机 Node.js 启动该 ESM 文件：

```sh
node "<adapterPath from bridge.json>" --discovery "/absolute/path/to/GenOffice/mcp/bridge.json"
```

内置 adapter 和 npm adapter 协议相同；选择 npm adapter 适合集中管理版本，选择内置 adapter 可确保与安装包版本一致。

## 安全与行为

- `create_document` 只接受 `kind`（`docs`、`sheets`、`slides`、`markdown` 或 `pdf`），创建空白文档并返回其 `documentId`；不接受文件路径或名称。
- `create_document({"kind":"slides"})` 会等待空白 deck 的 MCP session 就绪后再返回；可立即调用 Slides 的读取与写入工具，无需客户端 sleep/retry。
- 只可操作用户已经在 GenOffice 中打开的文档，或本次 `create_document` 返回的空白文档；不能由 MCP 按任意本机路径打开文件。
- `documentId` 是临时、不透明标识；关闭 Tab 后立即失效。
- bridge token 是 MCP 写入、保存和删除类操作的唯一授权凭据；认证成功后不会显示应用内确认对话框。应用每次启动都会轮换 token。
- 所有文档写操作使用 `expectedRevision`，过期请求返回 `conflict`。
- discovery 文件权限限制为当前用户；不要复制、上传或提交其中的 token。

本次正式 MVP 验收范围是 Slides 的读取、canonical ops 写入、undo/redo、保存与 Tab 激活。当前 bridge 也会按能力暴露 Docs、Markdown、Sheets 与 PDF 的受限工具；它们的实际可用操作和参数必须以 `tools/list` 的实时 schema 为准，不能据此假定与 Slides 具有相同的端到端保证。

所有类型均不支持任意路径文件访问。当前还没有跨编辑器的通用图片/媒体导入 tool：外部 Agent 生成图片后不能把路径、URL 或任意 bytes 直接交给 Slides、Docs、Markdown 或 Sheets。完整发布范围、复现步骤与已知缺口见 [Slides MCP MVP 验收报告](./slides-mcp-mvp-acceptance.md)。
