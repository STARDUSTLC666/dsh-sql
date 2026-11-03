**简体中文** · [English](README.en.md)

# SQL

**先看表结构，再用查询回答问题。**

[![npm](https://img.shields.io/npm/v/dsh-sql)](https://www.npmjs.com/package/dsh-sql) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-downloads.svg)](https://www.npmjs.com/package/dsh-sql) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-sql-total-downloads.svg)](https://www.npmjs.com/package/dsh-sql)

**[安装使用](#安装) · [使用流程](#开始使用) · [完整说明](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/REFERENCE.zh.md)**

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-mobile-dark.svg">
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-dark.svg">
  <img src="https://raw.githubusercontent.com/STARDUSTLC666/dsh-sql/master/docs/assets/intro/workflow-zh-light.svg" alt="先看表结构，再用查询回答问题。 · 流程示意" width="100%">
</picture>

## 功能

- 连接 SQLite、MySQL 或 PostgreSQL。
- 查看结构与概览，限制返回行数和查询时间。
- 写入前核对目标与 SQL，并在完成后查询验证。

## 安装

在 DSH 桌面版「插件」面板安装 `dsh-sql`。已配置命令行时也可使用：

```bash
dsh plugin --profile desktop add dsh-sql
```

网页版把 `desktop` 改为 `web`；安装后重启对应的 DSH。宿主要求以包声明 `>=0.2.1-rc.3` 为准。

## 开始使用

1. 在插件设置中添加自己的 SQLite、MySQL 或 PostgreSQL 连接，确认目标数据库。
2. 先让助手读取表结构，再用只读查询检查少量记录。
3. 明确查询条件与结果上限，核对返回列、行数和是否被截断。
4. 确需写入时才启用相应权限，先核对 SQL 和连接再确认；完成后重新查询验证。

可以这样说：

> 先读取数据库表结构，用只读查询回答这个问题，并说明结果上限和截断情况。

## 开始前要知道

需要自己的数据库连接与权限；写入权限和宿主审批分别生效。

配置、完整工具与排错见[详细使用说明](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/REFERENCE.zh.md)。

## 插件更新

在工作台或原生插件详情页底部检查更新。默认自动检查，**默认不自动安装**；是否安装、何时重启由你决定。Suite 管理的组件随整包更新。[查看更新规则](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/REFERENCE.zh.md)。

## 文档

- [详细使用、配置与边界](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/REFERENCE.zh.md)
- [更新记录](https://github.com/STARDUSTLC666/dsh-sql/blob/master/CHANGELOG.md)
- [验证范围与历史](https://github.com/STARDUSTLC666/dsh-sql/blob/master/docs/VALIDATION.md)

## 反馈与贡献

如果插件帮到了你，欢迎 Star，让更多人发现它。问题和建议请提交 [Issues](https://github.com/STARDUSTLC666/dsh-sql/issues)，也欢迎代码与文档 [PR](https://github.com/STARDUSTLC666/dsh-sql/pulls)。反馈时附上版本与复现步骤，并移除凭据。

## License

[MIT](https://github.com/STARDUSTLC666/dsh-sql/blob/master/LICENSE)

<a id="依赖与配置"></a>
