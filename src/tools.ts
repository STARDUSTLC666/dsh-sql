/**
 * 六个面向模型的数据库工具：sql_list / sql_query / sql_exec / sql_schema / sql_stats / sql_health。
 *
 * @module dsh-sql/tools
 */
import { createAdapter, type DatabaseAdapter } from './adapters.js'
import { type ResolvedSqlConfig } from './config.js'

/** 模型可见的内容块。 */
export interface ContentBlock {
  type: 'text'
  text: string
}

/** 注册给 ctx.tools.register 的原始工具定义。 */
export interface SqlToolDefinition {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): ContentBlock[]
  }
  execute(args: unknown, exec: unknown): Promise<unknown>
  timeoutMs?: number
}

function compileParameters(spec: Record<string, any>): { type: 'object'; properties: Record<string, unknown>; required?: string[] } {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, prop] of Object.entries(spec)) {
    if (prop?.required === true) required.push(key)
    const node: Record<string, unknown> = {}
    if (typeof prop?.type === 'string') node.type = prop.type
    if (typeof prop?.description === 'string') node.description = prop.description
    properties[key] = node
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function requiredString(args: Record<string, unknown>, key: string, label: string): string {
  const value = optionalString(args, key)
  if (value === undefined) throw new Error(label + '（参数 ' + key + '）为必填，请提供非空字符串。')
  return value
}

function executionSignal(exec: unknown): AbortSignal | undefined {
  if (typeof exec !== 'object' || exec === null) return undefined
  const signal = (exec as { signal?: unknown }).signal
  return signal instanceof AbortSignal ? signal : undefined
}

/** 只读语句关键字白名单。 */
const READ_KEYWORDS = /^(select|pragma|explain|show|describe|desc|with)\b/i

/** 去掉字符串、引号标识符与注释，保留真实 SQL 关键字与分号。 */
function stripSqlNoise(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      i += 2
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i + 1 < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(sql[i - 1]))) {
      if (/^#(?:>>?|-)/.test(sql.slice(i))) {
        out += ch
        i += 1
        continue
      }
      i += 1
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === "'") {
      out += ' '
      i += 1
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i += 1; break }
        if (sql[i] === '\\') { i += 2; continue }
        i += 1
      }
      continue
    }
    if (ch === '"' || ch === '`') {
      out += ' '
      i += 1
      while (i < sql.length) {
        if (sql[i] === ch) { i += 1; break }
        if (sql[i] === '\\') { i += 2; continue }
        i += 1
      }
      continue
    }
    if (ch === '[') {
      out += ' '
      i += 1
      while (i < sql.length && sql[i] !== ']') i += 1
      i += 1
      continue
    }
    if (ch === '$') {
      const dollar = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))
      if (dollar !== null) {
        out += ' '
        i += dollar[0].length
        const end = sql.indexOf(dollar[0], i)
        i = end === -1 ? sql.length : end + dollar[0].length
        continue
      }
    }
    out += ch
    i += 1
  }
  return out
}

/** 写操作关键字：出在 SELECT/EXPLAIN/WITH 语句里即拒绝。 */
const WRITE_KEYWORDS = /\b(insert|update|delete|replace|merge|drop|alter|create|truncate|call|execute|copy|grant|revoke|attach|detach|vacuum|reindex|refresh|set|reset|begin|commit|rollback|savepoint|release|analyze|load_extension)\b/i

/** 校验只读查询：词法去噪后白名单开头 + 写关键字扫描 + 单语句。 */
export function assertReadQuery(sql: string): string {
  const trimmed = sql.trim()
  const clean = stripSqlNoise(trimmed)
  const first = /^[a-z]+/i.exec(clean.trim())?.[0]?.toLowerCase() ?? ''
  if (!READ_KEYWORDS.test(clean.trim())) {
    throw new Error('sql_query 只接受只读语句（SELECT / PRAGMA / EXPLAIN / SHOW / DESCRIBE / WITH）。写操作请用 sql_exec。')
  }
  const statements = clean.split(';').filter((part) => part.trim() !== '')
  if (statements.length > 1) throw new Error('sql_query 一次只允许一条语句。')
  const single = statements[0]?.trim() ?? ''
  if (first === 'pragma') {
    if (/=/.test(single)) throw new Error('sql_query 不接受带赋值参数的 PRAGMA 写操作（如 PRAGMA journal_mode=WAL），请用 sql_exec。')
  } else if (first === 'show' || first === 'describe' || first === 'desc') {
    // SHOW / DESCRIBE 本身只读，不再扫写关键字（避免误伤 SHOW CREATE TABLE）。
  } else {
    if (/\binto\b/i.test(single)) throw new Error('sql_query 不接受 SELECT INTO（写表或 OUTFILE），请用 sql_exec。')
    if (/\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/i.test(single)) throw new Error('sql_query 不接受 FOR UPDATE/FOR SHARE 行锁查询，请用 sql_exec。')
    const hit = WRITE_KEYWORDS.exec(single)
    if (hit !== null) {
      throw new Error('检测到写操作关键字 ' + hit[0].toUpperCase() + '，sql_query 只接受只读查询。写操作请用 sql_exec。')
    }
  }
  return trimmed.replace(/;+\s*$/, '').trim()
}

