import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';

const Input = z.object({});

export const listInvitesTool = {
  name: 'vault.list-invites',
  description: 'List pending match invites for the calling trainer.',
  inputSchema: Input,
  handler: async (_input: z.infer<typeof Input>) => {
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    return client.listInvites();
  }
};
