/**
 * 数据库适配器层：sqlite（node:sqlite 内置）/ mysql（mysql2）/ postgres（pg）三实现。
 * 统一接口：listTables / describeTable / describeTableDetail / query / exec / ping / close。
 *
 * @module dsh-sql/adapters
 */
import { existsSync, readFileSync } from 'node:fs'
import { SqliteAdapter } from './sqlite-adapter.js'
import type mysql from 'mysql2/promise'
import type pg from 'pg'
import { parseTableRef, type SqlConnectionConfig, type SqlSslOption } from './config.js'
import { isCursorEligibleQuery, splitSqlStatements, stripSqlNoise } from './sql-lexer.js'

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
  defaultValue?: string | null
  comment?: string | null
  enumValues?: string[]
}

/** 索引元数据。 */
export interface IndexInfo {
  name: string
  unique: boolean
  columns: string[]
}

/** 外键元数据。 */
export interface ForeignKeyInfo {
  column: string
  refTable: string
  refColumn: string
}

/** 完整表结构详情（列、索引、外键、表注释）。 */
export interface TableSchemaDetail {
  table: string
  schema?: string
  comment?: string | null
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
}

/** 查询附加选项（参数绑定、服务端超时与游标复用）。 */
export interface QueryOptions {
  params?: unknown[]
  timeoutMs?: number
  useCursor?: boolean
}

/** 写执行附加选项（参数绑定与超时）。 */
export interface ExecOptions {
  params?: unknown[]
  timeoutMs?: number
}

/** 统一适配器接口。 */
export interface DatabaseAdapter {
  engine: 'sqlite' | 'mysql' | 'postgres'
  listTables(signal?: AbortSignal, schema?: string): Promise<string[]>
  describeTable(table: string, signal?: AbortSignal): Promise<ColumnInfo[]>
  describeTableDetail?(table: string, signal?: AbortSignal): Promise<TableSchemaDetail>
  query(sql: string, limit?: number, signal?: AbortSignal, options?: QueryOptions): Promise<QueryResult>
  exec(sql: string, signal?: AbortSignal, options?: ExecOptions): Promise<number>
  ping(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
}

/** 适配器额外选项：readOnly 时把只读约束下沉到数据库自身。 */
export interface AdapterOptions {
  readOnly?: boolean
}

const INLINE_BLOB_MAX_BYTES = 64
const BLOB_PREVIEW_BYTES = 16
const MYSQL_TX_CONTROL = /\b(?:begin|start\s+transaction|commit|rollback|savepoint|release\s+savepoint|lock\s+tables|unlock\s+tables|set\s+(?:session\s+|local\s+)?autocommit)\b/i
const MYSQL_SESSION_STATE = /^(?:begin|start\s+transaction|commit|rollback|savepoint|release\s+savepoint|set|use|lock\s+tables|unlock\s+tables|prepare|deallocate\s+prepare|create\s+temporary\s+table|drop\s+temporary\s+table)\b/i
const POSTGRES_SESSION_STATE = /^(?:begin|start\s+transaction|commit|end|rollback|savepoint|release\s+savepoint|set|reset|discard|prepare|deallocate|listen|unlisten|notify|create\s+(?:temp|temporary)\s+(?:table|view|sequence)|drop\s+(?:temp|temporary)\s+(?:table|view|sequence))\b/i

let mysqlModule: typeof mysql | undefined
let mysqlModulePromise: Promise<typeof mysql> | undefined
let pgModule: typeof pg | undefined
let pgModulePromise: Promise<typeof pg> | undefined

async function loadMysql(): Promise<typeof mysql> {
  if (mysqlModule !== undefined) return mysqlModule
  if (mysqlModulePromise === undefined) {
    mysqlModulePromise = import('mysql2/promise')
      .then((mod) => {
        mysqlModule = (mod.default ?? mod) as typeof mysql
        return mysqlModule
      })
      .catch((error) => {
        mysqlModulePromise = undefined
        throw error
      })
  }
  return await mysqlModulePromise
}

async function loadPg(): Promise<typeof pg> {
  if (pgModule !== undefined) return pgModule
  if (pgModulePromise === undefined) {
    pgModulePromise = import('pg')
      .then((mod) => {
        pgModule = (mod.default ?? mod) as typeof pg
        return pgModule
      })
      .catch((error) => {
        pgModulePromise = undefined
        throw error
      })
  }
  return await pgModulePromise
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

/** Pool acquisition can wait indefinitely; return late unused clients. */
function acquireWithSignal<T>(acquire: () => Promise<T>, release: (resource: T) => void, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (signal === undefined) return acquire()
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => { cleanup(); reject(abortReason(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    let pending: Promise<T>
    try { pending = acquire() } catch (error) { cleanup(); reject(error); return }
    pending.then(resource => {
      cleanup()
      if (signal.aborted) {
        // No SQL ran on this client, so it is safe to return to the pool.
        try { release(resource) } catch (error) { reject(error) }
        return
      }
      resolve(resource)
    }, error => { cleanup(); reject(error) })
  })
}

function validTimeoutMs(timeoutMs?: number): number | undefined {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) return undefined
  const rounded = Math.round(timeoutMs)
  return rounded > 0 ? rounded : undefined
}

function toValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value)
    }
    return value.toString()
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) {
    if (value.byteLength <= INLINE_BLOB_MAX_BYTES) {
      return '0x' + Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex')
    }
    const previewLen = Math.min(BLOB_PREVIEW_BYTES, value.byteLength)
    const hexPrefix = Buffer.from(value.buffer, value.byteOffset, previewLen).toString('hex')
    return '<BLOB ' + value.byteLength + ' bytes, hex: 0x' + hexPrefix + '...>'
  }
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}

