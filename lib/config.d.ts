/**
 * dsh-sql 配置解析：多连接定义、行数上限、只读模式与写审批策略。
 *
 * @module dsh-sql/config
 */
/** 单个数据库连接（行配置）。 */
export interface SqlConnectionConfig {
    name: string;
    engine: 'sqlite' | 'mysql' | 'postgres';
    file?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
}
/** 插件行配置。 */
export interface SqlConfig {
    connections?: SqlConnectionConfig[];
    maxRows?: number;
    readOnly?: boolean;
    writeApproval?: boolean;
    queryTimeoutMs?: number;
    execTimeoutMs?: number;
}
/** 解析后的配置。 */
export interface ResolvedSqlConfig {
    connections: SqlConnectionConfig[];
    maxRows: number;
    readOnly: boolean;
    writeApproval: boolean;
    queryTimeoutMs: number;
    execTimeoutMs: number;
    /** 未显式配置 connections 时为 true（自动回退到内置 :memory: SQLite）。 */
    implicitMemoryDefault?: boolean;
}
/** 连接密码环境变量名：DSH_SQL_PASSWORD_<NAME 大写>。 */
export declare function passwordEnvName(name: string): string;
/**
 * 解析并校验配置；无连接时给一个内存 SQLite 兜底连接。
 */
export declare function resolveConfig(config: SqlConfig | undefined | null, env?: NodeJS.ProcessEnv): ResolvedSqlConfig;
/** 校验表名/标识符，防注入到 schema 语句。 */
export declare function assertIdentifier(name: string, label: string): string;
