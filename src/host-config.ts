/**
 * 零外部依赖的宿主 Config Schema 与 liveConfig 活引用适配层（兼容 @deepseek-ai/schemastery 3.18+ 与 @deepseek-ai/cosmokit Volatile 协议）。
 *
 * 作用：
 *   1. 让 DSH 原生「设置 → 插件 → 数据库」自动渲染多连接可视化表单，对连接 password 启用凭据脱敏（role('secret')）；
 *   2. 顶层配置字段标记 volatile()，用户在设置面板保存后立即通过活引用生效并自动轮换变更的连接池，无需重启 DSH；
 *   3. 不向 package.json 引入额外 npm 依赖，离线构建 100% 自包含。
 *
 * @module dsh-sql/host-config
 */
import type { SqlConfig, SqlConnectionConfig, SqlSslOption } from './config.js'

const kSchema = Symbol.for('schemastery')
const kValidationError = Symbol.for('ValidationError')
const kVolatileWrite = Symbol.for('cosmokit.volatile.write')
const kCheckedVolatile = Symbol('checked-volatile-schema')

const globalState = globalThis as {
  __schemastery_index__?: number
  __schemastery_refs__?: Record<number, unknown>
}

export interface HostSchemaMeta {
  default?: unknown
  required?: boolean
  volatile?: boolean
  disabled?: boolean
  collapse?: boolean
  hidden?: boolean
  loose?: boolean
  role?: string
  extra?: unknown
  link?: string
  description?: string | Record<string, string>
  comment?: string
  pattern?: { source: string; flags?: string }
  max?: number
  min?: number
  step?: number
}

export interface HostSchemaOptions {
  autofix?: boolean
  ignore?: (data: unknown, schema: HostSchemaNode) => boolean
  path?: Array<string | number | symbol>
  [kCheckedVolatile]?: boolean
}

export interface VolatileRef<T = unknown> {
  get(): T
}

export interface HostSchemaNode<T = unknown> {
  (data?: unknown, options?: HostSchemaOptions): T
  readonly uid: number
  type: string
  meta: HostSchemaMeta
  dict?: Record<string, HostSchemaNode>
  inner?: HostSchemaNode
  list?: HostSchemaNode[]
  value?: unknown
  readonly '~standard': {
    version: 1
    vendor: 'schemastery'
    validate: (value: unknown) => { value: unknown } | { issues: Array<{ message: string; path?: Array<string | number | symbol> }> }
  }
  toJSON(): unknown
  toString(inline?: boolean): string
  simplify(value?: unknown): unknown
  i18n(messages: Record<string, unknown>): HostSchemaNode<T>
  extra(key: keyof HostSchemaMeta, value: unknown): HostSchemaNode<T>
  role(role: string, extra?: unknown): HostSchemaNode<T>
  description(text: string | Record<string, string>): HostSchemaNode<T>
  comment(text: string): HostSchemaNode<T>
  link(url: string): HostSchemaNode<T>
  default(value: unknown): HostSchemaNode<T>
  min(value: number): HostSchemaNode<T>
  max(value: number): HostSchemaNode<T>
  step(value: number): HostSchemaNode<T>
  pattern(regexp: RegExp): HostSchemaNode<T>
  volatile(): HostSchemaNode<VolatileRef<T>>
  required(value?: boolean): HostSchemaNode<T>
  hidden(value?: boolean): HostSchemaNode<T>
  disabled(value?: boolean): HostSchemaNode<T>
  collapse(value?: boolean): HostSchemaNode<T>
  loose(value?: boolean): HostSchemaNode<T>
  set(key: string, value: HostSchemaNode): HostSchemaNode<T>
  push(value: HostSchemaNode): HostSchemaNode<T>
}