function rowsToColumns(rows: Array<Record<string, unknown>>): QueryResult {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  const values = rows.map((row) => columns.map((column) => toValue(row[column])))
  return { columns, rows: values }
}

function quoteMysqlIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

function parseOptionalSchema(schema?: string): string | undefined {
  if (schema === undefined) return undefined
  const trimmed = schema.trim()
  if (trimmed === '') return undefined
  const ref = parseTableRef(trimmed, 'schema')
  if (ref.schema !== undefined) {
    throw new Error('schema 非法（不能包含多段路径）：' + schema)
  }
  return ref.table
}

function hasMysqlSessionState(sql: string): boolean {
  return splitSqlStatements(sql, 'mysql').some(statement => {
    const stripped = stripSqlNoise(statement, 'mysql').trim()
    return MYSQL_SESSION_STATE.test(stripped)
      || /:=/.test(stripped)
      || /\b(?:get_lock|release_lock|release_all_locks|last_insert_id)\s*\(/i.test(stripped)
  })
}

function hasMysqlTxControl(sql: string): boolean {
  return MYSQL_TX_CONTROL.test(stripSqlNoise(sql, 'mysql'))
}

function hasPostgresSessionState(sql: string): boolean {
  return splitSqlStatements(sql, 'postgres').some(statement => {
    const stripped = stripSqlNoise(statement, 'postgres').trim()
    return POSTGRES_SESSION_STATE.test(stripped)
      || /\bset_config\s*\(/i.test(stripped)
      || /\bpg_(?:try_)?advisory_(?:lock|lock_shared|unlock|unlock_shared|unlock_all)\s*\(/i.test(stripped)
  })
}

function resolveCaValue(ca: string): string {
  const trimmed = ca.trim()
  if (trimmed.includes('-----BEGIN')) return ca
  if (existsSync(trimmed)) return readFileSync(trimmed, 'utf8')
  throw new Error('SSL CA 证书文件不存在：' + trimmed + '，请检查文件路径或直接提供 PEM 证书内容。')
}

function resolveSslConfig(ssl?: SqlSslOption): { rejectUnauthorized?: boolean; ca?: string } | undefined {
  if (ssl === undefined || ssl === false || ssl === 'disable' || ssl === 'allow') return undefined
  if (ssl === true || ssl === 'prefer' || ssl === 'require') return { rejectUnauthorized: false }
  if (ssl === 'verify-ca' || ssl === 'verify-full') return { rejectUnauthorized: true }
  const out: { rejectUnauthorized?: boolean; ca?: string } = {}
  if (ssl.rejectUnauthorized !== undefined) out.rejectUnauthorized = ssl.rejectUnauthorized
  if (ssl.ca !== undefined) out.ca = resolveCaValue(ssl.ca)
  return out
}

function streamMysqlQuery(
  corePool: { query(querySql: mysql.QueryOptions): any },
  sql: string,
  limit: number,
  discard: () => void,
  params?: unknown[],
  timeout?: number,
): Promise<QueryResult> {
  return new Promise<QueryResult>((resolve, reject) => {
    let settled = false
    let columns: string[] = []
    const rows: unknown[][] = []
    const queryOpts: mysql.QueryOptions = { sql, rowsAsArray: true }
    if (params !== undefined && params.length > 0) queryOpts.values = params as mysql.QueryValues
    if (timeout !== undefined) queryOpts.timeout = timeout
    const stream = corePool.query(queryOpts).stream({ highWaterMark: 64 })
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
async function streamPostgresQuery(
  client: pg.PoolClient,
  sql: string,
  limit: number,
  discard: () => void,
  isDiscarded: () => boolean,
  params?: unknown[],
): Promise<QueryResult> {
  const pgMod = pgModule ?? await loadPg()
  if (isDiscarded()) return { columns: [], rows: [] }
  return await new Promise<QueryResult>((resolve, reject) => {
    let settled = false
    let columns: string[] = []
    const rows: unknown[][] = []
    // The extended protocol rejects multiple commands in a single Parse message.
    const queryConfig: pg.QueryArrayConfig & { queryMode: 'extended' } = {
      text: sql,
      rowMode: 'array',
      queryMode: 'extended',
    }
    if (params !== undefined && params.length > 0) queryConfig.values = params
    const query = new pgMod.Query(queryConfig)
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

/** MySQL 连接池配置（导出以便测试断言，不含连接）。 */
export function mysqlPoolConfig(connection: SqlConnectionConfig): mysql.PoolOptions {
  const ssl = resolveSslConfig(connection.ssl)
  const config: mysql.PoolOptions = {
    host: connection.host ?? 'localhost',
    port: connection.port ?? 3306,
    user: connection.user ?? '',
    password: connection.password ?? '',
    database: connection.database ?? '',
    connectionLimit: 5,
    connectTimeout: 10000,
    enableKeepAlive: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    // 显式关掉多语句：即使词法校验被绕过，服务器也不会把第二句当命令执行。
    multipleStatements: false,
  }
  if (ssl !== undefined) config.ssl = ssl
  return config
}

/**
 * PostgreSQL 连接池配置。启动参数仅作为默认值；用户查询还必须使用
 * 独立只读事务，不能依赖可被 set_config 修改的会话默认设置。
 */
export function postgresPoolConfig(connection: SqlConnectionConfig, readOnly = false): pg.PoolConfig {
  const ssl = resolveSslConfig(connection.ssl)
  const config: pg.PoolConfig = {
    host: connection.host ?? 'localhost',
    port: connection.port ?? 5432,
    user: connection.user ?? '',
    password: connection.password ?? '',
    database: connection.database ?? '',
    max: 5,
    connectionTimeoutMillis: 10000,
  }
  if (readOnly) config.options = '-c default_transaction_read_only=on'
  if (ssl !== undefined) config.ssl = ssl
  return config
}

/** MySQL 适配器（mysql2 连接池，按需动态导入驱动）。 */
class MysqlAdapter implements DatabaseAdapter {
  engine = 'mysql' as const
  private pool: mysql.Pool | undefined
  private poolPromise: Promise<mysql.Pool> | undefined
  constructor(private connection: SqlConnectionConfig, private readOnly = false) {}
  private async getPool(): Promise<mysql.Pool> {
    if (this.pool !== undefined) return this.pool
    if (this.poolPromise === undefined) {
      this.poolPromise = loadMysql().then((mysqlMod) => {
        if (this.pool !== undefined) return this.pool
        const pool = mysqlMod.createPool(mysqlPoolConfig(this.connection))
        this.pool = pool
        return pool
      }).catch((error) => {
        this.poolPromise = undefined
        throw error
      })
    }
    return await this.poolPromise
  }
  private async withSignalConnection<T>(signal: AbortSignal | undefined, work: (connection: mysql.PoolConnection, discard: () => void, isDiscarded: () => boolean) => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    const pool = this.pool ?? await this.getPool()
    const connection = await acquireWithSignal(() => pool.getConnection(), connection => connection.release(), signal)
    let destroyed = false
    let rejectAbort: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const discard = (): void => {
      if (destroyed) return
      destroyed = true
      connection.destroy()
    }
    const onAbort = (): void => {
      const threadId = (connection as { threadId?: unknown }).threadId
        ?? (connection as { connection?: { threadId?: unknown } }).connection?.threadId
      if (
        typeof threadId === 'number'
        && Number.isInteger(threadId)
        && threadId > 0
        && this.pool !== undefined
        && typeof (this.pool as { query?: unknown }).query === 'function'
      ) {
        try {
          void Promise.resolve(this.pool.query('KILL QUERY ?', [threadId])).catch(() => {})
        } catch {}
      }
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
  private async withReadOnlyConnection<T>(signal: AbortSignal | undefined, work: (connection: mysql.PoolConnection, discard: () => void, isDiscarded: () => boolean) => Promise<T>): Promise<T> {
    return await this.withSignalConnection(signal, async (connection, discard, isDiscarded) => {
      let inTransaction = false
      let hasPrimaryError = false
      try {
        // Await setup and fail closed; never silently ignore an unsupported mode.
        try {
          await connection.query('START TRANSACTION READ ONLY')
          inTransaction = true
        } catch (error) {
          discard()
          throw error
        }
        return await work(connection, discard, isDiscarded)
      } catch (error) {
        hasPrimaryError = true
        throw error
      } finally {
        if (inTransaction && !isDiscarded()) {
          try {
            await connection.query('ROLLBACK')
          } catch (rollbackError) {
            discard()
            if (!hasPrimaryError) throw rollbackError
          }
        }
      }
    })
  }
  private async queryRows(sql: string | mysql.QueryOptions, signal?: AbortSignal): Promise<any> {
    if (signal === undefined) {
      const pool = this.pool ?? await this.getPool()
      return typeof sql === 'string' ? await pool.query(sql) : await pool.query(sql)
    }
    return await this.withSignalConnection(signal, async (connection) => typeof sql === 'string' ? await connection.query(sql) : await connection.query(sql))
  }
  async listTables(signal?: AbortSignal, schema?: string) {
    const parsedSchema = parseOptionalSchema(schema)
    const sql = parsedSchema !== undefined ? 'SHOW TABLES FROM ' + quoteMysqlIdentifier(parsedSchema) : 'SHOW TABLES'
    const [rows] = await this.queryRows(sql, signal) as unknown as [Array<Record<string, unknown>>, unknown]
    return rows.map((row) => String(Object.values(row)[0] ?? ''))
  }
  async describeTable(table: string, signal?: AbortSignal) {
    const ref = parseTableRef(table, '表名')
    const qualified = (ref.schema !== undefined ? quoteMysqlIdentifier(ref.schema) + '.' : '') + quoteMysqlIdentifier(ref.table)
    const [rows] = await this.queryRows('SHOW FULL COLUMNS FROM ' + qualified, signal) as unknown as [Array<Record<string, unknown>>, unknown]
    return rows.map((row) => ({
      name: String(row.Field),
      type: String(row.Type ?? ''),
      notNull: String(row.Null ?? '').toUpperCase() === 'NO',
      primaryKey: String(row.Key ?? '').toUpperCase() === 'PRI',
      defaultValue: row.Default === null || row.Default === undefined ? null : String(row.Default),
      comment: typeof row.Comment === 'string' && row.Comment !== '' ? row.Comment : null,
    }))
  }
  async describeTableDetail(table: string, signal?: AbortSignal): Promise<TableSchemaDetail> {
    const ref = parseTableRef(table, '表名')
    const qualified = (ref.schema !== undefined ? quoteMysqlIdentifier(ref.schema) + '.' : '') + quoteMysqlIdentifier(ref.table)
    const columns = await this.describeTable(table, signal)
    if (columns.length === 0) {
      return {
        table: ref.table,
        ...(ref.schema !== undefined ? { schema: ref.schema } : {}),
        comment: null,
        columns: [],
        indexes: [],
        foreignKeys: [],
      }
    }
    const schemaFilterSql = ref.schema !== undefined ? 'TABLE_SCHEMA = ?' : 'TABLE_SCHEMA = DATABASE()'
    const metaParams = ref.schema !== undefined ? [ref.schema, ref.table] : [ref.table]
    const [[indexRows], [fkRows], [tableRows]] = await Promise.all([
      this.queryRows('SHOW INDEX FROM ' + qualified, signal) as Promise<[Array<Record<string, unknown>>, unknown]>,
      this.queryRows(
        {
          sql: `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                  FROM information_schema.KEY_COLUMN_USAGE
                 WHERE ${schemaFilterSql}
                   AND TABLE_NAME = ?
                   AND REFERENCED_TABLE_NAME IS NOT NULL
                 ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
          values: metaParams,
        },
        signal,
      ) as Promise<[Array<Record<string, unknown>>, unknown]>,
      this.queryRows(
        {
          sql: `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE ${schemaFilterSql} AND TABLE_NAME = ? LIMIT 1`,
          values: metaParams,
        },
        signal,
      ) as Promise<[Array<Record<string, unknown>>, unknown]>,
    ])
    const indexMap = new Map<string, { unique: boolean; cols: Array<{ seq: number; col: string }> }>()
    for (const row of indexRows) {
      const keyName = String(row.Key_name ?? '')
      if (keyName === '') continue
      const entry = indexMap.get(keyName) ?? { unique: Number(row.Non_unique) === 0, cols: [] }
      const colName = row.Column_name !== null && row.Column_name !== undefined
        ? String(row.Column_name)
        : (row.Expression !== null && row.Expression !== undefined ? String(row.Expression) : '<expr>')
      entry.cols.push({ seq: Number(row.Seq_in_index ?? 0), col: colName })
      indexMap.set(keyName, entry)
    }
    const indexes: IndexInfo[] = [...indexMap.entries()].map(([name, info]) => ({
      name,
      unique: info.unique,
      columns: info.cols.sort((a, b) => a.seq - b.seq).map((item) => item.col),
    }))
    const foreignKeys: ForeignKeyInfo[] = fkRows.map((row) => ({
      column: String(row.COLUMN_NAME ?? ''),
      refTable: String(row.REFERENCED_TABLE_NAME ?? ''),
      refColumn: String(row.REFERENCED_COLUMN_NAME ?? ''),
    }))
    const rawComment = tableRows?.[0]?.TABLE_COMMENT
    const comment = typeof rawComment === 'string' && rawComment !== '' ? rawComment : null
    return {
      table: ref.table,
      ...(ref.schema !== undefined ? { schema: ref.schema } : {}),
      comment,
      columns,
      indexes,
      foreignKeys,
    }
  }
  async query(sql: string, limit?: number, signal?: AbortSignal, options?: QueryOptions) {
    const params = options?.params
    const timeout = validTimeoutMs(options?.timeoutMs)
    return await this.withReadOnlyConnection(signal, async (connection, discard) => {
      try {
        if (limit === undefined || limit <= 0) {
          const queryOpts: mysql.QueryOptions = { sql, rowsAsArray: true }
          if (params !== undefined && params.length > 0) queryOpts.values = params as mysql.QueryValues
          if (timeout !== undefined) queryOpts.timeout = timeout
          const [rows, fields] = await connection.query(queryOpts) as [any[], any[]]
          if (fields?.length) return { columns: fields.map(field => field.name as string), rows: rows.map(row => Array.isArray(row) ? row.map(toValue) : fields.map(field => toValue(row[field.name]))) }
          return rowsToColumns(rows)
        }
        const coreConnection = (connection as unknown as { connection: { query(querySql: mysql.QueryOptions): any } }).connection
        return await streamMysqlQuery(coreConnection, sql, limit, discard, params, timeout)
      } finally {
        if (hasMysqlSessionState(sql)) discard()
      }
    })
  }
  async exec(sql: string, signal?: AbortSignal, options?: ExecOptions) {
    if (this.readOnly) throw new Error('当前配置 readOnly=true，禁止写入数据库。')
    signal?.throwIfAborted()
    const stmts = splitSqlStatements(sql, 'mysql')
    if (stmts.length === 0) return 0
    const params = options?.params
    const timeout = validTimeoutMs(options?.timeoutMs)
    const containsSessionState = hasMysqlSessionState(sql)
    if (params !== undefined && params.length > 0) {
      if (stmts.length > 1) {
        throw new Error('带参数（params）的 sql_exec 仅支持单条语句。')
      }
      const queryOpts: mysql.QueryOptions = { sql: stmts[0], values: params as mysql.QueryValues }
      if (timeout !== undefined) queryOpts.timeout = timeout
      const [result] = containsSessionState
        ? await this.withSignalConnection(signal, async (connection, discard) => {
          try {
            return await connection.query(queryOpts) as unknown as [{ affectedRows?: number }, unknown]
          } finally {
            discard()
          }
        })
        : await this.queryRows(queryOpts, signal) as unknown as [{ affectedRows?: number }, unknown]
      return Number(result?.affectedRows ?? 0)
    }
    if (stmts.length === 1) {
      const queryArg: string | mysql.QueryOptions = timeout !== undefined ? { sql: stmts[0], timeout } : stmts[0]
      if (!containsSessionState) {
        const [result] = await this.queryRows(queryArg, signal) as unknown as [{ affectedRows?: number }, unknown]
        return Number(result?.affectedRows ?? 0)
      }
      return await this.withSignalConnection(signal, async (connection, discard) => {
        try {
          const [result] = (typeof queryArg === 'string'
            ? await connection.query(queryArg)
            : await connection.query(queryArg)) as unknown as [{ affectedRows?: number }, unknown]
          return Number(result?.affectedRows ?? 0)
        } finally {
          discard()
        }
      })
    }
    const wrapTx = !hasMysqlTxControl(sql)
    return await this.withSignalConnection(signal, async (connection, discard, isDiscarded) => {
      let inTransaction = false
      let hasPrimaryError = false
      let total = 0
      try {
        if (wrapTx) {
          try {
            await connection.query('BEGIN')
            inTransaction = true
          } catch (error) {
            discard()
            throw error
          }
        }
        for (const stmt of stmts) {
          signal?.throwIfAborted()
          const queryArg: string | mysql.QueryOptions = timeout !== undefined ? { sql: stmt, timeout } : stmt
          const [res] = (typeof queryArg === 'string'
            ? await connection.query(queryArg)
            : await connection.query(queryArg)) as unknown as [{ affectedRows?: number }, unknown]
          total += Number(res?.affectedRows ?? 0)
        }
        if (wrapTx) {
          await connection.query('COMMIT')
          inTransaction = false
        }
        return total
      } catch (error) {
        hasPrimaryError = true
        if (containsSessionState) discard()
        throw error
      } finally {
        if (containsSessionState) discard()
        if (inTransaction && !isDiscarded()) {
          try {
            await connection.query('ROLLBACK')
          } catch (rollbackError) {
            discard()
            if (!hasPrimaryError) throw rollbackError
          }
        }
      }
    })
  }
  async ping(signal?: AbortSignal) {
    await this.queryRows('SELECT 1', signal)
  }
  async close() {
    const pending = this.poolPromise
    this.poolPromise = undefined
    const pool = this.pool ?? (pending ? await pending.catch(() => undefined) : undefined)
    this.pool = undefined
    if (pool !== undefined) await pool.end()
  }
}

/** PostgreSQL 适配器（pg 连接池，按需动态导入驱动）。 */
class PostgresAdapter implements DatabaseAdapter {
  engine = 'postgres' as const
  private pool: pg.Pool | undefined
  private poolPromise: Promise<pg.Pool> | undefined
  constructor(private connection: SqlConnectionConfig, private readOnly = false) {}
  private async getPool(): Promise<pg.Pool> {
    if (this.pool !== undefined) return this.pool
    if (this.poolPromise === undefined) {
      this.poolPromise = loadPg().then((pgMod) => {
        if (this.pool !== undefined) return this.pool
        const pool = new pgMod.Pool(postgresPoolConfig(this.connection, this.readOnly))
        // 空闲连接断开（服务端重启、NAT 断开、休眠唤醒）时绝不触发未捕获 error 事件导致宿主崩溃。
        pool.on('error', () => {})
        this.pool = pool
        return pool
      }).catch((error) => {
        this.poolPromise = undefined
        throw error
      })
    }
    return await this.poolPromise
  }
  private async withSignalClient<T>(signal: AbortSignal | undefined, work: (client: pg.PoolClient, discard: () => void, isDiscarded: () => boolean) => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    const pool = this.pool ?? await this.getPool()
    const client = await acquireWithSignal(() => pool.connect(), client => client.release(), signal)
    let destroyed = false
    let rejectAbort: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const discard = (): void => {
      if (destroyed) return
      destroyed = true
      client.release(true)
    }
    const onAbort = (): void => {
      const pid = (client as { processID?: unknown }).processID
      if (
        typeof pid === 'number'
        && Number.isInteger(pid)
        && pid > 0
        && this.pool !== undefined
        && typeof (this.pool as { query?: unknown }).query === 'function'
      ) {
        try {
          void Promise.resolve(this.pool.query('SELECT pg_cancel_backend($1)', [pid])).catch(() => {})
        } catch {}
      }
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
  private async withReadOnlyClient<T>(
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
    work: (client: pg.PoolClient, discard: () => void, isDiscarded: () => boolean) => Promise<T>,
  ): Promise<T> {
    const validTimeout = validTimeoutMs(timeoutMs)
    return await this.withSignalClient(signal, async (client, discard, isDiscarded) => {
      let inTransaction = false
      let hasPrimaryError = false
      try {
        try {
          await client.query('BEGIN READ ONLY')
          inTransaction = true
        } catch (error) {
          discard()
          throw error
        }
        if (validTimeout !== undefined) {
          await client.query('SET LOCAL statement_timeout = ' + validTimeout)
        }
        return await work(client, discard, isDiscarded)
      } catch (error) {
        hasPrimaryError = true
        throw error
      } finally {
        // Rollback also reverts set_config(..., false) and SET LOCAL statement_timeout.
        // A capped/cancelled query destroys its connection instead, causing server-side rollback.
        if (inTransaction && !isDiscarded()) {
          try {
            await client.query('ROLLBACK')
          } catch (rollbackError) {
            discard()
            if (!hasPrimaryError) throw rollbackError
          }
        }
      }
    })
  }
  private async queryWithSignal(query: any, values: unknown[] | undefined, signal?: AbortSignal): Promise<any> {
    const run = async (client: { query(query: any, values?: unknown[]): Promise<any> }): Promise<any> => {
      return values === undefined ? await client.query(query) : await client.query(query, values)
    }
    if (signal === undefined) return await run(this.pool ?? await this.getPool())
    return await this.withSignalClient(signal, run)
  }
  async listTables(signal?: AbortSignal, schema?: string) {
    const targetSchema = parseOptionalSchema(schema)
    const result = targetSchema !== undefined
      ? await this.queryWithSignal(
        `SELECT n.nspname AS table_schema, c.relname AS table_name
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND n.nspname = $1
          ORDER BY n.nspname, c.relname`,
        [targetSchema],
        signal,
      )
      : await this.queryWithSignal(
        `SELECT n.nspname AS table_schema, c.relname AS table_name
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg_toast%'
            AND n.nspname NOT LIKE 'pg_temp%'
          ORDER BY n.nspname, c.relname`,
        undefined,
        signal,
      )
    return result.rows.map((row: Record<string, unknown>) => {
      const tableSchema = row.table_schema !== null && row.table_schema !== undefined
        ? String(row.table_schema)
        : (targetSchema ?? 'public')
      const tableName = String(row.table_name)
      return tableSchema === 'public' ? tableName : tableSchema + '.' + tableName
    })
  }
  async describeTable(table: string, signal?: AbortSignal) {
    const ref = parseTableRef(table, '表名')
    const schema = ref.schema ?? 'public'
    const result = await this.queryWithSignal(
      `SELECT a.attname AS column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              a.attnotnull AS not_null,
              EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_constraint con
                 WHERE con.conrelid = c.oid
                   AND con.contype = 'p'
                   AND a.attnum = ANY(con.conkey)
              ) AS is_primary,
              pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_value,
              pg_catalog.col_description(c.oid, a.attnum) AS column_comment,
              CASE
                WHEN t.typtype = 'e' THEN (
                  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
                    FROM pg_catalog.pg_enum e
                   WHERE e.enumtypid = t.oid
                )
                WHEN et.typtype = 'e' THEN (
                  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
                    FROM pg_catalog.pg_enum e
                   WHERE e.enumtypid = et.oid
                )
                ELSE NULL
              END AS enum_values
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
         JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
         LEFT JOIN pg_catalog.pg_type et ON et.oid = t.typelem AND t.typelem <> 0
         LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
        WHERE n.nspname = $1
          AND c.relname = $2
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [schema, ref.table],
      signal,
    )
    return result.rows.map((row: Record<string, unknown>) => {
      const col: ColumnInfo = {
        name: String(row.column_name),
        type: String(row.data_type ?? ''),
        notNull: row.not_null === true,
        primaryKey: row.is_primary === true,
        defaultValue: row.default_value === null || row.default_value === undefined ? null : String(row.default_value),
        comment: typeof row.column_comment === 'string' && row.column_comment !== '' ? row.column_comment : null,
      }
      if (Array.isArray(row.enum_values) && row.enum_values.length > 0) {
        col.enumValues = row.enum_values.map(String)
      }
      return col
    })
  }
  async describeTableDetail(table: string, signal?: AbortSignal): Promise<TableSchemaDetail> {
    const ref = parseTableRef(table, '表名')
    const schema = ref.schema ?? 'public'
    const columns = await this.describeTable(table, signal)
    if (columns.length === 0) {
      return {
        table: ref.table,
        schema,
        comment: null,
        columns: [],
        indexes: [],
        foreignKeys: [],
      }
    }
    const [commentRes, indexRes, fkRes] = await Promise.all([
      this.queryWithSignal(
        `SELECT pg_catalog.obj_description(c.oid, 'pg_class') AS table_comment
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relname = $2
          LIMIT 1`,
        [schema, ref.table],
        signal,
      ),
      this.queryWithSignal(
        `SELECT i.relname AS index_name,
                ix.indisunique AS is_unique,
                COALESCE(
                  ARRAY(
                    SELECT COALESCE(a.attname, pg_catalog.pg_get_indexdef(ix.indexrelid, k.ord::integer, true))
                      FROM unnest(ix.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
                      LEFT JOIN pg_catalog.pg_attribute a
                        ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0
                     ORDER BY k.ord
                  ),
                  ARRAY[]::text[]
                ) AS index_columns
           FROM pg_catalog.pg_class t
           JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_catalog.pg_index ix ON ix.indrelid = t.oid
           JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
          WHERE n.nspname = $1
            AND t.relname = $2
          ORDER BY i.relname`,
        [schema, ref.table],
        signal,
      ),
      this.queryWithSignal(
        `SELECT a.attname AS column_name,
                CASE WHEN fn.nspname = 'public' THEN fc.relname ELSE fn.nspname || '.' || fc.relname END AS ref_table,
                fa.attname AS ref_column
           FROM pg_catalog.pg_constraint con
           JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid
           JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
           JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS cols(col_attnum, ref_attnum, ord) ON true
           JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.col_attnum
           JOIN pg_catalog.pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = cols.ref_attnum
          WHERE n.nspname = $1
            AND c.relname = $2
            AND con.contype = 'f'
          ORDER BY con.conname, cols.ord`,
        [schema, ref.table],
        signal,
      ),
    ])
    const rawComment = commentRes?.rows?.[0]?.table_comment
    const comment = typeof rawComment === 'string' && rawComment !== '' ? rawComment : null
    const indexes: IndexInfo[] = (indexRes?.rows ?? []).map((row: Record<string, unknown>) => ({
      name: String(row.index_name ?? ''),
      unique: row.is_unique === true,
      columns: Array.isArray(row.index_columns) ? row.index_columns.map(String) : [],
    }))
    const foreignKeys: ForeignKeyInfo[] = (fkRes?.rows ?? []).map((row: Record<string, unknown>) => ({
      column: String(row.column_name ?? ''),
      refTable: String(row.ref_table ?? ''),
      refColumn: String(row.ref_column ?? ''),
    }))
    return {
      table: ref.table,
      schema,
      comment,
      columns,
      indexes,
      foreignKeys,
    }
  }
  async query(sql: string, limit?: number, signal?: AbortSignal, options?: QueryOptions) {
    const params = options?.params
    const isolateConnection = hasPostgresSessionState(sql)
    return await this.withReadOnlyClient(signal, options?.timeoutMs, async (client, discard, isDiscarded) => {
      try {
        if (limit === undefined || limit <= 0) {
          const queryConfig: pg.QueryArrayConfig & { queryMode: 'extended' } = {
            text: sql,
            rowMode: 'array',
            queryMode: 'extended',
          }
          if (params !== undefined && params.length > 0) queryConfig.values = params
          const result = await client.query(queryConfig)
          return { columns: result.fields.map((field: { name: string }) => field.name), rows: result.rows.map((row: unknown[]) => row.map(toValue)) }
        }
        if (
          options?.useCursor === true
          && Number.isFinite(limit)
          && Math.round(limit) > 0
          && (params === undefined || params.length === 0)
          && isCursorEligibleQuery(sql, 'postgres')
        ) {
          const stmts = splitSqlStatements(sql.trim(), 'postgres')
          if (stmts.length === 1 && stmts[0] !== '') {
            // Extended protocol still rejects multiple commands with 42601;
            // outer ROLLBACK closes the cursor and lets the pooled connection be reused cleanly.
            await client.query({
              text: 'DECLARE _dsh_cursor NO SCROLL CURSOR FOR ' + stmts[0],
              queryMode: 'extended',
            } as pg.QueryConfig)
            signal?.throwIfAborted()
            const fetched = await client.query({
              text: 'FETCH ' + Math.round(limit) + ' FROM _dsh_cursor',
              rowMode: 'array',
              queryMode: 'extended',
            } as pg.QueryArrayConfig)
            return {
              columns: fetched.fields.map((field: { name: string }) => field.name),
              rows: fetched.rows.map((row: unknown[]) => row.map(toValue)),
            }
          }
        }
        return await streamPostgresQuery(client, sql, limit, discard, isDiscarded, params)
      } finally {
        if (isolateConnection) discard()
      }
    })
  }
  async exec(sql: string, signal?: AbortSignal, options?: ExecOptions) {
    if (this.readOnly) throw new Error('当前配置 readOnly=true，禁止写入数据库。')
    signal?.throwIfAborted()
    const stmts = splitSqlStatements(sql, 'postgres')
    if (stmts.length === 0) return 0
    const params = options?.params
    if (params !== undefined && params.length > 0 && stmts.length > 1) {
      throw new Error('带参数（params）的 sql_exec 仅支持单条语句。')
    }
    const values = params !== undefined && params.length > 0 ? params : undefined
    const timeout = validTimeoutMs(options?.timeoutMs)
    const isolateConnection = stmts.length > 1 || hasPostgresSessionState(sql)
    const result = timeout === undefined && !isolateConnection
      ? await this.queryWithSignal(sql, values, signal)
      : await this.withSignalClient(signal, async (client, discard, isDiscarded) => {
        let timeoutApplied = false
        let hasPrimaryError = false
        if (timeout !== undefined) {
          try {
            await client.query('SET statement_timeout = ' + timeout)
            timeoutApplied = true
          } catch (error) {
            discard()
            throw error
          }
        }
        try {
          signal?.throwIfAborted()
          return values === undefined ? await client.query(sql) : await client.query(sql, values)
        } catch (error) {
          hasPrimaryError = true
          if (isolateConnection) discard()
          throw error
        } finally {
          if (timeoutApplied && !isDiscarded()) {
            try {
              await client.query('RESET statement_timeout')
            } catch (resetError) {
              discard()
              if (!hasPrimaryError) throw resetError
            }
          }
          if (isolateConnection) discard()
        }
      })
    if (Array.isArray(result)) {
      return result.reduce((acc, item) => acc + Number(item?.rowCount ?? 0), 0)
    }
    return Number(result?.rowCount ?? 0)
  }
  async ping(signal?: AbortSignal) {
    await this.queryWithSignal('SELECT 1', undefined, signal)
  }
  async close() {
    const pending = this.poolPromise
    this.poolPromise = undefined
    const pool = this.pool ?? (pending ? await pending.catch(() => undefined) : undefined)
    this.pool = undefined
    if (pool !== undefined) await pool.end()
  }
}

/** 按连接配置创建适配器；readOnly 会下沉到引擎自身的只读约束。 */
export function createAdapter(connection: SqlConnectionConfig, options: AdapterOptions = {}): DatabaseAdapter {
  const readOnly = options.readOnly === true
  if (connection.engine === 'sqlite') return new SqliteAdapter(connection.file ?? ':memory:', readOnly)
  if (connection.engine === 'mysql') return new MysqlAdapter(connection, readOnly)
  return new PostgresAdapter(connection, readOnly)
}