const querySchema = {
  type: 'object',
  properties: {
    connection: { type: 'string' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: {} } },
    rowCount: { type: 'integer' },
    truncated: { type: 'boolean' },
    maxRows: { type: 'integer' },
    format: { type: 'string' },
    formatted: { type: 'string' },
  },
  additionalProperties: true,
}

const execSchema = {
  type: 'object',
  properties: {
    connection: { type: 'string' },
    changes: { type: 'integer' },
    readOnly: { type: 'boolean' },
  },
  additionalProperties: true,
}

const listSchema = {
  type: 'object',
  properties: {
    connections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, engine: { type: 'string' }, host: { type: 'string' }, database: { type: 'string' }, file: { type: 'string' }, ok: { type: 'boolean' }, error: { type: 'string' } },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
}

const schemaToolSchema = {
  type: 'object',
  properties: {
    connection: { type: 'string' },
    tables: { type: 'array', items: { type: 'string' } },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, type: { type: 'string' }, notNull: { type: 'boolean' }, primaryKey: { type: 'boolean' } },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
}

// ---------- 输出格式与统计辅助 ----------

/** 按引擎给标识符加引号，防止表名破坏 SQL。 */
function quoteIdent(engine: string, name: string): string {
  if (engine === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  return '"' + name.replace(/"/g, '""') + '"'
}

/** 查询结果转 CSV 文本（RFC 4180 风格转义）。 */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const escape = (cell: unknown): string => {
    if (cell === null || cell === undefined) return ''
    const text = Array.isArray(cell) || typeof cell === 'object' ? JSON.stringify(cell) : String(cell)
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
  }
  const lines = [columns.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  return lines.join('\n')
}

/** 人类可读的字节数。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

/** 库体积：SQLite 用页数×页大小；MySQL/PostgreSQL 走系统函数；失败抛错由调用方兜底。 */
async function databaseSize(adapter: DatabaseAdapter, engine: string, signal?: AbortSignal): Promise<number> {
  if (engine === 'sqlite') {
    const pageCount = await adapter.query('PRAGMA page_count', 1, signal)
    const pageSize = await adapter.query('PRAGMA page_size', 1, signal)
    return Number(pageCount.rows[0]?.[0] ?? 0) * Number(pageSize.rows[0]?.[0] ?? 0)
  }
  if (engine === 'mysql') {
    const result = await adapter.query('SELECT SUM(DATA_LENGTH + INDEX_LENGTH) FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()', 1, signal)
    return Number(result.rows[0]?.[0] ?? -1)
  }
  const result = await adapter.query('SELECT pg_database_size(current_database())', 1, signal)
  return Number(result.rows[0]?.[0] ?? -1)
}

const statsSchema = {
  type: 'object',
  properties: {
    connection: { type: 'string' },
    engine: { type: 'string' },
    tableCount: { type: 'integer' },
    tables: { type: 'array', items: { type: 'object', additionalProperties: true } },
    sizeBytes: { type: 'integer' },
  },
  additionalProperties: true,
}

const healthSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    plugin: { type: 'string' },
    connections: { type: 'array', items: { type: 'object', additionalProperties: true } },
    readOnly: { type: 'boolean' },
    writeApproval: { type: 'boolean' },
    maxRows: { type: 'integer' },
    queryTimeoutMs: { type: 'integer' },
    execTimeoutMs: { type: 'integer' },
  },
  additionalProperties: true,
}

