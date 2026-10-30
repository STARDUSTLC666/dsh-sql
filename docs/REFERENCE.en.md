> Full usage reference. The landing page focuses on outcomes, installation and workflows; detailed parameters, limits, update rules and historical validation links remain here.

# dsh-sql

[中文](../README.md)

![dsh-sql whale girl plugin cover](https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/assets/cover-whale-girl.png)

Connect SQLite, MySQL or PostgreSQL to query data and inspect schemas and statistics from DSH. Includes read-only protection, result and timeout limits, configurable write confirmation and separate connection and permission checks.

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

[Download statistics](https://github.com/STARDUSTLC666/dsh-suite/blob/npm-downloads/README.md)

Feedback and contributions are welcome: report [issues](https://github.com/STARDUSTLC666/dsh-sql/issues) or submit [pull requests](https://github.com/STARDUSTLC666/dsh-sql/pulls).

## What it does

- Manage connections and inspect schemas or database summaries.
- Limit rows and timeouts for read-only queries; MySQL / PostgreSQL enforce a separate read-only transaction for each query.
- Keep writes under host approval and check connections.

## Install

In DSH Desktop, install `dsh-sql` from the Plugins panel. If the bundled dsh command is available:

```bash
dsh plugin --profile desktop add dsh-sql
```

For the web version, replace `desktop` with `web`. Restart DSH after installation.

## Start using it

1. Add your SQLite, MySQL or PostgreSQL connection in plugin settings and confirm the database.
2. Inspect the schema first, then query a small set of rows in read-only mode.
3. Specify filters and result limits; check columns, row counts and truncation.
4. Enable write access only when needed, review the SQL and connection before confirming, and query again to verify.

## Requirements and configuration

SQLite requires an accessible database file. MySQL and PostgreSQL require a reachable service and credentials.

Detailed configuration, tool arguments and troubleshooting are in the [usage guide](USAGE.en.md). For standalone development, follow the Node requirement in [package.json](../package.json).

## Documentation

- [Usage and troubleshooting](USAGE.en.md)
- [Changelog](../CHANGELOG.md)
- [Validation scope and history](VALIDATION.md)
- [Report a problem or suggest a feature](https://github.com/STARDUSTLC666/dsh-sql/issues)

## Plugin updates

Requires DSH 0.2.1-rc.3 or newer. Update controls sit at the bottom of the existing workbench, or native plugin details for plugins without a workbench. Checks, release notes and preferences expand in place, with no separate update page or settings menu. Automatic checks are on by default; **automatic installation is off by default**. Only explicit opt-in permits compatible stable patches while idle with no unsaved changes. Preferences are independent, with per-plugin disable, deferral and ignore controls. No forced DSH restart or upgrade, and local-source installations stay unchanged. Suite components explain and operate on the whole Suite in the same footer.

Older releases need one manual update in native plugin management to acquire these controls. Publishing to npm does not replace an existing user installation.

## License

[MIT](../LICENSE)
