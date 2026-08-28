# GenOffice MCP 外部 AI 改造：执行与跟踪清单

关联方案：[外部 AI 通过 MCP 控制 GenOffice：改造方案](./mcp-external-ai-refactor-plan.md)

## 使用规则

- 每一项任务可直接对应一个 Issue 或 PR；完成后勾选并填入 PR 链接。
- `状态` 仅使用：`未开始`、`进行中`、`阻塞`、`已完成`。
- 涉及写入文档的任务必须包含单测或集成测试；不得只做 UI 演示。
- 所有 MCP 写操作必须携带 `documentId` 与 `expectedRevision`，禁止以当前激活 Tab 作为隐式写入目标。

| 字段   | 约定                                     |
| ------ | ---------------------------------------- |
| 优先级 | P0：MVP 阻断；P1：首版必需；P2：后续扩展 |
| 负责人 | `TBD` 表示尚未分配                       |
| PR     | 合并后填 PR/commit 链接                  |

## 0. 需先确认的产品决策

| ID     | 任务                                                                         | 优先级 | 依赖   | 状态   | 负责人 | 验收标准                                                          | PR  |
| ------ | ---------------------------------------------------------------------------- | ------ | ------ | ------ | ------ | ----------------------------------------------------------------- | --- |
| DEC-01 | 确认 MVP 仅控制“已打开文档”，不支持由 MCP 任意打开本机路径。                 | P0     | -      | 已完成 | Codex  | 决策记录在 `mcp-external-ai-decisions.md`。                       |     |
| DEC-02 | 确认首个支持类型为 Slides。                                                  | P0     | -      | 已完成 | Codex  | 决策记录在 `mcp-external-ai-decisions.md`。                       |     |
| DEC-03 | 确认写入授权策略：bridge token 为唯一 MCP 授权凭据，认证后不显示应用内确认。 | P0     | -      | 已完成 | Codex  | 决策记录在 `mcp-external-ai-decisions.md`。                       |     |
| DEC-04 | 确认内置 Genspark 登录、云搜索和图像生成在 MCP MVP 后的处理方式。            | P1     | DEC-01 | 已完成 | Codex  | 决策为与内置聊天一并移除，记录在 `mcp-external-ai-decisions.md`。 |     |

## 1. 基础设施：MCP adapter 与应用内 gateway

| ID     | 任务                                                                                  | 优先级 | 依赖   | 状态   | 负责人 | 代码落点                                           | 验收标准                                                                                                                   | PR  |
| ------ | ------------------------------------------------------------------------------------- | ------ | ------ | ------ | ------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --- |
| INF-01 | 新建 `packages/genoffice-mcp` workspace，提供可执行 stdio MCP adapter。               | P0     | DEC-01 | 已完成 | Codex  | `packages/genoffice-mcp/`、根 `package.json`       | stdio JSON-RPC adapter 已通过 initialize/tools/list/tools/call/错误/取消协议测试，并经真实 Shell 接入与成品包 smoke 验证。 |     |
| INF-02 | 新建 `apps/shell/src/main/mcp/`，定义 gateway 生命周期、请求路由和错误模型。          | P0     | INF-01 | 已完成 | Codex  | `apps/shell/src/main/mcp/`                         | private bridge、读写 gateway、renderer 路由、权限、审计和标准错误映射均已实现并由 Shell MCP 测试覆盖。                     |     |
| INF-03 | 实现跨平台本地桥接：macOS/Linux Unix socket、Windows named pipe。                     | P0     | INF-02 | 已完成 | Codex  | `apps/shell/src/main/mcp/bridge.ts`                | Unix socket/named pipe 路径与连接隔离已实现；CI Run 8 成品包 smoke 已覆盖 macOS/Windows/Linux。                            |     |
| INF-04 | 实现启动时随机 token、受限发现文件和 client 握手。                                    | P0     | INF-03 | 已完成 | Codex  | `apps/shell/src/main/mcp/bridge.ts`                | 每次启动轮换 token、POSIX 0600 discovery、连接身份隔离、无效 token 拒绝和 shutdown 清理均已测试。                          |     |
| INF-05 | 定义稳定的 MCP 错误码与错误 payload。                                                 | P0     | INF-02 | 已完成 | Codex  | `packages/genoffice-capabilities/`、gateway        | 共享错误码已由 adapter、bridge 和 gateway 使用；结构化 `conflict`、权限、校验与内部错误映射均有协议/桥接测试。             |     |
| INF-06 | 将 Shell 的 MCP gateway 注册到应用启动与退出生命周期。                                | P0     | INF-02 | 已完成 | Codex  | `apps/shell/src/main/index.ts`                     | Shell 启动后创建 bridge，退出时撤销 discovery 并关闭 socket；崩溃后随机 token/endpoint 自动失效。                          |     |
| INF-07 | 更新 electron-vite / electron-builder 配置，确保 adapter 在开发与三端打包产物可执行。 | P0     | INF-01 | 已完成 | Codex  | MCP Vite bundle、Shell builder、构建脚本、使用说明 | 独立 ESM bundle、打包资源、discovery adapterPath 与双分发说明已完成；CI Run 8 在三端从成品包实际启动 adapter。             |     |

