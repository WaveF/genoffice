# NexOffice Slides MCP MVP 验收报告

**验收日期：** 2026-08-28  
**范围：** `mcp-external-ai-todo.md` 的第 9 阶段，`MVP-01` 至 `MVP-08`。  
**结论：** NexOffice Slides MCP MVP 可用。

本结论只覆盖本地、经认证的 MCP bridge 上的 Slides 端到端编辑流程。它不表示 NexOffice 是公网 MCP 服务，也不表示任意本机文件、通用媒体导入或外部 AI 生成图片插入已经支持。

## 发布范围

外部 MCP client 通过 stdio adapter 连接已运行的 NexOffice。bridge 使用当前应用会话生成的 token，并将请求路由到明确的 `documentId`；写操作必须携带 `expectedRevision`。MCP 不以当前激活 Tab 作为写入目标。

Slides 正式验收的流程为：创建受控空白演示文稿或选择已打开演示文稿，读取 deck/slide，`dryRun` 校验 canonical ops，原子写入，处理 revision conflict，undo/redo，渲染单页受限 PNG 预览，以及保存到应用受控路径。删除页面要求显式页面目标，并走 destructive 风险边界。

连接方式、discovery 生命周期与安全注意事项见 [MCP adapter 使用说明](./mcp-external-ai-usage.md)。当前 tools/list 还会按能力暴露 Docs、Markdown、Sheets 与 PDF 的受限工具；这些工具不改变本报告的 Slides-first 端到端发布结论，调用方必须以实时 `tools/list` 返回的 schema 和每个工具的 `documentId`/revision 约束为准。

## 验收项与证据

| 验收项                 | 结论 | 证据                                                                                                                                                                                                                      |
| ---------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 受控目标与创建边界     | 通过 | `create_document` 仅接受 `kind`，不会接收路径、文件名、初始内容或模板；已打开文档使用临时 opaque `documentId` 定向操作。决策见 [DEC-01](./mcp-external-ai-decisions.md)。                                                 |
| 认证、授权与审计       | 通过 | 每次启动轮换 bridge token；discovery 文件只允许当前 OS 用户读取；认证在 gateway 前完成，认证后的请求不弹逐次授权窗。参数、风险等级和不含正文的审计记录仍受限制。见 [DEC-03](./mcp-external-ai-decisions.md) 与 `MVP-04`。 |
| Slides revision 与并发 | 通过 | UI/MCP 写入均单调推进 revision；同 revision 的双客户端竞争仅一方成功，另一方获得结构化 `conflict`；关闭 Tab 后 ID 不可解析。`MVP-03` 的单测与真实 stdio E2E 覆盖该契约。                                                  |
| Slides 独立客户端流程  | 通过 | `e2e/mcp-shell-slides.spec.ts` 启动真实 Shell、bridge 与独立 stdio adapter；覆盖 list/read/dry-run/write、非激活目标写入、竞争 conflict、undo、redo 与 save。见 `MVP-05`。                                                |
| 内置 AI 产品边界       | 通过 | 内置聊天 UI、provider、AI IPC 与相关依赖已下线；NexOffice 不接收模型 API key，也不提供内置模型、搜索或图像生成。执行审计见 [第 7 阶段清单](./internal-ai-sunset-execution.md)。                                           |
| 本地质量门禁           | 通过 | `format:check`、theme/English-comments 检查、lint（零 error）、typecheck、fixtures 幂等、unit tests 及 37 项 Playwright E2E 均已通过。                                                                                    |
| 跨平台成品包烟测       | 通过 | GitHub Actions [CI Run 33168595889](https://github.com/WaveF/genoffice/actions/runs/33168595889)（提交 `70a91a8`）的 test、E2E 及 macOS/Linux/Windows package MCP smoke 全部成功。                                        |

## 复现步骤

1. 启动 NexOffice，等待用户数据目录内的 `mcp/bridge.json` 出现。
2. 按 [使用说明](./mcp-external-ai-usage.md) 以 `nexoffice-mcp --discovery <bridge.json>` 配置 MCP client。
3. 调用 `initialize` 和 `tools/list`，从返回的 schema 读取可用工具。
4. 调用 `create_document`，参数为 `{ "kind": "slides" }`；返回后可立即使用其 `documentId`，无需等待 renderer。
5. 用 `slides.get_deck_context`、`slides.read_slide` 读取状态；使用相同 revision 先 `dryRun`，再以 `slides.apply_ops` 执行写入。
6. 保存前后均以返回的最新 revision 继续调用；收到 `conflict` 时先重新读取再规划，不重放过期写入。

## 已知非阻塞缺口

`MED-01`（外部 Agent 生成图片后的跨编辑器受控导入）尚未实现。外部 Agent 可以自行生成图片，但 MCP 当前不提供通用路径、URL、bytes 或跨编辑器媒体导入接口；不得把这一能力向用户承诺为已支持。后续方案是应用管理临时资源并返回 opaque media handle，同时做 MIME、大小、SSRF 与审计校验，详见 [MCP 能力缺口清单](./mcp-capability-gaps.md)。

此外，MCP 只面向本机已运行的 NexOffice 和持有本会话 discovery/token 的 client；不提供任意路径 `open_document`、`read_file` 或 `write_file`，也不开放网络监听端口。
