# dsh-sql

[English](README.en.md)

![dsh-sql 鲸鱼娘插件封面](https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/assets/cover-whale-girl.png)

连接 SQLite、MySQL 或 PostgreSQL，查询数据并检查数据库结构。

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

欢迎使用，遇到问题或有改进建议，请提交 [issues](https://github.com/STARDUSTLC666/dsh-sql/issues) 和 [PR](https://github.com/STARDUSTLC666/dsh-sql/pulls)。

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

## 插件更新

需要 DSH 0.2.1-rc.3 或更新版本。每个插件在自己的页面或设置项提供检查、更新记录与确认安装入口，开关独立保存。自动检查默认开启；**自动安装默认关闭**，只有明确授权后，兼容的稳定补丁才会在空闲且没有未保存修改时安装。可单独关闭、推迟或忽略提醒；不会强制重启 DSH、升级 DSH 本体或替换本地源码安装。Suite 安装的组件会明确提示通过 Suite 整包更新。

旧版用户先在官方插件管理中手动更新一次，之后才会获得此入口。发布到 npm 不会直接替换用户已经安装的版本。

## License

[MIT](LICENSE)
