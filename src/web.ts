/**
 * dsh-sql 设置面板 HTTP 后端：提供认证 /api 路由与旧回环 /_dsh 路由。
 *
 * 职责：
 * - 返回当前活配置的安全快照（永不返回明文密码或原始 URL 凭据）；
 * - 支持连接的增/改/删、只读连通性测试（临时适配器 + 8s 超时 + 必定 close）与安全护栏保存；
 * - 通过宿主 settings 服务（mutate / update / replace）持久化配置，写后由活引用与修订号即时生效。
 *
 * @module dsh-sql/web
 */

import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { performance } from 'node:perf_hooks'
import { createAdapter, type AdapterOptions, type DatabaseAdapter } from './adapters.js'
import {
  passwordEnvName,
  resolveConfig,
  type SqlConfig,
  type SqlConnectionConfig,
  type SqlSslOption,
} from './config.js'
import { liveConfig } from './host-config.js'
import { annotateError } from './tools.js'

/** DSH 0.2.2+ 宿主认证连接路由。 */
export const SQL_API_ROUTE = '/api/dsh-sql/settings'

/** 旧宿主 webServer 回环兼容路由。 */
export const SQL_SETTINGS_ROUTE = '/_dsh/dsh-sql/settings'

const MAX_BODY_BYTES = 256 * 1024
const DEFAULT_TEST_TIMEOUT_MS = 8000
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1'])
const CONFIG_KEYS = [
  'connections',
  'maxRows',
  'readOnly',
  'writeApproval',
  'queryTimeoutMs',
  'execTimeoutMs',
  'redactColumns',
] as const

/** 设置面板返回的单条连接脱敏视图（绝不含明文密码与原始 url）。 */
export interface SqlSettingsConnectionView {
  name: string
  engine: 'sqlite' | 'mysql' | 'postgres'
  file?: string
  host?: string
  port?: number
  user?: string
  database?: string
  readOnly: boolean
  ssl?: SqlSslOption
  hasPassword: boolean
  passwordSource: 'config' | 'env' | 'none'
  passwordEnvVar: string
}

/** 设置面板返回的安全护栏视图。 */
export interface SqlSettingsGuardrailsView {
  maxRows: number
  readOnly: boolean
  writeApproval: boolean
  queryTimeoutMs: number
  execTimeoutMs: number
  redactMode: 'off' | 'builtin' | 'custom'
  redactColumns: string[]
}

/** GET / POST 返回的完整设置快照。 */
export interface SqlSettingsSnapshot {
  revision: string
  writable: boolean
  implicitMemoryDefault: boolean
  connections: SqlSettingsConnectionView[]
  guardrails: SqlSettingsGuardrailsView
}

/** 单次连通性测试结果。 */
export type SqlSettingsTestResult =
  | { ok: true; durationMs: number; tableCount?: number }
  | { ok: false; durationMs: number; error: string }

/** 连接保存/测试请求中的草稿连接输入。 */
export interface SqlSettingsConnectionInput {
  name?: string
  engine?: 'sqlite' | 'mysql' | 'postgres' | string
  file?: string
  url?: string
  host?: string
  port?: number | string | null
  user?: string
  password?: string
  database?: string
  readOnly?: boolean
  ssl?: SqlSslOption | null | ''
}

/** 宿主 settings.mutate 的单条操作。 */
export interface SqlSettingsMutateOp {
  op: 'set'
  path: string[]
  value: unknown
}

/** 宿主 settings.describe() 返回的单行描述符。 */
export interface SqlHostSettingsDescriptor {
  ns?: string
  revision?: number
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  value?: Record<string, unknown>
}

/** 宿主 settings 服务的最小鸭子类型面。 */
export interface SqlHostSettingsProvider {
  readonly writable?: boolean
  describe?(): SqlHostSettingsDescriptor[] | undefined
  mutate?(ns: string, ops: SqlSettingsMutateOp[], expectedRevision?: number): Promise<unknown>
  update?(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<unknown>
  replace?(ns: string, doc: Record<string, unknown>, expectedRevision?: number): Promise<unknown>
  configure?(options: { auto?: boolean }, fiber?: unknown): unknown
}

/** 设置后端所需的最小插件上下文。 */
export interface SqlSettingsContext {
  get?(name: string): unknown
  settings?: unknown
  fiber?: { entry?: { options?: { id?: string } } }
  inject?(deps: readonly string[], callback: (ctx: any) => void): unknown
  effect?(effect: () => (() => unknown) | void, label?: string): unknown
}

/** 创建设置后端时的可选依赖覆盖（便于测试与扩展）。 */
export interface SqlSettingsBackendOptions {
  env?: NodeJS.ProcessEnv
  entryId?: string
  writable?: () => boolean
  getProvider?: () => SqlHostSettingsProvider | undefined
  testTimeoutMs?: number
  createAdapter?: (connection: SqlConnectionConfig, options?: AdapterOptions) => DatabaseAdapter
}

/** 带 HTTP 状态码与机器可读错误码的设置后端异常。 */
export class SqlSettingsError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status = 400, code = 'invalid') {
    super(message)
    this.name = 'SqlSettingsError'
    this.status = status
    this.code = code
  }
}

