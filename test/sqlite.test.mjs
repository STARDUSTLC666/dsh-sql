import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapter } from '../lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-int-'))
const file = join(dir, 'test.db')
const adapter = createAdapter({ name: 't', engine: 'sqlite', file })

after(async () => {
  try { await adapter.close() } catch {}
  rmSync(dir, { recursive: true, force: true })
})

test('SQLite：建表/插入/查询/描述/列表', async () => {
  await adapter.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL)')
  await adapter.exec("INSERT INTO users (name, score) VALUES ('张三', 99.5)")
  await adapter.exec("INSERT INTO users (name, score) VALUES ('李四', 88)")
  const result = await adapter.query('SELECT id, name, score FROM users ORDER BY id')
  assert.deepEqual(result.columns, ['id', 'name', 'score'])
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.rows[0], [1, '张三', 99.5])
  const tables = await adapter.listTables()
  assert.ok(tables.includes('users'))
  const columns = await adapter.describeTable('users')
  assert.equal(columns.length, 3)
  assert.equal(columns[0].primaryKey, true)
  assert.equal(columns[1].notNull, true)
})

test('SQLite：exec 返回 changes，单语句 DDL 不残留前一次 DML 的变更计数', async () => {
  const changes = await adapter.exec("UPDATE users SET score = 100 WHERE name = '张三'")
  assert.equal(changes, 1)
  // 单语句 DDL 紧跟 DML 后必须返回 0，而不是残留上一次 DML 的 sqlite3_changes()
  assert.equal(await adapter.exec('ALTER TABLE users ADD COLUMN tag TEXT'), 0)
  assert.equal(await adapter.exec('CREATE TABLE ddl_tmp (id INTEGER PRIMARY KEY, val TEXT)'), 0)
  assert.equal(await adapter.exec("INSERT INTO ddl_tmp (val) VALUES ('x'), ('y'), ('z')"), 3)
  assert.equal(await adapter.exec('DELETE FROM ddl_tmp'), 3)
  assert.equal(await adapter.exec('CREATE TABLE ddl_after_delete (id INTEGER)'), 0)
  assert.equal(await adapter.exec('DROP TABLE ddl_after_delete'), 0)
  assert.equal(await adapter.exec('DROP TABLE ddl_tmp'), 0)
  const multi = await adapter.exec('CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER)')
  assert.equal(multi, 0)
})

test('SQLite：exec 字符串含分号与多语句 DML 返回准确变更行数，失败自动回滚', async () => {
  await adapter.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  // 分号在字符串字面量内：仍按单语句执行，准确返回 1
  const singleWithSemi = await adapter.exec("INSERT INTO notes (body) VALUES ('a; b')")
  assert.equal(singleWithSemi, 1)

  // 多语句 DML：返回精确累计变更行数 1 + 2 = 3
  const multiDml = await adapter.exec("INSERT INTO notes (body) VALUES ('c'); INSERT INTO notes (body) VALUES ('d'), ('e')")
  assert.equal(multiDml, 3)

  // 多语句第 2 条失败时，自动包裹的事务回滚第 1 条插入
  await assert.rejects(() => adapter.exec("INSERT INTO notes (body) VALUES ('should-rollback'); INSERT INTO nonexistent VALUES (1)"))
  const count = await adapter.query('SELECT COUNT(*) FROM notes')
  assert.equal(count.rows[0][0], 4)

  // 脚本自带 BEGIN / COMMIT 或 PRAGMA 时正常执行不报嵌套事务错
  const manualTx = await adapter.exec("BEGIN; INSERT INTO notes (body) VALUES ('manual'); COMMIT;")
  assert.equal(manualTx, 1)

  // 纯注释或空语句返回 0
  assert.equal(await adapter.exec('  -- comment only\n ; '), 0)
})

test('SQLite：显式事务脚本失败时回滚本脚本打开的事务', async () => {
  const mem = createAdapter({ name: 'explicit-tx-failure', engine: 'sqlite', file: ':memory:' })
  try {
    await mem.exec('CREATE TABLE tx_items (id INTEGER PRIMARY KEY)')
    await assert.rejects(() => mem.exec(
      'BEGIN; INSERT INTO tx_items VALUES (1); INSERT INTO missing_table VALUES (2)',
    ))
    assert.deepEqual(await mem.query('SELECT id FROM tx_items'), { columns: ['id'], rows: [] })
    assert.equal(mem.db.isTransaction, false)
  } finally {
    await mem.close()
  }
})