export class HostValidationError extends TypeError {
  readonly options: HostSchemaOptions
  override name = 'ValidationError'
  constructor(message: string, options: HostSchemaOptions = {}) {
    let prefix = '$'
    for (const segment of options.path ?? []) {
      if (typeof segment === 'string') prefix += '.' + segment
      else if (typeof segment === 'number') prefix += '[' + segment + ']'
      else prefix += `[Symbol(${segment.toString()})]`
    }
    if (prefix.startsWith('.')) prefix = prefix.slice(1)
    super((prefix === '$' ? '' : `${prefix} `) + message)
    this.options = options
  }
  static is(error: unknown): error is HostValidationError {
    return typeof error === 'object' && error !== null && Boolean((error as Record<symbol, unknown>)[kValidationError])
  }
}
Object.defineProperty(HostValidationError.prototype, kValidationError, { value: true })

function isNullable(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isVolatile(value: unknown): value is VolatileRef<unknown> {
  return typeof value === 'object' && value !== null && kVolatileWrite in value
}

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneValue(v)])) as unknown as T
  }
  return value
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, idx) => deepEqual(item, b[idx]))
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
}

function snapshotValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (typeof value === 'function') throw new TypeError('volatile config cannot contain functions')
  if (value === null || typeof value !== 'object') return value
  if (ancestors.has(value)) throw new TypeError('volatile config cannot contain cycles')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshotValue(item, ancestors)))
    if (!isPlainObject(value)) throw new TypeError('volatile config objects must be plain objects or arrays')
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotValue(item, ancestors)])))
  } finally {
    ancestors.delete(value)
  }
}

export function createVolatile<T>(value: T): VolatileRef<T> {
  let current = snapshotValue(value) as T
  return Object.freeze({
    get: () => current,
    [kVolatileWrite]: (next: unknown) => { current = snapshotValue(next) as T },
  }) as VolatileRef<T>
}

function validateVolatileTree(schema: HostSchemaNode, path: Array<string | number | symbol> = [], blocked = false, seen = new Map<HostSchemaNode, Set<boolean>>()): void {
  const states = seen.get(schema) ?? new Set<boolean>()
  if (states.has(blocked)) return
  states.add(blocked)
  seen.set(schema, states)
  if (schema.meta?.volatile && blocked) {
    throw new HostValidationError('volatile fields require a fixed object path without an enclosing volatile field', { path })
  }
  const nested = blocked || Boolean(schema.meta?.volatile)
  if (schema.dict) {
    for (const [key, child] of Object.entries(schema.dict)) validateVolatileTree(child, [...path, key], nested, seen)
  }
  if (schema.inner) validateVolatileTree(schema.inner, [...path, '*'], true, seen)
  if (schema.list) {
    schema.list.forEach((child, idx) => validateVolatileTree(child, [...path, String(idx)], true, seen))
  }
}

function checkRange(value: number, meta: HostSchemaMeta, label: string, options: HostSchemaOptions, skipMin = false): void {
  const max = meta.max ?? Infinity
  const min = meta.min ?? -Infinity
  if (value > max) throw new HostValidationError(`expected ${label} <= ${max} but got ${value}`, options)
  if (value < min && !skipMin) throw new HostValidationError(`expected ${label} >= ${min} but got ${value}`, options)
}

function decimalShift(data: number, digits: number): number {
  const str = data.toString()
  if (str.includes('e')) return data * Math.pow(10, digits)
  const index = str.indexOf('.')
  if (index === -1) return data * Math.pow(10, digits)
  const frac = str.slice(index + 1)
  const integer = str.slice(0, index)
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, '0'))
  return +(integer + frac.slice(0, digits) + '.' + frac.slice(digits))
}

function isMultipleOf(data: number, min: number, step: number): boolean {
  const absStep = Math.abs(step)
  if (!/^\d+\.\d+$/.test(absStep.toString())) return (data - min) % absStep === 0
  const index = absStep.toString().indexOf('.')
  const digits = absStep.toString().slice(index + 1).length
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(absStep, digits) === 0
}

