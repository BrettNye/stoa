// src/tools/stadium-scopes.test.ts
// Verifies scope declarations for all 12 stadium tools.
import { describe, it, expect } from 'vitest';
import { trainerInitTool } from './trainer-init.js';
import { profileRegisterTool } from './profile-register.js';
import { realSkillRegisterTool } from './real-skill-register.js';
import { realSkillRefreshTool } from './real-skill-refresh.js';
import { moveFuseTool } from './move-fuse.js';
import { telemetryPushTool } from './telemetry-push.js';
import { trainerQueueMatchTool } from './trainer-queue-match.js';
import { trainerAcceptMatchTool } from './trainer-accept-match.js';
import { trainerGetStateTool } from './trainer-get-state.js';
import { trainerSubmitDraftTool } from './trainer-submit-draft.js';
import { trainerSubmitMoveTool } from './trainer-submit-move.js';
import { matchWatchTool } from './match-watch.js';
import type { ToolScope } from '../auth/types.js';

// Helper: assert that a value conforms to ToolScope at the type level
// and return it so we can call the functions
function asScope(s: unknown): ToolScope {
  if (typeof s !== 'object' || s === null) {
    throw new Error('scope is not an object');
  }
  const scope = s as ToolScope;
  if (typeof scope.axis !== 'function') {
    throw new Error('scope.axis is not a function');
  }
  return scope;
}

describe('stadium tools — scope declarations', () => {
  describe('adminOnly registration/fusion/refresh tools', () => {
    const adminTools = [
      { name: 'vault_trainer-init', tool: trainerInitTool },
      { name: 'vault_profile-register', tool: profileRegisterTool },
      { name: 'vault_real-skill-register', tool: realSkillRegisterTool },
      { name: 'vault_real-skill-refresh', tool: realSkillRefreshTool },
      { name: 'vault_move-fuse', tool: moveFuseTool },
    ];

    for (const { name, tool } of adminTools) {
      it(`${name} has scope with axis "stadium"`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({})).toBe('stadium');
      });

      it(`${name} has adminOnly: () => true`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.adminOnly).toBeDefined();
        expect(scope.adminOnly!({})).toBe(true);
      });
    }
  });

  describe('telemetry-push', () => {
    it('has scope with axis derived from wiki', () => {
      const scope = asScope((telemetryPushTool as any).scope);
      expect(scope.axis({ wiki: 'myteam' })).toBe('wikis/myteam');
    });

    it('telemetry-push axis falls back to "*" when wiki is absent', () => {
      const scope = asScope((telemetryPushTool as any).scope);
      expect(scope.axis({})).toBe('wikis/*');
    });

    it('telemetry-push has no adminOnly', () => {
      const scope = asScope((telemetryPushTool as any).scope);
      expect(scope.adminOnly).toBeUndefined();
    });
  });

  describe('trainer-id axis tools', () => {
    const trainerTools = [
      { name: 'vault_trainer-queue-match', tool: trainerQueueMatchTool },
      { name: 'vault_trainer-accept-match', tool: trainerAcceptMatchTool },
      { name: 'vault_trainer-get-state', tool: trainerGetStateTool },
    ];

    for (const { name, tool } of trainerTools) {
      it(`${name} axis includes trainer_id when provided`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({ trainer_id: 'abc123' })).toBe('trainers/abc123');
      });

      it(`${name} axis falls back to "*" when trainer_id absent`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({})).toBe('trainers/*');
      });
    }
  });

  describe('match-id axis tools', () => {
    const matchTools = [
      { name: 'vault_trainer-submit-draft', tool: trainerSubmitDraftTool },
      { name: 'vault_trainer-submit-move', tool: trainerSubmitMoveTool },
      { name: 'vault_match-watch', tool: matchWatchTool },
    ];

    for (const { name, tool } of matchTools) {
      it(`${name} axis includes match_id when provided`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({ match_id: 'MATCH01234567890123456789' })).toBe('matches/MATCH01234567890123456789');
      });

      it(`${name} axis falls back to "*" when match_id absent`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({})).toBe('matches/*');
      });
    }
  });
});
