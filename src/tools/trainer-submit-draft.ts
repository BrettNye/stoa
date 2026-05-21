// vault-mcp/src/tools/trainer-submit-draft.ts
import { z, ZodError } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext } from '../core/resolve-trainer-context.js';
import type { ToolScope } from '../auth/types.js';

export class InvalidPicksShapeError extends Error {
  constructor(
    public code: 'INVALID_PICKS_SHAPE',
    message: string
  ) {
    super(message);
    this.name = 'InvalidPicksShapeError';
  }
}

export const trainerSubmitDraftInput = z.object({
  match_id: z.string().regex(/^[0-9A-Z]{26}$/),
  picks: z.array(z.string().regex(/^[0-9A-Z]{26}$/)).length(6),
});

export const trainerSubmitDraftTool = {
  name: 'vault_trainer-submit-draft',
  description: "Submit 6 picks (platform_profile_ids as ULIDs) during a match's drafting phase.",
  scope: {
    axis: (i: unknown) => {
      const match_id = (i as Record<string, unknown>)?.match_id;
      return `matches/${typeof match_id === 'string' ? match_id : '*'}`;
    },
  } satisfies ToolScope,
  inputSchema: trainerSubmitDraftInput,
  handler: async (input: z.infer<typeof trainerSubmitDraftInput>) => {
    let parsed: z.infer<typeof trainerSubmitDraftInput>;
    try {
      parsed = trainerSubmitDraftInput.parse(input);
    } catch (err) {
      if (err instanceof ZodError) {
        const fields = err.issues.map(i => i.path.join(".")).join(", ");
        throw new InvalidPicksShapeError(
          'INVALID_PICKS_SHAPE',
          `INVALID_PICKS_SHAPE: invalid input shape on field(s): ${fields}`
        );
      }
      throw err;
    }
    const ctx = resolveTrainerContext({});
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    const result = await client.submitDraft(parsed.match_id, { picks: parsed.picks });
    if (result == null || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("submitDraft: unexpected non-object response from platform");
    }
    return { ...result, caller_trainer_id: ctx.trainerId };
  }
};
