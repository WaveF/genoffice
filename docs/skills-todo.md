# 归档：GenOffice 技能：单阶段完成清单

> **归档状态：历史完成记录，默认不再作为执行清单阅读。** 本功能已在 `codex/markdown-source-mode` 完成；范围固定为本地、单 Markdown 文件的 Agent 指导文档，不包含在线目录、社区市场、ZIP 技能包、脚本执行或额外 MCP 权限。

| ID     | 任务                                             | 状态   | 验收证据                                                                                                               |
| ------ | ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| SKL-01 | 定义单文件 Markdown 技能格式与可选 frontmatter。 | 已完成 | `id`、`name`、`description`、`appliesTo` 可选；无 frontmatter 时安全生成标识；仅接受 UTF-8 `.md`，单文件上限 256 KiB。 |
| SKL-02 | 随应用提供内置只读技能。                         | 已完成 | `apps/shell/resources/skills/` 提供安全编辑、Markdown、Slides 三份指导；打包时复制到应用 Resources。                   |
| SKL-03 | 实现导入、导出、启用/禁用、删除与本地存储。      | 已完成 | 导入经原生选择器复制至 `userData/skills/`；不保留源路径；内置技能不可删除；启用状态持久化。                            |
| SKL-04 | 通过 MCP 公开已启用技能。                        | 已完成 | `skills.list` 返回不含路径的元数据；`skills.read(skillId)` 返回内容；禁用技能不可被 MCP 读取。                         |
| SKL-05 | 完成设置页管理和连接提示。                       | 已完成 | 设置 → 技能支持列表、预览、导入、导出、启用/禁用、删除；“复制给 AI 使用”指引复杂任务先读取技能。                       |
| SKL-06 | 覆盖安全与回归测试。                             | 已完成 | Shell skill/gateway/settings 定向测试 33 项、MCP adapter 3 项、Shell typecheck、格式和主题色检查通过。                 |

## 安全边界

- 技能仅是供 Agent 阅读的非可信 Markdown 文本，不执行其中的命令，也不授予文件、网络或写入权限。
- MCP 和 renderer 不接收、返回或记录技能的本机文件路径。
- 不支持以技能方式加载 JavaScript、Shell、Python、二进制文件、目录或软链接。
