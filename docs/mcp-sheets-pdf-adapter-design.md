# Sheets 与 PDF MCP Adapter 设计

## 边界

外部 MCP 只通过 Shell 的固定 tool descriptor 与 `mcp:renderer-request` 访问已打开文档。`documentId` 是唯一公开标识；路径、文件字节、通用 IPC channel 均不暴露。

| App | renderer 负责 | Shell 负责 |
| --- | --- | --- |
| Sheets | workbook snapshot、lazy-load 保护、操作计划/应用、Univer 同步 | document kind 校验、revision CAS、权限、每文档写队列、审计 |
| PDF | PDF.js 文本/搜索索引、表单与批注内存状态、保存前编辑队列 | document kind 校验、revision CAS、权限、每文档写队列、审计 |

## Sheets 能力与限制

- 只读：workbook context、显式 range（最多 2,000 cells）、find、aggregate、formula trace。
- 写入：`sheets.apply_operations` 必须含 `expectedRevision`、事务 ID、摘要和 DSL operations；可 dry-run。
- 导入工作簿仍由 lazy plan 执行器处理，不能绕过流式读取、公式成本和保护单元格检查。
- undo 必须通过 renderer 统一回执实现：内存 workbook 走 adapter history，导入 workbook 走 Univer async undo；二者都要返回 post-undo revision。

## PDF 能力与风险等级

| 风险 | 操作 | MCP 策略 |
| --- | --- | --- |
| 只读 | context、page text、search、outline/forms/annotation summary | 输出分页、文本/命中数上限 |
| 可撤销写入 | note、highlight/underline/strikeout、text/form/image 编辑 | `expectedRevision`、权限、队列、内存编辑与 undo |
| 破坏性写入 | 删除/替换/拆分/合并页面 | 仅 dry-run 后带显式 confirmation token 的二次调用 |

PDF 搜索最多返回 200 个命中、每个命中最多 20 个矩形。所有 write 都应在保存前保留 renderer 内存状态；保存与取消是独立的文件风险流程。