/** 设置后端实例接口。 */
export interface SqlSettingsBackend {
  snapshot(): SqlSettingsSnapshot
  fetch(request: Request): Promise<Response>
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function cloneSsl(ssl: SqlSslOption): SqlSslOption {
  return isPlainObject(ssl) ? { ...ssl } : ssl
}

function cloneConnection(conn: SqlConnectionConfig): SqlConnectionConfig {
  const out: SqlConnectionConfig = { ...conn }
  if (out.ssl !== undefined) out.ssl = cloneSsl(out.ssl)
  return out
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((item) => stableStringify(item)).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

function entryIdOf(ctx: SqlSettingsContext | null | undefined, fallback = 'sql'): string {
  const id = ctx?.fiber?.entry?.options?.id
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : fallback
}

function settingsProviderOf(
  ctx: SqlSettingsContext | null | undefined,
  extraProvider?: () => SqlHostSettingsProvider | undefined,
): SqlHostSettingsProvider | undefined {
  let provider: unknown
  try {
    provider = typeof ctx?.get === 'function' ? ctx.get('settings') : undefined
  } catch {
    provider = undefined
  }
  if (provider === undefined || provider === null) {
    try {
      provider = extraProvider?.()
    } catch {
      provider = undefined
    }
  }
  if (provider === undefined || provider === null) {
    try {
      provider = ctx?.settings
    } catch {
      provider = undefined
    }
  }
  return provider !== undefined && provider !== null ? (provider as SqlHostSettingsProvider) : undefined
}

function findDescriptor(
  provider: SqlHostSettingsProvider | undefined,
  entryId: string,
): SqlHostSettingsDescriptor | undefined {
  if (typeof provider?.describe !== 'function') return undefined
  try {
    const rows = provider.describe()
    if (!Array.isArray(rows)) return undefined
    return rows.find((row) => row !== undefined && row !== null && row.ns === entryId)
  } catch {
    return undefined
  }
}

function hostRevisionOf(provider: SqlHostSettingsProvider | undefined, entryId: string): number | undefined {
  const rev = findDescriptor(provider, entryId)?.revision
  return typeof rev === 'number' && Number.isFinite(rev) ? rev : undefined
}

function providerCanWrite(provider: SqlHostSettingsProvider | undefined): boolean {
  if (provider === undefined || provider.writable === false) return false
  return typeof provider.mutate === 'function'
    || typeof provider.update === 'function'
    || typeof provider.replace === 'function'
}

/** 从连接配置（直接 password 或 url 内嵌凭据，不含环境变量）提取明文密码。 */
function extractConfigPassword(rawConn: Partial<SqlConnectionConfig> | undefined): string {
  if (!rawConn || typeof rawConn !== 'object') return ''
  if (typeof rawConn.password === 'string' && rawConn.password.trim() !== '') {
    return rawConn.password.trim()
  }
  if (typeof rawConn.url === 'string' && rawConn.url.trim() !== '') {
    return extractUrlPassword(rawConn.url)
  }
  return ''
}

function extractUrlPassword(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return ''
  const trimmed = rawUrl.trim()
  if (trimmed === '' || !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.password === '') return ''
    try {
      return decodeURIComponent(parsed.password)
    } catch {
      return parsed.password
    }
  } catch {
    return ''
  }
}

function collectRawUrlPasswords(rawUrl: unknown, out: Set<string>): void {
  if (typeof rawUrl !== 'string') return
  const trimmed = rawUrl.trim()
  if (trimmed === '') return
  try {
    const parsed = new URL(trimmed)
    if (parsed.password !== '') {
      out.add(parsed.password)
      try {
        const decoded = decodeURIComponent(parsed.password)
        if (decoded !== '') out.add(decoded)
      } catch {
        // Ignore invalid percent encoding while collecting secrets.
      }
    }
  } catch {
    // Also grab raw user:pass@ pattern from malformed URLs so nothing leaks.
    const match = /:\/\/[^:@/\s]+:([^@/\s]+)@/.exec(trimmed)
    if (match?.[1]) out.add(match[1])
  }
}

function redactSecrets(message: string, secrets: Iterable<string>): string {
  let safe = message.replace(/(postgres(?:ql)?|mysql):\/\/([^:@/\s]+):([^@/\s]+)@/gi, '$1://$2:***@')
  const list = [...new Set([...secrets].filter((s) => typeof s === 'string' && s.length >= 3))]
    .sort((a, b) => b.length - a.length)
  for (const secret of list) {
    safe = safe.split(secret).join('[REDACTED]')
  }
  return safe
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const parts = [
      typeof error.message === 'string' ? error.message.trim() : '',
      ...error.errors.map((sub) => (sub instanceof Error ? sub.message.trim() : String(sub).trim())),
    ].filter((part) => part !== '')
    if (parts.length > 0) return parts[0]
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  if (error instanceof Error) {
    if (error.message.trim() !== '') return error.message
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
    return error.name || '连接失败'
  }
  const str = String(error).trim()
  return str !== '' ? str : '连接失败'
}

function validateOriginHeader(origin: string, expectedRawHost: string): void {
  if (origin === 'dsh-app://app') return
  let source: URL
  try {
    source = new URL(origin)
  } catch {
    throw new SqlSettingsError('请从当前 DSH 设置页面操作。', 403, 'origin')
  }
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.origin !== origin) {
    throw new SqlSettingsError('请从当前 DSH 设置页面操作。', 403, 'origin')
  }
  let expected: URL
  try {
    expected = new URL(source.protocol + '//' + expectedRawHost.trim())
  } catch {
    throw new SqlSettingsError('请从当前 DSH 设置页面操作。', 403, 'origin')
  }
  if (expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash) {
    throw new SqlSettingsError('请从当前 DSH 设置页面操作。', 403, 'origin')
  }
  if (source.host !== expected.host) {
    throw new SqlSettingsError('请从当前 DSH 设置页面操作。', 403, 'origin')
  }
}

function validateCommonSecurityHeaders(params: {
  method: string
  dshSqlHeader: string | undefined
  secFetchSite: string | undefined
  origin: string | undefined
  expectedHost: string
  contentType: string | undefined
}): void {
  if (params.method !== 'GET' && params.method !== 'POST') {
    throw new SqlSettingsError('仅支持 GET 和 POST。', 405, 'method')
  }
  if (params.dshSqlHeader !== '1') {
    throw new SqlSettingsError('请从当前 DSH 设置页面操作。', 403, 'origin')
  }
  const site = params.secFetchSite?.trim()
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new SqlSettingsError('请从当前 DSH 设置页面操作。', 403, 'origin')
  }
  const origin = params.origin?.trim()
  if (origin) {
    validateOriginHeader(origin, params.expectedHost)
  }
  if (params.method === 'POST') {
    const mediaType = (params.contentType ?? '').split(';')[0].trim().toLowerCase()
    if (mediaType !== 'application/json') {
      throw new SqlSettingsError('请求必须使用 application/json。', 415, 'unsupported_media_type')
    }
  }
}

