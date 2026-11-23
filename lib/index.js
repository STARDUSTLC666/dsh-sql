/**
 * dsh-sql —— 工程师级数据库工具插件（node 半身，配置走 cordis.patch.yml）。
 *
 * 插件导出 apply(ctx, config)：注册六个面向模型的工具（sql_list / sql_query /
 * sql_exec / sql_schema / sql_stats / sql_health），支持 SQLite / MySQL / PostgreSQL
 * 三引擎与多连接。
 * sql_exec 默认走宿主审批门（对齐 dsh-email 的发信审批），全局或单连接 readOnly 模式可禁用写。
 *
 * @module dsh-sql
 */
import { registerUpdates } from '@stardustlc/dsh-updates';
import { resolveConfig } from './config.js';
import { Config as SqlConfigSchema, liveConfig } from './host-config.js';
import { buildSqlTools, summarizeWriteScript } from './tools.js';
import { approvalPolicy, approvalProblem } from './approval.js';
import { createSqlSettingsBackend, installSqlSettingsWeb, } from './web.js';
/** cordis 服务注入：apply 里要用 ctx.tools，必须显式声明。 */
export const Config = SqlConfigSchema;
export const name = 'sql';
export const inject = ['tools'];
const MAX_APPROVAL_PARAMS = 50;
const MAX_APPROVAL_PARAM_VALUE_CHARS = 120;
/** 格式化审批卡的目标连接描述（绝不包含密码）。 */
function formatApprovalTarget(connection, requestedName) {
    if (connection === undefined) {
        return requestedName !== undefined
            ? `目标连接：${requestedName}（未在配置中找到）`
            : '目标连接：未配置';
    }
    const targetDesc = connection.engine === 'sqlite'
        ? (connection.file ?? ':memory:')
        : `${connection.host ?? 'localhost'}:${connection.port ?? (connection.engine === 'postgres' ? 5432 : 3306)}/${connection.database ?? ''}`;
    return `目标连接：${connection.name}（${connection.engine} @ ${targetDesc}）`;
}
function safeToString(value) {
    try {
        return String(value);
    }
    catch {
        return Object.prototype.toString.call(value);
    }
}
/** 安全格式化单个绑定参数值：折叠换行并限制单值长度，确保审批人可见真实写入值。 */
function formatApprovalParamValue(value) {
    let text;
    if (value === undefined) {
        text = 'undefined';
    }
    else if (typeof value === 'number' && !Number.isFinite(value)) {
        text = String(value);
    }
    else {
        try {
            const json = JSON.stringify(value);
            text = json !== undefined ? json : safeToString(value);
        }
        catch {
            text = safeToString(value);
        }
    }
    text = text.replace(/\r\n|\r|\n/g, '\\n');
    return text.length > MAX_APPROVAL_PARAM_VALUE_CHARS
        ? text.slice(0, MAX_APPROVAL_PARAM_VALUE_CHARS) + '…'
        : text;
}
/** 格式化审批卡的绑定参数清单（PostgreSQL 用 $1=...，SQLite/MySQL 用 [1]=...）。 */
function formatApprovalParams(params, engine) {
    const count = Math.min(params.length, MAX_APPROVAL_PARAMS);
    const prefix = (index) => (engine === 'postgres' ? '$' + (index + 1) : '[' + (index + 1) + ']');
    const shown = Array.from({ length: count }, (_, index) => prefix(index) + '=' + formatApprovalParamValue(params[index]));
    const suffix = params.length > MAX_APPROVAL_PARAMS
        ? ' …另有 ' + (params.length - MAX_APPROVAL_PARAMS) + ' 个参数'
        : '';
    return '绑定参数（' + params.length + ' 个）：' + shown.join(', ') + suffix;
}
/**
 * 插件入口：解析配置、构建六工具、给 sql_exec 注入审批门。
 */
