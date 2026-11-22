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
