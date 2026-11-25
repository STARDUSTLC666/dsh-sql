import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSqlTools, resolveConfig } from '../lib/index.js'

function toolsWithAdapter(adapter) {
  const built = buildSqlTools(resolveConfig({ connections: [{ name: 'local', engine: adapter.engine, file: ':memory:' }] }))
  built.adapters.set('local', adapter)
  return built.tools
}

test('sql_exec preserves uncertain write outcome and the cancellation cause through the tool boundary', async () => {
  const controller = new AbortController()
  const cause = new Error('cancel requested by caller')
  const outcome = Object.assign(new Error('The write may already have committed; verify its outcome before retrying.', { cause }), {
    name: 'AbortError', sqliteOutcome: 'unknown',
  })
  const tools = toolsWithAdapter({
    engine: 'sqlite',
    async exec(_sql, signal) {
      controller.abort(cause)
      assert.equal(signal.aborted, true)
      throw outcome
    },
  })
  const exec = tools.find(tool => tool.name === 'sql_exec')
  await assert.rejects(exec.execute({ sql: 'INSERT INTO important_data VALUES (1)' }, { signal: controller.signal }), error => {
    assert.equal(error, outcome)
    assert.equal(error.cause, cause)
    assert.equal(error.sqliteOutcome, 'unknown')
    assert.match(error.message, /already have committed.*verify.*before retrying/)
    return true
  })
})

test('ordinary query cancellation still preserves the caller cancellation reason', async () => {
  const controller = new AbortController()
  const cause = new Error('caller cancelled a read')
  const tools = toolsWithAdapter({
    engine: 'sqlite',
    async query() {
      controller.abort(cause)
      throw new Error('driver stopped the read')
    },
  })
  const query = tools.find(tool => tool.name === 'sql_query')
  await assert.rejects(query.execute({ sql: 'SELECT 1' }, { signal: controller.signal }), error => error === cause)
})