test('SQLite：多语句失败不回滚调用前已打开的事务', async () => {
  const mem = createAdapter({ name: 'existing-tx-failure', engine: 'sqlite', file: ':memory:' })
  try {
    await mem.exec('CREATE TABLE tx_items (id INTEGER PRIMARY KEY)')
    await mem.exec('BEGIN')
    await mem.exec('INSERT INTO tx_items VALUES (1)')
    await assert.rejects(mem.exec('INSERT INTO tx_items VALUES (2); INSERT INTO missing_table VALUES (3)'))
    assert.equal(mem.db.isTransaction, true)
    assert.deepEqual((await mem.query('SELECT id FROM tx_items ORDER BY id')).rows, [[1], [2]])
    await mem.exec('ROLLBACK')
    assert.deepEqual((await mem.query('SELECT id FROM tx_items')).rows, [])
  } finally {
    await mem.close()
  }
})

test('SQLite：query(limit) 只迭代前 N 行，不全量载入', async () => {
  const capped = await adapter.query('SELECT id, name FROM users ORDER BY id', 1)
  assert.deepEqual(capped.columns, ['id', 'name'])
  assert.equal(capped.rows.length, 1)
  assert.deepEqual(capped.rows[0], [1, '张三'])
})

test('SQLite：64 位整数、重名列、BLOB 紧凑编码与空结果保留列名', async () => {
  for (const limit of [undefined, 10]) {
    const result = await adapter.query('SELECT 9223372036854775807 AS id, -9223372036854775808 AS id, 7 AS small', limit)
    assert.deepEqual(result.columns, ['id', 'id', 'small'])
    assert.deepEqual(result.rows, [['9223372036854775807', '-9223372036854775808', 7]])
    assert.doesNotThrow(() => JSON.stringify(result))
    assert.deepEqual(await adapter.query('SELECT id, name FROM users WHERE 0', limit), { columns: ['id', 'name'], rows: [] })

    const blobRes = await adapter.query("SELECT X'deadbeef' AS small_blob, zeroblob(128) AS big_blob", limit)
    assert.equal(blobRes.rows[0][0], '0xdeadbeef')
    assert.equal(blobRes.rows[0][1], '<BLOB 128 bytes, hex: 0x' + '00'.repeat(16) + '...>')
  }
})

test('SQLite：即使 readOnly=false，query() 也由 PRAGMA query_only 拒绝写操作并在事后恢复可写', async () => {
  const mem = createAdapter({ name: 'rw-mem', engine: 'sqlite', file: ':memory:' })
  try {
    await mem.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('keep')")
    await assert.rejects(
      () => mem.query('WITH a AS (SELECT 1) DELETE/*x*/FROM items'),
      /readonly|read-only|attempt to write/i,
    )
    await assert.rejects(
      () => mem.query('PRAGMA user_version = 42'),
      /readonly|read-only|attempt to write/i,
    )
    // query_only 在 finally 中被还原，后续正常 exec 仍然可写
    assert.equal(await mem.exec("INSERT INTO items (name) VALUES ('after')"), 1)
    const rows = await mem.query('SELECT name FROM items ORDER BY id')
    assert.deepEqual(rows.rows, [['keep'], ['after']])
  } finally {
    await mem.close()
  }
})

test('SQLite：:memory: 在 readOnly=true 下同样禁止 exec() 与写 query()', async () => {
  const memRo = createAdapter({ name: 'ro-mem', engine: 'sqlite', file: ':memory:' }, { readOnly: true })
  try {
    assert.deepEqual((await memRo.query('SELECT 1 AS ok')).rows, [[1]])
    await assert.rejects(() => memRo.exec('CREATE TABLE bad (id INT)'), /readOnly=true/)
    await assert.rejects(() => memRo.query('PRAGMA user_version = 99'), /readonly|read-only|attempt to write/i)
  } finally {
    await memRo.close()
  }
})

