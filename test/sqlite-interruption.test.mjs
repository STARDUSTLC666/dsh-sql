import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { once } from 'node:events'

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

test('SQLite child exits after hard parent death without Windows job-object cleanup', { timeout: 10000 }, async () => {
  const parent = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/sqlite-parent-death.mjs', import.meta.url))], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = '', errors = '', worker
  const records = []
  parent.stdout.on('data', bytes => {
    output += bytes
    for (;;) {
      const newline = output.indexOf('\n')
      if (newline < 0) break
      records.push(JSON.parse(output.slice(0, newline)))
      output = output.slice(newline + 1)
    }
  })
  parent.stderr.on('data', bytes => { errors += bytes })
  const running = async pid => {
    try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') return false; throw error }
    if (process.platform === 'linux') {
      // An exited orphan may briefly remain as a zombie until its new parent reaps it.
      try { if (/^\d+ \(.*\) Z /.test(await readFile('/proc/' + pid + '/stat', 'utf8'))) return false }
      catch (error) { if (error.code === 'ENOENT') return false; throw error }
    }
    return true
  }
  try {
    for (let attempt = 0; attempt < 100 && !records.some(record => record.pending); attempt++) await delay(30)
    worker = records.find(record => record.worker)?.worker
    assert.ok(Number.isInteger(worker) && worker > 0, errors)
    assert.ok(records.some(record => record.pending), 'the real endless query must be pending before killing its parent: ' + errors)
    const closed = once(parent, 'close')
    parent.kill('SIGKILL') // Only this PID, never a tree or process group.
    await closed
    for (let attempt = 0; attempt < 100 && await running(worker); attempt++) await delay(30)
    assert.equal(await running(worker), false, 'native SQLite work must stop even when the host exit hook cannot run')
  } finally {
    parent.kill('SIGKILL')
    if (worker) { try { process.kill(worker, 'SIGKILL') } catch {} }
  }
})
