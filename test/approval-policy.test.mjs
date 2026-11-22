import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, buildSqlTools, Config, resolveConfig } from '../lib/index.js'

const kVolatileWrite = Symbol.for('cosmokit.volatile.write')

function host(policy, config = {}) {
  const listeners = new Map(), definitions = new Map()
  const ctx = {
    get: name => name === 'approval' && policy ? { config: { policy: 'ask' }, overrideOf: () => policy } : undefined,
    tools: { register: d => { definitions.set(d.name, d); return () => {} } },
    on: (event, fn) => { listeners.set(event, fn); return () => {} },
  }
  apply(ctx, config)
  return { gate: listeners.get('tools/pre-execute'), definitions, dispose: () => listeners.get('dispose')?.() }
}

test('SQL 在 never/未知策略下明确拒绝，不声称用户点了拒绝；保留下游拒绝', async () => {
  const exec = { name: 'sql_exec', arguments: { sql: 'DELETE FROM items' }, agent: { session: {} } }
  for (const policy of ['never', undefined]) {
    const { gate, dispose } = host(policy)
    try {
      const result = await gate(exec, async () => ({ kind: 'allow' }))
      assert.equal(result.kind, 'deny')
      assert.match(result.reason, policy === 'never' ? /never.*writeApproval=false/s : /无法读取/)
      assert.doesNotMatch(result.reason, /user rejected/)
      const denied = { kind: 'deny', reason: 'Host file policy' }
      assert.equal(await gate(exec, async () => denied), denied)
    } finally {
      dispose()
    }
  }
})

test('SQL 可询问时继续请求确认，readOnly 拒绝；writeApproval=false 透传 next 且支持热更新开启', async () => {
  const exec = { name: 'sql_exec', arguments: { sql: 'DELETE FROM items' }, agent: { session: {} } }
  const askHost = host('ask')
  const roHost = host('ask', { readOnly: true })
  const liveCfg = Config({ writeApproval: false })
  const offHost = host('never', liveCfg)
  try {
    assert.equal((await askHost.gate(exec, async () => ({ kind: 'allow' }))).kind, 'ask')
    assert.equal((await roHost.gate(exec, async () => ({ kind: 'allow' }))).kind, 'deny')
    // writeApproval=false 时监听器已注册并透明委托 next()，不会误拒
    assert.equal(typeof offHost.gate, 'function')
    assert.deepEqual(await offHost.gate(exec, async () => ({ kind: 'allow' })), { kind: 'allow' })
    // 热更新切换为 true 后，never 策略下立即拒绝
    liveCfg.writeApproval[kVolatileWrite](true)
    const afterToggle = await offHost.gate(exec, async () => ({ kind: 'allow' }))
    assert.equal(afterToggle.kind, 'deny')
    assert.match(afterToggle.reason, /never.*writeApproval=false/s)
  } finally {
    askHost.dispose()
    roHost.dispose()
    offHost.dispose()
  }
})

test('单连接 readOnly=true 在审批门明确拒绝，同组可写连接正常询问', async () => {
  const h = host('ask', {
    connections: [
      { name: 'ro_db', engine: 'sqlite', file: ':memory:', readOnly: true },
      { name: 'rw_db', engine: 'sqlite', file: ':memory:' },
    ],
  })
  try {
    const roDecision = await h.gate(
      { name: 'sql_exec', arguments: { connection: 'ro_db', sql: 'DELETE FROM t' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(roDecision.kind, 'deny')
    assert.match(roDecision.reason, /ro_db/)

    const rwDecision = await h.gate(
      { name: 'sql_exec', arguments: { connection: 'rw_db', sql: 'DELETE FROM t' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(rwDecision.kind, 'ask')
    assert.match(rwDecision.reason, /rw_db/)
  } finally {
    h.dispose()
  }
})

test('readOnly=true（全局或单连接）即使 writeApproval=false 也在审批门一致拒绝，可写连接仍透传 next', async () => {
  const globalRo = host('never', { readOnly: true, writeApproval: false })
  const mixed = host('never', {
    writeApproval: false,
    connections: [
      { name: 'ro_db', engine: 'sqlite', file: ':memory:', readOnly: true },
      { name: 'rw_db', engine: 'sqlite', file: ':memory:' },
    ],
  })
  try {
    const globalDenied = await globalRo.gate(
      { name: 'sql_exec', arguments: { sql: 'DELETE FROM items' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(globalDenied.kind, 'deny')
    assert.match(globalDenied.reason, /readOnly=true/)

    const connDenied = await mixed.gate(
      { name: 'sql_exec', arguments: { connection: 'ro_db', sql: 'DELETE FROM items' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(connDenied.kind, 'deny')
    assert.match(connDenied.reason, /ro_db/)

    const rwPass = await mixed.gate(
      { name: 'sql_exec', arguments: { connection: 'rw_db', sql: 'DELETE FROM items' } },
      async () => ({ kind: 'allow' }),
    )
    assert.deepEqual(rwPass, { kind: 'allow' })
  } finally {
    globalRo.dispose()
    mixed.dispose()
  }
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

test('sql_health：全部连接均为单连接 readOnly=true 且全局 readOnly=false 时，never 策略下仍报告 ok=true', async () => {
  const cfg = resolveConfig({
    readOnly: false,
    writeApproval: true,
    connections: [
      { name: 'ro_a', engine: 'sqlite', file: ':memory:', readOnly: true },
      { name: 'ro_b', engine: 'sqlite', file: ':memory:', readOnly: true },
    ],
  })
  const { tools, adapters } = buildSqlTools(cfg, () => 'never')
  try {
    const healthTool = tools.find(t => t.name === 'sql_health')
    const health = await healthTool.execute({}, {})
    assert.equal(health.ok, true)
    assert.equal(health.readOnly, false)
    assert.equal(health.writeApprovalReady, true)
    assert.equal(health.writeApprovalDetail, '全部连接均为只读配置，不允许写入')
    const rendered = healthTool.output.render({}, health)[0].text
    assert.match(rendered, /自检：正常/)
    assert.match(rendered, /全部连接均为只读配置，不允许写入/)
    assert.match(rendered, /全部连接均配置了只读模式/)
    assert.doesNotMatch(rendered, /写审批门当前无法确认/)
  } finally {
    for (const adapter of adapters.values()) await adapter.close()
  }
})

test('sql_health：全局 readOnly=true 与部分连接只读（混合可写）区分正确', async () => {
  const globalRo = buildSqlTools(resolveConfig({ readOnly: true }), () => 'never')
  const mixed = buildSqlTools(resolveConfig({
    readOnly: false,
    connections: [
      { name: 'ro_a', engine: 'sqlite', file: ':memory:', readOnly: true },
      { name: 'rw_b', engine: 'sqlite', file: ':memory:' },
    ],
  }), () => 'never')
  try {
    const roHealth = await globalRo.tools.find(t => t.name === 'sql_health').execute({}, {})
    assert.equal(roHealth.ok, true)
    assert.equal(roHealth.writeApprovalReady, true)
    assert.equal(roHealth.writeApprovalDetail, '全局只读配置，不允许写入')

    const mixedHealth = await mixed.tools.find(t => t.name === 'sql_health').execute({}, {})
    assert.equal(mixedHealth.ok, false)
    assert.equal(mixedHealth.writeApprovalReady, false)
    assert.match(mixedHealth.writeApprovalDetail, /never.*writeApproval=false/)
  } finally {
    for (const adapter of globalRo.adapters.values()) await adapter.close()
    for (const adapter of mixed.adapters.values()) await adapter.close()
  }
})
