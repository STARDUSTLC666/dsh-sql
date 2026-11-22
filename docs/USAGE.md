# dsh-sql 使用说明

[返回简介](../README.md) · [更新记录](../CHANGELOG.md) · [验证记录](VALIDATION.md)

## 最快 3 步用起来

### 第 1 步：添加你的数据库连接（保存即生效）

**方式 A（推荐）：DSH 原生设置面板**

打开 **DSH → 设置 → 插件 → 数据库（`dsh-sql`）**：
- 在 `connections` 添加一条或多条连接（支持 `sqlite`、`mysql`、`postgres`），既可分字段填写，也可在 `url` 中直接粘贴连接 URI（`postgres://` / `postgresql://` / `mysql://` / `sqlite:` / `file:`，支持 `?sslmode=` / `?ssl=`，显式字段优先）；`password` 字段自动脱敏，保存后**立即生效、无需重启**；
- 云数据库可在单连接上配置 `ssl`（原生设置与 `cordis.patch.yml` 均支持 `disable` / `allow` / `prefer` / `require` / `verify-ca` / `verify-full`、布尔值与 `{ rejectUnauthorized, ca }`；`ca` 支持 PEM 原文或本地证书文件路径，路径不存在时直接报明确错误）；
- 如果部分连接是生产环境只读备库，既可开启全局 `readOnly`，也可仅在单条连接上勾选 `readOnly`，从插件、审批门与驱动层多重禁用写入；
- 如需防止查询结果把敏感字段直接暴露给模型，可开启热更新配置 `redactColumns`（默认 `false` 关闭；设为 `true` 启用内置密码/密钥/Token 脱敏规则，或传入自定义列名子串与 `/正则/` 数组，命中的非空单元格统一替换为 `[REDACTED]`）。

**方式 B：环境变量搭配 `cordis.patch.yml`**

```yaml
- id: sql
  name: 'dsh-sql'
  config:
    connections:
      - name: local
        engine: sqlite
        file: E:\data\app.db          # 或 :memory:；也支持 url: sqlite:///path/to/app.db
      - name: prod
        engine: postgres
        host: db.internal             # 或用 url: postgres://readonly_user@db.internal:5432/app?sslmode=verify-full
        port: 5432
        user: readonly_user
        database: app
        readOnly: true                # 单连接只读锁（仅禁止该连接写入）
        ssl: require                  # disable / allow / prefer / require / verify-ca / verify-full / { rejectUnauthorized, ca }
        # 密码推荐走环境变量 DSH_SQL_PASSWORD_PROD，也可填在设置页脱敏字段
      - name: legacy
        engine: mysql
        url: mysql://root@127.0.0.1:3306/legacy
        ssl: disable                  # 本地可信网络可关闭；云库建议 require / verify-ca / verify-full
    maxRows: 1000                     # 单次只读查询返回行数上限（1–10000）
    queryTimeoutMs: 60000             # 单次查询超时（默认 60 秒，同步下发服务端超时）
    execTimeoutMs: 120000             # 单次写操作超时（默认 120 秒，PostgreSQL/MySQL 同步下发服务端超时）
    readOnly: false                   # true 时全局禁用 sql_exec（也可在单连接设置 readOnly）
    writeApproval: true               # 写操作前弹审批卡（默认 true，热更新即刻生效）
    redactColumns: false              # true 启用内置敏感列脱敏，或传 ["phone", "/^card_/i"] -> [REDACTED]（热更新即刻生效）
```

> 未添加任何连接时，插件默认提供一个名为 `default` 的 `:memory:` 临时内存 SQLite 连接，方便开箱试用；自检与列表示意会明确提醒你当前处于临时内存库。
> 连接 `url` 支持从查询参数读取 `sslmode` / `ssl`（同样支持全部 6 种云库模式）；同一字段同时存在时以显式字段为准，密码优先级为「显式 `password` → `url` 内密码 → `DSH_SQL_PASSWORD_<连接名大写>`」。

### 第 2 步：让助手先摸清库结构与数据规模

