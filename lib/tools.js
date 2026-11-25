/**
 * 六个面向模型的数据库工具：sql_list / sql_query / sql_exec / sql_schema / sql_stats / sql_health。
 *
 * @module dsh-sql/tools
 */
import { performance } from 'node:perf_hooks';
import { createAdapter } from './adapters.js';
import { matchRedactedColumns, parseTableRef } from './config.js';
import { assertReadQuery } from './sql-lexer.js';
export { analyzeWriteRisks, assertReadQuery, isCursorEligibleQuery, summarizeWriteScript, splitSqlStatements, stripSqlNoise, } from './sql-lexer.js';
function compileParameters(spec) {
    const properties = {};
    const required = [];
    for (const [key, prop] of Object.entries(spec)) {
        if (prop?.required === true)
            required.push(key);
        const node = {};
        if (typeof prop?.type === 'string')
            node.type = prop.type;
        if (typeof prop?.description === 'string')
            node.description = prop.description;
        if (Array.isArray(prop?.enum))
            node.enum = prop.enum;
        if (prop?.items !== undefined && typeof prop.items === 'object' && prop.items !== null && !Array.isArray(prop.items))
            node.items = prop.items;
        // 宿主 @deepseek-ai/dsh-tools 仅支持受限 JSON Schema 子集，不输出 minimum / maximum 等关键字（运行时由参数校验器强制范围）。
        properties[key] = node;
    }
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}
function asRecord(value) {
    return typeof value === 'object' && value !== null ? value : {};
}
function optionalString(args, key) {
    const value = args[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
function requiredString(args, key, label) {
    const value = optionalString(args, key);
    if (value === undefined)
        throw new Error(label + '（参数 ' + key + '）为必填，请提供非空字符串。');
    return value;
}
function optionalPositiveInteger(args, key) {
    const value = args[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error('参数 ' + key + ' 必须是大于等于 1 的整数。');
    }
    return value;
}
function optionalParams(args) {
    const value = args.params;
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value)) {
        throw new Error('参数 params 必须是数组（SQLite/MySQL 按 ? 顺序绑定，PostgreSQL 按 $1/$2 顺序绑定）。');
    }
    return value;
}
const MAX_SCHEMA_BATCH_TABLES = 20;
function optionalTableList(args) {
    const value = args.tables;
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value)) {
        throw new Error('参数 tables 必须是非空字符串数组（1–' + MAX_SCHEMA_BATCH_TABLES + ' 张表）。');
    }
    if (value.length === 0) {
        throw new Error('参数 tables 不能为空数组，请至少提供 1 张表名（最多 ' + MAX_SCHEMA_BATCH_TABLES + ' 张）。');
    }
    if (value.length > MAX_SCHEMA_BATCH_TABLES) {
        throw new Error('参数 tables 最多支持批量查看 ' + MAX_SCHEMA_BATCH_TABLES + ' 张表，当前传入 ' + value.length + ' 张，请分批查询。');
    }
    const tables = [];
    for (const item of value) {
        if (typeof item !== 'string' || item.trim() === '') {
            throw new Error('参数 tables 的每一项都必须是非空表名字符串。');
        }
        tables.push(item.trim());
    }
    return tables;
}
function parseQueryFormat(args) {
    const raw = args.format;
    if (raw === undefined || raw === null)
        return 'table';
    if (typeof raw !== 'string') {
        throw new Error('不支持的 format：' + String(raw) + '，可选 table / markdown / csv / json。');
    }
    const trimmed = raw.trim();
    if (trimmed === '')
        return 'table';
    const lower = trimmed.toLowerCase();
    if (lower === 'table' || lower === 'markdown' || lower === 'csv' || lower === 'json')
        return lower;
    throw new Error('不支持的 format：' + trimmed + '，可选 table / markdown / csv / json。');
}
function executionSignal(exec) {
    if (typeof exec !== 'object' || exec === null)
        return undefined;
    const signal = exec.signal;
    return signal instanceof AbortSignal ? signal : undefined;
}
/** 创建可及时清理的超时作用域（兼容 Node 22/24 事件循环保活并避免残留定时器）。 */
function createTimeoutScope(signal, timeoutMs) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const onOuterAbort = () => {
        controller.abort(signal.reason);
    };
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    const timer = setTimeout(() => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        controller.abort(err);
    }, Math.max(1, timeoutMs));
    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onOuterAbort);
        },
    };
}
/**
 * 把驱动/连接的原始错误映射成一行可执行的「下一步」。
 *
 * 之前 sql_list / sql_health / sql_query 直接把驱动原文（ECONNREFUSED、
 * ER_ACCESS_DENIED_ERROR、SQLITE_CANTOPEN…）交给用户，知道怎么修的人能看懂，
 * 不知道的人只能反复重试。这里只补一行提示，原始错误文本一律保留。
 */
