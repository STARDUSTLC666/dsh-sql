/**
 * 数据库适配器层：sqlite（node:sqlite 内置）/ mysql（mysql2）/ postgres（pg）三实现。
 * 统一接口：listTables / describeTable / query / exec / ping / close。
 *
 * @module dsh-sql/adapters
 */
import { DatabaseSync } from 'node:sqlite'
import mysql from 'mysql2/promise'
import pg from 'pg'
import { assertIdentifier, type SqlConnectionConfig } from './config.js'

/** 查询结果：列名 + 行（值数组，无损 JSON 友好）。 */
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
}

/** 表列信息。 */
export interface ColumnInfo {
  name: string
  type: string
  notNull: boolean
  primaryKey: boolean
}

/** 统一适配器接口。 */
export interface DatabaseAdapter {
  engine: 'sqlite' | 'mysql' | 'postgres'
  listTables(signal?: AbortSignal): Promise<string[]>
  describeTable(table: string, signal?: AbortSignal): Promise<ColumnInfo[]>
  query(sql: string, limit?: number, signal?: AbortSignal): Promise<QueryResult>
  exec(sql: string, signal?: AbortSignal): Promise<number>
  ping(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function toValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value)
    }
    return value.toString()
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return Array.from(value)
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}

function rowsToColumns(rows: Array<Record<string, unknown>>): QueryResult {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  const values = rows.map((row) => columns.map((column) => toValue(row[column])))
  return { columns, rows: values }
}

function quoteSqliteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