function carrierGuard(request: Request): void {
  let fallbackHost = ''
  try {
    fallbackHost = new URL(request.url).host
  } catch {
    fallbackHost = ''
  }
  const expectedHost = (request.headers.get('host') || fallbackHost).trim()
  validateCommonSecurityHeaders({
    method: request.method.toUpperCase(),
    dshSqlHeader: request.headers.get('x-dsh-sql') ?? undefined,
    secFetchSite: request.headers.get('sec-fetch-site') ?? undefined,
    origin: request.headers.get('origin') ?? undefined,
    expectedHost,
    contentType: request.headers.get('content-type') ?? undefined,
  })
}

function strictSingleHeader(raw: string | string[] | undefined, headerName: string): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw) && raw.length === 1) return raw[0]
  throw new SqlSettingsError('检测到重复的请求头：' + headerName, 403, 'origin')
}

function loopbackRequestGuard(req: IncomingMessage): void {
  const remote = (req.socket?.remoteAddress ?? '').toLowerCase()
  if (!LOOPBACK_ADDRS.has(remote)) {
    throw new SqlSettingsError('设置面板仅允许本机访问。', 403, 'local_only')
  }
  const host = strictSingleHeader(req.headers.host, 'host')?.trim() ?? ''
  if (!host) {
    throw new SqlSettingsError('设置面板仅允许本机访问。', 403, 'local_only')
  }
  let target: URL
  try {
    target = new URL('http://' + host)
  } catch {
    throw new SqlSettingsError('无效的请求地址。', 403, 'local_only')
  }
  if (
    !LOOPBACK_HOSTS.has(target.hostname.toLowerCase())
    || target.username
    || target.password
    || target.pathname !== '/'
    || target.search
    || target.hash
  ) {
    throw new SqlSettingsError('设置面板仅允许本机访问。', 403, 'local_only')
  }
  validateCommonSecurityHeaders({
    method: (req.method ?? '').toUpperCase(),
    dshSqlHeader: strictSingleHeader(req.headers['x-dsh-sql'], 'x-dsh-sql'),
    secFetchSite: strictSingleHeader(req.headers['sec-fetch-site'], 'sec-fetch-site'),
    origin: strictSingleHeader(req.headers.origin, 'origin'),
    expectedHost: host,
    contentType: strictSingleHeader(req.headers['content-type'], 'content-type'),
  })
}

function parseJsonObjectBody(rawText: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(rawText)
  } catch {
    throw new SqlSettingsError('请求内容不是有效的 JSON。', 400, 'invalid_json')
  }
  if (!isPlainObject(value)) {
    throw new SqlSettingsError('请求内容必须是 JSON 对象。', 400, 'invalid_json')
  }
  return value
}

async function readWebBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader()
  if (!reader) {
    throw new SqlSettingsError('请求内容不是有效的 JSON。', 400, 'invalid_json')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      request.signal?.throwIfAborted?.()
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {})
          throw new SqlSettingsError('请求内容超过 256 KiB 上限。', 413, 'body_too_large')
        }
        chunks.push(value)
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Stream may already be cancelled/closed.
    }
  }
  return parseJsonObjectBody(Buffer.concat(chunks).toString('utf8'))
}

