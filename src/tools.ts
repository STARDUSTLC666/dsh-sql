/**
 * 六个面向模型的数据库工具：sql_list / sql_query / sql_exec / sql_schema / sql_stats / sql_health。
 *
 * @module dsh-sql/tools
 */
import { createAdapter, type DatabaseAdapter, type ExecOptions, type QueryOptions } from './adapters.js'
import { parseTableRef, type ResolvedSqlConfig, type SqlConnectionConfig } from './config.js'
import { assertReadQuery, summarizeWriteScript, splitSqlStatements, stripSqlNoise, type SqlEngine } from './sql-lexer.js'

export { assertReadQuery, summarizeWriteScript, splitSqlStatements, stripSqlNoise, type SqlEngine } from './sql-lexer.js'

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
  isConcurrencySafe?(args?: unknown): boolean
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
    if (Array.isArray(prop?.enum)) node.enum = prop.enum
    if (prop?.items !== undefined && typeof prop.items === 'object' && prop.items !== null) node.items = prop.items
    if (typeof prop?.minimum === 'number') node.minimum = prop.minimum
    if (typeof prop?.maximum === 'number') node.maximum = prop.maximum
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

function optionalPositiveInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('参数 ' + key + ' 必须是大于等于 1 的整数。')
  }
  return value
}

function optionalParams(args: Record<string, unknown>): unknown[] | undefined {
  const value = args.params
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new Error('参数 params 必须是数组（SQLite/MySQL 按 ? 顺序绑定，PostgreSQL 按 $1/$2 顺序绑定）。')
  }
  return value
}

function parseQueryFormat(args: Record<string, unknown>): 'table' | 'csv' | 'json' {
  const raw = args.format
  if (raw === undefined || raw === null) return 'table'
  if (typeof raw !== 'string') {
    throw new Error('不支持的 format：' + String(raw) + '，可选 table / csv / json。')
  }
  const trimmed = raw.trim()
  if (trimmed === '') return 'table'
  const lower = trimmed.toLowerCase()
  if (lower === 'table' || lower === 'csv' || lower === 'json') return lower
  throw new Error('不支持的 format：' + trimmed + '，可选 table / csv / json。')
}

function executionSignal(exec: unknown): AbortSignal | undefined {
  if (typeof exec !== 'object' || exec === null) return undefined
  const signal = (exec as { signal?: unknown }).signal
  return signal instanceof AbortSignal ? signal : undefined
}

/** 创建可及时清理的超时作用域（兼容 Node 22/24 事件循环保活并避免残留定时器）。 */
function createTimeoutScope(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const onOuterAbort = (): void => {
    controller.abort(signal!.reason)
  }
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  const timer = setTimeout(() => {
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    controller.abort(err)
  }, Math.max(1, timeoutMs))
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    },
  }
}

/**
 * 把驱动/连接的原始错误映射成一行可执行的「下一步」。
 *
 * 之前 sql_list / sql_health / sql_query 直接把驱动原文（ECONNREFUSED、
 * ER_ACCESS_DENIED_ERROR、SQLITE_CANTOPEN…）交给用户，知道怎么修的人能看懂，
 * 不知道的人只能反复重试。这里只补一行提示，原始错误文本一律保留。
 */
export function connectionErrorHint(message: string): string | undefined {
  if (/ECONNREFUSED/i.test(message)) return '目标地址拒绝连接：请确认数据库服务已启动、host 与 port 正确，并检查防火墙是否放行。'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return '主机名解析失败：请检查连接配置里的 host 拼写，以及本机 DNS/网络是否可用。'
  if (/ETIMEDOUT|timed out|timeout exceeded|connection timeout|due to timeout|statement timeout|TimeoutError/i.test(message)) return '连接或查询超时：请确认网络可达与服务器负载，必要时调大 queryTimeoutMs / execTimeoutMs 后重试。'
  if (/(?:^|[^a-z])(?:ssl|tls)|self-signed|certificate|no encryption|insecure transport/i.test(message)) return 'TLS/SSL 握手或加密校验失败：请在连接配置中检查 ssl 选项（云数据库通常用 ssl: "require" 或 "verify-full"，自签名证书可配置 { rejectUnauthorized: false } 或提供 ca 证书；仅本地可信网络可设为 "disable"）。'
  if (/password authentication failed|Access denied for user|authentication failed/i.test(message)) return '认证失败：请在 DSH「设置 → 插件 → 数据库（dsh-sql）」核对 user 与 password（保存即生效），或改用环境变量 DSH_SQL_PASSWORD_<连接名大写> 提供密码，避免明文写进配置。'
  if (/Unknown database|ER_BAD_DB_ERROR|database .* does not exist|\b3D000\b/i.test(message)) return '数据库不存在：请核对连接配置里的 database，或先在服务器上创建该库。'
  if (/no such table|SQLITE_ERROR: no such table|relation .* does not exist|\b42P01\b/i.test(message)) return '表不存在：先用 sql_schema（不带 table）查看该连接的表清单，注意大小写与实际 schema。'
  if (/SQLITE_CANTOPEN|unable to open database file|EACCES|EPERM|readonly database/i.test(message)) return 'SQLite 文件无法打开或没有权限：请检查文件路径是否存在、所在目录可写、进程账号有读写权限。'
  if (/ECONNRESET|EPIPE|Connection terminated|server closed the connection/i.test(message)) return '连接被对端关闭：可能是服务器重启或中间代理断开，请重试一次；持续出现时检查连接池与代理设置。'
  if (/no pg_hba\.conf entry|unsupported startup parameter|\b28000\b/i.test(message)) return '服务器拒绝本次连接：请核对 pg_hba.conf 与账号来源限制，确认该主机与该用户被允许登录。'
  return undefined
}

