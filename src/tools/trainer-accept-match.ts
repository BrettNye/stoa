// vault-mcp/src/tools/trainer-accept-match.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext, TrainerContext, TrainerContextError } from '../core/resolve-trainer-context.js';

const Input = z.object({
  match_id: z.string().min(1),
  wiki: z.string().min(1).optional()
});

export const trainerAcceptMatchTool = {
  name: 'vault_trainer-accept-match',
  description: 'Accept a pending_invite match; transitions to drafting.',
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
    const result = await client.acceptMatch(input.match_id);
    return { ...result, caller_trainer_id: trainerCtx?.trainerId ?? null, resolved_wiki: wiki };
  }
};
