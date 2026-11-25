import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const scenario of ['query-timeout', 'exec-timeout', 'cancel', 'queued-cancel', 'memory-invalid', 'close', 'readonly-reopen', 'pre-abort']) {
  test('SQLite real process interruption: ' + scenario, async () => {
    await new Promise((resolve, reject) => {
      // An external watchdog remains runnable even if the implementation blocks its own event loop.
      const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/sqlite-interruption-case.mjs', import.meta.url)), scenario], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
      })
      let output = '', errors = '', expired = false
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { errors += chunk })
      const timer = setTimeout(() => {
        expired = true
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
          killer.once('error', () => child.kill('SIGKILL'))
        } else {
          try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
        }
      }, 15000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => {
        clearTimeout(timer)
        try {
          assert.equal(expired, false, 'external watchdog terminated a stalled SQLite process tree')
          assert.equal(code, 0, errors + output)
          assert.deepEqual(JSON.parse(output.trim()), { scenario, passed: true })
          resolve()
        } catch (error) { reject(error) }
      })
    })
  })
}
