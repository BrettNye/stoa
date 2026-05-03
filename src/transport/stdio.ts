import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { allTools } from "../tools/index.js";
import type { VaultConfig } from "../config.js";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * The shape of the dispatch context every tool handler receives. PokeAPI-touching
 * tools (vault.evolve-profile proposal phase, vault.suggest-pokemon) read
 * `fetcher` and silently fall back to non-PokeAPI behaviour when it's missing —
 * so this *must* be populated for production MCP calls. See spec §4.3, §7.4.
 *
 * v1.6 Phase 2 T3-6 — `defaultFamily` is symmetric to `defaultWiki`. Family-aware
 * tools (recall, list-wikis, start; future Plan C lint checks) consume it via
 * `core/family.resolveFamily`. Resolution order:
 *   tool-arg `family:` > ctx.defaultFamily > vault-root `.active-family` > null.
 */
export interface DispatchCtx {
  vaultPath: string;
  defaultWiki?: string;
  defaultFamily?: string;
  fetcher: typeof fetch;
  // Plan 1 (claims) — opaque pass-through of the raw vault config object so
  // claim-aware tools can resolve `getClaimsConfig(ctx.rawConfig)`. Today
  // `parseConfig` reads only CLI flags so this is always undefined; once a
  // file-based config loader lands it should populate this slot. Tools that
  // consume it MUST treat undefined as "use defaults".
  rawConfig?: unknown;
}

/**
 * Construct the per-request dispatch context from server config. Extracted so
 * tests can verify fetcher threading directly without spawning a subprocess.
 */
export function buildCtx(config: VaultConfig): DispatchCtx {
  return {
    vaultPath: config.vaultPath,
    defaultWiki: config.defaultWiki,
    defaultFamily: config.defaultFamily,
    fetcher: globalThis.fetch.bind(globalThis),
    // No file-based config today; claim-aware tools fall back to spec defaults
    // via `getClaimsConfig({})`. Slot is here so DispatchCtx structurally
    // satisfies tool contexts that require `rawConfig?: unknown`.
    rawConfig: undefined
  };
}

export async function startStdio(config: VaultConfig): Promise<void> {
  const server = new Server(
    { name: "vault-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema as any) as any
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = allTools.find(t => t.name === req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
    const result = await tool.handler(parsed as any, buildCtx(config));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`vault-mcp stdio server ready (vault=${config.vaultPath}, default-wiki=${config.defaultWiki ?? "<unset>"}, default-family=${config.defaultFamily ?? "<unset>"})\n`);
}