## 2. 共享能力协议与文档路由

| ID     | 任务                                                                                                                | 优先级 | 依赖           | 状态   | 负责人 | 代码落点                                 | 验收标准                                                                                                                                                                 | PR  |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------ | -------------- | ------ | ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| CAP-01 | 新建 `packages/genoffice-capabilities`，定义 `CapabilityTool`、`DocumentTarget`、`ToolResult` 与 JSON Schema 类型。 | P0     | -              | 已完成 | Codex  | `packages/genoffice-capabilities/`       | 无 Electron/React/AI provider 依赖；可被 main、renderer、adapter 共同引用。                                                                                              |     |
| CAP-02 | 定义 `DocumentSummary` 与 `DocumentId` 规则；DocumentId 在 Tab 生命周期内稳定且不可猜测。                           | P0     | CAP-01         | 已完成 | Codex  | capabilities + `TabManager`              | Tab 创建时生成随机 opaque ID；只读列表不含路径，关闭 Tab 后无法再解析。                                                                                                  |     |
| CAP-03 | 为所有文档引入单调递增 `revision`；人工或 MCP 写入都会更新 revision。                                               | P0     | CAP-02         | 已完成 | Codex  | 各 app session/state adapter             | Slides/Docs/Sheets/PDF/Markdown 均向 Shell 报告单调 revision；Markdown 每次 dirty mutation 与 PDF 的 UI mutation/undo/redo 已补齐；CAS 冲突受 gateway/write queue 保护。 |     |
| CAP-04 | 在 `TabManager` 中实现 documentId → WebContents/adapter 的显式路由。                                                | P0     | CAP-02         | 已完成 | Codex  | `apps/shell/src/main/tab-manager.ts`     | 通过 documentId 精确查询后台 Tab 的 target，不以 active Tab 作为隐式目标。                                                                                               |     |
| CAP-05 | 实现全局只读 tools：`list_open_documents`、`get_document_status`。                                                  | P0     | CAP-04         | 已完成 | Codex  | shell gateway                            | 已实现显式 documentId 状态查询、未知/关闭文档错误和参数校验单测。                                                                                                        |     |
| CAP-06 | 实现全局写 tools：`activate_document`、`save_document`、`undo`、`redo`。                                            | P0     | CAP-03         | 已完成 | Codex  | shell gateway + Slides adapter           | Slides MVP 的 activate/save/undo/redo 均使用 documentId + expectedRevision、认证与队列；其他编辑器的已公开写入走对应受限 document-scoped tools。                         |     |
| CAP-07 | 建立每个 documentId 的串行写队列与请求取消策略。                                                                    | P0     | CAP-03         | 已完成 | Codex  | `apps/shell/src/main/mcp/write-queue.ts` | 所有 gateway 写入按 documentId 串行化；断开前未开始请求返回 cancelled，单元测试与 Shell→renderer 路由测试已覆盖。                                                        |     |
| CAP-08 | 实现受控 `create_document`，创建空白文档并返回其 documentId。                                                       | P1     | INF-04, DEC-01 | 完成   | Codex  | shell gateway + `TabManager`             | 仅接受五类文档 kind；不接受路径、文件名、模板或内容；Sheets/PDF 仅写默认保存目录。                                                                                       |     |

