import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertReadQuery,
  splitSqlStatements,
  stripSqlNoise,
  summarizeWriteScript,
} from '../lib/sql-lexer.js'

test('stripSqlNoise 剥离注释与字面量时绝不拼接相邻 token', () => {
  assert.equal(stripSqlNoise('DELETE/*x*/FROM items'), 'DELETE FROM items')
  assert.equal(stripSqlNoise('SELECT/*a*/1'), 'SELECT 1')
  assert.equal(stripSqlNoise('FOR/*x*/UPDATE'), 'FOR UPDATE')
  assert.match(stripSqlNoise("INTO/*x*/OUTFILE '/tmp/x'"), /\bINTO\s+OUTFILE\b/)
  assert.match(stripSqlNoise('DELETE--x\nFROM items'), /\bDELETE\s+FROM\b/)
  assert.match(stripSqlNoise('DELETE#x\nFROM items', 'mysql'), /\bDELETE\s+FROM\b/)
  assert.equal(stripSqlNoise("SELECT'a'FROM t"), 'SELECT FROM t')
  assert.equal(stripSqlNoise('SELECT"a"FROM t'), 'SELECT FROM t')
  assert.equal(stripSqlNoise('SELECT`a`FROM t'), 'SELECT FROM t')
  assert.equal(stripSqlNoise('SELECT[a]FROM t', 'sqlite'), 'SELECT FROM t')
  assert.equal(stripSqlNoise('SELECT $$a$$FROM t', 'postgres'), 'SELECT  FROM t')
  assert.equal(stripSqlNoise('SELECT 1--eof'), 'SELECT 1 ')
})

test('MySQL 条件注释 /*!50000 ... */ 保留可执行主体并在 mysql/默认模式下被检测', () => {
  for (const engine of ['mysql', undefined]) {
    assert.match(stripSqlNoise("SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */", engine), /\bINTO\s+OUTFILE\b/)
    assert.throws(() => assertReadQuery("SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */", engine), /INTO/)
    assert.throws(() => assertReadQuery('SELECT 1 /*! FOR UPDATE */', engine), /FOR UPDATE/)
    assert.throws(() => assertReadQuery('SELECT 1 /*!50000 ; DELETE FROM users */', engine), /一次只允许一条语句/)
    assert.throws(() => assertReadQuery("SELECT /*!50000 '*/' INTO OUTFILE '/tmp/x' */", engine), /INTO/)
    assert.throws(() => assertReadQuery('/*!50000 DELETE FROM users */', engine), /只接受只读语句/)
    assert.doesNotThrow(() => assertReadQuery('SELECT 1 /*!50000 + 2 */', engine))
  }
  // PostgreSQL / SQLite 把 /*!50000 ... */ 当普通块注释处理
  assert.doesNotThrow(() => assertReadQuery("SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */", 'postgres'))
  assert.doesNotThrow(() => assertReadQuery("SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */", 'sqlite'))
})

test('PostgreSQL 嵌套块注释正确配对，非嵌套引擎按首个 */ 结束', () => {
  assert.equal(
    stripSqlNoise('SELECT /* outer /* inner */ still comment */ 1', 'postgres'),
    'SELECT   1',
  )
  assert.doesNotThrow(() =>
    assertReadQuery('SELECT /* outer /* inner ; DELETE FROM t */ still comment */ 1', 'postgres'),
  )
  assert.deepEqual(
    splitSqlStatements('UPDATE t SET a = 1 /* outer /* inner ; */ still ; */; DROP TABLE u', 'postgres'),
    ['UPDATE t SET a = 1 /* outer /* inner ; */ still ; */', 'DROP TABLE u'],
  )
  // SQLite / MySQL 不支持嵌套块注释，第一个 */ 之后的内容暴露为 SQL
  assert.throws(() => assertReadQuery('SELECT /* outer /* inner */ DELETE */ 1', 'sqlite'), /DELETE/)
  assert.throws(() => assertReadQuery('SELECT /* outer /* inner */ DELETE */ 1', 'mysql'), /DELETE/)
  // 未闭合嵌套注释不会死循环
  assert.equal(stripSqlNoise('SELECT /* outer /* inner */ unclosed', 'postgres'), 'SELECT  ')
})

