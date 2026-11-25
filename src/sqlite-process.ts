/** Keep IPC responsive even when the SQLite thread is executing native code. */
import { Worker } from 'node:worker_threads'

const thread = new Worker(new URL('./sqlite-thread.js', import.meta.url), { execArgv: [] })
const terminate = (): void => { process.kill(process.pid, 'SIGKILL') }

// SIGKILL of the host skips its exit hook. IPC loss must still end native SQLite
// work, including on Unix where spawned processes have no Windows job-object guard.
process.on('disconnect', terminate)
process.on('message', message => {
  try { thread.postMessage(message) } catch { terminate() }
})
thread.on('message', message => {
  if (!process.connected || !process.send) { terminate(); return }
  try { process.send(message, error => { if (error) terminate() }) }
  catch { terminate() }
})
thread.on('error', terminate)
thread.on('exit', code => { process.exit(code === 0 ? 0 : 1) })
