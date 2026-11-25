import { fork, type ChildProcess, type ForkOptions } from 'node:child_process'
import path from 'node:path'
import { serialize } from 'node:v8'
import type { DatabaseAdapter, QueryResult, QueryOptions, ExecOptions, ColumnInfo, TableSchemaDetail } from './adapters.js'

type Method = 'query' | 'exec' | 'listTables' | 'describeTable' | 'describeTableDetail' | 'ping'
interface Request {
  id: number
  method: Method
  args: unknown[]
  resolve(value: any): void
  reject(error: unknown): void
  cleanup(): void
  process?: RunningProcess
  cancelled?: unknown
  settled?: boolean
}
interface RunningProcess {
  child: ChildProcess
  closed: Promise<void>
  error?: unknown
  stopping: boolean
  ready: boolean
}

// Idle adapters must not keep the host alive; still kill their children on a normal host exit.
const children = new Set<ChildProcess>()
process.once('exit', () => { for (const child of children) child.kill('SIGKILL') })

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

/** One persistent SQLite connection per child; cancellation ends actual native work. */
export class SqliteAdapter implements DatabaseAdapter {
  engine = 'sqlite' as const
  private readonly file: string
  private queue: Request[] = []
  private active?: Request
  private running?: RunningProcess
  private nextId = 0
  private closed = false
  private memoryInvalid = false
  private closing?: Promise<void>

  constructor(file: string, private readOnly = false) {
    this.file = file === ':memory:' ? file : path.resolve(file)
  }

  private memoryError(): Error {
    return errorWithCode('SQLite :memory: 连接已因中断或进程退出而失效，内存数据和未提交事务已丢失；请重新建立连接。 / In-memory SQLite connection was invalidated; recreate it explicitly.', 'SQLITE_MEMORY_INVALIDATED')
  }

  private finish(request: Request, error?: unknown, value?: unknown): void {
    if (request.settled) return
    request.settled = true
    request.cleanup()
    if (this.active === request) this.active = undefined
    else this.queue = this.queue.filter(item => item !== request)
    if (error !== undefined) request.reject(error)
    else request.resolve(value)
  }

  private interruptionError(request: Request, reason: unknown): unknown {
    if (request.method !== 'exec') return reason
    return Object.assign(new Error((reason instanceof Error ? reason.message : String(reason)) + ' SQLite 执行结果可能已提交；连接已重置，未提交事务将回滚，请核对后再重试。 / The write may already have committed; verify its outcome before retrying.', { cause: reason }), { name: reason instanceof Error ? reason.name : 'AbortError', code: (reason as { code?: string })?.code, sqliteOutcome: 'unknown' })
  }

  private cancel(request: Request, reason: unknown): void {
    if (request.settled) return
    if (this.active !== request) { this.finish(request, reason); return }
    if (request.cancelled !== undefined) return
    request.cancelled = this.interruptionError(request, reason)
    const running = request.process
    if (running) this.stop(running)
    else { this.finish(request, reason); this.pump() }
  }

  private stop(running: RunningProcess): void {
    if (running.stopping) return
    running.stopping = true
    running.child.ref()
    running.child.channel?.ref()
    running.child.kill('SIGKILL')
  }

  private start(): RunningProcess {
    const options: ForkOptions & { windowsHide: boolean } = {
      execArgv: [], serialization: 'advanced', windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }
    const child = fork(new URL('./sqlite-process.js', import.meta.url), [], options)
    let resolveClosed!: () => void
    const running: RunningProcess = { child, closed: new Promise(resolve => { resolveClosed = resolve }), stopping: false, ready: false }
    this.running = running
    children.add(child)
    child.on('error', error => { running.error = error; this.stop(running) })
    child.on('close', (code, signal) => {
      children.delete(child)
      if (this.running === running) this.running = undefined
      // A terminated memory connection must never silently reopen as an empty database.
      if (this.file === ':memory:' && !this.closed) this.memoryInvalid = true
      resolveClosed()
      // Queued operations belong to the previous session (including open transactions).
      // Never replay them on a fresh connection, where writes could become autocommit.
      const reset = errorWithCode('SQLite 连接中断，会话与未提交事务已重置；排队操作未执行，请核对数据库后重新发起。 / SQLite session was reset; queued operations were not executed.', 'SQLITE_CONNECTION_RESET')
      for (const request of [...this.queue]) this.finish(request, this.memoryInvalid ? this.memoryError() : reset)
      if (this.active?.process === running) {
        const request = this.active
        this.finish(request, request.cancelled ?? this.interruptionError(request, running.error ?? errorWithCode('SQLite 执行进程已退出（' + String(signal ?? code) + '），连接已重置，未提交事务已回滚。', 'SQLITE_PROCESS_EXITED')))
      }
      this.pump()
    })
    child.on('message', (message: any) => {
      if (message?.type === 'ready') { running.ready = true; return }
      const request = this.active
      if (message?.type !== 'result' || request?.process !== running || message.id !== request.id || request.cancelled !== undefined || running.stopping) return
      if (message.error) {
        const error = Object.assign(new Error(message.error.message), message.error)
        // Initialization failures cannot leave an unusable idle process behind.
        if (!running.ready) { request.cancelled = error; this.stop(running); return }
        this.finish(request, error)
      } else this.finish(request, undefined, message.value)
      child.unref()
      child.channel?.unref()
      this.pump()
    })
    return running
  }

