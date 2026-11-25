import type { DatabaseAdapter, QueryOptions, ExecOptions, TableSchemaDetail } from './adapters.js';
/** SQLite 适配器（node:sqlite，零依赖）。 */
export declare class SqliteEngine implements DatabaseAdapter {
    engine: "sqlite";
    private db;
    private readOnly;
    constructor(file: string, readOnly?: boolean);
    listTables(signal?: AbortSignal, schema?: string): Promise<string[]>;
    describeTable(table: string, signal?: AbortSignal): Promise<{
        name: string;
        type: string;
        notNull: boolean;
        primaryKey: boolean;
        defaultValue: string | null;
    }[]>;
    describeTableDetail(table: string, signal?: AbortSignal): Promise<TableSchemaDetail>;
    query(sql: string, limit?: number, signal?: AbortSignal, options?: QueryOptions): Promise<{
        columns: string[];
        rows: unknown[][];
    }>;
    private totalChanges;
    exec(sql: string, signal?: AbortSignal, options?: ExecOptions): Promise<number>;
    ping(signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
}