test('# 行注释仅在 MySQL 生效，PG/SQLite/未指定引擎保留 # 运算符', () => {
  assert.doesNotThrow(() => assertReadQuery('SELECT 1#comment\n', 'mysql'))
  assert.doesNotThrow(() => assertReadQuery('SELECT 1 # ; DELETE FROM users', 'mysql'))
  assert.equal(stripSqlNoise('SELECT 1#comment\nFROM t', 'mysql'), 'SELECT 1\nFROM t')

  for (const engine of ['postgres', 'sqlite', undefined]) {
    assert.throws(
      () => assertReadQuery('SELECT 5 # 3; DELETE FROM users', engine),
      /一次只允许一条语句/,
      'engine=' + engine,
    )
  }
  assert.doesNotThrow(() => assertReadQuery('SELECT 5 # 3', 'postgres'))
  assert.doesNotThrow(() => assertReadQuery("SELECT data #>> '{a,b}' FROM t", 'postgres'))
})

test('MySQL -- 注释要求后跟空白/控制字符或 EOF，防止 --1 吞掉后续语句', () => {
  assert.doesNotThrow(() => assertReadQuery('SELECT 1 -- delete\n', 'mysql'))
  assert.doesNotThrow(() => assertReadQuery('SELECT 1--1', 'mysql'))
  assert.throws(() => assertReadQuery('SELECT 1--1; DELETE FROM users', 'mysql'), /一次只允许一条语句/)
})

test('单引号字符串按引擎区分反斜杠转义规则', () => {
  assert.doesNotThrow(() => assertReadQuery("SELECT 'it''s; DELETE FROM users'", 'sqlite'))
  assert.doesNotThrow(() => assertReadQuery("SELECT 'it''s; DELETE FROM users'", 'postgres'))
  assert.doesNotThrow(() => assertReadQuery("SELECT 'it''s; DELETE FROM users'", 'mysql'))

  // PostgreSQL 仅独立 E'...' / e'...' 认反斜杠转义；U&'...' 只认 '' 转义，绝不把 \' 当转义引号
  assert.doesNotThrow(() => assertReadQuery("SELECT E'it\\'s; DELETE FROM users'", 'postgres'))
  assert.doesNotThrow(() => assertReadQuery("SELECT e'it\\'s; DELETE FROM users'", 'postgres'))
  assert.doesNotThrow(() => assertReadQuery("SELECT U&'it''s; DELETE FROM users'", 'postgres'))
  assert.throws(
    () => assertReadQuery("WITH x AS (SELECT U&'a\\' UESCAPE '!') DELETE FROM users WHERE a = 'x'", 'postgres'),
    /DELETE/,
  )
  assert.throws(
    () => assertReadQuery("WITH x AS (SELECT u&'a\\' UESCAPE '!') DELETE FROM users WHERE a = 'x'", 'postgres'),
    /DELETE/,
  )
  assert.throws(() => assertReadQuery("SELECT U&'it\\'s; DELETE FROM users'", 'postgres'), /一次只允许一条语句/)
  assert.throws(() => assertReadQuery("SELECT E'a\\\\'; DELETE FROM users; --'", 'postgres'), /一次只允许一条语句/)
  assert.throws(() => assertReadQuery("SELECT TABLEE'\\'; DELETE FROM users; --'", 'postgres'), /一次只允许一条语句/)
})

test('双引号支持 "" 转义，MySQL 同时校验 ANSI_QUOTES 与默认转义模式', () => {
  for (const engine of ['sqlite', 'postgres', 'mysql', undefined]) {
    assert.doesNotThrow(() => assertReadQuery('SELECT "a""b; DELETE FROM t" FROM u', engine), 'engine=' + engine)
  }

  // MySQL 两种模式分别拦截的攻击载荷
  assert.throws(
    () => assertReadQuery(`SELECT 1 AS "x\\"; UPDATE users SET secret = 'pwned'; --"`, 'mysql'),
    /一次只允许一条语句/,
  )
  assert.throws(
    () => assertReadQuery(`SELECT "a\\" , " INTO OUTFILE '/tmp/x' -- "`, 'mysql'),
    /INTO/,
  )
  assert.throws(
    () => assertReadQuery(`SELECT "a\\"b" ; DELETE FROM users`, 'mysql'),
    /一次只允许一条语句/,
  )
  // 合法的 MySQL 双引号字符串仍然放行
  assert.doesNotThrow(() => assertReadQuery('SELECT "hello\\"world"', 'mysql'))
  assert.doesNotThrow(() => assertReadQuery('SELECT "a\\\\"', 'mysql'))
})