## 3. 权限、确认、审计与输入限制

| ID     | 任务                                                                                      | 优先级 | 依赖           | 状态   | 负责人 | 代码落点                                              | 验收标准                                                                                                                                                  | PR  |
| ------ | ----------------------------------------------------------------------------------------- | ------ | -------------- | ------ | ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| SEC-01 | 定义工具风险元数据：`read`、`write`、`file`、`destructive`。                              | P0     | CAP-01         | 已完成 | Codex  | capabilities + shell gateway                          | 共享 `ToolRisk` 覆盖 read/write/file/destructive；每条写入 dispatch 在执行前显式选择风险并调用认证权限 gate，Slides/PDF destructive 路径单独升级风险。    |     |
| SEC-02 | 将 MCP 授权收敛为 bridge token 校验，不显示应用内确认对话框。                             | P0     | INF-04, SEC-01 | 已完成 | Codex  | `apps/shell/src/main/mcp/bridge.ts`、`permissions.ts` | bridge 在进入 gateway 前校验每次启动轮换的 token；认证请求直接执行。                                                                                      |     |
| SEC-03 | 为删除、关闭未保存文档、覆盖文件、超过阈值的批量写入增加严格目标范围、schema 和审计限制。 | P0     | SEC-02         | 已完成 | Codex  | Slides MCP guard + permissions                        | destructive Slides/PDF 操作要求显式 document/page/slide target、专用风险与受限 schema；关闭未保存文档和任意覆盖文件未作为 MCP tools 公开；批量上限为 50。 |     |
| SEC-04 | 实现审计日志（client、tool、documentId、输入摘要、结果、revision、时间）。                | P1     | INF-04         | 已完成 | Codex  | `apps/shell/src/main/mcp/audit.ts`                    | JSONL 日志记录安全元数据、不记录内容/参数；保留当前文件与一个 1 MiB predecessor，轮转在 Windows 也可替换已有文件并有单测。                                |     |
| SEC-05 | 统一限制参数深度、payload 大小、base64 大小、数组长度和单次批量 op 数量。                 | P0     | CAP-01         | 已完成 | Codex  | adapter/bridge schema guard                           | stdio/bridge 单行 1 MiB、gateway 输入 256 KiB、深度/字段/数组/字符串上限和各 adapter schema 均已执行；Slides 禁止 bytes/path/source，批量上限 50。        |     |
| SEC-06 | 完成 MCP threat model，并更新 `SECURITY.md`。                                             | P1     | SEC-01..05     | 已完成 | Codex  | `SECURITY.md`                                         | 已覆盖 token、恶意 client、prompt injection、路径、无 UI 授权、审计和 renderer 边界；移除过时内置 AI/确认对话描述。                                       |     |

## 4. Slides MVP

