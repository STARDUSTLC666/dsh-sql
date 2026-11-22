/**
 * SQL 词法去噪、语句切分、只读断言与写脚本摘要。
 *
 * 按 SQLite / MySQL / PostgreSQL 三种引擎的真实词法规则扫描注释、字符串、
 * 引号标识符与分号分隔符，避免注释拼接绕过或引号转义错位隐藏后续语句。
 *
 * @module dsh-sql/sql-lexer
 */

/** 词法校验需要区分的三种引擎。 */
export type SqlEngine = 'sqlite' | 'mysql' | 'postgres'

interface ScanOptions {
  /**
   * MySQL 默认模式（未启用 ANSI_QUOTES）下双引号字符串内 `\"` 是转义；
   * 设为 false 时按 ANSI_QUOTES 语义处理，双引号内的反斜杠按字面量对待。
   */
  mysqlDoubleQuoteBackslash?: boolean
}

interface ScanResult {
  stripped: string
  statements: string[]
}

/** 只读语句关键字白名单。 */
const READ_KEYWORDS = /^(select|pragma|explain|show|describe|desc|with)\b/i

/** 允许外层带括号的只读查询关键字（如 `(SELECT 1) UNION (SELECT 2)`）。 */
const PAREN_READ_KEYWORDS = /^(select|with)\b/i

/**
 * 写操作关键字：出在 SELECT/EXPLAIN/WITH 语句里即拒绝。
 *
 * `replace(?!\s*\()` 放行字符串函数 `REPLACE(a, b, c)`，
 * 仍拦截 `REPLACE INTO ...` / `REPLACE tbl SET ...` 等写语句。
 */
const WRITE_KEYWORDS = /\b(?:insert|update|delete|replace(?!\s*\()|merge|drop|alter|create|truncate|call|execute|copy|grant|revoke|attach|detach|vacuum|reindex|refresh|set|reset|begin|commit|rollback|savepoint|release|analyze|load_extension)\b/i

/** PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, ...)` 选项列表语法。 */
const EXPLAIN_OPTION_LIST = /^(explain\s*\()(\s*[a-z_]+(?:\s+(?:on|off|true|false|text|xml|json|yaml|none|binary|1|0))?(?:\s*,\s*[a-z_]+(?:\s+(?:on|off|true|false|text|xml|json|yaml|none|binary|1|0))?)*\s*)(\))(?=\s*\S)/i

/** 允许不带参数的只读 PRAGMA（含查询型与会话状态查询）。 */
const READONLY_PRAGMAS = new Set([
  'application_id',
  'auto_vacuum',
  'cell_size_check',
  'collation_list',
  'compile_options',
  'data_version',
  'database_list',
  'encoding',
  'freelist_count',
  'function_list',
  'journal_mode',
  'legacy_file_format',
  'mmap_size',
  'module_list',
  'page_count',
  'page_size',
  'pragma_list',
  'schema_version',
  'sqlite_version',
  'user_version',
])

/** 允许带一个标识符参数的只读内省 PRAGMA。 */
const READONLY_PRAGMAS_WITH_ARG = new Set([
  'foreign_key_check',
  'foreign_key_list',
  'index_info',
  'index_list',
  'index_xinfo',
  'integrity_check',
  'quick_check',
  'table_info',
  'table_list',
  'table_xinfo',
])

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
}

/**
 * PostgreSQL 只有 `E'…'` / `e'…'` 会把反斜杠当单引号转义；普通 `'…'` 与
 * `U&'…'`（Unicode 逃逸串只认 `''` 转义单引号，且 `UESCAPE '!'` 可使字面量 `\` 合法）
 * 都绝不把 `\'` 当转义引号。
 */
function isPostgresEscapeString(sql: string, quoteIndex: number): boolean {
  const prev = sql[quoteIndex - 1]
  return (prev === 'E' || prev === 'e') && !isWordChar(sql[quoteIndex - 2])
}

/**
 * MySQL 要求 `--` 后紧跟空白、控制字符或输入结束才构成行注释，
 * 否则 `--1` 会被解析为双负号运算。
 */
function isMysqlDashComment(sql: string, dashIndex: number): boolean {
  const after = dashIndex + 2
  if (after >= sql.length) return true
  const code = sql.charCodeAt(after)
  return code <= 0x20 || code === 0x7f
}

/** 匹配 PostgreSQL 的 `$$` 或 `$tag$` dollar-quote 起始标签。 */
function matchDollarTag(sql: string, start: number): string | undefined {
  if (isWordChar(sql[start - 1])) return undefined
  if (sql[start + 1] === '$') return '$$'
  const first = sql[start + 1]
  if (first === undefined || !/[A-Za-z_]/.test(first)) return undefined
  let j = start + 2
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1
  if (sql[j] === '$') return sql.slice(start, j + 1)
  return undefined
}

