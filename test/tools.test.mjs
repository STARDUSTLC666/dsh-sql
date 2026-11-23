import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeWriteRisks,
  assertReadQuery,
  buildSqlTools,
  Config,
  DEFAULT_REDACT_COLUMN_PATTERNS,
  isCursorEligibleQuery,
  liveConfig,
  matchRedactedColumns,
  parseTableRef,
  resolveConfig,
  toMarkdownTable,
} from '../lib/index.js'

const kVolatileWrite = Symbol.for('cosmokit.volatile.write')

const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-tools-'))
const cfg = resolveConfig({ connections: [{ name: 'local', engine: 'sqlite', file: join(dir, 'app.db') }], maxRows: 2 })
const { tools, adapters } = buildSqlTools(cfg)
const list = tools.find((t) => t.name === 'sql_list')
const query = tools.find((t) => t.name === 'sql_query')
const exec = tools.find((t) => t.name === 'sql_exec')
const schema = tools.find((t) => t.name === 'sql_schema')

after(async () => {
  for (const adapter of adapters.values()) await adapter.close()
  rmSync(dir, { recursive: true, force: true })
})

test('工具 timeoutMs 取配置值且支持 volatile 热更新动态读取', () => {
  const parsed = Config({
    connections: cfg.connections,
    maxRows: 2,
    queryTimeoutMs: 15000,
    execTimeoutMs: 30000,
  })
  const live = liveConfig(parsed)
  const timed = buildSqlTools(() => resolveConfig(live)).tools
  const q = timed.find((t) => t.name === 'sql_query')
  const e = timed.find((t) => t.name === 'sql_exec')
  const s = timed.find((t) => t.name === 'sql_stats')
  const l = timed.find((t) => t.name === 'sql_list')

  assert.equal(q.timeoutMs, 15000)
  assert.equal(e.timeoutMs, 30000)
  assert.equal(s.timeoutMs, 15000)
  assert.equal(l.timeoutMs, 30000)

  parsed.queryTimeoutMs[kVolatileWrite](45000)
  parsed.execTimeoutMs[kVolatileWrite](90000)
  assert.equal(q.timeoutMs, 45000)
  assert.equal(e.timeoutMs, 90000)
  assert.equal(s.timeoutMs, 45000)
})

test('构建 6 个工具且名字正确', () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), ['sql_exec', 'sql_health', 'sql_list', 'sql_query', 'sql_schema', 'sql_stats'])
})

test('每个工具 schema 符合宿主受限 JSON Schema 子集（保留 enum / items，不含 minimum / maximum，可空字段用 oneOf）', () => {
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.parameters.properties, 'object')
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
  assert.deepEqual(query.parameters.properties.format.enum, ['table', 'markdown', 'csv', 'json'])
  assert.equal(query.parameters.properties.limit.type, 'integer')
  assert.equal(Object.hasOwn(query.parameters.properties.limit, 'minimum'), false, 'DSH 宿主不支持 minimum 关键字')
  assert.equal(Object.hasOwn(query.parameters.properties.limit, 'maximum'), false, 'DSH 宿主不支持 maximum 关键字')
  assert.deepEqual(query.parameters.properties.params.items, {})
  assert.deepEqual(exec.parameters.properties.params.items, {})
  assert.deepEqual(schema.parameters.properties.tables.items, { type: 'string' })
  const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }
  assert.deepEqual(schema.output.schema.properties.columns.items.properties.defaultValue, nullableString)
  assert.deepEqual(schema.output.schema.properties.columns.items.properties.comment, nullableString)
  assert.deepEqual(schema.output.schema.properties.tableDetails.items.properties.columns.items.properties.defaultValue, nullableString)
  assert.deepEqual(schema.output.schema.properties.tableDetails.items.properties.columns.items.properties.comment, nullableString)
  assert.equal(typeof analyzeWriteRisks, 'function')
  assert.equal(typeof isCursorEligibleQuery, 'function')
  assert.equal(typeof toMarkdownTable, 'function')
  assert.ok(Array.isArray(DEFAULT_REDACT_COLUMN_PATTERNS) && DEFAULT_REDACT_COLUMN_PATTERNS.length > 0)
  assert.equal(typeof matchRedactedColumns, 'function')
})

test('sql_list：连接健康', async () => {
  const value = await list.execute({})
  assert.equal(value.connections.length, 1)
  assert.equal(value.connections[0].ok, true)
  assert.equal(value.connections[0].name, 'local')
  assert.equal(value.connections[0].readOnly, false)
})

