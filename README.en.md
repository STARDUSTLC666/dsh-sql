[简体中文](README.md) · **English**

# SQL

**Inspect the schema first, then answer questions safely with data.**

Database plugin for DeepSeek Harness (`>=0.2.2-rc.3`): supports SQLite, MySQL, and PostgreSQL with native live Settings forms, masked passwords, schema and table-size discovery, bounded streaming read-only queries, and approval-gated writes.

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

**[Install](#install) · [Get Started in 3 Steps](#get-started-in-3-steps) · [Full Guide](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/USAGE.en.md)**

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-en-mobile-dark.svg">
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-en-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-en-dark.svg">
  <img src="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-en-light.svg" alt="Inspect the schema, then answer questions with data. · workflow illustration" width="100%">
</picture>

## Install

Open **Plugins** in the DSH desktop app and install `dsh-sql`, or use the CLI:

```bash
dsh plugin --profile desktop add dsh-sql
```

For the web profile, replace `desktop` with `web`. Restart DSH once after installing. Requires DSH `>=0.2.2-rc.3`.

<a id="start-using-it"></a>
## Get Started in 3 Steps

1. **Add your database in DSH Settings (applies live)**: Open **DSH Settings → Plugins → SQL (`dsh-sql`)** and add SQLite, MySQL, or PostgreSQL connections (also supports `url` connection URIs and cloud DB `ssl` modes `disable` / `require` / `verify-full`; passwords are masked or read from `DSH_SQL_PASSWORD_<NAME>`; lock writes globally or per connection with `readOnly`).
2. **Explore schema & table sizes first**: Ask the assistant to check database health, filter tables by `schema` / `pattern`, and inspect columns, defaults, comments, indexes, and foreign keys before writing queries.
3. **Query safely, approve writes explicitly**: `sql_query` supports `limit`, parameterized `params`, and `table`/`csv`/`json` output, backed by engine-level read-only enforcement (SQLite `PRAGMA query_only`, MySQL/PostgreSQL independent `READ ONLY` transactions) and server-side query timeouts; `sql_exec` supports parameterized writes and multi-statement scripts across all three engines, showing the target connection and every SQL statement in the approval card before executing.

## Copy-Ready Prompts for Everyday Work

- **First-run check & schema overview**
  > Check my database connection health, list all tables with approximate row counts, and summarize how the core tables relate.
- **Read-only business analytics with CSV export**
  > Inspect the `orders` and `users` columns first, then run a read-only query for order counts and revenue over the past 7 days by status, and format the result as CSV.
- **Careful update (verify row -> approve write -> verify result)**
  > Query order `id = 42` first so I can verify the row, then run the update to mark it `paid` with confirmation, and re-query afterward to confirm.

## Quick Troubleshooting Checklist

| Symptom | Likely Cause | Fix |
| :--- | :--- | :--- |
| Only `default (:memory:)` appears with 0 tables | No external database configured yet | Add your connection in **DSH Settings → Plugins → SQL** and save (applies live) |
| `ECONNREFUSED` / `ETIMEDOUT` | DB server stopped, wrong `host`/`port`, or firewall | Verify host, port, and server status in Settings, then re-run health check |
| TLS/SSL handshake or certificate error | Cloud DB requires TLS or self-signed cert failed verification | Set `ssl` on the connection (`require` or `verify-full` for cloud DBs; `{ rejectUnauthorized: false }` or `ca` for self-signed certs; `disable` only on trusted local networks) |
| `Access denied` / `password authentication failed` | Wrong username or password | Update `user`/`password` in Settings or set `DSH_SQL_PASSWORD_<CONNECTION_UPPER>` |
| Write says confirmation is unavailable (`never`) | Session policy blocks interactive approval prompts | Switch to an interactive (`ask`) session mode so write approval cards can appear |

## Plugin updates

Check updates at the bottom of native plugin details. Automatic checks are on by default; **automatic installation is off**. Suite-managed components update with their bundle.

## Documentation

- [Usage guide and configuration reference](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/USAGE.en.md)
- [Full reference](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/REFERENCE.en.md)
- [Release notes](https://github.com/STARDUSTLC666/dsh-sql/blob/master/CHANGELOG.md)
- [Validation scope and history](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/VALIDATION.md)

## Feedback and contributions

If the plugin helps, a Star makes it easier for others to discover. Report issues in [Issues](https://github.com/STARDUSTLC666/dsh-sql/issues) or open [PRs](https://github.com/STARDUSTLC666/dsh-sql/pulls) (please strip credentials).

## License

[MIT](https://github.com/STARDUSTLC666/dsh-sql/blob/master/LICENSE)

<a id="what-it-does"></a>
<a id="requirements-and-configuration"></a>
