// vault-mcp/src/tools/trainer-get-state.ts
import { z } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext } from '../core/resolve-trainer-context.js';
import { listPlatformProfiles, type PlatformProfileRow } from './list-platform-profiles.js';
import type { ToolScope } from '../auth/types.js';

const Input = z.object({
  match_id: z.string().min(1),
  since_turn: z.number().int().nonnegative().optional()
});

export const trainerGetStateTool = {
  name: 'vault_trainer-get-state',
  description: 'Fetch authenticated match state; supports since_turn for incremental polling.',
  scope: {
    axis: (i: unknown) => {
      const trainer_id = (i as Record<string, unknown>)?.trainer_id;
      return `trainers/${typeof trainer_id === 'string' ? trainer_id : '*'}`;
    },
  } satisfies ToolScope,
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>) => {
    const ctx = resolveTrainerContext({});
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });
    const platformState = await client.getMatchState(input.match_id, input.since_turn);

    if (platformState == null || typeof platformState !== 'object') {
      throw new Error('getMatchState: unexpected non-object response from platform');
    }

    const state = platformState as Record<string, any>;

    // Determine which side the caller is on
    const callerSide: 'a' | 'b' =
      state.a?.trainerId === ctx.trainerId ? 'a' :
      state.b?.trainerId === ctx.trainerId ? 'b' :
      (() => { throw new Error('caller is not a participant in this match'); })();

    // waiting_for_move: true iff status=battle and caller hasn't submitted for current turn
    const waitingForMove =
      state.status === 'battle' &&
      (state.events as any[] ?? []).findIndex(
        (e: any) => e.turn === state.turn && e.actor === callerSide
      ) === -1;

    // available_profiles: only present during drafting phase
    let availableProfiles: PlatformProfileRow[] | undefined;
    if (state.status === 'drafting') {
      const { profiles } = await listPlatformProfiles({ owner_trainer_id: ctx.trainerId });
      availableProfiles = profiles;
    }

    return {
      ...state,
      caller_trainer_id: ctx.trainerId,
      caller_side: callerSide,
      waiting_for_move: waitingForMove,
      ...(availableProfiles !== undefined ? { available_profiles: availableProfiles } : {}),
    };
  }
};
