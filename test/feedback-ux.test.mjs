import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { annotateError, buildSqlTools, connectionErrorHint, resolveConfig } from '../lib/index.js'

const cleanups = []

function makeTools() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-ux-'))
  const cfg = resolveConfig({ connections: [{ name: 'local', engine: 'sqlite', file: join(dir, 'ux.db') }], maxRows: 100 })
  const { tools, adapters } = buildSqlTools(cfg, () => 'ask')
  cleanups.push(async () => {
    for (const adapter of adapters.values()) await adapter.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { tools, exec: tools.find((t) => t.name === 'sql_exec') }
}

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

test('connectionErrorHint：常见连接与 TLS/SSL、超时错误都给出下一步', () => {
  assert.match(connectionErrorHint('connect ECONNREFUSED 127.0.0.1:5432'), /服务已启动/)
  assert.match(connectionErrorHint("Access denied for user 'root'@'localhost'"), /认证失败/)
  assert.match(connectionErrorHint('SQLITE_CANTOPEN: unable to open database file'), /文件路径/)
  assert.match(connectionErrorHint('relation "users" does not exist'), /sql_schema/)
  assert.match(connectionErrorHint('The server does not support SSL connections'), /ssl/i)
  assert.match(connectionErrorHint('self-signed certificate in certificate chain'), /ssl/i)
  assert.match(connectionErrorHint('no pg_hba.conf entry for host "1.2.3.4", user "u", database "d", no encryption'), /ssl/i)
  assert.match(connectionErrorHint('Connections using insecure transport are prohibited'), /ssl/i)
  assert.match(connectionErrorHint('ERR_TLS_CERT_ALTNAME_INVALID'), /ssl/i)
  assert.match(connectionErrorHint('The operation was aborted due to timeout'), /超时/)
  assert.match(connectionErrorHint('canceling statement due to statement timeout'), /超时/)
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

test('sql_exec：0 行受影响时提示核对条件，并在渲染中展示耗时 durationMs', async () => {
  const { tools, exec } = makeTools()
  await exec.execute({ sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY)' })
  const value = await exec.execute({ sql: 'UPDATE items SET id = 1 WHERE id = 999' })
  assert.equal(value.changes, 0)
  assert.equal(Number.isInteger(value.durationMs), true)
  const rendered = exec.output.render({}, value)[0].text
  assert.match(rendered, /0 行/)
  assert.match(rendered, /耗时 \d+ms/)
  assert.match(rendered, /WHERE 条件/)
})

test('sql_query：默认 Markdown 表格渲染清晰展示耗时与脱敏列提示', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-ux-redact-'))
  const cfg = resolveConfig({
    connections: [{ name: 'local', engine: 'sqlite', file: join(dir, 'ux-r.db') }],
    redactColumns: true,
  })
  const { tools, adapters } = buildSqlTools(cfg, () => 'ask')
  cleanups.push(async () => {
    for (const adapter of adapters.values()) await adapter.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const execTool = tools.find((t) => t.name === 'sql_exec')
  const queryTool = tools.find((t) => t.name === 'sql_query')
  await execTool.execute({ sql: 'CREATE TABLE creds (id INTEGER PRIMARY KEY, api_token TEXT)' })
  await execTool.execute({ sql: "INSERT INTO creds (api_token) VALUES ('tok_live_secret')" })
  const res = await queryTool.execute({ sql: 'SELECT id, api_token FROM creds' })
  const text = queryTool.output.render({}, res)[0].text
  assert.match(text, /查询返回 1 行，耗时 \d+ms（已脱敏列：api_token）/)
  assert.match(text, /\| id \| api_token \|\n\| --- \| --- \|\n\| 1 \| \[REDACTED\] \|/)
  assert.equal(text.includes('tok_live_secret'), false)
})

test('sql_list / sql_health：坏连接渲染给出下一步', async () => {
  const cfg = resolveConfig({ connections: [{ name: 'bad', engine: 'mysql', host: '127.0.0.1', port: 1, database: 'x', user: 'u', password: 'p' }], maxRows: 10, queryTimeoutMs: 5000, execTimeoutMs: 5000 })
  const { tools, adapters } = buildSqlTools(cfg)
  try {
    const list = tools.find((t) => t.name === 'sql_list')
    const listText = list.output.render({}, await list.execute({}))[0].text
    assert.match(listText, /下一步：/)
    assert.match(listText, /127\.0\.0\.1:1/)
    const health = tools.find((t) => t.name === 'sql_health')
    const healthText = health.output.render({}, await health.execute({}))[0].text
    assert.match(healthText, /发现问题/)
    assert.match(healthText, /下一步：/)
  } finally {
    for (const adapter of adapters.values()) await adapter.close()
  }
})