test('sql_exec + sql_query + sql_schema 全链路与 rowCount/truncated 语义', async () => {
  await exec.execute({ sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)' })
  const insert = await exec.execute({ sql: "INSERT INTO items (label) VALUES ('a'), ('b'), ('c')" })
  assert.equal(insert.changes, 3)
  const result = await query.execute({ sql: 'SELECT * FROM items ORDER BY id' })
  assert.equal(result.rowCount, 2, 'rowCount 为实际返回行数，而非 maxRows+1')
  assert.equal(result.rows.length, 2, 'maxRows=2 截断')
  assert.equal(result.truncated, true)
  assert.equal(result.maxRows, 2)
  const tables = await schema.execute({})
  assert.ok(tables.tables.includes('items'))
  const columns = await schema.execute({ table: 'items' })
  assert.equal(columns.columns.length, 2)
  assert.equal(columns.columns[0].primaryKey, true)
})

test('sql_query 支持 limit、params 与参数化 sql_exec，拒绝非法 limit/format', async () => {
  // limit 小于全局 maxRows
  const limited = await query.execute({ sql: 'SELECT * FROM items ORDER BY id', limit: 1 })
  assert.equal(limited.rowCount, 1)
  assert.equal(limited.rows.length, 1)
  assert.equal(limited.truncated, true)
  assert.equal(limited.maxRows, 1)

  // limit 大于全局 maxRows 时钳制到 maxRows=2
  const clamped = await query.execute({ sql: 'SELECT * FROM items ORDER BY id', limit: 50 })
  assert.equal(clamped.rowCount, 2)
  assert.equal(clamped.maxRows, 2)
  assert.equal(clamped.truncated, true)

  // 非法 limit / params / format
  await assert.rejects(() => query.execute({ sql: 'SELECT 1', limit: 0 }), /大于等于 1/)
  await assert.rejects(() => query.execute({ sql: 'SELECT 1', limit: -1 }), /大于等于 1/)
  await assert.rejects(() => query.execute({ sql: 'SELECT 1', limit: 1.5 }), /大于等于 1/)
  await assert.rejects(() => query.execute({ sql: 'SELECT 1', params: 'bad' }), /params 必须是数组/)
  await assert.rejects(() => query.execute({ sql: 'SELECT 1', format: 'xml' }), /不支持的 format.*table \/ markdown \/ csv \/ json/)

  // 参数化查询与参数化写入
  const paramRes = await query.execute({ sql: 'SELECT id, label FROM items WHERE label = ?', params: ['b'] })
  assert.equal(paramRes.rowCount, 1)
  assert.equal(paramRes.rows[0][1], 'b')
  assert.equal(paramRes.truncated, false)

  const paramExec = await exec.execute({ sql: 'INSERT INTO items (label) VALUES (?)', params: ['param-d'] })
  assert.equal(paramExec.changes, 1)
  const verify = await query.execute({ sql: 'SELECT label FROM items WHERE label = ?', params: ['param-d'] })
  assert.equal(verify.rowCount, 1)
  assert.equal(verify.rows[0][0], 'param-d')
})

test('sql_query 截断提示在 table / markdown / csv / json 四种格式下均有渲染', async () => {
  for (const format of ['table', 'markdown', 'csv', 'json']) {
    const value = await query.execute({
      sql: 'SELECT id, label FROM items ORDER BY id',
      ...(format === 'table' ? {} : { format }),
    })
    assert.equal(value.truncated, true)
    assert.equal(value.rowCount, 2)
    assert.equal(Number.isInteger(value.durationMs), true)
    assert.ok(value.durationMs >= 0)
    const rendered = query.output.render({}, value)[0].text
    assert.match(rendered, /已达上限 2 行/, 'format=' + format)
    assert.match(rendered, /耗时 \d+ms/, 'format=' + format)
  }
})

test('sql_exec 与 sql_query 均返回非负整数 durationMs 并在渲染头中展示', async () => {
  const execRes = await exec.execute({ sql: "UPDATE items SET label = 'a' WHERE id = 1" })
  assert.equal(Number.isInteger(execRes.durationMs), true)
  assert.ok(execRes.durationMs >= 0)
  const execText = exec.output.render({}, execRes)[0].text
  assert.match(execText, /耗时 \d+ms/)

  const queryRes = await query.execute({ sql: 'SELECT id, label FROM items ORDER BY id' })
  assert.equal(Number.isInteger(queryRes.durationMs), true)
  assert.ok(queryRes.durationMs >= 0)
  const queryText = query.output.render({}, queryRes)[0].text
  assert.match(queryText, /耗时 \d+ms/)
  assert.match(queryText, /\| id \| label \|/)
  assert.match(queryText, /\| --- \| --- \|/)
})

test('toMarkdownTable 与 format=markdown：正确转义管道符/换行/孤立回车、处理空列/空行与极端对象', async () => {
  assert.equal(toMarkdownTable([], []), '')
  assert.equal(toMarkdownTable(['a', 'b'], []), '| a | b |\n| --- | --- |')
  assert.equal(
    toMarkdownTable(['col|1', 'col2'], [['val|a', 'line1\nline2'], [null, { k: 'v|1' }]]),
    [
      '| col\\|1 | col2 |',
      '| --- | --- |',
      '| val\\|a | line1\\nline2 |',
      '| NULL | {"k":"v\\|1"} |',
    ].join('\n'),
  )

  // 孤立 \r 必须转义避免破坏 GFM 行结构；toJSON 返回 undefined 或 null 原型 + BigInt/循环引用不得崩溃
  const nullProtoBigInt = Object.assign(Object.create(null), { n: 1n })
  const nullProtoCyclic = Object.create(null)
  nullProtoCyclic.self = nullProtoCyclic
  const undefJson = { toJSON() { return undefined } }
  const edgeMd = toMarkdownTable(
    ['cr', 'undef_json', 'null_bigint', 'null_cyclic'],
    [['line1\rline2\r\nline3', undefJson, nullProtoBigInt, nullProtoCyclic]],
  )
  assert.equal(edgeMd.includes('\r'), false, 'Markdown 表格中不得残留孤立 \\r')
  assert.ok(edgeMd.includes('| line1\\nline2\\nline3 | [object Object] | [object Object] | [object Object] |'))

  const mdRes = await query.execute({
    sql: "SELECT 'x|y' AS pipe_col, 'hello\nworld' AS multi_col, NULL AS empty_col",
    format: 'markdown',
  })
  assert.equal(mdRes.format, 'markdown')
  assert.equal(
    mdRes.formatted,
    '| pipe_col | multi_col | empty_col |\n| --- | --- | --- |\n| x\\|y | hello\\nworld | NULL |',
  )
  const rendered = query.output.render({}, mdRes)[0].text
  assert.match(rendered, /markdown 格式/)
  assert.ok(rendered.includes('| x\\|y | hello\\nworld | NULL |'))
})

test('sql_query 敏感列脱敏（redactColumns=true 与自定义规则）：覆盖 table/markdown/csv/json，保留 NULL 并报告 redactedColumns', async () => {
  const localDir = mkdtempSync(join(tmpdir(), 'dsh-sql-redact-'))
  const dbFile = join(localDir, 'redact.db')
  const rwTools = buildSqlTools(resolveConfig({ connections: [{ name: 'r', engine: 'sqlite', file: dbFile }] }))
  const defaultRedact = buildSqlTools(resolveConfig({
    connections: [{ name: 'r', engine: 'sqlite', file: dbFile }],
    redactColumns: true,
  }))
  const customRedact = buildSqlTools(resolveConfig({
    connections: [{ name: 'r', engine: 'sqlite', file: dbFile }],
    redactColumns: ['phone', '/^id_card$/i'],
  }))
  try {
    const rwExec = rwTools.tools.find((t) => t.name === 'sql_exec')
    const rwQuery = rwTools.tools.find((t) => t.name === 'sql_query')
    await rwExec.execute({
      sql: 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, api_key TEXT, phone TEXT, id_card TEXT)',
    })
    await rwExec.execute({
      sql: "INSERT INTO accounts (username, password_hash, api_key, phone, id_card) VALUES ('alice', 'secret123', NULL, '13800138000', '110101199001011234')",
    })

    // 未开启脱敏时原文返回且无 redactedColumns
    const raw = await rwQuery.execute({ sql: 'SELECT username, password_hash, api_key FROM accounts' })
    assert.equal(raw.rows[0][1], 'secret123')
    assert.equal(raw.redactedColumns, undefined)

    // redactColumns: true 跨全部 4 种格式脱敏非空值、保留 NULL
    const defQuery = defaultRedact.tools.find((t) => t.name === 'sql_query')
    for (const format of ['table', 'markdown', 'csv', 'json']) {
      const res = await defQuery.execute({
        sql: 'SELECT username, password_hash, api_key FROM accounts',
        ...(format === 'table' ? {} : { format }),
      })
      assert.deepEqual(res.redactedColumns, ['password_hash', 'api_key'])
      assert.deepEqual(res.rows, [['alice', '[REDACTED]', null]])
      const rendered = defQuery.output.render({}, res)[0].text
      assert.match(rendered, /已脱敏列：password_hash, api_key/)
      assert.equal(rendered.includes('secret123'), false, 'format=' + format + ' 不得泄露原文')
      if (format === 'json') {
        assert.deepEqual(JSON.parse(res.formatted), [{ username: 'alice', password_hash: '[REDACTED]', api_key: null }])
      } else if (format === 'csv') {
        assert.equal(res.formatted, 'username,password_hash,api_key\nalice,[REDACTED],')
      } else if (format === 'markdown') {
        assert.equal(res.formatted, '| username | password_hash | api_key |\n| --- | --- | --- |\n| alice | [REDACTED] | NULL |')
      }
    }

    // 自定义子串 + 正则规则，且同名列去重保留列序
    const custQuery = customRedact.tools.find((t) => t.name === 'sql_query')
    const custRes = await custQuery.execute({
      sql: 'SELECT username, phone, id_card, phone AS phone, password_hash FROM accounts',
      format: 'json',
    })
    assert.deepEqual(custRes.redactedColumns, ['phone', 'id_card'])
    assert.deepEqual(custRes.rows, [['alice', '[REDACTED]', '[REDACTED]', '[REDACTED]', 'secret123']])
    assert.deepEqual(JSON.parse(custRes.formatted), {
      columns: ['username', 'phone', 'id_card', 'phone', 'password_hash'],
      rows: [['alice', '[REDACTED]', '[REDACTED]', '[REDACTED]', 'secret123']],
    })
  } finally {
    for (const a of rwTools.adapters.values()) await a.close()
    for (const a of defaultRedact.adapters.values()) await a.close()
    for (const a of customRedact.adapters.values()) await a.close()
    rmSync(localDir, { recursive: true, force: true })
  }
})

