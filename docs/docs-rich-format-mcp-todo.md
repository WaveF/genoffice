# Docs 富格式 MCP：动态执行清单

> 状态：未开始。该清单解决外部 Agent 将 Markdown 字面量写入 `.docx` 的问题，但核心目标不是把 Docs 变成 Markdown 编辑器，而是将 Docs 已有的富文本能力以受控、结构化、可审计的 MCP 操作公开。

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

| ID     | 任务                                                           | 优先级 | 依赖       | 状态   | 代码落点                                                  | 验收标准                                                                                                                                                              |
| ------ | -------------------------------------------------------------- | ------ | ---------- | ------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DFM-00 | 固化 Docs MCP 的数据模型与范围决策。                           | P0     | -          | 已完成 | 本文档                                                    | 明确 blocks/runs/styles 是标准模型；Markdown 是可选快捷层；`insert_content` / `replace_blocks` 保持字面文本。                                                         |
| DFM-01 | 审计 Docs 现有格式能力与 `.docx` 保存边界。                    | P0     | DFM-00     | 未开始 | Docs editor extensions、Ribbon、convert/serializer、tests | 形成“UI 能力 → ProseMirror node/mark/attrs → 读回字段 → MCP operation → 保存回归”的矩阵；标记首轮、后续和不公开能力。                                                 |
| DFM-02 | 定义稳定寻址与富格式读取契约。                                 | P0     | DFM-01     | 未开始 | Docs MCP adapter、gateway schemas                         | `docs.get_context` / `docs.read_blocks` 返回不泄露本机路径的稳定 block 标识、类型、必要 attrs 与有限 runs；定位不依赖易漂移的纯 block index。                         |
| DFM-03 | 定义 `docs.apply_operations` JSON schema、事务语义与输入限制。 | P0     | DFM-01..02 | 未开始 | Shell gateway、capability schemas                         | 支持有限 operation 数和 payload；所有 target 与 style 字段白名单化；dry-run、未知 op、越界 range、stale revision 与部分失败行为明确。                                 |
| DFM-04 | 实现前置结构化写入：blocks、runs 与首轮段落结构。              | P0     | DFM-03     | 未开始 | Docs renderer adapter、editor helpers                     | 可原生插入 heading、paragraph、bullet/ordered list 和带 marks 的 text runs；支持 bold/italic/underline/strike、字体、字号、前景色与高亮色；不经 Markdown 字符串中转。 |
| DFM-05 | 实现后置文本与段落格式操作。                                   | P0     | DFM-02..04 | 未开始 | Docs renderer adapter、editor helpers                     | 可对稳定 block target 的有限文本 range 设/清首轮 marks，并调整 heading、列表、对齐、缩进等首轮段落属性；同一事务中的后续 operation 可引用前序结果。                   |
| DFM-06 | 审计并分批公开表格、链接、图片和高级布局。                     | P1     | DFM-01..05 | 未开始 | Docs model、media bridge、serializer                      | 定义表格/链接/图片的安全最小操作集和独立验收；页眉页脚、批注、修订、分节、目录等高级能力只在具备稳定 model/保存回归时另立子任务。                                     |
| DFM-07 | 更新 MCP 使用说明、设置提示词与 Docs 技能。                    | P1     | DFM-04..05 | 未开始 | Settings、skills、README/usage docs                       | Agent 指引优先读取 Docs skill；新建报告使用结构化 operations；编辑前先读取 context；不得将 Markdown 直接传给 literal 文本工具。                                       |
| DFM-08 | 完成 unit、gateway、真实 stdio E2E、保存重开与人工验收。       | P0     | DFM-04..07 | 未开始 | Docs/Shell tests、`e2e/`                                  | 覆盖创建格式化报告、修改现有格式、read-back、dry-run/conflict/undo/redo、权限与审计、保存为 `.docx` 后重开；验证 Markdown 字面量工具仍保持原语义。                    |

## 建议执行顺序

`DFM-01 → DFM-02 → DFM-03 → DFM-04 → DFM-05 → DFM-07 → DFM-08`；`DFM-06` 在首轮结构化文本能力稳定后按子能力拆分推进。

## 已知现状与风险

- Docs UI 已有 `docHeading`、`docListItem`、`docTextStyle` 等模型，以及 Markdown 粘贴转换路径；当前 MCP `content: string` 写入绕过了它们。
- 现有 `docs.read_blocks` 主要返回 index、type 与 text，不能支撑可靠的后置样式编辑；稳定 target 设计是首轮 P0 前置条件。
- 不能把未审计的 TipTap HTML 字符串插入行为当作 MCP 合约；这会造成安全、版本兼容与 `.docx` round-trip 风险。
- `DFM-01` 可能发现少数 Ribbon 功能没有稳定的 model/serializer 支持；这些功能必须降级为后续任务，不能为了 MCP 暴露而绕开文档模型。