test('反引号支持双反引号转义，绝不认反斜杠转义', () => {
  for (const engine of ['sqlite', 'mysql', 'postgres', undefined]) {
    assert.doesNotThrow(() => assertReadQuery('SELECT `a``b; DELETE FROM t` FROM u', engine), 'engine=' + engine)
    assert.throws(
      () => assertReadQuery('SELECT `x\\`; DELETE FROM users; --`', engine),
      /一次只允许一条语句/,
      'engine=' + engine,
    )
  }
})

test('方括号 [...] 仅在 SQLite 和未指定引擎下视作引号标识符', () => {
  assert.doesNotThrow(() => assertReadQuery('SELECT [col; DELETE FROM u] FROM t', 'sqlite'))
  assert.doesNotThrow(() => assertReadQuery('SELECT [col; DELETE FROM u] FROM t'))

  // PostgreSQL / MySQL 保留 [ ] 为普通 token，不会吞掉其中的写关键字
  assert.equal(stripSqlNoise('SELECT ARRAY[1, 2]', 'postgres'), 'SELECT ARRAY[1, 2]')
  assert.throws(() => assertReadQuery('SELECT ARRAY[(DELETE FROM users)]', 'postgres'), /DELETE/)
  assert.throws(() => assertReadQuery('SELECT [1; DELETE FROM users]', 'postgres'), /一次只允许一条语句/)
  assert.throws(() => assertReadQuery('SELECT [1; DELETE FROM users]', 'mysql'), /一次只允许一条语句/)
})

test('dollar-quote 仅在 PostgreSQL 与未指定引擎生效，且不误伤标识符里的 $', () => {
  assert.doesNotThrow(() => assertReadQuery('SELECT $$a; DELETE FROM u$$', 'postgres'))
  assert.doesNotThrow(() => assertReadQuery('SELECT $tag$a; DELETE FROM u$tag$', 'postgres'))
  assert.doesNotThrow(() => assertReadQuery('SELECT $tag$a; DELETE FROM u$tag$'))

  // 标识符中的 $a$ 不得开启 dollar-quote 吞掉后续语句
  assert.throws(
    () => assertReadQuery('SELECT x$a$ FROM t; DELETE FROM users; -- $a$', 'postgres'),
    /一次只允许一条语句/,
  )
  // SQLite / MySQL 不认 dollar-quote
  assert.throws(() => assertReadQuery('SELECT $$; DELETE FROM users; -- $$', 'sqlite'), /一次只允许一条语句/)
  assert.throws(() => assertReadQuery('SELECT $$; DELETE FROM users; -- $$', 'mysql'), /一次只允许一条语句/)
})

test('splitSqlStatements 准确切分顶层分号并忽略空段与纯注释段', () => {
  assert.deepEqual(splitSqlStatements(''), [])
  assert.deepEqual(splitSqlStatements('   ; ; -- only comment\n /* block */ '), [])

  const mixed = [
    "SELECT 'a; b'",
    'SELECT "c; d"',
    'SELECT `e; f`',
    'SELECT $t$g; h$t$',
    'SELECT 1 -- a; b\nFROM t',
    'SELECT /* c; d */ 2',
  ].join('; ') + '; -- trailing comment'
  assert.deepEqual(splitSqlStatements(mixed, 'postgres'), [
    "SELECT 'a; b'",
    'SELECT "c; d"',
    'SELECT `e; f`',
    'SELECT $t$g; h$t$',
    'SELECT 1 -- a; b\nFROM t',
    'SELECT /* c; d */ 2',
  ])

  assert.deepEqual(
    splitSqlStatements('SELECT 1; /* mid */ ; SELECT 2;', 'sqlite'),
    ['SELECT 1', 'SELECT 2'],
  )
  assert.deepEqual(
    splitSqlStatements('SELECT "a\\"b;c"; DROP TABLE users; SELECT "d""e;f"', 'mysql'),
    ['SELECT "a\\"b;c"', 'DROP TABLE users', 'SELECT "d""e;f"'],
  )
  assert.deepEqual(
    splitSqlStatements("E'a\\'b'; DROP TABLE users; SELECT E'c'", 'postgres'),
    ["E'a\\'b'", 'DROP TABLE users', "SELECT E'c'"],
  )
  assert.deepEqual(
    splitSqlStatements("'a\\'b'; DROP TABLE users; SELECT 'c'", 'mysql'),
    ["'a\\'b'", 'DROP TABLE users', "SELECT 'c'"],
  )
  assert.deepEqual(
    splitSqlStatements('UPDATE t SET m = m # 1; DROP TABLE users', 'postgres'),
    ['UPDATE t SET m = m # 1', 'DROP TABLE users'],
  )
})

