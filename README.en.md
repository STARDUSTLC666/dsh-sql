[中文](README.md)

# dsh-sql

> **Your agent can query databases now**: SQLite / MySQL / PostgreSQL engines, read-only whitelist + write approval gate.

DSH (DeepSeek Harness) engineer-grade database plugin: six tools covering connection management, read-only queries, write operations, schema introspection, database statistics, and health checks.

![npm version](https://img.shields.io/npm/v/dsh-sql?label=npm&color=blue) ![npm downloads](https://img.shields.io/npm/dm/dsh-sql) ![license](https://img.shields.io/npm/l/dsh-sql) ![stars](https://img.shields.io/github/stars/STARDUSTLC666/dsh-sql?style=social)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

## Compatibility

Validation host: Harness `0.2.0-rc.1` built from official sources (commit `407e65c8`) with Node `24.16.0` on 2026-09-28. All 53 plugin tests pass in an isolated environment; all 18 plugins mount together in one host registering 6 tools, with tool schemas and health-check contracts passing. No live ports or external services were exercised in this round.

## Installation

```bash
dsh plugin --profile web add dsh-sql
```

## Uninstall

```bash
dsh plugin --profile web remove dsh-sql
```

Then restart the web service. To clean up fully, also remove the plugin entry from your profile `cordis.patch.yml` if you overrode it.


## Configuration

```yaml
- id: sql
  name: 'dsh-sql'
  config:
    connections:
      - name: local
        engine: sqlite
        file: E:\data\app.db          # or :memory:
      - name: prod
        engine: postgres
        host: db.internal
        database: app
        # password: xxx              # prefer env var DSH_SQL_PASSWORD_PROD
      - name: legacy
        engine: mysql
        host: 127.0.0.1
        port: 3306
        user: root
        database: legacy
    maxRows: 1000                     # query row cap (1-10000)
    queryTimeoutMs: 60000             # per-query timeout (default 60s, 5s - 10min)
    execTimeoutMs: 120000             # per-write timeout (default 120s, 5s - 10min)
    readOnly: false                   # true disables sql_exec
    writeApproval: true               # approve write operations first (default true)
```

With no connection configuration, the plugin provides a `:memory:` SQLite connection. If configuration is present but invalid, the plugin fails to load with the validation error instead of silently falling back to the in-memory database.

## Tools

| Tool | Purpose | Safety |
| :-- | :-- | :-- |
| `sql_list` | List connections + connectivity test | — |
| `sql_query` | Read-only queries (SELECT/PRAGMA/EXPLAIN/SHOW/DESCRIBE/WITH) | Keyword whitelist + rejects multi-statement |
| `sql_exec` | Writes / DDL (multi-statement scripts allowed) | readOnly lock + approval gate |
| `sql_schema` | Table list / table structure | Identifier whitelist validation |
| `sql_stats` | Table counts, row estimates, and database size | Quoted identifiers + isolated query failures |
| `sql_health` | Connection and safety-configuration checks | Per-connection probe; passwords are never returned |

### Examples

```text
sql_list {}
sql_schema {}                                  # list all tables
sql_schema { table: users }                    # inspect the users table
sql_stats {}                                   # inspect the default connection's data size
sql_health {}                                  # check connections and safety settings
sql_query { sql: SELECT * FROM orders WHERE status = 'pending' LIMIT 50 }
sql_exec { sql: UPDATE orders SET status = 'paid' WHERE id = 42 }
```

## Safety

- **Lexer-grade read-only guard**: sql_query strips strings/comments before validation, then rejects data-modifying CTEs (WITH…DELETE/UPDATE), SELECT INTO, FOR UPDATE/FOR SHARE, PRAGMA assignment, and multi-statement input
- **Write approval gate**: sql_exec asks for approval by default (mirroring dsh-email's send approval); headless environments without an approval channel are denied
- **readOnly mode**: lock out writes entirely for production databases
- **Streaming row cap**: SQLite iterators, MySQL Readables, and PostgreSQL Query row events collect at most maxRows+1 rows and flag overflow with truncated. MySQL and PostgreSQL close the query's dedicated connection at the cap; smaller results return the connection to the pool, without materializing the full result in memory
- **Cancellation-aware execution**: queries and writes observe Harness `exec.signal`; cancellation stops waiting and destroys the active dedicated MySQL/PostgreSQL connection
- **Lossless large integers**: bigint values within JavaScript's safe integer range are returned as numbers; larger values are returned as decimal strings instead of silently losing precision
- **Identifier validation**: table names restricted to alphanumerics and underscores — no schema injection
- **Secrets stay out of config**: passwords via `DSH_SQL_PASSWORD_<CONNECTION>` env vars

## Engines

- **SQLite**: built-in `node:sqlite` (Node 22.13+), zero dependencies
- **MySQL**: mysql2 pool
- **PostgreSQL**: pg pool

## Development

```bash
pnpm install
pnpm test       # build + full test suite, including a real SQLite integration suite
```

## License

MIT