连接配好后，不需要自己手写复杂 SQL——先让助手检查连接，按 `schema` / `pattern` 查看表清单（PostgreSQL 自动涵盖普通表、分区表、视图、物化视图与外部表），用单表 `table` 或批量 `tables`（最多 20 张表并发读取）获取列定义（含默认值、PostgreSQL `enumValues` 枚举值与注释）、索引、外键以及各表规模，再针对具体表提问。

### 第 3 步：只读查数放心问，写库逐条过目确认

- 日常查数走按引擎方言区分的词法级白名单 + 引擎级只读保护（SQLite 自动加 `PRAGMA query_only = ON`，MySQL / PostgreSQL 走独立只读事务并回滚，PostgreSQL 对有界无参查询通过 `NO SCROLL CURSOR` 复用连接）+ 服务端查询超时与取消 + 流式行数钳制，支持 `limit`、参数化 `params`、`redactColumns` 敏感列脱敏（`[REDACTED]`）、执行耗时 `durationMs` 与 `table` / `markdown` / `csv` / `json` 格式（默认 `table` 以 GFM Markdown 表格渲染），不会误改数据也不会撑爆内存；
- 需要建表、导入或订正数据时，`sql_exec` 支持参数化 `params`（单语句）、SQLite / MySQL / PostgreSQL 三引擎多语句脚本与服务端写超时；`writeApproval` 审批卡会标明**目标连接**（名称、引擎与目标地址，绝不回显密码）、绑定 `params`（PostgreSQL 显示 `$1=...`，SQLite/MySQL 显示 `[1]=...`），并按目标引擎词法拆出逐条语句、语句类型统计与 `⚠️ 高危提示`（自动标注 `DROP`、`TRUNCATE` 及缺少顶层 `WHERE` 的 `DELETE` / `UPDATE`），未知连接名直接快速拒绝而不会打扰你，点确认后才真正落库。

---

## 平时怎么对助手说（可直接复制的自然语言示例）

- **摸底陌生数据库**
  > 帮我检查一下所有数据库连接的健康状态，再看看 `prod` 连接里有哪些表、每张表大概多少行。
- **自然语言查数（防猜测字段名）**
  > 先读取 `users` 和 `subscriptions` 的表结构确认字段名，再帮我查出最近 30 天新增的付费订阅用户数量，按套餐分组。
- **把查询结果导出成 JSON 或 CSV**
  > 用只读查询把 `failed_jobs` 表里最近 50 条失败记录查出来，按 `csv` 格式输出方便我贴进表格排查。
- **带前后校验的安全数据订正**
  > 先查一下 `orders` 表里单号 `ORD-2026-09` 的当前金额与状态给我核对；没问题后再提交更新语句让我审批，执行完重新查询验证一次。

---

## 常见卡点自检

遇到报错时先让助手执行 `sql_health`（逐个连接探活并检查安全策略，每条错误自动附带「下一步」指引）：

