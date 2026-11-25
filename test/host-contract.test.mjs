import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  apply,
  buildSqlTools,
  Config,
  liveConfig,
  resolveConfig,
} from '../lib/index.js'

// ---------- Mirror of @deepseek-ai/dsh-tools JSON Schema contract ----------

const SCALAR_JSON_SCHEMA_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
])

const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
])

const ANNOTATION_KEYWORDS = new Set([
  'description',
  'title',
  'default',
  'examples',
])

const ALLOWED_KEYWORDS = new Set([
  ...CONSTRAINT_KEYWORDS,
  ...ANNOTATION_KEYWORDS,
])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unsupportedSchema(message) {
  const error = new Error(message)
  error.code = 'UNSUPPORTED_SCHEMA'
  return error
}

function assertJsonSchema(schema, path) {
  if (!isPlainObject(schema)) {
    throw unsupportedSchema(`${path}: schema must be a plain object`)
  }
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      throw unsupportedSchema(`${path}: unsupported JSON Schema keyword "${key}"`)
    }
  }
  if (Object.hasOwn(schema, 'description') && typeof schema.description !== 'string') {
    throw unsupportedSchema(`${path}.description: must be a string`)
  }
  if (Object.hasOwn(schema, 'title') && typeof schema.title !== 'string') {
    throw unsupportedSchema(`${path}.title: must be a string`)
  }
  if (Object.hasOwn(schema, 'examples') && !Array.isArray(schema.examples)) {
    throw unsupportedSchema(`${path}.examples: must be an array`)
  }

  if (Object.hasOwn(schema, 'oneOf')) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) {
      throw unsupportedSchema(`${path}.oneOf: must be a non-empty array`)
    }
    for (const key of Object.keys(schema)) {
      if (key !== 'oneOf' && CONSTRAINT_KEYWORDS.has(key)) {
        throw unsupportedSchema(`${path}: oneOf cannot be combined with sibling constraint keyword "${key}"`)
      }
    }
    schema.oneOf.forEach((branch, index) => {
      assertJsonSchema(branch, `${path}.oneOf[${index}]`)
    })
    return
  }

  if (Object.hasOwn(schema, 'type')) {
    if (typeof schema.type !== 'string' || !SCALAR_JSON_SCHEMA_TYPES.has(schema.type)) {
      throw unsupportedSchema(`${path}.type: must be a single scalar type string, got ${JSON.stringify(schema.type)}`)
    }
  }

  if (Object.hasOwn(schema, 'enum')) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      throw unsupportedSchema(`${path}.enum: must be a non-empty array`)
    }
  }

  if (Object.hasOwn(schema, 'properties')) {
    if (Object.hasOwn(schema, 'type') && schema.type !== 'object') {
      throw unsupportedSchema(`${path}.properties: requires type "object"`)
    }
    if (!isPlainObject(schema.properties)) {
      throw unsupportedSchema(`${path}.properties: must be a plain object`)
    }
    for (const [propKey, propSchema] of Object.entries(schema.properties)) {
      assertJsonSchema(propSchema, `${path}.properties.${propKey}`)
    }
  }

  if (Object.hasOwn(schema, 'required')) {
    if (Object.hasOwn(schema, 'type') && schema.type !== 'object') {
      throw unsupportedSchema(`${path}.required: requires type "object"`)
    }
    if (!Array.isArray(schema.required)) {
      throw unsupportedSchema(`${path}.required: must be an array of strings`)
    }
    const seen = new Set()
    for (const item of schema.required) {
      if (typeof item !== 'string' || item === '') {
        throw unsupportedSchema(`${path}.required: entries must be non-empty strings`)
      }
      if (seen.has(item)) {
        throw unsupportedSchema(`${path}.required: duplicate key "${item}"`)
      }
      seen.add(item)
    }
  }

  if (Object.hasOwn(schema, 'additionalProperties')) {
    if (Object.hasOwn(schema, 'type') && schema.type !== 'object') {
      throw unsupportedSchema(`${path}.additionalProperties: requires type "object"`)
    }
    if (typeof schema.additionalProperties !== 'boolean') {
      if (!isPlainObject(schema.additionalProperties)) {
        throw unsupportedSchema(`${path}.additionalProperties: must be boolean or schema object`)
      }
      assertJsonSchema(schema.additionalProperties, `${path}.additionalProperties`)
    }
  }

  if (Object.hasOwn(schema, 'items')) {
    if (Object.hasOwn(schema, 'type') && schema.type !== 'array') {
      throw unsupportedSchema(`${path}.items: requires type "array"`)
    }
    if (!isPlainObject(schema.items)) {
      throw unsupportedSchema(`${path}.items: must be a single schema object`)
    }
    assertJsonSchema(schema.items, `${path}.items`)
  }
}

