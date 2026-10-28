import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, buildSqlTools, resolveConfig } from '../lib/index.js'

function host(policy, config = {}) {
  const listeners = new Map(), definitions = new Map()
  const ctx = {
    get: name => name === 'approval' && policy ? { config: { policy: 'ask' }, overrideOf: () => policy } : undefined,
    tools: { register: d => { definitions.set(d.name, d); return () => {} } },
    on: (event, fn) => { listeners.set(event, fn); return () => {} },
  }
  apply(ctx, config)
  return { gate: listeners.get('tools/pre-execute'), definitions }
}
test('SQL 在 never/未知策略下明确拒绝，不声称用户点了拒绝；保留下游拒绝', async () => {
  const exec = { name: 'sql_exec', arguments: { sql: 'DELETE FROM items' }, agent: { session: {} } }
  for (const policy of ['never', undefined]) {
    const { gate } = host(policy)
    const result = await gate(exec, async () => ({ kind: 'allow' }))
    assert.equal(result.kind, 'deny')
    assert.match(result.reason, policy === 'never' ? /never.*writeApproval=false/s : /无法读取/)
    assert.doesNotMatch(result.reason, /user rejected/)
    const denied = { kind: 'deny', reason: 'Host file policy' }
    assert.equal(await gate(exec, async () => denied), denied)
  }
})
test('SQL 可询问时继续请求确认，readOnly 不请求写确认', async () => {
  const exec = { name: 'sql_exec', arguments: { sql: 'DELETE FROM items' } }
  assert.equal((await host('ask').gate(exec, async () => ({ kind: 'allow' }))).kind, 'ask')
  assert.equal((await host('ask', { readOnly: true }).gate(exec, async () => ({ kind: 'allow' }))).kind, 'deny')
  assert.equal(host('never', { writeApproval: false }).gate, undefined)
})
test('SQL 连接可用但审批不可用时，健康检查不误报全部功能正常', async () => {
  const { tools, adapters } = buildSqlTools(resolveConfig({}), () => 'never')
  try {
    const health = await tools.find(t => t.name === 'sql_health').execute({}, {})
    assert.equal(health.connections[0].ok, true)
    assert.equal(health.ok, false)
    assert.equal(health.writeApprovalReady, false)
    assert.match(health.writeApprovalDetail, /never.*writeApproval=false/)
  } finally { for (const adapter of adapters.values()) await adapter.close() }
})