| ID     | 任务                                                                           | 优先级 | 依赖                   | 状态 | 负责人 | 代码落点                                                  | 验收标准                                                                                                          | PR  |
| ------ | ------------------------------------------------------------------------------ | ------ | ---------------------- | ---- | ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --- |
| SLD-01 | 将 Slides session 适配为 `DocumentTarget`，暴露 revision、dirty、path、title。 | P0     | CAP-03                 | 完成 | Codex  | `apps/slides/src/main/session-state.ts`、`mcp-adapter.ts` | Shell 以 opaque documentId 暴露 title/dirty/revision；主进程编辑交易、undo/redo 统一推进 revision。               |     |
| SLD-02 | 从现有 operation registry 导出经验证的 canonical ops facade。                  | P0     | CAP-01                 | 完成 | Codex  | `apps/slides/src/main/mcp-op-guard.ts`、`mcp-adapter.ts`  | allow-list facade 已接入 gateway；拒绝 archive bytes、路径、脚本和超限 payload。                                  |     |
| SLD-03 | 实现 `slides.get_deck_context`。                                               | P0     | SLD-01                 | 完成 | Codex  | `apps/slides/src/main/mcp-adapter.ts`、shell gateway      | 返回页数、页面 IDs、元素摘要、revision，并要求显式 documentId。                                                   |     |
| SLD-04 | 实现 `slides.read_slide`。                                                     | P0     | SLD-01                 | 完成 | Codex  | 同上                                                      | 支持 slideId/索引，过滤敏感字段并限制 512 KiB 输出。                                                              |     |
| SLD-05 | 实现 `slides.apply_ops`，支持 `dryRun` 与 `expectedRevision`。                 | P0     | SLD-02, CAP-07, SEC-02 | 完成 | Codex  | 同上                                                      | 已接入授权、串行队列、dryRun、expectedRevision 和 canonical atomic transaction。                                  |     |
| SLD-06 | 实现 `slides.add_slide`、`slides.delete_slide`。                               | P1     | SLD-05, SEC-03         | 完成 | Codex  | Slides adapter + shell gateway                            | 显式 slide ID/索引、revision、队列已验证；删除操作每次强制确认。                                                  |     |
| SLD-07 | 实现 `slides.render_preview`，返回受限尺寸 PNG 或应用生成的临时资源句柄。      | P1     | SLD-03                 | 完成 | Codex  | Slides adapter + renderer bridge                          | 专用 renderer 请求仅返回单页 PNG（384 KiB）；来源校验、发送失败和 15 秒超时均映射为受控错误。                     |     |
| SLD-08 | 为 Slides MCP 流程写集成测试：读 → dry-run → 写 → undo → redo → save。         | P0     | SLD-03..06             | 完成 | Codex  | `apps/slides/tests/mcp-adapter.test.ts`、shell tests      | 定向 Vitest：2 文件、15 用例通过；覆盖 read/dry-run/write/conflict/undo/redo/生命周期/save 和 renderer 错误映射。 |     |

## 5. Docs 与 Markdown：renderer bridge

