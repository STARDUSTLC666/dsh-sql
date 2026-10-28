import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  apply,
  assertReadQuery,
  buildSqlTools,
  createAdapter,
  postgresPoolConfig,
  resolveConfig,
  summarizeWriteScript,
} from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-ro-'))
const file = join(dir, 'app.db')
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })

// 服务器看到的是：SELECT '\'; DELETE FROM users; --'
// PostgreSQL（standard_conforming_strings=on）与 SQLite 都会把它当成两条语句。
const BACKSLASH_PAYLOAD = "SELECT '\\'; DELETE FROM users; --'"
// 双引号标识符里反斜杠在三种引擎里都不是转义。
const IDENT_PAYLOAD = `SELECT 1 AS "x\\"; UPDATE users SET secret = 'pwned'; --"`

test('#3 反斜杠载荷：PostgreSQL / SQLite 按服务器语义判成两条语句并拒绝', () => {
  assert.throws(() => assertReadQuery(BACKSLASH_PAYLOAD, 'postgres'), /一次只允许一条语句/)
  assert.throws(() => assertReadQuery(BACKSLASH_PAYLOAD, 'sqlite'), /一次只允许一条语句/)
  // 不传引擎时按最保守的字面量语义，同样拒绝。
  assert.throws(() => assertReadQuery(BACKSLASH_PAYLOAD), /一次只允许一条语句/)
})

test('#3 反斜杠载荷：MySQL 默认把 \\ 当转义，整串是一条字符串（与 mysql2 multipleStatements=false 一致）', () => {
  const sql = assertReadQuery(BACKSLASH_PAYLOAD, 'mysql')
  assert.equal(sql, BACKSLASH_PAYLOAD)
})

test('#3 双引号标识符里的反斜杠不再是转义（三种引擎都拒绝第二条语句）', () => {
  for (const engine of ['postgres', 'sqlite', 'mysql', undefined]) {
    assert.throws(() => assertReadQuery(IDENT_PAYLOAD, engine), /一次只允许一条语句/, 'engine=' + engine)
  }
})

test('#3 PostgreSQL 仍然接受合法的 E\'…\' 转义字符串，并拒绝其后的第二条语句', () => {
  // E 字符串里 \\' 是转义引号，整条只有一个语句。
  const escapeString = "SELECT E'it\\'s'"
  assert.equal(assertReadQuery(escapeString, 'postgres'), escapeString)
  // E 字符串在 \\' 之后才结束，所以后面的 DELETE 是真真切切的第二条语句。
  assert.throws(() => assertReadQuery("SELECT E'it\\'s'; DELETE FROM users", 'postgres'), /一次只允许一条语句/)
})

test('#3 PRAGMA 函数式写法不再绕过白名单', () => {
  const blocked = [
    'PRAGMA journal_mode(wal)',
    'PRAGMA user_version(4242)',
    'PRAGMA foreign_keys(0)',
    'PRAGMA ignore_check_constraints(1)',
    'PRAGMA writable_schema(1)',
    'PRAGMA synchronous(0)',
    'PRAGMA secure_delete(0)',
    'PRAGMA cell_size_check(0)',
    'PRAGMA cache_size(-200000)',
    'PRAGMA temp_store(2)',
    'PRAGMA foreign_keys = 0',
    'PRAGMA journal_mode=WAL',
    'PRAGMA user_version = 7',
  ]
  for (const sql of blocked) {
    assert.throws(() => assertReadQuery(sql, 'sqlite'), /PRAGMA/, sql)
  }
})

test('#3 只读 PRAGMA 内省仍然可用', () => {
  const allowed = [
    "PRAGMA table_info('users')",
    'PRAGMA table_info(users)',
    'PRAGMA index_list(users)',
    'PRAGMA foreign_key_list(users)',
    'PRAGMA foreign_key_check',
    'PRAGMA foreign_key_check(users)',
    'PRAGMA page_count',
    'PRAGMA page_size',
    'PRAGMA user_version',
    'PRAGMA database_list',
    'PRAGMA integrity_check',
    'PRAGMA compile_options',
  ]
  for (const sql of allowed) {
    assert.doesNotThrow(() => assertReadQuery(sql, 'sqlite'), sql)
  }
})

