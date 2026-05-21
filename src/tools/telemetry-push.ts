// vault-mcp/src/tools/telemetry-push.ts
//
// Push a single move-usage event to the Stadium platform. The server
// increments XP for the named real-skill and may level it up. Domain-
// agnostic: any real-world skill use can be credited from journals,
// tasks, or external evidence — the `reference_link` records where the
// usage was observed.
//
// Server errors (e.g. `unknown_real_skill_id`, `rate_limited`)
// propagate as `StadiumApiError` from the underlying StadiumClient —
// callers see the `error_code` directly.
import { z } from "zod";
import { resolveStadiumConfig } from "../core/stadium-config.js";
import { StadiumClient } from "../core/stadium-client.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  real_skill_id: z.string().min(1),
  source: z.string().min(1),
  reference_link: z.string().min(1),
  wiki: z.string().min(1).optional()
});

export const telemetryPushTool = {
  name: "vault_telemetry-push",
  description:
    "Push a move-usage event to Stadium; increments server-side XP for the named real-skill.",
  scope: {
    axis: (i: unknown) => {
      const wiki = (i as Record<string, unknown>)?.wiki;
      return `wikis/${typeof wiki === 'string' ? wiki : '*'}`;
    },
  } satisfies ToolScope,
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const config = resolveStadiumConfig();
    const client = new StadiumClient({
      api_key: config.api_key,
      base_url: config.base_url
    });
    return client.pushTelemetry(input);
  }
};
