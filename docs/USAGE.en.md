# dsh-sql Usage Guide

[Overview](../README.en.md) · [Changelog](../CHANGELOG.md) · [Validation](VALIDATION.md)

## Get Started in 3 Steps

### Step 1: Add Your Database Connection (Applies Live)

**Option A (Recommended): Native DSH Settings Form**

Open **DSH → Settings → Plugins → SQL (`dsh-sql`)**:
- Add one or more entries under `connections` (`sqlite`, `mysql`, or `postgres`) — fill individual fields or paste a connection URI via `url` (`postgres://` / `postgresql://` / `mysql://` / `sqlite:` / `file:`, with explicit fields taking precedence); `password` fields are secret-masked and **changes take effect immediately on save without restarting DSH**;
- For cloud databases, set `ssl` per connection (`disable` / `require` / `verify-full` in Settings; `cordis.patch.yml` also accepts booleans or `{ rejectUnauthorized, ca }`);
- For production replicas, turn on `readOnly` globally or per connection to block writes across the plugin, approval gate, and database driver.

**Option B: Environment Variables + `cordis.patch.yml`**

```yaml
- id: sql
  name: 'dsh-sql'
  config:
    connections:
      - name: local
        engine: sqlite
        file: E:\data\app.db          # or :memory:; also supports url: sqlite:///path/to/app.db
      - name: prod
        engine: postgres
        host: db.internal             # or url: postgres://readonly_user@db.internal:5432/app?sslmode=require
        port: 5432
        user: readonly_user
        database: app
        readOnly: true                # per-connection read-only lock (blocks writes on this connection only)
        ssl: require                  # disable / require / verify-full / { rejectUnauthorized, ca }
        # Prefer env var DSH_SQL_PASSWORD_PROD, or fill password in DSH Settings
      - name: legacy
        engine: mysql
        url: mysql://root@127.0.0.1:3306/legacy
        ssl: disable                  # disable only on trusted local networks; use require/verify-full for cloud DBs
    maxRows: 1000                     # read query row cap (1–10000)
    queryTimeoutMs: 60000             # per-query timeout (default 60s, also forwarded server-side)
    execTimeoutMs: 120000             # per-write timeout (default 120s)
    readOnly: false                   # true disables sql_exec globally (or set readOnly per connection)
    writeApproval: true               # require confirmation before writes (default true, applies live)
```

> When no connections are configured yet, the plugin provides a temporary `:memory:` SQLite connection named `default` for instant sandboxing and clearly notes that no external database has been added yet.
> Connection `url` also reads `sslmode` / `ssl` query parameters; explicit fields take precedence over `url`, and password resolution follows explicit `password` → `url` password → `DSH_SQL_PASSWORD_<NAME_UPPER>`.

### Step 2: Let the Assistant Discover Schema & Scale First

Before running analytics or edits, ask the assistant to check connectivity, filter tables with `schema` / `pattern`, and inspect column definitions (including defaults and comments), indexes, foreign keys, and table sizes so it never guesses names or scans oversized tables blindly.

### Step 3: Query Safely in Read-Only Mode, Approve Writes Statement-by-Statement

- Read queries run through dialect-aware lexer guards, engine-level read-only enforcement (SQLite `PRAGMA query_only = ON`; MySQL/PostgreSQL independent `READ ONLY` transactions rolled back afterward), server-side query timeouts, and streaming row caps (`maxRows` / per-call `limit`), with parameterized `params` and `table` / `csv` / `json` output;
- Whenever a write or DDL script is needed, `sql_exec` supports parameterized `params` (single statement) and multi-statement scripts across SQLite, MySQL, and PostgreSQL; the `writeApproval` card identifies the **target connection** (name, engine, target host/db or file — never passwords) and lists every statement and statement type using the target engine's lexer before anything touches your database.

---

## Copy-Ready Prompts for Everyday Work

- **Explore an unfamiliar database**
  > Run a SQL health check, then list all tables and row counts in the `prod` connection and explain the core schema.
- **Answer business questions without guessing column names**
  > Inspect the `users` and `subscriptions` schemas first, then run a read-only query counting new paid subscriptions over the last 30 days grouped by plan.
- **Export query results as CSV or JSON**
  > Query the 50 most recent rows in `failed_jobs` and return them in `csv` format so I can paste them into a spreadsheet.
- **Safe data fix (verify row -> approve write -> verify result)**
  > Query order `ORD-2026-09` in `orders` first so I can check its current state, then prepare the update statement for approval, and query the row again afterward to verify.

---

## Quick Troubleshooting Checklist

Run `sql_health` first (pings each connection, checks approval readiness, and attaches actionable next steps to any failure):

