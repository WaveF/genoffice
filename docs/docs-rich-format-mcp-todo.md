# 归档：Docs 富格式 MCP：动态执行清单

> **归档状态：历史完成记录，默认不再作为执行清单阅读。** DFM-00 至 DFM-08 已在已删除的专用分支完成，并已合并进 codex/mcp-external-ai-plan（提交 a0fe531）。后续表格、链接、图片与编号定义能力见 docs-rich-format-mcp-followups.md；仅在追溯格式化 MCP 的设计、验收或任务 ID 时按需查阅本文件。

## 已确认的产品边界

- `docs.insert_content` 与 `docs.replace_blocks` 保持既有“插入/替换字面文本”的语义；不得偷偷让 Markdown 改变其含义。
- `docs.apply_operations` 是 Docs 的核心写入模型：创建新内容时支持前置的结构化 blocks/runs；编辑已有内容时支持后置的、稳定定位的格式化操作；同一次调用可混用，整体受 `expectedRevision` 保护。
- Markdown 仅可作为后续可选快捷导入能力，不是 Docs 的标准数据模型，也不能覆盖字体、颜色、高亮、段落、表格或页面布局等 Docs 原生格式。
- 所有公开操作沿用 Shell MCP 的 token、权限、写队列、revision、审计与输入上限边界；不接受任意 HTML、文件路径、URL 或字节。
- 第一轮优先覆盖“创建格式化报告”和“修改已有文字样式”两类任务；高级 Word 功能按审计结果分级，不承诺一次性全部公开。

## 完成边界

- Agent 能在空白 Docs 文档中一次性创建包含标题、段落、粗体/斜体/下划线、前景色/高亮色、项目符号/编号列表的格式化内容，而非 Markdown 字面量。
- Agent 能读取足够的结构与格式摘要，稳定定位一个已存在的 block 或文本范围，并修改首轮支持的格式。
- 每次写入均可通过 revision/conflict、权限、审计和 `.docx` 保存-重开回读验证；失败不得部分应用。
- MCP usage、设置中的“复制给 AI 使用”和适用技能明确说明：对 Docs 使用结构化操作，不把 Markdown 当成富文本写入接口。

## 任务清单

| ID     | 任务                                                         | 优先级 | 依赖       | 状态   | 代码落点                                        | 验收标准                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------ | ------ | ---------- | ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DFM-00 | 固化 Docs MCP 的数据模型与范围决策。                         | P0     | -          | 已完成 | 本文档                                          | 明确 blocks/runs/styles 是标准模型；Markdown 是可选快捷层；`insert_content` / `replace_blocks` 保持字面文本。                                                                                                            |
| DFM-01 | 审计 Docs 现有格式能力与 `.docx` 保存边界。                  | P0     | DFM-00     | 已完成 | `docs/docs-rich-format-mcp-audit.md`            | 已形成能力矩阵并标记首轮、后续和不公开能力；确认结构化 P0 的模型与保存路径。                                                                                                                                             |
| DFM-02 | 定义稳定寻址与富格式读取契约。                               | P0     | DFM-01     | 已完成 | Docs MCP adapter、gateway schemas               | 读取接口返回 revision 内有效的 blockId、类型、必要 attrs 与有限 runs；定位不依赖易漂移的纯 block index。                                                                                                                 |
| DFM-03 | 定义 docs.apply_operations JSON schema、事务语义与输入限制。 | P0     | DFM-01..02 | 已完成 | Shell gateway、capability schemas               | 有 32 个 operation 与 64 KiB payload 上限；style/target 深度白名单；dry-run、未知 op、越界 range、stale revision 与原子失败语义受测。                                                                                    |
| DFM-04 | 实现前置结构化写入：blocks、runs 与首轮段落结构。            | P0     | DFM-03     | 已完成 | Docs renderer adapter、editor helpers           | 原生插入 heading、paragraph、bullet/ordered list 与 marks；支持首轮文字样式；不经 Markdown 字符串中转。                                                                                                                  |
| DFM-05 | 实现后置文本与段落格式操作。                                 | P0     | DFM-02..04 | 已完成 | Docs renderer adapter、editor helpers           | 通过 blockId 或同批 resultId 定位，支持有限文本 range 设/清 marks、heading/list/paragraph 转换、对齐与缩进。                                                                                                             |
| DFM-06 | 审计并分批公开表格、链接、图片和高级布局。                   | P1     | DFM-01..05 | 已完成 | docs-rich-format-mcp-followups.md               | 已定义表格/链接/图片的安全独立最小任务；高级能力保持不公开，禁止绕过原生模型。                                                                                                                                           |
| DFM-07 | 更新 MCP 使用说明、设置提示词与 Docs 技能。                  | P1     | DFM-04..05 | 已完成 | Settings、内置 docs-authoring skill、usage docs | Agent 指引读取 Docs skill；新建报告使用结构化 operations；编辑前读取 context；不得将 Markdown 直接传给 literal 文本工具。                                                                                                |
| DFM-08 | 完成 unit、gateway、真实 stdio E2E、保存重开与人工验收。     | P0     | DFM-04..07 | 已完成 | Docs/Shell/MCP tests                            | 已覆盖创建格式化报告、read-back、原子失败、dry-run/conflict、权限、真实 stdio 转发、保存重开与 Markdown 字面工具；Docs/MCP/Shell builds 均通过。Shell 全量测试的 4 个既有 analytics/privacy 失败已记录，未由本任务引入。 |

## 建议执行顺序

`DFM-01 → DFM-02 → DFM-03 → DFM-04 → DFM-05 → DFM-07 → DFM-08`；`DFM-06` 在首轮结构化文本能力稳定后按子能力拆分推进。

## 已知现状与风险

- Docs UI 已有 `docHeading`、`docListItem`、`docTextStyle` 等模型，以及 Markdown 粘贴转换路径；当前 MCP `content: string` 写入绕过了它们。
- 现有 `docs.read_blocks` 主要返回 index、type 与 text，不能支撑可靠的后置样式编辑；稳定 target 设计是首轮 P0 前置条件。
- 不能把未审计的 TipTap HTML 字符串插入行为当作 MCP 合约；这会造成安全、版本兼容与 `.docx` round-trip 风险。
- `DFM-01` 可能发现少数 Ribbon 功能没有稳定的 model/serializer 支持；这些功能必须降级为后续任务，不能为了 MCP 暴露而绕开文档模型。
