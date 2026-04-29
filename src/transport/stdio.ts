import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { allTools } from "../tools/index.js";
import type { VaultConfig } from "../config.js";
import { zodToJsonSchema } from "zod-to-json-schema";

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
    const result = await tool.handler(parsed as any, {
      vaultPath: config.vaultPath,
      defaultWiki: config.defaultWiki
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`vault-mcp stdio server ready (vault=${config.vaultPath}, default-wiki=${config.defaultWiki ?? "<unset>"})\n`);
}