| Symptom | Usual Cause | Quick Fix |
| :--- | :--- | :--- |
| Only `default (sqlite @ :memory:)` appears | No external connection configured yet | Add your database under `connections` in **DSH Settings → Plugins → SQL** (applies live) |
| `ECONNREFUSED` / `ETIMEDOUT` | Server stopped, wrong `host`/`port`, or firewall | Verify server status and `host`/`port`; raise `queryTimeoutMs` for slow networks |
| TLS/SSL handshake or certificate error (`self-signed` / `certificate` / `no encryption`) | Cloud DB requires TLS or self-signed cert failed verification | Set `ssl` on the connection: `"require"` or `"verify-full"` for cloud DBs, `{ rejectUnauthorized: false }` or `ca` (PEM text or file path) for self-signed certs; `"disable"` only on trusted local networks |
| `Access denied` / `password authentication failed` | Wrong username or password | Update `user`/`password` in Settings or set `DSH_SQL_PASSWORD_<NAME_UPPER>` |
| `Unknown database` / `database "…" does not exist` | Typo in `database` or DB not created | Check the `database` field in your connection config |
| `SQLITE_CANTOPEN` | Missing file path or directory permissions | Check the SQLite path and read/write permissions |
| `no such table` / `relation "…" does not exist` | Table name case or schema mismatch | Call `sql_schema` without `table` (optionally with `schema` / `pattern`) first to list exact table names |
| `sql_exec` says confirmation is unavailable (`never`) | Session policy disables interactive prompts | Switch to an `ask`-capable mode, or explicitly set `writeApproval: false` if intended |
| Write reports "0 rows affected" | `WHERE` matched nothing, or DDL/multi-statement script | Re-check target rows with `sql_query` |

---

## Tool & Safety Reference

### Registered Tools

| Tool | Purpose & Key Parameters | Safety Guardrails |
| :--- | :--- | :--- |
| `sql_list` | Concurrently list connections & run `SELECT 1` probes with `readOnly` / `SSL` tags | Never echoes passwords; flags temporary `:memory:` fallback |
| `sql_schema` | List tables (optional `schema` / `pattern` substring or `*` wildcard filter), or inspect `table` (supports `schema.table`) with columns (type, nullability, PK, default, comment), table comment, indexes, and foreign keys | Strict table/schema reference parsing to prevent injection |
| `sql_stats` | Table count, per-table row counts & sizes (PostgreSQL multi-schema + `pg_total_relation_size`; MySQL `BASE TABLE`; SQLite exact counts with `sqlite_stat1` fallback above 200 tables), and total DB size | Quoted identifiers, isolated per-table errors, and event-loop yields |
| `sql_query` | Read-only SQL with `sql`, `connection`, optional `limit` (clamped to `maxRows`), parameterized `params` (`?` for SQLite/MySQL, `$1`/`$2` for PostgreSQL), and `format` (`table` / `csv` / `json`) | Dialect-aware lexer guard + single-statement + SQLite `PRAGMA query_only = ON` per query + MySQL/PG `READ ONLY` rollback + server-side timeout + streaming row cap |
| `sql_exec` | Writes & DDL with `sql`, `connection`, optional `params` (single statement), and multi-statement scripts across SQLite, MySQL, and PostgreSQL | Global & per-connection `readOnly` locks + approval card displaying target connection & engine-aware statement breakdown (MySQL runs statements sequentially with `multipleStatements: false`) |
| `sql_health` | Concurrent per-connection ping & security policy self-check | Per-connection ping + `readOnly`/`SSL` tags + approval channel verification |

### Data Precision, Security & Runtime Notes

- **Engine-level read-only defense-in-depth**: Beyond the dialect-aware lexer guard, SQLite enforces `PRAGMA query_only = ON` on every `sql_query` (and persistently with defensive mode enabled when `readOnly: true`); MySQL and PostgreSQL run every query inside an independent `READ ONLY` transaction rolled back afterward (with PostgreSQL also using the extended query protocol to reject multi-commands).
- **Server-side timeouts & cancellation**: Observes Harness `exec.signal` and `queryTimeoutMs` / `execTimeoutMs`; read timeouts are also enforced server-side (PostgreSQL `SET LOCAL statement_timeout`, MySQL driver `timeout`), and cancellation immediately destroys active MySQL/PostgreSQL query connections (`node:sqlite` runs synchronously; avoid unbounded cross-joins on unknown tables).
- **Lossless bigints, compact BLOBs & JSON rendering**: Safe integers stay `number` while larger `bigint` values serialize as exact decimal strings; `Uint8Array`/`Buffer` values render as `0x...` up to 64 bytes and `<BLOB N bytes, hex: 0x...>` when larger; objects/arrays (e.g. PostgreSQL `jsonb`) format as JSON rather than `[object Object]`.
- **Duplicate column names & truncation reporting**: `format: "json"` switches to `{ columns, rows }` when duplicate column names appear so values are never overwritten; `table`, `csv`, and `json` all report exact `rowCount` and truncation warnings when the row cap is hit.

## Install, Uninstall & Development

```bash
# Install (use desktop instead of web for DSH Desktop)
dsh plugin --profile web add dsh-sql

# Uninstall
dsh plugin --profile web remove dsh-sql

# Typecheck, build & run full test suite (including real SQLite integration tests)
pnpm install
pnpm typecheck
pnpm test
```

## License

MIT
