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
 */
export interface DispatchCtx {
  vaultPath: string;
  defaultWiki?: string;
  fetcher: typeof fetch;
}

/**
 * Construct the per-request dispatch context from server config. Extracted so
 * tests can verify fetcher threading directly without spawning a subprocess.
 */
export function buildCtx(config: VaultConfig): DispatchCtx {
  return {
    vaultPath: config.vaultPath,
    defaultWiki: config.defaultWiki,
    fetcher: globalThis.fetch.bind(globalThis)
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
  process.stderr.write(`vault-mcp stdio server ready (vault=${config.vaultPath}, default-wiki=${config.defaultWiki ?? "<unset>"})\n`);
}
