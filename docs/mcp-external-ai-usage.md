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

- 只可操作用户已经在 GenOffice 中打开的文档。
- `documentId` 是临时、不透明标识；关闭 Tab 后立即失效。
- bridge token 是 MCP 写入、保存和删除类操作的唯一授权凭据；认证成功后不会显示应用内确认对话框。应用每次启动都会轮换 token。
- 所有文档写操作使用 `expectedRevision`，过期请求返回 `conflict`。
- discovery 文件权限限制为当前用户；不要复制、上传或提交其中的 token。

当前 MVP 支持 Slides 的读取、canonical ops 写入、undo/redo、保存和 Tab 激活。Docs、Markdown、Sheets 与 PDF 会在后续阶段逐步开放。