function resolveProperty(data: Record<string, unknown> | unknown[], key: string | number, schema: HostSchemaNode, options: HostSchemaOptions): unknown {
  const container = data as Record<string | number, unknown>
  try {
    const [value, adapted] = resolveSchema(container[key], schema, {
      ...options,
      path: [...(options.path ?? []), key],
    })
    if (adapted !== undefined) container[key] = adapted
    return value
  } catch (error) {
    if (!options.autofix) throw error
    delete container[key]
    return schema.meta.volatile ? createVolatile(schema.meta.default) : cloneValue(schema.meta.default)
  }
}

function resolveSchema(data: unknown, schema: HostSchemaNode | undefined, options: HostSchemaOptions = {}, strict = false): [unknown, unknown?] {
  if (!schema) return [data]
  if (!options[kCheckedVolatile]) {
    validateVolatileTree(schema, options.path)
    options = { ...options, [kCheckedVolatile]: true }
  }
  if (schema.meta?.volatile) {
    const inner = makeSchema({ ...schema, meta: { ...schema.meta, volatile: false } })
    const [value, adapted] = resolveSchema(data, inner, options, strict)
    try {
      return [createVolatile(value), adapted]
    } catch (error) {
      throw new HostValidationError(error instanceof Error ? error.message : String(error), options)
    }
  }
  if (options.ignore?.(data, schema)) return [data]
  if (isNullable(data)) {
    if (schema.meta.required) throw new HostValidationError('missing required value', options)
    if (isNullable(schema.meta.default)) return [data]
    data = cloneValue(schema.meta.default)
  }
  try {
    switch (schema.type) {
      case 'any':
        return [data]
      case 'const':
        if (deepEqual(data, schema.value)) return [schema.value]
        throw new HostValidationError(`expected ${String(schema.value)} but got ${String(data)}`, options)
      case 'string': {
        if (typeof data !== 'string') throw new HostValidationError(`expected string but got ${String(data)}`, options)
        if (schema.meta.pattern) {
          const re = new RegExp(schema.meta.pattern.source, schema.meta.pattern.flags)
          if (!re.test(data)) throw new HostValidationError(`expect string to match regexp ${String(re)}`, options)
        }
        checkRange(data.length, schema.meta, 'string length', options)
        return [data]
      }
      case 'number': {
        if (typeof data !== 'number' || !Number.isFinite(data)) throw new HostValidationError(`expected number but got ${String(data)}`, options)
        checkRange(data, schema.meta, 'number', options)
        const { step } = schema.meta
        if (step && !isMultipleOf(data, schema.meta.min ?? 0, step)) {
          throw new HostValidationError(`expected number multiple of ${step} but got ${data}`, options)
        }
        return [data]
      }
      case 'boolean':
        if (typeof data === 'boolean') return [data]
        throw new HostValidationError(`expected boolean but got ${String(data)}`, options)
      case 'array': {
        if (!Array.isArray(data) || !schema.inner) throw new HostValidationError(`expected array but got ${String(data)}`, options)
        checkRange(data.length, schema.meta, 'array length', options, !isNullable(schema.inner.meta.default))
        const copy = [...data]
        return [copy.map((_, idx) => resolveProperty(copy, idx, schema.inner!, options))]
      }
      case 'object': {
        if (!isPlainObject(data)) throw new HostValidationError(`expected object but got ${String(data)}`, options)
        const dict = schema.dict ?? {}
        const copy: Record<string, unknown> = { ...data }
        const result: Record<string, unknown> = {}
        for (const key of Object.keys(dict)) {
          const value = resolveProperty(copy, key, dict[key], options)
          if (!isNullable(value) || key in copy) result[key] = value
        }
        if (!strict) {
          for (const key of Object.keys(copy)) {
            if (!(key in result)) result[key] = copy[key]
          }
        }
        return [result]
      }
      case 'union': {
        for (const candidate of schema.list ?? []) {
          try {
            return resolveSchema(data, candidate, options, strict)
          } catch {
            // Try next union branch.
          }
        }
        throw new HostValidationError(`expected ${schema.toString()} but got ${JSON.stringify(data)}`, options)
      }
      default:
        throw new HostValidationError(`unsupported type "${schema.type}"`, options)
    }
  } catch (error) {
    if (!schema.meta.loose) throw error
    return [cloneValue(schema.meta.default)]
  }
}

