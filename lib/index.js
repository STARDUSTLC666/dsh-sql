import { registerUpdates } from '@stardustlc/dsh-updates';
/**
 * dsh-sql —— 工程师级数据库工具插件（node 半身，配置走 cordis.patch.yml）。
 *
 * 插件导出 apply(ctx, config)：注册六个面向模型的工具（sql_list / sql_query /
 * sql_exec / sql_schema / sql_stats / sql_health），支持 SQLite / MySQL / PostgreSQL
 * 三引擎与多连接。
 * sql_exec 默认走宿主审批门（对齐 dsh-email 的发信审批），readOnly 模式可整体禁用写。
 *
 * @module dsh-sql
 */
import { resolveConfig } from './config.js';
import { Config as SqlConfigSchema, liveConfig } from './host-config.js';
import { buildSqlTools, summarizeWriteScript } from './tools.js';
import { approvalPolicy, approvalProblem } from './approval.js';
/** cordis 服务注入：apply 里要用 ctx.tools，必须显式声明。 */
export const Config = SqlConfigSchema;
export const name = 'sql';
export const inject = ['tools'];
/**
 * 插件入口：解析配置、构建六工具、给 sql_exec 注入审批门。
 */
export function apply(ctx, config) {
    registerUpdates(ctx, { name: "dsh-sql" });
    const live = liveConfig((config ?? {}));
    const initialCfg = resolveConfig(live);
    const getCfg = () => resolveConfig(live);
    const policyOf = (exec) => approvalPolicy(ctx, exec);
    const { tools, adapters } = buildSqlTools(getCfg, policyOf);
    if (initialCfg.writeApproval) {
        ctx.on('tools/pre-execute', async (exec, next) => {
            if (exec.name !== 'sql_exec')
                return next();
            const currentCfg = getCfg();
            if (!currentCfg.writeApproval)
                return next();
            const downstream = await next();
            if (downstream.kind === 'deny')
                return downstream;
            if (currentCfg.readOnly)
                return { kind: 'deny', reason: '当前连接为只读配置，sql_exec 已禁用 / Read-only configuration; sql_exec is disabled.' };
            const problem = approvalProblem(policyOf(exec), 'writeApproval');
            if (problem)
                return { kind: 'deny', reason: problem };
            const args = (typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments : {});
            const sql = typeof args.sql === 'string' ? args.sql : '';
            return {
                kind: 'ask',
                // 不截断整段 SQL：先逐条列出每条语句与语句类型统计，再附完整 SQL。
                // 只截 200 字符会把第二条 DROP / DELETE 挡在审批卡之外。
                reason: 'sql_exec 写操作需要确认：\n' + summarizeWriteScript(sql),
            };
        });
    }
    const disposers = [];
    for (const definition of tools) {
        disposers.push(ctx.tools.register(definition));
    }
    const teardown = async () => {
        for (const dispose of disposers)
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
