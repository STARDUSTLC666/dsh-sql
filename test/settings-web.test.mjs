import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import {
  apply,
  Config,
  createSqlSettingsBackend,
  DEFAULT_REDACT_COLUMN_PATTERNS,
  installSqlSettingsWeb,
  SQL_API_ROUTE,
  SQL_SETTINGS_ROUTE,
} from '../lib/index.js'

const kVolatileWrite = Symbol.for('cosmokit.volatile.write')

/** 创建带 volatile 活引用同步能力的模拟宿主 settings harness（模拟 DSH 0.2.2 行为）。 */
function makeVolatileHarness(initial = {}, options = {}) {
  const entryId = options.entryId ?? 'sql'
  const mode = options.mode ?? 'mutate' // 'mutate' | 'update' | 'replace' | 'readonly' | 'none'
  const parsed = Config(initial)
  let revision = options.initialRevision ?? 1
  const userDoc = { ...initial, ...(options.extraUserFields ?? {}) }
  const calls = []

  const applyToVolatile = (key, value) => {
    userDoc[key] = value
    if (parsed[key] && typeof parsed[key][kVolatileWrite] === 'function') {
      parsed[key][kVolatileWrite](value)
    } else {
      parsed[key] = value
    }
  }

  let provider
  if (mode !== 'none') {
    provider = {
      writable: mode !== 'readonly',
      describe: () => (options.omitDescribe ? [] : [{ ns: entryId, revision, user: { ...userDoc } }]),
    }
    if (mode === 'mutate' || mode === 'readonly') {
      provider.mutate = async (ns, ops, expectedRev) => {
        calls.push({ method: 'mutate', ns, ops, expectedRev })
        if (options.conflictOnWrite) {
          const err = new Error('conflict')
          err.code = 'SETTINGS_CONFLICT'
          throw err
        }
        assert.equal(ns, entryId)
        for (const op of ops) {
          assert.equal(op.op, 'set')
          applyToVolatile(op.path[0], op.value)
        }
        revision += 1
      }
    }
    if (mode === 'update') {
      provider.update = async (ns, patch) => {
        calls.push({ method: 'update', ns, patch })
        assert.equal(ns, entryId)
        for (const [k, v] of Object.entries(patch)) applyToVolatile(k, v)
        revision += 1
      }
    }
    if (mode === 'replace') {
      provider.replace = async (ns, doc, expectedRev) => {
        calls.push({ method: 'replace', ns, doc, expectedRev })
        assert.equal(ns, entryId)
        for (const [k, v] of Object.entries(doc)) applyToVolatile(k, v)
        revision += 1
      }
    }
  }

  const ctx = {
    fiber: { entry: { options: { id: entryId } } },
    get(name) {
      if (name === 'settings') return provider
      if (name === 'approval') return { config: { policy: 'ask' } }
      return undefined
    },
  }

  const backend = createSqlSettingsBackend(ctx, parsed, {
    env: options.env ?? {},
    testTimeoutMs: options.testTimeoutMs,
    createAdapter: options.createAdapter,
  })

  return { ctx, parsed, provider, backend, calls, userDoc, getRevision: () => revision }
}

function makeApiRequest(method = 'GET', body, extraHeaders = {}, url = 'http://127.0.0.1:3080' + SQL_API_ROUTE) {
  const headers = {
    'x-dsh-sql': '1',
    ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    ...extraHeaders,
  }
  return new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
}

async function callApi(backend, method, body, extraHeaders = {}, url) {
  const res = await backend.fetch(makeApiRequest(method, body, extraHeaders, url))
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: JSON.parse(text), rawText: text }
}

async function callNodeHandle(backend, {
  method = 'GET',
  headers = {},
  body,
  remoteAddress = '127.0.0.1',
} = {}) {
  const rawBody = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
  const req = Readable.from(rawBody ? [Buffer.from(rawBody, 'utf8')] : [])
  req.method = method
  req.url = SQL_SETTINGS_ROUTE
  req.headers = {
    host: 'localhost:3080',
    'x-dsh-sql': '1',
    ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    ...headers,
  }
  req.socket = { remoteAddress }

  const resHeaders = {}
  let status = 200
  let rawText = ''
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableFinished: false,
    writeHead(code, map = {}) {
      status = code
      for (const [k, v] of Object.entries(map)) resHeaders[k.toLowerCase()] = v
    },
    end(chunk = '') {
      rawText = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      this.writableFinished = true
    },
  })

  await backend.handle(req, res)
  return { status, headers: resHeaders, body: JSON.parse(rawText), rawText }
}

