# 外部 AI 通过 MCP 控制 GenOffice：改造方案

## 1. 目标与边界

将 GenOffice 从“应用内置模型、对话面板和 AgentLoop 驱动编辑”改为“外部 AI 客户端通过 MCP 调用 GenOffice 的编辑能力”。GenOffice 仍是文档状态、文件访问、渲染和保存的唯一权威；外部 AI 只负责理解用户意图、规划和调用工具。

本方案目标：

- 删除所有编辑器中的内置 AI 对话 UI 与模型调用链。
- 将文档读取、编辑、撤销、保存等能力以受控 MCP tools 暴露给外部 AI。
- 不降低 Electron sandbox、IPC 校验、文件访问限制和人工编辑的安全性。
- 允许一个正在运行的 GenOffice 实例被本机多个外部 AI 客户端发现和控制。

非目标：

- 不提供公网 MCP 服务，也不让远程客户端直接访问本机文档。
- 不把任意 Electron IPC channel 暴露为 MCP tool。
- 不在第一阶段复刻内置 AgentLoop 的多轮规划、云搜索、图像生成和对话历史。

## 2. 当前架构与问题

目前每个编辑器都有 `AgentLoop -> AgentSkill -> tool executor` 链路：

- `packages/agent-core` 提供模型循环、工具 schema 和调用协议。
- `packages/ai-provider` 在主进程对接内置模型供应商。
- 工具定义及许多执行器位于 renderer，直接依赖 Tiptap、Univer、React refs 或当前选择区。
- Shell 的 `TabManager` 已掌握各编辑器 WebContents，Slides 的文档 session 和操作注册表主要已位于主进程。

这意味着内置聊天 UI 可以移除，但不能直接把 `AgentSkill` 作为 MCP server：它同时携带了内置系统提示词、模型循环和 renderer 私有状态。

## 3. 目标架构

```text
外部 AI 客户端（Claude Desktop / Codex / 自建 Agent）
  │ MCP stdio
  ▼
genoffice-mcp CLI adapter
  │ 本机认证的 Unix domain socket / Windows named pipe
  ▼
GenOffice Shell main process
  ├─ MCP gateway：认证、权限、会话、目标 Tab 路由、审计
  ├─ main-side document adapters（优先 Slides）
  └─ renderer bridge（Docs / Markdown / Sheets / PDF）
       │ 受限 request/response IPC
       ▼
各编辑器的 capability executor
```

### 3.1 传输决策

首选“独立 stdio adapter + 应用内本地 socket bridge”。大多数 MCP 客户端天然支持启动 stdio 命令；而 GenOffice 已经运行时，真正的文档状态在其 Electron main/renderer 进程中，不能由外部 client 启动的独立进程直接持有。

本地 socket 必须：

- 只绑定当前用户可访问的位置。
- 使用启动时随机生成的 bearer token，token 通过受限的本机发现文件传递。
- 按应用生命周期创建和销毁；不得监听 `0.0.0.0`。
- 为 Windows 使用 named pipe，为 macOS/Linux 使用 Unix domain socket。

后续可增加 Streamable HTTP 适配器，但它不是 MVP，且必须单独处理 loopback 攻击、端口发现和认证。

### 3.2 Capability 层重构

新增与模型无关的接口（建议放入 `packages/genoffice-capabilities`）：

```ts
interface CapabilityTool {
  name: string
  description: string
  inputSchema: JsonSchema
  mutates: boolean
  execute(target: DocumentTarget, input: unknown, ctx: ExecutionContext): Promise<ToolResult>
}
```

现有 `AgentSkill` 只作为过渡适配器：它可从 capability tools 组装内部 AgentLoop；MCP server 直接注册同一组 tools。完成迁移后，删除 AgentLoop/AI provider 依赖即可，不影响底层编辑语义。

## 4. 文档目标、版本与并发

所有 MCP tool 必须显式接收 `documentId`，禁止以“当前激活 Tab”作为写操作默认目标。`list_open_documents` 返回：

```ts
{
  documentId: string,
  kind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown',
  title: string,
  path?: string,
  revision: number,
  dirty: boolean,
  active: boolean
}
```

- 读操作返回当前 `revision`。
- 写操作要求 `expectedRevision`；版本不一致时返回 `conflict`，外部 AI 必须重新读取。
- 同一 `documentId` 的写操作串行执行；人工编辑完成后递增 revision。
- 每次成功写入必须复用编辑器既有 undo transaction；批量编辑保持原子性。
- 写操作默认不保存。`save_document` 是独立 tool，且返回最终路径与 revision。

## 5. MCP 工具分层

### 5.1 全局工具（MVP）

- `list_open_documents`
- `activate_document`
- `get_document_status`
- `save_document`
- `undo`
- `redo`
- `close_document`（默认需要应用内确认）

### 5.2 Slides：第一个正式支持的编辑器

Slides 的 deck session、undo/redo 和 canonical op registry 已在主进程，适合作为首个端到端实现。

- `slides.get_deck_context`
- `slides.read_slide`
- `slides.apply_ops`（支持 `dryRun`）
- `slides.add_slide`
- `slides.delete_slide`
- `slides.render_preview`

