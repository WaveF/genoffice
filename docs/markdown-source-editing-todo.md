# Markdown 源码编辑与 MCP 写入：执行清单

## 目标与边界

解决外部 Agent 使用 `markdown.insert_content` 写入 `# 标题`、列表或表格时被当作普通正文的问题，并为后续类似 Typora 的 Markdown 源码模式建立清晰边界。

- `documentId` 仍是 MCP 内部不透明句柄，Agent 自行通过 `list_open_documents` 或 `create_document` 获取，不能要求用户提供。
- 原始 Markdown 写入必须显式、整篇替换且受 `expectedRevision` 保护；不得把原始 Markdown 解析语义偷偷塞入普通文本插入工具。
- “源码模式”与 MCP 原始写入共享解析/序列化规则，但作为独立 UI 改造在专用分支完成并经测试后合并。
- 不支持任意文件路径、URL 或绕开 Markdown 既有 `assets/` 生命周期。

## A. 当前分支：MCP 原始 Markdown 写入

| ID      | 任务                                                                          | 优先级 | 依赖           | 状态   | 代码落点                                    | 验收标准                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------- | ------ | -------------- | ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MSRC-01 | 定义 `markdown.set_source` 的受限 schema 与语义。                             | P0     | CAP-03, RBR-01 | 已完成 | Shell gateway、MCP tool descriptor          | 仅接受 `documentId`、`expectedRevision`、完整 `source`；最大长度明确；不接受局部 range、路径、URL 或 bytes；文档说明其覆盖整篇 Markdown。   |
| MSRC-02 | 在 Markdown renderer adapter 中以 `contentType: 'markdown'` 解析完整 source。 | P0     | MSRC-01        | 已完成 | `apps/markdown/src/renderer/mcp-adapter.ts` | `# 标题`、列表、引用、表格、任务列表和受控本地图片 Markdown 被解析成对应块；普通 `markdown.insert_content` 继续保持“插入纯文本”的既有语义。 |
| MSRC-03 | 接入 revision、写队列、权限与审计边界。                                       | P0     | MSRC-01..02    | 已完成 | Shell MCP gateway                           | stale revision 返回 `conflict`；认证后按 write 风险审计；失败时不部分写入；返回 authoritative revision。                                    |
| MSRC-04 | 增加单测和真实 stdio E2E。                                                    | P0     | MSRC-01..03    | 已完成 | Markdown/Shell tests、`e2e/`                | 覆盖标题与列表解析、文本插入仍为文本、stale conflict、undo/redo、保存后 `.md` 原文、关闭/重载后的读回。                                     |
| MSRC-05 | 更新 MCP usage 与“复制给 AI 使用”提示词。                                     | P1     | MSRC-04        | 已完成 | usage 文档、Shell Settings                  | Agent 指引优先用 `markdown.set_source` 创建完整结构化文档；不要求用户提供 documentId；明确与 `insert_content` 的差异。                      |

## B. 专用分支：Markdown 源码模式 UI

**分支策略：** 从完成 `MSRC-01`～`MSRC-05` 的当前分支创建专用分支；该分支仅在完整测试通过后合并回主开发分支。

| ID      | 任务                                    | 优先级 | 依赖             | 状态   | 代码落点                    | 验收标准                                                                                                                                 |
| ------- | --------------------------------------- | ------ | ---------------- | ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| MSUI-01 | 定义源码模式状态机与切换契约。          | P0     | MSRC-02          | 已完成 | Markdown renderer/App state | 模式仅为 `wysiwyg` / `source`；切换明确 source-of-truth、dirty/revision、焦点与 selection 行为；源码模式展示完整文件（含 frontmatter）。 |
| MSUI-02 | 实现源码编辑器与切换入口。              | P0     | MSUI-01          | 已完成 | Ribbon/App/styles           | 源码模式可直接键入、粘贴、复制完整 Markdown；WYSIWYG 模式保持现有 block editor；切换不丢失已支持的语法。                                 |
| MSUI-03 | 实现保存、图片资源和 frontmatter 协调。 | P0     | MSUI-01..02      | 已完成 | App、asset lifecycle        | 源码模式保存 textarea 原文；保存时仍校验/回收本地 `assets/`；frontmatter 不重复、不丢失；图片在两种模式均可正确显示与保存。              |
| MSUI-04 | 处理 MCP 与源码模式并发。               | P0     | MSRC-03, MSUI-02 | 已完成 | renderer bridge/adapter     | MCP 请求不会静默覆盖未同步源码；选择“提交 source 后执行”或受控 `renderer_unavailable`/validation 错误之一，并有明确测试。                |
| MSUI-05 | 实现转换保真审计与用户提示。            | P1     | MSUI-02..04      | 已完成 | parser/serializer、UI       | 定义 Tiptap 不保证往返保留的 Markdown/HTML 扩展；切回 WYSIWYG 前提示潜在规范化；已支持 GFM 用例无提示且往返稳定。                        |
| MSUI-06 | 完成单元、组件、E2E 与手工验收。        | P0     | MSUI-01..05      | 已完成 | Markdown/Shell/E2E          | 覆盖模式切换、标题/列表/表格/代码块/frontmatter/图片、保存、撤销、reload、MCP conflict 和不支持语法提示。                                |

## 完成条件

- 当前分支完成的条件：`MSRC-01`～`MSRC-05` 全部完成、定向 tests/typecheck/E2E 通过且 MCP usage 已更新。
- 源码模式分支完成的条件：`MSUI-01`～`MSUI-06` 全部完成，源码与 WYSIWYG 往返边界经测试和人工验收，并完成独立合并审查。