test('assertReadQuery 放行带括号的只读查询、REPLACE() 函数与 EXPLAIN ANALYZE', () => {
  assert.equal(assertReadQuery('(SELECT 1) UNION (SELECT 2)'), '(SELECT 1) UNION (SELECT 2)')
  assert.equal(assertReadQuery('((SELECT 1))'), '((SELECT 1))')
  assert.equal(
    assertReadQuery('(WITH a AS (SELECT 1) SELECT * FROM a)'),
    '(WITH a AS (SELECT 1) SELECT * FROM a)',
  )

  assert.equal(
    assertReadQuery("SELECT REPLACE(name, 'a', 'b') FROM users"),
    "SELECT REPLACE(name, 'a', 'b') FROM users",
  )
  assert.equal(
    assertReadQuery("SELECT replace (name, 'a', 'b') FROM users"),
    "SELECT replace (name, 'a', 'b') FROM users",
  )
  assert.equal(
    assertReadQuery("SELECT REPLACE/*c*/(name, 'a', 'b') FROM users"),
    "SELECT REPLACE/*c*/(name, 'a', 'b') FROM users",
  )

  assert.equal(assertReadQuery('EXPLAIN ANALYZE SELECT 1', 'postgres'), 'EXPLAIN ANALYZE SELECT 1')
  assert.equal(
    assertReadQuery('EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users', 'postgres'),
    'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users',
  )
  assert.equal(
    assertReadQuery('EXPLAIN (ANALYZE true, FORMAT JSON) SELECT * FROM users', 'postgres'),
    'EXPLAIN (ANALYZE true, FORMAT JSON) SELECT * FROM users',
  )
  assert.equal(
    assertReadQuery('EXPLAIN (ANALYZE) WITH cte AS (SELECT 1) SELECT * FROM cte', 'postgres'),
    'EXPLAIN (ANALYZE) WITH cte AS (SELECT 1) SELECT * FROM cte',
  )
  assert.equal(assertReadQuery('EXPLAIN ANALYZE SELECT 1', 'mysql'), 'EXPLAIN ANALYZE SELECT 1')
  assert.equal(assertReadQuery('DESCRIBE users', 'mysql'), 'DESCRIBE users')
  assert.equal(assertReadQuery('DESC users', 'mysql'), 'DESC users')
  assert.equal(assertReadQuery('DESCRIBE `create`', 'mysql'), 'DESCRIBE `create`')
  assert.equal(assertReadQuery('DESCRIBE SELECT 1', 'mysql'), 'DESCRIBE SELECT 1')
  assert.equal(assertReadQuery('DESC ANALYZE SELECT 1', 'mysql'), 'DESC ANALYZE SELECT 1')
  assert.equal(assertReadQuery('DESCRIBE ANALYZE SELECT 1', 'mysql'), 'DESCRIBE ANALYZE SELECT 1')
})