function assertObjectJsonSchema(schema, label = 'schema') {
  assertJsonSchema(schema, label)
  if (schema.type !== 'object') {
    throw unsupportedSchema(`${label}: root schema must declare type "object", got ${JSON.stringify(schema.type)}`)
  }
}

function deepEqualJson(a, b) {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqualJson(item, b[index]))
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => Object.hasOwn(b, key) && deepEqualJson(a[key], b[key]))
}

function matchesScalarType(value, type) {
  switch (type) {
    case 'null': return value === null
    case 'boolean': return typeof value === 'boolean'
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'array': return Array.isArray(value)
    case 'object': return isPlainObject(value)
    default: return false
  }
}

function validateJsonSchemaValue(value, schema, path = '$') {
  const errors = []
  if (Object.hasOwn(schema, 'oneOf')) {
    let matches = 0
    for (const branch of schema.oneOf) {
      if (validateJsonSchemaValue(value, branch, path).length === 0) matches += 1
    }
    if (matches !== 1) {
      errors.push(`${path}: expected value ${JSON.stringify(value)} to match exactly 1 oneOf branch, matched ${matches}`)
    }
    return errors
  }

  if (Object.hasOwn(schema, 'const') && !deepEqualJson(value, schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`)
  }

  if (Object.hasOwn(schema, 'enum') && !schema.enum.some((entry) => deepEqualJson(value, entry))) {
    errors.push(`${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`)
  }

  if (Object.hasOwn(schema, 'type') && !matchesScalarType(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`)
    return errors
  }

  if (isPlainObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (!Object.hasOwn(value, reqKey) || value[reqKey] === undefined) {
          errors.push(`${path}: missing required property "${reqKey}"`)
        }
      }
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    for (const [key, propValue] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        errors.push(...validateJsonSchemaValue(propValue, properties[key], `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected additional property "${key}"`)
      } else if (isPlainObject(schema.additionalProperties)) {
        errors.push(...validateJsonSchemaValue(propValue, schema.additionalProperties, `${path}.${key}`))
      }
    }
  } else if (Array.isArray(value)) {
    if (isPlainObject(schema.items)) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchemaValue(item, schema.items, `${path}[${index}]`))
      })
    }
  }

  return errors
}

function assertValidJsonSchemaValue(value, schema, label) {
  const errors = validateJsonSchemaValue(value, schema)
  assert.deepEqual(errors, [], `${label} failed output/input schema validation:\n${errors.join('\n')}`)
}

function isSchemasteryMultipleOf(data, min, step) {
  const absStep = Math.abs(step)
  if (!/^\d+\.\d+$/.test(absStep.toString())) return (data - min) % absStep === 0
  const digits = absStep.toString().split('.')[1].length
  const scale = Math.pow(10, digits)
  return Math.round(Math.abs(data - min) * scale) % Math.round(absStep * scale) === 0
}

