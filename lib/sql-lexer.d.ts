/**
 * SQL 词法去噪、语句切分、只读断言与写脚本摘要。
 *
 * 按 SQLite / MySQL / PostgreSQL 三种引擎的真实词法规则扫描注释、字符串、
 * 引号标识符与分号分隔符，避免注释拼接绕过或引号转义错位隐藏后续语句。
 *
 * @module dsh-sql/sql-lexer
 */
/** 词法校验需要区分的三种引擎。 */
export type SqlEngine = 'sqlite' | 'mysql' | 'postgres';
/** 写操作高危风险类型。 */
export type WriteRiskKind = 'drop' | 'truncate' | 'delete_without_where' | 'update_without_where';
/** 单条写操作语句对应的高危风险提示。 */
export interface WriteRiskWarning {
    statementIndex: number;
    kind: WriteRiskKind;
    message: string;
}
/**
 * 去掉字符串、引号标识符与注释，保留真实 SQL 关键字与分号。
 * 被剥离的片段始终用空白占位，避免相邻 token 粘连。
 */
export declare function stripSqlNoise(sql: string, engine?: SqlEngine): string;
/**
 * 按引擎词法在顶层分号处切分 SQL 脚本，返回去首尾空白的原始语句列表
 * （自动跳过空段与纯注释段）。
 */
export declare function splitSqlStatements(sql: string, engine?: SqlEngine): string[];
/**
 * 校验只读查询：词法去噪后白名单开头 + 写关键字扫描 + 单语句 + PRAGMA 白名单。
 *
 * `engine` 决定反斜杠、注释与引号的方言规则；不传时按最保守的语义校验。
 * 在 MySQL 引擎下，由于无法预知会话是否启用了 `ANSI_QUOTES`，含 `\"` 的双引号片段会同时在
 * 两种模式下校验，任一模式检出多语句或写关键字即拒绝。
 */
export declare function assertReadQuery(sql: string, engine?: SqlEngine): string;
/**
 * 判断一条只读查询是否适合走游标/子查询分页（`SELECT` / `WITH` / `VALUES` / `TABLE`）。
 *
 * 仅对单条只读结果集查询返回 `true`；对 `EXPLAIN` / `SHOW` / `DESCRIBE` / `DESC` / `PRAGMA`、
 * 空串、多语句以及任何包含写关键字、`INTO` 或行锁子句的 SQL 均保守返回 `false`。
 */
export declare function isCursorEligibleQuery(sql: string, engine?: SqlEngine): boolean;
/**
 * 扫描写操作脚本中的高危语句：`DROP`、`TRUNCATE` 以及缺少顶层 `WHERE` 条件的 `DELETE` / `UPDATE`。
 *
 * 先按方言切分语句并剥离注释、字符串与引号标识符，再折叠顶层括号块，避免注释/字面量伪造
 * 或 CTE/子查询内的 `WHERE` 掩盖外层全表删改。
 */
export declare function analyzeWriteRisks(sql: string, engine?: SqlEngine): WriteRiskWarning[];
/**
 * 把一段写操作脚本压成审批卡可读的摘要。
 *
 * 关键点：按方言切分后逐条列出每条语句，并在开头高亮展示高危风险提示与语句类型统计。
 * 即使脚本体被省略，第二条、第 N 条语句的 DROP / DELETE 也不会从审批文本里消失。
 */
export declare function summarizeWriteScript(sql: string, engine?: SqlEngine): string;
