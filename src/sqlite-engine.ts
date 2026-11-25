/** Synchronous SQLite implementation; executed only in the dedicated child process. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { parseTableRef } from './config.js'
import { splitSqlStatements, stripSqlNoise } from './sql-lexer.js'
import type { DatabaseAdapter, QueryOptions, ExecOptions, TableSchemaDetail, IndexInfo, ForeignKeyInfo } from './adapters.js'
const INLINE_BLOB_MAX_BYTES = 64
const BLOB_PREVIEW_BYTES = 16
const SQLITE_TX_OR_PRAGMA = /\b(?:begin|commit|end\s+transaction|rollback|savepoint|pragma|vacuum)\b/i

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

function quoteSqliteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
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

function bindSqliteParams(params: unknown[]): SQLInputValue[] {
  return params.map((value) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    return value as SQLInputValue
  })
}

function hasSqliteTxOrPragma(sql: string): boolean {
  return SQLITE_TX_OR_PRAGMA.test(stripSqlNoise(sql, 'sqlite'))
}

/** SQLite 适配器（node:sqlite，零依赖）。 */
export class SqliteEngine implements DatabaseAdapter {
  engine = 'sqlite' as const
  private db: DatabaseSync
  private readOnly: boolean
  constructor(file: string, readOnly = false) {
    this.readOnly = readOnly
    const memory = file === ':memory:'
    // 文件库在 readOnly 下以操作系统级只读打开；内存库与文件库均启用 PRAGMA query_only = ON
    // 与防御模式（enableDefensive），确保 SQLite 引擎自身拒绝所有写入。
    const options = readOnly && !memory ? { readOnly: true } : {}
    try {
      this.db = new DatabaseSync(memory ? ':memory:' : file, options)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error('无法打开 SQLite 文件 ' + file + '（readOnly=' + readOnly + '）：' + detail)
    }
    this.db.exec('PRAGMA busy_timeout = 5000')
    ;(this.db as { enableDefensive?(on: boolean): void }).enableDefensive?.(true)
    if (readOnly) this.db.exec('PRAGMA query_only = ON')
  }
  async listTables(signal?: AbortSignal, schema?: string) {
    signal?.throwIfAborted()
    const parsedSchema = parseOptionalSchema(schema)
    const master = parsedSchema !== undefined ? quoteSqliteIdentifier(parsedSchema) + '.sqlite_master' : 'sqlite_master'
    const result = this.db.prepare("SELECT name FROM " + master + " WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<Record<string, unknown>>
    signal?.throwIfAborted()
    return result.map((row) => String(row.name))
  }
  async describeTable(table: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const ref = parseTableRef(table, '表名')
    const schemaPrefix = ref.schema !== undefined ? quoteSqliteIdentifier(ref.schema) + '.' : ''
    const rows = this.db.prepare('PRAGMA ' + schemaPrefix + 'table_info(' + quoteSqliteIdentifier(ref.table) + ')').all() as Array<Record<string, unknown>>
    signal?.throwIfAborted()
    return rows.map((row) => ({
      name: String(row.name),
      type: String(row.type ?? ''),
      notNull: Number(row.notnull) === 1,
      primaryKey: Number(row.pk) > 0,
      defaultValue: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
    }))
  }
  async describeTableDetail(table: string, signal?: AbortSignal): Promise<TableSchemaDetail> {
    signal?.throwIfAborted()
    const ref = parseTableRef(table, '表名')
    const schemaPrefix = ref.schema !== undefined ? quoteSqliteIdentifier(ref.schema) + '.' : ''
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
    const indexRows = this.db.prepare('PRAGMA ' + schemaPrefix + 'index_list(' + quoteSqliteIdentifier(ref.table) + ')').all() as Array<Record<string, unknown>>
    const indexes: IndexInfo[] = []
    for (const idxRow of indexRows) {
      signal?.throwIfAborted()
      const indexName = String(idxRow.name ?? '')
      const infoRows = this.db.prepare('PRAGMA ' + schemaPrefix + 'index_info(' + quoteSqliteIdentifier(indexName) + ')').all() as Array<Record<string, unknown>>
      const indexCols = infoRows
        .sort((a, b) => Number(a.seqno ?? 0) - Number(b.seqno ?? 0))
        .map((r) => r.name === null || r.name === undefined ? '<expr>' : String(r.name))
      indexes.push({
        name: indexName,
        unique: Number(idxRow.unique) === 1,
        columns: indexCols,
      })
    }
    const fkRows = this.db.prepare('PRAGMA ' + schemaPrefix + 'foreign_key_list(' + quoteSqliteIdentifier(ref.table) + ')').all() as Array<Record<string, unknown>>
    const foreignKeys: ForeignKeyInfo[] = fkRows.map((row) => ({
      column: String(row.from ?? ''),
      refTable: String(row.table ?? ''),
      refColumn: row.to === null || row.to === undefined ? '' : String(row.to),
    }))
    signal?.throwIfAborted()
    return {
      table: ref.table,
      ...(ref.schema !== undefined ? { schema: ref.schema } : {}),
      comment: null,
      columns,
      indexes,
      foreignKeys,
    }
  }
  async query(sql: string, limit?: number, signal?: AbortSignal, options?: QueryOptions) {
    signal?.throwIfAborted()
    if (!this.readOnly) this.db.exec('PRAGMA query_only = ON')
    let hasPrimaryError = false
    try {
      const statement = this.db.prepare(sql)
      statement.setReadBigInts(true)
      statement.setReturnArrays(true)
      const columns = statement.columns().map((column) => column.name)
      const bound = options?.params !== undefined && options.params.length > 0
        ? bindSqliteParams(options.params)
        : undefined
      if (limit === undefined || limit <= 0) {
        const rawRows = bound !== undefined ? statement.all(...bound) : statement.all()
        const rows = (rawRows as unknown as unknown[][]).map((row) => row.map(toValue))
        signal?.throwIfAborted()
        return { columns, rows }
      }
      const rows: unknown[][] = []
      const iterator = bound !== undefined ? statement.iterate(...bound) : statement.iterate()
      for (const raw of iterator) {
        rows.push((raw as unknown as unknown[]).map(toValue))
        signal?.throwIfAborted()
        if (rows.length >= limit) break
      }
      return { columns, rows }
    } catch (error) {
      hasPrimaryError = true
      throw error
    } finally {
      if (!this.readOnly) {
        try {
          this.db.exec('PRAGMA query_only = OFF')
        } catch (cleanupError) {
          if (!hasPrimaryError) throw cleanupError
        }
      }
    }
  }
  private totalChanges(): number {
    return Number((this.db.prepare('SELECT total_changes() AS tc').get() as { tc: number | bigint }).tc)
  }
  async exec(sql: string, signal?: AbortSignal, options?: ExecOptions) {
    if (this.readOnly) throw new Error('当前配置 readOnly=true，禁止写入数据库。')
    signal?.throwIfAborted()
    const stmts = splitSqlStatements(sql, 'sqlite')
    if (stmts.length === 0) return 0
    const params = options?.params
    if (params !== undefined && params.length > 0) {
      if (stmts.length > 1) {
        throw new Error('带参数（params）的 sql_exec 仅支持单条语句。')
      }
      const before = this.totalChanges()
      this.db.prepare(stmts[0]).run(...bindSqliteParams(params))
      signal?.throwIfAborted()
      return this.totalChanges() - before
    }
    if (stmts.length === 1) {
      const before = this.totalChanges()
      this.db.prepare(stmts[0]).run()
      signal?.throwIfAborted()
      return this.totalChanges() - before
    }
    const before = this.totalChanges()
    const wrapTx = !hasSqliteTxOrPragma(sql) && (this.db as { isTransaction?: boolean }).isTransaction !== true
    const alreadyInTransaction = (this.db as { isTransaction?: boolean }).isTransaction === true
    if (wrapTx) this.db.exec('BEGIN')
    try {
      this.db.exec(sql)
      if (wrapTx) this.db.exec('COMMIT')
    } catch (error) {
      if (wrapTx || (!alreadyInTransaction && (this.db as { isTransaction?: boolean }).isTransaction === true)) {
        try { this.db.exec('ROLLBACK') } catch {}
      }
      throw error
    }
    signal?.throwIfAborted()
    return this.totalChanges() - before
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
