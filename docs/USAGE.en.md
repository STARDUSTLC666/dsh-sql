# dsh-sql Usage Guide

[Overview](../README.en.md) · [Changelog](../CHANGELOG.md) · [Validation](VALIDATION.md)

## Get Started in 3 Steps

### Step 1: Add Your Database Connection (Applies Live)

**Option A (Recommended): Visual DSH Settings Panel**

Open **DSH → Settings → SQL Databases** (also accessible from **Settings → Built-in Plugins → SQL** or **Plugins → SQL**):
- Visually add, edit, and remove one or more connections (`sqlite`, `mysql`, or `postgres`) — fill individual fields or paste a connection URI via `url` (`postgres://` / `postgresql://` / `mysql://` / `sqlite:` / `file:`, including `?sslmode=` / `?ssl=`, with explicit fields taking precedence);
- Use one-click **Test** / **Test draft** to check connectivity, latency, and table count before saving; `password` fields are secret-masked (left blank on edit preserves the stored password, with an optional clear checkbox) and **changes take effect immediately on save without restarting DSH**;
- For cloud databases, set `ssl` per connection (both Settings and `cordis.patch.yml` support `disable` / `allow` / `prefer` / `require` / `verify-ca` / `verify-full`, booleans, and `{ rejectUnauthorized, ca }`; `ca` accepts PEM text or a local certificate file path, failing fast with an explicit error if the file does not exist);
- For production replicas, turn on `readOnly` globally or per connection to block writes across the plugin, approval gate, and database driver;
- To keep sensitive fields from reaching the model, enable live-reloadable `redactColumns` (`false` by default; `true` enables built-in password/secret/token patterns, or pass custom column substrings and `/regex/` patterns to mask non-null cells to `[REDACTED]`).

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
        host: db.internal             # or url: postgres://readonly_user@db.internal:5432/app?sslmode=verify-full
        port: 5432
        user: readonly_user
        database: app
        readOnly: true                # per-connection read-only lock (blocks writes on this connection only)
        ssl: require                  # disable / allow / prefer / require / verify-ca / verify-full / { rejectUnauthorized, ca }
        # Prefer env var DSH_SQL_PASSWORD_PROD, or fill password in DSH Settings
      - name: legacy
        engine: mysql
        url: mysql://root@127.0.0.1:3306/legacy
        ssl: disable                  # disable only on trusted local networks; use require / verify-ca / verify-full for cloud DBs
    maxRows: 1000                     # read query row cap (1–10000)
    queryTimeoutMs: 60000             # per-query timeout (default 60s)
    execTimeoutMs: 120000             # per-write timeout (default 120s, also forwarded server-side on PG/MySQL)
    readOnly: false                   # true disables sql_exec globally (or set readOnly per connection)
    writeApproval: true               # require confirmation before writes (default true, applies live)
    redactColumns: false              # true for built-in secret patterns, or ["phone", "/^card_/i"] -> [REDACTED] (applies live)