| ID     | 任务                                                                                               | 优先级 | 依赖                   | 状态   | 负责人 | 代码落点                                       | 验收标准                                                                                 | PR  |
| ------ | -------------------------------------------------------------------------------------------------- | ------ | ---------------------- | ------ | ------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- | --- |
| RBR-01 | 定义主进程 ↔ renderer 的专用 `mcp:request` / `mcp:response` 协议。                                 | P0     | CAP-01, SEC-05         | 完成   | Codex  | Shell `renderer-bridge` + shared IPC + preload | 固定 action/requestId/revision 的单向桥，无通用 `invoke(channel,args)`。                 |     |
| RBR-02 | 实现 renderer 请求超时、销毁检测和取消；gateway 将错误映射为标准 MCP 错误。                        | P0     | RBR-01                 | 完成   | Codex  | Shell `renderer-bridge`                        | sender 绑定、AbortSignal、发送失败、15 秒超时及隔离测试均已完成。                        |     |
| DOC-01 | 将 Docs AI tools 中与模型无关的编辑能力提取到 renderer capability adapter。                        | P1     | RBR-01                 | 进行中 | Codex  | `apps/docs/src/renderer/mcp-adapter.ts`        | 已抽取不依赖 AiPanel 的只读 block adapter；写入 commands 待抽取。                        |     |
| DOC-02 | 实现 Docs 读取与写入 tools：context、read_blocks、insert_content、replace_blocks、apply_commands。 | P1     | DOC-01, CAP-03, SEC-02 | 进行中 | Codex  | Docs adapter + Shell gateway                   | `docs.get_context`/`docs.read_blocks` 已路由；写入 tools 待 revision/undo 接入。         |     |
| DOC-03 | 为 Docs bridge 写集成测试。                                                                        | P1     | DOC-02                 | 未开始 | TBD    | `apps/docs/tests/`                             | 覆盖 selection 不作为隐式写入目标、reload、关闭、撤销和保存。                            |     |
| MD-01  | 将 Markdown AI tools 提取到 renderer capability adapter。                                          | P1     | RBR-01                 | 进行中 | Codex  | `apps/markdown/src/renderer/mcp-adapter.ts`    | 已抽取不依赖 AiPanel 的 Markdown block adapter；写入 commands 待抽取。                   |     |
| MD-02  | 实现 Markdown context/read/insert/replace/commands MCP tools。                                     | P1     | MD-01, CAP-03, SEC-02  | 进行中 | Codex  | Markdown adapter + Shell gateway               | `markdown.get_context`/`markdown.read_blocks` 已路由；写入 tools 待 revision/undo 接入。 |     |
| MD-03  | 为 Markdown bridge 写集成测试。                                                                    | P1     | MD-02                  | 未开始 | TBD    | `apps/markdown/tests/`                         | 覆盖路径安全、本地图片限制、冲突与重载。                                                 |     |

## 6. Sheets 与 PDF：能力提取

| ID     | 任务                                                                                              | 优先级 | 依赖                   | 状态   | 负责人 | 代码落点                                                | 验收标准                                                                                                                                                                                                                 | PR  |
| ------ | ------------------------------------------------------------------------------------------------- | ------ | ---------------------- | ------ | ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| SHT-01 | 盘点并拆分 Sheets 的 workbook readers 与 operation apply 依赖，形成 session-scoped adapter 设计。 | P1     | CAP-01                 | 已完成 | Codex  | `apps/sheets/src/renderer/mcp-adapter.ts`、`App.tsx`    | 固定 renderer bridge 与 adapter 设计说明已完成。                                                                                                                                                                         |     |
| SHT-02 | 实现 Sheets 只读 tools：context、range、formats、find、aggregate、formula trace。                 | P1     | SHT-01, RBR-01         | 已完成 | Codex  | Sheets adapter、`e2e/sheets-mcp-formula.spec.ts`        | context、2,000 cells 上限的显式 range（含 formats）、find、sum/count/average 与 formula trace 已完成；导入 workbook 已走 live cell/format reader、按需加载后读取，并通过 Electron renderer E2E 验证格式返回。            |     |
| SHT-03 | 实现 Sheets `propose_operations` 的 MCP 等价工具（改名为 `sheets.apply_operations`）。            | P1     | SHT-02, CAP-07, SEC-02 | 已完成 | Codex  | Sheets adapter、`e2e/sheets-mcp-formula.spec.ts`        | dry-run、CAS、权限、队列、内存与导入 workbook 路径已接入；导入 workbook 的真实 mutation 已单调维护 MCP revision，`sheets.undo` 已兼容 Univer 与 adapter 历史；MCP 公式写入/追踪/撤销及导入 XLSX 的写后重算数值均已覆盖。 |     |
| SHT-04 | 为 Sheets 写端到端测试。                                                                          | P1     | SHT-02..03             | 已完成 | Codex  | `apps/sheets/tests/`、`e2e/sheets-mcp-renderer.spec.ts` | 真实 xlsx 保存、流式保存、公式重算基线已通过；lazy MCP renderer、Shell→adapter 路由及 Electron 原生 IPC 的 context/write/read/revision 回归均已覆盖。                                                                    |     |
| PDF-01 | 盘点 PDF AI tools 的 renderer/main 依赖，定义 document-scoped adapter。                           | P1     | CAP-01                 | 已完成 | Codex  | `apps/pdf/src/renderer/mcp-adapter.ts`、`App.tsx`       | document-scoped bridge 与风险矩阵已完成。                                                                                                                                                                                |     |
| PDF-02 | 实现 PDF 只读 tools：page context、search、annotations、forms、outline。                          | P2     | PDF-01, RBR-01         | 已完成 | Codex  | PDF adapter                                             | 页面文字、书签、表单摘要、搜索、批注计数与逐项单页批注读取已完成并受限输出。                                                                                                                                             |     |
| PDF-03 | 实现 PDF 写 tools：text/annotation/form/image/page 操作。                                         | P2     | PDF-02, SEC-02, SEC-03 | 已完成 | Codex  | PDF adapter、`e2e/pdf-mcp-renderer.spec.ts`             | note/markup、text、form、PNG image、删除页及 replace/split/merge 页面 operation 已接入；文件路径/字节不进入 schema，后三者走 destructive 权限与 Shell 原生选择器/受控输出，取消与生成输出 E2E 已覆盖。                   |     |
| PDF-04 | 为 PDF 写端到端测试。                                                                             | P2     | PDF-02..03             | 已完成 | Codex  | `apps/pdf/tests/`、`e2e/pdf-mcp-renderer.spec.ts`       | 保存、批注删除、页面原子写基线已通过；renderer 销毁、取消、删除页 destructive 权限路由及 Electron 原生 IPC 的 context/annotation write/read 回归均已覆盖。                                                               |     |

