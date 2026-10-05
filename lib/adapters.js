/**
 * 数据库适配器层：sqlite（node:sqlite 内置）/ mysql（mysql2）/ postgres（pg）三实现。
 * 统一接口：listTables / describeTable / query / exec / ping / close。
 *
 * @module dsh-sql/adapters
 */
import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { assertIdentifier } from './config.js';
function abortReason(signal) {
    if (signal.reason !== undefined)
        return signal.reason;
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}
function toValue(value) {
    if (typeof value === 'bigint') {
        if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
            return Number(value);
        }
        return value.toString();
    }
    if (value instanceof Date)
        return value.toISOString();
    if (value instanceof Uint8Array)
        return Array.from(value);
    if (value instanceof Map)
        return Object.fromEntries(value);
    return value;
}
function rowsToColumns(rows) {
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const values = rows.map((row) => columns.map((column) => toValue(row[column])));
    return { columns, rows: values };
}
function quoteSqliteIdentifier(name) {
    return '"' + name.replace(/"/g, '""') + '"';
}
function streamMysqlQuery(corePool, sql, limit, discard) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let columns = [];
        const rows = [];
        const stream = corePool.query({ sql, rowsAsArray: true }).stream({ highWaterMark: 64 });
        const finish = () => {
            if (settled)
                return;
            settled = true;
            resolve({ columns, rows });
        };
        stream.on('fields', (fields) => {
            columns = fields.map((field) => field.name);
        });
        // Consume the Readable, otherwise mysql2 pauses forever at highWaterMark.
        stream.on('data', (row) => {
            if (settled)
                return;
            if (columns.length === 0)
                columns = Object.keys(row);
            rows.push(Array.isArray(row) ? row.map(toValue) : columns.map((name) => toValue(row[name])));
            if (rows.length >= limit) {
                finish();
                stream.destroy();
                // mysql2 resumes its connection when only the Readable is destroyed.
                discard();
            }
        });
        stream.on('end', finish);
        stream.on('close', finish);
        stream.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
}
/** pg's `rows` option is a page size; row events avoid its full result accumulator. */
function streamPostgresQuery(client, sql, limit, discard) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let columns = [];
        const rows = [];
        const queryConfig = { text: sql, rowMode: 'array' };
        const query = new pg.Query(queryConfig);
        query.on('row', (row, result) => {
            if (settled)
                return;
            if (columns.length === 0)
                columns = result?.fields.map((field) => field.name) ?? Object.keys(row);
            rows.push(Array.isArray(row) ? row.map(toValue) : columns.map((name) => toValue(row[name])));
            if (rows.length >= limit) {
                // Closing this dedicated connection stops server work and prevents reuse.
                settled = true;
                discard();
                resolve({ columns, rows });
            }
        });
        query.on('end', (result) => {
            if (settled)
                return;
            settled = true;
            if (columns.length === 0)
                columns = result.fields.map((field) => field.name);
            resolve({ columns, rows });
        });
        // Keep this listener after reaching the cap: destroying the client can emit
        // the driver's asynchronous connection-closed error on this active query.
        query.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        });
        client.query(query);
    });
}
/** SQLite 适配器（node:sqlite，零依赖）。 */
class SqliteAdapter {
    engine = 'sqlite';
    db;
    constructor(file) {
        this.db = new DatabaseSync(file === ':memory:' ? ':memory:' : file);
        this.db.exec('PRAGMA busy_timeout = 5000');
    }
    async listTables(signal) {
        signal?.throwIfAborted();
        const result = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        signal?.throwIfAborted();
        return result.map((row) => String(row.name));
    }
    async describeTable(table, signal) {
        signal?.throwIfAborted();
        const name = assertIdentifier(table, '表名');
        const rows = this.db.prepare('PRAGMA table_info(' + quoteSqliteIdentifier(name) + ')').all();
        signal?.throwIfAborted();
        return rows.map((row) => ({
            name: String(row.name),
            type: String(row.type ?? ''),
            notNull: Number(row.notnull) === 1,
            primaryKey: Number(row.pk) === 1,
        }));
    }
    async query(sql, limit, signal) {
        signal?.throwIfAborted();
        const statement = this.db.prepare(sql);
        statement.setReadBigInts(true);
        statement.setReturnArrays(true);
        const columns = statement.columns().map((column) => column.name);
        if (limit === undefined || limit <= 0) {
            const rows = statement.all().map(row => row.map(toValue));
            signal?.throwIfAborted();
            return { columns, rows };
        }
        const rows = [];
        for (const raw of statement.iterate()) {
            rows.push(raw.map(toValue));
            signal?.throwIfAborted();
            if (rows.length >= limit)
                break;
        }
        return { columns, rows };
    }
    async exec(sql, signal) {
        signal?.throwIfAborted();
        const single = sql.replace(/;\s*$/, '').trim();
        if (single.includes(';')) {
            this.db.exec(sql);
            signal?.throwIfAborted();
            return 0;
        }
        const result = this.db.prepare(single).run();
        signal?.throwIfAborted();
        return Number(result.changes);
    }
    async ping(signal) {
        signal?.throwIfAborted();
        this.db.prepare('SELECT 1').get();
        signal?.throwIfAborted();
    }
    async close() {
        this.db.close();
    }
}
/** MySQL 适配器（mysql2 连接池）。 */
class MysqlAdapter {
    engine = 'mysql';
    pool;
    constructor(connection) {
        this.pool = mysql.createPool({
            host: connection.host ?? 'localhost',
            port: connection.port ?? 3306,
            user: connection.user ?? '',
            password: connection.password ?? '',
            database: connection.database ?? '',
            connectionLimit: 5,
            enableKeepAlive: true,
            supportBigNumbers: true,
            bigNumberStrings: true,
        });
    }
    async withSignalConnection(signal, work) {
        signal?.throwIfAborted();
        const connection = await this.pool.getConnection();
        let destroyed = false;
        let rejectAbort = () => { };
        const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
        const discard = () => {
            if (destroyed)
                return;
            destroyed = true;
            connection.destroy();
        };
        const onAbort = () => {
            discard();
            rejectAbort(abortReason(signal));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            signal?.throwIfAborted();
            return await Promise.race([work(connection, discard), aborted]);
        }
        finally {
            signal?.removeEventListener('abort', onAbort);
            if (!destroyed)
                connection.release();
        }
    }
    async queryRows(sql, signal) {
        if (signal === undefined)
            return typeof sql === 'string' ? await this.pool.query(sql) : await this.pool.query(sql);
        return await this.withSignalConnection(signal, async (connection) => typeof sql === 'string' ? await connection.query(sql) : await connection.query(sql));
    }
    async listTables(signal) {
        const [rows] = await this.queryRows('SHOW TABLES', signal);
        return rows.map((row) => String(Object.values(row)[0] ?? ''));
    }
    async describeTable(table, signal) {
        const name = assertIdentifier(table, '表名');
        const [rows] = await this.queryRows('DESCRIBE `' + name + '`', signal);
        return rows.map((row) => ({
            name: String(row.Field),
            type: String(row.Type ?? ''),
            notNull: String(row.Null ?? '').toUpperCase() === 'NO',
            primaryKey: String(row.Key ?? '').toUpperCase() === 'PRI',
        }));
    }
    async query(sql, limit, signal) {
        if (limit === undefined || limit <= 0) {
            const [rows, fields] = await this.queryRows({ sql, rowsAsArray: true }, signal);
            if (fields?.length)
                return { columns: fields.map(field => field.name), rows: rows.map(row => Array.isArray(row) ? row.map(toValue) : fields.map(field => toValue(row[field.name]))) };
            return rowsToColumns(rows);
        }
        return await this.withSignalConnection(signal, async (connection, discard) => {
            const coreConnection = connection.connection;
            return await streamMysqlQuery(coreConnection, sql, limit, discard);
        });
    }
    async exec(sql, signal) {
        const [result] = await this.queryRows(sql, signal);
        return Number(result?.affectedRows ?? 0);
    }
    async ping(signal) {
        await this.queryRows('SELECT 1', signal);
    }
    async close() {
        await this.pool.end();
    }
}
/** PostgreSQL 适配器（pg 连接池）。 */
class PostgresAdapter {
    engine = 'postgres';
    pool;
    constructor(connection) {
        this.pool = new pg.Pool({
            host: connection.host ?? 'localhost',
            port: connection.port ?? 5432,
            user: connection.user ?? '',
            password: connection.password ?? '',
            database: connection.database ?? '',
            max: 5,
        });
    }
    async withSignalClient(signal, work) {
        signal?.throwIfAborted();
        const client = await this.pool.connect();
        let destroyed = false;
        let rejectAbort = () => { };
        const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
        const discard = () => {
            if (destroyed)
                return;
            destroyed = true;
            client.release(true);
        };
        const onAbort = () => {
            discard();
            rejectAbort(abortReason(signal));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            signal?.throwIfAborted();
            return await Promise.race([work(client, discard), aborted]);
        }
        finally {
            signal?.removeEventListener('abort', onAbort);
            if (!destroyed)
                client.release();
        }
    }
    async queryWithSignal(query, values, signal) {
        const run = async (client) => {
            return values === undefined ? await client.query(query) : await client.query(query, values);
        };
        if (signal === undefined)
            return await run(this.pool);
        return await this.withSignalClient(signal, run);
    }
    async listTables(signal) {
        const result = await this.queryWithSignal("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name", undefined, signal);
        return result.rows.map((row) => String(row.table_name));
    }
    async describeTable(table, signal) {
        const name = assertIdentifier(table, '表名');
        const result = await this.queryWithSignal(`SELECT c.column_name, c.data_type, c.is_nullable,
              EXISTS (
                SELECT 1
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = c.table_schema
                  AND tc.table_name = c.table_name
                  AND tc.constraint_type = 'PRIMARY KEY'
                  AND kcu.column_name = c.column_name
              ) AS is_primary
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = $1
        ORDER BY c.ordinal_position`, [name], signal);
        return result.rows.map((row) => ({
            name: String(row.column_name),
            type: String(row.data_type ?? ''),
            notNull: String(row.is_nullable) === 'NO',
            primaryKey: row.is_primary === true,
        }));
    }
    async query(sql, limit, signal) {
        if (limit === undefined || limit <= 0) {
            const result = await this.queryWithSignal({ text: sql, rowMode: 'array' }, undefined, signal);
            if (result.fields?.length)
                return { columns: result.fields.map((field) => field.name), rows: result.rows.map((row) => row.map(toValue)) };
            const rows = result.rows;
            return rowsToColumns(rows);
        }
        return await this.withSignalClient(signal, async (client, discard) => {
            return await streamPostgresQuery(client, sql, limit, discard);
        });
    }
    async exec(sql, signal) {
        const result = await this.queryWithSignal(sql, undefined, signal);
        return Number(result.rowCount ?? 0);
    }
    async ping(signal) {
        await this.queryWithSignal('SELECT 1', undefined, signal);
    }
    async close() {
        await this.pool.end();
    }
}
/** 按连接配置创建适配器。 */
export function createAdapter(connection) {
    if (connection.engine === 'sqlite')
        return new SqliteAdapter(connection.file ?? ':memory:');
    if (connection.engine === 'mysql')
        return new MysqlAdapter(connection);
    return new PostgresAdapter(connection);
}
