# dsh-sql Usage Guide

[Overview](../README.en.md) · [Changelog](../CHANGELOG.md) · [Validation](VALIDATION.md)

## Get Started in 3 Steps

### Step 1: Add Your Database Connection (Applies Live)

**Option A (Recommended): Native DSH Settings Form**

Open **DSH → Settings → Plugins → SQL (`dsh-sql`)**:
- Add one or more entries under `connections` (`sqlite`, `mysql`, or `postgres`) — `password` fields are secret-masked and **changes take effect immediately on save without restarting DSH**;
- For production replicas, turn on `readOnly` to block writes at both the plugin and driver levels.

**Option B: Environment Variables + `cordis.patch.yml`**

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
        port: 5432
        user: readonly_user
        database: app
        # Prefer env var DSH_SQL_PASSWORD_PROD, or fill password in DSH Settings
      - name: legacy
        engine: mysql
        host: 127.0.0.1
        port: 3306
        user: root
        database: legacy
    maxRows: 1000                     # read query row cap (1–10000)
    queryTimeoutMs: 60000             # per-query timeout (default 60s)
    execTimeoutMs: 120000             # per-write timeout (default 120s)
    readOnly: false                   # true disables sql_exec completely
    writeApproval: true               # require confirmation before writes (default true)
```

> When no connections are configured yet, the plugin provides a temporary `:memory:` SQLite connection named `default` for instant sandboxing and clearly notes that no external database has been added yet.

### Step 2: Let the Assistant Discover Schema & Scale First

Before running analytics or edits, ask the assistant to check connectivity, list tables, and inspect column definitions so it never guesses table or column names.

### Step 3: Query Safely in Read-Only Mode, Approve Writes Statement-by-Statement

- Read queries run inside read-only transactions with lexer-grade keyword guards and streaming row caps;
- Whenever a write or DDL script is needed, `writeApproval` summarizes every statement and statement type in a confirmation prompt before anything touches your database.

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
| `Access denied` / `password authentication failed` | Wrong username or password | Update `user`/`password` in Settings or set `DSH_SQL_PASSWORD_<NAME_UPPER>` |
| `Unknown database` / `database "…" does not exist` | Typo in `database` or DB not created | Check the `database` field in your connection config |
| `SQLITE_CANTOPEN` | Missing file path or directory permissions | Check the SQLite path and read/write permissions |
| `no such table` / `relation "…" does not exist` | Table name case or schema mismatch | Call `sql_schema` without `table` first to list exact table names |
| `sql_exec` says confirmation is unavailable (`never`) | Session policy disables interactive prompts | Switch to an `ask`-capable mode, or explicitly set `writeApproval: false` if intended |
| Write reports "0 rows affected" | `WHERE` matched nothing, or DDL/multi-statement script | Re-check target rows with `sql_query` |

---

## Tool & Safety Reference

### Registered Tools

| Tool | Purpose | Safety Guardrails |
| :--- | :--- | :--- |
| `sql_list` | List connections & run `SELECT 1` probes | Never echoes passwords; flags temporary `:memory:` fallback |
| `sql_schema` | List all tables or inspect columns/PK/nullability | Identifier allowlist validation |
| `sql_stats` | Table counts, row counts, and DB size | Quoted identifiers & isolated per-table failures |
| `sql_query` | Read-only SQL (`table` / `csv` / `json` output) | Engine-aware lexer guard + single-statement + MySQL/PG `READ ONLY` rollback + streaming `maxRows` cap |
| `sql_exec` | Writes & DDL (multi-statement supported) | `readOnly` lock + statement-by-statement approval summary |
| `sql_health` | Connection & safety policy self-check | Per-connection ping + approval channel verification |

### Data Precision & Cancellation Notes

- **Lossless bigints**: Safe integers stay `number`; larger `bigint` values serialize as exact decimal strings.
- **Duplicate column names**: `format: "json"` switches to `{ columns, rows }` when duplicate column names appear so values are never overwritten.
- **Cancellation**: Observes Harness `exec.signal` and destroys active MySQL/PostgreSQL query connections on cancel (`node:sqlite` runs synchronously; avoid unbounded cross-joins on unknown tables).

## Install, Uninstall & Development

```bash
# Install (use desktop instead of web for DSH Desktop)
dsh plugin --profile web add dsh-sql

# Uninstall
dsh plugin --profile web remove dsh-sql

# Build & run full test suite
pnpm install
pnpm test
```

## License

MIT
