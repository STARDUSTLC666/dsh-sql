> Full usage reference. The landing page focuses on outcomes, installation and workflows; detailed parameters, limits, update rules and historical validation links remain here.

# dsh-sql

[中文](./REFERENCE.zh.md)

![dsh-sql whale girl plugin cover](https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/assets/cover-whale-girl.png)

Connect SQLite, MySQL or PostgreSQL to manage connections in a visual live Settings panel, query data, and batch-inspect schemas and statistics from DSH. Includes engine-level read-only protection, sensitive column redaction (`redactColumns`), result and timeout limits, configurable approval-gated writes, and separate connection and permission checks.

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

[Download statistics](https://github.com/STARDUSTLC666/dsh-suite/blob/npm-downloads/README.md)

Feedback and contributions are welcome: report [issues](https://github.com/STARDUSTLC666/dsh-sql/issues) or submit [pull requests](https://github.com/STARDUSTLC666/dsh-sql/pulls).

## What it does

- Native visual live Settings panel (**Settings → SQL Databases** / **Settings → Built-in Plugins → SQL** / **Plugins → SQL (`dsh-sql`)**) with multi-connection editing, `url` URIs, 6 cloud TLS/`ssl` modes, one-click connectivity tests, and masked passwords.
- Batch schema discovery (up to 20 tables concurrently for columns, defaults, PostgreSQL `enumValues`, comments, indexes, and foreign keys) and database size/row summaries.
- Engine-level read-only queries with row and timeout limits (SQLite `PRAGMA query_only`, isolated MySQL / PostgreSQL `READ ONLY` transactions), live `redactColumns` masking (`[REDACTED]`), and GFM Markdown / CSV / JSON output.
- Global or per-connection `readOnly` locks, approval-gated writes with risk warnings, and connection health checks.

## Install

In DSH Desktop, install `dsh-sql` from the Plugins panel. If the bundled dsh command is available:

```bash
dsh plugin --profile desktop add dsh-sql
```

For the web version, replace `desktop` with `web`. Restart DSH after installation.

## Start using it

1. Open **DSH Settings → SQL Databases** (or **Settings → Built-in Plugins → SQL** / **Plugins → SQL (`dsh-sql`)**) to add SQLite, MySQL, or PostgreSQL connections via fields or `url` / `ssl`, click **Test / Test draft**, and save (applies live); toggle global or per-connection `readOnly` and `redactColumns` as needed.
2. Inspect the schema first, then query a small set of rows in read-only mode.
3. Specify filters and result limits; check columns, redaction status, row counts and truncation.
4. Enable write access only when needed, review the SQL, bound parameters, and connection before confirming, and query again to verify.

## Requirements and configuration

SQLite requires an accessible database file. MySQL and PostgreSQL require a reachable service and credentials (passwords can be stored masked in the visual Settings panel or supplied via `DSH_SQL_PASSWORD_<CONNECTION_UPPER>`).

Detailed configuration (including `url`, `ssl`, per-connection `readOnly`, and `redactColumns`), tool arguments and troubleshooting are in the [usage guide](USAGE.en.md). For standalone development, follow the Node requirement in [package.json](../package.json).

## Documentation

- [Usage and troubleshooting](USAGE.en.md)
- [Changelog](../CHANGELOG.md)
- [Validation scope and history](VALIDATION.md)
- [Report a problem or suggest a feature](https://github.com/STARDUSTLC666/dsh-sql/issues)

## Plugin updates

Requires DSH 0.2.2-rc.3 or newer. Update controls sit at the bottom of the visual Settings panel as well as native plugin details. Checks, release notes and preferences expand in place, with no separate update page or settings menu. Automatic checks are on by default; **automatic installation is off by default**. Only explicit opt-in permits compatible stable updates (compatible minor and patch releases by default, or patch-only) while idle with no unsaved changes. Preferences are independent, with per-plugin disable, deferral and ignore controls. No forced DSH restart or upgrade, and local-source installations stay unchanged. Suite components explain and operate on the whole Suite in the same footer.

Older releases need one manual update in native plugin management to acquire these controls. Publishing to npm does not replace an existing user installation.

## License

[MIT](../LICENSE)
