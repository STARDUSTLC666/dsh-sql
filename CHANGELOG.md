# 更新记录

## 0.6.6 (2026-11-20)

- 修复 MySQL / PostgreSQL 等待连接池时无法取消的问题：取消立即结束等待，晚到的未使用连接正常归还，晚到的连接错误也被正确处理。
- Cancel MySQL/PostgreSQL pool acquisition promptly, return late unused connections, and observe late acquisition failures without running cancelled SQL.
- 同步共享更新组件 0.2.9，修复取消窗口和失败响应清理，并确保运行中旧协调器在空闲后接管修复。

## 0.6.5 (2026-11-20)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.7`：对话页「有新版本」提醒浮卡支持无交互 15 秒自动收起（悬停、聚焦、查看记录或确认弹窗时自动暂停，安装成功提示 6 秒收起，安装中/失败/需要重启仍保持常驻不隐藏）。
- Upgrade `@stardustlc/dsh-updates` to `0.2.7`: auto-dismiss idle update reminder cards after 15s and silent complete cards after 6s while pausing on hover/focus/notes/dialogs and keeping active, failed, or restart-required cards pinned.

## 0.6.4 (2026-11-20)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.6`：端到端验收修复浮卡与日历按钮重叠、详情页/工作台挂载时瞬时让位及 `package-moved` / 包管理器报错诊断文案，继续保持过期检查自动刷新与 `bundle-in-use` 指导。
- Upgrade `@stardustlc/dsh-updates` to `0.2.6`: E2E-verified fixes for floating Calendar FAB clearance, immediate reminder yield on native detail/workbench mount, and clearer `package-moved` / package-manager error messages, alongside auto-refresh and `bundle-in-use` guidance.

## 0.6.3 (2026-11-18)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.5`：独立安装插件详情页底栏去重（保留组合包组件委派与对话页热更新卡片），补齐 `bundle-in-use` 组合包占用提示说明，并在检查结果过期或远端版本变更时自动刷新元数据，彻底消除 `check-first` 卡顿。
- Upgrade `@stardustlc/dsh-updates` to `0.2.5`: deduplicate standalone native plugin detail footers while keeping Suite delegation and in-chat reminder cards, surface clear `bundle-in-use` guidance, and automatically refresh expired update checks without `check-first` stalls.

## 0.6.2 (2026-11-18)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.4`：对话页新增一键热更新提醒卡片，自动检查周期缩短至 6 小时，手动热更新后可顺手开启包含兼容功能小版本的空闲自动更新。
- Upgrade `@stardustlc/dsh-updates` to `0.2.4`: add an actionable in-chat hot-update reminder card, 6-hour background update checks, compatible minor+patch idle auto-updates, and a post-update opt-in prompt.

## 0.6.1 (2026-11-18)

- 同步 `@stardustlc/dsh-updates` 0.2.3：侧边栏工作台平时默认隐藏底部更新栏（零高度占用），仅在检测到兼容新版本或执行更新时浮现单行精简提示条；完整更新设置与检查入口统一保留在 DSH「插件」详情页底部。
- Sync `@stardustlc/dsh-updates` 0.2.3: keep the sidebar workbench update footer hidden by default when up-to-date, surfacing a single-line compact strip only for actionable updates or active jobs while retaining full controls in native Plugin Details.

## 0.6.0 (2026-11-18)

- 新增零外部依赖的宿主原生 `Config` 设置表单声明（数据库密码自动脱敏，连接配置、只读开关与写审批修改后自动热重连生效），优化默认内存库提示，并补充自然语言查库与对账使用流程。
- Export a zero-dependency native DSH `Config` schema with password masking and automatic adapter hot-reload on Settings saves, improved unconfigured `:memory:` guidance, and human-centric SQL workflow docs.

## 0.5.16 (2026-11-18)

- 更新区底部新增克制、无打扰的 GitHub 点赞与问题反馈快捷链接，并完善中英文检索关键词。
- Add subtle, non-intrusive GitHub Star and issue feedback links in the update footer, and expand search keywords.

## 0.5.15 (2026-11-18)

- 同步 `@stardustlc/dsh-updates` 0.2.1：恢复 Suite 整包统一更新（移除独立拆包迁移），保留整包与独立插件的原地热更新与失败自动回滚。
- Sync `@stardustlc/dsh-updates` 0.2.1: restore unified Suite bundle updates (removing standalone conversion) while retaining in-place hot reload and automatic rollback.

## 0.5.14 (2026-11-18)

- 深度适配 DSH 0.2.2：补齐 manifestVersion 1 与双语元数据；改用异步 Cordis 4 `ctx.effect` 等待全部数据库连接池安全关闭，兼容 `effectivePolicy` 审批策略并为只读工具声明并发安全。
- Deeply adapt to DSH 0.2.2: add manifestVersion 1 and bilingual locale metadata; await database adapter teardown via async Cordis 4 `ctx.effect`, honor `effectivePolicy` in approval checks, and mark read-only tools concurrency-safe.

## 0.5.13 (2026-11-17)

- 在原生插件详情页单独检查和安装兼容版本。自动安装默认关闭，可为该插件开启空闲时的稳定补丁更新。
- Check and install compatible versions separately from the native plugin details. Automatic installation is off by default. Enable it for this plugin to apply stable patches while idle.

## 0.5.12 (2026-11-14)

- 适配 DSH 0.2.2-rc.3：最低 Harness 版本声明提升至 0.2.2-rc.3，运行时代码未变。
- Support DSH 0.2.2-rc.3: raise the minimum Harness declaration to 0.2.2-rc.3; runtime code is unchanged.

## 0.5.11 (2026-11-04)

