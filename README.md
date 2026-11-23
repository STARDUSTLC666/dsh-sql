**简体中文** · [English](README.en.md)

# SQL

> **先摸清表结构，再用只读查询与参数审批安全处理数据库。**

DeepSeek Harness（`>=0.2.2-rc.3`）多引擎数据库插件：统一支持 SQLite、MySQL 与 PostgreSQL，提供可视化热生效设置面板、一键连通性测试、引擎级只读保护、敏感列脱敏与高危写操作审批门。

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

**[核心能力](#核心能力) · [安装](#安装) · [最快 3 步用起来](#最快-3-步用起来) · [完整说明](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/USAGE.md)**

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-mobile-dark.svg">
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-dark.svg">
  <img src="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-light.svg" alt="先看表结构，再用查询回答问题。 · 流程示意" width="100%">
</picture>

## 核心能力

| 模块 | 核心特性 |
| :--- | :--- |
| **多引擎与云库 SSL** | 统一管理 SQLite / MySQL / PostgreSQL，支持直接粘贴 `url` 连接串与全模式 TLS/SSL 配置；密码自动脱敏并支持环境变量 `DSH_SQL_PASSWORD_<连接名大写>` |
| **批量结构探查** | 按 `schema`/`pattern` 列出表与 PG 物化视图；支持单表或最多 20 张表并发查看字段、默认值、PG 枚举值、注释、索引与外键 |
| **引擎级只读查询** | `sql_query` 强制走 SQLite `PRAGMA query_only` 与 MySQL/PG 只读事务（含 PG 游标复用与服务端超时），支持行数上限、`params` 参数化及 Markdown/CSV/JSON 输出 |
| **敏感列脱敏与锁死写入** | 支持全局或单连接 `readOnly` 锁死写入，以及热生效的 `redactColumns` 敏感列自动打码（`[REDACTED]`） |
| **高危 SQL 审批门** | `sql_exec` 支持参数化与多语句脚本；审批卡完整列出目标连接、绑定参数、每条 SQL 与 `⚠️ 高危提示`（`DROP`/`TRUNCATE`/无 `WHERE` 删改） |

## 安装

在 DSH 桌面版「插件」面板安装 `dsh-sql`，或使用命令行：

```bash
dsh plugin --profile desktop add dsh-sql
```

网页版将 `desktop` 改为 `web`，安装后重启 DSH。宿主要求：`>=0.2.2-rc.3`。

<a id="开始使用"></a>
## 最快 3 步用起来

1. **添加并测试连接（保存即生效）**：打开 **DSH 设置 → 数据库**（也可在 **设置 → 内置插件 → 数据库** 或 **插件 → 数据库** 中打开），可视化添加连接或粘贴 `url`、点击 **测试连接 / 测试草稿连接** 一键校验连通性；生产库可勾选全局或单连接 `readOnly` 锁死写入，并按需配置 `redactColumns` 敏感列脱敏。
2. **先探查结构与规模**：让助手先跑连通性自检，列出表清单、字段定义与外键关系，再写业务查询，避免盲猜表名或扫崩大表。
3. **只读分析，写入逐条审批**：日常查询自动受只读事务与行数上限保护；修改数据时在审批卡核对每条 SQL 与参数，确认后再执行并复查。

### 常用对话示例

- **陌生库盘点**：`先检查数据库连接状态，列出当前库里的所有表和大概行数，帮我梳理核心业务表关系。`
- **只读分析导 CSV**：`先看 orders 和 users 的字段结构，再用只读查询统计最近 7 天各状态订单量与总金额，结果给我一份 CSV。`
- **审慎改数闭环**：`先查 id = 42 这笔订单当前状态，再生成改为 paid 的更新语句让我审批，执行完后再查一次确认。`

## 常见卡点自检

| 现象 | 原因 | 处理方式 |
| :--- | :--- | :--- |
| 只看到 `default (:memory:)` 且无业务表 | 尚未配置外部连接，当前使用临时内存库 | 打开 **DSH 设置 → 数据库**（或「设置 → 内置插件 → 数据库」/「插件 → 数据库」）添加连接、一键测试并保存（保存即生效，无需重启） |
| `ECONNREFUSED` / `ETIMEDOUT` | 数据库未启动、地址端口错误或防火墙拦截 | 核对服务状态与端口配置后点击「测试连接」或重新自检 |
| TLS/SSL 握手或证书校验失败 | 云库要求加密或自签名证书未信任 | 配置 `ssl` / `?sslmode=`（自签名可用 `{ rejectUnauthorized: false }` 或指定 `ca`） |
| `Access denied` / 认证失败 | 用户名或密码有误 | 在 **设置 → 数据库** 重填密码并点击「测试连接」验证，或设置环境变量 `DSH_SQL_PASSWORD_<连接名大写>` |
| 写操作提示策略 `never` 无法询问 | 会话处于不弹窗模式，安全拒绝静默写入 | 切回可询问（`ask`）模式；纯只读场景开启 `readOnly` 即可 |

## 插件更新

在原生插件详情页底部检查更新。默认自动检查，**默认不自动安装**；Suite 管理的组件随整包更新。

## 文档与反馈

- [使用说明与配置参考](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/USAGE.md) · [详细参考](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/REFERENCE.zh.md) · [更新记录](https://github.com/STARDUSTLC666/dsh-sql/blob/master/CHANGELOG.md) · [验证历史](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/VALIDATION.md)
- 欢迎 Star、提交 [Issues](https://github.com/STARDUSTLC666/dsh-sql/issues) 与 [PR](https://github.com/STARDUSTLC666/dsh-sql/pulls)（反馈请移除凭据）。

## License

[MIT](https://github.com/STARDUSTLC666/dsh-sql/blob/master/LICENSE)

<a id="依赖与配置"></a>
