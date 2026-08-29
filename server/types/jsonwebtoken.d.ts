/**
 * Minimal ambient types for `jsonwebtoken`, which ships no declarations and has
 * no @types package installed here. Upstream's auth.middleware.ts sidesteps this
 * with a file-wide `@ts-nocheck`; declaring just the surface we use lets the
 * modules that sign/verify tokens stay fully type-checked.
 */
declare module 'jsonwebtoken' {
  export type Secret = string | Buffer;

  export interface SignOptions {
    expiresIn?: string | number;
    algorithm?: string;
    [option: string]: unknown;
  }

  export function sign(
    payload: string | Buffer | object,
    secret: Secret,
    options?: SignOptions,
  ): string;

  export function verify(token: string, secret: Secret): unknown;

  export function decode(token: string): unknown;

  const jsonwebtoken: {
    sign: typeof sign;
    verify: typeof verify;
    decode: typeof decode;
  };

  export default jsonwebtoken;
}