async function reserveUnusedPort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('GET snapshot 绝不泄露明文密码或 URL 凭据，并正确报告 config/env/none 与 implicitMemoryDefault', async () => {
  const emptyHarness = makeVolatileHarness({})
  const emptyRes = await callApi(emptyHarness.backend, 'GET')
  assert.equal(emptyRes.status, 200)
  assert.equal(emptyRes.body.snapshot.implicitMemoryDefault, true)
  assert.deepEqual(emptyRes.body.snapshot.connections, [])
  assert.equal(emptyRes.body.snapshot.writable, true)
  assert.equal(emptyRes.body.snapshot.guardrails.redactMode, 'off')
  assert.deepEqual(emptyRes.body.snapshot.guardrails.redactColumns, [])
  assert.equal(emptyRes.body.snapshot.guardrails.maxRows, 1000)
  assert.equal(emptyRes.body.snapshot.guardrails.writeApproval, true)

  const secretDirect = 'DirectPass_TopSecret_123!'
  const secretUrl = 'UrlPass_TopSecret_456!'
  const secretEnv = 'EnvPass_TopSecret_789!'

  const { backend } = makeVolatileHarness(
    {
      connections: [
        { name: 'local', engine: 'sqlite', file: ':memory:' },
        { name: 'pg_direct', engine: 'postgres', host: 'pg.internal', port: 5433, user: 'ops', password: secretDirect, database: 'billing', ssl: 'require', readOnly: true },
        { name: 'my_url', engine: 'mysql', url: `mysql://root:${encodeURIComponent(secretUrl)}@my.internal:3307/shop?sslmode=verify-full` },
        { name: 'pg_env', engine: 'postgres', host: 'env.internal', user: 'reader', database: 'analytics' },
        { name: 'pg_none', engine: 'postgres', host: 'none.internal', user: 'guest', database: 'public_db' },
      ],
    },
    { env: { DSH_SQL_PASSWORD_PG_ENV: secretEnv } },
  )

  const res = await callApi(backend, 'GET')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.rawText.includes(secretDirect), false, '快照绝不能包含直接密码')
  assert.equal(res.rawText.includes(secretUrl), false, '快照绝不能包含 URL 密码')
  assert.equal(res.rawText.includes(secretEnv), false, '快照绝不能包含环境变量密码')

  const snap = res.body.snapshot
  assert.equal(snap.implicitMemoryDefault, false)
  assert.equal(snap.connections.length, 5)
  for (const conn of snap.connections) {
    assert.equal('password' in conn, false)
    assert.equal('url' in conn, false)
  }

  assert.deepEqual(snap.connections[0], {
    name: 'local',
    engine: 'sqlite',
    file: ':memory:',
    readOnly: false,
    hasPassword: false,
    passwordSource: 'none',
    passwordEnvVar: 'DSH_SQL_PASSWORD_LOCAL',
  })

  assert.deepEqual(snap.connections[1], {
    name: 'pg_direct',
    engine: 'postgres',
    host: 'pg.internal',
    port: 5433,
    user: 'ops',
    database: 'billing',
    readOnly: true,
    ssl: 'require',
    hasPassword: true,
    passwordSource: 'config',
    passwordEnvVar: 'DSH_SQL_PASSWORD_PG_DIRECT',
  })

  assert.deepEqual(snap.connections[2], {
    name: 'my_url',
    engine: 'mysql',
    host: 'my.internal',
    port: 3307,
    user: 'root',
    database: 'shop',
    readOnly: false,
    ssl: 'verify-full',
    hasPassword: true,
    passwordSource: 'config',
    passwordEnvVar: 'DSH_SQL_PASSWORD_MY_URL',
  })

  assert.equal(snap.connections[3].hasPassword, true)
  assert.equal(snap.connections[3].passwordSource, 'env')
  assert.equal(snap.connections[3].passwordEnvVar, 'DSH_SQL_PASSWORD_PG_ENV')

  assert.equal(snap.connections[4].hasPassword, false)
  assert.equal(snap.connections[4].passwordSource, 'none')
  assert.equal(snap.connections[4].passwordEnvVar, 'DSH_SQL_PASSWORD_PG_NONE')
})