/**
 * 方言感知的单遍词法扫描：同时产出「去噪 SQL」与「顶层分号切分的原始语句数组」。
 *
 * 规则要点：
 * - 任何被剥离的注释、字符串、标识符都至少输出一个空格（或保留换行），绝不拼接相邻 token。
 * - MySQL / 未指定引擎时，条件注释（`/*!50000 ...`）仅剥离定界符，保留其中可执行 SQL。
 * - PostgreSQL 支持嵌套块注释，按深度配对起止定界符。
 * - `#` 仅在 MySQL 下视作行注释，PostgreSQL / SQLite / 未指定引擎保留 `#`（如 PG `#` / `#>` / `#>>` / `#-`）。
 * - 单引号始终支持 `''` 转义；反斜杠仅在 MySQL 或 PostgreSQL `E'…'` / `e'…'` 中转义。
 * - 双引号始终支持 `""` 转义；MySQL 可按 `mysqlDoubleQuoteBackslash` 切换默认/ANSI_QUOTES 语义。
 * - 反引号支持双反引号 `` `` `` 转义，绝不认反斜杠转义。
 * - 方括号 `[...]` 仅在 SQLite / 未指定引擎下视作引号标识符；PG / MySQL 保留为普通字符。
 * - Dollar-quote `$tag$...$tag$` 仅在 PostgreSQL / 未指定引擎下生效。
 */
