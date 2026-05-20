// vault-mcp/src/tools/trainer-queue-match.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext, TrainerContext, TrainerContextError } from '../core/resolve-trainer-context.js';

const Input = z.object({
  opponent_trainer_id: z.string().min(1),
  ruleset: z.literal('standard').default('standard'),
  wiki: z.string().min(1).optional()
});

export const trainerQueueMatchTool = {
  name: 'vault_trainer-queue-match',
  description: 'Create a match invite against an opponent trainer; returns match_id in pending_invite state.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    let trainerCtx: TrainerContext | undefined;
    try {
      trainerCtx = resolveTrainerContext({});
    } catch (err) {
      if (input.wiki && err instanceof TrainerContextError && err.code === 'TRAINER_WIKI_UNSET') {
        // explicit wiki: arg wins; continue without trainer wiki
      } else {
        throw err;
      }
    }
    const wiki = input.wiki ?? trainerCtx!.wiki;
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    const { opponent_trainer_id, ruleset } = input;
    const result = await client.queueMatch({ opponent_trainer_id, ruleset });
    return { ...result, caller_trainer_id: trainerCtx?.trainerId ?? null, resolved_wiki: wiki };
  }
};
