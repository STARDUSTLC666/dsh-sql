/**
 * 零外部依赖的宿主 Config Schema 与 liveConfig 活引用适配层（兼容 @deepseek-ai/schemastery 3.18+ 与 @deepseek-ai/cosmokit Volatile 协议）。
 *
 * 作用：
 *   1. 让 DSH 原生「设置 → 插件 → 数据库」自动渲染多连接可视化表单，对连接 password 启用凭据脱敏（role('secret')）；
 *   2. 顶层配置字段标记 volatile()，用户在设置面板保存后立即通过活引用生效并自动轮换变更的连接池，无需重启 DSH；
 *   3. 不向 package.json 引入额外 npm 依赖，离线构建 100% 自包含。
 *
 * @module dsh-sql/host-config
 */
import type { SqlConfig } from './config.js';
declare const kCheckedVolatile: unique symbol;
export interface HostSchemaMeta {
    default?: unknown;
    required?: boolean;
    volatile?: boolean;
    disabled?: boolean;
    collapse?: boolean;
    hidden?: boolean;
    loose?: boolean;
    role?: string;
    extra?: unknown;
    link?: string;
    description?: string | Record<string, string>;
    comment?: string;
    pattern?: {
        source: string;
        flags?: string;
    };
    max?: number;
    min?: number;
    step?: number;
}
export interface HostSchemaOptions {
    autofix?: boolean;
    ignore?: (data: unknown, schema: HostSchemaNode) => boolean;
    path?: Array<string | number | symbol>;
    [kCheckedVolatile]?: boolean;
}
export interface VolatileRef<T = unknown> {
    get(): T;
}
export interface HostSchemaNode<T = unknown> {
    (data?: unknown, options?: HostSchemaOptions): T;
    readonly uid: number;
    type: string;
    meta: HostSchemaMeta;
    dict?: Record<string, HostSchemaNode>;
    inner?: HostSchemaNode;
    list?: HostSchemaNode[];
    value?: unknown;
    readonly '~standard': {
        version: 1;
        vendor: 'schemastery';
        validate: (value: unknown) => {
            value: unknown;
        } | {
            issues: Array<{
                message: string;
                path?: Array<string | number | symbol>;
            }>;
        };
    };
    toJSON(): unknown;
    toString(inline?: boolean): string;
    simplify(value?: unknown): unknown;
    i18n(messages: Record<string, unknown>): HostSchemaNode<T>;
    extra(key: keyof HostSchemaMeta, value: unknown): HostSchemaNode<T>;
    role(role: string, extra?: unknown): HostSchemaNode<T>;
    description(text: string | Record<string, string>): HostSchemaNode<T>;
    comment(text: string): HostSchemaNode<T>;
    link(url: string): HostSchemaNode<T>;
    default(value: unknown): HostSchemaNode<T>;
    min(value: number): HostSchemaNode<T>;
    max(value: number): HostSchemaNode<T>;
    step(value: number): HostSchemaNode<T>;
    pattern(regexp: RegExp): HostSchemaNode<T>;
    volatile(): HostSchemaNode<VolatileRef<T>>;
    required(value?: boolean): HostSchemaNode<T>;
    hidden(value?: boolean): HostSchemaNode<T>;
    disabled(value?: boolean): HostSchemaNode<T>;
    collapse(value?: boolean): HostSchemaNode<T>;
    loose(value?: boolean): HostSchemaNode<T>;
    set(key: string, value: HostSchemaNode): HostSchemaNode<T>;
    push(value: HostSchemaNode): HostSchemaNode<T>;
}
export declare class HostValidationError extends TypeError {
    readonly options: HostSchemaOptions;
    name: string;
    constructor(message: string, options?: HostSchemaOptions);
    static is(error: unknown): error is HostValidationError;
}
export declare function createVolatile<T>(value: T): VolatileRef<T>;
export declare const z: {
    string: () => HostSchemaNode<string>;
    number: () => HostSchemaNode<number>;
    boolean: () => HostSchemaNode<boolean>;
    const: <const V extends string | number | boolean>(value: V) => HostSchemaNode<V>;
    union: <T = unknown>(list: readonly unknown[]) => HostSchemaNode<T>;
    array: <T = unknown>(inner: HostSchemaNode<T>) => HostSchemaNode<T[]>;
    object: <T extends object = Record<string, unknown>>(dict: Record<string, HostSchemaNode>) => HostSchemaNode<T>;
    ValidationError: typeof HostValidationError;
};
export declare const Config: HostSchemaNode<SqlConfig>;
/** 活引用视图：同时兼容 DSH >=0.1.7 的 { get() } 活引用与旧宿主/测试传入的普通对象。 */
export declare function liveConfig<T extends object>(config: T): T;
export {};
