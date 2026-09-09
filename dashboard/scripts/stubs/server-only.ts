/**
 * A no-op stand-in for the `server-only` package.
 *
 * That package exists to throw at build time if a server module is pulled into
 * a client bundle. The query modules import it, which is right — and it means
 * they cannot be loaded by a plain Node script either, because the real package
 * throws on any import outside a React Server Component.
 *
 * `scripts/tsconfig.json` points the specifier here for scripts only. Nothing
 * in the app resolves to this file: the app builds against the real package,
 * so the guard it provides is intact where it matters.
 */
export {};