function mergeDescriptions(original: HostSchemaMeta['description'], messages: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = typeof original === 'string' ? { '': original } : { ...(original ?? {}) }
  for (const [locale, entry] of Object.entries(messages)) {
    if (typeof entry === 'string') {
      result[locale] = entry
    } else if (isPlainObject(entry)) {
      const desc = entry.$description ?? entry.$desc
      if (typeof desc === 'string') result[locale] = desc
    }
  }
  return result
}

function extractNonDollarKeys(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('$')))
}

const schemaProto = Object.create(Function.prototype) as Record<string | symbol, unknown>
schemaProto[kSchema] = true

Object.defineProperty(schemaProto, '~standard', {
  get(this: HostSchemaNode) {
    return {
      version: 1 as const,
      vendor: 'schemastery' as const,
      validate: (value: unknown) => {
        try {
          return { value: resolveSchema(value, this, {})[0] }
        } catch (error) {
          if (HostValidationError.is(error)) {
            return { issues: [{ message: error.message, path: error.options.path }] }
          }
          throw error
        }
      },
    }
  },
})

schemaProto.toJSON = function toJSON(this: HostSchemaNode): unknown {
  if (globalState.__schemastery_refs__) {
    globalState.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }))
    return this.uid
  }
  globalState.__schemastery_refs__ = { [this.uid]: { ...this } }
  try {
    globalState.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }))
    return { uid: this.uid, refs: globalState.__schemastery_refs__ }
  } finally {
    globalState.__schemastery_refs__ = undefined
  }
}

schemaProto.toString = function toString(this: HostSchemaNode, inline = false): string {
  if (this.type === 'const') return typeof this.value === 'string' ? JSON.stringify(this.value) : String(this.value)
  if (this.type === 'array' && this.inner) return `${this.inner.toString(true)}[]`
  if (this.type === 'union' && this.list) {
    const joined = this.list.map((item) => item.toString()).join(' | ')
    return inline ? `(${joined})` : joined
  }
  if (this.type === 'object' && this.dict) {
    const entries = Object.entries(this.dict)
    if (entries.length === 0) return '{}'
    return `{ ${entries.map(([k, v]) => `${k}${v.meta.required ? '' : '?'}: ${v.toString()}`).join(', ')} }`
  }
  return this.type
}

schemaProto.simplify = function simplify(this: HostSchemaNode, raw?: unknown): unknown {
  const value = isVolatile(raw) ? raw.get() : raw
  if (deepEqual(value, this.meta.default)) return null
  if (isNullable(value)) return value
  if (this.type === 'object' && isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const simplified = this.dict?.[key] ? this.dict[key].simplify(item) : item
      if (!isNullable(simplified)) out[key] = simplified
    }
    return deepEqual(out, this.meta.default) ? null : out
  }
  if (this.type === 'array' && Array.isArray(value)) {
    return value.map((item) => (this.inner ? this.inner.simplify(item) : item))
  }
  return value
}

