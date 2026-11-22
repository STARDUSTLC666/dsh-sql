import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdapter } from '../lib/index.js'

test('SQLite schema identifies every column in an ordered composite primary key', async () => {
  const adapter = createAdapter({ name: 'composite', engine: 'sqlite', file: ':memory:' })
  try {
    await adapter.exec('CREATE TABLE membership (tenant INTEGER, user INTEGER, note TEXT, PRIMARY KEY (tenant, user))')
    const columns = await adapter.describeTable('membership')
    assert.deepEqual(columns.map(({ name, primaryKey }) => ({ name, primaryKey })), [
      { name: 'tenant', primaryKey: true }, { name: 'user', primaryKey: true }, { name: 'note', primaryKey: false },
    ])
  } finally { await adapter.close() }
})

test('PostgreSQL describeTable / describeTableDetail via pg_catalog supports schema.table, composite PK, real types, defaults, comments, indexes and FKs', async () => {
  const adapter = createAdapter({ name: 'pg-meta', engine: 'postgres', database: 'app' })
  const seen = []
  adapter.pool = {
    async query(sql, values) {
      seen.push({ sql, values })
      if (sql.includes('pg_catalog.format_type')) {
        return {
          rows: [
            { column_name: 'tenant_id', data_type: 'integer', not_null: true, is_primary: true, default_value: null, column_comment: '租户 ID' },
            { column_name: 'user_id', data_type: 'integer', not_null: true, is_primary: true, default_value: null, column_comment: null },
            { column_name: 'tags', data_type: 'text[]', not_null: false, is_primary: false, default_value: "'{}'::text[]", column_comment: '标签列表' },
          ],
        }
      }
      if (sql.includes('pg_catalog.obj_description')) {
        return { rows: [{ table_comment: '成员关系表' }] }
      }
      if (sql.includes('pg_catalog.pg_index')) {
        return {
          rows: [
            { index_name: 'membership_pkey', is_unique: true, index_columns: ['tenant_id', 'user_id'] },
            { index_name: 'idx_membership_tags', is_unique: false, index_columns: ['tags'] },
          ],
        }
      }
      if (sql.includes("con.contype = 'f'")) {
        return {
          rows: [
            { column_name: 'tenant_id', ref_table: 'analytics.tenants', ref_column: 'id' },
          ],
        }
      }
      throw new Error('unexpected query: ' + sql)
    },
  }

  const detail = await adapter.describeTableDetail('analytics.membership')
  assert.equal(detail.schema, 'analytics')
  assert.equal(detail.table, 'membership')
  assert.equal(detail.comment, '成员关系表')
  assert.deepEqual(detail.columns, [
    { name: 'tenant_id', type: 'integer', notNull: true, primaryKey: true, defaultValue: null, comment: '租户 ID' },
    { name: 'user_id', type: 'integer', notNull: true, primaryKey: true, defaultValue: null, comment: null },
    { name: 'tags', type: 'text[]', notNull: false, primaryKey: false, defaultValue: "'{}'::text[]", comment: '标签列表' },
  ])
  assert.deepEqual(detail.indexes, [
    { name: 'membership_pkey', unique: true, columns: ['tenant_id', 'user_id'] },
    { name: 'idx_membership_tags', unique: false, columns: ['tags'] },
  ])
  assert.deepEqual(detail.foreignKeys, [
    { column: 'tenant_id', refTable: 'analytics.tenants', refColumn: 'id' },
  ])
  assert.deepEqual(seen[0].values, ['analytics', 'membership'])
})