test('saveConnection：新增、编辑保留原密码（含原 URL 密码）、显式 clearPassword、env 不落盘与校验拒绝', async () => {
  const { backend, parsed, calls } = makeVolatileHarness(
    {
      connections: [
        { name: 'FromUrl', engine: 'postgres', url: 'postgres://alice:OldUrlSecret99!@db1.local:5432/app' },
      ],
    },
    { env: { DSH_SQL_PASSWORD_ENVONLY: 'EnvOnlySecret77!' } },
  )

  let snap = (await callApi(backend, 'GET')).body.snapshot
  const rev0 = snap.revision

  // 1. 新增 SQLite 与使用环境变量密码的 PostgreSQL 连接（不得把 env 密码写入配置）
  const addSqlite = await callApi(backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'local', engine: 'sqlite', file: ':memory:', readOnly: true },
    revision: rev0,
  })
  assert.equal(addSqlite.status, 200)
  assert.equal(addSqlite.body.saved, 'local')
  assert.notEqual(addSqlite.body.snapshot.revision, rev0)
  assert.equal(calls.at(-1).method, 'mutate')
  assert.equal(calls.at(-1).ops[0].path[0], 'connections')

  const addEnvPg = await callApi(backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'envonly', engine: 'postgres', host: 'pg.env', database: 'metrics', user: 'u' },
    revision: addSqlite.body.snapshot.revision,
  })
  assert.equal(addEnvPg.status, 200)
  const storedEnvConn = parsed.connections.get().find((c) => c.name === 'envonly')
  assert.equal(storedEnvConn.password, undefined, '环境变量密码绝不能被复制到持久化配置中')
  const viewEnvConn = addEnvPg.body.snapshot.connections.find((c) => c.name === 'envonly')
  assert.equal(viewEnvConn.passwordSource, 'env')
  assert.equal(viewEnvConn.hasPassword, true)

  // 2. 编辑原 URL 连接（不区分大小写匹配 originalName），密码留空应保留 OldUrlSecret99!
  const editPreserve = await callApi(backend, 'POST', {
    action: 'saveConnection',
    originalName: 'fromurl',
    connection: {
      name: 'FromUrlRenamed',
      engine: 'postgres',
      host: 'db2.local',
      port: 5433,
      user: 'alice',
      password: '',
      database: 'app',
      readOnly: true,
    },
    revision: addEnvPg.body.snapshot.revision,
  })
  assert.equal(editPreserve.status, 200)
  assert.equal(editPreserve.body.saved, 'FromUrlRenamed')
  assert.equal(editPreserve.rawText.includes('OldUrlSecret99!'), false)
  const storedRenamed = parsed.connections.get().find((c) => c.name === 'FromUrlRenamed')
  assert.equal(storedRenamed.password, 'OldUrlSecret99!', '留空密码时应保留原连接密码')
  assert.equal(storedRenamed.url, undefined, '规范化持久化后不再残留明文 url')
  assert.equal(storedRenamed.host, 'db2.local')
  assert.equal(storedRenamed.port, 5433)
  assert.equal(storedRenamed.readOnly, true)

  // 3. 显式 clearPassword: true 清除已存密码
  const editClear = await callApi(backend, 'POST', {
    action: 'saveConnection',
    originalName: 'FromUrlRenamed',
    connection: {
      name: 'FromUrlRenamed',
      engine: 'postgres',
      host: 'db2.local',
      port: 5433,
      user: 'alice',
      database: 'app',
    },
    clearPassword: true,
    revision: editPreserve.body.snapshot.revision,
  })
  assert.equal(editClear.status, 200)
  const storedCleared = parsed.connections.get().find((c) => c.name === 'FromUrlRenamed')
  assert.equal(storedCleared.password, undefined)
  const viewCleared = editClear.body.snapshot.connections.find((c) => c.name === 'FromUrlRenamed')
  assert.equal(viewCleared.hasPassword, false)
  assert.equal(viewCleared.passwordSource, 'none')

  // 4. 重名 / 非法 URL / 缺少 database / 非法 SSL / 非法端口均返回 400 且不污染已存配置
  const callsBeforeInvalid = calls.length
  const currentRev = editClear.body.snapshot.revision

  const dup = await callApi(backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'LOCAL', engine: 'sqlite', file: ':memory:' },
    revision: currentRev,
  })
  assert.equal(dup.status, 400)
  assert.match(dup.body.error, /重复/)

  const badUrl = await callApi(backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'bad1', engine: 'postgres', url: 'mysql://u:p@h/db' },
    revision: currentRev,
  })
  assert.equal(badUrl.status, 400)
  assert.match(badUrl.body.error, /postgres:\/\//)

  const missingDb = await callApi(backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'bad2', engine: 'mysql', host: 'h' },
    revision: currentRev,
  })
  assert.equal(missingDb.status, 400)
  assert.match(missingDb.body.error, /database/)

  const badSsl = await callApi(backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'bad3', engine: 'postgres', host: 'h', database: 'd', ssl: 'bogus-mode' },
    revision: currentRev,
  })
  assert.equal(badSsl.status, 400)
  assert.match(badSsl.body.error, /ssl/)

  const badPort = await callApi(backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'bad4', engine: 'postgres', host: 'h', port: 99999, database: 'd' },
    revision: currentRev,
  })
  assert.equal(badPort.status, 400)
  assert.match(badPort.body.error, /端口/)

  assert.equal(calls.length, callsBeforeInvalid, '校验失败时绝不能写入宿主配置')

  // 5. 编辑不存在的 originalName 返回 404
  const missingOrig = await callApi(backend, 'POST', {
    action: 'saveConnection',
    originalName: 'ghost',
    connection: { name: 'ghost', engine: 'sqlite', file: ':memory:' },
    revision: currentRev,
  })
  assert.equal(missingOrig.status, 404)
})

