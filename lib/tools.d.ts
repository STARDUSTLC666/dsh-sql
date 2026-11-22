import { type DatabaseAdapter } from './adapters.js';
import { type ResolvedSqlConfig } from './config.js';
export { analyzeWriteRisks, assertReadQuery, isCursorEligibleQuery, summarizeWriteScript, splitSqlStatements, stripSqlNoise, type SqlEngine, type WriteRiskKind, type WriteRiskWarning, } from './sql-lexer.js';
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
    isConcurrencySafe?(args?: unknown): boolean;
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
/** 查询结果转 GitHub 风格 Markdown 表格。 */
export declare function toMarkdownTable(columns: string[], rows: unknown[][], maxCellLen?: number): string;
/** 查询结果转 CSV 文本（RFC 4180 风格转义）。 */
export declare function toCsv(columns: string[], rows: unknown[][]): string;
/** 审批执行上下文的最小面。 */
export interface SqlExecGateContext {
    agent?: unknown;
    name?: unknown;
    callId?: unknown;
    signal?: unknown;
}
/** 构建六个工具定义；adapters 惰性创建并按小写连接名缓存，支持静态配置或活引用 getter。 */
export declare function buildSqlTools(config: ResolvedSqlConfig | (() => ResolvedSqlConfig), policyOf?: (execution: unknown) => 'ask' | 'never' | 'unknown'): {
    tools: SqlToolDefinition[];
    adapters: Map<string, DatabaseAdapter>;
};
