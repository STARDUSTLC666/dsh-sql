import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, HostValidationError, liveConfig, resolveConfig, assertIdentifier, parseTableRef, passwordEnvName } from '../lib/index.js'
import { z } from '../lib/host-config.js'

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

test('connections 非数组时直接抛错，不静默回退到 :memory:', () => {
  assert.throws(
    () => resolveConfig({ connections: { mem: { engine: 'sqlite', file: ':memory:' } } }),
    /connections 必须是连接配置数组/,
  )
  assert.throws(() => resolveConfig({ connections: 'sqlite::memory:' }), /connections 必须是连接配置数组/)
  assert.throws(() => resolveConfig({ connections: null }), /connections 必须是连接配置数组/)
  assert.throws(() => resolveConfig({ connections: 123 }), /connections 必须是连接配置数组/)

  const empty = resolveConfig({ connections: [] })
  assert.equal(empty.implicitMemoryDefault, true)
  assert.equal(empty.connections[0].file, ':memory:')
})

test('单连接 readOnly 校验与省略默认值', () => {
  const cfg = resolveConfig({
    connections: [
      { name: 'ro_sqlite', engine: 'sqlite', file: ':memory:', readOnly: true },
      { name: 'rw_sqlite', engine: 'sqlite', file: ':memory:', readOnly: false },
      { name: 'default_pg', engine: 'postgres', database: 'app' },
      { name: 'ro_pg', engine: 'postgres', database: 'app', readOnly: true },
    ],
  })
  assert.equal(cfg.connections[0].readOnly, true)
  assert.equal(Object.hasOwn(cfg.connections[1], 'readOnly'), false)
  assert.equal(Object.hasOwn(cfg.connections[2], 'readOnly'), false)
  assert.equal(cfg.connections[3].readOnly, true)

  assert.throws(
    () => resolveConfig({ connections: [{ name: 'bad', engine: 'sqlite', readOnly: 'true' }] }),
    /readOnly 必须是布尔值/,
  )
  assert.throws(
    () => resolveConfig({ connections: [{ name: 'bad', engine: 'postgres', database: 'app', readOnly: 1 }] }),
    /readOnly 必须是布尔值/,
  )
})