test('#3 readOnly 时 PostgreSQL 连接保留只读启动默认值', () => {
  const connection = { name: 'pg', engine: 'postgres', host: 'h', database: 'd', user: 'u' }
  assert.equal(postgresPoolConfig(connection, false).options, undefined)
  assert.equal(postgresPoolConfig(connection, true).options, '-c default_transaction_read_only=on')
})

test('#3 readOnly 时 SQLite 由引擎自身拒绝写操作', async () => {
  const writable = createAdapter({ name: 'w', engine: 'sqlite', file })
  await writable.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
  await writable.exec("INSERT INTO users (name) VALUES ('a')")
  await writable.close()

  const readOnly = createAdapter({ name: 'r', engine: 'sqlite', file }, { readOnly: true })
  const rows = await readOnly.query('SELECT COUNT(*) FROM users', 10)
  assert.equal(rows.rows[0][0], 1)
  await assert.rejects(() => readOnly.exec("DELETE FROM users"), /readonly|read-only|attempt to write/i)
  await assert.rejects(() => readOnly.exec('PRAGMA user_version(4242)'), /readonly|read-only|attempt to write/i)
  await readOnly.close()
})

test('#3 sql_query 在词法层就拦下多语句载荷', async () => {
  const cfg = resolveConfig({
    connections: [{ name: 'ro', engine: 'sqlite', file }],
    readOnly: true,
  })
  const { tools, adapters } = buildSqlTools(cfg)
  const query = tools.find((tool) => tool.name === 'sql_query')
  const exec = tools.find((tool) => tool.name === 'sql_exec')
  const ok = await query.execute({ sql: 'SELECT name FROM users' }, {})
  assert.equal(ok.rowCount, 1)
  await assert.rejects(() => query.execute({ sql: BACKSLASH_PAYLOAD }, {}), /一次只允许一条语句/)
  await assert.rejects(() => query.execute({ sql: 'PRAGMA writable_schema(1)' }, {}), /PRAGMA/)
  await assert.rejects(() => exec.execute({ sql: 'DELETE FROM users' }, {}), /readOnly=true/)
  for (const adapter of adapters.values()) await adapter.close()
})

test('#3 被拒的 SQL 不会打开（或新建）数据库文件', async () => {
  const target = join(dir, 'never-created.db')
  const cfg = resolveConfig({ connections: [{ name: 'fresh', engine: 'sqlite', file: target }] })
  const { tools } = buildSqlTools(cfg)
  const query = tools.find((tool) => tool.name === 'sql_query')
  await assert.rejects(() => query.execute({ sql: BACKSLASH_PAYLOAD }, {}), /一次只允许一条语句/)
  assert.equal(existsSync(target), false, '词法校验应发生在打开连接之前')
})

test('#3 审批摘要逐条列出语句，200 字符后的 DROP 不会被藏起来', async () => {
  const sql = "UPDATE t SET v='" + 'A'.repeat(190) + "' -- \n; DROP TABLE t"
  const summary = summarizeWriteScript(sql)
  assert.match(summary, /共 2 条语句/)
  assert.match(summary, /DROP TABLE t/)
  assert.match(summary, /语句类型：UPDATE×1，DROP×1/)

  const { ctx, listeners } = makeFakeCtx()
  apply(ctx, { writeApproval: true })
  const reason = await listeners['tools/pre-execute'][0]({ name: 'sql_exec', arguments: { sql } }, async () => ({ kind: 'allow' }))
  assert.equal(reason.kind, 'ask')
  assert.ok(reason.reason.includes('DROP TABLE t'), reason.reason)
})

function makeFakeCtx() {
  const listeners = {}
  const ctx = {
    tools: { register: () => () => {} },
    on(event, listener) { (listeners[event] ??= []).push(listener); return () => {} },
  }
  return { ctx, listeners }
}