test('sql_query 对无参 PostgreSQL 查询启用 useCursor=true，有参或非 PG 查询不启用', async () => {
  const multiCfg = resolveConfig({
    connections: [
      { name: 'pg', engine: 'postgres', database: 'app' },
      { name: 'my', engine: 'mysql', database: 'shop' },
      { name: 'sq', engine: 'sqlite', file: ':memory:' },
    ],
  })
  const { tools: mTools, adapters: mAdapters } = buildSqlTools(multiCfg)
  const captured = []
  const makeMockAdapter = (engine) => ({
    engine,
    async listTables() { return [] },
    async describeTable() { return [] },
    async query(sql, limit, _signal, options) {
      captured.push({ engine, sql, limit, options })
      return { columns: ['id'], rows: [[1]] }
    },
    async exec() { return 0 },
    async ping() {},
    async close() {},
  })
  mAdapters.set('pg', makeMockAdapter('postgres'))
  mAdapters.set('my', makeMockAdapter('mysql'))
  mAdapters.set('sq', makeMockAdapter('sqlite'))

  const mQuery = mTools.find((t) => t.name === 'sql_query')
  try {
    // PG 无参 -> useCursor: true
    await mQuery.execute({ connection: 'pg', sql: 'SELECT 1' })
    assert.equal(captured.at(-1).options.useCursor, true)

    // PG 空参数数组 -> useCursor: true
    await mQuery.execute({ connection: 'pg', sql: 'SELECT 1', params: [] })
    assert.equal(captured.at(-1).options.useCursor, true)

    // PG 有参数 -> 不设 useCursor
    await mQuery.execute({ connection: 'pg', sql: 'SELECT $1', params: [42] })
    assert.equal(captured.at(-1).options.useCursor, undefined)

    // MySQL / SQLite 无参 -> 不设 useCursor
    await mQuery.execute({ connection: 'my', sql: 'SELECT 1' })
    assert.equal(captured.at(-1).options.useCursor, undefined)
    await mQuery.execute({ connection: 'sq', sql: 'SELECT 1' })
    assert.equal(captured.at(-1).options.useCursor, undefined)
  } finally {
    for (const a of mAdapters.values()) await a.close()
  }
})

