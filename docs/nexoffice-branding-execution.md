# NexOffice 完整内部重命名：执行清单

> 状态：执行中。基线为 `codex/mcp-external-ai-plan` 的 `de3ff67`；实施分支为 `codex/nexoffice-branding`。本清单落实 [genoffice-rename-assessment.md](./genoffice-rename-assessment.md) 的方案 A。

## 完成边界

- 自有源代码、workspace package scope、目录、imports、构建脚本、应用身份、MCP/CLI、环境变量、socket、临时目录、测试与用户可见文案全部统一为 NexOffice。
- 文档格式和运行期内部协议中仍需兼容读取的旧标识应有明确兼容层；不得因改名破坏已打开文档、MCP bridge 或跨窗口通信。
- Apache-2.0、第三方 notices、上游历史引用和许可证要求保留的原文不做机械替换。
- 根目录全量 build/typecheck/test 及 macOS/Windows/Linux package smoke 通过；若既有基线失败，须单独记录且证明与本次无关。

## 任务

| ID     | 内容                                                            | 状态   | 验收                                                                                           |
| ------ | --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| NEX-00 | 冻结基线、审计标识并建立清单                                    | 已完成 | 当前分支领先 `main` 269 提交；审计 459 文件、1719 处标识。                                     |
| NEX-01 | 迁移 root/package workspace scope 和自有包目录                  | 已完成 | `@nexoffice/*`、`packages/nexoffice-*` 与 workspace scripts 一致；重新安装工作区依赖后全包 typecheck 通过。 |
| NEX-02 | 迁移所有 TypeScript/JS imports、Vite aliases 与构建工具         | 已完成 | 所有本地 imports、Vite alias 与 MCP bundle 路径已迁移；全包 typecheck 通过。                   |
| NEX-03 | 迁移应用身份、CLI、MCP bridge、环境变量、socket、数据和临时目录 | 已完成 | 新安装使用 `com.nexoffice.app`、NexOffice user-data、`nexoffice-mcp`、`NEXOFFICE_*`、NexOffice socket 与媒体临时目录。 |
| NEX-04 | 迁移 UI、文档、资源名、测试、CI 与 package smoke                | 已完成 | UI、技能文档、资源名、CI 与 package 配置均使用 NexOffice；仓库真实远端链接保留为 `WaveF/genoffice`，不伪造未创建的 NexOffice 远端。 |
| NEX-05 | 文件格式/剪贴板/字体等协议标识审计与必要兼容                    | 已完成 | PDF annotation 双读；六个 bundled WOFF2 的 primary name-table 已本地重命名且度量测试通过。 |
| NEX-06 | 全量验证、三平台打包与完成审计                                  | 进行中 | 完成边界中的所有命令和产物检查均有记录。                                                       |

## 保留与兼容原则

- `NOTICE`、第三方许可证、上游 GitHub 链接及历史归档中描述来源的 GenOffice 名称保留。
- 已存在用户数据与旧 discovery 文件无需迁移（项目尚未发布）；但任何公开 bridge 错误都应安全降级，而不是泄露路径或崩溃。
- 文档内容、OOXML、剪贴板 MIME、字体 family 与 manifest 等属于数据协议：先实现双读或确认无旧写入消费者，再移除旧名。

## 已确认的兼容项

- PDF visual-signature annotation：读取 `nexOfficeFormField`，并回退读取旧 `genOfficeFormField`；本次只改读取层，避免破坏先前生成的 PDF。
- Git 远端及历史 CI 链接仍为 `WaveF/genoffice`，因为远端仓库尚未改名；它们不是应用运行时标识，也不改为不存在的 URL。
- 第三方归因、许可证和对上游 issue 的历史引用保留 `GenOffice`，以维持来源可追溯性。

## 当前验证记录

- 全 workspace typecheck 通过。
- `npm run build:all` 通过；在字体元数据重命名后，已复跑 Docs、MCP、Shell build。
- Docs 测试通过：97 files、1066 tests；字体身份与度量测试通过。
- 全量 lint 仍有 7 个 error / 13 个 warning；7 个 error 均已存在于 `de3ff67` 基线（控制字符 regex、已移除 analytics 的陈旧测试、E2E regex 空格），本次未引入。
- Shell 全量测试的 4 个失败同样来自已移除匿名统计后未删除的历史测试；Docs 字体测试曾因 binary name-table 未改名失败，现已修复并通过。
