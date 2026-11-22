/**
 * dsh-sql 配置解析：多连接定义、行数上限、只读模式、写审批策略与敏感列脱敏。
 *
 * @module dsh-sql/config
 */

/** 数据库连接 TLS/SSL 选项。 */
export type SqlSslOption =
  | boolean
  | 'disable'
  | 'allow'
  | 'prefer'
  | 'require'
  | 'verify-ca'
  | 'verify-full'
  | { rejectUnauthorized?: boolean; ca?: string }

/** 开启 redactColumns: true 时使用的内置敏感列匹配模式（不区分大小写子串匹配）。 */
export const DEFAULT_REDACT_COLUMN_PATTERNS: readonly string[] = Object.freeze([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'access_key',
  'private_key',
  'credential',
  'auth_key',
  'session_key',
])

/** 单个数据库连接（行配置）。 */
export interface SqlConnectionConfig {
  name: string
  engine: 'sqlite' | 'mysql' | 'postgres'
  file?: string
  url?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  readOnly?: boolean
  ssl?: SqlSslOption
}

/** 解析后的表引用（可选 schema + 表名）。 */
export interface ParsedTableRef {
  schema?: string
  table: string
}

/** 插件行配置。 */
export interface SqlConfig {
  connections?: SqlConnectionConfig[]
  maxRows?: number
  readOnly?: boolean
  writeApproval?: boolean
  queryTimeoutMs?: number
  execTimeoutMs?: number
  redactColumns?: boolean | string[]
}

/** 解析后的配置。 */
export interface ResolvedSqlConfig {
  connections: SqlConnectionConfig[]
  maxRows: number
  readOnly: boolean
  writeApproval: boolean
  queryTimeoutMs: number
  execTimeoutMs: number
  redactColumns: string[]
  /** 未显式配置 connections 时为 true（自动回退到内置 :memory: SQLite）。 */
  implicitMemoryDefault?: boolean
}

const ENGINES = ['sqlite', 'mysql', 'postgres'] as const
const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'] as const
const SSL_MODES_TEXT = SSL_MODES.join(' / ')
type SqlSslMode = (typeof SSL_MODES)[number]
const REDACT_REGEX_SYNTAX = /^\/(.*)\/([a-zA-Z]*)$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isSslMode(value: string): value is SqlSslMode {
  return (SSL_MODES as readonly string[]).includes(value)
}

function normalizeSslOption(rawSsl: unknown, name: string): SqlSslOption {
  if (typeof rawSsl === 'boolean') return rawSsl
  if (typeof rawSsl === 'string') {
    const mode = rawSsl.trim().toLowerCase()
    if (isSslMode(mode)) return mode
    throw new Error('连接 ' + name + ' 的 ssl 配置非法：字符串仅支持 ' + SSL_MODES_TEXT + '。')
  }
  if (isPlainObject(rawSsl)) {
    const out: { rejectUnauthorized?: boolean; ca?: string } = {}
    for (const key of Object.keys(rawSsl)) {
      if (key !== 'rejectUnauthorized' && key !== 'ca') {
        throw new Error('连接 ' + name + ' 的 ssl 对象包含不支持的字段：' + key + '。')
      }
    }
    if (rawSsl.rejectUnauthorized !== undefined) {
      if (typeof rawSsl.rejectUnauthorized !== 'boolean') {
        throw new Error('连接 ' + name + ' 的 ssl.rejectUnauthorized 必须是布尔值。')
      }
      out.rejectUnauthorized = rawSsl.rejectUnauthorized
    }
    if (rawSsl.ca !== undefined) {
      if (typeof rawSsl.ca !== 'string' || rawSsl.ca.trim() === '') {
        throw new Error('连接 ' + name + ' 的 ssl.ca 必须是非空字符串。')
      }
      out.ca = rawSsl.ca
    }
    return out
  }
  throw new Error('连接 ' + name + ' 的 ssl 配置非法：仅支持布尔值、' + SSL_MODES_TEXT + ' 或 { rejectUnauthorized, ca } 对象。')
}