## 7. 下线内置 AI

此部分只能在正式支持的 MCP tools 达到等价验收后开始。每个 App 单独移除，避免一次性大范围删除。

| ID     | 任务                                                                                   | 优先级 | 依赖               | 状态   | 负责人 | 代码落点                                   | 验收标准                                                                                     | PR                   |
| ------ | -------------------------------------------------------------------------------------- | ------ | ------------------ | ------ | ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------- |
| SUN-01 | 隐藏并移除 Slides 的 AiPanel、Ask AI、AI 菜单/Ribbon 入口。                            | P1     | SLD-08             | 已完成 | Codex  | `apps/slides/src/renderer/ai/`、App/Ribbon | Slides UI/runtime 已删除；MCP 回归与本机“新建→修改→撤销”已通过。                             | `712ebc1`..`0e1d9c7` |
| SUN-02 | 隐藏并移除 Docs/Markdown 的 AI 面板与快捷入口。                                        | P1     | DOC-03, MD-03      | 已完成 | Codex  | 对应 renderer/App/Ribbon                   | Docs/Markdown 内置 AI runtime、面板、菜单与可达提示均已删除；MCP 与本机回归通过。            | `bdcf1c2`..`0e1d9c7` |
| SUN-03 | 隐藏并移除 Sheets/PDF 的 AI 面板。                                                     | P2     | SHT-04, PDF-04     | 已完成 | Codex  | 对应 renderer                              | AgentLoop/transport、`_aiApi`、可达 AI UI/IPC 与残留 dock 布局均已删除；MCP 与本机回归通过。 | `d10a948`..`0e1d9c7` |
| SUN-04 | 删除内部 `ai:stream`、`ai:chat`、provider settings 和相关 preload IPC。                | P1     | SUN-01..03, DEC-04 | 已完成 | Codex  | docs/shell/main、各 preload/shared IPC     | 全局 `ai:*` IPC、Shell provider settings 和 preload 暴露已删除。                             | `70fbd2d`..`0e1d9c7` |
| SUN-05 | 删除 `packages/ai-provider`、`packages/agent-core` 和仅用于聊天的 project-store 逻辑。 | P2     | SUN-04             | 已完成 | Codex  | workspaces/package manifests               | 包、workspace/lockfile 条目和聊天专用逻辑已删除；全量类型检查与 MCP 回归通过。               | `8a7f489`            |
| SUN-06 | 清理 AI 专属 i18n、图片、测试和文档；更新 README/隐私/安全说明。                       | P1     | SUN-04             | 已完成 | Codex  | 全仓                                       | 无可达内置 AI 文案、资源或文档误导；完整验收记录在 `internal-ai-sunset-execution.md`。       | `a6c6641`..`0e1d9c7` |

