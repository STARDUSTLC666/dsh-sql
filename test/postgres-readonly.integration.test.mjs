import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createAdapter } from '../lib/index.js'

// Opt in with a disposable PostgreSQL connection object as JSON. No downloads,
// services or existing schemas are modified by the default test run.
test('真实 PostgreSQL：会话设置、写函数、多语句、截流和取消均不绕过只读事务', {
  skip: !process.env.DSH_SQL_TEST_POSTGRES,
  timeout: 20000,
}, async () => {
  const connection = { ...JSON.parse(process.env.DSH_SQL_TEST_POSTGRES), name: 'fixture', engine: 'postgres' }
  const admin = new pg.Client(connection)
  const schema = 'dsh_sql_test_' + randomBytes(8).toString('hex')
  const table = schema + '.items', writer = schema + '.write_item()'
  await admin.connect()
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    await admin.query('CREATE TABLE ' + table + '(value integer); INSERT INTO ' + table + ' VALUES(1)')
    await admin.query('CREATE FUNCTION ' + writer + ' RETURNS integer LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ' + table + ' VALUES(2); RETURN 2; END $$')
    for (const readOnly of [true, false]) {
      const adapter = createAdapter(connection, { readOnly })
      try {
        for (const limit of [undefined, 10]) {
          await adapter.query("SELECT set_config('default_transaction_read_only','off',false)", limit)
          assert.deepEqual((await adapter.query("SELECT current_setting('transaction_read_only')", limit)).rows, [['on']])
          await assert.rejects(adapter.query('SELECT ' + writer, limit), { code: '25006' })
          await assert.rejects(adapter.query("SELECT set_config('transaction_read_only','off',false)", limit), { code: '25001' })
          await assert.rejects(adapter.query('SELECT 1; SELECT ' + writer, limit), { code: '42601' })
          assert.deepEqual((await adapter.query('SELECT COUNT(*)::integer FROM ' + table, limit)).rows, [[1]])
        }
        assert.deepEqual((await adapter.query('SELECT n FROM generate_series(1,100000) n', 2)).rows, [[1], [2]])
        const controller = new AbortController()
        const pending = adapter.query('SELECT pg_sleep(10)', 10, controller.signal)
        const timer = setTimeout(() => controller.abort(new Error('fixture cancel')), 50)
        try { await assert.rejects(pending, /fixture cancel/) } finally { clearTimeout(timer) }
        assert.deepEqual((await adapter.query('SELECT 7', 10)).rows, [[7]])
        if (readOnly) await assert.rejects(adapter.exec('INSERT INTO ' + table + ' VALUES(3)'), /readOnly=true/)
        else {
          assert.equal(await adapter.exec('INSERT INTO ' + table + ' VALUES(3)'), 1)
          await admin.query('DELETE FROM ' + table + ' WHERE value=3')
        }
      } finally { await adapter.close() }
    }
    assert.deepEqual((await admin.query('SELECT value FROM ' + table)).rows, [{ value: 1 }])
  } finally {
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
    await admin.end()
  }
})
