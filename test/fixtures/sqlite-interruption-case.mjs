import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdapter } from '../../lib/index.js'

const directory = await fs.mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), '.sqlite-interruption-'))
const adapters = []
const adapter = (memory = false, readOnly = false) => {
  const value = createAdapter({ name: 'fixture', engine: 'sqlite', file: memory ? ':memory:' : path.join(directory, 'database.db') }, { readOnly })
  adapters.push(value)
  return value
}
const endless = 'WITH RECURSIVE busy(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM busy) SELECT sum(x) FROM busy'
const finite = 'WITH RECURSIVE busy(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM busy WHERE x < 2000000) SELECT sum(x) FROM busy'
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
// Observe the process boundary itself: rejecting a Promise before close would fail these checks.
const observe = value => {
  const child = value.running.child
  const result = { child, closed: false }
  child.once('close', () => { result.closed = true })
  return result
}
const stopped = observed => {
  assert.equal(observed.closed, true, 'the SQLite process must close before the caller settles')
  assert.ok(observed.child.exitCode !== null || observed.child.signalCode !== null)
}

try {
  switch (process.argv[2]) {
    case 'query-timeout': {
      const db = adapter()
      await db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY); INSERT INTO items VALUES(1)')
      let heartbeats = 0
      const timer = setInterval(() => { heartbeats++ }, 10)
      const started = performance.now()
      const pending = db.query(endless, 1, undefined, { timeoutMs: 120 })
      const observed = observe(db)
      await assert.rejects(pending, error => error.name === 'TimeoutError' && error.code === 'SQLITE_TIMEOUT')
      clearInterval(timer)
      stopped(observed)
      assert.ok(heartbeats >= 3, 'host heartbeat must run while native SQLite is busy')
      assert.ok(performance.now() - started < 3000)
      assert.deepEqual((await db.query('SELECT id FROM items')).rows, [[1]])
      assert.equal(await db.exec('INSERT INTO items VALUES(2)'), 1)
      break
    }
    case 'exec-timeout': {
      const db = adapter()
      await db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY); INSERT INTO items VALUES(1)')
      await db.exec('BEGIN')
      await db.exec('INSERT INTO items VALUES(2)')
      const pending = db.exec(endless.replace('SELECT sum(x)', 'INSERT INTO items SELECT sum(x)'), undefined, { timeoutMs: 100 })
      const observed = observe(db)
      const queued = db.exec('INSERT INTO items VALUES(3)')
      const [active, waiting] = await Promise.allSettled([pending, queued])
      assert.equal(active.status, 'rejected')
      assert.equal(active.reason.name, 'TimeoutError')
      assert.equal(active.reason.sqliteOutcome, 'unknown')
      assert.match(active.reason.message, /verify its outcome|核对/)
      assert.equal(waiting.status, 'rejected')
      assert.equal(waiting.reason.code, 'SQLITE_CONNECTION_RESET')
      stopped(observed)
      assert.deepEqual((await db.query('SELECT id FROM items')).rows, [[1]], 'uncommitted data rolls back and queued writes are never replayed')
      await db.exec('BEGIN; INSERT INTO items VALUES(4); COMMIT')
      assert.deepEqual((await db.query('SELECT id FROM items ORDER BY id')).rows, [[1], [4]])
      break
    }
    case 'cancel': {
      const db = adapter()
      await db.ping()
      const controller = new AbortController()
      const reason = new Error('caller cancelled actual SQLite work')
      const pending = db.query(endless, 1, controller.signal)
      const observed = observe(db)
      setTimeout(() => controller.abort(reason), 80)
      await assert.rejects(pending, error => error === reason)
      stopped(observed)
      await db.ping()
      break
    }
    case 'queued-cancel': {
      const db = adapter(true)
      await db.exec('CREATE TABLE items(id INTEGER); INSERT INTO items VALUES(7)')
      const active = db.query(finite, 1, undefined, { timeoutMs: 5000 })
      const observed = observe(db)
      const controller = new AbortController()
      const queued = db.query('SELECT 99', 1, controller.signal)
      controller.abort(new Error('cancel only this queued request'))
      await assert.rejects(queued, /cancel only this queued/)
      assert.equal(observed.closed, false)
      const timeout = db.query('SELECT 88', 1, undefined, { timeoutMs: 10 })
      await assert.rejects(timeout, error => error.code === 'SQLITE_TIMEOUT')
      assert.equal(observed.closed, false)
      assert.deepEqual((await active).rows, [[2000001000000]])
      assert.deepEqual((await db.query('SELECT id FROM items')).rows, [[7]])
      break
    }
    case 'memory-invalid': {
      const db = adapter(true)
      await db.exec('CREATE TABLE items(id INTEGER); INSERT INTO items VALUES(7)')
      const pending = db.query(endless, 1, undefined, { timeoutMs: 100 })
      const observed = observe(db)
      await assert.rejects(pending, { code: 'SQLITE_TIMEOUT' })
      stopped(observed)
      for (const operation of [() => db.query('SELECT 1'), () => db.exec('CREATE TABLE fresh(id)'), () => db.ping()]) {
        await assert.rejects(operation, error => error.code === 'SQLITE_MEMORY_INVALIDATED' && /memory/.test(error.message))
      }
      break
    }
    case 'close': {
      const db = adapter(true)
      await db.ping()
      const active = db.query(endless)
      const observed = observe(db)
      const queued = db.ping()
      const settled = Promise.allSettled([active, queued])
      await delay(60)
      await Promise.all([db.close(), db.close()])
      stopped(observed)
      assert.deepEqual((await settled).map(value => value.status), ['rejected', 'rejected'])
      await assert.rejects(db.ping(), { code: 'SQLITE_CLOSED' })
      const starting = adapter()
      const first = starting.query('SELECT 1')
      const rejected = assert.rejects(first, { code: 'SQLITE_CLOSED' })
      await starting.close()
      await rejected
      break
    }
    case 'readonly-reopen': {
      const seed = adapter()
      await seed.exec('CREATE TABLE items(id INTEGER); INSERT INTO items VALUES(1)')
      await seed.close()
      const db = adapter(false, true)
      await db.ping()
      await assert.rejects(db.query(endless, 1, undefined, { timeoutMs: 100 }), { code: 'SQLITE_TIMEOUT' })
      await assert.rejects(db.query('DELETE FROM items'), /readonly|read-only|write/i)
      assert.deepEqual((await db.query('SELECT id FROM items')).rows, [[1]])
      assert.deepEqual(await db.listTables(), ['items'])
      break
    }
    case 'pre-abort': {
      const db = adapter(true)
      const controller = new AbortController()
      controller.abort(new Error('cancelled before dispatch'))
      await assert.rejects(db.query('SELECT 1', 1, controller.signal), /before dispatch/)
      assert.equal(db.running, undefined)
      assert.deepEqual((await db.query('SELECT 2')).rows, [[2]])
      break
    }
    default: throw new Error('Unknown interruption scenario')
  }
  console.log(JSON.stringify({ scenario: process.argv[2], passed: true }))
} finally {
  await Promise.allSettled(adapters.map(value => value.close()))
  const relative = path.relative(path.dirname(fileURLToPath(import.meta.url)), directory)
  assert.ok(relative.startsWith('.sqlite-interruption-') && !relative.includes(path.sep))
  await fs.rm(directory, { recursive: true, force: true })
}