/** 审批执行上下文的最小面。 */
export interface SqlExecGateContext {
  agent?: unknown
  name?: unknown
  callId?: unknown
  signal?: unknown
}

/** 构建六个工具定义；adapters 惰性创建并按连接名缓存。 */
export function buildSqlTools(config: ResolvedSqlConfig): { tools: SqlToolDefinition[]; adapters: Map<string, DatabaseAdapter> } {
  const cfg = config
  const adapters = new Map<string, DatabaseAdapter>()

  const getAdapter = (name: string | undefined): { adapter: DatabaseAdapter; name: string } => {
    const target = name ?? cfg.connections[0].name
    const connection = cfg.connections.find((item) => item.name.toLowerCase() === target.toLowerCase())
    if (connection === undefined) {
      throw new Error('未找到名为 ' + target + ' 的数据库连接。可用 sql_list 查看连接清单。')
    }
    let adapter = adapters.get(connection.name)
    if (adapter === undefined) {
      adapter = createAdapter(connection)
      adapters.set(connection.name, adapter)
    }
    return { adapter, name: connection.name }
  }

  const pingAllConnections = async (signal?: AbortSignal): Promise<Array<Record<string, unknown>>> => {
    const rows: Array<Record<string, unknown>> = []
    for (const connection of cfg.connections) {
      const entry: Record<string, unknown> = { name: connection.name, engine: connection.engine }
      if (connection.engine === 'sqlite') entry.file = connection.file ?? ':memory:'
      else {
        entry.host = connection.host ?? ''
        entry.database = connection.database ?? ''
      }
      try {
        const { adapter } = getAdapter(connection.name)
        await adapter.ping(signal)
        entry.ok = true
        entry.error = ''
      } catch (error) {
        signal?.throwIfAborted()
        entry.ok = false
        entry.error = error instanceof Error ? error.message : String(error)
      }
      rows.push(entry)
    }
    return rows
  }

  const sqlList: SqlToolDefinition = {
    name: 'sql_list',
    description: '列出配置的数据库连接并逐一做连通性测试（SELECT 1）。返回连接名、引擎、目标与健康状态。',
    parameters: compileParameters({}),
    output: {
      schema: listSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const connections = Array.isArray(rec.connections) ? rec.connections : []
        const lines = ['共 ' + connections.length + ' 个数据库连接：']
        for (const item of connections) {
          const c = asRecord(item)
          const target = c.file !== undefined && c.file !== '' ? c.file : c.host + '/' + c.database
          lines.push('- ' + c.name + '（' + c.engine + ' @ ' + target + '）' + (c.ok === true ? ' ✅' : ' ❌ ' + String(c.error ?? '')))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_rawArgs: unknown, exec: unknown) {
      return { connections: await pingAllConnections(executionSignal(exec)) }
    },
    timeoutMs: 30000,
  }

  const sqlQuery: SqlToolDefinition = {
    name: 'sql_query',
    description: '执行只读 SQL 查询（SELECT / PRAGMA / EXPLAIN / SHOW / DESCRIBE / WITH）。词法级校验会拒绝 data-modifying CTE、SELECT INTO、FOR UPDATE/FOR SHARE、PRAGMA 赋值与多语句。connection 为连接名（缺省第一个连接）。返回列名与行数据，最多 maxRows 行（超出 truncated=true）。写操作请用 sql_exec。',
    parameters: compileParameters({
      sql: { type: 'string', required: true, description: '只读 SQL 语句（必填，单条）。' },
      connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
      format: { type: 'string', description: '输出格式：table（默认表格）/ csv / json。csv 与 json 会额外返回 formatted 文本，便于落盘或转存。' },
    }),
    output: {
      schema: querySchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        if (typeof rec.formatted === 'string' && rec.formatted !== '') {
          const preview = rec.formatted.length > 4000 ? rec.formatted.slice(0, 4000) + '\n…（预览已截断）' : rec.formatted
          return [{ type: 'text', text: '查询返回 ' + rec.rowCount + ' 行（' + String(rec.format) + ' 格式）：\n' + preview }]
        }
        const rows = Array.isArray(rec.rows) ? rec.rows : []
        const lines = ['查询返回 ' + rec.rowCount + ' 行' + (rec.truncated === true ? '（截断到 ' + rec.maxRows + ' 行）' : '') + '，列：' + (Array.isArray(rec.columns) ? rec.columns.join(', ') : '')]
        for (const row of rows.slice(0, 20)) {
          lines.push('- ' + (Array.isArray(row) ? row.map((cell) => String(cell)).join(' | ') : String(row)))
        }
        if (rows.length > 20) lines.push('…仅展示前 20 行')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      const args = asRecord(rawArgs)
      const sql = assertReadQuery(requiredString(args, 'sql', 'SQL 语句'))
      const { adapter, name } = getAdapter(optionalString(args, 'connection'))
      const result = await adapter.query(sql, cfg.maxRows + 1, executionSignal(exec))
      const total = result.rows.length
      const rows = result.rows.slice(0, cfg.maxRows)
      const format = optionalString(args, 'format')?.toLowerCase() ?? 'table'
      const base = {
        connection: name,
        columns: result.columns,
        rows,
        rowCount: total,
        truncated: total > cfg.maxRows,
        maxRows: cfg.maxRows,
      }
      if (format === 'csv') return { ...base, format, formatted: toCsv(result.columns, rows) }
      if (format === 'json') {
        if (new Set(result.columns).size !== result.columns.length) {
          return { ...base, format, formatted: JSON.stringify({ columns: result.columns, rows }, null, 2) }
        }
        const objects = rows.map((row) => Object.fromEntries(result.columns.map((column, i) => [column, row[i]])))
        return { ...base, format, formatted: JSON.stringify(objects, null, 2) }
      }
      return base
    },
    timeoutMs: cfg.queryTimeoutMs,
  }

  const sqlExec: SqlToolDefinition = {
    name: 'sql_exec',
    description: '执行写操作或 DDL（INSERT / UPDATE / DELETE / CREATE / ALTER / DROP 等，可多语句脚本）。受 readOnly 模式与写审批门双重保护。返回影响行数（多语句时为 0）。',
    parameters: compileParameters({
      sql: { type: 'string', required: true, description: '写操作/DDL SQL（必填）。' },
      connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
    }),
    output: {
      schema: execSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        return [{ type: 'text', text: '执行完成（' + rec.connection + '）：影响 ' + rec.changes + ' 行。' }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      if (cfg.readOnly) throw new Error('当前配置 readOnly=true，sql_exec 已被禁用。需要写操作请把插件配置里的 readOnly 改为 false 后重启。')
      const args = asRecord(rawArgs)
      const sql = requiredString(args, 'sql', 'SQL 语句')
      const { adapter, name } = getAdapter(optionalString(args, 'connection'))
      const changes = await adapter.exec(sql, executionSignal(exec))
      return { connection: name, changes, readOnly: false }
    },
    timeoutMs: cfg.execTimeoutMs,
  }

  const sqlSchema: SqlToolDefinition = {
    name: 'sql_schema',
    description: '查看数据库结构：不给 table 列出全部表；给 table（表名）返回该表的列信息（名称/类型/非空/主键）。',
    parameters: compileParameters({
      table: { type: 'string', description: '表名（可选；缺省列出全部表）。' },
      connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
    }),
    output: {
      schema: schemaToolSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const columns = Array.isArray(rec.columns) ? rec.columns : []
        if (columns.length > 0) {
          const lines = ['表 ' + rec.table + ' 的列：']
          for (const item of columns) {
            const c = asRecord(item)
            lines.push('- ' + c.name + ' ' + c.type + (c.primaryKey === true ? '（主键）' : '') + (c.notNull === true ? '（非空）' : ''))
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const tables = Array.isArray(rec.tables) ? rec.tables : []
        return [{ type: 'text', text: '共 ' + tables.length + ' 张表：' + tables.join(', ') }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      const args = asRecord(rawArgs)
      const { adapter, name } = getAdapter(optionalString(args, 'connection'))
      const table = optionalString(args, 'table')
      const signal = executionSignal(exec)
      if (table !== undefined) {
        const columns = await adapter.describeTable(table, signal)
        return { connection: name, table, columns, tables: [] }
      }
      const tables = await adapter.listTables(signal)
      return { connection: name, tables, columns: [] }
    },
    timeoutMs: 30000,
  }

  const sqlStats: SqlToolDefinition = {
    name: 'sql_stats',
    description: '数据库概览统计：表数量、每张表的行数、库体积（SQLite 按页计算，MySQL/PostgreSQL 走系统表）。connection 为连接名（缺省第一个连接）。适合在写查询前先了解数据规模。',
    parameters: compileParameters({
      connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
    }),
    output: {
      schema: statsSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const tables = Array.isArray(rec.tables) ? rec.tables : []
        const lines = ['连接 ' + rec.connection + '（' + rec.engine + '）：共 ' + tables.length + ' 张表' + (typeof rec.sizeBytes === 'number' && rec.sizeBytes >= 0 ? '，库体积 ' + formatBytes(rec.sizeBytes) : '') + '。']
        for (const item of tables.slice(0, 30)) {
          const t = asRecord(item)
          lines.push('- ' + t.name + '：' + (typeof t.rowCount === 'number' ? t.rowCount + ' 行' : '行数未知' + (t.error ? '（' + t.error + '）' : '')))
        }
        if (tables.length > 30) lines.push('…仅展示前 30 张表')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      const args = asRecord(rawArgs)
      const { adapter, name } = getAdapter(optionalString(args, 'connection'))
      const engine = adapter.engine
      const signal = executionSignal(exec)
      let sizeBytes = -1
      try {
        sizeBytes = await databaseSize(adapter, engine, signal)
      } catch {
        signal?.throwIfAborted()
        sizeBytes = -1
      }
      const tables: Array<Record<string, unknown>> = []
      if (engine === 'mysql' || engine === 'postgres') {
        try {
          const sql = engine === 'mysql'
            ? 'SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()'
            : 'SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname'
          const result = await adapter.query(sql, undefined, signal)
          for (const row of result.rows) {
            tables.push({ name: String(row[0]), rowCount: typeof row[1] === 'number' ? row[1] : Number(row[1] ?? 0) })
          }
        } catch (error) {
          signal?.throwIfAborted()
          tables.push({ name: '', error: error instanceof Error ? error.message : String(error) })
        }
      } else {
        const names = await adapter.listTables(signal)
        for (const table of names) {
          try {
            const result = await adapter.query('SELECT COUNT(*) FROM ' + quoteIdent(engine, table), 1, signal)
            tables.push({ name: table, rowCount: Number(result.rows[0]?.[0] ?? 0) })
          } catch (error) {
            signal?.throwIfAborted()
            tables.push({ name: table, error: error instanceof Error ? error.message : String(error) })
          }
        }
      }
      return { connection: name, engine, tableCount: tables.filter((t) => t.name !== '').length, tables, sizeBytes }
    },
    timeoutMs: cfg.queryTimeoutMs,
  }

  const sqlHealth: SqlToolDefinition = {
    name: 'sql_health',
    description: 'dsh-sql 自检：逐个连接做连通性测试，并汇总安全配置（只读模式、写审批门、行数上限、超时）。遇到问题时先运行本工具定位。',
    parameters: compileParameters({}),
    output: {
      schema: healthSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const connections = Array.isArray(rec.connections) ? rec.connections : []
        const bad = connections.filter((c) => asRecord(c).ok !== true)
        const lines = ['dsh-sql 自检' + (bad.length === 0 ? '：全部连接正常。' : '：' + bad.length + ' 个连接异常。')]
        for (const item of connections) {
          const c = asRecord(item)
          lines.push('- ' + c.name + '（' + c.engine + '）' + (c.ok === true ? ' ✅' : ' ❌ ' + String(c.error ?? '')))
        }
        lines.push('- 只读模式：' + (rec.readOnly === true ? '开（sql_exec 已禁用）' : '关'))
        lines.push('- 写审批门：' + (rec.writeApproval === true ? '开' : '关'))
        lines.push('- 行数上限：' + String(rec.maxRows) + '；查询超时 ' + String(rec.queryTimeoutMs) + 'ms；写超时 ' + String(rec.execTimeoutMs) + 'ms')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_rawArgs: unknown, exec: unknown) {
      const connections = await pingAllConnections(executionSignal(exec))
      const bad = connections.filter((c) => c.ok !== true)
      return {
        ok: bad.length === 0,
        plugin: 'dsh-sql',
        connections,
        readOnly: cfg.readOnly,
        writeApproval: cfg.writeApproval,
        maxRows: cfg.maxRows,
        queryTimeoutMs: cfg.queryTimeoutMs,
        execTimeoutMs: cfg.execTimeoutMs,
      }
    },
    timeoutMs: 30000,
  }

  return { tools: [sqlList, sqlQuery, sqlExec, sqlSchema, sqlStats, sqlHealth], adapters }
}