function createMockHostContext() {
  const tools = []
  const disposers = []
  const ctx = {
    get(name) {
      return name === 'approval' ? { config: { policy: 'ask' } } : undefined
    },
    tools: {
      register(def) {
        assertObjectJsonSchema(def.parameters, `${def.name}.parameters`)
        assertObjectJsonSchema(def.output.schema, `${def.name}.output.schema`)
        tools.push(def)
        return () => {}
      },
    },
    on() {
      return () => {}
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') disposers.push(cleanup)
    },
    async dispose() {
      for (const cleanup of disposers.splice(0)) await cleanup()
    },
    registeredTools: tools,
  }
  return ctx
}

// ---------- Tests ----------

test('host schema validator mirror catches DSH UNSUPPORTED_SCHEMA traps', () => {
  // Rejects minimum / maximum (Issue #4a)
  assert.throws(
    () => assertObjectJsonSchema({ type: 'object', properties: { limit: { type: 'integer', minimum: 1 } } }, 'limit'),
    (err) => err.code === 'UNSUPPORTED_SCHEMA' && /minimum/.test(err.message),
  )
  assert.throws(
    () => assertObjectJsonSchema({ type: 'object', properties: { limit: { type: 'integer', maximum: 100 } } }, 'limit'),
    (err) => err.code === 'UNSUPPORTED_SCHEMA' && /maximum/.test(err.message),
  )
  // Rejects type arrays like ['string', 'null'] (Issue #4b)
  assert.throws(
    () => assertObjectJsonSchema({ type: 'object', properties: { comment: { type: ['string', 'null'] } } }, 'comment'),
    (err) => err.code === 'UNSUPPORTED_SCHEMA' && /scalar type/.test(err.message),
  )
  // Rejects oneOf combined with sibling constraint keywords
  assert.throws(
    () => assertObjectJsonSchema({
      type: 'object',
      properties: { bad: { type: 'string', oneOf: [{ type: 'string' }, { type: 'null' }] } },
    }, 'bad'),
    (err) => err.code === 'UNSUPPORTED_SCHEMA' && /sibling constraint/.test(err.message),
  )
  // Rejects non-object root
  assert.throws(
    () => assertObjectJsonSchema({ type: 'array', items: { type: 'string' } }, 'root'),
    (err) => err.code === 'UNSUPPORTED_SCHEMA' && /root schema/.test(err.message),
  )
  // Accepts portable oneOf nullable string and unconstrained items: {}
  assert.doesNotThrow(() => assertObjectJsonSchema({
    type: 'object',
    properties: {
      nullable: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'nullable string' },
      params: { type: 'array', items: {} },
    },
    additionalProperties: true,
  }, 'ok'))

  const nullableSchema = { oneOf: [{ type: 'string' }, { type: 'null' }] }
  assert.deepEqual(validateJsonSchemaValue('hello', nullableSchema), [])
  assert.deepEqual(validateJsonSchemaValue(null, nullableSchema), [])
  assert.ok(validateJsonSchemaValue(123, nullableSchema).length > 0)
})

test('all 6 registered tools pass strict DSH assertObjectJsonSchema on parameters and output.schema', async () => {
  const ctx = createMockHostContext()
  try {
    apply(ctx, Config({}))
    assert.deepEqual(
      ctx.registeredTools.map((t) => t.name).sort(),
      ['sql_exec', 'sql_health', 'sql_list', 'sql_query', 'sql_schema', 'sql_stats'],
    )
    for (const tool of ctx.registeredTools) {
      assertObjectJsonSchema(tool.parameters, `${tool.name}.parameters`)
      assertObjectJsonSchema(tool.output.schema, `${tool.name}.output.schema`)
    }
    const sqlQuery = ctx.registeredTools.find((t) => t.name === 'sql_query')
    assert.equal(Object.hasOwn(sqlQuery.parameters.properties.limit, 'minimum'), false)
    assert.equal(Object.hasOwn(sqlQuery.parameters.properties.limit, 'maximum'), false)

    const sqlSchema = ctx.registeredTools.find((t) => t.name === 'sql_schema')
    const expectedNullable = { oneOf: [{ type: 'string' }, { type: 'null' }] }
    assert.deepEqual(sqlSchema.output.schema.properties.columns.items.properties.defaultValue, expectedNullable)
    assert.deepEqual(sqlSchema.output.schema.properties.columns.items.properties.comment, expectedNullable)
    assert.deepEqual(sqlSchema.output.schema.properties.tableDetails.items.properties.columns.items.properties.defaultValue, expectedNullable)
    assert.deepEqual(sqlSchema.output.schema.properties.tableDetails.items.properties.columns.items.properties.comment, expectedNullable)
  } finally {
    await ctx.dispose()
  }
})

