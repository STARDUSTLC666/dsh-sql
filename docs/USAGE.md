# dsh-sql 使用说明

[返回简介](../README.md) · [更新记录](../CHANGELOG.md) · [验证记录](VALIDATION.md)

## 本次改进

安全范围内整数保持 number，超出范围按十进制字符串输出。同名列 JSON 使用 { columns, rows }，其他 JSON 仍为对象数组。SQLite 当前使用同步执行：行数上限限制返回数据，不能中断已运行的耗时 SQL；请避免对未知数据执行无界复杂查询。

## 安装

```bash
dsh plugin --profile web add dsh-sql
```

## 卸载

```bash
dsh plugin --profile web remove dsh-sql
```

卸载后重启 Web 服务。如需彻底清理，可再手动删除自己 profile `cordis.patch.yml` 中覆盖的插件行。

## 配置

```yaml
- id: sql
  name: 'dsh-sql'
  config:
    connections:
      - name: local
        engine: sqlite
        file: E:\data\app.db          # 或 :memory:
      - name: prod
        engine: postgres
        host: db.internal
        database: app
        # password: xxx              # 推荐环境变量 DSH_SQL_PASSWORD_PROD
      - name: legacy
        engine: mysql
        host: 127.0.0.1
        port: 3306
        user: root
        database: legacy
    maxRows: 1000                     # 查询返回行数上限（1-10000）
    queryTimeoutMs: 60000             # 单次查询超时（默认 60 秒，5 秒 - 10 分钟）
    execTimeoutMs: 120000             # 单次写操作超时（默认 120 秒，5 秒 - 10 分钟）
    readOnly: false                   # true 时禁用 sql_exec，并让数据库自身以只读方式连接
    writeApproval: true               # 写操作先弹审批（默认 true）
```

配置缺省时会提供一个 `:memory:` SQLite 连接；配置一旦给出但格式无效，插件会直接报错并停止加载，不会静默回退到内存库。

## 工具一览

| 工具 | 作用 | 安全 |
| :-- | :-- | :-- |
| `sql_list` | 列出连接 + 连通性测试 | — |
| `sql_query` | 只读查询（SELECT/PRAGMA/EXPLAIN/SHOW/DESCRIBE/WITH）| 按引擎去噪的关键字白名单 + 拒绝多语句 + PRAGMA 白名单 |
| `sql_exec` | 写操作/DDL（可多语句脚本）| readOnly 禁用 + 审批门 |
| `sql_schema` | 表清单 / 表结构 | 标识符白名单校验 |
| `sql_stats` | 表数量、行数与库体积概览 | 表名引用 + 查询失败隔离 |
| `sql_health` | 连接与安全配置自检 | 逐连接探活，不回显密码 |

### 示例

```text
sql_list {}
sql_schema {}                                  # 列出所有表
sql_schema { table: users }                    # 看 users 表结构
sql_stats {}                                   # 查看默认连接的数据规模
sql_health {}                                  # 检查连接和安全配置
sql_query { sql: SELECT * FROM orders WHERE status = 'pending' LIMIT 50 }
sql_exec { sql: UPDATE orders SET status = 'paid' WHERE id = 42 }
```

## 安全设计

- **词法级只读保护**：sql_query 先剥离字符串/注释再校验，拒绝 data-modifying CTE（WITH…DELETE/UPDATE）、SELECT INTO、FOR UPDATE/FOR SHARE、多语句，以及不在只读白名单里的 PRAGMA。去噪按引擎处理反斜杠（MySQL 默认转义、PostgreSQL 只有 `E'…'`/`U&'…'` 转义、SQLite 与引号标识符里都不转义），避免「校验看到一条、服务器执行两条」
- **写审批门**：sql_exec 默认弹审批（对齐 dsh-email 的发信审批），headless 环境无审批通道时拒绝执行
- **readOnly 模式**：生产库可整体禁用写。除了禁用 sql_exec，还会把只读约束下沉到数据库自身：SQLite 以只读方式打开文件，PostgreSQL 用 `-c default_transaction_read_only=on` 启动参数，MySQL 在每个新连接上执行 `SET SESSION TRANSACTION READ ONLY`（需要 MySQL 5.6.5+ / MariaDB 10.0+）。即使词法校验被绕过，服务器也会拒绝写入
- **审批卡不藏语句**：sql_exec 的审批文本逐条列出每条语句，并给出一行语句类型统计；超过 800 字符时把完整 SQL 指回工具参数，第二条 DROP / DELETE 不会因为截断而从审批卡里消失
- **流式行数钳制**：SQLite 迭代器 / MySQL Readable / PostgreSQL Query 行事件最多收集 maxRows+1 行，超量标记 truncated；MySQL 和 PostgreSQL 在达到上限时关闭该查询的专用连接，未达上限则正常归还连接池，避免全量结果驻留内存
- **可取消执行**：查询与写操作遵守 Harness 的 `exec.signal`；取消时会中止等待并销毁正在工作的 MySQL/PostgreSQL 专用连接
- **大整数无损**：数据库返回的 bigint 在 JavaScript 安全整数范围内输出 number，超出范围则输出十进制字符串，避免静默丢精度
- **标识符校验**：表名只允许字母/数字/下划线，杜绝 schema 注入
- **密钥不落配置**：密码支持 `DSH_SQL_PASSWORD_<连接名>` 环境变量

## 引擎

- **SQLite**：Node 22.13+ 内置 `node:sqlite`，零依赖
- **MySQL**：mysql2 连接池
- **PostgreSQL**：pg 连接池

## 开发

```bash
pnpm install
pnpm test       # 构建 + 完整测试套件（含真实 SQLite 集成）
```

## License

MIT