test('sql_query table 渲染：PG jsonb 对象/数组不出现 [object Object]，NULL 与单细胞/总输出安全截断', () => {
  const longText = 'X'.repeat(450)
  const rendered = query.output.render({}, {
    connection: 'pg',
    columns: ['meta', 'tags', 'empty', 'note', 'huge'],
    rows: [[{ role: 'admin', active: true }, [1, 2], null, 'line1\nline2', longText]],
    rowCount: 1,
    truncated: false,
    maxRows: 100,
  })[0].text
  assert.doesNotMatch(rendered, /\[object Object\]/)
  assert.ok(rendered.includes('{"role":"admin","active":true}'))
  assert.ok(rendered.includes('[1,2]'))
  assert.ok(rendered.includes('NULL'))
  assert.ok(rendered.includes('line1\\nline2'))
  assert.ok(rendered.includes('…(已截断)'))

  // 20 行超宽行不爆炸上下文，总长度受约 8000 字符上限保护
  const wideRows = Array.from({ length: 20 }, (_, i) => Array.from({ length: 10 }, () => `r${i}_` + 'Z'.repeat(280)))
  const capped = query.output.render({}, {
    connection: 'pg',
    columns: Array.from({ length: 10 }, (_, i) => 'c' + i),
    rows: wideRows,
    rowCount: 20,
    truncated: false,
    maxRows: 100,
  })[0].text
  assert.ok(capped.length <= 8200, 'rendered length should stay bounded, got ' + capped.length)
  assert.match(capped, /输出已达长度上限/)
})