test('连接 ssl 选项支持多种形式并校验非法值', () => {
  const sslObj = { rejectUnauthorized: false, ca: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----' }
  const cfg = resolveConfig({
    connections: [
      { name: 'none', engine: 'postgres', database: 'app' },
      { name: 'bool_on', engine: 'postgres', database: 'app', ssl: true },
      { name: 'bool_off', engine: 'mysql', database: 'app', ssl: false },
      { name: 'mode_disable', engine: 'postgres', database: 'app', ssl: 'disable' },
      { name: 'mode_require', engine: 'postgres', database: 'app', ssl: ' REQUIRE ' },
      { name: 'mode_verify', engine: 'postgres', database: 'app', ssl: 'verify-full' },
      { name: 'obj', engine: 'postgres', database: 'app', ssl: sslObj },
      { name: 'empty_obj', engine: 'mysql', database: 'app', ssl: {} },
    ],
  })
  assert.equal(Object.hasOwn(cfg.connections[0], 'ssl'), false)
  assert.equal(cfg.connections[1].ssl, true)
  assert.equal(cfg.connections[2].ssl, false)
  assert.equal(cfg.connections[3].ssl, 'disable')
  assert.equal(cfg.connections[4].ssl, 'require')
  assert.equal(cfg.connections[5].ssl, 'verify-full')
  assert.deepEqual(cfg.connections[6].ssl, sslObj)
  assert.notEqual(cfg.connections[6].ssl, sslObj)
  assert.deepEqual(cfg.connections[7].ssl, {})

  for (const badSsl of ['prefer', '', 123, null, ['require'], { rejectUnauthorized: 'no' }, { ca: '' }, { ca: 42 }, { unknownKey: true }]) {
    assert.throws(
      () => resolveConfig({ connections: [{ name: 'bad', engine: 'postgres', database: 'app', ssl: badSsl }] }),
      /ssl/,
    )
  }
})

test('连接 url 解析（PostgreSQL / MySQL / SQLite）、显式字段优先级与密码回退顺序', () => {
  const cfg = resolveConfig({
    connections: [
      {
        name: 'pg_url',
        engine: 'postgres',
        url: 'postgres://alice%20a:p%40ss%2F1@db.internal:5433/my%20app?application_name=dsh&sslmode=require',
      },
      {
        name: 'pg_ipv6',
        engine: 'postgres',
        url: 'postgresql://bob@[::1]:5434/analytics?sslmode=verify-full',
      },
      {
        name: 'mysql_url',
        engine: 'mysql',
        url: 'mysql://root:sec%20ret@127.0.0.1:3307/shop?ssl=1',
      },
      {
        name: 'mysql_ssl_off',
        engine: 'mysql',
        url: 'mysql://root@127.0.0.1/shop?ssl=0',
      },
      {
        name: 'override_pg',
        engine: 'postgres',
        url: 'postgres://url_user:url_pw@url.host:5433/url_db?sslmode=require',
        host: 'explicit.host',
        port: 5439,
        user: 'explicit_user',
        password: 'explicit_pw',
        database: 'explicit_db',
        ssl: false,
      },
      {
        name: 'url_over_env',
        engine: 'postgres',
        url: 'postgres://u:url_pw@host/db',
      },
      {
        name: 'env_fallback',
        engine: 'postgres',
        url: 'postgres://u@host/db?ssl=true',
      },
      {
        name: 'empty_pw',
        engine: 'mysql',
        url: 'mysql://u:@host/db?ssl=false',
      },
      { name: 'sq_mem1', engine: 'sqlite', url: 'sqlite::memory:' },
      { name: 'sq_mem2', engine: 'sqlite', url: 'sqlite://:memory:' },
      { name: 'sq_mem3', engine: 'sqlite', url: 'file::memory:?cache=shared' },
      { name: 'sq_posix', engine: 'sqlite', url: 'sqlite:///tmp/my%20data.db' },
      { name: 'sq_win', engine: 'sqlite', url: 'file:///C:/data/app.db' },
      { name: 'sq_rel', engine: 'sqlite', url: 'file:./local.db' },
      { name: 'sq_rel2', engine: 'sqlite', url: 'sqlite://./sub/local.db' },
      { name: 'sq_override', engine: 'sqlite', url: 'sqlite:///tmp/url.db', file: './override.db' },
    ],
  }, {
    DSH_SQL_PASSWORD_OVERRIDE_PG: 'env_pw',
    DSH_SQL_PASSWORD_URL_OVER_ENV: 'env_pw',
    DSH_SQL_PASSWORD_ENV_FALLBACK: 'env_pw',
  })

  const byName = Object.fromEntries(cfg.connections.map((c) => [c.name, c]))

  assert.equal(byName.pg_url.host, 'db.internal')
  assert.equal(byName.pg_url.port, 5433)
  assert.equal(byName.pg_url.user, 'alice a')
  assert.equal(byName.pg_url.password, 'p@ss/1')
  assert.equal(byName.pg_url.database, 'my app')
  assert.equal(byName.pg_url.ssl, 'require')
  assert.equal(Object.hasOwn(byName.pg_url, 'url'), false)

  assert.equal(byName.pg_ipv6.host, '::1')
  assert.equal(byName.pg_ipv6.port, 5434)
  assert.equal(byName.pg_ipv6.ssl, 'verify-full')

  assert.equal(byName.mysql_url.host, '127.0.0.1')
  assert.equal(byName.mysql_url.port, 3307)
  assert.equal(byName.mysql_url.user, 'root')
  assert.equal(byName.mysql_url.password, 'sec ret')
  assert.equal(byName.mysql_url.database, 'shop')
  assert.equal(byName.mysql_url.ssl, true)

  assert.equal(byName.mysql_ssl_off.ssl, false)
  assert.equal(byName.mysql_ssl_off.port, 3306)

  assert.equal(byName.override_pg.host, 'explicit.host')
  assert.equal(byName.override_pg.port, 5439)
  assert.equal(byName.override_pg.user, 'explicit_user')
  assert.equal(byName.override_pg.password, 'explicit_pw')
  assert.equal(byName.override_pg.database, 'explicit_db')
  assert.equal(byName.override_pg.ssl, false)

  assert.equal(byName.url_over_env.password, 'url_pw')
  assert.equal(byName.env_fallback.password, 'env_pw')
  assert.equal(byName.env_fallback.ssl, true)
  assert.equal(byName.empty_pw.password, '')
  assert.equal(byName.empty_pw.ssl, false)

  assert.equal(byName.sq_mem1.file, ':memory:')
  assert.equal(byName.sq_mem2.file, ':memory:')
  assert.equal(byName.sq_mem3.file, ':memory:')
  assert.equal(byName.sq_posix.file, '/tmp/my data.db')
  assert.equal(byName.sq_win.file, 'C:/data/app.db')
  assert.equal(byName.sq_rel.file, './local.db')
  assert.equal(byName.sq_rel2.file, './sub/local.db')
  assert.equal(byName.sq_override.file, './override.db')
  assert.equal(Object.hasOwn(byName.sq_posix, 'url'), false)
})

test('非法 url 报清晰中文错误且绝不回显密码', () => {
  const secret = 'SuperSecret_DoNotLeak_999!'
  const cases = [
    { engine: 'postgres', url: `postgres://admin:${secret}@bad host:abc/app` },
    { engine: 'postgres', url: `postgres://admin:${secret}@host:0/app` },
    { engine: 'postgres', url: `postgres://admin:${secret}@host:70000/app` },
    { engine: 'postgres', url: `postgres://admin:${secret}%ZZ@host/app` },
    { engine: 'postgres', url: `mysql://admin:${secret}@host/app` },
    { engine: 'postgres', url: `postgres:${secret}` },
    { engine: 'mysql', url: `postgres://admin:${secret}@host/app` },
    { engine: 'postgres', url: `postgres://admin:${secret}@host/app?sslmode=bogus` },
    { engine: 'mysql', url: `mysql://admin:${secret}@host/app?ssl=maybe` },
    { engine: 'sqlite', url: `postgres://admin:${secret}@host/app` },
    { engine: 'sqlite', url: 'sqlite://' },
    { engine: 'sqlite', url: 'sqlite:///' },
    { engine: 'postgres', url: 'not-a-valid-url' },
    { engine: 'postgres', url: 12345 },
  ]
  for (const item of cases) {
    assert.throws(
      () => resolveConfig({ connections: [{ name: 'bad_url', ...item }] }),
      (error) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /url/)
        assert.equal(error.message.includes(secret), false, 'error message must not echo password')
        return true
      },
    )
  }
})

