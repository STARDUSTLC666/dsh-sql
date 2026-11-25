import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { createAdapter } from '../lib/index.js'

const evidenceRoot = fileURLToPath(new URL('./', import.meta.url))

function fixture(t, file = ':memory:', readOnly = false) {
  const root = mkdtempSync(join(evidenceRoot, '.sqlite-review-'))
  const adapter = createAdapter({ name: 'review', engine: 'sqlite', file: file === ':memory:' ? file : join(root, file) }, { readOnly })
  t.after(async () => {
    await adapter.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, adapter }
}

test('SQLite process review: relative files resolve when the adapter is created, before lazy opening', async t => {
  const original = process.cwd()
  const root = mkdtempSync(join(evidenceRoot, '.sqlite-review-relative-'))
  const first = join(root, 'first'), second = join(root, 'second')
  mkdirSync(first); mkdirSync(second)
  let adapter
  try {
    process.chdir(first)
    adapter = createAdapter({ name: 'relative', engine: 'sqlite', file: 'bound.db' })
    process.chdir(second)
    await adapter.exec('CREATE TABLE located (id INTEGER)')
    await adapter.close()
    const check = new DatabaseSync(join(first, 'bound.db'), { readOnly: true })
    try {
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'located'").get().n, 1)
    } finally { check.close() }
    assert.throws(() => new DatabaseSync(join(second, 'bound.db'), { readOnly: true }))
  } finally {
    process.chdir(original)
    await adapter?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('SQLite process review: advanced IPC preserves large integers and sliced binary parameters', async t => {
  const { adapter } = fixture(t)
  const bytes = Uint8Array.from([0, 0xaa, 0xbb, 0xff]).subarray(1, 3)
  await adapter.exec('CREATE TABLE values_test (n INTEGER, bytes BLOB, absent, enabled INTEGER)')
  await adapter.exec('INSERT INTO values_test VALUES (?, ?, ?, ?)', undefined, {
    params: [9223372036854775807n, bytes, undefined, false],
  })
  assert.deepEqual((await adapter.query('SELECT n, hex(bytes), absent, enabled FROM values_test')).rows, [
    ['9223372036854775807', 'AABB', null, 0],
  ])
})

test('SQLite process review: invalid parameters reject without destroying an existing memory database', async t => {
  const { adapter } = fixture(t)
  await adapter.exec('CREATE TABLE preserved (id INTEGER); INSERT INTO preserved VALUES (7)')
  for (const value of [Symbol('invalid'), () => 1, { invalid: true }]) {
    await assert.rejects(adapter.exec('INSERT INTO preserved VALUES (?)', undefined, { params: [value] }))
    assert.deepEqual((await adapter.query('SELECT id FROM preserved')).rows, [[7]])
  }
})

test('SQLite process review: process startup failure rejects operations and allows idempotent close', { timeout: 5000 }, async t => {
  const { root } = fixture(t)
  const original = process.execPath
  const adapter = createAdapter({ name: 'missing-runtime', engine: 'sqlite', file: join(root, 'unused.db') })
  try {
    process.execPath = join(root, 'missing-node-runtime.exe')
    const operation = adapter.ping()
    process.execPath = original
    await assert.rejects(operation, /ENOENT|EPIPE|spawn|process|进程/i)
    await Promise.all([adapter.close(), adapter.close()])
    await assert.rejects(adapter.ping(), /closed|关闭/i)
  } finally {
    process.execPath = original
    await adapter.close()
  }
})

test('SQLite process review: idle close rolls back explicit transactions and releases the database file', async t => {
  const { root, adapter } = fixture(t, 'rollback.db')
  await adapter.exec('CREATE TABLE committed (id INTEGER)')
  await adapter.exec('INSERT INTO committed VALUES (1)')
  await adapter.exec('BEGIN')
  await adapter.exec('INSERT INTO committed VALUES (2)')
  await adapter.close()
  const check = new DatabaseSync(join(root, 'rollback.db'))
  try {
    assert.deepEqual(check.prepare('SELECT id FROM committed ORDER BY id').all().map(row => row.id), [1])
    check.exec('BEGIN EXCLUSIVE; INSERT INTO committed VALUES (3); COMMIT')
  } finally { check.close() }
})

const unfinishedWrite = 'BEGIN IMMEDIATE; INSERT INTO outcomes VALUES (2); WITH RECURSIVE spin(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM spin) INSERT INTO outcomes SELECT sum(n) FROM spin'

test('SQLite process review: unexpected worker death preserves uncertain write outcome after process close', { timeout: 5000 }, async t => {
  const { adapter } = fixture(t, 'unexpected-exit.db')
  await adapter.exec('CREATE TABLE outcomes (id INTEGER); INSERT INTO outcomes VALUES (1)')
  const pending = adapter.exec(unfinishedWrite)
  const child = adapter.running.child
  let processClosed = false
  child.once('close', () => { processClosed = true })
  const rejected = assert.rejects(pending, error => {
    assert.equal(processClosed, true, 'reject only after native work has ended')
    assert.equal(error.sqliteOutcome, 'unknown')
    assert.match(error.message, /may already have committed|可能已提交/)
    assert.ok(error.cause instanceof Error)
    return true
  })
  await delay(30)
  child.kill('SIGKILL')
  await rejected
  assert.deepEqual((await adapter.query('SELECT id FROM outcomes ORDER BY id')).rows, [[1]])
})

test('SQLite process review: close during a write preserves its uncertain outcome and rolls back unfinished work', { timeout: 5000 }, async t => {
  const { root, adapter } = fixture(t, 'close-write.db')
  await adapter.exec('CREATE TABLE outcomes (id INTEGER); INSERT INTO outcomes VALUES (1)')
  const pending = adapter.exec(unfinishedWrite)
  const rejected = assert.rejects(pending, error => {
    assert.equal(error.sqliteOutcome, 'unknown')
    assert.match(error.message, /may already have committed|可能已提交/)
    assert.equal(error.cause.code, 'SQLITE_CLOSED')
    return true
  })
  await delay(30)
  await Promise.all([adapter.close(), rejected])
  const check = new DatabaseSync(join(root, 'close-write.db'))
  try {
    assert.deepEqual(check.prepare('SELECT id FROM outcomes ORDER BY id').all().map(row => row.id), [1])
    check.exec('BEGIN EXCLUSIVE; ROLLBACK')
  } finally { check.close() }
})