test('all 6 tools runtime outputs conform to their own output.schema against a real SQLite DB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-contract-'))
  const dbFile = join(dir, 'contract.db')
  const parsedCfg = Config({
    connections: [{ name: 'local', engine: 'sqlite', file: dbFile }],
    maxRows: 2,
    redactColumns: false,
  })
  const { tools, adapters } = buildSqlTools(() => resolveConfig(liveConfig(parsedCfg)), () => 'ask')
  const { tools: redactTools, adapters: redactAdapters } = buildSqlTools(
    resolveConfig({ connections: [{ name: 'local', engine: 'sqlite', file: dbFile }], maxRows: 10, redactColumns: true }),
    () => 'ask',
  )
  const { tools: defaultTools, adapters: defaultAdapters } = buildSqlTools(
    resolveConfig(liveConfig(Config({}))),
    () => 'ask',
  )

  after(async () => {
    for (const a of adapters.values()) await a.close()
    for (const a of redactAdapters.values()) await a.close()
    for (const a of defaultAdapters.values()) await a.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const byName = (list, name) => list.find((t) => t.name === name)
  const sqlList = byName(tools, 'sql_list')
  const sqlQuery = byName(tools, 'sql_query')
  const sqlExec = byName(tools, 'sql_exec')
  const sqlSchema = byName(tools, 'sql_schema')
  const sqlStats = byName(tools, 'sql_stats')
  const sqlHealth = byName(tools, 'sql_health')

  const runAndValidate = async (tool, args, label) => {
    assertValidJsonSchemaValue(args, tool.parameters, `${label} args`)
    const result = await tool.execute(args, {})
    assertValidJsonSchemaValue(result, tool.output.schema, `${label} output`)
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result, `${label} output must be JSON-serializable`)
    const blocks = tool.output.render(args, result)
    assert.ok(Array.isArray(blocks) && blocks.length > 0 && typeof blocks[0].text === 'string' && blocks[0].text.length > 0, `${label} render`)
    return result
  }

  // 1. sql_exec: DDL + multi-row INSERT + parameterized INSERT
  await runAndValidate(
    sqlExec,
    {
      sql: [
        'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'member\', password_hash TEXT, bio TEXT)',
        'CREATE UNIQUE INDEX idx_users_email ON users (email)',
        'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amount REAL NOT NULL)',
      ].join('; '),
    },
    'sql_exec DDL',
  )
  await runAndValidate(
    sqlExec,
    {
      sql: "INSERT INTO users (email, password_hash, bio) VALUES ('alice@example.com', 'hash-a', NULL), ('bob@example.com', 'hash-b', 'engineer'), ('carol@example.com', NULL, 'ops')",
    },
    'sql_exec INSERT',
  )
  await runAndValidate(
    sqlExec,
    {
      sql: 'INSERT INTO orders (user_id, amount) VALUES (?, ?)',
      params: [1, 49.5],
    },
    'sql_exec parameterized INSERT',
  )

  // 2. sql_list (real DB + implicit :memory: default)
  await runAndValidate(sqlList, {}, 'sql_list real')
  await runAndValidate(byName(defaultTools, 'sql_list'), {}, 'sql_list default')

  // 3. sql_query: table / markdown / csv / json + limit + params + redaction
  for (const format of ['table', 'markdown', 'csv', 'json']) {
    const args = {
      sql: 'SELECT id, email, role, bio FROM users ORDER BY id',
      ...(format === 'table' ? {} : { format }),
    }
    const res = await runAndValidate(sqlQuery, args, `sql_query ${format}`)
    assert.equal(res.truncated, true)
    assert.equal(res.rowCount, 2)
  }
  await runAndValidate(
    sqlQuery,
    { sql: 'SELECT id, email FROM users WHERE email = ?', params: ['bob@example.com'], limit: 1 },
    'sql_query params + limit',
  )

  const redactQuery = byName(redactTools, 'sql_query')
  for (const format of ['table', 'markdown', 'csv', 'json']) {
    const args = {
      sql: 'SELECT email, password_hash FROM users ORDER BY id',
      ...(format === 'table' ? {} : { format }),
    }
    const res = await runAndValidate(redactQuery, args, `sql_query redacted ${format}`)
    assert.deepEqual(res.redactedColumns, ['password_hash'])
    assert.equal(res.rows[0][1], '[REDACTED]')
    assert.equal(res.rows[2][1], null)
  }

  // 4. sql_schema: list tables, pattern filter, single table (with null defaultValue), batch tables (valid + missing)
  await runAndValidate(sqlSchema, {}, 'sql_schema list')
  await runAndValidate(sqlSchema, { pattern: 'user*' }, 'sql_schema pattern')
  await runAndValidate(byName(defaultTools, 'sql_schema'), {}, 'sql_schema default')

  const singleUsers = await runAndValidate(sqlSchema, { table: 'users' }, 'sql_schema single users')
  assert.ok(singleUsers.columns.some((c) => c.defaultValue === null), 'should cover null defaultValue branch')
  assert.ok(singleUsers.columns.some((c) => typeof c.defaultValue === 'string'), 'should cover string defaultValue branch')
  await runAndValidate(sqlSchema, { table: 'orders' }, 'sql_schema single orders')

  const batchRes = await runAndValidate(
    sqlSchema,
    { tables: ['users', 'orders', 'missing_table'] },
    'sql_schema batch valid+missing',
  )
  assert.equal(batchRes.tableDetails.length, 3)
  assert.deepEqual(batchRes.tableDetails[2].columns, [])

  // Also cover nullable column comment (both null and string), enumValues, table comment, and batch per-table error
  const mockSetup = buildSqlTools(resolveConfig({ connections: [{ name: 'pg', engine: 'postgres', database: 'app' }] }))
  mockSetup.adapters.set('pg', {
    engine: 'postgres',
    async listTables() { return ['accounts'] },
    async describeTable() { return [] },
    async describeTableDetail(ref) {
      if (ref.includes('denied')) throw new Error('permission denied')
      return {
        table: 'accounts',
        schema: 'public',
        comment: '用户账户表',
        columns: [
          { name: 'id', type: 'bigint', notNull: true, primaryKey: true, defaultValue: null, comment: null },
          { name: 'status', type: 'account_status', notNull: true, primaryKey: false, defaultValue: "'active'", comment: '账户状态', enumValues: ['active', 'disabled'] },
        ],
        indexes: [{ name: 'accounts_pkey', unique: true, columns: ['id'] }],
        foreignKeys: [],
      }
    },
    async query() { return { columns: [], rows: [] } },
    async exec() { return 0 },
    async ping() {},
    async close() {},
  })
  const mockSchema = byName(mockSetup.tools, 'sql_schema')
  await runAndValidate(mockSchema, { table: 'accounts' }, 'sql_schema nullable comment single')
  await runAndValidate(mockSchema, { tables: ['accounts', 'denied'] }, 'sql_schema nullable comment + error batch')

  // 5. sql_stats
  const statsRes = await runAndValidate(sqlStats, {}, 'sql_stats real')
  assert.equal(statsRes.tableCount, 2)

  // 6. sql_health (real DB, redacted config, implicit default)
  const healthRes = await runAndValidate(sqlHealth, {}, 'sql_health real')
  assert.equal(healthRes.ok, true)
  await runAndValidate(byName(redactTools, 'sql_health'), {}, 'sql_health redacted')
  await runAndValidate(byName(defaultTools, 'sql_health'), {}, 'sql_health default')
})