interface ParsedConnectionUrl {
  file?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: SqlSslOption
}

function decodeUrlComponentSafe(value: string, name: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('连接 ' + name + ' 的 url 包含无效的百分号编码，请检查连接字符串。')
  }
}

function parseUrlSslParams(searchParams: URLSearchParams, name: string): SqlSslOption | undefined {
  let sslModeValue: string | undefined
  let sslValue: string | undefined
  for (const [k, v] of searchParams.entries()) {
    const lowerKey = k.toLowerCase()
    if (lowerKey === 'sslmode') sslModeValue = v
    else if (lowerKey === 'ssl') sslValue = v
  }
  if (sslModeValue !== undefined && sslModeValue.trim() !== '') {
    const normalized = sslModeValue.trim().toLowerCase()
    if (isSslMode(normalized)) return normalized
    throw new Error('连接 ' + name + ' 的 url 中 sslmode 参数非法：仅支持 ' + SSL_MODES_TEXT + '。')
  }
  if (sslValue !== undefined && sslValue.trim() !== '') {
    const normalized = sslValue.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
    if (isSslMode(normalized)) return normalized
    throw new Error('连接 ' + name + ' 的 url 中 ssl 参数非法：仅支持 true / false / 1 / 0 或 ' + SSL_MODES_TEXT + '。')
  }
  return undefined
}

function parseSqliteUrl(trimmedUrl: string, name: string): ParsedConnectionUrl {
  const match = /^(sqlite|file):(.*)$/i.exec(trimmedUrl)
  if (match === null) {
    throw new Error('连接 ' + name + ' 为 sqlite 引擎，url 必须以 sqlite: 或 file: 开头。')
  }
  const rest = match[2]
  const withoutFragment = rest.split('#')[0]
  const queryIndex = withoutFragment.indexOf('?')
  let pathPart = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex)

  if (/^\/\/localhost\//i.test(pathPart)) {
    pathPart = pathPart.slice('//localhost'.length)
  } else if (pathPart.startsWith('//')) {
    pathPart = pathPart.slice(2)
  }

  const decoded = decodeUrlComponentSafe(pathPart, name)
  if (decoded.trim() === '' || /[\x00-\x1f\x7f]/.test(decoded)) {
    throw new Error('连接 ' + name + ' 的 url 缺少有效的 SQLite 文件路径。')
  }

  const normalizedPath = /^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded
  if (normalizedPath === '/') {
    throw new Error('连接 ' + name + ' 的 url 缺少有效的 SQLite 文件路径。')
  }
  if (normalizedPath === '/:memory:' || normalizedPath === ':memory:') {
    return { file: ':memory:' }
  }
  return { file: normalizedPath }
}

function parseConnectionUrl(rawUrl: string, engine: SqlConnectionConfig['engine'], name: string): ParsedConnectionUrl {
  const trimmed = rawUrl.trim()
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error('连接 ' + name + ' 的 url 格式无效（不能包含控制字符）。')
  }
  if (engine === 'sqlite') {
    return parseSqliteUrl(trimmed, name)
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (schemeMatch === null) {
    throw new Error('连接 ' + name + ' 的 url 格式无效，请检查协议、主机与端口。')
  }
  const scheme = schemeMatch[1].toLowerCase()
  if (engine === 'postgres' && scheme !== 'postgres' && scheme !== 'postgresql') {
    throw new Error('连接 ' + name + ' 为 postgres 引擎，url 必须以 postgres:// 或 postgresql:// 开头。')
  }
  if (engine === 'mysql' && scheme !== 'mysql') {
    throw new Error('连接 ' + name + ' 为 mysql 引擎，url 必须以 mysql:// 开头。')
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error('连接 ' + name + ' 的 url 格式无效，请使用 ' + engine + '://主机/数据库 格式。')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('连接 ' + name + ' 的 url 格式无效，请检查主机、端口或凭据编码。')
  }

  const out: ParsedConnectionUrl = {}
  if (parsed.hostname !== '') {
    out.host = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname
  }
  if (parsed.port !== '') {
    const portNum = Number(parsed.port)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error('连接 ' + name + ' 的 url 端口号无效（需为 1–65535 的整数）。')
    }
    out.port = portNum
  }
  if (parsed.username !== '') {
    out.user = decodeUrlComponentSafe(parsed.username, name)
  }
  if (parsed.password !== '') {
    out.password = decodeUrlComponentSafe(parsed.password, name)
  }
  const rawDb = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname
  if (rawDb !== '') {
    const decodedDb = decodeUrlComponentSafe(rawDb, name).trim()
    if (decodedDb !== '') out.database = decodedDb
  }
  const urlSsl = parseUrlSslParams(parsed.searchParams, name)
  if (urlSsl !== undefined) out.ssl = urlSsl
  return out
}