test('MySQL describeTable / describeTableDetail via SHOW FULL COLUMNS / SHOW INDEX / KEY_COLUMN_USAGE', async () => {
  const adapter = createAdapter({ name: 'my-meta', engine: 'mysql', database: 'app' })
  const seen = []
  adapter.pool = {
    async query(q) {
      const sql = typeof q === 'string' ? q : q.sql
      seen.push(q)
      if (sql.startsWith('SHOW FULL COLUMNS FROM ')) {
        return [[
          { Field: 'tenant_id', Type: 'bigint', Null: 'NO', Key: 'PRI', Default: null, Comment: '租户' },
          { Field: 'user_id', Type: 'bigint', Null: 'NO', Key: 'PRI', Default: null, Comment: '' },
          { Field: 'status', Type: "enum('active','disabled')", Null: 'NO', Key: '', Default: 'active', Comment: '状态' },
        ], []]
      }
      if (sql.startsWith('SHOW INDEX FROM ')) {
        return [[
          { Key_name: 'PRIMARY', Non_unique: 0, Seq_in_index: 2, Column_name: 'user_id' },
          { Key_name: 'PRIMARY', Non_unique: 0, Seq_in_index: 1, Column_name: 'tenant_id' },
          { Key_name: 'idx_status', Non_unique: 1, Seq_in_index: 1, Column_name: 'status' },
        ], []]
      }
      if (sql.includes('KEY_COLUMN_USAGE')) {
        return [[
          { COLUMN_NAME: 'tenant_id', REFERENCED_TABLE_NAME: 'tenants', REFERENCED_COLUMN_NAME: 'id' },
        ], []]
      }
      if (sql.includes('TABLE_COMMENT')) {
        return [[{ TABLE_COMMENT: '成员表' }], []]
      }
      throw new Error('unexpected query: ' + sql)
    },
  }

  const detail = await adapter.describeTableDetail('crm.member-ship')
  assert.equal(detail.schema, 'crm')
  assert.equal(detail.table, 'member-ship')
  assert.equal(detail.comment, '成员表')
  assert.equal(seen[0], 'SHOW FULL COLUMNS FROM `crm`.`member-ship`')
  assert.equal(seen[1], 'SHOW INDEX FROM `crm`.`member-ship`')
  assert.deepEqual(detail.columns, [
    { name: 'tenant_id', type: 'bigint', notNull: true, primaryKey: true, defaultValue: null, comment: '租户' },
    { name: 'user_id', type: 'bigint', notNull: true, primaryKey: true, defaultValue: null, comment: null },
    { name: 'status', type: "enum('active','disabled')", notNull: true, primaryKey: false, defaultValue: 'active', comment: '状态' },
  ])
  assert.deepEqual(detail.indexes, [
    { name: 'PRIMARY', unique: true, columns: ['tenant_id', 'user_id'] },
    { name: 'idx_status', unique: false, columns: ['status'] },
  ])
  assert.deepEqual(detail.foreignKeys, [
    { column: 'tenant_id', refTable: 'tenants', refColumn: 'id' },
  ])
})

test('PostgreSQL describeTable returns enumValues for enum columns and omits it when null/empty', async () => {
  const adapter = createAdapter({ name: 'pg-enum', engine: 'postgres', database: 'app' })
  const seenSql = []
  adapter.pool = {
    async query(sql, values) {
      seenSql.push({ sql, values })
      return {
        rows: [
          {
            column_name: 'id',
            data_type: 'bigint',
            not_null: true,
            is_primary: true,
            default_value: null,
            column_comment: null,
            enum_values: null,
          },
          {
            column_name: 'status',
            data_type: 'order_status',
            not_null: true,
            is_primary: false,
            default_value: "'pending'::order_status",
            column_comment: '订单状态',
            enum_values: ['pending', 'paid', 'cancelled'],
          },
          {
            column_name: 'empty_enum',
            data_type: 'unused_enum',
            not_null: false,
            is_primary: false,
            default_value: null,
            column_comment: null,
            enum_values: [],
          },
        ],
      }
    },
  }

  const columns = await adapter.describeTable('orders')
  assert.match(seenSql[0].sql, /JOIN pg_catalog\.pg_type t ON t\.oid = a\.atttypid/)
  assert.match(seenSql[0].sql, /pg_catalog\.pg_enum/)
  assert.match(seenSql[0].sql, /enumlabel::text/)
  assert.equal(Object.hasOwn(columns[0], 'enumValues'), false)
  assert.deepEqual(columns[1].enumValues, ['pending', 'paid', 'cancelled'])
  assert.equal(Object.hasOwn(columns[2], 'enumValues'), false)
})

