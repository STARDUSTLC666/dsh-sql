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

import { registerUpdates } from '@stardustlc/dsh-updates'
import { resolveConfig, type SqlConfig, type SqlConnectionConfig } from './config.js'
import { Config as SqlConfigSchema, liveConfig } from './host-config.js'
import { buildSqlTools, summarizeWriteScript, type SqlToolDefinition } from './tools.js'
import { approvalPolicy, approvalProblem, type ApprovalContext } from './approval.js'

/** cordis 服务注入：apply 里要用 ctx.tools，必须显式声明。 */
export const Config = SqlConfigSchema
export const name = 'sql'
export const inject = ['tools']

/** Harness `tools/pre-execute` 的决策结果。 */
type SqlPreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

/** 审批策略需要读取的 alpha.5 工具执行字段。 */
interface SqlToolExecution {
  readonly name: string
  readonly arguments: unknown
}

/** Harness `tools/pre-execute` waterfall 监听器。 */
type SqlPreExecuteListener = (
  exec: SqlToolExecution,
  next: () => Promise<SqlPreToolDecision>,
) => Promise<SqlPreToolDecision>

/** 插件所需的最小 ctx 面。 */
export interface SqlPluginContext extends ApprovalContext {
  tools: { register(definition: SqlToolDefinition): () => void }
  effect?(effect: () => () => unknown, label?: string): unknown
  on(event: 'tools/pre-execute', listener: SqlPreExecuteListener): () => void
  on(event: 'dispose', listener: () => void): () => void
}

/** 格式化审批卡的目标连接描述（绝不包含密码）。 */
function formatApprovalTarget(connection: SqlConnectionConfig | undefined, requestedName: string | undefined): string {
  if (connection === undefined) {
    return requestedName !== undefined
      ? `目标连接：${requestedName}（未在配置中找到）`
      : '目标连接：未配置'
  }
  const targetDesc = connection.engine === 'sqlite'
    ? (connection.file ?? ':memory:')
    : `${connection.host ?? 'localhost'}:${connection.port ?? (connection.engine === 'postgres' ? 5432 : 3306)}/${connection.database ?? ''}`
  return `目标连接：${connection.name}（${connection.engine} @ ${targetDesc}）`
}

/**
 * 插件入口：解析配置、构建六工具、给 sql_exec 注入审批门。
 */
export function apply(ctx: SqlPluginContext, config?: SqlConfig | null): void {
  registerUpdates(ctx, { name: "dsh-sql" })

  const live = liveConfig((config ?? {}) as SqlConfig)
  // 启动时立即校验配置，非法配置响亮失败，不注册任何工具或监听器。
  resolveConfig(live)
  const getCfg = () => resolveConfig(live)

  const policyOf = (exec: unknown) => approvalPolicy(ctx, exec)
  const { tools, adapters } = buildSqlTools(getCfg, policyOf)

  const disposers: Array<() => void> = []
  // 始终注册 pre-execute 审批门，确保 writeApproval 从 false 热更新为 true 时立即生效。
  const offPreExecute = ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'sql_exec') return next()
    const currentCfg = getCfg()
    if (!currentCfg.writeApproval) return next()
    const downstream = await next()
    if (downstream.kind === 'deny') return downstream
    const args = (typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments : {}) as Record<string, unknown>
    const requestedName = typeof args.connection === 'string' && args.connection.trim() !== ''
      ? args.connection.trim()
      : undefined
    const targetConn = requestedName !== undefined
      ? currentCfg.connections.find((item) => item.name.toLowerCase() === requestedName.toLowerCase())
      : currentCfg.connections[0]
    if (currentCfg.readOnly) {
      return {
        kind: 'deny',
        reason: '当前全局配置为只读模式（readOnly=true），sql_exec 已禁用 / Global read-only configuration; sql_exec is disabled.',
      }
    }
    if (targetConn?.readOnly === true) {
      return {
        kind: 'deny',
        reason: `目标连接 ${targetConn.name} 为只读配置（readOnly=true），sql_exec 已禁用 / Connection "${targetConn.name}" is read-only; sql_exec is disabled.`,
      }
    }
    const problem = approvalProblem(policyOf(exec), 'writeApproval')
    if (problem) return { kind: 'deny', reason: problem }
    const sql = typeof args.sql === 'string' ? args.sql : ''
    const targetLine = formatApprovalTarget(targetConn, requestedName)
    return {
      kind: 'ask',
      // 不截断整段 SQL：先标明目标连接，再按目标引擎词法逐条列出每条语句与语句类型统计，最后附完整 SQL。
      // 只截 200 字符会把第二条 DROP / DELETE 挡在审批卡之外。
      reason: 'sql_exec 写操作需要确认：\n' + targetLine + '\n' + summarizeWriteScript(sql, targetConn?.engine),
    }
  })
  if (typeof offPreExecute === 'function') disposers.push(offPreExecute)

  for (const definition of tools) {
    disposers.push(ctx.tools.register(definition))
  }
  const teardown = async () => {
    for (const dispose of disposers) dispose()
    const active = [...adapters.values()]
    adapters.clear()
    await Promise.allSettled(active.map(adapter => adapter.close()))
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => teardown, 'sql.dispose()')
  } else if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => { void teardown() })
  }
}

export * from './adapters.js'
export * from './config.js'
export { liveConfig, createVolatile, HostValidationError, type HostSchemaNode, type HostSchemaMeta, type VolatileRef } from './host-config.js'
export * from './tools.js'