function compileRedactRegex(pattern: string): RegExp | undefined {
  const match = REDACT_REGEX_SYNTAX.exec(pattern)
  if (match === null) return undefined
  const [, body, flags] = match
  if (body === '') {
    throw new Error('redactColumns 包含非法正则表达式：' + pattern + '（模式不能为空）。')
  }
  if (/[^iu]/.test(flags)) {
    throw new Error('redactColumns 正则表达式标志非法（仅支持 i / u）：' + pattern + '。')
  }
  try {
    return new RegExp(body, flags || 'i')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error('redactColumns 包含非法正则表达式：' + pattern + '（' + detail + '）。')
  }
}

function resolveRedactColumns(raw: unknown): string[] {
  if (raw === undefined || raw === false) return []
  if (raw === true) return [...DEFAULT_REDACT_COLUMN_PATTERNS]
  if (!Array.isArray(raw)) {
    throw new Error('redactColumns 必须是布尔值或非空字符串数组。')
  }
  const resolved: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error('redactColumns 必须是布尔值或非空字符串数组。')
    }
    const trimmed = item.trim()
    compileRedactRegex(trimmed)
    if (!seen.has(trimmed)) {
      seen.add(trimmed)
      resolved.push(trimmed)
    }
  }
  return resolved
}

/**
 * 根据脱敏模式列表匹配结果列，返回命中的 0-based 列下标集合。
 * 支持 `/pattern/`、`/pattern/flags`（允许 `i` / `u` 标志）正则以及不区分大小写的子串匹配。
 */
export function matchRedactedColumns(columns: readonly string[], patterns: readonly string[]): Set<number> {
  const matched = new Set<number>()
  if (patterns.length === 0 || columns.length === 0) return matched

  const matchers: Array<{ regex: RegExp } | { needle: string }> = []
  for (const raw of patterns) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const regex = compileRedactRegex(trimmed)
    if (regex !== undefined) {
      matchers.push({ regex })
    } else {
      matchers.push({ needle: trimmed.toLowerCase() })
    }
  }
  if (matchers.length === 0) return matched

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    let lowerCol: string | undefined
    for (const matcher of matchers) {
      if ('regex' in matcher) {
        if (matcher.regex.test(col)) {
          matched.add(i)
          break
        }
      } else {
        lowerCol ??= col.toLowerCase()
        if (lowerCol.includes(matcher.needle)) {
          matched.add(i)
          break
        }
      }
    }
  }
  return matched
}