function scanSql(sql: string, engine?: SqlEngine, options?: ScanOptions): ScanResult {
  const mysqlDoubleQuoteBackslash = options?.mysqlDoubleQuoteBackslash ?? true
  const supportsMysqlConditional = engine === 'mysql' || engine === undefined
  const supportsNestedBlockComment = engine === 'postgres'
  const supportsHashComment = engine === 'mysql'
  const supportsBracketIdent = engine === 'sqlite' || engine === undefined
  const supportsDollarQuote = engine === 'postgres' || engine === undefined

  let out = ''
  const statements: string[] = []
  let stmtStart = 0
  let segmentHasToken = false
  let mysqlConditionalDepth = 0
  let i = 0

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (ch === '-' && next === '-' && (engine !== 'mysql' || isMysqlDashComment(sql, i))) {
      i += 2
      while (i < sql.length && sql[i] !== '\n') i += 1
      if (i < sql.length && sql[i] === '\n') {
        out += '\n'
        i += 1
      } else {
        out += ' '
      }
      continue
    }

    if (supportsHashComment && ch === '#') {
      i += 1
      while (i < sql.length && sql[i] !== '\n') i += 1
      if (i < sql.length && sql[i] === '\n') {
        out += '\n'
        i += 1
      } else {
        out += ' '
      }
      continue
    }

    if (ch === '/' && next === '*') {
      if (supportsMysqlConditional && sql[i + 2] === '!') {
        mysqlConditionalDepth += 1
        i += 3
        while (i < sql.length && sql[i] >= '0' && sql[i] <= '9') i += 1
        out += ' '
        continue
      }
      if (supportsNestedBlockComment) {
        let depth = 1
        i += 2
        while (i < sql.length && depth > 0) {
          if (sql[i] === '/' && sql[i + 1] === '*') {
            depth += 1
            i += 2
          } else if (sql[i] === '*' && sql[i + 1] === '/') {
            depth -= 1
            i += 2
          } else {
            i += 1
          }
        }
        out += ' '
        continue
      }
      i += 2
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2
          break
        }
        i += 1
      }
      out += ' '
      continue
    }

    if (mysqlConditionalDepth > 0 && ch === '*' && next === '/') {
      mysqlConditionalDepth -= 1
      i += 2
      out += ' '
      continue
    }

    if (ch === "'") {
      segmentHasToken = true
      out += ' '
      const backslashEscapes = engine === 'mysql' || (engine === 'postgres' && isPostgresEscapeString(sql, i))
      i += 1
      while (i < sql.length) {
        if (backslashEscapes && sql[i] === '\\') {
          i += 2
          continue
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2
          continue
        }
        if (sql[i] === "'") {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    if (ch === '"') {
      segmentHasToken = true
      out += ' '
      const backslashEscapes = engine === 'mysql' && mysqlDoubleQuoteBackslash
      i += 1
      while (i < sql.length) {
        if (backslashEscapes && sql[i] === '\\') {
          i += 2
          continue
        }
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2
          continue
        }
        if (sql[i] === '"') {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    if (ch === '`') {
      segmentHasToken = true
      out += ' '
      i += 1
      while (i < sql.length) {
        if (sql[i] === '`' && sql[i + 1] === '`') {
          i += 2
          continue
        }
        if (sql[i] === '`') {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    if (supportsBracketIdent && ch === '[') {
      segmentHasToken = true
      out += ' '
      i += 1
      while (i < sql.length && sql[i] !== ']') i += 1
      if (i < sql.length) i += 1
      continue
    }

    if (supportsDollarQuote && ch === '$') {
      const tag = matchDollarTag(sql, i)
      if (tag !== undefined) {
        segmentHasToken = true
        out += ' '
        i += tag.length
        const end = sql.indexOf(tag, i)
        i = end === -1 ? sql.length : end + tag.length
        continue
      }
    }

    if (ch === ';') {
      if (segmentHasToken) {
        const piece = sql.slice(stmtStart, i).trim()
        if (piece !== '') statements.push(piece)
      }
      stmtStart = i + 1
      segmentHasToken = false
      out += ch
      i += 1
      continue
    }

    if (!/\s/.test(ch)) segmentHasToken = true
    out += ch
    i += 1
  }

  if (segmentHasToken) {
    const piece = sql.slice(stmtStart).trim()
    if (piece !== '') statements.push(piece)
  }

  return { stripped: out, statements }
}

/**
 * 去掉字符串、引号标识符与注释，保留真实 SQL 关键字与分号。
 * 被剥离的片段始终用空白占位，避免相邻 token 粘连。
 */
export function stripSqlNoise(sql: string, engine?: SqlEngine): string {
  return scanSql(sql, engine).stripped
}

/**
 * 按引擎词法在顶层分号处切分 SQL 脚本，返回去首尾空白的原始语句列表
 * （自动跳过空段与纯注释段）。
 */
export function splitSqlStatements(sql: string, engine?: SqlEngine): string[] {
  return scanSql(sql, engine).statements
}

/**
 * PRAGMA 白名单：只放行只读内省。
 *
 * SQLite 里 `PRAGMA name(value)` 与 `PRAGMA name = value` 完全等价，
 * 只拦等号会让 `PRAGMA foreign_keys(0)` / `PRAGMA writable_schema(1)`
 * 这类会改连接或库文件状态的调用漏过去，所以按名字白名单放行。
 */
function assertReadOnlyPragma(statement: string): void {
  const match = /^pragma\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*(.*)$/i.exec(statement)
  if (match === null) throw new Error('无法解析这条 PRAGMA，sql_query 只接受只读的 PRAGMA 内省语句。')
  const pragmaName = match[1].toLowerCase()
  const rest = match[2].trim()
  if (rest !== '' && /^[=(]/.test(rest)) {
    if (!READONLY_PRAGMAS_WITH_ARG.has(pragmaName)) {
      throw new Error('sql_query 不接受带参数的 PRAGMA ' + pragmaName.toUpperCase() + '（PRAGMA name(value) 与 name=value 等价，会改连接或数据库状态）。请用 sql_exec。')
    }
    return
  }
  if (!READONLY_PRAGMAS.has(pragmaName) && !READONLY_PRAGMAS_WITH_ARG.has(pragmaName)) {
    throw new Error('sql_query 只放行只读 PRAGMA 白名单（table_info / index_list / page_count / user_version 等），' + pragmaName.toUpperCase() + ' 不在白名单内。需要修改请用 sql_exec。')
  }
}

/**
 * 仅剥离 `EXPLAIN/DESCRIBE/DESC ANALYZE ...` 与 `EXPLAIN (ANALYZE, BUFFERS) ...` 头部的 `ANALYZE` 选项，
 * 保留被解释的语句体与其他位置的 `ANALYZE`，确保 `EXPLAIN/DESC ANALYZE DELETE ...`
 * 与独立 `ANALYZE` 仍会被拦下。
 */
function normalizeExplainHeader(statement: string): string {
  const withOptions = EXPLAIN_OPTION_LIST.exec(statement)
  if (withOptions !== null) {
    const cleanedOptions = withOptions[2].replace(/\banalyze\b/gi, ' ')
    return withOptions[1] + cleanedOptions + withOptions[3] + statement.slice(withOptions[0].length)
  }
  return statement.replace(/^((?:explain|describe|desc)\s+)analyze(?=\s+\S)/i, '$1 ')
}

function validateReadQueryPass(trimmed: string, engine?: SqlEngine, options?: ScanOptions): void {
  const scan = scanSql(trimmed, engine, options)
  const cleanTrimmed = scan.stripped.trim()
  const leadingParens = cleanTrimmed.startsWith('(')
  const head = leadingParens ? cleanTrimmed.replace(/^(?:\(\s*)+/, '') : cleanTrimmed
  const allowedHead = leadingParens ? PAREN_READ_KEYWORDS.test(head) : READ_KEYWORDS.test(head)
  if (!allowedHead) {
    throw new Error('sql_query 只接受只读语句（SELECT / PRAGMA / EXPLAIN / SHOW / DESCRIBE / WITH）。写操作请用 sql_exec。')
  }
  if (scan.statements.length > 1) {
    throw new Error('sql_query 一次只允许一条语句。')
  }
  const single = scan.stripped.split(';').map((part) => part.trim()).find((part) => part !== '') ?? ''
  const first = /^[a-z]+/i.exec(head)?.[0]?.toLowerCase() ?? ''
  if (first === 'pragma') {
    assertReadOnlyPragma(single)
  } else if (first === 'show') {
    // SHOW 本身只读，不再扫写关键字（避免误伤 SHOW CREATE TABLE）。
  } else {
    const target = first === 'explain' || first === 'describe' || first === 'desc'
      ? normalizeExplainHeader(single)
      : single
    if (/\binto\b/i.test(target)) throw new Error('sql_query 不接受 SELECT INTO（写表或 OUTFILE），请用 sql_exec。')
    if (/\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b|\block\s+in\s+share\s+mode\b/i.test(target)) {
      throw new Error('sql_query 不接受 FOR UPDATE/FOR SHARE 行锁查询，请用 sql_exec。')
    }
    const hit = WRITE_KEYWORDS.exec(target)
    if (hit !== null) {
      throw new Error('检测到写操作关键字 ' + hit[0].toUpperCase() + '，sql_query 只接受只读查询。写操作请用 sql_exec。')
    }
  }
}

/**
 * 校验只读查询：词法去噪后白名单开头 + 写关键字扫描 + 单语句 + PRAGMA 白名单。
 *
 * `engine` 决定反斜杠、注释与引号的方言规则；不传时按最保守的语义校验。
 * 在 MySQL 引擎下，由于无法预知会话是否启用了 `ANSI_QUOTES`，含 `\"` 的双引号片段会同时在
 * 两种模式下校验，任一模式检出多语句或写关键字即拒绝。
 */
export function assertReadQuery(sql: string, engine?: SqlEngine): string {
  const trimmed = sql.trim()
  if (engine === 'mysql') {
    validateReadQueryPass(trimmed, engine, { mysqlDoubleQuoteBackslash: false })
    if (trimmed.includes('"') && trimmed.includes('\\')) {
      validateReadQueryPass(trimmed, engine, { mysqlDoubleQuoteBackslash: true })
    }
  } else {
    validateReadQueryPass(trimmed, engine)
  }
  return trimmed.replace(/;+\s*$/, '').trim()
}

/**
 * 把一段写操作脚本压成审批卡可读的摘要。
 *
 * 关键点：按方言切分后逐条列出每条语句，并额外给一行语句类型统计。即使脚本体被省略，
 * 第二条、第 N 条语句的 DROP / DELETE 也不会从审批文本里消失。
 */
export function summarizeWriteScript(sql: string, engine?: SqlEngine): string {
  const trimmed = sql.trim()
  const statements = splitSqlStatements(trimmed, engine)
    .map((statement) => {
      const cleaned = stripSqlNoise(statement, engine).replace(/\s+/g, ' ').trim()
      return cleaned !== '' ? cleaned : statement.replace(/\s+/g, ' ').trim()
    })
    .filter((part) => part !== '')
  const effective = statements.length === 0 ? ['(空语句)'] : statements
  const tally = new Map<string, number>()
  for (const statement of effective) {
    const keyword = /^[(\s]*([a-z]+)/i.exec(statement)?.[1]?.toUpperCase() ?? '?'
    tally.set(keyword, (tally.get(keyword) ?? 0) + 1)
  }
  const lines = ['共 ' + effective.length + ' 条语句：']
  effective.slice(0, 100).forEach((statement, index) => {
    lines.push('  ' + (index + 1) + '. ' + (statement.length > 120 ? statement.slice(0, 120) + '…' : statement))
  })
  if (effective.length > 100) lines.push('  …另有 ' + (effective.length - 100) + ' 条语句')
  lines.push('语句类型：' + [...tally.entries()].map(([keyword, count]) => keyword + '×' + count).join('，'))
  if (trimmed.length <= 800) {
    lines.push('', '完整 SQL：' + trimmed)
  } else {
    lines.push('', '完整 SQL 共 ' + trimmed.length + ' 个字符，见本次工具调用参数。')
  }
  return lines.join('\n')
}