schemaProto.i18n = function i18n(this: HostSchemaNode, messages: Record<string, unknown>): HostSchemaNode {
  const cloned = makeSchema(this)
  const desc = mergeDescriptions(cloned.meta.description, messages)
  if (Object.keys(desc).length > 0) cloned.meta = { ...cloned.meta, description: desc }
  if (cloned.dict) {
    const nextDict: Record<string, HostSchemaNode> = {}
    for (const [key, child] of Object.entries(cloned.dict)) {
      const childMessages: Record<string, unknown> = {}
      for (const [locale, data] of Object.entries(messages)) {
        if (isPlainObject(data)) {
          const inner = isPlainObject(data.$value) ? data.$value : isPlainObject(data.$inner) ? data.$inner : data
          if (key in inner) childMessages[locale] = inner[key]
        }
      }
      nextDict[key] = child.i18n(childMessages)
    }
    cloned.dict = nextDict
  }
  if (cloned.inner) {
    const innerMessages: Record<string, unknown> = {}
    for (const [locale, data] of Object.entries(messages)) {
      if (isPlainObject(data)) {
        const inner = data.$value ?? data.$inner ?? extractNonDollarKeys(data)
        innerMessages[locale] = inner
      }
    }
    cloned.inner = cloned.inner.i18n(innerMessages)
  }
  return cloned
}

schemaProto.extra = function extra(this: HostSchemaNode, key: keyof HostSchemaMeta, value: unknown): HostSchemaNode {
  const cloned = makeSchema(this)
  cloned.meta = { ...cloned.meta, [key]: value }
  return cloned
}

schemaProto.role = function role(this: HostSchemaNode, name: string, extraValue?: unknown): HostSchemaNode {
  const cloned = makeSchema(this)
  cloned.meta = { ...cloned.meta, role: name, ...(extraValue !== undefined ? { extra: extraValue } : {}) }
  return cloned
}

for (const key of ['default', 'link', 'comment', 'description', 'max', 'min', 'step'] as const) {
  schemaProto[key] = function (this: HostSchemaNode, value: unknown): HostSchemaNode {
    return this.extra(key, value)
  }
}

for (const key of ['required', 'disabled', 'collapse', 'hidden', 'loose'] as const) {
  schemaProto[key] = function (this: HostSchemaNode, value = true): HostSchemaNode {
    return this.extra(key, value)
  }
}

schemaProto.pattern = function pattern(this: HostSchemaNode, regexp: RegExp): HostSchemaNode {
  return this.extra('pattern', { source: regexp.source, flags: regexp.flags })
}

schemaProto.volatile = function volatile(this: HostSchemaNode): HostSchemaNode {
  if (this.meta.volatile) throw new TypeError('volatile schema is already wrapped')
  return this.extra('volatile', true)
}

schemaProto.set = function set(this: HostSchemaNode, key: string, value: HostSchemaNode): HostSchemaNode {
  this.dict ??= {}
  this.dict[key] = value
  return this
}

schemaProto.push = function push(this: HostSchemaNode, value: HostSchemaNode): HostSchemaNode {
  this.list ??= []
  this.list.push(value)
  return this
}

function makeSchema<T = unknown>(init: Partial<HostSchemaNode<T>> & { type: string }): HostSchemaNode<T> {
  const fn = function (data?: unknown, options: HostSchemaOptions = {}): T {
    return resolveSchema(data, fn as unknown as HostSchemaNode, options)[0] as T
  } as unknown as HostSchemaNode<T>
  Object.assign(fn, {
    type: init.type,
    meta: { ...(init.meta ?? {}) },
    ...(init.dict ? { dict: { ...init.dict } } : {}),
    ...(init.inner ? { inner: init.inner } : {}),
    ...(init.list ? { list: [...init.list] } : {}),
    ...('value' in init ? { value: init.value } : {}),
  })
  globalState.__schemastery_index__ ??= 0
  Object.defineProperty(fn, 'uid', { value: globalState.__schemastery_index__++, enumerable: false })
  Object.setPrototypeOf(fn, schemaProto)
  fn.toString = fn.toString.bind(fn)
  return fn
}

function fromSource(source: unknown): HostSchemaNode {
  if (typeof source === 'function' && Boolean((source as unknown as Record<symbol, unknown>)[kSchema])) {
    return source as unknown as HostSchemaNode
  }
  if (typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') {
    return makeSchema({ type: 'const', value: source, meta: { required: true } })
  }
  throw new TypeError(`cannot infer schema from ${String(source)}`)
}

