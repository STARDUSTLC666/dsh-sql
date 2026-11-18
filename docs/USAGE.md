# dsh-sql 使用说明

[返回简介](../README.md) · [更新记录](../CHANGELOG.md) · [验证记录](VALIDATION.md)

## 最快 3 步用起来

### 第 1 步：添加你的数据库连接（保存即生效）

**方式 A（推荐）：DSH 原生设置面板**

打开 **DSH → 设置 → 插件 → 数据库（`dsh-sql`）**：
- 在 `connections` 添加一条或多条连接（支持 `sqlite`、`mysql`、`postgres`），`password` 字段自动脱敏，保存后**立即生效、无需重启**；
- 如果连接的是生产环境只读备库，直接勾选 `readOnly`，即可从插件与驱动层双重禁用一切写操作。

**方式 B：环境变量搭配 `cordis.patch.yml`**

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
        port: 5432
        user: readonly_user
        database: app
        # 密码推荐走环境变量 DSH_SQL_PASSWORD_PROD，也可填在设置页脱敏字段
      - name: legacy
        engine: mysql
        host: 127.0.0.1
        port: 3306
        user: root
        database: legacy
    maxRows: 1000                     # 单次只读查询返回行数上限（1–10000）
    queryTimeoutMs: 60000             # 单次查询超时（默认 60 秒）
    execTimeoutMs: 120000             # 单次写操作超时（默认 120 秒）
    readOnly: false                   # true 时彻底禁用 sql_exec
    writeApproval: true               # 写操作前弹审批卡（默认 true）
```

> 未添加任何连接时，插件默认提供一个名为 `default` 的 `:memory:` 临时内存 SQLite 连接，方便开箱试用；自检与列表示意会明确提醒你当前处于临时内存库。

### 第 2 步：让助手先摸清库结构与数据规模

连接配好后，不需要自己手写复杂 SQL——先让助手检查连接、看表清单和每张表的规模，再针对具体表提问。

### 第 3 步：只读查数放心问，写库逐条过目确认

- 日常查数走词法级白名单 + 独立只读事务 + 流式行数钳制，不会误改数据也不会撑爆内存；
- 需要建表、导入或订正数据时，`writeApproval` 审批卡会把脚本拆成逐条语句清单与语句类型统计展示给你，点确认后才真正落库。

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
| `Access denied` / `password authentication failed` | 用户名或密码不对 | 在「设置 → 插件 → 数据库」核对 `user`/`password`，或检查环境变量 `DSH_SQL_PASSWORD_<连接名大写>` |
| `Unknown database` / `database "…" does not exist` | `database` 库名拼错或尚未创建 | 核对连接配置里的 `database` 字段 |
| `SQLITE_CANTOPEN` | SQLite 路径不存在或进程无读写权限 | 检查文件路径与所在目录权限 |
| `no such table` / `relation "…" does not exist` | 表名大小写或 Schema 不匹配 | 让助手先不带 `table` 调用 `sql_schema` 获取真实表名 |
| `sql_exec` 提示「当前策略 never 无法询问」 | 会话处于不弹窗模式（如完全自动模式），写审批拒绝静默放行 | 切回可询问（`ask`）模式审批，或由你本人在设置中显式关闭 `writeApproval` |
| 写操作提示「影响 0 行」 | `WHERE` 条件未命中记录，或执行的是 DDL / 多语句脚本 | 让助手用 `sql_query` 复查目标记录 |

---

## 工具与安全机制参考

### 注册工具清单

| 工具 | 作用 | 安全护栏 |
| :--- | :--- | :--- |
| `sql_list` | 列出所有连接并逐一探活（`SELECT 1`） | 脱敏不回显密码；提示是否处于内置内存库 |
| `sql_schema` | 查看全部表清单或指定表的字段/主键/非空定义 | 标识符白名单校验，防注入 |
| `sql_stats` | 统计表数量、各表行数与库体积 | 引用转义与单表查询错误隔离 |
| `sql_query` | 只读查询（支持 `table` / `csv` / `json` 格式） | 按引擎反斜杠规则去噪 + 拒绝多语句/写 CTE/行锁 + MySQL/PG 独立只读事务回滚 + 流式 `maxRows` 钳制 |
| `sql_exec` | 写操作与 DDL（支持多语句脚本） | `readOnly` 硬锁 + 逐条语句统计审批门 |
| `sql_health` | 连接与安全配置一键自检 | 逐连接探活 + 审批门可达性检查 |

### 关键数据与运行细节

- **大整数无损精度**：安全整数范围内保持 `number`，超出 `MAX_SAFE_INTEGER` 的 `bigint` 自动转为十进制字符串，不丢精度。
- **重复列名保护**：`format: "json"` 遇到同名列时自动输出 `{ columns, rows }`，不静默覆盖列值。
- **可取消查询**：遵守宿主 `exec.signal`，取消时立即中止等待并销毁正在工作的 MySQL / PostgreSQL 专用连接（注：Node 内置 `node:sqlite` 为同步执行，避免对未知超大表跑无界复杂笛卡尔积）。

## 安装、卸载与开发

```bash
# 安装（桌面版把 web 换为 desktop）
dsh plugin --profile web add dsh-sql

# 卸载
dsh plugin --profile web remove dsh-sql

# 本地构建与完整测试套件（含真实 SQLite 集成测试）
pnpm install
pnpm test
```

## License

MIT
