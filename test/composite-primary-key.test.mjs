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