| 现象 | 常见原因 | 一步修复 |
| :--- | :--- | :--- |
| 只看到 `default（sqlite @ :memory:）` 且无表 | 还没添加自己的数据库连接 | 打开 **DSH「设置 → 插件 → 数据库」**添加 `connections` 并保存（立即生效） |
| `ECONNREFUSED` / `ETIMEDOUT` | 数据库未启动、`host`/`port` 填错或被防火墙拦截 | 核对服务与端口，跨内网慢查询可适当调大 `queryTimeoutMs` |
| TLS/SSL 握手或加密校验失败（`self-signed` / `certificate` / `no encryption` / `SSL CA 证书文件不存在` 等） | 云数据库要求 TLS 加密、自签名证书未通过校验，或 `ssl.ca` 文件路径不存在 | 在连接配置中设置 `ssl` 或 `url` `?sslmode=`：支持 `"disable"` / `"allow"` / `"prefer"` / `"require"` / `"verify-ca"` / `"verify-full"`（云库常用 `require` / `verify-ca` / `verify-full`）；自签名证书可用 `{ rejectUnauthorized: false }` 或提供存在的 `ca` 文件路径 / PEM 证书原文；仅本地可信网络设 `"disable"` |
| `Access denied` / `password authentication failed` | 用户名或密码不对 | 在「设置 → 插件 → 数据库」核对 `user`/`password`，或检查环境变量 `DSH_SQL_PASSWORD_<连接名大写>` |
| `Unknown database` / `database "…" does not exist` | `database` 库名拼错或尚未创建 | 核对连接配置里的 `database` 字段 |
| `SQLITE_CANTOPEN` | SQLite 路径不存在或进程无读写权限 | 检查文件路径与所在目录权限 |
| `no such table` / `relation "…" does not exist` | 表名大小写或 Schema 不匹配 | 让助手先不带 `table`/`tables` 调用 `sql_schema`（可配合 `schema` / `pattern` 过滤，PostgreSQL 含物化视图）获取真实表名 |
| `sql_exec` 提示「当前策略 never 无法询问」 | 会话处于不弹窗模式（如完全自动模式），写审批拒绝静默放行 | 切回可询问（`ask`）模式审批，或在仅需查询时开启全局/全部连接 `readOnly`（`sql_health` 会自动识别为只读配置并放行），或由你本人在设置中显式关闭 `writeApproval` |
| 写操作提示「影响 0 行」 | `WHERE` 条件未命中记录，或执行的是 DDL / 多语句脚本 | 让助手用 `sql_query` 复查目标记录 |

---

## 工具与安全机制参考

### 注册工具清单

| 工具 | 作用与主要参数 | 安全护栏 |
| :--- | :--- | :--- |
| `sql_list` | 并发列出所有连接并探活（`SELECT 1`），展示只读与 SSL 标签 | 脱敏不回显密码；提示是否处于内置内存库 |
| `sql_schema` | 不带 `table`/`tables` 时按可选 `schema` / `pattern`（子串或 `*` 通配符）过滤表清单（PostgreSQL 含普通表、分区表、视图、物化视图与外部表）；带 `table`（支持 `schema.table`）或批量 `tables`（最多 20 张表并发，优先级低于 `table`）返回列（类型/非空/主键/默认值/PostgreSQL `enumValues`/注释）、表注释、索引与外键 | 严格表名与 schema 解析校验、零列提前返回、MySQL/PG 元数据并发拉取与批量单表错误隔离 |
| `sql_stats` | 统计表数量、各表行数与占用体积（PostgreSQL 多 Schema、`pg_total_relation_size`；MySQL `BASE TABLE`；SQLite 精确统计并在 >200 表时回退 `sqlite_stat1`）与库总体积 | 引用转义、单表错误隔离与事件循环让出 |
| `sql_query` | 只读查询：支持 `sql`、`connection`、可选 `limit`（不超过 `maxRows`）、参数化 `params`（SQLite/MySQL 用 `?`，PostgreSQL 用 `$1`/`$2`）与 `format`（`table` / `markdown` / `csv` / `json`，默认 `table` 以 GFM Markdown 表格渲染）；返回 `durationMs` 及命中的 `redactedColumns` | 按引擎方言词法防绕过 + 拒绝多语句/写 CTE/行锁 + SQLite 每次查询启用 `PRAGMA query_only = ON` + MySQL/PG 独立只读事务回滚（PG 有界无参查询走 `NO SCROLL CURSOR` 复用连接）+ 服务端超时与取消 + 流式行数钳制 + `redactColumns` 脱敏 |
| `sql_exec` | 写操作与 DDL：支持 `sql`、`connection`、可选 `params`（单语句参数化）与 SQLite / MySQL / PostgreSQL 多语句脚本；返回 `changes` 与 `durationMs` | 全局与单连接 `readOnly` 硬锁 + 未知连接名快速拒绝 + 审批卡展示目标连接、绑定 `params`（`$1=...` / `[1]=...`）、自动 `⚠️ 高危提示`（`DROP` / `TRUNCATE` / 无 `WHERE` 的 `DELETE` / `UPDATE`）与按引擎拆分的逐条语句清单（MySQL 保持 `multipleStatements: false` 顺序执行）+ 服务端写超时 |
| `sql_health` | 并发探活所有连接并汇总安全配置（含 `redactColumns` 与 `redactPatternCount`） | 逐连接探活 + `readOnly`/`SSL` 状态 + 审批门可达性检查（自动识别全局只读与「全部连接均为只读」配置） |