/** 给错误补一行「下一步」；无法识别时原样返回，避免把断言类错误改写成连接问题。 */
export function annotateError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const hint = connectionErrorHint(message)
  if (hint === undefined || message.includes('下一步：')) return error instanceof Error ? error : new Error(message)
  return new Error(message + '\n下一步：' + hint)
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
        properties: {
          name: { type: 'string' },
          engine: { type: 'string' },
          host: { type: 'string' },
          port: { type: 'integer' },
          database: { type: 'string' },
          file: { type: 'string' },
          readOnly: { type: 'boolean' },
          ssl: { type: 'boolean' },
          ok: { type: 'boolean' },
          error: { type: 'string' },
        },
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
    table: { type: 'string' },
    schema: { type: 'string' },
    comment: { type: 'string' },
    tables: { type: 'array', items: { type: 'string' } },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          notNull: { type: 'boolean' },
          primaryKey: { type: 'boolean' },
          defaultValue: { type: ['string', 'null'] },
          comment: { type: ['string', 'null'] },
        },
        additionalProperties: true,
      },
    },
    indexes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          unique: { type: 'boolean' },
          columns: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: true,
      },
    },
    foreignKeys: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          column: { type: 'string' },
          refTable: { type: 'string' },
          refColumn: { type: 'string' },
        },
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

/** 格式化单个表格单元格：处理 null、对象/数组 JSON 序列化、单行化与超长截断。 */
function formatCell(cell: unknown, maxCellLen = 300): string {
  if (cell === null || cell === undefined) return 'NULL'
  let text: string
  if (Array.isArray(cell) || typeof cell === 'object') {
    try {
      text = JSON.stringify(cell)
    } catch {
      text = String(cell)
    }
  } else {
    text = String(cell)
  }
  text = text.replace(/\r?\n/g, '\\n')
  if (text.length > maxCellLen) {
    return text.slice(0, maxCellLen) + '…(已截断)'
  }
  return text
}

