import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { annotateError, buildSqlTools, connectionErrorHint, resolveConfig } from '../lib/index.js'

function makeTools() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-ux-'))
  const cfg = resolveConfig({ connections: [{ name: 'local', engine: 'sqlite', file: join(dir, 'ux.db') }], maxRows: 100 })
  const { tools } = buildSqlTools(cfg, () => 'ask')
  return { tools, exec: tools.find((t) => t.name === 'sql_exec') }
}

test('connectionErrorHint：常见连接错误都给出下一步', () => {
  assert.match(connectionErrorHint('connect ECONNREFUSED 127.0.0.1:5432'), /服务已启动/)
  assert.match(connectionErrorHint('Access denied for user \'root\'@\'localhost\''), /认证失败/)
  assert.match(connectionErrorHint("SQLITE_CANTOPEN: unable to open database file"), /文件路径/)
  assert.match(connectionErrorHint("relation \"users\" does not exist"), /sql_schema/)
  assert.equal(connectionErrorHint('Something unrelated broke'), undefined)
})

test('annotateError：保留原文并只补一行下一步，不可识别时原样返回', () => {
  const original = new Error('connect ECONNREFUSED 127.0.0.1:5432')
  const annotated = annotateError(original)
  assert.match(annotated.message, /ECONNREFUSED/)
  assert.match(annotated.message, /下一步：/)
  // 二次包装不重复追加
  assert.equal(annotateError(annotated).message, annotated.message)
  const other = new Error('未知问题')
  assert.equal(annotateError(other).message, '未知问题')
})

test('sql_schema：表不存在时说清原因，不谎报「共 0 张表」', async () => {
  const { tools, exec } = makeTools()
  await exec.execute({ sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY)' })
  const schema = tools.find((t) => t.name === 'sql_schema')
  const missing = await schema.execute({ table: 'nope' })
  assert.deepEqual(missing.columns, [])
  const text = schema.output.render({}, missing)[0].text
  assert.doesNotMatch(text, /共 0 张表/)
  assert.match(text, /下一步：/)
  assert.match(text, /nope/)
  const tables = schema.output.render({}, await schema.execute({}))
  assert.match(tables[0].text, /items/)
})

test('sql_exec：0 行受影响时提示核对条件', async () => {
  const { tools, exec } = makeTools()
  await exec.execute({ sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY)' })
  const value = await exec.execute({ sql: 'UPDATE items SET id = 1 WHERE id = 999' })
  assert.equal(value.changes, 0)
  assert.match(exec.output.render({}, value)[0].text, /0 行/)
  assert.match(exec.output.render({}, value)[0].text, /WHERE 条件/)
})

test('sql_list / sql_health：坏连接渲染给出下一步', async () => {
  const cfg = resolveConfig({ connections: [{ name: 'bad', engine: 'mysql', host: '127.0.0.1', port: 1, database: 'x', user: 'u', password: 'p' }], maxRows: 10, queryTimeoutMs: 5000, execTimeoutMs: 5000 })
  const { tools } = buildSqlTools(cfg)
  const list = tools.find((t) => t.name === 'sql_list')
  const listText = list.output.render({}, await list.execute({}))[0].text
  assert.match(listText, /下一步：/)
  assert.match(listText, /127\.0\.0\.1:1/)
  const health = tools.find((t) => t.name === 'sql_health')
  const healthText = health.output.render({}, await health.execute({}))[0].text
  assert.match(healthText, /发现问题/)
  assert.match(healthText, /下一步：/)
})
