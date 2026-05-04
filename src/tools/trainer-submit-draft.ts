// vault-mcp/src/tools/trainer-submit-draft.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';

const Input = z.object({
  match_id: z.string().min(1),
  picks: z.array(z.string().regex(/^pf_/)).length(6)
});

export const trainerSubmitDraftTool = {
  name: 'vault.trainer-submit-draft',
  description: "Submit 6 picks (platform_profile_ids) during a match's drafting phase.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const parsed = Input.parse(input);
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    return client.submitDraft(parsed.match_id, { picks: parsed.picks });
  }
};
