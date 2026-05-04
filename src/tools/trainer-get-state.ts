// vault-mcp/src/tools/trainer-get-state.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';

const Input = z.object({
  match_id: z.string().min(1),
  since_turn: z.number().int().nonnegative().optional()
});

export const trainerGetStateTool = {
  name: 'vault.trainer-get-state',
  description: 'Fetch authenticated match state; supports since_turn for incremental polling.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    return client.getMatchState(input.match_id, input.since_turn);
  }
};