export const z = {
  string: () => makeSchema<string>({ type: 'string' }),
  number: () => makeSchema<number>({ type: 'number' }),
  boolean: () => makeSchema<boolean>({ type: 'boolean' }),
  const: <const V extends string | number | boolean>(value: V) => makeSchema<V>({ type: 'const', value }),
  union: <T = unknown>(list: readonly unknown[]) => makeSchema<T>({ type: 'union', list: list.map(fromSource) }),
  array: <T = unknown>(inner: HostSchemaNode<T>) => makeSchema<T[]>({ type: 'array', inner, meta: { default: [] } }),
  object: <T extends object = Record<string, unknown>>(dict: Record<string, HostSchemaNode>) =>
    makeSchema<T>({ type: 'object', dict, meta: { default: {} } }),
  ValidationError: HostValidationError,
}

const ConnectionSchema = z.object<SqlConnectionConfig>({
  name: z.string().required().description('连接名称（如 local / prod，用于多库切换与环境变量后缀）'),
  engine: z.union<'sqlite' | 'mysql' | 'postgres'>(['sqlite', 'mysql', 'postgres']).required()
    .description('数据库引擎：sqlite / mysql / postgres'),
  url: z.string()
    .description('可选连接 URI（postgres:// / postgresql:// / mysql:// / sqlite: / file:；显式字段优先；建议密码改用下方脱敏密码字段或环境变量）'),
  file: z.string().description('SQLite 数据库文件路径（或 :memory:）'),
  host: z.string().description('MySQL / PostgreSQL 主机地址（默认 localhost）'),
  port: z.number().min(1).max(65535).description('端口号（PostgreSQL 默认 5432，MySQL 默认 3306）'),
  user: z.string().description('数据库登录用户名'),
  password: z.string().role('secret')
    .description('数据库密码（自动脱敏；留空时自动读取环境变量 DSH_SQL_PASSWORD_<连接名大写>）'),
  database: z.string().description('MySQL / PostgreSQL 目标库名（必填，或在 url 中提供）'),
  readOnly: z.boolean()
    .description('单连接只读锁（开启后仅该连接禁止 sql_exec 写操作并以只读方式连接）'),
  ssl: z.union<SqlSslOption>([
    'disable',
    'allow',
    'prefer',
    'require',
    'verify-ca',
    'verify-full',
    z.boolean(),
    z.object({
      rejectUnauthorized: z.boolean().description('是否校验证书链与主机名'),
      ca: z.string().description('自定义 CA 根证书（PEM 文本）'),
    }),
  ])
    .description('TLS/SSL 连接配置（云数据库常用：disable / allow / prefer / require / verify-ca / verify-full、布尔值或 { rejectUnauthorized, ca } 对象）'),
})