  private pump(): void {
    if (this.active || this.closed || this.running?.stopping) return
    if (this.memoryInvalid) {
      for (const request of [...this.queue]) this.finish(request, this.memoryError())
      return
    }
    const request = this.queue.shift()
    if (!request) return
    this.active = request
    try {
      const running = this.running ?? this.start()
      request.process = running
      running.child.ref()
      running.child.channel?.ref()
      running.child.send({ type: 'request', id: request.id, method: request.method, args: request.args, file: this.file, readOnly: this.readOnly }, error => {
        if (error && this.active === request) this.cancel(request, error)
      })
    } catch (error) {
      if (request.process) this.cancel(request, error)
      else { this.finish(request, error); this.pump() }
    }
  }

  private async request<T>(method: Method, args: unknown[], signal?: AbortSignal, timeoutMs?: number): Promise<T> {
    signal?.throwIfAborted()
    if (this.closed) return Promise.reject(errorWithCode('SQLite 连接已关闭 / SQLite connection is closed', 'SQLITE_CLOSED'))
    if (this.memoryInvalid) return Promise.reject(this.memoryError())
    // A local IPC encoding error did not execute SQL and must not discard the connection.
    try { serialize(args) } catch (error) { return Promise.reject(error) }
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => this.cancel(request, signal!.reason ?? new DOMException('The operation was aborted', 'AbortError'))
      const request: Request = {
        id: ++this.nextId, method, args, resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) },
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && Math.round(timeoutMs) > 0) {
        timer = setTimeout(() => this.cancel(request, Object.assign(new Error('SQLite operation timed out; its connection was reset.'), { name: 'TimeoutError', code: 'SQLITE_TIMEOUT' })), Math.min(2_147_483_647, Math.round(timeoutMs)))
      }
      this.queue.push(request)
      this.pump()
    })
  }

  listTables(signal?: AbortSignal, schema?: string): Promise<string[]> { return this.request('listTables', [schema], signal) }
  describeTable(table: string, signal?: AbortSignal): Promise<ColumnInfo[]> { return this.request('describeTable', [table], signal) }
  describeTableDetail(table: string, signal?: AbortSignal): Promise<TableSchemaDetail> { return this.request('describeTableDetail', [table], signal) }
  query(sql: string, limit?: number, signal?: AbortSignal, options?: QueryOptions): Promise<QueryResult> { return this.request('query', [sql, limit, { params: options?.params }], signal, options?.timeoutMs) }
  exec(sql: string, signal?: AbortSignal, options?: ExecOptions): Promise<number> {
    if (this.readOnly) return Promise.reject(new Error('当前配置 readOnly=true，禁止写入数据库。'))
    return this.request('exec', [sql, { params: options?.params }], signal, options?.timeoutMs)
  }
  ping(signal?: AbortSignal): Promise<void> { return this.request('ping', [], signal) }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    const error = errorWithCode('SQLite 连接已关闭 / SQLite connection is closed', 'SQLITE_CLOSED')
    for (const request of [...this.queue]) this.finish(request, error)
    const running = this.running
    if (!running) return this.closing = Promise.resolve()
    running.child.ref()
    running.child.channel?.ref()
    if (this.active) this.cancel(this.active, error)
    else {
      running.stopping = true
      try { running.child.send({ type: 'close' }, error => { if (error) running.child.kill('SIGKILL') }) }
      catch { running.child.kill('SIGKILL') }
    }
    const timer = setTimeout(() => running.child.kill('SIGKILL'), 1000)
    return this.closing = running.closed.finally(() => clearTimeout(timer))
  }
}
