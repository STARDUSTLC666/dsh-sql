/**
 * 六个面向模型的数据库工具：sql_list / sql_query / sql_exec / sql_schema / sql_stats / sql_health。
 *
 * @module dsh-sql/tools
 */
import { type DatabaseAdapter } from './adapters.js';
import { type ResolvedSqlConfig } from './config.js';
/** 模型可见的内容块。 */
export interface ContentBlock {
    type: 'text';
    text: string;
}
/** 注册给 ctx.tools.register 的原始工具定义。 */
export interface SqlToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    output: {
        schema: Record<string, unknown>;
        render(args: unknown, value: unknown): ContentBlock[];
    };
    execute(args: unknown, exec: unknown): Promise<unknown>;
    timeoutMs?: number;
}
/**
 * 把驱动/连接的原始错误映射成一行可执行的「下一步」。
 *
 * 之前 sql_list / sql_health / sql_query 直接把驱动原文（ECONNREFUSED、
 * ER_ACCESS_DENIED_ERROR、SQLITE_CANTOPEN…）交给用户，知道怎么修的人能看懂，
 * 不知道的人只能反复重试。这里只补一行提示，原始错误文本一律保留。
 */
export declare function connectionErrorHint(message: string): string | undefined;
/** 给错误补一行「下一步」；无法识别时原样返回，避免把断言类错误改写成连接问题。 */
export declare function annotateError(error: unknown): Error;
/** 词法校验需要区分的三种引擎。 */
type SqlEngine = 'sqlite' | 'mysql' | 'postgres';
/**
 * 校验只读查询：词法去噪后白名单开头 + 写关键字扫描 + 单语句 + PRAGMA 白名单。
 *
 * `engine` 决定反斜杠转义规则（见 stripSqlNoise）；不传时按最保守的方式把
 * 反斜杠当字面量，宁可误拒也不放过第二条语句。
 */
export declare function assertReadQuery(sql: string, engine?: SqlEngine): string;
/**
 * 把一段写操作脚本压成审批卡可读的摘要。
 *
 * 关键点：逐条列出每条语句，并额外给一行语句类型统计。即使脚本体被省略，
 * 第二条、第 N 条语句的 DROP / DELETE 也不会从审批文本里消失。
 */
export declare function summarizeWriteScript(sql: string): string;
/** 查询结果转 CSV 文本（RFC 4180 风格转义）。 */
export declare function toCsv(columns: string[], rows: unknown[][]): string;
/** 审批执行上下文的最小面。 */
export interface SqlExecGateContext {
    agent?: unknown;
    name?: unknown;
    callId?: unknown;
    signal?: unknown;
}
/** 构建六个工具定义；adapters 惰性创建并按连接名缓存。 */
export declare function buildSqlTools(config: ResolvedSqlConfig, policyOf?: (execution: unknown) => 'ask' | 'never' | 'unknown'): {
    tools: SqlToolDefinition[];
    adapters: Map<string, DatabaseAdapter>;
};
export {};
