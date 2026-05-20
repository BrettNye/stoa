// vault-mcp/src/tools/trainer-submit-move.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext } from '../core/resolve-trainer-context.js';

const Input = z.object({
  match_id: z.string().min(1),
  turn: z.number().int().nonnegative(),
  move_id: z.string().min(1),
  target: z.string().optional()
});

export const trainerSubmitMoveTool = {
  name: 'vault_trainer-submit-move',
  description: 'Submit a move for the current turn; server resolves once both trainers submit.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const ctx = resolveTrainerContext({});
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    const result = await client.submitMove(input.match_id, { turn: input.turn, move_id: input.move_id, target: input.target });
    if (result == null || typeof result !== "object") {
      throw new Error("submitMove: unexpected non-object response from platform");
    }
    return { ...result, caller_trainer_id: ctx.trainerId };
  }
};