test('removeConnection：大小写不敏感删除、404 未找到与清空后恢复 implicitMemoryDefault', async () => {
  const { backend } = makeVolatileHarness({
    connections: [{ name: 'PrimaryDB', engine: 'sqlite', file: ':memory:' }],
  })
  const rev0 = (await callApi(backend, 'GET')).body.snapshot.revision

  const notFound = await callApi(backend, 'POST', {
    action: 'removeConnection',
    name: 'nonexistent',
    revision: rev0,
  })
  assert.equal(notFound.status, 404)
  assert.match(notFound.body.error, /未找到该连接/)

  const removed = await callApi(backend, 'POST', {
    action: 'removeConnection',
    name: 'primarydb',
    revision: rev0,
  })
  assert.equal(removed.status, 200)
  assert.equal(removed.body.removed, 'PrimaryDB')
  assert.equal(removed.body.snapshot.implicitMemoryDefault, true)
  assert.deepEqual(removed.body.snapshot.connections, [])
  assert.notEqual(removed.body.snapshot.revision, rev0)
})

test('testConnection：真实 SQLite :memory: / 文件库（含表数与句柄关闭）、不可达端口下一步提示、只读模式下可用与密码脱敏', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'dsh-sql-web-test-'))
  const dbPath = join(tempDir, 'sample.db')
  const unusedPort = await reserveUnusedPort()
  const secretPw = 'TestLeakGuard_Secret_888!'

  try {
    const seed = new DatabaseSync(dbPath)
    seed.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE orders (id INTEGER PRIMARY KEY);')
    seed.close()

    // 刻意用 readonly 模式验证 testConnection 在 writable === false 下依然可用！
    const { backend } = makeVolatileHarness(
      {
        connections: [
          { name: 'filedb', engine: 'sqlite', file: dbPath },
          { name: 'deadpg', engine: 'postgres', host: '127.0.0.1', port: unusedPort, user: 'ops', password: secretPw, database: 'app' },
        ],
      },
      { mode: 'readonly' },
    )

    const initial = await callApi(backend, 'GET')
    assert.equal(initial.body.snapshot.writable, false)

    // 1. 测试 :memory: 草稿连接
    const memTest = await callApi(backend, 'POST', {
      action: 'testConnection',
      connection: { name: 'mem', engine: 'sqlite', file: ':memory:' },
    })
    assert.equal(memTest.status, 200)
    assert.equal(memTest.body.test.ok, true)
    assert.equal(memTest.body.test.tableCount, 0)
    assert.equal(typeof memTest.body.test.durationMs, 'number')

    // 2. 测试真实 SQLite 文件库（通过已保存名称）
    const fileTest = await callApi(backend, 'POST', {
      action: 'testConnection',
      name: 'filedb',
    })
    assert.equal(fileTest.status, 200)
    assert.equal(fileTest.body.test.ok, true)
    assert.equal(fileTest.body.test.tableCount, 2)
    assert.equal(typeof fileTest.body.test.durationMs, 'number')

    // 3. 测试不存在的 SQLite 文件库 -> ok: false + 下一步提示
    const missingFileTest = await callApi(backend, 'POST', {
      action: 'testConnection',
      connection: { engine: 'sqlite', file: join(tempDir, 'does-not-exist.db') },
    })
    assert.equal(missingFileTest.status, 200)
    assert.equal(missingFileTest.body.test.ok, false)
    assert.match(missingFileTest.body.test.error, /下一步：/)

    // 4. 测试不可达端口 -> ok: false + 下一步提示，且绝不泄露密码
    const deadTest = await callApi(backend, 'POST', {
      action: 'testConnection',
      name: 'deadpg',
    })
    assert.equal(deadTest.status, 200)
    assert.equal(deadTest.body.test.ok, false)
    assert.match(deadTest.body.test.error, /下一步：/)
    assert.equal(deadTest.body.test.error.includes(secretPw), false)
    assert.equal(deadTest.rawText.includes(secretPw), false)

    // 5. 测试未知连接名 -> 404
    const missingName = await callApi(backend, 'POST', {
      action: 'testConnection',
      name: 'no_such_conn',
    })
    assert.equal(missingName.status, 404)
  } finally {
    // Windows 下如果 SQLite 句柄未关闭，rmSync 会抛 EBUSY；能删掉即证明 adapter.close() 已执行！
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('testConnection：草稿测试保留已存密码/回退环境变量、强制 readOnly=true、超时控制且必定 close()', async () => {
  const captured = []
  let closeCount = 0

  const { backend } = makeVolatileHarness(
    {
      connections: [
        { name: 'prod', engine: 'postgres', host: 'db.local', port: 5432, user: 'ops', password: 'SavedPassword_001!', database: 'app' },
      ],
    },
    {
      env: { DSH_SQL_PASSWORD_ENVDB: 'EnvPassword_002!' },
      testTimeoutMs: 100,
      createAdapter: (conn, opts) => {
        captured.push({ conn, opts })
        if (conn.host === 'hang.local') {
          return {
            engine: conn.engine,
            async ping(signal) {
              await new Promise((_, reject) => {
                signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
              })
            },
            async listTables() { return [] },
            async describeTable() { return [] },
            async query() { return { columns: [], rows: [] } },
            async exec() { return 0 },
            async close() { closeCount += 1 },
          }
        }
        if (conn.host === 'leak.local') {
          return {
            engine: conn.engine,
            async ping() {
              throw new Error(`password authentication failed for password=${conn.password} postgres://u:${conn.password}@leak.local/app`)
            },
            async listTables() { return [] },
            async describeTable() { return [] },
            async query() { return { columns: [], rows: [] } },
            async exec() { return 0 },
            async close() { closeCount += 1 },
          }
        }
        return {
          engine: conn.engine,
          async ping() {},
          async listTables() { return ['t1', 't2', 't3'] },
          async describeTable() { return [] },
          async query() { return { columns: [], rows: [] } },
          async exec() { return 0 },
          async close() { closeCount += 1 },
        }
      },
    },
  )

  // 1. 编辑草稿（密码留空）自动保留已存密码，且 adapter 以 readOnly: true 创建
  const r1 = await callApi(backend, 'POST', {
    action: 'testConnection',
    originalName: 'prod',
    connection: { name: 'prod', engine: 'postgres', host: 'db.local', database: 'app', user: 'ops' },
  })
  assert.equal(r1.status, 200)
  assert.equal(r1.body.test.ok, true)
  assert.equal(r1.body.test.tableCount, 3)
  assert.equal(captured[0].conn.password, 'SavedPassword_001!')
  assert.equal(captured[0].opts.readOnly, true)

  // 2. 新草稿走 DSH_SQL_PASSWORD_ENVDB 回退
  const r2 = await callApi(backend, 'POST', {
    action: 'testConnection',
    connection: { name: 'envdb', engine: 'postgres', host: 'db.local', database: 'app', user: 'ops' },
  })
  assert.equal(r2.status, 200)
  assert.equal(r2.body.test.ok, true)
  assert.equal(captured[1].conn.password, 'EnvPassword_002!')

  // 3. 驱动错误里如果回显了密码，必须被脱敏且仍带下一步提示
  const r3 = await callApi(backend, 'POST', {
    action: 'testConnection',
    originalName: 'prod',
    connection: { name: 'prod', engine: 'postgres', host: 'leak.local', database: 'app', user: 'ops' },
  })
  assert.equal(r3.status, 200)
  assert.equal(r3.body.test.ok, false)
  assert.equal(r3.body.test.error.includes('SavedPassword_001!'), false)
  assert.match(r3.body.test.error, /下一步：/)

  // 4. 超时中止并返回超时提示
  const r4 = await callApi(backend, 'POST', {
    action: 'testConnection',
    connection: { name: 'slow', engine: 'postgres', host: 'hang.local', database: 'app', user: 'ops' },
  })
  assert.equal(r4.status, 200)
  assert.equal(r4.body.test.ok, false)
  assert.match(r4.body.test.error, /超时/)

  assert.equal(closeCount, 4, '无论成功、报错还是超时，每次测试都必须 close() 临时适配器')
})

test('saveGuardrails：覆盖 off / builtin / custom 脱敏模式、参数校验与 revision 刷新', async () => {
  const { backend } = makeVolatileHarness({})
  let rev = (await callApi(backend, 'GET')).body.snapshot.revision

  // 1. builtin 脱敏 + 自定义护栏
  const builtinRes = await callApi(backend, 'POST', {
    action: 'saveGuardrails',
    maxRows: 500,
    readOnly: true,
    writeApproval: false,
    queryTimeoutMs: 15000,
    execTimeoutMs: 30000,
    redactColumns: true,
    revision: rev,
  })
  assert.equal(builtinRes.status, 200)
  assert.equal(builtinRes.body.saved, true)
  assert.notEqual(builtinRes.body.snapshot.revision, rev)
  assert.deepEqual(builtinRes.body.snapshot.guardrails, {
    maxRows: 500,
    readOnly: true,
    writeApproval: false,
    queryTimeoutMs: 15000,
    execTimeoutMs: 30000,
    redactMode: 'builtin',
    redactColumns: [...DEFAULT_REDACT_COLUMN_PATTERNS],
  })
  rev = builtinRes.body.snapshot.revision

  // 2. custom 脱敏（含正则）
  const customRes = await callApi(backend, 'POST', {
    action: 'saveGuardrails',
    maxRows: 2000,
    readOnly: false,
    writeApproval: true,
    queryTimeoutMs: 60000,
    execTimeoutMs: 120000,
    redactColumns: ['phone', '/^id_card/i'],
    revision: rev,
  })
  assert.equal(customRes.status, 200)
  assert.equal(customRes.body.snapshot.guardrails.redactMode, 'custom')
  assert.deepEqual(customRes.body.snapshot.guardrails.redactColumns, ['phone', '/^id_card/i'])
  rev = customRes.body.snapshot.revision

  // 3. off 脱敏
  const offRes = await callApi(backend, 'POST', {
    action: 'saveGuardrails',
    maxRows: 1000,
    readOnly: false,
    writeApproval: true,
    queryTimeoutMs: 60000,
    execTimeoutMs: 120000,
    redactColumns: false,
    revision: rev,
  })
  assert.equal(offRes.status, 200)
  assert.equal(offRes.body.snapshot.guardrails.redactMode, 'off')
  assert.deepEqual(offRes.body.snapshot.guardrails.redactColumns, [])
  rev = offRes.body.snapshot.revision

  // 4. 非法正则 / 非法 maxRows 返回 400
  const badRegex = await callApi(backend, 'POST', {
    action: 'saveGuardrails',
    maxRows: 1000,
    readOnly: false,
    writeApproval: true,
    queryTimeoutMs: 60000,
    execTimeoutMs: 120000,
    redactColumns: ['/[invalid/'],
    revision: rev,
  })
  assert.equal(badRegex.status, 400)
  assert.match(badRegex.body.error, /正则/)

  const badMaxRows = await callApi(backend, 'POST', {
    action: 'saveGuardrails',
    maxRows: 0,
    readOnly: false,
    writeApproval: true,
    queryTimeoutMs: 60000,
    execTimeoutMs: 120000,
    redactColumns: false,
    revision: rev,
  })
  assert.equal(badMaxRows.status, 400)
  assert.match(badMaxRows.body.error, /maxRows/)
})

test('乐观锁 409 冲突、只读 403 拒绝，以及 update / replace 持久化回退路径', async () => {
  // 1. 修订号不匹配 -> 409 conflict
  const h1 = makeVolatileHarness({})
  const mismatch = await callApi(h1.backend, 'POST', {
    action: 'saveGuardrails',
    maxRows: 500,
    readOnly: false,
    writeApproval: true,
    queryTimeoutMs: 60000,
    execTimeoutMs: 120000,
    redactColumns: false,
    revision: 'stale-revision',
  })
  assert.equal(mismatch.status, 409)
  assert.equal(mismatch.body.code, 'conflict')
  assert.ok(mismatch.body.snapshot?.revision)

  // 宿主 mutate 抛 SETTINGS_CONFLICT -> 409 conflict
  const hConflict = makeVolatileHarness({}, { conflictOnWrite: true })
  const revConflict = (await callApi(hConflict.backend, 'GET')).body.snapshot.revision
  const hostConflict = await callApi(hConflict.backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'a', engine: 'sqlite', file: ':memory:' },
    revision: revConflict,
  })
  assert.equal(hostConflict.status, 409)
  assert.equal(hostConflict.body.code, 'conflict')

  // 2. 只读 provider / 无 settings provider -> 403 readonly
  for (const mode of ['readonly', 'none']) {
    const hRo = makeVolatileHarness({}, { mode })
    const snap = (await callApi(hRo.backend, 'GET')).body.snapshot
    assert.equal(snap.writable, false)
    const denied = await callApi(hRo.backend, 'POST', {
      action: 'saveConnection',
      connection: { name: 'a', engine: 'sqlite', file: ':memory:' },
      revision: snap.revision,
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.code, 'readonly')
  }

  // 3. provider.update 回退（自定义 entryId）
  const hUpdate = makeVolatileHarness({}, { mode: 'update', entryId: 'sql-team' })
  const revUpdate = (await callApi(hUpdate.backend, 'GET')).body.snapshot.revision
  const resUpdate = await callApi(hUpdate.backend, 'POST', {
    action: 'saveConnection',
    connection: { name: 'team', engine: 'sqlite', file: ':memory:' },
    revision: revUpdate,
  })
  assert.equal(resUpdate.status, 200)
  assert.equal(hUpdate.calls[0].method, 'update')
  assert.equal(hUpdate.calls[0].ns, 'sql-team')

  // 4. provider.replace 回退（保留 descriptor.user 里其他未知字段）
  const hReplace = makeVolatileHarness({}, { mode: 'replace', extraUserFields: { customFlag: true } })
  const revReplace = (await callApi(hReplace.backend, 'GET')).body.snapshot.revision
  const resReplace = await callApi(hReplace.backend, 'POST', {
    action: 'saveGuardrails',
    maxRows: 300,
    readOnly: true,
    writeApproval: true,
    queryTimeoutMs: 60000,
    execTimeoutMs: 120000,
    redactColumns: false,
    revision: revReplace,
  })
  assert.equal(resReplace.status, 200)
  assert.equal(hReplace.calls[0].method, 'replace')
  assert.equal(hReplace.calls[0].doc.customFlag, true)
  assert.equal(hReplace.calls[0].doc.maxRows, 300)
})

