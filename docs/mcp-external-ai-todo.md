# GenOffice MCP 外部 AI 改造：执行与跟踪清单

关联方案：[外部 AI 通过 MCP 控制 GenOffice：改造方案](./mcp-external-ai-refactor-plan.md)

## 使用规则

- 每一项任务可直接对应一个 Issue 或 PR；完成后勾选并填入 PR 链接。
- `状态` 仅使用：`未开始`、`进行中`、`阻塞`、`已完成`。
- 涉及写入文档的任务必须包含单测或集成测试；不得只做 UI 演示。
- 所有 MCP 写操作必须携带 `documentId` 与 `expectedRevision`，禁止以当前激活 Tab 作为隐式写入目标。

| 字段 | 约定 |
| --- | --- |
| 优先级 | P0：MVP 阻断；P1：首版必需；P2：后续扩展 |
| 负责人 | `TBD` 表示尚未分配 |
| PR | 合并后填 PR/commit 链接 |

## 0. 需先确认的产品决策

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DEC-01 | 确认 MVP 仅控制“已打开文档”，不支持由 MCP 任意打开本机路径。 | P0 | - | 已完成 | Codex | 决策记录在 `mcp-external-ai-decisions.md`。 | |
| DEC-02 | 确认首个支持类型为 Slides。 | P0 | - | 已完成 | Codex | 决策记录在 `mcp-external-ai-decisions.md`。 | |
| DEC-03 | 确认写入授权策略：首次写入按 MCP client 授权，本次会话有效；危险操作每次确认。 | P0 | - | 已完成 | Codex | 决策记录在 `mcp-external-ai-decisions.md`。 | |
| DEC-04 | 确认内置 Genspark 登录、云搜索和图像生成在 MCP MVP 后的处理方式。 | P1 | DEC-01 | 已完成 | Codex | 决策为与内置聊天一并移除，记录在 `mcp-external-ai-decisions.md`。 | |

## 1. 基础设施：MCP adapter 与应用内 gateway

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 代码落点 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INF-01 | 新建 `packages/genoffice-mcp` workspace，提供可执行 stdio MCP adapter。 | P0 | DEC-01 | 进行中 | Codex | `packages/genoffice-mcp/`、根 `package.json` | 已实现 stdio JSON-RPC/MCP tools 子集；待完成打包与真实 Shell 接入。 | |
| INF-02 | 新建 `apps/shell/src/main/mcp/`，定义 gateway 生命周期、请求路由和错误模型。 | P0 | INF-01 | 进行中 | Codex | `apps/shell/src/main/mcp/` | 已实现 private bridge、只读 tool gateway；待写入路由与权限层。 | |
| INF-03 | 实现跨平台本地桥接：macOS/Linux Unix socket、Windows named pipe。 | P0 | INF-02 | 进行中 | Codex | `apps/shell/src/main/mcp/bridge.ts` | 已实现 Unix socket/named pipe 路径；待三平台测试。 | |
| INF-04 | 实现启动时随机 token、受限发现文件和 client 握手。 | P0 | INF-03 | 进行中 | Codex | `apps/shell/src/main/mcp/bridge.ts` | 已实现随机 token 与 0600 discovery；待 Shell 生命周期接入及失效测试。 | |
| INF-05 | 定义稳定的 MCP 错误码与错误 payload。 | P0 | INF-02 | 进行中 | Codex | `packages/genoffice-capabilities/`、gateway | 已定义错误码与 bridge 映射；待 gateway 所有工具采用。 | |
| INF-06 | 将 Shell 的 MCP gateway 注册到应用启动与退出生命周期。 | P0 | INF-02 | 已完成 | Codex | `apps/shell/src/main/index.ts` | Shell 启动后创建 bridge，退出时撤销 discovery 并关闭 socket；崩溃后随机 token/endpoint 自动失效。 | |
| INF-07 | 更新 electron-vite / electron-builder 配置，确保 adapter 在开发与三端打包产物可执行。 | P0 | INF-01 | 未开始 | TBD | `apps/shell/electron-builder.cjs`、构建脚本 | macOS/Windows/Linux 打包检查可找到 adapter，且不依赖 monorepo 相对路径。 | |

