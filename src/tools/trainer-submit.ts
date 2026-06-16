// src/tools/trainer-submit.ts
// Consolidated tool for both draft and move submission.
// mode: "draft" — submit 6 picks (platform_profile_ids as ULIDs) during drafting phase.
// mode: "move" — submit a move (turn + move_id + optional target) for the current turn.
import { z, ZodError } from 'zod';
import { resolveStadiumConfig } from '../core/stadium-config.js';
import { StadiumClient } from '../core/stadium-client.js';
import { resolveTrainerContext } from '../core/resolve-trainer-context.js';
import { requireField } from './_mode.js';
import type { ToolScope } from '../auth/types.js';

export class InvalidPicksShapeError extends Error {
  constructor(
    public code: 'INVALID_PICKS_SHAPE',
    message: string
  ) {
    super(message);
    this.name = 'InvalidPicksShapeError';
  }
}

// The strict draft schema — ULID match_id + exactly 6 ULID picks.
// Re-used for re-validation inside the draft branch to preserve
// InvalidPicksShapeError wrapping behavior (Audit H3).
export const trainerSubmitDraftInput = z.object({
  match_id: z.string().regex(/^[0-9A-Z]{26}$/),
  picks: z.array(z.string().regex(/^[0-9A-Z]{26}$/)).length(6),
});

const Input = z.object({
  mode: z.enum(['draft', 'move']),
  match_id: z.string().min(1),
  picks: z.array(z.string().regex(/^[0-9A-Z]{26}$/)).length(6).optional(), // draft
  turn: z.number().int().nonnegative().optional(),    // move
  move_id: z.string().min(1).optional(),              // move
  target: z.string().optional(),                      // move
});

export const trainerSubmitTool = {
  name: 'vault_trainer-submit',
  description: 'Submit during a match. mode: draft (6 ULID picks) | move (turn+move_id[+target]).',
  inputSchema: Input,
  scope: {
    axis: (i: unknown) => {
      const match_id = (i as Record<string, unknown>)?.match_id;
      return `matches/${typeof match_id === 'string' ? match_id : '*'}`;
    },
  } satisfies ToolScope,
  handler: async (input: z.infer<typeof Input>) => {
    const ctx = resolveTrainerContext({});
    const config = resolveStadiumConfig();
    const client = new StadiumClient({ api_key: config.api_key, base_url: config.base_url });

    if (input.mode === 'draft') {
      // Re-validate using the strict draft schema (ULID match_id + 6 ULID picks).
      // This wraps ZodError as InvalidPicksShapeError to preserve the original
      // error-wrapping behavior from trainer-submit-draft.ts (Audit H3).
      let parsed: z.infer<typeof trainerSubmitDraftInput>;
      try {
        parsed = trainerSubmitDraftInput.parse({ match_id: input.match_id, picks: input.picks });
      } catch (err) {
        if (err instanceof ZodError) {
          const fields = err.issues.map(i => i.path.join('.')).join(', ');
          throw new InvalidPicksShapeError(
            'INVALID_PICKS_SHAPE',
            `INVALID_PICKS_SHAPE: invalid input shape on field(s): ${fields}`
          );
        }
        throw err;
      }
      const result = await client.submitDraft(parsed.match_id, { picks: parsed.picks });
      if (result == null || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('submitDraft: unexpected non-object response from platform');
      }
      return { ...result, caller_trainer_id: ctx.trainerId };
    } else {
      // mode === "move"
      const turn = requireField(input.turn, 'vault_trainer-submit mode=move', 'turn');
      const move_id = requireField(input.move_id, 'vault_trainer-submit mode=move', 'move_id');
      const result = await client.submitMove(input.match_id, { turn, move_id, target: input.target });
      if (result == null || typeof result !== 'object') {
        throw new Error('submitMove: unexpected non-object response from platform');
      }
      return { ...result, caller_trainer_id: ctx.trainerId };
    }
  },
};
