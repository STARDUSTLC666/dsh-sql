import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdapter } from '../lib/index.js'

test('SQLite schema identifies every column in an ordered composite primary key', async () => {
  const adapter = createAdapter({ name: 'composite', engine: 'sqlite', file: ':memory:' })
  try {
    await adapter.exec('CREATE TABLE membership (tenant INTEGER, user INTEGER, note TEXT, PRIMARY KEY (tenant, user))')
    const columns = await adapter.describeTable('membership')
    assert.deepEqual(columns.map(({ name, primaryKey }) => ({ name, primaryKey })), [
      { name: 'tenant', primaryKey: true }, { name: 'user', primaryKey: true }, { name: 'note', primaryKey: false },
    ])
  } finally { await adapter.close() }
})
