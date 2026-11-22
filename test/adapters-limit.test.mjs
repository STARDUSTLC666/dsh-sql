import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import MysqlQuery from '../node_modules/mysql2/lib/commands/query.js'
import pg from 'pg'
import { createAdapter, mysqlPoolConfig, postgresPoolConfig } from '../lib/index.js'

function pgFixture(values, { fail = false, stall = false, columns = ['a'], failControl, dataTypeID = 23 } = {}) {
  const adapter = createAdapter({ name: 'pg', engine: 'postgres', database: 'app' })
  const state = { released: [], produced: 0, query: undefined, commands: [], lastQueryConfig: undefined }
  adapter.pool = {
    async connect() {
      return {
        release(force) { state.released.push(force === true) },
        query(query) {
          state.commands.push(typeof query === 'string' ? query : query.text)
          if (typeof query === 'string') {
            assert.ok(['BEGIN READ ONLY', 'ROLLBACK'].includes(query) || /^SET LOCAL statement_timeout = \d+$/.test(query), 'unexpected control command: ' + query)
            return query === failControl ? Promise.reject(new Error('control failed: ' + query)) : Promise.resolve({})
          }
          state.lastQueryConfig = query
          if (!(query instanceof pg.Query)) {
            if (fail) return Promise.reject(new Error('pg query failed'))
            return Promise.resolve({ fields: columns.map(name => ({ name })), rows: values.map(value => Array.isArray(value) ? value : [value]) })
          }
          assert.ok(query instanceof pg.Query)
          state.query = query
          queueMicrotask(() => {
            if (stall) return
            if (fail) return query.emit('error', new Error('pg query failed'))
            query.handleRowDescription({ fields: columns.map(name => ({ name, dataTypeID, format: 'text' })) })
            for (const value of values) {
              if (state.released.includes(true)) break
              state.produced += 1
              query.handleDataRow({ fields: (Array.isArray(value) ? value : [value]).map(item => Buffer.from(String(item))) })
            }
            if (state.released.includes(true)) query.emit('error', new Error('connection closed'))
            else query.emit('end', query._result)
          })
          return query
        },
      }
    },
  }
  return { adapter, state }
}

test('PostgreSQL：真实 pg.Query 行事件在上限结束，内部不累计结果', async () => {
  const { adapter, state } = pgFixture([1, 2, 3, 4, 5])
  const result = await adapter.query('SELECT a FROM t ORDER BY a', 3)
  assert.deepEqual(result, { columns: ['a'], rows: [[1], [2], [3]] })
  assert.equal(state.produced, 3)
  assert.deepEqual(state.released, [true])
  assert.deepEqual(state.query._result.rows, [])
  assert.equal(state.query.requiresPreparation(), true, 'extended protocol must reject multiple commands')
  assert.deepEqual(state.commands, ['BEGIN READ ONLY', 'SELECT a FROM t ORDER BY a'])
})

function mysqlFixture(values, { fail = false, stall = false, columns = ['a'], failControl } = {}) {
  const adapter = createAdapter({ name: 'my', engine: 'mysql', database: 'app' })
  const state = { destroyed: false, released: false, produced: 0, commands: [], lastQueryOptions: undefined }
  adapter.pool = {
    async getConnection() {
      return {
        destroy() { state.destroyed = true },
        release() { state.released = true },
        query(query) {
          state.commands.push(typeof query === 'string' ? query : query.sql)
          if (typeof query === 'string') {
            assert.ok(['START TRANSACTION READ ONLY', 'ROLLBACK'].includes(query))
            return query === failControl ? Promise.reject(new Error('control failed: ' + query)) : Promise.resolve([[], []])
          }
          state.lastQueryOptions = query
          if (fail) return Promise.reject(new Error('mysql query failed'))
          return Promise.resolve([values.map(value => Array.isArray(value) ? value : [value]), columns.map(name => ({ name }))])
        },
        connection: {
          query(sql) {
            state.commands.push(sql.sql)
            state.lastQueryOptions = sql
            const query = new MysqlQuery({ sql })
            let paused = false
            let ended = false
            const pump = () => {
              if (ended || state.destroyed) return
              if (stall) return
              if (fail) { ended = true; query.emit('error', new Error('mysql query failed')); return }
              while (!paused && !state.destroyed && state.produced < values.length) {
                const value = values[state.produced++]
                query.emit('result', Array.isArray(value) ? value : { a: value })
              }
              if (!state.destroyed && state.produced === values.length) {
                ended = true
                query.emit('end')
              }
            }
            query._connection = {
              pause() { paused = true },
              resume() { paused = false; queueMicrotask(pump) },
            }
            queueMicrotask(() => { query.emit('fields', columns.map(name => ({ name }))); pump() })
            return query
          },
        },
      }
    },
  }
  return { adapter, state }
}