function streamMysqlQuery(corePool: { query(querySql: mysql.QueryOptions): any }, sql: string, limit: number, discard: () => void): Promise<QueryResult> {
  return new Promise<QueryResult>((resolve, reject) => {
    let settled = false
    let columns: string[] = []
    const rows: unknown[][] = []
    const stream = corePool.query({ sql, rowsAsArray: true }).stream({ highWaterMark: 64 })
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve({ columns, rows })
    }
    stream.on('fields', (fields: Array<{ name: string }>) => {
      columns = fields.map((field) => field.name)
    })
    // Consume the Readable, otherwise mysql2 pauses forever at highWaterMark.
    stream.on('data', (row: Record<string, unknown>) => {
      if (settled) return
      if (columns.length === 0) columns = Object.keys(row)
      rows.push(Array.isArray(row) ? row.map(toValue) : columns.map((name) => toValue(row[name])))
      if (rows.length >= limit) {
        finish()
        stream.destroy()
        // mysql2 resumes its connection when only the Readable is destroyed.
        discard()
      }
    })
    stream.on('end', finish)
    stream.on('close', finish)
    stream.on('error', (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

/** pg's `rows` option is a page size; row events avoid its full result accumulator. */
function streamPostgresQuery(client: pg.PoolClient, sql: string, limit: number, discard: () => void): Promise<QueryResult> {
  return new Promise<QueryResult>((resolve, reject) => {
    let settled = false
    let columns: string[] = []
    const rows: unknown[][] = []
    // The extended protocol rejects multiple commands in a single Parse message.
    const queryConfig: pg.QueryArrayConfig & { queryMode: 'extended' } = { text: sql, rowMode: 'array', queryMode: 'extended' }
    const query = new pg.Query(queryConfig)
    query.on('row', (row, result) => {
      if (settled) return
      if (columns.length === 0) columns = result?.fields.map((field) => field.name) ?? Object.keys(row)
      rows.push(Array.isArray(row) ? row.map(toValue) : columns.map((name) => toValue(row[name])))
      if (rows.length >= limit) {
        // Closing this dedicated connection stops server work and prevents reuse.
        settled = true
        discard()
        resolve({ columns, rows })
      }
    })
    query.on('end', (result) => {
      if (settled) return
      settled = true
      if (columns.length === 0) columns = result.fields.map((field) => field.name)
      resolve({ columns, rows })
    })
    // Keep this listener after reaching the cap: destroying the client can emit
    // the driver's asynchronous connection-closed error on this active query.
    query.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    client.query(query)
  })
}

/** 适配器额外选项：readOnly 时把只读约束下沉到数据库自身。 */
export interface AdapterOptions {
  readOnly?: boolean
}

/** MySQL 连接池配置（导出以便测试断言，不含连接）。 */
export function mysqlPoolConfig(connection: SqlConnectionConfig): mysql.PoolOptions {
  return {
    host: connection.host ?? 'localhost',
    port: connection.port ?? 3306,
    user: connection.user ?? '',
    password: connection.password ?? '',
    database: connection.database ?? '',
    connectionLimit: 5,
    enableKeepAlive: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    // 显式关掉多语句：即使词法校验被绕过，服务器也不会把第二句当命令执行。
    multipleStatements: false,
  }
}

/**
 * PostgreSQL 连接池配置。启动参数仅作为默认值；用户查询还必须使用
 * 独立只读事务，不能依赖可被 set_config 修改的会话默认设置。
 */
export function postgresPoolConfig(connection: SqlConnectionConfig, readOnly = false): pg.PoolConfig {
  const config: pg.PoolConfig = {
    host: connection.host ?? 'localhost',
    port: connection.port ?? 5432,
    user: connection.user ?? '',
    password: connection.password ?? '',
    database: connection.database ?? '',
    max: 5,
  }
  if (readOnly) config.options = '-c default_transaction_read_only=on'
  return config
}

/** SQLite 适配器（node:sqlite，零依赖）。 */
class SqliteAdapter implements DatabaseAdapter {
  engine = 'sqlite' as const
  private db: DatabaseSync
  constructor(file: string, readOnly = false) {
    const memory = file === ':memory:'
    // 内存库没有落盘风险，也不支持只读打开；文件库在 readOnly 下由 SQLite
    // 自己拒绝任何写入（PRAGMA 写、DDL、DML 都会报 attempt to write a readonly database）。
    const options = readOnly && !memory ? { readOnly: true } : {}
    try {
      this.db = new DatabaseSync(memory ? ':memory:' : file, options)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error('无法打开 SQLite 文件 ' + file + '（readOnly=' + readOnly + '）：' + detail)
    }
    this.db.exec('PRAGMA busy_timeout = 5000')
  }
  async listTables(signal?: AbortSignal) {
    signal?.throwIfAborted()
    const result = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<Record<string, unknown>>
    signal?.throwIfAborted()
    return result.map((row) => String(row.name))
  }
  async describeTable(table: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const name = assertIdentifier(table, '表名')
    const rows = this.db.prepare('PRAGMA table_info(' + quoteSqliteIdentifier(name) + ')').all() as Array<Record<string, unknown>>
    signal?.throwIfAborted()
    return rows.map((row) => ({
      name: String(row.name),
      type: String(row.type ?? ''),
      notNull: Number(row.notnull) === 1,
      primaryKey: Number(row.pk) === 1,
    }))
  }
  async query(sql: string, limit?: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const statement = this.db.prepare(sql)
    statement.setReadBigInts(true)
    statement.setReturnArrays(true)
    const columns = statement.columns().map((column) => column.name)
    if (limit === undefined || limit <= 0) {
      const rows = (statement.all() as unknown as unknown[][]).map(row => row.map(toValue))
      signal?.throwIfAborted()
      return { columns, rows }
    }
    const rows: unknown[][] = []
    for (const raw of statement.iterate()) {
      rows.push((raw as unknown as unknown[]).map(toValue))
      signal?.throwIfAborted()
      if (rows.length >= limit) break
    }
    return { columns, rows }
  }
  async exec(sql: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const single = sql.replace(/;\s*$/, '').trim()
    if (single.includes(';')) {
      this.db.exec(sql)
      signal?.throwIfAborted()
      return 0
    }
    const result = this.db.prepare(single).run()
    signal?.throwIfAborted()
    return Number(result.changes)
  }
  async ping(signal?: AbortSignal) {
    signal?.throwIfAborted()
    this.db.prepare('SELECT 1').get()
    signal?.throwIfAborted()
  }
  async close() {
    this.db.close()
  }
}

/** MySQL 适配器（mysql2 连接池）。 */
class MysqlAdapter implements DatabaseAdapter {
  engine = 'mysql' as const
  private pool: mysql.Pool
  constructor(connection: SqlConnectionConfig, private readOnly = false) {
    this.pool = mysql.createPool(mysqlPoolConfig(connection))
  }
  private async withSignalConnection<T>(signal: AbortSignal | undefined, work: (connection: mysql.PoolConnection, discard: () => void, isDiscarded: () => boolean) => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    const connection = await this.pool.getConnection()
    let destroyed = false
    let rejectAbort: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const discard = (): void => {
      if (destroyed) return
      destroyed = true
      connection.destroy()
    }
    const onAbort = (): void => {
      discard()
      rejectAbort(abortReason(signal!))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      signal?.throwIfAborted()
      return await Promise.race([work(connection, discard, () => destroyed), aborted])
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (!destroyed) connection.release()
    }
  }
  private async withReadOnlyConnection<T>(signal: AbortSignal | undefined, work: (connection: mysql.PoolConnection, discard: () => void) => Promise<T>): Promise<T> {
    return await this.withSignalConnection(signal, async (connection, discard, isDiscarded) => {
      try {
        // Await setup and fail closed; never silently ignore an unsupported mode.
        await connection.query('START TRANSACTION READ ONLY')
        return await work(connection, discard)
      } finally {
        if (!isDiscarded()) {
          try { await connection.query('ROLLBACK') } catch (error) { discard(); throw error }
        }
      }
    })
  }
  private async queryRows(sql: string | mysql.QueryOptions, signal?: AbortSignal): Promise<any> {
    if (signal === undefined) return typeof sql === 'string' ? await this.pool.query(sql) : await this.pool.query(sql)
    return await this.withSignalConnection(signal, async (connection) => typeof sql === 'string' ? await connection.query(sql) : await connection.query(sql))
  }
  async listTables(signal?: AbortSignal) {
    const [rows] = await this.queryRows('SHOW TABLES', signal) as unknown as [Array<Record<string, unknown>>, unknown]
    return rows.map((row) => String(Object.values(row)[0] ?? ''))
  }
  async describeTable(table: string, signal?: AbortSignal) {
    const name = assertIdentifier(table, '表名')
    const [rows] = await this.queryRows('DESCRIBE `' + name + '`', signal) as unknown as [Array<Record<string, unknown>>, unknown]
    return rows.map((row) => ({
      name: String(row.Field),
      type: String(row.Type ?? ''),
      notNull: String(row.Null ?? '').toUpperCase() === 'NO',
      primaryKey: String(row.Key ?? '').toUpperCase() === 'PRI',
    }))
  }
  async query(sql: string, limit?: number, signal?: AbortSignal) {
    return await this.withReadOnlyConnection(signal, async (connection, discard) => {
      if (limit === undefined || limit <= 0) {
        const [rows, fields] = await connection.query({ sql, rowsAsArray: true }) as [any[], any[]]
        if (fields?.length) return { columns: fields.map(field => field.name as string), rows: rows.map(row => Array.isArray(row) ? row.map(toValue) : fields.map(field => toValue(row[field.name]))) }
        return rowsToColumns(rows)
      }
      const coreConnection = (connection as unknown as { connection: { query(querySql: mysql.QueryOptions): any } }).connection
      return await streamMysqlQuery(coreConnection, sql, limit, discard)
    })
  }
  async exec(sql: string, signal?: AbortSignal) {
    if (this.readOnly) throw new Error('当前配置 readOnly=true，禁止写入数据库。')
    const [result] = await this.queryRows(sql, signal) as unknown as [{ affectedRows?: number }, unknown]
    return Number(result?.affectedRows ?? 0)
  }
  async ping(signal?: AbortSignal) {
    await this.queryRows('SELECT 1', signal)
  }
  async close() {
    await this.pool.end()
  }
}

/** PostgreSQL 适配器（pg 连接池）。 */
class PostgresAdapter implements DatabaseAdapter {
  engine = 'postgres' as const
  private pool: pg.Pool
  constructor(connection: SqlConnectionConfig, private readOnly = false) {
    this.pool = new pg.Pool(postgresPoolConfig(connection, readOnly))
  }
  private async withSignalClient<T>(signal: AbortSignal | undefined, work: (client: pg.PoolClient, discard: () => void, isDiscarded: () => boolean) => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    const client = await this.pool.connect()
    let destroyed = false
    let rejectAbort: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const discard = (): void => {
      if (destroyed) return
      destroyed = true
      client.release(true)
    }
    const onAbort = (): void => {
      discard()
      rejectAbort(abortReason(signal!))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      signal?.throwIfAborted()
      return await Promise.race([work(client, discard, () => destroyed), aborted])
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (!destroyed) client.release()
    }
  }
  private async withReadOnlyClient<T>(signal: AbortSignal | undefined, work: (client: pg.PoolClient, discard: () => void) => Promise<T>): Promise<T> {
    return await this.withSignalClient(signal, async (client, discard, isDiscarded) => {
      try {
        await client.query('BEGIN READ ONLY')
        return await work(client, discard)
      } finally {
        // Rollback also reverts set_config(..., false). A capped/cancelled query
        // destroys its connection instead, causing server-side rollback.
        if (!isDiscarded()) {
          try { await client.query('ROLLBACK') } catch (error) { discard(); throw error }
        }
      }
    })
  }
  private async queryWithSignal(query: any, values: unknown[] | undefined, signal?: AbortSignal): Promise<any> {
    const run = async (client: { query(query: any, values?: unknown[]): Promise<any> }): Promise<any> => {
      return values === undefined ? await client.query(query) : await client.query(query, values)
    }
    if (signal === undefined) return await run(this.pool)
    return await this.withSignalClient(signal, run)
  }
  async listTables(signal?: AbortSignal) {
    const result = await this.queryWithSignal("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name", undefined, signal)
    return result.rows.map((row: Record<string, unknown>) => String(row.table_name))
  }
  async describeTable(table: string, signal?: AbortSignal) {
    const name = assertIdentifier(table, '表名')
    const result = await this.queryWithSignal(
      `SELECT c.column_name, c.data_type, c.is_nullable,
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
        ORDER BY c.ordinal_position`,
      [name],
      signal,
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      name: String(row.column_name),
      type: String(row.data_type ?? ''),
      notNull: String(row.is_nullable) === 'NO',
      primaryKey: row.is_primary === true,
    }))
  }
  async query(sql: string, limit?: number, signal?: AbortSignal) {
    return await this.withReadOnlyClient(signal, async (client, discard) => {
      if (limit === undefined || limit <= 0) {
        const queryConfig: pg.QueryArrayConfig & { queryMode: 'extended' } = { text: sql, rowMode: 'array', queryMode: 'extended' }
        const result = await client.query(queryConfig)
        return { columns: result.fields.map((field: { name: string }) => field.name), rows: result.rows.map((row: unknown[]) => row.map(toValue)) }
      }
      return await streamPostgresQuery(client, sql, limit, discard)
    })
  }
  async exec(sql: string, signal?: AbortSignal) {
    if (this.readOnly) throw new Error('当前配置 readOnly=true，禁止写入数据库。')
    const result = await this.queryWithSignal(sql, undefined, signal)
    return Number(result.rowCount ?? 0)
  }
  async ping(signal?: AbortSignal) {
    await this.queryWithSignal('SELECT 1', undefined, signal)
  }
  async close() {
    await this.pool.end()
  }
}

/** 按连接配置创建适配器；readOnly 会下沉到引擎自身的只读约束。 */
export function createAdapter(connection: SqlConnectionConfig, options: AdapterOptions = {}): DatabaseAdapter {
  const readOnly = options.readOnly === true
  if (connection.engine === 'sqlite') return new SqliteAdapter(connection.file ?? ':memory:', readOnly)
  if (connection.engine === 'mysql') return new MysqlAdapter(connection, readOnly)
  return new PostgresAdapter(connection, readOnly)
}
