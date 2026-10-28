/** Read the effective Host policy without importing a second copy of its services. */
export type ApprovalPolicy = 'ask' | 'never' | 'unknown';
export interface ApprovalContext {
    get?(name: string): unknown;
    approval?: {
        config?: {
            policy?: unknown;
        };
        overrideOf?(session: unknown): unknown;
    };
}
export declare function approvalPolicy(ctx: ApprovalContext, execution: unknown): ApprovalPolicy;
export declare function approvalProblem(policy: ApprovalPolicy, setting: string): string | undefined;
