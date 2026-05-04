// vault-mcp/src/tools/trainer-accept-match.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';

const Input = z.object({
  match_id: z.string().min(1)
});

export const trainerAcceptMatchTool = {
  name: 'vault.trainer-accept-match',
  description: 'Accept a pending_invite match; transitions to drafting.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    return client.acceptMatch(input.match_id);
  }
};
