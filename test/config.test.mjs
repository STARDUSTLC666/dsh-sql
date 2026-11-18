import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, liveConfig, resolveConfig, assertIdentifier, passwordEnvName } from '../lib/index.js'

test('默认：内存 SQLite 兜底连接', () => {
  const cfg = resolveConfig({})
  assert.equal(cfg.connections.length, 1)
  assert.equal(cfg.connections[0].name, 'default')
  assert.equal(cfg.connections[0].engine, 'sqlite')
  assert.equal(cfg.connections[0].file, ':memory:')
  assert.equal(cfg.maxRows, 1000)
  assert.equal(cfg.writeApproval, true)
})

test('多连接解析 + 密码环境变量回退', () => {
  const cfg = resolveConfig({
    connections: [
      { name: 'local', engine: 'sqlite', file: './x.db' },
      { name: 'prod', engine: 'postgres', host: 'db.internal', database: 'app' },
    ],
  }, { DSH_SQL_PASSWORD_PROD: 'secret123' })
  assert.equal(cfg.connections.length, 2)
  const prod = cfg.connections[1]
  assert.equal(prod.port, 5432)
  assert.equal(prod.password, 'secret123')
  assert.equal(passwordEnvName('my-db'), 'DSH_SQL_PASSWORD_MY_DB')
})

test('配置非法抛中文错误', () => {
  assert.throws(() => resolveConfig({ connections: [{ name: '', engine: 'sqlite' }] }), /需要 name/)
  assert.throws(() => resolveConfig({ connections: [{ name: 'x', engine: 'oracle' }] }), /sqlite \/ mysql \/ postgres/)
  assert.throws(() => resolveConfig({ connections: [{ name: 'a', engine: 'sqlite' }, { name: 'A', engine: 'sqlite' }] }), /重复/)
  assert.throws(() => resolveConfig({ connections: [{ name: 'a', engine: 'mysql' }] }), /缺少 database/)
  assert.throws(() => resolveConfig({ maxRows: -1 }), /maxRows/)
})

test('queryTimeoutMs / execTimeoutMs 默认、校验与钳制', () => {
  const defaults = resolveConfig({})
  assert.equal(defaults.queryTimeoutMs, 60000)
  assert.equal(defaults.execTimeoutMs, 120000)
  const custom = resolveConfig({ queryTimeoutMs: 7000, execTimeoutMs: 9999999 })
  assert.equal(custom.queryTimeoutMs, 7000)
  assert.equal(custom.execTimeoutMs, 600000)
  assert.throws(() => resolveConfig({ queryTimeoutMs: -1 }), /queryTimeoutMs/)
  assert.throws(() => resolveConfig({ execTimeoutMs: 'x' }), /execTimeoutMs/)
})

test('maxRows 钳制到 10000；readOnly 解析', () => {
  assert.equal(resolveConfig({ maxRows: 999999 }).maxRows, 10000)
  assert.equal(resolveConfig({ readOnly: true }).readOnly, true)
})

test('assertIdentifier 防注入', () => {
  assert.equal(assertIdentifier('users', '表名'), 'users')
  assert.throws(() => assertIdentifier('users; DROP TABLE x', '表名'), /非法/)
  assert.throws(() => assertIdentifier('a b', '表名'), /非法/)
})

test('Config Schema 兼容宿主设置面板：嵌套密码脱敏、volatile 热更新与首次未配置指引', async () => {
  assert.equal(Config[Symbol.for('schemastery')], true)
  assert.equal(Config.dict.connections.meta.volatile, true)
  assert.equal(Config.dict.connections.inner.dict.password.meta.role, 'secret')
  assert.equal(Config.dict.maxRows.meta.volatile, true)
  assert.equal(Config.dict.readOnly.meta.volatile, true)

  const serialized = JSON.parse(JSON.stringify(Config))
  assert.equal(typeof serialized.uid, 'number')
  assert.ok(serialized.refs && typeof serialized.refs === 'object')

  const parsed = Config({})
  const registered = []
  apply({
    get(name) { return name === 'approval' ? { config: { policy: 'ask' } } : undefined },
    tools: { register(def) { registered.push(def); return () => {} } },
    on() { return () => {} },
  }, parsed)

  const schemaTool = registered.find((t) => t.name === 'sql_schema')
  const firstSchema = await schemaTool.execute({})
  assert.equal(firstSchema.implicitMemoryDefault, true)
  assert.match(schemaTool.output.render({}, firstSchema)[0].text, /设置 → 插件 → 数据库/)

  const updated = Config({ connections: [{ name: 'local', engine: 'sqlite', file: ':memory:' }], readOnly: true })
  const writeSym = Symbol.for('cosmokit.volatile.write')
  parsed.connections[writeSym](updated.connections.get())
  parsed.readOnly[writeSym](updated.readOnly.get())
  assert.equal(liveConfig(parsed).readOnly, true)
  const listTool = registered.find((t) => t.name === 'sql_list')
  const listed = await listTool.execute({})
  assert.equal(listed.connections[0].name, 'local')
  assert.equal(listed.implicitMemoryDefault, undefined)
})
