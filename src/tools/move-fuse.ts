import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';

const Input = z.object({
  canonical_move_name: z.string().regex(/^[a-z0-9-]+$/),
  real_skill_id: z.string().min(1)
});

export const moveFuseTool = {
  name: 'vault_move-fuse',
  description: 'Fuse a canonical PokeAPI move with a registered real-skill into a usable move_id.',
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>): Promise<{ move_id: string }> => {
    const parsed = Input.parse(input);
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    return client.fuseMove(parsed);
  }
};