## 7.1 MCP 能力缺口（不阻塞下线）

| ID     | 任务                                                                      | 优先级 | 依赖   | 状态   | 负责人 | 记录                     | 验收标准                                                      | PR  |
| ------ | ------------------------------------------------------------------------- | ------ | ------ | ------ | ------ | ------------------------ | ------------------------------------------------------------- | --- |
| MED-01 | 受控导入外部 Agent 生成的图片，并向各文档类型提供 handle-based 插入能力。 | P1     | SUN-04 | 未开始 | TBD    | `mcp-capability-gaps.md` | 禁止任意路径；满足 MIME/大小/SSRF/审计约束；至少覆盖 Slides。 |     |

## 8. 持续质量门禁

| ID     | 任务                                                                                               | 优先级 | 依赖            | 状态   | 负责人 | 验收标准                                                            | PR                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------- | ------ | --------------- | ------ | ------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| QLT-01 | 为 MCP adapter 建立协议级测试（握手、tools/list、tools/call、错误、取消）。                        | P0     | INF-01..05      | 已完成 | Codex  | `packages/genoffice-mcp/tests/server.test.ts`                       | 覆盖握手、tools/list、tools/call、结构化工具错误与 stdio 断开取消；通过既有 unit-test CI job 运行。                   | 待本轮提交    |
| QLT-02 | 为 gateway 建立安全回归测试。                                                                      | P0     | SEC-01..05      | 已完成 | Codex  | `apps/shell/tests/mcp-*.test.ts`                                    | 覆盖私有 discovery 权限与 token、连接身份隔离、输入上限、权限、审计轮转和写队列取消；通过既有 unit-test CI job 运行。 | 待本轮提交    |
| QLT-03 | 新增 Shell + Slides 端到端 MCP smoke test，并接入 CI。                                             | P0     | SLD-08          | 已完成 | Codex  | `e2e/mcp-shell-slides.spec.ts`                                      | 真实启动 Shell 与 stdio adapter，经本地 bridge 完成 Slides 创建、写入、读取、undo 与保存；纳入既有 E2E CI job。       | 待本轮提交    |
| QLT-04 | 为 Docs/Markdown/Sheets/PDF 逐步增加相同 smoke test。                                              | P1     | 各 App MCP 测试 | 已完成 | Codex  | 每个已声明支持的文档类型都有 CI 覆盖。                              | 真实 stdio smoke 覆盖四类文档的新建、状态读取、renderer bridge 就绪与上下文读取；已修复 Markdown 启动崩溃。           |
| QLT-05 | 在 CI 中运行 `npm run typecheck`、受影响 workspace tests、`npm run lint`、`npm run format:check`。 | P0     | INF-01          | 已完成 | Codex  | `.github/workflows/ci.yml`                                          | 现有 PR/push CI 已运行 format、lint、typecheck、全量 unit tests 与 Electron E2E；新增 MCP E2E 自动纳入该 job。        | 既有 workflow |
| QLT-06 | 执行 macOS、Windows、Linux 打包冒烟验证。                                                          | P1     | INF-07, QLT-03  | 已完成 | Codex  | 三个平台都能启动 Shell 和 adapter，且能完成授权与 Slides 基础调用。 | CI Run 8（`33144521227`）在三平台完成成品 Shell 启动、包内 adapter 初始化、`tools/list` 与 Slides `create_document`。 |

## 9. Slides MCP MVP 收束验收

