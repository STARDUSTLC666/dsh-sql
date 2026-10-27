# 更新记录

[返回简介](README.md) · [使用说明](docs/USAGE.md) · [验证记录](docs/VALIDATION.md)

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
