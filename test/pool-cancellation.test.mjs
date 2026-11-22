import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdapter } from '../lib/index.js'

test('queued MySQL/PostgreSQL acquisition cancels before a connection arrives and returns it unused', { timeout: 1000 }, async () => {
  for (const engine of ['mysql', 'postgres']) {
    const adapter = createAdapter({ name: 'queued', engine })
    let provideConnection
    const acquired = new Promise(resolve => { provideConnection = resolve })
    let released = 0
    adapter.pool = { connect: () => acquired, getConnection: () => acquired }
    const controller = new AbortController()
    const pending = adapter.query('SELECT a FROM t', 10, controller.signal)
    controller.abort(new Error('cancel while queued'))
    await assert.rejects(pending, /cancel while queued/)
    provideConnection({
      query() { assert.fail('cancelled request must not execute SQL') },
      release(force) { assert.notEqual(force, true); released += 1 },
      destroy() { assert.fail('unused pooled connection should remain reusable') },
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(released, 1)
  }
})

test('late acquisition failures after cancellation are observed', { timeout: 1000 }, async () => {
  for (const engine of ['mysql', 'postgres']) {
    const adapter = createAdapter({ name: 'queued', engine })
    let failAcquire
    const acquired = new Promise((_resolve, reject) => { failAcquire = reject })
    adapter.pool = { connect: () => acquired, getConnection: () => acquired }
    const controller = new AbortController()
    const pending = adapter.ping(controller.signal)
    controller.abort(new Error('cancel before acquire failure'))
    await assert.rejects(pending, /cancel before acquire failure/)
    failAcquire(new Error('late connection failure'))
    await new Promise(resolve => setImmediate(resolve))
  }
})

test('closing an uninitialized MySQL/PostgreSQL adapter succeeds immediately without creating a pool', async () => {
  for (const engine of ['mysql', 'postgres']) {
    const adapter = createAdapter({ name: 'lazy-close', engine, database: 'app' })
    await adapter.close()
    assert.equal(adapter.pool, undefined)
  }
})

test('PostgreSQL abort issues best-effort pg_cancel_backend when client has numeric processID', { timeout: 1000 }, async () => {
  const adapter = createAdapter({ name: 'pg-cancel', engine: 'postgres', database: 'app' })
  const cancelCalls = []
  let forcedRelease = false
  adapter.pool = {
    async connect() {
      return {
        processID: 4242,
        async query(sql) {
          if (sql === 'BEGIN READ ONLY') return {}
          return await new Promise(() => {})
        },
        release(force) { forcedRelease = force === true },
      }
    },
    async query(sql, values) {
      cancelCalls.push({ sql, values })
      throw new Error('cancel query rejected asynchronously')
    },
  }
  const controller = new AbortController()
  const pending = adapter.query('SELECT pg_sleep(10)', undefined, controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('cancel pg backend'))
  await assert.rejects(pending, /cancel pg backend/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(forcedRelease, true)
  assert.deepEqual(cancelCalls, [{ sql: 'SELECT pg_cancel_backend($1)', values: [4242] }])
})

test('PostgreSQL abort skips pg_cancel_backend when processID is missing or invalid', { timeout: 1000 }, async () => {
  for (const badPid of [undefined, null, 0, -5, 1.5, '4242']) {
    const adapter = createAdapter({ name: 'pg-nopid', engine: 'postgres', database: 'app' })
    adapter.pool = {
      async connect() {
        return {
          processID: badPid,
          async query(sql) {
            if (sql === 'BEGIN READ ONLY') return {}
            return await new Promise(() => {})
          },
          release() {},
        }
      },
      query() { assert.fail('must not call pool.query without valid processID') },
    }
    const controller = new AbortController()
    const pending = adapter.query('SELECT pg_sleep(10)', undefined, controller.signal)
    await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('abort without pid'))
    await assert.rejects(pending, /abort without pid/)
  }
})

test('MySQL abort issues best-effort KILL QUERY using threadId or nested connection.threadId', { timeout: 1000 }, async () => {
  for (const connShape of [{ threadId: 7788 }, { connection: { threadId: 9901 } }]) {
    const adapter = createAdapter({ name: 'my-cancel', engine: 'mysql', database: 'app' })
    const cancelCalls = []
    let destroyed = false
    adapter.pool = {
      async getConnection() {
        return {
          ...connShape,
          async query(sql) {
            if (sql === 'START TRANSACTION READ ONLY') return [[], []]
            return await new Promise(() => {})
          },
          destroy() { destroyed = true },
          release() {},
        }
      },
      async query(sql, values) {
        cancelCalls.push({ sql, values })
        throw new Error('kill query rejected asynchronously')
      },
    }
    const controller = new AbortController()
    const pending = adapter.query('SELECT SLEEP(10)', undefined, controller.signal)
    await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('cancel mysql backend'))
    await assert.rejects(pending, /cancel mysql backend/)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(destroyed, true)
    const expectedId = connShape.threadId ?? connShape.connection.threadId
    assert.deepEqual(cancelCalls, [{ sql: 'KILL QUERY ?', values: [expectedId] }])
  }
})

test('MySQL abort skips KILL QUERY when threadId is missing or invalid', { timeout: 1000 }, async () => {
  for (const badId of [undefined, null, 0, -1, 2.5, '7788']) {
    const adapter = createAdapter({ name: 'my-noid', engine: 'mysql', database: 'app' })
    adapter.pool = {
      async getConnection() {
        return {
          threadId: badId,
          async query(sql) {
            if (sql === 'START TRANSACTION READ ONLY') return [[], []]
            return await new Promise(() => {})
          },
          destroy() {},
          release() {},
        }
      },
      query() { assert.fail('must not call pool.query without valid threadId') },
    }
    const controller = new AbortController()
    const pending = adapter.query('SELECT SLEEP(10)', undefined, controller.signal)
    await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('abort without threadId'))
    await assert.rejects(pending, /abort without threadId/)
  }
})