实现时复用主进程 operation registry；禁止将 `execute_slide_script` 的脚本文本直接变成通用代码执行入口。MCP 对外只暴露校验后的 canonical ops。

### 5.3 Docs 与 Markdown：第二阶段

两者的 Tiptap/ProseMirror editor 在 renderer 中。新增 `mcp:request` / `mcp:response` bridge，由主进程把带 target/revision/requestId 的请求送入指定 WebContents；renderer 仅注册文档能力，不暴露通用 IPC。

首批工具：

- `docs.get_context` / `markdown.get_context`
- `docs.read_blocks` / `markdown.read_blocks`
- `docs.insert_content` / `markdown.insert_content`
- `docs.replace_blocks` / `markdown.replace_blocks`
- `*.apply_commands`

### 5.4 Sheets 与 PDF：第三阶段

- Sheets：将现有 workbook readers、operation proposal/apply 逻辑从 React refs 中提取为 session-scoped adapter。保留 lazy loading、range 限制和 sidecar 校验。
- PDF：将 page/text/form/image 编辑器能力封装为 document-scoped adapter；保留现有 allowed-path 及保存流程。

## 6. 许可、安全与审计

MCP server 必须视外部 AI 为不可信调用方，包括它传来的文档内容、URL 和工具参数。

- 工具按 `read`、`write`、`file`、`destructive` 分类。
- 第一次 write/file/destructive 调用在应用内弹窗授权，可按“本次会话”记忆。
- `delete_*`、覆盖现有文件、关闭未保存文档、批量修改超过阈值时总是再次确认。
- 文件路径只接受已打开文档、用户显式授权目录或应用生成的临时文件；禁止任意绝对路径读写。
- 文本、图片、base64 和批量 ops 设置大小与数量上限。
- 记录本地审计日志：client id、tool、documentId、输入摘要、结果、时间和 revision；不记录完整文档正文或 API key。
- Gateway 在主进程做 schema validation，renderer bridge 仍做业务验证，不信任 gateway 的输入。

## 7. 内置 AI 的下线顺序

1. 增加 MCP capability 层与桥接，不删除现有功能。
2. 用同一 capability 层让内置 AgentLoop 继续运行，完成等价性测试。
3. 默认隐藏各 App 的 `AiPanel`、selection ask、AI Ribbon/Menu 项与聊天记录入口。
4. 删除 renderer 的 AgentLoop、transport、AI panel、内置提示词和相关 i18n。
5. 删除 `ai:stream`、`ai:chat`、provider settings、Genspark 登录及云搜索/图像生成 IPC。
6. 清理 `packages/agent-core`、`packages/ai-provider` 与仅用于聊天的 `project-store` 数据模型；保留项目/文件管理部分。

若仍需要“搜索图片”或“生成图片”，应将它们改为外部 AI 自己的能力；GenOffice 仅保留受控的 `insert_image` / `add_media` 工具。

## 8. 交付阶段与验收标准

### Phase A：基础设施

- 新增 MCP stdio adapter、本机 bridge、认证和 Shell gateway。
- 支持列出/激活文档、状态、保存、撤销、重做。
- 集成测试覆盖未运行应用、token 失效、未知 documentId、断开的 renderer 和并发写入。

### Phase B：Slides MVP

- 实现读取 deck、读取单页、dry-run/apply canonical ops、预览和保存。
- 所有写入可通过 UI undo 撤销；冲突时不发生部分修改。
- 为每个 MCP tool 建立 schema/权限/错误码测试。

### Phase C：Docs 与 Markdown

- 完成 renderer bridge、revision 同步和文本块编辑工具。
- 覆盖 renderer reload、Tab 切换、人工编辑抢占和未保存文档。

### Phase D：Sheets 与 PDF

- 将 workbook/PDF 能力重构为 session-scoped adapters。
- 覆盖大数据范围、懒加载、公式重算、表单、图片和保存回写。

### Phase E：删除内置 AI

- 删除 UI 与 provider 调用链。
- 打包验证不再包含任何模型 API key 设置、Genspark 登录或 `ai:stream` handler。
- 使用 MCP 端到端回归覆盖每个正式支持的编辑器。

## 9. 关键代码落点

- Shell gateway：`apps/shell/src/main/mcp/`（新建）
- MCP adapter：`packages/genoffice-mcp/`（新建可执行包）
- 共享能力协议：`packages/genoffice-capabilities/`（新建）
- Tab/document 路由：`apps/shell/src/main/tab-manager.ts`
- Slides main-side adapter：`apps/slides/src/main/ops/` 与 `apps/slides/src/main/session-state.ts`
- Docs/Markdown renderer bridge：各自 `src/renderer/ai/tools.ts` 的能力逻辑迁移到 `src/renderer/capabilities/`

## 10. 开始实施前的决策

实施前需确认以下产品决策：

1. 外部 AI 是否只允许控制已打开文档，还是可以通过 MCP 打开本机文件。
2. 写操作是每次确认、按 MCP client 授权，还是默认允许并依赖客户端权限提示。
3. 是否保留应用内“AI 设置 / Genspark 登录 / 云图像工具”作为非聊天功能。
4. MCP MVP 的首个文档类型是否接受 Slides 优先；本方案建议接受。