## 2. 共享能力协议与文档路由

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 代码落点 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAP-01 | 新建 `packages/genoffice-capabilities`，定义 `CapabilityTool`、`DocumentTarget`、`ToolResult` 与 JSON Schema 类型。 | P0 | - | 已完成 | Codex | `packages/genoffice-capabilities/` | 无 Electron/React/AI provider 依赖；可被 main、renderer、adapter 共同引用。 | |
| CAP-02 | 定义 `DocumentSummary` 与 `DocumentId` 规则；DocumentId 在 Tab 生命周期内稳定且不可猜测。 | P0 | CAP-01 | 已完成 | Codex | capabilities + `TabManager` | Tab 创建时生成随机 opaque ID；只读列表不含路径，关闭 Tab 后无法再解析。 | |
| CAP-03 | 为所有文档引入单调递增 `revision`；人工或 MCP 写入都会更新 revision。 | P0 | CAP-02 | 未开始 | TBD | 各 app session/state adapter | 相同 revision 的并发写入仅允许一个成功，另一个返回 `conflict`。 | |
| CAP-04 | 在 `TabManager` 中实现 documentId → WebContents/adapter 的显式路由。 | P0 | CAP-02 | 已完成 | Codex | `apps/shell/src/main/tab-manager.ts` | 通过 documentId 精确查询后台 Tab 的 target，不以 active Tab 作为隐式目标。 | |
| CAP-05 | 实现全局只读 tools：`list_open_documents`、`get_document_status`。 | P0 | CAP-04 | 已完成 | Codex | shell gateway | 已实现显式 documentId 状态查询、未知/关闭文档错误和参数校验单测。 | |
| CAP-06 | 实现全局写 tools：`activate_document`、`save_document`、`undo`、`redo`。 | P0 | CAP-03 | 未开始 | TBD | shell gateway + app adapters | 所有写工具需要 expectedRevision；保存后返回 path/revision；已有 UI undo/redo 语义不变。 | |
| CAP-07 | 建立每个 documentId 的串行写队列与请求取消策略。 | P0 | CAP-03 | 未开始 | TBD | shell gateway | 同文档写请求按顺序执行；客户端断开时未开始请求被取消，执行中的操作安全收尾。 | |

## 3. 权限、确认、审计与输入限制

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 代码落点 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | 定义工具风险元数据：`read`、`write`、`file`、`destructive`。 | P0 | CAP-01 | 未开始 | TBD | `packages/genoffice-capabilities/` | 每个公开 tool 声明风险等级；未声明的 tool 不得注册。 | |
| SEC-02 | 实现应用内 MCP 授权对话框与“本次会话允许”存储。 | P0 | INF-04, SEC-01 | 未开始 | TBD | `apps/shell/src/main/mcp/permissions.ts` | 首次 write/file/destructive 调用须获得用户授权；拒绝后不执行。 | |
| SEC-03 | 为删除、关闭未保存文档、覆盖文件、超过阈值的批量写入增加强制二次确认。 | P0 | SEC-02 | 未开始 | TBD | gateway + adapter metadata | 每次危险调用都出现准确的文档名和变更摘要。 | |
| SEC-04 | 实现审计日志（client、tool、documentId、输入摘要、结果、revision、时间）。 | P1 | INF-04 | 未开始 | TBD | `apps/shell/src/main/mcp/audit.ts` | 日志不包含正文、base64、token、API key；rotation/大小上限有测试。 | |
| SEC-05 | 统一限制参数深度、payload 大小、base64 大小、数组长度和单次批量 op 数量。 | P0 | CAP-01 | 进行中 | Codex | adapter/bridge schema guard | 已限制 stdio/bridge 单行 1 MiB；待补充结构、base64 与 op 限制。 | |
| SEC-06 | 完成 MCP threat model，并更新 `SECURITY.md`。 | P1 | SEC-01..05 | 未开始 | TBD | `SECURITY.md` | 覆盖本机 token、恶意 MCP client、文档 prompt injection、renderer 崩溃、文件路径与审计。 | |