test('PostgreSQL describeTableDetail：0 列早退仅查 1 次；有列时并发执行 3 条元数据查询', async () => {
  // 1) 0 列早退
  const missingAdapter = createAdapter({ name: 'pg-missing', engine: 'postgres', database: 'app' })
  const missingSeen = []
  missingAdapter.pool = {
    async query(sql, values) {
      missingSeen.push({ sql, values })
      return { rows: [] }
    },
  }
  const missingDetail = await missingAdapter.describeTableDetail('analytics.missing_tbl')
  assert.deepEqual(missingDetail, {
    table: 'missing_tbl',
    schema: 'analytics',
    comment: null,
    columns: [],
    indexes: [],
    foreignKeys: [],
  })
  assert.equal(missingSeen.length, 1, 'missing PG table must stop after describeTable')

  // 2) 并发执行验证：在任意一条详情查询 resolve 之前，3 条查询都必须同时进入 pool.query
  const concurrentAdapter = createAdapter({ name: 'pg-concurrent', engine: 'postgres', database: 'app' })
  const deferred = []
  concurrentAdapter.pool = {
    query(sql) {
      if (sql.includes('pg_catalog.format_type')) {
        return Promise.resolve({
          rows: [{ column_name: 'id', data_type: 'integer', not_null: true, is_primary: true, default_value: null, column_comment: null }],
        })
      }
      return new Promise((resolve) => {
        deferred.push({ sql, resolve })
      })
    },
  }
  const pending = concurrentAdapter.describeTableDetail('users')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(deferred.length, 3, 'comment, index and FK queries must run concurrently via Promise.all')
  for (const item of deferred) {
    if (item.sql.includes('obj_description')) item.resolve({ rows: [{ table_comment: '用户表' }] })
    else if (item.sql.includes('pg_index')) item.resolve({ rows: [{ index_name: 'users_pkey', is_unique: true, index_columns: ['id'] }] })
    else item.resolve({ rows: [] })
  }
  const detail = await pending
  assert.equal(detail.comment, '用户表')
  assert.equal(detail.indexes.length, 1)
})

test('MySQL describeTableDetail：0 列早退仅查 1 次；有列时并发执行 3 条元数据查询', async () => {
  // 1) 0 列早退
  const missingAdapter = createAdapter({ name: 'my-missing', engine: 'mysql', database: 'app' })
  const missingSeen = []
  missingAdapter.pool = {
    async query(q) {
      missingSeen.push(q)
      return [[], []]
    },
  }
  const missingDetail = await missingAdapter.describeTableDetail('shop.missing_tbl')
  assert.deepEqual(missingDetail, {
    table: 'missing_tbl',
    schema: 'shop',
    comment: null,
    columns: [],
    indexes: [],
    foreignKeys: [],
  })
  assert.equal(missingSeen.length, 1, 'missing MySQL table must stop after SHOW FULL COLUMNS')

  // 2) 并发执行验证：在任意一条详情查询 resolve 之前，3 条查询都必须同时进入 pool.query
  const concurrentAdapter = createAdapter({ name: 'my-concurrent', engine: 'mysql', database: 'app' })
  const deferred = []
  concurrentAdapter.pool = {
    query(q) {
      const sql = typeof q === 'string' ? q : q.sql
      if (sql.startsWith('SHOW FULL COLUMNS FROM ')) {
        return Promise.resolve([[{ Field: 'id', Type: 'bigint', Null: 'NO', Key: 'PRI', Default: null, Comment: '' }], []])
      }
      return new Promise((resolve) => {
        deferred.push({ sql, resolve })
      })
    },
  }
  const pending = concurrentAdapter.describeTableDetail('orders')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(deferred.length, 3, 'SHOW INDEX, KEY_COLUMN_USAGE and TABLES queries must run concurrently via Promise.all')
  for (const item of deferred) {
    if (item.sql.startsWith('SHOW INDEX')) item.resolve([[{ Key_name: 'PRIMARY', Non_unique: 0, Seq_in_index: 1, Column_name: 'id' }], []])
    else if (item.sql.includes('KEY_COLUMN_USAGE')) item.resolve([[], []])
    else item.resolve([[{ TABLE_COMMENT: '订单表' }], []])
  }
  const detail = await pending
  assert.equal(detail.comment, '订单表')
  assert.equal(detail.indexes.length, 1)
})