test('parseTableRef 支持 schema.table、连字符、Unicode 与引号标识符，并拦截非法输入', () => {
  assert.deepEqual(parseTableRef('users'), { table: 'users' })
  assert.equal(Object.hasOwn(parseTableRef('users'), 'schema'), false)
  assert.deepEqual(parseTableRef('analytics.events'), { schema: 'analytics', table: 'events' })
  assert.deepEqual(parseTableRef('user-events'), { table: 'user-events' })
  assert.deepEqual(parseTableRef('订单表'), { table: '订单表' })
  assert.deepEqual(parseTableRef('"my.table"'), { table: 'my.table' })
  assert.deepEqual(parseTableRef('`my-table`'), { table: 'my-table' })
  assert.deepEqual(parseTableRef('"analytics"."events"'), { schema: 'analytics', table: 'events' })
  assert.deepEqual(parseTableRef('  "analytics".events  '), { schema: 'analytics', table: 'events' })
  assert.deepEqual(parseTableRef('`my_db`.`my.table`'), { schema: 'my_db', table: 'my.table' })
  assert.deepEqual(parseTableRef('"a""b"."c.d"'), { schema: 'a"b', table: 'c.d' })
  assert.deepEqual(parseTableRef('`a``b`'), { table: 'a`b' })
  assert.deepEqual(parseTableRef('"a.b.c"'), { table: 'a.b.c' })
  assert.deepEqual(parseTableRef('"my;table"'), { table: 'my;table' })

  const badInputs = [
    '',
    '   ',
    'users\0',
    'users\nDROP TABLE x',
    'users\r',
    'users\t',
    'users\x1f',
    'users\x7f',
    '"users\x00"',
    'users; DROP TABLE x',
    'users;DROP',
    'users--comment',
    'users/*comment*/',
    'a.b.c',
    '"a"."b"."c"',
    '.events',
    'analytics.',
    'a..b',
    '""',
    '""."events"',
    '"analytics".""',
    '"unclosed',
    '`unclosed',
    '"users"extra',
    'users"extra"',
    'users()',
    'users,other',
    'a b',
  ]
  for (const bad of badInputs) {
    assert.throws(() => parseTableRef(bad, '目标表'), /目标表/)
  }
  assert.throws(() => parseTableRef(''), /表名/)
})

