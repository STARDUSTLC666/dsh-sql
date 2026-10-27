import { registerUpdates } from '@stardustlc/dsh-updates'
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

import { resolveConfig, type SqlConfig } from './config.js'
import { buildSqlTools, summarizeWriteScript, type SqlToolDefinition } from './tools.js'

/** cordis 服务注入：apply 里要用 ctx.tools，必须显式声明。 */
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
export interface SqlPluginContext {
  tools: { register(definition: SqlToolDefinition): () => void }
  on(event: 'tools/pre-execute', listener: SqlPreExecuteListener): () => void
  on(event: 'dispose', listener: () => void): () => void
}

/**
 * 插件入口：解析配置、构建六工具、给 sql_exec 注入审批门。
 */
export function apply(ctx: SqlPluginContext, config?: SqlConfig | null): void {
  registerUpdates(ctx, { name: "dsh-sql" })

  const cfg = resolveConfig(config)

  const { tools, adapters } = buildSqlTools(cfg)
  if (cfg.writeApproval) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== 'sql_exec') return next()
      const args = (typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments : {}) as Record<string, unknown>
      const sql = typeof args.sql === 'string' ? args.sql : ''
      return {
        kind: 'ask',
        // 不截断整段 SQL：先逐条列出每条语句与语句类型统计，再附完整 SQL。
        // 只截 200 字符会把第二条 DROP / DELETE 挡在审批卡之外。
        reason: 'sql_exec 写操作需要确认：\n' + summarizeWriteScript(sql),
      }
    })
  }

  const disposers: Array<() => void> = []
  for (const definition of tools) {
    disposers.push(ctx.tools.register(definition))
  }
  ctx.on('dispose', () => {
    for (const dispose of disposers) dispose()
    for (const adapter of adapters.values()) void adapter.close()
  })
}

export * from './adapters.js'
export * from './config.js'
export * from './tools.js'
