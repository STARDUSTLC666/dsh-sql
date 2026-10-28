# dsh-sql 验证记录

## 2026-10-28：0.5.5

[本次修复与验收边界](validation-0.5.5.md)。

本页整理原 README 的历史验证说明，保留当时的版本、日期与范围。自动测试、启动检查、浏览器操作和真实服务验收分别记录，不能相互替代。更详细的版本验收文件仍保留在仓库中。

## 0.5.4（2026-10-28）

- Windows / Node 24.16.0：71 项检查通过，包含真实 PostgreSQL 17.10 的可选集成回归。测试数据库、表、函数与账号均为隔离夹具。
- 已在 0.5.3 复现：查询修改 `default_transaction_read_only` 后，后续 SELECT 写函数能落盘。0.5.4 在同一真实数据库拒绝该写入，查询始终处于只读事务。
- 真实 PostgreSQL 覆盖 readOnly 开关两种状态、有界和无界查询、修改当前事务设置、多命令拒绝、写函数拒绝、错误后恢复、行数截流、取消以及合法 exec 写入。MySQL 只验证真实 mysql2 流事件与连接生命周期夹具，未连接真实 MySQL 服务。
- 官方 DSH 0.2.1-rc.3 原生网页版：工具入口拒绝原 Issue #3 的多语句和 PRAGMA 写入；浏览器审批卡显示 200 字符后面的 DROP，点击拒绝后真实 SQLite 数据保持不变。浏览器使用后台 Chrome，未验收 Electron 原生窗口。
- 运行可选 PostgreSQL 回归：在专用测试环境中把连接对象 JSON 写入环境变量 `DSH_SQL_TEST_POSTGRES`，再执行 `pnpm test`；未设置时明确跳过该集成项，不启动或下载数据库。

## 原中文记录

验证宿主：官方源码构建的 Harness `0.2.0-rc.1`（commit `407e65c8`）+ Node `24.16.0`（2026-09-28）。53 项插件测试在隔离环境全部通过；同一个宿主里 18 个插件共同加载，注册 6 个工具，工具 schema 与健康检查契约通过。本轮未启用真实端口与外部服务。

## Original English record

Validation host: Harness `0.2.0-rc.1` built from official sources (commit `407e65c8`) with Node `24.16.0` on 2026-09-28. All 53 plugin tests pass in an isolated environment; all 18 plugins mount together in one host registering 6 tools, with tool schemas and health-check contracts passing. No live ports or external services were exercised in this round.