## 4. Slides MVP

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 代码落点 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SLD-01 | 将 Slides session 适配为 `DocumentTarget`，暴露 revision、dirty、path、title。 | P0 | CAP-03 | 未开始 | TBD | `apps/slides/src/main/session-state.ts` | 多个 Slides Tab 对应独立 target；关闭时自动注销。 | |
| SLD-02 | 从现有 operation registry 导出经验证的 canonical ops facade。 | P0 | CAP-01 | 未开始 | TBD | `apps/slides/src/main/ops/` | 不允许外部传入内部 `source` / archive bytes / 任意脚本。 | |
| SLD-03 | 实现 `slides.get_deck_context`。 | P0 | SLD-01 | 未开始 | TBD | `apps/slides/src/main/mcp-adapter.ts` | 返回页数、页面 IDs、元素摘要、revision；正文与结果有大小上限。 | |
| SLD-04 | 实现 `slides.read_slide`。 | P0 | SLD-01 | 未开始 | TBD | 同上 | 指定 slideId/索引后返回完整可编辑元素信息；无效目标返回 not_found。 | |
| SLD-05 | 实现 `slides.apply_ops`，支持 `dryRun` 与 `expectedRevision`。 | P0 | SLD-02, CAP-07, SEC-02 | 未开始 | TBD | 同上 | dryRun 不改变 session；失败时原子回滚；成功后仅产生一个 UI undo step。 | |
| SLD-06 | 实现 `slides.add_slide`、`slides.delete_slide`。 | P1 | SLD-05, SEC-03 | 未开始 | TBD | 同上 | 插入/删除、undo、redo、保存/重新打开均正确。 | |
| SLD-07 | 实现 `slides.render_preview`，返回受限尺寸 PNG 或应用生成的临时资源句柄。 | P1 | SLD-03 | 未开始 | TBD | 同上 | 不暴露任意文件路径；临时资源有 TTL 清理。 | |
| SLD-08 | 为 Slides MCP 流程写集成测试：读 → dry-run → 写 → undo → redo → save。 | P0 | SLD-03..06 | 未开始 | TBD | `apps/slides/tests/`、shell tests | 测试使用真实 session，覆盖冲突、取消、Tab 切换与 renderer 销毁。 | |

## 5. Docs 与 Markdown：renderer bridge

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 代码落点 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RBR-01 | 定义主进程 ↔ renderer 的专用 `mcp:request` / `mcp:response` 协议。 | P0 | CAP-01, SEC-05 | 未开始 | TBD | shared IPC + preload | 请求含 requestId/documentId/revision；无通用 `invoke(channel,args)` 逃逸口。 | |
| RBR-02 | 实现 renderer 请求超时、销毁检测和取消；gateway 将错误映射为标准 MCP 错误。 | P0 | RBR-01 | 未开始 | TBD | shell gateway + preload | renderer reload/destroy 不会导致请求永久挂起。 | |
| DOC-01 | 将 Docs AI tools 中与模型无关的编辑能力提取到 renderer capability adapter。 | P1 | RBR-01 | 未开始 | TBD | `apps/docs/src/renderer/capabilities/` | 不依赖 AiPanel/AgentLoop；保留已有 block/command 验证。 | |
| DOC-02 | 实现 Docs 读取与写入 tools：context、read_blocks、insert_content、replace_blocks、apply_commands。 | P1 | DOC-01, CAP-03, SEC-02 | 未开始 | TBD | Docs adapter | 人工编辑造成版本冲突时无写入；每次成功写入进入现有 undo 栈。 | |
| DOC-03 | 为 Docs bridge 写集成测试。 | P1 | DOC-02 | 未开始 | TBD | `apps/docs/tests/` | 覆盖 selection 不作为隐式写入目标、reload、关闭、撤销和保存。 | |
| MD-01 | 将 Markdown AI tools 提取到 renderer capability adapter。 | P1 | RBR-01 | 未开始 | TBD | `apps/markdown/src/renderer/capabilities/` | 不依赖 AiPanel/AgentLoop。 | |
| MD-02 | 实现 Markdown context/read/insert/replace/commands MCP tools。 | P1 | MD-01, CAP-03, SEC-02 | 未开始 | TBD | Markdown adapter | 真实 `.md` 文档读写、undo/redo、保存回写可用。 | |
| MD-03 | 为 Markdown bridge 写集成测试。 | P1 | MD-02 | 未开始 | TBD | `apps/markdown/tests/` | 覆盖路径安全、本地图片限制、冲突与重载。 | |

