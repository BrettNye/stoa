// vault-mcp/src/tools/trainer-queue-match.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext } from '../core/resolve-trainer-context.js';

const Input = z.object({
  opponent_trainer_id: z.string().min(1),
  ruleset: z.literal('standard').default('standard')
});

export const trainerQueueMatchTool = {
  name: 'vault.trainer-queue-match',
  description: 'Create a match invite against an opponent trainer; returns match_id in pending_invite state.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const trainerCtx = resolveTrainerContext({});
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    const result = await client.queueMatch(input);
    return { ...result, caller_trainer_id: trainerCtx.trainerId };
  }
};