```

> When no connections are configured yet, the plugin provides a temporary `:memory:` SQLite connection named `default` for instant sandboxing and clearly notes that no external database has been added yet.
> Connection `url` also reads `sslmode` / `ssl` query parameters (supporting all 6 cloud modes); explicit fields take precedence over `url`, and password resolution follows explicit `password` → `url` password → `DSH_SQL_PASSWORD_<NAME_UPPER>`.

### Step 2: Let the Assistant Discover Schema & Scale First

Before running analytics or edits, ask the assistant to check connectivity, filter tables with `schema` / `pattern` (PostgreSQL includes regular/partitioned tables, views, materialized views, and foreign tables), and inspect a single `table` or up to 20 `tables` concurrently for column definitions (including defaults, PostgreSQL `enumValues`, and comments), indexes, foreign keys, and table sizes so it never guesses names or scans oversized tables blindly.

### Step 3: Query Safely in Read-Only Mode, Approve Writes Statement-by-Statement

- Read queries run through dialect-aware lexer guards, engine-level read-only enforcement (SQLite `PRAGMA query_only = ON`; MySQL/PostgreSQL independent `READ ONLY` transactions rolled back afterward, with PostgreSQL `NO SCROLL CURSOR` connection reuse on bounded unparameterized queries), server-side timeouts and cancellation, and streaming row caps (`maxRows` / per-call `limit`), supporting parameterized `params`, `redactColumns` masking (`[REDACTED]`), `durationMs` timing, and `table` / `markdown` / `csv` / `json` output (default `table` renders as GFM Markdown tables);
- Whenever a write or DDL script is needed, `sql_exec` supports parameterized `params` (single statement), multi-statement scripts across SQLite, MySQL, and PostgreSQL, and server-side write timeouts; the `writeApproval` card identifies the **target connection** (name, engine, target host/db or file — never passwords), displays bound `params` (`$1=...` on PostgreSQL, `[1]=...` on SQLite/MySQL), surfaces automatic `⚠️ 高危提示` warnings for `DROP` / `TRUNCATE` / unfiltered `DELETE` / `UPDATE`, and lists every statement and statement type using the target engine's lexer (fast-denying unknown connection names without prompting) before anything touches your database.

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
| Only `default (sqlite @ :memory:)` appears | No external connection configured yet | Add your database in **DSH Settings → SQL Databases** (or **Settings → Built-in Plugins → SQL** / **Plugins → SQL**), test it, and save (applies live) |
| `ECONNREFUSED` / `ETIMEDOUT` | Server stopped, wrong `host`/`port`, or firewall | Verify server status and `host`/`port`; raise `queryTimeoutMs` for slow networks |
| TLS/SSL handshake or certificate error (`self-signed` / `certificate` / `no encryption` / missing CA file) | Cloud DB requires TLS, self-signed cert failed verification, or `ssl.ca` path does not exist | Set `ssl` or `url` `?sslmode=`: supports `"disable"` / `"allow"` / `"prefer"` / `"require"` / `"verify-ca"` / `"verify-full"` (`require` / `verify-ca` / `verify-full` for cloud DBs); `{ rejectUnauthorized: false }` or an existing `ca` file path / PEM text for self-signed certs; `"disable"` only on trusted local networks |
| `Access denied` / `password authentication failed` | Wrong username or password | Update `user`/`password` in **Settings → SQL Databases** (verify with **Test**) or set `DSH_SQL_PASSWORD_<NAME_UPPER>` |
| `Unknown database` / `database "…" does not exist` | Typo in `database` or DB not created | Check the `database` field in your connection config |
| `SQLITE_CANTOPEN` | Missing file path or directory permissions | Check the SQLite path and read/write permissions |
| `no such table` / `relation "…" does not exist` | Table name case or schema mismatch | Call `sql_schema` without `table`/`tables` (optionally with `schema` / `pattern`; PostgreSQL includes materialized views) first to list exact table names |
| `sql_exec` says confirmation is unavailable (`never`) | Session policy disables interactive prompts | Switch to an `ask`-capable mode, enable global or all-connections `readOnly` if writes are unneeded (`sql_health` treats all-readOnly setups as healthy), or explicitly set `writeApproval: false` if intended |
| Write reports "0 rows affected" | `WHERE` matched nothing, or DDL/multi-statement script | Re-check target rows with `sql_query` |

---

## Tool & Safety Reference

### Registered Tools

| Tool | Purpose & Key Parameters | Safety Guardrails |
| :--- | :--- | :--- |
| `sql_list` | Concurrently list connections & run `SELECT 1` probes with `readOnly` / `SSL` tags | Never echoes passwords; flags temporary `:memory:` fallback |
| `sql_schema` | List tables (optional `schema` / `pattern` substring or `*` wildcard filter; PostgreSQL includes regular/partitioned tables, views, materialized views, and foreign tables), or inspect one `table` (`schema.table`) or batch `tables` (up to 20 tables concurrently, lower priority than `table`) with columns (type, nullability, PK, default, PostgreSQL `enumValues`, comment), table comment, indexes, and foreign keys | Strict table/schema reference parsing, 0-column early exit, parallel metadata fetching (MySQL/PG), and per-table error isolation in batch mode |
| `sql_stats` | Table count, per-table row counts & sizes (PostgreSQL multi-schema + `pg_total_relation_size`; MySQL `BASE TABLE`; SQLite exact counts with `sqlite_stat1` fallback above 200 tables), and total DB size | Quoted identifiers, isolated per-table errors, and event-loop yields |
| `sql_query` | Read-only SQL with `sql`, `connection`, optional `limit` (clamped to `maxRows`), parameterized `params` (`?` for SQLite/MySQL, `$1`/`$2` for PostgreSQL), and `format` (`table` / `markdown` / `csv` / `json`; default `table` renders as GFM Markdown tables); returns `durationMs` and matched `redactedColumns` | Dialect-aware lexer guard + single-statement/no-write-CTE/no-row-lock + SQLite `PRAGMA query_only = ON` per query + MySQL/PG `READ ONLY` rollback (PG `NO SCROLL CURSOR` reuse on bounded unparameterized queries) + server-side timeout & cancellation + streaming row cap + `redactColumns` masking |
| `sql_exec` | Writes & DDL with `sql`, `connection`, optional `params` (single statement), and multi-statement scripts across SQLite, MySQL, and PostgreSQL; returns `changes` & `durationMs` | Global & per-connection `readOnly` locks + fast-deny for unknown connection names + approval card displaying target connection, bound `params` (`$1=...` / `[1]=...`), automatic `⚠️ 高危提示` warnings (`DROP` / `TRUNCATE` / unfiltered `DELETE` / `UPDATE`), and engine-aware statement breakdown (MySQL runs statements sequentially with `multipleStatements: false`) + server-side write timeout |
| `sql_health` | Concurrent per-connection ping & security policy self-check (including `redactColumns` and `redactPatternCount`) | Per-connection ping + `readOnly`/`SSL` tags + approval channel verification (recognizes both global `readOnly` and all-connections-`readOnly` setups) |

### Data Precision, Security & Runtime Notes

- **Engine-level read-only defense-in-depth & PostgreSQL cursor reuse**: Beyond the dialect-aware lexer guard, SQLite enforces `PRAGMA query_only = ON` on every `sql_query` (and persistently with defensive mode enabled when `readOnly: true`); MySQL and PostgreSQL run every query inside an independent `READ ONLY` transaction rolled back afterward (PostgreSQL uses the extended query protocol to reject multi-commands, and for bounded unparameterized `SELECT` / `WITH` / `VALUES` / `TABLE` queries uses `DECLARE _dsh_cursor NO SCROLL CURSOR` + `FETCH` so connections return cleanly to the pool on `ROLLBACK`; other queries fall back to streaming).
- **Timeouts and cancellation**: Observes Harness `exec.signal` and `queryTimeoutMs` / `execTimeoutMs`. SQLite executes in a separate process so long queries leave the host responsive. Timeout or active cancellation terminates that process and waits for exit before rejecting. Requests on one connection run serially; cancelling a queued request does not interrupt another active request. PostgreSQL uses `SET LOCAL statement_timeout` for queries and `SET/RESET statement_timeout` for writes; MySQL uses driver timeouts. Aborted MySQL/PostgreSQL operations also attempt server-side cancellation (`KILL QUERY ?` / `pg_cancel_backend`) and discard the dedicated connection.
- **SQLite state after interruption**: File databases reopen on the next request and retain committed data. An interrupted connection loses uncommitted transactions, temporary tables and `ATTACH` state, so requests already queued on that connection also fail; writes are never replayed automatically. An interrupted `:memory:` database cannot be recovered and its connection is explicitly invalidated. Reloading the plugin creates a new empty memory database; use a file database for data you need to retain. If a write is interrupted before its result arrives, its error reports that it may already have committed: verify the data before retrying.
- **Sensitive column redaction (`redactColumns`)**: Defaults to `false` and reloads live from native Settings; `true` enables 12 built-in case-insensitive substring patterns (`password`, `passwd`, `pwd`, `secret`, `token`, `api_key`, `apikey`, `access_key`, `private_key`, `credential`, `auth_key`, `session_key`), or pass a custom `string[]` of case-insensitive substrings and `/regex/` patterns (`i` / `u` flags only). Matched non-null values are replaced with `[REDACTED]` across `table` / `markdown` / `csv` / `json` (preserving `NULL`), reported in `redactedColumns`, and summarized by `sql_health`.
- **Lossless bigints, compact BLOBs & JSON rendering**: Safe integers stay `number` while larger `bigint` values serialize as exact decimal strings; `Uint8Array`/`Buffer` values render as `0x...` up to 64 bytes and `<BLOB N bytes, hex: 0x...>` when larger; objects/arrays (e.g. PostgreSQL `jsonb`) format as JSON rather than `[object Object]`.
- **Markdown tables, duplicate columns & latency reporting**: `sql_query` adds `format: "markdown"` for standard GFM Markdown tables, and default `table` rendering also formats as GFM Markdown tables (within the 20-row and 8000-char render budget); both `sql_query` and `sql_exec` return and render `durationMs`; `format: "json"` switches to `{ columns, rows }` when duplicate column names appear so values are never overwritten; all four formats report exact `rowCount` and truncation warnings when the row cap is hit.

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