test('MySQL：真实 mysql2 Readable 消费超过 64 行，并在上限销毁专用连接', { timeout: 1000 }, async () => {
  const { adapter, state } = mysqlFixture(Array.from({ length: 250 }, (_, i) => i))
  const result = await adapter.query('SELECT a FROM t ORDER BY a', 150)
  assert.deepEqual(result.columns, ['a'])
  assert.equal(result.rows.length, 150)
  assert.deepEqual(result.rows[149], [149])
  assert.equal(state.destroyed, true)
  assert.equal(state.released, false)
})

test('MySQL / PostgreSQL：少于上限和零行结果保留列名、正常归还连接', async () => {
  for (const makeFixture of [mysqlFixture, pgFixture]) {
    for (const values of [[], [1, 2]]) {
      const { adapter, state } = makeFixture(values)
      const result = await adapter.query('SELECT a FROM t', 10)
      assert.deepEqual(result, { columns: ['a'], rows: values.map(value => [value]) })
      if (makeFixture === mysqlFixture) {
        assert.equal(state.destroyed, false)
        assert.equal(state.released, true)
      } else assert.deepEqual(state.released, [false])
    }
  }
})

test('PostgreSQL：有界查询转发驱动错误并归还连接', async () => {
  const { adapter, state } = pgFixture([], { fail: true })
  await assert.rejects(adapter.query('SELECT broken', 10), /pg query failed/)
  assert.deepEqual(state.released, [false])
})

test('MySQL / PostgreSQL：行数组保留同名列的不同值，零行也保留两列', async () => {
  for (const makeFixture of [mysqlFixture, pgFixture]) {
    for (const values of [[], [[1, 2]]]) {
      const { adapter } = makeFixture(values, { columns: ['value', 'value'] })
      assert.deepEqual(await adapter.query('SELECT 1 AS value, 2 AS value', 10), {
        columns: ['value', 'value'], rows: values,
      })
    }
  }
})

test('MySQL：有界查询转发 Readable 错误', async () => {
  const { adapter, state } = mysqlFixture([], { fail: true })
  await assert.rejects(adapter.query('SELECT broken', 10), /mysql query failed/)
  assert.equal(state.released, true)
})

test('MySQL / PostgreSQL：有界查询取消时销毁专用连接', async () => {
  for (const makeFixture of [mysqlFixture, pgFixture]) {
    const { adapter, state } = makeFixture([], { stall: true })
    const controller = new AbortController()
    const pending = adapter.query('SELECT slow', 10, controller.signal)
    await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('cancel capped query'))
    await assert.rejects(pending, /cancel capped query/)
    if (makeFixture === mysqlFixture) {
      assert.equal(state.destroyed, true)
      assert.equal(state.released, false)
    } else assert.deepEqual(state.released, [true])
  }
})

test('MySQL / PostgreSQL：已取消的有界查询不请求连接', async () => {
  for (const engine of ['mysql', 'postgres']) {
    const adapter = createAdapter({ name: 'unused', engine })
    adapter.pool = {
      connect() { assert.fail('must not connect') },
      getConnection() { assert.fail('must not acquire') },
    }
    const controller = new AbortController()
    controller.abort(new Error('cancelled before query'))
    await assert.rejects(adapter.query('SELECT a', 10, controller.signal), /cancelled before query/)
  }
})

test('查询结果 bigint：安全整数转 number，超出安全范围转十进制字符串', async () => {
  const adapter = createAdapter({ name: 'my', engine: 'mysql', database: 'app' })
  adapter.pool = {
    async getConnection() { return {
      release() {}, destroy() {},
      async query(sql) {
      if (typeof sql === 'string') return [[], []]
      assert.equal(sql.sql, 'SELECT safe, too_large, too_small FROM t')
      assert.equal(sql.rowsAsArray, true)
      return [[{
        safe: 9007199254740991n,
        too_large: 9007199254740993n,
        too_small: -9007199254740993n,
      }], []]
      },
    } },
  }

  const result = await adapter.query('SELECT safe, too_large, too_small FROM t')
  assert.deepEqual(result.columns, ['safe', 'too_large', 'too_small'])
  assert.deepEqual(result.rows, [[9007199254740991, '9007199254740993', '-9007199254740993']])
  assert.doesNotThrow(() => JSON.stringify(result))
})