export const Config: HostSchemaNode<SqlConfig> = z.object<SqlConfig>({
  connections: z.array(ConnectionSchema).volatile()
    .description('数据库连接列表（保存即生效；未配置时默认提供临时 :memory: SQLite 连接）'),
  maxRows: z.number().min(1).max(10000).default(1000).volatile()
    .description('单次只读查询最多返回行数（1–10000，默认 1000）'),
  readOnly: z.boolean().default(false).volatile()
    .description('全局只读开关（开启后禁用 sql_exec 并以只读方式连接数据库）'),
  writeApproval: z.boolean().default(true).volatile()
    .description('写操作审批门（默认开启；每次 sql_exec 前展示语句清单请求确认）'),
  queryTimeoutMs: z.number().min(5000).max(600000).default(60000).volatile()
    .description('单次只读查询超时毫秒数（默认 60000）'),
  execTimeoutMs: z.number().min(5000).max(600000).default(120000).volatile()
    .description('单次写操作超时毫秒数（默认 120000）'),
  redactColumns: z.union<boolean | string[]>([z.boolean(), z.array(z.string())]).default(false).volatile()
    .description('敏感列自动脱敏（false 关闭；true 启用内置 password/secret/token 等脱敏；或填列名子串与 /正则/ 数组）'),
}).i18n({
  zh: {
    $description: '数据库连接与查询安全护栏设置（保存立即生效，无需重启 DSH）',
    connections: {
      $description: '数据库连接列表（未添加时使用内置 :memory: SQLite 临时连接）',
      name: '连接名称（如 local / prod）',
      engine: '数据库引擎（sqlite / mysql / postgres）',
      url: '可选连接 URI（postgres:// / mysql:// / sqlite: / file:；建议密码通过下方脱敏字段或环境变量配置）',
      file: 'SQLite 文件路径（仅 sqlite 使用，如 E:\\data\\app.db 或 :memory:）',
      host: '数据库主机名或 IP（默认 localhost）',
      port: '端口号（PostgreSQL 默认 5432，MySQL 默认 3306）',
      user: '登录用户名',
      password: '登录密码（脱敏存储；留空则读取环境变量 DSH_SQL_PASSWORD_<连接名大写>）',
      database: '目标数据库名（mysql / postgres 必填，或在 url 中指定）',
      readOnly: '单连接只读锁（开启后该连接禁止 sql_exec 写操作）',
      ssl: 'TLS/SSL 模式（云数据库常用：disable / allow / prefer / require / verify-ca / verify-full）',
    },
    maxRows: '单次查询返回行数上限（1–10000，默认 1000）',
    readOnly: '只读模式（开启后彻底禁用 sql_exec 写操作）',
    writeApproval: '写操作前请求人工审批（默认开启）',
    queryTimeoutMs: '只读查询超时毫秒数（5000–600000，默认 60000）',
    execTimeoutMs: '写操作超时毫秒数（5000–600000，默认 120000）',
    redactColumns: '敏感列自动脱敏（true 启用内置密码/密钥/Token 脱敏；也可传入列名子串或 /正则/ 模式数组，默认关闭）',
  },
  en: {
    $description: 'Database connections and query safety guardrails (applied live on save)',
    connections: {
      $description: 'Database connections (uses an in-memory :memory: SQLite fallback when empty)',
      name: 'Connection name (e.g. local / prod)',
      engine: 'Database engine (sqlite / mysql / postgres)',
      url: 'Optional connection URI (postgres:// / mysql:// / sqlite: / file:; prefer the secret password field or env var for credentials)',
      file: 'SQLite file path (for sqlite only, or :memory:)',
      host: 'Server hostname or IP (defaults to localhost)',
      port: 'Server port (5432 for PostgreSQL, 3306 for MySQL)',
      user: 'Database username',
      password: 'Database password (masked; falls back to env var DSH_SQL_PASSWORD_<NAME>)',
      database: 'Database name (required for mysql / postgres, or via url)',
      readOnly: 'Per-connection read-only lock (disables sql_exec writes on this connection)',
      ssl: 'TLS/SSL mode for cloud databases (disable / allow / prefer / require / verify-ca / verify-full)',
    },
    maxRows: 'Max rows returned per read query (1–10000, default 1000)',
    readOnly: 'Read-only mode (disables sql_exec writes completely)',
    writeApproval: 'Require host approval before sql_exec writes (default on)',
    queryTimeoutMs: 'Read query timeout in ms (5000–600000, default 60000)',
    execTimeoutMs: 'Write execution timeout in ms (5000–600000, default 120000)',
    redactColumns: 'Sensitive column redaction (true enables built-in secret/password/token masking; or pass column substrings or /regex/ patterns, default off)',
  },
})

/** 活引用视图：同时兼容 DSH >=0.1.7 的 { get() } 活引用与旧宿主/测试传入的普通对象。 */
export function liveConfig<T extends object>(config: T): T {
  return new Proxy(config, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target as object, key, receiver)
      return value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
        ? (value as { get(): unknown }).get()
        : value
    },
  }) as T
}