test('sql_schema 支持 pattern 过滤与富结构（索引/外键/默认值/注释）渲染', async () => {
  const localDir = mkdtempSync(join(tmpdir(), 'dsh-sql-schema-'))
  const localCfg = resolveConfig({ connections: [{ name: 'sc', engine: 'sqlite', file: join(localDir, 'sc.db') }] })
  const { tools: localTools, adapters: localAdapters } = buildSqlTools(localCfg)
  try {
    const localExec = localTools.find((t) => t.name === 'sql_exec')
    const localSchema = localTools.find((t) => t.name === 'sql_schema')
    await localExec.execute({ sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL DEFAULT \'a@b.c\')' })
    await localExec.execute({ sql: 'CREATE UNIQUE INDEX idx_users_email ON users (email)' })
    await localExec.execute({ sql: 'CREATE TABLE user_logs (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id))' })
    await localExec.execute({ sql: 'CREATE TABLE orders (id INTEGER PRIMARY KEY)' })

    // 子串过滤（不区分大小写）
    const sub = await localSchema.execute({ pattern: 'USER' })
    assert.deepEqual(sub.tables, ['user_logs', 'users'])

    // 通配符过滤
    const wild = await localSchema.execute({ pattern: '*_logs' })
    assert.deepEqual(wild.tables, ['user_logs'])

    // 无匹配时提示过滤条件，不误报空库
    const none = await localSchema.execute({ pattern: 'nope_*' })
    assert.deepEqual(none.tables, [])
    assert.match(localSchema.output.render({}, none)[0].text, /过滤条件.*pattern=nope_\*/)

    // 真实 SQLite 端到端走 describeTableDetail：验证默认值、索引、外键完整返回与渲染
    const usersDetail = await localSchema.execute({ table: 'users' })
    assert.ok(usersDetail.columns.some((c) => c.name === 'email' && c.defaultValue === "'a@b.c'"))
    assert.ok(usersDetail.indexes.some((idx) => idx.name === 'idx_users_email' && idx.unique === true && idx.columns.includes('email')))
    const logsDetail = await localSchema.execute({ table: 'user_logs' })
    assert.ok(logsDetail.foreignKeys.some((fk) => fk.column === 'user_id' && fk.refTable === 'users' && fk.refColumn === 'id'))
    const logsRendered = localSchema.output.render({}, logsDetail)[0].text
    assert.match(logsRendered, /外键（1）/)
    assert.match(logsRendered, /user_id -> users\.id/)

    // 富结构渲染（含 schema / 表注释 / 列注释 / 默认值 / PG enumValues / 索引 / 外键）
    const manyEnums = Array.from({ length: 14 }, (_, i) => 'v' + (i + 1))
    const richRendered = localSchema.output.render({}, {
      connection: 'sc',
      table: 'events',
      schema: 'analytics',
      comment: '埋点事件表',
      columns: [
        { name: 'id', type: 'bigint', notNull: true, primaryKey: true, defaultValue: null, comment: '主键 ID' },
        { name: 'status', type: 'event_status', notNull: true, primaryKey: false, defaultValue: "'open'", enumValues: ['open', 'closed', 'archived'], comment: '状态' },
        { name: 'category', type: 'cat_enum', notNull: false, primaryKey: false, enumValues: manyEnums },
      ],
      indexes: [{ name: 'idx_events_status', unique: false, columns: ['status'] }],
      foreignKeys: [{ column: 'user_id', refTable: 'users', refColumn: 'id' }],
      tables: [],
    })[0].text
    assert.match(richRendered, /analytics\.events（埋点事件表）/)
    assert.match(richRendered, /默认: 'open'/)
    assert.match(richRendered, /（枚举：open, closed, archived）/)
    assert.match(richRendered, /（枚举：v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, …）/)
    assert.match(richRendered, /主键 ID/)
    assert.match(richRendered, /idx_events_status.*\(status\)/)
    assert.match(richRendered, /user_id -> users\.id/)

    // 批量 tables 查询：并发读取多张表，缺失表不中断其余表
    const batch = await localSchema.execute({ tables: ['users', 'user_logs', 'missing'] })
    assert.equal(batch.connection, 'sc')
    assert.deepEqual(batch.tables, [])
    assert.deepEqual(batch.columns, [])
    assert.equal(batch.tableDetails.length, 3)
    assert.equal(batch.tableDetails[0].table, 'users')
    assert.ok(batch.tableDetails[0].indexes.some((idx) => idx.name === 'idx_users_email'))
    assert.equal(batch.tableDetails[1].table, 'user_logs')
    assert.ok(batch.tableDetails[1].foreignKeys.some((fk) => fk.refTable === 'users'))
    assert.equal(batch.tableDetails[2].table, 'missing')
    assert.deepEqual(batch.tableDetails[2].columns, [])
    const batchRendered = localSchema.output.render({}, batch)[0].text
    assert.match(batchRendered, /批量表结构（共 3 张）/)
    assert.match(batchRendered, /### users/)
    assert.match(batchRendered, /### user_logs/)
    assert.match(batchRendered, /### missing/)
    assert.match(batchRendered, /未找到该表的列/)

    // table 优先级高于 tables
    const singlePriority = await localSchema.execute({ table: 'users', tables: ['orders'] })
    assert.equal(singlePriority.table, 'users')
    assert.equal(singlePriority.tableDetails, undefined)

    // tables 参数校验（非数组、空数组、超过 20 张、空字符串项）
    await assert.rejects(() => localSchema.execute({ tables: 'users' }), /非空字符串数组/)
    await assert.rejects(() => localSchema.execute({ tables: [] }), /不能为空数组/)
    await assert.rejects(() => localSchema.execute({ tables: Array.from({ length: 21 }, (_, i) => 't' + i) }), /最多支持批量查看 20 张/)
    await assert.rejects(() => localSchema.execute({ tables: ['users', ''] }), /非空表名字符串/)
  } finally {
    for (const a of localAdapters.values()) await a.close()
    rmSync(localDir, { recursive: true, force: true })
  }
})

test('sql_schema 批量 tables 并发单表异常隔离 + schema 限定 + enumValues 渲染', async () => {
  const pgCfg = resolveConfig({ connections: [{ name: 'pg', engine: 'postgres', database: 'app' }] })
  const { tools: pgTools, adapters: pgAdapters } = buildSqlTools(pgCfg)
  const seenRefs = []
  pgAdapters.set('pg', {
    engine: 'postgres',
    async listTables() { return [] },
    async describeTable() { return [] },
    async describeTableDetail(tableRef) {
      seenRefs.push(tableRef)
      const parsed = parseTableRef(tableRef, '表名')
      if (parsed.table === 'broken') {
        throw new Error('permission denied for table broken')
      }
      return {
        table: parsed.table,
        schema: parsed.schema,
        columns: [
          { name: 'id', type: 'integer', notNull: true, primaryKey: true },
          { name: 'state', type: 'order_state', notNull: true, primaryKey: false, enumValues: ['new', 'paid'] },
        ],
        indexes: [],
        foreignKeys: [],
      }
    },
    async query() { return { columns: [], rows: [] } },
    async exec() { return 0 },
    async ping() {},
    async close() {},
  })

  const pgSchema = pgTools.find((t) => t.name === 'sql_schema')
  try {
    const res = await pgSchema.execute({
      tables: ['orders', 'broken', 'sales.invoices'],
      schema: 'analytics',
    })
    assert.deepEqual(seenRefs, ['"analytics"."orders"', '"analytics"."broken"', 'sales.invoices'])
    assert.equal(res.tableDetails.length, 3)
    assert.equal(res.tableDetails[0].schema, 'analytics')
    assert.deepEqual(res.tableDetails[0].columns[1].enumValues, ['new', 'paid'])
    assert.equal(res.tableDetails[1].table, 'broken')
    assert.deepEqual(res.tableDetails[1].columns, [])
    assert.match(res.tableDetails[1].error, /permission denied/)
    assert.equal(res.tableDetails[2].schema, 'sales')
    assert.equal(res.tableDetails[2].table, 'invoices')

    const rendered = pgSchema.output.render({}, res)[0].text
    assert.match(rendered, /### analytics\.orders/)
    assert.match(rendered, /（枚举：new, paid）/)
    assert.match(rendered, /### broken\n读取失败：permission denied/)
    assert.match(rendered, /### sales\.invoices/)

    // 批量模式遇到非法表名/schema 在调用适配器前即拒绝
    const before = seenRefs.length
    await assert.rejects(() => pgSchema.execute({ tables: ['orders', 'x;DROP TABLE y'] }), /表名 非法/)
    await assert.rejects(() => pgSchema.execute({ tables: ['orders'], schema: 'a.b' }), /schema 非法/)
    assert.equal(seenRefs.length, before)
  } finally {
    for (const a of pgAdapters.values()) await a.close()
  }
})

test('sql_schema 校验 schema 与 table：支持含点号引号表名、已加引号 schema，并拒绝多段或注入 schema', async () => {
  const pgCfg = resolveConfig({ connections: [{ name: 'pg', engine: 'postgres', database: 'app' }] })
  const { tools: pgTools, adapters: pgAdapters } = buildSqlTools(pgCfg)
  const received = []
  pgAdapters.set('pg', {
    engine: 'postgres',
    async listTables(_signal, schemaArg) {
      received.push({ op: 'list', schemaArg })
      return []
    },
    async describeTable() { return [] },
    async describeTableDetail(tableRef) {
      const parsed = parseTableRef(tableRef, '表名')
      received.push({ op: 'detail', tableRef, parsed })
      return {
        table: parsed.table,
        schema: parsed.schema,
        columns: [{ name: 'id', type: 'integer', notNull: true, primaryKey: true }],
        indexes: [],
        foreignKeys: [],
      }
    },
    async query() { return { columns: [], rows: [] } },
    async exec() { return 0 },
    async ping() {},
    async close() {},
  })

  const pgSchema = pgTools.find((t) => t.name === 'sql_schema')

  // 1. 含点号的引号表名 + schema 不会被静默丢弃 schema
  const dottedRes = await pgSchema.execute({ table: '"my.table"', schema: 'analytics' })
  assert.deepEqual(received.at(-1).parsed, { schema: 'analytics', table: 'my.table' })
  const dottedRendered = pgSchema.output.render({}, dottedRes)[0].text
  assert.match(dottedRendered, /表 analytics\.my\.table 的列/)

  // 2. 已加引号的 schema 不会被双重包裹引号
  await pgSchema.execute({ table: 'users', schema: '"analytics"' })
  assert.deepEqual(received.at(-1).parsed, { schema: 'analytics', table: 'users' })

  // 3. 含点号的引号 schema + 含点号的引号表名往返无损
  await pgSchema.execute({ table: '"my.table"', schema: '"my.schema"' })
  assert.deepEqual(received.at(-1).parsed, { schema: 'my.schema', table: 'my.table' })

  // 4. table 已显式携带 schema 时保留其显式 schema
  await pgSchema.execute({ table: 'sales.orders', schema: 'analytics' })
  assert.deepEqual(received.at(-1).parsed, { schema: 'sales', table: 'orders' })

  // 5. 多段 schema 与注入字符均在调用适配器前被拒绝（无论是否带 table）
  const beforeInvalidCount = received.length
  await assert.rejects(() => pgSchema.execute({ table: 'users', schema: 'a.b' }), /schema 非法/)
  await assert.rejects(() => pgSchema.execute({ table: 'users', schema: 'a;DROP TABLE x' }), /schema 非法/)
  await assert.rejects(() => pgSchema.execute({ table: 'sales.orders', schema: 'a.b' }), /schema 非法/)
  await assert.rejects(() => pgSchema.execute({ schema: 'a.b' }), /schema 非法/)
  await assert.rejects(() => pgSchema.execute({ schema: 'a;DROP TABLE x' }), /schema 非法/)
  assert.equal(received.length, beforeInvalidCount, '非法 schema 不应继续调用适配器')
})

test('volatile 配置删改/改名连接时主动关闭并回收过期 adapter，无泄漏', async () => {
  const parsed = Config({
    connections: [
      { name: 'Alpha', engine: 'sqlite', file: ':memory:' },
      { name: 'Beta', engine: 'sqlite', file: ':memory:' },
    ],
  })
  const live = liveConfig(parsed)
  const { tools: liveTools, adapters: liveAdapters } = buildSqlTools(() => resolveConfig(live))
  const liveList = liveTools.find((t) => t.name === 'sql_list')
  try {
    await liveList.execute({})
    assert.equal(liveAdapters.size, 2)
    assert.ok(liveAdapters.has('alpha'))
    assert.ok(liveAdapters.has('beta'))

    let alphaClosed = 0
    let betaClosed = 0
    const origAlpha = liveAdapters.get('alpha')
    const origBeta = liveAdapters.get('beta')
    const origAlphaClose = origAlpha.close.bind(origAlpha)
    const origBetaClose = origBeta.close.bind(origBeta)
    origAlpha.close = async () => { alphaClosed += 1; return origAlphaClose() }
    origBeta.close = async () => { betaClosed += 1; return origBetaClose() }

    // 删除 Beta，并将 Alpha 改小写 alpha，同时新增 Gamma
    parsed.connections[kVolatileWrite]([
      { name: 'alpha', engine: 'sqlite', file: ':memory:' },
      { name: 'Gamma', engine: 'sqlite', file: ':memory:' },
    ])
    await liveList.execute({})
    assert.equal(betaClosed, 1, '已删除的连接池必须被关闭')
    assert.equal(alphaClosed, 1, '改大小写/变更指纹的旧连接池必须被关闭，不泄漏')
    assert.deepEqual([...liveAdapters.keys()].sort(), ['alpha', 'gamma'])
  } finally {
    for (const a of liveAdapters.values()) await a.close()
  }
})

test('sql_query 拒绝写语句与多语句', async () => {
  await assert.rejects(() => query.execute({ sql: 'DROP TABLE items' }), /只接受只读语句/)
  await assert.rejects(() => query.execute({ sql: 'SELECT 1; SELECT 2' }), /一条语句/)
})

test('sql_exec 在 readOnly 配置下被禁用', async () => {
  const { tools: ro, adapters: roAdapters } = buildSqlTools(resolveConfig({ connections: cfg.connections, readOnly: true }))
  try {
    const roExec = ro.find((t) => t.name === 'sql_exec')
    await assert.rejects(() => roExec.execute({ sql: "INSERT INTO items (label) VALUES ('x')" }), /readOnly=true/)
  } finally {
    for (const a of roAdapters.values()) await a.close()
  }
})

test('未知连接抛中文错误', async () => {
  await assert.rejects(() => query.execute({ sql: 'SELECT 1', connection: 'nope' }), /未找到名为 nope/)
})

test('execute 返回值可 JSON 序列化', async () => {
  const value = await query.execute({ sql: 'SELECT 1 AS one' })
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
})

test('JSON 导出遇到同名列时保留列序与所有值', async () => {
  const result = await query.execute({ sql: 'SELECT 1 AS value, 2 AS value, 9223372036854775807 AS id', format: 'json' })
  assert.deepEqual(JSON.parse(result.formatted), {
    columns: ['value', 'value', 'id'], rows: [[1, 2, '9223372036854775807']],
  })
})

test('工具执行把 exec.signal 传入数据库适配器', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancel sql tool'))
  await assert.rejects(
    () => query.execute({ sql: 'SELECT 1' }, { signal: controller.signal }),
    /cancel sql tool/,
  )
})

test('assertReadQuery 不误伤字符串/注释里的分号与写关键字', () => {
  assert.equal(assertReadQuery("SELECT 'delete;' AS label"), "SELECT 'delete;' AS label")
  assert.equal(assertReadQuery('SELECT 1 -- 注释里的 update\n'), 'SELECT 1 -- 注释里的 update')
  assert.equal(assertReadQuery('SELECT $tag$; update$tag$ AS body'), 'SELECT $tag$; update$tag$ AS body')
  assert.equal(assertReadQuery("SELECT data #>> '{a,b}' AS value FROM t"), "SELECT data #>> '{a,b}' AS value FROM t")
})

test('assertReadQuery 拒绝 data-modifying CTE / INTO OUTFILE / 行锁 / PRAGMA 赋值', () => {
  assert.throws(() => assertReadQuery('WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone'), /DELETE/)
  assert.throws(() => assertReadQuery("SELECT * FROM t INTO OUTFILE '/tmp/x'"), /INTO/)
  assert.throws(() => assertReadQuery('SELECT * FROM t FOR UPDATE'), /FOR UPDATE/)
  assert.throws(() => assertReadQuery('PRAGMA journal_mode = WAL'), /不接受带参数的 PRAGMA/)
  assert.throws(() => assertReadQuery('PRAGMA journal_mode(WAL)'), /不接受带参数的 PRAGMA/)
})

test('assertReadQuery 连续调用始终拒绝同一 data-modifying CTE', () => {
  const sql = 'WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.throws(() => assertReadQuery(sql), /DELETE/)
  }
})

test('assertReadQuery 放行 SHOW CREATE TABLE 等元数据语句', () => {
  assert.equal(assertReadQuery('SHOW CREATE TABLE users'), 'SHOW CREATE TABLE users')
  assert.equal(assertReadQuery('EXPLAIN SELECT 1'), 'EXPLAIN SELECT 1')
})
