# MCP 能力缺口清单

本清单记录下线内置 AI 时发现的“内置 AI 已具备、外部 MCP 尚未提供等价受控能力”。这些项目不应重新引入内置模型调用；应由外部 Agent 完成推理、搜索或生成，GenOffice 只补充受限的文档能力。

| ID | 能力缺口 | 当前情况 | 后续方向 | 状态 |
| --- | --- | --- | --- | --- |
| MED-01 | 外部 Agent 生成图片后插入文档 | PDF 可通过受限 base64 `insert_image` 插入小图片；Slides 拒绝 bytes/path/source，Docs、Markdown、Sheets 未公开图片插入 MCP 工具。 | 新增受控媒体导入：应用管理临时资源并返回 opaque handle；各编辑器的插入工具仅接收 handle 与受限布局。禁止任意本机路径；若支持 URL，必须具备下载限额、域名策略与 SSRF 防护。 | 未开始 |

## 处理原则

- 不因能力缺口恢复 `agent-core`、`ai-provider`、Genspark 登录、云搜索或云图像生成。
- 每项能力须独立定义输入大小、MIME 白名单、文件生命周期、审计字段和目标文档范围。
- 新能力应优先服务已认证的本机 MCP bridge，并继续使用 opaque documentId、revision 与 renderer/main 双层校验。