## 6. Sheets 与 PDF：能力提取

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 代码落点 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SHT-01 | 盘点并拆分 Sheets 的 workbook readers 与 operation apply 依赖，形成 session-scoped adapter 设计。 | P1 | CAP-01 | 未开始 | TBD | `apps/sheets/src/renderer/ai/`、`src/main/` | 明确哪些能力移到 main，哪些经 renderer bridge 调用。 | |
| SHT-02 | 实现 Sheets 只读 tools：context、range、formats、find、aggregate、formula trace。 | P1 | SHT-01, RBR-01 | 未开始 | TBD | Sheets adapter | 保留 2,000 cells 与 lazy-load 限制；大范围读取不会耗尽内存。 | |
| SHT-03 | 实现 Sheets `propose_operations` 的 MCP 等价工具（改名为 `sheets.apply_operations`）。 | P1 | SHT-02, CAP-07, SEC-02 | 未开始 | TBD | Sheets adapter | 支持 dry-run、版本冲突、异步公式重算和 undo。 | |
| SHT-04 | 为 Sheets 写端到端测试。 | P1 | SHT-02..03 | 未开始 | TBD | `apps/sheets/tests/` | 覆盖真实 xlsx、懒加载、公式、结构修改、保存回写。 | |
| PDF-01 | 盘点 PDF AI tools 的 renderer/main 依赖，定义 document-scoped adapter。 | P1 | CAP-01 | 未开始 | TBD | `apps/pdf/src/renderer/ai/`、`src/main/` | 列出 text/annotation/form/image/page 操作和风险等级。 | |
| PDF-02 | 实现 PDF 只读 tools：page context、search、annotations、forms、outline。 | P2 | PDF-01, RBR-01 | 未开始 | TBD | PDF adapter | 不读取未授权文件；大 PDF 输出分页/限额。 | |
| PDF-03 | 实现 PDF 写 tools：text/annotation/form/image/page 操作。 | P2 | PDF-02, SEC-02, SEC-03 | 未开始 | TBD | PDF adapter | 每项可撤销或在保存前保留内存修改；破坏性页面操作强制确认。 | |
| PDF-04 | 为 PDF 写端到端测试。 | P2 | PDF-02..03 | 未开始 | TBD | `apps/pdf/tests/` | 覆盖保存、取消、页面删除确认、renderer 销毁。 | |

## 7. 下线内置 AI

