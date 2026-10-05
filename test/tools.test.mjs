import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSqlTools, resolveConfig, assertReadQuery } from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-tools-'))
const cfg = resolveConfig({ connections: [{ name: 'local', engine: 'sqlite', file: join(dir, 'app.db') }], maxRows: 2 })
const { tools, adapters } = buildSqlTools(cfg)
const list = tools.find((t) => t.name === 'sql_list')
const query = tools.find((t) => t.name === 'sql_query')
const exec = tools.find((t) => t.name === 'sql_exec')
const schema = tools.find((t) => t.name === 'sql_schema')

test('工具 timeoutMs 取配置值', () => {
  const timed = buildSqlTools(resolveConfig({
    connections: cfg.connections,
    maxRows: 2,
    queryTimeoutMs: 15000,
    execTimeoutMs: 30000,
  })).tools
  assert.equal(timed.find((t) => t.name === 'sql_query').timeoutMs, 15000)
  assert.equal(timed.find((t) => t.name === 'sql_exec').timeoutMs, 30000)
  assert.equal(timed.find((t) => t.name === 'sql_list').timeoutMs, 30000)
})

test('构建 6 个工具且名字正确', () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), ['sql_exec', 'sql_health', 'sql_list', 'sql_query', 'sql_schema', 'sql_stats'])
})

test('每个工具 schema 是 object JSON Schema', () => {
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.parameters.properties, 'object')
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
})

test('sql_list：连接健康', async () => {
  const value = await list.execute({})
  assert.equal(value.connections.length, 1)
  assert.equal(value.connections[0].ok, true)
  assert.equal(value.connections[0].name, 'local')
})

test('sql_exec + sql_query + sql_schema 全链路', async () => {
  await exec.execute({ sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)' })
  const insert = await exec.execute({ sql: "INSERT INTO items (label) VALUES ('a'), ('b'), ('c')" })
  assert.equal(insert.changes, 3)
  const result = await query.execute({ sql: 'SELECT * FROM items ORDER BY id' })
  assert.equal(result.rowCount, 3)
  assert.equal(result.rows.length, 2, 'maxRows=2 截断')
  assert.equal(result.truncated, true)
  const tables = await schema.execute({})
  assert.ok(tables.tables.includes('items'))
  const columns = await schema.execute({ table: 'items' })
  assert.equal(columns.columns.length, 2)
  assert.equal(columns.columns[0].primaryKey, true)
})

test('sql_query 拒绝写语句与多语句', async () => {
  await assert.rejects(() => query.execute({ sql: 'DROP TABLE items' }), /只接受只读语句/)
  await assert.rejects(() => query.execute({ sql: 'SELECT 1; SELECT 2' }), /一条语句/)
})

test('sql_exec 在 readOnly 配置下被禁用', async () => {
  const ro = buildSqlTools(resolveConfig({ connections: cfg.connections, readOnly: true })).tools
  const roExec = ro.find((t) => t.name === 'sql_exec')
  await assert.rejects(() => roExec.execute({ sql: 'INSERT INTO items (label) VALUES (\'x\')' }), /readOnly=true/)
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
  assert.throws(() => assertReadQuery('PRAGMA journal_mode = WAL'), /PRAGMA 写操作/)
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

test('cleanup', async () => {
  for (const adapter of adapters.values()) await adapter.close()
  rmSync(dir, { recursive: true, force: true })
})