test('SQLite：describeTableDetail 返回默认值、索引与外键，且支持连字符与 Unicode 表名', async () => {
  const mem = createAdapter({ name: 'meta', engine: 'sqlite', file: ':memory:' })
  try {
    await mem.exec(`
      CREATE TABLE "parent-tbl" (id INTEGER PRIMARY KEY);
      CREATE TABLE "用户-表" (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER REFERENCES "parent-tbl"(id),
        email TEXT NOT NULL UNIQUE,
        status TEXT DEFAULT 'active',
        score REAL DEFAULT 0
      );
      CREATE INDEX "idx_用户_status" ON "用户-表" (status, score);
    `)
    const detail = await mem.describeTableDetail('用户-表')
    assert.equal(detail.table, '用户-表')
    assert.equal(detail.columns.length, 5)
    assert.equal(detail.columns.find((c) => c.name === 'status')?.defaultValue, "'active'")
    assert.equal(detail.columns.find((c) => c.name === 'score')?.defaultValue, '0')
    assert.equal(detail.columns.find((c) => c.name === 'email')?.defaultValue, null)

    const statusIdx = detail.indexes.find((idx) => idx.name === 'idx_用户_status')
    assert.ok(statusIdx)
    assert.equal(statusIdx.unique, false)
    assert.deepEqual(statusIdx.columns, ['status', 'score'])

    const emailIdx = detail.indexes.find((idx) => idx.unique && idx.columns.includes('email'))
    assert.ok(emailIdx)

    assert.deepEqual(detail.foreignKeys, [{ column: 'parent_id', refTable: 'parent-tbl', refColumn: 'id' }])

    // 支持带 schema 前缀（main.表名）与连字符表名
    const mainCols = await mem.describeTable('main."parent-tbl"')
    assert.equal(mainCols.length, 1)
    assert.equal(mainCols[0].name, 'id')
    assert.equal(mainCols[0].primaryKey, true)

    // 拒绝非法表名注入
    await assert.rejects(() => mem.describeTable('users; DROP TABLE users'), /非法/)
  } finally {
    await mem.close()
  }
})

test('SQLite：describeTableDetail 对不存在的表 0 列早退，仅执行 1 次 table_info', async () => {
  const mem = createAdapter({ name: 'meta-missing', engine: 'sqlite', file: ':memory:' })
  try {
    const prepared = []
    const origPrepare = mem.db.prepare.bind(mem.db)
    mem.db.prepare = (sql) => {
      prepared.push(sql)
      return origPrepare(sql)
    }

    const missing = await mem.describeTableDetail('nonexistent_tbl')
    assert.deepEqual(missing, {
      table: 'nonexistent_tbl',
      comment: null,
      columns: [],
      indexes: [],
      foreignKeys: [],
    })
    assert.equal(prepared.length, 1)
    assert.match(prepared[0], /PRAGMA table_info\("nonexistent_tbl"\)/)

    prepared.length = 0
    const missingWithSchema = await mem.describeTableDetail('main.nonexistent_tbl')
    assert.deepEqual(missingWithSchema, {
      table: 'nonexistent_tbl',
      schema: 'main',
      comment: null,
      columns: [],
      indexes: [],
      foreignKeys: [],
    })
    assert.equal(prepared.length, 1)
    assert.match(prepared[0], /PRAGMA "main"\.table_info\("nonexistent_tbl"\)/)
  } finally {
    await mem.close()
  }
})

test('SQLite：query 与 exec 支持参数化查询（params）', async () => {
  const mem = createAdapter({ name: 'params', engine: 'sqlite', file: ':memory:' })
  try {
    await mem.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, active INTEGER, note TEXT)')
    assert.equal(
      await mem.exec('INSERT INTO items (label, active, note) VALUES (?, ?, ?)', undefined, { params: ['alpha', true, null] }),
      1,
    )
    assert.equal(
      await mem.exec('INSERT INTO items (label, active, note) VALUES (?, ?, ?)', undefined, { params: ['beta', false, 'ok'] }),
      1,
    )
    await assert.rejects(
      () => mem.exec('INSERT INTO items (label) VALUES (?); INSERT INTO items (label) VALUES (?)', undefined, { params: ['x', 'y'] }),
      /仅支持单条语句/,
    )
    for (const limit of [undefined, 1]) {
      const res = await mem.query('SELECT label, active, note FROM items WHERE active = ? ORDER BY id', limit, undefined, { params: [true] })
      assert.deepEqual(res.rows, [['alpha', 1, null]])
    }
  } finally {
    await mem.close()
  }
})

test('SQLite：仅使用 SQLite（及未查询的 MySQL/PG 适配器）时不加载 mysql2 或 pg 驱动', async () => {
  const unusedMy = createAdapter({ name: 'unused-my', engine: 'mysql', database: 'app' })
  const unusedPg = createAdapter({ name: 'unused-pg', engine: 'postgres', database: 'app' })
  await unusedMy.close()
  await unusedPg.close()

  const req = createRequire(import.meta.url)
  const loaded = Object.keys(req.cache).filter((id) => /[\\/](?:mysql2|pg)[\\/]/.test(id))
  assert.deepEqual(loaded, [], 'SQLite-only usage must not eagerly load mysql2 or pg')
})

test('SQLite：ping 与关闭', async () => {
  await adapter.ping()
  await adapter.close()
  await assert.rejects(() => adapter.ping())
})