此部分只能在正式支持的 MCP tools 达到等价验收后开始。每个 App 单独移除，避免一次性大范围删除。

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 代码落点 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SUN-01 | 隐藏并移除 Slides 的 AiPanel、Ask AI、AI 菜单/Ribbon 入口。 | P1 | SLD-08 | 未开始 | TBD | `apps/slides/src/renderer/ai/`、App/Ribbon | 不再渲染对话 UI；手工 Slides 编辑与 MCP MVP 回归通过。 | |
| SUN-02 | 隐藏并移除 Docs/Markdown 的 AI 面板与快捷入口。 | P1 | DOC-03, MD-03 | 未开始 | TBD | 对应 renderer/App/Ribbon | 无残留 `toggle-ai`、AI proofread 或聊天存储写入。 | |
| SUN-03 | 隐藏并移除 Sheets/PDF 的 AI 面板。 | P2 | SHT-04, PDF-04 | 未开始 | TBD | 对应 renderer | UI 与非 AI 编辑功能均回归通过。 | |
| SUN-04 | 删除内部 `ai:stream`、`ai:chat`、provider settings 和相关 preload IPC。 | P1 | SUN-01..03, DEC-04 | 未开始 | TBD | docs/shell/main、各 preload/shared IPC | `rg 'ai:stream|ai:chat' apps packages` 仅剩迁移说明或零结果。 | |
| SUN-05 | 删除 `packages/ai-provider`、`packages/agent-core` 和仅用于聊天的 project-store 逻辑。 | P2 | SUN-04 | 未开始 | TBD | workspaces/package manifests | 全仓 typecheck、测试、打包通过，无悬挂 workspace 依赖。 | |
| SUN-06 | 清理 AI 专属 i18n、图片、测试和文档；更新 README/隐私/安全说明。 | P1 | SUN-04 | 未开始 | TBD | 全仓 | 用户文档准确描述“外部 AI + MCP”模式。 | |

## 8. 持续质量门禁

| ID | 任务 | 优先级 | 依赖 | 状态 | 负责人 | 验收标准 | PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QLT-01 | 为 MCP adapter 建立协议级测试（握手、tools/list、tools/call、错误、取消）。 | P0 | INF-01..05 | 进行中 | Codex | 已新增 adapter/bridge Vitest 用例；待依赖恢复后纳入 CI 执行。 | |
| QLT-02 | 为 gateway 建立安全回归测试。 | P0 | SEC-01..05 | 未开始 | TBD | 覆盖无 token、恶意 payload、越权文档、危险操作拒绝、路径攻击。 | |
| QLT-03 | 新增 Shell + Slides 端到端 MCP smoke test，并接入 CI。 | P0 | SLD-08 | 未开始 | TBD | 启动 Shell、启动 adapter、调用 tools、验证 `.pptx` 修改与 undo。 | |
| QLT-04 | 为 Docs/Markdown/Sheets/PDF 逐步增加相同 smoke test。 | P1 | 各 App MCP 测试 | 未开始 | TBD | 每个已声明支持的文档类型都有 CI 覆盖。 | |
| QLT-05 | 在 CI 中运行 `npm run typecheck`、受影响 workspace tests、`npm run lint`、`npm run format:check`。 | P0 | INF-01 | 未开始 | TBD | MCP PR 的 required checks 可阻止未通过合并。 | |
| QLT-06 | 执行 macOS、Windows、Linux 打包冒烟验证。 | P1 | INF-07, QLT-03 | 未开始 | TBD | 三个平台都能启动 Shell 和 adapter，且能完成授权与 Slides 基础调用。 | |

## 9. MVP 完成定义

以下全部完成，才可宣布“GenOffice Slides MCP MVP 可用”：

- [ ] DEC-01、DEC-02、DEC-03 已记录。
- [ ] INF-01 至 INF-06、CAP-01 至 CAP-07、SEC-01 至 SEC-05 已完成。
- [ ] SLD-01 至 SLD-08 已完成。
- [ ] QLT-01、QLT-02、QLT-03、QLT-05 已完成并在 CI 运行。
- [ ] 外部 MCP 客户端可列出、读取并编辑指定的已打开 Slides 文档。
- [ ] 写入具备权限确认、revision 冲突保护、原子回滚、UI undo/redo 和显式保存。
- [ ] 内置 Slides AI UI 仍可保留作为迁移期回退，但不得与 MCP 写操作绕过同一 revision/权限边界。

## 10. 每周跟踪模板

复制以下段落到周报或 Issue：

```md
### MCP 改造周报（YYYY-MM-DD）

- 本周完成：
- 进行中：
- 阻塞项：
- 下周计划：
- 风险/需决策：
- 已合并 PR：
- CI 状态：
```
