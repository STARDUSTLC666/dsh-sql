/** Native SQLite work stays off the child process's IPC event loop as well. */
import { parentPort } from 'node:worker_threads'
import { SqliteEngine } from './sqlite-engine.js'

let engine: SqliteEngine | undefined
parentPort!.on('message', async (message: any) => {
  if (message?.type === 'close') {
    try { await engine?.close() } finally { process.exit(0) }
  }
  if (message?.type !== 'request') return
  try {
    if (!engine) {
      engine = new SqliteEngine(message.file, message.readOnly)
      parentPort!.postMessage({ type: 'ready' })
    }
    const args = message.args
    let value: unknown
    switch (message.method) {
      case 'query': value = await engine.query(args[0], args[1], undefined, args[2]); break
      case 'exec': value = await engine.exec(args[0], undefined, args[1]); break
      case 'listTables': value = await engine.listTables(undefined, args[0]); break
      case 'describeTable': value = await engine.describeTable(args[0]); break
      case 'describeTableDetail': value = await engine.describeTableDetail(args[0]); break
      case 'ping': value = await engine.ping(); break
      default: throw new Error('Unknown SQLite operation')
    }
    parentPort!.postMessage({ type: 'result', id: message.id, value })
  } catch (error) {
    const detail = error as Error & { code?: string; errcode?: number; errstr?: string }
    parentPort!.postMessage({ type: 'result', id: message.id, error: {
      message: detail.message ?? String(error), name: detail.name, code: detail.code,
      errcode: detail.errcode, errstr: detail.errstr,
    } })
  }
})
