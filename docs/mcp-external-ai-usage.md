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
- `create_document({"kind":"markdown"})` 会在默认保存目录创建一个空白 `.md` 文件；因此 Markdown 图片可安全写入该文档同级 `assets/`，而不接受 Agent 指定保存路径。
- 只可操作用户已经在 GenOffice 中打开的文档，或本次 `create_document` 返回的空白文档；不能由 MCP 按任意本机路径打开文件。
- `documentId` 是临时、不透明标识；关闭 Tab 后立即失效。
- bridge token 是 MCP 写入、保存和删除类操作的唯一授权凭据；认证成功后不会显示应用内确认对话框。应用每次启动都会轮换 token。
- 所有文档写操作使用 `expectedRevision`，过期请求返回 `conflict`。
- discovery 文件权限限制为当前用户；不要复制、上传或提交其中的 token。

Docs 与 Markdown 支持 document-scoped blocks 读取、文本插入/替换及受限 `apply_commands`（最多 10 个 `undo`/`redo`）；实际 schema 仍以 `tools/list` 为准。Docs 额外提供 `docs.apply_operations`：它以原生 blocks/runs 原子创建或格式化标题、段落、列表、粗体/斜体/下划线/删除线、字体、字号、前景色、高亮色、对齐和缩进。编辑现有 Docs 时先读取 blocks，使用返回的 `blockId` 与同一 `expectedRevision`；复杂批次可先 `dryRun: true`。该工具不解析 Markdown，`docs.insert_content` / `docs.replace_blocks` 仍只写入字面文本。应先通过 `skills.list` / `skills.read` 阅读内置的 `docs-authoring` 指引。Sheets、PDF 的能力边界也应以该实时 schema 为准。

要一次写入完整的结构化 Markdown（标题、列表、引用、表格、任务列表等），使用 `markdown.set_source({"documentId","expectedRevision","source"})`。它会以 Markdown 语义解析并**整体覆盖**当前文档，`source` 最大 64 KiB；不接受局部 range、路径、URL 或 bytes。`markdown.insert_content` 则始终是追加字面文本：例如传入 `# 标题` 会插入包含井号的正文，而不会创建标题。写入前先通过 `list_open_documents` 或 `create_document` 获取目标，不要向用户索要 `documentId`。

所有类型都不支持任意路径文件访问。Markdown 额外提供受控本地图片流程：discovery 的 `mediaImportDirectory` 是该次会话唯一可写的图片暂存目录。Agent 先把 PNG/JPEG/GIF 写入该目录（文件名，不含路径），调用 `media.stage_image({"fileName":"image.png"})` 获得一次性、连接绑定的 `mediaHandle`，再以 `markdown.insert_image` 写入一个已保存 Markdown 文档。bridge 会校验格式（PNG/JPEG/GIF）、文件大小（≤8 MiB）、像素数（≤24 MP）、路径和软链接，成功 stage 后立刻删除暂存源文件，并把副本写入文档同级 `assets/`。不接受路径、URL 或 base64/bytes；Slides、Docs、Sheets 的图片导入仍属于后续 `MED-01` 范围。完整发布范围、复现步骤与已知缺口见 [Slides MCP MVP 验收报告](./slides-mcp-mvp-acceptance.md)。