export function connectionErrorHint(message) {
    if (/ECONNREFUSED/i.test(message))
        return '目标地址拒绝连接：请确认数据库服务已启动、host 与 port 正确，并检查防火墙是否放行。';
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message))
        return '主机名解析失败：请检查连接配置里的 host 拼写，以及本机 DNS/网络是否可用。';
    if (/ETIMEDOUT|timed out|timeout exceeded|connection timeout|due to timeout|statement timeout|TimeoutError/i.test(message))
        return '连接或查询超时：请确认网络可达与服务器负载，必要时调大 queryTimeoutMs / execTimeoutMs 后重试。';
    if (/(?:^|[^a-z])(?:ssl|tls)|self-signed|certificate|no encryption|insecure transport/i.test(message))
        return 'TLS/SSL 握手或加密校验失败：请在连接配置中检查 ssl 选项（云数据库通常用 ssl: "require" 或 "verify-full"，自签名证书可配置 { rejectUnauthorized: false } 或提供 ca 证书；仅本地可信网络可设为 "disable"）。';
    if (/password authentication failed|Access denied for user|authentication failed/i.test(message))
        return '认证失败：请在 DSH「设置 → 插件 → 数据库（dsh-sql）」核对 user 与 password（保存即生效），或改用环境变量 DSH_SQL_PASSWORD_<连接名大写> 提供密码，避免明文写进配置。';
    if (/Unknown database|ER_BAD_DB_ERROR|database .* does not exist|\b3D000\b/i.test(message))
        return '数据库不存在：请核对连接配置里的 database，或先在服务器上创建该库。';
    if (/no such table|SQLITE_ERROR: no such table|relation .* does not exist|\b42P01\b/i.test(message))
        return '表不存在：先用 sql_schema（不带 table）查看该连接的表清单，注意大小写与实际 schema。';
    if (/SQLITE_CANTOPEN|unable to open database file|EACCES|EPERM|readonly database/i.test(message))
        return 'SQLite 文件无法打开或没有权限：请检查文件路径是否存在、所在目录可写、进程账号有读写权限。';
    if (/ECONNRESET|EPIPE|Connection terminated|server closed the connection/i.test(message))
        return '连接被对端关闭：可能是服务器重启或中间代理断开，请重试一次；持续出现时检查连接池与代理设置。';
    if (/no pg_hba\.conf entry|unsupported startup parameter|\b28000\b/i.test(message))
        return '服务器拒绝本次连接：请核对 pg_hba.conf 与账号来源限制，确认该主机与该用户被允许登录。';
    return undefined;
}
/** 给错误补一行「下一步」；无法识别时原样返回，避免把断言类错误改写成连接问题。 */
export function annotateError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = connectionErrorHint(message);
    if (hint === undefined || message.includes('下一步：'))
        return error instanceof Error ? error : new Error(message);
    return new Error(message + '\n下一步：' + hint);
}
const querySchema = {
    type: 'object',
    properties: {
        connection: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array', items: {} } },
        rowCount: { type: 'integer' },
        truncated: { type: 'boolean' },
        maxRows: { type: 'integer' },
        durationMs: { type: 'integer' },
        redactedColumns: { type: 'array', items: { type: 'string' } },
        format: { type: 'string' },
        formatted: { type: 'string' },
    },
    additionalProperties: true,
};
const execSchema = {
    type: 'object',
    properties: {
        connection: { type: 'string' },
        changes: { type: 'integer' },
        readOnly: { type: 'boolean' },
        durationMs: { type: 'integer' },
    },
    additionalProperties: true,
};
const listSchema = {
    type: 'object',
    properties: {
        connections: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    engine: { type: 'string' },
                    host: { type: 'string' },
                    port: { type: 'integer' },
                    database: { type: 'string' },
                    file: { type: 'string' },
                    readOnly: { type: 'boolean' },
                    ssl: { type: 'boolean' },
                    ok: { type: 'boolean' },
                    error: { type: 'string' },
                },
                additionalProperties: true,
            },
        },
    },
    additionalProperties: true,
};
const schemaColumnItemSchema = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        notNull: { type: 'boolean' },
        primaryKey: { type: 'boolean' },
        defaultValue: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        comment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        enumValues: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: true,
};
const schemaIndexItemSchema = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        unique: { type: 'boolean' },
        columns: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: true,
};
const schemaForeignKeyItemSchema = {
    type: 'object',
    properties: {
        column: { type: 'string' },
        refTable: { type: 'string' },
        refColumn: { type: 'string' },
    },
    additionalProperties: true,
};
const schemaToolSchema = {
    type: 'object',
    properties: {
        connection: { type: 'string' },
        table: { type: 'string' },
        schema: { type: 'string' },
        comment: { type: 'string' },
        tables: { type: 'array', items: { type: 'string' } },
        columns: {
            type: 'array',
            items: schemaColumnItemSchema,
        },
        indexes: {
            type: 'array',
            items: schemaIndexItemSchema,
        },
        foreignKeys: {
            type: 'array',
            items: schemaForeignKeyItemSchema,
        },
        tableDetails: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    table: { type: 'string' },
                    schema: { type: 'string' },
                    comment: { type: 'string' },
                    columns: { type: 'array', items: schemaColumnItemSchema },
                    indexes: { type: 'array', items: schemaIndexItemSchema },
                    foreignKeys: { type: 'array', items: schemaForeignKeyItemSchema },
                    error: { type: 'string' },
                },
                additionalProperties: true,
            },
        },
    },
    additionalProperties: true,
};
// ---------- 输出格式与统计辅助 ----------
/** 按引擎给标识符加引号，防止表名破坏 SQL。 */
function quoteIdent(engine, name) {
    if (engine === 'mysql')
        return '`' + name.replace(/`/g, '``') + '`';
    return '"' + name.replace(/"/g, '""') + '"';
}
function safeToString(value) {
    try {
        return String(value);
    }
    catch {
        return Object.prototype.toString.call(value);
    }
}
/** 格式化单个表格单元格：处理 null、对象/数组 JSON 序列化、单行化与超长截断。 */
function formatCell(cell, maxCellLen = 300) {
    if (cell === null || cell === undefined)
        return 'NULL';
    let text;
    if (Array.isArray(cell) || typeof cell === 'object') {
        try {
            const json = JSON.stringify(cell);
            text = json !== undefined ? json : safeToString(cell);
        }
        catch {
            text = safeToString(cell);
        }
    }
    else {
        text = safeToString(cell);
    }
    text = text.replace(/\r\n|\r|\n/g, '\\n');
    if (text.length > maxCellLen) {
        return text.slice(0, maxCellLen) + '…(已截断)';
    }
    return text;
}
/** 表名过滤：无 `*` 时按不区分大小写子串过滤，含 `*` 时按通配符匹配。 */
function filterTablesByPattern(tables, pattern) {
    if (pattern === undefined)
        return tables;
    if (!pattern.includes('*')) {
        const needle = pattern.toLowerCase();
        return tables.filter((table) => table.toLowerCase().includes(needle));
    }
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp('^' + escaped + '$', 'i');
    const hasDot = pattern.includes('.');
    return tables.filter((table) => {
        if (regex.test(table))
            return true;
        if (!hasDot) {
            const dot = table.indexOf('.');
            if (dot !== -1 && regex.test(table.slice(dot + 1)))
                return true;
        }
        return false;
    });
}
function quoteDoubleIdent(name) {
    return '"' + name.replace(/"/g, '""') + '"';
}
/** 校验单段 schema 名称（拒绝多段路径与非法字符），返回去引号后的名称。 */
function parseSingleSchema(schemaName) {
    const ref = parseTableRef(schemaName, 'schema');
    if (ref.schema !== undefined) {
        throw new Error('schema 非法（不能包含多段路径）：' + schemaName);
    }
    return ref.table;
}
/**
 * 校验并拼接 table 与可选 schema：
 * - 先用 parseTableRef 校验 table 与 schema（拒绝多段 schema 或非法字符）；
 * - 仅当 table 自身不含 schema 段时，安全加引号拼接为 `"schema"."table"`，
 *   支持含点号的引号表名（如 `"my.table"`）与已加引号的 schema（如 `"analytics"`）。
 */
function qualifyTableRef(table, schemaName) {
    const tableRef = parseTableRef(table, '表名');
    if (schemaName === undefined)
        return table;
    const parsedSchema = parseSingleSchema(schemaName);
    if (tableRef.schema !== undefined)
        return table;
    return quoteDoubleIdent(parsedSchema) + '.' + quoteDoubleIdent(tableRef.table);
}
/** 格式化 Markdown 表格单元格：在 formatCell 基础上转义管道符 `|`。 */
function formatMarkdownCell(cell, maxCellLen = 300) {
    return formatCell(cell, maxCellLen).replace(/\|/g, '\\|');
}
/** 查询结果转 GitHub 风格 Markdown 表格。 */
export function toMarkdownTable(columns, rows, maxCellLen = 300) {
    if (columns.length === 0)
        return '';
    const headerLine = '| ' + columns.map((col) => formatMarkdownCell(col, maxCellLen)).join(' | ') + ' |';
    const sepLine = '| ' + columns.map(() => '---').join(' | ') + ' |';
    const lines = [headerLine, sepLine];
    for (const row of rows) {
        const cells = columns.map((_, i) => formatMarkdownCell(Array.isArray(row) ? row[i] : undefined, maxCellLen));
        lines.push('| ' + cells.join(' | ') + ' |');
    }
    return lines.join('\n');
}
/** 格式化 sql_schema 的单列描述（含主键/非空/默认值/枚举值/注释）。 */
function formatSchemaColumnLine(item) {
    const c = asRecord(item);
    const attrs = [];
    if (c.primaryKey === true)
        attrs.push('主键');
    if (c.notNull === true)
        attrs.push('非空');
    if (c.defaultValue !== undefined && c.defaultValue !== null && String(c.defaultValue) !== '') {
        attrs.push('默认: ' + String(c.defaultValue));
    }
    const attrText = attrs.length > 0 ? '（' + attrs.join('，') + '）' : '';
    const enumValues = Array.isArray(c.enumValues) ? c.enumValues.map(String) : [];
    const enumText = enumValues.length > 0
        ? '（枚举：' + enumValues.slice(0, 12).join(', ') + (enumValues.length > 12 ? ', …' : '') + '）'
        : '';
    const colComment = typeof c.comment === 'string' && c.comment.trim() !== '' ? ' — ' + c.comment.trim() : '';
    return '- ' + c.name + ' ' + c.type + attrText + enumText + colComment;
}
/** 查询结果转 CSV 文本（RFC 4180 风格转义）。 */
export function toCsv(columns, rows) {
    const escape = (cell) => {
        if (cell === null || cell === undefined)
            return '';
        let text;
        if (Array.isArray(cell) || typeof cell === 'object') {
            try {
                const json = JSON.stringify(cell);
                text = json !== undefined ? json : safeToString(cell);
            }
            catch {
                text = safeToString(cell);
            }
        }
        else {
            text = safeToString(cell);
        }
        return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const lines = [columns.map(escape).join(',')];
    for (const row of rows)
        lines.push(row.map(escape).join(','));
    return lines.join('\n');
}
/** 人类可读的字节数。 */
function formatBytes(bytes) {
    if (bytes < 1024)
        return bytes + ' B';
    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024)
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
/** 库体积：SQLite 用页数×页大小；MySQL/PostgreSQL 走系统函数；失败抛错由调用方兜底。 */
async function databaseSize(adapter, engine, signal, timeoutMs) {
    const options = timeoutMs !== undefined ? { timeoutMs } : undefined;
    if (engine === 'sqlite') {
        const pageCount = await adapter.query('PRAGMA page_count', 1, signal, options);
        const pageSize = await adapter.query('PRAGMA page_size', 1, signal, options);
        return Number(pageCount.rows[0]?.[0] ?? 0) * Number(pageSize.rows[0]?.[0] ?? 0);
    }
    if (engine === 'mysql') {
        const result = await adapter.query('SELECT SUM(DATA_LENGTH + INDEX_LENGTH) FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()', 1, signal, options);
        return Number(result.rows[0]?.[0] ?? -1);
    }
    const result = await adapter.query('SELECT pg_database_size(current_database())', 1, signal, options);
    return Number(result.rows[0]?.[0] ?? -1);
}
const statsSchema = {
    type: 'object',
    properties: {
        connection: { type: 'string' },
        engine: { type: 'string' },
        tableCount: { type: 'integer' },
        tables: { type: 'array', items: { type: 'object', additionalProperties: true } },
        sizeBytes: { type: 'integer' },
    },
    additionalProperties: true,
};
const healthSchema = {
    type: 'object',
    properties: {
        ok: { type: 'boolean' },
        plugin: { type: 'string' },
        connections: { type: 'array', items: { type: 'object', additionalProperties: true } },
        readOnly: { type: 'boolean' },
        writeApproval: { type: 'boolean' },
        redactColumns: { type: 'boolean' },
        redactPatternCount: { type: 'integer' },
        maxRows: { type: 'integer' },
        queryTimeoutMs: { type: 'integer' },
        execTimeoutMs: { type: 'integer' },
    },
    additionalProperties: true,
};
const MAX_TABLE_RENDER_CHARS = 8000;
/** 构建六个工具定义；adapters 惰性创建并按小写连接名缓存，支持静态配置或活引用 getter。 */
export function buildSqlTools(config, policyOf = () => 'unknown') {
    const getCfg = typeof config === 'function' ? config : () => config;
    const adapters = new Map();
    const adapterFingerprints = new Map();
    const adapterFingerprint = (cfg, connection) => {
        const effectiveReadOnly = cfg.readOnly || connection.readOnly === true;
        return JSON.stringify({ connection, effectiveReadOnly });
    };
    /**
     * 同步适配器缓存：清理配置中已移除/改名，或连接参数/生效 readOnly 发生变更的旧连接池，
     * 防止热更新后连接池或文件句柄泄漏。
     */
    const syncAdapters = (cfg) => {
        const active = new Map();
        for (const connection of cfg.connections) {
            active.set(connection.name.toLowerCase(), adapterFingerprint(cfg, connection));
        }
        for (const [key, adapter] of [...adapters.entries()]) {
            const nextFp = active.get(key);
            const prevFp = adapterFingerprints.get(key);
            if (nextFp === undefined || (prevFp !== undefined && prevFp !== nextFp)) {
                adapters.delete(key);
                adapterFingerprints.delete(key);
                void adapter.close().catch(() => { });
            }
        }
    };
    const findConnectionIn = (cfg, name) => {
        const target = name ?? cfg.connections[0].name;
        const connection = cfg.connections.find((item) => item.name.toLowerCase() === target.toLowerCase());
        if (connection === undefined) {
            throw new Error('未找到名为 ' + target + ' 的数据库连接。可用 sql_list 查看现有连接清单，或在 DSH「设置 → 插件 → 数据库（dsh-sql）」/ cordis.patch.yml 中添加该连接。');
        }
        return connection;
    };
    /** 只解析连接配置（不建连接），用于在打开数据库前挑选词法规则。 */
    const findConnection = (name) => {
        const cfg = getCfg();
        const connection = findConnectionIn(cfg, name);
        return { cfg, connection };
    };
    const getAdapterFor = (cfg, connection) => {
        syncAdapters(cfg);
        const key = connection.name.toLowerCase();
        const effectiveReadOnly = cfg.readOnly || connection.readOnly === true;
        const fp = adapterFingerprint(cfg, connection);
        let adapter = adapters.get(key);
        if (adapter === undefined) {
            adapter = createAdapter(connection, { readOnly: effectiveReadOnly });
            adapters.set(key, adapter);
            adapterFingerprints.set(key, fp);
        }
        return adapter;
    };
    const getAdapter = (name) => {
        const { cfg, connection } = findConnection(name);
        const adapter = getAdapterFor(cfg, connection);
        return { adapter, name: connection.name, cfg, connection };
    };
    /** 保留写入结果不确定的提示；普通取消原样抛出，其余错误补「下一步」。 */
    const guard = async (outerSignal, work) => {
        try {
            return await work();
        }
        catch (error) {
            // A cancelled write can already have committed. Keep its outcome warning and
            // cancellation cause instead of replacing them with the caller's bare reason.
            if (typeof error === 'object' && error !== null && error.sqliteOutcome === 'unknown')
                throw error;
            outerSignal?.throwIfAborted();
            throw annotateError(error);
        }
    };
    const pingAllConnections = async (outerSignal) => {
        outerSignal?.throwIfAborted();
        const cfg = getCfg();
        syncAdapters(cfg);
        const pingTimeoutMs = Math.max(1, Math.min(cfg.queryTimeoutMs, 8000));
        const rows = await Promise.all(cfg.connections.map(async (connection) => {
            const effectiveReadOnly = cfg.readOnly || connection.readOnly === true;
            const sslEnabled = Boolean(connection.ssl && connection.ssl !== 'disable' && connection.ssl !== 'allow');
            const entry = {
                name: connection.name,
                engine: connection.engine,
                readOnly: effectiveReadOnly,
                ...(sslEnabled ? { ssl: true } : {}),
            };
            if (connection.engine === 'sqlite')
                entry.file = connection.file ?? ':memory:';
            else {
                entry.host = connection.host ?? '';
                // 端口要一并返回，否则渲染只能显示 host:undefined/database。
                entry.port = connection.port;
                entry.database = connection.database ?? '';
            }
            const scope = createTimeoutScope(outerSignal, pingTimeoutMs);
            try {
                const adapter = getAdapterFor(cfg, connection);
                await adapter.ping(scope.signal);
                entry.ok = true;
                entry.error = '';
            }
            catch (error) {
                outerSignal?.throwIfAborted();
                entry.ok = false;
                entry.error = annotateError(error).message;
            }
            finally {
                scope.dispose();
            }
            return entry;
        }));
        return { cfg, rows };
    };
    const sqlList = {
        name: 'sql_list',
        isConcurrencySafe: () => true,
        description: '列出配置的数据库连接并并发做连通性测试（SELECT 1）。返回连接名、引擎、目标、只读/SSL 状态与健康结果。',
        parameters: compileParameters({}),
        output: {
            schema: listSchema,
            render: (_args, value) => {
                const rec = asRecord(value);
                const connections = Array.isArray(rec.connections) ? rec.connections : [];
                const lines = ['共 ' + connections.length + ' 个数据库连接：'];
                const bad = [];
                for (const item of connections) {
                    const c = asRecord(item);
                    const target = c.file !== undefined && c.file !== '' ? c.file : c.host + ':' + c.port + '/' + c.database;
                    const tags = [];
                    if (c.readOnly === true)
                        tags.push('只读');
                    if (c.ssl === true)
                        tags.push('SSL');
                    const tagSuffix = tags.length > 0 ? ' [' + tags.join(', ') + ']' : '';
                    lines.push('- ' + c.name + '（' + c.engine + ' @ ' + target + '）' + tagSuffix + (c.ok === true ? ' ✅' : ' ❌ ' + String(c.error ?? '')));
                    if (c.ok !== true)
                        bad.push(String(c.name));
                }
                if (bad.length > 0) {
                    lines.push('', '下一步：先在 DSH「设置 → 插件 → 数据库（dsh-sql）」或 cordis.patch.yml 修好 ' + bad.join('、') + '（核对 host/port、服务是否启动、账号密码或 SQLite 文件路径），再运行 sql_list 复查。');
                }
                else if (rec.implicitMemoryDefault === true) {
                    lines.push('', '提示：当前尚未配置外部数据库，正在使用内置临时内存库（sqlite @ :memory:）。如需连接自己的 SQLite / MySQL / PostgreSQL，请在 DSH「设置 → 插件 → 数据库（dsh-sql）」添加 connections（保存即生效），或在 cordis.patch.yml 配置（密码可填配置项或用环境变量 DSH_SQL_PASSWORD_<连接名大写>）。');
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(_rawArgs, exec) {
            const { cfg, rows } = await pingAllConnections(executionSignal(exec));
            return { connections: rows, ...(cfg.implicitMemoryDefault ? { implicitMemoryDefault: true } : {}) };
        },
        timeoutMs: 30000,
    };
    const sqlQuery = {
        name: 'sql_query',
        isConcurrencySafe: () => true,
        description: '执行只读 SQL 查询（SELECT / PRAGMA / EXPLAIN / SHOW / DESCRIBE / WITH）。词法级校验按引擎处理反斜杠转义，拒绝 data-modifying CTE、SELECT INTO、FOR UPDATE/FOR SHARE、非白名单 PRAGMA 与多语句。支持 limit、参数化查询 params、敏感列脱敏（redactColumns）与 table/markdown/csv/json 格式输出。MySQL / PostgreSQL 每次查询使用独立只读事务并回滚，不受 readOnly 开关影响；PostgreSQL 还以扩展协议拒绝多命令。connection 为连接名（缺省第一个连接）。写操作请用 sql_exec。',
        parameters: compileParameters({
            sql: { type: 'string', required: true, description: '只读 SQL 语句（必填，单条）。' },
            connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
            limit: { type: 'integer', description: '本次最多返回行数（可选，需为 >= 1 的整数，不能超过全局 maxRows）。' },
            params: { type: 'array', items: {}, description: '参数化查询绑定值数组（可选；SQLite/MySQL 用 ?，PostgreSQL 用 $1/$2）。' },
            format: { type: 'string', enum: ['table', 'markdown', 'csv', 'json'], description: '输出格式：table（默认表格）/ markdown / csv / json。markdown / csv / json 会额外返回 formatted 文本，便于展示、落盘或转存。' },
        }),
        output: {
            schema: querySchema,
            render: (_args, value) => {
                const rec = asRecord(value);
                const durationNote = typeof rec.durationMs === 'number' ? '，耗时 ' + rec.durationMs + 'ms' : '';
                const truncNote = rec.truncated === true
                    ? '（已达上限 ' + rec.maxRows + ' 行，实际结果更多，可加 WHERE/LIMIT 或用 COUNT(*)）'
                    : '';
                const redactedCols = Array.isArray(rec.redactedColumns)
                    ? rec.redactedColumns.filter((col) => typeof col === 'string' && col !== '')
                    : [];
                const redactNote = redactedCols.length > 0
                    ? '（已脱敏列：' + redactedCols.join(', ') + '）'
                    : '';
                if (typeof rec.formatted === 'string' && (rec.formatted !== '' || rec.format === 'markdown' || rec.format === 'csv' || rec.format === 'json')) {
                    const preview = rec.formatted.length > 4000 ? rec.formatted.slice(0, 4000) + '\n…（预览已截断）' : rec.formatted;
                    return [{ type: 'text', text: '查询返回 ' + rec.rowCount + ' 行（' + String(rec.format) + ' 格式）' + durationNote + truncNote + redactNote + '：\n' + preview }];
                }
                const columns = Array.isArray(rec.columns) ? rec.columns.map(String) : [];
                const rows = Array.isArray(rec.rows) ? rec.rows : [];
                const header = '查询返回 ' + rec.rowCount + ' 行' + durationNote + truncNote + redactNote;
                const lines = [header];
                let totalChars = header.length;
                if (columns.length > 0) {
                    const mdHeader = '| ' + columns.map((col) => formatMarkdownCell(col)).join(' | ') + ' |';
                    const mdSep = '| ' + columns.map(() => '---').join(' | ') + ' |';
                    lines.push('', mdHeader, mdSep);
                    totalChars += 2 + mdHeader.length + 1 + mdSep.length;
                }
                let shown = 0;
                let charCapped = false;
                for (const row of rows.slice(0, 20)) {
                    const line = columns.length > 0
                        ? '| ' + columns.map((_, i) => formatMarkdownCell(Array.isArray(row) ? row[i] : (i === 0 ? row : undefined))).join(' | ') + ' |'
                        : '| ' + (Array.isArray(row) ? row.map((cell) => formatMarkdownCell(cell)).join(' | ') : formatMarkdownCell(row)) + ' |';
                    if (shown > 0 && totalChars + 1 + line.length > MAX_TABLE_RENDER_CHARS) {
                        charCapped = true;
                        break;
                    }
                    if (shown === 0 && totalChars + 1 + line.length > MAX_TABLE_RENDER_CHARS) {
                        const avail = Math.max(80, MAX_TABLE_RENDER_CHARS - totalChars - 16);
                        lines.push(line.slice(0, avail) + '…(已截断)');
                        shown += 1;
                        charCapped = true;
                        break;
                    }
                    lines.push(line);
                    totalChars += 1 + line.length;
                    shown += 1;
                }
                if (charCapped) {
                    lines.push('…输出已达长度上限，仅展示前 ' + shown + ' 行（共 ' + rows.length + ' 行）');
                }
                else if (rows.length > 20) {
                    lines.push('…仅展示前 20 行');
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(rawArgs, exec) {
            const args = asRecord(rawArgs);
            const rawSql = requiredString(args, 'sql', 'SQL 语句');
            const connectionName = optionalString(args, 'connection');
            const requestedLimit = optionalPositiveInteger(args, 'limit');
            const params = optionalParams(args);
            const format = parseQueryFormat(args);
            // 单次解析连接与配置，先按目标引擎做词法校验，再打开数据库（避免 TOCTOU 与无效建库）。
            const { cfg, connection } = findConnection(connectionName);
            const sql = assertReadQuery(rawSql, connection.engine);
            const effectiveLimit = requestedLimit !== undefined ? Math.min(cfg.maxRows, requestedLimit) : cfg.maxRows;
            const outerSignal = executionSignal(exec);
            const scope = createTimeoutScope(outerSignal, cfg.queryTimeoutMs);
            const adapter = getAdapterFor(cfg, connection);
            const useCursor = connection.engine === 'postgres'
                && (params === undefined || params.length === 0)
                && effectiveLimit > 0;
            const queryOptions = {
                ...(params !== undefined ? { params } : {}),
                timeoutMs: cfg.queryTimeoutMs,
                ...(useCursor ? { useCursor: true } : {}),
            };
            let result;
            const t0 = performance.now();
            try {
                result = await guard(outerSignal, () => adapter.query(sql, effectiveLimit + 1, scope.signal, queryOptions));
            }
            finally {
                scope.dispose();
            }
            const durationMs = Math.max(0, Math.round(performance.now() - t0));
            const truncated = result.rows.length > effectiveLimit;
            let rows = result.rows.slice(0, effectiveLimit);
            const redactedIdx = matchRedactedColumns(result.columns, cfg.redactColumns);
            const redactedColumns = [];
            if (redactedIdx.size > 0) {
                const seenRedacted = new Set();
                for (let i = 0; i < result.columns.length; i += 1) {
                    if (redactedIdx.has(i)) {
                        const col = result.columns[i];
                        if (!seenRedacted.has(col)) {
                            seenRedacted.add(col);
                            redactedColumns.push(col);
                        }
                    }
                }
                rows = rows.map((row) => row.map((cell, i) => (redactedIdx.has(i) && cell !== null && cell !== undefined ? '[REDACTED]' : cell)));
            }
            const base = {
                connection: connection.name,
                columns: result.columns,
                rows,
                rowCount: rows.length,
                truncated,
                maxRows: effectiveLimit,
                durationMs,
                ...(redactedColumns.length > 0 ? { redactedColumns } : {}),
            };
            if (format === 'markdown')
                return { ...base, format, formatted: toMarkdownTable(result.columns, rows) };
            if (format === 'csv')
                return { ...base, format, formatted: toCsv(result.columns, rows) };
            if (format === 'json') {
                if (new Set(result.columns).size !== result.columns.length) {
                    return { ...base, format, formatted: JSON.stringify({ columns: result.columns, rows }, null, 2) };
                }
                const objects = rows.map((row) => Object.fromEntries(result.columns.map((column, i) => [column, row[i]])));
                return { ...base, format, formatted: JSON.stringify(objects, null, 2) };
            }
            return base;
        },
        get timeoutMs() {
            return getCfg().queryTimeoutMs;
        },
    };
    const sqlExec = {
        name: 'sql_exec',
        description: '执行写操作或 DDL（INSERT / UPDATE / DELETE / CREATE / ALTER / DROP 等，支持参数化 params 与多语句脚本）。受全局/单连接 readOnly 模式与写审批门双重保护。返回影响行数。',
        parameters: compileParameters({
            sql: { type: 'string', required: true, description: '写操作/DDL SQL（必填）。' },
            connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
            params: { type: 'array', items: {}, description: '参数化写入绑定值数组（可选；SQLite/MySQL 用 ?，PostgreSQL 用 $1/$2）。' },
        }),
        output: {
            schema: execSchema,
            render: (_args, value) => {
                const rec = asRecord(value);
                const changes = typeof rec.changes === 'number' ? rec.changes : 0;
                const durationNote = typeof rec.durationMs === 'number' ? '，耗时 ' + rec.durationMs + 'ms' : '';
                const tail = changes === 0 ? '\n注意：0 行受影响，通常是 WHERE 条件没有命中数据，或用的是 DDL/多语句脚本；可用 sql_query 复核。' : '';
                return [{ type: 'text', text: '执行完成（' + rec.connection + '）：影响 ' + changes + ' 行' + durationNote + '。' + tail }];
            },
        },
        async execute(rawArgs, exec) {
            const currentCfg = getCfg();
            if (currentCfg.readOnly) {
                throw new Error('当前全局配置 readOnly=true，sql_exec 已被禁用。需要写操作请在 DSH「设置 → 插件 → 数据库（dsh-sql）」把 readOnly 改为 false（保存即生效），或修改 cordis.patch.yml。');
            }
            const args = asRecord(rawArgs);
            const sql = requiredString(args, 'sql', 'SQL 语句');
            const params = optionalParams(args);
            const connection = findConnectionIn(currentCfg, optionalString(args, 'connection'));
            if (connection.readOnly === true) {
                throw new Error('连接 ' + connection.name + ' 配置了单连接只读锁（readOnly=true），sql_exec 已被禁用。需要写操作请在连接配置中将其 readOnly 改为 false。');
            }
            const outerSignal = executionSignal(exec);
            const scope = createTimeoutScope(outerSignal, currentCfg.execTimeoutMs);
            const adapter = getAdapterFor(currentCfg, connection);
            const execOptions = {
                ...(params !== undefined ? { params } : {}),
                timeoutMs: currentCfg.execTimeoutMs,
            };
            let changes;
            const t0 = performance.now();
            try {
                changes = await guard(outerSignal, () => adapter.exec(sql, scope.signal, execOptions));
            }
            finally {
                scope.dispose();
            }
            const durationMs = Math.max(0, Math.round(performance.now() - t0));
            return { connection: connection.name, changes, readOnly: false, durationMs };
        },
        get timeoutMs() {
            return getCfg().execTimeoutMs;
        },
    };
    const sqlSchema = {
        name: 'sql_schema',
        isConcurrencySafe: () => true,
        description: '查看数据库结构：不给 table / tables 时列出表清单（可用 schema / pattern 过滤）；给 table（支持 schema.table）返回该表的列（类型/非空/主键/默认值/枚举值/注释）、索引与外键信息；给 tables（最多 20 张）可一次并发获取多张表结构。',
        parameters: compileParameters({
            table: { type: 'string', description: '表名（可选；支持 schema.table；缺省列出全部表）。' },
            tables: { type: 'array', items: { type: 'string' }, description: '批量查看多张表结构（可选，最多 20 张；支持 schema.table，优先级低于单个 table）。' },
            connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
            schema: { type: 'string', description: 'Schema 名称（可选；PostgreSQL 可按指定 schema 过滤表清单或限定表名）。' },
            pattern: { type: 'string', description: '表名过滤模式（可选，不带 table 时生效；支持不区分大小写子串或 * 通配符）。' },
        }),
        output: {
            schema: schemaToolSchema,
            render: (_args, value) => {
                const rec = asRecord(value);
                const columns = Array.isArray(rec.columns) ? rec.columns : [];
                // 指定了 table 却没有列：不能落到「共 0 张表」，那会把「表不存在」说成「库是空的」。
                if (typeof rec.table === 'string' && rec.table !== '') {
                    const displayTable = typeof rec.schema === 'string' && rec.schema !== '' && !rec.table.startsWith(rec.schema + '.')
                        ? rec.schema + '.' + rec.table
                        : rec.table;
                    if (columns.length === 0) {
                        return [{ type: 'text', text: '没有取到表 ' + displayTable + ' 的列：该表可能不存在、大小写/Schema 不匹配，或当前账号没有读取权限。\n下一步：先调用 sql_schema（不带 table）查看连接 ' + rec.connection + ' 的表清单，再用清单里的原名重试。' }];
                    }
                    const tableComment = typeof rec.comment === 'string' && rec.comment.trim() !== '' ? '（' + rec.comment.trim() + '）' : '';
                    const lines = ['表 ' + displayTable + tableComment + ' 的列：'];
                    for (const item of columns) {
                        lines.push(formatSchemaColumnLine(item));
                    }
                    const indexes = Array.isArray(rec.indexes) ? rec.indexes : [];
                    if (indexes.length > 0) {
                        lines.push('', '索引（' + indexes.length + '）：');
                        for (const item of indexes) {
                            const idx = asRecord(item);
                            const cols = Array.isArray(idx.columns) ? idx.columns.map(String).join(', ') : '';
                            lines.push('- ' + String(idx.name ?? '') + (idx.unique === true ? '（UNIQUE）' : '') + ' (' + cols + ')');
                        }
                    }
                    const foreignKeys = Array.isArray(rec.foreignKeys) ? rec.foreignKeys : [];
                    if (foreignKeys.length > 0) {
                        lines.push('', '外键（' + foreignKeys.length + '）：');
                        for (const item of foreignKeys) {
                            const fk = asRecord(item);
                            lines.push('- ' + String(fk.column ?? '') + ' -> ' + String(fk.refTable ?? '') + '.' + String(fk.refColumn ?? ''));
                        }
                    }
                    return [{ type: 'text', text: lines.join('\n') }];
                }
                if (Array.isArray(rec.tableDetails)) {
                    const details = rec.tableDetails;
                    const blocks = ['连接 ' + rec.connection + ' 批量表结构（共 ' + details.length + ' 张）：'];
                    for (const item of details) {
                        const d = asRecord(item);
                        const rawTable = typeof d.table === 'string' ? d.table : '';
                        const displayTable = typeof d.schema === 'string' && d.schema !== '' && !rawTable.startsWith(d.schema + '.')
                            ? d.schema + '.' + rawTable
                            : rawTable;
                        const tableComment = typeof d.comment === 'string' && d.comment.trim() !== '' ? '（' + d.comment.trim() + '）' : '';
                        const section = ['### ' + displayTable + tableComment];
                        if (typeof d.error === 'string' && d.error !== '') {
                            section.push('读取失败：' + d.error);
                        }
                        else {
                            const cols = Array.isArray(d.columns) ? d.columns : [];
                            if (cols.length === 0) {
                                section.push('未找到该表的列（表可能不存在、大小写/Schema 不匹配，或无读取权限）。');
                            }
                            else {
                                for (const col of cols)
                                    section.push(formatSchemaColumnLine(col));
                                const indexes = Array.isArray(d.indexes) ? d.indexes : [];
                                if (indexes.length > 0) {
                                    section.push('索引（' + indexes.length + '）：');
                                    for (const idxItem of indexes) {
                                        const idx = asRecord(idxItem);
                                        const idxCols = Array.isArray(idx.columns) ? idx.columns.map(String).join(', ') : '';
                                        section.push('- ' + String(idx.name ?? '') + (idx.unique === true ? '（UNIQUE）' : '') + ' (' + idxCols + ')');
                                    }
                                }
                                const foreignKeys = Array.isArray(d.foreignKeys) ? d.foreignKeys : [];
                                if (foreignKeys.length > 0) {
                                    section.push('外键（' + foreignKeys.length + '）：');
                                    for (const fkItem of foreignKeys) {
                                        const fk = asRecord(fkItem);
                                        section.push('- ' + String(fk.column ?? '') + ' -> ' + String(fk.refTable ?? '') + '.' + String(fk.refColumn ?? ''));
                                    }
                                }
                            }
                        }
                        blocks.push('', ...section);
                    }
                    return [{ type: 'text', text: blocks.join('\n') }];
                }
                const tables = Array.isArray(rec.tables) ? rec.tables : [];
                if (tables.length === 0) {
                    const filters = [];
                    if (typeof rec.schema === 'string' && rec.schema !== '')
                        filters.push('schema=' + rec.schema);
                    if (typeof rec.pattern === 'string' && rec.pattern !== '')
                        filters.push('pattern=' + rec.pattern);
                    if (filters.length > 0) {
                        return [{ type: 'text', text: '连接 ' + rec.connection + ' 中没有匹配的表（过滤条件：' + filters.join('，') + '）。' }];
                    }
                    if (rec.implicitMemoryDefault === true) {
                        return [{ type: 'text', text: '连接 ' + rec.connection + ' 里没有用户表（当前尚未配置外部数据库，正在使用内置临时内存库 :memory:。请在 DSH「设置 → 插件 → 数据库（dsh-sql）」添加你的 SQLite / MySQL / PostgreSQL 连接，保存即生效；或在 cordis.patch.yml 配置）。' }];
                    }
                    return [{ type: 'text', text: '连接 ' + rec.connection + ' 里没有用户表（库可能是空的，或该账号只能看到部分 Schema）。' }];
                }
                return [{ type: 'text', text: '共 ' + tables.length + ' 张表：' + tables.join(', ') }];
            },
        },
        async execute(rawArgs, exec) {
            const args = asRecord(rawArgs);
            const table = optionalString(args, 'table');
            const tablesArg = optionalTableList(args);
            const schemaName = optionalString(args, 'schema');
            const pattern = optionalString(args, 'pattern');
            const tableRef = table !== undefined ? qualifyTableRef(table, schemaName) : undefined;
            const batchRefs = table === undefined && tablesArg !== undefined
                ? tablesArg.map((rawTable) => ({ rawTable, tableRef: qualifyTableRef(rawTable, schemaName) }))
                : undefined;
            if (table === undefined && batchRefs === undefined && schemaName !== undefined)
                parseSingleSchema(schemaName);
            const { adapter, name, cfg } = getAdapter(optionalString(args, 'connection'));
            const outerSignal = executionSignal(exec);
            const scope = createTimeoutScope(outerSignal, 30000);
            const signal = scope.signal;
            try {
                if (tableRef !== undefined && table !== undefined) {
                    if (typeof adapter.describeTableDetail === 'function') {
                        const detail = await guard(outerSignal, () => adapter.describeTableDetail(tableRef, signal));
                        return {
                            connection: name,
                            table: detail.table || table,
                            ...(detail.schema !== undefined ? { schema: detail.schema } : {}),
                            ...(detail.comment !== undefined && detail.comment !== null && detail.comment !== '' ? { comment: detail.comment } : {}),
                            columns: detail.columns,
                            indexes: detail.indexes,
                            foreignKeys: detail.foreignKeys,
                            tables: [],
                        };
                    }
                    const columns = await guard(outerSignal, () => adapter.describeTable(tableRef, signal));
                    return { connection: name, table, columns, indexes: [], foreignKeys: [], tables: [] };
                }
                if (batchRefs !== undefined) {
                    const tableDetails = await Promise.all(batchRefs.map(async ({ rawTable, tableRef: qualified }) => {
                        try {
                            if (typeof adapter.describeTableDetail === 'function') {
                                const detail = await adapter.describeTableDetail(qualified, signal);
                                return {
                                    table: detail.table || rawTable,
                                    ...(detail.schema !== undefined ? { schema: detail.schema } : {}),
                                    ...(detail.comment !== undefined && detail.comment !== null && detail.comment !== '' ? { comment: detail.comment } : {}),
                                    columns: detail.columns,
                                    indexes: detail.indexes,
                                    foreignKeys: detail.foreignKeys,
                                };
                            }
                            const columns = await adapter.describeTable(qualified, signal);
                            return { table: rawTable, columns, indexes: [], foreignKeys: [] };
                        }
                        catch (error) {
                            outerSignal?.throwIfAborted();
                            if (signal.aborted)
                                throw annotateError(signal.reason);
                            return {
                                table: rawTable,
                                columns: [],
                                indexes: [],
                                foreignKeys: [],
                                error: annotateError(error).message,
                            };
                        }
                    }));
                    return {
                        connection: name,
                        ...(schemaName !== undefined ? { schema: schemaName } : {}),
                        tableDetails,
                        tables: [],
                        columns: [],
                    };
                }
                const allTables = await guard(outerSignal, () => adapter.listTables(signal, schemaName));
                const tables = filterTablesByPattern(allTables, pattern);
                return {
                    connection: name,
                    ...(schemaName !== undefined ? { schema: schemaName } : {}),
                    ...(pattern !== undefined ? { pattern } : {}),
                    tables,
                    columns: [],
                    ...(cfg.implicitMemoryDefault ? { implicitMemoryDefault: true } : {}),
                };
            }
            finally {
                scope.dispose();
            }
        },
        timeoutMs: 30000,
    };
    const sqlStats = {
        name: 'sql_stats',
        isConcurrencySafe: () => true,
        description: '数据库概览统计：表数量、每张表的行数与占用体积、库总体积（SQLite 按页计算，MySQL/PostgreSQL 走系统表）。connection 为连接名（缺省第一个连接）。适合在写查询前先了解数据规模。',
        parameters: compileParameters({
            connection: { type: 'string', description: '连接名（可选，缺省第一个连接）。' },
        }),
        output: {
            schema: statsSchema,
            render: (_args, value) => {
                const rec = asRecord(value);
                const tables = Array.isArray(rec.tables) ? rec.tables : [];
                const lines = ['连接 ' + rec.connection + '（' + rec.engine + '）：共 ' + tables.length + ' 张表' + (typeof rec.sizeBytes === 'number' && rec.sizeBytes >= 0 ? '，库体积 ' + formatBytes(rec.sizeBytes) : '') + '。'];
                for (const item of tables.slice(0, 30)) {
                    const t = asRecord(item);
                    const label = typeof t.name === 'string' && t.name !== '' ? t.name : '（表清单读取失败）';
                    const rowText = typeof t.rowCount === 'number'
                        ? (t.estimated === true ? '约 ' : '') + t.rowCount + ' 行'
                        : '行数未知' + (t.error ? '（' + t.error + '）' : '');
                    const sizeText = typeof t.sizeBytes === 'number' && t.sizeBytes >= 0 ? '，' + formatBytes(t.sizeBytes) : '';
                    lines.push('- ' + label + '：' + rowText + sizeText);
                }
                if (tables.length > 0 && tables.every((item) => typeof asRecord(item).rowCount !== 'number') && tables.every((item) => asRecord(item).error !== undefined)) {
                    lines.push('', '下一步：统计信息读不到时，先用 sql_schema 确认表清单可用、账号有读取系统表/information_schema 的权限，再用 sql_query 手动 COUNT(*)。');
                }
                if (tables.length > 30)
                    lines.push('…仅展示前 30 张表');
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(rawArgs, exec) {
            const args = asRecord(rawArgs);
            const { adapter, name, cfg } = getAdapter(optionalString(args, 'connection'));
            const engine = adapter.engine;
            const outerSignal = executionSignal(exec);
            const scope = createTimeoutScope(outerSignal, cfg.queryTimeoutMs);
            const signal = scope.signal;
            const queryOptions = { timeoutMs: cfg.queryTimeoutMs };
            let sizeBytes = -1;
            const tables = [];
            try {
                try {
                    sizeBytes = await databaseSize(adapter, engine, signal, cfg.queryTimeoutMs);
                }
                catch {
                    outerSignal?.throwIfAborted();
                    if (signal.aborted)
                        throw annotateError(signal.reason);
                    sizeBytes = -1;
                }
                if (engine === 'mysql') {
                    try {
                        const sql = "SELECT TABLE_NAME, TABLE_ROWS, (DATA_LENGTH + INDEX_LENGTH) AS total_bytes FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
                        const result = await adapter.query(sql, undefined, signal, queryOptions);
                        for (const row of result.rows) {
                            const totalBytes = row[2] !== null && row[2] !== undefined ? Number(row[2]) : undefined;
                            tables.push({
                                name: String(row[0]),
                                rowCount: typeof row[1] === 'number' ? row[1] : Number(row[1] ?? 0),
                                ...(totalBytes !== undefined && Number.isFinite(totalBytes) && totalBytes >= 0 ? { sizeBytes: totalBytes } : {}),
                            });
                        }
                    }
                    catch (error) {
                        outerSignal?.throwIfAborted();
                        if (signal.aborted)
                            throw annotateError(signal.reason);
                        tables.push({ name: '', error: error instanceof Error ? error.message : String(error) });
                    }
                }
                else if (engine === 'postgres') {
                    try {
                        const sql = 'SELECT schemaname, relname, n_live_tup, pg_total_relation_size(relid) AS total_bytes FROM pg_stat_user_tables ORDER BY schemaname, relname';
                        const result = await adapter.query(sql, undefined, signal, queryOptions);
                        for (const row of result.rows) {
                            const schemaName = String(row[0] ?? '');
                            const relName = String(row[1] ?? '');
                            const tableName = schemaName === '' || schemaName === 'public' ? relName : schemaName + '.' + relName;
                            const totalBytes = row[3] !== null && row[3] !== undefined ? Number(row[3]) : undefined;
                            tables.push({
                                name: tableName,
                                rowCount: typeof row[2] === 'number' ? row[2] : Number(row[2] ?? 0),
                                ...(totalBytes !== undefined && Number.isFinite(totalBytes) && totalBytes >= 0 ? { sizeBytes: totalBytes } : {}),
                            });
                        }
                    }
                    catch (error) {
                        outerSignal?.throwIfAborted();
                        if (signal.aborted)
                            throw annotateError(signal.reason);
                        tables.push({ name: '', error: error instanceof Error ? error.message : String(error) });
                    }
                }
                else {
                    const names = await guard(outerSignal, () => adapter.listTables(signal));
                    // 表数量极大（>200）时优先读取 sqlite_stat1 估计值，避免长时间阻塞事件循环；正常表数保持精确 COUNT(*)。
                    let statEstimates;
                    if (names.length > 200) {
                        try {
                            const statResult = await adapter.query('SELECT tbl, stat FROM sqlite_stat1', undefined, signal, queryOptions);
                            statEstimates = new Map();
                            for (const row of statResult.rows) {
                                const tbl = String(row[0] ?? '');
                                const firstNum = Number(String(row[1] ?? '').trim().split(/\s+/)[0]);
                                if (tbl !== '' && Number.isFinite(firstNum) && !statEstimates.has(tbl)) {
                                    statEstimates.set(tbl, firstNum);
                                }
                            }
                        }
                        catch {
                            outerSignal?.throwIfAborted();
                            if (signal.aborted)
                                throw annotateError(signal.reason);
                            statEstimates = undefined;
                        }
                    }
                    for (let idx = 0; idx < names.length; idx += 1) {
                        if (idx > 0) {
                            await new Promise((resolve) => setImmediate(resolve));
                            outerSignal?.throwIfAborted();
                            if (signal.aborted)
                                throw annotateError(signal.reason);
                        }
                        const table = names[idx];
                        const estimated = statEstimates?.get(table);
                        if (estimated !== undefined) {
                            tables.push({ name: table, rowCount: estimated, estimated: true });
                            continue;
                        }
                        try {
                            const result = await adapter.query('SELECT COUNT(*) FROM ' + quoteIdent(engine, table), 1, signal, queryOptions);
                            tables.push({ name: table, rowCount: Number(result.rows[0]?.[0] ?? 0) });
                        }
                        catch (error) {
                            outerSignal?.throwIfAborted();
                            if (signal.aborted)
                                throw annotateError(signal.reason);
                            tables.push({ name: table, error: error instanceof Error ? error.message : String(error) });
                        }
                    }
                }
                return { connection: name, engine, tableCount: tables.filter((t) => t.name !== '').length, tables, sizeBytes };
            }
            finally {
                scope.dispose();
            }
        },
        get timeoutMs() {
            return getCfg().queryTimeoutMs;
        },
    };
    const sqlHealth = {
        name: 'sql_health',
        isConcurrencySafe: () => true,
        description: 'dsh-sql 自检：并发做连通性测试，并汇总安全配置（只读模式、写审批门、敏感列脱敏、行数上限、超时）。遇到问题时先运行本工具定位。',
        parameters: compileParameters({}),
        output: {
            schema: healthSchema,
            render: (_args, value) => {
                const rec = asRecord(value);
                const connections = Array.isArray(rec.connections) ? rec.connections : [];
                const bad = connections.filter((c) => asRecord(c).ok !== true);
                const allConnectionsReadOnly = connections.length > 0 && connections.every((c) => asRecord(c).readOnly === true);
                const lines = ['dsh-sql 自检' + (rec.ok === true ? '：正常。' : '：发现问题。')];
                for (const item of connections) {
                    const c = asRecord(item);
                    const tags = [];
                    if (c.readOnly === true)
                        tags.push('只读');
                    if (c.ssl === true)
                        tags.push('SSL');
                    const tagSuffix = tags.length > 0 ? ' [' + tags.join(', ') + ']' : '';
                    lines.push('- ' + c.name + '（' + c.engine + '）' + tagSuffix + (c.ok === true ? ' ✅' : ' ❌ ' + String(c.error ?? '')));
                }
                lines.push('- 只读模式：' + (rec.readOnly === true ? '开（sql_exec 已禁用）' : '关'));
                lines.push('- 写审批门：' + String(rec.writeApprovalDetail ?? (rec.writeApproval === true ? '开' : '关')));
                lines.push('- 行数上限：' + String(rec.maxRows) + '；查询超时 ' + String(rec.queryTimeoutMs) + 'ms；写超时 ' + String(rec.execTimeoutMs) + 'ms');
                const redactEnabled = rec.redactColumns === true;
                const redactCount = typeof rec.redactPatternCount === 'number' ? rec.redactPatternCount : 0;
                lines.push('- 敏感列脱敏：' + (redactEnabled ? '开（' + redactCount + ' 条规则）' : '关'));
                if (rec.implicitMemoryDefault === true) {
                    lines.push('- 配置提示：当前尚未添加外部数据库，正在使用内置临时内存库（:memory:）；可在 DSH「设置 → 插件 → 数据库（dsh-sql）」添加连接（保存即生效），或在 cordis.patch.yml 配置。');
                }
                // 自检的价值在于失败时告诉用户下一步做什么，而不只是把 ❌ 摆出来。
                if (bad.length > 0) {
                    lines.push('- 下一步：在 DSH「设置 → 插件 → 数据库（dsh-sql）」或 cordis.patch.yml 逐个修好上面的 ❌ 连接（核对 host/port、数据库服务是否启动、账号密码或 SQLite 文件路径与权限），再运行 sql_health 复查。');
                }
                if (rec.writeApprovalReady === false) {
                    lines.push('- 下一步：写审批门当前无法确认。把会话审批策略切到可询问（ask），或由用户明确在「设置 → 插件 → 数据库」将 writeApproval 设为 false（之后 sql_exec 不再询问，慎用）。');
                }
                if (rec.readOnly === true) {
                    lines.push('- 说明：readOnly=true 时 sql_exec 被禁用属于配置预期，不是故障。');
                }
                else if (allConnectionsReadOnly) {
                    lines.push('- 说明：全部连接均配置了只读模式（readOnly=true），sql_exec 已禁用，无需写审批门。');
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(_rawArgs, exec) {
            const { cfg, rows: connections } = await pingAllConnections(executionSignal(exec));
            const bad = connections.filter((c) => c.ok !== true);
            const policy = policyOf(exec);
            const allReadOnly = cfg.readOnly || (cfg.connections.length > 0 && cfg.connections.every((c) => c.readOnly === true));
            const writeApprovalReady = allReadOnly || !cfg.writeApproval || policy === 'ask';
            const writeApprovalDetail = cfg.readOnly
                ? '全局只读配置，不允许写入'
                : allReadOnly
                    ? '全部连接均为只读配置，不允许写入'
                    : !cfg.writeApproval
                        ? '关闭；其它宿主策略仍生效'
                        : policy === 'ask'
                            ? '开启；经宿主询问'
                            : policy === 'never'
                                ? '当前策略 never 无法询问；请切换模式或由用户明确设置 writeApproval=false'
                                : '无法读取宿主审批策略';
            return {
                ok: bad.length === 0 && writeApprovalReady,
                plugin: 'dsh-sql',
                connections,
                readOnly: cfg.readOnly,
                writeApproval: cfg.writeApproval,
                approvalPolicy: policy,
                writeApprovalReady,
                writeApprovalDetail,
                redactColumns: cfg.redactColumns.length > 0,
                redactPatternCount: cfg.redactColumns.length,
                maxRows: cfg.maxRows,
                queryTimeoutMs: cfg.queryTimeoutMs,
                execTimeoutMs: cfg.execTimeoutMs,
                ...(cfg.implicitMemoryDefault ? { implicitMemoryDefault: true } : {}),
            };
        },
        timeoutMs: 30000,
    };
    return { tools: [sqlList, sqlQuery, sqlExec, sqlSchema, sqlStats, sqlHealth], adapters };
}