test('assertReadQuery 仍拦截注释拼接绕过、REPLACE DML 与危险 EXPLAIN ANALYZE', () => {
  assert.throws(() => assertReadQuery('WITH a AS (SELECT 1) DELETE/*x*/FROM items'), /DELETE/)
  assert.throws(() => assertReadQuery("SELECT * FROM t INTO/*x*/OUTFILE '/tmp/x'"), /INTO/)
  assert.throws(() => assertReadQuery('SELECT * FROM t FOR/*x*/UPDATE'), /FOR UPDATE/)
  assert.throws(() => assertReadQuery('(DELETE FROM users)'), /只接受只读语句/)
  assert.throws(() => assertReadQuery('(SELECT 1); DELETE FROM users'), /一次只允许一条语句/)
  assert.throws(() => assertReadQuery('(WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d)'), /DELETE/)

  assert.throws(() => assertReadQuery("REPLACE INTO users (id) VALUES (1)"), /只接受只读语句/)
  assert.throws(() => assertReadQuery('REPLACE users SET id = 1'), /只接受只读语句/)
  assert.throws(() => assertReadQuery('EXPLAIN REPLACE INTO users VALUES (1)'), /INTO|REPLACE/)
  assert.throws(() => assertReadQuery('EXPLAIN REPLACE users SET id = 1'), /REPLACE/)
  assert.throws(() => assertReadQuery('WITH a AS (SELECT 1) REPLACE users SET id = 1'), /REPLACE/)

  assert.throws(() => assertReadQuery('ANALYZE users', 'postgres'), /只接受只读语句/)
  assert.throws(() => assertReadQuery('SELECT ANALYZE FROM t', 'postgres'), /ANALYZE/)
  assert.throws(() => assertReadQuery('EXPLAIN ANALYZE DELETE FROM users', 'postgres'), /DELETE/)
  assert.throws(() => assertReadQuery('EXPLAIN (ANALYZE, BUFFERS) UPDATE users SET x = 1', 'postgres'), /UPDATE/)
  assert.throws(
    () => assertReadQuery('EXPLAIN (ANALYZE) WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d', 'postgres'),
    /DELETE/,
  )
  assert.throws(() => assertReadQuery('EXPLAIN ANALYZE SELECT * FROM users FOR UPDATE', 'postgres'), /FOR UPDATE/)
  assert.throws(() => assertReadQuery("EXPLAIN ANALYZE SELECT * FROM users INTO OUTFILE '/tmp/x'", 'mysql'), /INTO/)
  assert.throws(() => assertReadQuery('DESCRIBE DELETE FROM users', 'mysql'), /DELETE/)
  assert.throws(() => assertReadQuery('DESC DELETE FROM users', 'mysql'), /DELETE/)
  assert.throws(() => assertReadQuery('DESC ANALYZE DELETE FROM users', 'mysql'), /DELETE/)
  assert.throws(() => assertReadQuery('DESCRIBE ANALYZE UPDATE users SET x = 1', 'mysql'), /UPDATE/)
  assert.throws(() => assertReadQuery("DESCRIBE SELECT * FROM users INTO OUTFILE '/tmp/x'", 'mysql'), /INTO/)
  assert.throws(() => assertReadQuery('DESC ANALYZE SELECT * FROM users FOR UPDATE', 'mysql'), /FOR UPDATE/)
  assert.throws(() => assertReadQuery('DESCRIBE ANALYZE', 'mysql'), /ANALYZE/)
  assert.throws(() => assertReadQuery('EXPLAIN (ANALYZE)', 'postgres'), /ANALYZE/)
})

test('summarizeWriteScript 按引擎准确拆解多语句并保留约定摘要格式', () => {
  const pgEscape = summarizeWriteScript("E'a\\'b'; DROP TABLE users; SELECT E'c'", 'postgres')
  assert.match(pgEscape, /共 3 条语句：/)
  assert.match(pgEscape, /DROP TABLE users/)
  assert.match(pgEscape, /DROP×1/)

  const pgUnicode = summarizeWriteScript("SELECT U&'a\\' UESCAPE '!'; DROP TABLE users; SELECT 'ok'", 'postgres')
  assert.match(pgUnicode, /共 3 条语句：/)
  assert.match(pgUnicode, /DROP TABLE users/)
  assert.match(pgUnicode, /DROP×1/)

  const mysqlEscape = summarizeWriteScript("'a\\'b'; DROP TABLE users; SELECT 'c'", 'mysql')
  assert.match(mysqlEscape, /共 3 条语句：/)
  assert.match(mysqlEscape, /DROP TABLE users/)
  assert.match(mysqlEscape, /DROP×1/)

  const pgXor = summarizeWriteScript('UPDATE t SET m = m # 1; DROP TABLE users', 'postgres')
  assert.match(pgXor, /共 2 条语句：/)
  assert.match(pgXor, /UPDATE t SET m = m # 1/)
  assert.match(pgXor, /DROP TABLE users/)
  assert.match(pgXor, /语句类型：UPDATE×1，DROP×1/)
  assert.match(pgXor, /完整 SQL：UPDATE t SET m = m # 1; DROP TABLE users/)

  const longSql = "UPDATE t SET v = '" + 'x'.repeat(850) + "'; DROP TABLE users"
  const longSummary = summarizeWriteScript(longSql, 'sqlite')
  assert.match(longSummary, /共 2 条语句：/)
  assert.match(longSummary, /DROP TABLE users/)
  assert.match(longSummary, /完整 SQL 共 \d+ 个字符，见本次工具调用参数。/)

  const emptySummary = summarizeWriteScript('  -- only comment ')
  assert.match(emptySummary, /共 1 条语句：/)
  assert.match(emptySummary, /1\. \(空语句\)/)
})
