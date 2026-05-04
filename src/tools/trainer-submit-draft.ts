// vault-mcp/src/tools/trainer-submit-draft.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext } from '../core/resolve-trainer-context.js';

export const trainerSubmitDraftInput = z.object({
  match_id: z.string().regex(/^[0-9A-Z]{26}$/),
  picks: z.array(z.string().regex(/^[0-9A-Z]{26}$/)).length(6),
});

export const trainerSubmitDraftTool = {
  name: 'vault.trainer-submit-draft',
  description: "Submit 6 picks (platform_profile_ids as ULIDs) during a match's drafting phase.",
  inputSchema: trainerSubmitDraftInput,
  handler: async (input: z.infer<typeof trainerSubmitDraftInput>) => {
    const parsed = trainerSubmitDraftInput.parse(input);
    const ctx = resolveTrainerContext({});
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    const result = await client.submitDraft(parsed.match_id, { picks: parsed.picks });
    return { ...result, caller_trainer_id: ctx.trainerId };
  }
};