function readNodeBody(req: IncomingMessage, signal: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let length = 0
    const chunks: Buffer[] = []
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    const fail = (reason: unknown) => {
      cleanup()
      reject(reason)
    }
    const onData = (chunk: Buffer | Uint8Array | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += buf.length
      if (length > MAX_BODY_BYTES) {
        chunks.length = 0
        fail(new SqlSettingsError('请求内容超过 256 KiB 上限。', 413, 'body_too_large'))
        req.resume()
        return
      }
      chunks.push(buf)
    }
    const onError = (err: Error) => fail(err)
    const onAbort = () => fail(signal.reason ?? new Error('请求已取消'))
    const onEnd = () => {
      cleanup()
      try {
        resolve(parseJsonObjectBody(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err)
      }
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function parseOptionalPort(rawPort: unknown): number | undefined {
  if (rawPort === undefined || rawPort === null || rawPort === '') return undefined
  if (typeof rawPort === 'number') {
    if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
      throw new SqlSettingsError('连接端口号必须是 1–65535 的整数。', 400, 'invalid')
    }
    return rawPort
  }
  if (typeof rawPort === 'string') {
    const trimmed = rawPort.trim()
    if (trimmed === '') return undefined
    if (!/^\d+$/.test(trimmed)) {
      throw new SqlSettingsError('连接端口号必须是 1–65535 的整数。', 400, 'invalid')
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new SqlSettingsError('连接端口号必须是 1–65535 的整数。', 400, 'invalid')
    }
    return parsed
  }
  throw new SqlSettingsError('连接端口号必须是 1–65535 的整数。', 400, 'invalid')
}

function optionalTextField(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key]
  if (val === undefined || val === null) return undefined
  if (typeof val !== 'string') {
    throw new SqlSettingsError(`连接字段 ${key} 必须是字符串。`, 400, 'invalid')
  }
  const trimmed = val.trim()
  return trimmed !== '' ? trimmed : undefined
}

function normalizeDraftConnection(
  rawInput: Record<string, unknown>,
  options: {
    existingPassword: string
    clearPassword: boolean
    fallbackName?: string
  },
): { validationCandidate: SqlConnectionConfig; clearPassword: boolean } {
  const rawName = rawInput.name
  if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') {
    throw new SqlSettingsError('连接名称（name）必须是字符串。', 400, 'invalid')
  }
  const trimmedName = typeof rawName === 'string' ? rawName.trim() : ''
  const name = trimmedName !== '' ? trimmedName : (options.fallbackName ?? '')

  const rawEngine = rawInput.engine
  const engine = (typeof rawEngine === 'string' ? rawEngine.trim().toLowerCase() : rawEngine) as SqlConnectionConfig['engine']

  const url = optionalTextField(rawInput, 'url')
  const file = optionalTextField(rawInput, 'file')
  const host = optionalTextField(rawInput, 'host')
  const port = parseOptionalPort(rawInput.port)
  const user = optionalTextField(rawInput, 'user')
  const database = optionalTextField(rawInput, 'database')
  const directPassword = optionalTextField(rawInput, 'password') ?? ''

  if (rawInput.readOnly !== undefined && typeof rawInput.readOnly !== 'boolean') {
    throw new SqlSettingsError('连接字段 readOnly 必须是布尔值。', 400, 'invalid')
  }

  let ssl: SqlSslOption | undefined
  if (rawInput.ssl !== undefined && rawInput.ssl !== null && !(typeof rawInput.ssl === 'string' && rawInput.ssl.trim() === '')) {
    ssl = rawInput.ssl as SqlSslOption
  }

  const candidate: SqlConnectionConfig = {
    name,
    engine,
    ...(url !== undefined ? { url } : {}),
    ...(file !== undefined ? { file } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(database !== undefined ? { database } : {}),
    ...(rawInput.readOnly === true ? { readOnly: true } : {}),
    ...(ssl !== undefined ? { ssl } : {}),
  }

  if (engine !== 'sqlite') {
    const urlPassword = extractUrlPassword(url)
    if (options.clearPassword) {
      // Explicit clearPassword clears stored password; keep url for syntax validation only, stripped upon persist.
    } else if (directPassword !== '') {
      candidate.password = directPassword
    } else if (urlPassword !== '') {
      // Password comes from url; resolveConfig will parse and extract it.
    } else if (options.existingPassword !== '') {
      candidate.password = options.existingPassword
    }
  }

  return { validationCandidate: candidate, clearPassword: options.clearPassword }
}

function toPersistedConnection(
  validationCandidate: SqlConnectionConfig,
  clearPassword: boolean,
): SqlConnectionConfig {
  // Resolve with an EMPTY env so runtime env vars are never copied into persisted config!
  const resolvedNoEnv = resolveConfig({ connections: [validationCandidate] }, {}).connections[0]
  if (resolvedNoEnv.engine === 'sqlite') {
    return {
      name: resolvedNoEnv.name,
      engine: 'sqlite',
      file: resolvedNoEnv.file ?? ':memory:',
      ...(resolvedNoEnv.readOnly === true ? { readOnly: true } : {}),
    }
  }
  const password = clearPassword ? '' : (resolvedNoEnv.password ?? '')
  return {
    name: resolvedNoEnv.name,
    engine: resolvedNoEnv.engine,
    host: resolvedNoEnv.host ?? 'localhost',
    port: resolvedNoEnv.port ?? (resolvedNoEnv.engine === 'postgres' ? 5432 : 3306),
    ...(resolvedNoEnv.user ? { user: resolvedNoEnv.user } : {}),
    ...(password !== '' ? { password } : {}),
    database: resolvedNoEnv.database ?? '',
    ...(resolvedNoEnv.readOnly === true ? { readOnly: true } : {}),
    ...(resolvedNoEnv.ssl !== undefined ? { ssl: cloneSsl(resolvedNoEnv.ssl) } : {}),
  }
}

function toJsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(extraHeaders ?? {}),
    },
  })
}

/**
 * 构建 dsh-sql 设置面板后端：提供 snapshot()、fetch(Request) 与 handle(req, res)。
 */
