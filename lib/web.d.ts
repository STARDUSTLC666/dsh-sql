/**
 * dsh-sql 设置面板 HTTP 后端：提供认证 /api 路由与旧回环 /_dsh 路由。
 *
 * 职责：
 * - 返回当前活配置的安全快照（永不返回明文密码或原始 URL 凭据）；
 * - 支持连接的增/改/删、只读连通性测试（临时适配器 + 8s 超时 + 必定 close）与安全护栏保存；
 * - 通过宿主 settings 服务（mutate / update / replace）持久化配置，写后由活引用与修订号即时生效。
 *
 * @module dsh-sql/web
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type AdapterOptions, type DatabaseAdapter } from './adapters.js';
import { type SqlConfig, type SqlConnectionConfig, type SqlSslOption } from './config.js';
/** DSH 0.2.2+ 宿主认证连接路由。 */
export declare const SQL_API_ROUTE = "/api/dsh-sql/settings";
/** 旧宿主 webServer 回环兼容路由。 */
export declare const SQL_SETTINGS_ROUTE = "/_dsh/dsh-sql/settings";
/** 设置面板返回的单条连接脱敏视图（绝不含明文密码与原始 url）。 */
export interface SqlSettingsConnectionView {
    name: string;
    engine: 'sqlite' | 'mysql' | 'postgres';
    file?: string;
    host?: string;
    port?: number;
    user?: string;
    database?: string;
    readOnly: boolean;
    ssl?: SqlSslOption;
    hasPassword: boolean;
    passwordSource: 'config' | 'env' | 'none';
    passwordEnvVar: string;
}
/** 设置面板返回的安全护栏视图。 */
export interface SqlSettingsGuardrailsView {
    maxRows: number;
    readOnly: boolean;
    writeApproval: boolean;
    queryTimeoutMs: number;
    execTimeoutMs: number;
    redactMode: 'off' | 'builtin' | 'custom';
    redactColumns: string[];
}
/** GET / POST 返回的完整设置快照。 */
export interface SqlSettingsSnapshot {
    revision: string;
    writable: boolean;
    implicitMemoryDefault: boolean;
    connections: SqlSettingsConnectionView[];
    guardrails: SqlSettingsGuardrailsView;
}
/** 单次连通性测试结果。 */
export type SqlSettingsTestResult = {
    ok: true;
    durationMs: number;
    tableCount?: number;
} | {
    ok: false;
    durationMs: number;
    error: string;
};
/** 连接保存/测试请求中的草稿连接输入。 */
export interface SqlSettingsConnectionInput {
    name?: string;
    engine?: 'sqlite' | 'mysql' | 'postgres' | string;
    file?: string;
    url?: string;
    host?: string;
    port?: number | string | null;
    user?: string;
    password?: string;
    database?: string;
    readOnly?: boolean;
    ssl?: SqlSslOption | null | '';
}
/** 宿主 settings.mutate 的单条操作。 */
export interface SqlSettingsMutateOp {
    op: 'set';
    path: string[];
    value: unknown;
}
/** 宿主 settings.describe() 返回的单行描述符。 */
export interface SqlHostSettingsDescriptor {
    ns?: string;
    revision?: number;
    user?: Record<string, unknown>;
    base?: Record<string, unknown>;
    value?: Record<string, unknown>;
}
/** 宿主 settings 服务的最小鸭子类型面。 */
export interface SqlHostSettingsProvider {
    readonly writable?: boolean;
    describe?(): SqlHostSettingsDescriptor[] | undefined;
    mutate?(ns: string, ops: SqlSettingsMutateOp[], expectedRevision?: number): Promise<unknown>;
    update?(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<unknown>;
    replace?(ns: string, doc: Record<string, unknown>, expectedRevision?: number): Promise<unknown>;
    configure?(options: {
        auto?: boolean;
    }, fiber?: unknown): unknown;
}
/** 设置后端所需的最小插件上下文。 */
export interface SqlSettingsContext {
    get?(name: string): unknown;
    settings?: unknown;
    fiber?: {
        entry?: {
            options?: {
                id?: string;
            };
        };
    };
    inject?(deps: readonly string[], callback: (ctx: any) => void): unknown;
    effect?(effect: () => (() => unknown) | void, label?: string): unknown;
}
/** 创建设置后端时的可选依赖覆盖（便于测试与扩展）。 */
export interface SqlSettingsBackendOptions {
    env?: NodeJS.ProcessEnv;
    entryId?: string;
    writable?: () => boolean;
    getProvider?: () => SqlHostSettingsProvider | undefined;
    testTimeoutMs?: number;
    createAdapter?: (connection: SqlConnectionConfig, options?: AdapterOptions) => DatabaseAdapter;
}
/** 带 HTTP 状态码与机器可读错误码的设置后端异常。 */
export declare class SqlSettingsError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(message: string, status?: number, code?: string);
}
/** 设置后端实例接口。 */
export interface SqlSettingsBackend {
    snapshot(): SqlSettingsSnapshot;
    fetch(request: Request): Promise<Response>;
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
/**
 * 构建 dsh-sql 设置面板后端：提供 snapshot()、fetch(Request) 与 handle(req, res)。
 */
export declare function createSqlSettingsBackend(ctx: SqlSettingsContext | null | undefined, config?: SqlConfig | null | (() => SqlConfig | null | undefined), options?: SqlSettingsBackendOptions): SqlSettingsBackend;
/**
 * 在宿主 connection（/api/dsh-sql/settings）与 webServer（/_dsh/dsh-sql/settings）上挂载设置路由。
 * 返回用于卸载全部路由的清理函数。
 */
export declare function installSqlSettingsWeb(ctx: {
    inject?: Function;
} | null | undefined, backend: SqlSettingsBackend): () => void;
