// Side-effect-only module. MUST be imported FIRST in bin.ts (and any other
// entrypoint) — before any module that transitively pulls in `natural`.
//
// The `natural` package depends on `dotenv@17+`, which prints unsolicited
// "tip:" advertisements to stdout on import. That corrupts MCP's stdio
// JSON-RPC framing and prevents clients from connecting. Setting
// DOTENV_CONFIG_QUIET=true before dotenv loads suppresses the tips.
//
// ESM evaluates imports in source order, so as long as this module is
// imported first, the env var is in place before natural's transitive
// dotenv module runs its top-level code.
process.env.DOTENV_CONFIG_QUIET = "true";