test('查询结果 Uint8Array / Buffer：短二进制转 0x 十六进制，大二进制输出紧凑摘要', async () => {
  const small = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
  const empty = new Uint8Array(0)
  const sliced = new Uint8Array([0x00, 0xaa, 0xbb, 0xff]).subarray(1, 3)
  const boundary64 = Buffer.alloc(64, 0x0f)
  const large = Buffer.alloc(200, 0xab)

  const adapter = createAdapter({ name: 'pg', engine: 'postgres', database: 'app' })
  adapter.pool = {
    async connect() {
      return {
        release() {},
        async query(q) {
          if (typeof q === 'string') return {}
          return {
            fields: [{ name: 'small' }, { name: 'empty' }, { name: 'sliced' }, { name: 'b64' }, { name: 'large' }],
            rows: [[small, empty, sliced, boundary64, large]],
          }
        },
      }
    },
  }
  const result = await adapter.query('SELECT small, empty, sliced, b64, large FROM blobs')
  assert.equal(result.rows[0][0], '0xdeadbeef')
  assert.equal(result.rows[0][1], '0x')
  assert.equal(result.rows[0][2], '0xaabb')
  assert.equal(result.rows[0][3], '0x' + '0f'.repeat(64))
  assert.equal(result.rows[0][4], '<BLOB 200 bytes, hex: 0x' + 'ab'.repeat(16) + '...>')
})