export function createSqlSettingsBackend(
  ctx: SqlSettingsContext | null | undefined,
  config?: SqlConfig | null | (() => SqlConfig | null | undefined),
  options: SqlSettingsBackendOptions = {},
): SqlSettingsBackend {
  const env = options.env ?? process.env
  const entryId = entryIdOf(ctx, options.entryId ?? 'sql')
  const adapterFactory = options.createAdapter ?? createAdapter
  const testTimeoutMs = Math.max(50, options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS)
  const staticLive = typeof config === 'function' ? undefined : liveConfig((config ?? {}) as SqlConfig)

  const readLiveRawConfig = (): SqlConfig => {
    const source = typeof config === 'function'
      ? liveConfig((config() ?? {}) as SqlConfig)
      : (staticLive as SqlConfig)
    const raw: SqlConfig = {}
    if (source.connections !== undefined) raw.connections = source.connections
    if (source.maxRows !== undefined) raw.maxRows = source.maxRows
    if (source.readOnly !== undefined) raw.readOnly = source.readOnly
    if (source.writeApproval !== undefined) raw.writeApproval = source.writeApproval
    if (source.queryTimeoutMs !== undefined) raw.queryTimeoutMs = source.queryTimeoutMs
    if (source.execTimeoutMs !== undefined) raw.execTimeoutMs = source.execTimeoutMs
    if (source.redactColumns !== undefined) raw.redactColumns = source.redactColumns
    return raw
  }

  const rawConnectionsOf = (raw: SqlConfig): SqlConnectionConfig[] => {
    if (!Array.isArray(raw.connections)) return []
    return raw.connections
      .filter((item): item is SqlConnectionConfig => typeof item === 'object' && item !== null)
      .map((item) => cloneConnection(item))
  }

  const getProvider = (): SqlHostSettingsProvider | undefined => settingsProviderOf(ctx, options.getProvider)

  const isWritable = (): boolean => {
    if (options.writable !== undefined) return options.writable() !== false
    return providerCanWrite(getProvider())
  }

  const computeRevision = (raw: SqlConfig): string => {
    const hostRev = hostRevisionOf(getProvider(), entryId)
    return createHash('sha256')
      .update(stableStringify({ hostRev: hostRev ?? null, config: raw }))
      .digest('hex')
      .slice(0, 24)
  }

  const collectKnownSecrets = (extraConn?: Record<string, unknown>): Set<string> => {
    const secrets = new Set<string>()
    try {
      const raw = readLiveRawConfig()
      for (const conn of rawConnectionsOf(raw)) {
        if (typeof conn.password === 'string' && conn.password.trim() !== '') {
          secrets.add(conn.password.trim())
        }
        collectRawUrlPasswords(conn.url, secrets)
        if (typeof conn.name === 'string' && conn.name.trim() !== '') {
          const envPw = env[passwordEnvName(conn.name.trim())]?.trim()
          if (envPw) secrets.add(envPw)
        }
      }
    } catch {
      // Best-effort secret collection.
    }
    if (extraConn) {
      if (typeof extraConn.password === 'string' && extraConn.password.trim() !== '') {
        secrets.add(extraConn.password.trim())
      }
      collectRawUrlPasswords(extraConn.url, secrets)
      if (typeof extraConn.name === 'string' && extraConn.name.trim() !== '') {
        const envPw = env[passwordEnvName(extraConn.name.trim())]?.trim()
        if (envPw) secrets.add(envPw)
      }
    }
    return secrets
  }

  const snapshot = (): SqlSettingsSnapshot => {
    const raw = readLiveRawConfig()
    const resolved = resolveConfig(raw, env)
    const resolvedNoEnv = resolveConfig(raw, {})
    const implicitMemoryDefault = resolved.implicitMemoryDefault === true

    const connections: SqlSettingsConnectionView[] = implicitMemoryDefault
      ? []
      : resolved.connections.map((conn, idx) => {
        const noEnvConn = resolvedNoEnv.connections[idx]
        const envVar = passwordEnvName(conn.name)
        const readOnly = conn.readOnly === true
        if (conn.engine === 'sqlite') {
          return {
            name: conn.name,
            engine: 'sqlite',
            file: conn.file ?? ':memory:',
            readOnly,
            hasPassword: false,
            passwordSource: 'none',
            passwordEnvVar: envVar,
          }
        }
        const hasConfigPassword = (noEnvConn?.password ?? '') !== ''
        const hasEnvPassword = (env[envVar]?.trim() ?? '') !== ''
        const passwordSource: 'config' | 'env' | 'none' = hasConfigPassword
          ? 'config'
          : (hasEnvPassword ? 'env' : 'none')
        const view: SqlSettingsConnectionView = {
          name: conn.name,
          engine: conn.engine,
          host: conn.host ?? 'localhost',
          port: conn.port ?? (conn.engine === 'postgres' ? 5432 : 3306),
          user: conn.user ?? '',
          database: conn.database ?? '',
          readOnly,
          ...(conn.ssl !== undefined ? { ssl: cloneSsl(conn.ssl) } : {}),
          hasPassword: passwordSource !== 'none',
          passwordSource,
          passwordEnvVar: envVar,
        }
        return view
      })

    let redactMode: 'off' | 'builtin' | 'custom' = 'off'
    if (raw.redactColumns === true) {
      redactMode = 'builtin'
    } else if (Array.isArray(raw.redactColumns) && resolved.redactColumns.length > 0) {
      redactMode = 'custom'
    }

    return {
      revision: computeRevision(raw),
      writable: isWritable(),
      implicitMemoryDefault,
      connections,
      guardrails: {
        maxRows: resolved.maxRows,
        readOnly: resolved.readOnly,
        writeApproval: resolved.writeApproval,
        queryTimeoutMs: resolved.queryTimeoutMs,
        execTimeoutMs: resolved.execTimeoutMs,
        redactMode,
        redactColumns: [...resolved.redactColumns],
      },
    }
  }

  const persistPatch = async (patch: Partial<SqlConfig>, currentRaw: SqlConfig): Promise<void> => {
    const provider = getProvider()
    if (!providerCanWrite(provider)) {
      throw new SqlSettingsError('当前配置为只读，无法保存设置。', 403, 'readonly')
    }
    const p = provider!
    const hostRev = hostRevisionOf(p, entryId)
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined)
    try {
      if (typeof p.mutate === 'function' && hostRev !== undefined) {
        const ops: SqlSettingsMutateOp[] = entries.map(([key, value]) => ({
          op: 'set',
          path: [key],
          value,
        }))
        await p.mutate(entryId, ops, hostRev)
      } else if (typeof p.update === 'function') {
        await p.update(entryId, Object.fromEntries(entries))
      } else if (typeof p.replace === 'function') {
        const descriptor = findDescriptor(p, entryId)
        const baseDoc: Record<string, unknown> = isPlainObject(descriptor?.user) ? { ...descriptor.user } : {}
        for (const key of CONFIG_KEYS) {
          if (currentRaw[key] !== undefined) baseDoc[key] = currentRaw[key]
        }
        const nextDoc: Record<string, unknown> = { ...baseDoc, ...Object.fromEntries(entries) }
        await p.replace(entryId, nextDoc, hostRev ?? 0)
      } else if (typeof p.mutate === 'function') {
        const ops: SqlSettingsMutateOp[] = entries.map(([key, value]) => ({
          op: 'set',
          path: [key],
          value,
        }))
        await p.mutate(entryId, ops, 0)
      } else {
        throw new SqlSettingsError('当前宿主不支持保存设置。', 403, 'readonly')
      }
    } catch (error) {
      if (error instanceof SqlSettingsError) throw error
      const code = (error as { code?: unknown })?.code
      if (code === 'SETTINGS_CONFLICT' || code === 'conflict') {
        throw new SqlSettingsError('配置已被其他操作修改，请刷新后再保存。', 409, 'conflict')
      }
      throw error
    }
  }

  // Serialize concurrent mutations so two simultaneous writes cannot bypass optimistic locking.
  let writeTail: Promise<void> = Promise.resolve()
  const runSerializedWrite = async <T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> => {
    const prev = writeTail
    let release!: () => void
    writeTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await prev
    try {
      signal?.throwIfAborted()
      return await work()
    } finally {
      release()
    }
  }

  const assertWritableAndRevision = (body: Record<string, unknown>, currentRaw: SqlConfig): void => {
    if (!isWritable()) {
      throw new SqlSettingsError('当前配置为只读，无法保存修改。', 403, 'readonly')
    }
    const revision = typeof body.revision === 'string' ? body.revision.trim() : ''
    const currentRevision = computeRevision(currentRaw)
    if (revision === '' || revision !== currentRevision) {
      throw new SqlSettingsError('配置已经变化，请刷新后再保存。', 409, 'conflict')
    }
  }

  const handleSaveConnection = async (
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ saved: string }> => {
    return await runSerializedWrite(signal, async () => {
      const currentRaw = readLiveRawConfig()
      assertWritableAndRevision(body, currentRaw)
      if (!isPlainObject(body.connection)) {
        throw new SqlSettingsError('缺少连接配置（connection）。', 400, 'invalid')
      }
      const existingList = rawConnectionsOf(currentRaw)
      const originalName = typeof body.originalName === 'string' && body.originalName.trim() !== ''
        ? body.originalName.trim()
        : undefined
      let existingIndex = -1
      if (originalName !== undefined) {
        existingIndex = existingList.findIndex(
          (item) => typeof item.name === 'string' && item.name.trim().toLowerCase() === originalName.toLowerCase(),
        )
        if (existingIndex === -1) {
          throw new SqlSettingsError('未找到该连接：' + originalName, 404, 'not_found')
        }
      }
      const existingConn = existingIndex >= 0 ? existingList[existingIndex] : undefined
      const existingPassword = extractConfigPassword(existingConn)
      const clearPassword = body.clearPassword === true

      const { validationCandidate } = normalizeDraftConnection(body.connection, {
        existingPassword,
        clearPassword,
      })

      const validationList = existingIndex >= 0
        ? existingList.map((item, idx) => (idx === existingIndex ? validationCandidate : item))
        : [...existingList, validationCandidate]

      // Validate the full resulting SqlConfig BEFORE persisting anything!
      try {
        resolveConfig({ ...currentRaw, connections: validationList }, env)
      } catch (error) {
        throw new SqlSettingsError(extractErrorMessage(error), 400, 'invalid')
      }

      const persistedConn = toPersistedConnection(validationCandidate, clearPassword)
      const nextConnections = existingIndex >= 0
        ? existingList.map((item, idx) => (idx === existingIndex ? persistedConn : item))
        : [...existingList, persistedConn]

      // Double-check the normalized persisted list also passes resolveConfig cleanly.
      try {
        resolveConfig({ ...currentRaw, connections: nextConnections }, env)
      } catch (error) {
        throw new SqlSettingsError(extractErrorMessage(error), 400, 'invalid')
      }

      signal?.throwIfAborted()
      await persistPatch({ connections: nextConnections }, currentRaw)
      return { saved: persistedConn.name }
    })
  }

  const handleRemoveConnection = async (
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ removed: string }> => {
    return await runSerializedWrite(signal, async () => {
      const currentRaw = readLiveRawConfig()
      assertWritableAndRevision(body, currentRaw)
      const targetName = typeof body.name === 'string' ? body.name.trim() : ''
      if (targetName === '') {
        throw new SqlSettingsError('请指定要删除的连接名。', 400, 'invalid')
      }
      const existingList = rawConnectionsOf(currentRaw)
      const idx = existingList.findIndex(
        (item) => typeof item.name === 'string' && item.name.trim().toLowerCase() === targetName.toLowerCase(),
      )
      if (idx === -1) {
        throw new SqlSettingsError('未找到该连接', 404, 'not_found')
      }
      const removedName = existingList[idx].name
      const nextConnections = existingList.filter((_, i) => i !== idx)
      try {
        resolveConfig({ ...currentRaw, connections: nextConnections }, env)
      } catch (error) {
        throw new SqlSettingsError(extractErrorMessage(error), 400, 'invalid')
      }
      signal?.throwIfAborted()
      await persistPatch({ connections: nextConnections }, currentRaw)
      return { removed: removedName }
    })
  }

  const handleTestConnection = async (
    body: Record<string, unknown>,
    outerSignal: AbortSignal | undefined,
  ): Promise<{ test: SqlSettingsTestResult }> => {
    const currentRaw = readLiveRawConfig()
    const existingList = rawConnectionsOf(currentRaw)
    const secrets = collectKnownSecrets(isPlainObject(body.connection) ? body.connection : undefined)

    let targetConn: SqlConnectionConfig
    if (isPlainObject(body.connection)) {
      const lookupName = (typeof body.originalName === 'string' && body.originalName.trim() !== ''
        ? body.originalName.trim()
        : undefined)
        ?? (typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : undefined)
        ?? (typeof body.connection.name === 'string' && body.connection.name.trim() !== '' ? body.connection.name.trim() : undefined)
      const existingConn = lookupName !== undefined
        ? existingList.find(
          (item) => typeof item.name === 'string' && item.name.trim().toLowerCase() === lookupName.toLowerCase(),
        )
        : undefined
      const existingPassword = extractConfigPassword(existingConn)
      if (existingPassword !== '') secrets.add(existingPassword)
      const clearPassword = body.clearPassword === true
      const { validationCandidate } = normalizeDraftConnection(body.connection, {
        existingPassword,
        clearPassword,
        fallbackName: lookupName ?? '__draft__',
      })
      try {
        targetConn = resolveConfig({ connections: [validationCandidate] }, env).connections[0]
      } catch (error) {
        throw new SqlSettingsError(redactSecrets(extractErrorMessage(error), secrets), 400, 'invalid')
      }
      if (clearPassword && targetConn.engine !== 'sqlite' && typeof validationCandidate.url === 'string') {
        const envPw = env[passwordEnvName(targetConn.name)]?.trim() ?? ''
        targetConn = { ...targetConn, password: envPw }
      }
    } else {
      const targetName = typeof body.name === 'string' ? body.name.trim() : ''
      if (targetName === '') {
        throw new SqlSettingsError('请提供要测试的连接名或连接草稿。', 400, 'invalid')
      }
      const resolved = resolveConfig(currentRaw, env)
      const matched = resolved.connections.find(
        (item) => item.name.toLowerCase() === targetName.toLowerCase(),
      )
      if (matched === undefined) {
        throw new SqlSettingsError('未找到该连接', 404, 'not_found')
      }
      targetConn = matched
    }

    if (typeof targetConn.password === 'string' && targetConn.password !== '') {
      secrets.add(targetConn.password)
    }

    outerSignal?.throwIfAborted()
    const controller = new AbortController()
    let timedOut = false
    const onOuterAbort = () => controller.abort(outerSignal!.reason)
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      controller.abort(err)
    }, testTimeoutMs)

    const t0 = performance.now()
    let adapter: DatabaseAdapter | undefined
    try {
      // Always open temporary test adapters in readOnly mode for safety!
      adapter = adapterFactory(targetConn, { readOnly: true })
      await adapter.ping(controller.signal)
      let tableCount: number | undefined
      try {
        const tables = await adapter.listTables(controller.signal)
        tableCount = tables.length
      } catch {
        // Best-effort only: ping already proved connectivity.
      }
      const durationMs = Math.max(0, Math.round(performance.now() - t0))
      return {
        test: {
          ok: true,
          durationMs,
          ...(tableCount !== undefined ? { tableCount } : {}),
        },
      }
    } catch (error) {
      if (outerSignal?.aborted && !timedOut) {
        throw error
      }
      const durationMs = Math.max(0, Math.round(performance.now() - t0))
      const annotated = annotateError(new Error(extractErrorMessage(error))).message
      return {
        test: {
          ok: false,
          durationMs,
          error: redactSecrets(annotated, secrets),
        },
      }
    } finally {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onOuterAbort)
      if (adapter !== undefined) {
        await adapter.close().catch(() => {})
      }
    }
  }

  const handleSaveGuardrails = async (
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ saved: true }> => {
    return await runSerializedWrite(signal, async () => {
      const currentRaw = readLiveRawConfig()
      assertWritableAndRevision(body, currentRaw)
      const currentResolved = resolveConfig(currentRaw, env)

      if (body.readOnly !== undefined && typeof body.readOnly !== 'boolean') {
        throw new SqlSettingsError('readOnly 必须是布尔值。', 400, 'invalid')
      }
      if (body.writeApproval !== undefined && typeof body.writeApproval !== 'boolean') {
        throw new SqlSettingsError('writeApproval 必须是布尔值。', 400, 'invalid')
      }

      const rawMaxRows = body.maxRows !== undefined ? body.maxRows : currentResolved.maxRows
      const rawReadOnly = body.readOnly !== undefined ? body.readOnly : currentResolved.readOnly
      const rawWriteApproval = body.writeApproval !== undefined ? body.writeApproval : currentResolved.writeApproval
      const rawQueryTimeoutMs = body.queryTimeoutMs !== undefined ? body.queryTimeoutMs : currentResolved.queryTimeoutMs
      const rawExecTimeoutMs = body.execTimeoutMs !== undefined ? body.execTimeoutMs : currentResolved.execTimeoutMs
      const rawRedactColumns = body.redactColumns !== undefined
        ? body.redactColumns
        : (currentRaw.redactColumns !== undefined ? currentRaw.redactColumns : false)

      const candidateConfig: SqlConfig = {
        ...currentRaw,
        maxRows: rawMaxRows as number,
        readOnly: rawReadOnly,
        writeApproval: rawWriteApproval,
        queryTimeoutMs: rawQueryTimeoutMs as number,
        execTimeoutMs: rawExecTimeoutMs as number,
        redactColumns: rawRedactColumns as boolean | string[],
      }

      let resolvedCandidate
      try {
        resolvedCandidate = resolveConfig(candidateConfig, env)
      } catch (error) {
        throw new SqlSettingsError(extractErrorMessage(error), 400, 'invalid')
      }

      let persistedRedactColumns: boolean | string[]
      if (rawRedactColumns === true) {
        persistedRedactColumns = true
      } else if (Array.isArray(rawRedactColumns) && resolvedCandidate.redactColumns.length > 0) {
        persistedRedactColumns = [...resolvedCandidate.redactColumns]
      } else {
        persistedRedactColumns = false
      }

      const patch: Partial<SqlConfig> = {
        maxRows: resolvedCandidate.maxRows,
        readOnly: resolvedCandidate.readOnly,
        writeApproval: resolvedCandidate.writeApproval,
        queryTimeoutMs: resolvedCandidate.queryTimeoutMs,
        execTimeoutMs: resolvedCandidate.execTimeoutMs,
        redactColumns: persistedRedactColumns,
      }

      signal?.throwIfAborted()
      await persistPatch(patch, currentRaw)
      return { saved: true }
    })
  }

  const dispatch = async (
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> => {
    const action = typeof body.action === 'string' ? body.action.trim() : ''
    if (action === 'saveConnection') return await handleSaveConnection(body, signal)
    if (action === 'removeConnection') return await handleRemoveConnection(body, signal)
    if (action === 'testConnection') return await handleTestConnection(body, signal)
    if (action === 'saveGuardrails') return await handleSaveGuardrails(body, signal)
    throw new SqlSettingsError('未知的操作。', 400, 'invalid_action')
  }

  const formatErrorPayload = (error: unknown, includeSnapshot: boolean): { status: number; payload: Record<string, unknown>; extraHeaders?: Record<string, string> } => {
    const status = error instanceof SqlSettingsError ? error.status : 400
    const code = error instanceof SqlSettingsError ? error.code : 'invalid'
    const secrets = collectKnownSecrets()
    const message = redactSecrets(extractErrorMessage(error), secrets)
    let state: SqlSettingsSnapshot | undefined
    if (includeSnapshot) {
      try {
        state = snapshot()
      } catch {
        // Malformed saved config must not hide the original error.
      }
    }
    const payload: Record<string, unknown> = {
      error: message,
      code,
      ...(state !== undefined ? { snapshot: state } : {}),
    }
    return {
      status,
      payload,
      ...(status === 405 ? { extraHeaders: { Allow: 'GET, POST' } } : {}),
    }
  }

  return {
    snapshot,

    /** 由宿主认证连接管线（/api/dsh-sql/settings）调用。 */
    async fetch(request: Request): Promise<Response> {
      try {
        carrierGuard(request)
      } catch (error) {
        const { status, payload, extraHeaders } = formatErrorPayload(error, false)
        return toJsonResponse(status, payload, extraHeaders)
      }
      try {
        request.signal?.throwIfAborted?.()
        if (request.method.toUpperCase() === 'GET') {
          return toJsonResponse(200, { snapshot: snapshot() })
        }
        const body = await readWebBody(request)
        const result = await dispatch(body, request.signal)
        request.signal?.throwIfAborted?.()
        return toJsonResponse(200, { ...result, snapshot: snapshot() })
      } catch (error) {
        if (request.signal?.aborted) throw error
        const { status, payload, extraHeaders } = formatErrorPayload(error, true)
        return toJsonResponse(status, payload, extraHeaders)
      }
    },

    /** 由已通过宿主连接认证的 webServer 包装器调用，额外强制本机回环校验。 */
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const controller = new AbortController()
      const onAbort = () => {
        if (!res.writableFinished) controller.abort(new Error('请求已取消'))
      }
      req.on('aborted', onAbort)
      res.on('close', onAbort)
      const send = (status: number, value: unknown, extraHeaders?: Record<string, string>) => {
        if (res.destroyed) return
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...(extraHeaders ?? {}),
        })
        res.end(JSON.stringify(value))
      }
      let guarded = false
      try {
        loopbackRequestGuard(req)
        guarded = true
        if ((req.method ?? '').toUpperCase() === 'GET') {
          send(200, { snapshot: snapshot() })
        } else {
          const body = await readNodeBody(req, controller.signal)
          const result = await dispatch(body, controller.signal)
          if (!controller.signal.aborted) {
            send(200, { ...result, snapshot: snapshot() })
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const { status, payload, extraHeaders } = formatErrorPayload(error, guarded)
          send(status, payload, extraHeaders)
        }
      } finally {
        req.off('aborted', onAbort)
        res.off('close', onAbort)
      }
    },
  }
}

