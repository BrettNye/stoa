import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate every test from the user's real `~/.vault/stadium.toml`. Without this,
// any test that ends up calling `resolveStadiumConfig()` (directly or via a tool
// handler) reads the user's actual config — which, per spec, wins over env vars.
// That pollutes test results with whatever base_url / api_key happens to be set
// for live operations on this machine.
//
// `STADIUM_HOME` is honored by `resolveStadiumConfig` ahead of `homedir()`. We
// point it at a fresh tmpdir that has no `.vault/stadium.toml`, so the resolver
// falls through to env vars (which individual tests set as needed).
const stadiumIsoHome = mkdtempSync(join(tmpdir(), "vault-mcp-test-home-"));
process.env.STADIUM_HOME = stadiumIsoHome;
