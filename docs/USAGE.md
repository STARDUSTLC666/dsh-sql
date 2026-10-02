# dsh-sql 使用说明

[返回简介](../README.md) · [更新记录](../CHANGELOG.md) · [验证记录](VALIDATION.md)

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
    readOnly: false                   # true 时禁用 sql_exec
    writeApproval: true               # 写操作先弹审批（默认 true）
```

配置缺省时会提供一个 `:memory:` SQLite 连接；配置一旦给出但格式无效，插件会直接报错并停止加载，不会静默回退到内存库。

## 工具一览

| 工具 | 作用 | 安全 |
| :-- | :-- | :-- |
| `sql_list` | 列出连接 + 连通性测试 | — |
| `sql_query` | 只读查询（SELECT/PRAGMA/EXPLAIN/SHOW/DESCRIBE/WITH）| 关键字白名单 + 拒绝多语句 |
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

- **词法级只读保护**：sql_query 先剥离字符串/注释再校验，拒绝 data-modifying CTE（WITH…DELETE/UPDATE）、SELECT INTO、FOR UPDATE/FOR SHARE、PRAGMA 赋值与多语句
- **写审批门**：sql_exec 默认弹审批（对齐 dsh-email 的发信审批），headless 环境无审批通道时拒绝执行
- **readOnly 模式**：生产库可整体禁用写
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
