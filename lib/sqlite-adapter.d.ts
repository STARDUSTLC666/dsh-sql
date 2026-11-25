import type { DatabaseAdapter, QueryResult, QueryOptions, ExecOptions, ColumnInfo, TableSchemaDetail } from './adapters.js';
/** One persistent SQLite connection per child; cancellation ends actual native work. */
export declare class SqliteAdapter implements DatabaseAdapter {
    private readOnly;
    engine: "sqlite";
    private readonly file;
    private queue;
    private active?;
    private running?;
    private nextId;
    private closed;
    private memoryInvalid;
    private closing?;
    constructor(file: string, readOnly?: boolean);
    private memoryError;
    private finish;
    private interruptionError;
    private cancel;
    private stop;
    private start;
    private pump;
    private request;
    listTables(signal?: AbortSignal, schema?: string): Promise<string[]>;
    describeTable(table: string, signal?: AbortSignal): Promise<ColumnInfo[]>;
    describeTableDetail(table: string, signal?: AbortSignal): Promise<TableSchemaDetail>;
    query(sql: string, limit?: number, signal?: AbortSignal, options?: QueryOptions): Promise<QueryResult>;
    exec(sql: string, signal?: AbortSignal, options?: ExecOptions): Promise<number>;
    ping(signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
}