/** 连接密码环境变量名：DSH_SQL_PASSWORD_<NAME 大写>。 */
export function passwordEnvName(name: string): string {
  return 'DSH_SQL_PASSWORD_' + name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

/**
 * 解析并校验配置；无连接时给一个内存 SQLite 兜底连接。
 */
export function resolveConfig(config: SqlConfig | undefined | null, env: NodeJS.ProcessEnv = process.env): ResolvedSqlConfig {
  const cfg = config ?? {}
  if (cfg.connections !== undefined && !Array.isArray(cfg.connections)) {
    throw new Error('connections 必须是连接配置数组。')
  }
  const rawConnections = cfg.connections ?? []
  const connections: SqlConnectionConfig[] = []
  const seen = new Set<string>()
  for (const raw of rawConnections) {
    if (typeof raw !== 'object' || raw === null) continue
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (name === '') throw new Error('connections 里每个连接都需要 name 字段。')
    if (seen.has(name.toLowerCase())) throw new Error('连接名重复：' + name + '。')
    seen.add(name.toLowerCase())
    const engine = raw.engine as (typeof ENGINES)[number] | undefined
    if (!ENGINES.includes(engine as (typeof ENGINES)[number])) throw new Error('连接 ' + name + ' 的 engine 必须是 sqlite / mysql / postgres 之一。')
    if (raw.readOnly !== undefined && typeof raw.readOnly !== 'boolean') {
      throw new Error('连接 ' + name + ' 的 readOnly 必须是布尔值。')
    }
    if (raw.url !== undefined && typeof raw.url !== 'string') {
      throw new Error('连接 ' + name + ' 的 url 必须是字符串。')
    }
    const parsedUrl = typeof raw.url === 'string' && raw.url.trim() !== ''
      ? parseConnectionUrl(raw.url, engine as (typeof ENGINES)[number], name)
      : undefined
    const explicitSsl = raw.ssl !== undefined ? normalizeSslOption(raw.ssl, name) : undefined
    const resolvedSsl = explicitSsl !== undefined ? explicitSsl : parsedUrl?.ssl

    const connection: SqlConnectionConfig = { name, engine: engine as (typeof ENGINES)[number] }
    if (connection.engine === 'sqlite') {
      const explicitFile = typeof raw.file === 'string' && raw.file.trim() !== '' ? raw.file.trim() : undefined
      connection.file = explicitFile ?? parsedUrl?.file ?? ':memory:'
    } else {
      const explicitHost = typeof raw.host === 'string' && raw.host.trim() !== '' ? raw.host.trim() : undefined
      const explicitPort = typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port > 0 && raw.port <= 65535 ? raw.port : undefined
      const explicitUser = typeof raw.user === 'string' && raw.user.trim() !== '' ? raw.user.trim() : undefined
      const explicitDatabase = typeof raw.database === 'string' && raw.database.trim() !== '' ? raw.database.trim() : undefined
      const directPassword = typeof raw.password === 'string' ? raw.password.trim() : ''

      connection.host = explicitHost ?? parsedUrl?.host ?? 'localhost'
      connection.port = explicitPort ?? parsedUrl?.port ?? (connection.engine === 'postgres' ? 5432 : 3306)
      connection.user = explicitUser ?? parsedUrl?.user ?? ''
      connection.database = explicitDatabase ?? parsedUrl?.database ?? ''
      connection.password = directPassword !== ''
        ? directPassword
        : (parsedUrl?.password !== undefined && parsedUrl.password !== ''
          ? parsedUrl.password
          : (env[passwordEnvName(name)]?.trim() ?? ''))
      if (connection.database === '') throw new Error('连接 ' + name + ' 缺少 database 字段。')
    }
    if (raw.readOnly === true) connection.readOnly = true
    if (resolvedSsl !== undefined) connection.ssl = resolvedSsl
    connections.push(connection)
  }
  let implicitMemoryDefault = false
  if (connections.length === 0) {
    connections.push({ name: 'default', engine: 'sqlite', file: ':memory:' })
    implicitMemoryDefault = true
  }
  let maxRows = 1000
  if (cfg.maxRows !== undefined) {
    if (typeof cfg.maxRows !== 'number' || !Number.isInteger(cfg.maxRows) || cfg.maxRows <= 0) throw new Error('maxRows 必须是大于 0 的整数。')
    maxRows = Math.min(10000, cfg.maxRows)
  }
  let queryTimeoutMs = 60000
  if (cfg.queryTimeoutMs !== undefined) {
    if (typeof cfg.queryTimeoutMs !== 'number' || !Number.isFinite(cfg.queryTimeoutMs) || cfg.queryTimeoutMs <= 0) throw new Error('queryTimeoutMs 必须是大于 0 的数字（毫秒）。')
    queryTimeoutMs = Math.min(600000, Math.max(5000, Math.round(cfg.queryTimeoutMs)))
  }
  let execTimeoutMs = 120000
  if (cfg.execTimeoutMs !== undefined) {
    if (typeof cfg.execTimeoutMs !== 'number' || !Number.isFinite(cfg.execTimeoutMs) || cfg.execTimeoutMs <= 0) throw new Error('execTimeoutMs 必须是大于 0 的数字（毫秒）。')
    execTimeoutMs = Math.min(600000, Math.max(5000, Math.round(cfg.execTimeoutMs)))
  }
  const readOnly = cfg.readOnly === true
  const writeApproval = cfg.writeApproval !== false
  const redactColumns = resolveRedactColumns(cfg.redactColumns)
  return { connections, maxRows, readOnly, writeApproval, queryTimeoutMs, execTimeoutMs, redactColumns, implicitMemoryDefault }
}

/** 校验表名/标识符，防注入到 schema 语句。 */
export function assertIdentifier(name: string, label: string): string {
  const trimmed = name.trim()
  if (!/^[A-Za-z0-9_$]+$/.test(trimmed)) {
    throw new Error(label + ' 非法（只允许字母/数字/下划线/美元符）：' + name)
  }
  return trimmed
}

/**
 * 解析并校验表引用（支持 `table`、`schema.table`、连字符、Unicode、双引号与反引号标识符）。
 * 拒绝空串、NUL/控制字符、未加引号的分号或注释标记、空段与超过两段的点分路径。
 */
export function parseTableRef(input: string, label = '表名'): ParsedTableRef {
  if (typeof input !== 'string') {
    throw new Error(label + ' 非法：必须是非空字符串。')
  }
  if (/[\x00-\x1f\x7f]/.test(input)) {
    throw new Error(label + ' 非法（不能包含 NUL 或控制字符）。')
  }
  const trimmed = input.trim()
  if (trimmed === '') {
    throw new Error(label + ' 不能为空。')
  }

  const segments: string[] = []
  let i = 0
  while (i <= trimmed.length) {
    if (i === trimmed.length) {
      throw new Error(label + ' 非法（存在空的 schema 或表名段）：' + input)
    }
    const ch = trimmed[i]
    if (ch === '"' || ch === '`') {
      const quote = ch
      i += 1
      let value = ''
      let closed = false
      while (i < trimmed.length) {
        if (trimmed[i] === quote) {
          if (trimmed[i + 1] === quote) {
            value += quote
            i += 2
            continue
          }
          closed = true
          i += 1
          break
        }
        value += trimmed[i]
        i += 1
      }
      if (!closed) {
        throw new Error(label + ' 非法（引号未闭合）：' + input)
      }
      if (value === '' || value.trim() === '') {
        throw new Error(label + ' 非法（引号内标识符不能为空）：' + input)
      }
      segments.push(value)
      if (i === trimmed.length) break
      if (trimmed[i] !== '.') {
        throw new Error(label + ' 非法（引号后只能跟点号或结束）：' + input)
      }
      i += 1
    } else {
      const start = i
      while (i < trimmed.length && trimmed[i] !== '.') {
        const c = trimmed[i]
        if (c === ';' || c === '"' || c === '`' || c === "'" || c === '\\' || c === '(' || c === ')' || c === ',' || /\s/.test(c)) {
          throw new Error(label + ' 非法（包含不允许的未加引号字符）：' + input)
        }
        i += 1
      }
      const value = trimmed.slice(start, i)
      if (value === '') {
        throw new Error(label + ' 非法（存在空的 schema 或表名段）：' + input)
      }
      if (value.includes('--') || value.includes('/*') || value.includes('*/')) {
        throw new Error(label + ' 非法（不能包含 SQL 注释标记）：' + input)
      }
      segments.push(value)
      if (i === trimmed.length) break
      i += 1
    }
    if (segments.length >= 2) {
      throw new Error(label + ' 非法（最多只支持 schema.table 两段）：' + input)
    }
  }

  if (segments.length === 2) {
    return { schema: segments[0], table: segments[1] }
  }
  return { table: segments[0] }
}