### 关键数据、安全与运行细节

- **引擎级只读纵深防御与 PostgreSQL 游标复用**：除词法白名单外，SQLite 连接在每次 `sql_query` 期间强制开启 `PRAGMA query_only = ON`（`readOnly` 连接持久开启并启用防御模式）；MySQL 与 PostgreSQL 每次查询都在独立 `READ ONLY` 事务中运行并回滚（PostgreSQL 使用扩展协议拒绝多命令；对无参数的有界 `SELECT` / `WITH` / `VALUES` / `TABLE` 查询，优先在事务内声明 `NO SCROLL CURSOR` 并 `FETCH`，回滚后安全归还连接池复用，其余情况自动回退到流式读取）。
- **服务端超时与尽力取消**：遵守宿主 `exec.signal` 与 `queryTimeoutMs` / `execTimeoutMs`；查询与写超时均会下发到数据库服务端（PostgreSQL 查询使用事务内 `SET LOCAL statement_timeout`，`PostgresAdapter.exec()` 使用 `SET statement_timeout` 并在结束时 `RESET statement_timeout`；MySQL 使用驱动 `timeout`）；请求中止或超时时，除销毁专用连接外还会尽力发送服务端取消指令（PostgreSQL `SELECT pg_cancel_backend($1)`、MySQL `KILL QUERY ?`）（注：Node 内置 `node:sqlite` 为同步执行，避免对未知超大表跑无界复杂笛卡尔积）。
- **敏感列脱敏（`redactColumns`）**：默认 `false`（关闭），支持在原生设置面板热更新；设为 `true` 时启用 12 条内置不区分大小写子串规则（`password`、`passwd`、`pwd`、`secret`、`token`、`api_key`、`apikey`、`access_key`、`private_key`、`credential`、`auth_key`、`session_key`），也可传入自定义 `string[]`（普通子串不区分大小写，`/pattern/` 或 `/pattern/flags` 正则仅允许 `i` / `u` 标志）。命中的非空单元格在 `table` / `markdown` / `csv` / `json` 渲染前统一替换为 `[REDACTED]`（保留 `NULL`），结果附带 `redactedColumns` 并在 `sql_health` 中汇报状态。
- **大整数、二进制与 JSON 友好渲染**：安全整数范围内保持 `number`，超出 `MAX_SAFE_INTEGER` 的 `bigint` 自动转为十进制字符串；`Uint8Array` / `Buffer` 在 ≤64 字节时输出 `0x...`，更大体积自动折叠为 `<BLOB N bytes, hex: 0x...>`；对象/数组（如 PostgreSQL `jsonb`）自动按 JSON 格式化，不出现 `[object Object]`。
- **Markdown 表格、重复列名与耗时反馈**：`sql_query` 新增 `format: "markdown"` 输出标准 GFM Markdown 表格，默认 `table` 渲染也统一为 GFM Markdown 表格（受 20 行与 8000 字符预览上限保护）；`sql_query` 与 `sql_exec` 均返回并展示 `durationMs` 执行耗时；`format: "json"` 遇到同名列时自动输出 `{ columns, rows }` 不静默覆盖列值；四种格式在触发行数上限时均准确返回 `rowCount` 与截断提示。

## 安装、卸载与开发

```bash
# 安装（桌面版把 web 换为 desktop）
dsh plugin --profile web add dsh-sql

# 卸载
dsh plugin --profile web remove dsh-sql

# 本地类型检查、构建与完整测试套件（含真实 SQLite 集成测试）
pnpm install
pnpm typecheck
pnpm test
```

## License

MIT