/**
 * 在宿主 connection（/api/dsh-sql/settings）与 webServer（/_dsh/dsh-sql/settings）上挂载设置路由。
 * 返回用于卸载全部路由的清理函数。
 */
export function installSqlSettingsWeb(
  ctx: { inject?: Function } | null | undefined,
  backend: SqlSettingsBackend,
): () => void {
  const disposers: Array<() => void> = []
  const track = (handle: unknown): void => {
    if (typeof handle === 'function') {
      let done = false
      disposers.push(() => {
        if (done) return
        done = true
        ;(handle as () => void)()
      })
    } else if (handle !== null && typeof handle === 'object' && typeof (handle as { dispose?: unknown }).dispose === 'function') {
      let done = false
      disposers.push(() => {
        if (done) return
        done = true
        ;(handle as { dispose(): void }).dispose()
      })
    }
  }

  if (typeof ctx?.inject === 'function') {
    track(ctx.inject(['connection'], (host: any) => {
      const mount = () => host?.connection?.fetch?.register?.({
        path: SQL_API_ROUTE,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: (request: Request) => backend.fetch(request),
      })
      if (typeof host?.effect === 'function') {
        host.effect(() => {
          const off = mount()
          return typeof off === 'function' ? off : undefined
        }, 'dsh-sql: api route')
      } else {
        track(mount())
      }
    }))

    track(ctx.inject(['webServer', 'connection'], (webCtx: any) => {
      const handleAuthenticated = (req: IncomingMessage, res: ServerResponse): Promise<void> | void => {
        // Loopback and X-DSH-SQL protect the request origin; neither proves that
        // the caller has authenticated to the host. Raw webServer routes bypass
        // the /api connection pipeline, so run the same host verifier here.
        let rejection: unknown = 403
        try {
          const connection = webCtx?.connection
          if (typeof connection?.requestRejection === 'function') {
            rejection = connection.requestRejection({ headers: req.headers ?? {} })
          }
        } catch {
          // A missing or failing verifier must never fall back to loopback-only access.
        }
        if (rejection !== undefined) {
          res.writeHead(rejection === 401 ? 401 : 403, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          res.end(JSON.stringify({ error: '请先通过 DSH 宿主认证。', code: 'unauthorized' }))
          return
        }
        return backend.handle(req, res)
      }
      const mount = () => webCtx?.webServer?.register?.({
        kind: 'exact',
        path: SQL_SETTINGS_ROUTE,
        handler: handleAuthenticated,
      })
      if (typeof webCtx?.effect === 'function') {
        webCtx.effect(() => {
          const off = mount()
          return typeof off === 'function' ? off : undefined
        }, 'dsh-sql: settings route')
      } else {
        track(mount())
      }
    }))
  }

  return () => {
    for (const off of disposers.splice(0)) off()
  }
}
