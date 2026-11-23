> 完整使用说明。首页已按用途、安装和操作流程重新整理；这里保留详细参数、限制、更新规则与历史验证链接。

# dsh-sql

[English](./REFERENCE.en.md)

![dsh-sql 鲸鱼娘插件封面](https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/assets/cover-whale-girl.png)

连接 SQLite、MySQL 或 PostgreSQL，在 DSH 中通过可视化热生效设置面板管理连接、查询数据、批量查看表结构与统计。提供引擎级只读保护、敏感列脱敏（`redactColumns`）、结果与超时限制、可配置的高危写操作审批门，并分别报告连接和权限状态。

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

[下载统计说明](https://github.com/STARDUSTLC666/dsh-suite/blob/npm-downloads/README.md)

欢迎使用，遇到问题或有改进建议，请提交 [issues](https://github.com/STARDUSTLC666/dsh-sql/issues) 和 [PR](https://github.com/STARDUSTLC666/dsh-sql/pulls)。

## 功能

- 原生可视化热生效设置面板（**设置 → 数据库** / **设置 → 内置插件 → 数据库** / **插件 → 数据库**），支持多连接管理、`url` 连接串、6 档云库 TLS/`ssl`、一键连通性测试与密码脱敏。
- 批量表结构探查（单表或最多 20 张表并发读取字段、默认值、PostgreSQL 枚举值、注释、索引与外键）与库表规模统计。
- 引擎级只读查询带行数与超时限制（SQLite `PRAGMA query_only`、MySQL / PostgreSQL 独立只读事务），支持 `redactColumns` 敏感列脱敏（`[REDACTED]`）与 Markdown / CSV / JSON 输出。
- 全局与单连接 `readOnly` 写入硬锁，以及经宿主确认的高危写操作审批门与连接自检。

## 安装

桌面版可在「插件」面板按包名 `dsh-sql` 安装。已配置 dsh 命令时也可使用：

```bash
dsh plugin --profile desktop add dsh-sql
```

网页版把命令中的 `desktop` 改为 `web`。安装后重启 DSH。

## 开始使用

1. 打开 **DSH 设置 → 数据库**（也可在 **设置 → 内置插件 → 数据库** 或 **插件 → 数据库** 打开可视化设置面板），添加自己的 SQLite、MySQL 或 PostgreSQL 连接（支持分字段或粘贴 `url` 与 `ssl` 配置），一键测试连通性并保存（保存即热生效）；按需启用全局或单连接 `readOnly` 与 `redactColumns` 敏感列脱敏。
2. 先让助手读取表结构，再用只读查询检查少量记录。
3. 明确查询条件与结果上限，核对返回列、脱敏状态、行数和是否被截断。
4. 确需写入时才启用相应权限，先核对 SQL、绑定参数和目标连接再确认；完成后重新查询验证。

## 依赖与配置

SQLite 需可访问的数据库文件；MySQL / PostgreSQL 需对应服务与登录信息（密码支持在可视化设置面板中脱敏存储或使用环境变量 `DSH_SQL_PASSWORD_<连接名大写>`）。

详细配置（含 `url`、`ssl`、单连接 `readOnly`、`redactColumns`）、工具参数与排错见[使用说明](USAGE.md)。从源码独立开发时，Node 要求以 [package.json](../package.json) 为准。

## 文档

- [使用与排错](USAGE.md)
- [更新记录](../CHANGELOG.md)
- [验证范围与历史记录](VALIDATION.md)
- [问题反馈与功能建议](https://github.com/STARDUSTLC666/dsh-sql/issues)

## 插件更新

需要 DSH 0.2.2-rc.3 或更新版本。更新控件直接位于可视化设置面板内容末尾以及原生插件详情页底部。检查、更新记录和偏好在原地展开，不增加独立更新页面或设置菜单。自动检查默认开启；**自动安装默认关闭**，明确授权后才会在空闲且没有未保存修改时安装兼容的稳定版本（默认涵盖兼容的小版本与补丁更新，也可限定为仅补丁）。开关按插件独立保存，可关闭、推迟或忽略提醒；不会强制重启 DSH、升级 DSH 本体或替换本地源码安装。Suite 组件在当前页面底部明确说明并操作 Suite 整包更新。

旧版用户先在官方插件管理中手动更新一次，之后才会获得此入口。发布到 npm 不会直接替换用户已经安装的版本。

## License

[MIT](../LICENSE)
