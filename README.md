# dsh-sql

[English](README.en.md)

![dsh-sql 鲸鱼娘插件封面](https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/assets/cover-whale-girl.png)

连接 SQLite、MySQL 或 PostgreSQL，查询数据并检查数据库结构。

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://img.shields.io/npm/dm/dsh-sql)](https://www.npmjs.com/package/dsh-sql)

## 功能

- 管理连接，查询结构和数据概览。
- 只读查询带行数与超时限制。
- 写操作通过宿主审批，支持连接自检。

## 安装

桌面版可在「插件」面板按包名 `dsh-sql` 安装。已配置 dsh 命令时也可使用：

```bash
dsh plugin --profile desktop add dsh-sql
```

网页版把命令中的 `desktop` 改为 `web`。安装后重启 DSH。

## 开始使用

配置数据库连接后，可说：“查看这张表的结构和最近十条记录，先只读查询。”

## 依赖与配置

SQLite 需可访问的数据库文件；MySQL / PostgreSQL 需对应服务与登录信息。

详细配置、工具参数与排错见[使用说明](docs/USAGE.md)。从源码独立开发时，Node 要求以 [package.json](package.json) 为准。

## 文档

- [使用与排错](docs/USAGE.md)
- [更新记录](CHANGELOG.md)
- [验证范围与历史记录](docs/VALIDATION.md)
- [问题反馈与功能建议](https://github.com/STARDUSTLC666/dsh-sql/issues)

## License

[MIT](LICENSE)
