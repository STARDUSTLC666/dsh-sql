import mysql from 'mysql2/promise';
import pg from 'pg';
import { type SqlConnectionConfig } from './config.js';
/** 查询结果：列名 + 行（值数组，无损 JSON 友好）。 */
export interface QueryResult {
    columns: string[];
    rows: unknown[][];
}
/** 表列信息。 */
export interface ColumnInfo {
    name: string;
    type: string;
    notNull: boolean;
    primaryKey: boolean;
}
/** 统一适配器接口。 */
export interface DatabaseAdapter {
    engine: 'sqlite' | 'mysql' | 'postgres';
    listTables(signal?: AbortSignal): Promise<string[]>;
    describeTable(table: string, signal?: AbortSignal): Promise<ColumnInfo[]>;
    query(sql: string, limit?: number, signal?: AbortSignal): Promise<QueryResult>;
    exec(sql: string, signal?: AbortSignal): Promise<number>;
    ping(signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
}
/** 适配器额外选项：readOnly 时把只读约束下沉到数据库自身。 */
export interface AdapterOptions {
    readOnly?: boolean;
}
/** MySQL 连接池配置（导出以便测试断言，不含连接）。 */
export declare function mysqlPoolConfig(connection: SqlConnectionConfig): mysql.PoolOptions;
/**
 * PostgreSQL 连接池配置。启动参数仅作为默认值；用户查询还必须使用
 * 独立只读事务，不能依赖可被 set_config 修改的会话默认设置。
 */
export declare function postgresPoolConfig(connection: SqlConnectionConfig, readOnly?: boolean): pg.PoolConfig;
/** 按连接配置创建适配器；readOnly 会下沉到引擎自身的只读约束。 */
export declare function createAdapter(connection: SqlConnectionConfig, options?: AdapterOptions): DatabaseAdapter;