test('host-config：number 拒绝 Infinity/-Infinity/NaN，toJSON 异常后清理全局 refs，且顶层默认与连接字段齐全', () => {
  // 1. Infinity / -Infinity / NaN 拒绝
  const numSchema = z.number()
  assert.equal(numSchema(42), 42)
  assert.throws(() => numSchema(Infinity), HostValidationError)
  assert.throws(() => numSchema(-Infinity), HostValidationError)
  assert.throws(() => numSchema(NaN), HostValidationError)
  assert.throws(() => Config({ maxRows: Infinity }), HostValidationError)
  assert.throws(() => Config({ queryTimeoutMs: -Infinity }), HostValidationError)

  // 2. toJSON() 出错时通过 try/finally 清理 globalThis.__schemastery_refs__
  const broken = z.string().extra('extra', 1n)
  assert.throws(() => JSON.stringify(broken), TypeError)
  assert.equal(globalThis.__schemastery_refs__, undefined)
  const recovered = JSON.parse(JSON.stringify(Config))
  assert.equal(typeof recovered.uid, 'number')
  assert.ok(recovered.refs && typeof recovered.refs === 'object')

  // 3. 顶层字段 .default(...) 元数据与运行时解析一致
  assert.equal(Config.dict.maxRows.meta.default, 1000)
  assert.equal(Config.dict.readOnly.meta.default, false)
  assert.equal(Config.dict.writeApproval.meta.default, true)
  assert.equal(Config.dict.queryTimeoutMs.meta.default, 60000)
  assert.equal(Config.dict.execTimeoutMs.meta.default, 120000)

  const defaultsParsed = Config({})
  assert.deepEqual(defaultsParsed.connections.get(), [])
  assert.equal(defaultsParsed.maxRows.get(), 1000)
  assert.equal(defaultsParsed.readOnly.get(), false)
  assert.equal(defaultsParsed.writeApproval.get(), true)
  assert.equal(defaultsParsed.queryTimeoutMs.get(), 60000)
  assert.equal(defaultsParsed.execTimeoutMs.get(), 120000)
  assert.equal(Config.simplify(defaultsParsed), null)

  const resolvedDefaults = resolveConfig(liveConfig(defaultsParsed))
  assert.equal(resolvedDefaults.implicitMemoryDefault, true)
  assert.equal(resolvedDefaults.maxRows, 1000)
  assert.equal(resolvedDefaults.readOnly, false)
  assert.equal(resolvedDefaults.writeApproval, true)
  assert.equal(resolvedDefaults.queryTimeoutMs, 60000)
  assert.equal(resolvedDefaults.execTimeoutMs, 120000)

  // 4. ConnectionSchema 暴露 url / readOnly / ssl 及其 zh/en i18n 描述
  const connDict = Config.dict.connections.inner.dict
  for (const field of ['url', 'readOnly', 'ssl']) {
    assert.ok(connDict[field], `ConnectionSchema should expose ${field}`)
    assert.equal(typeof connDict[field].meta.description.zh, 'string')
    assert.equal(typeof connDict[field].meta.description.en, 'string')
  }
  const withNewFields = Config({
    connections: [
      {
        name: 'cloud',
        engine: 'postgres',
        url: 'postgres://u@db.cloud/app',
        readOnly: true,
        ssl: 'verify-full',
      },
      {
        name: 'bool_true',
        engine: 'postgres',
        database: 'app',
        ssl: true,
      },
      {
        name: 'bool_false',
        engine: 'mysql',
        database: 'app',
        ssl: false,
      },
      {
        name: 'obj_ssl',
        engine: 'postgres',
        database: 'app',
        ssl: { rejectUnauthorized: false, ca: 'pem' },
      },
      {
        name: 'no_ssl',
        engine: 'postgres',
        database: 'app',
      },
    ],
  })
  const liveConns = liveConfig(withNewFields).connections
  assert.equal(liveConns[0].ssl, 'verify-full')
  assert.equal(liveConns[0].readOnly, true)
  assert.equal(liveConns[1].ssl, true)
  assert.equal(liveConns[2].ssl, false)
  assert.deepEqual(liveConns[3].ssl, { rejectUnauthorized: false, ca: 'pem' })
  assert.equal(Object.hasOwn(liveConns[4], 'ssl'), false)
  assert.equal(liveConns[4].ssl, undefined)

  const resolvedFromSchema = resolveConfig(liveConfig(withNewFields))
  assert.equal(resolvedFromSchema.connections[1].ssl, true)
  assert.equal(resolvedFromSchema.connections[2].ssl, false)
  assert.deepEqual(resolvedFromSchema.connections[3].ssl, { rejectUnauthorized: false, ca: 'pem' })
  assert.equal(Object.hasOwn(resolvedFromSchema.connections[4], 'ssl'), false)

  for (const badSsl of ['invalid', 123, ['require'], { rejectUnauthorized: 'no' }, { ca: 123 }]) {
    assert.throws(
      () => Config({ connections: [{ name: 'cloud', engine: 'postgres', ssl: badSsl }] }),
      HostValidationError,
    )
  }
})
