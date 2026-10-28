import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSqlTools, resolveConfig, toCsv } from '../lib/index.js'

function makeTools() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-stats-'))
  const cfg = resolveConfig({ connections: [{ name: 'local', engine: 'sqlite', file: join(dir, 'stats.db') }], maxRows: 100 })
  const { tools } = buildSqlTools(cfg, () => 'ask')
  const exec = tools.find((t) => t.name === 'sql_exec')
  return { tools, exec }
}

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
  const { tools } = buildSqlTools(cfg)
  const health = tools.find((t) => t.name === 'sql_health')
  const value = await health.execute({})
  assert.equal(value.ok, false)
  assert.equal(value.connections[0].ok, false)
  assert.notEqual(value.connections[0].error, '')
})
