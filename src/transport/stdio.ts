import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { allTools } from "../tools/index.js";
import type { VaultConfig } from "../config.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EventBus } from "../core/eventbus/bus.js";
import { StateCache } from "../core/eventbus/state-cache.js";
import { EventDeriver } from "../core/eventbus/event-deriver.js";
import { Watcher } from "../core/eventbus/watcher.js";
import { WaiterRegistry } from "../core/eventbus/registry.js";
import { matchers, getAllGlobs } from "../core/eventbus/matchers/index.js";

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
  // v1.7.1 — push primitives. Populated when MCP server boots via startStdio;
  // absent (undefined) for CLI calls or tools that do not need the event bus.
  bus?: EventBus;
  registry?: WaiterRegistry;
  watcher?: Watcher;
}

/** Optional eventbus bundle threaded in by startStdio for wait-for tools. */
export interface EventBundle {
  bus: EventBus;
  registry: WaiterRegistry;
  watcher: Watcher;
}

/**
 * Construct the per-request dispatch context from server config. Extracted so
 * tests can verify fetcher threading directly without spawning a subprocess.
 *
 * v1.7.1: accepts an optional `eventBundle` parameter populated by `startStdio`
 * so wait-for tools receive their required HandleWaitContext fields. CLI callers
 * omit it; the fields remain undefined and non-wait-for tools are unaffected.
 */
export function buildCtx(config: VaultConfig, eventBundle?: EventBundle): DispatchCtx {
  return {
    vaultPath: config.vaultPath,
    defaultWiki: config.defaultWiki,
    defaultFamily: config.defaultFamily,
    fetcher: globalThis.fetch.bind(globalThis),
    // No file-based config today; claim-aware tools fall back to spec defaults
    // via `getClaimsConfig({})`. Slot is here so DispatchCtx structurally
    // satisfies tool contexts that require `rawConfig?: unknown`.
    rawConfig: undefined,
    ...(eventBundle ?? {}),
  };
}

export async function startStdio(config: VaultConfig): Promise<void> {
  // v1.7.1 — Build the eventbus bundle once at server startup. The watcher is
  // NOT started here; handleWait starts it lazily when a wait-for tool is invoked.
  const bus = new EventBus();
  const stateCache = new StateCache();
  const eventDeriver = new EventDeriver({
    vaultPath: config.vaultPath,
    bus,
    stateCache,
  });
  const watcher = new Watcher({
    vaultPath: config.vaultPath,
    globs: getAllGlobs(),
    onEvent: (path, kind) => eventDeriver.derive(path, kind),
  });
  const registry = new WaiterRegistry(bus);

  // Warm the state cache for matchers with init (taskMatcher). One-shot walk;
  // cheap synchronous reads so the first task event has a valid baseline state.
  const initPaths = walkInitablePaths(config.vaultPath);
  eventDeriver.warmStateCache(initPaths);

  // Clean up on process exit.
  const cleanup = () => {
    registry.close();
    watcher.close().catch(() => {});
  };
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);

  const eventBundle: EventBundle = { bus, registry, watcher };

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
    // Each tool handler has its own context shape (the intersection of all
    // tool contexts narrows to an unsatisfiable type because wait-for tools
    // require non-optional `bus`). Cast to any at the call site — each
    // handler validates the fields it actually reads.
    const result = await tool.handler(parsed as any, buildCtx(config, eventBundle) as any);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`vault-mcp stdio server ready (vault=${config.vaultPath}, default-wiki=${config.defaultWiki ?? "<unset>"}, default-family=${config.defaultFamily ?? "<unset>"})\n`);
}

/**
 * Walk wikis/ for file paths that match a matcher with `init` defined.
 * Used to warm the state cache before accepting live events, so the first
 * change event has a valid prior state to diff against.
 */
function walkInitablePaths(vaultPath: string): string[] {
  const root = join(vaultPath, "wikis");
  if (!existsSync(root)) return [];
  // @types/node 22 declares `Dirent<NonSharedBuffer>` as the default for the
  // recursive+withFileTypes overload — `name` ends up typed as a buffer-like
  // even though it's a string at runtime (we pass a string path with no
  // encoding option). Type the result with the fields we actually consume.
  let entries: Array<{
    isFile(): boolean;
    name: string;
    parentPath?: string;
    path?: string;
  }>;
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true }) as unknown as typeof entries;
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".md")) continue;
    // parentPath is available in Node 20+; fall back to the entry's path prop.
    const dir = e.parentPath ?? e.path ?? root;
    const abs = join(dir, e.name);
    for (const m of matchers) {
      if (!m.init) continue;
      if (m.deriveKey(abs, vaultPath)) {
        paths.push(abs);
        break;
      }
    }
  }
  return paths;
}
