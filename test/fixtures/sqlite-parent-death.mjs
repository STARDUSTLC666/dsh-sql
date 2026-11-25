import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

if (process.platform === 'win32') {
  const originalFork = childProcess.fork
  // Disable Windows job-object cleanup in this fixture so it also exercises the
  // IPC-disconnect guarantee needed on Unix, where that OS safety net is absent.
  childProcess.fork = (entry, args, options) => originalFork(entry, args, { ...options, detached: true })
  syncBuiltinESMExports()
}

const { createAdapter } = await import('../../lib/index.js')
const adapter = createAdapter({ name: 'owned-parent-death', engine: 'sqlite', file: ':memory:' })
await adapter.ping()
let settled = false
const operation = adapter.query('WITH RECURSIVE busy(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM busy) SELECT sum(x) FROM busy')
operation.finally(() => { settled = true }).catch(() => {})
process.stdout.write(JSON.stringify({ worker: adapter.running.child.pid }) + '\n')
setTimeout(() => process.stdout.write(JSON.stringify({ pending: !settled }) + '\n'), 200)
await operation
