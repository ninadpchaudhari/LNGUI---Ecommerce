/**
 * Minimal structural types for the Cloudflare runtime bindings we use.
 *
 * Hand-rolled rather than depending on @cloudflare/workers-types, which
 * collides with @types/node over the global fetch/Request/Response
 * declarations in tsconfig.node.json. This mirrors the convention already used
 * for the Langfuse SDK surface in command.ts: declare the shape we call, not
 * the whole library.
 */

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

export interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}
