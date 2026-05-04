// vault-mcp/src/tools/trainer-submit-move.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';

const Input = z.object({
  match_id: z.string().min(1),
  turn: z.number().int().nonnegative(),
  move_id: z.string().min(1),
  target: z.string().optional()
});

export const trainerSubmitMoveTool = {
  name: 'vault.trainer-submit-move',
  description: 'Submit a move for the current turn; server resolves once both trainers submit.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    return client.submitMove(input.match_id, { turn: input.turn, move_id: input.move_id, target: input.target });
  }
};