test('MySQL：取消信号销毁专用连接，不把取消后的连接放回池', async () => {
  const adapter = createAdapter({ name: 'my', engine: 'mysql', database: 'app' })
  let destroyed = false
  let released = false
  adapter.pool = {
    async getConnection() {
      return {
        query: async () => await new Promise(() => {}),
        destroy() { destroyed = true },
        release() { released = true },
      }
    },
  }
  const controller = new AbortController()
  const pending = adapter.query('SELECT SLEEP(10)', undefined, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort(new Error('cancel mysql'))
  await assert.rejects(pending, /cancel mysql/)
  assert.equal(destroyed, true)
  assert.equal(released, false)
})

test('PostgreSQL：取消信号销毁专用连接', async () => {
  const adapter = createAdapter({ name: 'pg', engine: 'postgres', database: 'app' })
  let forcedRelease = false
  adapter.pool = {
    async connect() {
      return {
        query: async () => await new Promise(() => {}),
        release(force) { forcedRelease = force === true },
      }
    },
  }
  const controller = new AbortController()
  const pending = adapter.query('SELECT pg_sleep(10)', undefined, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort(new Error('cancel postgres'))
  await assert.rejects(pending, /cancel postgres/)
  assert.equal(forcedRelease, true)
})

test('MySQL / PostgreSQL：查询独立只读，成功或查询错误后回滚，再归还连接', async () => {
  for (const makeFixture of [mysqlFixture, pgFixture]) {
    for (const limit of [undefined, 10]) {
      const { adapter, state } = makeFixture([1])
      assert.deepEqual((await adapter.query('SELECT a FROM t', limit)).rows, [[1]])
      assert.deepEqual(state.commands, [makeFixture === mysqlFixture ? 'START TRANSACTION READ ONLY' : 'BEGIN READ ONLY', 'SELECT a FROM t', 'ROLLBACK'])
    }
    const { adapter, state } = makeFixture([], { fail: true })
    await assert.rejects(adapter.query('SELECT broken', 10), /query failed/)
    assert.equal(state.commands.at(-1), 'ROLLBACK')
  }
})

test('MySQL / PostgreSQL：只读事务建立失败时不发多余 ROLLBACK 且销毁连接，回滚失败时销毁连接', async () => {
  for (const makeFixture of [mysqlFixture, pgFixture]) {
    const begin = makeFixture === mysqlFixture ? 'START TRANSACTION READ ONLY' : 'BEGIN READ ONLY'
    const setup = makeFixture([1], { failControl: begin })
    await assert.rejects(setup.adapter.query('SELECT a FROM t', 10), /control failed/)
    assert.deepEqual(setup.state.commands, [begin])
    if (makeFixture === mysqlFixture) {
      assert.equal(setup.state.destroyed, true)
      assert.equal(setup.state.released, false)
    } else assert.deepEqual(setup.state.released, [true])

    const cleanup = makeFixture([1], { failControl: 'ROLLBACK' })
    await assert.rejects(cleanup.adapter.query('SELECT a FROM t', 10), /control failed/)
    if (makeFixture === mysqlFixture) {
      assert.equal(cleanup.state.destroyed, true)
      assert.equal(cleanup.state.released, false)
    } else assert.deepEqual(cleanup.state.released, [true])
  }
})

test('MySQL / PostgreSQL：查询失败后 ROLLBACK 也失败时绝不掩盖主错误，并销毁连接', async () => {
  for (const makeFixture of [mysqlFixture, pgFixture]) {
    for (const limit of [undefined, 10]) {
      const { adapter, state } = makeFixture([], { fail: true, failControl: 'ROLLBACK' })
      await assert.rejects(adapter.query('SELECT broken', limit), /query failed/)
      if (makeFixture === mysqlFixture) {
        assert.equal(state.destroyed, true)
        assert.equal(state.released, false)
      } else {
        assert.deepEqual(state.released, [true])
      }
    }
  }
})

test('PostgreSQL：真实 pg.Pool 创建时立即挂载 error 监听器，空闲断连不会抛未捕获异常', async () => {
  const adapter = createAdapter({ name: 'pg-idle', engine: 'postgres', host: '127.0.0.1', port: 1, database: 'app' })
  try {
    const pool = await adapter.getPool()
    assert.ok(pool instanceof pg.Pool)
    assert.ok(pool.listenerCount('error') >= 1, 'pg.Pool must have idle error listener')
    assert.doesNotThrow(() => pool.emit('error', new Error('idle disconnect')))
  } finally {
    await adapter.close()
  }
})

test('mysqlPoolConfig / postgresPoolConfig：超时默认值与 SSL 选项映射', () => {
  const baseMysql = mysqlPoolConfig({ name: 'm', engine: 'mysql', database: 'app' })
  assert.equal(baseMysql.connectTimeout, 10000)
  assert.equal(baseMysql.multipleStatements, false)
  assert.equal(baseMysql.ssl, undefined)

  const basePg = postgresPoolConfig({ name: 'p', engine: 'postgres', database: 'app' })
  assert.equal(basePg.connectionTimeoutMillis, 10000)
  assert.equal(basePg.ssl, undefined)

  for (const disabled of [false, 'disable', 'allow']) {
    assert.equal(mysqlPoolConfig({ name: 'm', engine: 'mysql', database: 'app', ssl: disabled }).ssl, undefined)
    assert.equal(postgresPoolConfig({ name: 'p', engine: 'postgres', database: 'app', ssl: disabled }).ssl, undefined)
  }

  for (const relaxed of [true, 'prefer', 'require']) {
    assert.deepEqual(mysqlPoolConfig({ name: 'm', engine: 'mysql', database: 'app', ssl: relaxed }).ssl, { rejectUnauthorized: false })
    assert.deepEqual(postgresPoolConfig({ name: 'p', engine: 'postgres', database: 'app', ssl: relaxed }).ssl, { rejectUnauthorized: false })
  }

  for (const strict of ['verify-ca', 'verify-full']) {
    assert.deepEqual(mysqlPoolConfig({ name: 'm', engine: 'mysql', database: 'app', ssl: strict }).ssl, { rejectUnauthorized: true })
    assert.deepEqual(postgresPoolConfig({ name: 'p', engine: 'postgres', database: 'app', ssl: strict }).ssl, { rejectUnauthorized: true })
  }

  const pem = '-----BEGIN CERTIFICATE-----\nMIIBFAKE\n-----END CERTIFICATE-----\n'
  assert.deepEqual(
    postgresPoolConfig({ name: 'p', engine: 'postgres', database: 'app', ssl: { rejectUnauthorized: true, ca: pem } }).ssl,
    { rejectUnauthorized: true, ca: pem },
  )

  const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-ssl-'))
  try {
    const caPath = join(dir, 'ca.pem')
    writeFileSync(caPath, pem, 'utf8')
    assert.deepEqual(
      mysqlPoolConfig({ name: 'm', engine: 'mysql', database: 'app', ssl: { ca: caPath } }).ssl,
      { ca: pem },
    )
    assert.deepEqual(
      postgresPoolConfig({ name: 'p', engine: 'postgres', database: 'app', ssl: { rejectUnauthorized: true, ca: caPath } }).ssl,
      { rejectUnauthorized: true, ca: pem },
    )
    const missingCa = join(dir, 'missing-ca.pem')
    assert.throws(
      () => mysqlPoolConfig({ name: 'm', engine: 'mysql', database: 'app', ssl: { ca: missingCa } }),
      new RegExp('SSL CA 证书文件不存在：.*missing-ca\\.pem.*请检查文件路径或直接提供 PEM 证书内容'),
    )
    assert.throws(
      () => postgresPoolConfig({ name: 'p', engine: 'postgres', database: 'app', ssl: { rejectUnauthorized: true, ca: '  ' + missingCa + '  ' } }),
      new RegExp('SSL CA 证书文件不存在：.*missing-ca\\.pem.*请检查文件路径或直接提供 PEM 证书内容'),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PostgreSQL / MySQL：query 传递 timeoutMs 与 params 参数', async () => {
  for (const limit of [undefined, 10]) {
    const pgFix = pgFixture([42])
    const pgRes = await pgFix.adapter.query('SELECT $1::int AS a', limit, undefined, { params: [42], timeoutMs: 5000 })
    assert.deepEqual(pgRes.rows, [[42]])
    assert.deepEqual(pgFix.state.commands, ['BEGIN READ ONLY', 'SET LOCAL statement_timeout = 5000', 'SELECT $1::int AS a', 'ROLLBACK'])
    assert.deepEqual(pgFix.state.lastQueryConfig.values, [42])

    const myFix = mysqlFixture([42])
    const myRes = await myFix.adapter.query('SELECT ? AS a', limit, undefined, { params: [42], timeoutMs: 5000 })
    assert.deepEqual(myRes.rows, [[42]])
    assert.deepEqual(myFix.state.lastQueryOptions.values, [42])
    assert.equal(myFix.state.lastQueryOptions.timeout, 5000)
  }
})

test('MySQL：exec 单语句、多语句切分事务与回滚、参数化校验', async () => {
  const adapter = createAdapter({ name: 'my', engine: 'mysql', database: 'app' })
  const poolCalls = []
  const connLog = []
  let failOnSql
  let failRollback = false
  let destroyed = false
  let released = false

  adapter.pool = {
    async query(q) {
      poolCalls.push(q)
      return [{ affectedRows: 1 }, []]
    },
    async getConnection() {
      destroyed = false
      released = false
      return {
        destroy() { destroyed = true },
        release() { released = true },
        async query(q) {
          const text = typeof q === 'string' ? q : q.sql
          connLog.push(q)
          if (text === 'ROLLBACK' && failRollback) throw new Error('rollback boom')
          if (failOnSql && text.includes(failOnSql)) throw new Error('exec stmt failed')
          if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || text === 'START TRANSACTION') {
            return [{}, []]
          }
          return [{ affectedRows: text.includes('two') ? 2 : 1 }, []]
        },
      }
    },
  }

  // 字符串含分号：仍是单条语句，直接走 pool.query
  assert.equal(await adapter.exec("INSERT INTO notes VALUES ('a; b')"), 1)
  assert.deepEqual(poolCalls, ["INSERT INTO notes VALUES ('a; b')"])

  // 带参数的单条语句
  assert.equal(await adapter.exec('INSERT INTO notes VALUES (?)', undefined, { params: ['hello'], timeoutMs: 3000 }), 1)
  assert.deepEqual(poolCalls[1], { sql: 'INSERT INTO notes VALUES (?)', values: ['hello'], timeout: 3000 })

  // 带参数的多语句被拒绝
  await assert.rejects(() => adapter.exec('INSERT INTO a VALUES (?); INSERT INTO b VALUES (?)', undefined, { params: [1, 2] }), /仅支持单条语句/)

  // 空/纯注释脚本返回 0 且不发查询
  const beforeEmpty = poolCalls.length
  assert.equal(await adapter.exec('  -- only comment\n ; '), 0)
  assert.equal(poolCalls.length, beforeEmpty)

  // 多语句切分：在单连接上自动包 BEGIN / COMMIT 并累加 affectedRows
  const total = await adapter.exec("INSERT INTO a VALUES ('one'); INSERT INTO b VALUES ('two')")
  assert.equal(total, 3)
  assert.deepEqual(connLog, ['BEGIN', "INSERT INTO a VALUES ('one')", "INSERT INTO b VALUES ('two')", 'COMMIT'])
  assert.equal(released, true)
  assert.equal(destroyed, false)

  // 脚本自带事务关键字时不重复包 BEGIN / COMMIT
  connLog.length = 0
  const manual = await adapter.exec("START TRANSACTION; INSERT INTO a VALUES ('one'); COMMIT")
  assert.equal(manual, 1)
  assert.deepEqual(connLog, ['START TRANSACTION', "INSERT INTO a VALUES ('one')", 'COMMIT'])

  // 多语句第 2 条失败时自动 ROLLBACK；即使 ROLLBACK 失败也不掩盖主错误并销毁连接
  connLog.length = 0
  failOnSql = 'boom'
  failRollback = true
  await assert.rejects(() => adapter.exec("INSERT INTO a VALUES ('one'); INSERT INTO b VALUES ('boom')"), /exec stmt failed/)
  assert.deepEqual(connLog, ['BEGIN', "INSERT INTO a VALUES ('one')", "INSERT INTO b VALUES ('boom')", 'ROLLBACK'])
  assert.equal(destroyed, true)
  assert.equal(released, false)
})

test('PostgreSQL：exec 多语句累加数组 rowCount、支持 params 并拦截多语句 params', async () => {
  const adapter = createAdapter({ name: 'pg', engine: 'postgres', database: 'app' })
  const calls = []
  adapter.pool = {
    async query(sql, values) {
      calls.push({ sql, values })
      if (values !== undefined) return { rowCount: 1 }
      if (sql.includes(';')) return [{ rowCount: 1 }, { rowCount: 2 }, { rowCount: null }]
      return { rowCount: 4 }
    },
  }

  assert.equal(await adapter.exec('INSERT INTO a VALUES (1); INSERT INTO a VALUES (2), (3); CREATE TEMP TABLE x(id INT)'), 3)
  assert.equal(await adapter.exec('UPDATE a SET v = $1 WHERE id = $2', undefined, { params: ['ok', 7] }), 1)
  assert.deepEqual(calls[1], { sql: 'UPDATE a SET v = $1 WHERE id = $2', values: ['ok', 7] })
  await assert.rejects(() => adapter.exec('INSERT INTO a VALUES ($1); INSERT INTO a VALUES ($2)', undefined, { params: [1, 2] }), /仅支持单条语句/)
  assert.equal(await adapter.exec('/* comment only */ ;'), 0)
})

test('PostgreSQL：useCursor=true 走扩展协议 DECLARE/FETCH 并干净归还连接；EXPLAIN 与参数化回退流式', async () => {
  const adapter = createAdapter({ name: 'pg-cursor', engine: 'postgres', database: 'app' })
  const seen = []
  const released = []
  adapter.pool = {
    async connect() {
      return {
        release(force) { released.push(force === true) },
        query(q) {
          seen.push(q)
          if (typeof q === 'string') return Promise.resolve({})
          if (q.text.startsWith('DECLARE _dsh_cursor NO SCROLL CURSOR FOR ')) {
            return Promise.resolve({})
          }
          if (q.text.startsWith('FETCH ')) {
            return Promise.resolve({
              fields: [{ name: 'id' }, { name: 'id' }, { name: 'big' }],
              rows: [[1, 2, 9007199254740993n], [3, 4, 7n]],
            })
          }
          throw new Error('unexpected cursor query: ' + q.text)
        },
      }
    },
  }

  const res = await adapter.query('SELECT id, id, big FROM items', 2, undefined, { useCursor: true, timeoutMs: 4500 })
  assert.deepEqual(res, {
    columns: ['id', 'id', 'big'],
    rows: [[1, 2, '9007199254740993'], [3, 4, 7]],
  })
  assert.deepEqual(released, [false], 'cursor path must return connection cleanly without destroying it')
  assert.equal(seen[0], 'BEGIN READ ONLY')
  assert.equal(seen[1], 'SET LOCAL statement_timeout = 4500')
  assert.deepEqual(seen[2], {
    text: 'DECLARE _dsh_cursor NO SCROLL CURSOR FOR SELECT id, id, big FROM items',
    queryMode: 'extended',
  })
  assert.deepEqual(seen[3], {
    text: 'FETCH 2 FROM _dsh_cursor',
    rowMode: 'array',
    queryMode: 'extended',
  })
  assert.equal(seen[4], 'ROLLBACK')

  // WITH CTE 也应走游标路径
  seen.length = 0
  released.length = 0
  await adapter.query('WITH cte AS (SELECT 1 AS x) SELECT x FROM cte', 5, undefined, { useCursor: true })
  assert.equal(seen[1].text, 'DECLARE _dsh_cursor NO SCROLL CURSOR FOR WITH cte AS (SELECT 1 AS x) SELECT x FROM cte')
  assert.equal(seen[2].text, 'FETCH 5 FROM _dsh_cursor')
  assert.deepEqual(released, [false])

  // 末尾分号与分号后注释应被剥离，字符串内分号保持原样
  for (const [rawSql, expectedClean] of [
    ['SELECT 1;', 'SELECT 1'],
    ['SELECT 1; -- trailing note', 'SELECT 1'],
    ['SELECT 1;;', 'SELECT 1'],
    ["SELECT ';'; /* note */", "SELECT ';'"],
  ]) {
    seen.length = 0
    released.length = 0
    await adapter.query(rawSql, 5, undefined, { useCursor: true })
    assert.deepEqual(seen[1], {
      text: 'DECLARE _dsh_cursor NO SCROLL CURSOR FOR ' + expectedClean,
      queryMode: 'extended',
    })
    assert.deepEqual(released, [false])
  }

  // EXPLAIN 不可走游标：回退到 streamPostgresQuery（使用 pg.Query）
  const explainFix = pgFixture(['Seq Scan on t'], { columns: ['QUERY PLAN'], dataTypeID: 25 })
  const explainRes = await explainFix.adapter.query('EXPLAIN SELECT 1', 10, undefined, { useCursor: true })
  assert.deepEqual(explainRes, { columns: ['QUERY PLAN'], rows: [['Seq Scan on t']] })
  assert.ok(explainFix.state.query instanceof pg.Query)
  assert.deepEqual(explainFix.state.commands, ['BEGIN READ ONLY', 'EXPLAIN SELECT 1', 'ROLLBACK'])

  // 带参数查询不可走游标：回退到 streamPostgresQuery（使用 pg.Query）
  const paramFix = pgFixture([42])
  const paramRes = await paramFix.adapter.query('SELECT $1::int AS a', 10, undefined, { useCursor: true, params: [42] })
  assert.deepEqual(paramRes, { columns: ['a'], rows: [[42]] })
  assert.ok(paramFix.state.query instanceof pg.Query)
  assert.deepEqual(paramFix.state.lastQueryConfig.values, [42])
  assert.deepEqual(paramFix.state.commands, ['BEGIN READ ONLY', 'SELECT $1::int AS a', 'ROLLBACK'])
})

test('PostgreSQL：exec 在提供 timeoutMs 时设置并重置 statement_timeout，重置失败不掩盖主错误', async () => {
  function makeExecFixture({ failSet = false, failMain = false, failReset = false, result = { rowCount: 2 } } = {}) {
    const adapter = createAdapter({ name: 'pg-exec-to', engine: 'postgres', database: 'app' })
    const commands = []
    const released = []
    adapter.pool = {
      async connect() {
        return {
          release(force) { released.push(force === true) },
          async query(sql, values) {
            commands.push({ sql, values })
            if (typeof sql === 'string' && sql.startsWith('SET statement_timeout = ')) {
              if (failSet) throw new Error('set timeout failed')
              return {}
            }
            if (sql === 'RESET statement_timeout') {
              if (failReset) throw new Error('reset timeout failed')
              return {}
            }
            if (failMain) throw new Error('primary exec failed')
            return result
          },
        }
      },
    }
    return { adapter, commands, released }
  }

  // 单语句 + 多语句 + 带参数 + timeoutMs
  const okSingle = makeExecFixture({ result: { rowCount: 3 } })
  assert.equal(await okSingle.adapter.exec('UPDATE t SET v = $1', undefined, { params: ['x'], timeoutMs: 8000 }), 3)
  assert.deepEqual(okSingle.commands, [
    { sql: 'SET statement_timeout = 8000', values: undefined },
    { sql: 'UPDATE t SET v = $1', values: ['x'] },
    { sql: 'RESET statement_timeout', values: undefined },
  ])
  assert.deepEqual(okSingle.released, [false])

  const okMulti = makeExecFixture({ result: [{ rowCount: 1 }, { rowCount: 4 }] })
  assert.equal(await okMulti.adapter.exec('INSERT INTO a VALUES (1); INSERT INTO b VALUES (2);', undefined, { timeoutMs: 12000 }), 5)
  assert.equal(okMulti.commands[0].sql, 'SET statement_timeout = 12000')
  assert.equal(okMulti.commands[2].sql, 'RESET statement_timeout')
  assert.deepEqual(okMulti.released, [false])

  // SET statement_timeout 失败：销毁连接且不执行主语句或 RESET
  const badSet = makeExecFixture({ failSet: true })
  await assert.rejects(() => badSet.adapter.exec('DELETE FROM t', undefined, { timeoutMs: 5000 }), /set timeout failed/)
  assert.deepEqual(badSet.commands, [{ sql: 'SET statement_timeout = 5000', values: undefined }])
  assert.deepEqual(badSet.released, [true])

  // 主语句成功但 RESET 失败：销毁连接并抛出 RESET 错误
  const badReset = makeExecFixture({ failReset: true })
  await assert.rejects(() => badReset.adapter.exec('DELETE FROM t', undefined, { timeoutMs: 5000 }), /reset timeout failed/)
  assert.deepEqual(badReset.released, [true])

  // 主语句失败且 RESET 也失败：销毁连接并保留主错误
  const bothFail = makeExecFixture({ failMain: true, failReset: true })
  await assert.rejects(() => bothFail.adapter.exec('BEGIN; INSERT INTO bad VALUES (1); COMMIT', undefined, { timeoutMs: 5000 }), /primary exec failed/)
  assert.equal(bothFail.commands.at(-1).sql, 'RESET statement_timeout')
  assert.deepEqual(bothFail.released, [true])
})

test('MySQL / PostgreSQL：listTables 支持多 schema、显式 schema 过滤与 PG 物化视图', async () => {
  const pgAdapter = createAdapter({ name: 'pg', engine: 'postgres', database: 'app' })
  const pgCalls = []
  pgAdapter.pool = {
    async query(sql, values) {
      pgCalls.push({ sql, values })
      if (values !== undefined) {
        return { rows: [{ table_schema: values[0], table_name: 'events' }, { table_schema: values[0], table_name: 'mv_daily' }] }
      }
      return {
        rows: [
          { table_schema: 'public', table_name: 'mv_summary' },
          { table_schema: 'public', table_name: 'users' },
          { table_schema: 'analytics', table_name: 'events' },
        ],
      }
    },
  }
  assert.deepEqual(await pgAdapter.listTables(), ['mv_summary', 'users', 'analytics.events'])
  assert.deepEqual(await pgAdapter.listTables(undefined, 'analytics'), ['analytics.events', 'analytics.mv_daily'])
  assert.match(pgCalls[0].sql, /pg_catalog\.pg_class/)
  assert.match(pgCalls[0].sql, /relkind IN \('r', 'p', 'v', 'm', 'f'\)/)
  assert.match(pgCalls[0].sql, /NOT LIKE 'pg_toast%'/)
  assert.match(pgCalls[0].sql, /NOT LIKE 'pg_temp%'/)
  assert.match(pgCalls[1].sql, /relkind IN \('r', 'p', 'v', 'm', 'f'\)/)
  assert.deepEqual(pgCalls[1].values, ['analytics'])

  const myAdapter = createAdapter({ name: 'my', engine: 'mysql', database: 'app' })
  const myCalls = []
  myAdapter.pool = {
    async query(sql) {
      myCalls.push(sql)
      return [[{ Tables_in_db: 'orders' }], []]
    },
  }
  assert.deepEqual(await myAdapter.listTables(), ['orders'])
  assert.deepEqual(await myAdapter.listTables(undefined, 'other-db'), ['orders'])
  assert.deepEqual(myCalls, ['SHOW TABLES', 'SHOW TABLES FROM `other-db`'])
})

test('MySQL / PostgreSQL：readOnly 适配器直接调用 exec 也不会建立写连接', async () => {
  for (const engine of ['mysql', 'postgres']) {
    const adapter = createAdapter({ name: 'ro', engine }, { readOnly: true })
    adapter.pool = { query() { assert.fail('must not query') }, connect() { assert.fail('must not connect') }, getConnection() { assert.fail('must not acquire') } }
    await assert.rejects(adapter.exec('DELETE FROM t'), /readOnly=true/)
  }
})
