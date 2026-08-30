# NexOffice 项目改名评估

> 状态：仅记录方案与风险，尚未实施。当前项目为未对外发布的开发版，因此不要求迁移已有用户数据、MCP 配置、安装包或更新链路。

## 目标

将当前 GenOffice 项目改名为：

- 代码/文件系统标识：`nex-office`
- 用户可见文字与品牌：`NexOffice`

本文保留两种可选方案，日后根据产品目标决定采用其一。

## 方案 A：完整内部重命名

### 范围

将自有代码中的 `GenOffice` / `genoffice` 一并替换，包括：

- 根 package 名、所有 `@genoffice/*` workspace package scope、imports、TypeScript/Vite aliases 与目录名。
- `packages/genoffice-mcp`、`packages/genoffice-capabilities` 等内部目录、构建脚本和打包路径。
- 应用 `appId`、`desktopName`、产品名、安装包/二进制文件名、CLI、MCP server 名。
- `GENOFFICE_*` 环境变量、socket/临时目录名、MCP adapter 名、测试夹具与 CI 断言。
- 自有文档、代码注释、UI、README、当前安全/使用说明。
- 自有文件格式标识，例如 Markdown asset manifest、转换 marker、剪贴板 MIME、字体家族名。

第三方许可证、上游归档、历史记录和必须保留原文的法律文件不做机械替换。

### 可行性与风险

技术上可行，不存在阻止应用运行的架构依赖；风险来自跨模块标识遗漏。

| 改动域                                 | 难度   | 漏改表现                       |
| -------------------------------------- | ------ | ------------------------------ |
| UI、窗口标题、文档、MCP 展示名         | 低     | 文案或品牌不一致               |
| workspace scope、imports、路径 aliases | 高     | build/typecheck 时模块解析失败 |
| 打包、CI、CLI、E2E                     | 高     | 成品包或 smoke test 失败       |
| socket、环境变量、测试夹具             | 中     | 开发、MCP 或测试运行异常       |
| manifest、剪贴板 MIME、字体家族        | 中到高 | 文档资产、跨窗口复制或排版回归 |

其中字体内部家族名应最后处理，并需要 Docs/Slides 的渲染回归；其改动可能影响字体回退与版式。文件 manifest、剪贴板 MIME 则须完整同步读写两端。

### 建议实施与验收

1. 先建立机器可执行的替换清单，标记自有标识、不可改标识和需要手工迁移的标识。
2. 修改 workspace/package/import/alias/目录与构建配置。
3. 修改应用身份、CLI、MCP、环境变量、临时目录和测试夹具。
4. 修改用户可见品牌、当前文档、打包名称与 CI。
5. 全量执行 build、typecheck、unit、MCP E2E 与三平台 package smoke；每项失败均视为漏改项收敛。

估算：约 **6–10 个工作日**；主要成本为回归与打包验证。

## 方案 B：对外 NexOffice，内部兼容标识保留

### 范围

用户与第三方 Agent 接触到的所有品牌统一为 `NexOffice`：

- 应用 logo lockup、窗口标题、编辑器标题、设置页、通知与错误文案。
- README、当前使用说明、安全/隐私文档、MCP 文档和帮助文本。
- MCP `serverInfo.name`、MCP 设置页和“复制给 AI 使用”的提示词。
- `productName`、应用显示名、安装包名、macOS app 名和 Windows exe 名。
- 推荐 CLI 为 `nex-office-mcp`；设置页与文档不展示旧命令。

内部继续保留：

- `@genoffice/*` workspace scope、package 目录、imports、TypeScript/Vite aliases。
- `packages/genoffice-mcp` 与现有 adapter 实现路径。
- `GENOFFICE_*` 兼容环境变量、内部 socket/临时目录、asset manifest、剪贴板 MIME、字体家族名。
- 为降低平台风险，可暂留 `appId: com.genoffice.app` 与 Linux `desktopName`；它们不在正常 UI 中展示。

若采用新的 NexOffice 用户数据目录，设置页展示的 MCP discovery 路径也会使用 NexOffice；由于项目未发布，不需要数据迁移。旧 `genoffice-mcp` 可保留为未宣传的兼容别名，但不应出现在新的 UI 或文档。

### 可行性与风险

这是推荐方案。保留已验证的内部依赖图，避免 workspace scope、imports、构建路径与运行时协议的大规模机械变更。

主要风险集中于：

- 显示名变更后，macOS/Windows/Linux 打包产物和 smoke 脚本需要同步更新。
- 新 CLI 名称、MCP server 名和设置页提示词必须与实际打包 adapter 一致。
- 当前 logo 资产若含 GenOffice 文字，需要生成或替换为 NexOffice 版本。
- 非代码文字应统一为 `NexOffice`，避免 UI、README、错误提示混用品牌。

### 建议实施与验收

1. 替换 UI、品牌资产、MCP 对外名和当前公开文档。
2. 增加并发布 `nex-office-mcp` 对外命令，保持内部 adapter 可复用。
3. 更新 `productName`、安装包名、package smoke 和 CI 断言；谨慎决定是否修改 `appId` / `desktopName`。
4. 执行 Shell/MCP tests、typecheck、打包 smoke 与三平台构建验证。

估算：约 **3–5 个工作日**。这是在不迁移历史用户数据的前提下，风险最低且能实现完整对外 NexOffice 品牌体验的方案。

## 决策建议

若目标是尽快、安全地将产品以 NexOffice 身份对外使用，优先选择 **方案 B**。

只有在需要清理所有内部命名、发布新的 npm package scope、或对代码库品牌一致性有强制要求时，再选择 **方案 A**；该方案应作为独立改造项目，并以全量跨平台回归作为完成条件。