export function apply(ctx, config) {
    registerUpdates(ctx, { name: "dsh-sql" });
    const live = liveConfig((config ?? {}));
    // 启动时立即校验配置，非法配置响亮失败，不注册任何工具或监听器。
    resolveConfig(live);
    const getCfg = () => resolveConfig(live);
    const policyOf = (exec) => approvalPolicy(ctx, exec);
    const { tools, adapters } = buildSqlTools(getCfg, policyOf);
    const disposers = [];
    let injectedSettingsProvider;
    if (typeof ctx.inject === 'function') {
        try {
            const offSettings = ctx.inject(['settings'], (sCtx) => {
                const provider = sCtx?.settings;
                if (provider !== undefined && provider !== null) {
                    injectedSettingsProvider = provider;
                    if (typeof sCtx.effect === 'function') {
                        sCtx.effect(() => () => {
                            if (injectedSettingsProvider === provider)
                                injectedSettingsProvider = undefined;
                        }, 'dsh-sql: settings provider');
                    }
                }
                if (typeof provider?.configure === 'function') {
                    if (typeof sCtx.effect === 'function') {
                        sCtx.effect(() => {
                            const off = provider.configure({ auto: false }, ctx.fiber);
                            return typeof off === 'function' ? off : undefined;
                        }, 'dsh-sql: settings.configure');
                    }
                    else {
                        const off = provider.configure({ auto: false }, ctx.fiber);
                        if (typeof off === 'function')
                            disposers.push(off);
                    }
                }
            });
            if (typeof offSettings === 'function')
                disposers.push(offSettings);
            else if (offSettings !== null && typeof offSettings === 'object' && typeof offSettings.dispose === 'function') {
                disposers.push(() => offSettings.dispose());
            }
        }
        catch {
            // Older or minimal host without settings service; continue without custom settings hook.
        }
    }
    const settingsBackend = createSqlSettingsBackend(ctx, live, {
        getProvider: () => injectedSettingsProvider,
    });
    disposers.push(installSqlSettingsWeb(ctx, settingsBackend));
    // 始终注册 pre-execute 审批门，确保 writeApproval 从 false 热更新为 true 时立即生效。
    const offPreExecute = ctx.on('tools/pre-execute', async (exec, next) => {
        if (exec.name !== 'sql_exec')
            return next();
        const currentCfg = getCfg();
        const args = (typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments : {});
        const requestedName = typeof args.connection === 'string' && args.connection.trim() !== ''
            ? args.connection.trim()
            : undefined;
        const targetConn = requestedName !== undefined
            ? currentCfg.connections.find((item) => item.name.toLowerCase() === requestedName.toLowerCase())
            : currentCfg.connections[0];
        if (currentCfg.readOnly) {
            return {
                kind: 'deny',
                reason: '当前全局配置为只读模式（readOnly=true），sql_exec 已禁用 / Global read-only configuration; sql_exec is disabled.',
            };
        }
        if (targetConn?.readOnly === true) {
            return {
                kind: 'deny',
                reason: `目标连接 ${targetConn.name} 为只读配置（readOnly=true），sql_exec 已禁用 / Connection "${targetConn.name}" is read-only; sql_exec is disabled.`,
            };
        }
        if (!currentCfg.writeApproval)
            return next();
        const downstream = await next();
        if (downstream.kind === 'deny')
            return downstream;
        if (requestedName !== undefined && targetConn === undefined) {
            return {
                kind: 'deny',
                reason: '未找到名为 ' + requestedName + ' 的数据库连接，无需审批。请先调用 sql_list 查看现有连接名。',
            };
        }
        const problem = approvalProblem(policyOf(exec), 'writeApproval');
        if (problem)
            return { kind: 'deny', reason: problem };
        const sql = typeof args.sql === 'string' ? args.sql : '';
        const targetLine = formatApprovalTarget(targetConn, requestedName);
        const lines = ['sql_exec 写操作需要确认：', targetLine];
        if (Array.isArray(args.params) && args.params.length > 0) {
            lines.push(formatApprovalParams(args.params, targetConn?.engine));
        }
        lines.push(summarizeWriteScript(sql, targetConn?.engine));
        return {
            kind: 'ask',
            // 不截断整段 SQL：先标明目标连接与绑定参数，再按目标引擎词法逐条列出高危提示、每条语句与语句类型统计，最后附完整 SQL。
            // 只截 200 字符会把第二条 DROP / DELETE 挡在审批卡之外。
            reason: lines.join('\n'),
        };
    });
    if (typeof offPreExecute === 'function')
        disposers.push(offPreExecute);
    for (const definition of tools) {
        disposers.push(ctx.tools.register(definition));
    }
    const teardown = async () => {
        for (const dispose of disposers.splice(0))
            dispose();
        const active = [...adapters.values()];
        adapters.clear();
        await Promise.allSettled(active.map(adapter => adapter.close()));
    };
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => teardown, 'sql.dispose()');
    }
    else if (typeof ctx.on === 'function') {
        ctx.on('dispose', () => { void teardown(); });
    }
}
export * from './adapters.js';
export * from './config.js';
export { liveConfig, createVolatile, HostValidationError } from './host-config.js';
export * from './tools.js';
export * from './web.js';
