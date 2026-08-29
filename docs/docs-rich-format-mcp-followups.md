# Docs 富格式 MCP：DFM-06 能力分级

首轮 docs.apply_operations 只公开稳定、可保存且不需要额外资源桥接的文本结构与样式。下列能力经过模型审计后保持为后续独立任务，不能透过通用 HTML 或任意输入绕过。

| 子能力                 | 现有 Docs 模型                    | MCP 首轮结论 | 后续前置条件                                                                                               |
| ---------------------- | --------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| 链接                   | link mark（href / rId / tooltip） | 不公开       | URL 协议白名单、关系 part 生命周期、保存重开测试                                                           |
| 表格                   | docTable / table model            | 不公开       | 独立的行列/cell schema、尺寸上限、合并单元格和编号/样式回归                                                |
| 图片                   | inline/protected image nodes      | 不公开       | 复用 media.stage_image 的受控句柄；将受信任 bytes 写入 Docs media relationship，再做保存/重开/删除回收回归 |
| 页眉页脚、分节、目录   | 复杂 section / OOXML 模型         | 不公开       | 每项单独的文档范围、持久化和 UI 兼容验收                                                                   |
| 批注、修订、书签、字段 | 专用 marks/attrs 与保护逻辑       | 不公开       | 作者/审计语义、冲突策略和 round-trip 验收                                                                  |

## 已定义的安全边界

- 图片不会接受 Agent 提供的本机路径、URL、base64 或 bytes；后续只可接收本会话 mediaHandle。
- 表格、链接与图片不会复用 docs.apply_operations 的文本 payload 做隐式解释，避免随版本扩大为 HTML 注入接口。
- 没有已经初始化的原生编号定义时，首轮列表写入会明确失败，不会构造无法保存的无效 numId。由 MiniOffice 新建的空白 Docs 文档带有项目符号和编号定义；导入文档如缺少对应定义，后续编号定义管理任务处理。

## 后续建议任务

- DFM-LINK-01：受限链接 mark。
- DFM-TABLE-01：固定尺寸表格创建与 cell 文本编辑。
- DFM-MEDIA-01：基于 mediaHandle 的 Docs 图片导入。
- DFM-NUM-01：为缺少编号定义的导入 Docs 创建并保存受控编号定义。