- 同步共享界面：嵌入设置时继承宿主底色，输入框跟随主题，空状态保持可读宽度；新版 DSH 可显示插件设置图标。
- Align embedded surfaces, themed inputs, readable empty states and optional native settings icons.


## 0.5.10 (2026-11-03)

- 连接与模式查询失败保留原文并追加下一步；sql_list 补端口；空态给指引。
- Connection and schema failures keep the original error and add next steps; sql_list shows ports; empty states guide the next action.

## 0.5.9 (2026-10-30)

- 重整中英文首页：用途、三步流程图、安装入口与操作示例；详细配置与边界集中到完整说明。
- 保留下载统计、独立更新选择、问题反馈和贡献入口；原封面与运行功能保留。
- Refresh bilingual landing pages, workflow artwork, quick starts and reference navigation.


## 0.5.8 (2026-10-30)

- 原生插件列表与详情新增专门生成的鲸鱼娘图标：大头像、独立功能符号、透明留白，适合 30 / 36 px 显示；原封面保留。
- Add purpose-made whale-girl artwork with a distinct function emblem, transparent padding and small-size readability; preserve the original cover.


[返回简介](README.md) · [使用说明](docs/USAGE.md) · [验证记录](docs/VALIDATION.md)

## 0.5.7 (2026-10-29)

- 补齐中英文使用流程：准备、入口、具体操作与结果核对；新增累计 npm 下载徽章并保留月统计。
- Add practical getting-started workflows and lifetime npm download badges alongside monthly counts.

## 0.5.6 (2026-10-29)

- 同步仓库与 npm 的简明介绍、中英文 README 和反馈入口；本次为文档与包元数据更新。
- Sync npm descriptions and both README guides with the repository, including issue and pull-request links.

## 0.5.5 (2026-10-28)

- 写入确认与健康检查正确读取会话审批策略。never 或未知策略明确说明操作未执行及恢复方式；保留宿主拒绝、只读限制与完整 SQL 审批摘要。

## 0.5.4 (2026-10-28)

- 修复 PostgreSQL 查询能修改会话默认设置，再通过写函数绕过只读保护的问题。每次查询强制使用独立只读事务并回滚；允许审批写入时查询工具仍保持只读。
- PostgreSQL 查询使用扩展协议，服务器拒绝同一请求中的多条命令。MySQL 同步等待只读事务建立，设置失败时拒绝查询；不再忽略连接初始化错误。
- 查询成功或失败后回滚；取消或达到行数上限时销毁连接；回滚失败的连接不放回池中。保留行数限制、同名列和 64 位整数处理。
- 增加真实 PostgreSQL 可选回归，覆盖设置修改、写函数、多语句、截流、取消与合法审批写入；默认测试不启动或下载数据库。

## 0.5.3 (2026-10-27)

- 修复分批更新时的新旧更新控件混用：保留原页面、草稿与安装保护，空闲后接管旧控制器，兼容旧入口。

## 0.5.2 (2026-10-27)

- 更新控件移至原有工作台或原生插件详情页底部；更新记录与选项原地展开，移除独立更新菜单与页面。
- 保留原页面操作与草稿，自动安装默认关闭；安装前确认，遇到未保存修改或运行任务时暂停。

## 0.5.1 (2026-10-27)

- Keep this component's own update entry visible when installed transitively through Suite. Confirm whole-Suite update scope before opening its controls.
- Keep automatic installation off by default and preserve independent installation behavior.

## 0.5.0 (2026-10-26)

- Add this plugin’s own update controls and independent preferences. Automatic installation stays off until explicitly enabled.
- Confirm manual installs, preserve local sources and disabled state, pause for tasks or unsaved changes, and use native DSH recovery without forced restarts.
- Require the public DSH 0.2.1-rc.3 update APIs; Suite components remain managed through Suite.

## 0.4.6 (2026-10-20)

- 修复 sql_query 只读校验与 PostgreSQL 反斜杠语义不一致的问题：词法去噪改为按引擎处理反斜杠（MySQL 默认转义 / PostgreSQL 只有 `E'…'`、`U&'…'` 转义 / SQLite 与引号标识符里都不转义）。`SELECT '\'; DELETE FROM users; --'` 这类双语句载荷会被拒绝，不再能在 readOnly=true 下删表
- 修复 PRAGMA 函数式写法绕过只读校验的问题：`PRAGMA foreign_keys(0)`、`writable_schema(1)`、`user_version(4242)` 等与 `name=value` 等价，现在改为只读 PRAGMA 白名单，只放行 table_info / index_list / page_count 等内省语句
- readOnly=true 时把只读约束下沉到数据库自身：SQLite 以只读方式打开文件、PostgreSQL 加 `-c default_transaction_read_only=on`、MySQL 每个新连接执行 `SET SESSION TRANSACTION READ ONLY`。词法校验被绕过时服务器仍会拒绝写入
- sql_exec 审批文本不再截断到 200 字符：逐条列出每条语句并附语句类型统计；超过 800 字符时把完整 SQL 指回工具参数，200 字符之后的 DROP TABLE 不会再从审批卡里消失
- 新增 `test/readonly-hardening.test.mjs`（10 项回归），`tools.test.mjs` 的 PRAGMA 断言同步更新

## 0.4.5 (2026-10-05)

- 保留 SQLite 64 位整数与三种数据库的同名列；零行结果保留列名。同名列 JSON 导出使用 columns / rows，避免后列覆盖前列。

## 0.4.4 (2026-09-28)

- 更新官方 Harness 0.2.0-rc.1 的兼容声明和共同加载验证；运行时代码未变。验证范围见[验证记录](docs/VALIDATION.md)。

## 更早的改动

完整历史可查阅 [GitHub 提交记录](https://github.com/STARDUSTLC666/dsh-sql/commits/master)。
