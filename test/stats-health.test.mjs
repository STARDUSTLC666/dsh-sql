import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSqlTools, resolveConfig, toCsv } from '../lib/index.js'

const cleanups = []

function makeTools() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-stats-'))
  const cfg = resolveConfig({ connections: [{ name: 'local', engine: 'sqlite', file: join(dir, 'stats.db') }], maxRows: 100 })
  const { tools, adapters } = buildSqlTools(cfg, () => 'ask')
  const exec = tools.find((t) => t.name === 'sql_exec')
  cleanups.push(async () => {
    for (const adapter of adapters.values()) await adapter.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { tools, exec, adapters }
}

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

test('sql_stats：表数/行数/库体积', async () => {
  const { tools, exec } = makeTools()
  await exec.execute({ sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)' })
  await exec.execute({ sql: "INSERT INTO items (label) VALUES ('a'), ('b'), ('c')" })
  const stats = tools.find((t) => t.name === 'sql_stats')
  const value = await stats.execute({})
  assert.equal(value.connection, 'local')
  assert.equal(value.engine, 'sqlite')
  assert.ok(value.tableCount >= 1)
  const items = value.tables.find((t) => t.name === 'items')
  assert.equal(items.rowCount, 3)
  assert.ok(value.sizeBytes > 0)
  const blocks = stats.output.render({}, value)
  assert.match(blocks[0].text, /共 \d+ 张表/)
})

test('sql_stats：PostgreSQL 多 schema + 表体积，MySQL 排除 VIEW + 表体积', async () => {
  const cfg = resolveConfig({
    connections: [
      { name: 'pg', engine: 'postgres', database: 'app' },
      { name: 'my', engine: 'mysql', database: 'shop' },
    ],
  })
  const { tools, adapters } = buildSqlTools(cfg, () => 'ask')
  const pgQueries = []
  const myQueries = []
  adapters.set('pg', {
    engine: 'postgres',
    async listTables() { return [] },
    async describeTable() { return [] },
    async query(sql) {
      pgQueries.push(sql)
      if (sql.includes('pg_database_size')) return { columns: ['s'], rows: [[1048576]] }
      return {
        columns: ['schemaname', 'relname', 'n_live_tup', 'total_bytes'],
        rows: [
          ['public', 'users', 42, 16384],
          ['analytics', 'events', 1000, 65536],
        ],
      }
    },
    async exec() { return 0 },
    async ping() {},
    async close() {},
  })
  adapters.set('my', {
    engine: 'mysql',
    async listTables() { return [] },
    async describeTable() { return [] },
    async query(sql) {
      myQueries.push(sql)
      if (sql.includes('SUM(')) return { columns: ['s'], rows: [[204800]] }
      return {
        columns: ['TABLE_NAME', 'TABLE_ROWS', 'total_bytes'],
        rows: [['orders', 120, 32768]],
      }
    },
    async exec() { return 0 },
    async ping() {},
    async close() {},
  })

  const stats = tools.find((t) => t.name === 'sql_stats')
  const pgStats = await stats.execute({ connection: 'pg' })
  assert.ok(pgQueries.some((q) => q.includes('pg_total_relation_size') && q.includes('schemaname')))
  assert.deepEqual(pgStats.tables, [
    { name: 'users', rowCount: 42, sizeBytes: 16384 },
    { name: 'analytics.events', rowCount: 1000, sizeBytes: 65536 },
  ])
  const pgRendered = stats.output.render({}, pgStats)[0].text
  assert.match(pgRendered, /analytics\.events：1000 行，64\.0 KB/)

  const myStats = await stats.execute({ connection: 'my' })
  assert.ok(myQueries.some((q) => q.includes("TABLE_TYPE = 'BASE TABLE'")))
  assert.deepEqual(myStats.tables, [{ name: 'orders', rowCount: 120, sizeBytes: 32768 }])
})

test('sql_stats：不存在的连接给中文指引', async () => {
  const { tools } = makeTools()
  const stats = tools.find((t) => t.name === 'sql_stats')
  await assert.rejects(() => stats.execute({ connection: 'nope' }), /sql_list/)
})

test('sql_query format=csv：含表头与转义', async () => {
  const { tools, exec } = makeTools()
  await exec.execute({ sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY, note TEXT)' })
  await exec.execute({ sql: "INSERT INTO t (note) VALUES ('he said \"hi\", ok'), ('line1\nline2')" })
  const query = tools.find((t) => t.name === 'sql_query')
  const value = await query.execute({ sql: 'SELECT id, note FROM t ORDER BY id', format: 'csv' })
  assert.equal(value.format, 'csv')
  const lines = value.formatted.split('\n')
  assert.equal(lines[0], 'id,note')
  assert.equal(lines[1], '1,"he said ""hi"", ok"')
  assert.match(lines[2], /^2,"line1/)
  const blocks = query.output.render({}, value)
  assert.match(blocks[0].text, /csv 格式/)
})

test('sql_query format=json：可解析回对象数组', async () => {
  const { tools, exec } = makeTools()
  await exec.execute({ sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY, note TEXT)' })
  await exec.execute({ sql: "INSERT INTO t (note) VALUES ('x')" })
  const query = tools.find((t) => t.name === 'sql_query')
  const value = await query.execute({ sql: 'SELECT id, note FROM t', format: 'json' })
  const parsed = JSON.parse(value.formatted)
  assert.deepEqual(parsed, [{ id: 1, note: 'x' }])
})

test('sql_query 默认格式不产生 formatted 字段', async () => {
  const { tools, exec } = makeTools()
  await exec.execute({ sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY)' })
  const query = tools.find((t) => t.name === 'sql_query')
  const value = await query.execute({ sql: 'SELECT * FROM t' })
  assert.equal(value.formatted, undefined)
})

test('toCsv 空结果只输出表头', () => {
  assert.equal(toCsv(['a', 'b'], []), 'a,b')
})

test('sql_health：连接正常时 ok=true 且汇总安全配置', async () => {
  const { tools } = makeTools()
  const health = tools.find((t) => t.name === 'sql_health')
  const value = await health.execute({})
  assert.equal(value.ok, true)
  assert.equal(value.connections[0].ok, true)
  assert.equal(value.readOnly, false)
  assert.equal(value.writeApproval, true)
  assert.equal(typeof value.maxRows, 'number')
  const blocks = health.output.render({}, value)
  assert.match(blocks[0].text, /自检：正常/)
})

test('sql_health：坏连接报 ok=false 且错误可读', async () => {
  const cfg = resolveConfig({ connections: [{ name: 'bad', engine: 'mysql', host: '127.0.0.1', port: 1, database: 'x', user: 'u', password: 'p' }], maxRows: 10, queryTimeoutMs: 5000, execTimeoutMs: 5000 })
  const { tools, adapters } = buildSqlTools(cfg)
  try {
    const health = tools.find((t) => t.name === 'sql_health')
    const value = await health.execute({})
    assert.equal(value.ok, false)
    assert.equal(value.connections[0].ok, false)
    assert.notEqual(value.connections[0].error, '')
  } finally {
    for (const adapter of adapters.values()) await adapter.close()
  }
})

test('pingAllConnections 并发探测：单连接超时/失败不阻塞也不拖垮健康连接，且展示 readOnly / ssl 标签', async () => {
  const baseCfg = resolveConfig({
    connections: [
      { name: 'slow_dead', engine: 'postgres', host: '10.0.0.1', port: 5432, database: 'a', ssl: 'require', readOnly: true },
      { name: 'healthy_a', engine: 'sqlite', file: ':memory:' },
      { name: 'healthy_b', engine: 'sqlite', file: ':memory:', readOnly: true },
    ],
  })
  // 直接传入短 queryTimeoutMs 以快速验证单连接超时隔离
  const { tools, adapters } = buildSqlTools({ ...baseCfg, queryTimeoutMs: 80 }, () => 'ask')
  const started = []
  adapters.set('slow_dead', {
    engine: 'postgres',
    async listTables() { return [] },
    async describeTable() { return [] },
    async query() { return { columns: [], rows: [] } },
    async exec() { return 0 },
    async ping(signal) {
      started.push('slow_dead')
      await new Promise((_resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error('aborted'))
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
    async close() {},
  })
  adapters.set('healthy_a', {
    engine: 'sqlite',
    async listTables() { return [] },
    async describeTable() { return [] },
    async query() { return { columns: [], rows: [] } },
    async exec() { return 0 },
    async ping() {
      started.push('healthy_a')
      await new Promise((resolve) => setTimeout(resolve, 20))
    },
    async close() {},
  })
  adapters.set('healthy_b', {
    engine: 'sqlite',
    async listTables() { return [] },
    async describeTable() { return [] },
    async query() { return { columns: [], rows: [] } },
    async exec() { return 0 },
    async ping() {
      started.push('healthy_b')
      await new Promise((resolve) => setTimeout(resolve, 20))
    },
    async close() {},
  })

  try {
    const list = tools.find((t) => t.name === 'sql_list')
    const t0 = Date.now()
    const result = await list.execute({})
    const elapsed = Date.now() - t0
    assert.deepEqual(started, ['slow_dead', 'healthy_a', 'healthy_b'], '所有连接应立即并发启动探测')
    assert.ok(elapsed < 400, '并发超时不应串行累加，实际耗时 ' + elapsed + 'ms')

    const byName = Object.fromEntries(result.connections.map((c) => [c.name, c]))
    assert.equal(byName.slow_dead.ok, false)
    assert.equal(byName.slow_dead.readOnly, true)
    assert.equal(byName.slow_dead.ssl, true)
    assert.match(byName.slow_dead.error, /超时/)
    assert.equal(byName.healthy_a.ok, true)
    assert.equal(byName.healthy_a.readOnly, false)
    assert.equal(byName.healthy_b.ok, true)
    assert.equal(byName.healthy_b.readOnly, true)

    const rendered = list.output.render({}, result)[0].text
    assert.match(rendered, /slow_dead.*\[只读, SSL\]/)
    assert.match(rendered, /healthy_b.*\[只读\]/)

    // 外部 signal 取消时仍应立即向外抛出
    const controller = new AbortController()
    controller.abort(new Error('caller cancelled ping'))
    await assert.rejects(() => list.execute({}, { signal: controller.signal }), /caller cancelled ping/)
  } finally {
    for (const adapter of adapters.values()) await adapter.close()
  }
})