test('安全守卫：X-DSH-SQL / sec-fetch-site / origin / content-type / body 上限 / method / 回环校验', async () => {
  const { backend } = makeVolatileHarness({
    connections: [{ name: 'local', engine: 'sqlite', file: ':memory:' }],
  })

  // --- /api/dsh-sql/settings (fetch) ---
  // 方法不允许 -> 405
  const method405 = await callApi(backend, 'DELETE')
  assert.equal(method405.status, 405)
  assert.equal(method405.headers.get('allow'), 'GET, POST')
  assert.equal(method405.body.snapshot, undefined)

  // 缺少 X-DSH-SQL -> 403
  const noHeader = await callApi(backend, 'GET', undefined, { 'x-dsh-sql': '' })
  assert.equal(noHeader.status, 403)
  assert.equal(noHeader.body.snapshot, undefined)

  // sec-fetch-site 跨站 -> 403；same-origin / none 放行
  assert.equal((await callApi(backend, 'GET', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await callApi(backend, 'GET', undefined, { 'sec-fetch-site': 'same-site' })).status, 403)
  assert.equal((await callApi(backend, 'GET', undefined, { 'sec-fetch-site': 'same-origin' })).status, 200)
  assert.equal((await callApi(backend, 'GET', undefined, { 'sec-fetch-site': 'none' })).status, 200)

  // origin 校验：跨站/错端口/null 拒绝；同 host 与 dsh-app://app 放行
  assert.equal((await callApi(backend, 'GET', undefined, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await callApi(backend, 'GET', undefined, { origin: 'http://127.0.0.1:9999' })).status, 403)
  assert.equal((await callApi(backend, 'GET', undefined, { origin: 'null' })).status, 403)
  assert.equal((await callApi(backend, 'GET', undefined, { origin: 'http://127.0.0.1:3080' })).status, 200)
  assert.equal((await callApi(backend, 'GET', undefined, { origin: 'dsh-app://app' })).status, 200)

  // POST content-type 非 JSON -> 415
  const badCt = await callApi(backend, 'POST', '{}', { 'content-type': 'text/plain' })
  assert.equal(badCt.status, 415)

  // POST body > 256 KiB -> 413
  const hugePayload = JSON.stringify({ action: 'testConnection', pad: 'x'.repeat(260 * 1024) })
  const tooLarge = await callApi(backend, 'POST', hugePayload)
  assert.equal(tooLarge.status, 413)

  // POST 非法 JSON -> 400
  const badJson = await callApi(backend, 'POST', '{not json')
  assert.equal(badJson.status, 400)

  // --- /_dsh/dsh-sql/settings (legacy loopback handle) ---
  // 非回环 remoteAddress -> 403
  assert.equal((await callNodeHandle(backend, { remoteAddress: '192.168.1.50' })).status, 403)

  // 非 localhost Host（DNS rebinding 防护）-> 403
  assert.equal((await callNodeHandle(backend, { headers: { host: 'evil.example:3080' } })).status, 403)

  // 三种合法回环地址 + localhost / [::1] 放行
  assert.equal((await callNodeHandle(backend, { remoteAddress: '127.0.0.1', headers: { host: 'localhost:3080' } })).status, 200)
  assert.equal((await callNodeHandle(backend, { remoteAddress: '::1', headers: { host: '[::1]:3080' } })).status, 200)
  assert.equal((await callNodeHandle(backend, { remoteAddress: '::ffff:127.0.0.1', headers: { host: '127.0.0.1:3080' } })).status, 200)

  // 旧路由同样执行 X-DSH-SQL / origin / content-type / method / 413
  assert.equal((await callNodeHandle(backend, { headers: { 'x-dsh-sql': '0' } })).status, 403)
  assert.equal((await callNodeHandle(backend, { headers: { origin: 'http://evil.example' } })).status, 403)
  assert.equal((await callNodeHandle(backend, { method: 'PUT' })).status, 405)
  assert.equal((await callNodeHandle(backend, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
  assert.equal((await callNodeHandle(backend, { method: 'POST', body: hugePayload })).status, 413)
})

test('installSqlSettingsWeb 与 apply() 注册双路由、关闭自动表单并在 dispose 时完整清理', async () => {
  const apiRoutes = []
  const webRoutes = []
  const configureCalls = []
  let configuredDisposed = 0
  const effects = []
  const registeredTools = []

  const mockSettings = {
    writable: true,
    describe: () => [{ ns: 'sql', revision: 1, user: {} }],
    mutate: async () => {},
    configure(opts, fiber) {
      configureCalls.push({ opts, fiber })
      return () => { configuredDisposed += 1 }
    },
  }

  const fakeFiber = { entry: { options: { id: 'sql' } } }
  const ctx = {
    fiber: fakeFiber,
    get(name) {
      if (name === 'approval') return { config: { policy: 'ask' } }
      return undefined
    },
    tools: {
      register(def) {
        registeredTools.push(def)
        return () => {
          const i = registeredTools.indexOf(def)
          if (i >= 0) registeredTools.splice(i, 1)
        }
      },
    },
    effect(fn) {
      const clean = fn()
      if (typeof clean === 'function') effects.push(clean)
    },
    on() {
      return () => {}
    },
    inject(deps, cb) {
      const childEffects = []
      const childCtx = {
        effect(fn) {
          const clean = fn()
          if (typeof clean === 'function') childEffects.push(clean)
        },
        ...(deps.includes('settings') ? { settings: mockSettings } : {}),
        ...(deps.includes('connection') ? {
          connection: {
            fetch: {
              register(route) {
                apiRoutes.push(route)
                return () => {
                  const i = apiRoutes.indexOf(route)
                  if (i >= 0) apiRoutes.splice(i, 1)
                }
              },
            },
          },
        } : {}),
        ...(deps.includes('webServer') ? {
          webServer: {
            register(route) {
              webRoutes.push(route)
              return () => {
                const i = webRoutes.indexOf(route)
                if (i >= 0) webRoutes.splice(i, 1)
              }
            },
          },
        } : {}),
      }
      cb(childCtx)
      return () => {
        for (const off of childEffects.splice(0)) off()
      }
    },
  }

  const parsed = Config({})
  apply(ctx, parsed)

  assert.equal(apiRoutes.length, 1)
  assert.equal(apiRoutes[0].path, SQL_API_ROUTE)
  assert.deepEqual(apiRoutes[0].methods, ['GET', 'POST'])
  assert.equal(apiRoutes[0].requestBody, 'buffered')

  assert.equal(webRoutes.length, 1)
  assert.equal(webRoutes[0].path, SQL_SETTINGS_ROUTE)
  assert.equal(webRoutes[0].kind, 'exact')

  assert.equal(configureCalls.length, 1)
  assert.deepEqual(configureCalls[0].opts, { auto: false })
  assert.equal(configureCalls[0].fiber, fakeFiber)

  // 通过已注册的 /api 路由可真实访问 GET snapshot，且检测到注入的 settings provider 为可写
  const liveRes = await apiRoutes[0].fetch(makeApiRequest('GET'))
  assert.equal(liveRes.status, 200)
  const liveJson = await liveRes.json()
  assert.equal(liveJson.snapshot.writable, true)
  assert.equal(liveJson.snapshot.implicitMemoryDefault, true)

  // 触发 dispose（模拟宿主卸载插件）
  for (const off of effects.splice(0)) await off()
  assert.equal(apiRoutes.length, 0)
  assert.equal(webRoutes.length, 0)
  assert.equal(registeredTools.length, 0)
  assert.equal(configuredDisposed, 1)

  // 独立测试 installSqlSettingsWeb 返回的清理函数（无 host.effect 场景）
  const plainApi = []
  const plainWeb = []
  const backend = createSqlSettingsBackend(null, {})
  const disposeStandalone = installSqlSettingsWeb({
    inject(deps, cb) {
      if (deps.includes('connection')) {
        cb({
          connection: {
            fetch: {
              register(r) {
                plainApi.push(r)
                return () => plainApi.splice(plainApi.indexOf(r), 1)
              },
            },
          },
        })
      }
      if (deps.includes('webServer')) {
        cb({
          webServer: {
            register(r) {
              plainWeb.push(r)
              return () => plainWeb.splice(plainWeb.indexOf(r), 1)
            },
          },
        })
      }
    },
  }, backend)
  assert.equal(plainApi.length, 1)
  assert.equal(plainWeb.length, 1)
  disposeStandalone()
  assert.equal(plainApi.length, 0)
  assert.equal(plainWeb.length, 0)
})
