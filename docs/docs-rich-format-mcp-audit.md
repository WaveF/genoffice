# Docs 富格式 MCP：DFM-01 审计

## 结论

Docs 已具备首轮 MCP 所需的原生 ProseMirror 文档模型与 `.docx` 保存路径；本轮工作是把受控的结构化输入和格式操作接到既有模型上，并非另起一套富文本或把 Markdown 转换成 Docs 内容。

`docs.insert_content` / `docs.replace_blocks` 继续保持字面文本语义。它们不会、也不应隐式解析 Markdown。格式化报告应改用新增的 `docs.apply_operations`。

## 首轮能力矩阵

| UI / 文档能力                    | 现有模型                                         | MCP 首轮       | 保存边界                                     |
| -------------------------------- | ------------------------------------------------ | -------------- | -------------------------------------------- |
| 段落                             | `docParagraph` + paragraph attrs                 | 公开           | 已由 `convert.ts` 序列化                     |
| 标题 1–6                         | `docHeading.level`                               | 公开           | 已由 `convert.ts` 序列化                     |
| 项目符号 / 编号列表              | `docListItem.kind` / `ilvl`                      | 公开           | 已由 `convert.ts` 序列化                     |
| 粗体、斜体、下划线、删除线       | `bold` / `italic` / `underline` / `strike` marks | 公开           | 已由 runs 序列化                             |
| 字体、字号、前景色、高亮色       | `docTextStyle` attrs                             | 公开（白名单） | 已由 runs / OOXML generator 序列化           |
| 段落对齐、缩进                   | top-level node attrs                             | 公开（白名单） | 已由 block format 序列化                     |
| 链接                             | `link` mark                                      | 后续 DFM-06    | 需独立 URL 边界与回归                        |
| 表格                             | `docTable` + table model                         | 后续 DFM-06    | 现有模型成熟，但单列独立 schema / 回归       |
| 图片                             | inline/protected image nodes                     | 后续 DFM-06    | 需接入已有 media staging 与 `.docx` 资源写入 |
| 批注、修订、分节、页眉页脚、目录 | 多种模型 / raw OOXML                             | 不公开         | 不绕过现有保护与保存边界                     |

## 寻址决定

- `docxIndex` 不能作为 MCP ID：它只是已加载文件的保存补丁锚点；新建块为 `null`，并且它不应被外部调用方依赖。
- 首轮读接口返回不透明 `blockId`。它由当前读取快照的 block 序号、类型和内容校验构成，仅在对应 `expectedRevision` 下有效。
- 写入时同时验证 `expectedRevision` 与 `blockId` 的结构/内容摘要；同一请求内新增的块通过 operation 的显式 `id` 引用。

## 事务与安全决定

- 一个 `docs.apply_operations` 请求在 renderer 中构造一笔 ProseMirror transaction；全部验证后才 dispatch。`dryRun` 只构造并报告结果，绝不修改文档。
- 输入只接受白名单 block/runs/styles 和有限数量/大小；不接受 HTML、Markdown、文件路径、URL 或原始字节。
- Shell 继续负责 token、权限、revision CAS、写队列和审计。renderer 只处理既有 Docs document model。

## 相关代码证据

- Nodes 与 paragraph attrs：`apps/docs/src/renderer/editor/extensions.ts`
- Marks / `docTextStyle`：`apps/docs/src/renderer/editor/marks.ts`
- Docs model 到 `.docx` block/run 的转换：`apps/docs/src/renderer/editor/convert.ts`
- Ribbon 对同一模型的既有格式操作：`apps/docs/src/renderer/components/Ribbon.tsx`
- 当前 MCP 仅有文本写入：`apps/docs/src/renderer/mcp-adapter.ts`