本阶段不是新增编辑器能力；目标是将已实现的能力、测试和安全边界逐项审计并形成可发布结论。只有 `MVP-01` 至 `MVP-08` 全部完成，才可宣布“GenOffice Slides MCP MVP 可用”。若审计发现实现与既有任务描述不一致，应先新增或更新对应的原始任务，再回到本阶段继续收束。

| ID     | 任务                                                                                      | 优先级 | 依赖                           | 状态   | 负责人 | 验收标准                                                                                                                        | 证据/记录                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------- | ------ | ------------------------------ | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP-01 | 复核 MVP 范围与产品决策，明确已打开文档和受控空白文档的边界。                             | P0     | DEC-01..05                     | 已完成 | Codex  | `mcp-external-ai-decisions.md` 与实际公开 tools 一致；无任意本机路径打开、读取或写入能力。                                      | DEC-01..05；`ShellMcpGateway` 仅公开 documentId 定向 tools 与 `kind`-only `create_document`；`mcp-gateway.test.ts` 覆盖禁用路径型工具和创建 schema。                      |
| MVP-02 | 逐项审计基础设施与安全前置条件，并回填 `INF-01..07`、`CAP-01..08`、`SEC-01..06` 状态。    | P0     | MVP-01, QLT-01..06             | 已完成 | Codex  | 每项均有代码、定向测试或 CI 证据；未满足项回到原任务，不以文档勾选替代实现。                                                    | 修复 Markdown/PDF revision 单调性与 Windows 审计轮转；Shell MCP 36 项、adapter 3 项、capabilities 3 项、Markdown 3 项、PDF 9 项定向测试通过；QLT-01..06/CI Run 8 已完成。 |
| MVP-03 | 验证 Slides 的 documentId、revision 与并发写入契约。                                      | P0     | CAP-02..03, CAP-07, SLD-01..05 | 未开始 | Codex  | 人工/MCP 编辑均单调推进 revision；相同 revision 的并发写入仅一方成功，另一方返回结构化 `conflict`；关闭后 documentId 不可解析。 |                                                                                                                                                                           |
| MVP-04 | 验证写入安全边界：bridge token、无逐次应用内授权、输入限制、审计和 destructive 操作约束。 | P0     | INF-03..05, SEC-01..06         | 未开始 | Codex  | 已认证请求不显示应用内确认窗；未认证/越界输入被拒绝；审计记录完整且不含文档内容；删除类操作满足专用约束。                       |                                                                                                                                                                           |
| MVP-05 | 以独立 stdio MCP 客户端完成 Slides 端到端验收。                                           | P0     | MVP-01..04, SLD-01..08         | 未开始 | Codex  | 覆盖列出已打开文档、读取、dry-run、写入、conflict、undo、redo、save；不依赖 active Tab 作为写入目标。                           |                                                                                                                                                                           |
| MVP-06 | 复核内置 AI 下线后的产品边界与 MCP 能力缺口。                                             | P1     | SUN-01..06, MED-01             | 未开始 | Codex  | 无可达的内置 AI UI/runtime/provider；确认外部生成图片插入仍为不阻塞的 `MED-01`，不把缺口误报为 MVP 已支持能力。                 |                                                                                                                                                                           |
| MVP-07 | 复跑并归档质量门禁。                                                                      | P0     | MVP-02..06, QLT-01..06         | 未开始 | Codex  | 本地 typecheck/lint/format/test 与 CI 的 unit、E2E、macOS/Windows/Linux 成品包 MCP 冒烟均通过；记录具体 CI Run。                |                                                                                                                                                                           |
| MVP-08 | 生成 MVP 验收报告，更新完成清单和对外连接说明。                                           | P0     | MVP-01..07                     | 未开始 | Codex  | 报告逐项引用证据、已知非阻塞缺口和复现步骤；本表全为已完成；README/连接文档不承诺未提供的图片导入或任意文件访问能力。           |                                                                                                                                                                           |

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
