import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, inject } from '../lib/index.js'

const kVolatileWrite = Symbol.for('cosmokit.volatile.write')

function makeFakeCtx() {
  const registered = []
  const listeners = {}
  const ctx = {
    get(name) { return name === 'approval' ? { config: { policy: 'ask' } } : undefined },
    tools: {
      register(definition, ...extra) {
        registered.push({ definition, extra })
        return () => {
          const index = registered.findIndex((item) => item.definition === definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
    on(event, listener) {
      (listeners[event] ??= []).push(listener)
      return () => {
        const list = listeners[event]
        if (!list) return
        const idx = list.indexOf(listener)
        if (idx >= 0) list.splice(idx, 1)
      }
    },
  }
  return { ctx, registered, listeners }
}

test('inject 声明 tools', () => {
  assert.deepEqual(inject, ['tools'])
})

test('apply 注册 6 个工具（官方 register 签名）', () => {
  const { ctx, registered } = makeFakeCtx()
  apply(ctx, {})
  assert.equal(registered.length, 6)
  assert.ok(registered.every((item) => item.extra.length === 0))
  assert.ok(registered.every((item) => !Object.hasOwn(item.definition, 'gate')))
})

test('sql_exec 通过 tools/pre-execute 返回 ask，其他工具继续 waterfall', async () => {
  const { ctx, listeners } = makeFakeCtx()
  apply(ctx, {})
  const preExecute = listeners['tools/pre-execute'][0]
  let delegated = false
  const ask = await preExecute(
    { name: 'sql_exec', arguments: { sql: 'DELETE FROM users' } },
    async () => { delegated = true; return { kind: 'allow' } },
  )
  assert.equal(ask.kind, 'ask')
  assert.ok(ask.reason.includes('DELETE FROM users'))
  assert.ok(ask.reason.includes('目标连接：default（sqlite @ :memory:）'))
  assert.equal(delegated, true)

  const allowed = await preExecute(
    { name: 'sql_query', arguments: { sql: 'SELECT 1' } },
    async () => { delegated = true; return { kind: 'allow' } },
  )
  assert.deepEqual(allowed, { kind: 'allow' })
  assert.equal(delegated, true)
})

test('writeApproval=false 时仍注册 pre-execute 并透传 next，热更新改为 true 后立即激活审批门', async () => {
  const { ctx, listeners } = makeFakeCtx()
  const parsed = Config({ writeApproval: false })
  apply(ctx, parsed)

  assert.equal(listeners['tools/pre-execute']?.length, 1)
  const preExecute = listeners['tools/pre-execute'][0]

  let nextCalls = 0
  const passThrough = await preExecute(
    { name: 'sql_exec', arguments: { sql: 'DELETE FROM users' } },
    async () => { nextCalls += 1; return { kind: 'allow' } },
  )
  assert.deepEqual(passThrough, { kind: 'allow' })
  assert.equal(nextCalls, 1)

  // 通过 volatile 活引用将 writeApproval 从 false 热更新为 true
  parsed.writeApproval[kVolatileWrite](true)
  const activated = await preExecute(
    { name: 'sql_exec', arguments: { sql: 'DELETE FROM users' } },
    async () => { nextCalls += 1; return { kind: 'allow' } },
  )
  assert.equal(activated.kind, 'ask')
  assert.ok(activated.reason.includes('DELETE FROM users'))
  assert.equal(nextCalls, 2)
})

test('审批卡包含目标连接与引擎，绝不泄露密码，并按目标引擎词法检出转义后的 DROP TABLE', async () => {
  const { ctx, listeners } = makeFakeCtx()
  const secret = 'SuperSecretPass_999!'
  apply(ctx, {
    connections: [
      { name: 'pg_prod', engine: 'postgres', host: 'db.internal', port: 5433, user: 'ops', password: secret, database: 'billing' },
      { name: 'my_prod', engine: 'mysql', host: 'my.internal', port: 3307, user: 'ops', password: secret, database: 'shop' },
    ],
  })
  const preExecute = listeners['tools/pre-execute'][0]

  // PostgreSQL E'...' 转义字符串后的 DROP TABLE
  const pgAsk = await preExecute(
    { name: 'sql_exec', arguments: { connection: 'pg_prod', sql: "SELECT E'a\\'b'; DROP TABLE invoices; SELECT E'c'" } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(pgAsk.kind, 'ask')
  assert.ok(pgAsk.reason.includes('目标连接：pg_prod（postgres @ db.internal:5433/billing）'))
  assert.match(pgAsk.reason, /DROP TABLE invoices/)
  assert.match(pgAsk.reason, /DROP×1/)
  assert.equal(pgAsk.reason.includes(secret), false, '审批卡不得包含密码')

  // MySQL '...' 反斜杠转义字符串后的 DROP TABLE
  const myAsk = await preExecute(
    { name: 'sql_exec', arguments: { connection: 'my_prod', sql: "SELECT 'a\\'b'; DROP TABLE orders; SELECT 'c'" } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(myAsk.kind, 'ask')
  assert.ok(myAsk.reason.includes('目标连接：my_prod（mysql @ my.internal:3307/shop）'))
  assert.match(myAsk.reason, /DROP TABLE orders/)
  assert.match(myAsk.reason, /DROP×1/)
  assert.equal(myAsk.reason.includes(secret), false, '审批卡不得包含密码')

  // 未知连接名在审批门快速拒绝，不浪费人工审批弹窗
  const unknownDeny = await preExecute(
    { name: 'sql_exec', arguments: { connection: 'ghost', sql: 'DELETE FROM t' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(unknownDeny.kind, 'deny')
  assert.ok(unknownDeny.reason.includes('ghost'))
  assert.match(unknownDeny.reason, /无需审批/)
  assert.match(unknownDeny.reason, /sql_list/)
})

test('审批卡展示绑定参数（SQLite/MySQL 用 [1]=...，PG 用 $1=...）与高危提示，并安全处理长值/换行/大量参数', async () => {
  const { ctx, listeners } = makeFakeCtx()
  apply(ctx, {
    connections: [
      { name: 'local', engine: 'sqlite', file: ':memory:' },
      { name: 'pg_prod', engine: 'postgres', host: 'db.internal', port: 5432, user: 'ops', database: 'billing' },
      { name: 'my_prod', engine: 'mysql', host: 'my.internal', port: 3306, user: 'ops', database: 'shop' },
    ],
  })
  const preExecute = listeners['tools/pre-execute'][0]

  // SQLite 绑定参数展示 + 无 WHERE 高危提示
  const sqliteAsk = await preExecute(
    {
      name: 'sql_exec',
      arguments: {
        connection: 'local',
        sql: 'UPDATE orders SET status = ?, amount = ? WHERE id = ?',
        params: ['paid', 42, 7],
      },
    },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(sqliteAsk.kind, 'ask')
  const sqliteLines = sqliteAsk.reason.split('\n')
  assert.equal(sqliteLines[1], '目标连接：local（sqlite @ :memory:）')
  assert.equal(sqliteLines[2], '绑定参数（3 个）：[1]="paid", [2]=42, [3]=7')
  assert.doesNotMatch(sqliteAsk.reason, /⚠️ 高危提示：/)

  // MySQL 使用 [1]=...，并展示 DROP TABLE 高危提示
  const mysqlAsk = await preExecute(
    {
      name: 'sql_exec',
      arguments: {
        connection: 'my_prod',
        sql: 'DELETE FROM sessions; DROP TABLE legacy',
        params: ['line1\nline2', null],
      },
    },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(mysqlAsk.kind, 'ask')
  assert.ok(mysqlAsk.reason.includes('绑定参数（2 个）：[1]="line1\\nline2", [2]=null'))
  assert.match(mysqlAsk.reason, /⚠️ 高危提示：/)
  assert.match(mysqlAsk.reason, /无 WHERE 条件的 DELETE/)
  assert.match(mysqlAsk.reason, /DROP TABLE/)

  // PostgreSQL 使用 $1=...，并截断单值超过 120 字符与超过 50 个参数
  const longVal = 'A'.repeat(200)
  const manyParams = [longVal, 42, ...Array.from({ length: 53 }, (_, i) => i)]
  const pgAsk = await preExecute(
    {
      name: 'sql_exec',
      arguments: {
        connection: 'pg_prod',
        sql: 'DELETE FROM users',
        params: manyParams,
      },
    },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(pgAsk.kind, 'ask')
  const pgLines = pgAsk.reason.split('\n')
  assert.equal(pgLines[1], '目标连接：pg_prod（postgres @ db.internal:5432/billing）')
  assert.match(pgLines[2], /^绑定参数（55 个）：\$1="A{119}…, \$2=42,/)
  assert.match(pgLines[2], /…另有 5 个参数$/)
  assert.match(pgAsk.reason, /⚠️ 高危提示：/)
  assert.match(pgAsk.reason, /无 WHERE 条件的 DELETE/)

  // 非 JSON 安全值（BigInt / undefined / 循环引用 / null 原型对象 / 抛错 toString）均不崩溃
  const cyclic = {}
  cyclic.self = cyclic
  const nullProtoBigInt = Object.assign(Object.create(null), { n: 1n })
  const nullProtoCyclic = Object.create(null)
  nullProtoCyclic.self = nullProtoCyclic
  const throwingToString = { toString() { throw new Error('boom') } }
  throwingToString.self = throwingToString
  const nullProtoUndefJson = Object.assign(Object.create(null), { toJSON() { return undefined } })
  const specialAsk = await preExecute(
    {
      name: 'sql_exec',
      arguments: {
        connection: 'pg_prod',
        sql: 'UPDATE items SET a = $1, b = $2, c = $3 WHERE id = 1',
        params: [12345678901234567890n, undefined, cyclic, nullProtoBigInt, nullProtoCyclic, throwingToString, nullProtoUndefJson],
      },
    },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(specialAsk.kind, 'ask')
  assert.ok(specialAsk.reason.includes('$1=12345678901234567890'))
  assert.ok(specialAsk.reason.includes('$2=undefined'))
  assert.ok(specialAsk.reason.includes('$3=[object Object]'))
  assert.ok(specialAsk.reason.includes('$4=[object Object]'))
  assert.ok(specialAsk.reason.includes('$5=[object Object]'))
  assert.ok(specialAsk.reason.includes('$6=[object Object]'))
  assert.ok(specialAsk.reason.includes('$7=[object Object]'))
})

test('单连接 readOnly=true 在审批门与 sql_exec 执行期均拒绝写入，但不影响同配置的可写连接', async () => {
  const { ctx, registered, listeners } = makeFakeCtx()
  apply(ctx, {
    connections: [
      { name: 'replica', engine: 'sqlite', file: ':memory:', readOnly: true },
      { name: 'primary', engine: 'sqlite', file: ':memory:' },
    ],
  })
  const preExecute = listeners['tools/pre-execute'][0]
  const execTool = registered.find((item) => item.definition.name === 'sql_exec').definition

  try {
    // pre-execute 审批门：replica 拒绝，primary 放行到 ask
    const denied = await preExecute(
      { name: 'sql_exec', arguments: { connection: 'replica', sql: 'CREATE TABLE x (id INT)' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(denied.kind, 'deny')
    assert.match(denied.reason, /replica/)
    assert.match(denied.reason, /readOnly=true/)

    const allowedAsk = await preExecute(
      { name: 'sql_exec', arguments: { connection: 'primary', sql: 'CREATE TABLE x (id INT)' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(allowedAsk.kind, 'ask')
    assert.ok(allowedAsk.reason.includes('目标连接：primary（sqlite @ :memory:）'))

    // sql_exec.execute：replica 报错，primary 正常写入
    await assert.rejects(
      () => execTool.execute({ connection: 'replica', sql: 'CREATE TABLE x (id INT)' }),
      /replica.*readOnly=true/,
    )
    const ok = await execTool.execute({ connection: 'primary', sql: 'CREATE TABLE x (id INT)' })
    assert.equal(ok.connection, 'primary')
    assert.equal(ok.readOnly, false)
  } finally {
    for (const listener of listeners.dispose ?? []) listener()
  }
})

test('apply 遇到非法配置时响亮失败，不回退到内存 SQLite', () => {
  const { ctx, registered, listeners } = makeFakeCtx()
  assert.throws(
    () => apply(ctx, { connections: [{ name: '', engine: 'sqlite' }] }),
    /需要 name/,
  )
  assert.equal(registered.length, 0)
  assert.deepEqual(listeners, {})
})

test('dispose 卸载全部工具与监听器', () => {
  const { ctx, registered, listeners } = makeFakeCtx()
  apply(ctx, {})
  assert.equal(registered.length, 6)
  assert.equal(listeners['tools/pre-execute'].length, 1)
  for (const listener of [...(listeners.dispose ?? [])]) listener()
  assert.equal(registered.length, 0)
  assert.equal(listeners['tools/pre-execute'].length, 0)
})
