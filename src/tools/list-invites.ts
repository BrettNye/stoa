import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import type { ToolScope } from '../auth/types.js';

const Input = z.object({});

const listInvitesScope: ToolScope = {
  axis: (_input: any) => "wikis/*",
};

export const listInvitesTool = {
  name: 'vault_list-invites',
  description: 'List pending match invites for the calling trainer.',
  inputSchema: Input,
  scope: listInvitesScope,
  handler: async (_input: z.infer<typeof Input>) => {
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    return client.listInvites();
  }
};
