export function approvalPolicy(ctx, execution) {
    try {
        const service = (ctx.get ? ctx.get('approval') : ctx.approval);
        const session = execution?.agent?.session;
        const policy = (session === undefined ? undefined : service?.overrideOf?.(session)) ?? service?.config?.policy;
        return policy === 'ask' || policy === 'never' ? policy : 'unknown';
    }
    catch {
        return 'unknown';
    }
}
export function approvalProblem(policy, setting) {
    if (policy === 'ask')
        return undefined;
    if (policy === 'never')
        return '插件要求确认，但当前会话审批策略 never 不允许询问，操作未执行。请切换到可询问模式，或由用户明确设置 ' + setting + '=false / Confirmation is required but this session cannot ask; no action was performed.';
    return '无法读取宿主审批策略，操作未执行。请检查 DSH 审批服务或插件配置 / Host approval policy unavailable; no action was performed.';
}