/** 表名过滤：无 `*` 时按不区分大小写子串过滤，含 `*` 时按通配符匹配。 */
function filterTablesByPattern(tables: string[], pattern: string | undefined): string[] {
  if (pattern === undefined) return tables
  if (!pattern.includes('*')) {
    const needle = pattern.toLowerCase()
    return tables.filter((table) => table.toLowerCase().includes(needle))
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  const regex = new RegExp('^' + escaped + '$', 'i')
  const hasDot = pattern.includes('.')
  return tables.filter((table) => {
    if (regex.test(table)) return true
    if (!hasDot) {
      const dot = table.indexOf('.')
      if (dot !== -1 && regex.test(table.slice(dot + 1))) return true
    }
    return false
  })
}

function quoteDoubleIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/** 校验单段 schema 名称（拒绝多段路径与非法字符），返回去引号后的名称。 */
function parseSingleSchema(schemaName: string): string {
  const ref = parseTableRef(schemaName, 'schema')
  if (ref.schema !== undefined) {
    throw new Error('schema 非法（不能包含多段路径）：' + schemaName)
  }
  return ref.table
}

/**
 * 校验并拼接 table 与可选 schema：
 * - 先用 parseTableRef 校验 table 与 schema（拒绝多段 schema 或非法字符）；
 * - 仅当 table 自身不含 schema 段时，安全加引号拼接为 `"schema"."table"`，
 *   支持含点号的引号表名（如 `"my.table"`）与已加引号的 schema（如 `"analytics"`）。
 */
function qualifyTableRef(table: string, schemaName: string | undefined): string {
  const tableRef = parseTableRef(table, '表名')
  if (schemaName === undefined) return table
  const parsedSchema = parseSingleSchema(schemaName)
  if (tableRef.schema !== undefined) return table
  return quoteDoubleIdent(parsedSchema) + '.' + quoteDoubleIdent(tableRef.table)
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
async function databaseSize(adapter: DatabaseAdapter, engine: string, signal?: AbortSignal, timeoutMs?: number): Promise<number> {
  const options: QueryOptions | undefined = timeoutMs !== undefined ? { timeoutMs } : undefined
  if (engine === 'sqlite') {
    const pageCount = await adapter.query('PRAGMA page_count', 1, signal, options)
    const pageSize = await adapter.query('PRAGMA page_size', 1, signal, options)
    return Number(pageCount.rows[0]?.[0] ?? 0) * Number(pageSize.rows[0]?.[0] ?? 0)
  }
  if (engine === 'mysql') {
    const result = await adapter.query('SELECT SUM(DATA_LENGTH + INDEX_LENGTH) FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()', 1, signal, options)
    return Number(result.rows[0]?.[0] ?? -1)
  }
  const result = await adapter.query('SELECT pg_database_size(current_database())', 1, signal, options)
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

const MAX_TABLE_RENDER_CHARS = 8000

/** 构建六个工具定义；adapters 惰性创建并按小写连接名缓存，支持静态配置或活引用 getter。 */
export function buildSqlTools(
  config: ResolvedSqlConfig | (() => ResolvedSqlConfig),
  policyOf: (execution: unknown) => 'ask' | 'never' | 'unknown' = () => 'unknown',
): { tools: SqlToolDefinition[]; adapters: Map<string, DatabaseAdapter> } {
  const getCfg = typeof config === 'function' ? config : () => config
  const adapters = new Map<string, DatabaseAdapter>()
  const adapterFingerprints = new Map<string, string>()

  const adapterFingerprint = (cfg: ResolvedSqlConfig, connection: SqlConnectionConfig): string => {
    const effectiveReadOnly = cfg.readOnly || connection.readOnly === true
    return JSON.stringify({ connection, effectiveReadOnly })
  }

  /**
   * 同步适配器缓存：清理配置中已移除/改名，或连接参数/生效 readOnly 发生变更的旧连接池，
   * 防止热更新后连接池或文件句柄泄漏。
   */
  const syncAdapters = (cfg: ResolvedSqlConfig): void => {
    const active = new Map<string, string>()
    for (const connection of cfg.connections) {
      active.set(connection.name.toLowerCase(), adapterFingerprint(cfg, connection))
    }
    for (const [key, adapter] of [...adapters.entries()]) {
      const nextFp = active.get(key)
      const prevFp = adapterFingerprints.get(key)
      if (nextFp === undefined || (prevFp !== undefined && prevFp !== nextFp)) {
        adapters.delete(key)
        adapterFingerprints.delete(key)
        void adapter.close().catch(() => {})
      }
    }
  }

  const findConnectionIn = (cfg: ResolvedSqlConfig, name: string | undefined): SqlConnectionConfig => {
    const target = name ?? cfg.connections[0].name
    const connection = cfg.connections.find((item) => item.name.toLowerCase() === target.toLowerCase())
    if (connection === undefined) {
      throw new Error('未找到名为 ' + target + ' 的数据库连接。可用 sql_list 查看现有连接清单，或在 DSH「设置 → 插件 → 数据库（dsh-sql）」/ cordis.patch.yml 中添加该连接。')
    }
    return connection
  }

  /** 只解析连接配置（不建连接），用于在打开数据库前挑选词法规则。 */
  const findConnection = (name: string | undefined): { cfg: ResolvedSqlConfig; connection: SqlConnectionConfig } => {
    const cfg = getCfg()
    const connection = findConnectionIn(cfg, name)
    return { cfg, connection }
  }

  const getAdapterFor = (cfg: ResolvedSqlConfig, connection: SqlConnectionConfig): DatabaseAdapter => {
    syncAdapters(cfg)
    const key = connection.name.toLowerCase()
    const effectiveReadOnly = cfg.readOnly || connection.readOnly === true
    const fp = adapterFingerprint(cfg, connection)
    let adapter = adapters.get(key)
    if (adapter === undefined) {
      adapter = createAdapter(connection, { readOnly: effectiveReadOnly })
      adapters.set(key, adapter)
      adapterFingerprints.set(key, fp)
    }
    return adapter
  }

  const getAdapter = (name: string | undefined): { adapter: DatabaseAdapter; name: string; cfg: ResolvedSqlConfig; connection: SqlConnectionConfig } => {
    const { cfg, connection } = findConnection(name)
    const adapter = getAdapterFor(cfg, connection)
    return { adapter, name: connection.name, cfg, connection }
  }

  /** 适配器调用统一兜底：外部取消信号触发时原样抛出，其余错误（含超时）补「下一步」。 */
  const guard = async <T>(outerSignal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      outerSignal?.throwIfAborted()
      throw annotateError(error)
    }
  }

  const pingAllConnections = async (outerSignal?: AbortSignal): Promise<{ cfg: ResolvedSqlConfig; rows: Array<Record<string, unknown>> }> => {
    outerSignal?.throwIfAborted()
    const cfg = getCfg()
    syncAdapters(cfg)
    const pingTimeoutMs = Math.max(1, Math.min(cfg.queryTimeoutMs, 8000))
    const rows = await Promise.all(cfg.connections.map(async (connection) => {
      const effectiveReadOnly = cfg.readOnly || connection.readOnly === true
      const sslEnabled = Boolean(connection.ssl && connection.ssl !== 'disable')
      const entry: Record<string, unknown> = {
        name: connection.name,
        engine: connection.engine,
        readOnly: effectiveReadOnly,
        ...(sslEnabled ? { ssl: true } : {}),
      }
      if (connection.engine === 'sqlite') entry.file = connection.file ?? ':memory:'
      else {
        entry.host = connection.host ?? ''
        // 端口要一并返回，否则渲染只能显示 host:undefined/database。
        entry.port = connection.port
        entry.database = connection.database ?? ''
      }
      const scope = createTimeoutScope(outerSignal, pingTimeoutMs)
      try {
        const adapter = getAdapterFor(cfg, connection)
        await adapter.ping(scope.signal)
        entry.ok = true
        entry.error = ''
      } catch (error) {
        outerSignal?.throwIfAborted()
        entry.ok = false
        entry.error = annotateError(error).message
      } finally {
        scope.dispose()
      }
      return entry
    }))
    return { cfg, rows }
  }

  const sqlList: SqlToolDefinition = {
    name: 'sql_list',
    isConcurrencySafe: () => true,
    description: '列出配置的数据库连接并并发做连通性测试（SELECT 1）。返回连接名、引擎、目标、只读/SSL 状态与健康结果。',
    parameters: compileParameters({}),
    output: {
      schema: listSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const connections = Array.isArray(rec.connections) ? rec.connections : []
        const lines = ['共 ' + connections.length + ' 个数据库连接：']
        const bad: string[] = []
        for (const item of connections) {
          const c = asRecord(item)
          const target = c.file !== undefined && c.file !== '' ? c.file : c.host + ':' + c.port + '/' + c.database
          const tags: string[] = []
          if (c.readOnly === true) tags.push('只读')
          if (c.ssl === true) tags.push('SSL')
          const tagSuffix = tags.length > 0 ? ' [' + tags.join(', ') + ']' : ''
          lines.push('- ' + c.name + '（' + c.engine + ' @ ' + target + '）' + tagSuffix + (c.ok === true ? ' ✅' : ' ❌ ' + String(c.error ?? '')))
          if (c.ok !== true) bad.push(String(c.name))
        }
        if (bad.length > 0) {
          lines.push('', '下一步：先在 DSH「设置 → 插件 → 数据库（dsh-sql）」或 cordis.patch.yml 修好 ' + bad.join('、') + '（核对 host/port、服务是否启动、账号密码或 SQLite 文件路径），再运行 sql_list 复查。')
        } else if (rec.implicitMemoryDefault === true) {
          lines.push('', '提示：当前尚未配置外部数据库，正在使用内置临时内存库（sqlite @ :memory:）。如需连接自己的 SQLite / MySQL / PostgreSQL，请在 DSH「设置 → 插件 → 数据库（dsh-sql）」添加 connections（保存即生效），或在 cordis.patch.yml 配置（密码可填配置项或用环境变量 DSH_SQL_PASSWORD_<连接名大写>）。')
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_rawArgs: unknown, exec: unknown) {
      const { cfg, rows } = await pingAllConnections(executionSignal(exec))
      return { connections: rows, ...(cfg.implicitMemoryDefault ? { implicitMemoryDefault: true } : {}) }
    },
    timeoutMs: 30000,
  }

  const sqlQuery: SqlToolDefinition = {
    name: 'sql_query',
    isConcurrencySafe: () => true,
    description: '执行只读 SQL 查询（SELECT / PRAGMA / EXPLAIN / SHOW / DESCRIBE / WITH）。词法级校验按引擎处理反斜杠转义，拒绝 data-modifying CTE、SELECT INTO、FOR UPDATE/FOR SHARE、非白名单 PRAGMA 与多语句。支持 limit、参数化查询 params 与 table/csv/json 格式输出。MySQL / PostgreSQL 每次查询使用独立只读事务并回滚，不受 readOnly 开关影响；PostgreSQL 还以扩展协议拒绝多命令。connection 为连接名（缺省第一个连接）。写操作请用 sql_exec。',
    parameters: compileParameters({
      sql: { type: 'string', required: true, description: '只读 SQL 语句（必填，单条）。' },
      connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
      limit: { type: 'integer', minimum: 1, description: '本次最多返回行数（可选，不能超过全局 maxRows）。' },
      params: { type: 'array', items: {}, description: '参数化查询绑定值数组（可选；SQLite/MySQL 用 ?，PostgreSQL 用 $1/$2）。' },
      format: { type: 'string', enum: ['table', 'csv', 'json'], description: '输出格式：table（默认表格）/ csv / json。csv 与 json 会额外返回 formatted 文本，便于落盘或转存。' },
    }),
    output: {
      schema: querySchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const truncNote = rec.truncated === true
          ? '（已达上限 ' + rec.maxRows + ' 行，实际结果更多，可加 WHERE/LIMIT 或用 COUNT(*)）'
          : ''
        if (typeof rec.formatted === 'string' && (rec.formatted !== '' || rec.format === 'csv' || rec.format === 'json')) {
          const preview = rec.formatted.length > 4000 ? rec.formatted.slice(0, 4000) + '\n…（预览已截断）' : rec.formatted
          return [{ type: 'text', text: '查询返回 ' + rec.rowCount + ' 行（' + String(rec.format) + ' 格式）' + truncNote + '：\n' + preview }]
        }
        const rows = Array.isArray(rec.rows) ? rec.rows : []
        const header = '查询返回 ' + rec.rowCount + ' 行' + truncNote + '，列：' + (Array.isArray(rec.columns) ? rec.columns.join(', ') : '')
        const lines = [header]
        let totalChars = header.length
        let shown = 0
        let charCapped = false
        for (const row of rows.slice(0, 20)) {
          const line = '- ' + (Array.isArray(row) ? row.map((cell) => formatCell(cell)).join(' | ') : formatCell(row))
          if (shown > 0 && totalChars + 1 + line.length > MAX_TABLE_RENDER_CHARS) {
            charCapped = true
            break
          }
          if (shown === 0 && totalChars + 1 + line.length > MAX_TABLE_RENDER_CHARS) {
            const avail = Math.max(80, MAX_TABLE_RENDER_CHARS - totalChars - 16)
            lines.push(line.slice(0, avail) + '…(已截断)')
            shown += 1
            charCapped = true
            break
          }
          lines.push(line)
          totalChars += 1 + line.length
          shown += 1
        }
        if (charCapped) {
          lines.push('…输出已达长度上限，仅展示前 ' + shown + ' 行（共 ' + rows.length + ' 行）')
        } else if (rows.length > 20) {
          lines.push('…仅展示前 20 行')
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      const args = asRecord(rawArgs)
      const rawSql = requiredString(args, 'sql', 'SQL 语句')
      const connectionName = optionalString(args, 'connection')
      const requestedLimit = optionalPositiveInteger(args, 'limit')
      const params = optionalParams(args)
      const format = parseQueryFormat(args)
      // 单次解析连接与配置，先按目标引擎做词法校验，再打开数据库（避免 TOCTOU 与无效建库）。
      const { cfg, connection } = findConnection(connectionName)
      const sql = assertReadQuery(rawSql, connection.engine)
      const effectiveLimit = requestedLimit !== undefined ? Math.min(cfg.maxRows, requestedLimit) : cfg.maxRows
      const outerSignal = executionSignal(exec)
      const scope = createTimeoutScope(outerSignal, cfg.queryTimeoutMs)
      const adapter = getAdapterFor(cfg, connection)
      const queryOptions: QueryOptions = {
        ...(params !== undefined ? { params } : {}),
        timeoutMs: cfg.queryTimeoutMs,
      }
      let result
      try {
        result = await guard(outerSignal, () => adapter.query(sql, effectiveLimit + 1, scope.signal, queryOptions))
      } finally {
        scope.dispose()
      }
      const truncated = result.rows.length > effectiveLimit
      const rows = result.rows.slice(0, effectiveLimit)
      const base = {
        connection: connection.name,
        columns: result.columns,
        rows,
        rowCount: rows.length,
        truncated,
        maxRows: effectiveLimit,
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
    get timeoutMs() {
      return getCfg().queryTimeoutMs
    },
  }

  const sqlExec: SqlToolDefinition = {
    name: 'sql_exec',
    description: '执行写操作或 DDL（INSERT / UPDATE / DELETE / CREATE / ALTER / DROP 等，支持参数化 params 与多语句脚本）。受全局/单连接 readOnly 模式与写审批门双重保护。返回影响行数。',
    parameters: compileParameters({
      sql: { type: 'string', required: true, description: '写操作/DDL SQL（必填）。' },
      connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
      params: { type: 'array', items: {}, description: '参数化写入绑定值数组（可选；SQLite/MySQL 用 ?，PostgreSQL 用 $1/$2）。' },
    }),
    output: {
      schema: execSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const changes = typeof rec.changes === 'number' ? rec.changes : 0
        const tail = changes === 0 ? '\n注意：0 行受影响，通常是 WHERE 条件没有命中数据，或用的是 DDL/多语句脚本；可用 sql_query 复核。' : ''
        return [{ type: 'text', text: '执行完成（' + rec.connection + '）：影响 ' + changes + ' 行。' + tail }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      const currentCfg = getCfg()
      if (currentCfg.readOnly) {
        throw new Error('当前全局配置 readOnly=true，sql_exec 已被禁用。需要写操作请在 DSH「设置 → 插件 → 数据库（dsh-sql）」把 readOnly 改为 false（保存即生效），或修改 cordis.patch.yml。')
      }
      const args = asRecord(rawArgs)
      const sql = requiredString(args, 'sql', 'SQL 语句')
      const params = optionalParams(args)
      const connection = findConnectionIn(currentCfg, optionalString(args, 'connection'))
      if (connection.readOnly === true) {
        throw new Error('连接 ' + connection.name + ' 配置了单连接只读锁（readOnly=true），sql_exec 已被禁用。需要写操作请在连接配置中将其 readOnly 改为 false。')
      }
      const outerSignal = executionSignal(exec)
      const scope = createTimeoutScope(outerSignal, currentCfg.execTimeoutMs)
      const adapter = getAdapterFor(currentCfg, connection)
      const execOptions: ExecOptions = {
        ...(params !== undefined ? { params } : {}),
        timeoutMs: currentCfg.execTimeoutMs,
      }
      let changes: number
      try {
        changes = await guard(outerSignal, () => adapter.exec(sql, scope.signal, execOptions))
      } finally {
        scope.dispose()
      }
      return { connection: connection.name, changes, readOnly: false }
    },
    get timeoutMs() {
      return getCfg().execTimeoutMs
    },
  }

  const sqlSchema: SqlToolDefinition = {
    name: 'sql_schema',
    isConcurrencySafe: () => true,
    description: '查看数据库结构：不给 table 列出表清单（可用 schema / pattern 过滤）；给 table（支持 schema.table）返回该表的列（类型/非空/主键/默认值/注释）、索引与外键信息。',
    parameters: compileParameters({
      table: { type: 'string', description: '表名（可选；支持 schema.table；缺省列出全部表）。' },
      connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
      schema: { type: 'string', description: 'Schema 名称（可选；PostgreSQL 可按指定 schema 过滤表清单或限定表名）。' },
      pattern: { type: 'string', description: '表名过滤模式（可选，不带 table 时生效；支持不区分大小写子串或 * 通配符）。' },
    }),
    output: {
      schema: schemaToolSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const columns = Array.isArray(rec.columns) ? rec.columns : []
        // 指定了 table 却没有列：不能落到「共 0 张表」，那会把「表不存在」说成「库是空的」。
        if (typeof rec.table === 'string' && rec.table !== '') {
          const displayTable = typeof rec.schema === 'string' && rec.schema !== '' && !rec.table.startsWith(rec.schema + '.')
            ? rec.schema + '.' + rec.table
            : rec.table
          if (columns.length === 0) {
            return [{ type: 'text', text: '没有取到表 ' + displayTable + ' 的列：该表可能不存在、大小写/Schema 不匹配，或当前账号没有读取权限。\n下一步：先调用 sql_schema（不带 table）查看连接 ' + rec.connection + ' 的表清单，再用清单里的原名重试。' }]
          }
          const tableComment = typeof rec.comment === 'string' && rec.comment.trim() !== '' ? '（' + rec.comment.trim() + '）' : ''
          const lines = ['表 ' + displayTable + tableComment + ' 的列：']
          for (const item of columns) {
            const c = asRecord(item)
            const attrs: string[] = []
            if (c.primaryKey === true) attrs.push('主键')
            if (c.notNull === true) attrs.push('非空')
            if (c.defaultValue !== undefined && c.defaultValue !== null && String(c.defaultValue) !== '') {
              attrs.push('默认: ' + String(c.defaultValue))
            }
            const attrText = attrs.length > 0 ? '（' + attrs.join('，') + '）' : ''
            const colComment = typeof c.comment === 'string' && c.comment.trim() !== '' ? ' — ' + c.comment.trim() : ''
            lines.push('- ' + c.name + ' ' + c.type + attrText + colComment)
          }
          const indexes = Array.isArray(rec.indexes) ? rec.indexes : []
          if (indexes.length > 0) {
            lines.push('', '索引（' + indexes.length + '）：')
            for (const item of indexes) {
              const idx = asRecord(item)
              const cols = Array.isArray(idx.columns) ? idx.columns.map(String).join(', ') : ''
              lines.push('- ' + String(idx.name ?? '') + (idx.unique === true ? '（UNIQUE）' : '') + ' (' + cols + ')')
            }
          }
          const foreignKeys = Array.isArray(rec.foreignKeys) ? rec.foreignKeys : []
          if (foreignKeys.length > 0) {
            lines.push('', '外键（' + foreignKeys.length + '）：')
            for (const item of foreignKeys) {
              const fk = asRecord(item)
              lines.push('- ' + String(fk.column ?? '') + ' -> ' + String(fk.refTable ?? '') + '.' + String(fk.refColumn ?? ''))
            }
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const tables = Array.isArray(rec.tables) ? rec.tables : []
        if (tables.length === 0) {
          const filters: string[] = []
          if (typeof rec.schema === 'string' && rec.schema !== '') filters.push('schema=' + rec.schema)
          if (typeof rec.pattern === 'string' && rec.pattern !== '') filters.push('pattern=' + rec.pattern)
          if (filters.length > 0) {
            return [{ type: 'text', text: '连接 ' + rec.connection + ' 中没有匹配的表（过滤条件：' + filters.join('，') + '）。' }]
          }
          if (rec.implicitMemoryDefault === true) {
            return [{ type: 'text', text: '连接 ' + rec.connection + ' 里没有用户表（当前尚未配置外部数据库，正在使用内置临时内存库 :memory:。请在 DSH「设置 → 插件 → 数据库（dsh-sql）」添加你的 SQLite / MySQL / PostgreSQL 连接，保存即生效；或在 cordis.patch.yml 配置）。' }]
          }
          return [{ type: 'text', text: '连接 ' + rec.connection + ' 里没有用户表（库可能是空的，或该账号只能看到部分 Schema）。' }]
        }
        return [{ type: 'text', text: '共 ' + tables.length + ' 张表：' + tables.join(', ') }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      const args = asRecord(rawArgs)
      const table = optionalString(args, 'table')
      const schemaName = optionalString(args, 'schema')
      const pattern = optionalString(args, 'pattern')
      const tableRef = table !== undefined ? qualifyTableRef(table, schemaName) : undefined
      if (table === undefined && schemaName !== undefined) parseSingleSchema(schemaName)
      const { adapter, name, cfg } = getAdapter(optionalString(args, 'connection'))
      const outerSignal = executionSignal(exec)
      const scope = createTimeoutScope(outerSignal, 30000)
      const signal = scope.signal
      try {
        if (tableRef !== undefined && table !== undefined) {
          if (typeof adapter.describeTableDetail === 'function') {
            const detail = await guard(outerSignal, () => adapter.describeTableDetail!(tableRef, signal))
            return {
              connection: name,
              table: detail.table || table,
              ...(detail.schema !== undefined ? { schema: detail.schema } : {}),
              ...(detail.comment !== undefined && detail.comment !== null && detail.comment !== '' ? { comment: detail.comment } : {}),
              columns: detail.columns,
              indexes: detail.indexes,
              foreignKeys: detail.foreignKeys,
              tables: [],
            }
          }
          const columns = await guard(outerSignal, () => adapter.describeTable(tableRef, signal))
          return { connection: name, table, columns, indexes: [], foreignKeys: [], tables: [] }
        }
        const allTables = await guard(outerSignal, () => adapter.listTables(signal, schemaName))
        const tables = filterTablesByPattern(allTables, pattern)
        return {
          connection: name,
          ...(schemaName !== undefined ? { schema: schemaName } : {}),
          ...(pattern !== undefined ? { pattern } : {}),
          tables,
          columns: [],
          ...(cfg.implicitMemoryDefault ? { implicitMemoryDefault: true } : {}),
        }
      } finally {
        scope.dispose()
      }
    },
    timeoutMs: 30000,
  }

  const sqlStats: SqlToolDefinition = {
    name: 'sql_stats',
    isConcurrencySafe: () => true,
    description: '数据库概览统计：表数量、每张表的行数与占用体积、库总体积（SQLite 按页计算，MySQL/PostgreSQL 走系统表）。connection 为连接名（缺省第一个连接）。适合在写查询前先了解数据规模。',
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
          const label = typeof t.name === 'string' && t.name !== '' ? t.name : '（表清单读取失败）'
          const rowText = typeof t.rowCount === 'number'
            ? (t.estimated === true ? '约 ' : '') + t.rowCount + ' 行'
            : '行数未知' + (t.error ? '（' + t.error + '）' : '')
          const sizeText = typeof t.sizeBytes === 'number' && t.sizeBytes >= 0 ? '，' + formatBytes(t.sizeBytes) : ''
          lines.push('- ' + label + '：' + rowText + sizeText)
        }
        if (tables.length > 0 && tables.every((item) => typeof asRecord(item).rowCount !== 'number') && tables.every((item) => asRecord(item).error !== undefined)) {
          lines.push('', '下一步：统计信息读不到时，先用 sql_schema 确认表清单可用、账号有读取系统表/information_schema 的权限，再用 sql_query 手动 COUNT(*)。')
        }
        if (tables.length > 30) lines.push('…仅展示前 30 张表')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(rawArgs: unknown, exec: unknown) {
      const args = asRecord(rawArgs)
      const { adapter, name, cfg } = getAdapter(optionalString(args, 'connection'))
      const engine = adapter.engine
      const outerSignal = executionSignal(exec)
      const scope = createTimeoutScope(outerSignal, cfg.queryTimeoutMs)
      const signal = scope.signal
      const queryOptions: QueryOptions = { timeoutMs: cfg.queryTimeoutMs }
      let sizeBytes = -1
      const tables: Array<Record<string, unknown>> = []
      try {
        try {
          sizeBytes = await databaseSize(adapter, engine, signal, cfg.queryTimeoutMs)
        } catch {
          outerSignal?.throwIfAborted()
          if (signal.aborted) throw annotateError(signal.reason)
          sizeBytes = -1
        }
        if (engine === 'mysql') {
          try {
            const sql = "SELECT TABLE_NAME, TABLE_ROWS, (DATA_LENGTH + INDEX_LENGTH) AS total_bytes FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
            const result = await adapter.query(sql, undefined, signal, queryOptions)
            for (const row of result.rows) {
              const totalBytes = row[2] !== null && row[2] !== undefined ? Number(row[2]) : undefined
              tables.push({
                name: String(row[0]),
                rowCount: typeof row[1] === 'number' ? row[1] : Number(row[1] ?? 0),
                ...(totalBytes !== undefined && Number.isFinite(totalBytes) && totalBytes >= 0 ? { sizeBytes: totalBytes } : {}),
              })
            }
          } catch (error) {
            outerSignal?.throwIfAborted()
            if (signal.aborted) throw annotateError(signal.reason)
            tables.push({ name: '', error: error instanceof Error ? error.message : String(error) })
          }
        } else if (engine === 'postgres') {
          try {
            const sql = 'SELECT schemaname, relname, n_live_tup, pg_total_relation_size(relid) AS total_bytes FROM pg_stat_user_tables ORDER BY schemaname, relname'
            const result = await adapter.query(sql, undefined, signal, queryOptions)
            for (const row of result.rows) {
              const schemaName = String(row[0] ?? '')
              const relName = String(row[1] ?? '')
              const tableName = schemaName === '' || schemaName === 'public' ? relName : schemaName + '.' + relName
              const totalBytes = row[3] !== null && row[3] !== undefined ? Number(row[3]) : undefined
              tables.push({
                name: tableName,
                rowCount: typeof row[2] === 'number' ? row[2] : Number(row[2] ?? 0),
                ...(totalBytes !== undefined && Number.isFinite(totalBytes) && totalBytes >= 0 ? { sizeBytes: totalBytes } : {}),
              })
            }
          } catch (error) {
            outerSignal?.throwIfAborted()
            if (signal.aborted) throw annotateError(signal.reason)
            tables.push({ name: '', error: error instanceof Error ? error.message : String(error) })
          }
        } else {
          const names = await guard(outerSignal, () => adapter.listTables(signal))
          // 表数量极大（>200）时优先读取 sqlite_stat1 估计值，避免长时间阻塞事件循环；正常表数保持精确 COUNT(*)。
          let statEstimates: Map<string, number> | undefined
          if (names.length > 200) {
            try {
              const statResult = await adapter.query('SELECT tbl, stat FROM sqlite_stat1', undefined, signal, queryOptions)
              statEstimates = new Map<string, number>()
              for (const row of statResult.rows) {
                const tbl = String(row[0] ?? '')
                const firstNum = Number(String(row[1] ?? '').trim().split(/\s+/)[0])
                if (tbl !== '' && Number.isFinite(firstNum) && !statEstimates.has(tbl)) {
                  statEstimates.set(tbl, firstNum)
                }
              }
            } catch {
              outerSignal?.throwIfAborted()
              if (signal.aborted) throw annotateError(signal.reason)
              statEstimates = undefined
            }
          }
          for (let idx = 0; idx < names.length; idx += 1) {
            if (idx > 0) {
              await new Promise<void>((resolve) => setImmediate(resolve))
              outerSignal?.throwIfAborted()
              if (signal.aborted) throw annotateError(signal.reason)
            }
            const table = names[idx]
            const estimated = statEstimates?.get(table)
            if (estimated !== undefined) {
              tables.push({ name: table, rowCount: estimated, estimated: true })
              continue
            }
            try {
              const result = await adapter.query('SELECT COUNT(*) FROM ' + quoteIdent(engine, table), 1, signal, queryOptions)
              tables.push({ name: table, rowCount: Number(result.rows[0]?.[0] ?? 0) })
            } catch (error) {
              outerSignal?.throwIfAborted()
              if (signal.aborted) throw annotateError(signal.reason)
              tables.push({ name: table, error: error instanceof Error ? error.message : String(error) })
            }
          }
        }
        return { connection: name, engine, tableCount: tables.filter((t) => t.name !== '').length, tables, sizeBytes }
      } finally {
        scope.dispose()
      }
    },
    get timeoutMs() {
      return getCfg().queryTimeoutMs
    },
  }

  const sqlHealth: SqlToolDefinition = {
    name: 'sql_health',
    isConcurrencySafe: () => true,
    description: 'dsh-sql 自检：并发做连通性测试，并汇总安全配置（只读模式、写审批门、行数上限、超时）。遇到问题时先运行本工具定位。',
    parameters: compileParameters({}),
    output: {
      schema: healthSchema,
      render: (_args, value) => {
        const rec = asRecord(value)
        const connections = Array.isArray(rec.connections) ? rec.connections : []
        const bad = connections.filter((c) => asRecord(c).ok !== true)
        const lines = ['dsh-sql 自检' + (rec.ok === true ? '：正常。' : '：发现问题。')]
        for (const item of connections) {
          const c = asRecord(item)
          const tags: string[] = []
          if (c.readOnly === true) tags.push('只读')
          if (c.ssl === true) tags.push('SSL')
          const tagSuffix = tags.length > 0 ? ' [' + tags.join(', ') + ']' : ''
          lines.push('- ' + c.name + '（' + c.engine + '）' + tagSuffix + (c.ok === true ? ' ✅' : ' ❌ ' + String(c.error ?? '')))
        }
        lines.push('- 只读模式：' + (rec.readOnly === true ? '开（sql_exec 已禁用）' : '关'))
        lines.push('- 写审批门：' + String(rec.writeApprovalDetail ?? (rec.writeApproval === true ? '开' : '关')))
        lines.push('- 行数上限：' + String(rec.maxRows) + '；查询超时 ' + String(rec.queryTimeoutMs) + 'ms；写超时 ' + String(rec.execTimeoutMs) + 'ms')
        if (rec.implicitMemoryDefault === true) {
          lines.push('- 配置提示：当前尚未添加外部数据库，正在使用内置临时内存库（:memory:）；可在 DSH「设置 → 插件 → 数据库（dsh-sql）」添加连接（保存即生效），或在 cordis.patch.yml 配置。')
        }
        // 自检的价值在于失败时告诉用户下一步做什么，而不只是把 ❌ 摆出来。
        if (bad.length > 0) {
          lines.push('- 下一步：在 DSH「设置 → 插件 → 数据库（dsh-sql）」或 cordis.patch.yml 逐个修好上面的 ❌ 连接（核对 host/port、数据库服务是否启动、账号密码或 SQLite 文件路径与权限），再运行 sql_health 复查。')
        }
        if (rec.writeApprovalReady === false) {
          lines.push('- 下一步：写审批门当前无法确认。把会话审批策略切到可询问（ask），或由用户明确在「设置 → 插件 → 数据库」将 writeApproval 设为 false（之后 sql_exec 不再询问，慎用）。')
        }
        if (rec.readOnly === true) lines.push('- 说明：readOnly=true 时 sql_exec 被禁用属于配置预期，不是故障。')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_rawArgs: unknown, exec: unknown) {
      const { cfg, rows: connections } = await pingAllConnections(executionSignal(exec))
      const bad = connections.filter((c) => c.ok !== true)
      const policy = policyOf(exec)
      const writeApprovalReady = cfg.readOnly || !cfg.writeApproval || policy === 'ask'
      const writeApprovalDetail = cfg.readOnly ? '只读配置，不允许写入' : !cfg.writeApproval ? '关闭；其它宿主策略仍生效' : policy === 'ask' ? '开启；经宿主询问' : policy === 'never' ? '当前策略 never 无法询问；请切换模式或由用户明确设置 writeApproval=false' : '无法读取宿主审批策略'
      return {
        ok: bad.length === 0 && writeApprovalReady,
        plugin: 'dsh-sql',
        connections,
        readOnly: cfg.readOnly,
        writeApproval: cfg.writeApproval,
        approvalPolicy: policy,
        writeApprovalReady,
        writeApprovalDetail,
        maxRows: cfg.maxRows,
        queryTimeoutMs: cfg.queryTimeoutMs,
        execTimeoutMs: cfg.execTimeoutMs,
        ...(cfg.implicitMemoryDefault ? { implicitMemoryDefault: true } : {}),
      }
    },
    timeoutMs: 30000,
  }

  return { tools: [sqlList, sqlQuery, sqlExec, sqlSchema, sqlStats, sqlHealth], adapters }
}
