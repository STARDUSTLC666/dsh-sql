**简体中文** · [English](README.en.md)

# SQL

**先摸清表结构，再用只读查询安全回答问题。**

DeepSeek Harness（`>=0.2.2-rc.3`）数据库插件：统一支持 SQLite、MySQL 与 PostgreSQL 的多连接管理、原生设置面板与密码脱敏、表结构与数据规模探查、流式有界只读查询，以及受宿主审批门控的写操作。

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

**[安装使用](#安装) · [最快 3 步用起来](#最快-3-步用起来) · [完整说明](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/USAGE.md)**

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-mobile-dark.svg">
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-dark.svg">
  <img src="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-light.svg" alt="先看表结构，再用查询回答问题。 · 流程示意" width="100%">
</picture>

## 安装

在 DSH 桌面版「插件」面板搜索安装 `dsh-sql`，或使用命令行：

```bash
dsh plugin --profile desktop add dsh-sql
```

网页版把 `desktop` 改为 `web`；安装后重启一次 DSH。宿主要求 `>=0.2.2-rc.3`。

<a id="开始使用"></a>
## 最快 3 步用起来

1. **在原生设置添加数据库连接（保存即生效）**：打开 DSH「**设置 → 插件 → 数据库（dsh-sql）**」，添加 SQLite 文件、MySQL 或 PostgreSQL 连接（支持直接粘贴 `url` 连接串与 `?sslmode=`，云数据库 `ssl` 兼容 `disable` / `allow` / `prefer` / `require` / `verify-ca` / `verify-full` 及 `{ rejectUnauthorized, ca }`；密码自动脱敏，也可用环境变量 `DSH_SQL_PASSWORD_<连接名大写>`；支持全局或单连接 `readOnly` 锁死写入，以及热更新的 `redactColumns` 敏感列脱敏）。
2. **先探查结构与规模**：让助手先跑连通性自检，按 `schema` / `pattern` 列出表清单（PostgreSQL 含物化视图），并用 `table` 或批量 `tables`（最多 20 张表并发）查看字段、默认值、PostgreSQL 枚举值（`enumValues`）、注释、索引与外键，再查业务数据，避免盲猜表名或扫崩大表。
3. **只读回答日常问题，写操作逐条审批**：`sql_query` 支持 `limit`、参数化 `params`、`table`/`markdown`/`csv`/`json` 格式（默认 `table` 以 GFM Markdown 表格渲染）、执行耗时 `durationMs` 与 `redactColumns` 脱敏（`[REDACTED]`），自动走引擎级只读保护（SQLite `PRAGMA query_only`、MySQL/PostgreSQL 独立只读事务与 PG `NO SCROLL CURSOR` 连接复用）及服务端超时与取消；确需修改数据时，`sql_exec` 支持参数化写入、三引擎多语句脚本与服务端写超时，审批卡会标明目标连接、绑定 `params`、每条 SQL 及 `⚠️ 高危提示`（`DROP` / `TRUNCATE` / 无 `WHERE` 的 `DELETE` / `UPDATE`），未知连接名直接快速拒绝，经你确认后才执行。

## 平时怎么对助手说（可直接复制的自然语言示例）

- **连接自检与库表盘点（接手陌生库第一步）**
  > 先检查数据库连接状态，列出当前库里的所有表和大概行数，帮我梳理核心业务表关系。
- **业务数据分析与导出 CSV（纯只读、带上限保护）**
  > 先看 `orders` 和 `users` 的字段结构，再用只读查询统计最近 7 天各状态订单量与总金额，结果顺便给我一份 CSV。
- **审慎修改数据（执行前审批 + 执行后复查）**
  > 先查一下 `id = 42` 这笔订单当前的状态确认没选错行，再生成将状态改为 `paid` 的更新语句让我审批，执行完后再查一次确认结果。

## 常见卡点自检

| 遇到的现象 | 10 秒定位原因 | 怎么修 |
| :--- | :--- | :--- |
| 只看到 `default (:memory:)` 且没有业务表 | 还没配置外部数据库连接，当前在用内置临时内存库 | 打开 DSH「设置 → 插件 → 数据库」添加连接并保存（立即生效，无需重启） |
| `ECONNREFUSED` / `ETIMEDOUT` | 数据库未启动、`host`/`port` 填错或防火墙拦截 | 核对服务端口与连接配置后重新运行自检 |
| TLS/SSL 握手或证书校验失败 | 云数据库要求加密连接，或自签名/CA 证书路径有误 | 在连接配置中设置 `ssl` 或 `url` `?sslmode=`（支持 `disable` / `allow` / `prefer` / `require` / `verify-ca` / `verify-full`，自签名可用 `{ rejectUnauthorized: false }` 或配置存在的 `ca` 文件/PEM 证书；仅本地可信网络设 `disable`） |
| `Access denied` / `password authentication failed` | 用户名或密码错误 | 在「设置 → 插件 → 数据库」重填密码，或设置环境变量 `DSH_SQL_PASSWORD_<连接名大写>` |
| 写操作提示「当前策略 never 无法询问」 | 会话处于不弹窗模式，写审批门为安全拒绝静默执行 | 切回可询问（ask）会话模式使审批卡弹出；若仅需只读，开启全局或全部连接 `readOnly` 后自检自动放行 |

## 插件更新

在原生插件详情页底部检查更新。默认自动检查，**默认不自动安装**；是否安装、何时重启由你决定。Suite 管理的组件随整包更新。

## 文档

- [使用说明与参数参考](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/USAGE.md)
- [详细参考说明](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/REFERENCE.zh.md)
- [更新记录](https://github.com/STARDUSTLC666/dsh-sql/blob/master/CHANGELOG.md)
- [验证范围与历史](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/VALIDATION.md)

## 反馈与贡献

如果插件帮到了你，欢迎 Star。问题和建议请提交 [Issues](https://github.com/STARDUSTLC666/dsh-sql/issues)，也欢迎 [PR](https://github.com/STARDUSTLC666/dsh-sql/pulls)（反馈时请移除凭据）。

## License

[MIT](https://github.com/STARDUSTLC666/dsh-sql/blob/master/LICENSE)

<a id="依赖与配置"></a>
