# dsh-sql

[中文](README.md)

![dsh-sql whale girl plugin cover](https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/assets/cover-whale-girl.png)

Connect SQLite, MySQL or PostgreSQL to query data and inspect schemas.

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

Feedback and contributions are welcome: report [issues](https://github.com/STARDUSTLC666/dsh-sql/issues) or submit [pull requests](https://github.com/STARDUSTLC666/dsh-sql/pulls).

## What it does

- Manage connections and inspect schemas or database summaries.
- Limit rows and timeouts for read-only queries.
- Keep writes under host approval and check connections.

## Install

In DSH Desktop, install `dsh-sql` from the Plugins panel. If the bundled dsh command is available:

```bash
dsh plugin --profile desktop add dsh-sql
```

For the web version, replace `desktop` with `web`. Restart DSH after installation.

## Start using it

Configure a connection, then ask to inspect a table schema and its ten latest rows using read-only queries.

## Requirements and configuration

SQLite requires an accessible database file. MySQL and PostgreSQL require a reachable service and credentials.

Detailed configuration, tool arguments and troubleshooting are in the [usage guide](docs/USAGE.en.md). For standalone development, follow the Node requirement in [package.json](package.json).

## Documentation

- [Usage and troubleshooting](docs/USAGE.en.md)
- [Changelog](CHANGELOG.md)
- [Validation scope and history](docs/VALIDATION.md)
- [Report a problem or suggest a feature](https://github.com/STARDUSTLC666/dsh-sql/issues)

## License

[MIT](LICENSE)
