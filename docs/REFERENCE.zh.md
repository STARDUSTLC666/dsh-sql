> 完整使用说明。首页已按用途、安装和操作流程重新整理；这里保留详细参数、限制、更新规则与历史验证链接。

# dsh-sql

[English](../README.en.md)

![dsh-sql 鲸鱼娘插件封面](https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/assets/cover-whale-girl.png)

连接 SQLite、MySQL 或 PostgreSQL，在 DSH 中查询数据、查看表结构与统计。提供只读保护、结果与超时限制、可配置的写操作确认，并分别报告连接和权限状态。

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

[下载统计说明](https://github.com/STARDUSTLC666/dsh-suite/blob/npm-downloads/README.md)

欢迎使用，遇到问题或有改进建议，请提交 [issues](https://github.com/STARDUSTLC666/dsh-sql/issues) 和 [PR](https://github.com/STARDUSTLC666/dsh-sql/pulls)。

## 功能

- 管理连接，查询结构和数据概览。
- 只读查询带行数与超时限制；MySQL / PostgreSQL 每次查询由数据库强制开启只读事务。
- 写操作通过宿主审批，支持连接自检。

## 安装

桌面版可在「插件」面板按包名 `dsh-sql` 安装。已配置 dsh 命令时也可使用：

```bash
dsh plugin --profile desktop add dsh-sql
```

网页版把命令中的 `desktop` 改为 `web`。安装后重启 DSH。

## 开始使用

1. 在插件设置中添加自己的 SQLite、MySQL 或 PostgreSQL 连接，确认目标数据库。
2. 先让助手读取表结构，再用只读查询检查少量记录。
3. 明确查询条件与结果上限，核对返回列、行数和是否被截断。
4. 确需写入时才启用相应权限，先核对 SQL 和连接再确认；完成后重新查询验证。

## 依赖与配置

SQLite 需可访问的数据库文件；MySQL / PostgreSQL 需对应服务与登录信息。

详细配置、工具参数与排错见[使用说明](USAGE.md)。从源码独立开发时，Node 要求以 [package.json](../package.json) 为准。

## 文档

- [使用与排错](USAGE.md)
- [更新记录](../CHANGELOG.md)
- [验证范围与历史记录](VALIDATION.md)
- [问题反馈与功能建议](https://github.com/STARDUSTLC666/dsh-sql/issues)

## 插件更新

需要 DSH 0.2.1-rc.3 或更新版本。更新控件直接位于原有工作台内容末尾；没有工作台的插件，位于原生插件详情页底部。检查、更新记录和偏好在原地展开，不增加独立更新页面或设置菜单。自动检查默认开启；**自动安装默认关闭**，明确授权后才会在空闲且没有未保存修改时安装兼容的稳定补丁。开关按插件独立保存，可关闭、推迟或忽略提醒；不会强制重启 DSH、升级 DSH 本体或替换本地源码安装。Suite 组件在当前页面底部明确说明并操作 Suite 整包更新。

旧版用户先在官方插件管理中手动更新一次，之后才会获得此入口。发布到 npm 不会直接替换用户已经安装的版本。

## License

[MIT](../LICENSE)