test('Config serialization has no incompatible step and validates {} and { maxRows: 1000 } cleanly', () => {
  const serialized = JSON.parse(JSON.stringify(Config))
  assert.equal(typeof serialized.uid, 'number')
  assert.ok(isPlainObject(serialized.refs))

  for (const [uid, node] of Object.entries(serialized.refs)) {
    const meta = node?.meta ?? {}
    assert.equal(
      meta.step,
      undefined,
      `Config schema node uid=${uid} (type=${node?.type}) should not declare schemastery step`,
    )
    if (meta.step !== undefined && typeof meta.default === 'number') {
      assert.equal(
        isSchemasteryMultipleOf(meta.default, meta.min ?? 0, meta.step),
        true,
        `default ${meta.default} incompatible with min=${meta.min ?? 0} step=${meta.step}`,
      )
    }
  }

  // Exact defaults ({}) and cordis.patch.yml config ({ maxRows: 1000 })
  const fromEmpty = Config({})
  assert.equal(fromEmpty.maxRows.get(), 1000)
  assert.equal(fromEmpty.queryTimeoutMs.get(), 60000)
  assert.equal(fromEmpty.execTimeoutMs.get(), 120000)
  assert.deepEqual(fromEmpty.connections.get(), [])

  const fromPatch = Config({ maxRows: 1000 })
  assert.equal(fromPatch.maxRows.get(), 1000)

  const fromCustom = Config({
    maxRows: 50,
    queryTimeoutMs: 7500,
    execTimeoutMs: 12500,
    connections: [{ name: 'pg', engine: 'postgres', host: '127.0.0.1', port: 5432, database: 'app' }],
  })
  assert.equal(fromCustom.maxRows.get(), 50)
  assert.equal(fromCustom.queryTimeoutMs.get(), 7500)
  assert.equal(fromCustom.execTimeoutMs.get(), 12500)
  assert.equal(fromCustom.connections.get()[0].port, 5432)

  // Standard Schema v1 validate interface used by hosts
  const stdEmpty = Config['~standard'].validate({})
  assert.equal('issues' in stdEmpty, false)
  assert.equal(stdEmpty.value.maxRows.get(), 1000)

  const stdPatch = Config['~standard'].validate({ maxRows: 1000 })
  assert.equal('issues' in stdPatch, false)
  assert.equal(stdPatch.value.maxRows.get(), 1000)
})

test('数据库 URI 与直接密码都标为宿主 secret，序列化后仍保留凭据和运行时解析语义', () => {
  const serialized = JSON.parse(JSON.stringify(Config))
  const connections = serialized.refs[serialized.refs[serialized.uid].dict.connections]
  const row = serialized.refs[connections.inner]
  assert.equal(serialized.refs[row.dict.url].meta.role, 'secret')
  assert.equal(serialized.refs[row.dict.password].meta.role, 'secret')

  const url = 'postgres://alice:P%40ss%3Aword%2F%25@db.internal:5433/app?sslmode=verify-full'
  const config = liveConfig(Config({ connections: [{ name: 'uri', engine: 'postgres', url }] }))
  assert.equal(config.connections[0].url, url)
  const resolved = resolveConfig(config, {}).connections[0]
  assert.equal(resolved.password, 'P@ss:word/%')
  assert.equal(resolved.host, 'db.internal')
  assert.equal(resolved.port, 5433)
  assert.equal(resolved.database, 'app')
  assert.equal(resolved.ssl, 'verify-full')
})
